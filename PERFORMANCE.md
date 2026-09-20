# Agent loop and startup measurements

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
