import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url);
const { snapshotTask, recordTaskRevision, taskHistory, restoreTaskRevision, buildTaskHandoff, resolveStaleFileScope } = require("../scripts/task-context.cjs");

const original = { id: "task-one", title: "Build workspace", prompt: "Preserve every requirement. ".repeat(600), status: "open", projectId: "project-a", projectPath: "C:/project-a", dependsOn: ["task-before"], refs: [{ kind: "file", detail: "src/board.js" }], logs: [{ at: 1, text: "Initial work" }], createdAt: 1, updatedAt: 1 };

test("first mutation captures the full legacy baseline and keeps revision evidence immutable", () => {
  const before = structuredClone(original);
  const updated = recordTaskRevision({ ...original, prompt: "Revised brief", lastAttempt: { runId: "r1", result: { parts: { done: "picker", remaining: "tests" } } } }, { previous: original, kind: "edited", now: 10 });
  const { entries } = taskHistory(updated);
  assert.equal(entries.length, 2);
  assert.equal(entries[1].snapshot.prompt, original.prompt);
  assert.deepEqual(entries[1].snapshot.refs, original.refs);
  assert.deepEqual(entries[0].snapshot.lastAttempt.result.parts, { done: "picker", remaining: "tests" });
  updated.refs[0].detail = "changed outside history";
  assert.equal(entries[1].snapshot.refs[0].detail, "src/board.js");
  assert.deepEqual(original, before, "the helper does not mutate its input");
});

test("heartbeat-only changes do not flood history and stale clients cannot remove saved revisions", () => {
  const saved = recordTaskRevision(original, { kind: "created", now: 2 });
  const touched = recordTaskRevision({ ...saved, updatedAt: 200 }, { previous: saved, now: 200 });
  assert.equal(taskHistory(touched).entries.length, 1);
  assert.equal(touched.contextHistory, saved.contextHistory, "no-op updates reuse immutable saved history");
  const newer = recordTaskRevision({ ...saved, prompt: "New brief" }, { previous: saved, now: 3 });
  const stale = recordTaskRevision({ ...original, prompt: "Edited in another panel" }, { previous: newer, now: 4 });
  assert.equal(taskHistory(stale).entries.length, 3);
  assert.equal(taskHistory(stale).entries[1].snapshot.prompt, "New brief");
});

test("run claims and releases record no revision while a brief change still does", () => {
  const saved = recordTaskRevision(original, { now: 1 });
  const claimed = recordTaskRevision({ ...saved, status: "active", runId: "run-1" }, { previous: saved, now: 2 });
  assert.equal(claimed.contextHistory, saved.contextHistory, "a claim is not a brief change");
  const { runId: _claim, ...unclaimed } = claimed;
  const released = recordTaskRevision({ ...unclaimed, status: "open" }, { previous: claimed, now: 3 });
  assert.equal(released.contextHistory, saved.contextHistory, "a release is not a brief change");
  assert.equal(snapshotTask(claimed).status, undefined);
  assert.equal(snapshotTask(claimed).runId, undefined);
  const edited = recordTaskRevision({ ...released, prompt: "Brief changed after the release" }, { previous: released, now: 4 });
  assert.equal(taskHistory(edited).entries.length, 2);
  assert.equal(taskHistory(edited).entries[0].snapshot.prompt, "Brief changed after the release");
});

test("a legacy latest snapshot that still carries status/runId gains no catch-up revision", () => {
  // Hashed the way the older FIELDS list did: status and runId were snapshotted.
  const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
  const legacySnapshot = { ...snapshotTask(original), status: "active", runId: "old-run" };
  const hash = createHash("sha256").update(JSON.stringify(canonical(legacySnapshot))).digest("hex");
  const legacy = { ...original, status: "active", runId: "old-run", contextHistory: { version: 1, entries: [{ id: `revision_1_${hash.slice(0, 16)}`, revision: 1, at: 1, kind: "updated", note: "", hash, snapshot: legacySnapshot }] } };
  // An unrelated no-op mutation on the upgraded board: the claim is released.
  const { runId: _run, ...unclaimed } = legacy;
  const released = recordTaskRevision({ ...unclaimed, status: "open", updatedAt: 5 }, { previous: legacy, now: 5 });
  assert.equal(released.contextHistory, legacy.contextHistory, "no catch-up revision on the first mutation after the upgrade");
  const edited = recordTaskRevision({ ...released, prompt: "Upgraded brief" }, { previous: released, now: 6 });
  const { entries } = taskHistory(edited);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].snapshot.prompt, "Upgraded brief");
  assert.equal(entries[0].snapshot.status, undefined);
  assert.equal(entries[1].snapshot.runId, "old-run", "saved legacy entries are never rewritten");
  // A card absorbed before the upgrade: the old list never recorded
  // absorbedInto, so that field alone must not read as a change either.
  const absorbedSnapshot = { ...snapshotTask(original), status: "absorbed" };
  const absorbedHash = createHash("sha256").update(JSON.stringify(canonical(absorbedSnapshot))).digest("hex");
  const absorbed = { ...original, status: "absorbed", absorbedInto: "plan_1", contextHistory: { version: 1, entries: [{ id: `revision_1_${absorbedHash.slice(0, 16)}`, revision: 1, at: 1, kind: "grouped", note: "", hash: absorbedHash, snapshot: absorbedSnapshot }] } };
  const touched = recordTaskRevision({ ...absorbed, updatedAt: 7 }, { previous: absorbed, kind: "renamed", now: 7 });
  assert.equal(touched.contextHistory, absorbed.contextHistory, "an absorbed legacy card gains no catch-up revision");
});

