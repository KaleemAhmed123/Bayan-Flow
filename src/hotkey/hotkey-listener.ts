import { UiohookKey, uIOhook, type UiohookKeyboardEvent } from "uiohook-napi";
import { logger } from "../observability/app-logger.js";
import { toUiohookHotkey } from "./hotkey-parser.js";
import {
  areModifiersDown,
  initialHotkeyState,
  reduceHotkey,
  type HotkeyEffect,
  type HotkeyInput,
  type HotkeyState,
} from "./hotkey-reducer.js";

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

/**
 * The I/O shell around `hotkey-reducer`. It owns the hook, the keycode-to-name
 * mapping and the clock, and nothing else: every decision about what a key
 * event means is made by the reducer, which is pure and tested on its own.
 */
export class HotkeyListener {
  private readonly hotkey: ReturnType<typeof toUiohookHotkey>;
  private isStarted = false;
  private state: HotkeyState = initialHotkeyState;

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
    this.dispatch({ type: "detach" });

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
    return areModifiersDown(this.state, this.hotkey);
  }

  private readonly handleKeyDown = (event: UiohookKeyboardEvent): void => {
    this.dispatch({
      type: "keydown",
      keyName: getEventKeyName(event),
      atMs: Date.now(),
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
    });
  };

  private readonly handleKeyUp = (event: UiohookKeyboardEvent): void => {
    this.dispatch({ type: "keyup", keyName: getEventKeyName(event), atMs: Date.now() });
  };

  private dispatch(input: HotkeyInput): void {
    const step = reduceHotkey(this.state, input, this.hotkey);
    this.state = step.state;

    for (const effect of step.effects) {
      this.emit(effect);
    }
  }

  private emit(effect: HotkeyEffect): void {
    if (effect.type === "pressed") {
      this.callbacks.onPressed();
      return;
    }

    this.callbacks.onReleased?.(effect.heldMs);
  }
}

function getEventKeyName(event: UiohookKeyboardEvent): string {
  return KEY_NAMES.get(event.keycode) || "";
}
