/**
 * Per-model rate-limit cooldowns.
 *
 * WHY THIS EXISTS, READ BEFORE SIMPLIFYING IT.
 *
 * Our generic transient-retry helper classified HTTP 429 as retryable, so a rate
 * limit made us send the identical request three more times with backoff. A 429
 * means "you are sending too much"; answering it with more of the same burns the
 * user's quota faster, delays the failure by ~2s, and then fails anyway.
 *
 * The fix is to believe what the provider told us. A 429 carries headers saying
 * exactly how long to wait, so we record that, stop asking, and route to the
 * fallback model instead.
 *
 * Two storage tiers, because the two kinds of limit behave differently:
 *   - Per-minute limits expire on their own in seconds. Memory is enough, and
 *     losing them on restart is harmless.
 *   - Per-day quota exhaustion lasts hours. That must survive a restart, or we
 *     fire a doomed request every single time the app launches.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { app } from "../electron.js";
import { logger } from "../observability/app-logger.js";
import { rateLimitCooldownFromHeaders, type HeaderSource, type RateLimitCooldown } from "./rate-limit-headers.js";

/** At or above this, a cooldown is treated as a daily quota and persisted. */
const DAILY_LIMIT_THRESHOLD_SECONDS = 3_600;

/** Injected so tests can run without touching disk or the Electron app object. */
export type CooldownPersistence = {
  read(): Record<string, number>;
  write(entries: Record<string, number>): void;
};

function createFilePersistence(filePath: string): CooldownPersistence {
  return {
    read() {
      try {
        const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
        const entries: Record<string, number> = {};
        for (const [model, expiry] of Object.entries(parsed)) {
          if (typeof expiry === "number" && Number.isFinite(expiry)) {
            entries[model] = expiry;
          }
        }

        return entries;
      } catch {
        // Missing or corrupt file means no cooldowns, which is the safe default:
        // we try the model and find out, rather than blocking it on bad data.
        return {};
      }
    },
    write(entries) {
      try {
        mkdirSync(path.dirname(filePath), { recursive: true });
        writeFileSync(filePath, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
      } catch (error) {
        // Losing persistence downgrades a daily limit to an in-memory one. That
        // is worse but not broken, so it must never fail the user's dictation.
        void logger.warn("model_cooldown.persist_failed", { error: String(error) });
      }
    },
  };
}

export class ModelCooldownManager {
  /** Short-lived per-minute cooldowns. Model id -> epoch ms expiry. */
  private readonly memory = new Map<string, number>();
  private readonly persistence: CooldownPersistence;
  private persisted: Record<string, number>;

  constructor(persistence?: CooldownPersistence, filePath?: string) {
    this.persistence =
      persistence ?? createFilePersistence(filePath ?? path.join(app.getPath("userData"), "model-cooldowns.json"));
    this.persisted = this.persistence.read();
  }

  /** Epoch ms when the model becomes usable again, or null when it is usable now. */
  cooldownEndsAt(model: string): number | null {
    const now = Date.now();

    const inMemory = this.memory.get(model);
    if (inMemory !== undefined) {
      if (now < inMemory) {
        return inMemory;
      }

      this.memory.delete(model);
    }

    const onDisk = this.persisted[model];
    if (onDisk !== undefined) {
      if (now < onDisk) {
        return onDisk;
      }

      delete this.persisted[model];
      this.persistence.write(this.persisted);
    }

    return null;
  }

  isInCooldown(model: string): boolean {
    return this.cooldownEndsAt(model) !== null;
  }

  /**
   * `persist` forces disk storage for a daily-quota signal whose reset happens to
   * be under an hour — otherwise a daily limit resetting in 20 minutes would be
   * misfiled as a per-minute one and lost on restart.
   */
  setCooldown(model: string, seconds: number, { persist = false }: { persist?: boolean } = {}): void {
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return;
    }

    const expiresAt = Date.now() + seconds * 1_000;
    if (persist || seconds >= DAILY_LIMIT_THRESHOLD_SECONDS) {
      this.persisted[model] = expiresAt;
      this.persistence.write(this.persisted);
      void logger.warn("model_cooldown.daily_limit", { model, seconds: Math.round(seconds) });
      return;
    }

    this.memory.set(model, expiresAt);
    void logger.warn("model_cooldown.rate_limited", { model, seconds: Math.round(seconds) });
  }

  /** Records a 429 using whatever the provider's headers said. */
  noteRateLimit(model: string, headers: HeaderSource): RateLimitCooldown {
    const cooldown = rateLimitCooldownFromHeaders(headers);
    this.setCooldown(model, cooldown.seconds, { persist: cooldown.isDaily });
    return cooldown;
  }

  /**
   * The model to actually send to: the primary when it is free, else the fallback
   * when it exists and is free, else null.
   *
   * Null is the valuable case — it means both are cooling down, so the caller can
   * skip a request it already knows will be rejected.
   */
  effectiveModel(primary: string, fallback?: string): string | null {
    if (!this.isInCooldown(primary)) {
      return primary;
    }

    const trimmedFallback = fallback?.trim();
    if (!trimmedFallback || trimmedFallback === primary || this.isInCooldown(trimmedFallback)) {
      return null;
    }

    return trimmedFallback;
  }

  /** Test and settings hook: clears everything, on disk included. */
  clear(): void {
    this.memory.clear();
    this.persisted = {};
    this.persistence.write(this.persisted);
  }
}
