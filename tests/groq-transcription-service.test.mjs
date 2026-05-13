import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { GroqTranscriptionService } from "../dist/transcription/groq-transcription-service.js";

test("groq transcription sends english verbose_json request", async () => {
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
  assert.equal(calls[0].language, "en");
  assert.equal(calls[0].response_format, "verbose_json");
  assert.equal(calls[0].temperature, 0);
  assert.match(calls[0].prompt, /This is English voice dictation/);
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
