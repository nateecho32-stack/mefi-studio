// The launch hold in main.cjs, run as the real host slices against stubs: an
// interactive start loads state but starts nothing, every dispatch funnel
// (service start, proactive pass, foreman ask, executor fill) reads the one
// flag, and the release paths (startup:begin / Start agents, Resume, the
// tray) start the service exactly once while a saved pause still stands.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
// Host answers are built in the vm realm; compare their plain shape.
const plain = (value) => JSON.parse(JSON.stringify(value));
const section = (start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
};
function host(code, globals = {}) {
  const context = vm.createContext({ console, Date, SMOKE: false, CAPTURE: false, CLI_MODE: false, projectSwitching: false, projects: { active: () => ({ id: "fixture" }), open: () => ({ id: "fixture" }), run: (_project, fn) => fn() }, logLine() {}, logError() {}, ...globals });
  vm.runInContext(code, context, { filename: "main.cjs:startup-hold" });
  return context;
}

function serviceHost({ status = "running" } = {}) {
  const events = [];
  const autopilot = { held: true, execute: false };
  const env = host(section("let startupChosen = false;", "// Quit path:"), {
    autopilot, assistantLoop: false, assistantStopping: false, assistantState: { status },
    bootAutopilot: async () => events.push("boot"), ensureAssistant: async () => events.push("loaded"),
    applyKeepAwake() { events.push("keep-awake"); }, applyTray() { events.push("tray"); },
    assistantResumeWork: async () => events.push("resumed"), assistantLog: (_kind, text) => events.push(`log:${text}`),
    saveAssistant: async () => events.push("saved"), assistantSchedule: (ms) => events.push(`scheduled:${ms}`),
    refreshTray() { events.push("tray-refreshed"); }, emitAutopilot() { events.push("emitted"); },
  });
  return { env, events, autopilot };
}

test("an interactive launch loads the assistant for the tray and panels but starts nothing until released", async () => {
  const { env, events, autopilot } = serviceHost();
  assert.deepEqual(plain(await env.startAssistant()), { ok: true, running: false, held: true });
  assert.deepEqual(events, ["loaded", "tray"], "the boot timer finds a held service: state loaded, no resume, no tick");
  assert.equal(env.assistantLoop, false);
  assert.deepEqual(plain(await env.startAssistant()), { ok: true, running: false, held: true }, "a second timer or control call stays held");
  events.length = 0;
  assert.deepEqual(plain(await env.releaseStartupHold()), { ok: true, released: true, running: true });
  assert.equal(autopilot.held, false);
  assert.equal(env.assistantLoop, true, "the release is the real service start");
  assert.deepEqual(events, ["boot", "loaded", "keep-awake", "tray", "resumed", "log:assistant service started", "scheduled:0", "tray-refreshed", "emitted"]);
  assert.deepEqual(plain(await env.releaseStartupHold()), { ok: true, released: false, running: true }, "releasing twice is a no-op that reports the running service");
  assert.deepEqual(events.length, 9);
});

test("releasing the hold never overrides a pause the operator saved", async () => {
  const { env, events, autopilot } = serviceHost({ status: "paused" });
  assert.deepEqual(plain(await env.releaseStartupHold()), { ok: true, released: true, running: false });
  assert.equal(autopilot.held, false);
  assert.equal(env.assistantLoop, true, "the service is up, waiting on Resume as it always did");
  assert.ok(events.includes("log:assistant service loaded paused · resume from the Explorer or the tray"));
  assert.equal(events.includes("scheduled:0"), false, "no tick runs against a saved pause");
});

