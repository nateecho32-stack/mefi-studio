import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import * as assistant from "../scripts/assistant.mjs";

const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 40; i += 1) await Promise.resolve(); };

function poolHost({ parallel = 2, aiParallel = 2, switching = false } = {}) {
  let now = 1000, seq = 0;
  const timers = new Map(), events = [], started = [], intel = [];
  const pool = { queue: [], running: new Map(), seq: 0, waiters: [] };
  const state = assistant.emptyState(now);
  state.status = "running";
  state.prefs = { ...state.prefs, parallel, aiParallel };
  const env = vm.createContext({
    console, pool, assistantState: state, assistantModule: assistant,
    Date: class extends Date { static now() { return now; } },
    ASSISTANT_PRIORITY: { cadence: 1, demand: 2, responder: 3 },
    ASSISTANT_JOB_TIMEOUT_MS: 150000, EXECUTOR_PARALLEL_MAX: 12, AI_PARALLEL_MAX: 6,
    projectSwitching: switching, projectAgentJobs: 0, CLI_MODE: true, assistantStopping: false,
    projects: { current: () => ({ id: "fixture" }), run: (_project, call) => call() },
    setTimeout(fn, ms) { const id = ++seq; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    assistantRoleTargets: () => [{ kind: "assistant", id: "assistant" }],
    assistantJobId: () => `saved_${++seq}`,
    assistantJobLabel: (role, work) => `${role} · ${work.text}`,
    assistantJournal(entry) { env.assistantState = assistant.applyWork(env.assistantState, entry, now); },
    assistantWrite: async () => {}, assistantLog() {}, logError(text, role) { env.assistantLog("error", text, null, role); }, logLine() {}, assistantReportIntel(...args) { intel.push(args); },
    // The mail channel is its own suite (assistant_mail.test.mjs): here a
    // starting job takes nothing and a settling one sends nothing.
    assistantTakeMail: () => [], assistantDeliverMail: () => 0,
    assistantAgentEvent(...args) { events.push(args); },
    assistantThink(text, role) { env.assistantState.thinking = { text, role }; },
    assistantThinkClear(role) { if (env.assistantState.thinking?.role === role) env.assistantState.thinking = null; },
  });
  vm.runInContext([
    section("function assistantRowTargets(", "// Roster label"),
    section("function assistantPoolCounts(", "function assistantAgentEvent("),
    section("function enqueue(", "// ---- role jobs:"),
  ].join("\n"), env);
  function add(role, key, options = {}) {
    const task = deferred();
    const promise = env.enqueue(role, () => { started.push(key); return task.promise; }, { key, ...options });
    return { ...task, promise, entry: () => pool.queue.find((job) => job.key === key) ?? [...pool.running.values()].find((job) => job.key === key) };
  }
  return { env, pool, timers, events, started, intel, add, advance(ms) { now += ms; }, async fire(id = timers.keys().next().value) { const timer = timers.get(id); timers.delete(id); now += timer.ms; timer.fn(); await flush(); }, row(role) { return env.assistantState.agents.find((row) => row.role === role); } };
}

test("demand promotes the existing queued cadence job without duplicating it", async () => {
  const h = poolHost({ parallel: 1, switching: true });
  h.add("auditor", "auditor");
  const watcher = h.add("watcher", "watcher");
  const duplicate = h.env.enqueue("watcher", () => assert.fail("duplicate ran"), { key: "watcher", priority: 2 });
  assert.equal(duplicate, watcher.promise);
  assert.equal(h.pool.queue.length, 2);
  h.env.projectSwitching = false;
  h.env.assistantPump();
  await flush();
  assert.deepEqual(h.started, ["watcher"]);
});

test("Machine runs with a full background pool while its next pass remains singleton", async () => {
  const h = poolHost({ parallel: 1, aiParallel: 1 });
  h.add("briefer", "background", { ai: true });
  h.add("keeper", "queued tidy");
  const machine = h.add("machine", "resource scan");
  h.add("machine", "next resource scan");
  await flush();
  assert.deepEqual(h.started, ["background", "resource scan"]);
  assert.equal(h.pool.running.size, 2);
  assert.equal([...h.pool.running.values()].filter((job) => job.role === "machine").length, 1);
  machine.resolve({ ok: true });
  await flush();
  assert.deepEqual(h.started, ["background", "resource scan", "next resource scan"]);
  assert.equal(h.pool.running.size, 2, "Machine's next pass does not consume the occupied background slot");
  assert.equal(h.pool.queue[0].key, "queued tidy");
});

test("a timed-out Machine pass retains ownership without blocking independent background work", async () => {
  const h = poolHost({ parallel: 1 });
  const machine = h.add("machine", "slow resource scan");
  const background = h.add("briefer", "background");
  h.add("machine", "replacement resource scan");
  h.add("keeper", "next background job");
  await flush();
  await h.fire();
  assert.equal((await machine.promise).ok, false);
  assert.equal(machine.entry().timedOut, true);
  assert.equal(h.env.projectAgentJobs, 2, "timeout retains the live operation's project ownership");
  assert.match(h.row("machine").text, /timed out.*slot held/);
  background.resolve({ ok: true });
  await flush();
  assert.deepEqual(h.started, ["slow resource scan", "background", "next background job"]);
  assert.equal([...h.pool.running.values()].filter((job) => job.role === "machine").length, 1);
  assert.equal(h.pool.queue[0].key, "replacement resource scan");
  machine.resolve({ ok: true });
  await flush();
  assert.deepEqual(h.started, ["slow resource scan", "background", "next background job", "replacement resource scan"]);
  assert.equal([...h.pool.running.values()].filter((job) => job.role === "machine").length, 1);
  assert.equal(h.row("machine").status, "running");
  assert.doesNotMatch(h.row("machine").text, /timed out/);
});

test("new demand during a running foreman coalesces into one pass after it settles", async () => {
  const h = poolHost({ parallel: 1 });
  const passes = [deferred(), deferred()];
  let starts = 0;
  const original = h.env.enqueue("foreman", () => {
    starts += 1;
    assert.ok(starts <= 2, "one demand burst creates at most one extra pass");
    return passes[starts - 1].promise;
  });
  await flush();
  for (let index = 0; index < 8; index += 1) {
    const duplicate = h.env.enqueue("foreman", () => assert.fail("duplicate function ran"), { priority: 2 });
    assert.equal(duplicate, original);
  }
  await flush();
  assert.equal(starts, 1, "a demand burst cannot overlap the live dispatcher");
  assert.equal(h.pool.running.size, 1);
  assert.equal(h.pool.queue.length, 0);
  passes[0].resolve({ ok: true });
  await flush();
  assert.equal(starts, 2);
  assert.equal(h.pool.running.size, 1);
  passes[1].resolve({ ok: true });
  await flush();
  assert.equal(starts, 2);
  assert.equal(h.pool.running.size, 0);
  assert.equal(h.pool.queue.length, 0);
});

test("Pause before the foreman settles prevents replay of a coalesced demand", async () => {
  const h = poolHost();
  const foreman = h.add("foreman", "dispatch");
  h.env.enqueue("foreman", () => assert.fail("duplicate function ran"), { key: "dispatch", priority: 2 });
  await flush();
  assert.equal(foreman.entry().rerunRequested, true);
  h.env.assistantState.status = "paused";
  foreman.resolve({ ok: true });
  await flush();
  assert.deepEqual(h.started, ["dispatch"]);
  assert.equal(h.pool.running.size, 0);
  assert.equal(h.pool.queue.length, 0);
  h.env.assistantState.status = "running";
  h.env.assistantPump();
  await flush();
  assert.deepEqual(h.started, ["dispatch"], "Resume does not replay a pre-Pause request");
});

test("an older cadence pass wins after aging instead of starving behind new demand", async () => {
  const h = poolHost({ parallel: 1, switching: true });
  h.add("watcher", "old scan");
  h.advance(120000);
  h.add("auditor", "new audit", { priority: 2 });
  h.env.projectSwitching = false;
  h.env.assistantPump();
  await flush();
  assert.deepEqual(h.started, ["old scan"]);
});

test("reply bursts are bounded while width-one background work and the foreman can proceed", async () => {
  const h = poolHost({ parallel: 1, aiParallel: 1 });
  const replies = Array.from({ length: 8 }, (_, index) => h.add("responder", `reply${index}`, { ai: true, priority: 3 }));
  h.add("auditor", "requested audit");
  h.add("keeper", "queued tidy");
  h.add("foreman", "dispatch");
  h.add("foreman", "second dispatch");
  await flush();
  assert.deepEqual(h.started, ["reply0", "requested audit", "dispatch"]);
  assert.equal(h.pool.running.size, 3);
  replies[0].resolve({ ok: true });
  await flush();
  assert.equal(h.started.at(-1), "reply1");
  assert.equal([...h.pool.running.values()].filter((job) => job.role === "responder").length, 1);
});

test("background AI width and the two-reply ceiling apply independently", async () => {
  const h = poolHost({ parallel: 4, aiParallel: 3 });
  for (let i = 0; i < 6; i += 1) h.add("responder", `reply${i}`, { ai: true });
  for (const role of ["briefer", "improver", "grower", "ideas"]) h.add(role, role, { ai: true });
  await flush();
  assert.equal(h.started.filter((key) => key.startsWith("reply")).length, 2);
  assert.equal(h.started.filter((key) => !key.startsWith("reply")).length, 3);
});

test("queueing and finishing a reply preserves the other reply's running status and target", async () => {
  const h = poolHost();
  const first = h.add("responder", "first", { work: { id: "first", kind: "responder", text: "first question" } });
  h.advance(500);
  const second = h.add("responder", "second", { work: { id: "second", kind: "responder", text: "second question" }, targets: [{ kind: "task", id: "task:two" }] });
  h.add("responder", "third", { work: { id: "third", kind: "responder", text: "third question" } });
  assert.equal(h.row("responder").status, "running", "queued third reply cannot hide active replies");
  assert.match(h.row("responder").text, /2 replies/);
  first.resolve({ ok: true, text: "answered first" });
  await flush();
  assert.equal(h.row("responder").status, "running");
  assert.equal(h.row("responder").since, second.entry().startedAt);
  assert.equal(h.row("responder").target.id, "task:two");
  assert.notEqual(h.row("responder").progress, 1);
  assert.match(h.env.assistantState.thinking.text, /second question/);
  assert.equal(h.row("responder").runs, 1, "restoring the live row must not count a second completion");
  assert.equal(h.env.assistantState.work.some((job) => job.id === "first"), false);
  assert.equal(h.env.assistantState.work.some((job) => job.id === "second"), true);
});

test("Pause retains queued handoff work but a settling job cannot start it", async () => {
  const h = poolHost({ parallel: 1 });
  const active = h.add("reference", "active");
  h.add("reference", "saved", { work: { id: "saved", kind: "reference", text: "gather references" } });
  h.add("watcher", "cadence");
  h.env.assistantState.status = "paused";
  h.env.assistantClearQueue({ text: "paused" });
  active.resolve({ ok: true });
  await flush();
  assert.deepEqual(h.started, ["active"]);
  assert.equal(h.pool.queue.length, 1);
  assert.equal(h.pool.queue[0].key, "saved");
  assert.equal(h.env.assistantState.work[0].id, "saved");
  assert.equal(h.env.assistantState.thinking, null, "waiting work cannot retain a finished role's live thought");
  h.env.assistantState.status = "running";
  h.env.assistantPump();
  await flush();
  assert.deepEqual(h.started, ["active", "saved"]);
});

test("paused restart retains saved jobs without charging an unstarted attempt, then Resume starts them", async () => {
  const h = poolHost({ parallel: 2 });
  h.env.assistantState.status = "paused";
  Object.assign(h.env, {
    assistantWorkLabel: (job) => job.text,
    assistantInFlight: (id) => h.pool.queue.some((job) => job.key === id) || [...h.pool.running.values()].some((job) => job.key === id),
    assistantWorkJob: (job) => ({ role: job.role, ai: false, targets: [], run: () => { h.started.push(job.id); return new Promise(() => {}); } }),
    ASSISTANT_ROLE_JOBS: {}, applyKeepAwake() {}, saveAssistant: async () => {}, assistantLoop: false,
  });
  vm.runInContext(section("function assistantRestartWork(", "// Boot: what the previous process"), h.env);
  vm.runInContext(section("async function assistantResume()", "// ---- 24/7:"), h.env);
  h.env.assistantRestartWork({ jobs: [
    { id: "waiting", role: "reference", kind: "reference", text: "waiting gather", attempts: 3, status: "queued" },
    { id: "interrupted", role: "ideas", kind: "ideas", text: "interrupted scan", attempts: 2, status: "running" },
  ] });
  await flush();
  assert.deepEqual(h.started, []);
  assert.equal(h.pool.queue.length, 2);
  assert.equal(h.env.assistantState.work.find((job) => job.id === "waiting").attempts, 3);
  assert.equal(h.env.assistantState.work.find((job) => job.id === "interrupted").attempts, 3);
  assert.ok(h.env.assistantState.work.every((job) => job.status === "queued"));
  await h.env.assistantResume();
  await flush();
  assert.deepEqual(h.started, ["waiting", "interrupted"]);
});

for (const manual of [false, true]) test(`${manual ? "manual" : "cadence"} repair awaiting the store cannot undo a newer operator Pause`, async () => {
  const store = deferred();
  let resumes = 0, writes = 0;
  const state = { status: "running" };
  const env = vm.createContext({
    assistantState: state,
    getEyes: () => store.promise,
    assistantResume: async () => { resumes += 1; state.status = "running"; },
    mutateBoard: async () => { writes += 1; },
  });
  vm.runInContext(section("async function assistantOverseerRepair(", "// overseer: the R&D layer"), env);
  const pending = env.assistantOverseerRepair(1000, { manual });
  state.status = "paused";
  store.resolve({});
  const result = await pending;
  assert.equal(resumes, 0);
  assert.equal(writes, 0);
  assert.equal(state.status, "paused");
  assert.match(result.directives[0].text, /paused by operator/);
});

test("abandoned running operations release their project ownership without a late double release", async () => {
  const h = poolHost({ parallel: 1 });
  const job = h.add("briefer", "long provider call");
  await flush();
  assert.equal(h.env.projectAgentJobs, 1);
  h.env.assistantClearQueue({ abandonRunning: true, text: "stopped" });
  assert.equal(h.env.projectAgentJobs, 0, "an abandoned operation no longer blocks a project switch");
  job.resolve({ ok: true });
  await flush();
  assert.equal(h.env.projectAgentJobs, 0, "a late result cannot release the same ownership twice");
});

test("a never-settling operation reports its deadline but retains its slot and durable journal through Pause", async () => {
  const h = poolHost({ parallel: 1 });
  const stuck = h.add("briefer", "stuck", { ai: true, work: { id: "stuck", kind: "brief", text: "long provider request" } });
  h.add("briefer", "replacement", { ai: true, work: { id: "replacement", kind: "brief", text: "next provider request" } });
  let drained = false;
  h.env.assistantDrain().then(() => { drained = true; });
  await flush();
  await h.fire();
  const failure = await stuck.promise;
  assert.equal(failure.ok, false);
  assert.match(failure.error, /still running.*slot remains held/);
  assert.equal(h.pool.running.size, 1);
  assert.equal(h.env.projectAgentJobs, 1, "the project cannot switch underneath pending work");
  assert.equal(h.pool.queue.length, 1);
  assert.equal(h.row("briefer").status, "running");
  assert.match(h.row("briefer").text, /timed out.*slot held/);
  assert.equal(h.row("briefer").runs, 0, "deadline is not a finished attempt yet");
  assert.equal(h.env.assistantState.work.find((job) => job.id === "stuck").status, "running");
  h.env.assistantState.status = "paused";
  h.env.assistantClearQueue({ text: "paused" });
  h.env.assistantPump();
  await flush();
  assert.equal(drained, false);
  assert.deepEqual(h.started, ["stuck"]);
  assert.match(h.row("briefer").text, /timed out.*slot held/);
  assert.equal(h.env.assistantState.work.length, 2, "both interrupted and waiting handoffs remain recoverable");
});

for (const outcome of ["success", "rejection"]) test(`a timeout's late ${outcome} releases ownership once, before its replacement starts`, async () => {
  const h = poolHost({ parallel: 2 });
  const old = h.add("reference", "old", { work: { id: "old", kind: "reference", text: "old gather" } });
  const replacement = h.add("reference", "new", { work: { id: "new", kind: "reference", text: "new gather" } });
  const entry = old.entry();
  await flush();
  await h.fire();
  h.add("watcher", "independent");
  await flush();
  assert.deepEqual(h.started, ["old", "independent"], "unrelated roles continue while the same role waits");
  if (outcome === "success") old.resolve({ ok: true, text: "late success must not count as completed" });
  else old.reject(new Error("late provider failure"));
  await flush();
  assert.deepEqual(h.started, ["old", "independent", "new"]);
  assert.equal(h.row("reference").status, "running");
  assert.match(h.row("reference").text, /new gather/);
  assert.equal(h.env.assistantState.work.some((job) => job.id === "old"), false);
  assert.equal(h.env.assistantState.work.some((job) => job.id === "new"), true);
  assert.equal(h.intel.length, 0, "a late result cannot publish success intel");
  assert.equal(h.row("reference").runs, 1);
  h.env.assistantSettle(entry, { result: { ok: true, text: "duplicate late callback" } });
  assert.equal(h.row("reference").runs, 1);
  assert.equal(replacement.entry().settled, false);
  assert.match(h.row("reference").text, /new gather/);
});

test("a timed-out reply fences its entire role even when another reply slot becomes free", async () => {
  const h = poolHost();
  const old = h.add("responder", "old-reply");
  const other = h.add("responder", "other-reply");
  h.add("responder", "next-reply");
  await flush();
  await h.fire();
  vm.runInContext(section("async function assistantHop(", "// Record the targets already visited"), h.env);
  await h.env.assistantHop(other.entry(), { kind: "task", id: "peer-update" }, { progress: 1, label: "another reply looks healthy" });
  assert.match(h.row("responder").text, /timed out.*slot held/, "a peer animation cannot hide the held role");
  other.resolve({ ok: true });
  await flush();
  assert.deepEqual(h.started, ["old-reply", "other-reply"]);
  assert.match(h.row("responder").text, /timed out.*slot held/);
  old.resolve({ ok: true });
  await flush();
  assert.deepEqual(h.started, ["old-reply", "other-reply", "next-reply"]);
});

test("late animation hops cannot hide a timeout or invent completed progress", async () => {
  const h = poolHost();
  const old = h.add("reference", "slow gather");
  await flush();
  await h.fire();
  vm.runInContext(section("async function assistantHop(", "// Record the targets already visited"), h.env);
  await h.env.assistantHop(old.entry(), { kind: "task", id: "too-late" }, { progress: 1, label: "looks finished" });
  assert.equal(h.row("reference").progress, null);
  assert.match(h.row("reference").text, /timed out.*slot held/);
  assert.notEqual(h.row("reference").target?.id, "too-late");
});

function resumableHost(saved = null, { paused = false } = {}) {
  const h = poolHost({ parallel: 1 });
  const calls = [], pending = new Map();
  let snapshot = null;
  if (saved) h.env.assistantState = assistant.normalizeState(saved, 1000);
  h.env.assistantState.status = paused ? "paused" : "running";
  h.env.assistantState.prefs.parallel = 1;
  Object.assign(h.env, {
    ASSISTANT_HOP_MS: 500,
    ASSISTANT_ROLE_JOBS: Object.fromEntries(["watcher", "auditor", "improver", "foreman"].map((role) => [role, async (_now, entry) => {
      calls.push({ role, entry });
      const wait = deferred();
      pending.set(role, wait);
      return wait.promise;
    }])),
    assistantAiUsable: () => false,
    assistantWorkLabel: (work) => work.text,
    assistantInFlight: (id) => [...h.pool.queue, ...h.pool.running.values()].some((entry) => entry.key === id || entry.work?.id === id),
    assistantLoop: true, assistantTimer: null, applyKeepAwake() {}, clearAssistantAiProbe() {},
    saveAssistantSync() { snapshot = structuredClone(h.env.assistantState); },
  });
  vm.runInContext([
    section("async function assistantHop(", "// Record the targets already visited"),
    section("function assistantEnqueueRole(", "// On-demand roles"),
    section("function assistantWorkJob(", "// Boot: what the previous process"),
    section("function stopAssistant(", "async function assistantPause("),
  ].join("\n"), h.env);
  return { ...h, calls, pending, snapshot: () => snapshot };
}

test("normal exit saves the last roster jobs and their current progress before abandoning callbacks", async () => {
  const h = resumableHost();
  h.env.assistantEnqueueRole("watcher");
  h.env.assistantEnqueueRole("auditor");
  await flush();
  const entry = h.calls[0].entry;
  const target = { kind: "session", id: "last-session" };
  entry.targets = [{ kind: "session", id: "first-session" }, target];
  await h.env.assistantHop(entry, target, { progress: 0.5, label: "examining last session" });
  const checkpoint = h.env.assistantState.work.find((work) => work.role === "watcher");
  assert.equal(checkpoint.target.id, "last-session", "progress is saved during work, before shutdown");
  assert.equal(checkpoint.progress, 0.5);
  assert.equal(checkpoint.status, "running");
  h.env.stopAssistant();
  const saved = h.snapshot();
  assert.deepEqual(saved.work.map((work) => work.role), ["watcher", "auditor"]);
  assert.ok(saved.work.every((work) => work.status === "queued" && work.attempts === 1));
  assert.equal(saved.work[0].key, "watcher");
  assert.equal(saved.work[0].target.id, "last-session");
  assert.equal(saved.work[0].targets.length, 2);
  assert.equal(saved.work[0].progress, 0.5);
  assert.equal(h.pool.running.size, 0);
  assert.equal(h.pool.queue.length, 0);
  h.pending.get("watcher").resolve({ ok: true });
  await flush();
  assert.equal(h.env.assistantState.work.length, 2, "late callbacks cannot erase saved continuation work");
});

test("restored role jobs retain their targets and singleton keys when the startup cadence queues them again", async () => {
  const old = resumableHost();
  old.env.assistantEnqueueRole("watcher");
  old.env.assistantEnqueueRole("auditor");
  await flush();
  const entry = old.calls[0].entry;
  entry.targets = [{ kind: "session", id: "saved-target" }];
  await old.env.assistantHop(entry, entry.targets[0], { progress: 0.75 });
  old.env.stopAssistant();
  const h = resumableHost(old.snapshot());
  const pending = assistant.pendingWork(old.snapshot());
  h.env.assistantRestartWork(pending);
  h.env.assistantEnqueueRole("watcher");
  h.env.assistantEnqueueRole("auditor");
  h.env.assistantRestartWork(pending);
  await flush();
  assert.deepEqual(h.calls.map((call) => call.role), ["watcher"]);
  assert.equal(h.pool.running.size, 1);
  assert.equal(h.pool.queue.length, 1, "fresh ticks share the restored queued role");
  assert.equal(h.calls[0].entry.target.id, "saved-target");
  assert.equal(h.calls[0].entry.progress, 0.75);
  h.pending.get("watcher").resolve({ ok: true });
  await flush();
  assert.deepEqual(h.calls.map((call) => call.role), ["watcher", "auditor"]);
  assert.equal(h.env.assistantState.work.some((work) => work.role === "watcher"), false);
});

test("repeated intentional exits retain saved work without exhausting its interruption retry budget", async () => {
  let h = resumableHost();
  h.env.assistantEnqueueRole("watcher");
  await flush();
  for (let reload = 0; reload < 5; reload += 1) {
    h.env.stopAssistant();
    const saved = h.snapshot();
    h = resumableHost(saved);
    h.env.assistantRestartWork(assistant.pendingWork(saved));
    await flush();
    assert.equal(h.calls.length, 1);
    assert.equal(h.env.assistantState.work[0].attempts, 1);
  }
});

test("paused boot retains both saved jobs and legacy interrupted roles until Resume", async () => {
  const saved = assistant.emptyState(1);
  saved.status = "paused";
  saved.work = [{ id: "saved-role", key: "watcher", kind: "role", role: "watcher", payload: { role: "watcher" }, status: "queued", attempts: 1 }];
  saved.agents = [{ role: "auditor", status: "running" }];
  const h = resumableHost(saved, { paused: true });
  h.env.assistantRestartWork(assistant.pendingWork(saved));
  await flush();
  assert.equal(h.calls.length, 0);
  assert.equal(h.pool.queue.length, 2);
  assert.ok(h.pool.queue.every((entry) => entry.held));
  h.env.assistantState.status = "running";
  h.env.assistantPump();
  await flush();
  assert.equal(h.calls[0].role, "watcher");
});

test("explicit growth keeps its saved request semantics across a restart in backlog mode", async () => {
  const old = resumableHost();
  old.env.assistantState.prefs.backlogMode = true;
  old.env.assistantEnqueueRole("improver", 2, { explicitGrowth: true });
  await flush();
  assert.equal(old.calls[0].entry.automaticGrowth, false);
  old.env.stopAssistant();
  const saved = old.snapshot();
  const h = resumableHost(saved);
  h.env.assistantRestartWork(assistant.pendingWork(saved));
  await flush();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].role, "improver");
  assert.equal(h.calls[0].entry.automaticGrowth, false);
});

test("helper completions during a quit flush retain follow-ups without starting more work", async () => {
  const h = resumableHost();
  const finish = deferred();
  h.env.ASSISTANT_ROLE_JOBS.watcher = async () => {
    await finish.promise;
    h.env.assistantEnqueueRole("auditor", 2, { automatic: true });
    return { ok: true };
  };
  h.env.assistantEnqueueRole("watcher");
  await flush();
  h.env.stopAssistant();
  finish.resolve();
  await flush();
  assert.equal(h.calls.length, 0, "the late follow-up cannot spend a call while exiting");
  assert.equal(h.pool.running.size, 0);
  assert.equal(h.pool.queue[0].role, "auditor");
  assert.ok(h.env.assistantState.work.some((work) => work.role === "auditor"));
  assert.equal(h.env.assistantState.status, "running", "shutdown does not save an operator Pause");
  h.env.stopAssistant();
  assert.ok(h.snapshot().work.some((work) => work.role === "auditor" && work.status === "queued"));
});
