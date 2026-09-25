# Studio interface remaster

The remaster uses an expressive, compact work interface: shared typography,
theme-aware surfaces, consistent controls, and advanced detail available in
context. Existing data, credentials, route IDs, shortcuts and host operations
keep their contracts.

## Menu inventory

This is the coverage checklist for the entire renderer, including menus built
in JavaScript. A route opening alone does not verify its interior controls.

| Area | Menus and states to verify |
| --- | --- |
| Shell | Home, Work, Live, Models; local navigation; Settings, Search, Help; expanded/collapsed rail; project selector; keyboard and return focus |
| Home | Project actions; Chat/Create task; suggestions; queue settings; work filters, search and details; service status; loading/failure/retry |
| Projects/startup | Project list and active marker; add/switch project; no-project path; Open studio versus start-agents choice; recovery |
| Tasks | Overview/list; All/Open/Done filters; selected task; Details/Evidence/History/References; attempts; prerequisites; handoffs; approval, retry and blocked states |
| Plans | Plan list; new plan; current stage; interview; unknowns and dependencies; review/specification; task handoff; project discovery; revisions |
| Ideas | List/graph views; selection; Tools menu; scan/review/cleanup affordances; selected-idea actions |
| Brain maps | Map chooser; Map menu; draft tools; undo/redo; save/live state; parts search; canvas/view controls; inspector; legend/shortcuts; unsaved edits |
| Analyzer | Project/File/Idea modes; input selection; local/AI distinction; findings and evidence; errors |
| Command | Toolbar groups; View menu; Ambience; camera modes; selected node; Work/Agents/Assistant/Done/Ask; queue expansion; logs; Legend; Usage |
| Activity | Filters; PNG/Diff/Log views; file/evidence selection; pins; inspector; unavailable states |
| Sessions | Session tree/detail; optional Session tools with Assistant/Activity/Diagnostics tabs; conversation, briefing and inbox; machine/auditor views; Back from tools or detail; tools replace detail below 1100 px and become the sole pane below 760 px |
| Overhead | Overview toggle; task legend/selection; canvas and detail |
| Models | Catalog search/filter/sort; expandable model/specifications; catalog insights; Performance; ratings; Usage Recorded calls/Provider accounts; Context |
| General | Names; startup behavior; legacy preference links |
| Appearance | Themes/custom colors; motion/blur; node style/layout/backdrop; effects; live preview and return |
| Connections | Setup; provider and CLI status/configuration; custom endpoints; decision-model credentials; disabled/error states |
| Model settings | Provider/model choices; overrides; tiers; routing and fallbacks |
| Automation | New-work admission; queue execution; approvals; parallel workers; coordination; intake; synchronized quick controls |
| Audio | Local/Radio/Spotify; player/queue; volume; input/reactivity; effects; recommendations |
| System | Updates; diagnostics; profiler; connection log; machine tools; optional game/Server Styler integrations |
| Help/search | Help menu (Start here, Shortcuts, Community); grouped Shortcuts sheet; Search Studio results, selection, empty results and return focus |
| Onboarding | Seven stops (Scan, Your workspace, First map, Connections, Create, Monitor, Review); scan/apply, free-model choice, map/cancel, assistant advice/task draft; resumable full guide; corner coach Back/Full guide/End tour/Next |
| Community | General disclosure; theme/node-style showcase; linked/unlinked/linking/cancel, unavailable, not-configured, not-member, relink, offline, session-only and self-unlocked states; Check now/Unlink; Build it yourself → What the agent will change; invitation snooze/dismiss; locked-item toast actions |
| Profiler | Start/Stop/Reset/Export JSON, frame-budget select, recording HUD; frame history, rendering hotspots, host requests, recent hitches and process tables; closed-panel recording and return focus |
| Feedback/dialogs | Status, warning/error and action toasts; Confirm/Cancel/dismiss/Escape with focus return; Brain map in-sheet input/confirmation dialogs and nested shortcuts; operating-system file/folder pickers |

Nested dynamic controls are part of each surface's coverage, not separate
destinations: Command has task-group members → Saved context and history,
Absorbed work, Context folder, Filed by the assistant and Checkpoints
(Reference/Explore/Restore); Plans has question interviews, Edit this question
or its prerequisites, Add a question yourself, Set this uncertainty aside,
Plan history → saved revisions → Specification and task briefs; Tasks has
Tasks & progress, Confirmed plans & tasks and handoff output. Brain map
inspectors have Settings, Model, Last 24 hours, Permissions, Connections,
Capabilities & limits, What this map holds/moves and What this map grants.
Its Map menu contains Draft with AI, New empty map, Duplicate, Discard unsaved
changes, Reset to the shipped pipeline and Delete. Ideas Tools and Session
tools retain their own secondary action disclosures. The Command canvas
suppresses the browser context menu; it does not contain another hidden
right-click action menu.