test("interrupted progress is retained in task history while streaming checkpoints do not flood revisions", () => {
  const saved = recordTaskRevision(original, { now: 1 });
  const streaming = recordTaskRevision({ ...saved, runProgress: { progress: .5, outputTail: ["Edits saved"] } }, { previous: saved, now: 2 });
  assert.equal(streaming.contextHistory, saved.contextHistory);
  const interruptedAttempt = { runId: "lost-run", progress: .5, todos: [{ content: "Run checks", status: "pending" }] };
  const resumed = recordTaskRevision({ ...streaming, interruptedAttempt }, { previous: streaming, now: 3 });
  assert.deepEqual(taskHistory(resumed).entries[0].snapshot.interruptedAttempt, interruptedAttempt);
  assert.match(buildTaskHandoff({ ...resumed, prompt: "Finish the integration" }), /Interrupted attempt — saved progress, not completion evidence/);
});

test("recording a change shares old immutable entries without serializing their saved bodies", () => {
  const saved = recordTaskRevision(original, { now: 1 });
  const oldEntry = saved.contextHistory.entries[0];
  Object.defineProperty(oldEntry.snapshot, "historicalSentinel", { enumerable: true, get() { throw new Error("old snapshot was copied"); } });
  const changed = recordTaskRevision({ ...saved, prompt: "Next brief" }, { previous: saved, now: 2 });
  assert.equal(changed.contextHistory.entries[0], oldEntry);
  assert.equal(changed.contextHistory.entries.length, 2);
  assert.equal(changed.contextHistory.entries[1].snapshot.prompt, "Next brief");
});

test("bounded history pages retain access to every earlier saved revision", () => {
  let task = recordTaskRevision(original, { now: 1 });
  for (let index = 0; index < 120; index += 1) task = recordTaskRevision({ ...task, prompt: `Brief ${index}` }, { previous: task, now: index + 2 });
  const page = taskHistory(task, { limit: 30 });
  assert.equal(page.entries.length, 30);
  assert.equal(page.hasMore, true);
  const second = taskHistory(task, { limit: 100, before: page.nextBefore });
  assert.equal(second.entries.length, 91);
  assert.equal(second.entries.at(-1).snapshot.prompt, original.prompt);
  assert.equal(second.hasMore, false);
});

test("restoring a brief appends a revision while preserving current execution evidence and identity", () => {
  const first = recordTaskRevision(original, { now: 2 });
  const completed = recordTaskRevision({ ...first, title: "New title", prompt: "New brief", dependsOn: [], status: "done", doneAt: 8, lastAttempt: { runId: "latest", result: { parts: { done: "Finished" } } }, verification: { state: "verified" } }, { previous: first, now: 8 });
  const baseline = taskHistory(first).entries[0];
  const result = restoreTaskRevision(completed, baseline.id, { now: 10 });
  assert.equal(result.ok, true);
  assert.equal(result.task.prompt, original.prompt);
  assert.equal(result.task.status, "done");
  assert.equal(result.task.lastAttempt.runId, "latest");
  assert.equal(result.task.verification.state, "verified");
  assert.equal(result.task.projectId, original.projectId);
  assert.deepEqual(result.task.dependsOn, ["task-before"]);
  assert.equal(taskHistory(result.task).entries[0].kind, "restored");
  const persisted = recordTaskRevision(result.task, { previous: completed, now: 10 });
  assert.equal(taskHistory(persisted).entries.length, 3);
  assert.equal(taskHistory(persisted).entries[0].kind, "restored");
  assert.equal(taskHistory(persisted).entries[1].snapshot.prompt, "New brief");
});

test("restoration refuses live attempts, verification, missing revisions and foreign task history", () => {
  const task = recordTaskRevision(original);
  const id = taskHistory(task).entries[0].id;
  for (const state of [{ status: "active" }, { status: "awaiting_verification" }, { runId: "run" }]) assert.equal(restoreTaskRevision({ ...task, ...state }, id).ok, false);
  assert.equal(restoreTaskRevision(task, "gone").ok, false);
  assert.equal(restoreTaskRevision({ ...task, id: "other" }, id).ok, false);
});

