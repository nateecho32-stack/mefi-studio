import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// main.cjs's "Multi-PC sync" block in a vm, against a fake scripts/sync.mjs,
// fake dialogs and a hand-turned clock: a look never pulls or pushes and runs
// no check; a sync runs the project's check and may rebase; one sync runs at a
// time and a look shares a same-folder answer; every answer goes out as
// sync:event; the background look starts once and skips a project switch; and
// the question before closing asks only when work is on this PC alone, pushes
// only on request, and never holds a quit it cannot judge in time. Then the
// bridge, the project gate and the three places a quit starts.

const main = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const preload = (await readFile(new URL("../preload.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const from = main.indexOf("// ---- Multi-PC sync: Friends › Your PCs");
const to = main.indexOf("// ---- end of multi-PC sync", from);
assert.ok(from > 0 && to > from, "main.cjs has a Multi-PC sync block");
const block = main.slice(from, to);
const flush = async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); };
const CHECK = () => ({ ok: true });

function host({ fail = null, state = null, risk = [], answers = [], flags = {}, background = false, lookNever = false, moved = false, follow = true, jobs = [] } = {}) {
  const calls = [], sent = [], dialogs = [], timers = [], quits = [], released = [];
  let root = "C:/projects/one";
  const app = { isQuitting: false, quit: () => quits.push(app.isQuitting) };
  const window = { isDestroyed: () => false, isVisible: () => true };
  const context = vm.createContext({
    Promise, Number, Boolean, String, Array, JSON,
    SMOKE: false, CAPTURE: false, CLI_MODE: false, ...flags,
    projectSwitching: false,
    projectRoot: () => root,
    send: (channel, payload) => sent.push([channel, payload]),
    app, window,
    tray: background ? {} : null,
    assistantState: { prefs: { background } },
    // syncFollow: whether GitHub moved, the setting, builders, and claims held for a push.
    readSettings: async () => ({ sync: { follow } }),
    autopilot: { jobs },
    coworkPushed: () => released.push(true),
    setTimeout: (fn, ms) => { const timer = { fn, ms, unref() {} }; timers.push(timer); return timer; },
    setInterval: (fn, ms) => { const timer = { fn, ms, every: true, unref() {} }; timers.push(timer); return timer; },
    clearTimeout: () => {}, clearInterval: () => {},
    dialog: { showMessageBox: async (...args) => { const box = args.at(-1); dialogs.push({ box, parent: args.length > 1 ? args[0] : null }); return { response: answers.shift() ?? box.cancelId }; } },
    loadModule: async (rel) => {
      assert.equal(rel, "scripts/sync.mjs");
      if (fail) throw new Error(fail);
      return {
        projectCheck: async (folder) => (folder ? CHECK : null),
        inspect: (folder) => (lookNever ? new Promise(() => {}) : Promise.resolve(state ?? { repo: true, remote: true, branch: "main", main: "main", ahead: 0, behind: 0, folder })),
        pending: () => risk,
        atRisk: (items) => items,
        remoteMoved: async () => ({ ok: true, moved }),
        sync: (folder, options) => new Promise((resolve) => {
          const call = { folder, options: { ...options }, resolve: (extra = {}) => resolve({ ok: true, headline: `synced ${folder}`, folder, lines: [`synced ${folder}`], actions: [], problems: [], ...extra }) };
          calls.push(call);
        }),
      };
    },
  });
  vm.runInContext(`${block}\nthis.api = { syncProject, syncFollow, startSyncWatch, stopSyncWatch, requestQuit, syncWindowClose, state: () => syncQuit };`, context);
  return { api: context.api, context, app, calls, sent, dialogs, timers, quits, released, setRoot: (value) => { root = value; } };
}

test("a look fetches only and runs no check; Sync this PC runs the project's check and may rebase", async () => {
  const h = host();
  const look = h.api.syncProject(false);
  await flush();
  assert.deepEqual(h.calls[0].options, { pull: false, push: false, rebase: false, check: null });
  h.calls[0].resolve();
  await look;
  const run = h.api.syncProject(true, { rebase: true });
  await flush();
  assert.deepEqual({ ...h.calls[1].options, check: typeof h.calls[1].options.check }, { pull: true, push: true, rebase: true, check: "function" });
  assert.equal(h.calls[1].options.check, CHECK, "the project's own check guards the push");
  h.calls[1].resolve();
  await run;
  const odd = h.api.syncProject(false, { rebase: true });
  await flush();
  assert.equal(h.calls[2].options.rebase, false, "a look never rebases");
  h.calls[2].resolve();
  await odd;
});

test("every answer goes out as sync:event, including one that failed to load", async () => {
  const h = host();
  const look = h.api.syncProject(false);
  await flush();
  h.calls[0].resolve({ risk: 2 });
  const answer = await look;
  assert.deepEqual(h.sent.map(([channel]) => channel), ["sync:event"]);
  assert.equal(h.sent[0][1], answer);
  const broken = host({ fail: "missing module" });
  const result = await broken.api.syncProject(true);
  assert.equal(result.ok, false);
  assert.equal(result.headline, "Sync could not run: missing module");
  assert.equal(result.lines.length, 0);
  assert.equal(broken.sent[0][1], result);
  assert.equal((await broken.api.syncProject(false)).ok, false, "a later call runs again");
});

test("one sync at a time: a same-folder look shares the answer, other calls wait their turn", async () => {
  const h = host();
  const run = h.api.syncProject(true);
  await flush();
  const look = h.api.syncProject(false);
  await flush();
  assert.equal(h.calls.length, 1, "no second git run");
  h.calls[0].resolve({ actions: [{ kind: "pushed", commits: 2 }] });
  const [ran, looked] = await Promise.all([run, look]);
  assert.equal(looked, ran);
  const first = h.api.syncProject(false);
  await flush();
  const second = h.api.syncProject(true);
  await flush();
  assert.equal(h.calls.length, 2, "the run waits for the look");
  h.calls[1].resolve();
  await first;
  await flush();
  assert.equal(h.calls.length, 3);
  h.setRoot("C:/projects/two");
  const other = h.api.syncProject(false);
  await flush();
  h.calls[2].resolve();
  await second;
  await flush();
  assert.equal(h.calls[3].folder, "C:/projects/two", "another folder never shares an answer");
  h.calls[3].resolve();
  assert.equal((await other).folder, "C:/projects/two");
});

test("the background look starts once, looks without pushing, and skips a project switch", async () => {
  const quiet = host({ flags: { SMOKE: true } });
  quiet.api.startSyncWatch();
  assert.equal(quiet.timers.length, 0, "smoke, capture and CLI runs never watch");
  const h = host();
  h.api.startSyncWatch();
  h.api.startSyncWatch();
  assert.deepEqual(h.timers.map((timer) => [timer.ms, Boolean(timer.every)]), [[45000, false], [900000, true], [60000, true]], "a look, the 15-minute look and the one-minute follow");
  h.timers[0].fn();
  await flush();
  assert.deepEqual(h.calls[0].options, { pull: false, push: false, rebase: false, check: null });
  h.calls[0].resolve();
  await flush();
  h.context.projectSwitching = true;
  h.timers[1].fn();
  await flush();
  assert.equal(h.calls.length, 1, "no look lands in the middle of a switch");
});

const unpushed = { repo: true, remote: true, branch: "main", main: "main", ahead: 2, behind: 0 };
const RISK = [{ kind: "unpushed", text: "2 commits on main not pushed yet." }, { kind: "uncommitted", text: "3 uncommitted files in this checkout." }];

test("nothing only on this PC: Studio closes at once without asking", async () => {
  const h = host();
  h.api.requestQuit();
  await flush();
  assert.equal(h.dialogs.length, 0);
  assert.deepEqual(h.quits, [true]);
});

test("Keep Studio open cancels the quit; Close anyway quits; the question lists the work", async () => {
  const kept = host({ state: unpushed, risk: RISK, answers: [2] });
  kept.api.requestQuit();
  await flush();
  assert.equal(kept.dialogs.length, 1);
  const box = kept.dialogs[0].box;
  assert.equal(box.message, "Some work in this project is only on this PC.");
  assert.deepEqual([...box.buttons], ["Push and close", "Close anyway", "Keep Studio open"]);
  assert.match(box.detail, /• 2 commits on main not pushed yet\.\n• 3 uncommitted files/);
  assert.equal(box.cancelId, 2, "Escape keeps Studio open");
  assert.ok(kept.dialogs[0].parent, "asked over the visible window");
  assert.deepEqual(kept.quits, []);
  assert.equal(kept.api.state(), "idle", "a later quit asks again");
  assert.equal(kept.app.isQuitting, false);
  const closed = host({ state: unpushed, risk: RISK, answers: [1] });
  closed.api.requestQuit();
  await flush();
  assert.deepEqual(closed.quits, [true]);
  closed.api.requestQuit();
  await flush();
  assert.equal(closed.dialogs.length, 1, "a decided quit is never asked twice");
});

test("Push and close runs the checked sync, and a push that fails asks again", async () => {
  const h = host({ state: unpushed, risk: RISK, answers: [0] });
  h.api.requestQuit();
  await flush();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].options.push, true);
  assert.equal(h.calls[0].options.check, CHECK);
  h.calls[0].resolve({ actions: [{ kind: "pushed", commits: 2 }] });
  await flush();
  assert.deepEqual(h.quits, [true]);
  const refused = host({ state: unpushed, risk: RISK, answers: [0, 1] });
  refused.api.requestQuit();
  await flush();
  refused.calls[0].resolve({ ok: false, headline: "The project's check failed, so nothing was pushed. Fix it, then sync again.", lines: ["x", "npm run check: 2 tests failed"], problems: [{ kind: "check-failed" }] });
  await flush();
  assert.equal(refused.dialogs.length, 2);
  assert.equal(refused.dialogs[1].box.message, "The push did not go through.");
  assert.match(refused.dialogs[1].box.detail, /check failed[\s\S]*2 tests failed/);
  assert.deepEqual([...refused.dialogs[1].box.buttons], ["Close anyway", "Keep Studio open"]);
  assert.deepEqual(refused.quits, [], "Keep Studio open after a failed push");
});

