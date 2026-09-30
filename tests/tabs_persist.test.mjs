// What the strip keeps and how it comes back (renderer/tabs.js): per project (mefiStudio.tabs.v1.<projectId>), global pins
// (mefiStudio.tabs.global.v1), the switches (mefiStudio.tabs.prefs.v1); restored on launch and on a change of project, written
// a moment after the last change and at once before a reload, and robust against whatever is in the store: a record nobody
// wrote, a page that no longer exists, a store that throws. The stub nav and shell are tests/fixtures/tabs-env.mjs'.
import test from "node:test";
import assert from "node:assert/strict";
import { tabsEnv, task } from "./fixtures/tabs-env.mjs";

const plain = (value) => JSON.parse(JSON.stringify(value));
const PROJECT = (id) => `mefiStudio.tabs.v1.${id}`;
const GLOBAL = "mefiStudio.tabs.global.v1";
const openSession = (t, id) => t.tabs.open("workspace", { view: "task", taskId: id, projectId: "p1" }, { preview: false });

test("the records and keys, exactly: one set per project, one for the pins that follow you, and the counters", async () => {
  const t = await tabsEnv({ tasks: [task("a", { title: "Add dark mode" })] });
  const at = t.clock.t;
  await t.go("fleet");
  t.tabs.open("plans", {}, { preview: false });
  openSession(t, "a");
  t.tabs.pin(t.tabs.list().find((tab) => tab.route.id === "fleet").id, true);
  await t.settle(); t.tabs.flush();
  // every arrival makes the record (one tick of the use clock) and then enters it (another): Fleet 1-2, Plans 3-4, the session 5-6
  assert.deepEqual(t.stored(PROJECT("p1")), {
    v: 1, clock: 6, active: "t3",
    tabs: [
      { id: "t2", route: { id: "plans", params: {} }, title: "Plans", pin: false, prev: false, used: 4, at },
      { id: "t3", route: { id: "workspace", params: { view: "task", taskId: "a", projectId: "p1" } }, title: "Add dark mode", pin: false, prev: false, used: 6, at },
    ],
    closed: [],
  }, "the project's own tabs, in order, with the tab that was showing");
  assert.deepEqual(t.stored(GLOBAL), {
    v: 1, seq: 3,
    pins: [{ id: "t1", route: { id: "fleet", params: {} }, title: "Fleet", pin: true, prev: false, used: 2, at }],
    visits: { fleet: 1, plans: 1 },
    offered: {},
  }, "the pins, the id counter and what the suggestion counted (a session is not counted: it is not a page)");
  assert.equal(t.storage.has("mefiStudio.tabs.prefs.v1"), false, "the switches are written only when someone changes one");
  assert.equal([...t.storage.keys()].some((key) => key.includes(".none")), false, "nothing is ever stored for 'no project yet'");
});

test("a relaunch brings back the tabs, their order, the pins, the preview and Recently closed", async () => {
  const storage = new Map();
  const first = await tabsEnv({ storage, tasks: [task("a", { title: "Add dark mode" })] });
  await first.go("fleet"); first.tabs.keep();
  openSession(first, "a");
  first.tabs.open("plans", {}, { preview: false });
  await first.go("worktrees");
  first.tabs.pin(first.tabs.list().find((tab) => tab.route.id === "fleet").id, true);
  first.tabs.close(first.tabs.list().find((tab) => tab.route.id === "plans").id);
  await first.settle(); first.tabs.flush();
  const second = await tabsEnv({ storage, tasks: [task("a", { title: "Add dark mode" })] });
  assert.deepEqual(second.titles(), ["Home", "Fleet", "Add dark mode", "Worktrees"], "pins, then the rest in order");
  assert.equal(second.itemOf("Worktrees").dataset.preview, "true", "the preview tab is still the preview tab");
  assert.equal(second.itemOf("Fleet").dataset.pinned, "true");
  assert.deepEqual(plain(second.tabs.recentlyClosed()).map((c) => c.title), ["Plans"], "and what you had closed");
  second.tabs.restore(); await second.settle();
  assert.equal(second.active(), "Plans");
});

