# Mefi's Studio AI+

**New here?** The in-app walkthrough opens automatically on your first launch.
It explains how to choose a project folder, connect your tools, create one clear
task, follow its activity and review its result. Close it whenever you want;
it remembers your place and stays closed on later launches. Open **Start here**
to continue at any time, or follow the [first-project walkthrough](GETTING_STARTED.md).

For source installs, run `npm ci`, `npm run build-booklet`, then `npm start`
from this directory. Windows portable downloads must be extracted in full
before opening `Mefi Studio AI+.exe`.

On launch, a loading circle and progress bar prepare your projects, saved work,
model catalog, session tree, fonts and saved view before the app becomes
interactive. Progress follows completed setup steps. If something fails or
times out, choose **Try again** or **Open with available data**; clicking the
background or pressing Escape does not skip unfinished loading. Saved views,
drafts and focus are restored, and the first-run guide opens after loading.

**Preparing a GitHub download:** run `npm run check`, `npm test` and
`npm run audit`, then `npm run package:release`. This creates a fresh folder
under `dist/releases/` with only the two public catalogs in its data directory.
Zip that entire application folder before opening it. Keep your everyday
portable build separate: `npm run package` preserves that build's own data.
Neither packaging path seeds a new build with your source installation's
settings, tasks, conversations, credentials or caches. Release publishing and
code signing are separate steps; this command does not upload anything.

A personal desktop workspace for working with your assistant across projects.
Pick a project, talk an idea through, or choose **Give a task** to create real
work on its board. The companion moves between Listen, Make, and Review as
actual work changes; its narration and activity drawer show what is happening.

Assistant questions and lookups stay in the conversation. Before creating work
from chat, Studio checks the full request against existing tasks, queued requests
and current workers. Repeated requests with equivalent wording reuse that work,
including tasks awaiting verification, and do not send the helpers out again.
The reply names the existing work. Different requirements remain separate;
similar display titles alone do not combine their full briefs.

**Plan an idea** opens **Plans** for work whose route is still unclear. Give the
plan a destination and an out-of-scope boundary, collect unknowns, and turn them
into discussion, research, prototype, or prerequisite questions. Questions can
depend on earlier decisions; only unblocked questions can be resolved. Record
your own answer and supporting evidence, or use **Ask Mefi** to explore the
tradeoffs first. Assistant suggestions and discussion never resolve a question.

Once the questions and unknowns are settled, write or request a specification
with small implementation tasks, acceptance checks, and prerequisites. Review
the draft, approve it, then explicitly create its tasks. They enter the existing
queue and follow its current Pause and scheduling settings. Small, clear fixes
can still go straight through **Give a task**. Planning itself cannot launch
coding workers, provision services, or create a prototype; research sources and
prototype artifacts can be recorded as evidence for your decision.

The companion can summarize your saved plans and next open questions. Created
tasks appear in the existing Command view and work board, with a **View approved
plan** link back to their decisions. Planning AI usage is recorded in Model Lab;
questions and draft plans remain separate from runnable work counts.

Plans, discussion, decisions, and their revision history stay in each project's
ignored local `planning.json`. Changing a decision reopens affected dependent
questions and invalidates the specification approval. Changing the destination
reopens all decisions. Interrupted task creation can be retried without creating
duplicates; plans that have entered task creation are retained as an immutable
record of the approved scope. Start a new plan for subsequent scope.

AI planning runs only when requested and uses Studio's saved z.ai or OpenCode Go
HTTP connection, with local code references and optional explicitly requested
web references. It has no coding tools. A Grok-only setup needs a saved HTTP key
for these suggestions; all manual planning controls work without an AI key.

The visual path in **Plans** follows the idea through exploration, decisions,
specification, approval, building and verification. Its question map shows what
is ready to discuss, what is waiting on another answer, and what is settled.
Click a stage or question to reach its controls. Working indicators appear only
during a real planning request; after task creation, the view reads the actual
task board to show queued work, active workers, review and completion. Planning
questions remain separate from execution, and suggestions never approve work.

**Projects** keeps each folder's tasks, conversations, drafts, references, and
work logs together. Move the mouse to the left edge to reveal the Studio
sidebar from any view. There is no visible tab. Moving off the menu closes it,
including after clicking a control. It follows your selected theme and also
supports keyboard access: Tab to the edge control to open it, and use **×** or
Escape to close it without leaving the current view.

Use **+** in the sidebar to add an existing folder. Running
work must finish before changing projects; **Pause** stops new scheduling while
current jobs finish. The selected folder is captured by jobs and store writes,
so a project switch cannot redirect work into a different checkout.

**Your work** separates open work, finished attempts needing **Review**, and
verified or manually confirmed **Done** tasks. Click a card for its result,
evidence, and follow-up controls. Archived completions remain visible. Verified
direct inbox requests now become durable Done entries instead of disappearing.
An older successful worker exit alone is not proof that verification passed.

**Auto build** above **Your work** chooses how work starts. It stays on by
default, including existing installations. Turn it off for **Verify first**:
unapproved tasks wait in **Review** until you open their full brief and choose
**Approve build**. Leave a task waiting if you do not want it built. The choice
is saved across restarts for all projects, appears in the first-run guide, and
is also available as **Build mode** in Command. Approval covers the saved task
scope; changing that scope or explicitly retrying requires approval again.
Pause and prerequisites still apply, and current workers finish normally.
Result verification still runs after a build in either mode.

**Work through backlog** gives the assistant the project's existing work first.
It keeps a small buffer of up to three runnable tasks when admitting saved
ideas, taking the oldest eligible ideas first and refilling as work settles.
While this mode is on, automatic idea scans and new improvement plans wait.
Pause stops new scheduling while current workers finish. Search covers the
entire saved task or idea list; **Show more** expands the displayed page.
Use **Do next** to prioritize a ready task or **Turn into task** to admit an
idea explicitly. Raw chat notes need this explicit action (or **Keep**) before
automatic admission. Failed work stays available for review and explicit retry;
repeated attempts cannot silently reset their failure budget.

Choose **All** in **Your work** to browse tasks and ideas together. Search names
the current view and shows matching counts on every filter; if a match lives in
another view, **Search all work** finds it without retyping. **Clear** resets the
search. The sidebar also opens **Task board** and **Plans** directly.

**Ctrl K** finds tools by familiar terms such as “node tree,” “API key,” or
“color,” as well as tasks in the current project, even before opening the board.
Descriptions help distinguish results. Use the arrow keys and Enter to open a
result, or **Close** / Escape to return to where you were.

The existing task board holds prerequisites, handoff context, and task history.
It opens as an overview of **plan cards**, with progress and a **Current step**
for each goal. Saved discussions show decisions settled; execution plans show
confirmed work, current workers and verification separately. Follow-up tasks
stay beneath their original goal. Expand a card to inspect its steps, evidence
and task actions. These visual relationships do not change scheduling.
These features run in Studio using local project storage, with no additional
package, terminal, account, or hosted database. Coding still uses the configured
worker connection. A prerequisite must finish before dependent work can start;
missing prerequisites and dependency cycles need correction on the board.
Task history records changes from this version forward and preserves earlier
context when you recover a brief. Recovering a brief adds a revision without
rolling back project files or marking work complete.

Use **Make yourself at home** to set your name, companion name, accent, and
movement preference. **Node tree** in the sidebar opens the Command constellation
directly (or press **D** outside a text field; **F** rearranges and fits the tree). **Studio tools** holds the full task board,
session explorer, model booklet, value graphs, ideas, and diagnostics. API keys,
Jev, coding providers, and the optional Ruins Runner launcher live in **Settings
& connections**. Press **H** to return home or **Ctrl K** to find a tool.

**Model Lab** records model performance within the current project. It shows
observed response time, delivered tokens per second, errors, reported token
usage and USD cost, with human and model ratings kept separate. Missing usage
or billing remains unknown; subscription limits and balances are not inferred.
Task-type filters and effort breakdowns help compare similar work. The catalog
map remains available below the measured results; its request quota is capacity,
not measured speed. Measurements start with this version and cover Studio's
HTTP/Grok assistant calls and speed probes, not external coding CLI sessions.

The **Context** view previews the current task brief, grouped requirements,
unresolved obligations, prerequisites, references, evidence and recent notes
within a chosen estimated token budget. It reports excluded or shortened
sections and leaves the saved task intact. This preview does not yet replace
every worker's context assembly. Multiagent demo execution, model judging and
automatic effort escalation are planned integrations. Model selection can use
Jev to choose within your configured provider, using the catalog and Model Lab
evidence. Explicit model overrides take priority; **Fixed defaults** disables
Jev selection. Effort-selection helpers do not change the requested effort.

