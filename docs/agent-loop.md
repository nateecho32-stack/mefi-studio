# How the agent loop works

A grounded walkthrough of Mefi's Studio AI+'s autonomous agent loop, from a
chat message to a verified task. Code is cited by name: the function,
closure, constant or marker comment that holds it, so grep for it. This page
carried file:line citations until 2026-09-22, but `main.cjs` moves by hundreds
of lines a day and they were 250-650 lines off within a day of being
re-derived. Several names are closures, not top-level functions: `finish`,
`settle`, `wire`, `attach`, `cancelClaim`, `spawnAttempt` and
`fallbackToOpencode` live inside `spawnNextJob`, and `overseerRunFor`,
`overseerRunPending` and `refreshLease` inside `autopilotHousekeeping`. Grep
`const finish = async`, not `function finish`. The executor's decisions are
pure functions in `scripts/executor-core.cjs` (which card runs, the prompt,
the command line, what an output line says, how a run ended, what settling it
writes on the card, the start budget), tested apart in
`tests/executor_core.test.mjs`; `spawnNextJob` orchestrates them. Companion reading:
[`agent-loop-verification.md`](agent-loop-verification.md)
(what has been verified about planning/integration) and the [README](../README.md).

## 1. Intake: chat becomes a board task

The assistant thread, the Command composer and the board box all land in
`assistantCreateTask` in `main.cjs`. It writes a task with
`status: "open"`, `source: "chat"` and a log line `task created by the
assistant`. Every one of those admissions compares the whole brief against
the board, the inbox and live workers (`chatWork.findExistingChatWork`,
through the `conversation` option), so a sentence sent in chat and pasted into
the board box is one card, not two keyed on differently clipped titles. When
the composer's brief matches a request still waiting in the inbox, that
request becomes the card at once (`adoptRequest`), with the owner's pin and
origin, instead of the ask being refused in its favour: refused, the request
kept its filed band and no pin, and was lost whenever promotion would refuse
it. A match on a row an older build's run still holds is reported as queued in
the inbox, never as "on the board". The
Command view's "Add a task" input goes to `tasks:create` like the Workspace
composer, never through the chat classifier. What the chat itself does with a
message is §11. Tasks live in the project's `data/eyes-tasks.json`; requests
(a lighter inbox) live in `data/eyes-requests.json`.

Promotion (`promoteRequestsToTasks`) turns inbox requests into cards and
stamps each source request with `promotedTo`, the card's id. The request stays
in the inbox until the compactor absorbs it, and dispatch, the queue count and
the compactor all skip it by that id. They used to match the pair by title key
only, and a title cut to 90 characters, or one with no ASCII letters (an empty
key), left the request running beside its own card.

Every other way work enters runs the same admission ladder,
`scripts/work-admission.cjs` (`represented`, `admitTask`), inside the board
gateway: a stable identity first (a Work on it or stale-session rescue target,
a split's parent plus its note, a handoff, delegation or plan id), then the
whole brief (chat-work's rules; the model's reading is never compared), then
the title key against unfinished work. Whether a card still stands for a
roster finding is one rule, `standsOnBoard` (any card not archived), for the
filers' intake (`queueRequests`, and `requestBaseline`, which holds those
cards), promotion and compaction alike: intake used to count only unfinished
cards, so a finding filed again against its done card was admitted, refused
by promotion, absorbed by compaction and filed again on every pass until the
card was archived. The owner's explicit asks (Work on it) count only
unfinished work. So the filers do not re-file a request that was promoted and
absorbed from the inbox, two todos named alike
in different sessions are two Work on it requests, and a second split of one
card with a different note is a second follow-up, admitted in the same write as
the decision (a refused follow-up records no decision). Every card is built
from one skeleton (`taskRow`) and carries an `origin` (`{ kind, by }`); the
worth band (`baselineTaskPriority`, scripts/policy.mjs) ranks `by: "owner"`
work — chat, the composer, Work on it, splits, approved plans and ideas
promoted by hand — in the owner band, and promotion keeps a request's own
`source`, so its band on the board is the one it had in the inbox. The
Explorer's own inbox adds (`applyRequestAction`, scripts/idea-actions.cjs): an
ask typed into its inbox (`manual`) or an expanded checkpoint (`expand`) carries
`origin: { kind: "request", by: "owner" }`, and a row an older build saved
without one reads the same (`workAdmission.requestOrigin`), so those cards no
longer rank below every roster-filed request. A typed ask is titled from its
brief's first line (`requestTitle`, clipped to 90). New cards
come only through these paths: `tasks:save` edits existing cards and no longer
creates one, the whole-inbox `eyes:requests-write` is gone (`eyes:requests-action`
is targeted), and `ideas:save` and the first-run map merge ideas by id inside the
gateway.

## 2. The tick: the roster, and autopilotPass

The loop's heartbeat is the roster: `assistantTick` runs every 30 s (120 s
while the window is hidden) and queues the roles `dueRoles` finds due. Who
runs when and who spends AI is one table, `AGENT_ROLES` in
scripts/assistant.mjs: each seat's `cadenceMs`, `spendsAi` (`"always"`: the
run is a model call and waits for a usable key; `"when-usable"`: the
overseer and the ideas scan call when they can and run a local pass
otherwise; `"never"`) and `gates` (the owner switches that hold it: Proactive
off, backlog mode, the board's growth hold). The host derives its cadence
list, the forced tick's filter (`roleHold`, the same hold `dueRoles`
applies), the pool's AI accounting (`assistantRoleSpendsCall`) and the switch
holds (`assistantRoleSwitchHold`, over `assistantRoleGated`) from it. The
switch holds apply to every enqueue, not only the cadence: the foreman's
idle ideas scan, an overseer summons, a worker's follow-up and a resumed
journal entry all wait while Proactive is off or backlog mode holds the
role. Only the owner's own run passes (`assistantRunRole`, and an explicit
growth request also past the backlog hold); the idle foreman used to run a
paid ideas scan with Proactive off. A role is due when its cadence has
elapsed, when it owns a new problem (`PROBLEM_ROLES`), or when it holds
unread mail and reads it (`readsMail`:
only the foreman acts on its notes; the others take theirs on their own
cadence). A cadence pass is not journaled while it runs (`journal: false` on
`enqueue`): `dueRoles` re-derives it at boot, and only the quit flush saves
where it stood. Replies, reference gathers, a worker's follow-ups and
explicit growth are journaled at every step.

The watcher and auditor file collision, duplicate and audit requests
keylessly (`assistantWatcherJob`, `assistantAuditorJob`); the briefer,
improver and grower own the briefs and expansion, through the pool. The
proactive switch (`#proactive-mode`, wired in `init()` in
renderer/explorer.js) flips `prefs.proactive` through the `assistant:prefs`
handler and holds the roles gated on it; the foreman dispatches regardless.

`autopilotPass`, scheduled by `setAutopilot` every `autopilot.minutes`
(default 5), is an auxiliary pass that spends no AI call:

1. `classifyPendingWork` shapes pending work and `refreshAutopilotQueue`
   refreshes the queue depth.
2. `assistantAskForWork("auto builder pass")` wakes the **foreman**, whose
   pass (`assistantForemanJob`) settles (`autopilotHousekeeping`, §6),
   promotes requests, admits backlog ideas while draining and fills free
   worker slots; the tick no longer runs those steps a second time.

It used to brief, grow and improve outside the roster whenever `keyPresent`
was not true. `keyPresent` now reads the same predicate `runAssistant` gates on
(`aiRouteReady`: `aiRouteConfigured` plus the cached CLI lookups), so a false
one means no route can answer: those calls only ever failed, and before the
first tick refreshed `keyPresent` they could run a paid brief with no pool
accounting or backoff. For Auto the predicate walks what the resolver walks —
the signed-in CLIs first unless subscriptions-first is off, the saved order,
then any saved key outside it (`autoRescueProviders`) — so a CLI-only or
OpenRouter-only Auto setup is not held as keyless while its calls would
answer. A key save refreshes `keyPresent` at once.

`assistantAskForWork` is the one dispatch trigger, and it coalesces: a general
foreman pass (key `"foreman"`) already running is marked dirty for exactly one
more pass (`rerunRequested`, replayed by `assistantSettle`), and only an idle
foreman is enqueued. A named Start is a foreman entry too (key
`start:<project>:<task>`, its job bound to that task), so an ask during one
queues a general pass behind it; marking it dirty replayed the Start and lost
the fill. Dispatch is asked for when a job ends (`"a slot came free"` in
`finish`), when the pool is widened (`"the pool was widened"`, in
`setAutopilot`), for chat work and Work on it; the foreman's one-minute
cadence covers the rest. The compactor and job supervision no longer ask: the
compactor's ready count is a note to the foreman and supervision reports an
idle queue as a problem. The thinker (§11) only asks when it pins a ready
pick (its own form of Work on it); otherwise it only names the pick.

## 3. Selection and claim: spawnNextJob

`spawnNextJob` is the dispatcher; `executeNextRequest` calls it once per
free slot. It dispatches board tasks only:

- An inbox request reaches a worker by promotion (`promoteRequestsToTasks`),
  which the foreman runs before every fill and which admits the inbox in the
  dispatcher's own order (pins first), at most three rows a pass. When a fill
  runs out of ready cards while that pass promoted some, the foreman promotes
  again and fills the free slots at once (the bounded loop around
  `executeNextRequest` in `assistantForemanJob`, which now resolves to the
  fill's stop reason), at most three more rounds. Only a board with nothing
  ready counts (`autopilot.fillRanDry`): no cards, or only cards that are
  cooling, waiting on prerequisites or parked for review. A fill stopped by a
  free route's one-at-a-time cap, a full pool or a hold also reads "empty",
  and promoting again then would move the whole inbox onto the board
  unstarted; approval, a Cluster focus and a named Start never re-promote. Work on it
  on a session or todo files a pinned request
  that the same foreman pass promotes and starts; handoff, collision and audit
  requests take the same path. A promoted row stays in the inbox until
  compaction drops it, stamped with its card (`promotedTo`): promotion never
  takes it again and admission compares the card instead. A Work on it or
  rescue row matches only unfinished cards by its target, so without the stamp
  it came back as a second pinned card once its first was closed; a new Work on
  it click after that is new work. A row with no title (an ask an older build
  saved from the Explorer inbox) is titled from its brief's first line instead
  of being skipped for good. A `Fix:` request's fix themes are compared
  against fix work only, as compaction compares them: a chat or collision card
  that merely shares a loose theme no longer blocks it, since nothing else
  would run it. Until 2026-09-23 a request could also run as
  itself: claimed `"running"`, settled to `"verifying"` and verified into a
  done history card. That was a second copy of the claim, settlement and
  verification state machines, the copies had drifted, and it is gone; rows
  an older build left mid-run are migrated by housekeeping (§6).
- Candidates are `open` tasks not live anywhere, sorted oldest-first, filtered
  by backlog readiness (`backlog.workState`), failure backoff (`nextRunAt`,
  max 5 `runFailures`) and title-key collisions with live work, then ranked:
  `executorResume.compare` puts resumable work ahead, then `compareWork`
  orders by pin, then the operator's worth band (chat work first;
  scripts/policy.mjs), then age. All of that is `executorCore.selectCandidates`,
  which returns the `open` and `ranked` lists; `spawnNextJob` hands it the
  live jobs, the title key, the live-fix check and `compareWork`. The owner's
  explicit Start (`taskStart`) ranks only its own card, and only with the
  brief it was started with; a focused Cluster ranks only its focus. With
  nothing ranked, `executorCore.idleStopReason` names why ("cluster",
  "approval", "cooldown", "prerequisites", "review" or "empty"). The queue
  used to shadow the whole board, so a chat task waited behind every filed
  request.
