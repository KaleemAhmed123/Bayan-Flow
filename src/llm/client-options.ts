/**
 * One place that decides where a model call goes and how long it may take.
 *
 * Four modules construct a client — transcription, cleanup, rewrite and context
 * — and every one of them had the endpoint and the timeout baked in as a module
 * constant. That is exactly the shape that produced two separate bugs when
 * `completion-budget` was bypassed, so the endpoint and the timeout get the same
 * treatment: a single function, and no call site does its own arithmetic.
 *
 * The request shape is OpenAI-compatible, which is what both the hosted provider
 * and every local runner speak, so pointing at a local server is a base URL and
 * nothing else.
 */

/** Fine for a fast hosted provider, and far too short for a local one. */
export const DEFAULT_TIMEOUT_MS = 45_000;

/**
 * Context is best-effort and must never delay a dictation, so it keeps its own
 * much shorter ceiling regardless of what the other stages are given.
 */
export const DEFAULT_CONTEXT_TIMEOUT_MS = 8_000;

/** Beyond this a "timeout" is indistinguishable from a hang, so refuse it. */
export const MAX_TIMEOUT_MS = 10 * 60 * 1_000;

export type EndpointSettings = {
  /** Empty means the SDK's own default, i.e. the hosted provider. */
  baseUrl?: string;
  /** Zero, negative, or not a number means "use the default". */
  timeoutMs?: number;
};

export type ClientOptions = {
  apiKey: string;
  timeout: number;
  maxRetries: number;
  baseURL?: string;
};

/**
 * A blank or unparseable URL falls back to the default endpoint rather than
 * throwing. A user halfway through typing a URL into settings must not be able
 * to break every model call, and a wrong-but-valid URL reports itself clearly
 * as a connection error on the next request.
 */
export function normalizeBaseUrl(baseUrl?: string): string {
  const trimmed = (baseUrl ?? "").trim();
  if (!trimmed) {
    return "";
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
  } catch {
    return "";
  }

  // Trailing slashes are the most common paste error and the SDK joins paths
  // itself, so strip them rather than producing "//v1//audio".
  return trimmed.replace(/\/+$/, "");
}

export function normalizeTimeout(timeoutMs: number | undefined, fallbackMs: number): number {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return fallbackMs;
  }

  return Math.min(Math.round(timeoutMs), MAX_TIMEOUT_MS);
}

/**
 * `maxRetries: 0` is not negotiable. The app decides retries itself — rate
 * limits are never retried, they switch to the fallback model — and letting the
 * SDK retry underneath that would both double-bill and hide the reason.
 */
export function buildClientOptions(
  apiKey: string,
  settings: EndpointSettings = {},
  fallbackTimeoutMs: number = DEFAULT_TIMEOUT_MS,
): ClientOptions {
  const options: ClientOptions = {
    apiKey,
    timeout: normalizeTimeout(settings.timeoutMs, fallbackTimeoutMs),
    maxRetries: 0,
  };

  const baseUrl = normalizeBaseUrl(settings.baseUrl);
  if (baseUrl) {
    options.baseURL = baseUrl;
  }

  return options;
}

/**
 * True when calls still go to the hosted provider.
 *
 * The retired-model remap rewrites known-dead model IDs to their replacements,
 * which is right for the hosted provider and wrong everywhere else: a local
 * runner's model happening to share a name must not be silently rewritten into
 * a hosted one the user never asked for.
 */
export function isDefaultEndpoint(baseUrl?: string): boolean {
  return normalizeBaseUrl(baseUrl) === "";
}
