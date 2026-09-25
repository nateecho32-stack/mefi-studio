import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { executorHost } from "./fixtures/host_executor.mjs";
import providerBreakers from "../scripts/provider-breaker.cjs";

// Execute the real host selection, cache, transport wiring and worker claim
// boundary. The classifier and all filesystem/process boundaries are fixtures;
// these checks never read live settings, contact a provider or launch a worker.
const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host boundary: ${start}`);
  return source.slice(from, to);
};
const copy = (value) => structuredClone(value);
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const normalRoute = (provider = "zai") => ({ ok: true, provider, model: "glm-5.3-flash", endpoint: `https://${provider}.invalid`, apiKey: "fixture-generation-key", fallback: null });
const selectedResult = () => ({ ok: true, model: "glm-5.3", evidence: { samples: 4, latencyMs: 900 } });

function routingHost({ initialSettings = {}, credential = "fixture-jev-key", candidateList = null, select = null, flush = null } = {}) {
  let settings = { aiProvider: "auto", modelSelection: "jev", ...initialSettings };
  let currentProject = "project-a", now = 1000;
  const attempts = [], charges = [], evidenceReads = [], candidateRequests = [], calls = [], logs = [];
  const client = {
    resolveApiKey: () => credential ? { key: credential } : null,
    resolveJevRoute: () => "vercel",
    JEV_ROUTES: { vercel: { label: "Vercel AI Gateway" } },
    gatewayConfig: () => ({ model: "typesafe-ai/jev", timeoutMs: 50, maxStateChars: 8000 }),
  };
  const router = {
    buildRoutingCandidates: (options) => {
      candidateRequests.push(copy(options));
      return candidateList ?? [
        { provider: options.provider, model: "glm-5.3-flash", evidence: { samples: 1 } },
        { provider: options.provider, model: "glm-5.3", evidence: { samples: 4 } },
      ];
    },
    selectTaskModel: async (options) => {
      attempts.push(options);
      const result = select ? await select(options) : selectedResult();
      await options.onUsage({ modelCalls: 1, promptTokens: 30, completionTokens: 1 },
        { ...result, usage: { modelCalls: 1, promptTokens: 30, completionTokens: 1 }, model: "typesafe-ai/jev" });
      return result;
    },
  };
  const context = vm.createContext({
    crypto, path, Date: class extends Date { static now() { return now; } },
    // The real breaker, one per host: httpAssistantCall gates every call on it.
    createBreaker: providerBreakers.createBreaker, AUTO_PROVIDER_NAMES: {},
    STUDIO_ROOT: path.resolve("fixture-studio"), SMOKE: false, CAPTURE: false, CLI_MODE: false,
    ZAI_MODEL_ROUTINE: "glm-5.3-flash", ZAI_MODEL_HEAVY: "glm-5.3",
    projects: { current: () => ({ id: currentProject }), active: () => ({ id: currentProject }) },
    readSettings: async () => copy(settings), decryptKey: () => assert.fail("fixture client never decrypts credentials"),
    loadModule: async (name) => {
      if (name === "scripts/decision-client.mjs") return client;
      assert.equal(name, "scripts/model-routing.mjs");
      return router;
    },
    readFile: async (file) => {
      assert.equal(file, path.join(path.resolve("fixture-studio"), "data", "models.json"));
      evidenceReads.push(file);
      return JSON.stringify({ models: [], source: "fixture catalog" });
    },
    modelPerformanceStore: () => ({ snapshot: async () => ({ models: [], project: currentProject }) }),
    flushJevCharges: async () => { if (flush) await flush(); },
    chargeJevCall: async (result, kind) => charges.push({ result: copy(result), kind }),
    logLine: (message) => logs.push(message),
    assistantState: { ai: {} }, assistantSessionId: async () => "fixture-session",
    chatCompletion: async (endpoint, apiKey, model, body, options) => {
      calls.push(copy({ endpoint, apiKey, model, body, options }));
      return { ok: true, model, text: "Fixture answer" };
    },
  });
  vm.runInContext([
    section("const SINGLE_MODEL_PROVIDERS =", "// The assistant's model"),
    section("function assistantModelOverride(", "// Pick who pays"),
    section("const modelRoutingDecisions =", "async function recordModelCall("),
    section("async function httpAssistantCall(", "function normalizeBriefing("),
  ].join("\n"), context);
  return {
    context, attempts, charges, evidenceReads, candidateRequests, calls, logs,
    route: (options = {}, route = normalRoute()) => context.applyModelRouting(route, options),
    settings: (patch) => { settings = { ...settings, ...patch }; },
    project: (id) => { currentProject = id; }, advance: (ms) => { now += ms; },
    decision: (id = currentProject) => vm.runInContext(`modelRoutingDecisions.get(${JSON.stringify(id)})`, context),
  };
}

