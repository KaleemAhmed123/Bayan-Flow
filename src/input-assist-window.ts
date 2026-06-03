import path from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, ipcMain, screen } from "./electron.js";
import { iconPositionForBounds, type InputAssistTarget } from "./input-assist/input-assist-types.js";
import type { WindowBounds } from "./insertion/text-inserter.js";
import { logger } from "./observability/app-logger.js";
import type { RewriteActionId } from "./rewrite/rewrite-actions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ICON_SIZE = 32;
const MENU_WIDTH = 246;
const MENU_HEIGHT = 286;
const PREVIEW_WIDTH = 450;
const PREVIEW_HEIGHT = 354;
const ERROR_HEIGHT = 142;
const MIN_PANEL_WIDTH = 220;
const MIN_PANEL_HEIGHT = 120;

type InputAssistView = "hidden" | "icon" | "menu" | "loading" | "error" | "preview";
type Rect = { x: number; y: number; width: number; height: number };

export type RewritePreviewPayload = {
  scope: "selection" | "whole";
  actionLabel: string;
  originalChars: number;
  rewrittenText: string;
  safeReplace: boolean;
  replaceMode: "verified" | "window" | "copy";
};

export class InputAssistWindow {
  private window: InstanceType<typeof BrowserWindow> | null = null;
  private activeTarget: InputAssistTarget | null = null;
  private currentView: InputAssistView = "hidden";
  private fallbackAnchor: { x: number; y: number } | null = null;
  private contextBounds: WindowBounds | null = null;
  private iconAnchor: Rect | null = null;
  private userMovedPanel = false;
  private expectedProgrammaticPosition: { x: number; y: number } | null = null;

  constructor(
    private readonly callbacks: {
      onMenuOpened: () => void;
      onAction: (actionId: RewriteActionId, customInstruction?: string) => Promise<void>;
      onSpeak: () => Promise<void>;
      onReplace: () => Promise<void>;
      onCopy: () => Promise<void>;
      onRetry: () => Promise<void>;
      onCancel: () => void;
      onBlur: () => void;
    },
  ) {}

