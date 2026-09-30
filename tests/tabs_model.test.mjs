// The tab set of layout v2 (renderer/tabs.js): what a click does (the italic preview tab), what pinning, closing and
// moving do, what Studio closes on its own (the cap, finished work) and puts back (Recently closed, Undo), what an
// agent that needs you does, the pin suggestion and the switches that turn all of it off. The strip runs in the shared
// fake DOM against a stub MefiNav and a stub MefiShell (tests/fixtures/tabs-env.mjs); every behaviour here has a test that
// goes red when it is taken out. The strip's own DOM is tests/tabs_strip.test.mjs, where the app really is tests/tabs_render.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { tabsEnv, task } from "./fixtures/tabs-env.mjs";

const MIN = 60_000;
const openSession = (t, id, options = { preview: false }) => t.tabs.open("workspace", { view: "task", taskId: id, projectId: "p1" }, options);
// What the strip says lives in the page's realm; a JSON round trip makes it plain data the assertions can compare by value.
const plain = (value) => JSON.parse(JSON.stringify(value));
const routes = (t) => plain(t.tabs.list()).map((tab) => (tab.route.params.taskId ? `s:${tab.route.params.taskId}` : tab.route.id));
const closedTitles = (t) => plain(t.tabs.recentlyClosed()).map((entry) => entry.title);
const closedRoutes = (t) => plain(t.tabs.recentlyClosed()).map((entry) => entry.route.id);
const textBox = (t, type = "text") => { const box = t.env.node("input", { parent: t.document.body }); box.type = type; return box; };
const typeInto = async (t, box) => { await t.document.body.trigger("input", { target: box }); await t.settle(); };

test("the first click on a page opens it in one italic preview tab, and the next click replaces it where it stands", async () => {
  const t = await tabsEnv();
  assert.deepEqual(t.titles(), ["Home"], "Home is the one tab to begin with");
  await t.go("fleet");
  assert.deepEqual(t.titles(), ["Home", "Fleet"]);
  assert.equal(t.itemOf("Fleet").dataset.preview, "true", "it is the preview tab");
  t.tabs.open("plans", {}, { preview: false });
  await t.settle();
  assert.deepEqual(t.titles(), ["Home", "Fleet", "Plans"], "a tab opened on purpose stays, beside the one you were on");
  await t.go("worktrees");
  assert.deepEqual(t.titles(), ["Home", "Worktrees", "Plans"], "the preview tab was reused in its own place, not a new tab added");
  assert.equal(t.itemOf("Worktrees").dataset.preview, "true");
  assert.equal(t.itemOf("Plans").dataset.preview, undefined, "a tab you opened is not a preview");
});

test("typing, a double-click or pinning keeps the preview tab, and then the next click opens a tab of its own", async () => {
  const t = await tabsEnv();
  // typing in a text box on the page
  await t.go("fleet");
  await typeInto(t, textBox(t));
  assert.equal(t.itemOf("Fleet").dataset.preview, undefined, "typing kept it");
  await t.go("plans");
  assert.deepEqual(t.titles(), ["Home", "Fleet", "Plans"]);
  // a double-click on the tab
  await t.itemOf("Plans").querySelector(".ts-tab").trigger("dblclick", { target: t.tabOf("Plans") });
  await t.settle();
  assert.equal(t.itemOf("Plans").dataset.preview, undefined, "a double-click kept it");
  await t.go("worktrees");
  t.tabs.pin(t.tabs.list().find((tab) => tab.route.id === "worktrees").id, true);
  await t.settle();
  assert.equal(t.tabs.list().find((tab) => tab.route.id === "worktrees").prev, false, "pinning kept it");
  await t.go("explorer");
  assert.deepEqual(t.titles(), ["Home", "Worktrees", "Fleet", "Plans", "Sessions"], "each kept one stayed; the new page is the new preview");
});

test("typing in Search, Configuration or a switch does not count as typing on the page", async () => {
  const t = await tabsEnv();
  await t.go("fleet");
  const overlay = t.env.node("div", { id: "palette-overlay", parent: t.document.body });
  const search = t.env.node("input", { parent: overlay }); search.type = "text";
  await typeInto(t, search);
  await typeInto(t, textBox(t, "range"));
  await typeInto(t, textBox(t, "checkbox"));
  assert.equal(t.itemOf("Fleet").dataset.preview, "true", "still a preview tab");
  const box = t.env.node("textarea", { parent: t.document.body });
  await typeInto(t, box);
  assert.equal(t.itemOf("Fleet").dataset.preview, undefined, "a text area on the page does");
});

test("a place that already has a tab just shows it: nothing is added, and Home stays the one Home", async () => {
  const t = await tabsEnv();
  await t.go("fleet"); t.tabs.keep(); await t.settle();
  await t.go("plans");
  await t.go("fleet");
  await t.go("workspace");
  assert.deepEqual(t.titles(), ["Home", "Fleet", "Plans"]);
  assert.equal(t.active(), "Home");
  await t.go("fleet");
  assert.equal(t.active(), "Fleet");
  assert.equal(t.titles().length, 3);
});

test("the preview tab is a setting, and turning it off keeps the tabs that were previews", async () => {
  const t = await tabsEnv();
  await t.go("fleet");
  assert.equal(t.itemOf("Fleet").dataset.preview, "true");
  t.tabs.setPrefs({ preview: false });
  await t.settle();
  assert.equal(t.itemOf("Fleet").dataset.preview, undefined, "switching it off makes every preview a tab of its own");
  await t.go("plans");
  assert.deepEqual(t.titles(), ["Home", "Fleet", "Plans"], "and every page is a new tab now");
  assert.equal(t.itemOf("Plans").dataset.preview, undefined);
  t.tabs.setPrefs({ preview: true });
  await t.go("worktrees"); await t.go("explorer");
  assert.deepEqual(t.titles(), ["Home", "Fleet", "Plans", "Sessions"], "switched on again, the last page replaced the one before it");
  assert.equal(t.tabs.list().filter((tab) => tab.prev).length, 1, "one preview tab, never two");
});

