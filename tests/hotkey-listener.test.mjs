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
