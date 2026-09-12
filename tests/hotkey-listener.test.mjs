import assert from "node:assert/strict";
import test from "node:test";
import { HotkeyWatcher } from "../dist/hotkey/hotkey-listener.js";

function createHook() {
  const handlers = new Map();
  let starts = 0;
  let stops = 0;
  return {
    hook: {
      on: (event, callback) => handlers.set(event, callback),
      off: (event) => handlers.delete(event),
      start: () => {
        starts += 1;
      },
      stop: () => {
        stops += 1;
      },
    },
    emit: (event, payload) => handlers.get(event)?.(payload),
    counts: () => ({ starts, stops, handlers: handlers.size }),
  };
}

function watch(fake, bindings) {
  const watcher = new HotkeyWatcher(fake.hook);
  watcher.setBindings(bindings);
  return watcher;
}

test("hotkey watcher starts, fires once while pressed, and stops", () => {
  const fake = createHook();
  let presses = 0;
  const watcher = watch(fake, [{ hotkey: "Ctrl+Shift+Space", onPressed: () => (presses += 1) }]);

  watcher.start();
  fake.emit("keydown", { keycode: 57, ctrlKey: true, shiftKey: true, altKey: false, metaKey: false });
  fake.emit("keydown", { keycode: 57, ctrlKey: true, shiftKey: true, altKey: false, metaKey: false });
  assert.equal(presses, 1);

  fake.emit("keyup", { keycode: 57, ctrlKey: true, shiftKey: true, altKey: false, metaKey: false });
  fake.emit("keydown", { keycode: 57, ctrlKey: true, shiftKey: true, altKey: false, metaKey: false });
  assert.equal(presses, 2);

  watcher.stop();
  assert.deepEqual(fake.counts(), { starts: 1, stops: 1, handlers: 0 });
});

test("hotkey watcher does not fire without required modifiers", () => {
  const fake = createHook();
  let presses = 0;
  const watcher = watch(fake, [{ hotkey: "Ctrl+Shift+Space", onPressed: () => (presses += 1) }]);

  watcher.start();
  fake.emit("keydown", { keycode: 57, ctrlKey: true, shiftKey: false, altKey: false, metaKey: false });
  assert.equal(presses, 0);
  watcher.stop();
});

/* ---------------------------------------------------------------- *
 * One hook, many hotkeys
 * ---------------------------------------------------------------- */

const CTRL = 29;
const CTRL_RIGHT = 3613;
const SHIFT = 42;
const SHIFT_RIGHT = 54;
const SPACE = 57;
const ENTER = 28;
const ESC = 1;

const HELD = { ctrlKey: true, shiftKey: true, altKey: false, metaKey: false };

test("one hook drives every hotkey, and each fires only for its own keys", () => {
  const fake = createHook();
  const fired = [];
  const watcher = watch(fake, [
    { hotkey: "Ctrl+Shift+Space", onPressed: () => fired.push("dictate") },
    { hotkey: "Ctrl+Shift+Enter", onPressed: () => fired.push("rewrite") },
    { hotkey: "Esc", onPressed: () => fired.push("cancel") },
  ]);

  watcher.start();
  // Three hotkeys, still exactly one keydown and one keyup handler on the hook.
  assert.equal(fake.counts().handlers, 2);
  assert.equal(fake.counts().starts, 1);

  fake.emit("keydown", { keycode: SPACE, ...HELD });
  fake.emit("keyup", { keycode: SPACE, ...HELD });
  fake.emit("keydown", { keycode: ENTER, ...HELD });
  fake.emit("keyup", { keycode: ENTER, ...HELD });
  fake.emit("keydown", { keycode: ESC, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false });

  assert.deepEqual(fired, ["dictate", "rewrite", "cancel"]);
  watcher.stop();
});

test("swapping bindings never stops the hook", () => {
  // The defect this guards against: rebuilding the hotkeys on a settings save
  // used to call stop() on the first of three listener objects, which stopped
  // the shared process-wide hook for the two that had not been rebuilt yet.
  const fake = createHook();
  let presses = 0;
  const watcher = watch(fake, [{ hotkey: "Ctrl+Shift+Space", onPressed: () => (presses += 1) }]);
  watcher.start();

  watcher.setBindings([{ hotkey: "Ctrl+Shift+Enter", onPressed: () => (presses += 1) }]);
  assert.deepEqual(fake.counts(), { starts: 1, stops: 0, handlers: 2 }, "the hook must keep running across a swap");

  // The new binding works and the old one is gone.
  fake.emit("keydown", { keycode: ENTER, ...HELD });
  assert.equal(presses, 1);
  fake.emit("keyup", { keycode: ENTER, ...HELD });
  fake.emit("keydown", { keycode: SPACE, ...HELD });
  assert.equal(presses, 1, "the replaced hotkey must no longer fire");

  watcher.stop();
});

