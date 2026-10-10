# TESTRUNS.md archive, 2026-10

Rows that rotated out of the live region of `TESTRUNS.md` (the dated rows
above its `## Read Before Any Tests` guide, where only the newest rows
stay). `scripts/rotate-testruns.mjs` moves each row here verbatim as one
block - heading, H3 subsections and unheaded paragraphs together - newest
first. The frozen archive below the guide in `TESTRUNS.md` stays there.

## 2026-10-06 Linux CI: My PCs' battery and Resources stop asking Node for the platform

Branch `fix/linux-ci-battery-resources` (b06201c, off main 8f84614, in C:\wt\lxci), with PR #7 open so
studio-linux.yml ran on the branch (it triggers on main pushes and pull requests only). Studio checks (Linux) had failed
on every main push since c4b9e2e (resource_host: the journal after Slow down/Pause, and a launch putting back what the
last Studio held) and 89639b4 (pcs_host: the low-battery handoff, and the stop line with Continue). Both suites play a
Windows PC on any host; the code under test asked Node instead: main.cjs's pcsPowerLook now passes process.platform to
pc-power's readBattery, and resource-host joins its helper's folder with path.win32 when its platform is win32. No test
changed, and Windows behaves the same. Here (Windows): a preload that makes Node report linux and load path.posix
reproduced the four CI failures with their messages, and pcs_host, resource_host and pc_power pass 29 of 29 under it
after the fix; `npm run test:one` over the ten My PCs and Resources suites (resource_helper_win included) 153 of 153;
check ok, lint 47 warnings (as main), audit ok; `electron . --smoke` with a fresh profile 45 cards. Hosted CI on the
branch, all green: Studio checks (Linux) run 37527676158 (PR #7), Node stage 7589 tests, 0 fail, 58 skipped, then the
audit and the Xvfb smoke (45 cards), which had not run on Linux since c4b9e2e because the red Tests step stopped the
job first; Studio checks (Windows) runs 37527647312 (push) and 37527676135 (PR), Node stage 7589 tests, 0 fail, 34
skipped, Python contracts 248 OK, audit and the portable package ok.

## 2026-10-06 The 0.5 polish pass: a full gate, every window failure checked against main, and the fixes

Branches `polish/0.5` (C:\wt\v05, with `polish/names` and `polish/tour` merged in; the owner merged it as #6, feb4a29)
and `polish/0.5-b` (C:\wt\v05b, landed here), found with a fresh-profile run of the real app (C:\wt\probe: isolated
profile, coding CLIs blocked, driven over CDP: every place and page in both modes, 12 themes, interface scale, menus).
Fixed: a blank Studio menu after Social to Studio, Configuration and Friends leaving their layer claims, the old tree
strip over Settings, Plans laid out by its own room, key tips over the welcome, the welcome's AI choice never applied
on Continue (and never re-read after a sign-in in its own window: now on window focus, Check again and Continue),
queued tasks shown as running with agents off, Events in the menu, the Help sheet's links, a place row (picker below
760 px, out of the way below 520 px of height), the first task carried from Start a new app into the welcome,
GETTING_STARTED.md rewritten for 0.5.

Full `npm test` on polish/0.5 (ab7d4ea, about 2 h at 700 MB free): Node stage 7587 tests, 7572 pass, 1 fail (a test
still matching the old setup advice "is selected"; fixed on main as 0c4633c), 14 skipped; Python contracts pass;
Electron lane 69 tests, 62 pass, 6 fail, plus command_render. Each failing window suite then ran alone on a control
worktree of main before the polish (4d23e3c, C:\wt\ctl) and on the branch: all passed on the control, so all were
the polish's. Causes and fixes: the menu's default pin moved to 1600 px changed every fixture's layout at 1100 and
1440 px (Size went to two columns, Home's composer moved with its drawer, the project map's Browse stayed open,
unified_studio's hover dwell) - reverted to main's 1100 px default; Team's place row took the row a 400 px window
needs (agent_setup_render) - picker and short-window rule; the frame's right margin overrode styles.css's narrow one
below 900 px - restored; Size's kept-in-view picture now stays within two thirds of the pane with its caption and
buttons (507 of 715 px before); fixtures that pinned old words (the welcome's titles and buttons, "Folder mapped" now
"Project mapped", the hidden tree strip that command_render waited to see painting on a tab page).

On the landed tree, one window suite at a time under the lease: agent_setup_render (one missed click, then 2/2), project_map_render, size_render, workflow_render, team_render, friends_render, shell_render, settings_render, setup_helper_render, unified_studio_render and command_render (84 s) all pass. `npm run test:fast`:
7589 tests, 7572 pass, 14 skipped, 3 failed under about 400 MB free with the Electron lane busy and all 3 pass alone (paired_reconnect 6/6, resource_helper_win 1/1, rust_parity_git 4/4 in 188 s). `npm run check` ok, `npm run audit` 0 findings. Not run here: a second full `npm test` (the lane
results above cover every suite the fixes touch).

## 2026-10-06 model_performance: the corrupt-ledger race, and the store's cache compares a fresh ledger's bytes

Branch `fix/model-perf-race` (C:\wt\mperf), landed from `land/model-perf-race` (off main 86cfa93, main merged in up to 89639b4). Hosted Windows CI failed "corrupt ledger failures preserve the file and
do not poison subsequent operations" once (run 37455162395 on fx/scaling, attempt 1: "Missing expected rejection" at
line 165; the re-run passed). The test's last outside edit rewrote the ledger in place, on the same inode, at the
very length the store had written ("10" for "0" pays for the store's trailing newline: 1007 bytes both). The store
keyed its cache on `[dev, ino, size, mtimeNs, ctimeNs]`, and file times move once per clock tick (15.6 ms on Windows
by default; that test took 10 ms on the runner). When the store's save and the edit shared a tick, all five fields
matched, `record()` reused the ledger `snapshot()`/`read()` had cached, and it resolved. The store now follows git's
racy rule like `settings-cache.cjs`: for 2 s after the file's mtime or ctime, a cache hit reads the file and compares
bytes before reusing the parsed ledger; past that the five fields decide alone (`racyMs: 0` turns it off). The
corrupt-ledger test is unchanged; the external-edits test now asserts its ctime-only case instead of skipping it;
two new tests hold the file times in one tick and pin the check and its off switch.

Loops, one `node --test --test-name-pattern="corrupt ledger" tests/model_performance.test.mjs` at a time under a
suites lease. Old store: quiet 34/200 failed, all at line 165 (a later quiet run 0/200: the file clock here steps
1 ms while an app holds a fine timer resolution); 15 spinning threads 0/200 (load spreads the steps over ticks);
with a preload rounding `fs.promises.stat` file times to 1 s, 98/100 failed at line 165. Fixed store, test
unchanged: 1 s rounding 200/200 passed; quiet 200/200; 8 spinning threads (holding the Electron lane, so no fixture
ran beside them) 100/100. `snapshot()` on a 10,000-row ledger (4.57 MB): a miss ~110 ms and a settled hit ~5.8 ms
as before; a hit within 2 s of a change ~15 ms against ~6 ms (one async read and a byte compare). `npm run check` ok, `npm run audit` 0/0, eslint clean on both files, `npm run test:one` on the 14 suites that reach
the store (model_performance, learning_host, model_routing, model_routing_evidence, model_win_evaluator,
planning_routing, usage_tracker_host, task_cap_host, kind_routes_host, jev_model_routing_host,
explicit_route_fallback, builder_thinking_host, build_home_host, ai_route_gate): 201/201. Not run: the full
`npm test` (hosted CI runs the Node stage on the branch).

## 2026-10-06 My PCs: the owner's PCs live, splitting the queue, and a laptop that hands off on low battery

Branch `feat/my-pcs` (C:\wt\pcs, merged with main twice in C:\wt\pcs2: the CHANGELOG kept from both sides, the
relay import line, its README row and hub_client's hello assertion kept from both, `renderer/booklet.html` rebuilt,
not merged). New: scripts/pc-trust.cjs, pc-fleet.cjs, pc-power.cjs, pc-handoff.cjs, relay/src/pcs.mjs,
renderer/pc-fleet.js, docs/my-pcs.md; main.cjs "My PCs" block plus small guarded hooks (spawnNextJob's "battery"
stop, applyKeepAwake, hubInstance's onEvent, hubPresenceWanted, startPcs at boot, pcs:* IPC); backlog.workState's
moved card and battery/friend/came-back holds. The push guard in attempt_snapshots_host now lets a branch be named in
full (`refs/heads/`, the handoff branches) and still refuses every other ref. Kill switch `MEFI_STUDIO_NO_PCS=1`.

Measured: the four modules take 18.6 ms to require, so they load on first use; one battery read is one PowerShell
call (3.3 s wall on this laptop at 392 MB free; it read 61%, on battery), every 3 min above 40%, 1 min under, 30 s
under 25%, 5 min on mains, 30 min without a battery.

`npm run check` ok, `npm run audit` 0 findings, eslint on the changed files 0 new problems (main.cjs keeps its 5
older warnings). New suites: pc_trust 7, pc_power 7, pc_fleet 12, pc_handoff 4 (real git: park leaves the tree,
index and HEAD alone; pick-up claims once; a clash stays on GitHub), pcs_host 7 (several PCs in vms on a fake relay:
pairing by the six numbers, a stranger refused, a low battery moving two cards that come back done, a full PC
declining, work started elsewhere and refused for a closed project, an unpaired sender refused, the stop line and
Continue, a friend's lent PC holding the task), pc_fleet_ui 7, relay_pcs 9, hub_client_pcs 7. On the merged tree
through `npm run test:one`: 247/248 across hub_host, hub_client(_pcs, _remote), relay_core/e2e/connect/pcs/events/
credits, pcs_host, pc_fleet_ui, pc_sync_ui, pc_remote_ui, paired_worker_ui, module_purity, booklet_build,
remote_host, cowork_host, link_compat, paired_reconnect, hub_rooms; the one failure was pcs_host removing a PC's
temp folder while a write was pending (fixed: cleanup waits; then 7/7 four runs in a row, after its waits became
"until the delivery lands"). Electron, one at a time: companion_hub_render, friends_render (no text under 12 px at
four sizes), paired_worker_render, friends_two_render 4/4. A first full `npm test` on the pre-merge tree was stopped
in the Node stage after 91 min at 392 MB free: its one real failure was the push guard (fixed); rust_parity_*/sync
suites ran 25-70 min each and failed on time limits under that load (the known pattern), not rerun here. Hosted CI
(ci.yml, Windows) green on 69cf256 (8 min 12 s); then main moved (Resources, Other apps): merged with both
sides' blocks kept, and 327/330 (3 skipped, 0 failed) here across app_wide_ipc, preload_fanout, module_purity,
booklet_build, the pc_* and pcs_host suites, hub_host, remote_host/admission/gate, studio_api_*, resource_*,
resources_ui, settings_nav, backlog_engine and attempt_snapshots_host. Not run here: a real two-PC or laptop-battery test (owner).

## 2026-10-06 Other apps: the Studio API, MCP server and skill, and the setup prompt

Branch `feat/studio-api` (C:\wt\apilink), merged with main twice (the CHANGELOG kept from both sides,
`renderer/booklet.html` rebuilt, not merged). New `scripts/studio-api.cjs` (pure rules),
`scripts/studio-api-server.cjs` (127.0.0.1 endpoint and key file), `scripts/studio-link.mjs` (the MCP server and command
line apps run), `renderer/studio-api.js` (Settings › Other apps) and main.cjs "Other apps"; work an app files carries
`origin.via = "app"` and waits for the owner's OK in every mode.

`npm run check` ok, eslint on the changed files no new warnings, `npm run audit` 0 findings, booklet byte-identical to
a fresh build. Through `npm run test:one` on the final tree: studio_api_rules 8, studio_api_server 9, studio_api_host 8,
remote_gate, remote_admission, remote_host, module_purity, settings_nav, app_wide_ipc, preload_fanout, booklet_build and
setup_helper, 191/191; settings_render (the new place at four window sizes, every theme) 1/1. Hosted Windows CI green on
e35b1db. The full `npm test` here, run while other sessions held the PC, failed only in suites that fail under load or
on clean main: the git-heavy attempt_review_host, attempt_snapshots_host and board_store passed alone (220/220 with the
rest); shell_render and performance_render passed alone; task_overview_render and unified_studio_render fail the same
way on clean main 593633a (C:\wt\apimain); rust_parity_git and the Python `electron . --smoke` launcher test (a 120 s
timeout, clean main timed out too) and the real-OpenCode routing test (OpenCode itself timed out) are load. Live: the
MCP server under `ELECTRON_RUN_AS_NODE=1` with Studio's own electron.exe answered initialize and tools/call; the
card was checked in the browser pane (switch, five connect rows, Copy setup prompt, Show it, a note's toast).

## 2026-10-06 Resources: the resource manager for other apps, manual and auto, gated in C:\wt\resmgr

Branch `feat/resource-manager` (C:\wt\resmgr) off 4b150b3, main merged in up to 86cfa93 (one CHANGELOG conflict,
both sides kept; the booklet regenerated after each merge, identical to the auto-merge). New:
`scripts/resource-rules.cjs`, `resource-host.cjs`, `resource-helper.cs` (C#, built once with Windows' csc.exe),
`renderer/resources.js` + `.css`, `docs/resource-manager.md`; `main.cjs` loads the host on first use.

Proof: `npm run check` ok (300 targets, 614 specs); `npm run audit` 0 findings; eslint on the changed files: no new
warnings (the 6 it prints are old lines in main.cjs and nav.js). New suites: `resource_rules` 17/17,
`resource_host` 15/15 (a scripted helper over fake pipes), `resources_ui` 11/11, `resource_helper_win` 1/1 (builds
the real helper and slows, pauses, refuses, adopts after a kill, restores on stdin close and ends a throwaway
process; 10 s). On the merged tree, 25 files through `npm run test:one`: 428/428 (the four above plus alerts_wiring,
report_wiring, shell_frame_bars, shell_frame_wiring, app_rail, module_purity, log_core, booklet_build,
booklet_inputs, machine_kill_host, executor_resume, nav_startup, nav_focus_claim, palette_keyboard, settings_nav,
preload_fanout, auditor_dom, explorer_ui, layout_contract_nav, tabs_host, type_into_menu). Python contracts 248 OK
(1 skipped). `npm run test:fast` before the merge: 7416/7437; the alerts_wiring miss was this change (its quit hook
sat between two lines that suite pins together; moved below `outsideWorkQuit`), the rest were git_actions, sync and
rust_parity_git/_repo/_snapshots cases running 1-10 minutes each on a PC with about 400 MB free; none touches a file
of this change, and hosted CI runs them. `shell_render` (walks every destination, the new page included):
1/1 pass in a real window (161 s). Hosted CI on the branch: Studio checks green in 9m11s on f8d3f0e (run 37482793905: build-booklet diff, check, lint, the full Node stage with the git and Rust parity suites, the Python contracts, audit, packaging); main merged again up to 86cfa93 after it (docs, release workflow and TESTRUNS only).

Measured on the 16 GB laptop (506 processes, 46 apps): helper start 52 ms, first snapshot 0.77 s (file details,
cached after), then 15.8 ms per snapshot round trip and 2.6 ms of rules; about 16 KB per page push, every 2 s and
only while the page is on screen (held while the window is hidden); the helper holds about 18 MB.

Seen in a fake-bridge preview at 1440x900 and 640x800 (no horizontal overflow). Fixed there: an option or switch now
carries its `selected`/`checked` attribute (MefiPatch keeps choices by markup, so the settings showed their first
option), and the search box no longer stretches across the tools row.

Not run: the full `npm test` (the Electron lane apart from shell_render).

## 2026-10-06 Your PCs and Friends reconnect by themselves; only a Studio that is really behind must update

Branch `wip/auto-reconnect` (C:\wt\reconnect), landed on main as 7718e36 (rebased three times as main moved; the
CHANGELOG kept from both sides and `renderer/booklet.html` rebuilt, not merged). New `scripts/link-compat.cjs`
(protocol windows for paired PCs and the relay); paired checks start again by themselves after a restart, update or
crash and back off while the coordinator is away; Friends gets "Reconnect by itself", a retry on wake, and the relay's
hello window. The relay change is not deployed by this landing: the live relay drops the new `oldest` field (checked
against HEAD's protocol.mjs), so today's Studio and this one both connect until it is redeployed.

`npm run check` ok, eslint on the changed files 0 problems (main.cjs keeps its 5 older warnings), `npm run audit` 0
findings, booklet byte-identical to a fresh build. Through `npm run test:one` on the rebased tree: the affected and
overlapping suites 135/135 (link_compat, paired_reconnect, paired_worker, paired_worker_lifecycle, paired_worker_ui,
hub_client, hub_host, relay_core, relay_e2e, friends_front_ui, rooms_ui, project_hub_ui, playlists, friends_render);
before the playlists rebase 177/179 across 26 suites incl. paired_worker_render, friends_render, friends_two_render
and companion_hub_render, the 2 failures being paired_reconnect's own fixed-sleep waits under load, rewritten to wait
for the poll, start and abort (then 6/6 on every run that got a lease turn; 3 of 5 back-to-back tries timed out
waiting for the lease, not in the suite). paired_worker's heartbeat test now uses a 40 ms lease (it took 30 s once a
missed heartbeat stopped aborting at once). paired_worker_render captures the Start by itself switches and "Studio
0.4.6 (older, still connects)" fitting a 600 px window. Hosted CI (ci.yml, Windows) green on 6445219 (7 min 10 s),
3a4c7be (7 min 23 s) and the landed 7718e36; after the last rebase 52/52 again here (hub_host,
paired_worker_lifecycle, paired_reconnect, link_compat, hub_client), since main.cjs moved under it. Not run here: the
full `npm test` (CI is the full gate) and a real two-PC test (owner).

## 2026-10-06 The release workflow's hosted gate, smoke launch, signing switch and Rust-host switch; the 0.5 scope refreshed

Cloud session, branch `claude/funny-einstein-19ljkq` (436fd2c, a45cc38) on main fa672de. `release.yml` now holds
`docs/release-workflow-signpath.yml` (removed) and the PC's patch 575579f from `wip/release-yml-host-switch`, joined
where they meet: every package-release call passes the resolved host, the folder lookup matches it, and the smoke
launch gives the Rust host MEFI_STUDIO_USER_DATA and reads its stderr. Nothing ran: the workflow starts only on a
`v*` tag or a dispatch, and neither was made.

Why the hosted gate matters, measured: `ci.yml`'s `npm test` on main 4ce5657 (run 37476474394) skipped 46
real-window tests (the Electron lane's 43 of 69 and 3 serialized), because `scripts/fetch-electron.mjs` leaves the
binary out when CI=true. `release.yml` fetches it before `npm test`, so its full gate runs them on the hosted runner.

Here (Linux, Node 24.21.0): PyYAML parses the workflow (22 steps, in order); `tests/release_workflow.test.mjs` 6/6
through `npm run test:one`, and six mutations of the workflow (TAG_HOST, a signing step's if, --skip-build, the
test:fast step, the smoke pattern, a branch trigger) each fail it; `npm run check` ok (296 targets, 609 specs);
`npm run lint` 47 warnings, as on main, none in the new file; `npm run audit` 0 findings; `npm run test:fast` 7422
tests, 7364 pass, 58 skipped, 0 fail (2 min 38 s); Python contracts 248 OK (3 skipped); the normalized-path lock ok.
Not checked: the workflow on a runner, and the Rust host's smoke launch there (WebView2 on the runner, and
Start-Process -Wait on its child processes); the first `host: tauri` dispatch shows both.

My merge of `ui/social-studio-names` 0fc3043 was dropped before pushing: main's 0f5076a carries the same change.

## 2026-10-06 Background git leaves no fsmonitor daemons, and Claude workers start only the desk's MCP servers

Branch `fix/git-fsmonitor-worker-mcp` in `C:\wt\fsmon`: the 2026-10-03 commit c575fd3 (left on one PC in `C:\wt\mem`,
260 commits behind) replayed onto main 539fb8f. One conflict, `cliInvocation`'s Claude line, which main had given live
progress and the thinking flag: `--strict-mcp-config` sits beside them. Added since: the `MEFI_STUDIO_WORKER_OWN_MCP=1`
switch and its pin, a live-mode pin, a `sync` test (git reports `core.fsmonitor=false` in a repository that turns it on),
and the same override in the Rust ports (`repo::run_git`, `git::run`'s `child_env` for git children, `eyes::git`).
The memory figures (nine daemons at ~44 MB from one worktree list; ~380 MB of the owner's own MCP servers per Claude
worker) are the 10-03 measurements, not taken again.

CI `Studio checks` (Windows: check, lint, `npm test`, audit) green on 7a034f1, the same change on main 4b150b3.
Local, with mefi-core built from this branch (`CARGO_TARGET_DIR=C:\rt\fsmon`): rust_parity_repo, rust_parity_git,
rust_parity_eyes, executor_core and sync 86/86, none skipped. `npm run check` ok on 539fb8f. An earlier local run
(executor_core, executor_live_progress, executor_worktree, git_actions, sync x5, outside_work x2, usage_tracker_host,
eyes x3) had one failure, `sync`'s session-hook test, where `git config` hit runGit's 30 s limit with 128-617 MB free
and eight sessions' tests queued; it passed in the 86/86 run.

## 2026-10-06 The rail's words are whole, and its places are checked at every window size

Branch `ui/rail-words` in `C:\wt\modes` on main 4b150b3: 0f5076a (the Social/Studio launch hint, "Each launch opens
the mode you last used", which main's merge of the rename did not take) and f9fb916 (at rest the rail keeps 4 px at
its sides instead of 10 and a tile 2 px, so a word has about 51 px instead of 39; the rail's 64 px is unchanged).

Measured in a real window (`shell_render`, new section 2b, Studio's rail at 1920x1080, 1440x900, 1100x720, 600x560 and
600x560 at 150%): before, "Settings" needed 43 px and had 39 at the three larger sizes (Segoe UI), and every place was
reachable; after, no word is cut and every place's middle is the place itself at all five sizes, with Segoe UI and with
Verdana standing in for Linux's DejaVu Sans. Social's Home has no rail (a question for the owner, not changed here).
The whole `shell_render` passes on this branch (214 s), the new section included; `skills_render` 1/1.

`npm run check` ok, `npm run audit` 0 errors and 0 warnings, `npm run lint` 0 errors and 47 warnings (as main).
shell_frame_css, shell_frame_bars, layout_contract_css, app_rail, vibe_home, vibe_panels, vibe_frame, booklet_build
and size_page: 182/182.

The skills landing (d55269f) said six of its window suites were still queued: all passed afterwards on its tree, one at
a time: today_render (67 s), skills_render (27 s), composer_render (47 s), autonomy_render (17 s), agent_setup_render
(45 s) and unified_studio_render (190 s), with team_render and sessions_render as reported.

Incident on this PC, 08:26: removing a throwaway worktree with `git worktree remove --force` followed its node_modules
junction into the shared node_modules and deleted @electron/get, @electron-internal/extract-zip, @types/node, debug and
Electron's chrome_100_percent.pak and chrome_200_percent.pak before a locked DLL stopped it. Restored by 08:31 from
Electron's download cache and an `npm ci --ignore-scripts` scratch copy; all 15 lock entries match, `electron.exe
--version` is 44.4.1 and window suites pass again. A window suite that failed oddly on this PC between 08:26 and 08:31
should be run again.

## 2026-10-06 A test stage that runs past its limit is stopped with everything it started

Branch `wip/test-speed` (C:\wt\speed), main 017d51a merged in. Overnight an economy-events gate held the machine-wide
Electron lane about nine hours: media_window_render and layout_contract_render each kept an Electron window alive
after their own kill timers failed (29 to 300 MB free), so `node --test` never finished, until killed by hand.
run-node-tests now gives each stage a limit (scripts/test-lease.mjs stageLimitMs: 120 min for the parallel stage,
90 for the Electron lane, 30 for each exclusive fixture; MEFI_TEST_STAGE_LIMIT_MIN) and past it ends the stage's
whole tree (killTree: taskkill /T, three tries, then SIGKILL), names the suites still running and fails the stage.
test_lease.test.mjs no longer spells a fixture name, so it runs with the quick suites and in test:fast.

Tried and dropped, measured alone: running the parity suites' JavaScript and Rust halves side by side.
rust_parity_repo went from 115 s to 75 s, but rust_parity_git from 78 s to 366 s with a failure (both halves start
many processes at once; at ~500 MB free a filesystem check timed out), and at the 4-wide width this laptop usually
gets, the parallel stage is bound by total work, which side-by-side halves do not reduce.

`npm run check` ok, eslint on the changed files 0 problems, `npm run audit` 0 findings, hosted CI (ci.yml, Windows)
green on e2eb757 in 7 min 9 s. `npm run test:fast` here at 4 suites at a time (223 to 510 MB free while other
sessions ran Electron suites through the lease): 7409 tests, 7392 pass, 14 skipped, 2 fail plus one cancelled, all
process-heavy suites under that load: git_actions "a push maps sign-in and network failures", project_preview "a
real npm preview process reaches readiness" and rust_parity_repo "sync answers the same". Alone through `npm run
test:one`: 85 of 86 pass; rust_parity_repo's sync test hit its own 240 s timeout again at ~200 MB free (it passed
in 115 s on main's copy earlier today, and this branch does not touch it). The new suites pass:
run_node_tests_stage_limit (a copy of the runner meets a suite kept alive by a child that never ends: stopped in
about 5 s, named, the run failed, the turn given back, no process left) and test_lease 13/13.

## 2026-10-06 Sharing playlists in rooms and on the Project hub lands on main

Branch `feat/playlists-share` in `C:\wt\playlists` (aadb6ad; parked first as `wip/playlists-share` 48e3a8a), rebased
onto main e0e5a46 with the CHANGELOG kept from both sides and `renderer/booklet.html` rebuilt, not merged. No relay
change and no deploy: a room gets the share text as a message, the hub a YouTube `watch_videos` link.

On this PC: `npm run check` ok (296 targets, every selector used), eslint on the touched files adds no warnings (the
5 in main.cjs are older), `npm run audit` no findings. Node, run together: playlists 16/16 (4 new), rooms_ui and
project_hub_ui (one new case each; the HUB_PROJECT_METHODS pin now reads playProject: 2 and pins the `here` rule),
music, booklet_build, together_ui, friends_front_ui and every hub_* suite: 234 pass, 0 fail. Windows CI (`Studio
checks`) runs on this commit before the fast-forward. Electron suites were not run here: the change adds no window
fixture and the media ones passed this morning on the same menu; friends_render (12 px text rule) is covered by the
card's 12 px floor in music.css.

Seen in a browser preview of the real renderer files with a stub room service: Share › Send it to friends lists only
active rooms you're in (the Lobby first), Post sent 1,337 characters to the Lobby, the chat card plays and saves once
(then Saved and Open in Playlists), Add to the Project hub sent a 226-character link with a blurb naming the channels,
and the hub shelf offers Save; no console errors.

## 2026-10-06 A way to Routing opens More settings at Routing; the background check reads the Settings strip where Settings shows

Branch `fix/routing-narrow` in `C:\wt\routing`, off main 017d51a. The full Electron lane on main 0b2fa14 (here, one
suite at a time under the test lease) had 43 of 47 ok: command_render and today_render passed alone again (flakes),
shell_render stops at the display-scaling check as before, and unified_studio_render failed every time at
"#ai-role-routine-choice fits in narrow Routing". The Seats and models page (wip/models, 6c9126b) files Routing into
the closed More settings, and go("agents", {pane: "routing"}) left it closed, so the controls were laid out but
folded away (about 5,800 px down, nothing hit). agents.js openTeam now opens More at #settings-routing for a Routing
way in that names no control. The suite then reached its contrast sweep, where `.settings-nav` read transparent:
its solid fill is a container query on the Settings page, and since the window-scroll fix (efec563, bf0d0ce) the tab
pages are not laid out under another page; the sweep now reads the strip with Settings open in the Studio mode and
requires it measured there.

unified_studio_render ok (alone, under the lease); team_render, agent_setup_render, settings_render ok; npm run check
ok; npm run lint 0 errors and 47 warnings, as on clean main 017d51a. Hosted CI (Windows) on ef34f7a: green (37472060180). After merging main 4b150b3 (shell_render at 125% scaling): shell_render ok here, its first pass on this PC, so every window suite is green with this fix.

## 2026-10-06 shell_render passes at 125% display scaling: the inspector check reads the page's own width

Branch `fx/scaling` (on main 017d51a; first proven on 0b2fa14): in `tests/fixtures/shell-render-electron.cjs` the narrow-window
check "it shrinks to leave the main area its 320" compared the inspector with `1100 - 64 - 344 - 320`. At 125% or
150% display scaling a 1100 px content size comes out 1101 CSS px (the fixture's resize already allows exactly that
one pixel) and the inspector takes it, so the suite failed on the owner's PCs even on clean main ("373 !== 372").
The expected width is now `state.inner[0] - 64 - 344 - 320`, the probe's own innerWidth; the rule itself is
unchanged.

Proof on the owner's PC (AppliedDPI 120, 125%), Electron alone: `node --test tests/shell_render.test.mjs` 1/1 pass
(112 s); the same suite on clean main fails at that check. `npm run check` ok. Not run: the full `npm test` (one
fixture line; hosted CI runs the Node stage on the branch and skips real-window suites).
`layout_contract_render` is gone from main with the classic layout; before that it also failed with the fixture
forced to device scale factor 1 ("v1 geometry moved"), so its red on the PCs was not only scaling.

## 2026-10-06 Friends › Events: the community budget, the weekly Build Jam, co-work hours and building together

Branch `wip/economy-events` (C:\wt\econ) off 33c3c4e, main merged in up to 711ceb5 (0d82a1a: seven files resolved by
hand with both sides kept; d1344bc puts the Playlists entry back to once after an earlier merge took 0e9f37f, not
d55269f as its message says). Relay: `relay/src/economy.mjs` (a daily community budget, 200 + 25 per member seen this
week who is old enough to earn) and `relay/src/events.mjs` (the weekly Build Jam, co-work hours at 02:00, 10:00 and
18:00 UTC, building together), run on the relay's alarm; schema v5; credits.mjs gains together, cowork and jam kinds
paid through award(). Studio: hub-client events calls, main.cjs HUB_EVENT_METHODS, preload hubEvents,
renderer/friends-events.js + .css as Friends › Events.

A read-only review of the social side found, in this branch, an alarm that would have woken the relay every second
before each co-work hour and through a pause, a listed co-work room nobody could approve requests for, prizes two
votes could win, and Forget me leaving names in results; all fixed in 113ca61 with tests. Its findings in other
files went to the social session, which landed them on main (711ceb5).

Gate on 132132d (main f1934aa merged): the parallel stage at 4 suites at a time, 7227 tests, 7210 pass, 3 fail, all a
git time limit hit under load (29 to 780 MB free while other sessions ran): git_actions "a listener that throws does
not stop a publish half-way", rust_parity_git "the actions answer like the JavaScript" and rust_parity_snapshots
"the same attempt on two identical repositories". Python contracts 248 OK (1 skipped), normalized-path lock OK,
`npm run audit` 0 findings. The Electron lane did not finish: media_window_render and layout_contract_render each
kept an Electron window alive all night (their kill timers never landed at that memory) and held the machine-wide
lane about nine hours until killed at 06:11 (a stage limit for exactly this is on wip/test-speed). The Electron
suites were then run one at a time on the merged tree 0d82a1a through the lease with a 12-minute guard each:
42 of 47 pass on the first pass (layout_contract_render left out: it fails on clean main here and retires with
ui/v2-only). Of the five: shell_render is the known display-scaling failure on clean main; agent_setup_render and
unified_studio_render fail on main's own renderer too (a control run in C:\wt\speed, at other assertions:
load-sensitive); today_render and tree_dynamics_render, which had run 10 and 15 minutes under load, pass alone
(101 s and 14 s). friends_render, companion_hub_render and friends_two_render pass. The three git time-limit
suites pass alone: git_actions, rust_parity_git and rust_parity_snapshots, 72/72 in 2 min 41 s through `npm run
test:one`.

After the 711ceb5 merge: `npm run check` ok; the relay, hub, Friends and companion suites 169 pass, 2 skipped, 0 fail.

## 2026-10-06 The social review's fixes land with the polish: say what helps, why a play earned nothing, one vocabulary

Branch `wip/social-polish-2` in `C:\wt\polish2`: wip/social-polish (a676b05, Windows CI green) + 67e5898, the fixes from
the "Engine optimization and social features" session's review of the social side (string ids in hub-client; one
hubState() so Connect shows only when it can help; a play's why from the relay to the Project hub; private first
rooms; The Lobby's own nudges, focus kept across reads, calendar days, this week's events row; one vocabulary; 12 px
bubble labels; Play/Star labels; arrow keys in the tab rows; Search words), with main 0661f8c merged (119bc83:
CHANGELOG keeps both sides, TESTRUNS rows from both and main's archived row, rotated; booklet.html regenerated).

Run through `npm run test:one` (the machine-wide test lease) on 119bc83: companion_hub_render, friends_render and
friends_two_render (the two Studios meeting end to end) 1/1 each, rooms_ui, friends_front_ui (13, new: the connection
sentences, the nudges, the events row), project_hub_ui (play reasons), hub_client (17, new: missing ids refused),
hub_host, relay_credits (the play's why), relay_connect, relay_e2e, booklet_build and module_purity: 165 tests, 165
pass. Also pc_remote_ui, pc_sync_ui, together_ui, friends_mod_ui, friends_navigation, relay_core, app_rail,
onboarding and palette_layout_v2 on 67e5898. `npm run check` ok. Windows CI runs the full gate on the landing commit
before the fast-forward; the relay is redeployed with it (front().you.projects and hold, the play's why).

## 2026-10-06 The Social/Studio names, the scroll fix, the social polish and the models page land while the PCs are offline

Landed by the planning chat (cloud, Linux, Node 24.21.0) after the owner's PC became unreachable at 02:35 UTC. Each
branch's tip had green Windows CI: ui/social-studio-names 2ee0106 (merge e2d2034); fix/doc-scroll ace7d22 (efec563,
plus bf0d0ce: the rule split so every selector starts with html[data-frame], the one pin its CI failed);
wip/social-polish a676b05 (1e54cc5; tabs.js keeps main's agents block and takes "lobby"); wip/models bc490ff (6c9126b;
both sides kept in main.cjs, executor-core.cjs, agents.js and build-booklet.mjs, the teamLayout() calls dropped since the
classic layout is gone; d9dad85 updates cli_deadline_host's pin). booklet.html rebuilt after each merge. Hosted Windows
CI green on 1e54cc5 and d9dad85; main fast-forwarded to d9dad85.

Here, as a non-root user under xvfb: npm run check ok, lint 0 errors (47 warnings, as before), audit 0/0, test:fast ok.
Every real-window suite, one at a time, before the merges (55494c6) and after them: agent_setup_render, sessions_render
and today_render failed only after them, each on a fixture that described the old state. Agent setup opened Seats and
models without a target, and the seat rows now fold under More settings (c385a65 names the row, as an old way in does).
Sessions pinned " · Vibe" and "Build · task" (c385a65, 15bfec3). Today asserted that Tab never leaves the document,
which held only because the order walked into the Model catalog's 28 controls under the frame's layers; with
fix/doc-scroll the order wraps once through the document and back to the frame, which 15bfec3 allows, pinning that no
stop lands under the layers. After the fixes all three pass; sessions_render's "the keyboard starts on the open
project" failed once and passed twice, the known flake. Failing on Linux both before and after, and ok on Windows per
the ui/v2-only row: team_render (Providers sideways at 600x560@1.5), unified_studio_render and project_map_render (the
map at 600x560@1.5), settings_render (Report a problem's panels at 600x560@1.5), workflow_render (the authoring layout
at 600) and command_render (task pixels): Linux fonts and software rendering. friends_render and friends_two_render
pass; their screenshots show the open room as a chat app, rooms as cards, each place's own icon, two Studios catching
up after one was away, and no scroll arrow over the status bar.

## 2026-10-06 The social side polished, and two Studios meeting through the relay end to end

Branch `wip/social-polish` in `C:\wt\polish` (bea5ec9 an open room like a chat app, rooms as cards, Friends icons,
plain words; 671b1b8 the two-Studio proof and The Lobby following who arrives), main merged (1de784f, clean;
booklet.html regenerated and equal).

The two-person flow, recorded (tests/friends_two_render.test.mjs, new): one Electron process plays two PCs, two real
windows in the 0.5 layout with their own user data (separate session partitions), each bridge reaching its own copy
of main.cjs's real Rooms hub block, and the real relay between them (relay/node/adapter.mjs: the Worker, the Hub
object, SQLite, scripted Discord). Both meet in The Lobby and see each other online; PC one makes "Two PC test" from
New room and reads its invite code from the room's menu; PC two joins with the code typed in lower case with a space;
they chat both ways with Enter and see each other's face in the room; PC two closes Studio, PC one sends two more, PC
two comes back and the two missed messages are filled in from PC one's copy (the relay keeps none); PC one starts
Listen together and PC two hears the shared player; PC one shares a project from the Project hub and PC two plays it:
the link opens in the browser, two minutes on PC one gets "Someone played your project: +5 credits" and its Lobby
shows 5 credits, PC two's shows 2. 1/1, about 40 s.

Polish checked in real windows (friends_render): an open room with five messages (a mention of this member, one of
someone unnamed, and this member's own) at 1920x1080, 1100x720 and 600x560 at 150%: the room's name once, the chat
taking most of the height, the composer on screen with Send inside it, Load earlier at the top of the log, mentions as
names and "@someone"; every Friends place at 1920x1080, 1440x900, 1100x720 and 600x560 at 150% in Chrome, and every
place plus an open room in a light palette, with no text under 12 px and nothing wider than the page.

Run alone here on the merge: friends_render, companion_hub_render, friends_two_render and unified_studio_render 1/1
each; rooms_ui 14/14, friends_front_ui 12/12, friends_mod_ui 4/4, friends_navigation 8/8, project_hub_ui 7/7, app_rail
40/40, onboarding 43/43, tabs_strip 66/66, module_purity 63/63, booklet_build 5/5, hub_host 14/14, relay_connect 6/6.
`npm run check` ok. Windows CI runs the full gate on the landing commit before the fast-forward.

## 2026-10-06 The studio log kept on disk and Trace's Load older (S2) land on main

Branch `land/s2-log` in a cloud session (Linux, Node 24.21.0), stacked on S12 over main f1934aa (first gated over 00d32ca): the parked "not
shippable" slice 9782c8c re-applied (one conflict in traceRead, both sides kept) and finished (2611874): main.cjs's "Log
core" block, which the WIP's hooks called but never had (lazy require, the core opening 1.5 s after ready, early lines
bounded at 5,000, smoke and capture launches under their own profile, worker output and assistant ticks at debug
level); a fix in segment-archive.cjs (a month whose index was lost was invisible to reads until its next seal; open()
now re-indexes it from the members' headers); and Trace's Load older (renderer/trace.js, template, booklet rebuilt).

Logging cost (main.cjs's own logLine and "Log core" code, a 200,000-line burst, two rounds): 2.9-4.3 us per logLine
on the main thread before, 5.4-6.0 us after; total CPU 0.55-0.87 s before, 1.74-1.83 s after with the async writes
and credential masking; 15.5 MB of segments, 1.22 MB once sealed (12.7x); newest 250 lines 5.4 ms (14-15 ms from a
sealed archive), a problems page 15-20 ms, a page 90% back 51-60 ms. Kill switches MEFI_STUDIO_LOG_CORE=0 and
settings.logs.keep false (memory only, as before), settings.logs.level for the threshold; all pinned.

`npm run check` ok, `npm run audit` 0 findings, `npm run lint` 0 errors and 45 warnings (as main). `npm run
test:fast` with mefi-core built, on the final tree: 7270 tests, 7234 pass, 34 skipped, 2 fail: rust_parity_git's two, as on clean main
with the same binary (for the Rust chat). New: segment_archive 15/15 (a crash after each of the six seal steps keeps
every record exactly once and the month zcat-readable, a half-written member past the index, torn lines, month
rollover, a lost index readable at open, the lock, the exit path), log_core 9/9 (with local-dirs: OneDrive refused by
env and by segment, case-blind on Windows, the userData fallback), log_core_host 7/7, trace 9/9 (+ Load older);
alerts_wiring and report_wiring keep their start order. Python contracts 248 OK (3 skipped). Electron under xvfb as a
non-root user: startup_render, renderer_startup and renderer_recovery 21 pass, 1 skipped.

## 2026-10-06 Live CLI progress and prompts a provider can cache (S12) land on main

Branch `land/s12-cli` in a cloud session (Linux, Node 24.21.0) over main f1934aa (first gated over 0b051b8; merged with skills everywhere, whose loaded skills stay beside the system prompt while the transcript moves to the user text): the parked "not shippable" slice
f7c8f42 re-applied by hand (main's worker prompt, tool loop and Codex app-server harness had moved), finished and
tested (5ddb52d). Fixed on the way: a fresh Claude session UUID per attempt (the WIP reused one, which Claude Code
refuses on a retry); live progress decided for every run so a CLI fallback attempt streams too; picture messages keep
the old tool-loop order; seat fallbacks receive the user content so a tool round's transcript survives them.

Prompt size (tests/prompt_cache.test.mjs, the prefix two consecutive requests share; no prompt got longer): two
workers' prompts 5 -> 4,241 of 4,615 characters; two chat turns (30-card board, 16-message thread) 12 -> 4,128 of
4,167; two tool rounds with a 3,080-character user message 3,292 -> 6,373 of 6,499. Kill switches
MEFI_STUDIO_PROMPT_CACHE=0 / settings.ai.promptCache false (every old byte back) and MEFI_STUDIO_LIVE_PROGRESS=0 /
settings.executor.liveProgress false (text mode), both pinned. Live progress was checked against Claude Code
stream-json and codex --json event shapes in fixtures, not against a real CLI run here.

`npm run check` ok, `npm run audit` 0 findings, `npm run lint` 0 errors and 45 warnings (as main). `npm run
test:fast` with mefi-core built: 7129 tests, 7093 pass, 34 skipped, 2 fail: rust_parity_git "the actions answer like
the JavaScript" and "the chip's host answers like git-host.cjs", as on clean main with the same binary (Linux git;
for the Rust chat). New: cli_stream 10/10, executor_live_progress 4/4 (the real spawnNextJob: a chunked Claude stream
sets session, todos, tool and usage, the sentinel counts once, the attempt keeps cliSession and usage; the switch off
keeps the text command line; the app server is untouched), prompt_cache 14/14. Updated pins: agent_tools,
agent_tools_project and agent_tools_skills (read the whole request), mentions_host, tools/test_mefi_studio_routing.py. The executor, agent
tools, task oversight and outside-work suites 658/658 (1 skipped). Python contracts 248 OK (3 skipped).

## 2026-10-06 Test runs take turns on one PC, size to free memory and start the slowest suites first

Branch `wip/test-lease` (C:\wt\coop) off 00d32ca: `scripts/test-lease.mjs` (a machine-wide lease board in
%LOCALAPPDATA%\MefiStudio\test-lease: one Electron lane, two parallel stages, first come first served),
`scripts/test-timings.mjs` (a node:test reporter recording each suite's wall time), and run-node-tests taking a
turn per stage, sizing the parallel width to free memory and ordering every stage longest first. Merged with main
d55269f before landing (712818c): only CHANGELOG.md conflicted (main's file plus this branch's entry).

Full `npm test` on the gated commit f18d18c, on the 16 GB laptop with other sessions working (0.4 to 1.4 GB free):
34 min 10 s in all; full gates here took 45 min to 2 h 14 min before. Parallel stage at 4 suites at a time (561 MB
free when it started; Node's default is 15 here): 7105 tests, 7089 pass, 14 skipped, 2 fail, both Rust parity
suites under load: rust_parity_git "the actions answer like the JavaScript on real folders" (the Rust side's git
call hit its time limit, 298 s) and rust_parity_snapshots "the same attempt on two identical repositories" (a
different start commit; the known under-load timeout). Both pass alone after the gate: 7/7 in 2 min 41 s through `npm run test:one` (the actions test 137 s, the snapshot host test 27 s). Electron lane at 2 windows (1129 MB free):
100 tests, 97 pass, 1 skipped, 2 fail: layout_contract_render and shell_render, the two display-scaling failures
this PC shows on clean main (fx/scaling fixes them; layout_contract_render retires on ui/v2-only). Exclusive
command_render, eyes_toggle_electron and occlusion_probe pass. Python contracts 83 s OK; normalized-path lock OK.
`npm run audit` 0 findings, `npm run check` ok, eslint on the changed files 0 problems. Hosted CI (ci.yml,
Windows) green on f18d18c in 8 min 56 s. After the merge with main: `npm run check` ok, and run_all_tests,
run_node_tests_fast, test_lease, test_timings, check_targets and spec_collisions 44/44 through `npm run test:one`.

The lease worked live during the gate: a Friends render run started from C:\wt\econ waited in line ("waiting for
the Electron lane, held by C:\wt\coop (npm test: Electron fixtures, running 12 min)") and ran when the lane
freed; a waiter that was killed had its file cleared at the next read.

The first timing record (wall times under this run's load): the 503 Node suites sum to 3179 s, and the top 10 are
69% of it: rust_parity_repo 401 s (its sync test alone 281 s), sync 377, rust_parity_git 331, git_actions 218,
rust_parity_snapshots 186, attempt_snapshots_host 177, worktree_actions 151, attempt_review_host 126, pc_vault 122,
pc_vault_turns 89; the median suite is 0.37 s. The 48 Electron suites sum to 2017 s (layout_contract_render 193,
tabs_render 173, unified_studio_render 149, shell_render 139, sessions_render 128). From the next run each stage
starts its slowest suites first. `npm run test:lease -- --slowest` prints the record.

## 2026-10-06 Playlists in the media menu land on main

Branch `feat/playlists` in `C:\wt\playlists` (9064526: renderer/playlists.js, the music.js hooks, music.css, docs),
rebased onto main d55269f with the CHANGELOG kept from both sides and `renderer/booklet.html` rebuilt, not merged.

Windows CI (`Studio checks`: build-booklet and its diff, check, the full `npm test` with the Python contracts, audit)
green on the first push of the branch (run 37398280329, 7 min 19 s). On this PC, after each rebase: `npm run check`
ok (285 targets, every selector used), eslint on the touched files clean, `npm run audit` no findings; music 123/123,
playlists 12/12 (new), booklet_build, together_ui: 150 pass. Electron, run alone while another session's suites came
and went: media_window_render 1/1 (69 s) and media_browser_render 1/1 (17 s), the two fixtures that open the media
menu. command_render only opens it for the Tree reactions this does not change, and was not run here.

Seen in a browser preview of the real renderer files with a stub bridge: the five starting points with thumbnails,
Make it yours, Share's text round trip (multi-line, one line, the YouTube link alone), Browse's box handing a shared
list to Playlists, Save to a playlist from a Browse card (and Escape closing only it), Play putting 11 videos at the
front of Up next with the playing row marked; no console errors.

## 2026-10-06 Skills everywhere, answer styles and Connectors land on main

Branch `feat/skills-everywhere` in `C:\wt\skills` (fef2aef skills for the chat, the helper agents and the builders,
answer styles with ELI5 the default, `use_skill`, Team › Connectors, the parallel tool loop, the MCP pool and
Streamable HTTP; 6318720 the twelve fixes an independent review found), landed from `land/skills` in
`C:\wt\skills-land` with main merged twice (648e6ea over 00d32ca, 6e11811 over 33c3c4e: no conflicts beyond
CHANGELOG, booklet.html rebuilt) and the release scope updated (1d5334a: Connectors move from 0.5.x into 0.5.0).

Windows CI (`Studio checks`: build-booklet, check, lint, the full `npm test`, audit) green on every step of the
branch: fef2aef (run 37395870981), 6318720 (37397466087), 1d5334a (37397753111) and the landing commit 6e11811
(37398222559). On this PC, on the landing tree: `npm run check` ok, `npm run audit` 0 errors and 0 warnings,
`npm run lint` 0 errors and 45 warnings (as main). The suites this change touches or the merges brought in, run
together on 6e11811: 321 tests, 320 pass, 1 skipped (skill_use, connectors, connectors_ui, chat_tools_ui,
agent_tools_skills, skills_connectors_host, agent_rules, agent_rules_host, mentions_host, today_home,
module_purity, skills_ipc, app_wide_ipc, booklet_build, size_page, friends_front_ui, friends_navigation, hub_host,
project_hub_ui, rooms_ui, app_rail, relay_credits, relay_connect). Before the second merge, 568 tests on the touched
suites: 567 pass, 1 skipped. Real windows, one at a time while no other session's window suite ran: team_render 1/1 (84 s) and sessions_render 1/1
(134 s), the two fixtures this change edits; today_render, skills_render, composer_render, autonomy_render,
agent_setup_render and unified_studio_render were still queued behind other sessions' window suites at landing.

Measured: offering skills to a role (`autoSkills`, 30 skills in project and home) costs about 11 ms a call warm and
114 ms cold; a second call to a connector reuses its open session (the pool keeps it 3 minutes, four servers at most;
a worker keeps its own for the run). The review's fixes are pinned: an online connector gets only its saved values
(never the PC's environment or the GitHub sign-in), one connector's calls keep their order, a bare `null` line, a
404'd session and a server still starting at quit are handled, the values file is never wiped, `%TEMP%` tool folders
are swept after six hours, `/name` counts only in the owner's own words. Kill switches MEFI_STUDIO_NO_SKILL_USE,
MEFI_STUDIO_NO_CONNECTORS, MEFI_STUDIO_NO_MCP_POOL and MEFI_STUDIO_SERIAL_TOOLS, each pinned.

## 2026-10-06 Friends › Moderation, Report on projects and pop-ups from friends land on main

Branch `wip/friends-mod` in `C:\wt\mod` (9e2d43d Moderation and project reports; 1679ae6 pop-ups and the relay's
friendOnline frame), main 33c3c4e merged (b433532, clean; booklet.html regenerated).

Windows CI (`Studio checks`: build-booklet, check, lint, the full `npm test`, audit) runs on the landing commit and is
green before the fast-forward. This PC was shared with other sessions' suites the whole time, so the full local gate
was left to CI, as for 33c3c4e.

Run alone here after the merge: friends_front_ui 10/10 (pop-ups grouped, invites, requests, plays and stars, the off
switch), friends_mod_ui 4/4 (new: moderators only, farming list, reports with Resolve, Remove project and Suspend,
lookup, Take back from one giver or all, nothing without a yes), friends_navigation 8/8 (Moderation hidden unless a
moderator), project_hub_ui 7/7 (Report), relay_credits 11/11 (flags: one giver and mutual trading, project reports
once each and never your own, me().moderator), relay_connect 5/5 (friendOnline to room co-members only, not the
Lobby, not twice in 30 minutes, never when hidden), relay_core 9/9, relay_e2e 9/9, hub_client 16/16 (hello lists
friend.online), hub_host 13/13, rooms_ui 13/13, app_rail 40/40, onboarding 43/43, module_purity 61/61,
booklet_build 5/5; friends_render and companion_hub_render 1/1. `npm run check` ok, lint clean on the changed files.
The relay is redeployed (version 1fe8cfc5) and `relay/scripts/smoke.mjs` passes against it.

## 2026-10-06 The Lobby, one sign-in, online at launch, credits that cannot be farmed, and no Discord roles land on main

Branch `wip/credits-guard` in `C:\wt\credits` (bcc51f3 the Lobby front page, Sign in with Discord and online at launch;
4970d71 the anti-farming rules and moderator review; 2ba413e Flame rank lists a room, no Discord roles needed), with
main dfda798 merged (5506e9c) and the scope note's Friends lines updated.

Windows CI (`Studio checks`: build-booklet, check, lint, the full `npm test`, audit) green on 4970d71 and 2ba413e, and
run again on the landing commit before the fast-forward. On this PC the full gate could not get the machine to itself
(other sessions' suites ran throughout); the one full `npm test` on bcc51f3: Node 7048 tests, 7013 pass, 20 fail, every
one in the git-heavy suites that fail when git cannot start under load (attempt_review_host, attempt_snapshots_host,
git_actions, rust_parity_repo, sync, sync_changes, sync_lineage, worktree_actions, worktrees; they passed alone on this
branch's parent earlier today); Electron 88: layout_contract_render and shell_render as on clean main, and
media_browser_render (not touched here). Python contracts and the path lock pass.

Run alone after each change: relay_core 9/9, relay_e2e 9/9, relay_credits 10/10 (alts, one player and many projects,
the 15-a-week pair limit, stars once a week, midnight replay, rate limits, Forget me's 30-day hold, a moderator's review
and take-back), relay_connect 4/4, hub_client 16/16, hub_host 13/13, friends_front_ui 9/9, project_hub_ui 6/6,
rooms_ui 13/13, friends_navigation 8/8, app_rail 40/40, onboarding 43/43, module_purity 58/58, booklet_build 5/5,
layout_contract_nav 15/15, shell_frame_bars 34/34, community_rules 17/17; friends_render, companion_hub_render and
unified_studio_render 1/1 each (friends_render walks The Lobby and the signed-out card at four window sizes with no
text under 12 px). `npm run check` ok; lint adds no warning; audit 0. The relay was redeployed (version
4b641b0c) and `relay/scripts/smoke.mjs` passes against it.

## 2026-10-06 Startup marks and the settings cache (S1) land on main

Branch `land/s1-boot` in a cloud session (Linux, Node 24.21.0), stacked on S3 over main dfda798: the parked slice
0605bcd re-applied (conflicts in main.cjs, booklet.js, build-booklet.mjs, booklet_build and module_purity resolved
file by file; booklet.html rebuilt). The compile cache stays main's first statement and the marks block follows;
startup-marks.js is first in BOOKLET_INPUTS (the updater's prefix pin moved with it); booklet.js keeps bootHealthy
before the gate. readSettings asks the Rust store first and the cache fronts only the Electron path (6f2c154).

Startup (tools/benchmark_startup.py, finished here, 5 smoke launches each under xvfb as a non-root user, medians):
interactive (Vibe) 4,055 ms on main, 4,024 ms with the marks (no cost; loaded 2,624 / 2,616 ms). New marks, ms since
main started: app ready 212, first paint 462, gate released 3,856; the gate opens at ~700 but the launch choice lands
at ~2,200, and the release comes ~600 ms after the last step. readSettings on a 47 KB settings file (main.cjs's own
code, 2,000 calls): ~460 us per call before, ~265 us with the cache, two stats instead of two file reads.
Kill switches MEFI_STUDIO_STARTUP_MARKS=0 and MEFI_STUDIO_SETTINGS_CACHE=0, both pinned.

`npm run check` ok, `npm run audit` 0 findings, `npm run lint` 0 errors and 45 warnings (as main; the WIP's unused
`utimes` import removed). `npm run test:fast` with mefi-core built (`npm run host:core`): 7099 tests, 7062 pass, 34
skipped, 3 fail, all as on clean main with the same binary: rust_modules image-store folder, and rust_parity_git
"the actions answer like the JavaScript" and "the chip's host answers like git-host.cjs" (fail identically on
dfda798 here; for the Rust chat). rust_parity_settings 3/3 ran (not skipped) with its new cached leg: main's JS with
the cache on equals the uncached JS and Rust step for step. settings_cache 17/17 (new: Rust first, then the cache,
then the files), startup_marks 10/10, startup_marks_renderer, booklet_build, release_updater and shell_frame_wiring
(pins updated for launchGate and ?marks=0). Python test_mefi_studio_idle + updater 42 OK. Electron: startup_render and
renderer_startup 12/12; for S3, task_overview_render, sessions_render, builder_render, fleet_render and
workflow_render 5/5.

## 2026-10-06 Board pushes carry the rows that changed (S3) land on main

Branch `wip/s3-row-push` in a cloud session (Linux, Node 24.21.0) over main 24d6756: the parked slice c682642
re-applied (conflicts in main.cjs mutateBoard/HELD_WHILE_HIDDEN and module_purity, both sides kept), plus the bridge
re-delivering the held board to onTasks when eyes:progress moves a card, so live progress in Tasks, Sessions and
Build is unchanged (722e009).

Bytes per board change (tests/row_push.test.mjs, a seeded 134-card board and 104-session checkpoint store, JSON
bytes over IPC): eyes:tasks with one card changed 688,319 B before, 5,211 B after; an executor checkpoint 688,319 B
before, 665 B after (eyes:progress, no list); eyes:checkpoints with one session changed 760,443 B before, 7,433 B
after; a write that changes nothing sent the list before and sends nothing now. Kill switch MEFI_STUDIO_FULL_PUSHES=1
(whole lists, pinned by host_push_batching and preload_fanout).

`npm run check` ok, `npm run audit` 0 findings, `npm run lint` 0 errors and 45 warnings (as clean main).
`npm run test:fast`: 7064 tests, 7005 pass, 58 skipped, 1 fail: rust_modules "the image-store factory ... keeps
folder the engine's", as on clean main (the Rust chat has it). row_push, board_gateway, host_push_batching,
module_purity, preload_fanout 114/114 together; preload_fanout 17/17 after the onTasks re-delivery (new pins: live
progress delivers the board at once, untouched cards keep their objects, progress that moves no card delivers
nothing, and the seeded walk checks every live delivery against the host's board). Electron fixtures not run here
(no Electron in the container); judged on the Windows "Studio checks" run of this commit.

## 2026-10-05 The 0.5 layout is the only layout: the classic layout's code goes, every window fixture runs the 0.5 layout

Branch `ui/v2-only` (gated in `C:\wt\ui-v2only`, merged with main up to f1934aa in `C:\wt\v2m` as 8e4a501). Owner
chose to remove the classic layout at 0.5.0. The switch and its ways back go (setLayout/setShell, ?layout=,
MEFI_STUDIO_LAYOUT, the Settings and Search toggles); the classic code goes (nav.js's v1 paths, the classic rail,
local navigation, dock, sheet links, tab row, footer and help button; the classic Search rows; the Agents navigation;
the companion hub's Friends section and the Friends page's tab row and Close; Command's .cmd-top with its Ambience,
View and Agent settings popovers, telemetry pills and corner usage panel; the CSS long tail, ~2,600 net lines of app
code). Every Electron fixture launches the 0.5 layout; layout_contract_render and its v1 record are retired. Real bugs
the converted fixtures found are fixed: Team seat rows at 1100, Fleet's fit at 1100, the Project map at 600x560@150%,
Today's box, an Inbox question without options, the orb drag, the slim rail, the Settings strip, the plan page header,
Activity over the chat box, Today's permissions popover, the inspector's Team card, the empty Map's Start button,
hidden key tips, the Inbox keeping the focus on the need pill when its first card was a question without options so
Escape never closed it (a47ac39), and main's new skills chip pushing Build it off Today's row at 1440x900 (aae6947).

Hosted CI (Windows, the whole Node/Python/check/lint/audit chain; the 43 real-window suites skipped there): green on
0da4dfd (37397654824), dc5264f (37398953883), 574fa9d (37399987736), 8b5eacb (37401397849) and 8e4a501
(37402884931). Here, every Electron suite one at a time on 0da4dfd: 44 of 45 ok; shell_render timed out at "Escape
closed the Inbox" while clean main d71e1e0 passed that step (control run), fixed in a47ac39, after which it stops
where clean main stops on this PC ("it shrinks to leave the main area its 320", the display-scaling case). npm run
check and npm run audit on 0da4dfd: exit 0 (audit 0 errors, 0 warnings); npm run check on 8b5eacb and 8e4a501: ok.
After the merges with main 33c3c4e, d71e1e0, d55269f and f1934aa: friends_render, companion_hub_render,
settings_render, size_render, skills_render, team_render, today_render, unified_studio_render, workflow_render ok on
8b5eacb; builder_render (failed on 8b5eacb, the skills chip), today_render, workflow_render ok on aae6947;
command_render, media_browser_render, media_window_render ok on 8e4a501; Friends, rail and Today unit suites 89/89 and
59/59. sessions_render failed at "the keyboard starts on the open project" on 8b5eacb and on clean main f1934aa (both
runs fast, ~45 s) and passed on main d71e1e0, b79b4bc and 0661f8c and on this branch's b632757 (154 s): the timing
flake an older row here already saw at that step. performance_render, startup_render and renderer_recovery ok on
b632757 (main's studio log on disk and Trace).

## 2026-10-05 Linux CI: two Rust-side tests stop assuming Windows

Branch `fix/linux-ci` (60b90a1, off main dfda798), test expectations only: rust_modules feeds the image-store
factory's folder() a platform-native absolute folder (a `C:\` path is relative on Linux), and package_host names
the Rust host program mefi-studio.exe on Windows and mefi-studio elsewhere, as rust-host.mjs does. Here (Windows):
rust_modules and package_host pass alone. Hosted CI on the branch (run 37395258702, Windows): the whole chain green.
studio-linux.yml runs on the main push this lands with; it failed on every main push since 4 October on exactly
these two tests.

## 2026-10-05 The Mefi Studio relay, the Project hub, the Lobby and one Friends page land on main

Branch `wip/friends-ux` in `C:\wt\fux`: wip/relay (the Cloudflare relay under `relay/`, hub-client, room history,
credits, the Project hub; 7b7d243) merged in 2bb548b, the Friends page in both layouts with tabs and Close, the
Your PCs summary, the Lobby, join codes and Who's online (dab7bb4), the Project hub in the rail and the page-based
friends_navigation (3b35abf). main d8a8cf4 merged (the Map, the 0.5 default; CHANGELOG keeps both sides' entries,
booklet.html regenerated and equal to the auto-merge).

Full `npm test` on 3b35abf (after another session's gate finished, none overlapping): Node 7035 tests, 7017 pass, 14
skipped, 4 fail, all git-heavy and all pass alone: attempt_review_host 28/28, attempt_snapshots_host 25/25. Electron
lane 78: 71 pass, 1 skipped, 6 fail: layout_contract_render and shell_render (as on clean main), fleet_render 1/1,
media_window_render 1/1, node_views_render 1/1 and performance_render 2/2 alone. Python 248 tests OK; path lock ok;
`npm run check` ok; `npm run lint` 44 warnings, the same as clean main; `npm run audit` 0 findings. Relay suites
(relay_core, relay_e2e, relay_credits, relay_connect, room_history, hub_client, hub_host) pass inside the Node stage.

After the merge with d8a8cf4 (3d48f57), re-checked rather than re-gated: `npm run check`; friends_navigation 6/6,
app_rail 40/40, onboarding 43/43, rooms_ui 13/13, pc_sync_ui 13/13, project_hub_ui 5/5, booklet_build 5/5,
layout_contract_nav 15/15, shell_frame_bars 34/34, command_toolbar 19/19, check_testruns 9/9; friends_render,
companion_hub_render, unified_studio_render and map_render 1/1 each.

## 2026-10-05 The Map, the 0.5 layout as the default and Chrome's buttons land on main

Branch `ui/map2` in `C:\wt\ui-map2` over main c7a4d26: the Map place (WIP 404a0c5 finished: the session list stays in
the list column on Map pages, Map | Fleet | Pipelines as a switch in the Map bar and in Fleet's and the Agent brain's
heads, Running only, View ▾ with music.js's five node layouts), the 0.5 layout as the default (13a7034; ?smoke/?capture
launches and a saved classic choice keep v1), one page at a time over the Map and Chrome's metal without the dark
line through button labels (7b3b867), and companion_hub_render asking for the classic layout it walks (649d229).

`npm run check` 0, `npm run audit` 0, lint 0 errors (45 warnings, none new). Full `npm test` on 7b3b867 here: Node
6993 tests, 6965 pass, 13 fail + 1 cancelled, all slow git/process suites starved while other sessions' agents and
tests held the memory (attempt_review_host, attempt_snapshots_host, git_actions, rust_parity_repo, sync,
sync_changes x2, sync_lineage x2, update_rehearsal, worktree_actions, worktrees x2); hosted CI on the same commit
(run 37377470163, Windows) passed the whole chain: Node 6993/6959/0 fail (34 skipped), Electron lane 88/45/0 fail
(43 real-window suites skipped there), Python and audit green. The local Electron lane was cut off by the runner's
2-hour limit after project_map_render with one failure, companion_hub_render (the 0.5 default sent its Friends
click to the Friends page; fixed in 649d229, 1/1); layout_contract_render failed as on clean main here (viewport
1921x1081). The remaining 23 Electron suites then ran one at a time on 649d229 and passed, except shell_render
(as on clean main on this PC): release_channel_render, renderer_recovery, review_render, rust_host_bridge,
sessions_render, settings_render, setup_helper_render, size_render, skills_render, stamp_exe, startup_render,
tabs_render, task_overview_render, team_render, today_render, tree_dynamics_render, unified_studio_render,
workflow_render, worktrees_render, command_render (57 s), eyes_toggle_electron, occlusion_probe. map_render (new)
passed in the lane.

## 2026-10-05 The 0.5 rail, Team, Friends and the owner's design follow-ups land on main

Branch `ui/friends` in `C:\wt\ui-friends`: ui/ia (the v2 rail, the list column's places, Team's twelve places, the
up-next fix) + the Friends place and the owner's follow-ups (2cd76b2, 9487621) + main 3752b7e merged (1c338d0;
CHANGELOG keeps both sides' entries, booklet.html regenerated).

ui/ia's own gate on fb46061: Node 6982/6961, 7 fail (tabs_strip x2 pinned the Add menu's Home group, fixed in d3779b3,
66/66; the rest pass alone); Electron 77/73, 3 fail (layout_contract_render and shell_render as on clean main,
today_render's known lane flake, passes alone).

Full `npm test` on 9487621 (free memory fell to 12 MB during it): Node 6991 tests, 6954 pass, 22 fail, all git-heavy
suites whose git could not start, all pass alone: attempt_review_host 28/28, attempt_snapshots_host 25/25 + 3 skipped,
git_actions 65/65, pc_vault_turns 9/9, rust_parity_repo 3/3, rust_parity_snapshots 3/3, sync 22/22, sync_changes 5/5,
sync_lineage 5/5, worktree_actions 17/17, worktrees 8/8, worktrees_host 10/10. Electron lane 78: 73 pass, 1 skipped, 4
fail: layout_contract_render and shell_render (as on clean main), task_overview_render (1/1 alone) and
unified_studio_render (1/1 alone, 148 s). Run alone before the gate on this tree: friends_render (new), team_render,
companion_hub_render, today_render, tabs_render, sessions_render, settings_render, unified_studio_render,
agent_setup_render. Python 104 s OK; path lock ok; `npm run audit` 0 findings.

main moved during the gate (c630b4d, 52a3d16: Chrome's iridescent finish, chrome.css with its test, docs and
screenshots; no file this branch changed but CHANGELOG). Merged as d39878e (CHANGELOG keeps both sides, booklet.html
regenerated) and re-checked rather than re-gated: `npm run check`; chrome_theme 9/9, tabs_strip 66/66,
shell_frame_bars 34/34, today_inbox 38/38, builder_kit 21/21; settings_render (every theme at 4.5:1), friends_render,
team_render and today_render 1/1 each.

## 2026-10-05 Chrome's iridescent finish: holo edges, hairlines and a tinted ground

Branch `paint/chrome-gradients` in a cloud worktree (Linux, Node 24.21.0,
Electron fixtures as tester under xvfb, two at a time, on snapshots of the
tree), off origin/main 3752b7e. renderer/chrome.css takes the website's
--chrome-holo tokens word for word and uses them sparingly: 2-5% ice, lilac and
aqua washes in the scene and Vibe's aurora, a tinted sheen, the 2px holo bar on
the straight run of the rail's current place, the selected session row, the
frame's current page and the palette's active row (plain chrome round the
corners), a 2px holo line under the open tab, the inspector's tabs, the local
navigation and a chosen theme, the holo line at a quarter strength in the
hairlines under the top bar and tab strip, over the status bar and along the
floating menus' tops, a cooler metal that glows under the pointer, holo
meter, switches and project mark, and a holo-tinted greeting. The edges and
lines are border images (no room taken, never a layer behind words, which the
readability probes would read as the colour under every word). Static
gradients, no hot path touched, nothing to measure.

`npm run check` ok (271 targets, 30 stylesheets used), `npm run audit` 0
findings, `npm run lint` 0 errors and the same 44 warnings as clean main.
`npm run test:fast`: 6981 tests, 6922 pass, 58 skipped, 1 fail: rust_modules
"the image-store factory ... keeps folder the engine's", as on clean
origin/main here (a Windows path resolved on Linux). tests/chrome_theme.test.mjs
9/9 (new: Chrome is static; the holo layer is the website's tokens, each used,
edges and lights only, the ground and the sky faint); 15 hand mutations of
chrome.css (a bar as a background layer, 3px, an outset, a border width, an
animation, a loud ground, a changed token...) each fail it. Python contracts
258 OK (3 skipped).

Electron on the final tree: today_render (63 s), shell_render (152 s),
sessions_render (122 s; the every-theme 4.5:1 probes on the status bar, Search,
the Inbox and both Todays), tabs_render (150 s), layout_contract_render
(349 s), size_render (47 s), review_render (12 s), command_render (83 s) and
unified_studio_render (169 s) pass. settings_render fails exactly as on clean
main (600x560 at 1.5: the same four Report a problem rows, 391 > 384); with that
size left out in a throwaway copy its every-theme contrast pass is green for
Chrome and the other twelve palettes, on this tree and on clean main.
unified_studio_render failed once on clean main ("at the end of the pane the
thumb rests on its bottom edge", 39 s) and passed on the rerun (138 s). A
throwaway copy of today_render also opened v1's Vibe front door in Chrome for
the greeting and Build it under the pointer.

## 2026-10-05 The Chrome theme, now the default, and a finish pass for every theme

Branch `paint/chrome` in a cloud worktree (Linux, Node 24.21.0, Electron
fixtures under xvfb), off origin/main 1df1651. Chrome joins THEMES first with
the website's palette and is DEFAULT_THEME (a saved theme, Aurora included,
is kept); renderer/chrome.css, bundled last and scoped to
html[data-studio-theme="chrome"], paints the matte surfaces, the brushed
metal on primary buttons and chosen segments and the thin chrome edge on
selections; studio-ui.css, shell.css, tabs.css and sessions.css get the shared
finish (140 ms hover, 90 ms press, 1px top highlights). Paint only: no hot path
touched, resolvePalette's memo unchanged, so nothing to measure.

`npm run check` ok (271 targets, 30 stylesheets used), `npm run audit` 0
findings, `npm run lint` 0 errors and the same 44 warnings as clean main.
`npm run test:fast`: 6979 tests, 6920 pass, 58 skipped, 1 fail:
rust_modules "the image-store factory ... keeps folder the engine's", which
fails the same way on clean origin/main here (a Windows path resolved on
Linux). New: tests/chrome_theme.test.mjs (7/7) and two music.test.mjs tests
(the default and the palette; 4.5:1 for text, muted, dim and bright, the
canvas and the ink on the accent in all twelve themes and the custom palette).
Python contracts 258 OK (3 skipped).

Electron, as tester under xvfb, on snapshots of the tree: today_render,
shell_render, sessions_render (every-theme 4.5:1 probes, Chrome included),
tabs_render, layout_contract_render (353 s), size_render, builder_render,
review_render, command_render, media_window_render and unified_studio_render
pass. unified_studio_render failed once ("holding an arrow continues
scrolling", 37 s, two fixtures racing) and passed on the rerun (135 s), as on
clean main (393 s). settings_render fails exactly as on clean main (600x560 at
1.5: the Report a problem rows 7 px past the page's edge); with that one size
left out in a throwaway copy, its every-theme contrast pass is green for
Chrome and the other twelve palettes, on this tree and on clean main.

## 2026-10-05 Today in both modes and the snapshot time limits land on main

Branch `land/ui-today` in `C:\wt\land-ui`: origin/main 3daf9d8 with
rust/snapshot-timeouts 1a1c1f4 (attempt snapshots take a `timeoutScale` for
every git time limit, in JavaScript and in Rust; the snapshot parity test uses
6 on both sides) and ui/today merged (3780663), then 577bf4e: the today_render
and sessions_render fixtures expect a run that waits on you under Needs you
only. Both fixtures failed alone on 3780663 (they pinned the old picture) and
pass alone on 577bf4e (72 s and 117 s).

Full `npm test` on 577bf4e (quiet machine apart from a cleanup session doing
git work): Node 6970 tests, 6953 pass, 14 skipped, 3 fail, all pass alone:
advisory_checks (26/26; EPERM removing its temp folder), attempt_review_host
(28/28; "a claim cancelled before its worker started", known under load) and
update_continuity (9/9; read a helper mid-write under load). Electron lane 76:
72 pass, 1 skipped, 3 fail: layout_contract_render and shell_render (as on
clean main on this PC) and sessions_render ("the keyboard starts on the open
project", passes alone again, 122 s). rust_parity_snapshots ran inside the
gate and passed (3/3; the twin-repository test took 127 s under load, the
case the time-limit scale is for). Python 248 OK; path lock ok; `npm run audit` 0 findings; `npm run check`
ok.

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
