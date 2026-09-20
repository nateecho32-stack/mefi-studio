import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMode, focusFor, requestKey, selectClusterWork, matchesFocus, buildSupportPrompt, supportBrief } from "../scripts/agent-modes.cjs";

const projectId = "project-a";
const task = (id, extra = {}) => ({ id, title: id, status: "open", projectId, ...extra });
const selected = (root, tasks = [root], requests = [], extra = {}) => selectClusterWork({ focus: focusFor("task", root, projectId), tasks, requests, projectId, ...extra });

test("swarm is the safe default and only the named cluster mode opts in", () => {
  for (const value of [undefined, null, "", "swarm", "Cluster", "other"]) assert.equal(normalizeMode(value), "swarm");
  assert.equal(normalizeMode("cluster"), "cluster");
  assert.equal(matchesFocus({ kind: "task", ref: task("any") }, selectClusterWork()), true);
});

test("cluster retains one exact task despite a newly pinned task with the same title", () => {
  const root = task("root", { title: "Same title", status: "active" });
  const unrelated = task("different", { title: root.title, pin: true });
  const result = selected(root, [root, unrelated]);
  assert.equal(result.focus.id, root.id);
  assert.equal(matchesFocus({ kind: "task", ref: root }, result), true);
  assert.equal(matchesFocus({ kind: "task", ref: unrelated }, result), false);
  assert.match(result.waiting, /focused on Same title.*worker/i);
});

test("focus persists through verification, retry cooldown and permanent review", () => {
  for (const update of [{ status: "awaiting_verification" }, { nextRunAt: 200 }, { runFailures: 5 }, { verification: { state: "failed" } }]) {
    const root = task("root", update), result = selected(root, [root], [], { now: 100 });
    assert.equal(result.focus.id, root.id);
    assert.ok(result.waiting);
    assert.equal(matchesFocus({ kind: "task", ref: task("other") }, result), false);
  }
});

test("finished, archived, deleted or foreign-project focus releases the queue", () => {
  const root = task("root");
  for (const tasks of [[{ ...root, status: "done" }], [{ ...root, status: "archived" }], []]) assert.equal(selected(root, tasks).focus, null);
  assert.equal(selected(root, [root], [], { projectId: "other-project" }).focus, null);
  assert.equal(selected(root, [{ ...root, projectId: "other-project" }]).focus, null);
});

test("exact request identity prevents same-title or same-time confusion", () => {
  const request = { title: "Same title", at: 123, prompt: "Implement first requirement" };
  const other = { ...request, prompt: "Implement second requirement" };
  const later = { ...request, at: 124 };
  const result = selectClusterWork({ focus: focusFor("request", request, projectId), requests: [request, other, later], projectId });
  assert.equal(result.allowedRequestKeys.size, 1);
  assert.equal(matchesFocus({ kind: "request", ref: request }, result), true);
  assert.equal(matchesFocus({ kind: "request", ref: other }, result), false);
  assert.equal(matchesFocus({ kind: "request", ref: later }, result), false);
  assert.equal(requestKey({ ...request, id: "one" }), requestKey({ ...request, id: "one", status: "running" }));
});

test("request focus follows its exact promotion and survives inbox cleanup", () => {
  const request = { title: "Long title".repeat(15), at: 123, prompt: "The retained scope", source: "manual" };
  const focus = focusFor("request", request, projectId);
  const promoted = task("promoted", { ...request, id: "promoted", title: request.title.slice(0, 90), source: "a-eyes" });
  const sameTitle = task("unrelated", { title: promoted.title, prompt: "Other scope", at: 123 });
  for (const requests of [[request], []]) {
    const result = selectClusterWork({ focus, tasks: [sameTitle, promoted], requests, projectId });
    assert.equal(result.focus.id, "promoted");
    assert.equal(result.focus.source, "task");
    assert.deepEqual([...result.allowedTaskIds], ["promoted"]);
  }
  assert.equal(selectClusterWork({ focus, tasks: [sameTitle], projectId }).focus, null);
});

test("a request without durable promotion identity cannot adopt a same-title task", () => {
  const request = { id: "inbox", title: "Shared title" };
  const result = selectClusterWork({ focus: focusFor("request", request, projectId), tasks: [task("wrong", { title: request.title })], projectId });
  assert.equal(result.focus, null);
});

