// The per-task time limit inside the host (main.cjs "Task time limit"): the real
// spawnNextJob, attach timer, stop path and settlement run against the shared
// executor fixture with only the process, the clock and the board replaced. A
// capped run takes the owner's stop path (progress saved, nothing charged, the
// card waits for the owner); the hard kill alone is still a failure; the switch
// MEFI_STUDIO_NO_TASK_CAP=1 gives that back. Also the two IPC handlers and the
// bridge entries.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { executorHost } from "./fixtures/host_executor.mjs";

const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
};
const mainRequire = createRequire(new URL("../main.cjs", import.meta.url));
const plain = (value) => JSON.parse(JSON.stringify(value));
const settle = async () => { for (let turn = 0; turn < 40; turn += 1) await new Promise((resolve) => setImmediate(resolve)); };
const MIN = 60000;

// One dispatched run of one task. The fixture's EXECUTOR_KILL_MS is the real 25 minutes.
async function running({ task = {}, env = {} } = {}) {
  const row = { id: "t1", title: "Implement one", prompt: "Build one", files: ["one.js"], status: "open", createdAt: 1, ...task };
  const h = executorHost({ tasks: [row] });
  const recorded = [];
  Object.assign(h.env, { require: mainRequire, assistantLog() {}, recordWorkerAttempt: (entry, route, result) => recorded.push({ ...result }),
    taskProjectError: (projectId) => (projectId && projectId !== "fixture" ? "The selected project changed. Reload the task before continuing." : null) });
  Object.assign(h.env.process.env, env);
  // The IPC helpers the block calls that the executor fixture does not slice.
  vm.runInContext(section("function taskView(", "async function setTaskDependencies("), h.env);
  h.wake(); await h.pump();
  assert.equal(h.starts.length, 1, "one worker started");
  const job = h.autopilot.jobs[0];
  // The limit's timer: the start watchdog (3 minutes) and the short bookkeeping timers are not it, and a limit already passed arms at 0.
  const timers = () => h.timers.filter((timer) => !timer.cancelled && (timer.delay === 0 || timer.delay >= 60000) && timer.delay !== 180000);
  return { h, job, recorded, timers, row };
}

test("the default limit is the hard kill's 25 minutes, and it ends a run through the owner's stop path, not as a failure", async () => {
  const { h, job, recorded, timers } = await running();
  assert.deepEqual(timers().map((timer) => timer.delay), [25 * MIN], "one timer, at min(EXECUTOR_KILL_MS, the default limit)");
  timers()[0].fn();
  assert.equal(job.stopUser, true, "the owner's stop: settlement reads this as an intentional stop");
  assert.deepEqual(plain(job.capStop), { minutes: 25, at: job.capStop.at });
  assert.equal(job.ownerHold.kind, "limit");
  assert.equal(job.ownerHold.reason, "stopped at the time limit (25 min)");
  assert.equal(job.stopping.reason, "stopped at the time limit (25 min)", "the run is being stopped, with its reason");
  assert.equal(job.endKind, "stopped", "never the budget kill");
  assert.equal(h.terminations.length, 1, "the process tree is taken down like any other stop");
  h.terminations[0].child.emit("close", 0);
  await settle();
  const row = h.board().tasks[0];
  assert.equal(row.status, "open", "back in the queue");
  assert.equal(row.runFailures, undefined, "no failure charged");
  assert.equal(row.nextRunAt, undefined, "no retry backoff");
  assert.equal(row.lastRunError, undefined);
  assert.equal(row.runProgress.pending, true, "progress saved for the next attempt");
  assert.equal(row.ownerHold.kind, "limit", "the card waits for the owner instead of starting the same attempt again");
  assert.equal(row.ownerHold.minutes, 25);
  assert.match(row.logs.at(-1).text, /^stopped at the time limit \(25 min\) \(unfinished\) — progress saved, nothing failed; held for you$/);
  const finishRow = h.records.find((record) => record.event === "finish");
  assert.equal(finishRow.stopped, true);
  assert.equal(finishRow.limitMinutes, 25, "the ledger says the limit, so the attempt history can too");
  assert.equal(finishRow.error, "stopped at the time limit (25 min)");
  assert.deepEqual(recorded.map((result) => [result.ok, result.cancelled, result.outcome]), [[false, true, null]], "the model's record is a cancelled attempt, not a loss");
  assert.equal(h.autopilot.infraFailures, 0);
  assert.ok(h.autopilot.history.some((entry) => entry.kind === "stopped" && /stopped at its 25 min time limit/.test(entry.text)), "the feed says why");
  assert.ok(!h.logs.some((line) => /killed after budget/.test(line)));
});

