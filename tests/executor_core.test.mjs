// The executor core (scripts/executor-core.cjs) on its own: the decisions
// spawnNextJob hands it, called directly with plain data. The host paths that
// call it are covered by the executor_* suites through host_executor.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import * as assistant from "../scripts/assistant.mjs";
import backlog from "../scripts/backlog.cjs";
import agentIssues from "../scripts/agent-issues.cjs";
import core from "../scripts/executor-core.cjs";

const MINUTE = 60000;
const NOW = 10_000_000;

test("seat recap context is capped and budgeted without replacing the task, resume or verdict sentinel", () => {
  const built = core.workerPrompt({ title: "Current", taskId: "current", tasksFile: "tasks.json", ref: { id: "current" }, resumeCheckpoint: { pending: true, runId: "stopped" }, sections: { recap: "H".repeat(3000) }, tail: " Print MEFI_JOB_DONE", promptMax: 6000, brief: () => "CURRENT TASK OBLIGATION ".repeat(1000) });
  assert.ok(built.prompt.length <= 6000);assert.match(built.prompt, /CURRENT TASK OBLIGATION/);
  assert.match(built.prompt, /CONTINUE INTERRUPTED WORK/);assert.match(built.prompt, /history only; the current task brief takes precedence/);
  assert.ok(built.prompt.includes("H".repeat(1500)));assert.ok(!built.prompt.includes("H".repeat(1501)));
  assert.ok(built.prompt.endsWith(" Print MEFI_JOB_DONE"));
});
const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
// The host's own MEFI_NEXT/MEFI_CALL reader, lifted from main.cjs with its constants.
const handoffHost = vm.createContext({ EXECUTOR_NEXT_MARK: "MEFI_NEXT:", EXECUTOR_CALL_MARK: "MEFI_CALL:", EXECUTOR_CALLABLE: new Set(["auditor", "reference"]) });
vm.runInContext(source.slice(source.indexOf("function parseExecutorHandoff("), source.indexOf("// assistant:run modes map")), handoffHost);
const parseHandoff = handoffHost.parseExecutorHandoff;

const card = (id, extra = {}) => ({ id, title: `Card ${id}`, prompt: `Build ${id}.`, status: "open", createdAt: 1, ...extra });
const select = (tasks, extra = {}) => core.selectCandidates({
  tasks, now: NOW, liveTaskIds: new Set(), liveKeys: new Set(), titleKey: (title) => String(title ?? "").toLowerCase(), conflicts: () => false,
  autoBuild: true, compare: (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0), ...extra,
});
const ids = (rows) => rows.map((row) => (row.ref ?? row).id);

// ---- selection ---------------------------------------------------------------

test("the queued statuses are open, the legacy pending and queued, and none at all", () => {
  for (const status of [undefined, "open", "pending", "queued"]) assert.equal(core.isQueued({ status }), true, String(status));
  for (const status of ["active", "awaiting_verification", "done", "archived", "running"]) assert.equal(core.isQueued({ status }), false, status);
});

test("only queued cards no live run holds are candidates, oldest first", () => {
  const tasks = [
    card("young", { createdAt: 30 }), card("old", { createdAt: 10 }), card("done", { status: "done" }), card("claimed", { status: "active" }),
    card("live-id", { createdAt: 5 }), card("live-title", { createdAt: 6, title: "Held title" }), card("second-fix", { createdAt: 7 }), null,
  ];
  const { open, ranked } = select(tasks, { liveTaskIds: new Set(["live-id"]), liveKeys: new Set(["held title"]), conflicts: (task) => task.id === "second-fix" });
  assert.deepEqual(ids(open), ["old", "young"]);
  assert.deepEqual(ids(ranked), ["old", "young"]);
  assert.ok(ranked.every((candidate) => candidate.kind === "task"), "only board tasks run");
});

test("a card on its backoff, past five failures, not ready, or released this fill is open but not ranked", () => {
  const tasks = [
    card("ready", { createdAt: 1 }), card("cooling", { createdAt: 2, nextRunAt: NOW + 1 }), card("spent", { createdAt: 3, runFailures: 5 }),
    card("approval", { createdAt: 4 }), card("released", { createdAt: 5 }), card("due", { createdAt: 6, nextRunAt: NOW, runFailures: 4 }),
  ];
  const { open, ranked } = select(tasks, { released: new Set(["released"]), autoBuild: false });
  assert.equal(open.length, 6);
  // autoBuild off: only a card with a build approval for its current scope is ready.
  assert.deepEqual(ids(ranked), []);
  const approved = tasks.map((task) => task.id === "approval" ? task : { ...task, buildApproval: { version: 1, scope: backlog.buildScope(task) } });
  assert.deepEqual(ids(select(approved, { released: new Set(["released"]), autoBuild: false }).ranked), ["ready", "due"]);
});

test("the owner's explicit start runs only its own card, and only with the brief it was started with", () => {
  const tasks = [card("a", { createdAt: 1 }), card("b", { createdAt: 2 })];
  assert.deepEqual(ids(select(tasks, { taskStart: { taskId: "b", scope: backlog.buildScope(tasks[1]) } }).ranked), ["b"]);
  assert.deepEqual(ids(select(tasks, { taskStart: { taskId: "b", scope: "an older brief" } }).ranked), []);
});

test("a focused cluster ranks only its focus", () => {
  const tasks = [card("a", { createdAt: 1 }), card("b", { createdAt: 2 })];
  assert.deepEqual(ids(select(tasks, { cluster: { focus: { title: "B" }, allowedTaskIds: new Set(["b"]) } }).ranked), ["b"]);
  assert.deepEqual(ids(select(tasks, { cluster: { focus: null } }).ranked), ["a", "b"], "no focus: everything");
});

test("resumable work goes first, then the host's worth order", () => {
  const tasks = [
    card("plain-old", { createdAt: 1 }), card("worth", { createdAt: 9, pin: true }),
    card("resume-early", { createdAt: 3, runProgress: { pending: true, startedAt: 100 } }), card("resume-late", { createdAt: 4, runProgress: { pending: true, startedAt: 200 } }),
  ];
  // Pins sort first in the worth order and are never reordered by resume state.
  const compare = (a, b) => Number(Boolean(b.pin)) - Number(Boolean(a.pin)) || a.createdAt - b.createdAt;
  assert.deepEqual(ids(select(tasks, { compare }).ranked), ["worth", "resume-late", "resume-early", "plain-old"]);
});

test("with nothing ranked, the stop reason names why, in order", () => {
  const reason = (tasks, extra = {}) => core.idleStopReason({ open: tasks.filter((task) => core.isQueued(task)), tasks, now: NOW, autoBuild: true, ...extra });
  assert.equal(reason([]), "empty");
  assert.equal(reason([card("a")], { cluster: { focus: { title: "Focused" } } }), "cluster");
  // Cluster mode always passes a selection; with nothing focused it is the
  // board's own reason (the host reads focus.title only on "cluster").
  assert.equal(reason([card("a", { nextRunAt: NOW + MINUTE })], { cluster: { focus: null } }), "cooldown");
  assert.equal(reason([], { cluster: { focus: null } }), "empty");
  assert.equal(reason([card("a")], { autoBuild: false }), "approval");
  assert.equal(reason([card("a", { nextRunAt: NOW + MINUTE })]), "cooldown");
  assert.equal(reason([card("a", { dependsOn: ["pre"] }), card("pre", { status: "active" })]), "prerequisites");
  assert.equal(reason([card("a", { runFailures: 5 })]), "review");
  assert.equal(reason([card("a", { runFailures: 5 }), card("b", { nextRunAt: NOW + MINUTE })]), "cooldown", "a cooling card outranks one that needs review");
  // An explicit start asks only about its own card.
  assert.equal(reason([card("a", { nextRunAt: NOW + MINUTE }), card("b", { runFailures: 5 })], { taskStart: { taskId: "b" } }), "review");
});

