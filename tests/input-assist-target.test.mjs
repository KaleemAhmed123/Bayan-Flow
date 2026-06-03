import assert from "node:assert/strict";
import test from "node:test";
import { iconPositionForBounds, normalizeInputAssistTarget } from "../dist/input-assist/input-assist-types.js";
import {
  shouldPreferClipboardSelectionOverUiaWhole,
  shouldPreferClipboardWholeOverUiaWhole,
} from "../dist/input-assist/rewrite-source-selection.js";
import { getInputAssistSpeechReadiness } from "../dist/input-assist/speech-readiness.js";

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

test("prefers real clipboard selections over UIA whole text", () => {
  const wholeText = "First line\r\nSelected text across\r\nmultiple lines\r\nLast line";

  assert.equal(
    shouldPreferClipboardSelectionOverUiaWhole("Selected text across\r\nmultiple lines", wholeText),
    true,
  );
  assert.equal(shouldPreferClipboardSelectionOverUiaWhole("Selected", wholeText), true);
});

test("ignores likely editor current-line clipboard copies", () => {
  const wholeText = "First line\r\nCurrent line\r\nLast line";

  assert.equal(shouldPreferClipboardSelectionOverUiaWhole("Current line\r\n", wholeText), false);
  assert.equal(shouldPreferClipboardSelectionOverUiaWhole(wholeText, wholeText), false);
});

test("prefers fuller clipboard whole input over partial UIA whole text", () => {
  assert.equal(shouldPreferClipboardWholeOverUiaWhole("Full input text across the actual editor", "Short UIA text"), true);
  assert.equal(shouldPreferClipboardWholeOverUiaWhole("Short", "Longer UIA input text"), false);
  assert.equal(shouldPreferClipboardWholeOverUiaWhole("Same text", "Same text"), false);
});

test("classifies input assist speech readiness", () => {
  assert.equal(
    getInputAssistSpeechReadiness({ hasGroqApiKey: false, isRecording: false, isProcessing: false }),
    "blocked_missing_api_key",
  );
  assert.equal(
    getInputAssistSpeechReadiness({ hasGroqApiKey: true, isRecording: true, isProcessing: true }),
    "blocked_processing",
  );
  assert.equal(
    getInputAssistSpeechReadiness({ hasGroqApiKey: true, isRecording: true, isProcessing: false }),
    "cancel_active_recording",
  );
  assert.equal(
    getInputAssistSpeechReadiness({ hasGroqApiKey: true, isRecording: false, isProcessing: false }),
    "ready",
  );
});
