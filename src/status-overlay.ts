import path from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, ipcMain } from "./electron.js";
import { logger } from "./observability/app-logger.js";
import type { StatusMessage } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class StatusOverlay {
  private window: InstanceType<typeof BrowserWindow> | null = null;
  private hideTimer: NodeJS.Timeout | null = null;
  private confirmResolver: ((accepted: boolean) => void) | null = null;

  async init(): Promise<void> {
    this.window = new BrowserWindow({
      width: 280,
      height: 72,
      frame: false,
      show: false,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      transparent: true,
      focusable: false,
      webPreferences: {
        preload: path.join(__dirname, "renderer", "status-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    hardenWindow(this.window);

    ipcMain.handle("status:accept", (event) => {
      this.assertSender(event.sender.id);
      void logger.info("status.accept");
      this.resolveConfirm(true);
    });
    ipcMain.handle("status:cancel", (event) => {
      this.assertSender(event.sender.id);
      void logger.info("status.cancel");
      this.resolveConfirm(false);
    });

    await this.window.loadFile(path.join(__dirname, "renderer", "status.html"));
    void logger.info("status.init.success");
  }

  show(message: StatusMessage): void {
    if (!this.window) {
      return;
    }

    this.window.webContents.send("status:update", message);
    void logger.debug("status.show", { status: message.status, messageChars: message.message.length });

    this.window.showInactive();

    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
    }

    if (message.status === "idle" || message.status === "error") {
      this.hideTimer = setTimeout(() => this.window?.hide(), message.status === "error" ? 2500 : 900);
    }
  }

  confirm(message: string): Promise<boolean> {
    this.show({ status: "confirm", message });

    return new Promise((resolve) => {
      this.confirmResolver = resolve;
    });
  }

  acceptPendingConfirm(): boolean {
    if (!this.confirmResolver) {
      return false;
    }

    void logger.info("status.accept_pending");
    this.resolveConfirm(true);
    return true;
  }

  destroy(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
    }

    this.window?.destroy();
    this.window = null;
    ipcMain.removeHandler("status:accept");
    ipcMain.removeHandler("status:cancel");
  }

  private resolveConfirm(accepted: boolean): void {
    this.confirmResolver?.(accepted);
    this.confirmResolver = null;
  }

  private assertSender(senderId: number): void {
    if (senderId !== this.window?.webContents.id) {
      throw new Error("Invalid status IPC sender.");
    }
  }
}

function hardenWindow(window: InstanceType<typeof BrowserWindow>): void {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
}
