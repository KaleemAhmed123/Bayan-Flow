import path from "node:path";
import { assetsDir, rendererDir } from "./app-paths.js";
import { ConfigStore, normalizeConfig } from "./config-store.js";
import { HistoryStore } from "./history/history-store.js";
import { BrowserWindow, shell } from "./electron.js";
import { hardenWindow } from "./electron-window.js";
import { IpcHandlerSet } from "./ipc-handler-set.js";
import { parseHotkey } from "./hotkey/hotkey-parser.js";
import { logger } from "./observability/logger.js";
import type { AppConfig } from "./types.js";

/** Where a new user gets their key. The only URL the app will ever open. */
export const GROQ_CONSOLE_URL = "https://console.groq.com/keys";

export type SettingsHealth = {
  hasGroqApiKey: boolean;
  hotkeyAvailable: boolean;
  lastErrorId: string;
  lastMicError: string;
  pasteMode: "auto" | "copy";
  logDir: string;
  /** False when safeStorage is unavailable and the key sits in config.json as text. */
  apiKeyEncrypted: boolean;
};

/**
 * The one BayanFlow window. It is called SettingsWindow for history, but since
 * the History and Stats pages landed it hosts four pages behind a sidebar:
 * Home, History, Stats, and Settings. The dock is still the only other surface.
 */
export class SettingsWindow {
  private window: InstanceType<typeof BrowserWindow> | null = null;
  private readonly handlers = new IpcHandlerSet();

  constructor(
    private readonly configStore: ConfigStore,
    private readonly historyStore: HistoryStore,
    private onConfigSaved: (config: AppConfig) => Promise<void>,
    private readonly getHealth: () => SettingsHealth,
    private readonly onTestMicrophone: () => Promise<void>,
    private readonly listMicrophones: () => Promise<{ deviceId: string; label: string }[]>,
    /** The last dictation as a case payload, or null when nothing is retained. */
    private readonly getLastCase: () => unknown,
  ) {}

  async show(): Promise<void> {
    if (this.window) {
      this.window.show();
      this.window.focus();
      void logger.info("settings.show.existing");
      return;
    }

    this.handlers.handle("settings:list-microphones", (event) => {
      this.assertSender(event.sender.id);
      return this.listMicrophones();
    });
    this.handlers.handle("settings:load", (event) => {
      this.assertSender(event.sender.id);
      return this.configStore.load().then((config) => ({
        ...config,
        groqApiKey: "",
        health: this.getHealth(),
      }));
    });
    this.handlers.handle("settings:save", async (event, config: AppConfig) => {
      this.assertSender(event.sender.id);
      validateSubmittedHotkey(config.hotkey);
      validateSubmittedHotkey(config.inputAssistHotkey);
      const existingConfig = await this.configStore.load();
      const nextConfig = normalizeConfig({
        ...config,
        groqApiKey: config.groqApiKey?.trim() ? config.groqApiKey : existingConfig.groqApiKey,
        showDock: typeof config.showDock === "boolean" ? config.showDock : existingConfig.showDock,
        openAtLogin: typeof config.openAtLogin === "boolean" ? config.openAtLogin : existingConfig.openAtLogin,
        // Onboarding progress is recorded by the main process when a step really
        // succeeds. The renderer never sends it, so taking it from the form would
        // reset all three to false on every save.
        didTestMicrophone: existingConfig.didTestMicrophone,
        didDictate: existingConfig.didDictate,
        didRewrite: existingConfig.didRewrite,
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
    // Read only, and returns null unless debug capture is on. The panel shows
    // exactly what the export writes, so the screen and the file can never
    // disagree when the user sends one over.
    this.handlers.handle("debug:last-case", (event) => {
      this.assertSender(event.sender.id);
      return this.getLastCase();
    });
    // One hard-coded destination, not an open-any-URL bridge. A general one
    // would hand a compromised renderer an outbound channel; this one can only
    // ever reach the page where the user gets their key.
    this.handlers.handle("app:open-groq-console", async (event) => {
      this.assertSender(event.sender.id);
      await shell.openExternal(GROQ_CONSOLE_URL);
      void logger.info("settings.groq_console.opened");
      return { ok: true };
    });
    this.handlers.handle("settings:test-mic", async (event) => {
      this.assertSender(event.sender.id);
      await this.onTestMicrophone();
      return { ok: true };
    });

    // History IPC. Read and delete only: nothing here can write a new entry, so
    // a compromised renderer cannot forge history or reach any other file.
    this.handlers.handle("history:list", (event) => {
      this.assertSender(event.sender.id);
      return this.historyStore.list();
    });
    this.handlers.handle("history:stats", (event) => {
      this.assertSender(event.sender.id);
      return this.historyStore.stats();
    });
    this.handlers.handle("history:remove", async (event, id: unknown) => {
      this.assertSender(event.sender.id);
      if (typeof id !== "string" || !id.trim()) {
        throw new Error("Invalid history id.");
      }

      await this.historyStore.remove(id);
      return { ok: true };
    });
    this.handlers.handle("history:clear", async (event) => {
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
      // Every channel this show() registered, and nothing else. Listing them by
      // hand is what made Settings unopenable after its first close.
      this.handlers.removeAll();
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


function validateSubmittedHotkey(hotkey: unknown): void {
  if (typeof hotkey !== "string" || !hotkey.trim()) {
    throw new Error("Choose a hotkey before saving.");
  }

  const parsed = parseHotkey(hotkey);
  if (parsed.modifiers.length === 0) {
    throw new Error("Hotkey must include at least one modifier, such as Ctrl or Alt.");
  }
}
