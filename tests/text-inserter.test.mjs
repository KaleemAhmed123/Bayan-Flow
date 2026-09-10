import assert from "node:assert/strict";
import test from "node:test";
import { Key } from "@nut-tree-fork/nut-js";
import { TextInserter, isUsableTarget, replaceLastOccurrence } from "../dist/insertion/text-inserter.js";

function createInserter({ title = "Target", handle = 101, failPaste = false, mutateClipboardAfterPaste = false } = {}) {
  const writes = [];
  let clipboardText = "previous";
  const inserter = new TextInserter({
    clipboard: {
      readText: () => clipboardText,
      writeText: (text) => {
        clipboardText = text;
        writes.push(text);
      },
    },
    keyboard: {
      pressKey: async () => {
        if (failPaste) {
          throw new Error("blocked");
        }

        if (mutateClipboardAfterPaste) {
          clipboardText = "user copied this";
        }
      },
      releaseKey: async () => {},
    },
    windowProvider: {
      getActiveWindow: async () => ({ getTitle: async () => title, windowHandle: handle }),
    },
    restoreDelayMs: 0,
  });

  return { inserter, writes, getClipboard: () => clipboardText };
}

test("copyText writes text without paste automation", () => {
  const { inserter, getClipboard } = createInserter();
  inserter.copyText("hello");
  assert.equal(getClipboard(), "hello");
});

test("captureActiveTarget includes normalized window bounds when available", async () => {
  const inserter = new TextInserter({
    clipboard: {
      readText: () => "",
      writeText: () => {},
    },
    keyboard: {
      pressKey: async () => {},
      releaseKey: async () => {},
    },
    windowProvider: {
      getActiveWindow: async () => ({
        getTitle: async () => "Target",
        getRegion: async () => ({ left: 10.2, top: 20.7, width: 640.1, height: 480.4 }),
        windowHandle: 101,
      }),
    },
    restoreDelayMs: 0,
  });

  assert.deepEqual(await inserter.captureActiveTarget(), {
    title: "Target",
    handle: 101,
    bounds: { x: 10, y: 21, width: 640, height: 480 },
  });
});

test("pasteText restores previous clipboard after successful paste", async () => {
  const { inserter, writes, getClipboard } = createInserter();
  await inserter.pasteText("final", {}, { title: "Target", handle: 101 });
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.deepEqual(writes, ["final", "previous"]);
  assert.equal(getClipboard(), "previous");
});

test("pasteText does not restore when clipboard changed after paste", async () => {
  const { inserter, writes, getClipboard } = createInserter({ mutateClipboardAfterPaste: true });
  await inserter.pasteText("final", {}, { title: "Target", handle: 101 });
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.deepEqual(writes, ["final"]);
  assert.equal(getClipboard(), "user copied this");
});

test("pasteText leaves final text copied when paste fails", async () => {
  const { inserter, getClipboard } = createInserter({ failPaste: true });
  await assert.rejects(() => inserter.pasteText("final", {}, { title: "Target", handle: 101 }), /blocked/);
  assert.equal(getClipboard(), "final");
});

test("pasteText leaves final text copied when active target changes", async () => {
  const { inserter, getClipboard } = createInserter({ title: "Other" });
  await assert.rejects(() => inserter.pasteText("final", {}, { title: "Target", handle: null }), /Active window changed/);
  assert.equal(getClipboard(), "final");
});

test("pasteText rejects when active window handle changes even if title is unchanged", async () => {
  const { inserter, getClipboard } = createInserter({ title: "Target", handle: 202 });
  await assert.rejects(() => inserter.pasteText("final", {}, { title: "Target", handle: 101 }), /Active window changed/);
  assert.equal(getClipboard(), "final");
});

test("pasteText allows title changes when the window handle is unchanged", async () => {
  const { inserter, getClipboard } = createInserter({ title: "Updated title", handle: 101 });
  await inserter.pasteText("final", {}, { title: "Original title", handle: 101 });
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(getClipboard(), "previous");
});