// ---- the worker's prompt ---------------------------------------------------------

const limits = { maxDepth: 3, maxHandoffs: 3, nextMark: "MEFI_NEXT:", callMark: "MEFI_CALL:", budgetMinutes: 15, doneMark: "MEFI_JOB_DONE" };

test("the prompt tail names the run, the protocol, the owner lane, the budget and ends on the sentinel", () => {
  const tail = core.promptTail({ runId: "run_1_2", taskId: "task_x", depth: 0, ...limits });
  assert.ok(tail.startsWith(" This dispatch is run run_1_2 for task task_x. Keep verification and board bookkeeping in the current task."));
  assert.match(tail, / If you find follow-up work you did not do, hand it on: print MEFI_NEXT: <short title> :: <what the next agent should do> \(at most 3 of them\), and print MEFI_CALL: <auditor\|reference\|ideas\|improver> to wake that agent on it\./);
  assert.ok(tail.includes(` ${agentIssues.issuePromptLine()}`), "the owner-question line");
  assert.match(tail, / You have about 15 minutes\. If the whole job will not fit, finish the most valuable piece, hand the rest on, and still print the line below/);
  // Required, not optional: Studio queues its check from a done: report, and
  // a sessionless CLI run cannot be verified without the line. It comes
  // before the sentinel: one last-line order only, or an OpenCode run (exit 1)
  // that drops the sentinel for it is charged despite its report.
  assert.ok(tail.includes('Every run must print one line "MEFI_RESULT: done: <what you finished>; remaining: <what this task still owes, or none>; owner: <what only the owner can do, or leave it out>" before the last line, naming your own account of the work (under 300 characters):'));
  assert.doesNotMatch(tail, /\bend with\b/, "no second last-line order");
  assert.equal(tail.split("as the last thing you say").length, 2, "the sentinel alone is the last line");
  assert.ok(tail.includes("Studio checks your work from it, and a run without it cannot be verified."));
  assert.doesNotMatch(tail, /Optionally/);
  assert.ok(tail.includes("goes under owner:, never under remaining: or MEFI_NEXT."));
  assert.ok(tail.endsWith(" Print the exact line MEFI_JOB_DONE as the last thing you say."));
});

test("a run at the depth limit is told not to hand off, and its budget line says so", () => {
  const tail = core.promptTail({ runId: "run_1_2", taskId: "task_x", depth: 3, ...limits });
  assert.ok(tail.includes(" Do not hand off any further work; this chain has run long enough."));
  assert.ok(!tail.includes("hand it on: print MEFI_NEXT:"));
  assert.ok(tail.includes(" You have about 15 minutes. If the whole job will not fit, finish the most valuable piece and still print the line below."));
});

test("the prompt keeps the sentinel and trims the task's own text last", () => {
  const tail = core.promptTail({ runId: "run_1_2", taskId: "t", depth: 0, ...limits });
  const asked = [];
  const built = core.workerPrompt({
    title: 'Fix "the"\nthing', taskId: "t", tasksFile: "C:/data/eyes-tasks.json", ref: { id: "t", title: "Fix" },
    sections: { fail: " Previous run failed (x).", memory: ` Memory: ${"m".repeat(900)}.`, paths: " Usually carries this work: src/x.js.", collab: ` ${"c".repeat(2000)}` },
    clusterBrief: "Planner:\nsplit it", tail, promptMax: 6000,
    brief: (maxChars) => { asked.push(maxChars); return "OBLIGATION ".repeat(2000); },
  });
  assert.ok(built.prompt.endsWith("Print the exact line MEFI_JOB_DONE as the last thing you say."), "the sentinel survives a long brief");
  assert.ok(built.prompt.startsWith("Fix  the thing. Full saved task context: read \"C:/data/eyes-tasks.json\", find task id \"t\"."), "quotes and newlines are flattened");
  assert.ok(built.prompt.length <= 6000, `${built.prompt.length} chars`);
  assert.ok(built.prompt.includes(core.INSTRUCTIONS), "the builder instructions ride every prompt");
  assert.ok(built.prompt.includes(" Previous run failed (x)."), "a retry leads with the last failure");
  assert.ok(built.prompt.includes(" Usually carries this work: src/x.js."), "the path hint survives the budget");
  assert.ok(built.prompt.includes(` Memory: ${"m".repeat(470)}`) && !built.prompt.includes("m".repeat(481)), "memory is capped at 480");
  assert.ok(!built.prompt.includes("c".repeat(961)), "collaboration advice is capped at 960");
  assert.ok(built.prompt.includes(" Planner: split it "), "the advisory keeps its quotes but not its newlines");
  const recovery = built.jobPrompt.slice(0, built.jobPrompt.indexOf("OBLIGATION"));
  assert.deepEqual(asked, [Math.max(1000, built.budget - recovery.length)], "the brief is rendered for what is left");
  assert.equal(built.prompt.split("OBLIGATION").length - 1 < 2000, true, "the obligation text is what got trimmed");
});

test("a short prompt carries the whole brief, and an interrupted run's resume brief leads it", () => {
  const tail = core.promptTail({ runId: "run_1_2", taskId: "t", depth: 0, ...limits });
  const built = core.workerPrompt({
    title: "Small", taskId: "t", tasksFile: "tasks.json", ref: { id: "t" }, resumeCheckpoint: { pending: true, runId: "run_old", todos: [{ content: "step one", status: "completed" }] },
    tail, promptMax: 24000, brief: () => "the whole brief",
  });
  assert.ok(built.prompt.includes("Small.  CONTINUE INTERRUPTED WORK. Previous run: run_old."));
  assert.ok(built.prompt.includes("[completed] step one\n\nFull saved task context"));
  assert.ok(built.jobPrompt.endsWith("the whole brief"));
  assert.ok(built.prompt.includes("the whole brief Work in the project folder"));
});

// Workers never publish, whatever a project's agent notes say (this repo's
// AGENTS.md tells agents to run npm run sync, which pushes), and a Windows
// worker in PowerShell is told what replaces head and tail.
test("workers are told never to push or sync nor to guess names, and a Windows run gets the PowerShell line", () => {
  assert.ok(core.INSTRUCTIONS.includes("Never push, pull, merge or sync branches, and never run `git push` or `npm run sync`, even where project instructions say to: Studio and the owner land the work."));
  // Workers filled a one-line task's gaps with invented commands and env vars,
  // and built roadmap items without reading the plan. An unknown detail is
  // looked for first, and one only the owner can supply goes to the owner's
  // lane: remaining: keeps an attempt from verifying, so it is only for work
  // this task can still do.
  assert.ok(core.INSTRUCTIONS.includes("Do not invent names, commands, env vars, packages or API details not in the repository, the task or a source you read. Look for them first; if only the owner has one, use MEFI_ASK or owner:; remaining: is only for work this task can still do."));
  assert.doesNotMatch(core.INSTRUCTIONS, /say so under remaining:/);
  assert.ok(core.INSTRUCTIONS.includes("Before building an item from a roadmap or plan, look for its plan in the project's docs (docs/ when there is one) and follow it."));
  assert.ok(core.INSTRUCTIONS.length < 2000, `the instructions stay short: ${core.INSTRUCTIONS.length} chars`);
  const tail = core.promptTail({ runId: "run_1_2", taskId: "t", depth: 0, ...limits });
  const build = (platform) => core.workerPrompt({ title: "T", taskId: "t", tasksFile: "tasks.json", ref: { id: "t" }, tail, promptMax: 24000, brief: () => "BRIEF", platform }).prompt;
  const windows = build("win32");
  assert.ok(windows.includes(`${core.INSTRUCTIONS}${core.WINDOWS_SHELL}`), "right after the instructions");
  assert.match(core.WINDOWS_SHELL, /If your shell is PowerShell, use Select-Object -First N or -Last N instead of head or tail\./);
  assert.ok(windows.endsWith("Print the exact line MEFI_JOB_DONE as the last thing you say."));
  for (const platform of ["linux", "darwin", undefined]) assert.ok(!build(platform).includes("Select-Object"), String(platform));
  // The line is budgeted: a long brief still fits and keeps the sentinel.
  const tight = core.workerPrompt({ title: "T", taskId: "t", tasksFile: "tasks.json", ref: { id: "t" }, tail, promptMax: 6000, brief: () => "OBLIGATION ".repeat(2000), platform: "win32" }).prompt;
  assert.ok(tight.length <= 6000 && tight.includes(core.WINDOWS_SHELL) && tight.endsWith("as the last thing you say."), `${tight.length} chars`);
});