test("uncommitted work alone offers no push, and a look that runs late never holds the quit", async () => {
  const dirty = host({ state: { ...unpushed, ahead: 0 }, risk: [RISK[1]], answers: [0] });
  dirty.api.requestQuit();
  await flush();
  assert.deepEqual([...dirty.dialogs[0].box.buttons], ["Close anyway", "Keep Studio open"]);
  assert.match(dirty.dialogs[0].box.detail, /Commit it and sync from Friends › Your PCs/);
  assert.deepEqual(dirty.quits, [true]);
  const slow = host({ state: unpushed, risk: RISK, lookNever: true });
  slow.api.requestQuit();
  await flush();
  const limit = slow.timers.find((timer) => timer.ms === 3000);
  assert.ok(limit, "the look has a 3 s limit");
  limit.fn();
  await flush();
  assert.equal(slow.dialogs.length, 0);
  assert.deepEqual(slow.quits, [true]);
});

test("closing the window is a quit unless Studio lives in the tray, and a quit already under way passes", async () => {
  let prevented = 0;
  const event = { preventDefault: () => { prevented += 1; } };
  const tray = host({ background: true, state: unpushed, risk: RISK });
  tray.api.syncWindowClose(event);
  assert.equal(prevented, 0, "parking in the tray is not a quit");
  const quitting = host({ state: unpushed, risk: RISK });
  quitting.app.isQuitting = true;
  quitting.api.syncWindowClose(event);
  assert.equal(prevented, 0, "File › Quit and the tray already asked");
  const h = host({ state: unpushed, risk: RISK, answers: [2] });
  h.api.syncWindowClose(event);
  await flush();
  assert.equal(prevented, 1);
  assert.equal(h.dialogs.length, 1);
  assert.deepEqual(h.quits, []);
});

