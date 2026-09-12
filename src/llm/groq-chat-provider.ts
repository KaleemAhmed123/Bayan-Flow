import Groq from "groq-sdk";
import { createPrefixedId } from "../ids.js";
import { logger } from "../observability/logger.js";
import { normalizeError, retryTransient } from "../observability/errors.js";
import type { OperationContext } from "../types.js";
import { isTruncated, truncationError, withReasoningEffort } from "./completion-budget.js";
import { withModelFallback } from "./model-fallback.js";
import { buildClientOptions, type EndpointSettings } from "./client-options.js";
import type { ModelCooldownManager } from "./model-cooldown.js";
import {
  isRequestTooLargeError,
  maxDeclarableOutputTokens,
  outputLimitFromError,
  shrinkToLimit,
} from "./model-limits.js";

/**
 * One chat completion, described by the caller.
 *
 * `maxOutputTokens` is a function of the model because the budget depends on
 * which model is running, and the fallback model is not known until the primary
 * has already failed.
 */
export type ChatCompletionSpec = {
  /** Trimmed user text. Only used for logging and the empty-reply fallback. */
  input: string;
  systemPrompt: string;
  userPrompt: string;
  maxOutputTokens: (model: string) => number;
  /**
   * What an empty reply means. Cleanup asks for one when the audio was silence,
   * so keeping the input is right there; a rewrite that returns nothing failed.
   */
  onEmptyReply: "return-input" | "throw";
  /** Merged into every log line for this call, e.g. actionId and attempt. */
  logFields?: Record<string, unknown>;
};

/**
 * The shared body of every Groq chat call BayanFlow makes.
 *
 * Cleanup and rewrite were two classes with the same four fields, the same
 * constructor, the same `withModelFallback` wrapper, the same `retryTransient`
 * and `withReasoningEffort` nesting, the same truncation check, and the same
 * three log lines — roughly 120 duplicated lines whose only real differences
 * were a prompt, a label and what an empty reply means. Keeping them apart meant
 * every fix to the request path had to be made twice, and the rate-limit
 * handling below is exactly the kind of fix that would have drifted.
 *
 * Subclasses keep their own public method (`clean`, `rewrite`) so callers and
 * tests are unchanged; all they do is build a spec.
 */
export abstract class GroqChatProvider {
  protected readonly client: Groq;
  protected readonly model: string;
  protected readonly fallbackModel: string;
  protected readonly cooldown?: ModelCooldownManager;

  constructor(
    apiKey: string,
    model: string,
    fallbackModel = "",
    cooldown?: ModelCooldownManager,
    endpoint: EndpointSettings = {},
    /** Prefixes every log event and request id, e.g. "cleanup" or "rewrite". */
    private readonly label: string = "chat",
  ) {
    this.client = new Groq(buildClientOptions(apiKey, endpoint));
    this.model = model;
    this.fallbackModel = fallbackModel.trim();
    this.cooldown = cooldown;
  }

  /** Runs the spec against the primary model, falling back to the backup. */
  protected complete(spec: ChatCompletionSpec, context: OperationContext = {}): Promise<string> {
    return withModelFallback({
      primary: this.model,
      fallback: this.fallbackModel,
      cooldown: this.cooldown,
      label: this.label,
      context,
      run: (model, isFallback) => this.completeWithModel(spec, model, context, isFallback),
    });
  }

  private async completeWithModel(
    spec: ChatCompletionSpec,
    model: string,
    context: OperationContext,
    isFallback: boolean,
  ): Promise<string> {
    // The prompt and the reply share one per-minute allowance, so the ceiling we
    // declare has to leave room for the prompt rather than assume it is free.
    const wanted = spec.maxOutputTokens(model);
    const ceiling = maxDeclarableOutputTokens(model, spec.userPrompt.length + spec.systemPrompt.length);
    const capped = Math.min(wanted, ceiling);

    try {
      return await this.sendOnce(spec, model, context, isFallback, capped);
    } catch (error) {
      // The provider names the real limit in the rejection, which beats any table
      // we keep by hand: it is this organisation, this model, this minute. The
      // documented remedy is literally "reduce max_tokens and try again", so do
      // exactly that, once.
      const limit = isRequestTooLargeError(error) ? outputLimitFromError(error) : undefined;
      if (limit === undefined) {
        throw error;
      }

      const retryTokens = shrinkToLimit(limit);
      if (retryTokens >= capped) {
        throw error;
      }

      void logger.warn(`groq.${this.label}.retry_smaller_budget`, {
        ...context,
        model,
        requestedTokens: capped,
        providerLimit: limit,
        retryTokens,
      });
      return this.sendOnce(spec, model, context, isFallback, retryTokens);
    }
  }

  private async sendOnce(
    spec: ChatCompletionSpec,
    model: string,
    context: OperationContext,
    isFallback: boolean,
    maxOutputTokens: number,
  ): Promise<string> {
    const startedAt = Date.now();
    const requestId = context.requestId || createPrefixedId(this.label);
    const logBase = {
      ...context,
      ...spec.logFields,
      requestId,
      model,
      isFallback,
    };

    void logger.info(`groq.${this.label}.start`, {
      ...logBase,
      inputChars: spec.input.length,
      promptChars: spec.userPrompt.length,
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
                  { role: "system", content: spec.systemPrompt },
                  { role: "user", content: spec.userPrompt },
                ],
              }),
            () => logger.warn(`groq.${this.label}.reasoning_effort_unsupported`, logBase),
          ),
        {
          category: "cleanup",
          onRetry: (attempt, error) => logger.warn(`groq.${this.label}.retry`, { ...logBase, attempt, error }),
        },
      );

      const choice = completion.choices[0];
      if (isTruncated(choice?.finish_reason)) {
        // Returning a half-sentence and calling it success is worse than failing.
        // Cleanup's caller catches this and inserts the raw transcript instead.
        throw truncationError(model, maxOutputTokens);
      }

      const reply = choice?.message?.content?.trim() || "";
      if (!reply && spec.onEmptyReply === "throw") {
        throw new Error(`The model returned no ${this.label} text.`);
      }

      const text = reply || spec.input;
      void logger.info(`groq.${this.label}.success`, {
        ...logBase,
        durationMs: Date.now() - startedAt,
        inputChars: spec.input.length,
        outputChars: text.length,
        usage: completion.usage,
      });

      return text;
    } catch (error) {
      void logger.error(`groq.${this.label}.failed`, {
        ...logBase,
        durationMs: Date.now() - startedAt,
        inputChars: spec.input.length,
        error: normalizeError("cleanup", error),
      });
      throw error;
    }
  }
}
