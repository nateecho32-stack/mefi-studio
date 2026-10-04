# Fleet overhaul plan

OpenRig's ideas, a live Fleet map ("the branches"), and one coherent shell. Approved by the owner on
2026-09-27. It builds on the menu and agent-loop overhaul that the *Menu and navigation overhaul* session
is landing: its Phase 1 is `1d86a1a`, and its Phase 2 unifies the sections. It does not replace that work.

## Status

| Phase | State |
| --- | --- |
| 0. Sync, verify, tidy | Done. Lost work restored by `dc85f68`, the only restore. `perf/hidden-surfaces` merged (`3954e1a`). Duplicate branches deleted. Menu Phase 1 (`loop`) landed (`1d86a1a`). Configuration lists the setup helper's sections and a pinned walkthrough (`340a8da`), and `npm run sync` catches a merge that drops another branch's work (`40e35a6`). |
| 1. Seats and the fleet model | Done (`5438f6d`, `8a3dd13`): `scripts/fleet.cjs`, `scripts/fleet-host.cjs`, five guarded hooks and four `fleet:*` calls. |
| 2. Live › Fleet | Done: the Fleet page (explorer, Graph, Table, Recent, Tree, Health, seat inspector) under Agents › Live. It moves to the Live section with one line when the menu session's slice (a) lands. What differs from the list below is under **As built**. |
| 3, 5, 7-8 | Planned; task metrics from Phase 7 are already implemented. The bounded Phase 7 handoff-progress note is implemented and aggregate/visual/runtime verified in a separate frozen candidate; landing is pending. |
| 4. Missions and Refocus | The bounded read-only task-detail destination provenance slice is aggregate/visual/runtime verified in the frozen plan-trace candidate (2026-10-02), and included in the separately verified Fleet recovery candidate. Landing remains pending. Existing plan overview, approved-task destination context and verified completion are reused. New project-intent schema, Refocus prompt changes and drift detection remain planned. |
| 6. Continuity and seat editor | Seat recaps implemented and aggregate/visual/runtime verified in a separate frozen candidate: deterministic recorded history, a 1.5k character bound, inspector view and the next assigned worker's context. Seat editor and team spec export/import remain planned; landing is pending. |

## Why

The owner wants Studio overhauled, remaking code where that pays, using three sources.

**OpenRig's video "I Run an AI Civilization in Herdr"** (github.com/mvschwarz/openrig, openrig.dev/docs).
- Its opening image is the **fleet view**:
  - an Explorer tree (PC → rig → pods → seats), each seat with a status dot and context %;
  - beside it, a **topology graph** of pod boxes whose seats are wired together — the branches;
  - tabs for Table / Recent / Overview / Graph / Health.
- The rest of the video adds:
  - **seats** that outlive sessions ("the agent changes, the seat carries on");
  - pods and rigs saved as specs;
  - a **project → mission → slice** work tree with intent, progress derived from evidence, and proof;
  - queue rows that are owned and move by claim, handoff, or close-with-reason;
  - a human inbox;
  - recaps handed on between generations;
  - distributed context;
  - **Refocus**: trace a task back to its intent, which stops "doghouse → moonbase" drift;
  - "mind viruses": conventions that spread from agent to agent;
  - **Agent Productivity Monitoring**: queue activity against meaningful progress.

**Screenshots of a friend's app (Starmind).**
- A mode rail, and tabbed side docks with an **Add panel** picker (grid, search, preview).
- A **task board with a lane per agent**, a pause/budget governor, and Inbox / Deferred / Archived / Completed buckets.
- A **current-task inspector**: title, lane, minutes, blockers, brief, done-when, self/human closes, and *Message this agent*.
- An **agent editor**: model, references, Habits with Off/On/Load and variants, Tools with counts, Launch.
- A searchable **Configuration** modal with interface/text scale and skins.
- A channel **Trace** viewer, and a status bar showing project + mode.

