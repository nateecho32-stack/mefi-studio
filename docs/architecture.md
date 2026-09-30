# How Studio is put together

First-time setup can install a missing coding CLI, open its sign-in and check
its connection. A single Codex, Claude Code, Grok or Antigravity subscription
can serve the assistant, first map, planning, agent roles and coding workers.
First map offers connection recovery in place and can use the local project
scan through the selected provider without OpenCode. Scan and First map also
offer **I have an API key or a local model server**: the guide walks to
Connections and, once a usable key is saved (or you choose **Back to the
scan**), scans again so **Use this setup** can map with that route. In Vibe
mode the Create and Review walks use Vibe's own box and Tasks panel. See
[Guided CLI setup](cli-setup.md) for configuration scope, account limits and
the text-session controls.

Home and Vibe composers accept dropped text/code files and an **Add files**
picker. Plans supports the same imports in the outcome, interview answer,
evidence and specification fields. Contents are inserted as labelled, editable
text in the draft; review or remove them before sending or saving. Each import
accepts up to eight UTF-8 files, 128 KB per file, within the destination field's
character limit. Unsupported formats (including PDFs, images and folders),
binary files and files that do not fit are reported without silently truncating
them. A drop never sends a message or approves a plan.

Plans remembers the selected plan (including a new unsaved draft) separately
for each project, restores the viewed stage when its workflow has not advanced,
and offers **Continue where you left off** to focus it. Saved decisions,
interview answers, drafts and task handoffs remain in their existing stores.
Vibe also saves an independent composer draft per project. Planning replies
read fresh, bounded project excerpts plus README/build/architecture context,
with private paths excluded and credentials redacted. Exact file mentions
receive priority. Earlier human answers remain available on resumed interviews;
over-budget context is refused rather than silently dropping requirements.

Agent setup now exposes per-role web search, web page reads, project reads
and MCP tool allowlists beside selected skills. **Read web pages you link**
(`web_read`, on by default) lets chat, Vibe sizing, Plans and the other roles
read a page you paste or a search found: public `http`/`https` addresses
only, local and private ones refused, 15 seconds and 512 KB per read, and a
long page in parts. The host executes bounded research turns
for model calls; OpenCode and Claude builders receive the same tools through
MCP. Where a role may read project files, Studio's own models can also list a
folder and search the project's text files (`project_list`, `project_search`,
`scripts/project-search.cjs` with the rules in `scripts/project-ignore.cjs`):
read-only, no shell, honouring `.gitignore`, never following links, never
returning hidden or private files, and each answer under 10,000 characters;
coding CLIs have their own file tools and are never offered these two, and
`MEFI_STUDIO_NO_PROJECT_SEARCH=1` removes them. A reply's tool request is never
shown as its answer. See
[Agent tools](agent-tools.md) for setup, execution limits and the
distinction between Studio permissions and native coding CLI access.

The detailed feature walkthrough that used to live in the README. It is
written in Studio's own vocabulary, so start with the glossary. For first
steps read [GETTING_STARTED.md](../GETTING_STARTED.md); for the code-level
walk through the agent loop read [agent-loop.md](agent-loop.md).

The current navigation, configuration scope and companion behavior are described in [Unified Studio](unified-studio.md). Home, Work and Agents own the main workflow; Friends gives direct access to Rooms, Your PCs and Playground in the companion's existing menu. Agent setup is no longer spread across Settings, Command and Seats.

Short dropdowns arrange their choices in two or three columns, with a check
on the saved value and headings for option groups. Long labels and large
lists use bounded rows with search. Arrow keys follow the tile layout;
Home/End jump to the first/last enabled option, Enter selects, and Escape
returns focus. Appearance uses small preset previews, theme swatches and
compact node/effect grids, with a shorter header in narrow windows.
Scroll-arrow refreshes measure all regions before updating their hints,
so live activity does not recalculate styles once per overflow panel.
Command's View and Ambience menus, Brain map actions and Tools menus group
related actions side by side while keeping their labels and shortcuts.

Studio's pages share a continuous, theme-coloured backdrop with translucent
reading panels, two-colour gradients and distinct heading fonts. Home keeps
its writing desk, Agents uses compact technical rows, and Settings uses grouped
preference cards. Floating menus and sticky headers have a stronger glass tint
to keep overlapping content readable. Focus, Studio and Atmosphere adjust the
surface depth and corners; Glass and Glow remain independent controls.
Zero Glass intensity makes reading surfaces solid. Background video adds a
stronger tint beneath page text, menus and navigation, including Home and
Vibe. Appearance changes retain the playing media element. Agent settings
respond to their panel width; narrow Tools menus fit within the action row.
The sticky Settings categories clear the fixed local navigation and use a
dense fill so scrolled content cannot show through their labels.
Panel edges catch a soft highlight above a diffuse shadow. Command's toolbar
and side panel each use one frosted outer surface, with lighter inset work
cards, a recessed tab strip and compact status tiles. Search and task entry
share the toolbar glass; sticky section headings keep a denser reading surface.
Turning blur off strengthens the tint, and the OS reduced-transparency preference
uses solid surfaces. Custom palettes preserve their saved colours and exact canvas
background while protecting contrast in reading areas and action buttons.

Agents › Setup › Team & models uses short, theme-tinted rows with the role,
model, grouped settings and provider icon alongside each other on desktop.
The setup controls stay together in a bounded-width list. On narrow windows
the controls wrap beneath the model. The model is on the
left, effort and fast mode are on the right, and the corner provider icon
opens all supported connections. Model menus include saved IDs and can fetch
the provider's current roster; an explicit model ID remains available when a
roster cannot be loaded. Coding workers have their own CLI and build tier.
The left **+** adds installed local skills to that agent and exposes the Studio
desk MCP tool for OpenCode and Claude Code workers. Text-only assistant seats
do not execute MCP tools. Other MCP servers remain in the coding CLI's own
configuration. Changes use the existing project/default scope and Apply flow.

Saving an AI route, applying an agent team, or changing a provider credential
releases any retry backoff from the previous connection. A running service can
then retry using the saved configuration; a paused service stays paused. The
offline warning and last error remain until a successful AI reply confirms
recovery. Provider quota limits still belong to the provider account.

## Permission modes

The composer chip, Vibe Settings, companion Settings, Agents Overview and
the permission-mode palette action edit the same global policy. Vibe's
Decided for you panel explains choices and exposes Undo plus the For you
list. Suggestions highlight an offered answer; one-line options focus a
text field. Offers and Yes/No confirmations also work inside the conversation.
Model strengths appear in Agents routing and as one line in Vibe's Team.

The global `settings.autonomy` stores a mode and six elevated switches. Always
ask computes a suggestion; Accept per task delegates worker questions only
within an accepted scope; Auto starts queued tasks, including agent proposals,
and resolves ordinary questions at confidence 0.7 or above; Elevated only
uses the offered conservative recommendation when uncertain. Owner holds and
desk escalations always stay with the owner. An ask only the owner can answer
(a merge, a push, a login, a physical step) is never closed automatically:
the desk is not offered *Leave it for review* on it, an automatic answer that
would close it leaves it open in Needs you with the desk's note, and only the
owner's own click dismisses it. A dismissal records who closed the ask.
Grants, irreversible changes,
closing owner-created work, agent-filed work, heavier models and human to-dos
have individual switches, all enabled initially. The agent-filed switch applies
in Elevated only; Auto includes that work without a separate go-ahead. Disabling the first two
requires acknowledging their warning. A human to-do is filed, not performed.

Build approval is checked in queue summaries, selection, claiming and the last
launch check. Accepted split and delegation children inherit their parent's
approval within the same project. The old desk switch aliases Auto/Always ask,
and the old new-work switch also updates the mode. Existing saved
`autoBuild:false` preferences migrate to Always ask.

Routine test failures, concurrent edits and test-history archive conflicts
stay with Studio as repair work, even if a worker labels them owner-only.
Open legacy repair questions regain retry options; dismissed answers and Undo
remain respected. Missing verification evidence prevents confirmation but
allows a bounded repair or rerun in Auto. Such unfinished repairs cannot pass
verification by being reported under `owner:`. Workers preserve other sessions'
edits and use the repository's documented history tools; Studio owns board updates.

`assistantState.decisions` keeps 300 automatic choices with reasons, confidence
and task snapshots. A task reservation prevents dispatch until the ledger save
finishes; a task-side proof recovers an interrupted save. Undo reopens the ask
and restores fields still bearing that decision's values. It waits for workers,
keeps later edits and does not refund daily retry budgets. `assistantState.todos`
keeps at most 50 For you items. One edited notice each reports Needs you and
Decided for you, using the companion queue's count. Sessionless CLI completion
needs named, recorded passing checks tied to the exact attempt, no outstanding
work, and a successful exit; model claims alone cannot confirm it.

## Learning

`settings.learning.decisions` controls whether owner answers teach Mefi and
which scope the decision prompt uses: this project, all projects, or blend.
The shared companion file keeps up to 1000 bounded rows with project, source,
work kind and correction metadata. Recency has a 90-day half-life; corrections
weigh twice. Blend gives this project's choices full weight and other choices
0.3 weight. Strong patterns (share at least 0.7 and four observations) can
increase matching confidence; disagreement in Auto leaves a suggestion.
Automatic decisions never become examples of owner preferences. Undo records
an explicit correction. Forget operates on a kind/verb row or all history,
within the selected project or globally. Disabling learning preserves history
but stops both new recording and preference use.

`settings.learning.models` is `blend`, `project`, `global` or `off`. Worker
attempts and model calls carry a project ID. Routing reads the existing local
ledgers for saved projects and the legacy ledger; it never moves those files.
Rows without an ID count only as global evidence. Blended outcome counts use
`wins = projectWins + 0.3 * otherWins` and the equivalent for losses, with a
Beta(1,1) prior. Project filters are part of the snapshot cache key. The
`learning:state`, `learning:set` and `learning:forget` IPCs expose preferences,
settings and per-model work-kind summaries for the shared controls.

## Glossary