test("pinning a page moves it into the pins that follow you to every project; pinning a session keeps it with its project", async () => {
  const t = await tabsEnv({ tasks: [task("a", { title: "Add dark mode" })] });
  await t.go("fleet");
  const fleet = t.tabs.list().find((tab) => tab.route.id === "fleet");
  assert.equal(fleet.scope, "global", "a page belongs to no project");
  t.tabs.pin(fleet.id, true);
  openSession(t, "a");
  const a = t.tabs.list().find((tab) => tab.route.params.taskId === "a");
  assert.equal(a.scope, "project");
  t.tabs.pin(a.id, true);
  await t.settle(); t.tabs.flush();
  assert.deepEqual(t.titles(), ["Home", "Fleet", "Add dark…"], "pins sit at the left, after Home, and a pinned tab shows a short name");
  assert.equal(t.tabOf("Add dark…").title.startsWith("Add dark mode, pinned"), true, "with the whole name on hover");
  const global = t.stored("mefiStudio.tabs.global.v1"), project = t.stored("mefiStudio.tabs.v1.p1");
  assert.deepEqual(global.pins.map((pin) => pin.route.id), ["fleet"], "the page pin is in the global store");
  assert.deepEqual(project.tabs.map((tab) => [tab.route.params.taskId, tab.pin]), [["a", true]], "the session pin is in the project's store");
  // another project has the page pin and not the session
  t.window.dispatchEvent({ type: "mefi:project-changed", detail: { projectId: "p2" } });
  t.board.projectId = "p2";
  await t.settle();
  assert.deepEqual(t.titles(), ["Home", "Fleet"], "the page pin follows you; the session stays behind");
  // unpinning takes the page out of every project's pins and leaves it as a tab in this one
  const again = t.tabs.list().find((tab) => tab.route.id === "fleet");
  t.tabs.pin(again.id, false);
  await t.settle(); t.tabs.flush();
  assert.deepEqual(t.stored("mefiStudio.tabs.global.v1").pins, []);
  assert.equal(t.tabs.list().find((tab) => tab.route.id === "fleet").pin, false);
});

test("pinned tabs are compact, sit left of the rest, never hold a close button, and move only among themselves", async () => {
  const t = await tabsEnv();
  for (const id of ["fleet", "plans", "worktrees"]) t.tabs.open(id, {}, { preview: false });
  await t.settle();
  const idOf = (route) => t.tabs.list().find((tab) => tab.route.id === route).id;
  t.tabs.pin(idOf("worktrees"), true); t.tabs.pin(idOf("fleet"), true);
  await t.settle();
  assert.deepEqual(routes(t), ["workspace", "worktrees", "fleet", "plans"], "pins first, in the order they were pinned");
  assert.equal(t.itemOf("Worktrees").querySelector(".ts-close").hidden, true, "no close button on a pin");
  assert.equal(t.itemOf("Plans").querySelector(".ts-close").hidden, false);
  assert.equal(t.tabs.move(idOf("fleet"), 0), true, "a pin can go ahead of another pin");
  assert.deepEqual(routes(t), ["workspace", "fleet", "worktrees", "plans"]);
  assert.equal(t.tabs.move(idOf("plans"), 0), false, "a tab that is not pinned cannot go into the pins");
  assert.deepEqual(routes(t), ["workspace", "fleet", "worktrees", "plans"]);
  assert.equal(t.tabs.move("home", 2), false, "Home stays first");
});

test("closing the tab you are on goes to its right neighbour, else its left, else Home; Home itself cannot be closed", async () => {
  const t = await tabsEnv();
  for (const id of ["fleet", "plans", "worktrees"]) t.tabs.open(id, {}, { preview: false });
  await t.settle();
  const idOf = (route) => t.tabs.list().find((tab) => tab.route.id === route).id;
  t.tabs.activate(idOf("plans")); await t.settle();
  t.tabs.close(idOf("plans")); await t.settle();
  assert.equal(t.active(), "Worktrees", "the one that was to the right");
  assert.equal(t.nav.calls.at(-1)[0], "worktrees", "and the app went there");
  t.tabs.close(idOf("worktrees")); await t.settle();
  assert.equal(t.active(), "Fleet", "nothing to the right: the one to the left");
  t.tabs.close(idOf("fleet")); await t.settle();
  assert.equal(t.active(), "Home", "nothing left: Home");
  assert.equal(t.nav.calls.at(-1)[0], "workspace");
  assert.equal(t.tabs.close("home"), false);
  assert.deepEqual(t.titles(), ["Home"]);
  const before = t.nav.calls.length;
  assert.equal(t.tabs.close("nope"), false, "closing what is not there does nothing");
  assert.equal(t.nav.calls.length, before);
});

test("closing a tab you are not on leaves you where you are", async () => {
  const t = await tabsEnv();
  t.tabs.open("fleet", {}, { preview: false }); t.tabs.open("plans", {}, { preview: false });
  await t.settle();
  const before = t.nav.calls.length;
  t.tabs.close(t.tabs.list().find((tab) => tab.route.id === "fleet").id);
  await t.settle();
  assert.equal(t.active(), "Plans");
  assert.equal(t.nav.calls.length, before, "no navigation");
});

