<p align="center">
  <img src="assets/icon-256.png" width="120" height="120" alt="Mefi's Studio AI+ icon">
</p>

<h1 align="center">Mefi's Studio AI+</h1>

<p align="center">
  <strong>A personal multi-project workspace with an AI companion, an agent task loop, and visible work results.</strong>
</p>

<p align="center">
  <a href="https://github.com/nateecho32-stack/mefi-studio/actions/workflows/spec-collisions.yml"><img src="https://github.com/nateecho32-stack/mefi-studio/actions/workflows/spec-collisions.yml/badge.svg?branch=main&style=flat-square" alt="Studio checks"></a>
  <img src="https://img.shields.io/badge/platform-Windows-0078D4?style=flat-square&logo=windows&logoColor=white" alt="Platform: Windows">
  <img src="https://img.shields.io/badge/electron-44.4.1-47848F?style=flat-square&logo=electron&logoColor=white" alt="Electron 44.4.1">
  <img src="https://img.shields.io/badge/node-24-5FA04E?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node 24">
  <img src="https://img.shields.io/badge/keys-OS%20keystore%20encrypted-6F42C1?style=flat-square" alt="Keys encrypted with the OS keystore">
  <img src="https://img.shields.io/badge/local--first-no%20telemetry-2EA043?style=flat-square" alt="Local-first, no telemetry">
</p>

Mefi's Studio AI+ is a desktop workspace for working with an AI assistant across
projects. Pick a project, talk an idea through, or choose **Give a task** to
create real work on its board; the companion moves between Listen, Make, and
Review as actual work changes.

The in-app walkthrough opens on first launch and explains choosing a folder,
connecting tools, creating one clear task, following its activity and reviewing
its result. Each lesson can **Walk me…** through the matching menu with a small
coach that highlights the control, ticks stops off as you go and remembers your
place. [GETTING_STARTED.md](GETTING_STARTED.md) covers the same path in writing.

## Quick start

### Run from source

```powershell
npm ci                   # once; downloads Electron (~110 MB)
npm run build-booklet    # build the committed renderer
npm start                # desktop app
npm run start:web        # browser-only fallback: http://localhost:4173
npm run capture          # screenshot tour -> tools/logs/mefi_studio_captures/
```

`npm start` needs a normal shell: if `ELECTRON_RUN_AS_NODE` is set (some agent
harnesses set it), main.cjs refuses to start with the fix printed.

On Windows, double-click `Run Mefi's Studio AI+.cmd`; it starts the portable
build when available, otherwise the development install. Portable downloads
must be extracted in full before opening `Mefi Studio AI+.exe`.

### Packaging a release

Run `npm run check`, `npm test` and `npm run audit`, then `npm run
package:release`. That creates a fresh folder under `dist/releases/` with only
the two public catalogs in its data directory; zip the entire folder before
opening it. `npm run package` refreshes the everyday portable build in
`dist/Mefi Studio AI+/` while preserving its existing local data. Neither path
seeds a new build with your settings, tasks, conversations, credentials or
caches, and neither uploads anything.

### One repository, many projects

A fresh install opens with no project: choose a folder in **Projects** and
Studio scans it locally before any work starts. Set `MEFI_STUDIO_REPO` to open
a working repository directly for headless or developer launches. The optional
Ruins Runner integration uses `MEFI_STUDIO_GAME_ROOT`, or a sibling
`2d Trippy Hell` folder when present — a fresh clone works without the game.

## Highlights

| Capability | What it does |
| --- | --- |
| **Assistant that keeps working** | An always-on service loop ticks in the main process — organising, auditing, fixing, tidying and briefing — whether or not a window is open. |
| **Visible agent loop** | Watcher, machine, auditor, keeper, thinker, briefer and responder roles run as satellites around the assistant node and report their findings home. |
| **Planning that becomes work** | Plans settle unknowns and decisions into a specification, then explicitly create board tasks with acceptance checks. |
| **Verified results** | "The run said done" is not done: attempts settle to `awaiting_verification` with evidence attached, and housekeeping verifies them. |
| **Model Lab** | Measured latency, throughput, errors and reported cost per project, with unknown values left unknown. |
| **Live update** | Studio watches its own source tree and restyles, hot-swaps modules, or reloads with full UI state restored. |

