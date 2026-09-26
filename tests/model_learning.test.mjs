import test from "node:test";
import assert from "node:assert/strict";
import learning from "../scripts/model-learning.cjs";
import { recordOf, estimateWinProbability } from "../scripts/model-routing.mjs";
const model = (wins, losses) => ({ provider: "zai", model: "glm-5.3", wins, losses, taskStrengths: [{ taskType: "fix", wins, losses }] });
test("blended routing uses Beta(1 + local + 0.3 others), with no double counting", () => {
  const project = { models: [model(3, 1)] }, global = learning.aggregate([project, { models: [model(4, 2)] }]);
  const blended = learning.blend({ project, global }).models[0];
  assert.equal(blended.wins, 4.2); assert.equal(blended.losses, 1.6);
  const record = recordOf(blended.taskStrengths[0]);
  assert.equal(record.wins, 4.2); assert.equal(record.losses, 1.6);
  const estimate = estimateWinProbability({ record: { task: record }, catalog: { quality: { index: 95 } } });
  assert.equal(estimate.p, Math.round((5.2 / 7.8) * 1000) / 1000);
  assert.equal(learning.blend({ project, global, scope: "project" }).models[0].wins, 3);
  assert.equal(learning.blend({ project, global, scope: "global" }).models[0].wins, 7);
  assert.deepEqual(learning.blend({ project, global, scope: "off" }).models, []);
});
test("task skill tables show only settled outcomes, per model and work kind", () => {
  const rows = learning.skills({ models: [model(8, 2), { ...model(0, 0), model: "untried" }] });
  assert.deepEqual(rows, [{ provider: "zai", model: "glm-5.3", taskType: "fix", wins: 8, losses: 2, n: 10, p: 9 / 12 }]);
});
