// The strip's look at where the app is (renderer/tabs.js): it starts only for layout v2 with a MefiShell and does
// nothing at all otherwise, and once it runs it follows the app however a page opened: through MefiNav.go (mefi:nav), through
// a page that shows itself (showTab, Workspace.enter: nothing is announced, the body's class changes), through a sheet that
// opens itself or closes under Escape, through Vibe or Build's own views. The stubs are tests/fixtures/tabs-env.mjs'.
import test from "node:test";
import assert from "node:assert/strict";
import { tabsEnv, task } from "./fixtures/tabs-env.mjs";

const plain = (value) => JSON.parse(JSON.stringify(value));
const WINDOW_EVENTS = ["mefi:nav", "mefi:model-view", "mefi:shell", "mefi:project-changed", "mefi:workspace-state", "mefi:appearance", "mefi:shell-layout", "mefi:layout", "resize", "keydown", "pagehide"];
const bodyListeners = (t) => Object.values(t.document.body.listeners).flat().length;
const storedKeys = (t) => [...t.storage.keys()].filter((key) => key.startsWith("mefiStudio.tabs."));

function assertNothingRan(t, why) {
  assert.equal(t.tabs.running(), false, `${why}: not running`);
  assert.equal(t.strip(), null, `${why}: no strip in the page`);
  assert.deepEqual(plain(t.tabs.list()), [], `${why}: no tabs`);
  for (const type of WINDOW_EVENTS) assert.equal(t.env.listeners(type), 0, `${why}: no ${type} listener`);
  assert.equal(bodyListeners(t), 0, `${why}: no document listener`);
  assert.deepEqual(storedKeys(t), [], `${why}: no stored key`);
  assert.equal(t.timers.size, 0, `${why}: no timer`);
  assert.equal(t.mutationObservers.length + t.resizeObservers.length, 0, `${why}: no observer`);
  assert.deepEqual(plain(t.resizes), [], `${why}: the tab region was not sized`);
  assert.equal(t.mounts.length, 0, `${why}: nothing mounted`);
  assert.deepEqual(plain(t.nav.registered), [], `${why}: nothing registered with the navigation`);
  assert.equal(t.tabs.configCard(), null, `${why}: no settings card`);
  assert.equal(t.tabs.saveState(), null, `${why}: nothing to save`);
  assert.equal(t.key({ key: "t", code: "KeyT", ctrlKey: true }).defaultPrevented, false, `${why}: Ctrl+T is left alone`);
  assert.equal(t.key({ key: "w", code: "KeyW", ctrlKey: true }).defaultPrevented, false, `${why}: Ctrl+W is left alone`);
}

test("layout v1 (the default): the strip does nothing at all, and open() is plain MefiNav.go", async () => {
  const t = await tabsEnv({ layout: null, tasks: [task("a")] });
  assertNothingRan(t, "v1");
  assert.equal(t.tabs.open("fleet", { any: 1 }), null);
  assert.deepEqual(plain(t.nav.calls), [["fleet", { any: 1 }]], "it only navigated");
  assert.equal(t.tabs.start(), false, "asking it to start, by hand, says no: v1 is decided by the page, not by who asks");
  await t.go("plans"); await t.go("workspace");
  assertNothingRan(t, "v1 after navigating");
});

test("layout v2 without a MefiShell, or with one that says layout v2 is not active, does nothing either", async () => {
  assertNothingRan(await tabsEnv({ shell: false }), "v2 without MefiShell");
  const inactive = await tabsEnv({ shellActive: false });
  assertNothingRan(inactive, "v2 with an inactive shell");
  assert.equal(inactive.tabs.start(), false, "and asking it to start says no");
  const active = await tabsEnv();
  assert.equal(active.tabs.running(), true, "control: the same page with an active shell runs");
});

