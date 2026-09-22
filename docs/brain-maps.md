# Brain maps: the pipeline you can rewire

The loop always had a pipeline — an idea or a request is checked, analysed,
planned, briefed, reviewed by the assistant, set up for Jev, routed to a model,
built and verified. Until now it only existed as the order of calls inside
`main.cjs`. A **brain map** is that pipeline as data: typed parts, typed ports,
wires between them, and per-part permission, model and settings.

Open it with **B**, from the sidebar, the Command dock, the palette, the tools
menu on any sheet, or the link in Settings → Model routing.

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
| `work.dispatch` | `autopilot.execute` — whether ready work is handed to workers at all, plus `parallel` |

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
`capability`, `missing`, `verify` — plus `run-failed`, which the host raises
itself when a worker ends without printing `MEFI_JOB_DONE`. Three per run, and
asking is never a way to end a job.

`issue.triage` then decides:

- **settled by the assistant** — only the retryable kinds, only the ones its
  `auto` list names, and only inside `autoRetryLimit` attempts on that task.
- **asked** — everything else becomes a card in Ask, titled after the task,
  carrying the file or failing check and the last lines the agent printed, with
  options that act on that task.

**Two kinds are always yours**: `permission` (granting reach the agent was not
given) and `risk` (accepting something that cannot be undone). No brain map can
automate them; `normalizeSetting` strips them out of an `auto` list on save and
`triageIssue` refuses them again at the decision.

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
| `split` | Make the extra work its own card, keep this brief |
| `replan` | Send it back through planning with what the agent found |
| `grant` | Record the reach **on that task only**, then retry |
| `proceed` | Record your approval for the risky change, then retry |
| `instruct` | Your one line becomes the note the next worker reads first |
| `hold` | Nothing changes; the note stays on the task |

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
- **Nested brains**: `brain.call` hands a branch to another saved map, up to
  four deep. A map cannot call itself, and a ring is refused.
- **Build with AI** drafts a map from a sentence, using this same catalog. It is
  validated like any other map and saved only after you look at it.
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

- `scripts/brains.cjs` — catalog, schema, validation, compile, gates, policy.
  Pure: no Electron, no filesystem, no clock.
- `scripts/agent-issues.cjs` — the issue protocol, triage and the cards.
  Also pure.
- `main.cjs` — the store (`data/brain-maps.json`, per project), the IPC, the
  issue path from a run's output to the rail, and the answer actions.
- `renderer/brains.js` / `renderer/brains.css` — the editor.
- Tests: `tests/brains_map.test.mjs`, `tests/brains_ui.test.mjs`,
  `tests/agent_issues.test.mjs`, `tests/assistant_issue_host.test.mjs`.

A map is bounded on the way in and on the way out: 120 parts, 240 wires, 24
maps per project, ids and coordinates clamped, unknown parts kept as errors so
a map saved by a newer build can still be opened and fixed.