**The product direction:** proper agent- and project-development software that also lets you work with friends.

**Decided with the owner:**
- Build OpenRig's ideas **natively**. OpenRig needs tmux, which means WSL on Windows.
- Restore the lost work first (done by `dc85f68`).
- The **Fleet map lands first**.
- The Command **node tree stays** as it is. The Fleet also gets a node-tree-style view of the fleet, with *Open in Command*.

## Vocabulary — OpenRig's ideas, Studio's names

| OpenRig | Studio | Built from |
| --- | --- | --- |
| host | **PC**: This PC first; your PCs and friends later | `pc-vault.cjs` heartbeat, Rooms |
| rig | **Team** of a project | `settings.agentTeams[projectId]` |
| pod | **Pod**: Lead · Build · Check · Keep | `agentSeats`, `AGENT_ROLES` (`scripts/assistant.mjs`), executor slots |
| seat | **Seat** `builder-2@mefi-studio`; each run is one *generation* | `scripts/fleet.cjs` |
| queue row | **Card** with a lane, a closer and a close reason | `eyes-tasks.json` |
| project → mission → slice | **Project → Mission → Task** | `planning.json` plans become missions |
| inbox | **Inbox**: asks, approvals, requests, messages | `agent-issues.cjs`, `companion.queue`, `eyes:requests` |
| recap | **Seat recap** handed to the next generation | RESULT/NEXT markers, desk answers |
| Refocus | **Trace to intent** plus a reminder to the agent | `scripts/refocus.cjs` |
| productivity monitoring | **Progress monitor** | `brain:event`, verification |

## The flow, in the unified sections

```
┌────┬──────────────────────────────────────────────────────────┬──────────────────┐
│Home│ Live:  [Node tree] [Fleet] [Sessions] [Activity] [Trace] [+]│ Inspector        │
│Work│ ┌ Explorer ───────┐ ┌ Graph · Table · Recent · Tree · Health┐│ seat / task:     │
│Agts│ │▾ This PC        │ │  ┌lead──┐  ┌build─────┐  ┌check──┐  ││ now, lineage,    │
│LIVE│ │ ▾ mefi-studio   │ │  │● lead│──│● builder1│──│● verif│  ││ brief, done-when │
│Frnd│ │  ▾ Build        │ │  └──────┘  │● builder2│  └───────┘  ││ ──────────────── │
│ ⚙  │ │   ● builder-1 42%│ │            └──────────┘             ││ Message this agent│
├────┴──────────────────────────────────────────────────────────┴──────────────────┤
│ Inbox 2 · Deferred 17 · Archived · Completed                 Agents ▶ Running    │
├──────────────────────────────────────────────────────────────────────────────────┤
│ ◆ mefi-studio · Live › Fleet · This PC · 3 working · 1 waiting on you (why) · synced │
└──────────────────────────────────────────────────────────────────────────────────┘
```

- **Live › Fleet** is the branches view, next to the untouched node tree.
- **Work › Tasks › Lanes** is the agent-lane board. **Work › Plans** becomes Missions.
- **Agents › Team** is the seat editor. **Friends** adds friends' PCs to the Explorer.
- The inspector, buckets bar, status bar and **+** picker arrive in Phase 5, once the menus are unified.

## Architecture — how deep the remake goes

**One shell, evolved and remade module by module — not a second shell, and not a big-bang rewrite.**
- A second shell would briefly make four navigation systems, the UX audit's first complaint, and would race
  the menu session's unification.
- A big-bang branch would repeat the lost 16:57 merge (`7ba162c`): three PCs and several sessions land on
  `main` every hour.
- **Host:** new logic lives in pure modules with Node tests (`scripts/fleet.cjs`, `scripts/fleet-host.cjs`, later
  `work-tree.cjs`, `refocus.cjs`, `progress-monitor.cjs`).
  - `main.cjs` only wires `ipcMain.handle(...)` and literal `send(...)` calls, because the auditor pairs
    literals in `main.cjs`.
  - Heavily touched `main.cjs` areas move out into modules.