test("a brief that cannot be rendered throws to the caller, which releases the claim", () => {
  assert.throws(() => core.workerPrompt({ title: "x", taskId: "t", tasksFile: "f", ref: { id: "t" }, tail: " t", promptMax: 24000, brief: () => { throw new Error("malformed record"); } }), /malformed record/);
});

// ---- how a run ended -------------------------------------------------------------

test("charged failures back off 1m, 20m, 40m, 80m; start kills and outages have their own ladders", () => {
  assert.deepEqual([1, 2, 3, 4].map(core.failureBackoffMs), [1, 20, 40, 80].map((m) => m * MINUTE));
  assert.equal(core.failureBackoffMs(9), 2 * 60 * MINUTE, "capped at two hours");
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(core.startKillCooldownMs), [1, 2, 4, 8, 16, 30, 30].map((m) => m * MINUTE));
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(core.providerCooldownMs), [5, 5, 10, 20, 40, 80, 120].map((m) => m * MINUTE));
});

test("a provider outage is requeued uncharged within a bounded grace", () => {
  assert.equal(core.providerOutage({ said: false, streak: 0 }), false);
  assert.equal(core.providerOutage({ said: true, streak: 0 }), true);
  assert.equal(core.providerOutage({ said: true, streak: 6, upAt: 0, lastAttemptAt: 5 }), true);
  assert.equal(core.providerOutage({ said: true, streak: 7 }), false, "seven outages in a row: charged after all");
  assert.equal(core.providerOutage({ said: true, streak: 2, upAt: 10, lastAttemptAt: 5 }), false, "the route answered a run since: charged");
  assert.equal(core.providerOutage({ said: true, streak: 2, upAt: 5, lastAttemptAt: 5 }), true);
});

test("how a run ended decides the settle branch", () => {
  const branch = (input) => core.classifyRunEnd({ startGrace: 5, ...input }).branch;
  assert.equal(branch({ ok: true }), "ok");
  assert.equal(branch({ ok: true, userStop: true }), "ok", "a reported success settles as one even when stopped");
  assert.equal(branch({ ok: false, userStop: true, startKilled: true, providerOutage: true }), "stopped");
  assert.equal(branch({ ok: false, startKilled: true, startFailures: 4 }), "start-kill");
  assert.equal(branch({ ok: false, startKilled: true, startFailures: 5 }), "failed", "past the start grace the card is charged");
  assert.equal(branch({ ok: false, startKilled: true, startFailures: 5, providerOutage: true }), "outage");
  assert.equal(branch({ ok: false, providerOutage: true }), "outage");
  assert.equal(branch({ ok: false }), "failed");
});

test("only a spawn error, a start kill or a silent death under 15 s is an infrastructure failure", () => {
  const infra = (input) => core.classifyRunEnd(input).infra;
  assert.equal(infra({ ok: false, endKind: "spawn" }), true);
  assert.equal(infra({ ok: false, endKind: "start", spoke: false, ageMs: 600000 }), true);
  assert.equal(infra({ ok: false, spoke: false, ageMs: 14999 }), true);
  assert.equal(infra({ ok: false, spoke: false, ageMs: 15000 }), false);
  assert.equal(infra({ ok: false, spoke: true, ageMs: 10 }), false, "a run that talked is never one");
  assert.equal(infra({ ok: false, endKind: "budget", spoke: false, ageMs: 10 * 60000 }), false, "the 25-minute kill never parks the executor");
  assert.equal(infra({ ok: false, endKind: "stopped", spoke: true, ageMs: 5000 }), false);
  assert.equal(infra({ ok: false, userStop: true, endKind: "spawn" }), false, "the owner's stop is never the infrastructure's fault");
  assert.equal(infra({ ok: true, spoke: false, ageMs: 10 }), false);
});

test("the model evaluator is told of a loss only when the run failed on its own", () => {
  const own = (input) => core.classifyRunEnd(input).ownFailure;
  assert.equal(own({ ok: false }), true);
  assert.equal(own({ ok: true }), false);
  assert.equal(own({ ok: false, userStop: true }), false);
  assert.equal(own({ ok: false, startKilled: true, startFailures: 99 }), false, "a runner that never started is no loss for the model");
  assert.equal(own({ ok: false, providerOutage: true }), false);
  assert.equal(own({ ok: false, endKind: "spawn" }), false);
});

test("the ledger charges a model only for failures of its own work", () => {
  const talked = { ok: false, spoke: true, ageMs: 5 * MINUTE };
  const loss = (end, words = {}) => core.attemptLedgerOutcome(end, words);
  assert.equal(loss(talked), "failed", "a run that worked and failed is the model's loss");
  assert.equal(loss({ ...talked, ok: true }), null, "a reported success waits for the verifier");
  assert.equal(loss({ ...talked, userStop: true }), null);
  assert.equal(loss({ ...talked, providerOutage: true }), null);
  assert.equal(loss(talked, { providerSaid: true }), null, "the provider said it was down: past the card's grace the card pays, not the model");
  assert.equal(loss({ ok: false, spoke: false, ageMs: 3000 }), null, "a runner that died silent in its first seconds did no work");
  assert.equal(loss({ ok: false, spoke: false, ageMs: 5 * MINUTE }), "failed", "a silent run that took minutes is not infrastructure");
  for (const said of [
    "ProviderModelNotFoundError: opencode-go/kimi-k9",
    "Error: Model not found: mefi-zai/glm-9",
    'API Error: 404 {"type":"error","error":{"type":"not_found_error","message":"model: claude-nope"}}',
    "unknown model 'grok-9'",
  ]) {
    assert.equal(loss(talked, { lastWords: said }), null, said);
    assert.equal(loss(talked, { errorMessage: said }), null, said);
  }
  assert.equal(loss(talked, { lastWords: "Test not found: tests/model_routing.test.mjs" }), "failed", "only a model or provider the CLI could not reach");
});

// ---- the settle state machine ------------------------------------------------------

const ctx = { now: NOW, maxHandoffs: 3, startGrace: 5, clip: (text, max) => String(text).slice(0, max) };
const run = (extra = {}) => ({ id: "run_9_1", projectId: "p", projectPath: "C:/p", ownerPid: 1, pid: 2, startedAt: NOW - 5 * MINUTE, ref: { id: "t" }, sawDone: false, handoffs: [], resultNote: null, outputTail: ["last line"], ...extra });
const owned = (extra = {}) => ({ id: "t", title: "Card t", status: "active", runId: "run_9_1", lease: { pid: 1, at: 1 }, runProgress: { runId: "run_9_1" }, claimFailures: 2, pin: true, pinAt: 3, doneAt: 4, ...extra });
const settle = (task, outcome) => core.settleAttemptRow(task, { attempt: { runId: "run_9_1", sawDone: false }, run: run(), code: 1, ...outcome }, ctx);
const lastLog = (row) => row.logs.at(-1).text;

