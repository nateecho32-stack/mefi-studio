// A team held to one subscription by "Use for the whole studio" keeps Jev's
// intake and work shaping on that subscription: the assistant stand-in
// answers (main.cjs jevSubscriptionOnly, runJevIntake, classifyPendingWork,
// standInJudge), and a Jev key in the environment or in Settings is never
// used for it. Other teams keep Jev exactly as before. The real host region
// runs in a vm with isolated stores and fake judges; nothing reaches a
// provider.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import backlog from "../scripts/backlog.cjs";
import workAdmission from "../scripts/work-admission.cjs";
import cliSetup from "../scripts/cli-setup.cjs";
import * as decisionClient from "../scripts/decision-client.mjs";
import * as workClassification from "../scripts/work-classification.mjs";
import * as choiceJudge from "../scripts/choice-judge.mjs";
import { planIntake } from "../scripts/jev-loop.mjs";

const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
};
const plain = (value) => JSON.parse(JSON.stringify(value));
const incoming = { title: "Fix scheduler startup delay", prompt: "Fix scheduler startup delay on launch", source: "chat", at: 1 };
const existing = { id: "existing", title: "Reduce scheduler startup delay", status: "open", createdAt: 1 };
// Keys in every place Jev reads them: the environment and Settings.
const ENV_KEYS = { AI_GATEWAY_API_KEY: "env-gateway-key", TYPESAFE_API_KEY: "env-typesafe-key", OPENCODE_ZEN_API_KEY: "env-zen-key", OPENROUTER_API_KEY: "env-openrouter-key" };
const DEVICE = { jevRoute: "vercel", gatewayApiKeyEncrypted: "saved", jevApiKeyEncrypted: "saved", firstRun: { judge: { kind: "opencode-free", model: "opencode/free-model" } } };

function host({ team, settings = DEVICE, env = ENV_KEYS, tasks = [existing] } = {}) {
  const jev = [], standIns = [], judged = [], charges = [], ledger = [], records = [];
  const client = {
    ...decisionClient,
    resolveJevRoute: (saved) => decisionClient.resolveJevRoute(saved, env),
    resolveApiKey: (options) => decisionClient.resolveApiKey({ ...options, env }),
    gatewayConfig: (options = {}) => decisionClient.gatewayConfig({ ...options, env }),
    classify: async (options) => { jev.push(options); return { ok: true, answers: { rel_0: { choice: "same_obligation" } }, usage: { modelCalls: 1, promptTokens: 10, completionTokens: 1 }, elapsedMs: 3, model: "typesafe-ai/jev" }; },
  };
  const context = vm.createContext({
    console, workAdmission, backlog, autopilot: { autoBuild: true },
    projects: { current: () => ({ id: "fixture" }), run: (_project, fn) => fn(), stamp: (row) => row },
    SMOKE: false, CAPTURE: false, CLI_MODE: false,
    REQUESTS_PATH: "requests", TASKS_PATH: "tasks", POLICY_BUDGET_PATH: "budget",
    readSettings: async () => structuredClone(settings),
    readAgentSettings: async () => structuredClone(team),
    decryptKey: () => "saved-key-plaintext",
    loadModule: async (name) => {
      if (name === "scripts/decision-client.mjs") return client;
      if (name === "scripts/work-classification.mjs") return workClassification;
      if (name === "scripts/jev-loop.mjs") return { planIntake, createJevQueue: () => ({ enqueue() {}, status: () => ({}) }) };
      throw new Error(`unexpected module ${name}`);
    },
    getEyes: async () => ({ readJson: async (name) => structuredClone(name === "requests" ? [incoming] : tasks) }),
    getExperienceModule: async () => ({ spendBudget: async (_file, entry) => { charges.push(entry); } }),
    policyRecord: (kind, entry) => records.push({ kind, ...entry }),
    assistantClip: (value, max) => String(value ?? "").slice(0, max), logLine() {},
    crypto: { randomUUID: () => "row" }, recordModelCall: async (row) => { ledger.push(row); },
    // The stand-in judge, observed: which provider it was asked to stay on, and its answers.
    standInJudge: async (_settings, purpose, options) => {
      standIns.push({ purpose, options: plain(options ?? {}) });
      return { kind: "assistant", model: null, timeoutMs: 15000, classify: async (args) => {
        judged.push(args);
        const shape = args.questions.some((question) => question.id === "work_intent");
        return { ok: true, answers: shape ? { work_intent: { choice: "implement" }, work_complexity: { choice: "systemic" } } : { rel_0: { choice: "same_obligation" } }, usage: { modelCalls: 1 }, elapsedMs: 4, model: "claude" };
      } };
    },
  });
  vm.runInContext(section("// Jev classifies admitted observations", "const PINS_PATH"), context);
  return { context, jev, standIns, judged, charges, ledger, records };
}

test("a team on one subscription keeps Jev intake on it, whatever keys the environment or Settings hold", async () => {
  for (const provider of ["claude", "codex", "grok", "antigravity"]) {
    const h = host({ team: cliSetup.singleProvider({}, provider) });
    assert.deepEqual(plain(await h.context.runJevIntake([incoming])), { ok: true, attempted: true, proposals: 1 }, provider);
    assert.equal(h.jev.length, 0, `${provider}: no Jev route was called`);
    assert.deepEqual(h.standIns, [{ purpose: "intake", options: { provider } }], "the stand-in is asked to stay on the subscription");
    assert.equal(h.judged.length, 1);
    assert.equal(h.records[0].answer, "same_obligation", "its proposal is recorded the same way");
    assert.equal(h.charges.length + h.ledger.length, 0, "a stand-in call is not a Jev charge");
  }
});

