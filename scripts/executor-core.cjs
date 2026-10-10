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
const { buildWindowsCmdArgs } = require("./windows-command-line.cjs");
// Only its pure launch builder (appServerInvocation) runs from here.
const codexAppServer = require("./codex-harness.cjs");
const modelLadder = require("./model-ladder.cjs");

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
function selectCandidates({ tasks, now, liveTaskIds, liveKeys, titleKey, conflicts, released = null, autoBuild, approve = null, taskStart = null, cluster = null, compare }) {
  const open = tasks
    .filter((task) => task && isQueued(task) && !liveTaskIds.has(task.id) && !liveKeys.has(titleKey(task.title)) && !conflicts(task))
    .sort((a, b) => (a.createdAt ?? a.updatedAt ?? 0) - (b.createdAt ?? b.updatedAt ?? 0));
  const runnable = open.filter((task) => (task.runFailures ?? 0) < MAX_RUN_FAILURES && backlog.workState(task, now, { tasks, autoBuild, approve }).stage === "ready" && !(task.nextRunAt && task.nextRunAt > now) && !released?.has(task.id));
  // Pick by what the job is FOR, not just who filed it: the worth order puts
  // the overseer's own upkeep last, where it once took 20 of 34 slots.
  const ranked = runnable
    .map((ref) => ({ kind: "task", ref }))
    .filter((candidate) => (!taskStart || candidate.ref.id === taskStart.taskId && backlog.scopeMatches(candidate.ref, taskStart.scope))
      && (!cluster || agentModes.matchesFocus(candidate, cluster))).sort((a, b) => executorResume.compare(a.ref, b.ref) || compare(a.ref, b.ref));
  return { open, ranked };
}

// Why nothing started when no card was ranked: a focused Cluster waits on its
// own work, otherwise the reason the waiting cards give (the named card's
// alone for an explicit Start), in this order.
function idleStopReason({ open, tasks, now, autoBuild, approve = null, taskStart = null, cluster = null }) {
  if (cluster?.focus) return "cluster";
  const states = (taskStart ? tasks.filter((task) => task?.id === taskStart.taskId) : open).map((item) => backlog.workState(item, now, { tasks, autoBuild, approve }));
  if (states.some((item) => item.stage === "approval")) return "approval";
  if (states.some((item) => item.blockedBy === "relevance-check")) return "checking";
  if (states.some((item) => item.stage === "cooling")) return "cooldown";
  if (states.some((item) => item.blockedBy === "dependencies")) return "prerequisites";
  if (states.some((item) => item.stage === "blocked")) return "review";
  if (states.some((item) => item.stage === "deferred")) return "scheduled";
  return "empty";
}

// ---- the worker's prompt -------------------------------------------------------

// The fixed end of every worker prompt: the run's identity, so the worker (and
// any structured result it prints) names the attempt it belongs to; the
// hand-off and call protocol, or at the depth limit the order to stop handing
// off; the owner-question line, so a decision the run cannot make reaches the
// owner while it keeps working; the budget warning; the MEFI_RESULT line,
// required on every run (Studio queues its verification check from a done:
// report, and a run on a CLI that leaves no session, Claude Code, Codex, Grok
// or Antigravity, cannot be verified without it), whose owner: part is the
// lane for what only the owner can do (it is neither work this task owes,
// remaining:, nor a hand-off, MEFI_NEXT); and the verdict sentinel, the one
// last line (MEFI_RESULT comes before it). `opencode run` exits 1 even on a
// clean run, so the sentinel, not the exit code, is the success signal.
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
  const { rules, sentinel } = tailParts({ handoff, budget, askLine, doneMark });
  return `${identity}${brainLine}${rules}${sentinel}`;
}

// The same words as promptTail in the order a prompt-prefix cache can use
// (workerPrompt with a { rules, identity } tail): `rules` is the same for every
// run at the same depth and budget (the bookkeeping rule, the hand-off
// protocol, the owner lane, the budget, the required MEFI_RESULT line and the
// Agent Brain's lines), so it can lead the prompt beside the builder
// instructions; `identity` names the run and carries the verdict sentinel, so
// it still closes the prompt. main.cjs uses it while the prompt cache is on
// (scripts/prompt-cache.cjs enabled) and promptTail otherwise.
function promptParts({ runId, taskId, depth = 0, maxDepth, maxHandoffs, nextMark, callMark, budgetMinutes, doneMark, protocol = "" }) {
  const tail = promptTail({ runId, taskId, depth, maxDepth, maxHandoffs, nextMark, callMark, budgetMinutes, doneMark, protocol });
  const identity = ` This dispatch is run ${runId} for task ${taskId}.`;
  const sentinel = ` Print the exact line ${doneMark} as the last thing you say.`;
  // promptTail is identity + brain line + rules + sentinel: what lies between
  // the two run-specific ends is the shared part, word for word.
  return { rules: tail.slice(identity.length, tail.length - sentinel.length), identity: `${identity}${sentinel}` };
}

