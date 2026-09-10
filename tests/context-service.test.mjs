import assert from "node:assert/strict";
import test from "node:test";
import { AppContextService } from "../dist/context/context-service.js";
import { DEFAULT_CONTEXT_BLOCKLIST } from "../dist/context/context-rules.js";

const SETTINGS = {
  enabled: true,
  screenshotEnabled: false,
  model: "qwen/qwen3.6-27b",
  blocklist: DEFAULT_CONTEXT_BLOCKLIST,
  apiKey: "gsk_test",
};

/** A stub chat client that answers with `content` after `delayMs`. */
function stubClient(content, delayMs = 0) {
  const requests = [];
  return {
    requests,
    factory: () => ({
      chat: {
        completions: {
          create: async (request) => {
            requests.push(request);
            if (delayMs) {
              await new Promise((resolve) => setTimeout(resolve, delayMs));
            }

            return { choices: [{ message: { content } }] };
          },
        },
      },
    }),
  };
}

const window = (title) => async () => ({ title, appName: "Google Chrome" });

test("capture disabled yields no context and never calls the model", async () => {
  const client = stubClient("should not happen");
  const service = new AppContextService(window("Inbox - Gmail - Google Chrome"), client.factory);

  service.start({ ...SETTINGS, enabled: false });
  const result = await service.result();

  assert.equal(result.windowTitle, "");
  assert.equal(result.reason, "disabled");
  assert.equal(client.requests.length, 0);
});

test("a blocked window yields nothing at all, not even the title", async () => {
  // Stricter than "skip the screenshot": "Chase Bank - Accounts" is sensitive on
  // its own, so a blocked window contributes no context whatsoever.
  const client = stubClient("should not happen");
  const service = new AppContextService(window("Chase Bank - Accounts"), client.factory);

  service.start(SETTINGS);
  const result = await service.result();

  assert.equal(result.blocked, true);
  assert.equal(result.windowTitle, "");
  assert.equal(result.appName, "");
  assert.equal(result.activity, "");
  assert.equal(client.requests.length, 0, "a blocked window must never reach the provider");
});

test("an allowed window produces metadata plus a summary", async () => {
  const client = stubClient("The user is replying to an email. They are writing to Ayesha about the budget.");
  const service = new AppContextService(window("Inbox (3) - Gmail - Google Chrome"), client.factory);

  service.start(SETTINGS);
  const result = await service.result(5_000);

  assert.equal(result.windowTitle, "Inbox (3) - Gmail - Google Chrome");
  assert.equal(result.appName, "Google Chrome");
  assert.match(result.activity, /replying to an email/);
  assert.equal(result.blocked, false);
  assert.equal(result.usedScreenshot, false);
});

test("a slow summary falls back to metadata instead of stalling the dictation", async () => {
  // The user is waiting on their own words. Partial context still fixes
  // spellings; a stalled paste helps nobody.
  const client = stubClient("too late to matter", 3_000);
  const service = new AppContextService(window("auth.ts - Visual Studio Code"), client.factory);

  service.start(SETTINGS);
  const startedAt = Date.now();
  const result = await service.result(150);

  assert.ok(Date.now() - startedAt < 1_000, "result must not wait for a slow model");
  assert.equal(result.windowTitle, "auth.ts - Visual Studio Code");
  assert.equal(result.activity, "", "the summary is dropped, the metadata is kept");
  assert.equal(result.reason, "timed_out");
});

test("a failing model degrades to metadata rather than failing", async () => {
  const service = new AppContextService(window("Notes - Notion"), () => ({
    chat: {
      completions: {
        create: async () => {
          throw new Error("provider exploded");
        },
      },
    },
  }));

  service.start(SETTINGS);
  const result = await service.result(5_000);

  assert.equal(result.windowTitle, "Notes - Notion");
  assert.equal(result.activity, "");
  assert.equal(result.blocked, false);
});

test("no API key means metadata only, with no request attempted", async () => {
  const client = stubClient("should not happen");
  const service = new AppContextService(window("Notes - Notion"), client.factory);

  service.start({ ...SETTINGS, apiKey: "" });
  const result = await service.result(5_000);

  assert.equal(result.windowTitle, "Notes - Notion");
  assert.equal(result.reason, "no_api_key");
  assert.equal(client.requests.length, 0);
});

test("a failing window lookup does not throw", async () => {
  const client = stubClient("nope");
  const service = new AppContextService(async () => {
    throw new Error("no active window");
  }, client.factory);

  service.start(SETTINGS);
  const result = await service.result(5_000);

  // No title means nothing to reason about, which the blocklist treats as blocked.
  assert.equal(result.blocked, true);
});

test("cancelling drops everything captured so far", async () => {
  const client = stubClient("some summary");
  const service = new AppContextService(window("Notes - Notion"), client.factory);

  service.start(SETTINGS);
  service.cancel();
  const result = await service.result();

  assert.equal(result.windowTitle, "");
  assert.equal(result.activity, "");
});

