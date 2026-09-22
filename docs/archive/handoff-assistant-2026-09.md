# Mefi's Studio AI+ — Always-on Assistant Handoff

> **Historical record.** Written before the extraction into this repository; its nested paths and test counts describe the old layout. Kept for the design notes only.

Branch `claude/wonderful-hamilton-ql8jnf`, all work under `mefi-studio/` plus its tests
in `tools/test_mefi_studio_*.py` and one row per test in `TESTRUNS.md`. Everything below
was verified on a Linux VM with Electron 44 under `xvfb-run` and no OpenCode store or API
key; the Windows-only paths (tray, keep-awake, close-to-tray, window-bounds restore,
resource-manager kills) are code-reviewed but not executed.

## State

- `python3 -m unittest discover -s tools -p "test_mefi_studio_*.py"` — 106 tests OK (1 skip).
- `node scripts/auditor.mjs` — ok, 0 findings. `npm run check` — clean.
- Headless smoke (`electron --no-sandbox . --smoke` under xvfb) — exit 0; the service ticks,
  three agents start concurrently, the missing store is one problem entry, no stack traces.
- `electron . --assistant-proactive` — one tick, the pool drains, JSON summary, exit 0.
- Screenshot tour (`--capture`) — 26 PNGs in `tools/logs/mefi_studio_captures/`.
- `renderer/booklet.html` is rebuilt from the sources and committed.

## Implemented

1. **Cleanup**: the committed booklet had drifted from its sources (rebuilt); `ideas:scan`
   no longer rejects when the store is missing; the Proactive switch defaults on.
2. **Always-on assistant** (`scripts/assistant.mjs` pure logic, `main.cjs` service,
   renderer surfaces): a service loop from boot, independent of any open surface; a
   thread and composer in the Explorer and on the Command card (`M`); grounded local
   replies with or without a key, AI replies on DeepSeek when a key is saved, and a
   message is never lost (requests are queued to the inbox); self-fixes (missing
   `data/models.json` restored from the snapshot, broken `data/eyes-*.json` moved aside
   and replaced, resolved audit/collision requests cleared, stray test processes reported
   as fixes); housekeeping (done tasks archived after 24 h, finished ideas pruned, stale
   auto requests and dead checkpoints dropped); tree organization (active / stale /
   folded sessions, one "N finished" cluster); tray + `powerSaveBlocker` so it keeps
   running with the window closed; state in `data/eyes-assistant.json` (gitignored).
3. **Agent pool**: watcher, machine, auditor, keeper, briefer on cadences, one responder
   job per message, on-demand improver/grower/ideas/reference; bounded by
   `prefs.parallel` (1–6) and `prefs.aiParallel` (1–3), priority, per-job timeout, one job
   per role; the roster, the Working-on list and the steppers are in the Explorer column
   and the Command card.
4. **Work journal + resume**: every job is written to disk when it starts and removed when
   it settles; a boot after a quit/crash restarts unanswered replies, interrupted jobs and
   roles (3 attempts, then dropped with an error), logs the resume summary and posts it to
   the thread; `work-stale` problems after 10 min.
5. **Agents on the node tree**: the assistant node with a breathing ring, ten agent
   satellites, and flights: an agent flies to the session / task / cluster it works on,
   hovers with orbit and bob, is tethered by an animated dashed line, sends pulses and
   sparks, hops between targets, and returns home with a bright pulse — on the rail and
   in the Command constellation. The service ticks every 30 s (2 min hidden) and dwells
   900 ms per visited node so the trips are visible.
6. **In-app live update**: `scripts/updater.mjs` plans each change set — `styles.css` is
   injected live, `scripts/**.mjs` are re-imported in the running process (versioned
   loader), `preload.cjs` and renderer edits reload the page once the user pauses (4 s idle
   with no unsaved text, 30 s at the outside) with tab, sheet, selection, zoom, field text,
   scroll and focus restored, `package.json`/`assets` only sync, and only `main.cjs` still
   restarts the app (window bounds restored). Manual apply skips the pause.

## Verified proofs (all reproducible on this branch)

- Live update, host half, in a scratch copy under xvfb: a stylesheet edit restyled the page
  in ~1.3 s with no reload; a `scripts/machine.mjs` edit was swapped and used by the next
  machine pass in the same process; a `renderer/nav.js` edit waited at `waiting:reload`
  while a text field held text and reloaded 3 s after it was cleared.
- Live update, renderer half, in headless Chromium across a real reload: Command view
  active, selection, zoom 2.6, two field texts, a scroll offset and focus all came back,
  and the search re-applied.