function tailParts({ handoff, budget, askLine, doneMark }) {
  const rules = ` Keep verification and board bookkeeping in the current task. Never create a child task merely to close, update, verify or confirm another card. Report evidence and actual remaining implementation scope on this attempt instead; hand off only substantive unfinished work.${handoff}${askLine}${budget} Every run must print one line "MEFI_RESULT: done: <what you finished>; remaining: <what this task still owes, or none>; owner: <what only the owner can do, or leave it out>" before the last line, naming your own account of the work (under 300 characters): Studio checks your work from it, and a run without it cannot be verified. A concrete human decision, missing access or physical action goes under owner:, never under remaining: or MEFI_NEXT. Routine repairs, failing checks and concurrent-file or test-history conflicts stay under remaining: until resolved. Preserve other sessions' work and use the repository's documented test-history tools. Studio owns board updates; report the evidence and let the host reconcile the task.`;
  return { rules, sentinel: ` Print the exact line ${doneMark} as the last thing you say.` };
}

// What every builder is told about the folder, previews and the shared git
// index. A selected project may be a brand-new folder, so the Git guidance
// must not invent a commit obligation or an owner blocker for that case.
// Workers never publish: a project's own agent notes may say to push or run
// `npm run sync` (this repository's AGENTS.md does), and a worker reads them,
// so the rule names both and says it wins; Studio and the owner land work.
// Workers given a one-line task filled its gaps with invented commands, env
// vars and package names, and built roadmap items without reading the plan
// docs. An unknown detail is looked for first; one only the owner can supply
// is theirs (MEFI_ASK or owner:), and remaining: is work this task can still do.
const INSTRUCTIONS = " Work in the project folder at the current directory. Make the edits, do not just describe them. When done, run the narrowest relevant test. For browser apps, leave a root index.html or a working package preview/dev/start script for Studio Preview. Save and test the app, then finish the builder task; Studio owns the preview server separately. Do not launch a long-running foreground or background preview server from a builder tool, or wait on one to report completion. Determine whether the project is a Git working tree before applying Git instructions. In a Git working tree, other Studio sessions share its index: commit with one atomic path-limited command (`git commit -m <msg> -- <your files>`), never `git add` followed by a plain `git commit`, `git commit -a`, or `git add -A`, and leave nothing staged when you finish — a bare commit sweeps whatever another session staged into your commit. Preserve any commit requirement in the task or project instructions. If no Git working tree exists and neither the task nor project instructions require a commit, finish and verify normally: do not initialize Git or create follow-up work just to satisfy this generic guidance. Missing Git alone is then informational: mention it only in the ordinary result summary, never in MEFI_ASK, remaining: or owner:. If a commit is explicitly required, retain that obligation and report any actual blocker. Never push, pull, merge or sync branches, and never run `git push` or `npm run sync`, even where project instructions say to: Studio and the owner land the work. Do not invent names, commands, env vars, packages or API details not in the repository, the task or a source you read. Look for them first; if only the owner has one, use MEFI_ASK or owner:; remaining: is only for work this task can still do. Before building an item from a roadmap or plan, look for its plan in the project's docs (docs/ when there is one) and follow it.".replace(/["\r\n]+/g, " ");
// A worker on Windows may be in PowerShell (OpenCode and Codex are), where
// `head` and `tail` do not exist. Only Windows runs are told (workerPrompt's
// `platform`); the line is conditional because Claude Code runs Git Bash there.
const WINDOWS_SHELL = " If your shell is PowerShell, use Select-Object -First N or -Last N instead of head or tail.";

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
// record throws out of here and the caller releases the claim. `platform` is
// the host's process.platform: a Windows run also gets the PowerShell line.
// Returns the prompt and the brief it carries (`jobPrompt`, which the caller
// keeps as the job's prompt).
function workerPrompt({ title, taskId, tasksFile, ref, resumeCheckpoint = null, sections = {}, clusterBrief = "", tail, promptMax, brief, contextPath = null, platform = null }) {
  const titleBit = `${title}. `.replace(/["\r\n]+/g, " ");
  const failFlat = flat(sections.fail, 240);
  // Work done outside Studio that touches this card (outside-work.cjs briefLine).
  const outsideFlat = sections.outside ? flat(` ${sections.outside}`, 720) : "";
  const memoryFlat = flat(sections.memory, 480);
  const recapFlat = sections.recap ? `\n\nRECORDED SEAT RECAP (history only; the current task brief takes precedence):\n${flat(sections.recap, 1500)}\n\n` : "";
  const collabFlat = flat(sections.collab, 960);
  const pathsFlat = flat(sections.paths, 240);
  const brainFlat = flat(sections.brain, 700);
  const clusterFlat = clusterBrief ? ` ${clusterBrief.replace(/[\r\n]+/g, " ").slice(0, 2400)} ` : "";
  const resumeBrief = executorResume.brief({ ...ref, runProgress: resumeCheckpoint });
  const resumeFlat = resumeBrief ? ` ${resumeBrief}\n\n` : "";
  // A { rules, identity } tail (promptParts) puts what every run shares first;
  // a string (promptTail) keeps the original layout, task first.
  const parted = Boolean(tail) && typeof tail === "object";
  const rulesFlat = parted ? String(tail.rules ?? "").replace(/["\r\n]+/g, " ") : "";
  const tailFlat = (parted ? String(tail.identity ?? "") : String(tail ?? "")).replace(/["\r\n]+/g, " ");
  const instructions = platform === "win32" ? `${INSTRUCTIONS}${WINDOWS_SHELL}` : INSTRUCTIONS;
  const promptBudget = Math.max(
    240,
    promptMax - tailFlat.length - rulesFlat.length - (parted ? 2 : 0) - instructions.length - titleBit.length - failFlat.length - outsideFlat.length - memoryFlat.length - recapFlat.length - pathsFlat.length - brainFlat.length - collabFlat.length - clusterFlat.length - resumeFlat.length - 8,
  );
  // The durable brief carries prior findings and successful prerequisite
  // outputs into the next worker instead of restarting from a short title.
  // A run context file (contextPath) is named in the brief's own header; only
  // without one is the worker sent to the whole board file.
  const recovery = contextPath ? "" : `Full saved task context: read ${JSON.stringify(tasksFile)}, find task id ${JSON.stringify(taskId)}. Read that record and its members whenever the brief is excerpted or grouped; contextHistory contains earlier requirements and attempts. Do not rewrite Studio's task store from the worker.\n\n`;
  const jobPrompt = recovery + brief(Math.max(1000, promptBudget - recovery.length));
  const body = String(jobPrompt ?? "").slice(0, promptBudget);
  const task = `${titleBit}${resumeFlat}${body}${outsideFlat}${failFlat}${memoryFlat}${recapFlat}${pathsFlat}${brainFlat}${collabFlat}${clusterFlat}`;
  if (parted) return { prompt: `${instructions.trimStart()}${rulesFlat}\n\n${task}${tailFlat}`, jobPrompt, budget: promptBudget };
  return { prompt: `${task}${instructions}${tailFlat}`, jobPrompt, budget: promptBudget };
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

// cmd.exe's words for a program that is not there reach the card as the run's
// last words, over two lines ("'opencode' is not recognized as an internal or
// external command," then "operable program or batch file."). Say what they
// mean; `tail` is the output around them, for the program's name.
function readableRunError(text, tail = []) {
  const value = String(text ?? "");
  const lines = [value, ...(Array.isArray(tail) ? tail.map(String) : [])];
  const named = lines.map((line) => line.match(/'([^'\r\n]{1,80})' is not recognized as an internal or external command/i)).find(Boolean);
  if (named) return `${named[1]} is not installed or not on PATH`;
  if (/^\s*operable program or batch file\.?\s*$/i.test(value)) return "a program this run needed is not installed or not on PATH";
  return value;
}

// A provider that answered and refused this login's plan: OpenCode Go's "An
// active OpenCode Go subscription is required to use Go models", a plan that
// leaves the model out, an HTTP 402. The same route will refuse every retry and
// the card did nothing wrong, so it is a route problem: settle requeues the
// card uncharged on the outage backoff (settleAttemptRow's `routeRefusal`),
// and the host parks the route and tells the owner once (main.cjs
// executorRouteRefused). The host reads only the run's own error and last
// words, as it does for an outage, and the outage grace still bounds a misread.
// Only a CLI's error line is read ("Error:" or "API Error:" opening it), or
// OpenCode Go's own sentence: a worker's prose and a test's output name plans,
// subscriptions and 402s too. A 402 must lead the error, or come as the
// provider's "402 Payment Required" or payment_required.
// "plan": the plan leaves out this model (parked alone); "subscription" and
// "payment": the login itself (its provider is parked).
const REFUSAL_ERROR = /^\s*(?:API )?error:\s*/i;
const REFUSAL_SAID = /\bAn active OpenCode Go subscription is required\b/;
const ENTITLEMENT_REFUSAL = [
  ["plan", /\bnot (?:included|available) (?:in|on|with) your (?:current )?(?:plan|subscription|tier)\b/i],
  ["subscription", /\bsubscription (?:is )?required\b/i],
  ["subscription", /\brequires? an? (?:active |paid |valid )?(?:[\w.-]+ ){0,3}?subscription\b/i],
  ["subscription", /\bno active (?:[\w.-]+ ){0,3}?subscription\b/i],
  ["payment", /^(?:HTTP(?:\/[\d.]+)?\s*|status(?: code)?[\s:=]*)?402\b|\b402 Payment Required\b|\bpayment_required\b/i],
];
function entitlementRefusal(texts) {
  for (const text of Array.isArray(texts) ? texts : [texts]) {
    if (text == null) continue;
    const line = String(text).replace(COLOUR, "");
    const error = REFUSAL_ERROR.exec(line);
    if (!error && !REFUSAL_SAID.test(line)) continue;
    const said = error ? line.slice(error[0].length) : line;
    const hit = ENTITLEMENT_REFUSAL.find(([, pattern]) => pattern.test(said));
    if (hit) return { kind: hit[0], line: flat(line, 200).trim() };
  }
  return null;
}

// Which route a refusal is about, in the owner's words. An OpenCode run names
// its model on the command line (--model provider/model), and the provider
// prefix names the plan; any other builder is its CLI, one login at a time.
// `key` is what the host parks: the provider for a subscription or payment
// refusal (it covers every model the login lists), the model alone when the
// plan leaves out only that one. `keys` are both, for the dispatch check.
const REFUSED_NAMES = {
  "opencode-go": ["OpenCode Go", "Go"], opencode: ["OpenCode Zen", "Zen"], "mefi-zai": ["z.ai", "coding plan"], "zai-coding-plan": ["z.ai", "coding plan"],
  openrouter: ["OpenRouter", ""], claude: ["Claude Code", "Claude"], codex: ["Codex", "ChatGPT"], grok: ["Grok", ""], antigravity: ["Antigravity", ""],
};
const REFUSAL_FIX = "Pick another coding model in Team › Seats and models, or renew the plan.";
function refusedRoute(route, refusal = null) {
  if (!route || typeof route !== "object") return null;
  const cli = ["grok", "claude", "codex", "antigravity"].includes(route.cli) ? route.cli : "opencode";
  const model = cli === "opencode" ? (/--model\s+(\S+)/.exec(String(route.modelArgs ?? ""))?.[1] || String(route.model ?? "").trim()) : String(route.model ?? "").trim();
  const prefix = cli === "opencode" ? (model.includes("/") ? model.split("/")[0] : "") : cli;
  const login = cli !== "opencode" && route.account?.id ? `:${route.account.id}` : "";
  const providerKey = `${prefix || "opencode-default"}${login}`;
  const modelKey = model ? `${providerKey}|${model}` : providerKey;
  const [name, plan] = REFUSED_NAMES[prefix] ?? (prefix ? [prefix, ""] : ["OpenCode", ""]);
  const shown = model ? model.replace(/^[^/]*\//, "") : "";
  const kind = refusal?.kind ?? "subscription";
  const short = kind === "plan" ? `${name} says ${shown || "this model"} is not included in this login's plan`
    : kind === "payment" ? `${name} says this login's plan or credit has run out`
      : `${name} says this login has no active ${plan ? `${plan} ` : ""}subscription`;
  return { key: kind === "plan" ? modelKey : providerKey, keys: [...new Set([modelKey, providerKey])], kind, name, model: model || null, short, notice: `${short}. ${REFUSAL_FIX}`, said: refusal?.line ?? null };
}

// How long a refused route is parked: the outage ladder (5m doubling) held to
// half an hour, so a renewed plan is tried again soon.
function routeParkMs(streak) {
  return Math.min(30 * MINUTE_MS, providerCooldownMs(streak));
}
// Whether a card waits only on the backoff a refused plan left it (settle's
// `refusedUntil` stamp, still the card's nextRunAt): the owner's own Start
// does not wait it out.
function refusalWait(task) {
  return Number(task?.refusedUntil) > 0 && Number(task.refusedUntil) === Number(task.nextRunAt);
}

// The card one finished attempt leaves behind: its settle state machine. The
// caller has already fenced ownership (the row still names this run) inside
// its board transaction and writes the returned row back there; `task` itself
// is not changed. `run` is the attempt's live state (the entry: sawDone,
// handoffs, declinedHandoffs, resultNote, ownerHold, resumeRequested,
// startKilled), `attempt` its evidence record, `scopeHeal` the card's
// re-anchored file scope, and `queuedJob` the overseer verification the
// caller queued for a done report. `routeRefusal` is refusedRoute's reading
// of a provider that refused this login's plan. `clip` is the host's title
// clipper.
function settleAttemptRow(task, outcome, { now, maxHandoffs, startGrace, clip }) {
  const { ok, userStop = false, providerOutage: outage = false, providerSaid = false, code, errorMessage = null, lastWords = null, attempt, run, scopeHeal = null, queuedJob = null, accountLimit = null, routeRefusal = null } = outcome;
  const row = { ...task };
  row.updatedAt = now;
  if (!userStop) row.lastAttempt = attempt;
  delete row.runProgress;
  delete row.claimFailures; // a worker launched: the pre-launch streak is over
  delete row.refusedUntil;
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
    // A run that hit its per-task time limit (task-cap.cjs) is stopped the same way and says why.
    const limited = Number.isFinite(run.capStop?.minutes) ? run.capStop.minutes : null;
    const held = run.ownerHold && !run.resumeRequested ? "held for you" : "ready to resume";
    executorResume.appendLog(row, limited === null
      ? `stopped on request (${run.sawDone ? "run had reported done" : "unfinished"}) — progress saved; ${held}`
      : `stopped at the time limit (${limited} min) (${run.sawDone ? "run had reported done" : "unfinished"}) — progress saved, nothing failed; ${held}`, { at: now });
  } else if (branch === "start-kill") {
    // No session, no output, killed by the start watchdog: the runner failed,
    // not the brief, so no attempt is charged. Start kills are counted apart,
    // so a card that keeps wedging its runner still runs out of grace.
    release();
    row.startFailures = (row.startFailures ?? 0) + 1;
    const startCooldown = startKillCooldownMs(row.startFailures);
    row.nextRunAt = now + startCooldown;
    row.lastRunError = readableRunError(errorMessage ?? "the worker never started", run.outputTail).slice(0, 160);
    executorResume.appendLog(row, `worker never started — ${row.lastRunError} · requeued in ${Math.round(startCooldown / 60000)}m, no attempt charged (start ${row.startFailures}/${startGrace})`, { at: now });
  } else if (branch === "outage") {
    // The provider was down, not the card: the outage backoff, uncharged.
    release();
    // The runner did start (it spoke or bound a session): the run of
    // consecutive start kills is over, as the ok branch already says.
    if (!run.startKilled && (run.spoke || run.sessionId)) delete row.startFailures;
    row.lastRunError = String(lastWords || errorMessage || `exit ${code ?? "?"}`).slice(0, 160);
    if (accountLimit) {
      // One subscription login topped out (`accountLimit`: the host's
      // { tag, until, next } words): the provider is fine and the card goes
      // straight back for the next login, or for whatever route the host
      // picks once none is left. Uncharged, and off the outage streak.
      delete row.nextRunAt;
      executorResume.appendLog(row, `provider unavailable (exit ${code ?? "?"}) · ${accountLimit.tag} topped out until ${accountLimit.until} · requeued now ${accountLimit.next ? `on ${accountLimit.next}` : "for the next route"}, no attempt charged`, { at: now });
    } else {
      // A provider that refused this login's plan waits on the outage
      // backoff too, and the card says why in the owner's words. The wait is
      // stamped as the refusal's (`refusedUntil`), so the owner's own Start
      // can try the renewed plan at once (main.cjs assistantWorkOn).
      if (routeRefusal?.short) row.lastRunError = String(routeRefusal.short).slice(0, 160);
      row.providerFailures = (Number(row.providerFailures) || 0) + 1;
      const cooldown = providerCooldownMs(row.providerFailures);
      row.nextRunAt = now + cooldown;
      if (routeRefusal) row.refusedUntil = row.nextRunAt;
      executorResume.appendLog(row, `provider unavailable (exit ${code ?? "?"}) · ${row.lastRunError} · requeued in ${Math.round(cooldown / 60000)}m, no attempt charged`, { at: now });
    }
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
    row.lastRunError = failTail ? readableRunError(failTail, run.outputTail).slice(0, 160) : `exit ${code ?? "?"}`;
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
    // Stopped at the per-task time limit: how long the limit was (task-cap.cjs).
    ...(userStop && Number.isFinite(run.capStop?.minutes) ? { limitMinutes: run.capStop.minutes } : {}),
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
    // The model this attempt ran on: a retry stays on it (main.cjs spawnNextJob).
    ...(run.routeModel ? { model: run.routeModel, cli: run.routeCli ?? null } : {}),
    // A coding CLI's own session and token totals (live progress,
    // scripts/cli-stream.cjs), bounded copies, never the live objects.
    ...(run.cliSession?.id ? { cliSession: executorResume.cliSessionRecord(run.cliSession) } : {}),
    ...(run.cliUsage ? { usage: executorResume.usageRecord(run.cliUsage) } : {}),
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

// One word of a POSIX `sh -c` line: bare when it holds nothing the shell
// reads, single-quoted otherwise (a quote inside closes, escapes, reopens).
function shWord(value) {
  const text = String(value);
  return /^[A-Za-z0-9_\/.:=@%+,-]+$/.test(text) ? text : `'${text.replace(/'/g, "'\\''")}'`;
}

// A builder CLI started through the shell. On Windows that is cmd.exe with a
// line built by scripts/windows-command-line.cjs and handed over verbatim
// (`verbatim`: the spawn's windowsVerbatimArguments), so a value holding a
// space, an apostrophe, `&` or `%` (an MCP config under C:\Users\John Smith,
// the Electron path under "Mefi's Studio AI+", a display-name model) arrives
// as one argument; left to Node's own escaping, cmd read its quotes as \" and
// such a value used to be dropped instead. No prompt ever rides this line
// (stdin or a file carries it): cmd stops at the first newline and at 8191
// characters. Elsewhere it is the same cmd.exe call holding an sh line, which
// scripts/platform.cjs runs as `sh -c` in its own process group.
function shellLaunch(command, args, platform) {
  if (platform === "win32") return { command: "cmd.exe", args: buildWindowsCmdArgs(command, args), verbatim: true };
  return { command: "cmd.exe", args: ["/d", "/s", "/c", [command, ...args].map(shWord).join(" ")], verbatim: false };
}

// A CLI that ships as a native binary (grok, agy) spawns directly, with no
// shell between it and its arguments. An install that put a batch shim on
// PATH instead cannot: the guided installer's `npm install --global` leaves
// grok.cmd, Node refuses to spawn .cmd/.bat without a shell, and every Grok
// run failed ENOENT while where.exe reported the CLI installed. `shim` is the
// host's PATH lookup (agent-mcp windowsShim): the shim's path when a .cmd or
// .bat comes before any .exe, and that shim runs through cmd.exe with the
// same verbatim quoting.
function binaryLaunch(command, args, platform, shim) {
  const batch = platform === "win32" ? shim(command) : null;
  if (batch) return { command: "cmd.exe", args: buildWindowsCmdArgs(batch, args), verbatim: true };
  return { command, args, verbatim: false };
}

// A TOML string for a codex `-c key=value` override, in the literal forms: no
// escapes, so a Windows path reads as written, and never a `"`, which cmd.exe
// cannot carry through codex's npm shim. A value with an apostrophe ("Mefi's
// Studio AI+") takes the multi-line literal form; one neither form can hold,
// or one with a control character, is refused (null).
function tomlLiteral(value) {
  const text = String(value ?? "");
  if (/[\u0000-\u0008\u000a-\u001f\u007f]/.test(text)) return null;
  if (!text.includes("'")) return `'${text}'`;
  if (text.includes("'''") || text.endsWith("'")) return null;
  return `'''${text}'''`;
}

// The run's MCP servers as codex config overrides. `servers` is the
// attachment's server table ({ name: { command, args, env } },
// agent-tool-configs prepare). Codex takes no per-run config file, so each
// server is spelled out on its command line, where anything that can list
// processes can read it: a server whose environment names a credential is
// left out. Returns the `-c` arguments and the names left out.
const CODEX_SECRET_ENV = /KEY|TOKEN|SECRET|PASSWORD/i;
function codexMcpArgs(servers) {
  const args = [], dropped = [];
  for (const [name, server] of Object.entries(servers && typeof servers === "object" ? servers : {})) {
    const command = server?.command ? tomlLiteral(server.command) : null;
    const list = (Array.isArray(server?.args) ? server.args : []).map(tomlLiteral);
    const env = Object.entries(server?.env && typeof server.env === "object" ? server.env : {}).map(([key, value]) => [key, tomlLiteral(value)]);
    const refused = !/^[A-Za-z0-9_-]{1,64}$/.test(name) || !command || list.includes(null)
      || env.some(([key, value]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || value === null || CODEX_SECRET_ENV.test(key));
    if (refused) { dropped.push(String(name).slice(0, 64)); continue; }
    args.push("-c", `mcp_servers.${name}.command=${command}`, "-c", `mcp_servers.${name}.args=[${list.join(",")}]`);
    if (env.length) args.push("-c", `mcp_servers.${name}.env={${env.map(([key, value]) => `${key}=${value}`).join(",")}}`);
  }
  return { args, dropped };
}

// How a builder route starts: the command, its arguments, whether they reach
// cmd.exe verbatim (`verbatim`, the spawn's windowsVerbatimArguments), the
// stdio shape, what goes to stdin (null: nothing, the pipe stays ignored),
// the environment the route adds to the host's, and the MCP servers this
// launch could not carry (`dropped`, which the host logs). Every route runs
// the same prompt and sentinel protocol headless, tools auto-approved because
// nobody is at the keyboard. `cli` is the route's CLI (grok, claude, codex,
// antigravity), or anything else for `opencode run`. `modelArg` and
// `agyModelArg` are the host's model-id filters (cliModelArg, agyModelArg),
// called only by the route that needs one; `platform` is the host's, `shim`
// its batch-shim lookup, and `promptFile` the file the host wrote the brief
// to for grok, which reads no prompt on stdin.
// `desk` is the run's MCP attachment (agent-tool-configs prepare, or the
// desk's own files from agent-brain-host prepareDeskTool): OpenCode reads its
// file through OPENCODE_CONFIG, Claude Code takes --mcp-config, Codex takes
// its server table as config overrides. Grok and Antigravity have no per-run
// MCP flag and keep their own configuration.
// `codexHarness` picks how a Codex route runs: "exec" (the default, `codex
// exec` below) or "app-server", the same worker over `codex app-server`'s
// JSON-RPC (scripts/codex-harness.cjs appServerInvocation: `harness` and a
// session `plan` ride the result, the host wraps the child in wrapChild, and
// the MCP servers travel over stdin, so none is dropped).
// `live` is live progress (the host's switch, on by default): Claude Code and
// `codex exec` print JSON events as they work instead of their answer at the
// end, and the launch names that stream (`stream`: "claude" or "codex") for the
// host's decoder (scripts/cli-stream.cjs). Claude Code also runs under
// `sessionId`, a UUID the host chose, so a later attempt can name the session.
// Codex's app server has its own facade and is not affected. Off, every
// command line is exactly the text-mode one.
const SESSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function cliInvocation(route, cli, prompt, { modelArg = () => "", agyModelArg = () => "", desk = null, platform = "win32", shim = () => null, promptFile = null, codexHarness = "exec", live = false, sessionId = null, ownMcp = false } = {}) {
  if (cli === "grok") {
    // A headless agentic session. --prompt-file both starts grok's headless
    // mode and keeps a brief of up to EXECUTOR_PROMPT_MAX off every command
    // line (a positional prompt was visible in the process list, and cannot
    // cross cmd.exe at all when grok is a shim). Tools auto-approved, plain
    // stdout, the model held to real-id characters, a turn cap so a wedged
    // run cannot outlive the kill timer.
    if (!promptFile) throw new Error("the grok brief was not written to its prompt file");
    const selected = route.model ? modelArg(route.model) : "";
    const args = ["--output-format", "plain", "--always-approve", "--max-turns", "60", "--no-alt-screen", "--verbatim", ...(selected ? ["-m", selected] : []), "--prompt-file", promptFile];
    return { ...binaryLaunch("grok", args, platform, shim), stdio: ["ignore", "pipe", "pipe"], stdin: null, env: route.env, dropped: [] };
  }
  // `route.effort` is how hard this attempt thinks (the host's builder step,
  // scripts/model-ladder.cjs): one of the ladder's fixed words, never free text.
  const thinking = modelLadder.effortArgs(["claude", "codex", "grok", "antigravity"].includes(cli) ? cli : "opencode", route.effort);
  if (cli === "claude") {
    // Claude Code's headless print mode: permission checks bypassed, the
    // prompt on stdin (never cmd's command line), plain text so the sentinel
    // protocol stays readable, the model id held to real-id characters.
    // With live progress, stream-json (which print mode gives only with
    // --verbose) and the session id the host chose instead of plain text.
    // --strict-mcp-config: the run gets the desk's servers and nothing else,
    // as an OpenCode run does. Without it every worker also started the
    // owner's own Claude Code servers (an npx proxy and a uvx Python server
    // measured ~380 MB together) on a machine short of memory. `ownMcp` (the
    // host's MEFI_STUDIO_WORKER_OWN_MCP=1) gives a run the owner's servers back.
    // --mcp-config takes a list, so it goes last.
    const selected = modelArg(route.model);
    const session = live && SESSION_UUID.test(String(sessionId ?? "")) ? ["--session-id", String(sessionId)] : [];
    const args = ["-p", "--output-format", ...(live ? ["stream-json", "--verbose", ...session] : ["text"]), "--dangerously-skip-permissions", ...(ownMcp ? [] : ["--strict-mcp-config"]), ...(selected ? ["--model", selected] : []), ...thinking, ...(desk?.claude ? ["--mcp-config", desk.claude] : [])];
    return { ...shellLaunch("claude", args, platform), stdio: ["pipe", "pipe", "pipe"], stdin: prompt, env: route.env, dropped: [], ...(live ? { stream: "claude" } : {}) };
  }
  if (cli === "codex") {
    if (codexHarness === "app-server") return codexAppServer.appServerInvocation(route, prompt, { modelArg, desk, platform, shim, launch: shellLaunch });
    // `codex exec`: approvals and the sandbox bypassed (the run root is the
    // whole workspace), the prompt on stdin ("-" reads it there), --color
    // never keeps the protocol readable, the run's MCP servers as overrides.
    // With live progress, --json prints its events on stdout as JSONL.
    const selected = modelArg(route.model);
    const mcp = codexMcpArgs(desk?.servers);
    const args = ["exec", ...(live ? ["--json"] : []), "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check", "--color", "never", ...(selected ? ["-m", selected] : []), ...thinking, ...mcp.args, "-"];
    return { ...shellLaunch("codex", args, platform), stdio: ["pipe", "pipe", "pipe"], stdin: prompt, env: route.env, dropped: mcp.dropped, ...(live ? { stream: "codex" } : {}) };
  }
  if (cli === "antigravity") {
    // The Antigravity CLI's agentic print mode. Every flag precedes `-p` (with
    // `-p` first agy silently drops --model), permissions are skipped, and the
    // print timeout sits above the executor's own kill budget so the CLI never
    // ends a live build early. The display-name model is one argument either
    // way: argv on a direct spawn, a quoted word through a shim.
    const args = [];
    const selected = agyModelArg(route.model);
    if (selected) args.push("--model", selected);
    args.push("--dangerously-skip-permissions", "--print-timeout", "60m", "--output-format", "text", "-p");
    return { ...binaryLaunch("agy", args, platform, shim), stdio: ["pipe", "pipe", "pipe"], stdin: prompt, env: route.env, dropped: [] };
  }
  // --auto: nobody is at the keyboard to answer a permission prompt, so a
  // headless run without it stops at the first edit and reports back prose.
  // The prompt rides STDIN, never the command line: `opencode run` reads piped
  // stdin as its message, so an open, never-ended pipe leaves it waiting for a
  // prompt that never comes (this shape wedged every run on 2026-09-18), and
  // cmd's quoting and percent-expansion mangle long prompt bodies until the
  // CLI prints its help and exits 1. Write + end is a clean prompt and a clean
  // EOF. The attachment's path rides the environment, which needs no quoting.
  const env = desk?.opencode ? { ...(route.env ?? {}), OPENCODE_CONFIG: desk.opencode } : route.env;
  // --variant is OpenCode's reasoning effort; the host sets route.effort only
  // to a variant this model lists, since an unknown one fails the run.
  const variant = thinking.length ? ` ${thinking.join(" ")}` : "";
  return { command: "cmd.exe", args: ["/d", "/s", "/c", `opencode run --auto${route.modelArgs ?? ""}${variant}`], verbatim: false, stdio: ["pipe", "pipe", "pipe"], stdin: prompt, env, dropped: [] };
}

// ---- a heavier retry ------------------------------------------------------------------

// Whether this card's next attempt is the "Try again with a heavier model" its
// owner chose (or the desk chose for them): a retry-deep decision newer than
// the start of the card's last attempt. It is read from the card, so it
// survives a restart, and the one attempt that starts after it spends it. The
// assistant's own record of an answer given on another card routes nothing,
// exactly as it re-arms nothing.
function heavyRetryPending(task) {
  const since = Number(task?.lastAttempt?.startedAt ?? task?.lastAttempt?.at) || 0;
  return (Array.isArray(task?.decisions) ? task.decisions : []).some((row) => row?.choice === "retry-deep" && row.by !== "assistant" && Number(row.at) > since);
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
  } else if (handoff?.kind === "next" && state.handoffs.length < maxHandoffs
      && !state.handoffs.some((item) => item.title === handoff.title && item.prompt === handoff.prompt)) read.handoff = handoff;
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
  promptParts,
  workerPrompt,
  INSTRUCTIONS,
  WINDOWS_SHELL,
  failureBackoffMs,
  startKillCooldownMs,
  providerCooldownMs,
  providerOutage,
  classifyRunEnd,
  attemptLedgerOutcome,
  readableRunError,
  entitlementRefusal,
  refusedRoute,
  routeParkMs,
  refusalWait,
  settleAttemptRow,
  releaseInboxCopies,
  saidLine,
  lastWords,
  attemptStartRecord,
  finishLogRecord,
  attemptFinishRecord,
  attemptRecord,
  startBudgetMs,
  shellLaunch,
  cliInvocation,
  heavyRetryPending,
  readWorkerLine,
  applyWorkerLine,
};
