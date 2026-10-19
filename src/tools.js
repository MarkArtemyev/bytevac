// @ts-check
// Everything the robot is allowed to do to your computer lives here.
// Looking around is free. Throwing anything away goes through `confirm`.

const fs = require("node:fs/promises");
const { realpathSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { z } = require("zod");
const { betaZodTool } = require("@anthropic-ai/sdk/helpers/beta/zod");

const run = promisify(execFile);
// Real paths, so symlinks like macOS's /tmp -> /private/tmp compare correctly.
const real = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};
const HOME = real(os.homedir());
const TMP = real(os.tmpdir());
const MAX_WALK_ENTRIES = 50_000;

// Folders the robot may poke around in. Everything else is off-limits.
const ROOTS = [HOME, TMP];
if (process.platform === "darwin") ROOTS.push("/Applications");

// Never trash these themselves (their contents are fine).
const PROTECTED = new Set(
  [
    HOME,
    TMP,
    "/Applications",
    ...["Desktop", "Documents", "Downloads", "Pictures", "Music", "Movies", "Videos", "Library", "AppData"].map((d) =>
      path.join(HOME, d),
    ),
  ].map(real),
);

/** Resolve a model-supplied path and make sure it stays inside ROOTS. */
async function safePath(p) {
  const expanded = p.startsWith("~") ? path.join(HOME, p.slice(1)) : p;
  const resolved = await fs.realpath(path.resolve(expanded));
  const inside = ROOTS.some((root) => {
    const rel = path.relative(root, resolved);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  });
  if (!inside) throw new Error(`${resolved} is outside the areas bytevac is allowed to touch (${ROOTS.join(", ")})`);
  return resolved;
}

