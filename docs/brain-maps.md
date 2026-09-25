# Brain maps: the pipeline you can rewire

The loop always had a pipeline — an idea or a request is checked, analysed,
planned, briefed, reviewed by the assistant, set up for Jev, routed to a model,
built and verified. Until now it only existed as the order of calls inside
`main.cjs`. A **brain map** is that pipeline as data: typed parts, typed ports,
wires between them, and per-part permission, model and settings.

Open it with **B**, from **Work › Brain maps**, from Search, or from the link
in **Settings › Models**.

Companion reading: [`agent-loop.md`](agent-loop.md) for what each stage
actually does today.

## What a map is

```
idea.planner ─┐                                    ┌─ jev.classify ─┐
user.request ─┼→ check.user / check.model → analyze.scope → plan.build → brief.write
inbox.request ┘                                         → assistant.review → assistant.setup ┘
                                                              ↓
                                          model.pick → work.dispatch → verify.evidence
                                                              ↓
                                   issue.intake → issue.triage → ask.user → answer.apply
                                                              └──────── feedback ────────┘
```

The shipped map (`brains.defaultMap()`) is exactly the loop the studio runs,
drawn out, with the decision lane hanging off the build. It is marked
`builtIn`, so it can be edited freely and reset from the inspector.

Each part declares, and the inspector shows:

- **what it can do** and **what it cannot** — in words, not in types
- **the permissions it needs**, checked against what the map grants
- **the model** it uses: inherit Studio's routing, ask for a role, or pin one
- **its own settings** — the dials that stage really has
- **where it runs** (see below), and which switch making the map live moves

## Three kinds of part

`runs` on every catalog entry says which one it is, and the editor prints it on
the node and in the inspector. This is the honest line between what the map
*governs* and what it *describes*:

| `runs` | Meaning |
| --- | --- |
| `host` | The studio already performs this stage. The part holds its settings, and activating the map moves the one real switch behind it (see Gates). Nothing else about that stage is re-routed through the graph. |
| `map` | The map decides it outright — the whole decision lane. Editing these parts changes behaviour as soon as the map is saved. |
| `draft` | Saved, validated and drawn. Nothing executes it. (Only `note`.) |

## Gates: what activating a map actually moves

Activation is explicit, and the editor shows the list before it happens
(`brains:gate-plan`). A gate whose part is absent from the map is turned
**off**; a gate the map says nothing about (an empty map) is left alone.

| Part | Switch |
| --- | --- |
| `check.user` | `autopilot.autoBuild` — verify-first holds each saved scope for approval |
| `brief.write` | `assistant.prefs.proactive` — whether ticks may spend a call on a brief |
| `jev.classify` | `settings.jevShadow` — Jev routing on or off |
| `model.pick` | `settings.modelSelection` — `auto` compares candidates, `fixed` keeps your defaults |
| `work.dispatch` | `autopilot.execute` — whether ready work is handed to workers at all |
| `work.dispatch` · *Workers at once* | `autopilot.parallel` — the build worker limit, at most 3 (`EXECUTOR_PARALLEL_CAP`) |

*Workers at once* is the build worker limit, the same one the Command view's
worker control sets. Until 2026-09-22 activation wrote it to the assistant's
roster width (`assistant.prefs.parallel`, the background-role pool) instead,
so it never changed how many builds ran; a map saved then with 4 is read as 3.
It is its own row in the gate plan, shown from the limit in force now, so it
is seen before it moves. Two things it deliberately leaves alone: a limit a
wedged start narrowed for the session is not undone when the map asks for the
limit the owner already chose (`setAutopilot` restores a narrowed pool
whenever a limit is sent), and while the Machine agent manages workers the
row says the value is the manual limit it falls back to.

## The decision lane (this part is wholly the map's)

`issue.intake → issue.triage → ask.user → answer.apply` is what decides
whether an agent's problem reaches you.

An agent raises an issue by printing one line, anchored at the start of the
line exactly like the verdict sentinel:

```
MEFI_ASK: scope :: the retry banner needs a store too :: the brief only covers the view
MEFI_ASK: {"kind":"check-failed","title":"board tests fail","file":"tests/board.test.mjs"}
```

