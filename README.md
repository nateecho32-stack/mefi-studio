<p align="center">
  <img src="assets/icon-256.png" width="120" height="120" alt="Mefi Studio icon">
</p>

<h1 align="center">Mefi Studio</h1>

<p align="center">
  <strong>Bring an idea. Find your people. Make it together.</strong>
</p>

<p align="center">
  <a href="https://github.com/nateecho32-stack/mefi-studio/releases/tag/v0.4.5"><img src="https://img.shields.io/badge/release-v0.4.5-D8AE65?style=flat-square" alt="Release 0.4.5"></a>
  <a href="https://github.com/nateecho32-stack/mefi-studio/actions/workflows/ci.yml"><img src="https://github.com/nateecho32-stack/mefi-studio/actions/workflows/ci.yml/badge.svg?branch=main&style=flat-square" alt="Studio checks"></a>
  <img src="https://img.shields.io/badge/platform-Windows-0078D4?style=flat-square&logo=windows&logoColor=white" alt="Platform: Windows">
  <img src="https://img.shields.io/badge/node-24-5FA04E?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node 24">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/local--first-no%20telemetry-2EA043?style=flat-square" alt="Local-first, no telemetry">
</p>

<p align="center">
  <img src="docs/images/workspace.png" width="900" alt="The workspace: a status strip, a conversation with the companion, and the project's work queue">
</p>