test("the screenshot is only requested when the setting is on", async () => {
  // desktopCapturer is unavailable outside Electron, so this asserts the guard
  // in front of it rather than the capture itself: with the toggle off the
  // screenshot path is never entered and the run completes normally.
  const client = stubClient("Working in an editor. Writing TypeScript.");
  const service = new AppContextService(window("auth.ts - Visual Studio Code"), client.factory);

  service.start({ ...SETTINGS, screenshotEnabled: false });
  const result = await service.result(5_000);

  assert.equal(result.usedScreenshot, false);
  assert.match(result.activity, /Working in an editor/);
});

test("the inference prompt carries the window signals and no image", async () => {
  const client = stubClient("Editing code. Writing a function.");
  const service = new AppContextService(window("auth.ts - Visual Studio Code"), client.factory);

  service.start(SETTINGS);
  await service.result(5_000);

  const [request] = client.requests;
  assert.equal(request.model, "qwen/qwen3.6-27b");
  assert.equal(typeof request.messages[1].content, "string", "no image means a plain text message");
  assert.match(request.messages[1].content, /auth\.ts - Visual Studio Code/);
  assert.match(request.messages[0].content, /NAMES:/);
  assert.match(request.messages[0].content, /Copy each name EXACTLY/);
});

/* ---------------------------------------------------------------- *
 * Matching the focused window to a capture source
 * ---------------------------------------------------------------- */

test("the capture source is matched exactly when it can be", async () => {
  const { findWindowSource } = await import("../dist/context/context-service.js");
  const sources = [{ name: "Slack" }, { name: "Test Script BayanFlow - Gmail" }];

  assert.equal(findWindowSource(sources, "Test Script BayanFlow - Gmail").name, "Test Script BayanFlow - Gmail");
});

test("casing and stray whitespace do not break the match", async () => {
  // The title and the source name come from different APIs and routinely
  // disagree on both. Exact-only matching made screenshots look broken.
  const { findWindowSource } = await import("../dist/context/context-service.js");

  assert.equal(findWindowSource([{ name: "  Gmail - Google Chrome " }], "Gmail - Google Chrome").name.trim(), "Gmail - Google Chrome");
  assert.equal(findWindowSource([{ name: "gmail - google chrome" }], "Gmail - Google Chrome").name, "gmail - google chrome");
});

test("a truncated title still matches its source", async () => {
  const { findWindowSource } = await import("../dist/context/context-service.js");
  const sources = [{ name: "Test Script BayanFlow - ayeesha@allenhouse.ac.in - Gmail" }];

  assert.ok(findWindowSource(sources, "Test Script BayanFlow - ayeesha@allenhouse"));
});

test("an ambiguous match captures nothing rather than the wrong window", async () => {
  // Two candidates share the prefix. Guessing could screenshot someone else's
  // window, so the correct answer is no screenshot at all.
  const { findWindowSource } = await import("../dist/context/context-service.js");
  const sources = [{ name: "Inbox - Gmail" }, { name: "Inbox - Gmail (2)" }];

  assert.equal(findWindowSource(sources, "Inbox"), undefined);
});

test("no title means no source", async () => {
  const { findWindowSource } = await import("../dist/context/context-service.js");
  assert.equal(findWindowSource([{ name: "Slack" }], ""), undefined);
  assert.equal(findWindowSource([], "Slack"), undefined);
});

/* ---------------------------------------------------------------- *
 * Output budget — the bug that made every summary come back empty
 * ---------------------------------------------------------------- */

test("the context model gets a budget that survives its own reasoning", async () => {
  // The default context model is a reasoning model: it spends tokens thinking
  // BEFORE emitting a character, charged against the same ceiling. A hardcoded
  // 300 was consumed entirely by reasoning, the truncated think-block was
  // stripped, and every summary came back as "" with nothing looking broken.
  const client = stubClient("Writing an email. Replying to Ayesha.");
  const service = new AppContextService(window("Inbox - Gmail - Google Chrome"), client.factory);

  service.start(SETTINGS);
  await service.result(5_000);

  const [request] = client.requests;
  assert.ok(
    request.max_completion_tokens > 300,
    `reasoning models need headroom, got ${request.max_completion_tokens}`,
  );
});

test("a reasoning model is told not to think at all", async () => {
  const client = stubClient("Writing an email. Replying to Ayesha.");
  const service = new AppContextService(window("Inbox - Gmail - Google Chrome"), client.factory);

  service.start(SETTINGS);
  await service.result(5_000);

  // Not "low": describing a window needs no reasoning, and on this model "low"
  // spent the whole output budget thinking and returned nothing at all.
  assert.equal(client.requests[0].reasoning_effort, "none");
});

test("an empty summary degrades to metadata without failing", async () => {
  const client = stubClient("");
  const service = new AppContextService(window("Inbox - Gmail - Google Chrome"), client.factory);

  service.start(SETTINGS);
  const result = await service.result(5_000);

  assert.equal(result.activity, "");
  assert.equal(result.windowTitle, "Inbox - Gmail - Google Chrome");
  assert.equal(result.reason, "no_summary");
});
