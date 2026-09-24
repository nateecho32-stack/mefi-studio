// summarizeBacklog indexes the board once per pass. Every row must read
// exactly what the per-row functions, which index the board each call, read.
import test from "node:test";
import assert from "node:assert/strict";
import backlog from "../scripts/backlog.cjs";

const NOW = 1_000_000;

function board() {
  const tasks = [];
  const add = (id, extra = {}) => tasks.push({ id, title: `Task ${id}`, status: "open", createdAt: tasks.length, projectId: "p1", projectPath: "C:/Work/P1", ...extra });
  add("done", { status: "done", doneAt: 5 });
  add("waits", { dependsOn: ["done", "open"] });
  add("open");
  add("ready", { dependsOn: ["done"] });
  add("missing", { dependsOn: ["ghost"] });
  add("cycle_a", { dependsOn: ["cycle_b"] });
  add("cycle_b", { dependsOn: ["cycle_a"] });
  add("elsewhere", { projectId: "p2", projectPath: "D:/Other" });
  add("cross", { dependsOn: ["elsewhere"] });
  add("pathcase", { projectId: undefined, projectPath: "c:\\work\\p1\\", dependsOn: ["done"] });
  add("dup", { duplicateOf: "open" });
  add("dup_blocked", { duplicateOf: "missing" });
  add("dup_done", { duplicateOf: "done" });
  add("parent", { status: "awaiting_verification", delegation: { version: 1, childTaskIds: ["open", "done"], projectId: "p1" } });
  add("cooling", { nextRunAt: NOW + 1000, dependsOn: ["done"] });
  add("held", { status: "active" });
  add("archived_dep", { status: "archived", doneAt: 3 });
  add("after_archive", { dependsOn: ["archived_dep"] });
  add("grouped", { absorbedInto: "parent" });
  return tasks;
}

test("a summary pass reads every row exactly as the per-row functions do", () => {
  const tasks = board();
  const requests = [
    { title: "Inbox work", prompt: "do it", at: 1, dependsOn: ["open"] },
    { title: "Task ready", prompt: "represented on the board" },
    { title: "Loose request", prompt: "go", at: 2 },
  ];
  for (const autoBuild of [true, false]) {
    const summary = backlog.summarizeBacklog({ tasks, requests, jobs: [{ taskId: "held" }], now: NOW, autoBuild });
    const expected = tasks.map((task) => ({
      id: task.id, kind: "task", title: task.title,
      dependencies: backlog.dependencyState(task, tasks).dependencies,
      ...(task.id === "held" ? { stage: "running", reason: "A worker is building this task" } : backlog.workState(task, NOW, { tasks, autoBuild })),
    }));
    assert.deepEqual(summary.taskStates, expected);
    const inbox = summary.blocked.concat(summary.next).filter((row) => row.kind === "request");
    for (const row of inbox) {
      const request = requests.find((item) => item.title === row.title);
      const { id: _id, kind: _kind, title: _title, ...state } = row;
      assert.deepEqual(state, backlog.workState(request, NOW, { tasks, autoBuild }));
    }
  }
  const stages = Object.fromEntries(backlog.summarizeBacklog({ tasks, requests, now: NOW }).taskStates.map((row) => [row.id, row.stage]));
  assert.deepEqual(
    [stages.waits, stages.ready, stages.missing, stages.cycle_a, stages.cross, stages.pathcase, stages.dup, stages.dup_blocked, stages.parent, stages.after_archive],
    ["waiting", "ready", "blocked", "blocked", "blocked", "ready", "waiting", "blocked", "waiting", "ready"],
  );
});
