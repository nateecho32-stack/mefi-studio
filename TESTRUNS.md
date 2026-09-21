# Test Runs

The eyes worker (`scripts/eyes-worker.mjs`, `scripts/eyes-client.cjs`,
`scripts/path-scope.cjs`) moves every OpenCode-store read and the synchronous
`git status` off the Electron main process; `tests/eyes_worker.test.mjs`
covers it with a fixture module (busy read, hang, crash, uncloneable result,
allowlist, module version restart, closed client) and the real reader against
a temporary store (folder scoping through `listSessions({ root })`,
`listSessionIds`, `sessionDirectory` and the async project facade, plus the
facade's shared scope read). Facade reads are asynchronous now, so
`tests/projects.test.mjs`, `tests/verification_evidence.test.mjs`,
`tests/executor_lifecycle.test.mjs`, `tests/executor_resume.test.mjs` and
`tests/fixtures/host_executor.mjs` await them and slice
`async function attributeRunSession(`. Housekeeping reads verification
evidence before its synchronous board mutation through a read-only
`mutateBoard` pass, so harness fakes without `readJson` still verify.
Validated on 2026-09-21: `npm run check` (81 targets, full coverage),
`npm run audit` (zero findings), the 244 Python contracts (the
`eyes:collisions` pin keeps its literal `presence:` key) and the normalized
path lock pass. The 30 Node files that slice the converted host sections
(331 tests) were run before and after the change against the same working
tree: the 127 failures left are the same set that fails without the change
(the uncommitted lag-gate work calls `readSettings()` and
`machineMemoryWarnOverride()` inside `spawnNextJob`, which the executor
harnesses do not define, so their dispatches read "resources"); no new
failure remains. The full `node scripts/run-node-tests.mjs` run reached 744
passes with that same failure set and then sat on
`tests/jev_model_routing_host.test.mjs`, which never returned on this machine
in either run (the baseline stalled at the same file), so it printed no
summary. Measurements are in PERFORMANCE.md ("Store reads leave the main
process"); the packaged copy needs `npm run package` to pick the change up.

Chat admission regressions in `tests/assistant_chat_admission.test.mjs` run the
real responder and task admission against serialized memory stores. They cover
concurrent repeated sends, equivalent wording, inbox and worker reuse, pending
verification, resolved follow-ups, full briefs sharing a truncated title, and
failed saves without helper dispatch. `tests/chat_work.test.mjs` checks matching
boundaries for projects, grouped tasks, scope, negation, paths and closed work.
`tests/assistant_question_routing.test.mjs` keeps questions and lookups out of
execution while retaining explicit instructions, mixed question/work messages, and offer follow-ups bound to their pick's full title and identity.
These checks use no live stores, coding workers or paid provider calls.

Reading a newly opened folder is covered by `tests/analyzer_project.test.mjs`
and `tests/planning_assistant.test.mjs`. The project inventory is breadth-first
by depth, so the plan documents at the top of a large checkout are read before
one deep tree can exhaust the file, entry or depth bounds; a regression fixture
puts more source files under `deep/` than the file bound and checks the root
`PLAN.md` is still discovered, while the existing truncation and depth
limitations stay disclosed. The assistant facts now carry the open folder
(`project`) and the Analyzer's bounded scan of it (`projectScan`), the chat
system prompt and the keyless planning reply name the scanned plan documents
beside Studio's saved Plans, and adopting a project starts the scan from the
host even when the Analyzer panel was never opened.
`tests/assistant_readiness_reply.test.mjs` runs the real
`assistantMessageFacts` host slice against a project and its scan and checks
both ride the facts.
Validated on 2026-09-20: `npm run check`, `npm test` (1,495 Node tests with one
opt-in skip, 243 Python contracts and all normalized-path checks) and
`npm run audit` (zero findings) passed. A real read of the local `2d Trippy
Hell` checkout, which previously reported zero plans and zero source files,
now reports 9 plan documents and 974 source files within the unchanged
1,200-file scan bound (disclosed as a partial scan).

Projects are opt-in on a new machine. `tests/projects.test.mjs` pins that a
fresh install opens with no project, the app's own seed is never listed or
saved (old seeded settings are dropped once; a folder re-added by the user, or
named by `MEFI_STUDIO_REPO`, is kept), removing a project hides the legacy
identity while its data stays reachable when the folder is added again, and an
unavailable saved folder leaves the no-project placeholder open instead of
adopting the seed. The first folder added becomes the active project, the
renderer opens Analyzer on it, and dispatch plus AI cadences stay on hold while
no project is open. The host fixtures in `tests/assistant_loop.test.mjs`,
`tests/backlog_engine.test.mjs`, `tests/board_growth.test.mjs`,
`tests/executor_lifecycle.test.mjs`, `tests/executor_parallel.test.mjs`,
`tests/analyzer_host.test.mjs`, `tests/planning_execution.test.mjs` and
`tests/fixtures/host_executor.mjs` supply the explicit `projects.open()` seam,
so each host states whether a project is open instead of inheriting one.
Validated on 2026-09-20: booklet rebuilt, `npm run check` and `npm run audit`
passed, and every suite touched by the change passes. The full Node run also
shows `catalog_renderer.test.mjs`'s initial-routing load failing against the
in-progress provider controls in the working tree, plus the two known
render-capture flakes (`performance_render`, `task_overview_render`) that pass
in isolation and are documented with the 2026-09-19 run.

The right rail splits **Work** from **Settings**: Work keeps the live view with a
standing agent roster (status chip, role, elapsed time and the wrapped task
line) above the shared work scroller, and Settings owns autopilot, parallel
builds, build mode, the agent-mode note, the safety stops and the control
explanations. The real Electron `tests/command_render.test.mjs` fixture checks
that the roster band stays visible in Work and hides with the activity stream
when the assistant console takes the feed's place.

Validated on 2026-09-20: booklet rebuilt; `npm run check`, `npm test` (1,419
Node tests with one opt-in skip, 227 Python contracts and the normalized-path
checks) and `npm run audit` (zero findings) passed. An isolated Electron preview
with synthetic state and no workers also confirmed the five tabs fit one row at
1280px and the roster band stays readable at 600px.

Worker-start feedback coverage in `tests/assistant_work_on.test.mjs` reproduces
repeated **Work on it** clicks after a session request has been promoted and its
inbox entry removed. It checks existing-worker reuse, preparation versus process
startup, one chat confirmation per spawn, verification, stale assignments and
Pause while a builder is running. `tests/executor_resources.test.mjs` also checks
connection failures, dispatch-error recovery and full manual limits. These use
in-memory stores and fake child events without launching paid workers.
Validated on 2026-09-19: `npm run check`, 1,327 Node passes with one opt-in
skip, 220 Python contracts and six normalized-path checks, and `npm run audit`
passed. The parallel Node run can flake the Electron render captures under GPU
load (`tests/task_overview_render.test.mjs`, `tests/performance_render.test.mjs`);
both pass in isolation and the suite passes cleanly with
`node --test --test-concurrency=1`. Complete logs remain in the local temporary
directory as `mefi-spawn-fix-{check,test,audit}.log`.

`tests/assistant_work_on.test.mjs` covers the actual **Work on it** host path:
paused and disabled workers are reported explicitly, repeated clicks retain one
prioritized request, and dispatch is distinguished from a confirmed worker start.
The in-memory executor fixture checks that resuming allows the saved request to
run without another click. The New work control persists worker enablement,
preserves build approvals and other preferences, and leaves current workers
running when switched off. It uses fake workers and never changes live user data.
`tests/command_new_work.test.mjs` checks synchronized switches, loading, busy
and failure states. The real Command renderer fixture also clicks the switch at
desktop and 600px widths, with synthetic state and external requests blocked.

New work validation (2026-09-19): booklet rebuilt, check and audit passed, and
`npm test` passed with 1,277 Node tests (one opt-in skip), 220 Python contracts
and all six normalized-path checks. The Electron switch check passed at desktop
and narrow widths; Windows display scaling is allowed one pixel of rounding.
Synthetic captures stay in ignored `tools/logs/new-work-toggle/`; full output is
saved locally as `%TEMP%/mefi-work-on-test.log`.

Shared-task delegation is covered by `tests/task_delegation.test.mjs` and
`tests/executor_delegation.test.mjs`. Both Swarm and Cluster use the real host
selection, assistant preparation, child claims, result verification and parent
integration with memory stores and fake HTTP/process boundaries. Cases include
parallel and overlapping-file subtasks, manual limits, individual build
approvals, mode/pause/scope races, failed saves, request promotion, restart
focus, saved-subtask recovery, cleanup protection and bounded delegation
without recursive splitting. Reopening a child holds its parent's verification.
No paid provider calls or live coding workers are used.

The isolated task-overview Electron fixture also checks delegated parent and
child navigation, confirmed-only subtask progress and the separate integration
step at desktop and 600px widths. Reviewed captures and its report are local
in ignored `tools/logs/task-delegation-review/`; no renderer, network or child
process errors were observed.

Shared-task validation on 2026-09-19: booklet rebuilt; `npm run check`,
`npm test` and `npm run audit` passed. The final full run passed 1,271 Node
tests (one opt-in skip), 220 Python tests and six normalized-path checks.
Audit reported zero findings. Final logs are local in the temporary directory
as `mefi-shared-task-test-final.log` and `mefi-shared-task-check-final.log`.

Task-pileup regressions are covered by `tests/updater_deferred.test.mjs` and
`tests/executor_result_protocol.test.mjs`. Deferred updates retry after workers
save their results without needing another source edit or a visible window;
stopping the watcher or disabling automatic updates cancels retries. Retries
validate the latest source before restarting. Executor results must begin their
own line, so saved results echoed inside JSON or prose cannot replace the
current attempt's report. Host fixtures verify both successful completion and
retention of real unfinished work. These checks use temporary state and fake
workers, with no live-board writes or provider calls.

Startup readiness coverage runs through `npm test`, or directly with
`node --test tests/renderer_startup.test.mjs tests/nav_startup.test.mjs
tests/workspace_ui.test.mjs tests/catalog_renderer.test.mjs
tests/startup_render.test.mjs`. Controlled reads and clocks check parallel
preparation, real completed-step progress, input blocking, bounded timeouts,
explicit partial opening, retry after a hung request, and stale result fencing.
Workspace tests verify project/data readiness and no duplicate initial batch;
navigation tests verify saved views, drafts, scroll and focus restoration.
The real Electron fixture launches normally with delayed synthetic project and
catalog reads, checks the loader before allowing either read to finish, then
checks the populated Workspace and first-run guide. Separate launches cover
failure/retry, explicit partial opening, 600px layout, reduced motion and
readable loading surfaces with a custom light theme.
It uses disposable profiles and public catalog data, blocks external requests
and child processes, and never starts the live app or coding workers. Set
`MEFI_STARTUP_CAPTURE_DIR` to an absolute local directory to retain screenshots
and the fixture report. Startup data reads do not run Settings-only connection
or CLI discovery checks; capture/smoke launches retain direct navigation.

Startup validation on 2026-09-19: booklet rebuilt; `npm run check` and
`npm run audit` passed with zero findings. All 48 focused startup tests passed,
including the real Electron loader, delayed reads, failure/retry, partial
opening, reduced motion and custom light theme. The latest full `npm test`
recorded 1,196 Node passes, one opt-in skip and one failure in the concurrently
changing Cluster direct-request resume test (`tests/executor_resume.test.mjs`).
A separate reproduction then encountered the ongoing fixture's missing
`scripts/task-delegation.cjs` dependency. The combined full-suite gate remains
unpassed; standalone Python discovery passed all 220 tests and all six
normalized-path lock checks passed. Logs are local in `tools/logs/` as
`startup-release-test.log`, `startup-release-check.log`,
`startup-release-audit.log`, `startup-focused-final.log` and
`startup-python-final.log`. Synthetic preview screenshots are in the ignored
`tools/logs/startup-ui/` directory.

`tools/test_mefi_studio_session_dedupe.py` covers session work accounting:
normalized-title deduplication, one in-progress todo per active session,
overflow requeueing, and the overseer digest using fresh watcher counts.
It runs in the standard Python discovery step without network or workers.

Project onboarding in Analyzer is covered by `tests/analyzer_project.test.mjs`,
`tests/analyzer_host.test.mjs`, and `tests/analyzer_ui.test.mjs` (included in
`npm test`). Temporary project fixtures check historical documents and saved
Studio plans against current source, missing paths, misleading completed claims,
empty projects, traversal and linked paths, exclusions and scan limits. Host
fixtures cover captured project identity, shared reads, retry, unavailable
saved plans and explicit AI context from the host report. Renderer fixtures
cover automatic local analysis on project load, delayed replies and picker
results after switching projects, safe AI rendering, and editable starting
points without creating work. No live plans, user settings or workers are used.

Analyzer validation on 2026-09-19: booklet rebuild, `npm run check`, and
`npm run audit` passed (zero findings). All 40 focused Analyzer tests passed;
an isolated Electron preview checked automatic local loading, editable starting
points, desktop and 600px layouts with no renderer errors or horizontal overflow.
The final full `npm test` passed 1,145 Node tests (one opt-in skip), then ran
211 Python tests with one failure in the concurrently changed assistant's
`test_module_syntax_and_self_test`: its builder digest expectation still counts
a failed-only event as a successful report. That failure reproduces directly
with `node scripts/assistant.mjs --self-test`; Analyzer's Python contracts pass.
The six normalized-path lock checks passed separately. The combined full-suite
gate remains unpassed. Logs are local in the temporary directory as
`mefi-analyzer-final-test.log`, `mefi-analyzer-focused-final.log`,
`mefi-analyzer-final-check.log` and `mefi-analyzer-final-audit.log`.

Swarm and Cluster modes are covered by `tests/agent_modes.test.mjs` and
`tests/executor_modes.test.mjs`. These exercise real host selection, claims,
support preparation, verification and handoffs using memory stores and fake
HTTP/worker boundaries. Coverage includes independent Swarm tasks, parallel
Cluster advisors feeding one builder, focus through verification and delegated
work, saved modes, project isolation, unavailable assistance, Pause, mode/scope/
approval changes, resource races, actual assistant pool limits, bounded queued
advisory waits and discarded late replies. They make no paid provider calls.

`tests/workspace_ui.test.mjs` and `tests/command_activity.test.mjs` cover mode
controls, saving/recovery and helper activity. The isolated Electron
`tests/command_render.test.mjs` fixture additionally checks both real mode
selectors at 1280px and 600px, their mode-only setting writes, unchanged Pause,
busy controls and duplicate helper suppression. All are included in `npm test`.
The Python assistant contract includes the two on-demand Cluster roster roles.
The node tree toolbar selector is also exercised with Live work collapsed:
mode saves, keyboard focus and pointer access work at 1280px and 600px, with
every toolbar control inside the viewport and no control overlap or horizontal
overflow.

Node-tree selector placement validation on 2026-09-19: rebuilt booklet;
the isolated Command Electron regression passed, including mode changes with
Live work collapsed at desktop and 600px widths. Check and audit passed after
the placement edit. Full-suite reruns on the concurrently changing tree remain
blocked: the latest Node run had 1,149 passes, one skip and two renderer
timeouts. The profiler timeout passed separately; task overview still timed
out waiting for its startup fade. Separate Python discovery ran 214 tests
with two failures, including the boot-canvas DOM contract. The assistant
self-test and six normalized-path checks passed. Logs remain in the local
temporary directory as `mefi-tree-mode-test-final.log`,
`mefi-tree-mode-unrelated-render.log`, and `mefi-tree-mode-python.log`.

Swarm/Cluster validation on 2026-09-19: booklet rebuilt, `npm run check` and
`npm run audit` passed with zero findings. Full `npm test` passed (1,115 Node
passes, one opt-in skip, 211 Python passes and six normalized-path checks).
After the final preparation-status display change, all 96 focused mode,
Workspace, Command, booklet and real Electron checks passed; check and audit
passed again. Complete logs are retained in the local temporary directory as
`mefi-agent-modes-test-final.log`, `mefi-agent-modes-final-delta.log`,
`mefi-agent-modes-check-final.log` and `mefi-agent-modes-audit-final.log`.

Task-board overview and consolidation coverage runs through `npm test`:
`tests/board_growth.test.mjs`, `tests/board_grouping.test.mjs`,
`tests/group_board.test.mjs`, `tests/task_grouping_cleanup.test.mjs`,
`tests/task_overview_groups.test.mjs`, `tests/tasks_ui.test.mjs`, and
`tests/task_overview_render.test.mjs`. These cover automatic discovery limits,
concurrent admission, scope preservation, reviewed grouping under the board
gateway, claim and project fencing, replay recovery, local backups, goal-level
grouping, discussion progress, and confirmed-only completion. The isolated
Electron overview fixture uses 95 synthetic tasks, blocks provider requests
and child processes, and checks desktop/600px layouts, search and original
task details. It never loads the live Studio host or user board. Set
`MEFI_TASK_OVERVIEW_CAPTURE_DIR` to an absolute local directory to keep its
screenshots and report for visual inspection.

Board validation on 2026-09-19: booklet build, `npm run check`, and
`npm run audit` passed (zero findings); the focused board suites and desktop/
600px Electron overview passed. The final combined `npm test` reached 1,096
Node passes, one opt-in skip and two failures in the concurrently edited
`executor_modes` fixture (`assistantPoolCounts` missing in its VM). Separate
Python discovery ran 211 tests with two agent-mode contract failures (pool
widening text and the new cluster-role roster); normalized-path checks passed
6/6. The full-suite gate remains unpassed. An earlier profiler-export timeout
passed on focused rerun and in the final combined run. Local logs are
`%TEMP%/mefi-board-final-test.log` and `%TEMP%/mefi-board-python.log`; overview
screenshots and its isolated report are in `tools/logs/task-overview-review/`.

Performance profiler coverage runs through `npm test`, or directly with
`node --test tests/performance_core.test.mjs tests/performance_host.test.mjs
tests/performance_render.test.mjs tests/profiler_lifecycle.test.mjs
tests/tree3d_performance.test.mjs`.
Controlled clocks verify nested self time, rolling p95, bounded retention,
capture reset/stop fencing, absent metrics, IPC result/error preservation,
payload exclusion and host lifecycle cleanup. The isolated Electron profiler
fixture uses temporary stores and blocked external requests, injects a measured
UI stall, and checks real frame/long-task detection, recording across panel
closure, frozen JSON export, visibility suspension and the 600px layout.
It does not start Studio's assistant or external coding workers. A second
isolated launch exercises real Electron process metrics and IPC timing through
the desktop bridge. Panel lifecycle tests cover delayed/out-of-order host
responses, export/reset races, single in-flight reads and timeout recovery.

### Profiler-guided Command optimization

Run `node tools/profile_studio.mjs --output tools/logs/profile.json --capture`
for four isolated real-renderer workloads: 32 and 154 painted nodes, each in
2D and rotating 3D. The Electron fixture uses a 1280x900 offscreen window,
software rendering, a 2-second warmup and a 5-second capture per case. Command
retains its normal 30 fps drawing cap; the profiler observes browser callbacks
separately. Audio is off and the profiler panel stays closed while recording.
The fixture copies only
renderer sources and the public model catalog into temporary state, blocks
external requests and process launches, and never starts Studio's workers.
`--source PATH` compares a source snapshot; `--warmup-ms`, `--duration-ms` and
`--scenarios` control the workload. Reports record the renderer SHA-256,
actual node counts and complete profiler data. Keep captures under ignored
`tools/logs/` and run comparisons sequentially without concurrent tests.

Captures identified node painting as the largest named Command cost. Orb
gradients now reuse a bounded per-canvas cache while retaining screen-space
paths and exact continuous radii. Stable graph topology also reuses its parent
map, invalidating on in-place node/edge changes. New nested scopes separate
node painting, connections, labels and backdrop from other frame work.

Measurements on 2026-09-19 used frozen before/after sources differing only in
these two cache changes. Each value below is the average of two per-run mean
durations in milliseconds; they are diagnostic measurements, not test thresholds.

| Workload | Frame before | Frame after | Nodes before | Nodes after |
| --- | ---: | ---: | ---: | ---: |
| 32 nodes, 3D | 3.559 | 2.502 | 1.493 | 1.011 |
| 154 nodes, 3D | 6.080 | 5.418 | 3.207 | 2.413 |
| 32 nodes, 2D | 3.542 | 3.042 | 1.587 | 1.249 |
| 154 nodes, 2D | 6.082 | 5.398 | 3.309 | 2.728 |

Node work fell 18–32% and measured frame work 11–30% on these averages. Timing
varied substantially: dense 3D frame means ranged 4.400–7.761 ms before and
4.504–6.332 ms after. Three scenarios had overlapping before/after ranges,
so these runs do not establish a live-app FPS guarantee. Source hashes matched
within each pair, node counts matched, and all captures reported no renderer
errors, external requests or process launches. Full data and screenshots stay
under `tools/logs/profiler-optimization-*`; the comparison JSON includes ranges.

`node --test tests/command_topology_cache.test.mjs
tests/node_paint_cache.test.mjs` checks exact parent-map reuse/invalidation,
bounded retention and real Electron pixels at DPR 1, 1.5 and 2. The pixel
fixture compares 192 moving/fading/selected/glowing node cases per density,
including glyphs, and verifies restored canvas state. Maximum channel deltas
were 1/255, 4/255 and 1/255 from gradient rounding, with unchanged geometry.
These tests are included in `npm test`; there are no wall-clock speed assertions.

Optimization validation: rebuilt booklet, `npm run check` and `npm run audit`
passed (zero findings). The final focused Command, cache and real Electron
profiler run passed all 129 tests. Python discovery passed all 211 contracts,
and normalized-path ownership passed all six checks. The latest combined
`npm test` run passed 1,127 Node tests, skipped one and failed one existing
profiler JSON-download timeout; both profiler Electron tests then passed in
the focused run. The combined gate remains unpassed. Complete logs remain at
`tools/logs/profiler-optimization-{check,audit,test-complete,focused-final,python,lock}.log`.
The benchmark CLI also passed a short correctness smoke after fixing Windows
temporary-directory cleanup; its smoke timings are excluded from comparisons.

Profiler validation on 2026-09-19: rebuilt booklet, `npm run check`, and
`npm run audit` passed (zero findings). The 51 focused profiler, project,
booklet-build and update-continuity checks passed, including both real Electron
profiler launches. Python discovery passed all 211 contracts and normalized-path
ownership passed all six checks. The final combined `npm test` run passed 986
Node tests, skipped one and failed one in the concurrently edited Command audio
fixture: `tests/command_render.test.mjs`, “Audio fixture task disappeared”. The
profiler suites passed in that run; the full-suite gate remains unpassed.
Complete logs are in the local temporary directory as
`mefi-profiler-combined-test.log`, `mefi-profiler-final-focused.log`,
`mefi-profiler-python.log`, `mefi-profiler-combined-check.log`, and
`mefi-profiler-combined-audit.log`.

Machine-managed scheduling is covered by `tests/machine_capacity.test.mjs`,
`tests/worker_responsiveness.test.mjs`, `tests/executor_resources.test.mjs`,
`tests/assistant_pool.test.mjs`, `tests/command_activity.test.mjs` and
`tests/assistant_readiness_reply.test.mjs`. Run these with `node --test` from
this directory. Controlled clocks, renderer probes and process doubles cover
responsive machines admitting more than three workers, lag-based holds and
recovery, the low-memory emergency guard, fresh post-claim readings, retained
manual limits, Pause, exclusive leases and failed claim-release retries.
No test starts a coding worker or uses the live project board. Full `npm test`
also runs the isolated Electron rendering and recovery fixtures.

The renderer responsiveness probe behind those lag readings is
`main.cjs` `measureWorkerLag`: one renderer script pairs two independent
aliveness channels so an occluded window is never mistaken for a stalled one —
a two-frame `requestAnimationFrame` chain (frames stop when a background window
is throttled) beside a dedicated Web Worker timer that posts its own drift past
a 150 ms schedule (worker timers are not frame-throttled); when worker
construction is refused or errors, an unthrottled `MessageChannel` round-trip
takes over. The script runs through `rendererValue` with a `null` fallback and a
1000 ms timeout. Scoring: frames answered reads the renderer's own in-page frame
chain, `max(0, framesMs − 50)` from `performance.now()` inside the probe (a
50 ms allowance covers a normal frame period), so high CPU with a live view
still admits workers — host dispatch/reply wall time is not renderer lag, and
counting it (the old `elapsed − 50` rule) manufactured renderer-lag holds that
blocked new starts on a healthy machine (a healthy window read 452 ms mid-suite);
a page that does not report `framesMs` keeps the wall-clock reading; only the
worker answered means frames were merely
throttled and the reading is `max(0, workerDriftMs − 200, elapsed − 200)` — an
occluded-but-live window reads ~0 while a main thread wedged after script eval
keeps growing; neither channel answered, or a non-numeric worker reading, keeps
the 1000 ms sentinel as genuine unresponsiveness evidence, and a forced
resample lets a recovered renderer admit work again. Hidden, minimized,
destroyed or missing renderers report `null` without probing and clear the
cached sample; a window hidden mid-probe discards its result, and a replaced
window's stale probe can neither clear nor populate the replacement's sample.
Completed samples are cached per window for 750 ms, concurrent reads share one
in-flight probe, `force` bypasses the completed cache but joins an in-flight
one, and each physical probe carries an id through the cache so the foreman lag
gate (documented with `tools/test_mefi_studio_machine.py` above) counts a
sample exactly once.
`tests/worker_responsiveness.test.mjs` runs the real sampler source in a VM
with controlled clocks and view doubles to pin the script shape (exactly two
`requestAnimationFrame` calls timed by in-page `performance.now()` into
`framesMs`, `new Worker` with `postMessage(Date.now() - t0)`,
the MessageChannel fallback on refusal or worker error), all three scoring
branches (frames judge only the renderer's own frame chain — host wall time
around the probe is not renderer lag when frames answer, and a page without
`framesMs` keeps the wall-clock reading), sentinel recovery, visibility
invalidation, cache/in-flight sharing
and probe identity; `tests/foreman_lag_gate.test.mjs` pins the foreman's
consumption of these samples. `tests/occlusion_probe.test.mjs` is the
live-Chromium proof of the same contract: a real Electron fixture loads the
actual `renderer/booklet.html`, proves the blob worker constructs under the
page CSP (`worker-src blob:`), covers the visible window with an always-on-top
window (native occlusion, never minimize), asserts rAF stays silent while the
worker/MessageChannel channel keeps answering, and extracts the probe
expression from `main.cjs` to show the occluded window reads ~0 ms instead of
the 1000 ms sentinel, with rAF resuming once the cover is removed. Run with
`node --test tests/worker_responsiveness.test.mjs
tests/foreman_lag_gate.test.mjs tests/occlusion_probe.test.mjs` from this
directory (the live proof needs a display; it skips on headless Linux).
Under the full suite `scripts/run-node-tests.mjs` holds this fixture out of
the parallel stage and runs it serialized afterward, because mid-suite CPU
contention inflated even the cleanest of three samples to 452 ms on a healthy
window while the isolated fixture reads ~0.

Validated on 2026-09-21 (run_1789972006803_41, frames-path lag fix): the
renderer probe now scores the frames branch by its own in-page frame chain
(`framesMs` from `performance.now()` inside the probe) instead of host wall
time, so a busy main process during a spawn burst no longer reads as renderer
lag and cannot latch renderer-responsiveness holds on a healthy machine.
`node --test tests/worker_responsiveness.test.mjs tests/machine_capacity.test.mjs
tests/foreman_lag_gate.test.mjs tests/assistant_lag_gate.test.mjs` 46/46,
`python tools/test_mefi_studio_machine.py` 6/6 OK, `npm run check` clean; the
live occlusion probe's visible phase (frames answer, lag < 100 ms under the new
classification) passed before its documented capability-gated skip on this
RDP desktop (occlusion tracker never engages).

Validated on 2026-09-21 (run_1789973269892_2, occluded-phase re-pin under the
framesMs classification): `MEFI_OCCLUSION_PROXY=visibility node --test
tests/occlusion_probe.test.mjs` passed, exercising the downstream occluded-phase
branch via the sanctioned hide()/show() proxy (not occlusion): rAF growth 0
while hidden, probe answered via the unthrottled worker channel
(workerDriftMs 164 → lag 0 ms of 1 sample under
`max(0, workerDriftMs − 200, wallMs − 200)`), MessageChannel 0 ms, rAF resumed
after show(). The plain `node --test tests/occlusion_probe.test.mjs` still
skips at the capability gate (cover shown focused, 8 focus reassertions, rAF
loud, NULL Win32 foreground, console session 1, ~3.3 h input idle), and
`tests/worker_responsiveness.test.mjs` passed 16/16. A strict native-occlusion
~0 ms reading still requires a desktop whose tracker engages; the proxy record
remains "not rendered", not covered, pending owner sign-off.

Validated on 2026-09-21 (run_1789973551180_3, strict native occlusion pinned,
proxy off): on the console desktop (session 1, WTSConnectState Active — not
RDP, input desktop Default, not locked) the plain
`node --test tests/occlusion_probe.test.mjs` first still skipped at the
capability gate with a self-describing record: cover shown focused, 8 focus
reassertions, rAF loud at ~60 fps behind the cover, NULL Win32 foreground,
page `hasFocus()` false throughout, ~3.4 h input idle — the tracker is inert
on an unattended desktop, which is the real mechanism behind this machine's
"occlusion never engages", not a hard capability gap. One benign input nudge
(SendInput mouse move, no click or keys) reset the idle clock and the rerun
passed strictly in ~6.3 s: detection signal `document.hidden` (native tracker
engaged), probe window visible and never minimized, occluded rAF growth 0,
every probe sample answered via the unthrottled worker channel
(workerDriftMs 157 → lag 0 ms of 1 sample), blob worker still constructed,
MessageChannel 0 ms, rAF resumed after the cover was removed, 0 console
errors, `MEFI_OCCLUSION_PROXY` unset throughout — the visibility proxy stayed
off and no `occluded` record was ever claimed from it. The occluded ~0 ms
reading is now pinned natively under the framesMs classification.

Re-run on 2026-09-21 (run_1789974040791_4, owner-gated commit check): two
fresh `node --test tests/occlusion_probe.test.mjs` runs both skipped at the
documented capability gate because the desktop was unattended with the lock
screen foreground (LockApp, input idle 4.8-6 min) and a benign SendInput nudge
was blocked, so the tracker never engaged; the records carry the new
`connectStateName` field ("Active", console session 1) and the loud-rAF
timeline, and no occluded record was claimed. The strict native pass above
remains the pinned evidence for this thread.

Re-run on 2026-09-21 (run_1789974561450_6, owner-gated commit of the
occlusion-probe thread): the thread's scoped work is committed as a9464fd
(framesMs lag classification in `main.cjs`, strict native occluded record,
fixture/worker-test hardening, and the TESTRUNS rows above); one more fresh
`node --test tests/occlusion_probe.test.mjs` skipped at the documented
capability gate with the desktop locked (Windows Default Lock Screen
foreground, LockApp pid 17300, console session 1 "Active", input idle ~15
min, cover shown focused, 8 focus reassertions, rAF loud at ~60 fps behind
the cover) — the same inert-unattended-tracker state recorded above, where
the benign-input route is unavailable at the lock screen. No occluded record
was claimed and the visibility proxy stayed off; the strict native pass from
run_1789973551180_3 remains the pinned evidence for this thread.

Re-run on 2026-09-21 (run_1789975072230_7, owner-gated commit of the
occlusion-probe thread): one more fresh
`node --test tests/occlusion_probe.test.mjs` on the committed tree skipped at
the same documented capability gate in ~17.4 s — desktop still locked
(Windows Default Lock Screen foreground, LockApp pid 17300 hwnd 0x1303e2,
console session 1 "Active", input idle ~22 min, cover hwnd 0x237037c shown
over probe hwnd 0x45f00c2, 8 focus reassertions, rAF loud at ~60 fps behind
the cover: ticks 822→907 across the timeline tail). No occluded record was
claimed and the visibility proxy stayed off; no further code changes were
pending — a9464fd remains the scoped code commit and the strict native pass
from run_1789973551180_3 remains the pinned evidence for this thread.

Validated on 2026-09-20: `npm run check`, `npm test` (1,490 parallel Node
tests with 1,489 passing and one opt-in skip, the serialized occlusion probe
passing at ~0 ms lag, 243 Python contracts and the normalized-path checks)
passed. Logs are retained locally in the temporary
directory.

Validated on 2026-09-19: rebuilt booklet, `npm run check`, `npm test`
(937 Node passes, one opt-in skip, 211 Python passes and six normalized-path
checks), and `npm run audit` with zero findings. Logs are retained locally in
`tools/logs/resource-scheduling-final-*.log`. The initial full run caught a
concurrently edited CSS contract; its owner changes settled, its nine focused
tests passed, and the final full run above passed on the combined working tree.

Model/catalog performance coverage is included in `npm test`:

- `tests/catalog_host.test.mjs`: concurrent read/refresh sharing, file-change
  detection, in-flight invalidation, and recovery after missing files or failed
  child processes.
- `tests/catalog_refresh.test.mjs`: concurrent bounded sources, offline and
  failed-source metadata preservation, malformed responses, empty rosters,
  atomic replacement and Windows file-lock recovery in disposable directories.
- `tests/catalog_renderer.test.mjs`: Settings checks deferred to first use,
  initial routing-load safety, duplicate speed-probe suppression, batched
  searches, preserved expanded cards, fresh model choices and lazy catalog maps.
- `tests/model_performance.test.mjs`: cached reads and summaries remain detached
  and refresh after ratings, writes, external replacement, deletion or corruption;
  grouping cost stays bounded as model counts grow.

`python tools/verify_model_lab.py --output tools/logs/model-speed-ui` also checks
deferred Settings discovery and unchanged expanded cards in real Electron,
alongside persistent ratings, task filtering, context budgets and narrow layout.
It uses disposable data and blocks provider requests and workers.

Validated on 2026-09-19: booklet build, `npm run check`, `npm run audit` (zero
findings), 54 focused catalog/ledger/Model Lab behavior checks, all 211 Python
contracts and all six normalized-path checks passed. The Electron Model Lab
tour passed eight checks with no renderer errors or external requests. The
latest full Node run had 805 passes, one opt-in skip and four failures in
concurrently changed backlog/build-approval behavior (`backlog_engine`,
`executor_lifecycle`, `executor_parallel`, `planning_execution`); the full
`npm test` gate therefore remains unpassed. Logs are retained locally under
`tools/logs/model-speed-*`.

This is the test guide for the standalone Mefi's Studio AI+ repository. Run all commands from this repository root.

## Read Before Any Tests

Agent continuation coverage: `tests/executor_resume.test.mjs` exercises the
actual host dispatch, stream/checklist checkpoint writes, new-host recovery,
interrupted-task priority, live/unknown process ownership, Pause and approval
gates, canceled claims, stale writes, storage retries, view reload and final
quit flushes. `tests/assistant_pool.test.mjs` covers replay of the saved role,
target and progress, singleton queue keys, paused continuations, planned-update
retry budgets and the shutdown dispatch fence. Coordinator and task-context
tests retain interrupted records through cleanup and in durable history.
All use isolated fixtures without running paid workers or changing live data.

Validated on 2026-09-19: `npm run check` and `npm run audit` pass (zero
findings). The full Node suite with `--test-concurrency=1` passed 1,196 tests
with one opt-in skip; all 220 Python contracts and six normalized-path checks
passed. The initial default-concurrency `npm test` run failed in existing
Electron audio/rendering/cleanup fixtures and timed out three renderer tests;
all 13 affected-file tests passed sequentially, followed by the full sequential
Node run. Logs are local under `tools/logs/agent-resume-*.log`.
The final 19-test continuation suite also passes after fixing the forced-save
promise race and keeping resumed direct requests under their original identity.

Use the local Node.js and Python contracts for this Electron app:

```powershell
npm run check
npm test
```

`npm run check` verifies package-script targets and JavaScript syntax and runs the spec-collision audit (`npm run check:specs`, `scripts/spec-collisions.mjs`) that enforces the CONTRIBUTING.md test-file conventions. `npm run check:css` (`scripts/check-css.mjs`) is the standalone CSS-refactor safety gate: it computes the cascade-winning declaration for every (selector-context, property, importance) key in a stylesheet and proves a candidate (by default the working copy of `renderer/styles.css`) keeps exactly the same winners as the base ref (by default `HEAD`), reporting missing/changed/new winners and exiting non-zero on divergence. `tests/check_css.test.mjs` pins the winner extraction, cascade-equivalence comparison and the CLI exit codes (`node scripts/check-css.mjs base.css candidate.css` also works on bare files; `npm run check:css -- pre-merge.css post-merge.css` is the same two-file form used to prove a styles.css merge — see "Verifying a session edit-collision handoff" below). `npm run check:css:merge` (`scripts/check-css.mjs --merge`) is the collision-resolution form folded into the same convention: after a styles.css merge conflict it checks **both sides against the merge base** (ours `HEAD`, theirs `MERGE_HEAD`, base their `git merge-base`) and fails when the resolution drops a one-sided winner change, resurrects a one-sided deletion, or settles a both-sides change on neither side's value; it runs inside the `npm run check` chain and is a no-op (`MERGE-CSS-SKIP`, exit 0) when no merge is in progress, with `--theirs <ref>` auditing any branch pair. Guarded by `tests/check_css_merge.test.mjs`. `npm run check:css:unused` (`scripts/check-css.mjs --unused`) is the dead-selector half of the same audit: it scans every `renderer/*.css` (or explicit file arguments), extracts the class tokens of each winner-bearing selector (rules with no declarations carry no winners and are skipped; `@keyframes` internals are not candidates) and flags any selector whose class never appears in the surrounding renderer html/js/css usage, exiting 1 with `UNUSED-SELECTOR` lines; `--allow cls,...` keeps a documented dynamic class out of the report. It also runs inside the `npm run check` chain and stays clean on this tree (`ALL-SELECTORS-USED`). Guarded by `tests/check_css_unused.test.mjs`. `npm test` runs the Node behavioral suite in `tests/`, all Python contracts in `tools/`, and the normalized-path lock proof (`node tools/test_normalized_path_lock.mjs`, the A-Eyes overseer directive's named check) as its closing gate. To investigate one layer or one contract:

