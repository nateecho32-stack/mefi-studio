import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

// The chat's "is an AI connected" gate (aiRouteConfigured / aiRouteReady) and
// the resolver that actually picks the route (resolveAiRoute) run here side
// by side on the real main.cjs sources, so a setup the resolver can answer is
// never held as "No AI connected", and a setup it cannot answer is not
// reported as connected. Keys, CLIs and endpoints are fixtures; nothing reads
// real settings, spawns a CLI or touches the network.
const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `slice boundary: ${start}`);
  return source.slice(from, to);
};
const code = [
  section("const SINGLE_MODEL_PROVIDERS =", "function assistantModelOverride("),
  section("function assistantModelOverride(", "// The assistant's two roles"),
  section("function roleProvider(", "// What each role would run right now"),
  section("function normalizeAutoProviders(", "function firstLaunchNeedsSetup("),
  section("function normalizeCompatEndpoint(", "const modelPerformanceStores"),
  section("function aiRouteConfigured(", "async function runAssistant("),
].join("\n");

const FIELDS = { zai: "zaiApiKeyEncrypted", opencode: "apiKeyEncrypted", zen: "zenApiKeyEncrypted", openrouter: "openrouterApiKeyEncrypted", custom: "customApiKeyEncrypted" };

function host({ settings = {}, keys = [], clis = [], serve = null } = {}) {
  const saved = { aiProvider: "auto", ...settings };
  const store = Object.fromEntries(keys.map((id) => [FIELDS[id], `${id}-fixture-key`]));
  const fetches = [], lookups = [];
  const cli = (id) => async () => { lookups.push(id); return clis.includes(id); };
  const context = vm.createContext({
    AI_PROVIDERS: ["auto", "zai", "opencode", "zen", "openrouter", "grok", "claude", "codex", "chatgpt", "antigravity", "lmstudio", "custom"],
    AI_AUTO_PROVIDERS: ["zai", "opencode", "zen", "openrouter", "grok", "claude", "codex", "chatgpt", "antigravity", "lmstudio", "custom"],
    AUTO_PROVIDER_NAMES: { zai: "z.ai GLM", opencode: "OpenCode Go", zen: "OpenCode Zen", openrouter: "OpenRouter", grok: "Grok CLI", claude: "Claude Code CLI", codex: "Codex CLI", chatgpt: "ChatGPT plan", antigravity: "Antigravity CLI", lmstudio: "LM Studio", custom: "custom endpoint" },
    ZAI_ENDPOINT: "https://zai.example/chat", ZAI_MODEL_ROUTINE: "glm-5.3-flash", ZAI_MODEL_HEAVY: "glm-5.3",
    ASSISTANT_ENDPOINT: "https://go.example/chat", ASSISTANT_MODEL: "deepseek-v4.1-flash",
    ZEN_MODEL_ROUTINE: "gpt-6-luna", ZEN_MODEL_HEAVY: "gpt-6-sol", zenEndpoint: () => "https://zen.example/responses",
    OPENROUTER_ENDPOINT: "https://openrouter.example/chat", OPENROUTER_MODEL: "openrouter/free",
    LMSTUDIO_ENDPOINT: "http://127.0.0.1:1234/v1/chat/completions",
    readSettings: async () => structuredClone(saved),
    decryptKey: (_settings, field) => store[field] ?? null,
    keyAvailable: (_settings, field) => Boolean(store[field]),
    logLine() {},
    grokCliAvailable: cli("grok"), claudeCliAvailable: cli("claude"), codexCliAvailable: cli("codex"), antigravityCliAvailable: cli("antigravity"),
    AbortController, setTimeout, clearTimeout,
    fetch: async (url, options) => { fetches.push({ url: String(url), headers: options?.headers ?? null }); return serve ? { ok: true, json: async () => ({ data: [{ id: serve }] }) } : { ok: false, json: async () => ({}) }; },
  });
  vm.runInContext(code, context);
  return {
    fetches, lookups, context, settings: saved,
    ready: () => context.aiRouteReady(structuredClone(saved)),
    configured: (options) => context.aiRouteConfigured(structuredClone(saved), options),
    resolve: (role = "routine", options) => context.resolveAiRoute(role, options),
  };
}

