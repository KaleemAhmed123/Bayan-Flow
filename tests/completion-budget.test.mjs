import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_OUTPUT_TOKENS,
  MIN_OUTPUT_TOKENS,
  estimateOutputTokens,
  isTruncated,
  usesReasoningTokens,
  truncationError,
  isUnsupportedParameterError,
  withReasoningEffort,
} from "../dist/llm/completion-budget.js";

const REASONING = "openai/gpt-oss-120b";
const PLAIN = "llama-3.1-8b-instant";

test("knows which models bill their thinking against the output budget", () => {
  assert.equal(usesReasoningTokens(REASONING), true);
  assert.equal(usesReasoningTokens("openai/gpt-oss-20b"), true);
  assert.equal(usesReasoningTokens("deepseek-r1-distill-llama-70b"), true);
  assert.equal(usesReasoningTokens(PLAIN), false);
  assert.equal(usesReasoningTokens("whisper-large-v3"), false);
});

test("a reasoning model gets far more than the old answer-only budget", () => {
  // The exact failure from the logs: a 327-character input was given
  // ceil(327/4) + 128 = 210 tokens, the model spent all 210 thinking, and the
  // rewrite came back as a 39-character fragment.
  const oldBudget = Math.ceil(327 / 4) + 128;
  assert.equal(oldBudget, 210, "guards the arithmetic this test is built on");

  const budget = estimateOutputTokens(327, REASONING);
  assert.ok(budget > oldBudget * 4, `expected room to think, got ${budget}`);
});

test("reasoning models are budgeted higher than plain ones for the same input", () => {
  assert.ok(estimateOutputTokens(1000, REASONING) > estimateOutputTokens(1000, PLAIN));
});

test("even a one-word input gets a usable floor", () => {
  assert.equal(estimateOutputTokens(1, REASONING) >= MIN_OUTPUT_TOKENS, true);
  assert.equal(estimateOutputTokens(0, PLAIN) >= MIN_OUTPUT_TOKENS, true);
});

test("a runaway input cannot ask for an unbounded budget", () => {
  assert.equal(estimateOutputTokens(10_000_000, REASONING), MAX_OUTPUT_TOKENS);
});

test("an open-ended instruction gets more room than a tidy-up", () => {
  assert.ok(estimateOutputTokens(4000, PLAIN, 1024) > estimateOutputTokens(4000, PLAIN, 256));
});

test("a length finish is treated as truncation, anything else is not", () => {
  assert.equal(isTruncated("length"), true);
  assert.equal(isTruncated("stop"), false);
  assert.equal(isTruncated(null), false);
  assert.equal(isTruncated(undefined), false);
});

test("the truncation error names the model and the ceiling it hit", () => {
  const error = truncationError(REASONING, 210);
  assert.match(error.message, /openai\/gpt-oss-120b/);
  assert.match(error.message, /210/);
  assert.equal(error.code, "output_truncated");
});

test("only a rejected-parameter 400 counts as unsupported", () => {
  const rejected = Object.assign(new Error('400 unknown parameter: reasoning_effort'), { status: 400 });
  assert.equal(isUnsupportedParameterError(rejected, "reasoning_effort"), true);

  const rateLimited = Object.assign(new Error("429 too many requests"), { status: 429 });
  assert.equal(isUnsupportedParameterError(rateLimited, "reasoning_effort"), false);

  const badKey = Object.assign(new Error("401 invalid api key"), { status: 401 });
  assert.equal(isUnsupportedParameterError(badKey, "reasoning_effort"), false);
  assert.equal(isUnsupportedParameterError("not an error", "reasoning_effort"), false);
});

test("the reasoning hint is sent to reasoning models and skipped for others", async () => {
  const seen = [];
  await withReasoningEffort("openai/gpt-oss-120b", async (extra) => seen.push(extra));
  await withReasoningEffort("llama-3.1-8b-instant", async (extra) => seen.push(extra));

  assert.deepEqual(seen[0], { reasoning_effort: "low" });
  assert.deepEqual(seen[1], {}, "a plain model must not receive the hint");
});

test("a rejected reasoning hint retries once without it instead of failing", async () => {
  const attempts = [];
  let fellBack = false;

  const result = await withReasoningEffort(
    "openai/gpt-oss-120b",
    async (extra) => {
      attempts.push(extra);
      if (Object.keys(extra).length > 0) {
        throw Object.assign(new Error("400 unknown parameter: reasoning_effort"), { status: 400 });
      }

      return "ok";
    },
    () => {
      fellBack = true;
    },
  );

  assert.equal(result, "ok");
  assert.equal(attempts.length, 2);
  assert.deepEqual(attempts[1], {});
  assert.equal(fellBack, true);
});

test("a real failure is not swallowed by the reasoning fallback", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withReasoningEffort("openai/gpt-oss-120b", async () => {
        calls += 1;
        throw Object.assign(new Error("401 invalid api key"), { status: 401 });
      }),
    /invalid api key/,
  );
  assert.equal(calls, 1, "must not retry a genuine error");
});

test("reasoning headroom is not reserved when reasoning is switched off", () => {
  // The real failure: the context call sends reasoning_effort "none" and uses
  // 60-68 output tokens, but the budget reserved 840 for thinking and declared
  // max_completion_tokens 1076. Groq rejects a request whose declared ceiling
  // exceeds the free tier's 1000 output-tokens-per-minute allowance, before the
  // model runs — so 16 of 59 context captures died on
  // "429 Request too large ... Limit 1000, Requested 1079".
  const contextPromptChars = 144;
  const withReasoning = estimateOutputTokens(contextPromptChars, "qwen/qwen3.6-27b", 200, "low");
  const withoutReasoning = estimateOutputTokens(contextPromptChars, "qwen/qwen3.6-27b", 200, "none");

  assert.equal(withReasoning, 1076, "the old behaviour, still correct when the model really thinks");
  assert.ok(withoutReasoning < 1000, `must fit under the free-tier OTPM limit, got ${withoutReasoning}`);
  assert.ok(withoutReasoning < withReasoning);
});

test("output budget still defaults to reserving reasoning headroom", () => {
  // Cleanup and rewrite do reason, and shrinking their ceiling is what caused
  // replies to be cut off mid-sentence. Only an explicit "none" opts out.
  const base = estimateOutputTokens(2000, "openai/gpt-oss-120b", 256);
  assert.equal(base, estimateOutputTokens(2000, "openai/gpt-oss-120b", 256, "low"));
  assert.ok(base > estimateOutputTokens(2000, "openai/gpt-oss-120b", 256, "none"));
});

test("a non-reasoning model is unaffected by the effort argument", () => {
  const model = "whisper-large-v3";
  assert.equal(
    estimateOutputTokens(500, model, 256, "low"),
    estimateOutputTokens(500, model, 256, "none"),
  );
});
