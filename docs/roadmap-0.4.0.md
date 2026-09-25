# 0.4.0: the Agent Brain

The goal for the release after 0.3.3, written from the owner's brief of
2026-09-23. There is a visual companion, the "Agent Brain Blueprint" artifact.
It animates today's task loop, plays a concept of the new view with each
style pack, and carries the ad kit. This page is the engineering version:
what gets built, what it builds on, and how we know each part is done.

Companion reading: [agent-loop.md](agent-loop.md) for the loop as it runs
today, [brain-maps.md](brain-maps.md) for the pipeline-as-data, and
[architecture.md](architecture.md) for the vocabulary.

## The goal

Make the Studio's work visible, keep what worked, and steer the whole
project from one place.

- **Watch.** The head agent lays out its own pipeline for a task, grows and
  shrinks it while it works, and a lead model hands its steps to sub-agents.
  Sub-agents report back up the tree to the head, and a desk worker helps the
  ones that get stuck. A new Command layout shows all of it, with done
  animations that differ by style pack.
- **Remember.** An archivist files every verified pipeline into a per-project
  Playbook the head agent picks from. The files agents read and edit build a
  Project Map of the project's systems, which feeds related tasks.
- **Steer.** The Project Map becomes the main work area and replaces Home,
  with Ideas and Plans merged in. The assistant becomes a companion. It is the
  notification manager and the place you act, it greets you with what
  happened while you were away, and it rests when nothing runs.

## Status (2026-09-25: released in 0.4.0)