test("fixed defaults, explicit overrides and missing Jev credentials do not spend selection calls", async () => {
  const fixed = routingHost({ initialSettings: { modelSelection: "fixed" } });
  assert.equal((await fixed.route()).routingDecision.method, "default");
  const manual = routingHost({ initialSettings: { aiModels: { routine: "manual-model" } } });
  const manualRoute = { ...normalRoute(), model: "manual-model" };
  assert.equal((await manual.route({}, manualRoute)).model, "manual-model");
  assert.equal(manual.decision().method, "override");
  const unconfigured = routingHost({ credential: null });
  assert.match((await unconfigured.route()).routingDecision.reason, /Jev key/i);
  for (const host of [fixed, manual, unconfigured]) {
    assert.equal(host.attempts.length, 0);
    assert.equal(host.charges.length, 0);
    assert.equal(host.evidenceReads.length, 0);
  }
});

test("Jev receives task context and measured evidence and the host retains provider credentials", async () => {
  const host = routingHost();
  const route = normalRoute();
  const result = await host.route({ role: "heavy", taskType: "planning-spec", task: "private task context" }, route);
  assert.equal(result.model, "glm-5.3");
  assert.equal(result.provider, route.provider);
  assert.equal(result.endpoint, route.endpoint);
  assert.equal(result.apiKey, route.apiKey);
  assert.equal(result.routingDecision.method, "jev");
  assert.equal(host.attempts[0].task, "private task context");
  assert.equal(host.attempts[0].role, "heavy");
  assert.equal(host.attempts[0].taskType, "planning-spec");
  assert.equal(host.candidateRequests[0].performance.project, "project-a");
  assert.equal(host.charges.length, 1);
  assert.equal(host.charges[0].kind, "jev-model-routing");
  assert.equal(host.charges[0].result.usage.modelCalls, 1);
  assert.doesNotMatch(JSON.stringify(host.decision()), /private task context|fixture-generation-key|fixture-jev-key/);
  assert.doesNotMatch(host.logs.join("\n"), /private task context|fixture-generation-key|fixture-jev-key/);
});

test("out-of-pool and foreign-provider choices cannot replace the original model", async () => {
  for (const candidateList of [
    [{ provider: "zai", model: "glm-5.3-flash" }, { provider: "zai", model: "another-model" }],
    [{ provider: "zai", model: "glm-5.3-flash" }, { provider: "opencode", model: "glm-5.3" }],
  ]) {
    const host = routingHost({ candidateList });
    const result = await host.route();
    assert.equal(result.model, "glm-5.3-flash");
    assert.equal(result.routingDecision.method, "default");
    assert.equal(host.charges.length, 1, "a rejected paid answer remains chargeable");
  }
});

test("failed or timed-out selection falls back, charges its attempt, and backs off", async () => {
  const host = routingHost({ select: async () => ({ ok: false, error: "timed out after 50ms" }) });
  const first = await host.route();
  assert.equal(first.model, "glm-5.3-flash");
  assert.equal(first.routingDecision.method, "default");
  assert.equal(host.charges.length, 1);
  assert.equal(host.charges[0].result.ok, false);
  const second = await host.route({ task: "a different task" });
  assert.match(second.routingDecision.reason, /temporarily unavailable/i);
  assert.equal(host.attempts.length, 1, "backoff applies across task descriptions in one route scope");
  host.advance(30001);
  await host.route();
  assert.equal(host.attempts.length, 2);
  assert.equal(host.charges.length, 2);
});

test("pending accounting prevents another paid classifier request", async () => {
  const host = routingHost({ flush: async () => { throw new Error("fixture accounting pending"); } });
  assert.equal((await host.route()).model, "glm-5.3-flash");
  assert.equal(host.attempts.length, 0);
  assert.equal(host.charges.length, 0);
});

test("identical in-flight selections coalesce and the successful answer is cached", async () => {
  const started = deferred(), answer = deferred();
  const host = routingHost({ select: async () => { started.resolve(); return answer.promise; } });
  const a = host.route({ task: "same task" });
  const b = host.route({ task: "same task" });
  await started.promise;
  answer.resolve(selectedResult());
  assert.deepEqual((await Promise.all([a, b])).map((row) => row.model), ["glm-5.3", "glm-5.3"]);
  await host.route({ task: "same task" });
  assert.equal(host.attempts.length, 1);
  assert.equal(host.charges.length, 1);
  host.advance(5 * 60000 + 1);
  await host.route({ task: "same task" });
  assert.equal(host.attempts.length, 2, "expired evidence choices are reconsidered");
});

