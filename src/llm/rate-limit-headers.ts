/**
 * Reading a provider's 429 response headers.
 *
 * Deliberately free of Electron and filesystem imports so both the error layer
 * and the cooldown store can use it, and so it is testable on its own.
 */

/** Used when a 429 arrives with no parseable timing header. */
export const DEFAULT_REPROBE_SECONDS = 60;

export type RateLimitCooldown = {
  seconds: number;
  /** True when the signal was an exhausted daily request quota, not a per-minute bucket. */
  isDaily: boolean;
};

export type HeaderSource = { get(name: string): string | null } | Record<string, unknown> | undefined | null;

export function readHeader(headers: HeaderSource, name: string): string | undefined {
  if (!headers) {
    return undefined;
  }

  if (typeof (headers as { get?: unknown }).get === "function") {
    return (headers as { get(name: string): string | null }).get(name) ?? undefined;
  }

  // Header names are case-insensitive; a plain object from an SDK may use any casing.
  const record = headers as Record<string, unknown>;
  const match = Object.keys(record).find((key) => key.toLowerCase() === name);
  const value = match ? record[match] : undefined;
  return typeof value === "string" ? value : undefined;
}

/**
 * Parses a provider duration string into seconds.
 *
 * Accepts bare seconds ("2", "7.66"), a single suffixed unit ("7.66s", "120ms"),
 * and compound forms ("2m59.56s", "1h0m0s", "1h2m3.5s").
 *
 * Returns null for anything else. That strictness is the point: a malformed
 * header must never produce a negative, infinite, or NaN cooldown, because a
 * negative one spins and an infinite one disables the model permanently.
 */
export function parseRateLimitDuration(value: string | undefined): number | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  // A bare number is plain seconds, covering the integer `retry-after` form.
  // Number() also accepts "NaN", "Infinity", "-3" and "0x10", so check the result.
  const bare = Number(trimmed);
  if (!Number.isNaN(bare)) {
    return Number.isFinite(bare) && bare >= 0 ? bare : null;
  }

  let total = 0;
  let digits = "";
  let matchedAnyUnit = false;
  let index = 0;

  while (index < trimmed.length) {
    const character = trimmed[index] as string;
    if (/[0-9.]/.test(character)) {
      digits += character;
      index += 1;
      continue;
    }

    const amount = Number(digits);
    if (!digits || Number.isNaN(amount)) {
      return null;
    }

    digits = "";
    // "ms" must be tested before the single-letter "m" and "s".
    if (trimmed.startsWith("ms", index)) {
      total += amount / 1_000;
      index += 2;
    } else if (character === "h") {
      total += amount * 3_600;
      index += 1;
    } else if (character === "m") {
      total += amount * 60;
      index += 1;
    } else if (character === "s") {
      total += amount;
      index += 1;
    } else {
      return null;
    }

    matchedAnyUnit = true;
  }

  // Rejects a trailing number with no unit ("1h30") and unit-less input.
  if (digits || !matchedAnyUnit) {
    return null;
  }

  return Number.isFinite(total) && total >= 0 ? total : null;
}

/**
 * Works out how long a model must cool down, and whether the limit is a daily one.
 *
 * Order matters. The daily-quota check runs FIRST because providers usually send
 * `retry-after` alongside it; honouring that first would classify a short
 * near-reset daily window as a per-minute limit and fail to persist it.
 */
export function rateLimitCooldownFromHeaders(headers: HeaderSource): RateLimitCooldown {
  const remainingRequests = Number(readHeader(headers, "x-ratelimit-remaining-requests"));
  if (Number.isFinite(remainingRequests) && remainingRequests <= 0) {
    const dailyReset = parseRateLimitDuration(readHeader(headers, "x-ratelimit-reset-requests"));
    if (dailyReset !== null) {
      return { seconds: dailyReset, isDaily: true };
    }
  }

  // The authoritative wait a provider sets specifically on a 429.
  const retryAfter = parseRateLimitDuration(readHeader(headers, "retry-after"));
  if (retryAfter !== null) {
    return { seconds: retryAfter, isDaily: false };
  }

  // The per-minute token bucket reset, e.g. "7.66s".
  const tokenReset = parseRateLimitDuration(readHeader(headers, "x-ratelimit-reset-tokens"));
  if (tokenReset !== null) {
    return { seconds: tokenReset, isDaily: false };
  }

  return { seconds: DEFAULT_REPROBE_SECONDS, isDaily: false };
}

/** Pulls the header bag off an SDK error, whatever shape it arrived in. */
export function headersFromError(error: unknown): HeaderSource {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const candidate = (error as { headers?: unknown; response?: { headers?: unknown } }).headers
    ?? (error as { response?: { headers?: unknown } }).response?.headers;

  return (candidate ?? undefined) as HeaderSource;
}
