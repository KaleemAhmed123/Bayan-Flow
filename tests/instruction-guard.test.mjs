import assert from "node:assert/strict";
import test from "node:test";
import { looksLikeExecutedInstruction } from "../dist/cleanup/instruction-guard.js";
import { runDictationPipelineWithProviders } from "../dist/dictation/dictation-pipeline.js";

const guard = (rawTranscript, cleanedTranscript, outputLanguage) =>
  looksLikeExecutedInstruction({ rawTranscript, cleanedTranscript, outputLanguage });

/* ---------------------------------------------------------------- *
 * The guard itself
 * ---------------------------------------------------------------- */

test("an assistant preamble the speaker never said is caught", () => {
  assert.equal(
    guard("write a message to john saying im running late", "Sure! Here's a message for John: Hi John, I'm running late today."),
    true,
  );
  assert.equal(guard("make a poem about the moon", "Certainly. The moon hangs silver in the night..."), true);
});

test("an instruction whose words survive is left alone", () => {
  // This is the correct behaviour: the speaker dictated a sentence ABOUT writing
  // a message, and cleanup returned that same sentence, tidied.
  assert.equal(
    guard("write a message to john saying im running late", "Write a message to John saying I'm running late."),
    false,
  );
  assert.equal(guard("ask claude to refactor the auth module", "Ask Claude to refactor the auth module."), false);
});

test("an instruction replaced by unrelated content is caught", () => {
  assert.equal(
    guard(
      "summarize the quarterly report for the leadership team",
      "Revenue grew twelve percent, headcount stayed flat, and the Berlin office opened in March.",
    ),
    true,
  );
});

test("ordinary dictation is never touched", () => {
  assert.equal(
    guard("um so i think we should uh move the deadline to friday", "I think we should move the deadline to Friday."),
    false,
  );
  assert.equal(guard("hey are you free tomorrow afternoon", "Hey, are you free tomorrow afternoon?"), false);
});

test("heavy filler removal alone does not trip the guard", () => {
  // Low overlap without an imperative marker is just aggressive cleanup.
  assert.equal(guard("um uh you know like so basically the thing is it works", "It works."), false);
});

test("translation switches the guard off entirely", () => {
  // A translated result legitimately shares almost no tokens with its source,
  // so every translation would otherwise trip.
  assert.equal(guard("write a message to john", "Escribe un mensaje a John.", "es"), false);
  assert.equal(guard("summarize this report", "Resume este informe.", "es"), false);
});

test("empty input on either side is not a trip", () => {
  assert.equal(guard("", "Sure! Here you go."), false);
  assert.equal(guard("write a message", ""), false);
});

/* ---------------------------------------------------------------- *
 * The guard inside the pipeline
 * ---------------------------------------------------------------- */

function transcriptionReturning(text) {
  return {
    transcribe: async () => ({
      text,
      language: "en",
      segments: [],
      confidence: {
        weakSegmentCount: 0,
        averageLogprob: null,
        highNoSpeechSegmentCount: 0,
        bucket: "strong",
        retried: false,
        hallucinationSuppressed: false,
      },
    }),
  };
}

const baseOptions = {
  audioPath: "audio.webm",
  context: { sessionId: "s1" },
  cleanupEnabled: true,
  transcriptionRequestId: "t1",
  cleanupRequestId: "c1",
};

test("a tripped guard pastes the raw transcript instead of the answer", async () => {
  let guarded = "";
  const output = await runDictationPipelineWithProviders({
    ...baseOptions,
    transcription: transcriptionReturning("write a message to john saying im running late"),
    cleanup: { clean: async () => "Sure! Here's a message: Hi John, apologies, I am running behind." },
    onInstructionGuard: (rawText) => {
      guarded = rawText;
    },
  });

  assert.equal(output.result.finalText, "write a message to john saying im running late");
  assert.equal(guarded, "write a message to john saying im running late");
  // Not a failure: we chose the user's words over the model's answer.
  assert.equal(output.cleanupFallback, false);
});

test("the guard can be switched off", async () => {
  const output = await runDictationPipelineWithProviders({
    ...baseOptions,
    instructionGuardEnabled: false,
    transcription: transcriptionReturning("write a message to john saying im running late"),
    cleanup: { clean: async () => "Sure! Here's a message: Hi John, apologies, I am running behind." },
  });

  assert.match(output.result.finalText, /^Sure!/);
});

/* ---------------------------------------------------------------- *
 * Verbatim mode
 * ---------------------------------------------------------------- */

test("keep-my-exact-words skips the model entirely when there is nothing to translate", async () => {
  let called = false;
  const output = await runDictationPipelineWithProviders({
    ...baseOptions,
    preserveExactWording: true,
    transcription: transcriptionReturning("um so i think we should move the deadline"),
    cleanup: {
      clean: async () => {
        called = true;
        return "polished";
      },
    },
  });

  assert.equal(output.result.finalText, "um so i think we should move the deadline");
  assert.equal(called, false, "no round trip should be spent to be handed back the input");
});

test("keep-my-exact-words still translates when a paste language is set", async () => {
  let mode = "";
  const output = await runDictationPipelineWithProviders({
    ...baseOptions,
    preserveExactWording: true,
    outputLanguage: "es",
    transcription: transcriptionReturning("i think we should move the deadline"),
    cleanup: {
      clean: async (_input, options) => {
        mode = options.mode;
        return "Creo que deberíamos mover la fecha límite";
      },
    },
  });

  assert.equal(mode, "verbatim");
  assert.equal(output.result.finalText, "Creo que deberíamos mover la fecha límite");
});

test("the guard does not run in verbatim mode", async () => {
  // The model was asked to translate, so low token overlap is the correct result
  // and must not be mistaken for the model answering the dictation.
  const output = await runDictationPipelineWithProviders({
    ...baseOptions,
    preserveExactWording: true,
    outputLanguage: "es",
    transcription: transcriptionReturning("write a message to john"),
    cleanup: { clean: async () => "Escribe un mensaje a John" },
  });

  assert.equal(output.result.finalText, "Escribe un mensaje a John");
});
