import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import path from "node:path";
import os from "node:os";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { classifyPath, plan, createUpdater } from "../scripts/updater.mjs";

const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
function section(from, to) {
  const start = source.indexOf(from), end = source.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, from);
  return source.slice(start, end);
}

test("all renderer styles are watched, while cached CommonJS helpers require restart", () => {
  assert.equal(classifyPath("renderer/music.css"), "style");
  assert.equal(plan(["renderer/music.css"]).build, true);
  for (const helper of ["backlog", "task-context", "projects", "idea-actions", "music-recommendations"]) {
    assert.equal(classifyPath(`scripts/${helper}.cjs`), "restart");
  }
  assert.equal(classifyPath("scripts/assistant.mjs"), "modules");
});

test("an incomplete renderer build keeps the live payload and retries the whole update when its input arrives", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mefi-update-input-"));
  const sourceRoot = path.join(root, "source"), appRoot = path.join(root, "app");
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const base of [sourceRoot, appRoot]) {
    await mkdir(path.join(base, "renderer"), { recursive: true });
    await writeFile(path.join(base, "package.json"), JSON.stringify({ name: "fixture", main: "main.cjs" }));
    await writeFile(path.join(base, "renderer", "existing.js"), "const oldValue = 1;");
    await writeFile(path.join(base, "renderer", "booklet.html"), "LAST COMPLETE PAGE");
  }
  const events = [], reloads = [];
  const updater = createUpdater({ sourceRoot, appRoot, watch: false, pollMs: 3600000,
    build: async () => {
      const input = await readFile(path.join(sourceRoot, "renderer", "arriving.js"), "utf8");
      await writeFile(path.join(sourceRoot, "renderer", "booklet.html"), `COMPLETE ${input}`);
    },
    actions: { reload: async (files) => reloads.push(files) }, onEvent: (event) => events.push(event) });
  t.after(() => updater.stop());
  await updater.start();
  await writeFile(path.join(sourceRoot, "renderer", "existing.js"), "const newValue = 2;");
  const held = await updater.applyNow();
  assert.equal(held.phase, "held");
  assert.equal(held.reason, "incomplete source files");
  assert.equal(held.error, "Waiting for renderer/arriving.js");
  assert.equal(events.some((event) => event.phase === "error"), false);
  assert.equal(reloads.length, 0);
  assert.equal(await readFile(path.join(appRoot, "renderer", "existing.js"), "utf8"), "const oldValue = 1;");
  assert.equal(await readFile(path.join(appRoot, "renderer", "booklet.html"), "utf8"), "LAST COMPLETE PAGE");
  await writeFile(path.join(sourceRoot, "renderer", "arriving.js"), "const ready = true;");
  const applied = await updater.applyNow();
  assert.equal(applied.applied, true);
  assert.equal(reloads.length, 1);
  assert.ok(reloads[0].includes("renderer/existing.js"), "the deferred edit is retained until the entire build succeeds");
  assert.equal(await readFile(path.join(appRoot, "renderer", "existing.js"), "utf8"), "const newValue = 2;");
  assert.equal(await readFile(path.join(appRoot, "renderer", "booklet.html"), "utf8"), "COMPLETE const ready = true;");
});

test("hot styling preserves base, music/theme, planning and profiler stylesheets in build order", async () => {
  let applied = "previous styles";
  let missing = false;
  const env = vm.createContext({
    path, setTimeout, clearTimeout, STUDIO_ROOT: "/fixture", updater: null, send() {}, logLine() {}, updateEvent: (value) => value,
    readFile: async (file) => {
      if (missing && file.endsWith("music.css")) throw new Error("not ready");
      if (file.endsWith("planning.css")) return ".planning-sheet { color: ivory; }";
      if (file.endsWith("profiler.css")) return ".profiler-sheet { color: gold; }";
      return file.endsWith("music.css") ? ".music-sheet { color: violet; }" : "body { color: gold; }";
    },
    window: { isDestroyed: () => false, webContents: { executeJavaScript: async (script) =>
      vm.runInNewContext(script, { window: { MefiNav: { applyStyles: (css) => { applied = css; return true; } } } }) } },
  });
  vm.runInContext(section("async function rendererValue(", "// The renderer writes"), env);
  vm.runInContext(section("async function applyStyle(", "// Changed script modules"), env);
  assert.equal(await env.applyStyle(["renderer/music.css"]), true);
  assert.equal(applied, "body { color: gold; }\n.music-sheet { color: violet; }\n.planning-sheet { color: ivory; }\n.profiler-sheet { color: gold; }");
  missing = true;
  assert.equal(await env.applyStyle(["renderer/styles.css"]), false);
  assert.ok(applied.includes(".music-sheet"), "an incomplete read cannot strip the current styles");
});