test("work shaping on one subscription asks the stand-in, never a Jev key", async () => {
  const tasks = [2, 1].map((n) => ({ id: `task-${n}`, title: `Work ${n}`, status: "open", createdAt: n }));
  const h = host({ team: cliSetup.singleProvider({}, "codex"), tasks });
  assert.deepEqual(plain(await h.context.classifyPendingWork()), { ok: true, attempted: true, shaped: 2 });
  assert.equal(h.jev.length, 0);
  assert.deepEqual(h.standIns, [{ purpose: "intake", options: { provider: "codex" } }]);
  assert.equal(h.judged.length, 2);
  assert.equal(h.charges.length + h.ledger.length, 0);
});

test("a team that is not held to one subscription keeps Jev and its keys as before", async () => {
  const single = cliSetup.singleProvider({}, "claude");
  for (const [why, team] of [
    ["fallbacks allowed", { ...single, aiAutoFallback: true }],
    ["two providers in the order", { ...single, aiAutoProviders: ["claude", "zen"] }],
    ["builders on another tool", { ...single, executorCli: "opencode" }],
    ["a team never set up", {}],
  ]) {
    const h = host({ team });
    assert.equal((await h.context.runJevIntake([incoming])).proposals, 1, why);
    assert.equal(h.jev.length, 1, `${why}: Jev answers`);
    assert.equal(h.jev[0].apiKey, "env-gateway-key", `${why}: on the route's own key, as before`);
    assert.equal(h.standIns.length, 0, why);
  }
  // With no key at all the stand-in the first run saved still answers, on its own kind.
  const keyless = host({ team: {}, env: {}, settings: { firstRun: { judge: { kind: "assistant" } } } });
  await keyless.context.runJevIntake([incoming]);
  assert.deepEqual(keyless.standIns, [{ purpose: "intake", options: { provider: null } }]);
  assert.equal(keyless.jev.length, 0);
});

test("jevSubscriptionOnly names the subscription only for a team held to it", async () => {
  const ask = async (team) => host({ team }).context.jevSubscriptionOnly();
  assert.equal(await ask(cliSetup.singleProvider({ executorModels: { claude: "opus" } }, "claude")), "claude");
  assert.equal(await ask({ aiAutoFallback: false, aiAutoProviders: ["grok"], executorCli: "grok" }), "grok");
  assert.equal(await ask({ aiAutoFallback: false, aiAutoProviders: ["opencode"], executorCli: "opencode" }), null, "OpenCode is not a subscription CLI");
  assert.equal(await ask({ aiAutoProviders: ["claude"], executorCli: "claude" }), null, "fallback not switched off");
  assert.equal(await ask(null), null);
});

test("the stand-in held to a subscription is the assistant, whatever judge the first scan saved", async () => {
  const modules = [], fetched = [];
  const context = vm.createContext({
    loadModule: async (name) => { modules.push(name); return name === "scripts/choice-judge.mjs" ? choiceJudge : assert.fail(`no ${name} for a held team`); },
    assistantFetch: async (_system, _user, _maxTokens, options) => { fetched.push(options); return { ok: true, text: JSON.stringify({ answers: { rel_0: { choice: "unrelated" } } }), model: "claude" }; },
  });
  vm.runInContext(section("async function standInJudge(", "async function applyModelRouting("), context);
  assert.equal(await context.standInJudge({}, "intake"), null, "no judge saved and no subscription: none, as before");
  for (const settings of [{}, { firstRun: { judge: { kind: "opencode-free", model: "opencode/free-model" } } }, { firstRun: { judge: { kind: "fixed" } } }]) {
    const judge = await context.standInJudge(settings, "intake", { provider: "claude" });
    assert.equal(judge.kind, "assistant");
    assert.equal(judge.timeoutMs, 15000);
    const result = await judge.classify({ questions: [{ id: "rel_0", type: "choice", prompt: "How does the new request relate to the open card?", options: ["same_obligation", "unrelated"] }], state: { request: "Fix the scheduler" } });
    assert.equal(result.ok, true);
  }
  assert.deepEqual([...new Set(modules)], ["scripts/choice-judge.mjs"], "the free OpenCode judge is never loaded for a held team");
  assert.ok(fetched.every((options) => options.role === "routine" && options.taskType === "judge"), "it rides the team's routine route: the subscription");
});

test("per-task routing has no stand-in on a coding CLI, which cannot answer in its 4 s", async () => {
  let route = { ok: true, provider: "claude", cli: true };
  const context = vm.createContext({
    loadModule: async () => choiceJudge,
    resolveAiRoute: async () => route,
    assistantFetch: async () => assert.fail("no routing question reaches a CLI"),
  });
  vm.runInContext(section("async function standInJudge(", "async function applyModelRouting("), context);
  const saved = { firstRun: { judge: { kind: "assistant" } } };
  assert.equal(await context.standInJudge(saved, "routing"), null);
  assert.equal((await context.standInJudge(saved, "intake")).timeoutMs, 15000, "intake keeps its 15 s stand-in on the CLI");
  route = { ok: true, provider: "zen", model: "gpt-6-luna" };
  assert.equal((await context.standInJudge(saved, "routing")).timeoutMs, 4000, "a keyed route still answers routing");
});
