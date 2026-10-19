# 🤖🧹 bytevac

> A robot vacuum for your computer. It roams your disk, sniffs out junk, and asks before it sucks anything up.

bytevac is a tiny desktop app with an AI inside. You hit **Start**, and it wanders around your
home folder looking for the stuff that quietly eats your disk: caches, temp files, ancient
installers, 4 GB videos you downloaded in 2021, and apps you forgot you had. Then it tells you
what it found, biggest wins first, and offers to clean it up.

It's basically an uninstaller and a disk cleaner that can actually *think* about what it's looking at.

```
🤖 Checking out the place
📂 Peeking into ~/Library/Caches
🐘 Hunting big files in ~/Downloads
📦 Looking at installed apps

Found ~23 GB of crumbs:
  • 9.8 GB  Xcode DerivedData (rebuilds itself, safe to toss)
  • 6.1 GB  ~/Downloads/*.dmg installers from 2023
  • 4.2 GB  browser & app caches
  • 2.9 GB  "Some Game" — not opened in 14 months

Want me to vacuum the first three?
```

## 🛡️ It won't eat your homework

- **Nothing happens without you.** Every trash or uninstall pops up a native dialog listing exactly what goes and why. "Keep it" is the default button.
- **Trash, not delete.** Files go to the system Trash / Recycle Bin, so you can always fish them back out.
- **Fenced in.** It can only look inside your home folder, the temp folder, and (on macOS) `/Applications`. Symlinks that point outside are blocked.
- **Your stuff stays yours.** It won't trash your home, Desktop, Documents, Downloads, Pictures and friends as a whole, and it's told never to call personal files junk on its own.

## 🚀 Run it

You need [Node.js](https://nodejs.org) 20+ and an [Anthropic API key](https://console.anthropic.com/).

```bash
git clone https://github.com/MarkArtemyev/bytevac.git
cd bytevac
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # Windows PowerShell: $env:ANTHROPIC_API_KEY="sk-ant-..."
npm start
```

Hit **Start** for a full sweep, or type something like *"only look at my Downloads"* or
*"what apps haven't I used in a year?"*.

## 🧠 How it works

It's a thin [Electron](https://www.electronjs.org/) wrapper around Claude using the
[Anthropic SDK](https://github.com/anthropics/anthropic-sdk-typescript) tool runner.
The model gets six tools and drives the loop itself:

| Tool | What it does |
|---|---|
| `system_info` | OS, free space, the usual junk hideouts for this platform |
| `list_directory` | What's in a folder, biggest first |
| `find_large_files` | Big (and optionally old) files under a folder |
| `list_installed_apps` | `/Applications` on macOS, the registry on Windows, flatpak/snap on Linux |
| `move_to_trash` | Moves files to the Trash, after you say yes |
| `uninstall_app` | Trashes the `.app` (macOS), opens the app's own uninstaller (Windows), or removes the flatpak/snap (Linux), after you say yes |

```
src/
  main.js      Electron window + native confirm dialogs
  agent.js     the brain: Claude + tool loop + conversation memory
  tools.js     everything the robot is allowed to do
  index.html   the floor the robot drives around on
  renderer.js  chat log + buttons
```

`npm run check` type-checks the whole thing.

## 🗺️ Ideas for later

- [ ] Leftover hunting after uninstall (`~/Library/Application Support`, `%APPDATA%`)
- [ ] Duplicate file finder
- [ ] "Dust report" history: how much bytevac has vacuumed over time
- [ ] Packaged builds (`.dmg`, `.exe`, AppImage)

## ⚠️ Disclaimer

bytevac asks before every cleanup, but you're the one clicking **Do it**. Read the dialog.
No warranty, no refunds, no hard feelings.

## 📜 License

[MIT](LICENSE)
