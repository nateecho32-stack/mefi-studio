import test from "node:test";
import assert from "node:assert/strict";
import { migrateLegacyRequests } from "../scripts/task-history.mjs";
import { compact, housekeepingSweep, tidy } from "../scripts/assistant.mjs";

const HOUR = 3600 * 1000;

// Only tasks run now; these are the inbox rows an older build left mid-run.
const verifying = {
  title: "Improve the project picker", prompt: "Keep the selected project visible", at: 100,
  projectId: "project-a", projectPath: "C:/projects/a", source: "fix", status: "verifying", runId: "run-1", runningAt: 150,
  lease: { pid: 40, at: 150 }, pin: true, pinAt: 90, target: { kind: "session", id: "ses_1" }, sessions: ["ses_1"],
  remaining: ["Wire the picker test"], verifyAttempts: 1, runFailures: 2, nextRunAt: 50, lastRunError: "exit 1",
  runProgress: { runId: "run-1", pending: false, todos: [{ content: "Picker", status: "completed" }] },
  verificationRun: { key: "verification:request:abc:run-1", state: "passed", at: 250, results: [{ command: "npm run check", ok: true, exitCode: 0 }] },
  lastAttempt: { runId: "run-1", startedAt: 150, at: 200, code: 0, sessionId: "session-1", result: { parts: { done: "Added picker" } } },
  logs: [{ at: 120, kind: "status", text: "queued" }],
};
const running = (extra = {}) => ({
  title: "Continue the serializer", prompt: "Finish the serializer", at: 10, source: "chat", status: "running",
  runId: "run-lost", runningAt: 20, lease: { pid: 77, at: 20 },
  runProgress: { version: 1, runId: "run-lost", pending: false, sessionId: "session-lost", outputTail: ["serializer half done"] },
  ...extra,
});

test("a legacy verifying request becomes the awaiting_verification task its verdict settles through", () => {
  const original = structuredClone(verifying);
  const other = { title: "Queued", prompt: "Still in the inbox", at: 5 };
  const out = migrateLegacyRequests([other, verifying], { now: 300, projectId: "fallback", projectPath: "C:/fallback" });
  assert.equal(out.changed, true);
  // Deliberately changed: the move is two-phase, so the row stays until a
  // pass finds its task on the board (the next test drops it there).
  assert.deepEqual(out.requests, [other, verifying], "the verifying row stays until its task is saved; the rest stays");
  assert.equal(out.tasks.length, 1);
  const task = out.tasks[0];
  assert.match(task.id, /^task_[0-9a-f]{16}$/);
  assert.equal(task.status, "awaiting_verification");
  assert.equal(task.title, verifying.title);
  assert.equal(task.prompt, verifying.prompt);
  assert.deepEqual(task.lastAttempt, verifying.lastAttempt);
  assert.equal(task.runId, "run-1", "the finished run's id rides along, as a task's does while it awaits verification");
  assert.deepEqual(task.runProgress, verifying.runProgress);
  assert.deepEqual(task.verificationRun, verifying.verificationRun, "the overseer's check still counts for this attempt");
  assert.deepEqual(task.remaining, ["Wire the picker test"]);
  assert.deepEqual(task.target, verifying.target);
  assert.deepEqual(task.sessions, ["ses_1"]);
  assert.equal(task.pin, true); assert.equal(task.pinAt, 90);
  assert.equal(task.verifyAttempts, 1, "the verification budget already spent stays spent");
  // Deliberately changed: promotion keeps a request's own source and stamps
  // its origin now (it used to rewrite every source but two to "a-eyes").
  assert.equal(task.source, "fix", "the request's own source rides along, as promotion keeps it");
  assert.deepEqual(task.origin, { kind: "request", by: "fix" }, "and its origin, the way promotion stamps it");
  assert.equal(task.createdAt, 100);
  assert.equal(task.updatedAt, 300);
  assert.equal(task.projectId, "project-a"); assert.equal(task.projectPath, "C:/projects/a");
  assert.equal(task.lease, undefined, "the old process's lease does not ride along");
  assert.equal(task.runningAt, undefined);
  for (const gone of ["runFailures", "nextRunAt", "lastRunError"]) assert.equal(task[gone], undefined, `a reported success ends the failure streak (${gone})`);
  assert.match(task.logs.at(-1).text, /moved from the request inbox to the board/);
  assert.equal(task.logs[0].text, "queued");
  assert.deepEqual(verifying, original, "migration never mutates the saved row");
  assert.equal(out.notes.length, 1);
  assert.match(out.notes[0], /was verifying; moved to the board as task task_/);
  const bare = migrateLegacyRequests([{ prompt: "p", status: "verifying", lastAttempt: { runId: "r" } }], { now: 5, projectId: "fallback", projectPath: "C:/fallback" }).tasks[0];
  assert.equal(bare.projectId, "fallback"); assert.equal(bare.projectPath, "C:/fallback");
  assert.equal(bare.title, "p");
});

