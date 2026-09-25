// Run the real Electron-host integration with isolated stores and a fake
// gateway transport. No Electron, live state, credentials, or network access.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import boardGrowth from "../scripts/board-growth.cjs";
import workAdmission from "../scripts/work-admission.cjs";
import { readFile } from "node:fs/promises";
import * as decisionClient from "../scripts/decision-client.mjs";
import * as workClassification from "../scripts/work-classification.mjs";
import { planIntake } from "../scripts/jev-loop.mjs";

const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
};
const plain = (value) => JSON.parse(JSON.stringify(value));
const flush = async () => { for (let index = 0; index < 30; index += 1) await Promise.resolve(); };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const secret = "fixture-gateway-secret-never-returned";
const reply = (answers, usage = { inputTokens: 12, outputTokens: 2 }) => ({ ok: true, status: 200, json: async () => ({ answers, usage }) });
const incoming = { title: "Fix scheduler startup delay", prompt: "Fix scheduler startup delay on launch", source: "chat", at: 1 };
const existing = { id: "existing", title: "Reduce scheduler startup delay", status: "open" };

function host({ settings = { gatewayApiKeyEncrypted: "fixture-encrypted" }, requests = [incoming], tasks = [existing], fetchImpl = async () => reply({ rel_0: { type: "choice", choice: "same_obligation" } }) } = {}) {
  const calls = [], charges = [], records = [], reads = [], enqueued = [], logs = [], ledger = [];
  let serial = 0;
  const client = {
    ...decisionClient,
    resolveApiKey: (options) => decisionClient.resolveApiKey({ ...options, env: {} }),
    gatewayConfig: (options = {}) => decisionClient.gatewayConfig({ ...options, env: {} }),
    classify: (options) => {
      calls.push(options);
      return decisionClient.classify({ ...options, env: {}, fetchImpl });
    },
  };
  const queue = { enqueue: (items) => enqueued.push(items), status: () => ({ pending: 0, phase: "idle" }) };
  const experience = { spendBudget: async (file, entry) => { charges.push({ file, ...entry }); } };
  const context = vm.createContext({
    projects: { current: () => ({ id: "fixture" }), run: (_project, fn) => fn(), stamp: (row) => row },
    workAdmission, console, SMOKE: false, CAPTURE: false, CLI_MODE: false,
    REQUESTS_PATH: "requests", TASKS_PATH: "tasks", POLICY_BUDGET_PATH: "budget",
    readSettings: async () => settings,
    decryptKey: () => secret,
    loadModule: async (name) => {
      if (name === "scripts/decision-client.mjs") return client;
      if (name === "scripts/work-classification.mjs") return workClassification;
      if (name === "scripts/jev-loop.mjs") return { planIntake, createJevQueue: () => queue };
      throw new Error(`unexpected module ${name}`);
    },
    getEyes: async () => ({
      readJson: async (name) => { reads.push(name); return structuredClone(name === "requests" ? requests : tasks); },
      writeJson: () => assert.fail("Jev must not write task or request stores"),
    }),
    getExperienceModule: async () => experience,
    policyRecord: (kind, entry) => records.push({ kind, ...entry }),
    assistantClip: (value, max) => String(value ?? "").slice(0, max),
    logLine: (line) => logs.push(line),
    mutateBoard: () => assert.fail("Jev cannot change the board"),
    spawn: () => assert.fail("Jev cannot start a worker"),
    // Every charged call also joins the model ledger the usage tracker reads.
    crypto: { randomUUID: () => `jev-${++serial}` },
    recordModelCall: async (observation) => { ledger.push(observation); },
  });
  vm.runInContext(section("// Jev classifies admitted observations", "const PINS_PATH"), context, { filename: "main.cjs:jev-runtime" });
  return { context, calls, charges, records, reads, enqueued, logs, ledger, settings, client, experience };
}

