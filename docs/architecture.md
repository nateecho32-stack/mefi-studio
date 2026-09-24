# How Studio is put together

The detailed feature walkthrough that used to live in the README. It is
written in Studio's own vocabulary, so start with the glossary. For first
steps read [GETTING_STARTED.md](../GETTING_STARTED.md); for the code-level
walk through the agent loop read [agent-loop.md](agent-loop.md).

## Glossary

| Term | Meaning |
| --- | --- |
| **Menu** (the rail) | The navigation down the left edge: **Home**, **Work**, **Live**, **Models** and **Settings**, with **Search**, **Start here**, **Shortcuts** and **Community** at its foot. The code calls it the rail (`#app-rail`, `renderRail` in `renderer/nav.js`). **M+** at its top opens the project panel. |
| **Workspace** | The home screen (`H`): project header, the "Studio at a glance" strip, the conversation with your companion, and **Your work**, as frosted glass over the live node tree. |
| **Command view** | The 3D node tree (`D`): sessions, tasks and agents as orbs, with a panel on the right for Work, Agents, Assistant, Done and Ask. |
| **Booklet** | Historically the single-file model catalog; today `renderer/booklet.html` is the whole app bundled into one file by `npm run build-booklet`. The **Model catalog** tab (`1`) is the part that kept the name. |
| **Model Lab** | Tab `2`: measured latency, throughput, cost and the usage tracker per project. |
| **Activity & evidence** (A-Eyes) | Tab `3`: a read-only view of the OpenCode session store: change feed, diffs, screenshots with pins, log tail. The "eyes worker" is the thread that reads that store. |
| **Settings** | Tab `4`, or `Ctrl ,` from anywhere: a **Find a setting** field over three groups of cards. **Connections**: Auto setup, Providers, Model routing, Coding workers and Jev. **Personal**: Your Studio and Community. **System**: Updates, Diagnostics, Integrations, Discord Server Styler and the Connection log. Two rows marked ↗ open another view: **Agents & queue** (Command's Agents panel) and **Style & sound**. `MefiNav.go("studio", { section: "settings-updates" })` opens one card. |
| **Your Studio** | Settings › Your Studio: your name, the companion's name, a theme quick select, **Motion** (Full · Calm · Off), whether the companion moves, **Blur behind panels** and **Open Workspace on launch**. It took over the project panel's *Make yourself at home*, the page header's Motion switch and the Task board's blur switch. |
| **Diagnostics** | Settings › Diagnostics: the speed probe, **Open profiler**, **Run auditor** and **Machine**. The auditor's findings and the machine readout open in the Explorer. |
| **Search Studio** | The palette (`Ctrl K`), once called Key commands. It finds any page, tool, Settings card, action, task, node or model by familiar terms, and groups its results by menu section. |
| **`RAIL_SLOTS`** | The map in `renderer/nav.js` that gives the menu a place for a destination whose kind would keep it out; other actions stay in Search only. Its one entry, `community: "foot"`, puts **Community**, which `renderer/community.js` registers late, at the menu foot. |
| **Task** | One unit of work on the project board, with a brief, acceptance checks, prerequisites, attempts and evidence. |
| **Idea** | A note in the feature-idea inbox; it becomes a task only when you or **Work through backlog** promote it. |
| **Plan** | A structured route from an unclear idea to tasks: unknowns, decisions, a specification you approve, then tasks. |
| **Session** | One coding-worker run recorded in the OpenCode store. Tasks map to sessions in **Overhead**. |
| **Builder / coding worker** | The CLI that edits your files: `opencode` (preferred), `claude`, `codex`, `grok` or `agy`. |
| **Agent roles** | The service loop's satellites: **watcher** (stale sessions), **machine** (CPU, memory, leases), **auditor** (findings), **keeper** (pruning), **thinker** (what next), **briefer** (summaries), **responder** (chat), **foreman** (hands out work), **compactor** (context), **overseer** (reviews the loop), **scout** (notices things for other roles). |
| **Agent mail** | Notes the roles write to each other; shown on the assistant card under **Said to each other** and as packets on the tree. |
| **Jev** | A third-party classifier model (TypeSafe's `jev-1.13`) Studio uses to pick a model per task and to classify intake. Optional; fixed defaults apply without it. |
| **Autopilot / New work** | Autopilot lets the assistant start work on its own; **New work** is the master switch that holds every kind of new start while current workers finish. |
| **Auto build / Verify first** | Auto build starts a task as soon as it is ready. Verify first holds it in **Review** until you press **Approve build**. |
| **Swarm / Cluster** | Agent mode: Swarm spreads workers across the queue, Cluster keeps them on one goal at a time. |
| **Awaiting verification** | A finished attempt whose completion is not yet established; housekeeping checks the evidence before it becomes **Done**. |
| **Orb, callout, absorb** | Command-view vocabulary: an orb is a node, a callout is its floating card, and absorb is a finished node collapsing into its host. |
| **Ruins Runner** | The author's LÖVE game, an optional external project Studio can launch. A fresh clone works without it. |
| **Discord Server Styler** | An optional separate bot and local dashboard. Settings can start it, open its dashboard or folder, show its status and stop a process Studio started. |
| **Void collection** | The members' perk: four themes (Void, Eclipse, Abyss, Neon Dusk) and three node styles (Singularity, Prism, Sigil) that unlock for members of the Void Engine Discord. They are picked in Style & sound, the themes also in Your Studio's theme select, and Settings › Community shows them all. A locked one explains itself where you clicked it. Everything else stays free. |
| **Community link** | An optional Discord login (Settings › Community, which **Community** at the menu foot opens) that lets Studio read your membership and roles in the Void Engine server: when you link, then every seven days (after a failed check, in an hour, six hours, then daily) and whenever you press **Check now**. The data is kept in `settings.community`, and the refresh token is encrypted in `community-auth.json`. |
| **`SELF_UNLOCKED`** | The documented fork switch in `scripts/community.cjs`. Setting it to `true` unlocks every perk without Discord. |

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

- One **menu** down the left edge (the rail, in the code) is the whole app's
  navigation: **Home** (the workspace), **Work** (Task board, Plans, Ideas,
  Brain maps, Analyzer), **Live** (Command view, Activity, Explorer,
  Overhead), **Models** (Model catalog, Model Lab) and **Settings** (Settings,
  Style & sound, Profiler). Its foot holds **Search** (`Ctrl K`), **Start
  here**, **Shortcuts** (`?`), **Community** and the update badge. At rest it
  is five icons with their names; hover it or Tab into it and it opens over the
  page to list every destination with its key, without moving anything
  underneath. Opened, each section's name becomes a small capitals heading
  over its destinations (it still goes to the section's main page), and the
  whole menu fits a 900px window. Below 820px tall the foot folds into one
  row of icons, each named by its tooltip, and a list that still has to
  scroll fades out at its hidden edge. The section you are in lights up and
  the destination you are on is marked. Toasts step aside while the menu is
  open.
- **Keep menu open** pins it and the page makes room. In a window narrower
  than 1100px a pinned menu behaves as if unpinned and opens over the page;
  the pin comes back when the window widens. The window never shrinks below
  600×560, the size every layout is built and checked for.
- The menu is one tab stop. Inside it, the up and down arrows walk the buttons
  it shows and wrap around, and Home and End jump to the ends; the keys stop
  there, so Command's canvas never sees them. `Ctrl ,` opens Settings from
  anywhere, a text field included.
- **M+** at the top of the menu opens the project panel beside it, which holds
  projects only. It replaces the grip on the left edge that used to open the
  same panel.
- The tab pages share one header: the title of the page you are on and, when
  Command view sent you there, a **← Command view** chip that takes you back.
- The menu is built from the same registry as **Search Studio** (`Ctrl K`), the
  Shortcuts sheet and the single-letter keys, so a destination cannot appear
  in one and be missing from another. Each record names its section, which
  files it in the menu, in Search's results and on the Shortcuts sheet alike.
  Actions stay in Search unless `RAIL_SLOTS` gives one a place in the menu, as
  it does Community. Search also finds every Settings card by name, such as
  "Settings › Providers". The menu replaced three older menus: the tabs row,
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
- **Projects** keeps each folder's tasks, conversations, drafts, references and
  work logs together. **M+** at the top of the menu opens the project panel
  beside it: the project list and **+** to add a folder. Running work must
  finish before a project change.
- **Your work** separates open work, attempts needing **Review**, and verified
  or manually confirmed **Done** tasks; archived completions stay visible.
- **Auto build** stays on by default. Turn it off for **Verify first** so each
  task waits in Review until you choose **Approve build**. Approval covers the
  saved task scope and is saved across restarts for all projects.
- **Studio at a glance** sits above the conversation: the service state with
  the single **Pause / Resume** control, running workers, what needs you (open
  questions and work to review), what is up next, the machine gauge and
  today's usage. Each tile opens the view that owns it, and a new agent
  question raises a toast with an **Answer** button from any view.
- **Work through backlog** works the project's existing tasks and ideas first,
  keeping a small runnable buffer; **Pause** holds every kind of new work (the
  same hold as Command's **New work** switch) while current workers finish.
- The **task board** opens as plan cards with progress and a current step, and
  holds prerequisites, handoff context and task history. Missing prerequisites
  and dependency cycles are surfaced for correction.
- **Search Studio** (`Ctrl K`) finds pages, tools, tasks and settings by
  familiar terms; **Settings › Your Studio** sets your name, the companion's
  name, the theme, motion, panel blur and where a launch lands.

### Planning

**Plan an idea** opens **Plans** for work whose route is unclear. Describe the
outcome in your own words, then Mefi interviews you: it asks the one question
that would most change what gets built, waits for your answer, reads that
answer back as an unconfirmed interpretation, raises a conflict when you
contradict yourself, and follows what you actually said into the next question.
Every line of the interview is labelled by where it came from — your answer,
Mefi's reading, its recommendation, its question — and only a decision you
record yourself becomes a requirement. You can still ask for a batch of
questions, ask it to explain the tradeoffs on one, or write the whole plan by
hand.

Once every unknown is settled and every question decided, **What we understand**
reads the plan back to you and waits for your confirmation; no specification is
drafted or approved until you give it, and changing the destination, an unknown
or any decision withdraws it. Then write or request a specification with small
tasks, acceptance checks and prerequisites, approve the draft, and explicitly
create its tasks. Assistant suggestions and interview lines never resolve a
question, confirm the understanding or approve work, and planning itself cannot
launch coding workers. Manual controls work without an AI key; plans and their
revision history stay in the project's ignored local `planning.json`.

### The assistant and the agent loop

- The assistant can always be messaged and is always working: a **service loop**
  ticks every 30 seconds (every two minutes while hidden), organising the node
  tree, scanning the machine, running the Auditor every five minutes, fixing and
  tidying on cadence, and (with Proactive on) briefing every five minutes.
- Messaging is a real chatbot: multiline composer, quick-ask chips, follow-ups
  resolved against the last reply, replies grounded in the current board,
  inbox, open folder and the folder's own scanned plan documents, and plain
  keywords that work without AI. Asking for work queues it; vague chatter gets
  a yes/no offer instead of an accidental job.
- **Work on it** makes a node the assistant's next piece of work — pinned to
  the front of the board and started at demand priority. Every session, todo and
  task acts as a **node folder** of typed context cells that compile into chat
  replies and executor prompts.
- The **overseer** reviews how the assistant works, keeps a playbook and lesson
  counts, files bounded upgrade requests, and repairs the loop (resume stale
  sessions, re-arm interrupted work) every fifteen minutes.
- The agents **talk to each other**: a scout that sees something another role
  owns writes it a note — the watcher tells the keeper about stale sessions and
  the auditor about colliding files, the machine tells the foreman when it is
  holding new starts, the auditor and the compactor tell the foreman what is
  ready to hand out, the keeper tells the compactor what it pruned, a finished
  builder tells the agent it called what for, and the overseer says why it woke
  a role. Unread mail pulls its reader onto the next tick, and the reader takes
  its notes as it starts. On the tree a note rides a packet between the two
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

- The toolbar is four labelled groups and **Leave**. **Agents** chooses how
  the roster shares work between **Swarm** (across the queue) and **Cluster**
  (one goal at a time). **Camera** holds **Fit**, the **Overview** / **Follow**
  camera modes (`C` cycles Overview, Follow and free) and **Spin**. **View ▾**
  folds Map 2D / 3D (`V`), Labels (`L`) and Zoom into one menu. **Sound** holds
  **Music** and **Ambience**. **Spin** is the only control that turns the tree
  (`Space` pauses it); **Overview** keeps the whole tree framed. The two used
  to share the name Orbit. In 3D the Overview turns the tree about its own
  centre (the middle of the smallest circle around it seen from above,
  halfway up its height) and sizes the frame once for the whole turn, so the
  tree spins in place at a steady size with every node in view.
- The **Ambience** popover reads **Look** (Backdrop, Speech bubbles, Card
  style), **Sound** (what the nodes listen to, the Zen bells' profile and
  switch) and **Calm** (Zen mode), then links on to **Style & sound** for the
  theme, the node style and music. The whole **Audio link** (connect, response
  and reactions) is in Style & sound; the toolbar's **Music** button turns it
  on and off.
- **Live work** shows the current worker and step, readiness counts, the
  readable agent roster (each role's status, name, elapsed time and current
  task) and a ranked queue.
- The panel's **Agents** tab gathers the queue controls (Autopilot, Parallel
  builds, Build mode, Agent mode) under an at-a-glance strip that shows the
  switch, the running builds and their cap, and the coordination mode.
  **Agents & queue ↗** in Settings opens it.
- **Parallel builds** defaults to **Machine managed**: admission follows
  measured app responsiveness, with optional manual limits of one to three
  workers. High CPU alone never limits builds.
- **Follow** frames the active task; **Fit** repairs the layout. Pick node style
  (**Classic orbs**, **Soft glass**, **Minimal**, **Halo**, **Crystal**, plus
  the Void collection's **Singularity**, **Prism** and **Sigil** for Discord
  members) and arrangement (**Constellation**, **Branches**, **Rings**,
  **Helix**, **Terraces**) per project, in 2D or real 3D.
- The sky follows the colour theme — Aurora ribbons, Deep space, Nebula,
  Rising embers, Fireflies, Soft bokeh, Warm dust — or pick a **Backdrop**
  (plus Quiet grid and Minimal) in the Ambience pop. **Speech bubbles** beside
  the agents say what each one is doing: a **→** bubble is a finding going
  home, a **←** one is it landing, and a diamond packet rides the line between
  the two agents.
- Every agent wears its role glyph (an eye for the watcher, a hammer for a
  builder, a crown for the overseer…), spins a ring while it works, dashes one
  while it waits its turn, and leaves a coloured wake when it flies to a node.
- Sessions, tasks, the assistant and working agents carry a **callout**: a
  leader rising from the orb into a horizontal top bar, the title above it
  with its number (S1, T4…), a check or status mark and the done/left counts,
  and below it a bubble with what the agents think or do there. Cards keep
  their spot while the tree turns and step aside to a compact label rather
  than overlap; hovering one lifts it and softens everything else; clicking
  it (or its orb) **focuses** the node: the camera glides in (scale and pan
  together, less on a parent so its children stay in frame), the tree slides
  over instead of jumping, and the rest of the tree keeps turning slowly
  behind a blur until Esc or an empty click. **Card style** in the Ambience
  pop picks outlined, filled, or auto (filled when hovered, selected or
  running). Whether a launch lands on the workspace or straight in Command
  view is set under **Settings › Your Studio**.
- **Inspect mode.** Selecting a node also hands its detail the whole right
  panel — a **Node** tab appears at the head of the strip and takes the panel
  at full window height, with one scroller instead of a card inside a card.
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
- The Done tab lists the builds that finished off, from the executor ledger;
  **Clear** wipes it. The absorb is the tree's: a finished node collapses
  into its host and its brief stays readable on that card under
  **Absorbed work**.
- **Style & sound** (`U`) opens on **Look**: the colour theme, with the Void
  collection under the free themes, then the node tree's style, layout and
  effects. **Sound** follows: the player (local files, ad-free radio or a
  Spotify link), the **Audio link**, which wires bass, mids and treble to the
  live tree (including desktop audio and microphone sources) only when you
  enable it (its **Tree motion** reaction lets the music quicken the
  Overview's spin, step it on each kick, sway it round a small figure of
  eight and swell it on the bass, inside room the frame keeps for it), and
  **Find your next sound**. A **Look · Sound** strip in its
  header jumps between the two. A locked Void item explains itself in the
  sheet instead of leaving it.

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
    Model Lab tracker asks with `probe: true`), two at a time and one per
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
  balance. The full view is the Model Lab **Tracker** tab. Account reads
  happen when either view opens and every five minutes while Command is
  visible (without CLI probes); the account channels bypass the
  project-switch gate.
- **AI routing** picks who pays — Auto walks an ordered provider list you edit
  in Settings (the first usable provider answers, and the opt-in fallback
  walks down the list), plus z.ai only, OpenCode Go only, the Grok, Claude
  Code or Antigravity CLIs on their own logins, a local LM Studio server, or a
  custom OpenAI-compatible endpoint with your own key. **Model selection** uses
  Jev or fixed defaults.
- **Models are saved per provider and per builder CLI**, so switching routes
  never carries one provider's model id into another; a provider with nothing
  saved uses its own default, and the keyed HTTP routes keep the role-wide
  Routine/Heavy overrides. Missing a subscription or key for one option never
  blocks the others — the readiness line names what the selected option has.
- **Each role can answer through its own provider.** *Heavy answers via*
  covers plan specs, briefs, reviews, the overseer and the analyzer read;
  *Routine answers via* covers reading the ask, checks, advisory agents and
  chat. Either can be left on *Same as above*. **OpenCode Zen** is one of the
  providers, with its own tile under Providers, billed to the Zen balance
  with the Zen key or opencode's `OPENCODE_API_KEY`; OpenAI's models there
  go to its Responses endpoint.
  Plan specs, brain drafts and the analyzer read stay data-only, so the only
  CLI they may use is Claude Code, which runs with `--tools=` (no tools).
- **Jev routing** chooses where classifier calls go — the Vercel AI Gateway
  (`typesafe-ai/jev`), TypeSafe's Jev API directly (`jev-1.13.0`), OpenCode
  Zen (`jev-1.13`, including its free tier), or OpenRouter
  (`typesafe/jev-1.13`) — each route keeping its own encrypted key. Headless
  setup: `MEFI_STUDIO_GATEWAY_KEY=... electron . --set-gateway-key`,
  `MEFI_STUDIO_JEV_KEY=... electron . --set-jev-key`,
  `MEFI_STUDIO_ZEN_KEY=... electron . --set-zen-key`,
  `MEFI_STUDIO_OPENROUTER_KEY=... electron . --set-openrouter-key`, and
  `MEFI_JEV_ROUTE=zen` (or `vercel`, `typesafe`, `openrouter`) to pick the
  route.
- **Auto setup** in Settings reads saved-key flags, installed CLIs and (only
  when nothing else is available) a live local server, then applies the
  matching provider, model selection and builder in one pass. It sends no paid
  request, changes no key, keeps model overrides, reports every choice, and
  leaves the same controls editable afterward. A fresh install runs it by
  itself on its first launch, and the walkthrough's scan step reads its plan,
  so a machine with only a signed-in coding CLI is configured before the first
  task.
- Builders run through `opencode run` (with a Studio-managed z.ai provider),
  the Grok CLI, Claude Code (`claude -p` on your subscription login), Codex
  (`codex exec` on your ChatGPT login), or Antigravity (`agy` on your Google
  account), with automatic one-time fallback decided by the failure kind.
- A **coding tier** in Settings › Coding workers decides what each build may
  cost. **Auto** keeps per-task selection (Jev or the stand-in judge within
  your provider, otherwise the CLI default); **Free** runs a free model one
  worker at a time and never falls back to a billed default; **Fast** runs the
  quick economical model (GLM 5.3 Flash on the z.ai plan, `sonnet` on Claude
  Code); **Heavy** runs the high-end one (GLM 5.3, `opus`). Tier models are
  saved per builder CLI, and the Settings line shows what each tier resolves
  to before anything runs. Under Auto, any provider/model you pin for
  OpenCode runs on every route; only the first scan's free suggestion yields
  to the z.ai plan.
- Keys live in the OS keystore (`safeStorage`; DPAPI on Windows); their
  ciphertext persists in `auth.json` beside `settings.json`, so preferences
  stay copyable and credentials stay machine-bound. Headless
  setup: `MEFI_STUDIO_KEY=... electron . --set-key`,
  `MEFI_STUDIO_ZAI_KEY=... electron . --set-zai-key`, and
  `MEFI_STUDIO_CUSTOM_KEY=... electron . --set-custom-key`.

### Verification, storage and experiments

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

Studio watches its own source tree: CSS restyles in place, `scripts/*.mjs`
modules hot-swap, renderer files reload with tab, selection, scroll and focus
restored, and `main.cjs` restarts the app. Edits are batched, changed scripts
are syntax-checked first, and a broken file or three restarts a minute **hold**
the update instead of crashing. The `data/` directory is never written by the
updater or packaging.

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

### Community and perks

Members of the **Void Engine Discord** unlock the **Void collection**. The
themes (Void, Eclipse, Abyss, Neon Dusk) each carry a second accent hue and a
premium finish on primary buttons, and each has its own sky in the Command
view. The node styles are Singularity, Prism and Sigil. The seven original
themes, custom colours and the five original node styles stay free.
**Community** at the foot of the menu opens Settings › Community, the card
that holds the link. The full flow is in [community.md](community.md).

**Linking**
- It is optional. Nothing reaches Discord until you choose **Link my Discord**
  in Settings › Community.
- Main then runs an OAuth2 PKCE login as a public client, with no client
  secret. The browser returns to a one-shot listener on `127.0.0.1` (ports
  53134–53136).
- It reads your Discord id, names and roles in the Void Engine server.
- After that, a watcher beside the release watcher re-reads them every seven
  days, sooner after a failed check (below). It wakes hourly, contacts Discord
  only when a check is due, and stops with the other watchers when Studio
  closes its last window or installs a release. **Check now** can run one at
  most once a minute.

**When perks stay on or lock**
- A failed check keeps the perks for 14 days after the last good one, and
  retries after 1 hour, 6 hours, then daily.
- An answer of "not a member" locks them at once.
- A refused grant asks you to link again: Settings › Community offers **Link
  my Discord**.

**Storage**
- The public half of the link and the card's cadence are kept in
  `settings.community`.
- The refresh token is encrypted with `safeStorage` in its own
  `community-auth.json`, and the access token stays in memory. Neither
  crosses IPC.
- **Unlink** revokes the grant at Discord and deletes the file.

**The weekly card**
- It invites non-members to join. It waits three days after the first
  launch, then shows at most weekly, and monthly after four ignored showings.
  Members never see it.
- It appears only at a quiet moment, never during the walkthrough or while
  you type.
- **Not now** snoozes it for a week and **Don't show again** stops it.

**Locked items**
- They stay clickable, and a click explains the lock where you are instead of
  changing the view: on the workspace an inline card, anywhere else a toast
  whose **See the perks** opens Settings › Community with the item named.
- Every locked group carries the same fine print: *"Members of the Void Engine
  Discord unlock these. Studio is MIT-licensed: fork the project and unlock it
  yourself, or ask an agent to do it for you."*
- Alongside are **Join the Discord**, **Link my Discord** and **Copy agent
  prompt**.
- A premium choice is saved on its own
  (`localStorage["mefiStudio.music.premium.v1"]`), so losing access falls back
  to your free choice without forgetting it.

**The fork switch.** `SELF_UNLOCKED` in `scripts/community.cjs` is the one
switch. There is no obfuscation to defeat. The rules live in
`scripts/community.cjs`, the network calls in `scripts/discord-oauth.cjs`, and
the renderer side in `renderer/community.js` (`window.MefiCommunity`).
