const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  reveal: relativePath => ipcRenderer.invoke("resume:reveal", relativePath),
  drag: relativePath => ipcRenderer.send("resume:drag", relativePath),
});
