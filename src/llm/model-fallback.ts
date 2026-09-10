/**
 * Running a chat request against a primary model with a backup behind it.
 *
 * Shared by cleanup and rewrite. Both need the identical behaviour — skip a
 * model we already know is rate limited, try the backup when the first one
 * fails, record the provider's cooldown on the way past — and duplicating it
 * meant one of them would eventually drift.
 */

import { logger } from "../observability/app-logger.js";
import { isRateLimitError, normalizeError } from "../observability/errors.js";
import { headersFromError } from "./rate-limit-headers.js";
import type { ModelCooldownManager } from "./model-cooldown.js";

/**
 * Models to try, in order, minus any the cooldown store already knows is blocked.
 *
 * An empty result is the useful case: everything is cooling down, so the caller
 * can fail without paying a round trip to be told what it already knew.
 */
export function candidateModels(
  primary: string,
  fallback: string,
  cooldown?: ModelCooldownManager,
): string[] {
  const trimmedFallback = fallback.trim();
  const candidates = trimmedFallback && trimmedFallback !== primary ? [primary, trimmedFallback] : [primary];

  return cooldown ? candidates.filter((model) => !cooldown.isInCooldown(model)) : candidates;
}

/** Human-readable "try again in ..." for a model that is still cooling down. */
export function describeCooldown(model: string, cooldown?: ModelCooldownManager): string {
  const endsAt = cooldown?.cooldownEndsAt(model);
  if (!endsAt) {
    return "shortly";
  }

  const seconds = Math.max(1, Math.ceil((endsAt - Date.now()) / 1_000));
  if (seconds >= 3_600) {
    return `about ${Math.round(seconds / 3_600)}h`;
  }

  if (seconds >= 60) {
    return `about ${Math.round(seconds / 60)} min`;
  }

  return `${seconds}s`;
}

export function allModelsRateLimitedError(model: string, cooldown?: ModelCooldownManager): Error {
  return Object.assign(
    new Error(`Every available model is rate limited. Try again in ${describeCooldown(model, cooldown)}.`),
    { code: "all_models_rate_limited", status: 429 },
  );
}

/**
 * Runs `run` against the first usable model, falling through to the backup when
 * it throws.
 *
 * A rate limit is recorded before moving on, so the NEXT request skips that model
 * up front instead of rediscovering the same 429.
 */
export async function withModelFallback<T>(options: {
  primary: string;
  fallback: string;
  cooldown?: ModelCooldownManager;
  label: string;
  context: Record<string, unknown>;
  run: (model: string, isFallback: boolean) => Promise<T>;
}): Promise<T> {
  const candidates = candidateModels(options.primary, options.fallback, options.cooldown);

  if (candidates.length === 0) {
    void logger.warn(`groq.${options.label}.skipped_all_rate_limited`, {
      ...options.context,
      model: options.primary,
      fallbackModel: options.fallback || undefined,
    });
    throw allModelsRateLimitedError(options.primary, options.cooldown);
  }

  let lastError: unknown;
  for (const [index, model] of candidates.entries()) {
    try {
      return await options.run(model, index > 0);
    } catch (error) {
      lastError = error;

      if (isRateLimitError(error)) {
        options.cooldown?.noteRateLimit(model, headersFromError(error));
      }

      if (index >= candidates.length - 1) {
        throw error;
      }

      void logger.warn(`groq.${options.label}.falling_back`, {
        ...options.context,
        failedModel: model,
        nextModel: candidates[index + 1],
        error: normalizeError("cleanup", error),
      });
    }
  }

  throw lastError ?? new Error(`${options.label} failed.`);
}
