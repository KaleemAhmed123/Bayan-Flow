import Groq from "groq-sdk";
import { logger } from "../observability/app-logger.js";
import { normalizeError, retryTransient } from "../observability/errors.js";
import type { OperationContext } from "../types.js";
import { buildRewritePrompt, type RewriteActionId } from "./rewrite-actions.js";

const GROQ_TIMEOUT_MS = 45_000;
const MIN_REWRITE_OUTPUT_TOKENS = 96;
const MAX_REWRITE_OUTPUT_TOKENS = 1_400;

export type RewriteOptions = {
  actionId: RewriteActionId;
  customInstruction?: string;
};

export class GroqRewriteProvider {
  private readonly client: Groq;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.client = new Groq({ apiKey, timeout: GROQ_TIMEOUT_MS, maxRetries: 0 });
    this.model = model;
  }

  async rewrite(input: string, options: RewriteOptions, context: OperationContext = {}): Promise<string> {
    const trimmed = input.trim();
    const prompt = buildRewritePrompt(trimmed, options.actionId, options.customInstruction);
    const requestId = context.requestId || createRequestId("rewrite");
    const maxOutputTokens = estimateRewriteOutputTokens(trimmed, options.actionId);
    const startedAt = Date.now();

    void logger.info("groq.rewrite.start", {
      ...context,
      requestId,
      model: this.model,
      actionId: options.actionId,
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
                  "You are a careful writing assistant. Follow the user's requested text operation, avoid unsupported factual invention, and return only the final output.",
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
            logger.warn("groq.rewrite.retry", {
              ...context,
              requestId,
              attempt,
              error,
            }),
        },
      );

      const text = completion.choices[0]?.message?.content?.trim() || trimmed;
      void logger.info("groq.rewrite.success", {
        ...context,
        requestId,
        model: this.model,
        actionId: options.actionId,
        durationMs: Date.now() - startedAt,
        inputChars: trimmed.length,
        outputChars: text.length,
        usage: completion.usage,
      });

      return text;
    } catch (error) {
      const normalized = normalizeError("cleanup", error);
      void logger.error("groq.rewrite.failed", {
        ...context,
        requestId,
        model: this.model,
        actionId: options.actionId,
        durationMs: Date.now() - startedAt,
        inputChars: trimmed.length,
        error: normalized,
      });
      throw error;
    }
  }
}

function estimateRewriteOutputTokens(input: string, actionId: RewriteActionId): number {
  const estimatedInputTokens = Math.ceil(input.length / 4);
  const extraBudget = actionId === "custom" ? 512 : 128;
  return Math.min(MAX_REWRITE_OUTPUT_TOKENS, Math.max(MIN_REWRITE_OUTPUT_TOKENS, estimatedInputTokens + extraBudget));
}

function createRequestId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
