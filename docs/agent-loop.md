# How the agent loop works

A grounded walkthrough of Mefi's Studio AI+'s autonomous agent loop, from a
chat message to a verified task. Every file:line citation below was re-derived
from the code it points at on 2026-09-22, after the loop cleanup; they drift
whenever those files change, so treat a citation that no longer lands on what
the sentence describes as stale, not as the code being wrong. Companion reading:
[`agent-loop-verification.md`](agent-loop-verification.md)
(what has been verified about planning/integration) and the [README](../README.md).

## 1. Intake: chat becomes a board task

The assistant thread, the Command composer and the board box all land in
`assistantCreateTask` (main.cjs:8309). It writes a task with
`status: "open"`, `source: "chat"`, a log line `task created by the assistant`
(main.cjs:8326) and dedupes on a compact title key so a retried send cannot
double the work. Tasks live in the project's `data/eyes-tasks.json`; requests
(a lighter inbox) live in `data/eyes-requests.json`.

## 2. The tick: autopilotPass

The loop's heartbeat is `autopilotPass` (main.cjs:11594), scheduled by
`setAutopilot` every `autopilot.minutes` (default 5) via `setInterval`
(main.cjs:11702). One tick, in order:

1. A brief, only when the roster's key gate sees no key (keyless CLI route,
   custom key; main.cjs:11612) and the backlog is not draining:
   `autopilotProactivePass` (main.cjs:8141) briefs at most once per 5 minutes
   and logs only news. With a key the briefer briefs on its own cadence; the
   watcher and auditor file collision, duplicate and audit requests keylessly
   either way (scripts/assistant.mjs:90-106). The proactive switch
   (renderer/explorer.js:1382) turns this timer on and off (main.cjs:13357)
   and gates the AI roles; the foreman dispatches regardless.
2. Every 6th/12th tick: `grow`/`improve` expansion, on the same keyless path
   only (main.cjs:11615-11622); with a key the grower and improver own it.
3. `classifyPendingWork` shapes pending work and the queue depth is refreshed
   (main.cjs:11625-11626). A history/feed row is written only when the pass
   queued something (main.cjs:11628).
4. `assistantAskForWork` (main.cjs:11631 → 4832) wakes the **foreman**, whose
   pass (main.cjs:4706-4724) settles (`autopilotHousekeeping`, §6), promotes
   requests, admits backlog ideas while draining and fills free worker slots;
   the tick no longer runs those steps a second time. Dispatch also happens
   when a job ends (main.cjs:10272) or the pool is widened
   (main.cjs:11708-11710).

## 3. Selection and claim: spawnNextJob

`spawnNextJob` (main.cjs:8924) is the dispatcher; `executeNextRequest`
(main.cjs:8503) calls it once per free slot:

- Candidates are `open` tasks not live anywhere, sorted oldest-first, filtered
  by backlog readiness (`backlog.workState`), failure backoff (`nextRunAt`,
  max 5 `runFailures`) and title-key collisions with live work
  (main.cjs:9114-9117). Requests and tasks are then ranked together, not
  inbox-first: `executorResume.compare` puts resumable work ahead, then
  `compareWork` orders by pin and age (main.cjs:9123-9126). The queue used to
  shadow the whole board, so a chat task waited behind every filed request.
- Each candidate passes a collaboration gate (`assistantModule.claimWork`,
  main.cjs:9153): a file claimed by a sibling job, a finished-but-
  uncommitted session, or a live editor defers the pick. The "skip" line for
  a held pick, like the "executor route failed" line (main.cjs:9045), is
  latched: logged once per distinct reason, not on every wake (main.cjs:9193).
- The pick is recorded as a Policy Lab `decision` (main.cjs:9229); an
  all-deferred pass that repeats with the same held set is recorded once, and
  the recommended order is `observation.actions` itself, with no duplicate
  `recommended` array (main.cjs:9226).
- A run entry is built with id `run_<startedAt>_<seq>` (main.cjs:9269)
  carrying `outputTail`, `sawDone`, `handoffs`, `calls`, `depth`, etc.