- **Renderer:** zero new dependencies and classic scripts.
  - Shared layer: `renderer/ui-kit.js` and `renderer/panels.js` (the panel contract).
  - Every new or rebuilt view is a panel, so it mounts as a section tab now and docks later.

## Coordination

| Area this plan touches | Owned / in progress by | Rule |
| --- | --- | --- |
| Loop status, "why is it waiting", Agents switch | Menu overhaul Phase 1, landed `1d86a1a` (`scripts/loop-status.cjs`) | **Read `loop`** from every `assistant:status` push: `{ state, on, tone, headline, reason, action:{id,label}\|null, running, ready, approval, blocked }`. Never re-derive it. |
| Sections, tabs, `nav.js` structure, `agents.js` menus, classic shell | Menu overhaul Phase 2 | **Follow it.** Fleet is registered under Agents while the Live section (slice (a), `88a8580` on `overhaul/phase2`) is not on `main`. Whoever lands second flips it: `section: "live"`, `"fleet"` from `LOCAL_ROUTES.agents` to `LOCAL_ROUTES.live` after `"command"`, and the `children.live` line in `agents.js` goes. Phase 5 starts only after its Phase 2 merges. |
| Setup helper, `community.cjs`, `music.js`, `onboarding.js` | Setup-helper owner | **Message before editing.** The seat editor opens `MefiSetupHelper.open("team")` rather than duplicating it. |
| `scripts/sync.mjs`, vault | *Cross-PC sync strategy* session | Hand it the lost-work guard, or land it after pulling their work. |
| Friends, Rooms, guest work | Rooms (`4ee6891`), vault (`d516312`), menu overhaul Phase 4 | **Build on it.** Phase 8 comes after menu Phase 4 and uses its sharing grants and `scripts/share-review.cjs`. |
| Dispatch (`spawnNextJob`, `selectCandidates`) | *First-time setup and agent blockers* session | Phase 1 only observes. Phase 3's lane dispatch waits for their changes. |

**Working rules:**
- Work in a separate clone or worktree (this plan uses `.claude/worktrees/fleet-overhaul`, branch `fleet/overhaul`).
- Keep slices to a day or less, and commit with explicit paths.
- `main.cjs` edits are one-line `typeof fleetHost !== "undefined" && fleetHost` guarded hooks, because vm
  tests slice these functions.
- Cite functions, not line numbers.
- Rebuild the booklet after every merge; never hand-merge it.
- Land on `main`, then `npm run sync`.

## Phases

### Phase 0 — Sync, verify, tidy, guard

Done:
- The restore (`dc85f68`).
- The duplicate restore branch, dropped.
- `perf/hidden-surfaces` merged (`3954e1a`).
- `perf/quick-wins` and the two empty `worktree-*` branches removed.
- Baseline gates green on `421453f`: check, audit, and 4,226 fast tests.

Then, also done (Configuration `340a8da`, the guard `40e35a6`):
- **Configuration becomes the one index.**
  - `renderer/config-dialog.js` `records()` also indexes the setup helper's `setup-helper:*` records.
  - Add a pinned "Walk me through setup" row. Extend `tests/config_dialog.test.mjs`.
  - Tell the setup-helper owner.
- **Lost-work guard** in `scripts/sync.mjs` (with the sync session): `lostWork(git, range)` with two detectors.
  - **Merge kept one side:** a file changed on both sides where the merge's copy equals one parent's.
  - **Reset to a parent:** a later commit whose tree is within 1% of one merge parent, deleting ≥200 lines.
    `booklet.html` is exempt.
  - It runs before the push gate. `--allow-lost-work` overrides it. Hook mode reports it as pending, and
    `pc-sync.js` shows the headline.
  - AGENTS.md gains a rule: never keep one side of a conflicted file whole, except `booklet.html`.
  - Tests in `tests/sync.test.mjs`.

