# Studio layout, navigation & workflow audit — September 21, 2026

Read-only audit of the renderer, the settings layer and the day-to-day agent
workflow at `316c492` plus the uncommitted eyes-worker work. The browser-only
build (`npm run start:web`) was rendered at 1440×900 and every surface was walked;
three parallel code audits (navigation, settings, workflow) produced the
citations below, and the load-bearing claims were re-checked by hand. Counts
marked "live DOM" were read from the running page. Nothing in the repository
was changed. `T:` means `renderer/booklet.template.html`, `M:` means
`main.cjs`.

## 1. The shape of the problem: three shells stacked on one page

The app is three generations of UI that were never merged. Each generation
brought its own navigation, its own settings, its own chat, its own task list
and its own run controls, and all three are still live.

| Generation | Chrome | Navigation | Settings it owns | Chat | Task list | Run controls |
|---|---|---|---|---|---|---|
| **Booklet** (model catalog era) | `<header>` "Studio tools" with Refresh (R), Print / PDF, opencode.ai link (T:127-143); tabs row 1–4 (T:145-156); footer "Sources…"; hover tree rail (T:448) | 4 tabs + "More tools" details | Tab 4 "Settings & connections" (19 inputs, live DOM) | none | none | none |
| **Command** (constellation era) | `#idle-hud` "Command center" (T:480-715) | bottom dock, 16 items incl. its own "More tools" (live DOM) | rail "Settings" = Work settings (T:626); Ambience & startup pop (T:527); node info-card steppers (idle.js:6860) | rail Assistant tab **and** node-selected feed chat (T:549, 589) | rail Work / Up next; composer "Add a task…" (T:501) | Autopilot, Parallel builds, Build mode, New work ×2, Stop all, Restart |
| **Workspace** (companion era) | `#workspace-layer` (T:82-125) | hover sidebar (T:59-80) with its own "Studio tools" drawer | sidebar "Make yourself at home" (T:77); Auto build + Agent mode in "Your work" (T:102-108) | conversation thread + composer (T:89-94) | "Your work" All / Queue / Ideas / Review / Done (T:117) | Stop all, Restart, Pause, Work through backlog |

Measured from the live DOM: **18 destinations reachable through 82 nav
buttons** (Task board 10, Plans 8, Analyzer / Explorer / Ideas 7 each,
Onboarding 6), **11 overlay sheets**, **4 assistant composers**, **6 task
surfaces**, **15 settings surfaces**, **5 pause-like switches**, "More tools"
menus in **3 places** plus a copy in every sheet header (nav.js:874).

## 2. Layout and navigation findings (ranked)

1. **Three navigation systems for one app.** Sidebar (Workspace), tabs row +
   "More tools" (Booklet), dock + "More tools" (Command). The registry in
   nav.js:50-445 is sound; the problem is that it renders into three chromes
   (nav.js:813-945) instead of one.
2. **The project list is behind an invisible control.** The sidebar, the only
   place projects are added or switched, opens on hover of a fully transparent
   6 px strip (`.sidebar-edge`, live computed width 6 px, background
   transparent; sidebar.js:63-75) and is `inert` otherwise (T:61). The
   walkthrough's first instruction is "Start with Projects in the sidebar"
   (T:1019) with nothing on screen to find. Adding a project then jumps the
   user into the Analyzer overlay unasked (workspace.js:653-654).
3. **One view, four names.** Command is "Command view" (nav.js:69), "Command
   center" (T:485), "Node tree" (sidebar T:66) and "Command constellation"
   (T:480), while the hover rail is *also* "Node tree" (T:449). "A-Eyes" is the
   eyebrow on five sheets that are not the Eyes tab (T:743, 797, 831, 886,
   930) while the Eyes tab itself is "Activity & evidence" / "Activity" /
   "A-Eyes" depending on where you read it. Settings is `studio` in ids, docs
   and `data-nav`. Model Lab is `graph`, and "Graph view" is also the Ideas
   toggle (T:795). Plans and Ideas share one glyph (nav.js:190, 208).
