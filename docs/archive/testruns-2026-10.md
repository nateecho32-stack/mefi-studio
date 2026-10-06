# TESTRUNS.md archive, 2026-10

Rows that rotated out of the live region of `TESTRUNS.md` (the dated rows
above its `## Read Before Any Tests` guide, where only the newest rows
stay). `scripts/rotate-testruns.mjs` moves each row here verbatim as one
block - heading, H3 subsections and unheaded paragraphs together - newest
first. The frozen archive below the guide in `TESTRUNS.md` stays there.

## 2026-10-04 Today in both modes closer to the 0.5 prototype: Build's Home and Vibe's board

Branch `ui/today` in `C:\wt\ui-today` (off land/ui-chrome 74bf360,
node_modules junctioned), pushed as wip/ui-today: 0b52d4c Build's Today
(Home with no session open: the greeting and "What's next for <project>?",
Home's own box borrowed with Add files or an image, the permission mode,
Talk it over and Build it, the starters and Suggest a next step, Needs you,
Running now, Finished while you were away; the classic Home is the route's
"chat" view), 75b3dfa Vibe's Today (the prototype's board: four columns that
say when they are empty, a waiting card as its session, results under
Review, Build it with its key, "Today, the board").

`npm run check` ok (271 targets), lint 0 errors (no warning in the touched
files), `npm run audit` 0 findings. `npm run test:fast` at 0b52d4c's tree
under heavy load: 6950 tests, 6926 pass, 14 skipped, 8 fail, 2 cancelled,
all in six host suites that took 700-860 s each (attempt_review_host,
attempt_snapshots_host, git_actions, pc_vault, rust_parity_git,
rust_parity_repo): 137 tests, 134 pass, 3 skipped, 0 fail alone.

