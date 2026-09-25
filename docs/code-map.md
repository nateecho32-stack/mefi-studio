# Code map

## Unified Studio ownership

- `renderer/agents.js` / `agents.css`: the Agents workspace, relocated setup controls, scoped drafts, presets and shared operational state.
- `scripts/agent-addons.cjs` / `agent-models.cjs`: per-agent local skill discovery and prompt attachment, plus read-only provider model rosters with credentials kept in the host.
- `renderer/studio-ui.js` / `studio-ui.css`: scrollbar-free overflow, accessible dropdowns, shared appearance presets and shared glass surface recipes. The stylesheet follows the base page styles; component styles retain their layout and semantic status colours.
- `renderer/companion-ui.js` / `companion-ui.css`: the stable adaptive companion panel, hover ownership, dragging, pinning and safe edge roaming.
- `renderer/companion-hub.js` / `companion-hub.css`: the shared glowing wisp, ASCII reactions, bounded particle bursts, thinking state, setup companion, and accessible glass bubble menu; reuses existing chat, requests, room connections and audio-link state.
- `scripts/agent-profiles.cjs`: versioned credential-free teams, project/default resolution and captured attempt configuration.
- `renderer/nav.js`: project/section-local history, compatibility redirects and shared destination ownership.

See [Unified Studio](unified-studio.md) for the interfaces and fixture coverage.

Where things live, folder by folder. [architecture.md](architecture.md) is the
feature walkthrough and glossary, and [agent-loop.md](agent-loop.md) follows a
chat message all the way to a verified task; this page answers the narrower
question *which file?*

Each purpose below is condensed from that file's own header comment, so when a
file's role changes, change its header first and this page after it. Line
counts were taken on 22 September 2026 and drift; they are here to show where
the weight is, not to be exact.

## Four runtimes

| Runtime | Entry | Talks to the others through |
| --- | --- | --- |
| Electron main process | `main.cjs`, plus the `scripts/*.cjs` it requires | IPC through `preload.cjs`; child processes through `scripts/platform.cjs` |
| Renderer | `renderer/booklet.html`, built from `booklet.template.html` and every `renderer/*.js` and `.css` | `window.mefiStudio`, defined in `preload.cjs`, and nothing else |
| Store worker thread | `scripts/eyes-worker.mjs`, hosting `scripts/eyes.mjs` | `scripts/eyes-client.cjs`: one message and one promise per read |
| Child processes | builder CLIs (`opencode`, `claude`, `codex`, `grok`, `agy`), reply CLIs, `gh`, the game | a builder's stdout sentinels — `MEFI_JOB_DONE`, `MEFI_RESULT:`, `MEFI_NEXT:`, `MEFI_CALL:` — read by `wire()` in `main.cjs` through `readWorkerLine` in `scripts/executor-core.cjs` |

## Root

| File | Lines | Purpose |
| --- | ---: | --- |
| `main.cjs` | 14,053 | The Electron main process: the window, every IPC handler, the host's own model calls, the service loop, the executor, the board gateway (`mutateBoard`), verification, settings and the headless CLI flags. Much of it is tested by slicing named sections into `vm` sandboxes (see [Tests](#tests-and-tools)). |
| `preload.cjs` | 147 | The `contextBridge` surface, `window.mefiStudio`: the only boundary between renderer and main. `installBridge` builds it in the page's own world, so each push crosses the bridge once and every `on*` subscriber shares that copy. |
| `eslint.config.js` | 67 | Check-only lint: an undefined identifier is an error, an unused one a warning, and there are no style rules. |
| `package.json` | | `"type": "module"`, which is why [CONTRIBUTING.md](../CONTRIBUTING.md) sets a file-extension rule: `.cjs` for what `main.cjs` or `preload.cjs` requires, `.mjs` for what tests and other scripts import and for CLIs, `.js` only under `renderer/`. |

## `scripts/` — main-process modules and CLIs

### The loop and the board

