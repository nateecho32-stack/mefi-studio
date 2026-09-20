import test from "node:test";
import assert from "node:assert/strict";
import { canPlan, parsePlan, admit, reconcile } from "../scripts/task-delegation.cjs";
import { buildScope, dependencyIds, workState, hasBuildApproval } from "../scripts/backlog.cjs";
import { compact, housekeepingSweep, tidy } from "../scripts/assistant.mjs";

const proposal = () => ({ summary: "Build the parser and its interface, then integrate the result.", subtasks: [
  { title: "Implement parser", prompt: "Implement parsing of the supplied task syntax.", files: ["scripts/parser.cjs"], acceptance: ["Invalid syntax returns an explicit error."] },
  { title: "Implement editor", prompt: "Add editor controls for the supplied task syntax.", files: ["renderer/editor.js"], acceptance: ["The controls are keyboard accessible."] },
] });
function fixture(kind = "task") {
  const parent = { id: "parent", title: "Task editor", prompt: "Build a parser and editor.", projectId: "project", projectPath: "C:/fixture", status: kind === "task" ? "active" : "running", runId: "run-parent", lease: { pid: 123, at: 100 }, runProgress: { pending: false, runId: "run-parent" } };
  const scope = buildScope(parent);
  parent.buildApproval = { version: 1, scope };
  return { board: { tasks: kind === "task" ? [parent] : [], requests: kind === "request" ? [parent] : [] }, parent,
    options: { kind, ref: structuredClone(parent), entry: { id: "run-parent", projectId: "project", projectPath: "C:/fixture" }, plan: proposal(), scope, now: 200 } };
}

test("only original tasks are eligible for one decomposition", () => {
  assert.equal(canPlan({ prompt: "Original work" }), true);
  for (const extra of [{ delegation: {} }, { delegatedFrom: {} }, { fromRun: "prior" }, { handoffId: "child" }, { parentTaskId: "parent" }, { depth: 1 }, { runProgress: { pending: true } }, { interruptedAttempt: {} }, { resumeCheckpoint: {} }]) assert.equal(canPlan({ prompt: "Work", ...extra }), false);
  assert.equal(canPlan(null), false);
});

test("plans require strict bounded JSON and at least two implementation scopes", () => {
  assert.deepEqual(parsePlan(JSON.stringify(proposal())), proposal());
  for (const input of ["```json\n" + JSON.stringify(proposal()) + "\n```", "null", "[]", "{}", JSON.stringify({ ...proposal(), extra: true }), JSON.stringify({ ...proposal(), subtasks: proposal().subtasks.slice(0, 1) }), JSON.stringify({ ...proposal(), subtasks: [...proposal().subtasks, ...proposal().subtasks] })]) assert.equal(parsePlan(input), null);
  for (const changes of [{ files: [] }, { acceptance: [] }, { prompt: "x".repeat(6001) }, { title: "" }, { files: "scripts/parser.cjs" }, { extra: true }]) {
    const plan = proposal(); Object.assign(plan.subtasks[0], changes);
    assert.equal(parsePlan(JSON.stringify(plan)), null);
  }
});

test("file scopes reject absolute, escaping and platform-unsafe paths", () => {
  for (const file of ["/etc/config", "C:/private/key", "C:config", "\\\\server\\share", "../secret", "scripts/../../secret", "./parser.cjs", "scripts//parser.cjs", "scripts/", ".git/config", "scripts/NUL.txt", "scripts/a?.cjs", "scripts/file. ", "scripts/file\u0000.cjs", "scripts/file\t.cjs"]) {
    const plan = proposal(); plan.subtasks[0].files = [file];
    assert.equal(parsePlan(JSON.stringify(plan)), null, file);
  }
  const plan = proposal(); plan.subtasks[0].files = ["scripts\\Parser.cjs", "scripts/parser.cjs"];
  assert.deepEqual(parsePlan(JSON.stringify(plan)).subtasks[0].files, ["scripts/parser.cjs"]);
  plan.subtasks[1].files = ["scripts/parser.cjs"];
  assert.ok(parsePlan(JSON.stringify(plan)), "overlapping scopes remain schedulable under ordinary file claims");
});