test("when it runs, it listens, observes and stores: the v1 checks above are not vacuous", async () => {
  const t = await tabsEnv();
  assert.equal(t.tabs.running(), true);
  for (const type of WINDOW_EVENTS) assert.ok(t.env.listeners(type) >= 1, `${type}: listening`);
  assert.ok(bodyListeners(t) >= 3, "input, dblclick and visibility on the document");
  assert.equal(t.mutationObservers.length, 1, "the body watcher");
  assert.deepEqual(plain(t.mutationObservers[0].options), { attributes: true, attributeFilter: ["class", "data-sheet"] }, "the class and data-sheet watcher nav.js's rail already uses");
  assert.equal(t.mutationObservers[0].target, t.document.body);
  assert.equal(t.resizeObservers.length, 1);
  assert.ok(t.nav.registered.some((record) => record.id === "tabBehaviour"), "Search can find Tab behaviour");
  await t.go("fleet"); t.tabs.flush();
  assert.ok(storedKeys(t).includes("mefiStudio.tabs.global.v1"));
});

test("the script waits for the page to finish loading, and in v1 leaves nothing behind after that", async () => {
  const v2 = await tabsEnv({ readyState: "loading" });
  assert.equal(v2.tabs.running(), false, "not before DOMContentLoaded");
  assert.equal(Object.keys(v2.document.body.listeners).join(), "DOMContentLoaded", "one bootstrap listener and nothing else");
  await v2.document.body.trigger("DOMContentLoaded");
  await v2.settle();
  assert.equal(v2.tabs.running(), true);
  const v1 = await tabsEnv({ readyState: "loading", layout: null });
  await v1.document.body.trigger("DOMContentLoaded");
  assert.equal(v1.tabs.running(), false);
  assert.equal(bodyListeners(v1), 0, "the bootstrap listener was the only one and it is used up");
  assertNothingRan(v1, "v1 after DOMContentLoaded");
});

test("a MefiShell that has not drawn its tab region yet is given one more look after the page's other starters have run", async () => {
  const t = await tabsEnv({ lateRegion: true });
  assert.equal(t.tabs.running(), false, "no region, no strip yet");
  assert.equal(t.mounts.length, 0);
  t.revealRegion();
  await t.advance(1);
  assert.equal(t.tabs.running(), true, "the region appeared: it started");
  assert.equal(t.regions.tabs.children.length, 1, "and drew itself into it");
  t.tabs.stop();
  assert.equal(t.regions.tabs.children.length, 0, "stopping takes the strip out of a region it was put into directly, with no mount handle to do it");
  const never = await tabsEnv({ lateRegion: true });
  await never.advance(50);
  assert.equal(never.tabs.running(), false, "one look, not a poll");
  assert.equal(never.timers.size, 0);
});

test("stopping removes everything it added, gives the tab region back and keeps the tabs; starting again finds them", async () => {
  const t = await tabsEnv();
  await t.go("fleet"); t.tabs.keep(); await t.settle();
  t.tabs.open("plans", {}, { pin: true }); await t.settle();
  const before = plain(t.tabs.list()).map((tab) => [tab.route.id, tab.pin]);
  assert.equal(t.tabs.stop(), true);
  assert.equal(t.tabs.running(), false);
  assert.equal(t.strip(), null, "the strip left the page");
  assert.equal(t.mounts.at(-1).unmounted, true);
  assert.deepEqual(plain(t.resizes.at(-1)), ["tabs", 0], "the strip's room went back");
  for (const type of WINDOW_EVENTS) assert.equal(t.env.listeners(type), 0, `${type}: no longer listening`);
  assert.equal(bodyListeners(t), 0);
  assert.ok(t.mutationObservers.every((observer) => observer.disconnected) && t.resizeObservers.every((observer) => observer.disconnected));
  assert.equal(t.timers.size, 0, "no timer is left behind");
  assert.equal(t.tabs.stop(), false, "stopping twice is harmless");
  assert.equal(t.tabs.start(), true);
  await t.settle();
  assert.deepEqual(plain(t.tabs.list()).map((tab) => [tab.route.id, tab.pin]), before, "the tabs were kept");
  assert.equal(t.strip() !== null, true);
});

// ---- every way a page can open -------------------------------------------------------------------------------

