import { getActiveWindow, Key, keyboard } from "@nut-tree-fork/nut-js";
import { clipboard } from "../electron.js";
import { logger } from "../observability/app-logger.js";
import { normalizeError } from "../observability/errors.js";
import type { OperationContext } from "../types.js";

const PASTE_SETTLE_MS = 180;
const CLIPBOARD_RESTORE_MS = 800;
const CLIPBOARD_WRITE_ATTEMPTS = 3;
const CLIPBOARD_WRITE_RETRY_MS = 30;

export type PasteTarget = {
  title: string;
  handle: number | null;
};

type ClipboardLike = {
  readText(): string;
  writeText(text: string): void;
};

type KeyboardLike = {
  pressKey(...keys: Key[]): Promise<unknown>;
  releaseKey(...keys: Key[]): Promise<unknown>;
};

type WindowProviderLike = {
  getActiveWindow(): Promise<{ getTitle(): Promise<string> }>;
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
      windowProvider: { getActiveWindow },
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
      void logger.info("paste.target.captured", { ...context, titleChars: title.length, hasHandle: handle !== null });
      return { title, handle };
    } catch (error) {
      void logger.warn("paste.target.capture_failed", { ...context, error: normalizeError("paste", error) });
      return null;
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
    let pressed = false;
    try {
      await this.deps.keyboard.pressKey(Key.LeftControl, Key.V);
      pressed = true;
      await sleep(40);
    } finally {
      if (pressed) {
        await this.deps.keyboard.releaseKey(Key.LeftControl, Key.V).catch((error) => {
          void logger.warn("clipboard.paste.shortcut_release_failed", { ...context, error: normalizeError("paste", error) });
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