## What's inside

### Workspace and work

- **Projects** keeps each folder's tasks, conversations, drafts, references and
  work logs together; the left-edge sidebar switches projects, and running work
  must finish before a project change.
- **Your work** separates open work, attempts needing **Review**, and verified
  or manually confirmed **Done** tasks; archived completions stay visible.
- **Auto build** stays on by default. Turn it off for **Verify first** so each
  task waits in Review until you choose **Approve build**. Approval covers the
  saved task scope and is saved across restarts for all projects.
- **Work through backlog** works the project's existing tasks and ideas first,
  keeping a small runnable buffer; **Pause** stops new scheduling while current
  workers finish.
- The **task board** opens as plan cards with progress and a current step, and
  holds prerequisites, handoff context and task history. Missing prerequisites
  and dependency cycles are surfaced for correction.
- **Ctrl K** finds tools and tasks by familiar terms; **Make yourself at home**
  sets your name, companion name, accent and movement preference.

### Planning

**Plan an idea** opens **Plans** for work whose route is unclear: give the plan
a destination and an out-of-scope boundary, collect unknowns, resolve questions
after their dependencies, then write or request a specification with small
tasks, acceptance checks and prerequisites. Approve the draft, then explicitly
create its tasks. Assistant suggestions and discussion never resolve a question
or approve work, and planning itself cannot launch coding workers. Manual
controls work without an AI key; plans and their revision history stay in the
project's ignored local `planning.json`.

### The assistant and the agent loop

- The assistant can always be messaged and is always working: a **service loop**
  ticks every 30 seconds (every two minutes while hidden), organising the node
  tree, scanning the machine, running the Auditor every five minutes, fixing and
  tidying on cadence, and (with Proactive on) briefing every five minutes.
- Messaging is a real chatbot: multiline composer, quick-ask chips, follow-ups
  resolved against the last reply, replies grounded in the current board and
  inbox, and plain keywords that work without AI. Asking for work queues it;
  vague chatter gets a yes/no offer instead of an accidental job.
- **Work on it** makes a node the assistant's next piece of work — pinned to
  the front of the board and started at demand priority. Every session, todo and
  task acts as a **node folder** of typed context cells that compile into chat
  replies and executor prompts.
- The **overseer** reviews how the assistant works, keeps a playbook and lesson
  counts, files bounded upgrade requests, and repairs the loop (resume stale
  sessions, re-arm interrupted work) every fifteen minutes.
- Closing the window hides Studio to a tray icon and the loop keeps running;
  builders journal their progress and checkpoint before quit, and interrupted
  work resumes on the next start instead of being duplicated.

### Command center and the node tree

- **Live work** shows the current worker and step, readiness counts, the
  readable agent roster (each role's status, name, elapsed time and current
  task) and a ranked queue; **Settings** holds the queue controls, while
  **Agents** in the toolbar chooses how the roster shares work between
  **Swarm** (across the queue) and **Cluster** (one goal at a time).
- **Parallel builds** defaults to **Machine managed**: admission follows
  measured app responsiveness, with optional manual limits of one to three
  workers. High CPU alone never limits builds.
- **Follow** frames the active task; **Fit** repairs the layout. Pick node style
  (**Classic orbs**, **Soft glass**, **Minimal**, **Halo**, **Crystal**) and
  arrangement (**Constellation**, **Branches**, **Rings**, **Helix**,
  **Terraces**) per project, in 2D or real 3D.
- **Music & themes** plays your local files or Spotify links and recolours
  Studio; **Audio link** wires bass, mids and treble to the live tree
  (including desktop audio and microphone sources) only when you enable it.

### Model Lab and routing

- **Model Lab** records per-project latency, delivered tokens/s, errors,
  reported usage and USD cost, with human and model ratings kept separate;
  opening it never runs paid measurements. **Context** previews the current
  task brief within a chosen token budget and reports what was shortened.