test("Close other tabs, Close to the right and Close all but pinned leave pins alone and go through Recently closed", async () => {
  const t = await tabsEnv();
  for (const id of ["fleet", "plans", "worktrees", "explorer", "agents"]) t.tabs.open(id, {}, { preview: false });
  await t.settle();
  const idOf = (route) => t.tabs.list().find((tab) => tab.route.id === route).id;
  t.tabs.pin(idOf("fleet"), true);
  await t.settle();
  // right-click Worktrees > Close tabs to the right
  await t.tabOf("Worktrees").parentNode.trigger("contextmenu", { target: t.tabOf("Worktrees"), clientX: 300, clientY: 20 });
  assert.ok(t.popover(), "the tab menu is up");
  const item = (act) => t.popover().querySelector(`[data-act="${act}"]`);
  await item("to-the-right").trigger("click");
  await t.settle();
  assert.deepEqual(routes(t), ["workspace", "fleet", "plans", "worktrees"], "Sessions and Agents went, the pin and the ones to the left stayed");
  assert.deepEqual(closedRoutes(t), ["agents", "explorer"], "both are in Recently closed, the later one first");
  await t.tabOf("Plans").parentNode.trigger("contextmenu", { target: t.tabOf("Plans"), clientX: 200, clientY: 20 });
  await item("others").trigger("click");
  await t.settle();
  assert.deepEqual(routes(t), ["workspace", "fleet", "plans"], "Close other tabs keeps the pin and the one you chose");
  assert.equal(t.active(), "Plans", "and takes you to the one you chose");
  t.tabs.open("agents", {}, { preview: false }); await t.settle();
  await t.tabOf("Plans").parentNode.trigger("contextmenu", { target: t.tabOf("Plans"), clientX: 200, clientY: 20 });
  await item("all").trigger("click");
  await t.settle();
  assert.deepEqual(routes(t), ["workspace", "fleet"]);
  assert.equal(t.active(), "Home", "the tab you were on is gone: Home");
});

test("Recently closed holds the last ten, newest first, once per place, and Ctrl+Shift+T brings the newest back", async () => {
  const t = await tabsEnv({ tasks: Array.from({ length: 12 }, (_, i) => task(`k${i}`, { title: `Job ${i}` })) });
  t.tabs.setPrefs({ cap: 12 });
  for (let i = 0; i < 12; i += 1) openSession(t, `k${i}`);
  await t.settle();
  assert.equal(t.tabs.list().length, 13, "twelve sessions and Home");
  for (let i = 0; i < 12; i += 1) t.tabs.close(t.tabs.list().find((tab) => tab.route.params.taskId === `k${i}`)?.id ?? "");
  await t.settle();
  const closed = t.tabs.recentlyClosed();
  assert.equal(closed.length, 10, "ten are kept");
  assert.equal(closed[0].title, "Job 11", "newest first");
  assert.equal(closed.at(-1).title, "Job 2");
  t.tabs.restore(); await t.settle();
  assert.equal(t.active(), "Job 11", "the newest came back and is showing");
  assert.equal(t.tabs.recentlyClosed().length, 9, "it left the list");
  // closing the same place twice lists it once
  t.tabs.close(t.tabs.list().find((tab) => tab.route.params.taskId === "k11").id);
  assert.equal(t.tabs.recentlyClosed().filter((c) => c.title === "Job 11").length, 1);
  // a key for it
  t.key({ key: "T", code: "KeyT", ctrlKey: true, shiftKey: true });
  await t.settle();
  assert.equal(t.active(), "Job 11");
});

test("Ctrl+Shift+T skips a closed session whose task was deleted: it is not offered and comes back from nowhere", async () => {
  const t = await tabsEnv({ tasks: [task("gone", { title: "Old work" }), task("keep", { title: "Other" })] });
  openSession(t, "keep"); openSession(t, "gone"); await t.settle();
  t.tabs.close(t.tabs.list().find((tab) => tab.route.params.taskId === "keep").id);
  t.tabs.close(t.tabs.list().find((tab) => tab.route.params.taskId === "gone").id);
  assert.deepEqual(closedTitles(t), ["Old work", "Other"]);
  t.board.tasks = [task("keep", { title: "Other" })];
  assert.deepEqual(closedTitles(t), ["Other"], "the deleted one is not offered");
  t.tabs.restore(); await t.settle();
  assert.equal(t.active(), "Other", "the newest one that can come back did, without a word about the other");
  assert.equal(t.toasts.length, 0);
  assert.equal(t.tabs.restore(), null);
  assert.match(t.toasts.at(-1).message, /No closed tabs to reopen/);
});

test("a closed page that has left the registry is skipped without a word", async () => {
  const t = await tabsEnv();
  t.tabs.open("fleet", {}, { preview: false }); await t.settle();
  t.tabs.close(t.tabs.list().find((tab) => tab.route.id === "fleet").id);
  assert.equal(t.tabs.recentlyClosed().length, 1);
  const get = t.nav.get;
  t.nav.get = (id) => (id === "fleet" ? null : get(id));
  assert.equal(t.tabs.recentlyClosed().length, 0);
  assert.equal(t.tabs.restore(), null);
  assert.deepEqual(t.toasts.map((x) => x.message), ["No closed tabs to reopen."], "only the plain line");
});

test("time alone closes no page tab: only finished sessions are ever closed for being idle", async () => {
  const t = await tabsEnv();
  t.tabs.open("fleet", {}, { preview: false }); t.tabs.open("plans", {}, { preview: false });
  await t.advance(5 * 24 * 60 * MIN);
  assert.deepEqual(t.titles(), ["Home", "Fleet", "Plans"], "time alone closes no page tab");
  assert.equal(t.toasts.length, 0);
});

