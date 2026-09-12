import { UiohookKey, uIOhook, type UiohookKeyboardEvent } from "uiohook-napi";
import { logger } from "../observability/logger.js";
import { toUiohookHotkey } from "./hotkey-parser.js";
import {
  areModifiersDown,
  initialHotkeyState,
  reduceHotkey,
  type HotkeyEffect,
  type HotkeyInput,
  type HotkeyState,
} from "./hotkey-reducer.js";

export type HotkeyBinding = {
  /** Human spelling, e.g. "Ctrl+Shift+Space". */
  hotkey: string;
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

type Watched = {
  binding: HotkeyBinding;
  config: ReturnType<typeof toUiohookHotkey>;
  state: HotkeyState;
};

/**
 * The I/O shell around `hotkey-reducer`. It owns the hook, the keycode-to-name
 * mapping and the clock, and nothing else: every decision about what a key event
 * means is made by the reducer, which is pure and tested on its own.
 *
 * ONE watcher owns the hook, and it watches every hotkey at once.
 *
 * There used to be three separate listener objects — dictation, rewrite and Esc
 * — each defaulting to the same process-wide `uIOhook` singleton while tracking
 * its own private `isStarted` flag. Two things came out of that. Every keystroke
 * on the machine fanned out to three reducer passes, on the hottest path in the
 * app, whether or not the user was dictating. Worse, rebuilding them on a
 * settings save called `stop()` on the first object, which stopped the shared
 * hook for the two that had not been rebuilt yet: one OS resource with three
 * objects each believing they owned its lifecycle.
 *
 * `setBindings` replaces the watched hotkeys without touching the hook at all,
 * so saving settings can no longer leave a window where nothing is listening.
 */
export class HotkeyWatcher {
  private watched: Watched[] = [];
  private isStarted = false;

  constructor(private readonly hook: KeyboardHookLike = uIOhook) {}

  /**
   * Swaps in a new set of hotkeys. Safe to call while running: the hook keeps
   * listening throughout, and only the reducer states are rebuilt.
   *
   * An unparseable hotkey is dropped rather than thrown, so one bad binding
   * cannot take the others down with it.
   */
  setBindings(bindings: HotkeyBinding[]): number {
    this.watched = bindings.flatMap((binding) => {
      try {
        return [{ binding, config: toUiohookHotkey(binding.hotkey), state: initialHotkeyState }];
      } catch (error) {
        void logger.warn("hotkey.binding.invalid", {
          hotkey: binding.hotkey,
          message: error instanceof Error ? error.message : String(error),
        });
        return [];
      }
    });

    void logger.info("hotkey.bindings.set", { count: this.watched.length, requested: bindings.length });
    return this.watched.length;
  }

  start(): void {
    if (this.isStarted) {
      return;
    }

    this.hook.on("keydown", this.handleKeyDown);
    this.hook.on("keyup", this.handleKeyUp);
    this.hook.start();
    this.isStarted = true;
    void logger.info("hotkey.watcher.started", { count: this.watched.length });
  }

  stop(): void {
    if (!this.isStarted) {
      return;
    }

    this.hook.off("keydown", this.handleKeyDown);
    this.hook.off("keyup", this.handleKeyUp);
    this.hook.stop();
    this.isStarted = false;
    // Once detached we stop seeing key-ups, so anything still recorded as down
    // would be stale forever and would permanently stall the modifier guard.
    this.dispatch({ type: "detach" });
    void logger.info("hotkey.watcher.stopped");
  }

  /**
   * True while any modifier belonging to any watched hotkey is still physically
   * held.
   *
   * Synthetic shortcuts consult this before firing. Sending Ctrl+V while the
   * user still holds Ctrl+Shift delivers Ctrl+Shift+V to the target app, which
   * is "paste as plain text" in some apps and an unrelated command in others.
   * A hotkey with no modifiers, such as the bare Esc binding, contributes
   * nothing here.
   */
  areHotkeyModifiersDown(): boolean {
    return this.watched.some((entry) => areModifiersDown(entry.state, entry.config));
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

  /** One event, every watched hotkey, one pass. */
  private dispatch(input: HotkeyInput): void {
    for (const entry of this.watched) {
      const step = reduceHotkey(entry.state, input, entry.config);
      entry.state = step.state;

      for (const effect of step.effects) {
        emit(entry.binding, effect);
      }
    }
  }
}

function emit(binding: HotkeyBinding, effect: HotkeyEffect): void {
  if (effect.type === "pressed") {
    binding.onPressed();
    return;
  }

  binding.onReleased?.(effect.heldMs);
}

function getEventKeyName(event: UiohookKeyboardEvent): string {
  return KEY_NAMES.get(event.keycode) || "";
}
