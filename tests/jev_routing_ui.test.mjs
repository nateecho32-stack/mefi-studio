import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../renderer/booklet.js", import.meta.url), "utf8");
const template = await readFile(new URL("../renderer/booklet.template.html", import.meta.url), "utf8");
const studio = source.slice(source.indexOf("  function initStudio()"), source.indexOf("  // ---- wire up ----"));
const flush = async () => { for (let index = 0; index < 20; index += 1) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

function environment(overrides = {}, bridge = {}) {
  const ids = new Map(); const writes = []; const logs = [];
  class Element {
    constructor() { this.value = ""; this.textContent = ""; this.checked = false; this.disabled = false; this.hidden = false; this.listeners = {}; }
    addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
    querySelectorAll() { return []; }
    async trigger(name) { for (const callback of this.listeners[name] || []) await callback({ target: this }); await flush(); }
  }
  for (const match of template.matchAll(/\bid="([^"]+)"/g)) ids.set(match[1], new Element());
  const settings = { provider: "auto", fallbackOpenCode: false, models: {}, executorCli: "opencode", executorModel: "", modelSelection: "jev", jevConfigured: false, routingDecision: null, ...overrides };
  let reads = 0;
  const api = {
    launchStudio() {}, onStudioLog() {},
    getApiKey: async () => ({ saved: true }),
    setApiKey: async (_key, provider) => { if (provider === "gateway") settings.jevConfigured = true; return { ok: true }; },
    jevStatus: async () => ({ enabled: false, configured: settings.jevConfigured }),
    jevSetEnabled: async () => ({ ok: true }),
    cliStatus: async () => [],
    getAiRouting: async () => { reads += 1; return structuredClone(settings); },
    setAiRouting: async (payload) => { writes.push(structuredClone(payload)); Object.assign(settings, payload); return { ok: true }; },
    ...bridge,
  };
  const document = { getElementById: (id) => ids.get(id) || null, querySelectorAll: () => [] };
  const context = vm.createContext({ document, window: { mefiStudio: api }, state: { doc: { models: [] } }, updateSpeedModels() {}, studioLog: (line) => logs.push(line) });
  vm.runInContext(`${studio}\ninitStudio();`, context);
  return { get: (id) => ids.get(id), settings, writes, api, logs, reads: () => reads };
}

test("Jev mode without a gateway key shows its fallback and keeps configured overrides", async () => {
  const env = environment({ models: { routine: "explicit-model", heavy: "explicit-heavy" } }); await flush();
  assert.equal(env.get("ai-model-selection").value, "jev");
  assert.equal(env.get("ai-model-routine").value, "explicit-model");
  assert.equal(env.get("ai-model-heavy").value, "explicit-heavy");
  assert.match(env.get("ai-routing-status").textContent, /waiting for a gateway key.*usual defaults/);
  assert.match(env.get("ai-routing-decision").textContent, /No selection recorded/);
  assert.equal(env.get("ai-routing-evidence").hidden, true);
  assert.equal(env.reads(), 1);
  assert.deepEqual(env.writes, []);
});

test("selection mode saves independently of provider and refreshing preserves unsaved model text", async () => {
  const env = environment({ provider: "zai", jevConfigured: true }); await flush();
  env.get("ai-model-heavy").value = "unsaved-heavy";
  env.get("ai-model-selection").value = "fixed";
  await env.get("ai-model-selection").trigger("change");
  assert.deepEqual(env.writes, [{ modelSelection: "fixed" }]);
  assert.equal(env.settings.provider, "zai");
  assert.match(env.get("ai-routing-status").textContent, /Fixed defaults enabled/);
  await env.get("ai-routing-refresh").trigger("click");
  assert.equal(env.get("ai-model-heavy").value, "unsaved-heavy");
  assert.equal(env.writes.length, 1, "refresh does not request a model or change settings");
});

test("saving the gateway key refreshes routing readiness independently of intake classification", async () => {
  const env = environment(); await flush();
  env.get("jev-key").value = "fixture-key";
  await env.get("save-jev-key").trigger("click");
  assert.equal(env.get("jev-key").value, "");
  assert.match(env.get("ai-routing-status").textContent, /Jev model selection ready/);
  assert.equal(env.get("jev-enabled").checked, false);
  assert.equal(env.writes.length, 0);
  assert.equal(env.reads(), 2);
});

test("last model selection separates reported measurements, missing values and catalog estimates", async () => {
  const env = environment({ jevConfigured: true, routingDecision: {
    provider: "opencode", model: "fixture-model", taskType: "planning", method: "jev", at: 1700000000000,
    reason: "<b>Chosen for the task</b>",
    evidence: { measured: { task: { samples: 2, latencyMs: { median: 1234 }, throughputTokensPerSecond: { median: 12.5 }, costUsd: { mean: null }, quality: { human: { meanOutOf5: 4 }, model: { meanOutOf5: null } } } }, catalog: { quality: { index: 51 }, pricingEstimate: { default: { input: 0.5, output: 2, condition: "off-peak" } } } },
  } }); await flush();
  assert.match(env.get("ai-routing-decision").textContent, /Jev selected · opencode \/ fixture-model · planning/);
  assert.match(env.get("ai-routing-decision").textContent, /<b>Chosen for the task<\/b>/);
  assert.equal(env.get("ai-routing-decision").innerHTML, undefined, "remote text is never interpreted as HTML");
  const text = env.get("ai-routing-evidence").textContent;
  assert.match(text, /this task type, 2 calls.*1\.23 s.*12\.5 tokens\/s/);
  assert.match(text, /reported cost unknown.*human rating 4\.0\/5.*model rating unknown/);
  assert.match(text, /catalog price estimate: \$0\.5 input \/ \$2 output per million tokens \(off-peak\)/);
  assert.doesNotMatch(text, /reported cost \$0/);
});

test("latest status read wins, failures are visible, and the refresh control recovers", async () => {
  const first = deferred(), second = deferred(); let reads = 0;
  const env = environment({}, { getAiRouting: () => (++reads === 1 ? first : second).promise });
  const refresh = env.get("ai-routing-refresh").trigger("click");
  second.resolve({ provider: "grok", modelSelection: "jev", jevConfigured: true }); await refresh;
  first.resolve({ provider: "auto", modelSelection: "fixed" }); await flush();
  assert.match(env.get("ai-routing-status").textContent, /Grok CLI uses your explicit model/);
  env.api.getAiRouting = async () => { throw new Error("offline"); };
  await env.get("ai-routing-refresh").trigger("click");
  assert.match(env.get("ai-routing-status").textContent, /status unavailable/);
  assert.equal(env.get("ai-routing-refresh").disabled, false);
});

test("worker evidence identifies HTTP-only timing and incomplete billing coverage", async () => {
  const env = environment({ routingDecision: {
    provider: "zai", model: "fixture-worker", taskType: "coding", method: "jev", reason: "Suitable model",
    evidence: { measured: { overall: { samples: 4, costUsd: { samples: 1, mean: 0.04, unknownRecords: 3 } } }, catalog: { quality: { index: 51, source: "AA", version: "4.0" } } },
  } }); await flush();
  const text = env.get("ai-routing-evidence").textContent;
  assert.match(text, /mean reported cost \$0\.04 \(1 reported, 3 unknown\)/);
  assert.match(text, /Catalog quality: 51 \(AA 4\.0\)/);
  assert.match(text, /catalog price estimate: unknown/);
  assert.match(text, /Studio HTTP requests; CLI worker timing and billing are not measured/);
});

test("failed routing saves expose an error without claiming the new mode is active", async () => {
  const env = environment({}, { setAiRouting: async () => ({ ok: false, error: "storage unavailable" }) }); await flush();
  env.get("ai-model-selection").value = "fixed";
  await env.get("ai-model-selection").trigger("change");
  assert.match(env.get("ai-routing-status").textContent, /Could not save routing: storage unavailable.*saved selection is unchanged/);
  assert.equal(env.settings.modelSelection, "jev");
});