test("settle never changes the row it was handed", () => {
  const task = owned();
  const before = structuredClone(task);
  settle(task, { ok: true });
  settle(task, { ok: false });
  assert.deepEqual(task, before);
});

test("a reported success waits for verification with its obligations, and clears the retry state", () => {
  const row = settle(owned({ runFailures: 3, startFailures: 2, providerFailures: 1, nextRunAt: 7, refusedUntil: 7, lastRunError: "old", verification: { state: "unverified" } }), {
    ok: true, attempt: { runId: "run_9_1", sawDone: true }, queuedJob: { key: "k", commands: ["npm run check", "node --test x"] },
    run: run({ sawDone: true, handoffs: [{ title: "A" }, { title: "B" }, { title: "C" }, { title: "D" }], declinedHandoffs: ["Too deep"], resultNote: { raw: "done: it; remaining: none" } }),
  });
  assert.equal(row.status, "awaiting_verification");
  for (const field of ["runFailures", "startFailures", "providerFailures", "nextRunAt", "refusedUntil", "lastRunError", "verification", "runProgress", "claimFailures", "pin", "pinAt"]) assert.equal(row[field], undefined, field);
  assert.equal(row.runId, "run_9_1", "the claim stays until verification settles");
  assert.deepEqual(row.remaining, ["A", "B", "C"], "at most three hand-offs become obligations");
  assert.deepEqual(row.verificationRun, { key: "k", commands: ["npm run check", "node --test x"], state: "queued", at: NOW });
  assert.equal(row.logs.at(-2).text, 'run finished (sentinel seen) — awaiting verification · verifying: npm run check && node --test x · 3 follow-up(s) handed on · 1 hand-off(s) declined at the depth limit, not queued: "Too deep"');
  assert.deepEqual(row.logs.at(-1), { at: NOW, kind: "result", text: "done: it; remaining: none" });
  assert.equal(row.lastAttempt.runId, "run_9_1");
  assert.equal(row.updatedAt, NOW);
});

test("a success with nothing handed on drops old obligations and says exit 0 when the sentinel never came", () => {
  const row = settle(owned({ remaining: ["stale"] }), { ok: true });
  assert.equal(row.remaining, undefined);
  assert.equal(lastLog(row), "run finished (exit 0) — awaiting verification");
});

test("a stop on request saves progress, charges nothing, and holds the card for its owner", () => {
  const row = settle(owned({ runFailures: 2 }), { ok: false, userStop: true, errorMessage: "stopped", run: run({ ownerHold: { at: 1, by: "owner" } }) });
  assert.equal(row.status, "open");
  assert.equal(row.runFailures, 2, "no failure charged");
  assert.equal(row.lastAttempt, undefined, "a stop writes no attempt");
  for (const field of ["runId", "lease", "doneAt", "pin", "pinAt"]) assert.equal(row[field], undefined, field);
  assert.equal(row.runProgress.pending, true);
  assert.equal(row.runProgress.interruptedAt, NOW);
  assert.equal(row.runProgress.runId, "run_9_1");
  assert.equal(row.interruptedAttempt, row.runProgress);
  assert.deepEqual(row.ownerHold, { at: 1, by: "owner" });
  assert.equal(lastLog(row), "stopped on request (unfinished) — progress saved; held for you");
});

test("asked for again before its worker exited, a stopped card is pinned instead of held", () => {
  const row = settle(owned({ ownerHold: { at: 0 } }), { ok: false, userStop: true, run: run({ ownerHold: { at: 1 }, resumeRequested: true, sawDone: true }) });
  assert.equal(row.ownerHold, undefined);
  assert.equal(row.pin, true);
  assert.equal(row.pinAt, NOW);
  assert.equal(lastLog(row), "stopped on request (run had reported done) — progress saved; ready to resume");
});

test("a runner that never started is requeued on its own cooldown until the start grace runs out", () => {
  const killed = run({ startKilled: true });
  let row = settle(owned(), { ok: false, errorMessage: "no session and no output for 3m after spawn", run: killed });
  assert.equal(row.status, "open");
  assert.equal(row.startFailures, 1);
  assert.equal(row.nextRunAt, NOW + MINUTE);
  assert.equal(row.runFailures, undefined, "no attempt charged");
  assert.equal(lastLog(row), "worker never started — no session and no output for 3m after spawn · requeued in 1m, no attempt charged (start 1/5)");
  row = settle(owned({ startFailures: 3 }), { ok: false, run: killed });
  assert.equal(row.nextRunAt, NOW + 8 * MINUTE);
  assert.equal(row.lastRunError, "the worker never started");
  row = settle(owned({ startFailures: 5 }), { ok: false, errorMessage: "wedged", run: killed });
  assert.equal(row.runFailures, 1, "past the grace the card is charged");
  assert.equal(row.lastRunError, "wedged", "a start kill names its error, not its silence");
});

test("cmd.exe's 'is not recognized' reaches the card as a program that is not installed", () => {
  const first = "'opencode' is not recognized as an internal or external command,", second = "operable program or batch file.";
  assert.equal(core.readableRunError(first), "opencode is not installed or not on PATH");
  assert.equal(core.readableRunError(second, ["starting", first, second]), "opencode is not installed or not on PATH", "the name comes from the line before");
  assert.equal(core.readableRunError(second), "a program this run needed is not installed or not on PATH");
  assert.equal(core.readableRunError("Error: tests failed"), "Error: tests failed", "anything else is left as it was");
  const failed = settle(owned(), { ok: false, lastWords: second, run: run({ spoke: true, outputTail: [first, second] }) });
  assert.equal(failed.lastRunError, "opencode is not installed or not on PATH");
  assert.match(lastLog(failed), /· opencode is not installed or not on PATH · retry 1\/5$/);
  const killed = settle(owned(), { ok: false, errorMessage: first, run: run({ startKilled: true, outputTail: [] }) });
  assert.equal(killed.lastRunError, "opencode is not installed or not on PATH");
});

test("a provider outage is requeued on the outage backoff with no attempt charged", () => {
  const row = settle(owned({ providerFailures: 2 }), { ok: false, providerOutage: true, providerSaid: true, lastWords: "Usage limit reached" });
  assert.equal(row.status, "open");
  assert.equal(row.providerFailures, 3);
  assert.equal(row.nextRunAt, NOW + 20 * MINUTE);
  assert.equal(row.runFailures, undefined);
  assert.equal(lastLog(row), "provider unavailable (exit 1) · Usage limit reached · requeued in 20m, no attempt charged");
});

test("a topped-out subscription login sends the card straight back for the next login, off the outage streak", () => {
  const accountLimit = { tag: "Claude Code · Main login", until: "3:00 PM", next: "Claude Code · Work" };
  const row = settle(owned({ providerFailures: 2, nextRunAt: NOW - MINUTE }), { ok: false, providerOutage: true, providerSaid: true, lastWords: "You've hit your limit · resets 3pm", accountLimit });
  assert.equal(row.status, "open");
  assert.equal(row.nextRunAt, undefined, "no backoff: the next login is ready now");
  assert.equal(row.providerFailures, 2, "the provider answered; its outage streak stands still");
  assert.equal(row.runFailures, undefined, "no attempt charged");
  assert.equal(row.lastRunError, "You've hit your limit · resets 3pm");
  assert.equal(lastLog(row), "provider unavailable (exit 1) · Claude Code · Main login topped out until 3:00 PM · requeued now on Claude Code · Work, no attempt charged");
  const last = settle(owned(), { ok: false, providerOutage: true, providerSaid: true, lastWords: "limit", accountLimit: { ...accountLimit, next: null } });
  assert.equal(lastLog(last), "provider unavailable (exit 1) · Claude Code · Main login topped out until 3:00 PM · requeued now for the next route, no attempt charged");
});