test("project caches and decision status remain isolated", async () => {
  const host = routingHost();
  await host.route({ task: "same task" });
  host.project("project-b");
  assert.equal(host.decision(), undefined);
  await host.route({ task: "same task" });
  assert.equal(host.attempts.length, 2, "another project's task cannot reuse this project's decision");
  host.project("project-a");
  await host.route({ task: "same task" });
  assert.equal(host.attempts.length, 2);
  assert.equal(host.decision("project-a").model, "glm-5.3");
  assert.equal(host.decision("project-b").model, "glm-5.3");
});

test("a settings change during selection rejects the old answer", async () => {
  const started = deferred(), answer = deferred();
  const host = routingHost({ select: async () => { started.resolve(); return answer.promise; } });
  const pending = host.route();
  await started.promise;
  host.settings({ modelSelection: "fixed" });
  answer.resolve(selectedResult());
  const result = await pending;
  assert.equal(result.model, "glm-5.3-flash");
  assert.equal(result.routingDecision.method, "default");
  assert.match(result.routingDecision.reason, /settings changed/i);
  assert.equal(host.charges.length, 1);
  await host.route();
  assert.equal(host.attempts.length, 1);
});

test("a project switch during selection cannot write status into the new project", async () => {
  const started = deferred(), answer = deferred();
  const host = routingHost({ select: async () => { started.resolve(); return answer.promise; } });
  const pending = host.route();
  await started.promise;
  host.project("project-b");
  answer.resolve(selectedResult());
  await pending;
  assert.equal(host.decision("project-b"), undefined);
  assert.equal(host.decision("project-a").model, "glm-5.3");
});

test("HTTP transport uses Jev's selected model with the request's role, task type and user context", async () => {
  const host = routingHost();
  const result = await host.context.httpAssistantCall(normalRoute(), "system instructions", "private user request", 7000,
    { taskType: "planning-spec", source: "planning", role: "heavy" });
  assert.equal(result.model, "glm-5.3");
  assert.equal(host.attempts[0].role, "heavy");
  assert.equal(host.attempts[0].taskType, "planning-spec");
  assert.equal(host.attempts[0].task, "private user request");
  assert.equal(host.calls.length, 1);
  const request = host.calls[0];
  assert.equal(request.model, "glm-5.3");
  assert.equal(request.body.model, "glm-5.3");
  assert.equal(request.body.reasoning_effort, "low");
  assert.equal(request.body.max_tokens, 7000);
  assert.equal(request.body.thinking.type, "enabled");
  assert.equal(request.options.taskType, "planning-spec");
  assert.equal(request.options.source, "planning");
  assert.equal(request.apiKey, "fixture-generation-key", "Jev credentials never authorize the generation request");
});

// The Auto-tier OpenCode Go route executorRunEnv hands the dispatcher: the Go
// default, marked for per-task routing, on the prefix `opencode models` lists.
const goRoute = () => ({ cli: "opencode", modelProvider: "opencode", model: "deepseek-v4.1-flash", via: "opencode-go/deepseek-v4.1-flash", modelArgs: " --model opencode-go/deepseek-v4.1-flash", env: {} });

function managedWorker(route = { cli: "opencode", modelProvider: "zai", model: "glm-5.3-flash", via: "mefi-zai/glm-5.3-flash", modelArgs: " --model mefi-zai/glm-5.3-flash", env: {} }) {
  const host = executorHost({ tasks: [{ id: "task-a", title: "Fix parser", prompt: "Preserve escaped strings", status: "open", source: "manual", createdAt: 1 }] });
  const commands = [];
  host.env.ZAI_MODEL_ROUTINE = "glm-5.3-flash";
  host.env.ZAI_MODEL_HEAVY = "glm-5.3";
  host.env.workShapeFor = () => null;
  host.env.executorRunEnv = async () => route;
  const spawn = host.env.spawn;
  host.env.spawn = (command, args, options) => { commands.push({ command, args: copy(args) }); return spawn(command, args, options); };
  return { ...host, route, commands };
}

test("managed z.ai worker selection sees the selected task before claiming and controls the launch model", async () => {
  const host = managedWorker(), selections = [];
  host.env.applyModelRouting = async (route, options) => {
    assert.equal(host.board().tasks[0].status, "open");
    assert.equal(host.autopilot.jobs.length, 0);
    selections.push(copy({ route, options }));
    // The real selection reports the candidates it offered the router.
    return { ...route, model: "glm-5.3", routingCandidates: ["glm-5.3-flash", "glm-5.3"] };
  };
  assert.equal(await host.env.spawnNextJob(), "spawned");
  assert.equal(selections.length, 1);
  assert.equal(selections[0].options.worker, true);
  assert.equal(selections[0].options.taskType, "coding");
  assert.equal(selections[0].options.weight, null, "an unshaped task is routed the way it always has been");
  assert.match(selections[0].options.task, /Fix parser[\s\S]*Preserve escaped strings/);
  assert.equal(host.commands[0].args.at(-1), "opencode run --auto --model mefi-zai/glm-5.3");
  assert.equal(host.board().tasks[0].status, "active");
});