test("admission atomically releases the parent and creates durable separately approved slices", () => {
  const { board, parent, options } = fixture();
  const result = admit(board, options);
  assert.equal(result.admitted, true); assert.equal(result.added, 2);
  assert.equal(parent.status, "open"); assert.equal(parent.runId, undefined); assert.equal(parent.lease, undefined); assert.equal(parent.runProgress, undefined);
  assert.equal(parent.prompt, options.ref.prompt); assert.equal(buildScope(parent), options.scope); assert.equal(hasBuildApproval(parent), true);
  assert.deepEqual(dependencyIds(parent), result.childTaskIds);
  for (const [index, child] of board.tasks.slice(0, 2).entries()) {
    assert.equal(child.prompt, options.plan.subtasks[index].prompt);
    assert.deepEqual(child.acceptance, options.plan.subtasks[index].acceptance);
    assert.equal(child.parentTaskId, parent.id); assert.equal(child.fromRun, options.entry.id);
    assert.equal(child.delegatedFrom.scope, options.scope); assert.equal(child.projectId, parent.projectId);
    assert.equal(hasBuildApproval(child), false); assert.equal(workState(child, 300, { tasks: board.tasks, autoBuild: false }).stage, "approval");
    assert.equal(canPlan(child), false);
  }
  assert.equal(canPlan(parent), false);
  const saved = structuredClone(board);
  const replay = admit(board, options);
  assert.equal(replay.admitted, true); assert.equal(replay.added, 0); assert.deepEqual(board, saved);
  assert.deepEqual(admit(fixture().board, fixture().options).childTaskIds, result.childTaskIds);
});

test("parents wait for verified children, retaining missing and failed obligations", () => {
  const { board, parent, options } = fixture(); admit(board, options);
  assert.equal(workState(parent, 300, { tasks: board.tasks }).stage, "waiting");
  board.tasks[0].status = "awaiting_verification";
  board.tasks[1].status = "open"; board.tasks[1].runFailures = 5;
  assert.equal(workState(parent, 300, { tasks: board.tasks }).stage, "waiting");
  assert.equal(workState(parent, 300, { tasks: board.tasks.slice(1) }).stage, "blocked");
  board.tasks[0].status = "done";
  board.tasks[1].status = "archived";
  assert.equal(workState(parent, 300, { tasks: board.tasks }).stage, "waiting", "archiving an unverified child does not satisfy its obligation");
  board.tasks[1].doneAt = 300;
  assert.equal(workState(parent, 300, { tasks: board.tasks }).stage, "ready");
  assert.equal(workState(parent, 300, { tasks: board.tasks, autoBuild: false }).stage, "ready", "the approved parent keeps its integration scope");
});

test("ownership, scope, project and identity conflicts leave every board record unchanged", () => {
  for (const change of [
    ({ parent }) => { parent.runId = "another-run"; },
    ({ parent }) => { parent.prompt = "Changed scope"; },
    ({ options }) => { options.entry.projectId = "another-project"; },
    ({ options }) => { options.entry.projectPath = "C:/another-project"; },
    ({ options }) => { options.ref.projectId = "another-project"; },
    ({ options }) => { options.entry.resumeCheckpoint = { pending: true }; },
    ({ options }) => { options.plan.subtasks[0].files = ["../outside"]; },
    ({ board, options }) => { const other = fixture(); const child = admit(other.board, other.options).childTaskIds[0]; board.tasks.push({ id: child, title: "Unrelated" }); },
  ]) {
    const data = fixture(); change(data); const saved = structuredClone(data.board);
    assert.equal(admit(data.board, data.options).admitted, false); assert.deepEqual(data.board, saved);
  }
});

test("new claim checkpoints can delegate but edited scope cannot replay an old admission", () => {
  const { board, parent, options } = fixture();
  parent.runProgress.pending = true;
  assert.equal(admit(board, options).admitted, true, "new claim checkpoints are not implementation continuations");
  parent.prompt = "Changed original task";
  const saved = structuredClone(board);
  assert.equal(admit(board, options).admitted, false);
  assert.deepEqual(board, saved);
});

test("direct request parents retain identity and wait on durable child cards", () => {
  const { board, parent, options } = fixture("request");
  delete parent.id; delete options.ref.id; parent.at = 50; options.ref.at = 50;
  options.scope = buildScope(parent);
  const result = admit(board, options);
  assert.equal(result.admitted, true); assert.equal(parent.status, undefined); assert.equal(parent.runId, undefined);
  assert.match(board.tasks[0].delegatedFrom.parentRequestKey, /^request:/);
  assert.equal(board.tasks[0].delegatedFrom.parentTitle, parent.title);
  assert.equal(board.tasks[0].delegatedFrom.parentPrompt, parent.prompt);
  assert.equal(board.tasks[0].parentTaskId, null); assert.equal(workState(parent, 300, { tasks: board.tasks }).stage, "waiting");
  assert.equal(board.requests.length, 1); assert.deepEqual(dependencyIds(parent), result.childTaskIds);
});

