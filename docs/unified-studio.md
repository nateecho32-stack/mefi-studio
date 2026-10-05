# Unified Studio

Studio has four main places: **Home** for conversation and task actions,
**Work** for Tasks, Plans, Ideas and Analyzer, and **Agents** for the team and
its work, plus **Friends** for Rooms, Your PCs and Playground. Friends reuses
the companion's Friends menu; its direct links focus the matching card. These
actions also appear in Search, and the companion's Friends bubble still works.
Settings keeps personal appearance, audio and system preferences;
Help keeps onboarding and shortcuts. Existing destination IDs and keyboard
shortcuts still resolve through the navigation registry.

## Agents

| Section | What belongs here |
| --- | --- |
| Overview | Readiness, active team, running work, decisions, start/pause controls |
| Setup | Device connections, teams and presets, model routing, workflow behavior |
| Live | Command, Fleet, Pipelines, Sessions, Activity, Trace and Overhead |
| Workflows | Brain maps, Playbook, Project map and Context |
| Models | Catalog and measured performance |
| Usage | Recorded calls and provider account readings |

Follow **Connections → Team → Workflow → Ready** for initial setup. Opening
setup and applying a team do not start work. New-work admission, queue
execution, approval policy and total worker capacity are Studio controls;
they save immediately and display the host-confirmed state.

Command's top toolbar also exposes the immediate queue controls under
**Agents**. Its dropdown keeps the canvas and selected node visible, with
links to Team & models, Providers and the full run settings workspace.

Team configuration uses **Apply changes** and **Discard draft**. Drafts survive
navigation and are separate for each project and Studio defaults. Projects
inherit Studio defaults until explicitly configured. A saved team is an
independent copy: changing a preset never changes a project that used it, and
project edits never modify a preset. Use a preset in the draft, name it, then
save as a new preset to duplicate it; update or delete the selected preset
with the adjacent actions. Credentials remain in the encrypted device store.

Team & models gives each agent a model menu on the left, supported effort and
fast settings on the right, and a provider icon in the corner. Providers opens
device connections; Routing & fallback keeps the advanced routing controls.
Assistant seats support HTTP providers, Claude's text-only CLI, and inherited
routing. Coding-only CLIs remain available on the coding worker row.
Saved model IDs remain selectable even when a provider's roster is unavailable.
Use Refresh model list in the provider picker or enter an explicit model ID.

The left **+** attaches up to eight installed local skills to the selected
agent. Studio scans project and user `.agents/skills`, `.claude/skills`,
`.codex/skills` and OpenCode skill folders for `SKILL.md`. Selected skills enter
only that agent's prompt, within its existing task and tool permissions. Team
snapshots contain opaque skill identities, not skill contents or file paths.
The coding worker's MCP section enables the existing Studio desk tool on
OpenCode and Claude Code. Other servers remain configured by the coding CLI;
text-only assistant seats cannot execute MCP tools. Missing skills can be
removed from the draft. Missing connections and fallback reasons stay visible.

The host stores versioned teams in `settings.agentTeams`. The preload methods
`agentsState`, `agentsSave` and `agentsPreset` return revisioned public views.
Saves check both the active project and revision. A stale save is rejected;
the renderer retains the draft. Reload saved settings to discard that draft
and review the current configuration.

`scripts/agent-profiles.cjs` resolves configuration for assistant calls, seats,
worker admission, setup and workflow changes. Each admitted attempt captures
its team. Checkpoints retain this snapshot; resumed dispatch restores it
before resolving a worker route. Desk callbacks also retain the attempt's
project and team. Device credentials stay outside snapshots and presets.

## Navigation and overflow

Back/Forward history belongs to a major section and project. Returning within
Agents stays in Agents; Work stays in Work. A new visit after Back drops that
section's forward branch. Explicit links such as **Open current task** cross
sections. Temporary dropdowns and the companion consume Escape before page
navigation. Selected records, draft fields and scroll/focus snapshots survive
ordinary navigation.

