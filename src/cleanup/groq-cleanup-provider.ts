import Groq from "groq-sdk";
import { logger } from "../observability/app-logger.js";
import { normalizeError, retryTransient } from "../observability/errors.js";
import type { OperationContext } from "../types.js";
import { buildCleanupPrompt, type CleanupOptions, type CleanupProvider } from "./cleanup-provider.js";

const GROQ_TIMEOUT_MS = 45_000;

export class GroqCleanupProvider implements CleanupProvider {
  private readonly client: Groq;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.client = new Groq({ apiKey, timeout: GROQ_TIMEOUT_MS, maxRetries: 0 });
    this.model = model;
  }

  async clean(input: string, options: CleanupOptions, context: OperationContext = {}): Promise<string> {
    const trimmed = input.trim();
    if (!trimmed) {
      return "";
    }

    const startedAt = Date.now();
    const requestId = context.requestId || createRequestId("cleanup");
    const prompt = buildCleanupPrompt(trimmed, options);

    void logger.info("groq.cleanup.start", {
      ...context,
      requestId,
      model: this.model,
      inputChars: trimmed.length,
      promptChars: prompt.length,
    });

    try {
      const completion = await retryTransient(
        () =>
          this.client.chat.completions.create({
            model: this.model,
            temperature: 0.1,
            max_completion_tokens: 700,
            messages: [
              {
                role: "system",
                content: "You clean dictated text for insertion into desktop apps. Return only cleaned text.",
              },
              {
                role: "user",
                content: prompt,
              },
            ],
          }),
        {
          category: "cleanup",
          onRetry: (attempt, error) =>
            logger.warn("groq.cleanup.retry", {
              ...context,
              requestId,
              attempt,
              error,
            }),
        },
      );

      const text = completion.choices[0]?.message?.content?.trim() || trimmed;
      void logger.info("groq.cleanup.success", {
        ...context,
        requestId,
        model: this.model,
        durationMs: Date.now() - startedAt,
        inputChars: trimmed.length,
        outputChars: text.length,
        usage: completion.usage,
      });

      return text;
    } catch (error) {
      const normalized = normalizeError("cleanup", error);
      void logger.error("groq.cleanup.failed", {
        ...context,
        requestId,
        model: this.model,
        durationMs: Date.now() - startedAt,
        inputChars: trimmed.length,
        error: normalized,
      });
      throw error;
    }
  }
}

function createRequestId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
