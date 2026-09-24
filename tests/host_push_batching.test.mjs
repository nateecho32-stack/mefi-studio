// The host's high-frequency paths to the renderer and the disk: worker log
// lines are batched per beat, whole-board pushes are coalesced, unending
// output lines stay bounded, overlapping queue-status reads share one board
// read, and the machine watch writes its diagnostics only when they change.
// Each slice below is the real main.cjs code between two literal markers.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createProjects } = require("../scripts/projects.cjs");
const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
};

function clock() {
  let now = 1000, seq = 0;
  const timers = new Map();
  return {
    Date: class extends Date { static now() { return now; } },
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { fn, at: now + ms }); return { id, unref() {} }; },
    clearTimeout: (handle) => { if (handle) timers.delete(handle.id); },
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at <= now && timers.has(id)) { timers.delete(id); timer.fn(); }
      }
    },
    pending: () => timers.size,
  };
}

function logHost() {
  const time = clock(), sent = [];
  const context = vm.createContext({ ...time, send: (channel, payload) => sent.push({ channel, payload }), activeChild: null });
  vm.runInContext(section("// Worker output reaches the log", "function runLove("), context);
  return { context, time, sent };
}

test("log lines inside one beat reach the renderer as one batch, in order", () => {
  const { context, time, sent } = logHost();
  context.logLine("first");
  context.logLine("second\n");
  context.logLine("third");
  assert.equal(sent.length, 0, "nothing is sent per line");
  time.advance(100);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].channel, "studio:log");
  assert.deepEqual([...sent[0].payload], ["first", "second", "third"]);
  context.logLine("later");
  time.advance(100);
  assert.deepEqual([...sent[1].payload], ["later"]);
  time.advance(1000);
  assert.equal(sent.length, 2, "an empty beat sends nothing");
});

test("a burst keeps its newest lines and says how many it skipped; long lines are clipped", () => {
  const { context, time, sent } = logHost();
  for (let index = 0; index < 1000; index += 1) context.logLine(`line ${index}`);
  context.logLine("x".repeat(9000));
  time.advance(100);
  const lines = [...sent[0].payload];
  assert.equal(lines[0], "[studio] 601 earlier log lines skipped in a burst");
  assert.equal(lines[1], "line 601");
  assert.equal(lines.length, 401);
  assert.ok(lines.at(-1).startsWith("x".repeat(4000)));
  assert.ok(lines.at(-1).endsWith("(5000 more characters)"));
});

test("a launched child's lines split across chunks, CRLF included, and an unending line stays bounded", () => {
  const { context, time, sent } = logHost();
  const child = new EventEmitter();
  child.pid = 7;
  child.stdout = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr = null;
  context.streamChild(child, "game");
  child.stdout.emit("data", "alpha\r");
  child.stdout.emit("data", "\nbe");
  child.stdout.emit("data", "ta\ngam");
  child.stdout.emit("data", "ma\n\n  \n");
  child.stdout.emit("data", "y".repeat(70000));
  child.stdout.emit("data", "y".repeat(70000));
  child.stdout.emit("end");
  time.advance(100);
  const lines = [...sent[0].payload];
  assert.deepEqual(lines.slice(0, 4), ["[game] started pid 7", "alpha", "beta", "gamma"]);
  assert.equal(lines.length, 5);
  assert.ok(lines[4].startsWith("y".repeat(4000)) && lines[4].endsWith("(61536 more characters)"), "the partial line was held to 64 KiB before the log clipped it");
});

function pushHost() {
  const time = clock(), sent = [];
  let active = { id: "a" };
  const window = { isDestroyed: () => false, webContents: { send: (channel, payload) => sent.push({ channel, payload }) } };
  const context = vm.createContext({ ...time, window, projects: { current: () => active, active: () => active } });
  vm.runInContext(section("function send(channel, payload) {", "// registerIpc installs"), context);
  return { context, time, sent, switchTo: (id) => { active = { id }; } };
}

test("board pushes: the first goes at once, a burst shares one trailing push of the newest list", () => {
  const { context, time, sent } = pushHost();
  context.send("eyes:tasks", ["v1"]);
  assert.equal(sent.length, 1, "a quiet board pushes immediately");
  context.send("eyes:tasks", ["v2"]);
  context.send("eyes:tasks", ["v3"]);
  context.send("eyes:requests", ["r1"]);
  context.send("machine:status", { ok: true });
  assert.deepEqual(sent.map((item) => item.channel), ["eyes:tasks", "eyes:requests", "machine:status"], "other channels are never held");
  time.advance(250);
  assert.deepEqual(sent.at(-1), { channel: "eyes:tasks", payload: ["v3"] });
  assert.equal(sent.filter((item) => item.channel === "eyes:tasks").length, 2);
  time.advance(250);
  assert.equal(sent.filter((item) => item.channel === "eyes:tasks").length, 2, "nothing new, nothing sent");
  assert.equal(time.pending(), 0);
});