test("request admission sends only accepted records to Jev and never awaits the classifier", async () => {
  const queued = [], board = { requests: [incoming] };
  const added = { title: "Repair launch settings", prompt: "Restore missing settings", source: "audit" };
  const context = vm.createContext({
    boardGrowth, workAdmission,
    projects: { stamp: (row) => row },
    workTitleKey: (title) => String(title).toLowerCase().trim(),
    mutateBoard: async (mutate) => mutate(board),
    jevShadowIntake: (items) => { queued.push(items); return new Promise(() => {}); },
  });
  vm.runInContext(section("async function queueRequests(", "// Jev classifies admitted observations"), context);
  assert.equal(await context.queueRequests([incoming, added]), 1);
  assert.deepEqual(plain(queued[0]), [added]);
  assert.deepEqual(plain(board.requests), [added, incoming]);
  assert.equal(await context.queueRequests([incoming]), 0);
  assert.equal(queued[1], undefined, "a fully absorbed admission provides no records to classify");
});

test("explicit task admission reaches Jev once after persistence without waiting, while duplicate and smoke work stay silent", async () => {
  const { context, calls, enqueued } = host();
  const board = { tasks: [] };
  let serial = 0, finished = false;
  Object.assign(context, {
    crypto: { randomBytes: () => ({ toString: () => String(++serial) }) },
    projectRoot: () => "/fixture-project",
    workTitleKey: (title) => String(title).trim().toLowerCase(),
    mutateBoard: async (mutate) => mutate(board),
    refreshAutopilotQueue: async () => {}, assistantLog() {},
    getJevQueue: async () => ({ enqueue: (items) => { enqueued.push(items); return new Promise(() => {}); } }),
  });
  vm.runInContext(section("async function assistantCreateTask(", "// The `opencode run` child"), context);
  const pending = context.assistantCreateTask({ title: "Improve scheduler startup delay" }).then((value) => { finished = true; return value; });
  await flush();
  assert.equal(finished, true, "a pending classifier cannot delay the admitted task");
  const task = await pending;
  assert.equal(board.tasks[0].id, task.id);
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0][0].id, task.id);
  assert.equal(enqueued[0][0].kind, "task");
  assert.equal(enqueued[0][0].at, task.createdAt, "intake retains the admission's stable timestamp");
  assert.equal(await context.assistantCreateTask({ title: task.title }), null);
  assert.equal(await context.assistantCreateTask({ title: " " }), null);
  assert.equal(enqueued.length, 1, "rejected or repeated admissions are never reclassified");
  const admit = context.mutateBoard;
  context.mutateBoard = async () => { throw new Error("fixture persistence failure"); };
  await assert.rejects(context.assistantCreateTask({ title: "A task that could not be saved" }), /persistence failure/);
  context.mutateBoard = admit;
  assert.equal(enqueued.length, 1, "unsaved work never reaches Jev");
  context.SMOKE = true;
  assert.ok(await context.assistantCreateTask({ title: "Improve another project task" }));
  await flush();
  assert.equal(enqueued.length, 1, "smoke tasks never reach the classifier queue");
  assert.equal(calls.length, 0);
});

test("a split follow-up keeps its split lineage through the real task admission, apart from delegation's", async () => {
  const { context } = host();
  const board = { tasks: [] };
  let serial = 0;
  Object.assign(context, {
    crypto: { randomBytes: () => ({ toString: () => String(++serial) }) },
    projectRoot: () => "/fixture-project",
    workTitleKey: (title) => String(title).trim().toLowerCase(),
    mutateBoard: async (mutate) => mutate(board),
    refreshAutopilotQueue: async () => {}, assistantLog() {},
    getJevQueue: async () => ({ enqueue: () => new Promise(() => {}) }),
  });
  vm.runInContext(section("async function assistantCreateTask(", "// The `opencode run` child"), context);
  await context.assistantCreateTask({ title: "Follow-up 2: Add the retry banner", source: "chat", splitFrom: "task_parent", splitDepth: 2 });
  const [split] = board.tasks;
  assert.equal(split.splitFrom, "task_parent");
  assert.equal(split.splitDepth, 2);
  assert.equal(split.parentTaskId, undefined, "parentTaskId and depth stay the delegation lineage");
  assert.equal(split.depth, undefined);
  const ordinary = await context.assistantCreateTask({ title: "An ordinary task" });
  assert.equal("splitFrom" in ordinary || "splitDepth" in ordinary, false);
});

test("smoke, capture, and CLI hosts suppress Jev queue admission", async () => {
  for (const mode of ["SMOKE", "CAPTURE", "CLI_MODE"]) {
    const { context, enqueued } = host();
    context[mode] = true;
    context.jevShadowIntake([incoming]);
    await flush();
    assert.equal(enqueued.length, 0);
  }
  const { context, enqueued } = host();
  context.jevShadowIntake([incoming]);
  await flush();
  assert.deepEqual(enqueued, [[incoming]]);
});

