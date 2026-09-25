// The Playbook keeps the pipeline shapes that worked. It has to group runs
// into stable recipes, stop offering one that keeps failing, stay inside its
// caps, and let the owner edit every recipe without breaking the grouping.
import test from "node:test";
import assert from "node:assert/strict";
import playbook from "../scripts/playbook.cjs";
import pipelines from "../scripts/pipelines.cjs";

const { emptyPlaybook, normalizePlaybook, record, winProbability, pick, act, shelf } = playbook;
const { createPipeline, advance, recipeSteps, signature } = pipelines;

const NOW = 1_790_000_000_000;
const SHAPE = { intent: "implement", complexity: "compound" };
const STEPS = [
  { kind: "read", title: "Read the ask", parents: [] },
  { kind: "build", title: "Build", parents: [0] },
  { kind: "test", title: "Test", parents: [1] },
  { kind: "verify", title: "Verify", parents: [2] },
  { kind: "land", title: "Land", parents: [3] },
];
const TWO_BUILDS = [
  { kind: "read", title: "Read the ask", parents: [] },
  { kind: "build", title: "Store", parents: [0] },
  { kind: "build", title: "View", parents: [0] },
  { kind: "test", title: "Test", parents: [1, 2] },
  { kind: "verify", title: "Verify", parents: [3] },
  { kind: "land", title: "Land", parents: [4] },
];
const freeze = (value) => {
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
};
// A recipe with a given record, filed through record() so it is real.
const withRuns = (book, { steps = STEPS, shape = SHAPE, verified = 0, failed = 0, now = NOW, name = null } = {}) => {
  let next = book;
  for (let index = 0; index < verified; index += 1) next = record(next, { steps, shape, verdict: "verified", durationMs: 1000 * (index + 1), taskId: `t${index}`, now, name });
  for (let index = 0; index < failed; index += 1) next = record(next, { steps, shape, verdict: "failed", taskId: `f${index}`, now, name });
  return next;
};
const only = (book) => { assert.equal(book.recipes.length, 1); return book.recipes[0]; };

test("an empty Playbook, and anything read from disk made safe", () => {
  assert.deepEqual(emptyPlaybook(), { v: 1, recipes: [] });
  assert.notEqual(emptyPlaybook(), emptyPlaybook());
  for (const junk of [null, undefined, 7, "x", [], { recipes: "no" }]) assert.deepEqual(normalizePlaybook(junk), { v: 1, recipes: [] });
  const good = only(record(emptyPlaybook(), { steps: STEPS, shape: SHAPE, verdict: "verified", durationMs: 5, now: NOW }));
  const raw = {
    v: 9,
    recipes: [
      { ...good, durations: Array.from({ length: 30 }, (_, index) => index * 10), medianMs: 1, runs: 0, verified: 2, failed: 1, pinned: "yes" },
      { ...good },
      { ...good, id: "bad id" },
      { ...good, id: "r_other", steps: [{ kind: "dance", parents: [] }] },
      { ...good, id: "r_forward", steps: [{ kind: "read", parents: [1] }] },
      { ...good, id: "r_empty", steps: [] },
      "nope", null,
    ],
  };
  const book = normalizePlaybook(raw);
  const recipe = only(book);
  assert.equal(book.v, 1);
  assert.equal(recipe.durations.length, 20);
  assert.deepEqual(recipe.durations, Array.from({ length: 20 }, (_, index) => (index + 10) * 10));
  assert.equal(recipe.medianMs, 195);
  assert.equal(recipe.runs, 3, "runs is at least the settled count");
  assert.equal(recipe.pinned, false);
  assert.equal(recipe.retired, false);
  const cleaned = only(normalizePlaybook({ recipes: [{ id: "r_1", steps: [{ kind: "READ" }, { kind: "build", title: "\u0007 x " }] }] }));
  assert.deepEqual(cleaned.steps, [{ kind: "read", title: "Read the ask", parents: [] }, { kind: "build", title: "x", parents: [0] }]);
  assert.equal(cleaned.signature, "read>build*1");
  assert.deepEqual(cleaned.shape, { intent: null, complexity: null });
  assert.equal(cleaned.name, "Any work · 1 build");
  assert.equal(cleaned.medianMs, null);
  assert.equal(cleaned.lastTaskId, null);
});

