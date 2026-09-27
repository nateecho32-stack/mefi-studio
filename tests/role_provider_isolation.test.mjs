// Per-role and per-provider model config must not bleed: saving one feature's
// model or provider leaves every other feature exactly as it was. The settings
// patch handler is the one place all of those keys merge into the saved state,
// so it is exercised directly here against a captured in-memory settings store
// rather than through the renderer.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { planOfflineProbe } from "../scripts/assistant.mjs";

const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const handlerSource = source.slice(
  source.indexOf('ipcMain.handle("settings:set-ai-routing"'),
  source.indexOf("// Auto setup: the one-click path"),
);
assert.ok(handlerSource.includes("settings:set-ai-routing"), "the AI routing handler must be found");
// The handler saves through main's settings queue, evaluated for real.
const queueSource = source.slice(source.indexOf("function updateSettings("), source.indexOf("function send(channel, payload)"));
assert.ok(queueSource.startsWith("function updateSettings("), "the settings queue must be found");

const AI_PROVIDERS = ["auto", "zai", "opencode", "zen", "grok", "claude", "codex", "antigravity", "lmstudio", "custom"];
const AI_AUTO_PROVIDERS = ["zai", "opencode", "zen", "grok", "claude", "codex", "antigravity", "lmstudio", "custom"];
const EXECUTOR_CLIS = ["opencode", "grok", "claude", "codex", "antigravity"];
const EXECUTOR_TIERS = ["auto", "free", "fast", "heavy"];

function host(initial = {}) {
  const state = { settings: structuredClone(initial), writes: 0, resets: 0 };
  const ai = { keyPresent: true, online: false, failures: 5, backoffUntil: Date.now() + 3600000, lastError: "Claude quota exhausted" };
  const problems = [{ kind: "ai-offline", text: ai.lastError }];
  const handlers = new Map();
  const context = vm.createContext({
    readSettings: async () => structuredClone(state.settings),
    writeSettings: async (next) => { state.settings = structuredClone(next); state.writes += 1; },
    settingsDisk: { queue: Promise.resolve() },
    providerBreaker: { reset() { state.resets += 1; } },
    assistantState: { ai, problems }, assistantAiProbeAttempts: 3,
    clearAssistantAiProbe() { state.clearedProbes = (state.clearedProbes || 0) + 1; },
    AI_PROVIDERS, AI_AUTO_PROVIDERS, EXECUTOR_CLIS, EXECUTOR_TIERS,
    OPENCODE_MODEL_ID: /^[^\s/]+\/.+$/,
    ZAI_MODEL_ROUTINE: "glm-5.3-flash",
    ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
  });
  const recoveryStart = source.indexOf("function resetAssistantAiBackoff()");
  assert.ok(recoveryStart >= 0, "the real recovery helper must be found");
  const recovery = source.slice(recoveryStart, source.indexOf("function assistantAiOk()", recoveryStart));
  vm.runInContext(`${recovery}\n${handlerSource}\n${queueSource}`, context);
  return {
    state, ai, problems, context, handlers,
    apply: (patch) => handlers.get("settings:set-ai-routing")({}, patch),
    settings: () => state.settings,
  };
}

test("a saved provider change releases the old quota backoff without claiming recovery", async () => {
  const h = host({ aiProvider: "claude" });
  assert.equal(planOfflineProbe(h.ai), null);
  assert.equal((await h.apply({ provider: "codex" })).ok, true);
  assert.equal(h.ai.failures, 0);
  assert.equal(h.ai.backoffUntil, 0);
  assert.equal(h.context.assistantAiProbeAttempts, 0);
  assert.equal(h.state.clearedProbes, 1);
  assert.equal(h.ai.online, false, "only an actual successful call proves recovery");
  assert.equal(h.ai.lastError, "Claude quota exhausted");
  assert.equal(h.problems.length, 1, "the warning stays until a successful reply");
  assert.ok(planOfflineProbe(h.ai), "the normal loop can now schedule a recovery probe");
});