test("disabled and unconfigured Jev defers without gateway calls, charges, or store reads", async () => {
  for (const [settings, reason] of [[{ jevShadow: false }, "disabled"], [{}, "no-key"]]) {
    const { context, calls, charges, records, reads } = host({ settings });
    assert.deepEqual(plain(await context.runJevIntake([incoming])), { ok: true, defer: true, reason });
    assert.equal(calls.length, 0);
    assert.equal(charges.length, 0);
    assert.equal(records.length, 0);
    assert.equal(reads.length, 0);
  }
});

test("intake without overlapping outstanding work spends nothing", async () => {
  const { context, calls, charges, records } = host({ tasks: [] });
  assert.deepEqual(plain(await context.runJevIntake([incoming])), { ok: true, attempted: false, proposals: 0 });
  assert.equal(calls.length, 0, "the new request cannot select itself");
  assert.equal(charges.length, 0);
  assert.equal(records.length, 0);
});

test("the saved route picks the endpoint and its own credential", async () => {
  const urls = [];
  const direct = host({ settings: { jevRoute: "typesafe", jevApiKeyEncrypted: "fixture-encrypted" },
    fetchImpl: async (url, options) => { urls.push({ url, body: JSON.parse(options.body) }); return reply({ rel_0: { type: "choice", choice: "same_obligation" } }); } });
  assert.deepEqual(plain(await direct.context.runJevIntake([incoming])), { ok: true, attempted: true, proposals: 1 });
  assert.equal(direct.calls.length, 1);
  assert.equal(direct.calls[0].config.route, "typesafe");
  assert.equal(urls[0].url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(urls[0].body.model, "jev-1.13.0");
  assert.equal(urls[0].body.questions.rel_0.type, "choice");
  assert.equal(direct.records[0].answer, "same_obligation");
  // A gateway key is never sent to the Jev API route: unconfigured means no call.
  const wrongKey = host({ settings: { jevRoute: "typesafe", gatewayApiKeyEncrypted: "fixture-encrypted" } });
  assert.deepEqual(plain(await wrongKey.context.runJevIntake([incoming])), { ok: true, defer: true, reason: "no-key" });
  assert.equal(wrongKey.calls.length, 0);
  // The gateway route keeps its own wire and default pin.
  const gateway = host({ fetchImpl: async (url, options) => { urls.push({ url, body: JSON.parse(options.body) }); return reply({ rel_0: { type: "choice", choice: "unrelated" } }); } });
  await gateway.context.runJevIntake([incoming]);
  assert.equal(urls[1].url, "https://ai-gateway.vercel.sh/v4/ai/evaluation-model");
  assert.equal(urls[1].body.model, undefined, "the gateway carries the model in the header, not the body");
  // OpenCode Zen and OpenRouter ride the direct wire at their own endpoints.
  for (const [route, url, model, field] of [
    ["zen", "https://opencode.ai/zen/v1/systemone", "jev-1.13", "zenApiKeyEncrypted"],
    ["openrouter", "https://openrouter.ai/api/alpha/decisions", "typesafe/jev-1.13", "openrouterApiKeyEncrypted"],
  ]) {
    const routed = host({ settings: { jevRoute: route, [field]: "fixture-encrypted" },
      fetchImpl: async (requestUrl, options) => { urls.push({ url: requestUrl, body: JSON.parse(options.body) }); return reply({ rel_0: { type: "choice", choice: "same_obligation" } }); } });
    assert.deepEqual(plain(await routed.context.runJevIntake([incoming])), { ok: true, attempted: true, proposals: 1 }, route);
    assert.equal(routed.calls[0].config.route, route);
    const last = urls.at(-1);
    assert.equal(last.url, url);
    assert.equal(last.body.model, model);
    // Another route's key never authorizes this one.
    const foreign = host({ settings: { jevRoute: route, gatewayApiKeyEncrypted: "fixture-encrypted" } });
    assert.deepEqual(plain(await foreign.context.runJevIntake([incoming])), { ok: true, defer: true, reason: "no-key" }, `${route} refuses a gateway key`);
    assert.equal(foreign.calls.length, 0);
  }
});

test("a failed evaluation is budget-charged from usage and never becomes a proposal", async () => {
  const { context, calls, charges, records, ledger } = host({ fetchImpl: async () => reply({}, { inputTokens: 37, outputTokens: 4 }) });
  const result = await context.runJevIntake([incoming]);
  assert.equal(result.ok, false);
  assert.equal(result.attempted, true);
  assert.equal(calls.length, 1);
  assert.equal(charges.length, 1);
  assert.equal(charges[0].purpose, "jev-shadow-intake");
  assert.equal(charges[0].modelCalls, 1);
  assert.equal(charges[0].tokens, 41);
  assert.match(charges[0].note, /failed/);
  // The same call reaches the usage tracker's ledger under the route's provider, tokens as reported, cost unknown.
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].provider, "gateway");
  assert.equal(ledger[0].status, "error");
  assert.equal(ledger[0].taskType, "jev-shadow-intake");
  assert.deepEqual({ ...ledger[0].tokenUsage }, { inputTokens: 37, outputTokens: 4, totalTokens: 41 });
  assert.equal(ledger[0].costUsd, null);
  assert.equal(records.length, 0);
});