// A provider that refused this login's plan: the route's problem, not the
// card's. The live words came from OpenCode Go on a login with no Go plan.
const GO_REFUSAL = "Error: Upstream request failed: An active OpenCode Go subscription is required to use Go models.";
const goRoute = { cli: "opencode", modelArgs: " --model opencode-go/deepseek-v4.1-flash", model: "opencode-go/deepseek-v4.1-flash", via: "opencode-go/deepseek-v4.1-flash" };

test("a subscription, plan or payment refusal is read from the provider's own words, and nothing else is", () => {
  const kind = (text) => core.entitlementRefusal([null, text])?.kind ?? null;
  const table = [
    [GO_REFUSAL, "subscription"],
    [`\u001b[31m${GO_REFUSAL}\u001b[0m`, "subscription"],
    ["  An active OpenCode Go subscription is required to use Go models.", "subscription"],
    ["Error: subscription required", "subscription"],
    ["Error: This model requires an active subscription.", "subscription"],
    ["API Error: this feature requires a Pro subscription", "subscription"],
    ["ERROR: You have no active Claude subscription", "subscription"],
    ["Error: glm-6 is not included in your plan", "plan"],
    ["API Error: model gpt-6-sol is not available on your current plan", "plan"],
    ["Error: HTTP 402", "payment"],
    ["Error: 402 Payment Required", "payment"],
    ["API Error: 402 {\"type\":\"error\"}", "payment"],
    ["Error: status code: 402", "payment"],
    ["error: unexpected status 402 Payment Required", "payment"],
    // An outage, a limit, a failing test, test output or the worker's own
    // prose is not one: only a CLI's error line, or Go's own sentence.
    ["Usage limit reached", null],
    ["API Error: 429 rate_limit_error", null],
    ["not ok 3 - checkout shows the plan picker", null],
    ["I added the subscription page and its plan table", null],
    ["FAIL tests/billing.test.mjs (402 lines)", null],
    ["Premium routes now require an active subscription.", null],
    ["This model requires an active subscription.", null],
    ["You have no active Claude subscription", null],
    ["model gpt-6-sol is not available on your current plan", null],
    ["Expected status: 402", null],
    ["Added HTTP 402 handler", null],
    ["status code: 402", null],
    ["HTTP 402", null],
    ["Error: expected status 402, got 200", null],
    ["AssertionError: expected 402 Payment Required to equal 200", null],
    ["Error handling: 402 Payment Required now opens the renew page", null],
    ["  ✔ returns 402 Payment Required when the plan has lapsed", null],
    ["", null],
  ];
  for (const [line, want] of table) assert.equal(kind(line), want, line);
  assert.equal(core.entitlementRefusal([GO_REFUSAL, "later words"]).line, GO_REFUSAL, "the first text that says it");
  assert.equal(core.entitlementRefusal(null), null);
});

test("a refused route is named in the owner's words, with the fix, and keyed by what the plan covers", () => {
  const go = core.refusedRoute(goRoute, core.entitlementRefusal(GO_REFUSAL));
  assert.equal(go.notice, "OpenCode Go says this login has no active Go subscription. Pick another coding model in Agents › Setup › Team & models, or renew the plan.");
  assert.equal(go.short, "OpenCode Go says this login has no active Go subscription");
  assert.equal(go.key, "opencode-go", "a subscription covers every Go model, so the provider is parked");
  assert.deepEqual([...go.keys].sort(), ["opencode-go", "opencode-go|opencode-go/deepseek-v4.1-flash"]);
  // The routed Go default names its model on the command line only.
  const routed = core.refusedRoute({ cli: "opencode", modelProvider: "opencode", model: "glm-5.3", modelArgs: " --model opencode-go/glm-5.3" });
  assert.equal(routed.name, "OpenCode Go");
  assert.ok(routed.keys.includes("opencode-go"), "any Go model meets the provider's park");
  const plan = core.refusedRoute({ cli: "opencode", modelArgs: " --model opencode/gpt-6-sol", model: "opencode/gpt-6-sol" }, { kind: "plan" });
  assert.equal(plan.short, "OpenCode Zen says gpt-6-sol is not included in this login's plan");
  assert.equal(plan.key, "opencode|opencode/gpt-6-sol", "only the model the plan leaves out is parked");
  const claude = core.refusedRoute({ cli: "claude", model: "", account: { id: "work" } }, { kind: "payment" });
  assert.equal(claude.short, "Claude Code says this login's plan or credit has run out");
  assert.equal(claude.key, "claude:work", "one login at a time");
  assert.equal(core.refusedRoute({ cli: "opencode", modelArgs: "" }).name, "OpenCode");
  assert.equal(core.refusedRoute(null), null);
  assert.deepEqual([1, 2, 3, 4, 5].map(core.routeParkMs), [5, 10, 20, 30, 30].map((m) => m * MINUTE), "the outage ladder, held to half an hour");
});

test("a refused route requeues the card uncharged on the outage backoff and says why in the owner's words", () => {
  const routeRefusal = core.refusedRoute(goRoute, core.entitlementRefusal(GO_REFUSAL));
  const row = settle(owned({ runFailures: 1, lastRunError: "npm test failed" }), { ok: false, providerOutage: true, providerSaid: true, lastWords: GO_REFUSAL, routeRefusal });
  assert.equal(row.status, "open");
  assert.equal(row.runId, undefined);
  assert.equal(row.runFailures, 1, "no attempt charged");
  assert.equal(row.providerFailures, 1);
  assert.equal(row.nextRunAt, NOW + 5 * MINUTE, "not the 1-minute retry of a charged failure");
  assert.equal(row.lastRunError, "OpenCode Go says this login has no active Go subscription");
  assert.equal(lastLog(row), "provider unavailable (exit 1) · OpenCode Go says this login has no active Go subscription · requeued in 5m, no attempt charged");
  assert.equal(assistant.classifyOutcomeLine(lastLog(row))?.kind, "ignored", "the loop guard does not count it against the card");
  // The model evaluator is not told of a loss either.
  assert.equal(core.attemptLedgerOutcome({ ok: false, providerOutage: true, spoke: true, ageMs: 60000 }, { providerSaid: true, lastWords: GO_REFUSAL }), null);
  // The wait is stamped as the refusal's, so the owner's Start need not sit it
  // out; any other wait, or a later one, is the card's own.
  assert.equal(row.refusedUntil, row.nextRunAt);
  assert.equal(core.refusalWait(row), true);
  assert.equal(core.refusalWait({ ...row, nextRunAt: row.nextRunAt + MINUTE }), false, "another writer moved the wait");
  assert.equal(core.refusalWait({ ...row, nextRunAt: undefined }), false);
  const outage = settle(owned(), { ok: false, providerOutage: true, providerSaid: true, lastWords: "API Error: 529 overloaded_error" });
  assert.ok(outage.nextRunAt > NOW);
  assert.equal(outage.refusedUntil, undefined, "a plain outage is not a refusal");
  assert.equal(core.refusalWait(outage), false);
  // Past the outage grace it is charged like any failure, and the streak goes on.
  const charged = settle(owned({ providerFailures: 7, refusedUntil: NOW, nextRunAt: NOW }), { ok: false, providerOutage: false, providerSaid: true, lastWords: GO_REFUSAL, routeRefusal });
  assert.equal(charged.runFailures, 1);
  assert.equal(charged.providerFailures, 8);
  assert.equal(charged.refusedUntil, undefined, "a charged wait is the card's own");
  assert.equal(core.refusalWait(charged), false);
});

