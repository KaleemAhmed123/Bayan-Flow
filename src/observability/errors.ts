import Groq from "groq-sdk";
import { headersFromError, parseRateLimitDuration, readHeader } from "../llm/rate-limit-headers.js";

export type ErrorCategory =
  | "startup"
  | "config"
  | "hotkey"
  | "recorder"
  | "transcription"
  | "cleanup"
  | "paste"
  | "ipc";

/**
 * How error classification asks whether the machine is online.
 *
 * Injected rather than imported so this module stays free of Electron, which is
 * what lets it be unit-tested. Defaults to "online": being wrong in that
 * direction shows a provider message for a network fault, while the opposite
 * sends a user to fix a connection that was never broken.
 */
let isOnlineChecker: () => boolean = () => true;

export function setOnlineChecker(checker: () => boolean): void {
  isOnlineChecker = checker;
}

export type NormalizedError = {
  id: string;
  category: ErrorCategory;
  userMessage: string;
  message: string;
  name?: string;
  status?: number;
  code?: string;
  retryable: boolean;
  /** Seconds the provider asked us to wait, when it said so on a 429. */
  retryAfterSeconds?: number;
};

/** True for a rate-limit rejection, whatever shape the SDK wrapped it in. */
export function isRateLimitError(error: unknown): boolean {
  if (error instanceof Groq.RateLimitError) {
    return true;
  }

  const source = error instanceof Error ? error : undefined;
  return source ? getNumber(source, "status") === 429 : false;
}

/**
 * How long the provider says to wait before retrying this request, in seconds.
 *
 * Returns undefined when the error is not a rate limit or carries no usable
 * timing header — never a guess, because a made-up delay is worse than none.
 */
export function retryAfterSecondsFor(error: unknown): number | undefined {
  if (!isRateLimitError(error)) {
    return undefined;
  }

  const headers = headersFromError(error);
  const retryAfter =
    parseRateLimitDuration(readHeader(headers, "retry-after")) ??
    parseRateLimitDuration(readHeader(headers, "x-ratelimit-reset-tokens"));

  return retryAfter ?? undefined;
}

const USER_MESSAGES: Record<ErrorCategory, string> = {
  startup: "App startup failed",
  config: "Settings could not be loaded",
  hotkey: "Could not register hotkey",
  recorder: "Recording failed",
  transcription: "Transcription failed",
  cleanup: "Text cleanup failed",
  paste: "Paste failed; text copied",
  ipc: "App communication failed",
};

export function normalizeError(category: ErrorCategory, error: unknown): NormalizedError {
  const source = error instanceof Error ? error : new Error(String(error));
  const status = getNumber(source, "status");
  const code = getString(source, "code");

  return {
    id: createErrorId(category),
    category,
    userMessage: getUserMessage(category, error),
    message: sanitizeErrorMessage(source.message),
    name: source.name,
    status,
    code,
    retryable: isRetryableError(error),
    retryAfterSeconds: retryAfterSecondsFor(error),
  };
}

