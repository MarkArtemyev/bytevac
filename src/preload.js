// @ts-check
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bytevac", {
  platform: process.platform,
  send: (text) => ipcRenderer.invoke("agent:send", text),
  stop: () => ipcRenderer.invoke("agent:stop"),
  reset: () => ipcRenderer.invoke("agent:reset"),
  diskInfo: () => ipcRenderer.invoke("disk:info"),
  keyStatus: () => ipcRenderer.invoke("key:status"),
  saveKey: (key) => ipcRenderer.invoke("key:save", key),
  forgetKey: () => ipcRenderer.invoke("key:forget"),
  openConsole: () => ipcRenderer.invoke("open:console"),
  answer: (id, ok) => ipcRenderer.invoke("confirm:answer", id, ok),
  onEvent: (cb) => ipcRenderer.on("agent:event", (_e, event) => cb(event)),
  onAsk: (cb) => ipcRenderer.on("confirm:ask", (_e, ask) => cb(ask)),
  onAskCancel: (cb) => ipcRenderer.on("confirm:cancel", () => cb()),
});
