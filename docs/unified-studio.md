# Unified Studio

Studio has three main places: **Home** for conversation and task actions,
**Work** for Tasks, Plans, Ideas and Analyzer, and **Agents** for the team and
its work. Settings keeps personal appearance, audio and system preferences;
Help keeps onboarding and shortcuts. Existing destination IDs and keyboard
shortcuts still resolve through the navigation registry.

## Agents

| Section | What belongs here |
| --- | --- |
| Overview | Readiness, active team, running work, decisions, start/pause controls |
| Setup | Device connections, teams and presets, model routing, workflow behavior |
| Live | Command, Pipelines, Sessions, Activity and Overhead |
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
Density, glass and glow are independent adjustments; color themes, node
looks and existing motion preferences remain available. Full, Calm, Off and
OS reduced motion are respected. Narrow Agents navigation uses labeled menus.
Short windows compact the rail's utility controls to keep Home, Work and
Agents visible even at increased display scaling.

The colour theme supplies a display face and a pair of gradient colours. Gold,
Forest, Ember, Rose and Eclipse use serif headings; Aurora, Midnight, Violet
and the other Void themes use sans-serif headings. Body text stays in the
system UI family and technical labels use a local monospace font. All fonts
have offline fallbacks. Pages reveal a shared backdrop; cards, fields, sticky
headers and popovers use progressively stronger glass fills. Inactive Home
and Command controls are hidden behind workspace pages so text does not bleed
through. Blur off retains a translucent tint with greater opacity; OS reduced
transparency uses solid surfaces. Custom palettes retain their chosen colours,
with a safe reading background when canvas and panel tones differ.

## The companion

Hover briefly over the companion to open its menu. Leaving its avatar,
panel and connecting margin closes it after about 280 ms. Nested dropdowns
belong to that interaction area; keyboard use and active text editing keep
it open. Touch/click activation, Escape and outside dismissal also work.
Ask, Status, Team, Activity, Learned and Settings resize one stable panel, so live
updates do not replace focused controls or unfinished answers.

The companion can roam along unobstructed edges, return to its dock, or be
dragged and pinned. It pauses when approached or used, honors reduced motion,
and suspends animation while hidden. Its settings reuse the same admission,
queue and proactive controls as Agents. Look, bubbles, project reach and
position preferences persist locally.

Three small lights mark evidence-backed project growth: mapped systems,
workflows with verified success, and observed owner preferences. Learned
explains these sources. Growth never enables behavior, changes permission or
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
