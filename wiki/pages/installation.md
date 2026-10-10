# Install Studio

Vibe Studio runs on Windows 10 or 11. The portable download is the quickest way to start. It needs no installer, Node.js or npm.

## What you need

| | Needed for | Notes |
| --- | --- | --- |
| **Windows 10 or 11** | Everything | Saved keys are protected by Windows. Other systems are untested. |
| **An AI connection** | Chat and planning | A coding CLI sign-in, an API key or a local model. See [Connect an AI](connections.md). |
| **A coding CLI** | Building | Claude Code, Codex, Grok, Antigravity or OpenCode, signed in. Without one, Studio still chats, plans and shows the model catalog, but no build can start. |
| **Git** | Recommended | Studio uses Git to check results that claim a commit and to show project history. [Your PCs](your-pcs.md) needs it. |
| **Node.js 24** | Source installs only | Runs Studio from source. Python 3 is also needed, but only for the test suite. |

## Portable build

1. Open the [0.4.4 release](https://github.com/nateecho32-stack/mefi-studio/releases/tag/v0.4.4), or the [download page](../../download.html), and download the Windows `win32-x64` zip.
2. Right-click the zip and choose **Extract All…**. Put the whole folder somewhere you can keep it: Studio saves your tasks, plans and conversations inside it.
3. Open `Mefi Studio AI+.exe` inside the extracted folder. Keep its supporting files beside it. Opening it from inside the zip won't work.
4. Choose a project folder, then select **Open studio** or **Open and start agents**.

The executable keeps its older name. That's expected: the public name is Vibe Studio.

The build is unsigned, so Windows SmartScreen may ask before it opens. Check the download first (below), then choose **More info › Run anyway**.

### Check the download

The release includes a `.sha256` file. From the folder that holds both files, run:

```powershell
Get-FileHash ".\Mefi-Studio-AI+-v0.4.4-win32-x64.zip" -Algorithm SHA256
Get-Content ".\Mefi-Studio-AI+-v0.4.4-win32-x64.zip.sha256"
```

The two hashes should match.

## First launch

The launch screen asks which project to open. Pick one or choose **Open another folder…**, then:

- **Open studio** opens the project with the agents off. Press **Start agents** when you're ready.
- **Open and start agents** opens the project and starts them.

**Help › Start here** then walks you through setup, sign-in and a connection check. Continue with [Your first project](getting-started.md).

> <span class="status next">Coming in 0.5</span> A new install starts with a three-step welcome: pick the AI that builds for you, choose a project, and say what Studio should make first. The [setup helper](setup-helper.md) opens once after you update, and waits in Help and Search. The launch screen has one **Open** button with a **Start agents** switch, and **Open a folder…**, **Start a new app** and **Get from GitHub** at its foot. **Settings › General › When Studio opens** decides whether agents start: **Resume what I had** (the default), **Start agents** or **Keep agents off**.

## Connect an AI account

Studio can use a Claude Code, Codex, Grok, Antigravity or OpenCode sign-in, an API key or a local model. [Connect an AI](connections.md) explains each one.

In 0.4.4 the guided sign-in window may close as soon as it opens. If that happens, [sign in from a terminal](connections.md#sign-in-from-a-terminal), then come back to Studio and check the connection.

You can browse the model catalog and write plans by hand before you connect anything. Building needs a signed-in coding CLI.

## Where your data lives

| What | Where |
| --- | --- |
| Tasks, ideas, plans and conversations | Portable build: `resources\app\data` inside the Studio folder. Source install: the checkout's `data` folder. |
| Settings, saved keys, the project list, the Discord link and where you left off | `%APPDATA%\Mefi's Studio AI+` |

A portable build and a source install on the same Windows account share `%APPDATA%\Mefi's Studio AI+`. So only one of them runs at a time: opening the other one brings the running one forward.

Saved keys are encrypted for the Windows account that saved them. On another PC, sign in or enter your keys again. Back up both places before you move or replace an installation.

## Updates

Open **Settings › System › Updates** and press **Check GitHub** to look for a newer release. In 0.4.4 the in-app update can't finish installing, so move to 0.5 [by hand](updates.md#update-from-044-by-hand) when it comes out. [Update Studio](updates.md) has the details.

## From source

Install Node.js 24 or newer and Git, then run:

```powershell
git clone https://github.com/nateecho32-stack/mefi-studio.git
cd mefi-studio
npm ci
npm run build-booklet
npm start
```

Run these commands from the repository root. If Studio says that `ELECTRON_RUN_AS_NODE` is set, clear that variable in your shell and try again.

A source install runs what's on `main`. It already has the changes marked <span class="status next">Coming in 0.5</span>, and it changes often. On `main`, `npm ci` downloads Electron for you and stops if your Node.js is older than 24.

`Run Mefi's Studio AI+.cmd` starts the portable build in `dist/` when there is one, otherwise the source install. `npm run start:web` opens a browser preview at <http://localhost:4173>. The preview can't launch coding workers.

## Building or customizing Studio

[Contributing](contributing.md) covers tests and packaging. Developer settings, including `MEFI_STUDIO_REPO` for another project and `MEFI_STUDIO_GAME_ROOT` for the optional game, are listed in [.env.example](https://github.com/nateecho32-stack/mefi-studio/blob/main/.env.example). Set those variables in your shell: Studio doesn't load that file by itself.
