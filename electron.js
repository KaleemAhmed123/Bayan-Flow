import * as electronModule from "electron";
export const { app, BrowserWindow, clipboard, crashReporter, ipcMain, Menu, nativeImage, safeStorage, shell, Tray, } = electronModule.default ?? electronModule;
