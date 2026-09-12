import Groq from "groq-sdk";
import { createPrefixedId } from "../ids.js";
import { logger } from "../observability/logger.js";
import { normalizeError, retryTransient } from "../observability/errors.js";
import type { OperationContext } from "../types.js";
import {
  estimateOutputTokens,
  isTruncated,
  truncationError,
  withReasoningEffort,
} from "../llm/completion-budget.js";
import { withModelFallback } from "../llm/model-fallback.js";
import { buildClientOptions, type EndpointSettings } from "../llm/client-options.js";
import type { ModelCooldownManager } from "../llm/model-cooldown.js";
import { buildRewritePrompt, type RewriteActionId } from "./rewrite-actions.js";


export type RewriteOptions = {
  actionId: RewriteActionId;
  customInstruction?: string;
  /** Above 1 when the user pressed Redo, so the model is asked to vary its wording. */
  attempt?: number;
  /**
   * User vocabulary. Rewrite needs this as much as dictation does: the names in
   * the text being rewritten are the same names the speech model gets wrong, and
   * a rewrite that "corrects" them back to the wrong spelling undoes the fix.
   */
  vocabulary?: string[];
};

export class GroqRewriteProvider {
  private readonly client: Groq;
  private readonly model: string;
  private readonly fallbackModel: string;
  private readonly cooldown?: ModelCooldownManager;

  constructor(
    apiKey: string,
    model: string,
    fallbackModel = "",
    cooldown?: ModelCooldownManager,
    endpoint: EndpointSettings = {},
  ) {
    this.client = new Groq(buildClientOptions(apiKey, endpoint));
    this.model = model;
    this.fallbackModel = fallbackModel.trim();
    this.cooldown = cooldown;
  }

  async rewrite(input: string, options: RewriteOptions, context: OperationContext = {}): Promise<string> {
    return withModelFallback({
      primary: this.model,
      fallback: this.fallbackModel,
      cooldown: this.cooldown,
      label: "rewrite",
      context,
      run: (model, isFallback) => this.rewriteWithModel(input, options, context, model, isFallback),
    });
  }

  private async rewriteWithModel(
    input: string,
    options: RewriteOptions,
    context: OperationContext,
    model: string,
    isFallback: boolean,
  ): Promise<string> {
    const trimmed = input.trim();
    const prompt = buildRewritePrompt(
      trimmed,
      options.actionId,
      options.customInstruction,
      options.attempt ?? 1,
      options.vocabulary,
    );
    const requestId = context.requestId || createPrefixedId("rewrite");
    const maxOutputTokens = estimateRewriteOutputTokens(trimmed, options.actionId, model);
    const startedAt = Date.now();

    void logger.info("groq.rewrite.start", {
      ...context,
      requestId,
      model,
      isFallback,
      actionId: options.actionId,
      attempt: options.attempt ?? 1,
      inputChars: trimmed.length,
      promptChars: prompt.length,
      maxOutputTokens,
    });

    try {
      const completion = await retryTransient(
        () =>
          // `reasoning_effort` is not in the installed SDK's types and the user
          // can set any model id, so it is applied only where it helps and
          // dropped automatically if the API rejects it.
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
                      "You are a careful writing assistant. Follow the user's requested text operation, avoid unsupported factual invention, and return only the final output.",
                  },
                  {
                    role: "user",
                    content: prompt,
                  },
                ],
              }),
            () => logger.warn("groq.rewrite.reasoning_effort_unsupported", { ...context, requestId, model }),
          ),
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

      const choice = completion.choices[0];
      if (isTruncated(choice?.finish_reason)) {
        // Returning a half-sentence and calling it success is worse than failing.
        throw truncationError(model, maxOutputTokens);
      }

      const text = choice?.message?.content?.trim() || "";
      if (!text) {
        throw new Error("The model returned no rewritten text.");
      }

      void logger.info("groq.rewrite.success", {
        ...context,
        requestId,
        model,
        isFallback,
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
        model,
        isFallback,
        actionId: options.actionId,
        durationMs: Date.now() - startedAt,
        inputChars: trimmed.length,
        error: normalized,
      });
      throw error;
    }
  }
}

function estimateRewriteOutputTokens(input: string, actionId: RewriteActionId, model: string): number {
  // A custom instruction can legitimately produce far more than it was given.
  return estimateOutputTokens(input.length, model, actionId === "custom" ? 1_024 : 256);
}