If Electron loses its renderer, Studio attempts two view recoveries within a
minute before offering **Reload Studio**. Saved board data stays in the host's
stores. Content-free diagnostics are kept locally in `data/renderer-health.jsonl`.
An unresponsive view cannot indefinitely block update/reload checks. Updates
wait for current builders and pending result saves, holding new dispatches
without changing the saved Pause preference.

See [FEATURE_AUDIT.md](FEATURE_AUDIT.md) for the verified scope and remaining
gaps in the capabilities described in the supplied screenshots.

**Performance profiler** is in **Studio tools**, or search “profiler” with
**Ctrl K**. Choose **Start capture**, close the panel and reproduce a slowdown.
The recording indicator reopens the panel; **Stop** freezes the capture,
**Reset** clears it, and **Export JSON** saves a report for comparing runs.
It follows the game's profiler approach: bounded frame history, nested rendering
scopes with self time, p95/worst timings and automatic hitch records. Command
frame painting, nodes, connections, labels, backdrop, layout, graph updates,
agent motion and the tree rail have named timings. Desktop captures also show
host request duration, event-loop lag and Studio process CPU/memory.
Slow asynchronous requests include waiting and are
not by themselves evidence of blocked rendering.

Capture is off by default and stays in memory until export. Hidden-window
intervals are excluded from renderer measurements; the host keeps sampling
until Stop or a renderer reload/exit. UI cadence measures browser callbacks,
not GPU time or Command's deliberately capped 30 fps drawing. The default
frame budget is 33.3 ms, with a 16.7 ms option. Frame statistics cover the last
900 intervals, scope p95 the last 180 calls, and totals cover the current
capture. CPU covers Studio processes, not external coding workers. Reports
contain static operation names and numeric measurements, without task text,
request payloads, file paths or credentials.

For repeatable performance comparisons, run `node tools/profile_studio.mjs
--output tools/logs/profile.json --capture`. It records isolated 32- and
154-node Command workloads in 2D and rotating 3D, using the same profiler.
Use `--source PATH` to compare another source snapshot. The fixture uses
software rendering and disposable state; its timings help locate expensive
work rather than predict live GPU frame rates. See `TESTRUNS.md` for the
workload settings and measured optimization results.

**Command center** puts the current worker and its reported step in **Live work**,
with readiness counts and a ranked queue underneath. Agent details and technical
logs expand when needed. Active agents move smoothly between their work and the
Assistant; finished agents return and fade away. Their positions survive status
refreshes, and role colors distinguish their work. Verification and claim recovery run before
the next dispatch, including ordinary automatic work outside backlog mode.
**Agents**, directly on the node tree toolbar, chooses how agents share the
work. It stays available when Live work is collapsed. The same choice is also
available as **Agent mode** on Home.
**Swarm** and **Cluster** both use the Assistant's planner and reviewer to help
builders complete a shared task. The planner can delegate independent parts to
two or three subtasks with their own builders. The parent waits for those
results, then resumes to combine and verify the work. Each subtask keeps its
brief, approval, progress and result on the board beneath the parent; open the
parent to follow its subtask links and confirmed progress.

**Swarm** can also work on other ready tasks across the queue. **Cluster** keeps
agents on one shared task and its required subtasks through verification before
moving to another goal. Independent subtasks can build together within the saved
machine-managed or manual parallel limit. Use **Work on it** to prioritize a
task before the next focus is chosen. A task needing review keeps the focus
until resolved or you switch modes.

The **New work** toggle in Command's Assistant panel turns scheduling on or off.
Turning it on resumes the assistant and enables coding workers; turning it off
stops new starts while current workers finish. The setting survives restarts.
**Work on it** keeps that setting in effect and explains when it is off. The task
stays prioritized; a dispatch request alone does not confirm a worker has started.
The conversation confirms **Started** when the worker process launches. Repeating
**Work on it** follows an existing builder or reuses its saved task, with separate
messages for preparation, building and verification. Builder names connection
failures and a full manual worker limit when another start has to wait.

The mode is saved across restarts; existing installations start in Swarm.
Switching to Cluster lets current workers finish. Pause, build approvals,
prerequisites, file claims and machine checks apply in either mode. **Verify
first** requires approval for each delegated subtask. Both modes' planner and
reviewer use the saved z.ai or OpenCode Go HTTP connection and the Assistant's
agent/AI limits; their planning advice does not count as completed tests.
If that connection is unavailable, Live work shows the skipped assistance and
the configured builder can continue. Findings are included in the worker brief
and saved with its attempt; they never approve or complete work by themselves.

**Parallel builds** defaults to **Machine managed**, including existing
installations with a saved worker limit. The machine agent admits independent,
eligible coding work while Studio remains responsive, without a fixed worker
count. It staggers starts and rechecks actual app lag as work grows. When Studio
becomes laggy, new starts wait and resume automatically when responsiveness
recovers; current workers continue. High CPU usage alone does not limit builds.
**Work on it** prioritizes
the selected task and asks for dispatch immediately. Pause, required approvals,
prerequisites and overlapping file claims still hold work when necessary.
Choose **Manual: 1 worker**, **2 workers** or **3 workers** to opt into a fixed
limit; your saved manual limit is retained when switching to Machine managed.
The separate assistant agent and AI
limits remain available on the Assistant's detail card. Studio worker processes
disable OpenCode's shared filesystem snapshots to avoid concurrent snapshot
index locks; their tool-change evidence, conversations and Studio task history
remain available. OpenCode filesystem undo is unavailable for those worker runs.

**Follow** frames the active task with its current step. It follows meaningful
activity and moves between parallel jobs after a short dwell, then leaves a
finished task for the next active one. Panning, zooming or selecting something
manually takes control; choose Follow again to resume. A quiet board holds its
last view, and reduced motion disables timed cycling between workers.
**Auto labels** shows at most four to eight labels, depending on the available
graph area, in Orbit, Free and Follow. Current work and inspected nodes take
priority. Hover, selection and search reveal details; **All** keeps the expanded
label option. The glowing orb style remains, with softer halos and distinct agent
colors. Running work uses the theme accent; attempts awaiting verification use
a quieter blue rim. Their compact labels put status above the task title, so
the useful name has more room. On wider trees, work titles wrap to two lines
before shortening, and names use nearby gaps around their own nodes.
Checkpoint notes use small outlined marks with
larger click targets. Constellation groups related work around a centered hub,
and collapsed panel headers retain clear space above the graph.
The overview starts still: task and session anchors stay fixed during status
updates, while active agents can travel between them. When a task changes its
parent, its branch automatically moves with it, including expanded plan members.
Agents connect to their current host as they work or return to the Assistant.
Large Constellation and Rings branches keep their children beside their session
instead of wrapping them around the opposite side of the tree.
**Space** toggles rotation;
**Fit** or **F** rebuilds the node arrangement and frames the whole tree. It
restores a readable 3D angle, ends a current drag or Follow camera, and places
workers beside their tasks again. The chosen 2D/3D view, layout, appearance,
task relationships and Orbit preference stay the same; rotation briefly
settles so the repaired layout can be read. **Shift F** still focuses the
selected branch. These managed positions last for the current view session;
a reload starts a fresh layout, and resizing can adjust its spacing.

Click the **Live work** heading to collapse or expand the panel. **Zen mode** in
Command's **Ambience** menu is off by default and remembers your choice across
restarts. Turn it on to fade the panels and gently orbit the tree after 30 seconds
without input in Command.
Move the mouse, scroll, touch, or press a key to bring the controls back. Open menus,
text entry and dragging keep Zen from interrupting an interaction. Reduced motion
keeps the quiet view still; this does not enable Zen audio or microphone capture.
The overview keeps node surfaces inside the space left by visible panels,
including task details, throughout a full 3D orbit. Faded Zen panels release
their space; waking restores the panel boundaries. Taking manual camera control
continues from the fitted view without a jump.

