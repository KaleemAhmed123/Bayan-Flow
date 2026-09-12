import { getActiveWindow, getWindows, Key, keyboard } from "@nut-tree-fork/nut-js";
import { clipboard } from "../electron.js";
import { logger } from "../observability/logger.js";
import { normalizeError } from "../observability/errors.js";
import type { OperationContext } from "../types.js";

const PASTE_SETTLE_MS = 180;
const MODIFIER_RELEASE_POLL_MS = 25;
/**
 * Ceiling on how long a synthetic shortcut waits for the user's fingers to come
 * off the hotkey. Past this we fire anyway: a possibly-mangled paste is
 * recoverable from the clipboard, a silently dropped dictation is not.
 */
const MODIFIER_RELEASE_MAX_WAIT_MS = 600;
const CLIPBOARD_RESTORE_MS = 800;
const CLIPBOARD_WRITE_ATTEMPTS = 3;
const CLIPBOARD_WRITE_RETRY_MS = 30;
const CLIPBOARD_CAPTURE_SETTLE_MS = 90;
const WINDOW_FOCUS_SETTLE_MS = 120;

export type PasteTarget = {
  title: string;
  handle: number | null;
  bounds?: WindowBounds;
};

export type WindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Window titles belonging to this app. Never a valid destination for our own text. */
export const OWN_WINDOW_TITLES = ["BayanFlow"];

/**
 * Rejects windows that cannot be the user's editable app.
 *
 * The dock is always-on-top and can be the foreground window right after it is
 * clicked, so without this the rewrite flow captured BayanFlow itself and then
 * sent Ctrl+A/Ctrl+C to its own overlay, which reported "no text found".
 * Untitled windows are rejected for the same reason: real app windows have titles.
 */
export function isUsableTarget(target: PasteTarget | null | undefined, ownTitles: string[] = OWN_WINDOW_TITLES): boolean {
  const title = target?.title?.trim();
  if (!title) {
    return false;
  }

  return !ownTitles.some((own) => title === own || title.startsWith(`${own} `));
}

type ClipboardLike = {
  readText(): string;
  writeText(text: string): void;
};

/**
 * NOTE: dictations deliberately DO appear in clipboard-history tools.
 *
 * We tried to exclude them by writing the Windows "do not record" clipboard
 * formats alongside the text. Electron's `clipboard.writeBuffer` commits the
 * clipboard as a unit, so the marker REPLACED the text instead of joining it —
 * which would have silently broken every paste in the app. A self-verifying
 * probe caught it on the first real run and the attempt was removed.
 *
 * Keeping the history entry also turns out to be what we want: when a paste is
 * blocked and the user then copies something else, clipboard history is the only
 * remaining way to get the dictation back. Excluding it would have removed a
 * recovery path to close a leak we could not close anyway.
 *
 * A real exclusion would need a native Win32 clipboard write, which is not worth
 * it against that trade.
 */

type KeyboardLike = {
  pressKey(...keys: Key[]): Promise<unknown>;
  releaseKey(...keys: Key[]): Promise<unknown>;
};

type WindowLike = {
  getTitle(): Promise<string>;
  getRegion?: () => Promise<unknown>;
  focus?: () => Promise<boolean>;
};

type WindowProviderLike = {
  getActiveWindow(): Promise<WindowLike>;
  getWindows?: () => Promise<WindowLike[]>;
};

export class TextInserter {
  constructor(
    private readonly deps: {
      clipboard: ClipboardLike;
      keyboard: KeyboardLike;
      windowProvider: WindowProviderLike;
      restoreDelayMs: number;
    } = {
      clipboard,
      keyboard,
      windowProvider: { getActiveWindow, getWindows },
      restoreDelayMs: CLIPBOARD_RESTORE_MS,
    },
  ) {}

  /**
   * Registers the check used to tell whether the user is still holding the
   * hotkey. Optional: with no guard installed every shortcut fires immediately,
   * which is the previous behaviour and what the unit tests rely on.
   */
  setModifierGuard(areModifiersHeld: () => boolean): void {
    this.areModifiersHeld = areModifiersHeld;
  }

  private areModifiersHeld: (() => boolean) | null = null;

