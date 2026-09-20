// Exercise the actual host loop against controlled I/O and timers. No Electron,
// live state, network, or paid calls: scheduling regressions fail without sleeps.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const section = (start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 60; i += 1) await Promise.resolve(); };
function timers() {
  const pending = new Map();
  let sequence = 0;
  return {
    pending,
    setTimeout(fn, ms) { const id = ++sequence; pending.set(id, { fn, ms }); return id; },
    clearTimeout(id) { pending.delete(id); },
    async fire() {
      const [id, { fn }] = pending.entries().next().value;
      pending.delete(id);
      fn();
      await flush();
    },
  };
}
function host(code, globals = {}) {
  const context = vm.createContext({ console, assistantState: null, projectSwitching: false, projectRoot: () => globals.REPO_ROOT ?? "/fixture", projects: { active: () => ({ id: "fixture" }), open: () => ({ id: "fixture" }), run: (_project, fn) => fn() }, ...globals });
  vm.runInContext(code, context, { filename: "main.cjs:loop-test" });
  return context;
}

function animationHost() {
  const clock = timers();
  const events = [];
  const env = host(section("async function assistantHop(", "// The session or task a message"), {
    ...clock,
    pool: { running: new Map() },
    ASSISTANT_HOP_MS: 900,
    assistantApply() {},
    assistantRowTargets() {},
    assistantAgentEvent(...args) { events.push(args); },
  });
  const entry = { role: "watcher", startedAt: Date.now(), lastHopAt: Date.now(), settled: false, targets: [] };
  return { env, clock, events, entry };
}

test("a twelve-node local pass releases its slot without any animation sleeps", async () => {
  const { env, clock, events, entry } = animationHost();
  const targets = Array.from({ length: 12 }, (_, id) => ({ kind: "session", id: String(id) }));
  let completed = false;
  const work = env.assistantVisit(entry, targets).then(() => { completed = true; });
  await flush();
  assert.equal(completed, true, "a finished scan must not wait 11.7 seconds to display its nodes");
  assert.equal(clock.pending.size, 0);
  assert.equal(entry.progress, 1);
  assert.equal(entry.target.id, "11");
  assert.equal(events.at(-1)[3].progress, 1, "the final target is still published");
  assert.ok(events.length <= 2, "fast visits do not flood the renderer");
  await work;
});

test("hover animation returns success or failure immediately and clears its timer", async () => {
  for (const fail of [false, true]) {
    const { env, clock, entry } = animationHost();
    const call = deferred();
    let result = null;
    const work = env.assistantVisitWhile(entry, call.promise, [{ kind: "session", id: "one" }])
      .then((value) => { result = value; }, (error) => { result = error; });
    await flush();
    assert.equal(clock.pending.size, 1, "the animation runs only while work is pending");
    const outcome = fail ? new Error("provider unavailable") : { ok: true };
    if (fail) call.reject(outcome); else call.resolve(outcome);
    await flush();
    assert.equal(result, outcome, "the network result must not wait for the next animation frame");
    assert.equal(clock.pending.size, 0, "completion must not retain animation timers");
    await work;
  }
});

test("a settled worker stops its hover without further target changes", async () => {
  const { env, clock, events, entry } = animationHost();
  const call = deferred();
  const work = env.assistantVisitWhile(entry, call.promise, [{ kind: "session", id: "one" }]);
  await flush();
  entry.settled = true;
  const count = events.length;
  await clock.fire();
  assert.equal(clock.pending.size, 0);
  assert.equal(events.length, count);
  call.resolve({ ok: true });
  await work;
});

test("concurrent store readers share a read, then observe fresh data on the next pass", async () => {
  const ready = deferred();
  let loads = 0, scans = 0, version = 1;
  const eyes = {
    listSessions() { scans += 1; return [{ id: `v${version}` }]; },
    listTodos: () => [], collisions: () => [], filePresence: () => [],
    listChanges: () => [], uncommittedOnly: () => [],
  };
  const env = host(`let assistantStoreReadInFlight = null;\n${section("async function assistantReadStore()", "async function assistantOrganize(")}`, {
    getEyes() { loads += 1; return ready.promise; }, readPorcelain: () => "",
    assistantCache: { chatsAt: Date.now() }, MINUTE_MS: 60000, REPO_ROOT: "fixture",
  });
  const first = env.assistantReadStore();
  const second = env.assistantReadStore();
  await flush();
  assert.equal(loads, 1);
  ready.resolve(eyes);
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, b);
  assert.equal(scans, 1);
  version = 2;
  const fresh = await env.assistantReadStore();
  assert.equal(fresh.sessions[0].id, "v2", "a completed read is not a stale cache entry");
  assert.equal(scans, 2);
  env.getEyes = async () => { throw new Error("store closed"); };
  await assert.rejects(env.assistantReadStore(), /store closed/);
  env.getEyes = async () => eyes;
  assert.equal((await env.assistantReadStore()).sessions[0].id, "v2", "failure does not poison the shared read");
});

