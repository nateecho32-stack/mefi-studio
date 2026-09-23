// renderer/graph.js ranks request headroom (usage.requests.h5) on a log10
// scale. An unlimited model used to enter that scale as a raw 1e9, so it
// became the whole range and every finite model's speed norm collapsed to ~0;
// data/models.json ships such a model (union-alpha), so the real task ranking
// ignored speed. Unlimited now sits one decade above the roomiest finite model.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../renderer/graph.js", import.meta.url), "utf8");
const catalog = JSON.parse(await readFile(new URL("../data/models.json", import.meta.url), "utf8"));
const speedOnly = { id: "speed-only", name: "Speed only", description: "", weights: { speed: 1 } };

function loadGraph() {
  const window = {};
  vm.runInContext(source, vm.createContext({ window, console }));
  return window.MefiGraph;
}

const model = (id, h5, extra = {}) => ({
  id, name: id, vendor: "fixture", typicalCostUSD: 0.001,
  pricing: { default: { input: 1, output: 1 } }, usage: { requests: { h5 } }, ...extra,
});
const speedNorms = (ranked) => Object.fromEntries(ranked.map((entry) => [entry.model.id, entry.norms.speed(entry.model)]));

test("an unlimited model shares the log scale, so two finite models keep distinct speed norms", () => {
  const { scoreModels } = loadGraph();
  const doc = { taskPresets: [speedOnly], models: [
    model("unlimited", "unlimited", { typicalCostUSD: null, usage: { unlimited: true, requests: { h5: "unlimited" } } }),
    model("narrow", 100),
    model("roomy", 10000),
  ] };
  const { ranked } = scoreModels(doc, "speed-only");
  const speed = speedNorms(ranked);
  assert.equal(speed.unlimited, 1, "unlimited headroom tops the range");
  assert.equal(speed.narrow, 0, "the narrowest finite model anchors the bottom");
  // log10: narrow 2, roomy 4, unlimited one decade above roomy = 5.
  assert.ok(Math.abs(speed.roomy - 2 / 3) < 1e-9, `roomy sits two thirds up the scale, got ${speed.roomy}`);
  assert.ok(speed.roomy - speed.narrow > 0.5, "finite models must not collapse onto each other");
  assert.deepEqual(Array.from(ranked, (entry) => entry.model.id), ["unlimited", "roomy", "narrow"]);
});

test("only unlimited models in the pool rank equal instead of dividing by zero", () => {
  const { scoreModels } = loadGraph();
  const doc = { taskPresets: [speedOnly], models: [model("a", "unlimited"), model("b", "unlimited")] };
  const speed = speedNorms(scoreModels(doc, "speed-only").ranked);
  assert.deepEqual(speed, { a: 1, b: 1 });
});

test("the shipped catalog keeps a usable spread of finite speed norms beside its unlimited model", (t) => {
  const { scoreModels } = loadGraph();
  const { ranked } = scoreModels({ ...catalog, taskPresets: [speedOnly] }, "speed-only");
  const unlimited = ranked.filter((entry) => entry.model.usage?.requests?.h5 === "unlimited");
  if (!unlimited.length) return t.skip("the catalog no longer ships an eligible unlimited model");
  const finite = ranked.filter((entry) => typeof entry.model.usage?.requests?.h5 === "number");
  const norms = finite.map((entry) => entry.norms.speed(entry.model));
  for (const entry of unlimited) assert.equal(entry.norms.speed(entry.model), 1, `${entry.model.id} tops the speed range`);
  assert.ok(Math.max(...norms) - Math.min(...norms) > 0.5, `finite speed norms span ${Math.min(...norms)}..${Math.max(...norms)}`);
});
