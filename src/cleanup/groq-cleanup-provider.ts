import Groq from "groq-sdk";
import { logger } from "../observability/app-logger.js";
import { normalizeError, retryTransient } from "../observability/errors.js";
import type { OperationContext } from "../types.js";
import {
  estimateOutputTokens,
  isTruncated,
  truncationError,
  withReasoningEffort,
} from "../llm/completion-budget.js";
import { withModelFallback } from "../llm/model-fallback.js";
import type { ModelCooldownManager } from "../llm/model-cooldown.js";
import { buildCleanupPrompt, type CleanupOptions, type CleanupProvider } from "./cleanup-provider.js";

const GROQ_TIMEOUT_MS = 45_000;

export class GroqCleanupProvider implements CleanupProvider {
  private readonly client: Groq;
  private readonly model: string;
  private readonly fallbackModel: string;
  private readonly cooldown?: ModelCooldownManager;

  constructor(apiKey: string, model: string, fallbackModel = "", cooldown?: ModelCooldownManager) {
    this.client = new Groq({ apiKey, timeout: GROQ_TIMEOUT_MS, maxRetries: 0 });
    this.model = model;
    this.fallbackModel = fallbackModel.trim();
    this.cooldown = cooldown;
  }

  async clean(input: string, options: CleanupOptions, context: OperationContext = {}): Promise<string> {
    const trimmed = input.trim();
    if (!trimmed) {
      return "";
    }

    return withModelFallback({
      primary: this.model,
      fallback: this.fallbackModel,
      cooldown: this.cooldown,
      label: "cleanup",
      context,
      run: (model, isFallback) => this.cleanWithModel(trimmed, model, options, context, isFallback),
    });
  }

  private async cleanWithModel(
    trimmed: string,
    model: string,
    options: CleanupOptions,
    context: OperationContext,
    isFallback: boolean,
  ): Promise<string> {
    const startedAt = Date.now();
    const requestId = context.requestId || createRequestId("cleanup");
    const prompt = buildCleanupPrompt(trimmed, options);
    const maxOutputTokens = estimateCleanupOutputTokens(trimmed, model);

    void logger.info("groq.cleanup.start", {
      ...context,
      requestId,
      model,
      isFallback,
      inputChars: trimmed.length,
      promptChars: prompt.length,
      maxOutputTokens,
      vocabularyTerms: options.vocabulary?.length ?? 0,
      outputLanguage: options.outputLanguage || undefined,
    });

    try {
      const completion = await retryTransient(
        () =>
          // Dictation cleanup is latency sensitive and needs no deep reasoning.
          // The hint is dropped automatically if the API rejects it.
          withReasoningEffort(
            model,
            (extraParams) =>
              this.client.chat.completions.create({
                model,
                temperature: 0,
                max_completion_tokens: maxOutputTokens,
                ...extraParams,
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
            () => logger.warn("groq.cleanup.reasoning_effort_unsupported", { ...context, requestId, model }),
          ),
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

      const choice = completion.choices[0];
      if (isTruncated(choice?.finish_reason)) {
        // Throwing here is the safe path: the dictation pipeline catches cleanup
        // failures and inserts the raw transcript instead of a clipped one.
        throw truncationError(model, maxOutputTokens);
      }

      // An empty reply is legitimate here: the prompt asks for one when the audio
      // is silence. Keep the transcript rather than losing the user's words.
      const text = choice?.message?.content?.trim() || trimmed;
      void logger.info("groq.cleanup.success", {
        ...context,
        requestId,
        model,
        isFallback,
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
        model,
        isFallback,
        durationMs: Date.now() - startedAt,
        inputChars: trimmed.length,
        error: normalized,
      });
      throw error;
    }
  }
}

function estimateCleanupOutputTokens(input: string, model: string): number {
  // Cleanup never grows the text much; the headroom is for the model's thinking.
  return estimateOutputTokens(input.length, model, 128);
}

function createRequestId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
