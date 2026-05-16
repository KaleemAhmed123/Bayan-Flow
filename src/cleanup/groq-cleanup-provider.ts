import Groq from "groq-sdk";
import { logger } from "../observability/app-logger.js";
import { normalizeError, retryTransient } from "../observability/errors.js";
import type { OperationContext } from "../types.js";
import { buildCleanupPrompt, type CleanupOptions, type CleanupProvider } from "./cleanup-provider.js";

const GROQ_TIMEOUT_MS = 45_000;
const MIN_CLEANUP_OUTPUT_TOKENS = 96;
const MAX_CLEANUP_OUTPUT_TOKENS = 900;

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
    const maxOutputTokens = estimateCleanupOutputTokens(trimmed);

    void logger.info("groq.cleanup.start", {
      ...context,
      requestId,
      model: this.model,
      inputChars: trimmed.length,
      promptChars: prompt.length,
      maxOutputTokens,
    });

    try {
      const completion = await retryTransient(
        () =>
          this.client.chat.completions.create({
            model: this.model,
            temperature: 0,
            max_completion_tokens: maxOutputTokens,
            messages: [
              {
                role: "system",
                content:
                  "You are a constrained transcript cleanup engine. Fix punctuation, spacing, capitalization, and obvious ASR artifacts while preserving meaning. Do not summarize, explain, answer, expand, or invent. Preserve commands, code-like tokens, filenames, URLs, and product names. Return only cleaned text.",
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

function estimateCleanupOutputTokens(input: string): number {
  const estimatedInputTokens = Math.ceil(input.length / 4);
  return Math.min(MAX_CLEANUP_OUTPUT_TOKENS, Math.max(MIN_CLEANUP_OUTPUT_TOKENS, estimatedInputTokens + 64));
}

function createRequestId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
