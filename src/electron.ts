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
  ipcMain,
  Menu,
  nativeImage,
  safeStorage,
  shell,
  Tray,
} = electron;
