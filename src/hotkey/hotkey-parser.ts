type ParsedHotkey = {
  key: string;
  modifiers: string[];
};

/**
 * Below this, a press counts as a tap (latch recording on).
 * At or above it, a press counts as a hold (push-to-talk, release finishes).
 *
 * This was 400ms, the Discord push-to-talk convention, and it was wrong for
 * dictation. Real presses from one user split like this:
 *
 *   taps  128 158 163 199 203 216 242 243 302 368
 *   holds 429 449 454 462 475 480 488 493 591 ... 1365
 *
 * Only the 1365 was a deliberate hold. Everything from 429 to 591 was a tap
 * pressed a little slowly, and every one of them was treated as push-to-talk
 * and stopped on release — before the microphone had even finished opening.
 *
 * Discord's number suits a game key you stab mid-fight. Dictation is different:
 * a hold means "I am speaking for as long as I hold this", and nobody says
 * anything in under 800ms. Anything shorter is a tap that was not quick.
 */
export const HOLD_THRESHOLD_MS = 800;

export type PressKind = "tap" | "hold";

export function classifyPress(heldMs: number, thresholdMs: number = HOLD_THRESHOLD_MS): PressKind {
  return Number.isFinite(heldMs) && heldMs >= thresholdMs ? "hold" : "tap";
}

type GlobalKeyHotkey = {
  key: string;
  modifiers: string[];
};

const KEY_ALIASES: Record<string, string> = {
  " ": "Space",
  SPACE: "Space",
  SPACEBAR: "Space",
  ESC: "Esc",
  ESCAPE: "Esc",
  CTRL: "Ctrl",
  CONTROL: "Ctrl",
  CMDORCTRL: "CommandOrControl",
  COMMANDORCONTROL: "CommandOrControl",
  COMMAND: "Command",
  CMD: "Command",
  OPTION: "Alt",
  ALT: "Alt",
  SHIFT: "Shift",
};

export function parseHotkey(hotkey: string): ParsedHotkey {
  const parts = hotkey
    .split("+")
    .map((part) => normalizeKey(part))
    .filter(Boolean);

  if (parts.length === 0) {
    throw new Error("Hotkey cannot be empty.");
  }

  const key = parts.at(-1) || "Space";
  const modifiers = parts.slice(0, -1);
  return { key, modifiers };
}

export function toUiohookHotkey(hotkey: string): GlobalKeyHotkey {
  const parsed = parseHotkey(hotkey);
  return {
    key: toGlobalKeyName(parsed.key),
    modifiers: parsed.modifiers.map(toGlobalKeyName),
  };
}

/**
 * `actual` is a key name derived from a uiohook keycode, so it arrives in that
 * library's spelling: "CTRL" for the left modifier and "CTRLRIGHT" for the right
 * one. The "LEFT CTRL" / "RIGHT CTRL" spellings come from other sources.
 *
 * The `*RIGHT` forms matter: without them the right-hand Ctrl, Shift, Alt, and
 * Meta keys match nothing, so a user holding right Shift is invisible to every
 * caller — the hotkey release check and the modifier guard included.
 */
export function matchesGlobalKey(actual: string, expected: string): boolean {
  if (actual === expected) {
    return true;
  }

  if (expected === "CTRL") {
    return (
      actual === "LEFT CTRL" ||
      actual === "RIGHT CTRL" ||
      actual === "LEFT CONTROL" ||
      actual === "RIGHT CONTROL" ||
      actual === "CTRLRIGHT"
    );
  }

  if (expected === "SHIFT") {
    return actual === "LEFT SHIFT" || actual === "RIGHT SHIFT" || actual === "SHIFTRIGHT";
  }

  if (expected === "ALT") {
    return actual === "LEFT ALT" || actual === "RIGHT ALT" || actual === "ALTRIGHT";
  }

  if (expected === "COMMAND") {
    return actual === "LEFT META" || actual === "RIGHT META" || actual === "META" || actual === "METARIGHT";
  }

  if (expected === "COMMANDORCONTROL") {
    return matchesGlobalKey(actual, "CTRL") || matchesGlobalKey(actual, "COMMAND");
  }

  return false;
}

function normalizeKey(key: string): string {
  const trimmed = key.trim();
  const upper = trimmed.toUpperCase();
  return KEY_ALIASES[upper] || trimmed;
}

function toGlobalKeyName(key: string): string {
  return key.replaceAll(" ", "").toUpperCase();
}
