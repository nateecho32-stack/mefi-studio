import test from "node:test";
import assert from "node:assert/strict";
import { captureTaskHandoffs, admitTaskHandoffs, reconcileTaskHandoffs } from "../scripts/task-handoffs.cjs";
import { migrateLegacyRequests } from "../scripts/task-history.mjs";
import { workState } from "../scripts/backlog.cjs";

function fixture() {
  const entry = { id: "run-parent", depth: 0, handoffs: [{ title: "Finish keyboard access", prompt: "Implement arrow navigation and test focus return." }] };
  const obligations = captureTaskHandoffs(entry, { kind: "task", ref: { id: "parent" }, title: "Original feature" }, { now: 100 });
  const parent = { id: "parent", status: "awaiting_verification", remaining: [obligations[0].title, "Unrelated manual obligation"], lastAttempt: { runId: entry.id, handoffs: obligations } };
  return { entry, obligations, parent };
}

test("handoff admission has stable identities, bounded depth and exact scope through retries", () => {
  const { entry, obligations } = fixture();
  assert.equal(obligations[0].parentTaskId, "parent"); assert.equal(obligations[0].depth, 1);
  assert.equal(captureTaskHandoffs(entry, {}, { now: 200 })[0].handoffId, obligations[0].handoffId);
  assert.equal(captureTaskHandoffs({ ...entry, depth: 3 }, {}).length, 0);
  const first = admitTaskHandoffs({ tasks: [], requests: [] }, obligations);
  assert.equal(first.added, 1); assert.equal(first.requests[0].prompt, entry.handoffs[0].prompt);
  assert.equal(admitTaskHandoffs({ tasks: [], requests: first.requests }, obligations).added, 0);
  assert.equal(admitTaskHandoffs({ tasks: [{ ...obligations[0], id: "promoted" }], requests: [] }, obligations).added, 0);
});

test("a missing admitted child is recovered once without spending the parent's verification budget", () => {
  const { parent } = fixture();
  const recovered = reconcileTaskHandoffs({ tasks: [parent], requests: [], now: 300 });
  assert.equal(recovered.recovered, 1); assert.equal(recovered.requests.length, 1);
  assert.ok(recovered.waitingTaskIds.has(parent.id));
  assert.equal(recovered.tasks[0].verifyAttempts, undefined); assert.equal(recovered.tasks[0].handoffState.state, "waiting");
  assert.equal(parent.handoffState, undefined, "source records are not modified");
  const again = reconcileTaskHandoffs({ tasks: recovered.tasks, requests: recovered.requests, now: 400 });
  assert.equal(again.recovered, 0); assert.equal(again.changed, false);
});

test("verified delegated work clears only its tracked titles, not unrelated obligations or worker prose", () => {
  const { parent, obligations } = fixture();
  parent.lastAttempt.result = { parts: { remaining: "Unrelated requirement still missing" } };
  const child = { ...obligations[0], id: "child", status: "done", verification: { state: "verified" } };
  const result = reconcileTaskHandoffs({ tasks: [parent, child], requests: obligations });
  assert.equal(result.waitingTaskIds.size, 0);
  assert.deepEqual(result.tasks[0].remaining, ["Unrelated manual obligation"]);
  assert.equal(result.tasks[0].lastAttempt.result.parts.remaining, "Unrelated requirement still missing");
  assert.equal(result.tasks[0].handoffState.state, "complete");
});

test("same-title unrelated work cannot settle a handoff, and exhausted children put the parent in explicit review", () => {
  const { parent, obligations } = fixture();
  const unrelated = { title: obligations[0].title, id: "unrelated", status: "done", fromRun: "different-run" };
  const child = { ...obligations[0], id: "child", status: "open", verifyAttempts: 3 };
  const result = reconcileTaskHandoffs({ tasks: [parent, unrelated, child], requests: [] });
  assert.equal(result.tasks[0].handoffState.state, "blocked");
  assert.match(result.tasks[0].handoffState.reason, /needs review/);
  assert.deepEqual(result.tasks[0].remaining, parent.remaining);
  assert.ok(result.waitingTaskIds.has(parent.id)); assert.equal(result.recovered, 0);
});

