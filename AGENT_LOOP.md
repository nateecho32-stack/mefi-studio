# How the agent loop works

A grounded walkthrough of Mefi's Studio AI+'s autonomous agent loop, from a
chat message to a verified task, with file:line citations checked against the
current sources on 2026-09-21. Companion reading: `AGENT_LOOP_VERIFICATION.md`
(what has been verified about planning/integration) and `README.md`.

## 1. Intake: chat becomes a board task

The assistant thread, the Command composer and the board box all land in
`assistantCreateTask` (main.cjs:7425). It writes a task with
`status: "open"`, `source: "chat"`, a log line `task created by the assistant`
(main.cjs:7442) and dedupes on a compact title key so a retried send cannot
double the work. Tasks live in the project's `data/eyes-tasks.json`; requests
(a lighter inbox) live in `data/eyes-requests.json`.

## 2. The tick: autopilotPass

The loop's heartbeat is `autopilotPass` (main.cjs:10131), scheduled by
`setAutopilot` every `autopilot.minutes` (default 5) via `setInterval`
(main.cjs:10235). One tick, in order:

1. A proactive pass (brief/audit/collision requests) when the proactive
   preference is on. The loop itself runs regardless — the switch only decides
   whether ticks add an AI brief (renderer/explorer.js:1373-1374).
2. Every 6th/12th tick: `grow`/`improve` expansion (main.cjs:10148-10155).
3. `autopilotHousekeeping` — recovery, lease refresh, verification (§6).
4. `promoteRequestsToTasks` (main.cjs:10157).
5. `assistantAskForWork` (main.cjs:10168 → 4448) wakes the **foreman** role,
   which is what actually fills free worker slots; dispatch also happens when
   a job ends (main.cjs:9130) or the pool is widened (main.cjs:10241-10244).

## 3. Selection and claim: spawnNextJob

`spawnNextJob` (main.cjs:8032) is the dispatcher:

- Candidates are `open` tasks not live anywhere, sorted oldest-first, filtered
  by backlog readiness (`backlog.workState`), failure backoff (`nextRunAt`,
  max 5 `runFailures`) and title-key collisions with live work
  (main.cjs:8216-8219). Requests rank ahead of tasks (main.cjs:8225-8228).
- Each candidate passes a collaboration gate (`assistantModule.claimWork`,
  main.cjs:8255-8274): a file claimed by a sibling job, a finished-but-
  uncommitted session, or a live editor defers the pick.
- The pick is recorded as a Policy Lab `decision` (main.cjs:8313-8334).
- A run entry is built with id `run_<startedAt>_<seq>` (main.cjs:8357)
  carrying `outputTail`, `sawDone`, `handoffs`, `calls`, `depth`, etc.
- The claim is ONE transactional `mutateBoard` (main.cjs:8444-8476): the task
  is re-read fresh, checked still `open`, then stamped `status: "active"`,
  `runId`, `lease = { pid, at }` (main.cjs:8470) and the log line
  `autopilot picked up task` (main.cjs:8472). A lost race returns `"lost"`.
- File-level write locks (`claimWrite`, main.cjs:8424-8433) keep a second
  dispatch off the same paths; a machine-lease and capacity recheck can still
  cancel the claim before any child exists (main.cjs:8519-8527).

## 4. The worker: a headless CLI agent

The prompt is assembled piecewise against `EXECUTOR_PROMPT_MAX` (24000,
main.cjs:2876): title, resume checkpoint, the task brief, prior-failure note,
compiled memory primer, collaboration advice, then the fixed tail — run
identity, handoff protocol (`MEFI_NEXT:`, `MEFI_CALL:`, capped at 3 each,
main.cjs:2870-2873), the ~15-minute budget warning, `MEFI_RESULT:` and the
verdict sentinel `MEFI_JOB_DONE` (main.cjs:8575-8591). For tasks, the brief
tells the worker to re-read its full record in `data/eyes-tasks.json` via
`taskContext.buildTaskHandoff` (main.cjs:8647-8649) — exactly the handoff this
walkthrough was dispatched with.

The run is a child process (main.cjs:9274-9282): `cmd.exe /c opencode run
--auto` with the prompt on **stdin** (never the command line), tools
auto-approved because nobody is at the keyboard. `grok`, `claude`, `codex` and
`antigravity` are alternative routes with the same contract (main.cjs:9194-9263),
with a one-shot silent-exit fallback to opencode (main.cjs:9313-9316).

Output is line-buffered by `wire()` (main.cjs:9151-9186): every line marks
`spoke`, the strict line-match `isDoneMarkerLine` sets `sawDone`
(main.cjs:9162; scripts/assistant.mjs:3405-3406 — quoting the sentinel in
prose never counts), `MEFI_RESULT:` is parsed into `resultNote`,
`MEFI_NEXT:`/`MEFI_CALL:` lines become handoffs and role wake-ups
(main.cjs:9168-9170), and the last 8/200 lines feed `outputTail`/`outputLog`.
Progress checkpoints (todos, fraction) are polled from the session every 10s
(`EXECUTOR_PROGRESS_POLL_MS`, main.cjs:2896) into `runProgress` — the object
this task's own JSON shows. Two watchdogs back the budget: a wedged-start
kill (main.cjs:9390-9399) and the hard 25-minute kill (main.cjs:9376-9379).

