const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("recorderBridge", {
  onStart: (callback) => ipcRenderer.on("recorder:start", callback),
  onStop: (callback) => ipcRenderer.on("recorder:stop", callback),
  onPrewarm: (callback) => ipcRenderer.on("recorder:prewarm", callback),
  onTestMic: (callback) => ipcRenderer.on("recorder:test-mic", callback),
  onListDevices: (callback) => ipcRenderer.on("recorder:list-devices", callback),
  devicesListed: (response) => ipcRenderer.invoke("recorder:devices", response),
  started: (response) => ipcRenderer.invoke("recorder:started", response),
  stopped: (response) => ipcRenderer.invoke("recorder:stopped", response),
  failed: (response) => ipcRenderer.invoke("recorder:error", response),
  micTested: (response) => ipcRenderer.invoke("recorder:mic-tested", response),
});