  /**
   * Blocks until the hotkey modifiers are released, or the budget runs out.
   *
   * Without this, a shortcut sent while the user still holds Ctrl+Shift arrives
   * at the target app as Ctrl+Shift+V rather than Ctrl+V — "paste as plain text"
   * in some apps, something unrelated in others. The race is real on the
   * tap-to-latch path, where the key-up and the paste genuinely compete.
   *
   * Costs nothing in the common case: by the time transcription returns the user
   * has long since let go, the loop never runs, and the method returns at once.
   */
  private async waitForModifierRelease(context: OperationContext, eventName: string): Promise<void> {
    const areModifiersHeld = this.areModifiersHeld;
    if (!areModifiersHeld || !areModifiersHeld()) {
      return;
    }

    const startedAt = Date.now();
    while (areModifiersHeld() && Date.now() - startedAt < MODIFIER_RELEASE_MAX_WAIT_MS) {
      await sleep(MODIFIER_RELEASE_POLL_MS);
    }

    const waitedMs = Date.now() - startedAt;
    if (areModifiersHeld()) {
      void logger.warn(`clipboard.${eventName}.modifiers_still_held`, { ...context, waitedMs });
      return;
    }

    void logger.info(`clipboard.${eventName}.modifiers_released`, { ...context, waitedMs });
  }

  copyText(text: string, context: OperationContext = {}): void {
    this.deps.clipboard.writeText(text);
    void logger.info("clipboard.copy.success", { ...context, textChars: text.length });
  }

  async captureActiveTarget(context: OperationContext = {}): Promise<PasteTarget | null> {
    try {
      const activeWindow = await this.deps.windowProvider.getActiveWindow();
      const title = await activeWindow.getTitle();
      const handle = getWindowHandle(activeWindow);
      const bounds = activeWindow.getRegion ? normalizeWindowRegion(await activeWindow.getRegion()) : undefined;
      void logger.info("paste.target.captured", {
        ...context,
        titleChars: title.length,
        hasHandle: handle !== null,
        hasBounds: Boolean(bounds),
      });
      return bounds ? { title, handle, bounds } : { title, handle };
    } catch (error) {
      void logger.warn("paste.target.capture_failed", { ...context, error: normalizeError("paste", error) });
      return null;
    }
  }

  async focusTargetWindow(expectedTarget: PasteTarget, context: OperationContext = {}): Promise<void> {
    const activeWindow = await this.deps.windowProvider.getActiveWindow();
    const activeTitle = await activeWindow.getTitle();
    const activeHandle = getWindowHandle(activeWindow);
    if (matchesTarget({ title: activeTitle, handle: activeHandle }, expectedTarget)) {
      return;
    }

    if (expectedTarget.handle !== null && this.deps.windowProvider.getWindows) {
      const windows = await this.deps.windowProvider.getWindows();
      const targetWindow = windows.find((window) => getWindowHandle(window) === expectedTarget.handle);
      if (targetWindow?.focus) {
        const focused = await targetWindow.focus();
        if (!focused) {
          throw new Error("Could not refocus input window.");
        }

        await sleep(WINDOW_FOCUS_SETTLE_MS);
        void logger.info("paste.target.refocused", { ...context, hasHandle: true });
        return;
      }
    }

    void logger.warn("paste.target.refocus_failed", {
      ...context,
      expectedHasHandle: expectedTarget.handle !== null,
      activeHasHandle: activeHandle !== null,
      activeTitleChars: activeTitle.length,
    });
    throw new Error("Could not refocus input window.");
  }

  /**
   * Reads both what is selected and the entire input, in that order.
   *
   * Ctrl+C alone cannot tell "there is a selection" from "there is no selection".
   * VS Code copies the current line when nothing is selected, so a copy that
   * returns text is not proof that a paste would replace anything. Callers get
   * both values and rewrite through the whole input, where Ctrl+A guarantees a
   * replace.
   *
   * Note this leaves the entire input selected, which is what the following
   * whole-input replace expects.
   */
  async captureSelectionAndWhole(
    expectedTarget: PasteTarget,
    context: OperationContext = {},
  ): Promise<{ selection: string | null; whole: string | null }> {
    await this.focusTargetWindow(expectedTarget, context);
    await this.assertActiveTarget(expectedTarget, context);

    const previousText = this.deps.clipboard.readText();
    const sentinel = createClipboardSentinel();

    try {
      const selection = await this.captureClipboardAfterShortcut([Key.LeftControl, Key.C], sentinel, context);
      const whole = await this.captureWholeInputByClipboard(sentinel, context);
      void logger.info("clipboard.capture.pair", {
        ...context,
        selectionChars: selection?.length ?? 0,
        wholeChars: whole?.length ?? 0,
      });
      return { selection, whole };
    } finally {
      await this.writeClipboardWithRetry(previousText, context).catch((error) => {
        void logger.warn("clipboard.capture.restore_failed", { ...context, error: normalizeError("paste", error) });
      });
    }
  }