test("a shorter limit is the timer, and a task's own limit is read from its record", async () => {
  const { timers } = await running({ task: { capMinutes: 10 } });
  assert.deepEqual(timers().map((timer) => timer.delay), [10 * MIN]);
  const five = await running({ task: { capMinutes: 5 } });
  assert.deepEqual(five.timers().map((timer) => timer.delay), [5 * MIN]);
  const junk = await running({ task: { capMinutes: "very long" } });
  assert.deepEqual(junk.timers().map((timer) => timer.delay), [25 * MIN], "a record edited to nonsense reads as the default");
});

test("a limit longer than the hard kill cannot lengthen a run: the hard kill ends it, as a failure, as before", async () => {
  const { h, job, timers } = await running({ task: { capMinutes: 60 } });
  assert.deepEqual(timers().map((timer) => timer.delay), [25 * MIN]);
  timers()[0].fn();
  assert.equal(job.stopUser, undefined, "not the owner's stop");
  assert.equal(job.capStop, undefined);
  assert.equal(job.endKind, "budget");
  assert.equal(job.stopping.reason, "killed after budget");
  h.terminations[0].child.emit("close", 0);
  await settle();
  const row = h.board().tasks[0];
  assert.equal(row.runFailures, 1, "charged, as it always was");
  assert.equal(row.ownerHold, undefined);
});

test("MEFI_STUDIO_NO_TASK_CAP=1 gives back the old kill: one hard timer, a failure, no hold", async () => {
  const { h, job, timers } = await running({ task: { capMinutes: 10 }, env: { MEFI_STUDIO_NO_TASK_CAP: "1" } });
  assert.deepEqual(timers().map((timer) => timer.delay), [25 * MIN], "the task's 10 minutes is ignored");
  timers()[0].fn();
  assert.equal(job.stopUser, undefined);
  assert.equal(job.endKind, "budget");
  h.terminations[0].child.emit("close", 0);
  await settle();
  assert.equal(h.board().tasks[0].runFailures, 1);
  assert.equal(h.board().tasks[0].ownerHold, undefined);
});

test("a limit that cannot be worked out leaves the hard kill exactly as it was", async () => {
  const { h, job, timers } = await running({ task: { capMinutes: 10 } });
  // The same run, with the module unloadable: side paths never fail a run.
  const other = executorHost({ tasks: [{ id: "t2", title: "Implement two", prompt: "Build two", files: ["two.js"], status: "open", createdAt: 1, capMinutes: 10 }] });
  Object.assign(other.env, { require: () => { throw new Error("module missing"); }, assistantLog() {} });
  other.wake(); await other.pump();
  const hard = other.timers.filter((timer) => !timer.cancelled && timer.delay >= 60000 && timer.delay !== 180000);
  assert.deepEqual(hard.map((timer) => timer.delay), [25 * MIN]);
  assert.ok(other.logs.some((line) => /time limit unavailable, the hard kill applies: module missing/.test(line)));
  hard[0].fn();
  assert.equal(other.autopilot.jobs[0].endKind, "budget");
  assert.ok(timers().length === 1 && job && h);
});

test("a stop that cannot be issued leaves nothing behind and the hard kill follows", async () => {
  const { h, job, timers } = await running({ task: { capMinutes: 10 } });
  const stop = job.stop;
  // Only the limit's own stop fails; the hard kill's stop is the ordinary one.
  let refused = 0;
  job.stop = (reason, ...rest) => { if (/time limit/.test(reason)) { refused += 1; throw new Error("cannot stop right now"); } return stop(reason, ...rest); };
  timers()[0].fn();
  assert.equal(refused, 1);
  assert.equal(job.capStop, undefined, "no trace of a limit stop");
  assert.equal(job.ownerHold, undefined);
  assert.equal(job.stopUser, undefined, "so the hard kill is judged as the failure it is");
  assert.equal(job.endKind, "budget");
  assert.equal(job.stopping.reason, "killed after budget");
  assert.ok(h.logs.some((line) => /could not stop/.test(line)));
});