**Music & themes** separates the Studio color theme from the node tree's
appearance and arrangement. Pick **Classic orbs**, **Soft glass**, **Minimal**,
**Halo**, or **Crystal** for the nodes. Arrange them as **Constellation**,
**Branches**, **Rings**, **Helix**, or **Terraces**.
These choices are remembered. Changing style keeps the current arrangement;
choosing another layout explicitly rearranges the tree. Branches groups children
under centered parents in spaced rows, with quieter secondary connections.
Constellation and Rings spread loose tasks among the session branches around
the hub. Large branches use compact sectors and the viewport's wider dimension
so quiet sessions cannot leave all current work crowded against one edge. Rings follows
dependency depth in branch sectors, Helix keeps each branch together, and
Terraces uses centered shelves with sibling columns. Narrow views leave clear
space for active task labels. Worker satellites stay clear of task nodes and
panel edges, and newly revealed children join their parent's existing position.
Every layout has a flat 2D view and a real 3D volume: orbiting reveals depth
between branches, rings or tiers while their world positions remain fixed.
Constellation and Rings use gradual depth changes between nearby nodes and
distinct front and back tiers, with extra spacing in wider 3D views. Fit
rebuilds that curved volume so the tree retains depth when you rotate it.
Saved task groups can be expanded to inspect their members. Running and
verifying children stay visible even when the group is collapsed; saved member
briefs and history remain available without creating another runnable task.
**Blue orbit trails** brings back the circling blue accents on queued/running
work, and **Extra glow** adds brighter halos and luminous cores. These effects
are saved separately and animate around fixed anchors; reduced motion keeps
the trails still.
The settings open beside the live tree so changes can be seen immediately.
Switch between **2D** and **3D** beside the preview; **Fit** rearranges the nodes
and brings the whole tree back into view after panning, zooming or rotating.
Changing an already selected view
keeps the camera in place, and preview controls do not stack notifications.
Closing the settings returns to the previous view and camera framing.

Open **Music & themes** from the sidebar, Command dock, or the tree's music node.
Add local audio files to a queue with play/pause, previous/next, seeking and volume.
The queue lasts for the current app session; choose the files again after restart.
Local playback needs no account. The **Spotify** tab accepts song, album and
playlist links and remembers six recent links for switching. It uses Spotify's
official embedded player; Spotify controls available playback, previews and sign-in.
AI music suggestions use Studio's configured AI provider only when requested;
suggestions offer Spotify searches and cannot create tasks or control agents.

Choose **Studio gold**, **Midnight**, **Forest**, **Violet**, **Ember**, **Aurora**,
or **Rose** to recolor Studio and the node tree. **Custom palette** saves your
own accent, background, panel and text colors through color pickers or hex
inputs. Derived text colors keep controls and graph labels readable against
their own surfaces. The tree's music toggle follows local tracks directly.
**Audio link** in Music & themes connects sound to the live node tree. **Auto**
follows a loaded local track; **Local player**, **Desktop audio / Spotify**, and
**Microphone** let you choose a specific source. Desktop stays selected even
when local tracks are queued. Capture starts only after an explicit control
gesture; changing to Spotify or removing a track asks you to reconnect when
desktop capture is needed. The connection status shows paused tracks and errors.
Use **Response** to adjust the strength from 0% to 200%, independently of volume.
The default is a gentle 35%, with smaller waves and slower movement. Previous
response settings are reduced once when moving to these calmer controls.
**Connection waves** and **Node glow** switch independently. **Drum accents**
and **Background glow** start off and can be enabled separately.
**Separate frequency lines** starts on: each connection keeps its own bass,
midrange or treble assignment as the graph updates. A bass note animates its
assigned lines without pulsing all the other connections. Turn this option off
to let each line follow the full mix. These choices are remembered.
The response adapts to quiet and loud signals across bass, mids and treble.
Sustained bass rolls along the connections; low drum attacks, midrange hits and
high percussion drive different ripples. The live waveform shapes the inside of
each node and, with frequency splitting off, traces the connections too. A
visible audio cable joins the music
node to the hub while linked. The visual reactions follow frequency and attack
patterns. Silence and pause let the waves settle; node anchors, labels and task
relationships stay in place. Reduced motion keeps the effects still.

Project state stays under the application's ignored `data/projects/` folders;
the original project's existing files stay in place. Source and portable builds
retain their separate existing data stores. This update does not merge them or
invent completion records for old runs with no verification evidence.

```text
Mefi's Studio AI+/
  package.json          electron@44.4.1 (pinned), scripts: start/start:web/data/build-booklet/capture/check
  main.cjs              Electron main: window, catalog IPC, LÖVE launcher, speed probe, A-Eyes IPC + 1.5s poll
  preload.cjs           contextBridge surface (mefiStudio.*, eyes*)
  renderer/
    booklet.template.html   source template (__BOOKLET_DATA__ / __BOOKLET_STYLES__ / __BOOKLET_CODE__)
    booklet.html            built, committed, self-contained booklet
    styles.css              Club Blackout theme tokens + glass components
    nav.js                  MefiNav: the destination registry behind the tabs row, dock, palette, help and every key
    booklet.js              cards, filters, refresh-on-open, tabs, help sheet, studio panel
    graph.js                value map, task-fit heatmap, pools, recommendation engine
    eyes.js                 A-Eyes: change feed, diffs, PNG pins, log tail, inspector
    workspace.js            project home, companion conversation, explicit tasks, review and completion results
    boot.js                 startup readiness/progress gate and shared visibility-aware polling
    tree3d.js               3D task-tree rail (starfield, green activity lights, pulses)
  scripts/
    refresh-models.mjs      live roster + models.dev + curated -> data/models.json
    build-booklet.mjs       template + styles + scripts + catalog -> renderer/booklet.html
    eyes.mjs                read-only OpenCode store reader (sessions, todos, edits, activity, PNGs, log, pins)
    assistant.mjs           always-on assistant rules: organise the tree, tidy, intents, local replies (pure, tested)
    serve.mjs               dependency-free static server for browser-only use
    updater.mjs             live update: watch the source tree, validate, rebuild, reload or relaunch
    measure-speed.mjs       optional real tokens/s probe (OpenCode Go or z.ai key, by model id)
  data/
    curated.json            source of truth overrides: docs pricing/limits/privacy, quality, verdicts
    models.json             the catalog: committed, regenerated by refresh-models.mjs (offline mode and tests read it)
    eyes-pins.json          A-Eyes image annotations; gitignored
    eyes-assistant.json     assistant service state: thread, log, fixes, organisation; gitignored
```

## Run it

```powershell
cd "Mefi's Studio AI+"   # this repository's root
npm install            # once; downloads Electron (~110 MB)
npm start              # desktop app
npm run start:web      # browser-only fallback: http://localhost:4173
npm run capture        # screenshot tour -> tools/logs/mefi_studio_captures/
```

`npm start` needs a normal shell: if `ELECTRON_RUN_AS_NODE` is set (some agent
harnesses set it), main.cjs refuses to start with the fix printed.

On Windows, double-click `Run Mefi's Studio AI+.cmd`. It starts the portable
build when available, otherwise the development install. Run `npm run package`
to refresh `dist/Mefi Studio AI+/Mefi Studio AI+.exe` while preserving that
build's existing local data. Code-only rebuilds reuse identical Electron
runtime files, so an open app does not block packaging on locked DLLs.

This is an independent repository. Studio uses its own root as the default
working repository; set `MEFI_STUDIO_REPO` to monitor or work in another checkout.
The optional Ruins Runner integration uses `MEFI_STUDIO_GAME_ROOT`, or the
sibling `2d Trippy Hell` folder when present. A fresh clone works without the game.
Local tasks, conversations, settings, databases, captures and build output stay
on your computer; Git tracks only `data/curated.json` and `data/models.json` from
the data directory.

## Refresh the catalog

```powershell
npm run data           # live roster + models.dev + curated.json
npm run data:offline   # rebuild from the committed snapshot
npm run build-booklet  # re-inject the catalog into renderer/booklet.html
```

The booklet refreshes itself on open: baked data paints first, then
`data/models.json` is fetched with `cache: "no-store"`. If the hash changed the
UI re-renders; if the schema changed the page reloads once. Window focus
re-checks after six stale hours. Missing quality benchmarks stay `—`; the
catalog never guesses.

Catalog searches reuse formatted cards and preserve expanded details when the
results are unchanged. Settings loads its connection and installed-tool checks
when first opened. Catalog refresh fetches its independent sources concurrently,
shares overlapping requests, and retains the last complete file until its
replacement is ready. Offline or failed metadata refreshes preserve known
prices and capabilities. Model Lab reuses unchanged local measurements while
checking for new calls, ratings and file changes on each read; opening it does
not run paid measurements. Speed probes run one at a time from Settings and
update the displayed measurements when complete.

## A-Eyes

