// Builds a portable copy of bytevac: unzip it anywhere and run, no installer and no Node.js needed.
// usage: npm run pack -- [win32|darwin|linux] [x64|arm64]   (defaults: this machine)

const fs = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const extract = require("extract-zip");

const ROOT = path.resolve(__dirname, "..");
const [platform = process.platform, arch = process.arch] = process.argv.slice(2);

(async () => {
  const { downloadArtifact } = await import("@electron/get");
  const { version } = require("electron/package.json");

  console.log(`Fetching Electron ${version} for ${platform}-${arch}…`);
  const zip = await downloadArtifact({ version, platform, arch, artifactName: "electron" });

  const out = path.join(ROOT, "dist", `bytevac-${platform}-${arch}`);
  await fs.rm(out, { recursive: true, force: true });
  await extract(zip, { dir: out });

  const mac = platform === "darwin";
  if (mac) await fs.rename(path.join(out, "Electron.app"), path.join(out, "bytevac.app"));
  const resources = mac ? path.join(out, "bytevac.app", "Contents", "Resources") : path.join(out, "resources");
  await fs.rm(path.join(resources, "default_app.asar"), { force: true });

  // The app itself: our sources plus only the production dependencies.
  const app = path.join(resources, "app");
  for (const f of ["package.json", "LICENSE", "src"]) await fs.cp(path.join(ROOT, f), path.join(app, f), { recursive: true });
  const prod = execFileSync("npm", ["ls", "--omit=dev", "--all", "--parseable"], { cwd: ROOT, encoding: "utf8", shell: process.platform === "win32" })
    .split(/\r?\n/)
    .filter((p) => p && path.resolve(p) !== ROOT);
  for (const dir of prod) await fs.cp(dir, path.join(app, path.relative(ROOT, dir)), { recursive: true });

  // Slim it down: type declarations, source maps and TS sources are dead weight at runtime,
  // and Chromium only needs the UI languages we expect.
  const junk = /\.(map|d\.ts|d\.mts|d\.cts|md)$|^CHANGELOG/i;
  for (const entry of await fs.readdir(path.join(app, "node_modules"), { recursive: true, withFileTypes: true })) {
    const full = path.join(entry.parentPath, entry.name);
    if (entry.isFile() && junk.test(entry.name) && !/^LICENSE/i.test(entry.name)) await fs.rm(full);
  }
  await fs.rm(path.join(app, "node_modules", "@anthropic-ai", "sdk", "src"), { recursive: true, force: true });
  if (!mac) {
    const locales = path.join(out, "locales");
    for (const pak of await fs.readdir(locales)) if (!["en-US.pak", "ru.pak"].includes(pak)) await fs.rm(path.join(locales, pak));
  }

  if (platform === "win32") await fs.rename(path.join(out, "electron.exe"), path.join(out, "bytevac.exe"));
  if (platform === "linux") await fs.rename(path.join(out, "electron"), path.join(out, "bytevac"));
  // Adding our files breaks Electron's signature, and Apple Silicon won't open an unsigned app. Ad-hoc sign it again.
  if (mac && process.platform === "darwin") execFileSync("codesign", ["--force", "--deep", "--sign", "-", path.join(out, "bytevac.app")]);
  if (mac && process.platform !== "darwin") console.warn("Note: pack macOS builds on a Mac so they can be signed.");

  console.log(`Done: ${path.relative(ROOT, out)}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