- Kill-and-restart: a fixture state with a 2 h 13 m old heartbeat, a running `improve`
  job and an unanswered message → the next boot logged the resume line, re-ran the reply
  and the interrupted roles, and left an empty journal.
- Agent flights, headless: the reference agent flew from home to a task node, hovered
  (orbit + bob, pulses every 350 ms), hopped between two sessions, and returned exactly to
  its home slot on `done`.

## Remaining

- **Understanding-workflow findings**: an adversarially verified list of small cleanup
  items (dead code, doc drift, robustness) across every subsystem was being produced when
  this handoff was written; apply them (see the session's workflow transcript) — none
  block the features above.
- **Adversarial review** of the whole diff has not been run; the code was verified by each
  implementer and by the integration gate, not by an independent reviewer.
- `catalog:read` still throws ENOENT on the very first boot of a fresh clone (before the
  assistant's first tick restores `data/models.json`); make the handler fall back to
  `data/models.snapshot.json` the way `scripts/build-booklet.mjs` does.
- Content-Security-Policy: the page has none (Electron warns on every dev boot). The
  renderer only loads local files directly and every web call goes through main, so
  `default-src 'self' file: data: blob:; script-src 'self' 'unsafe-inline'; style-src
  'self' 'unsafe-inline'; img-src 'self' file: data: blob:; connect-src 'self' file:`
  should work — add it and re-run the capture tour.
- Capture tour: step `13-task-tree` screenshots an empty rail although the rail draws (a
  direct probe shows root + assistant + agents) — wait two frames after `togglePin(true)`
  before `capturePage`; and the tour adds a demo task to the tracked
  `data/eyes-tasks.json` — snapshot and restore the live data files around the tour.
- AI paths with a key (briefer, chat replies, on-demand AI jobs) were not exercised here.
- Wording parity between the renderer's `assistantSummary` and the module's
  `summarizeForTree` (the tray tooltip) is not tested.
- Known limits by design: responder jobs bypass the pool caps; a timed-out job keeps
  running invisibly until its own promise settles; an unfocused window takes a reload or
  restart immediately; the keeper prunes the tracked `data/eyes-requests.json` and
  `data/eyes-tasks.json` (they are live state that happens to be committed — consider
  gitignoring them like `eyes-assistant.json`).
- Outside `mefi-studio/`: `.tmp_diag_out.txt`, `.tmp_diff1.txt`, `.tmp_diff2.txt` and
  `_wall_debug.txt` at the repo root look like leftovers; not touched.

## Merged with main

`origin/main` (its own A-Eyes autopilot, fix-claim history and reactive desktop-audio
glow) was merged into this branch keeping both sides: 109 studio tests pass, the auditor
is clean, the smoke run shows the service running. Notes from that merge:

- Two briefing paths exist when Proactive is on and a key is saved: the branch's
  `briefer` role and main's autopilot timer (`autopilotProactivePass`) both call
  `runAssistant("brief")` every 5 minutes. They share one dedup baseline
  (`requestBaseline`) so requests do not double up, but it is two AI calls per cycle;
  collapsing the autopilot pass onto the service's cached brief is a follow-up.
- Main's autopilot executor (`executeNextRequest`: `cmd.exe /c opencode run …`) is
  Windows-only and was not exercised on the Linux VM.
- The Command view now has main's `.cmd-feed` rail top-left next to the branch's pills;
  CSS merged cleanly but the layout was not screenshot-checked after the merge — run
  `--capture` once on a desktop.
- Stale sessions take main's stale colour only when their todos earned no done/active
  colour (judgement call in `tree3d.js buildGraph`).
- Pre-existing on main: `data/assistant-history.json` is not gitignored, and one
  `TESTRUNS.md` row carries a literal `\n`.

## Run and verify (Linux)

```bash
cd mefi-studio && npm install && node node_modules/electron/install.js
npm run check && node scripts/auditor.mjs && node scripts/build-booklet.mjs
cd .. && python3 -m unittest discover -s tools -p "test_mefi_studio_*.py"
cd mefi-studio && export ELECTRON_RUN_AS_NODE=
xvfb-run -a node_modules/electron/dist/electron --no-sandbox . --smoke
xvfb-run -a node_modules/electron/dist/electron --no-sandbox . --assistant-proactive
xvfb-run -a node_modules/electron/dist/electron --no-sandbox . --capture   # then: git checkout -- data/
node scripts/assistant.mjs --self-test
```

On Windows: `Run Mefi's Studio AI+.cmd` (or `npm start`), then watch the node tree: the
assistant node sits above the root with its agents around it; within 30 s the watcher
visits the sessions, and any message from the Explorer or `M` on the Command view gets a
reply while its responder agent lights up.