A-Eyes reads the live OpenCode session store **read-only** (`node:sqlite`):
change feed of model edits/writes/patch sets with +/-, agent and time-window
filters, per-session totals (changes/files/lines/cost), unified diffs, newest
PNG evidence from `tools/logs/` with click-to-pin annotations (plus file
picker and drag-drop), an OpenCode log tail that refreshes while visible, and
Reveal/Copy actions for the selected file. The global task-tree rail shows
sessions → subagents → todos as a 3D starfield: completed tasks light green,
in-progress tasks pulse gold, pulses travel the edges on live activity, and
clicking a node filters the feed to that session **and points the assistant at
it** — a gold ring marks the focus, clicking the focused node again clears it —
while double-clicking opens it in the session explorer. The rail collapses to a
slim strip, expands on hover,
remembers its pinned state, and can be pinned with `G`.
The capture tour also records a print-media preview of the booklet.

### Session explorer (`E`)

The rail expands into a full explorer: the tree with status dots and
checkpoint message bubbles, session detail with tasks/recent changes, the
Assistant column (the always-on thread and its controls, Brief me, Improve,
Grow, Proactive), collateral watch, the local Auditor, and the request inbox. Its header carries
links to the other tools (Tasks, Ideas with their unread count, Overhead,
Analyzer) — opening one *replaces* this sheet, because only one sheet is ever
on screen. The session detail can hand the session on: **Filter A-Eyes feed**
and **Open in Command**. Checkpoints are timestamped chips — drag one into the
request box to reference it, or use its four actions: **Reference** copies it
as chat context, **Explore** reviews progress/remaining/done, **Restore**
reloads the visual state captured with it, **Expand** drafts follow-up work.

### Assistant

A-Eyes' assistant prefers your **z.ai GLM Coding Plan**. With **Jev — task fit,
speed & cost** model selection and a gateway key, Jev picks an available model
within that provider for each task. Without Jev, routine passes (briefings,
chat replies, checkpoint reviews) use **GLM 5.3 Flash**, and heavy passes (the
playbook improver, overseer and analyzer's AI read) use **GLM 5.3**. With no
z.ai key saved, Auto uses OpenCode Go, whose usual default is **DeepSeek V4.1
Flash**. Provider choice and the explicit fallback setting still determine
which account pays. Proactive
mode is remembered across restarts: with it on, the always-on service (next
section) adds an AI brief every five minutes, where collisions, auditor
findings and machine state become inbox requests and briefing facts. The
Auditor (third agent) also runs keyless: it checks that
every renderer script is bundled, every preload channel has a main handler,
every DOM lookup exists in the template, and every studio test is registered.

Each key has its own field in the OS keystore (`safeStorage`, DPAPI on
Windows): OpenCode Go in `apiKeyEncrypted`, z.ai in `zaiApiKeyEncrypted`.
Headless setup is `MEFI_STUDIO_KEY=... electron . --set-key` and
`MEFI_STUDIO_ZAI_KEY=... electron . --set-zai-key`. The **AI routing** row in
the Studio tab picks who pays — *Auto* (prefer z.ai, OpenCode only when it is
the only key), *z.ai only* (never bill OpenCode; a missing key is an error,
not a fallback), *OpenCode Go only* or *Grok CLI* (the assistant answers
through the installed `grok` CLI on its own login — no key field involved) —
plus an opt-in **OpenCode fallback on z.ai failure** toggle that is off by
default. **Model selection** defaults to Jev and can be changed to **Fixed
defaults**. Jev evaluates task fit using the catalog's quality and estimated
prices alongside the current project's measured timing, errors, human/model
ratings and reported cost. Unknown speed, quality or cost stays unknown;
catalog estimates are distinct from billed cost and do not establish z.ai
subscription charges or CLI-worker performance. Selection uses a small billed
gateway evaluation request. Without a gateway key, on timeout, or on an
unusable result, Studio uses the usual provider default. **Refresh selection**
shows the latest chosen model, task type and reason without starting a model
request.

Two **model override fields** accept routine and heavy model ids. A nonempty
override takes priority over Jev; clearing it restores the selected mode. Grok
uses an explicit model with `-m` or its CLI default. OpenCode requests carry a
stable `x-opencode-session` id (z.ai calls never see it), and the assistant
verifies itself with
`electron . --assistant-brief | --assistant-improve | --assistant-grow |
--assistant-audit | --assistant-proactive | --assistant-all`.

The same routing governs the autopilot's build jobs, and **who runs them is a
choice too**: *Builders run on* picks `opencode run` (the default, with the
Studio-managed `mefi-zai` provider injected per process when a z.ai key is
saved — `OPENCODE_CONFIG_CONTENT` + `MEFI_ZAI_API_KEY`, the key never written
to OpenCode's auth store — using Jev's selected z.ai model or the usual
`mefi-zai/glm-5.3-flash` default) or the **Grok
CLI**, which takes the same prompt and the same done-sentinel protocol on its
own login (positional prompt, tools auto-approved, a turn cap so a wedged run
cannot outlive the kill timer), with an optional **Grok builder model** id passed
as `-m`. Grok is never a single point of failure: with builders on grok, a
missing CLI resolves straight to the opencode route, and a grok run that dies
before saying anything — a spawn failure, a wedged start, a silent nonzero
exit — retries the same job on the same claim through opencode once (the
mefi-zai provider when a z.ai key is saved), with the fallback named on the
feed and in the work log; a grok run that talked and then failed is the job's
own failure, not the CLI's. The same rule holds for the assistant itself: a
grok answer that fails or times out falls back once to the keyed HTTP routes
— z.ai by preference, OpenCode Go by the auto rules, never back to grok. The
Studio tab's **Coding CLIs** row detects the installed `opencode`,
`grok`, `codex` and `claude` (`where.exe`), opens each in its own terminal on
its own account — OpenCode gets the same `mefi-zai` provider when a key is
saved — and **Test z.ai link** verifies the provider resolves without
spending a single credit.

### Always-on assistant

The assistant can always be messaged and is always working. Its **service
loop** lives in the main process and ticks every 30 seconds (every two minutes
while the window is hidden), whether or not any surface is open. A tick: heartbeat, read
the session store, **organise** the node tree, scan the machine, run the
Auditor (every five minutes), a **fix pass** — rewrite a missing
`data/models.json` from the snapshot, quarantine an unparseable
`data/eyes-*.json` as `*.broken-<epoch>.json` and rewrite its fallback, flag a
held live update — a **tidy pass** every ten minutes (tasks done for 24 h are
archived and retained in Done, ideas retained until explicitly removed, audit and collision
requests whose finding is gone dropped along with auto-sourced requests older
than three days, duplicates merged; unimplemented ideas, board history, and manual requests are never
touched), and, with Proactive on and a key saved, an AI brief that backs off
5 → 10 → 20 → 40 → 60 minutes while the model is unreachable. Every step is
guarded on its own: one failure is logged and the tick carries on.

**Messaging.** The Explorer's Assistant column, the Command rail's chat
console and the **chat log docked on the Command view's right edge** carry the
same thread — the dock mirrors every ask and reply next to the node card, so
the assistant's side of the work stays on screen (it collapses to a slim
header when the canvas is wanted). All of them behave like a chatbot: a
multiline composer that grows as you type (`Enter` sends, `Shift+Enter` makes
a new
line), quick-ask chips for *Status* / *What next?* / *Log* / *Help*, and a thinking
 bubble that summarizes the agent's activity — it reads the activity log,
