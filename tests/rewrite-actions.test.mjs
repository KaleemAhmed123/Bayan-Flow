import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRedoInstruction,
  buildRewritePrompt,
  getDockMenuActions,
  isRewriteActionId,
  MAX_REWRITE_INPUT_CHARS,
  REWRITE_ACTIONS,
} from "../dist/rewrite/rewrite-actions.js";

test("rewrite actions expose writing essentials", () => {
  // Order is presentation, not contract: the dock renders by layer.
  assert.deepEqual(
    REWRITE_ACTIONS.map((action) => action.id).sort(),
    ["custom", "expand", "fix_grammar", "friendly", "polish", "professional", "shorten", "simplify"],
  );
});

test("the dock menu shows exactly three always-visible actions", () => {
  const actions = getDockMenuActions();
  const layerOne = actions.filter((action) => action.layer === 1);

  assert.deepEqual(
    layerOne.map((action) => action.id),
    ["polish", "professional", "shorten"],
  );
  assert.equal(actions.length, REWRITE_ACTIONS.length, "every action must reach the menu");
  assert.ok(
    actions.every((action) => action.layer === 1 || action.layer === 2),
    "every action belongs to a layer",
  );
});

test("only real action ids are accepted from the renderer", () => {
  assert.equal(isRewriteActionId("polish"), true);
  assert.equal(isRewriteActionId("__proto__"), false);
  assert.equal(isRewriteActionId(""), false);
  assert.equal(isRewriteActionId(undefined), false);
});

test("redo asks for a different phrasing each attempt", () => {
  const second = buildRedoInstruction(2);
  const third = buildRedoInstruction(3);

  assert.match(second, /different phrasing/i);
  assert.match(second, /same meaning/i);
  assert.notEqual(second, third, "repeated redos must not send an identical prompt");
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
