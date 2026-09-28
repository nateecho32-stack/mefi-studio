# Code map

- `renderer/autonomy-ui.js`: shared permission controls, elevated warnings,
  decision learning, model-strength views and the Why/Undo/For you panel.
- `tests/autonomy_ui.test.mjs`: saved controls, warnings, learning scopes,
  scoped history actions and failed saves. `vibe_pipeline` also exercises
  one-line suggestions, item-bound errors and unread IDs beyond sixty replies.
- `tests/autonomy_render.test.mjs` / `tests/fixtures/autonomy-ui-electron.cjs`:
  isolated 1920x1080 Chromium proof of saved modes, Undo/to-dos, suggestions,
  inline chat, elevated warnings and orb-to-drawer focus restoration.

## Permission decisions

- `scripts/task-oversight.cjs`: mode-aware chat gates, local answer/Undo intent,
  scope-sensitive inbox identities and decision context packing.
- `main.cjs`: `assistantDecisionContext` is shared by the desk and chat;
  chat approvals carry the shown scope and inbox starts use targeted promotion.
- `tests/chat_decisions.test.mjs`: permission gates, scoped inbox identity,
  bounded shared context and outer companion provider readiness.

- `scripts/decision-memory.cjs`: pure recency weighting, doubled corrections,
  scoped preference advice, confidence adjustment and selective forgetting.
- `scripts/model-learning.cjs`: pure aggregation of existing local model ledgers,
  weighted Beta records and per-task model skill summaries.
- `scripts/model-performance.cjs`: observations retain project identity; cached
  snapshots and `taskSkills` support a project filter.
- `scripts/autonomy.cjs`: pure mode table, elevated categories, approval inheritance
  (`accepted`) and the owner's-work lineage the Auto gate follows (`ownerWork`),
  settings migration and exact-attempt sessionless check eligibility.
- `scripts/autonomy-host.cjs`: one desk decision pass, persisted suggestions and
  budgets, decision reservations, interruption recovery, to-dos and notices.
- `scripts/decision-ledger.cjs`: bounded decision rows and conflict-aware Undo
  that preserves later edits and never refunds automatic retry budgets.
- `main.cjs` / `preload.cjs`: `autonomy:state`, `autonomy:set`, `autonomy:undo`
  and `autonomy:todo`; the same approval predicate reaches every dispatch gate.

## Unified Studio ownership

- `renderer/file-inputs.js`: shared bounded UTF-8 file drops and picker imports into editable drafts, with project/surface guards; wired by Home, Vibe and Plans.

- `scripts/agent-tools.cjs`, `agent-mcp.cjs`: per-role tool policies, bounded research turns, public web search, scoped file reads and the stdio MCP client.
- `scripts/agent-tool-configs.cjs`, `agent-tools-mcp.cjs`: captured per-run tool attachments and the coding worker MCP adapter.

