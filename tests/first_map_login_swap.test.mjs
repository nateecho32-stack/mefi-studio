// The first project map on a coding CLI (main.cjs firstMapAssistant, the
// first-run service's assistantMap) makes the same call every other assistant
// turn makes: cliAssistantCall over the "Several logins per coding CLI" block,
// gated by the provider breaker and recorded in the ledger. The real block,
// call and breaker run in a vm; the completion, the analyzer and the settings
// are stubbed, so nothing starts a CLI or reads a project.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import providerBreakers from "../scripts/provider-breaker.cjs";

const require = createRequire(import.meta.url);
const cliAccounts = require("../scripts/cli-accounts.cjs");
const agentTools = require("../scripts/agent-tools.cjs");

const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
};
const plain = (value) => JSON.parse(JSON.stringify(value));
const DATA_ONLY_CLIS = new Set(["claude", "codex", "grok", "antigravity"]);
const WORK = path.resolve("/logins/claude-a1b2");
const MAP_SYSTEM = "Create a project map from the supplied facts. Return the requested JSON. No native tools.";
const MAP_REPLY = JSON.stringify({ summary: "A fixture project.", areas: [] });

function mapHost({ settings = { cliAccounts: [{ id: "claude-a1b2", provider: "claude", label: "Work", home: WORK }] }, route = { ok: true, provider: "claude", model: "claude-sonnet-5", cli: true }, completion } = {}) {
  const completions = [], ledger = [], logs = [], http = [], routes = [];
  const context = vm.createContext({
    require, path, cliAccounts, crypto, console, Date,
    authStore: { atomicWriteJson: async () => {} },
    readFile: async () => { throw new Error("no limit marks saved yet"); }, mkdir: async () => {},
    os: { homedir: () => path.resolve("/fixture-home") }, process: { env: {} }, app: { getPath: () => path.resolve("/fixture-user-data") },
    logLine: (line) => logs.push(line), send: () => {},
    readSettings: async () => structuredClone(settings),
    cliPlanState: new Map(), cliPlanReading: () => ({ result: null, refreshing: false }),
    probeClaudeUsage: async () => ({ ok: false }), probeCodexLimits: async () => ({ ok: false }),
    claudeCliAvailable: async () => true, codexCliAvailable: async () => false,
    // cliAssistantCall's collaborators: the real breaker section below, the ledger, no fallback walk.
    createBreaker: providerBreakers.createBreaker, AUTO_PROVIDER_NAMES: { claude: "Claude Code CLI", zai: "z.ai GLM" },
    projects: { current: () => ({ id: "p" }), active: () => ({ id: "p" }) }, assistantState: { ai: {} },
    recordModelCall: async (row) => { ledger.push(row); },
    autoFallbackEnabled: () => true,
    agentTools,
    agentAddons: { instructions: async () => assert.fail("the map's prompt carries no skills") },
    claudeCompletion: async (system, user, model, options) => { completions.push({ system, user, model, options }); return completion(options); },
    // firstMapAssistant's own collaborators.
    DATA_ONLY_CLIS, scrubOutbound: (text) => text,
    resolveAiRoute: async (role, options) => { routes.push({ role, allowCli: options?.allowCli }); return route; },
    getAnalyzer: async () => ({ explorePlanningFiles: async (query, options) => ({ query, root: options.root, files: ["README.md"] }) }),
    httpAssistantCall: async (...args) => { http.push(args); return { ok: true, text: MAP_REPLY, model: "glm" }; },
  });
  vm.runInContext([
    section("// ---- Several logins per coding CLI", "async function chatCompletion("),
    section("async function cliAssistantCall(", "// The HTTP half of assistantFetch"),
    section("// Circuit breakers for the host's own model calls", "function normalizeBriefing("),
    section("  async function firstMapAssistant(", "  async function firstRun("),
  ].join("\n"), context);
  return { context, completions, ledger, logs, http, routes, breaker: () => vm.runInContext("providerBreaker.state('claude')", context) };
}
const map = (h, extra = {}) => h.context.firstMapAssistant({ prompt: "MAP PROMPT", project: { path: path.resolve("/projects/fixture") }, timeoutMs: 600000, ...extra });