test("the launch page decides which tab you are on, not the tab you were on when you quit", async () => {
  const storage = new Map();
  const first = await tabsEnv({ storage });
  await first.go("fleet"); first.tabs.keep(); await first.go("plans"); first.tabs.keep(); await first.settle(); first.tabs.flush();
  assert.equal(first.active(), "Plans");
  const second = await tabsEnv({ storage });
  assert.equal(second.active(), "Home", "the app starts on Home");
  const onFleet = await tabsEnv({ storage, autoStart: false });
  onFleet.nav.quietly("fleet");
  await onFleet.settle(); onFleet.mutate(); await onFleet.settle();
  assert.equal(onFleet.active(), "Fleet", "a launch that opens on Fleet shows its tab");
});

test("another project has its own tabs, and what you changed is written before it is swapped out", async () => {
  const t = await tabsEnv({ tasks: [task("a", { title: "Mine" })] });
  await t.go("fleet"); t.tabs.keep(); openSession(t, "a"); await t.settle();
  t.board.projectId = "p2"; t.board.tasks = [task("b", { title: "Theirs" })];
  t.window.dispatchEvent({ type: "mefi:project-changed", detail: { projectId: "p2" } });
  await t.settle();
  assert.deepEqual(t.titles(), ["Home"], "a project you have not used has Home");
  assert.deepEqual(plain(t.stored(PROJECT("p1")).tabs.map((tab) => tab.route.id)), ["fleet", "workspace"], "p1's tabs were written at the swap, not a moment later");
  await t.go("plans"); t.tabs.keep(); t.tabs.open("workspace", { view: "task", taskId: "b", projectId: "p2" }, { preview: false }); await t.settle();
  t.board.projectId = "p1"; t.board.tasks = [task("a", { title: "Mine" })];
  t.window.dispatchEvent({ type: "mefi:project-changed", detail: { projectId: "p1" } });
  await t.settle();
  assert.deepEqual(t.titles(), ["Home", "Fleet", "Mine"], "back in p1, its tabs are as they were");
  assert.deepEqual(plain(t.stored(PROJECT("p2")).tabs.map((tab) => tab.route.id)), ["plans", "workspace"]);
  assert.equal(t.active(), "Home", "the app is on Home in the new project");
});

test("Recently closed and the preview belong to the project: another project does not reopen this one's tabs", async () => {
  const t = await tabsEnv({ tasks: [task("a", { title: "Mine" })] });
  openSession(t, "a"); await t.settle();
  t.tabs.close(t.tabs.list().find((tab) => tab.route.params.taskId === "a").id);
  assert.equal(t.tabs.recentlyClosed().length, 1);
  t.board.projectId = "p2"; t.board.tasks = [];
  t.window.dispatchEvent({ type: "mefi:project-changed", detail: { projectId: "p2" } });
  await t.settle();
  assert.equal(t.tabs.recentlyClosed().length, 0);
  assert.equal(t.tabs.restore(), null);
});

test("Undo after a change of project does nothing to the project you are in now", async () => {
  const tasks = Array.from({ length: 4 }, (_, i) => task(`u${i}`, { title: `U${i}` }));
  const t = await tabsEnv({ tasks });
  t.tabs.setPrefs({ cap: 3 });
  for (let i = 0; i < 4; i += 1) openSession(t, `u${i}`);
  await t.settle();
  const toast = t.toasts.at(-1);
  assert.match(toast.message, /Closed “U0”/);
  t.board.projectId = "p2"; t.board.tasks = [];
  t.window.dispatchEvent({ type: "mefi:project-changed", detail: { projectId: "p2" } });
  await t.settle();
  toast.options.action.run(); await t.settle();
  assert.deepEqual(t.titles(), ["Home"], "p2 is untouched");
  t.board.projectId = "p1"; t.board.tasks = tasks;
  t.window.dispatchEvent({ type: "mefi:project-changed", detail: { projectId: "p1" } });
  await t.settle();
  assert.equal(t.titles().includes("U0"), false, "and p1 did not get it back from a stale Undo");
});

