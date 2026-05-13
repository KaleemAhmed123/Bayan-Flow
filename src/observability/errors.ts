import Groq from "groq-sdk";

export type ErrorCategory =
  | "startup"
  | "config"
  | "hotkey"
  | "recorder"
  | "transcription"
  | "cleanup"
  | "paste"
  | "ipc";

export type NormalizedError = {
  id: string;
  category: ErrorCategory;
  userMessage: string;
  message: string;
  name?: string;
  status?: number;
  code?: string;
  retryable: boolean;
};

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
  };
}

function getUserMessage(category: ErrorCategory, error: unknown): string {
  const source = error instanceof Error ? error : undefined;
  const status = source ? getNumber(source, "status") : undefined;
  const code = source ? getString(source, "code") : undefined;

  if (category === "transcription" || category === "cleanup") {
    if (status === 401 || status === 403) {
      return "Groq API key was rejected";
    }

    if (status === 413) {
      return "Recording is too large";
    }

    if (status === 400 || status === 404) {
      return "Groq model or request is invalid";
    }

    if (status === 429) {
      return "Groq is rate limiting requests";
    }

    if (
      (status && status >= 500) ||
      code === "ETIMEDOUT" ||
      code === "ECONNRESET" ||
      code === "ENOTFOUND" ||
      code === "ECONNREFUSED"
    ) {
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

export function isRetryableError(error: unknown): boolean {
  if (
    error instanceof Groq.APIConnectionError ||
    error instanceof Groq.APIConnectionTimeoutError ||
    error instanceof Groq.RateLimitError ||
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
      status === 429 ||
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
