import test from "node:test";
import assert from "node:assert/strict";
import chatWork from "../scripts/chat-work.cjs";

const { findExistingChatWork: find } = chatWork;
const task = (prompt, extra = {}) => ({ id: "saved", title: prompt.slice(0, 60), prompt, status: "open", ...extra });
const ask = (prompt, extra = {}) => ({ title: prompt.slice(0, 60), prompt, ...extra });

test("rephrased chat work reuses the complete existing obligation", () => {
  for (const [before, after] of [
    ["Add a search button", "Could you please create the search button?"],
    ["Fix the login button alignment", "Please repair login alignment buttons."],
    ["Remove duplicate requests", "Delete the duplicate request, please!"],
    ["Make sure task drafts persist", "Ensure the task drafts persist"],
    ["Update maximum worker count", "Change max worker count"],
  ]) {
    const saved = task(before);
    assert.deepEqual(find({ tasks: [saved] }, ask(after)), { kind: "task", item: saved }, `${before} / ${after}`);
  }
});

test("full prompts distinguish work whose display titles share a truncated prefix", () => {
  const prefix = "Add keyboard navigation for the assistant task configuration interface ";
  const saved = task(`${prefix}and preserve focus after closing dialogs.`);
  assert.equal(find({ tasks: [saved] }, ask(`${prefix}and support arrow keys in nested menus.`)), null);
  assert.equal(find({ tasks: [saved] }, ask(`${saved.prompt} Also retain scroll position.`)), null);
  assert.equal(find({ tasks: [task("Fix task drafts", { requirements: ["Retain unsent edits"] })] }, ask("Fix task drafts", { requirements: ["Retain saved edits"] })), null);
});

test("saved implementation detail does not stop a repeated complete request matching", () => {
  const saved = task("Add search button", { files: ["renderer/tasks.js"], acceptance: ["Keyboard accessible"], remaining: ["Verify focus"] });
  assert.deepEqual(find({ tasks: [saved] }, ask("Please create the search button")), { kind: "task", item: saved });
  assert.equal(find({ tasks: [saved] }, ask("Create search button", { files: ["renderer/ideas.js"] })), null);
  assert.equal(find({ tasks: [saved] }, ask("Create search button", { acceptance: ["Support voice control"] })), null);
});

test("different actions, negation, numbers, paths, and directional scope stay separate", () => {
  for (const [before, after] of [
    ["Add search button", "Remove search button"],
    ["Enable automatic task creation", "Do not enable automatic task creation"],
    ["Keep maximum workers at 3", "Keep maximum workers at 4"],
    ["Fix crash in renderer/tasks.js", "Fix crash in renderer/ideas.js"],
    ["Fix crash in renderer/Tasks.js", "Fix crash in renderer/tasks.js"],
    ["Move task from left to right", "Move task from right to left"],
    ["Allow admins to edit users", "Allow users to edit admins"],
    ["Rename file A to B", "Rename file B to A"],
    ["Rename module A to B", "Rename module to B"],
    ["Fix module A", "Fix module"],
    ["Fix login button alignment", "Fix login button keyboard alignment"],
    ["Fix login", "Fix logout"],
    ["Fix broken button", "Fix button broken"],
  ]) assert.equal(find({ tasks: [task(before)] }, ask(after)), null, `${before} / ${after}`);
});

test("known chat wrappers and focus provenance do not create another obligation", () => {
  const saved = task('Add search button\n\nThe user pointed the assistant at session "Discussion" (id: session-1) while asking for this.');
  assert.equal(find({ tasks: [saved] }, ask("Please add the search button")).item, saved);
  const wrapped = task('Work on "Add search button". Queued from the assistant chat — the user said "work on it".');
  assert.equal(find({ tasks: [wrapped] }, ask("Please add the search button")).item, wrapped);
});

test("the pinned Work on it wrapper is the label it points at, not new work", () => {
  const pinned = task('Work on "Add search button". Queued with Work on it — the user pointed at session (id: session-1).', { title: 'Work on "Add search button"' });
  assert.equal(find({ tasks: [pinned] }, ask("Please add the search button")).item, pinned);
  assert.equal(find({ tasks: [pinned] }, { title: "Add search button", resolvedTitle: "Add search button", prompt: "Add search button" }).item, pinned);
  const plain = task("Add search button");
  const incoming = ask('Work on "Add search button". Queued with Work on it — the user pointed at session (id: session-1).');
  assert.equal(find({ tasks: [plain] }, incoming).item, plain);
});