  async pasteText(text: string, context: OperationContext = {}, expectedTarget?: PasteTarget | null): Promise<void> {
    void logger.info("clipboard.paste.start", { ...context, textChars: text.length });
    const previousText = this.deps.clipboard.readText();

    try {
      await this.assertActiveTarget(expectedTarget, context);
      await this.writeClipboardWithRetry(text, context);
      await sleep(75);
      await this.assertActiveTarget(expectedTarget, context);
      await this.sendPasteShortcut(context);
      await sleep(PASTE_SETTLE_MS);
      setTimeout(() => void this.restoreClipboardIfUnchanged(text, previousText, context), this.deps.restoreDelayMs);
      void logger.info("clipboard.paste.success", { ...context, textChars: text.length });
    } catch (error) {
      await this.writeClipboardWithRetry(text, context).catch((clipboardError) => {
        void logger.error("clipboard.copy_after_paste_failed", {
          ...context,
          textChars: text.length,
          error: normalizeError("paste", clipboardError),
        });
      });
      void logger.error("clipboard.paste.failed", { ...context, textChars: text.length, error: normalizeError("paste", error) });
      throw error;
    }
  }

  /**
   * Reads the whole focused input and puts the clipboard back.
   * Used to check what actually landed in the document before changing it again.
   */
  async captureWholeText(expectedTarget: PasteTarget, context: OperationContext = {}): Promise<string | null> {
    await this.focusTargetWindow(expectedTarget, context);
    await this.assertActiveTarget(expectedTarget, context);

    const previousText = this.deps.clipboard.readText();
    const sentinel = createClipboardSentinel();

    try {
      return await this.captureWholeInputByClipboard(sentinel, context);
    } finally {
      await this.writeClipboardWithRetry(previousText, context).catch((error) => {
        void logger.warn("clipboard.capture_whole.restore_failed", { ...context, error: normalizeError("paste", error) });
      });
    }
  }

  async replaceWholeTextByClipboard(
    sourceText: string,
    replacementText: string,
    expectedTarget: PasteTarget,
    context: OperationContext = {},
  ): Promise<void> {
    void logger.info("clipboard.replace_whole.start", {
      ...context,
      sourceChars: sourceText.length,
      replacementChars: replacementText.length,
    });
    await this.focusTargetWindow(expectedTarget, context);
    await this.assertActiveTarget(expectedTarget, context);

    const previousText = this.deps.clipboard.readText();
    const sentinel = createClipboardSentinel();

    try {
      const currentText = await this.captureWholeInputByClipboard(sentinel, context);
      if (currentText === null || !textsMatchForReplacement(currentText, sourceText)) {
        throw new Error("Input text changed before replace.");
      }

      await this.writeClipboardWithRetry(replacementText, context);
      await sleep(75);
      await this.assertActiveTarget(expectedTarget, context);
      await this.sendPasteShortcut(context);
      await sleep(PASTE_SETTLE_MS);
      setTimeout(() => void this.restoreClipboardIfUnchanged(replacementText, previousText, context), this.deps.restoreDelayMs);
      void logger.info("clipboard.replace_whole.success", { ...context, replacementChars: replacementText.length });
    } catch (error) {
      await this.writeClipboardWithRetry(replacementText, context).catch((clipboardError) => {
        void logger.error("clipboard.copy_after_replace_failed", {
          ...context,
          textChars: replacementText.length,
          error: normalizeError("paste", clipboardError),
        });
      });
      void logger.error("clipboard.replace_whole.failed", {
        ...context,
        replacementChars: replacementText.length,
        error: normalizeError("paste", error),
      });
      throw error;
    }
  }

  private async assertActiveTarget(expectedTarget: PasteTarget | null | undefined, context: OperationContext): Promise<void> {
    if (!expectedTarget) {
      return;
    }

    const activeWindow = await this.deps.windowProvider.getActiveWindow();
    const title = await activeWindow.getTitle();
    const handle = getWindowHandle(activeWindow);
    const expectedHandle = expectedTarget.handle ?? null;
    if (expectedHandle !== null) {
      if (handle !== expectedHandle) {
        void logger.warn("paste.target.changed", {
          ...context,
          expectedHasHandle: true,
          actualHasHandle: handle !== null,
          titleChars: title.length,
        });
        throw new Error("Active window changed before paste.");
      }

      return;
    }

    if (title !== expectedTarget.title) {
      void logger.warn("paste.target.changed", {
        ...context,
        expectedHasHandle: expectedHandle !== null,
        expectedTitleChars: expectedTarget.title.length,
        actualTitleChars: title.length,
      });
      throw new Error("Active window changed before paste.");
    }
  }

  private async sendPasteShortcut(context: OperationContext): Promise<void> {
    await this.sendKeyboardShortcut([Key.LeftControl, Key.V], context, "paste");
  }

