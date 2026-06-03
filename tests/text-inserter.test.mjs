import assert from "node:assert/strict";
import test from "node:test";
import { Key } from "@nut-tree-fork/nut-js";
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

test("captureTextFromTargetByClipboard captures selected text and restores clipboard", async () => {
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
        if (keys.includes(Key.C)) {
          clipboardText = "selected text";
        }
      },
      releaseKey: async () => {},
    },
    windowProvider: {
      getActiveWindow: async () => ({ getTitle: async () => "Target", windowHandle: 101 }),
    },
    restoreDelayMs: 0,
  });

  const source = await inserter.captureTextFromTargetByClipboard({ title: "Target", handle: 101 });

  assert.deepEqual(source, { scope: "selection", text: "selected text" });
  assert.equal(clipboardText, "previous");
  assert.equal(shortcuts.some((keys) => keys.includes(Key.A)), false);
});

test("captureTextFromTargetByClipboard falls back to whole input after refocusing target window", async () => {
  let clipboardText = "previous";
  let activeHandle = 999;
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
        if (keys.includes(Key.A)) {
          selectedAll = true;
        }

        if (keys.includes(Key.C) && selectedAll) {
          clipboardText = "whole input";
        }
      },
      releaseKey: async () => {},
    },
    windowProvider: {
      getActiveWindow: async () => ({ getTitle: async () => "Active", windowHandle: activeHandle }),
      getWindows: async () => [
        {
          getTitle: async () => "Target",
          windowHandle: 101,
          focus: async () => {
            activeHandle = 101;
            return true;
          },
        },
      ],
    },
    restoreDelayMs: 0,
  });

  const source = await inserter.captureTextFromTargetByClipboard({ title: "Target", handle: 101 });

  assert.deepEqual(source, { scope: "whole", text: "whole input" });
  assert.equal(clipboardText, "previous");
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
