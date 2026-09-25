# Task agents, cost and speed — implementation handoff

## Outcome

From any task, the owner can open **Usage & agents** and answer four questions:

1. Which workers and AI seats actually contributed, including delegated subtasks and retries?
2. What is the task's **recorded USD cost**, and how much work has no per-call price?
3. How long did it take, how much agent time ran, and what measured speed and token use are available?
4. Which attempt, agent, model and provider accounts for those numbers?

Use the selected task **and all of its delegated descendants** as the default total. Show the selected task's own subtotal alongside it. A follow-up or split card with no `parentTaskId` is a separate task; do not silently add it to the total. All readings remain local and project scoped. Reading this view must not start a model call or a provider account probe.

## What exists now

| Source | Useful facts | Gap for this feature |
| --- | --- | --- |
| `scripts/task-attempts.cjs`, `executor-log.jsonl`, `main.cjs` `tasks:attempts` | A task's runs, route, start/end, fallback, session ID and outcome. The Task detail already renders these under Evidence → Attempts. | The log is trimmed, its default read returns at most 20 attempts, and it has no usage or actor breakdown. |
| Board task rows and `scripts/task-delegation.cjs` | `parentTaskId`, `delegatedFrom`, `delegation.childTaskIds` and nested child cards provide durable family identity. | No family usage rollup. Missing/archived child rows must produce a coverage note. |
| `scripts/work-events.cjs` and `scripts/agent-brain-host.cjs` | `agent.out`/`agent.home`, run/step events and desk activity make agent work visible. | The stream is trimmed and does not record call-level usage; `agent.out` names a builder role, not every underlying CLI child session. |
| `scripts/eyes.mjs` `usageLedger` and `listSessions` | OpenCode assistant turns have session, agent, provider, model, token, cost and timing data. Sessions have `parentId`. | The usage reader covers 35 days, is capped, and its turn query does not return the session parent. Current task usage only selects the root session. |
| `scripts/model-performance.cjs` and `scripts/usage-tracker.cjs` | Studio call observations, `runId` where set, `scopeUsage`/`rollupUsage`, and known/unknown cost rules. | Observations are capped at 10,000; most seat calls lack a task/run identity. `source: "seat:desk"` is normalized to `request`, so the role is lost. |
| `main.cjs` `usage:task` and `renderer/model-lab.js` Context | A read-only cost line for the **latest attempt**. | It is neither a whole-task total nor available from the task itself. Non-OpenCode CLIs generally lack per-turn prices. |

Provider account balances and subscription windows in Models → Usage are a different measure. Never allocate an account balance or monthly plan fee to a task.

## Proposed task view

Add a **Usage & agents** tab to the existing Task detail (`renderer/booklet.template.html`, `renderer/tasks.js`). It should load on selection, refresh while the task is running, and cancel or ignore stale reads on project/task switches. Use the existing task-detail tabs and text-first cards so the 600×560 window remains usable.

```text
Usage & agents                                      Updated 2:41 PM
Recorded cost  $0.84 + 7 unpriced calls             Task + 2 subtasks
Own task        $0.32 + 2 unpriced calls             [View own only]
Execution span 26m 18s       Worker time 42m 05s     3 attempts · 1 retry
Tokens         82k input · 11k output · 14k cache read
Speed          47 output tok/s across 9 measured calls

Agents used
Builder · OpenCode / model X · 2 attempts · $0.32 · 15m
Sub-agent · Task B / Codex CLI · 1 attempt · unpriced · 21m
Desk · model Y · 1 answer · $0.01 · 3s

Runs and attribution
Task A / run … → Open session … → turns, cost, elapsed
Task B / run … → CLI result … → unpriced, elapsed
Coverage: OpenCode store available; 2 earlier runs predate saved accounting.
```

