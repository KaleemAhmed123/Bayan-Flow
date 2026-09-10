import assert from "node:assert/strict";
import test from "node:test";
import {
  areModifiersDown,
  initialHotkeyState,
  reduceHotkey,
} from "../dist/hotkey/hotkey-reducer.js";
import { classifyPress } from "../dist/hotkey/hotkey-parser.js";

const CONFIG = { key: "SPACE", modifiers: ["CTRL", "SHIFT"] };
const HELD = { ctrlKey: true, shiftKey: true, altKey: false, metaKey: false };

const down = (keyName, atMs, flags = HELD) => ({ type: "keydown", keyName, atMs, ...flags });
const up = (keyName, atMs) => ({ type: "keyup", keyName, atMs });

/** Feeds a sequence in and returns the final state plus everything emitted. */
function run(inputs, state = initialHotkeyState) {
  const effects = [];
  for (const input of inputs) {
    const step = reduceHotkey(state, input, CONFIG);
    state = step.state;
    effects.push(...step.effects);
  }
  return { state, effects };
}

test("the hotkey fires once per press, not once per repeat", () => {
  const { effects } = run([
    down("CTRL", 0),
    down("SHIFT", 1),
    down("SPACE", 2),
    down("SPACE", 3), // key repeat while still held
    down("SPACE", 4),
  ]);

  assert.deepEqual(effects, [{ type: "pressed" }]);
});

test("a missing modifier means no press at all", () => {
  const { effects } = run([down("SPACE", 0, { ...HELD, shiftKey: false })]);
  assert.deepEqual(effects, []);
});

test("release reports how long the key was held", () => {
  const { effects } = run([down("SPACE", 1_000), up("SPACE", 1_900)]);

  assert.deepEqual(effects, [{ type: "pressed" }, { type: "released", heldMs: 900 }]);
});

test("held time drives the tap-versus-hold decision", () => {
  // The whole reason the clock is an input: a 900ms hold costs no wall time.
  const hold = run([down("SPACE", 0), up("SPACE", 900)]).effects.at(-1);
  const tap = run([down("SPACE", 0), up("SPACE", 300)]).effects.at(-1);

  assert.equal(classifyPress(hold.heldMs), "hold");
  assert.equal(classifyPress(tap.heldMs), "tap");
});

test("releasing a modifier ends the press, not just the main key", () => {
  const { effects } = run([down("SPACE", 0), up("CTRL", 500)]);

  assert.deepEqual(effects, [{ type: "pressed" }, { type: "released", heldMs: 500 }]);
});

test("releasing an unrelated key does not end the press", () => {
  const { effects, state } = run([down("SPACE", 0), down("A", 10), up("A", 20)]);

  assert.deepEqual(effects, [{ type: "pressed" }]);
  assert.notEqual(state.pressedAt, null, "still held");
});

test("a key-up with no press behind it emits nothing", () => {
  const { effects } = run([up("SPACE", 100)]);
  assert.deepEqual(effects, []);
});

/* ---------------------------------------------------------------- *
 * Physical modifier tracking, used by the paste guard
 * ---------------------------------------------------------------- */

test("modifiers still read as held after the main key is released", () => {
  let { state } = run([down("CTRL", 0), down("SHIFT", 1), down("SPACE", 2)]);
  assert.equal(areModifiersDown(state, CONFIG), true);

  // The exact bug this exists for: Space comes up and processing starts, but
  // Ctrl and Shift are still down and would corrupt a synthetic Ctrl+V.
  ({ state } = run([up("SPACE", 3)], state));
  assert.equal(areModifiersDown(state, CONFIG), true);

  ({ state } = run([up("CTRL", 4)], state));
  assert.equal(areModifiersDown(state, CONFIG), true, "shift is still down");

  ({ state } = run([up("SHIFT", 5)], state));
  assert.equal(areModifiersDown(state, CONFIG), false);
});

test("right-hand modifiers count as held", () => {
  for (const keyName of ["CTRLRIGHT", "RIGHT SHIFT"]) {
    const { state } = run([down(keyName, 0)]);
    assert.equal(areModifiersDown(state, CONFIG), true, `${keyName} must count`);
  }
});

test("detaching clears held keys so the guard cannot stall forever", () => {
  let { state } = run([down("CTRL", 0), down("SPACE", 1)]);
  assert.equal(areModifiersDown(state, CONFIG), true);

  // After detach we no longer receive key-ups, so stale state would be permanent.
  ({ state } = run([{ type: "detach" }], state));
  assert.deepEqual(state, initialHotkeyState);
  assert.equal(areModifiersDown(state, CONFIG), false);
});

test("an unmapped keycode does not enter the held set", () => {
  // getEventKeyName returns "" for a keycode uiohook does not name.
  const { state } = run([down("", 0)]);
  assert.deepEqual(state.downKeys, []);
});

test("state is plain data, so it compares and logs as-is", () => {
  const { state } = run([down("CTRL", 0), down("SPACE", 7)]);
  assert.deepEqual(state, { downKeys: ["CTRL", "SPACE"], pressedAt: 7 });
});

test("consume is false everywhere until task 23 attaches a hook that can", () => {
  for (const input of [down("SPACE", 0), up("SPACE", 1), { type: "detach" }]) {
    assert.equal(reduceHotkey(initialHotkeyState, input, CONFIG).consume, false);
  }
});