test("at most eight tabs that are not pinned: the one used longest ago closes, never the one you are on, and the toast puts it back", async () => {
  const tasks = Array.from({ length: 10 }, (_, i) => task(`t${i}`, { title: `Work ${i}` }));
  const t = await tabsEnv({ tasks });
  assert.equal(t.tabs.prefs().cap, 8, "eight is the default");
  for (let i = 0; i < 8; i += 1) openSession(t, `t${i}`);
  await t.settle();
  assert.equal(t.tabs.list().length, 9, "eight and Home");
  assert.equal(t.toasts.length, 0, "eight is allowed");
  // look at the oldest again, so the one used longest ago is the second
  t.tabs.activate(t.tabs.list().find((tab) => tab.route.params.taskId === "t0").id); await t.settle();
  openSession(t, "t8"); await t.settle();
  assert.equal(t.tabs.list().length, 9, "still eight and Home");
  assert.ok(!routes(t).includes("s:t1"), "t1 was used longest ago, so it went");
  assert.ok(routes(t).includes("s:t0") && routes(t).includes("s:t8"), "the one you had revisited and the one you just opened stayed");
  const toast = t.toasts.at(-1);
  assert.match(toast.message, /Closed “Work 1” to keep 8 tabs open\./);
  assert.equal(toast.options.action.label, "Undo");
  assert.ok(t.tabs.recentlyClosed().some((c) => c.title === "Work 1"), "it is in Recently closed too");
  toast.options.action.run(); await t.settle();
  assert.ok(routes(t).includes("s:t1"), "Undo put it back");
  assert.equal(t.tabs.recentlyClosed().some((c) => c.title === "Work 1"), false, "and out of Recently closed");
  assert.equal(t.tabs.list().length, 10, "the cap is only enforced when something opens, so Undo is not undone");
});

test("the cap counts tabs that are not pinned, and never closes a pin", async () => {
  const tasks = Array.from({ length: 6 }, (_, i) => task(`c${i}`));
  const t = await tabsEnv({ tasks });
  t.tabs.setPrefs({ cap: 3 });
  for (let i = 0; i < 3; i += 1) openSession(t, `c${i}`);
  await t.settle();
  t.tabs.pin(t.tabs.list().find((tab) => tab.route.params.taskId === "c0").id, true);
  openSession(t, "c3"); await t.settle();
  assert.equal(t.tabs.list().filter((tab) => !tab.pin && !tab.home).length, 3, "three that are not pinned");
  assert.ok(routes(t).includes("s:c0"), "the pin is still there though it was the oldest");
  openSession(t, "c4"); await t.settle();
  assert.ok(routes(t).includes("s:c0"));
  assert.equal(t.tabs.list().filter((tab) => !tab.pin && !tab.home).length, 3);
});

test("lowering the cap closes the extras at once, with Undo; raising it closes nothing", async () => {
  const tasks = Array.from({ length: 6 }, (_, i) => task(`d${i}`, { title: `D${i}` }));
  const t = await tabsEnv({ tasks });
  for (let i = 0; i < 6; i += 1) openSession(t, `d${i}`);
  await t.settle();
  t.tabs.setPrefs({ cap: 4 });
  await t.settle();
  assert.equal(t.tabs.list().filter((tab) => !tab.home).length, 4);
  assert.match(t.toasts.at(-1).message, /Closed 2 old tabs to keep 4 open\./);
  const count = t.toasts.length;
  t.tabs.setPrefs({ cap: 9 });
  assert.equal(t.toasts.length, count);
  assert.equal(t.tabs.prefs().cap, 9);
});

test("tabs of finished sessions close after the idle time, with Undo, and only those", async () => {
  const tasks = [task("done1", { title: "Shipped", status: "done" }), task("done2", { title: "Merged", status: "done" }), task("busy", { title: "Running", status: "active" }), task("fresh", { title: "Just done", status: "done" })];
  const t = await tabsEnv({ tasks });
  for (const id of ["done1", "done2", "busy"]) openSession(t, id);
  t.tabs.open("fleet", {}, { preview: false });
  await t.settle();
  openSession(t, "fresh"); await t.settle();
  t.tabs.activate("home"); await t.settle();
  await t.advance(29 * MIN);
  assert.equal(t.tabs.list().length, 6, "29 minutes is not enough");
  t.tabs.activate(t.tabs.list().find((tab) => tab.route.params.taskId === "fresh").id); await t.settle();
  t.tabs.activate("home"); await t.settle();
  await t.advance(2 * MIN);
  assert.deepEqual(routes(t).filter((route) => route.startsWith("s:")), ["s:busy", "s:fresh"], "the two finished sessions you left 31 minutes ago went; the unfinished one and the one you visited since stayed");
  assert.ok(routes(t).includes("fleet"), "a page tab is not finished work");
  assert.match(t.toasts.at(-1).message, /Closed 2 tabs of done work, idle for 30 minutes\./);
  assert.equal(t.toasts.at(-1).options.action.label, "Undo");
  assert.equal(t.tabs.recentlyClosed().length, 2);
  t.toasts.at(-1).options.action.run(); await t.settle();
  assert.ok(routes(t).includes("s:done1") && routes(t).includes("s:done2"), "Undo brought both back");
});

test("the idle close never touches the tab you are on, a pin, or a session that is not finished", async () => {
  const tasks = [task("a", { status: "done", title: "A" }), task("b", { status: "done", title: "B" }), task("c", { status: "active", title: "C" })];
  const t = await tabsEnv({ tasks });
  for (const id of ["a", "b", "c"]) openSession(t, id);
  t.tabs.pin(t.tabs.list().find((tab) => tab.route.params.taskId === "b").id, true);
  t.tabs.activate(t.tabs.list().find((tab) => tab.route.params.taskId === "a").id);
  await t.settle();
  await t.advance(3 * 60 * MIN);
  assert.deepEqual(routes(t).filter((route) => route.startsWith("s:")).sort(), ["s:a", "s:b", "s:c"], "A is showing, B is pinned, C is still running");
  assert.equal(t.toasts.length > 0 ? t.toasts.filter((x) => /idle for/.test(x.message)).length : 0, 0);
});

