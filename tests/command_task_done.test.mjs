import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

// The Command view's Done button once rewrote the whole board through
// tasks:save, which never takes status from a form: it only appended a
// "marked done" log line while the toast claimed success. It now uses the
// same targeted status action as the task board, and reports refusals.
const source = await readFile(new URL("../renderer/idle.js", import.meta.url), "utf8");
const doneSource = source.slice(source.indexOf("  async function confirmTaskDone("), source.indexOf("  function pillOf("));

function environment(tasksAction) {
  const calls = [], saves = [];
  const context = vm.createContext({
    window: { mefiStudio: { tasksAction: tasksAction && (async (payload) => { calls.push(payload); return tasksAction(payload); }), tasksSave: async (rows) => { saves.push(rows); return { ok: true }; } } },
  });
  vm.runInContext(`${doneSource}\nthis.confirmTaskDone = confirmTaskDone;`, context);
  return { confirm: context.confirmTaskDone, calls, saves };
}

test("Done confirms one task through the targeted status action and never saves the board", async () => {
  const env = environment(() => ({ ok: true }));
  assert.deepEqual({ ...(await env.confirm({ id: "task-a", projectId: "project-a", title: "A" })) }, { ok: true });
  assert.deepEqual(JSON.parse(JSON.stringify(env.calls)), [{ action: "status", status: "done", taskId: "task-a", projectId: "project-a" }]);
  assert.equal(env.saves.length, 0);
});

test("a refused or failed Done reports the host's reason instead of success", async () => {
  const refused = environment(() => ({ ok: false, error: "This task has a worker. Let it finish before changing its status or title." }));
  assert.match((await refused.confirm({ id: "busy" })).error, /has a worker/);
  const thrown = environment(() => { throw new Error("IPC closed"); });
  assert.equal((await thrown.confirm({ id: "x" })).error, "IPC closed");
  const missing = environment(null);
  assert.equal((await missing.confirm({ id: "x" })).ok, false);
});

test("the constellation offers no Activate that the host would refuse", () => {
  assert.doesNotMatch(source, /action\("Activate"/, "working status is set only when a worker claims the task");
  assert.doesNotMatch(source, /patchTask\(/);
});