test("the bridge, the project gate and the three places a quit starts", async () => {
  const invoked = [], listened = [];
  const page = {
    require: () => ({
      contextBridge: { executeInMainWorld: ({ func, args }) => func(...args) },
      ipcRenderer: { invoke: async (channel, ...args) => { invoked.push([channel, args]); return { ok: true }; }, on: (channel) => listened.push(channel) },
    }),
  };
  vm.runInNewContext(preload, page);
  await page.mefiStudio.syncStatus({ root: "C:/elsewhere" });
  await page.mefiStudio.syncRun("C:/elsewhere");
  await page.mefiStudio.syncRun({ rebase: true, root: "C:/elsewhere" });
  page.mefiStudio.onSyncEvent(() => {});
  assert.deepEqual(JSON.parse(JSON.stringify(invoked)), [["sync:status", []], ["sync:run", [{ rebase: false }]], ["sync:run", [{ rebase: true }]]], "the renderer cannot choose the folder");
  assert.ok(listened.includes("sync:event"));
  assert.match(main, /ipcMain\.handle\("sync:status", async \(\) => syncProject\(false\)\);/);
  assert.match(main, /ipcMain\.handle\("sync:run", async \(_event, payload\) => syncProject\(true, \{ rebase: payload\?\.rebase === true \}\)\);/);
  const prefixes = main.match(/const APP_WIDE_PREFIXES = \[([^\]]*)\]/)[1];
  const channels = main.match(/const APP_WIDE_CHANNELS = new Set\(\[([^\]]*)\]\)/)[1];
  assert.doesNotMatch(prefixes, /"sync:"/, "sync:* waits for a project switch");
  assert.doesNotMatch(channels, /"sync:/);
  assert.match(main, /label: "Quit", accelerator: "CmdOrCtrl\+Q", click: \(\) => requestQuit\(\)/, "File › Quit asks first");
  assert.match(main, /label: "Quit",\n\s+click: \(\) => requestQuit\(\),/, "the tray's Quit asks first");
  assert.match(main, /window\.on\("close", \(event\) => syncWindowClose\(event\)\);/, "closing the window asks first");
  assert.match(main, /if \(!SMOKE && !CAPTURE && !CLI_MODE\) startSyncWatch\(\);/);
  assert.equal((main.match(/app\.isQuitting = true;\s*app\.quit\(\)/g) ?? []).length, 2, "only requestQuit sets up a quit by hand");
});

