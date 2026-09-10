import path from "node:path";
import { rendererDir } from "../app-paths.js";
import { BrowserWindow, ipcMain, screen } from "../electron.js";
import { logger } from "../observability/app-logger.js";
import {
  DOCK_AUTO_CLEAR_MS,
  DOCK_MIN_HEIGHT,
  DOCK_MIN_WIDTH,
  DOCK_WIDTH,
  clampDockSize,
  dockBounds,
  viewAutoClears,
  viewDismissesOnBlur,
  viewNeedsFocus,
  viewStartsSession,
  type DockRecoveryAction,
  type DockView,
  type Rect,
} from "./overlay-state.js";

/** Window resize easing. Short enough to feel instant, long enough to read as motion. */
const DOCK_TWEEN_MS = 150;
const DOCK_TWEEN_STEP_MS = 16;

export type DockCallbacks = {
  onCancel: () => void;
  onStop: () => void;
  onDictate: () => Promise<void>;
  onMenu: () => Promise<void>;
  onRedo: () => Promise<void>;
  onAction: (actionId: string, customInstruction?: string) => Promise<void>;
  onRecovery: (action: DockRecoveryAction) => Promise<void>;
  onSettings: () => Promise<void>;
  onSnooze: () => void;
  onDismiss: () => void;
};

/**
 * The single overlay window. Replaces StatusOverlay and InputAssistWindow.
 *
 * Placement contract:
 *  - one anchor: bottom centre of the session display
 *  - size: measured by the renderer and reported over IPC, never guessed here
 *  - always centred, so a width change grows outward instead of sliding
 *
 * The session display is snapshotted when a dictation starts and reused until
 * that session ends, so moving the mouse to another monitor mid-dictation cannot
 * make the dock hop.
 */
export class OverlayDock {
  private window: InstanceType<typeof BrowserWindow> | null = null;
  private view: DockView = { kind: "hidden" };
  private sessionWorkArea: Rect | null = null;
  private lastSize = { width: DOCK_WIDTH, height: DOCK_MIN_HEIGHT };
  private clearTimer: NodeJS.Timeout | null = null;
  private ready = false;
  private queuedView: DockView | null = null;
  private tweenTimer: NodeJS.Timeout | null = null;
  private idleEnabled = true;
  private idleReady = false;

  constructor(private readonly callbacks: DockCallbacks) {}