4. **Booklet-era chrome survives on tabs 1–4.** Refresh, Print / PDF and the
   opencode.ai link are catalog features shown as app-level header actions;
   the header, tabs row, footer and tree rail all vanish in Workspace and
   Command (styles.css:2173), so the app visibly changes skin per view.
5. **Global single-letter keys misfire across modes.** R re-reads the catalog
   from Workspace/Command with no feedback (nav.js:361-372); `/` from Command
   silently switches to the Booklet; G pins a rail that Workspace hides;
   1–4 exit Workspace. Plans, Music and Profiler have no key at all. There is
   no native application menu (`setApplicationMenu` absent; `autoHideMenuBar`
   M:11310), so Alt reveals Electron's stock menu.
6. **Registry bypass.** tracker.js:243-247 exits Command and switches tabs
   directly instead of through `MefiNav.go`, so the "Back to Command" return
   state (nav.js:596-604) is never recorded, contradicting nav.js's own header
   rule.
7. **Sidebar information architecture.** Task board and Plans are promoted;
   Ideas, Explorer, Analyzer, Overhead and Profiler are buried in a "Studio
   tools" drawer; Settings, Music and Start here are ghost buttons at the
   bottom; "Make yourself at home" holds theme and motion settings that also
   live elsewhere.

## 3. Menus and surfaces that are outdated or not fully set up

| Surface | State | Evidence |
|---|---|---|
| Model Lab › **Compare** | Visible tab with a "Planned" pill and an empty "no comparison runs start from this view yet" card | T:184, T:203 |
| Explorer › Assistant badge | Hard-codes `deepseek-v4.1-flash`; no JS writes `#assistant-model`, while routing supports seven providers with per-provider models | T:957; T:355-363 |
| Sidebar › Studio theme | Six options; Rose and Custom (music.js:6-13) are missing, so `syncThemeChoice` assigns a non-existent value and the select goes blank; `workspace.accent` never updates | T:77; workspace.js:690-694 |
| Settings › Intake classification | Template default unchecked, backend default on; flashes wrong until `refreshJev` runs | T:432; M:1169; booklet.js:493-497 |
| Settings › "Optional · Ruins Runner & Love2D" | Game-era launcher block inside the app's only settings tab | T:462 |
| Header › Refresh / Print / PDF | Catalog-only actions presented as app-wide | T:138-140 |
| Palette › "Machine status" and `data-nav="machine"` | Actions that just open Explorer, labelled as surfaces | nav.js:396-409; T:494 |
| Command empty-state "desktop-only" buttons | Three extra `data-nav` buttons live in the desktop DOM | T:704-705; idle.js:2852-2855 |
| Dead IPC | 8 preload exposures with zero renderer callers: `refreshCatalog`, `eyesChanges`, `eyesTodos`, `assistantProactive`, `assistantQuestions`, `assistantAsk`, `machineWatch`, `onStudioExit`; `studio:exit` is pushed by main with no subscriber | preload.cjs:13, 42-43, 54, 67-68, 104, 117 |
| Docs | README "Keys" line uses internal ids (Booklet · Graph · A-Eyes · Studio); "Studio tab launches Ruins Runner" (it is Settings); `M` listed as global (Command-only, idle.js:7440); GETTING_STARTED says "Open, Review, Done, Ideas" (tabs are All / Queue / Ideas / Review / Done) and puts Auto build "above Your work" (it is inside the backlog panel) | README.md; GETTING_STARTED.md; T:117, 99-102 |

No `TODO`/`FIXME` strings exist in the renderer, every `data-*` switch has a
handler, no template section is orphaned and no CSS id selector is dead
(`npm run check:css:unused` and `npm run audit` both pass). The problems are
structural, not missing wiring.

## 4. Settings and customization

