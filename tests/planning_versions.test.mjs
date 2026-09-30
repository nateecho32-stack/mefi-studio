// Plan versions (ZA3): every edit of a plan is a version with when, who and a
// one-line note; "restore-version" makes an OLD version the newest one without
// rewriting history (restoring version 2 of 3 makes version 4); a plan saved
// with no history gets its current wording as version 1 the first time it is
// read. The store already kept a full snapshot per edit; these tests pin what
// was added on top of it and that nothing in it was dropped.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createPlanningService } from "../scripts/planning-service.cjs";

const require = createRequire(import.meta.url);
const { createPlanningStore, applyPlanningAction, withHistory, VERSION_AUTHORS } = require("../scripts/planning.cjs");
const project = { id: "project_a", name: "Fixture", path: "C:/fixture/a" };
const draft = {
  text: "Keep settings locally and preserve every old setting.",
  tasks: [{ id: "storage", title: "Store settings", prompt: "Implement the selected persistence layer.", acceptance: ["Existing settings survive migration."], dependsOn: [] }],
};

function fixture() {
  const plans = [];
  let clock = 1000;
  const create = applyPlanningAction(plans, { action: "create", title: "Settings", destination: "Users can edit project settings without losing data.", outOfScope: "Cloud sync" }, { project, now: clock++ });
  assert.equal(create.ok, true, create.error);
  const id = create.plan.id;
  const current = () => plans.find((plan) => plan.id === id);
  const action = (kind, fields = {}, actor = "user") => applyPlanningAction(plans, { action: kind, planId: id, version: current().version, ...fields }, { project, now: clock++, actor });
  const ok = (kind, fields = {}, actor = "user") => { const result = action(kind, fields, actor); assert.equal(result.ok, true, result.error); return result.plan; };
  return { plans, current, action, ok, tick: () => clock };
}

async function storeFixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "studio-planning-versions-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "planning.json");
  return { directory, filePath, store: createPlanningStore({ filePath, project }) };
}

test("every edit is a version with when, who and a one-line note of what it did", () => {
  const f = fixture();
  const [first] = f.current().history;
  assert.equal(first.version, 1);
  assert.equal(first.by, "user");
  assert.equal(first.note, "Started the plan");
  assert.equal(first.at, 1000);
  f.ok("update", { title: "Project settings" });
  f.ok("update", { destination: "Users can edit project settings and keep every old one." });
  f.ok("add-unknown", { text: "Should this also sync between computers?" });
  const unknownId = f.current().unknowns[0].id;
  f.ok("add-question", { question: "Where should the settings live?", type: "discussion", unknownId });
  const questionId = f.current().questions[0].id;
  f.ok("add-note", { questionId, text: "JSON is supported by the existing reader.", kind: "advice" }, "assistant");
  f.ok("resolve", { questionId, resolution: "Local JSON" });
  f.ok("reopen", { questionId });
  f.ok("resolve", { questionId, resolution: "Local JSON, one file per project" });
  f.ok("confirm-understanding");
  f.ok("draft-spec", draft);
  f.ok("approve-spec");
  f.ok("archive");
  f.ok("restore");
  const notes = f.current().history.map((entry) => [entry.version, entry.by, entry.note]);
  assert.deepEqual(notes, [
    [1, "user", "Started the plan"],
    [2, "user", "Renamed the plan to “Project settings”"],
    [3, "user", "Changed the destination"],
    [4, "user", "Added an unknown: “Should this also sync between computers?”"],
    [5, "user", "Turned an unknown into a question: “Where should the settings live?”"],
    [6, "assistant", "Added a line to “Where should the settings live?”"],
    [7, "user", "Decided “Where should the settings live?”"],
    [8, "user", "Reopened “Where should the settings live?”"],
    [9, "user", "Decided “Where should the settings live?”"],
    [10, "user", "Confirmed what we understand"],
    [11, "user", "Drafted the specification (1 task)"],
    [12, "user", "Approved the specification"],
    [13, "user", "Archived the plan"],
    [14, "user", "Restored the plan from the archive"],
  ]);
  assert.ok(f.current().history.every((entry, index) => entry.version === index + 1 && Number.isSafeInteger(entry.at) && VERSION_AUTHORS.includes(entry.by)));
  assert.deepEqual([...VERSION_AUTHORS], ["user", "assistant", "host"]);
  // Each entry still carries the plan as it was saved at that version.
  assert.equal(f.current().history[1].snapshot.title, "Project settings");
  assert.equal(f.current().history[0].snapshot.title, "Settings");
});

