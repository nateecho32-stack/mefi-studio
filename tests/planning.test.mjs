import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createPlanningStore, applyPlanningAction, buildImplementationTasks, LIMITS } = require("../scripts/planning.cjs");
const project = { id: "project_a", name: "Fixture", path: "C:/fixture/a" };
const otherProject = { id: "project_b", name: "Other", path: "C:/fixture/b" };
const draft = {
  text: "Keep settings locally, use the project's existing reader, and preserve every old setting.",
  tasks: [
    { id: "storage", title: "Store settings", prompt: "Implement the selected persistence layer.", acceptance: ["Existing settings survive migration.", "Invalid writes preserve saved data."], dependsOn: [] },
    { id: "view", title: "Edit settings", prompt: "Build a preferences view.", acceptance: "Saved values survive reloading the view.", dependsOn: ["storage"] },
  ],
};

function fixture() {
  const plans = [];
  let clock = 100;
  const create = applyPlanningAction(plans, { action: "create", title: "Settings", destination: "Users can edit project settings without losing data.", outOfScope: "Cloud sync" }, { project, now: clock++ });
  assert.equal(create.ok, true, create.error);
  const id = create.plan.id;
  const current = () => plans.find((plan) => plan.id === id);
  const action = (kind, fields = {}, actor = "user") => applyPlanningAction(plans, { action: kind, planId: id, version: current().version, ...fields }, { project, now: clock++, actor });
  const ok = (kind, fields = {}, actor = "user") => { const result = action(kind, fields, actor); assert.equal(result.ok, true, result.error); return result.plan; };
  const ready = () => { ok("confirm-understanding"); ok("draft-spec", draft); return ok("approve-spec"); };
  return { plans, current, action, ok, ready };
}

async function storeFixture(t, selectedProject = project) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "studio-planning-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "planning.json");
  return { directory, filePath, store: createPlanningStore({ filePath, project: selectedProject }) };
}

test("unknowns and open questions gate specs and human approval", () => {
  const f = fixture();
  assert.equal(f.action("approve-spec").ok, false);
  f.ok("add-unknown", { text: "Where should the settings live?" });
  assert.equal(f.action("draft-spec", draft).ok, false);
  const unknown = f.current().unknowns[0];
  const plan = f.ok("add-question", { question: "Choose a storage format", type: "discussion", unknownId: unknown.id });
  assert.equal(plan.unknowns.length, 0);
  assert.equal(plan.history.at(-1).unknown.text, unknown.text);
  assert.equal(plan.history.at(-1).questionId, plan.questions[0].id);
  assert.equal(f.action("draft-spec", draft).ok, false);
  assert.equal(f.action("resolve", { questionId: plan.questions[0].id, resolution: "   " }).ok, false);
  f.ok("resolve", { questionId: plan.questions[0].id, resolution: "Use local JSON", evidence: "Existing project reader supports JSON." });
  assert.equal(f.action("draft-spec", draft).ok, false, "a specification needs a reviewed understanding");
  f.ok("confirm-understanding");
  f.ok("draft-spec", draft);
  assert.equal(f.action("approve-spec", {}, "assistant").ok, false);
  const approved = f.ok("approve-spec");
  assert.equal(approved.status, "ready");
  assert.ok(approved.spec.approvedAt);
});

test("setting an unknown aside requires a reason and retains the full unknown in history", () => {
  const f = fixture();
  f.ok("add-unknown", { text: "Should this also sync between computers?" });
  const unknownId = f.current().unknowns[0].id;
  assert.equal(f.action("remove-unknown", { unknownId }).ok, false);
  const before = structuredClone(f.plans);
  assert.equal(f.action("remove-unknown", { unknownId, reason: "Not needed" }, "assistant").ok, false);
  assert.deepEqual(f.plans, before);
  const plan = f.ok("remove-unknown", { unknownId, reason: "Cloud sync is out of scope for this release." });
  assert.equal(plan.unknowns.length, 0);
  assert.equal(plan.history.at(-1).reason, "Cloud sync is out of scope for this release.");
  assert.equal(plan.history.at(-1).unknown.text, "Should this also sync between computers?");
});