test("following GitHub: nothing moved, nothing runs; moved, it looks; and it pulls only when nothing here is in the way", async () => {
  const still = host({ moved: false });
  await still.api.syncFollow();
  assert.equal(still.calls.length, 0, "one ls-remote and nothing else");
  const clean = host({ moved: true });
  const follow = clean.api.syncFollow();
  await flush();
  assert.deepEqual(clean.calls[0].options, { pull: false, push: false, rebase: false, check: null }, "a look first");
  clean.calls[0].resolve({ state: { behind: 2 }, risk: 0 });
  await flush();
  assert.deepEqual(clean.calls[1].options, { pull: true, push: false, rebase: false, check: null }, "then a fast-forward, never a push");
  clean.calls[1].resolve();
  await follow;
  for (const [why, options, answer] of [
    ["work only this PC holds", { moved: true }, { state: { behind: 2 }, risk: 1 }],
    ["a builder running", { moved: true, jobs: [{ finished: false }] }, { state: { behind: 2 }, risk: 0 }],
    ["the switch turned off", { moved: true, follow: false }, { state: { behind: 2 }, risk: 0 }],
    ["nothing to bring in", { moved: true }, { state: { behind: 0 }, risk: 0 }],
  ]) {
    const h = host(options);
    const run = h.api.syncFollow();
    await flush();
    h.calls[0].resolve(answer);
    await run;
    assert.equal(h.calls.length, 1, `no pull with ${why}`);
  }
});

test("a push that reached GitHub lets go of the file claims held for it", async () => {
  const h = host();
  const look = h.api.syncProject(false);
  await flush();
  h.calls[0].resolve();
  await look;
  assert.equal(h.released.length, 0, "a look releases nothing");
  const run = h.api.syncProject(true);
  await flush();
  h.calls[1].resolve();
  await run;
  assert.equal(h.released.length, 1);
  const failed = h.api.syncProject(true);
  await flush();
  h.calls[2].resolve({ ok: false });
  await failed;
  assert.equal(h.released.length, 1, "a push that did not go through keeps them");
});