async function restartFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mefi-update-requires-"));
  const sourceRoot = path.join(root, "source"), appRoot = path.join(root, "app");
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const base of [sourceRoot, appRoot]) {
    await mkdir(path.join(base, "scripts"), { recursive: true });
    await writeFile(path.join(base, "package.json"), JSON.stringify({ name: "fixture", main: "main.cjs" }));
    await writeFile(path.join(base, "main.cjs"), "const app = 1;");
  }
  const restarts = [], events = [];
  const updater = createUpdater({ sourceRoot, appRoot, watch: false, pollMs: 3600000, debounceMs: 3600000,
    build: async () => {},
    actions: { restart: async (files) => restarts.push(files) },
    onEvent: (event) => events.push(event) });
  t.after(() => updater.stop());
  await updater.start();
  return { sourceRoot, appRoot, restarts, events, updater };
}

test("a restart holds until a helper written after its requiring file exists", async (t) => {
  const fixture = await restartFixture(t);
  const { sourceRoot, appRoot, updater, restarts } = fixture;
  await writeFile(path.join(sourceRoot, "main.cjs"), 'const helper = require("./scripts/late-helper.cjs");\nconsole.log(helper);');
  const held = await updater.applyNow();
  assert.equal(held.phase, "held");
  assert.equal(held.reason, "incomplete source files");
  assert.equal(held.error, "Waiting for scripts/late-helper.cjs");
  assert.equal(restarts.length, 0, "the payload must not relaunch without the module its main.cjs requires");
  assert.equal(await readFile(path.join(appRoot, "main.cjs"), "utf8"), "const app = 1;");
  await writeFile(path.join(sourceRoot, "scripts", "late-helper.cjs"), "module.exports = 42;");
  const applied = await updater.applyNow();
  assert.equal(applied.applied, true);
  assert.equal(restarts.length, 1);
  assert.equal(await readFile(path.join(appRoot, "scripts", "late-helper.cjs"), "utf8"), "module.exports = 42;");
  assert.match(await readFile(path.join(appRoot, "main.cjs"), "utf8"), /late-helper/);
});

test("deleting a helper holds the restart even when its requiring file did not change", async (t) => {
  const fixture = await restartFixture(t);
  const { sourceRoot, appRoot, updater, restarts } = fixture;
  for (const base of [sourceRoot, appRoot]) await writeFile(path.join(base, "scripts", "helper.cjs"), "module.exports = 7;");
  await writeFile(path.join(sourceRoot, "main.cjs"), 'const helper = require("./scripts/helper.cjs");\nconsole.log(helper);');
  await writeFile(path.join(appRoot, "main.cjs"), 'const helper = require("./scripts/helper.cjs");\nconsole.log(helper);');
  await rm(path.join(sourceRoot, "scripts", "helper.cjs"));
  const held = await updater.applyNow();
  assert.equal(held.phase, "held");
  assert.equal(held.error, "Waiting for scripts/helper.cjs");
  assert.equal(restarts.length, 0);
  assert.equal(await readFile(path.join(appRoot, "scripts", "helper.cjs"), "utf8"), "module.exports = 7;");
});

