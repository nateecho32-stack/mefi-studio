// A task's pipeline is drawn before it starts and then moved only by what the
// host saw happen. It has to keep its shape valid, never grow past its caps,
// and never touch the object it was handed.
import test from "node:test";
import assert from "node:assert/strict";
import pipelines from "../scripts/pipelines.cjs";
import brains from "../scripts/brains.cjs";

const {
  STEP_KINDS, LIMITS, STEP_MARK, parseStepLine, createPipeline, advance, summary, signature,
  validatePipeline, recipeSteps, draftPrompt, parseDraft,
} = pipelines;

const NOW = 1_790_000_000_000;
const kinds = (pipeline) => pipeline.steps.map((step) => step.kind);
const step = (pipeline, kind, nth = 0) => pipeline.steps.filter((item) => item.kind === kind)[nth];
const titled = (pipeline, title) => pipeline.steps.find((item) => item.title === title);
const freeze = (value) => {
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
};
// Runs events in order the way the host would, checking every result.
const play = (pipeline, list, options = {}) => {
  let current = pipeline;
  const events = [];
  for (const event of list) {
    const result = advance(freeze(current), event, { now: NOW + 1, ...options });
    assert.equal(validatePipeline(result.pipeline).ok, true, validatePipeline(result.pipeline).errors.join("; "));
    events.push(...result.events);
    current = result.pipeline;
  }
  return { pipeline: current, events };
};
const task = { id: "task_a", title: "Retry banner", prompt: "Show a retry banner when a save fails." };

test("the constants are frozen and every kind names a real brain-map part", () => {
  assert.ok(Object.isFrozen(STEP_KINDS));
  assert.ok(Object.isFrozen(STEP_KINDS.build));
  assert.ok(Object.isFrozen(LIMITS));
  assert.deepEqual({ ...LIMITS }, { maxSteps: 12, maxGrowthPerRun: 3, maxTitle: 80 });
  assert.equal(STEP_MARK, "MEFI_STEP:");
  assert.deepEqual(Object.keys(STEP_KINDS), ["read", "map", "plan", "build", "test", "verify", "land", "call"]);
  assert.deepEqual(STEP_KINDS.read, { label: "Read the ask", part: "analyze.scope" });
  assert.deepEqual(STEP_KINDS.call, { label: "Recipe", part: "brain.call" });
  const parts = new Set(brains.NODE_TYPES.map((type) => type.type));
  for (const [kind, spec] of Object.entries(STEP_KINDS)) assert.ok(parts.has(spec.part), `${kind} → ${spec.part}`);
});

test("the template is read, build, test, verify, land, chained in order", () => {
  const pipeline = createPipeline({ task, now: NOW });
  assert.equal(pipeline.v, 1);
  assert.equal(pipeline.taskId, "task_a");
  assert.equal(pipeline.source, "template");
  assert.equal(pipeline.recipeId, null);
  assert.equal(pipeline.createdAt, NOW);
  assert.equal(pipeline.updatedAt, NOW);
  assert.deepEqual(pipeline.growth, { runId: null, count: 0 });
  assert.equal(pipeline.done, false);
  assert.deepEqual(kinds(pipeline), ["read", "build", "test", "verify", "land"]);
  assert.deepEqual(pipeline.steps.map((item) => item.id), ["s1", "s2", "s3", "s4", "s5"]);
  assert.deepEqual(pipeline.steps.map((item) => item.parents), [[], ["s1"], ["s2"], ["s3"], ["s4"]]);
  assert.deepEqual(pipeline.steps.map((item) => item.title), ["Read the ask", "Build", "Test", "Verify", "Land"]);
  for (const item of pipeline.steps) {
    assert.equal(item.status, "queued");
    assert.equal(item.owner, null);
    assert.equal(item.model, null);
    assert.equal(item.startedAt, null);
    assert.equal(item.doneAt, null);
    assert.equal(item.folded, false);
    assert.equal(item.grown, false);
  }
  assert.equal(validatePipeline(pipeline).ok, true);
  assert.equal(signature(pipeline), "read>build*1>test>verify>land");
});

test("document work writes instead of builds, and systemic work plans first", () => {
  const writing = createPipeline({ task, shape: { intent: "document", complexity: "atomic" }, now: NOW });
  assert.deepEqual(kinds(writing), ["read", "build", "test", "verify", "land"]);
  assert.equal(step(writing, "build").title, "Write");
  const systemic = createPipeline({ task, shape: { intent: "implement", complexity: "systemic" }, now: NOW });
  assert.deepEqual(kinds(systemic), ["read", "plan", "build", "test", "verify", "land"]);
  assert.deepEqual(step(systemic, "plan").parents, ["s1"]);
  assert.deepEqual(step(systemic, "build").parents, ["s2"]);
  const both = createPipeline({ task, shape: { intent: "document", complexity: "systemic" }, now: NOW });
  assert.deepEqual(kinds(both), ["read", "plan", "build", "test", "verify", "land"]);
  assert.equal(step(both, "build").title, "Write");
});