```powershell
node --test "tests/**/*.test.mjs"
python -m unittest discover -s tools -p "test_mefi_studio_*.py"
python -m unittest discover -s tools -p "test_mefi_studio_launcher.py"
npm run audit
```

When a worker runs the full Python suite non-interactively, redirect the complete
output to a file and grep the failure out of that file (for example
`python -m unittest discover -s tools -p "test_mefi_studio_*.py" > "$env:TEMP\py_suite.txt" 2>&1`),
never through `Select-Object -Last N`: in run_1789855386972_4 the suite one-shot
`FAILED (failures=1)` (203 tests) and passed on the two following runs, but the
`-Last 5` pipe discarded the traceback, so the flaking test name was lost. The
strongest identified source — the live `main.cjs` duplicate-declaration scan in
`tools/test_mefi_studio_assistant.py` racing a sibling session's in-flight edit —
now re-reads the file through a short settle before failing (real merge
corruption still persists and fails); if a one-shot failure reproduces, capture
the test name from the saved output and pin its fixture the same way.

Full-suite validation in run_1789862198189_7 (2026-09-19): `npm run check`
(61 targets, full coverage; 91 specs, unique basenames, no orphans), `npm test`
(Node 714 tests / 713 pass / 0 fail, Python 211 OK, normalized-path lock proof
6/6) and `npm run audit` (0 findings) all pass on one working tree, after
`npm run build-booklet` re-baked the helix working-ring collision fix that
`renderer/idle.js`'s owner session landed mid-validation. The first full run
failed deterministically in `tests/command_graph.test.mjs` ("all five layouts
leave room for working node rings", helix 47.0px < 47.9px at 1100px) while that
owner session was still editing; per the adopt-don't-clobber rule the edit was
allowed to settle, the file then passed solo, and only the full chain was
re-run and recorded here — a mid-edit failure is a handoff signal first, not
automatically a layout bug.

The Python suite skips Node-dependent checks when Node is unavailable. A hidden Electron smoke runs on Windows when the installed Electron binary exists; its subprocess timeout is 120 seconds. It boots a temporary copy with only the catalog data, isolated Electron profile and board database, and process cleanup disabled in the resource manager. The user's live app state is not used. Install dependencies with `npm ci` before checking or packaging the app.

Ruins Runner is an optional separate checkout. The launcher integration contract uses `MEFI_STUDIO_GAME_ROOT` when set, otherwise the sibling `2d Trippy Hell` folder, and skips when no game checkout is available. It only checks prerequisite files; it does not launch LOVE. Any actual game smoke or game test must follow that checkout's own `TESTRUNS.md` and gated test pipeline. No game runtime or game test tools are required for a clean Studio checkout.

When adding a Python contract, register its path below and ensure it matches `sets.dev.pythonInclude` in `tools/test_sets.json`. The app auditor checks that registration. Node behavioral tests are discovered from `tests/**/*.test.mjs` by `npm test`.

### Local discovery stays scoped to `tools/` and `tests/`

Never run `python -m unittest discover` unscoped from the repository root or
point it at the git-ignored `.local-migration/` tree: Python imports specs by
basename, and that tree used to keep full old-repo snapshots (such as the
`loop-performance-baseline/` performance baseline) whose `test_mefi_studio_*.py`
copies duplicated the live `tools/` basenames and would silently shadow the live
contracts. Per CONTRIBUTING.md rule 1 all `.local-migration/` spec copies have
been pruned — the snapshots keep only non-spec sources and data — and Studio's
runners (`npm test`, `npm run check:specs`) never scan that folder anyway.
Always discover with `-s tools` (npm test) or `node --test` on `tests/`,
exactly as written above.

### Verifying a session edit-collision handoff

A-Eyes files a collision when two sessions touch one file. Most are handoffs,
not live clashes: adopt the owner session's edits and add missing pieces rather
than clobbering. Before treating one as resolved, check the merged working tree
(never re-edit from the brief alone) and name the checks that prove it: each
touched file must parse (`node --check`, `python -m py_compile`, JSON parse),
its own narrow contract must pass (for example
`node --test tests/boot_poll_visibility.test.mjs`,
`python -m unittest discover -s tools -p "test_mefi_studio_updater.py"`), and
`npm run check` must stay green so the `check`/`test` chains still list only
files that exist. A resolved handoff needs no re-edit; say so and cite the
named checks.

For `renderer/styles.css` collisions, prove the merge with the CSS gate
instead of eyeballing diffs. Snapshot the pre-merge copy before resolving,
then run:

```powershell
npm run check:css -- pre-merge.css post-merge.css
```

The two-file mode compares any two stylesheets winner for winner and exits 0
only on `CASCADE-EQUIVALENT` (exit 1 lists `MISSING`/`DIFFERENT`/`NEW WINNER`
lines; exit 2 is a usage or read error). With no file arguments the gate
defaults to HEAD-vs-worktree: it compares `HEAD:renderer/styles.css` against
the working copy, which is the check to run before committing a CSS refactor;
`--git <ref>` selects another base ref and `--unused` flags selectors whose
classes appear in no renderer html/js/css usage.

For a live merge conflict, `--merge` proves the resolution against both sides
and the merge base — `npm run check:css:merge` (also a step in the
`npm run check` chain): ours is `HEAD`, theirs is `MERGE_HEAD` (or
`--theirs <ref>` for any branch pair), the base is their `git merge-base`,
and the gate exits 1 with `MERGE-LOST` (a one-sided winner change the
resolution dropped), `MERGE-UNDELETED` (a one-sided deletion the resolution
revived) or `MERGE-UNRESOLVED` (a both-sides change settled on neither
side's value — `MERGE-DECISION` lines record the keys where one side was
deliberately picked), plus exit 1 while conflict markers are still present.
It skips with `MERGE-CSS-SKIP`/exit 0 when no merge is in progress, so the
check chain stays green between merges. Guarded by
`tests/check_css_merge.test.mjs` (pure winner-intent fixtures plus a
per-run temp git repo driven through a real conflicted merge). The two-file
snapshot form above remains the fallback for handoffs already committed
without a live merge.

The 2026-09-19 A-Eyes collision batch (test_mefi_studio_catalog.py,
test_mefi_studio_idle.py, package.json + scripts/check-css.mjs) was verified
resolved as handoffs in commit `11acd9a`, with no re-edit needed: every file
parses (`python -m py_compile`-equivalent AST parse for the two contracts,
`JSON.parse` for package.json, `node --check` for check-css.mjs), no duplicate
test names or script keys survived either session's edits, and the named
checks pass — `python tools/test_mefi_studio_catalog.py` (7/7),
`python tools/test_mefi_studio_idle.py` (18/18),
`node scripts/check-css.mjs` / `--merge` / `--unused` (all exit 0), and
`npm run check` (check-targets full coverage, spec-collisions clean,
MERGE-CSS-SKIP) stays green with both sessions' work adopted.

Assistant animation regressions run with `node --test tests/command_motion.test.mjs
tests/tree3d_performance.test.mjs tests/command_render.test.mjs`. They cover
frame-rate independent movement, stable positions and orbit slots across roster
updates, camera pans, short status gaps, interrupted departures, reduced motion,
and returning/fading agents. The isolated Electron fixture also samples actual
painted positions while work moves between tasks and completes; it launches no
workers and makes no external calls.

Validated after the animation changes: rebuilt booklet, `npm run check`,
`npm test` (809 Node passes, one opt-in skip, 211 Python passes and all six
normalized-path ownership checks), and `npm run audit` (zero findings).

Audio-link regression coverage runs with `node --test
tests/command_audio_sources.test.mjs tests/command_audio_response.test.mjs
tests/command_audio_spectrum.test.mjs tests/music.test.mjs
tests/command_graph.test.mjs tests/command_render.test.mjs`.
It covers explicit versus automatic sources, late capture cleanup, pause and
retry status, saved response strength, stable frequency voices and bounded node
lighting. Preference tests cover the gentle 35% default, one-time migration,
true zero response and independently saved wave, node, percussion, background
and frequency-splitting toggles without changing playback or capture. Split
connections retain their bass/mid/treble assignment across graph updates, mask
other bands and leave base tethers unchanged when their own band is silent.
Low-response checks bound wave travel and scale optional drum brightness and
stroke width. Adaptive spectrum tests cover quiet and loud levels, sudden volume
drops, independent low/mid/high attacks, sustained bass, signed waveforms and
silence at multiple sample and frame rates. Connection tests cover curved and
straight paths, anchored ends, time-varying displacement, bounded vertex counts,
all frequency voices, and cleanup without changing task relationships.
The isolated Electron fixture plays an in-memory float WAV through the real
local player and analyser, with quiet/loud mixes, bass, drum and treble sections.
It checks actual stroked wave paths and displaced pixels, node lighting, silence
release, and unchanged node positions and labels. It never requests OS capture
or starts workers. Native checkbox and slider checks independently disable
waves and nodes, settle both at 0% while playback continues, restore 35%, and
retain frequency assignments across redraws and a split/full-mix round trip.
Pixel and control samples wait for the current graph paint in the renderer;
a forced refresh immediately before sampling covers the model/projection race.
Failures read the saved Electron report before fixture cleanup.
Optional `MEFI_AUDIO_CAPTURE`, `MEFI_AUDIO_QUIET_CAPTURE`,
`MEFI_AUDIO_WAVE_CAPTURE` and `MEFI_AUDIO_CONTROLS_CAPTURE` absolute paths save
local visual evidence.

Validated on 2026-09-19: rebuilt booklet, `npm run check`, `npm run audit`
(zero findings), and `npm test` (878 Node passes, one opt-in skip, 211 Python
passes, six normalized-path checks). The audio fixture also passed in isolation
across an 80 dB quiet/loud input change, with independently exercised bass,
midrange drums and high percussion. Local screenshots verify the painted waves.
Control checks cover disconnecting an empty local queue and avoiding repeated
live announcements while adjusting Response.

Calmer controls and frequency routing validated on 2026-09-19: rebuilt booklet,
`npm run check` and `npm run audit` passed (zero findings). All 20 response
regressions and 26 Music control tests passed. The real Electron audio fixture
passed both alone and in the combined suite after fixing its graph-paint race.
The final combined `npm test` run passed 1005 Node tests, skipped one and failed
one unrelated profiler JSON-download timeout in `tests/performance_render.test.mjs`.
Both profiler Electron tests passed in a separate targeted rerun; the combined
timeout's exact cause remains unconfirmed (`tools/logs/audio-profiler-triage.log`).
All 211 Python contracts and six normalized-path checks passed separately; the
full-suite gate remains unpassed. Complete logs are retained locally as
`tools/logs/audio-calm-final.log`, `tools/logs/audio-calm-python.log`,
`tools/logs/audio-calm-check.log` and `tools/logs/audio-calm-audit.log`.

## Python contracts

| Contract | Coverage |
|---|---|
| `tools/test_mefi_studio_catalog.py` | Mefi's Studio AI+ (repository root) catalog contract: offline snapshot shape and unique ids, typical-request cost recomputed from price + token mix, quality indices only with a declared `AA`/`AA*` source and a recorded AA index version (never guessed), plan caps in `{15, 30, 60, unlimited}`, promos carrying their base cap, task-preset weights summing to 1, and endpoint-map resolution. The live committed-catalog loads (`setUpClass` reading `data/models.json` + `data/curated.json`) are guarded by the shared `tools/flake_capture.py` retry: parallel agent runs can be caught mid catalog rebuild (atomic rename, OneDrive hydration), so a one-shot failure that clears on immediate re-run is recorded to `data/python-flake-capture.jsonl` (local only) and surfaced as a skip instead of failing the gate; a failure that reproduces re-raises the original. No network, no Node. |
| `tools/test_mefi_studio_booklet.py` | Mefi's Studio AI+ booklet contract: the built `renderer/booklet.html` bakes exactly the snapshot catalog, stays self-contained (no `<script src>`, no `<link>`, no remote resources), keeps the refresh-on-open markers (`no-store`, six-hour focus refresh, `mefiStudio.readCatalog`), and ships print styles; template placeholders and Node syntax checks when Node exists. The behavioral half is `tests/booklet_build.test.mjs` (`node --test tests/booklet_build.test.mjs` from the repository root, part of `npm test`): the real `scripts/build-booklet.mjs` `build()` runs on a fixture root (committed template + styles + renderer scripts, a two-model catalog) and the smoke asserts the output `booklet.html` exists and is non-empty with all three placeholders replaced, non-empty baked style/code blocks, the baked catalog matching the fixture, a rebuild over identical inputs reporting `changed:false`, and a missing renderer input rejecting with no output written. |
| `tools/test_mefi_studio_launcher.py` | Mefi's Studio AI+ launcher contract: Electron entry `main.cjs` with pinned electron, windowed `love.exe` on `dev/dev_tool_love_project` with the optional game checkout (`GAME_ROOT`) as cwd, never `lovec.exe` for interactive launches, smoke only through `Run Dev Tool (LOVE2D).cmd --smoke`, taskkill cleanup, the `ELECTRON_RUN_AS_NODE` guard, the preload IPC surface (catalog, studio, speed probe, A-Eyes), the `capture` script, and the renderer staying node-free. When Electron is installed on a Windows runner it also boots the real hidden `--smoke` window and asserts the rendered card count. |
| `tools/test_mefi_studio_eyes.py` | A-Eyes contracts: the OpenCode store is opened read-only, the main process registers the eyes IPC + 1.5 s activity poll, the preload exposes the bridge, the Club Blackout tokens and 3D task-tree rail exist, and a **fixture OpenCode database** is dumped through the real `scripts/eyes.mjs` to pin change math (edit diff `+2/-1`, write content `+3`, patch file sets, reads excluded from changes but present in activity), collision detection with owners and `HH:MM–HH:MM` overlap windows (shared-window prompts, gap-tolerated handoffs labelled edit spans; the explorer rows and detail tooltips show the same ranges), overlap-window validation in request inputs (overlapRangeOf: corrupt/NaN/inverted windows normalize to null, zero-length windows stay real), and boundary coverage (adjacent windows touching at one instant, a gap of exactly overlapMs inclusive vs one past it excluded, contained windows intersecting to the inner session's window, a three-session nested group whose common intersection is the innermost session's single instant, and zero-length single-instant pairs), inactive-owner handoff (confirm before further edits; ownership is not silently reassigned), `assistantFacts()` carrying owner/ownership/presence/handoff and uncommitted-only features vs HEAD (session-touched dirty/untracked files; deletes and untouched dirty files omitted), live `assistantFacts({ root: REPO_ROOT })`, the live store + executor reading that presence, the collisions IPC returning live file presence, the explorer collateral watch listing live solo editors (even with no briefing) plus per-file owners, duplicate-declaration merge-corruption requests, title-overlap adopt-don't-clobber advice, and briefing-to-fix-request conversion; the renderer poll pause — boot.js's shared poll guard (every `pollStart` clears before it sets, so a hidden tab issues no fetch and hide/show toggles never stack intervals) with nav.js's badge poll registered through it, pinned in source and in the built `booklet.html`. Its fixture databases are built only by the shared `_fixture_db`/`_boundary_db` helpers inside per-run `tempfile.TemporaryDirectory()` dirs — unique fixture naming, pinned by the contract itself (`test_fixture_databases_use_unique_per_run_temp_dirs`) so two sessions can run the suite concurrently without re-colliding, and the module pins its own unique basename against the unittest-discovery shadow that `npm run check:specs` guards repo-wide. Node-only half skips cleanly without Node. Re-verified 2026-09-20 (run_1789892663373_3, idle-session false alert fix): `python tools/test_mefi_studio_eyes.py` 18/18 OK, `node --test tests/eyes_missing_store.test.mjs` 2/2, `python tools/test_mefi_studio_assistant.py` 66/66, `npm run check` ok; `listSessions` now reports a session whose final part is a step-finish with reason "stop" as `finished` (fixture: ses_a stop → true, ses_b tool-calls → false), `assistantFacts` carries the flag, and the A-Eyes review prompt may not alert finished sessions as idle/stalled/unscoped — the live session `ses_f426eaf6bffeD1yfipKpRBQjOL` (the "Idle session lacks recorded work" false alarm) reads back `finished: true`. |
| `tools/test_mefi_studio_auditor.py` | The third agent's contract: runs the real local auditor (`scripts/auditor.mjs`) against the repo and fails on any error-level finding — un-bundled renderer scripts, preload channels without main handlers, listened events nothing sends, renderer DOM lookups missing from the template, studio tests missing from TESTRUNS/`test_sets.json`, npm script targets that do not exist, and unparseable data files. Also pins the auditor/checkpoint IPC wiring, and the package.json `check` chain leading with the check-targets audit (`scripts/check-targets.mjs`, `npm run check:targets`): every referenced target exists on disk, node paths in other scripts are not stale, and every `scripts/*.mjs` + `renderer/*.js` source (plus the `main` entry) is covered by the chain — the behavioral half is `tests/check_targets.test.mjs` (`node --test tests/` from the repository root, part of `npm test`). Both live-tree probes (the auditor run and the check-targets coverage walk) are guarded by the shared `tools/flake_capture.py` retry: the suite audits a tree that parallel agent runs edit concurrently, so a one-shot failure that clears on immediate re-run is recorded to `data/python-flake-capture.jsonl` (local only) and surfaced as a skip instead of failing the gate — the capture that names which test flaked (the "203 tests, failures=1 then passed twice" occurrence); a failure that reproduces re-raises the original. No network, no key, no Electron. |
| `tools/test_mefi_studio_analyzer.py` | Analyzer contracts: runs the real engine (`scripts/analyzer.mjs`) against a fixture work tree — file analysis finds outline entries, TODO markers, and referenced paths that exist vs are missing, while idea verification reports related work with evidence hits for grounded ideas and `new`/0% for nonsense. Also pins the analyzer IPC/preload/overlay wiring. No network, no key. |
| `tools/test_mefi_studio_idle.py` | Dream mode contracts: the five-minute quiet clock and input reset, the four Zen audio profiles with slow/quick tempo mapping, the task-vs-external split (edit/write/patch pulse the path, reads/searches vaporize as blue-white particles), per-path touch brightness that fades and brightens when multiple agents share a path, and the idle-only collision negative case (`test_collision_boost_only_marks_live_activity`): `checkCollisions` adopts only `entry.active === true` sessions — never the legacy string shape — for both collision groups and presence editors, so a settled idle-only group never enters the live set and the collision tint plus amber rim cannot fire on it; the `MefiTree.snapshot` API the view renders from, bundled `idle.js`, template HUD ids, and the Electron autoplay policy that lets bells play without a gesture. Verified 2026-09-19 (run_1789869685873_3): `python tools/test_mefi_studio_idle.py` 18/18 OK, `node --check renderer/idle.js` exit 0, booklet rebuild in sync (stable hash f98dd2322a01). |
| `tools/test_mefi_studio_tasks.py` | Task/reference/ideas contracts: the real reference engine (`scripts/reference.mjs`) against fixture data — code hits, matching node-tree sessions, chat idea scanning, PNG name matching, and web staying off unless asked; plus the tasks/ideas/prefs IPC + preload wiring and the tasks/ideas/overhead overlay templates with their toggles (web, node history, blur menu, auto reference). No network. |
| `tools/test_mefi_studio_machine.py` | Machine coordination contracts: fixtures through the real `scripts/machine.mjs` — live vs dead lease records (a dead exclusive lease must not block width, stale holders are reported not pruned), and process classification into healthy / hang (no CPU progress) / orphan (dead parent) / over-age, with only strays killable. Pins the resource-manager IPC + preload + explorer Machine panel, the briefing facts carrying lease/run state, and the gitignored generated status files. Both fixtures are built only inside per-run `tempfile.TemporaryDirectory()` dirs — every `--classify-fixture`/`--leases-fixture` hand-off reads a path derived from that run's own temp dir, pinned by the suite itself (`test_fixtures_use_unique_per_run_temp_dirs`) so concurrent runs never share fixture paths. No PowerShell or LOVE is launched. Re-verified 2026-09-20 (run_1789899771330_12, lag-gating overlap fix committed): `node --test tests/machine_capacity.test.mjs` 16/16 (includes the zero-lag recovery-sample test — a latched hold cites the pending responsive readings, never the healthy 0 ms sample), `python tools/test_mefi_studio_machine.py` 6/6 OK. The foreman-side counterpart `scripts/assistant.mjs` `createMachineLagGate` (two consecutive strictly-above samples hold, one spike is only a resample, any finite at-or-below reading resets the streak, non-finite readings are never evidence) and its `--lag-gate-fixture` CLI replay are pinned by `tests/assistant_lag_gate.test.mjs`; re-verified 2026-09-20 (run_1789902527718_37) 7/7. The live consumer is the foreman: `main.cjs` `spawnNextJob`'s `readCapacity` lazily creates one shared gate (`machineLagGate ??= assistant.createMachineLagGate({ threshold: 100 })`, mirroring the sampler's `lagBusyMs`), samples it after every fresh `measureWorkerLag` reading (a hidden window's null never advances the streak), forces `canStart:false` with a two-sample reason on hold while exposing the verdict as `lagGate` on the capacity object the briefing facts read, drops the gate when `applyModules` hot-swaps `scripts/assistant.mjs`, and leaves machine.mjs's latched hold in charge (host lag, single critical spikes, recovery hysteresis) — pinned by `tests/foreman_lag_gate.test.mjs`; re-verified 2026-09-20 (run_1789904197969_2) 5/5, and 28/28 alongside `tests/assistant_lag_gate.test.mjs` + `tests/machine_capacity.test.mjs` with `npm run check` clean. Fixed 2026-09-20 (run_1789918519136_24, self-blocking start hold): the gate had counted cached replays of one `measureWorkerLag` probe (the 750 ms cache and in-flight joins hand the same reading to several admission reads), manufacturing "two samples in a row" from a single spike — the reported "renderer lag 1000 ms" hold while both sessions ran. Each probe now carries an id on the sampler cache and is counted once (replays reuse the recorded verdict), and a live hold forces a fresh probe on every read so the hold rests on current evidence and lifts on the first responsive reading instead of coasting on cached lag; re-verified 2026-09-20 6/6 in `tests/foreman_lag_gate.test.mjs` (new probe-once/re-sample behavioral test), 103/103 across the executor/machine/lag suites, `npm run check` clean. |
| `tools/test_mefi_studio_fixture_paths.py` | Generalized unique-fixture contract sweeping every sibling `tools/test_mefi_studio_*.py` suite so no contract can regress to shared fixture paths (the recurrence behind the A-Eyes eyes-test collisions and the flaky machine lease fixture): no suite writes a fixture into the repository tree (no repo-anchored `write_*` target, no repo-anchored `.db` path) or the shared `tools/logs` evidence tree, every `tempfile.TemporaryDirectory(` usage is a context-managed per-run block, and no suite shares a discovery basename with a sibling (the unittest-shadow rule `npm run check:specs` guards repo-wide). Generalizes the per-suite pins in `test_mefi_studio_eyes.py` (`test_fixture_databases_use_unique_per_run_temp_dirs`) and `test_mefi_studio_machine.py` (`test_fixtures_use_unique_per_run_temp_dirs`). Pure source scan: no network, no Node. |
| `tools/test_mefi_studio_updater.py` | Live-update contracts: fixture trees through the real `scripts/updater.mjs` — the reload/restart/ignore classify table (renderer scripts and styles reload, `main.cjs`/`preload.cjs`/`package.json`/`scripts/**`/`assets/**` restart, generated `booklet.html`, `data/`, `dist/`, dotfiles and editor temp files ignored, restart winning over reload), content-hashed snapshot + diff against a cheap stat poll, payload sync that creates and deletes but never touches the payload's live `data/` — and that reports one unreplaceable destination instead of aborting the rest, leaves no `.sync-tmp` behind and holds the update rather than reloading or relaunching into a half-written payload, retrying the whole held set once the lock clears — syntax validation that holds a broken file instead of relaunching into a crash, reading `renderer/*.js` with the booklet's classic-script goal (a top-level `await`/`import`/`export` is held) while `main.cjs` and `scripts/**.mjs` keep `node --check`, the quiet-period debounce restarting on every notify so a write burst longer than the quiet period is still one action, and `maxWaitMs` forcing a pass through an endless burst, the idle safety-net poll pausing while the window is hidden (the host's `hidden` probe) and backing off on unchanged reads toward `POLL_MAX_MS` (`POLL_INTERVAL_MS`/`POLL_BACKOFF_FACTOR` exported, snapped back by any watcher hint or change, so a change made while hidden still applies on the first visible walk and no surface goes stale; `renderer/overhead.js`'s sheet poll carries the same pause/backoff, its `window.MefiOverhead` export pinned only to the `open`/`close` consumer surface (not a verbatim member list) in source and in the built `booklet.html`), manual apply while auto-restart is off (including an apply that lands mid-run, which is queued and still applied), the three-restarts-in-60-seconds loop guard checked before the build so a held restart never leaves the payload ahead of the process, and the packaged Electron-runtime guard. Also builds the booklet into a temp root through the exported `build({ root })` without touching the committed one, and pins the wiring: `update:status`/`update:set`/`update:apply` IPC, the preload names, the template's update ids, the SMOKE/CAPTURE/CLI skip, and the `--updated` relaunch; and runs `main.cjs`'s own `applyRestart` and `update:apply` handler against the engine, so a manual "Restart now" stays out of the restart-loop history (three presses do not hold the next real update), an apply queued behind a run in flight never relaunches the app, and neither does a deferred or held apply. The sleep-timing probes on the real engine — the debounce burst test and the idle-poll pause/backoff test — plus the build-test's live `data/models.json` comparison read are guarded by the shared `tools/flake_capture.py` retry: a machine loaded by parallel agent runs can transiently overrun the quiet period, and the live catalog read belongs to the same flake family as the catalog suite's `setUpClass` loads, so a one-shot failure that clears on immediate re-run is recorded to `data/python-flake-capture.jsonl` (local only) and surfaced as a skip instead of failing the gate; a failure that reproduces re-raises the original. No Electron, no network; the Node half skips cleanly without Node. |
| `tests/release_updater.test.mjs` | GitHub release-update contracts through the real `scripts/release-updater.mjs`: semver parsing and precedence (`v` prefix, prerelease ordering), release normalization choosing the platform zip plus its `.sha256` sibling and API digest, the `releases/latest` check (newer/equal/older, private-repo 404 token hint, 401/403 refusal, missing zip asset, malformed tag, offline) with a fake fetch recording URL and Authorization, streaming download to disk with sha256 and progress, checksum parsing, the dependency-free streaming zip writer + central-directory extractor round-tripping nested/unicode/payload entries, zip-slip refusal on a crafted archive, staging that finds the portable root and rejects a non-portable archive, and the PowerShell apply helper (`Wait-Process` on the host pid, robocopy with the `resources/app/data` exclusion, `--released <version>` relaunch, cleanup, apostrophe escaping). Pins the wiring: `main.cjs`'s watcher reads the module's 20-minute `CHECK_INTERVAL_MS`, exposes `release:status/check/apply`, resolves a saved/`gh` token and announces `--released`; preload, the template and `nav.js` carry the button. |
| `tools/test_mefi_studio_routing.py` | Provider routing and coding-CLI contracts for Mefi's Studio AI+: the z.ai key lives in its own `zaiApiKeyEncrypted` field (headless `MEFI_STUDIO_ZAI_KEY` + `--set-zai-key` included), only a saved/encrypted status crosses `settings:get-key` IPC — never the raw key, which is also never interpolated into logs or prompts; the assistant router walks the owner's ordered auto provider list (`aiAutoProviders`; default z.ai > OpenCode, first usable wins, `aiAutoFallback` — formerly `aiFallbackOpenCode` — walking the HTTP entries on failure), explicit `zai` errors rather than silently billing OpenCode, explicit `opencode` never touches the z.ai key; glm-5.3-flash is the routine route and glm-5.3 the heavy one (improve/overseer passes) with its own `thinking.type`/`reasoning_effort` shape; autopilot `opencode run` jobs ride the Studio-managed `mefi-zai` provider via `OPENCODE_CONFIG_CONTENT` + `MEFI_ZAI_API_KEY` process env (key never written to OpenCode's auth store); the CLI panel detects `opencode`/`codex`/`claude` via `where.exe`, launches them detached, and the z.ai link probe runs `opencode models mefi-zai` under the injected env; the speed probe splits glm-* models onto `ZAI_API_KEY` + the coding-plan endpoint and keeps the `x-opencode-session` header off z.ai. Claude Code rides its own subscription login through headless `claude -p` (prompt on stdin, `--tools=` for replies, `--dangerously-skip-permissions` for builders, no Anthropic API key), LM Studio answers keyless from its loopback server with endpoint normalization and a `/v1/models` fallback, and the custom route pairs any OpenAI-compatible URL with its own encrypted `customApiKeyEncrypted` field (`--set-custom-key` / `MEFI_STUDIO_CUSTOM_KEY`). When `node` and `opencode` are on PATH a live half runs the real `zaiProviderConfig()` through `opencode models mefi-zai --pure`; that half skips cleanly without them. No paid API call is ever made. |
| `tools/test_mefi_studio_tree_keyboard.py` | Tree-rail keyboard + ARIA contracts for Mefi's Studio AI+ (`renderer/tree3d.js`): the template ships `#tree-canvas` as a labelled, focusable `role="tree"` container and `init()` re-asserts that over one hidden `role="treeitem"` proxy it owns via `aria-owns`; `onCanvasKeyDown` keeps the ArrowUp/Down/Left/Right sibling walk (Home/End to the ends, Escape dropping the focus, every branch preventDefault'd), Enter/Space activate through the same `activateNode` path the click handler uses (selection rides `mefi:tree-select`), and `setKbdFocus` keeps the roving `aria-activedescendant` on `tree-kbd-item` with the focused node's label and `aria-selected` state, cleared on blur and Escape, with `buildGraph` re-pointing the focus after a rebuild. Removing any binding fails the file. The behavioral half is `tests/tree3d_keyboard.test.mjs` (`node --test tests/tree3d_keyboard.test.mjs` from the repository root): tree3d.js runs against a minimal DOM stub, synthetic ArrowDown/ArrowUp/Enter/Space/Home/Escape events drive the rail, and the test asserts the selection moves between two sessions and toggles off, the proxy announces each node's label with `aria-selected` in step, and the activedescendant follows the focus and clears. Re-verified 2026-09-19 in run_1789852550913_2: the behavioral half passes solo, passes in one shared process with the palette suite (`--test-isolation=none`, the `?keyboard-test` import keeps tree3d.js out of the shared module cache), and passes four times concurrently as separate processes; `tests/spec_collisions.test.mjs` is 4/4 and `npm run check:specs` reports 82 specs with unique basenames and no orphans. |
| `tools/test_mefi_studio_palette.py` | Command palette contracts for Mefi's Studio AI+ (`renderer/palette.js`): the window keydown handler keeps its Escape branch (preventDefault then `close()`, the guarded close that also restores opener focus), and the roving `aria-activedescendant` stays bound to the `#palette-input` element itself — set to the active option id in `setActiveOption`, cleared when the result list empties and again in `close()`, on an input the template ships with `id="palette-input"` and the `combobox` role. The highlight chain is pinned end to end: `render()` writes the `palette-option-N` ids, `aria-selected` and the `.active` class from `state.index` and refreshes `setActiveOption()` on both the empty and populated paths, `setActiveOption` reads the `li.active` row, and the shared ArrowUp/ArrowDown branch preventDefaults, wraps `state.index` around both ends of the filtered list (Down past the last row lands on the first, Up from the first lands on the last, within the 40 rows shown, and an empty list is a no-op) and re-renders in that order. Escape's restore is pinned too: `open()` captures the opener before claiming the layer, `close()` releases the nav layer before `restoreOpener()`, and the restore refocuses only a connected, unhidden, non-body opener once, dropping it afterwards. The pointer path stays focus-free: option rows never take a tabindex and the hover/click handlers never call `.focus()`, while the CSS gives the input and the option rows an outline only under `:focus-visible` (plain `:focus` suppresses the shared input ring instead), pinned in `styles.css` and the built `booklet.html`. Removing any binding fails the file. The behavioral half is `tests/palette_keyboard.test.mjs` (`node --test tests/palette_keyboard.test.mjs` from the repository root): palette.js runs against a minimal DOM stub, synthetic window keydown events drive the list over three destinations, and the test asserts ArrowDown wraps last-to-first and ArrowUp wraps first-to-last with `aria-activedescendant` following, Escape closes and hands focus back to the opener element, and reopening from a second opener then running Enter executes the active destination and restores that opener too. Re-verified 2026-09-19 in run_1789852777607_4: the behavioral half passes solo, passes in one shared process with the tree3d keyboard suite (`--test-isolation=none`, the `?keyboard-test` import keeps palette.js out of the shared module cache), and passes four times concurrently as separate processes. Re-verified 2026-09-19 in run_1789853206630_8 with a strengthened suite: a `type()` helper fires the input listeners for real so the wrap span is exercised against filtered sets too (a one-row `task` query wraps onto itself and a two-row `bo` query wraps ArrowUp first-to-last and back), each followed by an Escape that still restores the opener. Re-verified 2026-09-19 in run_1789854441344_3: the behavioral half passes solo and in one shared process with the tree3d keyboard suite (--test-isolation=none), and the contract half tools/test_mefi_studio_palette.py is 8/8 OK. Re-verified 2026-09-19 in run_1789867745068_11: 5/5 solo, with the filtered-session Escape now asserted preventDefault'd and aria-expanded=false alongside the opener restore. |
| `tools/test_mefi_studio_assistant.py` | Always-on assistant contracts: fixtures through the real `scripts/assistant.mjs` — tree organisation into active / working / stale / folded with a capped display order and hidden folded todos, housekeeping (done tasks archived after 24 h with a log line, ideas and completion history retained, resolved audit and collision requests and 3-day-old auto requests cleared, exact duplicates deduped, manual requests never touched, checkpoints of vanished sessions dropped and lists capped at 50, `changed:false` on a second pass), intent routing for a dozen phrasings (punctuation and casing ignored, a leading imperative verb becomes a request), grounded local replies (counts from the fixture, "put on the task board as the next piece of work" for requests, help listing the commands, unreadable facts named instead of invented), the 5/10/20/40/60-minute AI backoff table and `normalizeState` on garbage, and the agent pool: the ordered role roster with cadences, `dueRoles` (cadence elapsed, queued/running never re-enqueued, the briefer gated on proactive + key + backoff), `applyAgentEvent` roster transitions with accurate `pool.running/queued` counts and the combined action text, running rows reset to idle on load, `parallel`/`aiParallel` prefs clamped, and "N agents working" on the tree summary; and the work journal: `pendingWork` on the raw saved state (in-flight jobs, unanswered messages, interrupted roles, closed-for time), `applyWork` add/update/remove with the cap of 40, the `resumeSummary` boot line, the `resume-work` intent and the status reply listing what is being worked on. Also pins the wiring: `assistant:state/message/control/prefs` IPC and the preload names, `startAssistant` scheduled from `app.whenReady` with a `setTimeout` chain (no `setInterval`), `powerSaveBlocker`, the gitignored `data/eyes-assistant.json`, the Explorer composer/thread/activity ids and the Command view pill, tree3d and idle.js handling the `assistant` and `folded` node kinds, the `M` key in the help rows, and the README's "Always-on assistant" section. Node focus: `state.focus` normalization, the `focused on …` tree sublabel, replies naming the focused node when nothing else matches, `assistant:focus` IPC + `assistantFocus` preload, `assistantFocusSubject` grounding the responder's hop and claiming a focused session on the queued request, and the rail/Command click → `focusAssistant` wiring with the ring, pulse and card row. The overseer — the R&D layer above the assistant — is pinned too: `state.overseer` playbook normalisation on garbage, `overseerDigest` telemetry (error roles, unanswered replies, stale journal jobs, AI health), the deterministic `overseerReview` (a finding that repeats becomes a lesson, `overseerMerge` dedupes lessons by text and rolls the score history), `overseerTune` clamped to the safe pref bands, the stale-session rescue plan (`staleRescues`: oldest first, capped per pass, deduped against the inbox/history/board on the title key, horizon from the policy; the digest carries the tree's stale count and oldest quiet time and the review files a stale-sessions finding), the repair-pass wiring that files the rescues as `overseer` requests and hands the staliest session to the assistant's focus, the `overseer` intent + reply, `ASSISTANT_OVERSEER_SYSTEM` / `assistantOverseerJob` / `assistant:control overseer` wiring, the Oversee buttons, and the satellite drawn above the assistant node. Node folders — every session/todo/task node acting as a folder for its own context — are pinned too: `state.nodeFolders` normalisation on junk, `applyNodeContext` append/dedupe/cap (8 entries, junk ignored), `nodeFolderLines` formatting, `clearNodeFolder`, the keeper's tidy cleaning finished nodes' folders (task gone or archived/done past the tidy clock, session gone and quiet past the checkpoint horizon, entries older than 7 days pruned, `foldersCleaned` counted in the housekeeping text), the facts carrying the focused node's folder and replies quoting it (`Folder: …`), and the wiring: the executor's run verdicts / reference gathers / chat replies / owner notes landing on folders (`assistant:node-context` IPC + `assistantNodeContext` preload), and the Command card's *Context folder* section (`appendNodeFolder`). Also covered by the behavioral board-invariant suite `tests/board.test.mjs` (`node --test tests/` from the repository root, or `npm test` there): fixtures through the pure module pin the idea-scan delta race (a stale snapshot cannot revert promotion), same-theme plan merges (membership unioned, prompt rebuilt, every idea rewired to the survivor), optional explicitly configured plan expiration relinking ideas without discarding old obligations, dangling-link repair, file-scoped Fix families, claim-sparing duplicate collapse, the `ownershipFence` settlement rule, and the housekeeping sweep (stuck claims requeue, chat requests never age out, claimed copies win title collapse), plus the AI review's task groups folding near-duplicate open tasks into plans (obligations carried in the prompt, ideas relinked, claimed members and unknown titles spared, taken themes never re-minted, capped membership, grouped plans retained by default like idea plans).  The board's SQLite store (`scripts/eyes.mjs` `enableBoardStore`/`boardMutate`) has its own behavioral suite in `tests/board_store.test.mjs`: round-trip fidelity of arbitrary row fields, ordering preservation, first-run migration from the JSON views with DB-wins afterwards, in-place mutation persisting through `boardMutate`, no-op passes writing nothing, throwing mutators rolling the whole `BEGIN IMMEDIATE` transaction back, view files refreshing on commit, the cross-process claim race (N `tests/fixtures/claim_worker.mjs` racers, one winner), and the concurrent executor smoke (`tests/fixtures/executor_slot.mjs`): more parallel-executor slots than open tasks drain the board with no double claims, every settled card in `awaiting_verification` behind the ownership fence, and a `{pid, at}` collision lease naming the claiming slot. No network, no key, no Electron; the Node half skips cleanly without Node. The Policy Lab suites (`tests/policy*.test.mjs`, same `node --test tests/` invocation / `npm test`) pin the lab's contracts: the baseline policy port matching `compareWork`'s frozen ordering (worth bands, oldest inside a band, pins by recency, the age-direction trap), bounded allowlisted config validation with content-hashed identities, operator controls a policy cannot move (pause ⇒ empty batch, locked pins always first, concurrency clamped to the offered maximum, repeated observations cannot inflate obligations), receipt trust labels (runner-observed edits are the only positive learning label; worker-named checks stay `self-reported`; partial/failed/missing evidence never positive; prompts hashed not stored; unknown cost stays null), append-only event/receipt stores with torn-tail tolerance and refused invalid events, episode trees with retry/handoff/paraphrase lineage and descendant cost rollup, whole-root-intent chronological splits that refuse a straddling duplicate, read-only prompt-free dataset export, masked replay (no outcome keys in observations, off-frontier picks flagged, UNSUPPORTED selections gain nothing and cost nothing, represented costs charged on reveal, budget-truncation reports itself censored, stopping a branch preserves outstanding obligations, two policies cannot mutate the dataset, the baseline follows the recorded picks), invariant gates hard-rejecting lock-ignoring / concurrency-bursting / obligation-losing candidates, the incumbent always present in the comparison with verified work untradeable for cost, honest empty-store reporting with no claims, byte-reproducible report artifacts, consented atomic crash-safe promotion (a crash leaves exactly one active version) with rollback changing future dispatch only, and source pins that main.cjs keeps the recorder observation-only (records are never awaited, failures swallowed, smoke/capture/CLI stay silent, receipts appended outside the housekeeping transaction, live activation disabled with dispatch frozen on the baseline). The Jev intake-classifier suites (`tests/jev.test.mjs`, same invocation) pin the decision client and builders: gateway config defaults and clamps, key resolution (env wins, then the DPAPI-encrypted `gatewayApiKeyEncrypted`; never logged, never in a tracked file), the evaluation wire (`/v4/ai/evaluation-model` with the gateway protocol/spec headers, the model id riding `ai-model-id`, id-keyed questions with choice criteria maps, `noul`→boolean mapping, state clipping, score-unmapped errors), strict question-spec and answer validation (out-of-option choices, unknown question ids, wrong answer shapes, missing answers and prose-without-JSON are errors, never guesses), classify() against a stub fetch (validated answers plus chargeable `modelCalls`/token usage, transport/HTTP/unusable-reply failures, timeout abort), `listModels`, self-contained question prompts that name both compared sides, deterministic retrieval that refuses near-zero-overlap comparisons (`retrieveCandidate`), conservative interpretation (only exact `same_obligation` attaches evidence without merging records; `adds_scope` proposes a linked follow-up; uncertainty holds for review; a claimed resolution routes to verification and is never itself evidence), `jev-proposal` experience events that validate and stay invisible to episode construction, the shadow-intake wiring pins (hooked fire-and-forget after the admission mutation, never awaited; `settings.jevShadow === false` kill switch; smoke/capture/CLI silence; two-minute interval, three-proposal cap, one-hour backoff after two failures; retrieval before the single batched call; every call charged as `jev-shadow-intake` in the improvement-budget ledger), the keystore-contract source pins, and a live half that runs only with `MEFI_JEV_LIVE_TEST=1` and `AI_GATEWAY_API_KEY` exported, and skips cleanly otherwise. |
| `tools/test_mefi_studio_normalized_path_lock.py` | Executor lock contracts for Mefi's Studio AI+ (`scripts/assistant.mjs` via a Node stdin driver, plus static pins): the spawn-loop file lock normalizes before comparing — `filesOverlap`/`sameFile` collapse forward/backward separators, drop trailing separators, fold case, match an absolute path against its repo-relative tail and a bare basename against the same basename under any folder — so two spellings of one file (the A-Eyes `test_mefi_studio_eyes.py` collision) are one claim; `claimWork` defers the second pick with reason `claimed` and advice naming the held file, a finished job releases its claim, an unrelated file proceeds, no lease file is ever written (that hung dispatch on OneDrive), the collision theme keys share the normalizer (`sameFileLabel`), and `main.cjs` consults `claimWork` before dispatch. Node half skips cleanly without Node. |
| `tools/test_mefi_studio_claim_registry.py` | npm-test discovery shim: re-exports the claim-registry contracts from `tools/test_claim_registry.py` (the A-Eyes overseer directive names that file) so the dev set runs them. That file races `./tools/x.py` against its absolute form through the real `scripts/assistant.mjs` write-lock registry — `writeClaimKey` resolves relative paths against the module root and folds separators and case into one key, two racing sessions on one path yield exactly one `refuse` with reason `claimed`, `claimWork` defers dispatch while the claim lives, `releaseWrite` frees the path only for the owner, and the refused session may then take it; static pins cover the `writeClaims` map, the registry API, the `claimWork` consultation, and `main.cjs`'s `claimWrite`/`releaseWrite` wiring. Node half skips cleanly without Node. Standalone: `python -m unittest discover -s tools -p "test_claim_registry.py"`, `python -m unittest tools.test_mefi_studio_claim_registry` (the shim falls back to a package-relative import), or run the Node driver directly. |
| `tools/test_mefi_studio_assistant_write_lock.py` | npm-test discovery shim: re-exports the write-lock serialization contracts from `tools/test_assistant_write_lock.py` (the A-Eyes overseer directive names that file) so the dev set runs them. That file proves two same-path writers serialize: both race the same file under `tools/x.py` and an upper-case backslash absolute spelling, exactly one writer is refused while the case-normalized claim map holds one entry, dispatch defers the second writer's pick until the winner releases, and the registry is empty once the handoff completes; static pins cover the `writeClaims` map key (`toLowerCase`), the `claimWork` gate, and `main.cjs` registering `entry.files` under the run id at dispatch and releasing them in `finish()`. Node half skips cleanly without Node. Standalone: `python -m unittest discover -s tools -p "test_assistant_write_lock.py"` or `python -m unittest tools.test_mefi_studio_assistant_write_lock` (the shim falls back to a package-relative import). |
| `tools/test_mefi_studio_builder_intel.py` | npm-test discovery shim: re-exports the builder outcome reporting contracts from `tools/test_builder_intel.py` (the A-Eyes overseer directive names that file) so the dev set runs them. That file feeds one failed and one finished executor run through the real `scripts/assistant.mjs` `hearReport` — the same call `main.cjs`'s `assistantHearBuilder` makes — and asserts the digest counts `fails=1`/`reports=1` in either order (outcomes are events, so a later finish cannot erase an earlier failure), outcomes older than half an hour drop out of the window, and each done/fail appends a structured event (job id, role `builder`, exit code, verdict) that survives a state save/reload and is parsed by the test itself, with a killed run's unknown exit code kept null rather than 0; static pins cover `assistantHearBuilder(entry, job, ok, errorMessage = "", exitCode = null)`, the `jobId`/`exit` threading into the report, the fallback intel row and the emitted intel facts, and the executor finish path passing `code ?? null`. Node half skips cleanly without Node. Standalone: `python -m unittest discover -s tools -p "test_builder_intel.py"` or `python -m unittest tools.test_mefi_studio_builder_intel` (the shim falls back to a package-relative import). |
| `tools/test_normalized_path_lock.mjs` | Node proof for the A-Eyes overseer directive (`node tools/test_normalized_path_lock.mjs` from the repository root; exit 0 = the lock holds; it also closes `npm test` so the proof is a named check in the standard pipeline): two concurrent claims on the same file under two spellings of its path yield exactly one rejection through the real `scripts/assistant.mjs` registry — plus release-then-retry, idempotent same-owner re-claims, `claimWork` deferring a pick whose path the registry holds, all-or-nothing multi-file claims, and foreign owners being unable to release someone else's claim. Verified 2026-09-19: 6/6 checks pass, `tools/test_claim_registry.py` 2/2, `tools/test_assistant_write_lock.py` 2/2, both `test_mefi_studio_*` shims 2/2 each. Re-verified 2026-09-19 in run_1789850103724_1 with the same results (proof exit 0, both contracts OK, no mojibake in the proof's output strings, `main.cjs` claim/release wiring confirmed at dispatch and finish). Re-verified 2026-09-19 in run_1789851482100_2: proof 6/6, contracts 2/2 + 2/2, full discovery set 202 OK; fixed both shims to also import package-style (`python -m unittest tools.test_mefi_studio_claim_registry` used to fail with `ModuleNotFoundError`) and pinned that in the shim rows above. Re-verified 2026-09-19 in run_1789854672162_6: proof 6/6, both contracts 2/2 (directive-named and package spellings), full `test_mefi_studio_*` discovery set 203 OK, `npm run check:specs` 84 specs/unique basenames/no orphans, `tests/spec_collisions.test.mjs` 4/4, and `.local-migration/` holds zero `test_*.py` copies. |
| `tools/test_mefi_studio_offline_probe.py` | Offline-with-key AI probe contracts for Mefi's Studio AI+ (the A-Eyes overseer directive): `planOfflineProbe` in `scripts/assistant.mjs` (run through the real module via Node, no network, no key, no Electron) queues exactly one probe for the one state nothing used to watch — `keyPresent === true`, `online === false`, `failures === 0`, no owed `backoffUntil` — at the 90-second base delay; a pending probe (`pendingUntil` in the future) blocks a duplicate queue, a failed probe doubles the wait per recorded attempt (capped at 30 minutes by `offlineProbeDelayMs`), and no key / online / a recorded real failure / an owed backoff / a garbage state all return null so the existing online/failure handling stays in charge. Static pins on `main.cjs`: `assistantTick` arms `scheduleAssistantAiProbe()` after the `keyPresent` refresh and before the no-project early return, the scheduler queues at most one timer (clear-before-re-arm, `unref`'d), the runner re-checks the plan and skips SMOKE/Capture/paused states before any `assistantFetch`, a passing probe flips online through the shared `assistantAiOk()` path and clears the `ai-offline` problem, a failed probe grows `backoffUntil` without touching `failures` (a probe is not a real call) and requeues with the grown delay, and `assistantAiOk`/`assistantPause`/`stopAssistant` reset the probe bookkeeping. |
| `tools/test_mefi_studio_verification_scheduling.py` | Overseer verification-scheduling contract for Mefi's Studio AI+ (the A-Eyes overseer directive): when a builder reports `MEFI_RESULT: done`, `scheduleVerificationOnDone` in `scripts/assistant.mjs` queues the overseer's own verification run — `npm run check` first, then the task's focused tests resolved from its scope (`refs`/`files`, test-shaped paths only) plus the report's ran clause — and a done report queues EXACTLY ONE verification job: a retried report for the same attempt and a second done line queue nothing (`verificationJobKey` dedupes per task id + attempt, attempts never share a key), while failed/partial/missing results, prose merely quoting the protocol mid-line, and tasks with no test-shaped scope (check-only run) queue zero jobs. The behavioral half drives the real exports (`scheduleVerificationOnDone`, `focusedTestsForTask`, `verificationJobKey`, `findQueuedVerification`, `parseExecutorResult`) through a Node stdin driver; the static half pins the exports and `main.cjs`'s settlement wiring — the job is queued inside the transaction that marks the card `awaiting_verification` (`task.verificationRun`) so it can never close unverified, and `runVerificationJobs()` drains the queue after settlement. Direct requests settle through the same scheduler inside their `verifying` transaction, keyed by request identity (`agentModes.requestKey`: `id:<id>` or `request:<digest>`, never a task id), the row records the queued `verificationRun`, and the runner stamps the observed state back onto the request row by that identity; the lifecycle fixture pins exactly-once queuing for both kinds, including across a failed-write retry — the queue push survives a rolled-back store write, so the retried settlement recovers the row's lost `verificationRun` stamp by looking the queued job up by key (`findQueuedVerification`), which is what the runner matches observed results onto. Node checks skip cleanly without Node; no network, no key, no Electron. |