test("the idle time is a setting: Never closes nothing, a shorter time closes sooner", async () => {
  const tasks = [task("a", { status: "done", title: "A" })];
  const never = await tabsEnv({ tasks });
  never.tabs.setPrefs({ idle: 0 });
  openSession(never, "a"); never.tabs.activate("home"); await never.settle();
  await never.advance(24 * 60 * MIN);
  assert.ok(routes(never).includes("s:a"));
  const ten = await tabsEnv({ tasks });
  ten.tabs.setPrefs({ idle: 10 });
  openSession(ten, "a"); ten.tabs.activate("home"); await ten.settle();
  await ten.advance(11 * MIN);
  assert.ok(!routes(ten).includes("s:a"));
  assert.match(ten.toasts.at(-1).message, /idle for 10 minutes/);
  const hour = await tabsEnv({ tasks });
  hour.tabs.setPrefs({ idle: 60 });
  openSession(hour, "a"); hour.tabs.activate("home"); await hour.settle();
  await hour.advance(61 * MIN);
  assert.match(hour.toasts.at(-1).message, /idle for an hour/);
});

test("nothing polls: a timer is set for the idle close only when a finished session tab could be due, and for the moment it is", async () => {
  const t = await tabsEnv({ tasks: [task("a", { status: "done" }), task("b", { status: "active" })] });
  await t.advance(2000);
  assert.equal(t.timers.size, 0, "a quiet strip holds no timer");
  openSession(t, "b"); t.tabs.activate("home"); await t.advance(2000);
  assert.equal(t.timers.size, 0, "an unfinished session is never due");
  openSession(t, "a"); t.tabs.activate("home"); await t.advance(400);
  const due = [...t.timers.values()].map((timer) => timer.at - t.clock.t);
  assert.equal(due.length, 1, "exactly one timer");
  assert.ok(due[0] > 29 * MIN && due[0] <= 30 * MIN + 1000, "set for the moment the tab falls due, not for a poll");
  t.tabs.setPrefs({ idle: 0 });
  await t.advance(400);
  assert.equal(t.timers.size, 0, "switching the closing off clears it");
});

test("an agent that needs you: by default its tab opens in the background with a badge, and you stay where you are", async () => {
  const t = await tabsEnv({ tasks: [task("q", { title: "Needs an answer", status: "active" }), task("other", { title: "Other" })] });
  await t.go("fleet");
  const calls = t.nav.calls.length;
  t.board.assistant = { questions: [{ id: "q1", status: "open", context: { taskId: "q" } }] };
  t.window.dispatchEvent({ type: "mefi:workspace-state" });
  await t.settle();
  assert.ok(t.titles().includes("Needs an answer"), "a tab for it opened");
  assert.equal(t.active(), "Fleet", "without taking you there");
  assert.equal(t.nav.calls.length, calls, "the app did not navigate");
  assert.equal(t.itemOf("Needs an answer").dataset.attn, "true", "it carries the needs-you mark");
  assert.equal(t.tabs.list().find((tab) => tab.title === "Needs an answer").badge, true);
  assert.ok(t.tabOf("Needs an answer").getAttribute("aria-label").includes("needs you"), "and says so to a screen reader");
  // visiting it clears the background flash, and the mark stays while the question is open and you are elsewhere
  t.tabs.activate(t.tabs.list().find((tab) => tab.title === "Needs an answer").id); await t.settle();
  assert.equal(t.itemOf("Needs an answer").dataset.attn, undefined, "no mark on the tab you are on");
  t.tabs.activate("home"); await t.settle();
  assert.equal(t.itemOf("Needs an answer").dataset.attn, "true", "but it needs you still, so it is marked again when you leave");
  t.board.assistant = { questions: [] };
  t.window.dispatchEvent({ type: "mefi:workspace-state" }); await t.settle();
  assert.equal(t.itemOf("Needs an answer").dataset.attn, undefined, "answered: the mark goes");
});

test("a question that is already open when the strip starts gets no tab of its own", async () => {
  const t = await tabsEnv({ tasks: [task("q", { title: "Asked before" })], assistant: { questions: [{ id: "q0", status: "open", context: { taskId: "q" } }] } });
  t.window.dispatchEvent({ type: "mefi:workspace-state" }); await t.settle();
  assert.deepEqual(t.titles(), ["Home"], "it was there at the first look, so it is the baseline");
  t.board.assistant = { questions: [{ id: "q0", status: "open", context: { taskId: "q" } }, { id: "q1", status: "open", context: { taskId: "new" } }] };
  t.board.tasks.push(task("new", { title: "Asked since" }));
  t.window.dispatchEvent({ type: "mefi:workspace-state" }); await t.settle();
  assert.deepEqual(t.titles(), ["Home", "Asked since"], "a new one is announced");
});

test("the baseline waits for the board and the assistant to arrive, so the first question after a slow start is not mistaken for a new one", async () => {
  const t = await tabsEnv({ assistant: {} });
  t.window.dispatchEvent({ type: "mefi:workspace-state" }); await t.settle();
  // the board and the assistant's state arrive, with an old question in it
  t.board.tasks = [task("q", { title: "Old question" })];
  t.board.assistant = { questions: [{ id: "q0", status: "open", context: { taskId: "q" } }] };
  t.window.dispatchEvent({ type: "mefi:workspace-state" }); await t.settle();
  assert.deepEqual(t.titles(), ["Home"], "the first look with data is the baseline");
  t.board.assistant = { questions: [{ id: "q0", status: "open", context: { taskId: "q" } }, { id: "q1", status: "open", context: { taskId: "q2" } }] };
  t.board.tasks.push(task("q2", { title: "Newer question" }));
  t.window.dispatchEvent({ type: "mefi:workspace-state" }); await t.settle();
  assert.deepEqual(t.titles(), ["Home", "Newer question"]);
});

