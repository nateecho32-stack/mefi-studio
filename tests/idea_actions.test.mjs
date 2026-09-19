import test from "node:test";
import assert from "node:assert/strict";
import { applyIdeaAction } from "../scripts/idea-actions.cjs";

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