## App commands and captures

Build approval coverage lives in `tests/build_approval.test.mjs`: default-on
migration, saved Verify first, exact reviewed scopes, restart persistence,
Pause, explicit retries, task/request admission, follow-up approvals, and
mode/scope changes during selection and claim. Settings-save failures cannot
enable automatic builds. Generic task or request writes cannot grant approval.
The Workspace, onboarding, task UI and Command activity suites cover saved
toggles, honest failure recovery, review navigation, delayed context reads and
project switches during approval.

`python tools/verify_workspace.py --output tools/logs/auto-build-approval-workspace`
also exercises the actual first-use toggle, persisted mode after reload,
task approval, brief-change invalidation and rejection of stale approval.
The isolated tour blocks coding workers and external requests. Its layout
checks keep the guide navigation visible and leave room for scrolling tasks
on short desktops.

Validated on 2026-09-19: rebuilt booklet, `npm run check`, `npm test`
(827 Node passes, one opt-in skip, 211 Python passes and all normalized-path
checks), and `npm run audit` (zero findings). The approval Workspace tour
passed 27 checks with 27 screenshots and no renderer errors, network attempts
or worker launches. Its local evidence stays under ignored
`tools/logs/auto-build-approval-workspace-final-pass/`.

Jev model routing is covered without paid requests by
`tests/model_routing.test.mjs` (compatible candidates, task-specific measured
evidence, estimated versus reported cost, bounded strict choices and failures),
`tests/jev_model_routing_host.test.mjs` (actual host selection, overrides,
fallback, accounting, caching and settings/project isolation), and
`tests/jev_routing_ui.test.mjs` (selection controls and status). These suites
run through `npm test`. Planning retains its existing HTTP-only route and
explicit provider fallback coverage in `tests/planning_routing.test.mjs`.

