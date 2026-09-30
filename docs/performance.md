# Agent loop and startup measurements


## Tree brightness paints a pass once, not every shape, September 30, 2026

Appearance › Tree brightness & outlines set a canvas filter (`brightness(2)`
at 200%) around the whole nodes pass and the whole wires pass. Chromium
draws every shape made under a canvas filter through a layer, so a busy tree
ran hundreds of filter passes a frame. Scripts took about 13 ms a frame; the
rest was waiting on the graphics card.

**The owner's numbers, from their laptop** (integrated Radeon 860M, hardware
rendering, a seeded project through the probe on `wip/tree-brightness-gpu`,
their look: Atmosphere with glass and glow at 100, Singularity, helix, orbit
trails, extra glow, the deep-space sky, tree brightness 200% for nodes and
lines, outlines on). They are not numbers measured on the machine that landed
this change:

| | before | after |
| --- | --- | --- |
| Vibe | 4.6 fps, GPU 98-100% | 42 fps, GPU 50% |
| Command | 8.8 fps, GPU 98-100% | 36 fps, GPU 37% |
| Home | 4.1 fps, GPU 98-100% | 43 fps, GPU 20% |

At those speeds the detail governor (`state.frameCost`, JavaScript time only)
also held nodes at tiers 1-2, so the owner had been seeing simplified nodes.

**How it works.** `toneBegin` in idle.js, called by `drawGraphConnections` and
by the nodes pass of `drawFrame`, paints the pass plain into a scratch
`OffscreenCanvas` per layer (near, and far only while a branch is focused).
The scratch starts with its layer's pen (fill, stroke, line, alpha, blend,
font, dash, transform), and `finish()` lays it down with one
`drawImage` under `brightness(n)`, then hands back the pen the pass left, so
what draws next is unchanged. That is at most four filter passes a frame. At
100% `toneBegin` returns before it reads anything else, and the pass runs as
it always did.

