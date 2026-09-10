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
  // Order is presentation, not contract: the dock renders them in one grid.
  assert.deepEqual(
    REWRITE_ACTIONS.map((action) => action.id).sort(),
    ["custom", "expand", "fix_grammar", "friendly", "polish", "professional", "shorten", "simplify"],
  );
});

test("the dock menu shows every action with no hidden layer", () => {
  const actions = getDockMenuActions();

  assert.equal(actions.length, REWRITE_ACTIONS.length, "every action must reach the menu");
  assert.deepEqual(
    actions.map((action) => action.id),
    REWRITE_ACTIONS.map((action) => action.id),
    "the menu keeps the declared order",
  );
  assert.ok(
    actions.every((action) => Object.keys(action).join(",") === "id,label"),
    "the renderer needs an id and a label and nothing else: no layering survives",
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

test("redo repeats the same action instead of turning into a generic rewrite", () => {
  // Redo after Shorten used to run a generic "rewrite this differently" prompt,
  // so the result was no longer a shortening. The instruction must survive.
  const first = buildRewritePrompt("some long text", "shorten");
  const second = buildRewritePrompt("some long text", "shorten", "", 2);
  const shortenInstruction = REWRITE_ACTIONS.find((action) => action.id === "shorten").instruction;

  assert.ok(first.includes(shortenInstruction), "first attempt carries the Shorten instruction");
  assert.ok(second.includes(shortenInstruction), "so does the retry");
  assert.notEqual(first, second, "the retry must differ so the model does not repeat itself");
  assert.match(second, /alternative attempt 2/i);
});

test("the variation note only appears once the user asks for another attempt", () => {
  assert.doesNotMatch(buildRewritePrompt("text", "polish"), /alternative attempt/i);
  assert.doesNotMatch(buildRewritePrompt("text", "polish", "", 1), /alternative attempt/i);
  assert.match(buildRewritePrompt("text", "polish", "", 3), /alternative attempt 3/i);
});

test("a custom instruction also keeps its wording across attempts", () => {
  const prompt = buildRewritePrompt("text", "custom", "make it rhyme", 2);

  assert.match(prompt, /make it rhyme/);
  assert.match(prompt, /alternative attempt 2/i);
});

/* ---------------------------------------------------------------- *
 * Vocabulary in rewrite prompts
 * ---------------------------------------------------------------- */

test("rewrite prompts carry vocabulary with the never-add rule", () => {
  const prompt = buildRewritePrompt("hi aisha", "polish", "", 1, ["Ayesha", "BayanFlow"]);

  assert.match(prompt, /Ayesha, BayanFlow/);
  // Correcting a name that IS there is the point; inserting one that is not
  // would quietly change what the user wrote.
  assert.match(prompt, /never add them/);
});

test("custom rewrite instructions get the vocabulary too", () => {
  const prompt = buildRewritePrompt("hi aisha", "custom", "make it formal", 1, ["Ayesha"]);
  assert.match(prompt, /Ayesha/);
});

test("no vocabulary means no vocabulary section at all", () => {
  const prompt = buildRewritePrompt("hi there", "polish");
  assert.doesNotMatch(prompt, /Known spellings/);
});