test("an agent that needs you: Badge only marks a tab that is open and opens nothing; Open and focus takes you there", async () => {
  const badge = await tabsEnv({ tasks: [task("q", { title: "Question" }), task("r", { title: "Other" })] });
  badge.tabs.setPrefs({ agent: "badge" });
  openSession(badge, "q"); badge.tabs.activate("home"); await badge.settle();
  badge.board.assistant = { questions: [{ id: "a", status: "open", context: { taskId: "q" } }, { id: "b", status: "open", context: { taskId: "r" } }] };
  badge.window.dispatchEvent({ type: "mefi:workspace-state" }); await badge.settle();
  assert.deepEqual(badge.titles(), ["Home", "Question"], "Other has no tab and is not given one");
  assert.equal(badge.itemOf("Question").dataset.attn, "true");
  const focus = await tabsEnv({ tasks: [task("q", { title: "Question" })] });
  focus.tabs.setPrefs({ agent: "focus" });
  focus.board.assistant = { questions: [{ id: "a", status: "open", context: { taskId: "q" } }] };
  focus.window.dispatchEvent({ type: "mefi:workspace-state" }); await focus.settle();
  assert.equal(focus.active(), "Question", "you were taken to it");
  assert.equal(focus.nav.calls.at(-1)[0], "workspace");
  assert.equal(focus.nav.calls.at(-1)[1].taskId, "q");
});

test("an agent that needs you on the tab you are already on changes nothing", async () => {
  const t = await tabsEnv({ tasks: [task("q", { title: "Question" })] });
  openSession(t, "q"); await t.settle();
  const before = t.tabs.list().length;
  t.board.assistant = { questions: [{ id: "a", status: "open", context: { taskId: "q" } }] };
  t.window.dispatchEvent({ type: "mefi:workspace-state" }); await t.settle();
  assert.equal(t.tabs.list().length, before);
  assert.equal(t.itemOf("Question").dataset.attn, undefined);
});

test("Home carries the count of what needs you: the Today board's own number when there is one, else what the strip can see", async () => {
  const t = await tabsEnv({ tasks: [task("q", { title: "Question" })] });
  assert.equal(t.itemOf("Home").querySelector(".ts-count").hidden, true, "nothing needs you: no count");
  t.board.assistant = { questions: [{ id: "a", status: "open", context: { taskId: "q" } }] };
  t.window.dispatchEvent({ type: "mefi:workspace-state" }); await t.settle();
  const count = t.itemOf("Home").querySelector(".ts-count");
  assert.equal(count.hidden, false);
  assert.equal(count.textContent, "1");
  assert.equal(count.title, "1 need you");
  let n = 4;
  t.window.MefiToday = { count: () => n, onChange: () => () => {} };
  t.tabs.flush();
  assert.equal(t.itemOf("Today").querySelector(".ts-count").textContent, "4", "the Today board's count wins, and Home is called Today once it exists");
});

test("a third visit to a page offers to pin it, once: accepting pins it, and no page is ever asked about twice", async () => {
  const t = await tabsEnv();
  const visit = async (id) => { await t.go(id); };
  await visit("fleet"); await visit("plans"); await visit("fleet"); await visit("plans");
  assert.equal(t.strip().querySelector(".ts-suggest").hidden, true, "two visits: nothing yet");
  await visit("fleet");
  const chip = t.strip().querySelector(".ts-suggest");
  assert.equal(chip.hidden, false, "the third visit to Fleet offers a pin");
  assert.equal(chip.querySelector(".ts-suggest-text").textContent, "Pin Fleet?");
  await chip.querySelector(".ts-suggest-pin").trigger("click"); await t.settle();
  assert.equal(t.tabs.list().find((tab) => tab.route.id === "fleet").pin, true, "it is pinned");
  assert.equal(t.strip().querySelector(".ts-suggest").hidden, true);
  // Plans was visited three times by now, so it gets its one offer; turning it down means it is not asked again
  await visit("plans");
  assert.equal(t.strip().querySelector(".ts-suggest-text").textContent, "Pin Plans?");
  await t.strip().querySelector(".ts-suggest-no").trigger("click"); await t.settle();
  assert.equal(t.strip().querySelector(".ts-suggest").hidden, true);
  for (let i = 0; i < 4; i += 1) { await visit("fleet"); await visit("plans"); }
  assert.equal(t.strip().querySelector(".ts-suggest").hidden, true, "never twice for the same page");
});

test("a pin offer you ignore is not made again, even after a restart", async () => {
  const storage = new Map();
  const t = await tabsEnv({ storage });
  for (let i = 0; i < 2; i += 1) { await t.go("fleet"); await t.go("workspace"); }
  await t.go("fleet");
  assert.equal(t.strip().querySelector(".ts-suggest").hidden, false, "offered on the third visit");
  await t.go("workspace");
  assert.equal(t.strip().querySelector(".ts-suggest").hidden, true, "leaving it unanswered takes it away");
  t.tabs.flush();
  assert.equal(t.stored("mefiStudio.tabs.global.v1").offered.fleet, 1, "that it was offered is remembered");
  assert.equal(t.stored("mefiStudio.tabs.global.v1").visits.fleet, 3, "and so is how often you went");
  for (let i = 0; i < 4; i += 1) { await t.go("fleet"); await t.go("workspace"); }
  assert.equal(t.strip().querySelector(".ts-suggest").hidden, true, "not again in this launch");
  const again = await tabsEnv({ storage });
  for (let i = 0; i < 4; i += 1) { await again.go("fleet"); await again.go("workspace"); }
  assert.equal(again.strip().querySelector(".ts-suggest").hidden, true, "nor in the next");
});