test("a long note is cut to one line and a model's words never become a claim in it", () => {
  const f = fixture();
  f.ok("add-unknown", { text: `${"Very long unknown ".repeat(30)}\nsecond line` });
  const note = f.current().history.at(-1).note;
  assert.ok(note.length <= 160);
  assert.doesNotMatch(note, /\n/);
  assert.ok(note.endsWith("…”") || note.endsWith("…"));
});

test("restore-version makes an old version the newest and never rewrites history", () => {
  const f = fixture();
  f.ok("update", { title: "Second title", destination: "Second destination reads differently." }); // version 2
  f.ok("add-unknown", { text: "A later unknown" }); // version 3
  const before = structuredClone(f.current().history);
  const v2 = before[1].snapshot;
  const restored = f.ok("restore-version", { toVersion: 2 });
  assert.equal(restored.version, 4, "restoring version 2 of 3 makes version 4");
  assert.equal(restored.title, v2.title);
  assert.equal(restored.destination, v2.destination);
  assert.deepEqual(restored.unknowns, v2.unknowns, "the later unknown is gone from the newest version");
  assert.equal(restored.history.length, 4);
  assert.deepEqual(restored.history.slice(0, 3), before, "the versions before it are exactly as they were");
  const last = restored.history.at(-1);
  assert.equal(last.version, 4);
  assert.equal(last.action, "restore-version");
  assert.equal(last.restoredFrom, 2);
  assert.equal(last.by, "user");
  assert.equal(last.note, "Restored version 2");
  assert.deepEqual(last.snapshot.unknowns, v2.unknowns);
  assert.equal(last.snapshot.version, 4);
  assert.equal(restored.updatedAt, last.at);
  assert.equal(restored.createdAt, before[0].snapshot.createdAt, "the plan keeps its own identity and creation time");
  assert.equal(restored.id, before[0].snapshot.id);
  // What was undone is still one click away: version 3 is in the list and can come back too.
  const again = f.ok("restore-version", { toVersion: 3 });
  assert.equal(again.version, 5);
  assert.equal(again.unknowns.length, 1);
  assert.equal(again.history.length, 5);
  assert.equal(f.ok("restore-version", { toVersion: 1 }).title, "Settings", "the very first version is restorable too");
  assert.equal(f.current().version, 6);
});

test("a restored version asks for your confirmation and approval again before any task can be made", () => {
  const f = fixture();
  f.ok("add-question", { question: "Choose storage", type: "discussion" });
  const questionId = f.current().questions[0].id;
  f.ok("resolve", { questionId, resolution: "Local JSON" });
  f.ok("confirm-understanding");
  f.ok("draft-spec", draft);
  const approved = f.ok("approve-spec");
  assert.equal(approved.status, "ready");
  const approvedVersion = approved.version;
  f.ok("update", { destination: "A different outcome that replaces the first." });
  const restored = f.ok("restore-version", { toVersion: approvedVersion });
  assert.equal(restored.destination, "Users can edit project settings without losing data.");
  assert.equal(restored.questions[0].resolution, "Local JSON", "your recorded decisions come back with their wording");
  assert.equal(restored.questions[0].status, "resolved");
  assert.equal(restored.status, "planning", "not ready: the approval belonged to the version it was given on");
  assert.equal(restored.reviewedAt, undefined);
  assert.equal(restored.spec.stale, true);
  assert.equal(restored.spec.approvedAt, undefined);
  assert.equal(restored.spec.text, draft.text, "the specification wording is back to edit and approve again");
  assert.equal(f.action("approve-spec").ok, false, "approval needs the understanding confirmed again");
  f.ok("confirm-understanding");
  f.ok("draft-spec", draft);
  assert.equal(f.ok("approve-spec").status, "ready");
});

