import test from "node:test";
import assert from "node:assert/strict";
import autonomy from "../scripts/autonomy.cjs";
import backlog from "../scripts/backlog.cjs";

const task = { id: "t", title: "Fix it", origin: { by: "owner" } };
const ask = (kind = "scope", extra = {}) => ({ status: "open", source: "issue", context: { issueKind: kind }, options: [{ id: "narrow" }], ...extra });

test("mode migration keeps an explicit mode, maps Verify first, and defaults each elevated category on", () => {
  assert.equal(autonomy.migrate({}).level, "auto");
  assert.equal(autonomy.migrate({ autopilot: { autoBuild: false }, agentBrain: { deskResolves: true } }).level, "ask");
  assert.equal(autonomy.migrate({ autonomy: { level: "accept" }, autopilot: { autoBuild: true } }).level, "accept");
  assert.ok(Object.values(autonomy.migrate({}).elevated).every(Boolean));
  assert.equal(autonomy.migrate({ autonomy: { elevated: { grant: false } } }).elevated.grant, false);
});

test("each mode routes worker and family questions according to task acceptance and confidence", () => {
  for (const [level, accepted, confidence, expected] of [
    ["ask", false, 1, "advise"], ["ask", true, 1, "advise"],
    ["accept", false, 1, "owner"], ["accept", true, 0.4, "mefi"],
    ["auto", false, 0.9, "mefi"], ["auto", false, 0.69, "advise"],
    ["elevated", false, 0.9, "mefi"], ["elevated", false, 0.1, "mefi-safe"],
  ]) assert.equal(autonomy.route({ level, accepted, confidence, item: ask(), task }), expected, `${level}/${accepted}/${confidence}`);
  assert.equal(autonomy.route({ level: "accept", accepted: true, item: ask(null, { source: "family" }), task }), "owner");
  assert.equal(autonomy.route({ level: "accept", accepted: true, item: { kind: "review", sessionless: true }, task }), "owner");
});

test("each elevated switch works independently, including a heavier retry on an ordinary check question", () => {
  for (const [kind, id] of [["permission", "grant"], ["risk", "risk"], ["capability", "pricier-model"], ["owner", "real-world"]]) {
    assert.equal(autonomy.route({ level: "elevated", item: ask(kind), task }), "owner");
    assert.equal(autonomy.route({ level: "elevated", item: ask(kind), task, elevated: { [id]: false } }), "mefi");
  }
  assert.equal(autonomy.route({ item: ask("check-failed"), task, option: { id: "retry-deep" } }), "owner");
  assert.equal(autonomy.classify({ task, action: { kind: "drop" } }), "drop-owned");
  assert.equal(autonomy.needsApproval({ ...task, origin: { by: "thinker" } }), true);
  assert.equal(autonomy.needsApproval({ ...task, origin: { by: "thinker" } }, { elevated: { "agent-filed": false } }), false);
});

test("owner holds, desk escalations, undone decisions and unaffirmed chat confirmations cannot be delegated", () => {
  assert.equal(autonomy.route({ item: ask(), task: { ...task, ownerHold: { at: 1 } } }), "owner");
  assert.equal(autonomy.route({ item: ask(null, { context: { raisedBy: "desk" } }), task }), "owner");
  assert.equal(autonomy.route({ item: ask(null, { context: { undoneFrom: "d1" } }), task }), "owner");
  assert.equal(autonomy.canDelegate(ask(null, { source: "chat" })), false);
  assert.equal(autonomy.canDelegate(ask(null, { source: "chat" }), { affirmed: true }), true);
});

test("scope-bound approval passes to actual splits and delegation children, without crossing projects or generic handoffs", () => {
  const parent = { ...task, projectId: "p", delegation: { childTaskIds: ["child"] } };
  parent.buildApproval = { version: 1, scope: backlog.buildScope(parent), approvedAt: 1 };
  const child = { id: "child", parentTaskId: "t", projectId: "p", origin: { by: "worker" } };
  for (const level of autonomy.LEVELS) {
    assert.equal(autonomy.needsApproval(child, { level, tasks: [parent] }), false, level);
    assert.equal(autonomy.needsApproval({ ...child, id: "split", splitFrom: "t" }, { level, tasks: [parent] }), false, level);
  }
  assert.equal(autonomy.accepted({ ...child, projectId: "q" }, { tasks: [parent] }), false);
  assert.equal(autonomy.accepted({ ...child, id: "handoff" }, { tasks: [parent] }), false);
  assert.equal(autonomy.accepted(child, { tasks: [{ ...parent, prompt: "new scope" }] }), false);
  assert.equal(autonomy.needsApproval(task, { level: "accept" }), true);
  assert.equal(autonomy.needsApproval(task, { level: "auto" }), false);
});

test("strong learned disagreement leaves Auto to the owner, and map overlays retain non-auto rules", () => {
  assert.equal(autonomy.route({ item: ask(), task, confidence: 0.95, option: { id: "split" }, learned: { verb: "narrow", share: 0.8, n: 9 } }), "advise");
  assert.deepEqual(autonomy.issueOverlay("ask", { triage: true, asks: true, splitDepth: 2 }).auto, []);
  assert.deepEqual(autonomy.issueOverlay("accept", {}, { accepted: false }).auto, []);
  const policy = autonomy.issueOverlay("accept", { expires: 42, splitDepth: 2 }, { accepted: true });
  assert.deepEqual(policy.auto, autonomy.RETRY_KINDS);
  assert.equal(policy.expires, 42);
  assert.equal(policy.splitDepth, 2);
});


test("sessionless confirmation needs exact-attempt named runner checks and no unfinished work", () => {
  const task = { verification: { state: "failed", reason: "codex runs leave no session the verifier can read" }, lastAttempt: { route: "codex", runId: "run1", code: 0, result: { parts: { remaining: "none", checks: "npm test passed" } } }, verificationRun: { key: "verify:run1", results: [{ command: "npm test", exitCode: 0, ok: true }] } };
  assert.equal(autonomy.sessionless(task).canConfirm, true);
  for (const patch of [{ verificationRun: null }, { verificationRun: { ...task.verificationRun, key: "verify:other" } }, { remaining: ["still owed"] }, { lastAttempt: { ...task.lastAttempt, code: 1 } }]) assert.equal(autonomy.sessionless({ ...task, ...patch }).canConfirm, false);
  for (const patch of [{ exitCode: 1 }, { timedOut: true }, { relocated: true }, { unavailable: true }, { command: "" }]) assert.equal(autonomy.sessionless({ ...task, verificationRun: { ...task.verificationRun, results: [{ ...task.verificationRun.results[0], ...patch }] } }).canConfirm, false);
});
