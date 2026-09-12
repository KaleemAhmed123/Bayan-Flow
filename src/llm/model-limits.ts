/**
 * Per-model rate limits, and the output budget that fits inside them.
 *
 * Groq enforces several ceilings at once and rejects on the FIRST one reached.
 * The one that matters here is subtle: a request is refused on the
 * `max_completion_tokens` it *declares*, before the model emits a token. So
 * asking for a generous ceiling does not buy headroom — the ceiling itself is
 * what gets rejected:
 *
 *   429 Request too large ... output tokens per minute (OTPM):
 *       Limit 1000, Requested 1079. ... reduce max_tokens
 *
 * TPM below is the combined input+output per-minute allowance from the
 * organisation limits page. Output has to share it with the prompt, so the
 * budget leaves the prompt's tokens out of the output ceiling rather than
 * letting the two add up past the limit.
 *
 * IMPORTANT: the limits page does NOT show OTPM, but OTPM is real and enforced
 * and is often far lower than TPM — 1,000 against 8,000 on the account this was
 * measured on. This table therefore cannot be the only defence; see
 * `outputLimitFromError`, which reads the true ceiling out of the rejection and
 * retries inside it.
 */

/** Tokens per minute, input and output combined. Free plan, September 2026. */
const MODEL_TOKENS_PER_MINUTE = new Map<string, number>([
  ["allam-2-7b", 6_000],
  ["groq/compound", 70_000],
  ["groq/compound-mini", 70_000],
  ["meta-llama/llama-prompt-guard-2-22m", 15_000],
  ["meta-llama/llama-prompt-guard-2-86m", 15_000],
  ["openai/gpt-oss-120b", 8_000],
  ["openai/gpt-oss-20b", 8_000],
  ["openai/gpt-oss-safeguard-20b", 8_000],
  ["qwen/qwen3.6-27b", 8_000],
  ["qwen/qwen3.8-27b", 8_000],
]);

/** Used for a model we have no row for, including any local or custom endpoint. */
export const DEFAULT_TOKENS_PER_MINUTE = 8_000;

/**
 * Fraction of the per-minute allowance a single request may claim.
 *
 * Never the whole thing: the context call, the cleanup call and a Redo can all
 * land inside the same minute, and a request that reserves the entire budget
 * starves whatever comes next.
 */
const SINGLE_REQUEST_SHARE = 0.6;

/** Below this an output ceiling is too small to be useful; fail loudly instead. */
const MIN_USABLE_OUTPUT_TOKENS = 128;

export function tokensPerMinute(model: string): number {
  return MODEL_TOKENS_PER_MINUTE.get(model.trim()) ?? DEFAULT_TOKENS_PER_MINUTE;
}

/** Rough token count. Four characters per token is the usual English estimate. */
export function estimateTokens(chars: number): number {
  return Math.ceil(Math.max(0, chars) / 4);
}

/**
 * The largest output ceiling this request may declare.
 *
 * Subtracts what the prompt will consume, because TPM counts input and output
 * together — this is the "leave space for the prompt" part. Returns at least
 * `MIN_USABLE_OUTPUT_TOKENS` so a huge prompt produces a small request that
 * fails informatively, rather than a zero or negative ceiling the API rejects
 * as malformed.
 */
export function maxDeclarableOutputTokens(model: string, promptChars: number): number {
  const budget = Math.floor(tokensPerMinute(model) * SINGLE_REQUEST_SHARE);
  const remaining = budget - estimateTokens(promptChars);
  return Math.max(MIN_USABLE_OUTPUT_TOKENS, remaining);
}

/**
 * The ceiling the provider itself named in a rejection.
 *
 * Groq spells the real limit out in the error text, which is more trustworthy
 * than any table we maintain by hand — it reflects this organisation, this
 * model, and this minute. Matches both the OTPM and TPM wordings.
 */
export function outputLimitFromError(error: unknown): number | undefined {
  const message = error instanceof Error ? error.message : "";
  if (!message) {
    return undefined;
  }

  const match = /\bLimit\s+(\d+)/i.exec(message);
  if (!match) {
    return undefined;
  }

  const limit = Number(match[1]);
  return Number.isFinite(limit) && limit > 0 ? limit : undefined;
}

/**
 * True for "your request is too big", as opposed to "you have used your quota".
 *
 * Both arrive as 429 and the difference decides the response. A quota is time:
 * wait, or move to another model. This is arithmetic: the same request will fail
 * identically in an hour, and a smaller one succeeds immediately. Treating it as
 * a quota put both models into cooldown, so one long dictation broke every
 * dictation after it until the cooldown expired.
 */
export function isRequestTooLargeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /request too large/i.test(message) || /reduce\s+max_tokens/i.test(message);
}

/** A ceiling that fits under `limit`, keeping a little room for rounding. */
export function shrinkToLimit(limit: number): number {
  return Math.max(MIN_USABLE_OUTPUT_TOKENS, Math.floor(limit * 0.9));
}