test("a deep work shape reaches the dispatcher's selection call", async () => {
  const host = managedWorker(), selections = [];
  // What classifyPendingWork cached for this task on an earlier tick.
  host.env.workShapeFor = (taskId) => (taskId === "task-a" ? { intent: "implement", complexity: "systemic", weight: "deep", role: "heavy" } : null);
  host.env.applyModelRouting = async (route, options) => { selections.push(copy(options)); return { ...route, model: "glm-5.3" }; };
  assert.equal(await host.env.spawnNextJob(), "spawned");
  assert.equal(selections[0].weight, "deep", "systemic implementation must not be priced as routine work");
  // The routing key is the kind of work (its classified intent): the same key
  // the attempt is recorded under, so the judge weighs each model's record on
  // implementation work. The complexity still travels only as the weight.
  assert.equal(selections[0].taskType, "coding-implement", "routing asks about the kind of work the ledger keys its wins by");
});

// The half the stub above cannot prove: the real selection has to carry that
// weight to the judge. It used to be passed as a `role`, and applyModelRouting
// overwrites the role with "worker" for every dispatch — so the classification
// was bought and then dropped, and this suite could not see it because it
// stubbed the function that did the dropping.
test("worker selection carries the work weight to the judge and still asks for a tool-capable shortlist", async () => {
  const shaped = routingHost();
  await shaped.route({ worker: true, taskType: "coding", weight: "deep", task: "Rework the board contract" });
  assert.equal(shaped.candidateRequests[0].role, "worker", "the shortlist still filters on tool-calling");
  assert.equal(shaped.attempts[0].role, "worker");
  assert.equal(shaped.attempts[0].weight, "deep", "the judge is told how heavy the work is");

  const unshaped = routingHost();
  await unshaped.route({ worker: true, taskType: "coding", task: "Rework the board contract" });
  assert.equal(unshaped.attempts[0].weight ?? null, null, "an unclassified job reads to the judge as it always did");
});

test("the work weight does not split the routing cache when nothing changed", async () => {
  const host = routingHost();
  const options = { worker: true, taskType: "coding", weight: "deep", task: "Rework the board contract" };
  await host.route({ ...options });
  await host.route({ ...options });
  assert.equal(host.attempts.length, 1, "the same shaped task must not be re-judged");
  await host.route({ ...options, weight: "light" });
  assert.equal(host.attempts.length, 2, "a genuinely different weight is a different question");
});

// An explicit Free/Fast/Heavy tier pins the model in executorRunEnv and never
// sets modelProvider, so a shape cannot reach the selection at all.
test("a pinned tier never lets the work shape choose its model", async () => {
  const host = managedWorker();
  // The shape may still name the kind of work for the ledger; it can never
  // move a pinned tier off its model.
  host.env.workShapeFor = () => ({ intent: "implement", complexity: "systemic", weight: "deep", role: "heavy" });
  host.env.executorRunEnv = async () => ({ cli: "opencode", model: "mefi-zai/glm-5.3-flash", modelArgs: " --model mefi-zai/glm-5.3-flash", tier: "fast", env: {} });
  host.env.applyModelRouting = async () => { throw new Error("a pinned tier must not route per task"); };
  assert.equal(await host.env.spawnNextJob(), "spawned");
  assert.equal(host.commands[0].args.at(-1), "opencode run --auto --model mefi-zai/glm-5.3-flash", "the owner's dial is authoritative");
});

for (const interruption of ["pause", "scope"]) test(`${interruption} during worker model selection prevents a stale task launch`, async () => {
  const host = managedWorker(), started = deferred(), answer = deferred();
  host.env.applyModelRouting = async (route) => { started.resolve(); await answer.promise; return { ...route, model: "glm-5.3" }; };
  const pending = host.env.spawnNextJob();
  await started.promise;
  if (interruption === "pause") host.state.status = "paused";
  else host.edit((board) => { board.tasks[0].prompt = "New requirements"; });
  answer.resolve();
  assert.equal(await pending, "lost");
  assert.equal(host.commands.length, 0);
  assert.equal(host.starts.length, 0);
  assert.equal(host.board().tasks[0].status, "open");
  assert.equal(host.autopilot.jobs.length, 0);
  assert.equal(host.registry.size, 0);
});