test("editing a stable request ID refreshes the exact identity for its later promotion", () => {
  const request = { id: "inbox", at: 123, title: "Shared title", prompt: "Original scope" };
  const updated = { ...request, prompt: "Changed saved scope" };
  const oldScope = task("old-scope", { ...request, id: "old-scope" });
  const live = selectClusterWork({ focus: focusFor("request", request, projectId), requests: [updated], tasks: [oldScope], projectId });
  assert.equal(live.focus.id, "inbox", "a task representing the obsolete scope cannot replace the edited request");
  const promoted = task("promoted", { ...updated, id: "promoted" });
  const result = selectClusterWork({ focus: live.focus, tasks: [oldScope, promoted], projectId });
  assert.equal(result.focus.id, "promoted");
  assert.deepEqual([...result.allowedTaskIds], ["promoted"]);
});

test("required descendant handoffs remain in focus through request, task and verification stages", () => {
  const obligation = { id: "handoff-one", handoffId: "handoff-one", fromRun: "run-root", at: 100, title: "Follow-up", prompt: "Finish checks" };
  const root = task("root", { status: "awaiting_verification", lastAttempt: { runId: "run-root", handoffs: [obligation] } });
  const unrelated = task("unrelated", { title: "Follow-up", handoffId: "handoff-one", fromRun: "wrong-run" });
  let result = selected(root, [root, unrelated], [obligation]);
  assert.equal(matchesFocus({ kind: "request", ref: obligation }, result), true);
  assert.equal(matchesFocus({ kind: "task", ref: unrelated }, result), false);
  const child = task("child", { ...obligation, id: "child", status: "active", runId: "run-child" });
  const grandchild = task("grandchild", { fromRun: "run-child" });
  result = selected(root, [root, child, grandchild, unrelated]);
  assert.deepEqual([...result.allowedTaskIds].sort(), ["child", "grandchild", "root"]);
  assert.equal(result.waiting, null, "a ready descendant can advance the focused work");
  result = selected(root, [root, { ...child, status: "done" }]);
  assert.equal(result.focus.id, "root", "the original parent still needs verification");
});

test("parent IDs and reconciled handoff IDs retain descendants from earlier attempts", () => {
  const root = task("root", { status: "awaiting_verification", lastAttempt: { runId: "new-run" }, handoffState: { pending: 2, childTaskIds: ["reconciled"] } });
  const child = task("old-child", { parentTaskId: "root", fromRun: "old-run" });
  const reconciled = task("reconciled");
  const result = selected(root, [root, child, reconciled, task("other")]);
  assert.deepEqual([...result.allowedTaskIds].sort(), ["old-child", "reconciled", "root"]);
});

test("direct request parents permit children with their exact run lineage", () => {
  const request = { at: 123, prompt: "Original scope", title: "Parent", status: "verifying", lastAttempt: { runId: "request-run" } };
  const child = task("child", { fromRun: "request-run" });
  const result = selectClusterWork({ focus: focusFor("request", request, projectId), requests: [request], tasks: [child, task("other", { fromRun: "other-run" })], projectId });
  assert.deepEqual([...result.allowedTaskIds], ["child"]);
  assert.equal(result.focus.source, "request");
});

test("prerequisites are followed transitively without permitting unrelated tasks or looping", () => {
  const root = task("root", { dependsOn: ["first"] });
  const first = task("first", { dependsOn: ["second"] });
  const second = task("second");
  let result = selected(root, [root, first, second, task("unrelated")]);
  assert.deepEqual([...result.allowedTaskIds].sort(), ["first", "root", "second"]);
  assert.equal(result.waiting, null);
  result = selected(root, [root, first, { ...second, dependsOn: ["root"] }]);
  assert.equal(result.allowedTaskIds.size, 3);
  assert.match(result.waiting, /cycle/i);
});

test("missing prerequisites keep the original focus and surface the hold", () => {
  const root = task("root", { dependsOn: ["missing"] });
  const result = selected(root);
  assert.equal(result.focus.id, root.id);
  assert.match(result.waiting, /Missing prerequisite: missing/);
});