test("delegated dependencies preserve explicit prerequisites and detect cycles", () => {
  const { board, parent, options } = fixture(); parent.dependsOn = ["prerequisite"]; options.ref.dependsOn = ["prerequisite"]; options.scope = buildScope(parent);
  admit(board, options); board.tasks.push({ id: "prerequisite", status: "done" });
  assert.deepEqual(dependencyIds(parent), ["prerequisite", ...parent.delegation.childTaskIds]);
  board.tasks[0].dependsOn = [parent.id];
  assert.match(workState(parent, 300, { tasks: board.tasks }).reason, /cycle/);
});

test("delegated request coordinators survive age, title, payload and resolved-collision cleanup", () => {
  const requests = ["audit", "collision", "collision"].map((source, index) => {
    const data = fixture("request");
    Object.assign(data.parent, { id: `request-${index}`, title: "Fix: same shared objective", source, at: 1, sessions: ["a", "b"], file: "shared.js" });
    data.options.ref = structuredClone(data.parent);
    data.options.scope = buildScope(data.parent);
    data.options.entry.id = data.parent.runId = `run-request-${index}`;
    assert.equal(admit(data.board, data.options).admitted, true);
    return data.parent;
  });
  const tasks = [{ id: "unrelated", title: requests[0].title, prompt: requests[0].prompt, status: "done" }];
  const now = 10 * 24 * 60 * 60 * 1000;
  assert.deepEqual(compact({ tasks, requests, collisions: [], now }).requests, requests);
  assert.deepEqual(housekeepingSweep({ tasks, requests, now }).requests, requests);
  assert.deepEqual(tidy({ tasks, requests, collisions: [], audit: { findings: [] }, now }).requests, requests);
});

test("only the exact promoted delegation can replace a request coordinator", () => {
  const { board, parent, options } = fixture("request"); admit(board, options);
  const promoted = { ...structuredClone(parent), id: "promoted-parent", status: "open" };
  for (const changed of [
    { ...promoted, delegation: undefined },
    { ...promoted, delegation: { ...promoted.delegation, fromRun: "another-run" } },
    { ...promoted, delegation: { ...promoted.delegation, scope: "changed" } },
    { ...promoted, delegation: { ...promoted.delegation, childTaskIds: ["another-child"] } },
  ]) assert.deepEqual(compact({ requests: [parent], tasks: [...board.tasks, changed], now: 300 }).requests, [parent]);
  assert.deepEqual(compact({ requests: [parent], tasks: [...board.tasks, promoted], now: 300 }).requests, []);
  assert.deepEqual(compact({ requests: [parent], tasks: [...board.tasks, { ...promoted, status: "archived" }], now: 300 }).requests, []);
});

test("root coordinators and children keep their stable IDs during grouping and deduplication", () => {
  const { board, parent, options } = fixture(); admit(board, options);
  const duplicate = { id: "duplicate", title: parent.title, prompt: parent.prompt, status: "open", updatedAt: 900 };
  const tasks = [...board.tasks, duplicate];
  const result = compact({ tasks, now: 1000, taskGroups: [{ title: "Shared editor", tasks: tasks.map((row) => row.title) }] });
  for (const row of board.tasks) assert.deepEqual(result.tasks.find((task) => task.id === row.id), row);
  assert.equal(result.report.taskPlanned, 0);
});

test("delegated children retain an explicit parent priority without inventing a new pin time", () => {
  for (const pinAt of [undefined, 42]) {
    const { board, parent, options } = fixture(); parent.pin = true; if (pinAt != null) parent.pinAt = pinAt;
    admit(board, options);
    for (const child of board.tasks.slice(0, 2)) { assert.equal(child.pin, true); assert.equal(child.pinAt, pinAt); }
  }
});

test("recovery restores a partially saved request family's exact child scope once", () => {
  const { board, parent, options } = fixture("request"); admit(board, options);
  const expected = structuredClone(board.tasks);
  assert.ok(parent.delegation.admissions.every((row) => row.delegatedFrom.parentPrompt === undefined), "snapshots avoid repeated whole-parent prompts");
  board.tasks = [];
  assert.deepEqual(reconcile(board, { now: 500 }), { recovered: 2, changed: true });
  for (const [index, child] of board.tasks.entries()) {
    for (const name of ["id", "title", "prompt", "files", "acceptance", "fromRun", "parentTaskId", "projectId", "projectPath", "delegatedFrom", "createdAt"]) assert.deepEqual(child[name], expected[index][name], name);
    assert.equal(child.status, "open"); assert.equal(child.updatedAt, 500); assert.equal(child.buildApproval, undefined);
  }
  const saved = structuredClone(board);
  assert.deepEqual(reconcile(board, { now: 600 }), { recovered: 0, changed: false }); assert.deepEqual(board, saved);
});