function human(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${bytes.toFixed(i ? 1 : 0)} ${units[i]}`;
}

/** Walk a tree without following symlinks, calling `onFile` for every file. Stops after MAX_WALK_ENTRIES. */
async function walk(dir, onFile, budget = { left: MAX_WALK_ENTRIES }) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return; // no permission, vanished, etc.
  }
  for (const entry of entries) {
    if (budget.left-- <= 0) return;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, onFile, budget);
    else if (entry.isFile()) {
      try {
        onFile(full, await fs.stat(full));
      } catch {}
    }
  }
}

async function sizeOf(p) {
  const st = await fs.lstat(p);
  if (!st.isDirectory()) return st.size;
  let total = 0;
  await walk(p, (_f, s) => (total += s.size));
  return total;
}

function junkSpots() {
  const spots = { temp: [TMP] };
  if (process.platform === "darwin") {
    spots.caches = [path.join(HOME, "Library/Caches")];
    spots.logs = [path.join(HOME, "Library/Logs")];
    spots.trash = [path.join(HOME, ".Trash")];
    spots.dev = [path.join(HOME, "Library/Developer/Xcode/DerivedData"), path.join(HOME, ".npm/_cacache")];
  } else if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? path.join(HOME, "AppData/Local");
    spots.caches = [path.join(local, "Temp"), path.join(local, "CrashDumps")];
    spots.dev = [path.join(local, "npm-cache"), path.join(local, "pip/Cache")];
  } else {
    spots.caches = [path.join(HOME, ".cache")];
    spots.trash = [path.join(HOME, ".local/share/Trash")];
    spots.dev = [path.join(HOME, ".npm/_cacache")];
  }
  return spots;
}

// ---------- installed apps ----------

async function listApps() {
  if (process.platform === "darwin") {
    const apps = [];
    for (const dir of ["/Applications", path.join(HOME, "Applications")]) {
      let names = [];
      try {
        names = (await fs.readdir(dir)).filter((n) => n.endsWith(".app"));
      } catch {}
      for (const name of names) {
        const full = path.join(dir, name);
        const st = await fs.stat(full).catch(() => null);
        apps.push({ id: full, name: name.replace(/\.app$/, ""), size: human(await sizeOf(full)), modified: st?.mtime.toISOString().slice(0, 10) });
      }
    }
    return apps;
  }

  if (process.platform === "win32") {
    const keys = [
      "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
      "HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
      "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    ];
    const apps = [];
    for (const key of keys) {
      const { stdout } = await run("reg", ["query", key, "/s"], { maxBuffer: 32 * 1024 * 1024 }).catch(() => ({ stdout: "" }));
      for (const block of stdout.split(/\r?\n\r?\n/)) {
        const [header, ...lines] = block.trim().split(/\r?\n/);
        const values = Object.fromEntries(
          lines.map((l) => l.trim().match(/^(\S+)\s+REG_\w+\s+(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]),
        );
        if (!values.DisplayName || !values.UninstallString || values.SystemComponent === "0x1") continue;
        apps.push({
          id: header.trim(),
          name: values.DisplayName,
          publisher: values.Publisher,
          size: values.EstimatedSize ? human(parseInt(values.EstimatedSize, 16) * 1024) : undefined,
          installed: values.InstallDate,
        });
      }
    }
    return apps;
  }

  // Linux: flatpak and snap can be removed without root. Distro packages just get reported.
  const apps = [];
  const flatpak = await run("flatpak", ["list", "--app", "--columns=application,name,size"]).catch(() => null);
  for (const line of flatpak?.stdout.trim().split("\n").filter(Boolean) ?? []) {
    const [id, name, size] = line.split("\t");
    apps.push({ id: `flatpak:${id}`, name, size });
  }
  const snap = await run("snap", ["list"]).catch(() => null);
  for (const line of snap?.stdout.trim().split("\n").slice(1) ?? []) {
    const name = line.split(/\s+/)[0];
    if (name) apps.push({ id: `snap:${name}`, name });
  }
  return apps;
}

// ---------- the tools ----------

/**
 * @typedef {{kind: "trash" | "uninstall", title: string, reason: string, items: {label: string, size?: string}[], total?: string}} Ask
 * @param {object} hooks
 * @param {(ask: Ask) => Promise<boolean>} hooks.confirm  ask the human
 * @param {(paths: string[]) => Promise<void>} hooks.trash  move things to the system trash
 * @param {(cmd: string) => Promise<void>} hooks.launch  start an app's own uninstaller
 * @param {(bytes: number) => void} [hooks.onFreed]  report reclaimed space
 */
function makeTools({ confirm, trash, launch, onFreed = () => {} }) {
  let appCache = /** @type {Awaited<ReturnType<typeof listApps>> | null} */ (null);

  const systemInfo = betaZodTool({
    name: "system_info",
    description:
      "Get the OS, home folder, free disk space, and the usual places junk piles up on this machine. Call this first.",
    inputSchema: z.object({}),
    run: async () => {
      const disk = await fs.statfs(HOME).catch(() => null);
      return JSON.stringify({
        platform: process.platform,
        home: HOME,
        allowedRoots: ROOTS,
        freeSpace: disk ? human(disk.bavail * disk.bsize) : "unknown",
        totalSpace: disk ? human(disk.blocks * disk.bsize) : "unknown",
        junkSpots: junkSpots(),
      });
    },
  });

  const listDirectory = betaZodTool({
    name: "list_directory",
    description: "List what is inside a folder, biggest first, with sizes and last-modified dates.",
    inputSchema: z.object({
      path: z.string().describe("Folder to look into. ~ means the home folder."),
      limit: z.number().int().min(1).max(200).default(40),
    }),
    run: async ({ path: p, limit }) => {
      const dir = await safePath(p);
      const names = await fs.readdir(dir);
      const rows = [];
      for (const name of names) {
        const full = path.join(dir, name);
        const st = await fs.lstat(full).catch(() => null);
        if (!st || st.isSymbolicLink()) continue;
        rows.push({ name, dir: st.isDirectory(), bytes: await sizeOf(full), modified: st.mtime.toISOString().slice(0, 10) });
      }
      rows.sort((a, b) => b.bytes - a.bytes);
      return JSON.stringify({
        path: dir,
        total: human(rows.reduce((s, r) => s + r.bytes, 0)),
        entries: rows.slice(0, limit).map(({ bytes, ...r }) => ({ ...r, size: human(bytes) })),
      });
    },
  });

  const findLargeFiles = betaZodTool({
    name: "find_large_files",
    description: "Search a folder tree for big files, optionally only ones untouched for a while.",
    inputSchema: z.object({
      path: z.string().describe("Where to start searching. ~ means the home folder."),
      min_mb: z.number().min(1).default(200),
      older_than_days: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(100).default(25),
    }),
    run: async ({ path: p, min_mb, older_than_days, limit }) => {
      const root = await safePath(p);
      const cutoff = Date.now() - older_than_days * 86_400_000;
      const hits = [];
      await walk(root, (file, st) => {
        if (st.size >= min_mb * 1024 * 1024 && st.mtimeMs <= cutoff) hits.push({ file, bytes: st.size, modified: st.mtime });
      });
      hits.sort((a, b) => b.bytes - a.bytes);
      return JSON.stringify(
        hits.slice(0, limit).map((h) => ({ path: h.file, size: human(h.bytes), modified: h.modified.toISOString().slice(0, 10) })),
      );
    },
  });

  const listInstalledApps = betaZodTool({
    name: "list_installed_apps",
    description: "List installed applications with their ids, sizes and dates. Use the id with uninstall_app.",
    inputSchema: z.object({}),
    run: async () => {
      appCache = await listApps();
      return JSON.stringify(appCache);
    },
  });

  const moveToTrash = betaZodTool({
    name: "move_to_trash",
    description:
      "Move files or folders to the system trash. The human sees the list and has to approve it; they can still restore everything from the trash afterwards.",
    inputSchema: z.object({
      paths: z.array(z.string()).min(1).max(50),
      reason: z.string().describe("One or two sentences for the human on why this is junk."),
    }),
    run: async ({ paths, reason }) => {
      const targets = [];
      for (const p of paths) {
        const resolved = await safePath(p);
        if (PROTECTED.has(resolved)) throw new Error(`${resolved} is a protected folder. Pick things inside it instead.`);
        targets.push({ path: resolved, size: await sizeOf(resolved) });
      }
      const bytes = targets.reduce((s, t) => s + t.size, 0);
      const total = human(bytes);
      const ok = await confirm({
        kind: "trash",
        title: targets.length === 1 ? "Trash 1 item?" : `Trash ${targets.length} items?`,
        reason,
        items: targets.map((t) => ({ label: t.path, size: human(t.size) })),
        total,
      });
      if (!ok) return "The human said no. Do not trash these; move on or ask what they want.";
      await trash(targets.map((t) => t.path));
      onFreed(bytes);
      return `Moved ${targets.length} item(s) to the trash, freeing about ${total}.`;
    },
  });

  const uninstallApp = betaZodTool({
    name: "uninstall_app",
    description:
      "Uninstall an app by its id from list_installed_apps. The human has to approve. On Windows this opens the app's own uninstaller; on Linux it removes flatpaks/snaps.",
    inputSchema: z.object({
      id: z.string(),
      reason: z.string().describe("Why this app looks safe to remove."),
    }),
    run: async ({ id, reason }) => {
      appCache ??= await listApps();
      const app = appCache.find((a) => a.id === id);
      if (!app) throw new Error(`No installed app with id ${id}. Call list_installed_apps first.`);
      const ok = await confirm({
        kind: "uninstall",
        title: `Uninstall ${app.name}?`,
        reason,
        items: [{ label: app.id, size: app.size }],
        total: app.size,
      });
      if (!ok) return `The human wants to keep ${app.name}.`;

      if (process.platform === "darwin") {
        const bytes = await sizeOf(app.id);
        await trash([app.id]);
        onFreed(bytes);
        return `${app.name} moved to the trash. Its leftovers usually live in ~/Library/Application Support, ~/Library/Caches and ~/Library/Preferences.`;
      }
      if (process.platform === "win32") {
        const { stdout } = await run("reg", ["query", app.id, "/v", "UninstallString"]);
        const cmd = stdout.match(/UninstallString\s+REG_\w+\s+(.*)/)?.[1]?.trim();
        if (!cmd) throw new Error(`${app.name} has no uninstaller registered.`);
        await launch(cmd);
        return `Started ${app.name}'s own uninstaller. The human finishes it in that window.`;
      }
      const [kind, name] = id.split(":");
      if (kind === "flatpak") await run("flatpak", ["uninstall", "-y", "--noninteractive", name]);
      else await run("snap", ["remove", name]);
      return `${app.name} removed.`;
    },
  });

  return [systemInfo, listDirectory, findLargeFiles, listInstalledApps, moveToTrash, uninstallApp];
}

module.exports = { makeTools };
