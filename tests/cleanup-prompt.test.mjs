import assert from "node:assert/strict";
import test from "node:test";
import { buildCleanupPrompt } from "../dist/cleanup/cleanup-provider.js";
import { parseHotkey } from "../dist/hotkey/hotkey-parser.js";

test("cleanup prompt keeps provider output constrained", () => {
  const prompt = buildCleanupPrompt("uh hey can you send that tomorrow", { mode: "default" });

  assert.match(prompt, /Preserve the user's intended meaning/);
  assert.match(prompt, /Return plain cleaned text only/);
  assert.match(prompt, /Do not paraphrase unless required to repair obvious ASR corruption/);
  assert.match(prompt, /uh hey can you send that tomorrow/);
});

test("hotkey parser separates modifiers and primary key", () => {
  assert.deepEqual(parseHotkey("Ctrl+Shift+Space"), {
    modifiers: ["Ctrl", "Shift"],
    key: "Space",
  });
});
