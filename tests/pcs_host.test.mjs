// main.cjs "My PCs" (docs/my-pcs.md) in a vm, several PCs at once against a
// fake relay that routes like relay/src/pcs.mjs: pairing by the six numbers,
// a stranger refused, a low battery holding new starts and offering a ready
// card that moves (never copied) and comes back done, a full PC declining,
// work started on another PC, a battery stop that holds the running work and
// Continue that releases it, and a friend's lent PC holding their task for its
// owner's OK.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const modules = {
  "./scripts/pc-trust.cjs": require("../scripts/pc-trust.cjs"),
  "./scripts/pc-fleet.cjs": require("../scripts/pc-fleet.cjs"),
  "./scripts/pc-power.cjs": require("../scripts/pc-power.cjs"),
  "./scripts/pc-handoff.cjs": require("../scripts/pc-handoff.cjs"),
};
const backlog = require("../scripts/backlog.cjs");
const workAdmission = require("../scripts/work-admission.cjs");
const executorResume = require("../scripts/executor-resume.cjs");
const main = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const from = main.indexOf("// ---- My PCs: the owner's PCs working as one");
const to = main.indexOf("// ---- end of My PCs", from);
assert.ok(from > 0 && to > from, "main.cjs has a My PCs block");
const block = main.slice(from, to);
const settingsFrom = main.indexOf("function updateSettings(mutate) {");
const settingsBlock = main.slice(settingsFrom, main.indexOf("\nfunction send(", settingsFrom));
const plain = (value) => JSON.parse(JSON.stringify(value));
const settle = async () => { for (let i = 0; i < 60; i += 1) await new Promise((done) => setImmediate(done)); };
// A delivery between PCs includes real file reads and writes: wait for what
// it changes (up to 5 s) instead of a fixed number of turns.
const until = async (check, what) => {
  const end = Date.now() + 5000;
  while (!(await check())) {
    if (Date.now() > end) assert.fail(`timed out waiting for ${what}`);
    await new Promise((done) => setTimeout(done, 10));
  }
};
const OWNER = "111111111111111111", FRIEND = "222222222222222222", STRANGER = "333333333333333333";
const REPO = "https://github.com/acme/game.git";

// The relay: who sees whom and where a pcSend may go, as docs/my-pcs.md says.
function fakeRelay() {
  const sockets = [];
  const sees = (viewer, pc) => pc !== viewer && pc.hello && (pc.uid === viewer.uid || pc.hello.lendTo.includes(viewer.uid));
  const view = (viewer, pc) => ({ id: pc.hello.pc.id, name: pc.hello.pc.name, kind: pc.hello.pc.kind, owner: { id: pc.uid, name: pc.uid === OWNER ? "Owner" : "Sam" }, mine: pc.uid === viewer.uid, lends: pc.uid !== viewer.uid, keys: pc.hello.keys, since: 1 });
  const roster = () => {
    for (const viewer of sockets.filter((row) => row.hello)) viewer.host?.hear({ type: "pcs", pcs: sockets.filter((pc) => sees(viewer, pc)).map((pc) => view(viewer, pc)) });
  };
  return {
    sockets,
    client(uid) {
      const socket = { uid, hello: null, host: null, states: [] };
      sockets.push(socket);
      return {
        socket,
        status: () => ({ state: "ready", pcs: true, user: { id: uid } }),
        setPc(value) { socket.hello = plain(value); setImmediate(roster); return true; },
        pcState(state) {
          socket.states.push(state);
          for (const viewer of sockets) if (viewer.hello && socket.hello && sees(viewer, socket)) {
            const copy = plain(state);
            if (viewer.uid !== socket.uid) delete copy.projects;
            setImmediate(() => viewer.host?.hear({ type: "pcState", from: socket.hello.pc.id, state: copy }));
          }
          return true;
        },
        async pcSend(target, env) {
          const peer = sockets.find((row) => row.hello?.pc.id === target);
          if (!peer) return { ok: false, reason: "not-online" };
          const allowed = peer.uid === socket.uid || peer.hello.lendTo.includes(socket.uid) || socket.hello.lendTo.includes(peer.uid);
          if (!allowed) return { ok: false, reason: "not-allowed" };
          setImmediate(() => peer.host?.hear({ type: "pcMsg", from: socket.hello.pc.id, fromUser: socket.uid, fromName: socket.uid === OWNER ? "Owner" : "Sam", keys: socket.hello.keys, env: plain(env) }));
          return { ok: true };
        },
      };
    },
    roster,
  };
}

