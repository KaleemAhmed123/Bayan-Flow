import assert from "node:assert/strict";
import test from "node:test";
import { iconPositionForBounds, normalizeInputAssistTarget } from "../dist/input-assist/input-assist-types.js";

test("normalizes valid input assist target", () => {
  const target = normalizeInputAssistTarget({
    targetId: "1.2.3",
    windowHandle: 101,
    controlType: "ControlType.Edit",
    canReadText: true,
    canWriteText: false,
    bounds: { x: 10.2, y: 20.8, width: 300.1, height: 32.2 },
  });

  assert.deepEqual(target, {
    targetId: "1.2.3",
    windowHandle: 101,
    controlType: "ControlType.Edit",
    canReadText: true,
    canWriteText: false,
    bounds: { x: 10, y: 21, width: 300, height: 32 },
  });
});

test("rejects invalid or tiny input assist bounds", () => {
  assert.equal(
    normalizeInputAssistTarget({
      targetId: "1",
      windowHandle: 101,
      controlType: "ControlType.Edit",
      bounds: { x: 0, y: 0, width: 10, height: 10 },
    }),
    null,
  );
});

test("positions magic icon inside work area", () => {
  const position = iconPositionForBounds(
    { x: 990, y: 20, width: 80, height: 30 },
    36,
    { x: 0, y: 0, width: 1024, height: 768 },
  );

  assert.equal(position.x <= 1024 - 36 - 8, true);
  assert.equal(position.y >= 8, true);
});
