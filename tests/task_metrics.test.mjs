// What a task took (scripts/task-metrics.cjs): this attempt and the whole task,
// from the executor ledger and the two usage ledgers, honest about a route that
// reports nothing. Real ledger rows in, the real usage-tracker rollup underneath.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { taskMetrics, routeOf, familyOf } = require("../scripts/task-metrics.cjs");
const { mergeLedgers } = require("../scripts/usage-tracker.cjs");

const KILL = 25 * 60000;
const NOW = 10_000_000;
const ledgerOf = (...rows) => rows.map((row) => (typeof row === "string" ? row : JSON.stringify(row))).join("\n");
const start = (runId, task, at, via = "opencode / glm-5.3") => ({ event: "start", runId, task, kind: "task", title: "Task", via, pid: 1, at });
const finish = (runId, task, at, more = {}) => ({ event: "finish", runId, task, kind: "task", ok: true, code: 0, sawDone: true, seconds: 60, at, ...more });
// One OpenCode turn, in the shape OpenCode's store gives the tracker.
const turn = (id, sessionId, at, tokens, cost = 0.01) => ({ id, sessionId, at, completedAt: at + 500, provider: "opencode-go", model: "glm-5.3", tokens, cost });
const rows = ({ store = [], studio = [] } = {}) => mergeLedgers({ studio, store });

test("one OpenCode attempt: its time, its tokens from the session inside its window, and a recorded cost", () => {
  const usageRows = rows({ store: [turn("m1", "ses_a", 2000, { input: 1000, output: 200, total: 1200 }, 0.02), turn("m2", "ses_a", 3000, { input: 500, output: 100, total: 600 }, 0.01)] });
  const out = taskMetrics({
    task: { id: "t1" }, tasks: [{ id: "t1" }], usageRows, storeOk: true, now: NOW, killMs: KILL,
    ledger: ledgerOf(start("run_1_1", "t1", 1000), finish("run_1_1", "t1", 61000, { sessionId: "ses_a", seconds: 60 })),
  });
  assert.equal(out.ok, true);
  assert.equal(out.attempt.runId, "run_1_1");
  assert.equal(out.attempt.seconds, 60);
  assert.deepEqual(out.attempt.tokens, { state: "reported", input: 1500, output: 300, cacheRead: 0, total: 1800, calls: 2 });
  assert.equal(out.attempt.cost.state, "reported");
  assert.ok(Math.abs(out.attempt.cost.usd - 0.03) < 1e-9);
  assert.equal(out.attempt.route.kind, "opencode");
  assert.equal(out.task.attempts, 1);
  assert.equal(out.task.tokens.total, 1800);
  assert.equal(out.coverage.complete, true);
});

test("a session reused by a retry charges each attempt only the turns inside its own window", () => {
  const usageRows = rows({ store: [turn("a", "ses_1", 2000, { input: 100, output: 10, total: 110 }), turn("b", "ses_1", 90000, { input: 900, output: 90, total: 990 })] });
  const out = taskMetrics({
    task: { id: "t1" }, tasks: [], usageRows, storeOk: true, now: NOW, killMs: KILL,
    ledger: ledgerOf(start("run_1_1", "t1", 1000), finish("run_1_1", "t1", 61000, { sessionId: "ses_1" }), start("run_2_1", "t1", 80000), finish("run_2_1", "t1", 140000, { sessionId: "ses_1" })),
  });
  const [second, first] = out.attempts;
  assert.equal(first.tokens.total, 110, "the first attempt's turn");
  assert.equal(second.tokens.total, 990, "the retry's turn, not its predecessor's");
  assert.equal(out.task.tokens.total, 1100, "the whole task adds each once");
  assert.equal(out.task.attempts, 2);
  assert.equal(out.task.seconds, 120);
});