// The fake spawn: git answers the project's remote; PowerShell the battery.
function fakeChildProcess(pc) {
  return {
    spawn(exe, args) {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = Object.assign(new EventEmitter(), { end() {} });
      child.kill = () => {};
      let out = "", code = 0;
      if (exe === "powershell") out = pc.battery ? JSON.stringify({ EstimatedChargeRemaining: pc.battery.level, BatteryStatus: pc.battery.onBattery ? 1 : 2 }) : "";
      else if (args.includes("get-url")) out = pc.repo ? `${pc.repo}\n` : "", code = pc.repo ? 0 : 1;
      else code = 1;
      setImmediate(() => { if (out) child.stdout.emit("data", out); child.emit("close", code); });
      return child;
    },
  };
}

async function makePc(relay, { id, name, uid = OWNER, repo = REPO, battery = null, running = 0, parallel = 3, settings = {} }) {
  const userData = await mkdtemp(path.join(os.tmpdir(), "pcs-host-"));
  const pc = { id, name, battery, repo, board: { tasks: [] }, calls: [], sent: [], userData };
  let saved = { pcs: { name, ...settings } };
  const client = relay.client(uid);
  const jobs = Array.from({ length: running }, (_, i) => ({ id: `run_${i}`, taskId: `busy_${i}`, title: `Busy ${i}`, projectId: "p1", projectPath: "C:/game", startedAt: Date.now() - 60_000 }));
  const project = { id: "p1", name: "Game", path: "C:/game" };
  const context = vm.createContext({
    Date, Math, JSON, Number, String, Array, Object, Map, Set, Promise, Boolean, Buffer, RegExp, Error,
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, Math.min(ms, 5)); timer.unref?.(); return timer; }, clearTimeout, setInterval: () => ({ unref() {} }), clearInterval: () => {},
    process: { platform: "win32", env: {}, pid: 4242 },
    SMOKE: false, CAPTURE: false, CLI_MODE: false, EXECUTOR_PARALLEL_CAP: 3,
    crypto, os: { hostname: () => name }, path,
    readFile, writeFile, mkdir, rename, stat,
    app: { getPath: () => userData },
    safeStorage: { isEncryptionAvailable: () => true, encryptString: (text) => Buffer.from(`enc:${text}`), decryptString: (bytes) => Buffer.from(bytes).toString().slice(4) },
    powerMonitor: { isOnBatteryPower: () => Boolean(pc.battery?.onBattery), on() {} },
    optionalHelper: (request) => modules[request],
    require: (request) => (request === "node:child_process" ? fakeChildProcess(pc) : modules[request]),
    readSettings: async () => JSON.parse(JSON.stringify(saved)),
    settingsDisk: { queue: Promise.resolve() },
    writeSettings: async (value) => { saved = JSON.parse(JSON.stringify(value)); },
    hubClient: client,
    community: {}, communityRead: async () => ({ state: { link: { userId: uid } } }),
    send: (channel, payload) => pc.sent.push([channel, payload]),
    logLine: () => {},
    coworkMachineId: async () => id,
    projects: {
      open: () => project, current: () => project, active: () => project, find: (projectId) => (projectId === "p1" ? project : undefined),
      list: () => ({ ok: true, projects: [project], activeId: "p1" }), run: (_project, fn) => fn(),
    },
    projectRoot: () => project.path,
    TASKS_PATH: "tasks.json",
    getEyes: async () => ({ readJson: async () => plain(pc.board.tasks) }),
    mutateBoard: async (mutator) => {
      const board = { tasks: plain(pc.board.tasks) };
      const result = mutator(board) ?? {};
      if (result.tasks) pc.board.tasks = plain(result.tasks);
      return result;
    },
    backlog, workAdmission, executorResume,
    autopilot: { jobs, capacity: { canStart: true, resources: { cpuPercent: 12, availableMemoryMB: 6000, totalMemoryMB: 16000, holdKind: null } }, parallel, adaptiveParallel: false, execute: true, autoBuild: true, approve: null, queueDepth: 0 },
    assistantState: { status: "running", prefs: { keepAwake: true } },
    assistantAskForWork: (reason) => pc.calls.push(["ask", reason]),
    assistantLog: () => {},
    emitAutopilot: () => {},
    applyKeepAwake: () => pc.calls.push(["awake"]),
    assistantSetPrefs: async (patch) => pc.calls.push(["prefs", patch]),
    stopExecutorJob: (job, reason) => { pc.calls.push(["stop", job.taskId, reason, plain(job.ownerHold)]); job.finished = true; return true; },
  });
  vm.runInContext(`${settingsBlock}\n${block}\nthis.api = { pcsHear, pcsHello, pcsSendState, pcsPair, pcsPairAnswer, pcsForget, pcsPlan, pcsStart, pcsMove, pcsRecall, pcsStatus, pcsSet, pcsPowerLook, pcsContinue, pcsHoldsStarts, pcsHoldText, pcsAwakeWanted, pcsPeers, pcsMem };`, context);
  client.socket.host = { hear: (event) => context.api.pcsHear(event) };
  pc.api = context.api;
  pc.context = context;
  pc.client = client;
  pc.saved = () => saved;
  // Pending writes (peers, outbox) finish before the folder goes.
  pc.cleanup = async () => { await settle(); await context.api.pcsMem().files.catch(() => {}); await rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); };
  await context.api.pcsHello();
  await settle();
  return pc;
}

