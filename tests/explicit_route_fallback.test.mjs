import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

// Graceful degradation for an explicit provider pick: with the auto fallback
// armed, a provider whose key, endpoint or model is gone hands the call to the
// next keyed HTTP route in the owner's saved order instead of blocking every
// assistant feature; unarmed, the pick stays absolute and the error honest.
// All credentials, CLIs and endpoints are fixtures — nothing here reads real
// settings or touches the network.
const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `slice boundary: ${start}`);
  return source.slice(from, to);
};
const code = [
  section("const SINGLE_MODEL_PROVIDERS =", "function assistantModelOverride("),
  section("function assistantModelOverride(", "function executorModelOverride("),
  section("function normalizeAutoProviders(", "function firstLaunchNeedsSetup("),
  section("function normalizeCompatEndpoint(", "const modelPerformanceStores"),
].join("\n");

function routeHost({ settings = {}, keys = {} } = {}) {
  const logs = [], fetches = [];
  let saved = { aiProvider: "auto", ...settings };
  const store = { zaiApiKeyEncrypted: "zai-fixture-key", apiKeyEncrypted: "go-fixture-key", customApiKeyEncrypted: "custom-fixture-key", ...keys };
  const context = vm.createContext({
    AI_PROVIDERS: ["auto", "zai", "opencode", "grok", "claude", "codex", "antigravity", "lmstudio", "custom"],
    AI_AUTO_PROVIDERS: ["zai", "opencode", "grok", "claude", "codex", "antigravity", "lmstudio", "custom"],
    AUTO_PROVIDER_NAMES: { zai: "z.ai GLM", opencode: "OpenCode Go", grok: "Grok CLI", claude: "Claude Code CLI", codex: "Codex CLI", antigravity: "Antigravity CLI", lmstudio: "LM Studio", custom: "custom endpoint" },
    ZAI_ENDPOINT: "https://api.z.ai/api/coding/paas/v4/chat/completions",
    ZAI_MODEL_ROUTINE: "glm-5.3-flash", ZAI_MODEL_HEAVY: "glm-5.3",
    ASSISTANT_ENDPOINT: "https://opencode.ai/zen/go/v1/chat/completions", ASSISTANT_MODEL: "deepseek-v4.1-flash",
    LMSTUDIO_ENDPOINT: "http://127.0.0.1:1234/v1/chat/completions",
    readSettings: async () => structuredClone(saved),
    decryptKey: (_settings, field) => store[field] ?? null,
    logLine: (message) => logs.push(message),
    grokCliAvailable: async () => false, claudeCliAvailable: async () => false,
    codexCliAvailable: async () => false, antigravityCliAvailable: async () => false,
    AbortController, setTimeout, clearTimeout,
    fetch: async (url) => { fetches.push(String(url)); return { ok: false, json: async () => ({}) }; },
  });
  vm.runInContext(code, context);
  return {
    logs, fetches,
    resolve: (role = "routine", options) => context.resolveAiRoute(role, options),
    routes: (options) => context.armedFallbackRoutes(saved, { zaiKey: store.zaiApiKeyEncrypted ?? null, goKey: store.apiKeyEncrypted ?? null, ...options }),
  };
}

test("an unusable explicit pick keeps its honest error while the fallback is off", async () => {
  const host = routeHost({ settings: { aiProvider: "zai" }, keys: { zaiApiKeyEncrypted: null, apiKeyEncrypted: "go-fixture-key" } });
  const result = await host.resolve();
  assert.equal(result.ok, false);
  assert.equal(result.error, "no z.ai key saved - add one in the Studio tab");
  assert.deepEqual(host.logs, []);
  assert.deepEqual(host.fetches, []);
});

