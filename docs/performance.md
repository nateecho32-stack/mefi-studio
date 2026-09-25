# Agent loop and startup measurements

## Pushes cross into the page once, September 25, 2026

With `contextIsolation` on, the context bridge deep-copies every value the
preload hands to the page, and every `window.mefiStudio.onX(callback)`
registered its own `ipcRenderer` listener. So each push was copied once per
listener. In the tree measured here `eyes:tasks` (the whole board) has eight
listeners and `eyes:assistant` (the whole assistant state, up to four pushes
a second) has nine; `machine:status` and `assistant:status` have four,
`eyes:ideas`, `eyes:checkpoints` and `eyes:activity` three.

- `preload.cjs` now builds `window.mefiStudio` in the page's own world with
  `contextBridge.executeInMainWorld` (`installBridge`). Each `on*` channel
  gets one preload listener on first use, and every subscriber receives the
  same copy, in registration order. The object is still frozen and
  read-only, and no call site changed. A subscriber that throws is passed
  to `reportError` and the ones after it still run; before, the throw
  stopped the remaining listeners for that push and never reached the
  page's error handlers.
- `eyes:assistant` leaves out the state keys the page already holds
  (`scripts/assistant-push.cjs`). After the bridge's first `onAssistant` it
  sends `eyes:assistant-sync`; from then on each object-valued key whose
  JSON matches the last copy sent rides as `same[key] = <rev>`, and the
  bridge puts its kept copy back. Keys are compared by content, not by
  length or last entry, because questions and work rows change status in
  place mid-list. A gap (a push the page never got, a reload) asks for
  whole keys again.
- Subscribers now share one copy, so none may edit a push in place. An
  audit of every listener found `renderer/tasks.js` editing pushed rows for
  Log, Add idea and Gather, and splicing the pushed list after a failed
  delete or a create that raced a push; those now build new rows and lists.

Measured in Electron 44 on the real booklet built from this tree's renderer
sources (offscreen, software rendering, 1280×900), fed the live Studio
board (80 cards, 364 KB after `taskView`) and the live assistant state
(230 KB). "Before" registers the real preload's `on*` entries once per
listener through `exposeInMainWorld`; "after" installs `preload.cjs`'s own
`installBridge` and slims assistant pushes with `scripts/assistant-push.cjs`.
Each window sends 40 pushes 300 ms apart: a board push changes one card, an
assistant push advances the tick and the thinking line, every second one
adds a log row and every sixth a chat message. The renderer was profiled
through `webContents.debugger` (100 µs sampling, allocation sampling that
keeps objects the GC already collected); a push's cost is the window minus
an equal window with no pushes, divided by 40. Medians:

| View | Push | Renderer time per push | Bridge copy alone | Allocated per push |
|---|---|---:|---:|---:|
| Command | board (`eyes:tasks`) | 44 → 17 ms | 39.5 → 5.3 ms | 5.0 → 1.2 MB |
| Command | assistant (`eyes:assistant`) | 105 → 58 ms | 30.0 → 0.5 ms | 3.3 → 0.0 MB |
| Home | board | 54 → 13 ms | 32.8 → 5.2 ms | 5.0 → 1.2 MB |
| Home | assistant | 87 → 67 ms | 23.9 → 0.4 ms | 3.5 → 0.2 MB |