test("recovery preserves failed and running children and never substitutes another project's records", () => {
  for (const state of [{ status: "active", runId: "live", lease: { pid: 11, at: 450 } }, { status: "open", runFailures: 5, verification: { state: "failed" } }]) {
    const { board, parent, options } = fixture(); admit(board, options);
    Object.assign(board.tasks[0], state);
    const retained = structuredClone(board.tasks[0]); board.tasks.splice(1, 1);
    assert.equal(reconcile(board, { now: 500 }).recovered, 1);
    assert.deepEqual(board.tasks.find((row) => row.id === retained.id), retained);
    assert.equal(workState(parent, 500, { tasks: board.tasks }).stage, "waiting");
  }
  const { board, parent, options } = fixture(); admit(board, options);
  Object.assign(board.tasks[0], { projectId: "foreign-project", status: "done" });
  board.tasks[1].status = "done";
  const saved = structuredClone(board);
  assert.equal(reconcile(board, { now: 500 }).recovered, 0); assert.deepEqual(board, saved);
  assert.equal(workState(parent, 500, { tasks: board.tasks }).stage, "blocked");
});

test("recovery rejects missing, altered, unsafe or foreign admission snapshots", () => {
  for (const corrupt of [
    (saved) => { delete saved.admissions; },
    (saved) => { saved.admissions[0].fromRun = "another-run"; },
    (saved) => { saved.admissions[0].id = "unrelated-child"; },
    (saved) => { saved.admissions[0].delegatedFrom.scope = "another-scope"; },
    (saved) => { saved.admissions[0].projectId = "foreign-project"; },
    (saved) => { saved.admissions[0].files = ["../outside.js"]; },
    (saved) => { saved.admissions[0].parentTaskId = "another-parent"; },
  ]) {
    const { board, parent, options } = fixture(); admit(board, options); board.tasks = [parent]; corrupt(parent.delegation);
    const saved = structuredClone(board);
    assert.deepEqual(reconcile(board, { now: 500 }), { recovered: 0, changed: false }); assert.deepEqual(board, saved);
    assert.equal(workState(parent, 500, { tasks: board.tasks }).stage, "blocked");
  }
});

test("finished coordinators never regenerate work, including stale inbox copies after promotion", () => {
  for (const status of ["done", "archived"]) {
    const { board, parent, options } = fixture(); admit(board, options); parent.status = status; board.tasks = [parent];
    assert.deepEqual(reconcile(board, { now: 500 }), { recovered: 0, changed: false });
    const requestData = fixture("request"); admit(requestData.board, requestData.options);
    requestData.board.tasks = [{ ...structuredClone(requestData.parent), id: "promoted", status }];
    assert.deepEqual(reconcile(requestData.board, { now: 500 }), { recovered: 0, changed: false });
  }
});

test("promoted coordinators recover request snapshots with the durable parent task link", () => {
  const { board, parent, options } = fixture("request"); admit(board, options);
  const promoted = { ...structuredClone(parent), id: "promoted-parent", status: "open" };
  board.tasks = [promoted];
  assert.equal(reconcile(board, { now: 500 }).recovered, 2);
  for (const child of board.tasks.slice(0, 2)) { assert.equal(child.parentTaskId, promoted.id); assert.equal(child.delegatedFrom.parentTaskId, promoted.id); }
  assert.deepEqual(reconcile(board, { now: 600 }), { recovered: 0, changed: false });
});

test("integration awaiting verification waits again if a child is reopened or missing", () => {
  const { board, parent, options } = fixture(); admit(board, options);
  parent.status = "awaiting_verification"; board.tasks[0].status = board.tasks[1].status = "done";
  assert.equal(workState(parent, 500, { tasks: board.tasks }).stage, "review");
  board.tasks[0].status = "open";
  assert.equal(workState(parent, 500, { tasks: board.tasks }).stage, "waiting");
  assert.equal(workState(parent, 500, { tasks: board.tasks.slice(1) }).stage, "blocked");
});
