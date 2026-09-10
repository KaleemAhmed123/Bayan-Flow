/**
 * App context capture.
 *
 * TIMING IS THE WHOLE DESIGN. Capture starts when the microphone opens, not when
 * it closes, so it runs while the user is still speaking. A person talks for
 * three to fifteen seconds; this takes under one. By the time they release the
 * key the answer is already sitting in memory. Move this to stop-time and you
 * add a full second to every dictation and the feature becomes a liability.
 *
 * Context is best-effort throughout. Every failure path here degrades to less
 * context, never to a failed or delayed dictation.
 */

import Groq from "groq-sdk";
import { desktopCapturer } from "../electron.js";
import { estimateOutputTokens, isTruncated, withReasoningEffort } from "../llm/completion-budget.js";
import { logger } from "../observability/app-logger.js";
import { normalizeError } from "../observability/errors.js";
import type { OperationContext } from "../types.js";
import {
  buildContextInferencePrompt,
  CONTEXT_SYSTEM_PROMPT,
  EMPTY_CONTEXT,
  isBlockedWindow,
  parseContextAnswer,
  truncateTitle,
  type AppContextSnapshot,
} from "./context-rules.js";

const CONTEXT_TIMEOUT_MS = 8_000;
/**
 * Longest the dictation will wait at stop-time for a summary that has not
 * arrived. Past this we ship the metadata we already have. The user is waiting
 * on their own words; context is not worth stalling them for.
 */
export const CONTEXT_RESULT_DEADLINE_MS = 1_200;

/** Longest edge of the screenshot, in pixels. */
const SCREENSHOT_MAX_EDGE = 1024;
const SCREENSHOT_JPEG_QUALITY = 50;
/**
 * Self-imposed ceiling on the encoded image, far below the provider's 20 MB
 * request limit. An oversized screenshot is dropped and the request goes ahead
 * text-only — a screenshot must never be why a dictation fails.
 */
const MAX_SCREENSHOT_DATA_URL_CHARS = 600_000;

export type ContextCaptureSettings = {
  enabled: boolean;
  screenshotEnabled: boolean;
  model: string;
  blocklist: string[];
  apiKey: string;
};

export type WindowSignalProvider = () => Promise<{ title: string; appName?: string } | null>;

/** The slice of the SDK this service uses, so tests can supply their own. */
export type ChatClientLike = {
  chat: {
    completions: {
      create(request: Record<string, unknown>): Promise<{
        choices?: { message?: { content?: string | null }; finish_reason?: string | null }[];
      }>;
    };
  };
};

/**
 * Room the summary needs beyond restating its inputs.
 *
 * Two sentences is a small answer, but the budget is NOT two sentences' worth:
 * on a reasoning model the thinking is charged against the same ceiling and
 * happens first. A budget sized for the answer alone gets spent entirely on
 * reasoning and returns nothing at all. See `estimateOutputTokens`.
 */
const CONTEXT_ANSWER_TOKENS = 200;

/**
 * Finds the capture source for the focused window.
 *
 * The two sides come from different APIs — the title from the window manager,
 * the source name from the capture layer — and they disagree over trailing
 * whitespace, casing, and occasionally a truncated suffix. Exact equality alone
 * fails often enough in practice to make the screenshot look broken, so this
 * falls back through progressively looser matches.
 *
 * Every tier still requires the titles to correspond, so it cannot silently
 * capture some other window: an ambiguous prefix match is rejected rather than
 * guessed at.
 */
export function findWindowSource<T extends { name: string }>(sources: T[], windowTitle: string): T | undefined {
  const target = windowTitle.trim();
  if (!target) {
    return undefined;
  }

  const exact = sources.find((source) => source.name === target);
  if (exact) {
    return exact;
  }

  const lower = target.toLowerCase();
  const caseInsensitive = sources.filter((source) => source.name.trim().toLowerCase() === lower);
  if (caseInsensitive.length === 1) {
    return caseInsensitive[0];
  }

  // Some window managers truncate long titles. Accept a prefix relationship only
  // when exactly one source matches, so an ambiguous case captures nothing.
  const prefixed = sources.filter((source) => {
    const name = source.name.trim().toLowerCase();
    return name.length > 0 && (name.startsWith(lower) || lower.startsWith(name));
  });

  return prefixed.length === 1 ? prefixed[0] : undefined;
}