test("grouped delegated members follow their plan without duplicating or forgetting their obligation", () => {
  const { parent, obligations } = fixture();
  const child = { ...obligations[0], id: "child", status: "absorbed", absorbedInto: "plan" };
  const plan = { id: "plan", status: "open", runFailures: 5 };
  let result = reconcileTaskHandoffs({ tasks: [parent, child, plan], requests: [] });
  assert.equal(result.recovered, 0); assert.equal(result.tasks[0].handoffState.state, "blocked");
  result = reconcileTaskHandoffs({ tasks: [parent, child, { ...plan, status: "done" }], requests: [] });
  assert.equal(result.waitingTaskIds.size, 0); assert.deepEqual(result.tasks[0].remaining, ["Unrelated manual obligation"]);
});

// Deliberately changed when direct request execution was retired: an inbox
// row is never a handoff parent. A legacy "verifying" row is migrated into an
// awaiting_verification task first (housekeeping, scripts/task-history.mjs),
// and that task follows the same children by run identity.
test("a legacy direct-request parent is followed as its migrated task, by run identity", () => {
  const { parent, obligations } = fixture();
  const { id: _id, ...fields } = parent;
  const legacy = { ...fields, status: "verifying", lastAttempt: { runId: "run-parent" } };
  const child = { ...obligations[0], id: "child", status: "active" };
  const unmigrated = reconcileTaskHandoffs({ tasks: [child], requests: [legacy] });
  assert.equal(unmigrated.requests[0], legacy, "an inbox row is not a parent");
  assert.equal(unmigrated.waitingRequestRuns, undefined); assert.equal(unmigrated.waitingTaskIds.size, 0);
  const moved = migrateLegacyRequests([legacy], { tasks: [child], now: 500 });
  assert.equal(moved.tasks.length, 1);
  const result = reconcileTaskHandoffs({ tasks: [...moved.tasks, child], requests: moved.requests });
  const task = result.tasks[0];
  assert.ok(result.waitingTaskIds.has(task.id));
  assert.equal(result.recovered, 0); assert.equal(task.handoffState.pending, 1);
  assert.deepEqual(task.handoffState.childTaskIds, ["child"]);
});

test("a plan's saved member lineage represents a missing child row until the plan finishes", () => {
  const { parent, obligations } = fixture();
  const plan = { id: "plan", status: "active", members: [{ ...obligations[0], id: "missing-member" }] };
  assert.equal(admitTaskHandoffs({ tasks: [plan], requests: [] }, obligations).added, 0, "a repeated admission also respects grouped lineage");
  let result = reconcileTaskHandoffs({ tasks: [parent, plan], requests: [] });
  assert.equal(result.recovered, 0); assert.equal(result.requests.length, 0);
  assert.ok(result.waitingTaskIds.has(parent.id));
  result = reconcileTaskHandoffs({ tasks: [parent, { ...plan, status: "done" }], requests: [] });
  assert.equal(result.recovered, 0); assert.equal(result.waitingTaskIds.size, 0);
  assert.deepEqual(result.tasks[0].handoffState.resolvedTitles, [obligations[0].title]);
});

test("a handoff identifier from another run cannot satisfy the parent's obligation", () => {
  const { parent, obligations } = fixture();
  const stale = { ...obligations[0], id: "stale-child", fromRun: "another-run", status: "done" };
  const result = reconcileTaskHandoffs({ tasks: [parent, stale], requests: [] });
  assert.equal(result.recovered, 1);
  assert.equal(result.tasks[0].handoffState.state, "waiting");
  assert.deepEqual(result.tasks[0].remaining, parent.remaining);
});

