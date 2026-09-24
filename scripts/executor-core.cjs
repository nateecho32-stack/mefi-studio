// Executor core: the decisions spawnNextJob used to make inline, as functions
// of their inputs. Which ready card runs next and why nothing does, the
// worker's prompt, how a run ended, what settling it writes on the card, the
// wedged-start budget, the command line per builder CLI, and what one line of
// worker output says. spawnNextJob in main.cjs keeps the orchestration: the
// gates, the one transactional claim, the advisory, the spawn, the watchdog
// timers and the checkpoint writes. See docs/agent-loop.md §3-5.
//
// Pure module: no Electron, no filesystem, no network, no processes, no
// timers, no clock reads (time is injected). The host's own helpers that read
// its state (the worth ranking, the live-fix check, the title key, the
// assistant module's parsers) and its limits are passed in, so a host sliced
// into a vm test keeps deciding with its own stubs and constants.

"use strict";

const backlog = require("./backlog.cjs");
const executorResume = require("./executor-resume.cjs");
const agentModes = require("./agent-modes.cjs");
const agentIssues = require("./agent-issues.cjs");
const taskHandoffs = require("./task-handoffs.cjs");

const MINUTE_MS = 60 * 1000;
// A card is parked for a manual reopen at its fifth charged failure.
const MAX_RUN_FAILURES = 5;
// A provider streak this long is charged after all: 5m doubling to 2h is
// 6.6h of outages, past a 5-hour usage window.
const PROVIDER_GRACE = 7;
// A run that died this soon without a single line never really started.
const SILENT_DEATH_MS = 15 * 1000;
// Terminal colour and cursor codes, stripped from everything a person reads.
const COLOUR = /\u001b\[[0-?]*[ -\/]*[@-~]/g;
const flat = (text, max) => String(text ?? "").replace(/["\r\n]+/g, " ").slice(0, max);

// ---- selection ---------------------------------------------------------------

// The queued statuses are the ones backlog.workState calls runnable: "open",
// and the legacy "pending", "queued" or no status at all. Requiring "open"
// alone showed such a card as Ready and never dispatched it; the claim writes
// "active", and every release writes "open" back.
function isQueued(task) {
  return !task.status || task.status === "open" || task.status === "pending" || task.status === "queued";
}

// The cards a dispatch may pick, best first. `open` is every queued card no
// live run holds (by id, by title key, or as a second Fix on a subsystem a
// live Fix is already on), oldest first; `ranked` is the part of it that is
// ready now. Failure isolation lives here: a card on its failure backoff, or
// past five tries, is skipped, not parked, so the rest of the board keeps
// running; so is a card this fill already released for a failure of its own
// (`released`). The owner's explicit Start (`taskStart`) runs only its own
// card, and only with the brief it was started with; a focused Cluster runs
// only its focus. Resumable work goes first (executorResume.compare), then
// the host's worth order (`compare`: pin, band, age).
function selectCandidates({ tasks, now, liveTaskIds, liveKeys, titleKey, conflicts, released = null, autoBuild, taskStart = null, cluster = null, compare }) {
  const open = tasks
    .filter((task) => task && isQueued(task) && !liveTaskIds.has(task.id) && !liveKeys.has(titleKey(task.title)) && !conflicts(task))
    .sort((a, b) => (a.createdAt ?? a.updatedAt ?? 0) - (b.createdAt ?? b.updatedAt ?? 0));
  const runnable = open.filter((task) => (task.runFailures ?? 0) < MAX_RUN_FAILURES && backlog.workState(task, now, { tasks, autoBuild }).stage === "ready" && !(task.nextRunAt && task.nextRunAt > now) && !released?.has(task.id));
  // Pick by what the job is FOR, not just who filed it: the worth order puts
  // the overseer's own upkeep last, where it once took 20 of 34 slots.
  const ranked = runnable
    .map((ref) => ({ kind: "task", ref }))
    .filter((candidate) => (!taskStart || candidate.ref.id === taskStart.taskId && backlog.buildScope(candidate.ref) === taskStart.scope)
      && (!cluster || agentModes.matchesFocus(candidate, cluster))).sort((a, b) => executorResume.compare(a.ref, b.ref) || compare(a.ref, b.ref));
  return { open, ranked };
}

// Why nothing started when no card was ranked: a focused Cluster waits on its
// own work, otherwise the reason the waiting cards give (the named card's
// alone for an explicit Start), in this order.
function idleStopReason({ open, tasks, now, autoBuild, taskStart = null, cluster = null }) {
  if (cluster?.focus) return "cluster";
  const states = (taskStart ? tasks.filter((task) => task?.id === taskStart.taskId) : open).map((item) => backlog.workState(item, now, { tasks, autoBuild }));
  if (states.some((item) => item.stage === "approval")) return "approval";
  if (states.some((item) => item.stage === "cooling")) return "cooldown";
  if (states.some((item) => item.blockedBy === "dependencies")) return "prerequisites";
  if (states.some((item) => item.stage === "blocked")) return "review";
  return "empty";
}

// ---- the worker's prompt -------------------------------------------------------

// The fixed end of every worker prompt: the run's identity, so the worker (and
// any structured result it prints) names the attempt it belongs to; the
// hand-off and call protocol, or at the depth limit the order to stop handing
// off; the owner-question line, so a decision the run cannot make reaches the
// owner while it keeps working; the budget warning; the optional MEFI_RESULT
// line, whose owner: part is the lane for what only the owner can do (it is
// neither work this task owes, remaining:, nor a hand-off, MEFI_NEXT); and the
// verdict sentinel. `opencode run` exits 1 even on a clean run, so the
// sentinel, not the exit code, is the success signal.
function promptTail({ runId, taskId, depth = 0, maxDepth, maxHandoffs, nextMark, callMark, budgetMinutes, doneMark, protocol = "" }) {
  const handoff =
    depth < maxDepth
      ? ` If you find follow-up work you did not do, hand it on: print ${nextMark} <short title> :: <what the next agent should do> (at most ${maxHandoffs} of them), and print ${callMark} <auditor|reference|ideas|improver> to wake that agent on it.`
      : " Do not hand off any further work; this chain has run long enough.";
  const budget =
    depth < maxDepth
      ? ` You have about ${budgetMinutes} minutes. If the whole job will not fit, finish the most valuable piece, hand the rest on, and still print the line below — a run that is cut off reports nothing and counts as a failure.`
      : ` You have about ${budgetMinutes} minutes. If the whole job will not fit, finish the most valuable piece and still print the line below.`;
  const identity = ` This dispatch is run ${runId} for task ${taskId}.`;
  const askLine = ` ${agentIssues.issuePromptLine()}`;
  // The Agent Brain's step, help and report lines (agent-brain-host.cjs); they
  // ride the tail because a truncated protocol line is worse than none.
  const brainLine = protocol ? ` ${String(protocol).replace(/["\r\n]+/g, " ").trim().slice(0, 700)}` : "";
  const tail = `${identity}${brainLine} Keep verification and board bookkeeping in the current task. Never create a child task merely to close, update, verify or confirm another card. Report evidence and actual remaining implementation scope on this attempt instead; hand off only substantive unfinished work.${handoff}${askLine}${budget} Optionally print one line "MEFI_RESULT: done: <what you finished>; remaining: <what this task still owes, or none>; owner: <what only the owner can do, or leave it out>" naming your own account of the work (one line, under 300 characters). Anything only the owner can do (board changes, Studio's task store, another session's files) goes under owner:, never under remaining: or MEFI_NEXT. Print the exact line ${doneMark} as the last thing you say.`;
  return tail;
}

// What every builder is told about the folder, previews and the shared git
// index. A selected project may be a brand-new folder, so the Git guidance
// must not invent a commit obligation or an owner blocker for that case.
const INSTRUCTIONS = " Work in the project folder at the current directory. Make the edits, do not just describe them. When done, run the narrowest relevant test. For browser apps, leave a root index.html or a working package preview/dev/start script for Studio Preview. Save and test the app, then finish the builder task; Studio owns the preview server separately. Do not launch a long-running foreground or background preview server from a builder tool, or wait on one to report completion. Determine whether the project is a Git working tree before applying Git instructions. In a Git working tree, other Studio sessions share its index: commit with one atomic path-limited command (`git commit -m <msg> -- <your files>`), never `git add` followed by a plain `git commit`, `git commit -a`, or `git add -A`, and leave nothing staged when you finish — a bare commit sweeps whatever another session staged into your commit. Preserve any commit requirement in the task or project instructions. If no Git working tree exists and neither the task nor project instructions require a commit, finish and verify normally: do not initialize Git or create follow-up work just to satisfy this generic guidance. Missing Git alone is then informational: mention it only in the ordinary result summary, never in MEFI_ASK, remaining: or owner:. If a commit is explicitly required, retain that obligation and report any actual blocker.".replace(/["\r\n]+/g, " ");

// The whole prompt, budgeted piecewise against `promptMax`. The tail carries
// the verdict sentinel, so it is budgeted first: slicing the whole string
// dropped the sentinel off any job with a long prompt (a folded plan listing
// eight ideas runs past 1000 characters on its own), and those jobs were then
// filed as failures however well they went. The instructions are fixed, the
// memory, path, collaboration and advisory sections are capped decorations,
// and the task's own text (for a folded plan, the obligation list itself)
// gets whatever is left, trimmed LAST: the old single slice kept the
// decorations and cut the later obligations, so a run could declare success
// on a job it had only partly read. `brief(maxChars)` renders the saved
// record (taskContext.buildTaskHandoff); it is the caller's, so a malformed
// record throws out of here and the caller releases the claim. Returns the
// prompt and the brief it carries (`jobPrompt`, which the caller keeps as the
// job's prompt).
function workerPrompt({ title, taskId, tasksFile, ref, resumeCheckpoint = null, sections = {}, clusterBrief = "", tail, promptMax, brief, contextPath = null }) {
  const titleBit = `${title}. `.replace(/["\r\n]+/g, " ");
  const failFlat = flat(sections.fail, 240);
  const memoryFlat = flat(sections.memory, 480);
  const collabFlat = flat(sections.collab, 960);
  const pathsFlat = flat(sections.paths, 240);
  const brainFlat = flat(sections.brain, 700);
  const clusterFlat = clusterBrief ? ` ${clusterBrief.replace(/[\r\n]+/g, " ").slice(0, 2400)} ` : "";
  const resumeBrief = executorResume.brief({ ...ref, runProgress: resumeCheckpoint });
  const resumeFlat = resumeBrief ? ` ${resumeBrief}\n\n` : "";
  const tailFlat = tail.replace(/["\r\n]+/g, " ");
  const promptBudget = Math.max(
    240,
    promptMax - tailFlat.length - INSTRUCTIONS.length - titleBit.length - failFlat.length - memoryFlat.length - pathsFlat.length - brainFlat.length - collabFlat.length - clusterFlat.length - resumeFlat.length - 8,
  );
  // The durable brief carries prior findings and successful prerequisite
  // outputs into the next worker instead of restarting from a short title.
  // A run context file (contextPath) is named in the brief's own header; only
  // without one is the worker sent to the whole board file.
  const recovery = contextPath ? "" : `Full saved task context: read ${JSON.stringify(tasksFile)}, find task id ${JSON.stringify(taskId)}. Read that record and its members whenever the brief is excerpted or grouped; contextHistory contains earlier requirements and attempts. Do not rewrite Studio's task store from the worker.\n\n`;
  const jobPrompt = recovery + brief(Math.max(1000, promptBudget - recovery.length));
  const body = String(jobPrompt ?? "").slice(0, promptBudget);
  const head = `${titleBit}${resumeFlat}${body}${failFlat}${memoryFlat}${pathsFlat}${brainFlat}${collabFlat}${clusterFlat}${INSTRUCTIONS}`;
  return { prompt: `${head}${tailFlat}`, jobPrompt, budget: promptBudget };
}

// ---- how a run ended -------------------------------------------------------------

// Charged failures back off 1m, then 20m, 40m and 80m; the fifth parks the
// card with no retry until a manual reopen resets it. The 2h cap in the
// formula is never reached.
function failureBackoffMs(runFailures) {
  return runFailures <= 1 ? 60 * 1000 : Math.min(2 * 3600 * 1000, (2 ** runFailures) * 5 * 60000);
}
// A runner that never started: 1m, 2m, 4m… capped at half an hour.
function startKillCooldownMs(startFailures) {
  return Math.min(30 * 60000, 60000 * 2 ** (startFailures - 1));
}
// A provider outage: 5m, doubling to 2h while it lasts.
function providerCooldownMs(streak) {
  return Math.min(2 * 3600 * 1000, 5 * 60000 * 2 ** (Math.max(1, streak) - 1));
}

// A run that ended on a usage limit, a rate limit or a connection that never
// opened (`said`, the assistant module's reading of this run's error and last
// words) is requeued uncharged, so a long outage cannot spend every card's
// five tries. The grace is bounded, so a genuine failure misread as an outage
// still reaches the five-try park and triage: the try is charged once a run
// that started on this route after the card's last outage has finished
// (`upAt` > `lastAttemptAt`), or once the card has sat out seven outages in a
// row.
function providerOutage({ said, streak = 0, upAt = 0, lastAttemptAt = 0 }) {
  const providerUp = streak >= PROVIDER_GRACE || (streak > 0 && upAt > lastAttemptAt);
  return said && !providerUp;
}

// How a run ended, as settle and the breaker read it. Each output reads only
// some of the inputs, so a caller passes what it knows at its moment:
// - `branch`, the card's settle branch: "ok" (it reported success), "stopped"
//   (the owner or the host stopped it), "start-kill" (the start watchdog killed
//   a runner that never spoke, on a card with start grace left: `startKilled`,
//   `startFailures` from the fresh row, `startGrace`), "outage" or "failed".
// - `infra`, an infrastructure failure for the executor's breaker: a spawn
//   error, a start kill, or a run that died inside 15 s without a line
//   (`ageMs`). A run that talked is never one, however it exited, and the end
//   is read from the kind its ender recorded (`endKind`), never from the error
//   text: a 25-minute budget kill or a supervised stop carries a message too.
// - `ownFailure`, a loss in the model evaluator's record: the run failed on
//   its own, not by a stop, an outage, a runner that never started or a spawn
//   error.
function classifyRunEnd({ ok, userStop = false, startKilled = false, startFailures = 0, startGrace = 5, providerOutage = false, endKind = null, spoke = false, ageMs = Infinity }) {
  const branch = ok ? "ok" : userStop ? "stopped" : startKilled && startFailures < startGrace ? "start-kill" : providerOutage ? "outage" : "failed";
  const infra = !userStop && (endKind === "spawn" || endKind === "start" || (!ok && !spoke && ageMs < SILENT_DEATH_MS));
  const ownFailure = !ok && !userStop && !startKilled && !providerOutage && endKind !== "spawn";
  return { branch, infra, ownFailure };
}

// A provider or model id the CLI could not reach (OpenCode's
// ProviderModelNotFoundError, "model not found", an API's model_not_found):
// the route was wrong, not the model's work.
const MODEL_UNREACHABLE = /\b(?:Provider(?:Model)?NotFoundError|model[_ ]not[_ ]found|unknown model|no such model|not_found_error\b[^\n]{0,80}\bmodel)\b/i;

// The model evaluator's reading of how an attempt ended, before any verdict:
// "failed" (a loss) only for a run that failed on its own (classifyRunEnd's
// ownFailure) through the model's own doing. Not a run that died silent in its
// first 15 s (infra), not one whose provider said it was down (`providerSaid`,
// even after the card's outage grace ran out: that charges the card, not the
// model), and not a model the CLI could not reach. Everything else is null
// and waits for the verifier (settleModelOutcome).
function attemptLedgerOutcome(end, { providerSaid = false, errorMessage = null, lastWords = null } = {}) {
  const { ownFailure, infra } = classifyRunEnd(end);
  if (!ownFailure || infra || providerSaid) return null;
  return [errorMessage, lastWords].some((line) => line != null && MODEL_UNREACHABLE.test(String(line))) ? null : "failed";
}

// The card one finished attempt leaves behind: its settle state machine. The
// caller has already fenced ownership (the row still names this run) inside
// its board transaction and writes the returned row back there; `task` itself
// is not changed. `run` is the attempt's live state (the entry: sawDone,
// handoffs, declinedHandoffs, resultNote, ownerHold, resumeRequested,
// startKilled), `attempt` its evidence record, `scopeHeal` the card's
// re-anchored file scope, and `queuedJob` the overseer verification the
// caller queued for a done report. `clip` is the host's title clipper.
function settleAttemptRow(task, outcome, { now, maxHandoffs, startGrace, clip }) {
  const { ok, userStop = false, providerOutage: outage = false, providerSaid = false, code, errorMessage = null, lastWords = null, attempt, run, scopeHeal = null, queuedJob = null } = outcome;
  const row = { ...task };
  row.updatedAt = now;
  if (!userStop) row.lastAttempt = attempt;
  delete row.runProgress;
  delete row.claimFailures; // a worker launched: the pre-launch streak is over
  // The card's saved files/file must name files that exist. Unresolvable
  // entries stay as saved (and visible in the log): nothing is dropped silently.
  if (scopeHeal?.changed) {
    row.files = scopeHeal.files;
    if (scopeHeal.file) row.file = scopeHeal.file;
    executorResume.appendLog(row, `file scope healed — ${scopeHeal.healed.map((heal) => `${heal.from.split(/[\\/]/).pop()} re-anchored to ${heal.to}`).join("; ")}`, { at: now });
  }
  // A pin is a one-shot: the run it asked for has now happened, so the next
  // pick goes back to the ordinary worth order.
  delete row.pin;
  delete row.pinAt;
  const { branch } = classifyRunEnd({ ok, userStop, startKilled: run.startKilled === true, startFailures: Number(row.startFailures) || 0, startGrace, providerOutage: outage });
  const release = () => {
    row.status = "open";
    delete row.runId;
    delete row.lease;
    delete row.doneAt;
  };
  if (branch === "ok") {
    // Not "done": the run SAID it finished. The card waits for the evidence-
    // checked verification pass, which alone marks it done. The verification
    // budget is kept across attempts until success or a manual retry.
    row.status = "awaiting_verification";
    delete row.lastRunError;
    delete row.runFailures;
    delete row.startFailures; // the runner did start this time
    delete row.providerFailures; // and the provider answered it
    delete row.nextRunAt;
    delete row.verification;
    // Follow-ups this run handed on are remaining obligations, kept visible on
    // the card and queued as requests right after (runExecutorHandoffs); a card
    // with outstanding obligations is never marked verified.
    if (run.handoffs.length) row.remaining = run.handoffs.slice(0, maxHandoffs).map((item) => item.title);
    else delete row.remaining;
    // Hand-offs a run at the depth limit printed anyway are named here and
    // nowhere else: they block nothing, and a person can still file one.
    const declined = Array.isArray(run.declinedHandoffs) && run.declinedHandoffs.length
      ? ` · ${run.declinedHandoffs.length} hand-off(s) declined at the depth limit, not queued: ${run.declinedHandoffs.map((title) => `"${clip(title, 50)}"`).join(", ")}`
      : "";
    if (queuedJob) row.verificationRun = { key: queuedJob.key, commands: queuedJob.commands, state: "queued", at: now };
    executorResume.appendLog(row, `run finished (${attempt.sawDone ? "sentinel seen" : "exit 0"}) — awaiting verification${queuedJob ? ` · verifying: ${queuedJob.commands.join(" && ")}` : ""}${Array.isArray(row.remaining) ? ` · ${row.remaining.length} follow-up(s) handed on` : ""}${declined}`, { at: now });
    // The worker's own account, kept out of the bookkeeping line so the Done
    // digest shows what was actually done.
    if (run.resultNote?.raw) {
      executorResume.appendLog(row, String(run.resultNote.raw).slice(0, 300), { at: now, kind: "result" });
    }
  } else if (branch === "stopped") {
    // Stopped on purpose: back to the queue with its saved progress, charged
    // nothing; the next dispatch continues from the checkpoint.
    const progress = executorResume.checkpoint(run, now);
    progress.pending = true;
    progress.interruptedAt = now;
    release();
    row.runProgress = progress;
    row.interruptedAttempt = progress;
    // A task its owner stopped (stopTaskRun) waits for them instead of being
    // claimed again by the slot it freed; asking for it again before the
    // worker exited (Work on it) cancels the hold and puts it first. Written
    // with the stop's own settlement, so a stop that never landed holds nothing.
    if (run.resumeRequested) {
      delete row.ownerHold;
      row.pin = true;
      row.pinAt = now;
    } else if (run.ownerHold) {
      row.ownerHold = run.ownerHold;
      delete row.pin;
      delete row.pinAt;
    }
    executorResume.appendLog(row, `stopped on request (${run.sawDone ? "run had reported done" : "unfinished"}) — progress saved; ${run.ownerHold && !run.resumeRequested ? "held for you" : "ready to resume"}`, { at: now });
  } else if (branch === "start-kill") {
    // No session, no output, killed by the start watchdog: the runner failed,
    // not the brief, so no attempt is charged. Start kills are counted apart,
    // so a card that keeps wedging its runner still runs out of grace.
    release();
    row.startFailures = (row.startFailures ?? 0) + 1;
    const startCooldown = startKillCooldownMs(row.startFailures);
    row.nextRunAt = now + startCooldown;
    row.lastRunError = String(errorMessage ?? "the worker never started").slice(0, 160);
    executorResume.appendLog(row, `worker never started — ${row.lastRunError} · requeued in ${Math.round(startCooldown / 60000)}m, no attempt charged (start ${row.startFailures}/${startGrace})`, { at: now });
  } else if (branch === "outage") {
    // The provider was down, not the card: the outage backoff, uncharged.
    release();
    row.providerFailures = (Number(row.providerFailures) || 0) + 1;
    // The runner did start (it spoke or bound a session): the run of
    // consecutive start kills is over, as the ok branch already says.
    if (!run.startKilled && (run.spoke || run.sessionId)) delete row.startFailures;
    const cooldown = providerCooldownMs(row.providerFailures);
    row.nextRunAt = now + cooldown;
    row.lastRunError = String(lastWords || errorMessage || `exit ${code ?? "?"}`).slice(0, 160);
    executorResume.appendLog(row, `provider unavailable (exit ${code ?? "?"}) · ${row.lastRunError} · requeued in ${Math.round(cooldown / 60000)}m, no attempt charged`, { at: now });
  } else {
    // Failure isolation: the card cools down on its own backoff while the
    // pool keeps running, and the fifth failure parks it (no nextRunAt).
    release();
    // A provider error charged past its grace keeps the streak, so the next
    // one is charged too; any other failure ends it.
    if (providerSaid) row.providerFailures = (Number(row.providerFailures) || 0) + 1;
    else delete row.providerFailures;
    if (!run.startKilled && (run.spoke || run.sessionId)) delete row.startFailures;
    row.runFailures = (row.runFailures ?? 0) + 1;
    // The first miss retries in a minute with the error in the prompt, so the
    // next agent works on resolving it; later misses back off.
    if (row.runFailures < MAX_RUN_FAILURES) row.nextRunAt = now + failureBackoffMs(row.runFailures);
    else delete row.nextRunAt;
    const failTail = run.startKilled ? errorMessage : lastWords;
    row.lastRunError = failTail ? String(failTail).slice(0, 160) : `exit ${code ?? "?"}`;
    executorResume.appendLog(row, `autopilot run failed (exit ${code ?? "?"})${row.lastRunError && row.lastRunError !== `exit ${code ?? "?"}` ? ` · ${row.lastRunError}` : ""} · ${row.runFailures < MAX_RUN_FAILURES ? `retry ${row.runFailures}/5` : "gave up after 5 tries"}`, { at: now });
  }
  return row;
}

// The inbox copy of work a card just reported done (same title key) is done
// with. A row an older build's live run still holds (runId) is its owner's to
// settle. Returns the rows to keep, a new array whenever the title has a key.
function releaseInboxCopies(requests, title, titleKey) {
  const key = titleKey(title);
  if (!key) return requests;
  return requests.filter((item) => {
    if (!item || item.runId) return true;
    const itemKey = titleKey(item.title) || titleKey(item.prompt);
    return !itemKey || itemKey !== key;
  });
}

// ---- the attempt's records ---------------------------------------------------------

// What a worker actually said: the sentinel and the MEFI_RESULT line are
// recorded as sawDone/result, so neither stands in for its last words.
function saidLine(line, doneMark) {
  return !String(line).startsWith(doneMark) && !String(line).startsWith("MEFI_RESULT:");
}
function lastWords(outputTail, doneMark) {
  return (outputTail ?? []).filter((line) => saidLine(line, doneMark)).at(-1) ?? null;
}

// The Policy Lab's attempt-start record: handoff lineage, the claim, the
// route and the acceptance baseline the attempt will be judged against. The
// prompt is hashed by the caller (`promptSha256`), never stored, so chat text
// stays out of the experiment record. The routing provenance rides along, so
// the lab can ask whether the evaluator's picks verified more often than the
// default did.
function attemptStartRecord({ run, job, decisionId = null, actionId = null, titleKey, promptSha256, route, routeDecision = null, workKind, workShape = null }) {
  return {
    attemptId: run.id,
    decisionId,
    parentAttemptId: job.ref?.fromRun ? String(job.ref.fromRun).slice(0, 80) : null,
    parentTitle: job.ref?.parent ? String(job.ref.parent).slice(0, 90) : null,
    intentKey: titleKey(job.title) || String(job.title ?? "").slice(0, 120),
    actionId,
    workItem: {
      kind: job.kind,
      id: job.kind === "task" ? job.ref?.id ?? null : null,
      title: String(job.title ?? "").slice(0, 160),
      promptSha256,
      promptChars: String(job.prompt ?? "").length,
    },
    depth: run.depth,
    claim: { runId: run.id, leaseAt: run.startedAt },
    route: { via: String(route.via ?? "").slice(0, 80), cli: ["grok", "claude", "codex", "antigravity"].includes(route.cli) ? route.cli : "opencode", tier: ["free", "fast", "heavy"].includes(route.tier) ? route.tier : "auto",
      provider: String(route.modelProvider ?? "").slice(0, 40) || null, model: String(route.model ?? "").slice(0, 120) || null,
      method: String(routeDecision?.method ?? "").slice(0, 40) || null, winProbability: typeof routeDecision?.winProbability === "number" ? routeDecision.winProbability : null },
    workKind,
    workShape: workShape ? { intent: workShape.intent ?? null, complexity: workShape.complexity ?? null, weight: workShape.weight ?? null } : null,
  };
}

// The durable executor-log row for a finished run: what ran, how it ended,
// and the tail of what it said (sentinel and result lines aside), the work
// log that survives the app.
function finishLogRecord({ run, job, ok, code, errorMessage = null, userStop = false, sessionId = null, now, doneMark }) {
  return {
    event: "finish",
    runId: run.id,
    kind: job.kind,
    task: job.kind === "task" ? job.ref?.id ?? null : null,
    title: String(job.title ?? "").slice(0, 160),
    ok,
    code: code ?? null,
    error: errorMessage ? String(errorMessage).slice(0, 200) : null,
    stopped: userStop || undefined,
    sawDone: run.sawDone === true,
    spoke: run.spoke === true,
    startKilled: run.startKilled === true || undefined,
    sessionId,
    result: run.resultNote?.raw ?? null,
    seconds: Math.round((now - run.startedAt) / 1000),
    tail: (run.outputLog ?? []).filter((line) => saidLine(line, doneMark)).slice(-40),
  };
}

// The Policy Lab's attempt-finish record, the outcome half of the attempt. A
// finish report is not a verification result: `outcome` records what the run
// CLAIMED; a positive learning label can only come later, from a runner-
// produced receipt. Unknown costs stay null, never zero.
function attemptFinishRecord({ run, job, ok, code, sessionId = null, durationMs, titleKey, maxHandoffs }) {
  return {
    attemptId: run.id,
    intentKey: titleKey(job.title) || String(job.title ?? "").slice(0, 120),
    outcome: ok ? "reported-done" : "failed",
    exitCode: code ?? null,
    sawDone: run.sawDone === true,
    spoke: run.spoke === true,
    sessionId,
    durationMs,
    handoffs: run.handoffs.slice(0, maxHandoffs).map((item) => ({ title: String(item.title ?? "").slice(0, 90), intentKey: titleKey(item.title) || null })),
    result: run.resultNote?.parts
      ? {
          done: String(run.resultNote.parts.done ?? "").slice(0, 200) || null,
          remaining: String(run.resultNote.parts.remaining ?? "").slice(0, 200) || null,
          tests: String(run.resultNote.parts.tests ?? run.resultNote.parts.ran ?? "").slice(0, 200) || null,
        }
      : null,
    cost: { durationMs, modelCalls: null, tokens: null, providerCost: null, testExecutions: null },
  };
}

// The attempt's evidence as the card keeps it (`lastAttempt`): its last real
// line, not the sentinel (`lastWords`), the work it handed on, and one marker
// per advisory (role, ok, size or error). The raw advisories reached the
// worker through its brief, and a full copy here was re-snapshotted into every
// later revision.
function attemptRecord({ run, job, code, errorMessage = null, lastWords: tail = null, sessionId = null, now, maxDepth, maxHandoffs }) {
  // A capture that throws cannot keep settle() from running (a throw before
  // it left the entry finished but in autopilot.jobs, which every reaper
  // skips): the attempt keeps no hand-offs and names why (`handoffError`).
  let handoffs = [], handoffError = null;
  try { handoffs = taskHandoffs.captureTaskHandoffs(run, job, { now, maxDepth, limit: maxHandoffs }); }
  catch (error) { handoffError = String(error?.message ?? error).slice(0, 160); }
  return {
    runId: run.id,
    startedAt: run.startedAt,
    code: code ?? null,
    sawDone: run.sawDone === true,
    spoke: run.spoke === true,
    sessionId,
    ...(run.routeLabel ? { route: run.routeLabel } : {}),
    at: now,
    tail,
    ...(errorMessage ? { error: String(errorMessage).slice(0, 500) } : {}),
    ...(run.resultNote ? { result: run.resultNote } : {}),
    handoffs,
    ...(run.clusterReports ? {
      agentMode: run.mode,
      support: run.clusterReports.map((report) => ({ role: report.role, ok: report.ok === true, ...(report.ok ? { chars: String(report.text ?? "").length } : { error: String(report.error ?? "").slice(0, 120) }) })),
    } : {}),
    ...(handoffError ? { handoffError } : {}),
  };
}

// ---- the start budget ------------------------------------------------------------

// How long a run may stay silent (no line, no session) before the wedged-start
// watchdog kills it. It scales with the siblings already running (a full pool
// starting against one shared OpenCode store takes minutes to first output),
// and it moves with evidence: a fixed budget was a cliff, and a runner that
// reliably needed a little longer was killed on every card, forever. So it is
// never less than twice the slowest of the recent starts that did speak
// (`samples`); after kills with no start in between (`kills`) it widens 1.5x
// per kill, but that blind widening stops at twice the base, because a runner
// that never speaks is exactly what the watchdog exists to stop. Nothing
// waits longer than ten minutes.
function startBudgetMs({ base, running = 0, kills = 0, samples = [] }) {
  const crowded = base + Math.max(0, running - 4) * 45000;
  const escalated = Math.min(2 * base, crowded * 1.5 ** kills);
  const learned = 2 * Math.max(0, ...samples);
  return Math.round(Math.min(10 * MINUTE_MS, Math.max(crowded, escalated, learned)));
}

// ---- the command line per builder CLI --------------------------------------------

// How a builder route starts: the command, its arguments, the stdio shape,
// what goes to stdin (null: nothing, the pipe stays ignored), and the
// environment the route adds to the host's. Every route runs the same prompt
// and sentinel protocol headless, tools auto-approved because nobody is at
// the keyboard. `cli` is the route's CLI (grok, claude, codex, antigravity),
// or anything else for `opencode run`. `modelArg` and `agyModelArg` are the
// host's model-id filters (cliModelArg, agyModelArg), called only by the
// route that needs one.
// `desk` names the per-run MCP config files that put the desk's ask_desk tool
// beside the run (agent-brain-host prepareDeskTool); only Claude Code and
// OpenCode take them, and a path cmd.exe could mangle is never passed.
const DESK_CONFIG_PATH = /^[A-Za-z]:\\[^\s"'&|<>^%!]+$|^\/[^\s"'&|<>^%!]+$/;
function cliInvocation(route, cli, prompt, { modelArg = () => "", agyModelArg = () => "", desk = null } = {}) {
  if (cli === "grok") {
    // A headless agentic session: positional prompt (so, unlike the others,
    // the brief is visible in this process's command line), tools
    // auto-approved, plain stdout, a turn cap so a wedged run cannot outlive
    // the kill timer.
    const grokArgs = ["--output-format", "plain", "--always-approve", "--max-turns", "60", "--no-alt-screen", "--verbatim"];
    if (route.model) grokArgs.push("-m", route.model);
    grokArgs.push(prompt);
    return { command: "grok", args: grokArgs, stdio: ["ignore", "pipe", "pipe"], stdin: null, env: route.env };
  }
  if (cli === "claude") {
    // Claude Code's headless print mode: permission checks bypassed, the
    // prompt on stdin (never cmd's command line), plain text so the sentinel
    // protocol stays readable, the model id held to real-id characters before
    // it enters the command string.
    const selected = modelArg(route.model);
    const mcp = desk?.claude && DESK_CONFIG_PATH.test(desk.claude) ? ` --mcp-config ${desk.claude}` : "";
    return { command: "cmd.exe", args: ["/d", "/s", "/c", `claude -p --output-format text --dangerously-skip-permissions${selected ? ` --model ${selected}` : ""}${mcp}`], stdio: ["pipe", "pipe", "pipe"], stdin: prompt, env: route.env };
  }
  if (cli === "codex") {
    // `codex exec`: approvals and the sandbox bypassed (the run root is the
    // whole workspace), the prompt on stdin ("-" reads it there), --color
    // never keeps the protocol readable on plain stdout.
    const selected = modelArg(route.model);
    return { command: "cmd.exe", args: ["/d", "/s", "/c", `codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --color never${selected ? ` -m ${selected}` : ""} -`], stdio: ["pipe", "pipe", "pipe"], stdin: prompt, env: route.env };
  }
  if (cli === "antigravity") {
    // The Antigravity CLI's agentic print mode. Every flag precedes `-p` (with
    // `-p` first agy silently drops --model), permissions are skipped, and the
    // print timeout sits above the executor's own kill budget so the CLI never
    // ends a live build early. agy is a Go binary, so it spawns directly: the
    // display-name model never passes through cmd.exe.
    const args = [];
    const selected = agyModelArg(route.model);
    if (selected) args.push("--model", selected);
    args.push("--dangerously-skip-permissions", "--print-timeout", "60m", "--output-format", "text", "-p");
    return { command: "agy", args, stdio: ["pipe", "pipe", "pipe"], stdin: prompt, env: route.env };
  }
  // --auto: nobody is at the keyboard to answer a permission prompt, so a
  // headless run without it stops at the first edit and reports back prose.
  // The prompt rides STDIN, never the command line: `opencode run` reads piped
  // stdin as its message, so an open, never-ended pipe leaves it waiting for a
  // prompt that never comes (this shape wedged every run on 2026-09-18), and
  // cmd's quoting and percent-expansion mangle long prompt bodies until the
  // CLI prints its help and exits 1. Write + end is a clean prompt and a clean EOF.
  const env = desk?.opencode && DESK_CONFIG_PATH.test(desk.opencode) ? { ...(route.env ?? {}), OPENCODE_CONFIG: desk.opencode } : route.env;
  return { command: "cmd.exe", args: ["/d", "/s", "/c", `opencode run --auto${route.modelArgs}`], stdio: ["pipe", "pipe", "pipe"], stdin: prompt, env };
}

// ---- one line of worker output -----------------------------------------------------

// What one line of a worker's output says, read against the run's state
// without changing it. Every mark is anchored to the start of the line and
// read through the same colour strip, so a run can neither talk itself into
// being done nor talk the board into new work by quoting the protocol, and a
// CLI that wraps its last line in colour still has its verdict counted.
// - `plain`: the colour-stripped line; `clean`: the part the kept tails take.
// - `first`: the run's first line, which is how long its runner took to start
//   (`startMs`, from `startedAt`); the start budget learns from it.
// - `sawDone`: the verdict sentinel, by strict line match
//   (assistant.isDoneMarkerLine); `resultNote`: the first MEFI_RESULT line.
// - `handoff` / `call`: a MEFI_NEXT or MEFI_CALL line (`parseHandoff`), within
//   the run's limits. A run at the depth limit was told not to hand off, and no
//   child is ever admitted past it, so its MEFI_NEXT is `declined`, kept for
//   the card's log and never a `remaining` obligation nothing could discharge.
// - `issue`: a MEFI_ASK decision, at most `issuesPerRun` (the live map's
//   intake) per run and never the same one twice, carrying the two lines
//   before it as evidence.
// - `urgent`: the verdict or the result line arrived, worth a prompt save.
function readWorkerLine(state, line, { now, startedAt, doneMark, maxDepth, maxHandoffs, assistant = null, parseHandoff = () => null, issuesPerRun = NaN }) {
  const plain = line.replace(COLOUR, "").trim();
  const first = !state.spoke;
  const read = { plain, clean: plain.slice(0, 200), first, startMs: first ? now - startedAt : null, sawDone: false, resultNote: null, handoff: null, declined: null, call: null, issue: null, urgent: false };
  if (assistant?.isDoneMarkerLine ? assistant.isDoneMarkerLine(line, doneMark) : line.trim() === doneMark) read.sawDone = true;
  if (!state.resultNote) {
    const resultLine = assistant?.parseExecutorResult ? assistant.parseExecutorResult(line) : null;
    if (resultLine) read.resultNote = resultLine;
  }
  const handoff = parseHandoff(line);
  if (handoff?.kind === "next" && Number(state.depth) >= maxDepth) {
    if ((state.declinedHandoffs ?? []).length < maxHandoffs) read.declined = handoff;
  } else if (handoff?.kind === "next" && state.handoffs.length < maxHandoffs) read.handoff = handoff;
  if (handoff?.kind === "call") read.call = handoff;
  const perRun = Number(issuesPerRun);
  if (state.issues.length < (Number.isInteger(perRun) && perRun > 0 ? Math.min(perRun, agentIssues.ISSUE_MAX_PER_RUN) : agentIssues.ISSUE_MAX_PER_RUN)) {
    const asked = agentIssues.parseIssueLine(line);
    if (asked && !state.issues.some((item) => item.kind === asked.kind && item.title === asked.title)) {
      read.issue = { ...asked, evidence: state.outputTail.slice(-2) };
    }
  }
  read.urgent = (read.sawDone && !state.sawDone) || Boolean(read.resultNote);
  return read;
}

// Applies what readWorkerLine found to the run's state: it has spoken (on
// stdout: `spokeOut`, which the CLI fallback reads), its verdict, result,
// hand-offs, calls and asks, and the kept tails, the last 8 and 40 non-empty
// lines, so a bare colour reset can never become the run's last words.
function applyWorkerLine(state, read, { stdout = false } = {}) {
  state.spoke = true;
  if (stdout) state.spokeOut = true;
  if (read.sawDone) state.sawDone = true;
  if (read.resultNote) state.resultNote = read.resultNote;
  if (read.declined) (state.declinedHandoffs ??= []).push(read.declined.title);
  if (read.handoff) state.handoffs.push(read.handoff);
  if (read.call) state.calls.add(read.call.role);
  if (read.issue) state.issues.push(read.issue);
  if (read.clean) {
    state.outputTail.push(read.clean);
    if (state.outputTail.length > 8) state.outputTail.splice(0, state.outputTail.length - 8);
    state.outputLog.push(read.clean);
    if (state.outputLog.length > 40) state.outputLog.splice(0, state.outputLog.length - 40);
  }
  return state;
}

module.exports = {
  MAX_RUN_FAILURES,
  PROVIDER_GRACE,
  SILENT_DEATH_MS,
  isQueued,
  selectCandidates,
  idleStopReason,
  promptTail,
  workerPrompt,
  INSTRUCTIONS,
  failureBackoffMs,
  startKillCooldownMs,
  providerCooldownMs,
  providerOutage,
  classifyRunEnd,
  attemptLedgerOutcome,
  settleAttemptRow,
  releaseInboxCopies,
  saidLine,
  lastWords,
  attemptStartRecord,
  finishLogRecord,
  attemptFinishRecord,
  attemptRecord,
  startBudgetMs,
  cliInvocation,
  readWorkerLine,
  applyWorkerLine,
};
