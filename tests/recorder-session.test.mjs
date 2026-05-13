import assert from "node:assert/strict";
import test from "node:test";
import { RecorderSessionController } from "../dist/audio/recorder-session.js";

test("recorder session accepts start and stop for active session", async () => {
  const session = new RecorderSessionController();
  session.begin("s1");

  const started = session.waitForStart();
  assert.equal(session.acceptStart("s1"), true);
  await started;

  const stopped = session.waitForStop();
  assert.equal(session.acceptStop("s1", "audio.webm"), true);
  assert.equal(await stopped, "audio.webm");
  assert.equal(session.snapshot().activeSessionId, null);
});

test("recorder session rejects stale events", async () => {
  const session = new RecorderSessionController();
  session.begin("s1");

  assert.equal(session.acceptStart("stale"), false);
  assert.equal(session.acceptStop("stale", "late.webm"), false);
  assert.equal(session.fail("stale", "late error"), false);
  assert.equal(session.snapshot().activeSessionId, "s1");

  session.reset();
});

test("recorder session propagates start and stop failures", async () => {
  const startSession = new RecorderSessionController();
  startSession.begin("s1");
  const started = startSession.waitForStart();
  assert.equal(startSession.fail("s1", "permission denied"), true);
  await assert.rejects(() => started, /permission denied/);

  const stopSession = new RecorderSessionController();
  stopSession.begin("s2");
  const stopped = stopSession.waitForStop();
  assert.equal(stopSession.failStop("s2", "stop timeout"), true);
  await assert.rejects(() => stopped, /stop timeout/);
});
