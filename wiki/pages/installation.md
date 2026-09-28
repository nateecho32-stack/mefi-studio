# Installation

Mefi Studio runs on Windows 10 or 11. The portable download is the quickest way to start; it does not need Node.js or npm.

## Portable build

1. Open the [0.4.4 release](https://github.com/nateecho32-stack/mefi-studio/releases/tag/v0.4.4) and download the Windows `win32-x64` zip.
2. Extract the entire folder to a location you can keep.
3. Open `Mefi Studio AI+.exe` inside the extracted folder. Keep its supporting files beside it.
4. Choose a project folder, then select **Open studio** or **Open and start agents**.

The executable retains its existing name. Opening it from inside the zip will not work. Your portable copy keeps its own local data beside the executable, separate from a source installation.

The release includes a `.sha256` file if you want to verify the download. From the folder containing both files, run:

```powershell
Get-FileHash ".\Mefi-Studio-AI+-v0.4.4-win32-x64.zip" -Algorithm SHA256
Get-Content ".\Mefi-Studio-AI+-v0.4.4-win32-x64.zip.sha256"
```

Compare the two hashes. The build is unsigned, so Windows SmartScreen may ask you to confirm before opening it. After checking the download, **More info → Run anyway** opens it.

Continue with [Your first project](getting-started.md).

## Connect an AI account

Studio can use a Codex, Claude Code, Grok or Antigravity sign-in for conversation, planning and coding. **Help › Start here** guides you through installation, sign-in and a connection check. You can also use OpenCode, provider keys or a local model.

You can browse the catalog and write plans manually before connecting. Building requires a working coding CLI. See [Connections and providers](connections.md).

## From source

Install Node.js 24 or newer and Git, then run:

```powershell
git clone https://github.com/nateecho32-stack/mefi-studio.git
cd mefi-studio
npm ci
npm run build-booklet
npm start
```

Run these commands from the repository root. If Studio reports that `ELECTRON_RUN_AS_NODE` is set, clear that variable in your shell and try again.

`Run Mefi's Studio AI+.cmd` starts the portable build in `dist/` when present, otherwise the source installation. `npm run start:web` opens a browser preview at <http://localhost:4173>; the preview cannot launch coding workers.

## Updates and local data

Use **App updates** to check for a newer portable release. See [Live update and release updates](updates.md) for the update process.

Back up the installation's local data before moving it. Saved credentials are encrypted for the Windows account that entered them; sign in or enter keys again on another PC. Source and portable installations keep separate stores.

## Building or customizing Studio

[Contributing](contributing.md) covers tests and packaging. Developer configuration, including `MEFI_STUDIO_REPO` for another project and `MEFI_STUDIO_GAME_ROOT` for the optional game, is listed in [.env.example](https://github.com/nateecho32-stack/mefi-studio/blob/main/.env.example). Set those variables in your shell; Studio does not load that file automatically.
