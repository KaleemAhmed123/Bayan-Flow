import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { GroqCleanupProvider } from "../dist/cleanup/groq-cleanup-provider.js";
import { ConfigStore } from "../dist/config-store.js";
import { normalizeError } from "../dist/observability/errors.js";
import { logger } from "../dist/observability/app-logger.js";
import { FileLogSink, Logger, sanitize } from "../dist/observability/logger.js";

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

  assert.equal(normalizeError("cleanup", rateLimit).retryable, true);
  assert.equal(normalizeError("cleanup", badRequest).retryable, false);
});

test("normalizes specific Groq user-facing errors", () => {
  assert.equal(normalizeError("transcription", Object.assign(new Error("Unauthorized"), { status: 401 })).userMessage, "Groq API key was rejected");
  assert.equal(normalizeError("transcription", Object.assign(new Error("Missing model"), { status: 404 })).userMessage, "Groq model or request is invalid");
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