test("the pin suggestion is a setting, and sessions and Home are never offered", async () => {
  const t = await tabsEnv({ tasks: [task("a", { title: "A" })] });
  t.tabs.setPrefs({ suggest: false });
  for (let i = 0; i < 4; i += 1) { await t.go("fleet"); await t.go("plans"); }
  assert.equal(t.strip().querySelector(".ts-suggest").hidden, true);
  t.tabs.setPrefs({ suggest: true });
  for (let i = 0; i < 4; i += 1) { t.tabs.activate("home"); await t.settle(); openSession(t, "a"); await t.settle(); }
  assert.equal(t.strip().querySelector(".ts-suggest").hidden, true, "a session is not a page you would pin this way");
  t.tabs.activate("home"); await t.settle();
  assert.equal(t.strip().querySelector(".ts-suggest").hidden, true);
});

test("the master switch turns every managed behaviour off at once, and back on", async () => {
  const tasks = Array.from({ length: 4 }, (_, i) => task(`m${i}`, { status: "done", title: `M${i}` }));
  const t = await tabsEnv({ tasks });
  t.tabs.setPrefs({ manage: false });
  await t.go("fleet"); await t.go("plans");
  assert.deepEqual(t.titles(), ["Home", "Fleet", "Plans"], "no preview tab: each click is a tab");
  for (let i = 0; i < 4; i += 1) openSession(t, `m${i}`);
  t.tabs.setPrefs({ cap: 3 });
  t.tabs.activate("home"); await t.settle();
  assert.equal(t.tabs.list().length, 7, "no cap");
  await t.advance(5 * 60 * MIN);
  assert.equal(t.tabs.list().length, 7, "no closing of finished work");
  for (let i = 0; i < 4; i += 1) { await t.go("fleet"); await t.go("plans"); }
  assert.equal(t.strip().querySelector(".ts-suggest").hidden, true, "no suggestions");
  t.board.assistant = { questions: [{ id: "x", status: "open", context: { taskId: "zzz" } }] };
  t.window.dispatchEvent({ type: "mefi:workspace-state" }); await t.settle();
  assert.equal(t.tabs.list().length, 7, "an agent that needs you opens nothing");
  t.tabs.setPrefs({ manage: true });
  await t.settle();
  assert.ok(t.tabs.list().length < 7, "switched back on, the cap applies at once");
});

test("the settings are validated and kept: defaults, bad values, ranges", async () => {
  const storage = new Map([["mefiStudio.tabs.prefs.v1", JSON.stringify({ v: 1, manage: "no", preview: false, agent: "teleport", idle: 7, cap: 99, suggest: false })]]);
  const t = await tabsEnv({ storage });
  assert.deepEqual({ ...t.tabs.prefs() }, { manage: true, preview: false, suggest: false, agent: "bg", idle: 30, cap: 12, forcedOff: false }, "what is not a valid choice falls back to the default; the cap is cut to 3 to 12");
  const low = t.tabs.setPrefs({ cap: 0 });
  assert.equal(low.cap, 3);
  t.tabs.setPrefs({ idle: 10, agent: "focus", preview: true, suggest: true });
  assert.deepEqual(t.stored("mefiStudio.tabs.prefs.v1"), { v: 1, manage: true, preview: true, suggest: true, agent: "focus", idle: 10, cap: 3 });
  const fresh = await tabsEnv();
  assert.deepEqual({ ...fresh.tabs.prefs() }, { manage: true, preview: true, suggest: true, agent: "bg", idle: 30, cap: 8, forcedOff: false }, "the defaults the owner asked for: a preview tab, badge and a background tab, 30 minutes, eight, suggestions");
  assert.equal(fresh.storage.has("mefiStudio.tabs.prefs.v1"), false, "a default nobody changed is not written down");
});

test("MEFI_STUDIO_NO_TAB_MANAGER=1 (the host's word) turns management off for the run and the card says so", async () => {
  const host = { prefsGet: async () => ({ ok: true, prefs: { tabsManage: false } }) };
  const t = await tabsEnv({ host, tasks: [task("a", { status: "done" })] });
  await t.settle();
  assert.equal(t.tabs.prefs().forcedOff, true);
  await t.go("fleet"); await t.go("plans");
  assert.deepEqual(t.titles(), ["Home", "Fleet", "Plans"], "no preview tab");
  const card = t.tabs.configCard();
  const master = card.querySelector('[data-key="manage"]');
  assert.equal(master.checked, false);
  assert.equal(master.disabled, true, "the card cannot turn it back on: the run decided");
  assert.match(card.textContent, /MEFI_STUDIO_NO_TAB_MANAGER/);
  // and the host saying nothing leaves the settings in charge
  const quiet = await tabsEnv({ host: { prefsGet: async () => ({ ok: true, prefs: {} }) } });
  await quiet.go("fleet"); await quiet.go("plans");
  assert.deepEqual(quiet.titles(), ["Home", "Plans"]);
  // a host that cannot answer does not break the strip
  const broken = await tabsEnv({ host: { prefsGet: async () => { throw new Error("no host"); } } });
  await broken.go("fleet");
  assert.deepEqual(broken.titles(), ["Home", "Fleet"]);
});