- The claim is ONE transactional `mutateBoard` (main.cjs:9381-9412): the task
  is re-read fresh, checked still `open`, then stamped `status: "active"`,
  `runId` and `lease = { pid, at }` (main.cjs:9407), with no log line. Since
  `status` and `runId` left the brief-context `FIELDS`
  (scripts/task-context.cjs:13, which gained `absorbedInto`), neither a claim
  nor its release adds a `contextHistory` revision; a revision hashed under
  the old list is compared through the new one (scripts/task-context.cjs:49).
  A lost race returns `"lost"`.
- File-level write locks (`claimWrite`, main.cjs:9361) keep a second
  dispatch off the same paths; a machine-lease and capacity recheck can still
  cancel the claim before any child exists (main.cjs:9461-9468). Every release
  names its gate (`cancelClaim(reason)`, main.cjs:9315): an executor-log
  `{ event: "release", reason, heldMs }` row (main.cjs:9331), and the
  advisory roster the claim left on the Command view is cleared
  (main.cjs:9335).
- The release rows answered why claims were dropped: on 2026-09-22, 31 of
  113 claims were released, every one at a capacity gate (responsiveness
  16, memory 13, update hold 2), 15-25 s into the planner/reviewer advisory.
  The machine sample is only 750 ms old at the claim, so the pressure
  really does rise during the advisory (siblings ramping up), and an earlier
  fence would not catch it. So a card's answered advisory is kept
  (`clusterAdvice` above `prepareClusterJob`): a re-claim within 30 minutes
  whose brief, mode and last finished run are unchanged reuses it instead of
  paying for the two calls and the reference search again. Advice where both
  advisors failed is not kept, so a re-claim asks again.

## 4. The worker: a headless CLI agent

The prompt is assembled piecewise against `EXECUTOR_PROMPT_MAX` (24000,
main.cjs:3237): title, resume checkpoint, the task brief, prior-failure note,
compiled memory primer, collaboration advice, then the fixed tail — run
identity, handoff protocol (`MEFI_NEXT:`, `MEFI_CALL:`, capped at 3 each,
main.cjs:3233-3234), the ~15-minute budget warning, `MEFI_RESULT:` (asked for
as one line under 300 characters) and the verdict sentinel `MEFI_JOB_DONE`
(main.cjs:9578). For tasks, the brief tells the worker to re-read its full
record in `data/eyes-tasks.json` via `taskContext.buildTaskHandoff`
(main.cjs:9701) — exactly the handoff this walkthrough was dispatched with.

The run is a child process (main.cjs:10459): `cmd.exe /c opencode run
--auto` with the prompt on **stdin** (never the command line), tools
auto-approved because nobody is at the keyboard. `grok`, `claude`, `codex` and
`antigravity` are alternative routes with the same contract (main.cjs:10295) —
except `grok`, which takes the prompt as a positional argument rather than on
stdin, so a run's brief is visible in that process's command line.
A one-shot fallback to opencode covers a CLI that exits non-zero without ever
writing to stdout (main.cjs:10504); output on stderr alone — a deprecation
notice, say — does not count as the CLI having reported on the work.

Output is line-buffered by `wire()` (main.cjs:10301): every line marks
`spoke` (and, on stdout, `spokeOut`), the strict line-match
`isDoneMarkerLine` sets `sawDone` (main.cjs:10323;
scripts/assistant.mjs:3514 — quoting the sentinel in prose never counts),
`MEFI_RESULT:` is parsed into `resultNote` — a line over 300 characters is
clipped, not dropped, since dropping it cost the card its result, its named
checks and its overseer run (scripts/assistant.mjs:3530) — and
`MEFI_NEXT:`/`MEFI_CALL:` lines become handoffs and role wake-ups
(main.cjs:10329-10339). A run already at
`EXECUTOR_MAX_DEPTH` is told not to hand off, and a `MEFI_NEXT:` it prints
anyway is declined, not accepted: no child can be admitted past the limit,
so accepting it made the line a `remaining` obligation nothing could
discharge. That card failed verification three times, re-running each time,
was parked, and left every ancestor waiting forever — one seed that used the
protocol as written ended as 15 cards, none done after four hours. Declined
titles are named on the card's "run finished" log line instead. All three marks are
anchored to the start of the line and read through the same colour strip, so
a run can neither talk itself into being done nor talk the board into new
work by quoting the protocol, and a CLI that wraps its last line in colour
still has its verdict counted. The last 8/40 non-empty lines, colour codes
stripped, feed `outputTail`/`outputLog` (main.cjs:10351-10356), so a bare
colour reset can no longer become the run's recorded last line; the live
studio-log echo is stripped the same way and skips colour-only lines. The
overseer's "builder finished" note quotes the worker's own `done:` summary,
never the sentinel or the raw `MEFI_RESULT:` line (`assistantHearBuilder`).
Progress checkpoints (todos, fraction) are polled from the session every 10s
(`EXECUTOR_PROGRESS_POLL_MS`, main.cjs:3269) into `runProgress` — the object
this task's own JSON shows. A save is a board write and a broadcast, so it is
paced by what changed (`queueExecutorCheckpoint`, main.cjs:8404): a session
binding, a todo or fraction change, the sentinel or the result line is saved
within 1 s; a plain output line within 30 s (main.cjs:10360). Two watchdogs
back the budget: a wedged-start kill (main.cjs:10591) and the hard 25-minute
kill (main.cjs:10564).

