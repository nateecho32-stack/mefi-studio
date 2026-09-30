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

function routeHost({ settings = {}, keys = {}, serve = null, now = null, clis = [] } = {}) {
  const logs = [], fetches = [], cliChecks = [], probeHeaders = [];
  let saved = { aiProvider: "auto", ...settings };
  const store = { zaiApiKeyEncrypted: "zai-fixture-key", apiKeyEncrypted: "go-fixture-key", openrouterApiKeyEncrypted: "or-fixture-key", customApiKeyEncrypted: "custom-fixture-key", ...keys };
  const context = vm.createContext({
    AI_PROVIDERS: ["auto", "zai", "opencode", "openrouter", "grok", "claude", "codex", "chatgpt", "antigravity", "lmstudio", "custom"],
    AI_AUTO_PROVIDERS: ["zai", "opencode", "openrouter", "grok", "claude", "codex", "chatgpt", "antigravity", "lmstudio", "custom"],
    AUTO_PROVIDER_NAMES: { zai: "z.ai GLM", opencode: "OpenCode Go", openrouter: "OpenRouter", grok: "Grok CLI", claude: "Claude Code CLI", codex: "Codex CLI", chatgpt: "ChatGPT plan", antigravity: "Antigravity CLI", lmstudio: "LM Studio", custom: "custom endpoint" },
    ZAI_ENDPOINT: "https://api.z.ai/api/coding/paas/v4/chat/completions",
    ZAI_MODEL_ROUTINE: "glm-5.3-flash", ZAI_MODEL_HEAVY: "glm-5.3",
    ASSISTANT_ENDPOINT: "https://opencode.ai/zen/go/v1/chat/completions", ASSISTANT_MODEL: "deepseek-v4.1-flash",
    OPENROUTER_ENDPOINT: "https://openrouter.ai/api/v1/chat/completions", OPENROUTER_MODEL: "openrouter/free",
    LMSTUDIO_ENDPOINT: "http://127.0.0.1:1234/v1/chat/completions",
    readSettings: async () => structuredClone(saved),
    decryptKey: (_settings, field) => store[field] ?? null,
    logLine: (message) => logs.push(message),
    grokCliAvailable: async () => { cliChecks.push("grok"); return clis.includes("grok"); }, claudeCliAvailable: async () => { cliChecks.push("claude"); return clis.includes("claude"); },
    codexCliAvailable: async () => clis.includes("codex"), antigravityCliAvailable: async () => clis.includes("antigravity"),
    AbortController, setTimeout, clearTimeout,
    fetch: async (url, options) => { fetches.push(String(url)); probeHeaders.push(options?.headers ?? null); await Promise.resolve(); return serve ? { ok: true, json: async () => ({ data: [{ id: serve }] }) } : { ok: false, json: async () => ({}) }; },
    ...(now ? { Date: { now: () => now.at } } : {}),
  });
  vm.runInContext(code, context);
  return {
    logs, fetches, cliChecks, probeHeaders, context,
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

test("OpenRouter joins the auto order and its missing key uses only an armed fallback", async () => {
  const ready = routeHost({ settings: { aiProvider: "auto", aiAutoProviders: ["openrouter", "zai"] } });
  const route = await ready.resolve();
  assert.equal(route.provider, "openrouter");
  assert.equal(route.model, "openrouter/free");
  assert.equal(route.apiKey, "or-fixture-key");
  const missing = routeHost({ settings: { aiProvider: "openrouter", aiAutoProviders: ["openrouter", "zai"] }, keys: { openrouterApiKeyEncrypted: null } });
  assert.match((await missing.resolve()).error, /no OpenRouter key/);
  const rescued = routeHost({ settings: { aiProvider: "openrouter", aiAutoFallback: true, aiAutoProviders: ["openrouter", "zai"] }, keys: { openrouterApiKeyEncrypted: null } });
  assert.equal((await rescued.resolve()).provider, "zai");
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
  assert.deepEqual([...routes.map((row) => row.provider)], ["opencode"], "an endpoint-less custom route and override-less LM Studio join nothing");
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
  const host = routeHost({ settings: { aiAutoProviders: ["zai", "opencode"] }, keys: { zaiApiKeyEncrypted: null, apiKeyEncrypted: null, openrouterApiKeyEncrypted: null, customApiKeyEncrypted: null } });
  const result = await host.resolve();
  assert.equal(result.ok, false);
  assert.match(result.error, /no usable provider in the auto order \(Claude Code CLI > ChatGPT plan > Codex CLI > Grok CLI > Antigravity CLI > z\.ai GLM > OpenCode Go\)/);
  assert.match(result.error, /save a key, install a CLI or change the order/);
  assert.deepEqual(host.fetches, []);
});

// The ChatGPT plan (Sign in with ChatGPT): a fake plan stands in for
// scripts/chatgpt-plan.cjs, so no sign-in, token or network is involved.
function planHost(status, { settings = {}, models = [{ slug: "gpt-6-luna" }, { slug: "gpt-6.1-sol" }], ...options } = {}) {
  const host = routeHost({ settings, ...options });
  host.context.chatgptPlan = () => ({ status: async () => ({ ok: true, ...status }), listModels: async () => ({ ok: true, models }) });
  return host;
}

test("an explicit ChatGPT plan pick answers on the plan's own model per role once signed in", async () => {
  const signedIn = { signedIn: true, planUsage: true, limited: false };
  const routine = await planHost(signedIn, { settings: { aiProvider: "chatgpt" } }).resolve("routine");
  assert.deepEqual({ ok: routine.ok, provider: routine.provider, model: routine.model, endpoint: routine.endpoint, apiKey: routine.apiKey }, { ok: true, provider: "chatgpt", model: "gpt-6-luna", endpoint: null, apiKey: null });
  assert.equal((await planHost(signedIn, { settings: { aiProvider: "chatgpt" } }).resolve("heavy")).model, "gpt-6.1-sol");
  const saved = await planHost(signedIn, { settings: { aiProvider: "chatgpt", aiModelsByProvider: { chatgpt: { routine: "gpt-6.1-sol" } } } }).resolve("routine");
  assert.equal(saved.model, "gpt-6.1-sol", "the owner's saved pick for this route wins");
});

test("a ChatGPT plan that is signed out, not granted or at its limit keeps an honest error, or degrades once armed", async () => {
  for (const status of [{ signedIn: false }, { signedIn: true, planUsage: false }, { signedIn: true, planUsage: true, limited: true }]) {
    const result = await planHost(status, { settings: { aiProvider: "chatgpt" } }).resolve();
    assert.equal(result.ok, false);
    assert.match(result.error, /Continue with ChatGPT under Setup > Connect an AI/);
  }
  const armed = await planHost({ signedIn: false }, { settings: { aiProvider: "chatgpt", aiAutoFallback: true } }).resolve();
  assert.equal(armed.ok, true);
  assert.equal(armed.provider, "zai");
});

test("subscriptions first: Auto answers on the ChatGPT plan before any keyed route, and skips it while signed out", async () => {
  const on = await planHost({ signedIn: true, planUsage: true, limited: false }, { settings: { aiAutoProviders: ["zai", "opencode"] } }).resolve();
  assert.equal(on.provider, "chatgpt");
  const off = await planHost({ signedIn: false }, { settings: { aiAutoProviders: ["zai", "opencode"] } }).resolve();
  assert.equal(off.provider, "zai");
  const unticked = await planHost({ signedIn: true, planUsage: true, limited: false }, { settings: { aiAutoProviders: ["zai", "opencode"], aiSubscriptionFirst: false } }).resolve();
  assert.equal(unticked.provider, "zai", "the owner's own order when subscriptions-first is off");
});

test("a ChatGPT plan call answers in chatCompletion's shape, is recorded without a price, and a limit reads as a topped-out login", async () => {
  const host = planHost({ signedIn: true, planUsage: true, limited: false });
  const records = [], sent = [], asked = [];
  let reply = { ok: true, text: "{\"ok\":true}", reasoning: "", finish: "completed", model: "gpt-6.1-sol", tokenUsage: { inputTokens: 12, outputTokens: 3 } };
  host.context.chatgptPlan = () => ({ respond: async (options) => { asked.push(options); return reply; } });
  host.context.recordModelCall = async (row) => { records.push(row); };
  host.context.send = (channel, payload) => sent.push([channel, payload]);
  const candidate = { provider: "chatgpt", model: "gpt-6.1-sol", endpoint: null, apiKey: null };
  const body = { model: "gpt-6.1-sol", temperature: 0.2, max_tokens: 900, messages: [{ role: "system", content: "S" }, { role: "user", content: "U" }] };
  const ok = await host.context.chatgptPlanCall(candidate, body, { taskType: "routine", source: "request", effort: "high" });
  assert.deepEqual({ ok: ok.ok, text: ok.text, model: ok.model, costUsd: ok.costUsd }, { ok: true, text: "{\"ok\":true}", model: "gpt-6.1-sol", costUsd: null });
  assert.deepEqual(asked[0].messages, body.messages);
  assert.equal(asked[0].effort, "high");
  assert.deepEqual({ provider: records[0].provider, status: records[0].status, costUsd: records[0].costUsd, tokens: records[0].tokenUsage.inputTokens }, { provider: "chatgpt", status: "ok", costUsd: null, tokens: 12 });
  reply = { ok: false, errorKind: "limit", error: "ChatGPT plan: Usage limit reached." };
  const limited = await host.context.chatgptPlanCall(candidate, body, {});
  assert.deepEqual({ ok: limited.ok, errorKind: limited.errorKind, toppedOut: limited.toppedOut }, { ok: false, errorKind: "quota", toppedOut: true });
  assert.deepEqual(JSON.parse(JSON.stringify(sent.at(-1))), ["accounts:changed", { id: "chatgpt" }]);
  reply = { ok: false, errorKind: "eligibility", error: "not granted" };
  assert.equal((await host.context.chatgptPlanCall(candidate, body, {})).errorKind, "auth");
  assert.equal((await host.context.chatgptPlanCall(candidate, body, {})).toppedOut, undefined);
  // The limit pause refusing locally never reached OpenAI: no ledger row.
  const before = records.length;
  reply = { ok: false, errorKind: "limit", error: "ChatGPT plan: Usage limit reached.", toppedOut: true };
  assert.equal((await host.context.chatgptPlanCall(candidate, body, {})).toppedOut, true);
  assert.equal(records.length, before, "a paused call is not a measurement");
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

test("an unarmed auto route stops at its first usable provider; an armed one skips CLI entries past it", async () => {
  const order = ["zai", "grok", "lmstudio", "custom", "opencode"];
  // Subscriptions-first off: the saved order alone, so the CLI entries sit
  // where the test puts them.
  const settings = { aiAutoProviders: order, aiSubscriptionFirst: false, customEndpoint: "https://api.example.com/v1/chat/completions" };
  const off = routeHost({ settings });
  const plain = await off.resolve();
  assert.equal(plain.provider, "zai");
  assert.deepEqual([...plain.fallbacks], []);
  assert.deepEqual(off.fetches, [], "no endpoint probe for entries the route never uses");
  assert.deepEqual(off.cliChecks, [], "no CLI lookup either");
  const on = routeHost({ settings: { ...settings, aiAutoFallback: true }, serve: "served-model" });
  const armed = await on.resolve();
  assert.equal(armed.provider, "zai");
  assert.deepEqual([...armed.fallbacks.map((row) => [row.provider, row.model])], [["lmstudio", "served-model"], ["custom", "served-model"], ["opencode", "deepseek-v4.1-flash"]]);
  assert.deepEqual(on.cliChecks, [], "a CLI entry past the primary could never be a fallback");
  const cliFirst = routeHost({ settings: { aiAutoProviders: ["grok", "zai"], aiSubscriptionFirst: false } });
  assert.equal((await cliFirst.resolve()).provider, "zai");
  assert.deepEqual(cliFirst.cliChecks, ["grok"], "a CLI entry ahead of the primary is still looked up");
});

test("endpoint model probes are shared while in flight and remembered per endpoint", async () => {
  const clock = { at: 1_000_000 };
  const host = routeHost({ settings: { aiProvider: "lmstudio" }, serve: "local-model", now: clock });
  const [a, b] = await Promise.all([host.resolve(), host.resolve()]);
  assert.equal(a.model, "local-model");
  assert.equal(b.model, "local-model");
  assert.equal(host.fetches.length, 1, "concurrent callers share one probe");
  clock.at += 59_000;
  assert.equal((await host.resolve()).model, "local-model");
  assert.equal(host.fetches.length, 1, "a found model is remembered for a minute");
  clock.at += 2_000;
  await host.resolve();
  assert.equal(host.fetches.length, 2, "then the endpoint is asked again");
  const idle = routeHost({ settings: { aiProvider: "lmstudio" }, now: clock });
  assert.equal((await idle.resolve()).ok, false);
  clock.at += 10_000;
  assert.equal((await idle.resolve()).ok, false);
  assert.equal(idle.fetches.length, 1, "a miss is remembered briefly");
  clock.at += 6_000;
  await idle.resolve();
  assert.equal(idle.fetches.length, 2, "and a server started meanwhile is noticed within 15 s");
});
