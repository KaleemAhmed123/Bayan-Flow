import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildCasePayload, writeCase } from "../dist/debug/case-export.js";

const baseCase = {
  at: Date.UTC(2026, 8, 9, 12, 0, 0),
  audioPath: null,
  rawText: "um so i think we should move the deadline to friday",
  finalText: "I think we should move the deadline to Friday.",
  transcriptionModel: "whisper-large-v3",
  cleanupModel: "openai/gpt-oss-120b",
  cleanupFallbackModel: "openai/gpt-oss-20b",
  transcriptionLanguage: "",
  outputLanguage: "",
  vocabulary: ["Ayesha"],
  appContext: {
    appName: "Google Chrome",
    windowTitle: "Inbox - Gmail - Google Chrome",
    activity: "Writing an email.",
    visibleNames: [],
    usedScreenshot: false,
    blocked: false,
  },
  cleanupEnabled: true,
  preserveExactWording: false,
  durationMs: 2100,
};

test("the case carries both transcripts and flags whether cleanup changed anything", () => {
  const payload = buildCasePayload(baseCase);

  assert.equal(payload.transcript.raw, baseCase.rawText);
  assert.equal(payload.transcript.final, baseCase.finalText);
  assert.equal(payload.transcript.changed, true);

  const unchanged = buildCasePayload({ ...baseCase, finalText: baseCase.rawText });
  assert.equal(unchanged.transcript.changed, false);
});

test("the exact cleanup prompt is reproduced, not summarised", () => {
  // Rebuilding beats recording: buildCleanupPrompt is deterministic, so the
  // result is identical without threading prompt capture through the providers.
  const payload = buildCasePayload(baseCase);

  assert.match(payload.cleanupPrompt, /um so i think we should move the deadline/);
  assert.match(payload.cleanupPrompt, /Ayesha/);
  assert.match(payload.cleanupPrompt, /Inbox - Gmail - Google Chrome/);
});

test("no cleanup prompt when polish was switched off", () => {
  const payload = buildCasePayload({ ...baseCase, cleanupEnabled: false });
  assert.equal(payload.cleanupPrompt, null);
});

test("verbatim plus translation reproduces the verbatim prompt", () => {
  const payload = buildCasePayload({ ...baseCase, preserveExactWording: true, outputLanguage: "es" });
  assert.match(payload.cleanupPrompt, /Mode: verbatim/);
});

test("settings and outcome are recorded so a run can be repeated", () => {
  const payload = buildCasePayload({
    ...baseCase,
    cleanupError: "cleanup failed; raw transcript inserted",
    instructionGuardTripped: true,
  });

  assert.equal(payload.settings.transcriptionModel, "whisper-large-v3");
  assert.equal(payload.settings.transcriptionLanguage, "auto");
  assert.equal(payload.settings.outputLanguage, "same");
  assert.deepEqual(payload.settings.vocabulary, ["Ayesha"]);
  assert.equal(payload.outcome.instructionGuardTripped, true);
  assert.match(payload.outcome.cleanupError, /cleanup failed/);
});

test("the case says out loud what it contains", () => {
  // This bundle holds what the rest of the app refuses to store, so whoever
  // opens it should not have to infer that from the contents.
  const notes = buildCasePayload(baseCase).notes.join(" ");
  assert.match(notes, /your spoken words and the audio/);
  assert.match(notes, /Share it only with someone you trust/);
  assert.match(notes, /screenshot.*NOT included/);
});

test("a missing context is recorded as absent rather than invented", () => {
  const payload = buildCasePayload({ ...baseCase, appContext: null });
  assert.equal(payload.context, null);
});

test("writeCase produces a folder with the case file and the audio", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "bayan-case-"));
  const audioPath = path.join(parent, "recording.webm");
  await writeFile(audioPath, "fake-audio", "utf8");

  const caseDir = await writeCase(parent, { ...baseCase, audioPath });
  const files = await readdir(caseDir);

  assert.ok(files.includes("case.json"));
  assert.ok(files.includes("recording.webm"), "the audio is what makes the case reproducible");

  const written = JSON.parse(await readFile(path.join(caseDir, "case.json"), "utf8"));
  assert.equal(written.audioFile, "recording.webm");
  assert.equal(written.transcript.raw, baseCase.rawText);
});

test("a missing audio file yields a thinner case, not a failed export", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "bayan-case-"));

  const caseDir = await writeCase(parent, { ...baseCase, audioPath: path.join(parent, "gone.webm") });
  const files = await readdir(caseDir);

  assert.ok(files.includes("case.json"));
  assert.equal(files.includes("gone.webm"), false);
});
