import { matchesGlobalKey } from "./hotkey-parser.js";

/**
 * The hotkey layer as a pure reduction.
 *
 * Hold-versus-tap, latching, cancellation and the eventual consume decision are
 * genuinely intricate, and they used to live as mutable fields spread across two
 * event handlers next to the I/O that fed them. Logic mixed with I/O is logic
 * that cannot be tested, and the test file that covered it was 52 lines.
 *
 * Everything here is data in, data out. No clock, no logging, no hook. The
 * caller stamps the time onto the event, which is what lets a hold of exactly
 * 900ms be tested without waiting 900ms.
 */

export type HotkeyConfig = {
  key: string;
  modifiers: string[];
};

/**
 * `atMs` is stamped by the shell rather than read in here, so press durations
 * are reproducible in a test.
 *
 * `detach` is what the shell sends when it stops listening. Once detached we no
 * longer see key-ups, so anything still recorded as down would be stale
 * forever and would permanently stall the modifier guard.
 */
export type HotkeyInput =
  | {
      type: "keydown";
      keyName: string;
      atMs: number;
      ctrlKey: boolean;
      shiftKey: boolean;
      altKey: boolean;
      metaKey: boolean;
    }
  | { type: "keyup"; keyName: string; atMs: number }
  | { type: "detach" };

/**
 * `downKeys` is a plain array rather than a Set so the whole state can be
 * compared with deepEqual in a test and logged as-is by a debug panel.
 *
 * `pressedAt` is null when the hotkey is not held. It replaces the old
 * `isPressed` + `pressedAt` pair: two fields that must agree can disagree, and
 * one cannot.
 *
 * ponytail: linear scans over downKeys, which never holds more than a handful
 * of physically-held keys. Index it if a hotkey ever grows past a few
 * modifiers.
 */
export type HotkeyState = {
  readonly downKeys: readonly string[];
  readonly pressedAt: number | null;
};

export type HotkeyEffect = { type: "pressed" } | { type: "released"; heldMs: number };

export type HotkeyStep = {
  state: HotkeyState;
  effects: HotkeyEffect[];
  /**
   * Whether the shell should swallow this keystroke instead of letting it reach
   * the focused application. Always false today: uiohook can observe keys but
   * cannot consume them. Task 23 replaces the hook with a low-level Windows one
   * that can, and this is the field it fills in, so that change stays inside
   * the reducer where it can be tested without a keyboard.
   */
  consume: boolean;
};

export const initialHotkeyState: HotkeyState = { downKeys: [], pressedAt: null };

/** True while any modifier belonging to this hotkey is still physically held. */
export function areModifiersDown(state: HotkeyState, config: HotkeyConfig): boolean {
  return config.modifiers.some((modifier) => state.downKeys.some((downKey) => matchesGlobalKey(downKey, modifier)));
}

export function reduceHotkey(state: HotkeyState, input: HotkeyInput, config: HotkeyConfig): HotkeyStep {
  if (input.type === "detach") {
    return { state: initialHotkeyState, effects: [], consume: false };
  }

  if (input.type === "keydown") {
    const downKeys = state.downKeys.includes(input.keyName)
      ? state.downKeys
      : [...state.downKeys, input.keyName].filter(Boolean);

    const firesNow =
      state.pressedAt === null && matchesGlobalKey(input.keyName, config.key) && modifiersSatisfied(input, config);

    return {
      state: { downKeys, pressedAt: firesNow ? input.atMs : state.pressedAt },
      effects: firesNow ? [{ type: "pressed" }] : [],
      consume: false,
    };
  }

  const downKeys = state.downKeys.filter((downKey) => downKey !== input.keyName);
  const releasesNow = state.pressedAt !== null && isComboKey(input.keyName, config);

  return {
    state: { downKeys, pressedAt: releasesNow ? null : state.pressedAt },
    effects: releasesNow ? [{ type: "released", heldMs: Math.max(0, input.atMs - (state.pressedAt ?? input.atMs)) }] : [],
    consume: false,
  };
}

/**
 * Read from the event's own modifier flags rather than from `downKeys`.
 *
 * These two sources disagree by design. On a modifier's key-up the flags are
 * ambiguous about whether they describe the state before or after the event,
 * which is why the physical set exists at all. But on the key-down of the main
 * key the flags are reliable, and they also cover a modifier that was already
 * held before the hook attached and so was never seen going down.
 */
function modifiersSatisfied(
  event: { ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean },
  config: HotkeyConfig,
): boolean {
  return config.modifiers.every((modifier) => {
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

function isComboKey(keyName: string, config: HotkeyConfig): boolean {
  return (
    matchesGlobalKey(keyName, config.key) || config.modifiers.some((modifier) => matchesGlobalKey(keyName, modifier))
  );
}