Kinds: `scope`, `blocked`, `permission`, `check-failed`, `conflict`, `risk`,
`capability`, `missing`, `verify`, `owner` — plus `run-failed`, which the host
raises itself when a worker ends without printing `MEFI_JOB_DONE`. *Issues per
run* (at most three) caps how many one run may raise, and asking is never a
way to end a job. With *Include stopped runs* off, a run that stops raises
nothing at all.

**`owner` is for something only you can do** — the board, Studio's task store,
another session's files. It is not a decision about the work: the agent has
finished what it can and says what is left for you. A worker files it with
`MEFI_ASK: owner :: …`, or puts it in the `owner:` part of its result line
(`MEFI_RESULT: done: …; remaining: none; owner: reword the stored acceptance`),
which is never counted as work the task still owes. A question filed under
another kind that is really put *to* you ("Will you correct the stored
acceptance?", "Should the owner land the staged files?", anything naming the
task store or an owner-only step) is reclassified to `owner` when it arrives.
Its card offers **I'll take care of it** (recommended), **Answer it in one
line** and **Leave it for review**; none of them makes a new card. This is the
lane that ends the loop of split cards re-verifying finished work only to ask
the same owner question again.

`issue.triage` then decides:

- **settled by the assistant** — only the retryable kinds, only the ones its
  `auto` list names, and only inside `autoRetryLimit` attempts on that task.
- **folded** — with *Repeat questions* on `fold` (the default), a question of
  the same kind that another card asked in the last day, in the same words or
  naming the same tasks with at least half its words in common, opens no card
  (the same tasks alone are not enough): if that card was answered, its
  answer is recorded on the new task as the assistant's (which never splits or
  re-arms anything); if it is still open, that card stands for both. `ask`
  puts every card in front of you.
- **asked** — everything else becomes a card in Ask, titled after the task,
  carrying the file or failing check and the last lines the agent printed, with
  options that act on that task.

**Two kinds are always yours**: `permission` (granting reach the agent was not
given) and `risk` (accepting something that cannot be undone). No brain map can
automate them; `normalizeSetting` strips them out of an `auto` list on save and
`triageIssue` refuses them again at the decision. More generally, *Settle by
itself* only keeps kinds the assistant has an automatic answer for
(`agentIssues.AUTO_ANSWERABLE`), so a kind without one — `owner` included — is
always yours without the map having to name it.

A card nobody answers expires after *Expire after (hours)*. *Open cards at
once* is held on the map but not enforced yet.

### Nested decision lanes

The lane does not have to sit on the top-level map. When *Agent issues* feeds
an **Another brain** part, the triage, ask and apply parts the issue actually
meets are looked for in that brain — nearest call first, as deep as nesting may
go (four), each map visited once, feedback wires not followed. Parts on the map
itself come first; a called brain fills in what it lacks. The host passes the
store's maps to `issuePolicyFor`, so this is what `activeIssuePolicy` reads.

A map with *Hand it to a worker* whose issues reach no Triage or Ask part gets
the warning `no-decision-lane`: its workers' questions would only be logged,
and permission and risk questions would never reach you.

### What an answer does

