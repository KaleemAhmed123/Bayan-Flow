import assert from "node:assert/strict";
import test from "node:test";
import {
  validateRecorderMicTestedPayload,
  validateRecorderStartedPayload,
  validateRecorderStoppedPayload,
} from "../dist/audio/recorder-ipc-payloads.js";

test("recorder IPC validation rejects invalid session id", () => {
  assert.throws(
    () => validateRecorderStartedPayload({ ok: true, sessionId: "session-stale" }, "session-active"),
    /Invalid recorder session id/,
  );
});

test("recorder IPC validation rejects non-ArrayBuffer audio", () => {
  assert.throws(
    () => validateRecorderStoppedPayload({ sessionId: "session-active", audio: new Uint8Array([1, 2, 3]) }, "session-active", 1024),
    /Invalid recorder audio payload/,
  );
});

test("recorder IPC validation rejects oversized audio", () => {
  assert.throws(
    () => validateRecorderStoppedPayload({ sessionId: "session-active", audio: new ArrayBuffer(1025) }, "session-active", 1024),
    /Recording is too large/,
  );
});

test("recorder microphone test validation requires active request id", () => {
  assert.deepEqual(validateRecorderMicTestedPayload({ ok: true, requestId: "mic-test-1" }, "mic-test-1"), {
    ok: true,
    requestId: "mic-test-1",
    message: "",
  });

  assert.throws(
    () => validateRecorderMicTestedPayload({ ok: true, requestId: "mic-test-2" }, "mic-test-1"),
    /Invalid microphone test request id/,
  );
});
