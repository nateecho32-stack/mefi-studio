// scripts/resource-rules.cjs: what the resource manager (Team › Resources) may
// touch, how processes become apps, what auto mode does while agents build and
// when it puts things back, the journal's adoptions and the words. Pure, so
// every rule is pinned here with a made-up process table.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const rules = require("../scripts/resource-rules.cjs");

const MIB = 1024 * 1024;
const T0 = 133000000000000000n;
const born = (n) => String(T0 + BigInt(n) * 10000000n);

// The helper's `snap` reply for a list of processes.
function raw({ at = 5_000_000, procs, fg = 0, self = 900, session = 1, mem = [16384 * MIB, 4096 * MIB, 32768 * MIB, 10240 * MIB, 75], sys = [0, 0, 0], ledger = [] } = {}) {
  const files = [];
  const index = new Map();
  const rows = procs.map((p) => {
    let file = -1;
    if (p.path) {
      if (!index.has(p.path)) { index.set(p.path, files.length); files.push([p.path, p.desc ?? ""]); }
      file = index.get(p.path);
    }
    return [p.pid, p.ppid ?? 0, p.name, p.create ?? born(p.t ?? p.pid), p.cpu ?? 0, (p.ws ?? 100) * MIB, (p.priv ?? 80) * MIB, (p.mem ?? 60) * MIB, p.session ?? 1, p.pri ?? 8, p.threads ?? 4, p.frozen ? 1 : 0, file, p.title ?? null];
  });
  return { ok: true, at, cpus: 4, sys, mem, fg, idle: 0, self, session, procs: rows, files, ledger };
}

