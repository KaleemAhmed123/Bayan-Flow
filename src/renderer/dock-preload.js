const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dockBridge", {
  onView: (callback) => ipcRenderer.on("dock:view", (_event, view) => callback(view)),
  reportSize: (size) => ipcRenderer.invoke("dock:resize", size),
  send: (name, payload) => ipcRenderer.invoke("dock:command", name, payload),
});
