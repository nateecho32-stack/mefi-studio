# Installation

Studio ships as a portable Windows folder and also runs straight from a source checkout. The two keep separate project stores, so pick one for day-to-day use.

## Requirements

| You need | For | Notes |
| --- | --- | --- |
| **Windows 10 or 11** | Everything | Saved keys are protected by the Windows keystore (DPAPI). Other platforms are untested. |
| **A builder CLI** (optional) | Building tasks | `opencode` is preferred; `claude`, `codex`, `grok` and `agy` (Antigravity) are detected. Without one Studio still plans, chats and browses the catalog, but no build can start. |
| **An API key or local model** (optional) | The companion | z.ai, OpenCode Go, a CLI login, LM Studio or any OpenAI-compatible endpoint. |
| **Node 24 and npm** | Source install only | `npm ci` downloads Electron once, about 110 MB. The portable build needs neither. |
| **Git** | Cloning only | |
| **Python 3** | `npm test` only | Must be on PATH as `python`. |
| **`gh`** (optional) | Private release updates | A signed-in GitHub CLI lets Studio reuse its token. |

## Portable build

1. Download the `win32-x64` zip from the [latest release](https://github.com/nateecho32-stack/mefi-studio/releases/latest), and the `.sha256` file beside it.
2. Check the digest in PowerShell. The two hashes must match exactly:

   ```powershell
   Get-FileHash ".\Mefi-Studio-AI+-v0.2.0-win32-x64.zip" -Algorithm SHA256
   Get-Content ".\Mefi-Studio-AI+-v0.2.0-win32-x64.zip.sha256"
   ```

3. Extract the **entire** `Mefi Studio AI+` folder, then open `Mefi Studio AI+.exe` from it. Opening the exe from inside the zip does not work, and the app keeps its own data next to the executable.
4. The build is not code-signed, so SmartScreen may show "Windows protected your PC" once. After checking the digest, choose **More info → Run anyway**.
5. The launch screen asks for a project folder first; nothing is read or built until you choose.

A downloaded release starts with the public model catalog only. It contains none of the maintainer's projects, conversations or credentials.

## From source

```powershell
git clone https://github.com/nateecho32-stack/mefi-studio.git
cd mefi-studio
npm ci                   # once; downloads Electron
npm run build-booklet    # bundles renderer/ into the committed renderer/booklet.html
npm start
```

- `npm start` needs a normal shell. If `ELECTRON_RUN_AS_NODE` is set, as some agent harnesses do, Studio refuses to start and prints the fix.
- `Run Mefi's Studio AI+.cmd` at the repository root starts the portable build when one exists in `dist/`, otherwise the source install.
- `npm run start:web` serves a browser-only preview on <http://localhost:4173>. It cannot launch workers, and it serves plain HTTP, so never expose that port beyond your machine.

## Checks and tests

```powershell
npm run test:fast        # Node suites without the Electron fixtures, about 20 s
npm run check            # targets, spec collisions, CSS cascade gates, syntax
npm run lint             # eslint, check-only
npm test                 # the gate: Node suites + Electron fixtures + Python contracts
npm run audit            # renderer/template contract audit
```

`npm test` needs Python on PATH and a real desktop: two fixtures drive Electron windows and are timing-sensitive. See [Contributing](contributing.md).

## Packaging your own build

Run the three gates, then:

```powershell
npm run package:release   # fresh folder under dist/releases/ with only the two public catalogs
npm run package           # refresh dist/Mefi Studio AI+/ and keep its local data
```

Neither seeds a build with your settings, tasks, conversations, credentials or caches, and neither uploads anything. Publishing is covered in [Live update and release updates](updates.md#publishing-a-release).

## Environment variables

Nothing here is required. Studio does **not** read a `.env` file by itself: set variables in your shell, for example `$env:MEFI_STUDIO_REPO = "C:\path"` in PowerShell. The repository's [.env.example](https://github.com/nateecho32-stack/mefi-studio/blob/main/.env.example) lists them all.

| Variable | Effect |
| --- | --- |
| `MEFI_STUDIO_REPO` | Open this repository directly instead of the project chooser (headless or developer launches). |
| `MEFI_STUDIO_GAME_ROOT` | The optional [Ruins Runner](ruins-runner.md) checkout. A sibling `2d Trippy Hell` folder is found by itself. |
| `MEFI_STUDIO_BOARD_DB` | Keep the board's optional SQLite store outside a synced folder, where OneDrive locks can bite. |
| `MEFI_STUDIO_PORT` | Port for `npm run start:web`. Default 4173. |
| `MEFI_STUDIO_*_KEY` | Headless key setup, each paired with a `--set-*-key` flag. See [Connections and providers](connections.md#headless-key-setup). |
| `MEFI_JEV_ROUTE` | `vercel`, `typesafe`, `zen` or `openrouter`: where Jev classifier calls go. |
| `MEFI_STUDIO_GITHUB_TOKEN` | Read-only token for release updates from a private repository. |
| `MEFI_STUDIO_UPDATE_REPO` | Override the `owner/repo` the updater polls. |
| `MEFI_STUDIO_WORKTREE_RUNS` | `1` runs each builder in its own git worktree. See [The assistant and the agent loop](assistant.md#per-session-worktrees). |
| `MEFI_STUDIO_WORKTREE_NPM_CI` | `0` skips the `npm ci` fallback inside a worktree. |
| `MEFI_STUDIO_MEMORY_WARN_OVERRIDE` | Raise the machine gauge's memory-warning threshold, in MB, on a big machine. |

## What not to copy between machines

Settings, keys, tasks, conversations, captures and databases are local state and do not travel. Only `data/curated.json` and `data/models.json` belong to the repository.

Saved keys are encrypted for the Windows account that saved them and cannot be decrypted anywhere else. In source they sit in `%APPDATA%\Mefi's Studio AI+\auth.json`; in v0.2.0 they sit inside `settings.json` in the same folder. Never copy either file to another machine: enter the keys again there. Back up an installation's local data before moving it.