test("tabs made before the project was known are carried into it when it has none yet, and never when it has its own", async () => {
  const fresh = await tabsEnv({ project: null });
  await fresh.go("fleet"); fresh.tabs.keep(); await fresh.settle();
  assert.equal([...fresh.storage.keys()].some((key) => key.startsWith("mefiStudio.tabs.v1.")), false, "nothing is stored under a project that is not known");
  fresh.board.projectId = "p1";
  fresh.window.dispatchEvent({ type: "mefi:project-changed", detail: { projectId: "p1" } });
  await fresh.settle();
  assert.deepEqual(fresh.titles(), ["Home", "Fleet"], "the launch's tabs are the project's first set");
  fresh.tabs.flush();
  assert.ok(fresh.stored(PROJECT("p1")), "and now they are stored");
  const storage = new Map([[PROJECT("p1"), JSON.stringify({ v: 1, clock: 1, active: "home", tabs: [{ id: "t9", route: { id: "plans", params: {} }, title: "Plans", pin: false, prev: false, used: 1, at: 1 }], closed: [] })]]);
  const own = await tabsEnv({ project: null, storage });
  await own.go("fleet"); own.tabs.keep(); await own.settle();
  own.board.projectId = "p1";
  own.window.dispatchEvent({ type: "mefi:project-changed", detail: { projectId: "p1" } });
  await own.settle();
  assert.deepEqual(own.titles(), ["Home", "Plans", "Fleet"], "its own set wins: Plans was its, and Fleet is only what is showing");
  assert.equal(own.itemOf("Fleet").dataset.preview, "true", "and that one is a preview, not the launch's kept tab carried over");
});

test("the id counter keeps going across launches, and across a store that lost it", async () => {
  const storage = new Map();
  const first = await tabsEnv({ storage });
  first.tabs.open("fleet", {}, { preview: false }); first.tabs.open("plans", {}, { preview: false }); await first.settle(); first.tabs.flush();
  const second = await tabsEnv({ storage });
  const made = second.tabs.open("worktrees", {}, { preview: false });
  assert.equal(made.id, "t3", "after t1 and t2");
  second.tabs.flush();
  // the global store is gone, the project's tabs are not: new ids still do not collide with them
  const broken = new Map([...second.storage].filter(([key]) => key !== GLOBAL));
  const third = await tabsEnv({ storage: broken });
  const again = third.tabs.open("explorer", {}, { preview: false });
  assert.equal(again.id, "t4");
  assert.equal(new Set(third.tabs.list().map((tab) => tab.id)).size, third.tabs.list().length, "every id is its own");
});

test("a burst of changes is written once, a moment later; before a reload, when the window hides and on saveState() it is written at once", async () => {
  class Counting extends Map { constructor() { super(); this.writes = 0; } set(key, value) { if (key.startsWith("mefiStudio.tabs.")) this.writes += 1; return super.set(key, value); } }
  const storage = new Counting();
  const t = await tabsEnv({ storage });
  await t.go("fleet"); t.tabs.keep(); t.tabs.open("plans", {}, { preview: false }); t.tabs.open("worktrees", {}, { preview: false }); t.tabs.move(t.tabs.list()[1].id, 2);
  await t.settle();
  assert.equal(storage.writes, 0, "nothing yet: a change is written a moment after the last one");
  await t.advance(250);
  assert.equal(storage.writes, 0);
  await t.advance(100);
  assert.equal(storage.writes, 2, "then the project's set and the global one, once each");
  assert.ok(t.stored(PROJECT("p1")));
  t.tabs.open("explorer", {}, { preview: false });
  const state = t.tabs.saveState();
  assert.equal(storage.writes, 4, "saveState() (what nav.js's saveResume calls) writes what is pending now");
  assert.deepEqual(plain(state), { v: 1, project: "p1", active: state.active, count: 5 });
  assert.equal(JSON.parse(storage.get(PROJECT("p1"))).tabs.length, 4);
  t.tabs.open("agents", {}, { preview: false });
  t.window.dispatchEvent({ type: "pagehide" });
  assert.equal(storage.writes, 6, "as the page goes away");
  t.tabs.open("studio", {}, { preview: false });
  t.document.hidden = true; await t.document.body.trigger("visibilitychange");
  assert.equal(storage.writes, 8, "and when the window is hidden");
  t.tabs.saveState();
  assert.equal(storage.writes, 8, "nothing pending, nothing written");
});