test("a builder CLI reports no tokens and no price: Not reported, never zero, and the whole task says it is partial", () => {
  const usageRows = rows({ store: [turn("a", "ses_1", 2000, { input: 100, output: 10, total: 110 })] });
  const out = taskMetrics({
    task: { id: "t1" }, tasks: [], usageRows, storeOk: true, now: NOW, killMs: KILL,
    ledger: ledgerOf(start("run_1_1", "t1", 1000), finish("run_1_1", "t1", 61000, { sessionId: "ses_1" }), start("run_2_1", "t1", 80000, "claude cli · login 2"), finish("run_2_1", "t1", 140000, { seconds: 60 })),
  });
  assert.deepEqual(out.attempt.tokens, { state: "not-reported" });
  assert.deepEqual(out.attempt.cost, { state: "not-reported" });
  assert.equal(out.attempt.route.label, "Claude Code");
  assert.equal(out.attempt.seconds, 60, "time is measured here, so it is always known");
  assert.equal(out.task.tokens.state, "reported");
  assert.equal(out.task.tokens.total, 110);
  assert.equal(out.task.tokens.partial, true, "one attempt reported nothing");
  assert.equal(out.task.unreported, 1);
  // Every attempt on a CLI: the whole task has time only.
  const only = taskMetrics({ task: { id: "t1" }, tasks: [], usageRows, storeOk: true, now: NOW, killMs: KILL, ledger: ledgerOf(start("run_2_1", "t1", 80000, "codex cli"), finish("run_2_1", "t1", 140000)) });
  assert.equal(only.task.tokens.state, "not-reported");
  assert.equal(only.task.cost.state, "not-reported");
  assert.equal(only.task.seconds, 60);
  assert.equal("input" in only.task.tokens, false, "no number where nothing was reported");
});

test("a CLI attempt retried on OpenCode did its work there, and says where it started", () => {
  assert.deepEqual(routeOf("claude cli", []), { kind: "cli", label: "Claude Code", via: "claude cli", cli: "claude" });
  const retried = routeOf("grok cli · model", [{ at: 1, reason: "spawn failed" }]);
  assert.equal(retried.kind, "opencode");
  assert.equal(retried.fellBackFrom, "Grok");
  assert.equal(routeOf("", []).kind, "unknown");
  assert.equal(routeOf("opencode / kimi-k3 · subtask override", []).kind, "opencode");
});

test("a plan or subscription that prices no call is unpriced, never free", () => {
  const unpriced = { id: "s1", at: 2000, runId: "run_1_1", provider: "opencode-go", model: "glm-5.3", status: "ok", tokenUsage: { inputTokens: 400, outputTokens: 40, totalTokens: 440 }, costUsd: null };
  const out = taskMetrics({
    task: { id: "t1" }, tasks: [], usageRows: rows({ studio: [unpriced] }), storeOk: true, now: NOW, killMs: KILL,
    ledger: ledgerOf(start("run_1_1", "t1", 1000), finish("run_1_1", "t1", 61000)),
  });
  assert.equal(out.attempt.tokens.total, 440);
  assert.equal(out.attempt.cost.state, "unpriced");
  assert.equal(out.attempt.cost.unpricedCalls, 1);
  assert.equal(out.attempt.cost.usd, null, "no dollar figure was invented");
  assert.equal(out.task.cost.state, "unpriced");
  // A priced call next to an unpriced one keeps both facts.
  const mixed = taskMetrics({
    task: { id: "t1" }, tasks: [], usageRows: rows({ studio: [unpriced, { ...unpriced, id: "s2", costUsd: 0.5, at: 2100 }] }), storeOk: true, now: NOW, killMs: KILL,
    ledger: ledgerOf(start("run_1_1", "t1", 1000), finish("run_1_1", "t1", 61000)),
  });
  assert.equal(mixed.attempt.cost.state, "reported");
  assert.equal(mixed.attempt.cost.usd, 0.5);
  assert.equal(mixed.attempt.cost.unpricedCalls, 1);
});