test("a refused provider change preserves the existing quota backoff", async () => {
  const h = host({ aiProvider: "claude" });
  const before = structuredClone(h.ai);
  assert.equal((await h.apply({ provider: "invalid" })).ok, false);
  assert.deepEqual(h.ai, before);
  assert.equal(h.state.clearedProbes, undefined);
});

for (const action of ["save", "inherit", "apply", "preset-save"]) {
  test(`agent team ${action} only releases backoff when it applies configuration`, async () => {
    const h = host();
    Object.assign(h.context, {
      projects: { active: () => ({ id: "project" }) },
      crypto: { randomUUID: () => "fixture" },
      agentProfiles: { mutate: () => ({ ok: true, revision: 2 }) },
      agentsView: async () => ({ ok: true }), send() {},
    });
    h.context.assistantState.status = "paused";
    vm.runInContext(source.slice(source.indexOf("async function saveAgentTeam("), source.indexOf('ipcMain.handle("agents:save"')), h.context);
    await h.context.saveAgentTeam({ projectId: "project", action }, ["apply", "preset-save"].includes(action));
    assert.equal(h.ai.failures, action === "preset-save" ? 5 : 0);
    assert.equal(h.context.assistantState.status, "paused", "saving configuration cannot resume the service");
    assert.equal(h.ai.online, false);
  });
}

const base = () => ({
  aiProvider: "zai",
  aiRoleProviders: { routine: "zai", heavy: "opencode" },
  aiModels: { routine: "global-routine", heavy: "global-heavy" },
  aiModelsByProvider: { zai: { routine: "zai-routine", heavy: "zai-heavy" }, zen: { routine: "zen-routine" } },
  executorModels: { claude: "claude-opus-5-5" },
});

test("changing one role's provider leaves the other role, the main pick and every model alone", async () => {
  const h = host(base());
  const result = await h.apply({ roleProviders: { heavy: "claude" } });
  assert.equal(result.ok, true);
  assert.equal(h.settings().aiProvider, "zai", "the main pick is untouched");
  assert.deepEqual(h.settings().aiRoleProviders, { routine: "zai", heavy: "claude" }, "only the heavy role moves");
  assert.deepEqual(h.settings().aiModelsByProvider, base().aiModelsByProvider, "saved provider models are untouched");
  assert.deepEqual(h.settings().aiModels, base().aiModels, "role-wide models are untouched");
  assert.deepEqual(h.settings().executorModels, base().executorModels, "builder models are untouched");
});

test("setting one provider's routine model leaves its heavy model and every other provider alone", async () => {
  const h = host(base());
  await h.apply({ providerModels: { zen: { routine: "zen-routine-2" } } });
  assert.deepEqual(h.settings().aiModelsByProvider, {
    zai: { routine: "zai-routine", heavy: "zai-heavy" },
    zen: { routine: "zen-routine-2" },
  });
  await h.apply({ providerModels: { zen: { heavy: "zen-heavy" } } });
  assert.deepEqual(h.settings().aiModelsByProvider, {
    zai: { routine: "zai-routine", heavy: "zai-heavy" },
    zen: { routine: "zen-routine-2", heavy: "zen-heavy" },
  });
  assert.deepEqual(h.settings().aiRoleProviders, base().aiRoleProviders, "naming a model never moves a role");
  assert.equal(h.settings().aiProvider, "zai");
});

test("the role-wide fallback model changes one role without touching the other or any provider", async () => {
  const h = host(base());
  await h.apply({ models: { routine: "global-routine-2" } });
  assert.deepEqual(h.settings().aiModels, { routine: "global-routine-2", heavy: "global-heavy" });
  assert.deepEqual(h.settings().aiModelsByProvider, base().aiModelsByProvider);
});

test("clearing one role or provider leaves the rest in place", async () => {
  const h = host(base());
  await h.apply({ roleProviders: { heavy: "" } });
  assert.deepEqual(h.settings().aiRoleProviders, { routine: "zai" }, "only the cleared role is removed");
  await h.apply({ roleProviders: { routine: "" } });
  assert.equal("aiRoleProviders" in h.settings(), false, "the empty map is dropped, not stubbed");

  const p = host(base());
  await p.apply({ providerModels: { zen: { routine: "" } } });
  assert.deepEqual(p.settings().aiModelsByProvider, { zai: { routine: "zai-routine", heavy: "zai-heavy" } }, "the emptied provider is dropped");
  await p.apply({ providerModels: { zai: { heavy: "" } } });
  assert.deepEqual(p.settings().aiModelsByProvider, { zai: { routine: "zai-routine" } }, "the other provider role stays");
});

