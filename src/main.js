// @ts-check
// Electron shell: one window, one robot, native dialogs for every "are you sure?".

const path = require("node:path");
const { spawn } = require("node:child_process");
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { makeTools } = require("./tools");
const { createAgent } = require("./agent");

/** @type {BrowserWindow | null} */
let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 760,
    height: 820,
    minWidth: 480,
    title: "bytevac",
    backgroundColor: "#0f1115",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, "index.html"));
}

const tools = makeTools({
  confirm: async ({ title, detail }) => {
    const opts = {
      type: /** @type {const} */ ("question"),
      buttons: ["Do it", "Keep it"],
      defaultId: 1,
      cancelId: 1,
      title: "bytevac wants to clean",
      message: title,
      detail,
    };
    const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
    return response === 0;
  },
  trash: async (paths) => {
    for (const p of paths) await shell.trashItem(p);
  },
  launch: async (cmd) => {
    // UninstallString comes from the Windows registry, not from the model.
    spawn(cmd, { shell: true, detached: true, stdio: "ignore" }).unref();
  },
});

const agent = createAgent({ tools, emit: (event) => win?.webContents.send("agent:event", event) });

ipcMain.handle("agent:send", (_e, text) => agent.send(String(text)));
ipcMain.handle("agent:stop", () => agent.stop());
ipcMain.handle("agent:reset", () => agent.reset());
ipcMain.handle("agent:hasKey", () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN));

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
