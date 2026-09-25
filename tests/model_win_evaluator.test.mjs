// The model evaluator end to end, the way the owner describes it: feed it each
// model's record (verified wins and losses on this kind of work, cost, speed,
// what it is good at) and it gives every candidate a win probability; the
// highest one gets the task. The ledger here is the real store on a scratch
// file, the attempts are recorded and settled through the host's own helpers
// (sliced from main.cjs), and the routing is the real router.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import modelPerformance from "../scripts/model-performance.cjs";
import { buildRoutingCandidates, selectTaskModel, estimateWinProbability } from "../scripts/model-routing.mjs";
import * as receipts from "../scripts/receipts.mjs";
import * as assistantModule from "../scripts/assistant.mjs";
import * as history from "../scripts/task-history.mjs";
import backlog from "../scripts/backlog.cjs";
import taskHandoffs from "../scripts/task-handoffs.cjs";
import taskDelegation from "../scripts/task-delegation.cjs";
import executorResume from "../scripts/executor-resume.cjs";

const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const catalog = JSON.parse(await readFile(new URL("../data/models.json", import.meta.url), "utf8"));
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
};

async function ledger() {
  const folder = await mkdtemp(path.join(os.tmpdir(), "mefi-win-ledger-"));
  const store = modelPerformance.createModelPerformanceStore({ filePath: path.join(folder, "model-performance.json") });
  const logs = [];
  const env = vm.createContext({
    SMOKE: false, CAPTURE: false, logLine: (text) => logs.push(text),
    modelPerformanceStore: () => store,
    recordModelCall: (observation) => store.record(observation),
  });
  vm.runInContext(section("// One builder attempt in the model ledger", "async function recordModelCall("), env);
  // The host records fire-and-forget, so a last atomic write (temp file,
  // then rename) can still be landing when a test ends: retry the removal
  // instead of failing on ENOTEMPTY under a loaded test run.
  return { store, env, logs, folder, cleanup: () => rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }) };
}

