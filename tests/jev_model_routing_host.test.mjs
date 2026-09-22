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

function managedWorker() {
  const host = executorHost({ tasks: [{ id: "task-a", title: "Fix parser", prompt: "Preserve escaped strings", status: "open", source: "manual", createdAt: 1 }] });
  const route = { cli: "opencode", modelProvider: "zai", model: "glm-5.3-flash", via: "mefi-zai/glm-5.3-flash", modelArgs: " --model mefi-zai/glm-5.3-flash", env: {} };
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
    return { ...route, model: "glm-5.3" };
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
  assert.equal(selections[0].taskType, "coding", "the shape carries the weight, never the ledger's label");
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
test("a pinned tier never consults the work shape", async () => {
  const host = managedWorker();
  let asked = 0;
  host.env.workShapeFor = () => { asked += 1; return { role: "heavy" }; };
  host.env.executorRunEnv = async () => ({ cli: "opencode", model: "mefi-zai/glm-5.3-flash", modelArgs: " --model mefi-zai/glm-5.3-flash", tier: "fast", env: {} });
  host.env.applyModelRouting = async () => { throw new Error("a pinned tier must not route per task"); };
  assert.equal(await host.env.spawnNextJob(), "spawned");
  assert.equal(asked, 0, "the owner's dial is authoritative");
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
});
