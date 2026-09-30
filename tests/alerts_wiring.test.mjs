// main.cjs's "Notifications" block, sliced out and run against stubs with the
// real modules (tests/fixtures/alerts-main.mjs): what the three alerts:*
// channels answer, that the stable app id is set only when alerts are not
// killed, that the hooks sit where the story needs them (a question asked or
// answered, the tasks the owner cares about, a project switch, the window's
// focus, the quit), that a click on a notification brings Studio up before it
// says what was clicked, that nothing is sent to a window being looked at, and
// that the taskbar count is drawn at the size the display wants.
//
// Run: node --test tests/alerts_wiring.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { appId, block, fakeWindow, handlers, launch, main, preload } from "./fixtures/alerts-main.mjs";

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("three channels, all app-wide: a card that works with no project open; the bridge names exactly those and the one push", () => {
  const found = [...handlers.matchAll(/ipcMain\.handle\("(alerts:[a-z-]+)"/g)].map((match) => match[1]);
  assert.deepEqual(found, ["alerts:get", "alerts:set", "alerts:test"]);
  assert.match(main.match(/const APP_WIDE_PREFIXES = \[([^\]]*)\]/)[1], /"alerts:"/, "answers through a project switch, and alerts:test may wait a minute");
  for (const channel of found) assert.match(preload, new RegExp(`ipcRenderer\\.invoke\\("${channel}"`), `${channel} has a bridge entry`);
  assert.match(preload, /onAlertsOpen: \(callback\) => ipcRenderer\.on\("alerts:open", \(_event, payload\) => callback\(payload\)\)/);
  assert.match(preload, /alertsSet: \(patch\) => ipcRenderer\.invoke\("alerts:set", patch && typeof patch === "object" && !Array\.isArray\(patch\) \? patch : \{\}\)/, "the bridge never hands the host anything but an object");
  assert.match(block, /send\("alerts:open", payload\)/, "main sends the one push");
  assert.match(main, /const \{ app, BrowserWindow[^}]*\bNotification\b[^}]*\} = electron;/, "Electron's Notification is imported");
});

test("the stable application user model id is set on Windows, and only while alerts are not killed", () => {
  assert.match(appId, /const ALERTS_APP_ID = "MefiStudio\.StudioAIPlus";/);
  const run = (platform, env) => {
    const calls = [];
    const context = vm.createContext({ process: { platform, env }, app: { setAppUserModelId: (id) => calls.push(id) } });
    vm.runInContext(appId, context);
    return calls;
  };
  assert.deepEqual(run("win32", {}), ["MefiStudio.StudioAIPlus"]);
  assert.deepEqual(run("win32", { MEFI_STUDIO_NO_ALERTS: "1" }), [], "the kill switch leaves the id to Electron, as before");
  assert.deepEqual(run("win32", { MEFI_STUDIO_NO_ALERTS: "0" }), ["MefiStudio.StudioAIPlus"]);
  assert.deepEqual(run("win32", { MEFI_STUDIO_KEEP_APP_ID: "1" }), [], "an owner whose pinned taskbar button goes by the old id can keep it, and keep the notifications");
  assert.deepEqual(run("win32", { MEFI_STUDIO_KEEP_APP_ID: "0" }), ["MefiStudio.StudioAIPlus"]);
  assert.deepEqual(run("linux", {}), []);
  assert.deepEqual(run("darwin", {}), []);
  const throws = vm.createContext({ process: { platform: "win32", env: {} }, app: { setAppUserModelId: () => { throw new Error("no"); } } });
  assert.doesNotThrow(() => vm.runInContext(appId, throws), "a refusal is not Studio's failure");
  assert.ok(main.indexOf("const ALERTS_APP_ID") > main.indexOf('app.setName("Mefi\'s Studio AI+")'), "after the name, so the suites that slice up to it are untouched");
});