test("same-title admission uses a stable display suffix while preserving the original title and complete prompt", () => {
  const { obligations } = fixture();
  const unrelated = { id: "old", title: obligations[0].title, status: "done" };
  const first = admitTaskHandoffs({ tasks: [unrelated], requests: [] }, obligations);
  const child = first.requests[0];
  assert.match(child.title, / — follow-up [a-f0-9]{6}$/);
  assert.equal(child.originalTitle, obligations[0].title); assert.equal(child.prompt, obligations[0].prompt);
  assert.equal(admitTaskHandoffs({ tasks: [unrelated], requests: first.requests }, obligations).added, 0);
  assert.equal(admitTaskHandoffs({ tasks: [unrelated], requests: [] }, [child]).requests[0].title, child.title, "recovery never stacks display suffixes");
  assert.equal(admitTaskHandoffs({ tasks: [], requests: [] }, obligations).requests[0].title, obligations[0].title, "unique titles remain unchanged");
});

// One parked follow-up used to flag every ancestor: a parent's scheduler stage
// was "blocked" whenever its child was, so a chain of four cards showed four
// times under Needs attention. The parent now only waits; its own reason still
// names the follow-up that needs review, and the chain above it waits too.
test("a parked follow-up flags only itself: its parent and the chain above wait", () => {
  const { parent, obligations } = fixture();
  const child = { ...obligations[0], id: "child", status: "open", verifyAttempts: 3, verification: { state: "failed" } };
  const settled = reconcileTaskHandoffs({ tasks: [parent, child], requests: [] }).tasks[0];
  assert.equal(settled.handoffState.state, "blocked");
  const state = workState(settled, 1, { tasks: [settled, child] });
  assert.deepEqual([state.stage, state.blockedBy], ["waiting", "handoffs"]);
  assert.match(state.reason, /needs review before this parent can finish/);
  const upper = captureTaskHandoffs({ id: "run-grand", depth: 0, handoffs: [{ title: "Original feature", prompt: "Build the feature." }] }, { ref: { id: "grand" }, title: "Epic" }, { now: 50 });
  const grand = { id: "grand", status: "awaiting_verification", remaining: ["Original feature"], lastAttempt: { runId: "run-grand", handoffs: upper } };
  const middle = { ...upper[0], ...settled, handoffId: upper[0].handoffId, fromRun: upper[0].fromRun };
  const chain = reconcileTaskHandoffs({ tasks: [grand, middle, child], requests: [] });
  assert.equal(chain.tasks[0].handoffState.state, "waiting", "the grandparent waits; it is not flagged for review");
  assert.equal(chain.tasks[1].handoffState.state, "blocked", "the direct parent still names the follow-up that needs review");
});

test("a follow-up you drop settles its obligation, a deleted one is never re-admitted, and a reopened one is waited on again", () => {
  const { parent, obligations } = fixture();
  const dropped = { ...obligations[0], id: "child", status: "archived", dropped: { at: 5, by: "owner" }, verification: { state: "failed" } };
  const result = reconcileTaskHandoffs({ tasks: [parent, dropped], requests: [] });
  assert.equal(result.waitingTaskIds.size, 0);
  assert.deepEqual(result.tasks[0].remaining, ["Unrelated manual obligation"], "only the dropped hand-off is settled");
  assert.deepEqual(result.tasks[0].handoffState.droppedTitles, [obligations[0].title]);
  assert.equal(result.tasks[0].handoffState.state, "complete");
  assert.match(result.tasks[0].handoffState.reason, /dropped by you/);
  const archived = reconcileTaskHandoffs({ tasks: [parent, { ...dropped, dropped: undefined }], requests: [] });
  assert.ok(archived.waitingTaskIds.has(parent.id), "an unfinished archive without your drop settles nothing");
  const record = { ...parent, droppedHandoffs: [obligations[0].handoffId] };
  const deleted = reconcileTaskHandoffs({ tasks: [record], requests: [] });
  assert.equal(deleted.recovered, 0); assert.equal(deleted.requests.length, 0);
  assert.equal(deleted.waitingTaskIds.size, 0, "the parent's record stands in for the deleted card");
  const reopened = reconcileTaskHandoffs({ tasks: [record, { ...dropped, status: "open", dropped: undefined }], requests: [] });
  assert.ok(reopened.waitingTaskIds.has(parent.id), "a dropped card you reopen is waited on again");
});