## 5. Settlement: finish()

When the child closes, `finish()` (main.cjs:8659) runs:

- The run's OpenCode session is attributed first (`attributeRunSession`,
  main.cjs:8670 → 7543) so evidence has an owner.
- The verdict: `ok = no spawn error && (sawDone || exit 0)` (main.cjs:8684).
  The CLI's exit code alone is never the verdict (main.cjs:8571-8574).
- A durable `finish` event is appended to `data/executor-log.jsonl`
  (main.cjs:8688-8705) and a Policy Lab `attempt-finish` record
  (main.cjs:8718-8736).
- One ownership-fenced `settle()` mutation (main.cjs:8774-8980) then:
  - **ok** → `status: "awaiting_verification"` with the attempt's evidence;
    handoffs become visible `remaining` obligations (main.cjs:8888-8905) and
    `runExecutorHandoffs` (main.cjs:9088 → 9646) queues them as requests;
    a done report also schedules the overseer's own verification commands
    (`scheduleVerificationOnDone`, main.cjs:8916-8933) which
    `runVerificationJobs` (main.cjs:9091 → 9615) executes.
  - **user stop** → checkpoint saved, task returns to `open` with no failure
    charged (main.cjs:8934-8947).
  - **failure** → `runFailures += 1`, backoff 1 min then 10m/20m/40m… cap 2h,
    after 5 tries parked for manual reopen (main.cjs:8948-8967). Infra
    failures (spawn error or a silent death <15s) trip an executor breaker
    that parks all dispatch (main.cjs:9103-9110).
- Chat-sourced work gets a thread reply ("Finished (verifying)") at
  main.cjs:9120-9122, and the freed slot is refilled (main.cjs:9129-9130).

## 6. Verification: autopilotHousekeeping

Reported success is not done. Each tick's housekeeping (main.cjs:9746)
gathers evidence per `awaiting_verification` card — session file changes
(`eyes.listChanges`, main.cjs:9803) and executed checks
(`eyes.listSessionChecks`, main.cjs:9811) inside the attempt's time window —
plus the overseer run's command results (main.cjs:9895-9913), and calls
`verifyCompletion` (scripts/assistant.mjs:3623):

- **verified** → `status: "done"`, `doneAt`, receipt id kept
  (main.cjs:9989-9999). Receipts land in `data/policy-lab/receipts.jsonl`
  (main.cjs:10102-10112).
- **unverified** → back to `open`, `verifyAttempts += 1`, retry in 60s;
  bounded at `VERIFY_MAX_ATTEMPTS` (3) (main.cjs:10002-10018).
- **failed** (budget exhausted or failed checks) → parked for manual review
  with no `nextRunAt` (main.cjs:10007-10010).

Edits without an attributable session, or zero changed files with no executed
named checks, are exactly the "no attributable edits and no named checks"
reopen this task experienced on its first attempt.

The pass no longer waits for the next tick to look again (2026-09-21):

- `finish()` aims one coalesced settle at the moment the attempt's 30 s
  evidence dwell expires (`kickVerificationSettlement`, which always keeps the
  earliest requested moment), so a card is judged ~31 s after its run ends
  instead of up to `autopilot.minutes` later.
- Housekeeping re-arms itself for what it had to skip: a card still inside
  its dwell (`followUp.dwellMs`), or a card whose evidence store did not
  answer (`VERIFY_EVIDENCE_RETRY_MS`, bounded by `VERIFY_EVIDENCE_RETRY_MAX`
  per streak, then the tick owns it).
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
live leases (main.cjs:9834-9837) and re-queues claims whose run died with the
app (`executorResume.recover`, main.cjs:9826-9830).

## 7. Renderer surfaces

- `renderer/booklet.js:1107-1125` — the boot sequence; `startAgents` choice
  releases the launch hold so the loop may dispatch ("Open and start agents").
- `renderer/explorer.js:1373-1390` — proactive toggle (service preference);
  `:1391-1403` subscribes to checkpoint/briefing/request pushes.
- `renderer/eyes.js:5-18` — the change-feed view state (sessions, changes,
  todos, agent filter) over worker sessions.
- `renderer/boot.js:206-218` — shared read-only IPC methods
  (`assistantStatus`, `tasksList`, …) and the visibility-gated poll guard /
  rAF beats (`:220-252`).

## 8. Worked example: this task's own loop trace

From `data/eyes-tasks.json` (task_c35c6b59aadcb22e): created by the assistant
from chat → `autopilot picked up task` (claim, run_1790029669300_1, lease
stamped) → worker ran, printed `MEFI_JOB_DONE` (`sawDone: true`) → settled to
`awaiting_verification` → housekeeping found 0 attributable changed files and
no named checks → `unverified`, `verifyAttempts: 1`, `nextRunAt` +60s →
re-dispatched as run_1790029946688_4 with a fresh lease and `runProgress`
(todos, outputTail, workerPid). The loop is this cycle: intake → tick → claim
→ CLI worker with sentinel protocol → evidence-fenced settlement →
verification → retry or done.
