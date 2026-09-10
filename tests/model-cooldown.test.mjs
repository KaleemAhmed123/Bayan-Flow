import assert from "node:assert/strict";
import test from "node:test";
import {
  parseRateLimitDuration,
  rateLimitCooldownFromHeaders,
  headersFromError,
} from "../dist/llm/rate-limit-headers.js";
import { ModelCooldownManager } from "../dist/llm/model-cooldown.js";

/* ---------------------------------------------------------------- *
 * Duration parsing
 * ---------------------------------------------------------------- */

test("parseRateLimitDuration reads every shape a provider sends", () => {
  assert.equal(parseRateLimitDuration("2"), 2);
  assert.equal(parseRateLimitDuration("7.66"), 7.66);
  assert.equal(parseRateLimitDuration("7.66s"), 7.66);
  assert.equal(parseRateLimitDuration("120ms"), 0.12);
  assert.equal(parseRateLimitDuration("2m59.56s"), 179.56);
  assert.equal(parseRateLimitDuration("1h0m0s"), 3600);
  assert.equal(parseRateLimitDuration("1h2m3.5s"), 3723.5);
});

test("parseRateLimitDuration refuses anything that could produce a bad cooldown", () => {
  // A negative wait spins; an infinite one disables the model forever. Both are
  // worse than having no cooldown at all, so malformed input yields null.
  for (const bad of ["", "   ", undefined, "-3", "NaN", "Infinity", "-Infinity", "1h30", "5x", "abc", "s"]) {
    assert.equal(parseRateLimitDuration(bad), null, `expected ${JSON.stringify(bad)} to be rejected`);
  }
});

/* ---------------------------------------------------------------- *
 * Header interpretation
 * ---------------------------------------------------------------- */

test("an exhausted daily quota wins over retry-after", () => {
  // Providers send retry-after alongside the daily reset. Reading retry-after
  // first would misfile a short near-reset daily window as a per-minute limit
  // and lose it on restart.
  const cooldown = rateLimitCooldownFromHeaders({
    "retry-after": "2",
    "x-ratelimit-remaining-requests": "0",
    "x-ratelimit-reset-requests": "7m30s",
  });

  assert.deepEqual(cooldown, { seconds: 450, isDaily: true });
});

test("retry-after is used when the daily quota is not spent", () => {
  const cooldown = rateLimitCooldownFromHeaders({
    "retry-after": "12",
    "x-ratelimit-remaining-requests": "58",
    "x-ratelimit-reset-tokens": "7.66s",
  });

  assert.deepEqual(cooldown, { seconds: 12, isDaily: false });
});

test("the per-minute token reset is the last real signal", () => {
  const cooldown = rateLimitCooldownFromHeaders({ "x-ratelimit-reset-tokens": "7.66s" });
  assert.deepEqual(cooldown, { seconds: 7.66, isDaily: false });
});

test("no usable header falls back to a short re-probe, not a long block", () => {
  const cooldown = rateLimitCooldownFromHeaders({});
  assert.equal(cooldown.isDaily, false);
  assert.ok(cooldown.seconds > 0 && cooldown.seconds < 3600);
});

test("headers are read case-insensitively and from Headers objects", () => {
  assert.equal(rateLimitCooldownFromHeaders({ "Retry-After": "9" }).seconds, 9);
  assert.equal(rateLimitCooldownFromHeaders(new Headers({ "retry-after": "9" })).seconds, 9);
});

test("headersFromError digs the bag out of either SDK error shape", () => {
  assert.equal(headersFromError({ headers: { "retry-after": "3" } })["retry-after"], "3");
  assert.equal(headersFromError({ response: { headers: { "retry-after": "3" } } })["retry-after"], "3");
  assert.equal(headersFromError(null), undefined);
  assert.equal(headersFromError(new Error("plain")), undefined);
});

/* ---------------------------------------------------------------- *
 * The store
 * ---------------------------------------------------------------- */

function createManager(initial = {}) {
  let stored = { ...initial };
  const manager = new ModelCooldownManager({
    read: () => ({ ...stored }),
    write: (entries) => {
      stored = { ...entries };
    },
  });

  return { manager, getStored: () => stored };
}

test("a per-minute limit stays in memory and is not written to disk", () => {
  const { manager, getStored } = createManager();
  manager.setCooldown("model-a", 30);

  assert.equal(manager.isInCooldown("model-a"), true);
  assert.deepEqual(getStored(), {}, "short limits must not touch disk");
});

test("a daily limit is persisted so it survives a restart", () => {
  const { manager, getStored } = createManager();
  manager.setCooldown("model-a", 7200);

  assert.equal(manager.isInCooldown("model-a"), true);
  assert.ok(getStored()["model-a"] > Date.now(), "daily limits must be written to disk");
});

test("a short daily quota is still persisted when flagged", () => {
  // A daily quota resetting in 20 minutes is still a daily quota. Without the
  // explicit flag it would be filed as per-minute and lost on restart.
  const { manager, getStored } = createManager();
  manager.setCooldown("model-a", 1200, { persist: true });

  assert.ok(getStored()["model-a"] > Date.now());
});

test("an expired persisted cooldown is cleared on read", () => {
  const { manager, getStored } = createManager({ "model-a": Date.now() - 1000 });

  assert.equal(manager.isInCooldown("model-a"), false);
  assert.deepEqual(getStored(), {}, "expired entries should not linger on disk");
});

test("a nonsensical cooldown is ignored rather than applied", () => {
  const { manager } = createManager();
  for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    manager.setCooldown("model-a", bad);
    assert.equal(manager.isInCooldown("model-a"), false, `expected ${bad} to be ignored`);
  }
});

test("effectiveModel routes around a rate-limited primary", () => {
  const { manager } = createManager();
  assert.equal(manager.effectiveModel("primary", "fallback"), "primary");

  manager.setCooldown("primary", 60);
  assert.equal(manager.effectiveModel("primary", "fallback"), "fallback");
});

test("effectiveModel returns null when everything is cooling down", () => {
  // This is the whole point: the caller can skip a request it already knows
  // will be rejected, instead of paying a round trip to be told so.
  const { manager } = createManager();
  manager.setCooldown("primary", 60);
  manager.setCooldown("fallback", 60);

  assert.equal(manager.effectiveModel("primary", "fallback"), null);
  assert.equal(manager.effectiveModel("primary"), null);
  assert.equal(manager.effectiveModel("primary", "  "), null);
  assert.equal(manager.effectiveModel("primary", "primary"), null, "a fallback equal to the primary is no fallback");
});

test("noteRateLimit records what the response headers asked for", () => {
  const { manager, getStored } = createManager();

  const cooldown = manager.noteRateLimit("model-a", {
    "x-ratelimit-remaining-requests": "0",
    "x-ratelimit-reset-requests": "2h",
  });

  assert.deepEqual(cooldown, { seconds: 7200, isDaily: true });
  assert.equal(manager.isInCooldown("model-a"), true);
  assert.ok(getStored()["model-a"] > Date.now());
});

test("clear wipes memory and disk together", () => {
  const { manager, getStored } = createManager();
  manager.setCooldown("model-a", 30);
  manager.setCooldown("model-b", 7200);

  manager.clear();

  assert.equal(manager.isInCooldown("model-a"), false);
  assert.equal(manager.isInCooldown("model-b"), false);
  assert.deepEqual(getStored(), {});
});