Full `npm test` at 75b3dfa: Node 6952 tests, 6934 pass, 14 skipped, 4 fail
(attempt_review_host 2, attempt_snapshots_host, rust_parity_snapshots,
sync_changes: 63 tests, 60 pass, 3 skipped, 0 fail alone); Electron lane 75:
72 pass, 1 skipped, 2 fail, layout_contract_render (viewport 1921x1081) and
shell_render ("373 !== 372" at 1100 px), both as on clean main on this PC;
sessions_render (with its new Today gallery: Build's Today at 1920x1080 and
1100x720, 600x560 at 1 and 1.5, Vibe's board, every text 12 px or more and
4.5:1 in all eleven themes for both) and today_render pass; Python 248 OK
(1 skipped); path lock ok.
Captures (1920x1080) in `C:\wt\gap\after-today\final\`, prototype-left
side-by-sides in `C:\wt\gap\after-today\compare\`.

## 2026-10-04 The v2 Settings, first run and plan draft page land on main

Branch `land/ui-settings` in `C:\wt\land-ui`: origin/main 349802a with
wip/ui-settings cd17a4f merged file by file (CHANGELOG keeps both sides'
entries; TESTRUNS keeps every row of both, checked heading by heading, with a
row main had rotated left in the October archive only; booklet.html
regenerated).

Full `npm test` on d2d5ae4 (a Today agent's fixture ran beside it for its
first minutes): Node 6950 tests, 6934 pass, 14 skipped, 2 fail, both pass
alone: rust_parity_snapshots (3/3; under load one side's 10 s `rev-parse HEAD`
timed out and made its start picture without a parent: same tree, other
commit id) and sync_changes (5/5; a push to a local bare repo failed under
memory pressure). Electron lane 76: 72 pass, 1 skipped, 3 fail:
layout_contract_render and shell_render (as on clean main on this PC) and
tree_dynamics_render, which fails now and then on this PC (failed once alone
here, then passed 3 times alone; the branch's own run saw it fail on c01604e
too). Python 248 OK; path lock ok; `npm run audit` 0 findings; `npm run
check` ok. Side-by-sides: `C:\wt\gap\after-settings\compare\`.

## 2026-10-04 The v2 Settings, first run and plan draft page closer to the 0.5 prototype

Branch `wip/ui-settings` (worktree `C:\wt\ui-settings` off main c01604e,
node_modules junctioned), three commits: 70bc565 Settings filed into the
prototype's places (booklet.js, styles.css, template wrappers, report.js),
4ac04f8 the three-step first run (setup-helper.js/.css), 7d268b0 a Backlog
plan opens as its own draft page (planning.js/.css, one line of sessions.js).
New Electron fixture `settings_render` (MEFI_SETTINGS_CAPTURE_DIR); the
setup_helper_render and planning_render fixtures gained a v2 phase each; new
shared `tests/fixtures/text-probe.cjs` (no text under 12 px, 4.5:1 against
what is painted behind it).

`npm run check` ok (271 targets), `npm run audit` 0 findings, lint: no
warning in a changed file. `npm run test:fast` before each commit: 6923/6909
pass/0 fail; 6929/6913 pass/2 fail (attempt_review_host and
attempt_snapshots_host under load: 55 tests, 52 pass, 0 fail alone); 6933/6919
pass/0 fail (14 skipped each). Full `npm test` on 7d268b0: Node 6933 tests,
6917 pass, 14 skipped, 2 fail under load (update_host_bridge 8/8 and
rust_parity_snapshots 3/3 alone); Electron lane 76: 72 pass, 1 skipped, 3
fail: layout_contract_render (viewport 1921x1081) and shell_render (as on
clean main on this PC), tree_dynamics_render (fails alone, and on c01604e
too); command_render 1/1; eyes_toggle_electron 0/1 (fails on c01604e too);
occlusion_probe 2/2; Python 248 OK (1 skipped); path lock ok.
settings_render, setup_helper_render and planning_render pass in the run.
Captures in `C:\wt\gap\after-settings\v2\` (settings, first-run,
plan-draft); prototype captures in `C:\wt\gap\after-settings\proto\`; the
prototype beside v2 in `C:\wt\gap\after-settings\compare\`.

## 2026-10-04 The v2 status bar, Search and one Inbox land on main

Branch `land/ui-chrome` in `C:\wt\land-ui`: origin/main c01604e with
wip/ui-chrome f9e758c merged (only TESTRUNS.md conflicted: both rows kept,
newest first, one more older row rotated). The branch's own run was at
05b5c63; cd4444a fixed what it found (Search's layer kept to the free area,
the Python palette contract), so the whole tree was gated again here.

Full `npm test` on 74bf360: Node 6934 tests, 6920 pass, 14 skipped, 0 fail;
Electron lane 75: 72 pass, 1 skipped, 2 fail: layout_contract_render
(viewport 1921x1081) and shell_render (stops at "it shrinks to leave the main
area its 320: 373 !== 372" at 1100 px), both as on clean main on this PC;
Python 248 OK; path lock ok; `npm run audit` 0 findings; `npm run check` ok
(271 targets); booklet rebuilt with no drift. Side-by-sides with the
prototype: `C:\wt\gap\after-chrome\compare\`.

## 2026-10-04 The v2 chrome closer to the 0.5 prototype: status bar, Search, one Inbox

Branch `ui/chrome` in `C:\wt\ui-chrome` (off land/ui-work-view fe59dd3,
node_modules junctioned), pushed as wip/ui-chrome: 9947295 status bar (the
machine's load from machine:status, the prototype's order, the rule before
the meters, "5 h" and "Week"), 64854cc Search (the prototype's palette over
the same registry: twelve rows, groups, the frame's, strip's, New task and
permission-mode records), 05b5c63 one Inbox (the pill, status bar, Home's
chip, the tabs and the session list's Needs you read one list; the
prototype's cards; Work › Inbox), cd4444a Search kept to the free area and
the Python palette contract updated (both found by the full run).

`npm run check` ok (271 targets), lint 0 errors (44 warnings, none in the
touched files), `npm run audit` 0 findings. `npm run test:fast` at cd4444a's
tree: 6934 tests, 6919 pass, 14 skipped, 1 fail (rust_parity_snapshots
"snapshot host", 73 s under load: 3/3 alone; untouched by this branch).
Python contracts 248 OK (1 skipped) after the palette contract's update.

Full `npm test` at 05b5c63 (quiet machine): Node 6934 tests, 6920 pass, 14
skipped, 0 fail; Electron lane 75: 72 pass, 1 skipped, 2 fail:
layout_contract_render (viewport 1921x1081, as on clean main here) and
shell_render (Search's layer spanned the window; fixed in cd4444a, then
shell_render alone reached and stopped at the known 1 px check at 1100 px,
"373 !== 372", as on clean main); Python 1 fail (the palette contract read
the old span; fixed in cd4444a); path lock ok. Electron suites alone after
cd4444a: sessions_render pass (93 s, with its new chrome gallery: the bar's
order and words, Search's groups and rows, one count everywhere, the Inbox
popover and Work › Inbox at 1920x1080 and 600 px, every text 12 px or more
and 4.5:1 in all eleven themes); today_render (53 s) and tabs_render (118 s)
passed alone before it and in the full run.
Captures (1920x1080) in `C:\wt\gap\after-chrome\final\`, prototype-left
side-by-sides in `C:\wt\gap\after-chrome\compare\`.

## 2026-10-04 The v2 Work view lands on main with Rust stage 2

Branch `land/ui-work-view` in `C:\wt\land-ui`: origin/main 90661df (Rust stage
2's five ports) with wip/ui-work-view 898fe49 merged (only TESTRUNS.md
conflicted: both new rows kept, newest first, one more older row rotated),
plus fe59dd3: a key hint inside a filled button takes the button's ink (New
task's "Ctrl N" was pale on teal, under 4.5:1; shell_frame_css pins it).

Full `npm test` on fe59dd3: Node 6900 tests, 6885 pass, 14 skipped, 1 fail
(project_preview, the whole file in 0.9 s under load: 18/18 alone); Electron
lane 75: 72 pass, 1 skipped, 2 fail: layout_contract_render and shell_render
(viewport 1921x1081, as on clean main on this PC); Python 248 OK; path lock
ok; `npm run audit` 0 findings; `npm run check` ok (271 targets).
sessions_render with captures passes (1/1); 1920x1080 captures in
`C:\wt\shots\land-ui\`, the Work view beside the prototype in
`C:\wt\gap\after-work\compare\`.

## 2026-10-04 The v2 Work view closer to the 0.5 prototype: breadcrumb, list head, run menu, inspector

Branch `wip/ui-work-view` (worktree off main 39d98e3, node_modules junctioned),
five commits: af36359 top bar (the prototype's breadcrumb; a section's pages
as a page list in the list column with Back, Forward and the Git chip's new
"list" look), 7cba1f0 session list head (project menu, Git chip, N worktrees,
plan drafts in Backlog), 30076fc thread and box (head chips, one run menu,
Attach for every purpose), 8520670 inspector (Worktree tab, More, Steps from
runProgress.todos and Acceptance checks, the project's inspector on Home, a
vacant inspector folds away), a4ecc88 a 1920x1080 gallery in sessions_render.

`npm run check` ok (271 targets), lint 0 errors (42 warnings, all
pre-existing), `npm run audit` 0 findings. `npm run test:fast` 6899 tests:
6883 pass, 14 skipped, attempt_review_host "a shot that is slow" and
run_node_tests_fast "--list ... slow reader" (timeout) failed under load and
pass alone (28/28, 2/2). Electron fixtures one by one: sessions_render pass
(project menu, Git chip, run menu at 1920/1440/1100 with nothing under
12 px, Worktree tab, project inspector, the column folding on Work pages),
composer_render pass, today_render pass, worktrees_render pass;
shell_render passes every size config, the walk and the Tab walk (now 28
steps: Home's inspector has the project's controls) and stops at the known
1 px check at 1100 px ("373 !== 372", same as clean main here).

Full `npm test` at a4ecc88: Node 6899 tests, 6882 pass, 14 skipped, 3 fail
(advisory_checks EPERM removing its temp folder, attempt_review_host,
update_rehearsal "Roll back restores...": 26/26, 28/28 and 7/7 alone);
Electron lane 75: 72 pass, 1 skipped, 2 fail: layout_contract_render
(viewport 1921x1081) and shell_render (the 1 px check), both failing the
same way on clean main on this PC; command_render and planning_render pass;
Python 248 OK (1 skipped); path lock ok. Captures at 1920x1080 in
`C:\wt\gap\after-work\` with prototype-left side-by-sides in
`C:\wt\gap\after-work\compare\`.

## 2026-10-04 Rust stage 2: five more modules move into Rust

Branch `rust/stage2-ports` in `C:\wt\rust2` (pushed as wip/rust-stage2-ports):
the Skills page's files (55281f0), a message's pictures (cd8cc2c), attempt
snapshots (0ff6869), settings + keys + projects (1435ae9), and the Git chip's
host layer with git-link's describe and chip (c5a1e03), each behind a
Rust-backed factory in scripts/rust-modules.cjs, each with its parity test
(rust_parity_skills, rust_parity_images, rust_parity_snapshots: twin repos
with a fixed clock give the same commit ids; rust_parity_settings: main.cjs's
own settings code from its text against Rust on twin userData folders;
rust_parity_git: describe on about 830 sets of facts and 28 host steps on
two boxes with the fake gh). `mefi-core repo-batch` now answers a
{ $mefi: "fn" } argument with null and lists its calls.

Full `npm test` on c5a1e03: Node 6899 tests, 6885 pass, 14 skipped, 0 fail;
Electron lane 75: 70 pass, 1 skipped, 4 fail: layout_contract_render and
shell_render (viewport 1921x1081, as on clean main on this PC),
evidence_capture ("UnknownVizError") and task_overview_render ("No fixture
report"), both while another worktree's full run shared the Electron stage:
each passes alone (1/1, 1/1). Python 248 OK; path lock ok; `npm run audit` 0
findings; `npm run check` ok (271 targets). An earlier run on 1435ae9 had the
same picture apart from attempt_review_host "a shot that is slow" (28/28
alone). A first run was stopped and its children kept running into a second
one: overlapping runs failed to start processes (0xC0000142) and wrote one
log; neither is counted here. `cargo test --lib` 26 pass.

## 2026-10-04 The Studio Daily lands: DevDay branch merged with main, Since you were away

Branch `land/devday` in `C:\wt\devday-land`: origin/wip/feat/devday-2026 (the
daily paper, GPT-6.1 Sol defaults, Codex over app-server, ChatGPT plan
sign-in, Catalog/Performance face lift) with origin/main b98fad5 merged file
by file (main.cjs app-wide channels and the picture-aware assistant body,
agent-profiles FIELDS/providers/vision, main's BOOKLET_INPUTS with the paper's
two files, booklet regenerated, TESTRUNS and archives rebuilt from both
sides' rows with none missing). Two fixes the merge needed: the catalog
toolbar reads --shell-y0 (layout_contract_css), and the catalog folds by its
own width with a container query (size_render: "1100x720@1: the page
overflows", the six columns pushed the document to 1157px). New: "Since you
were away" above the news (scripts/front-page.cjs, main.cjs news:away,
renderer/daily-paper.js band, MefiStartup.pick).

Full `npm test` after the last commit: Node 6882 tests, 6867 pass, 14
skipped, 1 fail (attempt_review_host "a shot that is slow", ENOENT under
load: 28/28 alone); Electron lane 75: 71 pass, 4 fail: layout_contract_render
and shell_render (fail identically on clean main on this PC, viewport
1921x1081), command_render and planning_render (each passes alone); Python
248 OK; path lock ok; `npm run audit` 0 findings; `npm run check` ok (271
targets). The earlier test:fast run on this branch lost 5 git suites to
memory pressure (0.68 GB free; push to a local bare repo failed): sync and
rust_parity_repo 25/25 alone. New suites: front_page 7, news_away_host 5,
daily_paper 10 (3 new). Before/after launch captures at 1920x1080 with a fake
bridge: `C:\wt\shots\launch-before.png`, `launch-after.png`.

## 2026-10-04 Rust stage 1 finished: the host's last Electron gaps, the portable host build and the updater bridge

Branch `wip/rust-host` (main merged at 1178ac7), gated in a short-path
worktree (`C:\wt\rust-gate`, node_modules junctioned). New on the Rust host:
the Media browser as a child webview, evidence shots in a hidden in-private
window, dropped files' paths, the Electron build's page localStorage carried
over once, Zen's desktop audio from WASAPI loopback, did-fail-load,
trashItem, the page's WebView2 profile under userData; `npm run
package:host` builds the portable host layout and `release-updater.mjs` can
install and roll back either kind of build.

Full `npm test` at 087fa29: Node 6788 tests, 6774 pass, 0 fail, 14 skipped;
Electron lane 74: 71 pass, 1 skipped, 2 fail (`layout_contract_render`
viewport 1921x1081 and `shell_render`), and both fail identically on a clean
origin/main worktree (1178ac7) on this PC, so they are this display's state;
Python 248 OK (1 skipped); path lock ok. After the last commits (ca10561):
`npm run check` ok (265 targets), `npm run test:fast` 6788 tests, 0 fail, 14
skipped, `npm run audit` 0 findings, lint 0 errors. `tests/rust_host_bridge`
8/8 (new: Media browser through the shim, drop, localStorage hand-over,
loopback stream), `rust_modules` 5/5 (new: evidence factory),
`package_host` and `update_host_bridge` (new) with the updater suites 48/48,
`rust_parity_git` 2/2 with the PowerShell drive check, host unit tests 15/15.

Live, debug host and then the packaged release build run as an installed copy
(no MEFI_STUDIO_ROOT: found resources/app, ran its own node.exe), each with
`MEFI_HOST_SELFTEST_WEB` against a local page and a scratch userData seeded by
Electron 44: Media browser titles A/B, back/forward, mute, refused mailto:,
close; evidence PNG 1280x800 with no third-party request leaving (the beacon
server saw none from the shot's page); localStorage keys carried (Latin-1 and
UTF-16); a real file dropped through the DevTools protocol got its path; a
clicked getDisplayMedia gave 1 audio track, 0 video, no picker, and peak
0.029 back while the page played a 440 Hz tone at gain 0.03. Release host
build 4 min (2 jobs), portable folder 123 MB.

## 2026-10-03 Rust stage 2: the Git chip's actions move into Rust

Branch `wip/rust-host`, after d428f9d. `scripts/git-actions.cjs` (glance,
glanceMany, preview, save, pushBranch, publish, link, owners, nameCheck,
publishPreview, account, identity) and the git-link/pc-setup/redaction/
share-review rules it reads now have a Rust port in
`crates/mefi-core/src/git/`, reached through the `git-actions` factory under
the Rust host only. New: `jsre.rs` (JavaScript regexes with JavaScript's
meaning) and the `MEFI_STUDIO_RUST_OFF` kill switch.

`npm run check` ok (265 targets); `npm run test:fast` 6773 tests, 0 fail,
14 skipped; lint 0 errors, 42 warnings (all pre-existing); audit ok;
mefi-core 26 unit tests, host 13. Parity: `tests/rust_parity_git.test.mjs`
(2 tests: about 330 pure-helper calls, and 89 steps on two identical
folder trees with a local bare GitHub and a fake gh: every kind of save
row, secrets by name and content, UTF-16 keys, a junction out of the
project, 50/100 MB files, lock retries, merge in progress, push with a
failing and a passing check, a rejected push, every publish path including
resume and a taken name, and link related/unrelated/empty), all identical,
with identical commit ids; `tests/rust_modules.test.mjs` 4 tests. The Git
chip's existing suites (git_actions, git_host, git_link, git_link_host) and
the other three parity suites: 202 tests, 0 fail. Live self-test on the Rust
host: `git:state`, `projects:glance` and `git:save-preview` answered through
Rust (rustCalls core.git.glance 3, glanceMany 1, preview 1); this checkout's
preview (17 rows) and glance were byte-identical JSON to the JavaScript's.
Timing on this checkout: glance about 330 ms and preview about 720 ms in
both (git's own time). `fsutil fsinfo volumeinfo` is refused without admin
on this PC, so the weak-drive check reads unknown in both languages.

## 2026-10-03 Rust stage 2: the store and repo modules move into Rust

Branch `wip/rust-host`, after 80b1e0e. The OpenCode store reads
(`eyes.mjs` worker methods) and `sync.mjs`/`worktrees.mjs`/
`worktree-actions.mjs` now have Rust ports in `crates/mefi-core`, served under
the Rust host only.

Full `npm test` on the store port (node_modules junctioned to the main
checkout, so the Electron lane ran): Node 6765 tests, 0 fail in the parallel
stage; Python 248 OK; path lock ok. Four Electron fixtures failed in the
loaded run: `tree_dynamics_render` and `today_render` pass solo (load);
`layout_contract_render` (viewport 1921x1081, was 1920x1080) and
`shell_render` (373 vs 372 px) fail identically on a clean origin/main
worktree (72c6f58) on this PC, so they are this display's state, not the port.

After the repo port: `npm run check` ok (265 targets), `npm run test:fast`
6768 tests, 0 fail; lint 0 errors, no new warnings; audit ok; 16 mefi-core
unit tests. Parity: `tests/rust_parity_eyes.test.mjs` (4 tests, ~100 store
reads plus the dump and git helpers) and `tests/rust_parity_repo.test.mjs`
(3 tests: sync through clean/behind/check-failed/pushed/diverged/rebased,
lost work found and acknowledged, every worktree action) all identical. On
the owner's 20 GB OpenCode store, read-only: 12 of 12 reads identical;
usageLedger cold 2.1 s vs 3.1 s, warm 22 ms vs ~190 ms. Live self-test on
the Rust host: `eyes:state` and `worktrees:list` answered through Rust
(rustCalls lists eyes.* and repo.sync.sync, repo.worktrees.listWorktrees).

## 2026-10-03 Rust host stage 1 (Tauri) - first gate

Branch `claude/app-migration-rust-b89096` (pushed as `wip/rust-host`), based on
72c6f58. `npm run check` ok (264 targets). `npm test`: Node 6757 tests, 6743
pass, 14 skipped, 0 fail (274 s); Python contracts 248 OK; normalized-path lock
ok. The Electron lane skipped 39 suites in that run because the worktree had no
`node_modules`; with a junction to the main checkout's, `evidence_capture`,
`startup_render`, `task_overview_render` and `command_render` (56 s) each pass
solo. `npm run lint`: 0 errors, no new warnings. `npm run audit`: ok.

New: `tests/rust_host_bridge.test.mjs` (4 tests, no Rust needed: the wire's
tagging, the engine shim over a real pipe against a fake host, the page bridge
built from the real preload.cjs). `npm run host:test`: 13 Rust unit tests pass.
On the host itself, with scratch userData: `--smoke` exits 0 (45 cards, models,
assistant tick 1); `MEFI_HOST_SELFTEST` recorded a 1825x1175 page capture, 40
invokes, 29 channels listened to, live pushes and an accepted toast. Electron
44.4.1 safeStorage round trip verified both ways on synthetic data in a scratch
app folder. No change to what the Electron build does.

## 2026-10-03 Weak-drive check without administrator rights

`fsutil fsinfo volumeinfo C:\` refuses a normal user on the owner's PC
("Error 3", and "Error 5: Access is denied" for `C:`), so the Publish
dialog's weak-drive warning and Set up this PC's exFAT/FAT checks could never
show. Both now ask PowerShell for `[IO.DriveInfo]::new('C:').DriveFormat`,
falling back to CIM `Win32_LogicalDisk` under constrained language mode, with
the 10 s timeout kept. Timed from Node's execFile (4 runs each): DriveInfo
194-315 ms, CIM 369-784 ms, Get-Volume 1139-1667 ms; the CIM fallback under
constrained language 327-362 ms; a missing drive prints nothing (unknown).

`npm run check`, `npm run lint` (no new warnings) and `npm run audit` pass.
`tests/pc_setup.test.mjs` 8/8, including a live query of the system drive
without elevation; `tests/git_actions.test.mjs` plus `tests/git_host.test.mjs`
118/118; `npm run test:fast` 6745 pass, 0 fail, 14 skipped (365 s). Not run
against a real exFAT drive (none on this PC). The Rust port on
`wip/rust-host` (`drive_of`, `rules::filesystem_of`, parity cases) still
runs fsutil and must follow.

## 2026-10-03 Paired restart boundary review follow-up

All three Windows push/PR and Linux PR checks pass at first milestone commit
44e40d0. Its completed 25-file CodeRabbit review raised one minor issue: paired
services stopped before a deferred restart had reached its final checks.
Shutdown now runs after saved-state and existing deferral checks, immediately
before relaunch preparation. A project, game or build appearing during that
await is checked again before the synchronous exit. Restart admission remains
closed through the decision, and close failures prevent relaunch.

34 lifecycle/update/loop tests pass, including paired-close deadline, deferral,
ordering and failure injection. Earlier aggregate and clean-main audio fixture
failures remain recorded; the unchanged candidate retry and exact-head CI pass.
Follow-up check/audit/lint and review/CI outcomes are reported separately.
No renderer, provider runtime, workflow, main merge or release changes.

## 2026-10-03 Paired workers review milestone - aggregate and baseline comparison

Corrected slice: 22 focused tests pass; real HTTP loopback and Git/Node run the
six fixed Studio checks at exact commit ae5f26c in a fresh checkout. Check,
audit and build pass; lint has 42 baseline warnings and no errors. Real Chromium
pairing/recovery UI passes at desktop and 600px with a simulated bridge.

Corrected npm test exits 1: 6,824 Node tests, 6,807 pass, one Command musical-
movement fixture failure, 16 skips. Python runs 248 tests OK with one skip;
all six normalized-path lock checks pass. The same unchanged candidate's
isolated Command fixture then passes 1/1. Clean main ae5f26c also fails that
fixture's musical-geometry checks, establishing a baseline instability on this
desktop. The prior preserved candidate's complete aggregate passed 6,801/6,817
Node tests with 16 skips plus Python and locks. Red logs remain preserved;
neither the fixture nor unrelated music runtime was changed or disabled.

CodeRabbit completed reviews of 11 tracked files and then all 24 staged files
twice, raising 6, 2 and 3 issues. Valid issues are addressed with focused tests;
bounded Previous/Older progress pages and persisted-grant late-result
reconciliation resolve suggestions without unbounded lists or repeated jobs.
Final follow-up review and exact-head CI outcomes are reported separately.
Desktop limitations: compositor occlusion unavailable and synthetic native
Ctrl+W unverified. LAN/cross-network, AI editing and terminal-job retries remain
outside this first check-worker profile; no live owner grants were activated.

## 2026-10-03 Paired worker recovery and bounded history qualification

Corrected candidate: 22 focused coordinator/worker/desktop/UI tests pass. Real
temporary HTTP loopback runs all six Studio checks at exact merged commit
ae5f26c, without changing source or creating a production pairing. Persisted
start grants fence late-success reconciliation; pre-start expired jobs cannot
claim success. Failure injection proves archive append retries are idempotent,
command deadlines settle and hold recovery, and shutdown/restart admission is
bounded. Progress retains only 20 displayed lines with previous/next navigation.
Check and audit pass; offline lint retains 42 baseline warnings and zero errors.
The preserved first candidate passed the full Node/Electron, 248 Python and
six normalized-lock checks; the corrected aggregate run is reported separately.
CodeRabbit completed three reviews (6, 2 and 3 issues). Valid issues were fixed
and tested; history uses bounded pages rather than unbounded append, and late
success requires a persisted grant instead of rejecting every expired reply.
Native UI captures are bridge simulations; LAN/cross-network operation and
distributed AI execution remain unqualified. No live network or owner grants.

## 2026-10-03 Paired repository checks first vertical slice

Isolated opt-in coordinator and worker qualification: 15/15 focused tests pass
with durable queue/registry restart, persisted single start grants, lost reply
reconciliation, stale lease/fence refusal, disconnect abort, bounded transport,
encrypted pairing adapter, and real Git/Node exact-commit checks preserving dirty
source. Real Chromium setup/recovery fixture passes 1/1 at desktop and 600px;
bridge is simulated, zero external network/process attempts. Status stays local
until disclosure; no service or owner grant activates on startup. Detail folds
survive status refresh. No live LAN/cross-network or AI delegation qualification.
Full repository gates are reported separately with their actual outcomes.

## 2026-10-03 - Completed updater review and final channel cleanup

CodeRabbit completed the combined updater delta at 85bc4e6: 21 files reviewed, two minor issues. The channel-toggle cleanup now keeps the switch disabled during checking, downloading, installing or rollback, and the changelog makes deferred artifact publishing explicit. The original three partial review issues were fixed in 85bc4e6. Native screenshot evidence uses an isolated bridge; live update channels, credentials and provider state are untouched.

Final focused tests, generated booklet, checks, audit, lint, exact-head CI and the follow-up review qualify this final small change before landing. The full b481ec0 integration gate and earlier red aggregate remain separately recorded, with their original outcomes and native capability limits.

## 2026-10-03 - Combined updater gate and review follow-up

The combined application head b481ec0 passed the corrected full Windows gate with process-scoped Git trust: 6,796 Node tests, 6,780 passed, zero failed, 16 skipped; 248 Python contracts OK with one skip; six lock checks passed. Its three exact-head GitHub runs passed on Windows and Linux. The earlier failed aggregate remains recorded separately.

CodeRabbit's updater-delta review timed out after 18.5 minutes with three minor partial findings and no completion event. Follow-up fixes add per-version automatic retry backoff, a useful channel-failure message and fallback past unusable package metadata without hiding access failures. Focused updater/boot-health tests pass 48/48; the isolated real-Chromium channel fixture passes, including cancelled consent, missing artifacts and narrow geometry. Final follow-up checks, exact-head CI and a completed review remain required before landing.

Native compositor occlusion is unavailable in this Windows session and synthetic Ctrl+W is not acted on by the native window; those established limitations remain. Screenshots use an isolated bridge and do not change live settings or prove a merge. No workflow, release, credential or provider action is included.

## 2026-10-03 - Combined task-context and update-channel integration

The two application branches are integrated without workflow changes. Both changelog entries and every unique test-history row are retained, and the booklet is regenerated from the combined sources. The rollback VM fixture now supplies the production project-switch state and pins refusal before any rollback side effect.

Focused updater/boot-health suites: 44 passed. Build, check, audit and lint pass; lint retains 42 baseline warnings. The first full run completed: 6,796 Node tests, 6,779 passed, one failed, 16 skipped; 248 Python contracts OK with one skip and six normalized-path lock checks passed. Its sole failure was the CSS CLI Git subprocess refusing checkout ownership, not an application assertion; the unchanged CSS suite passes 14/14 with narrowly scoped Git trust. This failed aggregate is preserved as failed. Corrected full verification and exact-head CI/review are pending before main integration.

Stable remains the default; development requires explicit warning/consent. Development artifact publishing is deferred, so no supported development artifact is promised by this application-only change. No release, provider action, UI-default activation or workflow publication is performed.

## 2026-10-03 - Echo GitHub update channels - unfinished review checkpoint

35 focused updater/channel tests pass, including native-consent cancellation, saved channel, stale responses, stable downgrade eligibility, platform/provenance/hash checks, nested artifacts, interrupted downloads and jobs starting during download. The isolated desktop renderer exercise passed after correcting the fixture's desktop capability and checking actual visibility; screenshots are local evidence. Check and application audit pass. Lint: zero errors, the existing 42 warnings. The full Windows npm test gate is still running and has reported failures in attempt_review_host and attempt_snapshots_host; these are untriaged, so this work is not merge-qualified. The initial restricted-account renderer launch failed; the same fixture ran on the real desktop. Official v0.4.4 was downloaded and verified against GitHub's SHA-256 into a separate folder. Original local state and PR3 were not changed. No release/tag published and no live development opt-in. Remaining: finish/triage full gate, final UI capture, CI and review, then integrate the prerequisite ahead of PR3.

## 2026-10-02 late evening - bounded review and tree harness completion

**Result:** complete affected suites passed (29/29). Paired predecessor/candidate probes demonstrated that fixed sleeps can precede async metadata writes and animation callbacks. The isolated harness waits for durable end-shot metadata and the unchanged >1px movement plus radius-growth criterion, with five-second bounds. Controlled delayed completion and permanent-frame-absence checks are recorded in external evidence. Earlier red aggregate remains preserved; full supervised aggregate qualification pending. Application execution, logging, retention and exports are unchanged from the frozen log-diagnostics candidate.

## 2026-10-02 late evening - memory-only durable-log write health

**Result:** focused Node tests passed (40/40). Executor/work-event append failures remain nonthrowing; later writes recover; fixed channels, saturated counts, detached snapshots, broken clock and Trace success/read-failure metadata covered. Full aggregate and native Trace checks queued until the parent releases the game window. No retention, redaction, export or persistent-log changes.

## 2026-10-02 late evening - Deferred navigation focus source diagnosis and proposed guard

Booklet v3 full aggregate completed with 6760 Node tests: 6743 passed, one Tasks retained-focus assertion failed, 16 skipped. Python 248 OK (one skip), locks six passed, real provider-free Fleet ten steps passed; build/check/audit passed. Active task-new, connected retained summary, unchanged card identity/expansion and changed-card checks match the preserved prior symptom. Booklet remains frozen, unqualified and unlanded. Original inventory run (obsolete wiring/partial packaging fixture plus Plans/tree native timeouts), stopped v2, and all prior failures remain reachable in local evidence. Unchanged tree passed controlled repeat and v3 aggregate; no cause claimed for native timeouts.

Exact production claim() source under controlled frame scheduling demonstrates unconditional task-new focus after later summary/search focus or release. Verified predecessor and booklet v3 navigation bytes match and reproduce the ordering. A separate isolated candidate guards pending initial focus against a newer claim, release, hidden destination or changed active element. Eleven focused cases plus existing navigation/startup/settings contracts passed: 58/58. Unchanged predecessor fails the focus regression cases. Input drafts and valid default navigation focus are covered. Native focus event stack/timing instrumentation and trusted-pointer controlled predecessor/booklet/candidate comparison are prepared, not launched: game owns the native window. Native source-attribution probe remains queued. No production/provider actions, shell default changes, push/merge/release or Library retry. Candidate unqualified pending native attribution and full aggregate; source-level evidence is not a native cause claim.

## 2026-10-02 late evening - Booklet inventory contract adaptation after aggregate discovery

First frozen inventory aggregate exposed five Node wiring cases that still asserted individual builder reads and parallel codeParts lists. Updated those five files plus two Python contract files to read the declared inventory while retaining source membership, startup prefix, module dependency ordering, stylesheet adjacency, fixture coverage and CLI/export contracts. Updated Node suites: 125 passed. Focused Python: 3 passed. Builder/auditor/renderer bytes match the first inventory candidate; original LF/CRLF equivalence evidence remains applicable and preserved. Build/check/audit passed. Full repeated aggregate queued after first frozen run completes; prior failure/source retained, candidate unqualified and unlanded. No runtime, shell-default, production/provider or publication changes.

## 2026-10-02 evening - Isolated booklet input consolidation focused validation

One ordered inventory covers current 76 scripts and 28 stylesheets. Preserved old builder and candidate emitted byte-identical booklet and source manifest under identical LF and CRLF inputs; new build reported changed=false over each baseline output. Five build cases and 31 inventory/source-location/auditor cases passed, including 16 new missing/duplicate/order/foreign-root contracts. Build/check/audit passed. Native and full aggregate remain queued while game owns the heavy window. Isolated candidate unqualified and unlanded; verified detail-action candidate preserved. No provider, production, shell-default or release changes.

## 2026-10-02 late afternoon - Isolated detail-action reply ordering focused validation

129 focused Tasks/groups tests passed, including 16 restore/prerequisite ordering and epoch cases. Controlled actual host handler/gateway/coalesced-send plus renderer reproduction: baseline regressed accepted context version 5 to 4 in both actions; candidate preserved version 5. Memory-only adapter, no production/provider actions. Build/check/audit passed. Native IPC fixture prepared, not launched: parent reserves heavy window for game. Full npm test and real Fleet gate pending; candidate remains unqualified and unlanded. Prior Gather candidate and unexplained focus failure preserved.

## 2026-10-02 — Deferred reference-gather project and generation fences

**Scope:** Separate candidate from fully verified task-open-race; project identity/epoch and gather generation fence replies and save completions. No host cancellation, provider or dispatch changes.

**Results:** 113 focused Tasks/group tests pass, including 16 new gather regressions. Host pool suite exercised unchanged cancellation and queue contracts; exact results in external evidence. Native baseline/candidate cases prepared but not launched while the game owns the window. Full aggregate queued.

**Limits:** Unit bridges only, no production writes or provider calls. Original verified candidates and focus-failure evidence preserved. No publication.

## 2026-10-02 — Pending task-open project and view fences

**Scope:** Isolated candidate derived byte-for-byte from the verified task-card retention source; original preserved.

**Results:** 97 focused Tasks/group tests pass, including six asynchronous open regressions. Native baseline reproduces a same-ID cross-project gather/announcement; native candidate passes six cases. Broader overview/delegation/plan/retention fixture passes on repeat. Build, check and audit pass. Full aggregate pending coordinated window.

**Limits:** Provider-free synthetic bridges, no production actions. Initial native sandbox launch failure and an earlier native retention-focus failure preserved in external evidence; no assertions weakened. No push, merge or release.

## 2026-10-02 - Tasks overview card retention focused qualification

Isolated local/task-card-retention-20261002 candidate, derived from the aggregate-verified Fleet recovery source. Tasks UI and task overview grouping: 90 passed, 0 failed, including unchanged DOM identity, insertion/removal/reorder, grouping changes, focus/expansion, canonical actions, drafts, hidden reopen, stale reads and project isolation. Paired Electron benchmarks and aggregate gate are pending; no performance improvement is claimed yet.

## 2026-10-02 - Fleet read failure and recovery: isolated focused validation

79 focused Fleet model, host, layout and UI tests passed. The real Chromium fixture passed all 25 existing layouts plus cached, unavailable and recovered states at 1440x900 and 600x560, with no page overflow, console errors, network attempts or child execution. Project switches clear all old team content; same-project errors persist across repaint; deterministic deferred tests cover late success, rejection and push ordering. Host run-identity checks remain unchanged. Full aggregate validation follows on the frozen candidate; its separate evidence records the outcome without changing tested source.

## 2026-10-02 - Maxwells-PC task plan provenance focused verification

Source/provenance: local/task-plan-trace-20261002 in the separate mefi-studio-plan-trace checkout at b3a4f468348a4485112c6741026b565f106e9821 plus the aggregate-verified Health candidate. Original checkout and verified UI/loop, recap and Health candidates remain untouched. No commit, push, merge or release.

Change: Task Details reads the current saved destination through its explicit planningId and existing scoped plan read. It labels missing, unreadable, foreign, ambiguous, stale, changed-specification, archived or unapproved context; the recorded brief is not replaced. The existing plan navigation is reused only for an identifiable scoped plan. Plan-only refreshes patch that section in place, retain other detail nodes and note drafts/focus, and move focus off a link if it becomes hidden. No prompt, dispatch, permission, task-store or publishing changes.

Focused validation: 82 Node tests passed, zero failures/skips across task_overview_groups and tasks_ui. Meaningful cases cover explicit association, read-only inputs, foreign and duplicate plan identities, unreadable cached context, legacy scoped plans, missing/large destinations, changed/stale/archive/unapproved context, preserved briefs, existing navigation, plan-only refresh with draft/focus, unavailable/recovery transitions and late prior-project responses. Two initial DOM assertions needed fixture corrections: the UI normalizes placeholder punctuation to an ellipsis, and the existing task controls need the appropriate bridge for a Start action. Stable entry identity and existing task controls retained the intended assertions; corrected complete focused run passed.

Expanded affected suites: 92 tests passed, zero failures/skips across task_overview_groups, tasks_ui, task_groups and task_groups_node_edges. The refresh test follows the visible History-to-Details flow; recovery makes the existing plan link available again without replacing the detail nodes.

The Chromium fixture is prepared for desktop and 600x560 captures of current, changed, missing and foreign links, with text size, horizontal bounds, no overflow, original-brief and navigation-availability assertions. Visual, full aggregate and disposable-profile runtime checks remain pending coordinated server release; no heavy launch was made while game native tests owned the window.

Dependency evidence: frozen Health candidate passed build/check/audit, full npm test (6,661 Node passes, zero failures, 16 skips; 248 Python tests OK with one skip; six path-lock checks), 25 Fleet size/view checks and waited real Fleet 10/10 steps. Its 1,012 source hashes remained unchanged and all test processes drained. Platform limitations remain native Close through synthetic Ctrl+W unverified and occlusion capability unavailable. That prior aggregate does not validate this new renderer change.

## 2026-10-02 - Maxwells-PC advisory handoff progress focused verification

Source/provenance: local/fleet-handoff-health-20261002 in the separate mefi-studio-health checkout, based on b3a4f468348a4485112c6741026b565f106e9821 plus the aggregate-verified recap candidate. The frozen recap source, original checkout and prior UI/loop candidate remain untouched. No commit, push, merge or release.

Change: an informational Fleet Health note for at least three distinct handed-off tasks from one builder seat in the last 24 hours without later recorded verification. It counts task identity rather than event volume, clears verified and human-confirmed child evidence, ignores future or expired events, remains project scoped and opens the source seat through the existing Look action. It describes retained evidence and explicitly says waiting for verification can be normal; no attention-count increase, automatic pause or dispatch change.

Focused validation: 30 Node tests passed, zero failures/skips across fleet and fleet_host. Tests use real board/status/report observations and cover duplicate/title-changed events, pending completion reports, verification and human confirmation, persistence, renewed handoffs, expiry, future events, read-only history and cross-project isolation. The extended Chromium fixture is prepared for desktop/narrow note and inspector screenshots, but was not launched while the game held the shared server window. Required full aggregate and real Fleet verification remain pending coordination; no aggregate validation is claimed for this new batch.

Dependency evidence: the unchanged recap candidate passed build, check, audit and full npm test (6,656 Node passes, zero failures, 16 skips; 248 Python tests OK with one skip; six normalized-path lock checks). All 1,012 tracked files matched the source freeze after the gate. Its synchronous disposable-profile real Fleet check passed all ten steps. The PowerShell GUI launch's initial zero-second entry was replaced with the actual waited child exit and report. Platform limitations: synthetic Ctrl+W did not exercise native Close; Electron occlusion events were unavailable. That evidence belongs to the prior recap candidate, not this new Health change.

## 2026-10-02 - Maxwells-PC Fleet seat recap focused verification

Source/provenance: local/fleet-seat-recaps-20261002 in a separate mefi-studio-recaps checkout at b3a4f468348a4485112c6741026b565f106e9821, with the previously verified UI/loop candidate applied first. The original checkout and mefi-studio-current candidate remain untouched. No commit, push, merge or release.

Fleet recap batch: deterministic recorded history from up to four prior generations, capped at 1,500 characters, shown in the seat inspector and passed to the next assigned worker. Live generations are excluded; interrupted, awaiting-verification and verified outcomes remain distinct; exact repeated handoffs collapse while distinct child identities survive. The full ledger and task history remain intact. Lookup stays project scoped, is bounded at two seconds and fails open for dispatch; no additional model calls.

Focused validation: 148 Node tests passed, zero failures/skips across fleet, fleet_host, executor_core and executor_lifecycle, including cross-project and project-switch isolation, saved interruption/verification history, handoff identity, bounded text/prompt budget, actual prompt delivery, unavailable history and a stalled lookup. Initial new history test needed its active board seed before checking the observed verified transition; corrected focused run passed. Fleet Chromium fixture passed in 31.1 seconds: 25 layout/view combinations across five size/zoom cases, desktop/narrow recap geometry, real inspector content, no renderer errors, network or child attempts. Screenshots retained at 1440x900 and 600x560. Build-booklet, check and audit passed; zero audit findings/errors/warnings. Required full aggregate gate is pending parent coordination of the shared server CPU window; this row does not claim aggregate validation of the recap batch.

Separate live evidence: the unchanged prior candidate passed actual native restart during a real Codex worker, app PID 10360 -> 7212, original app exit 0. Interrupted progress/claims persisted without a failure charge; old worker process tree drained before explicit resume, paused dwell admitted no worker, exactly one resumed worker completed and the actual project check/verifier reached Done/Verified; shipped review Accept ran once. Both workers were sequential and the same one task survived. This used disposable Git/project/profile and existing authorized ChatGPT login. No production tasks, credentials, original checkout, default Classic or release state changed. The complete raw active-native-restart report/controller/screenshots stay outside Git under task-2/evidence.

## 2026-10-02 - Maxwells-PC modern UI and live-loop verification

Source/provenance: isolated branch local/ui-loop-current-20261001 at b3a4f468348a4485112c6741026b565f106e9821. Independently reproduced on the server; Echo's uncommitted patch was unavailable and was not assumed transferred. The installed OneDrive checkout remains clean at 1dd9518be7b8843616cd56778f8d834fcb534e58. No push, merge, release, production restart, credentials or default-setting changes.

Product changes: expanded optional session controls preserve a 60 px conversation area and the draft in short windows, including 150% zoom. A real Codex worker repeated its identical MEFI_NEXT title/brief on stdout and stderr; executor-core now admits that pair once per run while preserving distinct titles or briefs. No other lifecycle implementation changed.

Harness repairs: asynchronous Windows cleanup lets background Git completion drain; cancelled claims wait for the actual dropped event within a bound instead of sleeping 300 ms. Plans reasserts its existing CDP focus emulation before native Enter, preserving the actual focus-paint assertion. The full workspace verifier follows current Agents navigation and compact pickers, the Finish-to-tour flow, completed guide, named decision cards, current Work search/overview/History views, project switching, saveResume reload, and admission semantics. Visibility/hit tests, durable-store checks, scope approval/rejection, worker guards, and renderer-error checks remain enforced.

Final aggregate on frozen source, Node 24.9.0 and Python 3.10: build-booklet, check, audit and npm test all exit 0. CPU: 6599 tests, 6585 pass, 0 fail, 14 skip. Desktop: 62 tests, 61 pass, 0 fail, 1 skip. Exclusive Command and Eyes: 1 pass each; occlusion: 2 pass. Node total: 6665 tests, 6650 pass, 0 fail, 15 skip. Python: 248 tests, OK with 1 skip. Normalized-path lock: 6 checks pass. Node stage 1322 s, Python 53 s, whole npm test 1376 s. No source-drift warning. Audit: 0 findings, errors or warnings. Booklet hash bfe811c509c8.

Complete modern workspace UI run: 17 workflows, 17 screenshots, 1280x720 and 600x760 layouts, 0 external network attempts, 0 coding-worker attempts and 0 renderer errors. The complete Sessions fixture also passes in the aggregate at six sizes with pictures, Accept/Revert/Undo, expanded controls, draft retention, reload, layout-off checks and 32 screenshots. Focused loop/handoff: 79 pass. Focused cleanup/snapshot/CSS: 66 pass, 3 skip.

Real provider probes use the scoped official Codex 0.160.0 CLI and existing ChatGPT authentication: actual greeting edit plus delegated worker and both local checks pass; a real unsupported-model rejection settles without edits, false completion or handoff; stop/save kills a real isolated Codex child, saves pending progress, reopens without a failure charge and pauses admission, then explicit test resume edits and checks successfully. Board/storage, timers, helper delivery and window relaunch are fixture adapters. These probes do not establish a real application relaunch, cross-process database recovery, or provider-backed Done/Accept. No production project/profile was used.

Earlier failures are retained in current-combined.log: Windows cleanup/cancellation timing and default-CLI Git ownership were harness/environment issues; the earlier Plans focus failure used the original fixture and passes after fixture repair. The Git ownership workaround is process-scoped to the verified isolated clone, with no global Git configuration change. The earlier diagnostic source-drift warning is historical; the final aggregate held source still.

Evidence and deliverables remain under task-2/evidence: final gate logs, modern UI report/screenshots, real provider-probe reports and a b3a4f46-based candidate patch. Private CLI logs and production data are not part of the patch or screenshot deliverables.

## 2026-10-01 - Maxwells-PC isolated current-main short-session validation

Source/provenance: independently reproduced on b3a4f468348a4485112c6741026b565f106e9821, branch local/ui-loop-current-20261001. The installed clean OneDrive checkout is 1dd9518be7b8843616cd56778f8d834fcb534e58, an ancestor 290 commits behind; it was not modified. Echo's uncommitted working patch was unavailable. The earlier local old-baseline patch and test counts are historical, superseded by this run.

Change: optional 0.5 session layout keeps a 60 px conversation minimum in short windows with controls expanded. A renderer regression failed before the CSS change at 600x560 and 150% zoom (0 px); after the change, asking and reviewing both retain 60 px and the draft. No lifecycle implementation or app defaults changed.

Validation: Node 24.9.0 portable runtime; booklet bfe811c509c8; check and audit pass. Focused lifecycle/resume/delegation/verification/provider-isolation/updater-continuity suites: 190 pass. Complete standalone session fixture passes at six sizes with Accept/Revert/Undo, pictures, reload, layout-off checks and 32 screenshots; it also passes in the combined gate. Scoped disposable real-app IPC probe passes setup/tour/verify-first persistence, synthetic assistant-message failure with draft/retry retained, and reload with workers paused. External calls and coding workers were blocked. No actual provider delegation or Codex CLI execution is claimed (Codex CLI absent).

The legacy full tools/verify_workspace.py is still red: current agents.js deliberately hides the old Home queue disclosures and settings the verifier clicks. First-run harness assumptions were updated to follow the supported Finish-to-tour flow and saveResume reload path; no workflow assertions were removed. The separate scoped IPC probe does not replace this full workflow gate.

Combined gate results and CPU triage are recorded in the external current-status.json and current-combined.log. Initial CPU stage: 6579 pass, 5 fail, 14 skip; serial triage: 64 pass, 2 fail, 3 skip, retaining a Windows EPERM cleanup and CSS CLI child error. Subsequent CSS solo: 14 pass; direct cascade checker: equivalent. Remaining cancelled snapshot assertion and cleanup failures did not repeat in serial triage. No changes made to snapshot/lifecycle behavior on this evidence.

Evidence: task-2/evidence contains current-session screenshots, current-ipc-probe report, complete gate/triage logs and the final b3a4f46-based patch. No credentials or production profile copied; no push, merge, release or production agent action.