async function pair(a, b) {
  const asked = await a.api.pcsPair(b.id);
  assert.equal(asked.ok, true, asked.error);
  await settle();
  const seen = (await b.api.pcsStatus()).asks.find((ask) => ask.id === a.id);
  assert.equal(seen?.numbers, asked.numbers, "both screens show the same six numbers");
  const answered = await b.api.pcsPairAnswer(a.id, true);
  assert.equal(answered.ok, true, answered.error);
  await settle();
}
const card = (id, extra = {}) => ({ id, title: `Card ${id}`, prompt: `Do ${id}`, status: "queued", createdAt: 1, updatedAt: 1, logs: [], ...extra });

test("two of the owner's PCs pair by the six numbers; a stranger's PC is never listed or paired", async () => {
  const relay = fakeRelay();
  const laptop = await makePc(relay, { id: "pc-laptop", name: "Laptop" });
  const desk = await makePc(relay, { id: "pc-desk", name: "Desk" });
  const stranger = await makePc(relay, { id: "pc-other", name: "Other", uid: STRANGER });
  try {
    await settle();
    const rows = (await laptop.api.pcsStatus()).rows;
    assert.deepEqual(rows.map((row) => row.id), ["pc-laptop", "pc-desk"], "the stranger's PC is not on the owner's list");
    await pair(laptop, desk);
    assert.deepEqual((await laptop.api.pcsPeers()).map((peer) => [peer.id, peer.relation]), [["pc-desk", "mine"]]);
    assert.deepEqual((await desk.api.pcsPeers()).map((peer) => [peer.id, peer.relation]), [["pc-laptop", "mine"]]);
    assert.match((await stranger.api.pcsPair("pc-laptop")).error, /not online/);
    // Keys are kept sealed; the public half only goes to the relay.
    const identity = JSON.parse(await readFile(path.join(laptop.userData, "pcs", "identity.json"), "utf8"));
    assert.ok(identity.public.sign && identity.sealed.length > 0);
    assert.ok(!JSON.stringify(identity.public).includes("PRIVATE"));
  } finally {
    await Promise.all([laptop, desk, stranger].map((pc) => pc.cleanup()));
  }
});

