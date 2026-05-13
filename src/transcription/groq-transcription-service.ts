import Groq from "groq-sdk";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { logger } from "../observability/app-logger.js";
import { normalizeError, retryTransient } from "../observability/errors.js";
import type { OperationContext } from "../types.js";

const GROQ_TIMEOUT_MS = 45_000;

export class GroqTranscriptionService {
  private readonly client: Groq;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.client = new Groq({ apiKey, timeout: GROQ_TIMEOUT_MS, maxRetries: 0 });
    this.model = model;
  }

  async transcribe(audioPath: string, context: OperationContext = {}): Promise<string> {
    const startedAt = Date.now();
    const requestId = context.requestId || createRequestId("transcription");
    const audioBytes = (await stat(audioPath)).size;

    void logger.info("groq.transcription.start", {
      ...context,
      requestId,
      model: this.model,
      audioBytes,
    });

    try {
      const transcription = await retryTransient(
        () =>
          this.client.audio.transcriptions.create({
            file: createReadStream(audioPath),
            model: this.model,
            response_format: "json",
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
      );

      const text = transcription.text?.trim() || "";
      void logger.info("groq.transcription.success", {
        ...context,
        requestId,
        model: this.model,
        durationMs: Date.now() - startedAt,
        audioBytes,
        outputChars: text.length,
      });

      return text;
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

function createRequestId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
