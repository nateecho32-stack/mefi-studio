# How Studio is put together

The detailed feature walkthrough that used to live in the README. It is
written in Studio's own vocabulary, so start with the glossary. For first
steps read [GETTING_STARTED.md](../GETTING_STARTED.md); for the code-level
walk through the agent loop read [agent-loop.md](agent-loop.md).

## Glossary

| Term | Meaning |
| --- | --- |
| **Rail** | The navigation down the left edge: Home, Work, Live, Models and Settings, plus the palette, walkthrough and shortcuts at its foot. **M+** at its top opens the project panel. |
| **Workspace** | The home screen (`H`): project header, the "Studio at a glance" strip, the conversation with your companion, and **Your work**. |
| **Command view** | The 3D node tree (`D`): sessions, tasks and agents as orbs, with a right rail for Work, Agents, Assistant, Done and Ask. |
| **Booklet** | Historically the single-file model catalog; today `renderer/booklet.html` is the whole app bundled into one file by `npm run build-booklet`. The **Model catalog** tab (`1`) is the part that kept the name. |
| **Model Lab** | Tab `2`: measured latency, throughput, cost and the usage tracker per project. |
| **Activity & evidence** (A-Eyes) | Tab `3`: a read-only view of the OpenCode session store: change feed, diffs, screenshots with pins, log tail. The "eyes worker" is the thread that reads that store. |
| **Settings & connections** | Tab `4`: keys, provider routing, coding workers, Jev, updates, integrations, log. |
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

- One **rail** down the left edge is the whole app's navigation: **Home** (the
  workspace), **Work** (Task board, Plans, Ideas, Brain maps), **Live** (Command
  view, Activity, Explorer, Overhead, Analyzer, Profiler), **Models** (Model
  catalog, Model Lab) and **Settings** (Settings & connections, Style & sound),
  with Key commands, Start here and Shortcuts at its foot. At rest it is five
  icons with their names; hover it or Tab into it and it opens over the page to
  list every destination with its key, without moving anything underneath.
  **Keep open** pins it and the page makes room. The section you are in lights
  up and the destination you are on is marked.
- **M+** at the top of the rail opens the project panel beside it. It replaces
  the grip on the left edge that used to open the same panel.
- The rail is built from the same registry as the palette (`Ctrl K`), the help
  sheet and the single-letter keys, so a destination cannot appear in one and
  be missing from another. It replaced three older menus — the tabs row, the
  Command dock and the hover sidebar's own rows. **Switch navigation: rail or
  classic** in `Ctrl K` (or `?shell=classic` on the URL) brings those back for
  anyone who needs them.

### Workspace and work

- **Projects** keeps each folder's tasks, conversations, drafts, references and
  work logs together. **M+** at the top of the left rail opens the project
  panel beside it: the project list, **+** to add a folder, and your name,
  accent and motion. Running work must finish before a project change.
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
- **Ctrl K** finds tools and tasks by familiar terms; **Make yourself at home**
  sets your name, companion name, accent and movement preference.

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

- **Live work** shows the current worker and step, readiness counts, the
  readable agent roster (each role's status, name, elapsed time and current
  task) and a ranked queue; **Settings** holds the queue controls, while
  **Agents** in the toolbar chooses how the roster shares work between
  **Swarm** (across the queue) and **Cluster** (one goal at a time).
- The rail's **Agents** tab gathers the queue controls (Autopilot, Parallel
  builds, Build mode, Agent mode) under an at-a-glance strip that shows the
  switch, the running builds and their cap, and the coordination mode.
- **Parallel builds** defaults to **Machine managed**: admission follows
  measured app responsiveness, with optional manual limits of one to three
  workers. High CPU alone never limits builds.
- **Follow** frames the active task; **Fit** repairs the layout. Pick node style
  (**Classic orbs**, **Soft glass**, **Minimal**, **Halo**, **Crystal**) and
  arrangement (**Constellation**, **Branches**, **Rings**, **Helix**,
  **Terraces**) per project, in 2D or real 3D.
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
  view is set under **Settings › Studio**.
