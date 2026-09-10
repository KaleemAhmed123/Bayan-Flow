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
  /**
   * Key names currently held down, by uiohook name. Tracked from raw key events
   * rather than from the `ctrlKey`/`shiftKey` flags, because on the key-up of a
   * modifier those flags are ambiguous about whether they describe the state
   * before or after the event.
   */
  private readonly downKeys = new Set<string>();

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
    // Once detached we stop seeing key-ups, so anything still recorded as down
    // would be stale forever and permanently stall the modifier guard.
    this.downKeys.clear();
    this.isPressed = false;

    if (this.isStarted) {
      this.hook.stop();
      this.isStarted = false;
      void logger.info("hotkey.listener.stopped");
    }
  }

  /**
   * True while any modifier belonging to this hotkey is still physically held.
   *
   * Synthetic shortcuts consult this before firing. Sending Ctrl+V while the
   * user still holds Ctrl+Shift delivers Ctrl+Shift+V to the target app, which
   * is "paste as plain text" in some apps and an unrelated command in others.
   */
  areHotkeyModifiersDown(): boolean {
    return this.hotkey.modifiers.some((modifier) =>
      [...this.downKeys].some((downKey) => matchesGlobalKey(downKey, modifier)),
    );
  }

  private readonly handleKeyDown = (event: UiohookKeyboardEvent): void => {
    const eventName = getEventKeyName(event);
    if (eventName) {
      this.downKeys.add(eventName);
    }

    if (!this.isPressed && matchesGlobalKey(eventName, this.hotkey.key) && this.areModifiersDown(event)) {
      this.isPressed = true;
      this.pressedAt = Date.now();
      this.callbacks.onPressed();
    }
  };

  private readonly handleKeyUp = (event: UiohookKeyboardEvent): void => {
    const eventName = getEventKeyName(event);
    this.downKeys.delete(eventName);

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