test("stop() writes what is pending", async () => {
  const t = await tabsEnv();
  t.tabs.open("fleet", {}, { preview: false });
  assert.equal(t.storage.has(PROJECT("p1")), false);
  t.tabs.stop();
  assert.equal(JSON.parse(t.storage.get(PROJECT("p1"))).tabs.length, 1);
});

test("a store nobody can read or that has the wrong shape starts empty and never throws", async () => {
  const garbage = [
    ["not json at all {", "broken JSON"],
    [JSON.stringify([1, 2, 3]), "an array"],
    [JSON.stringify("text"), "a string"],
    [JSON.stringify({ v: 2, tabs: [{ id: "t1", route: { id: "fleet", params: {} } }] }), "a version nobody wrote"],
    [JSON.stringify({ v: 1, tabs: "nope", closed: 7, clock: "x", active: 5 }), "fields of the wrong type"],
  ];
  for (const [value, why] of garbage) {
    const storage = new Map([[PROJECT("p1"), value], [GLOBAL, value], ["mefiStudio.tabs.prefs.v1", value]]);
    const t = await tabsEnv({ storage });
    assert.deepEqual(t.titles(), ["Home"], `${why}: Home alone`);
    assert.equal(t.tabs.prefs().cap, 8, `${why}: the switches fall back to their defaults`);
    await t.go("fleet");
    assert.deepEqual(t.titles(), ["Home", "Fleet"], `${why}: and it works`);
  }
});

test("bad records are dropped one by one and the good ones stay", async () => {
  const good = { id: "t1", route: { id: "plans", params: {} }, title: "Plans", pin: false, prev: false, used: 1, at: 5 };
  const records = [
    good,
    { id: "t2", route: { id: "a-page-that-is-gone", params: {} }, title: "Gone", pin: false, prev: false, used: 1, at: 1 },
    { id: "t3", route: { id: "friends", params: {} }, title: "An action", pin: false, prev: false, used: 1, at: 1 },
    { id: "t4", route: { id: "palette", params: {} }, title: "A dialog", pin: false, prev: false, used: 1, at: 1 },
    { id: "t1", route: { id: "fleet", params: {} }, title: "Same id", pin: false, prev: false, used: 1, at: 1 },
    { id: "t5", route: { id: "plans", params: { filter: "x" } }, title: "Same place", pin: false, prev: false, used: 1, at: 1 },
    { id: "", route: { id: "fleet", params: {} } },
    { id: "home", route: { id: "workspace", params: {} } },
    { id: "t6", route: { id: "workspace", params: {} }, title: "Home again" },
    { id: "t7" },
    null, 42, "x",
    { id: "t8", route: { id: "worktrees", params: { taskId: "zz" } }, title: "W".repeat(400), pin: "yes", prev: 1, used: "NaN", at: "soon" },
  ];
  const t = await tabsEnv({ storage: new Map([[PROJECT("p1"), JSON.stringify({ v: 1, clock: 3, active: "t1", tabs: records, closed: [{ route: { id: "fleet", params: {} }, title: "Fleet", at: 1 }, { route: { id: "gone", params: {} } }, "x"] })]]) });
  const list = plain(t.tabs.list());
  assert.deepEqual(list.map((tab) => tab.route.id), ["workspace", "plans", "fleet", "worktrees"].filter((id) => id !== "fleet"), "only usable records survive: the duplicate id, the duplicate place, the gone page, the action, the dialog and the malformed ones went");
  const w = list.find((tab) => tab.route.id === "worktrees");
  assert.ok(w.title.length <= 80, "a title is cut to a sane length");
  assert.equal(w.pin, false, "a flag that is not a boolean is not a pin");
  assert.deepEqual(plain(t.tabs.recentlyClosed()).map((c) => c.route.id), ["fleet"], "closed entries are sanitised the same way");
});