- **Inspect mode.** Selecting a node also hands its detail the whole right
  rail — a **Node** tab appears at the head of the strip and takes the rail
  at full window height, with one scroller instead of a card inside a card.
  Everything else steps back to its edge at the same moment: the rail's tabs
  become a 56px icon column pinned over the detail, the dock folds to its
  **More tools** pill, **Legend** and **Usage** keep their glyphs and drop
  their words, and the view toolbar goes glyph-only. Nothing is taken away —
  every collapsed edge peeks back when you hover it or tab into it, and
  **Esc** walks out one level per press: the menus return first with the node
  still open, then the node itself, and the rail goes back to the tab you
  were on. Below 900px the rail is hidden entirely and the floating card
  serves the detail as before.
- Lines say what they mean: the hub link is doubled, a task's anchor is
  dotted and marches while its worker runs, an agent's tether is dashed, a
  finished cluster is stippled, and a done todo's link fades green.
- The Done tab lists the builds that finished off, from the executor ledger;
  **Clear** wipes it. The absorb is the tree's: a finished node collapses
  into its host and its brief stays readable on that card under
  **Absorbed work**.
- **Style & sound** recolours Studio and plays your local files or Spotify
  links; **Audio link** wires bass, mids and treble to the live tree
  (including desktop audio and microphone sources) only when you enable it.

### Model Lab and routing

- **Model Lab** records per-project latency, delivered tokens/s, errors,
  reported usage and USD cost, with human and model ratings kept separate;
  opening it never runs paid measurements. **Context** previews the current
  task brief within a chosen token budget and reports what was shortened.
- **Usage tracker** sums two ledgers per day, provider and model: the calls
  Studio made itself (assistant HTTP and CLI routes, Jev, speed probes) and
  every coding-session turn OpenCode's own store recorded for the project
  (the builders' runs on Go, Zen, OpenRouter or the z.ai plan), read on the
  eyes worker. Each connected provider gets its own account reading over its
  saved key — OpenCode Go's 5-hour/weekly/monthly windows, z.ai's plan quota,
  OpenRouter's key usage and limit, the Vercel AI Gateway balance — and a
  provider with no account API (Zen, TypeSafe, the Grok/Claude/Antigravity
  CLIs, a local server) says so plainly. The CLI routes run in their JSON
  output mode so their token counts reach the ledger. Live readings and the
  local estimate stay clearly separate; a plan or subscription reports no
  per-call cost, so those calls are shown as unpriced rather than free. A
  compact version sits at the bottom of the Command rail, and the full view
  is the Model Lab **Tracker** tab. Opening it and every five minutes while it
  is visible is the only time the accounts are asked; no prompts are sent.
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
  in the 3D rail filters the feed and focuses the assistant.
- The **session explorer** (`E`) carries the always-on thread, collateral
  watch, local Auditor and request inbox, with checkpoint actions
  (Reference / Explore / Restore / Expand).
- The **Analyzer** (`A`) compares plans and notes with current source, listing
  `file:line` evidence, missing references and unverified completion claims.
  It runs locally; the optional AI read sends bounded excerpts only when asked.
- **Tasks**, **Ideas**, **Overhead** and the **Performance profiler** cover task
  logs and references, a feature-idea inbox and graph, task-to-session mapping,
  and in-app frame/scope/hitch capture with JSON export.
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
minutes. When a newer build exists, the App updates block shows **Update to
vX.Y.Z**: it downloads the release zip, verifies the published `.sha256` (or
the API digest) when one exists, stages the portable folder, and a helper
script waits for the app to exit, copies the payload into place — never
`resources/app/data` — and relaunches. In development the checker only
reports; the live update above applies source changes.

Build and publish a release with `node scripts/package-release.mjs --version
vX.Y.Z --publish`, or push a `v*` tag and let
`.github/workflows/release.yml` run. A private repository needs a read-only
token: save one in App updates, set `MEFI_STUDIO_GITHUB_TOKEN`, or let Studio
reuse the GitHub CLI's `gh auth token`.