test("a page that shows itself, with no go() and no mefi:nav (showTab, Workspace.enter), is found by the body watcher", async () => {
  const t = await tabsEnv();
  t.nav.quietly("booklet");
  assert.deepEqual(t.titles(), ["Home"], "nothing has looked yet");
  t.mutate(); await t.settle();
  assert.deepEqual(t.titles(), ["Home", "Catalog"], "the body's class changed and the strip followed");
  assert.equal(t.active(), "Catalog");
  assert.equal(t.itemOf("Catalog").dataset.preview, "true", "a page reached any other way becomes the preview tab");
  t.nav.quietly("graph"); t.mutate(); await t.settle();
  assert.deepEqual(t.titles(), ["Home", "Performance"], "and the next replaces it");
  t.nav.quietly("workspace"); t.mutate(); await t.settle();
  assert.equal(t.active(), "Home", "Workspace.enter: Home");
  assert.deepEqual(t.nav.calls.map((call) => call[0]), [], "and the strip never asked the app to go anywhere");
});

test("a sheet that opens itself, and Escape closing it, are followed through what is showing", async () => {
  const t = await tabsEnv();
  t.tabs.open("plans", {}, { preview: false }); await t.settle();
  t.tabs.activate("home"); await t.settle();
  t.nav.quietly("workspace", "tasks"); t.mutate(); await t.settle();
  assert.equal(t.active(), "Tasks", "the Task board opened itself");
  assert.equal(t.itemOf("Tasks").dataset.preview, "true");
  t.nav.closeSheet(); await t.settle();
  assert.equal(t.active(), "Home", "Escape: what is under the sheet shows again, and its tab is the current one");
  t.nav.quietly("workspace", "plans"); t.mutate(); await t.settle();
  assert.equal(t.active(), "Plans", "a sheet that already has a tab just shows it");
  assert.equal(t.titles().filter((title) => title === "Plans").length, 1);
});

test("mefi:nav for a close with nothing else changed leaves the strip where it is", async () => {
  const t = await tabsEnv();
  await t.go("fleet"); t.tabs.keep(); await t.settle();
  t.window.dispatchEvent({ type: "mefi:nav", detail: { id: "fleet", action: "close", params: {} } });
  await t.settle();
  assert.equal(t.active(), "Fleet", "current() still says Fleet");
  t.window.dispatchEvent({ type: "mefi:nav", detail: undefined });
  t.window.dispatchEvent({ type: "mefi:nav" });
  await t.settle();
  assert.equal(t.active(), "Fleet", "an event with no detail is harmless");
});

test("Build's session views are places: a task opened through Home with a task id is its own tab, and Escape from the Task board comes back to it", async () => {
  const t = await tabsEnv({ tasks: [task("a", { title: "Add dark mode" }), task("b", { title: "Fix the login" })] });
  await t.go("workspace", { view: "task", taskId: "a", projectId: "p1" });
  assert.deepEqual(t.titles(), ["Home", "Add dark mode"]);
  assert.deepEqual(plain(t.tabs.list()[1].route), { id: "workspace", params: { view: "task", taskId: "a", projectId: "p1" } });
  t.tabs.keep(); await t.settle();
  await t.go("workspace", { view: "task", taskId: "b", projectId: "p1" });
  assert.deepEqual(t.titles(), ["Home", "Add dark mode", "Fix the login"], "another task is another tab");
  await t.go("tasks");
  assert.equal(t.active(), "Tasks");
  t.nav.closeSheet(); await t.settle();
  assert.equal(t.active(), "Fix the login", "Escape from the sheet: the session that was under it");
  await t.go("workspace", { view: "chat" });
  assert.equal(t.active(), "Chat", "the chat is a place too");
  await t.go("workspace", { view: "home" });
  assert.equal(t.active(), "Home", "the new-task view is Home");
  await t.go("workspace");
  assert.equal(t.active(), "Home");
  assert.equal(t.titles().filter((title) => title === "Home").length, 1);
});

test("Build's own view of Home is believed when it has one: a view change nobody announced is seen at the next look", async () => {
  const t = await tabsEnv({ tasks: [task("a", { title: "First" }), task("b", { title: "Second" })] });
  const view = { view: "task", taskId: "a" };
  t.window.MefiBuilder = { active: () => true, view: () => ({ ...view }) };
  await t.go("workspace", { view: "task", taskId: "a", projectId: "p1" });
  assert.equal(t.active(), "First");
  Object.assign(view, { taskId: "b" });
  t.mutate(); await t.settle();
  assert.equal(t.active(), "Second", "Build moved to another task and said nothing; the next look saw it");
  Object.assign(view, { view: "home", taskId: null });
  t.mutate(); await t.settle();
  assert.equal(t.active(), "Home", "Escape out of a task in Build's own Home");
});