### Phase 1 — Seats and the fleet model (host)

**Modules**
- `scripts/fleet.cjs`, pure: `defaultRig`, `reduce`, `snapshot`, `edges`, `health`, `normalize`.
- `scripts/fleet-host.cjs`: the I/O side, modelled on `agent-brain-host.cjs`. It handles project scopes, one
  atomic-write chain, watch leases and coalescing.
- Store: `data/projects/<id>/fleet.json`, saved with a 5 s debounce:
  `{ v:1, seq, seats:{[id]:{gen, lineage[≤20]}}, recent[≤300], edges[≤200] }`.

**Data shapes**

```
Seat     { id, address:"builder-2@<slug>", pod, role, kind:"builder"|"roster"|"lead"|"cluster",
           runtime:{cli,model,via}|null, status:"idle"|"working"|"waiting"|"blocked"|"error"|"off",
           now:{taskId,title,runId,phase,step,progress,since}|null, ctx:null|0..1, gen, lastAt }
Occupant { gen, runId, taskId, title, startedAt, endedAt, outcome:"verified"|"awaiting"|"failed"|"stopped"|"lost"|"released",
           reason, sessionId, branch, merge:{merged,reason,kept}|null, result:{done,remaining}(clipped), handoffs:[taskId] }
Edge     { from:seatId|"you", to, kind:"handoff"|"delegation"|"verify"|"rework"|"desk"|"mail"|"report"|"ask", count, lastAt }
Recent   { seq, at, kind:"claimed"|"handed_off"|"completed"|"verified"|"failed"|"blocked_on"|"stopped"|"asked"|"answered"|"mail"|"merged"|"kept_branch", from, to, taskId, title, mission }
Health   { id, severity, summary, reason, confidence, why, threshold, inspect:{view,params} }
```

**Default pods**
- **Lead:** the lead and companion seats, plus the foreman, thinker and overseer roles.
- **Build:** `builder-1..N`, where N = `max(parallel, running)`.
- **Check:** verifier, desk, auditor.
- **Keep:** the other `AGENT_ROLES`, and scout.

Cluster agents attach under the builder seat running their run. A retry of the same task prefers the seat its
last run used (continuity); otherwise a run takes the lowest free seat. Snapshots carry clipped titles only —
no prompts, no absolute paths.

**Hooks** (one guarded line each, in `main.cjs`)
1. Create `fleetHost` after `agentBrain`; beside `send("brain:event")`, call `observeEvent`.
2. `emitAutopilot` → `observeStatus` (copy; never mutate the shared payload).
3. `boardWritten` → claims, closes, handoffs, delegation and verdicts.
4. Assistant push → `observeRoster`.
5. `settleEntryWorktree` → `observeMerge`. This surfaces branch and merge outcomes that today only reach the log.
6. After `agentBrain.runFinished` → `observeFinish`.
7. `stopTaskRun` → `observeStop`.

**IPC**
- Handlers: `fleet:snapshot`, `fleet:watch {id,on}` (a 60 s lease, renewed while visible), `fleet:seat {seatId}`,
  `fleet:action {seatId, action}`.
- Push: literal `send("fleet:update", delta)`, only while watched, for the active project, as a 500 ms trailing
  push, and held while the window is hidden.

**Health v1**
- Stuck run: no step or output for more than 10 minutes.
- An ask open for more than 15 minutes.
- Three or more generations on one task with no verified result.
- A kept (unmerged) branch.
- A desk escalation.
- "Looks idle but held": `loop.state` is not `running` for more than 10 minutes while `loop.ready > 0`.
- `infraFailures`.

**CTX:** best effort. The last OpenCode turn's input tokens against the model's limit; otherwise "—".

