import assert from "node:assert/strict";
import test from "node:test";
import { TextInserter } from "../dist/insertion/text-inserter.js";

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
