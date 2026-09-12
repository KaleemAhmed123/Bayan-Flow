import { globalShortcut } from "../electron.js";
import { logger } from "../observability/logger.js";
import { parseHotkey } from "./hotkey-parser.js";

/**
 * Stops our hotkeys reaching whatever application is focused.
 *
 * uiohook is an observer by design: it sees a keystroke but can never stop one,
 * so `Ctrl+Shift+Space` fired our recorder *and* whatever the focused editor had
 * bound to it. Electron's `globalShortcut` registers with the operating system
 * itself, and an OS-level registration suppresses the combination for other
 * applications.
 *
 * The two are therefore used together, each for the half it can do:
 * globalShortcut purely to swallow the key, uiohook to decide what the press
 * actually meant. **The callback registered here is deliberately empty** — every
 * press-versus-hold decision already lives in the reducer, driven by uiohook,
 * and duplicating it here would start two recordings for one press.
 *
 * This assumes uiohook still observes a key that the OS is suppressing. Win32
 * calls low-level hooks before it processes hotkeys, so it should, but that is
 * reasoning rather than measurement — which is exactly why the whole thing sits
 * behind a setting that is off until proven.
 */

export type ShortcutRegistrar = {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
};

export type SuppressionResult = {
  /** Accelerators the OS accepted, and is now swallowing for other apps. */
  suppressed: string[];
  /**
   * Accelerators the OS refused, almost always because another application
   * already owns the combination. Not an error: dictation still works, the key
   * just leaks through as it did before.
   */
  rejected: string[];
  /** Hotkeys we declined to register ourselves. See `isSafeToSuppress`. */
  skipped: string[];
};

/**
 * A combination with no modifier must never be suppressed.
 *
 * The cancel binding is a bare `Esc`. Registering that with the OS would swallow
 * Escape in every application on the machine — no dialog could be dismissed and
 * no menu closed — and the same trap waits for any future bare key. Requiring a
 * modifier is a broader guard than naming Esc, and it cannot be defeated by a
 * user typing a single key into the hotkey field.
 */
export function isSafeToSuppress(hotkey: string): boolean {
  try {
    return parseHotkey(hotkey).modifiers.length > 0;
  } catch {
    return false;
  }
}

/**
 * `parseHotkey` already normalises "ctrl" and "cmdorctrl" into the spellings
 * Electron accepts, so the accelerator is just its parts joined back up.
 */
export function toAccelerator(hotkey: string): string {
  const parsed = parseHotkey(hotkey);
  return [...parsed.modifiers, parsed.key].join("+");
}

export class HotkeySuppressor {
  private active: string[] = [];

  constructor(private readonly registrar: ShortcutRegistrar = globalShortcut) {}

  /**
   * Suppresses exactly the given hotkeys and nothing else. Always releases the
   * previous set first, so a hotkey the user has rebound away from does not
   * stay swallowed by a stale registration.
   */
  apply(hotkeys: string[]): SuppressionResult {
    this.release();

    const result: SuppressionResult = { suppressed: [], rejected: [], skipped: [] };

    for (const hotkey of dedupe(hotkeys)) {
      if (!isSafeToSuppress(hotkey)) {
        result.skipped.push(hotkey);
        continue;
      }

      const accelerator = toAccelerator(hotkey);
      // Empty on purpose: uiohook drives the behaviour, this only swallows.
      if (this.registrar.register(accelerator, () => {})) {
        this.active.push(accelerator);
        result.suppressed.push(accelerator);
        continue;
      }

      result.rejected.push(accelerator);
    }

    void logger.info("hotkey.suppression.applied", result);
    return result;
  }

  /** Hands every registration back to the OS. Safe to call when none are held. */
  release(): void {
    for (const accelerator of this.active) {
      try {
        this.registrar.unregister(accelerator);
      } catch {
        // Nothing useful to do: we are giving the key up either way, and
        // throwing here would break app shutdown over a keyboard shortcut.
      }
    }

    this.active = [];
  }

  /** What is currently being swallowed, for Settings and for tests. */
  activeAccelerators(): string[] {
    return [...this.active];
  }
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
