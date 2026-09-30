// Build it's sizing strip is honest about a fallback (renderer/vibe-flow.js).
// When the lead could not size a request (no lead model, a timeout, a reply
// that could not be used, or more steps than a plan may hold), main.cjs
// vibeBuild keeps it one card and its sized step says why (size "kept",
// `why`). The strip used to read "Best as one task" and "Added as one task"
// there, as if the lead had chosen it.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const flowSource = await readFile(new URL("../renderer/vibe-flow.js", import.meta.url), "utf8");
const P = "p1";

function load() {
  const storage = new Map();
  const context = vm.createContext({
    window: {}, console,
    document: { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null, hidden: false },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) },
    setTimeout: () => 0,
  });
  vm.runInContext(flowSource, context);
  const flow = context.window.MefiVibeFlow;
  const sized = (payload) => {
    const run = flow.begin("size", { projectId: P, title: "Add a save system" });
    flow.event({ requestId: run.id, projectId: P, stage: "quick", verdict: "maybe" });
    flow.event({ requestId: run.id, projectId: P, stage: "sizing", seat: "lead", provider: "zen", model: "gpt-6-sol" });
    flow.event({ requestId: run.id, projectId: P, stage: "sized", ...payload });
    flow.event({ requestId: run.id, projectId: P, stage: "adding" });
    return run;
  };
  return { flow, storage, sized };
}

test("a sizing that failed says so, never that the lead chose one task", () => {
  const { flow, storage, sized } = load();
  const cases = [
    ["timeout", "The lead took too long, so it's one task"],
    ["no-answer", "No lead model answered, so it's one task"],
    ["too-many", "The plan had too many steps, so it's one task"],
    ["unusable", "Couldn't plan steps, so it's one task"],
    ["error", "Couldn't plan steps, so it's one task"],
    [undefined, "Couldn't plan steps, so it's one task"],
  ];
  for (const [why, detail] of cases) {
    const run = sized({ size: "kept", ...(why ? { why } : {}) });
    run.startedAt -= 60000;
    const plan = flow.stages(run).find((stage) => stage.key === "split");
    assert.equal(plan.state, "done", String(why));
    assert.equal(plan.detail, detail, String(why));
    assert.doesNotMatch(plan.detail, /Best as one task/);
    flow.end(run.id, { ok: true, steps: 0 });
    assert.equal(flow.headline(run), "Couldn't plan steps, so it's one task", String(why));
    assert.equal(flow.stages(run).find((stage) => stage.key === "board").detail, "One task", "it did go on the board as one task");
  }
  assert.equal(storage.has("mefiStudio.vibe.flowTimes"), false, "a failed or timed-out sizing is no measure of the usual time");
});

test("the lead's own one-task answer still reads as its choice", () => {
  const { flow, storage, sized } = load();
  const run = sized({ size: "one" });
  run.startedAt -= 20000;
  assert.equal(flow.stages(run).find((stage) => stage.key === "split").detail, "Best as one task");
  flow.end(run.id, { ok: true, steps: 0 });
  assert.equal(flow.headline(run), "Added as one task");
  assert.ok(storage.has("mefiStudio.vibe.flowTimes"), "a lead that answered teaches the usual time");
});