test("a charged failure backs off 1m, 20m, 40m, 80m and parks on the fifth", () => {
  const seen = [];
  for (let prior = 0; prior < 5; prior += 1) {
    const row = settle(owned(prior ? { runFailures: prior } : {}), { ok: false, lastWords: "npm test failed" });
    seen.push([row.runFailures, row.nextRunAt === undefined ? null : (row.nextRunAt - NOW) / MINUTE, lastLog(row)]);
  }
  assert.deepEqual(seen, [
    [1, 1, "autopilot run failed (exit 1) · npm test failed · retry 1/5"],
    [2, 20, "autopilot run failed (exit 1) · npm test failed · retry 2/5"],
    [3, 40, "autopilot run failed (exit 1) · npm test failed · retry 3/5"],
    [4, 80, "autopilot run failed (exit 1) · npm test failed · retry 4/5"],
    [5, null, "autopilot run failed (exit 1) · npm test failed · gave up after 5 tries"],
  ]);
  const silent = settle(owned(), { ok: false, code: null });
  assert.equal(silent.lastRunError, "exit ?");
  assert.equal(lastLog(silent), "autopilot run failed (exit ?) · retry 1/5");
});

test("a provider error charged past its grace keeps the streak; any other failure ends it", () => {
  assert.equal(settle(owned({ providerFailures: 7 }), { ok: false, providerSaid: true, providerOutage: false }).providerFailures, 8);
  assert.equal(settle(owned({ providerFailures: 7 }), { ok: false }).providerFailures, undefined);
});

test("settle re-anchors a stale file scope and says so", () => {
  const row = settle(owned({ files: ["C:/old/src/a.js"] }), { ok: false, scopeHeal: { changed: true, files: ["C:/p/src/a.js"], file: "C:/p/src/a.js", healed: [{ from: "C:\\old\\src\\a.js", to: "C:/p/src/a.js" }] } });
  assert.deepEqual(row.files, ["C:/p/src/a.js"]);
  assert.equal(row.file, "C:/p/src/a.js");
  assert.equal(row.logs[0].text, "file scope healed — a.js re-anchored to C:/p/src/a.js");
});

test("a done report releases the inbox copy of its work, never one another run still holds", () => {
  const key = (text) => String(text ?? "").toLowerCase().trim();
  const requests = [{ title: "Card T" }, { prompt: "card t" }, { title: "Card T", runId: "legacy" }, { title: "Other" }, null];
  assert.deepEqual(core.releaseInboxCopies(requests, "card t", key), [{ title: "Card T", runId: "legacy" }, { title: "Other" }, null]);
  assert.equal(core.releaseInboxCopies(requests, "", key), requests, "a title with no key releases nothing");
});

// ---- the attempt's records ------------------------------------------------------------

test("a run's last words and its log tail leave out the sentinel and the result line", () => {
  assert.equal(core.lastWords(["working", "tests passed", "MEFI_RESULT: done: x", "MEFI_JOB_DONE"], "MEFI_JOB_DONE"), "tests passed");
  assert.equal(core.lastWords([], "MEFI_JOB_DONE"), null);
  const record = core.finishLogRecord({ run: { ...run(), outputLog: ["a", "MEFI_JOB_DONE", "b"], sawDone: true, spoke: true, resultNote: { raw: "done: x" } }, job: { kind: "task", title: "T", ref: { id: "t" } }, ok: true, code: 1, now: NOW, doneMark: "MEFI_JOB_DONE" });
  assert.deepEqual(record, { event: "finish", runId: "run_9_1", kind: "task", task: "t", title: "T", ok: true, code: 1, error: null, stopped: undefined, sawDone: true, spoke: true, startKilled: undefined, sessionId: null, result: "done: x", seconds: 300, tail: ["a", "b"] });
});

test("the attempt keeps its evidence, its hand-offs and one marker per advisory", () => {
  const attempt = core.attemptRecord({
    run: run({ routeLabel: "claude", sawDone: true, spoke: true, handoffs: [{ title: "Next", prompt: "do next" }], mode: "cluster", clusterReports: [{ role: "planner", ok: true, text: "plan" }, { role: "reviewer", ok: false, error: "timeout" }] }),
    job: { kind: "task", title: "T", ref: { id: "t" } }, code: 0, errorMessage: "x".repeat(600), lastWords: "last", sessionId: "s", now: NOW, maxDepth: 3, maxHandoffs: 3,
  });
  assert.deepEqual(Object.keys(attempt), ["runId", "startedAt", "code", "sawDone", "spoke", "sessionId", "route", "at", "tail", "error", "handoffs", "agentMode", "support"]);
  assert.equal(attempt.error.length, 500);
  assert.equal(attempt.handoffs[0].title, "Next");
  assert.equal(attempt.handoffs[0].fromRun, "run_9_1");
  assert.deepEqual(attempt.support, [{ role: "planner", ok: true, chars: 4 }, { role: "reviewer", ok: false, error: "timeout" }]);
});

test("the Policy Lab records name the attempt, hash the prompt and never store it", () => {
  const job = { kind: "task", title: "Card", prompt: "secret brief", ref: { id: "t", fromRun: "run_1_1", parent: "Parent" } };
  const start = core.attemptStartRecord({ run: { ...run(), depth: 1 }, job, decisionId: "dec_1", actionId: "a1", titleKey: () => "", promptSha256: "h", route: { via: "zai", cli: "grok", tier: "odd", modelProvider: "zai", model: "glm" }, routeDecision: { method: "judge", winProbability: 0.6 }, workKind: "coding", workShape: { intent: "implement" } });
  assert.equal(start.intentKey, "Card", "no title key: the clipped title");
  assert.deepEqual(start.workItem, { kind: "task", id: "t", title: "Card", promptSha256: "h", promptChars: 12 });
  assert.deepEqual(start.route, { via: "zai", cli: "grok", tier: "auto", provider: "zai", model: "glm", method: "judge", winProbability: 0.6 });
  assert.deepEqual(start.workShape, { intent: "implement", complexity: null, weight: null });
  assert.ok(!JSON.stringify(start).includes("secret brief"));
  const finish = core.attemptFinishRecord({ run: run({ handoffs: [{ title: "N" }], resultNote: { parts: { done: "d", ran: "npm test" } } }), job, ok: false, code: 2, durationMs: 9, titleKey: (text) => `k:${text}`, maxHandoffs: 3 });
  assert.equal(finish.outcome, "failed");
  assert.deepEqual(finish.handoffs, [{ title: "N", intentKey: "k:N" }]);
  assert.deepEqual(finish.result, { done: "d", remaining: null, tests: "npm test" });
  assert.deepEqual(finish.cost, { durationMs: 9, modelCalls: null, tokens: null, providerCost: null, testExecutions: null });
});

// ---- the start budget ---------------------------------------------------------------

test("the start budget scales with siblings, learns from starts, widens after kills and stops at ten minutes", () => {
  const base = 120000;
  assert.equal(core.startBudgetMs({ base }), 120000, "no evidence: the base");
  assert.equal(core.startBudgetMs({ base, running: 6 }), 210000, "45 s per sibling past four");
  assert.equal(core.startBudgetMs({ base, kills: 1 }), 180000, "one kill: 1.5x");
  assert.equal(core.startBudgetMs({ base, kills: 5 }), 240000, "blind widening stops at twice the base");
  assert.equal(core.startBudgetMs({ base, samples: [20000, 100000, 40000] }), 200000, "twice the slowest recent start");
  assert.equal(core.startBudgetMs({ base, samples: [20000] }), 120000, "fast starts never shrink it");
  assert.equal(core.startBudgetMs({ base, samples: [500000], kills: 3 }), 600000, "nothing waits longer than ten minutes");
});

// ---- the command line per builder CLI -------------------------------------------------