test("question prerequisites reject missing IDs, cycles, and blocked decisions without mutation", () => {
  const f = fixture();
  f.ok("add-question", { question: "Choose persistence", type: "discussion" });
  const first = f.current().questions[0].id;
  f.ok("add-question", { question: "Prove the reader works", type: "prototype", dependsOn: [first] });
  const second = f.current().questions[1].id;
  f.ok("add-question", { question: "Check migration", type: "research", dependsOn: [second] });
  const third = f.current().questions[2].id;
  const saved = structuredClone(f.plans);
  for (const [kind, payload] of [
    ["add-question", { question: "Bad dependency", type: "research", dependsOn: ["missing"] }],
    ["edit-question", { questionId: first, dependsOn: [third] }],
    ["edit-question", { questionId: first, dependsOn: [first] }],
    ["resolve", { questionId: second, resolution: "It works" }],
  ]) { assert.equal(f.action(kind, payload).ok, false); assert.deepEqual(f.plans, saved); }
  f.ok("resolve", { questionId: first, resolution: "JSON" });
  f.ok("resolve", { questionId: second, resolution: "Prototype reviewed and accepted" });
  f.ok("resolve", { questionId: third, resolution: "Migration must preserve unknown fields" });
  f.ready();
  const reopened = f.ok("reopen", { questionId: first });
  assert.deepEqual(reopened.questions.map((question) => question.status), ["open", "open", "open"]);
  assert.ok(reopened.questions.every((question) => question.resolution === "" && question.resolvedBy === null));
  assert.equal(reopened.status, "planning");
  assert.equal(reopened.spec.stale, true);
  assert.equal(reopened.spec.approvedAt, undefined);
  assert.equal(reopened.history.at(-2).snapshot.questions[2].resolution, "Migration must preserve unknown fields");
});

test("changing scope reopens all decisions and only a new draft can approve changed planning", () => {
  const f = fixture();
  f.ok("add-question", { question: "Choose format", type: "discussion" });
  const questionId = f.current().questions[0].id;
  f.ok("resolve", { questionId, resolution: "JSON" });
  f.ready();
  f.ok("update", { destination: "Support a second project and preserve all settings." });
  assert.equal(f.current().questions[0].status, "open");
  f.ok("resolve", { questionId, resolution: "JSON files scoped to each project" });
  assert.equal(f.action("approve-spec").ok, false, "stale text cannot become approved after decisions are resolved again");
  f.ok("confirm-understanding");
  f.ok("draft-spec", draft);
  assert.equal(f.ok("approve-spec").status, "ready");
});

test("assistant proposals and discussion notes cannot impersonate human decisions", () => {
  const f = fixture();
  f.ok("add-question", { question: "Choose a persistence format", type: "discussion" }, "assistant");
  const questionId = f.current().questions[0].id;
  for (const actor of ["assistant", "host"]) {
    assert.equal(f.action("resolve", { questionId, resolution: "JSON", actor: "user", resolvedBy: "user" }, actor).ok, false);
  }
  f.ok("add-note", { questionId, text: "JSON is supported by the existing reader.", author: "user" }, "assistant");
  assert.equal(f.current().questions[0].notes[0].author, "assistant");
  assert.equal(f.current().questions[0].notes[0].kind, "advice");
  assert.equal(f.current().questions[0].status, "open");
  // An interview line can only carry a kind belonging to its own author, so a
  // model reply can never be filed as something the human answered.
  for (const kind of ["answer", "note"]) assert.equal(f.action("add-note", { questionId, text: "You told me to use JSON.", kind }, "assistant").ok, false);
  for (const kind of ["question", "interpretation", "advice", "conflict"]) assert.equal(f.action("add-note", { questionId, text: "Mefi asked me this.", kind }).ok, false);
  f.ok("add-note", { questionId, text: "You want it to stay local.", kind: "interpretation" }, "assistant");
  assert.equal(f.current().questions[0].status, "open", "a reading of your answer is not your decision");
  f.ok("resolve", { questionId, resolution: "Use JSON" });
  f.ok("confirm-understanding");
  f.ok("draft-spec", draft, "assistant");
  f.ok("approve-spec");
  const approvedAt = f.current().spec.approvedAt;
  f.ok("add-note", { questionId, text: "I reviewed the prototype.", author: "assistant", kind: "answer" });
  assert.equal(f.current().questions[0].notes.at(-1).author, "user");
  assert.equal(f.current().spec.approvedAt, approvedAt);
  assert.equal(f.current().status, "ready", "informational notes do not discard approval");
  const tasks = buildImplementationTasks(f.current(), { project, now: 999 });
  assert.match(tasks[0].prompt, /Mefi suggested: JSON is supported by the existing reader/);
  assert.match(tasks[0].prompt, /Mefi read that back \(unconfirmed\): You want it to stay local/);
  assert.match(tasks[0].prompt, /You answered: I reviewed the prototype/);
  assert.match(tasks[0].prompt, /Decision confirmed by you: Use JSON/);
});