test("the same verifying attempt maps to one task, and a task already on the board is not duplicated", () => {
  const first = migrateLegacyRequests([verifying], { now: 300 }).tasks[0];
  const again = migrateLegacyRequests([verifying], { now: 900 }).tasks[0];
  assert.equal(first.id, again.id);
  assert.notEqual(first.id, migrateLegacyRequests([{ ...verifying, lastAttempt: { ...verifying.lastAttempt, runId: "run-2" } }], { now: 300 }).tasks[0].id);
  const out = migrateLegacyRequests([verifying], { tasks: [first], now: 900 });
  assert.equal(out.tasks.length, 0);
  assert.deepEqual(out.requests, []);
  assert.match(out.notes[0], /already on the board/);
});

test("a legacy verifying delegation coordinator's children are relinked to its new task", () => {
  const scope = "a".repeat(64);
  const childIds = ["task_delegate_000000000000000000000001", "task_delegate_000000000000000000000002"];
  const coordinator = { ...verifying, delegation: { version: 1, childTaskIds: childIds, scope, fromRun: "run-0", admissions: [] } };
  const child = (id) => ({ id, title: `Slice ${id.slice(-1)}`, status: "done", parentTaskId: null, fromRun: "run-0",
    delegatedFrom: { parentTaskId: null, parentRequestKey: "request:abc", scope, parentTitle: verifying.title } });
  const unrelated = { id: "task_other", title: "Other", status: "open", delegatedFrom: { parentTaskId: null, scope } };
  const foreign = { ...child(childIds[1]), id: "task_delegate_000000000000000000000009" };
  const tasks = [child(childIds[0]), child(childIds[1]), unrelated, foreign, { ...child("task_delegate_000000000000000000000003"), parentTaskId: "task_kept" }];
  const before = structuredClone(tasks);
  const out = migrateLegacyRequests([coordinator], { tasks, now: 300 });
  const [task] = out.tasks;
  assert.ok(task.delegation, "the coordinator keeps its delegation");
  assert.deepEqual(out.relinked.map((row) => row.id), childIds);
  for (const row of out.relinked) {
    assert.equal(row.parentTaskId, task.id);
    assert.equal(row.delegatedFrom.parentTaskId, task.id);
    assert.equal(row.delegatedFrom.parentRequestKey, "request:abc", "the rest of the lineage stays");
  }
  assert.deepEqual(tasks, before, "the board's rows are not mutated; the caller swaps in the relinked copies");
  assert.match(out.notes[0], /its 2 delegated tasks now name it$/);
  // Seen again with its task already on the board: children that already
  // name a task are left alone.
  const again = migrateLegacyRequests([coordinator], { tasks: [task, ...out.relinked], now: 400 });
  assert.deepEqual(again.relinked, []);
  // An ordinary verifying row relinks nothing.
  assert.deepEqual(migrateLegacyRequests([verifying], { tasks, now: 300 }).relinked, []);
});