The wedged-start kill fires when a run has neither printed a line nor
registered a session within its start budget. That budget used to be a fixed
three minutes (plus 45 s per job over four, which a manual pool capped at
three never reaches), and it was a cliff: a runner that reliably needs three
and a half minutes to say anything was killed on every card, forever, and
nothing completed at all. The budget now moves with evidence:

- every run's first line records how long its runner took to start, and the
  budget is never less than **twice the slowest of the last eight starts**;
- after start kills with no start in between it widens **1.5x per kill**, but
  that blind widening stops at **twice the base**, because a runner that never
  speaks is exactly what this watchdog exists to stop;
- any start resets the kill count, and nothing waits longer than **ten
  minutes**.

Measured with the monitor (§9), nine tasks over two hours: a runner needing
3.5 or 5 minutes to first output went from 0 of 9 done (19 kills, 57
slot-minutes burned) to 9 of 9 (3 kills, 9 slot-minutes). The price is
paid by runners that genuinely never speak: with two in three wedged, the
kills cost 58.5 slot-minutes instead of 48. A runner needing more than six
minutes is still killed — by then silence more likely means wedged than slow.

In a manual pool each start kill also narrows `autopilot.parallel` by one,
but for the session only: `autopilot.parallelNarrowedFrom` remembers the
limit the operator chose, and that is what the settings save writes. Three
healthy first lines in a row step the pool back up by one until it is at
that limit again, and an explicit limit or mode change ends the narrowing.
It used to be saved to settings and never widened, so one slow stretch left
the pool at one worker for good (~90 minutes for the nine tasks above
instead of ~30 at three). Automatic mode holds new starts for 30 s instead.

## 5. Settlement: finish()

When the child closes, `finish()` (main.cjs:9718) runs:

- The run's OpenCode session is attributed first (`attributeRunSession`,
  main.cjs:9733 → 8433) so evidence has an owner.
- The verdict: `ok = no spawn error && (sawDone || exit 0)` (main.cjs:9747).
  `opencode run` exits 1 even on a clean run, so the exit code is not the
  success signal (main.cjs:9555), and `ok` only means the run reported
  success (main.cjs:9744-9746).
- A durable `finish` event is appended to `data/executor-log.jsonl`
  (main.cjs:9755) — its tail leaves out the sentinel and result lines, which
  it records as `sawDone`/`result` — and a Policy Lab `attempt-finish` record
  (main.cjs:9823). Ledger appends ride one chain, and the first append in each
  process trims a ledger past 4 MB to its last 5000 lines (`executorLog`,
  main.cjs:7541).
- The attempt's `lastAttempt.tail` is the worker's last real line, not the
  sentinel, and `lastAttempt.support` keeps one marker per advisory (role, ok,
  size or error); the raw advisory text reached the worker in its brief
  (main.cjs:9842-9859).