test("delegated children build side by side, each owned by its child", () => {
  const parent = {
    id: "task_p",
    delegation: {
      childTaskIds: ["task_delegate_a", "task_delegate_b", "task_delegate_c"],
      titles: ["Store tests", null],
      admissions: [{ title: "ignored" }, { title: "The view" }],
    },
  };
  const pipeline = createPipeline({ task: parent, shape: { intent: "implement", complexity: "compound" }, now: NOW });
  assert.deepEqual(kinds(pipeline), ["read", "build", "build", "build", "test", "verify", "land"]);
  const builds = pipeline.steps.filter((item) => item.kind === "build");
  assert.deepEqual(builds.map((item) => item.title), ["Store tests", "The view", "Part 3"]);
  assert.deepEqual(builds.map((item) => item.owner), ["task_delegate_a", "task_delegate_b", "task_delegate_c"]);
  assert.ok(builds.every((item) => item.child === true && item.parents.length === 1 && item.parents[0] === "s1"));
  assert.deepEqual(step(pipeline, "test").parents, builds.map((item) => item.id));
  assert.equal(signature(pipeline), "read>build*2-3>test>verify>land");
  const planned = createPipeline({ task: parent, shape: { complexity: "systemic" }, now: NOW });
  assert.ok(planned.steps.filter((item) => item.kind === "build").every((item) => item.parents[0] === "s2"));
});

test("a recipe is copied with its parents, and a broken recipe falls back to the template", () => {
  const recipe = {
    id: "r_abc",
    steps: [
      { kind: "read", title: "Read the ask", parents: [] },
      { kind: "map", title: "Map the store", parents: [0] },
      { kind: "build", title: "Store", parents: [1] },
      { kind: "build", title: "View", parents: [1] },
      { kind: "test", title: "Test", parents: [2, 3] },
      { kind: "verify", title: "Verify", parents: [4] },
      { kind: "land", title: "Land", parents: [5, 9] },
    ],
  };
  const pipeline = createPipeline({ task, recipe, now: NOW });
  assert.equal(pipeline.source, "recipe");
  assert.equal(pipeline.recipeId, "r_abc");
  assert.deepEqual(kinds(pipeline), ["read", "map", "build", "build", "test", "verify", "land"]);
  assert.deepEqual(pipeline.steps.map((item) => item.title), ["Read the ask", "Map the store", "Store", "View", "Test", "Verify", "Land"]);
  assert.deepEqual(step(pipeline, "test").parents, ["s3", "s4"]);
  assert.deepEqual(step(pipeline, "land").parents, ["s6"], "a bad index in a filed recipe is dropped");
  assert.deepEqual(recipeSteps(pipeline).map((item) => item.parents), [[], [0], [1], [1], [2, 3], [4], [5]]);
  const broken = createPipeline({ task, recipe: { id: "r_x", steps: [{ kind: "dance", parents: [] }] }, now: NOW });
  assert.equal(broken.source, "template");
  assert.equal(broken.recipeId, null);
  assert.equal(createPipeline({ task, recipe: { id: "r_y", steps: [] } }).source, "template");
});

test("MEFI_STEP lines parse at the start of a line, colour codes and all", () => {
  assert.deepEqual(parseStepLine("MEFI_STEP: add :: write the store tests"), { action: "add", title: "write the store tests" });
  assert.deepEqual(parseStepLine("MEFI_STEP: done :: write the store tests"), { action: "done", title: "write the store tests" });
  assert.deepEqual(parseStepLine("   \u001b[32mMEFI_STEP:\u001b[0m done::  the view  \r\n"), { action: "done", title: "the view" });
  assert.deepEqual(parseStepLine("MEFI_STEP: ADD :: Shout"), { action: "add", title: "Shout" });
  assert.equal(parseStepLine("MEFI_STEP: add :: " + "x".repeat(200)).title.length, 80);
  assert.deepEqual(parseStepLine("MEFI_STEP: add :: a :: b"), { action: "add", title: "a :: b" });
  for (const junk of [
    "", null, 42, "MEFI_STEP:", "MEFI_STEP: add ::", "MEFI_STEP: add ::   ", "MEFI_STEP: remove :: x",
    "MEFI_STEP: add x", "I will print MEFI_STEP: add :: x later", "MEFI_STEPS: add :: x", "mefi_step: add :: x",
  ]) assert.equal(parseStepLine(junk), null, String(junk));
});

