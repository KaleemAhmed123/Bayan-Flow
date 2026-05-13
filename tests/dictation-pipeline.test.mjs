import assert from "node:assert/strict";
import test from "node:test";
import { runDictationPipelineWithProviders } from "../dist/dictation/dictation-pipeline.js";

test("dictation pipeline returns cleaned text when cleanup succeeds", async () => {
  const output = await runDictationPipelineWithProviders({
    audioPath: "audio.webm",
    context: { sessionId: "s1" },
    cleanupEnabled: true,
    transcriptionRequestId: "t1",
    cleanupRequestId: "c1",
    transcription: { transcribe: async () => "raw words" },
    cleanup: { clean: async () => "clean words" },
  });

  assert.equal(output.status, "success");
  assert.equal(output.result.rawText, "raw words");
  assert.equal(output.result.finalText, "clean words");
});

test("dictation pipeline treats cleanup failure as raw transcript fallback", async () => {
  let fallbackError;
  const output = await runDictationPipelineWithProviders({
    audioPath: "audio.webm",
    context: { sessionId: "s1" },
    cleanupEnabled: true,
    transcriptionRequestId: "t1",
    cleanupRequestId: "c1",
    transcription: { transcribe: async () => "raw words" },
    cleanup: { clean: async () => { throw Object.assign(new Error("bad model"), { status: 404 }); } },
    onCleanupFallback: (error) => {
      fallbackError = error;
    },
  });

  assert.equal(output.status, "cleanup_fallback");
  assert.equal(fallbackError.userMessage, "Groq model or request is invalid");
  assert.equal(output.result.finalText, "raw words");
  assert.equal(output.result.cleanupFallback, true);
});

test("dictation pipeline lets transcription failure fail hard", async () => {
  await assert.rejects(
    () =>
      runDictationPipelineWithProviders({
        audioPath: "audio.webm",
        context: { sessionId: "s1" },
        cleanupEnabled: true,
        transcriptionRequestId: "t1",
        cleanupRequestId: "c1",
        transcription: { transcribe: async () => { throw new Error("network down"); } },
        cleanup: { clean: async () => "clean words" },
      }),
    /network down/,
  );
});