- One ownership-fenced `settle()` mutation (main.cjs:9862) then:
  - **ok** → `status: "awaiting_verification"` with the attempt's evidence;
    handoffs become visible `remaining` obligations (main.cjs:10027) and
    `runExecutorHandoffs` (main.cjs:10231 → 10891) queues them as requests;
    a done report also schedules the overseer's own verification commands
    (`scheduleVerificationOnDone`, main.cjs:10041) which
    `runVerificationJobs` (main.cjs:10234 → 10857) executes. The card gets one
    line, `run finished (…) — awaiting verification · verifying: <commands>`
    plus any hand-off counts (main.cjs:10056), where a separate "verification
    scheduled" line used to follow; the worker's own `MEFI_RESULT` goes on a
    `result` line after it.
  - **user stop** → checkpoint saved, task returns to `open` with no failure
    charged (main.cjs:10062).
  - **failure** → `runFailures += 1`, backoff 1 min, then 20m/40m/80m;
    after 5 tries parked for manual reopen (main.cjs:10099-10103). Infra
    failures (spawn error or a silent death <15s) trip an executor breaker
    that parks all dispatch (main.cjs:10245-10251).
  - **start kill** → the wedged-start watchdog killed a run that never
    registered a session and never printed a line. The runner failed, not the
    work, so the card goes back to `open` on its own cooldown (1m, 2m, 4m…
    capped at 30m) with `startFailures += 1` and **no attempt charged**
    (main.cjs:10076). Past `EXECUTOR_START_FAILURE_GRACE` (5) consecutive start
    kills the card is charged as an ordinary failure after all, so a task that
    really does wedge its runner still reaches review; any run that does start
    clears the streak. Before this, a stretch of slow CLI starts spent every
    card's five tries without a single brief being read — the studio's own
    executor log for 2026-09-18 shows 91 of 160 runs killed that way and not
    one task reaching `done`.
- Chat-sourced work gets a thread reply ("Finished (verifying)") at
  main.cjs:10263, and the freed slot is refilled (main.cjs:10272).

## 6. Verification: autopilotHousekeeping

Reported success is not done. Housekeeping (main.cjs:11014) runs in every
foreman pass and on the settle kicks below. It gathers evidence per
`awaiting_verification` card — session file changes (`eyes.listChanges`,
main.cjs:11145) and executed checks (`eyes.listSessionChecks`,
main.cjs:11153) inside the attempt's time window — plus the command results
of the overseer run queued for that attempt (main.cjs:11368), and calls
`verifyCompletion` (scripts/assistant.mjs:3776):

- **verified** → `status: "done"`, `doneAt`, receipt id kept, and the line
  `verified — <reason>` (main.cjs:11404-11415). Receipts land in
  `data/policy-lab/receipts.jsonl` (main.cjs:11550).
- **unverified** → back to `open`, `verifyAttempts += 1`, retry in 60s;
  bounded at `VERIFY_MAX_ATTEMPTS` (3) (main.cjs:11425-11436). The line reads
  `unverified — <reason> · retry n/3` (main.cjs:11439).
- **failed** (the third unverified attempt) → parked for manual review with no
  `nextRunAt` (main.cjs:11434); the line ends `· parked for manual review`
  (main.cjs:11212).

Edits without an attributable session, or zero changed files with no executed
named checks, are exactly the "no attributable edits and no named checks"
reopen this task experienced on its first attempt.

An overseer run counts only for the attempt it was queued for — its key
carries the attempt's run id; a legacy row without one needs a run that landed
after the attempt started (`overseerRunFor`, main.cjs:11294) — because the
`verificationRun` stamp is never cleared. A done card is reopened by its own
attempt's failed run only if that result landed after the verdict it
contradicts, never over the user's manual Done (main.cjs:11316-11317), with
the line `reopened — overseer check failed — …` (main.cjs:11338). Session and
overseer checks are judged together (latest wins) but summarized apart, so
the reason names who ran the check (scripts/assistant.mjs:3802-3847). A task
keeps the overseer's result on the stamp only (main.cjs:10805); its detail
view shows it as an "Overseer check" line (renderer/tasks.js:1131-1138) in
place of the old "verification run passed/failed" log line, which request
rows keep (main.cjs:10810). A task's verification job carries its card's
`projectPath` and runs there; a job without one runs in the active project
root (scripts/assistant.mjs:3650; main.cjs:10774).