test("the first verified run makes a recipe with a stable id and a name from its shape", () => {
  const book = record(freeze(emptyPlaybook()), { steps: STEPS, signature: signature(STEPS), shape: SHAPE, verdict: "verified", durationMs: 42_000.4, taskId: "task_a", now: NOW });
  const recipe = only(book);
  assert.match(recipe.id, /^r_[0-9a-z]+$/);
  assert.equal(recipe.id, only(record(emptyPlaybook(), { steps: STEPS, shape: SHAPE, verdict: "verified", now: NOW + 99 })).id, "same shape and signature, same id");
  assert.notEqual(recipe.id, only(record(emptyPlaybook(), { steps: STEPS, shape: { ...SHAPE, complexity: "atomic" }, verdict: "verified" })).id);
  assert.notEqual(recipe.id, only(record(emptyPlaybook(), { steps: TWO_BUILDS, shape: SHAPE, verdict: "verified" })).id);
  assert.deepEqual(recipe, {
    id: recipe.id, name: "Implement · compound · 1 build", shape: SHAPE, signature: "read>build*1>test>verify>land", steps: STEPS,
    runs: 1, verified: 1, failed: 0, durations: [42_000], medianMs: 42_000, pinned: false, retired: false,
    createdAt: NOW, updatedAt: NOW, lastTaskId: "task_a",
  });
  assert.equal(only(record(emptyPlaybook(), { steps: TWO_BUILDS, shape: SHAPE, verdict: "verified" })).name, "Implement · compound · 2-3 builds");
  assert.equal(only(record(emptyPlaybook(), { steps: STEPS, shape: SHAPE, verdict: "verified", name: "  My   flow " })).name, "My flow");
  const failedFirst = only(record(emptyPlaybook(), { steps: STEPS, shape: SHAPE, verdict: "failed", durationMs: 9, now: NOW }));
  assert.deepEqual([failedFirst.runs, failedFirst.verified, failedFirst.failed, failedFirst.durations, failedFirst.medianMs], [1, 0, 1, [], null]);
});

test("later runs count against the same recipe, and only verified ones add time and steps", () => {
  let book = record(emptyPlaybook(), { steps: STEPS, shape: SHAPE, verdict: "verified", durationMs: 3000, taskId: "t1", now: NOW });
  const renamed = STEPS.map((step) => step.kind === "build" ? { ...step, title: "Store and view" } : step);
  book = record(freeze(book), { steps: renamed, shape: SHAPE, verdict: "failed", durationMs: 1, taskId: "t2", now: NOW + 1 });
  let recipe = only(book);
  assert.deepEqual([recipe.runs, recipe.verified, recipe.failed, recipe.durations, recipe.medianMs], [2, 1, 1, [3000], 3000]);
  assert.equal(recipe.steps[1].title, "Build", "a failed run does not rewrite the recipe");
  assert.equal(recipe.lastTaskId, "t2");
  assert.equal(recipe.updatedAt, NOW + 1);
  assert.equal(recipe.createdAt, NOW);
  book = record(book, { steps: renamed, shape: SHAPE, verdict: "verified", durationMs: 1000, taskId: "t3", now: NOW + 2 });
  recipe = only(book);
  assert.deepEqual([recipe.runs, recipe.verified, recipe.durations, recipe.medianMs], [3, 2, [3000, 1000], 2000]);
  assert.equal(recipe.steps[1].title, "Store and view", "a verified run's steps become the recipe");
  book = record(book, { steps: renamed, shape: SHAPE, verdict: "verified", durationMs: 8000, now: NOW + 3 });
  assert.equal(only(book).medianMs, 3000, "odd count: the middle value");
  // A failed run can be filed by signature alone once the recipe exists.
  book = record(book, { signature: "read>build*1>test>verify>land", shape: SHAPE, verdict: "failed", now: NOW + 4 });
  assert.equal(only(book).failed, 2);
  for (let index = 0; index < 25; index += 1) book = record(book, { steps: STEPS, shape: SHAPE, verdict: "verified", durationMs: index, now: NOW });
  assert.equal(only(book).durations.length, 20);
  assert.equal(only(book).durations[19], 24);
});

