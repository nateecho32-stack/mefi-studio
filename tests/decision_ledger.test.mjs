import test from "node:test";
import assert from "node:assert/strict";
import ledger from "../scripts/decision-ledger.cjs";

test("Undo restores changed fields, removes added fields and preserves automatic budgets", () => {
  const original = { id: "t", status: "open", runFailures: 5, nextRunAt: 20, ownerHold: undefined };
  const applied = { id: "t", status: "open", runFailures: 3, decisions: [{ choice: "retry" }], assistantRetries: [{ at: 10 }] };
  const decision = { id: "d", before: ledger.snapshot([original], ["t"]), after: ledger.snapshot([applied], ["t"]) };
  const result = ledger.restore([applied], decision, 11);
  assert.equal(result.pending, false);
  assert.equal(result.tasks[0].runFailures, 5);
  assert.equal(result.tasks[0].nextRunAt, 20);
  assert.equal(result.tasks[0].decisions, undefined);
  assert.deepEqual(result.tasks[0].assistantRetries, [{ at: 10 }]);
});

test("Undo waits for running work and keeps later owner edits when it can apply", () => {
  const before = { id: "t", runFailures: 5, loopGuard: { at: 1 } };
  const after = { id: "t", runFailures: 3 };
  const decision = { id: "d", before: ledger.snapshot([before], ["t"]), after: ledger.snapshot([after], ["t"]) };
  assert.equal(ledger.restore([{ ...after, runId: "r" }], decision, 5).tasks[0].autonomyUndo, "d");
  const later = { ...after, runFailures: 4, ownerHold: { at: 4 }, title: "My changed brief" };
  const restored = ledger.restore([later], decision, 5);
  assert.equal(restored.tasks[0].runFailures, 4);
  assert.deepEqual(restored.tasks[0].ownerHold, { at: 4 });
  assert.equal(restored.tasks[0].title, "My changed brief");
  assert.deepEqual(restored.conflicts, ["t:runFailures"]);
});

test("a split card that already ran is kept by Undo and loses its undo marker", () => {
  const parent = { id: "p", status: "open" };
  const decision = { id: "d", before: ledger.snapshot([parent], ["p"]), after: ledger.snapshot([parent], ["p"]), createdTaskIds: ["child"] };
  // The undo was queued while the split card ran; its run ended since.
  const child = { id: "child", status: "open", lastAttempt: { at: 3 }, autonomyUndo: "d" };
  const result = ledger.restore([parent, child], decision, 5);
  const kept = result.tasks.find((task) => task.id === "child");
  assert.equal(kept.status, "open", "its work is not erased");
  assert.equal(kept.autonomyUndo, undefined, "nothing else would clear the marker, and the card would wait on it for good");
  assert.deepEqual(result.conflicts, ["child"]);
});