test("only you can restore, the plan must not have moved, and the version must be one this plan has", () => {
  const f = fixture();
  f.ok("update", { title: "Second title" });
  f.ok("update", { title: "Third title" });
  const saved = structuredClone(f.plans);
  for (const actor of ["assistant", "host"]) assert.equal(f.action("restore-version", { toVersion: 1 }, actor).ok, false, actor);
  assert.match(f.action("restore-version", { toVersion: 1 }, "host").error, /Only you can restore/);
  assert.match(f.action("restore-version", { toVersion: 3 }).error, /already the current version/);
  assert.match(f.action("restore-version", { toVersion: 9 }).error, /not in this plan's history/);
  for (const toVersion of [0, -1, 1.5, "2", null, undefined, NaN]) assert.match(f.action("restore-version", { toVersion }).error, /Choose the version to restore/, String(toVersion));
  const stale = applyPlanningAction(f.plans, { action: "restore-version", planId: f.current().id, version: 1, toVersion: 1 }, { project, now: 5000 });
  assert.equal(stale.ok, false);
  assert.match(stale.error, /changed\. Refresh/);
  assert.deepEqual(f.plans, saved, "a refused restore changes nothing");
});

test("a plan that is archived, creating tasks or converted is not restored over", () => {
  const f = fixture();
  f.ok("update", { title: "Second title" });
  f.ok("archive");
  assert.match(f.action("restore-version", { toVersion: 1 }).error, /archived/);
  f.ok("restore");
  f.ok("confirm-understanding");
  f.ok("draft-spec", draft);
  f.ok("approve-spec");
  f.ok("begin-conversion", {}, "host");
  assert.match(f.action("restore-version", { toVersion: 1 }).error, /Task creation has started/);
  f.ok("mark-converted", { taskIds: f.current().taskIds }, "host");
  assert.match(f.action("restore-version", { toVersion: 1 }).error, /already created implementation tasks/);
});

test("history keeps every version: sixty edits leave sixty-one contiguous versions, all restorable", () => {
  const f = fixture();
  for (let n = 0; n < 60; n += 1) f.ok("update", { title: `Title ${n}` });
  const plan = f.current();
  assert.equal(plan.version, 61);
  assert.equal(plan.history.length, 61, "no version is dropped");
  assert.deepEqual(plan.history.map((entry) => entry.version), Array.from({ length: 61 }, (_, index) => index + 1));
  assert.ok(plan.history.every((entry) => entry.snapshot.version === entry.version && entry.note));
  assert.equal(f.ok("restore-version", { toVersion: 1 }).title, "Settings", "the first version is still there after sixty edits");
  assert.equal(f.ok("restore-version", { toVersion: 30 }).title, "Title 28");
});

test("versions saved before authors and notes existed still read, and the next edit adds both", () => {
  const f = fixture();
  f.ok("update", { title: "Second title" });
  for (const entry of f.current().history) { delete entry.by; delete entry.note; }
  const plans = structuredClone(f.plans);
  const next = applyPlanningAction(plans, { action: "update", planId: plans[0].id, version: plans[0].version, title: "Third title" }, { project, now: 9000, actor: "user" });
  assert.equal(next.ok, true, next.error);
  assert.deepEqual(next.plan.history.map((entry) => entry.by ?? null), [null, null, "user"]);
  assert.equal(next.plan.history.at(-1).note, "Renamed the plan to “Third title”");
});

test("a bad author, note or restore reference makes a plan invalid instead of being kept", async (t) => {
  const f = fixture();
  f.ok("update", { title: "Second title" });
  const write = async (mutate) => {
    const { filePath, store } = await storeFixture(t);
    const plans = structuredClone(f.plans);
    mutate(plans[0]);
    await fs.writeFile(filePath, JSON.stringify({ version: 1, projectId: project.id, plans }));
    return store.list();
  };
  await assert.rejects(write((plan) => { plan.history[1].by = "someone"; }), /author is invalid/);
  await assert.rejects(write((plan) => { plan.history[1].note = 5; }), /History note/);
  await assert.rejects(write((plan) => { plan.history[1].restoredFrom = 2; }), /restore reference is invalid/);
  await assert.rejects(write((plan) => { plan.history[1].restoredFrom = 0; }), /restore reference is invalid/);
  assert.equal((await write((plan) => { plan.history[1].restoredFrom = 1; })).length, 1, "a real reference is fine");
});

test("versions persist through the store: a restore survives a fresh read and the file stays one valid document", async (t) => {
  const { filePath, store } = await storeFixture(t);
  await store.mutate({ action: "create", title: "Settings", destination: "Users can edit settings.", outOfScope: "" });
  let [plan] = await store.list();
  await store.mutate({ action: "update", planId: plan.id, version: plan.version, destination: "Users can edit and export settings." });
  [plan] = await store.list();
  const restored = await store.mutate({ action: "restore-version", planId: plan.id, version: plan.version, toVersion: 1 });
  assert.equal(restored.ok, true, restored.error);
  const fresh = createPlanningStore({ filePath, project });
  const [saved] = await fresh.list();
  assert.equal(saved.version, 3);
  assert.equal(saved.destination, "Users can edit settings.");
  assert.deepEqual(saved.history.map((entry) => [entry.version, entry.action, entry.by]), [[1, "create", "user"], [2, "update", "user"], [3, "restore-version", "user"]]);
  assert.equal(saved.history[2].restoredFrom, 1);
  // The store's own actor: an assistant cannot restore through it either.
  const refused = await store.mutate({ action: "restore-version", planId: saved.id, version: saved.version, toVersion: 1 }, { actor: "assistant" });
  assert.equal(refused.ok, false);
});

test("the service accepts restore-version as your action and files the version under you", async (t) => {
  const { store } = await storeFixture(t);
  const service = createPlanningService({ project, store, mutateBoard: async () => ({ ok: true }), complete: async () => ({ ok: false }) });
  const created = await service.action({ projectId: project.id, action: "create", title: "Settings", destination: "Users can edit settings.", outOfScope: "" });
  const plan = created.plan;
  const edited = await service.action({ projectId: project.id, action: "update", planId: plan.id, version: plan.version, title: "Renamed" });
  const restored = await service.action({ projectId: project.id, action: "restore-version", planId: plan.id, version: edited.plan.version, toVersion: 1 });
  assert.equal(restored.ok, true, restored.error);
  assert.equal(restored.plan.title, "Settings");
  assert.equal(restored.plan.version, 3);
  assert.equal(restored.plan.history.at(-1).by, "user");
  const wrongProject = await service.action({ projectId: "other", action: "restore-version", planId: plan.id, version: 3, toVersion: 1 });
  assert.equal(wrongProject.ok, false);
});

test("a plan with no history gets its current wording as version 1, the same one every time it is read", () => {
  const plan = { id: "plan_old", projectId: project.id, title: "Old plan", destination: "An outcome written before versions.", outOfScope: "", unknowns: [], questions: [], spec: null, status: "planning", version: 7, createdAt: 500, updatedAt: 800, taskIds: [] };
  const first = withHistory(plan);
  assert.equal(first.migrated, true);
  assert.equal(first.plan.version, 1);
  assert.equal(first.plan.history.length, 1);
  const [entry] = first.plan.history;
  assert.deepEqual([entry.version, entry.at, entry.action, entry.by], [1, 800, "migrated", "host"]);
  assert.match(entry.note, /first version/);
  assert.equal(entry.snapshot.title, "Old plan");
  assert.equal(entry.snapshot.version, 1);
  assert.equal("history" in entry.snapshot, false);
  assert.deepEqual(withHistory(plan).plan, first.plan, "reading it again gives the same version");
  assert.equal(plan.version, 7, "the plan it was given is not changed");
  assert.equal("history" in plan, false);
  for (const has of [{ history: [] }, {}]) assert.equal(withHistory({ ...plan, ...has }).migrated, true);
  const withOne = { ...first.plan };
  assert.equal(withHistory(withOne).migrated, false);
  assert.equal(withHistory(withOne).plan, withOne, "a plan that has history is returned as it is");
  assert.equal(withHistory(null).migrated, false);
  assert.equal(applyPlanningAction([first.plan], { action: "update", planId: "plan_old", version: 1, title: "New" }, { project, now: 900 }).plan.version, 2);
});

test("the store migrates a history-less file when it reads it, writes nothing until an edit, then keeps one copy of the old file", async (t) => {
  const { filePath, store } = await storeFixture(t);
  const legacy = { id: "plan_old", projectId: project.id, title: "Old plan", destination: "An outcome written before versions.", outOfScope: "", unknowns: [], questions: [], spec: null, status: "planning", version: 4, createdAt: 500, updatedAt: 800, taskIds: [] };
  const untouched = { id: "plan_new", projectId: project.id, ...applyPlanningAction([], { action: "create", title: "Newer", destination: "A plan with history.", outOfScope: "" }, { project, now: 600 }).plan };
  const text = JSON.stringify({ version: 1, projectId: project.id, plans: [legacy, untouched] });
  await fs.writeFile(filePath, text);
  const [old, newer] = await store.list();
  assert.equal(old.version, 1);
  assert.deepEqual(old.history.map((entry) => [entry.version, entry.action]), [[1, "migrated"]]);
  assert.equal(old.destination, "An outcome written before versions.");
  assert.deepEqual(newer, untouched, "a plan that had history is read as it was");
  assert.equal(await fs.readFile(filePath, "utf8"), text, "reading does not rewrite the file");
  await assert.rejects(fs.stat(`${filePath}.before-versions.bak`), { code: "ENOENT" });
  const edited = await store.mutate({ action: "update", planId: "plan_old", version: 1, destination: "Now it says something else." });
  assert.equal(edited.ok, true, edited.error);
  assert.deepEqual(edited.plan.history.map((entry) => entry.version), [1, 2]);
  assert.equal(edited.plan.history[0].snapshot.destination, "An outcome written before versions.", "the old wording is version 1");
  assert.equal(edited.plan.history[1].note, "Changed the destination");
  assert.equal(await fs.readFile(`${filePath}.before-versions.bak`, "utf8"), text, "one copy of the file as it was");
  const saved = JSON.parse(await fs.readFile(filePath, "utf8"));
  assert.equal(saved.plans[0].history.length, 2);
  assert.equal(saved.plans[1].history.length, untouched.history.length);
  // Nothing needs migrating now, so the copy is never written over.
  await store.mutate({ action: "update", planId: "plan_old", version: 2, title: "Renamed later" });
  assert.equal(await fs.readFile(`${filePath}.before-versions.bak`, "utf8"), text);
  // And the migrated plan can go back to what it said before its first edit.
  const [current] = (await store.list()).filter((plan) => plan.id === "plan_old");
  const back = await store.mutate({ action: "restore-version", planId: "plan_old", version: current.version, toVersion: 1 });
  assert.equal(back.plan.destination, "An outcome written before versions.");
  // Even a second history-less file (another PC's, copied in) never replaces the first copy: one copy, ever.
  const another = JSON.stringify({ version: 1, projectId: project.id, plans: [{ ...legacy, id: "plan_other", title: "Other old plan", version: 2 }] });
  await fs.writeFile(filePath, another);
  assert.equal((await store.mutate({ action: "update", planId: "plan_other", version: 1, title: "Edited other" })).ok, true);
  assert.equal(await fs.readFile(`${filePath}.before-versions.bak`, "utf8"), text, "the first copy stands");
});

test("a copy that cannot be kept stops the first save after a migration, and a bad file is still preserved", async (t) => {
  const { filePath, store } = await storeFixture(t);
  const legacy = { id: "plan_old", projectId: project.id, title: "Old plan", destination: "An outcome.", outOfScope: "", unknowns: [], questions: [], spec: null, status: "planning", version: 1, createdAt: 500, updatedAt: 800, taskIds: [] };
  const text = JSON.stringify({ version: 1, projectId: project.id, plans: [legacy] });
  await fs.writeFile(filePath, text);
  // The disk refuses the copy (and only the copy).
  const realWrite = fs.writeFile;
  fs.writeFile = async (target, ...rest) => {
    if (String(target).endsWith(".before-versions.bak")) throw Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
    return realWrite.call(fs, target, ...rest);
  };
  let refused;
  try { refused = await store.mutate({ action: "update", planId: "plan_old", version: 1, title: "Edited" }); }
  finally { fs.writeFile = realWrite; }
  assert.equal(refused.ok, false);
  assert.match(refused.error, /Could not keep a copy/);
  assert.equal(await fs.readFile(filePath, "utf8"), text, "nothing was saved");
  await assert.rejects(fs.stat(`${filePath}.before-versions.bak`), { code: "ENOENT" });
  // With the disk back, the same edit goes through and keeps its copy.
  assert.equal((await store.mutate({ action: "update", planId: "plan_old", version: 1, title: "Edited" })).ok, true);
  assert.equal(await fs.readFile(`${filePath}.before-versions.bak`, "utf8"), text);
  // A plan that cannot be made valid keeps the file untouched, as before.
  const broken = { ...legacy, title: "", id: "plan_bad" };
  const bad = JSON.stringify({ version: 1, projectId: project.id, plans: [broken] });
  const other = await storeFixture(t);
  await fs.writeFile(other.filePath, bad);
  await assert.rejects(other.store.list(), /Invalid planning data; the existing file was preserved/);
  assert.equal(await fs.readFile(other.filePath, "utf8"), bad);
});