test("validated intake records one advisory event without modifying its source work", async () => {
  const requests = structuredClone([incoming]), tasks = structuredClone([existing]);
  const { context, calls, charges, records } = host({ requests, tasks });
  assert.deepEqual(plain(await context.runJevIntake([incoming])), { ok: true, attempted: true, proposals: 1 });
  assert.equal(calls.length, 1);
  assert.equal(charges[0].tokens, 14);
  assert.equal(records.length, 1);
  assert.equal(records[0].kind, "jev-proposal");
  assert.equal(records[0].answer, "same_obligation");
  assert.equal(records[0].proposedAction, "attach-observation");
  assert.equal(records[0].candidate.title, existing.title);
  assert.deepEqual(requests, [incoming]);
  assert.deepEqual(tasks, [existing]);
  assert.equal(JSON.stringify(records).includes(secret), false);
});

test("approved plan tasks reach Jev as advisory comparisons and retain their approved scope", async () => {
  const planned = { ...incoming, id: "planned-task", kind: "task", source: "planning", status: "open", planningId: "approved-plan", planningSpecId: "reviewed-spec", dependsOn: ["prerequisite"] };
  const tasks = structuredClone([existing, planned]);
  const { context, calls, charges, records } = host({ requests: [], tasks,
    fetchImpl: async () => reply({ rel_0: { type: "choice", choice: "conflicts_with_existing" } }),
  });
  const result = await context.runJevIntake([planned]);
  assert.equal(result.proposals, 1);
  assert.equal(calls.length, 1);
  assert.match(calls[0].questions[0].prompt, /planning/);
  assert.equal(charges[0].purpose, "jev-shadow-intake");
  assert.equal(records[0].observation.source, "planning");
  assert.equal(records[0].candidate.title, existing.title, "an admitted task cannot compare itself");
  assert.equal(records[0].answer, "conflicts_with_existing");
  assert.deepEqual(tasks, [existing, planned], "even a conflict proposal cannot change approved tasks or dependencies");
});

test("connection checks coalesce in flight, charge once, and expose only safe metadata", async () => {
  const response = deferred();
  const { context, calls, charges, records } = host({ fetchImpl: () => response.promise });
  const first = context.probeJev(), second = context.probeJev();
  assert.equal(first, second);
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].apiKey, secret, "credentials are available only to the transport");
  assert.equal(calls[0].state, "ready", "the connection check contains no user work");
  response.resolve(reply({ connection: { type: "choice", choice: "ready" } }));
  const result = await first;
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result).sort(), ["elapsedMs", "model", "ok"]);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(charges.length, 1);
  assert.equal(charges[0].purpose, "jev-connection-check");
  assert.equal(records.length, 0);
  await context.probeJev();
  assert.equal(calls.length, 2, "a completed connection check releases the coalescing lock");
});

test("failed probes redact provider echoes, charge attempted calls, and release the lock", async () => {
  const { context, calls, charges, client } = host({ fetchImpl: async () => ({ ok: false, status: 403, text: async () => `denied ${secret}` }) });
  const result = await context.probeJev();
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(charges[0].modelCalls, 1);
  const classify = client.classify;
  client.classify = async () => { throw new Error("local unavailable"); };
  await assert.rejects(context.probeJev(), /local unavailable/);
  client.classify = classify;
  await context.probeJev();
  assert.equal(calls.length, 2);
  assert.equal(charges.length, 2);
});

