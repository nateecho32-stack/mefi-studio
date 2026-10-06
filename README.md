<p align="center">
  <img src="assets/icon-256.png" width="112" height="112" alt="Mefi Studio icon">
</p>

<h1 align="center">Mefi Studio</h1>

<p align="center">
  <strong>Bring an idea. Find your people. Make it together.</strong><br>
  A free, open-source Windows app for building your ideas with coding agents, in good company.
</p>

<p align="center">
  <a href="https://github.com/nateecho32-stack/mefi-studio/releases/tag/v0.5.0"><img src="https://img.shields.io/badge/download-v0.5.0-D8AE65?style=flat-square" alt="Download 0.5.0"></a>
  <a href="https://nateecho32-stack.github.io/mefi-studio/roadmap.html#now"><img src="https://img.shields.io/badge/next-0.5.x-8B7CF6?style=flat-square" alt="Next: 0.5.x"></a>
  <a href="docs/rust-migration.md"><img src="https://img.shields.io/badge/moving%20to-Rust%20%C2%B7%20Tauri%202-CE422B?style=flat-square&logo=rust&logoColor=white" alt="Moving to Rust with Tauri 2"></a>
  <a href="https://github.com/nateecho32-stack/mefi-studio/actions/workflows/ci.yml"><img src="https://github.com/nateecho32-stack/mefi-studio/actions/workflows/ci.yml/badge.svg?branch=main&style=flat-square" alt="Studio checks"></a>
  <br>
  <img src="https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078D4?style=flat-square&logo=windows&logoColor=white" alt="Platform: Windows 10 and 11">
  <img src="https://img.shields.io/badge/node-24-5FA04E?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node 24">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/local--first-no%20telemetry-2EA043?style=flat-square" alt="Local-first, no telemetry">
</p>

<p align="center">
  <a href="https://github.com/nateecho32-stack/mefi-studio/releases/tag/v0.5.0"><strong>Download 0.5.0</strong></a> ·
  <a href="https://nateecho32-stack.github.io/mefi-studio/">Website</a> ·
  <a href="https://nateecho32-stack.github.io/mefi-studio/roadmap.html">Roadmap</a> ·
  <a href="https://nateecho32-stack.github.io/mefi-studio/wiki/">Guide</a> ·
  <a href="https://discord.gg/xgfKc5pVxG">Discord</a>
</p>

<p align="center">
  <img src="docs/images/0.5/build.webp" width="960" alt="The 0.5 layout in Studio mode: the project's sessions grouped as Needs you, Running, Review, Queued and Done on the left, Today in the middle with the message box, what needs you and what is running, and the project's repository, team and live activity on the right">
  <br>
  <sub>Studio 0.5 in Studio mode, in the Chrome theme, with sample data.</sub>
</p>