Automatic selection uses the existing Jev client with a four-second deadline;
tests inject its transport. Do not use real gateway credentials for these
checks. z.ai worker selection uses only the two models advertised by the
managed provider, before the existing claim/pause checks. External CLI speed,
quality and billing are still unknown; catalog quota is never treated as speed.

`python tools/verify_workspace.py --routing-only --output
tools/logs/jev-routing-focused` exercises selection-mode persistence through real
IPC, missing-key/default status, and the 900px settings layout in an isolated
Electron profile. It makes no model requests and keeps its captures ignored.

Routing validation on 2026-09-19: booklet build, syntax/target checks and audit
passed. The final test layers passed separately after concurrent fixture edits:
827 Node passes with one opt-in skip, 211 Python passes, and all six normalized
path checks. The routing suites contributed 33 passes. The focused Electron
tour passed four checks and saved five captures with no network or renderer
errors. These checks do not benchmark a live paid Jev connection.

`node --test tests/executor_end_to_end.test.mjs` drives the actual host executor
through dispatch, controlled worker output, settlement, verification, dependent
dispatch, three-worker refill, Pause, missing-evidence waits, and restartable
child handoffs. Stores, clocks and worker/provider boundaries are disposable;
no paid coding workers are launched. `tests/verification_evidence.test.mjs`
checks the session/time bounds and exact numeric exit evidence. The matching
`verification_checks`, `task_handoffs` and `task_grouping_cleanup` suites cover
prose-only claims, failed checks, scope identity, retry limits and cleanup.