test("the hooks are where the story needs them: a question, the board, a project switch, the window, the start and the quit", () => {
  assert.match(main, /assistantEmit\(\{ kind: "question", \.\.\.question \}\);\n  \/\/ Windows hears of it only if it is still waiting in twenty seconds \(Notifications\)\.\n  if \(typeof alertsQuestion === "function"\) alertsQuestion\(question\);/, "a new question is queued");
  assert.match(main, /function assistantEmit\(event\) \{\n  \/\/ [^\n]*\n  if \(event\?\.kind === "question" && typeof alertsPoke === "function"\) alertsPoke\(\);/, "a question answered or expired makes the count look again");
  assert.match(main, /events = result\.events;\n    \/\/ [^\n]*\n    if \(typeof alertsTasks === "function"\) alertsTasks\(result\.events, result\.attention, projectId\);/, "the tasks the owner cares about are heard where main already compares the board");
  assert.match(main, /projects\.run\(projects\.active\(\), \(\) => assistantSchedule\(\)\);\n    \/\/ [^\n]*\n    if \(typeof alertsPoke === "function"\) alertsPoke\(\);/, "another project has another queue");
  assert.match(main, /window\.on\("focus", \(\) => \{ if \(typeof alertsFocus === "function"\) alertsFocus\(\); \}\);/, "coming to the front ends the flash");
  assert.match(main, /for \(const name of \["blur", "hide", "minimize"\]\) window\.on\(name, \(\) => \{ if \(typeof alertsAway === "function"\) alertsAway\(\); \}\);/, "looking away lets a waiting test go");
  assert.match(main, /if \(typeof alertsWindow === "function"\) alertsWindow\(\);/, "a new window starts with no count");
  assert.match(main, /registerIpc\(\);\n  bootHealthStart\(\);\n  reportStart\(\);\n  alertsStart\(\);/, "it starts with the app, after the report's marker");
  assert.match(main, /if \(typeof reportEnd === "function"\) reportEnd\("quit"\);\n  if \(typeof alertsStop === "function"\) alertsStop\(\);/, "it stops at a quit; guarded, so suites that run the quit handler on their own do not need it");
  // Every hook is guarded by typeof where a suite may run its function without the block.
  for (const call of ["alertsQuestion(question)", "alertsPoke()", "alertsTasks(result.events"]) {
    for (const match of main.matchAll(new RegExp(`(^.*)${call.replace(/[()]/g, "\\$&")}`, "gm"))) {
      if (!/function alerts|const alerts/.test(match[1])) assert.match(match[1], /typeof alerts\w+ === "function"/, `${call} is guarded`);
    }
  }
});

test("harness windows, the CLI modes and a build without the modules make no host and answer that notifications are unavailable", async () => {
  for (const mode of [{ mode: { smoke: true } }, { mode: { cli: true } }, { missing: true }]) {
    const t = launch(mode);
    t.start();
    assert.equal(t.host(), null, JSON.stringify(mode));
    for (const channel of ["alerts:get", "alerts:set", "alerts:test"]) assert.deepEqual(await t.call(channel, {}), { ok: false, error: "Notifications are not available in this build." }, channel);
    assert.doesNotThrow(() => t.run("alertsQuestion({ id: 'q', status: 'open', title: 'x' }); alertsTasks([], [], 'p'); alertsPoke(); alertsFocus(); alertsAway(); alertsWindow(); alertsStop();"), "and every hook is a no-op");
  }
});

test("alerts:get and alerts:set answer through the real host: defaults, validation, and the quiet hours in the remote's setting", async (t) => {
  const h = launch({ settings: { projects: [], remote: { on: true, quiet: null } } });
  h.start();
  t.after(() => h.host()?.close());
  const first = await h.call("alerts:get");
  assert.deepEqual(first, { ok: true, prefs: { on: true, need: true, fail: true, done: false, flash: true, badge: true, sound: false, titles: "generic" }, quiet: { on: false, from: "22:00", to: "07:00" }, killed: false, supported: true, platform: "win32", waiting: 0, hour: { sent: 0, max: 12 } });
  const set = await h.call("alerts:set", { done: true, sound: true, need: "nope", stray: 1, quiet: { on: true, from: "23:00", to: "06:30" } });
  assert.deepEqual([set.prefs.done, set.prefs.sound, set.prefs.need], [true, true, true]);
  assert.deepEqual(set.quiet, { on: true, from: "23:00", to: "06:30" });
  assert.deepEqual(h.state.settings.remote, { on: true, quiet: { from: "23:00", to: "06:30" } }, "the remote's own setting, and nothing else of it touched");
  assert.equal(h.state.settings.alerts.done, true);
  assert.deepEqual(h.state.settings.projects, [], "the rest of the settings are left alone");
  assert.equal(h.log.pushes, 1, "the Friends card is told");
  assert.deepEqual(await h.call("alerts:set", "x"), (await h.call("alerts:get")), "rubbish changes nothing");
});

test("the kill switch is read from the environment: nothing starts, the card says so and the test does nothing", async (t) => {
  const h = launch({ env: { MEFI_STUDIO_NO_ALERTS: "1" }, digest: { total: 3, items: [] } });
  h.start();
  t.after(() => h.host()?.close());
  assert.equal((await h.call("alerts:get")).killed, true);
  const test = await h.call("alerts:test");
  assert.deepEqual([test.ok, test.killed, test.sent], [false, true, false]);
  await h.host().look();
  assert.deepEqual([h.log.shown, h.log.flashes, h.log.overlays], [[], [], []]);
});

test("a click on a notification brings Studio up first, then says what was clicked", async (t) => {
  const h = launch();
  h.start();
  t.after(() => h.host()?.close());
  const result = await h.call("alerts:test");
  assert.deepEqual(result, { ok: true, sent: true, why: "" });
  assert.equal(h.log.shown.length, 1);
  assert.deepEqual([h.log.shown[0].options.title, h.log.shown[0].options.body], ["Test notification", "Alerts are working. Nothing needs you."]);
  assert.deepEqual(h.log.flashes, [true], "the taskbar flashes");
  h.log.calls.length = 0;
  h.log.shown[0].emit("click");
  assert.deepEqual(h.log.calls, ["showWindow", "send:alerts:open"], "the window first, then the push");
  assert.deepEqual(h.log.sent.at(-1), ["alerts:open", { kind: "test", id: null, taskId: null, projectId: null }]);
  assert.deepEqual(h.log.flashes, [true, false], "and the flash stops");
});

test("a click on a window that is still loading waits for the page, so the push is not lost", async (t) => {
  const h = launch();
  h.start();
  t.after(() => h.host()?.close());
  h.window.loading = true;
  await h.call("alerts:test");
  h.log.shown[0].emit("click");
  assert.deepEqual(h.log.sent, [], "nothing sent to a page that is not there yet");
  assert.equal(h.window.loads.length, 1);
  assert.equal(h.window.loads[0][0], "did-finish-load");
  h.window.loads[0][1]();
  assert.deepEqual(h.log.sent, [], "and not the instant it loads either");
  assert.deepEqual(h.log.timeouts.map((timer) => timer.ms), [1500], "the page gets a moment to hear it");
  h.log.timeouts[0].fn();
  assert.equal(h.log.sent.at(-1)[0], "alerts:open");
});

test("nothing is sent to a window being looked at: the test waits for the owner to look away, and any Studio window in front counts", async (t) => {
  const h = launch();
  h.start();
  t.after(() => h.host()?.close());
  h.window.focused = true;
  const pending = h.call("alerts:test");
  await tick();
  assert.equal(h.log.shown.length, 0, "Studio is in front");
  h.run("alertsAway()");
  assert.equal(h.log.shown.length, 0, "a blur that left it in front is nothing");
  h.window.focused = false;
  h.run("alertsAway()");
  assert.deepEqual(await pending, { ok: true, sent: true, why: "" });
  assert.equal(h.log.shown.length, 1);
  // A second Studio window (the media window, say) in front is Studio being looked at.
  const second = fakeWindow(h.log, { focused: true });
  h.state.windows = [h.window, second];
  const waiting = h.call("alerts:test");
  await tick();
  assert.equal(h.log.shown.length, 1);
  second.focused = false;
  h.run("alertsAway()");
  assert.equal((await waiting).sent, true);
  // Minimized, hidden and destroyed windows are not being looked at.
  h.window.focused = true;
  for (const away of [{ minimized: true }, { visible: false }, { destroyed: true }]) {
    Object.assign(h.window, { focused: true, minimized: false, visible: true, destroyed: false }, away);
    h.state.windows = [h.window];
    const before = h.log.shown.length;
    assert.equal((await h.call("alerts:test")).sent, true, JSON.stringify(away));
    assert.equal(h.log.shown.length, before + 1, JSON.stringify(away));
  }
});

test("a locked screen, or ten minutes without input, is nobody looking, even with Studio in front", async (t) => {
  const h = launch();
  h.start();
  t.after(() => h.host()?.close());
  h.window.focused = true;
  for (const idle of ["locked", "idle"]) {
    h.state.idle = idle;
    const before = h.log.shown.length;
    assert.equal((await h.call("alerts:test")).sent, true, `${idle}: the PC is left working, so the notification goes`);
    assert.equal(h.log.shown.length, before + 1, idle);
  }
  assert.equal(h.state.idleAsked, 600, "ten minutes");
  for (const looking of ["active", "unknown", "throws"]) {
    h.state.idle = looking;
    const before = h.log.shown.length;
    const pending = h.call("alerts:test");
    await tick();
    assert.equal(h.log.shown.length, before, `${looking}: Studio is in front and somebody may be there`);
    h.window.focused = false;
    h.run("alertsAway()");
    assert.equal((await pending).sent, true);
    h.window.focused = true;
  }
  // Not in front at all: the idle state is not even asked.
  h.window.focused = false;
  h.state.idleAsked = null;
  assert.equal((await h.call("alerts:test")).sent, true);
  assert.equal(h.state.idleAsked, null);
});

test("the taskbar count is drawn from the needs-you digest, at the size the display wants, and only when a project is open", async (t) => {
  const h = launch({ digest: { total: 4, items: [] }, scale: 2 });
  h.start();
  t.after(() => h.host()?.close());
  await h.host().look();
  assert.deepEqual(h.log.overlays, [[{ width: 32 }, "4 waiting on you"]], "a 200% display gets the large picture");
  const small = launch({ digest: { total: 11, items: [] }, scale: 1 });
  small.start();
  t.after(() => small.host()?.close());
  await small.host().look();
  assert.deepEqual(small.log.overlays, [[{ width: 16 }, "11 waiting on you"]]);
  const none = launch({ digest: { total: 4, items: [] }, projectOpen: false });
  none.start();
  t.after(() => none.host()?.close());
  await none.host().look();
  assert.deepEqual(none.log.overlays, [], "with no project open there is no queue to count");
  const linux = launch({ digest: { total: 4, items: [] }, platform: "linux" });
  linux.start();
  t.after(() => linux.host()?.close());
  await linux.host().look();
  assert.deepEqual(linux.log.overlays, [], "only Windows has an overlay icon");
});

test("the hooks queue what main knows without throwing or logging a title; a question is still open only while the assistant says so", async (t) => {
  const h = launch({ questions: [{ id: "q1", status: "open" }] });
  h.start();
  t.after(() => h.host()?.close());
  h.run("alertsQuestion({ id: 'q1', status: 'open', kind: 'question', title: 'Keep both?', context: { taskId: 't1', taskTitle: 'Tags' } })");
  h.run("alertsQuestion({ id: 'q2', status: 'open', kind: 'suggestion', title: 'Maybe?' })");
  h.run("alertsQuestion(null); alertsQuestion(5); alertsTasks(null, undefined, null); alertsTasks([{ kind: 'parked', taskId: 't9', title: 'Fix login' }], [], 'project_a')");
  assert.ok(h.log.logs.every((line) => !line.includes("Keep both") && !line.includes("Fix login")), "no title in any log line");
  assert.deepEqual(h.log.shown, [], "nothing yet: a thing waits twenty seconds first");
  // The host asks main whether a question is still open: through the assistant's own list, at the moment it asks.
  const source = block.match(/questionOpen: (\(id\) => [^\n]*),\n/)[1];
  const answer = vm.runInNewContext(`(${source})`, { assistantState: { questions: [{ id: "q1", status: "open" }, { id: "q2", status: "answered" }, null] } });
  assert.deepEqual([answer("q1"), answer("q2"), answer("nope")], [true, false, false]);
  assert.equal(vm.runInNewContext(`(${source})`, { assistantState: null })("q1"), false, "no assistant, no open question");
});

test("a failure to start is logged by code and leaves Studio as it was", async () => {
  const h = launch();
  h.context.alertsHostModule = { createAlertsHost: () => { throw Object.assign(new Error("C:\\Users\\Nate\\broken"), { code: "EPERM" }); } };
  h.start();
  assert.equal(h.host(), null);
  assert.ok(h.log.logs.includes("[alerts] could not start (EPERM)"));
  assert.ok(h.log.logs.every((line) => !line.includes("Nate")));
  assert.deepEqual(await h.call("alerts:get"), { ok: false, error: "Notifications are not available in this build." });
});