function restartHost() {
  let exits = 0, asks = 0, assistantStops = 0;
  let settings = { ui: { autopilot: { enabled: false, execute: false, parallel: 3 } } };
  const env = vm.createContext({
    Date, activeChild: null, autopilot: { jobs: [{ id: "real", finished: false }] }, window: null,
    UPDATE_GRACE_MS: 0, updater: { status: () => ({ auto: true }) },
    readSettings: async () => structuredClone(settings), writeSettings: async (next) => { settings = next; },
    settingsDisk: { queue: Promise.resolve() },
    saveResume: async () => {}, setTimeout: (fn) => { fn(); }, send() {},
    assistantAskForWork: () => { asks += 1; },
    stopUpdateWatch() {}, stopEyesWatch() {}, stopMachineWatch() {}, relaunchArgs: () => ["--updated"],
    stopAssistant() { assistantStops += 1; },
    app: { releaseSingleInstanceLock() {}, relaunch() { assert.equal(assistantStops, 1, "save helpers before the next process can start"); }, exit: () => { exits += 1; } },
  });
  vm.runInContext(section("// A pending restart drains", "async function startUpdateWatch(") + section("function updateSettings(", "function send(channel, payload)"), env);
  return { env, exits: () => exits, asks: () => asks, assistantStops: () => assistantStops, settings: () => settings };
}

test("updates drain live workers without forcing a timed restart or changing a saved pause", async () => {
  const host = restartHost();
  for (let pass = 0; pass < 3; pass += 1) {
    const result = await host.env.applyRestart(["main.cjs"]);
    assert.equal(result.deferred, true);
    assert.match(host.env.executorUpdateHold(), /waiting for current builds/);
    assert.equal(host.exits(), 0);
    assert.equal(host.assistantStops(), 0, "a deferred update keeps live helper work running");
  }
  host.env.autopilot.jobs[0].finished = true;
  host.env.autopilot.jobs[0].settlementPending = true;
  assert.equal((await host.env.applyRestart(["main.cjs"])).deferred, true, "an ended process still needs to save its result");
  host.env.autopilot.jobs[0].settlementPending = false;
  assert.equal((await host.env.applyRestart(["main.cjs"])).ok, true);
  assert.equal(host.exits(), 1, "settled entries do not pin a restart");
  assert.equal(host.assistantStops(), 1, "explicit app.exit receives the normal saved-work shutdown");
  assert.deepEqual(host.settings().ui.autopilot, { enabled: false, execute: false, parallel: 3 });
});

test("a missing renderer cannot hang view probes or the updater pause gate", async () => {
  const env = vm.createContext({ setTimeout: (fn) => setTimeout(fn, 5), clearTimeout,
    window: { isDestroyed: () => false, isMinimized: () => false, isVisible: () => true, isFocused: () => true,
      webContents: { executeJavaScript: () => new Promise(() => {}) } },
  });
  vm.runInContext(section("async function rendererValue(", "// The renderer writes"), env);
  vm.runInContext(section("async function saveResume(", "async function applyReload("), env);
  vm.runInContext(section("async function awaitPause(", "// counted: false"), env);
  assert.equal(await env.rendererValue("unreachable", "fallback"), "fallback");
  await env.saveResume();
  await env.awaitPause("restart");
  env.window.webContents.executeJavaScript = async () => { throw new Error("renderer gone"); };
  assert.equal(await env.rendererValue("unreachable", false), false);
});

test("failed, canceled and completed updates release their transient dispatch hold", async () => {
  for (const event of [{ phase: "held", reason: "syntax error" }, { phase: "error" }, { phase: "watching" }, { phase: "pending", reason: "auto-restart is off" }]) {
    const host = restartHost();
    await host.env.applyRestart(["main.cjs"]);
    host.env.handleUpdateEvent({ phase: "pending", reason: "1 build job finishing" });
    assert.ok(host.env.executorUpdateHold());
    host.env.handleUpdateEvent(event);
    assert.equal(host.env.executorUpdateHold(), null);
    assert.equal(host.asks(), 1);
    assert.equal(host.settings().ui.autopilot.execute, false);
  }
});