  async init(): Promise<void> {
    this.window = new BrowserWindow({
      width: ICON_SIZE,
      height: ICON_SIZE,
      frame: false,
      show: false,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      transparent: true,
      focusable: true,
      icon: path.join(__dirname, "assets", "tray-icon.ico"),
      webPreferences: {
        preload: path.join(__dirname, "renderer", "input-assist-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    hardenWindow(this.window);
    this.window.on("move", () => {
      this.trackWindowMove();
    });
    this.window.on("blur", () => {
      if (this.currentView !== "hidden" && this.currentView !== "icon") {
        this.callbacks.onBlur();
      }
    });
    this.registerIpc();
    await this.window.loadFile(path.join(__dirname, "renderer", "input-assist.html"));
    void logger.info("input_assist.window.init.success");
  }

  showIcon(target: InputAssistTarget): void {
    this.showIconAtTarget(target);
  }

  showFallbackIcon(contextBounds?: WindowBounds): void {
    if (contextBounds) {
      this.contextBounds = contextBounds;
    }

    this.showIconAtTarget(null);
  }

  setContextBounds(contextBounds?: WindowBounds): void {
    if (contextBounds) {
      this.contextBounds = contextBounds;
    }
  }

  private showIconAtTarget(target: InputAssistTarget | null): void {
    if (!this.window) {
      return;
    }

    this.activeTarget = target;
    this.currentView = "icon";
    this.userMovedPanel = false;
    this.resizeAndPositionWindow(ICON_SIZE, ICON_SIZE);
    this.window.webContents.send("input-assist:state", { view: "icon" });
    this.window.setAlwaysOnTop(true, "screen-saver");
    this.window.showInactive();
    this.window.moveTop();
  }

  hide(): void {
    this.currentView = "hidden";
    this.window?.hide();
    this.activeTarget = null;
    this.fallbackAnchor = null;
    this.contextBounds = null;
    this.iconAnchor = null;
    this.userMovedPanel = false;
    this.expectedProgrammaticPosition = null;
  }

  showMenu(): void {
    if (!this.window) {
      return;
    }

    this.currentView = "menu";
    this.resizeAndPositionWindow(MENU_WIDTH, MENU_HEIGHT);
    this.window.webContents.send("input-assist:state", { view: "menu" });
    this.window.show();
    this.window.focus();
    this.logState("menu");
  }

  showLoading(message: string): void {
    if (!this.window) {
      return;
    }

    const anchored = this.resizeFromCurrentPanel(MENU_WIDTH, 118);
    this.currentView = "loading";
    if (!anchored) {
      this.resizeAndPositionWindow(MENU_WIDTH, 118);
    }
    this.window.webContents.send("input-assist:state", { view: "loading", message });
    this.window.show();
    this.window.focus();
    this.logState("loading", { messageChars: message.length });
  }

  showError(message: string): void {
    if (!this.window) {
      return;
    }

    const anchored = this.resizeFromCurrentPanel(MENU_WIDTH, ERROR_HEIGHT);
    this.currentView = "error";
    if (!anchored) {
      this.resizeAndPositionWindow(MENU_WIDTH, ERROR_HEIGHT);
    }
    this.window.webContents.send("input-assist:state", { view: "error", message });
    this.window.show();
    this.window.focus();
    this.logState("error", { messageChars: message.length });
  }

  showPreview(payload: RewritePreviewPayload): void {
    if (!this.window) {
      return;
    }

    this.currentView = "preview";
    const anchored = this.userMovedPanel && this.resizeFromCurrentPanel(PREVIEW_WIDTH, PREVIEW_HEIGHT);
    if (!anchored) {
      this.resizeAndPositionWindow(PREVIEW_WIDTH, PREVIEW_HEIGHT);
    }
    this.window.webContents.send("input-assist:state", { view: "preview", ...payload });
    this.window.show();
    this.window.focus();
    this.logState("preview", {
      scope: payload.scope,
      actionLabel: payload.actionLabel,
      originalChars: payload.originalChars,
      outputChars: payload.rewrittenText.length,
      safeReplace: payload.safeReplace,
      replaceMode: payload.replaceMode,
    });
  }

  destroy(): void {
    this.window?.destroy();
    this.window = null;
    ipcMain.removeHandler("input-assist:open-menu");
    ipcMain.removeHandler("input-assist:action");
    ipcMain.removeHandler("input-assist:speak");
    ipcMain.removeHandler("input-assist:replace");
    ipcMain.removeHandler("input-assist:copy");
    ipcMain.removeHandler("input-assist:retry");
    ipcMain.removeHandler("input-assist:cancel");
  }

  private registerIpc(): void {
    ipcMain.handle("input-assist:open-menu", (event) => {
      this.assertSender(event.sender.id);
      void logger.info("input_assist.ipc.received", { command: "open-menu" });
      this.callbacks.onMenuOpened();
    });
    ipcMain.handle("input-assist:action", async (event, actionId: RewriteActionId, customInstruction?: string) => {
      this.assertSender(event.sender.id);
      void logger.info("input_assist.ipc.received", {
        command: "action",
        actionId,
        customInstructionChars: customInstruction?.length ?? 0,
      });
      await this.callbacks.onAction(actionId, customInstruction);
    });
    ipcMain.handle("input-assist:speak", async (event) => {
      this.assertSender(event.sender.id);
      void logger.info("input_assist.ipc.received", { command: "speak" });
      await this.callbacks.onSpeak();
    });
    ipcMain.handle("input-assist:replace", async (event) => {
      this.assertSender(event.sender.id);
      void logger.info("input_assist.ipc.received", { command: "replace" });
      await this.callbacks.onReplace();
    });
    ipcMain.handle("input-assist:copy", async (event) => {
      this.assertSender(event.sender.id);
      void logger.info("input_assist.ipc.received", { command: "copy" });
      await this.callbacks.onCopy();
    });
    ipcMain.handle("input-assist:retry", async (event) => {
      this.assertSender(event.sender.id);
      void logger.info("input_assist.ipc.received", { command: "retry" });
      await this.callbacks.onRetry();
    });
    ipcMain.handle("input-assist:cancel", (event) => {
      this.assertSender(event.sender.id);
      void logger.info("input_assist.ipc.received", { command: "cancel" });
      this.callbacks.onCancel();
    });
  }

  private logState(view: InputAssistView, fields: Record<string, unknown> = {}): void {
    if (!this.window) {
      return;
    }

    const bounds = this.window.getBounds();
    void logger.info("input_assist.window.state", {
      view,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      hasActiveTarget: Boolean(this.activeTarget),
      hasContextBounds: Boolean(this.contextBounds),
      userMovedPanel: this.userMovedPanel,
      ...fields,
    });
  }

  private trackWindowMove(): void {
    if (!this.window || this.currentView === "hidden" || this.currentView === "icon") {
      return;
    }

    const bounds = this.window.getBounds();
    if (
      this.expectedProgrammaticPosition &&
      bounds.x === this.expectedProgrammaticPosition.x &&
      bounds.y === this.expectedProgrammaticPosition.y
    ) {
      this.expectedProgrammaticPosition = null;
      return;
    }

    this.userMovedPanel = true;
  }

  private resizeAndPositionWindow(width: number, height: number): void {
    if (!this.window) {
      return;
    }

    if (!this.activeTarget) {
      const size = this.clampedSizeForArea(width, height, this.getFallbackWorkArea());
      this.window.setSize(size.width, size.height, false);
      if (this.currentView === "preview") {
        this.centerInContext(size.width, size.height);
        return;
      }

      this.positionFromFallbackAnchor(size.width, size.height);
      return;
    }

    const display = screen.getDisplayMatching({
      x: this.activeTarget.bounds.x,
      y: this.activeTarget.bounds.y,
      width: this.activeTarget.bounds.width,
      height: this.activeTarget.bounds.height,
    });
    const workArea = {
      x: display.workArea.x,
      y: display.workArea.y,
      width: display.workArea.width,
      height: display.workArea.height,
    };
    const size = this.clampedSizeForArea(width, height, workArea);
    this.window.setSize(size.width, size.height, false);

    if (size.width === ICON_SIZE && size.height === ICON_SIZE) {
      const iconPosition = iconPositionForBounds(this.activeTarget.bounds, ICON_SIZE, workArea);
      this.setWindowPosition(iconPosition.x, iconPosition.y);
      this.iconAnchor = { x: iconPosition.x, y: iconPosition.y, width: ICON_SIZE, height: ICON_SIZE };
      return;
    }

    if (this.currentView === "preview" && this.contextBounds) {
      this.centerInContext(size.width, size.height);
      return;
    }

    const anchor = this.iconAnchor ?? this.targetAnchorRect();
    this.positionPopover(size.width, size.height, anchor, workArea);
  }

  private resizeFromCurrentPanel(width: number, height: number): boolean {
    if (!this.window || this.currentView === "hidden" || this.currentView === "icon") {
      return false;
    }

    const bounds = this.window.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const workArea = display.workArea;
    const size = this.clampedSizeForArea(width, height, workArea);
    const margin = 10;
    this.window.setSize(size.width, size.height, false);
    this.setWindowPosition(
      clamp(bounds.x, workArea.x + margin, workArea.x + workArea.width - size.width - margin),
      clamp(bounds.y, workArea.y + margin, workArea.y + workArea.height - size.height - margin),
    );
    return true;
  }

  private clampedSizeForArea(width: number, height: number, workArea: Rect): { width: number; height: number } {
    return {
      width: width === ICON_SIZE ? width : clamp(width, MIN_PANEL_WIDTH, workArea.width - 20),
      height: height === ICON_SIZE ? height : clamp(height, MIN_PANEL_HEIGHT, workArea.height - 20),
    };
  }

  private positionFromFallbackAnchor(width: number, height: number): void {
    if (!this.window) {
      return;
    }

    this.fallbackAnchor ??= screen.getCursorScreenPoint();
    const workArea = this.getFallbackWorkArea();

    if (width === ICON_SIZE && height === ICON_SIZE) {
      const anchor = this.fallbackIconAnchor(workArea);
      this.iconAnchor = anchor;
      this.setWindowPosition(anchor.x, anchor.y);
      return;
    }

    const anchor = this.iconAnchor ?? this.fallbackIconAnchor(workArea);
    this.positionPopover(width, height, anchor, workArea);
  }

  private fallbackIconAnchor(workArea: Rect): Rect {
    const point = this.fallbackAnchor ?? screen.getCursorScreenPoint();
    const bounds = this.contextBounds ?? workArea;
    const margin = 16;
    return {
      x: clamp(bounds.x + bounds.width - ICON_SIZE - margin, workArea.x + margin, workArea.x + workArea.width - ICON_SIZE - margin),
      y: clamp(point.y - Math.round(ICON_SIZE / 2), bounds.y + margin, bounds.y + bounds.height - ICON_SIZE - margin),
      width: ICON_SIZE,
      height: ICON_SIZE,
    };
  }

  private targetAnchorRect(): Rect {
    if (!this.activeTarget) {
      return this.iconAnchor ?? { x: 0, y: 0, width: ICON_SIZE, height: ICON_SIZE };
    }

    return {
      x: this.activeTarget.bounds.x + this.activeTarget.bounds.width - ICON_SIZE - 8,
      y: this.activeTarget.bounds.y + Math.max(0, Math.round((this.activeTarget.bounds.height - ICON_SIZE) / 2)),
      width: ICON_SIZE,
      height: ICON_SIZE,
    };
  }

  private positionPopover(width: number, height: number, anchor: Rect, workArea: Rect): void {
    if (!this.window) {
      return;
    }

    const margin = 10;
    const candidates = [
      { x: anchor.x + anchor.width - width, y: anchor.y + anchor.height + margin },
      { x: anchor.x + anchor.width - width, y: anchor.y - height - margin },
      { x: anchor.x - width - margin, y: anchor.y + Math.round((anchor.height - height) / 2) },
    ];
    const match = candidates.find((candidate) => isInside(candidate.x, candidate.y, width, height, workArea, margin));

    if (match) {
      this.setWindowPosition(match.x, match.y);
      return;
    }

    const center = this.contextBounds ?? workArea;
    this.setWindowPosition(
      clamp(center.x + Math.round((center.width - width) / 2), workArea.x + margin, workArea.x + workArea.width - width - margin),
      clamp(center.y + Math.round((center.height - height) / 2), workArea.y + margin, workArea.y + workArea.height - height - margin),
    );
  }

  private centerInContext(width: number, height: number): void {
    if (!this.window) {
      return;
    }

    const workArea = this.getFallbackWorkArea();
    const bounds = this.contextBounds ?? workArea;
    const margin = 10;
    this.setWindowPosition(
      clamp(bounds.x + Math.round((bounds.width - width) / 2), workArea.x + margin, workArea.x + workArea.width - width - margin),
      clamp(bounds.y + Math.round((bounds.height - height) / 2), workArea.y + margin, workArea.y + workArea.height - height - margin),
    );
  }

  private setWindowPosition(x: number, y: number): void {
    if (!this.window) {
      return;
    }

    this.expectedProgrammaticPosition = { x, y };
    this.window.setPosition(x, y, false);
  }

  private getFallbackWorkArea(): Rect {
    const bounds = this.contextBounds;
    if (bounds) {
      const display = screen.getDisplayMatching(bounds);
      return display.workArea;
    }

    this.fallbackAnchor ??= screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(this.fallbackAnchor);
    return display.workArea;
  }

  private assertSender(senderId: number): void {
    if (senderId !== this.window?.webContents.id) {
      throw new Error("Invalid Input Assist IPC sender.");
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}

function isInside(x: number, y: number, width: number, height: number, bounds: Rect, margin: number): boolean {
  return (
    x >= bounds.x + margin &&
    y >= bounds.y + margin &&
    x + width <= bounds.x + bounds.width - margin &&
    y + height <= bounds.y + bounds.height - margin
  );
}

function hardenWindow(window: InstanceType<typeof BrowserWindow>): void {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
}