test("record leaves the Playbook alone when there is nothing to file", () => {
  const book = freeze(record(emptyPlaybook(), { steps: STEPS, shape: SHAPE, verdict: "verified", now: NOW }));
  const snapshot = JSON.stringify(book);
  for (const input of [
    { steps: STEPS, shape: SHAPE, verdict: "unverified" },
    { steps: STEPS, shape: SHAPE },
    { steps: [{ kind: "dance" }], shape: SHAPE, verdict: "verified" },
    { signature: "read>build*4+", shape: SHAPE, verdict: "failed" },
  ]) assert.deepEqual(record(book, input), normalizePlaybook(book));
  assert.equal(JSON.stringify(book), snapshot);
  assert.deepEqual(record(null, { verdict: "verified" }), emptyPlaybook());
});

test("over sixty recipes, retired then least-used recipes go, never pinned ones or the new one", () => {
  const recipes = Array.from({ length: 60 }, (_, index) => ({
    id: `r_${index.toString(36)}x`, name: `R${index}`, shape: { intent: "explore", complexity: null }, signature: `read>map*${index}`,
    steps: [{ kind: "read", title: "Read", parents: [] }], runs: 5 + index, verified: 5 + index, failed: 0, durations: [],
    pinned: false, retired: false, createdAt: NOW, updatedAt: NOW + index,
  }));
  recipes[10].retired = true;
  recipes[20].retired = true;
  recipes[20].runs = 2;
  recipes[20].verified = 2;
  recipes[0].pinned = true;
  recipes[0].runs = recipes[0].verified = 0;
  const full = normalizePlaybook({ recipes });
  assert.equal(full.recipes.length, 60);
  let book = record(full, { steps: STEPS, shape: SHAPE, verdict: "verified", now: NOW });
  assert.equal(book.recipes.length, 60);
  assert.ok(!book.recipes.some((recipe) => recipe.id === recipes[20].id), "the least-used retired recipe goes first");
  assert.ok(book.recipes.some((recipe) => recipe.id === recipes[10].id));
  book = record(book, { steps: TWO_BUILDS, shape: SHAPE, verdict: "verified", now: NOW });
  assert.ok(!book.recipes.some((recipe) => recipe.id === recipes[10].id), "then the other retired one");
  book = record(book, { steps: STEPS, shape: { intent: "document", complexity: null }, verdict: "failed", now: NOW });
  assert.equal(book.recipes.length, 60);
  assert.ok(book.recipes.some((recipe) => recipe.id === recipes[0].id), "pinned stays although it has no runs");
  assert.ok(!book.recipes.some((recipe) => recipe.shape.intent === "implement" && recipe.signature === "read>build*1>test>verify>land"), "then the fewest runs, oldest first");
  assert.ok(book.recipes.some((recipe) => recipe.signature === "read>build*2-3>test>verify>land"));
  assert.ok(recipes.slice(1).every((recipe) => recipe.retired || book.recipes.some((item) => item.id === recipe.id)), "every well-used recipe stays");
  assert.ok(book.recipes.some((recipe) => recipe.shape.intent === "document"), "the new recipe stays even with one run");
  const crowded = normalizePlaybook({ recipes: [...recipes, ...recipes.map((recipe, index) => ({ ...recipe, id: `r_${index.toString(36)}y`, signature: `${recipe.signature}!` }))] });
  assert.equal(crowded.recipes.length, 60);
});

test("win probability is the posterior mean under a uniform prior", () => {
  assert.equal(winProbability({ verified: 0, failed: 0 }), 0.5);
  assert.equal(winProbability({ verified: 3, failed: 1 }), 4 / 6);
  assert.equal(winProbability({ verified: 0, failed: 4 }), 1 / 6);
  assert.equal(winProbability(null), 0.5);
  assert.equal(winProbability({ verified: -3, failed: "2" }), 0.5);
});

test("pick: nothing to pick from", () => {
  assert.equal(pick(emptyPlaybook(), SHAPE), null);
  const book = withRuns(emptyPlaybook(), { verified: 2 });
  assert.equal(pick(book, { intent: "document", complexity: "compound" }), null, "another intent never matches");
  assert.equal(pick(act(book, { action: "retire", id: only(book).id }).playbook, SHAPE), null, "a retired recipe is never picked");
});

