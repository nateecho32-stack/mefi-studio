# Code map

Where things live, folder by folder. [architecture.md](architecture.md) is the
feature walkthrough and glossary, and [agent-loop.md](agent-loop.md) follows a
chat message all the way to a verified task; this page answers the narrower
question *which file?*

Each purpose below is condensed from that file's own header comment, so when a
file's role changes, change its header first and this page after it. Line
counts were taken on 28 September 2026 and drift; they are here to show where
the weight is, not to be exact.

## Four runtimes

Paired repository checks use `scripts/paired-coordinator.cjs` (persistent queue,
registry, fences and progress archives), `paired-transport.cjs` (bounded worker
HTTP/HTTPS protocol), `paired-worker.cjs` (restart journal and exact-commit fixed
check runner), and `paired-worker-host.cjs` (lazy desktop consent and encrypted
pairing adapter). `renderer/pc-sync.js` owns the setup disclosure; `paired:*`
channels in main and preload bridge it. This is separate from coding agents.

| Runtime | Entry | Talks to the others through |
| --- | --- | --- |
| Electron main process | `main.cjs`, plus the `scripts/*.cjs` it requires | IPC through `preload.cjs`; child processes through `scripts/platform.cjs` |
| Renderer | `renderer/booklet.html`, built from `booklet.template.html` and every `renderer/*.js` and `.css` | `window.mefiStudio`, defined in `preload.cjs`, and nothing else |
| Store worker thread | `scripts/eyes-worker.mjs`, hosting `scripts/eyes.mjs` | `scripts/eyes-client.cjs`: one message and one promise per read |
| Child processes | builder CLIs (`opencode`, `claude`, `codex`, `grok`, `agy`), reply CLIs, `gh`, the game | a builder's stdout sentinels — `MEFI_JOB_DONE`, `MEFI_RESULT:`, `MEFI_NEXT:`, `MEFI_CALL:` — read by `wire()` in `main.cjs` through `readWorkerLine` in `scripts/executor-core.cjs` |

## Root

| File | Lines | Purpose |
| --- | ---: | --- |
| `main.cjs` | 21,976 | The Electron main process: the window, every IPC handler, the host's own model calls, the service loop, the executor, the board gateway (`mutateBoard`), verification, settings and the headless CLI flags. Much of it is tested by slicing named sections into `vm` sandboxes (see [Tests](#tests-and-tools)). |
| `preload.cjs` | 423 | The `contextBridge` surface, `window.mefiStudio`: the only boundary between renderer and main. `installBridge` builds it in the page's own world, so each push crosses the bridge once and every `on*` subscriber shares that copy. |
| `eslint.config.js` | 71 | Check-only lint: an undefined identifier is an error, an unused one a warning, and there are no style rules. |
| `package.json` | | `"type": "module"`, which is why [CONTRIBUTING.md](../CONTRIBUTING.md) sets a file-extension rule: `.cjs` for what `main.cjs` or `preload.cjs` requires, `.mjs` for what tests and other scripts import and for CLIs, `.js` only under `renderer/`. |

## `scripts/` - main-process modules and CLIs

GitHub update delivery reuses `release-updater.mjs` for stable discovery,
verified downloads, ZIP staging and the portable replacement helper.
`development-updater.mjs` admits successful main-build Actions artifacts and
verifies their provenance; `package-development.mjs` builds those artifacts
through the existing release packager without publishing a release. See
[Update channels](update-channels.md) for controls and trust boundaries.

### The loop and the board

