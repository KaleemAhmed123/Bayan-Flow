const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("inputAssistBridge", {
  onState: (callback) => ipcRenderer.on("input-assist:state", (_event, state) => callback(state)),
  openMenu: () => ipcRenderer.invoke("input-assist:open-menu"),
  runAction: (actionId, customInstruction) => ipcRenderer.invoke("input-assist:action", actionId, customInstruction),
  speak: () => ipcRenderer.invoke("input-assist:speak"),
  replace: () => ipcRenderer.invoke("input-assist:replace"),
  copy: () => ipcRenderer.invoke("input-assist:copy"),
  retry: () => ipcRenderer.invoke("input-assist:retry"),
  cancel: () => ipcRenderer.invoke("input-assist:cancel"),
});
