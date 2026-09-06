type ParsedHotkey = {
  key: string;
  modifiers: string[];
};

/**
 * Below this, a press counts as a tap (latch recording on).
 * At or above it, a press counts as a hold (push-to-talk, release finishes).
 * 400ms is the Discord push-to-talk convention; long enough that a deliberate
 * tap never registers as a hold, short enough that holding feels instant.
 */
export const HOLD_THRESHOLD_MS = 400;

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

export function matchesGlobalKey(actual: string, expected: string): boolean {
  if (actual === expected) {
    return true;
  }

  if (expected === "CTRL") {
    return actual === "LEFT CTRL" || actual === "RIGHT CTRL" || actual === "LEFT CONTROL" || actual === "RIGHT CONTROL";
  }

  if (expected === "SHIFT") {
    return actual === "LEFT SHIFT" || actual === "RIGHT SHIFT";
  }

  if (expected === "ALT") {
    return actual === "LEFT ALT" || actual === "RIGHT ALT";
  }

  if (expected === "COMMANDORCONTROL") {
    return matchesGlobalKey(actual, "CTRL") || actual === "LEFT META" || actual === "RIGHT META";
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