| Term | Meaning |
| --- | --- |
| **Menu** (the rail) | New task and Search sit above **Home**, **Work**, **Agents** and **Friends**, with one local row for the current group's views. Friends and its Rooms, Your PCs and Playground links open the existing companion menu at the matching card; Search finds them too. Recent tasks belong to the current project; Settings and Help stay at the foot. Help contains Start here, Shortcuts and Community. The project selector at the top opens the project panel. The registry in `renderer/nav.js` preserves existing shortcuts and destination IDs. |
| **Layout contract** | The room the shell keeps for a session list, an inspector, a tab strip and a status bar that are not built yet: four `--shell-*` sizes (all 0), four derived edges the pages read, `html[data-layout="v2"]` to turn them on, one setter (`MefiNav.layout.set`) and one free-area rectangle (`MefiNav.usable()`). See `docs/unified-studio.md`. |
| **Today** | Vibe's Home in the 0.5 layout (`html[data-layout="v2"]`, `renderer/today.js`): the greeting and the box that builds or talks, then one line per session in four groups, **Needs you**, **Running**, **Review** and **Done today**. In Build the same board is a page, reached from its pinned tab. See Getting around. |
| **Inbox** | Everything that waits on the owner in one list (`MefiToday.openInbox`): open questions and permissions, approvals, finished work to check and tasks that stopped. "N need you" is the digest the app already keeps (`assistantState.needsYou`, the list the taskbar count is read from), never a second counter. It opens as a popover under the top bar's pill (Ctrl J) or stays open as a page. See Getting around. |
| **Frame (layout v2)** | What `renderer/shell.js` (`window.MefiShell`) draws in the contract's room when the 0.5 layout is on: a top bar (list toggle, Vibe and Build switch, where you are, Search, "N need you", "N working", inspector toggle), the list and inspector columns with splitters and, in a small window, drawers, the tab strip's row, `main` for other modules' pages, and a status bar with the Layout menu. Vibe and Build each keep their own widths. Turned on in Settings ("Try the 0.5 layout"), in Search ("Switch layout"), by `?layout=v2` or by `MEFI_STUDIO_LAYOUT=v2`. See `docs/unified-studio.md`. |
| **Worktree** | Another folder holding the same project on its own branch, so two pieces of work never share files. Task runs make one each (`.mefi/worktrees/<runId>` on `mefi/<runId>`) while "Give each run its own worktree" is on; **Work › Worktrees** lists them all and merges or removes them. |
| **Attempt review** | What Studio keeps around each builder attempt: a **picture** of the folder at its start and end (private git refs, only on this PC), the list of **changed files** with Accept and Revert, the **advisory checks** that ran after it and **before and after shots** of the project preview. It is the "Changes and checks" section of a task's Evidence tab. |
| **Workspace** | The home screen (`H`): current task, app preview and conversation. Project queue, Studio status and setup information expand when needed. |
| **Command view** | The 3D node tree (`D`): sessions, tasks and agents as orbs, with a right panel for Work, Assistant, Runs and Ask, and agent settings in the top toolbar. |
| **Booklet** | Historically the single-file model catalog; today `renderer/booklet.html` is the whole app bundled into one file by `npm run build-booklet`. The **Model catalog** tab (`1`) is the part that kept the name. |
| **Model Lab** | The previous name for Models' **Performance**, **Usage** and **Context** views. Shortcut `2` opens Performance. Usage keeps recorded calls separate from provider account readings. Catalog insights contains published benchmark charts. |
| **Activity & evidence** (A-Eyes) | Tab `3`: a read-only view of the OpenCode session store: change feed, diffs, screenshots with pins, log tail. The "eyes worker" is the thread that reads that store. |
| **Settings** | `4` or `Ctrl ,`: four single-pane categories, **General**, **Appearance**, **Audio** and **System**. Providers, routing and run behavior moved to **Agents › Setup** (Team & models, Providers, Routing & fallback, Run behavior); the old Connections, Models and Automation links redirect there. Search finds individual controls and opens their category and containing disclosures. `MefiNav.go("studio", { category: "appearance" })` opens a category; legacy section links such as `settings-updates` still work. |
| **Preferences** | General holds names and startup. Appearance holds themes, motion, blur, node styles and canvas effects; Audio links to the music dropdown and holds sound effects. Older Preferences and Your Studio links resolve to General. |
| **Size and density** | The 0.5 layout's four size settings on one page, with a live miniature of the window beside the controls: **interface scale** (the window's zoom), **text size**, **density** (Compact, Comfortable, Spacious) and **detail** (Titles, Titles and status, Everything). Only in `html[data-layout="v2"]`; components size themselves with `--text-scale`, `--d-*` and `--dt-*`, and `window.MefiSize` is the model. See "Size and density (layout v2)" under Workspace and work. |
| **Diagnostics** | Settings › System: speed probe, profiler, auditor, machine tools, connection log and Report a problem. Auditor and machine links reveal Sessions' Diagnostics panel. |
| **Notifications** | Settings › General: Windows alerts for what waits on you (only while Studio is not in front), the taskbar flash and count, and quiet hours shared with the Discord remote. |
| **Search Studio** | The palette (`Ctrl K`), once called Key commands. It finds any page, tool, Settings card, action, task, node or model by familiar terms, and groups its results by menu section. Empty, it lists what you last opened (**Recent**); `task …` or `idea …` adds one on Enter. |
| **Help** | The menu-foot popover containing onboarding, shortcuts and Community. These destinations are also available through Search; late-registered Community remains supported by the navigation registry. |
| **Task** | One unit of work on the project board, with a brief, acceptance checks, prerequisites, attempts and evidence. New cards gather local references automatically when Automatic references is on; the configurable scout can use GPT-6 Luna on the fast tier to choose one verified starting file. |
| **Idea** | A note in the feature-idea inbox; it becomes a task only when you or **Work through backlog** promote it. One you typed yourself (Search's `idea …`) reads **From you**. |
| **Plan** | A structured route from an unclear idea to tasks: unknowns, decisions, a specification you approve, then tasks. |
| **Recently deleted** | The list of tasks and ideas you deleted in this project, kept 30 days (at most 50, oldest dropped first). Each keeps its whole record and its place, so it comes back as it was, never over a card that is there again. |
| **Session** | One coding-worker run recorded in the OpenCode store. Tasks map to sessions in **Overhead**. A session another one spawned (its `parentId`) is a **sub-agent session**: the tree and the Command view hang the newest three busy in the last six hours under their parent, count the rest as "+n sub-agents", and fly each home into its parent when it leaves; they are not counted as sessions. |
| **Builder / coding worker** | The CLI that edits your files: `opencode` (preferred), `claude`, `codex`, `grok` or `agy`. |
| **Agent roles** | The service loop's satellites: **watcher** (stale sessions), **machine** (CPU, memory, leases), **auditor** (findings), **keeper** (pruning), **thinker** (what next), **briefer** (summaries), **responder** (chat), **foreman** (hands out work), **compactor** (context), **overseer** (reviews the loop), **scout** (finds task context). Agents share work state and messages in the Agents work hub. |
| **Agent mail** | Notes the roles write to each other; shown on the assistant card under **Said to each other** and as packets on the tree. |
| **Decision model / Jev** | Agents › Setup › Connections configures Jev, a third-party classifier model (TypeSafe's `jev-1.13`). Routing and intake behavior live together in Agents › Setup. Optional; fixed defaults apply without it. |
| **Autopilot / New work** | Autopilot lets the assistant start work on its own; **New work** is the master switch that holds every kind of new start while current workers finish. |
| **Auto build / Verify first** | Compatibility controls for permission modes: enabling Auto build selects Auto; disabling it selects Always ask. Elevated categories still apply. |
| **Learned preference** | A recency-weighted pattern in owner answers, scoped to a project, all projects or their blend. It advises the assistant without expanding its permissions. |
| **Model skill** | A model's runner-verified wins and losses for a kind of work, with project-aware probability estimates. |
| **Permission mode** | The saved rule for which decisions Mefi can make: Always ask, Accept per task, Auto or Elevated only. Elevated switches reserve particular categories for the owner. |
| **Decision ledger** | The project's saved automatic choices, reasons and Undo evidence. Undo preserves later edits and does not reset budgets. |
| **For you** | Up to 50 human-only to-dos separated from worker questions. |
| **Delegated decision** | An answer Mefi gives for you, attributed as **Mefi decided**. A retry preserves your stop, loop guard, loop history, duplicate link and approval. Its two-per-task daily budget survives restarts. |
| **Swarm / Cluster** | Agent mode: Swarm spreads workers across the queue, Cluster keeps them on one goal at a time. |
| **Awaiting verification** | A finished attempt whose completion is not yet established; housekeeping checks the evidence before it becomes **Done**. |
| **Work done outside Studio** | What changed in the open folder while Studio was closed, on another folder or hidden: commits, uncommitted edits and Claude Code, Codex or OpenCode sessions, compared with Studio's **last look** at the folder. The thread, the chat assistant (even without a model) and the welcome-back digest report it, and when the code changed every queued card is **checked** against it before a worker takes it: still needed, partly done (its worker is told what changed), or already done / no longer needed, which waits for your answer on an Ask card. See [agent-loop.md §14](agent-loop.md#14-work-done-outside-studio). |
| **Agent brain** | The Live view (`J`) that draws a task's **pipeline** from recorded **work events**: the head (the companion), the lead, the steps and the sub-agents; plus the **Playbook** of recipes and **project map** under Agents › Workflows. The seats live under Agents › Setup. See [roadmap-0.4.0.md](roadmap-0.4.0.md) and [agent-loop.md §13](agent-loop.md#13-the-agent-brain). |
| **Fleet / seat / pod / generation** | Live › Fleet (OpenRig's vocabulary, built natively): a **seat** is one agent's stable address on the team (`builder-2@project`), a **generation** is one run it took, and seats sit in four **pods** (Lead, Build, Check, Keep) wired by handoffs, checks and asks. A retry returns to the seat that last worked the task. |
| **Companion** | The roaming character (named under General): click it to talk, see what it and the team are doing, handle its needs-you queue, suggest work or take its picks, meet friends' companions, or set its personality (Straight work, Balanced, Friendly & expressive). It also gives a welcome-back digest, can be petted, and covers this project or all of them. Its default model is GPT-6 Luna on Zen at medium reasoning and fast service when Zen is connected. |
| **Orb, callout, absorb** | Command-view vocabulary: an orb is a node, a callout is its floating card, and absorb is a finished node collapsing into its host. |
| **Node style / `MefiNodeStyles`** | How a node is drawn: one of eight looks (five classic, three in the two-tone Void collection), painted on both the Command view and the tree rail by `renderer/node-styles.js`. Each look owns its body and may take over the agent ring, hub dress, work orbit, arrival, selection, the finish beats (`done` at a step whose work came back, `absorb` at the lead taking an agent in), wires, pulses and landing; per-node motion records keep every node animating, and reduced motion freezes each look to a still pose. |
| **Ruins Runner** | The author's LÖVE game, an optional external project Studio can launch. A fresh clone works without it. |
| **Discord Server Styler** | An optional separate bot and local dashboard. Settings can start it, open its dashboard or folder, show its status and stop a process Studio started. |
| **Void collection** | Four two-tone themes (Void, Eclipse, Abyss, Neon Dusk) and three node styles (Singularity, Prism, Sigil), free for everyone like every other look. Settings › Appearance lists them under their own small heading, and a choice saves like any other. A theme with a second hue sets `data-studio-theme-tier="duo"`, which the stylesheets paint with. |
| **Community link** | An optional Discord login (Settings › Community, which **Community** at the menu foot opens) for Listen together and the rooms hub; it unlocks nothing. It lets Studio read your membership and roles in the Void Engine server: when you link, then every seven days (after a failed check, in an hour, six hours, then daily) and whenever you press **Check now**. The data is kept in `settings.community`, and the refresh token is encrypted in `community-auth.json`. |

## Highlights

| Capability | What it does |
| --- | --- |
| **Assistant that keeps working** | An always-on service loop ticks in the main process — organising, auditing, fixing, tidying and briefing — whether or not a window is open. |
| **Visible agent loop** | Watcher, machine, auditor, keeper, thinker, briefer and responder roles run as satellites around the assistant node and report their findings home. |
| **Planning that becomes work** | Plans settle unknowns and decisions into a specification, then explicitly create board tasks with acceptance checks. |
| **Verified results** | "The run said done" is not done: attempts settle to `awaiting_verification` with evidence attached, and housekeeping verifies them. |
| **Model Lab** | Measured latency, throughput, errors and reported cost per project, with unknown values left unknown. |
| **Live update** | Studio watches its own source tree and restyles, hot-swaps modules, or reloads with full UI state restored. |

## What's inside

### Getting around

- Studio has two modes, switched at the top of Vibe, from the foot of Vibe's
  rail, or with **Switch to Build** in Search. **Vibe** is the calm front
  door: one box to talk it over with Mefi or build it as a task, cards for
  what needs you, what is building, what just finished and fresh ideas, and a
  dock. **Build** is the full studio described below. The choice is
  remembered during updates. New launches start in Vibe unless **Always
  start in Vibe** is turned off in Settings.
- Vibe shows only what has something to say. A card appears while it has
  rows (Freshly done covers what finished in the last half day, by when it
  finished, and never work you dropped) and a quiet project gets one
  calm line instead of empty boxes. The dock always has Tasks, Team and More;
  Watch is always available, Plans steps in while a plan is in play, Ideas while
  fresh ones wait. With cards up on a short window the greeting and the
  starter chips step aside.
- First-time key tips show beside controls and fade after their key or the
  tip is pressed. Settings can turn them off or show them again. Vibe's
  Needs you drawer also handles plan interview questions and results waiting
  for a slow check; its top bar mirrors a waiting app update.
- Vibe's menus are its own (`renderer/vibe-panels.js`): Tasks, Plans, Ideas,
  Team and Settings open as a compact panel beside the front door, one side
  panel at a time with the conversation and the decision drawer, and a wide
  window moves the cards over to make room. Rows open their detail (Back or
  **Esc** steps out); each action uses the host call its Build page uses: a
  task can be started, stopped, dropped or given a note for its next attempt
  (its saved notes reach the worker's brief), a finished one sent back with
  **Ask for a change** (a follow-up naming the task, added under the draft
  already in the box with the caret where the change goes; the finished task
  stays as it is), an idea built, kept or dismissed. Team shows who is
  building and each seat's model, with Start, Resume or Pause. **Full view**
  opens the Build page for the same thing inside Vibe's rail. The status pill
  opens what it names, and a decision toast answers in Vibe's drawer.
- **Build it** sizes the request (`main.cjs` `vibeBuild`,
  `scripts/request-sizing.cjs`). A short single change is one card at once; a
  bigger one gets one call to the lead seat, which may answer with two to six
  steps. They are admitted under the owner's card in the same board write
  (`task-delegation.cjs` `admitIntake`) as its delegated slices, with the
  owner's origin, so each step gets the slice brief and the prerequisite gate,
  and the card waits for them and runs last as the integration and check.
  Vibe's **Plan in flight** card and the Plans panel follow the steps; when
  permission settings require approval, waiting steps are one Needs you row, started together
  with their reviewed scopes, and **Make it one task** (two presses) drops the
  unstarted steps so the card runs whole. Anything that cannot be sized keeps
  it one card, and the strip says why (the lead took too long, no lead model
  answered, the plan had too many steps) rather than that the lead chose one
  task.
- **MEFI — Modify, Experiment, Fix, Improve** gives Vibe four starting points
  for evolving the open project, including Studio itself when its repository
  is selected. Pick an approach, describe the change, then talk it over or
  **Build it**. The approach and selected map area stay with that project's
  draft. **Suggest a next step** reads project context through the planner and
  returns suggestions with reasons and file references. **Add to draft**
  appends an editable brief, and the rest of the set stays usable; **Save
  idea** keeps a note in the Ideas tree; **Clear** puts the set away. A new
  direction typed over the draft makes the set read-only until it is asked
  again. Asking for or saving suggestions does not queue work. The existing
  Build action and permission settings still control execution.
- Vibe's long waits are live (`renderer/vibe-flow.js`). **Suggest a next
  step** and Build it's sizing each show a strip: its stages (Read the
  project, Think it over, Suggest next steps; Take a look, Plan the steps, Put
  it on the board), the files read or the steps planned as they arrive, which
  model is thinking, and a clock against this machine's usual time. The page
  names each request it starts, and the host pushes each step on
  `vibe:progress` (`main.cjs` `vibeProgress`, the planning service's
  `onProgress`); a stage lights up only when the host reports it, and only
  the clock and the usual time are this machine's own. A sizing that answers
  within a blink never shows its strip. New app shows its first
  build's sizing in its panel, and Team lists these runs under **Thinking
  now**.
- The agent team on a split request: the **Plan in flight** card draws the
  steps as a track that ends in the final check, with a line naming the step
  being built, its worker's tool and what it is doing now; **Building now**
  rows carry the same live line and a **Stop** that asks twice (the Tasks
  panel's per-task stop: progress is kept and the card waits under Needs
  you). The Plans panel's plan view is a timeline
  with who is on each step and which step each waiting one waits for. **Make
  it one task** there is the same single host transaction as the drawer's.
- **New app** (the + beside Vibe's project picker, `projects:create`) makes an
  empty folder under `~/Mefi Apps` (never inside Studio's own repository),
  starts git and a README in it, opens it as the project and sends the
  description through Build it.
- Vibe's **Tasks** panel switches between List and Lanes. The lanes show
  Needs you, Ready, Building, Checking, Later and Done, with live counts;
  questions stay above the board. Queue controls pause new work, resume agents
  and choose Automatic capacity or a manual worker limit. Running jobs finish
  when the limit is lowered or the queue is paused.
- Each task's **Inspector** saves priority, estimated minutes, **Done when**
  checks and a local **Defer until** date. Priority orders work within its
  existing scheduling band; explicit run-next pins keep precedence. Deferred
  tasks stay out of dispatch until the date expires or **Return to queue**
  clears it, after which dependencies and approval still apply. Estimates are
  planning notes, not timeouts. Acceptance checks reach the builder and changing
  them requires fresh build approval. Running, checking and finished tasks are
  read only. Unsaved details survive live updates and failed saves, and stale
  conflicting edits are refused by the host.
- Nothing you click in Vibe mode leaves it. Every other page, whether opened
  from Full view, Watch, Search, a key, the companion or a link inside
  another page, opens inside Vibe's own narrow rail instead of Build's menu:
  the spark at its top returns to Vibe, and the Build switch at its foot is
  the only way out of the mode. Home is Vibe, so **H**, every Home button and
  a restored session land there. Leaving Command goes back to the page it was
  opened from, and **Back** on a Work page with nothing behind it returns to
  Vibe. Build's classic-tabs choice is kept for Build; Vibe always uses its rail.
- **Answer** on a decision under Needs you opens it beside Vibe: what is asked,
  the task it blocks, the last lines the agent saw, and its options with the
  recommended one first, or a box for your own words. An answer goes through
  the same call as Command's Ask tab, then the drawer moves to the next
  decision or closes. **Open in Watch** shows the decision in Command instead.
- **Today and the Inbox** (0.5 layout only; `renderer/today.js` and
  `today.css`; with `html[data-layout="v2"]` absent nothing of it renders,
  listens, polls or calls the host). Today is a second reader of the picture
  `renderer/vibe.js` already keeps (`MefiVibe.data()` and `watch()`), so the front
  door, its panels and the board never disagree. In Vibe it moves the front
  door's own greeting, box, starting points and notices into its page (they
  are put back when it stops, so Build it, Suggest a next step and the drafts
  keep going through Vibe's code) and draws under them one line per session:
  **Needs you** (the digest), **Running**, **Review** (work being checked and
  plans waiting on you) and **Done today**, each line as much as
  `html[data-detail]` says (titles, plus status, everything). A line opens its
  session (`MefiTabs.open` when there is a tab strip, else `MefiNav.go`); a
  question answers on its line with its first two options. The live node tree
  stays behind it. In Build the same board is the **Today** page (registry
  route `today`, hidden in Vibe where it is the front door).
  The **Inbox** lists each thing with what it is, which task it comes from and
  how long it has waited, the options the app offers (a permission is a
  question; the safe answer is first), a free answer and **Decide later**
  (this session only: it goes last and still counts). Every action calls what
  the rest of the app calls (`assistant:answer`, `backlog:control`,
  `tasks:action`), is refused while in flight and after it landed, and leaves a
  **Decided** line with an **Undo** only where the app has a way back (a drop
  or a done reopens; Mefi's own decisions undo through `autonomy:undo`, from the
  footer). The popover is anchored to the pill (`openInbox(anchor)`; upward from
  a bar at the foot), holds the keyboard while it is open (J and K, digits,
  Enter, Esc; Studio's and Vibe's one-key shortcuts stay out of it) and is also
  a page (route `inbox`). `MefiToday.count()` and `onChange()` are what the
  pill reads. A click on a Windows notification lands on the task, or on the
  Inbox when several were told (`alerts:open` carries `count`, `alerts.js` asks
  `MefiToday.openFromAlert`). Nothing is stored.
- Vibe can run on its own. When something holds every agent back, a banner
  under the box names it and carries its fix: **Start agents** after a launch
  that left them off (the launch screen's Open with Start agents off), **Resume** when new
  work is paused, **Try now** during a worker-start cooldown, **Restart
  Studio** when the scheduler is stuck, **Open a project** with none open,
  **Connect an AI** when none is connected. The banner, Home's Service tile,
  the Command header and each ready task read the same loop status
  (`scripts/loop-status.cjs`), so they never disagree about whether agents
  are on. **Build it** says
  when its task will wait for that. Needs you lists only what cannot move
  without you, one row each: decisions, builds waiting for your go-ahead under
  the permission settings (the drawer shows the brief, approves its reviewed
  scope, and links to those settings), and stuck tasks (the drawer shows why and
  offers Try again, Resume or Run anyway, It's done and Drop it, the last two
  asking twice). Work the checker is still verifying sits under Building now
  as "checking its work"; a check still running after half an hour is listed
  under Needs you as **Still checking**: the check has run longer than usual,
  and you can look at the checks or mark it done if you checked it yourself.
  Every action uses the host call its Build surface uses, and the drawer moves
  forward to the next thing waiting. `MefiVibe.snapshot()` reads the same state
  (what holds the agents, what needs you, what is building) for tests and
  automation.
- In Vibe mode every menu takes Vibe's look (rounder, denser glass, an accent
  rim, pill selection): Search, Shortcuts, the project panel, the section bar
  and its hover menus, Command's pop-overs, dropdowns and toasts. Search and
  Shortcuts list Home once, as **Vibe** on `H`. Settings › General has a
  **Studio mode** switch that changes mode in place, and the launch switch
  there reads **Open Vibe on launch** (off opens Watch).
- Click the companion or press **Escape** on a workspace page to open its
  compact bubble menu over the current view. The center returns to Studio;
  six bubbles each do one job: **Talk** (chat, with What are you doing? /
  What's next? / Recap today one tap away), **What I'm doing** (what is being
  built, the team and what they told each other, and recent activity),
  **Needs you** (the queue, with its count), **Suggest work**, **Friends** and
  **Personality** (how it behaves, run controls, what it has learned, and the
  shortcuts Quick actions used to hold). Inside the menu the bubbles are the
  navigation, so the panel's own tabs are hidden. Escape first closes a
  nested picker or returns from a bubble, then closes the menu. Opening the
  menu keeps agents on their current run settings. The bubbles follow an
  already connected audio link, respect motion and transparency preferences,
  and never start capture.
- **Suggest work** takes the owner's idea into the inbox as their own request
  (the inbox's own add), and lists the companion's next picks from the backlog,
  each one **Work on it** away. Nothing starts on its own.
- **Personality** is Straight work, Balanced (the default) or Friendly &
  expressive (`scripts/companion-pet.cjs`). Choosing one sets its switches:
  little faces and reactions, idle play, roaming. Each switch can be changed
  afterwards, and the owner's own choice wins over a later preset. Every chat
  box's message carries it as `ui.personality`, so replies are terse, warm or
  playful; it never changes what the companion may do. Without faces a
  finished reply shows a plain check. With idle play on, the orb does
  something small now and then while nothing needs it, and dozes after ten
  quiet minutes until touched. Stroking it back and forth is a pet: hearts
  rise and the bond (days together, pets, playdates) remembers, one pet per
  few seconds.
- **Friends › Playground** (`renderer/companion-friends.js`, main's
  "Companion friends" block, `scripts/companion-friends.cjs`): like the toys
  that linked up, companions in the same room meet and play short scripted
  playdates, and **Practice with Pip** plays one on this PC with nothing sent.
  What a companion tells friends is a small fixed card, and nothing about the
  owner or their work leaves until they allow it. Levels: Stay home, Play only
  (look, mood and games; the default), Say hi (name and personality), Status
  (working or resting and counts, no titles) and Work titles (the project and
  a few task titles, scrubbed of anything secret-looking). Rules are for
  everyone, a room or a friend, for this session or always; the most specific
  wins, and **This session** can hold everything at Just play or Stay home. A
  room hears the lowest level of anyone who might be in it; a friend allowed
  more gets their own card only from a hub that delivers to one member. When a
  friend's companion shares more, the companion asks whether to share the same
  back (For this session / Always / Not now) and never shares on its own.
  Keys, tokens, paths, links, chats, decisions and settings never leave at any
  level. **What was sent** lists every card that left. A friend's card is read,
  clipped and shown as text, never sent to a model. Playdates need the rooms
  hub to relay `companion` frames (see [community.md](community.md)); until it
  does, Friends says so and Pip is there to practice.
- **Share between my PCs** (renderer/pc-vault.js; main.cjs "Your PCs vault";
  scripts/pc-vault.cjs, vault-crypto.cjs, vault-shelves.cjs, share-review.cjs).
  A private `<account>/mefi-studio-vault` repository, every file sealed
  (AES-256-GCM, the file's path as associated data) with a key kept only
  through safeStorage on the paired PCs; the pairing code carries it and is
  shown only when asked. Shelves are reviewed going in and coming out, and
  what fails is quarantined. Received brains, teams, recipes, notes and
  ideas are added through the same paths the app uses (brainsSave,
  agentProfiles, the Playbook's importRecipe, a new memory file, the idea
  add action) and never overwrite; kept model results and decisions are
  read beside this PC's own in modelLearningSnapshot and the decision
  profile. Each PC's sealed status line also carries what its agents are
  doing (main.cjs agentsSnapshot: the loop status, running titles, the
  companion's needs-you count and today's finished and stopped work), sent
  after a sync look and when that line changes, at most every ten minutes,
  so Your PCs shows what a PC left working is building. Keys cross only
  with the typed confirmation and a native prompt, and their values stay in
  main. A `.mefishare` friend file is always
  scrubbed, names no repository or PC, and is reviewed before it is kept.
  Vault calls take turns; a rebase is undone without loss unless two PCs
  changed the same file, and then GitHub's version is kept and status
  names this PC's dropped changes. Each PC's model results, decisions and
  preferences go in their own files (shelves/<shelf>/<pcId>--<id>.json).
- **Agents on several PCs** (main.cjs "Cowork claims", scripts/cowork.cjs,
  the hub client's claims calls). A cowork room linked to the project's
  GitHub repository (settings.cowork.rooms) carries live file claims. The
  dispatch's write-lock step also claims the run's files in the room, and
  claimWork treats other PCs' exclusive claims as in-flight jobs, so a pick
  on those files defers. Claims are renewed every minute; a run that did its
  work holds its claim until the next push or 30 minutes. Without a room,
  hub or link nothing waits. Alongside it, syncFollow asks GitHub every
  minute (sync.mjs remoteMoved, one ls-remote) and fast-forwards when this
  PC has nothing in the way and no builder is running.
- **Reach this PC from Discord** (main.cjs "Discord remote", scripts/remote.cjs,
  the hub client's `remote` frames; [remote.md](remote.md)). Off until the
  owner turns it on per PC. On, Studio keeps its outbound hub socket open and
  names this PC to the hub (`remoteHello` with the cowork machine id); the hub
  hands it `remote` commands from the owner's own DMs only, and Studio checks
  the sender against its own session again. Status, needs, made and digest
  read `agentsSnapshot`, the needs-you digest and the companion digest. A plain
  DM is `assistantMessage(text, { remote: true })`: the chat gate narrows it
  (`remote.gateActions`, `LOCAL_ACTIONS`), and the work it files carries
  `origin.via = "remote"` through the admission gate onto its card
  (`workAdmission.originOf` keeps `via`; it once kept only kind and by, and
  Discord work then built unapproved under Auto), which
  `autonomy.needsApproval` holds for approval in every mode, slices included.
  Approve buttons remember the card's scope when shown and need the PIN
  (salted scrypt, five wrong tries lock it); the approval goes through
  `backlogControl` with that scope. A look once a minute
  turns changes into alerts (`remote.alerts`). Everything sent passes
  `shareReview.scrub` first.
- The same glowing wisp wakes in the launch box, responds to pointer play with
  floating ASCII expressions and a few sparks, and accompanies the first-run
  guide. During setup, a pending chat reply or reported agent work, little lights
  circle its core and `...` pulses above it. A completed reply gets a happy
  reaction; failed replies settle without celebrating. Reduced motion keeps
  expressions still and omits particles. Its internal panels resize as the guide
  changes stops; the application window stays the same size. The scan remains
  read-only until **Use this setup** authorizes saving the shown choices,
  mapping the selected project, and asking the linked assistant for advice.
  Task submission, approvals and friend connections still need their own action.

- Agents' top-level tabs reveal floating child menus on hover. Hovering keeps
  the current page in place; choosing a child opens that view. Click or
  Enter also opens a menu, arrow keys move through its children, and Escape
  closes it. Narrow windows retain the section and view pickers. The menu,
  navigation rail and Command controls use clear glass with faint outlines:
  the canvas remains visible through the lightly tinted surfaces. Disabling
  blur keeps them transparent; reduced transparency uses solid surfaces.
  Floating menus and the shell share one frosted material
  (`--studio-float-*` in `studio-ui.css`); headers over scrolling text keep
  the denser `--studio-menu-fill`. Menus open on the spring curve with their
  rows cascading in, and one highlight glides between rows (the menu's
  `::after`, placed by `studio-ui.js` `glideTo`).
- One **menu** down the left edge has three destinations: **Home**, **Work**
  and **Agents**. A single local row lists the current destination's views:
  Tasks, Plans, Ideas and Analyzer under Work; Overview, Setup, Live
  (Command, Fleet, Pipelines, Sessions, Activity, Trace, Overhead), Workflows (Brain
  maps, Playbook, Project map, Context), Models (Catalog, Performance) and
  Usage under Agents. **New task** and **Search** (`Ctrl K`) sit above the
  destinations; **Settings** and **Help** stay at the foot. Help contains
  Start here, Shortcuts (`?`) and Community.
- The **setup helper** (`renderer/setup-helper.js`) is one sheet holding
  every setting that decides what the agents do: Welcome, Connect an AI
  (subscription CLIs, API keys, LM Studio and custom endpoints, Auto setup),
  Team & models (main assistant, routine and planning roles with effort, the
  coding worker and its tier, subtask builders, the five seats, saved teams),
  Routing (Jev or fixed model choice, the Automatic order, subscription logins
  first, fallback, and Jev's own route and key), How work runs (new work, the
  queue running on its own, pass interval, coding workers at once, the team's
  coordination, reporting and delegation switches, backlog mode, the
  assistant roster and housekeeping), Permissions (autonomy-ui's shared
  control), Tools & skills (per-agent web search, web page reads, project
  reads, MCP tools and skills, plus task-context gathering), Machine & app
  (keep awake, tray, resource manager limits, updates, companion reach,
  GitHub token), Look and Finish. It opens by itself before the Start here walkthrough on a fresh
  profile, and once after an update that raises its `REVISION`. Quick setup
  (the default) walks Connect, Permissions and Finish only; Everything walks
  every section with Next and Back. Connect an AI leads with **Set up
  automatically** and **Start free with OpenCode**, and counts a subscription
  CLI as connected only once it is signed in (`codingCliStatus` reads each
  login's file, `cliSignedIn`) or answers its check. It owns no settings: each control saves through the host call
  its setting already had, and team fields are saved for one scope (this
  project, or the Studio defaults every inheriting project uses) with the same
  revision check the Agents workspace uses. Search reaches each section
  (`Setup helper › Routing`), and `MefiSetupHelper.open(section)` deep-links
  it. Only **Continue to the guided tour** opens the walkthrough; any other
  close leaves it waiting as the Start here card (`MefiOnboarding.invite()`)
  with one toast to start it. When the helper has connected an AI, the
  walkthrough starts at Your workspace instead of its scan stop.
- The menu stays open by default at widths of 1100px or more, with the page
  beside it. **Keep menu open** saves your choice across launches. When unpinned
  or narrower than 1100px, it opens over the page on hover or keyboard focus;
  the saved pin returns when the window widens. The minimum window is 600×560.
- The menu is one tab stop. Inside it, the up and down arrows walk the buttons
  it shows and wrap around, and Home and End jump to the ends; the keys stop
  there, so Command's canvas never sees them. `Ctrl ,` opens Settings from
  anywhere, a text field included.
- **M+** at the top of the menu opens the project panel beside it, which holds
  projects only. Keyboard focus starts on the selected project, or Add project
  when none is available. It replaces the grip on the left edge that used to
  open the same panel.
- Workspace pages share a compact title and action header. List/detail pages
  show one pane at narrow widths, with a visible Back control. Focus follows
  the visible pane; returning to a view retains its selection and drafts.
- The menu is built from the same registry as **Search Studio** (`Ctrl K`), the
  Shortcuts sheet and the single-letter keys, so a destination cannot appear
  in one and be missing from another. Each record names its section, which
  files it in the menu, in Search's results and on the Shortcuts sheet alike.
  Actions stay in Search unless the registry gives one a place in the menu.
  Search also finds individual settings by name or control label,
  such as "Connections" or "Blur behind panels". Settings' own search
  uses the same labels; Enter opens the first match and Escape clears it.
  A result opens its category, reveals its disclosure and focuses the control. The menu
  replaced three older menus: the tabs row,
  the Command dock and the hover sidebar's own rows. **Switch navigation: rail
  or classic** in `Ctrl K` (or `?shell=classic` on the URL) brings those back
  for anyone who needs them, under the same section names.

### Workspace and work

- **Home sits over the live tree.** The node tree from Command view draws
  behind the workspace, and every panel on Home (the glance tiles, the
  conversation, **Your work**, the connection pill and the setup card) is
  frosted glass that shows it through, blurred; the menu and the project
  panel frost whatever they open over. The tree is scenery only: orbs, links
  and sky with no labels, no pointer or keyboard input, about 12 frames a
  second (one a second with Motion off), paused while a sheet covers Home.
  Opening Command takes the canvas over, and closing it hands the tree back
  while Home is still underneath. **Blur behind panels** off makes the panels
  solid. The glass is mixed from the theme's own colours, so every theme
  keeps its hue.
- **Configuration** (Ctrl Shift ,; **All settings in one place** in Settings)
  lists every setting in one searchable tree. Settings, Agents' setup panes
  and Appearance already register each control as a `settings:*` record for
  Search; `renderer/config-dialog.js` files those records under seven
  categories (the first whose words match) and opens the real control when
  one is picked, so there is never a second copy to drift. Its UI & Surfaces
  page adds the interface scale (the window's zoom, 70% to 150%, saved in
  `settings.ui.zoom` and put back on every page load, `main.cjs` `ui:zoom`).
- **Menu motion** (`renderer/motion.js`, `window.MefiMotion`): menus still
  rebuild their rows on each paint, and the helper keeps the pixels calm.
  Rows carry a `data-key`; `keep()` marks the ones that were there before
  `data-kept` (CSS stops their entrance), glides them to their new place,
  numbers new ones `--i` for a cascade and fades removed ones as
  `.motion-ghost` copies. `swap()` moves between views (panel to panel,
  list to detail, category to category) by fading the old view out fast and
  bringing the new one in from the side you went. Both read layout only
  when something on screen could move. Vibe's cards, panels, chat and dock,
  Configuration, Trace and the Habits panel use it.
- Each agent's **Skills, tools & habits** panel (Agents › Setup) now ends
  with **Habits** (`scripts/habits.cjs`): six short behaviour rules with
  variants, each off, brief (one line) or full, with its token cost and the
  total the agent's habits add to every prompt. `agent-addons.cjs` appends a
  role's habits wherever its skills go (seats, roles, the builder), and a
  team snapshot carries `agentHabits` like `agentSkills`.
- **Rules** (Agents › Setup › Team & models, under the roles;
  `scripts/agent-rules.cjs`): up to 4,000 characters of standing rules for the
  project, and two switches that also send its own `AGENTS.md` and `CLAUDE.md`.
  Stored as `agentRules` in the team like `agentSkills` and `agentHabits`: a
  project with no team of its own reads the Studio defaults' rules, saving them
  for such a project gives it a team of its own (a copy of the defaults plus
  the rules), a saved team (preset) never carries them and applying one keeps
  the project's, and a running task keeps the rules it started with. Too long
  is refused with "Nothing was cut", never trimmed. `agent-addons.cjs`
  `instructions()` puts the rules first in every prompt of a role that runs on
  Studio's own models (the assistant roles, lead, desk, overseer, companion,
  scout, and builders on Grok or Antigravity), reading each file fresh for the
  request, at most 8,000 characters of it, and once when CLAUDE.md repeats
  AGENTS.md. Claude Code, Codex and OpenCode builders read those two files
  themselves, so they get the owner's text only. The files go to the models as
  instructions, so they are switched on per project, off until the owner does. The card has its own Save and
  Discard (`agents:save` with `action: "rules"`, so the rest of a half-edited
  team is not applied), counts a draft the way the prompt does (headings plus
  text, four characters a token) and lists who reads what from the same table
  the prompt uses. `MEFI_STUDIO_NO_AGENT_RULES=1` sends no rules and keeps the
  saved ones.
- **Trace** (Live, next to Activity; `renderer/trace.js`) reads Studio's logs
  as channels: the studio log (every line the host logs, kept in a bounded
  ring since it was only ever streamed to the window), the assistant's log,
  the run ledger (`data/executor-log.jsonl`), OpenCode's own log and the
  window's warnings and errors. Each channel shows its size and problem
  count; a channel is searched, tailed (100 to 2000 lines), filtered by level
  and by source tag (`[agents]`, `[assistant]`, `[tools]`…) and followed every
  two seconds while the sheet is in view. The rules live in
  `scripts/trace.cjs`, the reads in `main.cjs` `trace:channels` / `trace:read`.
  In the rail layout it is a full page below the navigation bar; Back returns
  to the previous Agents view. The classic layout keeps its dialog behavior.
- Home keeps its composer at the bottom of the window, with conversation and
  a compact progress summary scrolling above it. **Activity**
  opens a separate panel with task details and app preview controls; a running
  worker opens it automatically until you choose to close it. On narrow windows
  the panel opens over the conversation. The navigation menu includes **New task**, a distinct
  project selector, recent tasks and a soft selection marker; pinning and
  shortcuts remain. New task restores the saved draft without submitting it.
  Its project controls stay below the fixed navigation row at every window
  size. The Pipelines, Playbook and Project map navigation selections update
  after their content loads, including the compact view selectors.
  A compact project header has one global **Start agents /
  Pause / Resume** control. A **Needs you** shortcut appears when a decision
  is waiting. The task, preview and composer stay ahead of secondary panels:
  **Project queue**, **Studio status**, and **Getting started & community**
  start collapsed. **More** holds folder actions, Stop all and Restart, which
  ask first; Stop all says when a run is still finishing rather than
  stopped.
- **Current task** on Home combines the selected task's state, worker, current
  action, last activity age, recorded checks, blocker and next step. The task
  selector chooses what to follow without leaving Home. Work and Live retain
  that selection per project and offer **Home** and **Back to task** links.
  Compact task labels keep the full task title and brief in its details.
- **Start this task** (or **Resume this task**) requests a worker for that
  task only, including when the general queue is paused. It does not drain
  unrelated work or promote ideas. Required build approval, dependencies and
  machine capacity can still hold a start, and the result names the hold
  rather than claiming a worker has begun. A later Pause or Stop cancels a
  pending request to start.
- **App preview** on Home is separate from coding workers and completion
  checks. Studio detects a root `index.html` or a package preview/dev/start
  script, starts a managed local server, waits for readiness and exposes
  **Open app** and **Stop preview**. A preview can be ready while an agent is
  still working, or stay available after the agent finishes. A failed start
  shows its error and bounded output with a retry action.
- Existing loopback preview links recorded by the project's workers can be
  reused. Studio does not claim ownership of, or stop, a server it did not
  start. Managed previews stop when switching projects or quitting Studio;
  preview readiness never substitutes for task verification.
- Completed work offers **View checks** and **Request a change** beside its
  preview action. A change opens a new task draft linked by the original task
  identity; it waits for your description and submission, preserves an
  existing draft and keeps the completed task's evidence intact.
- **Projects** keeps each folder's tasks, conversations, drafts, references and
  work logs together. **M+** at the top of the menu opens the project panel
  beside it: the project list and **+** to add a folder. With a worker running,
  **Save & switch** stops it, saves its progress and waits for the task state
  and history writes before opening the other project. If saving cannot
  finish within the wait, Studio keeps the current project open.
- **Your work** separates open work, attempts needing **Review**, and verified
  or manually confirmed **Done** tasks; archived completions stay visible.
- The conversation offers **Chat** for questions and discussion, and **Create
  task** for work to add to the board with acceptance checks.
- **Queue settings** groups **Auto build** and **Agent mode** in an expandable
  section above the queue. Auto build is a compatibility switch: off selects
  Always ask, on selects Auto. Use the shared permission control for all four
  modes and elevated categories. Task approval covers the saved scope and
  persists across restarts; Accept per task labels it **Accept this task**.
- Default **Swarm** assigns one builder per ready task without mandatory
  advisory calls; independent tasks can run concurrently. **Cluster** adds
  planning, review and scoped delegation for one shared task. Switching to
  Swarm preserves existing delegated children, dependencies and verification.
- **Studio status** expands the worker count, waiting decisions, next work,
  machine gauge and usage. Each tile opens its owning view. A new agent
  question also raises a toast with an **Answer** button from any view.
  **Preview controls** expands its URL, Stop, Check again and output, keeping
  one **Open app** button in the normal Home view.
- Running task cards show whether the worker is preparing, building, finishing
  or stopping, its current checklist step (or latest output), the selected
  worker route and the age of the last update. **No update yet** stays explicit
  until the worker reports activity; an output line never proves completion.
  For OpenCode workers, a pending or running tool takes priority over an old
  checklist step: its safe description, status and elapsed time refresh every
  ten seconds, even while a shell command has produced no output. The chat
  assistant receives the same current-tool summary.
- Fresh project folders do not need Git unless the requested work or project
  instructions require a commit. A missing repository alone does not create
  an owner question or an unfinished-work obligation.
- **Work through backlog** works the project's existing tasks and ideas first,
  keeping a small runnable buffer; **Pause** holds every kind of new work (the
  same hold as Command's **New work** switch) while current workers finish.
- The **task board** opens as plan cards with progress and a current step, and
  holds prerequisites, handoff context and task history. Missing prerequisites
  and dependency cycles are surfaced for correction. History notes and ideas
  retain their draft, focus and text selection while live task details refresh.
  A running task's **Stop** asks twice. A task a grouped plan holds offers
  **Open group** instead of status, rename or delete changes, which the host
  refuses until the plan releases it.
- **Deleting a task or an idea can be undone.** Delete on the Task board or in
  Ideas answers with **Deleted “…”** and an **Undo** for about eight seconds;
  after that, **Task board › More › Recently deleted** (and **Ideas › Tools ›
  Recently deleted**, ideas only) lists what can still be put back, each with a
  **Restore**, and a row whose card is back is greyed out. **Clear finished
  ideas** offers one Undo for all of them. Behind that, delete first keeps the
  whole record (`scripts/board-trash.cjs`; `main.cjs`, "Board trash") in the project's
  own `board-trash.json`, beside its board files: 30 days, at most 50 items,
  oldest dropped first, with who deleted it and when. That copy is written
  before the board write that removes the card (`mutateBoard`'s `beforeWrite`,
  inside the board lock), so a crash between the two can leave the card in both
  places and never in neither, and a copy that cannot be written stops the
  delete. `tasks:undelete`, an ideas `restore` action and `board:trash` put one
  back or list what can be. A restore returns the record under its own id at its
  old place and never overwrites a card that is there again: it says so and keeps
  the copy. `MEFI_STUDIO_NO_BOARD_TRASH=1` gives the old delete-for-good
  behaviour back (the list is empty and nothing is read or written); what was
  already kept stays in the file until it is lifted. Housekeeping never puts
  anything here: only deletes you make do, and the compactor's clean-ups of
  duplicate cards, which nobody deleted, are not among them.
- **Search Studio** (`Ctrl K`) finds pages, tools, tasks and settings by
  familiar terms. **Settings › General** holds names and startup behavior;
  **Appearance** holds themes, motion, panel blur and canvas presentation.
  With the box empty Search starts with **Recent**: the last things you opened
  or ran from it in this project (eight are remembered and six shown, in the
  page's own storage, so nothing waits on the host); a target that has gone
  since, such as a deleted task, is skipped without a word. Typing `task …` or
  `idea …` with some text puts one **Add task** or **Add idea** row on top of
  the results; Enter adds it (a task through `tasks:create`, the board's one
  way in; an idea through `ideas:action` as one from you) and a toast offers
  **Open**. Nothing is added before Enter; `task` alone, `tasks …` or the word
  inside a longer one is a plain search, and a query that is exactly the name of
  the top result keeps that result first with the Add row one down.
  `settings.ui.searchRecents` or `searchQuickCreate` set to false, or
  `MEFI_STUDIO_NO_SEARCH_RECENTS=1` or `MEFI_STUDIO_NO_QUICK_CREATE=1`, turns
  each off.

Ideas uses a responsive inbox of compact cards with a title, a short detail
preview, status and source. Selecting a card opens the existing detail and
actions; the Graph view remains available. Tasks and Ideas share
`renderer/card-layout.js` to reserve each card's measured height, update when
cards or the window resize, respect reduced motion, and release observers
and pending animations when the view closes.

#### Size and density (layout v2)

`renderer/size.js` (`window.MefiSize`) and `renderer/size.css` hold the 0.5
layout's size settings and the tokens its components size themselves with.
They exist only for `html[data-layout="v2"]`, which `size.js` checks once after
`nav.js` has chosen it. With the layout off the file defines its object and
does nothing else: no listener, no registry record, no host call and no
storage, and `html[data-density]` keeps its two older values. The layout
switch is the switch; nothing here reaches the person unasked.

**The page.** Settings › Appearance has a **Size and density** row where its
Density list was, and the page is also in Configuration › UI & Surfaces, in
Search and in the status bar's Layout menu (`MefiSize.open()`, which enters
through `MefiNav.go("size")`, so the page is a route of Settings). In the rail
shell it is a page of Settings: Back leaves to Settings. Four controls sit on
the left: **Interface scale** (the window's own zoom, 70 to 150 % in steps of
5, `main.cjs` `ui:zoom`; Ctrl +, Ctrl − and Ctrl 0 move the same scale and the
page follows them), **Text size** (80 to 140 % in steps of 10, named Smallest
to Largest), **Density** and **Detail**. On the right a **miniature** of the
window on invented sample data (rail, list, top bar, tab strip, thread,
inspector and status bar) is drawn by the same tokens and rules as the real
panels, under its own scope (`.size-mini[data-mini-density]`,
`[data-mini-detail]`, `--mini-text-scale`; never the root's). It shows the
**draft** while the window keeps what it has, and approximates the interface
scale with CSS `zoom` (`--mini-zoom`). **Apply** (enabled only when something
differs; Ctrl or Cmd + Enter does it too) puts the draft on the whole window
and offers **Undo** in a toast; **Reset** applies the defaults (and has an
Undo); **Discard changes** puts the window's own values back in the controls.
Leaving the page keeps the draft until you return or discard it, and nothing
is stored for a draft. A change made elsewhere (Ctrl +, a style preset) moves
every control the person has not touched. A read-only **Panels** table says
what the list, inspector, tab strip, status bar and rail take now
(`MefiShell.size`, else `MefiNav.layout.used`). Pages from before the 0.5
layout are drawn in fixed pixels, so the interface scale is what resizes them;
the page says so.

| Setting | Values | Kept in | Sets |
| --- | --- | --- | --- |
| Interface scale | 70 to 150 %, steps of 5; 100 | the host: `settings.ui.zoom` (`ui:zoom`, `ui:zoom-get`, `ui:zoom-changed`) | the window's zoom |
| Text size | 0.8 to 1.4, steps of 0.1; 1 | `mefiStudio.appearance` `text`; `--text-scale` on the root | the words of the 0.5 panels |
| Density | `compact`, `comfortable`, `spacious`; comfortable | `mefiStudio.appearance` `density`; `html[data-density]` | `--d-*` |
| Detail | `titles`, `status`, `all`; status | `mefiStudio.appearance` `detail`; `html[data-detail]` | `--dt-*` |

The last three live in the existing appearance store (`window.MefiAppearance`
is its only reader and writer). The store gains `v: 2`, `text` and `detail`;
`density` gains `spacious`, which a window without the 0.5 layout reads as
comfortable, so the older rules keyed on `html[data-density="compact"]` are
untouched; and every older key and value still reads (no `text` is 1, no
`detail` is titles and status). Nothing is written until something is applied.
The first write to a store that is not yet `v: 2` keeps its old text once under
`mefiStudio.appearance.backup.v1`. Applying announces `mefi:appearance`, as
every appearance change does, and `MefiSize.onChange(cb)` says what changed and
why (`apply`, `undo`, `reset`, `keys`, `host`, `appearance` or `open`).

**Tokens for components.** A 0.5 component follows the settings by using these,
with no code of its own:

| Token | Comfortable | Compact | Spacious | Used for |
| --- | --- | --- | --- | --- |
| `--d-row` | 8px | 5px | 11px | a session row's padding, top and bottom |
| `--d-gh` | 12px | 8px | 16px | space above a group heading in a list |
| `--d-stp` | 8px | 5px | 11px | a plan step's padding |
| `--d-seat` | 9px | 6px | 12px | a team seat row's padding |
| `--d-set` | 10px | 7px | 13px | a settings row's padding |
| `--d-gap` | 14px | 10px | 20px | the gap between blocks of a thread or a column of cards |
| `--d-lrow` | 10px | 7px | 13px | a row of Today's lists |
| `--d-pad` | 14px | 11px | 18px | the inspector's padding |
| `--d-bub` | 12px | 9px | 15px | a message bubble's padding |
| `--d-top` | 48px | 44px | 52px | the top bar's height |
| `--d-tab` | 38px | 34px | 42px | the tab strip's height |
| `--d-card` | 12px | 9px | 15px | a board card's padding |
| `--d-col` | 12px | 9px | 16px | the gap between board cards |

| Token | Titles | Titles and status | Everything | Used as |
| --- | --- | --- | --- | --- |
| `--dt-meta` | none | block | block | `display` of a row's status line |
| `--dt-prog` | none | block | block | `display` of a row's progress bar |
| `--dt-more` | none | none | flex | `display` of a row's extra line (worker, branch, changes, checks) |
| `--dt-q` | none | block | block | `display` of a board card's open question |
| `--dt-qf` | none | flex | flex | `display` of its answer buttons |

Text is `max(12px, calc(Npx * var(--text-scale, 1)))`, so it is never under
12 px; the ladder `--f12`, `--f125`, `--f13`, `--f135`, `--f14`, `--f15`,
`--f16`, `--f18`, `--f20` and `--f22` names each step once (`font-size:
var(--f14)`). A height that is a token (`var(--d-top)`) needs no code. A region
that must be told its size in numbers (`MefiNav.layout.set`) reads
`MefiSize.metric("tab")` (a token in px, from `--d-tab`) and listens to
`MefiSize.onChange`. `size.css` follows the layout contract and reads none of
the `--shell-*` sizes.

### Planning

**Plan an idea** opens **Plans** for work whose route is unclear. **Write with
Mefi** explores relevant project files after you pause typing. Its side tree
shows matching file excerpts with line numbers, the outcome, and decisions to
shape. Switch between **Explore files** and **Suggestions** in the side panel.
It uses your configured assistant connection to suggest wording, open
questions, and useful additions; **Help me write** focuses on the field you
last selected. **Refine** beside a destination field opens writing help for
that field. Suggestions are readable cards with an **Edit** action; replace or
add wording to a field, or dismiss the card. **Undo** restores the previous
wording until you make another edit. Suggestions stay in the local draft until
you save them. **Write manually**
turns live requests off and remembers that choice with the draft. A connection
failure keeps your text and any file evidence available. The local scan is
bounded, skips private directories and links, redacts excerpts, and caches
the inventory for 30 seconds while typing. It does not run project commands.

**Enter** moves to the next field, then focuses the save control; it never
submits a field automatically. **Shift+Enter** adds a new line. A slight glow
marks the selected field and the previous field briefly fades as you move on;
motion preferences disable the animation. The compact stage menu and writing
partner fit beside the editor on wide windows and stack on narrower ones.
The editor and suggestion list scroll independently on desktop, keeping the
partner controls visible. Expanded file branches and unfinished suggestion
edits survive switching between the partner's tabs.

Each stage has its own symbol, soft accent, and compact label. The stage cards
arrive in a short stagger; choosing a stage brings its section into view with
a directional slide. Matching section headers keep the current part easy to
recognize. Browsing preserves entered text and the saved workflow status, and
motion preferences suppress the slides.

Theme-tinted glass keeps the background visible through the stage menu,
editor, and partner panel. Softer borders separate the surfaces, while writing
fields keep a little more tint for readability. Appearance's glass and blur
settings apply; reduced transparency uses solid surfaces. The background graph
quiets while you write, and its controls return when you close Plans.

Describe the outcome in your own words, then Mefi interviews you: it asks the one question
that would most change what gets built, waits for your answer, reads that
answer back as an unconfirmed interpretation, raises a conflict when you
contradict yourself, and follows what you actually said into the next question.
Every line of the interview is labelled by where it came from — your answer,
Mefi's reading, its recommendation, its question — and only a decision you
record yourself becomes a requirement. You can still ask for a batch of
questions, ask it to explain the tradeoffs on one, or write the whole plan by
hand. Your answer is saved before Mefi is asked, so a failed reply loses
nothing: the answer box clears and **Continue with Mefi** picks the interview
back up without filing the same words twice.

Once every unknown is settled and every question decided, **What we understand**
reads the plan back to you and waits for your confirmation; no specification is
drafted or approved until you give it, and changing the destination, an unknown
or any decision withdraws it. Renaming a plan changes no decision and keeps
both, and saving an unchanged specification keeps its approval. Then write or request a specification with small
tasks, acceptance checks and prerequisites, approve the draft, and explicitly
create its tasks. Assistant suggestions and interview lines never resolve a
question, confirm the understanding or approve work, and planning itself cannot
launch coding workers. Manual controls work without an AI key; plans and their
revision history stay in the project's ignored local `planning.json`.

Every edit of a plan is a **version**: the whole plan as saved, with when, who
(you, Mefi's own suggestion, or Studio) and a one-line note of what it did.
`restore-version` brings an earlier version back as a *new* one (restoring
version 2 of 3 makes version 4), so history is only ever added to and nothing is
lost. Only you can restore, and not over a plan that is archived or has begun
creating tasks. The restored wording, your recorded decisions and its
specification come back, but the confirmed reading and any approval belonged to
the version they were given on, so both are asked for again before tasks can be
made. Every version is kept (the store has always kept a full snapshot per edit;
a hard cap would make the file unreadable to an older build after a **Roll
back**). In the Plans sheet the **Versions** section (formerly Plan history) lists
the newest twenty, each with what it did, who made it and when, and **Show older
versions** pages back through the rest; open one to read its wording, then
**Restore this version**, which waits for unsaved changes to be saved or cleared. A
plan saved with no history gets its current wording as version 1 the first time
it is read; the first save after that keeps one copy of the old file beside it
(`planning.json.before-versions.bak`).

**Archive plan** sets a plan aside without deleting it: it becomes read-only,
folds under **Show archived** in the list, and drops out of the assistant's
plan summary and the Analyzer. **Restore plan** brings it back exactly as it
was. A plan still creating its tasks has to finish first. Up to 300 plans can
be in play per project; archived ones don't count toward that. When Mefi
suggests a batch of questions, a proposal with a bad reference no longer
discards the batch: an unknown prerequisite is dropped, and a malformed
proposal is left out and counted in its note.

### The assistant and the agent loop

Claude connection errors retain the CLI's quota or login explanation, including
its reported reset time. Successful AI replies clear the offline warning,
including when the connection recovers through companion chat.
Assistant CLI replies require a clean process exit; partial output from a
failed process stays an error and cannot produce briefing requests.

- The assistant can always be messaged and is always working: a **service loop**
  ticks every 30 seconds (every two minutes while hidden), organising the node
  tree, scanning the machine, running the Auditor every five minutes, fixing and
  tidying on cadence, and (with Proactive on) briefing every five minutes.
- The assistant you chat with **oversees the work**. Every reply sees the
  whole board by stage — what is running and how far along, what is being
  verified, what is parked, held or waiting on you, and why — plus the open
  Ask cards and what just happened to your tasks, the open folder and its own
  scanned plan documents. It acts on tasks when you plainly ask (start,
  retry, stop one worker, mark done, add a note for the next worker, file new
  work) and turns anything you did not plainly ask for into an Ask card you
  confirm. Named approvals and answers also follow the selected permission
  mode in chat; enabled elevated requests remain yours to review. What
  your tasks do arrives in the thread as one line per task that updates in
  place (started, verifying, verified, retrying, parked), and cards only you
  can move are rolled into one "needs you" line. Without an AI key, plain
  keywords still work, and "try again", "stop the auth build" or "close the
  search task" act on the card they name. See
  [agent-loop.md §11](agent-loop.md#11-the-assistant-as-overseer).
- **Work done outside Studio.** Studio keeps a last look at each folder (its
  git HEAD, branch and uncommitted files) while it watches it. Open the
  folder again after committing by hand, editing elsewhere or running Claude
  Code, Codex or OpenCode in it, and the thread says what changed ("While Studio was
  away (3 h): 4 commits, 12 files changed, 1 outside agent session"). The
  assistant can answer "what did I do while Studio was closed?", and the
  welcome-back digest leads with it. Every queued card waits while it is
  checked against that work: a card that is still needed runs as before, a
  partly done one runs with its worker told what changed, and one that looks
  already done or no longer needed waits in **Needs you** with **Mark it
  done**, **Drop it** and **Build it anyway**. The task's Evidence tab shows
  the verdict and the commits behind it. Without a model the check matches
  files and commit subjects and only says "may already be done". See
  [agent-loop.md §14](agent-loop.md#14-work-done-outside-studio).
- **Talking to the companion.** Every chat box (the companion's Talk tab,
  Home's composer, Command's chat log, the Explorer) sends the screen you are
  on and the companion's name with each message
  (`MefiCompanionUI.context()`), and the reply speaks as that name. The host
  adds the owner's chosen personality (`ui.personality`), which changes the
  manner of the reply and nothing else.
  Command's chat log and rail console update live thinking text in place,
  preserving the saved bubbles, text selection and the reader's scroll.
  Their composers grow with the draft up to 120 px, then scroll, and follow
  width and font changes through native sizing when the browser supports it.
  "Requests", "what needs me" and the badge are one list: the chat's
  `needsYou` is built by the same `companion.queue()` that counts "N need
  you". The model also reads the latest notices and what each reply offered.
  After a reply that offered several cards, "all of them" or "both" starts
  every offered card and only those. The Talk tab shows the last reply's
  offers as one-tap buttons (plus All of them) and refreshes when a reply or
  notice lands.
- **Work on it** makes a node the assistant's next piece of work — pinned to
  the front of the board and started at demand priority. Every session, todo and
  task acts as a **node folder** of typed context cells that compile into chat
  replies and executor prompts.
- The **overseer** reviews how the assistant works, keeps a playbook and lesson
  counts, files bounded upgrade requests, and repairs the loop (resume stale
  sessions, re-arm a parked executor) every fifteen minutes. Its local review
  runs every pass; the paid AI review runs only when the board changed since
  the last one (`overseerSignature`) or when you ask for it.
- Collision history keeps sequential edits inspectable. When one session
  finished before the next started, the handoff does not queue a collision
  repair. Finished sessions no longer count as active editors; overlapping
  work by concurrent sessions still receives conflict checks.
- The agents **talk to each other**: a scout that sees something another role
  owns writes it a note — the watcher tells the keeper about stale sessions and
  the auditor about colliding files, the machine tells the foreman when it is
  holding new starts, the auditor and the compactor tell the foreman what is
  ready to hand out, the keeper tells the compactor what it pruned, a finished
  builder tells the agent it called what for, and the overseer says why it woke
  a role. A note pulls its reader onto the next tick only when that seat acts
  on its notes (`readsMail` in `AGENT_ROLES`: the foreman); every other seat
  takes its notes when its own cadence starts it. Notes are not activity-log
  rows. On the tree a note rides a packet between the two
  agents' orbs; the assistant card lists the exchange under **Said to each
  other**, the AI passes see it as `chatter` and may answer with notes of their
  own, and asking about **agents** in chat reads the latest lines.
- Closing the window hides Studio to a tray icon and the loop keeps running;
  builders journal their progress and checkpoint before quit, and interrupted
  work resumes on the next start instead of being duplicated.
- **Start with Windows** (main.cjs "Start with Windows", settings.ui.openAtLogin)
  keeps a Run entry pointed at this copy of the app with `--at-login`. That
  launch (startupAtLogin) opens the open project in the tray without the
  launch screen, and the agents follow When Studio opens, so a PC left
  working is working again after an update restart. prefs:get reads back
  what Windows holds, including Task Manager switching it off.
- Builders can run in **per-session worktrees** (opt-in,
  `MEFI_STUDIO_WORKTREE_RUNS=1`): each dispatch gets its own checkout and its
  own git index under `.mefi/worktrees/<runId>` on a `mefi/<runId>` branch, so
  concurrent runs cannot contend on the shared index or sweep each other's
  staged files; the branch merges back into the working repository one run at
  a time after it settles. The checkout shares the repository's `node_modules`
  through a junction (an `npm ci` from its own lockfile is the fallback; set
  `MEFI_STUDIO_WORKTREE_NPM_CI=0` to skip it), so builds and tests run inside
  it. Nothing is dropped silently: a merge-back that fails keeps the branch, a
  run that left uncommitted edits keeps its checkout for recovery, and a
  crashed attempt's branch is renamed aside (`mefi/orphan/...`) instead of
  deleted. A worktree starts from HEAD, so a run does not see other sessions'
  uncommitted work until it lands. Besides the environment switch, "Give each
  run its own worktree" (settings.executor.worktreeRuns; the Worktree chip in
  Build's composer and a switch on the page below) turns it on.
- **Work › Worktrees** (renderer/worktrees.js; main.cjs "Worktrees";
  scripts/worktrees.mjs reads, scripts/worktree-actions.mjs writes) lists every
  worktree of the open project, worst first, and says which hold work only this
  PC has (uncommitted files, or commits on a detached HEAD no branch holds),
  which are on GitHub but not merged and which are merged and safe to remove.
  A task run's row names its task. **Open folder** hands the folder to the file
  manager. **Merge into main** fast-forwards the main checkout on this PC
  (a merge commit only when asked; refused while the worktree or the main
  checkout has uncommitted files, while the main checkout is on another
  branch or mid-merge, and while a run works in it; a conflicting merge is
  undone) and never pushes. **Remove** takes the folder away, never the main
  checkout, a locked worktree or a run's folder while it works; a folder that
  holds uncommitted files or commits on no branch needs a second, explicit
  yes and is first kept as `refs/mefi/rescue/<name>-<time>`, and a branch that
  is not fully merged is never deleted. **Forget missing folders** is
  `git worktree prune`. Every action names a folder from the list and the host
  only acts on a folder git lists for the open project. `npm run worktrees`
  prints the same table (`--json` for other tools); it changes nothing. In
  Build's task list a task whose run has a worktree wears a small branch mark
  (`MefiWorktrees.peek()`, at most one quiet read every 8 s; the page announces
  `mefi:worktrees` when its list changes, and a project change drops the list).
- **A task's usage and its time limit** (the **Usage & limit** fold in a task's
  Evidence; `renderer/tasks.js`, `scripts/task-metrics.cjs`,
  `scripts/task-cap.cjs`, main.cjs "Task time limit"). `task:metrics` answers
  for one task: this attempt's time, tokens and cost, and the whole task's
  (every attempt, and its delegated sub-tasks), read from what Studio already
  keeps: the executor ledger for which runs there were, how long each took and
  which route ran it, Studio's own call ledger by run id, and OpenCode's store
  by session inside each attempt's time window (a session a retry reused does
  not charge the retry its predecessor's turns). A route that reports nothing
  says **Not reported**: Claude Code, Codex, Grok and Antigravity run as
  builders print no token counts and no price, so their attempts carry a
  measured time only; a plan or subscription that prices no call is
  **Unpriced**, never free; a store that could not be read is **Unavailable**,
  and the whole task's total says when it is partial. The read happens when the
  fold is opened. **Stop an attempt after N min** is a per-task limit
  (`task.capMinutes`, 5 to 240 in steps of 5, 25 when unset, set by
  `tasks:cap`). The timer is `min(EXECUTOR_KILL_MS, limit)`, so a limit can
  shorten an attempt but not lengthen it: a longer number is kept and the fold
  says the app's own 25 minutes wins. A run that reaches its limit is stopped
  through the owner's stop path (`stopExecutorJob`): its progress is saved,
  nothing is charged to the card or counted against the model, no failure is
  asked about, the ledger row says `stopped` with `limitMinutes`, and the card
  waits for you (an `ownerHold` of kind `limit`, worded "Stopped at the time
  limit", not "Stopped by you") instead of starting the same attempt again;
  "work on it" or "try again" carries on. Changing the limit while a run is
  live moves its timer at once, and the worker is told a budget of 60% of its
  limit (15 of the default 25 minutes, as before). The hard kill with no limit
  in force is still a failure. `MEFI_STUDIO_NO_TASK_CAP=1` switches limits off
  (the old single 25 minute failure kill, `tasks:cap` refuses, the fold says so).
- **Pictures on a message** (Home's message box; `renderer/composer-pictures.js`,
  `scripts/image-attach.cjs`, `scripts/image-store.cjs`, main.cjs "Picture
  attachments"). **Attach picture**, a picture pasted with nothing else on the
  clipboard, or a picture dropped into the box (a text file dropped with it still
  goes to **Add files**) is sent to `assistant:image` as `{ name, mime, data }`.
  The host decides by the file's own bytes, not its name or the declared type:
  PNG, JPEG, WebP or GIF, at most 5 MB, at most 25 million pixels, four to a
  message; SVG (which can carry script), PDF, BMP and everything else are
  refused. It is kept under the project's data folder (`attachments/`, two files
  per picture, written atomically, never in the repository, never in a problem
  report) and answered with an opaque id (`img_` and 24 hex digits) and a small
  preview. A message names its pictures by id (`assistant:message` `images`,
  `tasks:create` `images`); the thread keeps id, name, type and size, never a
  path, and a message whose picture has gone is refused whole, like an over-long
  one. A picture nobody sent is removed after a day, one a message or a task
  still names never is, and the folder is held to 300 pictures and 300 MB.
  What reaches a model follows the catalog: `agentProfiles.capabilities().vision`
  is true only when `data/models.json` lists `image` among the model's input
  modalities (a model it does not list, and any custom or local one, is taken
  as not seeing). A model that sees is sent the picture in the provider's own
  request shape (an `image_url` data URL for chat completions, `input_image`
  for the Responses API; an Anthropic `image` source block is built for the
  day a Messages route exists, and none does yet). A model that does not see is
  sent the request unchanged and the reply says once, by the model's name, that
  it could not look at the picture. A coding CLI is never sent a picture: it
  gets one plain line, "The owner attached <name> at <path>", and a task made
  from the box carries the same line in its brief. The box shows what will
  happen before the message goes ("Sent to <model>, which can read images", or
  "<model> can't see images"), and a picture is not redacted the way text is,
  which it says. `MEFI_STUDIO_NO_IMAGE_ATTACH=1` switches all of it off: the
  channel refuses, a message naming a picture is refused, and the box asks once
  at start and shows no button.
- **@ # / in a message** (Home's message box: `renderer/composer-picker.js`,
  `scripts/mentions.cjs`, `scripts/project-files.cjs`, `scripts/gitignore-lite.cjs`,
  main.cjs "Mentions in a message"). Typing `@` offers the open project's files by
  name, `#` its tasks and `/` its skills, in a popup that answers the keyboard
  first (arrows, Enter or Tab to pick, Esc to close, and no key taken while it is
  closed) and opens nothing for an email address, a word with `@`, `#` or `/`
  inside it, a path or a URL. What a message points at shows as chips under the
  box: `@src/app.js` (or `@"a file with spaces.md"`; a bare name such as a
  Makefile is inserted quoted, because a bare `@word` only counts as a file when
  it has a `.` or `/` in it), `#"a task's title"`, `/skill-name`. The grammar is
  one (the page and the host read a message the same way; a test holds them
  together). `project:files { query, limit }` answers **names only**: a bounded
  breadth-first walk (30,000 files, 6,000 folders, 12 levels, 1.5 s, kept for
  15 s), fuzzy on the name and then the path, never outside the project and
  never through a link, leaving out what the read tool would refuse (hidden
  paths, `data`, `dist`, `node_modules`, `.pem` `.key` `.db`
  `credentials.json` `settings.json`; the picker never offers a path the model
  would be refused) plus `build`, `out`, `coverage`, `__pycache__` and whatever
  the project's `.gitignore` files ignore (a small reader that agrees with `git
  check-ignore` on a real tree). `agents:skills` lists the skills the inventory
  (`agent-addons.cjs`) finds with a one-line description each, one of each name
  (the project's before the home folder's, `.agents/skills` before other tools'
  folders). A chat message that says `/skill-name` is sent with that skill's own
  text added to what the model is told (after the chat's instructions, through
  the outbound scrubber): at most four skills, inside 16,000 characters shared
  between them; the first one is added whatever its size (a skill over 16,000
  characters "only loads when called", and this is that call), a later one that
  does not fit is left out and the reply says so, and so does a skill that does
  not exist, when it was plainly meant as one (it starts the message, or it has
  a dash in its name; `/tmp` in the middle of a sentence is just a word). A chat
  message that says `@path` gets one sentence after its words naming the files
  that exist in the project, through real folders and not excluded, never their
  contents: whether the model may read one is what its tools already decide (the
  project-read switch, `docs/agent-tools.md`). The thread keeps exactly what was
  typed, and a Discord message gets none of it. A task made in Create task mode
  keeps its `@` and `/` words as typed; only chat expands them. `settings.ui.
  composerPicker = false` (Settings › You, "Suggest files, tasks and skills
  while I type"; on by default) or `MEFI_STUDIO_NO_COMPOSER_PICKER=1` switches
  the popup, the chips, both channels and the expansion off.
- **Skills** (`scripts/skill-format.cjs`, `scripts/skills.cjs`, main.cjs "Skills";
  the page is Agents › Setup › Skills). A skill is `<project>/.agents/skills/<name>/
  SKILL.md`: front matter with `name` and `description`, then the instructions.
  The name is the folder and the `/command`: lowercase letters, numbers and
  dashes, up to 64 (not a name Windows keeps for devices). The file is at most
  32,000 bytes, which is what the inventory accepts, so a bigger one would save
  and then never be listed; agents load skills by themselves only while the ones
  they chose fit in 16,000 characters, and the page says when a skill is over
  that and so loads only when called by name. `skills:list`, `read`, `save`,
  `create`, `delete`, `import` and `export` take a **name**, never a path: the
  host builds every path from the open project's root and a checked name, and
  the only place it writes inside a project is that one file. `.agents`,
  `.agents/skills` and the skill's own folder must be real folders (a link is
  refused, and a `SKILL.md` that is a link is not a skill, as in the inventory).
  `create` and `import` never overwrite (a new folder, made so that two made at
  once cannot both succeed); `save` replaces an existing skill and keeps any
  other front-matter keys it had (another tool's `allowed-tools`, say); every
  write is a temporary file and a rename. A save that changes text, and a delete,
  first keep the old text in `data/projects/<id>/skill-backups/<name>/` (ten per
  skill, outside the project) and refuse to go on when that copy cannot be made.
  Delete removes the `SKILL.md` and the folder only if nothing else is in it.
  `import` opens a folder dialog here, reads that folder's `SKILL.md` only, and
  holds it to exactly the rules of a save (front matter with a valid name and a
  description, instructions, under 32 KB, text); the file goes in as it was
  written and the page is told how many other files were left. `export` checks
  the skill, opens a Save dialog and writes a new folder or a zip (`<name>/
  SKILL.md`) where the owner chose. The page also lists the skills the inventory
  finds elsewhere (other tools' folders, the home folder), read-only, and offers
  a few starters. `MEFI_STUDIO_NO_SKILL_EDIT=1` makes the page read-only: no
  save, create, delete or import, and no dialog for an import. The page
  (`renderer/skills.js`, **Agents › Setup › Skills**, also in the palette) lists
  each skill with what it is for, where it lives, its size and anything that keeps
  agents from using it (no front matter, no description, a name that does not
  agree with its folder, over 32 KB, over 16 KB so that it loads only when called);
  **New skill** and **Edit** share one editor (name, when to use it, instructions,
  a byte counter, and what the size means) that says what is wrong as you type
  using the host's own rules written again (a test holds the two together), and a
  name cannot change once a skill exists because it is the folder. Delete asks
  twice. The page sends names and text, never a path.

### Command center and the node tree

- Command keeps its interactive canvas elements while transferring their
  drawing contexts to OffscreenCanvas where 2D support is available. Explicit
  canvas fonts can then resolve without a document style update. Resizing
  follows the drawing bitmap and device scale; unsupported previews retain
  ordinary contexts. The far layer remains transparent for background video.
- When the session store cannot be read, Command's hint reads "Desktop store
  not available". Studio asks the store again on its own (5 seconds, doubling
  to a minute), and the hint, the pills and the autopilot switch follow as
  soon as it answers.

- **Tree brightness & outlines**, under Tree modes & movement in Appearance ›
  Layout and Music & video › Audio reactions, provides node and connecting-line
  brightness sliders from 0–200%; independent adjustment switches restore normal
  brightness while retaining each slider value. Optional node outlines add dark
  and light edges around the chosen node shape. These controls also live directly
  in the video's media settings, synchronize across panels, and persist locally.
  Brightness applies to the separate node/connection paint passes; labels, menus,
  video brightness, transparency and tree position remain independent. **Fast
  brightness** (on by default; `fastBrightness` in `mefiStudio.treeDynamics.v1`)
  paints each brightened pass once into a scratch layer and lays it down with one
  filtered draw, instead of filtering every shape; turn it off to get the old
  per-shape path back ([performance.md](performance.md) has the measurements).
- **Tree modes & movement**, in Appearance › Layout and Music & video › Audio
  reactions, shares saved controls across both panels. **Steady** disables music
  and video reactions; **Music**, **Video**, and **Music + video** select the inputs.
  Audio Link must be connected for music; video tracking needs a background video
  and the desktop host. Existing glow, connection, percussion, background and
  camera reaction toggles remain independent. Music sliders also control node
  movement/size, shape deformation and position sway; zero settles each part.
- **Live shape** keeps the chosen layout or smoothly arranges the visible nodes
  in a ring, wave or spiral. Width, height, rotation, horizontal/vertical position
  and node size update immediately in Overview. **Adapt spacing to node count**
  reserves more room for larger trees and reduces node size in dense shapes.
  Nodes keep their identities and work relationships; connections, labels and
  pointer targets follow their displayed positions. Inspect, Follow, manual
  navigation and camera tours take priority over these position changes.
- Video positioning can seek **dark** or **bright** broad regions, with strength,
  optional shape adaptation, movement smoothing and a 5–60 second region hold.
  Samples run every five seconds with two consistent improvements required.
  The sampled footprint follows tree size and node count. Scene changes ease in;
  menus pause sampling, and reduced motion disables automatic audio/video motion.
  Only nine brightness values leave the host; images are never saved or sent.
  Reset restores movement defaults without changing playback or the chosen layout.

- **Automatic 3D Overview** borrows the demo flight's damped motion for a
  gentle pan and changing scale. It frames all stable tree anchors together
  using their current perspective bounds, leaving room for node rims inside
  the measured panel-free rectangle. Hard bounds override easing when a panel
  opens or work arrives. This renderer-only lens never rewrites layout anchors
  or saved zoom: projection and inverse projection share its offset, so clicks,
  connections and new nodes stay aligned. The existing Spin control enables
  motion; paused spin, selection, search, manual navigation, reduced motion and
  hidden-view suspension retain their existing behavior. Fit resets the lens.
- **Zen / demo flight.** Park the mouse at the right edge of Live / Command view for about
  two seconds to start it and hide the pointer; move back into the view, click
  or press a key to return. Open menus, typing and dragging hold it off. This
  shortcut leaves the optional thirty-second idle Zen setting unchanged.
- The flight starts with a wide view, then glides between visible
  branches with their neighbouring nodes in frame. It follows the actual
  layout positions, adapts zoom to the window and perspective, and pulls back
  during travel and every fourth stop. The scene eases toward the
  screen centre while the panels fade. Pan, zoom and tilt accelerate gently;
  waking carries that motion into the return to your previous camera mode.
  Retired or hidden nodes are skipped, and reduced motion keeps the camera still.
- Graph views share theme-aware node finishes, clear selection brackets and
  readable opaque labels. Command's five arrangements reserve parent-label room
  on a fresh layout or Fit; live additions keep their established branch.
  Command, the rail, Appearance preview, Agent brain and Overhead use the same
  eight finishes. Brain maps retains its card nodes and exact port geometry,
  with matching surfaces and typography. The project map uses readable cards
  with labeled relationships and separate branches for undiscovered connections.
- Agent brain wraps wide parallel stages into readable rows and scrolls long
  pipelines. Hover still exposes the full step title and details. Reduced
  motion freezes the scene; hidden canvases suspend their animation loops.

- **Pointer, keys and the card.** The wheel, and a two-finger pinch, zoom
  toward the point under the pointer. Touch and pen drag, tap and focus
  through the mouse's own handlers. Arrow keys belong to the card while focus
  is inside it. Hover follows the node actually under a still pointer while the tree
  spins or glides. A double-click opens whatever a single click selects,
  callout cards and speech bubbles included; on empty canvas it fits the tree.
  The arrow keys and `[` / `]` treat approved-plan groups like tasks and skip
  work that has already sunk into its host. The selected node's card redraws
  when what it shows changes (a task starting or finishing, a session's todo
  count), and a rebuild keeps its focused control, half-typed notes and open
  folds. A finished task held on the board offers only Open in Tasks. Card rows
  that open something are keyboard links. Screen readers hear one short line
  per selection change (`#cmd-announce`); the cards themselves are not live
  regions.
- The toolbar is four labelled groups and **Close**. **Agents** chooses how
  the roster shares work between **Swarm** (across the queue) and **Cluster**
  (one goal at a time). **Camera** holds **Fit**, the **Overview** / **Follow**
  camera modes (`C` cycles Overview, Follow and free) and **Spin**. **View ▾**
  folds Map 2D / 3D (`V`), Labels (`L`) and Zoom into one menu. **Sound** holds
  the **audio dropdown** and **Ambience**. **Spin** is the only control that turns the tree
  (`Space` pauses it); **Overview** keeps the whole tree framed. The two used
  to share the name Orbit. In 3D the Overview turns the tree about its own
  centre (the middle of the smallest circle around it seen from above,
  halfway up its height) and sizes the frame once for the whole turn, so the
  tree spins in place at a steady size with every node in view.
  With the spin running, the camera also drifts inside that frame: a slow
  pan and a gentle zoom that keep the whole tree in view.
- The **Ambience** popover keeps the quick audio-source control beside the
  canvas and links to canonical **Appearance** and **Audio** settings.
  Appearance opens beside the live tree in a compact sidebar. **Theme**,
  **Nodes**, **Layout** and **Interface** switch its controls; the arrow in
  the heading moves the sidebar left or right and remembers that choice.
  The preview keeps **2D**, **3D** and **Fit** in reach. Click outside the
  sidebar or press **Esc** to return to Command: that first click only closes
  Appearance, and a second click selects a node or another menu. Narrow
  windows place the tree above the scrollable controls. Settings search still
  reveals the matching section and focuses its control.
  The toolbar's audio status button opens
  **Music & video** directly underneath it: local music, ad-free radio and
  YouTube / links, with source selection and Connect / Disconnect at the top.
  Audio reactions and recommendations expand in place. The dropdown changes
  size with its visible content and scrolls within the window when needed;
  closing it keeps playback running. Settings › Audio opens the same dropdown
  and keeps the separate sound-effect preferences. Hover either media button
  for 200ms to open the current source's controls without moving keyboard focus.
  A 450ms grace period lets the pointer cross into the menu. Leaving closes an
  untouched hover; clicking the opener or interacting with a control holds it
  open until dismissal. Touch retains click access. Navigation, window blur and
  Zen cancel pending hover opens; media controls remain hidden in Zen.
  **Offer copied media links** checks the clipboard while this menu is open
  and Studio is focused. A new playable link offers **Play**, **Add to queue**,
  **Queue next**, or **Dismiss**; detection never starts playback. It ignores
  current/queued links and keeps dismissed, unchanged links quiet. The option
  is saved. **Show links**, in the menu header, saves whether pasted URLs,
  clipboard offers, recent-link tooltips and queue URLs are visible; hiding
  links masks the paste field while preserving its value and playback.
- **Live work** shows the current worker and step, readiness counts, the
  active agent roster and a ranked queue. Readiness uses a single-line strip;
  compact task cards put the title beside elapsed time, with current activity,
  route and update age below. Preparation, finishing and stopping keep explicit
  state labels. Long commands expand in place, and finished, idle or deliberately
  stopped agents sit under **Recent agents** below the queue. Real agent
  failures remain visible in full. The panel tabs use one row of labels and
  counts with an underline on the selected view; the vertical inspection strip
  retains its icons. Arrow keys navigate the group.
  Workers without an OpenCode session still show
  their latest output, route and update age. Live output is bounded, stripped
  of terminal controls and credential patterns, and updates at most twice a
  second. Checklist percentages remain worker-reported; verification follows.
- The top toolbar's **Agents** dropdown gathers the queue controls (Autopilot, Parallel
  builds, Build mode, Agent mode) under an at-a-glance strip that shows the
  switch, the running builds and their cap, and the coordination mode.
  It keeps the selected node and right-hand panel in place, and links to team,
  model, provider and advanced run settings. **Esc** or an outside click closes
  the dropdown; the sidebar no longer has a duplicate Agents tab. Accepting
  new work and running queued work remain separate controls; Stop all and
  Restart stay operational actions beside the work, and each needs a second
  press.
  An intentional worker stop saves its continuation; its task and session
  history both report that progress was saved, without calling the stop a failure.
- **Parallel builds** defaults to **Machine managed**: admission follows
  measured app responsiveness, with optional manual limits of one to three
  workers. High CPU alone never limits builds.
- **Follow** frames the active task; **Fit** repairs the layout. Pick node style
  (**Classic orbs**, **Soft glass**, **Minimal**, **Halo**, **Crystal**, plus
  the Void collection's **Singularity**, **Prism** and **Sigil**) and
  arrangement (**Constellation**, **Branches**, **Rings**,
  **Helix**, **Terraces**) per project, in 2D or real 3D. Every node style
  moves all the time and faster while its node works (a Sigil's hex cells
  assemble, a Singularity's disc spins up, a Prism's shards orbit); a stale
  session's rim is dashed and it moves at a slower pace; reduced motion holds
  each in a still pose. Wires stop at each node's edge.
- The sky follows the colour theme — Aurora ribbons, Deep space, Nebula,
  Rising embers, Fireflies, Soft bokeh, Warm dust — or pick a **Backdrop**
  (plus Quiet grid and Minimal) in the Ambience pop. **Speech bubbles** beside
  the agents say what each one is doing: a **→** bubble is a finding going
  home, a **←** one is it landing, and a diamond packet rides the line between
  the two agents.
- Every agent wears its role glyph (an eye for the watcher, a hammer for a
  builder, a crown for the overseer…), spins a ring while it works, dashes one
  while it waits its turn, and leaves a coloured wake when it flies to a node.
- **View › Labels** (or **L**) cycles Auto, Updates, All and None. Updates
  shows current task progress and reported code/task updates, hiding routine
  agent chatter and idle names. The choice is saved across launches.
- Sessions, tasks, the assistant and working agents carry a **callout**: a
  leader rising from the orb into a horizontal top bar, the title above it
  with its number (S1, T4…), a check or status mark and the done/left counts,
  and below it a bubble with what the agents think or do there. Cards keep
  their spot while the tree turns and step aside to a compact label rather
  than overlap; hovering one lifts it and softens everything else; clicking
  it (or its orb) **focuses** the node: the camera glides in (scale and pan
  together, less on a parent so its children stay in frame), the tree slides
  over instead of jumping, and the rest of the tree keeps turning slowly
  behind a blur until Esc or an empty click. **Card style** in Appearance
  picks outlined, filled, or auto (filled when hovered, selected or
  running). Whether a launch lands on the workspace or straight in Command
  view is set under **Settings › General**.
- **Inspect mode.** Selecting a node also hands its detail the whole right
  panel — a **Node** tab appears at the head of the strip and takes the panel
  at full window height, with one scroller instead of a card inside a card.
  The panel sits flush against the window's right edge, with a translucent,
  frosted glass surface that lets the canvas show through. It follows the
  Blur menu preference and the system's reduced-transparency preference.
  Everything else steps back to its edge at the same moment: the panel's tabs
  become a 56px icon column pinned over the detail, the dock folds to its
  **More tools** pill, **Legend** and **Usage** keep their glyphs and drop
  their words, and the view toolbar goes glyph-only. Nothing is taken away —
  every collapsed edge peeks back when you hover it or tab into it, and
  **Esc** walks out one level per press: the menus return first with the node
  still open, then the node itself, and the panel goes back to the tab you
  were on. Below 900px the panel is hidden entirely and the floating card
  serves the detail as before.
- Lines say what they mean: the hub link is doubled, a task's anchor is
  dotted and marches while its worker runs, an agent's tether is dashed, a
  finished cluster is stippled, and a done todo's link fades green.
- The Runs tab summarizes recent builds by task, including retry counts and
  the task's current verification or retry state. **Clear** removes the run
  records from the executor ledger. The absorb is the tree's: a finished node collapses
  into its host and its brief stays readable on that card under
  **Absorbed work**.
- **Appearance** (`U`) groups colour themes, the Void collection, node style,
  layout and effects. **Preview canvas** opens the live view and returns to
  the same category. Music and video are managed from the **audio dropdown**,
  outside Appearance. It groups local files, radio, Links, the audio
  link and recommendations. Links plays a pasted or dropped YouTube, Spotify,
  SoundCloud or Vimeo link in that service's embed, and a plain audio or
  video file (a Discord attachment, say) in its own `<video>`. The player lives
  in a floating window across Studio, keeping the same playing frame
  while you navigate. Its toolbar holds a move handle, **Settings**, minimize
  and close above the provider's controls. **Video settings** inside Music &
  video holds **Pin** and the optional **Move aside** (off by default);
  drag the title or any edge to move or resize it. The title and bottom-right
  resize control also accept arrow keys, with Shift for fine steps. In deeper
  menus, Move aside glides out of the pointer's way once; following it, hovering
  or focusing it keeps it still. Pin and reduced motion also prevent dodging.
  Geometry and toggles are remembered locally; automatic moves are temporary.
  Dragging out of the media panel starts from the player's current position.
  **Float player** closes the panel and keeps that same loaded player available.
  **Background** puts the video behind the workspace without intercepting clicks;
  the node tree keeps full-strength nodes and labels over the video, with separate brightness and transparency controls, and
  inactive pages stay hidden beneath Command.
  **Float video** brings back the interactive provider player. **Video transparency** and **Tree transparency** independently control the video and Command canvases, keeping menus readable. Zero transparency means full opacity. **Video brightness** ranges from 25–150% and defaults to 100%, replacing the old fixed 55% dimming; inactive workspace page styles cannot override the tree slider. These values are saved with media settings. Advanced settings close with the media menu; the floating toolbar stays available. All media controls stay hidden in Zen. **Keep tree in dark areas** is a shortcut for the shared video reaction mode. It samples broad on-screen regions every five seconds, requires two consistent improvements and the configured region hold, then smoothly moves the tree. Sampling pauses during menus, manual camera interaction and Zen. No screenshots are saved or transmitted. **Fade on finish**
  dims the media when a known task newly reaches Done, with a notification to
  **View result** or **Restore video**. Historical, dropped and merely awaiting
  verification tasks do not trigger it. Restore video also remains in the panel.
  Minimize keeps a small toolbar with a restore button; **Show player** in the
  panel also restores it. Closing the player stops playback.
  An open player returns after Studio closes or reloads if it was present in
  the last ten minutes, retaining geometry, background/transparency preferences
  and minimized state. Explicitly closing the player or switching sources clears
  this restore record. Native files, YouTube and Vimeo resume their saved position/play state; provider autoplay restrictions can still require Play. YouTube playlist changes update the saved video. Diagnostic launches do not restore media.
  **Explore YouTube** searches public YouTube results inside the media menu; **Play** opens a result and **Next video** advances through those results or the current YouTube playlist. Public search availability depends on YouTube; failures retain the paste-link option. Search data is parsed in the host without executing page scripts and only bounded video summaries reach the renderer.
  **Up next** is a saved queue of up to 50 media links. **Add to queue** appends a pasted link or YouTube result without interrupting playback; **Queue next** inserts it first. Each queue row has **Play now**, **Play next** (move to the front), and **Remove**. **Next video** consumes the queue before explorer results or a provider playlist. YouTube, Vimeo and direct files also consume the next queued entry when playback ends; other embeds can be advanced manually. Repeated videos restart, and late messages from a replaced player cannot skip queued items. Reloading restores the queue without starting it; the separate ten-minute player restoration still governs current playback.
  Audio Link retains its enabled state and selected source. Reentering the node view after a reload reconnects an enabled link; capture/smoke launches stay silent, and denied or disconnected sources offer an explicit retry instead of repeatedly requesting access.
  Video settings also includes **Volume** and **Mute** for YouTube, Vimeo and direct media files. Their level and mute state persist across reloads, and provider volume updates keep the menu in sync.
  Music & video's video panel places the player beside the saved **Up next**
  queue, stacking them on narrow windows. **Use as background** sits directly
  below the video; **Return to player** brings the same loaded player back
  beside its queue. Opening and closing the media panel changes the player's
  position without recreating its iframe. Audio connection and clipboard
  options are grouped below playback. Video links viewed in the browser can
  switch to their supported embedded player for background mode; ordinary
  web pages keep that control disabled.
  **Browse here** opens websites inside Studio's existing media player, with
  an address bar, Back, Forward, reload/stop, Mute, minimize and close controls.
  Ordinary http/https links (including ports and fragment routes) open there
  automatically; embedded players also offer **Browse here** for their original site.
  Opening the browser successfully replaces the current audio source. Playback
  position is not transferred to the website. Moving, resizing or minimizing
  the player keeps its page loaded; closing or switching sources stops it.
  Websites use the full media panel width, with the queue below. Hovering the
  media button opens at the video, and entering the player keeps the panel open
  for playback controls. Scrolling fits the website to the visible panel without
  reloading the page; the website may adjust its layout to the available height.
  Overlapping notifications leave the remaining website area visible and usable.
  Website popup links navigate this same player. Native website content yields
  to Studio overlays, and video background/fade effects are disabled while browsing.
  **Open in browser** remains an explicit action for the regular system browser.
  Sites use an isolated persistent session with no
  Studio bridge or Node access. Camera/microphone permissions and downloads
  are unavailable there; sign-in or protected playback may require the regular
  browser. Spotify Jams retain their explicit Spotify handoff.
  Local music has a record-artwork card with actual playback status, and the
  media menu groups local music, radio and links below a built-in browser launcher. The
  booklet's CSP `frame-src` lists exactly the players `music.js` builds.
  Because a `file://` page sends no Referer, main names Studio to YouTube's
  player (`nameStudioToEmbeds`). Under the player, **Listen together**
  (`renderer/together.js`) follows a room's shared player on the Void Engine
  rooms hub through `scripts/hub-client.cjs`, and **Share what I'm playing**
  feeds the bot's `/nowplaying` (see [community.md](community.md)). Audio input and reactions activate only when
  enabled.
  With the Audio link on, its **Tree motion** reaction lets the music
  smoothly quicken the Overview's spin, sway it round a small figure of eight
  and swell it on the bass, inside room the frame keeps for it.

### Fleet: seats, pods and the branches view

- **Live › Fleet** shows the open project's team the way OpenRig draws a rig
  ([fleet-overhaul-plan.md](fleet-overhaul-plan.md)). Every agent is a **seat**
  with a stable address (`builder-2@project`); each run a seat takes is one
  **generation**, and a retry of a task goes back to the seat that last worked
  it. Seats sit in four **pods**: Lead (lead, companion, foreman, thinker, the
  cluster planner), Build (`builder-1…N`, at least as many as run at once),
  Check (overseer, desk, auditor, the cluster reviewer) and Keep (the other
  roles, the scout).
- The host half is `scripts/fleet.cjs` (pure) and `scripts/fleet-host.cjs`. The
  first reduces what the loop already reports (brain events, executor status,
  board writes, run finishes, worktree merges) into seats, their last 20
  generations, a Recent feed of 300 rows and the **wires** between seats
  (dispatch, handoff, delegation, check, rework, desk, escalation, report,
  mail); the second keeps `data/projects/<id>/fleet.json`, written five seconds
  after a change. `main.cjs` reaches it through five one-line guarded hooks.
  `fleet:update` is pushed only while a Fleet page holds a 60-second watch lease
  (renewed every 30 s), only for the open project, at most twice a second, and
  it waits while Studio is hidden. Snapshots carry clipped titles only: no
  prompts, paths, keys or addresses.
- The page (`renderer/fleet.js`) has an explorer (pods and seats with a status
  dot, walked with the arrow keys) and five views. **Graph** is the branches:
  pods as columns of seat cards, wired by why (a handoff, a delegation, a check,
  rework, a desk question, an ask that reaches you). Each wire is orthogonal
  with a lane of its own (`renderer/fleet-layout.js`). Drag to pan, wheel to
  zoom, **Fit** to see the whole team; under 60% the cards keep only the name
  and state so a big team stays readable. **Table** is a sortable row per seat.
  **Recent** is the feed, with Work / Checks / Asks / Problems chips. **Tree**
  is the team as a node tree. **Health** lists what needs a look: a run quiet
  for ten minutes, an ask open for fifteen, three generations on one task, a
  kept branch, an escalation, and the loop holding ready work (with the loop
  status's own reason and button).
- Selecting a seat opens its **inspector**: what it is doing now, its
  generations, the wires in and out, and **Stop this run** (which names the run
  on screen, so a seat that moved on is left alone), **Open task** and
  **Open in Command**, which lands on the seat's orb, or on its task (or the
  group holding it) once the run has ended. The Command node tree
  itself is unchanged. At 1500 px and under the inspector is a drawer under the
  tab bar, and under 760 px the page stacks.

### The Agent Brain

- Every project keeps a **work event** stream (`work-events.jsonl`): runs going
  out and coming home, steps starting, finishing, growing and folding,
  reports up the tree, desk questions and answers, stage changes, agent mail,
  and the files a verified run read and changed. Every Agent Brain surface is
  drawn from it, so nothing moves without an event behind it.
- A task's **pipeline** is laid out before its worker starts, from the
  Playbook's best recipe for that kind of work or a template, and the worker
  is told its steps. It grows from the worker's todo list and `MEFI_STEP` lines
  (at most 12 steps, 3 new ones per run) and folds finished steps.
- **Agent brain** (`J`) draws it: the companion as the head, the lead, the
  steps, the sub-agents circling the steps they work. A finished sub-agent
  pops, flies home, circles the lead and is absorbed in the chosen node style
  (that look's `done` and `absorb` hooks);
  a report climbs to the head; a desk answer is carried over. **Replay today**
  plays the day back. Its other tabs are the **Playbook** shelf (recipes as
  spines: thickness is runs, colour is how often they verified), the
  **project map**, and the **Seats**.
- The **desk worker** answers `MEFI_HELP` questions on the desk seat's model
  and writes the answer into the worker's next brief; what only the owner
  could answer becomes one ordinary ask. With **Give workers the ask_desk
  tool** on, OpenCode and Claude Code runs get a local MCP tool that waits for
  the answer mid-run.
- **Project map**, under Agents › Workflows, explores systems, parts and files
  as connected cards. Systems with observed co-changes share a branch;
  systems without that evidence stay under **Connections still to discover**.
  Click to inspect a node; double-click, press Enter or
  use **Explore** to enter it. **Back/Forward** restores the selected item and
  camera, while breadcrumbs and **Up** change the level. **Browse** opens a
  keyboard-accessible contents panel: search spans the whole project, including
  files deep in large folders, and the All / Working / Changed filters apply
  to the current level. Large lists have **Show more** rather than dropping
  the remaining files. The map combines the files present in the project now
  (including uncommitted files) with the last 90 days of git history (at most
  400 commits, read every ten minutes) and verified runs' file sets. Past files
  that are gone are marked as no longer present. Systems are the first map's
  areas, else folders; a large
  flat folder splits into the groups of files that change together, named by
  the word they share (Executor, Eyes, Model Lab). Links join systems by how
  alike their change histories are (a notebook changed in every commit links
  weakly to everything), and only each system's strongest three are drawn.
  Every system carries its files, its tasks (done, working, open) and a warmth
  that halves each week. The inspector shows related systems as navigable
  links, tasks, ideas and plans; ideas and plans can be placed on a system.
  Edges mean **Changed together**, not an inferred import or runtime dependency.
  **Contains** branches show the system's parts and files, and exploration
  counts distinguish observed files from files waiting to be explored.
  **Ideas tree** groups saved ideas and tasks by system and progress. Linked
  ideas sit beneath their tasks, and subtasks beneath their parents. Owner
  placements take precedence over observed files and suggested word matches;
  each card names its grouping evidence. Unmatched work stays in **To explore**.
  Branches can be collapsed and searched, and regroup as files are discovered
  or work changes status without editing the original idea or task.
  **Work with Mefi** prepares a contextual Vibe draft. The system inspector's
  **Modify / Experiment / Fix / Improve** buttons do the same for a chosen area.
  **Work here** prepares a task draft with the selected system, part or file;
  selected files also have **Copy path**. A pipeline names the systems it touches.
  Drag or wheel to pan, Control/Command-wheel to zoom at the pointer, or click
  the minimap to move. Arrow keys select spatial neighbours; Shift+arrows pan,
  Home fits, +/− zoom, Backspace goes up, / opens search, and Alt+Left/Right
  travels through map history when the canvas has focus. Camera easing, drag
  momentum, hover lifts and level transitions stop when settled or hidden;
  Off and OS reduced motion snap to the destination. Calm shortens transitions.
  Refresh preserves valid locations and project switches clear map history.
  Narrow windows have an explicit **Inspect / Back to map** pair, and very
  short windows hide the minimap to leave room for the map and its controls.
- The **companion** in the menu foot keeps the needs-you queue with its
  actions in place, greets you after ten minutes or more away (or when the
  machine wakes) with what finished, what stopped and what needs you, and
  rests when nothing runs. The tray tooltip carries the needs-you count.

### Model Lab and routing

- The **model catalog** (`data/models.json`, Models › Catalog) is built by
  `npm run data` (`scripts/refresh-models.mjs`) from the live OpenCode Go
  roster, models.dev and the curated seed `data/curated.json`, whose
  verdicts cite only published prices, pools and benchmarks (no benchmark
  means no index). Its `providerModels` lists the models Studio routes to
  outside Go: Claude Code (models.dev `anthropic`), Zen's OpenAI models
  (`openai`, priced and confirmed by `opencode`) and the z.ai Coding Plan
  (`zai-coding-plan`, list price from `zai`). Each route keeps the explicit
  id list in the seed's `providerRoutes`. The refresher reports stale or
  untracked ids and never adds them itself. Offline it rebuilds these rows
  from the committed catalog. Catalog › **Also tracked** shows them read-only.
- **Model Lab** records per-project latency, delivered tokens/s, errors,
  reported usage and USD cost, with human and model ratings kept separate;
  opening it never runs paid measurements. **Context** previews the current
  task brief within a chosen token budget and reports what was shortened.
- **Community** (Models › Performance) shows, for one enabled model, what the
  Void Engine community's public feed says about it (server ratings,
  release-note claims with their source, observed strengths and weaknesses
  with reporter counts, opinions, tips, a Discuss on Discord link) and
  Studio's own **probes**: seven small fixed tasks with deterministic
  scorers, run only from **Run probes**. Both are kept in user data
  (`model-community.json`, `model-probes.json`) and only nudge routing's
  prior; see [model-community.md](model-community.md) and
  [agent-loop.md §12](agent-loop.md#12-choosing-a-builders-model-the-win-probability-evaluator).
- **Usage tracker** sums two ledgers per day, provider and model: the calls
  Studio made itself (assistant HTTP and CLI routes, Jev, speed probes) and
  every coding-session turn OpenCode's own store recorded for the project
  (the builders' runs on Go, Zen, OpenRouter or the z.ai plan), read on the
  eyes worker. Each connected provider gets its own account reading:
  - **Over the saved key:** OpenCode Go's 5-hour, weekly and monthly windows;
    z.ai's plan quota (credit plans since 2026-07-30, with credits used of
    the cap; an empty plan list reads as "no plan windows"); OpenRouter's key
    spend, its limit, the free-model daily allowance and the signed account
    balance; and the Vercel AI Gateway balance.
  - **Through each coding CLI's own login:** the Studio never reads a CLI's
    credentials and never sends a prompt. Claude Code answers a `get_usage`
    control request on its stream-json channel (5-hour session, weekly, and
    per-model weekly windows). Codex answers `codex app-server`'s rate-limit
    read, and between reads its session rollouts' `token_count` events stand
    in, tail-read from the last eight days. Grok answers its `_x.ai/billing`
    ACP extension (credit pool per period); grok does not exit on end of
    input, so its process tree is ended once it has answered. Antigravity
    answers `/usage` in print mode. These probes start 150–240 MB binaries,
    so they run only while someone is looking (the Usage popover or the
    Provider accounts view asks with `probe: true`), two at a time and one per
    CLI. A reading is kept five minutes and a failure one minute. Callers get
    the last reading at once while a stale one refreshes in the background,
    and the panel asks again every few seconds until it lands.
  - **Local LM Studio:** whether the server answers and which model it
    serves.
  - **No account API** (Zen, TypeSafe, a custom endpoint): the reading says
    so plainly. Zen's per-reply `cost` is recorded, so Zen calls are priced.

  The CLI routes run in their JSON output mode so their token counts reach
  the ledger. Live readings and the local estimate stay clearly separate; a
  plan or subscription reports no per-call cost, so those calls are shown as
  unpriced rather than free. The compact version is the **Usage** popover in
  the Command view's bottom-left corner. It has one card per plan with a bar
  and reset time per window, then balances, then today's recorded calls per
  provider; the Go local estimate appears only while the live Go read is
  down. The pill shows the lead plan's first window and its fullest other
  window, and its dot lights for a failed read, a spent window or an empty
  balance. The full view is **Models › Usage › Provider accounts**. Account reads
  happen when either view opens and every five minutes while Command is
  visible (without CLI probes); the account channels bypass the
  project-switch gate.
- **AI routing** picks who pays — Auto walks an ordered provider list you edit
  in Settings (signed-in coding CLIs first unless *Use subscription logins
  first* is off, then your list; the first usable provider answers, and the
  opt-in fallback walks down the list). When nothing listed can answer, a key
  you saved for a provider outside the list (z.ai, OpenCode Go, Zen,
  OpenRouter or a custom endpoint) still answers, so saving a key never needs
  a routing change; such a key never joins the fallback's retry list. Besides
  Auto: z.ai only, OpenCode Go only, OpenCode Zen, OpenRouter, the Grok, Claude
  Code, Codex or Antigravity CLIs on their own logins, a local LM Studio
  server, or a custom OpenAI-compatible endpoint whose key is optional (a
  keyless local server such as Ollama, `http://127.0.0.1:11434/v1`, sends no
  Authorization header). The chat's "AI connected" gate, the passes, the
  Auditor's AI pass and the Settings pills all read this same walk, so a setup
  the router can answer is never shown as "No AI connected". The LM Studio
  tile reads ready only when its last probe found a loaded model.
  **Model selection** uses Jev or fixed defaults (a fresh install with no Jev
  key reads as Fixed); for builders it is a win-probability evaluator
  (below).
- **Models are saved per provider and per builder CLI**, so switching routes
  never carries one provider's model id into another; a provider with nothing
  saved uses its own default, and z.ai, OpenCode Go and Zen keep the role-wide
  Routine/Heavy overrides. Missing a subscription or key for one option never
  blocks the others — the readiness line names what the selected option has.
- **Each role can answer through its own provider.** *Heavy answers via*
  covers plan specs, briefs, reviews, the overseer and the analyzer read;
  *Routine answers via* covers reading the ask, checks, advisory agents and
  chat. Either can be left on *Same as above*. **OpenCode Zen** is one of the
  providers, with its own tile under Providers, billed to the Zen balance
  with the Zen key or opencode's `OPENCODE_API_KEY`; OpenAI's models there
  go to its Responses endpoint.
  **OpenRouter** has a separate key tile and uses `openrouter/free` by default.
  The Models settings load OpenRouter's live text-response roster, with free
  choices first; select a model for routine or heavy passes, or enter its slug.
  The OpenRouter key also serves its Jev route and account usage reading.
  Plan specs, brain drafts and the analyzer read stay data-only: a CLI route
  (Claude Code, Codex, Grok or Antigravity) answers them through the
  restricted text adapter with its native tools off (`scripts/cli-text.cjs`).
- **Settings › Decision model** chooses where Jev classifier calls go — the Vercel AI Gateway
  (`typesafe-ai/jev`), TypeSafe's Jev API directly (`jev-1.13.0`), OpenCode
  Zen (`jev-1.13`, including its free tier), or OpenRouter
  (`typesafe/jev-1.13`) — each route keeping its own encrypted key. Headless
  setup (PowerShell, from a source checkout) sets the route's variable, then
  runs its flag: `$env:MEFI_STUDIO_ZEN_KEY = "<key>"; npx electron . --set-zen-key`;
  likewise `MEFI_STUDIO_GATEWAY_KEY` / `--set-gateway-key`, `MEFI_STUDIO_JEV_KEY`
  / `--set-jev-key` and `MEFI_STUDIO_OPENROUTER_KEY` / `--set-openrouter-key`,
  and `MEFI_JEV_ROUTE=zen` (or `vercel`, `typesafe`, `openrouter`) to pick the
  route.
- **Auto setup** in Settings reads saved-key flags (z.ai, OpenCode Go, Zen,
  OpenRouter, custom), installed CLIs and (only when nothing else is
  available) a live local server — LM Studio, a saved keyless custom endpoint,
  or Ollama on its default port, which it then saves as the custom endpoint —
  and applies the matching provider, model selection and builder in one pass.
  With no Jev route saved it moves Jev to the route whose key is present
  (TypeSafe, Zen, then OpenRouter), and its note says when Jev cannot pick
  models for the chosen provider (per-task selection covers z.ai GLM and
  OpenCode Go work only). It sends no paid
  request, changes no key, keeps model overrides, reports every choice, and
  leaves the same controls editable afterward. A fresh install runs it by
  itself on its first launch, and the walkthrough's scan step reads its plan,
  so a machine with only a signed-in coding CLI is configured before the first
  task. Its route (and the walkthrough's **Use this setup**) is saved to
  Studio defaults, so folders added later inherit it; an open project that
  keeps its own team gets the same changes. A machine with no builder CLI is
  reported as such rather than as "builders on OpenCode".
- Builders run through `opencode run` (with a Studio-managed z.ai provider),
  the Grok CLI, Claude Code (`claude -p` on your subscription login), Codex
  (`codex exec` on your ChatGPT login), or Antigravity (`agy` on your Google
  account), with automatic one-time fallback to OpenCode, when it is
  installed, for a CLI that never got going (a spawn failure, a wedged start,
  or a quick exit with nothing on stdout that is not a usage limit). A CLI
  installed as an npm `.cmd` shim (Grok from the guided installer) runs
  through `cmd.exe`; Grok's brief goes in a prompt file.
- *Try again with a heavier model* runs that task's next attempt on the
  builder's Heavy-tier model (`opus` for Claude Code, the z.ai heavy model on
  the coding plan, or the Heavy model saved for the CLI), and is offered only
  where such a model exists.
- A **coding tier** in Settings › Coding workers decides what each build may
  cost. **Auto** selects per task on the z.ai route (between the GLM pair) and
  on the OpenCode Go route with no builder model pinned (among up to six Go
  roster models, run as `opencode run --model opencode-go/<id>`; the default
  is `deepseek-v4.1-flash`): every builder attempt is recorded against its
  model and kind of work and settled as a win or loss by the verifier, each
  candidate gets a win probability from that record plus its cost, speed,
  headroom and catalog strengths, and the likeliest winner builds (Jev or the
  stand-in judge answers one probability per model;
  with neither, a model's own record decides once it has enough verified
  outcomes; see [agent-loop.md §12](agent-loop.md#12-choosing-a-builders-model-the-win-probability-evaluator)).
  Other routes use the CLI default. **Free** runs a free model one
  worker at a time and never falls back to a billed default; **Fast** runs the
  quick economical model (GLM 5.3 Flash on the z.ai plan, `sonnet` on Claude
  Code); **Heavy** runs the high-end one (GLM 5.3, `opus`). Tier models are
  saved per builder CLI, and the Settings line shows what each tier resolves
  to before anything runs. Under Auto, any provider/model you pin for
  OpenCode runs on every route and is never re-routed; only the first scan's
  free suggestion yields to the z.ai plan.
- Keys live in the OS keystore (`safeStorage`; DPAPI on Windows); their
  ciphertext persists in `auth.json` beside `settings.json`, so preferences
  stay copyable and credentials stay machine-bound. Headless
  setup (PowerShell): `$env:MEFI_STUDIO_KEY = "<key>"; npx electron . --set-key`,
  and the same with `MEFI_STUDIO_ZAI_KEY` / `--set-zai-key` and
  `MEFI_STUDIO_CUSTOM_KEY` / `--set-custom-key`; unset the variable afterwards.

### Verification, storage and experiments

- Overseer checks run in the folder captured when the worker was dispatched;
  each result records that working directory. A folder without `package.json`
  never uses Studio's checks as its evidence. Studio selects the project's
  declared `check` or `test` npm script, its check wrapper or LÖVE harness, or
  a root `tests.js`, `tests.cjs`, `tests.mjs` (also singular `test`) file. If no
  supported check exists, verification reports that limitation and cannot
  automatically complete the task from edits alone.

- A finished attempt settles to `awaiting_verification` with its evidence
  (sentinel, exit code, spawned session); failed or pending checks block
  completion, and unavailable evidence waits without consuming a retry.
- The JSON views are the authoritative board. `node scripts/reconcile-board.mjs`
  repairs a backlog offline, and `node scripts/reconcile-store-fork.mjs`
  (`--dry-run` to preview) syncs the missing slice with the packaged app's store.
- The **Policy Lab** is observation-only: dispatches append episodes under
  `data/policy-lab/`, and `npm run policy-lab` replays candidate configurations
  against them. No live dispatch changes are made.
- The **Jev intake classifier** runs in shadow mode at admission, recording
  `jev-proposal` events; it can never suppress work, merge tasks or spawn
  agents. The governor's kill switch is `settings.jevShadow === false`.

### A-Eyes, tools and diagnostics

- **A-Eyes** reads the OpenCode session store read-only: change feed with diffs,
  per-session totals, PNG evidence with pins, and a log tail. Clicking a node
  in the node-tree preview filters the feed and focuses the assistant.
- The **session explorer** (`E`) carries the always-on thread, collateral
  watch, local Auditor and request inbox, with checkpoint actions
  (Reference / Explore / Restore / Expand).
- The **Analyzer** (`A`) compares plans and notes with current source, listing
  `file:line` evidence, missing references and unverified completion claims.
  It runs locally; the optional AI read sends bounded excerpts only when asked.
- **Tasks**, **Ideas**, **Overhead** and the **Performance profiler** cover task
  logs and references, a feature-idea inbox and graph, task-to-session mapping,
  and in-app frame/scope/hitch capture with JSON export.
- **Settings › Diagnostics** gathers the speed probe, **Open profiler**, **Run
  auditor**, **Machine** and **Report a problem**. The auditor's findings and
  the machine readout open in the Explorer, where the machine controls stay.
- **Report a problem** (`renderer/report.js`) builds a small bundle on this PC
  that the owner reads in full before anything is saved: `manifest.json`
  (Studio's version, the install kind, the OS, the model route and the builder
  in use), `tasks-summary.json` (one line per task: state, builder, checks),
  `trace-tail.log` (the last 1,000 rows of Studio's log), `builders.log`
  (recent builder output) and, after a crash, `crash.jsonl`. Every file is
  redacted the same way: `scripts/redaction.cjs`, then this PC's user and PC
  names, e-mail and network addresses, more token shapes, the project's and
  Studio's folders, and long drive paths cut to their last two steps; **Replace
  task titles with numbers** swaps every task title and the project's name for
  `Task N` and `Project 1`. **Save zip…** (`report:save`) asks where to save
  (Documents may live in OneDrive), writes exactly the bundle that was
  previewed (`report:preview`) and shows it in Explorer. Nothing is uploaded or
  sent: the owner attaches the file to a message. A report never holds
  `settings.json`, the sign-in files, the vault, screenshots and evidence or
  project files; that list is in `crash-report.cjs` (`NEVER_INCLUDED`), shown
  beside the file list and tested against it. The rules are pure
  (`scripts/crash-report.cjs`), the zip writer is `scripts/zip-lite.cjs`, the
  host is `scripts/report-host.cjs` and main.cjs's "Report a problem" block.
- **Notifications** (Settings › General, `renderer/alerts.js`) tell Windows
  when something waits on the owner: a question, an approval or a permission
  (`need`, `perm`), a task that failed after Mefi stopped retrying (`fail`) and,
  when switched on, one that finished (`done`). Nothing is sent while a Studio
  window is in front (shown, not minimized, focused) with somebody at the PC (a
  locked screen, or ten minutes without input, counts as away), nothing inside
  quiet hours, nothing about the same task and kind twice in fifteen minutes, and no
  more than twelve an hour; the words are generic ("Something needs you")
  unless the owner chose task titles, because Windows keeps notification text
  in its history. A thing must still be waiting twenty seconds after it came up,
  so a question the assistant answers by itself never pings, and a burst is one
  notification. The taskbar button flashes until Studio is focused and carries a
  red count of what waits on the owner (the needs-you digest): the numbered
  overlay icon is drawn in `scripts/badge-icon.cjs`, without a canvas, at 16 px
  or 32 px for a scaled display. Quiet hours are the Discord remote's own
  (`settings.remote.quiet`): one clock, shown and changed from both cards. The
  defaults are need and failed on, finished off, flash and count on, sound off,
  quiet hours off. The rules are pure (`scripts/alerts.cjs`: `decide`), the host
  is `scripts/alerts-host.cjs` (queue, settle, look, show, click) and main.cjs's
  "Notifications" block holds four one-line hooks (a question asked or
  answered, the tasks the owner cares about, a project switch, the window's
  focus). The bridge is `alerts:get`, `alerts:set` (validated) and `alerts:test`
  (it waits up to a minute for the owner to look away), and one push,
  `alerts:open { kind, id, taskId, projectId }`, when a notification is clicked:
  main brings Studio up first and the page opens the task (else Home).
  Windows needs an application user model id for a toast; it is fixed at
  `MefiStudio.StudioAIPlus` so a portable, a moved and an updated copy are one
  app. `MEFI_STUDIO_NO_ALERTS=1` or the master switch turns all of it off, the
  id included; `MEFI_STUDIO_KEEP_APP_ID=1` leaves only the id to Electron (for a
  taskbar button pinned under the old id, which Windows groups by it).
- **Studio closed unexpectedly.** Studio writes `data/session-marker.json`
  (`running`) at launch and closes it with a reason on a quit, on any exit with
  code 0 (the update restart and the roll back are `app.exit(0)`) and when
  Windows signs out; a marker still `running` at the next start is a session
  that never closed. A row goes to `data/crash.jsonl` (the last 50 rows of the
  last 7 days) when the window dies or hangs, main throws or the GPU process is
  lost. The next start says so once (`report:crashed`, sent when the page is up
  and, in the page, when the startup gate is gone): one toast with **Review the
  report**, which opens the card, and **Dismiss**. A clean quit, an update
  restart, an update that was rolled back (its own note says so) and a
  development run that was only stopped never say it.
  `MEFI_STUDIO_NO_CRASH_PROMPT=1` or the switch in the card silences the toast;
  the record is still written.
- **Settings › Discord Server Styler** starts the bot and local dashboard from
  a sibling `discord-server-styler/` checkout or `MEFI_STYLER_ROOT`, shows
  whether the bot is online or needs setup, and can open the dashboard or bot
  folder. Bot credentials stay in that project's ignored `.env`.
- **Machine coordination** watches test leases and live processes, holds new
  starts when Studio becomes laggy, and auto-kills strays, hangs and over-age
  runs (every kill is logged and queued to the inbox).

### Live update

Concurrent `build-booklet` runs write separate temporary files, then replace
the generated booklet with bounded retries for Windows file locks.

Studio watches its own source tree: CSS restyles in place, `scripts/*.mjs`
modules hot-swap, renderer files reload with tab, selection, scroll and focus
restored, and `main.cjs` restarts the app. Edits are batched, changed scripts
are syntax-checked first, and a broken file or three restarts a minute **hold**
the update instead of crashing. The `data/` directory is never written by the
updater or packaging.

An automatic live restart waits for current workers to finish saving and for any project
change to complete. New workers stay held while the update drains. Deferred
retries keep the update status current without repeating identical toast
notices; a changed reason or a new update can announce itself again.

**Restart now** stops every coding agent, saves its latest task, checklist and
recent output, then applies the update and relaunches Studio paused. **Resume**
continues the saved work. The restart waits for worker saves and project changes;
an update that fails validation or cannot save agent progress stays in the app
with an error so it can be retried.

### Release updates

A packaged copy also reads the repository's latest GitHub release every 20
minutes. When a newer build exists, **Settings › Updates** shows **Update to
vX.Y.Z**: it downloads the release zip, verifies the published `.sha256` (or
the API digest) when one exists, stages the portable folder, and a helper
script waits for the app to exit, copies the payload into place — never
`resources/app/data` — and relaunches. In development the checker only
reports; the live update above applies source changes.

**The safety net.** The helper that installs an update is written by the build
being replaced, so nothing inside that build can notice the new one is broken.
It therefore keeps a copy of the running build first (everything but
`resources/app/data`, in `%LOCALAPPDATA%\MefiStudio\rollback\<install key>`; a
copy that cannot be made skips the update), starts the new build and waits up
to two minutes for `data/boot-health.json` to carry a `healthyAt` from this
launch. The renderer stamps it (`boot:healthy`, sent as the shell's scripts
start); a window that loaded and stayed up for 45 seconds is the fallback, so a
shell that forgot to report is not undone. A build that exits, or is silent, is
stopped and started once more; the second failure mirrors the saved copy back
over the install (`robocopy /MIR`, data excluded), writes
`data/update-result.json` and starts the old build, whose next launch shows the
note once and removes the file. **Roll back** (Settings › Updates,
`release:rollback`) runs the same restore by hand while the copy still describes
this install. The build is watched only if its own `main.cjs` still names
`boot-health.json` (`releaseWritesHealth`), so an old build that cannot report is
copied but never undone. The records' shapes are in `scripts/update-safety.cjs`,
the helper's PowerShell in `scripts/release-updater.mjs`, and
`tests/update_rehearsal.test.mjs` runs the real helper against a scratch install
(Windows only). Because the helper is written by the installed build, a release
protects the updates made from it, not the update that installs it.
`MEFI_STUDIO_NO_ROLLBACK=1` restores the plain swap.

**What's new.** After an update installs, Studio says what changed, once, in
plain words: one toast, "Studio updated to 0.5.0", with a **What's new** action
that opens a small sheet with that version's notes and **Got it**. It never
opens a window by itself, and a first install is silent. The words are
`assets/whats-new.json`, `{ "<version>": ["one plain sentence", ...] }` for the
last five versions with notes, written from `CHANGELOG.md` by
`scripts/release-notes.mjs` whenever `scripts/package-portable.mjs` runs (so a
package carries the notes of its own version; the file is committed, and
`node scripts/release-notes.mjs --check` fails when it no longer matches the
changelog's released sections; `tests/release_notes.test.mjs` runs that check on
the repository). A bullet's sentence is its bold lead; a bold label such as
"**Trace** (Live, beside Activity): ..." joins the bullet's first sentence;
`<!-- notes: ... -->` inside a bullet says the sentence itself, and
`<!-- internal -->`, an "Internal:" or "Tests:" lead or a "### Internal"
heading keeps a bullet out. At most six sentences a version. The host side is
main.cjs's "What's new" block (`release:whats-new`, `release:whats-new-seen`
and `release:whats-new-set`, all app-wide) over `scripts/whats-new.cjs`: what
has been read is `settings.whatsNew` `{ on, seen, announced }`; a missing
`settings.json` at launch is a fresh install and its version is sealed as read;
a build older than the one already read (a roll back) says nothing; a toast that
was shown is not shown again at the next launch, and the notes stay in
**Settings › Updates**, marked New until read. The page waits for a visible
window and for the startup gate before it makes the toast (the gate hides the
page and sits above every toast). `MEFI_STUDIO_NO_WHATS_NEW=1` or the "Tell me
what's new after an update" switch there turns the toast off.

Build and publish a release with `node scripts/package-release.mjs --version
vX.Y.Z --publish`, or push a `v*` tag and let
`.github/workflows/release.yml` run. A private repository needs a read-only
token: save one in Settings › Updates, set `MEFI_STUDIO_GITHUB_TOKEN`, or let
Studio reuse the GitHub CLI's `gh auth token`.

The packaged `Mefi Studio AI+.exe` is Electron's `electron.exe`, stamped with
Studio's product name, version, copyright and icon (`scripts/stamp-exe.mjs`).
Windows then shows Studio, not "Electron", in Task Manager, the file's
Properties and SmartScreen. The tested release workflow proposal in
[release-workflow-signpath.yml](release-workflow-signpath.yml) adds a packaged
app smoke launch, optional SignPath signing and a hosted-runner gate. It is
pending activation with a GitHub credential allowed to change workflows;
the active release workflow remains unchanged. [code-signing.md](code-signing.md)
holds the policy, activation steps and service setup.

### Git sync: Push, Pull and GitHub linking

The **Git chip** (`renderer/git-sync.js`, `window.MefiGitSync`) sits beside the
project name on Vibe's home and at the end of the section bar on every other
page. It draws one **model** the host builds and pushes on `git:state`: an id
from a fixed table of 31 states (in sync, "2 to push", "3 to pull", both
changed, only on this PC, no commits yet, signed out, held back, and so on),
its label, tone and glyph, one plain sentence, detail lines, and at most one
primary and one secondary action. The renderer only maps an action id to a
bridge call; the wording and the choice of state live in
`scripts/git-link.cjs`, which is pure (states, `describe()`, name and ignore
rules, and the sentences for what git and gh say when they refuse).

Who does what:

- `scripts/git-actions.cjs` runs git and gh with argument arrays, no shell and
  prompts off: `glance` (two local calls, an unborn repository is "no commits
  yet", not a detached HEAD), `preview` and `save` (only the previewed,
  unblocked paths, an intent-to-add then a path-limited commit, never `add -A`
  or `--no-verify`; private keys, tokens and `.env` files stop a file, files
  over 50 MB warn and over 100 MB are refused), `pushBranch`, `publish` (private
  by default, public only when the exact `owner/name` is typed back, the
  `.gitignore` written before the first add, idempotent on retry) and `link`
  (from the account's own list only, unrelated histories refused).
- `scripts/git-host.cjs` is what `main.cjs` calls ("GitHub link" beside the
  pc-setup handlers): it binds each call to the project that was open when the
  request began, runs pull, push, rebase, save, publish and link one at a time,
  builds the model from a local glance, the last sync result, the cached
  account and what is running, and pushes it. The default branch pushes through
  `syncProject(true)` so the project's own check, the lost-work guard and the
  vault heartbeat still apply.
- The bridge (`preload.cjs`) forwards named plain fields only; `git:*` waits for
  a project switch like `sync:*`, while `projects:glance` and
  `pc-setup:account` answer before any project is open.

Studio commits only from **Save and push**: with uncommitted files the chip's
button opens that dialog, and nothing is saved that you did not tick. **Publish
to GitHub** and **Link to a repository** are dialogs too (`showPublish`,
`showLink`, `showSignIn`, which New app and the launch screen can call).
Sign-in uses the same setup window as Friends › Your PCs and is polled until an
account appears; Studio never sees a password or a token. The launch screen's
rows carry the same chips through `projects:glance` (local, no network, three
at a time, a second and a half each).

### Attempt review: changed files, Accept and Revert, advisory checks, before and after shots

A task that a builder has worked on has a **Changes and checks** section in its
Evidence tab (`renderer/review.js`, `window.MefiReview`; Tasks › a task ›
Evidence). It opens by itself for a task that ran, reads nothing until it is
open, and has three panels: **Changed files**, **Checks** and **Preview**, and
a small "What Studio keeps for each attempt" area with the three switches. The
page only asks and shows; the host (`main.cjs`, the "Attempt review" block)
keeps the record. Nothing in it can fail, stop or slow a run beyond one short
wait.

**The pictures.** When a builder run starts (after its worktree is prepared,
while its prompt is built) and again when it ends, the host takes a picture of
the folder the run works in (the project, or the run's own worktree): a git
commit that only the refs `refs/mefi/attempts/<task>/<n>/before` and
`.../after` point at (`scripts/attempt-snapshots.cjs` is pure: names, parsing,
the revert plan; `scripts/attempt-snapshots-host.cjs` runs git). It is built
with a temporary index (a copy of the real one, named by `GIT_INDEX_FILE`:
`git add -A`, `write-tree`, `commit-tree`, `update-ref`), so the person's
index, HEAD, branch and working files are never touched, and `.gitignore` is
honoured because git does the adding. Files over 5 MiB (2 MiB for a binary),
or past 64 MiB in all, are left out and named; a folder where more than 20,000
files changed gets no picture and says so. Git runs without a shell and
without prompts, with Studio's own keys withheld, under a fixed identity
("Mefi's Studio"). Attempt numbers are per task and shared with the shots.
Each task keeps its newest 20 attempts (300 tasks); older refs are pruned.

- **Local only.** The refs are never pushed (Studio's own sync pushes branches
  and nothing else; a test pushes to a bare origin and finds no `refs/mefi`).
  Nothing that builds a problem report, a support bundle or an export may
  include them: `refs/mefi/**` and `<project data>/attempt-evidence/**` (the
  shots and check results, which live in the project's data folder, never in
  the repository) are off limits there. A folder that is not a git repository,
  has no git, sits inside another repository or has snapshots switched off has
  no pictures, and the section says which.
- **Shared folders.** Two runs working in the same folder see each other's
  changes in their lists; both attempts record that, and the section says some
  files may not be from this attempt. A run in its own worktree is listed from
  either folder, and its files can be put back in the project once merged.
- **Changed files** (`tasks:changes`, `tasks:diff`): the files between the two
  pictures from `git diff`, with +/- , added, deleted, renamed (with its old
  name), binary, link and submodule marks, and for each whether it **can be
  reverted**, **changed since** (edited after the attempt ended) or is **back
  as before**. A running attempt is read from the folder as it is now (kept 8
  seconds so a busy board does not make git read the folder again and again)
  and cannot be accepted or reverted. One file's diff comes on demand, cut at
  200 KB or 2,500 lines.
- **Accept** (`tasks:accept`) records the owner's word on the card
  (`task.acceptedAttempts`: attempt, run, time, "owner") and changes no other
  field; it is not Done and does not touch Done. It can be undone, and it waits
  while a worker runs.
- **Revert file / Revert attempt** (`tasks:revert`) put files back to the
  start picture, and only files in the attempt's own change set: a file is
  written back only while it still holds what the attempt left (otherwise the
  whole revert refuses, names the files and changes nothing, and offers to
  revert the unchanged ones), a file the attempt added is removed only while it
  is still the attempt's copy, renames are undone both ways, a link is put
  back only on platforms that make links, and a submodule or a type change is
  refused. Before a byte moves Studio keeps a
  safety picture (`.../<n>/reverted-<time>`), so a revert has an **Undo**
  (`undo` with its receipt). Files are written to a temporary name and renamed,
  inside the project folder's real path (a link pointing out of it is never
  written through), with git's own line-ending and attribute conversions, and
  a part-way failure puts back what was already written. Nothing runs
  `git reset`, `clean`, `checkout .`, `stash` or `commit`. A revert refuses
  while anything works in the folder, including a finished run's merge-back,
  and is checked again after the safety picture. Reverting the whole attempt
  first checks that the task can be reopened (the ordinary status path's own
  refusals), then reopens it through that path and removes the Accept for that
  attempt. Files git ignores, such as `node_modules`, are not in the picture
  and cannot be restored.

**Advisory checks.** After an attempt that changed something and was not
stopped by the owner, the project's typecheck and lint (the build only when
`review.advisoryBuild` is on) run in the run's folder; see docs/agent-tools.md
"Checks and logs for builders" for what a project has, the limits and the
builder tools `run_check` and `project_logs`. Results are kept at
`attempt-evidence/<task>/<n>/checks.json`, shown under Checks as "Advisory,
never blocks Done", and each check has a Run button (a build writes files, so
it runs only on request and only while no builder works on the project).

**Before and after shots.** When Studio's own project preview is running, a
hidden window takes a 1280 x 800 PNG at the start and at the end of an attempt
(`scripts/attempt-evidence.cjs` is pure: whether to capture, which requests
are allowed, names, pruning and the sentences; `attempt-evidence-host.cjs` keeps
the files; `evidence-window.cjs` owns the window). The window is an offscreen
`BrowserWindow` that is never shown, focused or in the taskbar, sandboxed, with
no Node, context isolation on and an in-memory session; only the preview's own
localhost origin (and data: or blob: pieces of the page) may be requested, no
pop-up, download or permission is granted, a redirect elsewhere is stopped, and
it is given up on after 15 seconds and closed. A worktree run's "after" shot
waits for its merge, because the preview shows the project's folder; if the
work was not merged there is no shot and the page says so. Files live in
`<project data>/attempt-evidence/<task>/<n>/{before,after}.png` (with
`meta.json`); each task keeps pictures for its newest 10 attempts and folders
for 20, and the whole folder stays under 200 MB. A picture over 6 MiB is not
kept and one over 3 MiB is listed without being sent to the page. With no
preview running nothing is captured and the page says "The preview was not
running when this task started." A screenshot can show a secret, so they stay
on this PC and are never added to a problem report.

**Settings and kill switches.** Each of the three has a setting
(`settings.review`, on by default except the build) and an environment
variable that wins over it and shows in the section as "Switched off for this
launch":

| Part | Setting | Environment variable |
| --- | --- | --- |
| Before and after pictures, the changed-files list, Accept and Revert | `review.snapshots` | `MEFI_STUDIO_NO_ATTEMPT_SNAPSHOTS=1` |
| Advisory checks after an attempt, `run_check`, `project_logs` | `review.advisory` (and `review.advisoryBuild`, off) | `MEFI_STUDIO_NO_ADVISORY_CHECKS=1` |
| Before and after shots | `review.shots` | `MEFI_STUDIO_NO_EVIDENCE_SHOTS=1` |

Switching one off leaves the other two running. With all three off a run is
not touched at all.

**How a run is protected.** `spawnNextJob` reaches the block through `typeof`
guards and one door that drops a throw or a rejection. The worker starts when
the start picture and shot are done or after 25 seconds (the shot is given up
on after 8; a late picture is never kept), and the launch gates are read
again after that wait, so a stop or pause that landed meanwhile cancels the
claim and drops its picture. The end picture, the after shot and the checks run
in the background and are not awaited, except a worktree run's merge-back,
which waits for them for six minutes at most. A failure is one log line with
the kind of error and the run id, never a message or a path. The heavy read of
a folder is limited to three at once.

**Known limits.** A project folder nested inside another git repository gets
no pictures (the outer project owns the list). Parallel runs sharing one
folder are flagged, not separated. The build writes files, so it is off by
default and, run by hand, may leave a kept worktree dirty. Shots need Studio's
own preview; an app the person runs elsewhere is not captured.

### Community

The **Void Engine Discord** is where people share what they build with
Studio, swap model setups and listen together. Nothing in Studio is locked
behind it: every theme and node style, the two-tone Void collection included,
is free for everyone. **Community** at the foot of the menu opens Settings ›
Community, the card that holds the link. The full flow is in
[community.md](community.md).

**Linking**
- It is optional. Nothing reaches Discord until you choose **Link my Discord**
  in Settings › Community. **Listen together** and the rooms hub use the link.
- Main then runs an OAuth2 PKCE login as a public client, with no client
  secret. The browser returns to a one-shot listener on `127.0.0.1` (ports
  53134–53136).
- It reads your Discord id, names and roles in the Void Engine server.
- After that, a watcher beside the release watcher re-reads them every seven
  days, sooner after a failed check (1 hour, 6 hours, then daily). It wakes
  hourly, contacts Discord only when a check is due, and stops with the other
  watchers when Studio closes its last window or installs a release. **Check
  now** can run one at most once a minute.
- A failed check keeps the last answer. "Not a member" is recorded at once. A
  refused grant asks you to link again: Settings › Community offers **Link my
  Discord**.

**Storage**
- The public half of the link and the card's cadence are kept in
  `settings.community`.
- The refresh token is encrypted with `safeStorage` in its own
  `community-auth.json`, and the access token stays in memory. Neither
  crosses IPC.
- **Unlink** revokes the grant at Discord and deletes the file.

**The weekly card**
- It invites people who are not in the server to join. It waits three days
  after the first launch, then shows at most weekly, and monthly after four
  ignored showings. A linked member never sees it.
- It appears only at a quiet moment, never during the walkthrough or while
  you type.
- **Not now** snoozes it for a week and **Don't show again** stops it.

**Leftovers from the retired lock.** Earlier builds kept the Void collection
for members. A Void choice saved in
`localStorage["mefiStudio.music.premium.v1"]` moves into the ordinary
preferences at load and the old key goes; the boot hint
`mefiStudio.community.v1` is removed; a `localStyleUnlock` field in
`settings.json` is no longer read. The rules live in `scripts/community.cjs`,
the network calls in `scripts/discord-oauth.cjs`, and the renderer side in
`renderer/community.js` (`window.MefiCommunity`).

### Shared decision context

Both Mefi seats receive `assistantDecisionContext`: the current mode and
switches, the last eight decision reasons, open For you items, top learned
preferences, the focused task's desk answers and the last four owner lines.
The chat payload keeps this after Needs you and before the larger board.
Only the current owner message authorizes an action; saved context is data.

An **immediate confirmation** belongs to the previous owner turn, with exactly
one open chat confirmation or newly shown suggestion. A bare yes cannot select
among several cards or revive a question from an unrelated earlier turn.
Chat Undo selects the named saved decision or the latest active decision.
An **inbox identity** hashes the saved request's scope; promotion refuses an
outdated identity and preserves the request's agent/owner origin.
