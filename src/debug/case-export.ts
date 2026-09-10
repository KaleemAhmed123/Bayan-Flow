/**
 * Exporting one dictation as a reproducible test case.
 *
 * WHY THIS EXISTS. Our logs deliberately redact transcript text, which is right
 * for privacy and leaves us blind: when someone reports "the output was wrong",
 * there is nothing to look at. Every quality complaint becomes guesswork, and
 * every prompt change is an untested guess about what it fixes.
 *
 * PRIVACY. This bundle is the most sensitive artefact the app can produce. It
 * deliberately contains everything we otherwise refuse to store: the audio, the
 * raw transcript, the cleaned text, and the exact prompts. So it is off by
 * default, produced only for one dictation at a time on an explicit action,
 * written only where the user points it, and never uploaded anywhere. Nothing
 * here runs unless the user turned it on and then asked for it.
 */

import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildCleanupPrompt } from "../cleanup/cleanup-provider.js";
import type { AppContextSnapshot } from "../context/context-rules.js";

/** Everything retained in memory about the last dictation, when capture is on. */
export type DebugCase = {
  at: number;
  /** Temp file still on disk because debug capture asked us not to delete it. */
  audioPath: string | null;
  rawText: string;
  finalText: string;
  transcriptionModel: string;
  cleanupModel: string;
  cleanupFallbackModel: string;
  transcriptionLanguage: string;
  outputLanguage: string;
  vocabulary: string[];
  appContext: AppContextSnapshot | null;
  cleanupEnabled: boolean;
  preserveExactWording: boolean;
  /** Milliseconds from recording stop to inserted text. */
  durationMs: number;
  /**
   * Where that time actually went. Already computed for `dictation.latency`;
   * kept here so the debug panel can answer "why was that slow" without the
   * user going to the log file.
   */
  timings?: {
    /** Waiting for the recorder to hand over the audio. Large means a cold mic. */
    recorderStopMs: number;
    /** Transcription plus cleanup. */
    pipelineMs: number;
    /** Focusing the target window and pasting. */
    insertionMs: number;
  };
  /** True when the fallback model answered because the primary was unavailable. */
  cleanupWasFallback?: boolean;
  /** Set when cleanup failed and the raw transcript was inserted instead. */
  cleanupError?: string;
  /** True when the instruction guard rejected the model's output. */
  instructionGuardTripped?: boolean;
};

export type CasePayload = ReturnType<typeof buildCasePayload>;

/**
 * Builds the case file.
 *
 * The cleanup prompt is REBUILT here from the stored inputs rather than captured
 * at request time. `buildCleanupPrompt` is deterministic, so the result is
 * identical, and it means no prompt-recording plumbing has to be threaded
 * through the providers and kept in sync forever.
 */
export function buildCasePayload(debugCase: DebugCase) {
  const mode = debugCase.preserveExactWording && debugCase.outputLanguage ? "verbatim" : "default";

  return {
    exportedAt: new Date().toISOString(),
    recordedAt: new Date(debugCase.at).toISOString(),
    audioFile: debugCase.audioPath ? path.basename(debugCase.audioPath) : null,
    transcript: {
      raw: debugCase.rawText,
      final: debugCase.finalText,
      changed: debugCase.rawText !== debugCase.finalText,
    },
    settings: {
      transcriptionModel: debugCase.transcriptionModel,
      cleanupModel: debugCase.cleanupModel,
      cleanupFallbackModel: debugCase.cleanupFallbackModel || null,
      transcriptionLanguage: debugCase.transcriptionLanguage || "auto",
      outputLanguage: debugCase.outputLanguage || "same",
      cleanupEnabled: debugCase.cleanupEnabled,
      preserveExactWording: debugCase.preserveExactWording,
      vocabulary: debugCase.vocabulary,
    },
    context: debugCase.appContext
      ? {
          appName: debugCase.appContext.appName,
          windowTitle: debugCase.appContext.windowTitle,
          activity: debugCase.appContext.activity,
          usedScreenshot: debugCase.appContext.usedScreenshot,
          blocked: debugCase.appContext.blocked,
          reason: debugCase.appContext.reason ?? null,
        }
      : null,
    outcome: {
      durationMs: debugCase.durationMs,
      // Absent on a case retained before timings were recorded, so every reader
      // must tolerate null rather than assume the field is there.
      timings: debugCase.timings ?? null,
      cleanupWasFallback: Boolean(debugCase.cleanupWasFallback),
      cleanupError: debugCase.cleanupError ?? null,
      instructionGuardTripped: Boolean(debugCase.instructionGuardTripped),
    },
    // The exact text the cleanup model was given, so the run can be repeated
    // outside the app with one variable changed at a time.
    cleanupPrompt: debugCase.cleanupEnabled
      ? buildCleanupPrompt(debugCase.rawText, {
          mode,
          vocabulary: debugCase.vocabulary,
          outputLanguage: debugCase.outputLanguage,
          appContext: debugCase.appContext,
        })
      : null,
    notes: [
      "This file contains your spoken words and the audio that produced them.",
      "It was created because you asked for it. Share it only with someone you trust.",
      "The context screenshot, if one was used, is NOT included: it is never written to disk.",
    ],
  };
}

/**
 * Writes the case into its own folder under `parentDir`.
 *
 * A folder rather than a zip on purpose: Node has no built-in archiver, and the
 * alternatives are a new dependency or shelling out to PowerShell. Neither earns
 * its keep when right-click → compress is one step for the user.
 */
export async function writeCase(
  parentDir: string,
  debugCase: DebugCase,
  now = new Date(),
): Promise<string> {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const caseDir = path.join(parentDir, `bayanflow-case-${stamp}`);
  await mkdir(caseDir, { recursive: true });

  const payload = buildCasePayload(debugCase);
  await writeFile(path.join(caseDir, "case.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  if (debugCase.audioPath) {
    // Copied rather than moved: the normal cleanup path still owns that temp
    // file and must be free to delete it afterwards.
    await copyFile(debugCase.audioPath, path.join(caseDir, path.basename(debugCase.audioPath))).catch(() => {
      // A missing audio file makes a thinner case, not a failed export.
    });
  }

  return caseDir;
}