test("worker command building refuses a selection outside the managed provider's model allowlist", async () => {
  const host = managedWorker();
  host.env.applyModelRouting = async (route) => ({ ...route, model: "glm-5.3 & unwanted-command" });
  assert.equal(await host.env.spawnNextJob(), "spawned");
  assert.equal(host.commands[0].args.at(-1), "opencode run --auto --model mefi-zai/glm-5.3-flash");
  // Even an id the router listed must still read as a bare model id.
  const listed = managedWorker();
  listed.env.applyModelRouting = async (route) => ({ ...route, model: "glm-5.3 & unwanted-command", routingCandidates: ["glm-5.3-flash", "glm-5.3 & unwanted-command"] });
  assert.equal(await listed.env.spawnNextJob(), "spawned");
  assert.equal(listed.commands[0].args.at(-1), "opencode run --auto --model mefi-zai/glm-5.3-flash");
});

test("a z.ai pick the router was not offered never reaches the command line", async () => {
  const host = managedWorker(), selections = [];
  // glm-5.3 is a real z.ai model, but this router was only given the default.
  host.env.applyModelRouting = async (route) => { selections.push(route.model); return { ...route, model: "glm-5.3", routingCandidates: ["glm-5.3-flash"] }; };
  assert.equal(await host.env.spawnNextJob(), "spawned");
  assert.deepEqual(selections, ["glm-5.3-flash"]);
  assert.equal(host.commands[0].args.at(-1), "opencode run --auto --model mefi-zai/glm-5.3-flash");
});

// ---- OpenCode Go: the Auto builder picks among the Go roster -------------------------

test("an OpenCode Go worker is routed per task and launches on the verified opencode-go prefix", async () => {
  const host = managedWorker(goRoute()), selections = [];
  host.env.workShapeFor = (taskId) => (taskId === "task-a" ? { intent: "implement", complexity: "focused", weight: "balanced", role: "routine" } : null);
  host.env.applyModelRouting = async (route, options) => {
    assert.equal(host.board().tasks[0].status, "open", "routing happens before the claim");
    selections.push(copy({ route, options }));
    return { ...route, model: "kimi-k2.6", routingCandidates: ["deepseek-v4.1-flash", "kimi-k2.6", "glm-5.3"] };
  };
  assert.equal(await host.env.spawnNextJob(), "spawned");
  assert.equal(selections.length, 1);
  assert.deepEqual(selections[0].route, { ok: true, provider: "opencode", model: "deepseek-v4.1-flash" }, "the router is asked about the Go roster, from the Go default");
  assert.equal(selections[0].options.worker, true);
  assert.equal(selections[0].options.taskType, "coding-implement", "the same work-kind key the attempt is recorded under");
  assert.equal(selections[0].options.weight, "balanced");
  assert.equal(host.commands[0].args.at(-1), "opencode run --auto --model opencode-go/kimi-k2.6");
  assert.equal(host.route.model, "kimi-k2.6", "the attempt carries the bare roster id the ledger files it under");
  assert.equal(host.route.via, "opencode-go/kimi-k2.6");
});

test("an out-of-set OpenCode Go pick never reaches the command line", async () => {
  for (const reply of [
    { model: "kimi-k3", routingCandidates: ["deepseek-v4.1-flash", "kimi-k2.6"] },
    { model: "opencode-go/kimi-k2.6", routingCandidates: ["deepseek-v4.1-flash", "kimi-k2.6"] },
    { model: "kimi-k2.6 && calc", routingCandidates: ["deepseek-v4.1-flash", "kimi-k2.6 && calc"] },
    { model: "kimi-k2.6" },
  ]) {
    const host = managedWorker(goRoute());
    let asked = 0;
    host.env.applyModelRouting = async (route) => { asked += 1; return { ...route, ...reply }; };
    assert.equal(await host.env.spawnNextJob(), "spawned");
    assert.equal(asked, 1, "the Go route is routed");
    assert.equal(host.commands[0].args.at(-1), "opencode run --auto --model opencode-go/deepseek-v4.1-flash", JSON.stringify(reply));
  }
});

test("a pinned OpenCode model never lets the work shape choose its model", async () => {
  const pinned = { cli: "opencode", model: "opencode-go/kimi-k2.6", modelArgs: " --model opencode-go/kimi-k2.6", via: "opencode-go/kimi-k2.6", env: {} };
  const host = managedWorker(pinned);
  host.env.workShapeFor = () => ({ intent: "implement", complexity: "systemic", weight: "deep", role: "heavy" });
  host.env.applyModelRouting = async () => { throw new Error("a pinned OpenCode model must not route per task"); };
  assert.equal(await host.env.spawnNextJob(), "spawned");
  assert.equal(host.commands[0].args.at(-1), "opencode run --auto --model opencode-go/kimi-k2.6", "the owner's pin is authoritative");
});