Shipped in v0.4.0 with the table below as it stood; the details are in
[agent-loop.md §13](agent-loop.md#13-the-agent-brain) and the TESTRUNS row of
the same night.

| Milestone | State | Notes |
| --- | --- | --- |
| M0 node-style packs | Waiting | The "Node tree and styles polish" session owns the landing. |
| M1 work events | Built | `work-events.cjs`, emitted by `agent-brain-host.cjs` from main.cjs's hooks; `tools/replay-events.mjs` compares a day with the ledger. |
| M2 report-up | Built, one part waiting | `MEFI_REPORT` and result lines reach the parent as `report` events and move its child step; a finished child wakes the foreman; the lead seat is GPT 6 Sol at medium; nested delegation is the owner's switch. Drawing child sessions and per-agent motion on the Command tree waits for M0 (tree3d.js and idle.js are being reworked there). |
| M3 pipelines | Built | Laid out before the prompt from the Playbook or a template; grows from todos and `MEFI_STEP`, folds finished steps, caps enforced, survives restarts (`pipelines.json`). With **Let the head draft pipelines for complex tasks** on (Seats, off by default: each draft is a heavy-model call, at most 10 an hour), a compound or systemic task with no recipe gets a pipeline the head drafts in the background; a run already past its first steps keeps its layout and the draft waits for the next run. |
| M4 desk | Built | `MEFI_HELP` lines; the desk seat; folding; escalation as one ask; the live `ask_desk` MCP tool behind the Seats switch (verified with the real `opencode mcp list`). |
| M5 Agent Brain view | Built, hooks waiting | Shipped as its own Live view, **Agent brain** (`J`), instead of a new Command layout: it draws one task's pipeline and reads the same events, so it needs no change to the Command canvas while that is being reworked. The done choreography falls back to its own drawing per style until `MefiNodeStyles.done`/`absorb` land with M0. |
| M6 Playbook | Built | Archivist, recipes, win-probability pick, the shelf with pin, rename, retire and delete. |
| M7 project map | Built | Filled from the project's git history as well as verified runs, so it is useful before any agent has run; large folders split into co-change groups (named by their shared word); links weighted by cosine strength; the task overlay, related systems in the brief, file trails, hover cards, a system picker and the systems a pipeline touches; naming by the lead seat on demand. |
| M8 Hub | Built | Home shows the map beside the conversation (collapsible); a system's tasks, ideas and plans with **Work on this region**; ideas and plans can be placed on a system (`map-places.json`). Ideas and Plans keep their own views under Work. |
| M9 companion | Built | The orb in the menu foot with four states and the node style, the welcome-back digest (on focus after 10 minutes away, and on wake or unlock), the one needs-you queue with actions, the tray count, looks, this-project or all-projects reach (app-wide `companion.json`), and learned preferences. |
| M10 launch | Tagged | v0.4.0 tagged on 2026-09-25. Recording the ads from the real build and the README images are still the owner's call. |

## Where we start (checked against the code on 2026-09-23)

Most of the raw material exists. The gaps are specific:

| Need | What exists | What is missing |
| --- | --- | --- |
| Sub-agents that report up | `task-delegation.cjs` children (`parentTaskId`, `depth`, `delegatedFrom`); `reconcileTaskHandoffs`; the parent's integration pass reads "Dependency outputs" | Nothing is sent from a child to its parent; parents find out children finished by checking board state (`backlog.dependencyIds`). Delegation is one level deep (`canPlan` blocks children). |
| Pipelines per task | `brains.cjs` `compileMap` (topological stages), `brainsDraft` (model-built map JSON), nested `brain.call` up to 4 deep | No per-task pipeline; host parts only move switches (`gatesFor`); no agent can save or edit a map. |
| A record of steps taken | `executor-log.jsonl` (start / fallback / finish / release), Policy Lab `buildEpisodes` (attempt trees with verification labels), `task-attempts.cjs` | Nothing ties a task to the steps or map parts it went through. |
| Help for a stuck worker | `MEFI_ASK` issue lane (`agent-issues.cjs`), `MEFI_CALL` to a role, the Cluster planner's support prompt | A running worker cannot get an answer back: its prompt goes in on stdin, and after that nothing can reach it. Jev answers constrained choices only, never prose. |
| Return animation | `tree3d.js` agent flights (home → flying → hovering → running → returning), idle.js pulses, `say()` → / ← bubbles, absorb (`markAbsorb`, `NODE_ABSORB_MS`) | Motion is keyed by role, not agent instance; child sessions (`parentId`) are filtered off the tree; no return path up a parent chain; no pipeline layout. |
| Style-pack reactions | `MefiNodeStyles` hooks `paint`, `ring`, `orbit`, `arrival`, `select`, `wire`, `surge`, `land` | No `done` or `absorb` hook; `node-styles.js` is still only on the `claude/node-styles-*` branches (`C:\wt\ns-*`). |
| File exploration | `eyes.listReads` / `listChanges` / `listSessionChecks`; `mergePaths` hot and cold paths by `areaOf` (top folder); `first-map.json` `areas` | No per-task file index, no co-change data, and no lasting map of systems. |
| Companion | `workspace.js` `companion()` (default "Mefi", the owner's is "Star") and `renderCompanion` (a name, a narration line, a buddy animation on Home only) | No notification queue, no "welcome back" (nothing tracks when you were last here), and the tray has no counts. |
| One work area | Home (`workspace.js`), Ideas (`ideas.js` feature graph), Plans (`planning.cjs`), the M+ project panel | Separate views; Home is pinned as startup by `booklet.js` `prepareView` and four suites. |

## Principles

1. **Motion follows events.** Nothing animates without a recorded event
   behind it. A replay of a real day and the live view must look the same.
2. **The owner stays in charge.** Permission and risk stay click-only. The
   live brain map's budgets bound every pipeline the head agent builds. The
   companion acts when you plainly ask, by the same same-clause rule as
   `task-oversight.cjs`, and anything else becomes a card.
3. **Budgets are real.** Growth caps per pipeline, depth ≤ 3
   (`EXECUTOR_MAX_DEPTH`), a cap on animated agents, the 9 ms hot frame
   budget, and still poses under reduced motion.
4. **Everything survives a restart**, as every toggle does today: pipelines
   resume where they stopped, the Playbook and the Project Map persist per
   project, and the companion remembers when you left.
5. **Local first.** The recorder, the map and the digest spend no AI call.
   Only naming systems, drafting pipelines and desk answers do, and those go
   through the pool and its accounting.

## Milestones

Ordered by dependency. Each one ships something usable. **Can slip** names the
part that may move to 0.4.x without breaking the rest.

### M0. Land the node-style packs

Merge `renderer/node-styles.js` (`window.MefiNodeStyles`) and its idle.js and
tree3d.js delegation from the ns-* worktrees onto main. It ends the drifted
duplicate painters, and M5 adds its hooks to one place.

- **Builds on:** the ns-base … ns-wires branches, `state.nodeMotion` (a Map
  keyed by node id).
- **Done when:** all eight styles paint from `MefiNodeStyles` on main, and
  verify_command reaches the same gate it reached before the merge.

### M1. The work event stream

One append-only `work-events.jsonl` per project, beside `executor-log.jsonl`.
Kinds: `step.start`, `step.finish`, `agent.out`, `agent.home`, `report`,
`help.ask`, `help.answer`, `file.read`, `file.edit`, `stage`. Each event
carries `taskId`, `runId`, the parent chain and `at`.

- Emit from the places that already know: `finish()` / `settle` and the
  ledger rows, task notices (`boardWritten` → `taskEvents`), agent mail
  (`assistantSendMail`), and `listReads` / `listChanges` after settle.
- One push channel to the renderer (a `work:events` broadcast), which also lets
  Explorer drop part of its seven-IPC 5-second poll.
- `tools/replay-events.mjs --day YYYY-MM-DD` re-animates a recorded day. The
  M5 tests use it, and it can also record the launch footage.
- Trimmed like the ledger: rotated past a size cap, never read on the hot
  path.
- **Builds on:** `executorLog`, `executorCore.finishLogRecord`,
  `task-attempts.cjs`, Policy Lab `experience.jsonl`.
- **Done when:** a recorded day replays with the same order and counts as the
  ledger, and a test fails if a renderer animation starts without an event.

### M2. Sub-agents that report up the tree

- A `MEFI_REPORT:` line (`done`, `changed`, `files`, `found`), parsed by
  `executorCore.readWorkerLine` like `MEFI_RESULT`. It is stored on the child
  and forwarded to the parent card as a report row, and each report is an M1
  event.
- The parent wakes on a report instead of a board check, so the integration
  pass starts as soon as the last child verifies. The lead writes one roll-up
  line per report for the head.
- The lead seat runs GPT 6 Sol (`gpt-6-sol`, already `ZEN_MODEL_HEAVY`)
  through Zen at **medium** reasoning effort. Seats get their own effort
  setting. The Responses transport already turns a body's `reasoning_effort`
  into `reasoning.effort`, but nothing sets it per role today.
- Delegation nests to the existing depth cap: relax `canPlan` so a child
  below depth 3 may delegate, and keep split lineage (`splitFrom`) separate,
  as it is today.
- On the tree, draw child sessions (stop filtering `parentId` in `tree3d.js`)
  and move agent motion from one record per role to one per instance.
- **Builds on:** `task-delegation.cjs` `admit` / `childRow`,
  `reconcileTaskHandoffs`, `buildTaskHandoff` "Dependency outputs",
  `assistantHearBuilder`.
- **Done when:** a Cluster task with three children shows each child's report
  on the parent within seconds of its verdict, one roll-up line reaches the
  thread, and a test proves depth never passes 3.

### M3. Pipelines the head agent builds, grows and shrinks

- `task.pipeline`: an ordered list of steps with `kind` (from the brain-map
  part catalog: read, map files, plan, build, test, verify, land, plus
  `brain.call` for a nested recipe), `owner`, `model`, `status`, `budget`
  and `parents`.
- The head agent drafts it with `brainsDraft`'s JSON contract, from the
  brief, Jev's work shape (`workShapeQuestions`) and the Playbook's best
  recipe (M6). It is repaired by `repairDraft` and validated by
  `validateMap` before it is kept, as Build with AI's drafts are.
- While the task runs, the lead may add a step it finds a need for, or fold
  finished ones, within caps (max steps, max growth per run). Every change is
  an M1 event.
- A restart resumes the pipeline from its last finished step, through the
  journal the executor already keeps.
- **Builds on:** `brains.cjs` `compileMap` / `makeNode` / `requiredGrants`,
  `EXECUTOR_MAX_HANDOFFS`, `executorResume`.
- **Done when:** a task shows its pipeline before it starts, a restart
  resumes it at the right step, and a test proves the caps hold.

### M4. The desk worker

- A `desk` seat in `AGENT_ROLES` (`spendsAi: "when-usable"`) that answers
  help requests on the lead's model, GPT 6 Sol at medium effort. Jev supplies
  the work shape (intent × complexity), because Jev only picks among choices;
  the desk writes the answer.
- Mid-run help: Studio serves a local MCP tool, `ask_desk`, to OpenCode and
  Claude Code workers. The worker calls it and waits for the answer. Other
  CLIs print `MEFI_HELP:`, checkpoint and end, and the step resumes with the
  answer at the top of its brief.
- A `help.desk` part in the brain map sits before the Ask lane. The desk
  answers, or escalates once to an owner ask, and escalations fold like
  repeat asks (`repeatAsks: "fold"`).
- **Builds on:** `agent-issues.cjs` (`ISSUE_KINDS`, `triageIssue`),
  `EXECUTOR_CALLABLE`, the cluster-planner `buildSupportPrompt`,
  `jev-loop.mjs`.
- **Done when:** help the desk answers makes no card, every answer is logged
  with its question, an escalation reaches the owner once, and a run whose
  CLI has no MCP resumes with the answer.

### M5. The Agent Brain view

- A new Command layout, **Pipeline**: a top-down flow with the head, the
  lead, the steps and the sub-agents. Finished branches fold into one "n steps
  done" pill. Geometry can borrow from `brains.js` `layoutPipeline` /
  `wireD`, drawn on the canvas.
- Return packets climb the chain (child → lead → head) in their own shape and
  colour, beside the outgoing flights.
- Done choreography through two new `MefiNodeStyles` hooks, `done(u)` and
  `absorb(u)`: pop and bounce at the step, fly home, circle the lead, get
  absorbed. Each style gets its own version (see the blueprint's table).
  Under reduced motion each style shows a designed still pose.
- A model tint band on each sub-agent and an "out · home" counter on the
  lead.
- A cap on animated agents with a "+n more" chip, so the frame cost stays
  bounded.
- **Builds on:** idle.js `state.fx`, `markAbsorb`, `surgeLine`, `say`,
  `tidyBranchSeeds`, `NODE_GROW_MS` / `NODE_ABSORB_MS`, the adaptive cadence
  (`HOT_FRAME_BUDGET_MS`).
- **Needs:** M0, M2, M3.
- **Done when:** an M1 replay and the live run look the same, frame cost
  stays under 9 ms with 12 agents, verify_command passes, and every style has
  both hooks.

### M6. The Playbook

- An archivist seat files each verified task's pipeline into
  `data/playbook.json` (per project, through the project data path): steps,
  order, models, time, retries and the verdict.
- Similar shapes group into recipes, keyed by work shape plus step signature.
  Each recipe keeps its runs, verified rate and median time.
- The head agent picks a recipe the way `model-routing.mjs` picks a builder: a
  win probability from verified outcomes, with bounded exploration.
- The Playbook view shows recipes as a shelf (thickness = runs, colour =
  verified rate). Opening one replays its pipeline, and the owner can pin,
  edit, rename or retire it. The overseer's playbook lessons stay what they
  are, and recipes appear beside them in `compileMemory`.
- **Builds on:** Policy Lab `buildEpisodes`, receipts,
  `estimateWinProbability`, `overseerMerge`.
- **Can slip:** picking by win probability; the first version picks the most
  recent verified recipe of the same work shape.
- **Done when:** the second similar task starts from a recipe, a recipe that
  keeps failing stops being picked, and every recipe is editable.

### M7. File exploration and the Project Map

- A per-task file index, written at settle: files read, files edited and
  commands run, from the attempt's session window. It is a lasting record, so
  the map no longer depends on the OpenCode store keeping old sessions.
- `data/project-map.json`: systems seeded from `first-map.json` `areas`,
  refined by folder and co-change clustering and named by one routine-model
  pass; each system's files; links from imports and co-change; a status
  overlay (done, in progress, planned, ideas).
- Exploration trails in the Brain view: an agent's path through the files,
  fading behind it.
- Briefs gain "related systems and hot files" from the map, replacing
  `pathsForArea`'s top-folder guess.
- Never lists `data/`, `node_modules`, ignored files or anything outside the
  project.
- **Builds on:** `eyes.listReads` / `listChanges` / `listSessionChecks`,
  `mergePaths`, `first-map.mjs`, `task-attempts.cjs`.
- **Can slip:** co-change clustering; the first version groups by folder.
- **Done when:** a fixture task's brief names the right system's files, the
  map updates within one settle, and the ignore rules are tested.

### M8. The Project Hub replaces Home

- The Hub takes Home's place in the rail, keeping `H`. The Project Map is its
  canvas, and regions are selectable.
- A region panel lists that region's tasks, ideas, plans and finished work,
  and the composer gains **Work on this region**.
- Ideas become notes you can place on the map, and Plans attach to regions.
  Both old views stay under Work for one release.
- Today's Home pieces (current task, app preview, composer, thread) move into
  the Hub's side panel.
- One change to the nav registry, `RAIL_SECTIONS`, `LOCAL_ROUTES`, Search and
  Shortcuts, plus the suites that pin Home: `tests/app_rail.test.mjs`,
  `tests/catalog_renderer.test.mjs`, `tests/workspace_ui.test.mjs` and
  `tools/verify_workspace.py`.
- **Builds on:** `nav.js` `registry` / `register`, `booklet.js`
  `prepareView`, `workspace.js`, `ideas.js` `cluster` / `drawGraph`,
  `planning.cjs`, `projects.cjs`.
- **Needs:** M7.
- **Done when:** every current Home action is reachable from the Hub, startup
  lands on the Hub, the rail, Search and Shortcuts agree, and verify_workspace
  passes on the new layout.

### M9. The Companion

- Docked on every view, not just Home. It has four states: **greeting**,
  **working**, **needs you** and **resting**.
- **Welcome back:** store when the owner was last active. On return, or when
  the machine wakes, show a digest of what finished, what failed and what
  needs you, built locally from M1 events and the board.
- **Notification manager:** Ask cards, reviews, approvals, parked and held
  cards and toasts go into one queue with counts. Actions happen in place
  (answer, approve, start, try again), and the tray shows the count.
- **Look and scope:** a person, animal or creature, with idle animations
  that follow the style pack. It covers this project or all projects; in
  all-projects mode each item shows its project.
- **A log it reviews:** the owner's decisions and replies are summarised
  locally into preferences the owner can see and edit ("you usually choose
  Keep to the brief for scope questions"). They are suggestions, never
  automatic answers.
- **Builds on:** `workspace.js` `companion()` / `renderCompanion`,
  `assistantState.resumed`, `eyes-briefing.json`, `assistantNeedsYouNotice`,
  `nav.js` `noticeQuestions`, `refreshTray`, `task-oversight.cjs`.
- **Needs:** M1; can start alongside M2.
- **Done when:** after a restart the digest matches the board, every
  notification type lands in the queue, resting makes no AI call, and both
  scopes work.

### M10. Launch

- Record the ad kit's GIFs and trailer from the real build: offscreen
  Electron, `--force-device-scale-factor=1`, fresh userdata and a demo
  project (the README screenshot recipe).
- Update the README images, the website, the CHANGELOG and the Discord card.
- Run the gates: `npm run check`, `npm test`, `npm run audit`,
  `npm run build-booklet`. Then tag `v0.4.0`.
- **Done when:** v0.4.0 is published and every ad shows the real UI.

## Order

```
M0 ─────────────────────────────┐
M1 ─┬─ M2 ── M3 ─┬─ M5 ─────────┼─ M10
    │            └─ M6          │
    ├─ M4                       │
    ├─ M7 ── M8 ────────────────┤
    └─ M9 ──────────────────────┘
```

M0, M1 and M9 can start in parallel. M5 is the first milestone with a visible
payoff, so it should land early; M6 and M7 need a few days of recorded work
before their output means anything.

## Decisions for the owner

Each has a default, so work can start without an answer.

| Question | Default |
| --- | --- |
| Is the head agent the same character as the companion (Star)? | Yes, one face; its planning runs on the heavy role. |
| Which models fill the seats? | **Decided 2026-09-23:** head: Opus 5.5 via Claude Code. Lead and desk: GPT 6 Sol via Zen on medium reasoning effort. Sub-agents: the builder router. |
| Does the Hub fully replace Home in 0.4.0? | Yes, with the Home pieces in the side panel and Ideas and Plans under Work for one release. |
| What are the companion's default scope and look? | One companion across all projects; a small creature of light that follows the style pack. |
| May the companion act without asking? | Only under today's overseer-chat rule: act when plainly asked, otherwise a card. |
| Should workers get the local MCP `ask_desk` tool? | Yes for OpenCode and Claude Code, with checkpoint and resume for the rest. |
| Is the Playbook per project or shared? | Per project, with export and import of single recipes. |

## Risks

- **Frame cost.** More agents and trails on the Command canvas. Mitigated
  by the agent cap, the detail tiers and the replay tool, which gives a
  repeatable perf test.
- **Pipelines that loop.** A head agent that keeps growing its pipeline is
  the follow-up loop again in a new shape. The caps, M1 events and the
  keeper's loop guard (`LOOP_LIMITS`) must count pipeline growth as well.
- **Shared-tree churn.** idle.js, tree3d.js and workspace.js are edited by
  several sessions at once. Land each milestone through the shared-tree
  recipe, and keep new host logic in new modules where possible.
- **Store dependence.** The file index and the replay must not need old
  OpenCode sessions, so M7 writes its own index at settle.
