import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import executorResume from "../scripts/executor-resume.cjs";
import backlog from "../scripts/backlog.cjs";
import { executorHost } from "./fixtures/host_executor.mjs";

const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host boundary: ${start}`);
  return source.slice(from, to);
};

const task = (id, extra = {}) => ({ id, title: `Implement resume fixture ${id}`, prompt: `Finish ${id} with its saved acceptance requirements.`, status: "open", createdAt: 1, files: [`src/${id}.js`], ...extra });
const savedTask = (extra = {}) => task("interrupted", {
  status: "active", runId: "previous-run", lease: { pid: 80, at: 900000 }, runFailures: 2, verifyAttempts: 1,
  runProgress: { version: 1, runId: "previous-run", pid: 80, workerPid: 81, startedAt: 899000, at: 900000, sessionId: "previous-session", progress: 0.5, pending: false,
    todos: [{ content: "Implement serializer", status: "completed" }, { content: "Verify empty input", status: "in_progress" }], outputTail: ["Serializer is implemented; empty input coverage remains."] },
  ...extra,
});

test("checkpoint context is bounded and never turns partial output into completion evidence", () => {
  const ref = task("bounded");
  const saved = executorResume.checkpoint({ id: "run", ref, ownerPid: 10, pid: 20, startedAt: 100, sessionId: "session", progress: 0.5,
    todos: Array.from({ length: 100 }, () => ({ content: "x".repeat(2000), status: "in_progress", privateField: "omitted" })),
    outputTail: Array.from({ length: 100 }, (_, i) => `${i}: ${"y".repeat(2000)}`), resultNote: { raw: "z".repeat(5000) }, sawDone: true,
  }, 200);
  assert.equal(saved.pid, 10); assert.equal(saved.workerPid, 20); assert.equal(saved.scope, backlog.buildScope(ref));
  assert.equal(saved.progress, 0.5); assert.equal(saved.at, 200); assert.equal(saved.pending, false);
  assert.equal(saved.todos.length, 40); assert.equal(saved.todos[0].content.length, 500); assert.equal(saved.todos[0].privateField, undefined);
  assert.equal(saved.outputTail.length, 8); assert.ok(saved.outputTail.every((line) => line.length <= 500));
  assert.equal(saved.result.raw.length, 1600); assert.equal(saved.sawDone, undefined); assert.equal(saved.verification, undefined);
  const resumed = { ...ref, runProgress: { ...saved, pending: true } };
  assert.ok(executorResume.brief(resumed, 800).length <= 800);
  assert.match(executorResume.brief(resumed), /not proof that tests passed/);
  assert.equal(executorResume.brief({ ...ref, runProgress: saved }), "");
});

// A CLI that echoes its prompt (codex exec, on stderr) reads the resume brief
// back line by line. Saved protocol lines at a line start were replayed as the
// resumed run's own verdict, result and hand-offs.
test("a resume brief never starts a line with the previous run's protocol marks", () => {
  const ref = task("echoed");
  const saved = executorResume.checkpoint({ id: "run", ref, ownerPid: 10, startedAt: 100, sessionId: "session",
    outputTail: ["MEFI_NEXT: Leftover migration :: finish it", "MEFI_JOB_DONE"], resultNote: { raw: "MEFI_RESULT: done: half; remaining: rest" } }, 200);
  const brief = executorResume.brief({ ...ref, runProgress: { ...saved, pending: true } });
  assert.match(brief, /> MEFI_RESULT: done: half/, "the saved result is still there for the next worker to read");
  for (const line of brief.split("\n")) assert.doesNotMatch(line.trim(), /^MEFI_/, `a quoted line cannot be read as protocol: ${line}`);
});

test("a long-lived tool is settled only after its own bounded wait, never as success", () => {
  const running = { id: "launch", sessionId: "s", tool: "bash", status: "running", startedAt: 1000, updatedAt: 2000 };
  const before = JSON.stringify(running);
  const cap = executorResume.ACTIVE_TOOL_SETTLE_MS;
  assert.equal(executorResume.settleActiveTool(running, 1000 + cap - 1), running, "a tool inside the wait keeps its exact running record");
  const settled = executorResume.settleActiveTool(running, 1000 + cap);
  assert.equal(settled.status, "timed_out"); assert.equal(settled.timedOut, true);
  assert.equal(settled.id, "launch"); assert.equal(settled.tool, "bash");
  assert.notEqual(settled.status, "completed", "a timed-out launch is never reported as a success");
  assert.equal(JSON.stringify(running), before, "settlement never mutates the observed tool");
  const replacement = { ...running, id: "launch-2", startedAt: 1000 + cap + 5 };
  assert.equal(executorResume.settleActiveTool(replacement, 1000 + cap + 10), replacement, "a newer tool starts its own wait instead of inheriting a stale timeout");
  assert.equal(executorResume.settleActiveTool(null, 10 ** 12), null);
  assert.equal(executorResume.settleActiveTool(undefined, 10 ** 12), null);
  assert.equal(executorResume.settleActiveTool({ status: "completed", startedAt: 1 }, 10 ** 12), null, "an already settled tool is not re-settled");
  const unclocked = { status: "running" };
  assert.equal(executorResume.settleActiveTool(unclocked, 10 ** 12), unclocked, "a tool without a start time cannot be judged timed out");
});

test("a timed-out long-lived tool retires the run's process tree exactly once", () => {
  const cap = executorResume.ACTIVE_TOOL_SETTLE_MS;
  const running = { id: "launch", sessionId: "s", tool: "bash", status: "running", startedAt: 1000, updatedAt: 2000 };
  const stops = [];
  const entry = { stop: (reason, fallback, kind) => stops.push({ reason, fallback, kind }) };
  // Inside the wait the observed tool is returned untouched and nothing is stopped.
  assert.equal(executorResume.retireTimedOutTool(entry, running, 1000 + cap - 1), running);
  assert.equal(stops.length, 0, "a live launch is not retired before its bounded wait");
  // Crossing the wait settles the tool AND stops the run (its tree) once.
  const settled = executorResume.retireTimedOutTool(entry, running, 1000 + cap);
  assert.equal(settled.status, "timed_out"); assert.equal(settled.timedOut, true);
  assert.equal(stops.length, 1); assert.match(stops[0].reason, /process tree/); assert.equal(stops[0].kind, "tool-timeout");
  // The same tool polled again is latched: no second stop, same settled record.
  assert.deepEqual(executorResume.retireTimedOutTool(entry, running, 1000 + cap + 5), settled);
  assert.equal(stops.length, 1, "repeated polls never re-stop the same timed-out tool");
  // A replacement tool starts its own wait and, if it too times out, its own stop.
  const replacement = { ...running, id: "launch-2", startedAt: 1000 + cap + 10 };
  assert.equal(executorResume.retireTimedOutTool(entry, replacement, 1000 + cap + 20), replacement, "a fresh tool is still within its wait");
  assert.equal(stops.length, 1);
  executorResume.retireTimedOutTool(entry, replacement, 1000 + cap + 10 + cap);
  assert.equal(stops.length, 2, "a replacement that times out is retired on its own latch");
  // A completed/dropped tool is never retired, and a missing handle is tolerated.
  assert.equal(executorResume.retireTimedOutTool(entry, null, 10 ** 12), null);
  assert.equal(executorResume.retireTimedOutTool(null, running, 10 ** 12).timedOut, true, "an entry without a stop handle still settles");
});

test("only confirmed interrupted ownership reopens; live, inaccessible and unidentifiable owners stay held", () => {
  const original = savedTask();
  const base = { liveRuns: new Set(), pid: 101, now: 1000000, isAlive: () => false };
  const reopened = executorResume.recover(original, base);
  assert.equal(original.status, "active", "recovery does not mutate its input snapshot");
  assert.equal(reopened.status, "open"); assert.equal(reopened.runId, undefined); assert.equal(reopened.lease, undefined);
  assert.equal(reopened.runProgress.pending, true); assert.equal(reopened.interruptedAttempt.runId, original.runId);
  assert.equal(reopened.runFailures, 2); assert.equal(reopened.verifyAttempts, 1);
  for (const isAlive of [(pid) => pid === 80, (pid) => pid === 81, () => null]) {
    assert.equal(executorResume.recover(original, { ...base, isAlive }), original);
  }
  assert.equal(executorResume.recover(original, { ...base, liveRuns: new Set([original.runId]) }), original);
  const unknownOwner = { ...original, lease: { at: 1 } };
  assert.equal(executorResume.recover(unknownOwner, base), unknownOwner);
  const verifying = { ...original, status: "awaiting_verification" };
  assert.equal(executorResume.recover(verifying, base), verifying, "completed attempts retain the existing verification path");
});

test("the real stream and progress watcher save context which a new host continues before unrelated work", async () => {
  const first = executorHost({ tasks: [task("ongoing", { createdAt: 100, runFailures: 2, verifyAttempts: 1 })], realWatches: true });
  first.wake(); await first.pump();
  const entry = first.autopilot.jobs[0];
  first.session(entry.id, "saved-session", [{ content: "Implement serializer", status: "completed" }, { content: "Verify empty input", status: "in_progress" }]);
  assert.equal(await first.env.attributeRunSession(await first.env.getEyes(), entry), true);
  entry.child.stdout.emit("data", "Serializer is implemented; empty input coverage remains.\n");
  // The progress poll reads the store asynchronously (the eyes worker); await the read it schedules.
  await first.timers.find((timer) => timer.delay === first.env.EXECUTOR_PROGRESS_POLL_MS).fn();
  const save = first.timers.find((timer) => timer.delay === 1000 && !timer.cancelled);
  assert.ok(save, "stream/session/todo changes schedule a durable checkpoint");
  await save.fn();
  const stored = first.board().tasks[0];
  assert.equal(stored.runProgress.workerPid, entry.pid); assert.equal(stored.runProgress.pid, 101);
  assert.equal(stored.runProgress.sessionId, "saved-session"); assert.equal(stored.runProgress.progress, 0.5);
  assert.equal(stored.runProgress.todos[1].content, "Verify empty input");
  assert.match(stored.runProgress.outputTail.join("\n"), /empty input coverage remains/);

  const restarted = executorHost({ pid: 102, tasks: [task("unrelated", { createdAt: 1 }), stored] });
  restarted.advance(5000); restarted.wake(); await restarted.pump();
  assert.deepEqual(restarted.starts.map((row) => row.taskId), ["ongoing"]);
  const prompt = restarted.starts[0].child.prompt;
  assert.match(prompt, /CONTINUE INTERRUPTED WORK/); assert.match(prompt, /saved-session/);
  assert.match(prompt, /Last reported progress: 50%/); assert.match(prompt, /Verify empty input/);
  assert.match(prompt, /empty input coverage remains/); assert.match(prompt, /saved acceptance requirements/);
  const current = restarted.board().tasks.find((row) => row.id === "ongoing");
  assert.equal(current.runFailures, 2); assert.equal(current.verifyAttempts, 1);
  assert.equal(current.interruptedAttempt.runId, entry.id);
  assert.equal(current.interruptedAttempt.sessionId, "saved-session");
  assert.equal(current.runProgress.pending, false); assert.notEqual(current.runId, entry.id);
  restarted.wake(); await restarted.pump();
  assert.equal(restarted.starts.length, 1, "repeated reload recovery does not duplicate an active replacement");
});

test("reload in the same host keeps its current worker and existing durable progress", async () => {
  const h = executorHost({ tasks: [task("active")] });
  h.wake(); await h.pump();
  const entry = h.autopilot.jobs[0];
  entry.child.stdout.emit("data", "One completed edit\n");
  await h.env.queueExecutorCheckpoint(entry, { force: true });
  for (let reload = 0; reload < 3; reload++) { h.wake("renderer reloaded"); await h.pump(); }
  assert.equal(h.starts.length, 1); assert.equal(h.autopilot.jobs[0], entry);
  assert.equal(h.board().tasks[0].runProgress.runId, entry.id);
  assert.equal(h.board().tasks[0].interruptedAttempt, undefined);
  assert.equal(h.terminations.length, 0);
});

// Direct request execution is retired. An older build's request that was
// running when the app went down is migrated by the first housekeeping pass
// (back to the inbox, its checkpoint kept as the interrupted attempt), promoted
// and resumed as a task in that same foreman pass.
test("Cluster resumes an older build's interrupted direct request as a task and advances after verification", async () => {
  const request = { title: "Continue direct serializer request", prompt: "Complete the serializer and verify empty input", at: 1, source: "manual", pin: true,
    status: "running", runId: "run_legacy_1", runningAt: 999000, lease: { pid: 101, at: 999000 },
    runProgress: { version: 1, runId: "run_legacy_1", pid: 101, startedAt: 999000, at: 999500, sessionId: "direct-request-session", progress: 0.5, pending: false,
      todos: [{ content: "Implement serializer", status: "completed" }], outputTail: ["Serializer implemented; empty input verification remains."] } };
  const h = executorHost({ pid: 102, mode: "cluster", adaptiveParallel: true, requests: [request], tasks: [task("next")] });
  h.advance(5000); h.wake("restart with a saved direct request"); await h.pump();
  const resumed = h.board().tasks.find((row) => row.title === request.title);
  assert.ok(resumed, "promotion put the migrated request on the board");
  assert.deepEqual(h.starts.map((row) => row.taskId), [resumed.id], "and its task was dispatched in the same pass");
  assert.equal(h.autopilot.clusterFocus.source, "task");
  assert.equal(h.autopilot.clusterFocus.id, resumed.id);
  assert.equal(resumed.interruptedAttempt.runId, "run_legacy_1");
  assert.match(h.starts[0].child.prompt, /direct-request-session/, "the task's brief quotes the lost run's progress");
  assert.match(h.starts[0].child.prompt, /empty input verification remains/);
  assert.ok(h.logs.some((line) => /legacy request "Continue direct serializer request" was running \(run_legacy_1\) with no live worker/.test(line)));
  const inbox = h.board().requests;
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].status, undefined, "no request is ever claimed again");
  assert.equal(inbox[0].runId, undefined);

  await h.finish(resumed.id); await h.pump();
  assert.equal(h.starts.length, 1, "Cluster still waits for the resumed attempt's verification");
  assert.equal(h.board().requests.length, 0, "the inbox copy is released once its task's run succeeds");
  h.advance(31000); h.wake(); await h.pump();
  const completion = h.board().tasks.filter((row) => row.title === request.title);
  assert.equal(completion.length, 1); assert.equal(completion[0].status, "done");
  assert.equal(completion[0].verification.state, "verified");
  assert.deepEqual(h.starts.map((row) => row.taskId), [resumed.id, "next"]);
  assert.equal(h.autopilot.clusterFocus.source, "task"); assert.equal(h.autopilot.clusterFocus.id, "next");
  h.wake(); await h.pump();
  assert.equal(h.starts.length, 2); assert.equal(h.board().tasks.filter((row) => row.title === request.title).length, 1);
});

// The same migration for an auto-filed request filed more than 48 hours before
// the upgrade: the housekeeping sweep runs in the migration's own mutation and
// its age prune deleted the row, checkpoint and all, before promotion saw it.
test("an older build's auto-filed request lost mid-run days ago is promoted and resumed, not pruned by the same pass", async () => {
  const request = { title: "Repair the serializer's empty input", prompt: "Find the root cause of the serializer dropping empty input and fix it", at: 1_000_000, source: "fix",
    status: "running", runId: "run_legacy_2", runningAt: 1_000_000, lease: { pid: 101, at: 1_000_000 },
    runProgress: { version: 1, runId: "run_legacy_2", pid: 101, startedAt: 1_000_000, at: 1_000_500, sessionId: "fix-session", progress: 0.4, pending: false,
      outputTail: ["Half the serializer fix is in; empty input remains."] } };
  const h = executorHost({ pid: 102, requests: [request] });
  h.advance(49 * 3600 * 1000); h.wake("restart two days later"); await h.pump();
  assert.ok(!h.logs.some((line) => /stale request\(s\) pruned/.test(line)), "the migrated row is not pruned");
  const resumed = h.board().tasks.find((row) => row.title === request.title);
  assert.ok(resumed, "promotion put the migrated request on the board");
  assert.equal(resumed.source, "fix");
  assert.equal(resumed.interruptedAttempt.runId, "run_legacy_2");
  assert.deepEqual(h.starts.map((row) => row.taskId), [resumed.id], "and its task was dispatched");
  assert.match(h.starts[0].child.prompt, /fix-session/, "the task's brief quotes the lost run's progress");
});

test("todo wording updates are saved even when the percentage stays the same", async () => {
  const h = executorHost({ tasks: [task("renamed-step")], realWatches: true });
  let updates = 0;
  h.env.emitAutopilot = () => { updates += 1; };
  h.wake(); await h.pump();
  const entry = h.autopilot.jobs[0];
  h.session(entry.id, "todo-session", [{ content: "Implementation", status: "completed" }, { content: "Initial verification plan", status: "in_progress" }]);
  await h.env.attributeRunSession(await h.env.getEyes(), entry);
  await h.timers.find((timer) => timer.delay === h.env.EXECUTOR_PROGRESS_POLL_MS).fn();
  await h.env.queueExecutorCheckpoint(entry, { force: true });
  assert.equal(h.board().tasks[0].runProgress.progress, 0.5);
  const previousUpdates = updates;
  h.advance(1000);
  h.session(entry.id, "todo-session", [{ content: "Implementation", status: "completed" }, { content: "Verify the newly found empty-input case", status: "in_progress" }]);
  await h.timers.findLast((timer) => timer.delay === h.env.EXECUTOR_PROGRESS_POLL_MS).fn();
  const save = h.timers.findLast((timer) => timer.delay === 1000 && !timer.cancelled);
  assert.ok(save); await save.fn();
  assert.equal(h.board().tasks[0].runProgress.progress, 0.5);
  assert.equal(h.board().tasks[0].runProgress.todos[1].content, "Verify the newly found empty-input case");
  assert.ok(updates > previousUpdates, "a renamed step reaches the UI even when its fraction is unchanged");
  assert.equal(entry.todosUpdatedAt, h.now());
});

test("worker output pushes a bounded fresh update without delaying durable checkpoints", async () => {
  const h = executorHost({ tasks: [task("live-output")] });
  h.wake(); await h.pump();
  let updates = 0;
  h.env.emitAutopilot = () => { updates += 1; };
  const entry = h.autopilot.jobs[0];
  entry.child.stdout.emit("data", "Inspecting input\nRunning collision tests\n");
  assert.equal(entry.activity.text, "Running collision tests");
  assert.equal(entry.lastOutputAt, h.now());
  const pushes = h.timers.filter((timer) => timer.delay === 500 && !timer.cancelled);
  assert.equal(pushes.length, 1, "a burst shares one trailing update");
  assert.equal(updates, 0);
  await pushes[0].fn();
  assert.equal(updates, 1);
  entry.child.stdout.emit("data", "Final check\n");
  const next = h.timers.findLast((timer) => timer.delay === 500 && !timer.cancelled);
  entry.finished = true;
  await next.fn();
  assert.equal(updates, 1, "a late timer cannot resurrect a finished worker");
});

test("quiet worker polling publishes its running tool before output and clears completed tools", async () => {
  const h = executorHost({ tasks: [task("quiet-tool")], realWatches: true });
  h.wake(); await h.pump();
  const entry = h.autopilot.jobs[0];
  h.session(entry.id, "quiet-session", [{ content: "Review game rules", status: "in_progress" }]);
  const eyes = await h.env.getEyes();
  await h.env.attributeRunSession(eyes, entry);
  const running = { id: "active-shell", sessionId: "quiet-session", tool: "bash", status: "running", description: "Start preview server", command: "", startedAt: h.now(), updatedAt: h.now() };
  let tools = [running], updates = 0;
  eyes.listSessionActiveTools = async (options) => {
    assert.equal(options.sessionId, "quiet-session");
    assert.equal(options.since, entry.startedAt);
    return { available: true, tools };
  };
  h.env.emitAutopilot = () => { updates += 1; };
  const poll = () => h.timers.findLast((timer) => timer.delay === h.env.EXECUTOR_PROGRESS_POLL_MS).fn();
  await poll();
  assert.equal(entry.activeTool.id, "active-shell");
  assert.equal(entry.lastOutputAt, null, "polling a tool must not invent stdout");
  const previous = updates;
  h.advance(60000);
  await poll();
  assert.ok(updates > previous, "a quiet active tool refreshes its elapsed label");
  tools = [];
  await poll();
  assert.equal(entry.activeTool, null, "completed tools cannot stay on the current step");
  eyes.listTodos = async () => { throw new Error("temporary todo read failure"); };
  tools = [running];
  await poll();
  assert.equal(entry.activeTool.id, "active-shell", "tool visibility does not depend on todo availability");
  entry.finished = true;
  const stoppedUpdates = updates;
  await poll();
  assert.equal(updates, stoppedUpdates, "stopped workers cannot publish stale session tools");
});

test("a long-lived launch's Bash tool settles in the watcher instead of running forever", async () => {
  const h = executorHost({ tasks: [task("stuck-launch")], realWatches: true });
  h.wake(); await h.pump();
  const entry = h.autopilot.jobs[0];
  h.session(entry.id, "launch-session", [{ content: "Launch the preview server", status: "in_progress" }]);
  const eyes = await h.env.getEyes();
  await h.env.attributeRunSession(eyes, entry);
  let tools = [{ id: "launch", sessionId: "launch-session", tool: "bash", status: "running", description: "Start the preview server", command: "", startedAt: h.now(), updatedAt: h.now() }];
  eyes.listSessionActiveTools = async () => ({ available: true, tools });
  const poll = () => h.timers.findLast((timer) => timer.delay === h.env.EXECUTOR_PROGRESS_POLL_MS).fn();
  await poll();
  assert.equal(entry.activeTool.id, "launch");
  assert.equal(entry.activeTool.status, "running", "a fresh launch keeps its normal running label");
  assert.equal(h.terminations.length, 0, "a live launch is not retired before its bounded wait");
  h.advance(executorResume.ACTIVE_TOOL_SETTLE_MS + 1);
  await poll();
  assert.equal(entry.activeTool.status, "timed_out", "a long-lived launch cannot stay running forever");
  assert.equal(entry.activeTool.timedOut, true);
  assert.equal(h.terminations.length, 1, "the timed-out launch's process tree is terminated, not just relabelled");
  assert.equal(h.terminations[0].pid, entry.pid, "the worker's whole tree goes, taking the spawned server with it");
  assert.match(entry.stopping.reason, /process tree/);
  tools = [{ ...tools[0], id: "launch-2", startedAt: h.now(), updatedAt: h.now() }];
  await poll();
  assert.equal(entry.activeTool.id, "launch-2");
  assert.equal(entry.activeTool.status, "running", "a replacement tool starts its own bounded wait");
  assert.equal(h.terminations.length, 1, "repeated polls never re-stop the timed-out launch");
  tools = [];
  await poll();
  assert.equal(entry.activeTool, null, "a tool that finishes normally still clears on the next read");
  entry.finished = true;
});

test("plain output asks for a lazy checkpoint while a session bind still saves within a second", async () => {
  const h = executorHost({ tasks: [task("lazy-output")] });
  h.wake(); await h.pump();
  const entry = h.autopilot.jobs[0];
  entry.child.stdout.emit("data", "\u001b[0m\nStill editing the serializer\n");
  const lazy = h.timers.filter((timer) => timer.delay === 30000 && !timer.cancelled);
  assert.equal(lazy.length, 1, "an ordinary output line arms one 30 s save");
  assert.equal(h.timers.some((timer) => timer.delay === 1000 && !timer.cancelled), false);
  assert.deepEqual(Array.from(entry.outputTail), ["Still editing the serializer"], "a bare colour reset is not kept as output");
  h.session(entry.id, "lazy-session");
  assert.equal(await h.env.attributeRunSession(await h.env.getEyes(), entry), true);
  assert.equal(lazy[0].cancelled, true, "a sooner request replaces the lazy timer");
  const save = h.timers.find((timer) => timer.delay === 1000 && !timer.cancelled);
  assert.ok(save, "the session bind keeps its 1 s save");
  entry.child.stdout.emit("data", "More output\n");
  assert.equal(h.timers.filter((timer) => !timer.cancelled && timer.delay === 30000).length, 0, "later output never pushes the sooner save back");
  await save.fn();
  assert.equal(h.board().tasks[0].runProgress.sessionId, "lazy-session");
});

for (const controls of [{ paused: true }, { execute: false }]) test(`restart respects saved ${controls.paused ? "assistant Pause" : "executor Pause"} while preserving progress`, async () => {
  const h = executorHost({ tasks: [savedTask()], ...controls });
  h.wake(); await h.pump();
  assert.equal(h.starts.length, 0); assert.equal(h.board().tasks[0].runProgress.sessionId, "previous-session");
  h.state.status = "running";
  await h.env.setAutopilot({ execute: true }); h.wake(); await h.pump();
  assert.deepEqual(h.starts.map((row) => row.taskId), ["interrupted"]);
  assert.match(h.starts[0].child.prompt, /previous-session/);
  assert.equal(h.board().tasks[0].runFailures, 2); assert.equal(h.board().tasks[0].verifyAttempts, 1);
});

for (const processes of [{ livePids: [80] }, { livePids: [81] }, { unknownPids: [80], livePids: [] }]) test(`restart cannot duplicate a still owned worker (${JSON.stringify(processes)})`, async () => {
  const old = savedTask({ lease: { pid: 80, at: 1 } });
  const h = executorHost({ ...processes, tasks: [old, task("independent", { createdAt: 2 })] });
  h.wake(); await h.pump();
  assert.deepEqual(h.starts.map((row) => row.taskId), ["independent"]);
  const retained = h.board().tasks[0];
  assert.equal(retained.status, "active"); assert.equal(retained.runId, old.runId);
  assert.equal(retained.runProgress.pending, false); assert.equal(h.terminations.length, 0);
});

test("a checkpoint delayed by storage cannot overwrite a replacement owner or resurrect a completed row", async () => {
  const h = executorHost({ tasks: [task("fenced")] });
  h.wake(); await h.pump();
  const entry = h.autopilot.jobs[0];
  await h.env.queueExecutorCheckpoint(entry, { force: true });
  const mutate = h.env.mutateBoard;
  let release;
  h.env.mutateBoard = async (fn) => { await new Promise((resolve) => { release = resolve; }); return mutate(fn); };
  entry.outputTail = ["stale output"];
  const save = h.env.persistExecutorCheckpoint(entry);
  assert.equal(typeof release, "function");
  h.edit((board) => Object.assign(board.tasks[0], { status: "done", runId: "new-owner", runProgress: { runId: "new-owner", outputTail: ["new owner's progress"] } }));
  const before = h.board();
  release(); await save;
  assert.deepEqual(h.board(), before);
});

test("a temporary checkpoint write failure retries without spending the task failure budget", async () => {
  const h = executorHost({ tasks: [task("retry-save", { runFailures: 2, verifyAttempts: 1 })] });
  h.wake(); await h.pump();
  const entry = h.autopilot.jobs[0];
  await h.env.queueExecutorCheckpoint(entry, { force: true });
  h.failNextWrite(); entry.outputTail = ["work completed before the temporary storage outage"];
  await h.env.queueExecutorCheckpoint(entry, { force: true });
  const retry = h.timers.find((timer) => timer.delay === 5000 && !timer.cancelled);
  assert.ok(retry); await retry.fn();
  const row = h.board().tasks[0];
  assert.match(row.runProgress.outputTail.join("\n"), /temporary storage outage/);
  assert.equal(row.runFailures, 2); assert.equal(row.verifyAttempts, 1);
  assert.equal(row.status, "active"); assert.equal(h.starts.length, 1); assert.equal(h.terminations.length, 0);
});

for (const reason of ["pause", "machine lease"]) test(`a restored task keeps its continuation when ${reason} cancels its new claim before launch`, async () => {
  const h = executorHost({ tasks: [savedTask()] });
  await h.env.autopilotHousekeeping();
  const checkpoint = h.board().tasks[0].runProgress;
  let reads = 0;
  h.machine.leaseStatus = async () => {
    if (++reads === 2) {
      if (reason === "pause") h.state.status = "paused";
      else return { exclusive: true };
    }
    return { exclusive: false };
  };
  assert.ok(["empty", "busy"].includes(await h.env.spawnNextJob()));
  assert.equal(h.starts.length, 0); assert.equal(h.autopilot.jobs.length, 0); assert.equal(h.registry.size, 0);
  const saved = h.board().tasks[0];
  assert.equal(saved.status, "open"); assert.equal(saved.runId, undefined); assert.equal(saved.lease, undefined);
  assert.deepEqual(saved.runProgress, checkpoint, "releasing a prelaunch claim must retain its original continuation");
  assert.equal(saved.runFailures, 2); assert.equal(saved.verifyAttempts, 1);
  h.state.status = "running"; h.wake(); await h.pump();
  assert.equal(h.starts.length, 1); assert.match(h.starts[0].child.prompt, /previous-session/);
  assert.match(h.starts[0].child.prompt, /Verify empty input/);
});

test("normal quit awaits one final checkpoint for each unfinished worker before exiting", async () => {
  let beforeQuit, prevented = 0, quits = 0;
  const saved = [], releases = [], events = [];
  const entries = [{ id: "first", finished: false }, { id: "second", finished: false }, { id: "settled", finished: true }];
  const env = vm.createContext({
    autopilot: { jobs: entries }, executorClosing: false,
    app: { on: (name, fn) => { assert.equal(name, "before-quit"); beforeQuit = fn; }, quit: () => { quits++; events.push("quit"); } },
    performanceProfiler: { stop: () => events.push("profiler-stopped") }, jevProjectQueues: new Map(),
    stopAssistant: () => events.push("helpers-saved"),
    // Session continuity: a quit the user asked for is recorded before the
    // wind-down, so the next launch asks for a folder instead of resuming.
    endSession: (exit) => events.push(`session:${exit}`),
    queueExecutorCheckpoint: (entry, options) => {
      assert.equal(options.force, true); saved.push(entry.id);
      return new Promise((resolve) => releases.push(() => { events.push(`saved:${entry.id}`); resolve(); }));
    },
    executeNextRequest: () => assert.fail("quitting cannot start new work"),
  });
  vm.runInContext(section("let quitCheckpointSaved = false;", 'process.on("exit",'), env);
  const event = { preventDefault: () => { prevented++; } };
  beforeQuit(event); beforeQuit(event);
  assert.equal(env.executorClosing, true); assert.equal(env.app.isQuitting, true);
  assert.equal(events[0], "session:quit", "the user's own quit is recorded before anything winds down, so the next launch asks for a folder");
  assert.equal(prevented, 2); assert.equal(quits, 0); assert.deepEqual(saved, ["first", "second"]);
  releases[0](); await new Promise(setImmediate);
  assert.equal(quits, 0, "all running workers must reach the checkpoint boundary");
  releases[1](); await new Promise(setImmediate);
  assert.equal(quits, 1); assert.equal(events.at(-1), "quit");
  beforeQuit(event);
  assert.equal(prevented, 2, "the confirmed exit does not start another save cycle");
  assert.deepEqual(saved, ["first", "second"]);
});

for (const duringQuit of [false, true]) test(`${duringQuit ? "quit's final" : "a forced"} checkpoint preserves progress arriving as the initial write settles`, async () => {
  const h = executorHost({ tasks: [task("immediate-output")] });
  assert.equal(await h.env.spawnNextJob(), "spawned");
  const entry = h.autopilot.jobs[0];
  h.session(entry.id, "immediate-session");
  assert.equal(await h.env.attributeRunSession(await h.env.getEyes(), entry), true);
  entry.child.stdout.emit("data", "Progress emitted immediately after spawn\n");
  if (duringQuit) {
    let beforeQuit, resolveQuit, prevented = false;
    const quit = new Promise((resolve) => { resolveQuit = resolve; });
    Object.assign(h.env, {
      executorClosing: false, performanceProfiler: { stop() {} }, jevProjectQueues: new Map(), stopAssistant() {}, endSession() {},
      app: { on: (_name, fn) => { beforeQuit = fn; }, quit: () => resolveQuit() },
    });
    vm.runInContext(section("let quitCheckpointSaved = false;", 'process.on("exit",'), h.env);
    beforeQuit({ preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
    await quit;
  } else await h.env.queueExecutorCheckpoint(entry, { force: true });
  const checkpoint = h.board().tasks[0].runProgress;
  assert.equal(checkpoint.sessionId, "immediate-session");
  assert.match(checkpoint.outputTail.join("\n"), /Progress emitted immediately after spawn/);
  assert.equal(checkpoint.workerPid, entry.pid); assert.equal(h.starts.length, 1);
});

test("the real view reload saves navigation without stopping or redispatching the active worker", async () => {
  const h = executorHost({ tasks: [task("view-reload")] });
  h.wake(); await h.pump();
  const worker = h.autopilot.jobs[0];
  worker.child.stdout.emit("data", "Progress already made before renderer reload\n");
  await h.env.queueExecutorCheckpoint(worker, { force: true });
  const board = h.board(), events = [];
  let didLoad;
  Object.assign(h.env, {
    window: { isDestroyed: () => false, webContents: {
      once: (name, fn) => { assert.equal(name, "did-finish-load"); didLoad = fn; },
      reloadIgnoringCache: () => events.push("renderer-reload"),
    } },
    saveResume: async () => events.push("navigation-saved"),
    send: (_name, event) => events.push(event.phase), updateEvent: (event) => event, updater: { status: () => ({ auto: true }) },
    stopAssistant: () => assert.fail("a view reload must keep the assistant service running"),
    executeNextRequest: () => assert.fail("a view reload must not redispatch active work"),
  });
  vm.runInContext(section("async function applyReload(", "// Styles land in the live page"), h.env);
  assert.equal((await h.env.applyReload(["renderer/boot.js"])).ok, true);
  assert.deepEqual(events, ["navigation-saved", "renderer-reload"]);
  didLoad(); assert.deepEqual(events, ["navigation-saved", "renderer-reload", "reloaded"]);
  assert.equal(h.starts.length, 1); assert.equal(h.autopilot.jobs[0], worker); assert.equal(h.terminations.length, 0);
  assert.deepEqual(h.board(), board);
});
