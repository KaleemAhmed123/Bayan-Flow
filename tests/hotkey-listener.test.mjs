import assert from "node:assert/strict";
import test from "node:test";
import { HotkeyListener } from "../dist/hotkey/hotkey-listener.js";

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

test("hotkey listener starts, fires once while pressed, and stops", () => {
  const fake = createHook();
  let presses = 0;
  const listener = new HotkeyListener("Ctrl+Shift+Space", { onPressed: () => presses += 1 }, fake.hook);

  listener.start();
  fake.emit("keydown", { keycode: 57, ctrlKey: true, shiftKey: true, altKey: false, metaKey: false });
  fake.emit("keydown", { keycode: 57, ctrlKey: true, shiftKey: true, altKey: false, metaKey: false });
  assert.equal(presses, 1);

  fake.emit("keyup", { keycode: 57, ctrlKey: true, shiftKey: true, altKey: false, metaKey: false });
  fake.emit("keydown", { keycode: 57, ctrlKey: true, shiftKey: true, altKey: false, metaKey: false });
  assert.equal(presses, 2);

  listener.stop();
  assert.deepEqual(fake.counts(), { starts: 1, stops: 1, handlers: 0 });
});

test("hotkey listener does not fire without required modifiers", () => {
  const fake = createHook();
  let presses = 0;
  const listener = new HotkeyListener("Ctrl+Shift+Space", { onPressed: () => presses += 1 }, fake.hook);

  listener.start();
  fake.emit("keydown", { keycode: 57, ctrlKey: true, shiftKey: false, altKey: false, metaKey: false });
  assert.equal(presses, 0);
  listener.stop();
});

/* ---------------------------------------------------------------- *
 * Physical modifier tracking, used by the paste guard
 * ---------------------------------------------------------------- */

const CTRL = 29;
const CTRL_RIGHT = 3613;
const SHIFT = 42;
const SHIFT_RIGHT = 54;
const SPACE = 57;

const HELD = { ctrlKey: true, shiftKey: true, altKey: false, metaKey: false };

test("modifiers still read as held after the main key is released", () => {
  const fake = createHook();
  const listener = new HotkeyListener("Ctrl+Shift+Space", { onPressed: () => {} }, fake.hook);
  listener.start();

  assert.equal(listener.areHotkeyModifiersDown(), false);

  fake.emit("keydown", { keycode: CTRL, ...HELD });
  fake.emit("keydown", { keycode: SHIFT, ...HELD });
  fake.emit("keydown", { keycode: SPACE, ...HELD });
  assert.equal(listener.areHotkeyModifiersDown(), true);

  // The exact bug this exists for: Space comes up first and processing starts,
  // but Ctrl and Shift are still down and would corrupt a synthetic Ctrl+V.
  fake.emit("keyup", { keycode: SPACE, ...HELD });
  assert.equal(listener.areHotkeyModifiersDown(), true);

  fake.emit("keyup", { keycode: CTRL, ...HELD });
  assert.equal(listener.areHotkeyModifiersDown(), true, "shift is still down");

  fake.emit("keyup", { keycode: SHIFT, ...HELD });
  assert.equal(listener.areHotkeyModifiersDown(), false);

  listener.stop();
});

test("right-hand modifiers count as held", () => {
  const fake = createHook();
  const listener = new HotkeyListener("Ctrl+Shift+Space", { onPressed: () => {} }, fake.hook);
  listener.start();

  fake.emit("keydown", { keycode: CTRL_RIGHT, ...HELD });
  assert.equal(listener.areHotkeyModifiersDown(), true);
  fake.emit("keyup", { keycode: CTRL_RIGHT, ...HELD });

  fake.emit("keydown", { keycode: SHIFT_RIGHT, ...HELD });
  assert.equal(listener.areHotkeyModifiersDown(), true);
  fake.emit("keyup", { keycode: SHIFT_RIGHT, ...HELD });

  assert.equal(listener.areHotkeyModifiersDown(), false);
  listener.stop();
});

test("stopping clears held keys so the guard cannot stall forever", () => {
  const fake = createHook();
  const listener = new HotkeyListener("Ctrl+Shift+Space", { onPressed: () => {} }, fake.hook);
  listener.start();

  fake.emit("keydown", { keycode: CTRL, ...HELD });
  assert.equal(listener.areHotkeyModifiersDown(), true);

  // After stop we no longer receive key-ups, so stale state would be permanent.
  listener.stop();
  assert.equal(listener.areHotkeyModifiersDown(), false);
});