test("a board list held for one project is dropped when the owner switches to another", () => {
  const { context, time, sent, switchTo } = pushHost();
  context.send("eyes:tasks", ["a1"]);
  context.send("eyes:tasks", ["a2"]);
  switchTo("b");
  time.advance(250);
  assert.deepEqual(sent.map((item) => item.payload), [["a1"]]);
  context.send("eyes:tasks", ["b1"]);
  assert.deepEqual(sent.at(-1).payload, ["b1"]);
});

test("overlapping queue-status asks share one board read; a later ask reads again", async () => {
  let reads = 0, open, gate = new Promise((resolve) => { open = resolve; });
  const project = { id: "p1", path: "/p1" };
  const context = vm.createContext({
    Date, console, Map,
    projects: { current: () => project },
    ensureAssistant: async () => ({}), getAssistant: async () => ({ backlogIdeaEligible: () => true }),
    withBoardLock: async (fn) => fn(),
    getEyes: async () => ({ readJson: async () => { reads += 1; await gate; return []; } }),
    backlog: { summarizeBacklog: () => ({ counts: { ready: 0 } }) },
    autopilot: { jobs: [], autoBuild: true, execute: true }, assistantState: { status: "running", prefs: {} }, compareWork: () => 0,
    TASKS_PATH: "t", REQUESTS_PATH: "r", IDEAS_PATH: "i",
  });
  vm.runInContext(section("// Command, the Workspace and the Tasks sheet ask", "async function admitBacklogIdeas("), context);
  const first = context.backlogStatus();
  const second = context.backlogStatus();
  open();
  const [status, shared] = await Promise.all([first, second]);
  assert.equal(status.projectId, "p1");
  assert.equal(shared, status, "both asks got the one result");
  assert.equal(reads, 3, "one read of each board file");
  await context.backlogStatus();
  assert.equal(reads, 6, "a settled read is not reused");
});

test("the machine watch rewrites its diagnostics only when they change, or once a minute", async () => {
  let now = 100000;
  const writes = [];
  const events = [];
  let verdict = [];
  const context = vm.createContext({
    Date: class extends Date { static now() { return now; } },
    autopilot: { jobs: [], capacity: null, resourceBackoffUntil: 0 },
    logLine() {},
    getMachine: async () => ({
      leaseStatus: async () => ({ busy: false, exclusive: false, totalWidth: 0, holders: [] }),
      workerCapacity: async () => ({ canStart: true, reason: null, resources: { cpuPercent: Math.random() * 100 } }),
      processSnapshot: async () => [],
      classify: () => ({ verdicts: verdict }),
      describe: () => "",
    }),
    getEyes: async () => ({ writeJson: async (file) => { writes.push(file); } }),
    readSettings: async () => ({}), machineMemoryWarnOverride: () => false,
    MACHINE_DEFAULTS: { autoKill: true }, MACHINE_STATUS_PATH: "status.json", RESOURCE_LOG_PATH: "resource.json",
    machineEvents: events, machinePreviousCpu: new Map(), spawn() {}, queueRequests: async () => {}, send() {}, projectRoot: () => ".",
    measureWorkerLag: async () => 5,
  });
  vm.runInContext(section("async function resourcePass(", "function startMachineWatch()"), context);
  await context.resourcePass({ kill: false, reason: "poll" });
  assert.deepEqual(writes, ["status.json", "resource.json"], "the first pass writes both");
  writes.length = 0;
  now += 10000;
  await context.resourcePass({ kill: false, reason: "poll" });
  assert.deepEqual(writes, [], "a pass that only moved the live readings writes nothing");
  verdict = [{ pid: 9, status: "running", killable: false, test: true }];
  now += 10000;
  await context.resourcePass({ kill: false, reason: "poll" });
  assert.deepEqual(writes, ["status.json"], "a new process verdict is written");
  writes.length = 0;
  now += 60000;
  await context.resourcePass({ kill: false, reason: "poll" });
  assert.deepEqual(writes, ["status.json"], "and the readings refresh at least once a minute");
  writes.length = 0;
  verdict = [{ pid: 9, status: "hung", killable: true, test: true, name: "love.exe", commandLine: "love ." }];
  now += 1000;
  await context.resourcePass({ kill: true, reason: "poll" });
  assert.deepEqual(writes, ["status.json", "resource.json"], "a kill lands in both files");
  assert.equal(events.length, 1);
});

test("the store facade is kept per module and project, so its session scope carries across calls", async () => {
  let idReads = 0;
  const fake = { listSessionIds: async () => { idReads += 1; return ["a"]; }, listTodos: async () => [{ sessionId: "a" }, { sessionId: "b" }], readJson: async () => [], writeJson: async () => {} };
  const projects = createProjects({ defaultRoot: "/proj", studioRoot: "/studio", isDirectory: () => true });
  projects.select(projects.add("/proj").id);
  const first = projects.eyes(fake);
  assert.equal(projects.eyes(fake), first, "the same module and project reuse one facade");
  await first.listTodos();
  await projects.eyes(fake).listTodos();
  assert.equal(idReads, 1, "a second call inside the scope window reuses the session ids");
  const other = projects.eyes({ ...fake });
  assert.notEqual(other, first, "a swapped module gets its own facade");
  const second = projects.add("/elsewhere");
  assert.notEqual(projects.eyes(fake, second), first, "another project gets its own facade");
});