The example numbers are illustrative. Always label the top-level price **Recorded cost**; it is not a provider bill. When there is no measured usage, say “No recorded usage”; when every observed call is unpriced, say “Unpriced · N calls.” Never render `$0` for an unpriced plan or subscription. Show `$0` only when the source truly reports a zero-cost call or a local model. Keep provider/model detail and attempt links expandable; an attempt links to its existing Evidence entry and Open session action. Add an **Open task usage** link from Model Lab's Context cost line to this tab rather than maintaining two definitions of task cost. Agent Brain's task selection can use the same link.

## Report contract and calculations

Add a read-only `task:metrics` IPC endpoint and preload method taking `{ taskId, projectId }`. Reject a task from another project like `tasks:attempts` does. Put the pure aggregation in `scripts/task-metrics.cjs`; return only bounded IDs, labels and metrics to the renderer, never prompts, transcripts, keys or account data.

Suggested response shape:

```js
{
  ok: true, taskId, projectId, asOf,
  coverage: { complete: false, reasons: ["2 old runs have no saved usage"],
              pricedCalls: 9, unpricedCalls: 7, unknownTokenCalls: 3 },
  own: { /* summary */ }, family: { /* summary */ },
  agents: [ /* actor, role, taskId, runIds, provider/model, metrics */ ],
  attempts: [ /* runId, taskId, sessionIds, route, times, outcome, metrics */ ],
  providers: [ /* provider/model and known/unknown totals */ ]
}
```

Definitions:

- **Recorded cost** = sum of unique usage records with a known `costUsd`; keep `unpricedCalls` next to that sum. Do not infer a price from public model rates, token counts, plan limits or a session's aggregate cost if its turns are already counted. Separate a future “equivalent API estimate” from recorded cost if one is ever added.
- **Family total** = union of the selected task and recursive `parentTaskId` descendants within the same project. Count each `runId` and each usage record ID once, even when a parent and child both refer to a report or a session. Own subtotal includes only the selected task's runs and directly attributed calls.
- **Execution span** = first recorded start in the selected scope to its latest finish, or to `asOf` while live. Include waiting for delegated work. Label it incomplete if the first start is missing. **Worker time** = sum of actual executor-run durations; parallel workers may make this exceed the execution span. Seat-call durations appear in the agent rows but are not added again to worker time when they overlap a run. Keep wait time separate rather than subtracting it into a misleading “speed.”
- **Speed** = sum of known output tokens divided by sum of elapsed seconds for the same completed model-call records that have both values. Name the call count used. Do not divide all output tokens by task wall time. A CLI with no turn timings gets “Speed unavailable.” Median call latency and first-token time may be shown only when recorded.
- **Attempts** = executor starts, with failed, stopped, released and successful outcomes shown separately. Verification state remains the existing source of truth for task completion; a worker's exit code does not become a quality score.
- **Coverage** is part of every number: store unavailable, trimmed ledger, old attempt, missing session, missing provider usage, ambiguous attribution and unknown price are distinct reasons. A partial recorded amount stays visible with its qualifier.

## Attribution and durable accounting

