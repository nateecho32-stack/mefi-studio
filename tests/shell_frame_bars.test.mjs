// The frame's two bars (renderer/shell.js): the top bar's list toggle, Vibe | Build
// radiogroup, trail, Search pill, "N need you" and "N working" pills and inspector
// toggle; the status bar's Layout menu, what is running, what waits and the real
// data on its right; and the feed that paints them without a timer of its own.
// The modules the bars ask are stand-ins (tests/fixtures/shell-vm.mjs); an item
// nobody has data for must not be there.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { loadShell, plain } from "./fixtures/shell-vm.mjs";

// The script is too long to print when a pattern it must not hold is found: say where.
const absent = (text, pattern, message) => { const found = pattern.exec(text); assert.ok(!found, `${message}: found ${JSON.stringify(found?.[0])} at ${found?.index}`); };
const snap = (extra = {}) => ({ projectId: "p1", project: { name: "Fixture" }, status: { running: [] }, assistant: {}, ...extra });
const say = (node) => node.textContent;
// What changed is painted at once by sync(), or by the feed's coalescing timer when an event says so.
const refresh = (page) => { page.window.dispatchEvent({ type: "mefi:workspace-state" }); page.flush(); };
const item = (page, key) => page.$("shell-status").querySelector(`[data-item="${key}"]`);

test("the top bar: the list toggle, the mode switch, the trail, Search, the two pills and the inspector toggle, in that order", () => {
  const page = loadShell({});
  const top = page.region("top");
  const [left, trail, extra, right] = top.children;
  assert.deepEqual(left.children.map((node) => node.id || node.getAttribute("role")), ["shell-list-toggle", "radiogroup"]);
  assert.deepEqual(right.children.map((node) => node.id), ["shell-search", "shell-need", "shell-svc", "shell-inspector-toggle"]);
  assert.equal(trail.getAttribute("aria-label"), "Where you are");
  assert.equal(extra.children.length, 0, "a place for other modules' controls, empty until they come");
  assert.equal(top.getAttribute("role"), "group");
  assert.equal(page.$("shell-list-toggle").getAttribute("aria-label"), "List");
  assert.equal(page.$("shell-inspector-toggle").getAttribute("aria-label"), "Inspector");
  const search = page.$("shell-search");
  assert.equal(search.getAttribute("aria-label"), "Search or run a command (Ctrl K)");
  assert.ok(say(search).includes("Search or run a command") && say(search).includes("Ctrl K"), "the pill says what it does and which key does it");
});

