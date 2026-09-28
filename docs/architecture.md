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

Agent setup now exposes per-role web search, project reads and MCP tool
allowlists beside selected skills. The host executes bounded research turns
for model calls; OpenCode and Claude builders receive the same tools through
MCP. See [Agent tools](agent-tools.md) for setup, execution limits and the
distinction between Studio permissions and native coding CLI access.

The detailed feature walkthrough that used to live in the README. It is
written in Studio's own vocabulary, so start with the glossary. For first
steps read [GETTING_STARTED.md](../GETTING_STARTED.md); for the code-level
walk through the agent loop read [agent-loop.md](agent-loop.md).

The current navigation, configuration scope and companion behavior are described in [Unified Studio](unified-studio.md). Home, Work and Agents own the main workflow; agent setup is no longer spread across Settings, Command and Seats.

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
desk escalations always stay with the owner. Grants, irreversible changes,
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
| **Menu** (the rail) | New task and Search sit above three main destinations: **Home**, **Work** and **Agents**, with one local row for the current group's views. Recent tasks belong to the current project; Settings and Help stay at the foot. Help contains Start here, Shortcuts and Community. The project selector at the top opens the project panel. The registry in `renderer/nav.js` preserves existing shortcuts and destination IDs. |
| **Workspace** | The home screen (`H`): current task, app preview and conversation. Project queue, Studio status and setup information expand when needed. |
| **Command view** | The 3D node tree (`D`): sessions, tasks and agents as orbs, with a right panel for Work, Assistant, Runs and Ask, and agent settings in the top toolbar. |
| **Booklet** | Historically the single-file model catalog; today `renderer/booklet.html` is the whole app bundled into one file by `npm run build-booklet`. The **Model catalog** tab (`1`) is the part that kept the name. |
| **Model Lab** | The previous name for Models' **Performance**, **Usage** and **Context** views. Shortcut `2` opens Performance. Usage keeps recorded calls separate from provider account readings. Catalog insights contains published benchmark charts. |
| **Activity & evidence** (A-Eyes) | Tab `3`: a read-only view of the OpenCode session store: change feed, diffs, screenshots with pins, log tail. The "eyes worker" is the thread that reads that store. |
| **Settings** | `4` or `Ctrl ,`: four single-pane categories, **General**, **Appearance**, **Audio** and **System**. Providers, routing and run behavior moved to **Agents › Setup** (Team & models, Providers, Routing & fallback, Run behavior); the old Connections, Models and Automation links redirect there. Search finds individual controls and opens their category and containing disclosures. `MefiNav.go("studio", { category: "appearance" })` opens a category; legacy section links such as `settings-updates` still work. |
| **Preferences** | General holds names and startup. Appearance holds themes, motion, blur, node styles and canvas effects; Audio links to the music dropdown and holds sound effects. Older Preferences and Your Studio links resolve to General. |
| **Diagnostics** | Settings › System: speed probe, profiler, auditor, machine tools and connection log. Auditor and machine links reveal Sessions' Diagnostics panel. |
| **Search Studio** | The palette (`Ctrl K`), once called Key commands. It finds any page, tool, Settings card, action, task, node or model by familiar terms, and groups its results by menu section. |
| **Help** | The menu-foot popover containing onboarding, shortcuts and Community. These destinations are also available through Search; late-registered Community remains supported by the navigation registry. |
| **Task** | One unit of work on the project board, with a brief, acceptance checks, prerequisites, attempts and evidence. New cards gather local references automatically when Automatic references is on; the configurable scout can use GPT-6 Luna on the fast tier to choose one verified starting file. |
| **Idea** | A note in the feature-idea inbox; it becomes a task only when you or **Work through backlog** promote it. |
| **Plan** | A structured route from an unclear idea to tasks: unknowns, decisions, a specification you approve, then tasks. |
| **Session** | One coding-worker run recorded in the OpenCode store. Tasks map to sessions in **Overhead**. |
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
| **Companion** | The roaming character (named under General): click it to talk, see what it and the team are doing, handle its needs-you queue, suggest work or take its picks, meet friends' companions, or set its personality (Straight work, Balanced, Friendly & expressive). It also gives a welcome-back digest, can be petted, and covers this project or all of them. Its default model is GPT-6 Luna on Zen at medium reasoning and fast service when Zen is connected. |
| **Orb, callout, absorb** | Command-view vocabulary: an orb is a node, a callout is its floating card, and absorb is a finished node collapsing into its host. |
| **Node style / `MefiNodeStyles`** | How a node is drawn: one of eight looks (five classic, three in the two-tone Void collection), painted on both the Command view and the tree rail by `renderer/node-styles.js`. Each look owns its body and may take over the agent ring, hub dress, work orbit, arrival, selection, wires, pulses and landing; per-node motion records keep every node animating, and reduced motion freezes each look to a still pose. |
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
  remembered across launches.
- Vibe shows only what has something to say. A card appears while it has
  rows (Freshly done covers the last half day) and a quiet project gets one
  calm line instead of empty boxes. The dock always has Tasks, Team and More;
  Watch steps in while agents work, Plans while a plan is in play, Ideas while
  fresh ones wait. With cards up on a short window the greeting and the
  starter chips step aside.