## Interaction rules

- Main tools are workspace pages in the rail shell. Temporary dialogs retain
  modal semantics and focus return.
- Settings show one category at a time. Search reveals the exact setting and
  any containing disclosure. Legacy section links still resolve.
- New-work admission and queue execution remain separate operations. Settings
  and quick controls use the same confirmed state and save functions.
- Data-driven refreshes preserve applicable selection, drafts and disclosure
  state. A project switch cannot apply a stale response to another project.
- Narrow screens show one working pane with an explicit return to the list.
  Popovers stay inside the window and hidden panels do not receive keyboard focus.

## Verification record

### Automated layout and navigation verification

The isolated Electron renderer pass completed on 2026-09-23 in 72.4 seconds
with no renderer errors, network attempts or child-process attempts. Its
`tests/command_render.test.mjs` matrix checks these four configurations:

| Window layout | Browser zoom | Measured CSS viewport |
| --- | --- | --- |
| 1440 × 900 | 100% | 1440 × 900 |
| 1100 × 720 | 100% | 1100 × 720 |
| 600 × 560 | 100% | 600 × 560 |
| 1100 × 720 | 125% | 880 × 576 |

Chromium desktop viewport metrics remove Windows client-area rounding, so
the 1100 px breakpoint is tested exactly. Increased scaling uses the real
`webContents` zoom factor. Each configuration covers:

- All 15 logical routes: Home, Tasks, Plans, Ideas, Brain maps, Analyzer,
  Command, Activity, Sessions, Overhead, Catalog, Performance, Usage, Context
  and Settings — **60 route checks**.
- General, Appearance, Connections, Models, Automation, Audio and System,
  with exactly one category pane visible — **28 category checks**.
- Session tools' Assistant, Activity and Diagnostics tabs, including pane
  visibility, viewport containment, no lower stacked column, and Back returning
  focus to the opener — **12 nested-panel checks**.

The route checks also cover the four main destinations, selected local view,
pointer hit testing of every local-navigation button, horizontal containment,
workspace-page height and region semantics. The run checks Help's Escape and
focus-return path. At 600 px, Session tools use the single scrolling pane;
at 1100 px, they replace the session detail beside the tree.

The capture-enabled run saved **100 layout records** in
`%TEMP%\mefi-remaster-menu-captures\menu-report.json`, with PNG captures beside
the report. Captures wait for two animation frames and a compositor delay
after each route or category change. Examples include `600-ideas.png`,
`1100-sessions-diagnostics.png` and `1100-125pct-settings-appearance.png`.
These local artifacts are not committed. Set `MEFI_MENU_CAPTURE_DIR` to an
absolute directory when running the test to retain another capture set.

The focused shell, startup, sidebar and onboarding run passed **78 tests**,
including keyboard navigation, Help focus return, hidden-control focus guards,
legacy route aliases, model-route return from Command, and retention of the
Recorded calls/Provider accounts selection. These checks supplement the
interior-menu unit tests; the layout matrix alone does not claim every
provider form or dynamic content state was exercised.

### Attended verification

The Windows computer-use pass used a separate Electron installation with a
synthetic bridge and disposable project state. It inspected Home, all seven
Settings categories, provider configuration disclosures, individual Settings
search, model routing and overrides, fallback order, Appearance controls and
the live canvas preview, Local/Radio/Spotify panels, Sound & reactions,
System diagnostics, and profiler Start/Stop and results. Escape from the
preview and profiler returned focus to their openers. Catalog rows,
Performance's empty state, Recorded calls/Provider accounts, and Context with
an expanded task brief were also inspected.

That pass exposed first-visit Automation loading/focus and preview-button
placement defects; both were fixed and covered by regression tests. The
desktop session was subsequently stopped with physical Escape. No further
native input was issued. The remaining Work, Live, Help, startup and
project-switching walkthrough, plus an attended retest of the final fixes,
therefore remain **unexecuted**. Automated tests and screenshots below are
separate evidence; they do not stand in for that requested attended pass.

### Inventory review and interaction coverage

Every inventory area above received a source/layout review. The table records
the interaction suites for each area, including dynamically generated menus.
Suite coverage is representative of the component's behavior and states;
it does not imply every possible data value or external account was tested.

