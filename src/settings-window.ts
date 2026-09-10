import path from "node:path";
import { assetsDir, rendererDir } from "./app-paths.js";
import { ConfigStore, normalizeConfig } from "./config-store.js";
import { HistoryStore } from "./history/history-store.js";
import { BrowserWindow, ipcMain } from "./electron.js";
import { parseHotkey } from "./hotkey/hotkey-parser.js";
import { logger } from "./observability/app-logger.js";
import type { AppConfig } from "./types.js";

export type SettingsHealth = {
  hasGroqApiKey: boolean;
  hotkeyAvailable: boolean;
  lastErrorId: string;
  lastMicError: string;
  pasteMode: "auto" | "copy";
  logDir: string;
};

/**
 * The one BayanFlow window. It is called SettingsWindow for history, but since
 * the History and Stats pages landed it hosts four pages behind a sidebar:
 * Home, History, Stats, and Settings. The dock is still the only other surface.
 */
export class SettingsWindow {
  private window: InstanceType<typeof BrowserWindow> | null = null;

  constructor(
    private readonly configStore: ConfigStore,
    private readonly historyStore: HistoryStore,
    private onConfigSaved: (config: AppConfig) => Promise<void>,
    private readonly getHealth: () => SettingsHealth,
    private readonly onTestMicrophone: () => Promise<void>,
    private readonly listMicrophones: () => Promise<{ deviceId: string; label: string }[]>,
  ) {}

  async show(): Promise<void> {
    if (this.window) {
      this.window.show();
      this.window.focus();
      void logger.info("settings.show.existing");
      return;
    }

    ipcMain.handle("settings:list-microphones", (event) => {
      this.assertSender(event.sender.id);
      return this.listMicrophones();
    });
    ipcMain.handle("settings:load", (event) => {
      this.assertSender(event.sender.id);
      return this.configStore.load().then((config) => ({
        ...config,
        groqApiKey: "",
        health: this.getHealth(),
      }));
    });
    ipcMain.handle("settings:save", async (event, config: AppConfig) => {
      this.assertSender(event.sender.id);
      validateSubmittedHotkey(config.hotkey);
      validateSubmittedHotkey(config.inputAssistHotkey);
      const existingConfig = await this.configStore.load();
      const nextConfig = normalizeConfig({
        ...config,
        groqApiKey: config.groqApiKey?.trim() ? config.groqApiKey : existingConfig.groqApiKey,
        showDock: typeof config.showDock === "boolean" ? config.showDock : existingConfig.showDock,
        openAtLogin: typeof config.openAtLogin === "boolean" ? config.openAtLogin : existingConfig.openAtLogin,
      });
      await this.configStore.save(nextConfig);
      await this.onConfigSaved(nextConfig);
      void logger.info("settings.save.success", {
        hasGroqApiKey: Boolean(nextConfig.groqApiKey),
        hotkey: nextConfig.hotkey,
        inputAssistHotkey: nextConfig.inputAssistHotkey,
        showDock: nextConfig.showDock,
        autoPaste: nextConfig.autoPaste,
        historyEnabled: nextConfig.historyEnabled,
        cleanupEnabled: nextConfig.cleanupEnabled,
        openAtLogin: nextConfig.openAtLogin,
      });
      return {
        ...nextConfig,
        groqApiKey: "",
        health: this.getHealth(),
      };
    });
    ipcMain.handle("settings:test-mic", async (event) => {
      this.assertSender(event.sender.id);
      await this.onTestMicrophone();
      return { ok: true };
    });

    // History IPC. Read and delete only: nothing here can write a new entry, so
    // a compromised renderer cannot forge history or reach any other file.
    ipcMain.handle("history:list", (event) => {
      this.assertSender(event.sender.id);
      return this.historyStore.list();
    });
    ipcMain.handle("history:stats", (event) => {
      this.assertSender(event.sender.id);
      return this.historyStore.stats();
    });
    ipcMain.handle("history:remove", async (event, id: unknown) => {
      this.assertSender(event.sender.id);
      if (typeof id !== "string" || !id.trim()) {
        throw new Error("Invalid history id.");
      }

      await this.historyStore.remove(id);
      return { ok: true };
    });
    ipcMain.handle("history:clear", async (event) => {
      this.assertSender(event.sender.id);
      await this.historyStore.clear();
      return { ok: true };
    });

    this.window = new BrowserWindow({
      width: 920,
      height: 760,
      minWidth: 820,
      minHeight: 700,
      resizable: true,
      title: "BayanFlow",
      icon: path.join(assetsDir, "tray-icon.ico"),
      backgroundColor: "#0a0b0f",
      webPreferences: {
        preload: path.join(rendererDir, "settings-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    hardenWindow(this.window);

    this.window.on("closed", () => {
      this.window = null;
      ipcMain.removeHandler("settings:list-microphones");
      ipcMain.removeHandler("settings:load");
      ipcMain.removeHandler("settings:save");
      ipcMain.removeHandler("settings:test-mic");
      ipcMain.removeHandler("history:list");
      ipcMain.removeHandler("history:stats");
      ipcMain.removeHandler("history:remove");
      ipcMain.removeHandler("history:clear");
      void logger.info("settings.closed");
    });

    await this.window.loadFile(path.join(rendererDir, "settings.html"));
    void logger.info("settings.show.created");
  }

  private assertSender(senderId: number): void {
    if (senderId !== this.window?.webContents.id) {
      throw new Error("Invalid settings IPC sender.");
    }
  }
}

function hardenWindow(window: InstanceType<typeof BrowserWindow>): void {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
}

function validateSubmittedHotkey(hotkey: unknown): void {
  if (typeof hotkey !== "string" || !hotkey.trim()) {
    throw new Error("Choose a hotkey before saving.");
  }

  const parsed = parseHotkey(hotkey);
  if (parsed.modifiers.length === 0) {
    throw new Error("Hotkey must include at least one modifier, such as Ctrl or Alt.");
  }
}
