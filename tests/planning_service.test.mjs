import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createPlanningStore } from "../scripts/planning.cjs";
import { buildImplementationTasks } from "../scripts/planning.cjs";
import { createPlanningService, planningPrompt, summarizePlanning } from "../scripts/planning-service.cjs";
import { compact, housekeepingSweep } from "../scripts/assistant.mjs";

async function fixture(t, overrides = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "studio-planning-service-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = { id: "test_project", name: "Fixture", path: root };
  const store = createPlanningStore({ filePath: path.join(root, "planning.json"), project });
  const state = { board: { tasks: [] }, wakeups: 0, calls: 0, failBoard: false, failFinalSave: false, reply: { ok: true, text: "Explore the two options and record your preference." } };
  const service = createPlanningService({ project,
    store: { ...store, transaction: (fn) => store.transaction(async (plans) => {
      const result = await fn(plans);
      if (state.failFinalSave && plans.some((plan) => plan.status === "converted")) { state.failFinalSave = false; throw new Error("Simulated final plan save failure"); }
      return result;
    }) },
    mutateBoard: async (fn) => {
      if (state.failBoard) throw new Error("Simulated board save failure");
      const copy = structuredClone(state.board), result = fn(copy);
      if (result?.ok !== false) state.board = copy;
      return result;
    },
    onConverted: async () => { state.wakeups++; },
    complete: async () => { state.calls++; return state.reply; },
    ...overrides,
  });
  const action = async (action, fields = {}, id = null) => {
    const current = (await store.list()).find((plan) => !id || plan.id === id);
    return service.action({ projectId: project.id, planId: current?.id, version: current?.version, ...fields, action });
  };
  await action("create", { title: "Export reports", destination: "Download a report as CSV", outOfScope: "Scheduled email" });
  return { root, project, store, state, service, action, plan: async () => (await store.list())[0] };
}

const draft = { text: "Download the displayed report as CSV. Keep current filters and escape fields.", tasks: [
  { id: "csv", title: "Add CSV serialization", prompt: "Serialize filtered report rows, including commas and newlines.", acceptance: ["Round-trip quoted fields"], dependsOn: [] },
  { id: "button", title: "Add download control", prompt: "Connect a download control to the serializer.", acceptance: ["Download only displayed rows"], dependsOn: ["csv"] },
] };

test("only an approved settled plan explicitly converts, once, with mapped dependencies and full context", async (t) => {
  const f = await fixture(t);
  await f.action("add-question", { question: "Which rows should export?", type: "discussion", dependsOn: [] });
  assert.equal((await f.action("convert")).ok, false);
  assert.equal(f.state.board.tasks.length, 0);
  const questionId = (await f.plan()).questions[0].id;
  await f.action("resolve", { questionId, resolution: "Only the displayed rows", evidence: "User selected this behavior" });
  assert.equal((await f.action("draft-spec", draft)).ok, true);
  assert.equal((await f.action("convert")).ok, false);
  await f.action("approve-spec");
  assert.equal(f.state.board.tasks.length, 0);
  const before = await f.plan();
  const converted = await f.action("convert");
  assert.equal(converted.ok, true, converted.error);
  assert.equal(converted.plan.status, "converted");
  assert.equal(f.state.board.tasks.length, 2);
  assert.deepEqual(f.state.board.tasks[1].dependsOn, [f.state.board.tasks[0].id]);
  assert.match(f.state.board.tasks[0].prompt, /Only the displayed rows/);
  assert.match(f.state.board.tasks[0].prompt, /Scheduled email/);
  const repeated = await f.service.action({ action: "convert", projectId: f.project.id, planId: before.id, version: before.version });
  assert.equal(repeated.ok, true);
  assert.equal(f.state.board.tasks.length, 2);
  assert.deepEqual(repeated.plan.taskIds, converted.plan.taskIds);
});