test("with the fallback armed, a missing key degrades to the next keyed route in the saved order", async () => {
  const host = routeHost({ settings: { aiProvider: "zai", aiAutoFallback: true }, keys: { zaiApiKeyEncrypted: null } });
  const result = await host.resolve();
  assert.equal(result.ok, true);
  assert.equal(result.provider, "opencode");
  assert.equal(result.model, "deepseek-v4.1-flash");
  assert.equal(result.apiKey, "go-fixture-key");
  assert.match(host.logs.join("\n"), /z\.ai GLM cannot answer \(no z\.ai key saved.*answering via OpenCode Go/);
});

test("an OpenCode pick without its key degrades to z.ai with the role's own model", async () => {
  const host = routeHost({ settings: { aiProvider: "opencode", aiAutoFallback: true }, keys: { apiKeyEncrypted: null } });
  const heavy = await host.resolve("heavy");
  assert.equal(heavy.ok, true);
  assert.equal(heavy.provider, "zai");
  assert.equal(heavy.model, "glm-5.3");
  const routine = await routeHost({ settings: { aiProvider: "opencode", aiAutoFallback: true }, keys: { apiKeyEncrypted: null } }).resolve();
  assert.equal(routine.model, "glm-5.3-flash");
});

test("an armed fallback with nothing to walk on still fails honestly", async () => {
  const host = routeHost({ settings: { aiProvider: "zai", aiAutoFallback: true }, keys: { zaiApiKeyEncrypted: null, apiKeyEncrypted: null } });
  const result = await host.resolve();
  assert.equal(result.ok, false);
  assert.equal(result.error, "no z.ai key saved - add one in the Studio tab");
  assert.deepEqual(host.logs, []);
});

test("a usable explicit pick stays primary; the armed retry list rides along, and never when off", async () => {
  const armed = routeHost({ settings: { aiProvider: "zai", aiAutoFallback: true, aiAutoProviders: ["zai", "opencode"] } });
  const on = await armed.resolve();
  assert.equal(on.ok, true);
  assert.equal(on.provider, "zai");
  assert.equal(on.model, "glm-5.3-flash");
  assert.equal(on.fallback.provider, "opencode");
  assert.deepEqual([...on.fallbacks.map((row) => row.provider)], ["opencode"]);
  const off = routeHost({ settings: { aiProvider: "zai", aiAutoFallback: false, aiAutoProviders: ["zai", "opencode"] } });
  const plain = await off.resolve();
  assert.equal(plain.provider, "zai");
  assert.equal(plain.fallback, null);
  assert.deepEqual([...plain.fallbacks], []);
});

test("the armed walk never probes endpoint models and skips its own provider", async () => {
  const host = routeHost({
    settings: { aiProvider: "zai", aiAutoFallback: true, aiAutoProviders: ["zai", "lmstudio", "custom", "opencode"] },
    keys: { customApiKeyEncrypted: null },
  });
  const routes = host.routes({ skip: "zai", role: "routine" });
  assert.deepEqual([...routes.map((row) => row.provider)], ["opencode"], "keyless custom and override-less LM Studio join nothing");
  assert.deepEqual(host.fetches, [], "the retry list resolves without a single endpoint probe");
});

test("LM Studio with no model degrades to the keyed route once armed", async () => {
  const host = routeHost({ settings: { aiProvider: "lmstudio", aiAutoFallback: true }, keys: { apiKeyEncrypted: null } });
  const result = await host.resolve();
  assert.equal(result.ok, true);
  assert.equal(result.provider, "zai");
  assert.match(host.logs.join("\n"), /LM Studio cannot answer.*answering via z\.ai GLM/);
  assert.equal(host.fetches.length, 1, "only the primary's own probe ran");
});

test("a custom endpoint with a saved model and key joins the armed retry list", async () => {
  const host = routeHost({
    settings: {
      aiProvider: "zai", aiAutoFallback: true, aiAutoProviders: ["zai", "custom"],
      customEndpoint: "https://api.example.com/v1/chat/completions",
      aiModelsByProvider: { custom: { routine: "my-model" } },
    },
  });
  const on = await host.resolve();
  assert.deepEqual([...on.fallbacks.map((row) => [row.provider, row.model, row.apiKey])], [["custom", "my-model", "custom-fixture-key"]]);
  assert.deepEqual(host.fetches, []);
});

test("CLI routes keep their dedicated rescue and never join the armed walk", async () => {
  const host = routeHost({
    settings: { aiProvider: "grok", aiAutoFallback: true, aiAutoProviders: ["grok", "zai", "opencode"], aiModelsByProvider: { grok: { routine: "grok-4" } } },
  });
  const route = await host.resolve();
  assert.equal(route.ok, true);
  assert.equal(route.cli, true);
  assert.equal(route.model, "grok-4");
  assert.equal(route.fallback, null, "a CLI failure keeps its own allowCli:false pass");
  const routes = host.routes({ skip: "grok", role: "routine" });
  assert.deepEqual([...routes.map((row) => row.provider)], ["zai", "opencode"], "CLI providers are never silent retry targets");
});

test("an auto route takes the first usable provider and walks the rest only when armed", async () => {
  const armed = routeHost({ settings: { aiAutoFallback: true, aiAutoProviders: ["grok", "zai", "opencode"] } });
  const on = await armed.resolve();
  assert.equal(on.ok, true);
  assert.equal(on.provider, "zai", "the unavailable CLI is skipped for the first usable route");
  assert.equal(on.fallback.provider, "opencode");
  assert.deepEqual([...on.fallbacks.map((row) => row.provider)], ["opencode"]);
  const off = routeHost({ settings: { aiAutoProviders: ["zai", "opencode"] } });
  const plain = await off.resolve();
  assert.equal(plain.ok, true);
  assert.equal(plain.provider, "zai");
  assert.equal(plain.fallback, null, "auto still answers the first route; it just never retries unasked");
  assert.deepEqual([...plain.fallbacks], []);
});

test("an auto route with nothing usable names the saved order and what to do", async () => {
  const host = routeHost({ settings: { aiAutoProviders: ["zai", "opencode"] }, keys: { zaiApiKeyEncrypted: null, apiKeyEncrypted: null } });
  const result = await host.resolve();
  assert.equal(result.ok, false);
  assert.match(result.error, /no usable provider in the auto order \(z\.ai GLM > OpenCode Go\)/);
  assert.match(result.error, /save a key, install a CLI or change the order/);
  assert.deepEqual(host.fetches, []);
});

test("a custom endpoint that reports no model degrades to the keyed route once armed", async () => {
  const host = routeHost({
    settings: { aiProvider: "custom", aiAutoFallback: true, aiAutoProviders: ["custom", "zai"], customEndpoint: "https://api.example.com/v1/chat/completions" },
  });
  const result = await host.resolve();
  assert.equal(result.ok, true);
  assert.equal(result.provider, "zai");
  assert.match(host.logs.join("\n"), /custom endpoint cannot answer \(the custom endpoint reported no model.*answering via z\.ai GLM/);
  assert.equal(host.fetches.length, 1, "only the primary's own probe ran");
});