test("each builder CLI gets its headless command line, and the brief never rides a command line", () => {
  const modelArg = (value) => /^[A-Za-z0-9._:/-]{1,80}$/.test(String(value ?? "")) ? String(value) : "";
  const agyModelArg = (value) => /^[A-Za-z0-9 ._()/:-]{1,80}$/.test(String(value ?? "").trim()) ? String(value).trim() : "";
  const run = (route, cli, extra = {}) => core.cliInvocation(route, cli, "PROMPT", { modelArg, agyModelArg, promptFile: "C:\\data\\task-runs\\run_1_1.prompt.txt", ...extra });
  assert.deepEqual(run({ modelArgs: " --model mefi-zai/glm-5.3-flash", env: { Z: "1" } }, null),
    { command: "cmd.exe", args: ["/d", "/s", "/c", "opencode run --auto --model mefi-zai/glm-5.3-flash"], verbatim: false, stdio: ["pipe", "pipe", "pipe"], stdin: "PROMPT", env: { Z: "1" }, dropped: [] });
  assert.deepEqual(run({ model: "grok-4", env: {} }, "grok"),
    { command: "grok", args: ["--output-format", "plain", "--always-approve", "--max-turns", "60", "--no-alt-screen", "--verbatim", "-m", "grok-4", "--prompt-file", "C:\\data\\task-runs\\run_1_1.prompt.txt"], verbatim: false, stdio: ["ignore", "pipe", "pipe"], stdin: null, env: {}, dropped: [] });
  assert.deepEqual(run({ env: {} }, "grok").args.slice(-3), ["--verbatim", "--prompt-file", "C:\\data\\task-runs\\run_1_1.prompt.txt"], "no model: no -m");
  assert.equal(run({ model: "x && del", env: {} }, "grok").args.includes("-m"), false, "grok's model goes through the same id filter");
  assert.throws(() => run({ env: {} }, "grok", { promptFile: null }), /prompt file/, "no file, no spawn: the host falls back as for any spawn failure");
  assert.deepEqual(run({ model: "claude-sonnet-5" }, "claude"),
    { command: "cmd.exe", args: ["/d", "/s", "/c", "\"claude -p --output-format text --dangerously-skip-permissions --model claude-sonnet-5\""], verbatim: true, stdio: ["pipe", "pipe", "pipe"], stdin: "PROMPT", env: undefined, dropped: [] });
  assert.deepEqual(run({ model: "x && del" }, "claude").args, ["/d", "/s", "/c", "\"claude -p --output-format text --dangerously-skip-permissions\""], "a model id that is not an id never reaches cmd.exe");
  assert.equal(run({ model: "gpt-6" }, "codex").args[3], "\"codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --color never -m gpt-6 -\"");
  assert.equal(run({}, "codex").stdin, "PROMPT");
  assert.deepEqual(run({ model: "Gemini 3.1 Pro (High)" }, "antigravity"),
    { command: "agy", args: ["--model", "Gemini 3.1 Pro (High)", "--dangerously-skip-permissions", "--print-timeout", "60m", "--output-format", "text", "-p"], verbatim: false, stdio: ["pipe", "pipe", "pipe"], stdin: "PROMPT", env: undefined, dropped: [] });
  assert.equal(run({}, "antigravity").args[0], "--dangerously-skip-permissions", "every flag precedes -p, with or without a model");
  for (const cli of [null, "grok", "claude", "codex", "antigravity"]) {
    assert.ok(!JSON.stringify(run({ model: "m" }, cli).args).includes("PROMPT"), `${cli ?? "opencode"}: the brief is never an argument`);
  }
});