Studio-owned overflow has no visible native scrollbar or reserved gutter.
Wheel, touchpad, touch and keyboard scrolling remain available. Edge fades
indicate hidden content. Hovering or focusing a scrollable region reveals
directional arrows only where there is more content. Click advances most of
a viewport; hold continues until release, cancellation or a boundary.
Dropdowns use the same treatment, with keyboard selection and search for
long lists. OS dialogs and embedded external applications keep their own UI.
Project maps use a fixed canvas with a searchable contents panel, breadcrumbs,
Back/Forward history, Fit, zoom and an interactive minimap. Click inspects;
double-click or Enter explores. Arrow keys select, Shift+arrows pan, Home fits,
and Backspace goes up. Camera motion and level transitions settle when idle
and respect reduced motion. At narrow widths, maps, pipelines and Playbook
recipes show one working pane with a labeled return to their list.

**Focus**, **Studio** and **Atmosphere** share the same controls and typography.
Zero Glass intensity uses solid reading surfaces. With background video on,
glass keeps a stronger tint under page text, navigation and floating menus so
bright frames do not wash out labels. The video remains the same player while
switching pages, themes or glass settings.
Density, glass and glow are independent adjustments; color themes, node
looks and existing motion preferences remain available. Full, Calm, Off and
OS reduced motion are respected. Narrow Agents navigation uses labeled menus.
Short windows compact the rail's utility controls to keep Home, Work and
Agents visible even at increased display scaling.

The colour theme supplies a display face and a pair of gradient colours. Gold,
Forest, Ember, Rose and Eclipse use serif headings; Chrome, Aurora, Midnight,
Violet and the other Void themes use sans-serif headings. Body text stays in the
system UI family and technical labels use a local monospace font. All fonts
have offline fallbacks. Pages reveal a shared backdrop; cards, fields, sticky
headers and popovers use progressively stronger glass fills. Inactive Home
and Command controls are hidden behind workspace pages so text does not bleed
through. Blur off retains a translucent tint with greater opacity; OS reduced
transparency uses solid surfaces. Custom palettes retain their chosen colours,
with a safe reading background when canvas and panel tones differ.

