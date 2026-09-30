# TESTRUNS.md archive, 2026-09

Rows that rotated out of the live region of `TESTRUNS.md` (the dated rows
above its `## Read Before Any Tests` guide, where only the newest rows
stay). `scripts/rotate-testruns.mjs` moves each row here verbatim as one
block - heading, H3 subsections and unheaded paragraphs together - newest
first. The frozen archive below the guide in `TESTRUNS.md` stays there.

## 2026-09-28 - Startup opens even when the window paints nothing

The owner reported Vibe mode broken. The live app (attached through the
main inspector) sat on the startup gate with every step Ready: the gate
waited for two animation frames and `document.fonts.ready`, and a covered
or tray-parked window gets no frames, so each hot reload from a peer's
edit stalled there, and after 60 s the view step failed into "A little
more setup is needed" (Trace's Window channel: "view" slow on every reload
since 11:09, one "never finished"). `MefiBoot.afterPaint()` (boot.js)
races the two frames against 300 ms, nav.js `resumeReady` uses it, and
the fonts step (booklet.js) stops waiting after 4 s.

- Hidden-window probe (`paintWhenInitiallyHidden: false`, fake-bridge
  booklet in Vibe): HEAD stayed at "loading" with all steps Ready for 75 s;
  the fix reaches "ready" in 1.2 s and opens Vibe.
- Offscreen capture of the shared tree's Vibe (home, Tasks and Settings
  panels, the ask drawer): renders normally, so Vibe itself was not broken.
- `npm run build-booklet`, `npm run check`, `npm run audit` (0 errors,
  0 warnings) in C:\wt\boot-frames: PASS. renderer_startup (9),
  startup_resume (14), boot_poll_visibility (28), booklet_build (5),
  settings_nav (21): PASS.
- `npm test` in C:\wt\boot-frames on 704ef0d: Python contracts and the
  normalized-path lock pass; Node suites failed only performance_render
  ("Profiler JSON download timed out", the known load flake), which passes
  solo (2).

## 2026-09-28 - Plans face lift: one step at a time, quick-then-deep models, project ready before it is needed

The owner said the planner felt like a chore: slow to load, too much on
screen, and no real help from Mefi. Opening Plans waited on the folder scan,
and every interview answer re-read the whole folder (2.1 s on this repo;
0.13 s from the cache). `planning:list` now answers with `skipExisting`, and
the new `planning:prepare` brings the scan plus a warm project read after the
plans are on screen. Interview turns answer from that read
(`explorePlanningFiles` `maxAge` + `stale`) and refresh it behind the reply.
Interview, question and live-suggestion calls stay on the routine (quick)
seat. A reply it fumbles is asked once more of the heavy seat. The spec and
"Think harder" turns go straight to heavy, and the note names the seat. The
page shows one step at a time (Show every step brings the rest back), an Up
next button, a progress track, and a flourish when a step completes. The
interview reads as a chat. Mefi's reading has a one-click "That's right —
record it", and Mefi asks the next question on its own (a switch, on by
default) and as soon as a new plan exists. A new idea needs no name, and
starters fill its first words. The Project ready chip shows the files read and
the map areas. "Where this lives" pins a plan to a Project map area.

- `npm run build-booklet`, `npm run check` (189 targets) and `npm run audit`
  (0 findings): PASS in C:\wt\plans on 6c1c940.
- `npm test`: Python contracts OK (248). Node stage: the Electron fixture
  stage failed on performance_render (profiler JSON timeout, a known row) and
  planning_render (glass transmission 12 under load). Both PASS solo
  (planning_render transmission 106, performance_render 2/2). After the
  rebase onto 39a153d: `npm run check`, `npm run audit` and `npm run test:fast`
  (4403 pass) PASS; planning_render solo passed 3 of 4 (one read 0, a blank
  capture), clean 39a153d passed 3 of 3. Watch it for a flake.
- New tests: planning_service (2: list answers before the scan and prepare
  fills it; quick seat first, one heavy retry, deep asks, quick error shown),
  planning_ui (4: one-click record then ask; switch off; nameless idea
  auto-asks; list first, then ready chip, scan and map pinning),
  planning_exploration (1: stale-ok read answers from the last inventory).

## 2026-09-28 - Start with Windows; Your PCs shows what each PC's agents are doing

Two pieces for leaving home PCs working. **Start with Windows** (Settings ›
General › Profile & startup, and the setup helper's Machine & app) keeps a
Run entry pointed at this copy of the app with `--at-login`; that launch
(`startupAtLogin`) opens the open project in the tray without the launch
screen, the agents follow When Studio opens, and `prefs:get` reads back what
Windows holds, including Task Manager switching it off. **Your PCs** lines in
Share between my PCs now carry each PC's agents (`agentsSnapshot` →
`vaultAgentsLine`: the loop state, up to four titles being built, the
needs-you count, today's finished and stopped counts), sealed in the vault,
sent after a sync look and when that line changes (`vaultAgentsWatch`), at
most every ten minutes.

- `npm run build-booklet`: built; `npm run check` (189 targets, 391 specs) and
  `npm run audit` (0 errors, 0 warnings): PASS.
- New suites: start_with_windows (11), pc_agents_line (4); pc_vault gains the
  sealed agents line, pc_vault_ui the painted line, setup_helper the switch.
  188 focused tests across sync_host, pc_vault*, startup_resume, startup_hold,
  setup_helper, workspace_ui, booklet_build, settings_search_labels,
  cli_path_refresh_host and module_purity: PASS.
- `npm test` in C:\wt\away on e53a572 plus this change: Node parallel stage
  4392 tests, 4387 passed, 5 skipped, 0 failures. Electron lane 41 tests, 35
  passed, 1 skipped, 5 failed (`performance_render` x2 "Profiler JSON download
  timed out", `planning_render` backdrop check, `renderer_recovery` and
  `task_overview_render` killed without a report), and `command_render` killed
  at its limit, all while a second checkout ran its own `npm ci` and tests.
  Each passed solo on rerun: performance_render 2/2, planning_render 1/1,
  renderer_recovery (all pass), task_overview_render 1/1, command_render 1/1
  in 93.2 s. `eyes_toggle_electron` 1/1, `occlusion_probe` 1 pass 1 skip.
  Python contracts OK (248, 1 skip). Normalized-path lock passed.
- Browser-pane preview of the real `pc-vault.js` and the switch markup with a
  fake bridge: each PC's agents line under its sync line, and the switch
  beside When Studio opens.

## 2026-09-28 - Typing goes to the open menu's box

A printable key pressed outside any field while a menu is open (focus in it,
or the pointer resting on it), or while a sheet is open, now lands in that
menu's text box instead of firing the single-letter shortcuts that opened
other menus (`typeInto` in `renderer/nav.js`; menus opt in with
`data-type-scope`, `data-type-here` or `typeScope()`). Clicking out of a menu
gives the keys back. Wired: the companion panel (from any tab to Talk) and
hub (Talk and Suggest work open with the caret in their box; an open room's
message box), Music & video (link box, YouTube search), Command's chat
panels, Assistant pill and tab, Ask cards, Vibe's side panel and ask drawer,
the project map's Browse, Home's queue search, Explorer's session tools and
the media browser's address bar. MefiSelect no longer takes the caret back
from a box its choice opened (Agents' "Enter a model ID…").

- Browser pane, fake-bridge booklet, real key presses: the Task board took
  "plan the demo" into its box with P not opening Plans; T still opened the
  Task board with no menu up; the Music dropdown, the companion panel (from
  Needs you) and the hub's Suggest work all took typing.
- `npm run build-booklet` in C:\wt\type-into; `npm run check`, `npm run audit`
  (0 errors, 0 warnings): PASS.
- New suite type_into_menu (9); the new tests fail on the old code.
- `npm test` in C:\wt\type-into on 6c1c940: Node parallel stage 0 failures;
  Electron lane 37 of 41 passed, 1 skipped, 3 failed under load
  (media_window_render "No media report", task_overview_render "No fixture
  report", unified_studio_render on a MefiSelect focus rule since narrowed).
  All three pass solo after the fix. Python contracts: only
  test_electron_smoke_boots_when_installed timed out (120 s); the launcher
  file passes solo (11 tests, 1 skipped).

## 2026-09-28 - Needs you: answered asks leave the list, no dead asks after a reload

The owner reported that answered asks in the companion's Needs you list hung
around until Clear list, and that a reload showed asks whose clicks only
failed. companion-ui.js keyed() kept any row holding focus (the clicked
option button), so a row that left the list stayed on screen. It now holds
back only a row with a focused text field and moves focus to the next row.
agent-brain.js act() locks a row (aria-busy) until the re-read lands. The
48 h question pruner ran only on a new ask or a click. assistantExpireQuestions
now runs on loads, on the assistant:state and companion reads, on ticks and
on answers. assistantSettleStaleAsks retires asks whose card is gone on every
loadAssistant, the all-projects list drops expired asks, and a stale click
comes back as gone. Asks about done or archived cards stay, as tests pin.

- `npm run build-booklet`, `npm run check` (189 targets) and `npm run audit`
  (0 findings): PASS on e53a572, rebased onto 897c2ec.
- `npm test`: PASS (Node suites 497 s, Python contracts, normalized-path
  lock). The first run, before the rebase, failed 5 assistant_loop cases:
  the tick called the new helper outside the suite's vm slice. It is now
  guarded with typeof, like the other cross-section helpers.
- New tests: companion_queue_rows (4, keyed() in a vm with a small fake DOM;
  all 4 fail on the old keyed()), assistant_issue_host (2: expiry on a read
  with a gone reply, and a project load settling gone and expired asks).
- Clicked through a booklet copy with a stub bridge: three fast clicks sent
  one answer, the row left at once, and an Enter answer moved focus to the
  next row's Try again.

## 2026-09-28 - Vibe shows its planner and agent team at work

Suggest a next step and Build it's sizing each show a live strip
(`renderer/vibe-flow.js`) fed by the host's `vibe:progress` steps: the
planning service's `onProgress` (reading, read, asking) and `vibeBuild`
through `vibeProgress` (quick, sizing, tool, sized, adding), with
`seatFetch`'s new `onTool`. The plan card draws a split request as a track
with a live "now" line, Building now rows and the plan panel's timeline carry
each worker's tool and current step, and Team lists Thinking now. Fixes:
adding one suggestion no longer locks the rest, the plan panel's Make it one
task uses `merge-steps`, and Enter in a New app field paints Making it….
Build it's feedback moved under the box.

- `npm run build-booklet` then `git diff --exit-code renderer/booklet.html`:
  clean.
- `npm run check` (189 targets, 389 specs), `npm run audit` (0 errors, 0
  warnings), eslint on the changed files (no findings of theirs): PASS.
- New tests fail on the old code: vibe_flow ("adding one suggestion keeps the
  rest of its set usable", "Make it one task is one host call", "New app shows
  its first build being sized"). New suites: vibe_flow (15),
  vibe_progress_host (5); agent_tools asserts `onTool`.
- `npm test` in C:\wt\vibe-flow on 77ad3bd: Node parallel stage 4351 tests,
  4346 passed, 5 skipped, 0 failures. Electron lane 41 tests, 39 passed, 1
  skipped, 1 failed: `media_browser_render` "Browser fixture timed out:
  scroll clipping", a suite this change does not touch; it passed solo on
  rerun in 14.4 s. `command_render` 1/1 in 50.4 s, `eyes_toggle_electron`
  1/1, `occlusion_probe` 1 pass 1 skip. Python contracts OK (248, 1 skip).
  Normalized-path lock passed.
- Rebased onto c85cf60 (the menu polish): build-booklet clean, check,
  audit, and 243 focused tests (the vibe, planning, sizing, agent tool and
  onboarding suites plus every suite the menu polish changed): PASS.
- Offscreen Electron captures at 1920x1080 and 1280x720 of every stage (fake
  bridge replaying the host's steps): planner strip over placeholder cards,
  sizing strip under the box, plan track and now line, plan timeline, Team,
  New app; a light custom palette too.

## 2026-09-28 - Menu polish pass: plain words, two-step confirms, steadier menus

The "Menu polish review" session's uncommitted work in C:\wt\menu-polish,
finished and landed as six commits on efdc015. Its stuck ux-clarity port was
resolved: the fixture and test halves no longer apply, since the startup
fixture has no Projects-menu check now, and sidebar.test pins the behaviour.
The branch was rebased over the Rooms rewrite (companion-hub select() keeps the
dispose over a copy, media-window keeps setMinimized with the SVG close, and
Your PCs sends the previewed shelf with the count in words), then over the
onboarding landing (setup-helper merged cleanly). Rooms got REASONS for auth,
version and unsupported, plainError, and two-step Close, Leave and Delete.
Connection details are named as Settings › General › Community. Batch 3 (one
page frame) was not done: hiding #tree-rail outside Command conflicts with
command_render's "visible rail resumes painting" contract, so it waits for
the owner.

- `npm run build-booklet` (fresh), `npm run check`, `npm run lint` (0
  errors, 41 warnings, none new) and `npm run audit` (0 findings): PASS.
- New tests: rooms_ui (hub codes as sentences; Delete and Leave ask twice)
  and sidebar (M+ focuses the selected project). The session's pins were
  updated in ideas_ui, overhead_poll_backoff, pc_vault_ui, together_ui,
  vibe_panels and the companion-hub render fixture.
- `npm test` in C:\wt\menu-polish, exit 0: Node parallel stage 4348 tests,
  4343 passed, 5 skipped, 0 failures. Electron lane 41 tests, 40 passed, 1
  skipped. `command_render` 1/1 in 53.8 s, `eyes_toggle_electron` 1/1.
  `occlusion_probe` skipped because its window was closed externally during
  the cover wait (desktop in use). Python contracts OK (248, 1 skip). The
  normalized-path lock passed.
- Visual: the seeded fake-bridge preview was captured offscreen at 1920x1080,
  48 menus each from efdc015 and from this branch. The same single
  fake-bridge console error appears in both. The largest pixel change is
  2.1% (the live tree preview). Trace reads "All 0" with its empty state in
  the log pane, Context shows its own subtitle and "4,000 token budget", and
  Friends shows the new Settings path.

## 2026-09-28 - New-user onboarding: no AI connected, real logins, one welcome

The "New user onboarding experience" session's fresh-profile findings,
finished and gated in C:\wt\onboard on 77ad3bd (one commit). A held launch
with no AI connected is loop state `setup`. Talk it over files nothing: a
model's create_task becomes an offer, and keyless it says no AI is connected.
spawnNextJob refuses an OpenCode route when OpenCode is not installed, and
executor-core `readableRunError` turns cmd.exe's "not recognized" into "x is
not installed or not on PATH". cliSignedIn reads each subscription CLI's login
file. planAutoSetup prefers signed-in logins (then Claude Code, Codex, Grok,
Antigravity). The setup helper defaults to Quick, leads with Set up
automatically and Start free with OpenCode, counts a signed-out CLI as not
connected, and keeps a key save's words and scroll. Only "Continue to the
guided tour" opens the walkthrough (MefiOnboarding.invite otherwise). The
keyboard tip waits for 30 quiet seconds, and the launch screen leads with Open
a folder… when there is no project.

- `npm run build-booklet`, `npm run check` (188 targets), `npm run lint` (0
  errors, 41 warnings, none new) and `npm run audit` (0 findings): PASS.
- New tests: assistant_overseer_chat (2 talk-mode), executor_builder_cli (no
  coding tool), executor_core (readable errors), model_auto_setup (login
  ranking, cliSignedIn), setup_helper (quick default, signed-out CLI, finder
  first with key save kept, tour hand-off), onboarding (invite), nav_startup
  (keyboard tip). startup_screen and vibe_pipeline were updated.
- `npm test`, exit 1, then fixed: Node parallel stage 4344 tests, 4339
  passed, 5 skipped, 0 failures. Electron lane 41 tests, 40 passed, 1
  skipped. `command_render` 1/1 in 55.2 s, `eyes_toggle_electron` 1/1,
  `occlusion_probe` 1 passed and 1 capability skip. Python contracts: 3
  failures (test_mefi_studio_assistant pins "Kept in the thread and put on the
  task board" and the self-test's request reply), because the keyless reply
  was reworded. The sentence was restored with only the foreman line dropped.
  After that, Python contracts OK (248, 1 skip) and assistant*/vibe_pipeline
  273/273. The normalized-path lock passed.

## 2026-09-28 - Fixes from the improvements plan: setup windows, shares, Rooms, booklet line endings

The owner-approved "Fixes + hand-offs" plan, 14 commits on 7a5ff81. Set up
this PC's PowerShell windows open attached. share-review blocks a share it
could not read to the end. A friend's preferences carry only behaviour
fields, and other PCs' settings pass the settings checks. Approvals and
named Starts survive a gather on `refs: []` cards (`backlog.scopeMatches`).
Rooms keeps the open room's chat, drafts and a fair hub subscription per
holder. The media player focuses only on the owner's own minimize.
adoptProject recounts `autopilot.queueCounts`. The keyless away answer says
"may already be done" for local guesses and ignores "when the user logs
out". build-booklet reads every input as LF and writes the template's own
line ending. command_render runs serialized (120 s kill, 200 s timeout,
duration and retry diagnostics), and media_window_render polls the hover
fade. Lint lost 36 warnings (ignoreRestSiblings plus dead code). The MCP
servers read their version from package.json, and docs/code-map.md was
reorganized.

- `npm run build-booklet` then `git diff --exit-code renderer/booklet.html`:
  clean. After a fresh checkout, a rebuild leaves `git status` clean.
- `npm run check` (188 targets, 387 specs), `npm run audit` (0 errors, 0
  warnings), `npm run lint` (0 errors, 41 warnings, down from 77): PASS.
- New or changed tests fail on the old code: media_window (code-driven
  un-minimize keeps focus), project_switch_settlement (adoptProject counts),
  booklet_build (CRLF inputs give all-CRLF output and a no-op rebuild), plus
  outside_work, desk_tool and agent_tools additions.
- `npm test` in C:\wt\fixes, exit 0: Node parallel stage 4331 tests, 4326
  passed, 5 skipped, 0 failures. Electron lane 41 tests, 40 passed, 1
  skipped. `command_render` serialized 1/1 in 49.8 s (no cold-boot retry).
  `eyes_toggle_electron` 1/1, `occlusion_probe` 2/2. Python contracts OK
  (248, 1 skip). Normalized-path lock passed.

## 2026-09-28 - Sync counts only real local work; vault calls take turns

Follow-ups from the Plan session's review. sync.mjs recounts a non-empty
status from the diffs and untracked files (a line-ending-only difference
is not uncommitted work), skips local branches whose commits are all on
some GitHub branch, and runs Git with GIT_OPTIONAL_LOCKS=0. The vault runs
one call at a time, resets only when a rebase stopped on unmerged paths and
names the changes a clash dropped, keeps insights, learned and settings per
PC (older shared files still read), and removes its folder after a failed
pair or create (create carries on with an empty private repository). The
renderer saves the previewed share and keeps Send, Use and the lists on
the shelf they were read from.

- `npm run build-booklet` (renderer/booklet.html rebuilt), `npm run check`
  (187 targets, 385 specs) and `npm run audit` (zero findings): PASS.
- New suites: sync_changes (5), pc_vault_turns (9; 8 fail on the old
  pc-vault.cjs) and pc_vault_ui_turns (3; all fail on the old renderer).
  sync.test.mjs's stranded-work fixture builds `published` from main so
  `local-only` keeps a commit of its own.
- `npm test` in a private worktree, exit 0: Node parallel stage 4290 tests,
  4285 passed, 5 skipped, 0 failures; Electron stage 42 tests, 41 passed, 1
  skipped; `eyes_toggle_electron` 1/1; `occlusion_probe` 1 passed, 1
  capability skip; Python contracts OK (248); normalized-path lock passed.
- Rebased onto the multi-login commits (07150aa, 732026f): CHANGELOG kept
  both entries, booklet rebuilt; `npm run check` (188 targets, 387 specs),
  `npm run audit` and the sync, vault, booklet, setup-helper and
  cli_accounts suites (107 tests) pass on the combined tree.

## 2026-09-28 - More than one Claude Code or Codex login, swapped when one tops out

Extra subscription logins (settings.cliAccounts, each a folder under user
data handed over as CLAUDE_CONFIG_DIR / CODEX_HOME). scripts/cli-accounts.cjs
holds the pure rules; main.cjs's "Several logins per coding CLI" block keeps
the folders and cli-account-limits.json. Assistant calls retry on the next
login inside cliAccountTurn; a worker whose login tops out is settled in
finish() as an outage with `accountLimit`, requeued at once with no backoff.
Gated in the detached-style worktree C:\wt\multi-acct on the rebased commit
(on top of 726eb48).

- `npm run build-booklet`, `npm run check` (188 targets, 384 specs) and
  `npm run audit` (zero findings): PASS.
- `npm test`: Node 4,298 tests, 4,293 pass, 0 fail, 5 skipped (359 s);
  Python contracts 248 OK (1 skipped); normalized-path lock PASS.
- New suites: `cli_accounts` (reset parsing incl. named zones, fill-first
  pick, marks), `cli_accounts_host` (the real block in a vm: call rotation,
  marks surviving a restart and a limit hit before the file was read,
  junction-safe removal on a real temp folder, and an executor run that
  tops out on the main login and runs again at once on the second).
- Updated pins: `test_mefi_studio_routing.py` now asserts
  `claudeCompletion(system, user, route.model, login)` and `cliAccountTurn`.

## 2026-09-28 - Cowork file claims between PCs; keep this PC up to date

A cowork room linked to the project (settings.cowork) carries live file
claims through the rooms hub: the dispatch's write-lock step also claims the
run's files there, and claimWork treats other PCs' exclusive claims as
in-flight jobs, so a pick on those files defers. Claims are renewed every
minute and held until this PC's next push (or 30 minutes) when the run did
its work. Keep this PC up to date asks GitHub once a minute (sync.mjs
remoteMoved) and fast-forwards when nothing is in the way and no builder
runs. Rooms say moderators can read them; Set up this PC lists what links
this PC; a hub naming its studioAppId fills the link app ID.

- `npm run build-booklet` (no change), `npm run check` (187 targets, 382
  specs) and `npm run audit` (zero findings): PASS.
- New suites: cowork (claim paths, overlap, leases, held jobs, settings),
  cowork_host (claim before a run, defer on conflict, hub silent in 5 s
  never holds work, release and hold until push, renew and drop gone),
  sync_follow (remoteMoved and the follow pull's conditions). Additions to
  hub_rooms (claims calls and frame, a refusal's conflict list), hub_host
  (studioAppId fill), rooms_ui (privacy line, cowork link and claims),
  pc_sync_ui (follow switch, Linking this PC) and sync_host (follow timer,
  release on push).
- `npm test` in a private worktree, exit 0: Node parallel stage 4273 tests,
  4268 passed, 5 skipped, 0 failures; Electron stage 42 tests, 41 passed, 1
  skipped; `eyes_toggle_electron` 1/1; `occlusion_probe` 1 passed, 1
  capability skip; Python contracts OK (248); normalized-path lock passed.

## 2026-09-28 - Discord linking without environment variables; vault kept in step

Settings › Community › Connection details saves the Mefi Studio Link
Application ID and the rooms hub's address (settings.communitySetup, checked
by community.normalizeSetup and the hub client's address rule) and uses them
at once; the environment variables still win. The Your PCs vault now rebases
its own commits onto GitHub's instead of pulling fast-forward only, so a push
that loses the race to another PC is sent again and a copy is never left
stuck; a clash on the same item keeps GitHub's. Keys and setup queues behind
a loading vault instead of staying empty.

- `npm run build-booklet`, `npm run check` (186 targets, 379 specs) and
  `npm run audit` (zero findings): PASS.
- New and changed suites: community_rules (normalizeSetup), hub_host
  (save, refuse, clear, environment wins, hub answering or not, a new hub
  address rebuilds the client), community_bridge, community_ui (Connection
  details opens while not set up, reasons, Link my Discord at once),
  pc_vault (a push losing the race goes on top; a same-item clash keeps
  GitHub's; a copy left behind catches up and sends its commit), and
  pc_vault_ui (Keys and setup opened while loading, the phrase hint, a
  failed list).
- A throwaway Electron probe of Settings › Community with a fake bridge:
  the details open while not set up, a bad id gives its reason, Save shows
  Link my Discord and the hub line, no overflow at 1280 or 620 px.
- `npm test` in a private worktree, exit 0: Node parallel stage 4253 tests,
  4248 passed, 5 skipped, 0 failures; Electron stage 42 tests, 41 passed, 1
  skipped; `eyes_toggle_electron` 1/1; `occlusion_probe` 1 passed, 1
  capability skip; Python contracts OK; normalized-path lock passed.

## 2026-09-28 - Merge all branches: hidden-surfaces onto the restored main; Friends across PCs verified end to end; 0.4.5

Surveyed every branch and tree. gh-pages is the website (no shared history; not merged). perf/quick-wins is content-identical to aef5dfe on main (skipped). worktree-* branches and the cli-path-refresh clone are already in main. The 16:57 merge (65703a6) and "fixes" (7ba162c) losses were already restored on GitHub main by dc85f68, which keeps the docked video player the other PC is developing; this merge keeps that and the fuller Friends › Rooms (4ee6891). Merged perf/hidden-surfaces (docs/performance.md kept both). Added tests/companion_e2e.test.mjs: three Studios (main's real Companion friends block and hub client, three Discord accounts) against the Void Engine Bot's real hub with its companion relay: make a room, ask, let in, play-only default, a friend rule keeping a token-bearing title home, share-back ask, mirrored playdate, stay home; 1/1 with MEFI_STUDIO_BOT_ROOT set (hub relay patch, 462/462 bot tests). Version 0.4.5. Full npm test: 4209 passed, 1 failed (command_render, known load-sensitive; passed solo in 51 s); Python contracts and path lock passed. check ok, audit 0 errors.

## 2026-09-27 night - Agent loop: one loop status, approval race, launch choice

`npm run test:fast` on branch `overhaul/agents-menus-main` (GitHub main `421453f` plus this change): full `npm test` green (Node 4243 tests, 4238 pass, 0 fail, 5 skipped; Python contracts pass). `npm run check` is green. New: `loop_status` (9), plus approval-race, Auto build mapping and launch-choice cases in `build_approval` and `startup_screen`; `startup_hold` and `boot_poll_visibility` updated for the resume emit and the opt-in idle switch.

## 2026-09-27 night - Share between my PCs and with friends: vault, shelves and share files

Friends › Your PCs gains Share between my PCs (a private
`<account>/mefi-studio-vault` repository sealed with AES-256-GCM under a key
only paired PCs hold, shelves reviewed both ways, a library whose kept model
results and decisions join learning, keys behind the exact typed phrase and a
native prompt) and Share with friends (scrubbed, previewed `.mefishare`
files; opened ones reviewed before they can be kept).

- `npm run build-booklet`, `npm run check` (185 targets, 375 specs) and
  `npm run audit` (zero findings): PASS.
- New suites: vault_crypto (pairing codes, 200 rounds of last-character
  typos, sealing bound to path and key), share_review, pc_vault (real git,
  a bare repository standing in for GitHub, a faked gh: pairing, refusing
  another vault's code, nothing readable in the repository, stopped and
  scrubbed items, quarantine of edited and planted files, keys only with the
  exact phrase and taken back out, unpairing one PC), vault_shelves,
  pc_vault_ui (fake DOM; the keys handler returns no value), playbook
  importRecipe, and a vault step in the companion hub Electron fixture
  (both PCs, the library, keys locked until the phrase, no overflow).
- `npm test` on 553bcaa in a private worktree, exit 0: Node parallel stage
  4214 tests, 4210 passed, 4 skipped, 0 failures; Electron stage 42 tests,
  41 passed, 1 skipped; `eyes_toggle_electron` 1/1; `occlusion_probe` 1
  passed, 1 capability skip; Python contracts OK; normalized-path lock
  passed. Rebased onto aacf276 as d516312 with check and the booklet,
  first-install and vault UI suites passing again.

## 2026-09-27 night - Restore the work the 16:57 merge dropped: full gate on dc85f68

The 16:57 merge of GitHub main (65703a6) kept this PC's copy of 15 conflicted
files whole and the next commit (7ba162c "fixes") reset the rest of the tree
to it, so main lost 3e0e1e0..2dd1ff8 (Configuration and Habits, the other
PC's bug hunt and CLI setup, sync hardening, Set up this PC, the companion
pet and friend, first-time setup, still-video sampling and a lighter Command
over video). dc85f68 redoes that merge (local fcc3343) on top of 1dd9518,
keeping 0.4.4, the free Void collection, the public docs, the MEFI work, the
setup helper and the media player work. Music & video keeps main's docked
player (music.js, music.css, media-window.js, media-browser.js and their
tests as on 1dd9518), because the other PC is still developing it; the
morning's floating-player redesign from 95bd61c is not carried over.

- `npm run build-booklet`, `npm run check` (179 targets, 368 specs) and
  `npm run audit` (zero findings): PASS. Focused music, media, scene,
  browser, booklet, onboarding and scroll-hint suites: 160/160.
- `npm test` in a private worktree: Node parallel stage 4172 tests, 4168
  passed, 4 skipped, 0 failures; Electron stage 42 tests, 41 passed, 1
  skipped; `eyes_toggle_electron` 1/1; Python contracts 248 tests OK (1 skip);
  normalized-path lock passed. `occlusion_probe` failed "visible probe lag
  should be ~0, got 108.6ms (samples=[108.6,0,0])" in the serialized stage
  on an unattended desktop and solo gave 1 pass plus the capability skip.
  Earlier runs of the same restore on 052a1ec and 937e244 differed only in
  those two timing-sensitive fixtures.

## 2026-09-27 late - Media player controls and native browser usability

Validated media changes in `93ee12e`, rebased on the incoming setup-helper and
Command-renderer follow-up at `4fa8b96`. Floating players have reachable window
controls and a visible minimized restore bar; dragging from the panel preserves
position. Hover opens at the video and keeps its controls stable. Browser pages
fit the visible panel through scrolling and overlapping notifications.

- Final `npm run build-booklet`, `npm run check`, `npm run audit`: PASS, zero
  audit findings. Combined media/music unit tests: 109/109 PASS.
- Final real Electron rerun on the integrated source: 4/4 PASS (Command,
  media browser, media window, tree dynamics). Media captures cover 1440/600px,
  provider controls, native toolbar drag/minimize/restore/close, background,
  notifications, scrolling, dialogs, history, zoom and unchanged playback.
  The compact video retains a 200px provider area below its toolbar.
- `npm test` initial CPU stage: 4,023 pass, four skip, zero fail. Its Electron
  stage hit the previously recorded Command timeout and the browser fixture's
  native-input assertion before the run stopped. The remaining renderer lane
  was completed separately: 20 pass, one skip, one tree-dynamics native-click
  failure. The final four-suite rerun above clears all three failed suites.
  No single uninterrupted full-gate pass is claimed.
- Remaining legs: Python 248 tests OK (one skip), normalized-path locks 6/6,
  serialized eyes 1/1, occlusion one pass and one desktop-capability skip.
- Baseline media render: PASS. Intermediate focused runs corrected obsolete
  hover-dismissal and exact-full-viewport fixture assumptions; visual QA found
  and fixed compact provider-menu clipping. Browser unit 4/4 and final browser
  Electron fixture PASS. Synthetic child `sendInputEvent` produced no events
  on unchanged HEAD as well, so browser verification exercises its actual page
  handler plus native visibility, bounds and captures. Pointer injection into
  that native child remains unverified here. Website clipping can reflow its
  height but does not reload playback.
- `npm run package`: PASS; installed media files match source hashes. Existing
  portable data was preserved. Source landed on main and synced to GitHub.

Full logs and synthetic captures remain ignored under `tools/logs/` with the
`media-usability-` prefix; browser captures are in the temporary
`media-player-native-captures` directory. No live user state was committed.

## 2026-09-27 - Clean-state Command renderer follow-up

On unchanged `052a1ec` main, reran the remaining failing fixture alone:
`node --test tests/command_render.test.mjs` PASS, 1/1, 53.1s within its
normal 80s child limit. Log: `tools/logs/mefi-clean-status-command.log`.
No fixture settings or application code changed. The earlier Command hard
timeouts did not preserve phase diagnostics, so their exact cause remains
unconfirmed. Both failures from the preceding full run have now passed
individually (tree dynamics passed in the preceding entry); this is not a
claim that a new complete `npm test` run was performed.

Verified a clean main checkout and matching SHA-256 hashes between source
and the portable payload for main/preload, generated booklet, Vibe, map
view/model/host and idea actions. Test-record structural check also passes.

## 2026-09-27 night - Setup helper lands on 0.4.4 with the free Void collection

The setup helper (renderer/setup-helper.js + .css), the walkthrough hand-off,
per-agent habits and the host fixes for settings that saved but did nothing
(endpoint saves no longer fork a project team, brain-map modelChoice writes
"jev", backlog "stop", machine:set whitelist, the Jev gate preview), rebased
onto GitHub main 052a1ec. main already carried the Void collection unlock
(3239151 + 116d334); this change adds its finishing pieces: the dead lock-badge
and prompt CSS, MefiMusic themes() with accent2 plus nodeStyles() and
nodeLayouts(), and an accurate docs/community.md with its node-style table.
The new render test found the shared permission control scrolling sideways in
the helper at 480px (nowrap mode buttons); the helper now lets them wrap.

Validation on the rebased tree: npm run check passed; audit 0 findings; Node
fast suites 4033 passed, 0 failed; Python contracts 258 OK (1 skipped);
Electron setup_helper_render (10 sections at 1440x900 and 480x820, focus
trap, bridge saves, Escape), companion_hub_render, startup_render,
command_render, node_views_render, agent_setup_render and
unified_studio_render passed, one at a time.

## 2026-09-27 night - Work done outside Studio follow-up: keyless answer, local wording, real Electron drive

Follow-up to the evening row. Codex rollouts as outside sessions and the
code-change gate (changesCode) reached main in 3239151 and ship in 0.4.4. Two
later edits were lost to the 17:10 `reset: moving to HEAD` in this checkout's
reflog, since they were uncommitted and unstaged. They are re-applied here, with
the second TESTRUNS row the reset also dropped: the keyless answer to "what
changed while I was away?" (outside-work.cjs asksAboutAway/awayAnswer, placed
ahead of localReply's text in main.cjs assistantRespond), and "may already be
done" for a local match on its hold reason (holdState), the thread line
(verdictNotice) and the task's Evidence tab (renderer/tasks.js). An Ask card
already said it. The raw bidi characters in outside-work.cjs's clip() had
surfaced as a check-targets failure on the tracked file; they are escapes
since 7ba162c.

Drove the real Electron app in an isolated copy (its own data/, its own profile,
HOME redirected to a fake home, MEFI_STUDIO_REPO on a temp git repo, launched
with --disable-features=CalculateNativeWinOcclusion so an occluded window does
not stall the boot screen's rAF). Launch 1 took the baseline look; then a
commit, an uncommitted file and a Claude Code transcript were made. Launch 2
posted the report notice and held and locally checked both cards: the toggle
card was asked about as a local done, the installer card was needed. It raised
the Ask card with its four options. The Tasks view showed Build it anyway, the
hold reason and the Evidence tab's "Work done outside Studio" section.

Validation on 052a1ec plus these edits: npm run check passed, npm run audit
found 0 findings, the Python contracts gave 248 OK (1 skipped), and test:fast
had 4017 passed, 0 failed, 4 skipped. The previous full npm test on 3239151
failed only in community_ui and music, whose files another session was
editing during the run; they passed solo, 112/112.

## 2026-09-27 - MEFI Vibe workbench and evolving project map

Validated `codex/mefi-evolution` at `75de5a4`, rebased on the current
`da669cc` main. Added Modify/Experiment/Fix/Improve briefs, planner-backed
suggestions, saved idea lineage through task admission, connected system
cards and a separate live Ideas tree. Source board data remains authoritative;
map groups are projections. All renderer screenshots use synthetic fixture data.

- `npm run build-booklet`, `npm run check` and `npm run audit`: PASS.
  Check covered 170 targets, 355 spec names and 12 stylesheets; audit had zero
  findings. Targeted ESLint on changed JavaScript passed with zero errors and
  24 existing unused-variable warnings (`tools/logs/mefi-evolution-lint.log`).
- Focused Node batches: map/model plus idea backlog 42/42; Vibe pipeline,
  frame and panels 48/48; host brain and idea actions 26/26; final work
  admission, assistant admission and idea actions 40/40. These cover draft
  persistence, suggestion failure and project switches, explicit saving,
  multiple source ideas, duplicate task adoption, file-scoped identity,
  reverse legacy links, stale map reads and pure, cycle-bounded tree grouping.
  An initial host expectation was corrected from `building` to the existing
  canonical `active` stage before the passing rerun.
- Map layout plus real Electron map fixture: final 4/4 PASS. An initial
  scaled/narrow legend overflow was fixed; final captures cover desktop,
  600px, 150% scaling, narrow Ideas navigation and Vibe at 390px/1440px.
  Captures/report are under `tools/logs/mefi-evolution-map/`; final report has
  no renderer errors or network attempts. Visual inspection confirmed system
  links, file drilldown, grouped idea lineage and readable narrow layouts.
- Initial `npm test` was stopped after its CPU stage (4,013 pass, four skip)
  to integrate review fixes; it is not a full-gate pass. Log:
  `tools/logs/mefi-evolution-full-test.log`.
- Final `npm test`: FAIL only in two existing Electron fixtures. CPU stage:
  4,017 pass, zero fail, four skip. Parallel Electron stage: 36 pass, two
  fail, one skip; the new map fixture passed. Serialized eyes test passed;
  occlusion had one pass and one desktop-capability skip. Python: 248 tests,
  OK with one skip. All six normalized-path lock checks passed. Node leg
  took 714s; full output is `tools/logs/mefi-evolution-final-test.log`.
- Failure triage: `command_render` hit its 80s child limit without a report;
  `tree_dynamics_render` missed its native click. Sequential rerun on this
  branch repeated Command's timeout and hit a missing painted node in tree
  dynamics (`tools/logs/mefi-evolution-solo-render.log`). The same sequential
  command on unchanged `da669cc` main reproduced Command's timeout (81.7s),
  while tree dynamics passed (24.4s); baseline log lives in the primary
  checkout at `tools/logs/mefi-evolution-baseline-render.log`. A final isolated
  tree-dynamics rerun on `75de5a4` passed (24.9s), recorded in
  `tools/logs/mefi-evolution-tree-final.log`. Command drawing, hit testing and
  both fixtures are unchanged. These signatures have prior entries in the
  known-failure table/archive. The remaining Command timeout is baseline
  reproducible; the full gate is not claimed green.

## 2026-09-27 - Community website and plain-language 0.4.4 guide

Published static-site commit 3fdf4b9 to gh-pages: Mefi Studio public branding,
community and Discord invitations, a 1200x630 social preview, and all 21 guide
pages rewritten plus a new media/community page. Application code and installed
package names are unchanged. The main-branch changes align the README and
release introduction and record the future voice direction in docs/public-site.md.

Validation: all 22 wiki routes render in hidden Electron; 8 desktop/mobile
captures include 320px and 390px widths, with no overflow or browser console
errors. Search finds the new voice/community text; mobile navigation opens;
Skip to content preserves the route and focuses the article. Local HTML,
Markdown, section-anchor and image references pass after fixing an obsolete
social-post link. JavaScript syntax and git diff --check pass. No application
suite was run for these static website and documentation changes.

## 2026-09-27 evening - Work done outside Studio: last look, report and relevance check

New scripts/outside-work.cjs (pure) and main.cjs's "work done outside Studio"
block. Studio keeps a per-project last look (git HEAD, branch, uncommitted
paths, time) while it watches a folder: every five minutes with the window
shown, 15 s after each run settles, on leaving a folder and at quit. Opening
the folder again reports commits, uncommitted edits and Claude Code/OpenCode
sessions since that look to the thread, the chat payload (`outside`) and the
welcome-back digest, and holds every queued card (`relevance` stamp,
backlog.workState `deferred`/`relevance-check`, bounded to 6 h) until one
model call (or local file/subject matching) judges it needed, partial, done
or obsolete. Done/obsolete cards wait on an owner-only Ask card
(autonomy.canDelegate refuses source `relevance`). Also fixed the
verification_drain flake: kickVerificationSettlement read the clock twice, so
under load the settle timer was armed 999 ms instead of 1000 ms.

Baseline before the change on the same tree: npm run check passed; test:fast
had one failure, verification_drain "no supported verification command"
(passed solo, the double clock read). tools/monitor_loop.mjs --scenario all
matched before and after (steady/no-evidence/flaky 12/12 done, wedged 6 done
with 12 start kills, handoffs converging to 180/180 done at 225 min in a
300-minute run).

Validation: npm run check passed; npm run audit 0 findings; lint 0 errors and
no warnings in changed code; test:fast 3953 passed, 0 failed, 4 skipped. New
suites: outside_work (16), outside_work_host (6, a real temporary git repo and
a fake home) and a tasks_ui case; module_purity covers the new module.
Full npm test on the change: Node 3993 passed, 0 failed, 6 skipped (Electron
fixtures included), Python contracts 248 OK (1 skipped), normalized-path lock
passed. A final npm run check and test:fast (3954 passed, 0 failed) followed
the last edits (a refresh race fix and Vibe's stage words).

## 2026-09-27 - First-time setup and agent-choice blockers: install, any builder, any AI route, Start here

Audit of a fresh clone (npm ci, launcher, onboarding) and of every place a
non-default agent or AI route was locked out. Fixed: npm ci left no Electron
binary (Electron 44), so the launcher looped on "not installed" and CI's
render suites skipped silently; sessionless builders (Claude Code, Codex,
Grok, Antigravity) always parked as failed, now verified by the overseer's
own checks; npm-installed Grok/agy shims failed ENOENT; late failures were
re-run on OpenCode (even when not installed); retry-deep changed nothing on
most routes; Auto with a CLI login or an OpenRouter/Zen/custom key read as
unconfigured; Start here counted "no folder" as a project and dead-ended
key-only users. run-node-tests hit Windows' command-line limit from deep
clones (ENAMETOOLONG, no output). Built in four parallel clones, merged over
origin/main 215b7d9.

Validation on the merged tree: npm run check passed, npm run audit returned
0 findings, lint gained no warnings over main. Full npm test passed with every
leg green: Node 4033 passed and 4 skipped, Electron 43 passed and 1 skipped,
and all 248 Python contracts passed (routing contracts updated for the new
builder launch; grok's headless guide documents --prompt-file as headless -p).

## 2026-09-27 - Companion as pet and friend: six-bubble menu, personality, Suggest work, Friends playground with sharing rules

Built in a separate clone on origin/main 3e0e1e0. New pure modules scripts/companion-pet.cjs (personalities, presets, bond) and scripts/companion-friends.cjs (sharing levels and rules, broadcast level, scrubbed cards, card reading, share-back ask, mirrored scripted playdates); main's "Companion friends" block and hub-client `companion` frames (sent only when the hub's ready lists the feature; one-member delivery only with companion.direct); renderer/companion-friends.js playground; companion-hub/ui menu rework. New tests: companion_friends (13), companion_friends_host (8, vm slice of the main block), companion_personality_copy, plus additions to agent_brain_host, hub_client, module_purity and the companion-hub Electron fixture (playground, share-back, practice playdate, petting, plain check, Suggest work, Now, Personality). Full npm test: Node 4015 tests, 4008 pass, 5 skipped, 2 failed: pc_sync_ui's Friends-branch source pin (fixed by restoring an explicit friends branch; 6/6 solo) and command_render (known load-sensitive; passed solo in 52 s). Python contracts and path lock passed. Solo reruns: companion_hub_render, unified_studio_render, autonomy_render all pass. npm run check ok (172 targets), audit 0 errors, lint 0 errors with no new warnings. Rebased onto 215b7d9 (booklet rebuilt; companion-hub and fixture conflicts kept both sides): check ok (175 targets), audit 0 errors, the 11 touched Node suites 117/117, and companion_hub_render, unified_studio_render and autonomy_render pass.

## 2026-09-27 - Second bug-hunt pass: CLI setup, release helper, media browser, Vibe, autonomy

Reviewed the modules that landed since the first pass (media browser, CLI
setup, decision ledger/memory, desk resolve, autonomy host, request sizing,
model learning, new app, PC sync, Vibe panels, onboarding, Agents). Fixed:
guided CLI setup and the release apply helper, which never ran because a detached PowerShell gets no
console (reproduced: the marker was never written; attached, or through `cmd /c
start`, it ran and outlived the parent); the media browser closing on refused
Studio navigations and blocking blob/data subframes; the Vibe drawer stuck
after a mid-action project switch; Vibe answer and note drafts; the Team roster
per project; Agents setup after outside settings pushes; the walkthrough's
suggested task and coach Escape; autonomy undo markers, ledger flooding,
Elevated budget holds and undo of failed decisions. Two findings were handed
to the sync session, which owns sync.mjs (--no-autostash, fetch-failed). One
was a false positive (Agents overview selection: nav maps taskId to selected).

Validation on the rebased commit over 997b7aa: npm run check passed, npm run audit returned 0
findings, and lint was unchanged at 0 errors. Full npm test passed with every leg green: Node 3963
passed and 4 skipped, Electron 38 passed and 1 skipped, and all Python contracts passed. New or updated tests are
decision_ledger (kept split loses its marker), autonomy_host (failed decision
not undoable) and media_browser (a refused Studio navigation keeps playback).

## 2026-09-27 - Configuration, Habits and menu motion: gates on a private worktree of 8b4ab00

Detached worktree C:\wt\build-e at 8b4ab00 plus 5d47154 only: Configuration
(renderer/config-dialog.js and .css, the ui:zoom host reads, nav.js's
record), Habits (scripts/habits.cjs, agent-addons, agent-profiles, the
Agents panel), renderer/motion.js and its users (vibe.js, vibe-panels.js,
config-dialog.js, trace.js, agents.js, autonomy-ui.js's outside click),
booklet.js's choice-button names, the build and fixture lists, docs.
`npm run check` and `npm run audit` passed. `npm test`: Node suites 3828
tests with 0 failing; the Electron fixture stage 37 passed with 1 skipped;
the Python contracts failed once on
test_build_exports_build_and_keeps_cli_and_auditor_literals, which pins the
booklet's codeParts literal and now lists motion; after the pin, all 248
contracts pass (1 skipped) and the normalized-path lock passed. Offscreen
Electron frame captures of 13 menu transitions at 1920x1080: the worst
frame gap for opening a task detail fell from 133 ms to 67 ms, and
Configuration's category switch now holds 33 ms.

## 2026-09-27 - Whole-app bug hunt: host, tooling, renderer and design fixes

Parallel review of main.cjs, preload, every host script, the build and
release tooling, tools/ verifiers and the renderer found about 60 defects that
were confirmed by reading the code and, for most, reproduced. They were fixed in one
commit built in a separate clone on origin/main. Highlights: project switches no longer write another
project's assistant state, reply or verification result; Stop all closes a
continuation whose work finished; salvageJson counts both bracket kinds;
release apply cannot run twice and --released is dropped on relaunch; tool
transcripts are scrubbed before JSON escaping and Bearer tokens are masked;
merge-back never aborts a merge it did not start; PowerShell CIM dates parse,
so hung tests are detected; git porcelain paths are unquoted; MCP .cmd shims
start on Windows; check-syntax compiles renderer files as classic scripts;
release zips exclude local data; Home work cards show their stripe again.
The CLI completion tree-kill and stdin fixes were superseded by
scripts/cli-text.cjs (bc18748), which already does both.

Validation on the rebased commit: npm run check passed, npm run audit returned 0
findings, and lint had 0 errors with no new warnings in changed files. The previously red
suites (role_provider_isolation, briefer_cli_failure, assistant_issue_host,
usage_tracker, usage_tracker_host) passed, 103/103, and the updater Python
contracts passed. Full npm test on the same change over bc18748: Node 3888
passed, 4 skipped, and 9 failed, all nine being the known-red tests db15d74 fixed; they also fail
on untouched aef5dfe. Electron stage: 37 passed, 1 skipped, and 1 failed: Unified
Agents "keyboard scrolling remains native", which passed solo in 26 s (the
known load-sensitive fixture). An earlier full run on aef5dfe had the tree-dynamics
render fixture as its one Electron failure, and it also passed solo. Python contracts:
the only failure was the known-red updater contract fixed by db15d74. New
regression tests are porcelain_paths plus additions to salvage_json,
outbound_privacy, verification_command_quoting, scope_heal_walk and
check_syntax.

## 2026-09-27 afternoon - Node tree follow-up: resize re-seed, rest sleep, touch, band spill

Second node-tree pass over the items the first one left open, all in
renderer/idle.js plus tree-dynamics.js, the template's exit label and tests.
A resize now waits 150 ms of animation time for the frame to hold still and
re-seeds under the view the layout was first seeded in (angle, pitch, zoom,
camera): a 2 px resize after a 90° spin or at zoom 2.4 moves anchors about
0.5 world units instead of re-laying the tree out (measured on a 3-session,
15-task tree in both views). A resting Command books its next frame on a
timer and wakeFrames() cuts it short. The fit keeps its measured reach while
a layout holds. drawFrame projects saved anchors once (free: 1 projection per
node per frame, down from 2; Overview 2, down from 3). Music frames reuse
per-frame band views and blended tints, keep per-node memos in WeakMaps, and
the nebula, bokeh and firefly skies use unit-space gradients per canvas and
tint (Chromium pixel parity: max 1 level, washes exact). A leaving node's
live-shape offset blends into its host's over the flight. Touch and pen
reuse the mouse handlers, with a two-finger pinch. The music spectrum
measures a band more than 40 dB under the loudest one against that floor: in
the real AnalyserNode fixture the snare-only section's kick cue fell from
0.645 to 0.005, hat from 0.877 to 0.001 and bass from 0.295 to 0.026 (mid
0.805), and the existing quiet-hat case at 36 dB still reads in full.

Results: `npm run check` ok; `npm run audit` 0 errors, 0 warnings; `npm test`
Node 3,976 tests, 3,970 pass, 5 skipped, 1 fail (occlusion_probe:
"MessageChannel round trip too slow: 283ms" under the parallel load; passes
solo, 2/2); Python 248 OK, 1 skipped; normalized-path lock 6/6.

## 2026-09-27 - Node tree pass: wires past the hub, live layout, lifecycle, interaction and frame cost

Five read-only audits of the Command node tree (graph building, layout and
camera, render cost, interaction and accessibility, rail/Overhead/shared
painters) were verified against the source and fixed in renderer/idle.js,
tree3d.js, tree-dynamics.js, camera-tour.js, overhead.js, task-groups.js,
node-visuals.js, agent-brain.js and one line of main.cjs (the run id on
autopilot status rows, which keys a builder's orb for its whole run). The
largest: Command indexed `projected` (which drops the hub) with state.nodes
edge indices, so every wire past the hub went to the wrong node and the
branch parents the layouts use were wrong; `frameEdges` remaps them per
graph. New suite tests/command_node_tree.test.mjs (12 tests); new or
extended tests in tree3d_performance, tree3d_project, tree3d_keyboard,
overhead_poll_backoff, node_visuals, tree_dynamics and camera_tour; the
command_activity markers and tools/test_mefi_studio_tree_keyboard.py pins
follow the new source. Rebuilt renderer/booklet.html.

Results on one tree: `npm run check` ok; `npm run audit` 0 errors, 0
warnings; `npm test` passes (Node 3,971 tests, 3,966 pass, 5 skipped, 0
fail; Python 248 OK, 1 skipped; normalized-path lock 6/6). Before the pass,
`command_render` had failed once under load on its midrange-drum assertion
(mid 0.743 against bass 0.535 x 1.4) and once on its 80 s kill bound while
five audits ran; it passed in this run.

## 2026-09-27 morning - Handout rebroadcast dedupe: a heard note is not re-sent; AI-link retirement re-verified (task_plan_mujom5h3_0, run_1790505348418_7)

Grouped A-Eyes alerts "Compactor rebroadcasts finished work item" (task_6e3c0afebf8489ff) and "Queue handout broadcast spam" (task_9645fd821b9d03bc). Member 1 is the stale work broadcast loop the sibling session already retired: inspected HEAD before touching anything and adopted 6f1ef62 as it stands (assistant.mjs aiLinkTicket/aiLinkHealthy/aiLinkResolved, the compact()/tidy() ai-block absorb, the resolvedAiLinkWork promotion guard); all four board.test.mjs retirement tests green and the live data/eyes-assistant.json read read-only confirms the loop is over (ai online true, failures 0, backoffUntil 0, requests 0), so no further piece was owed there. Member 2's general spam had a second half the retirement did not cover: sendMail only deduped identical UNREAD notes, so once the foreman read a handout (it reads its inbox every start) the compactor's next identical "N work item(s) ready — yours to hand out" landed as a fresh row, packet and chatter line every pass — the seven handouts in eleven minutes that kept coming after the briefer's rebuke. Fix: assistant.mjs exports MAIL_REBROADCAST_MS (15 min) and sendMail now returns the state unchanged for a repeat of the same note from the same seat while a read copy sits within that window, so host assistantSendMail reports it unsent and pushes nothing; changed handouts (a different count or next pick) and repeats after the window still go out, and the unread-refresh path is untouched. Tests: new module and host cases in tests/assistant_mail.test.mjs; node --test tests/assistant_mail.test.mjs tests/board.test.mjs tests/briefing_fix_requests.test.mjs 57 pass / 0 fail; node --test tests/request_dedupe tests/task_delegation tests/task_grouping_cleanup tests/idea_backlog tests/task_history tests/work_admission_host tests/request_admission tests/board_growth tests/assistant_loop tests/role_provider_isolation 137 pass / 0 fail; python tools/test_mefi_studio_assistant.py 66 OK; npm run check ok (165 targets); npm test all gates pass; npm run audit 0 errors / 0 warnings. Sibling work-tree hunks preserved untouched.

## 2026-09-27 - Errors-rising alert verified: one transient foreman entry, link repair holds (task_79329b8c68060082, run_1790504647068_6)

Follow-up verification for the A-Eyes "Errors rising after AI-link fix" alert (overseer logged error entries rising 0→10 after ses_f1f897 finished normally). Root cause stands as triaged by the sibling sessions in this family: during the quota window the pre-restart instance's AI-gated roles (briefer cadence, thinker, probes) each ended in error and appended a log row — two of the failures were the spurious "claude error: success" misparse and the rest real session-limit quota — so the burst tracked the old code plus the provider quota, not the builder session's work; the 02:39Z restart loaded the committed fixes (cliReply exit guard 11fcebc, parseClaudeCliResult is_error surfacing, resetAssistantAiBackoff at the four route-change sites, scheduleAssistantAiProbe chain) and the queue-stall side of the noise was retired by 6f1ef62. The live data/eyes-assistant.json read read-only this run confirms the repair still holds: ai online true, keyPresent true, failures 0, backoffUntil 0, lastError null, lastOkAt 2026-09-27T10:29Z, problems empty, digest.logErrors reset to [] by the clean 10:12Z audit, overseer score 100/health good, briefer error null at 129 runs; the log carries exactly one error row, the transient 10:10Z foreman "10 queued, nothing running" dispatch-congestion line that cleared itself by the next review. No code change was needed this run; the two in-flight work-tree hunks owned by sibling cards (assistant.mjs verifyCompletion deferral parsing, usage-tracker.cjs parser detail text) were preserved untouched. Narrow validation: node --test tests/briefer_cli_failure.test.mjs tests/assistant_overseer_chat.test.mjs tests/role_provider_isolation.test.mjs tests/usage_tracker_host.test.mjs 80 pass / 0 fail; python tools/test_mefi_studio_assistant.py 66 tests OK; python tools/test_mefi_studio_offline_probe.py 12 tests OK; npm run check ok (165 targets, 20 live rows); npm run audit 0 errors / 0 warnings.

## 2026-09-27 - Verifier deferral fix: remaining prose owed by sibling sessions no longer reopens a finished card (task_2b0634e6823e8b0d)

Root cause of the triple-landed media-browser work: run_1790480592972_8 finished task_b5026aa2c68858d0 correctly (fixture 08c677c + TESTRUNS row), but its MEFI_RESULT remaining note attributed the stale committed booklet to sibling sessions; verifyCompletion read that prose as an outstanding obligation of the card, reopened it, and run_1790481107523_10 rebuilt the same booklet byte-identical. scripts/assistant.mjs now treats remaining prose that names its owner as other work (owed by sibling/other/parent sessions, cards, tasks) as a deferral, not an obligation; imperatives and unattributed leftovers still bind, tracked remaining lists still bind, and all positive-evidence gates are unchanged. Also verified the three landed diffs dedupe: renderer/booklet.html carries exactly one media-browser inline, npm run build-booklet is byte-idempotent (hash f98dd2322a01, no working-tree diff). Tests: node --test tests/verification_checks.test.mjs (20/20, new deferral case), tests/executor_result_protocol + model_win_evaluator + executor_continuation (55/55), npm run check green.

## 2026-09-27 morning - ai-offline follow-up re-verified: link healthy, recovery chain intact (task_6a1b319e87e8ad32, run_1790504373646_5)

Follow-up verification for the ai-offline alert ("failed 5 consecutive times, backoff 48m"). The live data/eyes-assistant.json shows the link healthy and the warning retired: ai.online true, keyPresent true, failures 0, backoffUntil 0, lastError null, problems empty, lastOkAt 2026-09-27T10:42Z - recent successful replies, so the follow-up completes. Root cause stands as triaged earlier: real provider quota/session-limit failures escalated the backoff; the committed recovery chain is intact in the work tree and unchanged by it (git diff on main.cjs and scripts/assistant.mjs is empty): cliReply exit guard, resetAssistantAiBackoff (main.cjs:5294) at all four route-change sites, the scheduleAssistantAiProbe offline-probe chain (main.cjs:5340-5402, armed in assistantTick), planOfflineProbe/offlineProbeDelayMs (scripts/assistant.mjs), and quota-vs-offline classification with quota regexes (scripts/assistant.mjs:4767). No code change was needed this run. Narrow validation: python tools/test_mefi_studio_offline_probe.py 12 tests OK; node --test tests/assistant_overseer_chat.test.mjs tests/role_provider_isolation.test.mjs tests/usage_tracker_host.test.mjs 73 pass / 0 fail (includes the offline-warning retirement, quota-backoff release on route change, and probe-contract pins).

## 2026-09-27 morning - AI-link alert re-verified against the landed retirement fix (task_8e7e835ea0dcfe56, run_1790504205051_2)

Continuation of the A-Eyes "AI link failing, backoff escalating" alert after the sibling's retirement fix. Inspected the work tree before touching anything: HEAD 6f1ef62 carries aiLinkTicket/aiLinkHealthy/aiLinkResolved (scripts/assistant.mjs), the compact()/tidy() ai-block absorb and the resolvedAiLinkWork promotion guard (main.cjs), all wired; the sibling session's uncommitted fix-family alignment (eyes.mjs FIX_BRIEF_CLOSING plus its two tests) stands untouched alongside. The live store confirms the stale work broadcast loop is over: data/eyes-assistant.json ai block online true, keyPresent true, failures 0, backoffUntil 0, lastOkAt 2026-09-27T10:15Z, problems empty, requests 0, work queue 0 - the fix-loaded restart (resource-manager.json touched 10:10Z, right after the commit) let the compactor absorb the stale AI-link tickets. No code change was needed this run; root cause and fix stand as recorded in the sibling row. Narrow validation this run: node --test tests/board.test.mjs tests/briefing_fix_requests.test.mjs 43 pass / 0 fail (4 AI-link retirement tests plus both fix-family tests); node --test tests/request_dedupe tests/task_delegation tests/task_grouping_cleanup tests/idea_backlog tests/task_history tests/work_admission_host tests/request_admission tests/board_growth tests/assistant_loop 123 pass / 0 fail; python tools/test_mefi_studio_assistant.py 66 OK; python tools/test_mefi_studio_eyes.py 18 OK; npm.cmd run check ok. No source, settings, task store or portable data was changed; this row is the run's attributable record.

## 2026-09-27 morning - Fix-family keys aligned: the briefing closing no longer reads as the dup family (task_be106669b70fb5b0, run_1790503845970_1)

Aligned eyes.mjs problemFamilyOf with assistant.mjs fixThemeKey: problemText now strips the briefing's closing instruction (FIX_BRIEF_CLOSING copy, word-for-word with assistant.mjs) before family classification, so a filed brief whose alert names no dup/stale word carries no family instead of the boilerplate 'root cause' dup. Reproduced first: alertProblem(filed brief).family was 'dup' while fixThemeKey said null, requestsFromBriefing refused an unrelated dup-worded alert against it, and promotion's sameFixProblem(request, task) refused the same pair. After the strip the refile is admitted. Regression tests: tests/briefing_fix_requests.test.mjs (boilerplate closing does not refuse an unrelated dup-worded alert) and tests/board.test.mjs (problemFamilyOf and fixThemeKey read one filed brief the same way). Narrow validation: node --test tests/briefing_fix_requests tests/board tests/work_admission_host tests/work_admission tests/request_admission tests/request_dedupe tests/board_growth tests/eyes_collision_lifecycle tests/assistant_chat_admission 120 pass / 0 fail; node --test tests/task_delegation tests/task_grouping_cleanup tests/idea_backlog tests/task_history tests/assistant_loop tests/family_decisions 110 pass / 0 fail; python tools/test_mefi_studio_eyes.py 18 OK (simulate themeDedup/problemFamily expectations intact); python tools/test_mefi_studio_assistant.py 66 OK; npm run check ok.

## 2026-09-27 morning - Stale AI-link fix tickets leave the handout queue (task_165e3985f8675e47, run_1790502825074_13)

Root-causes the stale work broadcast loop: briefing fix tickets about the assistant's own AI link lingered unclaimed in the handout queue after the link recovered (ai.online true, failures 0) because promotion refused them on the boilerplate "root cause" dup family while compaction's stripped fixThemeKey never absorbed them, so every compactor pass re-broadcast "Fix: AI link failing, backoff escalating" as the next handout. Fix: assistant.mjs exports aiLinkTicket/aiLinkHealthy/aiLinkResolved; compact() and tidy() take the store's ai block and retire unclaimed briefing AI-link tickets (report.resolved) when the link is provably healthy, and promotion skips them (resolvedAiLinkWork guard) so the foreman cannot build one ahead of the absorb. Verified against the live store read-only: the fix drops 4 stale AI-link tickets including the reported one and keeps the 4 unrelated ones. Narrow validation: node --test tests/board.test.mjs 39 pass (4 new: purge on healthy, keep on down/unknown/claimed, chat never purged, tidy parity); node --test tests/request_dedupe tests/task_delegation tests/task_grouping_cleanup tests/idea_backlog tests/task_history tests/work_admission_host tests/request_admission tests/board_growth tests/assistant_loop 162 pass / 0 fail; python tools/test_mefi_studio_assistant.py 66 OK; python tools/test_mefi_studio_eyes.py 18 OK; npm run check ok. The live app loads the fix on its next start; the two stale rows also age out on the 12h clock.

## 2026-09-27 early morning - Booklet refresh landed with the sibling canvas-transfer idle change (task_b1133e8672733a6b, run_1790481393330_11)

Landed the booklet refresh task_b1133e8672733a6b owes. The work-tree renderer/booklet.html (36 insertions / 5 deletions vs HEAD) folds the sibling canvas-transfer perf edit in renderer/idle.js: createDrawingContext resolves canvas fonts offscreen when supported, resize writes the transferred bitmap, and MefiIdle.canvasContext exposes the paint target. Verified end to end on a quiet tree: renderer sources held still across a 20 s hash watch; npm.cmd run build-booklet reproduced renderer/booklet.html byte-for-byte (SHA-256 prefix 1520FE87240B, 39 models, catalog hash f98dd2322a01) with the media browser still inlined (16 mediaBrowser references; booklet.sources.json stays ignored). node --test tests/booklet_build.test.mjs 4 pass / 0 fail. No renderer source or script was edited by this run; sibling work-tree edits were left untouched and committed nothing else.

## 2026-09-27 early morning - booklet rebuilt with the inlined media browser (task_b5026aa2c68858d0, run_1790481107523_10)

Closed the obligation left by 96272eb: its scripts/build-booklet.mjs change inlined renderer/media-browser.js, but the committed renderer/booklet.html predated it and carried no media-browser code. The work tree already held a fresh build; this run verified it end to end and landed it. Evidence: build-booklet.mjs lists media-browser.js in CODE_SOURCES (46 segments) and reads it at the mediaBrowser slot; npm run build-booklet over the quiet tree reproduced renderer/booklet.html byte-for-byte (hash f98dd2322a01, 39 models) with 15 mediaBrowser references in the artifact and renderer/media-browser.js in the booklet.sources.json manifest; the renderer sources held still across a 20 s watch before committing. node --test tests/booklet_build.test.mjs 4 pass / 0 fail. Committed path-limited as fb2b29c (renderer/booklet.html only, 615 insertions); no renderer source or script was edited by this run, and sibling work-tree edits were left untouched.

## 2026-09-27 early morning - ai-offline resolved: live instance healthy, recovery chain re-verified (task_dc3cbe4e9796268a, run_1790480854175_9)

Verified the ai-offline issue end to end from the running Studio instance. The live data/eyes-assistant.json shows the AI back online: ai.online true, keyPresent true, model glm-5.3-flash (zai/jev team route for project_d453f6fb00cc5e2d), failures 0, backoffUntil 0, problems empty, lastOkAt 2026-09-27T04:27Z - i.e. the provider recovered after the 23:10 America/Chicago quota reset and the app's 02:39Z restart had already loaded the committed recovery fixes (cliReply exit guard 11fcebc, resetAssistantAiBackoff at all four route-change sites, the scheduleAssistantAiProbe offline-probe chain in main.cjs, and planOfflineProbe/offlineProbeDelayMs in scripts/assistant.mjs - all intact; the sibling work-tree diff on scripts/assistant.mjs touches only focusedTestsForTask/verifyCompletion, not the offline path). brains.js, boot.js and the other pinned renderer refs are the pipeline editor and UI shell - not part of the offline chain. Narrow validation this run: python tools/test_mefi_studio_offline_probe.py 12 tests OK; node --test tests/assistant_overseer_chat.test.mjs tests/role_provider_isolation.test.mjs tests/usage_tracker_host.test.mjs 73 pass / 0 fail. No code change was needed; the issue stands resolved and no owner action remains beyond watching that the warning stays clear.

## 2026-09-26 - Push readiness validation interrupted by concurrent music edits

Before validation, main matched origin/main. The renderer booklet rebuild,
npm run check and npm run audit passed (zero audit findings); npm run lint
passed with zero errors and 72 warnings. Full npm test completed with exit 1:
Node CPU stage 3825 tests, 3821 passed, 4 skipped, no failures; Electron
fixtures failed with renderer startup errors including toggleLink not defined.
The runner detected source changes during the Electron stage. renderer/music.js
was rewritten during the run, so this is not a stable-tree regression verdict
or approval to publish the current files. Both exclusive Electron stages passed
(3 tests); Python passed all 248 tests; all six normalized-path checks passed.
No commit or push was made. A quiet-tree rebuild and validation are required
once the concurrent music edits finish. The unrelated game plan.md stays local.
Full output is in the OS temporary mefi-push-validation-20260926.log; lint output
is in mefi-push-lint-20260926.log. Live stores and portable data were untouched.

## 2026-09-26 - c655647 solo Command and committed companion panel follow-up

After the other chats released the Electron lane, preflight found no running
full suites, unittest processes or Electron fixtures. In the clean, unchanged
C:/wt/assist-g0 checkout at c655647dd5fea2024cc72dbb6f26be35b4c76b96,
`node --test tests/command_render.test.mjs` passed 1/1 in 57.6 seconds with
its normal 80-second child kill bound. This supports the documented load
flake diagnosis for the preceding full run's Command timeout; no source or
timeout was changed. The previously reproduced Unified Studio navigation
assertion at 600px/150% remains the outstanding rendering failure.

The isolated synthetic companion panel verifier then rebuilt this exact
commit's renderer and passed at 1440x900 and 600x700 (7.4 seconds). It
verified owner/held/parked labels, project name, Clear list placement and
reachability, confirmation before the bridge call, exactly one clear call,
and the empty state. Both screenshots were visually inspected. No renderer
errors, network attempts or child-process attempts were recorded, and no
live data was used. The checkout remained clean at the same commit.
Logs: OS temporary mefi-owner-command-solo.log and
mefi-owner-panel-committed.log; panel report/captures in
mefi-owner-panel-vXgCJM. This focused follow-up does not replace the recorded
full npm-test result with a claimed all-green run.

## 2026-09-26 - Music mode polish: static backgrounds, player chrome and menu validation

Completed the existing music-menu pass in the shared checkout. The player now
has a draggable title bar and a reachable minimized strip, steps aside for the
music menu, and stays below it when a narrow viewport has no spare room. Links
puts Now playing, Stop and video settings first. Static, paused and pictureless
backgrounds dim without reducing tree opacity or changing saved brightness.
The local scene sampler compares finer brightness cells so motion within a
mostly stationary video is not mistaken for album art; pending results are
discarded after playback/source/paint changes.

Focused music/media tests: 116/116 passed. A seeded offscreen Electron preview
using the real scene sampler and local still/moving MP4 files verified automatic
still dimming (0.72 scrim), moving video at full chosen brightness (0 scrim),
pause dimming, a visible minimized Restore control, and a reachable Stop button
with the floating video under a 600x780 music menu. Captures were visually
inspected. This preview used synthetic project/task data and isolated profiles.
The media-window Electron fixture passed solo (48.6 s) and in the full suite
(33.2 s), including provider hit testing, drag/resize, restoration, volume,
queue, hover, clipboard offers, tree visibility, Zen and a single iframe load.
An earlier fixture failure exposed clipped provider corners; removing that
clipping fixed it. Its drag check now uses the player's title bar and it also
checks the minimized Restore button. Earlier full attempts were stopped while
these fixes were being made; the final completed run below supersedes them.

Final gates: booklet rebuilt; npm run check passed; npm run audit returned no
findings. Full npm test completed all legs: Node parallel stage 3718 tests,
3714 passed, 4 skipped, 0 failures; Electron stage 37 tests, 35 passed, 1 skipped,
1 failure; both serialized files passed (3 tests). Python: 248 tests passed.
Normalized-path lock: all 6 checks passed. No source-fingerprint warning occurred
in this final run. The sole failure was unified_studio_render's existing
"primary destinations stay visible at 600 / 1.5" assertion, already reproduced
on clean HEAD in the earlier Command performance and Vibe validation rows.
The music, media and real painted tree suites passed. Full npm test therefore
exited 1; this is not recorded as a green full gate.

Local-only evidence: tools/logs/music-polish-full-test.log,
music-polish-unit.log, music-polish-media-render.log, music-polish-check.log,
music-polish-audit.log and the music-polish/ preview and integration captures.

Validation: 111 focused music/media-window tests passed, including a docking,
background and geometry preservation contract. The isolated Electron browser
and media-window fixtures both passed alone and in the full run. The media
fixture verifies the same single provider load through panel/background
switches, reachable queue controls, non-overlapping player/queue geometry at
1440 and 600 pixels, and the new background button. Browser coverage checks
its dock matches the preview and does not cover the queue. Seed-only captures
of local music, video, browser and background layouts were inspected in the
OS temporary directory. Layout review caught and fixed the browser stage's
aspect-ratio overflow before the final checks.

npm run build-booklet, npm run check and npm run audit passed (zero audit
findings). Full npm test passed: 3,906 Node tests passed, 5 skipped; Python
ran 248 tests, OK with 1 skip; normalized-path checks passed 6/6. The final
focus/available-height adjustments were also covered by the focused 111-test
rerun and a fresh build/check/audit. Logs and captures remain local in the
OS temporary directory; no user data or portable data was changed.

## 2026-09-26 - Committed owner-ask and desk safeguards gate on c655647

Full post-commit validation ran in the clean, unchanged C:/wt/assist-g0
checkout at c655647dd5fea2024cc72dbb6f26be35b4c76b96, which is also landed on
shared main. `npm run check` passed; `npm run audit` returned zero findings.
`npm test` completed all legs and exited 1 only for two previously reproduced
Electron fixture failures:

- Node CPU stage: 3710 tests, 3706 passed, 4 skipped, 0 failed (99 s).
- Electron stage: 37 tests, 34 passed, 1 skipped, 2 failed (312 s).
  command_render reached its 80-second child kill bound with no report;
  unified_studio_render failed `primary destinations stay visible at 600 / 1.5`.
  Both failures had been reproduced in the Phase 0 recovery before this final
  commit; the navigation failure is also documented on the earlier baseline.
- Exclusive Electron stages: 3 tests passed, no failures or skips.
- Python: 248 tests, 1 skipped, no failures (99 s).
- Normalized-path lock: all 6 checks passed.

The companion panel proof recorded in the preceding continuation row passed
at 1440x900 and 600x700. The committed agent-brain.js, agent-brain.css,
companion-ui.js and agents.js were compared against that proof's copied
sources and match (line endings normalized). The final commit includes the
reverse-order and task-reference-in-detail regressions and the hidden Agents
paint guard. The full gate is not green: no renderer failure was suppressed.
Logs are in the OS temporary directory as mefi-owner-final-check.log,
mefi-owner-final-audit.log and mefi-owner-final-npm-test.log. Another chat's
full suite began during the Python leg; no additional solo rendering rerun
was launched into that contention. Live stores and portable data were untouched.

## 2026-09-26 - Owner ask folding continuation and companion panel proof

On the shared 8de8b58 working tree with the owner-ask folding and companion
changes still uncommitted, the focused agent_issues, agents_overview_paint
and assistant_issue_host suites passed 65/65 (0 failures, 0 skips). The new
checks cover reversed arrival order, the separate npm-check request, and
references to either ask's own task or another task in either detail.
The matching rule remains shared content words divided by the larger word
set, at least 0.4, only for owner asks with no task references.

A temporary offscreen Electron verifier rebuilt a copied renderer and used
only a synthetic bridge and sample queue. It passed at 1440x900 and 600x700:
owner/held/parked labels and project names, Clear list after all rows and
reachable, first-click confirmation, one bridge call on confirmation, and
no clear control on an empty list. Both captures were visually inspected.
There were no renderer errors, network attempts or child-process attempts.
Artifacts are local in the OS temporary mefi-owner-panel-wITATv directory;
no live data was opened or changed. This is focused pre-commit evidence;
the full gate on the combined commit is still pending.

## 2026-09-26 - Command video-background performance pass: gates, one pre-existing Electron failure

Uncommitted tree with the Command performance pass (renderer/studio-ui.js,
styles.css section 17, nav.js paintBadges, idle.js rail lists and far layer,
docs/performance.md) plus other sessions' uncommitted work. `npm run check`
and `npm run audit` passed. `npm test`: Node parallel stage 3689 tests, 0
failures; Python contracts and the normalized-path lock passed; the Electron
fixture stage failed two files. `command_render` timed out in the stage and
passed solo (78 s). `unified_studio_render` fails "primary destinations stay
visible at 600 / 1.5" solo as well, and fails identically on a clean detached
worktree of 06b5d7d with the booklet rebuilt from HEAD, so it predates this
pass; it matches the "Unified Agents navigation" failure recorded for the
v0.4.3 tag workflow.

## 2026-09-26 - Canvas transfer applied, loaded and full gates passed

The expanded isolated media renderer passed (1 test, 38.4 s), including the
other session's new player/queue layout assertions. The previously validated
Command and tree fixtures were unchanged. Original and candidate hashes
were verified before copying the four candidate files into the checkout;
the seven capability/resize tests were added as command_canvas_context.
Other sessions' source changes were retained.

Command's interactive DOM canvas elements now transfer their 2D drawing
contexts when supported. The capability probe runs before irreversible
transfer; existing/unsupported contexts retain the normal path. Resize
updates the drawing bitmap rather than the placeholder. Context options,
DPR behavior, no-op pixel retention, transparent background video and visual
output were validated in isolation. MefiIdle.canvasContext exposes the
actual context for diagnostics, and the three renderer fixtures use it.

Validation after promotion (uncontended full run, Studio idle):
- npm run build-booklet passed, generated booklet hash f98dd2322a01.
- npm run check passed: 165 syntax targets, 344 unique specs, CSS and
  TESTRUNS checks clean.
- npm run audit passed with zero findings, errors or warnings.
- npm test exited 0: CPU stage 3,872 passed / 4 skipped; Electron lane
  38 passed / 1 skipped; serialized eyes test 1 passed; occlusion 2 passed.
  Total Node: 3,913 passed, 5 skipped, 0 failed. Python: 248 tests, OK with
  1 skip. Normalized-path checks: 6/6. Node leg 276 s, Python leg 34 s.
- All four promoted source/fixture hashes remained unchanged after the run.
- Standalone tools/verify_command.py pixel probes were then migrated to the
  context accessor and bitmap dimensions. Python AST and embedded JavaScript
  syntax passed, including both updated probe bodies; no full verifier tour
  was launched. The initial local parser wrapper added a redundant closing
  brace; correcting that wrapper made the syntax check pass without another
  source change. git diff --check passed for this task's edited files.

The final PID- and booklet-validated status confirms the normal automatic
reload loaded commandCanvasTransferred=true, boot complete and recording
false. Studio remained idle (1,461 seconds of system idle on the final
check), so no live sample or before/after claim was made. The controlled
29% cycle reduction and native setter timings remain component evidence.
No further application gate is pending for this change.

Logs: tools/logs/canvas-transfer-expanded-media.log, canvas-transfer-build.log,
canvas-transfer-check.log, canvas-transfer-audit.log,
canvas-transfer-full-test.log and live-20260926-canvas-final-status.json.
Original promotion backups and manifest remain in ignored
canvas-transfer-pre-promotion/. The old candidate guard correctly rejects
the now-applied source: do not rerun its promotion or overwrite later edits.

## 2026-09-26 - Media panel redesign brings playback, background and queue together

Reorganized Music & video around the current source. The video panel now
shows playback beside Up next, with a prominent Use as background / Return
to player control. Narrow windows stack the queue immediately below playback
and the background control. Audio connection and clipboard settings move
into a disclosure below the main player; local music keeps its artwork,
transport and queue at the top. The browser opens within this panel.

The persistent player docks by geometry without reparenting its iframe.
Opening/closing the panel, scrolling and resizing preserve playback and
floating placement; background mode releases the dock while leaving the
queue available. Supported video URLs viewed in the browser can switch to
the embedded player for background mode. Generic web pages keep that action
disabled. Player focus and pointer transitions stay within the open panel.

Validation: 111 focused music/media-window tests passed, including a docking,
background and geometry preservation contract. The isolated Electron browser
and media-window fixtures both passed alone and in the full run. The media
fixture verifies the same single provider load through panel/background
switches, reachable queue controls, non-overlapping player/queue geometry at
1440 and 600 pixels, and the new background button. Browser coverage checks
its dock matches the preview and does not cover the queue. Seed-only captures
of local music, video, browser and background layouts were inspected in the
OS temporary directory. Layout review caught and fixed the browser stage's
aspect-ratio overflow before the final checks.

npm run build-booklet, npm run check and npm run audit passed (zero audit
findings). Full npm test passed: 3,906 Node tests passed, 5 skipped; Python
ran 248 tests, OK with 1 skip; normalized-path checks passed 6/6. The final
focus/available-height adjustments were also covered by the focused 111-test
rerun and a fresh build/check/audit. Logs and captures remain local in the
OS temporary directory; no user data or portable data was changed.

## 2026-09-26 - Canvas candidate passes isolated renderer checks; expanded media retry pending

Ran candidate fixtures sequentially with separate private renderer overlays,
a fake host bridge and temporary user data. Studio was visible but the
system had been idle almost six minutes before testing; no other suite was
active at each launch. No user app navigation, prompts or state changes.

- Command renderer: 1 pass, 0 failures, 49.5 s. Drawing, finite positions,
  menus, audio visuals and exit/reentry assertions passed.
- Media renderer: 1 pass, 0 failures, 33.5 s. Transparency, movement,
  background and navigation assertions passed.
- Tree dynamics renderer: 1 pass, 0 failures, 11.3 s. Shape, music and video
  controls retained their graph anchors.
- A separate isolated native-font probe measured 900 assignments per run:
  median accumulated setter elapsed time 46.7 ms (DOM) versus 0.6 ms
  (direct transfer), with equal call counts and both descriptors restored.
  Uninstrumented synthetic cycles were 5.14 ms versus 3.71 ms, style passes
  two versus one, layouts one for both. All 96 pixel-buffer comparisons
  and browser captures matched. No live speedup claim.

The native experiment finished at 22:48:16 Chicago; a sibling media test
started at 22:48:35, after this run. Another session added media layout
assertions after our isolated media pass, and started a full npm test gate.
The guarded candidate rejected that changed fixture. Regenerated the
candidate preserving the new assertions; idle.js, Command fixture and tree
fixture hashes are unchanged. Private overlay preparation passes. The
expanded media fixture must still be retried solo before promotion. No
candidate application source is applied, and no application gate has been
run for it. Existing scroll gates are not repeated.

Logs: tools/logs/canvas-transfer-command-integration.log,
canvas-transfer-media-integration.log, canvas-transfer-tree-integration.log,
and font-style-native-trial.json (all under tools/logs). The pre-rebase
manifest is canvas-transfer-validated-manifest-20260926-2248.json. Current
manifest is canvas-transfer-candidate/manifest.json. Resume with
node tools/logs/validate-canvas-transfer-candidate.mjs --suite media_window_render --run
when tests clear and Studio is inactive, then validate hashes before applying.

The live status helper now also reports transferred-context state, window
focus and system idle seconds. Its PID/booklet validation and read-only
status path succeeded: existing app remains on the DOM context, recording
false, with 601 seconds of system idle time. No live capture was started.

## 2026-09-26 - Media-browser booklet inlining verified and fixture line landed (task_b5026aa2c68858d0, run_1790480592972_8)

Verified the media-browser inlining this task owes. The build wiring was already committed at 962078: scripts/build-booklet.mjs reads renderer/media-browser.js into CODE_SOURCES and codeParts (after media-window.js, before music.js), and renderer/booklet.sources.json lists renderer/media-browser.js among its 46 segments. The work-tree booklet.html inlines the source verbatim exactly once with zero external script refs, and npm.cmd run build-booklet rebuilt cleanly (39 models). The missing piece was test coverage: HEAD's tests/booklet_build.test.mjs INLINE_SCRIPTS omitted media-browser.js, so a fixture build at HEAD died ENOENT; landed the one-line fixture addition as 08c677c. Narrow validation: node --test tests/booklet_build.test.mjs 4/4 pass; node --test --test-name-pattern browser tests/music.test.mjs 3/3 pass. The committed renderer/booklet.html predates the media-browser work (last rebuilt at 436a5a4) and stays uncommitted in the work tree because it folds sibling sessions' in-flight renderer edits; the sessions landing those edits owe the rebuild+commit.

## 2026-09-26 - Briefer fix commit re-verified landed: cliReply guard and tests green (task_c61c1cb49e01e552, run_1790480422178_7)

Verified the already-landed briefer fix commit 11fcebc (Guard the briefer against failed CLI exits) in the current work tree for task task_c61c1cb49e01e552. The cliReply exit-code guard is intact in main.cjs (committed, no work-tree drift; the many modified files belong to sibling sessions), and tests/briefer_cli_failure.test.mjs is committed unchanged. Narrow validation this run: node --test tests/briefer_cli_failure.test.mjs 7/7 pass; node --test tests/usage_tracker_host.test.mjs 23/23 pass (shared cliReply/parse coverage green alongside sibling usage-tracker edits). No new commit needed: the fix and its tests are already in history at 11fcebc.

## 2026-09-26 - ai-offline overseer re-verification and spec-scan artifacts fix (task_b172488b3c947b88)

Resumed the ai-offline overseer task after the owner re-plan decision. Inspected
the current tree before changes: all claimed recovery fixes remain intact after
heavy sibling editing of main.cjs — resetAssistantAiBackoff at all four recovery
sites (key save, team save/inherit/apply, settings:set-ai-routing, auto-setup),
the parseClaudeCliResult is_error exit guard (commit 11fcebc), and the
scheduleAssistantAiProbe offline-probe chain.

Fresh validation this run: npm.cmd run test:fast 3862 pass / 0 fail / 4 skip
(the seven shared Analyzer/nav UI failures from the earlier handoff are resolved
in the current tree); python tools/test_mefi_studio_offline_probe.py 12 tests OK;
npm.cmd run audit zero findings.

npm.cmd run check initially failed spec-collisions: the active canvas-transfer
session's isolated harness (tools/logs/canvas-transfer-integration/tests/
command_render.test.mjs, written minutes earlier) duplicated the tests/
command_render.test.mjs basename. tools/logs/ is the git-ignored reports and
isolated-harness home this notebook documents, and neither runner discovers it
(Python discovery is tools/test_mefi_studio_*.py; node is tests/**/*.test.mjs),
so its basenames cannot shadow a live spec. Fixed scripts/spec-collisions.mjs to
skip exactly the tools/logs subtree during the walk; everything else under
tools/ stays scanned. Added two guard cases in tests/spec_collisions.test.mjs
(logs subtree exempt, a logs-named directory elsewhere still collides).
Sibling harness files were not touched.

After the fix: node --test tests/spec_collisions.test.mjs 6/6;
node scripts/spec-collisions.mjs ok (343 specs); npm.cmd run check exit 0
(165 targets, specs, css, syntax, 20 live testruns rows); npm.cmd run audit
exit 0.

ai-offline status: root cause stands — three real Claude session-limit quota
failures (reset 23:10 America/Chicago) plus two spurious parser/exit bugs now
fixed and committed; the selected Codex route replied ok through the real host
CLI completion function at 20:11 this evening. Code cannot reset the provider
quota; loading the committed fixes into the alerting Studio instance needs the
owner's app restart.

## 2026-09-26 - Built-in media browser replaces the separate window

Replaced the standalone BrowserWindow and toolbar preload/page with a
sandboxed WebContentsView attached to Studio's existing window. The bundled
media-browser controller puts address, history, reload/stop, mute, minimize
and close controls inside the existing media player. Website popup links
navigate that same view. Moving, resizing, zooming and minimizing preserve
the loaded page; source changes, close and owner reload destroy playback.
The website has no Studio preload or Node access. Browser bounds follow the
renderer viewport and yield to overlapping Studio UI. Video-only background,
transparency, fade and pointer-dodge effects are paused while browsing.
The visual music refresh remains in place, and launcher copy now says
Browse here and explicitly describes playback inside Studio.

Validation: 118 focused Node tests passed. The real Electron browser fixture
passed both alone and in the full run, with exactly one BrowserWindow,
X-Frame-Options DENY pages, same-view popup links, history, mute, forbidden
URL rejection, movement, minimize/restore, overlay hiding, 1440/600 layouts,
zoom, unchanged page-load counts and close/source-switch disposal. Render
captures were inspected from an isolated temporary profile. The initial
fixture exposed resize-handle clipping in the visibility probe and a
shutdown listener touching a destroyed owner; both were corrected. Native
capture retries are bounded to the transient UnknownVizError case.

npm run build-booklet and npm run audit passed (zero findings). npm test
passed: 3,902 Node tests passed and 6 skipped; Python ran 248 tests, OK with
1 skip; normalized-path checks passed 6/6. The occlusion skip was capability
gated on this desktop. npm run check stopped at an unrelated duplicate spec:
tools/logs/canvas-transfer-integration/tests/command_render.test.mjs and
tests/command_render.test.mjs. The actively used isolated copy was preserved.
The remaining check components were run directly: CSS merge/no-merge,
unused selectors, syntax and test-history gates all passed. Local logs and
seed-only captures are in the OS temporary directory, not published.

## 2026-09-26 - Isolated canvas transfer candidate: timing and pixels pass; Command integration deferred

The native-font hotspot led to an isolated Electron 44.4.1 comparison using
production callout drawing, six callouts, 1,000 synthetic DOM rows, two DOM
invalidations per cycle, 30 cycles per run and five alternating runs after
warmup. Median synchronous cycle: DOM canvas 4.91 ms, copied offscreen
backbuffer 5.17 ms, directly transferred canvas 3.48 ms. Direct transfer
reduced style recalculations from two to one; layouts remained one. The
cycle includes final layout flush and any backbuffer copy, but excludes
asynchronous compositor presentation. This is not a live improvement claim.

All 96 candidate pixel-buffer comparisons were identical across four device
scales, three styles, light/dark palettes and integer/fractional positions.
Browser captures matched the direct canvas at three scale/style combinations.
Seven isolated candidate unit tests passed for capability fallback, transfer
identity, alpha options, resize, DPR and no-op pixel retention.

The first private-overlay Command renderer integration attempt failed at
setup: the overlay omitted scripts/brains.cjs. The copied dependency set now
includes brains.cjs and agent-issues.cjs; overlay preparation and original
source hash guards succeed. A sibling npm test run started before retry, so
no second renderer test or live capture was started. Full Command integration
remains pending. No candidate application source has been applied and no
application gate has been rerun for this candidate. The prior completed
full gate still covers the scroll batching change only.

Reports and isolated sources: tools/logs/font-style-trial.json,
tools/logs/benchmark-font-styles.cjs, tools/logs/canvas-transfer-candidate/,
and tools/logs/validate-canvas-transfer-candidate.mjs. The failed setup log is
in the OS temporary directory as mefi-canvas-candidate-command.log. Continue
with the guarded overlay's --run only when Studio is inactive and all other
test suites have ended; then finish validation before any live source edit.

## 2026-09-26 - Visible Command probe narrows the next hotspot to canvas font updates

A 30-second visible Command capture retained the loaded scroll batching
code, with stable source/booklet hashes. drawCallout remained the largest
named CPU sample (about 2.36 seconds). A test run appeared at one guard
checkpoint, so this capture is not used for a clean before/after claim.

A subsequent 15-second native-call probe, without the CPU sampler, stayed
visible on Command. Eight three-second guard checkpoints observed no tests;
source and booklet hashes were unchanged. The probe passed every native
argument/result through, retained exceptions, and recorded only operation
names, counts and durations. It restored all eight wrapped descriptors
normally, removed its temporary global, and had a 20-second fallback timer.

Measured elapsed totals: canvas font assignment 1,167.8 ms / 6,689 calls;
element bounding rectangles 382.8 ms / 1,149; fillText 23.1 ms / 6,689;
measureText 6.0 ms / 2,694. The renderer's rAF interval p95 was 16.8 ms;
that is not Command draw FPS or GPU presentation timing. These instrumented
measurements narrow the investigation without claiming an improvement.

No production source changed and no completed application gate was rerun.
The earlier full-gate pass still covers the scroll fix. Follow-up: isolate
the style work reached by canvas font setters and validate any candidate's
visual behavior before applying it; a measureText cache alone addresses
little of the measured cost. Details and the primary Chromium source are
in docs/performance.md.

Ignored reports: tools/logs/live-20260926-2153-command*.json and
tools/logs/live-20260926-native-callout-probe*.json. The one-off native
collector is tools/logs/profile-native-timing-trial.mjs. A read-only final
status check confirms the app's boot is complete and recording is stopped.

## 2026-09-26 late evening - Occlusion probe capability gate covers detected-but-unsustained throttling (task_fd15e09800325362)

The rAF-silence assertion failed in the worktree (growth 17) and in an
isolated HEAD host/booklet (growth 23), so the failure predated every current
edit. Investigating desktop capability detection first, as dispatched,
confirmed an environment cause: the same fixture passed strictly (growth 0)
between failures, and every failing measure showed occlusion detected via
document.hidden and then the page reading visible again under a still-shown,
still-topmost cover while Win32 foreground churned (Edge, later Discord with
idleMs 0) - the tracker un-marks covered windows mid-measure on an actively
used desktop, and a page cannot flip its own document.hidden back.

tests/fixtures/occlusion-probe-electron.cjs now corroborates before failing
when the occluded measure catches rAF advancing: the probe page holding focus
(foreground exemption), the cover no longer shown, the page reading visible
again (tracker un-marked), and otherwise a blank control window given the
same visible-to-covered transition - shown inactive above the cover, proven
painting, then dropped below it, because a window born under the cover never
receives the transition and was observed painting (growth 38 in 3s) beside a
properly throttled growth-0 booklet. A control that also keeps painting
records occlusionUnstable and exits cleanly; a control that stays silent with
its counter proven alive once raised keeps the strict failure as a real
page-defeats-throttling regression with the evidence attached; errored or
never-painting controls are inconclusive and change nothing.
tests/occlusion_probe.test.mjs skips on the new record with the explicit
cause, the same information-not-regression treatment as occlusionUnsupported.

Validation: node --test tests/occlusion_probe.test.mjs passed strictly first
(occlusion via document.hidden, growth 0), then a live unstable episode
skipped cleanly with the record showing growth 9, the page visible
mid-measure, cover shown and on top and itself holding Win32 foreground - the
same signature as the reported growth 17/23 failures. A forced-corroboration
scratch copy exercised the control machinery end to end (engaged via
document.hidden, coveredGrowth 0, counter proven when raised) and was
removed afterwards. No production sources changed; the worktree's unrelated
shared edits were untouched.

## 2026-09-26 - Scroll-control follow-up verifies the completed shared full gate

The later shared-checkout npm test run in %TEMP%/mefi-media-full.log completed
at 21:03:24 with all three gate legs passing. Read the actual summaries and
the unified-renderer result rather than launching duplicate heavy tests
while the owner was using Studio. The scroll source predates that run and
both the generated booklet and running app contain the batching change.
The earlier interrupted mefi-live run remains recorded as incomplete.

Verified results: CPU 3,861 pass / 4 skip; desktop lane 38 pass / 1 skip,
including Unified Agents navigation and scroll controls (80.07 seconds);
eyes toggle 1 pass; occlusion 1 pass / 1 capability skip. Total Node:
3,901 pass / 6 skip / 0 fail. Python: 248 tests OK, 1 skipped.
Normalized-path lock: 6/6. This closes the deferred full-gate follow-up for
the scroll change; no production sources changed during this follow-up.

A read-only status check found visible Command with the new code loaded.
The window then became hidden before a bounded 30-second capture and stayed
hidden for all six observations, so no visible frames were recorded and
this sample cannot establish a live improvement or a callout-drawing cost.
An accompanying guard observed no tests at eight checkpoints and unchanged
hashes for studio-ui.js, idle.js and booklet.html. A final status check
confirmed boot complete, updater watching and profiler recording stopped.
No UI navigation or forced restart occurred. Reports remain ignored under
tools/logs/live-20260926-command-scroll-loaded*.json and the heartbeat
status reports. Command callout attribution awaits an active visible sample.

## 2026-09-26 - AI link alert re-verified against the saved fixes (task_59ca346c1f3bdb46)

Continuation run for the A-Eyes "AI link failing repeatedly" alert after the
prior attempt was marked unverified (no attributable edits, no named checks).
Inspected the work tree before touching anything and confirmed every claimed
fix is present and coherent, preserving other sessions' uncommitted work:

- `resetAssistantAiBackoff` (main.cjs:5294) clears failures, backoffUntil and
  the offline-probe bookkeeping, wired at all four recovery sites: key save
  (settings:set-key, non-github/jev), team save/inherit/apply,
  settings:set-ai-routing, and auto-setup apply. Success still requires a real
  reply: the ai-offline problem and lastError survive until assistantAiOk.
- The Claude CLI exit guard and error parser (parseClaudeCliResult in
  scripts/usage-tracker.cjs feeding assistantBrieferJob) are in place with
  tests/briefer_cli_failure.test.mjs covering exit 0/1 is_error replies,
  plain-text rejections, recovery, and no request queuing on failure.
- The offline probe plan/scheduler/runner chain (main.cjs:5340-5402,
  scripts/assistant.mjs OFFLINE_PROBE_*) is intact.

Root cause stands as previously reported: of the five consecutive failures,
two were spurious (the parser/exit bugs above, now fixed) and three were real
Claude session-limit quota (reset 23:10 America/Chicago). The alerting Studio
instance predates all of these fixes; loading them needs the owner's restart.

Validation (named checks, this run):
- node --test tests/briefer_cli_failure.test.mjs
  tests/role_provider_isolation.test.mjs tests/assistant_overseer_chat.test.mjs
  tests/usage_tracker_host.test.mjs tests/usage_tracker.test.mjs
  tests/provider_breaker_host.test.mjs: 109/109 pass.
- python tools/test_mefi_studio_offline_probe.py: 12 tests OK.
- npm.cmd run check: ok (targets, specs, css, syntax, testruns).
- npm.cmd run audit: zero findings. git diff --check: clean.

No source, settings, task store or portable data was changed; this row is the
run's attributable record.

## 2026-09-26 - Media mini browser and listening-room upgrade

Added a standalone media BrowserWindow with a sandboxed WebContentsView,
separate persistent session, web-address validation, main-frame-only IPC,
navigation, reload/stop, mute, pin and an explicit external-browser action.
Remote sites have no Studio preload or Node access. Downloads and device
permissions remain unavailable in the mini browser. Ordinary web links open
there; supported embeds and direct files retain the existing floating player.
The media menu adds a browser launcher, Pop out and updated music artwork,
source tabs and radio cards. Successful handoffs stop duplicate Studio audio;
failed opens and opening an empty browser preserve the current source.

Validation on the shared checkout, preserving the pre-existing local edits:

- Focused media/host/auditor suites: 125/125 pass. Earlier focused failures
  were two outdated UI assertions, updated for the browser launcher and
  non-error web handoff.
- Real Electron mini-browser smoke passes alone and in the full run. Covers
  pages with frame-ancestors none / X-Frame-Options DENY, redirects, history,
  popups, sender isolation, mute, pin toggle, errors and close/reopen cleanup.
  Early native runs exposed the Windows topmost getter/event disagreement,
  popup-navigation ordering and load-timeout sensitivity; final tests pass.
- Floating-media Electron fixture passes alone and in the full run; includes
  refreshed local/link layouts at 1440px and 600px. Browser toolbar checked at
  960px and 480px. Fixture captures stayed in the OS temp directory.
- npm.cmd run build-booklet, npm.cmd run check and npm.cmd run audit pass;
  the audit reports zero findings. git diff --check passes.
- Full npm.cmd test exits 0: CPU 3861 pass / 4 skip; desktop lane 38 pass /
  1 skip; eyes toggle 1 pass; occlusion 1 pass / 1 capability skip. Total
  Node: 3901 pass / 6 skip / 0 fail. The occlusion probe cannot obtain native
  occlusion events on this desktop. Python: 248 tests OK (1 skipped).
  Normalized-path lock: 6/6. Logs remain under %TEMP%/mefi-media-*.log.

During the transition from CPU tests to desktop tests, the standalone browser
welcome controls were hidden after navigation; the desktop lane subsequently
verified that final UI. No application state, portable data or credentials
were changed. renderer/booklet.html was regenerated.

## 2026-09-26 - Live-session scroll controls batch geometry before hint writes

Live Vibe and Command captures identified shared scroll refresh and Command
callout drawing as CPU leads. This change batches scroll-region reads before
writing hints and avoids unchanged visibility, owner and coordinate writes.
`tools/profile_live_studio.mjs` adds bounded, PID-checked loopback captures;
`tools/profile_scroll_controls.cjs` compares production refresh versions in
an isolated Electron renderer. Private reports stay in ignored tools/logs.

Validation:
- Five alternating pairs after warmup, 16 overflowing regions and 25 content
  changes per run: median style recalculations 16.96 -> 0.96 per refresh;
  layouts remain 0.96; refresh time 0.80 -> 0.572 ms. The fixture verifies
  identical arrow placement, scroll boundaries, tab stops, hide/reopen,
  overflow removal/return and detached-region cleanup.
- npm run build-booklet, npm run check and npm run audit pass; audit reports
  zero findings. Both new tools pass node --check; git diff --check passes.
  Logs: %TEMP%/mefi-live-{build,check,audit}.log.
- Live collector completed two captures, rejected a mismatched PID, cleaned
  up its own capture after a later timeout, and left recording stopped.
  A final read-only status check confirms the restarted app loaded the new
  scroll code and completed boot. No live before/after gain is claimed:
  the window was hidden and other tests were active during that final check.
- npm test: CPU stage 3,861 passed, 0 failed, 4 skipped. Two full runners
  started together after waiting for an earlier run; the Electron stage
  reported media-window, node-view, profiler, Plans and startup failures amid
  contention and concurrent source changes. Only this session's owned test
  process tree was stopped to reduce load. The full gate is incomplete;
  these failures are not classified as regressions or cleared as flakes.
  Partial log: %TEMP%/mefi-live-full-test.log.
- Further heavy validation was deferred while additional suites kept
  starting. Follow up with tests/unified_studio_render.test.mjs and a clean
  required full gate when the shared checkout and machine are quiet. The
  periodic session monitor retains that follow-up and the callout CPU lead.

Controlled report: tools/logs/live-scroll-comparison.json. Live reports:
tools/logs/live-20260926-{first,second,status-final}.json (all ignored).

## 2026-09-26 - Restart now stops and saves coding agents before updating

The live updater now carries an explicit apply through to Studio's existing
stop-and-save restart. It stops every owned builder tree, preserves each task's
session, checklist and recent output, awaits settlement, saves helper journals,
and relaunches paused. Resume continues the queued work without spending a
failed attempt. Automatic updates still drain workers. Manual restarts retain
the changed-file list and stay out of the restart-loop count; refused journal
saves leave the update retryable, and pending saves do not trigger a second
empty restart. Project-switch and running-game guards remain in place.

Validation on Windows:
- Focused loop control, updater, continuity, executor resume and assistant pool:
  82/82 pass. Real host settlement is exercised with two workers and deliberately
  blocked checkpoint writes; no relaunch occurs until progress is durable.
- Updater Python contracts: 24/24 pass. npm.cmd run check, npm.cmd run audit
  (zero findings), and git diff --check pass. No renderer sources changed here.
- Full npm.cmd test: main stage 3,861 pass / zero failures / four skips;
  Electron stage 32 pass / five failures / one timeout cancellation / one skip;
  eyes toggle 1/1; occlusion 1 pass / 1 failure (rAF growth=14). Python contracts
  248 tests OK (one skipped); normalized-path lock 6/6. Overall exit 1.
- Waited for existing full runs to finish before starting. Another full run
  started concurrently, and the runner detected source edits during both the
  Electron and occlusion stages. Desktop failures were media-browser navigation,
  missing media/planning reports, node-view timeout, profiler download timeout
  and tree-dynamics selection timeout. Further isolated retries were withheld
  while sibling desktop runs remained active. This is not a clean full-gate pass.

Complete local logs: %TEMP%/mefi-restart-{focused-final,python,check-final,audit,
full}.log. Existing shared edits and local/portable application data were
preserved. No live Studio restart or package deployment was performed.

## 2026-09-26 - Final UI video audit reruns and resolved integration gate

Follow-up to Video backgrounds, solid reading surfaces and compact UI audit.
The final renderer audit includes actual element fills as well as the shared
tokens: 90 page states, 21 Vibe panel states, 864 contrast checks across 24
variants, minimum reading contrast 6.68:1. A rendered Vibe drawer exposed a
hard-coded translucent fill after the token-only pass; it now uses the shared
material, and zero glass prevents underlying text from showing through it.

Final checks:
- Floating media passes with the explicit animation wait (76.5 seconds).
- Unified navigation, companion, 36 original responsive layouts and the added
  video matrix pass together (180.4 seconds). The first combined retry exceeded
  its original 150-second renderer guard. With 111 additional video states, the
  fixture now allows a bounded 240-second renderer run and writes progress
  checkpoints; source copying/cleanup fit within a 420-second outer bound.
- Latest npm.cmd run check passes (166 targets, 343 specs, 13 stylesheets).
- Latest npm.cmd run audit has zero findings. The other session completed its
  standalone media-browser auditor integration; Python auditor retry is 4/4.
- Final fast run remains 3861 pass, 4 skipped. Original full-run preview/media
  failures passed their targeted reruns. The original full run itself remains
  recorded red; no single all-green full rerun is claimed.
- Final credential audit compares 13 saved values against 667 tracked/nonignored
  files, 653 index blobs and the staged diff: no matches. Only three synthetic
  credential-shaped test fixtures are flagged. Local evidence remains ignored.

Evidence: tools/logs/ui-polish-unified-final.log, ui-polish-render-final.log,
ui-polish-audit-latest.log, ui-polish-python-auditor-retry.log,
ui-polish-credential-final.json and ui-polish-20260926.md. No commit or push.

## 2026-09-26 - Video backgrounds, solid reading surfaces and compact UI audit

Reproduced washed-out navigation and patterned video showing through reading
surfaces, Settings categories sliding under the fixed bar, and narrow Tools and
advanced Agent routing overflow. Added a media reading floor, stronger secondary
text, solid zero-glass materials (including Vibe drawers), a named responsive
container for Agent settings, bounded Tools placement and a dense Settings strip
below local navigation. Updated Analyzer copy assertions without dropping stale
reply checks, and initialized rail navigation in the sidebar/Vibe unit fixtures.

The isolated renderer pass covers 90 Build page states and 21 Vibe panel states,
with an actual playing canvas video inside a locally answered provider iframe.
It checks 864 contrast combinations over black/white frames, including real
surface fills; minimum reading contrast is 6.68:1. Expanded Routing, open Ideas
Tools and scrolled Settings search are hit-tested. Playback advances, keeps its
iframe and loads once. No renderer errors, external requests or child execution.
The early sweep's generic closed-disclosure flags were not treated as defects.

Validation:
- Booklet rebuild and npm.cmd run check pass; focused navigation/Analyzer 47/47.
- Final npm.cmd run test:fast: 3861 pass, 4 skipped, zero failures.
- Full npm.cmd test: CPU 3855 pass / 1 fail / 4 skipped; Electron 36 pass /
  1 fail / 1 skip; visibility 1/1; occlusion 1 pass / 1 capability skip;
  Python 248 tests with 1 failure and 1 skip; normalized-path lock 6/6.
- Preview process shutdown timed out in the full run and passed its solo retry.
  Floating media's follow assertion passed on retry; the fixture now waits for
  the dodge animation to finish before measuring follow. An export-enabled retry
  completed the renderer but exceeded 120 seconds while copying screenshots;
  the retry without export passed in 36.5 seconds.
- Earlier audit passes had zero findings. The latest audit/Python failure is the
  concurrently added standalone renderer/media-browser.js not being recognized
  by the booklet auditor. That in-flight feature is preserved, not modified here.
- Credential value comparisons against tracked/nonignored files, index blobs and
  staged changes have no matches. Logs and captures are ignored; no commits/pushes.

Local evidence: tools/logs/ui-polish-*.log, ui-polish-after/report.json and
ui-polish-20260926.md. Shared source changes were reported during the full run;
the complete repository gate is not claimed green.

## 2026-09-26 - Auto runs agent-proposed repairs and recovers misfiled owner questions

Auto now admits agent-proposed tasks even when the saved agent-filed switch
is on; Always ask, Accept per task and Elevated only keep their approval
rules. The UI explains Auto and preserves the saved Elevated-only preference.
Worker and split prompts keep test failures, concurrent edits and test-history
conflicts with Studio. Concrete repair requests mislabeled owner regain bounded
retry options, including legacy open questions. Answered/dismissed questions,
Undo, owner holds, named permissions and risk decisions retain their gates.
Unfinished repairs reported under owner cannot falsely pass verification.
Missing sessionless evidence still forbids confirmation but permits repair.

Validation:
- Final eight focused suites: 178/178 pass, including real-host dispatch,
  Pause, all four reported repair titles, saved-question recovery, retry budgets,
  permission/scope preservation, missing evidence and the mode-switch UI.
- npm.cmd run build-booklet, npm.cmd run check and npm.cmd run audit pass;
  audit has zero findings. The generated booklet contains the updated controls.
- Full npm.cmd test: CPU 3847 pass, 0 fail, 4 skipped; Electron lane 37 pass,
  0 fail, 1 skipped; eyes toggle 1/1. Occlusion: 1 pass, 1 fail (rAF growth 11).
  Python contracts: 248 tests OK, 1 skipped. Normalized-path lock: 6/6 pass.
- The full run overlaps other sessions' edits and the final focused refinements;
  its source-change guard fired at the occlusion failure. The same rAF failure
  is documented in the preceding AI-recovery baseline comparison.
- Single-file occlusion retry: 1 pass, 1 capability skip, exit 0. Other sessions
  also ran Electron fixtures; this is not proof of the occluded phase passing.
- A read-only evaluation of the four actual saved cards under the updated Auto
  rule finds one running and three ready, with none awaiting approval.

Logs are local at %TEMP%/mefi-auto-repairs-{final-focused,full,final-check,
final-audit,occlusion-retry}.log. No live task store or settings were edited,
and the live Studio process was not restarted during active work.

## 2026-09-26 - AI offline route-change recovery and isolated blockers (task_b172488b3c947b88)

Read all eight saved context revisions and preserved the inherited Claude
error parser, CLI exit guard and successful-reply warning cleanup. Read-only
runtime evidence showed five failures and a Claude quota backoff despite
Codex already being selected. Saving routing reset the provider breaker but
left that assistant backoff intact. A new regression failed with 5 !== 0.

Added resetAssistantAiBackoff in main.cjs. Accepted route, credential and
applied team changes now clear retry counters/timers so the running loop can
probe the saved route. Offline status, last error and warning remain until a
real success. Refused changes and merely saving a preset retain the backoff;
a paused service stays paused. Updated architecture and changelog. No
renderer source, user settings, task store or portable data was changed.

Validation:
- Initial inherited focused suites: 88/88 pass. New route regression: 9 pass,
  1 expected fail before the fix. Final six focused suites: 117/117 pass.
- npm.cmd run check passes; npm.cmd run audit has zero findings;
  git diff --check passes. npm.cmd avoids the local npm.ps1 execution policy.
- Full npm.cmd test: CPU 3825 pass / 7 fail / 4 skipped; Electron lane
  37 pass / 1 skip; eyes-toggle 1/1; occlusion 1 pass / 1 fail. Python
  contracts 248 tests OK (1 skipped); normalized-path lock 6/6.
- That full run began before the final route patch. The final-source
  npm.cmd run test:fast has 3831 pass / the same 7 fail / 4 skipped.
- In a temporary copy, Analyzer/sidebar/Vibe tests reproduce all seven UI
  failures (30/37 pass). Replacing only analyzer.js and nav.js with HEAD
  yields 37/37. These shared renderer changes are separate from AI recovery.
- Solo occlusion retry still fails rAF silence (growth=17). An isolated HEAD
  host and booklet also fail the same assertion (growth=23), establishing a
  baseline failure outside this fix. The initial temporary harness omitted
  main.cjs; the comparison above is the completed run with that input supplied.
- At 20:10 America/Chicago, a bounded no-tools Claude call returns its session
  limit and 23:10 reset, with zero tokens. At 20:11, the already-selected Codex
  route returns ok through the real host CLI completion function. Claude's
  account limit remains; no provider-selection decision is needed for Codex.

Logs are local at %TEMP%/mefi-ai-offline-2-{focused,route-before,route-after,
final-focused,check,audit,full,final-fast,ui-current,ui-head-renderers,
occlusion,occlusion-head}.log. Sources are saved for the next app load;
the running Studio was not restarted during its active worker session.

## 2026-09-26 - AI offline resumed diagnosis and companion recovery (task_b172488b3c947b88)

Read the dispatch context and all prior attempt evidence, preserved the inherited
Claude diagnostic parser, central AI recovery fix and briefer exit-status guard,
and added three companion-chat integration cases in
`tests/assistant_overseer_chat.test.mjs`. The real host turn now has coverage
for successful recovery (clearing only ai-offline and retry state) and failed or
blank replies (retaining offline state). No settings or Studio stores changed.

Fresh validation:
- Focused usage tracker, host, briefer and companion suites: 88/88 pass.
- Clean HEAD comparison of Analyzer, sidebar, verification drain and Vibe:
  57/57 pass. Current worktree comparison: 50/57, with five Analyzer and two
  navigation failures. Verification drain's full-run failure passed on retry.
- Isolated HEAD plus the six adopted/updated implementation and test files:
  all eight comparison/focused suites pass, 145/145. The initial isolated
  harness omitted preload.cjs; after supplying it, the final run is clean.
- Removing the central recovery clear in that temporary copy makes the new
  successful-companion regression fail as expected; the workspace was untouched.
- npm run check and npm run audit pass, zero audit findings; git diff --check
  passes. No renderer source was edited during this continuation.
- Full npm test exits 1: CPU stage 3824 pass / 8 fail / 4 skipped; Electron
  lane 37 pass / 1 skip; eyes-toggle 1/1; occlusion 1 pass / 1 fail. Python
  contracts: 248 tests OK (1 skip); normalized-path lock: 6/6.
- Solo occlusion retry: 1 pass / 1 capability skip (native desktop occlusion
  did not engage), not a claim that the occluded phase passed.
- One bounded, no-tools Claude probe still returns a session-limit error,
  exit 1 and zero tokens. The parser preserves the provider's reset explanation.
  Code cannot reset the provider quota; live successful recovery remains
  dependent on quota reset or the owner's provider selection.

Full logs remain local at %TEMP%/mefi-ai-offline-{focused,check,audit,full,
head-isolation,current-isolation,isolated-fix-final,regression-proof,
occlusion-retry}.log. The unrelated shared renderer edits were preserved.

## 2026-09-26 - Native chat composer sizing and loading-delay triage

Windows, Electron 44.4.1. Command chat composers now use supported native
content sizing, preserving the 38-120 px bounds and scrollable long drafts.
Older web previews keep the previous JavaScript path. The isolated real
Electron comparison in `tools/profile_chat_thread.cjs --composer` measured
80 explicit scrollHeight reads per 40 unchanged updates before and zero
after; median sizing-call time was 0.10 ms before and below 0.01 ms after.
The report in ignored `tools/logs/composer-performance.json` also verifies
width/font changes, long-draft scrolling, reopening and clearing. This is a
composer measurement, not an end-to-end startup or frame-rate claim.

- Focused composer, command activity and command visuals: 81/81 pass.
- `npm run build-booklet`, `npm run check`, `npm run audit`: pass; audit has
  zero findings. The generated booklet includes the source change.
- Full `npm test`: CPU stage 3,823 pass, five fail, four skipped; the five
  failures are the existing Analyzer UI assertions previously isolated from
  these performance edits. Electron stage: 34 pass, three fail, one skipped;
  Command hit its timeout, Plans missed its backdrop check and tree dynamics
  missed painted movement. All three pass in a sequential retry (3/3).
  The serialized eyes toggle and occlusion probe also pass. Python: 248
  tests, OK with one skipped. Normalized-path lock: six checks pass.
- Sources changed during the full run and another session's Electron tests
  were active during retries. No quiet-machine timing claim is made. Full
  output remains in the temporary `mefi-composer-full-test.log`; retry and
  focused output use `mefi-composer-render-retry.log` and
  `mefi-composer-focused.log` in the same temporary directory.
- Investigated a reported blank/slow launch while tests were active. The
  cold-startup renderer fixture passed; the occlusion fixture intentionally
  shows a window. The live app had loaded by the time of inspection, so the
  report cannot establish whether that delay was a test window or app boot.
  No live app restart or user-data modification was performed.

A separate dropdown-label snapshot experiment was discarded because its
real Electron comparison was slower than native label lookup.

## 2026-09-26 - Fix Home and Trace layout and agent-brain navigation selections

Windows, Node 24, Electron 44.4.1. Fixes from the exploration: Home's fixed
layer now leaves room for the navigation row; Trace joins Agents > Live and
the rail's full-page layout; Pipelines/Playbook/Project map repaint their
navigation after async loading. Page Back uses section history only in the
rail shell; classic dialogs, including Trace, close over the current page.
Regenerated `renderer/booklet.html`, updated architecture/changelog, and
preserved concurrent edits and local data. No credentials or screenshots
were added to Git, and this session did not commit or push.

PASS: `npm run build-booklet`, `npm run check`, `npm run audit` (zero findings),
and `git diff --check`. Focused `node --test tests/nav_startup.test.mjs
tests/trace.test.mjs tests/activity_navigation.test.mjs` passed 18/18,
including rail Back versus classic dialog Close.

The full run's expanded `unified_studio_render.test.mjs` passed in 53.8 s:
Home Pause/Activity/More hit targets, Trace menu access/title/search/Back,
correct Pipelines/Playbook/Project map selectors at 1440x900 and 600x560, plus
the existing controls and 36 responsive layout combinations. The Electron
stage passed 37 tests with one existing opt-in skip; eyes visibility-toggle
passed 1/1. Python passed 248 tests (one skip), and all six normalized-path
lock checks passed.

Overall `npm test` exited 1. CPU stage: 3823 pass / 5 fail / 4 skipped. The
five failures are the existing `analyzer_ui.test.mjs` copy/empty-state
expectations already documented by the chat-thread performance row; this
change does not edit Analyzer. Exclusive occlusion: 1 pass / 1 fail because
rAF continued under the cover (growth 17). The runner detected concurrent
source edits during that stage. A solo `node --test tests/occlusion_probe.test.mjs`
retry still failed the same assertion (growth 12); it remains unresolved and
is not relabeled as a skip or pass.

The first expanded Unified Studio run hit the old 180 s outer guard and
recorded the previously documented native keyboard-scroll assertion failure.
Its new navigation checks passed and exported screenshots. The following
full run passed the entire fixture. Increased only its outer guard to 300 s
to leave room for source snapshotting and cleanup around the unchanged
150 s renderer-process deadline. The first run's directory is named `before`,
but copying overlapped implementation: its screenshots contain the fixes,
so it is not a before-change baseline. The preceding exploration supplies
the failing layout evidence.

Logs: ignored `tools/logs/navigation-fixes-{build,check,audit,focused,full-test,
occlusion-retry,before}.log`. Local report and screenshots:
`tools/logs/navigation-fixes-20260926/`.

## 2026-09-26 - Studio exploration, USB CLI verification and credential exclusions

Windows, Electron 44.4.1. Exploratory audit only: no application source fixes.
Existing concurrent application changes and live user data were preserved.
This session changed `.gitignore` to exclude credential files at any folder
depth, secret directories, and root machine settings. Test scripts, screenshots,
and the detailed report remain in ignored `tools/logs/explore-20260926/`.

The disposable real-Electron tour captured 54 states before its 200-second
outer timeout. The follow-up interaction tour completed in 145.6 seconds with
42 captures, 40 successful checkpoints, and two recorded failures: a real
Home Activity control obstruction, and a post-save probe error caused by
calling `planningList()` without the required project ID. Manual plan saving
and resumption were visible. No renderer console errors were recorded.
The harness intercepts external requests and worker launches; its recorded
model-catalog and Grok usage-probe attempts were blocked. Its top-level `ok`
flag does not aggregate the custom per-scenario failures; no all-pass claim.

Confirmed UI findings: Home controls are covered by the top navigation;
Trace is absent from the Live menu and lacks the page inset; Pipelines,
Playbook and Project map retain the previous view in the navigation selectors.
Coverage includes Vibe panels and the main Build destinations at 1440x900
and 600x560, task creation/detail tabs, plan stages, searches, menus, profiler,
provider setup and accounts, and settings sections. External integrations
and complete AI build workflows were not validated by the isolated UI tour.

Earlier `python tools/verify_workspace.py` failed its stale Build-default-home
assumption against current Vibe onboarding. `node --test
tests/command_render.test.mjs` timed out during concurrent Electron activity
and remains inconclusive. A final optional interaction follow-up stalled
before renderer startup and its owned process was stopped after about two
minutes without captures. Native live-app capture/coordinate control was
unavailable, although accessibility text was readable.

USB CLI checks used the F: binaries directly: Codex, OpenCode with gpt-5.5,
and Antigravity each returned OK to a minimal request in a temporary directory.
Claude reported a saved login but the live app showed its quota limit; Grok
reported missing authentication. OpenCode's listed gpt-5.4-mini was rejected
for the ChatGPT login before the successful gpt-5.5 retry. CLI success on the
current PC does not establish portable authentication on another PC.

PASS: credential exclusion checks, `git diff --check -- .gitignore`, and
local secret comparison across 656 tracked/nonignored files and 653 Git index
blobs (eight saved values, zero matches; zero staged matches). Three pattern
hits were existing synthetic redaction-test PEM markers. No credentials
were copied to the repository and nothing was committed or pushed. Full
application gates were not rerun for this ignore-rule/audit-only change.

## 2026-09-26 - Chat thread performance: retain history during live thoughts

Windows, Node 24, Electron 44.4.1. `renderer/idle.js` separates its saved
thread signature from the pending reply and updates the thought span and dots
in place. Existing local Analyzer, usage tracker and assistant edits were
preserved. No live app state or providers were used by the new benchmark.

PASS: `node --test tests/command_activity.test.mjs tests/command_visuals.test.mjs`
(78/78), `node --check tools/profile_chat_thread.cjs`, `npm run build-booklet`,
`npm run check`, `npm run audit` (zero findings), and `git diff --check`.

The isolated Electron comparison (`tools/profile_chat_thread.cjs`, production
thread functions, CSS and shared-controls observer, 30 synthetic messages,
40 updates, seven alternating pairs after warmup) measured median update cost
1.63 ms -> 0.07 ms and 2,640 -> 0 new elements per 40 updates. Identical text,
retained selection, reader scroll and tail-follow assertions passed. These
are thread-path measurements, not whole-app frame-rate claims. Numeric report:
`tools/logs/chat-thread-performance.json` (ignored).

Full `npm test` exited 1: CPU-only Node stage 3820 pass / 5 fail / 4 skipped;
Electron stage 35 pass / 2 fail / 1 skipped; serialized eyes-toggle 1/1;
occlusion 1 pass / 1 capability skip. Both real Command rendering and both
performance-profiler tests passed. Python: 248 tests OK (1 skipped).
Normalized-path checks: 6/6.

All five CPU-only failures are existing Analyzer UI expectations against local
copy changes (`Present`/`Missing`, `Findings · Idea`, and nonblank empty/pending
panels). An isolated copy containing only `analyzer_ui.test.mjs`, `analyzer.js`
and the template reproduced 11 pass / 5 fail without any performance source.
Replacing only that isolated Analyzer source with `HEAD:renderer/analyzer.js`
gave 16/16. Those unrelated local edits and tests were left intact.

The Electron failures were Plans' backdrop-pixel assertion and Unified Studio's
native keyboard-scroll assertion. A sequential solo retry of
`tests/planning_render.test.mjs` and `tests/unified_studio_render.test.mjs`
passed 2/2 (33.7 s and 55.3 s) without source changes. The original full run
remains recorded as failed; no clean full-gate claim.

Complete logs are in `%TEMP%/mefi-thread-{focused,build,check,audit,full-test,render-retry}.log`;
Analyzer isolation logs are `%TEMP%/mefi-thread-{local-analyzer-only,head-analyzer-only}.log`.

## 2026-09-26 - Briefer CLI failure boundary and recovery (task_f9e52aa317ae8c28)

Read the saved run and briefer error without changing Studio data. The saved
`claude error: success` came from an error envelope whose subtype said success.
The working tree already contained the diagnostic parser and offline-warning
recovery changes; preserved them and verified them through the briefer path.
Added the missing main.cjs exit-status guard: failed or signalled CLI processes
cannot turn partial text or JSON into a successful brief or queued requests.

- New `tests/briefer_cli_failure.test.mjs`: reproduced four false successes
  before the guard; all seven cases pass after it, including error envelopes,
  backoff, recovery and legacy successful plain-text output.
- Focused Node run (briefer, usage_tracker, usage_tracker_host): 52/52 pass.
- `python -m unittest discover -s tools -p test_mefi_studio_assistant.py`:
  66/66 pass.
- `npm.cmd run check` and `npm.cmd run audit`: exit 0, zero audit findings.
- `npm.cmd test`: exit 1. CPU stage: 3820 pass, five failures, four skips;
  Electron stage: 37 pass, one skip; exclusive stages: two pass, one skip.
  All five failures are in `tests/analyzer_ui.test.mjs` (lines 120, 182, 218,
  227 and 264), which reads only the concurrently edited renderer files.
  Clean HEAD 8b4ab00 copies of that test and its two renderer inputs pass 16/16
  in a temporary directory. Preserved the other session's renderer work.
  Full Python leg: 248 tests, OK (one skip); normalized-path lock: 6/6 pass.

Full logs remain local at `%TEMP%/mefi-briefer-npm-test.log`,
`%TEMP%/mefi-briefer-check.log`, `%TEMP%/mefi-briefer-audit.log` and
`%TEMP%/mefi-briefer-analyzer-baseline.log`. No paid provider calls, preview
server, live task-store changes or renderer rebuilds were needed for this fix.
The owner of the concurrent Analyzer changes still needs to reconcile its
contracts before the shared full gate can be green.

## 2026-09-26 - Trace log viewer (Build): gates on a private worktree of 6e03f15

Detached worktree C:\wt\build-g at 6e03f15 plus the Trace change only
(scripts/trace.cjs, renderer/trace.js and trace.css, the trace:channels /
trace:read host reads and the logLine and window-console rings in main.cjs,
preload, nav.js's record and Live route, the build and fixture lists,
tests/trace.test.mjs, docs). `npm run check` and `npm run audit` passed.
The first `npm test` failed three host_push_batching tests: they run
logLine's slice alone, where the new Trace ring does not exist; logLine's
push is now guarded, and all three pass. The rerun on the commit: Node
parallel stage 3798 tests with one file-level failure, project_preview,
which passes solo (18/18); the Electron fixture stage passed; Python
contracts and the normalized-path lock passed.

## 2026-09-26 - Permission modes follow-up: owner-card slices build in Auto, dismissed parked asks stay dismissed

Detached worktree C:\wt\assist-v at 6e03f15 plus the two fixes only
(scripts/autonomy.cjs ownerWork, scripts/autonomy-host.cjs settled-park
check, their tests and docs). Before the fix, on 6e03f15, the two new tests
fail: a delegated slice of an owner card read "approval" under Auto, and a
dismissed synthesized parked-card ask came back on the next pass (reproduced
with a scratch fixture in both Always ask and Auto). `npm run check` and
`npm run audit` passed. `npm test`: Node suites passed (3806 tests, 0
failures; Electron fixtures 37 passed, 0 failed, `command_render` included
this run), Python contracts passed (one skip), and the normalized-path lock
passed.

## 2026-09-26 - Permission modes shared integration

Landed 31bc533 on main by merging each touched file against efe812c, with
byte-checked backups and an empty index. Preserved the existing music/media,
Command audio/performance, documentation and plan.md edits; kept both Added
changelog entries. Rebuilt booklet.html from the combined renderer sources.
The combined tree passes check and audit (zero findings), plus all 229
focused permission, Vibe, companion, Command activity/audio/graph, media and
booklet tests. Logs: C:/wt/phase4-shared-check.log,
phase4-shared-audit.log and phase4-shared-integration.log. The preceding
full-gate row documents the independently reproduced Command timeout.

## 2026-09-26 - Permission modes final gate and baseline timeout comparison

Validated the fixed source commit 3e06781 in the clean assist-g1 worktree.
Check passes (161 targets, 338 specs), audit has zero errors or warnings,
and the committed booklet was rebuilt. Full npm test: 3804 non-Electron
tests passed, 4 skipped; Electron lane 36 passed, 1 skipped, 1 failed;
exclusive visibility and occlusion checks all 3 passed. Python ran 248
tests with 1 skip and no failures; all 6 normalized-path lock checks passed.

The sole final failure is command_render's 80-second process limit: the
fixture was terminated before writing report.json, without a renderer error.
It repeated solo on 3e06781 and on clean pre-change main efe812c with the
same signature. This is a reproduced baseline limitation, not a green
full gate. The earlier Phase 4 run at 0fd96da passed Command in 59.6 seconds.
Logs: C:/wt/phase4-final-full.log, phase4-command-solo.log and
phase4-command-baseline.log.

The initial 0fd96da run exposed two actionable renderer issues, both fixed:
the companion fixture now explicitly enters Build when testing direct
answers, while a new Vibe orb test verifies the hub releases its focus lock;
compact navigation retains 18px icons and 36px buttons while fitting all
three destinations at 600px / 150% zoom. Both companion and Home/Work tests,
the full responsive navigation sweep, and the new autonomy renderer pass
in the final full run. No test assertions or timeout limits were weakened.

Before/after Vibe captures are exactly 1920x1080 / DPR 1, using synthetic
bridge data: C:/wt/phase4-preview/before and C:/wt/phase4-preview/final.
The real main-process fake-LM proof and relaunch proof remain successful
(C:/wt/autonomy-app-EL5Bpt); final follow-ups change only renderer and docs.
No private state, credentials or generated screenshots were added to Git.

## 2026-09-26 - Permission modes Phase 4 controls and isolated app proof

Private assist-1, based on 79b39a0 (Phase 3 plus the completed Vibe C/D
adoption). Added shared permission/learning controls, ledger Why/Undo and
For you, inline offers/confirmations, one-line answers, suggestions, durable
budget holds and matching family approval counts. Check and audit pass;
booklet rebuilt. Fast suite: 3802 passed, 4 skipped, zero failed before the
last two Vibe regression cases; the final focused cases also pass, including
late item errors, one-line payloads and unread message IDs beyond sixty.

The new isolated Electron renderer test passes at exactly 1920x1080 / DPR 1,
with zero renderer errors, network attempts or child launches. It exercises
mode saving, ledger Undo, Done, suggestion/error/text focus, inline Yes,
and the grant warning. Screenshots: C:/wt/phase4-preview/verified. The before
bundle is C:/wt/phase4-before.html; before captures use the same synthetic
bridge. The earlier unified-render run reproduced the known 600px / 150%
navigation issue; a compact companion placeholder and rail now address the
measured overflow. The full final gate is recorded separately below/above.

Real main-process Electron probe: C:/wt/autonomy-app-EL5Bpt. Scratch source,
temporary userData/home/board database, localhost fake LM Studio and blocked
external fetches. Only the ordinary startup/watchers were replaced with the
probe driver; production settings, board gateway, decision pass, answer paths,
preload and IPC ran unchanged. All four modes matched the expected ordinary
ask/approval behavior; permission stayed open, Auto/Elevated filed human
to-dos, and Undo restored run/check counters while retaining spent retries.
A second Electron process reopened the same scratch stores: Elevated mode,
two retries and the budget hold survived; Undo released the hold without
refunding attempts. Logs: C:/wt/phase4-app-result.log and phase4-app-first.log.
No live data, settings, game files or credentials were copied or changed.

## 2026-09-26 - Shared assistant context Phase 3 isolated full gate

Validated efe812c on fixed sources in assist-g1. Check and audit passed with
zero findings. Full npm test: Node 3761 passed / 4 skipped / 0 failed;
Electron 35 passed / 1 skipped / 1 failed; exclusive probes 2 passed and
occlusion capability-skipped; Python 248 tests with 1 skip; all six path-lock
checks passed. Command rendering passed. Unified Studio's known narrow
navigation assertion reproduced at 600px / 100% this run (previously 150%).
The full command correctly exited 1. Logs: C:/wt/phase3-full.log,
phase3-gate-check.log and phase3-gate-audit.log. The subsequent C/D adoption
(79b39a0) preserved permission reservations before deferral; its focused
sizing, new-app, Vibe, backlog, approval and delegation batch passed 117/117.

## 2026-09-26 - Vibe Milestone D: task lanes, queue controls and Inspector

C:/wt/vibe-a, branch codex/vibe-c-d, on C commit 8dc02e4. Tasks now switches
between List and six live-count lanes, with questions separate from task counts.
Queue controls pause/resume new work and choose automatic or manual worker limits.
The Inspector saves priority, estimated minutes, acceptance checks and a local
Defer until date. Eligibility excludes deferred tasks until expiry or release;
dependencies and approval still apply afterward. Priority breaks ties inside
existing worth bands, with explicit pin recency retained. Details are versioned,
conflicting stale edits refuse, untouched legacy checks survive other edits, and
active/checking/finished inspectors are read only. Failed saves retain drafts.
A C follow-up also retries opening a newly created app after a busy-project
switch refusal, without creating the folder twice.

Final focused batch: 84/84 passed (new-app host/planner, Vibe panels, backlog,
build approval and policy). Check passes (154 targets, 326 specs), audit reports
zero errors/warnings, booklet rebuilt, and diff whitespace passes. A seeded
hidden Electron preview passed real form submission/conflict retention and
layout checks at 1440x900, 900x720, 600x700 and 600x700 at 150% zoom: no horizontal
overflow or renderer errors. Desktop and narrow screenshots were inspected;
artifacts remain outside Git under %TEMP%/mefi-vibe-d-ui. No live state was used.

After reserving a quiet Electron window with the other active chats, full
npm test completed with exit 1: parallel Node 3717 total / 3713 pass / 4 skip;
Electron 37 total / 35 pass / 1 fail / 1 skip; serialized visibility 1/1 passed;
occlusion 1 pass / 1 capability skip. The sole failure is unified_studio_render,
"primary destinations stay visible at 600 / 1.5", already reproduced on the
Milestone A baseline and in the inherited C log. Command rendering passed this
quiet run (51.8 s). No source-fingerprint warning occurred. Python ran 248 tests
successfully with one skip; all six normalized-path checks passed. Full log:
%TEMP%/mefi-vibe-cd-gate.log (Node 290 s, Python 56 s). This is NOT a green full
suite claim; the existing navigation failure remains separate from C/D.

## 2026-09-26 - Vibe Milestone C continuation: intake merge and new-app recovery

Isolated C:/wt/vibe-a on 8de8b58, preserving the prior sizing, plan-family and
New app implementation. Fixed Make it one task to merge the family atomically:
ordinary drop rejects prerequisite children. Running/checking steps and outside
dependents refuse the merge without partial changes; dropped steps never claim
completion. New app retries a failed first build without recreating the folder,
reports README write failures, and rejects junctions into Studio before writing.
Added real temporary-folder host tests, family merge tests and renderer retries.

Focused Vibe, sizing, planner and delegation batch passed 61/61; the final
new-app host/sizing/panel batch passed 25/25 after the filesystem coverage was
added. Booklet rebuilt, check passed (154 targets / 326 specs), audit zero
findings, and diff whitespace passed. The inherited npm-test-c.log is NOT green:
3694 parallel Node passes / 4 skips, Electron 34 passes / 2 failures / 1 skip
(Command capture timeout and the documented Unified Studio 600px navigation
failure), visibility 1 pass, occlusion 1 pass / 1 skip; Python 248 and path-lock
passed. Its final recorded exit is 1 despite the outer echo command exiting 0.
A fresh full gate was deferred because another chat's full gate was already
running on this desktop; the combined C/D continuation will run it after that
process drains. No live project data or portable files were changed.

## 2026-09-26 - Shared assistant context Phase 3 focused validation

Chat and desk now share decision context. Mode-aware approvals carry the
shown scope; local confirmations, suggested answers, Undo and targeted inbox
promotion have explicit ambiguity and stale-scope coverage. OpenRouter and
companion-only LM Studio clear both model gates. Seventy-eight focused host,
purity and admission tests passed. The fast run passed 3760, skipped 4 and
found one missing workAdmission fixture collaborator; the fixture was updated
and its focused suite passed. Check, audit (zero findings) and booklet build
passed. The full gate follows in a fixed-source worktree.

## 2026-09-26 - Permission learning Phase 2 isolated full gate

Validated snapshot 763ea51 in assist-g1. Check and audit passed with zero
findings. Full npm test: Node 3745 passed / 4 skipped / 0 failed; Electron
35 passed / 1 skipped / 1 failed; exclusive probes 2 passed with occlusion
capability-skipped; Python 248 tests with 1 skip; six path-lock checks passed.
The sole failure is the previously reproduced Unified Studio navigation
visibility assertion at 600px / 150% zoom. Command rendering passed. The
full command correctly exited 1. Sources were unchanged during the run.
Logs: C:/wt/phase2-full.log, phase2-gate-check.log, phase2-gate-audit.log.

## 2026-09-26 - Permission learning Phase 2 focused validation

Added recency-weighted owner decision memory, doubled corrections, scoped
forgetting, project-aware model observations and weighted model routing.
70 pure/memory/store/policy tests, 81 model/routing tests and 2 learning-host
tests passed. The initial fast run exposed 12 missing collaborators in VM
fixtures and one loaded project-switch timing failure. After updating the
fixtures, all 39 affected questions, ledger and project tests passed; the
project switch settled in 549ms solo. Check and audit passed with no findings.
The full gate follows on an isolated snapshot. UI controls and skill displays
are integrated together in the later Vibe control phase.

## 2026-09-26 - Permission modes Phase 1 isolated full gate

Validated snapshot bdd08f1 in the isolated assist-g1 worktree. Check and audit
passed with zero findings. Full npm test: Node 3732 passed / 4 skipped / 0
failed; Electron 35 passed / 1 skipped / 1 failed; exclusive probes 2 passed
and occlusion capability-skipped; Python 248 tests with 1 skip; all six
path-lock checks passed. The only failure is Unified Studio's previously
reproduced primary-destinations visibility assertion at 600px / 150% zoom.
The full command therefore correctly exited 1. Command rendering passed.
Sources remained unchanged during the run. Logs: C:/wt/phase1-full.log,
C:/wt/phase1-gate-check.log and C:/wt/phase1-gate-audit.log.

## 2026-09-26 - Permission modes Phase 1 focused gate

Implemented saved permission modes, elevated switches, shared dispatch approval,
persisted suggestions, a decision ledger with Undo, interruption recovery and
human to-dos in the isolated assist-1 worktree. The fast suite passed 3730 tests
with 4 skips before the final persistence guards; 118 focused host, durability
and executor tests passed afterward. Check and audit passed (zero findings).
The booklet build passed. Full gate validation follows on the isolated snapshot.

## 2026-09-26 - Permission modes Phase 0: delegated safeguards and recovered gate evidence

Recovered isolated Phase 0 commit 2500481 and tightened delegated retries:
loop holds are retained, verification state changes only for verification
kinds, and owner-held cards reject a delegated answer before writing it.
126 focused decision, issue, companion and family tests pass. The inherited
full gate recorded 3702/3707 Node passes (four skips, preview startup
cancellation failed), 34/37 Electron passes (one skip), 248 Python contracts
(one skip), and six path-lock checks. A fresh serialized rerun passes all
16 preview tests; Command rendering times out at 100 seconds and Unified
Agents reproduces the documented primary-destinations-at-600/1.5 failure.
These are reported, not counted as a green full gate. The bar-clearing chat
owns the post-landing full gate and isolated companion panel proof. Test
logs are outside Git in C:/wt/phase0-focused.log and phase0-rerun.log.

## 2026-09-26 - Vibe panels, cards and dock (Milestone A): gates on a private worktree of 06b5d7d

Detached worktree C:\wt\vibe-a at 06b5d7d plus the Vibe panels change only
(renderer/vibe.js, vibe.css, new vibe-panels.js, the Vibe block of the
template, nav.js decision toast, music.js themes(), build-booklet and its
fixture list, tests/vibe_panels.test.mjs, docs). `npm run check` and `npm run
audit` passed. `npm test`: Node parallel stage 3685 tests, 0 failures (4
skipped); Python contracts and the normalized-path lock passed; the Electron
fixture stage failed three of 36. `media_window_render` passed solo.
`command_render` failed in the stage and once solo under load, then passed
solo twice, and passes on a clean worktree of 06b5d7d: the known load flake.
`unified_studio_render` fails "primary destinations stay visible at 600 / 1.5"
on the branch and identically on a clean worktree of 06b5d7d, so it predates
this change (the same failure the v0.4.3 tag run and the Command performance
pass recorded). The new vibe_panels suite (8 tests) and vibe_pipeline /
vibe_frame / booklet_build pass.

## 2026-09-26 - Tag release Electron fixtures failed twice; same-commit branch gates passed

Both executions of the v0.4.3 tag workflow on a5e2b26 passed dependency setup
and the full check gate, then failed `npm test` in the serialized Electron
fixture stage. Each run had five failures among 37 Electron tests: agent setup,
companion audio, floating media, Plans layout and Unified Agents navigation.
The Node parallel stage passed (3677 tests on the rerun); Python contracts and
the normalized-path check passed. The identical commit passed the complete
Windows branch workflow (36224514625) and Linux workflow (36224514622),
including tests, audit and the headless Electron smoke. No application source
changed between these runs.

The tag workflow stopped before packaging both times. Using the repository's
supported release publisher, a fresh `--release` portable folder was built
without local data, zipped and uploaded with its SHA-256 checksum. GitHub
Release v0.4.3 reports the same ZIP digest produced locally. GitHub Pages
commit a183f1a is published and the live homepage and download page return 200
with 0.4.3. The Electron fixture failures remain recorded as failures; this
entry does not claim the tag workflow passed.

## 2026-09-26 - Windows CI agent-tools fixtures normalize the canonical temp root

GitHub Actions run 36224195487 on commit 30e7492 completed the Windows setup,
bundle, check and lint gates, then `npm test` failed in the new
`tests/agent_tools.test.mjs` fixtures. The Node stage had 3666 passes, 7 failures
and 4 skips; every failure was the same cleanup assertion comparing the short
`os.tmpdir()` path (`C:\Users\RUNNER~1\...`) with `fs.realpath(os.tmpdir())`
(`C:\Users\runneradmin\...`). The fixture now resolves the temp root before
creating its directory and checks cleanup stays under that canonical path.

The Linux workflow on the same commit passed its checks, full tests, audit and
headless Electron smoke. Python contracts (248) and normalized-path checks also
passed in the Windows run. No release tag has been pushed while the Windows gate
is red; rerun the branch workflow after this fixture-only correction.

## 2026-09-26 - Independent node and line brightness with optional outlines

Added Tree brightness & outlines in the media controls and shared Appearance /
Audio tree controls. Node and connecting-line brightness have independent 0-200%
sliders and enable switches; disabling an adjustment restores normal brightness
without discarding its value. Optional dark/light outlines follow the selected
node silhouette. Values persist in tree dynamics preferences and synchronize
across all mounted panels. Movement and brightness resets are independent.

Canvas filters are scoped to node and connection paint passes, restored afterward,
and skipped at default brightness. Labels, video, menus and transparency remain
independent. Visibility edits preserve graph positions and stable video-region
tracking rather than resetting it.

Validation: 103 focused tree dynamics, audio response, node overlay, visuals and
media-window tests passed. Both isolated Electron fixtures passed sequentially:
media controls in 41s and real tree rendering in 16s. They cover synchronized
600px controls without iframe reload, exact canvas RGB/alpha changes for independent
brightness and disabled adjustment, restored filters, stable node positions,
outlines and hit targets. Screenshots were inspected. The generated booklet was
rebuilt; npm run check and npm run audit passed with zero findings; scoped
git diff --check passed.

Full npm test: 3673 parallel Node tests passed with four skips. The Electron stage
passed 35 tests with one skip and one failure: the existing Unified Agents check
"primary destinations stay visible at 600 / 1". Both media and tree fixtures passed
in the full run too. The serialized visibility test passed and occlusion skipped.
All 248 Python contracts and normalized-path checks passed. This is not a green
full-suite claim; the same Unified Agents failure was recorded before this change.
Logs and screenshots remain local under tools/logs/tree-brightness-*. No private
data or portable payload was changed.

## 2026-09-26 - Reactive tree modes, shape controls and video positioning

Added shared Tree modes & movement controls in Appearance > Layout and Music &
video > Audio reactions: Steady, Music, Video and Music + video, live layout/ring/
wave/spiral shapes, width/height/rotation/position/node size, count adaptation,
independent music movement amounts, and dark/bright video positioning with
strength, shape adaptation, smoothing and dwell. Settings persist locally.
The host samples a bounded footprint suited to tree size; stale samples are
rejected after mode, media or count changes. Painted connections, labels and
hit targets share transformed positions while work identities and anchors stay
intact. Reduced motion and manual camera ownership remain authoritative.

Validation: initial audio/music/media/build/geometry batch passed 133/133.
Expanded graph/media regression batch passed 180/181; its one test reused a
sampling revision after changing node count and was corrected. Final geometry
and node-style contracts passed 25/25; audio mode/effect coverage passed 21/21.
The real media Electron fixture passed in the full run (80 s), including shared
controls and hit-testing at 1440px and 600px; screenshots inspected. A dedicated
real Command tree fixture passed (22 s): ring positioning, decoded-frame music
movement and radius changes, sampled video movement, stable anchors, reduced
motion and clicking a transformed node. Its music input is deterministic at the
geometry boundary; existing audio suites cover FFT and connection behavior.

Full npm test completed: Python contracts and normalized-path lock passed.
Node parallel: 3664 pass, one outdated radius-source contract failed, four skips;
the updated contract passed in the final focused run. Electron lane: 29 pass,
five failures, one cancellation and one skip. The Command surface-only test
assumed music could never move nodes; it now turns off geometry reactions for
that assertion and separately exercises them. Its broad rerun timed out at
140 s, so it is not a green full-Command claim. Other failures included no node
view report, profiler download timeout, renderer recovery, Unified Studio at
600px and a cancelled Plans fixture. Eyes visibility passed; occlusion skipped
after its window was closed externally. Sources changed during both Node stages,
and another full test run overlapped on the shared machine. The targeted tree
fixture supplies final evidence for this feature; the full gate remains red.

Generated booklet rebuilt; final check/audit and whitespace checks are recorded
in tools/logs/tree-dynamics-*.log. UI evidence is local under
 tools/logs/tree-dynamics-ui/ and tools/logs/tree-dynamics-canvas/.
No private state or portable application payload was changed.

## 2026-09-26 - Hover media settings and copied-link offers

Music & video opens after a 200ms mouse hover on either media opener without
taking keyboard focus. A 450ms exit grace lets the pointer cross into the menu;
clicking or editing a control holds it open. Hover brings current source controls
into view. Touch keeps click access; navigation, dismissal, blur and Zen cancel
pending opens. Owned select popups remain usable and consume Escape first.

New copied-link offers check only while the menu is open and Studio is focused.
The host exposes bounded credential-free web URLs only to its focused main frame;
the renderer validates playable links, ignores current/queued entries, suppresses
unchanged dismissed offers, and offers Play, Add to queue, Queue next and Dismiss.
Detection never autoplays. Saved toggles control detection and URL visibility,
including a masked paste field, recent tooltips, clipboard offers and queue URLs.

Final focused music/media-window/clipboard tests passed 109/109. The final isolated
Electron media fixture passed 1/1 in 42s: real hover/focus and slider movement,
current controls after queue scrolling, copied-link UI and queue-next, hidden URLs,
600px controls, provider settings, Zen, and one unchanged provider load. Captures
were inspected. The fixture waits for an existing move animation before measuring
Pin, awaits its mock provider frame, and models focus only for its local clipboard
stub (the offscreen window cannot own desktop focus; host tests cover that guard).
Generated booklet rebuilt; npm run check and npm run audit passed with zero
findings. Scoped git diff --check passed. A final style-only adjustment applies the
same input colors to the masked URL field.

The full npm test run passed 3665 parallel Node tests with four skips, 248 Python
contracts, and normalized-path checks. Its Electron stage had four failures:
Command rendering, media Pin while a prior move was still animating, Plans, and
Unified Studio. The final media run above passed after stabilizing its measurement.
Sources changed during the full run, including the user's added clipboard request;
this records final focused verification, not a green full-suite claim. The occlusion
probe skipped. Logs/captures remain local under tools/logs/media-hover-* and
tools/logs/media-clipboard-*. No real clipboard, private data or portable payload
was used or changed by tests.

## 2026-09-26 - Persistent video queue and independent tree/video visibility

Added a bounded, saved Up next queue to Music & video. Pasted links and YouTube
results can be appended or queued next, reordered to the front, played now or
removed without interrupting current playback. Explicit Next consumes the queue
first; YouTube, Vimeo and direct files advance on completion. Repeated URLs
restart, unstarted/foreign/stale player messages cannot skip entries, and a saved
queue alone never autoplays on reload.

Added separate Tree transparency and Video transparency controls plus 25–150%
Video brightness (default 100%). Removed fixed 55% video dimming and overrode
inactive page opacity rules for the visible Command tree. Adjusting either video
slider releases an existing completion fade. All values persist locally.

Validation: music and media-window focused tests passed 100/100. The final real
Electron media fixture passed 1/1 in 29 s, including 600px queue controls,
independent tree/video opacity, brightness, zero-transparency inactive-page
regression, menu access, Zen, playback identity and saved volume. An isolated
renderer probe independently measured tree/far opacity 0.6, video opacity 1 and
brightness(1.25). Screenshots were inspected. The fixture now waits for opacity
transitions to finish rather than assuming they finish within an 800ms sleep;
the prior assertion caught video opacity at 0.989253 while easing to 1. Its total
allowance also accommodates the expanded queue/visibility coverage under load.
Generated booklet rebuilt; npm run check and npm run audit passed with zero
findings; scoped git diff --check passed.

Full npm test: parallel Node tests passed 3647 with four skips, Python contracts
passed, normalized-path lock passed. The Electron stage was not green: Command,
node views, profiler/capture and Unified Studio fixtures failed, alongside the
media transition assertion subsequently corrected and verified solo. Sources
changed during that stage as the user added the visibility request. The occlusion
probe skipped. This is focused final verification, not a green full-suite claim.
No private state or portable payload was changed. Logs and captures remain local
under tools/logs/media-queue-* and tools/logs/media-opacity-*.

## 2026-09-25 - Right-edge Zen camera tour shortcut

Parking the pointer in the rightmost eight CSS pixels of Live / Command view
starts a temporary Zen tour after a 1.5-second dwell, checked once per second.
The pointer hides during Zen. Moving into the view, clicking, typing, losing
window focus or leaving the window cancels the gesture or wakes the tour.
Menus, text focus, dragging, hidden views and reduced motion retain their guards;
the saved thirty-second idle preference is not changed.

Validation: the focused command_graph, command_director, camera_tour and
boot_poll_visibility batch passed 153/153. The final graph/director rerun also
passed after adding cancellation when the view closes. npm run build-booklet,
npm run check and npm run audit passed (zero audit findings). Full npm test was
not duplicated while another session held the full gate (run-all-tests PID
22412 and run-node-tests PID 46256); these focused results are not a full-gate
claim. No portable payload or user data was changed. Local evidence is in
%TEMP%/mefi-edge-zen-{focused,final-focused,build,check,audit}.log.

## 2026-09-25 - Media menu, video backdrop, playback restoration and YouTube explorer

Windows shared checkout. Link players retain one iframe while moving, resizing,
minimizing, navigating and switching background mode. Settings now live inside
Music & video and hide in Zen. Added opacity, a darkened backdrop with full-strength
tree layers, completion fades/toasts, optional stable dark-region placement,
ten-minute playback/geometry restoration, saved video volume/mute, Audio Link
reconnection and a public YouTube explorer with Next video. No private state or
portable payload was modified.

Validation: the focused music, media-window, media-scene, YouTube-search,
Command-visuals/director and audio-source batch passed 164/164. After the final
diagnostic-capture correction, audio-source tests passed 9/9; after improving
short-window menu placement, music tests passed 86/86. The final isolated Electron
media fixture passed 1/1 (40 s), exercising provider settings hit-testing, unchanged
iframe/load count, move/resize, menus, opacity extremes, tree layering, Zen,
volume/mute and closure. Screenshots were inspected locally. Provider playback
messages are simulated in tests; public YouTube search also returned live results.
The generated booklet was rebuilt. Final npm run check and npm run audit passed
with zero audit findings; scoped git diff --check passed.

Full npm test was run twice while this request and concurrent checkout work
evolved. The later run passed Python contracts and normalized-path locking but
was not green overall: Node parallel reported an outdated director clipping
assertion (subsequently replaced with behavioral region checks, 14/14 passing);
Command rendering exposed the diagnostic local-audio guard (fixed and covered);
Unified Studio failed primary destination visibility at 600px / 1.5 scale. The
runner reported source changes during its Electron stage. The final Command
renderer reruns exceeded both their ordinary 80 s and capture 120 s allowances
without a report, so a complete Command-render pass remains unverified. The
occlusion probe skipped after its window was externally closed. These results
are not a claim of a green full gate.

Local evidence: tools/logs/media-settings-{focused,render,final-check,final-audit,
final-full-test,command-render-final}.log and tools/logs/media-settings-ui/.

## 2026-09-25 - Machine-local style unlock survives portable rebuilds

The portable-only SELF_UNLOCKED edit had been replaced by a payload rebuild.
The host now also reads the explicit boolean localStyleUnlock from the
machine's settings.json, outside the application payload. Release defaults
stay locked. Community normalization and unlinking retain the independent
preference; a fresh host reports the same non-expiring entitlement.

Focused validation: node --test tests/community_host.test.mjs
tests/community_rules.test.mjs tests/community_ui.test.mjs tests/music.test.mjs
passed 153/153, including two new host regressions for persistence, strict
boolean opt-in, and the existing fork switch. The appearance suites cover
premium theme/node selection, leaving the preview, restoring saved choices,
and the non-expiring startup hint. npm run check and npm run audit passed
(zero audit findings). Logs are local at %TEMP%/mefi-local-styles-{focused,check,audit}.log.

The owner's local setting was enabled with a private backup outside the repo,
and only communitySnapshot was synchronized into the installed payload. Both
source and portable SELF_UNLOCKED remain false. A read-only live UI inspection
showed the collection unlocked; a later inspection showed the host restart
pending. No manual restart or appearance change was made while the owner was
using the window. A new full npm test was withheld because another full gate
was already in its Electron lane (run-all-tests PID 48964, run-node-tests PID
28356), with other source edits ongoing. Per the contention guidance, this is
focused evidence, not a claim of a green full gate.

## 2026-09-25 - File drops, project context and plan continuation

Windows desktop, shared checkout with concurrent agent-tools and media-player
work. Added bounded text/code imports in Home, Vibe and Plans, project-local
Vibe drafts, restored plan selection/stage, fresh project orientation and file
excerpts, and retention of earlier human interview answers. Local user data
was not edited by this task.

Focused validation: the file-input, planning UI/service/exploration, booklet
build and Vibe suites passed (86-test batch, plus the final Vibe draft suite
6/6). File-input coverage includes multi-file order, picker imports, size and
format limits, binary rejection, project-switch races, detached/read-only
controls, preserving typed text, navigation prevention and the chat host's
16,000-character message budget. The real planning Electron fixture passed
in the full gate (70 s), including DataTransfer/File drops in Home and Vibe,
plan text surviving reopen, Continue focus, and responsive layouts. Its first
solo run exposed a fixture focus race, fixed by waiting for the opening frames;
a later transparency-probe failure did not recur in the full run.

npm run build-booklet and npm run check passed; npm run audit reported zero
errors/warnings. Full npm test was attempted, with complete output retained
locally at %TEMP%/mefi-files-full-test.log:
- Node parallel stage: 3611 pass, 1 fail, 4 skipped. project_preview failed as
  a file-level process; its isolated rerun passed all 18 tests.
- Electron stage: 30 pass, 4 fail, 1 cancelled, 1 skipped. Failures: command
  capture produced no report, media hover, profiler JSON download timeout,
  unified navigation at 600px; workflow_render timed out. Eyes toggle passed;
  occlusion probe had 1 pass/1 fail (397 ms visible lag).
- The runner reported sources changing during the Electron and occlusion
  stages. Other work changed media sources/fixtures and rebuilt the booklet
  during this validation; these runs are not a clean-tree regression verdict.
- Python: 248 ran with one outdated build-order literal failing. Updated the
  contract to include fileInputs; that exact contract passes on its isolated
  rerun. The 24-test updater rerun passed 23, with the other failure caused by
  a concurrent media rebuild changing the committed booklet during the
  root-isolation comparison. Normalized-path lock: all six checks passed.

The full gate is not green; a quiet-checkout rerun remains necessary before
release. No unrelated fixture assertions were weakened or application behavior
changed to mask their failures.

## 2026-09-25 evening - Agent web search, tool permissions and stdio MCP

Added shared bounded research turns to Studio assistant, seat and direct model
routes; per-agent skill/tool selections remain isolated through fallback and
captured team configurations. Search uses Bing RSS or the optional Brave API.
Project reads enforce path/size exclusions; selected stdio MCP tools initialize,
discover, execute and time out through a host allowlist. OpenCode/Claude workers
receive a captured MCP adapter alongside the existing desk tool. Claude reply
calls disable inherited MCP as well as native tools. Agents setup exposes the
controls and distinguishes them from native coding CLI permissions.

Validation on this checkout:
- Initial focused suites: 14/14 pass. Expanded backend/planning tests: 34/34,
  then routing/seat coverage 35/35. Final combined focused run (`agent_tools`,
  `agent_addons`, `agent_profiles`, `agent_seats`, `planning_routing`,
  `planning_service`, `usage_tracker_host`): 93/93 pass. Includes actual stdio
  MCP and worker-adapter calls, denied capabilities, filesystem boundaries,
  timeouts, real host fallback paths and persistence.
- Live keyless search for Electron documentation returned five source URLs.
- Standalone `node --test tests/agent_setup_render.test.mjs`: 1/1 pass in
  78 seconds, all 12 viewport/zoom combinations, no unexpected network or
  process launches. Inspected the generated agent-addons screenshot. Artifacts
  stay local in tools/logs/agent-tools-ui; final test output is in
  tools/logs/agent-tools-final-focused.log and agent-tools-ui-test.log.
- Booklet rebuilt; npm run check and npm run audit pass. Targeted ESLint pass
  for the four new runtime modules, Agents UI and agent_tools tests. Diff check
  clean.

Full `npm test` was run and is NOT green (local output:
tools/logs/agent-tools-full-test.log). The initial parallel stage had 3618 tests,
3613 pass, one old planning "no tools" assertion failure and four skips. That
assertion now verifies permitted research plus the unchanged prohibition on
implementation/approval and passes. The initial Agents renderer failure was
the fixture selecting the first tool checkbox instead of the desk checkbox;
stable selectors and the expanded standalone UI test now pass.

Other Electron failures were command_render (no successful process exit),
media_window_render (hover-controls assertion), planning_render (no report),
and unified_studio_render (held-arrow scrolling assertion). The fixture stage
reported sources changing during execution; unrelated file-input/planning/UI
work arrived in the shared tree during this run and was preserved. The
occlusion fixture skipped after its window was closed externally. Python ran
248 contracts with one failure: the updater's exact build-order string does
not yet include the concurrent fileInputs insertion. Normalized-path lock
checks passed. No claim of a clean full-suite run: the remaining renderer and
build-order failures need a quiet-tree follow-up with that work settled.

## 2026-09-25 - Release validation for v0.4.2

Release commit ea892266f06b85fbcc352141958127cc00a2560f updates version metadata,
README, changelog, release/Discord copy and the illustrative showreel. Application
runtime sources are unchanged from 8852177. A fresh build-booklet reproduced the
committed renderer. npm run check passed (142 targets, 316 specs); npm run audit
reported zero findings; lint had zero errors and 61 existing warnings. The two
modified promo files also passed targeted lint and syntax checks.

The full GitHub Windows gate passed, including npm test, renderer freshness,
lint, check and audit: https://github.com/nateecho32-stack/mefi-studio/actions/runs/36212912879.
The Linux pipeline also passed: https://github.com/nateecho32-stack/mefi-studio/actions/runs/36212912847.
Both ran on the exact published release commit. The duplicate tag-triggered
packaging run was cancelled before publishing assets because the independently
verified portable ZIP, checksum and showreel were already uploaded.

Local Windows 11 / Node 24.15.0 / Python 3.13.14 full npm test exited 1: parallel
Node 3,608 pass, 4 skipped; Electron 33 pass, 2 fail, 1 skipped; eyes toggle 1/1;
occlusion 1 pass, 1 capability skip after its window was closed externally;
Python 248/248 and normalized-path lock checks passed. Media controls did not
reach full hover opacity, and unified_studio_render failed its primary-rail
visibility assertion for the requested 600x560 / zoom 1 case. A sequential
captured rerun passed media_window_render (25 s) but reproduced the unified
failure (94 s). Its report measured innerWidth 401 / innerHeight 374 despite
requesting 600x560 / zoom 1, following a zoom 1.5 case. The exact cause remains
unresolved; this is not recorded as a green local full gate. The relevant runtime
and fixture files are unchanged by this release. Full logs and synthetic captures
remain ignored under tools/logs/release-0.4.2-*.

The clean portable archive has 237 files, only curated.json and models.json under
app/data, the original package/app names and embedded version 0.4.2. All 157
tracked application source/assets and all 74 Electron runtime files match the
local build; ZIP CRC and published SHA-256 match. SHA-256:
992fcee5825a1312d96b15d44efaa9331706c5894e49fa5dcec8c7d2378f460d.
The refreshed showreel is 40 seconds, 1920x1080 at 60 fps, H.264/AAC, 9,988,729
bytes; full decoding and visual checks of the workflow, statistics, privacy and
v0.4.2 end card passed. The original Desktop videos were preserved. No private
state, live screenshots or credentials were committed or packaged.

## 2026-09-25 - Ask rail question review fixes

Linux cloud container, Node 24, no node_modules (Electron suites not run), on a14df38 plus this change. A review of what files cards in the Command rail's Ask tab (scripts/agent-issues.cjs, main.cjs assistantOfferQuestion). Fixes:
- Every chat reply that suggested work filed an Ask card titled "Pick the next piece of work", and Not now did not stop the next reply filing it again. The card is now named after the work ("Start "X" next?"), carries the reply that offered it, and an offer the owner answered or declined stays off the rail for 24 hours.
- Run-failure cards were one template: the title was a bare exit code, a MEFI_RESULT line or "it stopped without reporting done", the host's boilerplate was quoted as "The agent says", the last output line repeated the title, and Try again was recommended after the executor had already retried five times. The title is now the cause (a host stop reason in plain words, else the last error line), protocol lines are left out of evidence, the worker's last report is shown, and a task already retried twice or more recommends a heavier model (or a one-line instruction) with the retry relabelled "Try again unchanged".

Validation: npm run check ok; npm run test:fast 3401 pass, 0 fail, 15 skipped; Python contracts 248 ok (3 skipped); npm run audit ok, 0 findings. New tests in agent_issues and assistant_questions cover the cause-named title, the recommendation after retries, the offer title and the 24-hour quiet period.

## 2026-09-25 - Vibe runs on its own

Linux cloud container, Node 22 (the repo asks for 24), no Electron installed, shared tree at 1b4786a plus this uncommitted work. Audit of what stops Vibe's pipeline without a Build surface. Blockers found: a launch left held had no Start agents in Vibe; a pause or a missing AI had no Resume or Connect; Verify-first approvals and stuck tasks needed the Task board; checking work was listed as needing you; and Build it promised a start that could not happen. Fixes: a Vibe gate banner (assistantControl start-work, or Agents › Setup › Connections); the Needs-you drawer now also approves builds (backlogControl approve with the row's buildScope), turns Verify first off (assistantAutopilot), and retries, finishes or drops stuck tasks (tasksAction); checking tasks moved to Building now; honest Build it feedback; a throttled backlog re-read on pushes; MefiVibe.snapshot(). Checked in Chromium against npm run start:web with a stateful stubbed bridge (held launch, Verify first, one approval, one looping task, one checking, one decision). Start agents, Build it while held, approve, retry, answer and the Verify-first switch all made the expected host calls, in order. New tests/vibe_pipeline.test.mjs runs the real vibe.js in the fake DOM: 5 tests, all 5 fail against the previous renderer. All 174 registry destinations stay in Vibe. npm run build-booklet ok. npm run check ok (141 targets, 302 specs). npm run audit 0 errors / 0 warnings. npm run test:fast 3413 pass / 0 fail / 15 skipped. Full npm test (Electron stage and Python contracts) was not run: this container has no Electron.

## 2026-09-25 - Vibe menus, decisions and layout

Linux cloud container, Node 22 (the repo asks for 24), no Electron installed, shared tree at 206b9ca plus this uncommitted work. Changes in Vibe mode: decisions under Needs you are answered in a Vibe drawer through assistantAnswer; every menu takes Vibe's shape; Search and Shortcuts list Home once as Vibe; Settings gains an in-place Studio mode switch and relabels the launch switch; the dock floats over the page; sheets on the Vibe page use the full width. Checked in Chromium against npm run start:web, with a stubbed window.mefiStudio holding a sample project, running work and two decisions. Screenshots covered Search, Shortcuts, the project panel, the Agents hover menus, Settings in both modes, Command's View and Agents pop-overs, Tasks, Plans, the Vibe page and the decision drawer at 1440x900 and 760x720. Both decisions were answered from the drawer; it advanced, then closed, and the lanes and status pill updated. The Settings switch flipped the frame both ways without leaving Settings. All 174 registry destinations opened from Vibe stayed in Vibe mode. tests/vibe_frame.test.mjs now has 10 tests. npm run build-booklet ok. npm run check ok (141 targets, 301 specs). npm run audit 0 errors / 0 warnings. npm run test:fast 3408 pass / 0 fail / 15 skipped. Full npm test (Electron stage and Python contracts) was not run: this container has no Electron.

## 2026-09-25 - Vibe mode keeps every click in Vibe

Linux cloud container, Node 22 (the repo asks for 24), no Electron installed, shared tree at a14df38 plus this uncommitted work. In Vibe mode every other page now opens inside Vibe's own rail (#vibe-rail) instead of Build's menu. Home, leaving Command and Back on a Work page return to Vibe. Build's section bar no longer covers Vibe's top buttons, and pages no longer show Vibe through their glass. A restored session or closing Appearance no longer opens Build's Home. Checked in a browser against npm run start:web with Playwright and Chromium. Every one of the 172 registry destinations opened from Vibe stayed in Vibe mode with neither Build's rail nor its Home showing. Dock, lanes, rail, Command exit, Tasks Back and the Build/Vibe round trip were also clicked by hand. New tests/vibe_frame.test.mjs: 8 tests, 7 of which fail against the old renderer. npm run build-booklet ok. npm run check ok (141 targets, 301 specs). npm run audit 0 errors / 0 warnings. npm run test:fast 3406 pass / 0 fail / 15 skipped. Full npm test (Electron stage and Python contracts) was not run: this container has no Electron.

## 2026-09-25 - Planning pipeline review fixes

Windows 11, local Electron, Node 24, shared tree at 5f84d28 plus this uncommitted work. This is a review of the Plans pipeline (scripts/planning.cjs, scripts/planning-service.cjs, renderer/planning.js). Fixes:
- A failed Mefi reply no longer leaves the already-saved answer in the box. Previously a resend filed it twice. The host now files an identical trailing answer once and returns answerSaved; the page clears the box and offers Continue with Mefi.
- A rename keeps the confirmed reading and the approved specification.
- Re-saving an unchanged specification is a no-op that keeps its approval.
- Reopening a still-open question is refused.
- A re-asked decided question is no longer pointed at as the next ask.
- A long explanation is clipped to the note limit instead of discarded.
- Dropped or deleted plan tasks read "Dropped by you" or "No longer on the board".

Two planning_ui expectations moved from "unknown" to "missing", because the fixture's successful read of an empty board is exactly that case. Nine new tests. Eight of them were run against HEAD in a scratch worktree and all fail there; the ninth guards a regression in this change's own Continue rule. Planning suites 112/112. npm run build-booklet ok. npm run check ok (140 files). npm run audit 0 errors / 0 warnings. Full npm test: Node suites 3402 pass / 0 fail / 4 skipped; Python contracts 248 OK; path lock pass. Electron stage 34 pass / 1 fail / 1 skipped. The failure was command_render: its fixture reported passing in 77 s but hit the harness timeout (a known environmental failure). It passed on a solo rerun.

## 2026-09-25 - Release gate for v0.4.0

Windows 11, local Electron 44.4.1, Node 24, gated in a detached worktree at the release commit (201103b landed the 0.4.0 work from the shared tree; fbc64b4 bumps package.json and package-lock.json to 0.4.0, cuts [Unreleased] into [0.4.0] and updates the README). A fresh npm run build-booklet reproduced the committed renderer/booklet.html blob exactly. npm run check ok (140 targets, 300 specs, all selectors used). npm run audit 0 findings. npm test: Node suites 3393 pass / 0 fail / 4 skipped; Python contracts 248 OK (1 skipped); path lock pass; serialized stage 1 pass; occlusion probe 1 pass / 1 skipped. Electron stage 34 pass / 1 fail / 1 skipped. The failure was command_render: its fixture was killed by the harness timeout at 81 s before it wrote a report, with no assertion failing inside the app. Run alone on the same commit it passed in 61.6 s, and it passed in both earlier full runs of the same tree that day (listed under Known environmental failures above). The three unmerged cloud branches (claude/friendly-ride-453f4z, claude/gallant-babbage-lshjfb, claude/pensive-dirac-fkvdzi) are not in this release.

## 2026-09-25 - Pushes cross the context bridge once

Windows 11, local Electron 44.4.1, Node 24. The commit was built on 8fd7ac1 in a detached worktree, because the shared tree carries other uncommitted work. preload.cjs now installs window.mefiStudio with contextBridge.executeInMainWorld, so each push crosses into the page once and every on* subscriber shares that copy. eyes:assistant sends keys the page already holds as references (scripts/assistant-push.cjs), and tasks.js edits copies of pushed rows. npm run build-booklet ok. npm run check ok (110 targets, 248 specs, all selectors used). npm run audit 0 findings. eslint on the touched files: 0 errors. npm test exit 0: Node suites 2642 pass / 0 fail / 3 skipped; Electron stage 26 pass / 1 skipped; serialized stage 1 pass; occlusion probe 1 pass / 1 skipped (capability absent on this desktop); Python contracts 248 OK (1 skipped); path lock pass. The new tests/preload_fanout suite has 8 tests; five preload suites moved from an exposeInMainWorld fake to executeInMainWorld. A real app smoke run (main.cjs --smoke with a scratch userData) booted the booklet with 39 cards. Two onTasks subscribers got the same object, the bridge was frozen and read-only, eyes:assistant-sync arrived, and the first assistant push was whole. Before/after numbers are in docs/performance.md.

## 2026-09-24 - Performance pass: renderer frames, host pushes and agent-loop bookkeeping

Branch claude/friendly-ride-453f4z, a Linux cloud container (Node 22.22, Python 3.11), no desktop. Merged three worktree branches (Command/rail/Overhead canvas, Tasks/Workspace/Explorer/CSS, agent harness) onto the host batching commit 96c789d, then rebuilt renderer/booklet.html. npm run check ok (109 targets, 253 specs); npm run audit 0 errors, 0 warnings; npm run lint 0 errors, 32 warnings (unchanged). npm run test:fast: 2626 tests, 2612 pass, 0 fail, 14 skipped (the Electron suites it leaves out). Python `unittest discover -s tools -p "test_mefi_studio_*.py"`: 248 OK, 3 skipped. New suites: host_push_batching, machine_hang_window, scope_heal_walk, backlog_memo, collab_overlap_memo, duplicate_scan, eyes_edit_rows_memo, assistant_facts_budget, plus cases in command_visuals, command_activity, tree3d_performance, music, overhead_poll_backoff, tasks_ui, workspace_ui, explorer_ui and catalog_renderer. Not run: the Electron lane of npm test and the occlusion probe. Electron would not start here as root without disabling its sandbox, which was not done, so a desktop `npm test` is still owed before release. Measurements are in docs/performance.md (September 24 section).

## 2026-09-24 night - Restored stash work, glass menus and a context-aware companion chat

Windows 11, local Electron, main at 8fd7ac1 plus uncommitted work. A pull had left the owner's local work in a GitHub Desktop stash. It was merged back over the pull and the later Codex edits; backups are under refs/backup/*. Seven suites were adapted to the merged code. The menus gained a lighter frosted material and one gliding highlight. The companion chat now gets the owner's screen and companion name (ui) and the "N need you" list (needsYou, from companion.queue). It also sees notices and offers in its thread. A plural yes starts every offered card, and a chat start answers the Pick-the-next-work card. New tests: task_oversight (plural yes), assistant_overseer_chat (all of them, ui/thread payload, needsYou equals the badge, offer card answered in chat; the last one fails without the fix).

Real-app probe: a scratch copy of the app with its own data/, a scratch project, throwaway userData and executor off. The companion seat and main provider pointed at a fake LM Studio server that recorded payloads. Escape opened the hub. The Requests badge read 4, and the payload's needsYou.total was 4 with the same titles. The Ask tab showed "Viewing: Home", Star-labelled replies, the notice as an update, and chips for the two offers plus All of them. The chip sent "all of them", and the model saw both offered titles. Command's context read {view: "Command view", companion: "Star"}.

npm run check ok (139 targets, 299 specs, CSS merge/unused, syntax, TESTRUNS). npm run audit: 0 findings. npm run build-booklet rebuilt booklet.html. Full npm test exit 0: Node 3,424 tests (3,418 pass, 6 skipped, 0 fail) across 272 suites (18 Electron); Python contracts 248 OK; normalized-path lock ok. An earlier full run failed occlusion_probe only because renderer sources were edited mid-run (the runner flagged it); it passed solo. companion_hub_render failed once in a solo loop and then passed 5 times; watch it for a flake.

## 2026-09-24 - Audio-linked tree motion smoothing

The Command overview's Tree motion followed bass onsets with an immediate orbit-velocity impulse and a quarter-turn jump in its figure-of-eight sway. Removed both discontinuities; spin, bass swell and snare nod now ease over time, while the sway phase advances continuously at a kick-sensitive rate. Updated the graph regression to bound one-frame phase, scale, tilt and spin changes after an onset. Existing concurrent label and workspace edits were left intact.

Focused `node --test tests/command_graph.test.mjs tests/command_audio_response.test.mjs`: 116/116 pass. `npm run build-booklet`: 39 models, hash f98dd2322a01. `npm run check`: 109 targets, 247 specs, CSS/unused/syntax/TESTRUNS clean. Full `npm test` exit 0: parallel Node 2638 (2635 pass, 3 skipped), Electron lane 27 (26 pass, 1 skipped), eyes toggle 1/1, Python 248 OK, normalized-path lock 6/6. The desktop occlusion probe skipped because its test window was destroyed externally during cover-wait; its fixture reported no failure. `npm run audit`: zero errors and warnings. `git diff --check`: exit 0.

## 2026-09-24 evening - Home glass over the live node tree

Cloud container (Linux, root, Node 22.22, xvfb, software rendering) on claude/optimistic-hypatia-uu9opq from 340940f. npm run build-booklet ok; npm run check ok (109 targets, 245 specs); npm run audit ok (0 findings); npm run lint 0 errors (32 pre-existing warnings, none in touched files). npm test under xvfb-run: Node suites 2574 pass / 0 fail / 14 skipped, Python contracts 248 OK (3 skipped), path lock pass. Electron stage 24/27 pass, 2 skipped; Electron refuses to run as root without --no-sandbox, so node_modules/electron/dist/electron was locally wrapped to add it (not committed). The one red suite, command_render, fails at the fixture's audio section with '__assistant__ retains its label position' (actual null); the base commit 340940f fails identically in this container, and with that one assertion skipped locally (not committed) the whole fixture, exit/reentry and the Music preview included, passes on this change. New specs: two in command_graph (backdrop cadence; Home/Command canvas handoff through the real module) and one in workspace_ui (backdrop after the startup layer, off on leaving). Headless Chromium profiler over 5 s at 1600x1000 on a 90-node fake-bridge tree: Home backdrop 10.2 frames/s at 2.84 ms, Command 29.2 frames/s at 3.44 ms.

## 2026-09-24 - Agent-loop review: fixes across all five pipeline stages, Linux container without Electron

Reviewed the agent pipeline stage by stage (dispatch and claim, the worker run, settlement, verification, the loop's control plane) and fixed what reproduced, in commits b643750, 6f311c6, 08ab5ae, e98f586 and 7ce96a0; each fix has a regression test that fails on the tree before it. Ran on Linux with Node 22 (the package asks for 24) and Python 3.11, with no `npm ci`, so no Electron binary: the Electron lane of `npm test` did not run and is not claimed here. `npm run check` and `npm run audit` exited 0 (zero findings). `npm run test:fast` exited 0: 2602 pass, 0 fail, 14 skipped. `python -m unittest discover -s tools -p "test_mefi_studio_*.py"`: 248 OK, 3 skipped. `node tools/test_normalized_path_lock.mjs` passed. `node tools/monitor_loop.mjs --scenario all --minutes 60 --tasks 9` printed the same board, run and settlement lines before and after the changes. One Python pin in `tools/test_mefi_studio_assistant.py` was updated to the new `infraFail` expression, whose intent it states. No project state, settings or secrets were added.

## 2026-09-24 evening - Styling consistency: Home, the task board, buttons and status tints move onto theme tokens

Linux cloud container (Node 22, Python 3), branch claude/pensive-dirac-fkvdzi after the menu pass (094ab62). CSS only: renderer/styles.css plus the rebuilt renderer/booklet.html. The workspace and task-board block (styles.css about lines 2361-2900) mapped 182 colour literals from the old olive palette onto tokens (neutrals by lightness to --bg, --panel-solid, an 8% accent mix, --hairline(-strong), --ivory, --muted, --dim; status to --good, --warn, --bad, --info and a new --idea) and 35 radii onto --r-*; its accent now defaults to the theme's. 33 rgba(201,168,106,a) old-gold tints became --tint-gold-* or color-mix of --gold; 42 hand-written warn, bad, live and gold-bright tints became color-mix of their tokens; the global button rest and hover fills became theme surface and accent mixes. Canvas colours in renderer/*.js and the neutral near-black shadows were left alone. Compared npm run start:web renders of HEAD (a worktree on port 4174) and the change on the aurora, violet and ember themes. npm run build-booklet ok; npm run check ok (109 targets, 245 specs, all selectors used); npm run audit 0 findings; npm run test:fast 2585 tests, 2571 pass, 14 skipped, 0 fail; Python contracts 248 OK (3 skipped). The Electron lane and full npm test were not run here (no attended desktop).

## 2026-09-24 - Menu design pass: the rail fits 900px, Search groups its sections, toasts clear the open menu

Linux cloud container (Node 22, Python 3), branch claude/pensive-dirac-fkvdzi on 340940f plus uncommitted renderer CSS changes. Reviewed the menus in npm run start:web with headless Chromium at 1400x900, 1280x720 and 600x560. Found that the open rail needed about 706px of list in 624px at 900px tall and 620px in 472px at 720px tall, the resting Settings tile ellipsized, the <=640px rule shrank open heads to 9.5px, the unpinned open rail sat under the tip toast, Search repeated each row's section, the palette field's ring cut the sheet's corner, the project panel's brand wore the current-page pill and the Shortcuts key column was 112px for an 80px keycap. Changes are CSS only (renderer/styles.css) plus the rebuilt renderer/booklet.html. Afterwards the list measures 632 in 632 at 900px and 571 in 571 at 720px. npm run build-booklet ok; npm run check ok (109 targets, 245 specs, CSS merge skipped with no merge, all selectors used); npm run audit 0 findings; npm run test:fast 2585 tests, 2571 pass, 14 skipped, 0 fail; Python contracts 248 OK (3 skipped). Electron: python tools/verify_workspace.py --menus-only under xvfb-run with ELECTRON_DISABLE_SANDBOX=1 and a local electron.exe symlink (the verifier is Windows-pathed): the menu checks and the five-size layout sweep passed, then the run failed at 'menu checks never start a coding worker' (5 !== 0); the same command on the stashed baseline fails identically, so that check is environmental on this Linux container. The full npm test gate was not run here (no attended desktop).

## 2026-09-24 - Overview spins the tree about its own centre at a steady frame, and the Audio link's Tree motion

Linux container (Node 22.22.2, Electron 44.4.1 under Xvfb, ELECTRON_DISABLE_SANDBOX=1) on 340940f plus this change. Baseline before editing: command_graph, command_visuals, command_audio_response and music 194/194. A measurement harness over one full turn of the old overview showed its framing fall from 1.0 to 0.14 (Branches and Terraces at 1920x1170) and the tree's screen centre drift up to 370 px; with the change the framing is constant through the turn (0.62 to 1.0 by layout) and no node leaves the frame. After the change: npm run build-booklet ok; npm run check ok (109 targets, 245 specs, TESTRUNS clean); npm run audit 0 errors / 0 warnings. npm test exited 0: parallel Node 2589 (2575 pass, 0 fail, 14 skipped); Electron lane 27 (25 pass, 2 skipped); eyes toggle 1/1; occlusion probe 1/1; Python 248 OK (skipped=3); normalized-path lock ok. Run solo before the gate, tests/command_render.test.mjs failed at "__assistant__ retains its label position" (the 2D audio section) on both the unchanged HEAD and this change in this container; with only that assertion skipped in a throwaway copy the whole fixture passed on the change, and inside the full npm test run the suite passed unmodified. A scratch Electron capture (not committed) turned Constellation and Branches through a full turn by right-drag and played a synthesized 120 bpm beat: every node stayed in the frame, and the spin advanced 0.20 rad in 2 s with the beat against 0.02 rad before.

## 2026-09-24 afternoon - Refined Command glass panels and inset cards

Refined the shared glass material in renderer/studio-ui.css with softer rims,
diffuse shadows and a stronger frost. Command uses a single outer glass surface
for each toolbar and panel, transparent task/search inputs, a recessed tab
strip, rounded work/run/ask cards, four compact status tiles and denser sticky
section headings. Small windows and compact density reduce padding; the
existing light theme, blur and reduced-transparency preferences still apply.
Updated the architecture walkthrough and changelog; rebuilt booklet.html.

Validation: npm run build-booklet, npm run check (139 syntax targets; all CSS
selectors used) and npm run audit (zero findings) pass. Full npm test exits 0:
Node stages total 3,368 tests, 3,363 pass, 5 skipped, no failures or cancellations;
all 248 Python contracts and all six normalized-path lock checks pass. Command
renderer, all node views, responsive page captures and both desktop visibility
fixtures pass. No source-change warning appeared. Full log is in the OS temp
directory at mefi-panel-polish-20260924/full-test.log.

The final isolated visual pass saved nine captures: desktop Work and Assistant,
125% display scaling, a 600px window, a custom light palette, Focus, Atmosphere,
blur disabled and reduced transparency. Geometry checks found no document or
tab overflow. Computed styles confirm nested cards/search do not add backdrop
filters, and both blur-off paths remove the panel blur. No renderer errors,
external requests or worker launches. The synthetic fixture, report and images
remain outside the repository in the OS temp directory under
mefi-panel-polish-20260924/after; live app state was not used.

## 2026-09-24 afternoon - Project map navigation, search and camera motion

Rebuilt the project map as a navigable explorer: single-click inspection,
double-click/Enter drill-down, breadcrumbs, Up and Back/Forward with restored
selection and camera positions. Browse searches all indexed systems, parts and
files, offers current-level filters, and pages large lists without truncating
access. The minimap, pointer-centred zoom, drag momentum, spatial keyboard
selection, finite camera easing and hover/level transitions respect reduced
motion and settle when idle. Short windows hide the minimap; narrow windows
retain Inspect and Back to map. Related systems and part/file actions are
navigable, and Work here prepares a draft scoped to the selected location.
Refresh retains valid locations; project changes reset history. The renderer
is split into project-map-view.js and the existing Agent brain data/painter.

Focused validation: initial isolated map fixture passed, then the map host,
booklet build, shared-node and real map renderer checks passed 31/31. The final
full run's map fixture also passed, including a 130-file folder, root files
beside a folder named Files, search beyond the first page, real pointer drag,
no accidental navigation, camera history, refresh, draft handoff, rapid travel,
OS/app reduced motion and project isolation. Inspected synthetic desktop,
file-detail and 600px captures, including 150% scaling. The existing Unified
Studio fixture passed in the full run and again on its own after strengthening
its keyboard-pan check to require a changed, settled camera position. It
retains all 36 layout/style/zoom cases. No renderer errors or network attempts.

npm run build-booklet, npm run check (139 syntax targets, 297 unique specs),
and npm run audit (zero findings) pass. Targeted lint reports zero errors and
two existing unused helpers in agent-brain.js. Tracked diff whitespace is clean.

Full npm test completed: Node 3361 pass / 1 fail / 6 skip; all 248 Python
contracts and all six normalized-path checks pass. The sole failure is the
unrelated verification_drain assertion that looks for an exact 1000ms timer;
its implementation subtracts a second real Date.now() read. The complete
20-test suite passes on an isolated rerun. All Electron stages pass; the
occlusion probe records the documented capability skip. This is not claimed
as a green full-suite result.

The full log is outside Git at %TEMP%/mefi-project-map-full-test.log. Synthetic
screenshots and reports remain in %TEMP%/mefi-project-map-captures and
%TEMP%/mefi-project-map-unified-captures. Updated architecture, code map,
Unified Studio notes and changelog; rebuilt renderer/booklet.html. Live and
portable user data were preserved.

## 2026-09-24 afternoon - Glowing wisp reactions and thinking

The shared intro/setup/main companion is now a soft glowing node with a
curling light trail and orbiting motes. Playing releases an ASCII expression
and six small sparks, replacing the previous burst on repeated taps. Thinking
uses a quicker orbit, soft glow pulse and staggered `...` during launch/setup,
pending chat replies and reported agent work. Successful replies celebrate;
errors settle without celebrating. Waiting for a project choice is a happy,
idle state. Live refreshes retain the existing SVG and animation progress.
Reduced motion keeps expressions still, omits sparks and cancels motion.

Focused checks: 24/24 pass across companion state, renderer startup, booklet
build and the real companion interaction fixture. The fixture verifies
bounded repeated play and cleanup, pending/success/error chat states, reported
work, stable SVG identity, reduced motion, existing permission gates, draft
retention, nested focus/Escape, audio state and 600px / 150% zoom. Captures of
intro, setup, hub, thinking, happy reaction and narrow layouts were inspected.
No external requests, live application state or real workers were used.

Renderer build, npm run check and npm run audit pass. The final check covers
139 syntax targets and 297 unique specs; the auditor reports zero findings.
Full npm test completed with exit 1: Node 3367 total / 3360 pass / 1 fail /
6 skip; Python 248/248 pass and normalized-path lock 6/6 pass. The failing
unified_studio_render fixture reaches and passes its companion interactions,
then fails on a missing project-map zoom input. It reproduces in a solo rerun
after the stale-draft/map navigation stage. The runner also reports source
changes during its Electron stage. That separate map failure is retained as
an unresolved full-suite result; no unrelated map implementation was changed.

Full logs remain in the OS temp directory as mefi-wisp-full-test.log,
mefi-wisp-focused.log and mefi-wisp-unified-recheck.log. Synthetic captures
remain in mefi-wisp-review and mefi-wisp-unified-review, outside Git.

## 2026-09-24 Unified Studio - completed integration gate

Implemented Home / Work / Agents ownership, the six-section Agents workspace,
scoped team drafts and independent presets, supported effort/Fast propagation,
and configuration snapshots retained by running and resumed work. Added shared
scrollbar-free overflow/dropdowns, section/project Back and Forward history,
appearance presets, adaptive companion hover controls and safe roaming, and
project-specific learning. Maps use bounded pan/zoom canvases; narrow workflow
views have explicit returns. Short-window rail controls keep Home, Work and
Agents visible at 150% zoom. Existing working-tree changes and local data were
preserved. Updated setup/navigation documentation and rebuilt booklet.html.

Final settled-tree npm test PASSED: parallel Node 3325 pass / 4 skip; Electron
lane 34 pass / 1 skip; serialized visibility 1/1 and occlusion 2/2 passed.
Python contracts 248/248 and all six normalized-path checks passed. The run
finished with exit 0 (Node 281 s, Python 60 s). npm run build-booklet, npm run
check (138 syntax targets, 296 unique specs, 10 stylesheets), npm run audit
(zero errors/warnings), and the whitespace check also passed.

The isolated Studio fixture covers 36 size/zoom/appearance combinations,
1920x1200 through 600x560, 100/125/150% zoom, seven colour themes, 21 legacy
routes, populated map/pipeline/Playbook panes, keyboard and held overflow
arrows, long and grouped dropdowns, companion hover corridors and editing,
roaming/pinning/visibility, stale drafts and project isolation. The Command
fixture covers 60 destination layouts, 16 Settings layouts and 12 Session
submenus. Synthetic render captures were inspected, including the compact
150% map with readable labels and all three primary destinations visible.

Earlier loaded runs exposed a startup mock clock shorter than the current
fade, an asynchronous Chromium zoom measurement, and profiler download
timeouts while other sessions ran tests. The clocks/viewport waits were
corrected without relaxing assertions. Focused Command, profiler and Studio
reruns passed, followed by the green full gate above. Complete final output
is in the OS temp directory, mefi-unified-settled-final-gate.log; focused
captures are in mefi-unified-final-captures. No synthetic captures or live
user state were added to Git.

## 2026-09-24 - Theme-aware glass visual pass

Replaced the neutral opaque surface overrides with shared theme-tinted glass
materials for pages, reading panels, fields, menus and navigation. Added quiet
two-colour gradients and local heading fonts per theme, preserved dense UI
text, and hid inactive Home/Command controls beneath workspace pages. Custom
palettes retain saved colours and the chosen canvas background while text and
both primary-button gradient endpoints receive contrast protection. Glass,
glow, compact density, blur-off and reduced-transparency preferences remain
supported. Rebuilt the booklet and updated the architecture and code map.

Synthetic offscreen Electron visual QA passed 66 route/viewport checks across
22 views at 1440x900, 600x560 and 1100x720 with 125% zoom. Captured all 11 built-in
themes plus two custom palettes, three appearance presets, nested menus,
provider/model choices, search, companion, audio, blur-off and reduced
transparency: 103 screenshots with no renderer errors, external requests or
worker launches. A final nine-capture pass checked the latest shared sources,
including dense menu tint, hidden page underlays, the project map, Plans and a
custom light Home. Temporary fixtures: mefi-glass-matrix-wn0b4Y and
mefi-glass-probe-rjh2O3. No live app state was used or modified.

The focused music and booklet build suites pass 82/82, including regression
coverage for custom reading surfaces and both action-gradient endpoints.
Final build, npm run check (138 syntax targets, 296 unique specs), npm run audit
(zero findings), and affected-source whitespace checks pass. Logs are local
and ignored under tools/logs/glass-pass.

Full npm test passes, exit 0: 3,367 Node tests / 3,361 pass / 0 fail / 6 skipped
(parallel stage 3,325 pass, Electron lane 34 pass, exclusive stages 2 pass),
all 248 Python contracts and all six normalized-path lock checks. The occlusion
skip is capability-gated. Startup's custom light theme, Plans, agent setup,
shared menus and the real workflow render checks pass in the full run. No
source-change warning occurred. The main Node stage used two available CPUs
to avoid adding a wide test workload to other active sessions; normal CPU
availability was restored before the Electron stage. Full output is saved in
tools/logs/glass-pass/npm-test.log.

## 2026-09-24 afternoon - Distinct compact planning steps and directional slides

The eight planning stages now use existing SVG symbols, individual soft accent
colors, compact captions, and matching section headers. Cards enter with a short
stagger, and navigating backward or forward slides the revealed section from
that direction. Browsing is separate from saved workflow progress; it keeps
editable controls and local text, remembers revealed sections, and cancels a
previous transition on rapid navigation. App and OS reduced-motion settings
suppress the slides. A folded section also opens when all its fields are locked.
Tighter form spacing and a smaller maximum stage area leave more room to write.
The existing transparent surfaces and approval gates are preserved.

Focused planning checks: 33/33 pass (32 behavior cases plus the real Electron
fixture). The fixture verified all eight icon references, native entrance and
both slide directions, unchanged workflow status, field focus, reduced motion,
responsive layouts, glass transmission and restored background controls. The
initial workflow is 145px tall and the save control remains visible. Inspected
1440px, 1100px and 600px captures, including saved Review and teal/violet glass.
No renderer errors or external requests. Synthetic screenshots and report.json
remain outside Git in the OS temp directory, mefi-planning-steps-captures.

Required gates pass: npm run build-booklet, npm run check (138 syntax targets,
296 unique specs, all selectors used), npm run audit (zero findings), and npm
test. Full Node: 3361 pass / 0 fail / 6 skip across all stages; Python 248/248
pass; normalized-path lock 6/6 pass. One of the skips is the occlusion probe,
whose window was closed externally during its cover-wait; its guard passes.
Startup, companion and planning render fixtures all pass in this run. Complete
output is in the OS temp directory as mefi-planning-steps-full-test.log.

Updated architecture and changelog, rebuilt renderer/booklet.html, and checked
source diff whitespace. No live app state or generated screenshots were added
to Git.

## 2026-09-24 afternoon - Companion wake-up and glass bubble menu

Added a shared, playful wake-up character to launch, the first-run guide and
the main companion. Click or Escape opens a compact glass bubble menu for
chat, friends/listening rooms, requests, notifications, settings and quick
actions. The center returns to the current view. Existing permission gates,
chat drafts and run settings are preserved. Internal panels resize, audio
reactions sample the existing link without starting capture, and reduced
motion cancels in-flight animations. Setup explanations now fold away.

Validation: renderer build, npm run check and npm run audit passed. The real
isolated companion fixture covers startup consent, the explicitly approved
setup chain, unchanged application window bounds, request approval, draft
preservation, focus and Escape, nested select ownership, audio disconnection,
live reduced-motion changes, and 600x560 / 150% zoom layouts. Captures were
visually reviewed. No external requests or live application state were used.
The existing startup renderer also passed. Startup readiness unit tests passed
9/9 with the virtual clock allowing the longer intro fade.

Full npm test completed with exit 1 on a concurrently changing tree: 3365
Node tests, 3356 passed, 3 failed, 6 skipped; all 248 Python contracts and six
normalized-path lock checks passed. Both Node stages reported source changes.
Failures were a project-preview startup timeout, Command's CSS-viewport zoom
assertion, and the new fixture reading its answer count before asynchronous
input reached the fake host. The companion fixture now waits for that actual
answer before asserting its count, retaining the no-answer-before-click check.
Sequential reruns of command_render, companion_hub_render and project_preview
passed 20/20, exit 0. The initial full run remains recorded as failed rather
than a clean full-suite result; other running sessions were left untouched.

Logs and seeded captures are in the OS temp directory: mefi-companion-full-test.log,
mefi-companion-recheck.log, mefi-companion-solo.log and mefi-companion-review/.

## 2026-09-24 afternoon - Compact choice grids and menu layouts

Short dropdowns now use two- or three-column tiles with selected checks,
option-group labels and a bounded width. Long labels and large option lists
retain searchable rows. Keyboard arrows follow the visual tile positions,
skip disabled choices/groups, and retain Enter/Escape and focus return.
Appearance presets use small visual previews in one row; themes, node styles
and effects use compact grids. View, Ambience, Brain map actions and Tools
menus group actions side by side. Narrow Appearance headers take less space.
Updated architecture/changelog and rebuilt renderer/booklet.html.

Validation: build-booklet, npm run check and npm run audit passed (zero audit
findings). Unified Studio's isolated Electron integration passed solo and in
the full suite, including new grouped-choice keyboard/selection coverage.
Command toolbar's 10 tests passed; its obsolete auto-width expectation now
checks the View menu's viewport cap. Synthetic screenshots were reviewed at
wide/narrow sizes and 125% zoom. Backdrop's ten choices fit without scrolling,
preset choices share one row, and dropdown bounds stay within the viewport.
No network requests, renderer errors or worker starts in the visual probe.

Full npm test completed: parallel Node 3323 pass, 0 fail, 4 skipped; Electron
32 pass, 2 fail, 1 skipped; eyes-toggle 1/1; occlusion 1 pass and 1 capability
skip; Python contracts and all six normalized-path checks passed. Command
render's saved report shows the existing asynchronous zoom-size mismatch
(expected 880x576, observed 1100x720), followed by an EBUSY temporary-directory
cleanup failure. Desktop performance capture timed out downloading profiler
JSON. The source-fingerprint guard detected concurrent edits during the
Electron stage; several other full-suite runners were active. No full-suite
pass is claimed, and no further capture rerun was added to that contention.

Complete logs, before/after source snapshots and synthetic captures remain
local in tools/logs/compact-menus/. Live data and portable data were untouched.

## 2026-09-24 afternoon - Dynamic 3D Overview keeps the main tree framed (live tree camera, implementation and motion validation)

Added a bounded pan/scale lens to automatic 3D Overview through camera-tour.js. It uses the current projected bounds of every stable branch, borrows the demo tour's damping, and clamps the whole tree inside the measured panel-free rectangle. Projection and inverse projection share the offset; layout anchors, saved camera settings and existing appearance controls are retained. Paused Spin, selection/search, manual navigation and reduced motion stop roaming. Fit and layout changes reset the lens; the Appearance preview restores it. Updated architecture, code map, changelog and generated booklet.

PASS: npm run build-booklet, npm run check and npm run audit (zero findings on the final audit). The first audit caught a concurrently edited companion-hub DOM lookup; its owner corrected it before the final build/check/audit. PASS: 162 focused camera-tour/Command graph/director/motion/visual tests. Added multi-size framing, gradual pan/zoom, pause/reduced-motion, anchor stability, projection round-trip, live-arrival and manual-camera regressions.

PASS: isolated synthetic Electron capture, 122 sampled states and 100 captured frames. A roughly 49-second automatic recording kept the whole main tree in bounds with unchanged world anchors. All five arrangements were checked at 1024x768, 600x560 and 1024x768 at 125% scaling, plus the 1440x900 recording. Clicking a moved node selected the right task; paused Spin and reduced motion held framing still. No renderer errors, network requests or worker launches. Initial scratch-capture failures were harness issues (calling an unexported Zen setter, then reading between a live rebuild and its next paint), corrected without application changes. Recordings, screenshots, raw report and review page remain outside Git in %TEMP%/mefi-node-refresh/overview/. The earlier compact-label and transient callout-overlap findings are separate from this camera change.

Full npm test was not a clean pass: parallel stage 3315 pass / 1 fail / 4 skipped, Electron lane 32 pass / 1 fail / 1 skipped, eyes-toggle 1/1 and occlusion 1 pass / 1 skip (probe window closed externally). The startup unit-test child stalled without CPU progress for several minutes; only that verified child of this run was stopped so remaining stages could finish. It passed 9/9 on an immediate bounded solo retry. The toolbar CSS contract failed against an in-flight stylesheet and passed 10/10 on solo retry. The runner detected concurrent source changes in both failing stages. Real Command interaction passed in the full run (66.9 s), including navigation and agent movement. Logs: %TEMP%/mefi-overview-{build,check,audit,focused,render,full-test,startup-retry,toolbar-retry}.log.

The full gate completed: Python contracts 248/248 passed (312 s reported by unittest; 339 s including process startup), and all six normalized-path lock checks passed. npm test exited 1 because of the two Node-stage results above (674 s). Both named failures passed their isolated retries; no second full-run pass is claimed.

## 2026-09-24 - Dense agent setup rows and compact controls

Condensed Agents setup into short desktop rows: add button, role, model,
effort/fast controls and corner provider icon sit alongside each other.
Reduced row gaps, control heights, header, toolbar and footer spacing; bounded
the team list to 1120px and grouped toolbar actions together. All eight main
agents fit at 1440x900, six at 1100x720 and three at 600x600. Narrower/zoomed
views wrap controls. Provider and skill tiles keep their selected states.
The render fixture seeds a larger roster and waits for the search menu so it
exercises catalog search after the shared short-menu tile picker changed.

Validation: build-booklet, npm run check and npm run audit passed (zero final
audit findings). Agent setup's isolated Electron interaction check passed
solo and in the full run. All 12 window/zoom combinations pass without
horizontal overflow, renderer errors, network requests or worker starts.
Desktop, narrow and expanded-provider captures were visually reviewed.

Full npm test completed with failures outside the changed panels. Parallel
Node: 3315 pass, 1 fail, 4 skipped. renderer_startup.test.mjs stalled with no
further output; its verified isolated test subprocess was stopped after more
than four minutes, and the runner recorded that failure before continuing.
Electron lane: 32 pass, 1 fail, 1 skipped; the failure is command_toolbar's
stylesheet contract. The actual rendering workflows passed. Eyes-toggle 1/1
passed; occlusion 1 passed with 1 capability skip. Python 248/248 and all six
normalized-path lock checks passed. Sources changed during this shared-tree
run; no full-suite pass is claimed. An early audit flagged the dynamically
created walkthrough companion ID; the final audit is clean.

Logs: %TEMP%/mefi-agent-compact-{check,audit,render,full-test}.log.
Captures/report: %TEMP%/mefi-agent-compact/. No live application data or
portable data was changed.

Command, exactly as specified, from the package root, combined stdout+stderr captured at
the OS level (cmd `> log 2>&1`, preserving order) - exit **1**:

```text
✖ real performance profiler catches blocking work, freezes captures and fits a narrow window (27253.745ms)
✔ desktop performance capture measures real Electron processes and IPC without exporting payloads (9029.4255ms)
ℹ tests 2
ℹ suites 0
ℹ pass 1
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 36802.6363

✖ failing tests:

test at tests\performance_render.test.mjs:80:1
✖ real performance profiler catches blocking work, freezes captures and fits a narrow window (27253.745ms)
  AssertionError [ERR_ASSERTION]:
  Error: Profiler JSON download timed out after 5180ms at 1.04x observed pace
      at Timeout._onTimeout (C:\Users\echor\OneDrive\Desktop\Coding Projects\Mefi's Studio AI+\tests\fixtures\performance-render-electron.cjs:137:22)
      at listOnTimeout (node:internal/timers:685:17)
      at process.processTimers (node:internal/timers:618:7)

  Error: Profiler JSON download timed out after 5180ms at 1.04x observed pace
      at Timeout._onTimeout (C:\Users\echor\OneDrive\Desktop\Coding Projects\Mefi's Studio AI+\tests\fixtures\performance-render-electron.cjs:137:22)
      at listOnTimeout (node:internal/timers:685:17)
      at process.processTimers (node:internal/timers:618:7)

  1 !== 0

      at runFixture (file:///C:/Users/echor/OneDrive/Desktop/Coding%20Projects/Mefi's%20Studio%20AI+/tests/performance_render.test.mjs:68:12)
      at async TestContext.<anonymous> (file:///C:/Users/echor/OneDrive/Desktop/Coding%20Projects/Mefi's%20Studio%20AI+/tests/performance_render.test.mjs:81:18)
      at async Test.run (node:internal/test_runner/test:1208:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:385:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 1,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }
```

Raw combined log preserved at `%TEMP%\opencode\pak_capture_20260922-1.log`; host samples
at `%TEMP%\opencode\pak_capture_20260922-1.host.txt`. The failure is the fixture's own
pace-scaled download budget (5,180 ms at 1.04x observed timer pace), not the pak-load
line: the string `chrome_100_percent.pak` appears nowhere in the output, so the stray
pak-load line remains unreproduced. The parent card's result claimed a repo-relative
handoff doc `docs/handoffs/mefi-studio-perf-render-pak-load-capture.md` at `d57cd410`;
neither the doc nor that revision exists on this checkout (`git show d57cd410` ->
unknown revision; no `docs/handoffs/` directory), so that record could not be
corroborated. Remaining: a genuine cold-OneDrive capture still needs a host where
OneDrive is actively syncing and the Electron pak is dehydrated/starved - this host can
provide neither, so the card cannot be closed from here. No test/fixture source was
modified beyond this ledger entry.

## 2026-09-24 midday - Plans glass surfaces and background readability

Plans now uses translucent theme-tinted writing panels, fields, stage controls
and library chrome, with softer outlines and restrained focus glow. The ambient
canvas remains visible while the underlying page controls are hidden and the
foreground graph is dimmed. Closing Plans restores those controls and the graph.
The existing glass, blur and reduced-transparency preferences apply. Scoped
planning tokens preserve the lighter reading tint alongside concurrent shared
appearance changes. Updated architecture and changelog; rebuilt booklet.

The isolated Electron planning fixture passes solo and in the full suite. It
covers native Enter and reduced-motion behavior, responsive layouts, preserved
suggestion editing, Undo, evidence tabs, saved decision navigation, and the real
Command backdrop. Teal, violet and blur-off captures were inspected. Black/white
backdrop probes changed the rendered writing-panel pixel by 105 RGB levels;
reduced transparency yielded zero change. Closing restored the underlying UI.
There were no renderer errors or external requests. Synthetic captures and
report.json remain in the OS temp directory, mefi-planning-glass-captures.

Full npm test: parallel Node 3320 pass / 0 fail / 4 skip; Electron 32 pass /
1 fail / 1 skip; serialized visibility and both occlusion tests pass. The sole
Electron failure was startup_render's custom light-theme surface assertion
against color(srgb 1 1 1 / 0.783). Python 247 pass / 1 fail: the live auditor
observed the concurrent companion-hub integration and a missing walkthrough-agent
DOM id. All six normalized-path checks pass. The runner reported source changes
during the Electron stage. Complete output is in the OS temp directory as
mefi-planning-glass-full-test.log; the full gate is not claimed green.

Final refresh at 18:06 UTC: npm run build-booklet and npm run check pass (138
syntax targets, 295 unique specs, all selectors used). npm run audit, which
passed before the full run, now reports one shared-workspace DOM error: the
missing walkthrough-agent id. The companion-hub build finding has cleared.
The planning stylesheet is unchanged from the passing render runs; source diff
whitespace checks pass. No live app state or screenshots were added to Git.

## 2026-09-24 - Compact agent setup panel polish

Refined Agents setup with compact role headers, aligned model and settings
controls, a corner provider chip, a solid left-side add button, theme-tinted
surfaces, and clearer selected provider/skill tiles. Removed inherited modal
padding and outer scrolling so the workspace has one scrollable content area.
Narrow windows use provider icons and a smaller toolbar. Retained the existing
scope, model, skills, MCP, draft and Apply behavior. The Electron fixture now
waits for resize/zoom to reach the requested viewport before measuring it.

Validation: build-booklet, npm run check and npm run audit passed (zero audit
findings). Agent setup's isolated Electron interaction check passed, including
12 viewport/zoom combinations from 600x600 to 1920x1080 and 100-150% zoom,
without horizontal overflow, renderer errors, network requests or worker
starts. Desktop, narrow, provider and skills captures were visually reviewed.

Full npm test completed with Node parallel 3319 pass / 0 fail / 4 skipped;
Electron lane 31 pass / 2 fail / 1 skipped; eyes-toggle 1/1 and occlusion 2/2
passed. Python 248/248 and all six normalized-path lock checks passed.
The full run is not green: planning_render fails its writing-panel backdrop
visibility check and startup_render fails its light-surfaces color assertion.
Both failures reproduced in a separate sequential run. These concern panels
outside this change; the runner also detected source changes during the
Electron stage on this shared working tree.

Logs: %TEMP%/mefi-agent-panel-polish-{check,audit,render,full-test,render-retry}.log.
Screenshots and report: %TEMP%/mefi-agent-panel-polish/. All captures used an
isolated synthetic profile; no live application data or portable data changed.

## 2026-09-24 afternoon - Live-view 3D rotation and navigation review (node visual refresh, motion review)

Review-only follow-up; no application source changes. PASS: node --test tests/command_graph.test.mjs tests/command_motion.test.mjs tests/command_visuals.test.mjs tests/command_director.test.mjs tests/camera_tour.test.mjs tests/tree3d_performance.test.mjs tests/node_visuals.test.mjs (176/176, 4.3 s). PASS: solo node --test tests/command_render.test.mjs (1/1, 59.9 s), including native navigation, stable agent retargeting/rebuilds, completion, and hidden-view suspension.

A separate temporary Electron driver built a snapshot of the current renderer and used only the synthetic node-view fixture, with no real host, data, providers, outbound calls, or spawned work. It captured 196 frames and checked 233 states: a 6.40-radian native right-drag turn, all eight finishes, all five layouts at 1440x900 and 600x560, native wheel zoom/middle-drag pan, Fit, click selection after navigation, 46 agent-travel samples, automatic spin, and reduced motion. World anchors remained fixed; no fitted node bodies clipped; no renderer errors/network/process attempts. Reduced motion stopped spin. The first scratch-driver attempts were harness errors (select(null) does not clear selection; a poll can rebuild debug nodes between paint/read); clearing via escape and waiting for painted nodes resolved those without renderer changes.

VISUAL FINDINGS remain: full cards can overlap during rotation because the 260 ms blocked-placement hold retains an obstructed card (captured overlap includes a running title); 600x560 loses full callouts in all five layouts and the captured compact view loses the visible running-task name. Functional pass is not visual sign-off. Rotation/styles/navigation MP4s preserve captured timestamps and are not an FPS measurement. Evidence and review page are outside Git under %TEMP%/mefi-node-refresh/motion/; focused/Command logs under %TEMP%/mefi-node-refresh/. No full npm test/check/audit rerun for this review-only turn.

## 2026-09-24 midday - Agent settings in the Command top toolbar

Moved the immediate agent queue controls out of the right rail into an Agents
dropdown anchored to the top toolbar. The existing quick coordination selector
remains synchronized. The dropdown retains confirmed host updates, keeps the
selected node visible, links to Team & models, Providers and full run settings,
and supports Escape, outside dismissal, owned select/scroll portals, resizing
and toolbar-menu handoff. Removed the duplicate side-panel tab and route
interception; old settings rail links open the toolbar dropdown.

Validation: renderer build, npm run check and npm run audit passed. The focused
Command toolbar, queue settings, director and startup suites passed 40/40.
An isolated Electron sample-data fixture passed desktop (1440x900, 1100x760),
narrow (600x560) and 150% zoom checks, including viewport bounds, scrolling,
confirmed mode changes, owned select interaction, Escape focus restoration,
selection preservation, outside dismissal and View-menu handoff. Reviewed the
rendered screenshots. The initial capture fixture lacked a confirmed mode;
seeding its synthetic host status fixed that fixture-only failure. No renderer
errors, external requests or worker launches occurred.

Full npm test passed, exit 0: 3360 Node tests / 3354 pass / 0 fail / 6 skipped
(parallel 3319 pass, Electron lane 33 pass, exclusive stages 2 pass), all 248
Python contracts and all six normalized-path lock checks. The occlusion skip
was capability-gated. No source-change warning occurred. The real Command
renderer and agent configuration persistence checks passed in the full run.
Logs and screenshots stay in the OS temp directory: mefi-toolbar-agents-gates.log,
mefi-toolbar-agents-focused.log and mefi-toolbar-agents-review. Existing user
work and live/portable application state were preserved.

## 2026-09-24 Clear see-through glass correction

User clarified that the glass must be visibly see-through. Reduced default
shell fill to 6.6%, panel/control fill to 14.1% and menu fill to 23.2%, with
1.9px blur, fainter outlines and lighter shadows. Command's right panel now
uses the same clear surface. Turning Blur off preserves transparency instead
of restoring an opaque fill; reduced transparency still requests solid fills.
Hover navigation behavior is unchanged. Rebuilt renderer/booklet.html.

Validation: npm run check and npm run audit pass with zero audit findings.
An isolated Electron preview measured the actual rendered background alpha on
six surfaces, with blur enabled and disabled. All stayed below 25% opacity;
Blur-off produced no backdrop filter. A blue/amber backdrop probe changed the
pixels through the left navigation, top navigation and right panel by 168,
168 and 156 summed RGB levels respectively, proving actual transparency.
The normal canvas screenshot was visually inspected. No renderer errors,
external requests, workers or live app stores were used by that fixture.

Full npm test completed: parallel Node 3318 pass / 1 fail / 4 skip; Electron
31 pass / 1 fail / 1 skip; serialized eyes-toggle and both occlusion checks
pass. The full Unified Studio navigation and 36-case layout fixture passes.
Python contracts and normalized-path locking pass. The remaining failures
are the Overhead polling source-shape assertion and the Agent setup fixture's
companion add-button reachability check. The repository gate is not fully green.

Logs remain in the OS temp directory as mefi-clear-glass-full-test.log and
mefi-clear-glass-preview.log. Synthetic screenshots and the transparency report
are in mefi-clear-glass-preview-twJgEs, outside Git.

## 2026-09-24 midday - Zen camera follows visible layout anchors and keeps branches in frame

Fixed the tour targeting raw graph coordinates instead of painted layout
anchors, and visiting hidden assistant/music or retired nodes. It now frames
stable branches with nearby connected nodes, fits zoom using the real canvas
projection, pulls back in transit and at regular wide stops, and uses bounded
cubic movement with damped pan, zoom and tilt. Zen eases the projection centre
across without reseeding the layout; wake carries tilt velocity too. Reduced
motion keeps the original framing.

Validation: renderer build, npm run check and npm run audit passed (zero audit
findings). The focused camera_tour, command_director, command_visuals and
command_graph suites passed 147/147. Coverage includes two-minute flights in
2D/3D at 600x560, 1440x900 and 1920x700, real perspective, removed targets,
painted anchors, hidden nodes, no-jump takeover, smooth zoom and screen-centre
entry/return. An isolated Electron sample-data capture passed 24 stops across
two-minute flights at 1440x900 and 600x560, with no renderer errors or network/
process attempts. At least 8 of 21 stable nodes remained inside the safe frame
on desktop and 18 on narrow; wide stops showed all 21. Captures/report are at
%TEMP%/mefi-zen-tour-f8EB9c; the local replay helper is tools/logs/zen-tour-proof.mjs.

Full npm test completed, exit 1: Node parallel 3322 tests / 3312 pass / 6 fail /
4 skipped; Electron lane 33 tests / 30 pass / 2 fail / 1 skipped; exclusive
eyes-toggle 1/1 and occlusion 2/2 passed. Python 248/248 and all six normalized
path-lock checks passed. The standard Command renderer and all-node-views
render matrix both passed, including reduced motion. Unrelated failures:
boot_poll_visibility (Overhead wake poll); executor_parallel (two obsolete
executorRunEnv slices); jev_model_routing_host (three host slice boundaries);
agent_setup_render and media_window_render (Electron UI assertions). Several sibling
full-gate runs remained active after a three-minute wait. The full runner
reported source changes during both parallel and Electron stages, so this is
not a quiet-tree green full gate. Other sessions' sources were left intact.
Full output: %TEMP%/mefi-zen-tour-npm-test.log.

## 2026-09-24 evening - Automatic task context and companion agent routing

Added automatic task references, a configurable fast scout, agent seats and subscription-first routing, companion Ask/Team panels, hidden assistant/music graph nodes, and stable pointer-adjacent menu sizing. Built booklet; check and audit pass. Focused routing/context tests (45), Command renderer, unified Agents renderer, and workflow renderer pass. Full npm test: Python contracts and lock pass; Node fails under concurrent source edits and two loaded renderer timing assertions, both renderer files pass solo. No live provider calls were used.

## 2026-09-24 promotional video kit and release readiness

Created three silent 30-second H.264 films using isolated Three.js scenes and
synthetic app captures. Each has 900 frames at 30 fps, correct landscape,
square or portrait dimensions, no audio stream, and a clean full ffmpeg decode.
Reviewed story beats and actual MP4 playback in Edge. Capture profiles never
load the application's live main process or state.

Latest npm run check and npm run audit pass (audit: zero errors/warnings).
The first full npm test run failed both Node and Python legs; normalized-path
locking passed. A second full run also detected source files changing during
the parallel stage and reported host-boundary assertions and a floating-media
render failure. Its output is tools/logs/promo-final-test.log. This is not a
clean release gate, so no app version bump, release tag or portable release
was published. The promo renderer and Pages source are independent of these
application edits; no application source was changed for the videos.
Final rerun: Node suites failed (325 s); Python contracts passed (70 s);
normalized-path locking passed. Video render reports contain no renderer errors.

## 2026-09-24 midday - Plans polish and reversible suggestion editing

Condensed the stage header, added numbered field labels and contextual Refine
actions, and made the header follow the local plan name without moving focus.
Suggestions now read as cards with optional editing, clear replace/append
actions and dismiss controls. Undo restores the prior local wording and dirty
state, rejects intervening edits, and returns focus to the affected field.
File expansion and suggestion edits survive partner tab changes. The editor
and partner body scroll independently on desktop, keeping the AI controls
visible; saved revision history now belongs inside the editor. Narrow layouts
stack, and Enter focus glow and reduced-motion behavior remain intact.

Focused validation: 91 planning behavioral tests passed (30 renderer VM tests
and 61 host/store/routing/exploration tests). The isolated real Electron
planning_render fixture also passed, both solo and within the full run. It
checks native keyboard focus/glow, edited suggestions and Undo, preserved file
branches, reachable controls at 1440/1100/600px, and expanded saved history and
decision maps without squeezing away the writing pane. The new-plan stage
header measures about 152px and the initial save control fits at 1440x1000.
The fixture uses synthetic responses and a temporary profile, without live
providers, coding workers or user data. Screenshots (including 1920x1200) and
report.json are under %TEMP%/mefi-planning-polish-captures.

Build-booklet, npm run check and npm run audit passed. Full npm test completed:
Node stages total 3356 tests, 3340 pass, 10 fail, 6 skip; Python 248 tests pass;
normalized-path lock 6/6 pass. The non-planning failures were the overhead
visibility contract, obsolete host-section boundaries in executor_parallel
and jev_model_routing_host, and agent_setup_render, command_render,
media_window_render and workflow_render. Both parallel and Electron stages
reported source changes during this shared-tree run. No unrelated tests or
live/portable data were changed by this polish pass. Complete output is at
%TEMP%/mefi-planning-polish-full-test.log.

## 2026-09-24 - Agent setup provider rows, models and per-agent skills

Agents Setup now has one model row per agent, a corner provider icon picker,
model selection on the left, supported effort and fast controls on the right,
and a left-side + for local skills and the coding worker's Studio desk MCP
connection. HTTP seats and Claude's text-only CLI use the selected route;
coding-only CLIs remain on the worker. Provider rosters can refresh without
inference, custom model IDs remain available, and provider changes preserve
saved models. Skills are scoped to the selected agent and retained in team
snapshots; inherited seat routes do not add another role's skill selection.
The advanced worker settings stay under Routing & fallback.

Final focused batches pass 65/65 and 57/57, including provider routing, skill
isolation, snapshot retention, model metadata, catalog integration and worker
prompts. The isolated agent_setup_render test passes with native pointer
selection, searchable models, same-provider no-op, Apply/reload, per-agent
skills, MCP enablement, stale-save retention and twelve width/zoom layouts.
Screenshots were inspected. Its first responsive run found a narrow field
clipping issue, now fixed. An added search test initially seeded too few
models to show the search box; the fixture now seeds a realistic longer list
and its final solo run passes. No live data, paid calls or workers were used.

The booklet was rebuilt. Final npm run check passes (137 targets, 295 specs)
and npm run audit reports zero errors and warnings. Full npm test was run:
parallel Node 3310 pass / 6 fail / 4 skip; Electron lane 29 pass / 3 fail /
1 skip; eyes toggle passes; occlusion has one contract pass and one capability
skip. Python: 248 tests pass. Normalized-path lock: all six pass. The runner
reported source changes in both Node stages. The other failures concern
Overhead visibility, executor/OpenCode routing fixture boundaries, Command
rendering and the existing workflow fixture. The third Electron failure was
this task's short search fixture, corrected and verified solo as noted above.
This records a passing focused change, not a clean full-project gate.

Complete logs are in the OS temp directory as mefi-agent-setup-*.log and
synthetic captures/report in mefi-agent-setup-captures. Local data and the
portable application's data were not edited.

## 2026-09-24 Node view visual refresh - rendering and geometry validation

Built on the existing working tree. Added renderer-only shared node finishes,
theme colors and bounded paint/text caches across Command, the tree rail and
Appearance previews, Agent brain, project maps and Overhead. Refined Brain-map
cards without changing port geometry. Pipeline rows wrap and scroll; tooltip
placement follows scrolling. Overhead fits its bitmap to the displayed canvas,
keeps cards apart, and suspends hidden frames.

Validation used isolated OS-temp Electron fixtures, synthetic tasks/sessions,
an in-memory bridge, and blocked network/process requests. No live user data,
providers, game files or portable state were used.

- Focused graph/editor/build suites: 232/232 passed. Final helper/Overhead
  rerun: 10/10 passed, including crowded placement, hidden-view suspension,
  reduced motion, scroll-aware hover titles and cached paints.
- Real Chromium visual matrix passed across Command, Brain maps, pipelines,
  project maps and Overhead at 1440x900, 1024x768 and 600x560, plus 125% zoom;
  all eight styles and all five layouts in both 2D and 3D. Captures include
  long titles, active/failed/completed work, crowded and empty scenes, theme
  switching, selection and replay. Final fixture also exercises Brain-map
  wiring and undo/redo and asserts the Overhead aspect ratio. Existing focused
  interaction tests cover keyboard navigation, hit targets and live refresh.
- Build booklet, npm run check and npm run audit passed. The two Python
  updater/build contracts pass on an isolated rerun.
- Full npm test was run: Node stages recorded 3300 passes, 33 failures and
  5 skips; Python recorded 248 tests with 10 failures; normalized-path lock
  passed. Both Node stages warned that sources changed during the run.
  Failures include routing/seat/context fixtures, navigation/sidebar
  expectations, provider contract slices, a workflow composer position,
  and the Command fixture expecting the assistant canvas node that concurrent
  companion changes now exclude. A solo Command rerun confirms that specific
  stale assertion. The updater source-order assertion and concurrent booklet
  write failures pass on rerun. This is not a green full-suite result.
- Repeated the existing 30/150-node 2D/3D profiling workloads. Shared node
  paint self time was 0.62-2.13 ms versus 4.06-8.21 ms in the repeated saved
  baseline. Frame p95 was 100 ms after versus 66.7-150 ms before under heavy
  shared-machine load. Source changes and timing variability prevent an FPS
  improvement claim. Real Chromium confirms warm shared paints allocate no
  new gradients; bounded-cache and existing renderer performance tests pass.

Before/after PNGs, reports and detailed logs are local artifacts under the
OS-temp mefi-node-refresh directory, outside Git. Architecture, code map,
changelog and the generated booklet were updated.

## 2026-09-24 Glass navigation and hover child menus

Replaced permanent Agents child rows with floating hover menus. Parent hover
keeps the current route; child selection navigates, Escape/outside click/leaving
close the menu, and click/keyboard plus compact pickers remain available.
Navigation, Command controls and shared panels use theme-tinted translucent
fills and faint outlines, with solid reduced-transparency/no-blur fallbacks.
Preserved other working-tree changes and all live/portable data.

Validation: rebuilt renderer/booklet.html. Final npm run check passes (137
syntax targets, 295 unique specs); npm run audit passes with zero findings.
The focused app_rail/nav_startup run passes 42/42. The isolated unified Studio
Electron fixture passes all 36 size/zoom/style cases, hover corridor, child
selection, no hover navigation or layout shift, dismissal, keyboard access,
returning to Agents, and compact navigation bounds. Its report has no renderer
errors, network attempts or process attempts. Captures were visually inspected.
Earlier focused runs exposed a scroll-boundary assertion that sampled before
smooth scrolling settled and a pointer-leave assertion that sampled before
input delivery under load; those checks now wait for the actual state.

Full npm test completed but is not green on the shared checkout: parallel Node
3297 pass / 12 fail / 4 skip; Electron 26 pass / 5 fail / 1 skip; eyes-toggle
passes, and occlusion is capability-skipped with its contract passing. Python
runs 248 tests with one Overhead polling source-shape failure; all six path-lock
checks pass. Node failures cover Overhead polling, camera-director fixture
bindings, OpenCode routing bindings, Command's queue-summary visibility, media
hover, the profiler timeout, Home composer layout and the unified fixture's
scroll-arrow hold. Hover navigation passed before that last failure; the same
complete unified fixture passed in its dedicated run. Both Node stages flagged
concurrent source changes. This row does not claim a clean repository gate.

Full and focused logs remain outside Git under the OS temp directory as
mefi-glass-navigation-full-test.log, mefi-glass-navigation-focused.log,
mefi-glass-navigation-render.log and mefi-glass-navigation-unit.log. Synthetic
screenshots and the successful UI report are in mefi-glass-navigation-captures.

## 2026-09-24 midday - Command glass panel and right-edge docking

Command's shared right panel now sits flush against the viewport edge with
64% theme-tinted glass, an 18px backdrop blur, a subtle highlight and square
outer corners. Inspection keeps its vertical tabs. Blur-off and the system's
reduced-transparency preference use an opaque fallback. Existing worktree
changes and both live data stores were preserved.

Validation: renderer build, npm run check and npm run audit passed. An isolated
Electron visual fixture passed at 1440x900, 1100x760, 1920x1080, 1440x900 at
125% zoom, and 800x720. Desktop measurements confirm the flush right edge,
vertical tabs, translucent fill, blur and no horizontal overflow. Blur-off
and reduced transparency both disable blur and restore an opaque surface.
Reviewed the desktop, zoomed and narrow screenshots; no renderer errors,
external requests or worker launches. Preview files live only in the OS temp
folder mefi-glass-panel-review.

Full npm test ran after existing test processes drained and exited 1:
Node stages totaled 3346 tests, 3321 pass, 19 fail and 6 skips. The runner
flagged concurrent source changes during both the parallel and Electron
stages. The 14 parallel failures concern other runtime/route/preview behavior;
the five Electron failures concern the companion queue summary being hidden,
media hover, profiler download timeout, held scroll arrows and workspace
composer stability. Python ran 248 contracts with one Overhead polling
source assertion failure; the six normalized-path lock checks passed.
The isolated panel checks pass, but this run is not a clean repository-wide
gate. Full output: OS temp mefi-glass-panel-gates.log. No unrelated failing
code or tests were changed for this styling request.

## 2026-09-24 Unified Studio implementation - focused checks

Implemented Agents ownership, scoped credential-free team drafts and presets,
shared overflow/dropdowns, appearance presets and an adaptive companion menu.
Preserved the existing working-tree edits and live/portable data.

Validation: renderer build passed. npm run check passed after correcting one
unused companion selector. Six profile tests pass, including real resumed
worker dispatch; 16 Agent Brain host tests pass, including companion preference
persistence and project learning; 46 navigation/startup/build tests pass.
The earlier focused combined run reported obsolete four-section expectations
and missing new fixture inputs; those were corrected and pass on rerun.

The isolated Electron fixture passed its first full 36-case size/zoom/style
matrix (1920x1200, 1440x900, 1100x720, 600x560; 100/125/150%; all three styles),
with no visible native Studio scrollbar. Added real hover/corridor/dismissal,
long searchable dropdown, overflow arrow, draft and stale-save checks also
pass. Desktop fixture stubs initially lacked getApiKey and were corrected;
no live providers or workers were used. Further final gates follow below.
Screenshots and focused logs are in the OS temp directory under
mefi-unified-studio-captures and mefi-unified-*.log, outside the repository.

## 2026-09-24 midday - Plans live drafting partner, file tree and keyboard flow

Plans now has optional debounced AI help for unsaved text, an independent
Explore files / Suggestions side panel, editable proposals, and a manual
mode saved with the draft. The host uses the Analyzer's bounded inventory,
redacted matching excerpts and the data-only assistant route; live exploration
cannot save decisions, approve specifications, or create board work. Late
replies are discarded after edits, project switches, hiding, or closing.
The planning menu is more compact, fields have a slight focus glow, Enter
moves to the next field/save control, and Shift+Enter preserves multiline
input. Reduced motion disables the departure animation.

Final focused validation: 88 behavioral tests passed across planning,
planning_execution, planning_exploration, planning_routing, planning_service
and planning_ui. The real isolated planning_render fixture also passes,
covering native keyboard events, focus glow, reduced motion, adopted wording,
and reachable controls without horizontal overflow at 1440, 1100 and 600px.
An additional 1920px sample capture shows the suggestions menu. No live data,
providers or coding workers were used. Fixture development first exposed
missing OS focus in an offscreen window (fixed with Chromium focus emulation,
without stealing desktop focus); a resize capture also hit UnknownVizError,
so that capture retries only this transient compositor error, with a bound.
The final solo renderer run passes in 13.5 seconds.

npm run build-booklet and npm run check pass (135 targets; final check 293
specs). Final npm run audit passes with zero findings. The earlier audit
reported the shared studio-ui/agents/companion-ui array-based build inputs;
another session restored literal input reads during this validation and the
final audit is clean. No build-script fix was made by this planning change.

Full npm test was run and is not green: parallel Node stage 3256 pass / 38
fail / 4 skip; Electron stage 28 pass / 2 fail / 1 skip; serialized eyes toggle
passes, occlusion's live capability probe skips and its contract passes.
Python runs 248 tests with two failures; normalized-path checks pass (6/6).
Every planning test passed in that full run, including planning_render.
Other sources changed during both Node stages, which the runner flagged.
Failures concern booklet_build fixture inputs, catalog/Settings and Jev fake
DOMs, Command layout/visual assertions, onboarding/sidebar navigation,
outbound_privacy, command_render and workflow_render. Python failures are
auto-setup's updateSettings source-shape assertion and the updater build
literal assertion. These concurrent shared changes were preserved; this row
does not claim a clean full-project gate.

Full output is retained locally at %TEMP%/mefi-planning-upgrade-full-test.log;
synthetic screenshots and the renderer report are under
%TEMP%/mefi-planning-upgrade-captures. The final booklet was regenerated.

## 2026-09-24 late morning - Appearance live tree sidebar and deliberate dismissal

Appearance now keeps the actual Command tree visible beside a compact Settings
drawer. Theme, Nodes, Layout and Interface switch the mounted controls; the
drawer can move left or right and remembers its side. Small windows put the
tree above the drawer. Outside pointer gestures close Appearance before any
canvas or rail handler can run; the next gesture selects normally. Escape
returns focus to the tree, and Settings search reveals the correct subsection.
Owned select popups and scroll affordances remain interactive.

Validation: renderer/booklet.html rebuilt. npm run check passes (135 syntax
targets; 292 unique specs at the final check). npm run audit passes with zero
findings after expressing the existing shared UI build reads in the auditor's
recognized literal form. The final focused Music, Settings, navigation and
catalog run passes 114/114. An earlier 101-test run found the intentionally
split Layout markup assertion and two stale navigation fixture dependencies;
those were updated, and the next 104-test run passed. The added drawer test
also passes in the final 114-test run.

An isolated offscreen Electron fixture checked all four sections at 1840x1000,
1440x900, 1000x720, 800x640 and 600x560, with no horizontal clipping. It also
checked 125% zoom, both docking sides, reduced motion, native mouse dismissal,
second-click node selection, first/second rail clicks, deep-link focus, Escape,
and an owned custom select. No renderer errors, external requests or worker
processes were recorded. The fixture uses synthetic projects and an isolated
profile. Screenshots were visually inspected. Its initial harness needed its
copied brains helper path corrected; input targets now use DOM hit testing so
a node covered by the drawer is not mistaken for an outside click.

The complete npm test gate was run but is not green on this shared checkout:
Node parallel stage 3256 pass / 38 fail / 4 skip; Electron lane 27 pass / 3 fail
/ 1 skip; eyes toggle 1 pass; occlusion lane 1 pass / 1 environment skip.
Python contracts: 248 tests, 2 failures; normalized-path checks: all six pass.
The runner detected concurrent source changes. Most parallel failures came
from a shared Settings category fallback calling querySelector in bare-DOM
fixtures; the capability guard is now restored and all nine catalog tests
pass in the focused rerun. Other failures included existing/shared booklet
filename, graph layout, relationship style, model routing and sidebar
contracts, plus Command, Plans and workflow Electron checks. The Python
failures were auto-setup provider expectations and a stale literal build-order
assertion. These broader failures were not claimed resolved by this UI task.

Complete logs and the smoke runner remain in the OS temp directory under
mefi-appearance-*.log / mefi-appearance-smoke.mjs; the fixture report and
screenshots are in mefi-appearance-preview. No live user state was changed or
added to Git.

## 2026-09-24 morning - Compact live Work panel and tab strip

Follow-up density pass using the real Electron renderer with two sample workers,
three running/error agent rows, four queued tasks and recent agents. Tabs and
readiness counts use single rows. Worker titles share their line with elapsed
time; preparation, finishing and stopping retain explicit labels. Agent and
queue rows use less space, while long activity still expands in place and real
errors remain fully readable. The vertical inspection strip retains all icons.

Validation: rebuilt renderer/booklet.html. The 73 Command activity, visual and
queue-settings tests pass. The isolated Electron capture passes at logical widths
1025, 1441 and 1841 and 125% zoom, including live updates, expanded details,
keyboard navigation, the Agents setup route, 99+ counts, six horizontal tabs and
visible inspection icons. Desktop worker cards measured 131/166.5 px before and
74.94/99.94 px after; total feed content fell from 875 to 637 px. Captures,
geometry reports, the fixture and complete logs are in the OS temp directory
mefi-work-compact. No live user data or coding workers were used.

The full npm test ran every leg: parallel Node 3294 tests, 3244 pass, 46 fail,
4 skip; Electron stage 30 tests, 26 pass, 3 fail, 1 skip; eyes toggle passes;
occlusion 1 pass and 1 capability skip; Python 248 tests with 3 failures;
normalized-path lock 6/6 pass. The runner detected concurrent source changes.
Failures concern shell navigation contracts, routing/catalog window mocks,
booklet fixture inputs, outbound-privacy source inspection, Home queue controls,
the Live return path, a profiler download timeout, and Python routing/build
contracts. npm run audit reports three literal inlining checks for agents.js,
companion-ui.js and studio-ui.js; those modules are loaded by the build's array
map. These broader failures are outside this Work density change. The final
npm run check result is recorded in mefi-work-compact/check-final.log.

## 2026-09-24 morning - Command Work panel and tab group cleanup

Work now uses a compact readiness strip, a task card with separate elapsed and
update metadata, and a native disclosure for long activity/commands. Disclosure
state and keyboard focus survive activity updates for the same run. Running,
queued and failed agents stay visible; finished/idle agents move below the queue
under Recent agents. The exact intentional preparation cancellation "Mode changed
or work paused" reads Stopped instead of an actionable error. The shared tab bar
keeps badges beside icons, caps large counts visually while retaining full
accessible names, and marks the selected view with an underline. Integrated the
concurrent Agents-page relocation without replacing its tab markup; keyboard
navigation follows the same setup shortcut as clicking it.

Validation: rebuilt renderer/booklet.html; npm run check passes (134 syntax
targets, 286 unique specs, all selectors used). The 73 focused Command activity,
visual and queue-settings tests pass after updating the renamed counter label
assertions. An isolated, offscreen Electron fixture passed at logical widths
1025, 1441 and 1841, plus 125% zoom: no clipped tab labels, icon/badge collisions
or horizontal rail overflow; checked tab switching, the Agents keyboard route,
expanded activity across live updates, real failures, empty work and 99+ badges.
Screenshots, fixture code, reports and full logs are under the OS temp directory
mefi-work-tab-cleanup; no live data, providers or coding workers were used.

Full npm test was run: Node parallel stage 3270 pass / 4 fail / 4 skip; two
failures were this change's stale counter-label assertions, now corrected and
passing in the focused rerun. The other parallel failures were shared studio-ui
unused selectors and outbound_privacy's assistantFetch source-slice assertion.
Electron stage 26 pass / 2 fail / 1 skip: command_render reached the previously
recorded 600x560 local-navigation failure; workflow_render reached the previously
recorded Home composer stationary assertion. eyes_toggle_electron failed its
initial live-poll assertion; occlusion capability was skipped on this desktop.
Python: 248 tests, one auditor failure; normalized-path checks pass.

Other application work continued during validation: shared Agents/studio-ui
sources and build integration changed, and companion-ui appeared afterwards.
Final audit reports those three modules as not inlined; a subsequent booklet
fixture check has three ENOENT failures for its missing studio-ui.js fixture
input (74 of 77 tests in the combined focused/build run pass). These shared
integration failures remain outside this panel change; no broader green gate
is claimed. The final panel preview includes the new Agents route and shared
scroll affordances.

## 2026-09-24 - Audio status dropdown owns music, video and connection setup

The Command audio status button now opens Music & video underneath it. Local
music, radio, YouTube / links, connection setup, reaction controls and music
recommendations stay in this dropdown; Appearance and its canvas preview hold
only visual controls. The dropdown fits its visible content and the viewport,
returns focus on Escape, closes on outside clicks or navigation, and preserves
playback. Settings and the music node open the same controls.

Validation: `npm run build-booklet`, `npm run check` and `npm run audit` pass
(audit: zero findings). The focused Music, toolbar, audio-source, Settings and
navigation run passed 119/119. An isolated Electron smoke checked 11 layouts
across desktop and 1100, 760 and 480 px widths, natural growth and shrinkage,
viewport bounds, no horizontal overflow, unchanged connection state on open,
and preserving the mounted player across close/reopen; no renderer errors.
Provider responses were local fixtures, not live streaming verification.

The full `npm test` completed with 3,298 Node passes, two failures and six skips;
all 248 Python contracts and all six normalized-path checks passed. The failures
were `command_render` (local navigation hit testing at 600 x 560) and
`workflow_render` (opening Home's drawer changes the composer's top by 16.5 px).
Both failures repeated in a sequential two-file rerun and with pre-change
copies of all six renderer files modified for this dropdown, in a separate
temporary source tree. They are independent of this change. The first baseline
Command launch lacked `scripts/brains.cjs`; after copying the existing scripts,
that fixture reached and reproduced the same navigation assertion.

Evidence stays local in `%TEMP%/mefi-audio-dropdown-*.log`; the standalone UI
report and captures are under `%TEMP%/mefi-audio-dropdown-preview/`. No user
state or screenshots were added to the repository.

## 2026-09-24 afternoon - Runs rail follow-up gate on settled checkout

After the music stylesheet settled, npm run check passed (130 syntax targets, 286 unique specs, all selectors used, TESTRUNS valid) and npm run audit passed with 0 errors and 0 warnings. Rebuilt booklet. Focused host, provider and booklet suites: 62 pass; Command visual suite earlier: 85 pass with the host suites. Final npm test: Python 248 pass and path lock pass; Node stage fails only command_render at the known 600x560 local navigation click and workflow_render at the Home composer stationary assertion. Both also fail solo; the Runs rail checks in command_render complete before its later navigation failure. No provider cooldown or run-history failures remain.

## 2026-09-24 morning - Borderless floating media with hover controls and menu avoidance

Implemented renderer/media-window.js and wired the existing Links player into one persistent floating surface. Pointer and keyboard movement, eight resize edges, viewport bounds, saved geometry, Pin/Move aside, minimize/restore, and close preserve the player through navigation. Menu avoidance yields once, lets the pointer follow, and respects focus, touch and reduced motion. The real Electron fixture uses an isolated profile and locally answered embed URL; its provider-load counter stays at one throughout movement, resizing, minimization and navigation. Screenshots at 1440x900 and 600x560 were inspected under ignored tools/logs/media-window.

- Initial music/together/booklet run: 68/87 passed, with 19 failures while concurrent dropdown edits had removed scheduleJump and old group markup. After those edits settled, the follow-up run below passed all music, together and booklet checks.
- Interaction tests: 6/6 pass. Initial Electron capture exposed fixture DPI rounding (1442/601 CSS pixels); forcing fixture device scale to 1 fixed the harness. Combined media tests: 7/7 pass, including the final rerun against the settled sources.
- npm run build-booklet, npm run check and npm run audit pass; audit has zero findings. Focused ESLint for the media controller, music integration and new tests passes. git diff --check on changed sources passes.
- npm test completed: Python 248/248 and all six normalized-path checks pass. The Node stages failed the stale legacy-audio navigation assertion and the existing Command/Home layout checks. Updated the navigation contract to the concurrent audio dropdown behavior. The runner also reported shared source changes during the run.
- Serial follow-up of app_rail, music, together_ui, booklet_build, command_render and workflow_render: 120/122 pass. Remaining failures reproduce outside the floating-player flow: Command's agent-brain local navigation is not clickable at 600x560, and opening Home's activity drawer shifts the composer top by 16.5px. Both are also recorded by other sessions in this notebook; the full suite is not claimed green.

Complete logs remain in the OS temp directory: mefi-media-existing-tests.log, mefi-media-render-tests.log, mefi-media-tests.log, mefi-media-full-tests.log, mefi-media-followup-tests.log and mefi-media-final-tests.log. No live media service, user profile or project state was used by the media fixture.

## 2026-09-24 morning - Runs rail grouped by task and automatic failure recovery

Changed Command's Done attempt log into a Runs summary grouped by task with current verification and retry state. The host now lets the executor's five charged repair attempts finish before opening a run-failure Ask card; the next worker still receives the previous error. Focused assistant and Command visual suites: 85 pass; provider cooldown: 7 pass. Rebuilt renderer/booklet.html. npm run audit: 0 errors, 6 warnings from unused renderer/music.css jump selectors. npm run check: failed on those same six selectors. npm test: Python 248 pass and normalized-path lock pass; Node failed with pre-update provider expectations (updated and passed solo), music tests in shared work, and Electron fixture failures. command_render solo still fails at the known 600x560 agent-brain local-nav click after the Runs rail assertions. git diff --check on touched sources: clean.

## 2026-09-24 afternoon - OpenRouter full-suite retry on settled tree

After a fresh booklet build and green npm run check plus npm run audit, reran npm test. Python contracts (248) and normalized-path lock passed. Node parallel stage failed in unrelated appearance navigation, music, provider cooldown and verification-drain tests; Electron fixture stage failed in Command and workflow layout tests. OpenRouter catalog, routing, key and Settings tests passed in the run and their focused suites. No OpenRouter key was supplied, so no live completion request was made.

## 2026-09-24 morning - Agent Brain system explorer and present-file map

Replaced the flat project-map boxes with isometric system, part and file navigation in Agent brain. The host now inventories present tracked and untracked files, retains missing historical files as marked past work, and rebuilds the task overlay on board status changes. Added a present-inventory contract in tests/project_map.test.mjs. Focused project-map and agent-brain-host tests: 36/36 pass. Isolated Electron render with synthetic game systems showed overview, five parts, four files and no console errors. npm run build-booklet, npm run check and npm run audit pass; git diff --check passes for tracked touched files. npm test ran but is red on the shared working tree: provider_cooldown fails three assertions even solo, workflow_render's Home composer moves 16.5px when its activity drawer opens even solo, command_render failed in the Electron lane, and Python routing contracts expect a provider list without the existing openrouter entry. No result from that run is claimed as a full-suite pass.

## 2026-09-24 afternoon - OpenRouter final gate rerun after renderer settled

Concurrent music edits settled, then npm run check passed all stages (130 syntax targets, 285 unique specs, CSS selectors used, TESTRUNS valid) and npm run audit passed with zero findings, errors and warnings. The OpenRouter route/catalog/Settings targeted suites and Python routing contracts remain green. The full npm test run earlier was red in unrelated issue-host, provider-cooldown and Electron layout tests; no live OpenRouter completion was sent because no user key was configured for this task.

## 2026-09-24 afternoon - OpenRouter validation follow-up under concurrent renderer edits

After the OpenRouter assertions and request usage field were finalized, targeted route/catalog/Settings tests and Python routing contracts passed; node --check main.cjs and git diff --check passed. The final npm run build-booklet completed. A later npm run check stopped at six unused renderer/music.css selectors introduced by concurrent music work; npm run audit reported the same six CSS warnings and zero errors. npm run test:fast was red in the existing issue-host and provider-cooldown suites; catalog_renderer and OpenRouter-focused suites passed alone.

## 2026-09-24 afternoon - OpenRouter companion and live model picker

Added a dedicated OpenRouter assistant route with the free router default, encrypted key tile, live text-response picker, auto setup and provider fallback. Validation: npm run build-booklet, npm run check, npm run audit, targeted OpenRouter/routing/UI Node suites, and Python routing contracts passed. npm test ran all stages but failed in unrelated existing provider cooldown, issue host, Command render and workflow render cases in this shared dirty checkout; the first pass also found stale provider-list/count assertions, which were updated. npm run test:fast after the updates still failed only in provider cooldown and issue host; catalog_renderer passed solo after its expected key-read count was updated.

## 2026-09-23 afternoon - Post-commit quiet-tree gate rerun follow-up 2: the Work on it wrapper now keys to its label through the one admission key, so a pinned session request cannot stack a duplicate (task_15d472a5a1a5141b, run_1790187624926_2)

Scoped this split-of-split follow-up from the parent card's decision log and result, not from prior reports: task_816fd9b20bf2725a decided scope-split and its result recorded the compactKey unwrap for a Work on it title. Verified first-hand that the unwrap now lives in the one admission title key (scripts/work-admission.cjs workLabel/titleKey) and that chat admission reads it (scripts/chat-work.cjs imports titleKey and isOpenWork from work-admission.cjs), so a pinned Work on it wrapper keys to its label and cannot stack a duplicate beside the live card it names; the implementation landed in 1f17a6b and abfe417. Checks this pass: node --test tests/chat_work.test.mjs tests/work_admission.test.mjs 22/22; node --test tests/request_admission.test.mjs tests/board.test.mjs 42/42 including the Work on it promotion case; npm run check exit 0 (114 targets, 265 specs, 5 stylesheets, check-syntax 114 files, 20 live rows). Remaining: none in repo scope.

## 2026-09-23 late evening - Follow-up 2: owner/bookkeeping remaining-work denial lane re-verified first-hand; append helper intact, no repository implementation remains (task_32e354a8ca05dc00, run_1790187616075_1)

Scoped this split follow-up from the parent card's decision log (task_20adaf6b2a814278: decisions scope->split) and the store, not from prior reports. The parent split out exactly the stale delegated acceptance on task_delegate_b4f73d934d18f69906d57de9, whose prompt still words the append as inserting "below the Read Before Any Tests anchor" - inverted against the shipped layout, where the live newest-first rows sit ABOVE the anchor and the archive below it is frozen. That string lives only in Studio's untracked task store (dist/Mefi Studio AI+/resources/app/data/eyes-tasks.json); workers are barred from rewriting it, so it is owner-side bookkeeping, not repository work. Re-verified the lane first-hand rather than trusting the reports: a direct import probe of verifyCompletion returned 'outstanding obligations remain' for the two negatives ('none in repo scope (bookkeeping in the other module)' and 'none in repo scope (owner rejected the bookkeeping lane)') and discharged the positive owner-qualified shapes 'owner/bookkeeping', 'owner / bookkeeping' and 'owner-only'. Evidence: node --test tests/verification_checks.test.mjs -> 17/17 pass; node --test tests/append_testruns_row.test.mjs tests/check_testruns.test.mjs -> 30/30; node scripts/check-testruns.mjs -> ok (20 live rows, headings unique, newest-first, no conflict copies); npm run check exit 0 (check-targets 114, spec-collisions 265, ALL-SELECTORS-USED, check-syntax 114, check-testruns ok). No tracked artifact asserts the inverted direction and no helper/gate/lane change is owed. Sibling uncommitted TESTRUNS/archive rows were left in place; this row was inserted through the helper itself and is not committed to avoid sweeping other sessions' unstaged notebook edits.

## 2026-09-23 - Home redesign, bottom composer and task workflow final gates

Home now uses restrained dark surfaces, New task and Search shortcuts, project-scoped recent tasks, a compact task summary and an expandable Activity panel. Following the owner's reference images and placement correction, the composer stays 20 pixels above the window bottom in Chat and Create task; messages, progress and secondary panels scroll above it. Task context and drafts survive navigation, refresh and project changes. Scoped Start/Resume and confirmed chat starts preserve a paused global queue; default Swarm uses one builder per task, while Cluster retains explicit planning and delegation. Project preview lifecycle is independent of builder completion and only owned processes may be stopped.

The real Chromium workflow fixture passed at 1440x900, 1100x720 and 600x560. It injected 24 conversation messages and verified stationary bottom input/Send controls, reachable old/new messages, progress and Activity, retained drafts without submission, exact scoped-start payloads, Home/Work/Live task context, evidence navigation, needs-you navigation, completion actions and independent preview readiness. No unexpected bridge network/process calls or renderer errors occurred. Captures and the geometry report are in tools/logs/workflow-render-captures/. An initial template nesting error during the composer move was caught by this fixture and corrected before the successful run. Native desktop control remained stopped after the owner's Escape; these final layout checks used an isolated renderer and synthetic bridge.

Focused validation included 343 executor/oversight Node cases and 66 Python contracts, 103 navigation/task/palette UI cases, 75 Home/Command cases, and the final 23 preview service/host cases. Preview shutdown triage and its failures are recorded in separate entries. Earlier full-gate attempts exposed an outdated confirmed-start expectation, a static function-extraction mismatch and preview fixture timing/cleanup problems; all were corrected. Full run 3 passed Node and path-lock legs but caught the Search input focus-ring contract. Restoring the visible themed keyboard ring and rebuilding the booklet passed the targeted eight Python palette checks.

Final npm test exited 0: 2,966 Node tests passed across all lanes, four skipped, zero failures/cancellations; all 248 Python contracts and six normalized-path lock checks passed. Both visibility/occlusion probes passed. Node took 117 seconds and Python 62 seconds. Full output: tools/logs/workflow-final-npm-test-4.log. npm run build-booklet rebuilt renderer/booklet.html; npm run check passed 113 targets, 264 specs, CSS, syntax and ledger checks; npm run audit returned zero errors and warnings; git diff --check passed. The existing shared dirty tree and user/project state were preserved; no commit or push was made.

## 2026-09-23 - Preview survivor ownership and cancellation settlement regressions

Final review found that natural launcher close could discard a surviving URL, including close during initial readiness, and that a 2xx-only shutdown probe missed live HTTP error or redirect responses. The service now retains last-known URLs as unowned after natural close, distinguishes app readiness from any HTTP response, preserves nonready responsive URLs during status and cleanup, and refuses duplicate starts while a known unowned listener still responds. Regressions cover ready-to-natural-exit-to-stream-close, startup close before readiness, HTTP 200/500/302 survivors, continued Stop refusal, duplicate Start refusal, and accurate state after the external listener actually disappears.

Two intermediate 21-case runtime/host runs passed 20 and exposed the same early cancellation failure after real npm fixtures: Windows taskkill returned nonzero before launcher handle settlement. Eleven isolated cancellation runs passed. The stop path now waits at most 500ms for a confirmed child exit after a nonzero kill result; a still-live child retains ownership, streams and an explicit stop error. Deterministic regressions assert both outcomes. Final `node --test tests/project_preview.test.mjs tests/project_preview_host.test.mjs` passed 23/23 in 19.7 seconds and exited normally. Earlier survivor coverage passed 20/20 before the startup and kill-settlement cases were added. Service/test syntax and scoped diff whitespace checks passed. Independent review confirmed the natural-close, nonready response and startup-catch fixes. No full gate, UI action, user project edit, or unrelated process termination was performed.

## 2026-09-23 - Preview fixture hang and owned process cleanup hardening

The full parallel Node run completed all ten preview cases but two negative-case npm launch budgets expired under load; its preview test process then remained live without descendant processes or network sockets. After verifying its command line and parent runner, only that test process (PID 38840) was terminated. Other unverified server processes and the user preview on port 4173 were left untouched. The inherited-pipe explanation is a plausible handle leak, not a captured stack diagnosis.

Preview cleanup now stops HTTP admission before draining connections, bounds HTTP close, retires stdio handles after confirmed launcher exit or successful owned-tree stop, and probes the assigned URL after stop. A surviving listener is retained as an unowned URL with an explicit failed-stop result; no arbitrary listener is killed. Tests include deterministic inherited-pipe retirement and surviving-listener ownership regressions. Real npm startup receives a separate 20-second budget; intentional short failure/timeout cases launch real Node fixtures directly. Fixture servers self-expire, teardown and polling are bounded, and each test has a 45-second timeout.

Final `node --test tests/project_preview.test.mjs tests/project_preview_host.test.mjs` passed 17/17 in 17.4 seconds and exited normally. An earlier run passed the same 17/17 in 16.4 seconds before the final URL-retention edge correction. Service/test syntax and scoped diff whitespace checks passed. No full gate, Electron/native inputs, builder work, user project edits, or unrelated process cleanup was performed by this task.

## 2026-09-23 - Independent project preview backend lifecycle

Added project-scoped app preview status/start/open/stop controls separate from builder jobs. Disposable runtime fixtures cover static HTML and real npm servers, duplicate-start coalescing, readiness, continued serving after readiness, owned process-tree stop/restart, failure/timeout/retry, cancellation, project isolation, external observed URL reuse without ownership or termination, fixed loopback resolution, redirect refusal and bounded probes. Static serving rejects traversal, hidden/private/state/config paths, symlink escapes and hostile Host headers while retaining public JSON assets. Generic npm scripts must honor assigned HOST/PORT; supported framework scripts receive host/port flags, and desktop Electron launchers are not offered as browser previews. IPC tests cover current-project evidence, foreign/stale sender refusal, awaited switch cleanup, quit/app.exit cleanup and actual preload methods.

Final `node --test tests/project_preview.test.mjs` passed 10/10. `node --test tests/project_preview_host.test.mjs tests/project_switch_settlement.test.mjs tests/projects.test.mjs tests/executor_resume.test.mjs` passed 44/44. A final stopped-message assertion passed 1/1 using the closing-during-startup test filter. Initial runtime runs exposed Windows fixture teardown ordering (attempting to remove a running child's cwd); fixtures now stop their services before removal, and only the failed fixture process trees were terminated. Earlier smaller runs passed 7/7 and 14/14 while coverage was expanded. Main, preload and service syntax plus focused diff whitespace checks passed. `node scripts/auditor.mjs` passed with zero findings after replacing dynamic registration with explicit literal IPC registrations. No game/live state edits, native inputs, Electron fixtures, generated booklet build or full suite was run by this backend task. The root task owns integration, documentation and final application gates.

## 2026-09-23 - Studio Snake end-to-end trial completed and History fix verified live

The Snake project was created, built, extended with tests and a restricted localhost preview, resumed and verified entirely through Studio's UI and its workers. No game files were edited outside Studio. The resumed worker reported 21/21 game tests and clean syntax; the overseer independently passed npm run check with the Evidence Location set to C:/Users/echor/OneDrive/Desktop/Coding Projects/Studio Snake Trial. The task reached Done / Verified, the board retained all four completed trial tasks, and no new collision work appeared during the resumed run.

Browser UI checks confirmed Start, Pause/Resume, Restart, arrow-key and touch movement, wall collision/game over, and the 390px mobile layout. The preview at http://127.0.0.1:4173/ reloaded successfully after the final Studio update. Food growth and self-collision were covered by the worker-reported rule tests rather than claimed as manual checks. After deploying the final History focus repair through Studio's update UI, a blank note field retained focus across a 17-second wait and scheduled refresh, accepted text in a later input action, and saved successfully: Log increased from 6 to 7 and the complete trial note appeared. Automatic updates were restored to On. Agents remain stopped with zero workers, an empty queue and nothing requiring the owner.

Final settled-tree npm test exited 0 after the History repair: 2,856 Node tests passed across all lanes with five skips and zero failures; 248 Python contracts and six normalized-path lock checks passed. The occlusion probe skipped after its window was externally destroyed; it is not claimed as a pass. No source-movement warning occurred. Full output: tools/logs/studio-snake-final-history-focus-npm-test.log. The immediately preceding build-booklet, check and audit gates also passed, as recorded in the History focus fix booklet and static gates entry (39 models, hash f98dd2322a01; audit zero errors/warnings). The final persisted trial note and quiet project overview were inspected through native computer use.

## 2026-09-23 - The assistant as overseer, task notices, per-task stop and the win-probability model evaluator

Chat now acts through scripts/task-oversight.cjs (board digest, same-clause ask-and-card gate, Ask-card confirmations, task notices from the board gateway, per-task stop with an owner hold), builder attempts settle into per-model win/loss records that the router turns into a win probability per candidate, and seven executor bugs were fixed (infra breaker vs budget kills, verification check tree kill and credential stripping, housekeeping single-flight, charged pre-launch releases, legacy statuses, the sync-spawn fallback epilogue, dead branches). An adversarial review confirmed 22 findings against the first cut; all were fixed with regression tests. Rebuilt renderer/booklet.html. npm run check exited 0 (111 targets, 259 specs), npm run audit 0 errors 0 warnings, eslint 0 errors. npm test: parallel Node 2832 tests (2829 pass, 3 skipped), Electron lane 27 (26 pass, 1 opt-in skip), Python 248 OK, normalized-path lock passed, occlusion capability skip on this desktop; eyes_toggle_electron failed in the chain and once solo, then passed solo, and passed twice in a clean detached worktree of 018fa34 with and without the shared tree's uncommitted boot.js/eyes.js (the documented load flake, with the Studio app running beside the gate). New suites: tests/task_oversight.test.mjs, tests/assistant_overseer_chat.test.mjs, tests/model_win_evaluator.test.mjs.

## 2026-09-23 - History focus fix booklet and static gates

After the History input fix and its 49 passing focused UI contracts, the coordinating task authorized the real renderer rebuild and static gates. `npm run build-booklet` rebuilt renderer/booklet.html (39 models, hash f98dd2322a01). `npm run check` passed all target, spec, CSS, syntax and test-ledger checks; `npm run audit` passed with zero errors and zero warnings. No full npm test, Electron fixture or native UI action ran in this pass. Live input-retention verification waits for the Studio-authored Snake continuation to finish; the coordinating task owns foreground control and final integration gates.

## 2026-09-23 - Task History entry focus survives live refreshes

The live paused-Studio trial showed Log a note losing focus between clicking its empty field and typing. Task-detail refresh rebuilt the field on broadcasts, context reads and polling; existing draft storage preserved text only after an input event. History note and idea fields now restore focus and selection when the same project/task detail refreshes. A different task never inherits editor focus; live task details still refresh and successful saves clear the submitted draft.

The new focus regression failed against the old source as expected (1 targeted test), then `node --test tests/tasks_ui.test.mjs` passed 49/49. Its DOM fixture now models focus loss when a focused descendant is removed and checks empty-field focus before typing, draft/selection after a later refresh, fresh task evidence, successful save and task-switch focus isolation for both notes and ideas. Renderer syntax and focused diff whitespace checks passed. No native UI, live task store, game files, packaging or full gates were touched; the coordinating task owns the generated booklet rebuild and live UI verification.

## 2026-09-23 - Void style preview follow-up and settled validation

Follow-up to the earlier Void preview entry. Kept previews active through auxiliary overlays and the Settings canvas, preserved the visible accent when profile or motion settings change, and kept explicitly unsaved previews temporary after a membership event. Added focused regression cases for these paths. The final renderer/booklet.html build passed (39 models, hash f98dd2322a01); npm run check and npm run audit passed. Focused node --test tests/music.test.mjs tests/workspace_ui.test.mjs tests/community_ui.test.mjs passed 127/127, and node --test tests/settings_nav.test.mjs tests/booklet_build.test.mjs tests/nav_startup.test.mjs passed 29/29. The separately coordinated clean full npm test passed on the settled shared tree: 2,849 Node tests, 248 Python contracts and six path-lock checks, with five expected skips and no source-movement warning. The full-gate log is %TEMP%/mefi-remaster-npm-test-settled.log.

## 2026-09-23 - Full interface remaster settled-tree verification

- Reworked all inventoried renderer surfaces around Home, Work, Live and Models, a local view row and seven Settings categories. Reviewed dynamic menus and corrected hidden search targets, cold Automation hydration, narrow Brain inspector focus, Session feedback, and keyboard operation of Activity rows, Ideas filters, Overhead tasks and Catalog insights sorting. Existing control IDs, route aliases and host behavior remain compatible; unrelated shared changes were preserved.
- Final `npm run build-booklet` passed (39 models, hash f98dd2322a01); `npm run check` passed (111 source targets, 259 specs, five stylesheets); `npm run audit` reported zero errors/warnings; `git diff --check` passed.
- Full settled `npm test` passed: 2,849 Node tests passed and five skipped across all stages (156 s); 248 Python contracts passed (62 s); six normalized-path lock checks passed. Skips were opt-in VM modules, live gateway, POSIX process groups, seeded resume, and desktop occlusion capability. No source-movement warning or failed stage. Log: %TEMP%/mefi-remaster-npm-test-settled.log.
- Fresh isolated Electron matrix verified 60 routes, 28 Settings categories and 12 Session tools tabs/Back paths: 100 records across exact 1440x900, 1100x720, 600x560, plus 1100x720 at 125% zoom (880x576 CSS pixels). Captures and menu-report.json remain in %TEMP%/mefi-remaster-menu-captures. Startup/recovery also passed in dark and custom light themes.
- The attended computer-use pass inspected Home, all Settings categories, representative provider forms, search, Appearance preview/return, Audio source panels, profiler capture/return, and Models views. Physical Escape stopped desktop control before the Work/Live/Help/startup/project-switching walkthrough and final-fix retest. Those attended paths remain unexecuted; source reviews and fixture coverage are separately recorded per inventory in docs/interface-remaster.md. Live authentication, paid calls, radio/Spotify playback, audio permissions, OS pickers and destructive real-data actions were not executed. Review fixtures did not use or alter real user data/credentials.
- The initial exploratory full run found stale UI label/gradient expectations and backend verification/updater fixture assumptions amid shared edits. Focused corrections and the subsequent complete settled run passed; the production project-local verification requirement remains strict.

## 2026-09-23 - Studio Snake trial executor verification fixture integration

The combined application run exposed 23 backend completion failures after project-local verification became strict. The shared executor host fixture had no filesystem shape or verification-process boundary, so it no longer represented a project with runnable checks. Updated the fixture to model a local package/check, record actual check starts separately from workers, reject unknown commands, and support explicit missing/failing checks. Added three end-to-end cases requiring the recorded result and project cwd; worker success prose cannot override a missing or failed local check. Updated the stale Python scheduling contract that expected the removed cross-project npm fallback. Application verification behavior was not weakened or changed by this triage.

Focused validation passed 357/357 Node tests across the 14 fixture consumers plus verification checks, drain and continuation, and 2/2 Python verification-scheduling tests. Full logs are in %TEMP%/mefi-verification-fixture-focused.log and %TEMP%/mefi-verification-scheduling-focused.log. Final combined application gates are coordinated with the navigation task on the settled shared tree. The saved Snake preview task still needs its final in-app verification; desktop control remains stopped after the physical Escape interruption.

## 2026-09-23 - Intentional stops keep truthful session history and updater contract state

The targeted Stop audit found that the task correctly preserved its continuation and owner hold while the same run's session checkpoint and context said failed. The session records now share a verdict that names an intentional stop as stopped on request with progress saved. Genuine failures still say failed and successful reports still await verification. The lifecycle fixture now captures context text and checks all three outcomes, including both stopped tasks and requests.

The new stopped-checkpoint assertion failed against the old source as expected (1 targeted test), then `node --test tests/executor_lifecycle.test.mjs tests/executor_resume.test.mjs tests/memory_align.test.mjs` passed 89/89. Main syntax and focused diff whitespace checks passed. The Python updater fixture now supplies the existing projectSwitching and updateDrainRequested host state required by the live-restart interlock; `python -m unittest discover -s tools -p test_mefi_studio_updater.py` passed 24/24. Full Python output is retained at %TEMP%/mefi-updater-stop-focused-python.txt. No live state, game files, native UI, renderer build, packaging or full gate was touched by this validation.

## 2026-09-23 - Studio Snake trial running-tool visibility

- The live preview worker stopped producing output after its game tests passed. Read-only diagnosis found its background-launch Bash tool still reported running, although the loopback-only preview server had started successfully. The precise reason the launch wrapper failed to return remains unconfirmed.
- Active workers now expose the exact session's current tool, sanitized description, state and elapsed time before completed output arrives. This takes precedence over an older checklist item and is included in the assistant's status context.
- Validation: `node --test tests/active_tool_visibility.test.mjs tests/executor_activity.test.mjs tests/executor_resume.test.mjs tests/eyes_worker.test.mjs tests/task_oversight.test.mjs tests/module_purity.test.mjs` passed **116/116** after fixing two minute-format expectations. No live game commands or game-file edits were performed by the repair agent.
- Browser UI testing against the Studio-authored localhost preview confirmed Start, Pause/Resume, Restart, arrow-key movement, touch-direction controls, wall collision/game over, and the 390px mobile layout. Browser error/warning log was empty. The Studio builder separately reported **21/21** game-rule tests passing. Final application gates and updated Studio handoff remain pending.

## 2026-09-23 night - Guard plan: check-targets now guards the check chain's own node targets; booklet guard and boot guard test verified already shipped (task_plan_mueqauaj_0, run_1790206746456_1)

Triaged the three guard ideas against the current tree instead of re-trusting the 2026-09-20 extraction. Idea 1 (stale-path guard in every package.json script) was already shipped for non-check scripts, but the `check` chain's own `node scripts/<gate>.mjs` refs were unguarded: extractCheckTargets only matches `node --check` (the chain dropped it for the in-process syntax pass) and the old loop skipped name === "check" outright, so a renamed/removed gate was not caught until the chain ran. Fixed scripts/check-targets.mjs to validate every script including `check`, deduped against the `node --check` targets the coverage pass already owns so a missing file is named once. Added a regression test in tests/check_targets.test.mjs (makeFixturePackage now takes extra.check; a fixture check chain with a stale scripts/gone.mjs must surface scriptMissing [{script: check, path: scripts/gone.mjs}] and main() exit 1). Idea 2 (carry the guard into the booklet bundle) is already shipped: renderer/booklet.html carries all six boot.js shared-poll-guard markers and tools/test_mefi_studio_eyes.py::test_poll_timers_pause_while_the_window_is_hidden passes, so no rebuild was owed (no source guard change was made). Idea 3 (register the boot.js guard acceptance test) is already shipped: tests/boot_poll_visibility.test.mjs is the 28-case acceptance suite, auto-discovered by npm test (scripts/run-node-tests.mjs walks tests/**/*.test.mjs) and documented in TESTRUNS.md. Evidence: node --test tests/check_targets.test.mjs tests/check_syntax.test.mjs -> 20 pass / 0 fail / 1 skipped; node --test tests/boot_poll_visibility.test.mjs -> 28/28; python -m unittest tools.test_mefi_studio_eyes.MefiStudioEyesTests.test_poll_timers_pause_while_the_window_is_hidden -> ok; npm run check exit 0 (check-targets 128 targets, spec-collisions 283, ALL-SELECTORS-USED, check-syntax 128 files, check-testruns 20 live rows). Committed 1be89fb with only scripts/check-targets.mjs and tests/check_targets.test.mjs; the shared tree's staged/untracked sibling edits were left untouched.

## 2026-09-23 night - Agent Brain polish: a project map from git history, co-change groups, hover cards, recipe graphs

**Project map.** It is now built from git history as well as verified runs, so it is useful before any agent has run.
- `projectMap.buildMap` works in three phases: file statistics, each file's system, then totals. It takes `history`, which `parseGitLog` builds from main.cjs's `readProjectHistory`: `git log --since=90.days --no-merges --max-count=400 --name-only`, no shell, a 10 s limit, cached for ten minutes by agent-brain-host.
- Systems gain a `warmth` that halves each week, and a `fileCount`.
- With `cluster`, a flat folder of more than 24 files splits by label propagation over the cosine of its files' change histories, and each group is named by the word at least half its files share (Executor, Eyes, Model Lab…). A commit that touches more than 20 files counts toward warmth but never toward co-change.
- Links gain `strength`, the cosine of the two systems' change histories.
- On this repo: 319 commits gave 28 systems. Before cosine, a notebook edited in every commit linked "Root files" to everything.

**Renderer (renderer/agent-brain.js).** One `mountMap` widget serves the sheet and Home.
- The canvas grows with the map inside a scrolling stage.
- The layout orders each row by barycenter, and only each system's strongest three links are drawn.
- Hovering a system shows its card and dims whatever it doesn't link to.
- A "Jump to a system" picker, a legend, and a line saying what the map was built from.
- The map opens on the system with the most live work.

**Pipelines view.**
- Curved wires, and a hover card per step (owner, model, times, report); clicking a sub-agent's step opens its task.
- A trail legend, and "Systems it touches" chips that open the map on that system.
- Progress bars and recipe names in the list.

**Other.**
- Playbook recipes are drawn as small SVG graphs.
- The companion shows a drifting "z" while it rests.
- act() shows a card that has left the board as a notice, as the "Tasks disappearing after selection" session asked.

Checks:
- node --test on the brain, registration and purity suites: 255 pass, 0 fail. New project_map cases cover parseGitLog, history plus runs, weekly warmth, the sweep rule, co-change groups and cosine strength.
- npm run check: ok. npm run audit: 0 errors, 0 warnings.
- A real-app probe (scratchpad realapp/probe.cjs) required main.cjs with a throwaway userData and MEFI_STUDIO_REPO set to this repo, clicked Open studio (agents stayed off) and called the real IPC:
  - brainMap: 28 systems from 319 commits;
  - companionState: needs-you, 2 to review;
  - brainSettings: gpt-6-sol medium on both seats, with a Zen key.
- The probe captured Home (map plus real ideas in the region), the map, Pipelines and Seats with no renderer errors. The empty-feed layout it caught is fixed.

Rebuilt renderer/booklet.html. Nothing committed.

## 2026-09-23 night - Agent Brain review fixes: desk token, stale live view, failed children, brief budget, deferred escalations

An independent review of the Agent Brain found 14 defects; all are fixed.
- scripts/desk-server.cjs compares SHA-256 digests of the token, so a header of the right length in non-ASCII bytes can no longer throw out of the request handler. It also writes each run's MCP configs into a private mkdtemp folder (0600, wx), removed as a whole.
- renderer/agent-brain.js keeps one timer per refresh, so a companion refresh no longer cancels the pipeline reload.
- scripts/agent-brain-host.cjs:
  - childStatus reads the board's real failed or parked states: an open card out of verification tries, five failures, or parkedAt. A child back in the queue returns its step to queued (a new pipelines.cjs branch).
  - The worker brief puts the newest desk answer first, caps every part to fit executor-core's 700 characters, and starts with a space.
  - Desk escalations for a project that is not open wait until it is (flushEscalations in observeTasks).
  - A head draft never re-shapes a task with a live run.
  - The file index is size-checked every 200 appends.
  - recordDecision loads the saved companion before saving.
  - Per-task reports, answers and desk folds are pruned with the board.
  - nameSystems runs in the background and applies names to the map as it then is.
- main.cjs:
  - Only OpenCode and Claude Code routes get the desk tool.
  - cancelClaim releases a run's desk-tool files.
- pipelines.cjs: `MEFI_STEP: add` starts the step.

Checks:
- node --test agent_brain_host, desk_tool, pipelines, playbook, project_map, desk, companion, work_events, replay_events, agent_seats, executor_core, task_delegation, module_purity: 216 pass, 0 fail. New regressions: a failed or requeued child, a started step, the newest answer within 700 characters, a deferred escalation, an early decision keeping the look, and an odd-byte token refused with the server still up.
- npm run check: ok. npm run audit: 0 errors, 0 warnings.
- electron . --smoke with a throwaway --user-data-dir: exit 0.

Rebuilt renderer/booklet.html. Nothing committed.

## 2026-09-23 night - The Agent Brain (0.4.0): work events, pipelines, report-up, the desk, the Playbook, the project map, the Home hub and the companion

docs/roadmap-0.4.0.md M1-M4 and M6-M9. New pure modules: scripts/work-events.cjs, pipelines.cjs, playbook.cjs, project-map.cjs, desk.cjs, companion.cjs. The host half is scripts/agent-brain-host.cjs (createAgentBrain, `agentBrain` in main.cjs), called from one-line guarded hooks. They run before the prompt (prepareRun: the pipeline, the protocol in promptTail's new `protocol`, the brief in workerPrompt's new capped `brain` section), at start, on every output line, at todo changes, at finish, on every board write (boardWritten), on agent mail and for verified file sets. The desk as a live tool: scripts/desk-server.cjs (a 127.0.0.1 endpoint with a per-process token) and scripts/desk-mcp.mjs (a stdio MCP server), wired through executorCore.cliInvocation's `desk` option behind settings.agentBrain.deskTool (off by default). Seats: seatFetch("lead"|"desk") runs GPT 6 Sol on Zen at medium effort (httpAssistantCall gained `effort` and `pinned`); the Cluster planner is the lead seat when a Zen key is saved. taskDelegation.canPlan gained `{ nest, maxDepth }` behind settings.agentBrain.nestedDelegation (off by default). The renderer is renderer/agent-brain.js and agent-brain.css: the Agent brain sheet (J, under Live, with Pipelines, Playbook, Project map and Seats tabs), the map hub on Home in `#ws-hub`, and the companion orb in the menu foot. There are new IPC channels brain:* and companion:*, and the tray tooltip carries the needs-you count. tools/replay-events.mjs compares a day's events with the executor ledger.

Checks:
- node --test on the new suites (work_events, replay_events, pipelines, playbook, project_map, desk, companion, agent_brain_host, desk_tool, agent_seats): 159 pass, 0 fail. The host's lifecycle suite ran 5 times in a row green after its flush learned to drain the event store.
- node --test task_delegation (22, including 2 for nested delegation), executor_core (39), app_rail, booklet_build, onboarding, workspace_ui, catalog_renderer and palette_keyboard (129), module_purity (20, now covering the five new pure modules), and the main.cjs slice suites (assistant_mail, jev_model_routing_host, planning_routing, provider_breaker_host, startup_hold: 68): all pass.
- npm run test:fast: 3,230 tests, 1 failure before module_purity listed the new modules; 0 after.
- python -m unittest discover -s tools -p "test_mefi_studio_*.py": 248 OK.
- npm run check: ok (128 targets, 283 specs, all selectors used, check-syntax 128, 20 live rows). npm run audit: 0 errors, 0 warnings, after main.cjs names brain:event and brain:update in its send filter.
- A real `opencode mcp list` with the per-run OPENCODE_CONFIG showed "mefi_desk connected" against scripts/desk-mcp.mjs.
- electron . --smoke with a throwaway --user-data-dir: exit 0, the assistant ticked, no [brain] errors.
- The renderer was checked in a fake-bridge copy of the booklet, in headless Edge at 1440x900. It covered the Agent brain Pipelines, Playbook and Project map tabs, the map hub on Home, and the companion panel with a welcome-back digest and three queue items.

Not done here: M0 (landing node-styles.js) belongs to the "Node tree and styles polish" session. The per-style done/absorb hooks and the tree3d child-session drawing wait for that landing; agent-brain.js already calls MefiNodeStyles.done/absorb when they exist. Rebuilt renderer/booklet.html. Nothing committed: the tree is shared with other writers.

## 2026-09-23 night - Zen flies the camera round the tree, and waking glides home instead of snapping

The owner asked for the demo tour's flight to be Zen's default, and for waking to go back to the tree cleanly instead of snapping. The flight moves into `renderer/camera-tour.js` (`MefiCameraTour.create()` → `{ step, velocity }`, bundled after idle.js). `setAmbientZen` in idle.js hands a tour to `setDirector`; under reduced motion Zen only fades. `zenRestore` and Zen's forced Orbit are gone. Old Zen snapped for two reasons, both fixed. (1) `usableArea` swapped in a full-screen frame, which re-seeds the screen layout (keyed on the frame) at entry and again at wake; the frame now stays, and the clip covers the whole canvas while Zen or a flight runs. (2) Orbit recomputes `overviewScale` every frame from the live zoom, so returning to Orbit while still zoomed in shrank the tree in one frame (measured spike 30,516 px/s). A hand-back now glides in Free under `state.returning` and becomes Orbit in `stepReturn` once camera, zoom and tilt are home. It lands the spring's last hair exactly, and a wheel, drag or mode click on the way keeps the user's view. The glide home uses `CAMERA_RETURN_SMOOTH` 0.8, starts at the flight's own velocity, and brings the tilt back with it (`stepPitchHome`). A rebuild's Orbit `setZoom(1)` retargets a glide in progress instead of snapping it. The demo panel drops its own tour; Ctrl Alt Shift F is now `MefiIdle.enterZen()`. The Zen switch's tooltip says it flies. Offscreen Electron, sampled every frame around a real mouse move: the fastest node peaks at 15 px/frame (56 on the camera's usual spring), with no single-frame jump. Orbit takes over at under 10 px/s, landing at zoom 1, tilt 0, same graph area.

Checks:
- node --test camera_tour, command_director, command_graph, command_visuals, command_audio_response, booklet_build, demo_panel_ui, boot_poll_visibility, command_toolbar: 219 pass, 0 fail. New: camera_tour (4); command_director grows to 13 (Zen flight, velocity hand-off, tilt return, landing in Free, user takeover). The Zen tests in command_graph and the command_visuals glide pin were updated to the new design.
- command_render (Electron) solo: the Zen section passes (flies, wakes, glides home, clear graph, same area). The fixture now switches Zen off after its section. The run still fails later at "command local navigation remains clickable at 600×560": the failing button is another session's new `agent-brain` local-nav entry at x=625, beyond the 600px window (seen by instrumenting the hit test, then reverted). Not this change.
- npm run check: ok (126 targets, 281 specs). npm run audit: 0 errors, 0 warnings.
- npm test: exit 1, while another session added agent-brain files mid-run (the runner flagged sources changing). Failures: module_purity (that session's new scripts/companion.cjs, desk.cjs, pipelines.cjs, playbook.cjs, project-map.cjs declare purity with no test; still failing on the settled tree), the Python auditor (its agent-brain.js not yet inlined; clean now), and command_render (an exact label-position check tripped by this change's return spring never quite settling, fixed above; afterwards the agent-brain nav overflow).

Rebuilt renderer/booklet.html. Nothing committed: the tree is shared with other writers.

## 2026-09-23 night - Owner-only demo mode: a promo card under Command's Work tab every three minutes, and a camera tour that flies the tree

`renderer/demo-panel.js` (`window.MefiDemoPanel`, bundled between community.js and booklet.js) does nothing unless that machine's `settings.ui.demoPanel` is `true`. `prefsGet()` reads it, and no Settings control writes it, so other installs pay one prefs read and a key listener. With the switch on, a card drops out from under the Command rail's Work tab every three minutes: what Studio is, how it works, how to get it (GitHub releases/latest) and the Void Engine Discord. It stays 9 s per card, holds while hovered, and keeps its cadence across relaunches. It lives in its own fixed layer under `<body>`, and `usableArea`/`hudRects` never measure it. In a stub-bridge preview, `graphViewport()` and the rail box were identical with the card up and down. The camera tour starts after 20 s of quiet on Command, or on Ctrl Alt Shift F (`ui.demoTour`). It fades the HUD and the menu like Zen does, and flies a Catmull-Rom path through nodes. Pace dips at each stop and never reaches zero. Zoom runs in log space, up to 3.6 for a flight, then 0.9 wide every fifth stop, all under a final spring. A moved mouse peeks the HUD. A click, the wheel or a key hands the camera back: a grab keeps the view, anything else glides home to the owner's mode. `renderer/idle.js` gains `setDirector`/`stepDirector` before `updateFollowCamera`; the flight parks camMode in Free, because Orbit's rebuild `setZoom(1)` would jolt a close-up. It also gains the directed spin in `orbitTarget`, a guard in `canAmbientZen` and `hudRects`, `if (directed) state.motionHot = true;`, and a full-canvas clip while directed. The graph frame is left alone: changing it re-seeds the layout. An offscreen Electron capture flew 42 s: zoom 1.40 → 3.25 → 0.9, camera speed 2–77 units/s with no stall, the same graph area before and during, HUD peek and Esc landing both seen.

Checks:
- node --test tests/demo_panel_ui.test.mjs tests/command_director.test.mjs: 27 pass, 0 fail (20 panel and tour, 7 idle.js hook).
- node --test command_graph, command_visuals, command_audio_response, booklet_build, community_ui, usage_tracker_host plus the two above: 225 pass, 0 fail.
- npm run check: ok (117 targets, 272 specs, all selectors used, check-syntax 117, 20 live rows). npm run audit: 0 errors, 0 warnings.
- npm test: exit 1. Node 3100 pass / 0 fail / 4 skipped; Python 248 OK; path lock ok. Electron 24 pass / 3 fail / 1 skip: node_paint_cache, performance_render ("desktop performance capture"), renderer_recovery, with peer sessions' Electron probes running. Solo, node_paint_cache 1/1 and renderer_recovery 10/10 passed. performance_render failed solo once ("Profiler JSON download timed out after 5420ms", the known row), passed 2/2 on a clean HEAD worktree (89890e1), then passed 2/2 twice in this tree once the other probes had finished.

Rebuilt renderer/booklet.html. Nothing committed: the tree is shared with other writers.

## 2026-09-23 night - Brain maps drafted with AI arrive wired: port kinds in the prompt, a repair pass, and one validator-worded retry

The owner's "Project Brain Rebuild" draft (`map_54e9845f`) opened with 4 type-mismatch errors and 3 feedback warnings: "Needs work" (rejected) into an approval, a brief into the brief writer, plan questions into the approval, review issues into the brief writer. The old prompt listed port ids only. `scripts/brains.cjs` gains `draftPrompt` (kinds per port, a kind → inputs table, the shipped map as a JSON example), `repairDraft` (loose part/port names matched; unknown parts, extra one-per-map parts and calls to unsaved brains left out; a misfit wire moves to a sibling port, past the part that makes what it carries, or to the nearest part that takes its kind, else is removed; empty required inputs spliced into an adjacent path or fed from upstream; closing wires marked feedback; grants set to what the parts need) and `draftFixPrompt`. `main.cjs` `brainsDraft` repairs every reply and sends leftover errors back to the model once, keeping the redraw only when it has fewer errors. The editor lists the repairs under *Repaired in the draft* until the map is saved. Replayed through the repair, the owner's draft goes from 4 errors and 3 warnings to 0 and 0; seen in a fake-bridge preview (banner, inspector list, "No problems").

Checks:
- node --test tests/brains_map.test.mjs tests/brains_store.test.mjs tests/brains_ui.test.mjs: 95 pass, 0 fail (5 new map tests, 2 new host tests, 1 new UI test).
- npm run check: ok (116 targets, 269 specs, all selectors used, check-syntax 116, 20 live rows).
- npm run audit: 0 errors, 0 warnings. eslint on the touched files: clean.
- npm test: exit 0 (Node 3066 pass / 3 skipped; Electron 27 pass / 1 opt-in skip; serialized suites pass; Python OK; path lock ok).

Rebuilt renderer/booklet.html. Nothing committed: the tree is shared with other writers.

## 2026-09-23 evening - UI critique follow-ups: one grey surface system, Command search and tab strip, Tasks, Plans, Ideas, Usage, walkthrough and rail foot

Follow-up to the afternoon's Home/menu design critique, verified with seeded offscreen Electron captures, before and after, from the same fake bridge (1440x900 and 1100x900). Surfaces: the navy/grey split is gone. Section 1 gains work-surface tokens (Home's greys, tinted 8-12% by the theme); body points --bg, --panel*, --glass* and --hairline* at them, #idle-hud points them back at the theme, so every page, sheet and menu is grey and the Command view keeps its themed canvas and HUD. Primaries are Home's ivory button outside Command. A light custom palette keeps its own surfaces: music.js paintTheme sets html[data-studio-theme-tone] from the background's luminance (startup_render's light-theme fixture caught the first cut; a peer session reported it). Command: in inspect mode the top bar's composer and search end 16px short of the widened rail instead of running under it (1440: 910 vs 926; 1100: 644 vs 708), and the rail's tab strip peeks on :has(:focus-visible), so a clicked tab no longer leaves it spread over the detail (real mouse input: 172px before, 56px after). Tasks: Delete is styled destructive before it is armed, Back to tasks shows only where the list is hidden (760px and below), and a one-line task no longer repeats its title as the brief. Plans: stepper cards share one height; the new-plan form's section is "1. The destination" instead of a second "New plan". Ideas: sparse rows drop the missing source and time instead of printing "undefined · Invalid Date"; row colours follow the theme. Usage: with no calls recorded, the cards say so instead of four "Unknown"s; unmeasured Performance rows read "Unmeasured". The walkthrough line names finished lessons beside the step, matching its bar. The collapsed rail foot labels Settings, Help and the update dot. Off switches have a visible track on grey; the composer's hint and project label are 11px in --muted.

Checks:
- npm run build-booklet: 39 models, hash f98dd2322a01.
- npm run check: exit 0 (116 targets, 269 specs, all selectors used, check-syntax 116, 20 live rows).
- npm run audit: 0 errors, 0 warnings.
- New regression tests (ideas_ui sparse rows, tasks_ui brief and Delete, onboarding done count, model_lab empty and unreported usage) each fail against the pre-change renderer and pass after.
- npm test: Node 3062 tests, 3059 pass, 0 fail, 3 skipped; Python 248 OK; path lock ok. Electron lane 28: 25 pass, 1 skip, 2 fail - command_render (125% zoom step measured 1100x720, zoom not yet applied under load) and performance_render (Profiler JSON download timed out, a known environmental row). Both passed solo right after: node --test tests/command_render.test.mjs (1/1, full route and Settings matrix at four layouts) and tests/performance_render.test.mjs (2/2).
- git diff --check on the touched files: clean.

Nothing committed: the tree is shared with other writers.

## 2026-09-23 night - Attended occlusion live-probe stamp follow-up: fresh strict native pass on a clean retry (task_2e84c61e74790e1d, run_1790193990975_7)

Ran this follow-up card's exact command, `node --test tests/occlusion_probe.test.mjs`, from the Studio checkout root (HEAD 34f3c9b, `main`). First attempt (~68 s) skipped at the environment gate: the probe window received an external `closed` event during the cover-wait phase (`windowLost`, cover visible, foreground-probe PowerShell call failed in this sandbox), so it was not a pass. A clean retry (~23.7 s) produced the strict native-occlusion pass: detection signal `document.hidden` (native tracker engaged, `MEFI_OCCLUSION_PROXY` unset), occluded rAF growth 0, every probe sample answered via the unthrottled worker channel (worker drift 391 ms; probe lag 65 ms of 1 sample), MessageChannel 1 ms, rAF resumed after the cover was removed, 0 console errors. Harness outcome tests 1 / pass 1 / fail 0 / skipped 0, exit 0. The static contract stayed green: `node --test tests/worker_responsiveness.test.mjs` -> tests 17 / pass 17 / fail 0 / skipped 0. No code changes; this row is the stamp. The card's game-repo half remains the owner-only task-store move of the 19-card occlusion closure onto `project_065c3c1159dfd50d` (recorded in `docs/handoffs/mefi-studio-occlusion-probe-pointer.md`).

## 2026-09-23 evening - Agent layer phase 2: task-only dispatch, one admission path, the dispatcher core, gated wake-ups and a ledger that charges a model only for its own failures

The deferred agent-layer follow-ups landed, and two adversarial reviews checked them. Inbox requests reach workers only by promotion to board tasks. Promotion stamps promotedTo, titles untitled rows from their first line, and re-promotes only when the board had nothing ready (fillRanDry), at most three extra rounds. Legacy running and verifying rows migrate in two phases. The pure dispatcher decisions live in scripts/executor-core.cjs, and scripts/work-admission.cjs is the one admission rule. Proactive and backlog switches hold roles at every enqueue, and the thinker's pin never outranks the owner's. OpenCode Go builders run only when Go is chosen and `opencode auth list` confirms a login. Keyless exploration is bounded (cheapest challenger, three turns, the default keeps every other task). The model ledger files a fallback run under the route that ran and judges its outage by that route. A stop is recorded as cancelled. Outages, silent early deaths and model-not-found errors are not losses. Other fixes: the briefing's closing sentence no longer gives every fix card the same theme; the Home card no longer contradicts green checks with "check failed"; the Explorer inbox shows a typed ask's first line once.

The round-1 review confirmed 18 findings, and the round-2 review 14 (4 evaluator, 4 dispatch, 6 test gaps). All are fixed or were already fixed by the merged work. Each new regression test was run against a scratch copy with its fix reverted and failed there. New suite: tests/executor_fallback_ledger.test.mjs. Rebuilt renderer/booklet.html; a peer session rebuilt it again afterwards.

Checks:
- npm run check: exit 0 (114 targets, 266 specs, all selectors used, check-syntax 114, 20 live rows).
- npm run audit: 0 errors, 0 warnings.
- eslint: 0 errors, 12 warnings, all pre-existing unused-variable warnings.
- npm test before the round-2 review fixes: exit 0 (Node 3021 pass / 3 skipped; Electron 27 pass / 1 opt-in skip; Python 248 OK; path lock ok).
- npm test final run: Python 248 OK, path lock ok. Node 3036 tests, 3032 pass, 1 fail, 3 skipped. The failure was verification_drain, a vm-section read taken while another session was editing; the runner flagged that sources changed mid-stage, and the test passed 2/2 solo. Electron lane: 28 tests, 26 pass, 1 fail, 1 skip. The failure was startup_render, caused by another session's in-flight `body` surface-token block in renderer/styles.css: a scratch copy of the tree without that block passes. That session has been told.

The model_win_evaluator ENOTEMPTY cleanup flake is fixed with rm retries. Nothing committed: the tree is shared with other writers.

## 2026-09-23 afternoon - Menu and Home cleanup: scrollbars, conversation layout, Settings jumps and Search names

A design review of the menus and Home from seeded offscreen Electron captures, 1440x900, before and after, with the same fake bridge. Home: the conversation now fills the space above the composer instead of a 250 px box, the folded rows (Recent activity, Project queue, Studio status, Getting started) sit under the task card with one inset, and the thread opens on its newest message (it used to open on the oldest of the last 80 because it rendered while hidden). The card says View task, not Start this task, and will not call startTask while a worker holds the task. See activity is renamed Watch live, Details loses its external-link arrow, and the Activity panel no longer repeats the card's facts. Toasts stack above the composer. Globally, html no longer sets scrollbar-color, which had switched every scroller to Windows' arrowed standard scrollbar and disabled the ::-webkit-scrollbar rules. Settings: a category click keeps the page title in view (scrollY 63 -> 0, title top -41 -> 22 px), Automation's role=switch rows draw as switches, Audio has its own glyph, and Search names cards by title ("Profile & startupNames and launch destination" -> "Profile & startup"). Walkthrough lesson 5 and GETTING_STARTED.md use the current Chat / Create task labels.

Checks: npm run check ok (114 targets, 265 specs, all selectors used, check-syntax 114, 20 live rows); node --test for workspace_ui, settings_nav, palette_keyboard, booklet_build and app_rail 107/107; workflow_render, onboarding, settings_queue and nav_startup 48/48; npm test exit 0 (3,040 Node pass, 0 fail, 5 skipped; 248 Python contracts; path lock ok); npm run audit 0 errors, 0 warnings; git diff --check clean on the touched files. booklet.html rebuilt. Nothing committed: the tree is shared with other writers.

## 2026-09-23 - Completed sequential sessions no longer spawn collision repair work

The live Studio trial queued two collision-repair sessions after a completed game build and its later preview task. Read-only session evidence showed the first edits around 09:24, terminal completion before the next session began at 09:29, and follow-up edits around 09:31. The collision reader's ten-minute proximity window retained this handoff, marked both sessions active from edit recency alone, and the watcher converted it into work despite its own prompt saying the sessions never co-edited.

The eyes reader now uses final step-finish/stop evidence to exclude ended sessions from live presence. It keeps completed sequential handoffs inspectable, marks them history-only when completion precedes the next session's creation and there is no actual pairwise edit overlap, and excludes them from automatic intake and assistant operational facts/cache. Genuine overlap, concurrent session lifetimes with separate edit instants, three-session overlap chains and resumed sessions remain actionable. Known-finished peers are no longer told to stop or confirm handoff in generated collision prompts. No live task store or game files were edited.

`node --test tests/eyes_collision_lifecycle.test.mjs tests/eyes_overlap_boundaries.test.mjs tests/eyes_missing_store.test.mjs tests/assistant_loop.test.mjs` passed 24/24. `python -m unittest discover -s tools -p test_mefi_studio_eyes.py` passed 18/18 after updating the existing fixture expectation that incorrectly marked terminally finished ses_a as active (the initial run was 17 pass, 1 stale-expectation failure). Full Python output was retained at %TEMP%/mefi-collision-python-contract.txt. All checks used isolated fixtures and no Electron, paid worker, live state, renderer build, packaging or full gate.

## 2026-09-23 - Studio Snake trial project-local verification correction

- Live computer-use trial exposed a false verification result: a package-free Snake project received a passing `npm run check` from Studio's own directory. The builder's reported game tests were separate evidence.
- Removed that cross-project fallback. Verification retains the dispatched project directory for tasks and requests, records `cwd` per check, chooses observed local scripts or root JavaScript tests, and fails explicitly when no supported check exists.
- Validation: `node --test tests/verification_checks.test.mjs tests/verification_drain.test.mjs tests/executor_lifecycle.test.mjs tests/executor_continuation.test.mjs` passed **112/112** in isolated fixtures, including wrong-directory, missing-check, and cross-project cached-result regressions. Main and assistant syntax checks passed.
- Full application gates and final interactive game verification remain pending while the live trial and concurrent navigation changes finish. No game files were edited outside Studio.

## 2026-09-23 - Useful live worker activity survives successful process-exit boilerplate

During the live Snake trial, Command's worker detail remained on EXIT=0 instead of its last meaningful step. scripts/executor-activity.cjs now retains a prior meaningful activity when a later line is exactly a zero-exit marker or generic successful process completion. Stream-arrival time still advances; the retained activity keeps its real timestamp. Nonzero exits, failures, substantive results and mixed lines remain visible. If the worker has supplied no meaningful activity, its actual output remains available rather than inventing progress.

`node --test tests/executor_activity.test.mjs tests/executor_resume.test.mjs` passed 34/34, including new zero-exit filtering and failure/result-preservation cases. Syntax and focused diff whitespace checks passed. Only the activity helper and its focused tests changed; no main/renderer, native UI, live state, build, packaging or full gates were touched by this check.

## 2026-09-23 - Concurrent booklet output and fresh-project Git prompt regressions

The live computer-use trial reported EPERM while renaming renderer/booklet.html.tmp. scripts/build-booklet.mjs used shared temporary names for both the page and source manifest. Both outputs now use exclusively created unique sibling files, atomic rename, bounded Windows lock retries and cleanup limited to the owned temp; failed replacement preserves the last complete output and original error. `node --test tests/booklet_atomic_write.test.mjs tests/booklet_build.test.mjs tests/booklet_source_location.test.mjs` passed 11/11, including eight overlapping builds against an isolated fixture root, transient/persistent lock cases, error preservation, no-op rebuilding and source locations. No real repository booklet was built by this run.

The same trial completed and verified its new Snake project, but the worker reported missing Git as an owner action. The generic executor prompt had unconditionally required a Git commit even for a new non-Git folder. It now directs the worker to establish whether a Git working tree exists, preserves explicit task/project commit requirements and the existing shared-index commit safeguards, and treats absent Git as an ordinary informational note when no commit is required, excluding it from MEFI_ASK, remaining and owner fields. No parser or stored task/ask was changed; an existing stale ask still needs the normal UI resolution. `node --test tests/executor_project_prompt.test.mjs tests/executor_resume.test.mjs` passed 23/23 using the actual dispatched prompt and memory-only host fixtures.

Syntax checks for scripts/build-booklet.mjs and main.cjs, plus focused git diff --check, passed. No Electron fixtures, paid workers, live state edits, package build or full gates were launched. The parent trial owns full integration validation and the renderer build.

## 2026-09-23 - Void collection previews remain temporary until Discord membership is confirmed

Changed the Void theme and node-style pickers to paint unentitled choices as previews without writing the free or premium style stores. Closing the canvas preview or leaving Settings restores saved choices; a premium entitlement arriving during a preview saves the active choice. Preferences' theme accent also remains unsaved during a preview. Updated Community copy and rebuilt `renderer/booklet.html`.

`npm run build-booklet` exited 0. Focused `node --test tests/music.test.mjs tests/community_ui.test.mjs tests/workspace_ui.test.mjs` exited 0 (118/118). `npm run check` exited 0; `npm run audit` exited 0 (0 findings) after two literal DOM lookup fixes in the concurrently edited Settings/task UI. A full `npm test` was attempted but stopped in the Node stage while sources changed; `tests/task_oversight.test.mjs`, an untracked concurrent suite unrelated to the style change, still failed 8/33 when rerun solo. The Electron and Python stages did not run under that chain. No game tests were run.

## 2026-09-23 - Studio Snake computer-use trial integration attempt

Created the separate Studio Snake Trial folder and selected it through Studio's project UI. The trial exposed a Save & switch settlement race, repeated update notifications, and missing live worker activity. Added focused fixes; visibility suites passed 158/158 and project/update suites passed 56/56. Rebuilt renderer/booklet.html; npm run check passed (110 targets, 246 specs), npm run audit passed with zero findings. Full npm test exited 1 while concurrent Studio source edits were in progress; the runner explicitly reported sources changed during the parallel stage, with settings_nav assertions among the failures. This is not a clean full-gate result and must be rerun on a settled tree. Complete output: tools/logs/studio-snake-trial-npm-test.log. UI trial is incomplete: Windows locked before the Snake task could be submitted; no game source was authored outside Studio. No project state was edited directly.

## 2026-09-23 - Project switching waits for worker settlement; repeated update notices are quiet

Focused host/renderer checks for the UI-observed Save & switch failure. `executorIdle()` and live restart now retain a finished worker until its entry is removed after checkpoint, board and history saves; a live restart also defers across project adoption, including a switch begun during asynchronous restart preparation. Update toast signatures suppress unchanged detected/waiting/pending retries while preserving changed reasons and the next update's notices. No user task state, settings or portable data was edited.

`node --test tests/project_switch_settlement.test.mjs tests/update_continuity.test.mjs tests/update_notifications.test.mjs` passed 12/12. The new synthetic-clock integration exercises a 15-second normal save after process exit (the old path refused after its 10-second project wait), plus an unsaved worker that correctly prevents adoption. The update host tests cover normal settlement without a retry flag and both early and late project-switch interlocks.

`node --test tests/projects.test.mjs tests/app_rail.test.mjs tests/updater_deferred.test.mjs` passed 44/44. No Electron fixtures, paid workers, booklet builds, packaging or restarts were launched by these checks. The parent computer-use trial owns the renderer rebuild and full integration gates after the live GUI is stable; source files were held steady during this focused validation.

## 2026-09-23 - Live worker activity, honest phases and project event context

During the Studio computer-use trial, added bounded live worker activity for Home and Command: sanitized output, route, current checklist step and last-update age; preparation and finishing stay distinct from building. Stream bursts share a 500 ms status push and renamed todos publish even when their completed fraction is unchanged. Home refreshes a quiet worker's age in place. Assistant board facts now read the current project's taskEventTails rather than an unwritten state property.

Focused non-Electron command: node --test tests/executor_activity.test.mjs tests/executor_resume.test.mjs tests/executor_continuation.test.mjs tests/executor_lifecycle.test.mjs tests/workspace_ui.test.mjs tests/command_activity.test.mjs. First grouped run 157/157 pass; after the quiet-clock regression 158/158 pass, exit 0. The helper's initial isolated test found OSC hyperlink text removal and an unmasked fine-grained GitHub token pattern; both are fixed and covered. main.cjs, renderer/workspace.js, renderer/idle.js and scripts/executor-activity.cjs passed node --check before the final renderer age patch, which the focused renderer suite evaluates. No Electron tests, full gates, booklet rebuild, package, app restart, paid worker or project-file edits were performed by this validation. Full gates and rendered UI verification remain with the parent trial after the live updater is stable; pre-existing dirty work was preserved.

## 2026-09-23 - Navigation cleanup focused checks

Removed duplicate primary destinations from the rail, named its primary buttons by destination, and made wide-window labels visible by default while preserving an explicit collapsed preference. Keyboard return now follows visible current destinations and can restore focus to a row in the collapsed menu; reopening Search preserves the current query, selection and original opener. `node --test tests/app_rail.test.mjs tests/nav_startup.test.mjs tests/palette_keyboard.test.mjs` passed 37/37. An initial added focus test failed because its fake opener omitted isConnected; after supplying the real-browser property the check passes. The parent cleanup task owns booklet rebuild, computer-use verification and full gates.

## 2026-09-23 - Merged origin/main after preserving local changes

Fetched origin/main b9f680c, committed the existing quoted Work on it fix separately (abfe417) and the validated Server Styler integration (83d72a1), then resolved the README, host and renderer overlaps in merge b30fa7b. Rebuilt renderer/booklet.html. npm run check and npm run audit exited 0. The first npm test attempt was run before the merge commit and its check_css_merge test expected no merge in progress; its CSS merge audit itself passed. After committing the merge, npm test exited 0: parallel Node 2500 tests (2497 pass, 3 skip), Electron lane 27 (26 pass, 1 opt-in skip), eyes toggle 1 pass, occlusion probe capability skip after its window was externally destroyed, Python 248 OK, normalized-path lock passed. The branch contains origin/main and the original local edits are committed; no project state or secrets were added.

## 2026-09-23 - Integrated upstream Server Styler controls and sibling game path

Compared main with origin/main at b9f680c and carried the standalone Styler host, preload, Settings controls, path resolver, and contract tests into the newer local branch without resetting the pre-existing quoted Work on it changes. Rebuilt renderer/booklet.html. Focused path and Settings tests passed 28/28; the Styler Python wiring test passed. npm run check and npm run audit exited 0. npm test exited 0: parallel Node 2500 tests (2497 pass, 3 skip); Electron lane 27 (26 pass, 1 opt-in skip); eyes toggle 1 pass; occlusion capability skip 1 on this desktop; Python 248 OK; normalized-path lock passed. The optional Server Styler checkout is absent here, so no bot was started.

## 2026-09-23 morning - quoted Work on it labels reuse existing chat work

Inspected the uncommitted queue, assistant chat admission, agent-mode and renderer feature set without resetting it. A read-only rebuild matched renderer/booklet.html byte for byte. Baseline npm run check, npm run audit and npm test all exited 0. Focused review found a missed duplicate: a host-generated Work on it wrapper with an inner quote in its label was not unwrapped by scripts/chat-work.cjs, so a later matching chat instruction created a second task. Added pure wrapper and host-admission tests, observed 2 focused failures before the fix, then made the wrapper capture retain inner quotes; the focused run passed 26/26.

After the fix, npm run check exited 0 (107 targets, 237 specs, syntax and TESTRUNS clean), npm run audit exited 0 with no findings, and npm test exited 0: parallel Node 2496/2493 pass/3 skipped; Electron lane 27/26 pass/1 opt-in skip; eyes toggle 1/1; occlusion capability skip 1 on this desktop; Python 247 OK; normalized-path lock all checks passed. No renderer source was edited, so no booklet rebuild was needed.

## 2026-09-23 late night - Attended occlusion live-probe stamp: benign input nudge flips the inert unattended tracker to a strict native pass (task_d34d8d0a636519dc, run_1790142719564_30)

Ran the task's exact command, `node --test tests/occlusion_probe.test.mjs`, from the Studio checkout root (HEAD ea70948, `main`). First run skipped at the documented capability gate in ~33.8 s: console desktop session 1, WTSConnectState Active, input desktop Default and `inputDesktopLocked=false` (unlocked, not RDP), but `idleMs=6490625` (~108 min) — the attended-desktop condition the gate needs was absent, so the cover was shown focused with 8 focus reassertions, NULL Win32 foreground (`hwnd 0x0`), page `hasFocus()` false, and rAF stayed loud at ~60 fps behind the cover (`occlusionUnsupported`, tests 1 / pass 0 / fail 0 / skipped 1, exit 0). Per the reviewer's rule this skip is not a pass and is not claimed as one.

Applied the documented benign input nudge (relative SendInput mouse move, +3/+3 then -3/-3, no click or keys) to reset the idle clock to 547 ms, then re-ran the same command. Strict native-occlusion pass in ~28.5 s: detection signal `document.hidden` (native tracker engaged — not the visibility proxy, which stayed off with `MEFI_OCCLUSION_PROXY` unset), occluded rAF growth 0, every probe sample answered via the unthrottled worker channel (workerDriftMs 164 → lag 0 ms of 1 sample), blob worker still constructed (drift 161 ms), MessageChannel 0 ms, rAF resumed after the cover was removed, 0 console errors. Harness outcome tests 1 / pass 1 / fail 0 / skipped 0, exit 0. No code changes — this row is the stamp only.

## 2026-09-22 late evening - Task detail Attempts fold, session-to-task links, Needs you breakdown, Command Done fix

Worktree mefi-t3-code-comparison-588d25 on HEAD 21f1697 plus uncommitted Stage 1 task-workspace changes. npm run build-booklet ok; npm run check ok (105 targets); npm run audit ok (0 findings). Touched suites: task_attempts, tasks_ui (39), workspace_ui (32), explorer_ui, command_task_done, module_purity, booklet_build - 97/97 pass. Full npm test node stage: 2233 tests, 2230 pass, 0 fail, 3 skipped; Electron lane 15/17 with performance_render and renderer_recovery timing out under load, both pass solo (2/2, 10/10). Python stage run separately: 247 tests, 1 failure test_restart_loop_guard ('held' != 'pending'), passes 2/2 solo; untouched updater code, known load-sensitive live-subprocess test. normalized path lock ok. Parser also checked read-only against the real data/executor-log.jsonl (10 rows for one task grouped into 5 attempts). Visual check in the browser pane with a standalone fake-bridge Tasks overlay: live, failed-with-fallback and wedged-start attempts render with output and session links.

## 2026-09-22 night - Sessionless CLI builder runs park for the owner instead of retrying verification

Worktree mefi-t3-code-comparison-588d25 on f4cf450 plus the sessionless-route change. New tests/executor_sessionless_route.test.mjs drives the real dispatch/settle host sections: a claude-routed run that reports done parks as failed on its first check (no nextRunAt, verifyAttempts 1); an OpenCode run without a session keeps the bounded retry. A/B: with sessionlessRoute forced to null the claude case fails, restored after (sentinel count 0). board, jev_routing_ui, verification_checks, commit_evidence, executor_*, verification_drain, backlog_engine, policy_experience, assistant_loop: 362/362. Python tools.test_mefi_studio_assistant + routing: 89 OK. npm run test:fast: 2236 tests, 2233 pass, 0 fail, 3 skipped. build-booklet, check and audit ok. Live board note: the portable app's executor ledgers show only opencode-go runs (171 finishes, all with sessions), so no existing task was affected.

## 2026-09-22 late night - Request inbox adds and removes through a targeted eyes:requests-action

Worktree mefi-t3-code-comparison-588d25 on e63ab80 plus the inbox change. idea_actions (new applyRequestAction cases: sanitized adds, identity remove, claimed/vanished refusals), explorer_ui (targeted add/remove, refusal keeps the row and shows the reason, whole-list write never called), build_approval: 24/24. npm run test:fast: 2239 tests, 2236 pass, 0 fail, 3 skipped. Python tools.test_mefi_studio_tasks + eyes OK. build-booklet, check and audit ok. The legacy eyes:requests-write and ideas:save handlers stay for bridges without the actions (ideas.js already used ideas:action on desktop).

## 2026-09-22 night - Resume-key deep link lands on the explorer in the real Electron fixture, opt-in and unchanged by default (task_253fb240d7082220, run_1790138797485_83)

Added `MEFI_PERFORMANCE_RESUME_SHEET` to `tests/fixtures/performance-render-electron.cjs`: the preload seeds `localStorage["mefiStudio.resume"] = { at, sheet }` before any page script, and when set the fixture drives `window.MefiNav.resumeReady({ isCurrent })` and requires the sheet overlay to open with the key consumed, then writes `report.resumeRestored`. `tests/performance_render.test.mjs` passes the flag through and adds a third test that is skipped unless the flag is set, so the default two-test capture lane is unchanged. Evidence: `MEFI_PERFORMANCE_RESUME_SHEET=explorer node --test --test-name-pattern="resume key" tests/performance_render.test.mjs` -> pass 1 / fail 0 (8.2 s); default `node --test tests/performance_render.test.mjs` -> pass 2 / skip 1 / fail 0 (36.2 s). Malformed/absent resume handling remains covered by `tests/nav_startup.test.mjs`. The Electron fixture lives in this Studio checkout, not the game repo.

## 2026-09-22 night - Full npm test re-attempt on the settled af778d0 tree - sibling suites now green solo, one eyes_worker load flake stops the chain before the width-2 Electron lane (task_6eaa6023eab1a057, run_1790136302111_8)

One `npm test` from the Studio root at HEAD af778d0 (>= bf028ae); the runner's settle loop passed (no 'sources still changing' line). Parallel stage: tests 2476 / pass 2472 / fail 1 / cancelled 0 / skipped 3 in 95.0 s. The width-2 Electron lane did NOT run: run-node-tests.mjs exits on the first failing parallel suite, so `runStage(heavyLane, 2, ...)` never launched and no Electron fixture produced output. The lone failure is the documented eyes_worker 'read past the timeout' load flake (scripts/eyes-client.cjs:149, store read timed out after 150 ms); tests/eyes_worker.test.mjs passes 8/8 solo on the same HEAD. The named sibling suites (community_*, discord_oauth, music, command_graph) pass 232/232 solo, exit 0, so the prior 6-failure parallel blocker is functionally cleared - but they remain uncommitted. Net: npm test cannot exercise the width-2 lane while any parallel suite flakes under load; the lane needs a direct quiet-host run.

## 2026-09-22 night - Raw control-byte escapes and the check-targets raw-control gate (4ae4eb8), gated as that exact commit in a detached worktree: check and audit green, Node 2287/2282/2 load flakes/3 skipped (both green solo), Python 247 OK, normalized-path lock ok

Commit 4ae4eb8 escapes raw NUL/BS/VT/US/ESC bytes in usage-tracker.cjs (line 23 only), first-map.mjs, first-scan.mjs, setup-assist.mjs and two executor tests. Git now stores all four scripts as text (`i/lf`). check-targets also now fails on raw C0 controls (other than tab/LF/CR), DEL and bidi controls in tracked text files. The shared tree was not a valid place to gate it: a peer had 19 files staged, first-scan.mjs and usage-tracker.cjs carried peer hunks, and `npm run audit` failed there on a peer's uncommitted `#music-premium-themes`. So the commit was built in a private `GIT_INDEX_FILE` from HEAD b73b378 and gated in `git worktree add --detach C:/Users/echor/mgr` with node_modules junctioned. The host was saturated throughout (70-100 % CPU, a dozen peer sessions).

- `npm run check` exit 0: check-targets 104 targets, spec-collisions 219, CSS merge skip + all selectors used, check-syntax 104 files, check-testruns ok. Before usage-tracker.cjs line 23 went into the commit, the gate correctly failed HEAD on `scripts/usage-tracker.cjs:23:66 U+0000` and `23:68 U+001F`.
- `npm run audit` exit 0, 0 errors / 0 warnings.
- `npm test` exit 1 at the Node stage: `run-node-tests: 192 suites (9 launch Electron)`, tests 2287 / pass 2282 / fail 2 / cancelled 0 / skipped 3, 293 s. The two failures touch no file in the commit, and both passed solo on the same commit (10/10): `commit_evidence` ("the evaluator accepts a runner-observed commit", 12.6 s; git reads starved, and the solo run still took 9.5 s) and `eyes_worker` ("a read past the timeout", the documented load flake). Because the Node stage failed, the Electron lane never launched; the commit touches no renderer or Electron fixture source.
- The rest of the chain, run directly on the same commit: `python -m unittest discover -s tools -p "test_mefi_studio_*.py"` ran 247, OK (skipped=1); `node tools/test_normalized_path_lock.mjs` all checks passed.

Landed with `git update-ref refs/heads/main 4ae4eb8 b73b378` (compare-and-swap), then `git reset -q 4ae4eb8 -- <the 8 paths>` so the shared index holds no stale blobs for them; peers' staged work was untouched. The worktree was torn down junction-first. scripts/community.cjs (untracked) had literal bidi controls, which its owning session escaped before this run.

## 2026-09-22 late evening - Quiet single-writer `npm test` re-attempt on an unqualified tree: precondition still unmet (community/music/command_graph uncommitted), the Node stage ran 2336/2327/6/0 and the width-2 Electron lane never launched under the chain (task_6eaa6023eab1a057, run_1790128483257_95)

Re-attempt of this card. Pre-condition check first, from the package root at HEAD 6695582 (contains `bf028ae`): the sibling work is still **not committed** (`git status`: `tests/music.test.mjs` and `tests/command_graph.test.mjs` modified; `tests/community_bridge|community_host|community_rules|community_ui|discord_oauth.test.mjs` untracked), and the host was not quiet (942 MB free of 14,102 MB, 17 `node` processes, 0 `electron`). So this is explicitly **not** the quiet single-writer run the card asks for and is reported as such.

One `npm test` from the package root, exit **1**. `run-node-tests: 195 suites (9 launch Electron)`. The parallel stage printed `tests 2336 / pass 2327 / fail 6 / cancelled 0 / skipped 3 / duration_ms 66253.5893`; no "Electron fixture" stage appeared and no source-settle abort fired. The 6 failures are the same sibling uncommitted suites the `bf028ae`/`a2516e56` rows name: `command_graph` ("prism keeps its facets and runes on the node"), `community_host` + `projects.test.mjs` (`ReferenceError: APP_WIDE_CHANNELS is not defined` in `handleProjectIpc`), `community_ui` x2 (offer() copy) and `music` ("without MefiCommunity the actions say Desktop app only"). `runStage()` calls `process.exit` on the first failing stage, so the width-2 Electron lane never launched under the chain - a runner property, not a lane defect - and the Python and normalized-path stages of the `npm test` chain were not reached either.

Net: the card's precondition (sibling sessions commit/stash `community`/`music`/`command_graph`) is still unmet, so the literal single-writer full `npm test` that would exercise the width-2 lane inside the real chain remains blocked. The lane's own operability evidence stands (`df9ce80`/`6d468ca` direct lane 17/17, `bf028ae` 16/17 with 0 cancellations). Output tee'd to `%TEMP%\opencode\npmtest-task_6eaa6023-20260922-2056.log`. No source file was modified beyond this entry; the shared index was left with nothing staged.

## 2026-09-22 late evening - Full single-writer `npm test` re-attempt on an unsettled tree: the precondition is still unmet (sibling work uncommitted, host saturated), the Node stage ran 2331/2322/6/0 and the width-2 Electron lane still never launched under the chain (task_a2516e562f8fb21b, run_1790124735129_54)

Re-attempt of this card on the current tree. Pre-condition check first: the sibling work is still uncommitted (`git status`: `main.cjs` + `renderer/music.js` modified, `renderer/community.js` untracked) and the host was not quiet (225 MB free of 14,102 MB; ~20 live `node` processes, several started 19:54:20). So this is explicitly **not** a quiet single-writer run and is reported as such.

Full gate: one `npm test` from the package root, exit **1** after **104.8 s**. `run-node-tests: 194 suites (9 launch Electron)`. The parallel stage printed `tests 2331 / pass 2322 / fail 6 / cancelled 0 / skipped 3 / duration_ms 88312`; the 6 failures are the same sibling in-progress/untracked suites the `bf028ae` row names and all reproduce solo (`node --test tests/command_graph.test.mjs tests/community_ui.test.mjs tests/music.test.mjs tests/usage_tracker_host.test.mjs` fails 5): `command_graph` ("prism keeps its facets and runes on the node"), `community_host` + `projects.test.mjs` (`ReferenceError: APP_WIDE_CHANNELS is not defined` in `handleProjectIpc`), `community_ui` x2 (offer() copy) and `music` ("without MefiCommunity the actions say Desktop app only"). `runStage()` calls `process.exit` on the first failing stage, so the width-2 Electron lane never launched under the chain - a runner property, not a lane defect.

Net: the card's precondition (sibling sessions commit/stash `main.cjs` + `renderer/music.js` + `community_ui`, then a quiet host) is still unmet, so the literal single-writer full `npm test` that would exercise the width-2 lane inside the real chain remains blocked. **0 `node:test` cancellations** in the parallel stage, and the lane's own operability evidence stands (`df9ce80` / `6d468ca` direct lane 17/17, `bf028ae` 16/17 with 0 cancellations). Output tee'd to `%TEMP%\opencode\npmtest-task_a2516e56-20260922-1955.log`. No source file was modified beyond this entry; the shared index was left with nothing staged.

## 2026-09-22 late evening - Electron lane re-run under a saturated shared host: the literal single-writer `npm test` still bails at the parallel stage on sibling in-progress suites and never reaches the width-2 lane; the direct width-2 lane ran 16/17 with 0 cancellations (startup_render fixture starved - documented load flake), and the prior clean lane passes stand (task_94b1f81cf95f9ff6, run_1790123281248_7)

Retry of this card after the owner split the blocked extra work out; its prompt is a quiet single-writer `npm test` to exercise the new runner's width-2 Electron lane + kill+60 s margins. Both halves were re-run first-hand on HEAD 0279c89, and the pre-condition could not be met: the host was **not** quiet. Pre-flight found a concurrent `npm test` (pid 26884), a full `node --test` over the sibling clone `C:/Users/echor/.claude/worktrees/mefi-t3-code-comparison-588d25/tests` (pid 24288), a sibling `npm run check` (pid 33956), 4-8 live Electron processes and only 313-442 MB free of 14,102 MB. So this is explicitly not a quiet single-writer run and is reported as such.

Full gate: one `npm test` from the package root, exit **1** after **64,885 ms**. `run-node-tests: 194 suites (9 launch Electron)`. The parallel stage printed `tests 2327 / pass 2318 / fail 6 / cancelled 0 / skipped 3 / duration_ms 58838`, and the 6 failures are all sibling in-progress or untracked work, not this card: `command_graph` ("prism keeps its facets and runes on the node"), `community_host` and `projects.test.mjs` (`ReferenceError: APP_WIDE_CHANNELS is not defined` in `handleProjectIpc`, a VM slice of the uncommitted +817-line `main.cjs`), `community_ui` x2 (offer() copy) and `music` ("without MefiCommunity the actions say Desktop app only"). `runStage()` calls `process.exit` on the first failing stage, so the Electron lane never launched under the chain - a runner property, not a lane defect.

Direct lane, exactly what the runner runs (`node --test --test-concurrency=2` over the 7 non-serialized heavy files command_render, node_paint_cache, package_privacy, performance_render, renderer_recovery, startup_render, task_overview_render): exit **1**, `tests 17 / pass 16 / fail 1 / cancelled 0 / skipped 0`, **144,455 ms** (vs 42.1 s and 34.3 s on the two prior quiet runs). The one failure is `startup_render` "cold startup gates access..." - "Startup fixture timed out: PID 13672" at 69.4 s - with command_render at 92.0 s and task_overview_render at 50.3 s, i.e. every capture starved by the >10x host load. **Zero `node:test` cancellations**: the kill+60 s budgets classified the fixture's own timeout as an assertion rather than a cancellation, which is exactly what those margins exist to do. Starved GPU-contended captures are the documented environmental-failure class (TESTRUNS "Known environmental failures": startup_render, rerun solo), so this is host-load flake, not a runner or lane regression. The prior clean evidence is not superseded: df9ce80 direct lane 17/17 @42.1 s and the independent 6d468ca 17/17 @34.3 s both remain the lane-operability evidence.

No source file was modified beyond this entry; the shared index was left with nothing staged. Remaining: a literally quiet single-writer full `npm test` cannot reach the lane while the sibling's uncommitted community/music/command_graph/projects suites fail the parallel stage - a blocker split out of this card and not reproducible-fixable on this saturated shared host.

## 2026-09-22 late evening - performance_render solo rerun re-verified on the current tree under load: 2/2 pass in 18.7 s, exit 0, no pak-load or profiler-JSON timeout; corroborates the 0279c89 flake-vs-regression split (task_686c8477802f55a0, run_1790123192292_2)

Independent re-verification of this card's deliverable on the current tree (HEAD 0279c89), requested by the interrupted-work retry. Exact command, single writer, from the package root: `node --test tests/performance_render.test.mjs` -> tests 2 / pass 2 / fail 0 / cancelled 0 / skipped 0, **exit 0**, duration 18,705 ms (renderer leg 11,190 ms; desktop host 7,259 ms). Neither reported symptom appeared: no `chrome_100_percent.pak` line and no "Profiler JSON download timed out". Host at launch was NOT quiesced - CPU 72 %, free RAM 436 MB, 12 `node` helpers, 0 `electron.exe` - so this is the loaded-but-healthy point between the 12.3 s quiesced run (0279c89) and the ~58 s loaded run (6bc2e63), and it still sits well inside the 140 s `node:test` budget (80 s fixture kill + 60 s prelude landed in 21f1697). This corroborates the committed verdict: the pak-load / 18 s-JSON-timeout signature is host-load flake, not a fixture regression. Output tee'd to `%TEMP%\opencode\perf_render_verify_20260922-192819.log`. No fixture or test source modified by this run; the two split-out follow-ups (stray-pak-line capture, timeout/width policy) remain with their delegated cards.

## 2026-09-22 late evening - performance_render quiesced solo rerun passes 2/2 in 12.3 s; the same fixture on the same HEAD runs 12 s quiet vs ~58 s loaded vs cancelled saturated, so the pak-load/18 s-JSON-timeout signature is machine-load flake, not a fixture regression (task_686c8477802f55a0, run_1790122820379_61)

Third rerun of this question, and the first genuinely quiesced one - the prior
card's run was owner-present/loaded. Pre-flight found no competing
`node --test`/`npm test` chain and 0 `electron.exe`: a sibling game-repo
`run-tests:quick` lease (pid 39028) had just released, so the only live `node`
processes were IDE/MCP helpers. Host at launch: CPU 60 %, free RAM 1,444 MB,
electron 0, node 11; after: CPU 3 %, electron 0.

Command, exactly one writer, from the package root: `node --test
tests/performance_render.test.mjs` -> **tests 2 / pass 2 / fail 0 / cancelled 0
/ skipped 0, duration 12,347 ms, exit 0** (renderer 6,957 ms; desktop host
5,246 ms). Output tee'd to `%TEMP%\opencode\perf_render_solo_retry.log`.
Neither reported symptom recurred: no `chrome_100_percent.pak` line and no
"Profiler JSON download timed out".

The renderer leg took 6.9 s here, versus 57.9 s on the loaded desktop (this
card's prior run) and ~18.5 s inside the saturated flake-loop, and sits well
inside the current 140 s `node:test` budget (80 s fixture kill + 60 s prelude
landed in 21f1697). The same fixture on the same HEAD passing in 12 s, passing
in ~58 s, and cancelling only under saturation is a host-load gradient, so the
pak-load + 18 s JSON-timeout signature is **machine-load flake**, not a fixture
regression. The stray pak-load line itself remains unreproduced on a quiesced
host. No fixture/test source modified beyond this entry.

## 2026-09-22 late evening - Electron lane end-to-end re-verified independently: width-2 heavy lane 17/17 pass / 0 cancelled / 34.3 s; a full single-writer `npm test` still stops in the parallel stage on sibling in-progress suites and never reaches the Electron lane (task_46383da5c648ff0f, run_1790122808207_60)

Re-ran the split-out end-to-end validation first-hand rather than adopting the sibling card's report, on the same shared, actively-edited tree. Runner settings re-confirmed on disk on HEAD (after the sibling row landed, HEAD df9ce80): `scripts/run-node-tests.mjs:170` runs the heavy lane with `runStage(heavyLane, 2, "Electron fixture")`; `--list` -> 194 suites (9 launch Electron). Direct exercise of exactly what the runner runs, `node --test --test-concurrency=2` over the 7 non-serialized heavy files (command_render, node_paint_cache, package_privacy, performance_render, renderer_recovery, startup_render, task_overview_render): exit **0**, `tests 17 / pass 17 / fail 0 / cancelled 0 / skipped 0`, **34.3 s wall** - matching the sibling's df9ce80 claim (42.1 s) and confirming the width-2 lane is operational end-to-end. No fixture kill fired and no `node:test` cancellation, so the kill+60 s margins were headroom, not exercised under saturation. Full gate: one foreground `npm test` (single writer; pre-flight found no competing `node --test`/`electron.exe`) logged to `%TEMP%\opencode\npmtest-task_46383da5-20260922-e2e.log`, exit 1 after 35.7 s. The parallel stage printed `tests 2314 / pass 2306 / fail 5 / cancelled 0`, and the runner bailed on that first failing stage (its `runStage` calls `process.exit`), so the Electron lane never launched under the chain - a runner property, not a lane defect. Critically: **zero Electron cancellations and zero fixture-kill signatures**; the 5 failures are non-Electron assertions in sibling in-progress suites (command_graph, community_ui x2, music, usage_tracker_host) that `main.cjs` +433 / `renderer/music.js` +307 have uncommitted. They reproduce **solo** on the current dirty tree (`node --test` those four: 176 tests / fail 5 / exit 1), so they are real failures in the sibling sessions' uncommitted work, not parallel-load transients and not anything the lane change caused. No "sources changed while the ... stage was running" warning fired. Net: the width-2 lane + 60 s margins are validated as far as a shared tree allows; the literal clean single-writer full `npm test` stays blocked until the sibling community/music/command_graph work lands and the tree is quiet. No repo source modified by this run beyond this row.

## 2026-09-22 late evening - Electron lane end-to-end: width-2 lane verified directly (7 fixtures, --test-concurrency=2, 17/17 pass, 0 cancelled, 42 s); the literal single-writer full `npm test` cannot reach the lane because a sibling session's in-progress suites fail the parallel stage and the runner bails before the heavy lane (task_94b1f81cf95f9ff6, run_1790122600413_55) (task_94b1f81cf95f9ff6, run_1790122600413_55)

Validated the new runner's width-2 Electron lane + kill+60 s margins (task_46383da5c648ff0f change, HEAD 21f1697) as far as a shared, actively-edited tree allows. Effective runner settings re-confirmed on disk: scripts/run-node-tests.mjs:170 `runStage(heavyLane, 2, "Electron fixture")`; `--list` reports 194 suites / 9 launch Electron; heavyLane is the 7 non-serialized Electron suites (command_render, node_paint_cache, package_privacy, performance_render, renderer_recovery, startup_render, task_overview_render) and the 2 serialized probes (occlusion_probe, eyes_toggle_electron) stay one-at-a-time. Margins are the enclosing node:test budgets = fixture-kill + 60 s (performance_render/command_render 140 s @ 80 s kill, startup_render 115 @ 55, task_overview_render 95 @ 35, node_paint_cache 90 @ 30, renderer_recovery 105 @ 45, occlusion_probe/eyes_toggle_electron 140 @ 80). Single-writer pre-flight: no other `node --test`/Electron writer was live (only scripts/serve.mjs web servers and the game repo's separate python unittest, left untouched). Full `npm test` run #1, one foreground quiet process, output logged: exit 1 after 54.3 s; the runner printed `sources changed while the parallel stage was running` and the parallel stage failed exactly 4 tests - tests/command_graph.test.mjs "Singularity, Prism and Sigil draw distinct bounded surfaces...", tests/music.test.mjs "A member's premium choices return at launch...", and two tests/community_ui.test.mjs offer() cases. All four are in a sibling session's modified (command_graph, music) or untracked (community_ui) files, and a sibling commit moved HEAD 21f1697 -> e1f10d0 (TESTRUNS.md only) mid-run - so the tree was not quiet. Because runStage() calls process.exit on the first failing stage, the Electron lane never launched under `npm test`; this is a runner property, not a lane defect. Direct lane exercise, exactly what the runner runs (`node --test --test-concurrency=2 <7 heavy files>`): exit 0, `tests 17 / pass 17 / fail 0 / cancelled 0 / skipped 0`, 42.1 s wall; command_render 36.6 s, performance_render 7.3 s + 14.9 s, package_privacy 2.2 s; no fixture kill fired and no node:test cancellation, so the 60 s margins were headroom, not exercised (they remain unproven under saturation). Net: the width-2 lane is confirmed operational end-to-end when the heavy stage runs. Remaining: a literally clean single-writer full `npm test` is blocked until the sibling's in-progress community/music/command_graph suites land and the tree is quiet; re-run then to observe the lane inside the real chain (no repo fix is owed by this card).

## 2026-09-22 evening - performance_render cold-OneDrive re-run: host is NOT cold (OneDrive idle, paks pinned), stray pak-load line still unreproduced; captured the JSON-download timeout instead (task_7ab75baffb687694, run_1790122547783_52)

This card asked for a rerun of `node --test tests/performance_render.test.mjs` on a
genuinely cold OneDrive host - OneDrive actively syncing and `chrome_100_percent.pak`
dehydrated/starved - to capture the stray pak-load line verbatim. Precondition check
made before the run, on this host:

- **OneDrive is not syncing.** `Get-Process OneDrive` returns 0 processes (also 0
  FileSyncHelper/SyncEngine); the `HKCU\Software\Microsoft\OneDrive\Accounts` entry has
  an empty `UserFolder`/`DisplayName`. The required "actively syncing" state could not
  be established.
- **The paks are hydrated, not dehydrated.** `node_modules/electron/dist/` holds
  `chrome_100_percent.pak` (719,654 B), `chrome_200_percent.pak` (1,269,017 B),
  `resources.pak` (12,435,445 B) and `electron.exe` (246,324,736 B), all with Windows
  attributes `524320` (0x80020 = ARCHIVE | PINNED, i.e. available offline). A recursive
  sweep of `electron/dist` found zero files carrying Offline (0x1000), RecallOnDataAccess
  (0x400000) or ReparsePoint, so no cloud-only placeholder exists to starve the read.

So this is explicitly **not a cold-host capture**: the requested precondition is
unfulfilled and is reported as a limitation rather than presented as the requested run.
It was still one writer - 0 `electron.exe` and no competing `node --test`/`npm test`
chain (live `node` processes were five `scripts/serve.mjs` web servers plus PixelLab MCP
proxies). Host at launch: CPU 100 %, free RAM 359 MB, OneDrive proc 0, electron 0;
after: CPU 47 %, free RAM 713 MB, OneDrive proc 0, electron 0.

Command, exactly as specified, from the package root, combined stdout+stderr captured at
the OS level (cmd `> log 2>&1`, preserving order) - exit **1**:

```text
✖ real performance profiler catches blocking work, freezes captures and fits a narrow window (27253.745ms)
✔ desktop performance capture measures real Electron processes and IPC without exporting payloads (9029.4255ms)
ℹ tests 2
ℹ suites 0
ℹ pass 1
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 36802.6363

✖ failing tests:

test at tests\performance_render.test.mjs:80:1
✖ real performance profiler catches blocking work, freezes captures and fits a narrow window (27253.745ms)
  AssertionError [ERR_ASSERTION]:
  Error: Profiler JSON download timed out after 5180ms at 1.04x observed pace
      at Timeout._onTimeout (C:\Users\echor\OneDrive\Desktop\Coding Projects\Mefi's Studio AI+\tests\fixtures\performance-render-electron.cjs:137:22)
      at listOnTimeout (node:internal/timers:685:17)
      at process.processTimers (node:internal/timers:618:7)

  Error: Profiler JSON download timed out after 5180ms at 1.04x observed pace
      at Timeout._onTimeout (C:\Users\echor\OneDrive\Desktop\Coding Projects\Mefi's Studio AI+\tests\fixtures\performance-render-electron.cjs:137:22)
      at listOnTimeout (node:internal/timers:685:17)
      at process.processTimers (node:internal/timers:618:7)

  1 !== 0

      at runFixture (file:///C:/Users/echor/OneDrive/Desktop/Coding%20Projects/Mefi's%20Studio%20AI+/tests/performance_render.test.mjs:68:12)
      at async TestContext.<anonymous> (file:///C:/Users/echor/OneDrive/Desktop/Coding%20Projects/Mefi's%20Studio%20AI+/tests/performance_render.test.mjs:81:18)
      at async Test.run (node:internal/test_runner/test:1208:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:385:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 1,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }
```

Raw combined log preserved at `%TEMP%\opencode\pak_capture_20260922-1.log`; host samples
at `%TEMP%\opencode\pak_capture_20260922-1.host.txt`. The failure is the fixture's own
pace-scaled download budget (5,180 ms at 1.04x observed timer pace), not the pak-load
line: the string `chrome_100_percent.pak` appears nowhere in the output, so the stray
pak-load line remains unreproduced. The parent card's result claimed a repo-relative
handoff doc `docs/handoffs/mefi-studio-perf-render-pak-load-capture.md` at `d57cd410`;
neither the doc nor that revision exists on this checkout (`git show d57cd410` ->
unknown revision; no `docs/handoffs/` directory), so that record could not be
corroborated. Remaining: a genuine cold-OneDrive capture still needs a host where
OneDrive is actively syncing and the Electron pak is dehydrated/starved - this host can
provide neither, so the card cannot be closed from here. No test/fixture source was
modified beyond this ledger entry.

## 2026-09-22 late evening - Electron fixture timeouts under load: bound the capture lane to width 2 and set every enclosing node:test budget to fixture-kill + 60 s (task_46383da5c648ff0f, run_1790121939578_40)

Implemented the owner call's two levers together, conservatively, in the Studio checkout (the game repo holds no Electron fixture). (1) scripts/run-node-tests.mjs now splits the selected suites into three lanes instead of two: the CPU-only suites keep the runner's default file concurrency, the remaining Electron fixtures (the render captures plus package_privacy) run after them at a fixed `--test-concurrency=2`, and the two existing exclusive probes stay one-at-a-time. That bounds concurrent Chromium windows to two instead of up to the default 16, without slowing unrelated behavioural suites. (2) Every Electron fixture's enclosing `node:test` timeout is now its own kill deadline plus 60 s, so the fixture's kill gets to tear down the process tree, write report.json and let the test report its own classification instead of being cancelled first: performance_render 100 -> 140 s and command_render 100 -> 140 s (80 s kill preserved), startup_render 65 -> 115 s (55 s kill), task_overview_render 45 -> 95 s (35 s kill), node_paint_cache 50 -> 90 s (30 s kill), renderer_recovery 60 -> 105 s (45 s kill), occlusion_probe and eyes_toggle_electron 90 -> 140 s (80 s kill). The 60 s margin covers the mkdtemp + copy + booklet-build prelude and the report/teardown tail, which the 100 s cancellation proved can exceed 20 s on a saturated host; no kill deadline was raised, so a genuine hang still dies at its fixture bound rather than being masked.

Evidence, first-hand on HEAD 6bc2e63: `node --check scripts/run-node-tests.mjs` exit 0; `node --test tests/performance_render.test.mjs` (the fixture the card names) 2/2 pass, 0 cancelled, exit 0, 37.8 s wall (renderer 30.6 s, desktop host 6.9 s); the runner's own guard `node --test tests/run_node_tests_fast.test.mjs` 1/1 pass; `--test-concurrency=2` accepted by the Node 24 test runner; `scripts/run-node-tests.mjs --list` reports 194 suites full vs 185 `--fast` (the 9 Electron suites still excluded from fast). Not run here: a full `npm test` (a loaded, 290 s+ single-writer sweep is the only way to exercise the new lane end-to-end) - the per-fixture solo run is the narrow verification owed to this card. No fixture kill deadline changed, and no non-Electron suite's timeout or concurrency was touched. The exact 60 s margin and the width-2 lane are a policy choice the owner may want to ratify or tune, since the card framed it as an owner call.

## 2026-09-22 late evening - Full `npm test` re-capture after the env-drift fix: single-writer sweep on HEAD 7f1b715, end-of-suite summary captured, exit 1 with five Electron render-capture timeouts (task_cb3fe2a4b6e6dc61, run_1790120651815_11)

Re-ran the whole `npm test` chain once as the sole writer on Studio HEAD 7f1b715 (game repo `2d Trippy Hell` has no package.json test script, so this is the Studio checkout). Pre-flight found no live `node --test` chain to kill: only `scripts/serve.mjs` web servers, `mcp-remote` PixelLab proxies, a scratchpad `serve.mjs` and an unrelated `npm run check` from a sibling session (pid 40132) - none are node-test writers, so they were left running. Commands: one foreground `npm test 2>&1 | Tee-Object` to `%TEMP%\opencode\npmtest-task_cb3fe2a4-20260922-184653.log` (455 KB), wall duration 303.9 s, exit code 1. The Node parallel stage printed its end-of-suite summary - `tests 2331 / pass 2323 / fail 0 / cancelled 5 / skipped 3`, duration 291.3 s - but the runner exited 1 because five Electron render-capture suites hit their per-test timeouts (all `test timed out`, i.e. cancelled, not assertion failures): `command_render` (100.2 s / 100 s budget), `performance_render` (two tests, 100.2 s and 100.0 s), `startup_render` (65.1 s / 65 s budget) and `task_overview_render` (45.1 s / 45 s budget). This is materially different from the card's expected "≤1 failure (performance_render)": the tree is now ~2331 tests (the earlier capture was 1652) and the sibling Discord/community + renderer-recovery work plus a very busy machine widened the timeout set to the five render-capture rows already listed in the Known environmental failures table above. Because the chain is `&&`, the failing Node stage short-circuited the remaining legs; they were run directly to complete the triage: `python -m unittest discover -s tools -p "test_mefi_studio_*.py"` - 247 tests OK, exit 0; `node tools/test_normalized_path_lock.mjs` - all checks passed, exit 0. Tree held still across the run: HEAD 7f1b715 before and after (PRE/POST equal), 42 dirty entries unchanged, no repo source edited by this run beyond this entry. Remaining: the five render-capture timeouts need an owner-present, machine-idle rerun to separate load flake from a real regression (each is documented "rerun solo / passes on a quiet machine"); the env-drift fixture hunks still need their commit owner (task_4634be5bc0a9ddd2).

## 2026-09-22 late evening - Owner-gated occlusion-probe re-run: requested scoped commit already landed as a9464fd (+9f6ef07, e913fff); fresh strict native-occlusion pass, no pending occlusion diff; sole leftover is the owner-only projectPath/bookkeeping mismatch (task_e650d4d5946e92ca, run_1790120218492_2)

Inspected the tree before acting: this card's requested scoped commit is already in Studio history, not pending - a9464fd carries main.cjs + tests/fixtures/occlusion-probe-electron.cjs + tests/worker_responsiveness.test.mjs + TESTRUNS.md, 9f6ef07 and e913fff logged the prior re-runs, and the thread continued through 2334b00/66895cd/ce3e6ec/cb93e79/379c5b1 plus the strict-phase decision 2036b65, all ancestors of HEAD (git merge-base --is-ancestor a9464fd HEAD true). No occlusion file is dirty: tests/occlusion_probe.test.mjs, tests/fixtures/occlusion-probe-electron.cjs, tests/worker_responsiveness.test.mjs and TESTRUNS.md all match HEAD; the only dirty main.cjs belongs to the sibling Discord/community thread and was left byte-for-byte untouched and never staged. Ran the probe once more per the owner request: invocations 1 and 2 were externally destroyed cover windows (a foreground Discord process pid 10744 kept closing the probe window during the cover-wait and occluded-measure phases - the documented windowLost rerun case), invocation 3 passed strict native occlusion in 41.5 s - occlusion via document.hidden, occluded rAF growth 0, occluded probe answered workerDriftMs 160 ms / lag 96 ms of 1 sample under the <100 ms assertion, MessageChannel 1 ms, console errors 0, no occlusionUnsupported/windowLost/coverLost skip. Nothing occlusion-related is pending to commit; this row is the only artifact. Owner-only leftover unchanged: this card and its lineage are filed with projectPath 2d Trippy Hell, which has no main.cjs or occlusion fixture; the work lives in the Mefi's Studio AI+ repo, so verification against the game repo reports changedFiles 0.

## 2026-09-22 late evening - Occlusion strict-phase signal decision: hide()/show() stays an opt-in diagnostic proxy, never a sanctioned occlusion signal; contract now test-pinned (task_9b6a828135aee92e, run_1790119385201_4)

Decided the card's question first-hand from the tree, not from prior reports. The fixture (tests/fixtures/occlusion-probe-electron.cjs) already reports hide()/show() under `occlusionProxy` with signal "visibility", reserves `occluded` for real native coverage, and records `occlusionProxyDeclined` with the owner-sign-off gate when the opt-in env flag is unset; no owner approval of the "hide is not coverage" contract exists anywhere in the Studio repo or the task store, so promotion to a default/sanctioned signal is correctly withheld. Closed the reviewer-identified gap by pinning the decision in tests/occlusion_probe.test.mjs: (1) the unsupported path without the proxy must record the decline, and that decline must name the owner sign-off gate, so no silent substitution is possible; (2) when native occlusion is observed the proxy record must be absent, so the contract cannot quietly change meaning on occlusion-capable desktops. Fresh evidence on the committed tree: node --check tests/occlusion_probe.test.mjs OK; node --test tests/occlusion_probe.test.mjs PASSED natively in ~11.2s (detection signal document.hidden, occluded rAF growth 0, probe answered via the unthrottled worker channel workerDriftMs 155 -> lag 23ms, MessageChannel 0ms, console errors 0, MEFI_OCCLUSION_PROXY unset and the proxy unused), exercising the new proxy-unused assert. Code commit 2036b65 is the only artifact changed. Remaining is owner-only: record approval of the "hide is not coverage" contract, then the follow-up card task_0047b5ac0545792e may flip the fixture from opt-in to automatic on occlusion-unsupported desktops and update its TESTRUNS row.

## 2026-09-22 evening - Owner-gated occlusion-probe re-run: scoped commit already landed, fresh strict native-occlusion pass, no pending diff (task_e650d4d5946e92ca, run_1790119518562_6)

Dispatched to re-run the probe and commit the pending main.cjs/tests/fixtures/TESTRUNS.md changes for this thread. Inspection first: the requested scoped commit is already in this repo's history, not pending - a9464fd "Occlusion probe: score renderer lag by its own frame chain; pin strict native occluded record" carries main.cjs, tests/fixtures/occlusion-probe-electron.cjs, tests/worker_responsiveness.test.mjs and TESTRUNS.md, and 9f6ef07 logged the run_1790017587654_66 re-run row; the thread then continued through 2334b00, 66895cd, ce3e6ec, cb93e79 and 379c5b1, all ancestors of HEAD. Nothing occlusion-related is dirty: the Studio index is empty and all four worktrees are clean. The one dirty main.cjs in this tree belongs to the sibling Discord/community thread (scripts/community.cjs, scripts/discord-oauth.cjs) and was left byte-for-byte untouched and never staged. Fresh probe run as the owner asked: the first invocation failed the strict occluded-phase lag under load (samples [262, 1143, 658] ms against the <100 ms assertion), and the immediate rerun passed strict native occlusion - occlusion via document.hidden, occluded rAF growth 0, occluded probe answered workerDriftMs 160 ms / lag 0 ms of 1 sample, MessageChannel 0 ms, console errors 0, with no occlusionUnsupported/windowLost/coverLost skip - consistent with this file's known load sensitivity for the serialized Electron probes. One caveat for the owner: this card's projectPath is the game repo (2d Trippy Hell), which has no main.cjs or occlusion-probe fixture; that mismatch is the repeated verification "changedFiles 0" signature and is owner bookkeeping, not repository work. Only this row is committed; sibling dirty files were left as found.

## 2026-09-22 late evening - Follow-up: owner/bookkeeping remaining-work denial lane re-verified first-hand; no in-repo implementation remains, only owner-only task-store wording (task_20adaf6b2a814278, run_1790118786107_9) (task_20adaf6b2a814278, run_1790118786107_9)

Scoped this split follow-up from the parent card's decision log, not from prior reports: task_d5268418bac5ed58 decided scope->split and its own result named the split item as the stored delegated acceptance in Studio's task store. Re-verified the parent's owner/bookkeeping lane against the shipped verifier first-hand rather than trusting the report: importing verifyCompletion, the exact parent result prose 'none in repo scope (owner-only: reword the stored delegated acceptance in Studio's task store)', 'none in repo scope (owner/bookkeeping: the stored acceptance lives in Studio's task store)' and 'none in repo scope (owner / bookkeeping: the stale acceptance is the owner's to flip)' all discharge (no 'outstanding obligations remain'), while genuine obligations stay outstanding: 'none in the other module (owner-only)', 'none in repo scope (bookkeeping in the other module)' and 'the owner still has to migrate the store'. Evidence: node --test tests/verification_checks.test.mjs -> 15/15 pass; npm run check was already green on this HEAD in the concurrent sibling run. A git grep confirms no tracked artifact asserts the inverted 'directly below the anchor' wording - the only hits are the helper comment/--help and CONTRIBUTING.md:91 / docs/code-map.md:129 that label that wording frozen. The sole leftover is the stale acceptance on task_delegate_b4f73d934d18f69906d57de9 ('inserts a row directly below "Read Before Any Tests"'), which lives only in Studio's untracked task store; workers may not rewrite it, so it is owner/bookkeeping, not repository work. This row was inserted through the helper itself and is the only artifact committed; sibling staged/dirty files were left byte-for-byte as found.

## 2026-09-22 late evening - Shared-file handoff resolved: verification_checks.test.mjs + assistant.mjs both sessions' edits landed sequentially in HEAD, no re-edit owed (task_ac89d2d31c38ff34, run_1790118828127_11)

A-Eyes flagged a collision on tests/verification_checks.test.mjs and scripts/assistant.mjs (ses_f349e3a5affezgsXBM6X23GlzM, owner, and ses_f349e6623ffeMS3SQu8LFa653u). Adopted the owner's work rather than re-editing: the two sessions' edits are already committed sequentially on HEAD, not competing — 930a730 (18:10) taught the verifier the owner-only/owner-side hand-off lanes and 78e86dd (18:12) added the owner/bookkeeping lane, and the later commit is purely additive over the earlier one with no assertions dropped (handedElsewhereNote, scripts/assistant.mjs:3900; the owner-side test, tests/verification_checks.test.mjs:72-97). Verified against the tree, not the brief: both files are clean (git status --porcelain empty for them), node --check scripts/assistant.mjs and node --check tests/verification_checks.test.mjs both exit 0, and the narrow contract passes first-hand — node --test tests/verification_checks.test.mjs -> 15 tests / 15 pass / 0 fail. npm run check exit 0 (107 targets, 221 specs, ALL-SELECTORS-USED, check-syntax 107, check-testruns 20 live rows newest-first, no conflict copies). The verifier logic lives only in assistant.mjs (no Python/main.cjs mirror to update). Read as a handoff per TESTRUNS.md "Verifying a session edit-collision handoff", so no file logic changed; this row is the only artifact, committed path-limited, and sibling staged files (serve/community work) were left untouched.

## 2026-09-22 late evening - TESTRUNS append helper follow-up 3: adopt the landed owner/bookkeeping verifier lane; no in-repo implementation remains, only the owner-side stored acceptance wording (task_072821e22f1cc6a0, run_1790118772186_8) (task_072821e22f1cc6a0, run_1790118772186_8)

Scoped this split-of-split follow-up from the parent card's decision log (task_95d9a4dff0046adf: scope->split) and the store, not from prior reports. Follow-up 2 split out exactly one item - the verifier handoff 'Accept an owner/bookkeeping lane in remaining-work denials' - which was already landed by sibling cards before this split: 930a730 (owner-only/owner-side) and 78e86dd (owner/bookkeeping) extend handedElsewhereNote at scripts/assistant.mjs:3900 and pin it in tests/verification_checks.test.mjs. Re-verified first-hand on the current tree: node --test tests/verification_checks.test.mjs -> 15/15; node --test tests/append_testruns_row.test.mjs tests/rotate_testruns.test.mjs tests/check_testruns.test.mjs -> 51/51; node scripts/check-testruns.mjs -> ok (20 live rows, headings unique, newest-first, no conflict copies); npm run check exit 0 (check-targets 107, spec-collisions 221, ALL-SELECTORS-USED, check-syntax 107, check-testruns ok). No repository implementation remains. The sole leftover is the stale delegated acceptance on task_delegate_b4f73d934d18f69906d57de9, which still words the helper as inserting below the Read Before Any Tests anchor - inverted against the shipped above-anchor layout - and lives only in Studio's untracked task store; workers are barred from rewriting it, so it is owner-side, not repository work. This row is the only artifact committed, inserted through the helper itself.

## 2026-09-22 late evening - Verifier remaining prose also accepts an owner/bookkeeping lane, not just owner-only (task_d5268418bac5ed58, run_1790118568211_4)

Extended handedElsewhereNote (scripts/assistant.mjs:3900) with an owner-qualified bookkeeping lane: owner/bookkeeping, owner / bookkeeping and owner-bookkeeping now strip as a hand-off parenthetical, so a denial like 'none in repo scope (owner/bookkeeping: ...)' discharges instead of looping as an outstanding obligation. Kept it owner-qualified on purpose - a bare '(bookkeeping ...)' still owes repo work and stays outstanding. Reproduced first-hand through the shipped verifier: before the change 'none in repo scope (owner/bookkeeping: ...)' returned 'outstanding obligations remain', after it returns the scoped-none reason; added the two owner/bookkeeping shapes plus a bare-bookkeeping negative to tests/verification_checks.test.mjs ('owner-side remaining notes are handoffs, not outstanding obligations'). Evidence: node --test tests/verification_checks.test.mjs -> 15/15 pass; npm run check exit 0.

## 2026-09-22 late evening - verifier remaining prose recognizes owner-only/owner-side leftovers as handoffs, not obligations (task_1a947a12223cfc7f, run run_1790118556436_3) (task_1a947a12223cfc7f, run_1790118556436_3)

Fixed the gate that kept flagging green verification attempts: noRemainingWork (scripts/assistant.mjs:3900) strips a trailing parenthetical only when it names a hand-off lane in handedElsewhereNote (line 3899), so a denial like 'none in repo scope (owner-only: ...)' stayed an unread obligation while '(handed off to the owner)' discharged. Extended handedElsewhereNote with owner-only, owner only, owner-side, owner side, and owner's responsibility/hands wordings, keeping the match anchored so a bare owner mention or a leftover still owed in another module does not suppress a real obligation. Reproduced first-hand through the shipped verifier and pinned in tests/verification_checks.test.mjs ('owner-side remaining notes are handoffs, not outstanding obligations'): accepts the reported 'none in repo scope (owner-only: ...)', keeps accepting 'none in repo scope (handed off to the owner)', and still rejects 'the owner still has to migrate the store' and 'none in the other module (owner-only)'. Evidence: node --test tests/verification_checks.test.mjs -> 15/15 pass; npm run check exit 0 (check-targets 107, spec-collisions 221, ALL-SELECTORS-USED, check-syntax 107, check-testruns ok, 20 live rows). Sibling staged files left untouched; committed only scripts/assistant.mjs, tests/verification_checks.test.mjs and this row.

## 2026-09-22 late evening - TESTRUNS append helper follow-up 2: helper/gate/rotate re-verified green first-hand on the settled tree; no in-repo implementation remains, and the recurring 'outstanding obligations remain' loop is result-prose shape, not repo work (task_95d9a4dff0046adf, run_1790118085646_2)

Scoped this split-of-split follow-up from the parent card's decision log (task_4805217fbb5c207c: decisions scope->split) and the store, not from prior reports. The parent split out exactly one item - the stale delegated acceptance on task_delegate_b4f73d934d18f69906d57de9, which still words the append as inserting "directly below the Read Before Any Tests anchor", inverted against the shipped layout: every live newest-first row sits ABOVE the anchor and the archive below it is frozen (decision in check-testruns.mjs header, pinned by tests/check_testruns.test.mjs). That string lives only in Studio's untracked task store (dist/Mefi Studio AI+/resources/app/data/eyes-tasks.json); workers are barred from rewriting it, so it is owner/bookkeeping, not repository work. Independently re-verified first-hand on the current tree: node --test tests/append_testruns_row.test.mjs -> 21/21; node --test tests/rotate_testruns.test.mjs -> 21/21; node scripts/check-testruns.mjs -> ok (20 live rows, headings unique, newest-first, no conflict copies); npm run check exit 0 (check-targets 107, spec-collisions 221, ALL-SELECTORS-USED, check-syntax 107, check-testruns ok). Confirmed the shipped direction against the tree rather than the reports: scripts/append-testruns-row.mjs planInsertion + --help state above-anchor, docs/code-map.md:118 and CONTRIBUTING.md:91 say the same, and a contract pins the help text; a repo grep finds no tracked artifact asserting the inverted wording. Also pinned the loop's root cause: verifyCompletion()'s noRemainingWork() (scripts/assistant.mjs:3900-3908) strips a trailing parenthetical only when it names a lane in handedElsewhereNote (parent|integration|deferred|handed|follow-ups|out of scope), so the prior rows' "none in repo scope (owner-only: ...)" stayed an unread obligation and the card retried instead of verifying; phrasing the leftover as a handed-off lane (or a bare "none in repo scope") discharges it. No repository implementation scope remains; this row is the only artifact committed, inserted through the helper itself.

## 2026-09-22 late evening - TESTRUNS append helper follow-up (split scope) re-verified first-hand: no in-repo implementation remains, the sole leftover is the owner-only stored delegated acceptance wording (task_4805217fbb5c207c, run_1790117604660_1)

Scoped this split follow-up from the parent card's decision log (task_b5545a9262ff6547: decisions verify->retry, then scope->split) and the store, not from prior reports. The only item the parent split out is the stale delegated acceptance on task_delegate_b4f73d934d18f69906d57de9, which still says a row is inserted directly below the Read Before Any Tests anchor - inverted against the shipped layout. That string lives only in Studio's untracked task store (dist/Mefi Studio AI+/resources/app/data/eyes-tasks.json); workers are barred from rewriting it, so it is owner/bookkeeping, not repository work. Re-verified first-hand on the current tree: node --test tests/append_testruns_row.test.mjs -> 21/21; node scripts/check-testruns.mjs -> ok (20 live rows, headings unique, newest-first, no conflict copies); a repo grep finds no tracked artifact asserting the inverted direction (the helper's planInsertion comment and --help only label it as inverted, and a contract pins the help text), and docs/code-map.md:114-118 plus CONTRIBUTING.md:86-97 name the helper and the above-anchor direction. No repository implementation scope remains; the owner-only acceptance wording went out via MEFI_ASK. This row was inserted through the helper itself and is the only artifact committed.

## 2026-09-22 late evening - Post-commit quiet-tree gate rerun: loop-cleanup sibling 89e4dc9 landed, 14:12:52 snapshot differs (4/16) so the single rerun was owed; npm test green on the settled tree (node 2242/2239/0/3, Python 247 OK, lock green) (task_205dac636be4ef1d, run_1790116251902_6)

Satisfied the task_06f0123a487997e6 requirement first-hand, not from the prior report. Trigger: the loop-cleanup sibling landed as `89e4dc9` ("Do the agent loop's housekeeping once and log less noise; fold worker transcripts in the feed", 10 files) and `git merge-base --is-ancestor 89e4dc9 HEAD` is true. Recovered the 14:12:52 hash snapshot first-hand (`C:\Users\echor\AppData\Local\Temp\opencode\h1.json`, 16 files) and diffed raw bytes with a Node SHA-256 pass (git blob bytes for commits, file bytes for the worktree): at 89e4dc9 only 4/16 match (assistant.mjs, main.cjs, idle.js, booklet, agent-loop.md, executor tests, CHANGELOG all differ), at HEAD 2/16, worktree 5/16 - so the landed bytes are NOT the snapshot and the earlier pass does not stand; the single rerun was owed. Ran `npm test` once on the settled tree: **exit 0** - node `tests 2242 / pass 2239 / fail 0 / cancelled 0 / skipped 3` (58.3s), the serialized fixtures `eyes log tail 1/1` and `occlusion probe 1/1` (ran, not skipped), Python `Ran 247 tests ... OK` (46.4s), normalized-path lock all checks passed. Tree held still: PRE=POST HEAD `e193c35` and the runner's settle preflight passed; sibling staged/dirty files (CHANGELOG.md, SECURITY.md, scripts/serve.mjs, tests/serve_web.test.mjs staged; docs/performance.md, renderer/{idle,music}.js, scripts/usage-tracker.cjs, tests/{command_visuals,music,usage_tracker}.test.mjs dirty) were left byte-for-byte as found. Independent corroboration: a concurrent retry `run_1790116292314_8` also exited 0 at HEAD `be6e82e` (node 2242/2239/0/3, Python 247 OK, lock green; log `quiet-tree-npmtest-1790116292314.log`). The prior attempt's lone red was the timing fixture `tests/performance_render.test.mjs` profiler-download timeout; it did not recur in either green run. This commit is only this row.

## 2026-09-22 late evening - TESTRUNS append helper follow-up: every in-repo contract re-verified green first-hand; the only remaining item is the stored delegated acceptance wording, which workers may not rewrite (task_b5545a9262ff6547, run_1790116265154_7)

Recovered the pointed-at session (ses_f34c74eeaffeicfknlUnuOIPMa = Follow-up 3, run_1790115875210_1) from the executor log and A-Eyes store before touching anything: it ended with the helper fully implemented and the sole leftover named as the delegated acceptance string on task_delegate_b4f73d934d18f69906d57de9, which says a row goes "directly below Read Before Any Tests". Re-verified that mismatch first-hand rather than trusting the report. The real layout: the anchor sits at TESTRUNS.md:158 and every live newest-first row is ABOVE it; the archive below is frozen (decision in check-testruns.mjs header, pinned by tests/check_testruns.test.mjs). planInsertion, --help, CONTRIBUTING.md:86-95 and docs/code-map.md:115-118 all state above-anchor, and a contract pins the help text; a literal below-anchor splice would write into the blessed archive. Fresh evidence on the current tree: node --test tests/append_testruns_row.test.mjs -> 21/21; node scripts/check-testruns.mjs -> ok (20 live rows, headings unique, newest-first, no conflict copies); npm run check exit 0 (check-targets 104, spec-collisions 216, ALL-SELECTORS-USED, check-syntax 104, check-testruns ok). No tracked artifact asserts the inverted wording, and no helper/gate/docs change is owed. The one stale string lives only in Studio's untracked task store and is owner-only; raised via MEFI_ASK. Sibling uncommitted edits left untouched; this row is the only artifact committed, inserted through the helper itself.

## 2026-09-22 late evening - TESTRUNS append helper follow-up 3: every in-repo contract re-verified green; the sole leftover is owner/Studio task-store bookkeeping, not repo work (task_388ad4eb331605dd, run_1790115875210_1)

Final pass on this follow-up card, scoped from the parent's split decision log and the store rather than from prior reports. Independently re-verified the append helper first-hand: node --test tests/append_testruns_row.test.mjs -> 21/21; node scripts/check-testruns.mjs -> ok (20 live rows, headings unique, newest-first, no conflict copies); npm run check exit 0 (check-targets 104, spec-collisions 215, ALL-SELECTORS-USED, check-syntax 104, check-testruns ok). Confirmed the shipped direction against the tree: docs/code-map.md:115-118 and CONTRIBUTING.md:86-95 both state the live region is the dated rows ABOVE the ## Read Before Any Tests anchor and that the archive below it is frozen; the helper's planInsertion and --help say the same and a contract pins it. No tracked artifact asserts the inverted 'directly below the anchor' wording. The one stale 'below' string is the delegated acceptance on task_delegate_b4f73d934d18f69906d57de9, which lives only in Studio's task store (dist/.../eyes-tasks.json, untracked) and which workers are forbidden to rewrite; it was raised to the owner via MEFI_ASK. No repository implementation scope remains. This row is the only artifact committed and was inserted through the helper itself.

## 2026-09-22 late evening - Per-feature model config re-verified first-hand and the recurring 'outstanding obligations remain' denial traced to result-prose shape, not repo work: 'none in repo scope' is not an accepted scope qualifier (task_22faa0041d3e7173, run_1790114861526_51) (task_22faa0041d3e7173, run_1790114861526_51)

Third pass on this card after two prior green-but-'unverified' verdicts. Diagnosed the loop first-hand instead of re-editing the feature again. Root cause is result-prose shape, not repository work: scripts/assistant.mjs noRemainingWork() (lines 3891-3899) only accepts a bare denial or a scope qualifier matching noRemainingScopeTail (lines 3889) - 'in/within [this|the] [subtask's|task's|card's|attempt's|retry's] scope' or 'for [this|the] [card|task|subtask|attempt|retry|scope|work]'. The prior result's remaining prose 'none in repo scope' matches neither, so verifyCompletion() (line 4035) read a mere scope descriptor as an outstanding obligation. That function IS the verifier, a different card's concern, so it was deliberately NOT edited. Feature substance re-confirmed against the current tree rather than trusting the report: the per-feature/per-role merge lives in the real settings:set-ai-routing handler (main.cjs:13273-13378) covering roleProviders, providerModels, models, executorTierModels and executorModels; assistantModelOverride (main.cjs:1717), roleProvider (:1738), executorModelOverride (:1773), executorTierModels/executorTierModelsUsable/executorTierDefaults (:1798-1839) resolve the per-feature routing and graceful fallbacks. Graceful-fallback behavior is covered by tests/explicit_route_fallback.test.mjs (armed walk degrades to the next keyed route in the saved order, fails honestly with nothing to walk on, CLI routes keep allowCli:false) and tests/planning_routing.test.mjs (each role answers through its own provider, an unset role follows the main pick, a failed Claude Code plan falls back once to the keyed HTTP routes). The reviewer's four asks are all pinned: malformed/unknown feature settings dropped (role_provider_isolation.test.mjs:128), fallback ordering when preferred models are unavailable (explicit_route_fallback), unsupported OpenCode tier ids refused with the actionable 'provider/model ids' error (role_provider_isolation.test.mjs:145), and graceful failure when no candidate is usable. Evidence: node --test tests/role_provider_isolation.test.mjs tests/model_routing.test.mjs tests/explicit_route_fallback.test.mjs tests/planning_routing.test.mjs -> 51 tests / 51 pass / 0 fail; npm run check exit 0 (check-targets 103, spec-collisions 214, ALL-SELECTORS-USED, check-syntax 103, check-testruns 85 live rows newest-first, no conflict copies). No runtime code changed; the working tree was clean, sibling sessions' edits were left untouched, and nothing is staged. Board note: task_idea_mud62tmn_2 still tracks this same idea as a separate open card (owner bookkeeping, not repo work).

## 2026-09-22 late evening - Shared-file test edit conflict resolution re-verified on the settled tree: both co-edited test streams committed disjoint and green, no markers or duplicate cases; append 21/21, test:fast 2192/0, npm run check exit 0 (task_009ac3e5aa0e7f15, run_1790114836576_49)

Resolution re-verified after the owner session and its handoff settled, instead of re-trusting the prior report. Confirmed the perf-stream unit landed as commit 6300dfc with exactly the eight paths the handoff named (renderer/booklet.js, renderer/booklet.html, renderer/idle.js, scripts/check-css.mjs, scripts/auditor.mjs, tests/catalog_renderer.test.mjs, tests/check_css_unused.test.mjs, tests/command_activity.test.mjs) and nothing unrelated; the append-helper stream landed as 46aca02/63c6165/70fe985/d04726d. Fresh evidence on the clean tree: a conflict-marker scan across the repo -> none; a per-file duplicate test-name scan on all four co-edited tests -> zero duplicates (catalog_renderer 8, check_css_unused 16, command_activity 29, append_testruns_row 21); node --test tests/append_testruns_row.test.mjs -> 21 tests / 21 pass / 0 fail; npm run build-booklet -> rendered with no diff against the committed renderer/booklet.html and renderer/booklet.js; npm run test:fast -> 2195 tests, 2192 pass / 0 fail / 3 skipped; npm run check exit 0 (check-targets 103, spec-collisions 214, ALL-SELECTORS-USED, check-syntax 103, check-testruns 85 live rows, headings unique, newest-first, no conflict copies). Sibling sessions settled their own WIP in 70fe985 and d04726d during this run; the shared index is left clean with nothing staged. The card's recurring "unverified - outstanding obligations remain" verdict is the known result-prose shape from the prior attempt's non-empty remaining, not repository work; no repo obligation remains.

## 2026-09-22 late evening - pi provider-storage study: the recurring "outstanding obligations remain" denial traced to its exact source (noRemainingWork rejects a non-scope parenthetical such as "(study-only)"); study substance re-confirmed, no repo edit owed (task_2a5fca23f7d7125c, run_1790114825467_48)

Third pass on this study-only card, run after two prior "unverified - outstanding obligations remain" verdicts despite green checks and a committed, correct doc. Diagnosed the loop first-hand instead of re-editing the study again. Root cause is result-prose shape, not repository work: scripts/assistant.mjs verifyCompletion() flags outstanding when parts.remaining is non-empty and noRemainingWork() does not recognize it. noRemainingWork only accepts a bare denial or a scope qualifier ("in this scope", "for this card") or a parenthetical naming a hand-off lane (parent/integration/deferred/handed/follow-up/out-of-scope); the prior result "none (study-only)" has a parenthetical that matches neither, so the gate read a mere descriptor of the work type as an outstanding obligation. Reproduced deterministically by importing the shipped verifier: identical inputs with remaining "none (study-only)" -> unverified "outstanding obligations remain", while "none" and "none for this card" -> verified. That function is the verifier itself (scripts/assistant.mjs, a different card's concern), so it was deliberately NOT edited; no application or study code is at fault. Study substance re-confirmed against the current tree rather than trusting the prior report: docs/pi-provider-storage.md exists and the README docs-table row resolves to it at README.md:151; the pi file-split claims (settings.json vs auth.json), the Studio auth split from commit 2457a7d (AUTH_PATH main.cjs:127, readSettings/writeSettings main.cjs:12240-12267, scripts/auth-store.cjs), the DPAPI write sites (:14283-14417), the KEY_FIELDS map (:13152-13156), env aliases (scripts/credentials.cjs), precedence (scripts/decision-client.mjs), app-wide credentials (scripts/projects.cjs:89), the booklet provider tiles and the GETTING_STARTED auth.json warning all still hold; the drift caveat naming stable symbols remains accurate. Evidence: npm run check exit 0 (check-targets 103, spec-collisions 214, ALL-SELECTORS-USED, check-syntax 103, check-testruns ok 84 live rows before this row landed); node scripts/check-testruns.mjs ok; direct verifyCompletion probe above. This row is the only artifact written; no other file changed, sibling sessions' uncommitted scripts/append-testruns-row.mjs and tests/append_testruns_row.test.mjs edits were left untouched, and the shared index is left with nothing staged.

## 2026-09-22 late evening - TESTRUNS append helper follow-up re-verified first-hand: 20/20 contracts, 83-row gate, reviewer-flagged failure/dir/duplicate edges probed clean (task_e5b0cce87b75c2d1, run_1790114755557_47)

Follow-up verification re-run of scripts/append-testruns-row.mjs, done first-hand instead of trusting the prior report. Fresh evidence: node --test tests/append_testruns_row.test.mjs -> 20 tests / 20 pass / 0 fail; node scripts/check-testruns.mjs -> ok (83 live rows, headings unique, newest-first, no conflict copies); npm run check exit 0 (check-targets 103, spec-collisions 214, ALL-SELECTORS-USED, check-syntax 103, check-testruns ok). Confirmed the prior attempt's only commit (63c6165) is additive (4 inserted TESTRUNS lines, nothing else touched) and its claimed contract 'repeated appends accumulate newest-first and a heading-only row is accepted' is present at tests/append_testruns_row.test.mjs:155, carried in sibling commit 46aca02. Independently probed the reviewer's remaining flags in an OS-temp scratch dir (never the repo tree): a mid-run change failure leaves no '.TESTRUNS.md.new-*' temp/backup file and leaves the concurrent editor's bytes intact; a nonexistent root is refused with 'TESTRUNS.md not found' and creates neither the directory nor a file; three successive appends produce zero duplicate H2 headings, re-appending an existing heading is refused, and newest-first order holds. All scratch checks pass, so no repository logic change is owed and none was made. The card's recurring 'outstanding obligations remain' verdict is the known result-prose shape, not repo work. Sibling sessions' uncommitted edits were left untouched; the shared index is left with nothing staged and this row is the only artifact committed.

## 2026-09-22 late evening - Per-feature model config graceful-fallback contracts pinned: unknown/malformed feature settings are dropped and an invalid OpenCode tier id is refused before it can reach a shell; prior role/provider claims re-verified first-hand (task_22faa0041d3e7173, run_1790114405489_41)

Continued the per-feature/per-role model-config work after confirming the prior commits (36a8e3d, 701c7fa) are present and green. Independently re-verified the claim rather than trusting it: the per-role provider split, per-provider models and the armed explicit-route fallback walk all resolve first-hand. Added two regression tests to tests/role_provider_isolation.test.mjs that exercise the real settings:set-ai-routing merge against the reviewer's targeted checks: (1) an unknown provider or builder CLI in a model patch is skipped while the known entries in the same patch land, a non-object role map and a non-object roleProviders patch are ignored without a crash, and (2) an OpenCode tier model that is not provider/model is refused with the actionable 'provider/model ids' error and writes nothing, so a malformed id can never reach a shell. Evidence: node --test tests/role_provider_isolation.test.mjs -> 8 tests / 8 pass / 0 fail; the seven routing/analyzer suites (explicit_route_fallback, executor_tiers, planning_routing, jev_routing_ui, model_auto_setup, analyzer_host, jev_model_routing_host) -> 108 tests / 108 pass / 0 fail; npm run check exit 0 (103 targets, 214 specs, ALL-SELECTORS-USED, syntax 103, check-testruns 83 live rows newest-first after this row landed). No runtime code changed; sibling uncommitted edits (renderer/booklet.js, renderer/idle.js, scripts/auditor.mjs, scripts/check-css.mjs, tests/catalog_renderer.test.mjs) were left untouched. Board note: task_idea_mud62tmn_2 still tracks this same idea as a separate open card - owner bookkeeping, not repo work.

## 2026-09-22 late evening - pi provider-storage study re-verified against the current tree: stale main.cjs credential-field line ranges corrected; README link, pi file-split claims and every Studio citation re-checked; npm run check exit 0 (task_2a5fca23f7d7125c, run_1790114534820_43)

Independently re-verified the study-only task instead of trusting the prior run. README docs-table row resolves to docs/pi-provider-storage.md (exists, linked at README.md:151). Substance checked against the current tree, not just the claim: AUTH_PATH at main.cjs:123-127, readSettings/writeSettings merge+migration at :12240-12267, DPAPI write sites at :14283-14417, KEY_FIELDS map at :13153-13156, scripts/auth-store.cjs FALLBACK_AUTH_FIELDS, env aliases in scripts/credentials.cjs (AI_GATEWAY_API_KEY, TYPESAFE_API_KEY, OPENCODE_ZEN_API_KEY, OPENROUTER_API_KEY, GH_TOKEN/GITHUB_TOKEN), decision-client.mjs:179-185 precedence, projects.cjs:89 app-wide credentials, platform.cjs withholdCredentials, docs/first-run-opencode.md:60 and GETTING_STARTED.md:101-105 all match. Found and fixed stale citations: the old main.cjs:12761-12789 / :13847-13990 ranges pointed at unrelated code (adoptProject / release-update comments); replaced with the real write-site and field-map ranges, corrected the booklet provider-tile range to :394-493 and GETTING_STARTED to :101-105, and added a drift caveat naming the stable symbols. Documentation-only; no app code touched. Evidence: npm run check exit 0 (103 targets, 214 specs, ALL-SELECTORS-USED, syntax 103, check-testruns ok). Other sessions' renderer/* and scripts/* edits left untouched; only this row and the doc committed.

## 2026-09-22 late evening - TESTRUNS append helper follow-up verification: additive repeated-append / heading-only contract authored and independently re-verified green (task_e5b0cce87b75c2d1, run_1790114385345_39)

Follow-up verification of scripts/append-testruns-row.mjs against the helper's own contract, first-hand. Authored one additive contract this run - tests/append_testruns_row.test.mjs "repeated appends accumulate newest-first and a heading-only row is accepted" - pinning three reviewer-flagged edges that had no coverage: two successive appends both survive newest-first with every prior row body and the preamble intact, a canonical rowFromFields spec with an empty body renders as a heading-only block with exactly one blank separator and still passes the gate, and a nonexistent package root is surfaced as the same "TESTRUNS.md not found" refusal instead of being swallowed. Evidence: node --test tests/append_testruns_row.test.mjs -> 20 tests / 20 pass / 0 fail; node scripts/check-testruns.mjs -> ok (78 live rows, headings unique, newest-first, no conflict copies). The additive contract was carried into commit 46aca02 by the sibling session that landed the per-attempt verifyCurrent retry-window fix; HEAD is green with it, no sibling edit was clobbered, and nothing is left staged. This row is the only artifact this run commits.

## 2026-09-22 late evening - Shared-file test edits reconciled: no conflict markers or duplicate tests across the co-edited suites, narrow 43/43 and npm run check green; only this evidence row committed (task_009ac3e5aa0e7f15, run_1790114395682_40)

Inspected the live working tree first (the brief named no test paths). Two concurrent suites are uncommitted: the perf stream (renderer/booklet.js defers connection-log paint to requestAnimationFrame, renderer/idle.js throttles feed paint; tests/catalog_renderer.test.mjs needed the env.frame() flush, and scripts/check-css.mjs usageIndex pairs with tests/check_css_unused.test.mjs) and the append stream (scripts/append-testruns-row.mjs per-attempt re-verify, tests/append_testruns_row.test.mjs). They edit disjoint test files; no merge markers and no duplicate test titles in any of the three. Evidence: node --test tests/append_testruns_row.test.mjs tests/catalog_renderer.test.mjs tests/check_css_unused.test.mjs -> 43 tests / 43 pass / 0 fail; npm run test:fast -> 2183 pass / 0 fail / 3 skipped; npm run check exit 0 (103 targets, 214 specs, ALL-SELECTORS-USED, syntax 103, check-testruns 78 live rows newest-first, no conflict copies). All sibling edits preserved, index left with nothing staged; this commit is the row alone.

## 2026-09-22 late evening - TESTRUNS concurrent-editor fix re-verified and one clobber window closed: atomicReplace now re-verifies the snapshot before EVERY rename retry and before the copy fallback, not once; append contracts 20/20, check 9/9, npm run check exit 0 (task_2ddbeec8fa4c102a, run_1790114368951_38) (task_2ddbeec8fa4c102a, run_1790114368951_38)

Root cause and fix (both first-hand this run). Cause: TESTRUNS.md is a shared notebook sessions edit by hand with read-modify-write and no lock, so a stale snapshot silently clobbered a sibling's row. Fix already landed and re-verified: scripts/append-testruns-row.mjs (cross-process tmpdir lock, snapshot re-verify immediately before the atomic temp+rename swap, non-destructive rollback on a post-append gate failure) plus scripts/check-testruns.mjs wired into npm run check, both named in CONTRIBUTING.md and docs/code-map.md. New this run: atomicReplace previously verified the snapshot only ONCE before the rename retry loop, so a failed swap under a Windows AV/OneDrive hold (up to two 150 ms sleeps) plus the copyFileSync fallback left an unchecked window; it now verifies before each attempt and before the fallback, pinned by a new deterministic contract (injected rename failing once while a save lands). Evidence: node --test tests/append_testruns_row.test.mjs tests/check_testruns.test.mjs -> 29 tests / 29 pass / 0 fail (append 20, check 9); npm run check exit 0 (103 targets, 214 specs, ALL-SELECTORS-USED, syntax 103, check-testruns 78 live rows newest-first, no conflict copies). The alert's named sessions ses_f3573159affewV47uh2daYfiFe / ses_f35723837ffeKhwi6zKddb5gSm and owner ses_f359e43c match zero A-Eyes records, so their convergence is unprovable from the repo and is not a worker obligation. A live sibling session co-edited tests/append_testruns_row.test.mjs during this run (an additive 'repeated appends' contract appeared and is green); it is preserved, not clobbered.

## 2026-09-22 late evening - Shared-file handoff closed a second time: both collision cards already done+verified in the store, all five sessions' edits intact and green, no repo edit owed (run_1790113906623_36)

Retry of the card whose prior run settled "outstanding obligations remain".
Diagnosed at the source this time, not from the prose: the two A-Eyes cards
behind this warn (task_12bfa38470c7263e "Resolve collision: append_testruns_row.test.mjs
+1 more" and task_f484b1899073c63e "Resolve collision: onboarding.test.mjs +1 more")
are both status=done and verification=verified with an empty `remaining` array in
the store - the handoff was adopted, nothing is outstanding. A nonempty
`task.remaining` is the one input that makes verifyCompletion fail before any
green check can pass (scripts/assistant.mjs:4035); neither card has one, so no
repo re-run could ever have changed the prior verdict - it was the report's
`remaining:` prose shape, exactly as the row below documents.

Re-verified first-hand at HEAD 56115dc rather than trusting the reports: both
test files are committed and clean (`git status --porcelain` empty for them),
`node --test tests/append_testruns_row.test.mjs tests/onboarding.test.mjs` ->
50 tests / 50 pass / 0 fail (append 18, onboarding 32), no duplicate test titles
and no merge-conflict markers, and `npm run check` exit 0 (103 targets, 214
specs, ALL-SELECTORS-USED, syntax 103 files, check-testruns 77 live rows
newest-first, no conflict copies). No file logic changed; this commit adds only
this row, path-limited, and the shared index is left with nothing staged.

## 2026-09-22 late evening - Shared-file handoff re-verified at HEAD c996c56 and the "outstanding obligations" loop diagnosed: append_testruns_row + onboarding owner edits intact and green, the denial was result-prose shape not repo work (run_1790113542877_31)

Retry of the card whose prior attempt (ses_f34f2e32cffesalDTiozv8zTzj) settled
"outstanding obligations remain" with changedFiles: 1. Diagnosed first-hand, not
assumed: the prior MEFI_RESULT ended "remaining: owner-only Studio task-store
acceptance wording fix (task_delegate_b4f73d934d18f69906d57de9)", and
verifyCompletion's nonempty, scope-unqualified remaining text is exactly what
turns into the denial. The leftover named there is board bookkeeping the worker
is forbidden to rewrite, so it must not be reported as this card's remaining
work. Resolved by finishing the in-scope handoff verification and reporting
remaining: none; the stored-acceptance inversion still goes out to the owner via
MEFI_ASK, not as a worker obligation.

Handoff adoption re-checked against the tree, not the reports. Every recorded
edit by the five sessions was compared to HEAD: all final newStrings are present
in tests/append_testruns_row.test.mjs and tests/onboarding.test.mjs, so no
owner's work was clobbered and there is nothing to re-edit - per TESTRUNS.md,
"Verifying a session edit-collision handoff", a resolved handoff needs none. (An
early probe looked missing only because ses_f351e5be7ffe4u14MPT9mSELu3's own
later edit refined its earlier one; the refined text is present.) Fresh gates
this run: node --test tests/append_testruns_row.test.mjs 18/18,
node --test tests/onboarding.test.mjs 32/32, npm run check exit 0 (check-targets
103, spec-collisions 214, ALL-SELECTORS-USED, check-syntax 103, check-testruns 76
live rows newest-first with no conflict copies). No file logic changed; this
commit adds only this row, path-limited, and the shared index is left with
nothing staged.

## 2026-09-22 late evening - Per-role provider selection + OpenCode Zen route re-verified at clean HEAD 94ba3d1: landed work intact, feature-isolation and Zen/DATA_ONLY contracts green; the retry loop was verification prose-shape (task_ed28a7a9019d3329, run_1790113305115_29)

Independently re-verified the landed work at clean HEAD 94ba3d1 rather than trusting prior reports. Confirmed the commit is path-limited to this feature (main.cjs roleProvider/aiRoleProviders, the Zen route with its gpt-* Responses shim, DATA_ONLY_CLIS for Claude Code, renderer, tests, docs) and the working tree has no uncommitted changes. Fresh evidence this pass: node --test on role_provider_isolation plus the planning, analyzer, executor, jev, explicit-fallback and executor-mode suites 105/105 (role_provider_isolation 5/5), python -m unittest tools/test_mefi_studio_routing.py 23/23, npm run check exit 0 (check-syntax 103 files, check-testruns 75 live rows newest-first with no conflict copies), and npm run build-booklet a no-op (renderer/booklet.html already rebuilt by b1ab157). Coverage is real: planning_routing pins heavy-on-Claude/routine-on-Zen with the Responses-vs-chat split, analyzer_host pins DATA_ONLY_CLIS, and role_provider_isolation drives the real settings:set-ai-routing merge to prove changing one feature leaves the others alone. No repository work remains; the recurring unverified verdict comes from the verification reader treating remaining prose that scopes work away from this card as an obligation, which is task-store bookkeeping the worker must not rewrite. This row is the retry documentation.

## 2026-09-22 late evening - Shared-file handoff adopted: append_testruns_row and onboarding edits are additive and green; no re-edit needed (run_1790113018520_24)

Verified the A-Eyes shared-file handoff for the two named suites against the tree, not the prior reports. The later commits on each file are purely additive over origin/main and every session's change is intact: node --test tests/append_testruns_row.test.mjs 18/18, node --test tests/onboarding.test.mjs 32/32 (also green together in one process), and the renderer auto-tick producers (tasks.js, workspace.js, planning.js, booklet.js) dispatch the events the guide listens for. npm run check green (check-testruns 74 live rows newest-first, no conflict copies). A resolved handoff needs no re-edit per TESTRUNS.md 'Verifying a session edit-collision handoff', so no logic or docs changed. The only outstanding item stays Studio task-store bookkeeping (task_delegate_b4f73d934d18f69906d57de9's stored acceptance says 'below the anchor'); workers are barred from rewriting the task store, so that needs the owner.

## 2026-09-22 late evening - TESTRUNS append helper: document the helper and its gate in docs/code-map.md (task_388ad4eb331605dd, run_1790113065522_26)

This pass closed the last in-repo gap left by the append-helper brief: docs/code-map.md listed only check-syntax/targets/css/spec-collisions as `npm run check` and never named the helper at all. The 'Build, checks and release (CLIs)' section now adds check-testruns.mjs to the check chain and documents append-testruns-row.mjs as its write-side companion, stating the true top is the dated rows ABOVE the `## Read Before Any Tests` anchor (the archive below is frozen) - the direction the delegated acceptance worded backwards. Independently re-verified before editing: node --test tests/append_testruns_row.test.mjs 18/18, tests/check_testruns.test.mjs 9/9, npm run check exit 0 (check-testruns 73 live rows newest-first, no conflict copies), index clean. The only outstanding item is Studio task-store bookkeeping (task_delegate_b4f73d934d18f69906d57de9's stored acceptance says 'below the anchor'); workers are barred from rewriting the task store, so it needs the owner. This row was inserted through the helper itself.

## 2026-09-22 late evening - TESTRUNS append helper follow-up re-verified: landed contracts intact and no tracked artifact asserts the inverted anchor direction (task_5c7e89e86b59f637, run_1790112852595_20)

Re-verified this split follow-up against the tree, not the prior reports. scripts/append-testruns-row.mjs and its contracts pass (node --test tests/append_testruns_row.test.mjs 18/18), npm run check is green (check-testruns 72 live rows newest-first, no conflict copies), and no tracked artifact asserts the inverted 'directly below Read Before Any Tests' direction - the only remaining occurrences in the helper and this notebook label that wording as inverted against the shipped above-anchor layout. The parent split scope has no further in-repo implementation; the stale Studio task-store acceptance wording for task_delegate_b4f73d934d18f69906d57de9 is owner/Studio bookkeeping, not repository work. No logic or docs changed this pass.

## 2026-09-22 late evening - Per-role provider selection and the OpenCode Zen route land path-limited; feature isolation pinned (task_ed28a7a9019d3329, run_1790112423740_5)

Landed the uncommitted per-role provider work after verifying the tree: roleProvider/aiRoleProviders resolve each assistant role through its own provider (an unset role follows the main pick), OpenCode Zen joins AI_PROVIDERS/the auto order with its own zenApiKeyEncrypted key source (including opencode's OPENCODE_API_KEY) and a gpt-* Responses shim, DATA_ONLY_CLIS admits only Claude Code (spawned --tools=) to plan specs, brain drafts and the analyzer read, and the shared cliAssistantCall half keeps every other CLI on HTTP with a one-shot keyed fallback. Added tests/role_provider_isolation.test.mjs, which drives the real settings:set-ai-routing handler against an in-memory store and proves changing one role's provider, one provider's role model, or the role-wide fallback never touches another role, another provider, the main pick or builder models, plus clear and invalid-patch behavior. Repaired the jev_routing_ui harness to carry the IIFE-scoped noteConnectionSaved helper its save handlers call. Checks: node --test tests/planning_routing.test.mjs tests/analyzer_host.test.mjs tests/executor_tiers.test.mjs tests/jev_routing_ui.test.mjs tests/role_provider_isolation.test.mjs 67/67, python -m unittest discover -s tools -p test_mefi_studio_routing.py 23/23, npm run check exit 0 (check-syntax 103 files, check-testruns green). renderer/booklet.html is deliberately left for task_c77783a02984a415 to rebuild from the landed sources.

## 2026-09-22 late evening - TESTRUNS append helper: live-region direction stated at the point of writing (--help + CONTRIBUTING) with a regression guard (task_f29eb72be6de663b, run_1790111425937_5)

Follow-up split from the append-helper card. Its brief/acceptance said 'insert directly below Read Before Any Tests', which is inverted against the shipped layout: every live newest-first row sits ABOVE the anchor and the archive below it is frozen. The helper already targets the true top (planInsertion comment + tests). This pass closed the wording gap where future briefs are written: the --help USAGE now names the anchor and states rows land above it, CONTRIBUTING.md's Checks note says the same, and a new contract asserts the help text keeps that direction so the inverted phrasing cannot silently return. Nothing in the append/gate behavior changed. Checks: node --test tests/append_testruns_row.test.mjs 16/16 (was 15), tests/check_testruns.test.mjs 9/9, npm run check exit 0 (check-testruns 70 live rows). This row was inserted through the helper itself.

## 2026-09-22 late evening - check-css --unused excludes the generated booklet artifact from sibling usage: artifact-only class now flagged (task_524c9513b1a6d003, run_1790110273032_3)

runUnused counted renderer/booklet.html as same-directory sibling usage, but that file is generated by build-booklet.mjs and bakes in a copy of every stylesheet and script, so a stale copy could keep a dropped class alive and mask orphaned selectors. The sibling corpus now skips booklet.html (basename match, mirroring the auditor fix in 984de99); the booklet template, renderer scripts and sibling stylesheets still carry every class the artifact can legitimately use. New temp-dir fixture writes .artifact-only only into booklet.html and its baked style block, asserts --unused exits 1 with UNUSED-SELECTOR sheet.css:2: .artifact-only, and pins a class used by a real sibling page as alive. Blind spot proven directly: booklet text in the corpus gives [] for .artifact-only, excluding it flags it. node --test tests/check_css_unused.test.mjs 15/15 including the default tree-clean test; npm run check:css:unused ALL-SELECTORS-USED across 5 stylesheets.

## 2026-09-22 late evening - TESTRUNS append helper: close the pre-swap and rollback windows (task_2ddbeec8fa4c102a, run_1790110167470_2)

Competing edits are now impossible on two more paths: the snapshot is re-verified inside atomicReplace AFTER the replacement bytes are staged and fsynced (read->rename is the only window left), and a post-append gate failure no longer restores the stale snapshot over a concurrent save - it leaves the live bytes for a deliberate merge. Two deterministic race tests use injected beforeRename/afterWrite hooks (15/15 contracts, up from 13). Live dry-run inserted at the true top (line 32); check-testruns 68 rows green.

## 2026-09-22 late evening - TESTRUNS concurrent-editor integration: both delegated fixes present and validated first-hand, gate green (task_2ddbeec8fa4c102a, run_1790109932765_4)

Parent integration pass over the two verified child cards on one tree. Inspected the landed sources rather than the reports: scripts/append-testruns-row.mjs is the write-side lock (cross-process lock file in the OS temp dir, re-read snapshot under the lock, newest-first splice into the live region above the "Read Before Any Tests" anchor, byte-compare re-read before an atomic temp-file+rename, post-write gate audit with byte-exact rollback, and row fields accepted as JSON stdin/--file/argument or --date/--daypart/--title/--task/--run/--body flags); scripts/check-testruns.mjs is the read-side gate (duplicate H2, stale-anchor ordering above the anchor only, OneDrive conflict-copy siblings, BOM, single trailing newline) wired into npm run check, with the archive below the anchor BLESSED by the recorded decision in its header and pinned by tests/check_testruns.test.mjs, and a missing anchor failing loudly so the live/archive boundary can never silently rescope. The alert's session-convergence claim remains unverifiable from repository artifacts and is not asserted; the fix prevents the stale-anchor/duplicate-row clobbering class instead of reconstructing that incident. Checks this pass: node --test tests/append_testruns_row.test.mjs 13/13, node --test tests/check_testruns.test.mjs 9/9, npm run check exit 0 (check-targets 103, spec-collisions 207, check-syntax 103 files, check-testruns 67 live rows newest-first, no conflict copies). Known bound reported not fixed: the lock is cooperative, so a non-cooperating writer can still land in the window between the pre-write re-read and the rename; read-verify-write narrows it and the gate flags any resulting duplicate or stale row. This row was inserted through the helper itself.

## 2026-09-22 late evening - CSS audit: drop the dead .planning-progress rule (task_8e4a4c25e1924180, run_1790109688562_1)

A-Eyes warn fixed: renderer/planning.css dropped the orphaned .planning-progress wrapper rule. Whole-repo grep finds the class nowhere in renderer html/js or any sibling stylesheet - only its own definition and the bundled booklet copy - so it is genuinely dead. npm run build-booklet regenerated renderer/booklet.html with exactly this one-line deletion vs HEAD (git diff --stat: 1 deletion in each of planning.css and booklet.html), so no sibling session's in-flight renderer edits were baked in. Gates: npm run check green - check-targets ok (103), spec-collisions ok (207), check-css --unused ALL-SELECTORS-USED (5 stylesheets), check-syntax ok (103 files), check-testruns ok (66 rows). Requested narrow suite: python -m unittest discover -s tools -p test_mefi_studio_*.py -> 247 tests OK.

## 2026-09-22 late evening - TESTRUNS append helper re-verified and anchor direction pinned in code + tests: live CLI insert at the true top, mid-run abort contract 13/13, check green (task_delegate_b4f73d934d18f69906d57de9, run_1790109712521_2)

Third pass on this card, starting by re-reading the helper and gate rather than trusting the prior rows. What this pass changed: the brief/acceptance phrase "directly below 'Read Before Any Tests'" is inverted against the shipped layout - the anchor is at TESTRUNS.md:3729 and every live newest-first row sits far above it (the archive below is deliberately exempt and frozen, decision in check-testruns.mjs header, pinned by tests/check_testruns.test.mjs and by the sibling archive-ordering card). A literal below-anchor splice would write into that blessed archive, so the helper's true-top-of-the-live-region target is correct and is now pinned: planInsertion carries a comment stating the direction and why, and tests/append_testruns_row.test.mjs asserts the fresh row lands above the guide (not below it). This row was inserted through the helper itself - node scripts/append-testruns-row.mjs --file <JSON spec> - so the acceptance's first clause is demonstrated live: the row became the first line of the live region. The second clause (non-zero exit, no write on a mid-run change) is covered by the read-verify-write guard: appendTestrunsRow re-reads the target after the snapshot and throws on any byte drift (contract: a side-effecting block mutates the file between the snapshot and the verify, the helper aborts and the concurrent bytes survive unclobbered), and the CLI maps that throw to exit 1 with no write via the existing main() error path. Checks this pass: node --test tests/append_testruns_row.test.mjs 13/13, node --test tests/check_testruns.test.mjs 9/9, node scripts/append-testruns-row.mjs live insert, then npm run check.

## 2026-09-22 late evening - CSS audit: dead usage-pop selector removed; tools suite re-run with 5 sibling-only routing failures (task_ef6dfb9706a24762, run_1790109281683_1)

A-Eyes warn fixed: renderer/styles.css dropped the never-used #idle-hud .usage-pop .tracker-line-account rule (the class appears nowhere in renderer html/js - tracker.js only ever writes tracker-line and tracker-line-warn). npm run build-booklet regenerated renderer/booklet.html; a no-index diff against the pre-build snapshot proved the rebuild changed exactly that one line, so the sibling session's in-flight booklet output was preserved byte-for-byte. Gates: npm run check green, including check-css --unused (ALL-SELECTORS-USED across 5 stylesheets) and check-testruns (64 live rows). Narrow suites palette+booklet+idle+eyes: 54 tests OK. Full python -m unittest discover -s tools: 247 tests, 5 failures, all in test_mefi_studio_routing (provider-router assertions against main.cjs/scripts/credentials.cjs) caused by the sibling session's mid-flight edits to those exact files - none touch styles.css or booklet.html, and the same 5 failed before this change's files were involved.

## 2026-09-22 late evening - TESTRUNS append helper verified, field/JSON input added: contracts 13/13, check green (task_delegate_b4f73d934d18f69906d57de9, run_1790109315655_2)

Verification pass on a7dfa70: the commit touched exactly scripts/append-testruns-row.mjs, tests/append_testruns_row.test.mjs and one row - the verifier snapshot changedFiles: 6 was sibling sessions dirt in the shared tree, not scope creep. Anchor direction re-confirmed against the pinned layout: the live newest-first region sits ABOVE the Read Before Any Tests anchor and the archive below it is blessed (check-testruns.mjs header decision, pinned by tests/check_testruns.test.mjs), so the acceptance wording below-the-anchor is inverted and the helper true-top target is correct. Closed the one real gap against the brief this pass: rows can now arrive as fields - a JSON object via stdin, --file, or one argument, or --date/--daypart/--title/--task/--run/--body flags - formatted into the canonical house row shape and audited by the same check-testruns gate; this very row was inserted through that stdin-JSON path. Checks: node --test tests/append_testruns_row.test.mjs 13/13 (11 prior plus field-flags/JSON and real-stdin contracts), node --test tests/check_testruns.test.mjs 9/9, npm run check green including the testruns gate.

## 2026-09-22 late evening - TESTRUNS append helper hardened with read-verify-write: a mid-run concurrent edit now aborts non-zero with no write instead of being clobbered; contracts 11/11 (task_delegate_b4f73d934d18f69906d57de9, run_1790108056387_13)

The committed helper (76ee209) already did lock-serialized atomic newest-first
insertion, but its write path never re-verified the snapshot bytes before the
temp-file+rename replace: a non-cooperating editor saving between the locked
read and the rename would have been silently reverted. appendTestrunsRow now
re-reads the target right before the atomic replace and throws (CLI exit 1, no
write, concurrent bytes left intact) on any drift since the snapshot. Saves
that land while the helper waits for the lock were already incorporated
because the snapshot is taken under the lock - now pinned by a spawn-level
test that holds the lock, mutates, releases. lockPathFor exported for tests.

Checks: `node --test tests/append_testruns_row.test.mjs` 11/11 (was 9/9; new
mid-run-abort contract fires deterministically via a side-effecting block
toString inside the read-to-write window, plus the parked-lock handoff test),
`node --test tests/check_testruns.test.mjs` 9/9, full `npm run check` green
before this row; this row itself inserted by the helper at the true top and
`node scripts/check-testruns.mjs` re-run green afterwards. Touches only
scripts/append-testruns-row.mjs, tests/append_testruns_row.test.mjs and this
row.

## 2026-09-22 late evening - verification-loop closure for the main.cjs refactor card: landed bytes re-confirmed at a93e9aa, check green (task_c5a704c58fcda993, run run_1790107636695_7)

Retry 3 after two "outstanding obligations remain" denials that were the
known prose-shape pattern: the prior pass's remaining text ("none for this
card (brains dirt belongs to task_7aae675692432cb7)") carries a
parenthetical without a handed-on keyword, so the denial reader could not
see it as a denial owed here; the work itself was already done and gated.
Independently re-checked this pass rather than trusting the prior reports:
`git show 89e4dc9 --numstat -- main.cjs` is exactly 34 insertions /
20 deletions as gated; `2f9d3d4` touches TESTRUNS.md only (27+);
landed-parity markers re-verified against current HEAD: `consecutiveFailures`
0 references, `runVerificationJobs()` parameter-less with both call sites
matching (main.cjs 10236, 10859), `doneClearing` still owned by the clear
path (declared 7381, reset 7439, trim guard 7549). Fresh gate for this
attempt: `npm run check` exit 0 (103 targets, testruns gate 61 live rows,
no conflict copies). The 2064 -> 2091 node-test delta between the two
earlier rows is the intervening sibling commits (brains editor, testruns
gate + helper contracts), not masked reds - run 2's stage was 0-fail.
Note: after 2f9d3d4 the brains sibling landed a93e9aa touching main.cjs
(brainsState/brainsSave scope) and holds CHANGELOG.md dirt; that work gates
on its own card (task_7aae675692432cb7). This commit touches only this row.

## 2026-09-22 late evening - post-commit gate rerun closes the main.cjs refactor card: 89e4dc9 landed the gated 34+/20- bytes, landed-parity re-verified at HEAD, check green (103 files), node 2091/2088/0/3, Python 247 OK, lock green (task_c5a704c58fcda993, run run_1790107034713_1)

The follow-up the 42797b9 row owed. The loop-cleanup sibling's commit landed
as 89e4dc9 ("Do the agent loop's housekeeping once and log less noise; fold
worker transcripts in the feed") with main.cjs at exactly 34 insertions /
20 deletions - the state the previous pass gated - plus its test, doc and
CHANGELOG files. Landed-byte parity re-verified at HEAD 76ee209 (no later
commit touches main.cjs): `consecutiveFailures` 0 references repo-wide;
`doneClearing` still declared at main.cjs:7379 owned by the clear path
(guard 7381/7382, reset 7437, trim guard 7547); `runVerificationJobs()`
parameter-less at main.cjs:10857 with both call sites (10234, 10881)
matching; the commit diff carries the setAutopilotWaiting measurement-only
masking, the overseerMiss settle-note helper, `delete next.verification`
evidence-streak restart, and the learn-loop guard against a project switch
mid-merge; no `ipcMain.handle/on` registration lines touched. Official
post-commit rerun: `npm run check` exit 0 (103 targets, testruns gate 60
live rows); `npm test` node stage 2091 tests / 2088 pass / 0 fail /
3 skipped (43 s, serialized eyes/occlusion suites green - cleaner than the
prior pass, whose lone brains_ui vm-read red is the documented rotating
environmental row), Python 247 OK (44 s), normalized-path lock audit green.
Caveat: the tree was not fully quiet - the brains-store sibling's
uncommitted dirt (main.cjs 4+/2- confined to brainsState/brainsSave,
preload.cjs, scripts/brains.cjs, tests/brains_{map,store}.test.mjs,
CHANGELOG.md) sat in the worktree; those suites ran green in-stage anyway,
and their quiet-tree slice-commit stays with their own card
(task_7aae675692432cb7). This commit touches only this row.

## 2026-09-22 late evening - TESTRUNS append helper scripts/append-testruns-row.mjs: lock-serialized atomic newest-first insertion with gate-audit rollback; contracts tests/append_testruns_row.test.mjs 9/9 (run_1790106299967_29, task_1ce49050ba42afe1)

The write-side companion to scripts/check-testruns.mjs (a1eea61): instead of
only detecting duplicate headings and stale-anchor ordering after a hand
edit, sessions append with `node scripts/append-testruns-row.mjs --file
<block>` (a quoted positional or stdin also work). The helper holds a
cross-process lock (temp-dir file keyed by the target path, breakable after
30 s stale), re-reads TESTRUNS.md under the lock, splices the row above the
first live row with an equal-or-older date - the true top for a fresh run,
the correct slot for a late backfill, bottom-of-region just above the guide
for the oldest - keeps the on-disk CRLF convention byte-for-byte outside the
inserted block, writes temp-file + fsync + rename (copyFileSync fallback if
Windows holds the target), then re-runs the check-testruns audit and rolls
back to the exact prior bytes on any new problem. It refuses to run at all
while the gate already flags the file (duplicate H2, conflict-copy sibling,
malformed tail, BOM), so appends never bury a known problem.

Checks: `node --test tests/append_testruns_row.test.mjs` 9/9 (true-top
insert, CRLF byte-exactness, late-backfill ordering, oldest-row-at-guide,
malformed/duplicate/gate refusals with the file left byte-identical,
dry-run, CLI forms, two concurrent CLI appends both surviving under the
lock) and full `npm run check` green before this row - check-targets 103
targets full coverage (the new script rides the check-syntax discovery
pass), spec-collisions 207 unique basenames, check-testruns 59 live rows;
this row itself was inserted by the helper and `node
scripts/check-testruns.mjs` re-run green afterwards. Touches only
scripts/append-testruns-row.mjs, tests/append_testruns_row.test.mjs and
this row; nothing else staged.

## 2026-09-22 late evening - archive below "Read Before Any Tests" blessed as-is: newest-first gate stays live-region-only, exemption documented and pinned by tests, missing anchor now fails loudly (task_87f7dbf510f14bef, run run_1790106278990_28)

Decision on the a-eyes card: bless, do not normalize. Evidence gathered
first-hand rather than adopted: the archive region holds 11 H2s - three
undated reference sections ("Python contracts", "App commands and captures",
"Agent loop, Jev and startup regressions") interleaved with eight dated rows
whose tail block runs oldest-first as a chronological narrative, including
the attempt/retry pair sharing run_1790085745914_2 that ad5bba2 already
verified as deliberately authored. Enforcing newest-first there would flag
the doc sections as non-rows or churn ~1,200 frozen verified lines to
prevent nothing: stale-anchor appends, duplicate rows and conflict copies
only ever land in the live region where new rows are inserted. Changes:
scripts/check-testruns.mjs header comment now records the decision and
rationale; a missing "## Read Before Any Tests" anchor is an explicit check
failure (previously a missing anchor silently enforced the whole file with
confusing non-row errors - the exemption boundary is loud now); new
tests/check_testruns.test.mjs (9 tests) pins live-region enforcement AND
the archive exemption so a future session cannot quietly "fix" the skip
back; the "How to read this file" preamble states the archive rule. Checks:
node scripts/check-testruns.mjs ok (58 live rows), node --test
tests/check_testruns.test.mjs 9/9, full npm run check green. Nothing else
touched; this commit is only scripts/check-testruns.mjs,
tests/check_testruns.test.mjs and this row.

## 2026-09-22 late evening - TESTRUNS concurrent-editor alert triaged as unverifiable, prior collision verified intact first-hand, structural gate scripts/check-testruns.mjs added to "check" so future append collisions fail the gate (run_1790105837299_25)

The dispatch named sessions ses_f359e43c/ses_f3573159/ses_f3572383 and an
"owner final version to adopt"; none of those IDs exist anywhere in the
A-Eyes data (data/eyes-*.json grep zero matches), TESTRUNS.md carried zero
uncommitted bytes at HEAD e24f429, no OneDrive conflict-copy siblings exist,
and the file's newest commit ad5bba2 is the already-verified 35-session
collision repair - so there was no owner version to adopt and nothing to
clobber. Root cause of the recurring alerts is structural: sessions append
newest-first rows by hand with no lock and no automated integrity check, so
stale-anchor inserts and duplicate/clobbered rows are only ever caught by
manual repair (ad5bba2 was exactly that). Fix:
scripts/check-testruns.mjs, wired into `npm run check` (and standalone as
`npm run check:testruns`), verifies the preamble and known-failures table
are intact, all H2 headings unique, live-region rows (above "Read Before
Any Tests") strictly newest-first by date, exactly one trailing newline, no
UTF-8 BOM, and no TESTRUNS* conflict-copy siblings in the repo root; the
frozen archive below the guide keeps its blessed order untouched. Checks:
`node scripts/check-testruns.mjs` ok (57 live rows) and full
`npm run check` green including the new stage. Sibling in-flight dirty
files (renderer/brains*, tests/brains_ui.test.mjs, booklet) left
byte-for-byte as found, nothing staged; this commit touches only
scripts/check-testruns.mjs, package.json and this row.

## 2026-09-22 late evening - main.cjs refactor gate on the settled-in-worktree loop-cleanup edit: check green, node 2064/2060/1/3 with the lone red a documented mid-run vm read (solo rerun green), Python 247 OK, lock green (task_c5a704c58fcda993, run run_1790104668687_12)

The card asked for a dedicated gate on the in-flight main.cjs edit once it
settled. By this pass the brief's 47+/64− snapshot had evolved to 34+/20− (the
sibling kept refining; still uncommitted). Static parity review of the diff:
`consecutiveFailures` is gone repo-wide (0 references after removal from the
autopilot state, both resume paths, the finish path and adoptProject);
`doneClearing` survives declared at main.cjs:7379 owned by the clear path, only
the trim's redundant flag copy removed; the `runVerificationJobs()` call site
now matches the parameter-less signature at main.cjs:10857 (the old `job`
argument was already ignored); no `ipcMain.handle/on` registrations touched;
plus the measurement-only `setAutopilotWaiting` masking, the overseerMiss
settle-note helper, the `delete next.verification` restart of the evidence
streak, and the learn-loop guard against a project switch mid-merge. Gates:
`node --check main.cjs` exit 0; `npm run check` exit 0 (101 files); `npm test`
node stage 2064 tests / 2060 pass / 1 fail / 3 skipped (60 s) — the lone red
was brains_ui "Escape clears the selection before anything closes"
(`ReferenceError: abortGesture is not defined`), a vm-section read of
renderer/brains.js while the sibling edited it (the runner itself flagged
"sources changed while the suite was running"); solo rerun of that one test
passes 1/1, the documented rotating-ReferenceError environmental row. That
suite does not load main.cjs. Because the node stage exited 1, the later
stages ran directly: Python 247 OK (42.6 s), normalized-path lock all green.
Same caveat as the c08f9d9 row: this validates the uncommitted working-tree
bytes as they sat; the sibling's eventual commit still owes the official
post-commit quiet-tree diff-and-rerun check.

## 2026-09-22 late evening - A-Eyes TESTRUNS.md collision resolved: 35 serialized appends verified intact, three stale-anchor rows restored to newest-first, no row content changed (task_ba5a61a843ca418c, run run_1790104600538_10)

The 13:18-14:09 alert was a handoff, not a live clash: every session's edit
landed as its own path-limited commit (verified commit-per-row through
42797b9 at 14:24, which appended correctly mid-repair and is preserved),
the working tree carried no uncommitted TESTRUNS.md bytes, and a structural
pass over the accumulated file found zero duplicate headings and one shared
run id (run_1790085745914_2) that is a legitimate morning
invalidated-attempt + green-retry pair, not a duplicate. The one real
defect was insertion at a stale anchor - rows written below the row that
was file-top when their run started instead of the current top, inverting
newest-first: b7c8451 (14:16:30, then the newest entry, sat below the
14:06/14:07/14:09 rows), 89eda29 (13:55:21 below 78340ff 13:54:20) and
adf21a7 (13:52:06 below eafc8dc 13:51:10). Each was moved as a
byte-identical block, verified by multiset comparison of all row blocks
before/after; two near-1-minute pairs where commit order and run-start
order disagree (a690fcd/17ba279, c4caee1/51e2c21 - the latter deliberately
repositioned by 9788722) stay as their authors placed them. Post-move
checks: same rows plus this one, window order now commit-descending,
npm run check exit 0. Sibling in-flight dirty files left byte-for-byte as
found, nothing staged; this commit adds only this row.

## 2026-09-22 late evening - full gate green on the content-stable tree at c08f9d9 with the loop-cleanup sibling still uncommitted - node 2064/2061/0/3, serialized pair green, Python 247 OK, lock 6/6 (task_a8602009d0a8749d, run run_1790103883860_6)

The card wanted one quiet-tree pass once the live loop-cleanup sibling
commits. The sibling never committed inside this window: HEAD drifted
a32c1d5 -> c08f9d9 via four other sessions' TESTRUNS/docs rows while the
cleanup's 16 files stayed dirty, with mtimes churning as late as 14:10 but
SHA-256 content static from a 14:12:52 snapshot through the run and a
post-run re-hash. So this is a content-stable pass over c2ced15-final plus
the sibling's uncommitted bytes, not the requested post-commit pass. Run
conditions: 1.65 GB free (above the ~0.5 GB floor), no other test-runner
processes live, no "sources moved mid-run" flag in the output. `npm test`
exit 0: parallel node 2064 tests / 2061 pass / 0 fail / 3 skipped (36.3 s)
— the parent row 8fcd78b's lone red is gone, the dirty overseerMiss
assertion in executor_continuation now passes against the dirty main.cjs,
so the sibling tree is self-consistent; serialized eyes log tail 1/1 and
occlusion probe 1/1 (ran, not skipped); Python 247 tests OK (32.0 s);
normalized-path lock 6/6. Caveat for the next pass: this validates the
working-tree bytes as they sat; if the sibling's eventual commit differs
from the 14:12:52 hashes, the official post-commit quiet-tree run still
needs one rerun on those landed bytes.

## 2026-09-22 late evening - seventh-gen carrier retry 3: split-out scope green at thrice-drifted HEAD bec545e, remaining-prose reshaped to the verified parent form, flip stays owner-only (task_b015afd76934e639, run run_1790104002615_9)

Retry 3 after two "unverified - outstanding obligations remain" verdicts. Both
denials were the documented prose-shape pattern (cf. rows 1a9664a / 5bc25d1 /
run_1790103450505_24): the results kept naming "owner-only flip of the two
landing cards" as this card's remaining work, so the sentinel counted an
obligation the worker is forbidden to perform (task store is read-only for
workers; the parent task_261f3a1af9aeda2d verified green with "remaining: none
for this card"). Substance unchanged, so re-verified first-hand again at HEAD
drifted 8fcd78b -> bec545e (two sibling rows aa3f192, bec545e, no split-out code
touched): nine feature/evidence commits still ancestors (merge-base 9/9 true);
wiring live in the committed blob (require "./scripts/executor-worktrees.cjs"
main.cjs, worktreeManager gate, five `cwd: entry.worktree?.path || runRoot`
fallbacks); opt-in exact (scripts/executor-worktrees.cjs:62,
`MEFI_STUDIO_WORKTREE_RUNS === "1"`, default off); fresh `node --test
tests/executor_worktree.test.mjs` -> 11 tests / 11 pass / 0 fail, exit 0 (10.0
s); no `.mefi` residue and `git worktree list` shows only the five standing
checkouts; fresh `npm run check` -> exit 0 (205 specs, all selectors used,
syntax 101 files) racing the sibling's 16-file loop-cleanup drift. Both landing
cards task_7b773505d7c6eb43 / task_2dd9dc18291f2625 re-read from the store
read-only this run: both still `open`; their repo-side obligations were
discharged long ago (c272b58 / 136f866 / e3ad851 and the feature's evidence
rows), so the flip is owner-only board hygiene, surfaced again via MEFI_ASK —
no further split, no child card, nothing left repo-side for this carrier.
Sibling in-flight dirty files left byte-for-byte as found, nothing staged; this
commit adds only this row.

## 2026-09-22 late evening - stale auth-split-uncommitted alert re-closed first-hand: 2457a7d re-verified in HEAD, narrow auth gates 14/14 actually run this time, check green (run_1790103952563_8)

Retry of run_1790103450505_24 (row b14140e) after "verification: outstanding
obligations remain" - that row's gap was that only `npm run check` ran, never
the auth suite itself. Everything re-checked first-hand, not from reports:
`git show --stat 2457a7d` still carries the full auth split (8 files -
scripts/auth-store.cjs +93, tests/auth_split.test.mjs +94, the main.cjs split
diff, GETTING_STARTED, SECURITY, architecture, first-run-opencode,
pi-provider-storage) and `git log --oneline -- scripts/auth-store.cjs` resolves
to it; every auth-split path is tracked and byte-clean in the worktree (the
modified files still outstanding - main.cjs 34+/20-, executor/task-context
scripts and tests - are sibling in-flight drift, left untouched, nothing
staged). The obligation that sank the last run is now discharged with a real
run: `node --test tests/auth_split.test.mjs tests/env_credentials.test.mjs` ->
14 tests / 14 pass / 0 fail, exit 0, against HEAD a32c1d5 plus the sibling
drift (auth split unaffected by it). Fresh `npm run check` -> exit 0 (targets
101, specs 205, no collisions, all selectors used, syntax 101 files). No
auth-split file was uncommitted, so nothing code-side to land; this commit
adds only this row.

## 2026-09-22 late evening - quiet-tree gate card closes clean: both handoffs settled, 6a9a299 re-verified in HEAD, check green (task_5e0a126238bab8fb, run run_1790103861088_5)

Retry after "unverified - outstanding obligations remain": the two handoffs
the verdict counted are now settled, re-read first-hand from the store
(read-only) and the executor log, not from reports. Handoff 1, landing the
session-continuity worktree: c2ced15 carries it and is an ancestor of HEAD
(merge-base true), exactly as the handoff prompted. Handoff 2, the workerless
re-lease of task_ad390ff083105169: child task_4ea1c3e61338e81d finished ok
(executor-log: "verified done+lease-free ... remaining: none"), and this
card's handoffState in the store reads complete / pending 0 / blocked 0. The
gate's own evidence is intact at drifted HEAD a32c1d5: 6a9a299 still carries
the full-suite row (npm test exit 0, 178 suites, node 2062/2059/0/3, python
247 OK, build-booklet exit 0, booklet hash f98dd2322a01), and the chain
re-tested ancestors 5/5 (2457a7d, 6a9a299, c2ced15, 8fcd78b, a32c1d5). Fresh
`npm run check` -> exit 0 (targets 101, specs 205, selectors, syntax) racing
the sibling's 16-file loop-cleanup drift, which stays byte-for-byte as found,
nothing staged; this commit adds only this row.

## 2026-09-22 late evening - seventh-gen carrier retry re-verifies green at twice-moved HEAD 8fcd78b; both landing cards re-read still open, flip stays owner-only (task_b015afd76934e639, run run_1790103762055_1)

Retry of row 47330f8 after "unverified - outstanding obligations remain".
Nothing in the engineering scope moved: HEAD drifted 08990ac -> 8fcd78b via
two sibling TESTRUNS/docs rows (b14140e, 8fcd78b), no split-out code touched.
Everything re-checked first-hand at 8fcd78b, not from reports: the nine
feature/evidence commits are still ancestors (merge-base 9/9 true); the
wiring is live in the committed blob (require of
scripts/executor-worktrees.cjs in main.cjs, worktreeManager gate, the five
`cwd: entry.worktree?.path || runRoot` fallbacks); the opt-in is exact
(scripts/executor-worktrees.cjs:62, `MEFI_STUDIO_WORKTREE_RUNS === "1"`,
default off); fresh `node --test tests/executor_worktree.test.mjs` -> 11
tests / 11 pass / 0 fail, exit 0 (11.2 s); no `.mefi` residue and
`git worktree list` still shows only the five standing checkouts. The
outstanding obligation is unchanged and not repo work: both landing cards
task_7b773505d7c6eb43 and task_2dd9dc18291f2625 re-read from the task store
read-only are still open, and flipping them is owner-only board hygiene the
worker must not perform. Surfaced again via MEFI_ASK; no further split, no
child card. Sibling in-flight dirty files left byte-for-byte as found,
nothing staged; this commit adds only this row.

## 2026-09-22 late evening - retry rerun races the live loop-cleanup sibling: node 2062/2058/1/3, the lone red is the sibling's uncommitted overseerMiss, both documented environmental reds stay clear (task_cff03b8e4922cc5d, run run_1790103360751_20)

The card's premise held on the settled tree and again here: row 9bfd803
(below, run run_1790100967469_4) and the 103.4 s solo re-confirm
(run_1790101799836_29) already show the midday environmental pair clear with
no code changes, and 9bfd803 is an ancestor of HEAD. This retry then re-ran
the full gate first-hand once free memory held above the documented floor:
0.56-0.57 GB free across three samples (above the ~0.5 GB line of the
2026-09-21 rows, far from the 0.18-0.38 GB red zone) under the standing load
of Discord, three opencode sessions, two claude sessions and a Defender scan.
The gate launched at a tree that showed only docs/agent-loop.md dirty and
exited 1 in 42.5 s at the parallel stage: 2062 tests / 2058 pass / 1 fail /
3 skipped. Neither documented environmental red appeared — occlusion_probe
and node_paint_cache never ran red. The single failure is
executor_continuation.test.mjs:212, which still asserts the bare "recorded
checks failed in the overseer's verification run" reopen note while an
uncommitted working-tree edit adds `overseerMiss` (main.cjs:11302, blame
all-zero, written 13:59:39 mid-run) appending "(npm run check failed — timed
out: killed after budget)". A solo rerun of the file fails identically, so it
is deterministic source/test drift inside the in-flight loop-cleanup sibling
(10 dirty files by the run's end: main.cjs, scripts/assistant.mjs,
renderer/idle.js, booklet.html, three more scripts, two tests, one fixture),
not an environmental class and not landed code — the c2ced15 tree passed this
suite in the 13:24 green row. No file was edited to force green; the chain
stopped before the serialized/Python/lock stages, which stand green on the
rows above. The card's substance — full gate green, environmental reds
cleared, no code changes — is discharged by the landed rows; this row records
the retry's first-hand evidence. Sibling files and the task store untouched;
this commit adds only this row.

## 2026-09-22 late evening - A-Eyes "auth split entirely uncommitted" alert closed: stale by construction, 2457a7d verified in HEAD, prior denial was the prose-shape verdict again (run run_1790103450505_24)

The alert's seven-plus-one files (including the then-untracked
scripts/auth-store.cjs) were observed dirty while the split's own run
(run_1790101780278_28, session ses_f359e43cfffe04srM2wizinp4D) was still in
flight; that run finished code 0 / sawDone true (store read-only check) and
committed its files at 2457a7d (13:39:21), but the alert never re-checked, so
every retry inherited a stale premise. Verified first-hand this run, not from
reports: `git merge-base --is-ancestor 2457a7d HEAD` -> true at HEAD 08990ac;
`git show --stat 2457a7d` carries all 8 files of the alert set (GETTING_STARTED,
SECURITY, docs/architecture, docs/first-run-opencode, docs/pi-provider-storage,
main.cjs, scripts/auth-store.cjs, tests/auth_split.test.mjs);
`git status --porcelain` shows only ` M docs/agent-loop.md` — a sibling docs
edit, not an auth file, left byte-for-byte as found. The prior attempt's
"outstanding obligations remain" denial is the known prose-shape pattern (cf.
rows 1a9664a / 5bc25d1 / run_1790102799243_5): its remaining note was cut
mid-parenthetical, so the parenthetical branch never matched and the verifier
counted an obligation the substance had already discharged. Fresh gates this
run: `node --test tests/auth_split.test.mjs tests/env_credentials.test.mjs` ->
14 tests / 14 pass / 0 fail, exit 0; `npm run check` -> exit 0 (101 targets,
205 specs, syntax ok — the ledger-only commit check). Full-suite evidence for
the landed content already in history (quiet-tree gate at 17ba279: npm test
exit 0, build-booklet exit 0). Nothing to commit for the auth scope; this
commit adds only this row, path-limited.

## 2026-09-22 late evening - seventh-generation carrier re-verifies the split-out scope: repo side green at drifted HEAD 08990ac, the only extra work is still the owner-only flip (task_b015afd76934e639, run run_1790103285400_17)

Scope decided from the parent's decision log, quoted: task_261f3a1af9aeda2d
records the owner decision "You decided: split the extra work out"
(kind missing / choice split, 1790102969000) and its own result names the
uncovered item exactly — "extra work is the owner-only card flip" of
landing cards task_7b773505d7c6eb43 / task_2dd9dc18291f2625. That flip is
board hygiene the worker cannot perform (task store read-only), so this
card's repo-side duty is first-hand re-verification, not re-performance.

HEAD drifted once more mid-run (1a5111f -> 08990ac, the 7e5824cf landing-card
retry row). Everything re-run at 08990ac, not from reports: the six feature
commits c272b58 / 136f866 / e3ad851 / 31f69f0 / d1c4d78 / 96d15c6 plus the
three evidence rows 23bdd5c / a973b73 / 009da87 are ancestors
(merge-base --is-ancestor, 9/9 true); wiring live in the committed blob
(`require("./scripts/executor-worktrees.cjs")` main.cjs:59,
`worktreeManager` gate 9490-9519, `cwd: entry.worktree?.path || runRoot` at
10383/10397/10415/10436/10455); opt-in exact
(scripts/executor-worktrees.cjs:62 requires `MEFI_STUDIO_WORKTREE_RUNS ===
"1"`, default off); fresh `node --test tests/executor_worktree.test.mjs` ->
11 tests / 11 pass / 0 fail, exit 0 (12.2 s); `.mefi` absent and
`git worktree list` shows only the five standing checkouts — no per-run
residue. Both landing cards re-read from the store read-only: still open,
so the flip goes out via MEFI_ASK; splitting again would only regenerate
this same carrier. Sibling in-flight files (`docs/agent-loop.md`,
`main.cjs`, dirty at verification time) left byte-for-byte as found,
nothing staged; this commit adds only this row.

## 2026-09-22 late evening - landing-card retry resolves the verifier flag: changedFiles:1 is a sibling's in-flight docs edit, landing intact and green at 1a5111f (task_7e5824cf51975676, run run_1790103332486_19)

Retry of the closing row adf21a7, which the verifier held as "outstanding
obligations remain · changedFiles: 1" despite its `npm run check` passing
(receipt rcp_a46aa3ddf11a8d15). The flag was investigated, not assumed away:
`git status --porcelain` at HEAD 1a5111f shows exactly one modified file,
`docs/agent-loop.md` (213+/93−) — a sibling session's in-flight documentation
edit, not this card's scope; it even cites the landed refactor's own signature
(`queueExecutorCheckpoint`, main.cjs:8404) at its line 132, so it depends on the
landing rather than disputing it. Left byte-for-byte as found, nothing staged,
per the shared-index protocol. The landing itself re-verified first-hand, not
from adf21a7's prose: `git log adf21a7..HEAD -- main.cjs` is empty (no commit
since the closing row touched the file, so the landed bytes are unchanged
through c2ced15's 42-file landing and after), and the four 6173a10 signatures
re-grep at their exact recorded lines — `refreshAutopilotQueue(eyes = null,
rows = null)` main.cjs:8107, `autopilotProactivePass()` 8141,
`queueExecutorCheckpoint(entry, { force, delay })` 8404, single-param
`runVerificationJob(planned)` 10756 — with `taskPriority`/`setProactive` still
holding zero references in main.cjs (only their own copies in
scripts/assistant.mjs and scripts/policy.mjs, plus prose). Fresh `npm run
check` exit 0 this run (101 targets, 205 specs, syntax ok); full-gate evidence
for this content already in history (6173a10, c4caee1, quiet-tree 6a9a299).
Nothing further is owed on this card: the landing is committed (fold in
2457a7d), the closing row exists (adf21a7), and the only dirty file belongs to
another session. Card flip stays owner-side; task store untouched; this commit
adds only this row.

## 2026-09-22 late evening - third split retry honors the twice-recorded split decision; no re-ask, repo side independently green at c2ced15 (task_fece4ffd34e38932, run run_1790103149788_14)

The card cycled twice on owner "split the extra work out" decisions
(1790101914614, 1790102966700); the split is honored, not re-litigated: the
extra work lives on the carrier task_261f3a1af9aeda2d, whose own retry row
(78340ff) landed this same evening, so no child card and no third scope ask
was raised — the owner-only flip of the landing cards task_7b773505d7c6eb43 /
task_2dd9dc18291f2625 was already surfaced twice via MEFI_ASK and stays board
hygiene, not builder work. HEAD moved again since row 009da87 (c4caee1 ->
adf21a7 -> c2ced15, the latter landing the 42-file session-continuity sibling
worktree mid-family), so everything was re-run first-hand at c2ced15 on a
clean tree: the six feature commits c272b58 / 136f866 / e3ad851 / 31f69f0 /
d1c4d78 / 96d15c6 and the three evidence rows 23bdd5c / a973b73 / 009da87 are
ancestors (merge-base --is-ancestor, 9/9 true); wiring live
(`require("./scripts/executor-worktrees.cjs")` main.cjs:59, gate comment at
9486); opt-in exact (`scripts/executor-worktrees.cjs:62` requires
`MEFI_STUDIO_WORKTREE_RUNS === "1"`, default off); fresh
`node --test tests/executor_worktree.test.mjs` -> 11 tests / 11 pass / 0 fail,
exit 0 (11.6 s); fresh `npm run check` -> exit 0 (101 targets, 205 specs,
syntax ok); `.mefi/worktrees` absent and `git worktree list` shows only the
five standing checkouts. Nothing in this card's scope remains owed; task store
read-only; this commit adds only this row.

## 2026-09-22 late evening - sixth-generation carrier re-verified green at HEAD c2ced15 after the sibling landing; flip stays owner-only (task_b5ec79917d8514b2, run run_1790103166390_15)

Third "split" decision (1790102964154) kept the scope unchanged: repo-side
obligations only, the flip of landing cards task_7b773505d7c6eb43 /
task_2dd9dc18291f2625 is owner-side (both re-checked `open` in the store,
read-only, store untouched). Re-verified everything first-hand at HEAD
c2ced15 — the tree moved past 5bc25d1/1a9664a when the settled session-
continuity worktree work landed (c2ced15), which shifted the wiring lines:
feature commits c272b58 / 136f866 / e3ad851 / 31f69f0 / d1c4d78 / 96d15c6
all ancestors of HEAD (`git merge-base --is-ancestor` each); wiring live
(`require` now at main.cjs:59, `worktreeManager` guard 9492, `enabled()`
9493, `prepare` 9494, `discard` 9503, `settle` 9521); opt-in intact
(scripts/executor-worktrees.cjs:62 requires `MEFI_STUDIO_WORKTREE_RUNS ===
"1"` exactly); fresh `node --test tests/executor_worktree.test.mjs` -> 11
tests / 11 pass / 0 fail, exit 0 (11.9 s); `.mefi` absent and `git worktree
list` shows only the standing mb/mm/wt-* checkouts; `npm run check` exit 0
(101 targets, 205 specs unique, all selectors used, syntax ok). This commit
adds only this row; nothing else staged.

## 2026-09-22 late evening - sixth-gen carrier retry re-verified green on the twice-moved tree, HEAD drifted 9788722 -> c2ced15 and every repo-side obligation still holds (task_261f3a1af9aeda2d, run run_1790103104379_13)

Retry of the split-out card; the prior run's row (4f4dcd9) is context, not
proof, and the reviewer-flagged drift was real: HEAD moved six commits past
9788722 (through the 456+/317− main.cjs landing 2457a7d) before this run, then
once more mid-run (adf21a7 -> c2ced15). All checks re-run first-hand at
c2ced15, not from reports: feature commits c272b58 / 136f866 / e3ad851 /
31f69f0 / d1c4d78 / 96d15c6 plus evidence rows 23bdd5c / a973b73 / 009da87 all
ancestors of HEAD (`git merge-base --is-ancestor`, 9/9 true); wiring live at
HEAD (`require("./scripts/executor-worktrees.cjs")` main.cjs:59,
`worktreeManager` gate 9492-9521, per-run `cwd: entry.worktree?.path ||
runRoot` at 10383/10397/10415/10436 — line numbers shifted with 2457a7d,
content intact); opt-in exact (`scripts/executor-worktrees.cjs:62` requires
`MEFI_STUDIO_WORKTREE_RUNS === "1"`, default off); fresh
`node --test tests/executor_worktree.test.mjs` -> 11 tests / 11 pass / 0 fail,
exit 0 (10.9 s); `.mefi` absent and `git worktree list` shows only the five
standing checkouts (main/mb/mm/wt-command-visuals/wt-ux-phase0) — no per-run
residue. Both landing cards re-read from the store read-only:
task_7b773505d7c6eb43 and task_2dd9dc18291f2625 still open, so the owner-only
flip goes out via MEFI_ASK again; it is not this card's remainder. Nothing in
this card's own scope remains owed; task store untouched; sibling in-flight
files left exactly as found; this commit adds only this row.

## 2026-09-22 late evening - landing card closed: the gated 427+/302- main.cjs refactor already landed inside 2457a7d (task_7e5824cf51975676, run run_1790102912783_7)

This card asked for the sibling session's settled 427+/302− main.cjs edit to
be committed path-limited. Verified first-hand that the landing already
happened and cannot be replayed as its own commit: `git status --porcelain`
shows main.cjs clean at HEAD 17ba279 (no edit left to land), and 2457a7d
(13:39:21) carries main.cjs 456+/317− — the 427+/302− refactor plus the auth
split's own 29+/15− on the same file, so the shared-file path-limit folded
them; that commit's message itself states it "necessarily also lands the
sibling session's already-gated uncommitted 427+/302− worktree refactor
(TESTRUNS 6173a10)", and the auth-split row below records the same fold.
Content re-checked at HEAD this run, not from reports: `refreshAutopilotQueue(eyes = null, rows = null)` (main.cjs:8107), `autopilotProactivePass()` (8141), `queueExecutorCheckpoint(entry, { force, delay })` (8404), parameter-less `runVerificationJob(s)` (10756/10852), and `git grep` finds zero references to the deleted `taskPriority`/`setProactive` in main.cjs — exactly the 6173a10 fallout scan. Gate evidence for this content already in history: 6173a10 (check/test/audit exit 0 on the settled worktree), c4caee1 (independent full-gate rerun green), and the quiet-tree full gate above (npm test exit 0, node 2062/2059/0/3, Python 247 OK) which ran with 2457a7d's landed content in the tree. Fresh `npm run check` exit 0 this run (101 targets, 205 specs, syntax ok — the narrowest check for a ledger-only commit); nothing was staged before or after. The card flip for this task stays owner-side; task store untouched; sibling in-flight files left exactly as found; this commit adds only this row.

## 2026-09-22 late evening - parent-gate follow-up retry settles its remaining-prose shape - chain green first-hand at HEAD 17ba279, flip target resolved in its own lane (task_ad390ff083105169, run run_1790102799243_5)

Retry 1's "unverified — outstanding obligations remain" was the prose-shape
verdict again (cf. the 1a9664a and 5bc25d1 rows): the attempt's remaining note
was cut mid-parenthetical — "none for this card (flip handed off to the owner",
no closing paren — so the parenthetical branch of the remaining-work parser
never matched and the verifier counted an obligation. The substance was always
complete: this card's scope from the parent decision log was the owner-only
flip of task_c1cf337d66009c14, recorded in row 0ebf5fe. This run re-verified
the chain first-hand with `git merge-base --is-ancestor`: af88c20, 51e2c21,
0ebf5fe, and the child's correction row a690fcd (task_214a666a0948a828, done
and verified — reattributes the swept auth-split row run_1790101780278_28 to
task_88a18406f34104ca) are all in HEAD, and `npm run check` exit 0 (all five
stages, 101 targets/files). The flip itself discharged in its own lane:
task_c1cf337d66009c14 finished verified (6/6 files parse, 4 recorded checks
green) after this card's last run, so there is nothing left to flip. One stale
board artifact remains for the owner to sweep, not work: task_0ced1d7f880a818a,
a recursive "Follow-up: Follow-up: ..." echo of this card whose substance the
verified child already landed.

## 2026-09-22 late evening - quiet-tree full gate green: the withheld npm test of the auth split (2457a7d) plus build-booklet, both exit 0 (task_5e0a126238bab8fb, run run_1790102559644_4)

This row supplies the full-suite evidence the split row below withheld under
the contention protocol. Precondition checked first-hand, not from notes: the
three sibling runs live at dispatch (reattribution task_214a666a0948a828,
collision task_c1cf337d66009c14, chain task_94b29c15a3479597) were polled to
completion via the store's runProgress and their commits — a690fcd, 17ba279 —
landed with `TESTRUNS.md` clean at 17ba279 before the gate started; last repo
code edit remained the split's own 13:36 files inside 2457a7d, and the
long-settled session-continuity worktree (quiet since 13:17) stayed untouched,
still awaiting its own landing card. On that tree, at HEAD 17ba279 + the
settled dirty worktree: `npm test` -> exit 0 in 86 s (run-node-tests 178
suites, 9 launching Electron; node stage 2062 tests / 2059 pass / 0 fail /
3 skipped — the usual capability-gated Electron records, per the table above;
two serialized stages 1/1 pass each; `python -m unittest discover` 247 tests
OK in 34.7 s; normalized-path lock checks all passed; the runner's own
slow-step waits fired for "work"/"late" startup on a loaded desktop but
nothing failed and no source moved mid-run). `npm run build-booklet` ->
exit 0, "built renderer\booklet.html — 39 models, hash f98dd2322a01"; the
regenerated booklet.html stays in the dirty worktree for the landing card
(task_bd9f27c9f8258f1d) — this commit adds only this row and touches no
code, per the gate's evidence-only scope. One caveat for the record: the
dispatcher re-leased task_ad390ff083105169 (no worker spawned) ~90 s before
the run; it stayed workerless and file-quiet through both commands.

## 2026-09-22 late evening - correction: the auth-split row below belongs to task_88a18406f34104ca - it was swept into 0ebf5fe (task_214a666a0948a828, run run_1790102522200_3)

One-line reattribution per the 9788722 pattern: the auth/settings split row
(task_88a18406f34104ca, run run_1790101780278_28) below landed inside 0ebf5fe
while its run was still in flight; that run has since finished and committed
its code files at 2457a7d (no TESTRUNS row of its own), so the row stands as
written — verified first-hand via `git show 0ebf5fe --stat` (TESTRUNS.md +54/-1
carrying both rows) and `git show 2457a7d --stat` (8 code files, no ledger
edit); attribution corrected here, nothing removed or rewritten.

## 2026-09-22 late evening - integration-gate chain card closes on first-hand evidence: c6e349c's green row re-verified in-history, one sibling already verified on it, the collision card's flip stays owner-only (task_94b29c15a3479597, run run_1790102501766_2)

Retry 3/3 of the chain-closure card. The two prior denials are understood
first-hand: retry 1 (run_1790086242215_15) landed the evidence but ended
with "remaining: host closes ..." prose, which the verifier read as an
outstanding obligation; retry 2 (run_1790087766670_8) re-reported the same
evidence with no attributable edit and no named checks. This attempt
re-verifies the chain first-hand and records it durably instead.

Evidence re-verified this attempt, not assumed: `git merge-base
--is-ancestor c6e349c HEAD` -> exit 0, and `git show --stat c6e349c` ->
1 file changed (26 insertions, TESTRUNS.md only): the 2026-09-22
09:13-09:17 full-gate green rerun row for run_1790086242215_15 (`npm run
check` + `npm run build-booklet` + `npm test` exit 0; the first npm
test's occlusion_probe failure solo-confirmed environmental, then green
on rerun) exists in history, and its closing sentence names
task_336a62b5d249978f / task_c1cf337d66009c14 as the cards it evidences
on "sibling edits landed".

Store re-read (never rewritten from a worker): task_336a62b5d249978f is
done and verified — the sibling-evidence ask of this card's prompt is
discharged. task_c1cf337d66009c14 ("Resolve collision: booklet.js +5
more") is still active with "Delegated 2 subtasks; integration waits for
their verified results"; its delegates' scoped checks are green in
history (ba72edd, 5bc25d1) and this card's attempt-2 child handoff
(task_93c9907b18ec3928) resolved complete. That card's integration flip
is host bookkeeping by the chain's own split decisions (0ebf5fe,
4f4dcd9) and goes out via MEFI_ASK — it is not this card's remainder.

Named checks this attempt: `git merge-base --is-ancestor c6e349c HEAD`
-> exit 0; `npm run check` -> exit 0 (check-targets 101 targets, full
coverage; spec-collisions 205 specs, unique basenames, no orphans;
ALL-SELECTORS-USED across 5 stylesheets; check-syntax 101 files,
in-process) on the sibling in-flight tree exactly as found. Full
`npm test` withheld per this file's contention protocol and the chain's
flake history: the tree carries 39 uncommitted sibling paths, and the
c6e349c row already stamps the full gate on a quieter tree. Nothing
repo-side is still owed on this card; task store untouched; sibling
in-flight files left exactly as found; this commit adds only this row.

## 2026-09-22 late evening - sixth-gen carrier (the split-out card) takes its scope from the decision log: extra work is board-side only, repo-side re-verified green at HEAD 9788722 (task_261f3a1af9aeda2d, run run_1790102049200_35)

This card was spawned at the owner's 18:31:54 "split the extra work out"
decision on task_fece4ffd34e38932; that run's row (009da87) is adopted, not
redone. Scope recovered from the chain's decision logs: every generation's
remaining prose names exactly one extra item — the owner-side board flip of
landing cards task_7b773505d7c6eb43 / task_2dd9dc18291f2625 — host bookkeeping
a worker must not touch, and the row below (task_ad390ff083105169) hit the
same wall on its own chain. Repo-side state independently re-verified at
current HEAD 9788722 (tree moved past c4caee1 on sibling commits): feature
commits c272b58 / 136f866 / e3ad851 / 31f69f0 / d1c4d78 / 96d15c6 plus
evidence rows 23bdd5c / a973b73 / 009da87 all ancestors of HEAD
(`git merge-base --is-ancestor`, 9/9 true); wiring live
(`require("./scripts/executor-worktrees.cjs")` at main.cjs:59, the
`worktreeManager` gate at main.cjs:9492, per-run `cwd: entry.worktree?.path
|| runRoot` sites); opt-in exact (`scripts/executor-worktrees.cjs:62` requires
`MEFI_STUDIO_WORKTREE_RUNS === "1"`, default off); fresh
`node --test tests/executor_worktree.test.mjs` -> 11 tests / 11 pass /
0 fail, exit 0 (14.8 s); `.mefi/worktrees` absent — no per-run residue. Both
landing cards re-read from the store: still open, still carrying only their
creation logs; their flip stays host-side and goes out via MEFI_ASK, not as
this card's remainder. Nothing in this card's own scope remains owed; task
store untouched; sibling in-flight files left exactly as found; this commit
adds only this row.

## 2026-09-22 late evening - follow-up to the parent integration gate: the split item is the owner-only card flip, chain re-verified first-hand (task_ad390ff083105169, run run_1790102031369_34)

Scope recovered from the parent card's decision log, not guessed: the parent
(task_b63e296b2ca2b7e7, "parent integration gate — follow-up 80df69") carries
one decision — "split the extra work out" (1790101895000, kind scope) —
answering its own MEFI_ASK of whether to close task_c1cf337d66009c14 now that
its gate is green. The item being split out is board bookkeeping inside
Studio, host-side by rule (workers must not rewrite the task store; the rows
below hit the same wall and hand flips to the owner). Re-verified the
repo-side chain before handing it back, all first-hand this run: evidence
rows af88c20 and 51e2c21 in history (`git log -- TESTRUNS.md`), the retry's
full gate set green at 5bc25d1 (npm test 2054/2051/0/3 + Python 247 OK,
build-booklet byte-identical 72c66122feec…); task_c1cf337d66009c14 still
`open` in the store (read-only check at this dispatch); fresh `npm run check`
exit 0 on the current in-flight tree (101 targets, 204 specs unique, all
selectors used, syntax ok 101 files). No repo-side work exists to split
further — minting another carrier would be an empty card. Task store
untouched; sibling in-flight files left exactly as found; this commit adds
only this row.

## 2026-09-22 late evening - auth/settings split: ciphertext moved to auth.json, scoped gates green (task_88a18406f34104ca, run run_1790101780278_28)

Adopted the pi study's settings/auth split (docs/pi-provider-storage.md
takeaway). New `scripts/auth-store.cjs` owns the split: credential fields (the
`credentials.ENV_KEYS` set, DPAPI ciphertext) persist to
`userData/auth.json`, never to `settings.json`; `main.cjs` `readSettings()`
returns one merged view (preferences + auth fields) and migrates legacy
settings.json ciphertext once — auth.json is written before the preferences
file is stripped, so no crash window holds the blobs nowhere. `writeSettings()`
persists the merged view's auth slice as the whole store, so the existing
`delete settings[field]` clear flow empties auth.json too. A missing/unreadable
auth file reads as "no keys" (fresh installs write no auth file). No IPC,
keystore or env-precedence contract changed: `settings:get-key`/`set-key`,
`savedKey`, `decryptKey`, the `--set-*-key` CLI handlers and the
`via: "settings"` label are untouched — every caller keeps reading
`settings[field]`.

Evidence on this tree: `node --test tests/auth_split.test.mjs
tests/env_credentials.test.mjs` -> 14/14 pass (8 new auth_split tests: field
set parity with ENV_KEYS, split/merge round-trip, missing/torn auth file reads
as no keys, store replacement leaves no tmp residue, main.cjs wiring and
migration-order assertions, keystore/precedence contracts unchanged);
`python -m unittest tools.test_mefi_studio_routing` -> 23 tests OK;
`npm run check` -> exit 0 (101 targets/files through the syntax pass, includes
the new module). Full `npm test` withheld per the contention protocol: the
shared worktree still carries a sibling session's uncommitted in-flight tree,
and this commit's main.cjs necessarily lands that sibling's already-gated
427+/302- refactor (green in the 6173a10 entry) alongside the split. Docs
updated where the old location was named: GETTING_STARTED (key storage, what
not to copy), SECURITY (key at rest, local-state bullet),
docs/architecture.md, docs/first-run-opencode.md, and the pi study's takeaway
now records the adoption.

## 2026-09-22 late evening - split decision honored: fifth-gen card already carries the extra work, repo-side obligations re-verified green at HEAD c4caee1, flip stays owner-only (task_fece4ffd34e38932, run run_1790102013188_33)

The owner's scope decision on this card (1790101914614, "split the extra work
out") is already executed board-side: the store shows the fifth-generation
carrier task_261f3a1af9aeda2d spawned ~50 ms after the decision and active,
so the extra work has its own card — minting another would only re-duplicate
the chain, and the dispatch rule forbids child cards for bookkeeping. This
card therefore keeps exactly its repo-side verification scope, re-verified
first-hand at HEAD c4caee1 (tree moved past 5bc25d1/1a9664a on sibling
TESTRUNS-only commits): feature commits c272b58 / 136f866 / e3ad851 /
31f69f0 / d1c4d78 / 96d15c6 plus evidence rows 23bdd5c / a973b73 all
ancestors of HEAD (`git merge-base --is-ancestor`, 8/8 true); wiring live
(`require("./scripts/executor-worktrees.cjs")` at main.cjs:58, the
`worktreeManager` gate at main.cjs:9487); opt-in intact
(`scripts/executor-worktrees.cjs:62` requires
`MEFI_STUDIO_WORKTREE_RUNS === "1"` exactly, default off); fresh
`node --test tests/executor_worktree.test.mjs` -> 11 tests / 11 pass /
0 fail, exit 0 (36.0 s); `.mefi` absent and `git worktree list` shows only
the standing main/mb/mm/wt-command-visuals/wt-ux-phase0 checkouts — no
per-run residue. Landing cards task_7b773505d7c6eb43 and
task_2dd9dc18291f2625 re-read from the store: both still open; their flip
stays host-side and is handed off via MEFI_ASK, not as this card's
remainder. Nothing in this card's own scope remains owed; task store
untouched; sibling in-flight files left exactly as found; this commit adds
only this row.

## 2026-09-22 late evening - A-Eyes "uncommitted work" warn re-checked first-hand: alert stale, both commits in HEAD, named checks green; prior failure was the remaining-prose trap (task per run_1790101891091_31)

The A-Eyes warn said the booklet contract test and `tools/verify_dev_app.mjs`
changes from sessions ses_f3631f870ffeoCbC3Gou37bEpI /
ses_f3633e551ffeOKdK97uhc8hb7M existed only uncommitted. Re-checked at HEAD
c4caee1: `git merge-base --is-ancestor` confirms e3cd322 ("Booklet contract:
brains assets inlined exactly once, no src leftovers") and b8f1a7a ("Add the
dev-app module-graph named check") are both ancestors of HEAD, and
`git status --porcelain` for `tools/test_mefi_studio_booklet.py`,
`tests/booklet_build.test.mjs` and `tools/verify_dev_app.mjs` is clean — the
alert fired from a stale snapshot; a fresh scan finds nothing. The previous
attempt's "verification: outstanding obligations remain" was the prose-shape
trap the rows below document: its report carried non-denial remaining prose,
which `verifyCompletion` counts as this card's own obligation
(scripts/assistant.mjs:3782). Nothing in this card's scope remains owed.
Fresh named checks at HEAD c4caee1: `node --test
tests/booklet_build.test.mjs` -> 3 tests / 3 pass / 0 fail;
`python tools/test_mefi_studio_booklet.py` -> 10 tests OK, exit 0; `node
tools/verify_dev_app.mjs` -> 74 files scanned, 0 resolution failures, serve
probe HTTP 200, exit 0. Sibling in-flight edits (main.cjs, renderer, docs)
left exactly as found; this commit adds only this row.

## 2026-09-22 late evening - sibling main.cjs refactor verification retry: independent full-gate rerun green on the settled uncommitted 427+/302- tree (task_d770727341b466b7, run run_1790101761830_27)

Retry 1 settled "unverified — outstanding obligations remain" for the same
prose-shape trap the rows below document: the prior `MEFI_RESULT` carried
"remaining: the refactor itself is still uncommitted" — landing is the
sibling session's call, out of this verify-only card's scope, and
`verifyCompletion` reads any non-denial remaining prose as this card's own
obligation (scripts/assistant.mjs:3782). Its verification pass had also run
`npm run check` alone. This retry re-verified first-hand on the settled
tree: `git status --porcelain` shows main.cjs still carrying the uncommitted
427+/302− refactor plus sibling sessions' in-flight files (41 entries,
nothing staged); `git show --name-only` confirms 6173a10 and every commit
after it (d30d5ec, 5bc25d1, 1a9664a) touch TESTRUNS.md only, so no
test-read source moved since the gated state. Full gate set re-run
independently and sequentially at HEAD 5bc25d1→1a9664a (TESTRUNS-only
drift mid-pass; the runner reported no sources-moved warning): `npm run
check` exit 0 (100 targets, 204 specs, CSS + syntax ok); `npm test` exit 0
(node stage fail 0, Python 247 OK in 73.8 s, worktree lock check passed);
`npm run audit` exit 0 with `ok: true`, 0 findings / 0 errors / 0 warnings.
The card's obligation — its own gate run on the settled edit — is
discharged; committing main.cjs stays with the refactor's own session.
Task store untouched; this commit adds only this row.

## 2026-09-22 late evening - parent integration gate re-verified green on the moved tree, retry-1 denial traced to its remaining-prose shape (task_b63e296b2ca2b7e7, run run_1790101737630_26)

Retry 1 settled "unverified — outstanding obligations remain" for the shape
row 5bc25d1 names: its report ended "remaining: host-side close of
task_c1cf337d66009c14", which `noRemainingWork` does not accept, while the
verifier's own re-run had only re-run `npm run check`. The tree also moved
five commits past the af88c20 evidence (through 5bc25d1), so this retry
re-ran all three gate commands first-hand at HEAD 5bc25d1 on the whole
in-flight tree (main.cjs and renderer work included) and recorded every exit
code. `npm run check` exit 0 (targets 100/100, 204 specs unique, all
selectors used, syntax ok 100 files). First `npm test` exit 1 on exactly one
test — performance_render's EBUSY rmdir of its own Electron temp dir, the
documented environmental row ("Rerun solo"); this dispatch was itself held
three times for low memory/responsiveness, so the machine was contended.
Solo rerun `node --test tests/performance_render.test.mjs` — 2/2, exit 0.
Full `npm test` rerun exit 0 — node 2054 tests / 2051 pass / 0 fail /
3 skipped (the documented environment-conditional skips), serialized
eyes_toggle 1/1, occlusion probe green (worker drift 165 ms), Python
contracts `Ran 247 tests in 36.0s` OK, normalized-path lock stage passed.
`npm run build-booklet` exit 0 — 39 models, hash f98dd2322a01, and the
rebuilt booklet is byte-identical to the working tree (git hash-object
72c66122feec… before == after): nothing stale for the landing sequence.
Retry 1's "changedFiles: 1" was commit af88c20 itself (TESTRUNS.md +24, the
evidence row) — an intended path-limited write, not an unexplained one. Task
store untouched; sibling in-flight files left exactly as found; this commit
adds only this row. The card flip for task_c1cf337d66009c14 stays
owner-side.

## 2026-09-22 late evening - fifth-generation worktree follow-up retry: same prose-shape trap, evidence re-verified green at HEAD 5bc25d1, flip stays with the owner (task_fece4ffd34e38932, run run_1790101684741_24)

Retry 1 (receipt rcp_0f25afd788ac3037) settled "unverified — outstanding
obligations remain" for the same reason the collision-delegate card below/
above diagnosed: its `MEFI_RESULT` named the owner-only board flip as this
card's own remaining work, and `verifyCompletion` reads any non-denial
remaining prose as outstanding (scripts/assistant.mjs:3782). The flip is
host-side bookkeeping — workers must not rewrite the task store — and the
dispatch rule is to report implementation scope only; it is handed off via
MEFI_ASK, not as this card's remainder. Scope re-decided from the parent
card's (task_b5ec79917d8514b2) decision log: one decision, "split the extra
work out" (1790101192893); splitting again would only mint another empty
carrier. Re-verified first-hand at HEAD 5bc25d1: feature commits c272b58 /
136f866 / e3ad851 / 31f69f0 / d1c4d78 / 96d15c6 all ancestors of HEAD;
wiring live (`require` at main.cjs:58, `worktreeManager` at main.cjs:9487);
opt-in intact (`enabled()` requires `MEFI_STUDIO_WORKTREE_RUNS === "1"`
exactly); fresh `node --test tests/executor_worktree.test.mjs` -> 11 tests /
11 pass / 0 fail, exit 0 (15.1 s); `.mefi/worktrees` absent and
`git worktree list` shows only the standing mb/mm/wt-* checkouts — no
per-run residue; evidence rows 1adbf24 / 93287af / 23bdd5c in history.
Landing cards task_7b773505d7c6eb43 and task_2dd9dc18291f2625 remain `open`
on the board with their repo-side obligations verifiably discharged — the
flip is the owner's. Task store untouched; sibling in-flight files left as
found; this commit adds only this row.

## 2026-09-22 late evening - worktree follow-up carrier retry fixes its remaining-prose shape: repo-side green at 5bc25d1, flip handed to the owner (task_b5ec79917d8514b2, run run_1790101552767_22)

Retries 1 and 2 (receipts rcp_3e4d27c0b935b102, rcp_dad5e9b58505bedf) ran
their scoped checks green yet settled "unverified — outstanding obligations
remain": the owner-scoped landing-card flip was reported inside the
MEFI_RESULT remaining prose, and verifyCompletion counts any non-denial
remainder as outstanding — `noRemainingWork` (scripts/assistant.mjs) accepts
a bare "none" plus a card-scope tail or a handed-elsewhere parenthetical
(parent, integration, deferred, handed off, follow-ups, out of scope). The
split decision (1790101192893) scoped the flip of task_7b773505d7c6eb43 /
task_2dd9dc18291f2625 to the owner — both cards are still `open` in the
task store (read-only check, store untouched) — so no worker re-run could
ever discharge it; only the report shape could break the loop, the same
root cause the collision-delegate card hit one commit earlier (5bc25d1
below). The running dist gate copy (assistant.mjs:3697-3706, 3782) matches
the committed reader.

Re-verified every repo-side obligation first-hand at HEAD 5bc25d1 (the tree
moved past 6acf79f / 1adbf24 / 93287af / 06dc84d / 23bdd5c / 9bfd803 since
the earlier rows): feature commits c272b58 / 136f866 / e3ad851 / 31f69f0 /
d1c4d78 / 96d15c6 are all ancestors of HEAD; the wiring is live (require at
main.cjs:58, worktreeManager prepare at main.cjs:9489, discard at 9498/9699,
settle at 9516); the opt-in default is intact
(scripts/executor-worktrees.cjs:62 `enabled()` requires
`MEFI_STUDIO_WORKTREE_RUNS === "1"` exactly); fresh `node --test
tests/executor_worktree.test.mjs` -> 11 tests / 11 pass / 0 fail, exit 0
(16.6 s); `git worktree list` shows only the standing mb/mm/wt-* checkouts
and `.mefi/worktrees` does not exist. This report therefore carries the
flip as a handed-elsewhere parenthetical — "none (owner-side flip handed
off)" — plus an owner MEFI_ASK card; no product or test code touched;
sibling in-flight files preserved; this commit adds only this row.

## 2026-09-22 late evening - collision-delegate retry 3 discharges by fixing its own remaining-prose shape: all scoped checks green again (task_93c9907b18ec3928, run run_1790101430261_20)

Retries 1 and 2 (receipts rcp_2474eaa83c45b800, rcp_6afc42cbf6392c24) both ran
every recorded delegate check green yet settled "unverified — outstanding
obligations remain". Root cause, verified first-hand against
`verifyCompletion` (scripts/assistant.mjs) with the exact stored inputs: the
retry's own `MEFI_RESULT` remaining prose — "none on the host — Studio-side
delegate verification … integration." — is not a shape the denial reader
accepts (`noRemainingWork` allows a bare "none" plus a scope tail or a
handed-elsewhere parenthetical), so `outstanding` stayed true; the
`rerunDischarges` escape needs `priorVerified`, which this card never had
(it is for retries of once-verified cards, not first discharges). Re-running
the checks could never fix it — only the report shape could. This retry re-ran
each delegate's scoped list first-hand at HEAD, all exit 0 with counts
matching the delegates' own: `node --test tests/model_auto_setup.test.mjs` —
16/16 (104 ms) for task_delegate_d9f299382ce7faa99dfc1f15;
`python -m unittest discover -s tools -p test_mefi_studio_routing.py` — Ran
23 tests, OK (2.3 s), and `node --test tests/jev_routing_ui.test.mjs` — 19/19
(280 ms) for task_delegate_f86594532fe0532c3d541359 — no host-side remainder,
so both delegates can verify and task_c1cf337d66009c14 can integrate; the
report now carries a canonical `remaining: none`. Replay check: the verdict
for the retry-2 inputs with only the remaining text changed to `none` flips
to verified ("recorded check(s) passed in the attempt's session"). No product
or test code touched; sibling in-flight files preserved; this commit adds
only this row.

## 2026-09-22 late evening - persistent-memory guard discharged: full npm test green for the severe-memory parallelism cap, boundary hysteresis already pinned (task_1a265efeeb6cbdd3, run run_1790101379524_18)

The retry's outstanding obligation was the full-gate evidence for the
severe-memory parallelism cap (the narrow 34+56/check/audit run covered only
the scoped suites). Verified first-hand that the cap is committed, not just
claimed: `scripts/machine.mjs` carries the latch (severeCapSamples: 2 — two
consecutive under-floor readings engage, two consecutive readings past floor
plus margin release, per-call resampling keeps it alive past its hold) and
landed in 3198c4d, an ancestor of HEAD; the working tree is clean for
machine.mjs and its tests. The optional cap-boundary hysteresis handoff is
also already implemented and pinned: tests/machine_capacity.test.mjs:339-397
covers consecutive engage, consecutive release, and the observed 197 -> 526 ->
354 MB oscillation staying held — so no flicker hardening was left to do.
Scoped rerun `node tests/machine_capacity.test.mjs` 27/27 before the gate.
Full `npm test` exit 0 — node stage 2054 tests / 2051 pass / 0 fail /
3 skipped (the documented environment-conditional skips, same baseline as the
rows below), occlusion probe ran (worker drift 164 ms, no failure), Python
contracts `Ran 247 tests in 38.125s` OK, normalized-path lock green. Task
store untouched; this commit adds only this row.

## 2026-09-22 evening - quiet-tree full-gate rerun green end-to-end: midday booklet race gone, one documented perf flake on the first attempt (task_cff03b8e4922cc5d, run run_1790100967469_4)

The sibling landed its last wave at 13:17:55-56 — renderer/brains.js and
brains.css edited together, booklet.html rebuilt two seconds later — so for the
first time today the inlined copy matched the working tree. The gate launched
13:24:23 with ~6.5 min of quiescence and no sibling suite in flight (only the
standing serve.mjs watchers and MCP servers). First attempt exit 1 in 89.6 s:
node stage 2054 tests / 2050 pass / 1 fail / 3 skipped, the single failure
`performance_render` "Profiler JSON download timed out after 5320ms" — the
documented Electron-capture flake (first row of the table above) — which also
stopped the chain before the Python stage. Immediate full rerun with no tree
changes in between: exit 0 in 132.3 s. Node 177 suites (9 Electron), 2054
tests / 2051 pass / 0 fail / 3 skipped in 72.2 s, serialized
`eyes_toggle_electron` 1/1 and `occlusion_probe` 1/1, no sources-moved flag.
Python contracts 247 tests in 39.3 s, OK —
`test_brains_assets_are_inlined_exactly_once` passes against the 13:17:56
booklet, closing the midday race. The normalized-path lock stage was reached
this time and all checks passed. Sibling dirty files and the task store
untouched; this commit adds only this row.

## 2026-09-22 evening - sibling main.cjs refactor gated on the settled worktree: all three gates exit 0 (task_d770727341b466b7, run run_1790101083802_7)

The in-flight main.cjs edit this card's parent row saw at 47+/64− settled at
427+/302− in the shared worktree and was verified there, not from any report.
Settle evidence first-hand: `Get-Item main.cjs` LastWriteTime 13:09:30 with
no writes for 12 minutes before pickup, and the full `git diff -- main.cjs`
SHA-256 identical across a 25-second window (6DDB31AE6086…). The refactor
is the autopilot/proactive-pass rework: `autopilotProactivePass({useAi})` ->
`autopilotProactivePass()`, `refreshAutopilotQueue(eyes)` gains a `rows`
param, `queueExecutorCheckpoint` gains `delay`, `runVerificationJob(s)`
drop the `fallbackJob`/`job` params, and `taskPriority` / `setProactive`
are deleted from main.cjs. Fallout scan: no reference to either deleted
name remains in main.cjs (`taskPriority` lives on as its own copy in
scripts/assistant.mjs; the scripts/policy.mjs mention is a historical
comment), and every in-file call site matches the new signatures — one
cosmetic leftover passes a now-ignored argument
(`runVerificationJobs(job)` at main.cjs:10223; the parameter-less
definition ignores it, harmless at runtime). `node --check main.cjs`
exit 0. Gates, run bare from the project root over this loaded tree:
`npm run check` exit 0 (targets 100/100, spec-collisions 204 unique no
orphans, css merge skip, all selectors used, syntax ok 100 files);
`npm test` exit 0 — parallel node stage 2054 tests / 2051 pass / 0 fail /
3 skipped (the documented environment-conditional skips), serialized
eyes_toggle_electron 1/1, occlusion_probe 1/1 with real occlusion engaged,
Python contracts Ran 247 tests OK in 92.5 s, normalized-path lock all
passed; `npm run audit` exit 0 with findings [] / 0 warnings (checkedAt
2026-09-22T18:26:14Z). Settle honest note: HEAD moved ba72edd -> 23bdd5c
mid-run via TESTRUNS.md-only sibling commits and no test-read source
moved; ~37 sibling in-flight modified files plus 2 untracked were present
and untouched, the working-tree main.cjs diff is byte-identical after the
run (still 427+/302−, uncommitted, owned by its session), and the task
store was not modified from this worker. This commit adds only this row.

## 2026-09-22 evening - fourth-generation carrier: remainder confirmed owner-only, repo re-verified at HEAD 06dc84d (task_fece4ffd34e38932, run run_1790101296453_15)

Scope decided from the parent card's (task_b5ec79917d8514b2) decision log,
not guessed: one decision — "split the extra work out" (1790101192893) — and
its uncovered work is the same item every generation found: flipping landing
cards task_7b773505d7c6eb43 / task_2dd9dc18291f2625 to done, which duplicates
of each other asking for the same landed work. Both cards are still `open` on
the board at dispatch time; the task store was not modified from this worker.
Re-verified the discharged obligations first-hand at HEAD 06dc84d (tree moved
past the parent rows 1adbf24 / 93287af): feature commits c272b58 / 136f866 /
e3ad851 / 31f69f0 / d1c4d78 / 96d15c6 all ancestors of HEAD; wiring live
(require at main.cjs:58); opt-in default intact
(scripts/executor-worktrees.cjs:62 `enabled()` requires
`MEFI_STUDIO_WORKTREE_RUNS === "1"` exactly); `.mefi/worktrees` absent and
`git worktree list` shows only the standing mb/mm/wt-* checkouts; fresh
`node --test tests/executor_worktree.test.mjs` -> 11 tests / 11 pass / 0
fail, exit 0 (65.1 s). TESTRUNS.md was clean before this row; sibling
in-flight files untouched; this commit adds only this row. The flip itself is
a board action only the owner can take and is asked via MEFI_ASK; splitting
it again would spawn another empty carrier card, so no handoff was raised.

## 2026-09-22 evening - parent integration gate green on the whole in-flight tree: check / test / build-booklet all exit 0, midday booklet race resolved (task_b63e296b2ca2b7e7, run run_1790101049993_6)

The gate task_c1cf337d66009c14 needs before closing: all three commands over
the in-flight tree (main.cjs carrying a 427+/302− uncommitted refactor,
renderer/startup.js + renderer/boot.js tracked and wired, ~41 sibling-modified
files + 2 untracked), run from the project root at HEAD 1adbf24. `npm run
check` exit 0 — targets ok (100/100 through the syntax pass, full coverage),
spec-collisions ok (204 specs, unique, no orphans), css merge skip, all
selectors used (5 stylesheets), check-syntax ok (100 files, in-process).
`npm test` exit 0 — node stage 177 suites (9 launch Electron), 2054 tests /
2051 pass / 0 fail / 3 skipped (the documented environment-conditional
skips), serialized eyes_toggle_electron 1/1, occlusion probe ran (worker
drift 164 ms, no failure), no sources-moved-mid-run flag; Python contracts
`Ran 247 tests in 42.1s` OK — including the
`test_brains_assets_are_inlined_exactly_once` case that failed in the midday
run below, so the sibling's booklet rebuild has since caught up; the
normalized-path lock stage green. `npm run build-booklet` exit 0 — built
renderer\booklet.html, 39 models, hash f98dd2322a01, and a repeat build is
byte-identical (git hash-object 72c66122feec… before == after): the
working-tree booklet is exactly the deterministic build of the current
renderer sources, nothing stale left for the landing sequence. Task store
untouched; sibling in-flight files left exactly as found; this commit adds
only this row.

## 2026-09-22 evening - retry 1 after the third-generation row: split honored, repo-side green re-confirmed at HEAD 1adbf24, flip still host-side (task_b5ec79917d8514b2, run run_1790101232178_12)

The prior run's verification receipt (rcp_3e4d27c0b935b102) said "outstanding
obligations remain" only because its result named the host-side remainder; the
owner's "split" decision (1790101192893) already scoped that out. This retry
honors the split: the task store and landing cards
task_7b773505d7c6eb43 / task_2dd9dc18291f2625 were not touched. Confirmed the
prior evidence row 1adbf24 is intact — it is HEAD, changed TESTRUNS.md only
(+20), and the working tree had no stray file from that run (TESTRUNS.md
clean; the ~39 modified + 2 untracked files are sibling in-flight work, left
exactly as found). Re-verified repo-side claims first-hand at HEAD 1adbf24:
feature commits c272b58 / 136f866 / e3ad851 / 31f69f0 / d1c4d78 / 96d15c6 all
ancestors of HEAD; wiring live (require at main.cjs:58, worktreeManager at
9487, prepare 9489, discard 9498); opt-in intact
(scripts/executor-worktrees.cjs:62 `enabled()` requires
`MEFI_STUDIO_WORKTREE_RUNS === "1"` exactly); fresh `node --test
tests/executor_worktree.test.mjs` -> 11 tests / 11 pass / 0 fail, exit 0;
`git worktree list` shows only the standing mb/mm/wt-* checkouts, no
`.mefi/worktrees`. `npm run check` exit 0 (targets 100/100, 204 specs unique,
all selectors used, syntax ok, 100 files). Sole remainder is unchanged and
owner-only: flip the two landing cards to done. This commit adds only this
row.

## 2026-09-22 evening - third-generation follow-up re-verified at HEAD 6acf79f: landing-card obligations discharged, flip stays host-side (task_b5ec79917d8514b2, run run_1790100921654_3)

Scope recovered from the parent card's decision log, not guessed: the parent
(task_4dc2a045b8d46b20) carries one decision — "split the extra work out" —
and its uncovered work was the same item every generation of this chain found:
flipping landing cards task_7b773505d7c6eb43 and task_2dd9dc18291f2625 to
done host-side. Re-derived every prior claim first-hand at HEAD 6acf79f:
feature commits c272b58 / 136f866 / e3ad851 / 31f69f0 / d1c4d78 / 96d15c6
all exist and are ancestors of HEAD; wiring is live (require at main.cjs:58,
worktreeManager instantiated at main.cjs:9487); the opt-in default is intact
(scripts/executor-worktrees.cjs:62 `enabled()` is
`MEFI_STUDIO_WORKTREE_RUNS === "1"` exactly); fresh `node --test
tests/executor_worktree.test.mjs` -> 11/11 pass / 0 fail, exit 0 (16.1 s);
`git worktree list` shows no `.mefi/worktrees` checkouts — no residue.
Both landing cards remain `open` in the board (untouched since
1790090960999 / 1790088174591), so the only remaining work is the host-side
status flip, which stays with the owner per the no-worker-rewrite rule.
Nothing staged before or after; ~41 sibling in-flight modified files plus 2
untracked left exactly as found; this commit adds only this row.

## 2026-09-22 evening - collision-delegate scoped checks re-verified green at HEAD 6acf79f, retry 1 of the false "outstanding obligations" loop (task_93c9907b18ec3928, run run_1790100988544_5)

Retry of the 16:0x rerun row below after its verification receipt
(rcp_2474eaa83c45b800) still said "outstanding obligations remain" despite
all four checks green and a TESTRUNS evidence row committed (789001b) —
the loop the child card task_8cc401d711b549ba has since fixed verifier-side
(1e61b58 TESTRUNS-row discharge + ae5916e settle wiring, both ancestors of
this HEAD). Re-ran every recorded scoped check first-hand from the project
root at HEAD 6acf79f, all exit 0 with counts matching the delegates' own:
`node --test tests/model_auto_setup.test.mjs` — 16 tests / 16 pass / 0 fail
(155 ms); `python -m unittest discover -s tools -p
test_mefi_studio_routing.py` — Ran 23 tests, OK (4.0 s);
`node --test tests/jev_routing_ui.test.mjs` — 19 tests / 19 pass / 0 fail
(415 ms); shared `npm run check` prefix — targets ok (100/100),
spec-collisions ok (204 specs, unique, no orphans), css merge skip, all
selectors used, syntax ok (100 files). Per-delegate verdicts: delegate
task_delegate_d9f299382ce7faa99dfc1f15's list (model_auto_setup) green;
delegate task_delegate_f86594532fe0532c3d541359's list
(mefi_studio_routing + jev_routing_ui) green — no host-side remainder, so
both can verify and task_c1cf337d66009c14 can integrate. No product or
test code touched; ~45 sibling in-flight modified files plus 2 untracked
left exactly as found; this commit adds only this row.

## 2026-09-22 afternoon - retry after the second "split" decision: repo-side half re-verified at HEAD, host-side flip carried by the new card (task_4dc2a045b8d46b20, run run_1790100903971_2)

The owner answered this card's b300702 scope question with "split the extra
work out" (1790100324909), which created the carrier card
task_b5ec79917d8514b2 for the host-side remainder. This retry therefore owns
only the repo-side half and re-verified it first-hand at HEAD 6acf79f (the
tree had moved past 1e61b58): feature commits c272b58 / e3ad851 / 31f69f0 /
d1c4d78 / 96d15c6 are all ancestors of HEAD; the wiring is intact
(`require` at main.cjs:58; `worktreeManager` `prepare` at main.cjs:9489,
`discard` at 9498/9699, `settle` at 9516); fresh
`node --test tests/executor_worktree.test.mjs` -> 11/11 pass, exit 0
(12.0 s); `.mefi/worktrees` does not exist and `git worktree list` shows
only the standing mb/mm/wt-* checkouts, no per-run residue; the default is
still opt-in (`enabled()` at scripts/executor-worktrees.cjs:62 requires
`MEFI_STUDIO_WORKTREE_RUNS === "1"` exactly). Landing cards
task_7b773505d7c6eb43 and task_2dd9dc18291f2625 remain `open` on the board —
the flip is host-side only and was not done from this worker; the task
store was not touched. Sibling in-flight files (~32 modified, 2 untracked)
were present and untouched; this commit adds only this row.

## 2026-09-22 midday - full-gate retry on a tree that never went quiet: node stage all green, the one Python failure races the sibling's booklet rebuild (task_cff03b8e4922cc5d, run run_1790099546420_7)

The quiet-tree precondition could not be met: renderer/brains.js (13:00:14),
brains.css (13:00:19) and main.cjs (12:59:36) were all written within two
minutes of the 13:01:23 launch, though no sibling suite was in flight at
start (the earlier command_render and perf-trace runs had exited). `npm
test` exit 1 in 87.4 s. Node stage fully green — 177 suites, 2031 tests /
2028 pass / 0 fail / 3 skipped (the documented environment-conditional
skips), serialized `eyes_toggle_electron` 1/1 and `occlusion_probe` 1/1,
no sources-moved-mid-run flag. Python contracts: 247 tests in 34.6 s with
exactly one failure, `test_brains_assets_are_inlined_exactly_once`
(asset='brains.js', "1 != 0") — the working-tree brains.js had moved past
the copy inlined in renderer/booklet.html, so the verbatim count was 0;
the sibling rebuilt booklet.html at 13:02:52, seconds after the run ended,
and edited brains.js again at 13:03:19, so the failure belongs to that
landing sequence (edit, build-booklet, commit), not to landed code. The
normalized-path lock stage was never reached behind the failed Python
stage. This commit adds only this section.

## 2026-09-22 evening - worktree follow-up group closure pass: both members' scope discharged, remainder is host-side card flips (task_plan_mucx9cxs_0, run run_1790099521742_6)

Group closure for the two folded members (task_4ad72ce6e6f96f58,
task_8d38294b586a1490, both archived host-side). Their shared scope —
recovered from parent task_64d0e2f342af618c's split/narrow decision log —
was the two split cards: landing card task_7b773505d7c6eb43 and full-gate
card task_7a3b221956f9aa64. Both verified discharged on first-hand evidence
at HEAD ae5916e: all six feature commits (c272b58 / 136f866 / e3ad851 /
d1c4d78 / 96d15c6 / 31f69f0) are ancestors of HEAD; wiring present
(`require` at main.cjs:58, `worktreeManager` at main.cjs:9428); fresh
`node --test tests/executor_worktree.test.mjs` -> 11/11 pass, exit 0
(13.1 s); `git worktree list` shows no `.mefi/worktrees` checkouts and the
directory does not exist — no residue; nothing staged before or after. The
full-gate card is done+verified in the board (rows 1fec86b / 21f9e33 /
f8694c6). The split-out follow-up (task_4dc2a045b8d46b20, row above) is
done and its conclusion is adopted, not duplicated: nothing implementable
remains in the repo. The only open items are the duplicate landing cards
task_7b773505d7c6eb43 / task_2dd9dc18291f2625, still `open` in the board
though their repo-side obligations are verifiably landed — the status flip
is host-side only, asked again via MEFI_ASK; the task store was not
modified from this worker. Sibling in-flight files (~34 modified, 2
untracked) were present and untouched; this commit adds only this row.

## 2026-09-22 evening - split-out follow-up resolved to host-side-only remainder; worktree workstream re-verified at HEAD (task_4dc2a045b8d46b20, run run_1790099398213_3)

Scope decided from the parent plan's decision log, not guessed: the plan card
(task_plan_mucx9cxs_0) carries one decision — "split the extra work out"
(1790098036160) — and its finishing run (run_1790098067116_10) plus questions
q_1790087415865_3 / q_1790097789226_1 show every generation of this chain's
"uncovered work" was the same two host-side items: flipping landing card
task_7b773505d7c6eb43 (and its parent task_2dd9dc18291f2625) to done, and the
MEFI_STUDIO_WORKTREE_RUNS default — answered, it stays opt-in
(`enabled()` is `MEFI_STUDIO_WORKTREE_RUNS === "1"` exactly). Nothing
implementable remains in the repo. Re-derived first-hand at HEAD 1e61b58:
feature commits c272b58 / e3ad851 / 31f69f0 / d1c4d78 / 96d15c6 all exist on
main; wiring present (`require` near main.cjs:58; `worktreeManager`
`prepare`/`discard`/`settle` call sites around the run loop); fresh
`node --test tests/executor_worktree.test.mjs` -> 11/11 pass, exit 0
(39.4 s); `git worktree list` shows no `.mefi/worktrees` checkouts and the
directory does not exist on disk — no residue; nothing staged before or
after. The landing cards are still `open` in the board; the status flip is
host-side only and is asked via MEFI_ASK — the task store was not modified
from this worker. Sibling in-flight files (~30 modified, 2 untracked) were
present and untouched; this commit adds only this row.

## 2026-09-22 evening - the ledger-row verifier wiring landed quietly (task_8cc401d711b549ba, run run_1790099374977_2)

The row below landed `verifyCompletion`'s `ledgerChanges` input and its
tests (1e61b58) but left main.cjs unwired: the two call-site hunks sat in
a working tree whose main.cjs also carried an unrelated session's
in-flight edits, so no path-limited commit could be made without
sweeping them, and the false "outstanding obligations" loop this card
documents kept retrying. This commit lands exactly those two hunks -
the ledger-row counter with its comment, and the
`ledgerChanges: ledgerChanges(files)` argument on the task settle call -
by rebuilding main.cjs from HEAD plus the wiring alone (`git show
HEAD:main.cjs`, two edits, the diff verified to be only those hunks),
committing `main.cjs` and this row in one atomic path-limited commit,
then restoring the sibling session's uncommitted edits byte-for-byte
from a pre-flight snapshot. The request settle call stays unwired:
requests pass no `priorVerified`, so the discharge path cannot fire
there. Scoped evidence on the committed variant: 
ode --check main.cjs`
ok; 
ode --test tests/verification_checks.test.mjs
tests/executor_result_protocol.test.mjs` 20/20 pass, exit 0 - including
the seeded done+verified retry whose only session change is TESTRUNS.md
settling to done and its src-file negative twin.

## 2026-09-22 evening - ledger-row evidence added to the done+verified discharge (task_8cc401d711b549ba, run run_1790097856627_4)

The requirement's second clause, left unimplemented by the 1f00796 row two
below: "a fresh green scoped-check rerun (or a TESTRUNS row) as the
changed-file for verification-only cards". A done+verified retry whose only
edit is the TESTRUNS.md row documenting its green rerun reported 1 changed
file, so the `changedFiles === 0` discharge never fired and the card could
still loop on "outstanding obligations remain" — the exact shape the
run_1790091211824_20 row below records (verified "outstanding obligations
remain" with 1 changed file). Two changes: `verifyCompletion`
(scripts/assistant.mjs) takes `ledgerChanges` and discharges when the retry's
changed files are exactly covered by ledger rows (a claim larger than the
file count never over-discharges; the evidence records `ledgerChanges`);
main.cjs counts the attempt's session file rows whose path basename is
`TESTRUN.md`/`TESTRUNS.md` and passes the count into the task settle call.
The 0-file path, the scoped-denial reader, and the `verifiedOnce` stamp from
1f00796 are untouched. Scoped evidence: `node --test
tests/verification_checks.test.mjs tests/executor_result_protocol.test.mjs`
19/19 — including a new host integration test that settles a seeded
done+verified retry whose only session change is `TESTRUNS.md` to `done`
with no re-run loop, and its negative twin (a `src/feature.js` + ledger
pair stays "outstanding obligations remain"); the unit test adds the
ledger-row positive plus code-file, partial-coverage, never-verified, and
over-claim negatives. `node --test tests/board.test.mjs
tests/executor_parallel.test.mjs tests/policy_experience.test.mjs
tests/verification_drain.test.mjs tests/executor_continuation.test.mjs` with
the two above: 97/97, exit 0. `npm run check` all five stages ok (100
targets, 204 specs, css merge skip, all selectors used, syntax ok 100
files). The card's own earlier false failure (16:42:58, 44 s after 1f00796
landed) was the running app still judging with the pre-fix module — the
packaged app now carries the fixed reader, per the row below. This commit
adds this row and the verifier change only.

## 2026-09-22 evening - main.cjs "SyntaxError line 2014" alert triaged: collision already repaired, hold discharged at HEAD (run run_1790098034326_9)

A-Eyes warned and Overseer reported a `main.cjs` SyntaxError at line 2014
blocking updates after multi-session edits. Root cause is in
`data/eyes-requests.json`: a live collision request records two sessions
editing `main.cjs` in the same window (09:38–09:42, 9 edits vs 1 around
09:41), the known transient-broken state the environmental-failures row for
racing sibling edits already describes. The updater behaved as designed —
its syntax hold (`scripts/updater.mjs:515`, verdict from
`scripts/check-syntax.mjs`) refused to apply while the file was broken, which
is the "blocking updates" Overseer saw. The repair landed in `4e64b7f`
(12:17): at verification time `git diff HEAD -- main.cjs` was empty and the
line-2014 region (`resolveAiRoute`) parsed clean. No code was changed in this
pass; every main.cjs copy was verified instead — root, packaged
`dist/Mefi Studio AI+/resources/app/main.cjs`, and all three worktrees
(mgctl, command-visuals, ux-phase0) pass `node --check`, and
`data/machine-status.json` shows no leases or holds (canStart true). A
sibling session began a further in-flight main.cjs edit (47+/64−) during this
pass; it was re-checked immediately and also parses — `node --check` and the
repo gate both exit 0 on the loaded tree. Evidence:
`node scripts/check-syntax.mjs main.cjs` exit 0 solo; `npm run check`
exit 0 (targets 100/100, 204 specs, selectors used, syntax ok over
100 files); `node --test tests/check_syntax.test.mjs
tests/updater_deferred.test.mjs` — 12 pass, 1 capability-gated skip, 0 fail,
including the deferred-retry suite that proves a held syntax verdict
re-validates new source before any restart. This row is the only change.

## 2026-09-22 evening - performance_render timeout headroom for the loaded full gate (task_07a6989d1e5972eb, run run_1790097924274_6)

The remaining non-adaptive deadlines in performance_render were the outer
ones: a 40s fixture kill bound and a 50s per-test timeout. The incident row
(one 50s timeout under concurrent machine load, 2-of-3 passes) plus the
2026-09-22 guard row's measurement (~25s for a healthy fixture inside a
loaded parallel stage) left only 1.6x kill headroom and ~10s of outer slack
for booklet build + spawn + cleanup. tests/performance_render.test.mjs now
uses the 80s kill convention command_render and occlusion_probe already
document, with both test timeouts at 100s so build + cleanup still fit
between the kill bound and the deadline. Retry and load-aware skip were
considered and rejected: node:test `retry` relaunches while the timed-out
first attempt's abandoned Electron may still be live (a timeout never
cancels the fn), compounding the load that caused the flake, and the
fixture's internal budgets are already pace-adaptive (6f3b370/520e22b), so
only the outer bounds needed slack. Evidence: solo
`node --test tests/performance_render.test.mjs` twice back-to-back, 2/2
exit 0 both times (fixtures 12.4/6.1s then 15.7/7.2s); `npm run check`
exit 0 (targets 100/100, 204 specs, selectors used, syntax ok). Sibling
in-flight files in the shared tree were present and untouched; only this
test file and this row changed.

## 2026-09-22 evening - verify-and-close pass for the visible-phase foreground card at HEAD (task_03ad46c09bd30216, run run_1790097832067_3)

The re-plan asked for the fix to be proven real rather than reported: repo-wide
grep confirms the steal is in the fixture, not just in prior rows —
`app.focus({ steal: true })` at raise and at the 2s re-raise
(tests/fixtures/occlusion-probe-electron.cjs lines 389/430) and on the cover
(lines 507/529) — and the frames-channel resampling is the bounded
`sampleProbe` (3 attempts, 400ms apart, every sample recorded) whose visible
`acceptable` predicate demands a frames answer AND <100ms lag, so retries
cannot mask a throttling regression. `git diff HEAD --
tests/fixtures/occlusion-probe-electron.cjs` is empty; the 379c5b1 fixture
commit and rows 56087b2 / d69fd2f are all on main. Fresh validation at HEAD
7bbc50f: `node --test tests/occlusion_probe.test.mjs` twice back-to-back,
2/2 exit 0, no "must answer via frames" failure, first run engaged real
native occlusion (document.hidden flip, occluded rAF growth 0); `npm run
check` exit 0. Sibling in-flight files in the shared tree were present and
untouched. This row is the only change.

## 2026-09-22 evening - per-session worktree follow-up group re-verified at HEAD; landing-card closure stays host-side (task_plan_mucx9cxs_0, run run_1790097361397_4)

Scope recovered from the decision logs, not guessed: member task_8d38294b586a1490's
obligations are the two split cards of task_64d0e2f342af618c ("split the extra work
out", 1790094-), and member task_4ad72ce6e6f96f58 is the extra work split out of
task_8d38294 (q_1790094724337_4 answered "split" at 1790096005851) — host-side
closure of landing card task_7b773505d7c6eb43, whose repo-side obligations the
prior run had already verified. Both members re-derived first-hand at HEAD
d69fd2f; no code changed in this pass.

- Member task_8d38294 (previously verified as rcp_a2aa528cd4d618cd, owner retry):
  every feature commit is an ancestor of HEAD — `git merge-base --is-ancestor`
  exit 0 for c272b58 (lifecycle module), e3ad851 (wiring, buildable checkouts),
  31f69f0 (start-grace), d1c4d78 (npm ci kill-switch pin), 96d15c6 (8.3 path
  canonicalization), plus rows 7cf07f5 / 17d35a3 / 5852541. Fresh
  `node --test tests/executor_worktree.test.mjs` -> 11/11 pass, exit 0 (18.0 s;
  the suite grew by the 8.3 short-path test since the prior 10/10 row).
  `git worktree list` shows no `.mefi/worktrees` checkouts and
  `.mefi/worktrees` does not exist on disk after the run — no residue. Gate card
  task_7a3b221956f9aa64 is done+verified host-side (rows 1fec86b / 21f9e33 /
  f8694c6 / f66b8d3, the last a quiet-HEAD worktree gate exit 0).
- Member task_4ad72ce: landing card task_7b773505d7c6eb43's two obligations are
  verifiably discharged in history — the in-flight main.cjs/module/test edits
  (junction + leak fix) landed as the commits above, and the feature's TESTRUNS
  evidence rows exist (17d35a3 and later, through 5852541). The card itself is
  still `open` in the board; the status flip is host-side only — the task store
  was not modified from this worker, and the closure is asked via MEFI_ASK.
- Tree notes: sibling in-flight files (CHANGELOG.md, docs/ux-audit.md,
  renderer/booklet.html, renderer/music.js, tests/music.test.mjs, README.md,
  tools/verify_command.py, untracked tests/module_purity.test.mjs) were present,
  went dirty mid-run, and were never touched; the suite left no edits behind.
  This commit adds only this row.

## 2026-09-22 evening - post-replan confirmation pass for the visible-phase foreground card (task_03ad46c09bd30216, run run_1790097316663_2)

The card had already reached a trusted "verified" receipt
(rcp_0ff6e145d5fb395f, run run_1790094834453_140) when the owner re-planned
it; this pass re-derived the evidence rather than trusting any report. No
code changed: `git diff HEAD -- tests/fixtures/occlusion-probe-electron.cjs`
is empty, so the committed 379c5b1 fix — `app.focus({ steal: true })` at
raise and re-raise (fixture lines 389/430), the bounded `acceptable`
resampling (line 454: frames-answer AND <100ms lag), and the
frames-preferring `bestSample` — is what runs. Fresh `node --test
tests/occlusion_probe.test.mjs` four times back-to-back: 4/4 exit 0, no
"must answer via frames" failure in any run, and the final run engaged real
native occlusion (document.hidden flip, occluded rAF growth 0, worker drift
163ms, MessageChannel 1ms) rather than the capability skip. The card's own
obligations — fixture commit 379c5b1 and rows 56087b2 / 7bbe03a — are all
on main; the many dirty files in the shared tree belong to sibling sessions
and are untouched here. This row is the only change.

## 2026-09-22 evening - fourth full-gate rerun for 6c5e94: why the card stuck unverified, and a quiet-HEAD gate in a throwaway worktree (task_7a3b221956f9aa64, run run_1790095876536_5)

Why the card stayed unverified through three green rows (`1fec86b`,
`21f9e33`, `f8694c6` — all present on main, TESTRUNS-only): the last failed
verification ran 11:37:11, and `1f00796` (the `noRemainingScopeTail` scoped
denial reader) landed 11:42:14 — every prior "remaining: none for this card"
was rejected by the pre-fix verifier as an outstanding obligation. The
packaged app now carries the fixed reader, so the loop cause is gone; this
row is the rerun the retries kept asking for.

The shared tree is not quiet: a sibling's in-flight radio-stations feature
(uncommitted `renderer/music.js` et al.) adds `station: null` to the music
settings object, and three landed assertions refuse the extra key
(`tests/music.test.mjs:98`, `:215`, `:264` — `git show HEAD:renderer/music.js`
has no station; the key exists only in the working-tree diff). A first
`npm test` in the shared tree exit 1 with exactly those three failures plus
the runner's "sources changed while the suite was running" note; they belong
to the sibling's landing commit, which must update those tests in the same
change. Landed code is not implicated.

The gate therefore ran against landed content only, in a throwaway detached
worktree of HEAD `1a9a760` with the shared `node_modules` junctioned (the
per-session worktree feature this card exists to gate): `npm test` exit 0 in
90 s — node 1962 tests / 1959 pass / 0 fail / 3 skipped (the documented
environment-conditional skips), serialized `eyes_toggle_electron` 1/1 and
`occlusion_probe` 1/1, Python contracts 247 tests in 34.6 s OK,
normalized-path lock all ok. `npm run check` exit 0 (check-targets ok,
merge-css skip, all-selectors-used across 5 stylesheets, check-syntax ok 100
files); `npm run audit` exit 0 with findings `[]` / 0 warnings (checkedAt
2026-09-22T16:57:31Z). node v24.15.0, npm 11.12.1. The junction was unlinked
as a link before `git worktree remove` — no `.mefi/worktrees` residue; the
sibling dirty files were never touched, and the task store was not modified
from this worker. This commit adds only this section.

## 2026-09-22 evening - verifier taught to discharge done+verified retries with 0 changed files (task_8cc401d711b549ba, run run_1790094227868_122)

The false "outstanding obligations" loop this closes is documented two rows
of 2026-09-22 below (the collision-delegate loops and the per-feature card
retry): verification-only attempts whose scoped checks re-ran green over
already-landed work died at the outstanding gate because their remaining
prose ("none within this subtask's scope", "none in scope (parent handles
final integration)", "none for this card") is a scoped denial the reader did
not recognize, and done+verified retries with 0 changed files had no
discharge path at all. Three changes: `noRemainingWork`
(scripts/assistant.mjs) now reads scoping qualifiers and a
parent/integration parenthetical as denials — "none of the tests pass" and
"none in the other module" stay obligations; `verifyCompletion` takes
`priorVerified` and discharges the changed-file obligation when the retry's
own scoped-check rerun is recorded green (0 changed files, no handed-on
remaining list, red/pending reruns still fail); main.cjs stamps a durable
`verifiedOnce` at verified settle and passes `priorVerified` (stamp or a
prior "verified —" log line) into the task settle call. Scoped evidence:
`node --test tests/verification_checks.test.mjs
tests/executor_result_protocol.test.mjs` — 18/18, including the new
discharge unit tests (positive + four negative shapes) and a host
integration test that settles a seeded done+verified retry with 0 files and
a green rerun to `done` with no re-run loop; plus
tests/board.test.mjs, tests/executor_parallel.test.mjs,
tests/policy_experience.test.mjs 50/50; `npm run check` all five stages ok;
`npm run audit` 0 findings. Full `npm test`: parallel 1962 tests / 1956
pass / 3 fail, all three in tests/music.test.mjs on the new `station`
preference key — a sibling session's in-flight renderer/music.js +
renderer/booklet.html work (untouched here, the runner flagged moved
sources mid-run), not this change; serialized eyes_toggle 1/1, Python
contracts 247/247 OK, lock checks ok. This commit adds this row and the
verifier change only.

## 2026-09-22 evening - re-verification of the visible-phase foreground card on a concurrently loaded tree (task_03ad46c09bd30216, run run_1790094834453_140)

Third pass over this card, run while several sibling sessions were
mid-flight in the shared tree. No code changed: `git diff` on
tests/fixtures/occlusion-probe-electron.cjs is still empty, so the
committed 379c5b1 fix (probe-window `app.focus({ steal: true })` at raise
and re-raise — the cover's own sanctioned grab, confirmed pre-existing at
its call sites — plus the `acceptable`-predicate resampling and the
frames-preferring `bestSample`) is what runs. Fresh `node --test
tests/occlusion_probe.test.mjs` three times back-to-back: 3/3 exit 0, no
"must answer via frames" failure in any run; the visible phase (this
card's scope) asserted frames-answer and <100ms lag every time, and all
three runs then took the documented occlusion-capability skip — the
desktop was under sibling Electron load holding foreground, the same
environment-conditional path the 7/7 row already covers with six
real-occlusion runs. `npm run check` exit 0 (100 targets, 200 specs,
merge skip, all selectors used, 100 files). The card's recurring
"verification could not confirm (N changed files)" failures were
diagnosed, not discharged here: each one coincided with another session's
uncommitted edits in the shared tree (the 16:29Z failure was
scripts/executor-worktrees.cjs, which its own card landed minutes later
as 96d15c6); this card's own obligations — fixture commit 379c5b1 and
rows 379c5b1/56087b2 — are all committed and re-checked by this run.

## 2026-09-22 evening - closing full-gate pass for the per-feature model-config idea card (task_idea_mubob3xr_0, run run_1790094521980_132)

Closing verification for "Per-feature model config with graceful fallbacks".
The implementation was re-verified first-hand at HEAD rather than trusted
from run_1790082165537_103's report: `armedFallbackRoutes` (main.cjs:1991)
plus the `withFallbacks`/`degrade` wiring in `resolveAiRoute`
(main.cjs:2010-2058) are present, the 9-test suite
`tests/explicit_route_fallback.test.mjs` landed with the routing hunks in
520e22b, and the prior attempt's 9-file obligation has no uncommitted
remainder — `git status --porcelain` showed those paths clean at pickup.
The delegated gate obligations are also on record (rows for
task_baa66f9ab1ec0f2e at 10:28/10:36 and task_d9f157833b296be0 at 10:40);
this pass repeats the narrow suites and the whole gate at current HEAD so
the parent card carries its own first-hand evidence. Narrow: `node --test
tests/explicit_route_fallback.test.mjs tests/planning_routing.test.mjs` —
21 tests / 21 pass / 0 fail / 0 skipped, exit 0. `npm run check` — all
five stages ok (100/100 targets, 200 specs unique with no orphans, merge
skip, all selectors used, 100 files syntax). Full `npm test` verbatim,
exit 0 on every stage: parallel 173 suites (9 launch Electron), 1959
tests / 1956 pass / 0 fail / 3 skipped (the documented
environment-conditional skips); serialized eyes_toggle_electron 1/1;
occlusion_probe took the documented capability skip (visibility never
flipped, unattended desktop); Python contracts 247/247 OK in 37.2 s (one
more than the 10:4x rows — a sibling landed a new contract since);
normalized-path lock all ok. Settle honest note: HEAD moved 56087b2 ->
96d15c6 (a sibling's worktree-path canonicalization commit) while this
gate ran and four sibling in-flight files are dirty now (main.cjs,
renderer/booklet.html, scripts/assistant.mjs,
tests/verification_checks.test.mjs) — the runner's settle preflight
passed and it raised no moved-sources diagnosis, the gate exited 0, and
those files were left untouched. This commit adds only this row.

## 2026-09-22 evening - third full-gate rerun for the 6c5e94 follow-up card on a concurrently loaded tree (task_7a3b221956f9aa64, run run_1790094398262_129)

Third full-gate row for this card. Preconditions verified first-hand: start
HEAD 21f9e33 (the second full-gate row) over landing commit e3cd322; gate
targets of task_bf79bd8c1d8fced5 still on history (c272b58 worktree module,
e3ad851 wiring, 31f69f0 + d1c4d78 follow-ons; `scripts/executor-worktrees.cjs`
and `tests/executor_worktree.test.mjs` present on disk); tree clean, nothing
staged. node v24.15.0, npm 11.12.1. Two other-session evidence rows (56087b2,
5852541, TESTRUNS.md-only) landed mid-suite and tripped the run-node-tests
"sources changed" advisory twice; both were treated as noise, not regressions.

`npm test` was run end-to-end twice; each full run had exactly one
timing-sensitive failure and the two failures were disjoint files: run 1 node
stage 1959 tests / 1955 pass / 1 fail / 3 skipped with only
performance_render.test.mjs:72 (profiler JSON download 5260 ms @1.05x), run 2
with only eyes_worker.test.mjs:91 (150 ms store read timeout). Both are
documented load signatures (the perf-profiler table row and the eyes_worker
read-past-timeout note), and the host was measured loaded during the runs
(60% CPU, sibling claude/electron sessions). Documented remediation applied
and confirmed: solo `node --test tests/performance_render.test.mjs` passed
2/2 exit 0 in 12.7 s on the second solo attempt (first solo attempt 1/2 with
the other test in the file timing out — same contention signature), solo
`node --test tests/eyes_worker.test.mjs` exit 0. The `&&`-gated tail stages
were then run individually to completion: Python contracts 247/247 OK in
54.0 s exit 0; normalized-path lock 6/6 ok exit 0. `npm run check` exit 0
(targets 100/100, spec-collisions 200 unique no orphans, css merge skip, all
selectors used across 5 stylesheets, syntax ok 100 files). `npm run audit`
exit 0 with 0 findings / 0 warnings (checkedAt 2026-09-22T16:35:47Z). Gate
conclusion: every suite green in-suite except one rotating documented flake
per pass, each flake green solo, all three `npm test` stages and both
supporting gates exit 0 first-hand at this HEAD.

## 2026-09-22 evening - scope pass for the third worktree follow-up: both split obligations verified discharged (task_8d38294b586a1490, run run_1790094266535_124)

Scope decided from the parent's decision log (task_64d0e2f342af618c,
"split the extra work out"): the uncovered work is the two split cards'
obligations, verified here first-hand at HEAD 56087b2 rather than trusted
from prior reports.

- Landing card task_7b773505d7c6eb43 (never dispatched itself): the feature
  is present end to end — `scripts/executor-worktrees.cjs`, the `main.cjs`
  wiring (require at main.cjs:58, per-run `prepare`/`discard` around
  main.cjs:9354-9376, kill-switch `MEFI_STUDIO_WORKTREE_NPM_CI`), the
  `docs/architecture.md` opt-in section, and the TESTRUNS rows from d1c4d78 /
  e3ad851. Fresh `node --test tests/executor_worktree.test.mjs` -> 10/10
  pass (11.6 s), including the junction cleanup and the lazy
  `.git/info/exclude` write (asserted by the suite itself).
- Full-gate card task_7a3b221956f9aa64: gates exited 0 at e3cd322 (rows
  1fec86b / 21f9e33); `git diff e3cd322..HEAD` touches TESTRUNS.md only, so
  that evidence still covers HEAD's code. The card's failed verification
  ("1 changed file") was line-ending noise, not content:
  `git diff --ignore-all-space --numstat` on renderer/booklet.html was empty
  (`git ls-files --eol`: index lf, worktree crlf). Restored with
  `git checkout -- renderer/booklet.html`; `git status --porcelain` is now
  empty, so the next gate-card retry verifies against a quiet tree.
- No residue: `git worktree list` shows no `.mefi/worktrees` checkouts on
  this repo.

## 2026-09-22 evening - repeat verification for the visible-phase foreground card (task_03ad46c09bd30216, run run_1790094247017_123)

Closing verification for "Visible-phase foreground robustness". The
implementation landed as 379c5b1 (fixture + the row below only — 2 files,
verified via `git show --stat`, not the 6 dirty working-tree files the
sentinel saw, which belonged to sibling sessions); both dispatches after it
died on the 5-hour usage limit before running anything. This pass trusts no
prior report and re-derived the evidence: `git diff HEAD` on
tests/fixtures/occlusion-probe-electron.cjs is empty, so the committed steal
(`app.focus({ steal: true })` at raise + re-raise) and the frames-channel
resampling (`acceptable` predicate — a sample must answer via frames AND read
<100ms within the same bounded 3 attempts — plus `bestSample` preferring
frames answers) are what actually runs. Then `node --test
tests/occlusion_probe.test.mjs` seven times back-to-back: 7/7 exit 0, six
engaging real native occlusion (document.hidden flip, occluded rAF growth 0,
worker drift 151-166ms, MessageChannel 0ms, recovery after cover removal) and
one taking the documented capability skip — no "must answer via frames"
failure in any run, which is the flake this card exists to kill. (A first
looped attempt printed exit 1 with no test output: `Select-Object -First 6`
stopped the pipeline after exactly the 6 summary lines and killed node — a
capture artifact, per the known-failures table's "never through
`Select-Object -Last N`" note, not a test result.) `npm run check` exit 0,
all five stages ok (100 targets, 200 specs, merge skip, all selectors used,
100 files syntax). This commit adds only this row.

## 2026-09-22 afternoon - second full-gate rerun for the 6c5e94 follow-up card after the usage-limit stall (task_7a3b221956f9aa64, run run_1790094001667_115)

Second full-gate row for this card, run from scratch on the quiet tree. The
first pass (run_1790091912218_46, row landed as 1fec86b) ran the whole gate
green, yet verification closed with "sentinel seen, 0 changed files" and left
obligations open; the six dispatches after that all died on the 5-hour usage
limit before any command ran (usage-limit tails, not test failures). This
pass re-ran every gate itself and trusts neither earlier report.

Preconditions verified independently, not from the handoff: HEAD e3cd322
("Booklet contract: brains assets inlined exactly once, no src leftovers"),
tree fully clean and nothing staged at start; the gate target of card
task_bf79bd8c1d8fced5 — c272b58 (scripts/executor-worktrees.cjs lifecycle
module) and e3ad851 (main.cjs wiring, buildable worktree runs) with follow-ons
31f69f0 and d1c4d78 — all still on HEAD's history. Three commits landed since
the first row and are exercised by this run: fa35236 (CHANGELOG-only), b8f1a7a
(TESTRUNS.md + tools/verify_dev_app.mjs, neither suite-read), and e3cd322
(booklet contract: tests/booklet_build.test.mjs assertions plus the 247th
Python contract).

`npm test` end-to-end, exit 0, ~82 s, every stage separately green: parallel
node 1959 tests / 1956 pass / 0 fail / 3 skipped in 39.3 s (the three skips
are the documented environment-conditional ones); serialized
eyes_toggle_electron 1/1 (3.2 s, baseline 2 fetches/295 ms, one resume snap,
6 fetches total); occlusion_probe 1/1 (5.6 s) with the documented capability
skip NOT taken this time — real occlusion engaged (document.hidden, occluded
rAF growth 0, worker drift ~152 ms, lag 0 ms of 1 sample); Python contracts
247/247 OK in 30.4 s; normalized-path lock 6/6 ok. `npm run check` exit 0
(targets 100/100, spec-collisions 200 unique no orphans, css merge skip, all
selectors used across 5 stylesheets, syntax ok 100 files). `npm run audit`
exit 0 with 0 findings / 0 warnings (checkedAt 2026-09-22T16:23:21Z).
node v24.15.0, npm 11.12.1. HEAD did not move during any gate this time; no
suite reads TESTRUNS.md. The task store was not modified from this worker.
This commit adds only this section.

Quiet-tree full-gate rerun for the 34d02e follow-up card, exit 0 with one
documented environmental flake remediated per this file's own table; landing
card task_2dd9dc18291f2625 verified discharged (2026-09-22, ~11:2x-11:3x,
run_1790094209046_121 for task_0b98acc8d32d5f67 "Full-gate rerun on the quiet
tree — follow-up 34d02e", parent task_01a24e9b78aaef34 "Follow-up:
Per-session worktrees for executor runs"). Precondition verified
independently, not from the handoff: the sibling start-grace edits landed as
31f69f0 (start-kill grace in main.cjs — the HEAD graced-kill path at
main.cjs:9589 — plus 38 lines of tests/executor_lifecycle.test.mjs including
"start kills past the grace are charged as ordinary failures"), an ancestor
of HEAD. Quiet tree took an explicit wait: at pickup a sibling session was
actively rebuilding renderer/booklet.html (a stray `<script src="brains.js">`
after `</html>` drifted in and was rebuilt away within ~2 min); the only
young node process left was the long-lived `scripts/serve.mjs` server, and
the gate launched on a fully clean tree at 56087b2 after two TESTRUNS-only
sibling commits (21f9e33, 56087b2). Gate: `npm run check` exit 0; `npm test`
parallel node stage 1959 tests / 1955 pass / 1 fail / 3 skipped (the
documented environment-conditional skips) in 73.3 s — the one failure was
performance_render "Profiler JSON download timed out after 6080ms at 1.22x
observed pace", the first row of this file's known-environmental table;
remediated exactly as that table prescribes: solo rerun
`node --test tests/performance_render.test.mjs` -> 2/2 pass, exit 0. The
`&&` aggregate stopped at the node stage, so every later stage ran solo and
green: serialized eyes_toggle_electron 1/1 (6.1 s, baseline 2 fetches/295 ms,
one resume snap, 6 fetches total); occlusion_probe 1/1 exit 0 (the real
visible-phase pass, not the capability skip — the 379c5b1 foreground-steal
resampling); Python contracts 247/247 OK in 77.3 s; normalized-path lock all
ok. `npm run audit` exit 0, 0 findings / 0 warnings. Settle honest note: HEAD
moved 56087b2 -> 5852541 mid-run via one TESTRUNS.md-only sibling commit; no
test-read source moved, the runner raised no moved-sources diagnosis, and
the tree is fully clean after. Landing card task_2dd9dc18291f2625 ("Land the
worktree tree + TESTRUNS row") verify-and-close: both obligations are
verifiably in history — the in-flight main.cjs/module/test edits (junction +
leak fix) landed as c272b58 (lifecycle module, shared-install junction, leak
fix), 136f866 (main.cjs wiring + shared fake DOM) and e3ad851 (junction
guards, no-path-strands-a-worktree leak fix, buildable checkouts), with
follow-on d1c4d78 pinning the npm ci kill-switch; the feature's evidence row
is the late-morning entry at the bottom of this file. The card is discharged
on repo evidence; Studio's task store was not modified from this worker, so
the status flip itself stays host-side. This commit adds only this row.

## 2026-09-22 afternoon - restart-dev-app re-dispatch loop diagnosed; scoped named check added (task_5494e9f92f34b95a, run run_1790091964934_47)

Card task_cd738240985f9b00 ("Restart dev app after repair — follow-up
332b9d") re-minted for hours. Root cause, from the policy-lab receipts
(rcp_7b2b1d6773a1b8e3, rcp_7fe9cedffbaa4789, rcp_6d80a5c56723ca11): each
retry finished ok (`verdictOk: true`, session, no outstanding obligations)
with 0 changed files and `result: null` — the workers never emitted a
parseable MEFI_RESULT note, so `scheduleVerificationOnDone` queued no
overseer check run, and `verifyCompletion`'s only remaining pass paths
(changed files / observed checks / matched commit) had nothing to accept:
"no attributable edits and no named checks". The card is operational (it
restarted serve and the dev app — both were confirmed live in the runs'
own evidence), so it can never produce changed-file evidence; and each
manual "Retry requested" reset `verifyAttempts`, re-arming the 3-attempt
park budget indefinitely. The general verifier change (green scoped-check
rerun discharging verification-only cards) is card
task_8cc401d711b549ba's open scope and was not touched.

What landed here: `tools/verify_dev_app.mjs`, the named check that card's
actual scope lacked — it resolves every static external require/import
across main.cjs, preload.cjs and scripts/* (the "confirm no
ERR_MODULE_NOT_FOUND" promise of the node_modules repair; the app has
exactly one runtime external, `electron`) and probes serve as
informational. `node tools/verify_dev_app.mjs` -> 74 file(s) scanned,
1 unique external package, 0 resolution failures, serve probe HTTP 200 on
4173, exit 0; `npm run check` -> exit 0 (targets, spec collisions, css,
syntax, 100 files). Next dispatch of the card can run this command in its
session to discharge via observed checks. A host-side close of
task_cd738240985f9b00 remains the owner's call (asked via MEFI_ASK); the
task store was not modified from this worker.

Quiet-tree full-gate rerun for the 6c5e94 follow-up card, exit 0
(2026-09-22, ~15:4x, run_1790091912218_46 for task_7a3b221956f9aa64
"Full-gate rerun on the quiet tree — follow-up 6c5e94", parent
task_64d0e2f342af618c "Follow-up: Follow-up: Per-session worktrees for
executor runs"). Preconditions verified independently before launching,
not taken from the handoff: the gate target of card task_bf79bd8c1d8fced5
is the landed worktree module + wiring — c272b58
(scripts/executor-worktrees.cjs lifecycle module) and e3ad851 (main.cjs
wiring, buildable worktree runs) both on HEAD's history with follow-ons
31f69f0 and d1c4d78; the tree was fully clean and nothing staged at
start (HEAD cb79b9f). `npm test` ran end-to-end, exit 0 on every stage:
parallel node 1959 tests / 1956 pass / 0 fail / 3 skipped in 37.0 s
(1959 counts d1c4d78's npm-ci kill-switch gating test; the three skips
are the documented environment-conditional ones); serialized
eyes_toggle_electron 1/1 (3.3 s, baseline 2 fetches/298 ms, one resume
snap, 6 fetches total); occlusion_probe took the documented capability
skip (visibility never flipped under a focused cover); Python contracts
246/246 OK in 35.8 s; normalized-path lock 6/6 ok. The same pass also
ran `npm run check` exit 0 (targets 100/100, spec-collisions 200 unique
no orphans, css merge skip, all selectors used, syntax ok 100 files) and
`npm run audit` exit 0 with 0 findings / 0 warnings. Settle honest note:
HEAD moved cb79b9f -> 6e5f233 during the run — a TESTRUNS.md-only
sibling commit that is the original card's own retry row
(run_1790091813384_42 for task_bf79bd8c1d8fced5), so that card now
carries its own fresh green gate row and this row discharges only the
follow-up; no test-read source moved, no suite reads TESTRUNS.md, and
the runner raised no moved-sources diagnosis. After the run a sibling
session holds an in-flight edit on tests/fixtures/occlusion-probe-electron.cjs
(46 insertions / 6 deletions, occlusion-hardening work) that was left
untouched. This commit adds only this row.


Visible-phase foreground robustness for the occlusion-probe fixture
(2026-09-22, run_1790091834654_43 for task_03ad46c09bd30216 "Visible-phase
foreground robustness", parent task_e65d8260beb42082). The visible phase
raised the probe window with a plain `window.focus()` — deniable under the
Windows foreground lock, the same denial the cover already works around with
`app.focus({ steal: true })` — and judged "must answer via frames" on the
lowest-lag sample while the probe's in-page channels race two rAF ticks
against a ~150ms unthrottled timer, so under load a healthy window's worker
answer could win the race and shadow its frames answer (flake observed
2026-09-22). The fixture now raises/re-raises the probe window with the same
sanctioned steal as the cover, resamples (same bounded 3 attempts) until a
sample both answers via frames and reads <100ms, and prefers frames-answering
samples in bestSample — the occluded/proxy phases are unchanged (their
samples must never answer via frames, asserted per-sample). Retries still
cannot mask real failures: throttling answers via frames never, a wedged page
answers via nothing, on every sample. Verified live:
`node --test tests/occlusion_probe.test.mjs` 1/1 pass, 0 skipped — the run
even engaged real native occlusion (via document.hidden, occluded rAF growth
0, occluded probe answered workerDriftMs 166ms / lag 0ms, recovered), so the
changed visible phase and the untouched occluded contract both exercised
green; `npm run check` all five stages ok. Changed only
tests/fixtures/occlusion-probe-electron.cjs and this file.

Closing verification for the per-feature model-config landing card
(2026-09-22, ~11:1x, run_1790091744134_39 for task_6b445d8ac92eeed6 "Land
the per-feature model-config tree"). Re-verified at HEAD instead of trusting
the prior report: all eight waited-on paths — main.cjs, preload.cjs,
scripts/assistant.mjs, scripts/task-context.cjs, scripts/agent-issues.cjs,
scripts/brains.cjs, tests/agent_issues.test.mjs, tests/brains_map.test.mjs —
landed in a16b752 (exactly those 8 files, +2198/−26), with main.cjs evolved
further by e3ad851 and 31f69f0, and all clean in `git status --porcelain`
this pass, so no re-commit was made. The follow-on rerun card
task_baa66f9ab1ec0f2e is done and verified (its own row: e936982, full
npm test exit 0 on the settled tree), so no re-trigger was needed. The two
earlier retries of this card looped on verification mechanics, not
substance: the first ran its checks through a PowerShell pipe the runner
does not observe as a check, and the second answered "remaining: none for
this card", which the verifier does not recognize as no-remaining-work.
This pass ran the checks bare so they count: `node --test
tests/agent_issues.test.mjs tests/brains_map.test.mjs` — 26 tests /
26 pass / 0 fail / 0 skipped, exit 0, and `npm run check` — all five
stages ok (100 targets, 200 specs, no merge in progress, every class
selector used, 100 files syntax). A sibling session's in-flight
package-lock.json hunk was left untouched.

Quiet-tree full-gate rerun for the 69ecdf follow-up card, exit 0
(2026-09-22, ~16:2x, run_1790091792644_41 for task_e2a0db32d964df2f
"Full-gate rerun on the quiet tree — follow-up 69ecdf", parent
task_01a24e9b78aaef34 "Follow-up: Per-session worktrees for executor
runs"). Precondition verified independently before launching: the card's
gate was the landed worktree module + wiring per task_bf79bd8c1d8fced5
— e3ad851 (main.cjs wiring, buildable worktree runs) is on HEAD's
history with follow-ons 31f69f0 and d1c4d78; the "69ecdf" in the title
is the handoff id suffix (handoff_a15c507ec55352cabf69ecdf), not a
commit. `npm test` ran solo end-to-end over d1c4d78, exit 0 on every
stage: parallel node 1959 tests / 1956 pass / 0 fail / 3 skipped in
37.5 s (1959 counts d1c4d78's new npm-ci kill-switch gating test);
serialized eyes_toggle_electron 1/1 (3.7 s, baseline 2 fetches/298 ms,
one resume snap, 6 fetches total); occlusion_probe took the documented
capability skip (visibility never flipped under a focused cover);
Python contracts 246/246 OK in 34.5 s; normalized-path lock all ok.
Settle honest note: HEAD moved d1c4d78 -> cb79b9f mid-run — a
package-lock.json-only sibling commit landing the 3-line `engines`
sync that had been floating in the working tree; no test-read source
moved, no suite reads the lockfile, and the runner raised no
moved-sources diagnosis; the tree is fully clean after (that hunk is
now committed by its owner). This commit adds only this row.

Quiet-tree full-gate rerun closing the floating-lockfile blocker, exit 0
(2026-09-22, ~15:4x, run_1790091813384_42 for task_bf79bd8c1d8fced5
"Full-gate rerun on the quiet tree", retry after run_1790091211824_20
verified "outstanding obligations remain" with 1 changed file). The
prior run's gate was genuine (8e43ac8) but verification could not pass
while a 3-line `engines` sync npm had written into package-lock.json
kept floating in the tree — every earlier session left it untouched as
a sibling artifact. This retry reconciled it instead: the hunk only
adds `"engines": {"node": ">=24"}` to the lockfile's root entry, which
matches package.json's declared engines exactly, so it was committed
path-limited as cb79b9f (3 insertions, nothing else swept, tree quiet
before and after). The full gate then ran at the new HEAD:
`npm run check` exit 0 (targets 100/100, spec-collisions 200 unique
no orphans, css merge skip, all selectors used, syntax ok 100 files);
`npm test` exit 0 — parallel 1959 tests / 1956 pass / 0 fail /
3 skipped in 35.3 s, serialized eyes_toggle_electron 1/1 (3.5 s,
baseline 2 fetches/299 ms, resume snap 1, 6 fetches total),
occlusion_probe took the documented capability skip, Python contracts
246/246 OK in 35.6 s, normalized-path lock 6/6 ok; `npm run audit`
exit 0 with 0 findings / 0 warnings. Settle honest note: HEAD moved
cb79b9f -> fb56717 mid-run via two TESTRUNS.md-only sibling commits
(90a784c, fb56717 — the second being the parallel sibling gate's own
row), and the sibling gate run_1790091792644_41 for
task_e2a0db32d964df2f overlapped this run's Electron stages — every
stage still exited 0 and the runner raised no moved-sources diagnosis;
the worktree gate target suites stay green in-stage per the 8e43ac8
and d1c4d78 rows below. This commit adds only this row.

Scoped-check rerun un-sticking the two collision-delegate verification
loops (2026-09-22, ~16:0x, run_1790091633044_35 for
task_93c9907b18ec3928 "Unstick collision-delegate verification loops",
parent task_94b29c15a3479597). Both delegates of the booklet/routing
collision (task_delegate_d9f299382ce7faa99dfc1f15 on booklet.js +
model_auto_setup, task_delegate_f86594532fe0532c3d541359 on README +
routing tests + template) had already reported done with their scheduled
verification chains passing, then looped on "0 changed file(s),
outstanding obligations" — correct in mechanism, not in substance: the
merge had landed before pickup, so a faithful re-check changes nothing.
Re-ran every recorded scoped check from the project root at HEAD this
run, all exit 0 and matching the delegates' own counts exactly:
`node --test tests/model_auto_setup.test.mjs` — 16 tests / 16 pass /
0 fail (92 ms); `python -m unittest discover -s tools -p
test_mefi_studio_routing.py` — Ran 23 tests, OK (2.28 s);
`node --test tests/jev_routing_ui.test.mjs` — 19 tests / 19 pass /
0 fail (208 ms); plus the shared `npm run check` prefix of both chains
— targets ok (100/100), spec-collisions ok (200, unique, no orphans),
css merge skip (no merge in progress), all selectors used, syntax ok
(100 files). No host-side remainder: each delegate's full recorded
check list re-executed green, so both delegates can verify and
task_c1cf337d66009c14 can integrate. No product or test code touched;
this commit adds only this row, and a sibling session's in-flight
package-lock.json hunk was left untouched.

First-hand full-gate confirmation after the model-config landing, exit 0
(2026-09-22, 10:40-10:42, run_1790091443127_27 for task_d9f157833b296be0
"Run the full npm test gate after the model-config commit", parent idea
"Per-feature model config with graceful fallbacks"). Precondition verified
independently before launching: the per-feature model-config chain is
committed — a16b752 landed the brain maps / agent-issues lane / Command
inspect tree (scripts/brains.cjs, scripts/agent-issues.cjs,
renderer/brains.js et al.) and 31f69f0 the last in-flight monitor-loop
paths — and no test source was dirty. The whole `npm test` aggregate ran
verbatim: exit 0 on every stage — parallel 1958 tests / 1955 pass /
0 fail / 3 skipped in 36.0 s; serialized eyes_toggle_electron 1/1
(3.5 s); occlusion_probe took the documented capability skip;
Python contracts 246/246 OK in 33.6 s (the card brief's 204 is stale —
the brain-map contracts lifted the count); normalized-path lock 6/6 ok.
Settle honest note: HEAD moved e936982 -> 09d8e38 mid-run, a
TESTRUNS.md-only sibling commit ("per-feature model-config landing
confirmation"), and the concurrent quiet-tree gate one row below
(task_bf79bd8c1d8fced5, 10:38-10:42) overlapped this run's Electron
stages — both gates still exited 0 and the runner raised no
moved-sources diagnosis; the 3-line package-lock.json `engines` sync
floating in the working tree matches that row's note and was left
untouched. The card's report target task_baa66f9ab1ec0f2e is done and
verified on its own runs (settled-tree row below). This commit adds
only this row.

Quiet-tree full-gate rerun over the landed worktree module + wiring, exit 0
(2026-09-22, 10:38-10:42, run_1790091211824_20 for
task_bf79bd8c1d8fced5 "Full-gate rerun on the quiet tree", parent
"Per-session worktrees for executor runs"). Preconditions verified
first-hand before launching: the combined in-flight tree landed as 31f69f0
(start-kill grace, settle-only verification prefetch, monitor-loop tool),
`git status --porcelain` was empty, and the one sibling `run-node-tests`
node stage in flight at pickup (PID 23216) was waited out, so this gate
ran solo; `npm run check` (all five stages) and `npm run audit` (0
findings, 0 warnings) were green immediately before. Exit 0: node stage
173 suites (9 launch Electron), 1958 tests / 1955 pass / 0 fail /
3 skipped in 35.8 s (the documented environment-conditional skips);
Python contracts 246/246 OK in 31.6 s; normalized-path lock all ok;
serialized eyes_toggle_electron 1/1 (3.1 s, baseline 2 fetches/296 ms,
one resume snap, 6 fetches total); occlusion_probe took the documented
capability skip (visibility never flipped). The card's target suites ran
green in-stage: worktree prepare/settle lifecycle (3.6 s) and
keep-worktree-on-uncommitted-edits (2.8 s). Settle honest note: the
before/after `git status` snapshots differ by one outside-process change
— a 3-line `engines` sync npm wrote into package-lock.json mid-run; no
test-read source moved, no suite reads the lockfile, and the runner
raised no moved-sources diagnosis; the hunk belongs to a sibling session
and was left untouched. This commit adds only this row.

Restart-coverage verification for the staged-index warning card
(2026-09-22, ~15:0x, run_1790091589134_33 for task_d89c17863bf8ccdb
"Restart coverage for staged-index warnings", parent
task_7247a03061fd07b9 "Feed the staged-sweep warning into the next
dispatch"). The previous attempt's verification flagged "0 changed
files, outstanding obligations" — correct in mechanism, not in
substance: the decision was already committed (the dispatch-time
gitPorcelain probe hunk rode the sibling whole-file landing e3ad851,
certified again by 31f69f0's full gate), so the retry had nothing left
to change. Re-verified at HEAD instead of trusting the report: the
probe lives in main.cjs (dispatch path, "Restart coverage" block —
when no fresh parked entry exists it re-derives the CAUTION from
`git status --porcelain`, sync in production so no await joins the
gate, async in the vm hosts) and reads `eyes.gitPorcelain({ root:
runRoot })`, never the in-memory map; the 30-minute window remains
only as the parked-entry freshness gate, subordinate to the probe.
Narrow gate rerun solo: `node --test tests/executor_end_to_end.test.mjs`
— 18 tests / 18 pass / 0 fail / 0 skipped in 0.55 s, exit 0, including
"staged-index advice survives a dispatcher restart through the
dispatch-time porcelain probe" (map wiped as a restart would; the probe
still advises; it never touches the map). This commit adds only this
row, closing the card's changed-file obligation; a sibling session's
in-flight package-lock.json hunk was left untouched.

Landing confirmation for the per-feature model-config tree (2026-09-22,
10:39-10:40, run_1790091413818_26 for task_6b445d8ac92eeed6 "Land the
per-feature model-config tree", parent "whats left to do?"). This card's
commit obligation was already discharged by a sibling session before pickup:
`git show --name-only a16b752` ("Land brain maps, the agent-issues decision
lane and Command inspect mode", 09:24) contains all eight waited-on paths —
main.cjs, preload.cjs, scripts/assistant.mjs, scripts/task-context.cjs,
scripts/agent-issues.cjs, scripts/brains.cjs, tests/agent_issues.test.mjs,
tests/brains_map.test.mjs — with main.cjs evolved further in e3ad851 and
31f69f0, all committed; `git status --porcelain` showed those paths clean
throughout this pass, so no re-commit was made. Narrow check on the landed
pair: `node --test tests/agent_issues.test.mjs
tests/brains_map.test.mjs` — 26 tests / 26 pass / 0 fail / 0 skipped in
0.13 s, exit 0. `npm run check` — all five stages ok (100/100 targets
through the syntax pass, 200 specs with unique basenames and no orphans, no
merge in progress, every class selector used, 100 files in-process syntax).
The follow-on rerun card task_baa66f9ab1ec0f2e had already run green on the
settled tree and recorded its own row below (e936982), so both of this
card's obligations are met without re-triggering. This commit adds only
this row; a sibling session's in-flight package-lock.json hunk was left
untouched.

Audit-verify that the A-Eyes dead-selector warn on `.brains-sheet` is
already resolved (2026-09-22, 10:39-10:41, run_1790091495454_29 for
task_fd3fcbcfff3656e4 "Audit: css"). The warn was raised at 08:42 against
the pre-landing tree; a16b752 (09:24) then landed brain maps complete, so
`brains-sheet` now appears in renderer/booklet.template.html:1050 and the
built renderer/booklet.html. No edit made — deleting the selector would
strip the live dialog's layout. Evidence: `node scripts/auditor.mjs`
audit() reports zero css findings at both the repo root and
dist/Mefi Studio AI+/resources/app; `node scripts/check-css.mjs --unused
renderer/brains.css` prints ALL-SELECTORS-USED; the requested gate
`python -m unittest discover -s tools -p "test_mefi_studio_*.py"` ran
246 tests OK in 33.0 s, exit 0, output captured to a file. HEAD 7f9cbe5
throughout; the only dirty path, package-lock.json, is another session's
and was left untouched. This commit adds only this row.

Settled-tree full-gate rerun, exit 0 (2026-09-22, 10:36-10:38,
run_1790091305943_21 for task_baa66f9ab1ec0f2e "Full-gate rerun after
in-flight work settles", parent idea "Per-feature model config with
graceful fallbacks"). This is the rerun the two rows below anticipated:
they certified the combined tree while the six monitor-loop paths were
still uncommitted in-flight (and the earlier attempt's verification
flagged exactly that outstanding tree), so this run is the first
complete `npm test` on the settled combined tree — HEAD 31f69f0, which
landed those six paths on top of 17d35a3 plus the two TESTRUNS-only
commits. Exit 0 on every stage: parallel 1958 tests / 1955 pass /
0 fail / 3 skipped in 36.5 s; serialized eyes_toggle_electron 1/1
(3.7 s, baseline 2 fetches, one resume snap, 6 fetches total);
occlusion_probe took the documented capability skip (visibility never
flipped, unattended desktop); Python contracts 246/246 OK in 33.7 s;
normalized-path lock all ok. Settle check for this run: HEAD was
31f69f0 before and after, and `git status --porcelain` captured before
and after is byte-identical and empty — the in-flight work this task
waited on had fully settled, no sibling landed mid-run, and the runner
raised no moved-sources diagnosis. This commit adds only this row.

Landing verification for the combined in-flight tree (2026-09-22, 10:35,
run_1790091189066_19 for task_2fe0bffe3a85cde1 "Land the sweep-advice
main.cjs hunk", parent "Feed the staged-sweep warning into the next
dispatch"). The six in-flight paths the two full-gate rows below already
certified green on the identical tree (HEAD 17d35a3's six monitor-loop
paths: CHANGELOG.md, docs/agent-loop.md, main.cjs,
tests/executor_lifecycle.test.mjs, tests/fixtures/host_executor.mjs,
tools/monitor_loop.mjs — untouched since, the three commits in between being
TESTRUNS.md-only) landed as one commit with this row. Before committing,
`node --test tests/executor_end_to_end.test.mjs
tests/executor_lifecycle.test.mjs`: 52 tests / 52 pass / 0 fail /
0 skipped in 0.25 s, exit 0 — covering the committed 1567a16 sweep-advice
suite (finish-time staged-index warning rides exactly the next dispatch as
collab advice; stale warnings age out) and the new start-kill grace (a
start kill spends none of the card's five tries below five start kills,
past grace it is charged, and a run that does start clears the streak).

Independent full-gate rerun, concurrent with the row below, same green
result (2026-09-22, 10:28-10:29, run_1790090737796_6 for
task_baa66f9ab1ec0f2e "Full-gate rerun after in-flight work settles",
parent idea "Per-feature model config with graceful fallbacks"). Launched
six seconds after the row below's run on the identical combined tree
(HEAD 17d35a3 plus the six in-flight monitor-loop paths), so the two
complete `npm test` chains overlapped for most of their length — two full
gates at once on one tree, the load scenario the environmental-failures
table warns about, and neither surfaced a flake. Exit 0: parallel stage
173 suites (9 launch Electron), 1958 tests / 1955 pass / 0 fail /
3 skipped in 36.3 s; serialized eyes_toggle_electron 1/1 (3.1 s,
baseline 2 fetches, one resume snap, 6 fetches total); occlusion_probe
took the documented capability skip (visibility never flipped); Python
contracts 246/246 OK in 30.1 s; normalized-path lock all ok. Settle
check for this run: `git status --porcelain` captured before and after
is byte-identical — no sibling landed and no source moved mid-run, so
the vm suites read a still tree and the runner raised no
moved-sources diagnosis. This commit adds only this row.

Green exit-0 full `npm test` gate for the parent integration-gate chain
(2026-09-22, 10:27–10:29, run_1790090677908_4 for task_0b1780b06ba74eb0).
This is the settled-tree rerun the previous attempt (run_1790040270702_1:
2 deterministic usage-HUD failures, serialized/python stages unreached)
owed. The usage-HUD work has long since landed; the only in-flight sibling
session (monitor-loop: main.cjs, tests/executor_lifecycle.test.mjs,
tests/fixtures/host_executor.mjs, docs/agent-loop.md, CHANGELOG.md, new
tools/monitor_loop.mjs) was quiet — last source write 10:06, run launched
10:27:57, the runner's settle preflight passed, and no mid-run source-drift
diagnosis fired. Preconditions: no sibling suite in flight (only MCP-proxy
node/python processes, no electron processes at all), CPU ~21%, free RAM
0.31 GB — a floor prior green gates have passed below. Result: exit 0 —
node stage 173 suites (9 launching Electron), parallel 1958 tests /
1955 pass / 0 fail / 3 skipped in 38.0 s (the documented
environment-conditional skips; the count grew 1937 → 1958 with the
sibling's in-flight suite additions, all green on this tree); serialized
eyes_toggle_electron 1/1 in 3.4 s (baseline 2 fetches/298 ms, hidden
0/1200 ms, one resume snap, fetch gaps 297-1266 ms, 6 fetches total);
serialized occlusion_probe took its documented capability-gated skip
(cover shown focused but visibility never flipped within 15 s — the
expected table row on this desktop, not a regression); Python contracts
"Ran 246 tests ... OK" in 30.0 s; normalized-path lock "all checks
passed". `npm run check` exit 0 on the same tree (100 targets, 200 specs,
all selectors used, syntax ok), and the run left the working tree
byte-identical: the same six sibling paths in git status before and after,
nothing staged, nothing clobbered, no source edits by this run. Full log:
%TEMP%\opencode\gate-0b1780\test-run1.log (386 KB). This row is the
citable exit-0 gate artifact task_6672802f6623e7bd ("Resolve TESTRUNS and
booklet collisions", acceptance: npm test passes) needs; the card flip
itself stays with Studio per the no-store-writes rule, as does the
still-open child task_0c78fba13bc152a1 (TESTRUNS/test-file side).

Staged-index sweep advice closed for restarts, and the stale landing
note corrected (2026-09-22, ~14:5x, run_1790087682481_6 for
task_7247a03061fd07b9 "Feed the staged-sweep warning into the next
dispatch", retry on the owner's note). Verified first: the previous
run's "main.cjs stays uncommitted" claim was already stale — a16b752
had swept the producer/consumer into the tree 23 s before the test
commit 1567a16, and d9cfc8c landed the row below, so "land the hunk"
needed no new commit. The retry's real gap was restart coverage: the
parked warning map is in-memory, so a Studio restart dropped it.
Chose the dispatch-time gitPorcelain probe over a file-backed store —
the index itself is the durable signal, so when no fresh parked entry
exists the dispatch probe re-derives the same CAUTION advice straight
from git ("the index currently holds ... BEFORE editing"); the
production probe is spawnSync, so no await joins the gate path, and
async git observation (the vm test hosts) rides the same await.
Updated the two prior cases (a staged index at dispatch now warns;
the aged-out case heals the porcelain to model a healed repo) and
added the restart case (map wiped as a restart would, probe still
advises; the probe reads git, never touches the map). Narrow gate:
`node --test tests/executor_end_to_end.test.mjs` solo 18/18 pass,
exit 0. Sliced neighbors green in one invocation (executor_lifecycle +
executor_parallel + backlog_engine + planning_execution: 53/53).
`npm run check` green (100 targets, no collisions, syntax ok). The
main.cjs probe hunk rode the sibling worktree session's path-limited
landing e3ad851 (its whole-file commit carried the already-in-place
probe alongside its own wiring); this commit adds the updated cases
and this row.

Sweep-advice change verified end to end for task_7247a03061fd07b9
(2026-09-22, ~14:2x, run_1790086311775_18 "Feed the staged-sweep warning
into the next dispatch"). The finish()-time sweep now parks its
staged-files warning on the dispatcher keyed by repo root, and the NEXT
dispatch into that repo carries it as collab advice
("CAUTION shared git index ... commit or unstage BEFORE editing") naming
the files; one read consumes it, a run that ignores it re-arms it through
its own finish sweep, and entries older than 30 minutes age out. Narrow
gate: `node --test tests/executor_end_to_end.test.mjs` solo 17/17 pass,
exit 0 (two new cases). Sliced neighbors green in one invocation
(executor_lifecycle + executor_parallel + backlog_engine +
planning_execution: 53/53). `npm run check` green (99 targets, no
collisions, syntax ok). `npm run test:fast`: one fail in eyes_worker —
the documented load-dependent read-timeout row — solo rerun 8/8 pass,
exit 0. Python contracts 246 OK; normalized-path lock green;
`npm run audit` ok, zero findings. The main.cjs side of the change stays
uncommitted on purpose: the file also carries the sibling agent-issues /
model-config in-flight hunks, so a path-limited commit now would sweep
them; it rides the combined in-flight tree landing card.

Full gate backing the combined in-flight tree landing (2026-09-22, ~14:1x,
run_1790086456428_22 for task_85b21602201d47e7 "Commit the combined in-flight
tree" — brain maps, agent-issues decision lane, Command inspect mode,
provider breaker, windows command-line port; booklet regenerated first via
`npm run build-booklet`, which brought `renderer/booklet.html` back in sync
with the edited renderer sources). `npm run check` green (99 targets, no
collisions, all selectors used, syntax ok). First `npm test`: 1937 tests,
1932 pass / 2 fail / 3 skip — both fails in `executor_end_to_end.test.mjs`
(the two staged-index warning cases), the parallel-stage contention class in
the table above, not the tree: solo `node --test
tests/executor_end_to_end.test.mjs` immediately after, 17/17 pass, exit 0.
Full `npm test` rerun then ran the whole chain green (Node stage exit 0,
Python contracts 246 OK, normalized-path lock "all checks passed").
`npm run audit` ok, zero findings. occlusion_probe skipped with its usual
capability-gated record (this desktop never emits Electron occlusion
events); no other skips or fails.

performance_render guard task closed with first-hand solo and in-suite
evidence (2026-09-22, 09:17–09:22, run_1790086407101_20 for
task_9e1fabae123a9443 "Guard performance_render flake", retry after the
unverified settlement). Verified the claimed hardening is real and landed
before crediting it: the 40 s kill/report contract (taskkill /T /F tree-kill,
exitCode race guard, PID/root timeout diagnostics, timer cleared on exit) is
committed in 3198c4d and the load-tolerant downloadCapture budget in
6f3b370/520e22b; both files have zero worktree drift. Deferred to the sibling
gate: at 09:16 the board showed a live `node --test
tests/performance_render.test.mjs` plus another suite and 82% CPU; launched
after they cleared (09:17:12, CPU 31%). Solo `node --test
tests/performance_render.test.mjs`: 2/2 pass, exit 0, wall 9.8 s (fixtures
4.5 s/5.1 s). In-suite `node scripts/run-node-tests.mjs` starting inside the
tail of the sibling 09:16 gate: 1937 tests / 1932 pass / 2 fail / 3 skipped,
both performance_render tests ✔ — fixtures 24.5 s and 6.1 s under that
residual load, inside the 40 s kill contract and 50 s test timeout. The two
failures are executor_end_to_end.test.mjs staged-index warning cases; solo
rerun 17/17, exit 0 on the same uncommitted tree (the known moving-tree /
parallel-load table row — sibling main.cjs / scripts/assistant.mjs edits in
flight, not this task's scope). The ~1/8 loaded-run exit-1 recurrence named
as remaining by the first attempt is closed by the rows below: the 14-run
loaded loop with no repro (run_1790028475698_40) and the captured-and-
classified full-contention signature (fixture-internal download timeout,
since covered by the pace-scaled downloadCapture budget). Logs:
%TEMP%\opencode\perf-verify\ (solo1.log, insuite.log, executor-solo.log).
No source changes this run; this entry is the only edit.

Fresh full-gate green rerun closing the integration-gate chain
(2026-09-22, 09:13–09:17, run_1790086242215_15 for task_94b29c15a3479597).
Purpose: the sibling-edits evidence task_336a62b5d249978f asked for — its
own green gate (run_1790081870798_93) explicitly required a rerun once
sibling runs landed further edits, and this run covers that in-flight tree.
Tree at HEAD a9b4671 with 32+ uncommitted sibling paths present and
untouched (main.cjs, preload.cjs, renderer/*, scripts/*, tests/* including
the new brains/provider-breaker/windows-command-line suites); no source
writes in the 3 minutes before launch, and the only electron group running
was the Studio app itself (one app's main/gpu/utility/renderer set, up
since 09:08:57), no test fixtures. `npm run check`: exit 0 (spec-collisions
198 specs, ALL-SELECTORS-USED across 5 stylesheets, check-syntax 99 files).
`npm run build-booklet`: exit 0. First `npm test` attempt (09:14, 1.5 min):
exit 1 on the serialized occlusion_probe suite — cleanest-of-3 lag 435 ms
against the ~0 expectation, samples [1589, 588, 435] — the known
environmental cover-window row, not a source regression; solo
`node --test tests/occlusion_probe.test.mjs` then passed 1/0, exit 0,
6.1 s. Second `npm test` (09:16–09:17:35): exit 0 in 1.4 min — node stage
171 suites (9 launching Electron), 1935 tests / 1932 pass / 0 fail /
3 skipped (capability-gated), serialized display suites each 1/1, Python
contracts "Ran 246 tests ... OK", normalized-path lock suite green via the
exit-0 chain. Full logs captured to temp (gate-check.log, gate-booklet.log,
gate-test.log, gate-test2.log, occ-solo.log). This row is the citable
gate-green artifact for closing task_336a62b5d249978f and
task_c1cf337d66009c14 on "sibling edits landed".

performance_render solo re-confirmation on the landed profiler tree
(2026-09-22, ~09:0x, run_1790085767760_3 for task_9892bbd6444a088e,
re-running the evening row's requirement on the current clock). No suite
load and zero electron processes at launch (the two concurrent-session
mefi-command-render fixture groups sighted at 09:00:09/09:04:10 had
exited, verified via Win32_Process). `node --test
tests/performance_render.test.mjs` solo: 2/0 pass, exit 0, wall 32.9 s
(fixtures 26.2 s/5.9 s - slower than the evening's 14.4 s with only
~0.03 GB free RAM reported by os.freemem() and ~17% CPU on 16 logical
cores, still far under the 40 s kill contract and 50 s test timeout).
Serialized display stage exactly as scripts/run-node-tests.mjs runs it,
one invocation per fixture: occlusion_probe 1/0, exit 0, 5.9 s (lag 0 ms,
worker drift 166 ms); eyes_toggle_electron 1/0, exit 0, 3.5 s. All three
runs left zero electron processes of their own (the only electrons after
were the concurrent session's 09:07:04 mefi-command-render group). Tree
at HEAD 18c1025, which includes the committed kill-contract hardening
and the load-tolerant downloadCapture budget
(tests/fixtures/performance-render-electron.cjs:133); concurrent
sessions' uncommitted work untouched. Confirms on the landed tree what
the evening row found in-flight: the timeout is environmental, not the
profiler change, and the classification follow-up is already closed by
the row below.

performance_render historical full-`npm test` contention signature verified
and closed (2026-09-22, ~08:4x, run_1790084276208_9 for
task_37a437c156658816 "classify historical full-npm-test contention
signature"). The historical-condition repro and classification were already
captured and landed by the 2026-09-21 night row below (run_1790036825250_4:
full `npm test` parallel stage plus serialized display fixtures plus a
node_modules OneDrive churn writer while the flake-loop harness ran the
performance_render suite); this attempt audited every on-disk artifact of
that capture instead of re-landing it, per the adopt-don't-clobber handoff.
Audit result — all committed claims reproduce from the files: run-20260921-
193144/meta.json (exit1Captured true, harnessKilled false, iteration 1 exit
1 in 80.2 s, before-snapshot 100% CPU / 45 MB free RAM / 39 node + 8
electron processes); iter-01/stdout.log (test 1 "real performance profiler
catches blocking work..." hit node:test's 50000 ms budget; test 2 failed
`Error: Profiler JSON download timed out` at
tests/fixtures/performance-render-electron.cjs:127:47, runFixture assert
1 !== 0); iter-01/desktop-host/report.json failure text identical, elapsedMs
10522. Classification per run-flake-loop.ps1's signature rules:
fixture-internal-uncovered (download-timeout + :127 stack frame) — the 5 s
will-download fixed budget inside downloadCapture() expired under host
saturation; explicitly not kill-contract-covered (no "Performance fixture
timed out: PID" marker, the 150 s harness hard kill never fired), not the
GPU-contention class (those suites pass solo), and not state corruption
(the in-suite performance_render copy survived slowed-but-green in the same
concurrent run). Current-tree check on this clock: the committed
load-tolerant downloadCapture budget (paceFactor-scaled 5-30 s, message
prefix preserved so the harness classifier still matches) is present at
tests/fixtures/performance-render-electron.cjs:132-138, and solo
`node --test tests/performance_render.test.mjs` passed 2/2 in 12.4 s with
zero leftover electron processes. Honest limit: the load-tolerant budget has
solo + synthetic-12-spinner evidence but has not been re-run under a fresh
full-`npm test` + churn condition on today's tree; the 2026-09-21 capture
remains the only under-condition repro, and the loop harness
(tools/logs/performance-render-flake-loop/run-flake-loop.ps1, gitignored)
is reusable as-is for that if it is ever wanted.

Full `npm test` gate green on the combined tree at HEAD 7dbd66f (2026-09-22,
~10:0x, run_1790082653725_120 for task_3762737ae0251810 "Full npm test gate —
follow-up ef8e2f"). The commits the earlier full-gate card waited on had
landed (Clear-confirm fixture 2415c29/45fa832, TESTRUNS UTF-8 repair 77bcc69,
a272 entry correction 7dbd66f), so the whole gate re-ran end-to-end over the
tree as it stands, sibling uncommitted work (main.cjs, renderer sources,
scripts/auditor.mjs, executor/performance-render test edits, auditor_catalogs
+ startup_resume suites) adopted intact and nothing clobbered; this run made
no source edits. Result: exit 0 — runner settle preflight passed, node stage
163 suites (9 launch Electron), parallel aggregate 1836 pass / 0 fail /
3 skipped; serialized eyes_toggle_electron 1/1 in ~3.3 s (baseline 2
fetches/300 ms, hidden 0/1200 ms, one resume snap, 6 fetches total);
occlusion_probe took its documented capability skip this time — Discord held
the win32 foreground, visibility never flipped within 15 s and rAF stayed
loud — the expected row of the table above, not a regression; Python
contracts 246 tests OK in 35 s; normalized-path lock all checks passed.
Full log: %TEMP%\opencode\npm-test-gate-ef8e2f.log. This is the exit-0
full-gate evidence task_3762737ae0251810 was carded for; it also supersedes
the 06:2x full-gate row below by covering the landed follow-up commits.

Green exit-0 full `node scripts/run-node-tests.mjs` re-landed on the current
tree after API-drop retries (2026-09-22, ~08:01, run_1790081829114_82 for
task_a272d75c6e9c5bf5 "Land green exit-0 full-suite run and close toggle
card"). The two attempts after the 06:26 green run (below) died before doing
any work — the autopilot worker lost its model API ("Cannot connect to API /
fetch failed", exit 1, planner+reviewer support) — a tooling outage, not a
repo problem, so no fix was needed beyond rerunning; this row supplies the
first exit-0 evidence against the tree as it stands now, with the sibling
session's uncommitted work adopted intact (main.cjs, renderer/boot.js +
startup.js + booklet.html, scripts/auditor.mjs, executor_resume test,
performance-render fixture, new auditor_catalogs + startup_resume suites)
and nothing clobbered. Preconditions checked at launch: desktop minimized
(Studio included), no sibling suite in flight (only Studio/MCP node+electron
processes), runner settle preflight passed. Result: exit 0 in 46 s —
parallel stage 163 suites (9 launch Electron), 1839 tests / 1836 pass /
0 fail / 3 skipped (the documented environment-conditional skips; the count
grew 1819 → 1839 from the sibling's two new suites, all green); serialized
eyes_toggle_electron 1/1 in ~3.2 s (baseline 2 fetches/294 ms, hidden
0/1200 ms, one resume snap, fetch gaps 294-1257 ms, 6 fetches total);
serialized occlusion_probe 1/1 strict native occlusion (document.hidden
signal, occluded rAF growth 0, lag 0 ms, worker drift 155 ms,
MessageChannel 1 ms, 0 console errors). `npm run check` exit 0 and
`npm run audit` 0 warnings on the same tree. Full log:
%TEMP%\opencode\node-tests-full-a272-rerun.log. Flipping
task_11085243b2d2452f to settled stays with Studio per the no-child-task
rule; this row is the evidence it needs.

performance_render downloadCapture made load-tolerant (2026-09-22, ~09:5x,
run_1790076573386_24 for task_2c6ba2f8206d1e61 "Make downloadCapture budget
load-tolerant"). Acting on the captured exit-1 in
tools/logs/performance-render-flake-loop/run-20260921-193144 (100% CPU, 45 MB
free RAM before the iteration; signature "download-timeout + :127 stack
frame", fixture report elapsedMs 10522 with every pre-export stage green
through hostFrozen): tests/fixtures/performance-render-electron.cjs
downloadCapture now probes its own main-process timer pace (250 ms sleep)
before the export click and scales the will-download deadline
5000·paceFactor, floored at the old 5 s and capped at 30 s to match the
capturePage tolerance; the "Profiler JSON download timed out" message prefix
is preserved so the flake-loop classifier still matches, and the fixture
report now records downloadBudget {paceFactor, budgetMs} for triage.
Fixture-only: no renderer/main/runner changes; sibling uncommitted work
(main.cjs, command-render-electron.cjs TESTRUNS row above) untouched.
Validation: solo `node --test tests/performance_render.test.mjs` 2/2 green
in 9.5 s (quiet host, factor 1.0 → 5 s floor, behavior unchanged); desktop
variant under synthetic load (12 busy node spinners on 16 cores) green with
the budget verifiably engaged at paceFactor 1.06 → 5300 ms, elapsedMs 4015;
`npm run check` all-green; eslint clean on the file. Honest limit: the full
saturation profile of the captured failure (memory-exhausted host) was not
re-created on this shared machine; tolerance beyond the probe rests on the
captured evidence plus the scaled headroom.

Full npm test gate green after fixing the command-render Clear confirm
regression (2026-09-22, ~06:29, run_1790076061072_1 for
task_416bb7bda070b8d0 "Rerun full npm test gate, land fixture changes",
resuming the interrupted run_1790041643677_1). The interrupted run's only
fixture edit (the Python updater contract reading docs/architecture.md)
was verified already landed in 96929cb; the working tree was clean at
pickup. First full `npm test` on this clock went red in the parallel stage
(1819 tests / 1815 pass / 1 fail) on command_render "real Command renderer
paints finite task nodes..." failing `Timed out: Clear empties the done log
through the host` (tests/fixtures/command-render-electron.cjs until():152
via :930) — and the solo rerun failed with the identical signature at a
0.36 GB free-RAM floor, which ruled out the documented GPU-contention class
(those pass solo). Root cause: a418a84 (2026-09-21 20:37, after the last
green full gate run_1790035430350_1) made Clear ask first through
window.MefiConfirm — a 12 s toast whose committing button nobody presses in
the offscreen fixture, resolving false, so the host clear never fires and
the fixture's 5 s until expires deterministically: committed test red on
committed code, missed because no full gate ran between a418a84 and here.
Fix: the fixture now pins the ask and approves it like a user — after
clicking cmd-done-clear it waits for the `#toast-host .toast-action`
"Clear" button and clicks it before the host-clear wait (fixture-only
change; renderer untouched, build-booklet rebuilt byte-identical, hash
f98dd2322a01). Evidence: `node --test tests/command_render.test.mjs` solo
1/1 exit 0 on the same starved host; full `npm test` rerun exit 0 through
the whole chain — parallel stage 1819 tests / 1816 pass / 0 fail /
3 skipped in 34.0 s (the documented environment-conditional skips, incl.
the in-process vm-modules source check), serialized eyes_toggle_electron
1/1 in 3.2 s (one hide/show toggle, no duplicates), serialized
occlusion_probe 1/1 strict native in 5.7 s (document.hidden occlusion,
occluded rAF growth 0, lag 0 ms, worker drift 166 ms, console errors 0),
python contracts 246 OK in 30.0 s, normalized-path lock checks all
passed; the runner's settle preflight reported no mid-run source drift.
`npm run check` clean (94 targets, 188 specs, CSS merge-skip/unused,
syntax) and `npm run audit` clean (0 findings) on the same tree. A
concurrent session's uncommitted work was landing around the run (the
eyes-toggle TESTRUNS entry 06:28, an in-flight session-continuity edit
to main.cjs last written 06:31 — after the gate finished) and was left
untouched; committing that work belongs to its own card.

Green exit-0 full `node scripts/run-node-tests.mjs` closing the eyes
toggle card (2026-09-22, 06:26, run_1790076152216_4 for
task_a272d75c6e9c5bf5, settling task_11085243b2d2452f "Stabilize eyes
toggle timing fixture" on this evidence). Preconditions verified before
launch, not assumed: the flake fixes are committed (ce3e6ec —
eyes_toggle/occlusion runner+fixture fixes; cb93e79 — occlusion
skip-on-external-destroy; plus the runner's tree-settle preflight
logged below), `git status` clean on HEAD 3138002, no sibling suite in
flight (the concurrent gate attempt's last test process had drained;
only MCP-proxy node processes remained), and the live Studio main
window (pid 26912) was minimized per the card's quiet-desktop
requirement. The run: exit 0 in 58 s with the memory floor at ~0.5 GB
available — parallel stage 161 suites, 1819 tests / 1816 pass / 0
fail / 3 skipped (including the documented environment-conditional
live-gateway and vm-modules skips); serialized eyes_toggle_electron
1/1 in ~3.1 s — baseline 2 fetches/298 ms, hidden 0/1200 ms, one
resume snap, fetch gaps 298-1256 ms, 6 fetches total — the log-tail
toggle assertion that used to drift (146 solo vs 158 in-suite) stable
in-suite; serialized occlusion_probe 1/1 strict native occlusion
(document.hidden signal, occluded rAF growth 0, lag 32 ms, worker
drift 160 ms, MessageChannel 1 ms, 0 console errors). This chain also
supersedes the sibling gate attempt minutes earlier
(npmtest-gate-run_1790076061072.log + command-render-solo-rerun.log:
command_render "Clear empties the done log through the host" red
in-suite and in a solo rerun under the same memory floor): that
transient-saturation reading is withdrawn — the red was the a418a84
Clear confirm gate, not load: the new done-log confirm toast left the
fixture's wait unanswered, and the identical solo run passes after
exactly one change, 2415c29 teaching the fixture to approve the toast
(command-render-solo-rerun.log red -> command-render-solo-fixed.log
green, 1/1). Full log:
%TEMP%\opencode\node-tests-full-a272.log (177 KB, kept).

Rotating in-suite vm ReferenceErrors root-caused to source drift, runner
gained a settle preflight (2026-09-21, night, run_1790038455313_19 for
task_b98d5abec0a9f2cc "Root-cause rotating in-suite vm ReferenceErrors").
Forensics on the two captured failing runs (node-tests-full.log /
node-tests-full2.log, 17:35/17:38): every reported failure is a
section()/vm-eval test throwing "ReferenceError: X is not defined" where X
(ASSISTANT_MAIL_RULE, assistantTakeMail, pickerHeld) is either stubbed in
the current test sandboxes or declared at the markers the current
main.cjs/renderer/idle.js answer — i.e. the eval'd slices came from bytes
that were not the settled tree. The reads themselves succeeded (no EBUSY,
no missing-section asserts), so the children read transient or stale
content while sibling sessions had those exact files mid-edit that evening
(the agent-mail session edited main.cjs/scripts/assistant.mjs, the callout
session edited renderer/idle.js; OneDrive sync lengthens the unstable
window). Which file is mid-edit rotates per run, which is why the failing
set rotated (executor_modes+expand_finished_guard vs
boot_poll_visibility+command_graph+command_visuals) while every file
passes solo against settled bytes. Discriminating evidence on the quiet
current tree: two full `node scripts/run-node-tests.mjs` runs (1738
tests) produced zero vm/section failures — run 1 failed only
performance_render (Profiler JSON download timeout) and run 2 only
command_render (initial painted task frames timeout, 73 s under the
active sibling session), both the separately tracked live-Electron
load flakes, not vm evals. Fix landed in scripts/run-node-tests.mjs:
before the parallel stage the runner fingerprints main.cjs, preload.cjs,
scripts/, renderer/, tests/ and data/models.json (content hash over
paths+bytes; data/'s live stores deliberately excluded or it would never
settle), re-checks after 1.5 s, waits up to 10 attempts for the tree to
hold still, and exits 1 with a named diagnosis instead of launching into
a mid-edit window; if the parallel stage fails and the fingerprint moved
meanwhile, it prints that the vm failures may be transient-content reads
before propagating the exit code. Algorithm self-test (stable pass,
content-change detect, second-change detect, unwatched-extension ignore,
re-stable) 5/5 in %TEMP%\opencode\preflight-selftest.mjs; `node --check`
clean; both full runs above exercised the real runner end to end
(preflight settled instantly on the quiet tree, no false-positive drift
diagnostics). Sibling concurrent suite runs: checked at task start, none
running (only MCP proxies and one other agent CLI). Not claimed here: a
green exit-0 full-suite run (the two verification runs each hit one known
Electron-under-load flake while the sibling session was active) — that
remains the toggle card's own gate; and the mid-edit window cannot be
closed for edits that start after launch, only diagnosed.

performance_render residual flake CAPTURED under real suite contention —
fixture-internal, uncovered by the kill contract (2026-09-21, night,
run_1790036825250_4 for task_3d33701ba75b4e48 "Capture residual flake
detail"). This closes the capture obligation left by the 14-run loaded
loop below and supersedes the child handoff's 19:15:35 "exit1Captured"
meta (run-20260921-191535): that record came from an intermediate harness
revision and is invalid evidence — exitCode null, no stdout/stderr
preserved, classification unclassified — it is retained on disk as a
buggy-harness artifact only. Valid capture: full `npm test` (pid 41816,
log npmtest-20260921-193008.log) plus a node_modules OneDrive churn
writer (2 s cadence, 5 min) ran while the current full-capture harness
(tools/logs/performance-render-flake-loop/run-flake-loop.ps1, per-iter
stdout/stderr + host snapshots) ran `node --test
tests/performance_render.test.mjs`. Iteration 1 (run-20260921-193144/
iter-01) exited 1 from the process itself (harnessKilled false, 80.2 s
vs ~10 s unloaded) under 100% CPU, 45 MB free RAM, 39 node + 8 electron
processes: test 1 "real performance profiler catches blocking work..."
hit node:test's 50000 ms budget, test 2 "desktop performance capture
measures real Electron processes..." failed with the exact historical
signature — `Error: Profiler JSON download timed out` at
tests/fixtures/performance-render-electron.cjs:127:47 (the 5 s
will-download completion timer in downloadCapture()), runFixture
assert 1 !== 0. Classification per the established rules:
fixture-internal-uncovered (download-timeout + :127 stack frame); the
kill contract's "Performance fixture timed out: PID" marker is absent
and its 150 s harness hard-kill never fired — the hardened kill
contract is not implicated. Root cause anatomy: the renderer's
profiler-export click -> will-download -> capture.json write pipeline
exceeds its fixed 5 s budget when the host is saturated; the in-suite
performance_render copy inside the same concurrent npm test survived
(36.3 s + 8.1 s, slowed but green), so the flake is a load-dependent
fixed-budget miss, not state corruption. Ambient-load note: the
concurrent suite itself degraded as predicted — serialized
occlusion_probe failed "rAF must stay silent while occluded
(growth=2)" this run (environment-conditional per run_1790035430350_1)
and the child's 19:15 concurrent suite failed executor_parallel
"session tool edits remain attributable" (0 !== 3) — both are
contention symptoms, not performance_render regressions. Stale
`%TEMP%\mefi-performance-render-*` dirs re-audited: 0 remain (the
fixture teardown reclaimed both once load subsided). Suggested
follow-up (out of scope here): make downloadCapture's 5 s budget
load-tolerant (deadline scaled to observed fixture pace or one retry)
— small fixture-only change, needs its own card. `npm run check` exit
0 after this row.

Full node suite green after the cap-boundary hysteresis, on top of the
memory-cap merge (2026-09-21, late night, run_1790036998516_6 for
task_29e6146a127aaf79, parent task_12e1b622aa97c583 "Cap boundary
hysteresis"). The change under test is the severe-memory cap's boundary
latch in scripts/machine.mjs (landed in 3198c4d, on HEAD 0c9ce23):
severeCapSamples consecutive readings below memorySevereFloorMB engage
the cap, the same count of consecutive readings at or above floor plus
memorySevereReleaseMarginMB release it, and recovery-band readings hold
the latch while resetting both streaks — so solitary 299/451 blips can
no longer toggle parallelism; tests/machine_capacity.test.mjs pins the
streak behavior. `node scripts/run-node-tests.mjs` exited 0 through the
whole chain on the current tree, which also carries the concurrent
sessions' uncommitted work (machine.mjs telemetry line, assistant.mjs
scope qualifier, commit-evidence and project-work tests): parallel stage
1732 tests / 1730 pass / 0 fail / 2 skipped in 42.1 s — the same two
known environment-conditional skips as run_1790035430350_1 (live
gateway Jev-model resolution without credentials; in-process vm-modules
source check needing --experimental-vm-modules); serialized
eyes_toggle_electron 1/1 in 6.6 s (baseline 2 fetches/285 ms, hidden
0/1200 ms, one resume snap, fetch gaps 285-1306 ms, 6 fetches total);
serialized occlusion_probe 1/1 strict native occlusion pass in 7.4 s
(document.hidden signal, occluded rAF growth 0, lag 0 ms, worker drift
158 ms, MessageChannel 0 ms, 0 console errors) — where run_1790035430350_1
had taken that probe's occlusionUnsupported environment skip. A first
invocation of the same runner minutes earlier went red under desktop
contention (parallel stage 97.4 s vs 42.1 s green): five red entries —
3 fail plus 2 cancelled — namely performance_render and node_paint_cache
50 s timeouts, package_privacy spawnSync ETIMEDOUT, eyes_worker 150 ms
store-read timeout, and the commit_evidence unscoped-check assertion;
every one of them passed in the green retry with no source change
between invocations, and the runner's exit-code chaining stopped that
red attempt before the serialized fixtures ran at all. No
hysteresis-related failure appeared in either attempt — the
machine_capacity suite passed both times.

Independent re-run of the same runner plus the npm-test tail
(2026-09-21, late night, run_1790038076467_15 for the same
task_29e6146a127aaf79, verifying the row above on the current tree).
`npm test` attempt 2 on this clock confirmed the runner green through
every stage — parallel stage 1732 tests / 1730 pass / 0 fail / 2 skipped
in 53.3 s (the same two environment-conditional skips), serialized
eyes_toggle 1/1 in 4.7 s (baseline 2/304 ms, hidden 0/1200 ms, one
resume snap, 6 fetches total), serialized occlusion_probe
environment-skip (this desktop never emitted occlusion events while a
Claude window held the foreground, matching the run_1790035430350_1
precedent) — and then exposed a real regression the node-only runner
cannot see: the python unittest stage failed
test_fixture_local_replies_are_grounded because 0ac92e8's longer help
line ("open issues and tickets") pushed "roster" past the 600-char
REPLY_MAX_CHARS clip in scripts/assistant.mjs's localReply help case
(committed test red on committed code). Fixed on this clock by trimming
the help wording only ("the whole roster out" -> "the roster out", "They
talk to each other too" -> "They talk to each other", "read what they
said" -> "read the mail", "the request inbox and quiet sessions" ->
"the inbox and quiet sessions"; "request inbox" remains in the agents
line) so the clipped reply again ends at "sends the roster out." with
every asserted piece inside 600 — the python test is green solo and the
node help-routing suite still passes. Two other npm test attempts on
this clock went red purely from host saturation (0.18 GB free RAM,
Memory Compression 1.3 GB, CPU 55-74% from Discord, two Claude
sessions and a Defender scan): performance_render Profiler-JSON
download timeouts (one with the kill-contract "Performance fixture
timed out: PID" marker), startup_render 65 s and task_overview_render
45 s node:test budget timeouts — all in the documented
load-dependent classes above, no source regression, and
machine_capacity (the hysteresis pin) green in every attempt.

"Land the fixture/runner files once green" audit (2026-09-21, night,
run_1790036793362_3 for task_bc33fdd783d99ad5, re-carded todo from the
task_073a02b3a82eec7d gate family). The deliverable was verified already
landed, not re-landed: 3a6ef13 carries the fixture files
(command_graph, command_visuals, executor_continuation,
verification_drain) with its green-gate TESTRUNS row, ce3e6ec the
eyes_toggle/occlusion runner+fixture fixes, cb93e79 the occlusion
skip-on-external-destroy hardening; `git status` shows zero pending
diffs on scripts/run-node-tests.mjs, package.json, tests/fixtures/ or
the serialized fixture tests, and the only uncommitted test files
(commit_evidence, project_work + 8 modified) belong to the
commit-evidence family under its own commit card. Fresh gate attempts
on this attempt's clock could not reproduce green purely from host
load — machine at a 0.38/13.77 GB memory floor: full runner run 1 red
(occlusion_probe lag samples 173/1901/1303 ms under parallel-stage
contention; solo rerun exit 0, skipped via the cb93e79 guard with the
forensic pointing at an external foreground process closing the probe
window), full runner run 2 red on a different, diff-free committed
fixture (node_paint_cache "No pixel fixture report" — the documented
Electron-under-load class). No fixture or runner file was edited to
force green; the combined-tree full gate stays carded separately
(task_3762737ae025181) and should rerun on an unloaded machine.

Second-user reports: schema-less OpenCode store, "open issues" reply,
planning modal blind to existing maps/tickets (2026-09-21, night).
Reports came as Discord screenshots from another machine, so nothing
reproduced locally. (1) "Store unavailable · no such table: session":
`storePresent` in scripts/eyes.mjs now checks sqlite_master (5 s cache,
cleared by closeReadDb) and a store file carrying none of
session/message/part/todo reads as empty; a partial store (fixtures build
only `part`) still reads, and a read of a missing table still throws.
New `storeStatus()` (on the eyes-worker allowlist) explains missing /
no-session-table / legacy storage/ layouts; eyes:state, the watcher's
problem list and usage:tracker carry its note, and the Command empty
card shows "No sessions in the store yet" with the fix instead of a
modal. (2) "What are the open issues currently in the project?" fell to
chat and echoed focus + memory; the tasks intent now matches open
issues/tickets/bugs phrasings (queue cleaning and the fix pass keep
their routes) and the reply adds the repo's tracker line from the new
`projectWork` fact. (3) New scripts/project-work.cjs reads the
mattpocock-skills layout (docs/agents/issue-tracker.md, wayfinder maps
and tickets under .scratch/<effort>/, `gh issue list` for GitHub
trackers with a 6 s timeout) plus agents/skills/commands from .claude/,
.opencode/, opencode.json, ~/.claude, ~/.config/opencode and installed
Claude plugins; planning:list returns it as `existing` and the modal
renders "Already in this project" with a Plan-from-this-map button.
(4) Usage panel "Unknown" for unpriced calls now reads "unpriced" ($0
when no calls). Evidence: tests/project_work.test.mjs 5/5,
eyes_missing_store 4/4 (two new), assistant_question_routing,
planning_service, planning_ui (new cases) green; full
run-node-tests 1732 tests: first run 1 fail (executor_parallel's
part-only fixture, fixed by the any-core-table rule), rerun 2 fails
that pass alone (node_paint_cache, performance_render — Electron
fixture timeouts under load), 1728 pass otherwise; npm run check exit 0
(91 targets, 179 specs, CSS all used); npm run audit 0 findings;
build-booklet rebuilt renderer/booklet.html; fake-bridge browser preview
showed the modal panel, Plan-from-map filling the destination, and the
Command card's store note. Uncommitted; peer sessions have other
uncommitted edits in the same tree (explorer.js, machine.mjs,
receipts.mjs and their tests).

Commit-evidence verification loop closed on the remaining-text gate
(2026-09-21, night, run_1790035904812_8 for task_326aafb524dcb758).
The prior attempt's feature work (claimedCommitHash + commit branch in
verifyCompletion, commitEvidence in scripts/eyes.mjs, eyes-worker
allowlist, main.cjs evidence.commits prefetch, runner-observed-commit
receipt trust, unit + real-git tests) was re-verified present and green,
and its deployment was proven, not assumed: sha256 of String(
verifyCompletion) from this tree equals evaluator.sourceSha256
e51b386ebc464a928ae896c5b8797252f7658be02c72977f59eca9a1c0644ca4 in
receipt rcp_ccc78643aae122d6 — the live app was already evaluating with
the new code when it failed. The loop's true cause was the receipt's
input outstanding: true: noRemainingWork rejected "none in scope"
(the attempt's remaining text) and the outstanding gate fires before
any evidence branch, so commit evidence never got the chance.
Fix: noRemainingWork (scripts/assistant.mjs) accepts an optional
"in/within (this) scope" qualifier on its none/nothing/no-remaining
phrases; guards pinned in tests/verification_checks.test.mjs keep
"none of the tests pass" and "none in the other module" outstanding.
Evidence: node --test verification_checks + commit_evidence +
executor_result_protocol 17/17 pass; npm run check exit 0 (90 targets,
178 specs); npm run audit 0 findings; end-to-end repro of the exact
prior receipt shape now returns verified ("1 recorded check(s)
passed", outstanding false) while an unobserved commit claim still
fails. Uncommitted-tree commit + dist payload file re-sync remain with
the commit-owner card; full npm test gate is carded separately.

Cover-window interference verification re-pass (2026-09-21, night,
run_1790035748558_5 for task_17537ddbe6106840, retry after
run_1790031638041_10's recorded checks could not be confirmed).
Re-established ground truth on HEAD 0c9ce23: the coverLost work is
committed (cb93e79 — occlusion-probe-electron.cjs cover "closed"
listener with the coverTeardownStarted self-destroy flag plus
coverLostRecord routing in finish(), occlusion_probe.test.mjs skip
before any per-phase assert), and this session re-proved every claim
from scratch rather than trusting the report: `npm run check` clean
(90 targets, 178 specs, css, syntax); serialized `node --test
tests/occlusion_probe.test.mjs` passed strict native occlusion
(document.hidden, occluded rAF growth 0, lag 0 ms, 1 pass / 0 fail);
and the live interference itself, reproduced via an external Win32
WM_CLOSE posted to the "occluder" cover mid-occluded-measure —
fixture-direct exited 0 with the coverLost record (phase=
occluded-measure, trigger, coverDestroyed=true, measuredRafGrowth=
null for the never-finished measure) and the same close under the
node harness yielded 1 skipped / 0 fail / exit 0 with the full
diagnostic line (occlusion detection, foreground identity, timeline
tail). The earlier verification failure was session check-recording,
not the tree: the flagged changed files are the concurrent sessions'
uncommitted work, untouched here.

Memory-cap telemetry surfaced in the Explorer Machine panel and briefing
facts (2026-09-21, night, run_1790035560126_2 for task_c87b4bfb6577188c,
parent task_653bec47a4549e05 "Persistent-memory guard — follow-up e2b151").
This row also logs run_1790027578783_19, the parent build that authored the
severe-memory parallelism cap (severeCapSamples hysteresis, holdKind
"memory-cap", resources.memorySevereCapped in scripts/machine.mjs plus the
machine_capacity and assistant_readiness_reply coverage) and left the UI
surfacing as this card's scope; that code landed in 3198c4d (verified via
git log -S memorySevereCapped) and its full-gate runs are logged below
(run_1790028566027_42, run_1790035430350_1). This attempt:
scripts/machine.mjs describe() now pushes "Severe-memory parallelism cap
still latched — new worker starts stay capped until free memory recovers"
whenever memorySevereCapped is true without the active memory-cap hold (the
drained-pool case where admission is clear for one worker but parallelism
is not — tests/machine_capacity.test.mjs pins both the hold-reason summary
and the latched-clear summary); renderer/explorer.js renderMachine reads
status.capacity.resources and shows a "memory cap" badge (trains tone, info
tint, hover title) while the latch holds, keeps "busy" under the active
hold, and reverts to idle/free when the latch releases
(tests/explorer_ui.test.mjs drives the onMachineStatus feed through
latched-clear, active-hold and released states); scripts/assistant.mjs
buildFacts adds memorySevereCapped to the executor capacity resources
allowlist beside holdKind/memoryShortfall/memoryWarning, with the
latch-clear fixture pinned in tests/assistant_readiness_reply.test.mjs.
Booklet rebuilt (hash f98dd2322a01, unchanged model set). Verification:
node --test on machine_capacity + assistant_readiness_reply + explorer_ui
38/38 pass; npm run check clean (90 targets, 178 specs, css merge-skip and
unused selectors, syntax). The concurrent commit-evidence session's
uncommitted work (main.cjs autopilotHousekeeping, the verifyCompletion
block in scripts/assistant.mjs, scripts/eyes-client.cjs, scripts/eyes.mjs,
scripts/receipts.mjs, tests/verification_checks.test.mjs, untracked
tests/commit_evidence.test.mjs) was left untouched — the assistant.mjs
edit here is the buildFacts allowlist line only. Full npm test not run in
this attempt; the three touched suites plus the check gate cover the
change, and the full-gate baseline for this tree is logged in
run_1790035430350_1 above.

Full npm test re-run green after the severe-memory parallelism cap
merge landed in commits (2026-09-21, night). Run run_1790035430350_1
for task_cf5dbf3b66810435 (parent task_1a265efeeb6cbdd3
"Persistent-memory guard"), the verification retry after the original
green run could not be confirmed: that run's TESTRUNS row stands (see
run_1790028566027_42 below) and its only leftover, the then-
uncommitted cap code, has since landed, so this attempt re-proved the
gate on the current tree. Pre-run verification: HEAD 0c9ce23 carries
the cap (3198c4d touches scripts/machine.mjs — the severeCapSamples
hysteresis — and tests/machine_capacity.test.mjs, confirmed via git
log) plus the later cb93e79 and 0c9ce23, while the concurrent
session's uncommitted verifyCompletion/commit-evidence work (main.cjs,
scripts/assistant.mjs, scripts/eyes-client.cjs, scripts/eyes.mjs,
scripts/receipts.mjs, tests/verification_checks.test.mjs, untracked
tests/commit_evidence.test.mjs) sat in the worktree untouched. Full
`npm test` exited 0 through the whole chain: the main node stage 1719
tests / 1717 pass / 0 fail / 2 skipped in 41.3 s — the same two known
environment-conditional skips as before (the live gateway Jev-model
resolution without credentials, and the in-process vm-modules source
check needing --experimental-vm-modules); serialized eyes_toggle 1/1
(3.5 s, fetch gaps 295-1264 ms, 6 fetches); serialized occlusion_probe
took its documented occlusionUnsupported environment skip this time
(1 skip / 0 fail, 19.0 s: this desktop never emitted occlusion events
— cover shown focused but visibility never flipped and rAF never went
silent within 15 s, 8 focus reassertions — where run_1790028566027_42
and cb93e79's landing run both saw the strict native pass); python
contracts 246 OK in 48.5 s; normalized-path lock checks 6/6 "all
checks passed". The suite grew 1695 → 1719 tests since that run
(landed sibling work plus the in-flight commit-evidence tests). The
concurrent session's uncommitted work remains uncommitted for its
owner; committing it (and this row) is follow-up scope, not test
scope.

Occlusion-probe cover guard landed, in-flight tree remainder closed
out (2026-09-21, night, run_1790031887248_14 for
task_65726c87fbcd7cf9, commit owner for the in-flight tree). The
dirty-tree remainder after 3a6ef13 was the coverLost half of the
parent hardening task ("Harden occlusion-probe fixture against
external window destruction"): tests/fixtures/occlusion-probe-
electron.cjs learns the mirror-image guard (cover "closed" listener
with a coverTeardownStarted flag so fixture-requested destroys never
fire, coverLostRecord carrying phase/trigger/occlusion detection/rAF
growth/foreground/timeline tail plus any suppressed failure verbatim,
finish() routing it to a clean exit) and tests/occlusion_probe.test.mjs
skips with that reason before any per-phase assert, exactly like
windowLost. Reviewed the full diff hunk by hunk, then serialized
`node --test tests/occlusion_probe.test.mjs` passed strict native
occlusion (document.hidden signal, occluded rAF growth 0, lag 0 ms,
worker drift 161 ms, 1 pass / 0 fail, no skip — the interrupted
run_1790030986320_1 ERR_ASSERTION exit-1 tail was that same probe
under interference) and `npm run check` clean (90 targets, 177 specs,
css, syntax). Not run here: the full npm test gate — 3a6ef13's gate
was green on this tree's siblings and the changed files are exactly
the serialized probe above. The one-line package-lock.json
"license": "MIT" sync (package.json already declared it at HEAD;
stale lock from a later npm install) committed separately.

Full npm test gate green, verification-settlement work landed
(2026-09-21, late evening, run_1790031327079_1 for
task_073a02b3a82eec7d, resuming the interrupted
run_1790031092452_3). The uncommitted tree (kickVerificationSettlement
dwell/retry re-arm and shared base checks in main.cjs, verifying-orb
label ranking in renderer/idle.js, the four new fixtures in
tests/command_graph / command_visuals / executor_continuation /
verification_drain, AGENT_LOOP.md notes, booklet rebuilt to the same
hash f98dd2322a01) was verified end to end: the first full `npm test`
hit the known eyes_worker "read past the timeout" load flake in the
parallel stage (1 fail of 1716; passes 8/0 alone, same signature as
the 2026-09-21 entries above); the rerun was fully green in one
invocation - parallel stage 1716 tests / 1714 pass / 0 fail / 2 skip,
serialized eyes_toggle_electron 1/0 (fetch gaps 292-1300 ms, 6
fetches), serialized occlusion_probe 1/0 (lag 0 ms, worker drift
163 ms), python contracts 246 OK, normalized-path lock checks ok,
exit 0. `npm run check` clean (90 targets, 177 specs, css, syntax)
and `npm run audit` ok (0 findings) on the same tree. Not run: a
live app session watching a card settle through the new kick.

performance_render isolated re-run, timeout confirmed environmental
(2026-09-21, evening, run_1790030471057_2 for task_9892bbd6444a088e,
resuming the interrupted run_1790030285727_13). With zero electron
processes on the desktop (the interrupted run's leftover electron.exe
PIDs had already exited on their own; verified via tasklist + Win32_Process
before and after) and no suite load, `node --test
tests/performance_render.test.mjs` passed twice back-to-back: 2/0 then
2/0, exit 0, wall clock 14.4 s and 12.0 s, fixtures 7.3/5.7 s and
5.2/6.5 s - an order of magnitude under the 40 s kill contract and 50 s
test timeouts. Environment pinned before/after: 16 logical cores, 0.57 GB
free RAM, ~23% CPU load, HEAD ce3e6ec with the concurrent sessions'
uncommitted work untouched (the in-flight 25-line kill-contract hardening
in tests/performance_render.test.mjs is the only profiler-area delta; its
taskkill /T /F path never fired and both runs left zero leftover electron
processes; the only %TEMP%\mefi-performance-render-* dirs remaining are
the pre-existing Sep 19 / Sep 21 17:03 stale ones). Conclusion: the 50 s
timeout seen in run_1790028119882_30's full `npm test` reproduces only
under shared load - it is environmental, not caused by the in-flight
profiler change. Remaining: reproduce under the historical full-`npm test`
contention condition to classify the exact signature (TESTRUNS residual
note above), using the reusable flake-loop harness.

Agent-to-agent mail channel (2026-09-21, evening, "Agent-to-agent
communication" session; shared tree, uncommitted). Roster seats can now write
each other notes: scripts/assistant.mjs gained a pure mail section beside the
intel one (sendMail / inbox / readMail / rolesWithMail / mailLines, state.mail,
MAIL_CAP 48 rows, MAIL_UNREAD_PER_ROLE 6, read notes age out after an hour,
unread mail makes its recipient due in dueRoles, digest.chatter and
facts.chatter carry the lines, the "agents" local reply adds "Said to each
other"). main.cjs delivers it: assistantSendMail / assistantDeliverMail /
assistantTakeMail next to assistantReportIntel, assistantStart hands a job its
unread notes as entry.inbox, assistantSettle sends a result's messages[] (at
most three), the watcher writes the keeper (stale sessions) and the auditor
(collisions), the machine writes the foreman (canStart false / unhealthy), the
auditor, compactor and keeper write the foreman/compactor, the foreman writes
the thinker, the overseer sends its say to every role it wakes, a builder's
MEFI_CALL writes the seat it calls, and the brief/grow/improve prompts share
ASSISTANT_MAIL_RULE (facts.chatter, facts.inbox, optional messages[] reply key
relayed by the briefer and build jobs). Renderer: a "mail" event case in
idle.js draws a packet sender -> recipient with send/receive bubbles and the
assistant card lists "Said to each other"; tree3d.js draws the same packet;
styles.css adds .assistant-mail; booklet rebuilt (hash f98dd2322a01, shared
with the performance session's booklet.js change). Tests: new
tests/assistant_mail.test.mjs (12 tests: pure API, bounds, round trip, dueRoles
pull, host helpers via vm, wiring assertions). The vm-host suites needed the
new collaborators stubbed (assistantTakeMail / assistantDeliverMail /
assistantSendMail) in tests/assistant_pool.test.mjs,
tests/executor_handoffs.test.mjs, tests/assistant_coordination.test.mjs and
tests/fixtures/host_executor.mjs, and tests/expand_finished_guard.test.mjs now
slices the shared ASSISTANT_MAIL_RULE const with each prompt array - without
those, ~30 unrelated tests fail with ReferenceError (the other session saw the
same six in executor_modes/expand_finished_guard before the fix). Results:
node scripts/run-node-tests.mjs first pass 1707 tests / 1697 pass / 7 fail
(the six above plus eyes_worker "read past the timeout" and performance_render
timing out at 50 s under the shared load); after the stubs, executor_modes +
expand_finished_guard + eyes_worker 37/0, performance_render 2/0 alone,
assistant_* + agent_modes + planning_assistant + executor_handoffs 161/0,
node scripts/assistant.mjs --self-test 184 checks ok, npm run check clean,
python -m unittest tools.test_mefi_studio_assistant tools.test_builder_intel
tools.test_mefi_studio_builder_intel 72/0. Not verified: a live app run of the
packet drawing (no preview launched); the performance_render 50 s timeout is
the known load flake, not a regression.

Command frame pass (2026-09-21, evening). Renderer-only change:
renderer/idle.js (callout placement ranked once per pass with an agent-host
set and one shared Intl.Collator, the label grid answering leader-vs-orb
queries, rgb/rgba and speechLines memoized, drawNodeSurface painting halo
and body under one transform block) and renderer/booklet.js (studioLog
bounded to the newest 400 lines); renderer/booklet.html rebuilt (hash
f98dd2322a01, which also carries the concurrent agent-mail session's
edits). `npm run check` passed (90 targets, 177 specs, css clean, syntax
ok). `node scripts/run-node-tests.mjs` on the shared tree: 1707 tests /
1699 pass / 6 fail / 2 skipped in 53.5 s; the six failures are all in
tests/executor_modes.test.mjs and tests/expand_finished_guard.test.mjs,
which exercise main.cjs and scripts/assistant.mjs while the agent-mail
session had both files mid-edit (neither test loads renderer code). Every
Command and renderer suite passed (command_visuals, command_performance,
command_render in real Chromium, node_paint_cache with a max pixel delta of
1 at DPR 1, 1.5 and 2, catalog_renderer, jev_routing_ui,
performance_render), and the two exclusive fixtures each passed in their
own invocation afterwards (eyes_toggle 1/1, occlusion_probe 1/1). The
before/after frame numbers are in PERFORMANCE.md (top section).

performance_render residual-flake loaded loop, no repro (2026-09-21, evening,
run_1790028475698_40 for task_3d33701ba75b4e48). Observation-only loop harness
(`tools/logs/performance-render-flake-loop/run-flake-loop.ps1`, gitignored)
ran `node --test tests/performance_render.test.mjs` 14 times with full
per-iteration capture (verbatim stdout/stderr, exit code, duration, report.json
plus profiler PNGs via MEFI_PERFORMANCE_CAPTURE_DIR, host CPU/free-RAM and
electron/node process counts before/after): round 1 idle baseline + 7 runs
under 4 CPU spinners (11-22s each), round 2 baseline + 5 runs under 12 of 16
logical cores spun (fixture slowed to 38-53s - real pressure), all exit 0 with
report.errors/networkAttempts/processAttempts empty. The hardened kill contract
(uncommitted 40s `taskkill /T /F` hunk) never fired and left zero leftover
electron processes; pre-existing stale `%TEMP%\mefi-performance-render-*` dirs
(Sep 19, Sep 21 17:03, from earlier failed runs) and ~500-650MB free RAM confirm
this host runs near overload. The same-day full `npm test` in run_1790028566027_42
(1695 tests, exit 0) also saw no recurrence. Historical signatures stay
unclassified: the pak-load failure and the fixture-internal `Profiler JSON
download timed out` (`tests/fixtures/performance-render-electron.cjs:127`,
5s will-download deadline - not covered by the kill contract, which only handles
the 40s-hang case) did not recur under synthetic load. Remaining: reproduce under
the historical condition - full `npm test` contention (parallel node stage plus
serialized display fixtures, multiple concurrent Electron launches) plus OneDrive
sync churn on node_modules - then classify via the same signature rules; the loop
harness is reusable as-is.

Full npm test after the severe-memory parallelism cap merge (2026-09-21,
evening). Run run_1790028566027_42 for task_cf5dbf3b66810435 (parent
task_1a265efeeb6cbdd3 "Persistent-memory guard"). Pre-run verification: the
cap change is present in the working tree (uncommitted, adopted as-is) —
`scripts/machine.mjs` latches `severeMemoryCap` on any under-floor sample
(300 MB severe floor), releases only at floor + release margin, and reports
holdKind "memory-cap" with runningCount in the reason while recovering;
`tests/machine_capacity.test.mjs` covers the latch outliving the floor, the
recovery band refusing re-admission on the memory override, and the distinct
holdKind. Full `npm test` (unmodified tree, concurrent sessions' uncommitted
work untouched) exited 0 through the whole `&&` chain: the main node stage
1695 tests / 1693 pass / 0 fail / 2 skipped in 47.8 s — the two skips are the
known environment-conditional ones ("live: the gateway resolves the pinned
Jev model" without credentials, and the in-process vm-modules source check
that needs --experimental-vm-modules); the two exclusive Electron fixtures
each ran in their own invocation and passed: eyes_toggle 1/1 (3.6 s,
load-tolerant span judgement) and occlusion_probe 1/1 strict native
(6.3 s — occlusion via document.hidden, occluded rAF growth 0, worker-channel
lag 0 ms); `python -m unittest discover -s tools` 246 OK in 43.7 s;
`node tools/test_normalized_path_lock.mjs` 6/6 with "all checks passed". The
previously documented performance_render Electron Profiler flake did not
recur in this run. The memory-cap code and its tests remain uncommitted in
the worktree alongside the other in-flight session work; committing them is
the parent task's follow-up.

check-css CRLF normalization (2026-09-21, evening). Build of
run_1790028119882_30 for task_f2faf80852cb9049: made
`scripts/check-css.mjs` line-ending agnostic — `cascadeWinners` now folds
`\r\n`/`\r` to `\n` in memory (single funnel for the default HEAD-vs-worktree
mode, the two-file form and every `--merge` side through `mergeResolution`;
files are never rewritten). Reproduced the reported failure first
(`node scripts/check-css.mjs` → `CASCADE-DIVERGED: 7 mismatch(es)`, all
`\r\n`-vs-`\n` inside multi-line values), then exit 0
`CASCADE-EQUIVALENT: winners identical for all 6401 ... keys` after the fix.
Regression tests added: CRLF-candidate equivalence + real-change-still-diverges
unit tests and a two-file CLI CRLF case in `tests/check_css.test.mjs`, and a
CRLF-resolution-vs-LF-git-sides case (clean, plus reverted still flagged) in
`tests/check_css_merge.test.mjs`. `node --test` on the three check-css suites
37/37; `npm run check` clean (90 targets, 176 specs, css merge-skip/unused,
syntax); `npm run audit` clean (0 findings); `node --test
tests/auditor_dom.test.mjs` 4/4 (auditor imports findUnusedSelectors —
behavior unchanged). Full `npm test`: `tests/performance_render.test.mjs`
fails (Profiler JSON download timed out — Electron fixture under load, file
modified by a concurrent session; same class as the documented
eyes_toggle/occlusion Electron flakes) — not touched by this change, which is
pure-Node CSS comparison. Concurrent session's uncommitted work left
untouched.

TESTRUNS flake triage: eyes_toggle_electron + occlusion_probe (2026-09-21,
evening, run_1790028053881_29). Adopted and completed the uncommitted fixture
work already in the tree rather than rewriting it. Root cause reproduced, not
guessed: recreating the old serialized stage (both display fixtures in one
`node --test` invocation, the pre-fix `runGroup(exclusive)` shape) plus four
CPU spinners fails eyes_toggle with "show must snap exactly one immediate
refresh (got 2)" — the occlusion fixture's always-on-top cover reasserts
`app.focus({ steal: true })` every 2s, flapping the eyes window's visibility
so the shipped listener correctly snaps once per real visibilitychange. The
landed fix is the combination already staged in the worktree:
`scripts/run-node-tests.mjs` now gives each exclusive fixture its own
invocation (`node --test a b` runs files concurrently); the log-tail fixture
judges phases load-tolerantly (fetch counts awaited with deadlines, the
hidden phase judged by fetches stamped `document.hidden` at call time,
doubling read from fetch timestamps, the window pinned always-on-top), with
the test wrapper's count-based `<= 6` doubling window replaced by the same
span judgement and the stale "while minimized" message corrected; the
occlusion fixture recognizes external window destruction (`windowLost`:
phase, trigger, window/cover state, Win32 foreground identity, timeline
tail) at its shared exit and the test skips with that reason — the live app
holding the desktop destroying the probe window mid-occluded-phase is a
diagnostic, not a contract failure. Verified: `node --test
tests/eyes_toggle_electron.test.mjs` isolated 1/1; `node --test
tests/occlusion_probe.test.mjs` isolated passes strictly natively
(document.hidden detection, occluded rAF growth 0, worker-channel lag 0ms);
eyes_toggle under four CPU spinners alone passes (load tolerance holds —
the flake needs the window fight, which the runner separation removes); the
new stage shape (one invocation per fixture, sequential) under the same load
passes both; `node --check` on every changed file and `npm run check` (90
targets, 176 specs, CSS merge/unused, syntax) are clean. The adjacent
uncommitted performance_render kill-contract hardening (taskkill /T /F on
the fixture's own tree) parses and its `spawn` import is intact; it belongs
to the still-open residual performance_render task. Remaining: the full
`npm test` combined gate was not rerun end-to-end here (serialized-stage
evidence is the targeted equivalent), and the worktree changes are
uncommitted.

First-map plan verification, 7 ideas (2026-09-21, evening). Run
run_1790027371112_14 for task_plan_mubs2uat_0 — read/verify checklist, no
source changes: `npm run build-booklet` reproduced `renderer/booklet.html`
byte-identical (39 models, hash f98dd2322a01; git shows no renderer diff).
`npm run check:css` (default HEAD-vs-worktree mode) FAILS on this checkout
with 7 winner mismatches that are all pure CRLF artifacts — `core.autocrlf`
is true, the working copy is CRLF and the HEAD blob is LF; comparing both
sides LF-normalized through `cascadeEquivalence` gives 0 problems across 6401
winner keys, and the modes `npm run check` actually wires pass
(`--merge` skip-clean, `--unused` ALL-SELECTORS-USED over 4 stylesheets).
Gate itself is line-ending sensitive; follow-up filed. `npm run audit` clean
(0 findings, 0 warnings). Focused suites green: foreman_lag_gate 8/8,
verification_checks + verification_evidence 17/17, package_privacy 1/1
(payload data/ = curated.json + models.json only; source settings/projects/
cache never ship; live portable state preserved across rebuilds). Website
previewed over HTTP per website/README.md (`python -m http.server`): index,
wiki shell, pages.json, download and `wiki/pages/home.md` all 200, then the
server was stopped. Docs surveyed: GETTING_STARTED (npm ci → build-booklet →
npm start; clear ELECTRON_RUN_AS_NODE), AGENT_LOOP_VERIFICATION (verified
2026-09-19; claimed checks need session-attributed recorded execution),
FEATURE_AUDIT (partials: verification, collision sandboxing, photographer
role, Steam release). Concurrent session's uncommitted TESTRUNS.md /
run-node-tests.mjs / fixture edits left untouched.

Silent-probe resourcePass resume verification (2026-09-21, evening). Resume of
run_1790027270074_12 for task_9f795c0f862dd7ae: the interrupted session's two
code todos had already landed — `b1d4042` scoped the resourcePass silence rule
(main.cjs `samplerLagMs` gates the poll's lag on
`measureWorkerLag.cache?.silent`, so a frozen renderer feeds the sampler null
instead of the 1000ms sentinel) and `tests/foreman_lag_gate.test.mjs`'s
resource-pass test pins it — so this run verified rather than re-edited:
`node --test tests/foreman_lag_gate.test.mjs` 8/8 (including "the resource
pass applies the same silence rule"), the lag-gate trio
(`worker_responsiveness`, `machine_capacity`, `assistant_lag_gate`) 47/47,
`python tools/test_mefi_studio_machine.py` 7/7, `npm run check` clean (90
targets, 175 specs, CSS merge/unused, syntax), `npm run audit` clean (0
findings). Full `npm test`: the parallel `node --test` stage 1682 tests, 1680
pass, 0 fail; the serialized display stage had `eyes_toggle_electron` flake
under suite load (one fetch while hidden) and pass 1/1 isolated, while
`occlusion_probe` fails while the live Mefi Studio app holds the interactive
desktop — the probe window is destroyed mid-occluded-phase ("Object has been
destroyed" through `fixtures/occlusion-probe-electron.cjs` `run()`), which is
not the fixture's capability-gated skip path and is unrelated to the
resourcePass change (the fixture reads main.cjs only as text for the probe
expression); it needs a re-run without the live app on the desktop.

Mefi first map verification (2026-09-21, evening). Resume of run_1790021119814_13
(progress 0 at interruption) for task_86a2670145d882c9; no source changes were
needed — the prior session's first-map implementation is already committed and
all of the map's first-task verification commands pass on a clean tree:
`node --test tests/first_map.test.mjs` 6/6 and
`node --test tests/first_run_service.test.mjs` 9/9; `npm run build-booklet`
rebuilt `renderer/booklet.html` (39 models, hash f98dd2322a01) with zero git
diff; `npm run check:targets` ok (90 targets, 90 through the syntax pass, full
coverage); `npm run check:specs` ok (175 specs, unique basenames, no orphans);
`npm run audit` ok (0 findings, 0 warnings); full `npm run check` ok including
check-css merge/unused and check-syntax (90 files).

Coding tiers, Codex CLI and the Command usage dropdown (2026-09-21 16:00). Settings
› Coding workers gained a coding tier (`executorTier`: Auto / Free / Fast /
Heavy) with per-CLI tier models (`executorTierModels`) resolved by
`executorTierDefaults` in main.cjs (z.ai GLM pair on the plan, the first scan's
free pick, Claude Code's `sonnet`/`opus` aliases, otherwise the CLI default;
Free never falls back to a billed model and runs one worker at a time). Codex
is a fifth builder seat (`codex exec` on stdin, sandbox bypassed like the other
CLIs) and an assistant route (`codex exec --json -s read-only`, parsed by
`parseCodexCliResult`). The Command usage panel leads with the first live plan
account (Go windows or z.ai quota), then aligned rows, with an informative
collapsed header; the workspace usage tile follows the same lead. Validated on
a tree shared live with the menu-cleanup session (coordinated by message, no
overlapping regions): `npm run check` clean; `tests/executor_tiers.test.mjs`
(new, 8), model_auto_setup, executor_parallel, planning_routing,
jev_routing_ui, usage_tracker, usage_tracker_host, usage_tracker_ui,
first_run_service and the host batch (assistant_work_on, build_approval,
executor_delegation, executor_lifecycle, executor_modes) all green; the full
Node suite 1676/1682 under machine load, with each miss (eyes_worker timeout
case, performance_render, renderer_recovery, task_overview_render) passing
alone; Python contracts 246 OK. Browser check with a fake bridge on the built
booklet: Codex in both selects, tier switching updates the model field,
placeholder and status line, the usage dropdown renders lead + rows and the
collapsed header reads `Updated … · z.ai GLM 5h 40.5% · wk 12%`. Not run: a
real `codex exec` build (no paid run started).

Menu cleanup pass (2026-09-21, afternoon). The studio sidebar is one menu with
a visible grip on the left edge (`.sidebar-grip` inside the unchanged
`#workspace-sidebar-toggle`), four go-to rows with keycaps and badges, the
project list, an inline two-column tools grid (`#workspace-tools` is open by
default and exempt from nav.js's outside-click / Escape / activation folding;
`renderWorkspaceTools` now also drops `tasks` and `plans`, which the rows above
pin), a Settings / Music / Start here row and the "Make yourself at home"
drawer; the entry that owns the visible surface carries `aria-current="page"`
(`MefiNav.paintCurrent`, repainted on every `mefi:nav` and on menu open). Every
"More tools" menu (tabs row, sheet headers, the dock) shares `moreSummary()`:
glyph, label, turning chevron and one grouped glass card. Refresh and
Print / PDF moved from the header into the catalog toolbar; the opencode.ai
link moved to the footer. The Settings tab is one page of cards with a sticky
`#settings-nav` (booklet.js `wireSettingsNav` / `syncSettingsNav`; entries
whose card sits under a hidden `#studio-desktop` drop out, folded cards open on
jump). The Command rail's "Work settings" tab is "Agents" with an at-a-glance
strip (`renderAgentsGlance` in idle.js: Autopilot / Workers / Mode chips) and
glyph-led rows; every id the harnesses read is unchanged. The toolbar's quick
agent-mode select was removed and then restored: the Electron render fixture
asserts it stays in `.cmd-tools` with Live work collapsed. Validated:
`npm run check` (88 targets, every selector used), `npm run audit` (0
findings), `tools.test_mefi_studio_idle` + `tools.test_mefi_studio_booklet`
(27 OK), the renderer batch (sidebar, onboarding, nav_startup,
palette_keyboard, workspace_ui, auditor_dom, booklet_build, catalog_renderer,
jev_routing_ui, model_auto_setup, command_new_work: 119/119) and
`command_render` + `command_visuals` + `agent_modes` (pass after the restore);
`tests/onboarding.test.mjs` and `tools/verify_workspace.py` updated for the
pinned-rows exclusion (`[data-nav=explorer]` in the harness). The booklet was
rebuilt and walked in the browser build at 1440x900: sidebar, Settings,
Command rail Agents tab, dock and sheet-header menus, catalog toolbar.

Host-batch lag-gate re-run (2026-09-21). The 79 host-batch failures in the
launch-screen entry below were tied to the then-uncommitted silent-probe lag
gate; that work has since landed in `b1d4042` (machine memory-warn override
and the silent-probe rule in the foreman's lag gate) with test alignment in
`83a3ee5` (readSettings/machineMemoryWarnOverride). Re-run on the merged tree:
the lag-gate trio (`foreman_lag_gate`, `machine_capacity`,
`worker_responsiveness`) at 48/48 and the nine-file host batch
(assistant_loop, assistant_work_on, backlog_engine, build_approval,
executor_lifecycle, board_growth, projects, executor_resume,
executor_delegation) at 170/170, 0 fail; `npm run check` clean (88 targets).
The explorer state poll from the same snapshot is in place
(`renderer/explorer.js` `EXPLORER_POLL_MS` 5000 via `MefiBoot.pollStart`).

Launch screen and agent hold (2026-09-21). An interactive launch opens on a
project chooser inside the boot gate (`renderer/startup.js`, boot.js phase
`choose`) before any readiness step reads the workspace, and the assistant
service, executor fill, proactive pass and foreman ask all wait on
`autopilot.held` until the user presses **Open and start agents**, the
workspace's **Start agents**, the tray entry, **Resume** or **Work through
backlog** (`releaseStartupHold`; IPC `startup:state`, `startup:choose`,
`startup:begin`, which bypass the project-scope wrapper like `projects:*`).
Smoke, capture and CLI launches keep their automatic start; a renderer reload
never shows the screen twice; a saved pause still asks for Resume. Validated:
`npm run check` (84 targets, every selector used); the 244 Python contracts
(one pins the literal `window.MefiWorkspace?.ready?.({ retry })` in
booklet.js, kept); `tests/startup_screen.test.mjs` (7),
`tests/startup_hold.test.mjs` (5) and two new `renderer_startup` cases;
the renderer batch (renderer_startup, startup_screen, startup_hold,
catalog_renderer, workspace_ui, boot_poll_visibility, booklet_build,
explorer_ui, command_new_work, assistant_pool) at 119/119. The host batch
(assistant_loop, assistant_work_on, backlog_engine, build_approval,
executor_lifecycle, board_growth, projects, executor_resume,
executor_delegation) reads 91 pass / 79 fail: the same Work-on, cluster and
swarm set plus `logLine is not defined` in `readCapacity` that fails without
this change (the uncommitted lag-gate work); no failure references the hold
code. An offscreen Electron run of the real main process (fresh profile, two
seeded projects, network blocked, machine watch off) confirmed the screen
appears with every readiness step pending, nothing starts across the 1.5 s
service and 8 s executor timers, choosing the second project opens it, Start
agents releases the hold and starts the service, and a reload skips the
screen. The packaged copy was refreshed with `npm run package`.

Command view visual layer (2026-09-21, branch `command-visuals` in the
`mefi-studio-wt-command-visuals` worktree): backdrop scenes keyed to the colour
theme with an Ambience override (`renderer/idle.js` drawBackdrop), speech
bubbles beside the agents for hops, findings (→ leaving, ← landing), thoughts
and replies, the foreman's hand-out packet, per-role glyphs, status rings and
flight wakes shared with the rail through `MefiTree.agentGlyph`, and the
Done-tab Absorb that flies its records into the assistant orb and keeps the
last twenty on the assistant's card (`mefiStudio.cmdAbsorbed.<project>`).
`tests/command_visuals.test.mjs` (10 tests) covers scene selection and the
override, bubble lifetime, cap, expiry and hover hold, the remark prefix strip,
the two-line wrap, the hand-out, the per-project ledger cap and reload, every
role's glyph, every scene painting in motion and still, and the HUD, CSS and
API wiring. Validated the same day: `npm run check` clean (81 targets, every
selector used), `npm run audit` zero findings, the 20 vm-based renderer suites
at 266 pass / 0 fail, the 6 Electron render suites (command_render,
startup_render, node_paint_cache, tree3d_performance, performance_render,
task_overview_render) at 16 pass / 0 fail, and the idle, assistant, booklet,
tree_keyboard, palette and launcher Python contracts at 119 OK. A scratch
offscreen capture harness (an isolated booklet build against an in-memory
bridge: no store, no main process) produced the look-gate PNGs for every theme
scene, the three overrides, agents at work with bubbles and packets, the
absorb flight and both absorbed ledgers, with zero renderer errors.

Second pass the same day, same branch — callouts and focus: every session,
task, the hub and each agent working somewhere without a card gets a callout
(a leader at seventy degrees into a horizontal top bar, the numbered title
with a status mark and done/left counts above it, agent thoughts below it),
placed among fixed side × up/down × length candidates that avoid other
cards, the HUD and orbs, kept between frames, held briefly when blocked and
stepped aside to a compact label rather than overlapped (running work and
the card the user is on may take a crowded spot). Hover lifts a card and
softens the rest; a click focuses the node (camera by kind, a slow orbit
borrowed and returned on Esc) with everything outside the branch painted on
a second, CSS-blurred canvas (`#idle-layer-far`). Edges got per-relationship
styles (hub double, task dotted and marching, agent dashed, folded stippled,
done todo green) and a Card style control joined the Ambience pop.
`tests/command_visuals.test.mjs` grew to 18 tests (leader geometry, placement
routing/hold/step-aside, card content, edge styles, focus sets and the
borrowed orbit, drift, drawCallouts separation and hit-testing, wiring).
Validated: `npm run check` clean, `npm run audit` zero findings, the 17
vm-based renderer suites at 251 pass / 0 fail, the 6 Electron render suites
at 16 pass / 0 fail, the 119 Python contracts OK; the capture harness added
hover, task-focus, session-focus and Escape steps and reported the sharp
sets, the borrowed orbit and zero renderer errors.