test("pick: the best win probability, then more runs, then the newer one", () => {
  let book = withRuns(emptyPlaybook(), { steps: STEPS, verified: 3, failed: 1, now: NOW });
  book = withRuns(book, { steps: TWO_BUILDS, verified: 5, failed: 0, now: NOW });
  const best = pick(book, SHAPE);
  assert.equal(best.reason, "best");
  assert.equal(best.recipe.signature, "read>build*2-3>test>verify>land");
  assert.equal(best.p, 6 / 7);
  // Equal odds: more runs wins.
  let tie = withRuns(emptyPlaybook(), { steps: STEPS, verified: 1, failed: 1, now: NOW });
  tie = withRuns(tie, { steps: TWO_BUILDS, verified: 2, failed: 2, now: NOW });
  assert.equal(pick(tie, SHAPE).recipe.signature, "read>build*2-3>test>verify>land");
  // Equal odds and runs: the newer one.
  let fresh = withRuns(emptyPlaybook(), { steps: STEPS, verified: 2, now: NOW + 50 });
  fresh = withRuns(fresh, { steps: TWO_BUILDS, verified: 2, now: NOW });
  assert.equal(pick(fresh, SHAPE).recipe.signature, "read>build*1>test>verify>land");
  // The second similar task starts from the first one's recipe.
  const second = pick(withRuns(emptyPlaybook(), { verified: 1 }), SHAPE);
  assert.equal(second.reason, "best");
  assert.equal(second.p, 2 / 3);
});

test("pick: a pinned recipe wins even against better odds", () => {
  let book = withRuns(emptyPlaybook(), { steps: STEPS, verified: 1, failed: 5 });
  book = withRuns(book, { steps: TWO_BUILDS, verified: 9 });
  const weak = book.recipes.find((recipe) => recipe.signature.includes("build*1"));
  const pinned = act(book, { action: "pin", id: weak.id }).playbook;
  const choice = pick(pinned, SHAPE);
  assert.equal(choice.reason, "pinned");
  assert.equal(choice.recipe.id, weak.id);
  assert.equal(choice.p, 2 / 8);
});

test("pick: exploration tries a recipe with few runs only when the injected random says so", () => {
  let book = withRuns(emptyPlaybook(), { steps: STEPS, verified: 8, failed: 1 });
  book = withRuns(book, { steps: TWO_BUILDS, verified: 1 });
  const calls = [];
  const low = () => { calls.push("low"); return 0.05; };
  const explored = pick(book, SHAPE, { random: low });
  assert.equal(explored.reason, "explore");
  assert.equal(explored.recipe.signature, "read>build*2-3>test>verify>land");
  assert.equal(explored.p, 2 / 3);
  assert.deepEqual(calls, ["low"]);
  assert.equal(pick(book, SHAPE, { random: () => 0.5 }).reason, "best");
  assert.equal(pick(book, SHAPE).reason, "best", "no random, no exploration");
  assert.equal(pick(book, SHAPE, { random: () => 0.5, explore: 0.9 }).reason, "explore");
  // With every recipe tried enough, random is never asked.
  const seasoned = withRuns(emptyPlaybook(), { verified: 3 });
  let asked = false;
  assert.equal(pick(seasoned, SHAPE, { random: () => { asked = true; return 0; } }).reason, "best");
  assert.equal(asked, false);
  assert.equal(pick(seasoned, SHAPE, { random: () => 0, minRuns: 5 }).reason, "explore");
});

test("pick: a recipe that keeps failing stops being picked", () => {
  const losing = withRuns(emptyPlaybook(), { steps: STEPS, verified: 0, failed: 3 });
  assert.equal(pick(losing, SHAPE), null, "every candidate is failing");
  const mixed = withRuns(losing, { steps: TWO_BUILDS, verified: 0, failed: 1 });
  assert.equal(pick(mixed, SHAPE).recipe.signature, "read>build*2-3>test>verify>land", "one failure is not yet failing");
  assert.equal(pick(withRuns(emptyPlaybook(), { verified: 2, failed: 3 }), SHAPE).p, 3 / 7);
  assert.equal(pick(withRuns(emptyPlaybook(), { verified: 1, failed: 3 }), SHAPE), null, "a third is under the bar");
  assert.equal(pick(withRuns(emptyPlaybook(), { verified: 0, failed: 2 }), SHAPE).p, 1 / 4, "two runs are not yet a fair try");
  // Pinned is the owner's call, failing or not.
  const pinned = act(losing, { action: "pin", id: only(losing).id }).playbook;
  assert.equal(pick(pinned, SHAPE).reason, "pinned");
});