// A ChatGPT plan sign-in (scripts/chatgpt-plan.cjs, faked here) is a
// connected AI on its own, from a cold start: the gate reads the plan's
// status before its synchronous check, so a fresh launch never reads as
// "not connected" while the resolver would answer on the plan.
test("a ChatGPT plan sign-in counts as connected, picked or on Auto, from a cold start", async () => {
  const plan = (status) => () => ({ status: async () => ({ ok: true, ...status }), listModels: async () => ({ ok: true, models: [{ slug: "gpt-6-luna" }, { slug: "gpt-6.1-sol" }] }) });
  const on = { signedIn: true, planUsage: true, limited: false };
  for (const [label, settings, status, expected] of [
    ["an explicit ChatGPT plan pick", { aiProvider: "chatgpt" }, on, true],
    ["the ChatGPT plan on the default Auto walk", {}, on, true],
    ["a signed-out ChatGPT plan pick", { aiProvider: "chatgpt" }, { signedIn: false }, false],
    ["a ChatGPT plan at its limit", { aiProvider: "chatgpt" }, { ...on, limited: true }, false],
  ]) {
    const h = host({ settings });
    h.context.chatgptPlan = plan(status);
    assert.equal(await h.ready(), expected, `gate: ${label}`);
    const route = await h.resolve();
    assert.equal(route.ok ? route.provider : null, expected ? "chatgpt" : null, `resolver: ${label}`);
  }
});

test("the gate and the resolver agree on every setup that needs no network", async () => {
  const cases = [
    ["a Claude Code login on the default Auto walk", { clis: ["claude"] }, true, "claude"],
    ["a Codex login on the default Auto walk", { clis: ["codex"] }, true, "codex"],
    ["nothing at all", {}, false, null],
    ["an OpenRouter key on the default z.ai > OpenCode order", { keys: ["openrouter"] }, true, "openrouter"],
    ["an OpenCode Zen key on the default order", { keys: ["zen"] }, true, "zen"],
    ["a CLI outside the order with subscriptions-first off", { settings: { aiSubscriptionFirst: false }, clis: ["grok"] }, false, null],
    ["a listed CLI with subscriptions-first off", { settings: { aiSubscriptionFirst: false, aiAutoProviders: ["grok"] }, clis: ["grok"] }, true, "grok"],
    ["an explicit Claude Code pick", { settings: { aiProvider: "claude" } }, true, "claude"],
    ["a z.ai key on the default order", { keys: ["zai"] }, true, "zai"],
  ];
  for (const [label, setup, expected, provider] of cases) {
    const h = host(setup);
    assert.equal(await h.ready(), expected, `gate: ${label}`);
    const route = await h.resolve();
    assert.equal(route.ok, expected, `resolver: ${label} (${route.error ?? route.provider})`);
    if (provider) assert.equal(route.provider, provider, label);
  }
});

test("a CLI-only Auto setup is connected once its binary is found, and only then", async () => {
  const signedIn = host({ clis: ["antigravity"] });
  assert.equal(await signedIn.ready(), true);
  const bare = host();
  assert.equal(bare.configured(), true, "without lookups a listed CLI still counts (the old, optimistic answer)");
  assert.equal(await bare.ready(), false, "with them, subscription CLIs this machine lacks do not");
  const keyed = host({ keys: ["zai"] });
  assert.equal(await keyed.ready(), true);
  assert.deepEqual(keyed.lookups, [], "a saved key answers before any CLI lookup runs");
});