test("the list and inspector toggles open and close their columns and say so", async () => {
  const page = loadShell({});
  const shell = page.window.MefiShell;
  const list = page.$("shell-list-toggle"), inspector = page.$("shell-inspector-toggle");
  assert.equal(list.getAttribute("aria-pressed"), "true");
  assert.match(list.getAttribute("title"), /^Hide the list \(Ctrl B\)/);
  await list.click();
  assert.equal(shell.isOpen("list"), false);
  assert.equal(list.getAttribute("aria-pressed"), "false");
  assert.match(list.getAttribute("title"), /^Show the list/);
  assert.equal(list.dataset.on, "false");
  await inspector.click();
  assert.equal(shell.isOpen("inspector"), false);
  assert.match(inspector.getAttribute("title"), /^Show the inspector \(\[\)/);
  await inspector.click();
  assert.equal(inspector.getAttribute("aria-pressed"), "true");
  assert.equal(list.getAttribute("aria-controls"), "shell-list");
  assert.equal(inspector.getAttribute("aria-controls"), "shell-inspector");
  // In a small window the title says the column opens over the page.
  const small = loadShell({ width: 500, height: 400 });
  assert.match(small.$("shell-list-toggle").getAttribute("title"), /It opens over the page in a window this small/);
});

test("the Vibe | Build switch is a radiogroup that calls MefiVibe's own setter, from Home to Home and never from another page", async () => {
  const page = loadShell({});
  const group = page.region("top").querySelector(".mode-switch");
  assert.equal(group.getAttribute("role"), "radiogroup");
  assert.equal(group.getAttribute("aria-label"), "Studio mode");
  const [vibe, build] = group.querySelectorAll("button");
  assert.deepEqual([vibe.getAttribute("role"), build.getAttribute("role")], ["radio", "radio"]);
  assert.deepEqual([vibe.dataset.uiMode, build.dataset.uiMode], ["vibe", "build"], "the two values MefiVibe already has; no new uiMode");
  assert.deepEqual([vibe.getAttribute("aria-checked"), build.getAttribute("aria-checked"), group.dataset.mode], ["false", "true", "build"]);
  assert.deepEqual([vibe.getAttribute("aria-label"), build.getAttribute("aria-label")], ["Vibe", "Build"], "named without their words, which a small bar hides");
  assert.deepEqual([vibe.tabIndex, build.tabIndex], [-1, 0], "one tab stop, on the mode that is on");
  let stopped = 0, prevented = 0;
  await vibe.click({ stopPropagation: () => { stopped += 1; }, preventDefault: () => { prevented += 1; } });
  assert.deepEqual(page.calls.vibe, [["vibe", { go: true }]], "Home goes to Vibe's Home");
  assert.equal(stopped, 1, "MefiVibe's delegated click handler must not see the same click");
  assert.equal(prevented, 1);
  assert.deepEqual([vibe.getAttribute("aria-checked"), build.getAttribute("aria-checked"), group.dataset.mode], ["true", "false", "vibe"]);
  await vibe.click();
  assert.equal(page.calls.vibe.length, 1, "pressing the mode that is on does nothing");
  page.current = "tasks";
  await build.click();
  assert.deepEqual(page.calls.vibe.at(-1), ["build", { go: false }], "on any other page the page stays");
  assert.equal(page.root.dataset.uiMode, "build");
});

test("arrow keys, Home and End move between the two modes and focus follows", () => {
  const page = loadShell({});
  const group = page.region("top").querySelector(".mode-switch");
  const [vibe, build] = group.querySelectorAll("button");
  const press = (node, key) => { const event = { key, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } }; node.listeners.keydown[0](event); return event; };
  let event = press(build, "ArrowLeft");
  assert.equal(page.document.activeElement, vibe);
  assert.equal(page.window.MefiShell.mode(), "vibe");
  assert.ok(event.prevented && event.stopped, "the keys are taken, and not passed to vibe.js's own arrow handler");
  press(vibe, "ArrowDown");
  assert.equal(page.window.MefiShell.mode(), "build");
  press(build, "Home");
  assert.equal(page.window.MefiShell.mode(), "vibe");
  press(vibe, "End");
  assert.equal(page.window.MefiShell.mode(), "build");
  const count = page.calls.vibe.length;
  event = press(build, "a");
  assert.equal(event.prevented, undefined, "any other key is left alone");
  press(build, "End");
  assert.equal(page.calls.vibe.length, count, "End on Build stays on Build");
});