Evidence is fetched only for cards the pass can actually judge. The prefetch
above runs outside the board lock, so it used to read `listChanges` and
`listSessionChecks` for **every** `awaiting_verification` card — including the
ones the mutator then skips because their overseer check is still in flight
(`overseerRunPending`) or because they are still waiting on handed-off children
(`waitingTaskIds`). Those reads are eyes-worker round trips into the OpenCode
store, they were discarded, and they repeated on every pass for as long as the
card waited. Both gates now run before the prefetch (main.cjs:11138-11139),
the handoff one against the same `reconcileTaskHandoffs` result the mutator
will compute (exact, not the one-pass-stale saved `handoffState`), and only
on boards that have outstanding obligations at all. In a monitored
handoff-heavy hour that took 2,464 store reads down to 22 with an identical
board outcome. The prefetch's rows are only a hint (the mutator re-derives
every decision under the lock), so they come from a plain board read, not a
no-op transaction (main.cjs:11093-11100). The opened-files set
(`eyes.listReads`), which only teaches path memory, is read after the settle
and only for attempts verified with edits (main.cjs:11528-11544). The
board-wide stale-scope heal (`healBoardFileScopes`, main.cjs:10967) runs at
most every 5 minutes (main.cjs:11019), and a basename its walk could not find
is not walked for again for 30 minutes (main.cjs:10971-10978).

The pass no longer waits for the next tick to look again (2026-09-21):

- `finish()` aims one coalesced settle at the moment the attempt's 30 s
  evidence dwell expires (`kickVerificationSettlement`, which always keeps the
  earliest requested moment), so a card is judged ~31 s after its run ends
  instead of up to `autopilot.minutes` later.