test("run-start opens the read and the builds beside it, and resets growth for a new run", () => {
  const pipeline = freeze(createPipeline({ task, now: NOW }));
  const result = advance(pipeline, { type: "run-start", runId: "run_1", model: "glm-5.3" }, { now: NOW + 5 });
  assert.equal(result.changed, true);
  assert.notEqual(result.pipeline, pipeline);
  assert.equal(result.pipeline.updatedAt, NOW + 5);
  assert.deepEqual(result.pipeline.growth, { runId: "run_1", count: 0 });
  const read = step(result.pipeline, "read"), build = step(result.pipeline, "build");
  for (const item of [read, build]) {
    assert.equal(item.status, "active");
    assert.equal(item.owner, "run_1");
    assert.equal(item.model, "glm-5.3");
    assert.equal(item.startedAt, NOW + 5);
  }
  assert.equal(step(result.pipeline, "test").status, "queued");
  assert.deepEqual(result.events.map((event) => [event.kind, event.step]), [["step.start", "s1"], ["step.start", "s2"]]);
  assert.deepEqual(result.events[0], { kind: "step.start", taskId: "task_a", step: "s1", title: "Read the ask", runId: "run_1", model: "glm-5.3" });
  // The same start again changes nothing and hands back the same object.
  const again = advance(result.pipeline, { type: "run-start", runId: "run_1", model: "glm-5.3" }, { now: NOW + 6 });
  assert.equal(again.changed, false);
  assert.equal(again.pipeline, result.pipeline);
  assert.deepEqual(again.events, []);
  // Input never moved.
  assert.equal(pipeline.steps[0].status, "queued");
  assert.deepEqual(pipeline.growth, { runId: null, count: 0 });
});

test("with a plan, the builds wait until the worker has spoken", () => {
  const pipeline = createPipeline({ task, shape: { intent: "implement", complexity: "systemic" }, now: NOW });
  const started = play(pipeline, [{ type: "run-start", runId: "run_1", model: "m" }]).pipeline;
  assert.deepEqual(started.steps.map((item) => item.status), ["active", "queued", "queued", "queued", "queued", "queued"]);
  const { pipeline: spoke, events } = play(started, [{ type: "spoke", runId: "run_1" }]);
  assert.deepEqual(spoke.steps.map((item) => item.status), ["done", "active", "active", "queued", "queued", "queued"]);
  assert.equal(step(spoke, "read").doneAt, NOW + 1);
  assert.deepEqual(events.map((event) => [event.kind, event.step]), [["step.finish", "s1"], ["step.start", "s2"], ["step.start", "s3"]]);
  assert.equal(events[0].ok, true);
  assert.equal(step(spoke, "plan").owner, "run_1");
  assert.equal(step(spoke, "plan").model, "m");
  // Another run's spoke, or a second one with nothing thinking, does nothing.
  assert.equal(advance(spoke, { type: "spoke", runId: "run_other" }).changed, false);
});

test("a parent's runs never take a child's build", () => {
  const parent = { id: "task_p", delegation: { childTaskIds: ["task_delegate_a", "task_delegate_b"] } };
  const { pipeline } = play(createPipeline({ task: parent, now: NOW }), [{ type: "run-start", runId: "run_1", model: "m" }]);
  assert.equal(step(pipeline, "read").status, "active");
  for (const build of pipeline.steps.filter((item) => item.kind === "build")) {
    assert.equal(build.status, "queued");
    assert.match(build.owner, /^task_delegate_/);
  }
});

test("a run that died without an end hands its open steps to the next run", () => {
  const { pipeline } = play(createPipeline({ task, now: NOW }), [
    { type: "run-start", runId: "run_1", model: "old" },
    { type: "run-start", runId: "run_2", model: "new" },
  ]);
  assert.deepEqual(pipeline.growth, { runId: "run_2", count: 0 });
  assert.equal(step(pipeline, "read").owner, "run_2");
  assert.equal(step(pipeline, "build").owner, "run_2");
  assert.equal(step(pipeline, "build").model, "new");
});

test("the worker's todo list grows build steps and moves the ones it names", () => {
  const started = play(createPipeline({ task, now: NOW }), [{ type: "run-start", runId: "run_1", model: "m" }, { type: "spoke", runId: "run_1" }]).pipeline;
  const { pipeline, events } = play(started, [{
    type: "todos", runId: "run_1",
    todos: [
      { content: "Write the store tests", status: "completed" },
      { content: "Wire the banner", status: "in_progress" },
      { content: "Polish copy", status: "pending" },
      { content: "Dropped idea", status: "cancelled" },
      { content: "   ", status: "pending" },
      { content: "build", status: "completed" },
    ],
  }]);
  assert.deepEqual(kinds(pipeline), ["read", "build", "build", "build", "build", "test", "verify", "land"]);
  const tests = titled(pipeline, "Write the store tests"), banner = titled(pipeline, "Wire the banner"), copy = titled(pipeline, "Polish copy");
  assert.equal(tests.status, "done");
  assert.equal(banner.status, "active");
  assert.equal(copy.status, "queued");
  for (const item of [tests, banner, copy]) {
    assert.equal(item.grown, true);
    assert.equal(item.owner, "run_1");
    assert.deepEqual(item.parents, ["s1"]);
    assert.equal(item.model, "m");
  }
  assert.equal(titled(pipeline, "Build").status, "done", "a todo matching an existing title, in any case, moves it");
  assert.equal(titled(pipeline, "Build").grown, false);
  assert.deepEqual(step(pipeline, "test").parents, ["s2", tests.id, banner.id, copy.id]);
  assert.deepEqual([tests.id, banner.id, copy.id], ["s6", "s7", "s8"]);
  assert.deepEqual(pipeline.growth, { runId: "run_1", count: 3 });
  assert.deepEqual(events.filter((event) => event.kind === "step.grow").map((event) => event.title), ["Write the store tests", "Wire the banner", "Polish copy"]);
  assert.equal(summary(pipeline).grown, 3);
  // The same list again changes nothing.
  const again = advance(pipeline, { type: "todos", runId: "run_1", todos: [{ content: "wire the BANNER", status: "in_progress" }] });
  assert.equal(again.changed, false);
  assert.equal(again.pipeline, pipeline);
  // Completing it later closes it.
  const closed = advance(pipeline, { type: "todos", runId: "run_1", todos: [{ content: "wire the banner", status: "completed" }] }, { now: NOW + 9 });
  assert.equal(titled(closed.pipeline, "Wire the banner").status, "done");
  assert.equal(titled(closed.pipeline, "Wire the banner").doneAt, NOW + 9);
});