const WIN = "C:\\Windows";
// A desktop: Windows, a terminal that started Studio, Studio and its agents, and other apps.
const TABLE = [
  { pid: 4, t: 0, name: "System", session: 0 },
  { pid: 600, t: 1, ppid: 500, name: "explorer.exe", path: "C:\\Windows\\explorer.exe" },
  { pid: 700, t: 1, name: "csrss.exe", path: "C:\\Windows\\System32\\csrss.exe" },
  { pid: 800, t: 1, name: "svchost.exe", session: 0 },
  { pid: 8000, t: 2, ppid: 600, name: "WindowsTerminal.exe", path: "C:\\Program Files\\WindowsApps\\Terminal\\WindowsTerminal.exe", title: "PowerShell" },
  { pid: 1000, t: 10, ppid: 8000, name: "electron.exe", path: "C:\\Apps\\Mefi\\electron.exe", mem: 300, title: "Mefi's Studio AI+" },
  { pid: 1001, t: 11, ppid: 1000, name: "electron.exe", path: "C:\\Apps\\Mefi\\electron.exe", mem: 400 },
  { pid: 1002, t: 12, ppid: 1000, name: "claude.exe", path: "C:\\Users\\u\\.local\\bin\\claude.exe", mem: 500 },
  { pid: 1003, t: 13, ppid: 1002, name: "node.exe", path: "C:\\Program Files\\nodejs\\node.exe", mem: 200 },
  { pid: 900, t: 14, ppid: 1000, name: "resource-helper-abc.exe", path: "C:\\Users\\u\\AppData\\Local\\MefiStudio\\resources\\resource-helper-abc.exe", mem: 15 },
  { pid: 2000, t: 20, ppid: 600, name: "msedge.exe", path: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", desc: "Microsoft Edge", title: "News - Edge", mem: 400 },
  { pid: 2001, t: 21, ppid: 2000, name: "msedge.exe", path: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", mem: 300 },
  { pid: 2002, t: 22, ppid: 2000, name: "msedge.exe", path: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", mem: 250 },
  { pid: 3000, t: 30, ppid: 600, name: "Discord.exe", path: "C:\\Users\\u\\AppData\\Local\\Discord\\Discord.exe", title: "Discord", mem: 350 },
  { pid: 3001, t: 31, ppid: 3000, name: "Discord.exe", path: "C:\\Users\\u\\AppData\\Local\\Discord\\Discord.exe", mem: 300 },
  { pid: 4000, t: 40, ppid: 600, name: "steam.exe", path: "C:\\Program Files (x86)\\Steam\\steam.exe", mem: 100 },
  { pid: 4001, t: 41, ppid: 4000, name: "steamwebhelper.exe", path: "C:\\Program Files (x86)\\Steam\\bin\\steamwebhelper.exe", mem: 300 },
  { pid: 5000, t: 50, ppid: 600, name: "Code.exe", path: "C:\\Users\\u\\AppData\\Local\\Programs\\VS Code\\Code.exe", title: "main.cjs - VS Code", mem: 200 },
  { pid: 5001, t: 51, ppid: 5000, name: "node.exe", path: "C:\\Program Files\\nodejs\\node.exe", mem: 150 },
  { pid: 6000, t: 3, ppid: 8000, name: "OpenConsole.exe", path: "C:\\Program Files\\WindowsApps\\Terminal\\OpenConsole.exe", mem: 10 },
  { pid: 7000, t: 60, ppid: 600, name: "AdminTool.exe", mem: 90 },
  { pid: 7100, t: 61, ppid: 1, name: "someone.exe", path: "C:\\Users\\other\\app\\someone.exe", session: 2, mem: 70 },
  // Its parent pid is Studio's, but it started before Studio: a reused pid, no relation.
  { pid: 9000, t: 5, ppid: 1000, name: "old.exe", path: "C:\\Tools\\old.exe", mem: 40 },
];

const createOf = (pid) => born(TABLE.find((p) => p.pid === pid)?.t ?? pid);
const snapshot = (options = {}) => rules.readSnapshot(raw({ procs: TABLE, ...options }));
const grouped = (options = {}, extra = {}) => rules.groupApps({ snapshot: snapshot(options), studioPids: [1000], windowsDir: WIN, ...extra });
const app = (groups, key) => groups.apps.find((entry) => entry.key === key);

test("creation times are compared as long decimal strings, never as rounded numbers", () => {
  assert.equal(rules.compareCreate("134357669217106000", "134357669217106001"), -1);
  assert.equal(rules.compareCreate("99", "100"), -1);
  assert.equal(rules.compareCreate("100", "100"), 0);
  assert.equal(rules.compareCreate("0100", "99"), 1, "leading zeros do not make a number bigger");
});

test("readSnapshot keeps the helper's numbers, files, titles and ledger as plain fields and drops broken rows", () => {
  const reply = raw({ procs: TABLE.slice(0, 3), ledger: [{ pid: 600, create: createOf(600), name: "explorer.exe", slowed: true, paused: false, oldPriority: 32, oldMemoryPriority: 5 }, { pid: "x" }] });
  reply.procs.push([12, 0, "bad", 77, 0, 0, 0, 0, 1, 8, 1, 0, -1, null], "not a row");
  const read = rules.readSnapshot(reply);
  assert.equal(read.processes.length, 3, "a row with a numeric creation time or no array is dropped");
  const explorer = read.processes.find((row) => row.pid === 600);
  assert.equal(explorer.id, `600:${createOf(600)}`);
  assert.equal(explorer.path, "C:\\Windows\\explorer.exe");
  assert.equal(explorer.privateWorkingSetMB, 60);
  assert.equal(read.memory.totalMB, 16384);
  assert.equal(read.memory.freeMB, 4096);
  assert.equal(read.session, 1);
  assert.deepEqual(read.ledger.map((row) => [row.id, row.slowed, row.oldPriority]), [[`600:${createOf(600)}`, true, 32]]);
  assert.equal(rules.readSnapshot(null), null);
  assert.equal(rules.readSnapshot({ procs: "no" }), null);
});

test("cpuUse: each process's share of the whole machine between two pictures, and the machine's own", () => {
  const first = rules.readSnapshot(raw({ at: 1000, procs: [{ pid: 10, name: "a.exe", cpu: 0 }, { pid: 11, name: "b.exe", cpu: 0 }], sys: [0, 0, 0] }));
  // One second later: a used one core's full second (1e7 ticks of 100 ns) on a 4-CPU machine; b is new.
  const second = rules.readSnapshot(raw({ at: 2000, procs: [{ pid: 10, name: "a.exe", cpu: 1e7 }, { pid: 12, name: "c.exe", cpu: 5e6 }], sys: [3e7, 3.5e7, 0.5e7] }));
  const use = rules.cpuUse(first, second);
  assert.equal(use.byProcess.get(`10:${born(10)}`), 25);
  assert.equal(use.byProcess.has(`12:${born(12)}`), false, "a new process has no share yet");
  // kernel (with idle) + user = 4e7, idle 3e7: a quarter busy.
  assert.equal(use.system, 25);
  assert.deepEqual(rules.cpuUse(null, second), { system: null, byProcess: new Map() });
});

test("Studio's tree: everything started from Studio, and what Studio was started from, but not a reused parent pid", () => {
  const snap = snapshot();
  const tree = rules.studioTree(snap.processes, [1000]);
  const own = [...tree.own].map((id) => Number(id.split(":")[0])).sort((a, b) => a - b);
  assert.deepEqual(own, [900, 1000, 1001, 1002, 1003]);
  assert.ok(tree.above.has(`8000:${born(2)}`), "the terminal that started Studio");
  assert.ok(tree.above.has(`600:${born(1)}`), "and the shell above it");
  assert.ok(!tree.own.has(`9000:${born(5)}`), "an older process whose parent pid was reused by Studio is not Studio's");
});

test("protection names why a process is never touched", () => {
  const snap = snapshot();
  const tree = rules.studioTree(snap.processes, [1000]);
  const ctx = { tree, windowsDir: WIN, session: 1, self: 900 };
  const why = (pid) => rules.protection(snap.processes.find((row) => row.pid === pid), ctx)?.code ?? null;
  assert.equal(why(4), "windows");
  assert.equal(why(800), "service");
  assert.equal(why(700), "windows");
  assert.equal(why(1002), "studio", "an agent Studio started");
  assert.equal(why(900), "studio", "the helper itself");
  assert.equal(why(8000), "above");
  assert.equal(why(6000), "console");
  assert.equal(why(7000), "hidden", "Windows would not say which program it is");
  assert.equal(why(7100), "session");
  assert.equal(why(2000), null);
  assert.equal(why(9000), null);
  const defender = rules.protection({ id: "1:1", pid: 50, name: "MsMpEng.exe", session: 1, path: "C:\\ProgramData\\Microsoft\\Windows Defender\\MsMpEng.exe" }, ctx);
  assert.equal(defender.code, "safety");
});

test("groupApps: one app per program, a browser's tabs and a launcher's web views folded in, Studio and Windows counted apart", () => {
  const groups = grouped();
  const edge = app(groups, "msedge");
  assert.equal(edge.name, "Microsoft Edge");
  assert.equal(edge.kind, "browser");
  assert.equal(edge.count, 3);
  assert.equal(edge.memMB, 950);
  assert.equal(edge.title, "News - Edge");
  assert.equal(edge.targets.length, 3);
  assert.equal(edge.rule, "auto");
  const steam = app(groups, "steam");
  assert.equal(steam.count, 2, "steamwebhelper belongs to Steam");
  assert.equal(app(groups, "steamwebhelper"), undefined);
  assert.equal(app(groups, "discord").rule, "leave", "calls are left alone unless you say otherwise");
  assert.equal(app(groups, "node").count, 1, "the editor's node is its own app; Studio's agent node is Studio's");
  assert.equal(groups.studio.count, 5);
  assert.equal(groups.studio.memMB, 1415);
  assert.equal(groups.windows.count, 5, "System, explorer, csrss, a service and another person's app");
  assert.equal(app(groups, "windowsterminal").protected.code, "above");
  assert.equal(app(groups, "openconsole").protected.code, "console");
  assert.equal(app(groups, "admintool").protected.code, "hidden");
  assert.equal(app(groups, "old").protected, null);
  assert.equal(app(groups, "electron"), undefined, "Studio is never offered as an app");
  assert.ok(groups.apps.every((entry, index, all) => index === 0 || all[index - 1].memMB >= entry.memMB), "heaviest first");
});

test("groupApps reads the ledger and the holds: all, some or none of an app's processes slowed or paused", () => {
  const ledger = [
    { pid: 2000, create: createOf(2000), name: "msedge.exe", slowed: true, paused: false },
    { pid: 2001, create: createOf(2001), name: "msedge.exe", slowed: true, paused: false },
    { pid: 4000, create: createOf(4000), name: "steam.exe", slowed: false, paused: true },
    { pid: 4001, create: createOf(4001), name: "steamwebhelper.exe", slowed: false, paused: true },
  ];
  const holds = new Map([["msedge", { slow: { by: "auto", at: 1 }, pause: null }], ["steam", { slow: null, pause: { by: "you", at: 2 } }]]);
  const groups = grouped({ ledger, fg: 5000 }, { holds, prefs: { rules: { steam: "pause", Code: "leave" } } });
  const edge = app(groups, "msedge");
  assert.equal(edge.slowed, "some");
  assert.equal(edge.paused, "none");
  assert.deepEqual(edge.hold, { slow: { by: "auto", at: 1 }, pause: null });
  const steam = app(groups, "steam");
  assert.equal(steam.paused, "all");
  assert.equal(steam.rule, "pause");
  assert.equal(steam.ruleSet, true);
  const code = app(groups, "code");
  assert.equal(code.foreground, true);
  assert.equal(code.rule, "leave");
});

test("preferences: defaults, ranges, rules kept by app key, and a patch that is checked before anything changes", () => {
  const prefs = rules.normalizePrefs({ mode: "turbo", keepFreeMB: 999999, heavyCpuPct: -4, rules: { "MSEdge.exe": "pause", discord: "auto", "bad/name": "slow", steam: "explode" }, notify: "yes" });
  assert.equal(prefs.mode, "manual");
  assert.equal(prefs.keepFreeMB, 65536);
  assert.equal(prefs.heavyCpuPct, 1);
  assert.equal(prefs.notify, true);
  assert.deepEqual(prefs.rules, { msedge: "pause" });
  assert.deepEqual(rules.applyPrefsPatch(prefs, { mode: "auto" }).prefs.mode, "auto");
  assert.equal(rules.applyPrefsPatch(prefs, { mode: "fast" }).ok, false);
  assert.equal(rules.applyPrefsPatch(prefs, { keepFreeMB: 10 }).ok, false);
  assert.equal(rules.applyPrefsPatch(prefs, { notify: "on" }).ok, false);
  const ruled = rules.applyPrefsPatch(prefs, { rule: { app: "Discord.exe", value: "slow" } });
  assert.deepEqual(ruled.prefs.rules, { msedge: "pause", discord: "slow" });
  assert.deepEqual(rules.applyPrefsPatch(ruled.prefs, { rule: { app: "discord", value: "auto" } }).prefs.rules, { msedge: "pause" }, "auto forgets the app's rule");
  assert.equal(rules.applyPrefsPatch(prefs, { rule: { app: "../../x", value: "slow" } }).ok, false);
  assert.equal(rules.applyPrefsPatch(prefs, { rule: { app: "edge", value: "nuke" } }).ok, false);
  const many = { rules: Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`app${i}`, "slow"])) };
  assert.equal(rules.applyPrefsPatch(many, { rule: { app: "one-more", value: "slow" } }).ok, false, "at most 300 rules");
});