test("question edits reopen affected decisions while keeping independent decisions resolved", () => {
  const f = fixture();
  for (const question of ["Storage format", "Theme color"]) f.ok("add-question", { question, type: "discussion" });
  const [storage, theme] = f.current().questions.map((question) => question.id);
  f.ok("resolve", { questionId: storage, resolution: "JSON" });
  f.ok("resolve", { questionId: theme, resolution: "Gold" });
  f.ok("edit-question", { questionId: storage, question: "Storage format and migration strategy" });
  assert.equal(f.current().questions[0].status, "open");
  assert.equal(f.current().questions[1].status, "resolved");
  assert.equal(f.current().questions[1].resolution, "Gold");
  const count = f.current().history.length;
  f.ok("edit-question", { questionId: storage, question: "Storage format and migration strategy" });
  assert.equal(f.current().history.length, count, "no-op edits do not flood history");
});

test("unknown promotion is atomic when a stale or invalid proposal fails", () => {
  const f = fixture();
  f.ok("add-unknown", { text: "Migration behavior?" });
  const unknownId = f.current().unknowns[0].id;
  const saved = structuredClone(f.plans);
  assert.equal(f.action("add-question", { unknownId, question: "Migration", type: "research", dependsOn: ["missing"] }).ok, false);
  assert.deepEqual(f.plans, saved);
  f.ok("add-question", { unknownId, question: "How should migration work?", type: "research" });
  const promoted = structuredClone(f.plans);
  assert.equal(f.action("add-question", { unknownId, question: "Duplicate question", type: "research" }).ok, false);
  assert.deepEqual(f.plans, promoted);
  assert.equal(f.action("update", { version: 1, title: "Lost update" }).ok, false);
  assert.equal(f.current().title, "Settings");
});

test("draft task validation rejects missing criteria, dependencies, cycles, and excessive text", () => {
  const f = fixture();
  f.ok("confirm-understanding");
  const saved = structuredClone(f.plans);
  const invalidDrafts = [
    { ...draft, tasks: [] },
    { ...draft, tasks: [{ ...draft.tasks[0], acceptance: [] }] },
    { ...draft, tasks: [{ ...draft.tasks[0], acceptance: " " }] },
    { ...draft, tasks: [{ ...draft.tasks[0], dependsOn: ["gone"] }] },
    { ...draft, tasks: [{ ...draft.tasks[0], dependsOn: ["view"] }, draft.tasks[1]] },
    { ...draft, tasks: [draft.tasks[0], draft.tasks[0]] },
    { ...draft, text: "x".repeat(LIMITS.spec + 1) },
  ];
  for (const invalid of invalidDrafts) { assert.equal(f.action("draft-spec", invalid).ok, false); assert.deepEqual(f.plans, saved); }
  assert.equal(f.action("update", { title: "x".repeat(LIMITS.title + 1) }).ok, false);
  f.ok("draft-spec", draft);
  assert.deepEqual(f.current().spec.tasks[1].acceptance, [draft.tasks[1].acceptance]);
});