- **Usage tracker** sums recorded calls per day, provider and model, and reads
  OpenCode Go's own 5-hour, weekly and monthly account windows with the saved
  key. The live account reading and the local estimate stay clearly separate;
  a compact version sits at the bottom of the Command rail, and the full view
  is the Model Lab **Tracker** tab. Opening it and every five minutes while it
  is visible is the only time the account is asked; no prompts are sent.
- **AI routing** picks who pays — Auto walks an ordered provider list you edit
  in Settings (the first usable provider answers, and the opt-in fallback
  walks down the list), plus z.ai only, OpenCode Go only, the Grok, Claude
  Code or Antigravity CLIs on their own logins, a local LM Studio server, or a
  custom OpenAI-compatible endpoint with your own key. **Model selection** uses
  Jev or fixed defaults.
- **Models are saved per provider and per builder CLI**, so switching routes
  never carries one provider's model id into another; a provider with nothing
  saved uses its own default, and the keyed HTTP routes keep the role-wide
  Routine/Heavy overrides. Missing a subscription or key for one option never
  blocks the others — the readiness line names what the selected option has.
- **Jev routing** chooses where classifier calls go — the Vercel AI Gateway
  (`typesafe-ai/jev`), TypeSafe's Jev API directly (`jev-1.13.0`), OpenCode
  Zen (`jev-1.13`, including its free tier), or OpenRouter
  (`typesafe/jev-1.13`) — each route keeping its own encrypted key. Headless
  setup: `MEFI_STUDIO_GATEWAY_KEY=... electron . --set-gateway-key`,
  `MEFI_STUDIO_JEV_KEY=... electron . --set-jev-key`,
  `MEFI_STUDIO_ZEN_KEY=... electron . --set-zen-key`,
  `MEFI_STUDIO_OPENROUTER_KEY=... electron . --set-openrouter-key`, and
  `MEFI_JEV_ROUTE=zen` (or `vercel`, `typesafe`, `openrouter`) to pick the
  route.
- **Auto setup** in Settings reads saved-key flags, installed CLIs and (only
  when nothing else is available) a live local server, then applies the
  matching provider, model selection and builder in one pass. It sends no paid
  request, changes no key, keeps model overrides, reports every choice, and
  leaves the same controls editable afterward.
- Builders run through `opencode run` (with a Studio-managed z.ai provider),
  the Grok CLI, Claude Code (`claude -p` on your subscription login), or
  Antigravity (`agy` on your Google account), with automatic one-time fallback
  decided by the failure kind.
- Keys live in the OS keystore (`safeStorage`; DPAPI on Windows). Headless
  setup: `MEFI_STUDIO_KEY=... electron . --set-key`,
  `MEFI_STUDIO_ZAI_KEY=... electron . --set-zai-key`, and
  `MEFI_STUDIO_CUSTOM_KEY=... electron . --set-custom-key`.

### Verification, storage and experiments

- A finished attempt settles to `awaiting_verification` with its evidence
  (sentinel, exit code, spawned session); failed or pending checks block
  completion, and unavailable evidence waits without consuming a retry.
- The JSON views are the authoritative board. `node scripts/reconcile-board.mjs`
  repairs a backlog offline, and `node scripts/reconcile-store-fork.mjs`
  (`--dry-run` to preview) syncs the missing slice with the packaged app's store.
- The **Policy Lab** is observation-only: dispatches append episodes under
  `data/policy-lab/`, and `npm run policy-lab` replays candidate configurations
  against them. No live dispatch changes are made.
- The **Jev intake classifier** runs in shadow mode at admission, recording
  `jev-proposal` events; it can never suppress work, merge tasks or spawn
  agents. The governor's kill switch is `settings.jevShadow === false`.

### A-Eyes, tools and diagnostics

- **A-Eyes** reads the OpenCode session store read-only: change feed with diffs,
  per-session totals, PNG evidence with pins, and a log tail. Clicking a node
  in the 3D rail filters the feed and focuses the assistant.
- The **session explorer** (`E`) carries the always-on thread, collateral
  watch, local Auditor and request inbox, with checkpoint actions
  (Reference / Explore / Restore / Expand).
- The **Analyzer** (`A`) compares plans and notes with current source, listing
  `file:line` evidence, missing references and unverified completion claims.
  It runs locally; the optional AI read sends bounded excerpts only when asked.