// ---- auto mode ---------------------------------------------------------------------
const NOW = 10_000_000;
function planFor({ prefs = {}, building = { active: true, since: NOW - 60_000 }, freeMB = 6000, holds, ledger, fg = 0, marks = new Map(), snoozed = false, now = NOW } = {}) {
  const groups = grouped({ ledger, fg }, { holds, prefs });
  return rules.plan({ apps: groups.apps, prefs: { mode: "auto", ...prefs }, building, memory: { freeMB }, marks, snoozed, now });
}
const ops = (decided) => decided.apply.map((step) => `${step.op} ${step.key}`).sort();

test("manual mode does nothing by itself, except letting a paused app you switch to run again", () => {
  const holds = new Map([["msedge", { slow: null, pause: { by: "you", at: 1 } }]]);
  const ledger = [2000, 2001, 2002].map((pid) => ({ pid, create: createOf(pid), name: "msedge.exe", slowed: false, paused: true }));
  const groups = grouped({ ledger, fg: 2000 }, { holds });
  const decided = rules.plan({ apps: groups.apps, prefs: { mode: "manual" }, building: { active: true, since: 0 }, memory: { freeMB: 100 }, now: NOW });
  assert.equal(decided.level, "manual");
  assert.deepEqual(decided.apply, []);
  assert.deepEqual(decided.release, [{ key: "msedge", what: "pause", reason: "you switched to it" }]);
});