test("unfinished requests and tasks cover queued, running, held, and verifying work", () => {
  for (const status of [undefined, "open", "pending", "queued", "running", "active", "blocked", "cooling", "awaiting_verification"]) {
    for (const kind of ["task", "request"]) {
      const saved = task("Add search button", { status });
      assert.deepEqual(find({ [kind === "task" ? "tasks" : "requests"]: [saved] }, ask("Please create the search button")), { kind, item: saved });
    }
  }
  for (const status of ["done", "closed", "completed", "archived", "absorbed", "dismissed", "rejected", "cancelled"]) {
    const saved = task("Add search button", { status });
    assert.equal(find({ tasks: [saved], requests: [saved] }, ask(saved.prompt)), null);
  }
});

test("grouped obligations reuse their unfinished owning task", () => {
  const parent = task("Navigation plan", { members: [task("Toolbar work", { members: [task("Add search button", { id: "member" })] })] });
  assert.deepEqual(find({ tasks: [parent] }, ask("Please add search button")), { kind: "task", item: parent });
  assert.equal(find({ tasks: [{ ...parent, status: "done" }] }, ask("Add search button")), null);
  assert.deepEqual(find({ tasks: [parent] }, { existingTarget: { kind: "task", id: "member" } }), { kind: "task", item: parent });
});

test("live worker references survive promotion and settling process exits", () => {
  const worker = { taskId: "missing-task", ref: task("Add search button"), projectId: "one", finished: false };
  assert.deepEqual(find({ jobs: [worker] }, ask("Create search button", { projectId: "one" })), { kind: "worker", item: worker });
  assert.equal(find({ jobs: [{ ...worker, finished: true }] }, ask("Create search button")), null);
  const settling = { ...worker, finished: true, settlementPending: true };
  assert.equal(find({ jobs: [settling] }, ask("Create search button")).item, settling);
  assert.equal(find({ jobs: [worker] }, { existingTarget: { kind: "task", id: "task:missing-task" } }).item, worker);
  const saved = task("Add search button");
  assert.deepEqual(find({ tasks: [saved], jobs: [{ ...worker, taskId: saved.id }] }, { resolvedTitle: saved.title }), { kind: "task", item: saved });
  const edited = { ...saved, prompt: "Add voice search and custom shortcuts" };
  const stillRunning = { ...worker, taskId: saved.id };
  assert.deepEqual(find({ tasks: [edited], jobs: [stillRunning] }, ask("Create search button")), { kind: "worker", item: stillRunning }, "the running brief remains owned after saved task edits");
  assert.deepEqual(find({ tasks: [edited], jobs: [stillRunning] }, { resolvedTitle: saved.title }), { kind: "task", item: edited }, "the same task ID still identifies one work item");
});

test("project boundaries apply to saved work, group members, and worker references", () => {
  const incoming = ask("Add search button", { projectId: "one" });
  assert.equal(find({ tasks: [task(incoming.prompt, { projectId: "two" })] }, incoming), null);
  assert.equal(find({ requests: [task(incoming.prompt, { projectId: "two" })] }, incoming), null);
  assert.equal(find({ jobs: [{ ref: task(incoming.prompt, { projectId: "two" }) }] }, incoming), null);
  assert.equal(find({ tasks: [task("Group", { members: [task(incoming.prompt, { projectId: "two" })] })] }, incoming), null);
  assert.ok(find({ tasks: [task(incoming.prompt)] }, incoming), "legacy work without project IDs remains eligible");
});

test("resolved follow-ups reuse full identities and ordinary focus never merges scope", () => {
  const saved = task("Add search button and preserve keyboard focus after navigation", { title: "Search control", target: { kind: "session", id: "discussion" } });
  assert.equal(find({ tasks: [saved] }, { resolvedTitle: "Search control" }).item, saved);
  assert.equal(find({ tasks: [saved] }, { existingTarget: { kind: "session", id: "discussion" } }).item, saved);
  assert.equal(find({ tasks: [saved] }, ask("Add color selector", { target: { kind: "session", id: "discussion" } })), null);
  assert.equal(find({ tasks: [saved] }, { resolvedTitle: "Search" }), null, "display prefixes cannot identify work");
  const ambiguous = find({ tasks: [saved, { ...saved, id: "other", prompt: "Different requirement" }] }, { resolvedTitle: "Search control" });
  assert.equal(ambiguous.kind, "ambiguous", "ambiguous titles need an explicit identity");
  assert.equal(ambiguous.items.length, 2);
  assert.equal(find({ tasks: [{ ...saved, status: "done" }] }, { existingTarget: { kind: "task", id: saved.id } }), null);
});

test("promotion and worker copies do not make an explicit title ambiguous", () => {
  const saved = task("Add search button", { id: "task-1" });
  const request = { ...saved, id: "request-1", status: "running" };
  const worker = { taskId: saved.id, ref: request };
  const incoming = { resolvedTitle: saved.title };
  assert.deepEqual(find({ tasks: [saved], requests: [request], jobs: [worker] }, incoming), { kind: "task", item: saved });
  assert.deepEqual(find({ requests: [request], jobs: [worker] }, incoming), { kind: "worker", item: worker });
});
