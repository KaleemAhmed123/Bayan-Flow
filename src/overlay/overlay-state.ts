/**
 * Pure overlay geometry and error-recovery rules.
 *
 * Nothing here imports Electron, so it is unit-testable and safe to reason about.
 *
 * The single rule this module exists to enforce: the dock has ONE anchor
 * (bottom centre of one display) and ONE width. Height is the only dimension
 * that varies, and it always arrives measured from the renderer. The main
 * process never invents a size, which is what makes the old
 * "TypeScript width vs CSS width" disagreement impossible to reintroduce.
 */

export type Rect = { x: number; y: number; width: number; height: number };
export type DockSize = { width: number; height: number };

/**
 * Width of every working state. The idle pill is narrower, but because the dock
 * is always centred it grows and shrinks symmetrically rather than sliding, and
 * every state from listening to done keeps this one width so nothing moves
 * during a dictation.
 */
export const DOCK_WIDTH = 480;
export const DOCK_BOTTOM_MARGIN = 32;
export const DOCK_SIDE_MARGIN = 12;
export const DOCK_MIN_WIDTH = 40;
export const DOCK_MIN_HEIGHT = 28;
export const DOCK_MAX_HEIGHT_RATIO = 0.6;

/** How long "Hide for 1 hour" keeps the pill off screen. */
export const DOCK_SNOOZE_MS = 60 * 60 * 1_000;

/** Matches Wispr Flow: transient states clear themselves after 8s of inactivity. */
export const DOCK_AUTO_CLEAR_MS = 8_000;

export type DockRecoveryAction = "retry" | "redo" | "copy" | "settings" | "dismiss";

export type DockRecovery = {
  action: DockRecoveryAction;
  label: string;
};

export type DockFailure =
  | "missing_api_key"
  | "model_unavailable"
  | "hotkey"
  | "recorder"
  | "transcription"
  | "polish"
  | "paste_blocked"
  | "generic";

export type DockMenuAction = {
  id: string;
  label: string;
  /** 1 = always visible, 2 = revealed by "More". */
  layer: 1 | 2;
};

/**
 * What the renderer is told to draw. One discriminated union, one window.
 * `startedAt` is an epoch millisecond value so the renderer can run its own
 * elapsed-time ticker without the main process sending a message per second.
 */
export type DockView =
  | { kind: "hidden" }
  /** The permanent pill. Collapsed by default, expands on hover. */
  | { kind: "idle"; ready: boolean }
  | { kind: "listening"; latched: boolean; hint: string }
  | { kind: "working"; label: string; startedAt: number }
  | { kind: "done"; label: string; tone: "ok" | "warn"; canRedo: boolean }
  | { kind: "menu"; actions: DockMenuAction[]; expanded: boolean; note: string }
  | { kind: "error"; message: string; recovery: DockRecovery | null };

/** Views the user can interact with by typing, so the window must take focus. */
export function viewNeedsFocus(view: DockView): boolean {
  return view.kind === "menu";
}

/**
 * Views that give way on their own after DOCK_AUTO_CLEAR_MS.
 * They fall back to the idle pill when it is enabled, otherwise to hidden.
 */
export function viewAutoClears(view: DockView): boolean {
  return view.kind === "done" || view.kind === "error";
}

/** A session owns the display until it ends, so the dock cannot hop mid-flow. */
export function viewStartsSession(view: DockView): boolean {
  return view.kind === "listening";
}

/**
 * Menus are cheap to reopen, so a stray click dismisses them.
 * Everything else either holds work in progress or is already transient.
 */
export function viewDismissesOnBlur(view: DockView): boolean {
  return view.kind === "menu";
}

export function clampDockSize(size: DockSize, workArea: Rect): DockSize {
  const maxWidth = Math.max(DOCK_MIN_WIDTH, workArea.width - DOCK_SIDE_MARGIN * 2);
  const maxHeight = Math.max(DOCK_MIN_HEIGHT, Math.round(workArea.height * DOCK_MAX_HEIGHT_RATIO));

  return {
    width: Math.round(clamp(size.width, DOCK_MIN_WIDTH, maxWidth)),
    height: Math.round(clamp(size.height, DOCK_MIN_HEIGHT, maxHeight)),
  };
}

/**
 * The whole placement system, in four lines.
 *
 * Horizontally centred and bottom-anchored on the supplied work area. Depends on
 * nothing asynchronous, so it cannot produce a different answer on a second call
 * with the same inputs — which is what caused the "first time bottom-right, next
 * time centre" bug in the window this replaces.
 */
export function dockBounds(size: DockSize, workArea: Rect, bottomMargin = DOCK_BOTTOM_MARGIN): Rect {
  const clamped = clampDockSize(size, workArea);
  const x = Math.round(workArea.x + (workArea.width - clamped.width) / 2);
  const y = Math.round(Math.max(workArea.y, workArea.y + workArea.height - clamped.height - bottomMargin));

  return { x, y, width: clamped.width, height: clamped.height };
}

/**
 * Every failure gets exactly one recovery button, shown on the dock itself.
 * The old build reported paste failures on a different overlay in a different
 * screen corner, which is why they read as "no error visibility".
 */
export function recoveryForFailure(failure: DockFailure): DockRecovery | null {
  switch (failure) {
    case "missing_api_key":
    case "model_unavailable":
    case "hotkey":
      // Retrying a rejected key or a retired model id just fails again; the only
      // thing that helps is changing the setting.
      return { action: "settings", label: "Open Settings" };
    case "recorder":
      return { action: "settings", label: "Check microphone" };
    case "transcription":
      return { action: "retry", label: "Try again" };
    case "polish":
      return { action: "redo", label: "Redo" };
    case "paste_blocked":
      return { action: "copy", label: "Copy again" };
    default:
      return { action: "dismiss", label: "Dismiss" };
  }
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}