- **Tasks**, **Ideas**, **Overhead** and the **Performance profiler** cover task
  logs and references, a feature-idea inbox and graph, task-to-session mapping,
  and in-app frame/scope/hitch capture with JSON export.
- **Machine coordination** watches test leases and live processes, holds new
  starts when Studio becomes laggy, and auto-kills strays, hangs and over-age
  runs (every kill is logged and queued to the inbox).

### Live update

Studio watches its own source tree: CSS restyles in place, `scripts/*.mjs`
modules hot-swap, renderer files reload with tab, selection, scroll and focus
restored, and `main.cjs` restarts the app. Edits are batched, changed scripts
are syntax-checked first, and a broken file or three restarts a minute **hold**
the update instead of crashing. The `data/` directory is never written by the
updater or packaging.

### Release updates

A packaged copy also reads the repository's latest GitHub release every 20
minutes. When a newer build exists, the App updates block shows **Update to
vX.Y.Z**: it downloads the release zip, verifies the published `.sha256` (or
the API digest) when one exists, stages the portable folder, and a helper
script waits for the app to exit, copies the payload into place — never
`resources/app/data` — and relaunches. In development the checker only
reports; the live update above applies source changes.

Build and publish a release with `node scripts/package-release.mjs --version
vX.Y.Z --publish`, or push a `v*` tag and let
`.github/workflows/release.yml` run. A private repository needs a read-only
token: save one in App updates, set `MEFI_STUDIO_GITHUB_TOKEN`, or let Studio
reuse the GitHub CLI's `gh auth token`.

## Tests

```powershell
npm test                 # Node behavioral tests + Python contracts
npm run check            # targets, spec collisions, CSS cascade gates, syntax
npm run audit            # application audit
```

The Python contracts (`python -m unittest discover -s tools -p
"test_mefi_studio_*.py"`) cover catalog math, booklet self-containment and the
launcher shape; none need network, Electron or LÖVE. See
[TESTRUNS.md](TESTRUNS.md) for every run and [PERFORMANCE.md](PERFORMANCE.md)
for startup measurements. After a `renderer/styles.css` merge, prove the
cascade with `npm run check:css` instead of eyeballing diffs.

## Keys

`D` Command view · `1` Booklet · `2` Graph · `3` A-Eyes · `4` Studio · `E`
explorer · `T` tasks · `I` ideas · `O` overhead · `A` analyzer · `Ctrl K`
palette · `R` refresh catalog · `G` pin the node tree · `M` message the
assistant · `?` shortcut sheet · `Esc` closes the top-most layer.

## Privacy and security

- Keys are encrypted with the OS keystore; only connection status crosses into
  the renderer.
- Git tracks only `data/curated.json` and `data/models.json`. Tasks,
  conversations, settings, databases, captures and build output stay on your
  computer.
- Packaging never seeds a build with your personal state, profiler reports
  contain measurements rather than task text or paths, and there is no
  telemetry and no hosted account.

## Love2D studio

The Studio tab launches the external Ruins Runner checkout's dev tool exactly
like `Run Dev Tool (LOVE2D).cmd` (windowed LÖVE 11.5 with
`dev/dev_tool_love_project`). If the runtime is missing, run
`tools/build-windows.ps1` from the game root.

## Documentation

| Guide | What it covers |
| --- | --- |
| [GETTING_STARTED.md](GETTING_STARTED.md) | First launch, new-machine setup and your first project |
| [TESTRUNS.md](TESTRUNS.md) | Every test run, workload settings and measured results |
| [FEATURE_AUDIT.md](FEATURE_AUDIT.md) | Verified scope and remaining gaps |
| [PERFORMANCE.md](PERFORMANCE.md) | Startup measurements and reproduction |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Repository conventions and test-file rules |
| [MIGRATION.md](MIGRATION.md) | Moving an existing installation |
| [AGENT_LOOP_VERIFICATION.md](AGENT_LOOP_VERIFICATION.md) | How the agent loop is verified |
| [HANDOFF_mefi_studio_assistant.md](HANDOFF_mefi_studio_assistant.md) | Assistant internals handoff |