test("replaceWholeTextByClipboard verifies whole input and restores clipboard", async () => {
  const shortcuts = [];
  let clipboardText = "previous";
  let selectedAll = false;
  const inserter = new TextInserter({
    clipboard: {
      readText: () => clipboardText,
      writeText: (text) => {
        clipboardText = text;
      },
    },
    keyboard: {
      pressKey: async (...keys) => {
        shortcuts.push(keys);
        if (keys.includes(Key.A)) {
          selectedAll = true;
        }

        if (keys.includes(Key.C) && selectedAll) {
          clipboardText = "whole input\r\n";
        }
      },
      releaseKey: async () => {},
    },
    windowProvider: {
      getActiveWindow: async () => ({ getTitle: async () => "Target", windowHandle: 101 }),
    },
    restoreDelayMs: 0,
  });

  await inserter.replaceWholeTextByClipboard("whole input", "replacement", { title: "Target", handle: 101 });
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(clipboardText, "previous");
  assert.equal(shortcuts.some((keys) => keys.includes(Key.A)), true);
  assert.equal(shortcuts.some((keys) => keys.includes(Key.V)), true);
});

test("replaceWholeTextByClipboard copies fallback when whole input changed", async () => {
  let clipboardText = "previous";
  const inserter = new TextInserter({
    clipboard: {
      readText: () => clipboardText,
      writeText: (text) => {
        clipboardText = text;
      },
    },
    keyboard: {
      pressKey: async (...keys) => {
        if (keys.includes(Key.C)) {
          clipboardText = "changed input";
        }
      },
      releaseKey: async () => {},
    },
    windowProvider: {
      getActiveWindow: async () => ({ getTitle: async () => "Target", windowHandle: 101 }),
    },
    restoreDelayMs: 0,
  });

  await assert.rejects(
    () => inserter.replaceWholeTextByClipboard("whole input", "replacement", { title: "Target", handle: 101 }),
    /Input text changed/,
  );
  assert.equal(clipboardText, "replacement");
});

test("our own overlay is never accepted as a paste or rewrite target", () => {
  // The dock is always-on-top and can be the foreground window right after a
  // click, so a raw capture returned BayanFlow itself and the rewrite then sent
  // Ctrl+A/Ctrl+C to our own window. Logs showed titleChars 0 and 9 for these.
  assert.equal(isUsableTarget({ title: "BayanFlow", handle: 1 }), false);
  assert.equal(isUsableTarget({ title: "BayanFlow Settings", handle: 1 }), false);
  assert.equal(isUsableTarget({ title: "", handle: 1 }), false, "untitled windows are not real apps");
  assert.equal(isUsableTarget({ title: "   ", handle: 1 }), false);
  assert.equal(isUsableTarget(null), false);
  assert.equal(isUsableTarget(undefined), false);
});

test("real app windows are accepted, including ones that merely mention the app", () => {
  assert.equal(isUsableTarget({ title: "main.ts - Bayan-Flow - Visual Studio Code", handle: 1 }), true);
  assert.equal(isUsableTarget({ title: "Inbox - Brave", handle: 1 }), true);
  assert.equal(isUsableTarget({ title: "WhatsApp", handle: 1 }), true);
});

function selectionInserter({ selectionText }) {
  const shortcuts = [];
  let clipboardText = "previous";

  const inserter = new TextInserter({
    clipboard: {
      readText: () => clipboardText,
      writeText: (text) => {
        clipboardText = text;
      },
    },
    keyboard: {
      pressKey: async (...keys) => {
        shortcuts.push(keys);
        // Ctrl+C returns whatever is currently selected in the host app.
        if (keys.includes(Key.C) && !keys.includes(Key.A)) {
          clipboardText = selectionText;
        }
      },
      releaseKey: async () => {},
    },
    windowProvider: {
      getActiveWindow: async () => ({ getTitle: async () => "Target", windowHandle: 101 }),
    },
    restoreDelayMs: 0,
  });

  return { inserter, shortcuts, clipboard: () => clipboardText };
}