- `renderer/agents.js` / `agents.css`: the Agents workspace, relocated setup controls, scoped drafts, presets and shared operational state.
- `scripts/agent-addons.cjs` / `agent-models.cjs`: per-agent local skill discovery and prompt attachment, plus read-only provider model rosters with credentials kept in the host.
- `renderer/studio-ui.js` / `studio-ui.css`: scrollbar-free overflow, accessible dropdowns, shared appearance presets and shared glass surface recipes. The stylesheet follows the base page styles; component styles retain their layout and semantic status colours.
- `renderer/companion-ui.js` / `companion-ui.css`: the stable adaptive companion panel, hover ownership, dragging, pinning and safe edge roaming.
- `renderer/companion-hub.js` / `companion-hub.css`: the shared glowing wisp, ASCII reactions (a plain check without faces), bounded particle bursts, thinking state, petting, idle play and dozing, setup companion, and the accessible glass bubble menu (Talk, What I'm doing, Needs you, Suggest work, Friends, Personality); reuses existing chat, requests, inbox, backlog picks, room connections and audio-link state.
- `renderer/companion-friends.js`: `window.MefiCompanionFriends`, Friends › Playground: friends' companions out in your rooms, scripted playdates (and Practice with Pip), per-friend and per-room sharing, the share-back ask and What was sent. Everything comes from main's "Companion friends" block through `hubFriends`, `hubSharingSet` and `hubPlaydate`. Bundled after `pc-sync.js`.
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
| `outside-work.cjs` | 771 | Work done outside Studio: git log/status parsing, the saved "last look", the report of commits, uncommitted edits and outside agent sessions since it (reading Claude Code and Codex transcript heads), the keyless answer to "what changed while I was away?", each queued card's evidence and relevance stamp (`holdState`, which `backlog.workState` reads), the model check's prompt and checked verdicts, the Ask card, and the worker's `briefLine`. Pure; the host is main.cjs's "work done outside Studio" block. See [agent-loop.md §14](agent-loop.md#14-work-done-outside-studio). |
| `habits.cjs` | 90 | Habits: the library of short behaviour rules (variants, off / brief / full), each one's prompt line and token cost, a role's habits block and the check for `settings.agentHabits`. Pure; `agent-addons.cjs` adds the block wherever a role's skills go. |
| `trace.cjs` | 134 | Trace's rules: bounded rings for the lines the host keeps (the studio log, the window's warnings), how a line's level and source are read, each channel's rows in one shape, and the filter/tail query. Pure; `main.cjs` `trace:channels` / `trace:read` feed and serve it. |
| `task-attempts.cjs` | 86 | A task's attempt history (start, fallback, finish, release) grouped by `runId` from `data/executor-log.jsonl`, for the task detail's Attempts fold and the Explorer/A-Eyes "Open task" links. Pure; read-only. |
| `task-delegation.cjs` | 224 | Splits an owned task into durable slices, and (`admitIntake`) puts a sized request's steps under the owner's card when it is admitted. Pure, and runs inside the board gateway. |
| `request-sizing.cjs` | 124 | "Mefi sizes it": the quick look that keeps small asks to one card, the lead seat's breakdown prompt, and the checked reading of its 2–6 steps. Pure. |
| `task-handoffs.cjs` | 129 | Durable work handed on by a finished attempt; transforms board records and never runs a worker. |
| `task-history.mjs` | 126 | Moves inbox rows an older build left mid-run onto the task path, since only tasks run now: a lost "running" claim back to the inbox for promotion, a "verifying" row onto the board as an awaiting_verification task. Pure; housekeeping calls it under the board lock. |
| `backlog.cjs` | 310 | One eligibility vocabulary shared by dispatch and the workbench. Reading a backlog never changes work. `retryTask` is the owner's Try again (lifts every brake); `delegateRetry` is a re-arm made for the owner by the desk or the assistant: it never lifts the owner's stop, keeps the loop ledger, duplicate link and approval, leaves a parked card two failures from parking again, and spends a per-card daily budget kept on the card (`assistantRetries`). |
| `board-growth.cjs` | 51 | Bounds speculative discovery against the durable board. |
| `board-grouping.cjs` · `group-board.mjs` | 65 · 97 | Reviewed group requests applied inside the host's board transaction; offline grouping as a CLI. |
| `work-admission.cjs` | 287 | The one admission path for new work: the Unicode-aware title key (`compactKey` delegates to it), the `isOpenWork` predicate, the task-row skeleton (with its `origin`, which the worth band reads), and `represented()` / `admitTask()`, one ladder of identity, then brief, then title key that chat, the composer, Work on it, splits, the filers, promotion, handoffs, delegation, plans and ideas all run. Pure; `now` and ids are injected. |
| `chat-work.cjs` | 177 | Chat admission: compares the whole obligation before a card is created. The brief rung of `work-admission.cjs`'s ladder. |
| `task-oversight.cjs` | 1,571 | The chat assistant as overseer: the ranked board digest it reads, per-task lifecycle events for the thread (and the "needs you" roll-up), its JSON reply parsed into actions, and the gate that runs only what the owner plainly asked for on a plainly named card and turns the rest into Ask cards. Pure; time is injected. See [agent-loop.md §11](agent-loop.md#11-the-assistant-as-overseer). |
| `agent-issues.cjs` | 746 | The one shape an agent uses to say "this needs a decision", and the rules that either answer it or file it in Ask. A question records who raised it (`context.raisedBy`: worker, host or desk); a desk hand-off is never settled automatically. |
| `agent-modes.cjs` | 174 | Swarm and cluster selection and their advisory prompts. |
| `brains.cjs` | 933 | Brain maps: the pipeline as a graph you can open, rewire and save. See [brain-maps.md](brain-maps.md). |
| `executor-core.cjs` | 644 | The executor's decisions, lifted out of `spawnNextJob`: which ready card runs next and why nothing does, the worker's prompt (budgeted against `EXECUTOR_PROMPT_MAX`, the sentinel tail first), the command line per builder CLI, what one line of worker output says, how a run ended (`classifyRunEnd`: the settle branch and the infrastructure rule), what the model ledger records for it (`attemptLedgerOutcome`: a loss only for the model's own failure), the card's settle state machine (`settleAttemptRow`) with its backoffs, the start budget, and the attempt's records. Pure: no Electron, filesystem, network, processes, timers or clock reads; the host passes its helpers and constants in. `spawnNextJob` keeps the gates, the claim, the child and the writes. See [agent-loop.md §3-5](agent-loop.md#3-selection-and-claim-spawnnextjob). |
| `executor-resume.cjs` | 75 | Local recovery context for a run — never completion evidence. |
| `executor-activity.cjs` | | Bounded live worker output, credential and terminal-control filtering, route and current checklist step for Home and Command. Activity is never completion evidence. |
| `executor-worktrees.cjs` | 246 | A git worktree per run, so parallel runs stop contending on `.git/index`. |
| `context-manager.cjs` | 156 | Bounded context previews with token estimates. Reads no saved state and never changes the executor prompt. |
| `idea-actions.cjs` | 51 | Applies one UI intent to the latest board, so keeping an idea cannot overwrite a promotion, and an inbox add or remove (`eyes:requests-action`) cannot undo a claimed or promoted request. |
| `reconcile-board.mjs` · `reconcile-store-fork.mjs` | 247 · 157 | One-shot repairs, run with the app closed: board reconciliation, and the repo-versus-installed store fork. |
| `sync.mjs` | 250 | Multi-PC sync: keeps a checkout's default branch in step with GitHub (fetch, fast-forward, the project's own check, push without force, and a conflict-safe rebase on request) and lists what has not reached it yet, including what only this PC holds (`atRisk`). Behind `npm run sync`, the Claude Code SessionStart hook and main's "Multi-PC sync" block (`sync:*` channels, the background look and the question before closing). |
| `pc-setup.cjs` | 160 | Set up this PC: checks Git, the GitHub CLI, Node.js, the GitHub sign-in (account name only) and, for the open project, its GitHub remote, packages and drive type; opens a visible PowerShell window with Studio's fixed command for each gap; lists the account's repositories and clones a listed one into a folder main's dialog picked (never exFAT/FAT). Behind main's app-wide `pc-setup:*` channels. |
| `vault-crypto.cjs` | 104 | The Your PCs vault's sealing: a 32-byte key, its pairing code (Crockford base32 with a checksum, canonical form only) and fingerprint, and AES-256-GCM seal/open with the file's path as associated data, so a file moved, edited or sealed with another key does not open. Pure. |
| `share-review.cjs` | 116 | What Studio checks before anything leaves for another PC or a friend, and again when it arrives: `scan` (keys, tokens, passwords, logins in links as blocks; paths, emails, addresses and this PC's names as warnings; instructions aimed at an agent, downloaded scripts, encoded commands, paste and webhook hosts and hidden characters as blocks) and `scrub` over `redaction.cjs`. Pure. |
| `pc-vault.cjs` | 255 | The Your PCs vault: one private `<account>/mefi-studio-vault` repository, a plain manifest (format and key fingerprint), each PC's sealed status line, the shelves (reviewed and, where marked, scrubbed going in; reviewed again coming out, failures quarantined), keys behind the exact confirmation, pairing and unpairing. git, gh, the files, the keystore and the clock are injected. |
| `vault-shelves.cjs` | 227 | What each vault shelf offers from Studio's stores (model win/loss counts, decisions without their project, team presets, brains, recipes and memory notes keyed by repository, portable preferences, open work as ideas) and the plan for a received item: added beside what is here under a name that says where it came from, never overwriting; plus the library of kept items that main feeds into model learning and decision preferences. Pure. |

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
| `desk-resolve.cjs` | 209 | The desk handles asks (`agentBrain.deskResolves`): which open asks and parked cards the companion may settle on the desk seat, the prompt, the reply checked against the offered options, and the per-card and hourly budgets. Permission, risk and owner-only asks, grant/proceed/acknowledge answers, and questions the desk itself handed on, always stay with the owner. Pure. |
| `desk.cjs` | 231 | The desk worker's protocol: `MEFI_HELP` lines, its prompt and answer parsing, repeat folding and the note written for the next worker. Pure. |
| `companion.cjs` | 326 | The companion's state (greeting, working, needs you, resting), the welcome-back digest, the needs-you queue and the preferences it learns from answers. Pure. |
| `companion-pet.cjs` | 109 | The companion as a pet: the three personalities and the switches each presets (faces, idle play, roaming), and the bond (days together, pets at most one per few seconds, playdates). `agent-brain-host.cjs` keeps them in `companion.json`; main passes the personality to chat as `ui.personality`. Pure. |
| `companion-friends.cjs` | 466 | What a companion may tell friends' companions: the five sharing levels, rules for everyone, a room or a friend (this session or always) and how they resolve, the room broadcast level, the card built from named fields with secrets scrubbed, reading a friend's card, the share-back ask, and the scripted, mirrored playdates. Main's "Companion friends" block owns the I/O. Pure. |
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
| `new-app.cjs` | 47 | Vibe's New app: the folder name and place (by default ~/Mefi Apps), never inside Studio's own repository, and the starter README. Pure; `main.cjs` `projects:create` writes it. |
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
| `cli-setup.cjs` · `cli-text.cjs` | | Guided vendor installation/sign-in, single-subscription configuration, and restricted CLI text sessions for mapping, planning and agent roles. |
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

The optional Void Engine Discord login, which Listen together and the rooms
hub use (it unlocks nothing). The host side is the "Discord community link"
block and the `// ---- Community ----` handlers in `main.cjs`. See
[community.md](community.md).

| File | Lines | Purpose |
| --- | ---: | --- |
| `community.cjs` | 386 | Pure rules: the Void Engine ids, the weekly card's cadence (never shown to a member, `isMember`), when a linked account is re-checked, what a check result means, the Discord link allow-list, PKCE and the public status. No Electron, filesystem or network, and time is injectable. `module_purity.test.mjs` holds it to that; `community_rules.test.mjs` pins the rules. |
| `discord-oauth.cjs` | 408 | The network half: the OAuth2 PKCE login through a one-shot `127.0.0.1` loopback redirect, the secret-less token exchange, refresh, the membership read and revoke. Every POST the feature makes lives here, and everything it reaches for is injectable. `discord_oauth.test.mjs` runs a real loopback against a fake Discord. |
| `hub-client.cjs` | 479 | The Void Engine rooms hub client (the bot repository's docs/protocol.md): trades the Discord access token for a hub session, keeps one WebSocket with backoff, renewal and presence, and carries Listen together's `listen` frames, the opt-in `nowPlaying` share and, only to a hub whose `ready` lists the feature, `companion` cards (one-member delivery only with `companion.direct`). Everything network is injected; main's "Rooms hub" block owns the one client and hands companion frames to its "Companion friends" block. |

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
| `idle.js` | 10,560 | The Command view: the 3D node constellation that is also the menu, and the same tree drawn as scenery behind Home's frosted panels. Transfers supported drawing contexts to OffscreenCanvas; `MefiIdle.canvasContext(element)` exposes the actual paint target for diagnostics. Its costs are in [performance.md](performance.md). |
| `node-styles.js` | 5,303 | `window.MefiNodeStyles`: the node-style painters the Command view and the tree rail share (the eight looks, their motion records, detail tiers and theme tones, and the overlay and wire hooks each style may take over). Bundled before `tree3d.js`, which with `idle.js` falls back to a plain disc when it is absent. |
| `brains.js` | 3,777 | The brain-map editor over the data `scripts/brains.cjs` validates. |
| `agent-brain.js` | 1,410 | `window.MefiAgentBrain`, `MefiHub` and `MefiCompanion`: the Agent brain sheet (`J`: a task's pipeline drawn from work events, the Playbook shelf, the project map, the seats), the map hub on Home, and the companion orb and panel in the menu foot. |
| `project-map-view.js` | | `window.MefiProjectMap`: connected system cards and the expandable Ideas tree, plus contents/search, filters, history, selection, minimap, pointer and keyboard navigation, camera easing and level transitions. Uses the map and work projection supplied by `agent-brain.js`; styles live in `agent-brain.css`. |
| `nav.js` | 2,133 | The navigation registry behind Home/Work/Live/Models, New task, project-scoped recent tasks, the local view row, workspace-page presentation, Search, Help and shortcuts. Historical destination IDs resolve here. |
| `tree3d.js` | 2,290 | The 3D task-tree rail. |
| `tasks.js` | 1,571 | The task board, per-task logs and ideas, and the reference menu. |
| `explorer.js` | 1,430 | Sessions: session list/detail with Assistant, Activity and Diagnostics tabs. |
| `booklet.js` | 1,318 | The expandable model catalog, filters, seven-category Settings navigation and control search, the studio launcher and the boot sequence. |
| `music.js` | | Appearance controls in Settings and the optional canvas preview; the hover/click audio dropdown (`openAudio` / `toggleAudio`) owns local music, radio, Links, connection setup, reactions and recommendations. Includes saved URL visibility and copied-link offers through the focused-main-frame-only `scripts/media-clipboard.cjs` helper. Also owns colour themes, node styles and layouts (the two-tone Void collection among them, free like the rest; a choice left in the retired `mefiStudio.music.premium.v1` store is migrated at load) and media parsing (`MefiMusic.playLink` / `linkInfo` for other modules). |
| `tree-dynamics.js` | | Shared saved tree modes and controls, bounded live shape transforms, count-aware sizing, music deformation and stable dark/bright video-region selection. Loaded before `idle.js`; transforms painted positions before wires, labels and hit targets. Also owns independent node/line brightness paint passes, enable switches and optional contrasting node outlines. Controls synchronize across Appearance, Audio reactions and the media window's brightness section. |
| `media-window.js` | | The Links player's persistent floating surface: pointer and keyboard move/resize, viewport bounds, a local window toolbar and visible minimized restore bar, background/transparency settings in the media menu, stable dark-area tree placement, task-completion fades and notifications, saved geometry, and opt-in pointer avoidance. Docked drags preserve the visible starting geometry. Bundled before `music.js`; styling lives in `music.css`. Host helpers `scripts/media-scene.cjs` return brightness scores only; `scripts/youtube-explorer.cjs` provides bounded public YouTube search results to the explorer in `music.js`, which also records recent playback position. |
| `workspace.js` | | The home screen: project context, bottom composer, compact current-task summary, Activity panel, scoped start/resume, app preview controls and durable results. Task presentation comes from the shared helpers in `tasks.js`; selected task identity comes from `nav.js`. |
| `vibe.js` / `vibe.css` | | `window.MefiVibe`: Vibe, the calm front door (one box to talk or build, cards that show only while they have something: Needs you / Building now / Freshly done / Fresh ideas, and a dock whose Watch, Plans and Ideas stops come and go), the Vibe / Build switch and the one-time "what's new" card. In Vibe mode it also owns `#vibe-rail`, the frame every other page opens inside, in place of Build's menu. |
| `vibe-panels.js` | | `window.MefiVibePanels`: Vibe's menus, including the Tasks List/Lanes board, queue controls and revision-aware Inspector. Tasks, Plans, Ideas, Team and Settings as compact panels in `#vibe-panel`, fed by what `vibe.js` already holds; a row opens its detail, Full view opens the Build page inside Vibe's rail. |
| `planning.js` | | The plan interview, live writing partner and file tree, editable suggestions, Enter field navigation, and reviewed task handoffs. |
| `onboarding.js` | 815 | The resumable *Start here* walkthrough. It starts at Your workspace when the setup helper already connected an AI, and switches Vibe to Build before pointing at Home's controls. |
| `setup-helper.js` / `setup-helper.css` | 1169 | `window.MefiSetupHelper`: one sheet for every agent setting (connections, team and models, routing, how work runs, permissions, tools, machine, look). Opens before the walkthrough on a new profile and once per `REVISION` after an update; saves only through existing host calls (`agents:save` for the team, key, routing and CLI setup calls, `MefiAgentControls`, `assistant:prefs`, `machine:set`, `jev:*`, `prefs:set`). Registers the `setup-helper` sheet and a Search entry per section. Bundled after `agents.js`. |
| `community.js` | 487 | `window.MefiCommunity`: the quiet weekly community card, General's Community disclosure, and the Community action in Help and Search; `mefi-community-status` tells Listen together when the link changes. It sees only the public status from main, never a token. Bundled after `music.js` and before `booklet.js`. |
| `together.js` | 463 | `window.MefiTogether`: Listen together and the now-playing share, drawn into the Links panel (`MefiMusic.togetherHost`). It picks a room, follows its shared player (a file to the second, YouTube/Vimeo/SoundCloud through their postMessage APIs, Spotify by loading the same link) and sends the share only when the member turns it on. Talks to main only through `hub*` on the bridge. Bundled after `music.js`. |
| `rooms.js` | 400 | `window.MefiRooms`: Friends › Rooms. Lists rooms with the one action each needs (open, ask to join, accept or decline an invite, cancel a request); has Requests and Invites tabs, making a room, and a room view with chat (text only, `<@id>` shown as @name), invite by member search, lock/unlock, close and leave. Everything goes through main's `hub:room` channel (`HUB_ROOM_METHODS`) plus `hubStatus`/`hubConnect`/`hubRooms`/`hubSubscribe`; the hub's refusal reasons read as plain sentences. `pending()` feeds the Friends badge. Bundled after `companion-friends.js`. |
| `pc-sync.js` | 150 | `window.MefiPcSync`: the Your PCs card that `companion-hub.js` mounts in Friends, and the count it badges the Friends bubble with. It shows this PC against GitHub and offers Sync this PC and, when both sides moved, Put my commits on top of GitHub's. Its wording comes from `scripts/sync.mjs` through `syncStatus`, `syncRun` and `onSyncEvent`. Its Set up this PC section (the `pcSetup*` bridge methods, `scripts/pc-setup.cjs`) checks nothing until opened. Bundled after `together.js`. |
| `pc-vault.js` | 403 | `window.MefiPcVault`: the two sharing sections in the Your PCs card. Share between my PCs (make or pair the vault, the pairing code on request, every PC's line, shelves with what Studio found, what the other PCs shared, the library, keys and setup behind the exact typed phrase) and Share with friends (preview then save a scrubbed `.mefishare`, or open one for review). Text only; key values never reach it. Bundled after `pc-sync.js`. |
| `camera-tour.js` | | `window.MefiCameraTour`: Zen's branch tour through `idle.js.setDirector`, plus automatic Overview's bounded pan/scale lens. Uses painted layout anchors and the real canvas projection; the overview lens fits every branch without moving anchors. The tour's `velocity()` carries pan, zoom and tilt into the glide home. Bundled right after `idle.js`. |
| `demo-panel.js` | 507 | `window.MefiDemoPanel`: the owner-only demo mode for streams. It does nothing unless that machine's `settings.ui.demoPanel` is `true`, which no Settings control writes. With it on, a card drops out of Command's Work tab every three minutes: what Studio is, how it works, how to get it, the Discord. It sits in its own fixed layer so the tree never refits. Ctrl Alt Shift D turns demo mode on and off; Ctrl Alt Shift F is Zen now (`MefiIdle.enterZen`). Bundled after `community.js`. |
| `config-dialog.js` / `config-dialog.css` | | `window.MefiConfig`: Configuration (Ctrl Shift ,), every `settings:*` record in one searchable tree under seven categories (by page, then by words), opening the real control; holds the interface scale (`ui:zoom`). |
| `motion.js` | | `window.MefiMotion`: motion for menus that rebuild their rows. `keep` (rows keyed by `data-key` stay still and glide, new ones cascade, leavers fade as ghosts), `swap` (a view change that fades through, sliding the way you went), `enter`, `glide` (a selection mark) and `tally` (a counting number). No-ops with motion off or without layout, so fake-DOM suites run without it. |
| `trace.js` / `trace.css` | | `window.MefiTrace`: the Trace sheet (Live, `trace`), Studio's logs as channels with search, tail, level and source chips, problems only, follow, copy and open file. |
| `analyzer.js` · `tracker.js` · `eyes.js` · `palette.js` · `graph.js` · `ideas.js` · `overhead.js` | 532 · 512 · 493 · 456 · 441 · 425 · 333 | Analyzer, usage tracker (Command's Usage popover and Models › Usage › Provider accounts; its host readers live in `main.cjs` from `const ACCOUNT_READ_TIMEOUT_MS` to `usageAccounts`, its parsers in `scripts/usage-tracker.cjs`), Activity and its evidence inspector, Search, Catalog insights, Ideas and Overhead. |
| `boot.js` · `model-lab.js` · `profiler.js` · `task-groups.js` · `startup.js` · `performance-core.js` · `sidebar.js` · `stage-labels.js` | 264 · 253 · 184 · 182 · 130 · 108 · 98 · 36 | Startup readiness, Model Lab, the live profiler, read-only task grouping, the launch screen, bounded measurements, the project menu, and one vocabulary for task badges. |

The bundled `media-browser.js` and `music.css` provide the browser toolbar,
welcome page and viewport inside the existing media player.
`scripts/media-browser.cjs` attaches a sandboxed WebContentsView to Studio's
existing window and owns its session, navigation and sender-checked IPC.
Its bounds follow the visible viewport as the panel scrolls, keeping website
controls inside the panel without reloading the page.
The main preload exposes controls only to Studio; websites have no preload.

Five stylesheets are inlined, in this order, so a later one wins a tie with
an earlier one:

| File | Lines | Purpose |
| --- | ---: | --- |
| `styles.css` | 3,980 | The Club Blackout theme: its tokens and most surfaces. Its section order is load-bearing, as its header explains. |
| `music.css` | | The music room, plus the theme tokens that also colour Command and the boards. |
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
(`eyes-*.json`), the durable executor log (`executor-log.jsonl`), each task
run's read-only context file (`task-runs/<runId>.json`) and the Policy
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
- `tools/profile_live_studio.mjs` captures bounded metrics and optional CPU
  samples from the running Studio through a PID-checked loopback inspector.
  `tools/profile_scroll_controls.cjs` compares scroll-control versions in an
  isolated renderer, including geometry and behavior parity.

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
- **the Discord link misbehaves:**
  `scripts/community.cjs` (the rules) and `scripts/discord-oauth.cjs` (the
  network). Then the "Discord community link" block in `main.cjs`, and
  `renderer/community.js`. [community.md](community.md) walks the flow.
- **something only the running app shows:** the recipes in
  [performance.md](performance.md) and `tools/profile_studio.mjs`.