// The route half: which executorRunEnv routes carry a routed provider at all.
// `goLogin` is what OpenCode's own credential store says (opencodeGoLogin):
// true or false, or null when the probe could not answer.
function builderRoutes(settings, { zai = true, clis = ["opencode"], goLogin = true, probes = [] } = {}) {
  const env = vm.createContext({
    process: { env: {} },
    AI_PROVIDERS: ["auto", "zai", "opencode", "zen", "grok", "claude", "codex", "antigravity", "lmstudio", "custom"],
    AI_AUTO_PROVIDERS: ["zai", "opencode", "zen", "grok", "claude", "codex", "antigravity", "lmstudio", "custom"],
    ZAI_MODEL_ROUTINE: "glm-5.3-flash", ZAI_MODEL_HEAVY: "glm-5.3", ASSISTANT_MODEL: "deepseek-v4.1-flash",
    readSettings: async () => copy(settings),
    zaiOpencodeEnv: async () => (zai ? { OPENCODE_CONFIG_CONTENT: '{"provider":{"mefi-zai":{}}}', MEFI_ZAI_API_KEY: "fixture" } : null),
    opencodeGoLogin: async () => { probes.push(copy(settings)); return goLogin; },
    grokCliAvailable: async () => clis.includes("grok"), claudeCliAvailable: async () => clis.includes("claude"),
    codexCliAvailable: async () => clis.includes("codex"), antigravityCliAvailable: async () => clis.includes("antigravity"),
    logLine() {}, pushAutopilotHistory() {},
  });
  vm.runInContext([
    section("function executorModelOverride(", "// Auto setup:"),
    section("function executorOpencodeEnv(", "// Which route an autopilot"),
    section("async function executorRunEnv(", "async function assistantFetch("),
  ].join("\n"), env);
  return env.executorRunEnv();
}

test("Auto on the OpenCode Go route marks the builder for per-task routing; pins, tiers and other CLIs never are", async () => {
  const go = await builderRoutes({ aiProvider: "opencode" });
  assert.equal(go.modelProvider, "opencode");
  assert.equal(go.model, "deepseek-v4.1-flash", "the Go default is the router's default candidate");
  assert.equal(go.modelArgs, " --model opencode-go/deepseek-v4.1-flash");
  assert.equal(JSON.parse(go.env.OPENCODE_CONFIG_CONTENT).provider?.["mefi-zai"], undefined, "the Go route never carries the z.ai provider");
  const first = await builderRoutes({ aiProvider: "auto", aiAutoProviders: ["opencode", "zai"] });
  assert.equal(first.modelProvider, "opencode", "OpenCode Go first in the auto order");
  const keyless = await builderRoutes({ aiProvider: "auto", aiAutoProviders: ["zai", "opencode"] }, { zai: false });
  assert.equal(keyless.modelProvider, "opencode", "a z.ai entry without its key falls through to Go");
  assert.match(keyless.via, /z\.ai key missing/);
  assert.equal((await builderRoutes({ aiProvider: "auto", aiAutoProviders: ["zai", "opencode"] })).modelProvider, "zai", "z.ai first stays on the coding plan");

  const pinned = await builderRoutes({ aiProvider: "opencode", executorModels: { opencode: "opencode-go/kimi-k2.6" } });
  assert.equal(pinned.modelProvider, undefined, "a pinned OpenCode model never routes");
  assert.equal(pinned.modelArgs, " --model opencode-go/kimi-k2.6");
  const scanFree = await builderRoutes({ aiProvider: "opencode", executorModels: { opencode: "opencode/nemotron-3.5-lightning-free" }, firstRun: { builder: { free: true, model: "opencode/nemotron-3.5-lightning-free" } } });
  assert.equal(scanFree.modelProvider, undefined, "the first scan's free pick is a pin on the Go route too");
  for (const tier of ["free", "fast", "heavy"]) {
    const route = await builderRoutes({ aiProvider: "opencode", executorTier: tier, executorTierModels: { opencode: { free: "opencode/big-pickle-free", fast: "opencode-go/glm-5.3-flash", heavy: "opencode-go/kimi-k3" } } });
    assert.equal(route.modelProvider, undefined, `the ${tier} tier pins its model`);
    assert.equal(route.tier, tier);
  }
  const claude = await builderRoutes({ aiProvider: "opencode", executorCli: "claude" }, { clis: ["opencode", "claude"] });
  assert.equal(claude.cli, "claude");
  assert.equal(claude.modelProvider, undefined, "another CLI never routes");
  const unlinked = await builderRoutes({ aiProvider: "opencode", firstRun: { providers: { linked: ["opencode"] } } }, { goLogin: null });
  assert.equal(unlinked.modelProvider, undefined, "a scan that found no Go login keeps the CLI default");
  assert.equal(unlinked.modelArgs, "");
  const neither = await builderRoutes({ aiProvider: "auto", aiAutoProviders: ["grok"] });
  assert.equal(neither.modelProvider, undefined, "an order naming neither runner keeps the OpenCode default");
  assert.equal(neither.modelArgs, "");
});

