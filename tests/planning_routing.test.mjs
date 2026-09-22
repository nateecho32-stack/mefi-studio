import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import path from "node:path";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { normalizeObservation } from "../scripts/model-performance.cjs";
import providerBreakers from "../scripts/provider-breaker.cjs";

// Run the real planning host callback through route selection, HTTP shaping,
// fallback and observation with fake settings/transport. No keys or live stores.
const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
}
const okReply = () => ({ ok: true, json: async () => ({ model: "reported-model", usage: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 }, choices: [{ message: { content: "Planning reply" } }] }) });
function host(settings, responses = [okReply()], { clis = [] } = {}) {
  const calls = [], observations = [], admitted = [], wakes = [], project = { id: "fixture", path: "/fixture" };
  const installed = new Set(clis);
  const context = vm.createContext({
    path, crypto, AbortController, setTimeout, clearTimeout,
    // The real breaker, one per host: httpAssistantCall gates every call on it.
    createBreaker: providerBreakers.createBreaker, logLine: () => {},
    STUDIO_ROOT: "/studio", projects: { current: () => project, active: () => project }, projectDataPath: (value) => value,
    createPlanningStore: () => ({}), createPlanningService: (options) => options,
    jevShadowIntake: (tasks) => { admitted.push(structuredClone(tasks)); return new Promise(() => {}); },
    ensureAssistant: async () => {}, refreshAutopilotQueue: async () => {}, assistantAskForWork: (reason) => wakes.push(reason),
    mutateBoard() { throw new Error("Model suggestions must not create tasks"); },
    AI_PROVIDERS: ["auto", "zai", "opencode", "grok", "claude", "codex", "antigravity"],
    AI_AUTO_PROVIDERS: ["zai", "opencode", "grok", "claude", "codex", "antigravity", "lmstudio", "custom"],
    AUTO_PROVIDER_NAMES: { zai: "z.ai GLM", opencode: "OpenCode Go", grok: "Grok CLI", claude: "Claude Code CLI", codex: "Codex CLI", antigravity: "Antigravity CLI", lmstudio: "LM Studio", custom: "custom endpoint" },
    grokCliAvailable: async () => installed.has("grok"),
    claudeCliAvailable: async () => installed.has("claude"),
    codexCliAvailable: async () => installed.has("codex"),
    antigravityCliAvailable: async () => installed.has("antigravity"),
    ASSISTANT_ENDPOINT: "https://opencode.invalid", ZAI_ENDPOINT: "https://zai.invalid",
    LMSTUDIO_ENDPOINT: "http://127.0.0.1:1234/v1/chat/completions",
    ASSISTANT_MODEL: "routine-go", ZAI_MODEL_ROUTINE: "routine-zai", ZAI_MODEL_HEAVY: "heavy-zai",
    readSettings: async () => structuredClone(settings), decryptKey: (value, key) => value[key] ? `fixture-${key}` : null,
    applyModelRouting: async (route) => route,
    assistantState: { ai: {} }, assistantSessionId: async () => "fixture-session",
    fetch: async (endpoint, options) => { calls.push({ endpoint, options, body: JSON.parse(options.body) }); return responses.shift() ?? okReply(); },
    recordModelCall: async (observation) => { observations.push(normalizeObservation(observation)); },
  });
  vm.runInContext([
    section("// Single-model routes have one model concept", "const modelPerformanceStores"),
    section("async function chatCompletion(", "// The Grok CLI"),
    section("async function httpAssistantCall(", "function normalizeBriefing("),
    section("const planningServices =", "async function planningRequest("),
  ].join("\n"), context);
  return { context, calls, observations, admitted, wakes, complete: (kind) => context.planningService().complete({ system: "No tools", user: "private planning decisions" }, { kind }) };
}

test("approved planning task admission reaches advisory Jev without delaying the existing scheduler", async () => {
  const h = host({});
  const task = { id: "planned-task", title: "Implement reviewed scope", prompt: "Approved requirement", source: "planning", createdAt: 42 };
  await h.context.planningService().onConverted([task]);
  assert.deepEqual(h.admitted, [[{ ...task, kind: "task", at: 42 }]]);
  assert.equal(h.wakes.length, 1, "an unsettled classifier cannot block scheduler handoff");
  await h.context.planningService().onConverted([]);
  assert.equal(h.admitted.length, 1, "already-admitted retries never enqueue duplicate classifications");
  assert.equal(h.calls.length, 0, "admission itself spends no model call");
});

