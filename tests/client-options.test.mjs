import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_CONTEXT_TIMEOUT_MS,
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  buildClientOptions,
  isDefaultEndpoint,
  normalizeBaseUrl,
  normalizeTimeout,
} from "../dist/llm/client-options.js";

/* ---------------------------------------------------------------- *
 * Base URLs
 * ---------------------------------------------------------------- */

test("no base URL means the hosted provider", () => {
  assert.equal(buildClientOptions("key").baseURL, undefined);
  assert.equal(buildClientOptions("key", { baseUrl: "   " }).baseURL, undefined);
});

test("a local endpoint is passed through", () => {
  assert.equal(buildClientOptions("key", { baseUrl: "http://localhost:11434/v1" }).baseURL, "http://localhost:11434/v1");
});

test("trailing slashes are stripped so paths do not double up", () => {
  assert.equal(normalizeBaseUrl("http://localhost:8080/v1///"), "http://localhost:8080/v1");
});

test("a half-typed or non-http URL falls back to the default rather than breaking every call", () => {
  // Settings saves as the user types, so a partial value must not be fatal.
  for (const bad of ["http", "not a url", "ftp://example.com", "file:///etc/passwd", "://x"]) {
    assert.equal(normalizeBaseUrl(bad), "", `${bad} should be ignored`);
  }
});

test("isDefaultEndpoint tracks whether calls still go to the hosted provider", () => {
  assert.equal(isDefaultEndpoint(""), true);
  assert.equal(isDefaultEndpoint("   "), true);
  assert.equal(isDefaultEndpoint("nonsense"), true, "an unusable URL is not a custom endpoint");
  assert.equal(isDefaultEndpoint("http://localhost:1234/v1"), false);
});

/* ---------------------------------------------------------------- *
 * Timeouts
 * ---------------------------------------------------------------- */

test("an unset or nonsense timeout uses the default", () => {
  for (const bad of [undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, "30000"]) {
    assert.equal(normalizeTimeout(bad, DEFAULT_TIMEOUT_MS), DEFAULT_TIMEOUT_MS, `${String(bad)} should fall back`);
  }
});

test("a positive timeout is honoured", () => {
  assert.equal(buildClientOptions("key", { timeoutMs: 120_000 }).timeout, 120_000);
});

test("context keeps its own shorter default", () => {
  // Context is best-effort and must never delay a dictation, so it does not
  // inherit the long ceiling a local model needs for transcription.
  const options = buildClientOptions("key", {}, DEFAULT_CONTEXT_TIMEOUT_MS);
  assert.equal(options.timeout, DEFAULT_CONTEXT_TIMEOUT_MS);
  assert.ok(DEFAULT_CONTEXT_TIMEOUT_MS < DEFAULT_TIMEOUT_MS);
});

test("an absurd timeout is capped rather than accepted", () => {
  assert.equal(normalizeTimeout(Number.MAX_SAFE_INTEGER, DEFAULT_TIMEOUT_MS), MAX_TIMEOUT_MS);
});

/* ---------------------------------------------------------------- *
 * The rule that must not drift
 * ---------------------------------------------------------------- */

test("the SDK never retries on its own", () => {
  // The app decides retries: rate limits are never retried, they switch to the
  // fallback model. An SDK retrying underneath that double-bills and hides why.
  assert.equal(buildClientOptions("key").maxRetries, 0);
  assert.equal(buildClientOptions("key", { baseUrl: "http://localhost:1/v1", timeoutMs: 5 }).maxRetries, 0);
});

test("the api key is always carried through", () => {
  assert.equal(buildClientOptions("secret", { baseUrl: "http://localhost:1/v1" }).apiKey, "secret");
});