test("implementation handoff includes complete scope, decisions, evidence, criteria and mapped prerequisites", () => {
  const f = fixture();
  const fullResolution = "Preserve all existing keys and values. ".repeat(300);
  f.ok("add-question", { question: "Migration requirements?", type: "research" });
  f.ok("resolve", { questionId: f.current().questions[0].id, resolution: fullResolution, evidence: "src/settings-reader.js" });
  assert.throws(() => buildImplementationTasks(f.current(), { project }), /approve/);
  f.ready();
  const tasks = buildImplementationTasks(f.current(), { project, now: 500 });
  assert.deepEqual(tasks.map((task) => task.id), buildImplementationTasks(f.current(), { project, now: 800 }).map((task) => task.id));
  assert.deepEqual(tasks[1].dependsOn, [tasks[0].id]);
  for (const task of tasks) {
    assert.ok(task.prompt.includes(fullResolution.trim()));
    assert.ok(task.prompt.includes(draft.text));
    assert.ok(task.prompt.includes(f.current().destination));
    assert.match(task.prompt, /Cloud sync/);
    assert.match(task.prompt, /src\/settings-reader.js/);
    assert.equal(task.source, "planning");
    assert.equal(task.planningId, f.current().id);
    assert.equal(task.projectId, project.id);
    assert.equal(task.status, "open");
    // The owner approved the plan, so its tasks rank with the owner's work.
    assert.deepEqual(task.origin, { kind: "planning", by: "owner" });
    assert.ok(task.prompt.indexOf(`YOUR TASK: ${task.title}`) < task.prompt.indexOf("Approved specification"));
    assert.ok(task.prompt.indexOf("Acceptance criteria for this task") < task.prompt.indexOf("Destination"));
  }
  assert.throws(() => buildImplementationTasks(f.current(), { project: otherProject }), /different project/);
  const snapshot = f.current().history.find((entry) => entry.action === "resolve").snapshot;
  assert.equal(snapshot.questions[0].resolution, fullResolution.trim());
});

test("conversion is a host-only immutable transition with repeatable implementation IDs", () => {
  const f = fixture();
  f.ready();
  const ids = buildImplementationTasks(f.current(), { project }).map((task) => task.id);
  assert.equal(f.action("begin-conversion").ok, false);
  assert.equal(f.action("mark-converted", { taskIds: ids }, "host").ok, false);
  f.ok("begin-conversion", {}, "host");
  assert.deepEqual(f.current().taskIds, ids);
  assert.equal(f.current().status, "converting");
  assert.equal(f.action("update", { title: "Changed scope" }).ok, false);
  assert.equal(f.action("draft-spec", draft).ok, false);
  const version = f.current().version;
  f.ok("begin-conversion", {}, "host");
  assert.equal(f.current().version, version);
  assert.equal(f.action("mark-converted", { taskIds: ["wrong"] }, "host").ok, false);
  f.ok("mark-converted", { taskIds: ids }, "host");
  assert.equal(f.current().status, "converted");
  assert.deepEqual(buildImplementationTasks(f.current(), { project }).map((task) => task.id), ids);
  const convertedVersion = f.current().version;
  f.ok("mark-converted", { taskIds: ids }, "host");
  assert.equal(f.current().version, convertedVersion);
  assert.equal(f.action("reopen", { questionId: "any" }).ok, false);
});

test("serialized stores preserve concurrent creates and reject stale concurrent edits", async (t) => {
  const { filePath, store } = await storeFixture(t);
  const second = createPlanningStore({ filePath, project });
  const results = await Promise.all(Array.from({ length: 10 }, (_, index) => (index % 2 ? store : second).mutate({ action: "create", title: `Plan ${index}`, destination: `Outcome ${index}` })));
  assert.ok(results.every((result) => result.ok));
  const plans = await store.list();
  assert.equal(plans.length, 10);
  const selected = plans[0];
  const edits = await Promise.all([store, second].map((instance, index) => instance.mutate({ action: "update", planId: selected.id, version: selected.version, title: `Edit ${index}` })));
  assert.equal(edits.filter((result) => result.ok).length, 1);
  assert.match(edits.find((result) => !result.ok).error, /changed/);
  assert.equal((await second.list())[0].version, 2);
  const read = await store.list();
  read[0].title = "Mutated outside the store";
  assert.notEqual((await store.list())[0].title, read[0].title);
  assert.deepEqual((await fs.readdir(path.dirname(filePath))).filter((name) => name.includes(".tmp-")), []);
});

test("transaction errors, rejected results and invalid state preserve exact saved bytes", async (t) => {
  const { filePath, store } = await storeFixture(t);
  await store.mutate({ action: "create", title: "One", destination: "An outcome" });
  const before = await fs.readFile(filePath, "utf8");
  await assert.rejects(store.transaction((plans) => { plans[0].title = "Lost"; throw new Error("Board save failed"); }), /Board save failed/);
  assert.equal(await fs.readFile(filePath, "utf8"), before);
  const rejected = await store.transaction((plans) => { plans[0].title = "Lost"; return { ok: false, error: "No change" }; });
  assert.equal(rejected.ok, false);
  assert.equal(await fs.readFile(filePath, "utf8"), before);
  await assert.rejects(store.transaction((plans) => { plans[0].title = "Edit without history"; return { ok: true }; }), /saved history/);
  assert.equal(await fs.readFile(filePath, "utf8"), before);
  const current = (await store.list())[0];
  assert.equal((await store.mutate({ action: "update", planId: current.id, version: current.version, title: "Queue recovered" })).ok, true);
});