test("planning selects default routine and heavy models when no override was saved", async () => {
  const h = host({ aiProvider: "auto", zaiApiKeyEncrypted: "fixture" });
  await h.complete("questions");
  await h.complete("spec");
  assert.deepEqual(h.calls.map((call) => call.body.model), ["routine-zai", "heavy-zai"]);
  assert.deepEqual(h.calls.map((call) => call.body.max_tokens), [2500, 7000]);
  assert.equal(h.calls[1].body.reasoning_effort, "low");
  assert.equal(h.calls[1].body.thinking.type, "enabled");
  assert.deepEqual(h.observations.map((row) => [row.taskType, row.source, row.model]), [["planning-questions", "planning", "reported-model"], ["planning-spec", "planning", "reported-model"]]);
  assert.doesNotMatch(JSON.stringify(h.observations), /private planning decisions|fixture-zaiApiKeyEncrypted|No tools/);
});

test("planning uses each explicit model override without changing the provider", async () => {
  const h = host({ aiProvider: "opencode", apiKeyEncrypted: "fixture", aiModels: { routine: "custom-routine", heavy: "custom-heavy" } });
  await h.complete("question");
  await h.complete("spec");
  assert.deepEqual(h.calls.map((call) => call.body.model), ["custom-routine", "custom-heavy"]);
  assert.ok(h.calls.every((call) => call.endpoint === "https://opencode.invalid"));
  assert.ok(h.calls.every((call) => call.options.headers["x-opencode-session"] === "fixture-session"));
});

test("planning with Grok selected uses saved HTTP credentials and never invokes a CLI", async () => {
  const h = host({ aiProvider: "grok", zaiApiKeyEncrypted: "fixture" });
  const result = await h.complete("spec");
  assert.equal(result.ok, true);
  assert.equal(h.calls[0].endpoint, "https://zai.invalid");
  assert.equal(h.calls[0].body.tools, undefined);
  const unconfigured = host({ aiProvider: "grok" });
  assert.match((await unconfigured.complete("question")).error, /saved z.ai or OpenCode Go key/);
  assert.equal(unconfigured.calls.length, 0);
  assert.equal(unconfigured.observations.length, 0);
});

test("planning with Antigravity selected keeps planning on the saved HTTP key, never the agy CLI", async () => {
  const h = host({ aiProvider: "antigravity", zaiApiKeyEncrypted: "fixture" });
  const result = await h.complete("spec");
  assert.equal(result.ok, true);
  assert.equal(h.calls[0].endpoint, "https://zai.invalid");
  assert.equal(h.calls[0].body.tools, undefined);
});

test("models are scoped per provider without leaking across routes", async () => {
  const h = host({ aiProvider: "zai", zaiApiKeyEncrypted: "fixture", aiModels: { routine: "global-routine", heavy: "global-heavy" }, aiModelsByProvider: { zai: { routine: "zai-routine" } } });
  await h.complete("question");
  assert.equal(h.calls[0].body.model, "zai-routine", "the provider's saved model wins");
  await h.complete("spec");
  assert.equal(h.calls[1].body.model, "global-heavy", "an unset provider role still uses the role-wide fallback");
  const override = h.context.assistantModelOverride;
  assert.equal(override({ aiModels: { routine: "global-routine" } }, "routine", "grok"), "", "a role-wide model never leaks into a CLI route");
  assert.equal(override({ aiModelsByProvider: { grok: { routine: "grok-4" } } }, "routine", "grok"), "grok-4");
  assert.equal(override({ aiModelsByProvider: { grok: { routine: "grok-4" } } }, "heavy", "grok"), "grok-4", "a single-model route reuses its routine model for heavy passes");
  assert.equal(override({ aiModelsByProvider: { grok: { routine: "grok-4", heavy: "grok-heavy" } } }, "heavy", "grok"), "grok-heavy");
  assert.equal(override({ aiModels: { routine: "global-routine" } }, "routine", "zai"), "global-routine", "the keyed HTTP routes keep the role-wide fallback");
});