test("pick: the exact complexity first, then the rest of the intent", () => {
  let book = withRuns(emptyPlaybook(), { steps: TWO_BUILDS, shape: { intent: "implement", complexity: "systemic" }, verified: 9 });
  book = withRuns(book, { steps: STEPS, shape: SHAPE, verified: 1, failed: 1 });
  assert.equal(pick(book, SHAPE).recipe.shape.complexity, "compound");
  assert.equal(pick(book, { intent: "implement", complexity: "atomic" }).recipe.shape.complexity, "systemic");
  const failingExact = withRuns(book, { steps: STEPS, shape: SHAPE, failed: 6 });
  assert.equal(pick(failingExact, SHAPE).recipe.shape.complexity, "systemic", "a failing exact match falls through to the intent");
  assert.equal(pick(book, { intent: "IMPLEMENT", complexity: "Compound" }).recipe.shape.complexity, "compound");
});

test("act: every action the owner has", () => {
  let book = withRuns(emptyPlaybook(), { verified: 2 });
  book = withRuns(book, { steps: TWO_BUILDS, verified: 1 });
  freeze(book);
  const id = book.recipes[0].id;
  const get = (result) => result.playbook.recipes.find((recipe) => recipe.id === id);

  const pinned = act(book, { action: "pin", id });
  assert.deepEqual([pinned.ok, pinned.error, get(pinned).pinned], [true, null, true]);
  assert.equal(get(act(pinned.playbook, { action: "unpin", id })).pinned, false);
  const retired = act(pinned.playbook, { action: "retire", id });
  assert.deepEqual([get(retired).retired, get(retired).pinned], [true, false]);
  assert.equal(get(act(retired.playbook, { action: "restore", id })).retired, false);
  assert.deepEqual([get(act(retired.playbook, { action: "pin", id })).retired, get(act(retired.playbook, { action: "pin", id })).pinned], [false, true], "pinning brings a retired recipe back");

  assert.equal(get(act(book, { action: "rename", id, name: "  Quick  fix " })).name, "Quick fix");
  assert.equal(get(act(book, { action: "rename", id, name: "x".repeat(60) })).name.length, 60);
  for (const name of ["", "   ", "x".repeat(61), null, 5]) {
    const refused = act(book, { action: "rename", id, name });
    assert.equal(refused.ok, false);
    assert.equal(refused.error, "A recipe name needs 1 to 60 characters.");
    assert.deepEqual(refused.playbook, normalizePlaybook(book));
  }

  const edited = act(book, { action: "edit-steps", id, steps: [{ kind: "read", parents: [] }, { kind: "map", title: "Map it", parents: [0] }, { kind: "build", parents: [1] }] });
  assert.equal(edited.ok, true);
  assert.equal(get(edited).signature, "read>map>build*1");
  assert.deepEqual(get(edited).steps[1], { kind: "map", title: "Map it", parents: [0] });
  assert.equal(get(edited).runs, 2, "its record stays with it");
  // Runs of the new shape keep landing on the edited recipe.
  const after = record(edited.playbook, { steps: get(edited).steps, shape: SHAPE, verdict: "verified", now: NOW });
  assert.equal(after.recipes.length, 2);
  assert.equal(after.recipes.find((recipe) => recipe.id === id).runs, 3);
  // And a run of the old signature makes a fresh recipe with its own id.
  const old = record(edited.playbook, { steps: STEPS, shape: SHAPE, verdict: "verified", now: NOW });
  assert.equal(old.recipes.length, 3);
  assert.equal(new Set(old.recipes.map((recipe) => recipe.id)).size, 3);

  for (const [steps, error] of [
    [[], "A recipe needs 1 to 12 steps."],
    [Array.from({ length: 13 }, () => ({ kind: "build" })), "A recipe needs 1 to 12 steps."],
    [[{ kind: "read" }, { kind: "deploy" }], 'Step 2 has an unknown kind "deploy".'],
    [[{ kind: "read", parents: [1] }], "Step 1 waits on a step that does not come before it."],
    [[{ kind: "read" }, "nope"], "Step 2 is not a step."],
    [TWO_BUILDS, "Another recipe for this work shape already has these steps."],
  ]) {
    const refused = act(book, { action: "edit-steps", id, steps });
    assert.equal(refused.ok, false);
    assert.equal(refused.error, error);
  }

  const deleted = act(book, { action: "delete", id });
  assert.equal(deleted.ok, true);
  assert.equal(deleted.playbook.recipes.length, 1);
  assert.ok(!deleted.playbook.recipes.some((recipe) => recipe.id === id));

  const unknownId = act(book, { action: "pin", id: "r_nope" });
  assert.deepEqual([unknownId.ok, unknownId.error], [false, "No recipe in this Playbook has that id."]);
  const unknownAction = act(book, { action: "burn", id });
  assert.equal(unknownAction.ok, false);
  assert.match(unknownAction.error, /cannot "burn"/);
  assert.equal(act(book).ok, false);
  assert.equal(book.recipes.length, 2, "the input never changed");
  assert.equal(book.recipes[0].pinned, false);
});