test("missing-key probes stay local and status never exposes the stored key", async () => {
  const { context, calls, charges } = host({ settings: {} });
  assert.equal((await context.probeJev()).ok, false);
  assert.equal(calls.length, 0);
  assert.equal(charges.length, 0);
  const ready = host();
  const status = await ready.context.jevStatus();
  assert.equal(status.configured, true);
  assert.equal(status.enabled, true);
  assert.equal(status.route, "vercel");
  assert.equal(status.routeLabel, "Vercel AI Gateway");
  assert.deepEqual(plain(status.routes), { vercel: true, typesafe: false, zen: false, openrouter: false });
  assert.equal(status.accountingPending, 0);
  assert.equal(JSON.stringify(status).includes(secret), false);
  assert.equal(Object.keys(status).some((key) => /apikey|encrypted/i.test(key)), false);
});

test("a paid result survives ledger failure and blocks further calls until accounting recovers", async () => {
  const { context, calls, charges, records, experience } = host({ fetchImpl: async (url, options) => {
    const probe = Boolean(JSON.parse(options.body).questions.connection);
    return reply(probe ? { connection: { type: "choice", choice: "ready" } } : { rel_0: { type: "choice", choice: "same_obligation" } });
  } });
  const write = experience.spendBudget;
  experience.spendBudget = async () => { throw new Error("ledger temporarily locked"); };
  const result = await context.runJevIntake([incoming]);
  assert.equal(result.ok, true, "a ledger error cannot turn completed classification into a retry");
  assert.equal(result.proposals, 1);
  assert.equal(records.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(charges.length, 0);
  assert.equal((await context.jevStatus()).accountingPending, 1);

  assert.deepEqual(plain(await context.runJevIntake([incoming])), { ok: true, defer: true, reason: "accounting-pending" });
  const blockedProbe = await context.probeJev();
  assert.equal(blockedProbe.ok, false);
  assert.match(blockedProbe.error, /usage ledger/);
  assert.equal(calls.length, 1, "neither intake nor a probe may spend again while prior usage is unrecorded");
  assert.equal(records.length, 1, "the successful original observation is not recorded twice");
  assert.equal((await context.jevStatus()).accountingPending, 1);

  experience.spendBudget = write;
  await Promise.all([context.flushJevCharges(), context.flushJevCharges()]);
  assert.equal(charges.length, 1, "coalesced flushes charge retained usage exactly once");
  assert.equal(charges[0].purpose, "jev-shadow-intake");
  assert.equal(charges[0].modelCalls, 1);
  assert.equal(charges[0].tokens, 14);
  assert.equal(calls.length, 1, "repairing accounting never re-runs the original evaluation");
  assert.equal((await context.jevStatus()).accountingPending, 0);

  assert.equal((await context.probeJev()).ok, true);
  assert.equal(calls.length, 2, "a new explicit check can proceed after the ledger is repaired");
  assert.deepEqual(charges.map(({ purpose }) => purpose), ["jev-shadow-intake", "jev-connection-check"]);
});

test("concurrent deferred charges recover in order without duplicating already written entries", async () => {
  const { context, experience, charges } = host();
  const write = experience.spendBudget;
  let attempts = 0;
  experience.spendBudget = async (file, entry) => {
    attempts += 1;
    if (attempts > 1) throw new Error("disk unavailable");
    return write(file, entry);
  };
  const paid = { ok: true, model: "typesafe-ai/jev", usage: { modelCalls: 1, promptTokens: 10, completionTokens: 1 } };
  await Promise.all([
    context.chargeJevCall(paid, "first"),
    context.chargeJevCall(paid, "second"),
    context.chargeJevCall(paid, "third"),
  ]);
  assert.deepEqual(charges.map(({ purpose }) => purpose), ["first"]);
  assert.equal((await context.jevStatus()).accountingPending, 2);
  experience.spendBudget = write;
  await Promise.all([context.flushJevCharges(), context.flushJevCharges()]);
  assert.deepEqual(charges.map(({ purpose }) => purpose), ["first", "second", "third"]);
  assert.equal((await context.jevStatus()).accountingPending, 0);
});