### Phase 2 — Live › Fleet, the branches view

0. **Booklet prep.** `CODE_SOURCES` becomes the single list, with a new `STYLE_SOURCES`. The auditor and
   `tests/booklet_build.test.mjs` derive from them, and the output is proven byte-identical.
1. **`renderer/ui-kit.js` (`MefiUi`)**
   - One `node()`, `ago()` and signature helper.
   - A tabs controller and inspector sections.
   - `makeCanvas`, lifted from `agent-brain.js`.
   - `createCamera`, lifted from `project-map-view.js`.
2. **`renderer/panels.js` (`MefiPanels`)**
   - `define({id,title,glyph,desc,searchTerms,mount(host,ctx)→{update,visible,resize,unmount}})`, plus `list`.
   - A visibility manager that turns painting off when the panel is unseen.
3. **`renderer/fleet-layout.js`**, pure and vm-tested:
   - pods as column boxes (Lead → Build → Check → Keep) with a seat grid inside each;
   - orthogonal edges with a lane offset per edge;
   - a tidy tree (project → pods → seats → current task → recent generations).
4. **`renderer/fleet.js` + `fleet.css`**
   - The store: snapshot plus deltas, merged once per 250 ms, with signature diffs.
   - Explorer · Table · Recent · Graph (the branches) · Tree (the fleet as a node tree) · Health.
   - The seat inspector, with *Open in Command*. The node tree itself is unchanged.
5. **Registration** (`renderer/nav.js`): one record, `fleet`, key `F`, under Agents; `section:"live"` once Live exists.
6. **Tests:**
   - `fleet_layout`, `fleet_ui` (vm), and `fleet_render` (Electron at 1440×900, 1100×720, 600×560, and 1100×720@125%);
   - route lists in `app_rail`, `nav_startup` and `command-render-electron.cjs`;
   - this doc, `architecture.md` and `code-map.md`.

**As built.**
- Step 0 (the booklet prep) is implemented in a separate isolated candidate:
  one ordered script/style inventory drives reads, emission, source attribution,
  fixtures and auditing. LF/CRLF byte-equivalence and focused contracts are checked;
  aggregate qualification and landing remain pending. Steps 1-2 (`ui-kit.js`,
  `panels.js`) were not built. `MefiUi` already has `arm` and `plainError`, the
  graph is DOM cards with SVG wires (so no canvas or camera helper was needed), and a panel contract has
  no second user until Phase 5, which is where it belongs.
- Fleet has no global key: Command owns F, C, V, L, S and N in its own view. It is reached from Live
  and from Search.
- Below 60% zoom the graph keeps only each seat's name and state ("far" zoom), so a whole team stays
  readable in a 600 px window. The inspector is a third column above 1500 px, a drawer under the tab
  bar up to that width, and stacked at 760 px and under.
- *Open in Command* goes through `MefiNav.go("command", { selected: "builder:<taskId>" })`: Command's
  builder nodes are named that way, so `idle.js` needed no change.
- Escape clears the selection first. A second Escape on a workspace page opened the companion hub; the
  menu session's slice (e) makes it leave the page first.
- `fleet_render` covers five window sizes and five views, and `command_render` now counts the Fleet route.

### Phase 3 — Work › Tasks › Lanes