- Vibe's menus are its own (`renderer/vibe-panels.js`): Tasks, Plans, Ideas,
  Team and Settings open as a compact panel beside the front door, one side
  panel at a time with the conversation and the decision drawer, and a wide
  window moves the cards over to make room. Rows open their detail (Back or
  **Esc** steps out); each action uses the host call its Build page uses: a
  task can be started, stopped, dropped or given a note for its next attempt
  (its saved notes reach the worker's brief), a finished one sent back with
  **Ask for a change**, an idea built, kept or dismissed. Team shows who is
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
  with their reviewed scopes, and **Make it one task** drops the unstarted
  steps so the card runs whole. Anything that cannot be sized keeps it one card.
- **MEFI — Modify, Experiment, Fix, Improve** gives Vibe four starting points
  for evolving the open project, including Studio itself when its repository
  is selected. Pick an approach, describe the change, then talk it over or
  **Build it**. The approach and selected map area stay with that project's
  draft. **Suggest a next step** reads project context through the planner and
  returns suggestions with reasons and file references. **Add to draft**
  appends an editable brief; **Save idea** keeps a note in the Ideas tree.
  Asking for or saving suggestions does not queue work. The existing Build
  action and permission settings still control execution.
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
- Vibe can run on its own. When something holds every agent back, a banner
  under the box names it and carries its fix: **Start agents** after a launch
  that left them off (the launch screen's plain Open), **Resume** when new
  work is paused, **Connect an AI** when none is connected. **Build it** says
  when its task will wait for that. Needs you lists only what cannot move
  without you, one row each: decisions, builds waiting for your go-ahead under
  the permission settings (the drawer shows the brief, approves its reviewed
  scope, and links to those settings), and stuck tasks (the drawer shows why and
  offers Try again, Resume or Run anyway, It's done and Drop it). Work the
  checker is still verifying sits under Building now as "checking its work".
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
  (Command, Pipelines, Sessions, Activity, Trace, Overhead), Workflows (Brain
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
  control), Tools & skills (per-agent web search, project reads, MCP tools and
  skills, plus task-context gathering), Machine & app (keep awake, tray,
  resource manager limits, updates, companion reach, GitHub token), Look and
  Finish. It opens by itself before the Start here walkthrough on a fresh
  profile, and once after an update that raises its `REVISION`; Next and
  Back walk every section, and Quick setup walks Connect, Permissions and
  Finish only. It owns no settings: each control saves through the host call
  its setting already had, and team fields are saved for one scope (this
  project, or the Studio defaults every inheriting project uses) with the same
  revision check the Agents workspace uses. Search reaches each section
  (`Setup helper › Routing`), and `MefiSetupHelper.open(section)` deep-links
  it. When the helper has connected an AI, the walkthrough starts at Your
  workspace instead of its scan stop.
- The menu stays open by default at widths of 1100px or more, with the page
  beside it. **Keep menu open** saves your choice across launches. When unpinned
  or narrower than 1100px, it opens over the page on hover or keyboard focus;
  the saved pin returns when the window widens. The minimum window is 600×560.
- The menu is one tab stop. Inside it, the up and down arrows walk the buttons
  it shows and wrap around, and Home and End jump to the ends; the keys stop
  there, so Command's canvas never sees them. `Ctrl ,` opens Settings from
  anywhere, a text field included.
- **M+** at the top of the menu opens the project panel beside it, which holds
  projects only. It replaces the grip on the left edge that used to open the
  same panel.
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
  start collapsed. **More** holds folder actions, Stop all and Restart.
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
- **Search Studio** (`Ctrl K`) finds pages, tools, tasks and settings by
  familiar terms. **Settings › General** holds names and startup behavior;
  **Appearance** holds themes, motion, panel blur and canvas presentation.

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
  uncommitted work until it lands.

### Command center and the node tree

- Command keeps its interactive canvas elements while transferring their
  drawing contexts to OffscreenCanvas where 2D support is available. Explicit
  canvas fonts can then resolve without a document style update. Resizing
  follows the drawing bitmap and device scale; unsupported previews retain
  ordinary contexts. The far layer remains transparent for background video.

- **Tree brightness & outlines**, under Tree modes & movement in Appearance ›
  Layout and Music & video › Audio reactions, provides node and connecting-line
  brightness sliders from 0–200%; independent adjustment switches restore normal
  brightness while retaining each slider value. Optional node outlines add dark
  and light edges around the chosen node shape. These controls also live directly
  in the video's media settings, synchronize across panels, and persist locally.
  Brightness applies to the separate node/connection paint passes; labels, menus,
  video brightness, transparency and tree position remain independent.
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
  Restart stay operational actions beside the work.
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
  pops, flies home, circles the lead and is absorbed in the chosen node style;
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

- **Model Lab** records per-project latency, delivered tokens/s, errors,
  reported usage and USD cost, with human and model ratings kept separate;
  opening it never runs paid measurements. **Context** previews the current
  task brief within a chosen token budget and reports what was shortened.
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
  auditor** and **Machine**. The auditor's findings and the machine readout
  open in the Explorer, where the machine controls stay.
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

Build and publish a release with `node scripts/package-release.mjs --version
vX.Y.Z --publish`, or push a `v*` tag and let
`.github/workflows/release.yml` run. A private repository needs a read-only
token: save one in Settings › Updates, set `MEFI_STUDIO_GITHUB_TOKEN`, or let
Studio reuse the GitHub CLI's `gh auth token`.

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