test("conversion recovers after board failure and after a saved board with failed final plan save", async (t) => {
  const f = await fixture(t);
  await f.action("draft-spec", draft); await f.action("approve-spec");
  f.state.failBoard = true;
  const failure = await f.action("convert");
  assert.equal(failure.ok, false);
  assert.equal(failure.plans[0].status, "converting", "failed conversion returns the saved retry state");
  assert.equal((await f.plan()).status, "converting");
  assert.equal((await f.action("update", { destination: "Changed destination" })).ok, false);
  assert.equal(f.state.board.tasks.length, 0);
  f.state.failBoard = false; f.state.failFinalSave = true;
  assert.equal((await f.action("convert")).ok, false);
  assert.equal(f.state.board.tasks.length, 2);
  assert.equal((await f.plan()).status, "converting");
  assert.equal((await f.action("convert")).ok, true);
  assert.equal(f.state.board.tasks.length, 2);
  assert.equal((await f.plan()).status, "converted");
});

test("project mismatches and host-only action attempts cannot mutate planning or board work", async (t) => {
  const f = await fixture(t), before = await f.plan();
  assert.equal((await f.service.action({ action: "create", title: "Wrong project", destination: "Wrong", projectId: "other" })).ok, false);
  assert.equal((await f.service.list({ projectId: "other" })).ok, false);
  assert.equal((await f.action("begin-conversion")).ok, false);
  assert.equal((await f.action("mark-converted", { taskIds: ["injected"] })).ok, false);
  assert.deepEqual(await f.plan(), before);
  assert.equal(f.state.board.tasks.length, 0);
});

test("AI question proposals apply atomically, map dependencies, and never resolve or start work", async (t) => {
  const f = await fixture(t);
  f.state.reply = { ok: true, text: JSON.stringify({ questions: [
    { id: "first", question: "Which format is needed?", type: "discussion", dependsOn: [] },
    { id: "second", question: "How should missing values appear?", type: "prototype", dependsOn: ["first"] },
  ], unknowns: ["Large file performance"], note: "Start with the data format", action: "resolve", resolution: "Invented approval" }) };
  const before = await f.plan();
  const result = await f.service.assist({ projectId: f.project.id, planId: before.id, version: before.version, kind: "questions" });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.plan.questions.length, 2);
  assert.deepEqual(result.plan.questions[1].dependsOn, [result.plan.questions[0].id]);
  assert.ok(result.plan.questions.every((question) => question.status === "open"));
  assert.equal(result.plan.unknowns.length, 1);
  assert.equal(f.state.board.tasks.length, 0); assert.equal(f.state.wakeups, 0);
  const saved = await f.plan();
  f.state.reply.text = JSON.stringify({ questions: [
    { id: "third", question: "Which encoding?", type: "research", dependsOn: [] },
    { id: "fourth", question: "What else?", type: "discussion", dependsOn: ["missing"] },
  ], unknowns: [] });
  const invalid = await f.service.assist({ projectId: f.project.id, planId: saved.id, version: saved.version, kind: "questions" });
  assert.equal(invalid.ok, false);
  assert.deepEqual(await f.plan(), saved);
});

test("discussion saves user intent on transport failure and assistant advice cannot confirm a decision", async (t) => {
  const f = await fixture(t);
  await f.action("add-question", { question: "Which export format?", type: "discussion", dependsOn: [] });
  let plan = await f.plan();
  f.state.reply = { ok: false, error: "Offline" };
  const failure = await f.service.assist({ projectId: f.project.id, planId: plan.id, version: plan.version, kind: "question", questionId: plan.questions[0].id, message: "Compare CSV and JSON" });
  assert.equal(failure.ok, false);
  plan = failure.plans[0];
  assert.equal(plan.questions[0].notes[0].author, "user");
  assert.equal(plan.questions[0].notes[0].text, "Compare CSV and JSON");
  f.state.reply = { ok: true, text: "I recommend CSV, but you should record your choice." };
  const reply = await f.service.assist({ projectId: f.project.id, planId: plan.id, version: plan.version, kind: "question", questionId: plan.questions[0].id });
  assert.equal(reply.ok, true, reply.error);
  assert.equal(reply.plan.questions[0].notes.at(-1).author, "assistant");
  assert.equal(reply.plan.questions[0].status, "open");
  assert.equal(f.state.board.tasks.length, 0);
});

