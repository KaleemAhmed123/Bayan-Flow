const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("settingsBridge", {
  load: () => ipcRenderer.invoke("settings:load"),
  save: (config) => ipcRenderer.invoke("settings:save", config),
  testMicrophone: () => ipcRenderer.invoke("settings:test-mic"),
});