for (const fallback of [false, true]) test(`planning ${fallback ? "records both attempts for opt-in" : "does not silently enable"} provider fallback`, async () => {
  const h = host({ aiProvider: "auto", zaiApiKeyEncrypted: "fixture", apiKeyEncrypted: "fixture", aiAutoFallback: fallback }, [
    { ok: false, status: 429, text: async () => "fixture quota exhausted" }, okReply(),
  ]);
  const result = await h.complete("spec");
  assert.equal(result.ok, fallback);
  assert.equal(h.calls.length, fallback ? 2 : 1);
  assert.equal(h.observations.length, fallback ? 2 : 1);
  assert.equal(h.observations[0].status, "error");
  assert.equal(h.observations[0].errorKind, "quota");
  assert.equal(h.observations[0].costUsd, null);
  if (fallback) {
    assert.equal(h.calls[1].body.model, "routine-go");
    assert.equal(h.calls[1].body.thinking, undefined);
    assert.equal(h.observations[1].provider, "opencode");
    assert.equal(h.observations[1].taskType, "planning-spec");
    assert.equal(h.observations[1].tokenUsage.totalTokens, 50);
  }
});

test("auto follows the saved provider order instead of a fixed preference", async () => {
  const reversed = host({ aiProvider: "auto", aiAutoProviders: ["opencode", "zai"], apiKeyEncrypted: "fixture", zaiApiKeyEncrypted: "fixture" });
  await reversed.complete("question");
  assert.equal(reversed.calls[0].endpoint, "https://opencode.invalid", "the first listed provider answers even when z.ai has a key");
  assert.equal(reversed.calls[0].body.model, "routine-go");
  const fallback = host({ aiProvider: "auto", aiAutoProviders: ["opencode", "zai"], apiKeyEncrypted: "fixture", zaiApiKeyEncrypted: "fixture", aiAutoFallback: true }, [
    { ok: false, status: 429, text: async () => "fixture quota exhausted" }, okReply(),
  ]);
  const result = await fallback.complete("spec");
  assert.equal(result.ok, true);
  assert.equal(fallback.calls.length, 2);
  assert.equal(fallback.calls[1].endpoint, "https://zai.invalid", "the fallback walk follows the same order");
  assert.equal(fallback.calls[1].body.model, "heavy-zai", "the heavy role is resolved per provider");
  assert.deepEqual(fallback.calls[1].body.thinking, { type: "enabled" }, "each fallback is shaped for its own provider");
});

test("the legacy aiFallbackOpenCode field still arms the generalized fallback", async () => {
  const h = host({ aiProvider: "auto", zaiApiKeyEncrypted: "fixture", apiKeyEncrypted: "fixture", aiFallbackOpenCode: true }, [
    { ok: false, status: 429, text: async () => "fixture quota exhausted" }, okReply(),
  ]);
  const result = await h.complete("spec");
  assert.equal(result.ok, true);
  assert.equal(h.calls.length, 2, "settings written before aiAutoFallback existed keep their fallback");
  assert.equal(h.calls[1].endpoint, "https://opencode.invalid");
});

test("auto can put a CLI route first and skips it while the binary is missing", async () => {
  const installed = host({ aiProvider: "auto", aiAutoProviders: ["grok", "zai"], zaiApiKeyEncrypted: "fixture" }, undefined, { clis: ["grok"] });
  const route = await installed.context.resolveAiRoute("routine");
  assert.equal(route.provider, "grok");
  assert.equal(route.cli, true);
  assert.equal(route.endpoint, null, "the CLI carries its own auth");
  const missing = host({ aiProvider: "auto", aiAutoProviders: ["grok", "zai"], zaiApiKeyEncrypted: "fixture" });
  const skipped = await missing.context.resolveAiRoute("routine");
  assert.equal(skipped.provider, "zai", "an absent CLI is skipped for the next usable provider");
});

test("an auto order with nothing usable names the list instead of a fixed pair", async () => {
  const h = host({ aiProvider: "auto", aiAutoProviders: ["custom", "lmstudio"] });
  const route = await h.context.resolveAiRoute("routine");
  assert.equal(route.ok, false);
  assert.match(route.error, /no usable provider in the auto order \(custom endpoint > LM Studio\)/);
});