test("moving a tab: within its group, by index or by one place, and arranging a preview keeps it", async () => {
  const t = await tabsEnv();
  for (const id of ["fleet", "plans", "worktrees"]) t.tabs.open(id, {}, { preview: false });
  await t.settle();
  const idOf = (route) => t.tabs.list().find((tab) => tab.route.id === route).id;
  assert.equal(t.tabs.move(idOf("worktrees"), 0), true);
  assert.deepEqual(routes(t), ["workspace", "worktrees", "fleet", "plans"]);
  assert.equal(t.tabs.move(idOf("worktrees"), 99), true, "an index past the end goes to the end of the group");
  assert.deepEqual(routes(t), ["workspace", "fleet", "plans", "worktrees"]);
  assert.equal(t.tabs.move(idOf("worktrees"), 2), false, "already there");
  await t.go("explorer");
  assert.equal(t.tabs.list().find((tab) => tab.route.id === "explorer").prev, true);
  t.tabs.move(idOf("explorer"), 0); await t.settle();
  assert.equal(t.tabs.list().find((tab) => tab.route.id === "explorer").prev, false, "a tab you arranged is one you meant to keep");
});

test("open() is what a click is: it shows the place, in the preview tab unless it is told to keep a tab, and pins on request", async () => {
  const t = await tabsEnv();
  const a = t.tabs.open("fleet");
  assert.equal(a.prev, true); assert.equal(a.active, true); assert.equal(a.title, "Fleet");
  assert.equal(t.nav.calls.at(-1)[0], "fleet", "the app was asked for the page");
  const b = t.tabs.open("plans", {}, { preview: false });
  assert.equal(b.prev, false);
  const c = t.tabs.open("worktrees", {}, { pin: true });
  assert.equal(c.pin, true, "asking for a pin gives a pin");
  assert.equal(c.prev, false);
  const again = t.tabs.open("fleet", {}, { preview: false });
  assert.equal(again.id, a.id, "an existing tab is reused, and keeping it un-previews it");
  assert.equal(again.prev, false);
  assert.equal(t.tabs.open("friends"), null, "an action is not a place");
  assert.equal(t.tabs.open("palette"), null, "neither is a dialog");
  assert.equal(t.tabs.open("nowhere"), null);
  assert.equal(t.titles().includes("Friends"), false);
});

test("a background open makes the tab without showing it", async () => {
  const t = await tabsEnv();
  await t.go("fleet");
  const calls = t.nav.calls.length;
  const made = t.tabs.open("plans", {}, { background: true });
  await t.settle();
  assert.equal(made.active, false);
  assert.equal(t.active(), "Fleet");
  assert.equal(t.nav.calls.length, calls);
  assert.deepEqual(t.titles(), ["Home", "Fleet", "Plans"]);
});

test("Home is Vibe in the other mode: one tab, whichever word the app uses", async () => {
  const t = await tabsEnv({ vibe: true });
  await t.go("fleet");
  await t.go("workspace");
  assert.equal(t.nav.page, "vibe", "the stub's Home is Vibe here");
  assert.deepEqual(t.titles(), ["Home", "Fleet"], "no second Home tab appeared");
  assert.equal(t.active(), "Home");
});

test("sessions are tabs of their own, named for their task, with a dot in the colour of how they are doing", async () => {
  const t = await tabsEnv({ tasks: [task("a", { title: "Add dark mode", status: "active" }), task("b", { title: "Fix the login", status: "done" })] });
  openSession(t, "a"); openSession(t, "b"); await t.settle();
  assert.deepEqual(t.titles(), ["Home", "Add dark mode", "Fix the login"]);
  assert.equal(t.itemOf("Add dark mode").querySelector(".ts-dot").dataset.tone, "live", "running");
  assert.equal(t.itemOf("Fix the login").querySelector(".ts-dot").dataset.tone, "good", "done");
  t.board.tasks[0].status = "awaiting_verification";
  t.window.dispatchEvent({ type: "mefi:workspace-state" }); await t.settle();
  assert.equal(t.itemOf("Add dark mode").querySelector(".ts-dot").dataset.tone, "info", "in review");
  t.board.tasks[0].title = "Add a dark theme";
  t.window.dispatchEvent({ type: "mefi:workspace-state" }); await t.settle();
  assert.ok(t.titles().includes("Add a dark theme"), "a renamed task renames its tab");
  t.window.MefiTasks = { shortTitle: (x) => `«${x.title}»` };
  t.tabs.flush();
  assert.ok(t.titles().includes("«Add a dark theme»"), "the Task board's own short title is used when it has one");
});

test("a session whose task was deleted loses its tab once the board has loaded, and keeps it while the board is still empty", async () => {
  const t = await tabsEnv({ tasks: [task("a", { title: "Stays" }), task("b", { title: "Goes" })] });
  openSession(t, "a"); openSession(t, "b"); t.tabs.activate("home"); await t.settle();
  t.board.tasks = [task("a", { title: "Stays" })];
  t.window.dispatchEvent({ type: "mefi:workspace-state" }); await t.settle();
  assert.deepEqual(t.titles(), ["Home", "Stays"]);
  t.board.tasks = [];
  t.window.dispatchEvent({ type: "mefi:workspace-state" }); await t.settle();
  assert.deepEqual(t.titles(), ["Home", "Stays"], "an empty list is 'not loaded yet', not 'everything was deleted'");
});

test("the strip tells its listeners what changed, and stops when they let go", async () => {
  const t = await tabsEnv();
  const seen = [];
  const off = t.tabs.onChange((event) => seen.push(event.reason));
  await t.go("fleet");
  t.tabs.pin(t.tabs.list().find((tab) => tab.route.id === "fleet").id, true);
  t.tabs.close(t.tabs.list().find((tab) => tab.route.id === "fleet").id);
  assert.ok(seen.includes("place") && seen.includes("pin") && seen.includes("close"), seen.join());
  const count = seen.length;
  off();
  t.tabs.open("plans");
  assert.equal(seen.length, count, "unsubscribed");
  assert.equal(typeof t.tabs.onChange(null), "function", "a bad callback is harmless");
});