function getUserMessage(category: ErrorCategory, error: unknown): string {
  const source = error instanceof Error ? error : undefined;
  const status = source ? getNumber(source, "status") : undefined;
  const code = source ? getString(source, "code") : undefined;

  if (category === "transcription" || category === "cleanup") {
    // The model hit its output ceiling. Retrying changes nothing; shortening does.
    if (code === "output_truncated") {
      return "That was too long for the model to finish. Try a shorter selection.";
    }

    if (status === 401 || status === 403) {
      return "Groq API key was rejected";
    }

    if (status === 413) {
      return "Recording is too large";
    }

    // Groq answers a retired model id with 404 model_not_found. "Invalid request"
    // told the user nothing actionable, so name the real problem and the fix.
    if (status === 404) {
      return "That AI model is no longer available. Open Settings to choose another.";
    }

    if (status === 400) {
      return "Groq rejected the request";
    }

    if (status === 429) {
      // Saying when it will work again turns a dead end into a wait. The
      // provider already told us; passing that on costs nothing.
      const retryAfter = retryAfterSecondsFor(error);
      if (retryAfter === undefined) {
        return "Groq is rate limiting requests";
      }

      return retryAfter >= 60
        ? `Groq rate limit reached. Try again in about ${Math.round(retryAfter / 60)} min.`
        : `Groq rate limit reached. Try again in ${Math.max(1, Math.ceil(retryAfter))}s.`;
    }

    if (
      (status && status >= 500) ||
      code === "ETIMEDOUT" ||
      code === "ECONNRESET" ||
      code === "ENOTFOUND" ||
      code === "ECONNREFUSED"
    ) {
      // A hung socket looks the same whether the network is down or the provider
      // is slow. ENOTFOUND in particular is far more often unreachable DNS than
      // a vanished provider, so ask before blaming them.
      if (!isOnlineChecker()) {
        return "You appear to be offline. Check your internet connection.";
      }

      return "Groq is temporarily unavailable";
    }
  }

  if (category === "recorder" && source?.message.toLowerCase().includes("permission")) {
    return "Microphone permission was denied";
  }

  if (category === "recorder" && source?.message.toLowerCase().includes("too large")) {
    return "Recording is too large";
  }

  return USER_MESSAGES[category];
}

/**
 * True when this failure is the machine's own network being down, rather than
 * anything the provider did.
 *
 * Both produce the same hung socket, so the connection code alone cannot tell
 * them apart — the reachability check is what separates "your wifi is off" from
 * "their server is slow".
 */
export function isOfflineError(error: unknown): boolean {
  const source = error instanceof Error ? error : undefined;
  const code = source ? getString(source, "code") : undefined;
  const isConnectionFault =
    code === "ETIMEDOUT" || code === "ECONNRESET" || code === "ENOTFOUND" || code === "ECONNREFUSED";

  return isConnectionFault && !isOnlineChecker();
}

/**
 * Whether re-sending the SAME request to the SAME model could plausibly succeed.
 *
 * Rate limits are deliberately excluded. A 429 means "you are sending too much",
 * so answering it with three more identical requests spends the user's quota
 * faster, delays the failure by ~2s, and fails anyway. The caller handles a
 * rate limit properly instead: record the provider's cooldown, then switch to
 * the fallback model. See `ModelCooldownManager`.
 */
export function isRetryableError(error: unknown): boolean {
  if (isRateLimitError(error)) {
    return false;
  }

  // Retrying into a dead network burns the user's time for a guaranteed failure.
  if (isOfflineError(error)) {
    return false;
  }

  if (
    error instanceof Groq.APIConnectionError ||
    error instanceof Groq.APIConnectionTimeoutError ||
    error instanceof Groq.InternalServerError
  ) {
    return true;
  }

  const source = error instanceof Error ? error : undefined;
  const status = source ? getNumber(source, "status") : undefined;
  const code = source ? getString(source, "code") : undefined;

  return Boolean(
    status === 408 ||
      status === 409 ||
      (status && status >= 500) ||
      code === "ETIMEDOUT" ||
      code === "ECONNRESET" ||
      code === "ENOTFOUND",
  );
}

export async function retryTransient<T>(
  operation: () => Promise<T>,
  options: { attempts?: number; delayMs?: number; onRetry?: (attempt: number, error: NormalizedError) => void | Promise<void>; category: ErrorCategory },
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const delayMs = options.delayMs ?? 350;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const normalized = normalizeError(options.category, error);
      if (attempt >= attempts || !normalized.retryable) {
        throw error;
      }

      await options.onRetry?.(attempt, normalized);
      await sleep(delayMs * attempt);
    }
  }

  throw new Error("Retry failed unexpectedly.");
}

function createErrorId(category: ErrorCategory): string {
  return `${category}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeErrorMessage(message: string): string {
  return message.replace(/gsk_[a-z0-9_-]+|sk-[a-z0-9_-]+|bearer\s+[a-z0-9._-]+/gi, "[redacted]");
}

function getNumber(source: Error, key: string): number | undefined {
  const value = (source as unknown as Record<string, unknown>)[key];
  return typeof value === "number" ? value : undefined;
}

function getString(source: Error, key: string): string | undefined {
  const value = (source as unknown as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