test("planning files reject corruption and foreign projects without overwriting them", async (t) => {
  const { filePath, store } = await storeFixture(t);
  for (const body of ["{torn", JSON.stringify({ version: 999, plans: [] }), JSON.stringify({ version: 1, projectId: otherProject.id, plans: [] })]) {
    await fs.writeFile(filePath, body);
    await assert.rejects(store.list(), /preserved/);
    const result = await store.mutate({ action: "create", title: "Repair?", destination: "Do not overwrite" });
    assert.equal(result.ok, false);
    assert.equal(await fs.readFile(filePath, "utf8"), body);
  }
});

test("captured project context prevents cross-project reads and mutation", async (t) => {
  const { filePath, store } = await storeFixture(t);
  const created = await store.mutate({ action: "create", title: "Project A", destination: "A only", projectId: otherProject.id });
  assert.equal(created.plan.projectId, project.id);
  const foreign = createPlanningStore({ filePath, project: otherProject });
  assert.equal((await foreign.mutate({ action: "update", planId: created.plan.id, version: 1, title: "Crossed" })).ok, false);
  const secondFile = path.join(path.dirname(filePath), "other.json");
  const other = createPlanningStore({ filePath: secondFile, project: otherProject });
  assert.deepEqual(await other.list(), []);
  assert.equal((await other.mutate({ action: "update", planId: created.plan.id, version: 1, title: "Crossed" })).ok, false);
  assert.equal((await store.list())[0].title, "Project A");
});

test("interrupted board promotion resumes deterministic tasks and never unlocks the specification", async (t) => {
  const { store } = await storeFixture(t);
  const f = fixture();
  f.ready();
  await store.transaction((plans) => { plans.push(structuredClone(f.current())); return { ok: true }; });
  const apply = (plans, action, fields = {}) => applyPlanningAction(plans, { action, planId: plans[0].id, version: plans[0].version, ...fields }, { project, actor: "host", now: 1000 });
  await store.transaction((plans) => apply(plans, "begin-conversion"));
  const board = new Map();
  await assert.rejects(store.transaction((plans) => {
    for (const task of buildImplementationTasks(plans[0], { project })) board.set(task.id, task);
    throw new Error("Process stopped after board commit");
  }), /Process stopped/);
  const pending = (await store.list())[0];
  assert.equal(pending.status, "converting");
  assert.equal((await store.mutate({ action: "draft-spec", planId: pending.id, version: pending.version, ...draft })).ok, false);
  await store.transaction((plans) => {
    const tasks = buildImplementationTasks(plans[0], { project });
    for (const task of tasks) if (!board.has(task.id)) board.set(task.id, task);
    return apply(plans, "mark-converted", { taskIds: tasks.map((task) => task.id) });
  });
  assert.equal(board.size, draft.tasks.length);
  assert.equal((await store.list())[0].status, "converted");
  assert.deepEqual((await store.list())[0].taskIds, [...board.keys()]);
});

test("renaming a plan keeps the confirmed reading and the approved specification", () => {
  const f = fixture();
  f.ok("add-question", { question: "Choose format", type: "discussion" });
  f.ok("resolve", { questionId: f.current().questions[0].id, resolution: "JSON" });
  const approved = f.ready();
  const renamed = f.ok("update", { title: "Project settings" });
  assert.equal(renamed.title, "Project settings");
  assert.equal(renamed.status, "ready", "a new name is not a new decision");
  assert.equal(renamed.reviewedAt, approved.reviewedAt);
  assert.equal(renamed.spec.approvedAt, approved.spec.approvedAt);
  assert.equal(renamed.spec.stale, false);
  assert.equal(renamed.questions[0].status, "resolved");
  const rescoped = f.ok("update", { outOfScope: "Cloud sync and sharing" });
  assert.equal(rescoped.status, "planning", "a changed scope still withdraws both");
  assert.equal(rescoped.reviewedAt, undefined);
  assert.equal(rescoped.spec.stale, true);
});