// The Go login probe with the real `opencode auth list` parser: a saved Go
// credential counts, a variable Zen shares does not, output it cannot read is
// unknown, and one answer serves ten minutes of dispatches.
test("the Go login probe reads OpenCode's saved credentials, never a shared variable, and caches one answer", async () => {
  const scanner = await import("../scripts/first-scan.mjs");
  const auth = (lines) => ["┌  Credentials ~/.local/share/opencode/auth.json", "│", ...lines, "└  1 credentials", "", "┌  Environment", "│", "●  OpenCode Zen OPENCODE_API_KEY", "●  OpenCode Go OPENCODE_API_KEY", "└  2 environment variables"].join("\n");
  let now = 1_000_000, reply = null;
  const calls = [];
  const env = vm.createContext({
    process: { env: { PATH: "fixture" } }, Date: class extends Date { static now() { return now; } },
    loadModule: async (name) => {
      assert.equal(name, "scripts/first-scan.mjs");
      return { ...scanner, spawnExec: async (command, args, options) => { calls.push([command, args.join(" "), options.env.NO_COLOR]); return reply; } };
    },
  });
  vm.runInContext(section("// Whether OpenCode itself holds an OpenCode Go login", "async function executorRunEnv("), env);
  const probe = async (result) => { reply = result; now += 10 * 60000; return env.opencodeGoLogin(); };
  assert.equal(await probe({ code: 0, stdout: auth(["●  OpenCode Go api"]) }), true);
  assert.deepEqual(calls[0], ["opencode", "auth list", "1"], "the first scan's own read-only command");
  assert.equal(await probe({ code: 0, stdout: auth(["●  Anthropic oauth"]) }), false, "OPENCODE_API_KEY lists Go for a Zen key too");
  assert.equal(await probe({ code: 1, stdout: "", error: null }), null, "a CLI that failed is unknown");
  assert.equal(await probe({ code: null, stdout: "", timedOut: true, error: "timed out" }), null);
  assert.equal(await probe({ code: 0, stdout: "Some future format" }), null, "output the parser does not know is not a missing login");
  // Cached: concurrent dispatches share one probe, and the answer lasts ten minutes.
  reply = { code: 0, stdout: auth(["●  OpenCode Go api"]) };
  now += 10 * 60000;
  const before = calls.length;
  assert.deepEqual(await Promise.all([env.opencodeGoLogin(), env.opencodeGoLogin()]), [true, true]);
  now += 9 * 60000;
  assert.equal(await env.opencodeGoLogin(), true);
  assert.equal(calls.length, before + 1);
});

// What settings:auto-setup writes, from the real planner and the same
// fields autoSetup applies. It never writes a first-run record.
function autoSetupSettings({ keys = {}, clis = [] } = {}) {
  const env = vm.createContext({ AI_AUTO_PROVIDERS: ["zai", "opencode", "zen", "grok", "claude", "codex", "antigravity", "lmstudio", "custom"] });
  vm.runInContext([section("function normalizeAutoProviders(", "// A fresh install is one"), section("// Auto setup:", "// Endpoint addresses are preferences")].join("\n"), env);
  const plan = env.planAutoSetup({ settings: {}, keys, clis: clis.map((id) => ({ id, installed: true })), local: {} });
  assert.equal(plan.ok, true);
  const next = {};
  if (plan.changes.provider !== undefined) next.aiProvider = plan.changes.provider;
  if (plan.changes.modelSelection !== undefined) next.modelSelection = plan.changes.modelSelection;
  if (plan.changes.executorCli !== undefined) next.executorCli = plan.changes.executorCli;
  if (plan.changes.autoFallback === false) next.aiAutoFallback = false;
  return next;
}