| File | Lines | Purpose |
| --- | ---: | --- |
| `assistant.mjs` | 6,486 | The always-on assistant's logic — every role, state normalisation, tree organisation, housekeeping and `verifyCompletion` — as functions of their inputs and an explicit `now`. |
| `task-context.cjs` | 192 | Durable task revisions (`contextHistory`) and resumable briefs. Pure; callers persist the result under the board lock. |
| `task-attempts.cjs` | 86 | A task's attempt history (start, fallback, finish, release) grouped by `runId` from `data/executor-log.jsonl`, for the task detail's Attempts fold and the Explorer/A-Eyes "Open task" links. Pure; read-only. |
| `task-delegation.cjs` | 173 | Splits an owned task into durable slices. Pure, and runs inside the board gateway. |
| `task-handoffs.cjs` | 129 | Durable work handed on by a finished attempt; transforms board records and never runs a worker. |
| `task-history.mjs` | 126 | Moves inbox rows an older build left mid-run onto the task path, since only tasks run now: a lost "running" claim back to the inbox for promotion, a "verifying" row onto the board as an awaiting_verification task. Pure; housekeeping calls it under the board lock. |
| `backlog.cjs` | 143 | One eligibility vocabulary shared by dispatch and the workbench. Reading a backlog never changes work. |
| `board-growth.cjs` | 51 | Bounds speculative discovery against the durable board. |
| `board-grouping.cjs` · `group-board.mjs` | 65 · 97 | Reviewed group requests applied inside the host's board transaction; offline grouping as a CLI. |
| `work-admission.cjs` | 287 | The one admission path for new work: the Unicode-aware title key (`compactKey` delegates to it), the `isOpenWork` predicate, the task-row skeleton (with its `origin`, which the worth band reads), and `represented()` / `admitTask()`, one ladder of identity, then brief, then title key that chat, the composer, Work on it, splits, the filers, promotion, handoffs, delegation, plans and ideas all run. Pure; `now` and ids are injected. |
| `chat-work.cjs` | 177 | Chat admission: compares the whole obligation before a card is created. The brief rung of `work-admission.cjs`'s ladder. |
| `task-oversight.cjs` | 1,571 | The chat assistant as overseer: the ranked board digest it reads, per-task lifecycle events for the thread (and the "needs you" roll-up), its JSON reply parsed into actions, and the gate that runs only what the owner plainly asked for on a plainly named card and turns the rest into Ask cards. Pure; time is injected. See [agent-loop.md §11](agent-loop.md#11-the-assistant-as-overseer). |
| `agent-issues.cjs` | 441 | The one shape an agent uses to say "this needs a decision", and the rules that either answer it or file it in Ask. |
| `agent-modes.cjs` | 174 | Swarm and cluster selection and their advisory prompts. |
| `brains.cjs` | 933 | Brain maps: the pipeline as a graph you can open, rewire and save. See [brain-maps.md](brain-maps.md). |
| `executor-core.cjs` | 644 | The executor's decisions, lifted out of `spawnNextJob`: which ready card runs next and why nothing does, the worker's prompt (budgeted against `EXECUTOR_PROMPT_MAX`, the sentinel tail first), the command line per builder CLI, what one line of worker output says, how a run ended (`classifyRunEnd`: the settle branch and the infrastructure rule), what the model ledger records for it (`attemptLedgerOutcome`: a loss only for the model's own failure), the card's settle state machine (`settleAttemptRow`) with its backoffs, the start budget, and the attempt's records. Pure: no Electron, filesystem, network, processes, timers or clock reads; the host passes its helpers and constants in. `spawnNextJob` keeps the gates, the claim, the child and the writes. See [agent-loop.md §3-5](agent-loop.md#3-selection-and-claim-spawnnextjob). |
| `executor-resume.cjs` | 75 | Local recovery context for a run — never completion evidence. |
| `executor-activity.cjs` | | Bounded live worker output, credential and terminal-control filtering, route and current checklist step for Home and Command. Activity is never completion evidence. |
| `executor-worktrees.cjs` | 246 | A git worktree per run, so parallel runs stop contending on `.git/index`. |
| `context-manager.cjs` | 156 | Bounded context previews with token estimates. Reads no saved state and never changes the executor prompt. |
| `idea-actions.cjs` | 51 | Applies one UI intent to the latest board, so keeping an idea cannot overwrite a promotion, and an inbox add or remove (`eyes:requests-action`) cannot undo a claimed or promoted request. |
| `reconcile-board.mjs` · `reconcile-store-fork.mjs` | 247 · 157 | One-shot repairs, run with the app closed: board reconciliation, and the repo-versus-installed store fork. |

### The Agent Brain (0.4.0)

The host half is one object, `agent-brain-host.cjs`, which main.cjs calls from
one-line hooks; the rules live in the pure modules it composes. See
[agent-loop.md §13](agent-loop.md#13-the-agent-brain) and
[roadmap-0.4.0.md](roadmap-0.4.0.md).

| File | Lines | Purpose |
| --- | ---: | --- |
| `agent-brain-host.cjs` | 881 | Turns the loop's moments (a run prepared, started, speaking, finished; a board write; agent mail; a verified run's files) into work events, per-task pipelines, Playbook records, the project map, desk answers and the companion's state, per project. Every hook swallows its own errors. |
| `work-events.cjs` | 286 | The work event stream: the kinds, normalisation, the append-only `work-events.jsonl` store (one chain per file, trimmed like the executor ledger) and the ledger comparison the replay tool uses. |
| `pipelines.cjs` | 512 | A task's pipeline: the step kinds, templates and recipe instantiation, and `advance` for every run moment (start, first line, todos, `MEFI_STEP` lines, children, end, verdict, fold) within growth caps. Pure. |
| `playbook.cjs` | 283 | Recipes of verified pipeline shapes: `record`, `pick` (a win probability from verified runs, pinned first, with exploration), the owner's actions and the shelf. Pure. |
| `project-map.cjs` | 535 | The per-task file index and the project map: systems from the first map's areas and folders, co-change links, the task overlay, `relatedFor`/`briefLine` for worker prompts, and the naming prompt. Pure. |
| `desk.cjs` | 231 | The desk worker's protocol: `MEFI_HELP` lines, its prompt and answer parsing, repeat folding and the note written for the next worker. Pure. |
| `companion.cjs` | 292 | The companion's state (greeting, working, needs you, resting), the welcome-back digest, the needs-you queue and the preferences it learns from answers. Pure. |
| `desk-server.cjs` · `desk-mcp.mjs` | 105 · 110 | The desk as a tool a running worker waits on: a 127.0.0.1 endpoint with a per-process token, and the stdio MCP server OpenCode and Claude Code start beside a run when `agentBrain.deskTool` is on. |

### Model calls, routing and resilience

| File | Lines | Purpose |
| --- | ---: | --- |
| `provider-breaker.cjs` | 194 | A circuit breaker per provider for the host's own model calls, adapted from BetterC0de. `httpAssistantCall` and `assistantFetch` gate every call on it. |
| `redaction.cjs` | 92 | `scrubOutbound`, the gate every outbound payload passes through, and `safeExcerpt`. |
| `credentials.cjs` | 93 | Which environment variables may back each saved key: Studio's own `MEFI_STUDIO_*` names and the names other tools share. |
| `auth-store.cjs` | 93 | Keeps the key ciphertext in `auth.json`, apart from the `settings.json` preferences: splits a settings view into the two, merges them back into one view for callers, and writes the auth file atomically. |
| `decision-client.mjs` | 631 | The Jev classifier client over its four routes. |
| `model-routing.mjs` | 285 | The builder-model evaluator: each candidate's verified record on this kind of work, cost, speed and strengths become a win probability (`estimateWinProbability`); Jev or the stand-in judge answers one probability per candidate, and the highest wins. See [agent-loop.md §12](agent-loop.md#12-choosing-a-builders-model-the-win-probability-evaluator). |
| `work-classification.mjs` | 241 | Builds the narrow questions Jev answers, and interprets the answers conservatively. |
| `choice-judge.mjs` | 186 | The stand-in judge for machines with no Jev key. |
| `jev-loop.mjs` | 115 | A bounded advisory queue; admission never waits on Jev. |
| `model-performance.cjs` | 343 | Local measured evidence only; never calls a provider. Builder attempts are settled here as wins and losses (`settle`) from the verifier's receipts. |
| `usage-tracker.cjs` | 626 | Usage accounting across every connected provider, pure data in and out. |
| `refresh-models.mjs` | 372 | CLI: refreshes `data/models.json` from the OpenCode Go roster and its other sources. |
| `openrouter-catalog.cjs` | | Reads and caches OpenRouter's public text-response model roster for the Settings picker; it does not edit the committed OpenCode Go catalog. |
| `measure-speed.mjs` | 74 | CLI: the optional local tokens-per-second probe. |

### Processes, paths and projects

| File | Lines | Purpose |
| --- | ---: | --- |
| `platform.cjs` | 150 | The one spawn every child goes through. Keeps call sites in their Windows shape (`cmd.exe`, `where.exe`, `taskkill`) and translates exactly those on Linux and macOS; withholds Studio's own credential variables from every child. |
| `windows-command-line.cjs` | 186 | Correct quoting for a `cmd.exe /d /s /c` line, ported from BetterC0de. The game launcher builds its line with it. |
| `projects.cjs` | 254 | Project identity and storage boundaries. |
| `project-preview.cjs` | | Local app preview detection, bounded loopback readiness, managed server lifetime, sanitized output and ownership-safe stop/reuse. Its process state is separate from executor jobs and verification. `main.cjs` supplies active-project evidence URLs and project/quit cleanup; `preload.cjs` exposes the preview controls. |
| `path-scope.cjs` · `paths.cjs` | 21 · 31 | Folder containment for scoping sessions; the source, workspace and game kept apart. |
| `machine.mjs` | 486 | Machine coordination: CPU and memory, test leases, the LÖVE process table. |
| `eyes.mjs` | 2,519 | The A-Eyes data layer, with two jobs: read-only reads of the live OpenCode session store, and the studio's own board store, which it writes (`readJson`/`writeJson` for the `data/*.json` stores, and the optional read-write SQLite board authority with its schema migration). |
| `eyes-worker.mjs` · `eyes-client.cjs` | 49 · 207 | Host `eyes.mjs` on a worker thread, so its synchronous SQLite reads never block the main process. |
| `project-work.cjs` | 371 | Work that already exists in an open folder, read from the engineering-skills conventions. |

### Planning, analysis and first run

| File | Lines | Purpose |
| --- | ---: | --- |
| `planning.cjs` · `planning-service.cjs` | | Decision planning and read-only live drafting, kept apart from board work until a specification is approved. Live exploration uses the Analyzer's bounded file inventory and returns proposals without writing the plan journal. |
| `analyzer.mjs` · `reference.mjs` | 588 · 188 | Local analysis of a file or an idea; exact context gathered before something becomes a task. |
| `first-scan.mjs` · `first-map.mjs` · `first-run-service.mjs` · `setup-assist.mjs` | 510 · 228 · 328 · 121 | The first-run scan of the machine, the first map of a folder, the service behind the walkthrough's stops, and the setup assistant. |
| `auditor.mjs` | 224 | Local wiring and gap checks, with no network and no key. |

### Policy Lab

`policy.mjs` (the policy contract), `policy-gates.mjs` (hard gates, lifecycle
and promotion), `policy-lab.mjs` (offline evaluation), `replay.mjs`
(recorded-tree replay), `experience.mjs` (the append-only experience store) and
`receipts.mjs` (the studio's own verification receipts, as opposed to a
worker's claim).

### Renderer support and diagnostics

| File | Lines | Purpose |
| --- | ---: | --- |
| `renderer-recovery.cjs` | 168 | Recovers a renderer that died while its window and tray stayed alive. |
| `assistant-push.cjs` | 63 | What one `eyes:assistant` push carries: once the page's bridge listens, state keys it already holds ride as `same` references by content, and `preload.cjs` puts its kept copies back. |
| `performance-profiler.cjs` | 251 | Opt-in, in-memory host diagnostics. |
| `music-recommendations.cjs` | 58 | Validates a mood request and parses a model's music suggestions. |

### The community link

The Void Engine Discord login behind the members' Void collection. The host
side is the "Discord community link" block and the `// ---- Community ----`
handlers in `main.cjs`. See [community.md](community.md).

| File | Lines | Purpose |
| --- | ---: | --- |
| `community.cjs` | 437 | Pure rules: the Void Engine ids, the fork switch `SELF_UNLOCKED`, the weekly card's cadence, when a linked account is re-checked, what a check result means, entitlement with its 14-day offline grace, the Discord link allow-list, PKCE and the public status. No Electron, filesystem or network, and time is injectable. `module_purity.test.mjs` holds it to that; `community_rules.test.mjs` pins the rules. |
| `discord-oauth.cjs` | 408 | The network half: the OAuth2 PKCE login through a one-shot `127.0.0.1` loopback redirect, the secret-less token exchange, refresh, the membership read and revoke. Every POST the feature makes lives here, and everything it reaches for is injectable. `discord_oauth.test.mjs` runs a real loopback against a fake Discord. |
| `hub-client.cjs` | 452 | The Void Engine rooms hub client (the bot repository's docs/protocol.md): trades the Discord access token for a hub session, keeps one WebSocket with backoff, renewal and presence, and carries Listen together's `listen` frames and the opt-in `nowPlaying` share. Everything network is injected; main's "Rooms hub" block owns the one client. |

### Build, checks and release (CLIs)

`build-booklet.mjs` inlines the renderer into `renderer/booklet.html`.
`check-syntax.mjs`, `check-targets.mjs`, `check-css.mjs`,
`spec-collisions.mjs` and `check-testruns.mjs` make up `npm run check`;
`run-node-tests.mjs` is the test runner. `append-testruns-row.mjs` is the
write-side companion to the `check-testruns.mjs` gate: it lands a new row at
the true top of the live region (the dated rows above the `## Read Before Any
Tests` anchor — the archive below that anchor is frozen), under a
cross-process lock with a re-verified atomic write. `rotate-testruns.mjs` is
the third piece: past 20 live rows it moves the oldest, whole and verbatim,
into `docs/archive/testruns-YYYY-MM.md`, and the append helper runs it after
every append. `serve.mjs` serves `npm run start:web`.
`package-portable.mjs`, `package-release.mjs` and `make-icon.mjs` build
releases, while `updater.mjs` (live source updates) and `release-updater.mjs`
(GitHub releases) keep installed copies current.

## `renderer/` — classic scripts inlined into one HTML file

`npm run build-booklet` inlines every script and stylesheet here, and the model
catalog, into `booklet.template.html` to produce `renderer/booklet.html`. The
built file is committed, and it is what the app loads. The scripts share `window.Mefi*` namespaces and use no
imports.

| File | Lines | Purpose |
| --- | ---: | --- |
| `node-visuals.js` | 150 | `window.MefiNodeVisuals`: shared graph palette, bounded per-canvas finish and text caches, and node-rim connection endpoints. |
| `idle.js` | 10,560 | The Command view: the 3D node constellation that is also the menu, and the same tree drawn as scenery behind Home's frosted panels. Its costs are in [performance.md](performance.md). |
| `brains.js` | 3,777 | The brain-map editor over the data `scripts/brains.cjs` validates. |
| `agent-brain.js` | 1,410 | `window.MefiAgentBrain`, `MefiHub` and `MefiCompanion`: the Agent brain sheet (`J`: a task's pipeline drawn from work events, the Playbook shelf, the project map, the seats), the map hub on Home, and the companion orb and panel in the menu foot. |
| `project-map-view.js` | | `window.MefiProjectMap`: the project explorer's contents/search, filters, history, selection, minimap, pointer and keyboard navigation, camera easing and level transitions. Uses the map data and shared isometric painter supplied by `agent-brain.js`; styles live in `agent-brain.css`. |
| `nav.js` | 2,133 | The navigation registry behind Home/Work/Live/Models, New task, project-scoped recent tasks, the local view row, workspace-page presentation, Search, Help and shortcuts. Historical destination IDs resolve here. |
| `tree3d.js` | 2,151 | The 3D task-tree rail. |
| `tasks.js` | 1,571 | The task board, per-task logs and ideas, and the reference menu. |
| `explorer.js` | 1,430 | Sessions: session list/detail with Assistant, Activity and Diagnostics tabs. |
| `booklet.js` | 1,318 | The expandable model catalog, filters, seven-category Settings navigation and control search, the studio launcher and the boot sequence. |
| `music.js` | 1,291 | Appearance controls in Settings and the optional canvas preview; the separate audio dropdown (`openAudio` / `toggleAudio`) owns local music, radio, Links, connection setup, reactions and recommendations. Includes colour themes, node styles and layouts, the members' Void collection (gated by `MefiCommunity`) and media parsing (`MefiMusic.playLink` / `linkInfo` for other modules). |
| `media-window.js` | | The Links player's persistent floating surface: pointer and keyboard move/resize, viewport bounds, hover controls, minimize, saved geometry, and a single dodge in menus that yields to intentional interaction. Bundled before `music.js`; styling lives in `music.css`. |
| `workspace.js` | | The home screen: project context, bottom composer, compact current-task summary, Activity panel, scoped start/resume, app preview controls and durable results. Task presentation comes from the shared helpers in `tasks.js`; selected task identity comes from `nav.js`. |
| `planning.js` | | The plan interview, live writing partner and file tree, editable suggestions, Enter field navigation, and reviewed task handoffs. |
| `onboarding.js` | 692 | The resumable *Start here* walkthrough. |
| `community.js` | 726 | `window.MefiCommunity`: the perk gate the Style pickers ask (`has`, with a boot hint so a member's theme does not flash), the quiet weekly community card, General's Community disclosure, the in-place explanation of a locked item, and the Community action in Help and Search. It sees only the public status from main, never a token. Bundled after `music.js` and before `booklet.js`. |
| `together.js` | 463 | `window.MefiTogether`: Listen together and the now-playing share, drawn into the Links panel (`MefiMusic.togetherHost`). It picks a room, follows its shared player (a file to the second, YouTube/Vimeo/SoundCloud through their postMessage APIs, Spotify by loading the same link) and sends the share only when the member turns it on. Talks to main only through `hub*` on the bridge. Bundled after `music.js`. |
| `camera-tour.js` | | `window.MefiCameraTour`: Zen's branch tour through `idle.js.setDirector`, plus automatic Overview's bounded pan/scale lens. Uses painted layout anchors and the real canvas projection; the overview lens fits every branch without moving anchors. The tour's `velocity()` carries pan, zoom and tilt into the glide home. Bundled right after `idle.js`. |
| `demo-panel.js` | 507 | `window.MefiDemoPanel`: the owner-only demo mode for streams. It does nothing unless that machine's `settings.ui.demoPanel` is `true`, which no Settings control writes. With it on, a card drops out of Command's Work tab every three minutes: what Studio is, how it works, how to get it, the Discord. It sits in its own fixed layer so the tree never refits. Ctrl Alt Shift D turns demo mode on and off; Ctrl Alt Shift F is Zen now (`MefiIdle.enterZen`). Bundled after `community.js`. |
| `analyzer.js` · `tracker.js` · `eyes.js` · `palette.js` · `graph.js` · `ideas.js` · `overhead.js` | 532 · 512 · 493 · 456 · 441 · 425 · 333 | Analyzer, usage tracker (Command's Usage popover and Models › Usage › Provider accounts; its host readers live in `main.cjs` from `const ACCOUNT_READ_TIMEOUT_MS` to `usageAccounts`, its parsers in `scripts/usage-tracker.cjs`), Activity and its evidence inspector, Search, Catalog insights, Ideas and Overhead. |
| `boot.js` · `model-lab.js` · `profiler.js` · `task-groups.js` · `startup.js` · `performance-core.js` · `sidebar.js` · `stage-labels.js` | 264 · 253 · 184 · 182 · 130 · 108 · 98 · 36 | Startup readiness, Model Lab, the live profiler, read-only task grouping, the launch screen, bounded measurements, the project menu, and one vocabulary for task badges. |

Five stylesheets are inlined, in this order, so a later one wins a tie with
an earlier one:

| File | Lines | Purpose |
| --- | ---: | --- |
| `styles.css` | 3,980 | The Club Blackout theme: its tokens and most surfaces. Its section order is load-bearing, as its header explains. |
| `music.css` | 218 | The music room, plus the theme tokens that also colour Command and the boards. |
| `planning.css` · `brains.css` · `profiler.css` · `agent-brain.css` | 151 · 426 · 40 · 138 | The Plans sheet, the brain-map editor, the profiler overlay, and the Agent brain surfaces (sheet, Home hub, companion). |

`npm run check` runs `check-css.mjs --unused` over all five, and `--merge`
over `styles.css` while a merge is in progress (see
[CONTRIBUTING.md](../CONTRIBUTING.md)).

## `data/` — local state, never published

Only `data/curated.json` and `data/models.json` are tracked; everything else is
the owner's and stays out of Git and out of packages (see
[AGENTS.md](../AGENTS.md)). `projects.dataPath` puts each project's stores
under `data/projects/<id>/` — its board is `eyes-tasks.json` there, and
`contextHistory` is most of that file's size — except for one hidden legacy
project, which owns the top-level `data/eyes-*.json` files so data written
before projects existed stays reachable. Alongside sit the inbox
(`eyes-requests.json`), ideas, checkpoints, chat, pins and briefing
(`eyes-*.json`), the durable executor log (`executor-log.jsonl`) and the Policy
Lab's receipts (`policy-lab/`). An optional SQLite authority for the board is
kept outside the synced tree (`MEFI_STUDIO_BOARD_DB`); when it is on, every
commit rewrites the JSON view as well.

## Tests and tools

- **`tests/*.test.mjs`** (about 210 files) run on Node's own `node:test` and
  `node:assert/strict`, with no test dependencies. `scripts/run-node-tests.mjs`
  is the runner; `npm run test:fast` skips the real-Electron suites and the
  Python stage.
- **Many suites never import `main.cjs`.** They read it, slice a named section
  between two literal marker strings, and evaluate the slice in a `vm` sandbox
  whose collaborators are stubs. So a new identifier used inside a sliced
  section needs a stub in every suite that slices that section, and moving a
  marker breaks a suite in a way that can look like flake.
- **`tests/fixtures/`** holds the Electron fixtures (`*-electron.cjs`), fake
  bridges, the executor host harness and replay data.
- **Structure tests** hold the tree to rules rather than behaviour:
  `module_purity.test.mjs` (a module that promises in its header to touch no
  filesystem, network or clock is held to it), `spec_collisions.test.mjs` and
  `check_targets.test.mjs`.
- **The menus and the window** are pinned by `app_rail.test.mjs` (the menu's
  sections and foot, `RAIL_SLOTS`, its arrow keys, the 1100px pin and
  `Ctrl ,`), `settings_nav.test.mjs` (Settings' Find field, groups, jumps,
  deep links and Search entries), `command_toolbar.test.mjs` (the Command
  toolbar's groups, View ▾ and Ambience) and `main_window_guards.test.mjs`
  (the 600×560 minimum and the window's navigation guards).
- **The community link** has five: `community_rules`, `discord_oauth`,
  `community_host`, `community_bridge` and `community_ui` (each `.test.mjs`)
  cover the rules, a real loopback login against a fake Discord, the
  `main.cjs` block in a `vm` slice, the preload pairs, and the renderer's
  card, gates and Settings › Community.
- **`tools/test_mefi_studio_*.py`** (22 files) are contract tests that pin
  source text and function bodies in `main.cjs` and the renderer; `npm test`
  runs them after the Node suites.
- **`tools/verify_*.py`** and `tools/verify_dev_app.mjs` are verification
  harnesses, not unit tests. `tools/monitor_loop.mjs` runs the real agent loop
  against a virtual clock, and `tools/profile_studio.mjs` replays renderer
  workloads.

## Where to look when…

- **a model call misbehaves:** `assistantFetch` → `httpAssistantCall` →
  `chatCompletion` in `main.cjs`, with routing in `resolveAiRoute` and the
  pause logic in `scripts/provider-breaker.cjs`.
- **a worker run stalls or reports the wrong result:** `spawnNextJob`, `wire()`
  and `finish()` in `main.cjs`, and the decisions they hand to
  `scripts/executor-core.cjs` (`tests/executor_core.test.mjs` pins them;
  `tests/executor_fallback_ledger.test.mjs` drives the real finish, fallback
  and watchdog); [agent-loop.md](agent-loop.md) walks the path.
- **a board write is slow or wrong:** the gateway (`mutateBoard`) in
  `main.cjs`, `scripts/task-context.cjs`, and `tests/board_gateway.test.mjs`.
- **a child gets the wrong command line or environment:**
  `scripts/platform.cjs` and `scripts/windows-command-line.cjs`.
- **a control in the UI:** its destination in `renderer/nav.js`, then the
  owning `renderer/*.js` and `booklet.template.html`; rebuild the booklet.
- **the Discord link or a Void collection lock misbehaves:**
  `scripts/community.cjs` (the rules) and `scripts/discord-oauth.cjs` (the
  network). Then the "Discord community link" block in `main.cjs`, and
  `renderer/community.js`. Last, the premium branches of `applyTheme` and
  `applyNodeStyle` in `renderer/music.js`. [community.md](community.md) walks
  the flow.
- **something only the running app shows:** the recipes in
  [performance.md](performance.md) and `tools/profile_studio.mjs`.