test("chat starts independent facts together and preserves facts when one source fails", async () => {
  const sources = new Map();
  const read = (name) => { const gate = deferred(); sources.set(name, gate); return gate.promise; };
  const env = host(section("async function assistantMessageFacts(", "function assistantMessageId()"), {
    assistantReadStore: () => read("store"),
    getEyes: async () => ({ readJson: (name) => read(name) }),
    resourcePass: () => read("machine"), getAuditor: async () => ({ audit: () => read("audit") }),
    TASKS_PATH: "tasks", IDEAS_PATH: "ideas", REQUESTS_PATH: "requests", BRIEFING_PATH: "briefing",
    assistantCache: {}, assistantState: {}, autopilot: {}, updater: null,
    getAssistant: async () => ({ buildFacts: (facts) => facts, suggestWork: () => [] }),
  });
  const work = env.assistantMessageFacts(Date.now(), "what is next");
  await flush();
  assert.deepEqual([...sources.keys()].sort(), ["audit", "briefing", "ideas", "machine", "requests", "store", "tasks"]);
  sources.get("store").reject(new Error("OpenCode unavailable"));
  sources.get("tasks").reject(new Error("tasks unavailable"));
  sources.get("ideas").resolve([{ id: "idea" }]);
  sources.get("requests").resolve([{ title: "request" }]);
  sources.get("briefing").resolve({ summary: "summary", alerts: [] });
  sources.get("machine").resolve({ running: [], lines: "quiet" });
  sources.get("audit").resolve({ errors: 0, warnings: 0, findings: [] });
  const facts = await work;
  assert.equal(facts.sessions, null);
  assert.equal(facts.tasks, null);
  assert.equal(facts.ideas[0].id, "idea");
  assert.equal(facts.requests[0].title, "request");
  assert.equal(facts.briefing.summary, "summary");
  assert.equal(facts.audit.errors, 0);
});

function tickHost() {
  const key = deferred();
  const queued = [];
  let reads = 0, supervised = 0;
  const state = { status: "running", tickCount: 2, ai: {}, prefs: {}, organization: {}, problems: [] };
  const env = host(`let assistantTickInFlight = null, assistantTickDemand = null;\n${section('async function assistantTick(reason = "timer")', "async function startAssistant()")}`, {
    assistantState: state,
    ensureAssistant: async () => state,
    assistantKeyPresent() { reads += 1; return key.promise; },
    assistantFirstTickResolve: Object.assign(() => {}, { done: true }),
    getAssistant: async () => ({ dueRoles: () => ["watcher"] }),
    ASSISTANT_CADENCE_ROLES: ["watcher"], ASSISTANT_AI_ROLES: new Set(),
    ASSISTANT_PRIORITY: { cadence: 1, demand: 2 },
    assistantEnqueueRole: (role) => queued.push(role), assistantStaleWork() {},
    assistantSuperviseJobs() { supervised += 1; },
    assistantLog() {}, saveAssistant: async () => {},
    assistantLoop: false, window: null, autopilot: { execute: true, jobs: [] },
  });
  return { env, key, queued, state, reads: () => reads, supervised: () => supervised };
}

test("overlapping ticks share one cadence pass and release the lock on completion", async () => {
  const { env, key, queued, reads, state } = tickHost();
  const first = env.assistantTick();
  const second = env.assistantTick();
  await flush();
  assert.equal(reads(), 1);
  key.resolve(false);
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, b);
  assert.deepEqual(queued, ["watcher"]);
  assert.equal(state.tickCount, 3);
  await env.assistantTick();
  assert.equal(reads(), 2);
  env.assistantKeyPresent = async () => { throw new Error("settings failed"); };
  await assert.rejects(env.assistantTick(), /settings failed/);
  env.assistantKeyPresent = async () => false;
  await env.assistantTick();
  assert.equal(queued.length, 3, "a failed tick does not lock out subsequent ticks");
});

test("pausing during a tick's settings read prevents late cadence work", async () => {
  const { env, key, queued, state, supervised } = tickHost();
  const pending = env.assistantTick();
  await flush();
  state.status = "paused";
  key.resolve(false);
  assert.equal((await pending).skipped, "paused");
  assert.deepEqual(queued, []);
  assert.equal(supervised(), 0);
  await env.assistantTick();
  assert.deepEqual(queued, [], "a queued timer cannot restart a paused service");
  await env.assistantTick("control");
  assert.deepEqual(queued, ["watcher"], "an explicit run-once control remains available while paused");
});