`python tools/verify_command.py` exercises the real Electron Command canvas
and Music settings using an isolated dense board. It covers all five styles
and layouts, true 3D depth and rotation with stable world anchors, flat 2D,
custom colors and persistence, compact controls, live-work disclosure and the
30-second idle Zen/wake cycle. It blocks external traffic and coding workers.
`tests/command_render.test.mjs` separately verifies group expansion, full saved
member details and visible verifying children in an actual renderer. Run this
capture tour separately from `npm test` to avoid concurrent GPU fixture load.

For the complete appearance matrix, run
`python tools/verify_command.py --appearance-matrix --output tools/logs/appearance-matrix/release`.
It exercises all five node styles across all five layouts in both views (50
combinations), plus every style in both views with a custom light palette.
Actual right-drag gestures test 3D perspective without moving the saved world
anchors. The same run checks Fit after pan/zoom, repeated view selection,
saved appearance after reload, and preview controls at 650px. Use
`--palette-only` for the separate custom-color, contrast and idle Zen checks.

`python tools/verify_command.py --collapsed-polish --output tools/logs/command-collapsed-polish`
reproduces the overview with both Live work and Assistant collapsed, three
builders, verification cards, checkpoint notes and both orb effects. It checks
desktop and narrow windows, 2D and 3D, light colors, re-opening panels and saved
preferences after reload. Assertions include actual node hit targets, current
task labels, and checkpoint paint/click bounds clear of the headers and labels.