test("Agents is one sheet with two faces: its overview, and Setup with four panes, each its own tab, named for the pane", async () => {
  const t = await tabsEnv();
  let params = { section: "overview", pane: "team" };
  t.window.MefiAgents = { params: () => ({ ...params }) };
  await t.go("agents", { section: "overview" });
  assert.deepEqual(t.titles(), ["Home", "Agents"]);
  t.tabs.keep(); await t.settle();
  params = { section: "setup", pane: "routing" };
  await t.go("agents", { section: "setup", pane: "routing", target: "some-control" });
  assert.deepEqual(t.titles(), ["Home", "Agents", "Agents · Routing"]);
  assert.deepEqual(plain(t.tabs.list()[2].route), { id: "agents", params: { section: "setup", pane: "routing" } }, "a control to scroll to is not part of the place");
  t.tabs.keep(); await t.settle();
  params = { section: "setup", pane: "team" };
  await t.go("agents", { section: "setup", pane: "team" });
  assert.equal(t.titles().length, 4);
  // going back to a tab asks for exactly its place
  t.tabs.activate(t.tabs.list()[2].id); await t.settle();
  assert.deepEqual(plain(t.nav.calls.at(-1)), ["agents", { section: "setup", pane: "routing" }]);
  // the overview's pane is not part of its identity
  params = { section: "overview", pane: "behavior" };
  await t.go("agents");
  assert.equal(t.active(), "Agents");
});

test("what a page is opened with besides its place (a filter, a task on the Task board, a card to scroll to) is not another tab", async () => {
  const t = await tabsEnv();
  await t.go("tasks", { filter: "all", taskId: "x", readiness: "blocked" });
  await t.go("tasks", { taskId: "y" });
  await t.go("studio", { section: "settings-updates" });
  await t.go("studio", { category: "appearance" });
  assert.deepEqual(t.titles(), ["Home", "Settings"], "Settings is one page; the Task board was replaced by it");
  t.tabs.keep(); await t.settle();
  await t.go("tasks", { taskId: "z" }); await t.go("tasks", { filter: "done" });
  assert.deepEqual(t.titles(), ["Home", "Settings", "Tasks"]);
  assert.deepEqual(plain(t.tabs.list()[2].route), { id: "tasks", params: {} }, "the tab holds the page, not what was selected in it");
});

test("actions and dialogs are not places: Friends, Appearance, Search and Configuration never get a tab, and do not move the strip", async () => {
  const t = await tabsEnv();
  await t.go("fleet"); t.tabs.keep(); await t.settle();
  for (const id of ["friends", "music", "palette", "config", "secret-not-in-registry"]) await t.go(id);
  assert.deepEqual(t.titles(), ["Home", "Fleet"], "nothing was added");
  assert.equal(t.active(), "Fleet");
  t.nav.state.transient = null;
});

test("Vibe is the Home tab, and so is Home: entering either is the same place", async () => {
  const t = await tabsEnv();
  await t.go("fleet"); t.tabs.keep(); await t.settle();
  t.nav.quietly("vibe"); t.mutate(); await t.settle();
  assert.equal(t.active(), "Home");
  assert.deepEqual(t.titles(), ["Home", "Fleet"]);
  t.nav.quietly("workspace"); t.mutate(); await t.settle();
  assert.deepEqual(t.titles(), ["Home", "Fleet"]);
});

test("the launch screen holds the first look back, and the strip looks again when it lets go", async () => {
  let gate = true;
  let release;
  const ready = new Promise((resolve) => { release = resolve; });
  const t = await tabsEnv({ extras: { MefiBoot: { isActive: () => gate, ready: () => ready } } });
  t.nav.quietly("booklet"); t.mutate(); await t.settle();
  assert.deepEqual(t.titles(), ["Home"], "the launch screen is up: nothing is settled");
  gate = false; release();
  await t.settle();
  assert.deepEqual(t.titles(), ["Home", "Catalog"], "it lets go and the strip catches up with where the app is");
});