test("an unpinned OpenCode builder names Go only when Go is chosen and OpenCode holds a Go login; a missing scan is unknown, not linked", async () => {
  const onGo = (route) => route.modelProvider === "opencode" && route.modelArgs === " --model opencode-go/deepseek-v4.1-flash";
  // No first scan and a probe that could not answer: the CLI default, with the reason on the feed.
  for (const settings of [{}, { aiProvider: "opencode" }, { aiProvider: "auto", aiAutoProviders: ["opencode", "zai"] }]) {
    const route = await builderRoutes(settings, { zai: false, goLogin: null });
    assert.equal(route.modelArgs, "", JSON.stringify(settings));
    assert.equal(route.modelProvider, undefined, JSON.stringify(settings));
    assert.match(route.via, /^opencode default · .*no OpenCode Go login confirmed$/);
  }
  // Auto setup on a saved Studio OpenCode Go key: the assistant bills Go, but
  // the key never reaches the CLI, so only OpenCode's own login decides.
  const setup = autoSetupSettings({ keys: { opencode: true }, clis: ["opencode"] });
  assert.deepEqual(setup, { aiProvider: "opencode", modelSelection: "fixed" }, "no first-run record, and OpenCode is already the builder");
  assert.equal((await builderRoutes(setup, { goLogin: null })).modelArgs, "");
  assert.equal((await builderRoutes(setup, { goLogin: false })).modelArgs, "");
  assert.ok(onGo(await builderRoutes(setup, { goLogin: true })), "a Go login OpenCode holds is the Go route");
  // A fresh machine with Claude Code and OpenCode and no key: the assistant is
  // Claude Code, and the builders never guess at Go, whatever OpenCode holds.
  const keyless = autoSetupSettings({ clis: ["claude", "opencode"] });
  assert.equal(keyless.aiProvider, "claude");
  const probes = [];
  assert.equal((await builderRoutes(keyless, { zai: false, goLogin: true, probes })).modelArgs, "");
  // Nor for any other assistant route, with or without a scan that saw Go.
  for (const aiProvider of ["claude", "lmstudio", "custom", "zen", "grok", "codex", "antigravity"]) {
    const route = await builderRoutes({ aiProvider, executorCli: "opencode", aiAutoProviders: ["opencode", "zai"], firstRun: { providers: { linked: ["opencode-go"] } } }, { zai: false, goLogin: true, probes });
    assert.equal(route.modelArgs, "", aiProvider);
    assert.equal(route.modelProvider, undefined, aiProvider);
  }
  assert.deepEqual(probes, [], "a route that cannot be Go never spawns the probe");
  // Another CLI's fallback route follows the same rule.
  const claudeBuilder = await builderRoutes({ aiProvider: "claude", executorCli: "claude" }, { zai: false, clis: ["opencode", "claude"], goLogin: true });
  assert.equal(claudeBuilder.cli, "claude");
  assert.equal(claudeBuilder.opencode.modelArgs, "", "Claude Code's fallback keeps the OpenCode default");
  const unknownFallback = await builderRoutes({ aiProvider: "opencode", executorCli: "claude" }, { clis: ["opencode", "claude"], goLogin: null });
  assert.equal(unknownFallback.opencode.modelArgs, "");
  // The probe outranks the saved scan, which lists Go for an OPENCODE_API_KEY
  // variable Zen shares; the scan only answers when the probe cannot.
  const scanned = { aiProvider: "opencode", firstRun: { providers: { linked: ["opencode", "opencode-go"] } } };
  assert.equal((await builderRoutes(scanned, { goLogin: false })).modelArgs, "");
  assert.ok(onGo(await builderRoutes(scanned, { goLogin: null })));
  // A pin never asks.
  const pinnedProbes = [];
  await builderRoutes({ aiProvider: "opencode", executorModels: { opencode: "opencode-go/kimi-k2.6" } }, { probes: pinnedProbes });
  assert.deepEqual(pinnedProbes, []);
});

test("an OpenCode Go worker asks the router for the Go roster and gets back what it was offered", async () => {
  const candidateList = [
    { provider: "opencode", model: "deepseek-v4.1-flash" }, { provider: "opencode", model: "kimi-k2.6" }, { provider: "zai", model: "glm-5.3" },
  ];
  const host = routingHost({ candidateList, select: async () => ({ ok: true, model: "kimi-k2.6", method: "jev-probability", winProbability: 0.7 }) });
  const result = await host.route({ worker: true, taskType: "coding-implement", weight: "deep", task: "Rework the board contract" },
    { ok: true, provider: "opencode", model: "deepseek-v4.1-flash" });
  assert.equal(host.candidateRequests[0].provider, "opencode");
  assert.deepEqual(host.candidateRequests[0].defaults, ["deepseek-v4.1-flash"]);
  assert.equal(host.candidateRequests[0].role, "worker");
  assert.equal(host.candidateRequests[0].taskType, "coding-implement");
  assert.equal(result.model, "kimi-k2.6");
  assert.deepEqual(copy(result.routingCandidates), ["deepseek-v4.1-flash", "kimi-k2.6"], "only this provider's candidates are offered to the command line");
  assert.equal(result.routingDecision.provider, "opencode");
  // A decision that never reached the router offers nothing but the default.
  const fixed = routingHost({ initialSettings: { modelSelection: "fixed" } });
  assert.deepEqual(copy((await fixed.route({ worker: true }, { ok: true, provider: "opencode", model: "deepseek-v4.1-flash" })).routingCandidates), []);
});