test("saving an unchanged specification keeps its approval, and a changed one withdraws it", () => {
  const f = fixture();
  const approved = f.ready();
  const again = f.ok("draft-spec", draft);
  assert.equal(again.version, approved.version, "the same wording is not a revision");
  assert.equal(again.spec.id, approved.spec.id);
  assert.equal(again.spec.approvedAt, approved.spec.approvedAt);
  assert.equal(again.status, "ready");
  const revised = f.ok("draft-spec", { ...draft, text: `${draft.text} Keep a backup.` });
  assert.notEqual(revised.spec.id, approved.spec.id);
  assert.equal(revised.spec.approvedAt, undefined);
  assert.equal(revised.status, "planning");
});

test("reopening a question that is still open is refused instead of withdrawing your review", () => {
  const f = fixture();
  f.ok("add-question", { question: "Choose format", type: "discussion" });
  const questionId = f.current().questions[0].id;
  f.ok("resolve", { questionId, resolution: "JSON" });
  f.ok("confirm-understanding");
  f.ok("add-question", { question: "Name the file", type: "discussion" });
  const open = f.current().questions[1].id;
  const before = structuredClone(f.current());
  assert.equal(f.action("reopen", { questionId: open }).ok, false);
  assert.deepEqual(f.current(), before);
  assert.equal(f.ok("reopen", { questionId }).questions[0].status, "open");
});

test("archiving sets a plan aside read-only, only you can do it, and restoring brings it back unchanged", () => {
  const f = fixture();
  f.ok("add-question", { question: "Choose format", type: "discussion" });
  const before = f.current();
  assert.equal(f.action("archive", {}, "assistant").ok, false);
  assert.equal(f.action("archive", {}, "host").ok, false);
  const archived = f.ok("archive");
  assert.ok(Number.isSafeInteger(archived.archivedAt));
  assert.equal(archived.history.at(-1).action, "archive");
  for (const [kind, fields] of [["update", { title: "Renamed" }], ["add-unknown", { text: "Gap" }], ["add-note", { questionId: before.questions[0].id, text: "Hi" }], ["archive", {}]]) {
    assert.equal(f.action(kind, fields).ok, false, kind);
  }
  const restored = f.ok("restore");
  assert.equal(restored.archivedAt, undefined);
  const { version, updatedAt, history, ...body } = restored;
  const { version: _v, updatedAt: _u, history: _h, ...original } = before;
  assert.deepEqual(body, original, "restoring changes nothing else about the plan");
  assert.equal(f.action("restore").ok, false, "a plan in play cannot be restored again");
});

test("a plan creating its tasks cannot be archived, and a converted plan can be archived and restored", () => {
  const f = fixture();
  const ready = f.ready();
  const converting = applyPlanningAction(f.plans, { action: "begin-conversion", planId: ready.id, version: ready.version }, { project, actor: "host", now: 500 });
  assert.equal(converting.ok, true, converting.error);
  assert.equal(f.action("archive").ok, false);
  const converted = applyPlanningAction(f.plans, { action: "mark-converted", planId: ready.id, version: converting.plan.version, taskIds: converting.plan.taskIds }, { project, actor: "host", now: 501 });
  assert.equal(converted.ok, true, converted.error);
  assert.equal(f.ok("archive").status, "converted");
  assert.equal(f.ok("restore").status, "converted");
});

test("the plan cap counts plans in play, so archiving one makes room", () => {
  const plans = [];
  for (let index = 0; index < LIMITS.plans; index += 1) assert.equal(applyPlanningAction(plans, { action: "create", title: `Plan ${index}`, destination: "Somewhere" }, { project, now: 1 }).ok, true);
  const refused = applyPlanningAction(plans, { action: "create", title: "One more", destination: "Somewhere" }, { project, now: 2 });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /Archive one/);
  assert.equal(applyPlanningAction(plans, { action: "archive", planId: plans[0].id, version: plans[0].version }, { project, now: 3 }).ok, true);
  assert.equal(applyPlanningAction(plans, { action: "create", title: "One more", destination: "Somewhere" }, { project, now: 4 }).ok, true);
  const full = applyPlanningAction(plans, { action: "restore", planId: plans[0].id, version: plans[0].version }, { project, now: 5 });
  assert.equal(full.ok, false, "restoring would exceed the plans in play");
});