test("a page that was asked for and has not arrived is not undone by a look in between", async () => {
  const t = await tabsEnv();
  await t.go("fleet"); t.tabs.keep(); await t.settle();
  t.tabs.open("plans", {}, { preview: false }); await t.settle();
  assert.equal(t.active(), "Plans");
  t.nav.deferGo = true;
  t.tabs.activate(t.tabs.list().find((tab) => tab.route.id === "fleet").id); await t.settle();
  assert.equal(t.active(), "Fleet", "the tab you clicked is the current one at once");
  t.mutate(); await t.settle();
  assert.equal(t.active(), "Fleet", "a look while the page is still on its way sees the old page and does not believe it");
  t.arrive(); await t.settle();
  assert.equal(t.active(), "Fleet");
  assert.deepEqual(t.titles(), ["Home", "Fleet", "Plans"], "no extra tab");
});

test("closing the tab you are on does not bring it back as a new preview while the next page is on its way", async () => {
  const t = await tabsEnv();
  await t.go("fleet"); t.tabs.keep(); await t.settle();
  t.tabs.open("plans", {}, { preview: false }); await t.settle();
  t.tabs.activate(t.tabs.list().find((tab) => tab.route.id === "fleet").id); await t.settle();
  t.nav.deferGo = true;
  t.tabs.close(t.tabs.list().find((tab) => tab.route.id === "fleet").id); await t.settle();
  t.mutate(); await t.settle();
  assert.deepEqual(t.titles(), ["Home", "Plans"], "Fleet is not reborn as a preview");
  assert.equal(t.active(), "Plans");
  t.arrive(); await t.settle();
  assert.equal(t.active(), "Plans");
});

test("a page that never arrives is believed after the grace: the strip shows where the app really is", async () => {
  const t = await tabsEnv();
  await t.go("fleet"); t.tabs.keep(); await t.settle();
  t.tabs.open("plans", {}, { preview: false }); await t.settle();
  t.nav.deferGo = true;
  t.tabs.activate(t.tabs.list().find((tab) => tab.route.id === "fleet").id); await t.settle();
  await t.advance(2000);
  t.mutate(); await t.settle();
  assert.equal(t.active(), "Plans", "the app is still on Plans; the tab you clicked did not open a page");
});

test("another page opening while one is awaited wins: the strip follows the newest place", async () => {
  const t = await tabsEnv();
  await t.go("fleet"); t.tabs.keep(); await t.settle();
  t.tabs.open("plans", {}, { preview: false }); await t.settle();
  t.nav.deferGo = true;
  t.tabs.activate(t.tabs.list().find((tab) => tab.route.id === "fleet").id); await t.settle();
  t.nav.deferGo = false;
  await t.go("worktrees");
  assert.equal(t.active(), "Worktrees", "you went somewhere else meanwhile");
});

test("the launch: a first place is found, and the active tab of the last session is not trusted over what is showing", async () => {
  const storage = new Map();
  const first = await tabsEnv({ storage });
  await first.go("fleet"); first.tabs.keep(); first.tabs.open("plans", {}, { preview: false }); await first.settle();
  first.tabs.flush();
  assert.equal(typeof JSON.parse(storage.get("mefiStudio.tabs.v1.p1")).active, "string", "it wrote down which tab it was on");
  const second = await tabsEnv({ storage });
  assert.deepEqual(second.titles(), ["Home", "Fleet", "Plans"], "the tabs came back");
  assert.equal(second.active(), "Home", "and the app is on Home, so that is the tab you are on");
});

test("a place changing under a project switch does not leak the last project's memory of a page", async () => {
  const t = await tabsEnv({ tasks: [task("a", { title: "Mine" })] });
  await t.go("workspace", { view: "task", taskId: "a", projectId: "p1" });
  t.board.projectId = "p2"; t.board.tasks = [];
  t.window.dispatchEvent({ type: "mefi:project-changed", detail: { projectId: "p2" } });
  t.nav.quietly("workspace"); t.mutate(); await t.settle();
  assert.equal(t.active(), "Home", "in the other project, Home is Home: the session of p1 is not remembered");
  assert.deepEqual(t.titles(), ["Home"]);
});
