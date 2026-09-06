import { UiohookKey, uIOhook, type UiohookKeyboardEvent } from "uiohook-napi";
import { logger } from "../observability/app-logger.js";
import { matchesGlobalKey, toUiohookHotkey } from "./hotkey-parser.js";

type HotkeyCallbacks = {
  onPressed: () => void;
  /** `heldMs` lets the caller tell a tap (latch) from a hold (push-to-talk). */
  onReleased?: (heldMs: number) => void;
};

export type KeyboardHookLike = {
  on(event: "keydown" | "keyup", callback: (event: UiohookKeyboardEvent) => void): void;
  off(event: "keydown" | "keyup", callback: (event: UiohookKeyboardEvent) => void): void;
  start(): void;
  stop(): void;
};

const KEY_NAMES = new Map<number, string>(
  Object.entries(UiohookKey)
    .filter(([, value]) => typeof value === "number")
    .map(([key, value]) => [value as number, key.toUpperCase()]),
);

export class HotkeyListener {
  private readonly hotkey: ReturnType<typeof toUiohookHotkey>;
  private isPressed = false;
  private isStarted = false;
  private pressedAt = 0;

  constructor(
    hotkey: string,
    private readonly callbacks: HotkeyCallbacks,
    private readonly hook: KeyboardHookLike = uIOhook,
  ) {
    this.hotkey = toUiohookHotkey(hotkey);
  }

  start(): void {
    this.hook.on("keydown", this.handleKeyDown);
    this.hook.on("keyup", this.handleKeyUp);

    if (!this.isStarted) {
      this.hook.start();
      this.isStarted = true;
      void logger.info("hotkey.listener.started", { hotkey: this.hotkey.key, modifiers: this.hotkey.modifiers });
    }
  }

  stop(): void {
    this.hook.off("keydown", this.handleKeyDown);
    this.hook.off("keyup", this.handleKeyUp);

    if (this.isStarted) {
      this.hook.stop();
      this.isStarted = false;
      void logger.info("hotkey.listener.stopped");
    }
  }

  private readonly handleKeyDown = (event: UiohookKeyboardEvent): void => {
    const eventName = getEventKeyName(event);

    if (!this.isPressed && matchesGlobalKey(eventName, this.hotkey.key) && this.areModifiersDown(event)) {
      this.isPressed = true;
      this.pressedAt = Date.now();
      this.callbacks.onPressed();
    }
  };

  private readonly handleKeyUp = (event: UiohookKeyboardEvent): void => {
    const eventName = getEventKeyName(event);

    if (this.isPressed && this.isComboKey(eventName)) {
      const heldMs = this.pressedAt ? Date.now() - this.pressedAt : 0;
      this.isPressed = false;
      this.pressedAt = 0;
      this.callbacks.onReleased?.(heldMs);
    }
  };

  private areModifiersDown(event: UiohookKeyboardEvent): boolean {
    return this.hotkey.modifiers.every((modifier) => {
      if (modifier === "CTRL" || modifier === "COMMANDORCONTROL") {
        return event.ctrlKey;
      }

      if (modifier === "SHIFT") {
        return event.shiftKey;
      }

      if (modifier === "ALT") {
        return event.altKey;
      }

      if (modifier === "COMMAND") {
        return event.metaKey;
      }

      return false;
    });
  }

  private isComboKey(eventName: string): boolean {
    return matchesGlobalKey(eventName, this.hotkey.key) || this.hotkey.modifiers.some((modifier) => matchesGlobalKey(eventName, modifier));
  }
}

function getEventKeyName(event: UiohookKeyboardEvent): string {
  return KEY_NAMES.get(event.keycode) || "";
}