test("AI cannot draft early or overwrite a plan changed during a reply", async (t) => {
  let release, entered;
  const began = new Promise((resolve) => { entered = resolve; });
  const response = new Promise((resolve) => { release = resolve; });
  const f = await fixture(t, { complete: async () => { entered(); return response; } });
  await f.action("add-unknown", { text: "Which encoding?" });
  let plan = await f.plan();
  const blocked = await f.service.assist({ projectId: f.project.id, planId: plan.id, version: plan.version, kind: "spec" });
  assert.equal(blocked.ok, false);
  const pending = f.service.assist({ projectId: f.project.id, planId: plan.id, version: plan.version, kind: "questions" });
  await began;
  await f.action("update", { destination: "Export JSON instead" });
  release({ ok: true, text: JSON.stringify({ questions: [], unknowns: [], note: "Already clear" }) });
  const stale = await pending;
  assert.equal(stale.ok, false); assert.match(stale.error, /changed/);
  assert.equal((await f.plan()).destination, "Export JSON instead");
});

test("AI specification drafting saves an unapproved review artifact and requires explicit approval", async (t) => {
  const f = await fixture(t);
  f.state.reply = { ok: true, text: JSON.stringify({ ...draft, approvedAt: Date.now(), status: "converted" }) };
  const plan = await f.plan();
  const result = await f.service.assist({ projectId: f.project.id, planId: plan.id, version: plan.version, kind: "spec" });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.plan.spec.approvedAt, undefined);
  assert.equal(result.plan.status, "planning");
  assert.equal((await f.action("convert")).ok, false);
  assert.equal(f.state.board.tasks.length, 0);
});

test("approved plan task IDs survive automatic deduplication and grouping", async () => {
  const tasks = [
    { id: "planned", planningId: "plan_one", source: "planning", title: "Add export", prompt: "Reviewed scope", status: "open" },
    { id: "duplicate", title: "Add export", prompt: "A different unreviewed scope", status: "open" },
    { id: "sibling", title: "Export polish", status: "open" },
  ];
  const result = compact({ tasks, promoteIdeas: false, taskGroups: [{ theme: "Exports", tasks: ["Add export", "Export polish"] }] });
  const planned = result.tasks.find((task) => task.id === "planned");
  assert.ok(planned); assert.equal(planned.prompt, "Reviewed scope");
  assert.equal(planned.absorbedInto, undefined); assert.equal(planned.status, "open");
});

test("planning prompt preserves canonical decisions and refuses over-budget context instead of truncating", () => {
  const plan = { title: "Export", destination: "CSV", outOfScope: "Emails", unknowns: [], questions: [{ id: "q", question: "Rows?", status: "resolved", resolution: "Visible only", evidence: "User choice", dependsOn: [] }] };
  const prompt = planningPrompt(plan, "spec");
  assert.match(prompt.system, /no tools/); assert.match(prompt.user, /Visible only/);
  assert.throws(() => planningPrompt({ ...plan, destination: "x".repeat(100001) }, "spec"), /too large/);
});

test("assistant planning summaries count the full project but expose only bounded decision context", () => {
  const plans = Array.from({ length: 9 }, (_, index) => ({ id: `plan_${index}`, title: index === 0 ? "CSV export" : `Idea ${index}`, destination: "x".repeat(800), status: index % 2 ? "converted" : "planning", updatedAt: index, unknowns: [], questions: [
    { id: "first", question: "Choose the format", status: "open", dependsOn: [] },
    { id: "blocked", question: "Choose an encoding", status: "open", dependsOn: ["first"] },
  ], history: [{ secret: "Not a discussion context field" }] }));
  const summary = summarizePlanning(plans, "Tell me about CSV export");
  assert.equal(summary.total, 9); assert.equal(summary.active, 5); assert.equal(summary.converted, 4);
  assert.equal(summary.plans.length, 5); assert.equal(summary.truncated, 4);
  assert.equal(summary.plans[0].title, "CSV export");
  assert.deepEqual(summary.plans[0].readyQuestions.map((question) => question.id), ["first"]);
  assert.equal(summary.plans[0].destination.length, 400);
  assert.equal(JSON.stringify(summary).includes("secret"), false);
});