**Fifteen places to configure the app** (agent 2's count, verified against
the live DOM for the six largest): Settings tab (19 inputs), Music & themes
overlay (29 controls), Command Ambience pop (6), sidebar personal drawer (4),
Command rail Work settings (3), Workspace backlog panel (2), plus the Explorer
(Proactive, Auto-kill, Memory warn override), the Tasks "Context &
references" drawer, the Command node info-card steppers, the walkthrough
sheet, the tray menu, palette actions, and CLI flags / env / hand-editing
`settings.json`.

**Duplicated controls with drift between copies**

| Control | Copies | Notes |
|---|---|---|
| Auto build / Build mode | ×3 (T:102, T:636, T:1019) | same pref |
| Agent mode | ×2 (T:108, T:512) | |
| New work | ×2 (T:557, T:620) | |
| Parallel builds | ×2 (T:635, idle.js:4235) | rail caps at 3, backend allows 12 (M:3129-3133) |
| Stop all / Restart | ×3 (T:89, T:631-632, T:979-980) | |
| Motion | ×2 | header `mefiStudio.motion` (booklet.js:892) vs sidebar `workspace.motion` (workspace.js:698); neither syncs the other |
| Autopilot ↔ Proactive | coupled | rail "Autopilot" and Explorer "Proactive" write each other (M:11036, 11082); turning Autopilot off silently flips Proactive |

**Two stores, no sync:** theme (`workspace.accent` vs `music.v1.theme`),
motion (two localStorage keys), launch view (`settings.ui.commandHome` **and**
localStorage `mefiStudio.commandHome`, idle.js:8097-8098, read in two orders at
boot, booklet.js:937 and 962-967). Theme and all appearance state live only in
localStorage, never in `settings.json`, so they do not survive a profile
reset and cannot be exported.

**The backend overwrites user choices.** The overseer rewrites
`assistant.parallel / aiParallel / foldAfterMinutes / staleAfterHours /
tidyDoneAfterHours` (assistant.mjs:616, M:4470-4473); a wedged start narrows
`ui.autopilot.parallel` with only a history line (M:8795-8800);
`backlogMode` is set true by "Work through backlog" (M:6358) and nothing sets
it false. Every Task board filter click writes `settings.json`
(tasks.js:544, 592).

**Knobs that exist with no UI:** `assistant.keepAwake`, `assistant.background`
(tray + close-to-tray, forced on), autopilot tick minutes (M:9600), machine
kill thresholds (M:228, 268), executor budgets and timeouts (M:2456-2495),
`ASSISTANT_MODEL`, `maxSessions`, retry counts (assistant.mjs:22-65),
`MEFI_STUDIO_*` env vars beyond the three documented.