test("a pin that cannot be global (a session), or that duplicates a global pin, is dropped from where it should not be", async () => {
  const storage = new Map([
    [GLOBAL, JSON.stringify({ v: 1, seq: 5, pins: [
      { id: "t1", route: { id: "fleet", params: {} }, title: "Fleet", pin: true, prev: false, used: 1, at: 1 },
      { id: "t2", route: { id: "workspace", params: { view: "task", taskId: "a", projectId: "p1" } }, title: "A session", pin: true, prev: false, used: 1, at: 1 },
      { id: "t3", route: { id: "fleet", params: {} }, title: "Fleet twice", pin: true, prev: false, used: 1, at: 1 },
    ], visits: { fleet: 2, junk: "x", neg: -1 }, offered: { fleet: true, other: 0 } })],
    [PROJECT("p1"), JSON.stringify({ v: 1, clock: 2, active: "home", tabs: [{ id: "t4", route: { id: "fleet", params: {} }, title: "Fleet", pin: false, prev: false, used: 1, at: 1 }, { id: "t1", route: { id: "plans", params: {} }, title: "Clashes with a pin's id", pin: false, prev: false, used: 1, at: 1 }], closed: [] })],
  ]);
  const t = await tabsEnv({ storage });
  assert.deepEqual(plain(t.tabs.list()).map((tab) => [tab.route.id, tab.pin, tab.scope]), [["workspace", true, "global"], ["fleet", true, "global"]], "one Fleet, pinned: the session cannot be a global pin, the project's second Fleet and the id clash went");
  assert.equal(t.storage.get(GLOBAL).includes("junk"), true, "nothing has been written yet, so the store is as it was found");
  t.tabs.open("plans", {}, { preview: false }); t.tabs.flush(); // the first change writes the stores back, cleaned
  const global = t.stored(GLOBAL);
  assert.equal(global.visits.fleet, 2, "a count is kept");
  assert.deepEqual(Object.keys(global.visits).sort(), ["fleet", "plans"], "a count that is not a count (text, negative) is not");
  assert.deepEqual(global.offered, { fleet: 1 }, "and an offer is a yes or nothing");
  assert.deepEqual(global.pins.map((pin) => pin.id), ["t1"], "one pin, once, and never a session");
});

test("a page that has left the registry is skipped without a word, and a session whose task is gone goes once the board is there", async () => {
  const stored = { v: 1, clock: 3, active: "home", closed: [], tabs: [
    { id: "t1", route: { id: "explorer", params: {} }, title: "Sessions", pin: false, prev: false, used: 1, at: 1 },
    { id: "t2", route: { id: "workspace", params: { view: "task", taskId: "dead", projectId: "p1" } }, title: "Deleted work", pin: false, prev: false, used: 1, at: 1 },
    { id: "t3", route: { id: "workspace", params: { view: "task", taskId: "live", projectId: "p1" } }, title: "Live work", pin: false, prev: false, used: 1, at: 1 },
  ] };
  const storage = new Map([[PROJECT("p1"), JSON.stringify(stored)]]);
  const t = await tabsEnv({ storage, tasks: [task("live", { title: "Live work" })] });
  t.window.dispatchEvent({ type: "mefi:workspace-state" }); await t.settle();
  assert.deepEqual(t.titles(), ["Home", "Sessions", "Live work"], "the deleted session's tab is gone");
  assert.equal(t.toasts.length, 0, "without a word");
  const get = t.nav.get;
  const gone = await tabsEnv({ storage: new Map([[PROJECT("p1"), JSON.stringify(stored)]]), tasks: [task("live", { title: "Live work" }), task("dead", { title: "Deleted work" })], extras: {} });
  assert.equal(get("explorer") !== null, true);
  gone.tabs.stop();
  gone.nav.get = (id) => (id === "explorer" ? null : get(id));
  gone.tabs.start(); await gone.settle();
  assert.deepEqual(gone.titles(), ["Home", "Deleted work", "Live work"], "a page that has left the registry is skipped when the tabs are loaded");
  assert.equal(gone.toasts.length, 0);
});