Pick a project folder, say what you want, and coding agents build it while you watch. Every change waits for you to accept or revert it, and the [Void Engine Discord](https://discord.gg/xgfKc5pVxG) is there when you want company, feedback or a hand.

## Where Studio is now

| | |
| --- | --- |
| **Download** | **0.5.0**, released 6 October 2026. [Release notes](docs/releases/0.5.0.md) |
| **Next** | **0.5.x** finishes what 0.5.0 left for later: the [0.5 scope](docs/release-scope-0.5.0.md) lists it, and the [roadmap](https://nateecho32-stack.github.io/mefi-studio/roadmap.html) has the rest. |
| **Platform** | **Studio is moving from Electron to Rust** with Tauri 2, in three stages. The interface, your settings and your saved keys stay the same, and the Electron build keeps shipping until the switch. [How it works](docs/rust-migration.md) |

The [public roadmap](https://nateecho32-stack.github.io/mefi-studio/roadmap.html) lists what is done, what is being worked on and what is planned. The [changelog](CHANGELOG.md) lists every change since 0.5.0 under Unreleased.

## What it does

- **One folder at a time.** Pick a project folder and Studio scans it locally. Tasks, conversations, plans and references stay with that project.
- **Chat or create work.** Talk an idea through, or put work on the board with acceptance checks. Big requests become a short plan of steps.
- **Agents do the work, visibly.** Coding workers (OpenCode, Claude Code, Codex, Grok or Antigravity CLIs) build tasks while an always-on service loop organises, audits and briefs. You see every run, step and question as it happens.
- **"Done" means verified.** A finished attempt waits in *Review* with its evidence until checks pass or you confirm it.
- **Your call, every time.** Permission modes from *Always ask* to *Auto*, questions that wait in one place, and an *Undo* for automatic choices.
- **Works with the tools you already use.** Claude Code, Codex, Cursor or a script on the same PC can check on Studio, message Mefi and hand it tasks (they wait for your OK), through an MCP server and a local API that are off until you turn them on. **Copy setup prompt** hands those helpers everything they need to walk you through setup.
- **Local storage, your choice of AI.** Project records and settings stay on your machine, keys are encrypted with the OS keystore, and Studio has no usage telemetry or required hosted account. Connected AI providers and coding tools may receive prompts and project context.

## New in 0.5

0.5 puts two modes in one frame: **Social** (once called Vibe), for vibing with friends and keeping a light eye on agents, and **Studio** (once called Build), for in-depth building. Your sessions on the left, the work in the middle, an inspector beside it, tabs on top and a status bar below; Ctrl+M switches modes. A new install starts easier: **Start a new app** on the launch screen, then a three-step welcome: **Pick the AI that builds for you**, **Choose a project** and **What should Studio make first?**

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/images/0.5/today.webp" alt="Social in the 0.5 layout: What's next for Notes app? with a box to build or talk it over, and a board of Needs you, Running, Review and Done cards">
      <p><strong>Today.</strong> Social's home: one box to build or ask, and a board of what needs you, what runs, what to review and what is done.</p>
    </td>
    <td width="50%" valign="top">
      <img src="docs/images/0.5/inbox.webp" alt="The Inbox over Social's Today: a failed check with Try a different approach, a permission request with Deny recommended, and a question with Mefi's suggestion and numbered options">
      <p><strong>One Inbox.</strong> Every question, approval and failed check that waits on you, with a suggested answer.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/images/0.5/changes.webp" alt="A session in review: the thread with an attached picture and Mefi's answer, and four changed files with Accept changes, Revert attempt and Revert per file in the inspector">
      <p><strong>Changes you can take back.</strong> See the files a worker changed, then accept them or revert one file or the whole attempt.</p>
    </td>
    <td width="50%" valign="top">
      <img src="docs/images/0.5/size.webp" alt="Size and density: sliders for interface scale and text size, density and detail choices, and a live miniature of the window beside them">
      <p><strong>Size and density.</strong> Interface scale, text size, density and detail, with a live miniature before you apply.</p>
    </td>
  </tr>
</table>

Also in 0.5: **Chrome**, a new matte black and brushed-metal theme with an iridescent finish (silver, ice blue, lilac and aqua on its edges and highlights) that new installs open in (a theme you already picked stays), tabs you add and pin, Work › Worktrees, Windows notifications and quiet hours, Report a problem, What's new after an update, pictures on a message, the `@ # /` picker, Skills and rules for agents, and The Studio Daily. The [0.5 scope](docs/release-scope-0.5.0.md) has the full list and what moves to 0.5.x.

## Moving to Rust

Started 3 October 2026. The UI stays HTML and JavaScript in WebView2; Rust takes the host and then the engine, one part at a time, and the app keeps working at every step.

| Stage | What it means | Status |
| --- | --- | --- |
| **1. The Rust host** | Rust runs the window, tray, dialogs, notifications, saved keys and the page's bridge, with today's engine beside it. | Built on `main`: `npm run host` runs it from source |
| **2. The engine moves into Rust** | Each part moves whole and must give the same answers as the JavaScript it replaces; parity tests run both. Nine parts so far: the session store, sync and worktrees, the file picker's search, the Git chip's actions and state, Skills, pictures, Revert, and settings and keys. The usage ledger's repeat reads are already about nine times faster. | In progress |
| **3. One Rust program** | A release carries only the Rust host, with no Node runtime beside it. One bridge release carries today's installs across. | Planned |

Settings, saved keys and projects stay where they are (`%APPDATA%\Mefi's Studio AI+`). Building the host needs Rust stable (MSVC) and the Visual Studio 2022 C++ build tools; [docs/rust-migration.md](docs/rust-migration.md) has the commands, the parity table and the rules.

## Get started

### Download (Windows)

1. Download the zip from the [latest release](https://github.com/nateecho32-stack/mefi-studio/releases/tag/v0.5.0).
2. Right-click it, choose **Extract All**, keep the folder together, and open `Mefi Studio AI+.exe`.
3. The build is not code-signed yet, so Windows SmartScreen may ask the first time: **More info**, then **Run anyway**.

The portable build keeps its tasks, ideas, plans and conversations in its own `resources\app\data` folder. Settings, saved keys, the project list, the Discord link and resume state live in `%APPDATA%\Mefi's Studio AI+`, shared with a source install on the same Windows account, so only one of the two runs at a time: opening the other brings the running one forward.

### Newest build from main (beta)

Every green push to `main` also makes a ready-to-run beta build, kept on GitHub for 14 days. No Node, Git or commands needed:

1. Sign in to GitHub, open [Actions › Studio checks](https://github.com/nateecho32-stack/mefi-studio/actions/workflows/ci.yml?query=branch%3Amain), pick the newest green run on `main` and download **mefi-studio-development-win32-x64** under Artifacts.
2. Unzip it, unzip the `Mefi-Studio-AI+-v…-win32-x64.zip` inside it, and open `Mefi Studio AI+.exe`.
3. To stay on the newest build, turn on **Settings › System › Updates › Development / beta**. Studio then installs each new build of `main` by itself while no work is running. It needs a GitHub sign-in on that PC; **Set up this PC** installs the GitHub CLI for it.

Beta builds have not been through a release's checks: back up your work first.

### Updating from 0.4.4

An installed 0.4.4 cannot update itself. Its update helper never runs, so the **Update** button downloads the new build, Studio quits and nothing is installed. 0.5 carries the fix, so in-app updates work from 0.5 onward. Move a portable 0.4.4 to 0.5 by hand, once:

1. Close Studio. Opening a second copy while it runs only brings the running one forward.
2. Download the Windows zip from the [releases page](https://github.com/nateecho32-stack/mefi-studio/releases) and extract it to a **new** folder.
3. Copy the old folder's `resources\app\data` into the new folder's `resources\app`. It holds your tasks, ideas, plans and conversations. The release brings its own `curated.json` and `models.json`; keep the new ones if Windows asks.
4. Open `Mefi Studio AI+.exe` from the new folder.

Settings, saved keys and the project list live in `%APPDATA%\Mefi's Studio AI+`, so they carry over on their own. Keep the old folder until you have seen your work in the new one.

### From source

```powershell
git clone https://github.com/nateecho32-stack/mefi-studio.git
cd mefi-studio
npm ci                   # once; downloads Electron
npm run build-booklet    # bundles renderer/ into the committed renderer/booklet.html
npm start
```

- `npm start` needs a normal shell. If `ELECTRON_RUN_AS_NODE` is set (some agent harnesses set it), Studio refuses to start and prints the fix.
- `Run Mefi's Studio AI+.cmd` starts the portable build when one exists in `dist/`, otherwise the source install.
- `npm run host` runs the same app on the Rust host instead (see [Moving to Rust](#moving-to-rust)).
- `npm run start:web` serves a browser-only preview on <http://localhost:4173>; it cannot launch workers.

| | Needed for | Notes |
| --- | --- | --- |
| **Windows 10/11** | Everything | Keys are protected by the Windows keystore (DPAPI). Other platforms are untested. |
| **Node 24 + npm** | Running from source | `npm ci` downloads Electron once (about 110 MB), and stops at once on an older Node. The portable build needs neither. |
| **Git** | Cloning; recommended at runtime | Studio reads the open project through git to verify a result that claims a commit, warn agents about staged or uncommitted work and add history to the project map; Friends › Your PCs and worktree runs need it. Without git those checks are skipped or read as unknown. |
| **Python 3** | `npm test` only | Found as `python`, `py -3` or `python3`; the `py` launcher that python.org's installer adds by default is enough. |
| **A builder CLI** (optional) | Building tasks | `opencode` is preferred; `claude`, `codex`, `grok` and `agy` are detected. Without one Studio still plans, chats and browses the catalog, but no build can start. |
| **An API key or local model** (optional) | The companion | z.ai, OpenCode Go or Zen, OpenRouter, a CLI login, LM Studio or any OpenAI-compatible endpoint. |

### First launch

1. **Start a new app**, or **Open a folder…** if you already have a project. Nothing runs before you choose. Later launches list your projects with **Open** and a **Start agents** switch; agents stay off unless you turn it on. If a crash or a restart interrupted work in the last ten minutes, Studio reopens that folder and restarts the agents that were running.
2. **Pick the AI that builds for you.** A short welcome shows the coding tools on this PC and the account each one uses: Claude Code (your Claude subscription), Codex (your ChatGPT plan), Grok, Antigravity (your Google account), or OpenCode's free models. Sign in, come back to Studio, and press **Continue**: Studio uses that tool for chatting, planning and building. An API key or a local model (LM Studio, Ollama) works too, under **Other ways** in the welcome or later in **Team › Providers**. [Guided CLI setup](docs/cli-setup.md) covers installing and account limits.
3. **Choose a project**, say **what Studio should make first** and press **Build it**.
4. **Watch it, then check it.** The task runs on Today and the Map. When it finishes, look at what changed, then **Approve and finish**, or revert one file or the whole attempt.

[GETTING_STARTED.md](GETTING_STARTED.md) walks through 0.5 (on `main` and in the beta builds) step by step, in plain words: your first ten minutes, where things are, and what every task state means.

## A short tour of 0.5

<details>
<summary>Social and Studio, Today, the Map, Team, Friends, Search, the Inbox, Settings and Help.</summary>

- **Social** opens on **Today**: one box to describe what you want (**Talk it over** or **Build it**), then what needs you, what runs, what to review and what is done. Its menu has Today, Friends, the Map, Tasks, Plans, Ideas, Team and Search, with Settings and Help at its foot.
- **Studio** lists every task as a session (Needs you, Running, Review, Queued, Done). The session you pick fills the middle with its thread, and the inspector beside it shows its Plan, Changes, Checks, Preview and Agent. Its menu has **Work**, **Map**, **Team** and **Friends**.
- **The Map** (`D`) draws your agents and tasks as a live tree, with **Fleet** and **Pipelines** a click away.
- **Team** holds who builds and with which AI (**Providers**, **Seats and models**), what they may decide alone (**Permissions**), and their **Rules**, **Skills** and **Connectors**.
- **Friends** has The Lobby, Rooms, Your PCs, the Playground, the Project hub and Events.
- **Search** (`Ctrl K`) finds any page, setting, task or action. The **Inbox** (`Ctrl J`) holds every question and approval. **Settings** (`Ctrl ,`) has your name and startup, notifications, the look (Appearance, Size and density, Map look), sound, updates and Other apps. **Help** has Start here, the Setup guide, Shortcuts (`?`), What's new and Report a problem.

</details>

The full feature walkthrough, in Studio's own vocabulary with a glossary, is in [docs/architecture.md](docs/architecture.md).

## Keys and privacy

- Keys are entered once in Team › Providers and stored encrypted in the OS keystore; only "saved / not saved" reaches the UI. Headless setup, from a source checkout in PowerShell: `$env:MEFI_STUDIO_KEY = "<key>"; npx electron . --set-key`, then `Remove-Item Env:MEFI_STUDIO_KEY` (while it is set it overrides the saved key). [.env.example](.env.example) pairs every `--set-*-key` flag with its variable.
- Git tracks only `data/curated.json` and `data/models.json`. Tasks, conversations, settings, databases and captures stay local and are never packaged.
- Agents run real commands in the project folder you chose. The permission mode decides what waits for you: **Always ask** holds every task for your OK (Team › Permissions, or the chip in the message box).
- Nothing contacts Discord unless you sign in with Discord in Friends. The sign-in reads your Discord id, username and membership in the Void Engine server, and nothing about your projects.
- See [SECURITY.md](SECURITY.md) for reporting.

<a id="community--perks"></a>

## Community

The [Void Engine Discord](https://discord.gg/xgfKc5pVxG) is where people share projects, ask for feedback and hang out while they build. Unfinished ideas are welcome. Come meet **Studio**, the Discord bot, and help shape what it becomes. Discord is optional: Studio works on its own, and ideas and bug reports are just as welcome on GitHub.

- **Friends**, in the menu, brings the community inside Studio once you sign in with Discord: **The Lobby** (who is online and the week's top project), **Rooms** with a chat (hangouts for up to 25, cowork rooms for up to 10, joined with a short invite code), **Listen together**, the **Playground**, the **Project hub** (share a project as a card and earn credits by playing other people's) and **Events** (a weekly Build Jam and co-work hours). It runs on the Mefi Studio relay, a free service built into Studio: the relay keeps no chat, and links in chat are never clickable.
- The personal media player, playlists and radio work without any of it.
- **Every theme and node style is free**, the Void collection included.

The [community guide](https://nateecho32-stack.github.io/mefi-studio/wiki/#/community) explains what's available. [Public site and voice direction](docs/public-site.md) records the website's location, public naming and proposed voice integration.

## Working from several PCs

GitHub is the meeting point: each PC keeps its own clone, and the project's default branch on GitHub is the one shared state. **Friends › Your PCs** shows what has not reached GitHub yet and syncs only after the project's own check passes; **Share between my PCs** moves brains, recipes, team setups and preferences through a sealed private repository; **Share with friends** makes a reviewed `.mefishare` file. `npm run sync` and `npm run worktrees` do the same from a terminal. [docs/your-pcs.md](docs/your-pcs.md) has the details.

## Tests and checks

```powershell
npm run test:fast        # Node suites without the Electron fixtures (about 20 s)
npm run check            # targets, spec collisions, CSS merge + unused, syntax, TESTRUNS
npm run lint             # eslint, check-only
npm test                 # the gate: Node suites + Electron fixtures + Python contracts
npm run audit            # renderer/template contract audit
npm run host:test        # the Rust host's unit tests (needs Rust)
```

`npm test` needs Python 3 (`python`, `py -3` or `python3`) and a real desktop: the Electron suites drive real windows and are timing-sensitive. [CONTRIBUTING.md](CONTRIBUTING.md) explains the gates and conventions; [TESTRUNS.md](TESTRUNS.md) is the maintainers' lab notebook of past runs and flake triage, not a guide.

## Documentation

| Read this | For |
| --- | --- |
| [GETTING_STARTED.md](GETTING_STARTED.md) | First launch, new-machine checklist, your first task, what each state means |
| [docs/architecture.md](docs/architecture.md) | Glossary and the detailed feature walkthrough |
| [docs/code-map.md](docs/code-map.md) | Which file does what, folder by folder, and where to look first |
| [docs/release-scope-0.5.0.md](docs/release-scope-0.5.0.md) | What 0.5 includes and what moves to 0.5.x |
| [docs/rust-migration.md](docs/rust-migration.md) | The move to Rust: stages, the bridge, the parity table and the rules |
| [docs/unified-studio.md](docs/unified-studio.md) | The menu, team presets, configuration scope and the 0.5 frame |
| [docs/agent-loop.md](docs/agent-loop.md) | How a chat message becomes a verified task, with file references |
| [docs/performance.md](docs/performance.md) | Measurements and how to reproduce them |
| [docs/your-pcs.md](docs/your-pcs.md) | Your PCs, Share between my PCs and Share with friends |
| [docs/community.md](docs/community.md) | The Void Engine Discord link: the weekly card, the login, what is stored, unlinking and the fork switch |
| [docs/remote.md](docs/remote.md) | Reach your PCs from Discord: what a DM can and cannot do, the PIN, alerts, and the hub protocol |
| [docs/studio-api.md](docs/studio-api.md) | Other apps: the setup prompt for Claude Code or Codex, and the Studio API, MCP server and command line apps on this PC use to reach Studio |
| [docs/fleet-overhaul-plan.md](docs/fleet-overhaul-plan.md) | The fleet overhaul: seats, pods, missions and Refocus, Live › Fleet, and the phase plan |
| [docs/ux-audit.md](docs/ux-audit.md) · [docs/pi-provider-storage.md](docs/pi-provider-storage.md) | The UX audit and its phased plan · how pi's coding agent stores provider config |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Check gates, test-file rules, parallel-session etiquette |
| [SECURITY.md](SECURITY.md) · [CHANGELOG.md](CHANGELOG.md) | Reporting and what changed |
| [docs/archive/](docs/archive/) | Historical audits and handoffs, kept for the reasoning |

## Optional integrations

<details>
<summary>Ruins Runner and the Discord Server Styler, two separate projects Studio can start.</summary>

### Ruins Runner

Studio can launch the author's LÖVE game from Settings › System, where its card shows only when a checkout is found (`MEFI_STUDIO_GAME_ROOT`, or a sibling `2d-Trippy-Hell` or `2d Trippy Hell` folder). A fresh clone works without it.

### Discord Server Styler

Settings › Discord Server Styler starts the separate Server Styler project and opens its local
dashboard. **Start Server Styler** installs dependencies and builds the web app
when needed, then runs the dashboard and bot. **Stop** ends a process started by
Mefi. The status line reports when the bot is online or still needs setup.

Keep Server Styler in a sibling `discord-server-styler/` checkout. Set
`MEFI_STYLER_ROOT` to its absolute path if it lives elsewhere. Studio can still
find the former `Discord Bot/` directory under the optional game checkout.
The card stays out of Settings until Studio finds one of these.
Bot credentials stay in Server Styler's ignored `.env`, outside this repository.
Create that file from `.env.example`, set `DASHBOARD_PASSWORD`, then use the
dashboard's Discord sign-in and setup wizard to connect the bot to a server.
Rebuild the portable desktop app with `npm run package` after Studio source
changes.

</details>

## Contributing

Issues and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md); the pull-request template lists the three gates. Bug reports are most useful with the version, the install kind, the selected route and builder, and the task state you saw. Feature requests go to [GitHub issues](https://github.com/nateecho32-stack/mefi-studio/issues) or the Discord.

## Code signing

Releases so far are unsigned, so Windows SmartScreen asks before the first
launch: **More info**, then **Run anyway**. Studio is moving to free code
signing from the SignPath Foundation. The policy, including what gets signed,
who approves it and what Studio sends over the network, is in
[docs/code-signing.md](docs/code-signing.md).

## License

[MIT](LICENSE) © 2026 MefiMaxi