| File | Lines | Purpose |
| --- | ---: | --- |
| `assistant.mjs` | 8,144 | The always-on assistant's logic — every role, state normalisation, tree organisation, housekeeping and `verifyCompletion` — as functions of their inputs and an explicit `now`. |
| `task-context.cjs` | 298 | Durable task revisions (`contextHistory`) and resumable briefs. Pure; callers persist the result under the board lock. |
| `outside-work.cjs` | 775 | Work done outside Studio: git log/status parsing, the saved "last look", the report of commits, uncommitted edits and outside agent sessions since it (reading Claude Code and Codex transcript heads), the keyless answer to "what changed while I was away?", each queued card's evidence and relevance stamp (`holdState`, which `backlog.workState` reads), the model check's prompt and checked verdicts, the Ask card, and the worker's `briefLine`. Pure; the host is main.cjs's "work done outside Studio" block. See [agent-loop.md §14](agent-loop.md#14-work-done-outside-studio). |
| `habits.cjs` | 90 | Habits: the library of short behaviour rules (variants, off / brief / full), each one's prompt line and token cost, a role's habits block and the check for `settings.agentHabits`. Pure; `agent-addons.cjs` adds the block wherever a role's skills go. |
| `trace.cjs` | 134 | Trace's rules: bounded rings for the lines the host keeps (the studio log, the window's warnings), how a line's level and source are read, each channel's rows in one shape, and the filter/tail query. Pure; `main.cjs` `trace:channels` / `trace:read` feed and serve it. |
| `task-attempts.cjs` | 86 | A task's attempt history (start, fallback, finish, release) grouped by `runId` from `data/executor-log.jsonl`, for the task detail's Attempts fold and the Explorer/A-Eyes "Open task" links. Pure; read-only. |
| `task-delegation.cjs` | 253 | Splits an owned task into durable slices, and (`admitIntake`) puts a sized request's steps under the owner's card when it is admitted. Pure, and runs inside the board gateway. |
| `request-sizing.cjs` | 124 | "Mefi sizes it": the quick look that keeps small asks to one card, the lead seat's breakdown prompt, and the checked reading of its 2–6 steps. Pure. |
| `task-handoffs.cjs` | 138 | Durable work handed on by a finished attempt; transforms board records and never runs a worker. |
| `task-history.mjs` | 165 | Moves inbox rows an older build left mid-run onto the task path, since only tasks run now: a lost "running" claim back to the inbox for promotion, a "verifying" row onto the board as an awaiting_verification task. Pure; housekeeping calls it under the board lock. |
| `backlog.cjs` | 383 | One eligibility vocabulary shared by dispatch and the workbench. Reading a backlog never changes work. `retryTask` is the owner's Try again (lifts every brake); `delegateRetry` is a re-arm made for the owner by the desk or the assistant: it never lifts the owner's stop, keeps the loop ledger, duplicate link and approval, leaves a parked card two failures from parking again, and spends a per-card daily budget kept on the card (`assistantRetries`). |
| `board-growth.cjs` | 53 | Bounds speculative discovery against the durable board. |
| `board-grouping.cjs` · `group-board.mjs` | 64 · 96 | Reviewed group requests applied inside the host's board transaction; offline grouping as a CLI. |
| `work-admission.cjs` | 287 | The one admission path for new work: the Unicode-aware title key (`compactKey` delegates to it), the `isOpenWork` predicate, the task-row skeleton (with its `origin`, which the worth band reads), and `represented()` / `admitTask()`, one ladder of identity, then brief, then title key that chat, the composer, Work on it, splits, the filers, promotion, handoffs, delegation, plans and ideas all run. Pure; `now` and ids are injected. |
| `chat-work.cjs` | 177 | Chat admission: compares the whole obligation before a card is created. The brief rung of `work-admission.cjs`'s ladder. |
| `task-oversight.cjs` | 2,007 | The chat assistant as overseer: the ranked board digest it reads, per-task lifecycle events for the thread (and the "needs you" roll-up), its JSON reply parsed into actions, and the gate that runs only what the owner plainly asked for on a plainly named card and turns the rest into Ask cards. Its chat gates follow the permission mode, and it reads a local answer or Undo, keys inbox identities by scope and packs the decision context. Pure; time is injected. See [agent-loop.md §11](agent-loop.md#11-the-assistant-as-overseer). |
| `agent-issues.cjs` | 784 | The one shape an agent uses to say "this needs a decision", and the rules that either answer it or file it in Ask. A question records who raised it (`context.raisedBy`: worker, host or desk); a desk hand-off is never settled automatically. |
| `agent-modes.cjs` | 173 | Swarm and cluster selection and their advisory prompts. |
| `brains.cjs` | 1,483 | Brain maps: the pipeline as a graph you can open, rewire and save. See [brain-maps.md](brain-maps.md). |
| `executor-core.cjs` | 776 | The executor's decisions, lifted out of `spawnNextJob`: which ready card runs next and why nothing does, the worker's prompt (budgeted against `EXECUTOR_PROMPT_MAX`, the sentinel tail first), the command line per builder CLI, what one line of worker output says, how a run ended (`classifyRunEnd`: the settle branch and the infrastructure rule), what the model ledger records for it (`attemptLedgerOutcome`: a loss only for the model's own failure), the card's settle state machine (`settleAttemptRow`) with its backoffs, the start budget, and the attempt's records. Pure: no Electron, filesystem, network, processes, timers or clock reads; the host passes its helpers and constants in. `spawnNextJob` keeps the gates, the claim, the child and the writes. See [agent-loop.md §3-5](agent-loop.md#3-selection-and-claim-spawnnextjob). |
| `codex-harness.cjs` | 725 | Codex workers over `codex app-server` (newline JSON-RPC on stdio) instead of `codex exec`, the default for Codex routes (the team setting `codexHarness`, `cliInvocation`'s `codexHarness: "app-server"`; main's spawnAttempt wraps the child and retries over exec on `START_FAILED`). `appServerInvocation` (pure) builds the launch and the session plan; `wrapChild` drives initialize → config/read → thread/start → turn/start behind a ChildProcess-shaped facade whose stdout/stderr carry the same plain lines the executor reads (whole agent messages, `$ <command>`, file changes, Codex's own error text). The run's MCP servers ride thread/start `config` (credentials included), the owner's own servers, plugins and ChatGPT apps are turned off for the thread, the `mefi_result`/`mefi_ask`/`mefi_next` tools echo their sentinel line, and `facade.codex` keeps token usage and the plan's rate limits. Shapes from codex-cli 0.154.0's `generate-ts --experimental`; `tests/codex_harness.test.mjs` replays a scripted server (`tests/fixtures/fake-codex-app-server.mjs`). |
| `executor-resume.cjs` | 128 | Local recovery context for a run — never completion evidence. |
| `executor-activity.cjs` | | Bounded live worker output, credential and terminal-control filtering, route and current checklist step for Home and Command. Activity is never completion evidence. |
| `executor-worktrees.cjs` | 261 | A git worktree per run, so parallel runs stop contending on `.git/index`. |
| `context-manager.cjs` | 155 | Bounded context previews with token estimates. Reads no saved state and never changes the executor prompt. |
| `idea-actions.cjs` | 95 | Applies one UI intent to the latest board, so keeping an idea cannot overwrite a promotion, and an inbox add or remove (`eyes:requests-action`) cannot undo a claimed or promoted request; also restores a deleted idea and adds one typed by the owner (source `owner`). |
| `board-trash.cjs` | 230 | Pure rules and store for Recently deleted: a delete keeps the whole record, who and when first (30 days, at most 50 per project, oldest dropped first); restore puts a card back after its old predecessor and never over one that is there again; a damaged file reads as empty with its bytes set aside, and a newer format is never overwritten. `main.cjs` "Board trash" owns the file (`data/projects/<id>/board-trash.json`, written atomically, before the board file). `MEFI_STUDIO_NO_BOARD_TRASH=1` gives the old delete-for-good back. |
| `reconcile-board.mjs` · `reconcile-store-fork.mjs` | 246 · 156 | One-shot repairs, run with the app closed: board reconciliation, and the repo-versus-installed store fork. |
| `sync.mjs` | 458 | Multi-PC sync: keeps a checkout's default branch in step with GitHub (fetch, fast-forward, the project's own check, push without force, and a conflict-safe rebase on request) and lists what has not reached it yet, including what only this PC holds (`atRisk`; a detached worktree's commits on no branch count too) and merges that left another branch's work out (`lostWork`: it refuses that push, and the hook and card only report it). Behind `npm run sync`, the Claude Code SessionStart hook and main's "Multi-PC sync" block (`sync:*` channels, the background look and the question before closing). In a shallow clone it fetches back until local and GitHub `main` can be compared and says "not compared" when they still cannot; branches built on `gh-pages` are listed as site branches, never as work to bring into `main`. |
| `worktrees.mjs` | 220 | The worktree table behind `npm run worktrees`: every git worktree of a project (primary checkout, task runs under `.mefi/worktrees`, dev worktrees, detached ones) with its branch, distance from the default branch, uncommitted and unpushed state and a verdict (`dirty`, `unpushed`, `on-github`, `missing`, `merged`) with what to do about it. Read-only; shares `runGit`, `changedFiles` and `defaultBranch` with `sync.mjs`. `--json` gives the same rows for Studio and hooks, and `inspectWorktree` looks at one worktree and the primary checkout for the actions below. |
| `worktree-actions.mjs` | 190 | What Studio may do to a worktree, kept apart from the read-only table: merge its branch into the default branch (fast-forward, or a merge commit when asked; refuses a dirty worktree, a dirty, wrong-branch or mid-merge main checkout and running agents, and undoes a conflicting merge), remove its folder (never the main checkout, a locked one or a run still working; uncommitted files or commits on no branch need `force` and are first kept as `refs/mefi/rescue/<name>-<time>`; the shared `node_modules` link goes as a link) and forget folders that are gone. Never pushes or fetches. A path is only used when git lists it. Behind main's `worktrees:*` channels. |
| `attempt-snapshots.cjs` · `attempt-snapshots-host.cjs` | 482 · 613 | Attempt review, part 1: a picture of the folder a builder works in at the start and end of every attempt (`refs/mefi/attempts/<task>/<n>/before|after`, built with a temporary index so the person's index, HEAD and files are never touched; local only, never pushed), the list of changed files with diffs on demand, Revert file and Revert attempt (only files that still hold what the attempt left; a safety picture first, so every revert has an Undo) and Accept (a record only). The pure module holds the ref names, parsing, the revert plan and its refusals; the host runs git. |
| `advisory-checks.cjs` · `advisory-checks-host.cjs` | 174 · 203 | Attempt review, part 2: finds a project's own typecheck, lint and build commands (package.json scripts, ruff, mypy, cargo check, go vet), runs them after an attempt through an allowlist with limits and a tree kill, and shows the result as advisory (it never blocks Done). Also the builder-only tools `run_check` and `project_logs`. |
| `attempt-evidence.cjs` · `attempt-evidence-host.cjs` · `evidence-window.cjs` | 182 · 234 · 96 | Attempt review, part 3: a before and after screenshot of the project's preview for each attempt, taken in a hidden, sandboxed, offscreen window that may only reach the preview's own localhost origin (15 s limit, 1280×800), kept under `<project data>/attempt-evidence/` (newest 10 attempts keep pictures). Never added to a problem report. |
| `review-prefs.cjs` | 61 | Pure: `settings.review` plus the three kill-switch variables (`MEFI_STUDIO_NO_ATTEMPT_SNAPSHOTS`, `MEFI_STUDIO_NO_ADVISORY_CHECKS`, `MEFI_STUDIO_NO_EVIDENCE_SHOTS`) into the effective choices and what is forced. |
| `alerts.cjs` · `alerts-host.cjs` · `badge-icon.cjs` | 297 · 343 · 137 | Windows alerts for what waits on you. The rules are pure: `decide(event, prefs, ctx)` returns notify, flash and badge for a question, approval, permission, failure or finished task (only when still waiting 20 s later, never while a Studio window is in front with someone at the PC, never in quiet hours, the same kind and task not twice in 15 min, at most 12 an hour, generic words unless titles are chosen), plus the quiet-hours helpers shared with the Discord remote. The host keeps the queue, takes one look at most every 10 s, shows the notification, routes a click to the task (`alerts:open`) and runs the test that waits for the owner to look away. `badge-icon.cjs` draws the numbered taskbar overlay icon (RGBA raster and a small PNG encoder, no canvas). `MEFI_STUDIO_NO_ALERTS=1` or the master switch turns it all off. |
| `crash-report.cjs` · `report-host.cjs` · `zip-lite.cjs` | 320 · 235 · 134 | Report a problem and the crash prompt. The rules are pure: the bundle's files, the redaction (keys, home folders, PC and user names, e-mail and network addresses), task titles as numbers, the never-included list (settings, sign-in files, the vault, screenshots, project files) and how a session that did not close cleanly is judged. The host keeps `data/session-marker.json` and `data/crash.jsonl`, previews every file, saves the exact previewed bytes as a zip through a Save dialog and pushes `report:crashed`. `zip-lite.cjs` is a pure in-memory zip writer. Nothing is uploaded. `MEFI_STUDIO_NO_CRASH_PROMPT=1` turns the prompt off. |
| `whats-new.cjs` · `release-notes.mjs` | 150 · 224 | What's new after an update. The rules are pure: the notes table, version compare, when to show (once, silent on a first install and after a rollback). `release-notes.mjs` writes `assets/whats-new.json` from the CHANGELOG's released sections (last five versions, at most six sentences each); `--check` fails when it is stale, and packaging regenerates it. `MEFI_STUDIO_NO_WHATS_NEW=1` turns the toast off. |
| `task-cap.cjs` · `task-metrics.cjs` | 121 · 189 | A task's time limit and usage (the Usage & limit fold in its Evidence). The cap is pure: 5 to 240 minutes in steps of 5, 25 when unset, `min(25 minute hard kill, limit)`, the budget the worker is told (60% of the limit) and the hold and stop wording. The metrics are pure: a task's usage per attempt and in total from the executor ledger, Studio's own call ledger and OpenCode's store, saying Not reported, Unpriced or Unavailable and never zero. `MEFI_STUDIO_NO_TASK_CAP=1` switches limits off. |
| `image-attach.cjs` · `image-store.cjs` | 247 · 201 | Pictures on a message. The rules are pure: the format by magic bytes (PNG, JPEG, WebP, GIF), 5 MB and 25 megapixel limits, four to a message, the provider request shapes (chat completions, Responses; Anthropic built but unused), the plain line a coding CLI gets, the reply notes and the vision lookup from the catalog. The store is a host factory: pictures under the project's data folder with opaque ids, written atomically, pruned hourly (1 day, 300 pictures, 300 MB, never one a message or task names). `read(id)` gives one saved picture back as a data URL (`assistant:image-read`), by an id the store saved, never a path, so a thread can show what a message or brief carries. `MEFI_STUDIO_NO_IMAGE_ATTACH=1` switches it off. |
| `mentions.cjs` · `project-files.cjs` · `gitignore-lite.cjs` | 129 · 210 · 94 | The `@ # /` picker's engine: the grammar the page and the host share (pure), the skill text section of a message and the one-sentence file line (never file contents), a bounded file-name search that never leaves the project or follows a link (the read tool's exclusions plus build folders and .gitignore), and a small .gitignore reader that agrees with `git check-ignore`. `settings.ui.composerPicker` or `MEFI_STUDIO_NO_COMPOSER_PICKER=1` switches it off. |
| `skill-format.cjs` · `skills.cjs` | 146 · 312 | The Skills page's engine: the SKILL.md rules (name, Windows reserved names, 32,000 byte cap, front matter parse, build and check, four starters; pure) and the host factory that lists, reads, saves, creates, deletes, imports and exports by name only, writing only under `<project>/.agents/skills/<name>/SKILL.md` (real-folder checks, atomic writes, safety copies). `MEFI_STUDIO_NO_SKILL_EDIT=1` makes the page read-only. |
| `work-stats.cjs` | 188 | Pure module: what one project's ledgers say about the work done in it, for Build's greeting card (`work:stats`): runs from the executor ledger (worker and how each ended), the model each run used and the verifier's verdict from the Studio ledger, tokens from both usage ledgers, and tasks from the board, over all time, 30 days or 7, with a 22-week heat map. Every number is counted from a record, never estimated. |
| `youtube-explorer.cjs` | 130 | Public YouTube data for the media menu's Browse: a search, a video's "more like this" list and the next page of either, returned as plain ids and strings with an opaque token for the page after. It hands out its own paging tokens and accepts only those back; a page is at most 40 videos and 4 MB; an answer that arrives after a newer search is dropped. It runs no page script and sends no markup to the window. |
| `pc-setup.cjs` | 165 | Set up this PC: checks Git, the GitHub CLI, Node.js, the GitHub sign-in (account name only) and, for the open project, its GitHub remote, packages and drive type; opens a visible PowerShell window with Studio's fixed command for each gap; lists the account's repositories and clones a listed one into a folder main's dialog picked (never exFAT/FAT). Behind main's app-wide `pc-setup:*` channels. |
| `git-link.cjs` | 1,069 | The Git chip's rules: the 31-state table (label, tone, glyph, sentence, primary and secondary), `describe()` (a glance, the last sync result, the account and what is running become one chip model, by priority), repository-name and `.gitignore`/license rules, `publishPlan`, `classifyPush` and `classifyGh` (what git and gh say when they refuse, in words), `pathBlocked`. Pure. |
| `git-actions.cjs` | 1,129 | The git and gh calls behind the chip, all IO injected: `glance`, `preview`, `save` (previewed, unblocked paths only), `pushBranch`, `publish`, `link`, `owners`, `account`. Argument arrays, no shell, credentials scrubbed. |
| `git-host.cjs` | 562 | What `main.cjs` calls from its `git:*` handlers: binds each call to the open project, runs writers one at a time, builds and pushes the chip model, and answers the launch screen's `projects:glance`. |
| `cowork.cjs` | 122 | Live file claims between PCs in a Void Engine cowork room: the hub's claim-path rules and overlap test, a lease's shape, other PCs' live exclusive claims as the in-flight jobs `assistant.mjs` claimWork waits for, a job's files as repo-relative claim paths, a conflict in words, and `settings.cowork` (room per repository, this PC's machine id). Pure; main.cjs's "Cowork claims" block and hub-client.cjs's claims calls use it. |
| `vault-crypto.cjs` | 103 | The Your PCs vault's sealing: a 32-byte key, its pairing code (Crockford base32 with a checksum, canonical form only) and fingerprint, and AES-256-GCM seal/open with the file's path as associated data, so a file moved, edited or sealed with another key does not open. Pure. |
| `share-review.cjs` | 122 | What Studio checks before anything leaves for another PC or a friend, and again when it arrives: `scan` (keys, tokens, passwords, logins in links as blocks; paths, emails, addresses and this PC's names as warnings; instructions aimed at an agent, downloaded scripts, encoded commands, paste and webhook hosts and hidden characters as blocks) and `scrub` over `redaction.cjs`. Pure. |
| `pc-vault.cjs` | 354 | The Your PCs vault: one private `<account>/mefi-studio-vault` repository, a plain manifest (format and key fingerprint), each PC's sealed status line, the shelves (reviewed and, where marked, scrubbed going in; reviewed again coming out, failures quarantined; per-PC evidence in `<pcId>--<id>` files), keys behind the exact confirmation, pairing and unpairing (a failed try leaves nothing behind; create carries on with an empty private repository). One call at a time; a rebase is only thrown away on a real clash, and status names what went. git, gh, the files, the keystore and the clock are injected. |
| `vault-shelves.cjs` | 291 | What each vault shelf offers from Studio's stores (model win/loss counts, decisions without their project, team presets, brains, recipes and memory notes keyed by repository, portable preferences, open work as ideas) and the plan for a received item: added beside what is here under a name that says where it came from, never overwriting; plus the library of kept items that main feeds into model learning and decision preferences. Pure. |

### Permissions and decisions

The permission modes and what the desk and chat decide for the owner.
`main.cjs` serves `autonomy:state`, `autonomy:set`, `autonomy:undo` and
`autonomy:todo` through `preload.cjs`, and the same approval predicate reaches
every dispatch gate. Its `assistantDecisionContext` is shared by the desk and
chat; chat approvals carry the scope they showed, and inbox starts use
targeted promotion.

| File | Lines | Purpose |
| --- | ---: | --- |
| `autonomy.cjs` | 155 | The mode table, elevated categories, approval inheritance (`accepted`) and the owner's-work lineage the Auto gate follows (`ownerWork`), work filed from Discord that waits for approval in every mode (`remoteWork`), settings migration and exact-attempt sessionless check eligibility. Pure. |
| `autonomy-host.cjs` | 378 | One desk decision pass, persisted suggestions and budgets, decision reservations, interruption recovery, to-dos and notices. |
| `decision-ledger.cjs` | 59 | Bounded decision rows, and a conflict-aware Undo that keeps later edits and never refunds automatic retry budgets. |
| `decision-memory.cjs` | 58 | Recency weighting, doubled corrections, scoped preference advice, confidence adjustment and selective forgetting. Pure. |
| `loop-status.cjs` | 87 | Folds the host's switches and board counts into one `{ state, on, headline, reason, action }` answer, sent as `status.loop` on every `assistant:status` push (`main.cjs` `autopilotLoop`) and read by Home, Vibe, Command, Agents, the task page and the chat facts. Pure. |

### The Agent Brain (0.4.0)

The host half is one object, `agent-brain-host.cjs`, which main.cjs calls from
one-line hooks; the rules live in the pure modules it composes. See
[agent-loop.md §13](agent-loop.md#13-the-agent-brain) and
[roadmap-0.4.0.md](roadmap-0.4.0.md).

| File | Lines | Purpose |
| --- | ---: | --- |
| `agent-brain-host.cjs` | 1,177 | Turns the loop's moments (a run prepared, started, speaking, finished; a board write; agent mail; a verified run's files) into work events, per-task pipelines, Playbook records, the project map, desk answers and the companion's state, per project. Every hook swallows its own errors. |
| `work-events.cjs` | 286 | The work event stream: the kinds, normalisation, the append-only `work-events.jsonl` store (one chain per file, trimmed like the executor ledger) and the ledger comparison the replay tool uses. |
| `pipelines.cjs` | 515 | A task's pipeline: the step kinds, templates and recipe instantiation, and `advance` for every run moment (start, first line, todos, `MEFI_STEP` lines, children, end, verdict, fold) within growth caps. Pure. |
| `playbook.cjs` | 306 | Recipes of verified pipeline shapes: `record`, `pick` (a win probability from verified runs, pinned first, with exploration), the owner's actions and the shelf. Pure. |
| `project-map.cjs` | 857 | The per-task file index and the project map: systems from the first map's areas and folders, co-change links, the task overlay, `relatedFor`/`briefLine` for worker prompts, and the naming prompt. Pure. |
| `desk-resolve.cjs` | 215 | The desk handles asks (`agentBrain.deskResolves`): which open asks and parked cards the companion may settle on the desk seat, the prompt, the reply checked against the offered options, and the per-card and hourly budgets. Permission, risk and owner-only asks, grant/proceed/acknowledge answers, and questions the desk itself handed on, always stay with the owner. Pure. |
| `desk.cjs` | 231 | The desk worker's protocol: `MEFI_HELP` lines, its prompt and answer parsing, repeat folding and the note written for the next worker. Pure. |
| `companion.cjs` | 349 | The companion's state (greeting, working, needs you, resting), the welcome-back digest, the needs-you queue and the preferences it learns from answers. Pure. |
| `companion-pet.cjs` | 109 | The companion as a pet: the three personalities and the switches each presets (faces, idle play, roaming), and the bond (days together, pets at most one per few seconds, playdates). `agent-brain-host.cjs` keeps them in `companion.json`; main passes the personality to chat as `ui.personality`. Pure. |
| `companion-friends.cjs` | 466 | What a companion may tell friends' companions: the five sharing levels, rules for everyone, a room or a friend (this session or always) and how they resolve, the room broadcast level, the card built from named fields with secrets scrubbed, reading a friend's card, the share-back ask, and the scripted, mirrored playdates. Main's "Companion friends" block owns the I/O. Pure. |
| `desk-server.cjs` · `desk-mcp.mjs` | 118 · 113 | The desk as a tool a running worker waits on: a 127.0.0.1 endpoint with a per-process token, and the stdio MCP server OpenCode and Claude Code start beside a run when `agentBrain.deskTool` is on. |

### Model calls, routing and resilience

| File | Lines | Purpose |
| --- | ---: | --- |
| `provider-breaker.cjs` | 193 | A circuit breaker per provider for the host's own model calls, adapted from BetterC0de. `httpAssistantCall` and `assistantFetch` gate every call on it. |
| `redaction.cjs` | 93 | `scrubOutbound`, the gate every outbound payload passes through, and `safeExcerpt`. |
| `chatgpt-plan.cjs` | 1,264 | The "ChatGPT plan" provider (Sign in with ChatGPT, OpenAI's open-source token-sharing preview): the loopback OAuth + PKCE sign-in (registration with `dynamic_agent_client`, then the issued client id), ID-token checks against OpenAI's JWKS, single-flight refresh, sign-out with revoke, `/v1/models`, and streamed `/v1/responses` calls in chatCompletion's result shape. Pure helpers `authorizeUrl`, `requestBody`, `parseSse`, `mapError`; fetch, the server, the browser, the clock and the encrypted save/load are injected. `chatgpt_plan.test.mjs` runs it against fake OpenAI servers. |
| `credentials.cjs` | 93 | Which environment variables may back each saved key: Studio's own `MEFI_STUDIO_*` names and the names other tools share. |
| `cli-accounts.cjs` | 261 | Several logins per coding CLI: Claude Code's and Codex's main login plus the ones added in Setup (each a folder handed over as `CLAUDE_CONFIG_DIR` / `CODEX_HOME`), which one answers (the first not topped out), a login's usage-limit words and when they say it resets, and what a usage reading says. Pure; main.cjs's "Several logins per coding CLI" block keeps the folders and the limit marks, runs assistant calls over the logins (`cliAccountTurn`) and sets a worker's topped-out login aside in `finish`. See [cli-setup.md](cli-setup.md#more-than-one-login). |
| `auth-store.cjs` | 93 | Keeps the key ciphertext in `auth.json`, apart from the `settings.json` preferences: splits a settings view into the two, merges them back into one view for callers, and writes the auth file atomically. |
| `decision-client.mjs` | 629 | The Jev classifier client over its four routes. |
| `model-routing.mjs` | 428 | The builder-model evaluator: each candidate's verified record on this kind of work, cost, speed and strengths become a win probability (`estimateWinProbability`), whose prior Studio's probe runs and the community feed may shift a little (`probeShift`, `communityShift`); Jev or the stand-in judge answers one probability per candidate, and the highest wins. See [agent-loop.md §12](agent-loop.md#12-choosing-a-builders-model-the-win-probability-evaluator). |
| `work-classification.mjs` | 240 | Builds the narrow questions Jev answers, and interprets the answers conservatively. |
| `choice-judge.mjs` | 184 | The stand-in judge for machines with no Jev key. |
| `jev-loop.mjs` | 114 | A bounded advisory queue; admission never waits on Jev. |
| `model-performance.cjs` | 414 | Local measured evidence only; never calls a provider. Builder attempts are settled here as wins and losses (`settle`) from the verifier's receipts. Observations keep their project, and cached snapshots and `taskSkills` take a project filter. |
| `model-learning.cjs` | 46 | Folds the existing local model ledgers into weighted Beta records and per-task model skill summaries. Pure. |
| `model-community.cjs` | 377 | The community model feed's Studio side ([model-community.md](model-community.md)): `validateFeed` drops what breaks the contract row by row, `matchModel` maps Studio's providers and ids to feed rows, `taskKindsFor` is the explicit Studio-task to task-kind map, `evidenceFor`/`routingEvidence` keep only what routing may see, and `fetchFeed` (https, 20 s, 1 MB) takes its fetch from the host. Pure. |
| `model-probes.mjs` | 484 | Studio's on-demand probes: one small fixed task per kind (planning, structuring, coding, writing, commits, tests, setup), each with a deterministic scorer; the code probes run the model's code in a child `node` in a temp folder (`runNode`). Also the `model-probes.json` store shape and `probeSummary` for routing. Never calls a model. |
| `usage-tracker.cjs` | 1,006 | Usage accounting across every connected provider, pure data in and out. |
| `refresh-models.mjs` | 508 | CLI: refreshes `data/models.json` from the OpenCode Go roster and its other sources, plus `providerModels`: the Claude Code, Zen and z.ai models Studio routes to, rebuilt from models.dev for the ids listed in `curated.json`'s `providerRoutes`. |
| `openrouter-catalog.cjs` | | Reads and caches OpenRouter's public text-response model roster for the Settings picker; it does not edit the committed OpenCode Go catalog. |
| `measure-speed.mjs` | 73 | CLI: the optional local tokens-per-second probe. |

### Agents, seats and tools

| File | Lines | Purpose |
| --- | ---: | --- |
| `agent-profiles.cjs` | 179 | Versioned teams without credentials, project and default resolution, and the configuration an attempt captures (skills, habits and the project's rules travel with a run). |
| `agent-addons.cjs` · `agent-models.cjs` | 135 · 19 | Each agent's local skills, found and attached to its prompt, and the project's rules first (it reads AGENTS.md and CLAUDE.md fresh when the card's switches are on and reports the card's state); read-only provider model rosters, with the credentials kept in the host. |
| `agent-rules.cjs` | 151 | Project rules (`agentRules`): the 4,000-character limit and its check (refused, never cut), the two file switches, the who-reads-what table, the prompt block and its token cost. Pure; `agent-addons.cjs` reads the files and adds the block first in a role's prompt. `MEFI_STUDIO_NO_AGENT_RULES=1` turns it off. |
| `agent-tools.cjs` · `agent-mcp.cjs` | 390 · 104 | Per-role tool policies, bounded research turns, public web search, scoped file reads, `project_list` and `project_search` for Studio's own models (gated by Read project files; `MEFI_STUDIO_NO_PROJECT_SEARCH=1` removes them), and the stdio MCP client. |
| `project-ignore.cjs` · `project-search.cjs` | 264 · 343 | What Studio's own models may see of a project's files: safe relative paths, private and secret names, built-in ignores, .gitignore and glob matching by plain wildcard code (pure), and the bounded, read-only folder walk and text search (binary and huge files skipped, symlinks not followed out of the project, regex time limit, 10,000 characters an answer) on an injected file system. |
| `agent-tool-configs.cjs` · `agent-tools-mcp.cjs` | 33 · 39 | The tool attachments captured for each run, and the MCP adapter a coding worker talks to (it marks its calls as a worker's and never lists or runs the project tools). |
| `fleet.cjs` · `fleet-host.cjs` | 781 · 286 | The fleet ([fleet-overhaul-plan.md](fleet-overhaul-plan.md)): every seat on the team, the generations (runs) each seat has had and the wires between seats, as pods, a Recent feed and Health signals for Live › Fleet. A seat is a stable address (`builder-2@project`); a retry returns to the seat that last worked the task. `fleet.cjs` is pure; `fleet-host.cjs` keeps `fleet.json` per project and pushes `fleet:update` only while a Fleet view holds a watch lease. `main.cjs` calls it from five one-line guarded hooks (brain event, executor status, board write, run finish, worktree merge). |

### Processes, paths and projects

| File | Lines | Purpose |
| --- | ---: | --- |
| `platform.cjs` | 164 | The one spawn every child goes through. Keeps call sites in their Windows shape (`cmd.exe`, `where.exe`, `taskkill`) and translates exactly those on Linux and macOS; withholds Studio's own credential variables from every child. |
| `windows-command-line.cjs` | 185 | Correct quoting for a `cmd.exe /d /s /c` line, ported from BetterC0de. The game launcher builds its line with it. |
| `projects.cjs` | 271 | Project identity and storage boundaries. |
| `settings-cache.cjs` | 137 | `readSettings`' memory in the Electron build: the merged view of `settings.json` and `auth.json` while both keep their stat (bigint dev, inode, size, mtime), one clone per caller, never kept when a read is a fallback, racy or raced by a write. `MEFI_STUDIO_SETTINGS_CACHE=0` reads both files every call; under the Rust host its settings store answers instead. |
| `new-app.cjs` | 47 | Vibe's New app: the folder name and place (by default ~/Mefi Apps), never inside Studio's own repository, and the starter README. Pure; `main.cjs` `projects:create` writes it. |
| `project-preview.cjs` | | Local app preview detection, bounded loopback readiness, managed server lifetime, sanitized output and ownership-safe stop/reuse. Its process state is separate from executor jobs and verification. `main.cjs` supplies active-project evidence URLs and project/quit cleanup; `preload.cjs` exposes the preview controls. |
| `path-scope.cjs` · `paths.cjs` | 20 · 46 | Folder containment for scoping sessions; the source, workspace and game kept apart. |
| `machine.mjs` | 612 | Machine coordination: CPU and memory, test leases, the LÖVE process table. |
| `eyes.mjs` | 2,711 | The A-Eyes data layer, with two jobs: read-only reads of the live OpenCode session store, and the studio's own board store, which it writes (`readJson`/`writeJson` for the `data/*.json` stores, and the optional read-write SQLite board authority with its schema migration). |
| `eyes-worker.mjs` · `eyes-client.cjs` | 48 · 209 | Host `eyes.mjs` on a worker thread, so its synchronous SQLite reads never block the main process. |
| `project-work.cjs` | 376 | Work that already exists in an open folder, read from the engineering-skills conventions. |

### Planning, analysis and first run

| File | Lines | Purpose |
| --- | ---: | --- |
| `planning.cjs` · `planning-service.cjs` | | Decision planning and read-only live drafting, kept apart from board work until a specification is approved. Live exploration uses the Analyzer's bounded file inventory and returns proposals without writing the plan journal. `list({skipExisting})` answers with the plans alone and `prepare` returns the folder scan plus a warm project read; interview turns go to the routine (quick) seat and are asked once more of the heavy seat when the reply is unusable, the spec and "think harder" turns go to heavy. Every edit to a plan is a version with its author (you, Mefi, Studio) and a one-line note; `restore-version` (owner only) appends a new version with an older wording and withdraws confirmation and approval, so history is never rewritten (the file is 534 lines). |
| `analyzer.mjs` · `reference.mjs` | 661 · 172 | Local analysis of a file or an idea; exact context gathered before something becomes a task. |
| `first-scan.mjs` · `first-map.mjs` · `first-run-service.mjs` · `setup-assist.mjs` | 520 · 227 · 375 · 124 | The first-run scan of the machine, the first map of a folder, the service behind the walkthrough's stops, and the setup assistant. |
| `cli-setup.cjs` · `cli-text.cjs` | | Guided vendor installation/sign-in (an added login signs in under its own folder, named by id), single-subscription configuration, and restricted CLI text sessions for mapping, planning and agent roles (a login's folder rides their environment). |
| `auditor.mjs` | 233 | Local wiring and gap checks, with no network and no key. |

### Policy Lab

`policy.mjs` (the policy contract), `policy-gates.mjs` (hard gates, lifecycle
and promotion), `policy-lab.mjs` (offline evaluation), `replay.mjs`
(recorded-tree replay), `experience.mjs` (the append-only experience store) and
`receipts.mjs` (the studio's own verification receipts, as opposed to a
worker's claim).

### Renderer support and diagnostics

| File | Lines | Purpose |
| --- | ---: | --- |
| `renderer-recovery.cjs` | 167 | Recovers a renderer that died while its window and tray stayed alive. |
| `booklet-source-location.cjs` | 74 | Maps a runtime error's line in the booklet's one inlined `<script>` back to `renderer/<file>:<line>`, through the `booklet.sources.json` manifest `build-booklet.mjs` writes beside it. |
| `startup-marks.cjs` | 184 | Launch timings from both processes on one timeline (ms since main started): main, app ready, the window, dom-ready, did-finish-load, and the page's marks over `startup:marks`. One `[startup]` Trace line per launch; `--startup-report <file>` / `MEFI_STUDIO_STARTUP_REPORT` writes JSON; `MEFI_STUDIO_STARTUP_MARKS=0` turns it off. |
| `assistant-push.cjs` | 63 | What one `eyes:assistant` push carries: once the page's bridge listens, state keys it already holds ride as `same` references by content, and `preload.cjs` puts its kept copies back. |
| `row-push.cjs` | 112 | What one board list (`eyes:tasks`, `eyes:requests`, `eyes:ideas`) or checkpoint store push carries: the changed rows, the ids that left and the order only when it moved, a whole list the first time, after a project switch or when the page asks (`eyes:rows-sync`). `preload.cjs` `mergeRows` rebuilds plain lists; `MEFI_STUDIO_FULL_PUSHES=1` sends them whole. |
| `performance-profiler.cjs` | 250 | Opt-in, in-memory host diagnostics. |
| `music-recommendations.cjs` | 66 | Validates a mood request and parses a model's music suggestions. |
| `daily-news.cjs` | 513 | The Studio Daily, pure: parses RSS, Atom, the Hacker News front page and GitHub release lists into items (headline, short plain summary, link), clusters one story across outlets, ranks the day's biggest, composes the edition, and checks an AI editor's reply (`applyEditor`: known ids only, no links, no new numbers, else the heuristic paper). |
| `daily-news-host.cjs` | 250 | `createDailyNews`: fetches the ten wires in parallel (8 s and 1 MB each) once a local day, keeps `edition.json` under the news folder, marks yesterday's paper stale offline, runs the optional editor in the background and refreshes after 06:00 while Studio runs. With `enabled()` false it touches neither network nor disk. |

### The community link

The optional Void Engine Discord login, which Listen together and the rooms
hub use (it unlocks nothing). The host side is the "Discord community link"
block and the `// ---- Community ----` handlers in `main.cjs`. See
[community.md](community.md).

| File | Lines | Purpose |
| --- | ---: | --- |
| `community.cjs` | 406 | Pure rules: the Void Engine ids, the weekly card's cadence (never shown to a member, `isMember`), when a linked account is re-checked, what a check result means, the Discord link allow-list, PKCE and the public status. No Electron, filesystem or network, and time is injectable. `module_purity.test.mjs` holds it to that; `community_rules.test.mjs` pins the rules. |
| `discord-oauth.cjs` | 418 | The network half: the OAuth2 PKCE login through a one-shot `127.0.0.1` loopback redirect, the secret-less token exchange, refresh, the membership read and revoke. Every POST the feature makes lives here, and everything it reaches for is injectable. `discord_oauth.test.mjs` runs a real loopback against a fake Discord. |
| `hub-client.cjs` | 800 | The Void Engine rooms hub client (the bot repository's docs/protocol.md): trades the Discord access token for a hub session, keeps one WebSocket with backoff, renewal and presence, and carries Listen together's `listen` frames, the opt-in `nowPlaying` share and, only to a hub whose `ready` lists the feature, `companion` cards (one-member delivery only with `companion.direct`). Everything network is injected; main's "Rooms hub" block owns the one client and hands companion frames to its "Companion friends" block. With the `remote` feature it also names this PC to the hub (`setRemote`), hands main the Discord remote's `remote` commands, and sends `remoteReply` / `remoteNotice` (docs/remote.md). |
| `room-history.cjs` | 160 | This PC's own copy of its rooms' chat, since the Mefi Studio relay keeps none: the last 500 messages of each room for 7 days in at most 50 rooms, edits that never go backwards, pages, and the file's JSON. Pure (time injected; `module_purity.test.mjs`). main's "Rooms hub" block saves it encrypted as `room-history.json`, reads Rooms' pages from it, answers the relay's `historyRequest` from it and merges `history`. |
| `remote.cjs` | 328 | Pure rules for the Discord remote (docs/remote.md): the commands, what a message from Discord may do (`gateActions`, `LOCAL_ACTIONS`, the `ORIGIN` its filed work carries), each reply's wording (status, needs, made, digest), the alert policy (`alerts`: once per change, quiet hours, 12 an hour, the stuck and digest alerts) and the approval PIN (salted scrypt hash, five wrong tries lock). main.cjs "Discord remote" owns the I/O. |

### Build, checks and release (CLIs)

`build-booklet.mjs` inlines the renderer into `renderer/booklet.html`, written
in the template's own line ending so a rebuild matches Git's checkout.
`check-syntax.mjs`, `check-targets.mjs`, `check-css.mjs`,
`spec-collisions.mjs` and `check-testruns.mjs` make up `npm run check`;
`run-all-tests.mjs` is `npm test`: the Node suites through `run-node-tests.mjs`,
the Python contracts in `tools/` and the normalized-path lock, every leg run
even when an earlier one fails. `append-testruns-row.mjs` is the
write-side companion to the `check-testruns.mjs` gate: it lands a new row at
the true top of the live region (the dated rows above the `## Read Before Any
Tests` anchor — the archive below that anchor is frozen), under a
cross-process lock with a re-verified atomic write. `rotate-testruns.mjs` is
the third piece: past 20 live rows it moves the oldest, whole and verbatim,
into `docs/archive/testruns-YYYY-MM.md`, and the append helper runs it after
every append. `serve.mjs` serves `npm run start:web`.
`fetch-electron.mjs` is `npm ci`'s postinstall step: it fetches the Electron
binary, which Electron 44 no longer downloads on install (skipped on CI and
without devDependencies).
`package-portable.mjs`, `package-release.mjs` and `make-icon.mjs` build
releases; `stamp-exe.mjs` gives the packaged executable Studio's name,
version and icon in place of Electron's before it is signed
([code-signing.md](code-signing.md)). Meanwhile `updater.mjs` (live source updates) and `release-updater.mjs`
(GitHub releases) keep installed copies current. `update-safety.cjs` is the
pure half of the update safety net: the shapes of the boot-health, backup
manifest and update-result files the installing helper and the app pass each
other (`main.cjs`, "Release updates: the safety net", owns their I/O).

## `src-tauri/` and the host shim - the Rust host (moving to Rust, stage 1)

[rust-migration.md](rust-migration.md) has the plan and the parity table. The
Rust host runs the unchanged engine as a Node sidecar; build it with
`npm run host:build` (`scripts/rust-host.mjs` keeps Cargo's target folder
outside the checkout).

| File | Purpose |
| --- | --- |
| `crates/mefi-core/src/eyes/` | The OpenCode session store in Rust (stage 2): `eyes.mjs`'s 19 worker reads and its git helpers, held to it by `tests/rust_parity_eyes.test.mjs`. |
| `crates/mefi-core/src/repo/` · `callbacks.rs` | Multi-PC sync, the worktree table and its actions in Rust (`sync.mjs`, `worktrees.mjs`, `worktree-actions.mjs`), held to them by `tests/rust_parity_repo.test.mjs`; function arguments arrive as handles the host calls back. |
| `crates/mefi-core/src/files/` | The @ picker's project file search and its `.gitignore` reader in Rust (`project-files.cjs`, `gitignore-lite.cjs`), held to them by `tests/rust_parity_files.test.mjs`. |
| `crates/mefi-core/src/git/` | The Git chip's actions in Rust (`git-actions.cjs`: glance, save preview and commit, push, Publish, Link, owners, name check, account) with the `git-link.cjs`, `pc-setup.cjs`, `redaction.cjs` and `share-review.cjs` rules they read; `run.rs` runs git and gh as `git-actions`' `run` does. Held to them by `tests/rust_parity_git.test.mjs`. |
| `scripts/rust-modules.cjs` | What Rust answers under the Rust host: module functions (`main.cjs`'s `loadModule` hands those modules out with the functions replaced) and whole host factories (`factory`: project file search, the Git chip's actions). `MEFI_STUDIO_RUST_OFF` keeps listed ports on JavaScript; pinned by `tests/rust_modules.test.mjs`. |
| `crates/mefi-core/src/js.rs` · `jsre.rs` · `paths.rs` | JavaScript's rules a port must keep (number printing, rounding, toFixed, dates, UTF-16 slices, trim, localeCompare order), JavaScript regular expressions run with JavaScript's meaning (`js_regex!`), and `path-scope.cjs`'s path rules. |
| `crates/mefi-core/src/bin/mefi-core.rs` | The engine crate from the command line: one read, a batch, or the store dump, for the parity tests. |
| `src-tauri/src/lib.rs` | The host's start: the single-instance lock, the `mefi` protocol, the page's commands, starting the engine, and leaving when it leaves. |
| `src-tauri/src/engine.rs` | The engine sidecar: the named pipe, the launch token, frames in both directions, and the relaunch after an `app.relaunch`. |
| `src-tauri/src/native.rs` | What the engine's Electron objects ask for: the window and its events, dialogs, tray, images, clipboard, idle state, power requests, login items, displays. |
| `src-tauri/src/bridge.rs` | The commands the page calls: invoke, send, the push channel, console messages, menu accelerators, `executeJavaScript` answers. |
| `src-tauri/src/init.js` | The page's half of the bridge, injected at document start: runs `preload.cjs` unchanged with a stand-in `require("electron")`. |
| `src-tauri/src/protocol.rs` | Serves Studio's page at `http://mefi.localhost/` (`renderer/`, `assets/`, the `data/` catalogs) and local pictures under `/__file/`. |
| `src-tauri/src/webview2.rs` | WebView2 features Tauri does not wrap: page captures (`capturePage`), the Referer YouTube's embeds need, the page process failing, DevTools protocol calls. |
| `src-tauri/src/toast.rs` | Windows notifications for Electron's `Notification`, under the app id `main.cjs` sets, which it registers under `HKCU\Software\Classes\AppUserModelId`. |
| `src-tauri/src/power.rs` | `powerMonitor`'s suspend, resume, lock-screen and unlock-screen events, from a power callback and a message-only window. |
| `src-tauri/src/oscrypt.rs` | Electron's `safeStorage` key: the DPAPI-protected AES key in userData's `Local State`, read or created. |
| `src-tauri/src/wire.rs` · `scripts/host-wire.cjs` | The wire's two halves: one JSON frame per line, bodies forwarded unparsed, Electron's structured-clone values tagged. |
| `scripts/tauri-electron.cjs` | Electron's API for `main.cjs` when `MEFI_STUDIO_HOST=tauri`, served by the host. |
| `scripts/tauri-sync-worker.cjs` | The blocking connection for the calls Electron answered on the spot (`Atomics.wait`). |
| `scripts/rust-host.mjs` | `build`, `test`, `run` for the host, with the target folder in `%LOCALAPPDATA%\MefiStudio\rust-target`. |

## `relay/` - the Mefi Studio relay (Cloudflare)

The service Friends connects through: rooms, chat (passed along, never
stored), listen together, companions, cowork claims, peer history, credits,
ranks and the Project hub. A Worker plus one Durable Object on the free plan,
deployed at `https://mefi-relay.mefi-studio.workers.dev`. It has its own
`package.json` (wrangler only), so the app gains no dependency.
[relay/README.md](../relay/README.md) lists what it keeps and how to deploy.

| File | Purpose |
| --- | --- |
| `relay/src/worker.mjs` | The Worker: `/v1/health`, refuses anything outside `/v1/` or over 16 KB, routes the rest to the Hub object. |
| `relay/src/hub-object.mjs` | The Hub Durable Object: every socket (Hibernation API; the keepalive ping is answered by Cloudflare) and the SQLite database, handed to the core. A plain class, so Node loads it too. |
| `relay/src/relay.mjs` | The core: every HTTP route and WebSocket frame, rooms, chat, presence, companions, peer history, moderation, retention, alarms. Platform-free. |
| `relay/src/protocol.mjs` · `paths.mjs` · `leases.mjs` | The Void Engine hub's v1 shapes, claim paths and lease authority, carried over, plus the relay's frames. |
| `relay/src/sessions.mjs` · `chat.mjs` | Sign-in with the member's own Discord token and 15-minute session tokens; message ids that prove their author and message signatures. |
| `relay/src/credits.mjs` | Credits (earned by playing, never bought), ranks and the project cards, and the hub's side of The Lobby's front page (`front`: the week's top and new projects, rank-ups, the member's own week). `GUARD` holds the anti-farming rules (account and server age, a 15-a-week pair limit, once a day per maker, stars once a week, Forget me's 30-day fingerprint hold, rate limits) and `standing()` says whether a member may give or earn; moderators get `/v1/admin/credits/:id` and its `revoke`. |
| `relay/src/listen.mjs` · `media.mjs` · `store.mjs` · `util.mjs` | Listen together (kept in SQLite across sleeps), allowed links, the schema and migrations, Web Crypto helpers. |
| `relay/node/adapter.mjs` | The real Worker and Hub under Node with in-memory sockets and a scripted Discord, for `tests/relay_*.test.mjs` (with `tests/fixtures/relay-harness.mjs`). |
| `relay/scripts/smoke.mjs` | A real-network check of a running relay (`wrangler dev` or the live address). |

## `renderer/` — classic scripts inlined into one HTML file

`npm run build-booklet` inlines every script and stylesheet here, and the model
catalog, into `booklet.template.html` to produce `renderer/booklet.html`. The
built file is committed, and it is what the app loads. The scripts share `window.Mefi*` namespaces and use no
imports. See [Unified Studio](unified-studio.md) for the interfaces and fixture coverage.

| File | Lines | Purpose |
| --- | ---: | --- |
| `node-visuals.js` | 152 | `window.MefiNodeVisuals`: shared graph palette, bounded per-canvas finish and text caches, and node-rim connection endpoints. |
| `idle.js` | 13,375 | The Command view: the 3D node constellation that is also the menu, and the same tree drawn as scenery behind Home's frosted panels. Transfers supported drawing contexts to OffscreenCanvas; `MefiIdle.canvasContext(element)` exposes the actual paint target for diagnostics. Its costs are in [performance.md](performance.md). |
| `node-styles.js` | 5,323 | `window.MefiNodeStyles`: the node-style painters the Command view and the tree rail share (the eight looks, their motion records, detail tiers and theme tones, and the overlay and wire hooks each style may take over). Bundled before `tree3d.js`, which with `idle.js` falls back to a plain disc when it is absent. |
| `brains.js` | 3,953 | The brain-map editor over the data `scripts/brains.cjs` validates. |
| `agent-brain.js` | 1,846 | `window.MefiAgentBrain`, `MefiHub` and `MefiCompanion`: the Agent brain sheet (`J`: a task's pipeline drawn from work events, the Playbook shelf, the project map, the seats), the map hub on Home, and the companion orb and panel in the menu foot. |
| `project-map-view.js` | | `window.MefiProjectMap`: connected system cards and the expandable Ideas tree, plus contents/search, filters, history, selection, minimap, pointer and keyboard navigation, camera easing and level transitions. Uses the map and work projection supplied by `agent-brain.js`; styles live in `agent-brain.css`. |
| `nav.js` | 3,428 | The navigation registry behind Home/Work/Agents/Friends, New task, project-scoped recent tasks, the local view row, workspace-page presentation, Search, Help and shortcuts. Also the layout contract: `applyLayout` (the one writer of `html[data-layout]`), `MefiNav.layout` (`set`/`get`/`used`/`fold`) and `MefiNav.usable()`, the free rectangle the orb, the media window, toasts and pop-ups ask. Friends actions focus the existing companion hub's Rooms, Your PCs and Playground cards. History is kept per project and section, it decides which destination owns a shared page, and historical destination IDs resolve here. A printable key pressed while a menu or sheet is open goes into that menu's text box (`typeInto`; menus opt in with `data-type-scope`, `data-type-here` or `typeScope()`) instead of the single-letter shortcuts. |
| `tree3d.js` | 2,491 | The 3D task-tree rail. |
| `tasks.js` | 2,433 | The task board, per-task logs and ideas, and the reference menu; the Undo toast after a delete and the Recently deleted list (Task board › More). `MefiTasks.usage` gives the duration, usage and cost words, so the session inspector's Agent tab says them the board's way. |
| `card-layout.js` | | Shared measured card spans for Tasks and Ideas; coalesces resize updates, respects reduced motion, and stops observers and animations when the view closes. |
| `explorer.js` | 1,696 | Sessions: session list/detail with Assistant, Activity and Diagnostics tabs. |
| `booklet.js` | 2,100 | The expandable model catalog and its read-only Also tracked tables (`providerModels`), filters, seven-category Settings navigation and control search, the studio launcher and the boot sequence. |
| `music.js` | | Appearance controls in Settings and the optional canvas preview; the hover/click audio dropdown (`openAudio` / `toggleAudio`) owns local music, radio, Links, connection setup, reactions and recommendations. Includes saved URL visibility and copied-link offers through the focused-main-frame-only `scripts/media-clipboard.cjs` helper. Also owns colour themes (Chrome first, the default for a new install; a saved theme is kept), node styles and layouts (the two-tone Void collection among them, free like the rest; a choice left in the retired `mefiStudio.music.premium.v1` store is migrated at load) and media parsing (`MefiMusic.playLink` / `linkInfo` for other modules). The media menu is a mini player that unfolds: one card and one transport for the source on show (radio and buffering follow the card; its ideas, hints and Up next drags stay current), with Next following a YouTube playlist. A remembered video link asks YouTube for no picture until the menu is opened. |
| `tree-dynamics.js` | | Shared saved tree modes and controls, bounded live shape transforms, count-aware sizing, music deformation and stable dark/bright video-region selection. Loaded before `idle.js`; transforms painted positions before wires, labels and hit targets. Also owns independent node/line brightness paint passes, enable switches and optional contrasting node outlines. Controls synchronize across Appearance, Audio reactions and the media window's brightness section. |
| `media-window.js` | | The Links player's persistent floating surface: pointer and keyboard move/resize, viewport bounds, a local window toolbar and visible minimized restore bar, background/transparency settings in the media menu, stable dark-area tree placement, task-completion fades and notifications, saved geometry, and opt-in pointer avoidance. Docked drags preserve the visible starting geometry. The player is carried into and out of the media menu with `moveBefore` where the browser has it (no reload), and in a narrow window the bar keeps Close and the other buttons inside its edge. Bundled before `music.js`; styling lives in `music.css`. Host helpers `scripts/media-scene.cjs` return brightness scores only; `scripts/youtube-explorer.cjs` (below) provides the explorer in `music.js` with bounded public YouTube results, which also records recent playback position. |
| `workspace.js` | | The home screen: project context, bottom composer, compact current-task summary, Activity panel, scoped start/resume, app preview controls and durable results. Task presentation comes from the shared helpers in `tasks.js`; selected task identity comes from `nav.js`. |
| `vibe.js` / `vibe.css` | | `window.MefiVibe`: Vibe, the calm front door (one box to talk or build, cards that show only while they have something: Needs you / Building now / Freshly done / Fresh ideas, and a dock whose Watch, Plans and Ideas stops come and go), the Vibe / Build switch and the one-time "what's new" card. In Vibe mode it also owns `#vibe-rail`, the frame every other page opens inside, in place of Build's menu. |
| `key-tips.js` | | `window.MefiKeyTips`: first-run key tips. Small pop-ups beside Vibe's box, dock and top bar, Build's rail and Command's task box that name the matching keys as keycaps, at most two at a time and never over a sheet, the setup helper or the walkthrough. A click, or pressing the key itself, fades one away for good (`mefiStudio.keyTips.seen`). They switch off from the tip itself, Settings (`#settings-key-tips`), Vibe's settings panel or Search (`mefiStudio.keyTips` = "off"). Search also has Show key tips again. A device that will see them skips nav.js's one-time key toast. Bundled after `vibe.js`. |
| `today.js` / `today.css` | 1,678 · 423 | `window.MefiToday` (layout v2 only): Today, Vibe's home in the new layout, and the Inbox. It reads Vibe's data through `MefiVibe.data()` and `watch()`: the greeting, the box and the starting chips move into the page (Build it, Suggest a next step and drafts still run through `vibe.js`), under them a board of Needs you, Running, Review and Done today with one line each (detail follows `html[data-detail]`) and a question answered on its line. The Inbox lists everything waiting on the owner (questions, permissions, approvals, steps to approve, stuck tasks, results to check) with the app's own options, a free answer, Decide later and a Decided line with Undo where there is a way back, each through the existing host calls (`assistant:answer`, `backlog:control`, `tasks:action`, `autonomy:undo`), as a popover anchored to a pill (`openInbox(anchor)`, Ctrl J) and a page, Work › Inbox; each card reads as the 0.5 prototype's (its mark, who asked, the task under the question, the first option filled, a result's Approve and finish, Review changes and Send it back). In Build, Home with no session open is Today as the 0.5 prototype draws it (`mountHome`): it borrows `workspace.js`'s form (`#workspace-form`, and the feedback row under it) into its own page in `#workspace-layer` and puts it back on the route's `chat` view, which is Build's earlier Home (Talk it over and the action `home-chat` open it); Talk it over and Build it send through `MefiWorkspace.send(purpose)`, the starters come from `MefiVibe.intents()`. Routes `today`, `inbox` (in Work's `LOCAL_ROUTES`) and the actions `home-chat` and `inbox-open` exist only when the layout is on. `count()`, `onChange(cb)` and `openFromAlert` serve the shell's pill, the status bar, Home's chip, the tabs and a clicked notification; `needTasks()` is what builder.js's reading files under Needs you, so the session list and the Inbox are one list. Bundled after `vibe.js`. |
| `vibe-flow.js` | | `window.MefiVibeFlow`: Vibe's long waits, live. A run per planner look (MEFI's Suggest a next step) or sizing (Build it, New app) follows the host's `vibe:progress` steps (`main.cjs` `vibeProgress`, `scripts/planning-service.cjs`) and draws one strip per run, updated in place: stages, the files read or steps planned, a clock against this machine's usual time. Also names models and a worker's tool and current step for the plan card, the plan timeline and Team's Thinking now. Bundled before `vibe-panels.js`. |
| `vibe-panels.js` | | `window.MefiVibePanels`: Vibe's menus, including the Tasks List/Lanes board, queue controls and revision-aware Inspector. Tasks, Plans, Ideas, Team and Settings as compact panels in `#vibe-panel`, fed by what `vibe.js` already holds; a row opens its detail, Full view opens the Build page inside Vibe's rail. |
| `planning.js` | | The plan interview (chat bubbles, one-click "That's right — record it", Mefi asking on its own), live writing partner and file tree, editable suggestions, Enter field navigation, and reviewed task handoffs. Shows one step at a time with an Up next button; lists plans before the folder scan, then fills in the Project ready chip, the scan and "Where this lives" (Project map areas via `brainMap`/`brainMapPlace`). |
| `onboarding.js` | 923 | The resumable *Start here* walkthrough. It starts at Your workspace when the setup helper already connected an AI, and switches Vibe to Build before pointing at Home's controls. |
| `setup-helper.js` / `setup-helper.css` | 1,277 | `window.MefiSetupHelper`: one sheet for every agent setting (connections, team and models, routing, how work runs, permissions, tools, machine, look). Opens before the walkthrough on a new profile and once per `REVISION` after an update; saves only through existing host calls (`agents:save` for the team, key, routing and CLI setup calls, `MefiAgentControls`, `assistant:prefs`, `machine:set`, `jev:*`, `prefs:set`). Registers the `setup-helper` sheet and a Search entry per section. Bundled after `agents.js`. |
| `community.js` | 560 | `window.MefiCommunity`: the quiet weekly community card, General's Community disclosure, and the Community action in Help and Search; `mefi-community-status` tells Listen together when the link changes. It sees only the public status from main, never a token. Bundled after `music.js` and before `booklet.js`. |
| `together.js` | 476 | `window.MefiTogether`: Listen together and the now-playing share, drawn into the Links panel (`MefiMusic.togetherHost`). It picks a room, follows its shared player (a file to the second, YouTube/Vimeo/SoundCloud through their postMessage APIs, Spotify by loading the same link) and sends the share only when the member turns it on. Talks to main only through `hub*` on the bridge. Bundled after `music.js`. |
| `project-hub.js` | 430 | `window.MefiProjectHub`: Friends › Project hub on the Mefi Studio relay. Your rank badge, credits, progress, streak and special ranks; a Star map (a canvas drawn once per change, never in a loop, with every star also a button in the list under it), New, Top and Mine lists, and the Share form. Play, Star, Feature and Remove go through main's `hub:projects` channel (`HUB_PROJECT_METHODS`); main opens a played link in the browser and counts the play two minutes later. Text only. Bundled after `rooms.js`. |
| `friends-front.js` / `friends-front.css` | 361 · 78 | `window.MefiFriendsFront`: Friends' front door. `gate()` is the one "Sign in with Discord" card a signed-out member sees in The Lobby, Rooms and the Project hub (Your PCs and the Playground never need it); `card()` is The Lobby, Friends' first place: the relay's `GET /v1/front` read in one `hub:room` call and painted in The Studio Daily's voice (masthead, who is online and where, the week's top project, Rooms open now, New this week with rank-ups, Your week, Show me as online and the invite code of your own room). It reads again every minute while on screen and on a `credits` frame, asks Rooms to recount what waits for the Friends badge, and its rooms and people open Rooms at that room. `popups` turns `friendOnline`, invites, join requests and played or starred credits into toasts (one hub listener, Friends open or not; off with `mefiStudio.friendsPopups` = "0"). Text only. Bundled after `project-hub.js`. |
| `friends-mod.js` | 222 | `window.MefiFriendsMod`: Friends › Moderation, shown only when the relay's `me()` says this member moderates (`learn()`, asked each time Friends opens; companion-hub's `FRIENDS_PLACES` "mod" is `modOnly`). Looks like farming (`modFlags`), open reports with Resolve, Remove project and a week's suspension, a lookup by name, and a member's review with Take back and Suspend (`modReview`, `modRevoke`, `modSuspend`), all through `hub:room`; every change asks twice. Its styles are in `friends-front.css`. Bundled after `friends-front.js`. |
| `rooms.js` | 588 | `window.MefiRooms`: Friends › Rooms. Lists rooms with the one action each needs (open, ask to join, accept or decline an invite, cancel a request); has Requests and Invites tabs, making a room, and a room view with chat (text only, `<@id>` shown as @name), invite by member search, lock/unlock, close and leave. Everything goes through main's `hub:room` channel (`HUB_ROOM_METHODS`) plus `hubStatus`/`hubConnect`/`hubRooms`/`hubSubscribe`; the hub's refusal reasons read as plain sentences. `pending()` feeds the Friends badge. Bundled after `companion-friends.js`. |
| `git-sync.js` / `git-sync.css` | 1,591 · 246 | `window.MefiGitSync`: the Git chip, its popover and the Save and push, Publish, Link and Sign in dialogs, drawn from the model `git-host.cjs` pushes on `git:state`. Mounted by `nav.js` (the section bar's tail) and `vibe.js` (the project cluster); bundled after `camera-tour.js`. |
| `daily-paper.js` / `daily-paper.css` | 369 · 139 | `window.MefiDailyPaper`: the launch screen as The Studio Daily. `startup.js` calls `show()` before it draws the chooser; the paper fills `#paper-mast`, `#paper-news` and `#paper-note` around the untouched `.boot-card` from `newsEdition` / `onNewsEdition`, and `boot.js` puts its `controls()` after the chooser's in the Tab cycle. Also keeps Settings › General's Daily news switch (`settings.ui.dailyNews`). Bundled after `startup.js`. |
| `pc-sync.js` | 439 | `window.MefiPcSync`: the Your PCs card that `companion-hub.js` mounts in Friends, and the count it badges the Friends bubble with. It shows this PC against GitHub and offers Sync this PC and, when both sides moved, Put my commits on top of GitHub's. Its wording comes from `scripts/sync.mjs` through `syncStatus`, `syncRun` and `onSyncEvent`. Its Set up this PC section (the `pcSetup*` bridge methods, `scripts/pc-setup.cjs`) checks nothing until opened. Bundled after `together.js`. Its Reach this PC from Discord section (`remote:*`) holds the switch, this PC's name, the alerts, quiet hours, the digest hour, the approval PIN and the last commands this PC answered. |
| `pc-vault.js` | 468 | `window.MefiPcVault`: the two sharing sections in the Your PCs card. Share between my PCs (make or pair the vault, the pairing code on request, every PC's line, shelves with what Studio found, what the other PCs shared, the library, keys and setup behind the exact typed phrase) and Share with friends (preview then save a scrubbed `.mefishare`, or open one for review). Text only; key values never reach it. Bundled after `pc-sync.js`. |
| `camera-tour.js` | | `window.MefiCameraTour`: Zen's branch tour through `idle.js.setDirector`, plus automatic Overview's bounded pan/scale lens. Uses painted layout anchors and the real canvas projection; the overview lens fits every branch without moving anchors. The tour's `velocity()` carries pan, zoom and tilt into the glide home. Bundled right after `idle.js`. |
| `demo-panel.js` | 507 | `window.MefiDemoPanel`: the owner-only demo mode for streams. It does nothing unless that machine's `settings.ui.demoPanel` is `true`, which no Settings control writes. With it on, a card drops out of Command's Work tab every three minutes: what Studio is, how it works, how to get it, the Discord. It sits in its own fixed layer so the tree never refits. Ctrl Alt Shift D turns demo mode on and off; Ctrl Alt Shift F is Zen now (`MefiIdle.enterZen`). Bundled after `community.js`. |
| `config-dialog.js` / `config-dialog.css` | | `window.MefiConfig`: Configuration (Ctrl Shift ,), every `settings:*` record in one searchable tree under seven categories (by page, then by words), opening the real control; holds the interface scale (`ui:zoom`). |
| `autonomy-ui.js` | 241 | Shared permission controls, elevated warnings, decision learning, model-strength views and the Why/Undo/For you panel. `setLevel(level)` sets the mode from anywhere (Search's "Set permission mode" rows in layout v2). |
| `file-inputs.js` | 58 | Bounded UTF-8 file drops and picker imports into editable drafts, with project and surface guards; wired by Home, Vibe and Plans. |
| `agents.js` / `agents.css` | 898 · 225 | The Agents workspace: relocated setup controls, scoped drafts, presets and shared operational state, and the Rules card in Team & models (live character and token counters, the two file switches, its own Save and Discard). |
| `studio-ui.js` / `studio-ui.css` | 491 | Scrollbar-free overflow, accessible dropdowns, shared appearance presets and shared glass surface recipes. The stylesheet follows the base page styles; component styles keep their layout and semantic status colours. |
| `companion-ui.js` / `companion-ui.css` | 384 | The stable adaptive companion panel: hover ownership, dragging, pinning and safe edge roaming. |
| `companion-hub.js` / `companion-hub.css` | 481 | The shared glowing wisp, ASCII reactions (a plain check without faces), bounded particle bursts, thinking state, petting, idle play and dozing, the setup companion, and the accessible glass bubble menu (Talk, What I'm doing, Needs you, Suggest work, Friends, Personality). It reuses the existing chat, requests, inbox, backlog picks, room connections and audio-link state. |
| `companion-friends.js` | 265 | `window.MefiCompanionFriends`, Friends › Playground: friends' companions out in your rooms, scripted playdates (and Practice with Pip), per-friend and per-room sharing, the share-back ask and What was sent. Everything comes from main's "Companion friends" block through `hubFriends`, `hubSharingSet` and `hubPlaydate`. Bundled after `pc-sync.js`. |
| `motion.js` | | `window.MefiMotion`: motion for menus that rebuild their rows. `keep` (rows keyed by `data-key` stay still and glide, new ones cascade, leavers fade as ghosts), `swap` (a view change that fades through, sliding the way you went), `enter`, `glide` (a selection mark) and `tally` (a counting number). No-ops with motion off or without layout, so fake-DOM suites run without it. |
| `trace.js` / `trace.css` | | `window.MefiTrace`: the Trace sheet (Live, `trace`), Studio's logs as channels with search, tail, level and source chips, problems only, follow, copy and open file. |
| `patch.js` | 173 | `window.MefiPatch.morph(host, source)`: a keyed DOM patcher, so a push never rebuilds what the person is using. Makes `host`'s children match an HTML string, element or fragment by changing only what differs: `data-key`/`id` nodes keep their identity through moves, a focused field keeps its draft (its value only follows the markup when the markup's own value moved), scroll and open `<details>` survive, `data-keep` players and frames are never touched inside and move with `Node.moveBefore`, script-owned attributes are listed in `data-mp-own`, and inline handlers, `javascript:` URLs, `srcdoc` and scripts are never copied over. Checked in a real renderer by `tests/patch_render.test.mjs`. |
| `review.js` / `review.css` | 765 · 83 | The "Changes and checks" section of a task's Evidence tab (Tasks › a task › Evidence): Changed files (diff on demand, Accept changes, Revert file, Revert attempt behind a second press, Undo), Checks (advisory, never colour-only), Preview (Before / After) and the three switches under "What Studio keeps for each attempt". Polls every 6 s only while open and visible; the host pushes `review:changed`. `mount(host, { taskId, projectId, panel })` draws one panel on its own (Changes, Checks or Preview) for the session inspector, with `counts` and `onChange` for the live tab counts. Bundled after `tasks.js`. |
| `composer-pictures.js` / `.css` · `composer-picker.js` / `.css` | 193 · 28 · 310 · 23 | Home's message box: `window.MefiComposerPictures` (Attach picture, paste, drop, thumbnails and the note about what the model can see) and `window.MefiComposerPicker` (typing `@` offers files, `#` tasks and `/` skills in a popup that answers the keyboard first, with chips for what a message points at). Bundled after `startup.js` and before `workspace.js`, which they attach to. |
| `size.js` / `size.css` | 711 · 259 | `window.MefiSize` (layout v2 only): Size and density. The model for interface scale, text size (`--text-scale`), density (`data-density`, now with Spacious) and detail (`data-detail`), saved in the appearance store (`mefiStudio.appearance`, version 2, old reader and a backup kept); the page (Configuration › UI & Surfaces, Search, Settings › Appearance) with four controls, a read-only Panels table and a live miniature drawn from the same tokens under its own scope, so the window changes only on Apply (with Undo). The stylesheet defines the `--d-*` density tokens, the detail tokens and the `--f12`…`--f22` type ladder the new regions size themselves with. With the layout off it does nothing. Bundled after `config-dialog.js`. |
| `skills.js` / `skills.css` | 459 · 64 | `window.MefiSkills`: Agents › Setup › Skills (`skills`; also in Search): the skills the project keeps, an editor with live checks, starters, import from a folder, export as a folder or zip, delete behind a second press, and a read-only state; other tools' skills are listed read-only. Bundled after `review.js`. |
| `shell.js` / `shell.css` | 1,553 · 308 | `window.MefiShell`: the 0.5 layout's frame (`html[data-layout="v2"]`, off by default). The top bar sits in the local navigation's row: list toggle, Vibe | Build switch (Ctrl M), trail, Search, "N need you", "N working" with pause, inspector toggle. List and inspector columns have splitters (drag, arrows, double-click reset) and, in small windows, drawers. A tab strip row, a `main` host and a status bar (Layout menu, running, waiting, usage meters, then the player, the machine's load from the `machine:status` push, today's cost and the permission mode, only with data). Each mode keeps its own widths in `mefiStudio.shell.layout.v1`. Modules put content in regions with `mount(region, key, elementOrFactory, {title, order})`. Search lists what the frame does (switch the mode, pause new work, show or hide the list and the inspector, Reset layout: `shell-do-*`), and `shell.css` holds Search's v2 look. Also the way in: the Settings switch "Try the 0.5 layout", Search's "Switch layout" and `MEFI_STUDIO_LAYOUT`. Bundled after `skills.js`. |
| `tabs.js` / `tabs.css` | 1,655 · 156 | `window.MefiTabs`: layout v2's tab strip, drawn into `MefiShell.region("tabs")` and sized through `MefiShell.resize`. A tab is a remembered route (`{ id, params }`), never a live page: the strip asks `MefiNav.go` for the page and follows where the app really is (`mefi:nav`, the body watcher, `MefiNav.current()`, readers). Each managed behaviour has a switch in the Tab behaviour card (`configCard`, shown in Configuration › UI & Surfaces and from the strip): preview tab, an agent that needs you, idle close, the cap with Undo, Recently closed, the pin suggestion; keys Ctrl+T/W/Tab/1–9, listed in Search under Tabs (`tabs-do-*`). Tabs are kept per project (`mefiStudio.tabs.v1.<projectId>`) with global pins (`mefiStudio.tabs.global.v1`). Starts only in layout v2 with a `MefiShell`. Bundled after `shell.js`. |
| `sessions.js` / `sessions.css` | 2,367 · 314 | `window.MefiSessions`: Build's desktop inside the 0.5 frame (`html[data-layout="v2"]`, off by default; `?sessions=off` switches it off). The session list (Needs you, Running, Review, Queued, Done; Sessions \| Backlog; filter; row menu; Ctrl N, which Search lists as New task), the thread (brief with its pictures, runs, live line, question dock, "Mefi decided", banners, shots and lightbox, the Note \| Ask \| Change box) and the inspector (Plan, Changes, Checks, Preview, Agent), mounted into `MefiShell`'s list, main and inspector regions. Task logic comes from builder.js, review.js and tasks.js; nothing is drawn, listened to, stored or asked of the host with the layout off. |
| `alerts.js` · `report.js` · `whats-new.js` · `host-cards.css` | 182 · 207 · 196 · 72 | What the host tells you, in Studio: Settings › General › Notifications (switches, quiet hours, generic or titled words, a test button) and the click routing for `alerts:open`; the Report a problem card in Diagnostics (preview every file, Save zip) with the "Studio closed unexpectedly" toast; the "Studio updated to X" toast, its What's new sheet and the list in Settings › Updates. Each waits for the startup gate. One stylesheet is shared. Bundled after `pc-vault.js`. |
| `worktrees.js` / `worktrees.css` | 344 · 63 | `window.MefiWorktrees`: Work › Worktrees (`worktrees`), every git worktree of the open project, worst first, with what to do about each: which hold work only this PC has, which are on GitHub but not merged, which are merged and safe to remove. Open folder, Merge into main (a second step offers a merge commit when main has moved, or "Merge anyway" while agents work), Remove (two presses; a folder holding uncommitted files asks once more and keeps a copy) and Forget missing folders; the switch under the title turns per-run worktrees on. A run's row names its task and is left alone while the run works. It reads on open, every 15 s while shown, on focus and when a run starts or ends, and skips a repaint that would change nothing. `peek()`/`summary()` feed other surfaces. |
| `builder.js` / `builder.css` | 1,449 · 343 | `window.MefiBuilder`: Build's Home as a coding-agent desktop (`html[data-home-layout="sessions"]`; Search › Switch Home layout, off by default). The menu lists this project's tasks like sessions (Chat with Mefi, Pinned, Needs you, Working, then by day); the page opens on a greeting card with work stats (tasks, runs, tokens, active days, peak hour, top model, a 22-week heat map) over the composer, with chips for the project, its branch, the permission mode, the coding worker and Worktree; a task opens as a session with its brief, runs, checks and a Note / Ask / Change composer. A task whose run has its own worktree wears a branch mark (from `MefiWorktrees`). `workspace.js` still owns Home's data and host calls. The session logic (groups, what a task offers, how a question, note, Ask and Change go through, the chips' host calls) is exported as a kit that `sessions.js` reuses, so the two layouts cannot disagree. |
| `panes.js` | 375 | `window.MefiPanes`: panels that dock beside the page or pop out as movable, resizable windows, closable and remembered. A pane's element itself moves, so drafts, scroll and open disclosures survive. |
| `fleet.js` / `fleet.css` | 1,239 · 280 | `window.MefiFleet`: Live › Fleet (`fleet`), the open project's team as OpenRig draws a rig ([fleet-overhaul-plan.md](fleet-overhaul-plan.md)). An explorer of pods and seats, then Graph (the branches), Table, Recent, Tree and Health, and a seat inspector (now, generations, wires, Stop / Open task / Open in Command). Everything comes from `fleetSnapshot` and `onFleetUpdate`; it holds a `fleetWatch` lease only while on screen and paints at most once a frame. Bundled after `trace.js`. |
| `fleet-layout.js` | 242 | `window.MefiFleetLayout`, pure and vm-tested: pods as columns of seat cards, every wire one orthogonal polyline with a lane of its own in the gutters and on the rails, the camera maths (`fit`, `zoomAt`, `constrain`), keyboard neighbours and the tidy tree. No DOM and no clock. |
| `analyzer.js` · `tracker.js` · `eyes.js` · `palette.js` · `graph.js` · `ideas.js` · `overhead.js` | 594 · 823 · 626 · 814 · 461 · 572 · 462 | Analyzer, usage tracker (Command's Usage popover and Models › Usage › Provider accounts; its host readers live in `main.cjs` from `const ACCOUNT_READ_TIMEOUT_MS` to `usageAccounts`, its parsers in `scripts/usage-tracker.cjs`), Activity and its evidence inspector, Search (Ctrl K starts with Recent, kept per project in the window's storage; `task …` and `idea …` add one from the box; both switchable: `settings.ui.searchRecents` / `searchQuickCreate`, `MEFI_STUDIO_NO_SEARCH_RECENTS=1` / `MEFI_STUDIO_NO_QUICK_CREATE=1`; in layout v2 it reads as the 0.5 prototype's: one line per result under Recent, Sessions, Backlog, Places, Actions, Layout, Tabs, Permission mode and each section's pages, twelve rows, the empty box the sessions that matter, the rail's places and the records marked `paletteBrowse`; a record may say `paletteGroup` and `paletteHint`), Catalog insights, Ideas (with Recently deleted in its Tools) and Overhead. |
| `model-community.js` | 252 | `window.MefiModelCommunity`: Models › Performance › Community, the community feed for one model (ratings, release-note claims, observed strengths and weaknesses, opinions, tips, Discuss on Discord) and the Run probes panel with progress and Cancel. textContent only. |
| `startup-marks.js` | 118 | `window.MefiStartupMarks`: the page's half of the startup marks (script start, DOMContentLoaded, each launch-gate step, the choice and the release), sent once to main. First in the bundle; `booklet.js` runs `MefiBoot` through its `wrapBoot()`. `?marks=0` takes none. |
| `boot.js` · `model-lab.js` · `profiler.js` · `task-groups.js` · `startup.js` · `performance-core.js` · `sidebar.js` · `stage-labels.js` | 271 · 284 · 206 · 188 · 158 · 107 · 111 · 40 | Startup readiness, Model Lab, the live profiler, read-only task grouping, the launch screen, bounded measurements, the project menu, and one vocabulary for task badges. |

The bundled `media-browser.js` and `music.css` provide the browser toolbar,
welcome page and viewport inside the existing media player.
`scripts/media-browser.cjs` attaches a sandboxed WebContentsView to Studio's
existing window and owns its session, navigation and sender-checked IPC.
Its bounds follow the visible viewport as the panel scrolls, keeping website
controls inside the panel without reloading the page.
The main preload exposes controls only to Studio; websites have no preload.

Thirty stylesheets are inlined, in the order of `BOOKLET_INPUTS.styles` in
`scripts/build-booklet.mjs`, so a later one wins a tie with an earlier one.
The main ones, in that order:

| File | Lines | Purpose |
| --- | ---: | --- |
| `styles.css` | 5,061 | The Club Blackout theme: its tokens and most surfaces. Its section order is load-bearing, as its header explains. |
| `music.css` | 832 | The music room, plus the theme tokens that also colour Command and the boards. |
| `planning.css` · `brains.css` · `profiler.css` | 329 · 458 · 45 | The Plans sheet, the brain-map editor and the profiler overlay. |
| `trace.css` · `fleet.css` · `config-dialog.css` | 53 · 280 · 81 | The Trace sheet, Live › Fleet (its wire colours are named once, from theme tokens) and Configuration. |
| `worktrees.css` | 63 | The Worktrees page: one card per worktree with the verdict on a coloured edge. Theme tokens only, no text under 12 px. |
| `builder.css` | 342 | Build's sessions layout: the session menu, the greeting card and heat map, the composer and its chips, the task page and the panes. |
| `agent-brain.css` · `agents.css` · `companion-ui.css` | 359 · 191 · 44 | The Agent brain surfaces (sheet, Home hub, companion), the Agents workspace and the companion panel. |
| `studio-ui.css` | 623 | Shared overflow, dropdown and glass recipes, after the page styles. |
| `companion-hub.css` · `vibe.css` · `setup-helper.css` | 313 · 732 · 161 | The companion bubble and its menu, Vibe, and the setup helper. |
| `git-sync.css` | 246 | The Git chip, its popover and dialogs. |
| `daily-paper.css` | 139 | The launch screen's front page, only while the gate asks for a project with the paper on. |
| `chrome.css` | 266 | The Chrome theme (the default for a new install): matte surfaces, brushed-metal primary buttons and chosen segments, a thin chrome edge on what is selected, and the iridescent layer over them in the website's `--chrome-holo` tokens (a faint tinted ground and sheen, 2px holo bars and lines on the selection edges, holo hairlines between the bars, a holo meter, switch and project mark), drawn as border images so nothing moves. Every rule under `html[data-studio-theme="chrome"]` (only the Chrome swatch in the pickers looks like metal everywhere), paint only and static, last so it wins a tie; `tests/chrome_theme.test.mjs` holds it to that. |

`npm run check` runs `check-css.mjs --unused` over all of them, and `--merge`
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

- **`tests/*.test.mjs`** (500 files) run on Node's own `node:test` and
  `node:assert/strict`, with no test dependencies. `scripts/run-node-tests.mjs`
  is the runner; `npm run test:fast` skips the real-Electron suites and the
  Python stage.
- **Many suites never import `main.cjs`.** They read it, slice a named section
  between two literal marker strings, and evaluate the slice in a `vm` sandbox
  whose collaborators are stubs. So a new identifier used inside a sliced
  section needs a stub in every suite that slices that section, and moving a
  marker breaks a suite in a way that can look like flake.
- **The GitHub link** has six: `git_link`, `git_actions` (real git in temp
  folders, a local bare repository as "GitHub" and a fake `gh`), `git_host`,
  `git_link_host` (the `main.cjs` block and the bridge), `git_sync_ui` and
  `startup_screen` (each `.test.mjs`); none reaches GitHub.
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
- **The layout contract** (room for a session list, an inspector, a tab strip and
  a status bar; `docs/unified-studio.md`) is pinned by
  `layout_contract_nav.test.mjs` (the one writer of `html[data-layout]` and
  `data-layout-fold`, the clamps and the 320 px budget, the fold, `usable()`,
  the events) and `layout_contract_css.test.mjs` (every moved declaration
  evaluated as CSS would: unchanged with the regions at 0, moved by exactly its
  region otherwise; every remaining raw `--shell-rail-w` or `--shell-local-h`
  read named). `layout-contract-ledger.json` lists the 73 declarations that moved and are still there.
- **Size and density** is pinned by `size_model.test.mjs` (limits and steps, the
  old stores, launch painting, Apply/Undo/Reset, broken storage, events),
  `size_page.test.mjs` (the page and its miniature: every combination of the four
  controls gives the miniature its own tokens and the root none until Apply),
  `size_css.test.mjs` (the tokens, nothing under 12 px, no scroller gutters) and
  `size_render.test.mjs` with `fixtures/size-render-electron.cjs` (real Chromium
  at five window sizes with a real zoom bridge, real pointer and keys).
- **Today and the Inbox** are pinned by `today_model.test.mjs` (the count is the
  digest's list, kinds and options, the four groups and the done-today window,
  detail levels), `today_inbox.test.mjs` (every kind and action calls the right
  host stub once and refuses a second press; free answers, Decided lines, Undo,
  keys, the pill as a toggle, the notification hand-off), `today_page.test.mjs`
  (the front door borrowed and given back, the board at each detail level, cards
  that open their task), `vibe_model.test.mjs` (`MefiVibe.data()` and `watch()`,
  and that Vibe does exactly what it did with no watcher), `alerts_click_count.test.mjs`
  and `today_render.test.mjs` with `fixtures/today-env.mjs` and
  `fixtures/today-render-electron.cjs` (real Chromium at five window sizes with
  the backdrop visible, real Tab order and pointer, answers through a stateful
  fake bridge, light and dark contrast, v1 untouched).
- **The 0.5 frame** is pinned by `shell_frame_state.test.mjs` (regions built once
  and removable, presets and per-mode persistence, clamps asked through the layout
  contract, drawers, keys), `shell_frame_bars.test.mjs` (top bar, pills, feed, the
  inbox chain, status bar and Layout menu), `shell_frame_splitters.test.mjs`,
  `shell_frame_wiring.test.mjs` (v2 off touches nothing, the way in, the exact
  `MefiShell` surface, every CSS rule scoped to `html[data-frame]`),
  `shell_frame_css.test.mjs`, `usage_tracker_brief.test.mjs` and
  `shell_render.test.mjs` with `fixtures/shell-render-electron.cjs` and
  `fixtures/shell-vm.mjs` (real Chromium at five window sizes, both modes, real
  key and pointer events, drawers at 600x560).
- **The tab strip** (layout v2; `renderer/tabs.js`) is pinned by five fake-DOM
  suites over `fixtures/tabs-env.mjs` (a stub nav and shell, a controllable clock
  and timers, measurable geometry): `tabs_model` (preview, pins, the cap, Undo,
  idle close, Recently closed, needs, the suggestion, the settings),
  `tabs_observer` (every way a page can open, and v1 doing nothing at all),
  `tabs_persist` (records, keys, bad storage, projects), `tabs_strip` (fit, "N
  more", the one-menu strip, keys, drag, menus, the Add menu, the card, ARIA) and
  `tabs_host` (`MEFI_STUDIO_NO_TAB_MANAGER`, `saveResume`, the Configuration card,
  the build registration, the chords the app already binds); and by
  `tabs_render.test.mjs` with `fixtures/tabs-render-electron.cjs` (real Chromium,
  about two minutes: five window sizes, real input, real pages, a reload, v1
  untouched, Ctrl+W against the application menu's own template).
- **The session panels** (layout v2; `renderer/sessions.js`) are pinned by
  `sessions_list`, `sessions_thread`, `sessions_inspector` and `sessions_edges`,
  which run the real builder.js in a shared fake DOM (`fixtures/sessions-env.mjs`,
  with a stub shell and review), by `builder_kit` (the exports sessions.js uses),
  `review_panels` (one panel on its own, and the Evidence fold reading as soon as
  it opens) and `image_read` (the host channel), and by `sessions_render.test.mjs`
  with `fixtures/sessions-render-electron.cjs` (real Chromium at six sizes, real
  input; the shell's regions are a stand-in there, the real frame is covered by
  the shell and tab suites).
- **The fleet** is pinned by `fleet.test.mjs` (the reducer: seat continuity on a
  retry, wires, health, bounded reload, no prompts or paths in a snapshot),
  `fleet_host.test.mjs` (pushes only while watched, one trailing push per half
  second, per-project files), `fleet_layout.test.mjs` (no overlap, only
  horizontal and vertical segments, one lane per wire, the same picture every
  time), `fleet_ui.test.mjs` (the sheet in a `vm` fake DOM: rows keep their
  identity, no lease while hidden, keyboard) and `fleet_render.test.mjs` with
  `fixtures/fleet-render-electron.cjs` (real Chromium at five window sizes and
  five views: nothing overflows, every seat has a card in view with none
  overlapping, the inspector drawer never covers the selected seat, a push
  repaints, the arrows walk the explorer, Escape clears the selection and
  closing gives the watch lease back).
- **Permissions** are pinned by `autonomy_ui.test.mjs` (saved controls,
  warnings, learning scopes, scoped history actions and failed saves;
  `vibe_pipeline` also covers one-line suggestions, item-bound errors and
  unread IDs beyond sixty replies), `autonomy_render.test.mjs` with
  `fixtures/autonomy-ui-electron.cjs` (an isolated 1920×1080 Chromium proof of
  saved modes, Undo and to-dos, suggestions, inline chat, elevated warnings and
  focus returning from the orb's drawer) and `chat_decisions.test.mjs`
  (permission gates, scoped inbox identity, bounded shared context and the
  outer companion's provider readiness).
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
- `tools/verify_fleet.cjs` boots the app's own `main.cjs` in smoke mode on a
  throwaway profile (it refuses to run on any other) and drives Live › Fleet
  through the real preload bridge, handlers and fleet host:
  `node_modules/.bin/electron tools/verify_fleet.cjs`. The fleet suites fake
  the bridge; this is the check that the wires behind it work, with no project
  open.
- `tools/profile_live_studio.mjs` captures bounded metrics and optional CPU
  samples from the running Studio through a PID-checked loopback inspector.
  `tools/profile_scroll_controls.cjs` compares scroll-control versions in an
  isolated renderer, including geometry and behavior parity.

## Where to look when…

- **the tab strip does something you did not ask for:** `renderer/tabs.js` (each
  managed behaviour is read through `eff()` and has a switch), the Tab behaviour
  card in Configuration › UI & Surfaces, and `MEFI_STUDIO_NO_TAB_MANAGER=1`;
  [architecture.md](architecture.md) "Tabs you add and pin" walks it.
- **the session list, thread or inspector does something you did not ask for:**
  `renderer/sessions.js` (it only reads what `MefiWorkspace`, `MefiBuilder` and
  `MefiReview` hold), `?sessions=off`, and [architecture.md](architecture.md)
  "Build's desktop in the 0.5 frame".
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