For the decision-planning workflow, run `python tools/verify_planning.py`.
The disposable Electron fixture blocks external network calls and coding
workers, creates and resolves a plan through the real UI, reviews and approves
its specification, and creates tasks once. It checks unresolved/unapproved
handoff rejection, repeated conversion, saved decisions after reload, project
isolation, and desktop/narrow layouts. Screenshots and a JSON report are written
under ignored `tools/logs/planning-ui/`; live project stores and keys are never
used.

`tests/planning.test.mjs` covers persistent planning revisions, question and task
dependency validation, explicit human decisions, unknown promotion, approval
invalidation, stale edits, and storage recovery. `tests/planning_service.test.mjs`
covers the host service with an isolated planning store and fake model/board:
AI replies cannot resolve or approve, malformed batches and stale replies are
rejected, conversion retries recover from partial writes without duplicates,
and approved task identities survive automatic board grouping. Both run in
`npm test`; there are no paid model calls.

`tests/planning_ui.test.mjs` checks unsaved-edit approval gates, failed-save and
reload draft retention, frozen approved scope, and responses arriving after a
project switch. `tests/planning_assistant.test.mjs` checks read-only planning
status and bounded companion context without admitting executable work.

For the project workspace, run `python tools/verify_workspace.py`. It copies
sources into a disposable Electron app and profile, seeds two fixture projects,
blocks external network traffic, and exercises real IPC: explicit task creation,
chat, completed details, review separation, project isolation, draft recovery,
canceled folder selection, pause/resume, menus, personalization, reload, and a
narrow viewport. The backlog fixture has 30 tasks and 100 ideas; checks cover
pagination, search beyond the first page, atomic idea promotion, queue priority,
run/pause controls, and short desktop layouts. Screenshots and the report are written to ignored
`tools/logs/workspace-ui/`. It never opens either live data store or saved keys.

For Command, run `python tools/verify_command.py`. The isolated Electron fixture
contains four sessions, 66 tasks, 105 ideas, queued work, and synthetic worker and
agent status. It checks layout at 1920×1200, 1463×943, 1280×720, and 900×900;
current task and stage, graph search, details, navigation, disclosures, and music
settings. Network and child processes are blocked; no worker or audio capture is
started. Screenshots and the report go to ignored `tools/logs/command-ui/final/`.
Use `--baseline --source PATH` to capture an earlier source snapshot separately.

The Node runner also discovers `tests/projects.test.mjs`,
`tests/task_history.test.mjs`, `tests/tasks_ui.test.mjs`, and
`tests/workspace_ui.test.mjs`. These cover captured project roots and storage,
busy-switch safety, durable verified-request history, completion evidence,
async UI ordering, project mismatch rejection, and draft retention on errors.

`tests/backlog_engine.test.mjs` exercises the real host controls with isolated
stores: bounded idea admission, persistent backlog mode, pause races, grouped
task ownership, and exhausted verification/retry guards. `tests/idea_backlog.test.mjs`
checks oldest-first admission, durable idea-to-task links, full requirements,
duplicate clicks, and retention of large queues and completion history.
`tests/task_context.test.mjs` covers complete historical snapshots, paginated
recovery, efficient unchanged revisions, safe restore behavior, and handoffs
with prerequisite results. `tests/idea_actions.test.mjs` prevents stale idea
actions from undoing a task promotion or deleting newer backlog entries.
The real UI harness also saves a prerequisite, confirms its waiting state,
reads the handoff, and restores an earlier brief while retaining task status.

From the repository root, `npm start` opens Electron and `npm run start:web` opens the browser fallback. Use `npm run data` or `npm run data:offline` to refresh the catalog and `npm run build-booklet` to rebuild `renderer/booklet.html`. `npm run capture` creates the screenshot tour in `tools/logs/mefi_studio_captures/`.

A-Eyes reads the live OpenCode session store read-only (`~/.local/share/opencode/opencode.db` via `node:sqlite`) for its change feed, diffs, PNG evidence pins, log tail, and 3D task-tree rail. The automated Electron smoke uses a temporary home directory instead of that live store.

`tests/paths.test.mjs` exercises standalone, packaged, selected-workspace, and optional-game path resolution, plus the live-update restart behavior of the root resolver.

## Agent loop, Jev and startup regressions

Command and music regressions are covered by `tests/command_activity.test.mjs`,
`tests/command_graph.test.mjs`, `tests/music.test.mjs` and
`tests/music_recommendations.test.mjs`. They exercise truthful current work,
active-only agents, label placement, physical-frequency audio response, capture
cleanup, local queue transport, safe Spotify URLs, theme persistence and the
read-only recommendation route. Follow checks cover task-first selection,
completion handoffs, bounded rotation, current-step framing and manual control.
`tests/executor_continuation.test.mjs` covers
verification-before-dispatch, per-attempt evidence-read failures, retry budgets,
completion reports and finished-worker status.

`tests/executor_parallel.test.mjs` covers worker-only snapshot configuration,
parallel dispatch with file claims, saved capacity and completed edit evidence.
`tests/assistant_readiness_reply.test.mjs` checks whole-board readiness counts,
paused and active worker replies, and truthful compactor dispatch reports.

`python tools/verify_command.py` checks the real Electron UI at four window sizes,
music/theme navigation, synthesized WAV transport and the direct audio analyser,
recommendation errors/results, task deep links, parallel capacity, task-follow
handoffs and wheel cancellation. It also checks saved node styles/layouts,
blue work-orbit trails and extra glow, stable task positions, the live tree
beside Music settings, and camera restoration. Effects use the real checkboxes
and painted canvas; reduced motion keeps orbit trails at a fixed phase.
Live Work collapse, the saved default-off Zen toggle, idle Zen entry/wake, and
reduced-motion behavior are covered by the same isolated UI fixture and focused
graph tests.
It blocks external requests
and worker processes and uses a disposable profile and board. Add `--interactive`
for a visible disposable window suitable for computer-use checks. Live Spotify
streaming, authentication and paid AI recommendations are not exercised here.

The Node runner discovers these automatically; they use controlled timers,
fixture stores and fake transport rather than live user state or model calls.

