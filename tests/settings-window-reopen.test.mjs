import assert from "node:assert/strict";
import test from "node:test";

/**
 * The defect this guards against: SettingsWindow.show() registered nine IPC
 * channels and the closed handler removed eight of them by name. The one it
 * missed, `debug:last-case`, was still registered on the second show(), and
 * Electron throws on a duplicate channel — so the window was never created and
 * the caller's `void show()` swallowed the rejection. Settings opened exactly
 * once per app run and then did nothing, forever, with no error anywhere.
 *
 * The fake below copies the only Electron behaviour that matters here: handle()
 * throws when a channel is already registered.
 */
function installFakeElectron() {
  const handlers = new Map();
  const fakeWindow = {
    webContents: { id: 7, setWindowOpenHandler() {}, on() {} },
    on(event, fn) {
      if (event === "closed") {
        fakeWindow.close = fn;
      }
    },
    show() {},
    focus() {},
    loadFile: async () => {},
  };

  globalThis.__bayanFlowElectron = {
    app: { getPath: () => "." },
    BrowserWindow: function BrowserWindow() {
      return fakeWindow;
    },
    ipcMain: {
      handle(channel, fn) {
        if (handlers.has(channel)) {
          throw new Error(`Attempted to register a second handler for '${channel}'`);
        }

        handlers.set(channel, fn);
      },
      removeHandler(channel) {
        handlers.delete(channel);
      },
    },
    safeStorage: { isEncryptionAvailable: () => false },
    clipboard: {},
    crashReporter: {},
    desktopCapturer: {},
    dialog: {},
    globalShortcut: {},
    Menu: {},
    net: {},
    nativeImage: {},
    screen: {},
    shell: {},
    Tray: function Tray() {},
  };

  return { handlers, fakeWindow };
}

async function buildSettingsWindow() {
  const { SettingsWindow } = await import("../dist/settings-window.js");
  const { ConfigStore } = await import("../dist/config-store.js");
  const { HistoryStore } = await import("../dist/history/history-store.js");

  return new SettingsWindow(
    new ConfigStore("./.test-config.json"),
    new HistoryStore("./.test-history.jsonl"),
    async () => {},
    () => ({
      hasGroqApiKey: false,
      hotkeyAvailable: true,
      lastErrorId: "",
      lastMicError: "",
      pasteMode: "auto",
      logDir: "",
    }),
    async () => {},
    async () => [],
    () => null,
  );
}

test("settings window can be opened, closed and opened again", async () => {
  const { handlers, fakeWindow } = installFakeElectron();
  const settings = await buildSettingsWindow();

  await settings.show();
  const registeredOnFirstOpen = handlers.size;
  assert.ok(registeredOnFirstOpen > 0, "first open must register handlers");

  fakeWindow.close();
  assert.equal(handlers.size, 0, "closing must remove every handler it registered, including debug:last-case");

  // The regression: this used to throw before the window was created.
  await settings.show();
  assert.equal(handlers.size, registeredOnFirstOpen, "reopening must register the same set again");

  fakeWindow.close();
  await settings.show();
  assert.equal(handlers.size, registeredOnFirstOpen, "a third open must still work");
});

test("the recorder removes every channel it registered", async () => {
  installFakeElectron();
  const { IpcHandlerSet } = await import("../dist/ipc-handler-set.js");

  const set = new IpcHandlerSet();
  set.handle("recorder:started", () => {});
  set.handle("recorder:devices", () => {});
  assert.deepEqual([...set.registered], ["recorder:started", "recorder:devices"]);

  set.removeAll();
  assert.equal(set.registered.length, 0);

  // Re-registering the same channels must not throw once they are removed.
  set.handle("recorder:started", () => {});
  set.handle("recorder:devices", () => {});
  assert.equal(set.registered.length, 2);
});