test("replaceLastOccurrence swaps the most recent copy, not the first", async () => {
  // Redo replaces what it inserted last, and a paraphrase can legitimately repeat
  // an earlier phrase, so the later occurrence is the right one to overwrite.
  assert.equal(replaceLastOccurrence("a X b X c", "X", "Y"), "a X b Y c");
  assert.equal(replaceLastOccurrence("only once", "once", "twice"), "only twice");
  assert.equal(replaceLastOccurrence("no match here", "zzz", "Y"), "no match here");
  assert.equal(replaceLastOccurrence("anything", "", "Y"), "anything");
});

test("captureSelectionAndWhole reports the selection and the whole input separately", async () => {
  // Ctrl+C cannot prove a selection exists: VS Code copies the caret's line when
  // nothing is selected. Callers need both values so they can rewrite the line
  // but still write through the whole input, where Ctrl+A guarantees a replace.
  const shortcuts = [];
  let clipboardText = "previous";
  let selectedAll = false;

  const inserter = new TextInserter({
    clipboard: {
      readText: () => clipboardText,
      writeText: (text) => {
        clipboardText = text;
      },
    },
    keyboard: {
      pressKey: async (...keys) => {
        shortcuts.push(keys);
        if (keys.includes(Key.A)) {
          selectedAll = true;
        }

        if (keys.includes(Key.C)) {
          clipboardText = selectedAll ? "line one\nline two\n" : "line two\n";
        }
      },
      releaseKey: async () => {},
    },
    windowProvider: {
      getActiveWindow: async () => ({ getTitle: async () => "Target", windowHandle: 101 }),
    },
    restoreDelayMs: 0,
  });

  const result = await inserter.captureSelectionAndWhole({ title: "Target", handle: 101 });

  assert.equal(result.selection, "line two\n");
  assert.equal(result.whole, "line one\nline two\n");
  assert.equal(clipboardText, "previous", "the user's clipboard is put back");
});

/* ---------------------------------------------------------------- *
 * Modifier guard: never paste while the hotkey is still held
 * ---------------------------------------------------------------- */

test("paste waits for the hotkey modifiers to be released", async () => {
  const { inserter } = createInserter();

  let guardChecks = 0;
  // Reports "still held" for the first few checks, then the user lets go.
  inserter.setModifierGuard(() => {
    guardChecks += 1;
    return guardChecks <= 3;
  });

  const startedAt = Date.now();
  await inserter.pasteText("hello", {}, { title: "Target", handle: 101 });

  assert.ok(guardChecks > 1, "guard should be polled until the keys come up");
  assert.ok(Date.now() - startedAt >= 25, "paste should have waited at least one poll interval");
});

test("paste still fires when the modifiers are never released", async () => {
  const { inserter, getClipboard } = createInserter();
  inserter.setModifierGuard(() => true);

  await inserter.pasteText("hello", {}, { title: "Target", handle: 101 });

  // Bounded wait, then send anyway. A possibly-mangled paste is recoverable
  // from the clipboard; a silently dropped dictation is not.
  assert.equal(getClipboard(), "hello");
});

test("no guard installed means no modifier wait is added", async () => {
  const { inserter, getClipboard } = createInserter();

  const startedAt = Date.now();
  await inserter.pasteText("hello", {}, { title: "Target", handle: 101 });
  const elapsed = Date.now() - startedAt;

  assert.equal(getClipboard(), "hello");
  // The paste path already spends ~250ms in its own settle sleeps, so the only
  // meaningful check is that none of the 600ms modifier budget was consumed.
  assert.ok(elapsed < 600, `unguarded paste should not wait on modifiers, took ${elapsed}ms`);
});