test("a manual tick arriving during a timer pass runs once afterward", async () => {
  const { env, key, queued, reads } = tickHost();
  env.getAssistant = async () => ({ dueRoles: () => [] });
  const timer = env.assistantTick();
  const click = env.assistantTick("control");
  const repeated = env.assistantTick("control");
  await flush();
  assert.equal(reads(), 1, "the explicit tick waits for the active pass");
  key.resolve(false);
  await Promise.all([timer, click, repeated]);
  assert.equal(reads(), 2, "repeated clicks coalesce into one follow-up");
  assert.deepEqual(queued, ["watcher"], "the forced request is not lost to an empty cadence pass");
});

function executorHost(parallel) {
  const clock = timers();
  let spawns = 0;
  const autopilot = { execute: true, parallel, jobs: [] };
  const env = host(section("let executorFillInFlight = null;", "// Work the assistant does on its own plumbing"), {
    ...clock, SMOKE: false, CAPTURE: false, CLI_MODE: false, autopilot,
    EXECUTOR_STAGGER_MS: 3000, executorUpdateHold: () => null,
    async spawnNextJob() { spawns += 1; autopilot.jobs.push({ id: spawns }); return "spawned"; },
    setAutopilotWaiting() {}, logLine() {}, pushAutopilotHistory() {},
  });
  return { env, clock, autopilot, spawns: () => spawns };
}

test("filling the final executor slot does not retain a three-second dispatch lock", async () => {
  const { env, clock, spawns } = executorHost(1);
  let done = false;
  const first = env.executeNextRequest().then(() => { done = true; });
  const concurrent = env.executeNextRequest();
  await flush();
  assert.equal(done, true);
  assert.equal(spawns(), 1, "overlapping dispatches cannot claim an extra slot");
  assert.equal(clock.pending.size, 0);
  await Promise.all([first, concurrent]);
});

test("executor startup staggering still separates successive slots", async () => {
  const { env, clock, spawns } = executorHost(2);
  const work = env.executeNextRequest();
  await flush();
  assert.equal(spawns(), 1);
  assert.equal(clock.pending.size, 1);
  assert.equal([...clock.pending.values()][0].ms, 3000);
  await clock.fire();
  await work;
  assert.equal(spawns(), 2);
  assert.equal(clock.pending.size, 0, "the final slot has no trailing stagger");
});

test("autopilot intervals cannot overlap an unfinished paid pass or run while disabled", async () => {
  const pass = deferred();
  let calls = 0, asks = 0, housekeeping = 0;
  const autopilot = { enabled: true };
  const env = host(`let autopilotTicks = 0;\n${section("let autopilotPassInFlight = null;", "async function setAutopilot(")}`, {
    SMOKE: false, CAPTURE: false, CLI_MODE: false, autopilot, TASKS_PATH: "tasks",
    getEyes: async () => ({ readJson: async () => [] }),
    autopilotProactivePass() { calls += 1; return pass.promise; },
    async autopilotHousekeeping() { housekeeping += 1; },
    promoteRequestsToTasks: async () => {}, refreshAutopilotQueue: async () => {},
    pushAutopilotHistory() {}, emitAutopilot() {}, logLine() {},
    assistantAskForWork() { asks += 1; },
  });
  const first = env.autopilotPass();
  const second = env.autopilotPass();
  await flush();
  assert.equal(calls, 1, "one interval cannot duplicate an in-flight model call");
  assert.equal(housekeeping, 0);
  pass.resolve({ added: 2 });
  await Promise.all([first, second]);
  assert.equal(asks, 1);
  assert.equal(housekeeping, 1);
  autopilot.enabled = false;
  await env.autopilotPass();
  assert.equal(calls, 1, "a delayed boot pass honors the disabled switch");
  autopilot.enabled = true;
  await env.autopilotPass();
  assert.equal(calls, 2);
});

test("idle foreman does not spin the compactor on a recently reviewed unrunnable route", async () => {
  const now = Date.now();
  const queued = [];
  const state = { agents: [{ role: "compactor", lastRunAt: now }, { role: "ideas", lastRunAt: now }] };
  const autopilot = { execute: true, jobs: [], parallel: 1 };
  const env = host(section("async function assistantForemanJob(", "// The thinker: the assistant itself."), {
    autopilot, executeNextRequest: async () => {}, assistantState: state, assistantCache: {},
    autopilotHousekeeping: async () => {}, promoteRequestsToTasks: async () => {},
    MINUTE_MS: 60000, ASSISTANT_PRIORITY: { demand: 2 },
    assistantEnqueueRole: (role) => queued.push(role),
  });
  await env.assistantForemanJob(now, {});
  assert.deepEqual(queued, []);
  state.agents[0].lastRunAt = now - 60000;
  await env.assistantForemanJob(now, {});
  assert.deepEqual(queued, ["compactor"], "the idle queue is still reviewed after its cooldown");
  queued.length = 0;
  autopilot.execute = false;
  await env.assistantForemanJob(now, {});
  assert.deepEqual(queued, [], "executor-off must not churn background queue reviews");
});
