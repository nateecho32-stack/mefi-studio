// idle.js on a project switch: the board's layout caches reset, and the graph
// is rebuilt only after tree3d's project-scoped reload lands — the startup
// adoption must not trigger either.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../renderer/idle.js", import.meta.url), "utf8");
const listener = source.slice(source.indexOf("  // A project switch re-scopes"), source.indexOf("  async function refreshTasks("));
assert.ok(listener.includes("function projectChanged("), "idle.js must keep the named projectChanged handler");

function environment({ active = false } = {}) {
  let resolveReady = null;
  const ready = () => new Promise((resolve) => { resolveReady = resolve; });
  let readyCalls = 0;
  const calls = { graph: 0, telemetry: 0, feed: 0 };
  const state = {
    active,
    projectId: null,
    screenLayout: { seeded: true },
    agentLayout: new Map([["worker", { x: 1 }]]),
    agentSeq: { worker: 3 },
    taskLayout: new Map([["task:old", { x: 1 }]]),
    graphSeeded: true,
    backlogRevision: 4,
    backlogReadAt: 99,
    backlog: { summary: "old" },
    backlogError: "old",
    feedDirty: false,
    readyPromise: null,
  };
  const context = vm.createContext({
    state,
    Map,
    Boolean,
    Promise,
    window: { MefiTree: { ready: () => { readyCalls += 1; return ready(); } } },
    refreshGraph: () => { calls.graph += 1; },
    updateTelemetry: () => { calls.telemetry += 1; },
    renderFeed: () => { calls.feed += 1; },
  });
  vm.runInContext(listener, context);
  return {
    state,
    calls,
    readyCalls: () => readyCalls,
    finishReady: () => resolveReady?.(),
    changed: (projectId) => context.projectChanged({ detail: { projectId } }),
  };
}

test("the startup adoption names the folder without reloading the board", () => {
  const env = environment();
  env.changed("project-a");
  assert.equal(env.state.projectId, "project-a");
  assert.equal(env.readyCalls(), 0, "the initial reads already cover the adopted folder");
  assert.equal(env.calls.graph, 0);
});

test("a real switch resets layout state and rebuilds only after the tree reload lands", async () => {
  const env = environment({ active: true });
  env.changed("project-a");
  env.changed("project-a");
  assert.equal(env.readyCalls(), 0, "an unchanged project never reloads");

  env.changed("project-b");
  assert.equal(env.state.projectId, "project-b");
  assert.equal(env.state.screenLayout, null);
  assert.equal(env.state.agentLayout.size, 0);
  assert.equal(env.state.agentSeq && Object.keys(env.state.agentSeq).length, 0);
  assert.equal(env.state.taskLayout.size, 0);
  assert.equal(env.state.graphSeeded, false);
  assert.equal(env.state.backlogRevision, 7);
  assert.equal(env.state.backlogReadAt, 0);
  assert.equal(env.state.backlog, null);
  assert.equal(env.state.backlogError, null);
  assert.equal(env.state.feedDirty, true);
  assert.equal(env.calls.feed, 3, "the live feed repaints on project events");
  assert.equal(env.readyCalls(), 1);
  await Promise.resolve();
  assert.equal(env.calls.graph, 0, "the old snapshot is never taken after a switch");
  env.finishReady();
  await env.state.readyPromise;
  assert.equal(env.calls.graph, 1);
  assert.equal(env.calls.telemetry, 1);
});

test("a hidden Command view still resets but does not repaint its feed", async () => {
  const env = environment();
  env.changed("project-a");
  env.changed("project-b");
  assert.equal(env.calls.feed, 0);
  env.finishReady();
  await env.state.readyPromise;
  assert.equal(env.calls.graph, 1, "the snapshot is kept current while the view is closed");
});
