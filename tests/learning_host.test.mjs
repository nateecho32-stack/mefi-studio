import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import path from "node:path";
import os from "node:os";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createModelPerformanceStore } from "../scripts/model-performance.cjs";
import decisionMemory from "../scripts/decision-memory.cjs";
import modelLearning from "../scripts/model-learning.cjs";
const main = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const section = (start, end) => main.slice(main.indexOf(start), main.indexOf(end, main.indexOf(start)));

test("host blends existing project ledgers without moving stores or attributing legacy rows to a project", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mefi-learning-host-"));
  const file = (id) => id ? path.join(root, "data", "projects", id, "model-performance.json") : path.join(root, "data", "model-performance.json");
  const stores = Object.fromEntries(["p", "q", ""].map((id) => [id, createModelPerformanceStore({ filePath: file(id) })]));
  try {
    for (const [projectId, n] of [["p", 3], ["q", 4], ["", 2]]) for (let i = 0; i < n; i++) await stores[projectId].record({ id: `${projectId || "old"}${i}`, projectId: projectId || null, provider: "zai", model: "glm-5.3", taskType: "fix", status: "ok", source: "worker", outcome: "verified" });
    const env = vm.createContext({ path, createModelPerformanceStore, decisionMemory, modelLearning, STUDIO_ROOT: root,
      projects: { current: () => ({ id: "p" }), list: () => ({ projects: [{ id: "p" }, { id: "q" }] }), dataPath: (_source, project) => file(project.id) },
      projectDataPath: () => file("p"), readSettings: async () => ({ learning: { models: "blend" } }) });
    vm.runInContext(section("const modelPerformanceStores =", "// Routing decisions contain only model metadata."), env);
    const blended = await env.modelLearningSnapshot();
    assert.equal(blended.models[0].wins, 4.8);
    assert.equal((await env.modelLearningSnapshot({ scope: "project" })).models[0].wins, 3);
    assert.equal((await env.modelLearningSnapshot({ scope: "global" })).models[0].wins, 9);
    assert.equal((await env.modelLearningSnapshot({ scope: "off" })).models.length, 0);
    assert.equal((await stores[""].snapshot()).models[0].wins, 2, "legacy storage remains intact");
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }
});

test("learning settings validate before writes and disabled decisions return no prompt preferences", async () => {
  let settings = { learning: { decisions: { enabled: false, scope: "project" }, models: "blend" } }, writes = 0;
  const env = vm.createContext({ decisionMemory, modelLearning, Date, projects: { current: () => ({ id: "p" }) },
    agentBrain: { decisionRows: async () => [{ projectId: "p", kind: "scope", verb: "narrow", at: Date.now() }] },
    readSettings: async () => settings, updateSettings: async (fn) => { writes++; fn(settings); }, modelRoutingCache: new Map(),
    modelLearningSnapshot: async () => ({ models: [] }) });
  vm.runInContext(section("async function assistantDecisionPreferences()", "function deskResolvesOn("), env);
  assert.equal((await env.assistantDecisionPreferences()).length, 0);
  assert.equal((await env.learningSet({ decisions: { scope: "invented" } })).ok, false);
  assert.equal(writes, 0);
  const next = await env.learningSet({ decisions: { enabled: true }, models: "off" });
  assert.equal(next.decisions.scope, "project"); assert.equal(next.models, "off");
  assert.equal((await env.assistantDecisionPreferences()).length, 1);
});
