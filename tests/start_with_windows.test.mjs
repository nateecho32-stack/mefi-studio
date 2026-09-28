// Start with Windows (main.cjs "Start with Windows" and startupAtLogin): a PC
// the owner leaves working comes back to work after an update restart. Windows
// holds the real switch, Studio keeps the entry pointed at this copy of the
// app, and a login launch opens the last project in the tray, with the agents
// following "When Studio opens".
import test, { after } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { readFile } from "node:fs/promises";

const main = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));
const section = (source, start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `section exists: ${start}`);
  return source.slice(from, to);
};
const MINUTE = 60000;
const ROOT = "C:\\Users\\me\\Mefi's Studio AI+";

// ---- the Windows entry -------------------------------------------------------

// A stand-in for Windows' Run entries: one command line per value name.
function loginHost({ platform = "win32", packaged = false, atLogin = false, disabledInTaskManager = false } = {}) {
  const run = new Map();
  const lines = [];
  const commandOf = ({ path, args = [] }) => [`"${path}"`, ...args].join(" ");
  const app = {
    isPackaged: packaged,
    getLoginItemSettings(options) {
      const command = commandOf(options);
      const openAtLogin = [...run.values()].some((entry) => entry.command === command);
      return { openAtLogin, executableWillLaunchAtLogin: openAtLogin && !disabledInTaskManager, launchItems: [] };
    },
    setLoginItemSettings(options) {
      if (options.openAtLogin) run.set(options.name, { command: commandOf(options) });
      else for (const [name, entry] of run) if (entry.command === commandOf(options)) run.delete(name);
    },
  };
  const context = vm.createContext({
    app, process: { platform, execPath: packaged ? "C:\\Apps\\Mefi Studio AI+.exe" : `${ROOT}\\node_modules\\electron\\dist\\electron.exe` },
    STUDIO_ROOT: ROOT, LOGIN_ARG: "--at-login", AT_LOGIN: atLogin, SMOKE: false, CAPTURE: false, CLI_MODE: false,
    tray: null, window: null, logLine: (text) => lines.push(text),
  });
  vm.runInContext(section(main, "// ---- Start with Windows", "function refreshTray()"), context, { filename: "main.cjs:start-with-windows" });
  return { env: context, run, lines, get disabled() { return disabledInTaskManager; }, set disabled(value) { disabledInTaskManager = value; } };
}

test("a source checkout starts electron with its quoted folder; a build starts its own exe", () => {
  assert.deepEqual(plain(loginHost().env.loginItemTarget()), {
    path: `${ROOT}\\node_modules\\electron\\dist\\electron.exe`, args: [`"${ROOT}"`, "--at-login"],
  }, "the folder has spaces and an apostrophe, so Windows gets it quoted");
  assert.deepEqual(plain(loginHost({ packaged: true }).env.loginItemTarget()), { path: "C:\\Apps\\Mefi Studio AI+.exe", args: ["--at-login"] });
});

test("turning it on writes one named entry for this copy, and off removes it", () => {
  const host = loginHost();
  assert.deepEqual(plain(host.env.loginItemState()), { supported: true, on: false, blocked: false });
  assert.deepEqual(plain(host.env.applyLoginItem(true)), { supported: true, on: true, blocked: false });
  assert.deepEqual([...host.run.keys()], ["Mefi's Studio AI+"], "Task Manager lists it by Studio's name, not Electron's");
  assert.match(host.run.get("Mefi's Studio AI+").command, /--at-login$/);
  assert.deepEqual(plain(host.env.applyLoginItem(false)), { supported: true, on: false, blocked: false });
  assert.equal(host.run.size, 0);
});

test("Task Manager switching it off reads as off and blocked, and the launch never overrides it", () => {
  const host = loginHost();
  host.env.applyLoginItem(true);
  host.disabled = true;
  assert.deepEqual(plain(host.env.loginItemState()), { supported: true, on: false, blocked: true });
  const before = [...host.run.values()].map((entry) => entry.command);
  host.env.syncLoginItem({ ui: { openAtLogin: true } });
  assert.deepEqual([...host.run.values()].map((entry) => entry.command), before, "the owner's word in Task Manager stands");
  assert.equal(host.lines.length, 1, "nothing was written at launch");
});