test("a low battery holds new starts and moves a ready card to a paired PC, which reports it done", async () => {
  const relay = fakeRelay();
  const laptop = await makePc(relay, { id: "pc-laptop", name: "Laptop", battery: { level: 60, onBattery: true } });
  const desk = await makePc(relay, { id: "pc-desk", name: "Desk" });
  try {
    await pair(laptop, desk);
    laptop.board.tasks = [card("t1"), card("t2"), card("t3", { pin: true })];
    await laptop.api.pcsPowerLook();
    assert.equal(laptop.api.pcsHoldsStarts(), false);
    laptop.battery.level = 18;
    await laptop.api.pcsPowerLook();
    await settle();
    assert.equal(laptop.api.pcsHoldsStarts(), true, "no new start at 18%");
    assert.match(laptop.api.pcsHoldText(), /Battery at 18%: finishing what runs/);
    // The desk said how it is; then the laptop's plan offers its ready cards.
    await desk.api.pcsSendState({ force: true });
    await settle();
    await laptop.api.pcsPlan();
    await until(() => laptop.board.tasks.filter((task) => task.movedTo && !task.movedTo.pending).length === 2, "the desk's answer");
    const moved = laptop.board.tasks.filter((task) => task.movedTo);
    assert.deepEqual(moved.map((task) => [task.id, task.movedTo.name, Boolean(task.movedTo.pending)]), [["t1", "Desk", false], ["t2", "Desk", false]], "two cards out, the pinned one stays");
    assert.equal(backlog.workState(moved[0], Date.now()).stage, "waiting");
    const received = desk.board.tasks.filter((task) => task.fromPc);
    assert.deepEqual(received.map((task) => [task.title, task.fromPc.id, task.fromPc.taskId]), [["Card t1", "pc-laptop", "t1"], ["Card t2", "pc-laptop", "t2"]]);
    assert.ok(desk.calls.some(([kind]) => kind === "ask"), "the desk starts on them");
    // Planning again offers nothing more: two out is the project's limit.
    await laptop.api.pcsPlan();
    await settle();
    assert.equal(desk.board.tasks.length, 2);
    // The desk finishes one: the laptop's card is done too.
    desk.board.tasks[0].status = "done";
    desk.board.tasks[0].doneAt = Date.now();
    await desk.api.pcsPlan();
    await until(() => laptop.board.tasks.find((task) => task.id === "t1")?.status === "done", "the done note");
    const t1 = laptop.board.tasks.find((task) => task.id === "t1");
    assert.equal(t1.status, "done");
    assert.match(t1.logs.at(-1).text, /done on Desk/);
    assert.ok(desk.board.tasks[0].fromPc.reported, "the note goes home once");
  } finally {
    await Promise.all([laptop, desk].map((pc) => pc.cleanup()));
  }
});

test("a full PC declines, and the card stays where it was", async () => {
  const relay = fakeRelay();
  const laptop = await makePc(relay, { id: "pc-laptop", name: "Laptop" });
  const desk = await makePc(relay, { id: "pc-desk", name: "Desk", running: 3 });
  try {
    await pair(laptop, desk);
    laptop.board.tasks = [card("t1")];
    await desk.api.pcsSendState({ force: true });
    await settle();
    const tried = await laptop.api.pcsMove("t1", "pc-desk");
    assert.match(tried.error, /All 3 slots busy/);
    assert.equal(laptop.board.tasks[0].movedTo, undefined);
    assert.equal(desk.board.tasks.length, 0);
  } finally {
    await Promise.all([laptop, desk].map((pc) => pc.cleanup()));
  }
});

