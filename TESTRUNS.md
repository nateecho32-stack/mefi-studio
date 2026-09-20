# Test Runs

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

Use the local Node.js and Python contracts for this Electron app:

```powershell
npm run check
npm test
```

`npm run check` verifies package-script targets and JavaScript syntax and runs the spec-collision audit (`npm run check:specs`, `scripts/spec-collisions.mjs`) that enforces the CONTRIBUTING.md test-file conventions. `npm run check:css` (`scripts/check-css.mjs`) is the standalone CSS-refactor safety gate: it computes the cascade-winning declaration for every (selector-context, property, importance) key in a stylesheet and proves a candidate (by default the working copy of `renderer/styles.css`) keeps exactly the same winners as the base ref (by default `HEAD`), reporting missing/changed/new winners and exiting non-zero on divergence. `tests/check_css.test.mjs` pins the winner extraction, cascade-equivalence comparison and the CLI exit codes (`node scripts/check-css.mjs base.css candidate.css` also works on bare files). `npm test` runs the Node behavioral suite in `tests/`, all Python contracts in `tools/`, and the normalized-path lock proof (`node tools/test_normalized_path_lock.mjs`, the A-Eyes overseer directive's named check) as its closing gate. To investigate one layer or one contract:

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

## Python contracts

| Contract | Coverage |
|---|---|
| `tools/test_mefi_studio_catalog.py` | Mefi's Studio AI+ (repository root) catalog contract: offline snapshot shape and unique ids, typical-request cost recomputed from price + token mix, quality indices only with a declared `AA`/`AA*` source and a recorded AA index version (never guessed), plan caps in `{15, 30, 60, unlimited}`, promos carrying their base cap, task-preset weights summing to 1, and endpoint-map resolution. No network, no Node. |
| `tools/test_mefi_studio_booklet.py` | Mefi's Studio AI+ booklet contract: the built `renderer/booklet.html` bakes exactly the snapshot catalog, stays self-contained (no `<script src>`, no `<link>`, no remote resources), keeps the refresh-on-open markers (`no-store`, six-hour focus refresh, `mefiStudio.readCatalog`), and ships print styles; template placeholders and Node syntax checks when Node exists. The behavioral half is `tests/booklet_build.test.mjs` (`node --test tests/booklet_build.test.mjs` from the repository root, part of `npm test`): the real `scripts/build-booklet.mjs` `build()` runs on a fixture root (committed template + styles + renderer scripts, a two-model catalog) and the smoke asserts the output `booklet.html` exists and is non-empty with all three placeholders replaced, non-empty baked style/code blocks, the baked catalog matching the fixture, a rebuild over identical inputs reporting `changed:false`, and a missing renderer input rejecting with no output written. |
| `tools/test_mefi_studio_launcher.py` | Mefi's Studio AI+ launcher contract: Electron entry `main.cjs` with pinned electron, windowed `love.exe` on `dev/dev_tool_love_project` with the optional game checkout (`GAME_ROOT`) as cwd, never `lovec.exe` for interactive launches, smoke only through `Run Dev Tool (LOVE2D).cmd --smoke`, taskkill cleanup, the `ELECTRON_RUN_AS_NODE` guard, the preload IPC surface (catalog, studio, speed probe, A-Eyes), the `capture` script, and the renderer staying node-free. When Electron is installed on a Windows runner it also boots the real hidden `--smoke` window and asserts the rendered card count. |
| `tools/test_mefi_studio_eyes.py` | A-Eyes contracts: the OpenCode store is opened read-only, the main process registers the eyes IPC + 1.5 s activity poll, the preload exposes the bridge, the Club Blackout tokens and 3D task-tree rail exist, and a **fixture OpenCode database** is dumped through the real `scripts/eyes.mjs` to pin change math (edit diff `+2/-1`, write content `+3`, patch file sets, reads excluded from changes but present in activity), collision detection with owners and `HH:MM–HH:MM` overlap windows (shared-window prompts, gap-tolerated handoffs labelled edit spans; the explorer rows and detail tooltips show the same ranges), overlap-window validation in request inputs (overlapRangeOf: corrupt/NaN/inverted windows normalize to null, zero-length windows stay real), and boundary coverage (adjacent windows touching at one instant, a gap of exactly overlapMs inclusive vs one past it excluded, contained windows intersecting to the inner session's window, a three-session nested group whose common intersection is the innermost session's single instant, and zero-length single-instant pairs), inactive-owner handoff (confirm before further edits; ownership is not silently reassigned), `assistantFacts()` carrying owner/ownership/presence/handoff and uncommitted-only features vs HEAD (session-touched dirty/untracked files; deletes and untouched dirty files omitted), live `assistantFacts({ root: REPO_ROOT })`, the live store + executor reading that presence, the collisions IPC returning live file presence, the explorer collateral watch listing live solo editors (even with no briefing) plus per-file owners, duplicate-declaration merge-corruption requests, title-overlap adopt-don't-clobber advice, and briefing-to-fix-request conversion; the renderer poll pause — boot.js's shared poll guard (every `pollStart` clears before it sets, so a hidden tab issues no fetch and hide/show toggles never stack intervals) with nav.js's badge poll registered through it, pinned in source and in the built `booklet.html`. Its fixture databases are built only by the shared `_fixture_db`/`_boundary_db` helpers inside per-run `tempfile.TemporaryDirectory()` dirs — unique fixture naming, pinned by the contract itself (`test_fixture_databases_use_unique_per_run_temp_dirs`) so two sessions can run the suite concurrently without re-colliding, and the module pins its own unique basename against the unittest-discovery shadow that `npm run check:specs` guards repo-wide. Node-only half skips cleanly without Node. |
| `tools/test_mefi_studio_auditor.py` | The third agent's contract: runs the real local auditor (`scripts/auditor.mjs`) against the repo and fails on any error-level finding — un-bundled renderer scripts, preload channels without main handlers, listened events nothing sends, renderer DOM lookups missing from the template, studio tests missing from TESTRUNS/`test_sets.json`, npm script targets that do not exist, and unparseable data files. Also pins the auditor/checkpoint IPC wiring, and the package.json `check` chain leading with the check-targets audit (`scripts/check-targets.mjs`, `npm run check:targets`): every referenced target exists on disk, node paths in other scripts are not stale, and every `scripts/*.mjs` + `renderer/*.js` source (plus the `main` entry) is covered by the chain — the behavioral half is `tests/check_targets.test.mjs` (`node --test tests/` from the repository root, part of `npm test`). Both live-tree probes (the auditor run and the check-targets coverage walk) are guarded by the shared `tools/flake_capture.py` retry: the suite audits a tree that parallel agent runs edit concurrently, so a one-shot failure that clears on immediate re-run is recorded to `data/python-flake-capture.jsonl` (local only) and surfaced as a skip instead of failing the gate — the capture that names which test flaked (the "203 tests, failures=1 then passed twice" occurrence); a failure that reproduces re-raises the original. No network, no key, no Electron. |
| `tools/test_mefi_studio_analyzer.py` | Analyzer contracts: runs the real engine (`scripts/analyzer.mjs`) against a fixture work tree — file analysis finds outline entries, TODO markers, and referenced paths that exist vs are missing, while idea verification reports related work with evidence hits for grounded ideas and `new`/0% for nonsense. Also pins the analyzer IPC/preload/overlay wiring. No network, no key. |
| `tools/test_mefi_studio_idle.py` | Dream mode contracts: the five-minute quiet clock and input reset, the four Zen audio profiles with slow/quick tempo mapping, the task-vs-external split (edit/write/patch pulse the path, reads/searches vaporize as blue-white particles), per-path touch brightness that fades and brightens when multiple agents share a path, the `MefiTree.snapshot` API the view renders from, bundled `idle.js`, template HUD ids, and the Electron autoplay policy that lets bells play without a gesture. |
| `tools/test_mefi_studio_tasks.py` | Task/reference/ideas contracts: the real reference engine (`scripts/reference.mjs`) against fixture data — code hits, matching node-tree sessions, chat idea scanning, PNG name matching, and web staying off unless asked; plus the tasks/ideas/prefs IPC + preload wiring and the tasks/ideas/overhead overlay templates with their toggles (web, node history, blur menu, auto reference). No network. |
| `tools/test_mefi_studio_machine.py` | Machine coordination contracts: fixtures through the real `scripts/machine.mjs` — live vs dead lease records (a dead exclusive lease must not block width, stale holders are reported not pruned), and process classification into healthy / hang (no CPU progress) / orphan (dead parent) / over-age, with only strays killable. Pins the resource-manager IPC + preload + explorer Machine panel, the briefing facts carrying lease/run state, and the gitignored generated status files. Both fixtures are built only inside per-run `tempfile.TemporaryDirectory()` dirs — every `--classify-fixture`/`--leases-fixture` hand-off reads a path derived from that run's own temp dir, pinned by the suite itself (`test_fixtures_use_unique_per_run_temp_dirs`) so concurrent runs never share fixture paths. No PowerShell or LOVE is launched. |
| `tools/test_mefi_studio_fixture_paths.py` | Generalized unique-fixture contract sweeping every sibling `tools/test_mefi_studio_*.py` suite so no contract can regress to shared fixture paths (the recurrence behind the A-Eyes eyes-test collisions and the flaky machine lease fixture): no suite writes a fixture into the repository tree (no repo-anchored `write_*` target, no repo-anchored `.db` path) or the shared `tools/logs` evidence tree, every `tempfile.TemporaryDirectory(` usage is a context-managed per-run block, and no suite shares a discovery basename with a sibling (the unittest-shadow rule `npm run check:specs` guards repo-wide). Generalizes the per-suite pins in `test_mefi_studio_eyes.py` (`test_fixture_databases_use_unique_per_run_temp_dirs`) and `test_mefi_studio_machine.py` (`test_fixtures_use_unique_per_run_temp_dirs`). Pure source scan: no network, no Node. |
| `tools/test_mefi_studio_updater.py` | Live-update contracts: fixture trees through the real `scripts/updater.mjs` — the reload/restart/ignore classify table (renderer scripts and styles reload, `main.cjs`/`preload.cjs`/`package.json`/`scripts/**`/`assets/**` restart, generated `booklet.html`, `data/`, `dist/`, dotfiles and editor temp files ignored, restart winning over reload), content-hashed snapshot + diff against a cheap stat poll, payload sync that creates and deletes but never touches the payload's live `data/` — and that reports one unreplaceable destination instead of aborting the rest, leaves no `.sync-tmp` behind and holds the update rather than reloading or relaunching into a half-written payload, retrying the whole held set once the lock clears — syntax validation that holds a broken file instead of relaunching into a crash, reading `renderer/*.js` with the booklet's classic-script goal (a top-level `await`/`import`/`export` is held) while `main.cjs` and `scripts/**.mjs` keep `node --check`, the quiet-period debounce restarting on every notify so a write burst longer than the quiet period is still one action, and `maxWaitMs` forcing a pass through an endless burst, the idle safety-net poll pausing while the window is hidden (the host's `hidden` probe) and backing off on unchanged reads toward `POLL_MAX_MS` (`POLL_INTERVAL_MS`/`POLL_BACKOFF_FACTOR` exported, snapped back by any watcher hint or change, so a change made while hidden still applies on the first visible walk and no surface goes stale; `renderer/overhead.js`'s sheet poll carries the same pause/backoff, its `window.MefiOverhead` export pinned only to the `open`/`close` consumer surface (not a verbatim member list) in source and in the built `booklet.html`), manual apply while auto-restart is off (including an apply that lands mid-run, which is queued and still applied), the three-restarts-in-60-seconds loop guard checked before the build so a held restart never leaves the payload ahead of the process, and the packaged Electron-runtime guard. Also builds the booklet into a temp root through the exported `build({ root })` without touching the committed one, and pins the wiring: `update:status`/`update:set`/`update:apply` IPC, the preload names, the template's update ids, the SMOKE/CAPTURE/CLI skip, and the `--updated` relaunch; and runs `main.cjs`'s own `applyRestart` and `update:apply` handler against the engine, so a manual "Restart now" stays out of the restart-loop history (three presses do not hold the next real update), an apply queued behind a run in flight never relaunches the app, and neither does a deferred or held apply. No Electron, no network; the Node half skips cleanly without Node. |
| `tools/test_mefi_studio_routing.py` | Provider routing and coding-CLI contracts for Mefi's Studio AI+: the z.ai key lives in its own `zaiApiKeyEncrypted` field (headless `MEFI_STUDIO_ZAI_KEY` + `--set-zai-key` included), only a saved/encrypted status crosses `settings:get-key` IPC — never the raw key, which is also never interpolated into logs or prompts; the assistant router prefers z.ai GLM under `auto`, explicit `zai` errors rather than silently billing OpenCode, explicit `opencode` never touches the z.ai key, and the OpenCode fallback requires `auto` + the opt-in toggle + a Go key; glm-5.3-flash is the routine route and glm-5.3 the heavy one (improve/overseer passes) with its own `thinking.type`/`reasoning_effort` shape; autopilot `opencode run` jobs ride the Studio-managed `mefi-zai` provider via `OPENCODE_CONFIG_CONTENT` + `MEFI_ZAI_API_KEY` process env (key never written to OpenCode's auth store); the CLI panel detects `opencode`/`codex`/`claude` via `where.exe`, launches them detached, and the z.ai link probe runs `opencode models mefi-zai` under the injected env; the speed probe splits glm-* models onto `ZAI_API_KEY` + the coding-plan endpoint and keeps the `x-opencode-session` header off z.ai. When `node` and `opencode` are on PATH a live half runs the real `zaiProviderConfig()` through `opencode models mefi-zai --pure`; that half skips cleanly without them. No paid API call is ever made. |
| `tools/test_mefi_studio_tree_keyboard.py` | Tree-rail keyboard + ARIA contracts for Mefi's Studio AI+ (`renderer/tree3d.js`): the template ships `#tree-canvas` as a labelled, focusable `role="tree"` container and `init()` re-asserts that over one hidden `role="treeitem"` proxy it owns via `aria-owns`; `onCanvasKeyDown` keeps the ArrowUp/Down/Left/Right sibling walk (Home/End to the ends, Escape dropping the focus, every branch preventDefault'd), Enter/Space activate through the same `activateNode` path the click handler uses (selection rides `mefi:tree-select`), and `setKbdFocus` keeps the roving `aria-activedescendant` on `tree-kbd-item` with the focused node's label and `aria-selected` state, cleared on blur and Escape, with `buildGraph` re-pointing the focus after a rebuild. Removing any binding fails the file. The behavioral half is `tests/tree3d_keyboard.test.mjs` (`node --test tests/tree3d_keyboard.test.mjs` from the repository root): tree3d.js runs against a minimal DOM stub, synthetic ArrowDown/ArrowUp/Enter/Space/Home/Escape events drive the rail, and the test asserts the selection moves between two sessions and toggles off, the proxy announces each node's label with `aria-selected` in step, and the activedescendant follows the focus and clears. Re-verified 2026-09-19 in run_1789852550913_2: the behavioral half passes solo, passes in one shared process with the palette suite (`--test-isolation=none`, the `?keyboard-test` import keeps tree3d.js out of the shared module cache), and passes four times concurrently as separate processes; `tests/spec_collisions.test.mjs` is 4/4 and `npm run check:specs` reports 82 specs with unique basenames and no orphans. |
| `tools/test_mefi_studio_palette.py` | Command palette contracts for Mefi's Studio AI+ (`renderer/palette.js`): the window keydown handler keeps its Escape branch (preventDefault then `close()`, the guarded close that also restores opener focus), and the roving `aria-activedescendant` stays bound to the `#palette-input` element itself — set to the active option id in `setActiveOption`, cleared when the result list empties and again in `close()`, on an input the template ships with `id="palette-input"` and the `combobox` role. The highlight chain is pinned end to end: `render()` writes the `palette-option-N` ids, `aria-selected` and the `.active` class from `state.index` and refreshes `setActiveOption()` on both the empty and populated paths, `setActiveOption` reads the `li.active` row, and the shared ArrowUp/ArrowDown branch preventDefaults, wraps `state.index` around both ends of the filtered list (Down past the last row lands on the first, Up from the first lands on the last, within the 40 rows shown, and an empty list is a no-op) and re-renders in that order. Escape's restore is pinned too: `open()` captures the opener before claiming the layer, `close()` releases the nav layer before `restoreOpener()`, and the restore refocuses only a connected, unhidden, non-body opener once, dropping it afterwards. The pointer path stays focus-free: option rows never take a tabindex and the hover/click handlers never call `.focus()`, while the CSS gives the input and the option rows an outline only under `:focus-visible` (plain `:focus` suppresses the shared input ring instead), pinned in `styles.css` and the built `booklet.html`. Removing any binding fails the file. The behavioral half is `tests/palette_keyboard.test.mjs` (`node --test tests/palette_keyboard.test.mjs` from the repository root): palette.js runs against a minimal DOM stub, synthetic window keydown events drive the list over three destinations, and the test asserts ArrowDown wraps last-to-first and ArrowUp wraps first-to-last with `aria-activedescendant` following, Escape closes and hands focus back to the opener element, and reopening from a second opener then running Enter executes the active destination and restores that opener too. Re-verified 2026-09-19 in run_1789852777607_4: the behavioral half passes solo, passes in one shared process with the tree3d keyboard suite (`--test-isolation=none`, the `?keyboard-test` import keeps palette.js out of the shared module cache), and passes four times concurrently as separate processes. Re-verified 2026-09-19 in run_1789853206630_8 with a strengthened suite: a `type()` helper fires the input listeners for real so the wrap span is exercised against filtered sets too (a one-row `task` query wraps onto itself and a two-row `bo` query wraps ArrowUp first-to-last and back), each followed by an Escape that still restores the opener. Re-verified 2026-09-19 in run_1789854441344_3: the behavioral half passes solo and in one shared process with the tree3d keyboard suite (--test-isolation=none), and the contract half tools/test_mefi_studio_palette.py is 8/8 OK. |
| `tools/test_mefi_studio_assistant.py` | Always-on assistant contracts: fixtures through the real `scripts/assistant.mjs` — tree organisation into active / working / stale / folded with a capped display order and hidden folded todos, housekeeping (done tasks archived after 24 h with a log line, ideas and completion history retained, resolved audit and collision requests and 3-day-old auto requests cleared, exact duplicates deduped, manual requests never touched, checkpoints of vanished sessions dropped and lists capped at 50, `changed:false` on a second pass), intent routing for a dozen phrasings (punctuation and casing ignored, a leading imperative verb becomes a request), grounded local replies (counts from the fixture, "put on the task board as the next piece of work" for requests, help listing the commands, unreadable facts named instead of invented), the 5/10/20/40/60-minute AI backoff table and `normalizeState` on garbage, and the agent pool: the ordered role roster with cadences, `dueRoles` (cadence elapsed, queued/running never re-enqueued, the briefer gated on proactive + key + backoff), `applyAgentEvent` roster transitions with accurate `pool.running/queued` counts and the combined action text, running rows reset to idle on load, `parallel`/`aiParallel` prefs clamped, and "N agents working" on the tree summary; and the work journal: `pendingWork` on the raw saved state (in-flight jobs, unanswered messages, interrupted roles, closed-for time), `applyWork` add/update/remove with the cap of 40, the `resumeSummary` boot line, the `resume-work` intent and the status reply listing what is being worked on. Also pins the wiring: `assistant:state/message/control/prefs` IPC and the preload names, `startAssistant` scheduled from `app.whenReady` with a `setTimeout` chain (no `setInterval`), `powerSaveBlocker`, the gitignored `data/eyes-assistant.json`, the Explorer composer/thread/activity ids and the Command view pill, tree3d and idle.js handling the `assistant` and `folded` node kinds, the `M` key in the help rows, and the README's "Always-on assistant" section. Node focus: `state.focus` normalization, the `focused on …` tree sublabel, replies naming the focused node when nothing else matches, `assistant:focus` IPC + `assistantFocus` preload, `assistantFocusSubject` grounding the responder's hop and claiming a focused session on the queued request, and the rail/Command click → `focusAssistant` wiring with the ring, pulse and card row. The overseer — the R&D layer above the assistant — is pinned too: `state.overseer` playbook normalisation on garbage, `overseerDigest` telemetry (error roles, unanswered replies, stale journal jobs, AI health), the deterministic `overseerReview` (a finding that repeats becomes a lesson, `overseerMerge` dedupes lessons by text and rolls the score history), `overseerTune` clamped to the safe pref bands, the stale-session rescue plan (`staleRescues`: oldest first, capped per pass, deduped against the inbox/history/board on the title key, horizon from the policy; the digest carries the tree's stale count and oldest quiet time and the review files a stale-sessions finding), the repair-pass wiring that files the rescues as `overseer` requests and hands the staliest session to the assistant's focus, the `overseer` intent + reply, `ASSISTANT_OVERSEER_SYSTEM` / `assistantOverseerJob` / `assistant:control overseer` wiring, the Oversee buttons, and the satellite drawn above the assistant node. Node folders — every session/todo/task node acting as a folder for its own context — are pinned too: `state.nodeFolders` normalisation on junk, `applyNodeContext` append/dedupe/cap (8 entries, junk ignored), `nodeFolderLines` formatting, `clearNodeFolder`, the keeper's tidy cleaning finished nodes' folders (task gone or archived/done past the tidy clock, session gone and quiet past the checkpoint horizon, entries older than 7 days pruned, `foldersCleaned` counted in the housekeeping text), the facts carrying the focused node's folder and replies quoting it (`Folder: …`), and the wiring: the executor's run verdicts / reference gathers / chat replies / owner notes landing on folders (`assistant:node-context` IPC + `assistantNodeContext` preload), and the Command card's *Context folder* section (`appendNodeFolder`). Also covered by the behavioral board-invariant suite `tests/board.test.mjs` (`node --test tests/` from the repository root, or `npm test` there): fixtures through the pure module pin the idea-scan delta race (a stale snapshot cannot revert promotion), same-theme plan merges (membership unioned, prompt rebuilt, every idea rewired to the survivor), optional explicitly configured plan expiration relinking ideas without discarding old obligations, dangling-link repair, file-scoped Fix families, claim-sparing duplicate collapse, the `ownershipFence` settlement rule, and the housekeeping sweep (stuck claims requeue, chat requests never age out, claimed copies win title collapse), plus the AI review's task groups folding near-duplicate open tasks into plans (obligations carried in the prompt, ideas relinked, claimed members and unknown titles spared, taken themes never re-minted, capped membership, grouped plans retained by default like idea plans).  The board's SQLite store (`scripts/eyes.mjs` `enableBoardStore`/`boardMutate`) has its own behavioral suite in `tests/board_store.test.mjs`: round-trip fidelity of arbitrary row fields, ordering preservation, first-run migration from the JSON views with DB-wins afterwards, in-place mutation persisting through `boardMutate`, no-op passes writing nothing, throwing mutators rolling the whole `BEGIN IMMEDIATE` transaction back, view files refreshing on commit, the cross-process claim race (N `tests/fixtures/claim_worker.mjs` racers, one winner), and the concurrent executor smoke (`tests/fixtures/executor_slot.mjs`): more parallel-executor slots than open tasks drain the board with no double claims, every settled card in `awaiting_verification` behind the ownership fence, and a `{pid, at}` collision lease naming the claiming slot. No network, no key, no Electron; the Node half skips cleanly without Node. The Policy Lab suites (`tests/policy*.test.mjs`, same `node --test tests/` invocation / `npm test`) pin the lab's contracts: the baseline policy port matching `compareWork`'s frozen ordering (worth bands, oldest inside a band, pins by recency, the age-direction trap), bounded allowlisted config validation with content-hashed identities, operator controls a policy cannot move (pause ⇒ empty batch, locked pins always first, concurrency clamped to the offered maximum, repeated observations cannot inflate obligations), receipt trust labels (runner-observed edits are the only positive learning label; worker-named checks stay `self-reported`; partial/failed/missing evidence never positive; prompts hashed not stored; unknown cost stays null), append-only event/receipt stores with torn-tail tolerance and refused invalid events, episode trees with retry/handoff/paraphrase lineage and descendant cost rollup, whole-root-intent chronological splits that refuse a straddling duplicate, read-only prompt-free dataset export, masked replay (no outcome keys in observations, off-frontier picks flagged, UNSUPPORTED selections gain nothing and cost nothing, represented costs charged on reveal, budget-truncation reports itself censored, stopping a branch preserves outstanding obligations, two policies cannot mutate the dataset, the baseline follows the recorded picks), invariant gates hard-rejecting lock-ignoring / concurrency-bursting / obligation-losing candidates, the incumbent always present in the comparison with verified work untradeable for cost, honest empty-store reporting with no claims, byte-reproducible report artifacts, consented atomic crash-safe promotion (a crash leaves exactly one active version) with rollback changing future dispatch only, and source pins that main.cjs keeps the recorder observation-only (records are never awaited, failures swallowed, smoke/capture/CLI stay silent, receipts appended outside the housekeeping transaction, live activation disabled with dispatch frozen on the baseline). The Jev intake-classifier suites (`tests/jev.test.mjs`, same invocation) pin the decision client and builders: gateway config defaults and clamps, key resolution (env wins, then the DPAPI-encrypted `gatewayApiKeyEncrypted`; never logged, never in a tracked file), the evaluation wire (`/v4/ai/evaluation-model` with the gateway protocol/spec headers, the model id riding `ai-model-id`, id-keyed questions with choice criteria maps, `noul`→boolean mapping, state clipping, score-unmapped errors), strict question-spec and answer validation (out-of-option choices, unknown question ids, wrong answer shapes, missing answers and prose-without-JSON are errors, never guesses), classify() against a stub fetch (validated answers plus chargeable `modelCalls`/token usage, transport/HTTP/unusable-reply failures, timeout abort), `listModels`, self-contained question prompts that name both compared sides, deterministic retrieval that refuses near-zero-overlap comparisons (`retrieveCandidate`), conservative interpretation (only exact `same_obligation` attaches evidence without merging records; `adds_scope` proposes a linked follow-up; uncertainty holds for review; a claimed resolution routes to verification and is never itself evidence), `jev-proposal` experience events that validate and stay invisible to episode construction, the shadow-intake wiring pins (hooked fire-and-forget after the admission mutation, never awaited; `settings.jevShadow === false` kill switch; smoke/capture/CLI silence; two-minute interval, three-proposal cap, one-hour backoff after two failures; retrieval before the single batched call; every call charged as `jev-shadow-intake` in the improvement-budget ledger), the keystore-contract source pins, and a live half that runs only with `MEFI_JEV_LIVE_TEST=1` and `AI_GATEWAY_API_KEY` exported, and skips cleanly otherwise. |
| `tools/test_mefi_studio_normalized_path_lock.py` | Executor lock contracts for Mefi's Studio AI+ (`scripts/assistant.mjs` via a Node stdin driver, plus static pins): the spawn-loop file lock normalizes before comparing — `filesOverlap`/`sameFile` collapse forward/backward separators, drop trailing separators, fold case, match an absolute path against its repo-relative tail and a bare basename against the same basename under any folder — so two spellings of one file (the A-Eyes `test_mefi_studio_eyes.py` collision) are one claim; `claimWork` defers the second pick with reason `claimed` and advice naming the held file, a finished job releases its claim, an unrelated file proceeds, no lease file is ever written (that hung dispatch on OneDrive), the collision theme keys share the normalizer (`sameFileLabel`), and `main.cjs` consults `claimWork` before dispatch. Node half skips cleanly without Node. |
| `tools/test_mefi_studio_claim_registry.py` | npm-test discovery shim: re-exports the claim-registry contracts from `tools/test_claim_registry.py` (the A-Eyes overseer directive names that file) so the dev set runs them. That file races `./tools/x.py` against its absolute form through the real `scripts/assistant.mjs` write-lock registry — `writeClaimKey` resolves relative paths against the module root and folds separators and case into one key, two racing sessions on one path yield exactly one `refuse` with reason `claimed`, `claimWork` defers dispatch while the claim lives, `releaseWrite` frees the path only for the owner, and the refused session may then take it; static pins cover the `writeClaims` map, the registry API, the `claimWork` consultation, and `main.cjs`'s `claimWrite`/`releaseWrite` wiring. Node half skips cleanly without Node. Standalone: `python -m unittest discover -s tools -p "test_claim_registry.py"`, `python -m unittest tools.test_mefi_studio_claim_registry` (the shim falls back to a package-relative import), or run the Node driver directly. |
| `tools/test_mefi_studio_assistant_write_lock.py` | npm-test discovery shim: re-exports the write-lock serialization contracts from `tools/test_assistant_write_lock.py` (the A-Eyes overseer directive names that file) so the dev set runs them. That file proves two same-path writers serialize: both race the same file under `tools/x.py` and an upper-case backslash absolute spelling, exactly one writer is refused while the case-normalized claim map holds one entry, dispatch defers the second writer's pick until the winner releases, and the registry is empty once the handoff completes; static pins cover the `writeClaims` map key (`toLowerCase`), the `claimWork` gate, and `main.cjs` registering `entry.files` under the run id at dispatch and releasing them in `finish()`. Node half skips cleanly without Node. Standalone: `python -m unittest discover -s tools -p "test_assistant_write_lock.py"` or `python -m unittest tools.test_mefi_studio_assistant_write_lock` (the shim falls back to a package-relative import). |
| `tools/test_normalized_path_lock.mjs` | Node proof for the A-Eyes overseer directive (`node tools/test_normalized_path_lock.mjs` from the repository root; exit 0 = the lock holds; it also closes `npm test` so the proof is a named check in the standard pipeline): two concurrent claims on the same file under two spellings of its path yield exactly one rejection through the real `scripts/assistant.mjs` registry — plus release-then-retry, idempotent same-owner re-claims, `claimWork` deferring a pick whose path the registry holds, all-or-nothing multi-file claims, and foreign owners being unable to release someone else's claim. Verified 2026-09-19: 6/6 checks pass, `tools/test_claim_registry.py` 2/2, `tools/test_assistant_write_lock.py` 2/2, both `test_mefi_studio_*` shims 2/2 each. Re-verified 2026-09-19 in run_1789850103724_1 with the same results (proof exit 0, both contracts OK, no mojibake in the proof's output strings, `main.cjs` claim/release wiring confirmed at dispatch and finish). Re-verified 2026-09-19 in run_1789851482100_2: proof 6/6, contracts 2/2 + 2/2, full discovery set 202 OK; fixed both shims to also import package-style (`python -m unittest tools.test_mefi_studio_claim_registry` used to fail with `ModuleNotFoundError`) and pinned that in the shim rows above. Re-verified 2026-09-19 in run_1789854672162_6: proof 6/6, both contracts 2/2 (directive-named and package spellings), full `test_mefi_studio_*` discovery set 203 OK, `npm run check:specs` 84 specs/unique basenames/no orphans, `tests/spec_collisions.test.mjs` 4/4, and `.local-migration/` holds zero `test_*.py` copies. |


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
Live Work collapse, idle Zen entry/wake, and reduced-motion behavior are covered
by the same isolated UI fixture and focused graph tests.
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
| `tests/eyes_overlap_boundaries.test.mjs` | The Node-side eyes-contract mirror of `tools/test_mefi_studio_eyes.py`: the real `scripts/eyes.mjs` `collisions()` drives a fixture OpenCode database (built with `node:sqlite` in per-run temp dirs) to pin the temporal-overlap boundary cases — adjacent windows touching at one instant, a gap of exactly `overlapMs` inclusive vs one just past it excluded, a contained window intersecting to the inner session's span, a three-session nested group whose common intersection collapses to the innermost single instant, zero-length single-edit pairs — plus `overlapRangeOf` validation (corrupt/NaN/inverted windows normalize to null; zero-length stays real). Run alone with `node --test tests/eyes_overlap_boundaries.test.mjs`. |

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
| `tests/executor_lifecycle.test.mjs` | Exact run-marker session attribution, saved Pause at boot, stale settlement fencing, result-save retries, registry release on early exits, and replaced-child exit races. |
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
HTTP-only planning, missing keys, explicit fallback, Model Lab provenance and
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

Node layout regressions in `tests/command_graph.test.mjs` now cover hierarchy
depth in Rings, contiguous Helix branches, distinct centered Terraces, work-rim
spacing in every style and both views, newly revealed children joining fixed
parents, and worker clearance at panel edges. A dense 277px graph checks actual
Auto label painting with expanded side panels, including stable anchors and
unobstructed running-task names.

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