test("changing the limit while a run is live re-arms its timer from the run's own start", async () => {
  const { h, job, timers } = await running();
  h.advance(12 * MIN);
  const result = await h.env.setTaskCap({ taskId: "t1", minutes: 10 });
  assert.equal(result.ok, true);
  assert.equal(job.capOverride, 10);
  const armed = timers();
  assert.equal(armed.length, 1, "the old timer is cancelled, one is armed");
  assert.equal(armed[0].delay, 0, "12 minutes in, a 10 minute limit is already passed: it stops at once");
  armed[0].fn();
  assert.equal(job.capStop.minutes, 10);
  assert.equal(job.ownerHold.reason, "stopped at the time limit (10 min)");
  // A longer limit on a fresh run moves the timer, never past the hard kill.
  const other = await running({ task: { id: "t9" } });
  other.h.advance(5 * MIN);
  await other.h.env.setTaskCap({ taskId: "t9", minutes: 15 });
  assert.equal(other.timers()[0].delay, 10 * MIN, "15 minutes from the start, 5 already spent");
  await other.h.env.setTaskCap({ taskId: "t9", minutes: 60 });
  assert.equal(other.timers()[0].delay, 20 * MIN, "the hard kill's 25 minutes, 5 already spent");
});

test("tasks:cap stores the limit on the task record, snapped to the steps, and refuses what it cannot use", async () => {
  const { h } = await running();
  let result = await h.env.setTaskCap({ taskId: "t1", minutes: 35 });
  assert.deepEqual([result.ok, result.minutes, result.clamped], [true, 35, false]);
  assert.equal(h.board().tasks[0].capMinutes, 35, "on the record, beside the other per-task settings");
  assert.equal(result.ceilingMinutes, 25, "the app's own ceiling is reported");
  assert.equal(result.effectiveMinutes, 25, "and what is in force");
  assert.equal(result.task.capMinutes, 35);
  result = await h.env.setTaskCap({ taskId: "t1", minutes: 12 });
  assert.deepEqual([result.minutes, result.clamped, result.effectiveMinutes], [10, true, 10]);
  assert.equal(h.board().tasks[0].capMinutes, 10);
  result = await h.env.setTaskCap({ taskId: "t1", minutes: 999 });
  assert.deepEqual([result.minutes, result.clamped], [240, true]);
  assert.equal((await h.env.setTaskCap({ taskId: "t1", minutes: "soon" })).ok, false);
  assert.equal(h.board().tasks[0].capMinutes, 240, "a refusal changes nothing");
  assert.match((await h.env.setTaskCap({ taskId: "nope", minutes: 10 })).error, /not found/);
  assert.match((await h.env.setTaskCap({ taskId: "t1", minutes: 10, projectId: "another" })).error, /project changed/);
  h.env.process.env.MEFI_STUDIO_NO_TASK_CAP = "1";
  const off = await h.env.setTaskCap({ taskId: "t1", minutes: 20 });
  assert.equal(off.ok, false);
  assert.equal(off.off, true);
  assert.match(off.error, /switched off/);
  assert.equal(h.board().tasks[0].capMinutes, 240, "the switch also stops it being set");
});

test("setting the limit is not an edit of the brief: no revision, and other settings survive", async () => {
  const { h } = await running();
  const before = h.board().tasks[0];
  await h.env.setTaskCap({ taskId: "t1", minutes: 15 });
  const after = h.board().tasks[0];
  assert.equal(after.capMinutes, 15);
  assert.equal(after.title, before.title);
  assert.equal(after.prompt, before.prompt);
  assert.equal(after.contextHistory?.entries?.length ?? 0, before.contextHistory?.entries?.length ?? 0, "the brief's history did not grow");
});

test("the worker is told a budget that fits its limit, and the usual one when the limit is the default", async () => {
  const { h } = await running({ task: { capMinutes: 10 } });
  assert.equal(h.env.taskToldBudget({ capMinutes: 10 }), 6);
  assert.equal(h.env.taskToldBudget({}), 15, "the default limit tells what it always told");
  assert.equal(h.env.taskToldBudget({ capMinutes: 60 }), 15, "never more than the usual budget");
  assert.match(h.starts[0].child.prompt, /You have about 6 minutes/, "the prompt the builder actually got");
  const usual = await running();
  assert.match(usual.h.starts[0].child.prompt, /You have about 15 minutes/);
  h.env.process.env.MEFI_STUDIO_NO_TASK_CAP = "1";
  assert.equal(h.env.taskToldBudget({ capMinutes: 10 }), 15, "with limits off, the old budget");
});