test("auto mode while agents build: heavy background apps are slowed; calls, the app in front of you and one you just used are not", () => {
  const marks = new Map([["code", { usedAt: NOW - 30_000 }]]);
  const decided = planFor({ marks });
  assert.equal(decided.level, "focus");
  // Edge 950 MB and Steam 400 MB? Only Edge reaches 500 MB; Discord is a call app; Code was used 30 s ago.
  assert.deepEqual(ops(decided), ["slow msedge"]);
  assert.equal(decided.apply[0].by, "auto");
  assert.equal(decided.short, null);
  const lighter = planFor({ prefs: { heavyMemMB: 300 }, fg: 2000 });
  assert.deepEqual(ops(lighter), ["slow steam"], "the app in front of you is never slowed, a lower bar takes Steam");
});

test("an app's rule wins: slow and pause whenever agents build, close once per building session, leave never", () => {
  const prefs = { rules: { steam: "pause", old: "slow", discord: "close", msedge: "leave" } };
  assert.deepEqual(ops(planFor({ prefs })), ["close discord", "pause steam", "slow old"]);
  const marks = new Map([["discord", { closedAt: NOW - 1000 }]]);
  assert.deepEqual(ops(planFor({ prefs, marks })), ["pause steam", "slow old"], "closed once this session already");
  const holds = new Map([["msedge", { slow: { by: "auto", at: 1 }, pause: null }]]);
  const ledger = [2000, 2001, 2002].map((pid) => ({ pid, create: createOf(pid), slowed: true, paused: false }));
  assert.deepEqual(planFor({ prefs, holds, ledger }).release, [{ key: "msedge", what: "auto", reason: "its rule says leave it alone" }]);
});