**The kill switch.** Appearance › Tree brightness & outlines › Fast
brightness (also in the media window's copy of that section), saved as
`fastBrightness` in `mefiStudio.treeDynamics.v1`, on by default. Off, the pass
runs under the filter as before: exact at any level, and slow on a busy tree.
Neither Reset button touches it. Without `OffscreenCanvas`, or a 2D context
for it, or a layer that has no size yet, `toneBegin` falls back the same way.

**What differs, and how much.** The filter now meets the blend of a pass's
shapes, not each shape, so a small coloured accent over a dark core (a
Singularity crescent, the progress meter's fill, glyph edges) keeps more of
its colour at 200%, where a brightened shape clipped at full intensity before
it was mixed. Outlines were the visible part: black and white come through
`brightness()` unchanged above 100% (white just clips), but in the scratch a
node's coloured rim mixed with the black ring first and came out gold or teal
instead of pale. Outlines now paint on the real layer, under the scratch, when
brightness is above 100% and outlines are on; below 100% nothing clamps, and
they stay in the pass. On the owner's PC the pixels that differ from the
per-shape filter by more than 8 levels (equal detail tiers) were 0.71% with
outlines in the scratch, and 0.15% in a probe that drew them on the layer.

Measured here on 30 September (software rendering under Xvfb, Electron 44, no
graphics card, so colours and layer sizes only and no fps). A seeded Command
view (48 nodes), owner's look, detail tier pinned to 3, still frame, against
the same page with Fast brightness off. Two runs of one setting differ by
0.01%:

| Window | outlines in the scratch (before) | outlines on the layer (landed) | and the scratch laid down first |
| --- | --- | --- | --- |
| 1536 x 930 | 0.81% | 0.20% | 0.20% |
| 900 x 560 | 1.78% | 0.45% | 0.37% |
| 720 x 460 | 1.86% | 0.69% | 0.37% |

With outlines on the layer: a focused branch (the far layer) 0.20%; nodes 50%
and lines 60% 0.04% (exact, outlines stay in the pass); nodes 150% and lines
60% 0.25%; lines alone at 200% 0.003%; Vibe 0.06%; and outlines off at 200%
0.20%, the same as with them on, so what is left is the accent colour above,
which is the owner's call, not outlines.

**Why outlines are not laid down in order.** The scratch goes down after the
pass, so an outline on the layer sits under every node in it: where two nodes
overlap, the ring of the front one ends up under the one behind (the last
column above is the version that lays the scratch down and clears it before an
outline that touches a node already in it). That version was built and
measured, and not landed. In this renderer, at 1536 x 930:

- a 160 px square drawn under `filter = brightness(2)` took 8.8 ms, the same as
  a tiny arc drawn under it (8.8 ms) and close to the whole canvas (13.4 ms):
  the filter's layer is the clip, not the shape. The same draw inside a clip
  to its own rectangle took 0.3 ms;
- a draw from a canvas followed by a write to it (the clear) took 2.9 ms,
  against 0.08 ms for the draw alone: Chromium copies the whole bitmap when a
  canvas it drew from is drawn on again;
- the lay-down version, unclipped and clearing after each, drew 2 to 4 times
  fewer frames than the landed one (23 to 45 rectangles a frame).

Clipping each lay-down fixes the first cost, not the copy. Whether a full
texture copy per overlap is cheap on the owner's card needs a measurement there.
Painting each node into a small tile and laying the tile down under a clipped
filter would keep the order exactly and pay for no full-canvas layer, and is
untried.

Tests: tests/command_tone_brightness.test.mjs (`toneBegin`: null at 100%, one
scratch per layer reused and resized, the pen in and out, one filtered
lay-down, the fallback, the switch, the far layer only with a focus, the wires
pass through a throw, and outlines on the layer before the scratch goes down),
the switch cases in tests/tree_dynamics.test.mjs, and, in Electron under
Xvfb, tests/tree_dynamics_render.test.mjs and tests/node_paint_cache.test.mjs.
tests/command_render.test.mjs stops at "Assistant narrow: pointer reaches the
switch track" on this branch's base as well.

Worth a look in the live app at 200%, with Fast brightness off for the
side-by-side: Singularity's crescent and the progress meter's fill (they keep
more colour), and the rings of two overlapping nodes (the front one's ring
runs under the one behind).

Still open: the accent colour above; a check of the live window
(`tools/profile_live_studio.mjs` refuses it, because the live window loads
`dist\Mefi Studio AI+\resources\app\renderer\booklet.html`); and the detail
governor, which sees JavaScript time only and cannot tell when the card is
the bottleneck.

## Work for surfaces nobody can see, September 27, 2026

A read-only audit of the push paths found per-push work aimed at hidden
surfaces. These changes were not profiled; the costs quoted come from the
measurements earlier in this file.

- **Command's chat log and Ask cards while Command is closed.**
  `onAssistantEvent` ran `paintChatLog` and `renderAsks` on every assistant
  push, but both live in `#idle-hud`, which is hidden unless Command is
  open. On Home the rebuilt thread and the shared-controls observer walking
  it were the 40 + 41 ms of a 97 ms push measured on September 25. Both now
  return while `state.active` is false, and `enter()` paints them.
- **`mefi:queue-settings` on every push.** `adoptQueue` (renderer/agents.js)
  dispatched it on every assistant and status push; its listeners re-render
  the companion panel and walk the document for queue controls. It now goes
  out only when the snapshot changes. idle.js already deduplicated its own.
- **Pushes to a window in the tray or minimized.** `eyes:tasks`,
  `eyes:requests`, `eyes:ideas` and `machine:status` are whole snapshots.
  While the real window is hidden or minimized, `send` keeps only the newest
  of each and sends them on `show` or `restore`; a board list held for a
  project the owner has since left is dropped. Harness windows (smoke,
  capture) are never shown and are not held. Assistant pushes still go out,
  because listeners act on each event's kind (`seedHeard`, agent, mail and
  reply handling in `onAssistantEvent`), not just on the state.
- **Select labels.** studio-ui's `labelOf` spread `el.labels` for every
  enhanced select on every refresh, and Chromium walks the whole document
  for that list again after any DOM change. It now keeps which
  `<label for>` names each select, reads its text live, and looks again when
  that label leaves the page, stops naming the select, or the user navigates.
- **Vibe's flow bar** animated `left`, a layout per frame while anything
  builds. It animates `transform` over the same sweep (`translateX(-100%)`
  to `294.12%` of its 34% width).
- **Explorer while closed.** Every `machine:status` push rebuilt the Machine
  panel and every checkpoints push rebuilt the session tree and detail, with
  the sheet closed. A closed sheet now only keeps them; opening already reads
  both afresh (`load`). An open sheet repaints checkpoints through
  `paintTreeAndDetail`, whose signature includes them, so an unchanged push
  paints nothing and a changed one keeps a half-typed detail draft and the
  focused row, which the direct `renderTree`/`renderDetail` did not.
- **`assistant:status` bursts.** `emitAutopilot` has 37 callers, several on
  each running job's output timer and tool changes, and five renderer
  listeners rebuild from every copy. It now coalesces like `assistantEmit`:
  the first call of a quiet 250 ms goes at once, later ones share one
  trailing push built when it goes.

Tests: tests/command_closed_pushes.test.mjs, tests/studio_select_labels.test.mjs,
the hidden-window and autopilot cases in tests/host_push_batching.test.mjs, and
the closed-sheet case in tests/explorer_ui.test.mjs.

Left alone on purpose, with what was measured:

- The board read's row cache still reads the whole file and compares bytes.
  A `stat` check first would skip the read and the byte compare, but the
  cache exists to never trust a timestamp, and the exFAT volume this tree
  lives on keeps modification times to 10 ms.
- `logs` stays in task-context.cjs's snapshot fields. It carries the owner's
  own notes (Tasks' Log box) as well as run lines. On this machine's live
  board (1.25 MB, 36 tasks, 194 revisions) 15 revisions changed nothing but
  `logs`, 0.05 MB, and logs inside snapshots total 0.11 MB: dropping them
  would save under a tenth and lose the notes' history.
- Node's compile cache (`module.enableCompileCache`) works in Electron 44's
  main process, but loading main.cjs's 64 local modules took 55–64 ms cold
  and 49–58 ms warm, and assistant.mjs plus eyes.mjs 18–25 ms against
  16–18 ms: inside the noise, and the first launch after each update pays
  about 90 ms to write the cache. V8 compiles lazily; the time is execution.
- A renderer code cache would pay more. Compiling the booklet's 2.9 MB inline
  script took 42–55 ms (six runs, Node 24's V8), and 2–3 ms from V8 cached
  data. Chromium keeps no code cache for inline scripts or `file://`, so
  getting it means external script files served from a privileged scheme
  with `codeCache: true`, and changes to the booklet build, the updater's
  swap, `guardWindowNavigation` and the fixtures that load the file directly.
- Vibe's aurora (three 90 px blurs drifting under about ten backdrop-blurred
  panels) and the composer's spinning ring (a `conic-gradient` driven by a
  registered property, repainted every frame) are decorative loops the
  Motion setting already stops under Calm. Pausing them otherwise is a
  design decision.

## Command canvas transfer, September 26, 2026

Following the native-font probe below, an isolated Electron 44.4.1 experiment
compared the production callout drawing functions on three canvas backends.
It used six callouts, 1,000 synthetic DOM rows, two DOM invalidations around
each draw cycle, and five alternating runs after warmup. Each run contained
30 cycles. The synchronous cycle includes the final layout flush and any
backbuffer copy; it does not time asynchronous compositor presentation.

| Median per synthetic cycle | DOM canvas | Copied offscreen backbuffer | Direct transferred canvas |
|---|---:|---:|---:|
| Cycle elapsed time | 4.91 ms | 5.17 ms | 3.48 ms |
| Callout drawing | 1.65 ms | 1.62 ms | 0.17 ms |
| Style recalculations | 2 | 1 | 1 |
| Layouts | 1 | 1 | 1 |

The copied backbuffer did not improve this workload. Transferring the DOM
canvas with `transferControlToOffscreen()` reduced the measured cycle by
about 29% without a per-frame copy. This supports the style-resolution lead
under controlled invalidation, but is not a live-session speedup claim.

All 96 pixel-buffer comparisons matched exactly across device scales
1, 1.25, 1.5 and 2, light/dark palettes, three callout styles and fractional
positions. Browser captures also matched at three scale/style combinations
after presentation. Seven candidate unit tests passed for capability
fallback, one-time transfer, resize, DPR changes, alpha options and retaining
pixels on a no-op resize.

An additional isolated native-call probe measured 900 font assignments per
run: median accumulated setter time was 46.7 ms on the DOM canvas and 0.6 ms
on the directly transferred canvas. All calls were retained, both prototype
descriptors restored, and pixel comparisons still matched. Its separate,
uninstrumented cycle measurements were 5.14 ms versus 3.71 ms. This supports
the font/style explanation for the synthetic workload without attributing
every millisecond of the earlier live sample.

The implementation was applied after isolated validation: Command renderer
passed (49.5 s), media renderer passed (33.5 s), and tree dynamics renderer
passed (11.3 s), each run separately. A subsequent expanded media fixture
also passed (38.4 s), retaining another session's new layout assertions.
Source hashes were checked immediately before promotion. The seven focused
capability/resize checks now live in `tests/command_canvas_context.test.mjs`.
Build, check and audit passed. The full gate passed 3,913 Node tests with
five skips, Python ran 248 tests successfully with one skip, and the six
normalized-path checks passed. The running app reports the transferred
context loaded and boot complete. It was idle throughout the follow-up,
so no live after measurement has been made.

Local experiment and continuation files:
`tools/logs/benchmark-font-styles.cjs`, `tools/logs/font-style-trial.json`,
`tools/logs/benchmark-font-native.cjs`, `tools/logs/font-style-native-trial.json`,
`tools/logs/prepare-canvas-transfer-candidate.mjs`, and
`tools/logs/validate-canvas-transfer-candidate.mjs`. Its original-source hash
guard intentionally rejects the now-applied checkout. Do not rerun or
promote the old candidate over subsequent edits.

## Live Command: font assignments dominate text measurements, September 26, 2026

A visible Command CPU capture with the scroll batching code loaded again
identified `drawCallout` as the largest named CPU sample, about 2.36 seconds
over 30 seconds. A test run briefly overlapped that capture; it is not a clean
before/after comparison. Sampling positions within the function do not
reliably distinguish its native canvas operations.

A separate 15-second probe timed native canvas calls and element rectangle
reads. All observations were visible Command, eight guard checkpoints found
no tests, and the source and booklet hashes stayed unchanged:

| Native operation | Calls | Accumulated elapsed time |
|---|---:|---:|
| Canvas font assignment | 6,689 | 1,167.8 ms |
| Element bounding rectangle | 1,149 | 382.8 ms |
| Canvas fillText | 6,689 | 23.1 ms |
| Canvas measureText | 2,694 | 6.0 ms |

The probe wraps calls without changing their arguments or results, counts no
text content, and restores all eight original descriptors on cleanup, with a
20-second self-restoration timer as a fallback. All eight restored normally.
These are instrumented elapsed times, not CPU self time or a speedup claim.
Renderer rAF cadence had a 16.8 ms p95; this is not Command draw FPS or GPU
presentation timing.

The next investigation is the style work reached by canvas font assignment,
including which DOM changes make that work necessary. Chromium's
[`WillSetFont` implementation](https://chromium.googlesource.com/chromium/src/+/acca47dc0a9e6971232cf29c4482cc410740f278/third_party/blink/renderer/modules/canvas/canvas2d/canvas_rendering_context_2d.cc)
updates the element's style/layout tree before resolving a font. This is a
plausible explanation, not proof that all measured setter time is style work
in the installed Electron build. Removing repeated text measurements alone
would address little of this sample. Any canvas or text-cache candidate
still needs an isolated timing comparison and visual parity checks before
being applied. No production renderer change was made from this probe.

## Live session: batch scroll-control reads, September 26, 2026

A 30-second CPU sample of the owner's running Vibe view attributed 825 ms
to `getClientRects` and 422 ms to `elementsFromPoint` under the shared
scroll-control refresh. A separate Command sample instead highlighted
callout drawing (3,435 ms over 45 seconds); that remains a separate target.
Both captures were local, bounded, and taken without starting test suites.
The CPU sampler adds overhead, and IPC elapsed time includes asynchronous
waiting, so these numbers are leads rather than application-wide speedups.

`renderer/studio-ui.js` now measures every region and arrow position before
updating hints. Unchanged visibility, coordinates and owner attributes are
left alone. This removes repeated style resolution between adjacent regions.
Native wheel/keyboard scrolling and pointer-hold behavior are retained.

An isolated Electron 44.4.1 comparison used the actual refresh functions and
scroll-control CSS, 16 overflowing panels, 25 content changes per run and
five alternating pairs after warmup:

| Median per refresh | Before | After |
|---|---:|---:|
| Style recalculations | 16.96 | 0.96 |
| Layouts | 0.96 | 0.96 |
| Refresh time | 0.80 ms | 0.57 ms |

The same fixture asserts identical arrow placement, scroll boundaries,
keyboard tab stops, hide/reopen, loss of overflow and detached-region cleanup.
These are controlled component measurements, not a live before/after claim.

```powershell
node tools/profile_scroll_controls.cjs --before <old-studio-ui.js> --after renderer/studio-ui.js --output tools/logs/scroll-performance.json
node tools/profile_live_studio.mjs --pid <running-Studio-main-PID> --seconds 30 --cpu --output tools/logs/live-performance.json
```

Use `--status` for a read-only loaded-version, visibility, focus, system idle
time and updater check. It also reports whether Command's paint context has
actually transferred to an OffscreenCanvas.
The live collector requires an existing loopback Node inspector, validates
the requested PID and this checkout's booklet path, and leaves navigation
alone. It captures static view IDs and numeric metrics, plus optional CPU
stacks; no task text, request payloads or screenshots. Capture windows range
from five seconds to five minutes; only a capture it started is stopped on
normal cleanup, and a replaced capture or renderer reload ends the sample.
Keep reports local under ignored `tools/logs/`. Compare the same view and
workload, with test suites stopped and the running source version confirmed.

## Composer sizing follows native layout, September 26, 2026

Command's chat log, rail console and assistant card no longer set textarea
height to `auto`, read `scrollHeight`, set height and read it again on every
assistant update. `growArea` uses supported native `field-sizing: content`
with a 38 px minimum and 120 px maximum, configured once per composer. The
browser follows draft, width and font changes as part of normal layout. Web
previews without this capability retain the original JavaScript path.

An isolated Electron 44.4.1 Windows comparison used the actual sizing
functions and stylesheet with 1,000 synthetic activity rows, 40 unchanged
status updates per run, one warmup per version and seven alternating pairs:

| Measurement | Before | After |
|---|---:|---:|
| Explicit `scrollHeight` reads per 40 updates | 80 | 0 |
| Median time per sizing call | 0.10 ms | below 0.01 ms |

The after timing is at the timer's resolution, not a zero-cost claim. This
isolates composer sizing; it excludes other push listeners, IPC and canvas
work. The same real-browser harness verifies long-draft scrolling, narrowing
the composer, font changes, hiding/reopening and clearing without another
JavaScript resize call. Native line fitting may use fractional pixel heights
where the prior integer `scrollHeight` sizing did not.

```powershell
node tools/profile_chat_thread.cjs --composer --before <old-idle.js> --output tools/logs/composer-performance.json
```

`tests/composer_sizing.test.mjs` pins no repeated style writes or layout reads,
independent surfaces, missing controls and the older-browser fallback.

## Live thoughts update only their bubble, September 26, 2026

`fillThread` in `renderer/idle.js` now keeps the saved conversation separate
from its pending reply. Starting, updating or clearing a live thought retains
the saved message elements; updates reuse the thought span and animated dots.
Unchanged pushes still skip layout measurements. Saved-message changes, age
labels, rewritten notices, project replacement and emptied containers still
invalidate the history. Each chat surface keeps its own cache.

Measured on Windows in Electron 44.4.1, using the production thread functions,
stylesheet and shared-controls MutationObserver in an isolated 1000x700
offscreen window with software rendering. Thirty synthetic saved messages and
40 changing thoughts per run, one warmup per version, then seven alternating
pairs:

| Measurement | Before | After |
|---|---:|---:|
| Median DOM update + observer time per thought | 1.63 ms | 0.07 ms |
| New elements across 40 updates | 2,640 | 0 |
| Saved message elements retained | 0/30 | 30/30 |

This measures only the thread update and observer work, excluding IPC, the
rest of the renderer and canvas painting; it is not an application frame-rate
claim. Timings are diagnostic, not test thresholds. The same harness verifies
identical displayed text, retained text selection, an undisturbed reader's
scroll position and following the tail while already at the bottom.

Reproduce with a saved copy of the earlier `renderer/idle.js`:

```powershell
node tools/profile_chat_thread.cjs --before <old-idle.js> --output tools/logs/chat-thread-performance.json
```

`tests/command_activity.test.mjs` also pins zero element allocation across
40 thought updates, dots/text/completion transitions, recorded-thought
deduplication, project replacement and per-surface cache recovery.

## Work for surfaces nobody can see, September 27, 2026

A read-only audit of the push paths found per-push work aimed at hidden
surfaces. These changes were not profiled; the costs quoted come from the
measurements earlier in this file.

- **Command's chat log and Ask cards while Command is closed.**
  `onAssistantEvent` ran `paintChatLog` and `renderAsks` on every assistant
  push, but both live in `#idle-hud`, which is hidden unless Command is
  open. On Home the rebuilt thread and the shared-controls observer walking
  it were the 40 + 41 ms of a 97 ms push measured on September 25. Both now
  return while `state.active` is false, and `enter()` paints them.
- **`mefi:queue-settings` on every push.** `adoptQueue` (renderer/agents.js)
  dispatched it on every assistant and status push; its listeners re-render
  the companion panel and walk the document for queue controls. It now goes
  out only when the snapshot changes. idle.js already deduplicated its own.
- **Pushes to a window in the tray or minimized.** `eyes:tasks`,
  `eyes:requests`, `eyes:ideas` and `machine:status` are whole snapshots.
  While the real window is hidden or minimized, `send` keeps only the newest
  of each and sends them on `show` or `restore`; a board list held for a
  project the owner has since left is dropped. Harness windows (smoke,
  capture) are never shown and are not held. Assistant pushes still go out,
  because listeners act on each event's kind (`seedHeard`, agent, mail and
  reply handling in `onAssistantEvent`), not just on the state.
- **Vibe's flow bar** animated `left`, a layout per frame while anything
  builds. It animates `transform` over the same sweep (`translateX(-100%)`
  to `294.12%` of its 34% width).
- **Explorer while closed.** Every `machine:status` push rebuilt the Machine
  panel and every checkpoints push rebuilt the session tree and detail, with
  the sheet closed. A closed sheet now only keeps them; opening already reads
  both afresh (`load`). An open sheet repaints checkpoints through
  `paintTreeAndDetail`, whose signature includes them, so an unchanged push
  paints nothing and a changed one keeps a half-typed detail draft and the
  focused row, which the direct `renderTree`/`renderDetail` did not.
- **`assistant:status` bursts.** `emitAutopilot` has 37 callers, several on
  each running job's output timer and tool changes, and five renderer
  listeners rebuild from every copy. It now coalesces like `assistantEmit`:
  the first call of a quiet 250 ms goes at once, later ones share one
  trailing push built when it goes.

Tests: tests/command_closed_pushes.test.mjs, the hidden-window and autopilot
cases in tests/host_push_batching.test.mjs, and the closed-sheet case in
tests/explorer_ui.test.mjs.

Left alone on purpose, with what was measured:

- The board read's row cache still reads the whole file and compares bytes.
  A `stat` check first would skip the read and the byte compare, but the
  cache exists to never trust a timestamp, and the exFAT volume this tree
  lives on keeps modification times to 10 ms.
- `logs` stays in task-context.cjs's snapshot fields. It carries the owner's
  own notes (Tasks' Log box) as well as run lines. On this machine's live
  board (1.25 MB, 36 tasks, 194 revisions) 15 revisions changed nothing but
  `logs`, 0.05 MB, and logs inside snapshots total 0.11 MB: dropping them
  would save under a tenth and lose the notes' history.
- Node's compile cache (`module.enableCompileCache`) works in Electron 44's
  main process, but loading main.cjs's 64 local modules took 55–64 ms cold
  and 49–58 ms warm, and assistant.mjs plus eyes.mjs 18–25 ms against
  16–18 ms: inside the noise, and the first launch after each update pays
  about 90 ms to write the cache. V8 compiles lazily; the time is execution.
- A renderer code cache would pay more. Compiling the booklet's 2.9 MB inline
  script took 42–55 ms (six runs, Node 24's V8), and 2–3 ms from V8 cached
  data. Chromium keeps no code cache for inline scripts or `file://`, so
  getting it means external script files served from a privileged scheme
  with `codeCache: true`, and changes to the booklet build, the updater's
  swap, `guardWindowNavigation` and the fixtures that load the file directly.
- Vibe's aurora (three 90 px blurs drifting under about ten backdrop-blurred
  panels) and the composer's spinning ring (a `conic-gradient` driven by a
  registered property, repainted every frame) are decorative loops the
  Motion setting already stops under Calm. Pausing them otherwise is a
  design decision.

## Command over a video background stops restyling the page, September 26, 2026

The owner's everyday scene: Command in Zen, a YouTube link as the Studio
background (`data-media-background`), desktop audio driving the tree, 18
nodes in the Singularity style, five agents running. Measured on the live
packaged app (1536×938 at 125 %) through the main process's inspector:
`contentTracing` for the per-thread split, `webContents.debugger` for the
renderer CPU profile, and `MefiProfiler` for frames and spans.

Before, the renderer's main thread was 65 % busy and 42 % of it was
`Document::recalcStyle`, not JavaScript. The causes, heaviest first:

- **The page under Command kept rendering.** With a video background `main`
  is only `visibility: hidden`, so Settings' node-style previews ran their
  CSS animations at 60 Hz (about 1000 style invalidations a second), and
  every forced layout re-laid out the hidden Settings page. Section 17 of
  `styles.css` now sets `content-visibility: hidden` on `main`,
  `header.page-head` and `#tabs` while Command covers them (after its fade;
  Appearance and the music preview still float the page over Command).
- **`studio-ui.js` restyled on every DOM insertion.** Its MutationObserver
  read `getComputedStyle` for each added element, forcing a style recalc per
  feed or roster rebuild: single 300 to 470 ms tasks. Added nodes are now
  tracked on the throttled refresh (rows replaced before then are never
  measured; selects are still enhanced at once), regions inside the covered
  page are skipped by selector instead of measured, and `hidden`, `title`,
  box and owner are written only when they change.
- **Same-value writes re-ran the page's `:has()` rules.** An unchanged
  `hidden` still invalidates, and the page has 75 `:has()` rules, several on
  `body`. The rail badges, the music toggle, `bumpHud`'s `dim` removal and
  `nav.js` `paintBadges` now write only on change.
- **Rail lists rebuilt whole.** The activity feed keeps its rows by entry id
  (a streamed line remakes the newest row only, pinned in
  `tests/command_activity.test.mjs`), the agent roster remakes one row at a
  time, and the Ask cards are left alone when the questions read the same
  (a rebuild also wiped a half-typed answer).
- **The empty far canvas was cleared every frame** over the video. It is
  cleared only when the last frame left something on it.

Live, same scene, 10 s windows (the scene is live, so treat these as
indicative):

| | Before | After |
|---|---:|---:|
| Frame rate (`MefiProfiler`) | 34 fps | 58 fps |
| p95 frame interval | 83 ms | 17 ms |
| Frame gaps ≥ 50 ms | 39 | 4 |
| Long tasks ≥ 50 ms | 46 | 2 |
| `command.frame` mean | 3.3 ms | 1.7 ms |
| DOM mutation records per 5 s | 5302 | 460 |
| Renderer main thread busy (trace) | 65 % | 31 % |
| `Document::recalcStyle` per 6 s | 2520 ms | 343 ms |

Command's frame gate now holds the display's rate because frames stay cheap,
so the GPU process presents about 60 frames a second instead of 34 and its
CPU rose accordingly (about 80 % to 110 % of a core). Per frame it is about
144 cached radial-gradient fills and 214 arcs (the Singularity halos, extra
glow and orbit trails; no shadows, filters or blend modes). Cutting that is
a visible trade-off and was left for the owner. Still open: `agents.js`
repaints `#agents-work-hub` twice a second while its sheet is closed, and
the companion orb's SVG and `box-shadow` animations run on the main thread.

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

## Nothing pays for what nobody is looking at, September 24, 2026

A pass across the three places the app spends its time: the renderer's
frames, the main process's pushes and writes, and the agent loop's own
bookkeeping. The theme is the same throughout: work that ran on a timer or a
push whether or not anything had changed, or whether or not anyone could see
it.

These numbers were taken in a Linux container on Node 22, not on the
Windows development machine, and without Electron: launching it there needs
the Chromium sandbox off, which was not allowed. Host and harness figures
are Node micro-benchmarks run on the real code. Canvas figures come from the
real renderer functions drawing into Skia (`@napi-rs/canvas`, kept outside
the repository), which is the rasterizer Chromium uses. Pixel deltas are old
code against new on the same Skia build. None of the numbers are pass/fail
thresholds, and the Electron fixtures (the heavy lane of `npm test`) still
need a desktop run.

### Renderer: frames that change nothing are not drawn

- **The tree rail read the whole theme palette per node per frame.**
  `colorOf` called `MefiMusic.themePalette()`, and each call re-ran
  `resolvePalette`'s contrast searches. `themePalette` now keeps one frozen
  palette per theme and custom-colour set. The rail also reads the palette
  and `graphPreferences()` once per frame, and caches the orbs, glow,
  crystal and glass gradients in unit space, as Command's `orbPaints`
  already did.
- **The rail stopped only for Home and Command.** It kept drawing at 30 fps
  under every full-window sheet (Tasks, Explorer, Brains, Planning), whose
  12 px scrim blur was then recomputed each frame. It now also stops while
  `body.dataset.sheet` is set to anything but `music`, which has no scrim.
  Its hover tip is written only when its text or position changes.
- **Every activity push reloaded all of `eyes:state` for the rail.** That is
  sessions, 300 diffs and a PNG directory walk, every 2 s while agents work,
  and the rail used none of the diffs. The rail now rebuilds from the todos
  the push carries and its last sessions. It reads everything again only for
  an unknown session, after 15 s, or after a project switch. The host keeps
  the PNG walk for 30 s per folder.
- **Command at rest.** After 30 calm frames with a slow sky (minimal, grid,
  nebula, aurora, bokeh, or any sky with motion off), Command draws every
  96 ms instead of every 30 ms. Anything that could move keeps it at 30 fps:
  pulses, specks, agents, running work, speech, easing, orbit or audio. So
  do any pointer, key, wheel or resize input and every data push, and the
  first of those wakes it at once.
- **Specks without `shadowBlur`.** Each speck and pulse dot set
  `shadowBlur`, a separate blur pass per draw, and a busy tool stream kept
  up to 600 of them alive. A speck is now one slightly wider fill (fitted
  against Skia's real shadow output) with its colour fixed at spawn. The
  pool is capped at 200, and a tool call spawns 5 specks (8 for web tools)
  instead of 10 to 18.
- **Far canvas.** It is opaque (`alpha: false`), and its sky and vignette
  gradients are cached per size and palette. It is not drawn at a lower
  resolution: unfocused, it shows crisp stars and 1 px grid lines.
- **Coalesced pushes.** Command's graph refresh on `eyes:tasks`, activity
  todos and checkpoints shares one trailing refresh per 250 ms. The Tasks
  sheet does the same and repaints its list and detail only when a row
  signature changed; `runProgress` is left out except for the selected
  task's live attempt. The Workspace skips every unchanged write in
  `renderWork`. Both read the scheduler snapshot at most once per 3.5 s.
- **Smaller items.** The Overhead sheet was uncapped at 60–144 Hz and
  matched every task to a session per frame; it is now capped at 30 fps and
  matches once per load. Label sorting uses a shared `Intl.Collator`. The
  Explorer ran a full PowerShell process scan (`machineStatus`) on every
  5 s poll; it now scans once per open and follows the watcher's push. The
  Server Styler status poll runs through `MefiBoot.pollStart`, only while
  Settings is on screen.
- **CSS.** Several backdrop blurs sat behind fills that are opaque in every
  theme, so they re-blurred the canvas under them on every Command frame:
  the HUD's tools, card, dock, legend and the controls inside them, plus the
  rail over Command and the catalog cards. Those blurs are gone. Infinite
  paint-driven loops are now bounded (the lit Brains wire flows four times,
  or while hovered; the walkthrough outline pulses four times) or moved to
  opacity on a pseudo-element (the Brains drop target, Planning's thinking
  dot).

| Renderer measurement | Before | After |
|---|---:|---:|
| `themePalette()` per call | 172–193 µs | 0.02–0.03 µs |
| Tree rail frame, 58 nodes (JS + Skia raster) | 15.3 ms | 3.4 ms |
| Palette resolutions in 3 rail frames | 174 | 3 |
| Speck pass, full pool (600 before, 200 after) | 4.62 ms | 1.32 ms |
| Speck pass, 200 specks each | 1.57 ms | 1.32 ms |
| Command frames per second at rest (whole idle.js in a harness) | 30 | about 10 |

Rail pixels moved by at most 2/255 in 32 or fewer channels across all eight
node styles, glow on and off, DPR 1 and 2. Command node pixels moved by at
most 5/255, and the `node-paint-cache` fixture's own checks, run on Skia,
read a maximum delta of 1 with unchanged gradient-creation counts.

### Main process: batched pushes, fewer writes

- **Worker output.** `logLine` sent one IPC message per line, a dozen a
  second per builder and thousands in a burst. Lines now go out as one
  array per 100 ms beat. `preload.cjs` unpacks it, so listeners still get
  one line per call. A burst keeps its newest 400 lines with a count of the
  rest, and a line is clipped at 4,000 characters for the log. Both stdout
  wires split only the new chunk and hold a line that never ends (a
  spinner, a dump) to 64 KiB. Before, a growing buffer was re-split on
  every chunk.
- **Board pushes.** `eyes:tasks`, `eyes:requests` and `eyes:ideas` carry
  whole lists, and each was copied into every renderer listener (seven for
  tasks), up to once a second per running job. `send()` now pushes the
  first of a quiet window at once, and later pushes inside 250 ms share one
  trailing push of the newest list. That list is dropped if the project
  changed before it went out.
- **Assistant hops.** Every hop of an AI role (one per 900 ms for the whole
  call) rewrote the whole pretty-printed assistant state. Hops now ride the
  2 s throttled save. Job start and finish still write at once, and quitting
  still saves synchronously.
- **Machine watch.** It rewrote `machine-status.json` and
  `resource-manager.json` on every 5–20 s tick, although nothing reads them
  back. It now writes the status only when leases, verdicts, kills or the
  capacity decision change (and at least once a minute), and the resource
  log only after a kill. Overlapping queue-status reads share one board
  read. The project store facade is kept per module and project, so its 2 s
  session scope survives from one `getEyes()` call to the next. The board
  gateway uses its untouched read as the revision baseline instead of a
  third clone, and the tray tooltip is set only when its words change.

| Board gateway, 84 tasks, 1.1 MB synthetic board, median of 15 | Before | After |
|---|---:|---:|
| No-op mutation, CPU | 13.9–14.7 ms | 11.1–11.2 ms |
| Executor checkpoint (`runProgress` on one row), CPU | 20.6–24.3 ms | 18.1–19.8 ms |

### Agent loop: less work per pass, fewer wasted tokens

- **The idea scan behind every claim.** `analyzer.verifyIdea` lowercased
  every line once per keyword. It now lowercases each file once, uses
  `indexOf`, and keeps file text by path, size and mtime. The hits are
  identical, and a test pins them against the old scan.
- **The keeper** stringified the whole board twice to learn whether `tidy`
  changed anything, when `tidyTasks` hands back the same array if it did
  not. An identity check comes first now.
- **The thinker** read the store twice a minute and built full chat facts:
  planning, a project-work scan that can spawn `gh`, four board files,
  machine status and a backlog summary. It used only the log, suggestions
  and executor facts. It now passes its own store read and asks for lite
  facts. Chat replies are unchanged.
- **The foreman** runs a board transaction to promote requests only when
  the requests file holds one that `promotableRequest` would take. The
  gateway is still the authority, and housekeeping still runs every pass.
- **The worker brief** pointed builders at the whole board file (8.1 MB on
  the live project), which a builder that opened or grepped it paid for in
  tokens. Each task run now writes `task-runs/<runId>.json` beside the
  board, and the brief's structured sections are compact JSON.
- **Host facts** were cut with `JSON.stringify(facts).slice(0, 14000)`,
  which handed the model invalid JSON and dropped the trailing keys first:
  machine, work, chatter and inbox. `assistant.boundedFactsJson` shrinks
  the largest array or string until the facts fit, always returns valid
  JSON, and names what it trimmed. The brief's machine tail reuses a status
  up to 150 s old instead of running a fresh resource pass.
- **The store worker.** `gitPorcelain` and `commitEvidence` were `spawnSync`
  calls on the single worker thread (100–185 ms, up to 8 s), and every
  store read queued behind them. They are async children now. The
  duplicate-declaration scan keeps its findings per file by mtime and size.
  The recent-edit scan behind collisions and file presence is reused while
  SQLite's `data_version` says no other connection has committed.
- **Routing.** With auto-fallback off, route resolution stops at the first
  usable provider. A compatible endpoint's `/models` probe is kept 60 s
  (15 s for a miss), and concurrent callers share it.
- **Scope heal.** A synchronous `readdirSync` walk of up to 20,000 entries
  ran for every missing file name, on the main thread, every 5 minutes and
  at every job finish. It is now one async walk per root for all missing
  names, with the same order, limits and tie-breaking. Settlement uses the
  30-minute miss cache too.
- **Per-pass indexes.** `summarizeBacklog` builds its id maps and each
  row's dependency state once, and `overlappingSessions` builds its session
  haystacks once per sessions snapshot. Both give identical results.

| Agent-loop measurement | Before | After |
|---|---:|---:|
| `verifyIdea`, rare keywords, 395 files (CPU) | 556 ms | 76 ms warm, 254 ms cold |
| `verifyIdea`, broad idea | 60 ms | 11 ms |
| Keeper tidy with nothing to tidy, 8.1 MB board | 54.3 ms | 0.1 ms |
| Duplicate-declaration scan, 109 files (wall / CPU) | 80 / 68 ms | 8 / 7 ms |
| Recent-edit scan, 12k-part store, commit between passes / none | 71 ms / 71 ms | 57 ms / 3 ms |
| `summarizeBacklog`, 84 / 600 tasks | 4.05 / 190 ms | 1.43 / 30 ms |
| `overlappingSessions`, 60 candidates × 40 sessions × 400 todos | 51 ms | 4.7 ms |
| Scope heal, six missing names over a large tree | 249–516 ms blocking | one 170–190 ms async walk, worst event-loop stall about 5 ms |
| Task context a builder is pointed at | 8.1 MB board | about 95 KB run file |
| Host facts at 29.7k characters | invalid JSON, machine and inbox lost | 11.7k, valid, every small key kept (1.7 ms) |

**One real bug on the way:** a test process was classed as hung when one
CPU sample matched the previous one. That single unchanged sample counted
as the whole 240 s idle window, so at the 5 s scan cadence of a busy lease
a test that sat idle for a few seconds was killed. `scripts/machine.mjs` now
keeps when each process's CPU last moved and measures idle time in elapsed
time (tests/machine_hang_window.test.mjs).

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

## Node styles remastered: frame cost against the merge base, September 23, 2026

Every node now animates from its own motion record and paints through the
shared painters (renderer/node-styles.js), and each style draws its own
wires, pulses and landings. Measured with tools/profile_studio.mjs
(Electron offscreen, software rendering, 1280x900, 2 s warm-up, 6 s
capture) against the merge base, in seven interleaved pairs (control and
new alternating N C C N ...), so a burst of load on the shared host hits
both sides. Medians per side; the paired delta is the median of run i
against run i.

The first integration missed the plan's gate (frame mean at most 1.5 ms
over the control, p95 at most 3 ms) on two styles: Sigil at +3.5 ms mean
and +5.3 ms p95, Prism at +2.7 / +4.2 (command-150-3d, seven pairs). The
fix round:

- A resting Sigil todo (T0; not lit, working or kicked: most of a board)
  is its seal and ONE stroke (rim, turning rune tick and centre dot) traced
  in pixels, instead of a save, a transform and four draws. A resting Prism
  kite is traced in pixels too, and the light band steps its lit plane up
  the tone ramp instead of adding a third fill.
- Resting Sigil session and todo wires are one plain line (their rune dash
  shows on inspected, active and working wires, and on the task and folded
  links). Prism's glint runs only on a wire that carries work, a lit one, or
  one between T2+ gems, and a solid Prism wire never touches the dash.
- Every wire hook (the free styles' shared one, Singularity, Prism, Sigil)
  sets the canvas's alpha, cap, dash and offset back by hand instead of a
  save and a restore per edge, and sets no dash at all for a solid line; the
  Command view's edge pass clears the dash once a frame for them.

| command-150-3d, 7 pairs | `command.frame` mean, control → new (paired Δ) | p95 (paired Δ) | `command.nodes` self |
|---|---:|---:|---:|
| Classic orbs | 6.15 → 6.66 ms (+0.64) | 9.6 → 11.7 ms (+1.6) | 2.29 → 2.56 ms (×1.12) |
| Soft glass | 6.18 → 6.94 (+0.67) | 10.0 → 11.3 (+1.6) | 1.24 → 2.83 (×2.28) |
| Minimal | 5.32 → 6.15 (+1.19) | 9.0 → 9.6 (+1.0) | 0.43 → 1.98 (×4.65) |
| Halo | 5.88 → 6.96 (+0.92) | 9.5 → 10.7 (+1.4) | 0.89 → 2.64 (×2.97) |
| Crystal | 6.82 → 7.07 (+0.52) | 10.2 → 10.8 (+0.7) | 1.86 → 2.94 (×1.59) |
| Singularity | 6.54 → 7.48 (+0.82) | 10.6 → 11.6 (+0.2) | 2.72 → 3.22 (×1.18) |
| Prism | 6.62 → 7.51 (+1.20) | 10.7 → 12.1 (+1.4) | 2.84 → 3.32 (×1.17) |
| Sigil | 6.27 → 6.82 (+0.56) | 9.9 → 10.9 (+1.0) | 2.48 → 2.67 (×1.08) |

The 30-node scene (command-30-3d) stays inside the 60 Hz glide's budget in
every style: frame means 3.85 to 4.75 ms (at most 6) and p95 7.0 to 8.2 ms
(at most 10). No steady frame builds a gradient; Sigil's three per run are
its lazily built glow, well and spark the first time a node shows them.

What still misses a plan gate, and why:

- `command.nodes` self for the free styles (Soft glass ×2.3, Halo ×3.0,
  Minimal ×4.7 against at most 1.3 and 1.0). The control's Halo and Soft
  glass paid their cost in the raster (`shadowBlur`, gradients built per
  frame) outside that span, and its Minimal was one fill a node; every node
  now also steps its motion record and paints through the shared dispatcher,
  about 10 us a node for 150 nodes. The frame means above, which include the
  raster, stay inside the gate.
- Long tasks (50 ms and over). The per-run counts are small and bursty on
  this shared host (0 to 32 a run, the bursts landing on both sides), so the
  1.25x ratio does not resolve: per-run medians went from 0 to 2 on the
  control to 1 to 6 on the new build (Prism 29 → 21 and Sigil 41 → 22 in
  total; Crystal 3 → 50, most of it two runs during a host burst).

None of these numbers are pass/fail thresholds beyond the plan's own gates.

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