test("task:metrics reads the board, the executor ledger and both usage ledgers, and answers only for this project", async () => {
  const usage = [];
  const ledger = [
    { event: "start", runId: "run_1_1", task: "t1", title: "T", via: "opencode / glm-5.3", at: 1000 },
    { event: "finish", runId: "run_1_1", task: "t1", ok: true, sessionId: "ses_a", seconds: 90, at: 91000 },
  ].map((row) => JSON.stringify(row)).join("\n");
  const env = vm.createContext({
    require: mainRequire, process: { env: {} }, Date, EXECUTOR_KILL_MS: 25 * MIN, TASKS_PATH: "tasks", EXECUTOR_LOG_PATH: "executor-log.jsonl", logLine() {},
    projects: { current: () => ({ id: "fixture" }) }, projectDataPath: (file) => file,
    getEyes: async () => ({ readJson: async () => [{ id: "t1", title: "T", capMinutes: 15 }] }),
    readFile: async (file) => { usage.push(file); return ledger; },
    modelPerformanceStore: () => ({ read: async () => ({ observations: [] }) }),
    codingSessionUsage: async () => ({ ok: true, rows: [{ id: "m1", sessionId: "ses_a", at: 5000, completedAt: 5500, provider: "opencode-go", model: "glm-5.3", tokens: { input: 70, output: 7, total: 77 }, cost: 0.005 }] }),
    mergeLedgers: mainRequire("./scripts/usage-tracker.cjs").mergeLedgers,
    taskProjectError: (projectId) => (projectId && projectId !== "fixture" ? "The selected project changed. Reload the task before continuing." : null),
  });
  vm.runInContext(section("// ---- Task time limit", "// ---- end of the task time limit"), env);
  const out = plain(await env.readTaskMetrics({ taskId: "t1", projectId: "fixture" }));
  assert.equal(out.ok, true);
  assert.equal(out.projectId, "fixture");
  assert.equal(out.attempt.seconds, 90);
  assert.equal(out.attempt.tokens.total, 77);
  assert.equal(out.cap.minutes, 15);
  assert.equal(out.cap.enabled, true);
  assert.deepEqual(usage, ["executor-log.jsonl"]);
  assert.match((await env.readTaskMetrics({ taskId: "t1", projectId: "another" })).error, /project changed/);
  assert.match((await env.readTaskMetrics({ taskId: "missing", projectId: "fixture" })).error, /not on the board/);
  env.process.env.MEFI_STUDIO_NO_TASK_CAP = "1";
  assert.equal((await env.readTaskMetrics({ taskId: "t1" })).cap.enabled, false, "reading still works; it reports the limit as off");
  // A store that cannot be read is said, not hidden, and the rest still answers.
  env.codingSessionUsage = async () => ({ ok: false, rows: [], error: "no store" });
  const noStore = plain(await env.readTaskMetrics({ taskId: "t1" }));
  assert.equal(noStore.ok, true);
  assert.equal(noStore.attempt.tokens.state, "unavailable");
  assert.equal(noStore.coverage.complete, false);
  // A ledger that does not exist yet is an empty history, not a failure.
  env.readFile = async () => { throw Object.assign(new Error("gone"), { code: "ENOENT" }); };
  assert.equal(plain(await env.readTaskMetrics({ taskId: "t1" })).task.attempts, 0);
  env.readFile = async () => { throw Object.assign(new Error("locked"), { code: "EBUSY" }); };
  assert.match((await env.readTaskMetrics({ taskId: "t1" })).error, /could not be read: locked/);
});

test("the channels are project-gated and the bridge names them", async () => {
  assert.match(source, /ipcMain\.handle\("tasks:cap", \(_event, payload\) => setTaskCap\(payload \?\? \{\}\)\)/);
  assert.match(source, /ipcMain\.handle\("task:metrics", \(_event, payload\) => readTaskMetrics\(payload \?\? \{\}\)\)/);
  const gate = source.match(/const APP_WIDE_PREFIXES = \[([^\]]*)\]/)[1] + source.match(/const APP_WIDE_CHANNELS = new Set\(\[([^\]]*)\]/)[1];
  assert.ok(!/["']tasks:["']|["']task:["']|tasks:cap|task:metrics/.test(gate), "they read and write the open project, so a project switch waits for them");
  const preload = await readFile(new URL("../preload.cjs", import.meta.url), "utf8");
  assert.match(preload, /taskMetrics: \(payload\) => ipcRenderer\.invoke\("task:metrics"/);
  assert.match(preload, /tasksCap: \(payload\) => ipcRenderer\.invoke\("tasks:cap"/);
});
