import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { snapshotTask, recordTaskRevision, taskHistory, restoreTaskRevision, buildTaskHandoff } = require("../scripts/task-context.cjs");

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
