import test from "node:test";
import assert from "node:assert/strict";
import { applyIdeaAction, applyRequestAction } from "../scripts/idea-actions.cjs";
import { backlogIdeaEligible } from "../scripts/assistant.mjs";

test("saving a Mefi suggestion is idempotent, preserves concurrent work and cannot schedule it", () => {
  const existing = { id: "old", status: "planned", taskId: "task-existing" };
  const payload = { action: "add", title: " Map controls ", detail: "Show connected systems", intent: "improve", files: ["renderer/nav.js", "../outside.js", "data/secret.json", "renderer/nav.js"], status: "done", taskId: "forged", buildApproval: { approvedAt: 1 } };
  const saved = applyIdeaAction([existing], payload, 42);
  assert.equal(saved.ok, true);
  assert.equal(saved.ideas[1], existing);
  assert.deepEqual(saved.idea.files, ["renderer/nav.js"]);
  assert.equal(saved.idea.title, "Map controls");
  assert.equal(saved.idea.status, "new");
  assert.equal(saved.idea.source, "chat");
  assert.equal(saved.idea.taskId, undefined);
  assert.equal(saved.idea.buildApproval, undefined);
  assert.equal(backlogIdeaEligible(saved.idea), false, "Save idea never starts automatic work");
  assert.equal(backlogIdeaEligible(saved.idea, { explicit: true }), true, "the owner can still build it");
  const promoted = { ...saved.idea, taskId: "task-new", status: "accepted" };
  const again = applyIdeaAction([promoted, existing], payload, 50);
  assert.equal(again.added, false);
  assert.equal(again.idea, promoted, "a double click or retry preserves the newest board row");
  assert.equal(again.ideas.length, 2);
  const scoped = applyIdeaAction(saved.ideas, { ...payload, systemId: "renderer", systemName: "Interface" }, 55);
  assert.equal(scoped.idea.systemId, "renderer");
  assert.equal(scoped.idea.systemName, "Interface");
  assert.notEqual(scoped.idea.id, saved.idea.id, "the same proposal in another area retains its own scope");
  assert.equal(applyIdeaAction([], { action: "add", title: " ", detail: "text" }).ok, false);
  const long = applyIdeaAction([], { action: "add", title: "Detailed idea", detail: "x".repeat(12000) });
  assert.equal(long.idea.detail.length, 12000, "saving retains a long suggestion's requirements");
  assert.equal(applyIdeaAction([], { action: "add", title: "Too long", detail: "x".repeat(16001) }).ok, false, "oversized ideas fail explicitly instead of silently losing text");
});

test("reading or keeping a concurrently promoted idea retains its task and newer backlog entries", () => {
  const ideas = [{ id: "seen", status: "planned", taskId: "task-a", read: false, detail: "Full requirements" }, { id: "new", status: "new" }];
  for (const action of ["read", "keep"]) {
    const result = applyIdeaAction(ideas, { action, ideaId: "seen" }, 20);
    assert.equal(result.ideas.length, 2);
    assert.equal(result.ideas[0].taskId, "task-a");
    assert.equal(result.ideas[0].status, "planned");
    assert.equal(result.ideas[0].detail, "Full requirements");
  }
  assert.equal(ideas[0].read, false, "the old snapshot is untouched");
});

test("clean only removes selected ideas still done, preserving accepted, reopened and newly finished work", () => {
  const ideas = [{ id: "done", status: "done" }, { id: "accepted", status: "accepted" }, { id: "reopened", status: "keep" }, { id: "arrived", status: "done" }];
  assert.deepEqual(applyIdeaAction(ideas, { action: "clean", ideaIds: ["done", "accepted", "reopened"] }).ideas.map((idea) => idea.id), ["accepted", "reopened", "arrived"]);
  assert.equal(applyIdeaAction(ideas, { action: "delete", ideaId: "missing" }).ok, false);
  assert.equal(applyIdeaAction(ideas, { action: "unknown" }).ok, false);
});

test("inbox adds apply to the latest requests and keep only what a person or draft supplies", () => {
  const claimed = { at: 1, title: "Running", prompt: "Held by a worker", runId: "run_1", lease: { pid: 1, at: 1 }, status: "verifying" };
  const result = applyRequestAction([claimed], { action: "add", requests: [
    { title: " Draft ", prompt: " Build the export ", source: "grow", runId: "forged", buildApproval: { approvedAt: 1 }, status: "done" },
    { prompt: "   " },
  ] }, 50);
  assert.equal(result.ok, true);
  assert.equal(result.added, 1, "an empty prompt is not a request");
  assert.deepEqual({ ...result.requests[0] }, { title: "Draft", prompt: "Build the export", at: 50, source: "grow" }, "claims, approvals and results stay host-owned");
  assert.equal(result.requests[1], claimed, "the claimed request is carried over untouched");
  assert.equal(applyRequestAction([], { action: "add", requests: [{ prompt: "x", source: "fix" }] }, 1).requests[0].source, "manual");
  assert.equal(applyRequestAction([], { action: "add", requests: [] }, 1).ok, false);
});

test("a typed inbox ask is titled from its first line, and the owner's own adds carry the owner's origin", () => {
  // The Explorer inbox sends a prompt alone; promotion needs a title, and
  // nothing else runs an inbox request, so a title-less ask never ran.
  const typed = applyRequestAction([], { action: "add", requests: [{ prompt: "  Make the save button bigger\nand keep it blue  ", source: "manual" }] }, 7).requests[0];
  assert.equal(typed.title, "Make the save button bigger");
  assert.equal(typed.prompt, "Make the save button bigger\nand keep it blue");
  const long = applyRequestAction([], { action: "add", requests: [{ prompt: "x".repeat(300) }] }, 7).requests[0];
  assert.equal(long.title.length, 90, "clipped to the card cap");
  // Typed asks and expanded checkpoints are the owner's (band "owner" once on
  // the board); Grow and Improve drafts keep their filed band.
  assert.deepEqual({ ...typed.origin }, { kind: "request", by: "owner" });
  const drafts = applyRequestAction([], { action: "add", requests: ["expand", "grow", "improver"].map((source) => ({ title: `Draft ${source}`, prompt: "p", source })) }, 8).requests;
  assert.deepEqual(drafts.map((row) => row.origin?.by ?? null), ["owner", null, null]);
});

test("an inbox remove targets one request by identity and never drops a claimed or vanished one", () => {
  const rows = [
    { at: 5, prompt: "Same prompt", title: "A" },
    { at: 5, prompt: "Same prompt", title: "B" },
    { at: 7, prompt: "Claimed", runId: "run_7", lease: { pid: 1, at: 7 } },
  ];
  const removed = applyRequestAction(rows, { action: "remove", key: { at: 5, prompt: "Same prompt", title: "B" } });
  assert.deepEqual(removed.requests.map((row) => row.title ?? row.prompt), ["A", "Claimed"]);
  assert.match(applyRequestAction(rows, { action: "remove", key: { at: 7, prompt: "Claimed" } }).error, /A worker holds this request/);
  assert.match(applyRequestAction(rows, { action: "remove", key: { at: 9, prompt: "Promoted meanwhile" } }).error, /no longer in the inbox/);
  assert.equal(applyRequestAction(rows, { action: "rewrite" }).ok, false);
});