test("short of memory: background apps give memory back at most every few minutes, and pausing is offered, never done", () => {
  const decided = planFor({ freeMB: 600, prefs: { keepFreeMB: 2048 } });
  assert.deepEqual(decided.short, { freeMB: 600, wantMB: 2048 });
  assert.deepEqual(ops(decided), ["slow msedge", "trim msedge", "trim steam"]);
  assert.deepEqual(decided.suggest.map((entry) => entry.key), ["msedge", "steam", "code"], "the heaviest auto-rule apps until the gap is covered");
  assert.ok(decided.apply.every((step) => step.op !== "pause"));
  const marks = new Map([["msedge", { trimmedAt: NOW - 60_000 }]]);
  assert.deepEqual(ops(planFor({ freeMB: 600, marks })), ["slow msedge", "trim steam"], "trimmed a minute ago: not again yet");
  const off = planFor({ freeMB: 600, prefs: { trimWhenShort: false } });
  assert.deepEqual(ops(off), ["slow msedge"]);
  const waiting = planFor({ building: { active: true, since: NOW - 1000, waitingForMemory: true } });
  assert.ok(waiting.short, "work waiting for memory is short whatever the free number says");
});

test("when agents stop building, auto's holds go back after the delay you chose; yours stay", () => {
  const holds = new Map([["msedge", { slow: { by: "auto", at: 1 }, pause: null }], ["steam", { slow: null, pause: { by: "you", at: 1 } }]]);
  const ledger = [
    ...[2000, 2001, 2002].map((pid) => ({ pid, create: createOf(pid), slowed: true, paused: false })),
    ...[4000, 4001].map((pid) => ({ pid, create: createOf(pid), slowed: false, paused: true })),
  ];
  const soon = planFor({ holds, ledger, building: { active: false, since: NOW - 600_000, endedAt: NOW - 30_000 } });
  assert.equal(soon.level, "winding-down");
  assert.deepEqual(soon.release, []);
  const later = planFor({ holds, ledger, building: { active: false, since: NOW - 600_000, endedAt: NOW - 61_000 } });
  assert.equal(later.level, "watching");
  assert.deepEqual(later.release, [{ key: "msedge", what: "auto", reason: "building finished" }]);
  const now = planFor({ holds, ledger, prefs: { restoreAfterSec: 0 }, building: { active: false, since: NOW - 600_000, endedAt: NOW - 1 } });
  assert.deepEqual(now.release.map((entry) => entry.key), ["msedge"]);
});

