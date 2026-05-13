import { getActiveWindow, Key, keyboard } from "@nut-tree-fork/nut-js";
import { clipboard } from "../electron.js";
import { logger } from "../observability/app-logger.js";
import { normalizeError } from "../observability/errors.js";
import type { OperationContext } from "../types.js";

const PASTE_SETTLE_MS = 120;
const CLIPBOARD_RESTORE_MS = 350;

export type PasteTarget = {
  title: string;
  handle: number | null;
};

type ClipboardLike = {
  readText(): string;
  writeText(text: string): void;
};

type KeyboardLike = {
  type(...keys: Key[]): Promise<unknown>;
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
      this.deps.clipboard.writeText(text);
      await sleep(40);
      await this.assertActiveTarget(expectedTarget, context);
      await this.deps.keyboard.type(Key.LeftControl, Key.V);
      await sleep(PASTE_SETTLE_MS);
      setTimeout(() => {
        if (this.deps.clipboard.readText() !== text) {
          void logger.info("clipboard.restore.skipped_changed", context);
          return;
        }

        this.deps.clipboard.writeText(previousText);
        void logger.info("clipboard.restore.success", context);
      }, this.deps.restoreDelayMs);
      void logger.info("clipboard.paste.success", { ...context, textChars: text.length });
    } catch (error) {
      this.deps.clipboard.writeText(text);
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
    if (expectedHandle !== null && handle !== expectedHandle) {
      void logger.warn("paste.target.changed", {
        ...context,
        expectedHasHandle: true,
        actualHasHandle: handle !== null,
        titleChars: title.length,
      });
      throw new Error("Active window changed before paste.");
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
}

function getWindowHandle(window: object): number | null {
  const candidate = window as { windowHandle?: unknown };
  return typeof candidate.windowHandle === "number" ? candidate.windowHandle : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
