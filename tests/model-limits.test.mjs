import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_TOKENS_PER_MINUTE,
  estimateTokens,
  isRequestTooLargeError,
  maxDeclarableOutputTokens,
  outputLimitFromError,
  shrinkToLimit,
  tokensPerMinute,
} from "../dist/llm/model-limits.js";

/** The exact text Groq returned when a context capture was rejected. */
const REAL_REJECTION =
  '429 {"error":{"message":"Request too large for model `qwen/qwen3.6-27b` in organization ' +
  "`org_x` service tier `on_demand` on output tokens per minute (OTPM): Limit 1000, Requested 1079. " +
  "The request's expected output tokens exceed the enforced limit; reduce max_tokens (or the request's " +
  'expected output) and try again.","type":"tokens","code":"rate_limit_exceeded"}}';

test("known models carry their real per-minute allowance", () => {
  assert.equal(tokensPerMinute("openai/gpt-oss-120b"), 8_000);
  assert.equal(tokensPerMinute("openai/gpt-oss-20b"), 8_000);
  assert.equal(tokensPerMinute("qwen/qwen3.6-27b"), 8_000);
  assert.equal(tokensPerMinute("groq/compound"), 70_000);
  assert.equal(tokensPerMinute("allam-2-7b"), 6_000);
});

test("an unknown or local model falls back to the default allowance", () => {
  assert.equal(tokensPerMinute("some/model-nobody-has-heard-of"), DEFAULT_TOKENS_PER_MINUTE);
  assert.equal(tokensPerMinute(""), DEFAULT_TOKENS_PER_MINUTE);
});

test("the output ceiling leaves room for the prompt", () => {
  // Input and output share one TPM bucket, so a bigger prompt must shrink the
  // reply's ceiling rather than the two adding up past the limit.
  const small = maxDeclarableOutputTokens("openai/gpt-oss-120b", 400);
  const large = maxDeclarableOutputTokens("openai/gpt-oss-120b", 8_000);
  assert.ok(large < small, "a longer prompt must leave less room for output");

  // A five-minute dictation: ~4,200 chars of transcript plus prompt scaffolding.
  const fiveMinutes = maxDeclarableOutputTokens("openai/gpt-oss-120b", 5_000);
  assert.ok(fiveMinutes > 0);
  assert.ok(
    fiveMinutes + estimateTokens(5_000) <= 8_000,
    "prompt plus declared output must fit inside the model's TPM",
  );
});

test("a huge prompt still produces a usable ceiling, never zero or negative", () => {
  const ceiling = maxDeclarableOutputTokens("allam-2-7b", 1_000_000);
  assert.ok(ceiling > 0, "a zero or negative ceiling is rejected by the API as malformed");
});

test("the provider's stated limit is read straight out of the rejection", () => {
  assert.equal(outputLimitFromError(new Error(REAL_REJECTION)), 1000);
  assert.equal(outputLimitFromError(new Error("no numbers here")), undefined);
  assert.equal(outputLimitFromError("not an error"), undefined);
});

test("a sizing rejection is told apart from a real quota exhaustion", () => {
  // This distinction is the whole point: a quota needs time or another model, a
  // sizing error needs a smaller request and succeeds immediately.
  assert.equal(isRequestTooLargeError(new Error(REAL_REJECTION)), true);
  assert.equal(
    isRequestTooLargeError(new Error("429 Rate limit reached for model X. Please try again in 4m30s.")),
    false,
  );
  assert.equal(isRequestTooLargeError(new Error("500 internal server error")), false);
});

test("the retry ceiling fits under the limit the provider named", () => {
  const retry = shrinkToLimit(1000);
  assert.ok(retry < 1000, `must be under the stated limit, got ${retry}`);
  assert.ok(retry > 500, "but not so small the reply gets truncated");

  // Even an absurdly small limit yields something the API will accept.
  assert.ok(shrinkToLimit(1) > 0);
});