test("shelf: thickness by runs, tone by verified rate, retired last", () => {
  const counts = [[0, 1], [2, 0], [3, 0], [6, 1], [5, 5], [2, 9], [16, 0]];
  let book = emptyPlaybook();
  counts.forEach(([verified, failed], index) => {
    const steps = [{ kind: "read", parents: [] }, ...Array.from({ length: index }, () => ({ kind: "map" })), { kind: "build" }];
    book = withRuns(book, { steps, verified, failed });
  });
  const retiredId = book.recipes[6].id;
  book = act(book, { action: "retire", id: retiredId }).playbook;
  const pinnedId = book.recipes[1].id;
  book = act(book, { action: "pin", id: pinnedId }).playbook;
  const rows = shelf(book);
  assert.equal(rows.length, 7);
  assert.equal(rows[0].id, pinnedId);
  assert.equal(rows[6].id, retiredId);
  assert.equal(rows[6].retired, true);
  const byRuns = new Map(rows.map((row) => [row.runs, row]));
  assert.deepEqual([...byRuns.keys()].sort((a, b) => a - b), [1, 2, 3, 7, 10, 11, 16]);
  assert.deepEqual([1, 2, 3, 7, 10, 11, 16].map((runs) => byRuns.get(runs).thickness), [1, 2, 2, 3, 4, 4, 5]);
  assert.deepEqual([1, 2, 3, 7, 10, 11, 16].map((runs) => byRuns.get(runs).tone), ["new", "new", "good", "good", "mixed", "poor", "good"]);
  assert.equal(byRuns.get(7).verifiedRate, 0.857);
  assert.equal(byRuns.get(1).verifiedRate, 0);
  assert.deepEqual(Object.keys(rows[0]), ["id", "name", "runs", "verifiedRate", "medianMs", "thickness", "tone", "pinned", "retired", "signature"]);
  assert.equal(byRuns.get(2).medianMs, 1500);
  assert.equal(byRuns.get(1).medianMs, null);
  assert.deepEqual(shelf(null), []);
  const unsettled = shelf({ recipes: [{ id: "r_z", runs: 5, steps: STEPS }] })[0];
  assert.deepEqual([unsettled.verifiedRate, unsettled.tone, unsettled.thickness], [null, "new", 3]);
});

test("a pipeline filed as a recipe is picked for the next task and rebuilds the same shape", () => {
  const task = { id: "task_1", title: "Retry banner" };
  let pipeline = createPipeline({ task, shape: SHAPE, now: NOW });
  for (const event of [
    { type: "run-start", runId: "run_1", model: "m" }, { type: "spoke", runId: "run_1" },
    { type: "todos", runId: "run_1", todos: [{ content: "store tests", status: "completed" }] },
    { type: "run-end", runId: "run_1", ok: true }, { type: "awaiting" }, { type: "verdict", verdict: "verified" },
  ]) pipeline = advance(pipeline, event, { now: NOW + 1 }).pipeline;
  const book = record(emptyPlaybook(), {
    steps: recipeSteps(pipeline), signature: signature(pipeline), shape: SHAPE, verdict: "verified",
    durationMs: 60_000, taskId: task.id, now: NOW + 2,
  });
  const choice = pick(book, SHAPE);
  assert.equal(choice.reason, "best");
  const next = createPipeline({ task: { id: "task_2" }, shape: SHAPE, recipe: choice.recipe, now: NOW + 3 });
  assert.equal(next.source, "recipe");
  assert.equal(next.recipeId, choice.recipe.id);
  assert.equal(signature(next), signature(pipeline));
  assert.deepEqual(next.steps.map((step) => step.title), ["Read the ask", "Build", "store tests", "Test", "Verify", "Land"]);
  assert.ok(next.steps.every((step) => step.status === "queued" && step.grown === false));
});
