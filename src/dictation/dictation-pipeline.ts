import type { CleanupOptions } from "../cleanup/cleanup-provider.js";
import { normalizeError, type NormalizedError } from "../observability/errors.js";
import type { DictationResult, OperationContext } from "../types.js";

export type TranscriptionLike = {
  transcribe(audioPath: string, context?: OperationContext): Promise<string>;
};

export type CleanupLike = {
  clean(input: string, options: CleanupOptions, context?: OperationContext): Promise<string>;
};

export type DictationPipelineResult =
  | { status: "success"; result: DictationResult; cleanupFallback: false }
  | { status: "cleanup_fallback"; result: DictationResult; cleanupFallback: true; error: NormalizedError };

export async function runDictationPipelineWithProviders(options: {
  audioPath: string;
  context: OperationContext;
  cleanupEnabled: boolean;
  transcriptionRequestId: string;
  cleanupRequestId: string;
  transcription: TranscriptionLike;
  cleanup?: CleanupLike;
  onCleanupFallback?: (error: NormalizedError, rawText: string) => void | Promise<void>;
}): Promise<DictationPipelineResult> {
  const rawText = await options.transcription.transcribe(options.audioPath, {
    ...options.context,
    requestId: options.transcriptionRequestId,
  });

  if (!options.cleanupEnabled || !options.cleanup) {
    return {
      status: "success",
      cleanupFallback: false,
      result: { rawText, finalText: rawText, cleanupFallback: false },
    };
  }

  try {
    const finalText = await options.cleanup.clean(
      rawText,
      { mode: "default" },
      {
        ...options.context,
        requestId: options.cleanupRequestId,
      },
    );

    return {
      status: "success",
      cleanupFallback: false,
      result: { rawText, finalText, cleanupFallback: false },
    };
  } catch (error) {
    const normalized = normalizeError("cleanup", error);
    await options.onCleanupFallback?.(normalized, rawText);
    return {
      status: "cleanup_fallback",
      cleanupFallback: true,
      error: normalized,
      result: {
        rawText,
        finalText: rawText,
        cleanupFallback: true,
      },
    };
  }
}