test("a legacy running request no live owner holds goes back to the inbox with its checkpoint", () => {
  const out = migrateLegacyRequests([running()], { now: 500 });
  assert.equal(out.changed, true);
  const row = out.requests[0];
  for (const gone of ["status", "runId", "lease", "runningAt"]) assert.equal(row[gone], undefined, gone);
  assert.equal(row.runProgress.sessionId, "session-lost", "the checkpoint is kept");
  assert.equal(row.runProgress.pending, false, "promotion skips a pending row, so the checkpoint is not left pending");
  assert.equal(row.interruptedAttempt.sessionId, "session-lost", "the task's brief quotes the lost run's progress");
  assert.equal(row.interruptedAttempt.interruptedAt, 500);
  assert.equal(out.tasks.length, 0);
  assert.match(out.notes[0], /was running \(run-lost\) with no live worker; back in the inbox for promotion/);
});

test("a running request a live owner holds, or whose lease names no usable pid, is left alone", () => {
  const live = running();
  const pidless = running({ runId: "run-old", lease: { at: 20 } });
  const rows = [live, pidless];
  const out = migrateLegacyRequests(rows, { liveRuns: new Set(["run-lost"]), now: 500 });
  assert.equal(out.changed, false);
  assert.equal(out.requests, rows, "an untouched inbox comes back as the same array");
  assert.deepEqual(out.notes, []);
});

test("a stopped or recovered direct run's pending checkpoint no longer blocks promotion", () => {
  const stopped = { title: "Stopped request", prompt: "x", at: 1, source: "chat",
    runProgress: { runId: "run-s", pending: true, interruptedAt: 40, sessionId: "session-s" }, interruptedAttempt: { runId: "run-s", pending: true, interruptedAt: 40 } };
  const out = migrateLegacyRequests([stopped], { now: 500 });
  const row = out.requests[0];
  assert.equal(row.runProgress.pending, false);
  assert.equal(row.runProgress.sessionId, "session-s");
  assert.deepEqual(row.interruptedAttempt, stopped.interruptedAttempt, "an existing interrupted attempt is kept as it was");
  assert.match(out.notes[0], /held a resume checkpoint/);
  const recovered = { title: "Recovered", prompt: "y", at: 2, runProgress: { runId: "run-r", pending: true, interruptedAt: 30 } };
  assert.equal(migrateLegacyRequests([recovered], { now: 500 }).requests[0].interruptedAttempt.interruptedAt, 30);
});

test("a verifying row leaves the inbox only once a later pass finds its task saved", () => {
  // The file store writes the inbox before the tasks: a failed tasks write
  // (or a quit between the two) after a one-step move lost the attempt.
  const first = migrateLegacyRequests([verifying], { now: 300 });
  assert.deepEqual(first.requests, [verifying], "phase one keeps the row");
  assert.equal(first.tasks.length, 1);
  // The task never reached the board: the next pass moves it again, same id.
  const retry = migrateLegacyRequests(first.requests, { tasks: [], now: 400 });
  assert.equal(retry.tasks[0].id, first.tasks[0].id);
  assert.deepEqual(retry.requests, [verifying]);
  // Saved: now the row goes, and nothing is added twice.
  const settled = migrateLegacyRequests(retry.requests, { tasks: retry.tasks, now: 500 });
  assert.deepEqual(settled.requests, []);
  assert.deepEqual(settled.tasks, []);
});