**Verified absent:** start on boot, tray/background/keep-awake toggles,
notification preferences, log verbosity or log file, data-folder location,
per-project pause or capacity (rail copy says "Changes apply to every
project", T:631), settings export / import / reset, light theme
(`color-scheme: dark`, styles.css:15), density, font size, panel widths,
sidebar pin.

## 5. The dashboard gap

The landing view is Workspace (booklet.js:961-975). It shows one project's
conversation and backlog counts. The signals an operator needs are spread out
or missing:

| Signal | On the landing view? | Where it actually is |
|---|---|---|
| Pending assistant questions | **No** — no badge, toast or list; `nav.js:22` badges have no question count | Command rail Ask tab only (idle.js:1863) |
| Running workers / capacity | "working" metric + per-card progress (workspace.js:311) | Command Live work (idle.js:4173) |
| Queue depth / next | metrics + "Up next" line | Command Up next (3 shown), Task board |
| Failures needing attention | "need attention" metric, Review chip | Command `#idle-feed-attention` (T:592) |
| Machine status (lag / memory / leases) | **No** (`machine` has 0 hits in workspace.js) | Command pill → Explorer |
| Usage / budget / Go windows | **No** | Command rail bottom (T:681), Model Lab Tracker |
| Service state (which pause is active) | Collapsed to one string "New work paused" (workspace.js:464) | three different switches |
| Recent completions | Done chip | Command Done tab, Task board |

A loop that is blocked on a question, out of budget, or throttled by the
machine gauge looks idle from the landing view.

## 6. Workflow friction in the core loop

1. **Three "pause" controls with three semantics**, all reported as "New work
   paused": Workspace Pause → `assistantPause` only (M:5702); Work through
   backlog / Pause backlog → clears the breaker + `execute:false` + pause
   (M:6351-6357); Command New work → `execute` + resume (M:5710-5714);
   Explorer Pause; Stop all kills builders and pauses both (M:5703-5707).
2. **No per-task live output.** Live work cards link to the Task board
   (idle.js:4190), which shows journal notes (tasks.js:1132) and post-hoc
   checks; raw worker output is a global 5 s log tail on tab 3 (eyes.js:333)
   or Command's Technical log. Seeing one task's output costs three view
   switches.
3. **Five status vocabularies for one `stage` field**: `done` is "Confirmed"
   (tasks.js:406), "Done" (workspace.js:211), "Verified" (planning.js:100);
   `ready` is "Ready" everywhere but "Queued" in planning.js:110;
   `awaiting_verification` has three labels; Command prints raw store strings
   (idle.js:6344-6346).
4. **Write actions scattered by view**: delete / rename / archive / reopen /
   prereqs only on the Task board; plan decisions only in Plans; Activate /
   Absorb / Work on it only in Command; Stop all / backlog run only in
   Workspace; Keep / Scan / AI review only in Ideas. Command's Done bypasses
   `tasksAction` with a whole-store `tasksSave` (idle.js:1557-1576).
5. **Failure diagnosis is shallow**: `lastRunError` + `lastAttempt` only
   (tasks.js:1052, 1110); "Brief history" is brief revisions, not attempts.
6. **Chat is not reachable from tabs 1–4**, and the four composers share one
   thread with three copies of the quick-ask chips (T:560, 596, 970).
7. **Polling on top of pushes.** nav.js:1778 polls `tasksList` + `ideasList`
   every 20 s with no view gate while subscribing to the same pushes;
   tasks.js:1538 (15 s) and explorer.js:1333 (7 IPCs every 5 s, ~84
   round-trips/min while open) do the same; planning.js:497 and
   overhead.js:21 poll `tasksList` without subscribing to `eyes:tasks` at all;
   idle.js:7882 arms a 1 s timer at load that is never cleared;
   profiler.js:59 keeps sampling with its sheet closed. Every one of these is
   a main-process read on the box that is already starved (see
   [performance.md](performance.md) and the eyes-worker work).

## 7. How we work with Studio: the dev loop

| Friction | Evidence |
|---|---|
| **The copy you run is not the copy you edit.** The packaged payload's `main.cjs` is from 05:15 while the repo's is 07:49; `projects.cjs` and `eyes.mjs` are a day behind. The dev tree and the payload keep separate project stores (1 vs 2 projects). The single-instance lock blocks `npm start` while the payload runs. | `dist/Mefi Studio AI+/resources/app` vs repo (hashes compared 2026-09-21) |
| **A 1.6 MB build artifact is committed.** `renderer/booklet.html` changed in 18 of 49 commits (every renderer commit), 260 blobs in history, and it is a guaranteed conflict under the parallel sessions CONTRIBUTING.md describes. | `git log -- renderer/booklet.html` |
| **A 154 KB prose test log is committed per run.** `TESTRUNS.md` is touched by 31 of 49 commits; two of the last four commits are log-only. | `git log -- TESTRUNS.md` |
| **The check script is a hand-maintained 3.3 KB string** of 81 `node --check` entries, and `check-targets` fails when a new file is not added to it. | package.json `scripts.check` |
| **The full test run cannot finish on this machine**: `tests/jev_model_routing_host.test.mjs` never returns, and 127 tests fail at HEAD because of the uncommitted lag-gate work. | TESTRUNS.md head |
| **Every UI test hand-rolls its own fake DOM** (e.g. `tests/workspace_ui.test.mjs` defines its own `Element` class), so any template restructure means rewriting fakes in 22 files. | `tests/*_ui.test.mjs` |

## 8. Proposed target layout

**One shell.** A persistent left rail with five destinations and a project
switcher at the top; the assistant as a persistent right drawer with one
composer, available from every view, carrying the question badge.

| Rail item | Replaces | Contents |
|---|---|---|
| **Home** (dashboard) | Workspace landing, Command telemetry pills, Explorer summaries | Tiles: Service (one pause / resume control with the real state), Workers (running / capacity, click → live output), Needs you (questions, review, failures), Up next, Recent done, Machine (lag, memory, leases), Usage (today, Go windows, budget), Project (repo status, last activity). Each tile deep-links to its owner. |
| **Work** | Task board, Your work, Plans, Ideas, Overhead, rail Work / Done | One list with tabs Queue / Review / Done / Ideas / Plans, one filter state, one status vocabulary (`stageLabel()`), all write actions in one place, per-task page with attempts, checks and a live output pane keyed by session. |
| **Live** | Command view | The constellation, tree rail and Overhead as view modes of one canvas; no settings, no second chat. |
| **Models** | Model catalog, Model Lab | Catalog, Rankings, Usage / Tracker, Context; Compare hidden until it runs. |
| **Settings** | Tab 4, rail Work settings, Ambience pop, sidebar drawer, Explorer toggles, info-card steppers | Sections: Connections (keys, providers, routing, Jev) · Agents (autopilot, capacity up to the real max, build mode, agent mode, tick, budgets, retries, per-project overrides) · Machine (thresholds, auto-kill) · Studio (theme incl. custom colours, motion, density, launch view, tray / background / keep-awake / start on boot, notifications, data folder, export / import / reset) · Integrations (GitHub, updates, Ruins Runner) · Diagnostics (log level, log file, profiler). One store: `settings.json` for preferences, localStorage only for view state. |

Retire: the Booklet header and footer, the tabs row, the dock, all three
"More tools" menus, per-sheet link strips, the "A-Eyes" eyebrows, the
hover-only sidebar, the hard-coded model badge, the Compare stub. Keep the
palette (Ctrl K) and the registry as the single source of destinations; give
every destination a key that does not collide with Command's canvas keys.

## 9. Phased plan

| Phase | Scope | Risk to the in-flight eyes-worker work |
|---|---|---|
| **0 · Hygiene (small, first)** | Naming pass (Command, Eyes, Settings, Tasks); hide Compare; fix sidebar theme select; write `#assistant-model` from routing; tracker.js through `MefiNav.go`; delete the 8 dead exposures and `studio:exit`; one shared `stageLabel()`; correct README / GETTING_STARTED; add the missing keys. | Touches template + renderer only; rebuild `booklet.html` after the eyes-worker commit lands to avoid a conflicting artifact. |
| **1 · Dashboard** | Build Home from the pushes that already exist (`assistant:status`, `machine:status`, `eyes:tasks`, `eyes:requests`, `usage:tracker`); global question badge + toast; one pause component with the real state; remove the redundant polls in §6.7. | Renderer-only; reduces main-process reads, which helps the perf work. |
| **2 · Settings** | One Settings page; move every control there; unify stores; stop the overseer and wedged-start paths from rewriting prefs (make them suggestions on the dashboard instead); expose tray / background / keep-awake / start-on-boot / notifications / data folder / export-reset. | Needs small `main.cjs` changes (prefs whitelist, login item, notifications) — sequence after the eyes-worker commit. |
| **3 · One shell** | Left rail + assistant drawer; retire tabs / dock / More tools; sheets become routes; keyboard map. | Largest template change; do it once the UI tests share a DOM fixture. |
| **4 · Dev loop** | Generate `booklet.html` at package time instead of committing it (or commit only in release commits); glob the check targets; move TESTRUNS to a CI artifact or an untracked log; fix or quarantine the hanging test; one `npm run dev` that rebuilds, repackages and relaunches the payload; a shared DOM fixture for UI tests. | Independent of the renderer; can start now. |

## Phase 0 status — landed on branch `ux-phase0` (September 21, 2026)

Worktree `../mefi-studio-wt-ux-phase0`, branched from `c791fbd`. `npm run check`
(82 targets), `npm run audit` (zero findings), the renderer UI test files and
the host-side test files all pass; the rebuilt booklet was walked in the
browser build.

| Item | Change |
|---|---|
| One status vocabulary | New `renderer/stage-labels.js` (`window.MefiStage.label`), loaded first by the booklet build; adopted by the board (incl. the shared-task subtask rows), Your work, Plans and Command. Ready · Awaiting approval · Waiting · Working · Verifying · Needs attention · In a plan · Retry scheduled · Done (· Verified / · Confirmed by you) · Archived. |
| Naming pass | Command is "Command view" everywhere (sidebar, HUD heading, canvas label); the Command rail's "Settings" tab is "Work settings"; every task-board entry point says "Task board"; the five sheet eyebrows read Work / Monitor instead of "A-Eyes"; Ideas' toggle is "Feature graph"; Plans has its own glyph. |
| Outdated menus | Model Lab "Compare" tab hidden until it can run (arrow keys skip hidden tabs); Explorer assistant badge now shows the configured model instead of a hard-coded one; sidebar theme picker gained Rose and Custom and keeps the saved accent in step with the real theme; Intake classification default matches the backend. |
| Keys | `P` Plans, `U` Music & themes; README key line rewritten with the real labels. |
| Dead surface | Seven unused preload exposures and their main.cjs handlers removed (`eyes:changes`, `eyes:todos`, `assistant:proactive`, `assistant:questions`, `assistant:ask`, `machine:watch`) plus the subscriber-less `studio:exit` push; `catalog:refresh` kept (host tests use it). `tracker.js` now navigates through the registry. |
| Docs | README "Studio tab" → Settings tab; GETTING_STARTED tab names and Auto build placement corrected. |

Not in Phase 0: the Booklet header/tabs chrome, the hover-only sidebar, the
three pause controls, the dashboard, and the settings consolidation (Phases
1–3), and the dev-loop items (Phase 4).

## Phase 1 status — landed on branch `ux-phase0` (September 21, 2026)

Same worktree and branch as Phase 0. `npm run check`, `npm run audit` and the
renderer / host test files pass (307 tests, 0 failures); the landing strip and
the question toast were walked in the browser build.

| Item | Change |
|---|---|
| Studio at a glance | New landing strip `#workspace-dashboard` above the conversation with six tiles: **Service** (the real run state + the one Pause / Resume control), **Workers** (running builds → Command), **Needs you** (open questions + work to review → Ask tab or the Review filter), **Up next** (first queued task → Queue), **Machine** (lease / hold / memory / lag from the `machine:status` push → Explorer), **Usage** (5h / week windows or today's calls from the tracker → Model Lab). Painted only from pushes this module already receives plus one usage read on entry. |
| One pause control | The companion-bar Pause is gone; the Service tile's button pauses through `assistant:backlog-control pause` (every kind of new work held, the same hold as Command's New work switch) and resumes through `assistant:control start-work`. `runState()` in workspace.js derives Ready / Working / New work held / Assistant paused / Paused from the two real switches and feeds the tile, the button and the connection pill. |
| Global question badge + toast | nav.js keeps a `questions` badge from the `eyes:assistant` push, painted as a warning count on every Command entry point (sidebar, tabs row, registry-built buttons via the new `alert` badge kind). A new open question raises a toast with an **Answer** button that opens Command on the Ask tab (`MefiNav.go("command", { rail: "ask" })`; `MefiToast` gained an optional action). |
| Fewer polls | nav badge backstop 20 s → 120 s; Plans repaints from the `eyes:tasks` push with its poll as a 30 s backstop (was a 4 s read with no subscription); Overhead refreshes from the push with 15 s / 60 s backstops (was 5 s / 30 s with no subscription). |
| Docs | README "Workspace and work" and GETTING_STARTED "Follow the work" describe the strip and the single pause. |

Still open from the plan: the Explorer's 5 s × 7-IPC poll, the "Pause backlog"
label on the backlog button (same action as the Service tile's Pause), and
Phases 2–4.

## Phase 3 status — one navigation rail (September 22, 2026)

Built in the shared tree on `main`, in five steps. `npm run check`,
`npm run audit` and the full node suite (2001 tests including every Electron
fixture) pass with the rail as the default.

| Step | Change |
|---|---|
| **Inspect mode** | Selecting a node gives its detail the whole Command rail at full height (`#cmd-node`, a sixth rail view) and folds every other surface to its edge; Esc returns the menus first, then the node. Fixed the guard that drew a second assistant console beside the rail's. |
| **One scroller** | The Work rail scrolls as one column with sticky section heads; five fixed `max-height` wells are gone. Current work leads, the roster follows. |
| **Shared fake DOM** | `tests/fixtures/renderer-dom.mjs` — one `Element` stand-in with a real selector matcher and template-read ids. Three suites moved onto it; its header records why the rest (private fakes that bake in falsehoods such as `closest()` returning `this`) need per-file work. |
| **The rail** | `#app-rail`, built by `MefiNav.renderRail()` from the registry: **Home · Work · Live · Models · Settings** plus palette, walkthrough and shortcuts at the foot. §8's five destinations, grouped by the `menuGroup()` buckets people already knew. Peek on hover or focus without reflow; **Keep open** pins. **M+** opens the project panel, replacing the transparent 6px strip (§2.2). Every full-window layer respects one variable, `--shell-rail-w`; `usableArea()` fits Command's graph beside it. |
| **Default** | The rail is the default; the tabs row, Command dock, sidebar nav rows, tools drawer and sheet link strips step aside under it. **Switch navigation: rail or classic** (`Ctrl K`) or `?shell=classic` brings them back. The stray `z-index: 65` and `85` joined the token scale. |

Deliberately not done, and why:

- **The old chromes are hidden, not deleted.** Their markup, CSS and renderers
  stay as the classic fallback while the rail beds in after the 0.2.0 release.
  Deleting them is a follow-up once nobody needs the switch.
- **§8's merged views** (one Work list with Queue / Review / Done / Ideas /
  Plans tabs, one Settings page) are view redesigns, not navigation, and were
  out of scope. The rail groups the existing views instead.
- **The assistant drawer** (one composer in every view) is still open; the
  Command rail keeps its Assistant tab.
- **One hide mechanism** was not attempted: converting `body.workspace-active`'s
  `visibility: hidden` and the per-module `hidden` toggles is a cross-module
  refactor with no visible payoff.
- **The canvas-key gate** (`body.dataset.sheet`) was kept. The plan assumed
  sheets would become routes beside a live canvas; they are still modal
  overlays, so canvas keys correctly stay dead while one is open.

## Verification notes

- The "Open Workspace on launch" preference *is* persisted (idle.js:8097 →
  generic `prefs:set`, M:11214-11219, spread back by `prefs:get`); an earlier
  reading that it was dead was wrong. The dual-store and the misleading
  `commandHome` name stand.
- `npm run check:css:unused`, `npm run check:targets` and `npm run audit` all
  pass at the audited tree; they check wiring, not information architecture.
- Only the browser build was rendered; desktop-only panels (Command's live
  constellation, Explorer sessions, Settings' desktop groups) were audited
  from source and the template.
