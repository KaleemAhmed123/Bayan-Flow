import assert from "node:assert/strict";
import test from "node:test";
import { buildRewritePrompt, MAX_REWRITE_INPUT_CHARS, REWRITE_ACTIONS } from "../dist/rewrite/rewrite-actions.js";

test("rewrite actions expose writing essentials", () => {
  assert.deepEqual(
    REWRITE_ACTIONS.map((action) => action.id),
    ["fix_grammar", "polish", "professional", "friendly", "shorten", "expand", "simplify", "custom"],
  );
});

test("rewrite prompt preserves guardrails and selected text", () => {
  const prompt = buildRewritePrompt("make this better", "professional");

  assert.match(prompt, /Preserve the user's meaning/);
  assert.match(prompt, /Do not invent/);
  assert.match(prompt, /make this better/);
});

test("custom rewrite requires instruction", () => {
  assert.throws(() => buildRewritePrompt("hello", "custom", ""), /custom rewrite instruction/i);
});

test("custom instruction can explain or transform instead of only rewriting", () => {
  const prompt = buildRewritePrompt("observer reality effect", "custom", "explain this in simple and detailed way");

  assert.match(prompt, /explain this in simple and detailed way/);
  assert.match(prompt, /explain, teach, expand, or answer/);
  assert.doesNotMatch(prompt, /Do not answer questions in the text/);
});

test("rewrite prompt rejects oversized input", () => {
  assert.throws(() => buildRewritePrompt("x".repeat(MAX_REWRITE_INPUT_CHARS + 1), "polish"), /too long/i);
});