test("start is idempotent, so nothing can double-attach the hook", () => {
  const fake = createHook();
  const watcher = watch(fake, [{ hotkey: "Ctrl+Shift+Space", onPressed: () => {} }]);

  watcher.start();
  watcher.start();
  watcher.start();
  assert.deepEqual(fake.counts(), { starts: 1, stops: 0, handlers: 2 });

  watcher.stop();
  watcher.stop();
  assert.deepEqual(fake.counts(), { starts: 1, stops: 1, handlers: 0 });
});

/* ---------------------------------------------------------------- *
 * Physical modifier tracking, used by the paste guard
 * ---------------------------------------------------------------- */

test("modifiers still read as held after the main key is released", () => {
  const fake = createHook();
  const watcher = watch(fake, [{ hotkey: "Ctrl+Shift+Space", onPressed: () => {} }]);
  watcher.start();

  assert.equal(watcher.areHotkeyModifiersDown(), false);

  fake.emit("keydown", { keycode: CTRL, ...HELD });
  fake.emit("keydown", { keycode: SHIFT, ...HELD });
  fake.emit("keydown", { keycode: SPACE, ...HELD });
  assert.equal(watcher.areHotkeyModifiersDown(), true);

  // The exact bug this exists for: Space comes up first and processing starts,
  // but Ctrl and Shift are still down and would corrupt a synthetic Ctrl+V.
  fake.emit("keyup", { keycode: SPACE, ...HELD });
  assert.equal(watcher.areHotkeyModifiersDown(), true);

  fake.emit("keyup", { keycode: CTRL, ...HELD });
  assert.equal(watcher.areHotkeyModifiersDown(), true, "shift is still down");

  fake.emit("keyup", { keycode: SHIFT, ...HELD });
  assert.equal(watcher.areHotkeyModifiersDown(), false);

  watcher.stop();
});

test("right-hand modifiers count as held", () => {
  const fake = createHook();
  const watcher = watch(fake, [{ hotkey: "Ctrl+Shift+Space", onPressed: () => {} }]);
  watcher.start();

  fake.emit("keydown", { keycode: CTRL_RIGHT, ...HELD });
  assert.equal(watcher.areHotkeyModifiersDown(), true);
  fake.emit("keyup", { keycode: CTRL_RIGHT, ...HELD });

  fake.emit("keydown", { keycode: SHIFT_RIGHT, ...HELD });
  assert.equal(watcher.areHotkeyModifiersDown(), true);
  fake.emit("keyup", { keycode: SHIFT_RIGHT, ...HELD });

  assert.equal(watcher.areHotkeyModifiersDown(), false);
  watcher.stop();
});

test("a bare hotkey contributes no modifiers to the paste guard", () => {
  // Esc is watched alongside the real hotkeys. If an empty modifier list counted
  // as "held", every synthetic paste would wait out its full 600ms budget.
  const fake = createHook();
  const watcher = watch(fake, [{ hotkey: "Esc", onPressed: () => {} }]);
  watcher.start();

  fake.emit("keydown", { keycode: ESC, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false });
  assert.equal(watcher.areHotkeyModifiersDown(), false);

  watcher.stop();
});

test("stopping clears held keys so the guard cannot stall forever", () => {
  const fake = createHook();
  const watcher = watch(fake, [{ hotkey: "Ctrl+Shift+Space", onPressed: () => {} }]);
  watcher.start();

  fake.emit("keydown", { keycode: CTRL, ...HELD });
  assert.equal(watcher.areHotkeyModifiersDown(), true);

  // After stop we no longer receive key-ups, so stale state would be permanent.
  watcher.stop();
  assert.equal(watcher.areHotkeyModifiersDown(), false);
});

test("an unparseable hotkey is dropped without taking the others down", () => {
  const fake = createHook();
  let presses = 0;
  const watcher = watch(fake, [
    { hotkey: "", onPressed: () => (presses += 100) },
    { hotkey: "Ctrl+Shift+Space", onPressed: () => (presses += 1) },
  ]);

  watcher.start();
  fake.emit("keydown", { keycode: SPACE, ...HELD });
  assert.equal(presses, 1);
  watcher.stop();
});
