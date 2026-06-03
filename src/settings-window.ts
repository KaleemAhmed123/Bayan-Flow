import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigStore, normalizeConfig } from "./config-store.js";
import { BrowserWindow, ipcMain } from "./electron.js";
import { parseHotkey } from "./hotkey/hotkey-parser.js";
import { logger } from "./observability/app-logger.js";
import type { AppConfig } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type SettingsHealth = {
  hasGroqApiKey: boolean;
  hotkeyAvailable: boolean;
  lastErrorId: string;
  lastMicError: string;
  pasteMode: "auto" | "copy";
  logDir: string;
};

export class SettingsWindow {
  private window: InstanceType<typeof BrowserWindow> | null = null;

  constructor(
    private readonly configStore: ConfigStore,
    private onConfigSaved: (config: AppConfig) => Promise<void>,
    private readonly getHealth: () => SettingsHealth,
    private readonly onTestMicrophone: () => Promise<void>,
  ) {}

  async show(): Promise<void> {
    if (this.window) {
      this.window.show();
      this.window.focus();
      void logger.info("settings.show.existing");
      return;
    }

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
        inputAssistEnabledOnStartup:
          typeof config.inputAssistEnabledOnStartup === "boolean"
            ? config.inputAssistEnabledOnStartup
            : existingConfig.inputAssistEnabledOnStartup,
        openAtLogin: typeof config.openAtLogin === "boolean" ? config.openAtLogin : existingConfig.openAtLogin,
      });
      await this.configStore.save(nextConfig);
      await this.onConfigSaved(nextConfig);
      void logger.info("settings.save.success", {
        hasGroqApiKey: Boolean(nextConfig.groqApiKey),
        hotkey: nextConfig.hotkey,
        inputAssistHotkey: nextConfig.inputAssistHotkey,
        inputAssistEnabledOnStartup: nextConfig.inputAssistEnabledOnStartup,
        autoPaste: nextConfig.autoPaste,
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

    this.window = new BrowserWindow({
      width: 920,
      height: 760,
      minWidth: 820,
      minHeight: 700,
      resizable: true,
      title: "BayanFlow Settings",
      icon: path.join(__dirname, "assets", "tray-icon.ico"),
      backgroundColor: "#eef2f6",
      webPreferences: {
        preload: path.join(__dirname, "renderer", "settings-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    hardenWindow(this.window);

    this.window.on("closed", () => {
      this.window = null;
      ipcMain.removeHandler("settings:load");
      ipcMain.removeHandler("settings:save");
      ipcMain.removeHandler("settings:test-mic");
      void logger.info("settings.closed");
    });

    await this.window.loadFile(path.join(__dirname, "renderer", "settings.html"));
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