test("restore all holds auto off; an app you put back or switched to is not touched again this session", () => {
  assert.equal(planFor({ snoozed: true }).level, "snoozed");
  assert.deepEqual(planFor({ snoozed: true }).apply, []);
  const marks = new Map([["msedge", { releasedAt: NOW - 5000 }]]);
  assert.deepEqual(ops(planFor({ marks })), [], "released after this building session began");
  const before = new Map([["msedge", { releasedAt: NOW - 120_000 }]]);
  assert.deepEqual(ops(planFor({ marks: before })), ["slow msedge"], "a release in an earlier session does not count");
});

test("a hold reaches the app's new processes with the same owner", () => {
  const holds = new Map([["msedge", { slow: { by: "you", at: 1 }, pause: null }]]);
  const ledger = [2000, 2001].map((pid) => ({ pid, create: createOf(pid), slowed: true, paused: false }));
  const decided = planFor({ holds, ledger, prefs: { mode: "manual" } });
  assert.deepEqual(decided.apply, [{ key: "msedge", op: "slow", by: "you", reason: "a new process of a slowed app", whole: true }]);
});

test("adoptions: only what the picture shows is still in effect goes to a new helper", () => {
  const snap = rules.readSnapshot(raw({ procs: [
    { pid: 10, name: "a.exe", path: "C:\\a.exe", frozen: true, pri: 4 },
    { pid: 11, name: "b.exe", path: "C:\\b.exe", frozen: false, pri: 8 },
    { pid: 12, name: "c.exe", path: "C:\\c.exe", frozen: false, pri: 4 },
  ] }));
  const tokens = rules.adoptions([
    { pid: 10, create: born(10), paused: true, slowed: true, oldPriority: 32768, oldMemoryPriority: 3 },
    { pid: 11, create: born(11), paused: true, slowed: true, oldPriority: 32 },
    { pid: 12, create: born(12), paused: false, slowed: true },
    { pid: 13, create: born(13), paused: true },
    { pid: 10, create: "123", paused: true },
    null,
  ], snap);
  assert.deepEqual(tokens, [`10:${born(10)}:ps:32768:3`, `12:${born(12)}:s:32:5`]);
});

test("the words: what was done, what went wrong, and the headline for each state", () => {
  assert.equal(rules.actionWords({ op: "pause", name: "Discord", ok: 2 }), "Paused Discord");
  assert.equal(rules.actionWords({ op: "slow", name: "Edge", ok: 28, failed: 2 }), "Slowed down Edge (2 of 30 parts refused)");
  assert.match(rules.actionWords({ op: "end", name: "Game", failed: 1, error: "denied" }), /^Could not end Game: Windows won't let Studio change it/);
  assert.equal(rules.errorWords("nope", "a detail"), "a detail");
  assert.equal(rules.headline({ supported: false, reason: "" }), "The resource manager works on Windows.");
  assert.match(rules.headline({ mode: "manual" }), /^Manual: Studio changes nothing/);
  assert.match(rules.headline({ mode: "manual", held: 2, paused: 1 }), /Holding 2 apps, 1 paused/);
  assert.match(rules.headline({ mode: "auto", level: "focus", short: { freeMB: 600, wantMB: 2048 } }), /short of memory \(600 MB free, 2.0 GB wanted\)/);
  assert.match(rules.headline({ mode: "auto", level: "snoozed" }), /holding off/);
  assert.match(rules.headline({ mode: "auto", level: "watching" }), /^Auto is watching/);
  assert.equal(rules.gb(512), "512 MB");
  assert.equal(rules.gb(2048), "2.0 GB");
  assert.equal(rules.appKeyOf("Microsoft Edge.EXE"), "microsoft edge");
  assert.equal(rules.appKeyOf("..\\evil"), "");
});
