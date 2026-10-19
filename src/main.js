// @ts-check
// Electron shell: one frameless window, one robot, and an "are you sure?" before every cleanup.

const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { app, BrowserWindow, ipcMain, shell, safeStorage } = require("electron");
const Anthropic = require("@anthropic-ai/sdk").default;
const { makeTools } = require("./tools");
const { createAgent } = require("./agent");

/** @type {BrowserWindow | null} */
let win = null;
const send = (channel, payload) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
};

// ---------- API key: a pasted key (encrypted by the OS keychain) wins over the environment ----------

const keyFile = () => path.join(app.getPath("userData"), "api-key.bin");
/** @type {string | undefined} */
let savedKey;

async function loadKey() {
  try {
    savedKey = safeStorage.decryptString(await fs.readFile(keyFile()));
  } catch {
    savedKey = undefined;
  }
}

function keyStatus() {
  if (savedKey) return "saved";
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return "env";
  return "missing";
}

ipcMain.handle("key:status", () => keyStatus());
ipcMain.handle("key:save", async (_e, raw) => {
  const key = String(raw ?? "").trim();
  if (!key) return { ok: false, error: "Paste a key first." };
  try {
    await new Anthropic({ apiKey: key }).models.retrieve("claude-opus-5-5");
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return { ok: false, error: "That key was rejected." };
    if (err instanceof Anthropic.APIConnectionError) return { ok: false, error: "Can't reach the Anthropic API." };
    if (err instanceof Anthropic.APIError) return { ok: false, error: `API error ${err.status}: ${err.message}` };
    return { ok: false, error: String(err) };
  }
  savedKey = key;
  if (!safeStorage.isEncryptionAvailable()) return { ok: true, persisted: false };
  await fs.writeFile(keyFile(), safeStorage.encryptString(key));
  return { ok: true, persisted: true };
});
ipcMain.handle("key:forget", async () => {
  savedKey = undefined;
  await fs.rm(keyFile(), { force: true });
  return keyStatus();
});

// ---------- "are you sure?" lives in the window, the answer comes back here ----------

/** @type {Map<number, (ok: boolean) => void>} */
const pending = new Map();
let lastAsk = 0;

function confirm(ask) {
  if (!win) return Promise.resolve(false);
  const id = ++lastAsk;
  send("confirm:ask", { id, ...ask });
  return new Promise((resolve) => pending.set(id, resolve));
}

function answer(id, ok) {
  pending.get(id)?.(ok === true);
  pending.delete(id);
}

function cancelAsks() {
  for (const id of [...pending.keys()]) answer(id, false);
  send("confirm:cancel");
}

ipcMain.handle("confirm:answer", (_e, id, ok) => answer(id, ok));

// ---------- the robot ----------

const tools = makeTools({
  confirm,
  trash: async (paths) => {
    for (const p of paths) await shell.trashItem(p);
  },
  launch: async (cmd) => {
    // UninstallString comes from the Windows registry, not from the model.
    spawn(cmd, { shell: true, detached: true, stdio: "ignore" }).unref();
  },
  onFreed: (bytes) => send("agent:event", { type: "freed", bytes }),
});

const agent = createAgent({ tools, emit: (event) => send("agent:event", event), apiKey: () => savedKey });

ipcMain.handle("agent:send", (_e, text) => agent.send(String(text)));
ipcMain.handle("agent:stop", () => {
  cancelAsks();
  agent.stop();
});
ipcMain.handle("agent:reset", () => {
  cancelAsks();
  agent.reset();
});
ipcMain.handle("disk:info", async () => {
  const disk = await fs.statfs(os.homedir()).catch(() => null);
  return disk && { free: disk.bavail * disk.bsize, total: disk.blocks * disk.bsize };
});
ipcMain.handle("open:console", () => shell.openExternal("https://console.anthropic.com/settings/keys"));

// ---------- window ----------

function createWindow() {
  const mac = process.platform === "darwin";
  win = new BrowserWindow({
    width: 1160,
    height: 800,
    minWidth: 860,
    minHeight: 620,
    title: "bytevac",
    icon: path.join(__dirname, "ui", "icon.png"),
    show: false,
    backgroundColor: "#07080c",
    titleBarStyle: "hidden",
    ...(mac
      ? { trafficLightPosition: { x: 20, y: 20 } }
      : { titleBarOverlay: { color: "#0a0b10", symbolColor: "#c9cdd8", height: 52 } }),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.once("ready-to-show", () => win?.show());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.on("closed", () => {
    win = null;
    cancelAsks();
  });
  win.loadFile(path.join(__dirname, "ui", "index.html"));
}

app.whenReady().then(async () => {
  await loadKey();
  createWindow();
  app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
