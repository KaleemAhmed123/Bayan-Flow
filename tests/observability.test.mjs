import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { GroqCleanupProvider } from "../dist/cleanup/groq-cleanup-provider.js";
import { ConfigStore } from "../dist/config-store.js";
import { normalizeError, setOnlineChecker } from "../dist/observability/errors.js";
import { logger } from "../dist/observability/app-logger.js";
import { FileLogSink, Logger, sanitize } from "../dist/observability/logger.js";
import { GroqRewriteProvider } from "../dist/rewrite/groq-rewrite-provider.js";

test("logger redacts sensitive fields and writes json lines", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "whispr-logs-"));
  const testLogger = new Logger([new FileLogSink(dir)]);

  await testLogger.info("test.event", {
    apiKey: "gsk_secret_value",
    transcript: "private words",
    safeCount: 3,
  });

  const raw = await readFile(path.join(dir, "app.log"), "utf8");
  const entry = JSON.parse(raw.trim());

  assert.equal(entry.event, "test.event");
  assert.equal(entry.fields.apiKey, "[redacted]");
  assert.equal(entry.fields.transcript, "[redacted]");
  assert.equal(entry.fields.safeCount, 3);
});

test("logger rotates when the active log exceeds max bytes", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "whispr-rotate-"));
  const active = path.join(dir, "app.log");
  await writeFile(active, "x".repeat(32), "utf8");

  const testLogger = new Logger([new FileLogSink(dir, { maxBytes: 8 })]);
  await testLogger.info("rotate.event");

  const current = await readFile(active, "utf8");
  assert.match(current, /rotate\.event/);
});

test("sanitize redacts likely secrets in nested data", () => {
  assert.deepEqual(sanitize({ nested: { token: "abc", value: "ok" } }), {
    nested: { token: "[redacted]", value: "ok" },
  });
});

test("normalizes retryable and non-retryable errors", () => {
  const rateLimit = Object.assign(new Error("Too many requests"), { status: 429 });
  const badRequest = Object.assign(new Error("Bad request"), { status: 400 });
  const serverError = Object.assign(new Error("Upstream blew up"), { status: 503 });
  const timeout = Object.assign(new Error("Timed out"), { code: "ETIMEDOUT" });

  // A rate limit is deliberately NOT retryable. Re-sending the same request
  // spends more quota to earn the same 429; the model fallback handles it.
  assert.equal(normalizeError("cleanup", rateLimit).retryable, false);
  assert.equal(normalizeError("cleanup", badRequest).retryable, false);
  assert.equal(normalizeError("cleanup", serverError).retryable, true);
  assert.equal(normalizeError("cleanup", timeout).retryable, true);
});

test("a rate limit reports how long to wait when the provider says", () => {
  const withHeader = Object.assign(new Error("Too many requests"), {
    status: 429,
    headers: { "retry-after": "45" },
  });

  const normalized = normalizeError("cleanup", withHeader);
  assert.equal(normalized.retryAfterSeconds, 45);
  assert.equal(normalized.userMessage, "Groq rate limit reached. Try again in 45s.");

  const longWait = Object.assign(new Error("Too many requests"), {
    status: 429,
    headers: { "retry-after": "600" },
  });
  assert.equal(normalizeError("cleanup", longWait).userMessage, "Groq rate limit reached. Try again in about 10 min.");
});

test("normalizes specific Groq user-facing errors", () => {
  assert.equal(normalizeError("transcription", Object.assign(new Error("Unauthorized"), { status: 401 })).userMessage, "Groq API key was rejected");
  assert.equal(
    normalizeError("transcription", Object.assign(new Error("Missing model"), { status: 404 })).userMessage,
    "That AI model is no longer available. Open Settings to choose another.",
  );
  assert.equal(normalizeError("transcription", Object.assign(new Error("Too large"), { status: 413 })).userMessage, "Recording is too large");
  assert.equal(normalizeError("cleanup", Object.assign(new Error("Rate limit"), { status: 429 })).userMessage, "Groq is rate limiting requests");
  assert.equal(normalizeError("cleanup", Object.assign(new Error("Offline"), { code: "ENOTFOUND" })).userMessage, "Groq is temporarily unavailable");
  assert.equal(normalizeError("recorder", new Error("microphone permission denied")).userMessage, "Microphone permission was denied");
});

test("config store falls back to defaults on invalid json", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "whispr-config-"));
  const configPath = path.join(dir, "config.json");
  await writeFile(configPath, "{bad json", "utf8");

  const config = await new ConfigStore(configPath).load();

  assert.equal(config.hotkey, "Ctrl+Shift+Space");
  assert.equal(config.cleanupEnabled, true);
});