  private async captureWholeInputByClipboard(
    sentinel: string,
    context: OperationContext,
  ): Promise<string | null> {
    await this.sendKeyboardShortcut([Key.LeftControl, Key.A], context, "select_all");
    return this.captureClipboardAfterShortcut([Key.LeftControl, Key.C], sentinel, context);
  }

  private async captureClipboardAfterShortcut(
    keys: Key[],
    sentinel: string,
    context: OperationContext,
  ): Promise<string | null> {
    await this.writeClipboardWithRetry(sentinel, context);
    await this.sendKeyboardShortcut(keys, context, "capture");
    await sleep(CLIPBOARD_CAPTURE_SETTLE_MS);
    const captured = this.deps.clipboard.readText();
    return captured === sentinel ? null : captured;
  }

  private async sendKeyboardShortcut(keys: Key[], context: OperationContext, eventName: string): Promise<void> {
    // Every synthetic shortcut routes through here — paste, select-all, and
    // copy alike — so one guard covers all of them. Ctrl+Shift+A is as wrong as
    // Ctrl+Shift+V.
    await this.waitForModifierRelease(context, eventName);

    let pressed = false;
    try {
      await this.deps.keyboard.pressKey(...keys);
      pressed = true;
      await sleep(40);
    } finally {
      if (pressed) {
        await this.deps.keyboard.releaseKey(...keys).catch((error) => {
          void logger.warn(`clipboard.${eventName}.shortcut_release_failed`, {
            ...context,
            error: normalizeError("paste", error),
          });
        });
      }
    }
  }

  private async writeClipboardWithRetry(text: string, context: OperationContext): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= CLIPBOARD_WRITE_ATTEMPTS; attempt += 1) {
      try {
        this.deps.clipboard.writeText(text);
        return;
      } catch (error) {
        lastError = error;
        void logger.warn("clipboard.write.retry", { ...context, attempt, error: normalizeError("paste", error) });
        await sleep(CLIPBOARD_WRITE_RETRY_MS * attempt);
      }
    }

    throw lastError;
  }

  private async restoreClipboardIfUnchanged(text: string, previousText: string, context: OperationContext): Promise<void> {
    try {
      if (this.deps.clipboard.readText() !== text) {
        void logger.info("clipboard.restore.skipped_changed", context);
        return;
      }

      await this.writeClipboardWithRetry(previousText, context);
      void logger.info("clipboard.restore.success", context);
    } catch (error) {
      void logger.warn("clipboard.restore.failed", { ...context, error: normalizeError("paste", error) });
    }
  }
}

function getWindowHandle(window: object): number | null {
  const candidate = window as { windowHandle?: unknown };
  return typeof candidate.windowHandle === "number" ? candidate.windowHandle : null;
}

function matchesTarget(activeTarget: PasteTarget, expectedTarget: PasteTarget): boolean {
  if (expectedTarget.handle !== null) {
    return activeTarget.handle === expectedTarget.handle;
  }

  return activeTarget.title === expectedTarget.title;
}

/**
 * Swaps the last occurrence of "needle" for "replacement".
 * Redo rewrites the text it inserted most recently, so when the same phrase
 * appears twice the later one is the one that was just added.
 */
export function replaceLastOccurrence(haystack: string, needle: string, replacement: string): string {
  if (!needle) {
    return haystack;
  }

  const index = haystack.lastIndexOf(needle);
  if (index === -1) {
    return haystack;
  }

  return haystack.slice(0, index) + replacement + haystack.slice(index + needle.length);
}

function createClipboardSentinel(): string {
  return `__BAYANFLOW_CAPTURE_${Date.now()}_${Math.random().toString(16).slice(2)}__`;
}

function textsMatchForReplacement(currentText: string, sourceText: string): boolean {
  if (currentText === sourceText) {
    return true;
  }

  return trimTrailingLineEndings(currentText) === trimTrailingLineEndings(sourceText);
}

function trimTrailingLineEndings(text: string): string {
  return text.replace(/[\r\n]+$/g, "");
}

function normalizeWindowRegion(region: unknown): WindowBounds | undefined {
  if (!region || typeof region !== "object") {
    return undefined;
  }

  const candidate = region as {
    x?: unknown;
    y?: unknown;
    left?: unknown;
    top?: unknown;
    width?: unknown;
    height?: unknown;
  };
  const x = Number(candidate.x ?? candidate.left);
  const y = Number(candidate.y ?? candidate.top);
  const width = Number(candidate.width);
  const height = Number(candidate.height);
  if (![x, y, width, height].every(Number.isFinite) || width < 80 || height < 80) {
    return undefined;
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
