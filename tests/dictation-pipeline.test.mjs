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
    transcription: { transcribe: async () => ({ text: "raw words", language: "en", segments: [], confidence: { weakSegmentCount: 0, averageLogprob: null, highNoSpeechSegmentCount: 0, bucket: "strong", retried: false } }) },
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
    transcription: { transcribe: async () => ({ text: "raw words", language: "en", segments: [], confidence: { weakSegmentCount: 0, averageLogprob: null, highNoSpeechSegmentCount: 0, bucket: "strong", retried: false } }) },
    cleanup: { clean: async () => { throw Object.assign(new Error("bad model"), { status: 404 }); } },
    onCleanupFallback: (error) => {
      fallbackError = error;
    },
  });

  assert.equal(output.status, "cleanup_fallback");
  assert.equal(fallbackError.userMessage, "That AI model is no longer available. Open Settings to choose another.");
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

test("dictation pipeline defaults to auto-detect rather than forcing a language", async () => {
  let capturedOptions;
  const output = await runDictationPipelineWithProviders({
    audioPath: "audio.webm",
    context: { sessionId: "s1" },
    cleanupEnabled: false,
    transcriptionRequestId: "t1",
    cleanupRequestId: "c1",
    transcription: {
      transcribe: async (_audioPath, _context, options) => {
        capturedOptions = options;
        return {
          text: "raw words",
          language: "en",
          segments: [],
          confidence: {
            weakSegmentCount: 0,
            averageLogprob: null,
            highNoSpeechSegmentCount: 0,
            bucket: "strong",
            retried: false,
          },
        };
      },
    },
  });

  assert.equal(output.result.finalText, "raw words");
  // Empty language means auto-detect. Forcing "en" made the app useless for
  // anyone dictating in another language and degraded accented English.
  assert.deepEqual(capturedOptions, { language: "", vocabulary: undefined });
});

test("dictation pipeline forwards language and vocabulary when configured", async () => {
  let transcriptionOptions;
  let cleanupOptions;

  await runDictationPipelineWithProviders({
    audioPath: "audio.webm",
    context: { sessionId: "s1" },
    cleanupEnabled: true,
    transcriptionRequestId: "t1",
    cleanupRequestId: "c1",
    transcriptionLanguage: "ur",
    outputLanguage: "en",
    vocabulary: ["Aysha", "BayanFlow"],
    transcription: {
      transcribe: async (_audioPath, _context, options) => {
        transcriptionOptions = options;
        return {
          text: "raw words",
          language: "ur",
          segments: [],
          confidence: {
            weakSegmentCount: 0,
            averageLogprob: null,
            highNoSpeechSegmentCount: 0,
            bucket: "strong",
            retried: false,
          },
        };
      },
    },
    cleanup: {
      clean: async (_input, options) => {
        cleanupOptions = options;
        return "clean words";
      },
    },
  });

  assert.equal(transcriptionOptions.language, "ur");
  assert.deepEqual(transcriptionOptions.vocabulary, ["Aysha", "BayanFlow"]);
  assert.equal(cleanupOptions.outputLanguage, "en");
  assert.deepEqual(cleanupOptions.vocabulary, ["Aysha", "BayanFlow"]);
});

test("dictation pipeline reports user-facing processing stages", async () => {
  const stages = [];
  const output = await runDictationPipelineWithProviders({
    audioPath: "audio.webm",
    context: { sessionId: "s1" },
    cleanupEnabled: true,
    transcriptionRequestId: "t1",
    cleanupRequestId: "c1",
    transcription: { transcribe: async () => ({ text: "raw words", language: "en", segments: [], confidence: { weakSegmentCount: 0, averageLogprob: null, highNoSpeechSegmentCount: 0, bucket: "strong", retried: false } }) },
    cleanup: { clean: async () => "clean words" },
    onStage: (stage) => stages.push(stage),
  });

  assert.equal(output.result.finalText, "clean words");
  assert.deepEqual(stages, ["transcribing", "cleaning"]);
});