Renderer time is the median of six runs; the bridge copy (self time in
the preload's listener frames and the native frames directly under them) and
allocation are medians of three, allocation from separate runs because
allocation sampling slows the page. Main-thread GC read under 1 ms per push
before and after, inside the run-to-run noise; the allocation drop is what
the collector no longer has to sweep. Per-push renderer time varies by
±15 ms between runs because Command's own frames share the thread.

On the host, an assistant push now costs about 0.5 ms more: comparing each
key's JSON takes about 0.95 ms on this state, and serializing the smaller
push saves about 0.4 ms (V8's serializer: 258 KB whole, 34 KB slim on
average and 43 KB median, since the log changes every other push). At four
pushes a second that is 2 ms a second of main-process time against 80 to
190 ms a second saved in the renderer.

What is left of an assistant push is the listeners' own work, and most of
it is one chain. The chat thread (`fillThread`, renderer/idle.js) is rebuilt
whole whenever the thinking line changes, and studio-ui's MutationObserver
(`track`, `labelOf`) then walks the rebuilt nodes; in one profiled Home run
the two were 40 and 41 ms of a 97 ms push. Command adds forced layouts
(`getBoundingClientRect`). Updating the pending bubble in place instead of
rebuilding the thread is the next lever. The benchmark changes the thinking
line on every push, so these numbers are an upper bound for a quiet
assistant.

## Home's tree backdrop, September 24, 2026

Home now draws the Command tree behind its frosted panels
(`startHomeBackdrop` in renderer/idle.js). Behind Home the tree skips its
text layers (checkpoint badges, callouts, speech and labels, which the frost
would only smear), draws every 80 ms rather than every 30, once a second
with Motion off, and not at all while a sheet covers Home or the window is
hidden. The graph refreshes every 6 s instead of Command's 4 s tick. Opening
Command takes the same canvases over, so nothing is drawn twice.

Measured with the renderer's own profiler (`command.frame` spans over 5 s)
in headless Chromium with software rendering, at 1600×1000, on a synthetic
tree of 90 nodes (7 sessions, 16 tasks, their todos) behind a fake bridge.
This is not the packaged app:

| Surface | Frames drawn per second | Mean frame JS | JS per second |
|---|---:|---:|---:|
| Home backdrop | 10.2 | 2.84 ms | 29 ms |
| Command | 29.2 | 3.44 ms | 101 ms |

Blurring the panels over a moving canvas is GPU compositor work that these
numbers do not include; with **Blur behind panels** off the panels are
solid and unfiltered. None of these numbers are pass/fail thresholds.

## Worker output stops repainting the rail per line, September 22, 2026

Measured on the running packaged app itself (Command home, five `opencode`
workers), by attaching to its main process's inspector and profiling the
renderer through `webContents.debugger` for 12 seconds; no restart, no flags.
The renderer's UI thread was about half busy, and a quarter of it was worker
stdout: every `studio:log` line (a dozen a second while several builders
ran) cost two separate forced layouts of the whole document.

- `studioLog` (renderer/booklet.js) rewrote the Settings connection log and
  pinned its scroll per line, 9 ms each, although that card sat folded
  shut in a tab covered by Command. It now paints at most once a frame, and
  only while the card is open on a shown tab; opening either paints the
  backlog.
- The same line reached `pushFeed` (renderer/idle.js), whose `renderFeed`
  rebuilt the rail and the chat thread each time; `fillThread` measured the
  thread's scroll before and after a rebuild, 8 ms per line. A push after a
  quiet 250 ms still paints at once, pushes inside that window share one
  trailing paint, and `fillThread` leaves a thread alone when every bubble,
  age label and the pending reply would read the same.

| Live renderer, 12 s on Command | Before | After |
|---|---:|---:|
| `studioLog` | 148 calls, 1,463 ms | 0 calls |
| `fillThread` | 169 calls, 1,437 ms | 12 calls, 79 ms |
| `renderFeed` | 160 calls, 1,647 ms | 24 calls, 170 ms |
| Command frames drawn | 223 (about 18 per second) | 385 (about 32 per second) |

Command was losing almost half its frames behind that work and now holds its
30 Hz target. Because it draws more frames, the GPU process's CPU rose with
it: canvas raster is now the largest remaining cost while Command is on
screen (about 70% of a core). Removing the HUD's backdrop blurs, or hiding
the page Command covers, moved it by less than the run-to-run noise in a
hardware-composited scratch window, so neither changed. In the same harness
with software rendering (80 tasks, 6 sessions, 12 lines a second), the
renderer main thread went from 26.4% to 17–19% busy.

Two recurring main-process stalls, found in the same live profile:

| Main-process block | Before | After |
|---|---:|---:|
| Auditor pass (every 5 minutes): `findUnusedSelectors` re-read the 2.5 MB renderer corpus per stylesheet, and its interpolation regex retried at every letter | 586 ms median | 132 ms |
| `usage:tracker` aggregation at 22.7k records (Usage panel, every 5 minutes on Command): each bucket re-filtered and re-totalled the whole ledger | 120 ms median | 24 ms |

`usageIndex` in scripts/check-css.mjs indexes each file once. A corpus
indexes as the union of its parts, and the prefix scan matches the old
regex exactly (tests/check_css_unused.test.mjs); `npm run check`'s unused
selector step went from about 550 to 270 ms. `aggregateUsage` feeds every
bucket in one pass in ledger order, with `Float64Array` sums (a plain array
seeded with `null` boxed each addition). A reference report built the old
way pins it JSON-exact, float sums included (tests/usage_tracker.test.mjs).
Parity was also checked against the previous modules on the live ledger plus
17.5k synthetic store rows. None of these numbers are pass/fail thresholds.

## Command frames stop paying for every node twice, September 21, 2026

Why the app felt choppy: with Command as the home view and six builder
workers live, the renderer process's UI thread had averaged 40% of a core
since launch (596 s over 1478 s), the GPU process 19% and the main process
8% (per-thread CPU sampled from the live packaged app, pids 33780 / 16708 /
31196). The agents themselves already run as separate `opencode` processes;
the executor's bookkeeping on the main thread was not the cost. The board
checkpoints measured earlier in this file were also not it: the active board
(1 MB) was rewritten about once every two seconds, not once a second per job.

The frame was. In the isolated Command workload (tools/profile_studio.mjs,
Electron offscreen, software rendering, 1280x900, 154 painted nodes: 8
sessions, 128 todos, 12 tasks, 3 agents) one frame's JavaScript took 16.9 ms
on average and 29 ms at p95, against a 33 ms budget at Command's 30 Hz, and
the profile split it as: 6.9 ms placing the callout cards, 3.7 ms drawing the
orbs, 2.7 ms of per-frame bookkeeping, 1.1 ms labels. Inside the callouts,
the placement sort called `calloutPriority` for both sides of every
comparison, and each call scanned every node for an agent standing on it
(`agentOn`), so the sort was quadratic in the constellation and re-ran every
frame; each candidate spot for a card then measured its leader against every
orb on the board (17 candidates x 154 orbs), and every tie broke through
`String#localeCompare`, which builds a collator per call.

What changed (renderer/idle.js, visuals unchanged):

- `drawCallouts` builds the set of agent-hosted nodes once per pass and
  ranks each card once, then sorts on the numbers with one `Intl.Collator`.
- The label blocker's 64 px grid now also answers "does this leader cross an
  orb": `nodeLabelBlocker` records each orb's centre and reach, and
  `calloutPenalty` queries the segment's bounds instead of every node. Faded
  orbs still block a leader exactly as the linear scan did (a `ghosts` list),
  and a test-supplied blocker without the method falls back to the old loop.
- `rgb`/`rgba` memoize their strings per palette triple (a WeakMap keyed on
  the array, at most 64 alphas each), and `speechLines` keeps the last 300
  wraps keyed on text and width; both caches are dropped with the label
  widths on resize.
- `drawNodeSurface` paints the halo and body under one transform block and
  traces the circles in that unit space, so the three save/restore pairs per
  orb become one; the rim still strokes in screen space.
  tests/node_paint_cache.test.mjs reads a max pixel delta of 1 at DPR 1, 1.5
  and 2 (it was 4 at DPR 1.5 before).

Same workload, same machine, median-free single captures of 6 s after a 2 s
warm-up (frame statistics are the fixture's software compositor, not a
frame-rate claim; the per-frame JavaScript columns are the result):

| command-150-3d, per frame | Before | After |
|---|---:|---:|
| `command.frame` inclusive mean / p95 / max | 16.9 / 29.4 / 39.3 ms | 8.3 / 15.1 / 24.9 ms |
| `command.frame` self (bookkeeping, callouts, speech, bubbles) | 9.75 ms | 2.76 ms |
| `command.nodes` self | 4.32 ms | 2.81 ms |
| `command.labels` self | 1.11 ms | 0.89 ms |
| Long tasks (>= 50 ms) in the capture | 72 | 28 |

| command-30-3d, per frame | Before | After |
|---|---:|---:|
| `command.frame` inclusive mean / p95 | 5.5 / 9.8 ms | 4.9 / 9.1 ms |
| Long tasks in the capture | 13 | 4 |

With the same instrumentation left in a scratch copy, the callout pass went
from 6.87 ms to 1.12 ms per frame and the orb painter from 2.0 ms to about
1.5 ms; the remaining frame is spread over the orbs (14 us each), labels,
layout and the backdrop. Canvas operations per frame (664 fills, 501 arcs,
313 strokes, 474 saves before) fall by the save/restore pairs only; the
raster work the GPU process does per frame is otherwise unchanged and is the
next lever, along with the two full-window canvases Command composites.

Also in this pass: renderer/booklet.js's connection log kept every worker
stdout line forever (`textContent +=` on an unbounded string per line); it
now keeps the newest 400 lines and rewrites the block from that buffer.

The host itself matters here: at the time of the measurement the machine sat
at 76% CPU with six `opencode` workers, several Claude sessions and 600 MB of
RAM free (880 MB in Memory Compression), so any frame that misses its budget
is also competing for a core. None of the numbers above are pass/fail
thresholds.

## Board mutations stop re-serializing the whole board, September 21, 2026

The live project's board (`data/projects/<id>/eyes-tasks.json`) is 7.9 MB for
84 tasks, and 91% of it is `contextHistory`: 1,150 saved revisions. In file
mode (the SQLite store stays off; see `getEyes` in main.cjs) every gateway
mutation re-parsed the three board files, stringified the whole task board
twice to detect a change, hashed every task's snapshot, and pretty-printed
the whole board again to write it. Every read behind the broadcast (the task
list, the backlog summary, the queue-depth refresh) parsed it once more. All
of that ran on the Electron main thread, up to once a second per running job
through the executor checkpoint. Measured on the development Windows machine,
Node 24.15.0, on a copy of that live board:

| Cost inside one mutation | Before | After |
|---|---:|---:|
| Parse of the task board per read | 22 ms parse + 8 ms UTF-8 decode | 3 ms byte compare + 3.5 ms row clone while the file is unchanged |
| Change detection | 72 ms (whole board stringified twice) | 7–14 ms (row bodies; a shared history object compares by reference) |
| `recordTaskRevision` over 84 untouched rows | 19 ms | none (the hash is memoized on the shared history object) |
| Serializing the board for a write | 45 ms stringify + 5 ms encode | one changed row re-printed; unchanged rows copied as byte spans |

Through the gateway (`mutateBoard`, file path) with the real reader and
project facade, median of nine runs; wall time / process CPU / worst
event-loop gap under a 1 ms ticker:

| Gateway operation | Before | After |
|---|---:|---:|
| No-op mutation | 154 / 142 / 4 ms | 24 / 16 / 2 ms |
| Executor checkpoint (`runProgress` on one row) | 256 / 235 / 172 ms | 61 / 47 / 21 ms |
| One-row edit (title) | 195 / 172 / 149 ms | 203 / 46 / 20 ms |
| Scoped `readJson` of the tasks board | 44 / 32 / 3 ms | 16 / 0 / 3 ms |

Wall time includes the atomic write's disk I/O on the OneDrive-pinned tree,
which varies run to run and which the main thread does not wait on (the two
write rows above wrote the same file); the CPU and event-loop-gap columns
are the responsiveness cost. The on-disk format is unchanged,
`JSON.stringify(rows, null, 2)` byte for byte (tests/eyes_row_cache.test.mjs
pins it against a mix of moved, edited, null and history-swapped rows). A
rewrite by another process is always seen, because the reader's cache is
validated against the file's bytes rather than a timestamp, and rows handed
to callers are fresh copies with only the append-only `contextHistory`
shared. Rows that reach the gateway from a fresh parse are hashed as before,
so drift written outside the gateway is still recorded
(tests/board_gateway.test.mjs). The A/B harness stayed out of the tree; none
of these numbers are pass/fail thresholds.

`npm run check` no longer spawns one Node process per source: the in-process
pass scripts/check-syntax.mjs compiles all 90 files the way Node would load
them (CommonJS through the module wrapper, `.mjs` and renderer `.js` as
module source under the package's `"type": "module"`), and the check-targets
audit treats the pass as covering everything it discovers, preload.cjs
included. On this machine the `node --check` chain took 15.0 s; the pass
takes 0.6 s including its relaunch under `--experimental-vm-modules`, and the
five chain steps together about 2.3 s.

## Store reads leave the main process, September 21, 2026

Every OpenCode-store read (`node:sqlite` is synchronous) and the synchronous
`git status` behind `assistantFacts` used to run on the Electron main
process. Measured on the development Windows machine against the live store
(17.7 GB, 846 sessions, 121k parts) from a scratch harness, Node 24.15.0:

| Main-process read, before this change | Warm | Cold |
|---|---:|---:|
| The project facade's 400-session floor (`listSessions({ limit: 400 })`), paid by every scoped read including the 2 s A-Eyes watch | 106–140 ms | 0.8–3.2 s |
| `assistantFacts` (chat reply, briefing, overseer) | 140–160 ms | 280 ms |
| `listChatTexts` (once a minute) | 105 ms | — |
| `gitPorcelain` (`spawnSync`, 8 s timeout; every 30 s) | 100–185 ms | — |
| `activitySince({ since: 0 })` (a full part-table scan; the cursor starts at `Date.now()`, so only a bug reaches it) | 10.7–14.7 s | — |

Past a few seconds of that, Windows titles the window "Not Responding".

Now `scripts/eyes.mjs` is hosted on a worker thread by
`scripts/eyes-worker.mjs`; `scripts/eyes-client.cjs` turns each store read
into one message and a promise, restarts the worker on a crash, a timeout
(90 s) or a live-updated module, and `getEyes()` hands out the wrapped
module. The facade in `scripts/projects.cjs` no longer lists 400 sessions
to scope a read: `listSessions` takes a `root` and `listSessionIds`
returns the folder's ids without the per-session final-part lookup.

| One watcher pass (six store reads) plus one watch read, three passes back to back | Wall per pass | Worst gap on the calling thread (10 ms timer) |
|---|---:|---:|
| Inline on the calling thread (before) | 149 ms | 464 ms |
| Through the eyes worker (after) | 143 ms | 20 ms |

| Scoped session reads | Before | After |
|---|---:|---:|
| Session list behind one scoped read | 106–140 ms warm, 3.2 s cold (400 sessions) | 26–39 ms (`listSessions({ root, limit: 40 })`) |
| The folder's session-id set | (same 400-session list) | 8–11 ms (`listSessionIds({ root })`) |

A worker round trip costs 1.8–2 ms on top of the query; the first read after
launch pays a 130–220 ms spawn and module import. The same 14 s full scan
that blocked the main thread ran on the worker with the main event loop's
worst delay at 23 ms. Verification evidence for housekeeping is read before
the board mutation (which must stay synchronous) through the board gateway,
one extra read-only pass per housekeeping run.

Not measured here: the whole-app effect. The host machine sits at a few
hundred MB free, and the board itself (5.1 MB of JSON rewritten per executor
checkpoint) is unchanged; those are the next passes. `tests/eyes_worker.test.mjs`
covers the client contract and the folder scoping with a fixture module and a
temporary store; the wall-clock numbers above are not pass/fail thresholds.

## Model management and catalog work, September 19, 2026

Model Lab validates the ledger's file identity, size and change timestamps on
each read, reusing parsed observations and up to eight unchanged summaries.
New calls, ratings, external replacement, corruption and deletion invalidate
cached data. Returned objects are detached from the cache. Aggregation groups
observations by model, task and effort once instead of scanning the full history
again for each model.

| Synthetic history: 10,000 calls, 40 models, 12 task types, 3,334 ratings | Before (ms) | After (ms) |
|---|---:|---:|
| Build a complete summary | 79.73 | 34.57 |
| Read an unchanged ledger snapshot | 215.37 | 11.27 |

Node 24.15.0 on the development Windows machine; median of 15 runs after three
warmups for each operation. Six full summary comparisons matched across task
filters, human/model ratings, candidate lists and weights. The baseline was the
working implementation immediately before this pass, SHA256
`d200bb71e03b3f6f2a07f1247a4c45eb0859a76cab19a955a7d7f2dcfd6ada58`.
The local benchmark and baseline were retained under the system temporary
directory as `mefi-ledger-benchmark.cjs` and
`mefi-model-performance-baseline.cjs`. From this repository, rerun with
`node "$env:TEMP\mefi-ledger-benchmark.cjs"` while those local files remain.
These are synthetic local measurements, not provider-speed or whole-app claims.

Deterministic operation checks also verify:

- Twenty-four simultaneous catalog reads share one stat/read; ten later reads
  of an unchanged file avoid another read/parse. Twenty overlapping refresh
  requests launch one child process.
- Public roster and metadata requests start together, bounding their network
  wait to one 20-second window instead of two sequential windows. Atomic
  replacement preserves the previous file on failure; metadata fallback retains
  known prices and capabilities.
- Home startup issues zero Settings-only connection/discovery requests instead
  of five. Settings performs these on first use, including installed CLI checks.
- Multiple search inputs in a frame produce one catalog update. Formatted cards
  and search strings are reused; identical results preserve expanded details.
  Closed or hidden catalog maps do no canvas work. Catalog updates reach an
  existing map and the speed-probe model list, retaining the selected model.

The eight-check isolated Model Lab walkthrough passed with seven screenshots,
zero renderer errors, network attempts or worker launches. It exercises the
actual Electron IPC and rating persistence, lazy Settings discovery, unchanged
expanded catalog cards, context previews and a 900px layout. Its local report
is `tools/logs/model-speed-ui/report.json`. Focused behavior tests are documented
in `TESTRUNS.md`; elapsed timings are not pass/fail thresholds.

## Earlier startup measurements

Measured September 19, 2026 on the development Windows machine with Electron
44.4.1. Three runs per version, using disposable profiles and catalog-only app
data. These measure a fresh profile without a populated OpenCode database;
larger real workspaces can take longer.

| Metric (median, milliseconds) | Before | After |
|---|---:|---:|
| Command view ready and loading overlay gone | 2501 | 1992 |
| Assistant smoke process completed | 3714 | 2691 |
| Document load event | 508 | 707 |

The usable interface arrived about 20% sooner and the assistant smoke finished
about 28% sooner. The document event alone was later; the useful measure here
includes the graph and loading overlay rather than just the HTML load event.

Reproduce on Windows after `npm ci` and `npm run build-booklet`:

```powershell
python tools/benchmark_startup.py --runs 3 --output tools/logs/startup.json
```

The harness starts the normal renderer boot offscreen, instruments only a
temporary window constructor and smoke exit, disables process cleanup and paid
routes, and waits for the real loading overlay to disappear with model cards
present. A 45-second process budget bounds each run. It does not open the live
app profile, mutate the user's board, or use saved API keys.

The project workspace update removes the startup overlay from the default
home. In three fresh isolated launches, the selected project's composer became
usable in a median **822 ms** (735–1143 ms); the assistant smoke completed in
2652 ms. This measures the new usable home, compared with the prior 1992 ms
constellation home; it is not a like-for-like rendering benchmark. The catalog
and advanced visualizations may still load afterward. The harness now checks
that the workspace composer is enabled with a selected project, and retains
the original overlay/card readiness criterion for older revisions.

With backlog search, queue controls, and task-context panels added, another
three isolated launches reached a usable workspace in a median **947 ms**
(900–1114 ms); smoke completion was 2701 ms. This is a small observed startup
regression from the previous workspace measurement, not a claimed speedup.
The readings were taken while development checks were running on the same
machine. The backlog renders 20 cards initially and searches the full saved
list; history details are loaded for the selected task rather than mounted
for every card.

Finished attempts can enter local verification after 30 seconds instead of
the former ten-minute minimum wait. This changes scheduling latency only;
the evidence required for completion is unchanged. Backlog mode also avoids
spending worker time on new idea generation while existing work remains.

Other verified improvements:

- Short agent passes no longer wait 900 milliseconds between target updates;
  a 12-target pass previously accumulated up to 11.7 seconds of cosmetic waits.
- Finished model calls return without waiting for the next animation beat.
- Independent message facts are collected concurrently, preserving successful
  sources if another source fails. Concurrent store reads share pending work
  and fresh later reads still hit the source.
- A filled executor no longer holds its dispatch lock for an extra three seconds.
- Startup shares overlapping IPC reads and waits for the populated tree, omits
  a decorative process scan, and handles reduced motion without animation waits.
- Boot stars use unsigned random bits; the old calculation generated 22 negative
  radii out of 70 stars and repeatedly threw canvas errors.

Jev was checked using a synthetic classification through the saved gateway
key: `typesafe-ai/jev` returned a valid structured answer in 801 milliseconds.
The probe used 591 input tokens and 82 output tokens. That is one observed
network call, not a latency guarantee. Runtime tests use a fake transport.

## Renderer and log tuning, September 19, 2026

The session rail now suspends its animation callback while Home or Command
covers it, while the document is hidden, or when a narrow window hides the
rail. Navigation, visibility and size changes resume a single animation loop.
Command advances shared agent flights itself, so moving workers still animate
without repainting the covered rail. Repeated unchanged resize notifications
no longer reallocate its canvas; graph builds index todos by session and graph
snapshots index edge endpoints once.

The real offscreen Electron fixture counts canvas paints: both Home and
Command produce **zero hidden rail paints** over each 200 ms observation,
and the visible booklet rail resumes painting. Command task pixels, frame
progression, grouped work and exit/reentry are checked in the same run.

Command keeps existing world anchors during camera movement without rebuilding
their placement collision grid each frame. Its label placement queries nearby
node bounds through a spatial index, retaining the same padding, priorities
and fallback placement rules. The deterministic 243-node fixture in
`tests/command_performance.test.mjs` records **139,622 → 5,190 overlap checks**
(96% fewer), with identical label rectangles and text. This is a comparison of
collision work, not an end-to-end frame-rate claim. Camera changes, all five
layouts, new arrivals, orbit effects and completing nodes are also covered.

The dense Electron tour also exposed a preexisting narrow-view case where no
Auto label could fit. Auto overview titles now shorten to suit clear graph
areas below 450 pixels wide; the 277-pixel regression fixture keeps a running
task name visible without changing its node position or allowing overlaps.
Inspecting the task retains its full title.

The log viewer previously loaded the entire file and only then sliced its last
512 KiB. It now bounds disk reads and allocation to that tail using one opened
file descriptor, with short-read, rotation, truncation and cleanup checks.

| Synthetic 32 MiB log, five warmed runs | Before | After |
|---|---:|---:|
| Bytes read per refresh | 33,554,432 | 524,288 |
| Median refresh time, milliseconds | 38.05 | 4.82 |

Measured on this Windows development machine using Node 24.15.0, with two
warmups per method followed by five alternating runs and identical returned
text. The byte reduction (98.44%) is deterministic; elapsed times depend on
the filesystem cache and machine load. Only a disposable synthetic log was
used, and no live project data or paid services were accessed.

Activity polling also fences obsolete asynchronous reads: stop/restart cannot
resurrect a second timer, a project switch cannot advance the new project's
cursor with stale activity, and hiding the window during a pending read skips
the database query. Failed reads still recover on the next scheduled poll.

Three isolated startup runs before and after this pass reached the workspace
in median **1406 ms → 1339 ms**; smoke process completion was **3638 ms →
2992 ms**. The small interactive-time difference is not enough to claim a
startup speedup: these were development-machine runs, and unrelated sidebar
work also changed during the pass. Reports are kept locally under ignored
`tools/logs/performance-tuning/startup-before.json` and `startup-after.json`.
