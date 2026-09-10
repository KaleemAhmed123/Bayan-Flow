import assert from "node:assert/strict";
import test from "node:test";
import {
  DOCK_WIDTH,
  clampDockSize,
  dockBounds,
  recoveryForFailure,
  viewAutoClears,
  viewDismissesOnBlur,
  viewNeedsFocus,
  viewStartsSession,
} from "../dist/overlay/overlay-state.js";
import { classifyPress } from "../dist/hotkey/hotkey-parser.js";

const primary = { x: 0, y: 0, width: 1920, height: 1040 };
const secondaryLeft = { x: -1920, y: 0, width: 1920, height: 1040 };

test("dock sits bottom centre of the given work area", () => {
  const bounds = dockBounds({ width: DOCK_WIDTH, height: 60 }, primary);

  assert.equal(bounds.width, DOCK_WIDTH);
  assert.equal(bounds.height, 60);
  assert.equal(bounds.x, (1920 - DOCK_WIDTH) / 2);
  assert.equal(bounds.y, 1040 - 60 - 32);
});

test("dock placement is identical on repeated calls with the same inputs", () => {
  // The bug this replaces returned a different position on the second call
  // because it branched on an async field that had since been populated.
  const first = dockBounds({ width: DOCK_WIDTH, height: 120 }, primary);
  const second = dockBounds({ width: DOCK_WIDTH, height: 120 }, primary);
  assert.deepEqual(first, second);
});

test("dock height does not move it off the bottom of a short work area", () => {
  const shortArea = { x: 0, y: 0, width: 1280, height: 200 };
  const bounds = dockBounds({ width: DOCK_WIDTH, height: 400 }, shortArea);

  assert.ok(bounds.y >= shortArea.y, "top edge stays on screen");
  assert.ok(bounds.y + bounds.height <= shortArea.y + shortArea.height, "bottom edge stays on screen");
});

test("dock stays inside a display with negative origin", () => {
  const bounds = dockBounds({ width: DOCK_WIDTH, height: 60 }, secondaryLeft);

  assert.ok(bounds.x >= secondaryLeft.x);
  assert.ok(bounds.x + bounds.width <= secondaryLeft.x + secondaryLeft.width);
});

test("dock never exceeds a narrow display", () => {
  const narrow = { x: 0, y: 0, width: 320, height: 480 };
  const size = clampDockSize({ width: DOCK_WIDTH, height: 60 }, narrow);
  const bounds = dockBounds({ width: DOCK_WIDTH, height: 60 }, narrow);

  assert.ok(size.width <= narrow.width);
  assert.ok(bounds.x >= narrow.x);
  assert.ok(bounds.x + bounds.width <= narrow.x + narrow.width);
});

test("every failure carries a recovery button", () => {
  for (const failure of [
    "missing_api_key",
    "hotkey",
    "recorder",
    "transcription",
    "polish",
    "paste_blocked",
    "generic",
  ]) {
    const recovery = recoveryForFailure(failure);
    assert.ok(recovery, `${failure} should offer a recovery action`);
    assert.ok(recovery.label.length > 0, `${failure} should label its button`);
  }
});

test("paste failures offer copy, key failures offer settings", () => {
  assert.equal(recoveryForFailure("paste_blocked").action, "copy");
  assert.equal(recoveryForFailure("missing_api_key").action, "settings");
  assert.equal(recoveryForFailure("transcription").action, "retry");
});

test("only the menu takes focus and dismisses on blur", () => {
  const menu = { kind: "menu", actions: [], note: "" };
  const listening = { kind: "listening", latched: false, hint: "" };
  const error = { kind: "error", message: "x", recovery: null };

  assert.equal(viewNeedsFocus(menu), true);
  assert.equal(viewNeedsFocus(listening), false);
  assert.equal(viewDismissesOnBlur(menu), true);
  assert.equal(viewDismissesOnBlur(error), false, "an error must survive a stray click");
  assert.equal(viewAutoClears(error), true);
  assert.equal(viewAutoClears(listening), false, "recording must not time out on its own");
});

test("the idle pill is permanent: it never focuses, dismisses, or times out", () => {
  const idle = { kind: "idle", ready: true };

  assert.equal(viewNeedsFocus(idle), false, "the pill must not steal focus from the user's app");
  assert.equal(viewDismissesOnBlur(idle), false);
  assert.equal(viewAutoClears(idle), false, "a permanent pill must not hide itself");
  assert.equal(viewStartsSession(idle), false);
});

test("only a new recording claims a display for the session", () => {
  assert.equal(viewStartsSession({ kind: "listening", latched: false, hint: "" }), true);
  for (const view of [
    { kind: "idle", ready: true },
    { kind: "working", label: "x", startedAt: 0 },
    { kind: "done", label: "x", tone: "ok", canRedo: true },
    { kind: "menu", actions: [], note: "" },
    { kind: "error", message: "x", recovery: null },
  ]) {
    assert.equal(viewStartsSession(view), false, `${view.kind} must not re-pick the display`);
  }
});

test("the narrow idle pill still centres and stays on screen", () => {
  // The pill is far narrower than the working states. Because placement is always
  // centred, shrinking must keep it on screen and symmetric, never slide it.
  const pill = dockBounds({ width: 76, height: 32 }, primary);
  const bar = dockBounds({ width: DOCK_WIDTH, height: 52 }, primary);

  assert.equal(pill.x + pill.width / 2, bar.x + bar.width / 2, "both states share one centre line");
  assert.ok(pill.x >= primary.x);
  assert.ok(pill.x + pill.width <= primary.x + primary.width);
});

test("tap and hold are told apart at the 800ms boundary", () => {
  assert.equal(classifyPress(0), "tap");
  assert.equal(classifyPress(799), "tap");
  assert.equal(classifyPress(800), "hold");
  assert.equal(classifyPress(5_000), "hold");
  assert.equal(classifyPress(Number.NaN), "tap", "a missing timestamp must not latch silently");
});

test("an unhurried tap is not mistaken for push-to-talk", () => {
  // Real presses that the old 400ms threshold classified as holds and then
  // stopped before the microphone had opened. Nobody dictates in half a second.
  for (const heldMs of [429, 449, 454, 462, 475, 480, 488, 493, 591]) {
    assert.equal(classifyPress(heldMs), "tap", `${heldMs}ms is a slow tap, not a hold`);
  }

  assert.equal(classifyPress(1_365), "hold", "a deliberate hold still latches push-to-talk");
});