**Chrome** is the theme a new install opens in (one already saved, Aurora
included, is kept) and the public website's palette. `renderer/chrome.css`,
inlined last and scoped to `html[data-studio-theme="chrome"]`, gives it matte
surfaces: the panel colour on the page's black with a 1px top highlight,
quiet hairlines and deep neutral shadows, and no coloured glow. Primary buttons
and the chosen segment of a segmented control (the Vibe | Build switch,
Sessions | Backlog, Command's rail tabs) are brushed metal with dark ink, which
reads at 5.4:1 or better on the darkest stop of the pressed metal; secondary
buttons are matte with a chrome hairline; the current place in the rail, a
selected row and the open tab get a thin chrome edge instead of a fill. The
status colours keep their meaning, and the stylesheet changes paint only, never
size, place or scrolling (`tests/chrome_theme.test.mjs`). Every theme shares the
finish in `studio-ui.css` and the frame's stylesheets: hover settles in 140 ms
and a press in 90 ms (0 with motion off), raised controls and floating menus
catch a 1px top highlight.

## Layout contract

The shell keeps room in its geometry for four regions: a session list beside
the rail, an inspector at the right, a tab strip under the local navigation
and a status bar along the bottom. `renderer/shell.js` draws the frame in them
(see "The frame" below); the contract is what it stands on. With every region
at 0 (the default, "layout v1") each page, sheet and floating thing is exactly
where it was: `tests/fixtures/layout-contract-v1.json` holds the boxes of the
base commit and the render fixture compares them.

| Variable | Range | Meaning |
| --- | --- | --- |
| `--shell-list-w` | 0 to 420 | width of the session list, right of the rail |
| `--shell-inspector-w` | 0 to 640 | width of the inspector, at the right edge |
| `--shell-tabs-h` | 0 to 48 | height of the tab strip, under the local navigation |
| `--shell-status-h` | 0 to 40 | height of the status bar, at the bottom |

All four are declared once, as `0px`, in `renderer/styles.css`. The free area
is bounded by four derived edges, and page CSS says "where the free area
starts" with them and nothing else: `--shell-x0` (rail plus list),
`--shell-x1` (inspector), `--shell-y0` (local navigation plus tab strip) and
`--shell-y1` (status bar). `--shell-rail-w`, `--shell-rail-open` and
`--shell-local-h` keep their own meaning, the rail itself and the local
navigation itself, and their remaining uses are named in
`tests/layout_contract_css.test.mjs`.

The contract is for the rail shell, which Vibe always has. Build's classic-tabs
choice keeps its row of tabs and has no room for the regions.

Only `MefiNav.layout.set(name, value)` (`renderer/nav.js`) gives a region room,
where `name` is `list`, `inspector`, `tabs` or `status`. The value is cut to
its range, then to what the window can spare: the rail, the list and the
inspector never leave the main area less than 320 CSS px, and the inspector
gives way first. It writes the variable as an inline pixel value on `html`
(nothing for 0), announces `mefi:layout` and a `resize`, and answers with what
the region got. A region's own component calls it when it appears and again
with 0 when it goes; no stylesheet assigns these variables beyond the zeros
above and the fold's.

`html[data-layout="v2"]` turns the contract on; v1 is the attribute absent. It
is a second attribute because a third `data-shell` value would read as classic
to every `=== "rail"` test. `applyLayout` in `renderer/nav.js`, beside
`applyShell`, is its only writer. `?layout=v1|v2` decides one launch and wins;
otherwise the saved `mefiStudio.layout` (`MefiNav.setLayout("v2")` writes it),
and v1 when there is none. A `?smoke=1` or `?capture=1` launch stays v1 unless
it names a layout. In v1 nothing is wired: no listener, no stored key, no
inline variable.

Fold rule: a v2 window narrower than 900 CSS px has no room for columns. The
list and the inspector compute to 0 (a `max-width: 899.98px` query in
`renderer/styles.css`, so the geometry is right in the same frame as the
resize and `usable()` is right even inside a resize handler that runs before
any script's media-query event) and `html` carries `data-layout-fold="list
inspector"`, which `nav.js` keeps on resize, for the regions that become
drawers. The tab strip and the status bar are rows and keep their height. What
was asked for is kept (`layout.get()`), and the columns come back when the
window grows.

`MefiNav.usable()` answers `{ left, top, right, bottom, width, height }` in CSS
px: the part of the window no chrome covers, the rectangle the companion's
orb, the media window, toasts, pop-ups and Command's graph stay inside. In v1
it is what each of them measured for itself before: the right edge of the
rail's box (the open rail included, since it opens over the page), the bottom
of the local navigation's, and the window's other edges. In v2 it is also
clear of the list, the tab strip, the inspector and the status bar. Ask it
each time something is placed, not once.

**Turning it on.** Since 0.5 it is the default: with nothing saved, the page
opens in it (`renderer/nav.js` `layoutChoice`); smoke and capture launches stay
classic unless they ask, so the diagnostic fixtures keep their geometry. Classic
is always one switch away, and the ways to choose are the same. In Settings (the You section, which
Configuration › UI & Surfaces lists too) the switch "Try the 0.5 layout"; in
Search the action "Switch layout: 0.5 or classic". Both save the choice through
`MefiNav.setLayout` and reload the window, the way Build's sessions-layout
switch does, so every module starts in the layout it was asked for. For one
launch, `?layout=v2` (or `v1`) on the page's address wins over the saved
choice, and so does the environment variable `MEFI_STUDIO_LAYOUT=v2` (or
`v1`) for the desktop app: `main.cjs` passes it to the window as that query.
`MEFI_STUDIO_LAYOUT=v1` is the kill switch, since it opens classic whatever was
saved; any other value is ignored.

## The frame

`renderer/shell.js` (`window.MefiShell`) and `renderer/shell.css` draw the 0.5
shell's frame in the contract's regions. Everything in the stylesheet is under
`html[data-frame]`, which only the script writes, and only while
`html[data-layout="v2"]` is on and the rail shell is the shell (classic has no
room for regions). With v2 off nothing is drawn, nothing listens, polls or
stores, and nothing calls the host; the one thing the script always does is the
way in above. The frame is built at launch when v2 is on, follows a live v2-off
or a loss of the rail shell by removing itself, and is built again by
`MefiShell.enable()` (a live `setLayout("v2")` does not build it: the switch
reloads the window).

Regions, each a `position: fixed` element placed from the contract's derived
edges and nothing else (`--shell-rail-w` and `--shell-local-h` are read back
from them, so the ledger in `tests/layout_contract_css.test.mjs` does not
grow): the **top bar**, the **list**, the **inspector**, the **tab strip**'s
row, the **status bar**, and **main**, a host over the free area that
transparent pages are not drawn into but other modules may mount into. They sit
in the same layer as the local navigation (`--z-shell` minus one), the rail
opens over them, the status bar sits above them, and the Layout menu above
the sheets. Each region's size is reported through `MefiNav.layout.set`
only when it changes from what was asked last, and a column the window has
folded is left to the contract, which remembers what was asked.

**The top bar** is the local navigation's row: there is one band at the top, not
two. Left: the list toggle and the Vibe | Build switch, a radiogroup (Ctrl M)
that calls `MefiVibe.setMode` and adds no `uiMode` value; from a mode's Home it
goes to the other mode's Home, from any other page the page stays. Middle: the
0.5 prototype's breadcrumb. On Home it is the project and the session open in
the thread (`MefiSessions.selected()`), or Today when none is; anywhere else
the project, the section (`MefiNav.sectionLabel`) and the page, and on the Task
board the task it has selected, as a button that opens it (the classic bar's
"Current task"). The classic local navigation (Back, Forward, the section's
pages, the Git chip) is not drawn in the frame: the section's pages are the
**page list** in the list column, on every page of a section that has pages of
its own (`MefiNav.LOCAL_ROUTES`: Work, Agents, Settings; for Agents the
sections and views of `MefiAgents.navModel()`, so every pane and tab is still a
press away), with Back and Forward within the section (Alt ← and Alt → as
before) and the Git chip. While it shows, the column's panels make way
(`.shell-list[data-pages="on"]`) and `MefiShell.pages()` says so, so the
session list does not draw; Home keeps its session list. Right: the Search pill (opens the palette, shows Ctrl K), "N need you" and
"N working" with its pause or resume button, and the inspector toggle. Below
about 470 CSS px the bar keeps icons and counts. The pills read what the app
already holds: the
digest total (or the open questions) for "need you", or `MefiToday.count()`
when that module is there, and `MefiWorkspace.snapshot().status.running` for
"working". Pause and resume click Home's own `#workspace-pause`, which keeps
the rules for a launch hold. "N need you" opens `MefiShell.onInbox(anchor)`
when something set it, then `MefiToday.openInbox(anchor)`, and until one of
them does, Work's own needs-you views (Vibe's drawer for a decision, Command's
Ask rail, the Task board's Review filter).

**The status bar**: the Layout menu button (the list, the inspector and the
tab strip as switches, each mode's widths side by side, Reset layout with
Undo, Size and density, and Worktrees when that page exists), what is running,
what waits on you, the usage meters after a rule (`MefiUsageTracker.brief()`,
the last reading, no new read; the second window in the info blue), and on the
right only what a module has, in the prototype's order: the player pill (opens
the music and video menu), the machine's load ("CPU 34% · Mem 61%", from the
resource watcher's `machine:status` push, rounded, opens the machine status),
today's cost when the ledger has recorded one, and the permission mode. An item
nobody has data for is not drawn, and nothing here polls: it repaints, coalesced
to 60 ms and only while the window is visible, from the pushes the page already
gets (`onTasks`, `onAssistant`, `onAssistantStatus`, `onProjects`,
`onMachineStatus`, which repaints only when the rounded load moved), the events
of the modules it reads and `MefiToday.onChange`.

**Search (Ctrl K)** is the same palette as v1 (renderer/palette.js: the
registry, the keys, Recent per project and "task …" / "idea …" on Enter),
read as the prototype has it: centred under the bar in the free area (like
every layer; the prototype's scrim covers the whole window), 640 px; one line per result (its icon, its name, and on the right its state,
its key or "page" in plain words) under a heading per group, at most twelve
rows, and a footer that shows the keys. Over the empty box: Recent, the six
sessions that matter (this project's tasks as the session list orders and
words them, from the board Home already holds, so no read of its own), the
rail's places with their keys (Home, Work, Agents, Friends, Settings) and the
actions a record marks with `paletteBrowse` (New task, Pause new work, Open
the Inbox, Switch mode). A search reaches every group: Sessions (archived ones
say so), Backlog (the ideas nobody has made a task of), Places, Actions,
Layout and Tabs (what the frame and the strip register, `shell-do-*` and
`tabs-do-*`, each with its key and running what its key runs), Permission mode
(`autonomy-set-*`, the one in force says "current"; `MefiAutonomy.setLevel`),
each section's pages, Models and, in Command, the nodes. A record may say its
group (`paletteGroup`) and its words on the right (`paletteHint`). Close is
gone (the scrim and Escape close it); the result count is still said, for a
screen reader.

**Modes.** Vibe and Build are the modes of one shell (`MefiVibe.mode()`). Each
keeps its own list, inspector and tab strip, and switching applies the other's
in the same turn (no flash, no shift). Build starts with the list (280 px) and
the inspector (388 px) open; Vibe starts with both closed; both keep the tab
strip. The choice is saved in `mefiStudio.shell.layout.v1` as `{ v: 1, build:
{ list: { open, w }, inspector: { open, w }, tabs: { open } }, vibe: {...} }`;
an unreadable or out-of-range value falls back to the mode's preset, and every
storage access is guarded. Reset layout puts this mode's preset back.

**Splitters**: rail | list, list | main and main | inspector. A drag uses
pointer capture; the arrow keys move a column's edge by 8 px (Shift 32), Home
and End go to the narrowest and widest, a double-click resets (list 280,
inspector 388). Each is `role="separator"` with `aria-valuenow`, `-min` and
`-max`, a 1 px line and an 11 px hit area. Limits: list 220 to 420, inspector
320 to 640, and the main area keeps 320 (`MefiNav.layout.MAIN_MIN`), so the
inspector shrinks with the window and is a drawer where it cannot have 320
beside the list. The rail's edge is the rail's own pin (64 or 256 px), and the
frame never writes its width.

**Drawers.** Where `data-layout-fold` names a column, or the inspector cannot
dock, the column is a drawer over the page, under the bar: the bar's toggles
open and close it, Escape, a press outside or going somewhere closes it, focus
moves in and returns, and only one is open at a time. The tab strip and the
status bar stay rows.

**Keys**: Ctrl M the mode, Ctrl B the list, `[` the inspector (not while
typing), and Escape closes the Layout menu or the open drawer (a sheet or the
palette over it has its own Escape first). They are listed in the shortcut
sheet for display; the frame's own listener acts.

**For other modules.** `MefiShell.region(name)` answers the element (null until
the frame is built, and `onChange` hears `enable` when it is);
`MefiShell.mount(region, key, elementOrFactory, { title, order })` puts
content in a region and answers `{ show, hide, unmount, shown, element }` (a
factory runs once, the first time the region exists; a list or inspector with
nothing mounted says "Nothing listed yet" or "Nothing to inspect yet", never
sample data, and an inspector whose mounted panels are all hidden (a page that
is not a session) folds away: no room, no drawer, its toggle disabled with the
reason, `info("inspector").vacant`, and the saved choice kept for the pages that
have something; a mount into `top` or `status` lands in that bar's own slot, between
the trail and the search, or before the player); `MefiShell.resize("tabs", px)`
is how the tab strip says how tall it is; `MefiShell.onInbox = fn(anchor)` is how the Inbox opens from the pill;
`MefiShell.open`, `close`, `toggle`, `isOpen`, `size`, `info`, `setMode`,
`mode`, `status`, `sync`, `pages`, `layout`, `resetLayout`, `onChange` and the
constants `LIMITS`, `DEFAULTS`, `PRESETS`, `REGIONS` and `MODES` complete it.
The window hears `mefi:shell-layout` when a region opens, closes or resizes,
when a drawer opens, when the mode changes, when the page list comes or goes
(`what: "pages"`) and when the frame comes or goes.
Tests: `tests/shell_frame_*.test.mjs` (fake DOM, the contract as a stand-in and
as the real `nav.js`), `tests/shell_render.test.mjs` (a real window at five
sizes).

## The companion

Hover briefly over the companion to open its menu. Leaving its avatar,
panel and connecting margin closes it after about 280 ms. Nested dropdowns
belong to that interaction area; keyboard use and active text editing keep
it open. Touch/click activation, Escape and outside dismissal also work.
Talk, Needs you, Now and Settings resize one stable panel, so live updates do
not replace focused controls or unfinished answers. Now joins what used to be
Team and Activity; Settings holds Personality, the work controls, what it has
learned and a row of shortcuts. The older tab names still open their new
home (`showTab("team")` opens Now).

The companion can roam along unobstructed edges, return to its dock, or be
dragged and pinned. It pauses when approached or used, honors reduced motion,
and suspends animation while hidden. Its settings reuse the same admission,
queue and proactive controls as Agents. Personality, look, faces, idle play,
bubbles, project reach, position and the bond persist in the app-wide
`companion.json`.

Three small lights mark evidence-backed project growth: mapped systems,
workflows with verified success, and observed owner preferences. Settings ›
What I've learned explains these sources. Growth never enables behavior, changes permission or
answers a question for the owner. The actionable needs-you queue and
welcome-back digest remain available.

## Verification

`tests/agent_profiles.test.mjs` exercises independent copies, stale revisions,
capability validation, scoped writes and real resumed worker dispatch.
`tests/agent_brain_host.test.mjs` covers companion persistence and project
learning. `tests/unified_studio_render.test.mjs` launches an isolated Electron
fixture with synthetic bridge responses, blocked network and child execution,
four window sizes, zoom and appearance coverage, real hover input, long
dropdowns, keyboard and held overflow arrows, dragging/pinning, visibility,
project isolation and draft retention. No live project data or
credentials are used. Screenshots can be retained with
`MEFI_UNIFIED_CAPTURE_DIR` pointing to a directory outside the repository.

The layout contract has three suites. `tests/layout_contract_nav.test.mjs`
pins the layout writer, the launch choice, the clamps and `usable()` against
a fake document. `tests/layout_contract_css.test.mjs` evaluates every
declaration that moved onto the derived edges, with the regions at 0 (it must
equal what it was) and at the sample sizes (it must move by exactly the
region). `tests/layout_contract_render.test.mjs` launches an Electron fixture
that measures the rail, the local navigation and every registered destination
in four window sizes, Build and Vibe, the menu closed and pinned: v1 must
reproduce `tests/fixtures/layout-contract-v1.json`, and v2 with fixture-only
boxes for the four regions (list 280, inspector 400, tab strip 36, status bar
28) must keep every page clear of them and inside the window. Screenshots can
be retained with `MEFI_LAYOUT_CAPTURE_DIR`.