test("work started on another PC lands on its board and its answer comes back", async () => {
  const relay = fakeRelay();
  const laptop = await makePc(relay, { id: "pc-laptop", name: "Laptop" });
  const desk = await makePc(relay, { id: "pc-desk", name: "Desk" });
  try {
    await pair(laptop, desk);
    const started = await laptop.api.pcsStart({ pcId: "pc-desk", title: "Add a dark mode", prompt: "Dark mode for the menu" });
    assert.equal(started.ok, true, started.error);
    await until(async () => (await laptop.api.pcsStatus()).sent[0]?.status === "queued", "the desk's reply");
    assert.deepEqual(desk.board.tasks.map((task) => [task.title, task.prompt, task.ownerHold ?? null]), [["Add a dark mode", "Dark mode for the menu", null]]);
    const status = await laptop.api.pcsStatus();
    assert.deepEqual(plain(status.sent.map((row) => [row.title, row.toName, row.status])), [["Add a dark mode", "Desk", "queued"]]);
    desk.board.tasks[0].status = "done";
    await desk.api.pcsPlan();
    await until(async () => (await laptop.api.pcsStatus()).sent[0]?.status === "done", "the done note");
    // A PC that does not have the project open says so.
    desk.repo = "https://github.com/acme/other.git";
    desk.api.pcsMem().remotes.clear();
    await laptop.api.pcsStart({ pcId: "pc-desk", title: "Another", prompt: "x" });
    await until(async () => (await laptop.api.pcsStatus()).sent[0]?.status === "refused", "the refusal");
    const refused = (await laptop.api.pcsStatus()).sent[0];
    assert.equal(refused.status, "refused");
    assert.match(refused.error, /not open on this PC/);
  } finally {
    await Promise.all([laptop, desk].map((pc) => pc.cleanup()));
  }
});

test("a message from a PC that is not paired is refused", async () => {
  const relay = fakeRelay();
  const laptop = await makePc(relay, { id: "pc-laptop", name: "Laptop" });
  const desk = await makePc(relay, { id: "pc-desk", name: "Desk" });
  try {
    // Desk is the owner's but unpaired: its start never reaches the board.
    const trust = modules["./scripts/pc-trust.cjs"];
    const fake = trust.loadIdentity(trust.makeIdentity());
    const laptopKeys = relay.sockets.find((row) => row.hello?.pc.id === "pc-laptop").hello.keys;
    const env = trust.seal(fake, laptopKeys, { from: "pc-desk", to: "pc-laptop", body: { type: "start", reqId: "x", title: "Run this", prompt: "rm -rf" }, now: Date.now() });
    await laptop.api.pcsHear({ type: "pcMsg", from: "pc-desk", fromUser: OWNER, env });
    await settle();
    assert.equal(laptop.board.tasks.length, 0);
    assert.match((await desk.api.pcsStart({ pcId: "pc-laptop", title: "x", prompt: "y" })).error, /Pair with that PC first/);
  } finally {
    await Promise.all([laptop, desk].map((pc) => pc.cleanup()));
  }
});

