import type { CleanupOptions } from "../cleanup/cleanup-provider.js";
import { looksLikeExecutedInstruction } from "../cleanup/instruction-guard.js";
import type { AppContextSnapshot } from "../context/context-rules.js";
import { normalizeError, type NormalizedError } from "../observability/errors.js";
import type { DictationResult, OperationContext } from "../types.js";
import type { GroqTranscriptionOptions, GroqTranscriptionResult } from "../transcription/groq-transcription-service.js";

export type TranscriptionLike = {
  transcribe(audioPath: string, context?: OperationContext, options?: GroqTranscriptionOptions): Promise<GroqTranscriptionResult>;
};

export type CleanupLike = {
  clean(input: string, options: CleanupOptions, context?: OperationContext): Promise<string>;
};

export type DictationPipelineResult =
  | { status: "success"; result: DictationResult; cleanupFallback: false }
  | { status: "cleanup_fallback"; result: DictationResult; cleanupFallback: true; error: NormalizedError };

export type DictationPipelineStage = "transcribing" | "cleaning";

export type DictationPipelineOptions = {
  audioPath: string;
  context: OperationContext;
  cleanupEnabled: boolean;
  transcriptionRequestId: string;
  cleanupRequestId: string;
  transcription: TranscriptionLike;
  cleanup?: CleanupLike;
  /** Empty means auto-detect. Never default this to a language. */
  transcriptionLanguage?: string;
  /** Empty means keep the spoken language. */
  outputLanguage?: string;
  /** User's names and jargon, used for recognition bias and cleanup spelling. */
  vocabulary?: string[];
  /** Keep the speaker's exact words. Translation, if requested, still runs. */
  preserveExactWording?: boolean;
  /** Fall back to the raw transcript when cleanup looks like it answered the dictation. */
  instructionGuardEnabled?: boolean;
  /**
   * Resolves the app context captured while the user was speaking. A function
   * rather than a value so the pipeline collects it at the last possible moment,
   * after transcription, giving the capture the most time to finish.
   */
  resolveAppContext?: () => Promise<AppContextSnapshot | null>;
  onStage?: (stage: DictationPipelineStage) => void | Promise<void>;
  onCleanupFallback?: (error: NormalizedError, rawText: string) => void | Promise<void>;
  /** Called when the guard rejected the model's output and the raw text was used. */
  onInstructionGuard?: (rawText: string) => void | Promise<void>;
};

/**
 * Which model call, if any, this dictation needs.
 *
 * Verbatim with no output language needs no model at all — the answer is the
 * input. Sending it anyway would spend a round trip to be handed back what we
 * already had.
 */
function resolveCleanupMode(options: DictationPipelineOptions): CleanupOptions["mode"] | "skip" {
  if (!options.cleanupEnabled || !options.cleanup) {
    return "skip";
  }

  if (options.preserveExactWording) {
    return options.outputLanguage?.trim() ? "verbatim" : "skip";
  }

  return "default";
}

export async function runDictationPipelineWithProviders(
  options: DictationPipelineOptions,
): Promise<DictationPipelineResult> {
  await options.onStage?.("transcribing");
  const rawText = await options.transcription.transcribe(options.audioPath, {
    ...options.context,
    requestId: options.transcriptionRequestId,
  }, {
    language: options.transcriptionLanguage ?? "",
    vocabulary: options.vocabulary,
  });

  const rawTextValue = rawText.text;
  const mode = resolveCleanupMode(options);

  if (mode === "skip" || !options.cleanup) {
    return {
      status: "success",
      cleanupFallback: false,
      result: { rawText: rawTextValue, finalText: rawTextValue, cleanupFallback: false },
    };
  }

  try {
    await options.onStage?.("cleaning");
    const cleanedText = await options.cleanup.clean(
      rawTextValue,
      {
        mode,
        vocabulary: options.vocabulary,
        outputLanguage: options.outputLanguage,
        // Never allowed to fail the dictation: worst case we clean without it.
        appContext: await options.resolveAppContext?.().catch(() => null),
      },
      {
        ...options.context,
        requestId: options.cleanupRequestId,
      },
    );

    // The guard only makes sense for a cleanup pass. In verbatim mode the model
    // was asked to translate, so low token overlap is the correct outcome.
    const guardTripped =
      mode === "default" &&
      options.instructionGuardEnabled !== false &&
      looksLikeExecutedInstruction({
        rawTranscript: rawTextValue,
        cleanedTranscript: cleanedText,
        outputLanguage: options.outputLanguage,
      });

    if (guardTripped) {
      await options.onInstructionGuard?.(rawTextValue);
      return {
        status: "success",
        cleanupFallback: false,
        result: { rawText: rawTextValue, finalText: rawTextValue, cleanupFallback: false },
      };
    }

    return {
      status: "success",
      cleanupFallback: false,
      result: { rawText: rawTextValue, finalText: cleanedText, cleanupFallback: false },
    };
  } catch (error) {
    const normalized = normalizeError("cleanup", error);
    await options.onCleanupFallback?.(normalized, rawTextValue);
    return {
      status: "cleanup_fallback",
      cleanupFallback: true,
      error: normalized,
      result: {
        rawText: rawTextValue,
        finalText: rawTextValue,
        cleanupFallback: true,
      },
    };
  }
}
