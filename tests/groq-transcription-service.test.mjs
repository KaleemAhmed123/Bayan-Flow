import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { GroqTranscriptionService, suppressHallucination } from "../dist/transcription/groq-transcription-service.js";

test("groq transcription omits language entirely when auto-detecting", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "whispr-stt-"));
  const audioPath = path.join(dir, "audio.webm");
  await writeFile(audioPath, "test-audio", "utf8");

  const calls = [];
  const service = new GroqTranscriptionService("gsk_test_key", "whisper-large-v3");
  service.client = {
    audio: {
      transcriptions: {
        create: async (request) => {
          calls.push(request);
          return {
            text: "hello world",
            language: "en",
            segments: [{ avg_logprob: -0.12, no_speech_prob: 0.01, text: "hello world" }],
          };
        },
      },
    },
  };

  const result = await service.transcribe(audioPath, { sessionId: "s1" });

  assert.equal(result.text, "hello world");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, "whisper-large-v3");
  // Absent, not empty: sending a language forces the model to decode as that
  // language, which mangles anything else the user actually said.
  assert.ok(!("language" in calls[0]), "language should be omitted for auto-detect");
  assert.equal(calls[0].response_format, "verbose_json");
  assert.equal(calls[0].temperature, 0);
  assert.match(calls[0].prompt, /This is voice dictation\./);
});

test("groq transcription sends the configured language and vocabulary", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "whispr-stt-"));
  const audioPath = path.join(dir, "audio.webm");
  await writeFile(audioPath, "test-audio", "utf8");

  const calls = [];
  const service = new GroqTranscriptionService("gsk_test_key", "whisper-large-v3");
  service.client = {
    audio: {
      transcriptions: {
        create: async (request) => {
          calls.push(request);
          return { text: "hello", language: "ur", segments: [{ avg_logprob: -0.1, no_speech_prob: 0.01 }] };
        },
      },
    },
  };

  await service.transcribe(audioPath, { sessionId: "s1" }, { language: "ur", vocabulary: ["Aysha", "Zubair"] });

  assert.equal(calls[0].language, "ur");
  assert.match(calls[0].prompt, /language code "ur"/);
  assert.match(calls[0].prompt, /Aysha, Zubair/);
});

test("groq transcription retries once on weak metadata", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "whispr-stt-"));
  const audioPath = path.join(dir, "audio.webm");
  await writeFile(audioPath, "test-audio", "utf8");

  const calls = [];
  const service = new GroqTranscriptionService("gsk_test_key", "whisper-large-v3");
  service.client = {
    audio: {
      transcriptions: {
        create: async (request) => {
          calls.push(request);
          if (calls.length === 1) {
            return {
              text: "unclear result",
              language: "en",
              segments: [{ avg_logprob: -0.7, no_speech_prob: 0.1, text: "unclear result" }],
            };
          }

          return {
            text: "clear result",
            language: "en",
            segments: [{ avg_logprob: -0.1, no_speech_prob: 0.01, text: "clear result" }],
          };
        },
      },
    },
  };

  const result = await service.transcribe(audioPath, { sessionId: "s1" });

  assert.equal(result.text, "clear result");
  assert.equal(result.confidence.retried, true);
  assert.equal(calls.length, 2);
  assert.match(calls[1].prompt, /prefer minimal correction/);
});

/* ---------------------------------------------------------------- *
 * Silence-artefact suppression
 * ---------------------------------------------------------------- */

test("suppressHallucination drops a stock phrase when the model reports no speech", () => {
  const result = suppressHallucination("Thank you for watching.", [
    { no_speech_prob: 0.92, text: "Thank you for watching." },
  ]);

  assert.equal(result.text, "");
  assert.equal(result.suppressed, true);
  assert.equal(result.reason, "silence_artifact");
});

test("suppressHallucination keeps a real short reply the model heard clearly", () => {
  const result = suppressHallucination("Thank you", [{ no_speech_prob: 0.01, text: "Thank you" }]);

  assert.equal(result.text, "Thank you");
  assert.equal(result.suppressed, false);
  assert.equal(result.reason, "speech_likely");
});

test("suppressHallucination fails open when the provider sends no segment metadata", () => {
  const result = suppressHallucination("Thank you for watching.", []);

  assert.equal(result.text, "Thank you for watching.");
  assert.equal(result.suppressed, false);
  assert.equal(result.reason, "no_segment_metadata");
});

test("suppressHallucination ignores punctuation and casing when matching", () => {
  for (const variant of ["thank you for watching", "THANK YOU, FOR WATCHING!", "  Thank you for watching.  "]) {
    const result = suppressHallucination(variant, [{ no_speech_prob: 0.9 }]);
    assert.equal(result.suppressed, true, `expected ${JSON.stringify(variant)} to be suppressed`);
  }
});

test("suppressHallucination never touches genuine speech", () => {
  const result = suppressHallucination("thank you for the review, I will ship it today", [
    { no_speech_prob: 0.95 },
  ]);

  assert.equal(result.text, "thank you for the review, I will ship it today");
  assert.equal(result.suppressed, false);
});

test("suppressed silence does not trigger the low-confidence retry", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "whispr-stt-"));
  const audioPath = path.join(dir, "audio.webm");
  await writeFile(audioPath, "test-audio", "utf8");

  let calls = 0;
  const service = new GroqTranscriptionService("gsk_test_key", "whisper-large-v3");
  service.client = {
    audio: {
      transcriptions: {
        create: async () => {
          calls += 1;
          return {
            text: "Thank you for watching.",
            language: "en",
            segments: [{ avg_logprob: -0.9, no_speech_prob: 0.97, text: "Thank you for watching." }],
          };
        },
      },
    },
  };

  const result = await service.transcribe(audioPath, { sessionId: "s1" });

  assert.equal(result.text, "");
  assert.equal(result.confidence.hallucinationSuppressed, true);
  // Empty text and a weak logprob would both normally force a second attempt.
  assert.equal(calls, 1);
});