says what it is considering, and a reply always comes back, from
your routed model (z.ai GLM by default, or the Grok CLI) when a route is
saved and the model answers, otherwise a
local reply grounded in the same facts. It talks, too: small talk and "how
are you" get a human answer with the lay of the land, and follow-ups like
"yes", "work on it" or "the second one" resolve against the last reply and
the current focus instead of starting over. Adding a task **is** messaging
the assistant: the Command view's *Add a task* composer and the board's own
box both hand the text to the thread, where it becomes a board task at chat
worth — above every auto-filed request — and kicks the executor on the spot.
Asking about the Auto Builder ("what is the builder doing", "clean up the
builder") reads the feed back in words — what is building, what is queued,
why dispatch is held, what the log says — and a cleaning ask ends in a
compactor pass. "Read the log" quotes the assistant's own activity tail
(and the builder feed) instead of guessing. And it does not guess work:
a message that names nothing to do — bare verb chatter like "test test" or
"do it for me" — gets a yes/no offer quoting the text instead of an
automatic queue, so talking never starts a job by accident (new tasks still
belong in the board's own composer). Plain words work without AI:
status, tasks, ideas, collisions, machine, agents, tidy, fix, organise,
pause, resume, help — and "what should I work on" answers with ranked picks
drawn from collisions, audit errors, the request inbox, the board and quiet
sessions, so a suggestion is always one message away. A greeting gets the
lay of the land plus the top pick, and every reply sees the request inbox
and what the executor is building — the assistant never answers blind. An
instruction ("add…", "fix…", "check…") stays in the thread, is queued to
the request inbox, and sends the roster out — watcher, machine, auditor,
keeper, briefer, improver, grower, ideas and reference all take a pass in
parallel (a role that ran inside the last minute is counted fresh and
skipped). **Tidy now**, **Fix now** and **Pause/Resume** sit under the
composer with the last eight log lines and the housekeeping line; the
palette has *Message the assistant*, *Tidy up now*, *Fix problems now* and
*Pause/Resume assistant*.

**Focus.** Clicking a session or todo in the rail — or selecting a session, todo
or task in the Command constellation — hands that node to the assistant as its
**focus**: a thin gold ring on the node, a `focused on …` sublabel on the
assistant, and `on "…"` on the Explorer's service line. The focus grounds the
next message: when the text names nothing else the responder walks to the
focused node, a queued request claims it, and the composer placeholders offer
`Work on "…"` — a rail click also stages that draft into an open assistant
composer. Clicking the focused node again unfocuses it.

**Work on it.** The card's *Work on it* button makes that node the
assistant's **next** piece of work — no chat round-trip: the node is focused,
a board task is pinned to the front of the board (a session or todo queues as
a pinned request carrying the node as its target), the ask lands in the
thread, and the foreman runs at demand priority so a free slot starts it on
the spot. A pin is one-shot — the run it asked for clears it — and while the
work waits, then builds, the node wears a **blue circle with a comet trail
looping it** (slow while queued, quick once the executor holds it; the
legend calls it *work on it*).

**Node folders.** Every session, todo and task node acts as a folder for its
own context: an executor run's verdict, what a reference gather found on a
task, the exchanges the chat settled on a node, and anything you pin there
yourself from the node card's **Context folder** row (`assistant:node-context`
IPC). Entries are typed Recall-style cells (`dec` / `obs` / `bel` / `rsk` /
`ver`): a later write with the same title *supersedes* the older one instead of
leaving two competing facts, and a compile pass **pushes** a mini-index of the
relevant cells into every chat reply and every executor prompt (`Memory: …`,
with `Dig:` when a flagged fact was overruled) — the agent does not have to
remember to search. The agent loop writes it as the work happens; the responder
reads the focused node's folder when it answers (`Folder: …` in the reply), and
the keeper's tidy pass cleans a folder out with the rest of the housekeeping once
its node is done — the task archived or gone from the board, the session left
the store — with old entries expiring after a week either way.

**On the node tree.** The assistant is a node of its own above the root:
champagne gold, its ring breathing while the service runs, grey when paused,
amber when something needs attention, and every tick, tidy, fix and reply is a
pulse along its edge. The organisation keeps the tree clean: sessions updated
in the last 15 minutes (or with work in progress) come first, then working
ones, then **stale** ones (pending todos, untouched for a day — dimmed, todos
hidden); finished sessions untouched for an hour fold into one **N finished**
node (the Explorer lists them under *Finished (n)*); at most eight roots. Fold
and stale changes reach the rail and the Command view the moment the tick
makes them. In the Command view the **assistant** pill top-left shows its
state, `M` selects the assistant node and focuses its composer, `←` `→` walk
through it like a session, and its card holds the status rows, the thread, the
activity and the Tidy / Fix / Pause actions; the *Finished* node's card lists
the folded titles. The node is there even when the OpenCode store is offline.

**Agents.** The work runs as concurrent agents, one per role, through a pool
in the main process: **watcher** (store facts, organise, every tick),
**machine** (every two minutes), **auditor** (audit plus the fix pass, every
five), **keeper** (tidy, every ten or on demand), **thinker** (every two
minutes with Proactive on — reads the activity log, thinks in the assistant
box, and kicks the foreman when the board is idle and a real pick is waiting),
**briefer** (the AI brief,
every five with Proactive and a key), **responder** (one job per message, top
priority, so a reply never waits for a tick) and the on-demand **improver**,
**grower**, **ideas** and **reference**. Cadence roles are singletons; replies
have a separate lane of at most two jobs, capped by the AI width, and the
foreman and Machine each have an independent slot. Queue aging prevents steady replies from
starving maintenance. A job that takes more than 150 s reports a timeout but
keeps its slot and saved journal until its underlying operation settles. New
work for that role waits; unrelated roles can continue. A permanently stuck
operation needs an app restart. This is ownership retention, not cancellation.
*Parallel
agents* (1–12) and *AI in parallel* (1–6) set the background pool's width from the
assistant card or `assistantPrefs`. *Parallel builds* uses Machine managed
admission based on app responsiveness by default, with optional manual limits
of one to three workers —
each in-flight job claims its work in the store (requests flip to
`running`, tasks to `active`) under a lock that re-reads first, so two
slots cannot execute the same title, then re-checks the machine lease
before the child starts so an exclusive holder that arrived mid-claim
wins. Each slot takes the highest-worth pick across the inbox and the
board, and a claim whose job died is re-queued by housekeeping instead
of stranding. The **compactor** reviews the
backlog every seven minutes and after every finished job: duplicate and
already-on-the-board requests collapse, auto-filed requests expire after
twelve hours unclaimed (the filing pass re-files them while the problem
lasts; chat and manual asks never expire), the cap cuts the lowest-worth
entries rather than the oldest, and the feed names the pick the executor
would take next. Requests worth keeping are promoted onto the task board
the same way — worth first, never one a live run already holds. Failure is per job: a task that exits nonzero cools down on a
doubling backoff (10m → 2h, five tries before it sits out — reopen it to
re-arm) while the pool keeps running; the only pause left is three
straight runs where `opencode` itself never started, and even that park is
a ~10-minute cooldown that re-arms on its own — the feed names the failing
output line and the retry time. The feed counts every
in-flight job, and the Command view rings each job's session gold. On the node tree every agent is a small
satellite around the assistant node — role-coloured running and idle, green
when its last job is done, dim slate queued, amber on error, its line to the
assistant surging each time
one starts or finishes — hover for `role · status · what it is doing`. An
agent with a target goes there: it flies to the node it works on (a session, a
task, the folded cluster, the root), hovers above it on a dashed gold tether
with surges and sparks running down the line, hops between several targets,
and flies home when the job ends with one bright surge back to the assistant — on
the rail and in the Command view alike, where its label reads
`role · target`. With motion off it snaps instead of flying. Nodes with a
known fraction wear a slim **work-left meter** just below them — sessions by
their todos, agents by their own progress, and the assistant by the whole
board — the empty track is the work still to do, a full green bar says none
of it is. Every
finished job also **reports home**: its one-line finding (sessions, collisions,
audit errors, queue shape, what was handed out) lands on the assistant's intel
board and flies back as a gold packet — a diamond riding the pulse — and the
assistant card keeps a **Reported** list of the latest finding per agent, so
the loop reads on screen: the scouts explore, the reports come home, and the
**foreman** (the one main agent they all answer to) plans from those findings
and sends the builders out — its log line names what it handed out and the
findings the dispatch rode on. "Agents" in the thread repeats the latest
reports. The assistant card and the Explorer column list the roster with each agent's
status, last run and line; the Command pill reads `assistant · 3 working`
while agents run. The **watcher's** report is the richest: active sessions
by name, what is mid-flight, which files are being double-touched — the
board the assistant plans from. And the loop never idles: when nothing is
runnable and no job is building, the foreman wakes the **compactor** (which
folds loose ideas into plans and re-asks when a plan is runnable) and, when
its last scan has gone cold, the **ideas** agent — so a dry board grows work
instead of waiting. The executor checks main-process and visible-renderer lag
before each start and again after claiming its task. New starts are spaced
three seconds apart so the next admission reflects the added work. Legacy
saved widths are retained for
manual mode; an explicit manual mode choice survives restart. Every spawn
still yields to an exclusive test lease.

**Board integrity.** Every writer of requests, tasks and ideas — queue
filings, promotion, chat tasks, the compactor, the keeper, housekeeping,
repairs, pins, the idea scan — goes through one **board gateway**: a lock
that re-reads all three stores, applies the change, and writes only what
moved. The live project host currently uses local JSON stores, with serialized
mutations and each file written through a temporary file and rename. This
protects individual files and concurrent jobs in the host, but is not one
atomic transaction spanning all three files or independent processes.
An optional SQLite board store and its transaction tests exist in
`scripts/eyes.mjs`; it is not enabled by `getEyes()` in the live project host.
Studio does not migrate the existing board just by opening a project. The
**JSON views are this repo app's authoritative board** (the recorded store-fork
decision in `main.cjs`): the home `~/.local/share/mefi-studio/board.db` is a
known stale fork (38 tasks/151 already-drained ideas versus the views' live
43/22), so a **stale-fork guard** in `scripts/eyes.mjs` degrades any
board-store-enabled process that meets view rows the database has never seen
loudly back to plain-file mode instead of exporting the stale database over
fresher views. Turning the store on is therefore always an explicit fresh
migration: archive the stale `board.db`, then call
`eyes.enableBoardStore(eyes.defaultBoardConfig(STUDIO_ROOT))` — the guard then
imports the current views wholesale, the cutover
`tests/board_store.test.mjs` covers end-to-end.
Nothing holds a mutable store across an AI call
any more: the idea scan collects additions first and applies them as a
validated delta against the latest store afterwards, so a slow model can no
longer resurrect promoted work. Settlement is **fenced**: a run closes or
fails a record only while the board still names its run id as the owner, and
the in-flight job is released only after the store write — a re-queue that
lands in the same instant wins. "The run said done" is not "done": a
finished task settles to `awaiting_verification` with the attempt's
evidence attached (sentinel, exit code, spawned session), and housekeeping
verifies it after a short dwell. Claimed checks require recorded successful
execution in that attempt's session and time window. Failed or pending checks
block completion; unavailable evidence waits without consuming a retry. An
edit-only attempt can pass on attributable completed edits, so this still does
not independently certify every acceptance criterion. Tracked delegated work
gets durable child cards; parents wait until those exact children finish, and
exhausted children hold their parents for review while unrelated work proceeds.
Automatic grower, improver and Overseer suggestions wait when the board and
inbox already contain three unresolved obligations, including work awaiting
review. Repair, verification and explicit requests continue. Discovery receives
the existing backlog and may correctly suggest no new work. Admission rechecks
capacity under the board lock, and exact repeated suggestions are matched
against saved tasks and group members.