test("the stores of other projects are never read, rewritten or deleted", async () => {
  const other = JSON.stringify({ v: 1, clock: 9, active: "home", tabs: [{ id: "t1", route: { id: "plans", params: {} }, title: "Plans", pin: false, prev: false, used: 1, at: 1 }], closed: [] });
  const storage = new Map([[PROJECT("old-project"), other], [PROJECT("p2"), other]]);
  const t = await tabsEnv({ storage });
  await t.go("fleet"); t.tabs.keep(); await t.settle(); t.tabs.flush();
  assert.equal(storage.get(PROJECT("old-project")), other, "a project that is gone is left exactly as it was");
  assert.equal(storage.get(PROJECT("p2")), other, "and so is one that simply is not open");
});

test("a store that throws on every call: the strip still works, in memory, and nothing throws", async () => {
  const t = await tabsEnv({ throwing: true, tasks: [task("a", { title: "Mine" })] });
  assert.equal(t.tabs.running(), true);
  await t.go("fleet"); t.tabs.keep();
  openSession(t, "a");
  t.tabs.pin(t.tabs.list().find((tab) => tab.route.id === "fleet").id, true);
  t.tabs.setPrefs({ cap: 5, preview: false });
  await t.settle();
  t.tabs.flush();
  assert.deepEqual(t.titles(), ["Home", "Fleet", "Mine"]);
  assert.equal(t.tabs.prefs().cap, 5, "the switches work for this launch");
  assert.doesNotThrow(() => t.tabs.saveState());
  assert.doesNotThrow(() => t.tabs.stop());
});

test("a store that refuses a write loses nothing already on the page, and the next write is tried again", async () => {
  let refuse = true;
  class Flaky extends Map { set(key, value) { if (refuse && key.startsWith("mefiStudio.tabs.")) throw new Error("quota"); return super.set(key, value); } }
  const storage = new Flaky();
  const t = await tabsEnv({ storage });
  await t.go("fleet"); t.tabs.keep(); await t.settle(); t.tabs.flush();
  assert.equal(storage.has(PROJECT("p1")), false);
  assert.deepEqual(t.titles(), ["Home", "Fleet"], "the page has its tabs");
  refuse = false;
  t.tabs.open("plans", {}, { preview: false }); t.tabs.flush();
  assert.deepEqual(JSON.parse(storage.get(PROJECT("p1"))).tabs.map((tab) => tab.route.id), ["fleet", "plans"], "the next change writes everything");
});

test("what is written is what was on the page: no runtime flags, no element, nothing a reader could trip on", async () => {
  const t = await tabsEnv({ tasks: [task("a", { title: "Mine", status: "active" })] });
  t.tabs.open("workspace", { view: "task", taskId: "a", projectId: "p1" }, { preview: false });
  t.board.assistant = { questions: [{ id: "q", status: "open", context: { taskId: "a" } }] };
  t.tabs.activate("home"); t.window.dispatchEvent({ type: "mefi:workspace-state" }); await t.settle(); t.tabs.flush();
  const text = t.storage.get(PROJECT("p1")) + t.storage.get(GLOBAL);
  assert.equal(/badge|fresh|needs|element|dataset/.test(text), false, "a badge is what is true now, not something to keep");
  for (const tab of JSON.parse(t.storage.get(PROJECT("p1"))).tabs) assert.deepEqual(Object.keys(tab).sort(), ["at", "id", "pin", "prev", "route", "title", "used"]);
});