test("the launch puts the entry back for an owner who chose it, when the app moved", () => {
  const host = loginHost();
  host.env.syncLoginItem({ ui: {} });
  assert.equal(host.run.size, 0, "no choice, no entry");
  host.run.set("Mefi's Studio AI+", { command: '"D:\\old copy\\electron.exe" "D:\\old copy" --at-login' });
  host.env.syncLoginItem({ ui: { openAtLogin: true } });
  assert.equal(host.env.loginItemState().on, true, "the entry points at this copy again");
  host.env.syncLoginItem({ ui: { openAtLogin: true } });
  assert.equal(host.lines.filter((line) => /Start with Windows on/.test(line)).length, 1, "an entry already in place is left alone");
});

test("where Windows cannot hold it, nothing is attempted and the switch stays hidden", () => {
  const host = loginHost({ platform: "linux" });
  assert.deepEqual(plain(host.env.applyLoginItem(true)), { supported: false, on: false, blocked: false });
  assert.equal(host.run.size, 0);
});

test("a login launch without a tray shows its window minimized, once; with a tray it stays hidden", () => {
  const calls = [];
  const window = { visible: false, isDestroyed: () => false, isVisible() { return this.visible; }, showInactive() { calls.push("showInactive"); this.visible = true; }, minimize() { calls.push("minimize"); } };
  const hidden = loginHost({ atLogin: true });
  hidden.env.window = window;
  hidden.env.tray = {};
  hidden.env.showLoginWindowWithoutTray();
  assert.deepEqual(calls, [], "the tray is the way back");

  const bare = loginHost({ atLogin: true });
  bare.env.window = window;
  bare.env.showLoginWindowWithoutTray();
  bare.env.window.visible = false;
  bare.env.showLoginWindowWithoutTray();
  assert.deepEqual(calls, ["showInactive", "minimize"], "shown once, without stealing focus");

  const normal = loginHost({ atLogin: false });
  normal.env.window = { ...window, visible: false };
  normal.env.showLoginWindowWithoutTray();
  assert.deepEqual(calls, ["showInactive", "minimize"], "an ordinary launch is never touched");
});

// ---- the login launch --------------------------------------------------------

const tempRoots = [];
after(() => { for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true }); });

function sessionHost({ atLogin = true, launchAgents, project = { id: "project_a", name: "Alpha", path: "C:/projects/alpha" }, record = null } = {}) {
  const root = fs.mkdtempSync(nodePath.join(os.tmpdir(), "mefi-login-"));
  tempRoots.push(root);
  const settingsPath = nodePath.join(root, "settings.json");
  if (launchAgents !== undefined) fs.writeFileSync(settingsPath, JSON.stringify({ ui: { launchAgents } }));
  if (record) fs.writeFileSync(nodePath.join(root, "session.json"), JSON.stringify(record));
  const context = vm.createContext({
    console, Date, JSON, Number, process,
    path: nodePath, app: { getPath: () => root },
    readFileSync: fs.readFileSync, writeFileSync: fs.writeFileSync, renameSync: fs.renameSync, mkdirSync: fs.mkdirSync, rmSync: fs.rmSync,
    SMOKE: false, CAPTURE: false, CLI_MODE: false, AT_LOGIN: atLogin, SETTINGS_PATH: settingsPath,
    pool: { queue: [], running: new Map() }, autopilot: { jobs: [], history: [], held: false },
    assistantState: null, assistantLoop: false,
    projects: { open: () => project },
    logLine() {}, setInterval: () => ({}), clearInterval() {},
  });
  vm.runInContext(section(main, "// ---- session continuity", "// ---- launch hold"), context, { filename: "main.cjs:session" });
  return context;
}

test("a login launch reopens the open project without the question, even after a quit", () => {
  const now = Date.now();
  const env = sessionHost({ record: { projectId: "project_a", activityAt: now - 12 * 60 * MINUTE, agents: true, exit: "quit" } });
  assert.equal(env.startupResume(now), null, "an ordinary launch would ask: the quit was deliberate and hours ago");
  const login = env.startupAtLogin(now);
  assert.deepEqual(plain(login), { projectId: "project_a", name: "Alpha", path: "C:/projects/alpha", activityAt: now - 12 * 60 * MINUTE, agents: true, atLogin: true });
});