test("growth stops at the per-run cap with one event, and a new run gets a fresh budget", () => {
  const started = play(createPipeline({ task, now: NOW }), [{ type: "run-start", runId: "run_1", model: "m" }]).pipeline;
  const todos = ["a", "b", "c", "d", "e"].map((content) => ({ content, status: "pending" }));
  const first = advance(freeze(started), { type: "todos", runId: "run_1", todos }, { now: NOW });
  assert.equal(first.changed, true);
  assert.equal(first.pipeline.steps.filter((item) => item.grown).length, 3);
  assert.deepEqual(first.events.filter((event) => event.kind === "pipeline"), [{ kind: "pipeline", taskId: "task_a", step: null, title: null, text: "growth cap", runId: "run_1" }]);
  // Refused growth alone changes nothing but still says so.
  const refused = advance(first.pipeline, { type: "step-line", runId: "run_1", action: "add", title: "f" });
  assert.equal(refused.changed, false);
  assert.equal(refused.pipeline, first.pipeline);
  assert.deepEqual(refused.events.map((event) => event.text), ["growth cap"]);
  // A new run may grow again.
  const next = play(first.pipeline, [
    { type: "run-end", runId: "run_1", ok: false },
    { type: "run-start", runId: "run_2", model: "m2" },
    { type: "todos", runId: "run_2", todos: [{ content: "f", status: "pending" }, { content: "g", status: "pending" }] },
  ]).pipeline;
  assert.deepEqual(next.growth, { runId: "run_2", count: 2 });
  assert.equal(next.steps.filter((item) => item.grown).length, 5);
  // Todos from a run whose start was missed get that run's own budget.
  const missed = advance(next, { type: "todos", runId: "run_3", todos: [{ content: "h", status: "pending" }] });
  assert.deepEqual(missed.pipeline.growth, { runId: "run_3", count: 1 });
});

test("growth never passes maxSteps, whatever the per-run budget", () => {
  let pipeline = createPipeline({ task, now: NOW });
  for (let run = 1; run <= 6; run += 1) {
    pipeline = play(pipeline, [
      { type: "run-start", runId: `run_${run}`, model: "m" },
      { type: "todos", runId: `run_${run}`, todos: ["a", "b", "c"].map((letter) => ({ content: `${letter}${run}`, status: "pending" })) },
    ]).pipeline;
    assert.ok(pipeline.steps.length <= LIMITS.maxSteps);
  }
  assert.equal(pipeline.steps.length, LIMITS.maxSteps);
  const tight = advance(createPipeline({ task, now: NOW }), { type: "todos", runId: "r", todos: [{ content: "x", status: "pending" }, { content: "y", status: "pending" }] }, { limits: { maxSteps: 6 } });
  assert.equal(tight.pipeline.steps.length, 6);
  assert.ok(tight.events.some((event) => event.text === "growth cap"));
});

test("step lines act like one todo each", () => {
  const started = play(createPipeline({ task, now: NOW }), [{ type: "run-start", runId: "run_1", model: "m" }]).pipeline;
  const { pipeline, events } = play(started, [
    { type: "step-line", runId: "run_1", action: "add", title: "write the store tests" },
    { type: "step-line", runId: "run_1", action: "done", title: "Write the store tests" },
    { type: "step-line", runId: "run_1", action: "done", title: "an unannounced step" },
  ]);
  assert.equal(titled(pipeline, "write the store tests").status, "done");
  assert.equal(titled(pipeline, "an unannounced step").status, "done");
  // "add" is printed when the worker starts a step, so the new step shows as working.
  assert.deepEqual(events.map((event) => event.kind), ["step.grow", "step.start", "step.finish", "step.grow", "step.finish"]);
  assert.equal(advance(pipeline, { type: "step-line", runId: "run_1", action: "remove", title: "x" }).changed, false);
});

test("a todo naming a child's step leaves it to the child", () => {
  const parent = { id: "task_p", delegation: { childTaskIds: ["task_delegate_a", "task_delegate_b"], titles: ["Store", "View"] } };
  const { pipeline } = play(createPipeline({ task: parent, now: NOW }), [
    { type: "run-start", runId: "run_1", model: "m" },
    { type: "todos", runId: "run_1", todos: [{ content: "store", status: "completed" }] },
  ]);
  assert.equal(titled(pipeline, "Store").status, "queued");
  assert.equal(pipeline.steps.filter((item) => item.grown).length, 0);
});