Compaction preserves intent while collapsing representations:
same-theme plans merge into one task whose membership is unioned, whose
prompt is rebuilt from the surviving obligation set, and whose ideas are
rewired to the survivor; an expired plan's ideas go back to visible `new`
with the dead plan id kept as provenance and a two-fold-attempt cap so the
same theme cannot be re-minted forever; `Fix:` families are scoped to the
files they name, so two dupes about different files are different jobs; two
live claims of one title are both kept. Fix-family themes, plan themes and
title keys are one shared identity (`compactKey` / `planThemeKey` /
`fixThemeKey` in the pure module), used identically by promotion, the
compactor, housekeeping and the executor's live guards. The behavioral
invariants live in `tests/board.test.mjs` (`npm test`), and
`node scripts/reconcile-board.mjs` runs the same rules offline over the data
files to repair a backlog left inconsistent by an older build. The repo board
and the packaged app's own board (`dist/Mefi Studio AI+/resources/app/data`)
are two deliberate stores, never merged away;
`node scripts/reconcile-store-fork.mjs` (`--dry-run` to preview) syncs the
missing slice between them through the app's own helpers — idea identity,
admission rule and drained task rows copied additively, existing rows and the
home `board.db` fork untouched.

For an explicitly reviewed consolidation while Studio is closed, use
`node scripts/group-board.mjs --data=<directory> --groups=<json-file>` to
preview it, then append `--apply`. The manifest lists each group's `title`,
exact task titles in `tasks`, and optional corresponding `taskIds`. This
operation only groups the supplied work, backs up the original local stores,
and records task history. Full requirements, acceptance checks, references and
file scope survive in the grouped brief and original member records. Active,
dependent, approved, failed or cooling tasks are protected from regrouping.

**The Policy Lab.** Beside the execution loop sits an experiment loop that
learns from measured history instead of adding more tasks. It is
**observation-only in the live app**: the executor's ranking was extracted
behind a frozen *baseline policy* (`scripts/policy.mjs`, a line-for-line port
of `compareWork` with the inline copy as the load-failure fallback — enabling
any of it changes no selected work), and every dispatch now appends what the
policy saw, what was claimed, what the run reported and what verification
observed to an append-only store under `data/policy-lab/` that no compactor,
tidy or housekeeping pass may prune. Verification emits **runner-produced
receipts** (`scripts/receipts.mjs`): the housekeeping pass records what *it*
observed — session-attributed edits, outstanding obligations, the evaluator's
own version hash. A receipt is `trusted` only on runner-observed evidence; a
worker's prose naming its checks settles the card but is `self-reported` and
is never a positive label for learning. Unknown telemetry stays `null`, never
zero. Offline, `npm run policy-lab` replays bounded candidate configurations
against the recorded episodes (`scripts/replay.mjs`): observations are masked
to the revealed frontier — no future outcomes, no invented results
(`UNSUPPORTED` for anything unrecorded), represented costs charged on reveal,
obligations preserved when a branch stops. Candidates pass hard gates
(operator locks, concurrency limits, no false verification, no lost
obligations), are compared with the always-present incumbent on a held-out
split of whole root intents (paraphrases share the compact key, so they cannot
leak across the split), and the run writes a reproducible report artifact that
states its own boundaries. **No live dispatch changes are made**: promotion is
a separate, operator-consented, atomic pointer write that stays disabled until
controlled activation ships. The lab's own module set is
`scripts/policy.mjs` / `receipts.mjs` / `experience.mjs` / `replay.mjs` /
`policy-gates.mjs` / `policy-lab.mjs`, pinned by
`tests/policy*.test.mjs`; `node scripts/policy-lab.mjs --fixture
tests/fixtures/policy-demo` regenerates the demo report over a committed
fixture dataset.

**The Jev intake classifier.** A constrained classifier (TypeSafe's Jev over
the AI Gateway) sits at the lab's admission edge: it answers fixed questions
about incoming material — what kind of agent message this is, and whether an
observation is the same obligation, an added scope, or unrelated work — while
the runtime keeps every state change. `scripts/decision-client.mjs` resolves
the gateway key (`AI_GATEWAY_API_KEY`, or the Studio's DPAPI-encrypted
`gatewayApiKeyEncrypted` set with `electron . --set-gateway-key`), and rides
the gateway's **evaluation API** (`/v4/ai/evaluation-model` — Jev is an
evaluation model; chat/completions is refused for it) with zero runtime
dependencies: questions go out id-keyed with criteria maps, `noul` maps to
boolean probabilities, and every answer is validated against its question
spec — an out-of-contract reply is an error, never a guess. Token usage
comes back chargeable to the improvement budget.
`scripts/work-classification.mjs` builds the questions and maps answers onto
conservative proposals: only an exact `same_obligation` may attach an
observation to existing work (as evidence, never a record merge), an
`adds_scope` becomes a proposed linked follow-up, and every uncertain answer
holds for review — a claimed resolution routes to verification, it is never
itself evidence. Intake runs in **shadow mode**: new inbox requests, direct chat
tasks and tasks created from an approved plan are compared with existing work by
title-key overlap and classified in one batched evaluation call, and the
answer lands in the experience store as a `jev-proposal` event — a record,
never an instruction. Admission never waits on a classifier. A bounded queue
retains up to 48 observations arriving during a call or its cooldown, compares
up to three at once, and excludes each new request from its own candidates.
Planning questions and human decisions never go to Jev for approval; planning
honors routine/heavy model overrides or the selected Jev/default mode for
discussion and specifications. Planning calls retain their own provenance in Model Lab, while
Jev calls use the improvement-budget ledger.
Calls are spaced two minutes apart; two consecutive failures trigger an hour's
backoff, and an observation gets at most three attempts. Failed calls count
toward recorded usage. If a usage-ledger write fails, its charge is retried
before another paid call; the completed classification is kept.
`settings.jevShadow === false` is the operator's kill switch. The
message-kind builders (`progress` / `claimed_resolution` / …) ship tested but
unwired — the next shadow surface, not a live one. No classification can
suppress work, merge tasks, or spawn agents. Model id
`typesafe-ai/jev` is pinned (override with `MEFI_JEV_MODEL`); `npm run
jev:status` / `jev:models` / `jev:probe` check the route through the stored
key without printing it.

The **Studio** tab's **Jev connection & optional task suggestions** section has
a gateway key field, intake-classification switch, queue status, and **Test Jev
connection** button. The gateway key also enables Jev model selection; the
intake-classification switch only controls task suggestions. **Model selection**
controls routing separately. Keys are encrypted using the OS key store;
only connection status crosses into the renderer. `AI_GATEWAY_API_KEY` or
`MEFI_STUDIO_GATEWAY_KEY` can supply the key through the environment. Ordinary
tests are offline; the optional live test requires both `MEFI_JEV_LIVE_TEST=1`
and `AI_GATEWAY_API_KEY`.

