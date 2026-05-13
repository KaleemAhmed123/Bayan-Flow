import Groq from "groq-sdk";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { logger } from "../observability/app-logger.js";
import { normalizeError, retryTransient } from "../observability/errors.js";
import type { OperationContext } from "../types.js";
import { buildTranscriptionPrompt } from "./transcription-prompt.js";

const GROQ_TIMEOUT_MS = 45_000;
const WEAK_AVG_LOGPROB_THRESHOLD = -0.5;
const HIGH_NO_SPEECH_THRESHOLD = 0.75;

export type GroqTranscriptionSegment = {
  avg_logprob?: number;
  no_speech_prob?: number;
  text?: string;
};

export type GroqTranscriptionResult = {
  text: string;
  language: string;
  duration?: number;
  segments: GroqTranscriptionSegment[];
  confidence: {
    weakSegmentCount: number;
    averageLogprob: number | null;
    highNoSpeechSegmentCount: number;
    bucket: "strong" | "mixed" | "weak" | "empty";
    retried: boolean;
  };
};

export type GroqTranscriptionOptions = {
  language?: string;
  prompt?: string;
  retry?: boolean;
};

type GroqVerboseJsonResponse = {
  text?: string;
  language?: string;
  duration?: number;
  segments?: GroqTranscriptionSegment[];
};

export class GroqTranscriptionService {
  private readonly client: Groq;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.client = new Groq({ apiKey, timeout: GROQ_TIMEOUT_MS, maxRetries: 0 });
    this.model = model;
  }

  async transcribe(
    audioPath: string,
    context: OperationContext = {},
    options: GroqTranscriptionOptions = {},
  ): Promise<GroqTranscriptionResult> {
    return this.transcribeAttempt(audioPath, context, {
      language: options.language || "en",
      prompt: options.prompt || buildTranscriptionPrompt(),
      retry: false,
    });
  }

  private async transcribeAttempt(
    audioPath: string,
    context: OperationContext,
    options: Required<Pick<GroqTranscriptionOptions, "language" | "prompt">> & { retry: boolean },
  ): Promise<GroqTranscriptionResult> {
    const startedAt = Date.now();
    const requestId = context.requestId || createRequestId("transcription");
    const audioBytes = (await stat(audioPath)).size;

    void logger.info("groq.transcription.start", {
      ...context,
      requestId,
      model: this.model,
      audioBytes,
      language: options.language,
      retry: options.retry,
    });

    try {
      const transcription = (await retryTransient(
        () =>
          this.client.audio.transcriptions.create({
            file: createReadStream(audioPath),
            model: this.model,
            language: options.language,
            prompt: options.prompt,
            response_format: "verbose_json",
            temperature: 0,
          }),
        {
          category: "transcription",
          onRetry: (attempt, error) =>
            logger.warn("groq.transcription.retry", {
              ...context,
              requestId,
              attempt,
              error,
            }),
        },
      )) as GroqVerboseJsonResponse;

      const result = normalizeTranscriptionResult(transcription, options.retry);
      void logger.info("groq.transcription.success", {
        ...context,
        requestId,
        model: this.model,
        durationMs: Date.now() - startedAt,
        audioBytes,
        outputChars: result.text.length,
        confidence: result.confidence,
      });

      if (!options.retry && shouldRetryTranscription(result)) {
        void logger.warn("groq.transcription.low_confidence_retry", {
          ...context,
          requestId,
          model: this.model,
          confidence: result.confidence,
        });
        return this.transcribeAttempt(audioPath, context, {
          language: options.language,
          prompt: buildTranscriptionPrompt({ retry: true }),
          retry: true,
        });
      }

      return result;
    } catch (error) {
      const normalized = normalizeError("transcription", error);
      void logger.error("groq.transcription.failed", {
        ...context,
        requestId,
        model: this.model,
        durationMs: Date.now() - startedAt,
        audioBytes,
        error: normalized,
      });
      throw error;
    }
  }
}

function normalizeTranscriptionResult(
  transcription: GroqVerboseJsonResponse,
  retried: boolean,
): GroqTranscriptionResult {
  const text = transcription.text?.trim() || "";
  const segments = Array.isArray(transcription.segments) ? transcription.segments : [];
  const segmentsWithLogprob = segments.filter((segment) => typeof segment.avg_logprob === "number");
  const weakSegmentCount = segments.filter(
    (segment) =>
      typeof segment.avg_logprob === "number" && segment.avg_logprob <= WEAK_AVG_LOGPROB_THRESHOLD,
  ).length;
  const highNoSpeechSegmentCount = segments.filter(
    (segment) =>
      typeof segment.no_speech_prob === "number" && segment.no_speech_prob >= HIGH_NO_SPEECH_THRESHOLD,
  ).length;
  const averageLogprob =
    segmentsWithLogprob.length > 0
      ? segmentsWithLogprob.reduce((sum, segment) => sum + Number(segment.avg_logprob), 0) / segmentsWithLogprob.length
      : null;

  return {
    text,
    language: transcription.language || "en",
    duration: typeof transcription.duration === "number" ? transcription.duration : undefined,
    segments,
    confidence: {
      weakSegmentCount,
      averageLogprob,
      highNoSpeechSegmentCount,
      bucket: confidenceBucket(text, averageLogprob, weakSegmentCount),
      retried,
    },
  };
}

function confidenceBucket(
  text: string,
  averageLogprob: number | null,
  weakSegmentCount: number,
): GroqTranscriptionResult["confidence"]["bucket"] {
  if (!text) {
    return "empty";
  }

  if (averageLogprob !== null && averageLogprob <= WEAK_AVG_LOGPROB_THRESHOLD) {
    return "weak";
  }

  if (weakSegmentCount > 0) {
    return "mixed";
  }

  return "strong";
}

function shouldRetryTranscription(result: GroqTranscriptionResult): boolean {
  if (!result.text) {
    return true;
  }

  if (result.confidence.bucket === "weak") {
    return true;
  }

  return result.confidence.weakSegmentCount > 0 && result.confidence.averageLogprob !== null
    ? result.confidence.averageLogprob <= -0.35
    : false;
}

function createRequestId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
