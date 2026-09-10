import assert from "node:assert/strict";
import test from "node:test";
import { GroqCleanupProvider } from "../dist/cleanup/groq-cleanup-provider.js";
import { GroqRewriteProvider } from "../dist/rewrite/groq-rewrite-provider.js";
import { ModelCooldownManager } from "../dist/llm/model-cooldown.js";
import { isRetryableError } from "../dist/observability/errors.js";

function createCooldown() {
  let stored = {};
  return new ModelCooldownManager({
    read: () => ({ ...stored }),
    write: (entries) => {
      stored = { ...entries };
    },
  });
}

function rateLimitError(headers = { "retry-after": "30" }) {
  return Object.assign(new Error("rate limited"), { status: 429, headers });
}

/**
 * Replaces the provider's SDK client with a stub that records the model on each
 * call and returns whatever the script says for that attempt.
 */
function stubClient(provider, respond) {
  const models = [];
  provider.client = {
    chat: {
      completions: {
        create: async (request) => {
          models.push(request.model);
          return respond(request, models.length);
        },
      },
    },
  };

  return models;
}

const ok = (text) => ({ choices: [{ message: { content: text }, finish_reason: "stop" }], usage: {} });

test("a rate limit is not retried against the same model", () => {
  // Re-sending an identical request after a 429 spends more quota to earn the
  // same 429. The fallback model handles it instead.
  assert.equal(isRetryableError(rateLimitError()), false);
  assert.equal(isRetryableError(Object.assign(new Error("boom"), { status: 503 })), true);
});

test("the primary model is used when nothing is wrong", async () => {
  const provider = new GroqCleanupProvider("gsk_test", "primary", "fallback", createCooldown());
  const models = stubClient(provider, () => ok("clean text"));

  const result = await provider.clean("raw text", { mode: "default" });

  assert.equal(result, "clean text");
  assert.deepEqual(models, ["primary"]);
});

test("a rate-limited primary falls back to the backup model", async () => {
  const cooldown = createCooldown();
  const provider = new GroqCleanupProvider("gsk_test", "primary", "fallback", cooldown);
  const models = stubClient(provider, (_request, attempt) => {
    if (attempt === 1) {
      throw rateLimitError();
    }

    return ok("clean text");
  });

  const result = await provider.clean("raw text", { mode: "default" });

  assert.equal(result, "clean text");
  assert.deepEqual(models, ["primary", "fallback"]);
  // The limit must be remembered, or the next dictation rediscovers it.
  assert.equal(cooldown.isInCooldown("primary"), true);
  assert.equal(cooldown.isInCooldown("fallback"), false);
});

test("a known rate-limited primary is skipped without a request", async () => {
  const cooldown = createCooldown();
  cooldown.setCooldown("primary", 120);

  const provider = new GroqCleanupProvider("gsk_test", "primary", "fallback", cooldown);
  const models = stubClient(provider, () => ok("clean text"));

  await provider.clean("raw text", { mode: "default" });

  assert.deepEqual(models, ["fallback"], "the doomed request should never be sent");
});

test("both models cooling down fails immediately with a wait time", async () => {
  const cooldown = createCooldown();
  cooldown.setCooldown("primary", 300);
  cooldown.setCooldown("fallback", 300);

  const provider = new GroqCleanupProvider("gsk_test", "primary", "fallback", cooldown);
  const models = stubClient(provider, () => ok("clean text"));

  await assert.rejects(
    () => provider.clean("raw text", { mode: "default" }),
    (error) => {
      assert.equal(error.code, "all_models_rate_limited");
      assert.match(error.message, /Try again in about 5 min/);
      return true;
    },
  );

  assert.deepEqual(models, [], "no request should be sent when everything is cooling down");
});

test("with no fallback configured the original error surfaces", async () => {
  const provider = new GroqCleanupProvider("gsk_test", "primary", "", createCooldown());
  stubClient(provider, () => {
    throw rateLimitError();
  });

  await assert.rejects(() => provider.clean("raw text", { mode: "default" }), /rate limited/);
});

test("a dead model id also triggers the fallback, not just a rate limit", async () => {
  // A retired model answers 404 model_not_found. That is not retryable, but it
  // is exactly the case a backup model exists for.
  const provider = new GroqCleanupProvider("gsk_test", "primary", "fallback", createCooldown());
  const models = stubClient(provider, (_request, attempt) => {
    if (attempt === 1) {
      throw Object.assign(new Error("model_not_found"), { status: 404 });
    }

    return ok("clean text");
  });

  assert.equal(await provider.clean("raw text", { mode: "default" }), "clean text");
  assert.deepEqual(models, ["primary", "fallback"]);
});

test("vocabulary and output language reach the prompt", async () => {
  const provider = new GroqCleanupProvider("gsk_test", "primary", "", createCooldown());
  let prompt = "";
  provider.client = {
    chat: {
      completions: {
        create: async (request) => {
          prompt = request.messages[1].content;
          return ok("clean text");
        },
      },
    },
  };

  await provider.clean("raw text", {
    mode: "default",
    vocabulary: ["Aysha", "Zubair"],
    outputLanguage: "en",
  });

  assert.match(prompt, /Aysha, Zubair/);
  assert.match(prompt, /NEVER insert a term from this list/);
  assert.match(prompt, /translate the result into language code "en"/);
});

/* ---------------------------------------------------------------- *
 * Rewrite shares the same fallback machinery
 * ---------------------------------------------------------------- */

test("rewrite falls back to the backup model and records the limit", async () => {
  const cooldown = createCooldown();
  const provider = new GroqRewriteProvider("gsk_test", "primary", "fallback", cooldown);
  const models = stubClient(provider, (_request, attempt) => {
    if (attempt === 1) {
      throw rateLimitError();
    }

    return ok("rewritten text");
  });

  const result = await provider.rewrite("rough text", { actionId: "polish" });

  assert.equal(result, "rewritten text");
  assert.deepEqual(models, ["primary", "fallback"]);
  assert.equal(cooldown.isInCooldown("primary"), true);
});

test("rewrite passes vocabulary through to the prompt", async () => {
  const provider = new GroqRewriteProvider("gsk_test", "primary", "", createCooldown());
  let prompt = "";
  provider.client = {
    chat: {
      completions: {
        create: async (request) => {
          prompt = request.messages[1].content;
          return ok("rewritten text");
        },
      },
    },
  };

  await provider.rewrite("hi aisha", { actionId: "polish", vocabulary: ["Ayesha"] });
  assert.match(prompt, /Ayesha/);
});