test("a child's verdict moves its own build step", () => {
  const parent = { id: "task_p", delegation: { childTaskIds: ["task_delegate_a", "task_delegate_b"], titles: ["Store", "View"] } };
  const pipeline = createPipeline({ task: parent, now: NOW });
  const active = play(pipeline, [{ type: "child", childTaskId: "task_delegate_a", status: "running", model: "glm" }]);
  assert.equal(titled(active.pipeline, "Store").status, "active");
  assert.equal(titled(active.pipeline, "Store").owner, "task_delegate_a");
  assert.equal(titled(active.pipeline, "Store").model, "glm");
  assert.deepEqual(active.events.map((event) => event.kind), ["step.start"]);
  const done = play(active.pipeline, [{ type: "child", childTaskId: "task_delegate_a", status: "done", report: "r".repeat(500) }]);
  assert.equal(titled(done.pipeline, "Store").status, "done");
  assert.equal(titled(done.pipeline, "Store").report.length, 200);
  assert.deepEqual(done.events.map((event) => [event.kind, event.ok]), [["step.finish", true]]);
  for (const status of ["failed", "parked"]) {
    const failed = play(pipeline, [{ type: "child", childTaskId: "task_delegate_b", status }]);
    assert.equal(titled(failed.pipeline, "View").status, "failed");
    assert.equal(failed.events[0].ok, false);
  }
  assert.equal(advance(pipeline, { type: "child", childTaskId: "task_delegate_b", status: "open" }).changed, false);
});

test("children that appear mid-run take the plain build step, then grow their own", () => {
  const started = play(createPipeline({ task, now: NOW }), [{ type: "run-start", runId: "run_1", model: "m" }]).pipeline;
  const { pipeline, events } = play(started, [
    { type: "child", childTaskId: "task_delegate_a", status: "open", title: "Store" },
    { type: "child", childTaskId: "task_delegate_b", status: "running", title: "View" },
    { type: "child", childTaskId: "task_delegate_c", status: "open" },
  ]);
  const builds = pipeline.steps.filter((item) => item.kind === "build");
  assert.deepEqual(builds.map((item) => [item.title, item.owner, item.child, item.status]), [
    ["Store", "task_delegate_a", true, "queued"],
    ["View", "task_delegate_b", true, "active"],
    ["Part 3", "task_delegate_c", true, "queued"],
  ]);
  assert.equal(builds[0].model, null, "the parent's model does not stay on the child's step");
  assert.deepEqual(step(pipeline, "test").parents, builds.map((item) => item.id));
  assert.equal(pipeline.growth.count, 0, "children do not spend the run's growth budget");
  assert.deepEqual(events.map((event) => event.kind), ["step.grow", "step.start", "step.grow"]);
  // The parent's run ends: its own read closes, the test still waits on the children.
  const ended = play(pipeline, [{ type: "run-end", runId: "run_1", ok: true }]).pipeline;
  assert.equal(step(ended, "read").status, "done");
  assert.equal(step(ended, "test").status, "queued");
  const integrated = play(ended, [
    { type: "child", childTaskId: "task_delegate_a", status: "done" },
    { type: "child", childTaskId: "task_delegate_b", status: "verified" },
    { type: "child", childTaskId: "task_delegate_c", status: "done" },
    { type: "run-start", runId: "run_2", model: "m" },
    { type: "run-end", runId: "run_2", ok: true },
  ]).pipeline;
  assert.equal(step(integrated, "test").status, "done");
});

test("run-end closes the run's steps and the test, or puts them back", () => {
  const started = play(createPipeline({ task, now: NOW }), [{ type: "run-start", runId: "run_1", model: "m" }]).pipeline;
  const ok = advance(freeze(started), { type: "run-end", runId: "run_1", ok: true }, { now: NOW + 7 });
  assert.deepEqual(ok.pipeline.steps.map((item) => item.status), ["done", "done", "done", "queued", "queued"]);
  assert.equal(step(ok.pipeline, "test").doneAt, NOW + 7);
  assert.deepEqual(ok.events.map((event) => [event.kind, event.step, event.ok]), [["step.finish", "s1", true], ["step.finish", "s2", true], ["step.finish", "s3", true]]);
  const failed = advance(started, { type: "run-end", runId: "run_1", ok: false }, { now: NOW + 7 });
  assert.deepEqual(failed.pipeline.steps.map((item) => item.status), ["queued", "queued", "queued", "queued", "queued"]);
  assert.ok(failed.pipeline.steps.every((item) => item.owner === null && item.startedAt === null));
  assert.deepEqual(failed.events.map((event) => [event.kind, event.status, event.ok]), [["step.finish", "queued", false], ["step.finish", "queued", false]]);
  assert.equal(advance(started, { type: "run-end", runId: "run_other", ok: false }).changed, false);
  // What a failed run already finished stays finished, so a restart resumes after it.
  const resumed = play(started, [{ type: "spoke", runId: "run_1" }, { type: "run-end", runId: "run_1", ok: false }, { type: "run-start", runId: "run_2", model: "m" }]).pipeline;
  assert.equal(step(resumed, "read").status, "done");
  assert.equal(step(resumed, "read").owner, "run_1");
  assert.equal(step(resumed, "build").status, "active");
  assert.equal(step(resumed, "build").owner, "run_2");
});