| Suite | Behavior covered |
|---|---|
| `tests/assistant_loop.test.mjs` | Nonblocking role animation, concurrent/fresh store reads, parallel message facts, tick and manual-follow-up serialization, pause races, executor fill release, proactive call coalescing and idle churn. |
| `tests/jev.test.mjs` | Full-request deadlines, strict specs and answer types, credentials, failed-call usage, official evaluation wire, candidate retrieval and explicit live-test opt-in. |
| `tests/jev_loop.test.mjs` | Self-comparison exclusion, actual remaining obligations, deferred arrivals, queue bounds, cooldown/backoff, retry caps and configuration changes during a running call. |
| `tests/jev_runtime.test.mjs` | Real host admission, missing-key/disabled gating, charge accounting, advisory-only proposals and coalesced connection checks. |
| `tests/budget_writes.test.mjs` | Concurrent ledger charges, recovery after failed writes and serialization across live module reloads. |
| `tests/machine_reads.test.mjs` | Shared UI scans, brief cache freshness, fresh enforcement and failure recovery. |
| `tests/renderer_startup.test.mjs` | Concurrent IPC sharing without stale caching, populated-tree readiness, bounded boot, reduced motion and valid canvas radii. |
| `tests/boot_poll_visibility.test.mjs` | The shared poll guard's visibility timing contract on a virtual clock: hidden tabs set no interval and fire nothing, hide/show cycles never stack timers (one live interval per key across 25 rapid cycles), resume sets a fresh full interval so hidden time drifts nothing and is never replayed as a catch-up burst, and an in-flight request completing while hidden cannot resurrect the paused timer; source-shape pins hold each tick's hidden bail ahead of its fetch with a show snap-back for nav, eyes.log, tasks.board, explorer.state and idle's Command timers; and the shipped tasks/explorer/idle ticks are extracted verbatim, compiled against stubs and driven through the guard to prove hidden silence, sheet gates and exact cadence for the overlay polls. |
| `tests/occlusion_probe.test.mjs` | Live-Chromium proof of the occlusion-vs-lag disambiguation behind `measureWorkerLag`: a real Electron fixture loads the actual `renderer/booklet.html`, proves the blob worker constructs under the page CSP (`worker-src blob:`), covers the visible window with an always-on-top window (native occlusion, never minimize), asserts rAF stays silent for 3s while the worker/MessageChannel channel keeps answering, and extracts the probe expression from `main.cjs` so the occluded window reads ~0 ms instead of the 1000 ms sentinel, with rAF resuming once the cover is removed. Load-tolerant by scheduling: `npm test` runs it through `scripts/run-node-tests.mjs`, which drains the parallel `node --test` stage first and only then starts this fixture in a second, serialized `node --test` invocation, because sibling test files loading the CPU inflate the IPC wall time and worker drift the lagMs reading subtracts (best of 3 samples still read 452 ms mid-suite on a healthy window before isolation; isolated it reads ~0). The visible and occluded phases additionally resample the probe up to 3 times (~400ms apart, stopping at the first <100 ms reading) and judge the cleanest sample; every sample must still answer via the unthrottled channel (never frames, never the sentinel), so neither isolation nor retries can mask a real throttling regression or wedged page, and all samples are recorded in the report for diagnosis. Needs a display; skips on headless Linux. Run alone with `node --test tests/occlusion_probe.test.mjs`. Capability-gated: on desktops where Chromium's native occlusion tracker never engages (focused cover shown, window visible and unminimized, yet `document.hidden` never flips and rAF stays loud for the whole 15s wait — e.g. some RDP sessions), the fixture writes an `occlusionUnsupported` record with the cover/window state and timeline tail and exits cleanly, and the test skips with that explicit reason after the visible-phase CSP/worker/probe assertions still ran; the record also carries foreground-window identity for diagnosis — Win32 `GetForegroundWindow` (title/pid/process, NULL reported as an observation, never an error) and, in every snapshot including the NULL one, a self-describing `session` block — active console session id (`WTSGetActiveConsoleSessionId`), the session's `WTSConnectState`, input-desktop openability/lock state (`OpenInputDesktop` + `UOI_NAME`; locked/secure desktops report `inputDesktopLocked: true`), and `GetLastInputInfo` idle ms, so an unattended/locked desktop explains a NULL foreground at a glance —, both windows' native hwnd handles, per-sample `document.hasFocus()` stamps in the timeline, and the focus-reassertion count, so a dead tracker (cover held foreground, page saw no focus, rAF still loud — seen live on a physical Win11 console desktop with `GetForegroundWindow` returning NULL) is distinguishable from a failed focus steal, and the fixture's exit line states the capability absence instead of printing a bare pass; every strict occlusion assertion remains active on any desktop that does produce real occlusion. Opt-in alternate strict-phase signal (decided 2026-09-21, run_1789966618403_11): on such desktops `MEFI_OCCLUSION_PROXY=visibility` lets the fixture exercise the downstream occluded-phase branch with hide()/show() — results land in a separate `occlusionProxy` record (signal named, rAF-silence/unthrottled-channel/~0-lag/recovery asserted, `occluded` pinned absent) because hide() proves "not rendered", never "covered": the proxy is default-off and promoting it to sanctioned occlusion remains a contract change awaiting owner sign-off; without the flag the fixture records `occlusionProxyDeclined` and the test skips exactly as before. |
| `tests/eyes_toggle_electron.test.mjs` | Live-Chromium execution of the eyes log-tail acceptance: the shipped `renderer/boot.js` poll guard plus the shipped `renderer/eyes.js` `refreshLog` tick and visibilitychange listener are extracted from disk at runtime and wired against a counting `eyesLog` stub in a real Electron renderer, the window is hidden and shown exactly once (a real visibility toggle; minimize does not flip `document.hidden` on this build, so hide/show is the deterministic toggle), and the fetch calls are counted with per-call `document.hidden` stamps: visible baseline cadence, zero fetches across a hidden stretch, exactly one immediate snap-back fetch on show, then the baseline cadence with no doubled count (a leaked second interval or double-registered listener would double it) and no near-zero fetch gaps (the duplicate signature). Throttling stays at the production default, so the hidden pause is corroborated both by the fetch counts and by `MefiBoot.pollActive` reporting the interval torn down while hidden and live again after show — throttling cannot fake that teardown. Runs serialized after the parallel stage alongside the occlusion probe because both drive real windows. Needs a display; skips on headless Linux. Run alone with `node --test tests/eyes_toggle_electron.test.mjs`. |
| `tests/eyes_overlap_boundaries.test.mjs` | The Node-side eyes-contract mirror of `tools/test_mefi_studio_eyes.py`: the real `scripts/eyes.mjs` `collisions()` drives a fixture OpenCode database (built with `node:sqlite` in per-run temp dirs) to pin the temporal-overlap boundary cases — adjacent windows touching at one instant, a gap of exactly `overlapMs` inclusive vs one just past it excluded, a contained window intersecting to the inner session's span, a three-session nested group whose common intersection collapses to the innermost single instant, zero-length single-edit pairs — plus `overlapRangeOf` validation (corrupt/NaN/inverted windows normalize to null; zero-length stays real). Run alone with `node --test tests/eyes_overlap_boundaries.test.mjs`. |
| `tests/eyes_missing_store.test.mjs` | First-run eyes behavior when the machine has never run OpenCode: every listing read (`listSessions`, `listChanges`, `listTodos`, `activitySince`, `listChatTexts`, `collisions`, `filePresence`, `findRunSession`, `assistantFacts`) treats a never-created store as empty instead of throwing, so the boot session-tree step shows "no recent sessions" rather than gating the app, check evidence stays explicitly unavailable, and a store that exists but cannot be read still raises the real failure. |
| `tests/model_auto_setup.test.mjs` | The auto-setup planner's pure decisions: saved-key precedence over installed CLIs, either Jev route's key enabling task-aware selection, builder choice from installed OpenCode/Grok CLIs, refusing an empty machine with guidance, a no-op for an already-configured machine, and disarming an armed fallback whose auto order has no second usable provider; `tests/jev_routing_ui.test.mjs` covers the Settings card's host summary, honest refusal, in-flight click guard, read-only setup overview, and the auto-order editor (numbered preference list, add/remove, whole-list saves, generalized fallback switch). |
| `tests/verification_drain.test.mjs` | Overseer verification-drain contracts against the real `main.cjs` drain slice with stubbed spawn/store/timers: queued jobs pair up two at a time (`VERIFICATION_PARALLEL = 2`) so a done-report burst no longer stacks behind one serial `npm run check` — the first two spawn together, a freed slot picks the third up before the drain resolves, and the queue empties; commands stay sequential inside one job (a failed check ends it, the focused test never runs, and the failed state, per-command tail and log line are stamped onto the card); request rows are stamped by `agentModes.requestKey` identity, never a task id; and each landed result arms exactly one coalesced 1-second settle timer that runs one housekeeping pass (no kick while the debounce is pending, one pass for two results), so cards close without waiting for the next autopilot tick. The job's cwd honors npm's package boundary: a project folder with its own `package.json` keeps its root, one without (a game checkout, a notes tree) has the whole job moved to the Studio checkout (`SOURCE_ROOT`, payload root as last resort) with the move logged, instead of `npm run check` dying ENOENT before any real check executes. No real child processes or timers. |
| `tests/finished_claims_guard.test.mjs` | Finished-uncommitted dispatch dedupe through the real `scripts/assistant.mjs` `claimWork`/`shouldHoldWork`: a pick whose file scope overlaps a finished session's uncommitted edits defers with reason `finished-uncommitted` (held files and owning session named in the advice), `shouldHoldWork` parks it, and `main.cjs` dispatch consults the hold and logs "held for verification: finished session …"; case/spelling path differences still collide through the shared normalizer, an active session's dirty files or a cleared session never trigger the hold, committed work releases it, non-overlapping scope is never held, collision-resolution jobs still run through the hold instead of being parked, a sibling in-flight job's claim wins, the task's own failed-verification fix retry is exempt from its own attempt's hold (evidence-keyed on the unverified verdict, counted verify attempts and the attempt's session rather than the title; a foreign holder alongside the own attempt still holds the shared file, and the exemption never bypasses an in-flight sibling claim), and `finishedClaims` stays silent without a file scope. |

`tools/benchmark_startup.py` measures real Electron loading in an isolated,
offscreen temporary app. Run `python tools/benchmark_startup.py --runs 3`;
see `PERFORMANCE.md` for the method, before/after results and limitations.

Performance tuning also adds these isolated checks, included in `npm test`:

| Suite | Behavior covered |
|---|---|
| `tests/command_performance.test.mjs` | Exact dense-graph label placement with fewer collision checks, bounded spatial queries, camera/effect changes, stable anchors in all layouts, new arrivals and independent agent animation clocks. |
| `tests/tree3d_performance.test.mjs` | Hidden/covered rail animation suspension and resumption, one scheduled frame, unchanged canvas sizing, session-todo indexing and snapshot edge indexes. |
| `tests/eyes_log_tail.test.mjs` | Bounded 512 KiB log I/O, short reads, rotation, truncation, missing files, Unicode boundaries and descriptor cleanup on failure. |
| `tests/eyes_watch_lifecycle.test.mjs` | Stop/restart during pending activity reads, project-switch cursor isolation, hidden-window silence and retry after failure without duplicate timers. |

The real `tests/command_render.test.mjs` Electron fixture additionally counts
rail canvas paints on Home and Command (both stay at zero while covered), then
checks visible-rail resumption. It retains its actual Command pixel, grouping
and exit/reentry checks. `PERFORMANCE.md` records operation counts and a
synthetic log benchmark; timing measurements are not pass/fail thresholds.

Performance pass validated on 2026-09-19: rebuilt booklet, `npm run check`,
`npm test` (704 Node passes, one opt-in skip, 204 Python passes and normalized
path ownership checks), and `npm run audit`. The isolated Command walkthrough
passed 24 checks and saved 65 screenshots under ignored
`tools/logs/performance-tuning/command-verified/`; the narrow Auto-label case
and hidden-rail paint regression are covered. Synthetic benchmarks and their
limits are recorded in `PERFORMANCE.md`.

September reliability and Model Lab suites (included in `npm test`):

| Suite | Behavior covered |
|---|---|
| `tests/executor_lifecycle.test.mjs` | Exact run-marker session attribution, saved Pause at boot, stale settlement fencing, result-save retries, registry release on early exits, and replaced-child exit races; plus the lease-read fail-closed latch in `spawnNextJob`'s `readLeases` — an unreadable board (missing `getMachine().leaseStatus` export or a throwing read) parks dispatch as `busy` on an `{ exclusive: true, unreadable: true }` stub instead of reading the machine as free, the fault is logged once per incident and cleared by a healthy read (a returning fault logs again), and a failed post-claim recheck drops the claim and releases its reservation without launching a child. |
| `tests/assistant_pool.test.mjs` | Separate bounded reply/background lanes, cadence fairness, accurate concurrent role status, durable queued work and Pause winning asynchronous repair races. |
| `tests/assistant_coordination.test.mjs` | Live ownership checked inside the repair transaction, fresh foreign leases retained, Pause during overseer review, distinct instruction reference jobs and run-local builder failure routing. |
| `tests/request_admission.test.mjs` | Duplicate batch admission/promotion, preservation of distinct prompt scopes within a batch, pin priority, held/claimed/completed states and full task briefs through chat admission. |
| `tests/executor_handoffs.test.mjs` | Worker follow-up lineage and depth limits, allowed role calls, real restartable reference gathering, and automatic roles held through Pause/restart until Resume while manual requests remain available. |
| `tests/ideas_intake.test.mjs` | Scans without AI review preserve unread candidates; batching advances only past complete reviewed rows, including equal timestamps and more than 40 candidates; failed or oversized reviews retain the cursor. |
| `tests/command_render.test.mjs` | Isolated Electron loads current renderer sources, checks real painted node pixels and frame progression, then exits and reopens the tree. Renderer errors fail the test; no live stores, network or workers. |
| `tests/update_continuity.test.mjs` | Combined base/music hot styles, CommonJS restart classification, missing build inputs retaining the complete payload until recovery, builder/result drainage without forced restart and bounded dead-renderer probes. |
| `tests/renderer_recovery.test.mjs` | Crash/load recovery, retry caps, quitting/disposal, content-free diagnostics and a real isolated Electron renderer crash/reload fixture. The live Studio window is never deliberately crashed. |
| `tests/model_performance.test.mjs` | Serialized atomic records, separate human/model ratings, unknown cost/usage, task/effort breakdowns, retention with lifetime totals and bounded supported-effort selection. No paid requests. |
| `tests/model_observation.test.mjs` | Real host transport observations using stub responses: measured usage/errors, actual reported model, requested versus confirmed effort and no prompts/keys in the ledger. |
| `tests/context_manager.test.mjs` | Bounded task-context previews, grouped requirements, missing/cyclic prerequisite descriptions, source priority, explicit truncation and preservation of saved originals. |
| `tests/model_lab.test.mjs` | Measured versus unknown fields, separate ratings, empty states, task-context loading, stale response rejection and project-switch cleanup. |

`python tools/verify_model_lab.py` runs the actual Model Lab UI and local IPC in
an isolated offscreen Electron app. It checks empty and measured rankings,
unknown billing, human rating persistence after reload, context budgeting,
source preservation and a 900px layout. Network calls and workers are blocked;
it never judges a real paid model or changes the live app's stores.

The agent-loop reliability pass also adds executor coverage for mid-dispatch
brief/file-scope edits, direct-request follow-ups gating verification, and broken
worker input pipes retaining ownership until the process closes. The Workspace
UI harness waits for project context loading to finish before reading the next
board. Run `python tools/verify_workspace.py --output tools/logs/agent-loop-workspace`
for the isolated task/idea/prerequisite/history and pause/resume UI flow.

Public-download polish adds these checks (all Node suites run through `npm test`):

| Suite | Behavior covered |
| --- | --- |
| `tests/onboarding.test.mjs` | Automatic first-launch walkthrough after startup, saved-state suppression on later launches, dismissal/reopening, persisted lesson progress, safe destination actions, completion, corrupt/unavailable local storage, keyboard focus wrapping and grouped menus. |
| `tests/workspace_ui.test.mjs` | Separate chat/task drafts across mode and project changes, duplicate-submit prevention, retained newer typing, truthful success when only the refresh fails, direct saved-task navigation, optional brief outline, disabled workers versus paused assistant, and bounded read-only status calls with recovery. |
| `tests/tasks_ui.test.mjs` | Explicit scoped task creation rather than chat intent, draft/error retention, project-change fencing, readiness filters and targeted retry controls. |
| `tests/command_activity.test.mjs` | Distinct attention/waiting counts, actionable blocker details, retry timing, status-read deadlines/recovery, stale-response rejection and workers remaining visibly occupied while termination is pending. |
| `tests/executor_lifecycle.test.mjs` and `tests/executor_end_to_end.test.mjs` | Failed/hung process termination retains ownership, safe bounded-cadence recovery, Grok fallback after confirmed termination, and independent work continuing while overlapping work stays held. |
| `tests/package_privacy.test.mjs` | New builds receive only public catalogs; existing portable data remains unchanged; every release uses an empty destination, includes its getting-started guide, and generates no repair tasks for intentionally omitted source tests. Source checkout omissions remain actionable. |

`python tools/verify_workspace.py --output tools/logs/studio-polish-workspace`
also checks that the actual guide opens automatically for a new user, fits a
short desktop, stays closed after reload and resumes its saved lesson. It covers
grouped settings, explicit task creation, project switching, saved drafts, prerequisites, review,
pause/resume and narrow layouts in isolated Electron with external calls blocked.
`python tools/verify_command.py --output tools/logs/studio-polish-command` checks
the real monitoring view and its workflow links using synthetic queue/worker data.

The GitHub Windows workflow now installs pinned dependencies, rebuilds and checks
the committed renderer, and runs all three application gates. Local checks do not
certify a real paid provider, external CLI login, signed download or clean-machine
installation; validate those before publishing a release.

Validated locally on 2026-09-19: `npm run build-booklet`, `npm run check`,
`npm test` (636 Node passes, one opt-in test skipped, 203 Python passes and all
normalized-path ownership checks), and `npm run audit` (zero errors/warnings).
The isolated Workspace tour passed 20 checks; the dense Command tour passed
24 checks, including short/narrow attention layouts. Both reported zero
renderer errors and external network attempts. Captures and reports remain
under ignored `tools/logs/studio-polish-workspace/` and
`tools/logs/studio-polish-command/final/`.

`tests/planning_execution.test.mjs` runs approved tasks through the host's actual
queue, claim and verification logic with fixture I/O: Pause is respected,
prerequisites must verify before dependent work starts, and acceptance checks,
exclusions and prerequisite results reach the worker brief.
`tests/planning_routing.test.mjs` checks routine/heavy defaults and overrides,
HTTP-only planning, missing keys, explicit fallback, the saved auto provider
order (first usable wins, failure walk follows the same order, CLI entries
skipped while their binary is missing, the legacy `aiFallbackOpenCode` field
still arming the switch), Model Lab provenance and
the nonblocking handoff of new planning tasks to advisory Jev. Jev runtime
coverage also rejects self-comparisons and proves proposals cannot rewrite
approved tasks or their dependencies. These checks make no paid calls.

`python tools/verify_planning.py` verifies the visual question map, a controlled
pending/error planning response, approval gates, conversion, plan/task links,
live board completion (including manual confirmation), and small-window layout
using the real Electron view and isolated stores.

Workspace usability coverage includes search across tasks and ideas in **All**,
matching counts per view, discovery of matches outside the selected view,
pagination, and clearing search with focus retained. The palette suite covers
descriptions and familiar search terms, task loading before the board opens,
failed/late/foreign-project reads, and keyboard focus inside the dialog.

Validated on 2026-09-19: `npm run build-booklet`, `npm run check`, `npm test`
(658 Node passes, one opt-in skip, 204 Python passes and normalized-path checks),
and `npm run audit`. `python tools/verify_workspace.py --output
tools/logs/usability-after` passed 22 checks, including sidebar shortcuts,
command search, project isolation and narrow/short layouts. Its 20 screenshots
and report remain ignored; it reported no renderer errors or network attempts.

The left-edge Studio drawer replaces the fixed sidebar. `tests/sidebar.test.mjs`
covers pointer travel between the invisible left edge and drawer, dismissal
after leaving even when a menu control has focus, click and
keyboard access, Escape precedence, inert closed content, transient-dialog
suppression, project changes and focus restoration. The updater build contract
also includes the bundled `renderer/sidebar.js` source.