test("a saved key outside the Auto order answers only when nothing listed can", async () => {
  const rescued = host({ keys: ["openrouter"], settings: { aiAutoFallback: true } });
  const route = await rescued.resolve();
  assert.equal(route.provider, "openrouter");
  assert.equal(route.rescued, true);
  assert.equal(route.fallback, null);
  assert.deepEqual([...route.fallbacks], [], "an unlisted account never becomes a silent retry target");
  const listed = await host({ keys: ["zai", "openrouter"] }).resolve();
  assert.equal(listed.provider, "zai", "the owner's order still leads");
  assert.equal(listed.rescued, undefined);
  const both = await host({ keys: ["zen", "openrouter"] }).resolve();
  assert.equal(both.provider, "zen", "rescue walks the keyed routes in one fixed order");
  assert.deepEqual([...host({ keys: ["openrouter", "zai"] }).context.autoRescueProviders({ aiAutoProviders: ["zai"] }, { hasKey: (_s, field) => field === "openrouterApiKeyEncrypted" })], ["openrouter"]);
});

test("a keyless custom endpoint answers with no Authorization header, on Auto and when picked", async () => {
  const endpoint = "http://127.0.0.1:11434/v1";
  const picked = host({ settings: { aiProvider: "custom", customEndpoint: endpoint }, serve: "llama3.2" });
  const route = await picked.resolve();
  assert.equal(route.ok, true, route.error);
  assert.equal(route.model, "llama3.2");
  assert.equal(route.apiKey, "", "no key is sent, not an error");
  assert.equal(picked.fetches[0].url, "http://127.0.0.1:11434/v1/models");
  assert.equal(picked.fetches[0].headers, null, "the model probe carries no bearer either");
  assert.equal(await picked.ready(), true);
  const auto = await host({ settings: { customEndpoint: endpoint }, serve: "qwen3" }).resolve();
  assert.equal(auto.provider, "custom", "a saved endpoint rescues Auto too");
  const silent = host({ settings: { aiProvider: "custom", customEndpoint: endpoint } });
  const refused = await silent.resolve();
  assert.equal(refused.ok, false);
  assert.match(refused.error, /reported no model.*API key if it needs one/, "the error names both remedies");
  const keyed = host({ settings: { aiProvider: "custom", customEndpoint: "https://api.example.com/v1" }, keys: ["custom"], serve: "hosted" });
  assert.equal((await keyed.resolve()).apiKey, "custom-fixture-key");
  assert.equal(keyed.fetches[0].headers.authorization, "Bearer custom-fixture-key", "a hosted endpoint gets its key on /models too");
});

test("aiRouteMissing names the resolver's own reason and never only the maintainer's providers", () => {
  const h = host();
  const text = h.context.aiRouteMissing("Drafting a brain", { ok: false, error: "LM Studio reported no loaded model - load one there" });
  assert.match(text, /^Drafting a brain needs a connected AI provider \(LM Studio reported no loaded model/);
  assert.match(text, /Agents > Setup > Connections/);
  assert.doesNotMatch(text, /z\.ai, OpenCode Go or OpenCode Zen key/);
  assert.doesNotMatch(h.context.aiRouteMissing("A pass"), /\(\)/, "no reason, no empty parentheses");
});

test("every side gate reads the same predicate and every side call the resolved route", () => {
  const auditor = section('ipcMain.handle("auditor:run"', 'ipcMain.handle("checkpoint:add"');
  assert.match(auditor, /const withAi = await aiRouteReady\(settings\)/, "the Auditor's AI pass no longer needs a z.ai or OpenCode Go key");
  assert.doesNotMatch(auditor, /keyAvailable\(settings, "apiKeyEncrypted"\)/);
  const setKey = section('ipcMain.handle("settings:set-key"', "const listOpenrouterModels");
  assert.match(setKey, /return \{ ok: true, routeOk \}/, "a key save reports whether an assistant route answers now");
  const music = section("const recommendMusic = createMusicRecommender(", "\n  ipcMain");
  assert.match(music, /allowCli: DATA_ONLY_CLIS/);
  assert.match(music, /route\.cli \? cliAssistantCall : httpAssistantCall/, "a CLI route rides the CLI text call planning uses");
  const view = section("async function aiRoutingView(", 'ipcMain.handle("settings:get-ai-routing"');
  for (const field of ["autoOrder: autoProviderOrder(settings)", "autoRescue: autoRescueProviders(", "routeReady: await aiRouteReady(", "lmStudio: await lmStudioStatus(", "modelSelectionSaved:"]) assert.ok(view.includes(field), `the routing view carries ${field}`);
});