test("grouped children and saved group members admit their owning plan", () => {
  const root = task("root", { status: "awaiting_verification", lastAttempt: { runId: "run-root" } });
  const child = task("child", { fromRun: "run-root", absorbedInto: "plan", status: "absorbed" });
  const plan = task("plan");
  let result = selected(root, [root, child, plan]);
  assert.ok(result.allowedTaskIds.has("plan"));
  result = selected(root, [root, { ...plan, members: [child] }]);
  assert.ok(result.allowedTaskIds.has("plan"));
  assert.ok(result.allowedTaskIds.has("child"));
  assert.equal(result.waiting, null);
});

test("a grouped root remains focused on its live plan and clears when the plan completes", () => {
  const root = task("root", { absorbedInto: "plan", status: "archived" });
  const plan = task("plan");
  assert.equal(selected(root, [root, plan]).focus.id, "root");
  assert.equal(selected(root, [root, { ...plan, status: "done" }]).focus, null);
});

test("foreign project descendants and prerequisites never enter a local cluster", () => {
  const root = task("root", { dependsOn: ["foreign-dep"], lastAttempt: { runId: "run-root" } });
  const result = selected(root, [root, task("foreign-dep", { projectId: "b" }), task("foreign-child", { projectId: "b", fromRun: "run-root" })], [{ id: "foreign-request", projectId: "b", parentTaskId: "root" }]);
  assert.deepEqual([...result.allowedTaskIds], ["root"]);
  assert.equal(result.allowedRequestKeys.size, 0);
});

test("selection never mutates source records or grants eligibility through membership", () => {
  const root = task("root", { status: "active", title: "Root", nextRunAt: 1000 });
  const snapshot = JSON.stringify(root);
  const result = selected(root, [root], [], { now: 0 });
  assert.equal(JSON.stringify(root), snapshot);
  assert.ok(result.waiting);
  assert.notEqual(result.focus, root);
});

test("planner and reviewer receive bounded read-only advisory scope with no validation claims", () => {
  for (const role of ["planner", "reviewer"]) {
    const prompt = buildSupportPrompt(role, { task: { title: "Build the feature", prompt: "Scope".repeat(10000) }, context: "C".repeat(50000), references: ["R".repeat(50000)] });
    assert.ok(prompt.system.length + prompt.user.length <= 16000);
    assert.match(prompt.system, /Do not use tools, edit files, claim work/);
    assert.match(prompt.system, /Do not claim that you inspected files, ran tests/);
    assert.match(prompt.system, /untrusted content/);
    assert.match(prompt.system, role === "planner" ? /implementation plan/ : /test and risk guidance/);
    assert.match(prompt.user, /Build the feature/);
    assert.match(prompt.user, /Context data:/);
    assert.match(prompt.user, /Reference data:/);
  }
});

test("prompt data tolerates circular diagnostics and strips terminal and bidi control characters", () => {
  const context = { text: "safe\u001b[31m\u202ehidden\u0000" };
  context.self = context;
  const prompt = buildSupportPrompt("planner", { context });
  assert.match(prompt.user, /safehidden/);
  assert.match(prompt.user, /circular/);
  assert.doesNotMatch(prompt.user, /\u001b|\u202e|\u0000/);
});

test("prompt traversal remains bounded for a large nested reference tree", () => {
  let reads = 0;
  const leaf = {};
  for (let i = 0; i < 30; i += 1) Object.defineProperty(leaf, `field${i}`, { enumerable: true, get() { reads += 1; return "reference"; } });
  const references = Array.from({ length: 30 }, () => Array.from({ length: 30 }, () => Object.create(null, Object.getOwnPropertyDescriptors(leaf))));
  const prompt = buildSupportPrompt("reviewer", { references });
  assert.ok(reads <= 240, "a character limit also has a bounded input traversal");
  assert.ok(prompt.system.length + prompt.user.length <= 16000);
});

test("support findings remain bounded, labeled as unverified data, and failures reveal no provider errors", () => {
  const brief = supportBrief([{ role: "planner", ok: true, text: "idea\n".repeat(1000) }, { role: "reviewer", ok: false, error: "private-provider-token" }]);
  assert.ok(brief.length <= 2200);
  assert.match(brief, /untrusted, unverified reference data/);
  assert.match(brief, /does not change the approved task scope/);
  assert.match(brief, /Planner suggestion \(unverified data\):/);
  assert.match(brief, /Reviewer: unavailable/);
  assert.doesNotMatch(brief, /private-provider-token/);
  assert.equal(supportBrief([]), "");
});