Every option is a real action on the work, applied by `assistantIssueAction`:
the decision is written onto the task first — `task.decisions`, `task.grants`
and a log line — and only then is the work re-armed, because the next worker
re-reads its own record (`buildTaskHandoff` puts *Decisions already made —
follow these* ahead of the previous attempt's report).

| Verb | What it does |
| --- | --- |
| `retry` | Re-arm the task with the decision on it |
| `retry-deep` | Same, plus a `deep` work-shape hint so the next dispatch routes to a stronger model |
| `narrow` | Keep to the brief; the extra work is reported, not done |
| `split` | Make the extra work its own card, keep this brief; the parent is never re-run |
| `replan` | Send it back through planning with what the agent found |
| `grant` | Record the reach **on that task only**, then retry |
| `proceed` | Record your approval for the risky change, then retry |
| `instruct` | Your one line becomes the note the next worker reads first |
| `acknowledge` | You will take care of it yourself: recorded on the task, no new card is made and nothing is re-armed |
| `hold` | Nothing changes; the note stays on the task |

**Split** carries the agent's question into the new card: the follow-up's
brief is what the agent asked (and what it saw), with a line saying it was
split out of the parent by you and that anything only you can do goes under
`owner:` rather than into another split. A note you type still wins. The
parent's decision entry keeps the question too. Splitting no longer re-runs
the parent, so its verify attempts and loop ledger stay as they were.

*Follow-ups per chain* (on **Apply the answer**, default 3, 0 to 5) is how deep
a chain may go: a follow-up split from a follow-up is one deeper. Split is not
offered on a card already at the limit (the card says so), and 0 turns Split
off; an answer that still asks for it is refused with the reason.

An answer that could not be applied says why on its card ("— not applied: …")
instead of reading as done. With *Say what changed* on, the assistant posts
one line in the thread naming the decision and the task after you answer.

## Which settings the studio reads

Every part carries dials, but only some of them are read by the host today.
Those are marked `wired: true` in the catalog; the inspector adds *Not read by
the studio yet* under every other one, and under the model block of every part
that has one (Studio's own routing still picks each part's model).

| Part | Settings the host reads |
| --- | --- |
| `model.pick` | *Selection* (a gate) |
| `work.dispatch` | *Workers at once* (a gate) |
| `issue.intake` | *Issues per run*, *Include stopped runs* |
| `issue.triage` | *Settle by itself*, *Auto retries*, *Repeat questions* |
| `ask.user` | *Expire after (hours)* — not *Open cards at once* |
| `answer.apply` | *Say what changed*, *Follow-ups per chain* |
| `brain.call` | *Map to call*, when Agent issues feeds it |

Beyond settings, the host reads whether a map has the Triage and Ask parts at
all (without them an issue is only logged) and the gates above. A note never
runs, so its text carries no mark.

## Live activity

The editor shows what the lane, dispatch and verification did in the last 24
hours (`brains:activity`, `brains.partActivity`): a count on the head of each
of those parts, and a *Last 24 hours* section in the inspector listing the
rest. It is read when the editor opens, when a map is saved or made live and
every 30 seconds while the sheet is open, and it stops when the sheet closes.
Far out, where a part shows only its title, the count is hidden.

| Part | Headline | Inspector |
| --- | --- | --- |
| Agent issues | raised | by kind (cards opened plus what was settled or folded without one) |
| Triage | settled | settled by the assistant, asked you, folded into an earlier answer |
| Ask you | asked | open now, answered, dismissed, expired, how often the recommended option was taken |
| Apply the answer | the most used verb | answers by verb, answers not applied |
| Hand it to a worker | started | finished (failed), released and the most common release reason |
| Verify the evidence | verified | verified, unverified |

It is read from what the host already keeps — the Ask cards, the decisions
written on tasks, the task log's verdict rows and the last megabyte of the
executor ledger — and `partActivity` is pure: the host passes `now`. Clearing
the Done log removes the ledger's finish rows, so *finished* counts only what
finished since the last clear; starts and releases are kept.

## Editing

The canvas is a view onto the map, not the map itself: scroll pans, Ctrl +
scroll (or a pinch) zooms around the pointer, dragging empty canvas pans, and
**F** fits the whole map. Zoomed far out, a part shows only its title and the
wires, so an 18-part pipeline reads at a glance; the minimap appears once part
of the map is off screen. Coordinates are stored unscaled, so zooming never
changes what is saved. Each map remembers where you last looked at it.

- **Wire**: drag from an output end to an input end, or click one and then the
  other. Ends that can take the wire light up, the rest dim, and a refused wire
  says why (`Values carries values; Analysis takes analysis/request`). Let go on
  a part and the wire lands on its first end that fits; let go on empty canvas
  and the parts search opens with the parts that fit listed first, so the new
  part arrives already wired. Escape cancels.
- **Space** opens the parts search wherever the canvas is looking; double-click
  the canvas to search at that spot. Once you type, parts already on the map are
  listed too, and **Ctrl F** searches only those.
- **Select several** with Shift or Ctrl click, a Shift drag on empty canvas, or
  **Ctrl A**. Dragging one moves them all, arrow keys nudge them, **Ctrl D**
  copies them with the wires that run between them, **Delete** removes them.
- **Ctrl Z** undoes any edit (wiring, moving, deleting, settings, grants) and
  **Ctrl Shift Z** redoes it. Undoing back to the saved map clears "Unsaved
  changes".
- **F8** walks the problems part by part; the problems bar lists every one.
- **Tidy** lines the parts up in pipeline order (feedback wires ignored); a
  drafted map whose parts landed on top of each other is tidied on arrival.
- **Feedback wires** close a loop deliberately: what they carry lands on the
  next pass, so the map stays orderable. They are drawn dashed and routed
  under the parts they span. The answer → check wire in the shipped map is one.
  A loop nobody marked is compiled with only its closing wire as feedback;
  the rest of the ring keeps its place in the order.
- **Nested brains**: `brain.call` hands a branch to another saved map, up to
  four deep. A map cannot call itself, and a ring is refused.
- **Build with AI** drafts a map from a sentence, using this same catalog. It is
  validated like any other map and saved only after you look at it. The model
  is told what every end carries and takes, which ports each kind can feed,
  and shown the shipped map as a valid example (`brains.draftPrompt`). Its
  reply is then repaired before you see it (`brains.repairDraft`):
  - Parts and ports it named loosely are matched to real ones. A part this
    build lacks, a second one-per-map part, or a call to a brain that is not
    saved here is left out.
  - A wire whose kinds do not fit is moved. It goes to another end of the
    same part, or past a part that makes what it already carries, or to the
    part on the map that takes that kind. Otherwise it is removed.
  - A required input left empty is fed from upstream. If the part sits beside
    an existing path, that path is run through it.
  - A loop gets its closing wire marked as feedback.
  - The grants are exactly what the parts need.

  If errors are still left, they go back to the model once, in the
  validator's words. The redrawn map is kept only if it has fewer errors.
  Every repair is listed under *Repaired in the draft* in the inspector until
  the map is saved. Whatever still cannot be fixed is drawn as a problem.
- **New map** starts empty and unsaved: the host does not keep a map with no
  parts, so it is saved once it has its first part.
- **Closing the editor never asks and never discards.** Unsaved edits stay and
  are back on the canvas the next time Brain maps opens in the same project;
  the Map menu's *Discard unsaved changes* throws them away. Switching maps
  with edits on the canvas asks whether to save them first.
- **?** opens the legend (stage colours, *Map rules* and *Note* badges, the
  switch marker, dashed feedback wires, red problem marks) and every shortcut.
  **[** and **]** hide or show the parts rail and the inspector.

Every question the editor asks — naming a map, drafting one, deleting,
resetting, the list of switches going live would move — is a panel inside the
sheet, because `window.prompt` does not exist in Electron.

## Where it lives

- `scripts/brains.cjs` — catalog, schema, validation, compile, gates, policy,
  activity counts, the draft prompt and the draft repair. Pure: no Electron,
  no filesystem, no clock.
- `scripts/agent-issues.cjs` — the issue protocol, triage and the cards.
  Also pure.
- `main.cjs` — the store (`data/brain-maps.json`, per project), the IPC, the
  issue path from a run's output to the rail, and the answer actions.
- `renderer/brains.js` / `renderer/brains.css` — the editor.
- Tests: `tests/brains_map.test.mjs`, `tests/brains_store.test.mjs`,
  `tests/brains_ui.test.mjs`, `tests/agent_issues.test.mjs`,
  `tests/assistant_issue_host.test.mjs`.

A map is bounded on the way in and on the way out: 120 parts, 240 wires, 24
maps per project, ids and coordinates clamped, unknown parts kept as errors so
a map saved by a newer build can still be opened and fixed. Two wires never
share an id: a missing or repeated one takes the next free `e_N`.

The store is written through a temp file and a rename, so a crash mid-write
leaves the previous store. A store that no longer parses is copied aside as
`brain-maps.broken-<time>.json` and logged before the shipped pipeline stands
in for it, so a save cannot quietly replace your maps; a store that is there
but cannot be read right now (locked, refused) is an error, never "no maps".
