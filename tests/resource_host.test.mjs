// scripts/resource-host.cjs against a scripted helper: the page's reads and
// presses, auto mode's loop while agents build and after, Restore all, leaving
// auto mode, a helper that dies while holding, a launch that finds the last
// Studio's journal, quitting, and a PC where it does not run. The helper here
// speaks the real protocol (scripts/resource-helper.cs) over fake pipes and
// keeps a fake process table, so the host's whole path runs and no real
// process is touched. tests/resource_helper_win.test.mjs drives the real one.
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createResourceHost } = require("../scripts/resource-host.cjs");

const MIB = 1024 * 1024;
const born = (t) => String(133000000000000000n + BigInt(t) * 10000000n);
const STUDIO = 1000;

// The PC: Windows, Studio and an agent, and three other apps.
function world() {
  const procs = [
    { pid: 4, ppid: 0, name: "System", t: 0, session: 0 },
    { pid: 600, ppid: 500, name: "explorer.exe", t: 1, path: "C:\\Windows\\explorer.exe" },
    { pid: STUDIO, ppid: 600, name: "electron.exe", t: 10, path: "C:\\Apps\\Mefi\\electron.exe", mem: 400 },
    { pid: 1002, ppid: STUDIO, name: "claude.exe", t: 12, path: "C:\\bin\\claude.exe", mem: 500 },
    { pid: 2000, ppid: 600, name: "msedge.exe", t: 20, path: "C:\\Edge\\msedge.exe", mem: 700, title: "News" },
    { pid: 2001, ppid: 2000, name: "msedge.exe", t: 21, path: "C:\\Edge\\msedge.exe", mem: 400 },
    { pid: 3000, ppid: 600, name: "Discord.exe", t: 30, path: "C:\\Discord\\Discord.exe", mem: 600, title: "Discord" },
    { pid: 5000, ppid: 600, name: "Code.exe", t: 50, path: "C:\\Code\\Code.exe", mem: 300, title: "main.cjs" },
    { pid: 7000, ppid: 600, name: "Setup.exe", t: 70, mem: 50 },
  ];
  for (const proc of procs) { proc.create = born(proc.t); proc.pri = 8; proc.frozen = false; proc.mem = proc.mem ?? 50; proc.session = proc.session ?? 1; }
  return { procs, fg: 0, freeMB: 6000, ledger: new Map(), helpers: [], log: [], asked: [] };
}