**Loop responsiveness.** Animation no longer delays short agent jobs or a
finished model call. Independent message facts load in parallel, overlapping
readers share the same pending read, and overlapping ticks and proactive calls
share one running pass. A manual tick arriving during a timer pass still runs
after it. The executor releases its fill lock immediately after the last slot.
See [PERFORMANCE.md](PERFORMANCE.md) for startup measurements and reproduction.

**The overseer.** Above the assistant sits the **overseer** — the R&D layer
that never does the assistant's jobs but reviews how they are done. Before it
reviews, its **repair pass** puts the assistant back on track: a paused
service resumes, a breaker-parked executor re-arms (a deliberate switch-off
is respected on the cadence — only the **Oversee** button undoes an operator
pause), interrupted work restarts, and
**stale sessions** — work left in progress and quiet past the stale horizon —
each get a **resume request** filed to the inbox under source `overseer`
(oldest first, two a pass, never a duplicate of one already queued, dispatched
or on the board), a note lands in the session's folder, and the staliest one
takes the assistant's focus when nothing else holds it — so the next reply and
the composer's *Work on "…"* point at the work that slipped. Every
fifteen minutes, around the clock — the proactive switch never holds it;
Pause is its only off switch — or on demand from the **Oversee** button
under the composer, in the Command card, or by asking it in the thread, it
reads the assistant's own telemetry — roster health, the reply mix, fix
success, open problems, the work journal, the tree's stale sessions — into a
digest, scores the workflow
0–100 and writes a **playbook** that survives restarts inside
`data/eyes-assistant.json`. A finding that repeats across reviews becomes a
**lesson** whose hit count grows — that is how the overseer improves itself:
the previous digest rides along so trends, not snapshots, drive each pass.
What it does with a review is bounded and logged: it tunes the assistant's
prefs inside safe clamps (fold/stale/tidy hours, pool widths), and it files
upgrade requests into the request inbox under source `overseer` — each naming
the file to touch and the check that proves it — which the autopilot executor
can then build. With a key saved the model writes the sharper pass (fresh
lessons, upgrades, tunes); without one the deterministic local review still
runs. On the node tree it hovers directly above the assistant node in
periwinkle, not in the worker ring.

**Closing and coming back.** Reloading the view keeps host agents running and
restores their live status. On a full restart, Studio resumes the helper roles
and unfinished builder tasks that were working last. Builders save their session,
checklist, progress and recent output locally as they work, and flush their latest
checkpoint before a normal quit. The next builder receives that context and
continues from the existing edits, with interrupted tasks ahead of ordinary
queued work. A live worker retains ownership; Studio waits for it instead of
starting a duplicate. Pause, build approvals and prerequisites still apply.

Every job the pool starts — a reply, an
improve/grow/explore/expand run, an audit, a brief, an ideas scan, a reference
gather, an analyzer read — is journaled to `data/eyes-assistant.json` the
moment it starts and struck out the moment it ends, so a quit, crash or reboot
leaves the truth on disk. At the next start the service reads that journal
before anything else: every job still marked in flight, every message that
never got a reply and every agent that was mid-run is restarted, the log and
the thread get one line ("closed for 2 h 13 m · restarting 3 jobs: …") and a
toast says *Restarted N interrupted jobs*. A job is retried at most three
times after unplanned interruptions, then dropped with an error in the log;
normal quits and updates preserve a queued continuation without spending that
retry budget. Work older than ten minutes is
flagged as a `work-stale` problem, retried once and dropped. The assistant
card and the Explorer column keep a **Working on** list of what is in flight,
the Command pill reads `assistant · working on N`, and "what are you working
on" / "restart the interrupted work" are understood in the thread.

**24/7.** With *background* on (the default) closing the window hides it to a
tray icon — Open Studio, Pause/Resume assistant, Quit — and the loop keeps
running; *keep awake* holds a power-save blocker while the service runs. Both,
with Proactive and the fold/stale/tidy thresholds, persist in
`settings.assistant`. The state lives in `data/eyes-assistant.json`
(gitignored): the thread (200 messages), the log (300 lines), fixes (100),
the organisation, housekeeping, open problems and the unread count.

### Machine coordination

The Explorer's **Machine** panel and the background resource manager keep
agents from spamming the machine: it reads the repo's own test leases
(`tools/logs/_lease/`), lists live LOVE test processes with age/memory, writes
`data/machine-status.json` for other agents, and adds lease/run facts to every
briefing. Coding admission follows measured responsiveness in Studio's main
process and visible renderer; hidden or minimized views do not contribute
renderer lag. Sustained excess lag of 100 ms, or a severe 300 ms delay, holds
new starts. Readings of 40 ms or less let the queue resume automatically even
while other workers remain active. CPU usage and available RAM remain useful
context rather than worker-count limits; only the emergency guard below
512 MB of available RAM holds starts to avoid exhausting memory.
The Machine role stays available when the background agent pool is full.
Auto-kill (on by default,
toggleable) terminates **strays** (dead parent), **hangs** (no CPU progress for
4 minutes) and **over-age** runs (20+ minutes); every kill is logged to
`data/resource-manager.json`, shown in the panel, and queued to the inbox so
the owning agent is told. Healthy in-budget runs are never touched.

### Analyzer (`A`)

Loading a project starts a local overview in **Analyzer**. **Analyze project**
refreshes it after files change. It reads historical plans, roadmaps, design
notes and specifications alongside this project's saved Studio plans, then
compares their work items with current source files. The report shows the
project inventory, related code with `file:line` evidence, missing references,
and old completion claims that still need verification.

Ranked starting points explain why to tackle something, the first step and an
acceptance check. Prepare one as an editable idea before deciding what to build.
An empty project gets starting points for defining an outcome and building a
small first slice. Analysis does not change plans or create runnable tasks.
File existence and keyword matches cannot establish that behavior works; test
commands are listed for review, not executed. Scan limits and unreadable plans
are reported, and dependency, build, private-data and hidden folders are skipped.

The local overview works without a key. **AI project read** explicitly sends
bounded report excerpts to the saved z.ai or OpenCode Go HTTP connection for
additional interpretation; it has no coding tools. Loading a folder never
starts this AI request. Project changes clear the previous report and ignore
delayed results from the old project.

Drop a file or paste an idea. Files are picked apart in read time: composition
bars, outline, TODO markers, and referenced paths that exist versus are
missing. Ideas are compared with the work tree: keyword coverage, evidence
hits with `file:line`, and a new / related-work verdict. Text matches do not
prove implementation. The optional AI deep read adds features, ideas, content,
and gaps.

### Tasks, references and feature ideas

`T` (or the Tasks button in the tabs row, the Command dock or any sheet
header) opens the **Tasks** board: each task keeps its own log and
idea/thought log, colour-coded for the overhead view. Under the add box sit a
**search box** and an **All / Open / Done** filter row with live counts —
open work lists first, and finished tasks tuck under a collapsible **Done
mark** in the All view (selecting a done task unfolds it). Every row carries
a one-click **✓ done** (or **↺ reopen**) action, and the Done filter lists
finished and archived tasks newest-first with a finished/archived/this-week
rollup, an **Archive finished** bulk action, and a *what was done* digest on
each card (when it finished, how long it took, the last log lines, idea and
reference counts) with a Copy button. The task card manages one task end to
end: verb-first status buttons (**Mark done** / **Reopen**, plus Activate,
Back to open and Archive where they apply), **Rename**, and a two-step
**Delete**. The assistant's tasks answer names the latest finished too.
Adding a task can
auto-**gather references** — exact context for the idea before you build it:
code hits from the analyzer, matching node-tree sessions and chats, PNG
evidence from `tools/logs/`, matching feature ideas, and optional live web
results (DuckDuckGo). Toggles: Use reference, Web, Node history, Blur menu,
Auto. Gathering attaches the best hits to the task and logs what it found.
**Overhead** draws the node tree with a colour-outlined box per active task
(connected to its matched session) and an Overview mode that cycles the
highlight; clicking a box opens that task in the board. **Feature ideas** scans recent chats locally (or with an AI
review) into an unread inbox; reading an idea marks it read, Keep/Done/Make
task manage it, Clean done prunes finished items, and the **feature graph**
clusters related ideas into a self-building map you can dive into.

### Command view (`D`, the constellation)

