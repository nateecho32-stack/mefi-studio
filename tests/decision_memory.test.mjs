import test from "node:test";
import assert from "node:assert/strict";
import memory from "../scripts/decision-memory.cjs";
const now = 1800000000000;
const row = (verb, projectId = "p", extra = {}) => ({ at: now, kind: "scope", verb, projectId, ...extra });
const options = [{ id: "narrow" }, { id: "split" }];
test("blend gives other projects 0.3 weight and project scope excludes old unscoped rows", () => {
  const rows = [row("narrow"), row("narrow"), row("split", "elsewhere"), row("split", null)];
  const pick = memory.advise("scope", options, memory.profile({ rows, projectId: "p", scope: "blend", now }));
  assert.equal(pick.verb, "narrow"); assert.equal(pick.share, 2 / 2.6); assert.equal(pick.n, 4);
  assert.equal(memory.profile({ rows, projectId: "p", scope: "project", now })[0].n, 2);
  assert.equal(memory.profile({ rows, projectId: "p", scope: "global", now })[0].verbs[0].share, 0.5);
});
test("recency and corrections change preferences without learning Undo as an action", () => {
  const rows = [row("narrow", "p", { at: now - memory.HALF_LIFE }), row("split"), row("split", "p", { correction: { was: "narrow" } })];
  const group = memory.profile({ rows, projectId: "p", now })[0];
  assert.equal(group.verbs[0].weight, 3); assert.equal(group.verbs[1].weight, 0.5);
  const undone = memory.profile({ rows: [row("narrow"), row("undo", "p", { correction: { was: "narrow" } }), row("split")], projectId: "p", now });
  assert.equal(undone[0].verbs.length, 1); assert.equal(undone[0].verbs[0].verb, "split");
});
test("forget removes exactly the chosen project/kind/verb, or all requested history", () => {
  const rows = [row("narrow"), row("split"), row("narrow", "q"), row("grant", "p", { kind: "permission" })];
  const kept = memory.forget(rows, { projectId: "p", kind: "scope", verb: "narrow" });
  assert.equal(kept.length, 3); assert.ok(kept.some((row) => row.projectId === "q"));
  assert.equal(memory.forget(rows, { projectId: "p", all: true }).length, 1);
  assert.equal(memory.forget(rows, { scope: "global", all: true }).length, 0);
});
test("only a strong matching pattern increases confidence and the ledger is bounded", () => {
  const learned = { verb: "narrow", share: 0.75, n: 4 };
  assert.equal(memory.confidence(0.6, options[0], learned), 0.75);
  assert.equal(memory.confidence(0.6, options[1], learned), 0.6);
  assert.equal(memory.confidence(0.6, options[0], { ...learned, n: 3 }), 0.6);
  assert.equal(memory.normalize(Array.from({ length: 1001 }, () => row("narrow"))).length, 1000);
});