  async init(): Promise<void> {
    this.window = new BrowserWindow({
      width: DOCK_WIDTH,
      height: DOCK_MIN_HEIGHT,
      frame: false,
      show: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      transparent: true,
      hasShadow: false,
      // Non-focusable by default: clicking Finish, Cancel, or the idle pill must
      // NOT make the dock the foreground window, or the paste target check sees
      // "BayanFlow" instead of the user's app and refuses to paste. Only the menu
      // view flips this on, because its custom-instruction field needs keyboard focus.
      focusable: false,
      webPreferences: {
        preload: path.join(rendererDir, "dock-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    hardenWindow(this.window);
    this.registerIpc();

    this.window.on("blur", () => {
      if (viewDismissesOnBlur(this.view)) {
        void logger.info("dock.blur.dismiss", { view: this.view.kind });
        this.callbacks.onDismiss();
      }
    });

    await this.window.loadFile(path.join(rendererDir, "dock.html"));
    this.ready = true;
    if (this.queuedView) {
      const queued = this.queuedView;
      this.queuedView = null;
      this.setView(queued);
    }

    void logger.info("dock.init.success", { width: DOCK_WIDTH });
  }

  /** Whether the permanent pill is shown when nothing else is happening. */
  setIdleEnabled(enabled: boolean, ready = this.idleReady): void {
    this.idleEnabled = enabled;
    this.idleReady = ready;

    if (this.view.kind === "hidden" || this.view.kind === "idle") {
      this.showRest();
    }
  }

  /** Return to whatever the dock shows when it has nothing to say. */
  showRest(): void {
    if (this.idleEnabled) {
      this.setView({ kind: "idle", ready: this.idleReady });
      return;
    }

    this.hide();
  }

  setView(view: DockView): void {
    if (!this.window) {
      return;
    }

    if (!this.ready) {
      this.queuedView = view;
      return;
    }

    if (view.kind === "hidden") {
      this.hide();
      return;
    }

    // A new dictation claims a display for the whole session.
    if (viewStartsSession(view)) {
      this.sessionWorkArea = null;
    }

    this.view = view;
    this.clearAutoClearTimer();

    this.window.webContents.send("dock:view", view);
    this.applyBounds();
    this.window.setAlwaysOnTop(true, "screen-saver");
    this.window.setFocusable(viewNeedsFocus(view));

    if (viewNeedsFocus(view)) {
      this.window.show();
      this.window.focus();
    } else if (!this.window.isVisible()) {
      // showInactive keeps keyboard focus in the app the user is typing into.
      this.window.showInactive();
      this.window.moveTop();
    }

    if (viewAutoClears(view)) {
      this.clearTimer = setTimeout(() => this.showRest(), DOCK_AUTO_CLEAR_MS);
    }

    // Logged at info, not debug: "the dock is invisible" is the one failure this
    // window can have that leaves no other trace, and the default level is info.
    const bounds = this.window.getBounds();
    void logger.info("dock.view", {
      view: view.kind,
      visible: this.window.isVisible(),
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      measuredWidth: this.lastSize.width,
      measuredHeight: this.lastSize.height,
      idleEnabled: this.idleEnabled,
    });

    if (process.env.BAYANFLOW_DOCK_CAPTURE) {
      void this.captureDiagnostic(view.kind);
    }
  }

  /**
   * Proves the window actually paints pixels. Enabled by BAYANFLOW_DOCK_CAPTURE
   * and asserted by `npm run local:smoke`, because a clipped or otherwise blank
   * dock still reports visible:true with correct bounds and passes every other
   * check the project has.
   */
  private async captureDiagnostic(kind: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 600));
    const image = await this.window?.webContents.capturePage();
    if (!image) {
      return;
    }

    const size = image.getSize();
    const bitmap = image.toBitmap();
    let opaque = 0;
    for (let i = 3; i < bitmap.length; i += 4) {
      if (bitmap[i] > 8) {
        opaque += 1;
      }
    }

    void logger.info("dock.capture", {
      kind,
      width: size.width,
      height: size.height,
      totalPixels: bitmap.length / 4,
      opaquePixels: opaque,
      isBlank: opaque === 0,
    });
  }

  hide(): void {
    this.clearAutoClearTimer();
    this.stopTween();
    this.view = { kind: "hidden" };
    this.sessionWorkArea = null;
    this.window?.webContents.send("dock:view", this.view);
    this.window?.setFocusable(false);
    this.window?.hide();
  }

  isVisible(): boolean {
    return this.window?.isVisible() === true;
  }

  currentView(): DockView {
    return this.view;
  }

  destroy(): void {
    this.clearAutoClearTimer();
    this.stopTween();
    this.window?.destroy();
    this.window = null;
    this.ready = false;
    ipcMain.removeHandler("dock:resize");
    ipcMain.removeHandler("dock:command");
  }

  private registerIpc(): void {
    ipcMain.handle("dock:resize", (event, size: unknown) => {
      this.assertSender(event.sender.id);
      const next = normalizeSize(size);
      if (!next) {
        return;
      }

      if (Math.abs(next.width - this.lastSize.width) < 1 && Math.abs(next.height - this.lastSize.height) < 1) {
        return;
      }

      void logger.info("dock.resize", { width: next.width, height: next.height, view: this.view.kind });
      this.lastSize = next;
      // The idle pill expands and collapses on every hover, and the tween turns
      // each one into roughly a dozen setBounds calls on an always-on-top
      // window — about twenty-two for a hover in and out. That churn disturbs
      // the focus of the app the user is typing into, which is the one thing
      // this window must never do. The pill's own contents still animate in
      // CSS, so only the frame snaps.
      //
      // Every other view animates as before: those resizes happen once, at a
      // moment the user is already looking at the dock.
      this.applyBounds(this.view.kind !== "idle");
    });

    ipcMain.handle("dock:command", async (event, name: unknown, payload: unknown) => {
      this.assertSender(event.sender.id);
      const command = typeof name === "string" ? name : "";
      void logger.info("dock.command", { command });

      switch (command) {
        case "cancel":
          this.callbacks.onCancel();
          return;
        case "stop":
          this.callbacks.onStop();
          return;
        case "dismiss":
          this.callbacks.onDismiss();
          return;
        case "dictate":
          await this.callbacks.onDictate();
          return;
        case "menu":
          await this.callbacks.onMenu();
          return;
        case "settings":
          await this.callbacks.onSettings();
          return;
        case "snooze":
          this.callbacks.onSnooze();
          return;
        case "redo":
          await this.callbacks.onRedo();
          return;
        case "action": {
          const parsed = normalizeActionPayload(payload);
          if (!parsed) {
            return;
          }

          await this.callbacks.onAction(parsed.actionId, parsed.customInstruction);
          return;
        }
        case "recovery": {
          const action = normalizeRecoveryAction(payload);
          if (!action) {
            return;
          }

          await this.callbacks.onRecovery(action);
          return;
        }
        default:
          void logger.warn("dock.command.unknown", { command });
      }
    });
  }

  /**
   * The only place window geometry is decided. One formula, no branches.
   *
   * `animate` eases the window between two sizes instead of jumping. Electron's
   * own `setBounds(bounds, animate)` flag is macOS-only, so the tween is manual.
   * Content-driven resizes animate; the first placement of a new view does not,
   * so the dock still appears instantly when you press the hotkey.
   */
  private applyBounds(animate = false): void {
    if (!this.window) {
      return;
    }

    const workArea = this.workAreaForSession();
    const size = clampDockSize(this.lastSize, workArea);
    const target = dockBounds(size, workArea);
    this.stopTween();

    if (!animate || !this.window.isVisible()) {
      this.window.setBounds(target, false);
      return;
    }

    const start = this.window.getBounds();
    if (start.width === target.width && start.height === target.height) {
      this.window.setBounds(target, false);
      return;
    }

    const startedAt = Date.now();
    this.tweenTimer = setInterval(() => {
      if (!this.window) {
        this.stopTween();
        return;
      }

      const progress = Math.min(1, (Date.now() - startedAt) / DOCK_TWEEN_MS);
      const eased = 1 - (1 - progress) ** 3;
      this.window.setBounds(
        {
          x: Math.round(start.x + (target.x - start.x) * eased),
          y: Math.round(start.y + (target.y - start.y) * eased),
          width: Math.round(start.width + (target.width - start.width) * eased),
          height: Math.round(start.height + (target.height - start.height) * eased),
        },
        false,
      );

      if (progress >= 1) {
        this.stopTween();
      }
    }, DOCK_TWEEN_STEP_MS);
  }

  private stopTween(): void {
    if (!this.tweenTimer) {
      return;
    }

    clearInterval(this.tweenTimer);
    this.tweenTimer = null;
  }

  /**
   * Snapshot the display once per session. The cursor picks the display because
   * it is synchronous and reflects the screen the user is working on; once chosen
   * it does not change until the session ends.
   */
  private workAreaForSession(): Rect {
    if (this.sessionWorkArea) {
      return this.sessionWorkArea;
    }

    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    this.sessionWorkArea = {
      x: display.workArea.x,
      y: display.workArea.y,
      width: display.workArea.width,
      height: display.workArea.height,
    };
    return this.sessionWorkArea;
  }

  private clearAutoClearTimer(): void {
    if (!this.clearTimer) {
      return;
    }

    clearTimeout(this.clearTimer);
    this.clearTimer = null;
  }

  private assertSender(senderId: number): void {
    if (senderId !== this.window?.webContents.id) {
      throw new Error("Invalid dock IPC sender.");
    }
  }
}

function normalizeSize(value: unknown): { width: number; height: number } | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as { width?: unknown; height?: unknown };
  const width = Number(candidate.width);
  const height = Number(candidate.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  return {
    width: Math.max(DOCK_MIN_WIDTH, Math.ceil(width)),
    height: Math.max(DOCK_MIN_HEIGHT, Math.ceil(height)),
  };
}

function normalizeActionPayload(payload: unknown): { actionId: string; customInstruction?: string } | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const candidate = payload as { actionId?: unknown; customInstruction?: unknown };
  if (typeof candidate.actionId !== "string" || !candidate.actionId) {
    return null;
  }

  const customInstruction =
    typeof candidate.customInstruction === "string" ? candidate.customInstruction.slice(0, 500) : undefined;

  return { actionId: candidate.actionId, customInstruction };
}

function normalizeRecoveryAction(payload: unknown): DockRecoveryAction | null {
  const allowed: DockRecoveryAction[] = ["retry", "redo", "copy", "settings", "dismiss"];
  return allowed.find((action) => action === payload) ?? null;
}

function hardenWindow(window: InstanceType<typeof BrowserWindow>): void {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
}