test("handoffs carry requirements, attempt findings, blockers, references and dependency outputs", () => {
  const task = { ...original, prompt: "Make the picker searchable", remaining: ["keyboard tests"], lastRunError: "test timeout", lastAttempt: { runId: "run-1", result: { parts: { done: "picker added", remaining: "keyboard tests", ran: "node tests" } } }, notes: "Keep the custom accent", context: "Use the project index", handoff: "Start with failing tests" };
  const prior = { id: "task-before", title: "Project index", status: "done", lastAttempt: { result: { parts: { done: "Index at src/projects.js" } } }, verification: { state: "verified" } };
  const prompt = buildTaskHandoff(task, { tasks: [prior] });
  for (const piece of ["Make the picker searchable", "keyboard tests", "test timeout", "picker added", "node tests", "src/board.js", "Index at src/projects.js", "Keep the custom accent", "Start with failing tests"]) assert.ok(prompt.includes(piece), piece);
  assert.ok(buildTaskHandoff(task).includes("Required task is unavailable"));
});

test("model-facing excerpts are bounded and disclosed while saved context stays complete", () => {
  const task = recordTaskRevision(original);
  const prompt = buildTaskHandoff(task, { maxChars: 1400 });
  assert.ok(prompt.length <= 1400);
  assert.match(prompt, /Excerpt; full saved context remains/);
  assert.equal(taskHistory(task).entries[0].snapshot.prompt, original.prompt);
  assert.equal(snapshotTask(task).contextHistory, undefined, "snapshots cannot recursively embed history");
  const workerPrompt = buildTaskHandoff(task, { maxChars: 2400, contextPath: "C:/studio/data/tasks.json" });
  assert.ok(workerPrompt.includes("C:/studio/data/tasks.json"));
  assert.ok(workerPrompt.includes("select task ID task-one"));
  assert.ok(buildTaskHandoff(task, { maxChars: 240 }).length <= 240, "the final executor budget is honored even when small");
});

test("stale file scope re-anchors to an existing basename while unresolvable entries stay saved", () => {
  const moved = { ...original, file: "C:/old-checkout/tools/test_mefi_studio_eyes.py", files: ["C:/old-checkout/tools/test_mefi_studio_eyes.py", "C:/project-a/src/board.js"] };
  const exists = (candidate) => candidate === "C:/project-a/src/board.js" || candidate === "C:/project-a/tools/test_mefi_studio_eyes.py";
  const locate = (base, task) => task?.projectPath ? `${task.projectPath}/tools/${base}` : null;
  const healed = resolveStaleFileScope(moved, { exists, locate });
  assert.equal(healed.changed, true);
  assert.deepEqual(healed.files, ["C:/project-a/tools/test_mefi_studio_eyes.py", "C:/project-a/src/board.js"]);
  assert.equal(healed.file, "C:/project-a/tools/test_mefi_studio_eyes.py");
  assert.deepEqual(healed.healed, [{ from: "C:/old-checkout/tools/test_mefi_studio_eyes.py", to: "C:/project-a/tools/test_mefi_studio_eyes.py" }]);
  assert.deepEqual(healed.missing, []);
  // The saved task row is never mutated by the resolver — the caller persists.
  assert.equal(moved.file, "C:/old-checkout/tools/test_mefi_studio_eyes.py");
  // Without a working locator (or with no filesystem checker at all) the saved
  // scope is kept as-is and reported, never dropped.
  const stranded = resolveStaleFileScope({ ...moved, files: ["C:/gone/elsewhere.lua"], file: "C:/gone/elsewhere.lua" }, { exists, locate: () => null });
  assert.equal(stranded.changed, false);
  assert.deepEqual(stranded.missing, ["C:/gone/elsewhere.lua"]);
  assert.equal(stranded.file, "C:/gone/elsewhere.lua");
  const trusted = resolveStaleFileScope(moved);
  assert.equal(trusted.changed, false);
  assert.deepEqual(trusted.files, moved.files);
  assert.equal(resolveStaleFileScope({ ...original }).changed, false, "a task with no file scope is untouched");
});

test("a split card's handoff carries the card it was split from, as context only", () => {
  const parent = { id: "task_parent01", title: "Add the retry banner", prompt: "Show a retry banner when a run fails, with the error and a Try again button.", decisions: [{ at: 1, kind: "scope", choice: "split", text: "the store is its own card" }], remaining: ["the store writer"], lastAttempt: { result: "banner done; store not written" } };
  const split = { id: "task_split01", title: "Follow-up: Add the retry banner", prompt: "the store has to be written too", splitFrom: "task_parent01", splitDepth: 1 };
  const handoff = buildTaskHandoff(split, { tasks: [parent, split] });
  assert.match(handoff, /Split from "Add the retry banner" \(task_parent01\) — context only, build this card's brief/);
  assert.match(handoff, /Show a retry banner when a run fails/);
  assert.match(handoff, /the store is its own card/);
  assert.match(handoff, /banner done; store not written/);
  assert.ok(handoff.indexOf("the store has to be written too") < handoff.indexOf("Split from"), "the card's own brief comes first");
  assert.match(buildTaskHandoff(split, { tasks: [split] }), /no longer on the board; do not assume its scope/);
  assert.doesNotMatch(buildTaskHandoff({ ...split, splitFrom: undefined }, { tasks: [parent] }), /Split from/);
});
