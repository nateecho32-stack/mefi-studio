import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import path from "node:path";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { normalizeObservation } from "../scripts/model-performance.cjs";

// Run the real planning host callback through route selection, HTTP shaping,
// fallback and observation with fake settings/transport. No keys or live stores.
const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
}
const okReply = () => ({ ok: true, json: async () => ({ model: "reported-model", usage: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 }, choices: [{ message: { content: "Planning reply" } }] }) });
function host(settings, responses = [okReply()]) {
  const calls = [], observations = [], admitted = [], wakes = [], project = { id: "fixture", path: "/fixture" };
  const context = vm.createContext({
    path, crypto, AbortController, setTimeout, clearTimeout,
    STUDIO_ROOT: "/studio", projects: { current: () => project, active: () => project }, projectDataPath: (value) => value,
    createPlanningStore: () => ({}), createPlanningService: (options) => options,
    jevShadowIntake: (tasks) => { admitted.push(structuredClone(tasks)); return new Promise(() => {}); },
    ensureAssistant: async () => {}, refreshAutopilotQueue: async () => {}, assistantAskForWork: (reason) => wakes.push(reason),
    mutateBoard() { throw new Error("Model suggestions must not create tasks"); },
    AI_PROVIDERS: ["auto", "zai", "opencode", "grok"],
    ASSISTANT_ENDPOINT: "https://opencode.invalid", ZAI_ENDPOINT: "https://zai.invalid",
    ASSISTANT_MODEL: "routine-go", ZAI_MODEL_ROUTINE: "routine-zai", ZAI_MODEL_HEAVY: "heavy-zai",
    readSettings: async () => structuredClone(settings), decryptKey: (value, key) => value[key] ? `fixture-${key}` : null,
    applyModelRouting: async (route) => route,
    assistantState: { ai: {} }, assistantSessionId: async () => "fixture-session",
    fetch: async (endpoint, options) => { calls.push({ endpoint, options, body: JSON.parse(options.body) }); return responses.shift() ?? okReply(); },
    recordModelCall: async (observation) => { observations.push(normalizeObservation(observation)); },
  });
  vm.runInContext([
    section("function assistantModelOverride(", "const modelPerformanceStores"),
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

for (const fallback of [false, true]) test(`planning ${fallback ? "records both attempts for opt-in" : "does not silently enable"} provider fallback`, async () => {
  const h = host({ aiProvider: "auto", zaiApiKeyEncrypted: "fixture", apiKeyEncrypted: "fixture", aiFallbackOpenCode: fallback }, [
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