test("verification: awaiting, verified with a fold, unverified and failed", () => {
  const built = play(createPipeline({ task, now: NOW }), [
    { type: "run-start", runId: "run_1", model: "m" },
    { type: "spoke", runId: "run_1" },
    { type: "run-end", runId: "run_1", ok: true },
  ]).pipeline;
  const waiting = play(built, [{ type: "awaiting" }]);
  assert.equal(step(waiting.pipeline, "verify").status, "active");
  assert.deepEqual(waiting.events.map((event) => [event.kind, event.step]), [["step.start", "s4"]]);
  assert.equal(advance(waiting.pipeline, { type: "awaiting" }).changed, false);

  const unverified = play(waiting.pipeline, [{ type: "verdict", verdict: "unverified" }]);
  assert.equal(step(unverified.pipeline, "verify").status, "retry");
  assert.equal(unverified.pipeline.done, false);
  assert.deepEqual(unverified.events.map((event) => [event.kind, event.status, event.ok]), [["step.finish", "retry", false]]);
  assert.equal(summary(unverified.pipeline).queued, 2, "a verify waiting to retry counts as queued");

  const failed = play(waiting.pipeline, [{ type: "verdict", verdict: "failed" }]);
  assert.equal(step(failed.pipeline, "verify").status, "failed");
  assert.equal(summary(failed.pipeline).failed, 1);

  const verified = play(unverified.pipeline, [{ type: "awaiting" }, { type: "verdict", verdict: "verified" }]);
  assert.equal(verified.pipeline.done, true);
  assert.equal(step(verified.pipeline, "verify").status, "done");
  assert.equal(step(verified.pipeline, "land").status, "done");
  assert.deepEqual(verified.pipeline.steps.map((item) => item.folded), [true, true, true, false, false]);
  const fold = verified.events.find((event) => event.kind === "step.fold");
  assert.deepEqual(fold, { kind: "step.fold", taskId: "task_a", step: null, title: "3 steps done", count: 3, steps: ["s1", "s2", "s3"] });
  assert.ok(verified.events.some((event) => event.kind === "pipeline" && event.text === "verified"));
  assert.equal(advance(verified.pipeline, { type: "verdict", verdict: "verified" }).changed, false);
  assert.equal(advance(verified.pipeline, { type: "verdict", verdict: "maybe" }).changed, false);
  const reopened = advance(verified.pipeline, { type: "verdict", verdict: "unverified" });
  assert.equal(reopened.pipeline.done, false);
  assert.equal(step(reopened.pipeline, "verify").status, "retry");
});

test("a verified verdict closes whatever is still open, but a failed child stays failed", () => {
  const parent = { id: "task_p", delegation: { childTaskIds: ["task_delegate_a", "task_delegate_b"] } };
  const { pipeline } = play(createPipeline({ task: parent, now: NOW }), [
    { type: "child", childTaskId: "task_delegate_a", status: "failed" },
    { type: "verdict", verdict: "verified" },
  ]);
  assert.deepEqual(pipeline.steps.map((item) => item.status), ["done", "failed", "done", "done", "done", "done"]);
  assert.equal(pipeline.steps[1].folded, false);
});

test("fold folds each finished step once, never verify or land", () => {
  const built = play(createPipeline({ task, now: NOW }), [
    { type: "run-start", runId: "run_1", model: "m" },
    { type: "spoke", runId: "run_1" },
  ]).pipeline;
  const first = advance(freeze(built), { type: "fold" });
  assert.equal(first.changed, true);
  assert.deepEqual(first.events, [{ kind: "step.fold", taskId: "task_a", step: null, title: "1 step done", count: 1, steps: ["s1"] }]);
  const second = advance(first.pipeline, { type: "fold" });
  assert.equal(second.changed, false);
  assert.deepEqual(second.events, []);
  const more = play(first.pipeline, [{ type: "run-end", runId: "run_1", ok: true }, { type: "fold" }]);
  assert.deepEqual(more.events.find((event) => event.kind === "step.fold").steps, ["s2", "s3"]);
  assert.equal(summary(more.pipeline).folded, 3);
});

test("advance never mutates its input and ignores what it does not know", () => {
  const pipeline = freeze(createPipeline({ task, shape: { complexity: "systemic" }, now: NOW }));
  const snapshot = JSON.stringify(pipeline);
  const sequence = [
    { type: "run-start", runId: "run_1", model: "m" }, { type: "spoke", runId: "run_1" },
    { type: "todos", runId: "run_1", todos: [{ content: "a", status: "completed" }] },
    { type: "child", childTaskId: "task_x", status: "running" },
    { type: "run-end", runId: "run_1", ok: true }, { type: "awaiting" }, { type: "verdict", verdict: "verified" }, { type: "fold" },
  ];
  let current = pipeline;
  for (const event of sequence) current = advance(freeze(current), event, { now: NOW }).pipeline;
  assert.equal(JSON.stringify(pipeline), snapshot);
  for (const odd of [null, undefined, "run-start", { type: "explode" }, {}]) {
    const result = advance(pipeline, odd);
    assert.equal(result.changed, false);
    assert.equal(result.pipeline, pipeline);
    assert.deepEqual(result.events, []);
  }
  assert.deepEqual(advance(null, { type: "fold" }), { pipeline: null, changed: false, events: [] });
  assert.equal(advance(pipeline, { type: "run-start" }).changed, false, "a start without a run id is ignored");
});