test("at the stop line the running work stops held, the PC may sleep, and Continue releases it", async () => {
  const relay = fakeRelay();
  const laptop = await makePc(relay, { id: "pc-laptop", name: "Laptop", battery: { level: 30, onBattery: true }, running: 1, settings: { stayOn: "always" } });
  try {
    laptop.board.tasks = [card("busy_0", { status: "queued", ownerHold: { kind: "battery", level: 9, at: 1 } })];
    await laptop.api.pcsPowerLook();
    assert.deepEqual(plain(laptop.api.pcsAwakeWanted()), { always: false, release: false }, "Always holds only while plugged in");
    // Plugged in, then unplugged above the low line: keep-awake is asked again each time.
    laptop.battery.onBattery = false;
    const asked = () => laptop.calls.filter(([kind]) => kind === "awake").length;
    const before = asked();
    await laptop.api.pcsPowerLook();
    assert.equal(laptop.api.pcsAwakeWanted().always, true);
    laptop.battery.onBattery = true;
    await laptop.api.pcsPowerLook();
    assert.equal(asked(), before + 2, "each change of power re-applies Keep this PC on");
    assert.equal(laptop.api.pcsAwakeWanted().always, false);
    laptop.battery.level = 9;
    await laptop.api.pcsPowerLook();
    await settle();
    const stop = laptop.calls.find(([kind]) => kind === "stop");
    assert.equal(stop[1], "busy_0");
    assert.deepEqual([stop[3].kind, stop[3].level], ["battery", 9], "the card waits with a battery hold");
    assert.equal(laptop.api.pcsHoldsStarts(), true);
    assert.equal(laptop.api.pcsAwakeWanted().release, true, "a stopped laptop may sleep");
    assert.equal(laptop.saved().pcs.power.stage, "stopped", "a restart remembers the stop");
    // Plugged in: still stopped until Continue.
    laptop.battery.onBattery = false;
    await laptop.api.pcsPowerLook();
    assert.equal(laptop.api.pcsHoldsStarts(), true);
    const answer = await laptop.api.pcsContinue();
    assert.equal(answer.ok, true, answer.error);
    assert.equal(laptop.api.pcsHoldsStarts(), false);
    assert.equal(laptop.board.tasks[0].ownerHold, undefined);
    assert.ok(laptop.calls.some(([kind, reason]) => kind === "ask" && /Continue/.test(reason)));
    assert.deepEqual(plain(laptop.api.pcsAwakeWanted()), { always: true, release: false });
  } finally {
    await laptop.cleanup();
  }
});

test("a friend's lent PC: visible only while lent, and their task waits for its owner's OK", async () => {
  const relay = fakeRelay();
  const laptop = await makePc(relay, { id: "pc-laptop", name: "Laptop" });
  const sams = await makePc(relay, { id: "pc-sam", name: "Sam's PC", uid: FRIEND });
  try {
    await settle();
    assert.deepEqual((await laptop.api.pcsStatus()).rows.map((row) => row.id), ["pc-laptop"], "not lent: not listed");
    await sams.api.pcsSet({ lend: [{ id: OWNER, name: "Owner", auto: false }] });
    await settle();
    const row = (await laptop.api.pcsStatus()).rows.find((pc) => pc.id === "pc-sam");
    assert.equal(row?.relation, "lender");
    await pair(laptop, sams);
    assert.deepEqual((await sams.api.pcsPeers()).map((peer) => [peer.id, peer.relation, peer.auto]), [["pc-laptop", "borrower", false]]);
    // Nothing moves to a friend's PC by itself.
    laptop.board.tasks = [card("t1")];
    laptop.context.autopilot.capacity = { canStart: false, resources: { holdKind: "memory" } };
    laptop.api.pcsMem().holdSince = Date.now() - 10 * 60_000;
    await sams.api.pcsSendState({ force: true });
    await settle();
    await laptop.api.pcsPlan();
    await settle();
    assert.equal(sams.board.tasks.length, 0);
    // Sent on purpose, it waits for Sam's OK.
    const started = await laptop.api.pcsStart({ pcId: "pc-sam", title: "Render the trailer", prompt: "Render it" });
    assert.equal(started.ok, true, started.error);
    await until(async () => (await laptop.api.pcsStatus()).sent[0]?.status === "held", "Sam's reply");
    const task = sams.board.tasks[0];
    assert.equal(task.ownerHold.kind, "friend");
    assert.equal(task.fromPc.friend, true);
    assert.match(backlog.workState(task, Date.now()).reason, /Sent by Laptop: say "work on it"/);
    assert.equal((await laptop.api.pcsStatus()).sent[0].status, "held");
    // Stopping the lend ends the pairing there at once.
    await sams.api.pcsSet({ lend: [] });
    assert.deepEqual(await sams.api.pcsPeers(), []);
  } finally {
    await Promise.all([laptop, sams].map((pc) => pc.cleanup()));
  }
});
