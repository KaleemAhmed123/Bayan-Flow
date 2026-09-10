import assert from "node:assert/strict";
import test from "node:test";
import { AudioRecorder } from "../dist/audio/audio-recorder.js";

/**
 * Opening a microphone takes the renderer several hundred milliseconds. A key
 * press shorter than that used to send `recorder:stop` while the renderer was
 * still inside getUserMedia, which produced either a 0-byte file or a
 * headerless fragment that Groq rejects with "could not process file - is it a
 * valid media file?", and a late `recorder:started` for a dead session.
 *
 * Only `webContents.send` is stubbed. The session state machine runs for real,
 * because the ordering being asserted is the thing under test.
 */
function harness() {
  const sent = [];
  const recorder = new AudioRecorder();
  recorder.window = { webContents: { send: (channel) => sent.push(channel) } };
  return { recorder, sent };
}

const LIMITS = { maxDurationMs: 60_000, maxAudioBytes: 1_000_000 };
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("stop waits for the microphone to finish opening", async () => {
  const { recorder, sent } = harness();
  const sessionId = "session-race";

  const started = recorder.start({ sessionId }, LIMITS);
  assert.deepEqual(sent, ["recorder:start"]);

  // The key comes up before the renderer has acknowledged the start.
  const stopped = recorder.stop({ sessionId }, "manual");
  await settle();

  assert.deepEqual(sent, ["recorder:start"], "recorder:stop must not reach a renderer that is still starting");

  // The microphone finishes opening.
  recorder.session.acceptStart(sessionId);
  await started;
  await settle();

  assert.deepEqual(sent, ["recorder:start", "recorder:stop"], "stop is released once the recorder is actually running");

  recorder.session.acceptStop(sessionId, { audioPath: "audio.webm", stopReason: "manual" });
  assert.equal((await stopped).audioPath, "audio.webm");
});

test("a start that never arrives still lets stop fail cleanly", async () => {
  const { recorder } = harness();
  const sessionId = "session-doomed";

  const started = recorder.start({ sessionId }, LIMITS);
  recorder.session.fail(sessionId, "Recording timed out while starting.");
  await assert.rejects(started);

  // The failed start must not leave stop hanging on a promise that never settles.
  await assert.rejects(recorder.stop({ sessionId }, "manual"), /not active/i);
});
