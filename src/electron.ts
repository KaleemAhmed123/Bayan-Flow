import * as electronModule from "electron";

const electron =
  (globalThis as typeof globalThis & { __bayanFlowElectron?: typeof import("electron") }).__bayanFlowElectron ??
  (electronModule as typeof import("electron") & { default?: typeof import("electron") }).default ??
  electronModule;

export const {
  app,
  BrowserWindow,
  clipboard,
  crashReporter,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  net,
  nativeImage,
  safeStorage,
  screen,
  shell,
  Tray,
} = electron;