// A helper child that answers the protocol from `pc`.
function fakeSpawn(pc) {
  return (command, args, options) => {
    const child = new EventEmitter();
    child.pid = 4242 + pc.helpers.length;
    child.command = command;
    child.args = args;
    child.options = options;
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.unref = () => {};
    child.exited = false;
    const exit = (code) => { if (child.exited) return; child.exited = true; queueMicrotask(() => child.emit("exit", code)); };
    child.kill = () => exit(null);
    child.crash = () => exit(3); // dies without putting anything back
    const say = (reply) => { if (!child.exited) child.stdout.write(`${JSON.stringify(reply)}\n`); };
    const find = (target) => {
      const [pid, create] = target.split(":");
      const proc = pc.procs.find((row) => row.pid === Number(pid));
      return proc && proc.create === create ? proc : null;
    };
    const restore = (proc, entry) => {
      if (entry.paused) proc.frozen = false;
      if (entry.slowed) proc.pri = 8;
      pc.ledger.delete(proc.pid);
    };
    const restoreAll = () => {
      let count = 0;
      for (const [pid, entry] of [...pc.ledger]) { const proc = pc.procs.find((row) => row.pid === pid); if (proc) restore(proc, entry); count += 1; }
      pc.ledger.clear();
      return count;
    };
    const ledger = () => [...pc.ledger.values()].map((entry) => ({ ...entry }));
    const one = (op, target) => {
      const proc = find(target);
      const pid = Number(target.split(":")[0]);
      pc.asked.push(`${op} ${pid}`);
      if (!proc) return { pid, ok: false, error: "gone" };
      if (proc.pid <= 4 || proc.pid === STUDIO) return { pid, ok: false, error: proc.pid === STUDIO ? "studio" : "system" };
      if (proc.denied) return { pid, ok: false, error: "denied" };
      const entry = pc.ledger.get(proc.pid) ?? { pid: proc.pid, create: proc.create, name: proc.name, slowed: false, paused: false, oldPriority: 32, oldMemoryPriority: 5 };
      pc.log.push(`${op} ${proc.pid}`);
      if (op === "slow") { if (entry.slowed) return { pid, ok: true, was: "slowed" }; entry.slowed = true; proc.pri = 4; pc.ledger.set(proc.pid, entry); return { pid, ok: true, eco: true, memoryLow: true }; }
      if (op === "pause") { if (entry.paused) return { pid, ok: true, was: "paused" }; entry.paused = true; proc.frozen = true; pc.ledger.set(proc.pid, entry); return { pid, ok: true }; }
      if (op === "resume") { if (!entry.paused) return { pid, ok: true, was: "running" }; entry.paused = false; proc.frozen = false; if (!entry.slowed) pc.ledger.delete(proc.pid); return { pid, ok: true }; }
      if (op === "unslow") { if (!entry.slowed) return { pid, ok: true, was: "normal" }; entry.slowed = false; proc.pri = 8; if (!entry.paused) pc.ledger.delete(proc.pid); return { pid, ok: true }; }
      if (op === "restore") { if (!pc.ledger.has(proc.pid)) return { pid, ok: true, was: "unchanged" }; restore(proc, entry); return { pid, ok: true }; }
      if (op === "trim") return { pid, ok: true };
      if (op === "close") return { pid, ok: true, windows: proc.title ? 1 : 0 };
      if (op === "end") { pc.procs = pc.procs.filter((row) => row !== proc); pc.ledger.delete(proc.pid); return { pid, ok: true }; }
      return { pid, ok: false, error: "unknown" };
    };
    const adopt = (token) => {
      const [pid, create, flags] = token.split(":");
      const proc = find(`${pid}:${create}`);
      if (!proc) return { pid: Number(pid), ok: false, error: "gone" };
      pc.ledger.set(proc.pid, { pid: proc.pid, create, name: proc.name, slowed: flags.includes("s"), paused: flags.includes("p"), oldPriority: 32, oldMemoryPriority: 5 });
      pc.log.push(`adopt ${proc.pid}`);
      return { pid: proc.pid, ok: true };
    };
    let buffer = "";
    child.stdin.on("data", (chunk) => {
      buffer += chunk;
      let at;
      while ((at = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        const [id, op, arg = ""] = line.split(" ");
        const n = Number(id);
        if (op === "exit") { say({ id: n, ok: true, restored: restoreAll() }); exit(0); continue; }
        if (op === "snap") {
          say({
            id: n, ok: true, at: pc.now(), cpus: 4, sys: [0, 0, 0], mem: [16384 * MIB, pc.freeMB * MIB, 32768 * MIB, 8192 * MIB, 60], fg: pc.fg, idle: 0, self: child.pid, session: 1,
            procs: pc.procs.map((p) => [p.pid, p.ppid, p.name, p.create, 0, p.mem * MIB, p.mem * MIB, p.mem * MIB, p.session, p.pri, 4, p.frozen ? 1 : 0, p.path ? pc.procs.indexOf(p) : -1, p.title ?? null]),
            files: pc.procs.map((p) => [p.path ?? "", ""]),
            ledger: ledger(),
          });
          continue;
        }
        if (op === "restoreall") { say({ id: n, ok: true, restored: restoreAll(), ledger: [] }); continue; }
        if (op === "ledger") { say({ id: n, ok: true, ledger: ledger() }); continue; }
        const targets = arg ? arg.split(",") : [];
        const results = targets.map((target) => (op === "adopt" ? adopt(target) : one(op, target)));
        say({ id: n, ok: true, results, ledger: ledger() });
      }
    });
    child.stdin.on("finish", () => { restoreAll(); exit(0); });
    pc.helpers.push(child);
    queueMicrotask(() => say({ id: 0, ok: true, ready: true, version: "1", pid: child.pid, bits: 64 }));
    return child;
  };
}

function memoryFs(files = new Map()) {
  return {
    files,
    async readFile(file) { if (!files.has(file)) { const error = new Error("ENOENT"); error.code = "ENOENT"; throw error; } return files.get(file); },
    async writeFile(file, body) { files.set(file, String(body)); },
    async rename(from, to) { files.set(to, files.get(from)); files.delete(from); },
    async mkdir() {},
    async access(file) { if (!files.has(file)) throw new Error("ENOENT"); },
    async readdir() { return []; },
    async unlink(file) { files.delete(file); },
  };
}

const FOLDER = "C:\\Local\\MefiStudio\\resources";
const JOURNAL = `${FOLDER}\\journal.json`;

function setup({ prefs = {}, building = { active: false }, platform = "win32", disabled = null, files, buildHelper = null } = {}) {
  const pc = world();
  let clock = 1_000_000;
  pc.now = () => clock;
  const timers = [];
  const sent = [];
  const logs = [];
  const saved = { resources: prefs };
  const fs = memoryFs(files);
  const state = { building };
  const host = createResourceHost({
    platform,
    spawn: fakeSpawn(pc),
    fs,
    dir: async () => FOLDER,
    buildHelper: buildHelper ?? (async () => "C:\\Local\\MefiStudio\\resources\\resource-helper-test.exe"),
    studioPids: () => [STUDIO],
    readPrefs: async () => saved.resources,
    savePrefs: async (next) => { saved.resources = next; return next; },
    building: () => state.building,
    send: (channel, payload) => sent.push([channel, payload]),
    logLine: (line) => logs.push(line),
    now: () => clock,
    setTimer: (fn, ms) => { const timer = { fn, ms, cleared: false, unref() { return this; } }; timers.push(timer); return timer; },
    clearTimer: (timer) => { if (timer) timer.cleared = true; },
    disabled,
    env: { SystemRoot: "C:\\Windows", USERPROFILE: "C:\\Users\\Ann" },
  });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return {
    host, pc, sent, logs, saved, fs, timers, settle,
    advance: (ms) => { clock += ms; },
    setBuilding: (next) => { state.building = next; },
    journal: () => JSON.parse(fs.files.get(JOURNAL) ?? "{\"entries\":[]}").entries,
  };
}

const appOf = (view, key) => view.apps.find((app) => app.key === key);
const proc = (pc, pid) => pc.procs.find((row) => row.pid === pid);

test("a page read starts one detached helper and shows the apps, with Studio, its agents and Windows counted apart", async () => {
  const t = setup();
  const view = await t.host.snapshot();
  assert.equal(view.ok, true);
  assert.equal(view.supported, true);
  assert.equal(t.pc.helpers.length, 1);
  const child = t.pc.helpers[0];
  assert.deepEqual(child.args, [String(STUDIO)], "the helper is told Studio's own pid");
  assert.equal(child.options.detached, true, "detached: it outlives a crashed Studio long enough to put things back");
  assert.equal(child.options.windowsHide, true);
  assert.deepEqual(view.apps.map((app) => app.key), ["msedge", "discord", "code", "setup"]);
  assert.equal(appOf(view, "msedge").memMB, 1100);
  assert.equal(appOf(view, "setup").protected.code, "hidden");
  assert.equal(view.studio.count, 2, "Studio and its agent (this fake helper is not in its own table)");
  assert.equal(view.mode, "manual");
  assert.match(view.headline, /^Manual: Studio changes nothing/);
  assert.equal(view.apps.every((app) => !("targets" in app)), true, "the page never sees process numbers");
  await t.host.stop();
});

test("manual: Slow down and Pause hold an app for you, Pause hands its memory back, Put back undoes both, and the journal follows", async () => {
  const t = setup();
  const slowed = await t.host.act({ key: "msedge", op: "slow" });
  assert.equal(slowed.ok, true);
  assert.equal(slowed.text, "Slowed down Microsoft Edge");
  assert.deepEqual([proc(t.pc, 2000).pri, proc(t.pc, 2001).pri], [4, 4]);
  assert.equal(t.journal().length, 2, "every change is in the journal");
  const paused = await t.host.act({ key: "msedge", op: "pause" });
  assert.equal(paused.text, "Paused Microsoft Edge");
  assert.ok(t.pc.log.includes("trim 2000") && t.pc.log.includes("trim 2001"), "a paused app gives its memory back at once");
  let view = t.host.view();
  assert.deepEqual(appOf(view, "msedge").hold.pause.by, "you");
  assert.equal(appOf(view, "msedge").paused, "all");
  assert.match(view.headline, /Holding 1 app, 1 paused/);
  const again = await t.host.act({ key: "msedge", op: "pause" });
  assert.equal(again.text, "Microsoft Edge is already paused.");
  const back = await t.host.act({ key: "msedge", op: "restore" });
  assert.equal(back.ok, true);
  assert.equal(back.text, "Put Microsoft Edge back.");
  assert.deepEqual([proc(t.pc, 2000).pri, proc(t.pc, 2000).frozen], [8, false]);
  view = t.host.view();
  assert.deepEqual(appOf(view, "msedge").hold, { slow: null, pause: null });
  assert.deepEqual(t.journal(), []);
  assert.deepEqual(view.log.slice(0, 3).map((entry) => [entry.by, entry.text]), [["you", "Put Microsoft Edge back."], ["you", "Paused Microsoft Edge"], ["you", "Slowed down Microsoft Edge"]]);
  await t.host.stop();
});

test("what Studio leaves alone is refused with its reason, and so is pausing the app in front of you", async () => {
  const t = setup();
  t.pc.fg = 5000;
  assert.deepEqual(await t.host.act({ key: "setup", op: "end" }), { ok: false, error: "Windows won't tell Studio which program it is, so Studio leaves it alone." });
  const front = await t.host.act({ key: "code", op: "pause" });
  assert.equal(front.ok, false);
  assert.match(front.error, /in front of you/);
  assert.equal(proc(t.pc, 5000).frozen, false);
  assert.equal((await t.host.act({ key: "electron", op: "end" })).ok, false, "Studio is not an app it offers");
  assert.equal((await t.host.act({ key: "msedge", op: "explode" })).ok, false);
  assert.equal((await t.host.act({ key: "../x", op: "slow" })).ok, false);
  assert.equal(proc(t.pc, STUDIO).pri, 8);
  await t.host.stop();
});

test("auto mode: agents build, a heavy app you are not using is slowed; switching to a paused app lets it run; when building stops everything auto did goes back", async () => {
  const t = setup({ prefs: { mode: "auto", rules: { discord: "pause" } } });
  await t.host.tickNow();
  assert.equal(t.pc.helpers.length, 0, "waiting for agents to build: no helper, no picture");
  t.setBuilding({ active: true, running: 2 });
  await t.host.tickNow();
  assert.equal(proc(t.pc, 2000).pri, 4, "Edge (1.1 GB) slowed while agents build");
  assert.equal(proc(t.pc, 3000).frozen, true, "Discord paused: its rule says so");
  assert.equal(proc(t.pc, 5000).pri, 8, "Code is light");
  const acted = t.sent.filter(([channel]) => channel === "resources:acted").map(([, entry]) => entry);
  assert.ok(acted.some((entry) => entry.by === "auto" && /Slowed down Microsoft Edge/.test(entry.text) && entry.notify === true));
  assert.equal(t.host.status().level, "focus");
  // You click Discord: it runs again at once, and auto leaves it alone for this building session.
  t.pc.fg = 3000;
  t.advance(2000);
  await t.host.tickNow();
  assert.equal(proc(t.pc, 3000).frozen, false);
  t.pc.fg = 0;
  t.advance(5 * 60 * 1000);
  await t.host.tickNow();
  assert.equal(proc(t.pc, 3000).frozen, false, "not paused again this session");
  // The agents finish: auto's holds stay for the minute you chose, then go back.
  t.setBuilding({ active: false });
  t.advance(1000);
  await t.host.tickNow();
  assert.equal(t.host.status().level, "winding-down");
  assert.equal(proc(t.pc, 2000).pri, 4);
  t.advance(61 * 1000);
  await t.host.tickNow();
  assert.equal(proc(t.pc, 2000).pri, 8, "put back after building finished");
  assert.equal(t.host.status().held, 0);
  assert.deepEqual(t.journal(), []);
  await t.host.stop();
});

test("Restore all puts everything back and holds auto mode off until the agents stop building", async () => {
  const t = setup({ prefs: { mode: "auto" } });
  t.setBuilding({ active: true, running: 1 });
  await t.host.tickNow();
  assert.equal(proc(t.pc, 2000).pri, 4);
  const result = await t.host.restoreAll();
  assert.equal(result.ok, true);
  assert.equal(result.restored, 2);
  assert.equal(proc(t.pc, 2000).pri, 8);
  t.advance(10_000);
  await t.host.tickNow();
  assert.equal(proc(t.pc, 2000).pri, 8, "snoozed: not slowed again while this building lasts");
  assert.equal(t.host.status().level, "snoozed");
  t.setBuilding({ active: false });
  t.advance(10_000);
  await t.host.tickNow();
  t.setBuilding({ active: true, running: 1 });
  t.advance(10_000);
  await t.host.tickNow();
  assert.equal(proc(t.pc, 2000).pri, 4, "the next building session acts again");
  await t.host.stop();
});

test("turning auto mode off puts back what auto did and keeps what you did", async () => {
  const t = setup({ prefs: { mode: "auto" } });
  t.setBuilding({ active: true, running: 1 });
  await t.host.tickNow();
  await t.host.act({ key: "discord", op: "pause" });
  assert.equal(proc(t.pc, 2000).pri, 4);
  assert.equal(proc(t.pc, 3000).frozen, true);
  const result = await t.host.setPrefs({ mode: "manual" });
  assert.equal(result.ok, true);
  assert.equal(t.saved.resources.mode, "manual");
  assert.equal(proc(t.pc, 2000).pri, 8, "auto's slow went back");
  assert.equal(proc(t.pc, 3000).frozen, true, "your pause stays");
  assert.equal((await t.host.setPrefs({ mode: "warp" })).ok, false);
  assert.equal((await t.host.setPrefs({ rule: { app: "Code.exe", value: "close" } })).prefs.rules.code, "close");
  await t.host.stop();
});

test("a helper that dies while holding is replaced, and the new one takes back what the journal says is still in effect", async () => {
  const t = setup();
  await t.host.act({ key: "msedge", op: "pause" });
  assert.equal(proc(t.pc, 2000).frozen, true);
  t.pc.helpers[0].crash();
  await t.settle();
  assert.equal(proc(t.pc, 2000).frozen, true, "a crashed helper put nothing back");
  await t.host.tickNow();
  assert.equal(t.pc.helpers.length, 2, "a new helper started");
  assert.ok(t.pc.log.includes("adopt 2000") && t.pc.log.includes("adopt 2001"), "it adopted what the journal held");
  const back = await t.host.act({ key: "msedge", op: "restore" });
  assert.equal(back.ok, true);
  assert.equal(proc(t.pc, 2000).frozen, false, "so Put back still works");
  await t.host.stop();
});

test("a launch puts back what the last Studio left held, and only what is still in effect", async () => {
  const files = new Map([[JOURNAL, JSON.stringify({ v: 1, at: 1, entries: [
    { pid: 2000, create: born(20), name: "msedge.exe", paused: true, slowed: false, oldPriority: 32, oldMemoryPriority: 5 },
    { pid: 3000, create: born(30), name: "Discord.exe", paused: true, slowed: false },
    { pid: 9999, create: born(99), name: "gone.exe", paused: true },
  ] })]]);
  const t = setup({ files });
  proc(t.pc, 2000).frozen = true; // still frozen: the last helper never put it back
  await t.host.start();
  assert.deepEqual(t.pc.log.filter((line) => line.startsWith("adopt")), ["adopt 2000"], "Discord already runs and 9999 is gone");
  assert.equal(proc(t.pc, 2000).frozen, false);
  assert.deepEqual(t.journal(), []);
  assert.match(t.host.view().log[0].text, /Put back 1 process Studio still held/);
  await t.host.stop();
});

test("quitting tells the helper to put everything back and exit", async () => {
  const t = setup();
  await t.host.act({ key: "msedge", op: "slow" });
  const child = t.pc.helpers[0];
  let lines = "";
  child.stdin.on("data", (chunk) => { lines += chunk; });
  t.host.quit();
  await t.settle();
  assert.match(lines, /^\d+ exit\n$/);
  assert.equal(proc(t.pc, 2000).pri, 8);
  assert.equal(child.exited, true);
});

test("the page's lease: pictures are pushed only while a page watches", async () => {
  const t = setup();
  await t.host.watch({ id: "page", on: true });
  await t.host.tickNow();
  assert.equal(t.sent.filter(([channel]) => channel === "resources:update").length, 1);
  await t.host.watch({ id: "page", on: false });
  await t.host.tickNow();
  assert.equal(t.sent.filter(([channel]) => channel === "resources:update").length, 1, "no lease: no push");
  await t.host.watch({ id: "page", on: true });
  t.advance(61_000);
  await t.host.tickNow();
  assert.equal(t.sent.filter(([channel]) => channel === "resources:update").length, 1, "a lease that was not renewed lapses");
  await t.host.stop();
});

test("off Windows, or turned off, there is no helper and the page says why", async () => {
  const mac = setup({ platform: "darwin" });
  const view = await mac.host.snapshot();
  assert.equal(view.supported, false);
  assert.equal(view.headline, "The resource manager works on Windows for now.");
  assert.equal((await mac.host.act({ key: "msedge", op: "slow" })).ok, false);
  assert.equal(mac.pc.helpers.length, 0);
  const off = setup({ disabled: "Turned off for this launch." });
  assert.equal((await off.host.snapshot()).headline, "Turned off for this launch.");
  assert.equal(off.pc.helpers.length, 0);
});

test("Make room now does one round of what auto mode would do, as your own holds", async () => {
  const t = setup({ prefs: { mode: "manual" } });
  const result = await t.host.focus();
  assert.equal(result.ok, true);
  assert.match(result.text, /^Made room: 1 change/);
  assert.equal(proc(t.pc, 2000).pri, 4);
  assert.equal(appOf(t.host.view(), "msedge").hold.slow.by, "you", "it stays until you put it back");
  await t.host.stop();
});

test("a hold reaches an app's new processes quietly: no log line and no toast for a browser opening a tab", async () => {
  const t = setup({ prefs: { mode: "auto" } });
  t.setBuilding({ active: true, running: 1 });
  await t.host.tickNow();
  assert.equal(proc(t.pc, 2000).pri, 4);
  const logged = t.host.view().log.length;
  const toasts = t.sent.filter(([channel]) => channel === "resources:acted").length;
  t.pc.procs.push({ pid: 2002, ppid: 2000, name: "msedge.exe", t: 25, create: born(25), path: "C:\\Edge\\msedge.exe", mem: 200, pri: 8, frozen: false, session: 1 });
  t.advance(4000);
  await t.host.tickNow();
  assert.equal(proc(t.pc, 2002).pri, 4, "the new tab is slowed too");
  assert.equal(t.host.view().log.length, logged, "and nothing is said about it");
  assert.equal(t.sent.filter(([channel]) => channel === "resources:acted").length, toasts);
  await t.host.stop();
});

test("a process Windows refuses is not asked again every tick; a press of yours asks again", async () => {
  const t = setup();
  proc(t.pc, 2001).denied = true;
  const paused = await t.host.act({ key: "msedge", op: "pause" });
  assert.equal(paused.text, "Paused Microsoft Edge (1 of 2 parts refused)");
  const asked = () => t.pc.asked.filter((line) => line === "pause 2001").length;
  assert.equal(asked(), 1);
  for (let i = 0; i < 3; i += 1) { t.advance(1500); await t.host.tickNow(); }
  assert.equal(asked(), 1, "keeping the hold whole skips the refused process");
  t.advance(11 * 60 * 1000);
  await t.host.tickNow();
  assert.equal(asked(), 2, "after ten minutes it is asked once more");
  await t.host.act({ key: "msedge", op: "pause" });
  assert.equal(asked(), 3, "your own press always asks");
  await t.host.stop();
});

test("a helper that cannot be built is not rebuilt on every look, and the page says why", async () => {
  let builds = 0;
  const t = setup({ buildHelper: async () => { builds += 1; throw new Error("csc said no about C:\\Users\\Ann\\AppData\\x.cs and c:/users/ann/y.cs"); } });
  const first = await t.host.snapshot();
  assert.equal(first.error, "csc said no about ~\\AppData\\x.cs and ~/y.cs", "the home folder never reaches the page");
  assert.ok(t.logs.every((line) => !/users.ann/i.test(line)), "nor the log");
  await t.host.snapshot();
  t.advance(30_000);
  await t.host.snapshot();
  assert.equal(builds, 1, "not again within a minute");
  t.advance(31_000);
  await t.host.snapshot();
  assert.equal(builds, 2);
  await t.host.stop();
});