test("concurrent conversion requests admit one task set and stale converted retries preserve board edits", async (t) => {
  const f = await fixture(t);
  await f.action("draft-spec", draft); await f.action("approve-spec");
  const plan = await f.plan();
  const payload = { action: "convert", projectId: f.project.id, planId: plan.id, version: plan.version };
  const results = await Promise.all(Array.from({ length: 4 }, () => f.service.action(payload)));
  assert.ok(results.every((result) => result.ok));
  assert.equal(f.state.board.tasks.length, 2);
  assert.equal(new Set(f.state.board.tasks.map((task) => task.id)).size, 2);
  f.state.board.tasks[0].title = "Manually edited after conversion";
  const retainedId = f.state.board.tasks[0].id;
  f.state.board.tasks.pop();
  const repeated = await f.service.action(payload);
  assert.equal(repeated.ok, true);
  assert.equal(f.state.board.tasks.length, 1, "retrying a finished conversion does not recreate deleted tasks");
  assert.equal(f.state.board.tasks[0].id, retainedId);
  assert.equal(f.state.board.tasks[0].title, "Manually edited after conversion");
});

test("conversion refuses conflicting task origin metadata before adding any tasks", async (t) => {
  const f = await fixture(t);
  await f.action("draft-spec", draft); await f.action("approve-spec");
  const tasks = buildImplementationTasks(await f.plan(), { project: f.project });
  for (const key of ["planningId", "planningSpecId", "planningTaskId", "projectId", "source"]) {
    const conflicting = { ...tasks[1], [key]: "unrelated" };
    f.state.board.tasks = [conflicting];
    const result = await f.action("convert");
    assert.equal(result.ok, false, `${key} must match before treating an existing task as a successful retry`);
    assert.match(result.error, /conflicts/);
    assert.deepEqual(f.state.board.tasks, [conflicting], "the first task cannot be inserted before discovering a later collision");
    assert.equal((await f.plan()).status, "converting");
  }
  f.state.board.tasks = [tasks[1]];
  assert.equal((await f.action("convert")).ok, true);
  assert.equal(f.state.board.tasks.length, 2);
});

test("a queue wakeup failure cannot turn durable task admission into a failed conversion", async (t) => {
  const f = await fixture(t, { onConverted: async () => { throw new Error("Scheduler unavailable"); } });
  await f.action("draft-spec", draft); await f.action("approve-spec");
  const result = await f.action("convert");
  assert.equal(result.ok, true);
  assert.match(result.note, /Tasks were saved/);
  assert.equal(f.state.board.tasks.length, 2);
  assert.equal((await f.plan()).status, "converted");
});

test("conversion reports only newly admitted durable tasks and remains silent on repeated task identities", async (t) => {
  const admissions = [];
  let f;
  f = await fixture(t, { onConverted: async (tasks) => {
    assert.ok(Array.isArray(tasks));
    for (const task of tasks) assert.ok(f.state.board.tasks.some((saved) => saved.id === task.id), "classification follows durable task admission");
    admissions.push(...structuredClone(tasks));
  } });
  await f.action("draft-spec", draft); await f.action("approve-spec");
  f.state.failBoard = true;
  assert.equal((await f.action("convert")).ok, false);
  assert.equal(admissions.length, 0, "a failed board write never reaches downstream intake");
  f.state.failBoard = false;
  f.state.failFinalSave = true;
  assert.equal((await f.action("convert")).ok, false);
  assert.deepEqual(admissions.map((task) => task.id), f.state.board.tasks.map((task) => task.id), "durable tasks reach intake even if the final planning journal write fails");
  assert.ok(admissions.every((task) => task.source === "planning" && task.projectId === f.project.id));
  assert.equal((await f.action("convert")).ok, true);
  assert.equal((await f.action("convert")).ok, true);
  assert.equal(admissions.length, 2, "recovery and repeated conversion do not reclassify existing tasks");
});

