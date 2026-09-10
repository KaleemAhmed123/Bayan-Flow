const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("settingsBridge", {
  load: () => ipcRenderer.invoke("settings:load"),
  save: (config) => ipcRenderer.invoke("settings:save", config),
  testMicrophone: () => ipcRenderer.invoke("settings:test-mic"),
  lastDebugCase: () => ipcRenderer.invoke("debug:last-case"),
  listMicrophones: () => ipcRenderer.invoke("settings:list-microphones"),
  historyList: () => ipcRenderer.invoke("history:list"),
  historyStats: () => ipcRenderer.invoke("history:stats"),
  historyRemove: (id) => ipcRenderer.invoke("history:remove", id),
  historyClear: () => ipcRenderer.invoke("history:clear"),
});