// The guided installer puts grok on PATH as npm's grok.cmd, which Node cannot
// spawn without a shell: every Grok run failed ENOENT while where.exe said the
// CLI was installed. A shim goes through cmd.exe; a real binary still spawns
// directly.
test("a grok or agy installed as a batch shim runs through cmd.exe, a native binary directly", () => {
  const shimmed = (name) => `C:\\Users\\John Smith\\AppData\\Roaming\\npm\\${name}.cmd`;
  const grok = core.cliInvocation({ model: "grok-4", env: {} }, "grok", "PROMPT", { modelArg: (value) => value, promptFile: "C:\\Mefi's Studio AI+\\run_1_1.prompt.txt", shim: shimmed });
  assert.equal(grok.command, "cmd.exe");
  assert.equal(grok.verbatim, true);
  assert.equal(grok.args[3], "\"\"C:\\Users\\John Smith\\AppData\\Roaming\\npm\\grok.cmd\" --output-format plain --always-approve --max-turns 60 --no-alt-screen --verbatim -m grok-4 --prompt-file \"C:\\Mefi's Studio AI+\\run_1_1.prompt.txt\"\"");
  assert.equal(grok.stdin, null);
  const agy = core.cliInvocation({ model: "Gemini 3.1 Pro (High)" }, "antigravity", "PROMPT", { agyModelArg: (value) => value, shim: shimmed });
  assert.equal(agy.command, "cmd.exe");
  assert.match(agy.args[3], /agy\.cmd" --model "Gemini 3\.1 Pro \(High\)" --dangerously-skip-permissions/, "the display name stays one quoted word");
  assert.equal(agy.stdin, "PROMPT");
  // Off Windows there are no batch shims to look for.
  let asked = false;
  const posix = core.cliInvocation({}, "grok", "PROMPT", { promptFile: "/tmp/p.txt", platform: "linux", shim: () => { asked = true; return "/x.cmd"; } });
  assert.equal(posix.command, "grok");
  assert.equal(asked, false);
});

test("off Windows the shell CLIs get an sh line, which platform.cjs runs as sh -c", () => {
  const claude = core.cliInvocation({ model: "opus" }, "claude", "PROMPT", { modelArg: (value) => value, platform: "linux", desk: { claude: "/tmp/it's here/claude.json" } });
  assert.equal(claude.verbatim, false);
  assert.deepEqual(claude.args, ["/d", "/s", "/c", "claude -p --output-format text --dangerously-skip-permissions --model opus --mcp-config '/tmp/it'\\''s here/claude.json'"]);
});

// Codex takes Studio's tool server as config overrides: no per-run config file
// flag exists, and cmd.exe can carry no `"` through codex's npm shim, so the
// values are TOML literal strings.
test("codex gets the run's MCP servers as -c overrides, and never one that carries a credential", () => {
  const exe = "C:\\Program Files\\Mefi's Studio AI+\\Mefi's Studio AI+.exe";
  const servers = {
    mefi_tools: { command: exe, args: ["C:\\app\\scripts\\agent-tools-mcp.cjs"], env: { MEFI_TOOLS_CONFIG: "C:\\Users\\John Smith\\Temp\\mefi-tools-x\\policy.json", ELECTRON_RUN_AS_NODE: "1" } },
    mefi_desk: { command: exe, args: ["C:\\app\\scripts\\desk-mcp.mjs"], env: { MEFI_DESK_TOKEN: "secret", ELECTRON_RUN_AS_NODE: "1" } },
    "bad name": { command: exe, args: [] },
  };
  const codex = core.cliInvocation({}, "codex", "PROMPT", { desk: { servers }, platform: "linux" });
  assert.deepEqual(codex.dropped, ["mefi_desk", "bad name"]);
  const line = codex.args[3];
  assert.ok(line.includes("mcp_servers.mefi_tools.command=") && line.includes("mcp_servers.mefi_tools.args="), line);
  assert.ok(!line.includes("secret") && !line.includes("mefi_desk"), "the desk's token stays off the command line");
  assert.match(line, / -$/, "the prompt still comes from stdin");
  const windows = core.cliInvocation({}, "codex", "PROMPT", { desk: { servers: { mefi_tools: servers.mefi_tools } } });
  assert.equal(windows.verbatim, true);
  assert.ok(windows.args[3].includes(`-c "mcp_servers.mefi_tools.command='''${exe}'''"`), windows.args[3]);
  assert.ok(windows.args[3].includes(`-c "mcp_servers.mefi_tools.env={MEFI_TOOLS_CONFIG='C:\\Users\\John Smith\\Temp\\mefi-tools-x\\policy.json',ELECTRON_RUN_AS_NODE='1'}"`), windows.args[3]);
  assert.ok(!windows.args[3].slice(1, -1).includes("\"\"\""), "no value carries a double quote of its own");
  assert.deepEqual(core.cliInvocation({}, "codex", "PROMPT", { desk: { servers: { odd: { command: "C:\\it'''s\\x.exe" } } } }).dropped, ["odd"], "a value no TOML literal can hold is left out, not mangled");
});

// ---- a heavier retry -----------------------------------------------------------------

test("a heavier retry is pending from the owner's retry-deep until the next attempt starts", () => {
  const decided = (extra = {}) => ({ at: 500, choice: "retry-deep", kind: "capability", ...extra });
  assert.equal(core.heavyRetryPending({ decisions: [decided()], lastAttempt: { startedAt: 100, at: 400 } }), true);
  assert.equal(core.heavyRetryPending({ decisions: [decided({ by: "desk" })], lastAttempt: { startedAt: 100, at: 400 } }), true, "the desk answers for the owner");
  assert.equal(core.heavyRetryPending({ decisions: [decided()], lastAttempt: { startedAt: 600, at: 900 } }), false, "the attempt that started after it spent it");
  assert.equal(core.heavyRetryPending({ decisions: [decided({ by: "assistant" })] }), false, "the assistant's record of another card's answer routes nothing");
  assert.equal(core.heavyRetryPending({ decisions: [decided({ choice: "retry" })] }), false);
  assert.equal(core.heavyRetryPending({}), false);
  assert.equal(core.heavyRetryPending({ decisions: [decided(), { at: 700, choice: "instruct" }], lastAttempt: { startedAt: 100 } }), true, "a later note does not cancel it");
});

// ---- one line of worker output ------------------------------------------------------------

const lineState = (extra = {}) => ({ spoke: false, sawDone: false, resultNote: null, depth: 0, handoffs: [], calls: new Set(), issues: [], outputTail: [], outputLog: [], ...extra });
const read = (state, line, extra = {}) => core.readWorkerLine(state, line, { now: NOW, startedAt: NOW - 30000, doneMark: "MEFI_JOB_DONE", maxDepth: 3, maxHandoffs: 3, assistant, parseHandoff, ...extra });
const take = (state, line, extra = {}, stdout = true) => core.applyWorkerLine(state, read(state, line, extra), { stdout });

test("a CLI repeating its handoff on stdout and stderr admits it once, without merging distinct briefs", () => {
  const state = lineState();
  take(state, "MEFI_NEXT: Verify greeting :: Run the exact greeting check", {}, false);
  take(state, "MEFI_NEXT: Verify greeting :: Run the exact greeting check", {}, true);
  assert.equal(state.handoffs.length, 1);
  take(state, "MEFI_NEXT: Verify greeting :: Check the translated greeting", {}, true);
  take(state, "MEFI_NEXT: Verify another file :: Run the exact greeting check", {}, true);
  assert.equal(state.handoffs.length, 3, "distinct title or brief still creates separate work");
});

test("the sentinel counts only as a line of its own, colour or not, never quoted in prose", () => {
  assert.equal(read(lineState(), "MEFI_JOB_DONE").sawDone, true);
  assert.equal(read(lineState(), "\u001b[32mMEFI_JOB_DONE\u001b[0m").sawDone, true, "a CLI's colour still counts");
  for (const quoted of ["I will print MEFI_JOB_DONE when I am done", "> MEFI_JOB_DONE", "`MEFI_JOB_DONE`", "Print the exact line MEFI_JOB_DONE as the last thing you say."]) {
    assert.equal(read(lineState(), quoted).sawDone, false, quoted);
  }
  const state = lineState();
  take(state, "Print the exact line MEFI_JOB_DONE as the last thing you say.");
  assert.equal(state.sawDone, false, "a run that echoes its prompt is not done");
});

test("the first MEFI_RESULT line is the run's own account, and a later one never replaces it", () => {
  const state = lineState();
  const first = read(state, "MEFI_RESULT: done: the change; remaining: none");
  assert.equal(first.resultNote.parts.done, "the change");
  assert.equal(first.urgent, true, "the result line is worth a prompt save");
  core.applyWorkerLine(state, first, { stdout: true });
  assert.equal(read(state, "MEFI_RESULT: done: something else; remaining: none").resultNote, null);
  assert.equal(read(lineState(), "> MEFI_RESULT: done: quoted; remaining: none").resultNote, null, "a quoted result is not one");
});

test("hand-offs and calls are taken within the run's limits, and declined at the depth limit", () => {
  const state = lineState();
  for (const title of ["one", "two", "three", "four"]) take(state, `MEFI_NEXT: ${title} :: do ${title}`);
  take(state, "MEFI_CALL: auditor");
  take(state, "MEFI_CALL: responder");
  assert.deepEqual(state.handoffs.map((item) => item.title), ["one", "two", "three"]);
  assert.deepEqual([...state.calls], ["auditor"]);
  const deep = lineState({ depth: 3 });
  for (const title of ["a", "b", "c", "d"]) take(deep, `MEFI_NEXT: ${title} :: go`);
  assert.deepEqual(deep.handoffs, [], "no obligation a run past the limit could never discharge");
  assert.deepEqual(deep.declinedHandoffs, ["a", "b", "c"]);
  assert.equal(read(lineState(), "please print MEFI_NEXT: x :: y").handoff, null, "the mark is anchored to the line start");
});

test("asks are capped per run, never repeated, and carry the two lines before them", () => {
  const state = lineState();
  take(state, "reading the brief");
  take(state, "the store and the cache disagree");
  take(state, "MEFI_ASK: scope :: which store wins? :: both are written");
  take(state, "MEFI_ASK: scope :: which store wins? :: both are written");
  assert.equal(state.issues.length, 1);
  assert.deepEqual(state.issues[0].evidence, ["reading the brief", "the store and the cache disagree"]);
  const capped = lineState();
  for (const n of [1, 2, 3]) take(capped, `MEFI_ASK: missing :: question ${n} :: seen`, { issuesPerRun: 2 });
  assert.equal(capped.issues.length, 2, "the live map's per-run intake");
  const ceiling = lineState();
  for (const n of [1, 2, 3, 4, 5]) take(ceiling, `MEFI_ASK: missing :: question ${n} :: seen`, { issuesPerRun: 50 });
  assert.equal(ceiling.issues.length, 3, "never past the module's own ceiling");
});

test("a line's first word is its start time, and the kept tails hold only real, colour-free lines", () => {
  const state = lineState();
  const first = read(state, "\u001b[33mstarting\u001b[0m");
  assert.deepEqual([first.first, first.startMs, first.plain, first.urgent], [true, 30000, "starting", false]);
  core.applyWorkerLine(state, first, { stdout: false });
  assert.equal(state.spoke, true);
  assert.equal(state.spokeOut, undefined, "stderr alone is not the CLI reporting on the work");
  assert.equal(read(state, "next").first, false);
  take(state, "\u001b[0m");
  assert.deepEqual(state.outputTail, ["starting"], "a bare colour reset is never the run's last words");
  for (let n = 0; n < 50; n += 1) take(state, `line ${n} ${"x".repeat(300)}`);
  assert.equal(state.outputTail.length, 8);
  assert.equal(state.outputLog.length, 40);
  assert.equal(state.outputTail.at(-1).length, 200);
  assert.equal(state.spokeOut, true);
});
