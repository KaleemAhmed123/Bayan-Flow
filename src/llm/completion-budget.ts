/**
 * Output-token budgeting for Groq chat calls.
 *
 * Reasoning models such as `openai/gpt-oss-120b` spend tokens thinking before
 * they emit a single visible character, and those tokens are charged against
 * `max_completion_tokens`. A budget sized only for the answer therefore gets
 * consumed by the reasoning, and the reply is either cut off mid-sentence or
 * comes back empty.
 *
 * This is not theoretical. Against a budget of `inputTokens + 128` the app
 * logged `completion_tokens` landing exactly on the ceiling every time, with a
 * 327-character input rewritten down to 39 characters and a 383-character
 * transcript "cleaned" to 13.
 */

/** Never ask for less than this, even for a one-word input. */
export const MIN_OUTPUT_TOKENS = 512;
/** Ceiling, so a runaway model cannot bill indefinitely. */
export const MAX_OUTPUT_TOKENS = 4_096;

/**
 * Models whose reasoning tokens count against the completion budget.
 * Matching on the id is a heuristic, but the cost of a false positive is only a
 * larger-than-needed ceiling, which is never billed unless it is used.
 */
export function usesReasoningTokens(model: string): boolean {
  return /gpt-oss|deepseek-r1|qwen3|o[1-9](-|$)/i.test(model);
}

/**
 * `extraTokens` is the room the answer needs beyond restating its input:
 * small for a tidy-up, larger for an open-ended custom instruction.
 */
export function estimateOutputTokens(inputChars: number, model: string, extraTokens = 256): number {
  const inputTokens = Math.ceil(Math.max(0, inputChars) / 4);
  // Reasoning length scales with how much text there is to think about, plus a
  // fixed preamble the model spends before it commits to an answer.
  const reasoningHeadroom = usesReasoningTokens(model) ? inputTokens * 2 + 768 : 0;
  const wanted = inputTokens + extraTokens + reasoningHeadroom;

  return Math.min(MAX_OUTPUT_TOKENS, Math.max(MIN_OUTPUT_TOKENS, wanted));
}

/**
 * A `length` finish means the reply was cut off. Returning it would hand the
 * user a truncated sentence and call it success, which is exactly what the old
 * code did.
 */
export function isTruncated(finishReason: string | null | undefined): boolean {
  return finishReason === "length";
}

/**
 * True when the API rejected a parameter it does not recognise, rather than
 * failing for a real reason. `reasoning_effort` is not in the installed SDK's
 * types and the user can type any model id into Settings, so this is the signal
 * to retry without the optimisation instead of failing the whole request.
 */
export function isUnsupportedParameterError(error: unknown, parameter: string): boolean {
  const source = error instanceof Error ? error : undefined;
  if (!source) {
    return false;
  }

  const status = (source as unknown as Record<string, unknown>).status;
  if (status !== 400 && status !== 422) {
    return false;
  }

  const message = source.message.toLowerCase();
  return message.includes(parameter.toLowerCase()) || message.includes("unrecognized") || message.includes("unknown parameter");
}

/**
 * Runs a chat request with the reasoning hint when the model supports it, and
 * transparently retries once without it if the API rejects the parameter.
 */
/**
 * How hard the model is asked to think.
 *
 * `"none"` matters for jobs where reasoning is pure cost. Observed on
 * `qwen/qwen3.6-27b` answering "describe what this user is doing in two
 * sentences": with `"low"` it produced **5,106 characters of thinking**, hit the
 * output ceiling, and returned no answer at all. The task needs no reasoning, so
 * asking for none is both faster and the difference between an answer and
 * nothing.
 */
export type ReasoningEffort = "none" | "low" | "medium" | "high";

export async function withReasoningEffort<T>(
  model: string,
  run: (extraParams: Record<string, unknown>) => Promise<T>,
  onFallback?: () => void,
  effort: ReasoningEffort = "low",
): Promise<T> {
  if (!usesReasoningTokens(model)) {
    return run({});
  }

  try {
    return await run({ reasoning_effort: effort });
  } catch (error) {
    if (!isUnsupportedParameterError(error, "reasoning_effort")) {
      throw error;
    }

    onFallback?.();
    return run({});
  }
}

export function truncationError(model: string, maxOutputTokens: number): Error {
  return Object.assign(
    new Error(`Model ${model} ran out of output budget at ${maxOutputTokens} tokens before finishing.`),
    { code: "output_truncated" },
  );
}