// A run through the host's helpers: the attempt is recorded when it ends, and
// its verdict settles it once the verifier has spoken.
async function attempt(host, id, model, verdict, { kind = "coding-implement", ok = verdict !== "failed" } = {}) {
  const entry = { id, startedAt: 1_700_000_000_000, workKind: kind };
  host.env.recordWorkerAttempt(entry, { modelProvider: "zai", model, via: `mefi-zai/${model}` }, { ok, durationMs: 60_000, outcome: ok ? null : "failed" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  if (ok) await host.env.settleModelOutcome(id, verdict);
}

test("recorded attempts settle into wins and losses per model and per kind of work", async () => {
  const host = await ledger();
  try {
    await attempt(host, "run_1", "glm-5.3", "verified");
    await attempt(host, "run_2", "glm-5.3", "verified");
    await attempt(host, "run_3", "glm-5.3-flash", "failed");
    await attempt(host, "run_4", "glm-5.3-flash", "reported", { ok: true });
    await attempt(host, "run_5", "glm-5.3-flash", "verified", { kind: "coding-document" });
    const snapshot = await host.store.snapshot();
    const row = (model) => snapshot.models.find((entry) => entry.provider === "zai" && entry.model === model);
    const task = (model, kind) => row(model).taskStrengths.find((entry) => entry.taskType === kind);
    assert.deepEqual([task("glm-5.3", "coding-implement").wins, task("glm-5.3", "coding-implement").losses], [2, 0]);
    assert.deepEqual([task("glm-5.3-flash", "coding-implement").wins, task("glm-5.3-flash", "coding-implement").losses], [0, 1], "a worker's own report is never a win");
    assert.equal(task("glm-5.3-flash", "coding-implement").unsettled, 1, "the reported run waits for a real verdict");
    assert.equal(task("glm-5.3-flash", "coding-document").wins, 1, "each kind of work keeps its own record");
    assert.ok(task("glm-5.3", "coding-implement").winProbability > task("glm-5.3-flash", "coding-implement").winProbability);
    assert.deepEqual(host.logs, []);
  } finally {
    await host.cleanup();
  }
});

test("with no judge the model with the better record on this kind of work is routed, once the evidence is enough", async () => {
  const host = await ledger();
  try {
    const candidates = async (kind = "coding-implement") => buildRoutingCandidates({ catalog, performance: await host.store.snapshot(), provider: "zai",
      defaults: ["glm-5.3-flash"], taskType: kind, role: "worker" });
    // One win is not evidence yet: the default stands.
    await attempt(host, "run_a1", "glm-5.3", "verified");
    let picked = await selectTaskModel({ candidates: await candidates(), taskType: "coding-implement", role: "worker", task: "Rework the board contract" });
    assert.equal(picked.ok, false, "a thin record never moves the route off the default");
    // A clear record: the heavier model verifies, the flash model keeps failing.
    for (const id of ["run_a2", "run_a3", "run_a4"]) await attempt(host, id, "glm-5.3", "verified");
    for (const id of ["run_b1", "run_b2", "run_b3"]) await attempt(host, id, "glm-5.3-flash", "failed");
    const shortlist = await candidates();
    picked = await selectTaskModel({ candidates: shortlist, taskType: "coding-implement", role: "worker", task: "Rework the board contract" });
    assert.equal(picked.ok, true);
    assert.equal(picked.method, "local-probability");
    assert.equal(picked.model, "glm-5.3", "the likelier winner gets the task");
    assert.ok(picked.probabilities["glm-5.3"] > picked.probabilities["glm-5.3-flash"], "every candidate gets a win probability, highest wins");
    assert.equal(picked.winProbability, picked.probabilities["glm-5.3"]);
    const heavy = shortlist.find((candidate) => candidate.model === "glm-5.3");
    assert.equal(estimateWinProbability(heavy).basis, "task", "the record on this kind of work is what the estimate rests on");
    // Another kind of work has no record yet: it falls back to the overall record, not to this kind's.
    assert.notEqual(estimateWinProbability((await candidates("coding-explore")).find((candidate) => candidate.model === "glm-5.3")).basis, "task");
  } finally {
    await host.cleanup();
  }
});

test("a judge answers one win probability per candidate and the highest wins", async () => {
  const host = await ledger();
  try {
    await attempt(host, "run_j1", "glm-5.3", "verified");
    const shortlist = buildRoutingCandidates({ catalog, performance: await host.store.snapshot(), provider: "zai", defaults: ["glm-5.3-flash"], taskType: "coding-implement", role: "worker" });
    const asked = [];
    const classifyFn = async ({ questions, state }) => {
      asked.push(...questions.map((question) => question.type));
      // The judge sees each candidate's record and estimate, and answers per candidate.
      assert.ok(state.candidates.every((candidate) => "record" in candidate && "estimate" in candidate));
      const answers = Object.fromEntries(questions.map((question, index) => [question.id, { noul: state.candidates[index].model === "glm-5.3" ? 0.81 : 0.42 }]));
      return { ok: true, answers, usage: { modelCalls: 1 }, model: "stand-in" };
    };
    const picked = await selectTaskModel({ candidates: shortlist, taskType: "coding-implement", role: "worker", weight: "deep", task: "Rework the board contract", classifyFn, judge: { model: "stand-in" } });
    assert.equal(picked.ok, true);
    assert.equal(picked.method, "judge-probability");
    assert.equal(picked.model, "glm-5.3");
    assert.deepEqual(asked, shortlist.map(() => "noul"), "one yes-probability question per candidate");
    assert.equal(picked.probabilities["glm-5.3"], 0.81);
    assert.equal(picked.probabilities["glm-5.3-flash"], 0.42);
  } finally {
    await host.cleanup();
  }
});

// Real receipts from the real verifier, one per attempt, through the host's
// own mapping: a rejection with retry budget left still loses that attempt.
test("every runner rejection settles its own attempt as a loss, retry budget left or not", async () => {
  const host = await ledger();
  try {
    const check = (exitCode) => [{ command: "npm test", startedAt: 1_700_000_000_100, status: "completed", exitCode, passed: exitCode === 0 }];
    const seen = [];
    for (const [index, exitCode] of [1, 1, 0].entries()) {
      const id = `run_${index + 1}`;
      host.env.recordWorkerAttempt({ id, startedAt: 1_700_000_000_000, workKind: "coding-implement" }, { modelProvider: "zai", model: "glm-5.3-flash" }, { ok: true, durationMs: 60_000 });
      const attempt = { runId: id, sessionId: `session_${index + 1}` };
      const verdict = assistantModule.verifyCompletion({ verdictOk: true, changedFiles: 2, hasSession: true, observedChecks: check(exitCode), priorAttempts: index });
      const receipt = receipts.buildReceipt({ attemptId: id, workItem: { kind: "task", title: "Rework the board contract" }, attempt, verdict, changedFiles: 2, now: 1_700_000_000_500 });
      const outcome = host.env.receiptModelOutcome(receipt, receipts);
      seen.push([verdict.state, outcome]);
      await host.env.settleModelOutcome(id, outcome);
    }
    assert.deepEqual(seen, [["unverified", "failed"], ["unverified", "failed"], ["verified", "verified"]]);
    const flash = (await host.store.snapshot()).models.find((row) => row.provider === "zai" && row.model === "glm-5.3-flash");
    const kind = flash.taskStrengths.find((row) => row.taskType === "coding-implement");
    assert.deepEqual([kind.wins, kind.losses, kind.unsettled], [1, 2, 0], "two rejected attempts are two losses, not two pending ones");
    // Neither a win nor a loss: only a verified verdict the runner did not observe.
    const receiptOf = (verdict, { sessionId = null, changedFiles = 0, remaining = [] } = {}) => receipts.buildReceipt({ attemptId: "run_x", attempt: { sessionId }, verdict, changedFiles, remaining, now: 1 });
    const map = (receipt, module = receipts) => host.env.receiptModelOutcome(receipt, module);
    assert.equal(map(receiptOf({ state: "verified", reason: "named", evidence: { namedChecks: true } })), "reported", "worker-named checks are self-reported");
    assert.equal(map(receiptOf({ state: "verified", reason: "bare", evidence: {} }, { sessionId: "s" })), "unverified", "a verified verdict with no runner-observed evidence");
    assert.equal(map(receiptOf({ state: "verified", reason: "edits", evidence: {} }, { sessionId: "s", changedFiles: 1, remaining: ["write the docs"] })), "unverified", "edits with obligations still owed are not trusted");
    assert.equal(map(receiptOf({ state: "failed", reason: "parked", evidence: {} }, { sessionId: "s" })), "failed");
    assert.equal(map(receiptOf({ state: "verified", reason: "edits", evidence: {} }, { sessionId: "s", changedFiles: 1 }), null), "verified", "without the module the receipt's own trust decides");
    assert.equal(map(null), null);
  } finally {
    await host.cleanup();
  }
});

// The verification pass itself (sliced from main.cjs) with the real verifier,
// receipts and ledger: what it settles is what the router reads later.
const NOW = 100000;
const clock = class extends Date { static now() { return NOW; } };
function housekeepingHost(host, tasks) {
  let board = { tasks: structuredClone(tasks), requests: [] };
  Object.assign(host.env, {
    Date: clock, crypto, backlog, taskHandoffs, taskDelegation, executorResume, executorProcessAlive: () => false, process: { pid: 1 },
    EXECUTOR_PARALLEL_CAP: 3, autopilot: { jobs: [] }, assistantState: { prefs: {} }, assistantModule,
    TASKS_PATH: "tasks", REQUESTS_PATH: "requests", RECEIPTS_PATH: path.join(host.folder, "receipts.jsonl"),
    getAssistant: async () => assistantModule, loadModule: async () => history,
    getEyes: async () => ({ readJson: async (key) => structuredClone(board[key] ?? []), listChanges: async () => [{ file: "fixture.js", status: "completed" }] }),
    getReceiptsModule: async () => receipts, policyRecord() {}, refreshAutopilotQueue: async () => {},
    assistantClip: (value, limit) => String(value ?? "").slice(0, limit),
    mutateBoard: async (mutate) => {
      const next = structuredClone(board);
      const patch = mutate(next);
      for (const key of ["tasks", "requests"]) if (patch[key]) next[key] = patch[key];
      board = next;
      return { ...patch, written: ["tasks"] };
    },
  });
  vm.runInContext(section("const VERIFY_DWELL_MS =", "// One autopilot tick:"), host.env);
  return { task: (id) => board.tasks.find((row) => row.id === id) };
}

test("the verification pass loses a rejected attempt and takes back a win its overseer check reopened", async () => {
  const host = await ledger();
  try {
    for (const id of ["run_1", "run_2"]) host.env.recordWorkerAttempt({ id, startedAt: 1, workKind: "coding-implement" }, { modelProvider: "zai", model: "glm-5.3-flash" }, { ok: true, durationMs: 1000 });
    const pass = housekeepingHost(host, [
      { id: "won", title: "Verified, then reopened", status: "awaiting_verification", lastAttempt: { runId: "run_1", sessionId: "s1", startedAt: 1, at: 2, code: 0, sawDone: true } },
      { id: "rejected", title: "Rejected with budget left", status: "awaiting_verification", lastAttempt: { runId: "run_2", sessionId: "s2", startedAt: 1, at: 2, code: 1 } },
    ]);
    // Settles are fire-and-forget; the ledger's own queue orders this read after them.
    const outcomeOf = async (id) => (await host.store.read()).observations.find((row) => row.id === id)?.outcome;
    await host.env.autopilotHousekeeping();
    assert.equal(pass.task("won").status, "done");
    assert.equal(pass.task("rejected").verification.state, "unverified", "the card keeps its retry budget");
    assert.equal(await outcomeOf("run_1"), "verified");
    assert.equal(await outcomeOf("run_2"), "failed", "but the attempt itself lost");
    // The overseer's queued check lands after the card settled, and fails.
    pass.task("won").verificationRun = { key: "overseer:run_1", state: "failed", at: NOW + 1, results: [{ command: "npm test", ok: false, exitCode: 1, tail: "1 failing" }] };
    await host.env.autopilotHousekeeping();
    assert.equal(pass.task("won").status, "open");
    assert.equal(await outcomeOf("run_1"), "failed", "the runner took the win back");
    const flash = (await host.store.snapshot()).models.find((row) => row.provider === "zai" && row.model === "glm-5.3-flash");
    assert.deepEqual([flash.wins, flash.losses, flash.unsettled], [0, 2, 0]);
  } finally {
    await host.cleanup();
  }
});

test("Fast and Heavy tier runs on the z.ai plan count toward the zai candidates routing compares", async () => {
  const host = await ledger();
  try {
    const tier = (model, name) => ({ cli: "opencode", model: `mefi-zai/${model}`, tier: name, via: `mefi-zai/${model} · ${name} tier` });
    const entry = (id) => ({ id, startedAt: 1_700_000_000_000, workKind: "coding-implement" });
    for (const id of ["heavy_1", "heavy_2", "heavy_3"]) {
      host.env.recordWorkerAttempt(entry(id), tier("glm-5.3", "heavy"), { ok: true, durationMs: 60_000 });
      await host.env.settleModelOutcome(id, "verified");
    }
    host.env.recordWorkerAttempt(entry("fast_1"), tier("glm-5.3-flash", "fast"), { ok: false, durationMs: 1000, outcome: "failed" });
    // A named provider and a model on another OpenCode provider keep theirs.
    host.env.recordWorkerAttempt(entry("routed_1"), { cli: "opencode", modelProvider: "zai", model: "glm-5.3", via: "mefi-zai/glm-5.3" }, { ok: true });
    host.env.recordWorkerAttempt(entry("go_1"), { cli: "opencode", model: "opencode-go/kimi-k2.6", via: "opencode-go/kimi-k2.6" }, { ok: true });
    host.env.recordWorkerAttempt(entry("zen_1"), { cli: "opencode", model: "opencode/kimi-k3", via: "opencode/kimi-k3" }, { ok: true });
    host.env.recordWorkerAttempt(entry("bare_1"), { cli: "opencode", model: "glm-5.3", via: "mefi-zai/glm-5.3" }, { ok: true });
    const rows = (await host.store.read()).observations.map((row) => [row.id, row.provider, row.model]);
    // A pinned Go run is filed under its bare roster id, the row its Go
    // candidate joins; Zen's opencode/<id> is another account and keeps its id.
    assert.deepEqual(rows, [
      ["heavy_1", "zai", "glm-5.3"], ["heavy_2", "zai", "glm-5.3"], ["heavy_3", "zai", "glm-5.3"], ["fast_1", "zai", "glm-5.3-flash"],
      ["routed_1", "zai", "glm-5.3"], ["go_1", "opencode", "kimi-k2.6"], ["zen_1", "opencode", "opencode/kimi-k3"], ["bare_1", "zai", "glm-5.3"],
    ]);
    const shortlist = buildRoutingCandidates({ catalog, performance: await host.store.snapshot(), provider: "zai", defaults: ["glm-5.3-flash"], taskType: "coding-implement", role: "worker" });
    const heavy = shortlist.find((candidate) => candidate.model === "glm-5.3");
    assert.deepEqual([heavy.record.task.wins, heavy.record.task.losses], [3, 0], "the owner's Heavy-tier runs are this candidate's record");
    assert.equal(shortlist.find((candidate) => candidate.model === "glm-5.3-flash").record.task.losses, 1);
  } finally {
    await host.cleanup();
  }
});

test("a route label's notes never become a model id, so one model keeps one record", async () => {
  const host = await ledger();
  try {
    const entry = (id) => ({ id, startedAt: 1_700_000_000_000, workKind: "coding-implement" });
    host.env.recordWorkerAttempt(entry("n1"), { cli: "opencode", via: "opencode default · z.ai key missing" }, { ok: true });
    host.env.recordWorkerAttempt(entry("n2"), { cli: "opencode", via: "opencode default · heavy tier (no model saved)" }, { ok: true });
    host.env.recordWorkerAttempt(entry("n3"), { cli: "opencode", via: "mefi-zai/glm-5.3 · heavy tier" }, { ok: true });
    host.env.recordWorkerAttempt(entry("n4"), { cli: "grok", via: "grok cli · builder model unset" }, { ok: true });
    const rows = (await host.store.read()).observations.map((row) => [row.id, row.provider, row.model]);
    assert.deepEqual(rows, [["n1", "opencode", "opencode-default"], ["n2", "opencode", "opencode-default"], ["n3", "zai", "glm-5.3"], ["n4", "grok", "grok-default"]]);
  } finally {
    await host.cleanup();
  }
});

test("an OpenCode Go run records under provider opencode and joins its candidate on the capped Go shortlist", async () => {
  const host = await ledger();
  try {
    const entry = (id) => ({ id, startedAt: 1_700_000_000_000, workKind: "coding-implement" });
    // A routed Go run carries the bare roster id; a pinned one names opencode-go/<id>.
    const routed = (model) => ({ cli: "opencode", modelProvider: "opencode", model, via: `opencode-go/${model}` });
    const pinned = (model) => ({ cli: "opencode", model: `opencode-go/${model}`, via: `opencode-go/${model}` });
    for (const [id, route] of [["k1", routed("kimi-k2.6")], ["k2", routed("kimi-k2.6")], ["k3", pinned("kimi-k2.6")]]) {
      host.env.recordWorkerAttempt(entry(id), route, { ok: true, durationMs: 60_000 });
      await host.env.settleModelOutcome(id, "verified");
    }
    for (const id of ["d1", "d2", "d3"]) host.env.recordWorkerAttempt(entry(id), routed("deepseek-v4.1-flash"), { ok: false, durationMs: 1000, outcome: "failed" });
    const rows = (await host.store.read()).observations.map((row) => [row.id, row.provider, row.model]);
    assert.ok(rows.every(([, provider]) => provider === "opencode"));
    assert.deepEqual(rows.map((row) => row[2]), ["kimi-k2.6", "kimi-k2.6", "kimi-k2.6", "deepseek-v4.1-flash", "deepseek-v4.1-flash", "deepseek-v4.1-flash"]);
    const shortlist = buildRoutingCandidates({ catalog, performance: await host.store.snapshot(), provider: "opencode", defaults: ["deepseek-v4.1-flash"], taskType: "coding-implement", role: "worker" });
    assert.equal(shortlist.length, 6, "the judge is asked about six Go models, not the whole roster");
    assert.deepEqual(shortlist.slice(0, 2).map((candidate) => candidate.model), ["deepseek-v4.1-flash", "kimi-k2.6"], "the default, then the model with a record on this kind of work");
    const kimi = shortlist.find((candidate) => candidate.model === "kimi-k2.6");
    assert.deepEqual([kimi.record.task.wins, kimi.record.task.losses], [3, 0], "routed and pinned Go runs are one candidate's record");
    assert.equal(shortlist[0].record.task.losses, 3);
    // A keyless machine: the local rule, unchanged, moves the Go route on that record.
    const picked = await selectTaskModel({ candidates: shortlist, taskType: "coding-implement", role: "worker", task: "Rework the board contract" });
    assert.equal(picked.ok, true);
    assert.equal(picked.method, "local-probability");
    assert.equal(picked.model, "kimi-k2.6");
    assert.equal(picked.provider, "opencode");
  } finally {
    await host.cleanup();
  }
});

test("with no judge a failing default hands tasks to the alternative, whose own failures hand them back", async () => {
  const host = await ledger();
  try {
    const route = async () => selectTaskModel({ taskType: "coding-implement", role: "worker", task: "Rework the board contract",
      candidates: buildRoutingCandidates({ catalog, performance: await host.store.snapshot(), provider: "zai", defaults: ["glm-5.3-flash"], taskType: "coding-implement", role: "worker" }) });
    for (const id of ["f1", "f2"]) await attempt(host, id, "glm-5.3-flash", "failed");
    assert.equal((await route()).reason, "jev-unconfigured", "two failures are not a record yet");
    await attempt(host, "f3", "glm-5.3-flash", "failed");
    const picked = await route();
    assert.equal(picked.ok, true);
    assert.equal(picked.model, "glm-5.3", "a default that keeps failing no longer keeps every task");
    assert.equal(picked.method, "local-probability");
    assert.equal(picked.exploration, true);
    assert.equal(picked.evidence.estimate.basis, "prior", "the alternative had no record of its own");
    // Bounded: the default keeps every other task, so its own record moves
    // while the alternative's failures close the gap.
    const picks = [];
    for (let index = 0; index < 4; index++) {
      const next = await route();
      const model = next.ok ? next.model : "glm-5.3-flash";
      picks.push(model);
      await attempt(host, `loop_${index}`, model, "failed");
    }
    assert.deepEqual(picks, ["glm-5.3", "glm-5.3-flash", "glm-5.3", "glm-5.3-flash"]);
  } finally {
    await host.cleanup();
  }
});

// The OpenCode Go shortlist is six models whose typical costs span 66x; a
// keyless machine must not trade the default for the costliest priors on noise.
test("with no judge on OpenCode Go, one bad streak neither abandons the default nor hands its work to the costliest models", async () => {
  const host = await ledger();
  try {
    const go = async (id, model, verdict) => {
      host.env.recordWorkerAttempt({ id, startedAt: 1_700_000_000_000, workKind: "coding-implement" }, { cli: "opencode", modelProvider: "opencode", model, via: `opencode-go/${model}` }, { ok: verdict === "verified", durationMs: 60_000, outcome: verdict === "verified" ? null : "failed" });
      await new Promise((resolve) => setTimeout(resolve, 20));
      if (verdict === "verified") await host.env.settleModelOutcome(id, verdict);
    };
    const route = async () => {
      const candidates = buildRoutingCandidates({ catalog, performance: await host.store.snapshot(), provider: "opencode", defaults: ["deepseek-v4.1-flash"], taskType: "coding-implement", role: "worker" });
      const picked = await selectTaskModel({ candidates, taskType: "coding-implement", role: "worker", task: "Rework the board contract" });
      return { model: picked.ok ? picked.model : "deepseek-v4.1-flash", picked, cost: (model) => candidates.find((row) => row.model === model).catalog.typicalCostUSD };
    };
    await go("d1", "deepseek-v4.1-flash", "verified");
    await go("d2", "deepseek-v4.1-flash", "failed");
    await go("d3", "deepseek-v4.1-flash", "failed");
    // One win in three is what the default's 0.40 prior expects: it keeps the work.
    assert.equal((await route()).picked.reason, "jev-unconfigured");
    // A real shortfall lends every other task to the cheapest model that could
    // beat it (glm-5.3-flash), never to glm-5.3 or kimi-k3 on their priors.
    await go("d4", "deepseek-v4.1-flash", "failed");
    const picks = [];
    for (let index = 0; index < 8; index++) {
      const next = await route();
      picks.push(next.picked.exploration ? `${next.model}*` : next.model);
      if (index === 0) assert.ok(next.cost("glm-5.3-flash") < next.cost("glm-5.3") && next.cost("glm-5.3") < next.cost("kimi-k3"));
      await go(`loop_${index}`, next.model, "failed");
    }
    // A starred pick is an exploratory turn. Four default outcomes lend two
    // turns, then the default takes every other task and its record keeps
    // moving. deepseek-v4-pro (the next cheapest) gets a turn whenever
    // glm-5.3-flash's own failures stop it clearing the margin, and after its
    // third turn glm-5.3-flash is only compared by its record.
    assert.deepEqual(picks, ["glm-5.3-flash*", "glm-5.3-flash*", "deepseek-v4.1-flash", "deepseek-v4-pro*", "deepseek-v4.1-flash", "glm-5.3-flash*", "deepseek-v4.1-flash", "deepseek-v4-pro*"]);
    assert.ok(!picks.some((pick) => /^(glm-5\.3|glm-5\.2|kimi-k3)\*?$/.test(pick)), "the costliest priors never get a turn while cheaper challengers remain");
  } finally {
    await host.cleanup();
  }
});