test("the agents follow When Studio opens", () => {
  const now = Date.now();
  const ran = { projectId: "project_a", activityAt: now - 60 * MINUTE, agents: true, exit: "quit" };
  const idle = { ...ran, agents: false };
  assert.equal(sessionHost({ record: ran }).startupAtLogin(now).agents, true, "no choice saved means Resume what I had");
  assert.equal(sessionHost({ launchAgents: "resume", record: idle }).startupAtLogin(now).agents, false, "Resume brings back only agents that were running");
  assert.equal(sessionHost({ launchAgents: "resume", record: { ...ran, projectId: "project_b" } }).startupAtLogin(now).agents, false, "agents that ran in another folder are not this folder's");
  assert.equal(sessionHost({ launchAgents: "start", record: idle }).startupAtLogin(now).agents, true, "Start agents always starts them");
  assert.equal(sessionHost({ launchAgents: "start" }).startupAtLogin(now).agents, true, "even with no record at all");
  assert.equal(sessionHost({ launchAgents: "off", record: ran }).startupAtLogin(now).agents, false, "Keep agents off keeps them held");
});

test("only a login launch with a project open does any of this", () => {
  const now = Date.now();
  assert.equal(sessionHost({ atLogin: false, launchAgents: "start" }).startupAtLogin(now), null);
  assert.equal(sessionHost({ project: null, launchAgents: "start" }).startupAtLogin(now), null);
  const fresh = sessionHost({ launchAgents: "start" }).startupAtLogin(now);
  assert.equal(fresh.activityAt, now, "no record: the launch itself is the moment");
});

test("the launch takes the login answer when there is nothing to resume", () => {
  const launch = (resume, atLogin) => {
    const context = vm.createContext({
      console, SMOKE: false, CAPTURE: false, CLI_MODE: false, Date, Math,
      autopilot: { held: null }, startupChosen: false, startupResumed: null,
      startupResume: () => resume, startupAtLogin: () => atLogin,
      logLine(text) { context.logged = text; }, createWindow() {}, startSessionBeat() {},
    });
    vm.runInContext(section(main, "  startupResumed = startupResume();", "  createWindow();"), context, { filename: "main.cjs:launch" });
    return context;
  };
  const login = launch(null, { projectId: "project_a", name: "Alpha", activityAt: Date.now(), agents: true, atLogin: true });
  assert.equal(login.startupChosen, true);
  assert.equal(login.autopilot.held, false);
  assert.match(login.logged, /started with Windows · Alpha · agents start/);

  const held = launch(null, { projectId: "project_a", name: "Alpha", activityAt: Date.now(), agents: false, atLogin: true });
  assert.equal(held.autopilot.held, true);

  const resumed = launch({ projectId: "project_a", name: "Alpha", activityAt: Date.now() - MINUTE, agents: true }, { atLogin: true, agents: false });
  assert.match(resumed.logged, /resuming Alpha/, "work still in progress wins: a reboot mid-run comes back as it was");
  assert.equal(resumed.autopilot.held, false);
});

// ---- the preference ----------------------------------------------------------

test("prefs carry Start with Windows through Windows, coerced to a boolean", async () => {
  const handlers = new Map();
  let saved = { ui: { launchAgents: "resume" } };
  const applied = [];
  let on = false;
  const context = vm.createContext({
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    readSettings: async () => JSON.parse(JSON.stringify(saved)),
    updateSettings: async (edit) => { edit(saved); return JSON.parse(JSON.stringify(saved)); },
    loginItemState: () => ({ supported: true, on, blocked: false }),
    applyLoginItem: (value) => { applied.push(value); on = value; return { supported: true, on, blocked: false }; },
  });
  vm.runInContext(section(main, "  // openAtLogin reads back what Windows holds", "  // ---- machine coordination"), context, { filename: "main.cjs:prefs" });

  const set = await handlers.get("prefs:set")({}, { openAtLogin: "yes please" });
  assert.deepEqual(applied, [false], "only true turns it on");
  assert.equal(saved.ui.openAtLogin, false);
  assert.deepEqual(plain(set.loginItem), { supported: true, on: false, blocked: false });

  await handlers.get("prefs:set")({}, { openAtLogin: true });
  const read = await handlers.get("prefs:get")({});
  assert.equal(read.prefs.openAtLogin, true);
  assert.equal(read.prefs.launchAgents, "resume");
  assert.deepEqual(plain(read.loginItem), { supported: true, on: true, blocked: false });

  on = false; // Task Manager or another tool took it away: the switch says so.
  assert.equal((await handlers.get("prefs:get")({})).prefs.openAtLogin, false);

  const other = await handlers.get("prefs:set")({}, { launchAgents: "start" });
  assert.equal(other.loginItem, undefined, "other preferences never touch Windows");
  assert.deepEqual(applied, [false, true]);
});