**[Download 0.4.5 for Windows](https://github.com/nateecho32-stack/mefi-studio/releases/tag/v0.4.5)** · [Watch the 40-second showreel](https://github.com/nateecho32-stack/mefi-studio/releases/download/v0.4.2/mefi-studio-v0.4.2-discord.mp4)

**[Explore Studio](https://nateecho32-stack.github.io/mefi-studio/)** · [Join our Discord](https://discord.gg/xgfKc5pVxG) · [Read the guide](https://nateecho32-stack.github.io/mefi-studio/wiki/)

Build your ideas with coding agents, share work in progress with the community, or just come hang out. Studio is a free Windows app, shaped with the people who use it.

**Quick links:** [What's new](#whats-new-in-045) · [Install](#install-and-run) · [First launch](#first-launch) · [Tour](#a-short-tour) · [Keys and privacy](#keys-and-privacy) · [Community](#community--perks) · [Docs](#documentation) · [Contributing](#contributing)

## What's new in 0.4.5

0.4.5 is the rebrand release. **Mefi Studio** is now the public name on the website, the guide, this README and the release page, with a community-first message: bring an idea, find your people, make it together. The app itself is not renamed in this release. Its window title, About card and boot screen still say "Mefi's Studio AI+", and its executable, zip and folder names (`Mefi Studio AI+`) and its settings folder (`Mefi's Studio AI+`) keep their existing names, on purpose, so every install keeps its settings and keys.

- **One Setup helper.** A single menu holds every setting that decides what the agents do: connecting an AI (subscription logins, API keys, local servers, automatic setup), team and models, routing, permissions and the machine. It opens first on a new install and once after updating. You can add more than one Claude Code or Codex login, and work moves to the next login when one reports its usage limit.
- **Agents say why they are not working.** Home, Vibe, the Command header and the chat assistant read one status that names what is holding work back and the one control that clears it. **When Studio opens** (Resume what I had, Start agents or Keep agents off) decides what the agents do at launch, and Command view no longer takes over after five quiet minutes unless you switch that on.
- **Watch Mefi think.** In Vibe, **Suggest a next step** and **Build it** show a live strip of what Mefi is reading, thinking and planning, and which model is at work. Plans opens one step at a time, the Task board is calmer, and a letter typed while a menu is open goes into that menu's box.
- **Several PCs.** **Share between my PCs** carries chosen items through a private, sealed GitHub repository, **Share with friends** saves one item to a `.mefishare` file, **Keep this PC up to date** brings in what another PC pushed within about a minute when nothing of yours is in the way, **Set up this PC** lists what a PC needs, and **Start with Windows** opens Studio in the tray when you sign in. Each PC's line in Your PCs says what its agents are doing.
- **Rooms, Playground and the Discord remote.** Friends › Rooms, the companion as a pet and a friend with a Playground, cowork claims that keep agents on several PCs off the same file, and the Discord remote (DMs that check on your PCs) are all in the app. They need a rooms hub and a linked Discord account. The built-in hub address and Mefi Studio Link app id are empty, so they do nothing until you enter both in **Settings › Community › Connection details**; see [Setting up Friends across PCs](docs/friends-setup.md).
- **Everything in reach.** **Configuration** (`Ctrl Shift ,`) is one searchable tree of every setting, with an Interface scale. Each agent's Habits, calmer and steadier menus and a finishing beat for every node style in the Agent brain are new too.
- **Fixes.** Startup no longer stalls when the window is covered or parked in the tray, an ask you answered leaves the Needs you list at once, and asks whose card is gone are cleared when the project loads.

Read the [0.4.5 release notes](docs/releases/0.4.5.md) or the full
[changelog](CHANGELOG.md). The showreel above uses sample tasks from the earlier 0.4.2 release.

### Updating from 0.4.4

An installed 0.4.4 cannot update itself. Its update helper never ran, so the **Update** button downloads about 165 MB, Studio quits and nothing is installed. 0.4.5 carries the fix, so in-app updates work from 0.4.5 onward. To move a portable 0.4.4 to 0.4.5 by hand:

1. Close Studio. Opening a second copy while it runs only brings the running one forward.
2. Download the Windows zip from the [0.4.5 release](https://github.com/nateecho32-stack/mefi-studio/releases/tag/v0.4.5) and extract it to a **new** folder.
3. Copy the old folder's `resources\app\data` into the new folder's `resources\app`. It holds your tasks, ideas, plans and conversations. The release brings its own `curated.json` and `models.json`; keep the new ones if Windows asks.
4. Open `Mefi Studio AI+.exe` from the new folder.

Settings, saved keys and the project list live in `%APPDATA%\Mefi's Studio AI+`, so they carry over on their own. Keep the old folder until you have seen your work in the new one.

## What it does

- **One folder at a time.** Pick a project folder and Studio scans it locally. Tasks, conversations, plans and references stay with that project.
- **Chat or create work.** Use *Chat* to think an idea through, or *Create task* to put work on the board with acceptance checks.
- **Agents do the work, visibly.** Coding workers (OpenCode, Claude Code, Codex, Grok or Antigravity CLIs) build tasks while an always-on service loop organises, audits and briefs. The **Command view** shows every session, task and agent as a live node tree.
- **"Done" means verified.** A finished attempt waits in *Review* with its evidence until checks pass or you confirm it.
- **Local storage, your choice of AI.** Project records and settings stay on your machine, keys are encrypted with the OS keystore, and Studio has no usage telemetry or required hosted account. Connected AI providers and coding tools may receive prompts and project context. The [Discord community](#community--perks) and optional connected room features are separate from your local projects.

## Requirements

| | Needed for | Notes |
| --- | --- | --- |
| **Windows 10/11** | Everything | Keys are protected by the Windows keystore (DPAPI). Other platforms are untested. |
| **Node 24 + npm** | Running from source | `npm ci` downloads Electron once (about 110 MB), and stops at once on an older Node. The portable build needs neither. |
| **Git** | Cloning; recommended at runtime | Studio reads the open project through git to verify a result that claims a commit, warn agents about staged or uncommitted work and add history to the project map; Friends › Your PCs and opt-in worktree runs need it. Without git those checks are skipped or read as unknown. |
| **Python 3** | `npm test` only | Found as `python`, `py -3` or `python3`; the `py` launcher that python.org's installer adds by default is enough. |
| **A builder CLI** (optional) | Building tasks | `opencode` is preferred; `claude`, `codex`, `grok` and `agy` are detected. Without one Studio still plans, chats and browses the catalog, but no build can start. |
| **An API key or local model** (optional) | The companion | z.ai, OpenCode Go or Zen, OpenRouter, a CLI login, LM Studio or any OpenAI-compatible endpoint. |

## Install and run

```powershell
git clone https://github.com/nateecho32-stack/mefi-studio.git
cd mefi-studio
npm ci                   # once; downloads Electron
npm run build-booklet    # bundles renderer/ into the committed renderer/booklet.html
npm start
```

- `npm start` needs a normal shell. If `ELECTRON_RUN_AS_NODE` is set (some agent harnesses set it), Studio refuses to start and prints the fix.
- `Run Mefi's Studio AI+.cmd` starts the portable build when one exists in `dist/`, otherwise the source install.
- **Portable build:** [download 0.4.5](https://github.com/nateecho32-stack/mefi-studio/releases/tag/v0.4.5), extract the whole folder, then open `Mefi Studio AI+.exe`. Its tasks, ideas, plans and conversations stay in its own `resources\app\data` folder. Settings, saved keys, the project list, the Discord link and resume state live in `%APPDATA%\Mefi's Studio AI+`, shared with a source install on the same Windows account, so only one of the two runs at a time: opening the other brings the running one forward. Coming from an installed 0.4.4? It cannot update itself: see [Updating from 0.4.4](#updating-from-044).
- `npm run start:web` serves a browser-only preview on <http://localhost:4173>; it cannot launch workers.

## First launch

1. **Choose a project** on the launch screen, then **Open** (agents stay off unless you turn the **Start agents** switch on). Nothing runs before you choose. If a crash or a restart interrupted work in the last ten minutes, Studio skips the question, reopens that folder and restarts the agents that were running; closing the studio yourself always brings the question back.
2. **Follow the walkthrough.** *Start here* opens on the first launch with seven short stops: scan, workspace, first map, connections, create, monitor, review. Each stop's **Walk with me** opens the real menu and highlights the control. It remembers your place. On a new install the **Setup helper** opens first; **Continue to the guided tour** starts this walkthrough, and closing the helper leaves it waiting in Start here.

   At Scan or First map, choose an existing Codex, Claude Code, Grok or Antigravity login, or **Install and sign in**. **Check connection**, then **Use for the whole studio** routes mapping, chat, planning, agents and coding through that account. Have an API key (z.ai, OpenCode Go or Zen, OpenRouter, a custom endpoint) or a local server (LM Studio, Ollama) instead? **I have an API key or a local model server** takes you to Connections and scans again when you return. OpenCode is optional. See [guided CLI setup](docs/cli-setup.md) for installation and account limits.
3. **Check the connection.** A fresh install runs **auto setup** by itself on the first launch, from the keys, CLIs and local servers already on the machine, and **Settings › Connections** says what it chose. Press **Run auto setup** again after adding a key or CLI, or configure a provider there. No key yet? The catalog, manual planning and saved work all work without one.
4. **Give one clear task** and watch it move from *Ready* to *Working* to *Review*.

[GETTING_STARTED.md](GETTING_STARTED.md) covers the same path in detail, including what every task state means and what to do next.

## A short tour

### Vibe or Build

**Vibe** puts conversation, task creation, work in progress and decisions on one
screen. Its **Needs you** drawer handles questions, build approvals and blocked
tasks. Open other tools from its dock and return to Vibe from the top of the rail.
Switch to **Build** for the full workspace described below; Studio remembers
which mode you use.

The **menu** down the left edge opens **Home**, **Work**, **Agents** and **Friends**, with section-local Back/Forward navigation for pages. Friends opens the companion's existing Friends menu; its Rooms, Your PCs and Playground links go straight to the matching card. Agents contains Overview, Setup, Live, Workflows, Models and Usage. It stays open by default in wide windows; **Keep menu open** saves your preference. **Settings**, **Search** (`Ctrl K`) and **Help** stay at its foot. Help contains Start here, Shortcuts (`?`) and Community. The project selector at the top switches projects, and `Ctrl ,` opens Settings from anywhere.

### Your workspace (`H`)

The home screen. **Studio at a glance** shows the service state with a single Pause / Resume, running workers, what needs you, what is up next, the machine gauge and today's usage. Below it: the conversation with **Chat** and **Create task**, and **Your work** (Queue, Ideas, Review, Done). Expand **Queue settings** to change Auto build or Agent mode.

### Command view (`D`)

<p align="center">
  <img src="docs/images/command.png" width="900" alt="Command view: sessions, tasks and agents as a 3D node tree, with the Live work panel on the right">
</p>

Every session, task and agent is a node. Agents orbit the assistant, fly to the task they work on, and say what they are doing in speech bubbles. The panel on the right holds **Work**, **Assistant**, **Runs** (recent builds grouped by task) and **Ask**, where agents wait for your decision with a recommended option. **Agents** in the top toolbar opens queue settings and links to full team setup.

### Start here walkthrough

<p align="center">
  <img src="docs/images/walkthrough.png" width="900" alt="The seven-stop Start here walkthrough">
</p>

### Settings (`4` or `Ctrl ,`)

<p align="center">
  <img src="docs/images/settings.png" width="900" alt="Settings: auto setup and Providers (API keys, local servers, CLI logins), with model routing and coding workers in the side list">
</p>

Settings keeps **General**, **Appearance**, **Audio** and **System**. Connections, model routing, team roles and workflow behavior now live in **Agents › Setup**. **Find a setting** searches individual controls and opens the matching category and disclosure. Connection forms and advanced options expand in place. Appearance includes Focus, Studio and Atmosphere presets and the live canvas preview. Agents and the companion share confirmed operational controls.

The main menu groups the app into **Home**, **Work**, **Agents** and **Friends**. See [Unified Studio](docs/unified-studio.md) for team presets, configuration scope, scrollbar-free navigation and the adaptive companion. The [0.4.5 scope](docs/release-scope-0.4.5.md) records what is included in the next release and what is deferred.
A local navigation row exposes each group's tools, while **Settings**, **Search**
and **Help** stay available. See the [interface inventory](docs/interface-remaster.md)
for the full set of screens and interior menus.

### Also in the box

**Tasks** (`T`) with briefs, prerequisites, attempts and evidence · **Plans** (`P`) that turn an unclear idea into a specification and tasks · **Ideas** (`I`) inbox · **Model catalog** (`1`) and **Performance** (`2`), plus Usage and Context · **Activity & evidence** (`3`), a read-only view of the coding sessions · **Sessions** (`E`), **Analyzer** (`A`), **Overhead** (`O`), **Appearance** (`U`), and the **Performance profiler** · **Search Studio** (`Ctrl K`) finds any page, tool, task, setting or model · `?` lists every shortcut.

The full feature walkthrough, in Studio's own vocabulary with a glossary, is in [docs/architecture.md](docs/architecture.md).

## Keys and privacy

- Keys are entered once in Settings › Connections and stored encrypted in the OS keystore; only "saved / not saved" reaches the UI. Headless setup, from a source checkout in PowerShell: `$env:MEFI_STUDIO_KEY = "<key>"; npx electron . --set-key`, then `Remove-Item Env:MEFI_STUDIO_KEY` (while it is set it overrides the saved key). [.env.example](.env.example) pairs every `--set-*-key` flag with its variable.
- Git tracks only `data/curated.json` and `data/models.json`. Tasks, conversations, settings, databases and captures stay local and are never packaged.
- Agents run real commands in the project folder you chose. Turn **Auto build** off (*Verify first*) to approve each task before it runs.
- Nothing contacts Discord unless you link an account (below). The link reads your Discord id, username and roles in the Void Engine server, and nothing about your projects.
- See [SECURITY.md](SECURITY.md) for reporting.

<a id="community--perks"></a>

## Community

The [Void Engine Discord](https://discord.gg/xgfKc5pVxG) is where people share projects, ask for feedback and hang out while they build. Unfinished ideas are welcome. Come meet **Studio**, our new Discord bot, and help shape what it becomes.

**Rooms** (Friends › Rooms, on the Void Engine room service) lists your rooms and the listed ones you can join. You can **Ask to join** with a short note, or accept or decline an invite. For rooms you own, you can let requesters in or decline them, invite people by name, lock or close the room, and make new rooms (hangout or cowork, open to requests or invite-only, listed or not). Each room has its chat, shown as plain text with @names; links are never clickable. A message that does not go through stays in the box with the reason. Invites and requests waiting for you are counted on the Friends bubble. Rooms need a rooms hub and a linked Discord account. Studio has neither the hub's address nor the Mefi Studio Link app id built in: enter both in **Settings › Community › Connection details** on each PC ([setup guide](docs/friends-setup.md)); until then the panel says what is missing.

Every theme and node style is free, including the Void collection. Discord membership is optional.

Rooms, Friends › Playground, Listen together, cowork claims for agents and the Discord remote all depend on that hub and a linked Discord account, so they do nothing until each PC has both values above. The Playground also needs a hub that carries the companion relay, and the Discord remote a hub with the remote turned on ([docs/remote.md](docs/remote.md)). The personal media player works without either. An optional **“Hey Studio”** voice popup is only a proposal and is not in 0.4.5.

The [community guide](https://nateecho32-stack.github.io/mefi-studio/wiki/#/community) explains what's available. [Public site and voice direction](docs/public-site.md) records the website's location, public naming and proposed voice integration.

## Working from several PCs

GitHub is the meeting point. Each PC keeps its own clone, and the open project's default branch on GitHub is the one shared state.

- **Friends › Your PCs** in the companion hub says whether this PC matches GitHub and lists anything that has not reached it yet: uncommitted files, unpushed commits, stashes, worktrees with changes, and branches that are not on `main`. Opening it only looks. **Sync this PC** pulls what your other PCs pushed and pushes this PC's commits on the default branch, but only after the project's own `npm run check` passes. It never overwrites uncommitted work, merges diverged histories or force-pushes.
- **Put my commits on top of GitHub's** appears when this PC and GitHub both moved and nothing is uncommitted. It rebases this PC's commits onto GitHub's, then checks and pushes. On a conflict it changes nothing and names the files.
- **The Friends bubble shows a badge** for work only this PC holds, commits waiting on GitHub, or a GitHub it could not check (a lapsed sign-in or a renamed repository). Studio looks 45 seconds after launch and every 15 minutes, and it only looks.
- **Closing Studio asks first** when the open project has work on this PC alone. You can push and close, close anyway, or keep Studio open. Update restarts never ask.
- **`npm run sync`** does the same from a terminal (`--rebase` to put your commits on top, `--no-check` to skip the check).
- **A merge that drops another branch's work is caught.** If a merge keeps one side of files both sides changed (or a later commit puts the tree back to one parent) and 200 or more lines of the other side's work vanish, `npm run sync` refuses to push it and names the merge and the files; the session hook and Your PCs list recent ones. A deliberate choice is recorded with a `Lost-work-ok: <why>` line in the merge's commit message (or `--allow-lost-work` for one push). The generated booklet and TESTRUNS rows are exempt.
- **Set up this PC** (inside Your PCs) checks what a new PC needs: Git, the GitHub CLI, Node.js, a GitHub sign-in, and whether the open project is on GitHub, has its packages installed, and sits on a drive that can hold Git worktrees (exFAT and FAT cannot). Each missing piece has a button that opens a visible setup window running Studio's own fixed command. You sign in to GitHub in your browser, and Studio never sees the password or token. **Get a project from GitHub** lists your own repositories, clones the one you pick into a folder you choose (never onto exFAT), and opens it.
- **Claude Code** runs `node scripts/sync.mjs --hook` at the start of each new session (`.claude/settings.json`). The hook fetches, fast-forwards `main` when it can, and hands the report to Claude. `AGENTS.md` has the working rules.

Claude Code sessions and local branches stay on the PC that made them. Anything another PC needs belongs on GitHub.

**Share between my PCs** (inside Your PCs) moves what you choose between your own PCs through one private GitHub repository, `<you>/mefi-studio-vault`. Every file in it is sealed (AES-256-GCM) with a key that only your paired PCs hold in Windows' protected storage, so GitHub cannot read it. Make the vault on your first PC, then type its pairing code on each other PC. Nothing goes until you tick it, and Studio checks every item on the way out and again on the way in.

- **Shelves:** how models did by kind of task, what Studio learned from your decisions, agent team setups, agent brains, Playbook recipes, Claude Code memory notes, your preferences (no keys, no addresses), and your open tasks and ideas. Brains, recipes, notes and ideas belong to their GitHub repository and are used only in that project.
- **Checked both ways:** an item with a key, token, password or a login in a link is stopped; paths, your user and PC names, emails and network addresses are removed; and anything received that tells an agent to ignore its instructions, asks for keys, runs a downloaded script or sends data to a paste or webhook service is kept out, never used.
- **Nothing is overwritten:** a received brain, team or recipe is added beside yours with where it came from in its name, a memory note is written only where none has that name, and ideas never start work by themselves. Model results and decisions you keep count as another PC's experience when Studio picks models and suggests what to do; remove them from the library and they stop counting.
- **Keys and setup** are separate and strict. The screen says in capitals that you are sharing keys and setup information that can be stolen, you type the confirmation exactly, and Windows asks once more. On the other PC they are saved straight into protected storage and never shown. Take them out of the vault once your PCs have them, and replace a key at its provider if you think it leaked.
- **Your PCs list** shows each paired PC, when it last synced, and what waits on it per project.
- **Keep this PC up to date** (on by default) asks GitHub every minute whether another PC pushed, and fast-forwards when this PC has nothing of its own in the way and no builder is running.
- **Agents on several PCs** coordinate through a cowork room linked to the project (Friends › Rooms): builders claim the files they will edit, every PC sees the claim within a second, and a task whose files another PC holds waits. Claims are held until the work is pushed. This needs the rooms hub and a Discord link (see Community); with no room, hub or link, nothing waits.

**Share with friends** saves one item (a brain, a recipe, a team setup, model results, a memory note or your preferences) to a `.mefishare` file you send however you like. Studio removes paths, user and PC names, emails, addresses and the repository name, refuses anything with a secret in it, and shows you exactly what the file holds first. Opening a friend's file runs the same review; a risky one is kept out, and a clean one goes to your library for you to use.

## Tests and checks

```powershell
npm run test:fast        # Node suites without the Electron fixtures (about 20 s)
npm run check            # targets, spec collisions, CSS merge + unused, syntax, TESTRUNS
npm run lint             # eslint, check-only
npm test                 # the gate: Node suites + Electron fixtures + Python contracts
npm run audit            # renderer/template contract audit
```

`npm test` needs Python 3 (`python`, `py -3` or `python3`) and a real desktop: nine suites drive Electron windows and are timing-sensitive. [CONTRIBUTING.md](CONTRIBUTING.md) explains the gates and conventions; [TESTRUNS.md](TESTRUNS.md) is the maintainers' lab notebook of past runs and flake triage, not a guide.

## Documentation

| Read this | For |
| --- | --- |
| [GETTING_STARTED.md](GETTING_STARTED.md) | First launch, new-machine checklist, your first task, what each state means |
| [docs/architecture.md](docs/architecture.md) | Glossary and the detailed feature walkthrough |
| [docs/code-map.md](docs/code-map.md) | Which file does what, folder by folder, and where to look first |
| [docs/agent-loop.md](docs/agent-loop.md) | How a chat message becomes a verified task, with file references |
| [docs/performance.md](docs/performance.md) | Measurements and how to reproduce them |
| [docs/community.md](docs/community.md) | The Void Engine Discord link: the weekly card, the login, what is stored, unlinking and the fork switch |
| [docs/remote.md](docs/remote.md) | Reach your PCs from Discord: what a DM can and cannot do, the PIN, alerts, and the hub protocol |
| [docs/ux-audit.md](docs/ux-audit.md) | The UX audit and its phased plan |
| [docs/fleet-overhaul-plan.md](docs/fleet-overhaul-plan.md) | The fleet overhaul: seats, pods, missions and Refocus from OpenRig, Live › Fleet, and the phase plan. Not in 0.4.5: main has only the host model, and the Fleet view does not exist yet |
| [docs/pi-provider-storage.md](docs/pi-provider-storage.md) | How pi's coding agent stores provider config, and the settings/auth split Studio adopted from it |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Check gates, test-file rules, parallel-session etiquette |
| [SECURITY.md](SECURITY.md) · [CHANGELOG.md](CHANGELOG.md) | Reporting and what changed |
| [docs/archive/](docs/archive/) | Historical audits and handoffs, kept for the reasoning |

## Optional: Ruins Runner

Studio can launch the author's LÖVE game from Settings › Integrations when a checkout is found (`MEFI_STUDIO_GAME_ROOT`, or a sibling `2d-Trippy-Hell` or `2d Trippy Hell` folder). A fresh clone works without it.

## Contributing

Issues and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md); the pull-request template lists the three gates. Bug reports are most useful with the version, the install kind, the selected route and builder, and the task state you saw.

## Discord Server Styler

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

## License

[MIT](LICENSE) © 2026 MefiMaxi