The project workspace is the default home. Open the constellation through
**Studio tools** or `D`; its ambience settings control its idle behavior.
The startup loading screen prepares the initial view, including a saved
Command view on reload, before releasing the app's controls.
Nodes are labelled, the **Legend** pill explains the
colours and rings, hovering one shows its kind, status, agent, model and age,
and the search box finds a session, todo or task and rings the matches. Walk
the graph with `←` `→` (sessions), `↓` `↑` (into a session's todos and back
out) and `[` `]` (task nodes); `F` fits, `Space` pauses the orbit and `L`
cycles labels. Drag to pan, wheel to zoom.

The camera has three modes, cycled with `C` or the **Orbit / Follow** toolbar
pair: **Orbit** keeps the whole tree in frame at the largest zoom that still
shows every node (new work shrinks the fit instead of spilling out), **Follow**
locks onto the node the agent's work sits on and moves as the work moves, and
any pan, zoom or click-to-focus hands the camera to you (**free**) until a
mode is picked again. The graph changing shape never moves the camera on its
own.

Selecting a node opens a card on the right: kind, status, progress, key
values, checkpoints with their Reference / Explore / Restore / Expand actions,
and a fixed row of actions whose first one is what `Enter` and a double-click
fire — **Open in Explorer** for a session or todo, **Open in Tasks** for a
task. The card's deep links go somewhere specific: the Explorer opens *on that
session*, the A-Eyes feed opens *filtered to it*, a checkpoint's Restore opens
its evidence PNG. The composer in the top bar **adds a task straight into the
graph** (auto reference runs as usual; `Ctrl`+`Enter` opens the new task in
Tasks).

**Finished work** reads green. A task that finishes while the view watches
holds the board for a few seconds — it pulses green and wears a wiggling
**!** — so you can click it (or the **!**) to read its card before it flies
home and sinks into its host; reading pauses the sink until the card closes.
Work that was already finished before the view saw it absorbs straight away,
and the folded **N finished** cluster folds into the root the same way — its
titles stay readable on the root's card under *Absorbed work*, and the
Explorer's *Finished (n)* group still lists every session. On the Tasks board
a row that just finished pulses green for a beat before it settles under the
Done mark.

The glass **dock** along the bottom is the menu itself — every surface and
tool, each with its key and a live badge — and the clickable telemetry pills
top-left track sessions, in-progress work, open tasks, unread ideas and
whether the machine is busy with tests. A sheet opened from here floats over
the constellation with a **Command** button at the far left of its header;
closing it (that button, its Close, or `Esc`) puts you back on the
constellation with the same node still selected. Zen audio still keys to agent
tempo, reads/searches still vaporize as particles, and paths brighten when
several agents touch them.

## Live update

The app watches its own source tree and applies edits without being told to,
and without kicking you out. What happens depends on what changed:

- `renderer/styles.css` is **restyled in place**: the new CSS replaces the
  page's stylesheet slot; nothing reloads.
- `scripts/*.mjs` modules are **swapped inside the running app**: the main
  process re-imports the changed module and drops its cached copy (the updater
  itself restarts its watcher from the new file).
- `renderer/*.js`, `booklet.template.html`, `scripts/build-booklet.mjs` and
  `preload.cjs` **reload the page after a pause**: the window rebuilds
  `booklet.html`, waits until you have been idle for four seconds with no
  unsaved text in a field (thirty seconds at the outside), and comes back with
  the tab, the sheet, the Command view's selection and zoom, the sheets'
  selections, every text field, every scroll position and the focus restored.
- `package.json` and `assets/**` only refresh the packaged payload.
- `main.cjs` is the one edit that **restarts the app** — after the same pause,
  with the window bounds and the whole UI state restored.

Edits are batched: nothing happens until the writing stops (1.2 s for renderer
files, 5 s for main-process files, 10 s at the outside), so an agent writing
six files produces one update, not six. Every changed script is syntax-checked
first, and a broken file **holds** the update rather than reloading into a
crash — fix it and the whole accumulated change set goes through. Three
restarts inside a minute also hold, as does a `devDependencies.electron` bump
in the packaged app (run `npm run package` for that one). The payload's `data/`
directory — your tasks, ideas, checkpoints, pins, requests and the assistant's
state — is never written by the updater. `npm run package` follows the same
rule: it refreshes only `curated.json` and `models.json`, never copies local
state or caches from the source installation, and leaves existing payload
state alone. `--clean` carries the payload's `data/` across the wipe.
`npm run package:release` instead creates a separate, fresh distribution folder.

The header carries a **Live update** pill: green watching, gold while it
rebuilds or updates in place, amber when an update is ready and waiting for a
pause (click it to apply now) or pending, red held. Clicking it opens the
Studio tab, where **App updates** has the *Apply updates automatically*
switch, an **Apply update** button (**Restart now** only for a `main.cjs`
edit) and the current status; in-place updates announce themselves as
"Updated in place · styles" or "Updated in place · N modules". The palette
(`Ctrl K`) has *Toggle automatic updates* and *Apply update now*. Turn the
switch off and updates queue as "pending" until you apply them.

Watching costs one `fs.watch` per directory plus a 15-second stat poll over 29
files; the screenshot tour, `--smoke` and every `--assistant-*` CLI mode never
watch, reload or relaunch.

## Keys

`D` Command view · `1` Booklet · `2` Graph · `3` A-Eyes · `4` Studio · `E`
explorer · `T` tasks · `I` ideas · `O` overhead · `A` analyzer · `Ctrl K`
palette · `/` model search · `R` refresh catalog · `G` pin the node tree · `M`
message the assistant (Command view) · `?`
shortcut sheet · `Esc` closes the top-most layer (palette, then the open sheet,
then the Command selection, then the Command view itself). A tool key pressed
while that tool is open closes it again; `E` with a session selected in the
Command view opens the explorer **on that session**, and `T` with a task
selected opens that task.

In the Command view: `←` `→` walk the sessions, `↓` `↑` go into a session's
todos and back out, `[` `]` cycle the task nodes, `Enter` runs the card's first
action, `F` fits everything, `Shift F` fits the selected branch, `Home` selects
the root and fits everything, `0` resets the zoom, `Space` pauses the orbit, `L`
cycles node labels (auto / all / none), `S` jumps to the node search, `N` to
the task composer and `M` selects the assistant node and focuses its composer.
Typing in a composer or the search box never navigates — `Esc` leaves the
field first. Motion can be paused from the header switch.

## Love2D studio

The Studio tab launches the external Ruins Runner checkout's standalone dev tool exactly like
`Run Dev Tool (LOVE2D).cmd`: windowed `build/cache/love-11.5-win64/love.exe`
with `dev/dev_tool_love_project` and the game root as cwd. Smoke goes through
the sanctioned `Run Dev Tool (LOVE2D).cmd --smoke` console path. If the LÖVE
runtime is missing, run `tools/build-windows.ps1` from the game root. Set
`MEFI_STUDIO_GAME_ROOT` to its location if it is not the sibling `2d Trippy Hell`.

## Tests

Run from this repository root. The Python contracts are registered in
`TESTRUNS.md` and `tools/test_sets.json`:

```powershell
python -m unittest discover -s tools -p "test_mefi_studio_*.py"
```

The contracts cover the catalog math and honesty rules, the built booklet's
self-containment and refresh markers, and the launcher's LÖVE shape. None of
them need network, Electron, or LÖVE.

The assistant's board invariants — one identity per piece of work, the idea
delta race, plan-merge preservation, claim-sparing, the ownership fence, the
housekeeping sweep — have behavioral fixture tests in `tests/board.test.mjs`
driving the pure module directly:

```bash
node --test tests/
```

`npm test` runs both, and `npm run reconcile-board` (`--dry-run` to preview)
applies the same compaction rules offline to repair the live data files.
After a heavy promotion pass the repo board and the packaged app's board can
fork again; `node scripts/reconcile-store-fork.mjs` (`--dry-run` to preview)
is idempotent and race-safe on re-run.

After a CSS refactor or a `renderer/styles.css` merge collision, prove the
result instead of eyeballing diffs with the cascade gate:

```powershell
npm run check:css
```

With no arguments it compares `HEAD:renderer/styles.css` against the working
copy and exits non-zero unless every cascade-winning declaration (per
selector-context, property and importance) survives unchanged.
`npm run check:css -- pre-merge.css post-merge.css` compares any two files —
snapshot the pre-merge copy, resolve the collision, then run this to confirm
the merge is winner-for-winner equivalent (see TESTRUNS.md, "Verifying a
session edit-collision handoff"). The dead-selector companion,
`npm run check:css:unused` (also a step in the `npm run check` chain), flags
winner-bearing selectors whose classes appear in no surrounding renderer
html/js/css usage (`--allow cls,...` excuses a class that JS builds
dynamically), so rules orphaned by a refactor surface in the audit instead of
by hand.