1. **Run identity.** Use the executor's `taskId`/`runId` start and finish rows as the authoritative link. `agent.out`/`agent.home` add the visible builder role and model/route where recorded. Delegate lineage comes from board rows, not from title matching or timestamps.
2. **OpenCode sessions.** Associate the run's root `sessionId` with descendant sessions using `session.parent_id`; carry that parent into the usage reader or query a bounded session ancestry map. Attribute each assistant turn by stable message ID and the run's time window. Sessions may be reused on a retry: a session ID alone is insufficient. Resolve overlapping/ambiguous windows once or leave the turn unassigned with a coverage reason. Never charge the same turn to both parent and child.
3. **Other builder CLIs.** Show the CLI, route/model when known, run timing and outcome. If no per-call token/cost report is saved, show “usage unavailable” or “unpriced” as appropriate; never substitute provider account limits. Capture future structured CLI usage when supported, keyed to `runId`, without blocking a worker on accounting.
4. **Studio seats and task-specific calls.** Pass explicit `{ taskId, runId, seat }` context through `seatFetch` and other task-scoped model-call paths (lead, desk, scout, classifier, verifier where applicable) into `recordModelCall`. Persist these fields in `model-performance.cjs` rather than relying on the current `source` whitelist or a clock-window guess. Project-wide companion, background maintenance and unrelated chat stay in project Usage; allocate them only when they have an explicit task identity. One call belongs to one task/run.
5. **Durability.** Add a versioned, project-local `task-metrics.json` (or equivalent project-local store) with per-run snapshots keyed by `runId`, a task-scoped bucket for calls with `taskId` but no run yet, and per-record IDs inside each bucket. Recompute and replace a bucket from the two source ledgers while its data is available; never add a new rollup to an old rollup. Save live checkpoints, refresh after run finish when OpenCode has written the final turn, and reconcile incomplete snapshots after restart. Preserve the last complete snapshot beyond the 35-day OpenCode window and the performance ledger's retention cap. If a source never becomes available, save the explicit gap. Keep this file under the existing ignored project `data/`, out of Git and packages. The accounting writer must use the project's existing serialized/atomic write pattern and must never delay dispatch or settlement.
6. **Older tasks.** Backfill from retained executor rows, observations and sessions on first read or via a bounded migration. Label pre-snapshot history as partial when a log was trimmed or the 35-day/retention window excludes it. Do not claim an exact lifetime total for old tasks without evidence.

The snapshot is a derived accounting cache, not a third source of billing truth. It must retain the source and timestamp of each figure so a later correction can replace it. Use a stable record key such as `studio:<observationId>` or `opencode:<messageId>` for deduplication. A completed run with zero observed calls still needs an explicit coverage state; zero calls and a failed store read are different.

## Implementation sequence

1. Build and test the pure family/run/session attribution and summary module. Extend the OpenCode usage reader with the bounded ancestry needed for child sessions. Prove record-level deduplication before adding the UI.
2. Carry task/run/seat identity through Studio model calls, then add the durable per-run checkpoint and restart reconciliation. Keep existing project Usage and Model Lab contracts backward compatible.
3. Add `task:metrics` in `main.cjs`/`preload.cjs` with project guard and bounded payload. Return a coverage note when a source is unavailable instead of failing the whole report.
4. Add Task detail's Usage & agents tab, the Model Lab link, live refresh and keyboard/small-window behavior. Keep the existing Evidence → Attempts fold as the detailed transcript and verdict view.
5. Update `docs/architecture.md`, `docs/code-map.md` and `CHANGELOG.md` when the feature ships. Rebuild the committed booklet after renderer edits.

## Acceptance checks

- A task with two attempts using the same OpenCode session charges each turn once to its actual attempt; a delegated child and its own child roll into the root family total without appearing in the root own subtotal.
- Root and OpenCode child-session turns, a priced desk answer and a Studio run-scoped call appear under the correct agent/seat and provider. A generic companion call does not enter the task total.
- An overlapping or unmatched session turn is not guessed into a task. A missing OpenCode store, missing start/finish, trimmed old rows and a missing delegated card each produce the appropriate partial-coverage message.
- A subscription or plan call with no per-call price increases `unpricedCalls`; the UI never calls it free. Provider account windows remain separate.
- Live numbers may change while a run finishes; after restart and after source-ledger retention, a completed snapshot keeps its recorded figures. Re-reading or reconciling does not double count.
- Execution span and summed worker time differ correctly for parallel child runs. Output tokens per second uses only rows with both output and elapsed data.
- Project switches cannot show another project's report. At 600×560, the tab, agent list, coverage note and attempt links remain reachable by keyboard and scrolling.

Run focused pure tests and the relevant Task/Model Lab renderer fixtures while implementing. Before shipping an application change, follow `CONTRIBUTING.md` and `TESTRUNS.md`: `npm run build-booklet`, `npm run check`, `npm test`, `npm run audit`, and record the runs in `TESTRUNS.md` through its append tool.