export class AppContextService {
  private pending: Promise<AppContextSnapshot> | null = null;
  private metadataOnly: AppContextSnapshot = EMPTY_CONTEXT;
  private cancelled = false;
  private readonly createClient: (apiKey: string) => ChatClientLike;

  constructor(
    private readonly getWindowSignals: WindowSignalProvider,
    createClient?: (apiKey: string) => ChatClientLike,
  ) {
    this.createClient =
      createClient ??
      ((apiKey) => new Groq({ apiKey, timeout: CONTEXT_TIMEOUT_MS, maxRetries: 0 }) as unknown as ChatClientLike);
  }

  /**
   * Kicks off capture. Never awaited by the caller and never throws — the
   * dictation path must not be able to fail because context did.
   */
  start(settings: ContextCaptureSettings, context: OperationContext = {}): void {
    this.cancel();
    this.cancelled = false;

    if (!settings.enabled) {
      this.metadataOnly = { ...EMPTY_CONTEXT, reason: "disabled" };
      return;
    }

    this.pending = this.capture(settings, context).catch((error) => {
      void logger.warn("context.capture.failed", { ...context, error: normalizeError("config", error) });
      return { ...EMPTY_CONTEXT, reason: "capture_failed" };
    });
  }

  /**
   * Whatever context is ready, waiting no longer than the deadline.
   *
   * On timeout it returns the metadata gathered synchronously at start — app and
   * window title — and drops the model-generated summary. Partial context still
   * fixes spellings; a stalled dictation helps nobody.
   */
  async result(deadlineMs = CONTEXT_RESULT_DEADLINE_MS): Promise<AppContextSnapshot> {
    if (!this.pending) {
      return this.metadataOnly;
    }

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<AppContextSnapshot>((resolve) => {
      timer = setTimeout(() => resolve({ ...this.metadataOnly, reason: "timed_out" }), deadlineMs);
    });

    try {
      return await Promise.race([this.pending, timeout]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  cancel(): void {
    this.cancelled = true;
    this.pending = null;
    this.metadataOnly = EMPTY_CONTEXT;
  }

  private async capture(
    settings: ContextCaptureSettings,
    context: OperationContext,
  ): Promise<AppContextSnapshot> {
    const signals = await this.getWindowSignals().catch(() => null);
    const windowTitle = truncateTitle(signals?.title ?? "");

    if (isBlockedWindow(windowTitle, settings.blocklist)) {
      // Nothing is recorded here, not even which pattern matched: that would
      // put the blocked window's identity in the log we were protecting it from.
      const blocked: AppContextSnapshot = { ...EMPTY_CONTEXT, blocked: true, reason: "blocked" };
      this.metadataOnly = blocked;
      void logger.info("context.capture.blocked", { ...context });
      return blocked;
    }

    const appName = signals?.appName?.trim() ?? "";
    // Published immediately so a stop-time timeout still has something useful.
    this.metadataOnly = { ...EMPTY_CONTEXT, appName, windowTitle };

    if (!settings.apiKey) {
      return { ...this.metadataOnly, reason: "no_api_key" };
    }

    const screenshotDataUrl = settings.screenshotEnabled ? await this.captureScreenshot(windowTitle, context) : null;

    const answer = await this.inferActivity({ appName, windowTitle }, screenshotDataUrl, settings, context);

    if (this.cancelled) {
      return EMPTY_CONTEXT;
    }

    return {
      appName,
      windowTitle,
      activity: answer.activity,
      visibleNames: answer.visibleNames,
      usedScreenshot: Boolean(screenshotDataUrl),
      blocked: false,
      reason: answer.activity ? undefined : "no_summary",
    };
  }

  /**
   * Grabs the ACTIVE WINDOW only, never the whole screen.
   *
   * This is a property of the capture call, not a crop: the other monitor, the
   * background Slack, and the open bank tab are never in the image we hold, so
   * there is no window of time in which we possess them.
   */
  private async captureScreenshot(windowTitle: string, context: OperationContext): Promise<string | null> {
    if (!windowTitle) {
      return null;
    }

    try {
      const sources = await desktopCapturer.getSources({
        types: ["window"],
        thumbnailSize: { width: SCREENSHOT_MAX_EDGE, height: SCREENSHOT_MAX_EDGE },
      });

      const match = findWindowSource(sources, windowTitle);
      if (!match || match.thumbnail.isEmpty()) {
        // Logged as a count only. The titles we failed to match against are
        // every open window on the machine, which is not ours to record.
        void logger.info("context.screenshot.no_match", { ...context, sourceCount: sources.length });
        return null;
      }

      const dataUrl = `data:image/jpeg;base64,${match.thumbnail.toJPEG(SCREENSHOT_JPEG_QUALITY).toString("base64")}`;
      if (dataUrl.length > MAX_SCREENSHOT_DATA_URL_CHARS) {
        void logger.info("context.screenshot.too_large", { ...context, chars: dataUrl.length });
        return null;
      }

      void logger.info("context.screenshot.captured", { ...context, chars: dataUrl.length });
      return dataUrl;
    } catch (error) {
      void logger.warn("context.screenshot.failed", { ...context, error: normalizeError("config", error) });
      return null;
    }
  }

  private async inferActivity(
    signals: { appName: string; windowTitle: string },
    screenshotDataUrl: string | null,
    settings: ContextCaptureSettings,
    context: OperationContext,
  ): Promise<{ activity: string; visibleNames: string[] }> {
    const startedAt = Date.now();
    const textPrompt = buildContextInferencePrompt(signals);
    const userContent = screenshotDataUrl
      ? [
          { type: "text", text: textPrompt },
          { type: "image_url", image_url: { url: screenshotDataUrl } },
        ]
      : textPrompt;

    try {
      const client = this.createClient(settings.apiKey);
      const maxOutputTokens = estimateOutputTokens(textPrompt.length, settings.model, CONTEXT_ANSWER_TOKENS);

      const completion = await withReasoningEffort(
        settings.model,
        (extraParams) =>
          client.chat.completions.create({
            model: settings.model,
            temperature: 0.2,
            max_completion_tokens: maxOutputTokens,
            ...extraParams,
            messages: [
              { role: "system", content: CONTEXT_SYSTEM_PROMPT },
              { role: "user", content: userContent },
            ],
          }),
        () => logger.warn("context.infer.reasoning_effort_unsupported", { ...context, model: settings.model }),
        // Not "low". Describing a window needs no reasoning, and on this model
        // "low" still spent the entire output budget thinking and returned
        // nothing. See the ReasoningEffort docs.
        "none",
      );

      const choice = completion.choices?.[0];
      const answer = parseContextAnswer(choice?.message?.content ?? "");

      if (!answer.activity && answer.visibleNames.length === 0) {
        // An empty summary is invisible from the outside — context simply gets
        // thinner and nothing looks broken. Record enough to tell the two causes
        // apart: the model ran out of budget mid-thought, or it genuinely had
        // nothing to say.
        void logger.warn("context.infer.empty", {
          ...context,
          model: settings.model,
          durationMs: Date.now() - startedAt,
          maxOutputTokens,
          finishReason: choice?.finish_reason ?? "unknown",
          truncated: isTruncated(choice?.finish_reason),
          rawChars: (choice?.message?.content ?? "").length,
        });
        return { activity: "", visibleNames: [] };
      }

      void logger.info("context.infer.success", {
        ...context,
        model: settings.model,
        durationMs: Date.now() - startedAt,
        maxOutputTokens,
        usedScreenshot: Boolean(screenshotDataUrl),
        summaryChars: answer.activity.length,
        // A count only. The names themselves are read off the user's screen.
        visibleNameCount: answer.visibleNames.length,
      });
      return answer;
    } catch (error) {
      // A failed summary is not a failed dictation. Metadata alone still helps.
      void logger.warn("context.infer.failed", {
        ...context,
        model: settings.model,
        durationMs: Date.now() - startedAt,
        usedScreenshot: Boolean(screenshotDataUrl),
        error: normalizeError("cleanup", error),
      });
      return { activity: "", visibleNames: [] };
    }
  }
}
