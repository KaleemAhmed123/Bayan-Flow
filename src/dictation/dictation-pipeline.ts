import type { CleanupOptions } from "../cleanup/cleanup-provider.js";
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

export async function runDictationPipelineWithProviders(options: {
  audioPath: string;
  context: OperationContext;
  cleanupEnabled: boolean;
  transcriptionRequestId: string;
  cleanupRequestId: string;
  transcription: TranscriptionLike;
  cleanup?: CleanupLike;
  onStage?: (stage: DictationPipelineStage) => void | Promise<void>;
  onCleanupFallback?: (error: NormalizedError, rawText: string) => void | Promise<void>;
}): Promise<DictationPipelineResult> {
  await options.onStage?.("transcribing");
  const rawText = await options.transcription.transcribe(options.audioPath, {
    ...options.context,
    requestId: options.transcriptionRequestId,
  }, {
    language: "en",
  });

  const rawTextValue = rawText.text;

  if (!options.cleanupEnabled || !options.cleanup) {
    return {
      status: "success",
      cleanupFallback: false,
      result: { rawText: rawTextValue, finalText: rawTextValue, cleanupFallback: false },
    };
  }

  try {
    await options.onStage?.("cleaning");
    const finalText = await options.cleanup.clean(
      rawTextValue,
      { mode: "default" },
      {
        ...options.context,
        requestId: options.cleanupRequestId,
      },
    );

    return {
      status: "success",
      cleanupFallback: false,
      result: { rawText: rawTextValue, finalText, cleanupFallback: false },
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
