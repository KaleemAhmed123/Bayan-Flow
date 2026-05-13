const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("statusBridge", {
  onUpdate: (callback) => ipcRenderer.on("status:update", (_event, message) => callback(message)),
  accept: () => ipcRenderer.invoke("status:accept"),
  cancel: () => ipcRenderer.invoke("status:cancel"),
});
