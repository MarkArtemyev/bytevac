// @ts-check
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bytevac", {
  send: (text) => ipcRenderer.invoke("agent:send", text),
  stop: () => ipcRenderer.invoke("agent:stop"),
  reset: () => ipcRenderer.invoke("agent:reset"),
  hasKey: () => ipcRenderer.invoke("agent:hasKey"),
  onEvent: (cb) => ipcRenderer.on("agent:event", (_e, event) => cb(event)),
});
