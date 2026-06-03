import { getActiveWindow, getWindows, Key, keyboard } from "@nut-tree-fork/nut-js";
import { clipboard } from "../electron.js";
import { logger } from "../observability/app-logger.js";
import { normalizeError } from "../observability/errors.js";
import type { OperationContext } from "../types.js";

const PASTE_SETTLE_MS = 180;
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

export type ClipboardTextSource = {
  scope: "selection" | "whole";
  text: string;
};

type ClipboardLike = {
  readText(): string;
  writeText(text: string): void;
};

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

  async captureTextFromTargetByClipboard(
    expectedTarget: PasteTarget,
    context: OperationContext = {},
  ): Promise<ClipboardTextSource | null> {
    await this.focusTargetWindow(expectedTarget, context);
    await this.assertActiveTarget(expectedTarget, context);

    const previousText = this.deps.clipboard.readText();
    const sentinel = createClipboardSentinel();

    try {
      const selectedText = await this.captureClipboardAfterShortcut([Key.LeftControl, Key.C], sentinel, context);
      if (selectedText?.trim()) {
        void logger.info("clipboard.capture.success", { ...context, scope: "selection", textChars: selectedText.length });
        return { scope: "selection", text: selectedText };
      }

      const wholeText = await this.captureWholeInputByClipboard(sentinel, context);
      if (wholeText?.trim()) {
        void logger.info("clipboard.capture.success", { ...context, scope: "whole", textChars: wholeText.length });
        return { scope: "whole", text: wholeText };
      }

      void logger.info("clipboard.capture.empty", context);
      return null;
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