test("partial conversion recovery reports only missing tasks added to the board", async (t) => {
  const admissions = [];
  const f = await fixture(t, { onConverted: async (tasks) => admissions.push(...tasks) });
  await f.action("draft-spec", draft); await f.action("approve-spec");
  const tasks = buildImplementationTasks(await f.plan(), { project: f.project });
  f.state.board.tasks = [tasks[0]];
  assert.equal((await f.action("convert")).ok, true);
  assert.deepEqual(admissions.map((task) => task.id), [tasks[1].id]);
});

test("distinct approved tasks sharing titles survive compaction, grouping and an active owner's housekeeping", async (t) => {
  const f = await fixture(t);
  const sharedTitle = "Implement reviewed export";
  const firstDraft = { ...draft, tasks: draft.tasks.map((task) => ({ ...task, title: sharedTitle })) };
  await f.action("draft-spec", firstDraft); await f.action("approve-spec"); await f.action("convert");
  const created = await f.action("create", { title: "Second export plan", destination: "Export JSON", outOfScope: "CSV changes" });
  const secondPlanId = created.plan.id;
  const secondDraft = { text: "Export JSON reports.", tasks: firstDraft.tasks.map((task) => ({ ...task, prompt: `JSON scope: ${task.prompt}`, acceptance: [`JSON check: ${task.acceptance[0]}`] })) };
  await f.action("draft-spec", secondDraft, secondPlanId); await f.action("approve-spec", {}, secondPlanId); await f.action("convert", {}, secondPlanId);
  assert.equal(f.state.board.tasks.length, 4);
  const first = f.state.board.tasks[0];
  first.status = "active"; first.runId = "fixture-owner"; first.lease = { at: Date.now(), pid: process.pid };
  const retained = (tasks) => tasks.map(({ id, planningId, planningSpecId, planningTaskId, prompt, acceptance, dependsOn, status, runId }) => ({ id, planningId, planningSpecId, planningTaskId, prompt, acceptance, dependsOn, status, runId }));
  const expected = retained(f.state.board.tasks);
  const compacted = compact({ tasks: f.state.board.tasks, promoteIdeas: false, taskGroups: [{ title: "Export work", tasks: [sharedTitle, sharedTitle] }] });
  assert.deepEqual(retained(compacted.tasks), expected);
  const swept = housekeepingSweep({ tasks: compacted.tasks, liveRuns: new Set([first.runId]), now: Date.now() });
  assert.deepEqual(retained(swept.tasks), expected);
  assert.equal(new Set(swept.tasks.map((task) => task.id)).size, 4);
  assert.equal(new Set(swept.tasks.map((task) => task.planningId)).size, 2);
});

test("list carries what the folder already holds, and a failed scan leaves the plans standing", async (t) => {
  const seen = [];
  const { service, project } = await fixture(t, { scanWork: async ({ root, fresh }) => { seen.push({ root, fresh }); return { ok: true, root, tracker: { kind: "local" }, efforts: [{ slug: "e", dir: ".scratch/e", map: null, spec: null, tickets: [], counts: { open: 0, claimed: 0, resolved: 0, frontier: 0 } }], remote: null, tooling: { counts: { agents: 1, skills: 2, commands: 0, plugins: 0 } }, counts: { maps: 0, specs: 0, open: 0, frontier: 0, resolved: 0 } }; } });
  const listed = await service.list({ projectId: project.id });
  assert.equal(listed.ok, true);
  assert.ok(Array.isArray(listed.plans), "the plans list stands beside the scan");
  assert.equal(listed.existing.tracker.kind, "local");
  assert.equal(listed.existing.efforts.length, 1);
  assert.deepEqual(seen, [{ root: project.path, fresh: false }]);
  await service.list({ projectId: project.id, fresh: true });
  assert.deepEqual(seen.at(-1), { root: project.path, fresh: true });
  const broken = await fixture(t, { scanWork: async () => { throw new Error("gh exploded"); } });
  const result = await broken.service.list({ projectId: broken.project.id });
  assert.equal(result.ok, true);
  assert.equal(result.existing.ok, false);
  assert.equal(result.existing.error, "gh exploded");
  const plain = await fixture(t);
  assert.equal((await plain.service.list({ projectId: plain.project.id })).existing, null, "no scanner means no panel, not an error");
});