test("no recorded call is none-recorded, and an unreadable store is unavailable: neither becomes a zero", () => {
  const ledger = ledgerOf(start("run_1_1", "t1", 1000), finish("run_1_1", "t1", 61000, { sessionId: "ses_x" }));
  const none = taskMetrics({ task: { id: "t1" }, tasks: [], usageRows: rows(), storeOk: true, now: NOW, killMs: KILL, ledger });
  assert.deepEqual(none.attempt.tokens, { state: "none-recorded" });
  assert.deepEqual(none.attempt.cost, { state: "none-recorded" });
  assert.equal(none.task.tokens.state, "none-recorded");
  const noStore = taskMetrics({ task: { id: "t1" }, tasks: [], usageRows: rows(), storeOk: false, now: NOW, killMs: KILL, ledger });
  assert.deepEqual(noStore.attempt.tokens, { state: "unavailable" });
  assert.match(noStore.coverage.reasons.join(" "), /OpenCode's store could not be read/);
  assert.equal(noStore.coverage.complete, false);
  const noLedgers = taskMetrics({ task: { id: "t1" }, tasks: [], usageRows: null, storeOk: false, now: NOW, killMs: KILL, ledger });
  assert.deepEqual(noLedgers.attempt.cost, { state: "unavailable" });
  // Studio's own ledger answered while the store did not: what it holds still counts.
  const studioOnly = taskMetrics({
    task: { id: "t1" }, tasks: [], storeOk: false, now: NOW, killMs: KILL, ledger,
    usageRows: rows({ studio: [{ id: "s1", at: 2000, runId: "run_1_1", provider: "opencode-go", model: "m", status: "ok", tokenUsage: { inputTokens: 5, outputTokens: 1, totalTokens: 6 }, costUsd: 0.001 }] }),
  });
  assert.equal(studioOnly.attempt.tokens.total, 6);
});

test("a live attempt counts up to now and takes its session from the card's own progress", () => {
  const usageRows = rows({ store: [turn("a", "ses_live", 5_000_000, { input: 300, output: 30, total: 330 })] });
  const out = taskMetrics({
    task: { id: "t1", runId: "run_9_1", runProgress: { runId: "run_9_1", sessionId: "ses_live" } }, tasks: [], usageRows, storeOk: true, now: 5_600_000, killMs: KILL,
    ledger: ledgerOf(start("run_9_1", "t1", 4_800_000)),
  });
  assert.equal(out.attempt.live, true);
  assert.equal(out.attempt.outcome, "running");
  assert.equal(out.attempt.seconds, 800, "measured to the moment asked");
  assert.equal(out.attempt.endedAt, null);
  assert.equal(out.attempt.tokens.total, 330);
  assert.equal(out.coverage.complete, true, "a run in progress is not a gap");
});

test("an attempt with no recorded end has no invented time and says so", () => {
  const out = taskMetrics({ task: { id: "t1" }, tasks: [], usageRows: rows(), storeOk: true, now: NOW, killMs: KILL, ledger: ledgerOf(start("run_1_1", "t1", 1000), start("run_2_1", "t1", 90000), finish("run_2_1", "t1", 150000)) });
  const trimmed = out.attempts.find((attempt) => attempt.runId === "run_1_1");
  assert.equal(trimmed.seconds, null);
  assert.equal(trimmed.outcome, "unrecorded");
  assert.equal(out.task.seconds, 60, "only what is known is added");
  assert.equal(out.task.secondsUnknown, 1);
  assert.match(out.coverage.reasons.join(" "), /no recorded end/);
});

test("an attempt stopped at its time limit is recorded as that, with the limit it had", () => {
  const out = taskMetrics({
    task: { id: "t1" }, tasks: [], usageRows: rows(), storeOk: true, now: NOW, killMs: KILL,
    ledger: ledgerOf(start("run_1_1", "t1", 1000), finish("run_1_1", "t1", 601000, { ok: false, code: 1, stopped: true, limitMinutes: 10, error: "stopped at the time limit (10 min)", seconds: 600 })),
  });
  assert.equal(out.attempt.outcome, "stopped");
  assert.equal(out.attempt.stoppedAtLimit, true);
  assert.equal(out.attempt.limitMinutes, 10);
  assert.equal(out.task.stoppedAtLimit, 1);
  // A stop by the owner has no limit and is not a limit stop.
  const owner = taskMetrics({ task: { id: "t1" }, tasks: [], usageRows: rows(), storeOk: true, now: NOW, killMs: KILL, ledger: ledgerOf(start("run_1_1", "t1", 1000), finish("run_1_1", "t1", 61000, { ok: false, stopped: true, error: "stopped by you" })) });
  assert.equal(owner.attempt.stoppedAtLimit, false);
  assert.equal(owner.attempt.limitMinutes, null);
});

test("the whole task adds its delegated sub-tasks, and a card that only looks related is a separate task", () => {
  const tasks = [
    { id: "t1", title: "Parent" },
    { id: "t2", title: "Child", parentTaskId: "t1" },
    { id: "t3", title: "Grandchild", delegatedFrom: { parentTaskId: "t2" } },
    { id: "t4", title: "A split card", splitFrom: "t1" },
    { id: "t5", title: "Someone else's", parentTaskId: "t9" },
  ];
  const ledger = ledgerOf(
    start("run_1_1", "t1", 1000), finish("run_1_1", "t1", 61000, { seconds: 60 }),
    start("run_2_1", "t2", 2000), finish("run_2_1", "t2", 122000, { seconds: 120 }),
    start("run_3_1", "t3", 3000), finish("run_3_1", "t3", 33000, { seconds: 30 }),
    start("run_4_1", "t4", 4000), finish("run_4_1", "t4", 44000, { seconds: 40 }),
  );
  const out = taskMetrics({ task: tasks[0], tasks, usageRows: rows(), storeOk: true, now: NOW, killMs: KILL, ledger });
  assert.equal(out.task.subtasks, 2);
  assert.equal(out.task.attempts, 3);
  assert.equal(out.task.seconds, 210);
  assert.equal(out.attempt.runId, "run_1_1", "this attempt is the task's own, not a sub-task's");
  assert.deepEqual(out.attempts.map((attempt) => attempt.taskId), ["t1"], "the list shows the task's own attempts");
  assert.deepEqual(familyOf(tasks[0], tasks).members.map((row) => row.id), ["t1", "t2", "t3"]);
});

test("the family is bounded and says when the walk stopped early", () => {
  const tasks = [{ id: "root" }, ...Array.from({ length: 40 }, (_, index) => ({ id: `kid_${index}`, parentTaskId: "root" }))];
  const family = familyOf(tasks[0], tasks);
  assert.equal(family.members.length, 24);
  assert.equal(family.truncated, true);
  const out = taskMetrics({ task: tasks[0], tasks, usageRows: rows(), storeOk: true, now: NOW, killMs: KILL, ledger: "" });
  assert.match(out.coverage.reasons.join(" "), /more sub-tasks/);
  // A chain deeper than four levels is cut, and says so.
  const chain = [{ id: "c0" }, ...Array.from({ length: 6 }, (_, index) => ({ id: `c${index + 1}`, parentTaskId: `c${index}` }))];
  const deep = familyOf(chain[0], chain);
  assert.deepEqual(deep.members.map((row) => row.id), ["c0", "c1", "c2", "c3", "c4"]);
  assert.equal(deep.truncated, true);
});

test("the task's own attempts shown are the newest ten, and a torn ledger line is skipped", () => {
  const rowsOf = [];
  for (let index = 0; index < 14; index += 1) rowsOf.push(start(`run_${index}_1`, "t1", 1000 + index * 1000), finish(`run_${index}_1`, "t1", 1500 + index * 1000, { seconds: 1 }));
  const out = taskMetrics({ task: { id: "t1" }, tasks: [], usageRows: rows(), storeOk: true, now: NOW, killMs: KILL, ledger: ledgerOf('{"event":"start","runId":"run_bad","task":"t1","at":', ...rowsOf) });
  assert.equal(out.attempts.length, 10);
  assert.equal(out.attempts[0].runId, "run_13_1", "newest first");
  assert.equal(out.task.attempts, 14, "the whole task still counts them all");
  assert.equal(out.task.seconds, 14);
});

test("an unknown task is refused, and an empty ledger is a plain statement", () => {
  assert.deepEqual(taskMetrics({ task: null, now: NOW }), { ok: false, error: "That task is not on the board." });
  const empty = taskMetrics({ task: { id: "t1" }, tasks: [], usageRows: rows(), storeOk: true, now: NOW, killMs: KILL, ledger: "" });
  assert.equal(empty.ok, true);
  assert.equal(empty.attempt, null);
  assert.equal(empty.task.attempts, 0);
  assert.equal(empty.task.seconds, null, "no time recorded is null, not 0");
  assert.match(empty.coverage.reasons.join(" "), /no run history/i);
});

test("the limit block reports what is stored, what is in force and the ceiling, honestly", () => {
  const base = { tasks: [], usageRows: rows(), storeOk: true, now: NOW, killMs: KILL, ledger: "" };
  const plain = taskMetrics({ ...base, task: { id: "t1" } }).cap;
  assert.deepEqual(plain, { enabled: true, minutes: 25, effectiveMinutes: 25, ceilingMinutes: 25, raised: false, default: 25, min: 5, max: 240, step: 5 });
  const short = taskMetrics({ ...base, task: { id: "t1", capMinutes: 10 } }).cap;
  assert.equal(short.minutes, 10);
  assert.equal(short.effectiveMinutes, 10);
  const long = taskMetrics({ ...base, task: { id: "t1", capMinutes: 60 } }).cap;
  assert.equal(long.minutes, 60, "the owner's number is kept");
  assert.equal(long.effectiveMinutes, 25, "but the app's own ceiling is what ends a run");
  assert.equal(long.raised, true);
  const off = taskMetrics({ ...base, task: { id: "t1", capMinutes: 10 }, capOn: false }).cap;
  assert.equal(off.enabled, false);
  assert.equal(off.effectiveMinutes, 25, "with limits off the hard kill alone applies");
});