test("a lost auto-filed claim put back in the inbox survives the same pass's age prune and the compactor", () => {
  const now = 100 * HOUR, filed = now - 72 * HOUR;
  const lost = { title: "Fix: serializer drops empty input", prompt: "Find the root cause of the serializer bug", at: filed, source: "fix",
    status: "running", runId: "run-old", runningAt: filed, lease: { pid: 77, at: filed },
    runProgress: { version: 1, runId: "run-old", pending: false, sessionId: "session-old" } };
  const parked = { title: "Resolve collision: a.lua", prompt: "Resolve the collision on a.lua", at: filed, source: "collision",
    runProgress: { runId: "run-parked", pending: true, interruptedAt: filed + HOUR } };
  const untouched = { title: "Audit: an old finding", prompt: "An audit finding nobody took", at: filed, source: "audit" };
  const migrated = migrateLegacyRequests([lost, parked, untouched], { now });
  assert.deepEqual(migrated.requests.map((row) => row.requeuedAt ?? null), [now, now, null], "a row put back in the inbox restarts its age clock");
  // The sweep runs in the same mutation as the migration (autopilotHousekeepingPass).
  const swept = housekeepingSweep({ requests: migrated.requests, tasks: [], liveRuns: new Set(), now, pid: 1 });
  assert.deepEqual(swept.requests.map((row) => row.title), [lost.title, parked.title], "only the row nobody touched ages out");
  assert.equal(swept.report.requestsPruned, 1);
  assert.equal(swept.requests[0].interruptedAttempt.sessionId, "session-old", "the checkpoint rides on for promotion");
  // The compactor's 12-hour expiry reads the same clock, then ages them out like any auto request.
  assert.deepEqual(compact({ requests: swept.requests, tasks: [], now: now + HOUR }).requests.map((row) => row.title), [lost.title, parked.title]);
  assert.deepEqual(compact({ requests: swept.requests, tasks: [], now: now + 13 * HOUR }).requests, []);
  // So does the keeper's three-day rule for auto-filed rows: filed 73 hours
  // ago but put back an hour ago, both wait for promotion.
  assert.deepEqual(tidy({ requests: swept.requests, now: now + HOUR }).requests.map((row) => row.title), [lost.title, parked.title]);
  assert.deepEqual(tidy({ requests: swept.requests.map(({ requeuedAt, ...row }) => row), now: now + HOUR }).requests, [], "without the requeue they are three days old");
  // The sweep's own requeue of a timed-out claim (a lease with no usable pid) restarts it too.
  const timedOut = { title: "Fix: y", prompt: "y", at: filed, source: "fix", status: "running", runId: "run-pidless", lease: { at: filed } };
  const requeued = housekeepingSweep({ requests: [timedOut], tasks: [], liveRuns: new Set(), now, pid: 1 });
  assert.equal(requeued.report.requestsRequeued, 1);
  assert.equal(requeued.requests.length, 1, "requeued, not pruned in the same pass");
  assert.equal(requeued.requests[0].requeuedAt, now);
});

test("an ordinary inbox is returned untouched", () => {
  const rows = [{ title: "Queued", prompt: "a", at: 1 }, null, { title: "Cooling", prompt: "b", at: 2, nextRunAt: 99, runProgress: { pending: false } }];
  const out = migrateLegacyRequests(rows, { now: 10 });
  assert.equal(out.requests, rows);
  assert.equal(out.changed, false);
  assert.deepEqual(out.tasks, []);
});

test("housekeeping preserves distinct completed attempts with the same title", () => {
  const done = (id, runId, doneAt) => ({ id, title: "Improve the project picker", prompt: "Keep the selected project visible", status: "done", doneAt, lastAttempt: { runId } });
  const first = done("first", "run-1", 300);
  const second = done("second", "run-2", 400);
  const duplicate = { ...second, id: "duplicate-card", status: "archived" };
  const result = compact({ requests: [], tasks: [first, second, duplicate], ideas: [], now: 500 });
  assert.equal(result.tasks.length, 2, "only the duplicate stamp of run-2 is removed");
  assert.deepEqual(result.tasks.map((task) => task.lastAttempt.runId).sort(), ["run-1", "run-2"]);
});

test("manual completions with the same title retain distinct task history", () => {
  const tasks = [
    { id: "one", title: "Publish weekly update", status: "done", doneAt: 100 },
    { id: "two", title: "Publish weekly update", status: "archived", doneAt: 200 },
  ];
  const result = compact({ tasks, now: 300 });
  assert.equal(result.tasks.length, 2);
});