test("the proactive pass, the foreman ask and the executor fill all wait on the hold", async () => {
  let passes = 0, asks = 0;
  const autopilot = { enabled: true, held: true, jobs: [] };
  const pass = host(`let autopilotTicks = 0;\n${section("let autopilotPassInFlight = null;", "async function setAutopilot(")}`, {
    autopilot, TASKS_PATH: "tasks", assistantState: null,
    getEyes: async () => ({ readJson: async () => [] }),
    autopilotProactivePass: async () => { passes += 1; return { added: 0 }; },
    autopilotHousekeeping: async () => {}, classifyPendingWork: async () => ({ ok: true }), promoteRequestsToTasks: async () => {}, refreshAutopilotQueue: async () => {},
    pushAutopilotHistory() {}, emitAutopilot() {}, assistantAskForWork() { asks += 1; },
  });
  assert.deepEqual(plain(await pass.autopilotPass()), { ok: true, skipped: "held" });
  assert.equal(passes, 0, "a held launch spends nothing on a proactive pass");
  autopilot.held = false;
  await pass.autopilotPass();
  assert.equal(passes, 1); assert.equal(asks, 1);

  let enqueued = 0;
  const foreman = host(section("function assistantAskForWork(reason)", "// What the assistant is doing about the build queue"), {
    autopilot: { held: true }, assistantState: { status: "running" }, ASSISTANT_PRIORITY: { demand: 5 },
    assistantEnqueueRole() { enqueued += 1; },
  });
  assert.equal(foreman.assistantAskForWork("you added a task"), false, "a task added while held waits for Start agents");
  assert.equal(enqueued, 0);
  assert.equal(foreman.autopilot.lastAsk, undefined, "a refused ask leaves no dispatch reason behind");
  foreman.autopilot.held = false;
  assert.equal(foreman.assistantAskForWork("you added a task"), true);
  assert.equal(enqueued, 1);

  let holdChecks = 0; const waits = [];
  const fill = host(section("let executorFillInFlight = null;", "// Work the assistant does on its own plumbing"), {
    autopilot: { held: true, execute: true, jobs: [] }, assistantState: { status: "running" },
    executorUpdateHold() { holdChecks += 1; return "an update is being applied"; }, setAutopilotWaiting: (reason) => waits.push(reason),
  });
  assert.equal(await fill.executeNextRequest(), undefined);
  assert.equal(holdChecks, 0, "the launch hold sits ahead of every other executor gate");
  fill.autopilot.held = false;
  await fill.executeNextRequest();
  assert.ok(holdChecks > 0, "released, the fill reaches its update gate"); // the host reads the hold twice (condition and argument)
  assert.deepEqual(waits, ["an update is being applied"], "released, the fill runs its usual gates");
});

test("Resume while held releases the service first, then resumes as before", async () => {
  let released = 0, pumps = 0; const scheduled = [];
  const autopilot = { held: true };
  const env = host(section("async function assistantResume()", "// ---- 24/7:"), {
    autopilot, assistantState: { status: "paused" }, assistantLoop: true,
    releaseStartupHold: async () => { released += 1; autopilot.held = false; },
    applyKeepAwake() {}, assistantLog() {}, assistantPump() { pumps += 1; }, saveAssistant: async () => {}, assistantSchedule: (ms) => scheduled.push(ms),
  });
  await env.assistantResume();
  assert.equal(released, 1);
  assert.equal(env.assistantState.status, "running");
  assert.equal(pumps, 1); assert.deepEqual(scheduled, [0]);
  await env.assistantResume();
  assert.equal(released, 1, "an ordinary resume never touches the hold again");
});

test("the tray offers Start agents while held and rebuilds its menu only when that entry changes", async () => {
  let builds = 0, released = 0, pauses = 0, resumes = 0;
  const tray = { tooltip: null, menu: null, setToolTip(text) { this.tooltip = text; }, setContextMenu(menu) { this.menu = menu; builds += 1; } };
  const autopilot = { held: true };
  const env = host(section("function refreshTray()", "// ---- the thread"), {
    tray, autopilot, assistantState: { status: "running" }, assistantModule: null, trayPaused: null,
    Menu: { buildFromTemplate: (items) => items }, showWindow() {},
    releaseStartupHold: async () => { released += 1; }, assistantResume: async () => { resumes += 1; }, assistantPause: async () => { pauses += 1; },
  });
  env.refreshTray();
  assert.match(tray.tooltip, /agents waiting for you/);
  assert.equal(tray.menu[1].label, "Start agents");
  await tray.menu[1].click();
  assert.equal(released, 1);
  env.refreshTray();
  assert.equal(builds, 1, "an unchanged state does not rebuild the menu");
  autopilot.held = false;
  env.refreshTray();
  assert.equal(builds, 2);
  assert.equal(tray.menu[1].label, "Pause assistant");
  assert.match(tray.tooltip, /assistant running/);
  await tray.menu[1].click();
  assert.equal(pauses, 1);
  env.assistantState.status = "paused";
  env.refreshTray();
  assert.equal(tray.menu[1].label, "Resume assistant");
  await tray.menu[1].click();
  assert.equal(resumes, 1);
  assert.equal(released, 1, "once released the tray never calls the launch release again");
});