test("a role/provider change survives a save/reload and still leaves the rest alone", async () => {
  const h = host(base());
  await h.apply({ roleProviders: { routine: "zen" }, providerModels: { zen: { routine: "zen-routine-9" } } });
  // writeSettings persists JSON to disk; a reload is that same text read back.
  const reloaded = host(JSON.parse(JSON.stringify(h.settings())));
  assert.deepEqual(reloaded.settings().aiRoleProviders, { routine: "zen", heavy: "opencode" }, "the role split survives the round-trip");
  assert.deepEqual(reloaded.settings().aiModelsByProvider, {
    zai: { routine: "zai-routine", heavy: "zai-heavy" },
    zen: { routine: "zen-routine-9" },
  }, "the provider model survives and the other provider is untouched");
  assert.deepEqual(reloaded.settings().aiModels, base().aiModels, "role-wide models survive untouched");
  assert.equal(reloaded.settings().aiProvider, "zai", "the main pick survives untouched");
  await reloaded.apply({ roleProviders: { heavy: "claude" } });
  assert.deepEqual(reloaded.settings().aiRoleProviders, { routine: "zen", heavy: "claude" }, "a later change moves only its own role");
  assert.deepEqual(reloaded.settings().aiModelsByProvider, {
    zai: { routine: "zai-routine", heavy: "zai-heavy" },
    zen: { routine: "zen-routine-9" },
  }, "the reloaded models stay put");
});

test("an unknown role provider is refused and writes nothing", async () => {
  const h = host(base());
  const result = await h.apply({ roleProviders: { heavy: "bogus" } });
  assert.equal(result.ok, false);
  assert.match(result.error, /unknown provider for the heavy role: bogus/);
  assert.deepEqual(h.settings().aiRoleProviders, base().aiRoleProviders, "the refused patch never lands");
  assert.equal(h.state.writes, 0);
});

test("malformed or unknown feature settings are dropped, never saved as a broken route", async () => {
  const h = host(base());
  // An unknown provider is skipped while the known provider in the same patch lands.
  const unknown = await h.apply({ providerModels: { bogus: { routine: "invented" }, zai: { routine: "zai-routine-2" } } });
  assert.equal(unknown.ok, true);
  assert.deepEqual(h.settings().aiModelsByProvider, { zai: { routine: "zai-routine-2", heavy: "zai-heavy" }, zen: { routine: "zen-routine" } }, "the unknown provider never enters the saved map");
  // A provider whose value is not a role map is ignored rather than dereferenced.
  await h.apply({ providerModels: { zai: "not-a-role-map" } });
  assert.deepEqual(h.settings().aiModelsByProvider, { zai: { routine: "zai-routine-2", heavy: "zai-heavy" }, zen: { routine: "zen-routine" } });
  // An unknown builder CLI is skipped while the known one in the same patch lands.
  await h.apply({ executorTierModels: { bogus: { fast: "x" }, claude: { heavy: "opus" } } });
  assert.deepEqual(h.settings().executorTierModels, { claude: { heavy: "opus" } }, "the unknown builder never enters the saved map");
  // A non-object roleProviders patch is ignored instead of crashing.
  await h.apply({ roleProviders: "claude" });
  assert.deepEqual(h.settings().aiRoleProviders, base().aiRoleProviders, "the malformed patch leaves the saved role map untouched");
});

test("an OpenCode tier model that is not provider/model is refused and writes nothing", async () => {
  const h = host(base());
  const result = await h.apply({ executorTierModels: { opencode: { fast: "glm-5.3-flash" } } });
  assert.equal(result.ok, false);
  assert.match(result.error, /provider\/model ids/);
  assert.equal(h.state.writes, 0, "the invalid route is refused before it can reach a shell");
  assert.equal("executorTierModels" in h.settings(), false);
});