test("the frame never writes a mode of its own: uiMode is MefiVibe's", async () => {
  const source = await readFile(new URL("../renderer/shell.js", import.meta.url), "utf8");
  absent(source, /dataset\.uiMode\s*=(?!=)|setAttribute\(["']data-ui-mode["']/, "no write of html[data-ui-mode]");
  absent(source, /localStorage\.setItem\(["']mefiStudio\.uiMode/, "and no write of the saved mode");
  assert.match(source, /MefiVibe\?\.setMode\?\.\(next, \{ go: isHome\(\) \}\)/, "the existing setter is what is called");
  const page = loadShell({});
  page.window.MefiShell.setMode("vibe");
  page.window.MefiShell.setMode("nonsense");
  assert.equal(page.window.MefiShell.mode(), "vibe", "a value that is not a mode is refused");
  assert.deepEqual(page.calls.vibe, [["vibe", { go: true }]]);
});

test("the trail is project / page / item, from what MefiNav and Home already know", () => {
  const page = loadShell({ current: "tasks", registry: { tasks: { id: "tasks", label: "Work" } } });
  page.taskContext = { title: "Add the session list" };
  refresh(page);
  const trail = page.region("top").children[1];
  assert.deepEqual(trail.children.filter((node) => node.className.includes("shell-crumb")).map(say), ["Fixture", "Work", "Add the session list"]);
  assert.equal(trail.children.at(-1).getAttribute("aria-current"), "page", "the last crumb is where you are");
  assert.equal(trail.children.filter((node) => node.className === "shell-sep").length, 2);
  page.current = "agents";
  page.nav.get = (id) => ({ agents: { id: "agents", short: "Agents" } })[id] ?? null;
  page.window.dispatchEvent({ type: "mefi:nav" });
  assert.deepEqual(trail.children.filter((node) => node.className.includes("shell-crumb")).map(say), ["Fixture", "Agents"], "only Work's task page has an item");
  page.snapshot = null;
  refresh(page);
  assert.deepEqual(trail.children.filter((node) => node.className.includes("shell-crumb")).map(say), ["Agents"], "no project read yet: no project crumb");
  page.window.MefiBuilder = { view: () => ({ view: "task" }) };
  page.current = "workspace";
  page.nav.get = (id) => ({ workspace: { id: "workspace", label: "Home" } })[id] ?? null;
  page.snapshot = snap();
  page.taskContext = { title: "Open in Build" };
  page.window.dispatchEvent({ type: "mefi:nav" });
  assert.deepEqual(trail.children.filter((node) => node.className.includes("shell-crumb")).map(say), ["Fixture", "Home", "Open in Build"], "Build's task view is an item of Home");
});

test("the Search pill opens the existing palette and closes it when it is open", async () => {
  const page = loadShell({});
  await page.$("shell-search").click();
  assert.deepEqual(page.calls.go.at(-1), ["palette"]);
  page.paletteOpen = true;
  await page.$("shell-search").click();
  assert.deepEqual(page.calls.toggle, ["palette"]);
});

test("the bar says how much room the local navigation has, and whether it is on screen", () => {
  const page = loadShell({ localNav: true });
  const top = page.region("top");
  const [left, , extra, right] = top.children;
  left.getBoundingClientRect = () => ({ width: 170, height: 40 });
  right.getBoundingClientRect = () => ({ width: 200.4, height: 40 });
  extra.getBoundingClientRect = () => ({ width: 0, height: 0 });
  top.getBoundingClientRect = () => ({ width: 900, height: 56 });
  page.window.MefiShell.sync();
  assert.equal(page.props["--frame-top-l"], "182px", "the left end and its gap");
  assert.equal(page.props["--frame-top-r"], "213px", "the right end (rounded up) and its gap");
  assert.equal(top.dataset.local, "on");
  assert.equal(page.root.getAttribute("data-frame-narrow"), null, "900 CSS px is wide enough to share");
  top.getBoundingClientRect = () => ({ width: 560, height: 56 });
  page.window.MefiShell.sync();
  assert.equal(page.root.getAttribute("data-frame-narrow"), "", "a band under 640 CSS px is the bar's alone: the local navigation gives way");
  top.getBoundingClientRect = () => ({ width: 640, height: 56 });
  page.window.MefiShell.sync();
  assert.equal(page.root.getAttribute("data-frame-narrow"), null, "640 shares");
  page.get("app-local-nav").hidden = true;
  page.window.MefiShell.sync();
  assert.equal(top.dataset.local, "off", "a page with no local navigation leaves the row to the trail");
  top.getBoundingClientRect = () => ({ width: 500, height: 56 });
  page.window.MefiShell.sync();
  assert.equal(page.root.getAttribute("data-frame-narrow"), "");
  page.window.MefiShell.disable();
  assert.equal(page.props["--frame-top-l"], undefined);
  assert.equal(page.root.getAttribute("data-frame-narrow"), null, "nothing is left on <html>");
});

test("N need you: the digest's total, else the open questions, else MefiToday's count; one is a singular", () => {
  const page = loadShell({});
  const pill = page.$("shell-need");
  const tone = () => [say(pill), pill.dataset.tone, pill.hidden, pill.getAttribute("aria-label")];
  assert.deepEqual(tone(), ["All clear", "clear", false, "All clear. Open the inbox"]);
  page.snapshot = snap({ assistant: { needsYou: { counts: { total: 3 } }, questions: [{ status: "open" }] } });
  refresh(page);
  assert.deepEqual(tone(), ["3 need you", "need", false, "3 need you. Open the inbox"], "the digest the app already computes");
  page.snapshot = snap({ assistant: { needsYou: { counts: { total: 1 } } } });
  refresh(page);
  assert.deepEqual(tone(), ["1 needs you", "need", false, "1 needs you. Open the inbox"]);
  page.snapshot = snap({ assistant: { questions: [{ status: "open" }, { status: "answered" }, { status: "open" }, null] } });
  refresh(page);
  assert.equal(say(pill), "2 need you", "without a digest, the open questions");
  page.snapshot = snap({ assistant: { needsYou: { counts: { total: 4 } } } });
  page.window.MefiToday = { count: () => 7 };
  refresh(page);
  assert.equal(say(pill), "7 need you", "the inbox module's own count, when it is there, is the one (no second counter)");
  page.window.MefiToday = { count: () => { throw new Error("not ready"); } };
  refresh(page);
  assert.equal(say(pill), "4 need you", "a module that is not ready does not break the bar");
  page.window.MefiToday = { count: () => 0 };
  refresh(page);
  assert.equal(say(pill), "All clear");
  delete page.window.MefiToday;
  page.snapshot = null;
  refresh(page);
  assert.equal(pill.hidden, true, "before Home has read a project there is nothing to say");
  assert.equal(page.$("shell-svc").hidden, true);
  assert.equal(page.$("shell-status").querySelectorAll("[data-item]").filter((node) => !node.hidden).length, 1, "only the Layout button");
});

test("N working: the running jobs, and Paused, Agents off or Idle when that is the truth", () => {
  const page = loadShell({});
  const pill = page.$("shell-svc");
  const now = () => [say(pill), pill.dataset.tone, page.$("shell-pause").getAttribute("aria-label")];
  assert.deepEqual(now(), ["Idle", "idle", "Pause new work"]);
  page.snapshot = snap({ status: { running: [{ id: "a" }, { id: "b" }] } });
  refresh(page);
  assert.deepEqual(now(), ["2 working", "working", "Pause new work"]);
  const table = [
    [{ running: [{ id: "a" }], loop: { state: "running", on: false } }, "Paused", "paused", "Resume new work"],
    [{ running: [], loop: { state: "held" } }, "Agents off", "off", "Start agents"],
    [{ running: [], loop: { state: "running", launchHold: true } }, "Agents off", "off", "Start agents"],
    [{ running: [{ id: "a" }], loop: { state: "running", on: true } }, "1 working", "working", "Pause new work"],
    [{ running: [], held: true }, "Agents off", "off", "Start agents"],
    [{ running: [], execute: false }, "Paused", "paused", "Resume new work"],
    [{ running: [] }, "Idle", "idle", "Pause new work"],
  ];
  for (const [status, words, tone, label] of table) {
    page.snapshot = snap({ status });
    refresh(page);
    assert.deepEqual(now(), [words, tone, label], JSON.stringify(status));
  }
  page.snapshot = snap({ assistant: { status: "paused" } });
  refresh(page);
  assert.equal(pill.dataset.tone, "paused", "the assistant's own pause counts");
  page.snapshot = snap({ assistant: { prefs: { paused: true } } });
  refresh(page);
  assert.equal(pill.dataset.tone, "paused");
  assert.equal(page.$("shell-pause").getAttribute("title"), "Let new work start again.");
});

test("the pause button is Home's own: it clicks #workspace-pause, and goes to Home when that is not there", async () => {
  const page = loadShell({ ids: ["workspace-pause"] });
  const control = page.$("workspace-pause");
  let clicks = 0;
  control.click = () => { clicks += 1; };
  await page.$("shell-pause").click();
  assert.equal(clicks, 1, "one control keeps the rules for a launch hold, a pause and a resume");
  assert.deepEqual(page.calls.go, []);
  control.disabled = true;
  await page.$("shell-pause").click();
  assert.equal(clicks, 1, "a disabled control is not clicked");
  assert.deepEqual(page.calls.go.at(-1), ["workspace"]);
  const bare = loadShell({});
  await bare.$("shell-pause").click();
  assert.deepEqual(bare.calls.go.at(-1), ["workspace"], "without Home's control it takes you there");
});

test("the feed owns no timer and polls nothing: pushes and events are coalesced into one 60 ms paint", () => {
  const pushes = {};
  const api = {};
  for (const name of ["onTasks", "onAssistant", "onAssistantStatus", "onProjects"]) api[name] = (callback) => { pushes[name] = callback; return () => {}; };
  const page = loadShell({ extra: { mefiStudio: api } });
  assert.deepEqual(Object.keys(pushes).sort(), ["onAssistant", "onAssistantStatus", "onProjects", "onTasks"], "it listens to the pushes the page already gets, and to nothing else");
  assert.deepEqual(page.timers, [], "nothing is waiting");
  page.snapshot = snap({ status: { running: [{ id: "a" }] } });
  pushes.onTasks([]);
  pushes.onAssistant({});
  page.window.dispatchEvent({ type: "mefi:usage-report" });
  page.window.dispatchEvent({ type: "mefi:nav-badges" });
  assert.deepEqual(page.timers.map((timer) => timer.delay), [60], "four changes, one timer");
  assert.equal(say(page.$("shell-svc")), "Idle", "not painted yet");
  page.flush();
  assert.equal(say(page.$("shell-svc")), "1 working");
  assert.deepEqual(page.timers, []);
  // Everything the frame listens to while it is on.
  const heard = new Set(page.added);
  for (const type of ["resize", "keydown", "mefi:layout", "mefi:shell", "mefi:nav", "mefi:workspace-state", "mefi:usage-report", "mefi:nav-badges", "mefi:autonomy-changed", "mefi:project-changed", "mefi:task-context", "mefi-music-change", "mefi:companion-state"]) assert.ok(heard.has(type), type);
  // Off, the same events do nothing at all.
  page.window.MefiShell.disable();
  pushes.onTasks([]);
  page.window.dispatchEvent({ type: "mefi:workspace-state" });
  assert.deepEqual(page.timers, [], "a removed frame does not repaint");
});

test("a window nobody can see is not repainted, and is once when it is seen again", () => {
  const page = loadShell({});
  page.document.hidden = true;
  page.snapshot = snap({ status: { running: [{ id: "a" }] } });
  page.window.dispatchEvent({ type: "mefi:workspace-state" });
  page.window.dispatchEvent({ type: "mefi:usage-report" });
  assert.deepEqual(page.timers, [], "no timer for a hidden window");
  assert.equal(say(page.$("shell-svc")), "Idle", "and no paint");
  page.document.hidden = false;
  page.document.body.listeners.visibilitychange.forEach((listener) => listener({ type: "visibilitychange" }));
  assert.deepEqual(page.timers.map((timer) => timer.delay), [60], "seen again: one repaint is scheduled");
  page.flush();
  assert.equal(say(page.$("shell-svc")), "1 working");
  page.document.body.listeners.visibilitychange.forEach((listener) => listener({ type: "visibilitychange" }));
  assert.deepEqual(page.timers, [], "and nothing is repainted for a window that was never hidden");
});

test("the inbox module's own change notice repaints the pill, once it is there to ask", () => {
  const page = loadShell({});
  let notify = null, subscriptions = 0;
  page.window.MefiToday = { count: () => 0, onChange: (callback) => { subscriptions += 1; notify = callback; return () => {}; } };
  assert.equal(subscriptions, 0, "it loads after the frame: nothing yet");
  page.window.dispatchEvent({ type: "mefi:workspace-state" });
  page.flush();
  assert.equal(subscriptions, 1, "asked for at the next paint");
  page.window.dispatchEvent({ type: "mefi:workspace-state" });
  page.flush();
  assert.equal(subscriptions, 1, "and only once");
  page.window.MefiToday.count = () => 3;
  notify();
  assert.deepEqual(page.timers.map((timer) => timer.delay), [60]);
  page.flush();
  assert.equal(say(page.$("shell-need")), "3 need you", "its count is the pill's");
  page.window.MefiShell.disable();
  notify();
  assert.deepEqual(page.timers, [], "a removed frame ignores it");
  const bare = loadShell({ layout: false });
  bare.window.MefiToday = { count: () => 1, onChange: () => { throw new Error("v1 must not subscribe"); } };
  bare.window.dispatchEvent({ type: "mefi:workspace-state" });
  assert.deepEqual(bare.timers, []);
});

test("the frame never reaches for setInterval, and its only timer is the 60 ms coalescer", async () => {
  const source = await readFile(new URL("../renderer/shell.js", import.meta.url), "utf8");
  absent(source, /setInterval|requestIdleCallback|new Worker|fetch\(|XMLHttpRequest|window\.mefiStudio\??\.[a-z][A-Za-z]*\(/, "no poll, no network, no host call made by name");
  const timeouts = [...source.matchAll(/setTimeout\(/g)].length;
  assert.equal(timeouts, 2, "the feed's coalescer and the layout switch's reload delay");
});

test("the need pill and the waiting item open the inbox through MefiShell.onInbox first, then MefiToday, then Work's own views", async () => {
  const page = loadShell({ current: "workspace", snapshot: snap({ assistant: { needsYou: { counts: { total: 2 } }, questions: [{ status: "open" }] } }) });
  const shell = page.window.MefiShell;
  const pill = page.$("shell-need");
  const seen = [];
  shell.onInbox = (anchor) => { seen.push(anchor); return true; };
  await pill.click();
  assert.deepEqual(seen, [pill], "the hook gets the pill it is anchored to");
  assert.deepEqual(page.calls.go, []);
  shell.onInbox = (anchor) => { seen.push(anchor); return false; };
  page.window.MefiToday = { openInbox: (anchor) => { seen.push(["today", anchor]); return true; } };
  await pill.click();
  assert.equal(seen.at(-1)[0], "today", "a hook that declines passes it on");
  shell.onInbox = () => { throw new Error("broken"); };
  page.window.MefiToday = { openInbox: () => false };
  await pill.click();
  assert.deepEqual(page.calls.go.at(-1), ["command", { rail: "ask" }], "a question is waiting: Command's Ask rail");
  shell.onInbox = null;
  delete page.window.MefiToday;
  page.snapshot = snap({ assistant: { needsYou: { counts: { total: 1 } } } });
  refresh(page);
  await pill.click();
  assert.deepEqual(page.calls.go.at(-1), ["tasks", { filter: "review" }], "finished work: the Task board's Review filter");
  page.snapshot = snap();
  refresh(page);
  page.toasts.length = 0;
  assert.equal(shell.openInbox(), false);
  assert.deepEqual(page.toasts, [["Nothing needs you right now.", "good"]], "nothing waits: it says so");
  // Vibe has its own drawer for a decision.
  const opened = [];
  page.window.MefiVibe = { ...page.window.MefiVibe, snapshot: () => ({ needs: [{ kind: "question", id: "q1" }] }), openNeed: (need) => opened.push(need) };
  page.snapshot = snap({ assistant: { needsYou: { counts: { total: 1 } } } });
  refresh(page);
  shell.setMode("vibe");
  await pill.click();
  assert.deepEqual(plain(opened), [{ kind: "question", id: "q1" }]);
  // The status bar's item is the same door, anchored to itself.
  shell.onInbox = (anchor) => { seen.push(anchor); return true; };
  await item(page, "waiting").click();
  assert.equal(seen.at(-1), item(page, "waiting"));
});

test("the status bar holds only real data: nothing is drawn for what no module has", () => {
  const page = loadShell({ snapshot: null });
  const bar = page.region("status");
  assert.deepEqual(bar.querySelectorAll("[data-item]").map((node) => [node.dataset.item, node.hidden]), [["layout", false], ["working", true], ["waiting", true], ["player", true], ["cost", true], ["permission", true]]);
  assert.equal(bar.querySelector(".shell-usage").hidden, true);
  assert.equal(page.window.MefiShell.status().run, null);
  assert.deepEqual(bar.querySelector(".shell-status-extra").children, [], "room for other modules' items");
  // Modules that throw or answer with nothing leave it as it was.
  const quiet = loadShell({ extra: { MefiUsageTracker: { brief: () => { throw new Error("no"); } }, MefiMusic: { status: () => ({}) }, MefiAutonomy: { state: () => null } } });
  assert.deepEqual(quiet.region("status").querySelectorAll("[data-item]").filter((node) => !node.hidden).map((node) => node.dataset.item), ["layout", "working"], "what is running is known; the rest is not");
});

test("the status bar: what is running, what waits on you, and the words for each state", () => {
  const page = loadShell({ snapshot: snap({ status: { running: [{ id: "a" }, { id: "b" }, { id: "c" }] }, assistant: { needsYou: { counts: { total: 2 } } } }) });
  assert.deepEqual([say(item(page, "working")), item(page, "working").dataset.tone, item(page, "working").getAttribute("aria-label")], ["3 working", "working", "3 working"]);
  assert.deepEqual([say(item(page, "waiting")), item(page, "waiting").hidden], ["2 waiting on you", false]);
  assert.equal(item(page, "waiting").getAttribute("aria-label"), "2 waiting on you. Open the inbox");
  page.snapshot = snap({ status: { running: [], loop: { state: "held" } } });
  refresh(page);
  assert.equal(say(item(page, "working")), "Agents off");
  assert.equal(item(page, "waiting").hidden, true, "nothing waits: no item");
  page.snapshot = snap({ status: { running: [{ id: "a" }], execute: false } });
  refresh(page);
  assert.equal(say(item(page, "working")), "Paused");
});

test("the right of the status bar: usage meters, the player, the permission mode and today's cost, each only with data", async () => {
  const windows = [{ short: "5 h", label: "5-hour window", percent: 20 }, { short: "Week", label: "Weekly", percent: 50 }, { short: "Sonnet", label: "Weekly Sonnet", percent: 93 }];
  const extra = {
    MefiUsageTracker: { brief: () => ({ plan: { windows }, today: { costUsd: 1.923 } }) },
    MefiMusic: { status: () => ({ playing: true, title: "Deep Focus" }), toggleAudio() { this.toggled = (this.toggled || 0) + 1; } },
    MefiAutonomy: { state: () => ({ level: "auto" }), label: () => "Auto", openSettings() { this.opened = true; } },
  };
  const page = loadShell({ extra });
  const meters = page.region("status").querySelectorAll(".shell-meter-button");
  assert.equal(meters.length, 2, "two meters: the first window and the one closest to its limit");
  assert.deepEqual(meters.map((node) => node.getAttribute("aria-label")), ["5-hour window 20 percent used", "Weekly Sonnet 93 percent used"]);
  assert.equal(meters[0].dataset.tone, undefined);
  assert.equal(meters[1].dataset.tone, "warn", "90 percent and over is marked");
  assert.equal(meters[1].querySelector(".shell-meter i").style.width, "93%");
  await meters[0].click();
  assert.deepEqual(page.calls.go.at(-1), ["usage"], "a meter opens Usage, which has the detail");
  assert.deepEqual([say(item(page, "player")), item(page, "player").dataset.playing, item(page, "player").hidden], ["Deep Focus", "true", false]);
  await item(page, "player").click();
  assert.equal(page.window.MefiMusic.toggled, 1, "the player pill opens the existing media menu");
  assert.deepEqual([say(item(page, "permission")), item(page, "permission").hidden], ["Auto", false]);
  await item(page, "permission").click();
  assert.equal(page.window.MefiAutonomy.opened, true);
  assert.deepEqual([say(item(page, "cost")), item(page, "cost").hidden], ["$1.92 today", false]);
  await item(page, "cost").click();
  assert.deepEqual(page.calls.go.at(-1), ["usage"]);
  // One window is one meter; a large cost has no cents; no money is no item.
  extra.MefiUsageTracker.brief = () => ({ plan: { windows: [windows[0]] }, today: { costUsd: 240.4 } });
  refresh(page);
  assert.equal(page.region("status").querySelectorAll(".shell-meter-button").length, 1);
  assert.equal(say(item(page, "cost")), "$240 today");
  extra.MefiUsageTracker.brief = () => ({ plan: null, today: { costUsd: null } });
  refresh(page);
  assert.equal(page.region("status").querySelectorAll(".shell-meter-button").length, 0);
  assert.equal(item(page, "cost").hidden, true);
  extra.MefiMusic.status = () => ({ playing: false });
  extra.MefiAutonomy.state = () => ({});
  refresh(page);
  assert.equal(item(page, "player").hidden, true, "nothing loaded: no player");
  assert.equal(item(page, "permission").hidden, true);
  // Without a media menu or a settings opener the pills go where those live.
  const bare = loadShell({ extra: { MefiMusic: { status: () => ({ playing: false, stationName: "Lo-fi" }) }, MefiAutonomy: { state: () => ({ level: "ask" }) } } });
  await item(bare, "player").click();
  assert.deepEqual(bare.calls.go.at(-1), ["audio"]);
  await item(bare, "permission").click();
  assert.deepEqual(bare.calls.go.at(-1), ["agents", { section: "setup" }]);
  assert.equal(say(item(bare, "permission")), "ask", "with no label() the level is the words");
});

test("the permission mode is read once when it is not there yet, and after that only pushes bring it", async () => {
  let refreshed = 0;
  const autonomy = { state: () => null, refresh: async () => { refreshed += 1; autonomy.state = () => ({ level: "auto" }); }, label: () => "Auto" };
  const page = loadShell({ extra: { MefiAutonomy: autonomy } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(refreshed, 1, "one read");
  assert.equal(say(item(page, "permission")), "Auto");
  page.window.dispatchEvent({ type: "mefi:autonomy-changed" });
  page.flush();
  assert.equal(refreshed, 1, "not again");
  let asked = 0;
  const known = loadShell({ extra: { MefiAutonomy: { state: () => ({ level: "auto" }), refresh: async () => { asked += 1; } } } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(say(item(known, "permission")), "auto");
  assert.equal(asked, 0, "a mode that is already there is not read again");
});

test("the Layout menu: switches for the list, the inspector and the tab strip, each mode's widths, Reset layout and the way to Size and density", async () => {
  const page = loadShell({ registry: { worktrees: { id: "worktrees", label: "Worktrees" } } });
  const shell = page.window.MefiShell;
  const button = item(page, "layout");
  assert.equal(button.getAttribute("aria-expanded"), "false");
  assert.equal(button.getAttribute("aria-haspopup"), "dialog");
  button.focus();
  await button.click();
  const menu = page.$("shell-menu");
  assert.equal(menu.getAttribute("role"), "dialog");
  assert.equal(menu.getAttribute("aria-label"), "Layout");
  assert.equal(button.getAttribute("aria-expanded"), "true");
  assert.match(say(menu), /Build mode/);
  const switches = menu.querySelectorAll('[role="switch"]');
  assert.deepEqual(switches.map((node) => [node.dataset.key, node.getAttribute("aria-checked")]), [["list", "true"], ["inspector", "true"], ["tabs", "true"]]);
  await switches[0].click();
  assert.equal(shell.isOpen("list"), false);
  assert.equal(switches[0].getAttribute("aria-checked"), "false", "the switch follows what it did");
  await switches[2].click();
  assert.equal(shell.isOpen("tabs"), false);
  await switches[2].click();
  assert.equal(shell.isOpen("tabs"), true);
  const grid = menu.querySelector(".shell-menu-grid");
  assert.deepEqual(grid.children.map(say), ["", "Build", "Vibe", "List", "closed", "closed", "Inspector", "388 px", "closed"], "both modes' layouts side by side: Build's list was just closed");
  shell.resize("inspector", 500);
  assert.equal(say(menu.querySelector(".shell-menu-grid").children[7]), "500 px", "and it follows a resize");
  // The buttons at the foot.
  const labels = menu.querySelectorAll(".shell-action").map(say);
  assert.deepEqual(labels, ["Reset layout", "Size and density", "Worktrees"]);
  await menu.querySelectorAll(".shell-action")[1].click();
  assert.deepEqual(page.calls.go.at(-1), ["config", { category: "ui" }], "until the size page says how to open it, the scale lives in Configuration");
  assert.equal(page.$("shell-menu"), null, "a choice closes the menu");
  await button.click();
  await page.$("shell-menu").querySelectorAll(".shell-action")[2].click();
  assert.deepEqual(page.calls.go.at(-1), ["worktrees"]);
  await button.click();
  await page.$("shell-menu").querySelectorAll(".shell-action")[0].click();
  assert.equal(shell.isOpen("list"), true, "Reset layout put Build's preset back");
  assert.equal(page.toasts.at(-1)[0].startsWith("Layout reset for Build"), true);
  assert.equal(page.document.activeElement, button, "and focus is back on the Layout button");
});

test("the Layout menu opens the size page by whichever way it is reachable, and lists Worktrees only when there are some", async () => {
  const plainPage = loadShell({});
  await item(plainPage, "layout").click();
  assert.deepEqual(plainPage.$("shell-menu").querySelectorAll(".shell-action").map(say), ["Reset layout", "Size and density"], "no Worktrees destination: no button");
  const opened = [];
  const withModule = loadShell({ extra: { MefiSize: { open: () => opened.push("module") } }, registry: { size: { id: "size" } } });
  await item(withModule, "layout").click();
  await withModule.$("shell-menu").querySelectorAll(".shell-action")[1].click();
  assert.deepEqual(opened, ["module"], "MefiSize.open first");
  const registered = loadShell({ registry: { size: { id: "size" } } });
  await item(registered, "layout").click();
  await registered.$("shell-menu").querySelectorAll(".shell-action")[1].click();
  assert.deepEqual(registered.calls.go.at(-1), ["size"], "then the registered page");
});

test("the Layout menu closes on Escape, on a press outside, on the button again and on going somewhere; a press inside keeps it", async () => {
  const page = loadShell({ mode: "vibe" });
  const button = item(page, "layout");
  const open = async () => { button.focus(); if (!page.$("shell-menu")) await button.click(); return page.$("shell-menu"); };
  let menu = await open();
  assert.match(say(menu), /Vibe mode/, "the menu says which mode's layout it is changing");
  assert.deepEqual(menu.querySelector(".shell-menu-grid").children.map(say), ["", "Build", "Vibe", "List", "280 px", "closed", "Inspector", "388 px", "closed"]);
  await page.press(menu.querySelector(".shell-menu-head"));
  assert.ok(page.$("shell-menu"), "a press inside the menu keeps it");
  await page.press(button);
  assert.ok(page.$("shell-menu"), "the button's own press is its click's business");
  await page.press(page.region("main"));
  assert.equal(page.$("shell-menu"), null, "a press anywhere else closes it");
  assert.equal(button.getAttribute("aria-expanded"), "false");
  menu = await open();
  page.key({ key: "Escape" });
  assert.equal(page.$("shell-menu"), null);
  assert.equal(page.document.activeElement, button);
  await open();
  await button.click();
  assert.equal(page.$("shell-menu"), null, "the button toggles");
  await open();
  page.window.dispatchEvent({ type: "mefi:nav" });
  assert.equal(page.$("shell-menu"), null, "going somewhere closes it");
  await open();
  page.window.MefiShell.setMode("build");
  assert.equal(page.$("shell-menu"), null, "so does a change of mode");
  await open();
  page.window.MefiShell.disable();
  assert.equal(page.$("shell-menu"), null, "and taking the frame away");
});

test("the Layout menu keeps its own Escape: a key pressed inside it closes it and goes no further", async () => {
  const page = loadShell({});
  await item(page, "layout").click();
  const menu = page.$("shell-menu");
  const event = { key: "Escape", preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
  menu.listeners.keydown[0](event);
  assert.ok(event.prevented && event.stopped);
  assert.equal(page.$("shell-menu"), null);
});