- **Card fields:** `seatId`, `laneRank`, `closer: "self"|"human"`, and an editable `blockedOn` merged into `workState`.
- **Dispatch:** lane-aware selection in the pure `selectCandidates`, keeping a shared pool.
- **The board:**
  - lanes with pause/resume and **+ New lane**;
  - one governor (the menu plan's Agents switch) with a budget bar;
  - buckets: Inbox · Deferred · Archived · Completed.
- **Task inspector:** blockers, brief, done-when, closer, Evidence, and **Message this agent**.
- **Message this agent:** a second desk MCP tool, `check_messages`, with a seat inbox and receipts. CLIs without
  the desk tool are told plainly "reaches it on its next attempt".
- **Close reasons:** `closure:{reason: completed|handed_off_to|blocked_on|denied|canceled|no-follow-on|escalation, to, detail, by, at}`.

### Phase 4 — Missions and Refocus (Work › Plans)

- **Missions:** a plan's destination is its intent; `dependsOn` gives the waves and "After:"; tasks are its slices.
- **Project intent** is a new per-project record.
- **Progress** = verified slices / total, derived from evidence.
- **Trace to intent:** slice → mission → project.
- **The reminder:** the intent chain goes into the prompt on retries and long runs.
- **Drift detector:** raises a Health signal.

### Phase 5 — Panels & flow on the unified shell (after menu Phase 2)

- No new `uiMode`: the section pages gain dock regions, via `--dock-*` offsets.
- The regions:
  - a persistent inspector;
  - a status bar (project · section › tab · PC · working / waiting on you and why · governor · sync);
  - a buckets bar;
  - a **+ Add panel** picker.
- Saved tab layouts per section. Vibe stays the calm mode.
- Configuration is the one settings home: `Ctrl ,`, interface and text scale, rows opening the setup helper.
- Old views become panels: Session explorer → Sessions, Activity → inspector Evidence, Overhead retired after
  Fleet Graph, Agents overview → Fleet Table plus the governor.

### Phase 6 — Continuity and the seat editor (Agents › Team)

- **Seat recaps** (about 1.5k characters) handed to the next generation.
- **Seat editor:** model/runtime, Habits (variants, token costs), tools, skills and context packs; Launch.
- **Team spec** export/import, validated by `agentProfiles.validate`, never carrying keys, shareable through the
  vault's team-preset shelf.

### Phase 7 — Progress monitor, budgets, mind-virus tracing

- **Build `task:metrics`** (designed in `docs/task-agent-metrics-handoff.md`): per-run and per-seat tokens/USD,
  and a team budget in the governor.
- **Activity against verified movement**, per mission and per team, raises a "ceremony" signal.
- **Provenance tags** per prompt (habit, recipe, skill, mail), with *Trace to source* and *Check effect*.

### Phase 8 — Friends in the fleet (after menu Phase 4)

- **Your PCs:** they appear as hosts through the vault heartbeat, "as of <time>".
- **Friends' fleet cards:**
  - they travel through Rooms at companion-friends share levels (`status` = counts; `work` = up to 3 titles);
  - they go through `share-review.cjs` both ways and are labelled "From <name> · not you";
  - they are never sent to a model, and never carry paths, keys or IPs.
- **Guest seats** appear as their own pod, with PR edges.

## Verification

**Every slice:**
- `npm run build-booklet` + `git diff --exit-code renderer/booklet.html`;
- `npm run check`, `npm test`, `npm run audit`;
- the slice's vm suites and Electron fixtures at all four sizes;
- for anything that touches the fleet's host or IPC, `node_modules/.bin/electron tools/verify_fleet.cjs` (the real app on a throwaway profile);
- a TESTRUNS row via `node scripts/append-testruns-row.mjs`;
- land on `main`, then `npm run sync`.

**End to end (Phase 2):** a real builder run shows up in Live › Fleet.
- Its seat goes working → finishing, with a Recent row and a wire to the verifier.
- A retry raises the generation count.
- *Open in Command* lands on its orb.
- Minimising the window stops the pushes.

## Risks

- **`main.cjs` churn from parallel sessions:** one-line guarded hooks, logic in modules, rebase daily.
- **Performance:** push only while watched, hold while hidden, one merge per 250 ms, paint on signature change only.
- **The auditor:** literal `ipcMain.handle`/`send` in `main.cjs`.
- **Privacy:** clipped titles only; the friends path goes through `share-review.cjs`.
- **Direction:** Phase 5 waits for menu Phase 2 and the owner's OK on the dock layout.
