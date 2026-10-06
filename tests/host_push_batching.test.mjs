// The host's high-frequency paths to the renderer and the disk: worker log
// lines are batched per beat, board pushes are coalesced and carry only the
// rows the page lacks, unending output lines stay bounded, overlapping
// queue-status reads share one board read, and the machine watch writes its
// diagnostics only when they change. Each slice below is the real main.cjs
// code between two literal markers.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createProjects } = require("../scripts/projects.cjs");
const { createRowPush } = require("../scripts/row-push.cjs");
// Objects built inside the vm have its prototypes; compare their content.
const plain = (value) => JSON.parse(JSON.stringify(value));
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

// `rows` adds main's own rowPushes line (scripts/row-push.cjs), under `env`;
// without it the slice has no row pushes and sends lists whole, as before.
function pushHost({ smoke = false, rows = false, env = {} } = {}) {
  const time = clock(), sent = [];
  let active = { id: "a" }, hidden = false, minimized = false;
  const window = { isDestroyed: () => false, isMinimized: () => minimized, isVisible: () => !hidden, webContents: { send: (channel, payload) => sent.push({ channel, payload }) } };
  const context = vm.createContext({ ...time, window, SMOKE: smoke, CAPTURE: false, projects: { current: () => active, active: () => active } });
  if (rows) {
    Object.assign(context, { process: { env }, createRowPush });
    vm.runInContext(section("const rowPushes = ", "let assistantLoading = null;"), context);
  }
  vm.runInContext(section("function send(channel, payload) {", "// registerIpc installs"), context);
  return {
    context, time, sent,
    switchTo: (id) => { active = { id }; },
    hide: () => { hidden = true; },
    minimize: () => { minimized = true; },
    show: () => { hidden = false; minimized = false; context.flushHeldPushes(); },
  };
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

test("a hidden window keeps only the newest board lists and machine status, and gets them when shown", () => {
  const { context, time, sent, hide, show } = pushHost();
  hide();
  context.send("eyes:tasks", ["t1"]);
  context.send("machine:status", { n: 1 });
  context.send("eyes:tasks", ["t2"]);
  context.send("eyes:requests", ["r1"]);
  context.send("machine:status", { n: 2 });
  context.send("eyes:assistant", { state: {} });
  context.send("studio:log", ["line"]);
  assert.deepEqual(sent.map((item) => item.channel), ["eyes:assistant", "studio:log"], "event channels still go out");
  assert.equal(time.pending(), 0, "a held list starts no trailing timer");
  show();
  assert.deepEqual(sent.slice(2), [
    { channel: "eyes:tasks", payload: ["t2"] },
    { channel: "eyes:requests", payload: ["r1"] },
    { channel: "machine:status", payload: { n: 2 } },
  ]);
  show();
  assert.equal(sent.length, 5, "a second show has nothing left to send");
  context.send("eyes:tasks", ["t3"]);
  assert.equal(sent.length, 5, "the flushed list opened a coalescing window");
  time.advance(250);
  assert.deepEqual(sent.at(-1), { channel: "eyes:tasks", payload: ["t3"] });
});

test("a minimized window is held too, and a trailing board push that lands after hiding waits", () => {
  const { context, time, sent, minimize, show } = pushHost();
  context.send("eyes:tasks", ["v1"]);
  context.send("eyes:tasks", ["v2"]);
  minimize();
  time.advance(250);
  assert.deepEqual(sent.map((item) => item.payload), [["v1"]]);
  show();
  assert.deepEqual(sent.at(-1), { channel: "eyes:tasks", payload: ["v2"] });
});

test("a board list held for one project is dropped when the owner switches before the window shows", () => {
  const { context, sent, hide, show, switchTo } = pushHost();
  hide();
  context.send("eyes:tasks", ["a1"]);
  context.send("machine:status", { n: 1 });
  switchTo("b");
  show();
  assert.deepEqual(sent, [{ channel: "machine:status", payload: { n: 1 } }]);
});

test("harness windows are never shown, so their pushes are never held", () => {
  const { context, sent, hide } = pushHost({ smoke: true });
  hide();
  context.send("eyes:tasks", ["s1"]);
  context.send("machine:status", { n: 1 });
  assert.deepEqual(sent.map((item) => item.channel), ["eyes:tasks", "machine:status"]);
});

test("the studio window sends held pushes when it is shown or restored", () => {
  const create = section("function createWindow() {", "// Screenshot tour:");
  assert.match(create, /window\.on\("show", flushHeldPushes\)/);
  assert.match(create, /window\.on\("restore", flushHeldPushes\)/);
  assert.match(create, /window\.webContents\.ipc\.on\("eyes:rows-sync", \(_event, channel\) => resyncRows\(channel\)\);/);
});

// ---- row pushes (scripts/row-push.cjs through sendRows) ----

const card = (id, extra = {}) => ({ id, title: `Card ${id}`, ...extra });

test("the four list channels each get a row push, and MEFI_STUDIO_FULL_PUSHES=1 keeps whole plain lists", () => {
  const rows = pushHost({ rows: true });
  assert.deepEqual(plain(vm.runInContext("[...rowPushes.keys()]", rows.context)), ["eyes:tasks", "eyes:requests", "eyes:ideas", "eyes:checkpoints"]);
  const whole = pushHost({ rows: true, env: { MEFI_STUDIO_FULL_PUSHES: "1" } });
  assert.equal(vm.runInContext("rowPushes", whole.context), null);
  whole.context.send("eyes:tasks", ["v1"]);
  whole.context.send("eyes:checkpoints", { s1: [] });
  whole.context.resyncRows("eyes:tasks");
  assert.deepEqual(whole.sent, [{ channel: "eyes:tasks", payload: ["v1"] }, { channel: "eyes:checkpoints", payload: { s1: [] } }]);
});

test("a board list goes whole once, then only what changed; a push with nothing new sends nothing and opens no window", () => {
  const { context, time, sent } = pushHost({ rows: true });
  context.send("eyes:tasks", [card("a"), card("b")]);
  assert.equal(sent.length, 1);
  const first = sent[0].payload;
  assert.equal(first.full, true);
  assert.deepEqual(first.rows, [card("a"), card("b")]);
  assert.equal(first.projectId, "a");
  context.send("eyes:tasks", [card("a"), card("b", { title: "B" })]);
  assert.equal(sent.length, 1, "inside the window the list waits");
  time.advance(250);
  assert.equal(sent[1].payload.base, first.rev, "the trailing push is measured against what the page got");
  assert.deepEqual(sent[1].payload.upsert, [card("b", { title: "B" })]);
  time.advance(250);
  assert.equal(time.pending(), 0);
  context.send("eyes:tasks", [card("a"), card("b", { title: "B", runProgress: { runId: "r", at: 9 } })]);
  assert.equal(sent.length, 2, "progress alone crosses as eyes:progress, not here");
  assert.equal(time.pending(), 0, "and opens no window");
  context.send("eyes:tasks", [card("a"), card("b", { title: "B" }), card("c")]);
  assert.equal(sent.length, 3, "the next real change goes at once");
  assert.deepEqual(sent[2].payload.upsert, [card("c")]);
  context.send("eyes:requests", [{ title: "No id" }]);
  assert.equal(sent[3].payload.full, true, "an inbox without ids goes whole");
});

test("the page's rows-sync resends the newest list whole, at once or as the list already on its way", () => {
  const { context, time, sent } = pushHost({ rows: true });
  context.send("eyes:tasks", [card("a")]);
  context.send("eyes:tasks", [card("a"), card("b")]);
  context.resyncRows("eyes:tasks");
  assert.equal(sent.length, 1, "a list is coalescing: it goes whole instead");
  time.advance(250);
  assert.equal(sent[1].payload.full, true);
  assert.deepEqual(sent[1].payload.rows, [card("a"), card("b")]);
  context.resyncRows("eyes:tasks");
  assert.equal(sent.length, 3, "nothing queued: whole, at once");
  assert.equal(sent[2].payload.full, true);
  assert.deepEqual(sent[2].payload.rows, [card("a"), card("b")]);
  context.resyncRows("eyes:assistant");
  context.resyncRows(undefined);
  assert.equal(sent.length, 3, "only the list channels resync");
});

test("a list push after a project switch goes whole, and a resync for the project left sends nothing", () => {
  const { context, time, sent, switchTo } = pushHost({ rows: true });
  context.send("eyes:tasks", [card("a")]);
  time.advance(250);
  switchTo("b");
  context.resyncRows("eyes:tasks");
  assert.equal(sent.length, 1, "the switch sends its own lists");
  context.send("eyes:tasks", [card("x")]);
  assert.equal(sent[1].payload.full, true);
  assert.equal(sent[1].payload.projectId, "b");
});

test("while hidden, a held list and a resync wait for the window; the flush sends only what the page lacks", () => {
  const { context, time, sent, hide, show } = pushHost({ rows: true });
  context.send("eyes:tasks", [card("a")]);
  time.advance(250);
  hide();
  context.send("eyes:tasks", [card("a"), card("b")]);
  assert.equal(sent.length, 1);
  show();
  assert.deepEqual(sent[1].payload.upsert, [card("b")], "the held list crosses as a delta");
  time.advance(250);
  hide();
  context.resyncRows("eyes:tasks");
  assert.equal(sent.length, 2, "a resync waits while hidden");
  show();
  assert.equal(sent[2].payload.full, true);
  assert.deepEqual(sent[2].payload.rows, [card("a"), card("b")]);
});

test("checkpoint stores cross at once as set and del, never held or coalesced", () => {
  const { context, sent, hide } = pushHost({ rows: true });
  const s1 = [{ note: "one" }];
  context.send("eyes:checkpoints", { s1 });
  context.send("eyes:checkpoints", { s1, s2: [{ note: "two" }] });
  context.send("eyes:checkpoints", { s1, s2: [{ note: "two" }] });
  assert.equal(sent.length, 2, "the same store again sends nothing");
  assert.equal(sent[0].payload.full, true);
  assert.deepEqual(sent[1].payload.set, { s2: [{ note: "two" }] });
  hide();
  context.send("eyes:checkpoints", { s2: [{ note: "two" }] });
  assert.deepEqual(sent[2].payload.del, ["s1"], "not held while hidden, as before");
});

test("eyes:progress waits while hidden with each card's newest, and is dropped when the project changed", () => {
  const { context, sent, hide, show, switchTo } = pushHost({ rows: true });
  context.send("eyes:progress", { projectId: "a", byTask: { t1: { at: 1 } } });
  assert.equal(sent.length, 1, "a visible window gets it at once");
  hide();
  context.send("eyes:progress", { projectId: "a", byTask: { t1: { at: 2 } } });
  context.send("eyes:progress", { projectId: "a", byTask: { t2: { at: 3 } } });
  context.send("eyes:progress", { projectId: "a", byTask: { t1: { at: 4 } } });
  assert.equal(sent.length, 1);
  show();
  assert.deepEqual(plain(sent.slice(1)), [{ channel: "eyes:progress", payload: { projectId: "a", byTask: { t1: { at: 4 }, t2: { at: 3 } } } }]);
  hide();
  context.send("eyes:progress", { projectId: "a", byTask: { t1: { at: 5 } } });
  switchTo("b");
  show();
  assert.equal(sent.length, 2, "another project's progress is dropped");
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

test("autopilot status: the first push goes at once, a burst shares one trailing push of the newest status", () => {
  const time = clock(), sent = [];
  let running = 0;
  const context = vm.createContext({
    ...time,
    send: (channel, payload) => sent.push({ channel, payload }),
    autopilotStatus: () => ({ running }),
  });
  vm.runInContext(section("let autopilotEmitTimer = null;", "// A transition emits;"), context);
  context.emitAutopilot();
  assert.deepEqual(sent, [{ channel: "assistant:status", payload: { running: 0 } }], "a quiet status goes out at once");
  running = 1; context.emitAutopilot();
  running = 2; context.emitAutopilot();
  assert.equal(sent.length, 1, "calls inside the window wait");
  time.advance(250);
  assert.deepEqual(sent.at(-1).payload, { running: 2 }, "the trailing push is built when it goes");
  assert.equal(sent.length, 2);
  time.advance(250);
  assert.equal(sent.length, 2, "nothing new, nothing sent");
  assert.equal(time.pending(), 0);
  context.emitAutopilot();
  assert.equal(sent.length, 3, "a later call after a quiet window goes at once again");
});