| Inventory area | Interaction/render evidence | Attended coverage |
| --- | --- | --- |
| Shell | `app_rail`, `nav_startup`, `palette_keyboard`, full route matrix | Main/local navigation and Settings/Models |
| Home | `workspace_ui`, `command_project_switch`, route matrix | Populated conversation/work layout |
| Projects/startup/recovery | `startup_screen`, `startup_render`, `startup_resume`, `renderer_recovery` | Remaining |
| Tasks | `tasks_ui`, `task_groups`, `task_history`, `task_handoffs`, `task_overview_render` | History focus/refresh/save verified in the later live trial; remaining menus still pending |
| Plans | `planning_ui`, `planning_execution`, route matrix | Remaining |
| Ideas | `ideas_ui`, route matrix | Remaining |
| Brain maps | `brains_ui`, route matrix | Remaining |
| Analyzer | `analyzer_ui`, `analyzer_host`, route matrix | Remaining |
| Command | `command_toolbar`, `command_graph`, `command_activity`, `command_render`, queue/usage suites | Remaining |
| Activity | `activity_navigation`, evidence rendering and route matrix | Remaining |
| Sessions | `explorer_ui`, all three tools tabs and Back in layout matrix | Remaining |
| Overhead | `overhead_poll_backoff` including keyboard selection/focus, route matrix | Remaining |
| Models | `model_lab`, `graph_table_ui`, catalog/build contracts, route matrix | Catalog, Performance, Usage and Context |
| General | `settings_nav`, settings category matrix | Inspected |
| Appearance | `settings_nav`, `music`, canvas/preview tests, category matrix | Controls and preview/return |
| Connections | `settings_nav`, provider/configuration contracts, category matrix | Status rows and representative forms |
| Model settings | `settings_nav`, routing contracts, category matrix | Selection, overrides and fallback order |
| Automation | `command_queue_settings`, `settings_nav`, category matrix | Search exposed cold-loading defect; final retest remaining |
| Audio | `music`, audio input/source/reaction suites, category matrix | All three source panels and reaction disclosure |
| System | Settings, profiler, update and integration contracts | Diagnostics and profiler capture/return |
| Help/search | `palette_keyboard`, navigation/Help focus tests | Individual Settings search only |
| Onboarding | `onboarding`, startup/rail tests | Remaining |
| Community | `community_ui`, host/bridge/rules fixtures | Remaining |
| Profiler | `performance_render`, `performance_core`, host contracts | Start/Stop, results and Escape/return |
| Feedback/dialogs | `confirm_toast`, Brain map dialog tests, loading/error fixtures | Provider availability states; remaining dialogs use fixtures |

External-service actions use fixtures. Live authentication, paid model calls,
Spotify/radio playback, microphone or loopback permissions, destructive
operations on real project data, and real operating-system pickers were not
executed. No user credentials, projects, audio files or settings were changed
by the review fixture. Captures and diagnostic logs remain outside Git.

### Final application gates

The settled-tree gate on 2026-09-23 passed after rebuilding the booklet:

- `npm run build-booklet`: 39 models, bundle hash `f98dd2322a01`.
- `npm run check`: 111 source targets, 259 specs, five stylesheets, clean
  syntax, selector usage and test-record checks.
- `npm run audit`: zero errors and zero warnings.
- `npm test`: **2,849 Node tests passed, five skipped**, **248 Python tests
  passed**, and all **six normalized-path lock checks passed**. Node suites
  took 156 seconds and Python contracts took 62 seconds. No stage failed.
- `git diff --check`: passed.

The Node skips cover opt-in VM modules, a live gateway probe, POSIX process
groups on Windows, a seeded-resume Chromium scenario, and the desktop
occlusion probe. The last skipped because this desktop did not expose the
required visibility/occlusion events. Startup/recovery and the remaster
layout fixture passed, with a fresh **100-record** capture report.

Full output is local at `%TEMP%\mefi-remaster-npm-test-settled.log`. The first
exploratory run found stale label/gradient assertions and concurrent backend
fixture assumptions; these were corrected, focused checks passed, and the
complete gate was rerun on settled sources. No production verification rule
was weakened to make those fixtures pass.

After desktop control was explicitly resumed for the separate Studio Snake
trial, the live History editor exposed a refresh-related focus loss. The
repair preserves focus, the draft and selection for the current task while
still applying live data updates. Its focused UI suite passed 49 tests. In
updated Studio, an empty History field retained focus through a 17-second
wait and periodic refresh, accepted later typing, and saved the note; the
visible log count increased from six to seven. This adds attended evidence
for that path, not for the other pending menu walkthroughs above.

The subsequent complete gate passed **2,856 Node tests with five skips**,
**248 Python contracts**, and **six path-lock checks**, with no failures or
source-movement warning. Node took 99 seconds and Python took 35 seconds.
The preceding booklet, check and audit gates also passed. This later run's
occlusion probe skipped after its fixture window was externally destroyed;
it is not recorded as a pass. The complete local log is
`tools/logs/studio-snake-final-history-focus-npm-test.log`, and the live
verification is recorded in TESTRUNS.md under “Studio Snake end-to-end trial
completed and History fix verified live”.