test("summary counts every status", () => {
  const pipeline = createPipeline({ task, now: NOW });
  assert.deepEqual(summary(pipeline), { total: 5, done: 0, active: 0, queued: 5, failed: 0, folded: 0, grown: 0 });
  const started = play(pipeline, [{ type: "run-start", runId: "run_1", model: "m" }, { type: "spoke", runId: "run_1" }]).pipeline;
  assert.deepEqual(summary(started), { total: 5, done: 1, active: 1, queued: 3, failed: 0, folded: 0, grown: 0 });
  assert.deepEqual(summary(null), { total: 0, done: 0, active: 0, queued: 0, failed: 0, folded: 0, grown: 0 });
});

test("the signature buckets side-by-side builds", () => {
  const of = (list) => signature({ steps: list.map((kind) => ({ kind })) });
  assert.equal(of(["read", "build", "test", "verify", "land"]), "read>build*1>test>verify>land");
  assert.equal(of(["read", "build", "build", "test"]), "read>build*2-3>test");
  assert.equal(of(["read", "build", "build", "build", "test"]), "read>build*2-3>test");
  assert.equal(of(["read", "build", "build", "build", "build", "test"]), "read>build*4+>test");
  assert.equal(of(["read", "build", "map", "build", "build", "land"]), "read>build*1>map>build*2-3>land");
  assert.equal(of(["read", "map", "map", "plan"]), "read>map>map>plan");
  assert.equal(signature([{ kind: "read" }, { kind: "build" }]), "read>build*1", "a bare step list works too");
  assert.equal(signature(null), "");
});

test("validatePipeline names each problem in plain words", () => {
  assert.deepEqual(validatePipeline(null), { ok: false, errors: ["The pipeline is not an object."] });
  assert.deepEqual(validatePipeline({ steps: [] }), { ok: false, errors: ["The pipeline has no steps."] });
  const bad = validatePipeline({ steps: [
    { id: "s1", kind: "read", parents: [] },
    { id: "s2", kind: "dance", parents: ["s1"] },
    { id: "s2", kind: "build", parents: ["s4"] },
    { id: "s4", kind: "test", parents: ["s4"], status: "sleeping" },
    "nope",
    { kind: "land", parents: "s1" },
  ] });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.errors, [
    'Step 2 has an unknown kind "dance".',
    "Step 3 repeats the id s2.",
    "Step 3 waits on s4, which is not an earlier step.",
    'Step 4 has an unknown status "sleeping".',
    "Step 4 waits on s4, which is not an earlier step.",
    "Step 5 is not an object.",
    "Step 6 has no id.",
    "Step 6 has no list of steps it waits on.",
  ]);
  const long = { steps: Array.from({ length: 13 }, (_, index) => ({ id: `s${index + 1}`, kind: "build", parents: [] })) };
  assert.deepEqual(validatePipeline(long).errors, ["The pipeline has 13 steps; the most is 12."]);
  assert.equal(validatePipeline(long, { limits: { maxSteps: 20 } }).ok, true);
});

test("recipeSteps keeps kinds and parents, and only the first four build titles a worker grew", () => {
  const started = play(createPipeline({ task, shape: { complexity: "systemic" }, now: NOW }), [{ type: "run-start", runId: "run_1", model: "m" }]).pipeline;
  const grown = play(started, [
    { type: "todos", runId: "run_1", todos: ["one", "two", "three"].map((content) => ({ content, status: "pending" })) },
    { type: "run-start", runId: "run_2", model: "m" },
    { type: "todos", runId: "run_2", todos: ["four", "five"].map((content) => ({ content, status: "pending" })) },
  ]).pipeline;
  const rows = recipeSteps(grown);
  assert.deepEqual(rows.map((row) => row.kind), ["read", "plan", "build", "build", "build", "build", "build", "build", "test", "verify", "land"]);
  assert.deepEqual(rows.filter((row) => row.kind === "build").map((row) => row.title), ["Build", "one", "two", "three", "Build", "Build"]);
  assert.deepEqual(rows[2].parents, [1]);
  assert.deepEqual(rows[8].parents, [2, 3, 4, 5, 6, 7]);
  assert.deepEqual(rows[10].parents, [9]);
  // A filed recipe rebuilds the same shape.
  const again = createPipeline({ task, recipe: { id: "r_1", steps: rows }, now: NOW });
  assert.equal(signature(again), signature(grown));
  assert.equal(validatePipeline(again).ok, true);
  assert.deepEqual(recipeSteps(null), []);
});