- Each candidate passes a collaboration gate (`assistantModule.claimWork`,
  then `shouldHoldWork`): a file claimed by a sibling job, a finished-but-
  uncommitted session, or a live editor defers the pick. The "skip" line for
  a held pick (`autopilot.lastSkipLog`), like the "executor route failed"
  line (`autopilot.routeFaultLogged`), is latched: logged once per distinct
  reason, not on every wake.
- The pick is recorded as a Policy Lab `decision` (the marker "Policy Lab
  PR1 — the decision record" in `spawnNextJob`); an all-deferred pass that
  repeats with the same held set is recorded once
  (`autopilot.lastDeferredDecisionKey`), and the recommended order is
  `observation.actions` itself, with no duplicate `recommended` array. A
  selected pick's decision is held (`pendingPolicyDecision`) and written just
  before its `attempt-start`, with its pick-time `at`, so a claim released
  before launch leaves no decision the lab would never read.
- A run entry (`const entry`) is built with id `run_<startedAt>_<seq>`
  carrying `outputTail`, `sawDone`, `handoffs`, `calls`, `depth`, etc.
- The claim is ONE transactional `mutateBoard` (the comment "The claim is one
  transactional mutation" in `spawnNextJob`): the task is re-read fresh,
  checked still `open`, then stamped `status: "active"`, `runId` and
  `lease = { pid, at }`, with no log line. Since `status` and `runId` left
  the brief-context `FIELDS` (scripts/task-context.cjs, which gained
  `absorbedInto`), neither a claim nor its release adds a `contextHistory`
  revision; a revision hashed under the old list is compared through the new
  one (`legacyMatch`, same file). A lost race returns `"lost"`.
- File-level write locks (`claimRegistry.claimWrite`) keep a second
  dispatch off the same paths; a machine-lease and capacity recheck (the
  comment "Race recheck of the machine lease") can still cancel the claim
  before any child exists. Each step after an await re-checks one gate,
  `launchAllowed(entry)`: dispatch still allowed (`dispatchAllowed()`: the
  owner's Start, or the executor on and not paused), no update hold, and room
  in the pool. Every release names its gate
  (`cancelClaim(reason)`): an executor-log
  `{ event: "release", reason, heldMs }` row, and the advisory roster the
  claim left on the Command view is cleared (`autopilot.clusterAgents = []`).
  A release the card itself caused (its prompt could not be built, its
  delegation could not be saved) is charged to it: `claimFailures` with a 1-2
  minute cooldown, parked after three in a row (`loopGuard` kind `claim`, which
  Try again releases), and the rest of the same fill skips it
  (`autopilot.fillReleased`), so one malformed card no longer holds the head of
  the queue. Capacity, lease, pause and update-hold releases are never charged.
- The release rows answered why claims were dropped: on 2026-09-22, 31 of
  113 claims were released, every one at a capacity gate (responsiveness
  16, memory 13, update hold 2), 15-25 s into the planner/reviewer advisory.
  The machine sample is only 750 ms old at the claim, so the pressure
  really does rise during the advisory (siblings ramping up), and an earlier
  fence would not catch it. So a card's answered advisory is kept
  (`clusterAdvice` above `prepareClusterJob`): a re-claim within 30 minutes
  whose brief, mode and last finished run are unchanged reuses it instead of
  paying for the two calls and the reference search again. Advice where both
  advisors failed is not kept, so a re-claim asks again, and neither is
  advice for a claim already released (a breaker trip, an update drain, the
  ghost sweep): an answer that lands then is a failed report, never
  "findings", and nothing is cached.
- The claim is for the active project only. A project switch abandons a
  running roster pass and goes on, while that pass still runs scoped to the
  project left behind; the foreman returns before dispatch when its pass was
  abandoned, and `spawnNextJob`, the claim transaction and the launch gate
  all refuse a project that is no longer the active one. A per-run worktree
  checkout that outlasted the supervisor's two-minute ghost sweep finds its
  claim released (`entry.finished`) and discards the checkout instead of
  starting an untracked twin of the reopened card.

## 4. The worker: a headless CLI agent

The prompt is assembled piecewise against `EXECUTOR_PROMPT_MAX` (24000) by
`executorCore.workerPrompt`: title, resume checkpoint, the task brief,
prior-failure note, compiled memory primer, collaboration advice and smaller
hints such as the hot and cold paths (`spawnNextJob` gathers those, since
they read the assistant's state and the git index), then the fixed tail
(`executorCore.promptTail`) — run identity,
handoff protocol (`MEFI_NEXT:`, at most `EXECUTOR_MAX_HANDOFFS` = 3 per run;
`MEFI_CALL:`, which wakes a role from `EXECUTOR_CALLABLE` at most once per
role), the owner-question line (`agentIssues.issuePromptLine`), the ~15-minute
budget warning (`EXECUTOR_BUDGET_MINUTES`), `MEFI_RESULT:` (required on every
run, one line under 300 characters: Studio queues its verification check from
the `done:` report, and a run on a CLI that leaves no session, Claude Code,
Codex, Grok or Antigravity, cannot be verified without it) and the verdict
sentinel `MEFI_JOB_DONE` (`EXECUTOR_DONE_MARK`). Before the tail, the fixed
builder rules (`executorCore.INSTRUCTIONS`) cover the folder, previews and the
shared git index. Workers never push, pull, merge or sync branches, and never
run `git push` or `npm run sync`, even where the project's own notes say to
(this repository's AGENTS.md does): Studio and the owner land the work. They
are told not to invent names, commands, environment variables, packages or
API details, to put an unknown detail under `remaining:` or in a `MEFI_ASK`,
and to follow a roadmap item's plan in the project's `docs/`. A Windows run
(`workerPrompt`'s `platform`) also gets `WINDOWS_SHELL`: PowerShell, which
OpenCode and Codex may run in, has no `head` or `tail`, so it is told to use
`Select-Object -First`/`-Last`. For tasks, the brief points the worker at its full
saved record through `taskContext.buildTaskHandoff`'s `contextPath`: a small
read-only run file, `task-runs/<runId>.json` beside the project's board
(`writeTaskRunContext` in `main.cjs`), holding the task row with its
`contextHistory` and grouped members, plus its dependencies and split or
delegation parent without their histories. The whole multi-megabyte
`data/eyes-tasks.json` is named only when that write fails. Run files are
pruned to the newest 48, never one under two hours old.

With the prompt cache on (`scripts/prompt-cache.cjs`: `settings.ai.promptCache`
unless false, `MEFI_STUDIO_PROMPT_CACHE=0` to turn it off) the same words come
in another order, so a provider that caches prompt prefixes reads the part
every run shares from its cache: the selected skills, the builder instructions
and the tail's rules (`executorCore.promptParts`, word for word promptTail
without the run's identity) lead, then the task's own parts, and the run's
identity with the verdict sentinel closes the prompt. Two runs' prompts then
share about 4,200 of 4,600 characters as a prefix instead of a handful. Off,
the layout above is unchanged.

**Live progress.** Claude Code and `codex exec` say nothing in text mode until
they finish. With live progress on (`settings.executor.liveProgress` unless
false, `MEFI_STUDIO_LIVE_PROGRESS=0` to turn it off) Claude Code runs with
`--output-format stream-json --verbose --session-id <uuid>` (a fresh UUID per
attempt) and `codex exec` with `--json`; Codex's app server has its own facade
and is unchanged. `scripts/cli-stream.cjs` decodes each stream back into the
text lines `wire()`'s `take()` always read (the sentinel, `MEFI_RESULT:` and
the rest, once each: Claude's closing `result` repeats the last message and is
not read again), and into the run's session, todo list and done fraction,
active tool and token totals, which land on the entry, its checkpoint and its
attempt record (`cliSession`, `usage`) the way an OpenCode session's do. A
stream with no events in its first 20 lines (an older CLI) is read as text, and
a streaming Claude run keeps the start watchdog because its session line comes
within seconds.

The run is a child process (`spawnAttempt`): `cmd.exe /c opencode run
--auto` with the prompt on **stdin** (never the command line), tools
auto-approved because nobody is at the keyboard. `grok`, `claude`, `codex` and
`antigravity` are alternative routes with the same contract (`isCliRun`, and
`executorCore.cliInvocation`, which gives each route its command, arguments,
stdin and environment; `spawnAttempt` spawns them) — except `grok`, which
reads no prompt on stdin: the host writes the brief to
`task-runs/<runId>.prompt.txt` beside the run file, passes it with
`--prompt-file` (which is also what starts grok's headless mode) and removes
it when the run finishes. `claude` and `codex` run through `cmd.exe` with a
line built by `scripts/windows-command-line.cjs` and handed over verbatim, so
a path with a space or an apostrophe arrives as one argument; `grok` and
`agy` spawn directly, unless the first match on PATH is a batch shim (the
guided installer's npm install leaves `grok.cmd`, which Node cannot spawn
without a shell), which runs through `cmd.exe` the same way
(`agent-mcp.windowsShim`). Off Windows the shell routes are an `sh -c` line.
`claude` and `antigravity` run in print mode,
which says nothing until the answer and registers no OpenCode session, so they
arm no wedged-start watchdog (the hard kill still bounds them) and their first
line is not a start sample. A one-shot fallback to opencode
(`fallbackToOpencode`, from `attach`) covers a CLI that never got going: a
spawn failure, a wedged start, or a non-zero exit within `SILENT_DEATH_MS`
(15 s) without a line on stdout; output on stderr alone — a deprecation
notice, cmd's "is not recognized" — does not count as the CLI having reported
on the work. A later exit, or a quick one whose last words are a provider
outage (a usage limit), is the run's own to settle, so a print-mode run that
worked twenty minutes is not started again on another account, and an outage
still takes the uncharged requeue. With no OpenCode on the machine
(`opencodeCliAvailable`) a CLI route has no fallback at all, and its own
error stays on the card. The replacement is
judged on its own start and its own verdict: the CLI attempt's `spoke`,
`startKilled` and verdict flags are cleared before it attaches, and no
replacement starts once the run was stopped by the operator, the executor
paused or stopped, or its project left.

A resumed run's brief carries the previous run's saved output and result line
quoted (`> `, `executorResume.brief`), so a CLI that echoes its prompt (codex
does, on stderr) cannot replay them as its own verdict, result and hand-offs.

Output is line-buffered by `wire()`, and each line is read by
`executorCore.readWorkerLine` (what the line says, without changing the run)
and applied by `applyWorkerLine`: every line marks `spoke` (and, on
stdout, `spokeOut`), except a line of terminal escape codes alone, which is
no line at all; the strict line-match `isDoneMarkerLine`
(scripts/assistant.mjs) sets `sawDone` — quoting the sentinel in prose never
counts — `MEFI_RESULT:` is parsed into `resultNote` by `parseExecutorResult`
(same file) — a line over 300 characters is clipped, not dropped, since
dropping it cost the card its result, its named checks and its overseer run —
and `MEFI_NEXT:`/`MEFI_CALL:` lines become handoffs and role wake-ups
(`parseExecutorHandoff`). A run already at
`EXECUTOR_MAX_DEPTH` is told not to hand off, and a `MEFI_NEXT:` it prints
anyway is declined, not accepted: no child can be admitted past the limit,
so accepting it made the line a `remaining` obligation nothing could
discharge. That card failed verification three times, re-running each time,
was parked, and left every ancestor waiting forever — one seed that used the
protocol as written ended as 15 cards, none done after four hours. Declined
titles are named on the card's "run finished" log line instead. All three marks are
anchored to the start of the line and read through the same escape strip
(every CSI sequence, not only colour), so a run can neither talk itself into
being done nor talk the board into new work by quoting the protocol, and a CLI
that wraps its last line in colour, or clears the line before it, still has
its verdict counted. The last 8/40 non-empty lines, colour codes
stripped, feed `outputTail`/`outputLog` (`applyWorkerLine`), so a bare
colour reset can no longer become the run's
recorded last line; the live
studio-log echo is stripped the same way and skips colour-only lines. The
overseer's "builder finished" note quotes the worker's own `done:` summary,
never the sentinel or the raw `MEFI_RESULT:` line (`assistantHearBuilder`).
Progress checkpoints (todos, fraction) are polled from the session every 10s
(`EXECUTOR_PROGRESS_POLL_MS`, by `watchJobProgress`) into `runProgress` — the
object this task's own JSON shows. A save is a board write and a broadcast, so
it is paced by what changed (`queueExecutorCheckpoint`): a session binding, a
todo or fraction change, the sentinel or the result line is saved within 1 s;
a plain output line within 30 s (the `delay: 30000` call in `wire`). Two
watchdogs, both armed in `attach`, back the budget: a wedged-start kill
(`startWatchdog`, against `executorCore.startBudgetMs`) and the hard 25-minute kill
(`EXECUTOR_KILL_MS`).

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

Before it kills, the watchdog looks for the run's session once more
(`attributeRunSession`): the session poll gives up after a minute, and a
store that registered the run later still proves it started. The timer firing
counts as the budget having passed, since Node may deliver it a millisecond
early by the wall clock.

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

When the child closes, `finish()` (`const finish = async` in
`spawnNextJob`) runs:

- The run's OpenCode session is attributed first (`attributeRunSession`) so
  evidence has an owner.
- The verdict: `ok = no spawn error && (sawDone || exit 0)` (`const ok`).
  `opencode run` exits 1 even on a clean run, so the exit code is not the
  success signal (the comment saying so sits above `executorCore.promptTail`,
  which asks for the sentinel), and `ok` only means the run reported success
  (the comment above `const ok`).
- A durable `finish` event is appended to `data/executor-log.jsonl`
  (`executorCore.finishLogRecord`) — its tail leaves out the sentinel
  and result lines, which it records as `sawDone`/`result` — and a Policy Lab
  `attempt-finish` record (`executorCore.attemptFinishRecord`). Ledger appends
  ride one chain, and the first append in each process trims a ledger past
  4 MB to its last 5000 lines (`executorLog`).
- The attempt's `lastAttempt.tail` is the worker's last real line, not the
  sentinel, and `lastAttempt.support` keeps one marker per advisory (role, ok,
  size or error); the raw advisory text reached the worker in its brief
  (`executorCore.attemptRecord`).
- One ownership-fenced `settle()` mutation (`const settle`, inside `finish`)
  then applies one state machine, the task's (every run is a task's since
  direct request execution was retired, §3). `settle` keeps the fence, the
  verification scheduling and the write; the state machine is
  `executorCore.settleAttemptRow`, which returns the card's new row, and its
  branch is `executorCore.classifyRunEnd`'s:
  - **ok** → `status: "awaiting_verification"` with the attempt's evidence;
    handoffs become visible `remaining` obligations and `runExecutorHandoffs`
    (called from `finish`) queues them as requests; a done report also
    schedules the overseer's own verification commands
    (`scheduleVerificationOnDone`, scripts/assistant.mjs) which
    `runVerificationJobs` executes. The card gets one line,
    `run finished (…) — awaiting verification · verifying: <commands>` plus
    any hand-off counts, where a separate "verification scheduled" line used
    to follow; the worker's own `MEFI_RESULT` goes on a `result` line after
    it. The inbox copy the card was promoted from (same title key) is
    released, unless a run of an older build still holds it (`runId`). No
    assistant-history record is written: that was the direct-request run's
    record, and `requestBaseline` now only reads the ones older builds left.
    A parent with outstanding hand-offs only waits (`backlog.workState` stage
    `waiting`, `blockedBy: "handoffs"`; the Work view's "Waiting on
    follow-ups", never a review). Its `handoffState` still says when a
    follow-up needs review, but a stuck follow-up is flagged on its own card,
    not up the chain. A follow-up the owner drops (`tasks:action` `drop`:
    archived with a `dropped` stamp, never `doneAt`) or deletes settles that
    obligation. Deleting it is recorded on the parent as `droppedHandoffs`,
    so recovery never re-admits it. Once every recorded hand-off has settled,
    `verifyCompletion`'s `handedOff` lets the run's `remaining:` prose count
    as that delegated work. That only applies when the prose names no more
    items than were handed on and no owner-only work.
  - **user stop** → checkpoint saved, task returns to `open` with no failure
    charged (branch `"stopped"`); a card its owner stopped is held for them
    (`ownerHold`), or pinned if they asked for it again before the worker
    exited (`resumeRequested`).
  - **provider outage** → back to `open` on the outage backoff (5m doubling
    to 2h, `providerCooldownMs`) with no attempt charged (branch `"outage"`,
    within the grace `executorCore.providerOutage` bounds; §10).
  - **route refusal** → a provider that answered and refused this login's
    plan is the route's problem, not the card's. `finish` reads the run's own
    error and last words with `executorCore.entitlementRefusal`: "subscription
    required" (OpenCode Go's "An active OpenCode Go subscription is required
    to use Go models"), "no active … subscription", a model "not included in
    your plan", or HTTP 402. It is counted as a provider that said it was
    down, so the card takes the outage branch above (uncharged, on the outage
    backoff, within the same grace), with `lastRunError` set to the refusal in
    the owner's words (`refusedRoute(...).short`, passed to `settleAttemptRow`
    as `routeRefusal`), and the model ledger counts it as neither a win nor a
    loss. The host parks the route in memory (`executorRouteRefused`,
    `autopilot.routeRefusals`) for 5 minutes, doubling to half an hour while
    it keeps refusing (`executorCore.routeParkMs`). A subscription or payment
    refusal parks the provider (every model the login lists), a plan refusal
    only that model. While a park holds, `spawnNextJob` returns `"route"`
    before any claim, both before per-task model routing and after it, so the
    cards on that route are not each refused in turn. The owner hears it once
    per route (a thread notice, a feed warning and `autopilot.lastError`,
    naming the fix: another coding model in Agents › Setup › Team & models,
    or renewing the plan). A run that finishes on the route clears its marks
    (`executorRouteAnswered`), so a later refusal is news again; the owner's
    own Start (`taskStart`) bypasses the park, and a restart forgets it.
  - **failure** → `runFailures += 1`, backoff 1 min, then 20m/40m/80m
    (`failureBackoffMs`); after 5 tries parked for manual reopen ("gave up
    after 5 tries"). The next worker receives the prior error and repairs the
    task without an Ask card while retries remain. The fifth charged failure
    reaches Ask with its run evidence, named by its cause: a host stop reason
    in plain words ("ran past its time budget"), else the last output line
    that names an error, never a bare exit code or a `MEFI_*` protocol line
    (`runFailureIssue`). Since those retries are spent, the card recommends a
    heavier model rather than *Try again unchanged*. Infra failures trip an executor breaker that parks all
    dispatch after three in a row (`classifyRunEnd(…).infra` read into
    `infraFail`, and `AUTOPILOT_PARK_MS`, in `finish`). An attempt records
    how it ended (`entry.endKind`, set by `stop()`, the watchdogs and the spawn
    error paths), and only a spawn error, a start kill or a run that never
    spoke and died within 15 s counts; a 25-minute budget kill or a supervised
    stop of a run that talked never parks the executor.
    The park is saved as the executor still on (`setAutopilot`): saved as
    off, it never came back after a restart. A run that started (it spoke or
    bound a session) and then failed ends the card's streak of start kills.
  - **start kill** → the wedged-start watchdog killed a run that never
    registered a session and never printed a line. The runner failed, not the
    work, so the card goes back to `open` on its own cooldown (1m, 2m, 4m…
    capped at 30m, `startKillCooldownMs`) with `startFailures += 1` and **no
    attempt charged** (branch `"start-kill"`). Past `EXECUTOR_START_FAILURE_GRACE`
    (5) consecutive start kills the card is charged as an ordinary failure after all, so a task that
    really does wedge its runner still reaches review; any run that does start
    clears the streak, and so does Try again. Before this, a stretch of slow CLI starts spent every
    card's five tries without a single brief being read — the studio's own
    executor log for 2026-09-18 shows 91 of 160 runs killed that way and not
    one task reaching `done`.
- Only after that fenced commit are the run's own asks (`MEFI_ASK`, its
  result's `owner:` part) and its failure question raised
  (`raiseRunIssues`). A stale run whose card a newer run owns raises
  nothing, and the failure question is named by this run's error or last
  words, never the previous run's `lastRunError`.
- The freed slot is refilled (`assistantAskForWork("a slot came free")`).
  `finish()` posts nothing to the thread itself: settle's write is what the
  task notice feed reads (§11), so the owner hears "verifying", then the
  verdict, retry, stop or park, and a stop or an uncharged requeue is never
  reported as a failure.

## 6. Verification: autopilotHousekeeping

Reported success is not done. Housekeeping (`autopilotHousekeeping`) runs
in every foreman pass and on the settle kicks below. It gathers evidence per
`awaiting_verification` card — session file changes (`eyes.listChanges`) and
executed checks (`eyes.listSessionChecks`) inside the attempt's time window —
plus the command results of the overseer run queued for that attempt
(`verificationRunChecks(overseerRunFor(…))`), and calls `verifyCompletion`
(scripts/assistant.mjs):

- **verified** → `status: "done"`, `doneAt`, receipt id kept, and the line
  `verified — <reason>`. Receipts land in `data/policy-lab/receipts.jsonl`
  (`receiptsModule.appendReceipt`).
- **unverified** → back to `open`, `verifyAttempts += 1`, retry in 60s;
  bounded at `VERIFY_MAX_ATTEMPTS` (3, scripts/assistant.mjs). The line reads
  `unverified — <reason> · retry n/3`.
- **failed** (the third unverified attempt) → parked for manual review with no
  `nextRunAt` (the comment "Out of verification budget"); the line ends
  `· parked for manual review` (the `outcome` helper).
- **Builders without a session** (`executorCli` claude, grok, codex or
  antigravity; the attempt records it as `lastAttempt.route`) write no
  OpenCode session, so they are judged by the overseer's own verification run
  alone: its passing checks verify the attempt exactly as they do for
  OpenCode, and a failing or pending one fails it the same way. Only when no
  overseer run exists for the attempt (it reported no result) is it **failed
  at once**, parked on its first check with "`<cli>` runs leave no session
  the verifier can read, and no Studio check ran for this attempt" instead of
  retrying blind. That park is neither a win nor a loss in the model ledger
  (`receiptModelOutcome`).

Edits without an attributable session, or zero changed files with no executed
named checks, are exactly the "no attributable edits and no named checks"
reopen this task experienced on its first attempt.

Only tasks are verified. Inbox rows an older build left mid-run (from before
direct request execution was retired, §3) are moved onto the task path once,
inside the same mutation and before the lost-claim sweep
(`migrateLegacyRequests`, scripts/task-history.mjs), with one
`[autopilot] legacy request …` log line per row:

- a `"verifying"` row becomes an `awaiting_verification` task carrying its
  `lastAttempt`, `runId`, `runProgress`, `verificationRun`, `remaining`,
  target and sessions, source, origin, pin and brief. Its evidence is
  prefetched with the tasks', so it settles through the ordinary task
  verification in that same pass. The row leaves the inbox on a later pass,
  once that task is on the board: the file store writes the inbox before the
  tasks, and moving both in one mutation lost the finished attempt whenever
  the tasks write failed after the inbox write (or the app quit between them);
- a `"running"` row whose run no live owner holds goes back to the inbox
  without `status`, `runId`, `lease` and `runningAt`. Its checkpoint stays as
  `runProgress` (no longer pending, since promotion skips a pending row) and
  as `interruptedAttempt`, which promotion carries and the task's brief
  quotes, so the promoted task continues from what the lost run left. A
  claim whose lease names no usable pid is left to the sweep's lease timeout;
- an unclaimed row still holding a pending checkpoint (a stopped or
  recovered direct run) keeps it the same way, so promotion can take it.

A row put back in the inbox (by the migration, or by the sweep's own lease
timeout) is stamped `requeuedAt`, and the age prunes (the sweep's 48 hours,
the compactor's 12) count from it: the sweep runs in the migration's own
mutation, and an auto-filed row filed more than 48 hours earlier was deleted
there, checkpoint and all, before promotion could take it.

An overseer run counts only for the attempt it was queued for — its key
carries the attempt's run id; a legacy row without one needs a run that landed
after the attempt started (`overseerRunFor`) — because the
`verificationRun` stamp is never cleared. A done card is reopened by its own
attempt's failed run only if that result landed after the verdict it
contradicts, never over the user's manual Done (`doneRun`), with the line
`reopened — overseer check failed — …`. Session and overseer checks are
judged together (latest wins) but summarized apart, so the reason names who
ran the check (`verifyCompletion`). A task keeps the overseer's result on the
stamp only (`runVerificationJob`, which stamps task rows alone); its detail
view shows it as an "Overseer check" line (`renderDetail` in
renderer/tasks.js) in place of the old "verification run passed/failed" log
line. A task's
verification job carries its card's `projectPath` (`scheduleVerificationOnDone`)
and `runVerificationJob` runs it there; a job without one runs in the active
project root. A job whose commands use `npm` in a folder with no
`package.json` moves to the Studio checkout instead, and logs that it did;
those results checked Studio's tree, so they are stamped `relocated` and are
nobody's evidence: they neither verify the card nor reopen it.

The overseer's own rows are runner-issued (`runnerIssued`, set by
`verifyCompletion` for whatever arrives as `overseerChecks`), so they skip the
shape filter meant for a worker's shell history. The LÖVE harness pipes
love.exe and reads result.txt, a shape that filter rejects, and its result
used to be dropped. Verification commands run with the same
credential-stripped environment as every child (`runCheckCommand` passes an
args array, so platform.cjs's stripped options survive), and a command past
its 15-minute budget is killed with its whole process tree; a grace timer
settles it as timed out if a survivor keeps its pipes open. Reopening a done
card on a failed overseer run writes its own receipt.

Evidence is fetched only for cards the pass can actually judge. The prefetch
above runs outside the board lock, so it used to read `listChanges` and
`listSessionChecks` for **every** `awaiting_verification` card — including the
ones the mutator then skips because their overseer check is still in flight
(`overseerRunPending`) or because they are still waiting on handed-off children
(`waitingTaskIds`). Those reads are eyes-worker round trips into the OpenCode
store, they were discarded, and they repeated on every pass for as long as the
card waited. Both gates now run before the prefetch (its
`overseerRunPending` and `waitingOnHandoffs` skips), the handoff one against
the same `reconcileTaskHandoffs` result the mutator will compute (exact, not the one-pass-stale saved `handoffState`), and only
on boards that have outstanding obligations at all. In a monitored
handoff-heavy hour that took 2,464 store reads down to 22 with an identical
board outcome. The prefetch's rows are only a hint (the mutator re-derives
every decision under the lock), so they come from a plain board read, not a
no-op transaction (`viaGateway`). The opened-files set (`eyes.listReads`),
which only teaches path memory, is read after the settle and only for
attempts verified with edits. The board-wide stale-scope heal
(`healBoardFileScopes`) runs at most every 5 minutes
(`SCOPE_HEAL_INTERVAL_MS`), and a basename its walk could not find is not
walked for again for 30 minutes (`scopeMisses`).

The pass no longer waits for the next tick to look again (2026-09-21):

- `finish()` aims one coalesced settle at the moment the attempt's 30 s
  evidence dwell expires (`kickVerificationSettlement`, which always keeps the
  earliest requested moment), so a card is judged ~31 s after its run ends
  instead of up to `autopilot.minutes` later.
- Housekeeping re-arms itself for what it had to skip: a card still inside
  its dwell (`followUp.dwellMs`), or a card whose evidence store did not
  answer (`VERIFY_EVIDENCE_RETRY_MS`, bounded by `VERIFY_EVIDENCE_RETRY_MAX`
  per streak, then the foreman's cadence owns it). Some gaps never close — a
  check history past the store's 1000-row read, a session row gone from the
  store — so a card whose evidence is still unreadable two hours into its
  wait (`VERIFY_EVIDENCE_WAIT_MAX_MS`) is parked for the owner with the gap
  named, with no rerun.
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
live leases (`refreshLease`) and re-queues claims whose run died with the app
(`executorResume.recover`). It logs one `housekeeping:` line only when the
sweep did something (`swept`), and counts the queue depth from the
collections its mutation returned (`refreshAutopilotQueue(eyes, result)`).

## 7. Renderer surfaces

- `renderer/booklet.js`, the boot sequence (`window.MefiBoot.run`) — the
  `startAgents` choice releases the launch hold (`MefiStartup.begin` →
  `startup:begin` → `releaseStartupHold` in main.cjs) so the loop may
  dispatch (the **Start agents** switch). A launch that resumed an interrupted
  session (main.cjs `startupResume`) never holds in the first place, so the
  agents that were running come back with it. **When Studio opens**
  (`settings.ui.launchAgents`: resume, start or off; main.cjs
  `launchAgentsInfo`, read by `renderer/startup.js`) picks whether the launch
  switch starts on. With resume, a project whose last session record
  (`session.json`, read once at launch as `startupLastSession`) ended with
  agents running starts with the switch on.
- **The loop status** (`scripts/loop-status.cjs`, `autopilotLoop` in
  main.cjs) is the one answer to "are agents working, and why not". It is
  sent as `loop` on every `assistant:status` push and in the chat facts
  (`facts.executor.loop`), and passed to `summarizeBacklog`, which leads its
  summary with a loop hold. The first gate that applies wins: no project →
  launch hold with no AI connected (`setup`, still `launchHold: true`, so the
  views label Start agents) → launch hold → pause or stopped executor
  (`on: false`) → breaker cooldown →
  update drain → a foreman that timed out and still holds its slot → running →
  ready but waiting → approvals → cards needing review → no AI connected →
  idle. Board counts (ready, approval, blocked) are cached by
  `refreshAutopilotQueue` (`boardCounts`), and a changed count re-sends the
  status. Home `runState`, Vibe `runState`, Command `newWorkStatus` and its
  header, Agents `adoptQueue` and `MefiTasks.workflowSummary` read it first
  and keep their older derivations only for a host without it.
- `renderer/explorer.js`, `init()` — the proactive toggle (`#proactive-mode`,
  a service preference), and the subscriptions to checkpoint, briefing and
  request pushes (`onCheckpoints`, `onBriefing`, `onRequests`).
- `renderer/eyes.js`, `const state` — the change-feed view state (sessions,
  changes, todos, agent filter) over worker sessions.
- `renderer/boot.js`, `readMethods` — shared read-only IPC methods
  (`assistantStatus`, `tasksList`, …), and the visibility-gated poll guard
  under the `// ---- shared poll guard` marker (`pollStart`, `pollStop`).
- `autopilotStatus` in main.cjs, the `assistant:status` push (`emitAutopilot`).
  It carries only what a renderer reads (the capacity verdict, not the machine
  sample; no pids, project paths or queue depth), with every key on every
  push, because the Command view replaces its slot with each push and carries
  over only its own graph summary keys (`adoptAssistantStatus` and
  `GRAPH_SUMMARY_KEYS` in renderer/idle.js). A waiting reason is re-sent only
  when it changes, with measurements (MB, GB, ms, %) ignored so a drifting
  memory figure is not news (`setAutopilotWaiting`); a changed count such as
  "1 of 2" still is. Pause and stop clear it (`assistantPause`,
  `setAutopilot`); the Command header shows "paused" ahead of any waiting
  reason (`renderFeed` in renderer/idle.js).
- `renderer/workspace.js`, `scheduleBacklogRead` and `readBacklog` — a tasks,
  ideas or status push already carries its own data, so the workspace
  re-reads only the backlog snapshot; the 15 s backstop
  (`pollStart("workspace.refresh", …)`) and the visibility refresh still
  re-read every panel.

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

Retiring direct request execution (2026-09-23, §3) moved none of these
numbers: re-run on the task-only dispatcher, `steady` still costs 99 board
transactions, 179 store reads and 87 log lines, and `handoffs` still settles 8
of 56 cards in 36 runs and 278 transactions. The monitor's cards are tasks,
and its handed-off children were always promoted before they ran (a request
with a handoff lineage was never run as itself).

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
  attempt charged`. No issue is raised for it. A provider that refuses the
  login's plan (no active subscription, a model the plan leaves out, HTTP
  402) used to be charged as the card's own failure and retried on the same
  dead route in 1, 20, 40 and 80 minutes, so an OpenCode Go login without a
  subscription spent every card's retries; it now takes the same uncharged
  requeue and parks the route (§5, route refusal).
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
prefs (`assistant:prefs`), all on by default. `loopGuardApply: false` releases
the holds the keeper stamped and keeps counting, reporting "would hold N"
instead; `loopGuard: false` releases them and stops counting. Neither touches a
hold the owner asked for (`by: "owner"`, below), which only *Try again*
releases. `compactHistory`, also on by default, turns off the history
compaction described below; it has no switch in the app, but
`assistant:prefs` accepts it, as does `"compactHistory": false` in the
`assistant` block of the app's `settings.json`. A pref changes only once it is
saved: a failed save leaves the running keeper on the old value, the one the
switch flips back to.

**Owner controls.** The Explorer panel has three switches next to
*Proactive*: *Memory alignment*, *Loop guard* and *Hold looping cards*.
*Hold looping cards* is disabled while *Loop guard* is off, and the status
line under the switches is announced to screen readers (`role="status"`).
Each switch saves
its pref straight away, flips back if the save fails, and follows the saved
prefs whenever the assistant state arrives. In the Tasks view, a card the loop
guard holds shows its "Loop guard: …" reason and remedy, with a **Try again**
button. A card waiting on a duplicate shows "Waiting for <title> (the same
work)", with a **Run anyway** button. Both buttons use the ordinary retry path
(`backlogControl` retry, `backlog.retryTask`): Try again releases the hold and
restarts the count, and Run anyway drops the duplicate link. Neither button
shows while a worker or the verifier has the card.

**Duplicate families.** The keeper asks the owner once about each family of
open cards that look like the same work: "These N cards look like the same
work", with *Keep the oldest, wait the rest on it* (recommended) or *Keep them
all*. It asks at most 2 new questions a pass, and never while a member is
running, in review or in a group. Nothing changes until the owner answers;
then every member is stamped `familyDecision`. With keep-oldest, the other
members get `duplicateOf` and wait ("Waiting for X (the same work)"). When the
kept card completes, the keeper archives them as its completion, so a parent
waiting on one of them as a handoff child resolves too. A link to a card that
was deleted, or archived unfinished, is dropped and the card runs on its own.
*Run anyway* (or *Work on it*) removes the link. A split or handoff child of
another member is never asked about, since it is that card's extra scope, not
a copy, and cards from different parents are asked about apart. The card kept
is the oldest that can run; a family whose cards are all held or parked is not
asked about until one is retried. A typed reply leaves the ask open. A
`Work on "X"` card belongs to X's family, even when its title was clipped (the
full label is read from its prompt, once: a label that is itself a Work on
title unwrapping back into the card's own made the unwrap loop cycle forever
inside the keeper's board mutation). The overseer warns "cards looping" while
the loop guard holds cards, and notes "duplicate work waiting for a decision";
it repeats a standing hold on the owner's thread only when the count grows.

**Repeating work.** A chain of splits, `Work on "X"` cards and re-filed copies
is a new card each time, so no single card's ledger reaches its limit even
while the chain spends run after run re-verifying finished work. The keeper
therefore also reads a family's runs across all its cards, finished ones
included: when 3 of its last 4 verdicts changed no file, or only the TESTRUNS
notebook and its archive (`verification.ledgerOnly`, which the verifier
stamps when those are the only changed files), and one of its cards waits to
run, the owner is asked once: "This work keeps coming back" — *Hold it for my
review* (recommended) or *Let it run*. A hold stamps `loopGuard` with
`kind: "family"` and `by: "owner"` on the waiting cards, shown and released
like any loop hold (Try again), but never by the loop-guard switches. Either
answer stamps every member's `churnDecision` (the duplicate answer above is
`familyDecision`; the two shared that field once, and each erased the other),
and only runs after the answer count towards asking again. The ask is superseded once none of the cards it would hold is
still open.

Issue asks on finished cards: the keeper supersedes an open issue ask whose
card finished, since answering it could only re-arm finished work. Two kinds
stay: an ask that offers a split (the split files new work), and an owner-only
ask (`issueKind: "owner"`, something only the owner can do), which is usually
raised just as the card finishes.

**Owner asks.** A leftover only the owner can act on (flipping or archiving a
card on the live board, correcting a stored acceptance in Studio's task store,
landing another session's files) is the `owner` issue kind: "needs something
only you can do", answered *I'll take care of it* (recommended), *Answer it in
one line* or *Leave it for review*. It offers neither Split nor Try again, so
answering it makes no new card and re-arms nothing. A worker files one three
ways: a `MEFI_ASK: owner :: …` line; the `owner:` part of its `MEFI_RESULT`
line, which is raised as one owner ask instead of counting as remaining work;
or a scope, missing, conflict, capability or blocked ask that is really put to
the owner ("Will you …", "Should the owner …", "May Studio's stored
acceptance …", or one naming a lane only the owner may touch), which
`ownerDirected` in `scripts/agent-issues.cjs` files as `owner`. A permission
that names what it wants and a risk are never refiled. One run's asks are
raised one after another, and a run the owner or the host stopped raises none.
An answer that could not be applied keeps its reason, and its card reads
"— not applied: …".

**Splits carry the ask.** A split card's brief is the worker's ask and its
detail, and the split never re-runs the parent. The live brain map's triage
`splitDepth` caps the chain (default 3; 0 turns Split off). A card already at
the cap is not offered Split, and its card says why.

**Repeat asks.** With the map's `repeatAsks: "fold"` (the default), an ask
another card put to the owner within the last 24 hours opens no new card.
While that card is open the new ask waits on it ("already asked on another
card (q_…) · no new card"); once it is answered, the answer is written onto
the new card as a record ("already answered on another card (q_…)"), and a
folded split is not split again. Two asks are the same when they are the same
kind and either use exactly the same words, or name the same other cards and
share at least half of their content words (card ids and commit hashes left
out). Naming the same cards is not enough on its own: "task_205… duplicates
the parent gate card" and "both duplicate gate cards are already done" are
different questions. A grant or a risk is never folded, nor is a host-raised
run failure, and an answer that failed to apply is not carried over.
Owner-only leftovers also fold when neither title nor detail names a task,
both asks contain at least four content words, and their shared words cover
at least 40% of the longer ask. This comparison is symmetric; a short check
request does not disappear into an unrelated longer remedy. Clearing an ask
counts as leaving it for review when a later ask folds into it.

**Retried asks.** An issue on a task that has already failed twice or more
does not recommend a plain retry, which is the answer already given: it
recommends *Try again with a heavier model* where the kind offers it, else
*Answer it in one line*, and its retry option reads *Try again unchanged*
with the failure count. The heavier retry is offered only where it changes
the model (`heavierRetryOnOffer`: the builder's Heavy-tier model is another
model, or OpenCode on the Auto tier routes each task). Answered, it puts the
next attempt of that task, and only that one, on the builder's Heavy-tier
model (`executorCore.heavyRetryPending` reads the decision on the card;
`heavyRetryRoute` applies the model after routing), whatever the tier or
model selection. Only a worker's own detail is quoted as "The agent
says"; a host-raised issue's detail is Studio's account of the run.
`repeatAsks: "ask"` asks every one.

**The remaining-prose pattern is frozen.** The verifier's remaining-work
denial pattern (`handedElsewhereNote` in `scripts/assistant.mjs`) was widened
five times on 2026-09-22 for each new way a worker phrased an owner-only
leftover. The `owner:` lane gives those leftovers their own slot, so a new
phrasing belongs there, not in another alternative in that pattern.

**History compaction.** Every change to a card's brief, log, attempt or
verdict adds a revision to its `contextHistory`, and a finished card used to
keep all of them: they were 91% of the frozen 7.9 MB 2d Trippy Hell board.
Once a completed card (done, or archived as done) is past the tidy clock
(`tidyDoneAfterHours`), the keeper compacts its history in the same mutation,
oldest card first, at most 20 cards a pass, and only cards the pass did not
otherwise change. `taskContext.compactHistory` keeps the first entry, the last
entry, every restore, every entry whose restorable brief or `remaining`
differs from the entry kept before it, and the last entry of each attempt
(`lastAttempt.runId`). It drops the rest, which is log lines, claims and
verifier churn. Kept entries are never rewritten or renumbered, so the card's
`contextVersion`, every brief it can be restored to and each attempt's final
evidence stay. The history is stamped `compacted: { at, dropped }`. The keeper
marks those rows in `revisionKinds`, and the gateway records them with kind
`"compacted"`. `recordTaskRevision` then keeps the shorter history, with no
new revision, only when it drops entries and changes nothing else and the
card still matches its latest entry. Every other row is recorded the ordinary
way, which discards a shorter history. A details form left open at a dropped
revision fails safe when saved ("A task changed while these details were
open"). The tidy line reports the pass ("compacted the history of 20 finished
cards (826 KB saved)"), and housekeeping keeps `historyCompacted` and
`historyBytesSaved`; the bytes are measured the way the board file is written,
so they are what the file loses. Compaction tells a brief field cleared to
`null` from one left out, since restoring either gives back a different brief. On a copy of the Trippy board, two keeper passes took 38
cards from 1150 to 649 revisions and the file from 7.9 MB to 4.7 MB.

**Seeing it.** The keeper's tidy line in the activity log carries the pass's
summary ("held 1 looping card · aligned 5 memory notes · 3 stalled
reviews"). For the whole picture, run the read-only report:

```powershell
node tools/memory_audit.mjs
node tools/memory_audit.mjs --data "dist/Mefi Studio AI+/resources/app/data/projects/<projectId>"
```

It prints every card by state (done, doing, review, stopped, stalled,
looping, would-hold), where its memory disagrees with the board, duplicate
card families and duplicate lessons, and ends with what compaction could
still drop ("history: 38 completed cards could drop 501 revisions (2310
KB)"). It reads copies in memory and never writes to the data folder
(`--json` output goes under `tools/logs/` only).

## 11. The assistant as overseer

The assistant the owner talks to oversees the board instead of only filing
work for others. Its reply path is `assistantRespond` in `main.cjs`, built on
the pure `scripts/task-oversight.cjs`:

- **What it sees.** Every chat turn carries a board digest
  (`taskOversight.boardDigest`, added to the facts by `assistantBoardFacts`):
  each live task in one ranked, clipped list per group (running, review,
  needsYou, blocked, ready, cooling, recentDone) with its scheduler stage and
  reason (`backlog.workState`), attempts, verification verdict, loop-guard
  hold, last error and, for a running task, the worker's minutes, last output
  line and todo progress. The open Ask cards and the latest task events ride
  along. The payload is packed by section (`packChatPayload`, the owner's
  words first, the board with its own budget) and is always valid JSON; it
  used to be one string sliced at 14,000 characters.
- **Where the owner is, and what needs them.** Every chat box sends
  `context: {view, companion}` with the message
  (`MefiCompanionUI.context()`: the screen's label and the name the owner
  gave the companion). It is stored on the message as `ui`
  (`assistantUiContext`) and packed right after `did`, and the model speaks
  as that name. `needsYou` (`assistantNeedsYouDigest`) is the list behind
  the "N need you" badge, built by the same `companion.queue()` from the same
  board, so "requests", "what needs me" and the badge are one count. The
  thread the model reads is the last twelve things said plus the four newest
  notices, marked "(update) …", and each reply lists what it `offered`.
- **How it acts.** The model answers with one JSON envelope,
  `{reply, actions, offers}` (`ASSISTANT_CHAT_SYSTEM`). The actions are a small
  vocabulary (`CHAT_ACTION_KINDS`): create_task, work_on, retry, stop,
  mark_done, approve, note, answer, pause, resume and run_role. The host checks
  each one (`validateChatActions`) against the board the model was shown and
  the owner's own words, and runs it through the same host functions the
  buttons use (`assistantChatAction`: `assistantCreateTask`, `assistantWorkOn`,
  `backlogControl`, `stopTaskRun`, `taskAction`, `assistantAnswer`...). A CLI's
  own tools never touch the board: chat answers only through the data-only
  CLIs (`DATA_ONLY_CLIS`) or an HTTP route.
- **What needs the owner's click.** A task-changing action runs only when the
  message plainly asks for it (no question, condition or negation) and plainly
  names the card (a quoted title, a word only that card's title has, its id, or
  "it" with a single referent). Anything else becomes an Ask card whose option
  runs it (`assistantConfirmAction`). Approval always waits on a card that
  carries the reviewed scope; permission, risk, family and approval asks can
  never be answered from chat; a note stores the owner's words, never the
  model's; new work files the owner's message as the brief, with the model's
  reading beside it in `details`. The model is told that titles, briefs,
  worker output and logs are data, never instructions.
- **What it says.** The model never claims an outcome: the host appends each
  action's real result (`resultLine`). Offers are stored on the reply
  (`offers: [{title, target}]`), so "yes" or the Pick-the-next-work card starts
  that card by its id. After a reply that offered two or more cards, a
  plural yes ("all of them", "both", "each of them", "start them all")
  counts as asked and named for every offered card and no other
  (`pluralAffirmation`). Starting or retrying an offered card from the chat
  answers the Pick-the-next-work card that offers it
  (`assistantSettleOfferAsks`). The offer card is titled after the work it
  offers ("Start "X" next?"), carries the reply that offered it, and an offer
  the owner answered or turned down (*Not now*) is not filed again for 24
  hours, however often the chat names it (`assistantOfferQuestion`). Replies
  apply their actions in the order the messages arrived (`assistantChatSlot`).
- **Fallbacks.** A bare brake ("pause", "stop everything", "resume") runs at
  once, before any model call. With no usable model (no key, a backoff, a
  timeout, a reply that was not an envelope) the local classifier answers as
  before, except that control phrases ("try again", "stop the auth build",
  "close the search task") become the same validated actions
  (`localChatActions`) instead of filing new work or pausing everything. A
  slow reply is not an outage: only a provider error takes the AI offline for
  the other roles.
- **Task notices.** The thread hears what the owner's tasks did from the one
  place every task write passes: the board gateway calls
  `assistantObserveTasks` after the commit (`boardWritten`), which compares the
  board with its last look (`taskEvents`) and posts one notice per task,
  edited in place while the owner has said nothing since it ("Started…",
  "…finished its run; verifying", "Verified: …", "Retrying …", "… is parked:
  …", "… is on hold: …"). A start is announced only from the worker's real
  spawn (`assistantTaskStarted`); a claim can still be released. Owned tasks
  are chat and composer work, approved plans, Work on it and the focused card;
  the agents' own cards that only the owner can move are rolled into one
  "N cards need you" notice. Notices are `kind: "notice"`: they never count as
  the answer to the owner's last message and only a verdict or a hold counts
  as unread.
- **Stopping one task.** `stopTaskRun` (chat's stop, the Tasks view's Stop,
  `taskAction` action `stop`) stops that task's worker only, saves its
  progress and holds the card for the owner (`ownerHold`, a needsYou row) so
  the freed slot does not claim it again seconds later; Work on it or Try
  again releases it.
- **Automatic task context.** Every new card from the board gateway gathers
  local references in the background (`assistantGatherTaskReferences`), including
  promoted requests and composer work. Independent reads run together; the
  references are saved before an optional Scout seat (GPT-6 Luna, low effort,
  fast tier by default) selects one verified starting file. The Tasks automatic
  reference switch and Agents' Scout switch control
  this pass. A chat instruction asks the foreman to dispatch.
  It used to send twelve roles out, two of them paid improve/grow passes whose
  output nothing read.
- **The thinker.** Every minute with Proactive on, `assistantThinkerJob` reads a
  light slice of the board (`assistantThinkerFacts`: the executor, the backlog
  counts and the dispatcher's next picks, the overseer's findings, the tree
  the watcher last organised) and thinks in the assistant box (`thinkPlan`).
  It never announces a start it does not control: when the executor is idle
  and its top pick is a ready board task the dispatcher would not take first,
  it pins that card through its own form of Work on it (`assistantWorkOn`
  origin `"thinker"`) and says so; anything else it only names ("next up").
  Among its ready task picks it chooses in the dispatcher's order (the
  `next` rows carry pin, source and origin), never pins while the
  dispatcher's first pick is pinned or in the owner's band, and its pin gets
  a `pinAt` older than every pin on the board and in the inbox, so the
  owner's clicks always go first. Its pin is not the owner's pointing: it
  leaves the owner's focus and the node's notes alone, logs "put first by
  the thinker", only pins a card still ready, and stamps `thinkerPin` (its
  `pinAt`), which `assistantOwnsTask` does not count, so the card's notices
  stay in the agents' roll-up. It used to pick with suggestWork's order
  (which ignores pins) and pin through the owner's Work on it, jumping
  ahead of the card the owner had just pinned, moving the owner's focus and
  marking the card owned for good. Before that it rebuilt the chat's full
  facts and the tree every minute and said "starting work on X" while the
  foreman ran whatever ranked first.
- **The overseer's AI review.** The overseer runs every 15 minutes around the
  clock; its local review (`overseerReview`) runs every pass. The heavy AI
  review runs only when the owner asked (the Oversee button, chat's
  `run_role overseer`) or the digest's signature moved since the last AI
  review (`overseerSignature`: the local finding set, the open problem kinds,
  the roles in error and the score band; `overseerAiPlan` decides). The
  playbook records when the last AI review ran and why a pass skipped it
  (`overseer.ai`), and the roster line opens with which review ran. A builder
  failure wakes the overseer at most once per ten minutes
  (`assistantHearBuilder`). Its repair keeps the stale-session rescue, the
  manual re-enable and the problem-driven role wakes; lost claims are
  housekeeping's (§6) and interrupted journal work the tick's.

Tests: `tests/task_oversight.test.mjs` (the module),
`tests/assistant_overseer_chat.test.mjs` (the host path),
`tests/assistant_chat_admission.test.mjs` and
`tests/assistant_readiness_reply.test.mjs`; the role table, the thinker and
the overseer's gate in `tests/assistant_role_policy.test.mjs` and
`tests/assistant_coordination.test.mjs`.

## 12. Choosing a builder's model: the win-probability evaluator

When the coding tier is Auto and the builder is OpenCode on the z.ai route, or
on the OpenCode Go route with no builder model pinned, each dispatch asks the
router (`routeBuilderModel` → `applyModelRouting` →
`scripts/model-routing.mjs`) which model should build this card.
`executorRunEnv` marks those two routes with a `modelProvider` (`zai` with
`glm-5.3-flash`, or `opencode` with the Go default `deepseek-v4.1-flash`); a
pinned OpenCode model, the Free, Fast and Heavy tiers, and the Claude Code,
Codex, Grok and Antigravity CLIs carry none and never route. The Go route is
taken only when Go is both chosen and reachable. Chosen means the assistant
route is OpenCode, or Auto with OpenCode in its order; Claude Code, LM Studio,
a custom endpoint, Zen and the other CLIs never put builders on Go. Reachable
means OpenCode itself holds a Go login: `opencodeGoLogin` runs
`opencode auth list` (provider names only, never a secret, cached ten
minutes) and counts a saved credential, not the `OPENCODE_API_KEY` variable
Zen shares. When the CLI cannot answer, the applied first scan decides, and
no scan counts as no login. Otherwise the builder keeps the CLI default and
its `via` says `no OpenCode Go login confirmed`, because a `--model` naming a
provider OpenCode cannot reach fails every run and each failure is charged to
the card. A Studio OpenCode Go key alone is not enough: it pays for the
assistant and never reaches the CLI. The pick reaches the command line only
if it is one of the candidates the router was offered (or the default) and
reads as a bare model id, as `--model mefi-zai/<id>` on z.ai (Studio's
managed provider) or `--model opencode-go/<id>` on Go (the prefix
`opencode models` lists the Go roster under). The router works like a race
card:

1. **The record.** Every builder attempt is a row in the model ledger
   (`recordWorkerAttempt` at attempt-finish: provider, model, the kind of work
   and how long it ran), and the verifier's verdict settles it later
   (`settleModelOutcome` from the verification receipts): a verification the
   runner observed is a win, a failed one a loss, and a worker's own report is
   neither. `scripts/model-performance.cjs` keeps wins, losses and a win rate
   per model, overall and per kind of work. A z.ai run is filed under `zai`
   and a Go run under `opencode`, both by the bare roster id (a pinned
   `opencode-go/<id>` included), which is the row the router joins to that
   model's candidate. The row names the model that did the work: a CLI
   builder that fell back to OpenCode is filed under that OpenCode route
   (`entry.ranRoute`), not the CLI. A route with no model id is filed as
   `<provider>-default`; only the `via` label's leading `provider/model` token
   can name one, so notes such as `opencode default · z.ai key missing` never
   split a model's record. A run that fails before any verdict is a loss
   only when the failure was the model's own work
   (`executorCore.attemptLedgerOutcome`). A stop, a spawn error, a runner
   that never started or died silent in its first 15 s, a provider that said
   it was down or refused the login's plan (even after the card's outage grace
   ran out, which charges the card, not the model) and a model or provider the
   CLI could not reach
   (`ProviderModelNotFoundError`, `model not found`) keep their row but count
   as neither.
2. **The kind of work.** The key is the classified intent
   (`coding-implement`, `coding-explore`, `coding-analyze`,
   `coding-document`), or `coding` when unclassified; the complexity travels
   separately as the work weight. Routing asks with the same key the attempt
   is recorded under.
3. **The odds.** Each candidate gets a win probability
   (`estimateWinProbability`): a Beta posterior over its record on this kind of
   work (falling back to its overall record), with a weak prior from the
   catalog quality index. Its cost, 5-hour request headroom, speed and what it
   is good at (`useFor`, `avoidFor`, `verdict` from `data/models.json`) ride
   along as evidence. Two weaker sources may shift only the prior's mean,
   never the record, and only for the contract task kinds the work maps to
   (`model-community.cjs` `taskKindsFor`: `coding-implement` and `coding`
   read `coding`, `coding-document` reads `writing`, `coding-analyze` reads
   `review`; `coding-explore` reads nothing):
   - **Probes** (`probeShift`): Studio's own probe runs on that kind
     (Models › Community › Run probes, never automatic). The mean score over
     the latest runs (at most five per kind), mapped to -1..1, times 0.10,
     times the share of five scored runs behind it: one perfect run is
     +0.02, five are +0.10, a failed call counts for nothing.
   - **Community** (`communityShift`): the public feed's evidence, capped at
     +/-0.05 in total and averaged over the task's kinds. A specific
     release-note claim is +0.01 (at most +0.02), an observed strength or
     weakness that at least two members reported is +/-0.01 (+/-0.015 with
     evidence; at most +/-0.03), and a task rating with at least three
     evidence notes moves up to +/-0.02 by its distance from 3 of 5.
     Opinions and tips never reach a candidate.

   The shifted prior still counts as two pseudo-attempts, so after n settled
   outcomes the two together move the estimate by at most 0.30 / (n + 2),
   and with no judge an untried model still never outranks a proven one.
   The judge sees both blocks with their `source` labels
   (`studio-probe-measurements`, `community-reports-not-measurements`); when
   the state is over budget the community's words are dropped first, then
   the block, before any candidate. A builder's candidates are a shortlist of at most
   `MAX_WORKER_ROUTING_CANDIDATES` (6): the default first, then the models
   with the most settled outcomes on this kind of work, then catalog quality,
   then the lowest typical cost. The z.ai pair fits whole; the Go roster (16
   chat-completions models) is cut to six before the judge is asked.
4. **The pick.** With Jev or the stand-in judge, one call asks one
   yes-probability question per candidate and the highest probability wins
   (ties go to the default); a reply that breaks that contract falls back to a
   single choice question. The answer is cached per task for five minutes.
   With no judge at all, the candidate with the best record is routed once it
   has at least three settled outcomes (`LOCAL_MIN_OUTCOMES`) and beats the
   default by five points (`LOCAL_MIN_MARGIN`); a model with no settled
   record never outranks one that has it on its catalog prior alone.
   Otherwise the default runs, except for bounded exploration, since a
   challenger can only earn a record by being routed to:
   - It starts only when the default's own record on this kind of work (at
     least three settled outcomes) falls short of its catalog prior by five
     points. One win in three is what a 0.40 prior expects, so that alone is
     noise, not a case.
   - The turn goes to the cheapest challenger (`typicalCostUSD`, unknown
     last) whose estimate beats the default's by the margin, not to the
     highest prior, so a bad streak on the Go default tries `glm-5.3-flash`
     before the 33x `glm-5.3` or the 66x `kimi-k3`.
   - Each challenger gets at most three turns on this kind of work; a turn is
     any ledger row, settled or not. After that only its record counts.
   - The default keeps every other task beyond its first three, so its own
     record keeps moving and the route comes back to it when the gap closes.
     Several workers dispatched before the first attempt finishes can
     overshoot these bounds by the pool size, because a turn is counted when
     its attempt ends.

   The same rule serves both routes. The ledger cannot yet tell an
   infrastructure loss (a provider or model the CLI cannot reach) from a
   model's own failure: `finish()` files any failed run that was not a stop,
   an outage, a start kill or a spawn error as a loss.
5. **The receipt.** The decision (method, probabilities, the pick's win
   probability) is kept on the attempt's `attempt-start.route`, beside its
   `workKind` and `workShape`, so the Policy Lab can compare the evaluator's
   picks with the default's. Model Lab shows each model's wins, losses and win
   chance.

Chat and the assistant's own passes are routed per kind of call, not per
message, so a chat turn no longer pays its own routing call. Tests:
`tests/model_win_evaluator.test.mjs` (end to end on a scratch ledger),
`tests/model_routing.test.mjs`, `tests/model_routing_evidence.test.mjs`
(probe and community priors), `tests/model_performance.test.mjs` and
`tests/jev_model_routing_host.test.mjs`.

## 13. The Agent Brain

`scripts/agent-brain-host.cjs` (`createAgentBrain`, created once in main.cjs
as `agentBrain`) is called from one-line hooks, each guarded with
`typeof agentBrain !== "undefined"` so a vm-sliced host runs without it:

- **before the prompt** (`prepareRun`, in `spawnNextJob` above the tail): the
  task's pipeline is laid out or resumed (`pipelines.createPipeline`, from
  `playbook.pick` for the cached work shape), and the worker gets two things:
  the step, help and (for a delegated child) report protocol, which rides
  `executorCore.promptTail`'s `protocol`; and a brief (the pipeline, the last
  desk answers, `projectMap.briefLine`), which is `workerPrompt`'s capped
  `brain` section.
- **start** (`runStarted`, beside the ledger's `start` row): `agent.out` and
  the pipeline's `run-start`.
- **every output line** (`workerLine`, after `applyWorkerLine`): the first line
  is `spoke`; `MEFI_STEP: add|done :: <step>` grows or closes a step;
  `MEFI_HELP: <question> :: <detail>` goes to the desk (three per run);
  `MEFI_REPORT: <text>` is kept for the parent.
- **todos** (`todos`, in `watchJobProgress` when the list changes): the
  worker's own todo list grows and closes build steps.
- **finish** (`runFinished`, beside the ledger's `finish` row): `run-end`,
  `agent.home`, and for a delegated child that finished well a `report` event
  for its parent carrying its `MEFI_REPORT` or result line.
- **every board write** (`observeTasks`, from `boardWritten`): a status that
  moved is a `stage` event; `awaiting_verification` opens the verify step; a
  verdict settles the pipeline and files it in the Playbook (the archivist);
  a delegated child's change moves its parent's step, and a child that
  finished calls `assistantAskForWork("a delegated child reported")`.
- **agent mail** (`mail`, in `assistantSendMail`) and **verified files**
  (`filesTouched`, in housekeeping's path-memory loop, with the same read and
  changed sets `mergePaths` learns from) feed the event stream and the
  per-task file index behind the project map.

The project map (`projectMap.buildMap`) is rebuilt a few seconds after new
files land, from that index plus the project's git history
(`readProjectHistory`: `git log --since=90.days --no-merges --max-count=400
--name-only`, no shell, a 10 s limit, cached ten minutes, parsed by
`projectMap.parseGitLog`). With `cluster`, a folder of more than 24 files
(never an owner's area) splits by label propagation over the cosine of its
files' change histories; a commit touching more than 20 files counts for
warmth but never for co-change. Links carry `weight` (shared attempts or
commits) and `strength` (the cosine of the two systems' change histories); the
renderer draws the strongest three per system.

Replay: `node tools/replay-events.mjs --day YYYY-MM-DD --data <project data
folder>` prints a day's events and compares `agent.out`/`agent.home` with the
ledger's `start`/`finish` rows (exit 1 when they differ).

**The seats.** `seatFetch("lead" | "desk", …)` calls the seat's model on Zen
with its own reasoning effort (`SEAT_DEFAULTS`: GPT 6.1 Sol at medium;
`settings.agentSeats` overrides, from the Agent brain's Seats tab), through
`httpAssistantCall`'s `effort` and `pinned` options; without a Zen key it falls
back to the heavy route (or, for the Cluster planner, to its own route). The
Cluster planner is the lead seat.

**The desk.** Help is queued per project, folded per task and question for a
day, and answered on the desk seat (`desk.deskPrompt`/`parseDeskAnswer`) at
most 30 times an hour. An answer is written into the task's next brief; an
escalation (the model says only the owner can answer, or no model is set up)
is one `assistantRaiseIssue` of kind `blocked`, so it folds like any other
repeat ask. With `settings.agentBrain.deskTool` on, `prepareDeskTool` starts a
127.0.0.1 endpoint (`desk-server.cjs`, a random token per process) and writes
two per-run MCP config files into the OS temp folder: OpenCode reads one
through `OPENCODE_CONFIG`, Claude Code the other through `--mcp-config`
(`executorCore.cliInvocation`'s `desk`, quoted for `cmd.exe`, so a temp
folder under `C:\Users\John Smith` works). Codex, Grok and Antigravity runs
keep the `MEFI_HELP` line: Codex could carry the desk's token only on its
command line. The worker's `ask_desk` call
(`desk-mcp.mjs`) waits for `askDesk`, which shares the queue, the fold and the
per-run limit with `MEFI_HELP`. The files are removed when the run finishes.

**The desk handles asks.** Every assistant tick runs `assistantDecidePass`
under the global permission mode (`settings.agentBrain.deskResolves` remains
an Auto/Always ask compatibility alias): up to three open asks
(issue and family asks) and parked cards go to the desk seat
(`desk-resolve.cjs`), whose choice is applied through `assistantAnswer`
(`origin: "desk"`, not recorded as the owner's preference) and posted in the
thread as a notice. An answer given for the owner is never the owner's:
`assistantIssueAction` takes it as origin `"delegate"` (with `by`), logs
"Mefi decided", stamps `by` and the desk's reason on the task's
decision and on the question's answer, and re-arms with
`backlog.delegateRetry` instead of the owner's `retryTask`. That re-arm never
lifts the owner's stop (`ownerHold`), keeps the loop guard, loop ledger, the duplicate
link and the build approval, leaves a parked card two failures from parking
again, and pins nothing; family and repeating-work answers stamp `by` too, so
a hold placed for the owner is not the owner's own. Permission, risk and
owner-only asks follow their elevated switch; human leftovers can be
classified into For you to-dos. A question the desk itself
handed on stays with the owner (`context.raisedBy: "desk"`, which triage also never settles). A
card is settled at most twice a day, counted on the card (`assistantRetries`)
and in `assistantState.decideHistory`, so a restart does not reset either
budget. A card is left for the owner only when the desk's model answered
"leave it"; a model that did not answer gives the call back and the pass waits
five minutes. An answer that could not be applied (a worker holds the card,
its budget is spent) reopens the question for the owner. A card the owner
stopped is never settled or re-armed for them, and a card both stopped and
parked lists as held (`companion.taskNeed` checks holds first). The switch is
global (`readSettings`), not a team-profile field. The companion's **Clear list** closes this project's
listed asks as left for review and marks every listed item cleared at its own
time (`companion.markCleared`/`dropCleared`, kept in `companion.json`), so the
badge, the panel and the chat's needs-you digest agree and an item returns only
when it is new.

**The head's drafts.** With `settings.agentBrain.headDrafts` on, `prepareRun`
asks the head (the heavy role, data only: `DATA_ONLY_CLIS`) to draft a
pipeline (`pipelines.draftPrompt`/`parseDraft`) for a compound or systemic
task no Playbook recipe fits, in the background, at most ten an hour. The draft
replaces the template while the run has not moved past its first steps;
otherwise it is kept as `proposal` and becomes the layout the next time the
task is prepared.

**Nested delegation.** `taskDelegation.canPlan(ref, { nest, maxDepth })`: with
`settings.agentBrain.nestedDelegation` on, a delegated slice (never a hand-off
or a follow-up) below `EXECUTOR_MAX_DEPTH` may split its own part.

### Permission modes and learning — one assistant in chat

The chat and desk read the same bounded decision context. Mefi can explain
its last eight choices and queue Undo by decision identity, including when a
worker must finish before restoration. Mode switches apply again after the
chat's ordering wait. Named approvals in Accept per task, Auto and Elevated
carry the exact shown scope into `backlogControl`; Always ask raises a scoped
approval card. Non-elevated options can be named in chat, or an immediate
suggestion affirmed. Grant/risk and other enabled elevated asks remain cards.
One-line instructions need the owner's text after a colon or on the card.

Immediate Yes/No and Undo also have a local path, so an omitted model action
or unavailable model cannot strand a confirmation. Refused actions explain
why in the reply. Chat-started inbox rows promote through the existing locked
admission path, targeted by a hash of the saved request. A changed brief is
refused; agent-filed work keeps its normal dispatch approval gate. Companion
OpenRouter credentials and LM Studio seats count at both availability gates.

That gate is `autonomy.needsApproval`, passed to `backlog.workState` as
`approve`. Under Auto and Elevated only it holds work an agent filed while the
"Work agents propose" switch is on, and it counts the owner's own work as the
owner's (`autonomy.ownerWork`): a card they created, plus the actual splits and
delegated slices of it. The links are the same ones acceptance follows. Without
that, the executor's slices of an owner card would wait for an approval the
parent never needed, and the parent would wait on them in turn. Generic
handoffs and requests an agent filed still wait. The decide pass raises one
ask for a parked or loop-held card that has none. An ask about that card that
was settled or left for review after it parked covers that park, so a
dismissed card is not raised again until it parks again.

### Permission modes and learning — Vibe controls

`renderer/autonomy-ui.js` supplies the saved mode chip and settings to Vibe,
the companion, Agents Overview and the command palette. Settings include six
elevated switches, explicit warnings for grants and irreversible changes,
decision-learning enable/scope/Forget, and model-learning scope/off. Agents'
routing view shows model outcomes by task type; Vibe Team gives a short line.
Decided for you opens ledger reasons and Undo beside the For you list.

Vibe uses the host's Needs you queue, including one row per waiting intake
family. Suggestions highlight an option, offers and Yes/No appear in chat,
and one-line choices collect text before submission. Errors stay keyed to the
original item, late replies cannot replace another project's state, and unread
indicators use message IDs. Orb actions open this same drawer in Vibe and
retain the originating project. Dispatch success copy uses the host's state.

When an Elevated card exhausts its daily two-settle budget, a ledger-backed
`autonomyBudgetHold` prevents dispatch across restarts. Undo removes that hold
without refunding either retry. Studio-classified owner leftovers can reuse
an existing explicit family decision; dropping owner work still follows its
elevated switch. The policy is checked again after the pending ledger save.

## 14. Work done outside Studio

The owner also works on a project without Studio: commits by hand, another
editor, a Claude Code or OpenCode session in the same folder. Studio used to
reopen as if nothing had happened, so the assistant could not say what had
changed and the queue sent workers to build cards that were already finished
or made pointless. The pure rules are `scripts/outside-work.cjs`; the host is
the "work done outside Studio" block in `main.cjs` (`outsideWork*`).

- **The last look.** Per project, `data/projects/<id>/outside-work.json` keeps
  one `look`: the git HEAD, branch and uncommitted paths
  (`status --porcelain=v1 -z`) and when it was taken. It follows the folder
  while Studio watches it: every five minutes while the window is shown
  (`outsideWorkStartTimer`), 15 s after each run settles
  (`outsideWorkRefreshSoon`, called from `finish`), when the folder is left for
  another (`outsideWorkLeave`, from `adoptProject`, bounded to 3 s), and at
  quit (`outsideWorkQuit`: HEAD by a synchronous `rev-parse` and the time). So
  Studio's own workers' commits and edits are always inside the look. Every
  git call passes `--no-optional-locks`, so it never takes the index lock a
  worker needs, and withholds Studio's credentials.
- **The report.** `loadAssistant` (a launch or a switch) starts
  `outsideWorkScan("open")` in the background; the welcome-back digest
  (`companion:welcome`) starts one too, at most every two minutes and never
  while a worker is live or a settle's refresh is pending, since a worker's
  edits in progress would read as outside work. `outsideWork.report` compares
  the look with the folder now: commits from the look's HEAD
  (`base..HEAD`, `--no-merges`), or by date when that HEAD is no longer an
  ancestor (a rebase, reset or branch switch: `rewritten`); uncommitted paths
  edited after the look (by mtime, or newly uncommitted and unreadable, like a
  deletion); and agent sessions in the folder since then: OpenCode's store,
  minus sessions Studio's attempts recorded; Claude Code transcripts under
  `~/.claude/projects/<path with non-alphanumerics as dashes>`, titled by their
  first user line (`claudeTitle`; only the first 64 KB is read); and Codex
  rollouts under `~/.codex/sessions/YYYY/MM/DD` for the days since the look
  (at most a month), whose `session_meta` line names the working folder
  (`codexSession`, `withinFolder`; the first 256 KB is read, since that line
  carries the instructions). A first open with this build
  has no look; the assistant's last heartbeat (`closedAt`) stands in, so
  commits after it still count by date. A folder that is not a git checkout
  still reports outside sessions.
- **Where it goes.** A notice in the thread (`reportNotice`: the headline,
  the first commits and sessions); the chat payload's `outside` section
  (`chatFacts`, packed after `events` with a 2,600-character budget, and named
  in `ASSISTANT_CHAT_SYSTEM`) while the report is under a day old or one of its
  cards still waits for the owner; the companion's welcome-back digest
  (`digestPart`, greeted once per report); and, with no model to answer, the
  keyless reply to "what changed while I was away?" (`asksAboutAway`,
  `awayAnswer`, placed ahead of `localReply`'s text in `assistantRespond`).
- **Every queued card is checked** when the report changed code
  (`changesCode`: commits, edits, a moved checkout; an outside session that
  left nothing behind is news but holds nothing). The scan stamps each queued card
  (`candidates`: open, not grouped, not already checked against this report)
  with `relevance: { state: "checking" }` (`checkingStamp`).
  `backlog.workState` reads it as `deferred` / `blockedBy: "relevance-check"`,
  so the dispatcher skips it (`idleStopReason` "checking"), for at most six
  hours (`CHECK_HOLD_MS`) in case no check ever runs. The check
  (`outsideWorkCheck`) waits for the owner: after the launch screen's choice or
  with the agents running (`outsideWorkMayCheck`), kicked by the scan,
  `startup:choose` and the foreman (`outsideWorkPending`). It is one model call
  over up to 24 cards (`relevancePrompt`: the report and each card's title,
  brief and files, all as data), with a 60 s budget, whose reply
  `parseVerdicts` checks against the offered ids, the four verdicts and the
  report's commits. Without a usable model, or for cards past the first 24,
  `localVerdict` judges from `evidence`: files the card names that changed, and
  commit or session subjects that share at least two of its title's words.
- **Verdicts.** `needed` and `partial` clear the hold (`verdictStamp` state
  `clear`); a partial card's worker, and any card the outside work touched,
  reads `briefLine` in its prompt (`workerPrompt`'s `outside` section): what
  changed, "build only what is still missing", and if everything is already
  there, change nothing, run the checks and report done. `done` and `obsolete`
  keep the card held (`state: "ask"`, `blockedBy: "relevance"`, needsYou) and
  raise an Ask card (`question`, source `relevance`) with **Mark it done**,
  **Drop it**, **Build it anyway** and **Leave it for review**. A local match
  says "may already be done", never "looks already done", on its Ask card, its
  hold reason, the task's Evidence tab and the thread's one line for the whole
  check (`verdictNotice`).
- **Only the owner answers.** `outsideWorkDecide` handles the Ask card's
  options (owner only; `autonomy.canDelegate` refuses source `relevance` in
  every mode, `delegateRetry` refuses the hold, and the decide pass skips the
  card). Try again (`retryTask`) and Work on it (`assistantWorkOn`) also lift
  the hold, keeping the evidence for the worker; an ask whose card no longer
  waits on it is retired (`assistantRetireGoneAsks`). `decision-ledger` keeps
  `relevance` among its restorable fields.
- **What it cannot tell apart.** Git records no marker for Studio's own
  commits, so attribution is by time: whatever lands while Studio watches the
  folder (window shown, or before a settle's refresh) is folded into the look
  as Studio's. Work the owner does in another window while Studio is shown, or
  commits during the 15 s after a run settles, are therefore not reported. A
  crash skips the quit write, so a worker's last few minutes before it can
  read as outside work on the next launch (the check then mostly finds its
  cards still needed).

Tests: `tests/outside_work.test.mjs` (the module, and how backlog, companion,
executor-core and autonomy read its stamps) and
`tests/outside_work_host.test.mjs` (the host block sliced into a vm against a
real temporary git repository and a fake home).