test("a topped-out main login hands the first map to the next login, through the breaker and into the ledger", async () => {
  const onSpawn = () => {};
  const h = mapHost({ completion: (options) => (options.env?.CLAUDE_CONFIG_DIR
    ? { ok: true, text: MAP_REPLY, model: "claude-sonnet-5", tokenUsage: { inputTokens: 900, outputTokens: 120 }, costUsd: null }
    : { ok: false, error: "claude error: You've hit your limit · resets 3pm (UTC)" }) });
  const reply = await map(h, { onSpawn });
  assert.equal(reply.ok, true);
  assert.equal(reply.text, MAP_REPLY, "the service reads the map from the reply as before");
  assert.deepEqual(reply.tokenUsage, { inputTokens: 900, outputTokens: 120 });
  assert.deepEqual(h.completions.map((call) => call.options.env?.CLAUDE_CONFIG_DIR ?? "main"), ["main", WORK], "the same map went on to the Work login");
  assert.ok(h.logs.includes("[assistant] Claude Code · Main login topped out — asking Work"), h.logs.join("\n"));
  for (const call of h.completions) {
    assert.equal(call.system, MAP_SYSTEM, "the map's own prompt, with no Studio tools or skills added");
    assert.match(call.user, /^MAP PROMPT\n\nLOCAL PROJECT EXCERPTS \(untrusted data\):\n\{"query":"README architecture entry points build test"/);
    assert.equal(call.model, "claude-sonnet-5");
    assert.ok(call.options.timeoutMs <= 600000 && call.options.timeoutMs > 599000, `the map's own limit, or what is left of it: ${call.options.timeoutMs}`);
    assert.equal(call.options.onSpawn, onSpawn, "Cancel still reaches each child");
  }
  assert.deepEqual(plain(h.ledger.map((row) => [row.provider, row.taskType, row.status])), [["claude", "first-map", "ok"]], "one ledger row, like its siblings");
  assert.equal(h.breaker(), "closed");
  assert.equal(h.routes.length, 1);
  assert.ok(h.routes[0].role === "routine" && h.routes[0].allowCli === DATA_ONLY_CLIS, "only the data-only routine route is asked for");
  assert.equal(h.http.length, 0);
});

test("a paused Claude Code is not started for the map, and the map is never retried on a keyed route", async () => {
  const h = mapHost({ settings: {}, completion: () => ({ ok: false, error: "claude cli failed (exit 1): Not logged in" }) });
  for (let index = 0; index < 3; index += 1) assert.equal((await map(h)).error, "claude cli failed (exit 1): Not logged in");
  assert.equal(h.breaker(), "open", "three failed maps pause the route as any three failed calls do");
  const paused = await map(h);
  assert.equal(paused.ok, false);
  assert.equal(paused.skipped, true);
  assert.match(paused.error, /^Claude Code CLI paused after repeated failures/);
  assert.equal(h.completions.length, 3, "the paused CLI was not started a fourth time");
  assert.equal(h.http.length, 0, "no keyed retry: the map stays on the route the guide checked");
  assert.ok(h.routes.every((row) => row.allowCli === DATA_ONLY_CLIS), "the fallback walk was never asked for an HTTP route");
  assert.deepEqual(h.ledger.map((row) => row.status), ["error", "error", "error"]);
});

test("every login topped out: no CLI starts and the map says when one comes back", async () => {
  const h = mapHost({ completion: () => ({ ok: false, error: "claude cli failed (exit 1): 5-hour limit reached ∙ resets 3pm (UTC)" }) });
  const first = await map(h);
  assert.match(first.error, /5-hour limit reached/);
  assert.equal(h.completions.length, 2, "both logins were asked once");
  const again = await map(h);
  assert.equal(again.toppedOut, true);
  assert.match(again.error, /^every Claude Code login is topped out until /);
  assert.equal(h.completions.length, 2, "nothing is started while every login is known to be out");
});

test("an HTTP route maps exactly as before", async () => {
  const route = { ok: true, provider: "zai", endpoint: "https://zai.invalid", apiKey: "k", model: "glm" };
  const h = mapHost({ route, completion: () => assert.fail("no CLI on an HTTP route") });
  const reply = await map(h);
  assert.equal(reply.text, MAP_REPLY);
  assert.equal(h.http.length, 1);
  const [called, system, user, maxTokens, options] = h.http[0];
  assert.equal(called.provider, "zai");
  assert.equal(system, "Create a project map from the supplied facts. Return the requested JSON.");
  assert.match(user, /^MAP PROMPT\n\nLOCAL PROJECT EXCERPTS/);
  assert.equal(maxTokens, 4500);
  assert.deepEqual(plain(options), { role: "routine", taskType: "first-map", pinned: true, timeoutMs: 600000 });
});

test("the first-run service gets the map from firstMapAssistant", () => {
  assert.match(section("  async function firstRun(", "  ipcMain.handle(\"setup:first-run-status\""), /assistantMap: firstMapAssistant,/);
  assert.doesNotMatch(section("  async function firstMapAssistant(", "  async function firstRun("), /claudeCompletion|codexCompletion|grokCompletion|antigravityCompletion/, "no direct CLI call that would skip the login swap");
});