test("draftPrompt asks for JSON steps from the catalog, starting from the recipe when there is one", () => {
  const plain = draftPrompt({ task, shape: { intent: "implement", complexity: "compound" } });
  assert.match(plain.system, /JSON only/);
  assert.match(plain.system, /at most 12 steps/);
  assert.match(plain.system, /untrusted data/);
  for (const kind of Object.keys(STEP_KINDS)) assert.ok(plain.system.includes(kind) && plain.user.includes(`${kind}:`), kind);
  assert.match(plain.user, /Task: Retry banner/);
  assert.match(plain.user, /Brief: Show a retry banner/);
  assert.match(plain.user, /implement intent, compound complexity/);
  assert.ok(plain.user.includes(JSON.stringify({ steps: recipeSteps(createPipeline({ task, shape: { intent: "implement", complexity: "compound" } })) })));
  const recipe = { id: "r_1", name: "Implement · compound", runs: 4, verified: 3, steps: [{ kind: "read", title: "Read", parents: [] }, { kind: "build", title: "Store", parents: [0] }] };
  const withRecipe = draftPrompt({ task, shape: null, recipe });
  assert.match(withRecipe.user, /verified 3 of 4 runs/);
  assert.ok(withRecipe.user.includes('{"steps":[{"kind":"read","title":"Read","parents":[]},{"kind":"build","title":"Store","parents":[0]}]}'));
  assert.match(withRecipe.user, /unknown intent, unknown complexity/);
  assert.equal(typeof draftPrompt().user, "string");
});

test("parseDraft reads fenced or bare JSON and refuses anything that does not hold", () => {
  const steps = [
    { kind: "read", title: "Read the ask", parents: [] },
    { kind: "build", title: "Store", parents: [0] },
    { kind: "build", title: "View", parents: [0] },
    { kind: "test", title: "Test", parents: [1, 2] },
    { kind: "verify", title: "Verify", parents: [3] },
    { kind: "land", title: "Land", parents: [4] },
  ];
  const fenced = `Here is the pipeline:\n\`\`\`json\n${JSON.stringify({ steps }, null, 2)}\n\`\`\`\nGood luck.`;
  const pipeline = parseDraft(fenced, { task, now: NOW });
  assert.equal(pipeline.source, "model");
  assert.equal(pipeline.taskId, "task_a");
  assert.equal(pipeline.recipeId, null);
  assert.equal(pipeline.createdAt, NOW);
  assert.equal(signature(pipeline), "read>build*2-3>test>verify>land");
  assert.deepEqual(step(pipeline, "test").parents, ["s2", "s3"]);
  assert.equal(validatePipeline(pipeline).ok, true);
  assert.deepEqual(parseDraft(`Sure! ${JSON.stringify({ steps })} Done.`, { task })?.steps.length, 6);
  assert.equal(parseDraft(JSON.stringify(steps))?.steps.length, 6, "a bare list is read as the steps");
  // A missing parent list waits on the step before; a missing title takes the label.
  const loose = parseDraft(JSON.stringify({ steps: [{ kind: "READ" }, { kind: "build" }] }));
  assert.deepEqual(loose.steps.map((item) => [item.kind, item.title, item.parents]), [["read", "Read the ask", []], ["build", "Build", ["s1"]]]);
  for (const bad of [
    JSON.stringify({ steps: [{ kind: "read" }, { kind: "deploy", parents: [0] }] }),
    JSON.stringify({ steps: [{ kind: "read", parents: [1] }, { kind: "build", parents: [0] }] }),
    JSON.stringify({ steps: [{ kind: "read", parents: "none" }] }),
    JSON.stringify({ steps: Array.from({ length: 13 }, () => ({ kind: "build" })) }),
    JSON.stringify({ steps: [] }),
    JSON.stringify({ nodes: [] }),
    "no json here", "", null, "{ broken",
  ]) assert.equal(parseDraft(bad, { task }), null, String(bad).slice(0, 60));
});

test("a whole task: drawn, run, grown, verified and filed as a recipe", () => {
  const { pipeline, events } = play(createPipeline({ task, now: NOW }), [
    { type: "run-start", runId: "run_1", model: "deepseek" },
    { type: "spoke", runId: "run_1" },
    { type: "step-line", runId: "run_1", action: "add", title: "store tests" },
    { type: "todos", runId: "run_1", todos: [{ content: "store tests", status: "completed" }] },
    { type: "run-end", runId: "run_1", ok: true },
    { type: "awaiting" },
    { type: "verdict", verdict: "verified" },
  ]);
  assert.equal(pipeline.done, true);
  assert.deepEqual(summary(pipeline), { total: 6, done: 6, active: 0, queued: 0, failed: 0, folded: 4, grown: 1 });
  assert.equal(signature(pipeline), "read>build*2-3>test>verify>land");
  const allowed = new Set(["step.start", "step.finish", "step.grow", "step.fold", "pipeline"]);
  assert.ok(events.every((event) => allowed.has(event.kind) && event.taskId === "task_a"));
  assert.deepEqual(recipeSteps(pipeline).map((row) => row.title), ["Read the ask", "Build", "store tests", "Test", "Verify", "Land"]);
});