- Housekeeping re-arms itself for what it had to skip: a card still inside
  its dwell (`followUp.dwellMs`), or a card whose evidence store did not
  answer (`VERIFY_EVIDENCE_RETRY_MS`, bounded by `VERIFY_EVIDENCE_RETRY_MAX`
  per streak, then the foreman's cadence owns it).
- A card whose overseer check is queued or in flight in THIS process
  (`verificationJobs` / `verificationInFlight`) waits for that result instead
  of settling ahead of it and being reopened by the failing run minutes
  later; a stale "queued" stamp from an earlier app session never blocks.
- Identical base checks across a burst of done reports share one execution
  (`runSharedCheck`): a check that started at or after a job was created
  covers that job's edits, in flight or landed within 3 minutes. Focused
  tests still run per job, sequentially, after the shared check.

The Command graph treats verifying as waiting, not work: only the two newest
verifying cards keep a name at rest (`recentVerifyingIds`), the label is the
compact one-line chip rather than the two-line RUNNING-style plate, and
verifying callouts rank behind live sessions for the card budget. The HUD's
"Verifying N" count carries the total. Housekeeping also refreshes
live leases (main.cjs:11192-11194) and re-queues claims whose run died with the
app (`executorResume.recover`, main.cjs:11187). It logs one `housekeeping:`
line only when the sweep did something (main.cjs:11564-11574), and counts the
queue depth from the collections its mutation returned (main.cjs:11576).

## 7. Renderer surfaces

- `renderer/booklet.js:1312` — the boot sequence; `startAgents` choice
  releases the launch hold so the loop may dispatch ("Open and start agents").
  A launch that resumed an interrupted session (main.cjs `startupResume`) never
  holds in the first place, so the agents that were running come back with it.
- `renderer/explorer.js:1382` — proactive toggle (service preference);
  `:1398-1410` subscribes to checkpoint/briefing/request pushes.
- `renderer/eyes.js:5` — the change-feed view state (sessions, changes,
  todos, agent filter) over worker sessions.
- `renderer/boot.js:217` — shared read-only IPC methods
  (`assistantStatus`, `tasksList`, …) and the visibility-gated poll guard
  (`:230-260`).
- `main.cjs:7668` — `autopilotStatus`, the `assistant:status` push. It carries
  only what a renderer reads (the capacity verdict, not the machine sample; no
  pids, project paths or queue depth), with every key on every push, because
  the Command view merges pushes into its slot (renderer/idle.js:5122). A
  waiting reason is re-sent only when it changes, digits ignored so a
  drifting memory figure is not news (`setAutopilotWaiting`, main.cjs:7713),
  and pause and stop clear it (main.cjs:6135-6138, 11668-11671); the Command
  header shows "paused" ahead of any waiting reason (renderer/idle.js:5281).
- `renderer/workspace.js:425-441` — a tasks, ideas or status push already
  carries its own data, so the workspace re-reads only the backlog snapshot;
  the 15 s backstop and the visibility refresh still re-read every panel
  (`:872-873`).

## 8. Worked example: this task's own loop trace

From `data/eyes-tasks.json` (task_c35c6b59aadcb22e): created by the assistant
from chat → `autopilot picked up task` (claim, run_1790029669300_1, lease
stamped) → worker ran, printed `MEFI_JOB_DONE` (`sawDone: true`) → settled to
`awaiting_verification` → housekeeping found 0 attributable changed files and
no named checks → `unverified`, `verifyAttempts: 1`, `nextRunAt` +60s →
re-dispatched as run_1790029946688_4 with a fresh lease and `runProgress`
(todos, outputTail, workerPid). The trace predates the 2026-09-22 loop
cleanup: a claim no longer writes the pickup line it shows (§3). The loop is
this cycle: intake → tick → claim → CLI worker with sentinel protocol →
evidence-fenced settlement → verification → retry or done.

## 9. Watching it run

`tools/monitor_loop.mjs` runs this loop — the real dispatch, claim, stream
parsing, settlement, verification and foreman code, lifted out of `main.cjs`
by `tests/fixtures/host_executor.mjs` — against a virtual clock, so an hour of
loop time passes in about a second. Only the boundaries are doubles: the
clock, the child processes, the stores. No Electron, no worker CLI, no
network, no credentials, and nothing on disk is touched except `--json`
output.

```powershell
node tools/monitor_loop.mjs --scenario all --minutes 60 --tasks 9
node tools/monitor_loop.mjs --scenario handoffs --minutes 40 --tasks 4 --trace --json tools/logs/loop-handoffs.json
```

Scenarios differ only in how the fake worker behaves — how long it takes, what
it prints, what evidence its session leaves — because that is the only thing
the loop cannot know in advance: `steady`, `handoffs` (every run hands two
follow-ups on), `wedged`, `no-evidence` (reports done, leaves nothing behind)
and `flaky`. `--first-output` sets how long a worker takes to print its first
line, which is the number the wedged-start watchdog judges every run by; a
worker starts up first and then works, so a job's duration runs from that
line.

Each run reports where the time went per card (queue → claim → report → done),
what the pass cost (board transactions, store reads by key, timers armed,
roles woken, host CPU per phase), how much slot time went to runs the host
killed, and a five-minute board census. `--json` adds every card's status
transitions and the board as the run left it. What it measured on
2026-09-22, before the loop cleanup:

| | steady (9 tasks, 1h) | handoff-heavy (2 seeds, 4h) |
| --- | --- | --- |
| Cards settled | 9 of 9 | 0 of 30 → **30 of 30** |
| Runs | 9 | 62 → **30**, one per card |
| Queue → claim (p50) | 4.5m | 17.5m |
| Report → done (p50) | 1.3m | never → 3.3m |
| Evidence reads | 9, one per attempt | 30, one per attempt |

The handoff column is where both of the loop's worst behaviours showed up,
and neither shows up in a unit test. Every run hands two follow-ups on, so
one seed grows into a 15-card tree; the leaves sit at `EXECUTOR_MAX_DEPTH`,
and before the depth fix (§4) their hand-offs poisoned them and, through
them, the whole tree. The evidence gates (§6) were found the same way: the
cards waiting on that tree were what the prefetch kept re-reading.

The loop cleanup was measured the same day with
`--scenario steady --minutes 60 --tasks 9` and
`--scenario handoffs --minutes 40 --tasks 4`, each run against a copy of the
tree from just before the cleanup and against the tree after it:

| before → after | steady (9 tasks, 1h) | handoffs (4 seeds, 40m) |
| --- | --- | --- |
| Cards settled | 9 of 9 → 9 of 9 | 8 of 56 → 8 of 56 |
| Runs | 9 → 9 | 36 → 36 |
| Queue → claim (p50) | 4.5m → 4.5m | 21.0m → 21.0m |
| Report → done (p50) | 1.3m → 1.3m | 3.3m → 3.3m |
| Evidence reads | 9 → 9 | 8 → 8 |
| Board transactions | 134 → **99** | 339 → **278** |
| Store reads | 131 → 179 | 284 → 354 |
| Log lines | 135 → **87** | 501 → **409** |

The loop does the same work card for card; only its cost moved. Each
housekeeping pass lost its no-op transaction (35 and 61 passes), and the log
lost the empty `housekeeping:` summary, repeated foreman asks and the doubled
hand-off line. Store reads rose because the monitor counts the prefetch's two
plain reads but not a transaction's own; the heal's board read, now once per
five minutes, won some back. The monitor wakes the foreman on each tick
instead of running `autopilotPass`, so the tick's savings are not in these
numbers. At 40 minutes the handoff trees are still growing, hence so few
settled cards in either run.

`--first-output` sweeps are how the start budget in §4 was chosen and
checked.

## 10. Loop guard and memory alignment

The loop above has three ways to go round in circles, and on 2026-09-22 the
live board did all three: 512 runs over 147 cards, 37 cards with five or more
runs, and a single follow-up chain seven generations deep.

- **Retries that erase their own budget.** An issue the triage policy may
  answer by itself used to answer "retry", and the retry cleared
  `runFailures`, `verifyAttempts` and `nextRunAt`, so the five-failure and
  three-verification parks could never trip (72 automatic retries against 9
  by the owner). Settle has already re-armed the card by the time the issue is
  raised, so `assistantRaiseIssue` now only records the assistant's decision
  ("Assistant decided: …") and leaves the counters alone. A map with no triage
  node answers nothing by itself, and an answer about a card that is already
  done is recorded without reopening it.
- **Provider outages charged to the card.** A run that ends on a usage limit,
  a rate limit or a connection that never opened is requeued by settle on its
  own backoff (5 minutes, doubling to 2 hours while the outage lasts) with no
  attempt charged: `provider unavailable (exit N) · … · requeued in Xm, no
  attempt charged`. No issue is raised for it.
- **Follow-ups of follow-ups.** A "split" answer used to mint
  `Follow-up: Follow-up: …` cards with no lineage, so the depth cap never
  applied. Splits now carry `splitFrom`/`splitDepth`, are titled
  `Follow-up: X`, `Follow-up 2: X`, `Follow-up 3: X`, and a fourth level is
  refused.

**The loop guard** is the backstop for whatever still circles. Every keeper
pass (every 10 minutes) reads the card's log lines written since its last
pass and keeps a small count on the card, `loopLedger`: charged run failures,
and failed verifications (at most one per attempt, keyed by the verifier's
reason with the failing command's output stripped). Provider outages, restarts,
stops on request, lost runs and workers that never started are never counted.
When a card reaches **6 counted failures, or the same verification reason 4
times**, since the guard was armed or since the owner's last *Try again*, the
keeper stamps `loopGuard` and the card shows as blocked: "Loop guard: … ".
*Try again* (or *Work on it*) clears the hold and restarts the count; nothing
else does. The verify park and the five-failure park still win when they apply.

**Memory alignment** runs in the same pass. A run's "finished, verifying" line
is now stored as an observation, not a verification; when the verifier has
spoken, the keeper appends its verdict to the card's folder ("verified done —
…", "not verified — …", "parked — …", "loop guard — …", "stopped — resumes
from saved progress") and supersedes the stale claim. A finished card's folder
is marked `settled`, so its notes stop reaching other workers' memory primer.
Owner notes and decisions are never rewritten or evicted by the keeper. Open
issue questions about finished or deleted cards are superseded. The overseer's
playbook merges near-duplicate lessons and retires lessons about a local
finding that has stayed clear for four reviews, and keeps the learned hot and
cold paths across reviews (they used to be dropped on every review).

**Switches.** `memoryAlign`, `loopGuard` and `loopGuardApply` are assistant
prefs (`assistant:prefs`), all on by default. `loopGuardApply: false` keeps
counting and reports "would hold N" without holding anything; `loopGuard:
false` releases every hold the keeper stamped.

**Seeing it.** The keeper's tidy line in the activity log carries the pass's
summary ("held 1 looping card · aligned 5 memory notes · 3 stalled
reviews"). For the whole picture, run the read-only report:

```powershell
node tools/memory_audit.mjs
node tools/memory_audit.mjs --data "dist/Mefi Studio AI+/resources/app/data/projects/<projectId>"
```

It prints every card by state (done, doing, review, stopped, stalled,
looping, would-hold), where its memory disagrees with the board, duplicate
card families and duplicate lessons. It reads copies in memory and never
writes to the data folder (`--json` output goes under `tools/logs/` only).