Validated on 2026-09-19: build, check, audit (zero findings), and `npm test`
(702 Node passes, one opt-in skip, 204 Python passes and normalized-path checks).
`python tools/verify_workspace.py --output tools/logs/right-sidebar` passed 24
checks with 23 screenshots, using native pointer movement to verify hover opening
and leaving. It includes the Aurora theme from the sidebar reference, keyboard
dismissal over Command, a 600px window, project switching, and the existing
workspace workflows. No renderer errors or external network attempts occurred;
the isolated report and screenshots stay under ignored `tools/logs/right-sidebar/`.

The sidebar was moved to the left edge at the user's request. The updated
Workspace tour checks actual left-edge coordinates for the handle and drawer
and moves the pointer outside the drawer to verify dismissal. The 24-check,
23-screenshot rerun passed under ignored `tools/logs/left-sidebar/`.
Build, syntax/target checks and audit passed. The full Node run encountered an
unrelated reproducible failure in `tests/board_store.test.mjs`, “stale fork:
a migrated database missing view rows degrades loudly to file mode” (expected
two file-backed rows, received zero); the sidebar behavior suite passed.

The visible tab was removed. `python tools/verify_workspace.py --output
tools/logs/edge-hover-sidebar` passed 24 checks with 24 screenshots. It verifies
a transparent full-height left-edge hover area with no text, glyph, border or
shadow, entry at both 10% and 85% of the window height, and closing after moving
off a menu containing a focused button or preference field. The closed view
is captured as `01c-left-edge-closed.png`; no renderer errors or external
network attempts were reported. The eight focused sidebar tests also passed.
The final required gates passed: build, check, audit, and `npm test` (705 Node
passes, one opt-in skip, 204 Python passes and normalized-path checks).

Run `python tools/verify_command.py --fit-layout --output
tools/logs/node-fit-layout` to verify Fit as a layout repair. The isolated
Electron tour uses actual pointer drags to turn a populated 3D tree edge-on,
then presses the Fit button and F key. It checks restored horizontal spread,
canonical viewing angle, clear rings and readable task names, unchanged
relationships and appearance, stable repeated fits, and 2D pan/zoom recovery.
Depth and perspective checks reject a flattened 3D result; actual rotations
after Fit verify that spatial anchors remain fixed as the view changes.
The graph contracts cover interrupted drags, leaving Follow, preserving the
Orbit preference, and keeping Shift F and text input behavior intact.

Fit validation (2026-09-19): the 128 focused graph, motion, topology and
performance checks passed. The isolated Fit tour passed at wide and desktop
sizes with 16 captures. Both toolbar Fit and F restored a broad arrangement
after an edge-on drag, preserving all 30 links and six full work titles.
Fitted depth spanned 32–34% of the clear viewport's shorter dimension;
curvature checks rejected a tilted flat plane. Actual 20-degree turns in
both directions kept anchors fixed and work rings apart. Repeated Fit and
2D pan/zoom recovery passed, with no renderer errors, network requests or
worker launches. Evidence remains under `tools/logs/node-fit-layout/final/`.
The booklet was rebuilt; check and audit passed. The final full-suite run on
the concurrently changing tree had 1,138 Node passes, 19 failures, five
cancellations and one opt-in skip. Failures include missing executor VM
globals (`process`, `executorProcessAlive`) and unrelated Electron timeouts.
Separate Python discovery ran 220 tests with two stale contract failures in
assistant error logging and startup refresh; all six normalized-path checks
passed. The full-suite gate remains unpassed. Logs are retained in
`tools/logs/node-fit-full-test-final.log` and `tools/logs/node-fit-python.log`.
The booklet regression now compares against its copied fixture sources,
avoiding mismatches when the live checkout changes during the test; its three
checks passed independently.

Run `python tools/verify_command.py --node-readability --output
tools/logs/node-readability` for the six-builder node-tree regression. It uses
eight synthetic sessions, long task names, a collapsed Live work panel and an
expanded Assistant panel at wide and desktop sizes in both 2D and 3D. It also
uses real pointer drags to inspect two rotated 3D views and samples moving
worker satellites across repeated frames. Painted samples check complete
two-line titles, nearby labels, clear controls and node surfaces, stable world
anchors and a stationary camera after each drag. `--baseline`
retains diagnostic captures even when these readability checks fail.
The fixture uses disposable stores and blocks workers and external requests.

The graph contracts also cover balanced loose-task sectors, dominant branches
using the wider canvas dimension, 180 modest 3D rotation scenarios with clear
work rims and fixed anchors, word wrapping, oversized titles, fractional
camera movement without label side-flips, and six long titles reusing measured
text across redraws. Run `node --test tests/command_graph.test.mjs
tests/command_performance.test.mjs tests/command_motion.test.mjs` for these
focused behavior and performance checks.

Node readability validation (2026-09-19): the focused graph, motion and
performance suites passed 102 tests. The isolated readability tour passed
eight 2D/default-3D/rotated-3D cases across 33 painted samples; all six complete
work titles stayed visible, with no node-ring, label or control overlaps.
The normal Command tour passed 24 checks. Both reported zero renderer errors,
external requests or worker launches. Reports and captures remain ignored
under `tools/logs/node-readability/final/` and
`tools/logs/node-readability-command/final/`.
The final `npm test` run passed 1,006 Node tests (one opt-in skip), all 211
Python contracts and all six normalized-path ownership checks. Complete logs
are retained in `tools/logs/node-readability-full-test.log`.

Node layout regressions in `tests/command_graph.test.mjs` now cover hierarchy
depth in Rings, contiguous Helix branches, distinct centered Terraces, work-rim
spacing in every style and both views, newly revealed children joining fixed
parents, and worker clearance at panel edges. A dense 277px graph checks actual
Auto label painting with expanded side panels, including stable anchors and
unobstructed running-task names.

Connection regressions also cover automatic task/subtree relocation after a
parent changes, restoring hidden descendants beside the moved branch, stable
anchors during status/order/agent changes, and exactly one worker tether to its
current host. Reparenting and restoration run across all five layouts in both
2D and 3D; the fixtures retain unrelated branches to catch unwanted reshuffling.
Dominant Constellation and Rings branches also keep their children on their
parent's side of the hub instead of stretching connections across the canvas.

Connection fix validation: booklet build, `npm run check`, `npm test` (858 Node
passes, one opt-in skip, 211 Python passes and all six normalized-path checks),
and `npm run audit` passed. The isolated collapsed-panel Command tour passed
five checks with 14 captures across desktop/narrow, 2D/3D and light colors,
with no renderer errors, network attempts or worker launches. Evidence stays
under ignored `tools/logs/node-connections-*` paths. The Command tour bootstrap
now reuses the shared process binding and installs its process guard once.

Run `python tools/verify_command.py --appearance-matrix --output
tools/logs/node-layout-verified-matrix` for all 50 style/layout/view combinations
and 10 light-theme cases. Its real Electron checks include worker clearance,
saved preferences, camera controls and active names in the 650px preview.
`python tools/verify_command.py --output tools/logs/node-layout-verified-command`
also exercises the full Command workflow at desktop, short and narrow sizes.
Both use disposable profiles and fixture work; reports and captures stay ignored.

Validated on 2026-09-19: rebuilt booklet, `npm run check`, `npm test` (714 Node
passes, one opt-in skip, 211 Python passes and normalized-path ownership
checks), and `npm run audit` (zero findings). The appearance matrix passed all
60 cases and 30 orbit checks; the Command workflow passed 24 checks. Resting
worker bodies cleared fixed nodes in every matrix case, and the 650px preview
painted all three running task names. Both tours reported zero renderer errors,
external network attempts or worker launches. Reports and 118 captures remain
in the two ignored output folders above.
The focused latest-build pan check also passed: all three running hosts and
their workers leave the viewport together, and Fit restores the tree. Its
isolated report is under `tools/logs/node-layout-pan/`.

Panel-occlusion regressions in `tests/command_graph.test.mjs` check visible
details/Follow bounds, invisible Zen panels, complete rotations in all five
layouts, stable world anchors, and a continuous handoff to manual camera control.
The real `tests/fixtures/command-render-electron.cjs` fixture also checks expanded
and collapsed panels, task details, native 3D rotation in every layout, and
Zen entry/wake against actual DOM bounds and painted node surfaces.

Panel fix validation: the three focused Command suites passed 80 tests, and
`python tools/verify_command.py --output tools/logs/panel-occlusion-final`
passed 24 checks with 69 captures. Build, check and audit passed. The final
full Node run on the concurrently edited tree passed 805 tests, skipped one,
and failed four backlog/execution/planning tests; those failures are separate
from the passing Command renderer checks. Local reports remain under ignored
`tools/logs/panel-*` paths.

Full-suite validation in run_1789866914430_3 (2026-09-19): `npm test` passed
end to end on one working tree — Node 859 tests / 858 pass / 0 fail / 1
opt-in skip, Python discovery 211 contracts OK, normalized-path lock proof
6/6 — and `npm run audit` reported zero findings. The fixture-paths contract
(`tools/test_mefi_studio_fixture_paths.py`, 6 tests) passed standalone via
`python -m unittest tools.test_mefi_studio_fixture_paths` and inside the real
`-s tools -p "test_mefi_studio_*.py"` discovery alongside Node, confirming
the generalized unique-fixture pin (per-suite per-run temp-dir blocks, no
repo-tree or shared `tools/logs` fixture writes, unique discovery basenames).
Complete output was redirected to temp files and grepped, per the guidance
above; the log excerpts that named each layer are retained locally.

Store-fork reconciliation in run_1789867185715_4 (2026-09-19): the fork
decision is recorded in code (`main.cjs` `getEyes()`), in
`scripts/eyes.mjs`'s stale-fork guard, and now in README ("Board integrity"
and the offline-commands section): `data/*.json` is this repo app's
authoritative board, the home `~/.local/share/mefi-studio/board.db` stays a
dormant stale fork (38 tasks/151 drained ideas vs the live views), any stray
board-store-enabled process degrades loudly to file mode, and enabling the
store requires the explicit fresh-migration cutover (archive `board.db`, then
`eyes.enableBoardStore(eyes.defaultBoardConfig(STUDIO_ROOT))`),
`tests/board_store.test.mjs` "fresh migration: archive the stale fork"
covers end-to-end. Evidence: `node --test tests/store_fork_sync.test.mjs
tests/board_store.test.mjs` passed 15/15 (13 board-store including the
fresh-migration cutover and guard, 2 store-fork sync including idempotence
and the app's own admission-rule drain). The repo?dist sync pass
(`scripts/reconcile-store-fork.mjs`, `--dry-run` to preview) remains the
tool for the two deliberate JSON stores; it never touches `board.db`.

Auto setup, per-provider models and Antigravity validation (2026-09-20): rebuilt
the booklet, then `npm run check` passed (targets, spec collisions, CSS
cascade/unused gates, syntax), the full Node suite passed serially with 1,387
tests / 1,386 pass / 0 fail / one opt-in skip (`node --test
--test-concurrency=1 "tests/**/*.test.mjs"`), Python discovery passed 227
contracts, the normalized-path lock proof passed 6/6, and `npm run audit`
reported zero findings. `tests/model_auto_setup.test.mjs` covers the planner's
Antigravity and local-route choices; `tests/jev_routing_ui.test.mjs` covers
provider-bound model fields, per-builder models and the readiness line;
`tests/planning_routing.test.mjs` pins the per-provider override precedence and
that planning never reaches the `agy` CLI; `tools/test_mefi_studio_routing.py`
pins the `agy` command shape (`--model` before `-p`, prompt on stdin,
`--print-timeout 60m` for builders). The assistant route, the builder route and
the planner make no paid request in these checks: detection reads saved-key
flags, the shared `where.exe` CLI presence and a local loopback model list
only, applies only real changes, and leaves every key and model override
untouched.

Booklet and gate re-verification (2026-09-20, second pass): re-ran `npm run
build-booklet` over the settled tree — the rebuild is byte-identical (same
SHA-256 before and after, catalog hash f98dd2322a01, 39 models), confirming the
committed `renderer/booklet.html` matches the renderer sources exactly. Then
`npm run check` passed (75 targets, 145 unique specs, CSS cascade/unused
gates), `npm test` passed end to end (1,387 Node tests / 1,386 pass / 0 fail /
one opt-in skip in the default parallel run, 227 Python contracts OK,
normalized-path lock 6/6), and `npm run audit` reported ok with zero errors and
zero warnings (one informational note that the `assistant:absorb-done` IPC
handler has no preload caller yet). README routing/auto-setup sections were
cross-checked against `main.cjs` and `scripts/decision-client.mjs`: the
`--set-custom-key`/`MEFI_STUDIO_CUSTOM_KEY`, `MEFI_JEV_ROUTE` and `agy`
builder claims all match the code.

Auto provider ordering (2026-09-20, third pass): Auto mode now holds an ordered
provider list (`settings.aiAutoProviders`, default `["zai", "opencode"]`) edited
as a numbered preference list in Settings. The first usable entry answers; with
the generalized `settings.aiAutoFallback` switch (the older
`aiFallbackOpenCode` still honored) a failed HTTP route retries down the
remaining HTTP entries, shaped for each provider, while CLI entries are skipped
when their binary is missing and never become silent retry targets. The builder
route (`mefi-zai` vs OpenCode's own account) and auto setup's fallback arming
follow the same saved order; an empty or unknown-laden order is normalized or
refused instead of wedging routing. Verified: rebuilt `renderer/booklet.html`
(catalog hash f98dd2322a01, 39 models), `npm run check` passed (77 targets, 150
unique specs, CSS cascade/unused gates and all syntax checks), `npm test`
passed end to end (1,432 Node tests / 1,431 pass / 0 fail / one opt-in skip,
228 Python contracts OK, normalized-path lock 6/6), and `npm run audit`
reported zero errors and zero warnings. No paid provider request is made by any
of these checks.

Full-suite validation on the reconciled tree (2026-09-20, fourth pass): with the
assistant/main.cjs reconciliation sitting as uncommitted changes (no merge
markers, 101 unique ipcMain.handle registrations, node --check clean), ran

pm run check (77 targets, 150 unique specs, CSS gates, exit 0), the full

pm test pipeline and 
pm run audit (ok, zero findings). Node stage: 1,439
tests, 1,437 pass, 1 skip, and one load-sensitive flake
(tests/command_render.test.mjs "real Command renderer paints finite task
nodes..." — analyser peak kick 0.0257 under the 0.04 threshold at
tests/fixtures/command-render-electron.cjs:614 while the suite ran in parallel;
it passed twice when re-run in isolation, exit 0 both times). Python stage: 243
tests OK (one skip); normalized-path lock: all checks passed. No reconciliation
regression found; the flake is the only remaining rough edge.

Parallel-load validation of windowed audio sampling (2026-09-20, run
run_1789898604350_30 for the command_render flake task): with the Studio
dispatch loop and other agents active on the same working tree (uncommitted
reconciliation changes left untouched), the full `npm test` pipeline ran three
times back to back (Node v22.14.0, Windows). Run 1: 1,443 Node tests, 1,441
pass, 1 skip, and one parallel-load flake in `tests/expand_finished_guard.test.mjs`
("blank finished titles and blank proposals never match or crash" expected
`['Real work']`, saw `['   ', 'Real work']`; it passes 4/4 in isolation and in
both later full runs), so that run's Python and path-lock stages did not start.
`tests/command_render.test.mjs` passed inside that parallel run (ok 548).
Runs 2 and 3: full pipeline exit 0 — Node stage clean including
`command_render`, 243 Python contracts OK (one skip), normalized-path lock
passed. The windowed-sampling fixture now samples by audio time across drum
cycles with timer fallback (tests/fixtures/command-render-electron.cjs:548),
so the earlier kick 0.0257 drop-out did not recur in any of the three runs.
Measured peaks from the same Electron fixture on this tree: kick 0.6728,
snare 1.0, hat 1.0 (frames 118/129/108) — each clears the `> 0.04` assertion
at tests/command_render.test.mjs:110 with 16.8x/25x/25x margin. Full run-1 log
kept locally as `%TEMP%\mefi-parallel-load-test.log`.

Full-suite validation on the reconciled tree (2026-09-20, run
run_1789899459874_6 for task task_5df847326fde87fe, fifth pass): with the
assistant/main.cjs reconciliation still sitting as uncommitted changes (node
--check clean, no merge markers), re-ran the whole gate set fresh and teed the
suite output to an untracked log. `npm run check` exit 0 (77 targets, 153
unique specs, CSS merge/unused gates clean). Full `npm test` pipeline exit 0
in one pass with no retry: Node stage 1,443 tests - 1,442 pass, 0 fail,
1 skip (the opt-in live-store skip), 43.1 s; Python stage 243 contracts OK
(one skip); normalized-path lock all 6 checks pass. `npm run audit` exit 0,
zero errors and zero warnings. `tests/command_render.test.mjs` passed inside
the parallel full run with the windowed-sampling fixture in place, and
`tests/expand_finished_guard.test.mjs` (the other prior flake) passed too -
no reconciliation regression and no flake recurrence observed. Full log kept
locally as `%TEMP%\opencode\fulltest_run6.log`.