test("groq cleanup logs token usage without content", async () => {
  const entries = [];
  logger.configure([{ write: async (entry) => entries.push(entry) }]);

  const provider = new GroqCleanupProvider("gsk_test_key", "test-model");
  provider.client = {
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: "clean text" } }],
          usage: {
            prompt_tokens: 11,
            completion_tokens: 3,
            total_tokens: 14,
          },
        }),
      },
    },
  };

  const output = await provider.clean("rough text", { mode: "default" }, { sessionId: "session-test" });

  assert.equal(output, "clean text");
  const start = entries.find((entry) => entry.event === "groq.cleanup.start");
  assert.equal(JSON.stringify(start).includes("rough text"), false);
  const success = entries.find((entry) => entry.event === "groq.cleanup.success");
  assert.equal(success.fields.usage.prompt_tokens, 11);
  assert.equal(success.fields.usage.completion_tokens, 3);
  assert.equal(success.fields.usage.total_tokens, 14);
  assert.equal(JSON.stringify(success).includes("rough text"), false);
});

test("groq rewrite logs metadata without content", async () => {
  const entries = [];
  logger.configure([{ write: async (entry) => entries.push(entry) }]);

  const provider = new GroqRewriteProvider("gsk_test_key", "test-model");
  provider.client = {
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: "professional output" } }],
          usage: {
            prompt_tokens: 20,
            completion_tokens: 4,
            total_tokens: 24,
          },
        }),
      },
    },
  };

  const output = await provider.rewrite("private selected text", { actionId: "professional" }, { sessionId: "session-test" });

  assert.equal(output, "professional output");
  const serialized = JSON.stringify(entries);
  assert.equal(serialized.includes("private selected text"), false);
  assert.equal(serialized.includes("professional output"), false);
  assert.equal(entries.some((entry) => entry.event === "groq.rewrite.success"), true);
});

/* ---------------------------------------------------------------- *
 * Offline vs slow provider
 * ---------------------------------------------------------------- */

test("a connection fault is blamed on the network only when we are offline", () => {
  const timeout = Object.assign(new Error("socket hang up"), { code: "ETIMEDOUT" });

  // Default is online, so the provider gets the blame — being wrong this way
  // shows a provider message for a network fault, which is the milder error.
  setOnlineChecker(() => true);
  assert.equal(normalizeError("transcription", timeout).userMessage, "Groq is temporarily unavailable");

  setOnlineChecker(() => false);
  assert.equal(
    normalizeError("transcription", timeout).userMessage,
    "You appear to be offline. Check your internet connection.",
  );

  setOnlineChecker(() => true);
});

test("offline failures are not retried", () => {
  // Retrying into a dead network burns the user's time for a guaranteed failure.
  const dnsFailure = Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });

  setOnlineChecker(() => true);
  assert.equal(normalizeError("transcription", dnsFailure).retryable, true);

  setOnlineChecker(() => false);
  assert.equal(normalizeError("transcription", dnsFailure).retryable, false);

  setOnlineChecker(() => true);
});

test("being offline does not change a real provider rejection", () => {
  // A 400 or 404 is the provider answering. The network was clearly fine enough
  // to carry the reply, so reachability is irrelevant.
  setOnlineChecker(() => false);
  const notFound = Object.assign(new Error("model_not_found"), { status: 404 });
  assert.match(normalizeError("cleanup", notFound).userMessage, /no longer available/);
  setOnlineChecker(() => true);
});

test("the offline dock failure offers no retry button", async () => {
  const { recoveryForFailure } = await import("../dist/overlay/overlay-state.js");
  // A retry while the network is down fails again and makes the app look broken
  // rather than the connection.
  assert.equal(recoveryForFailure("offline").action, "dismiss");
  assert.equal(recoveryForFailure("transcription").action, "retry");
});

test("redaction protects text but keeps flags and counts readable", () => {
  // `usedScreenshot: true` was being logged as "[redacted]", destroying the
  // diagnostic the field existed for. A boolean cannot carry user content.
  const cleaned = sanitize({
    usedScreenshot: true,
    screenshotDataUrl: "data:image/jpeg;base64,AAAA",
    summaryChars: 42,
    activity: "The user is replying to an email",
    windowTitle: "Inbox - Gmail",
    vocabularyTerms: 3,
  });

  assert.equal(cleaned.usedScreenshot, true);
  assert.equal(cleaned.summaryChars, 42);
  assert.equal(cleaned.vocabularyTerms, 3);
  assert.equal(cleaned.screenshotDataUrl, "[redacted]");
  assert.equal(cleaned.activity, "[redacted]");
  assert.equal(cleaned.windowTitle, "[redacted]");
});
