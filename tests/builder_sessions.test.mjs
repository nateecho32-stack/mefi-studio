// Build's Home as a coding-agent desktop (renderer/builder.js). The menu lists
// the project's work the way the desktop coding apps list sessions: Chat with
// Mefi, Pinned, Needs you, Working, then the rest by the day each last moved.
// A task opens as a session; the composer's bottom row keeps to one line; and
// the classic Home stays exactly as it was unless the owner turns this layout
// on. The real panes.js and builder.js run here in the shared fake DOM
// (tests/fixtures/builder-env.mjs), against a stand-in workspace, navigation
// and bridge; real geometry belongs to the Electron fixtures.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createEnv, createPage, PAGE_IDS, PAGE_CLASSES } from "./fixtures/builder-env.mjs";
import { templateHasId } from "./fixtures/renderer-dom.mjs";

const LAYOUT = "mefiStudio.homeLayout";
const PANES = "mefiStudio.panes.v1";
const clean = (value) => JSON.parse(JSON.stringify(value));

// Wednesday 15 July 2026, 14:30 local: every clock and every "days ago" below
// starts here, so nothing waits on or reads the wall clock.
const NOW = new Date(2026, 6, 15, 14, 30).getTime();
const at = (daysAgo, hour = 12, minute = 0) => new Date(2026, 6, 15 - daysAgo, hour, minute).getTime();

// The workspace's rows are shared by every listener and readers never edit them:
// the rows handed to the builder are frozen, so a write to one throws in its
// strict-mode script instead of passing quietly.
const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); }
  return value;
};
const task = (id, extra = {}) => ({ id, projectId: "p1", title: `Task ${id}`, prompt: `Do ${id}`, status: "open", createdAt: at(30), updatedAt: at(30), ...extra });
const LABELS = { running: "Working", review: "Checking", blocked: "Blocked", approval: "Needs approval", waiting: "Waiting", done: "Done", ready: "Ready to start" };
const summary = (stage) => ({ stage, label: LABELS[stage] ?? stage, checks: "No completion checks recorded", worker: "", action: "", activityAge: "", blocker: "", nextAction: "" });

/** The page, a stand-in workspace / navigation / bridge, and the two scripts loaded as the booklet loads them. */
async function makeApp({ search = "", storage = new Map(), saved = null, active = true, vibe = "build", tasks = [], stages = {}, questions = [], running = [], messages = [], backlog = null, preview = null, bridge = undefined, panes = true, worktrees = null } = {}) {
  if (saved) storage.set(LAYOUT, saved);
  for (const rows of [tasks, questions, running, messages]) rows.forEach(deepFreeze);
  const env = createEnv({ search, storage, now: NOW });
  const page = createPage(env);
  const calls = { go: [], toasts: [], registered: [], composerMode: [], selected: [], saveResume: 0, refresh: 0 };
  const state = {
    active, stages, vibe,
    data: { projectId: "p1", project: { id: "p1", name: "Snake trial", path: "/work/snake" }, projects: [], tasks, ideas: [], assistant: { messages, questions }, status: { running }, backlog, preview, mode: "work", pending: false },
  };
  const { window } = env;
  window.MefiVibe = { mode: () => state.vibe };
  window.MefiNav = {
    register: (destination) => calls.registered.push(destination),
    go: (...args) => calls.go.push(args),
    historyState: () => ({ canBack: false, canForward: false }),
    taskContext: () => null,
    selectTask: (value) => calls.selected.push(value),
    saveResume: () => { calls.saveResume += 1; },
    back() {}, forward() {},
  };
  window.MefiWorkspace = {
    isActive: () => state.active,
    snapshot: () => state.data,
    setComposerMode: (mode) => calls.composerMode.push(mode),
    refresh: () => { calls.refresh += 1; },
  };
  window.MefiTasks = {
    workflowSummary: (item) => summary(state.stages[item.id] ?? (item.status === "done" ? "done" : "ready")),
    shortTitle: (item) => String(item.title || item.prompt || "").slice(0, 60),
  };
  window.MefiToast = (message, kind) => calls.toasts.push([message, kind]);
  if (bridge) window.mefiStudio = bridge;
  if (worktrees) window.MefiWorktrees = worktrees;
  if (panes) await env.load("panes.js");
  await env.load("builder.js");
  const B = window.MefiBuilder;
  return { env, page, state, calls, B, storage, window, document: env.document };
}

const ownKeys = (storage) => [...storage.keys()].filter((key) => /homeLayout|builder|panes/.test(key));

test("the mirrored page matches the real template, so these suites cannot drift from it", async () => {
  const template = await readFile(new URL("../renderer/booklet.template.html", import.meta.url), "utf8");
  for (const id of PAGE_IDS) assert.ok(templateHasId(id), `the template has #${id}`);
  for (const name of PAGE_CLASSES) assert.match(template, new RegExp(`class="[^"]*\\b${name}\\b[^"]*"`), `the template has .${name}`);
  // The composer's bottom row, in the template's own order.
  assert.match(template, /<div class="ws-compose-bottom"><span id="workspace-compose-hint">[^<]*<\/span><button id="workspace-task-outline"[^>]*hidden[^>]*>[^<]*<\/button><button id="workspace-plan-idea"[^>]*>[^<]*<\/button><button id="workspace-send"/);
  const page = createPage(createEnv());
  assert.deepEqual(page.bottomIds(), ["workspace-compose-hint", "workspace-task-outline", "workspace-plan-idea", "workspace-send"]);
});

// ---- which layout a launch gets ------------------------------------------------

test("the classic Home is the default: nothing saved and no parameter gives classic, in every kind of launch", async () => {
  // main.cjs opens the window with ?capture=0&smoke=0 for an ordinary launch.
  for (const search of ["", "?capture=0&smoke=0", "?smoke=0", "?capture=0", "?x=1", "?capture=10", "?home="]) {
    const app = await makeApp({ search });
    assert.equal(app.B.layout(), "classic", `${JSON.stringify(search)} is classic`);
    assert.equal(app.B.active(), false);
  }
  // The diagnostic launches the render fixtures and screenshots use.
  for (const search of ["?capture=1", "?smoke=1", "?capture=1&smoke=0", "?capture=0&smoke=1", "?smoke=1&capture=1"]) {
    const app = await makeApp({ search });
    assert.equal(app.B.layout(), "classic", `${search} keeps the classic Home`);
  }
  const app = await makeApp({ saved: "classic" });
  assert.equal(app.B.layout(), "classic", "a saved classic is classic");
  assert.equal((await makeApp({ saved: "nonsense" })).B.layout(), "classic", "a saved value that means nothing is the default");
  assert.equal((await makeApp({ saved: "" })).B.layout(), "classic");
});

test("the sessions layout switches on by a saved choice or ?home=sessions, and ?home=classic always switches it off", async () => {
  const cases = [
    ["", "sessions", "sessions", "a saved choice turns it on"],
    ["?home=sessions", null, "sessions", "one launch can ask for it"],
    ["?home=sessions", "classic", "sessions", "the parameter outranks what was saved"],
    ["?home=classic", "sessions", "classic", "?home=classic is the way back out of a bad layout"],
    ["?home=bogus", "sessions", "sessions", "a parameter that means nothing is ignored"],
    ["?home=bogus", null, "classic", "and leaves the default"],
    ["?capture=1&home=sessions", null, "sessions", "a diagnostic launch can still ask for it"],
    ["?smoke=1&home=sessions", null, "sessions", "a diagnostic launch can still ask for it"],
    ["?capture=1&home=classic", "sessions", "classic", "and can insist on the classic Home"],
  ];
  for (const [search, saved, expected, why] of cases) {
    const app = await makeApp({ search, saved });
    assert.equal(app.B.layout(), expected, `${JSON.stringify(search)} + saved ${saved}: ${why}`);
    assert.equal(app.B.active(), false, "and the layout only counts as active once Home has adopted it");
  }
});

// ---- the classic Home stays untouched ------------------------------------------

test("the classic layout leaves the page, the rail and storage exactly as they were, and wires nothing", async () => {
  const cases = [["a bare launch", {}], ["a saved classic", { saved: "classic" }], ["?capture=1", { search: "?capture=1" }], ["?smoke=1", { search: "?smoke=1" }], ["?home=classic over a saved sessions", { search: "?home=classic", saved: "sessions" }]];
  for (const [name, options] of cases) {
    const storage = new Map();
    // Before the scripts run, take the page's own picture: every id in its row, and the rail's children.
    const env = createEnv({ search: options.search ?? "", storage, now: NOW });
    const before = createPage(env);
    const rowBefore = before.bottomIds();
    const sectionsBefore = before.sections.children.length, footBefore = before.foot.children.length, contentBefore = before.content.children.length;
    if (options.saved) storage.set(LAYOUT, options.saved);
    const listenersBefore = { state: env.listeners("mefi:workspace-state"), nav: env.listeners("mefi:nav"), shell: env.listeners("mefi:shell"), project: env.listeners("mefi:project-changed"), panes: env.listeners("mefi:panes") };
    const registered = [];
    const bridgeCalls = [];
    env.window.MefiVibe = { mode: () => "build" };
    env.window.MefiNav = { register: (destination) => registered.push(destination), go() {}, historyState: () => ({}), taskContext: () => null };
    env.window.MefiWorkspace = { isActive: () => true, snapshot: () => ({ projectId: "p1", tasks: [task("a")], assistant: {}, status: {} }), setComposerMode() {}, refresh() {} };
    env.window.mefiStudio = new Proxy({}, { get: (_target, name) => { bridgeCalls.push(String(name)); return undefined; } });
    await env.load("panes.js");
    await env.load("builder.js");
    const B = env.window.MefiBuilder;

    assert.equal(B.layout(), "classic", name);
    assert.equal(B.active(), false, name);
    // Even with Home on screen and everything nudging it, nothing paints.
    env.emit("mefi:workspace-state"); env.emit("mefi:nav", { id: "workspace", action: "open", params: { view: "task", taskId: "a" } }); env.emit("mefi:shell"); env.emit("mefi:project-changed");
    B.refresh();
    env.flush();

    assert.deepEqual(before.bottomIds(), rowBefore, `${name}: the composer's row is the template's, in its order`);
    assert.equal(before.outline.parentNode, before.bottom, `${name}: "Use a task outline" stays in the row`);
    assert.equal(before.plan.parentNode, before.bottom, `${name}: so does "Plan an idea"`);
    assert.equal(env.document.getElementById("builder-more"), null, `${name}: there is no "+" menu`);
    assert.equal(before.sections.children.length, sectionsBefore, `${name}: the rail's sections are unchanged`);
    assert.equal(before.foot.children.length, footBefore);
    assert.equal(before.content.children.length, contentBefore, `${name}: Home's content has no session area`);
    assert.equal(env.document.getElementById("builder-home"), null);
    assert.equal(env.document.getElementById("builder-chips"), null);
    assert.equal(env.document.getElementById("builder-task-compose"), null);
    assert.equal(env.document.getElementById("app-rail-sessions"), null);
    assert.equal(env.document.getElementById("app-rail-person"), null);
    assert.equal(env.document.querySelector(".builder-mode-switch"), null);
    assert.equal(env.document.querySelector(".pane"), null, `${name}: no pane was built`);
    assert.deepEqual(clean(env.window.MefiPanes.list()), [], `${name}: no pane was registered`);
    assert.equal(env.document.documentElement.dataset.homeLayout, undefined, `${name}: html carries no layout mark`);
    assert.equal(env.document.documentElement.dataset.railSessions, undefined);
    assert.equal(env.document.getElementById("workspace-layer").dataset.view, undefined);

    // The rail hooks nav.js calls answer "not mine", so nav paints its own list.
    assert.equal(B.ownsRail(), false);
    assert.equal(B.paintRail(), false, `${name}: paintRail() tells nav.js to draw the classic recent list`);
    assert.equal(B.decorateRail({ sections: before.sections, foot: before.foot }), undefined);
    assert.equal(before.sections.children.length, sectionsBefore, `${name}: decorating adds nothing`);
    assert.equal(before.foot.children.length, footBefore);

    // Nothing was wired: no listener, timer, frame or stored key, and the bridge was never asked.
    assert.deepEqual({ state: env.listeners("mefi:workspace-state"), nav: env.listeners("mefi:nav"), shell: env.listeners("mefi:shell"), project: env.listeners("mefi:project-changed"), panes: env.listeners("mefi:panes") }, listenersBefore, `${name}: no window listener`);
    assert.equal(env.intervals.length, 0, `${name}: no timer`);
    assert.equal(env.timeouts.length, 0);
    assert.equal(env.frames.length, 0, `${name}: no frame`);
    assert.deepEqual(bridgeCalls, [], `${name}: no host call`);
    assert.deepEqual(ownKeys(storage).filter((key) => key !== LAYOUT), [], `${name}: no stored key`);
    assert.equal(storage.has(PANES), false);

    // The one thing it does register is Search's way in.
    assert.deepEqual(registered.map((destination) => destination.id), ["home-layout"], `${name}: Search can switch the layout`);
    assert.match(registered[0].label, /Switch Home layout/);
    assert.equal(registered[0].kind, "action");
  }
});

test("Search's Switch Home layout saves the other choice and reloads, and only from one layout to the other", async () => {
  const classic = await makeApp();
  const action = classic.calls.registered.find((destination) => destination.id === "home-layout");
  assert.ok(action, "the action is there in the classic layout too, or nobody could turn the layout on");
  action.run();
  assert.equal(classic.storage.get(LAYOUT), "sessions");
  assert.deepEqual(classic.calls.toasts.at(-1), ["Home opens as a task list with panes.", "info"]);
  assert.equal(classic.window.reloaded, undefined, "the reload waits a beat so the toast can be seen");
  classic.env.flush();
  assert.equal(classic.calls.saveResume, 1, "the page's place is saved first");
  assert.equal(classic.window.reloaded, 1, "and the page reloads into the other layout");

  const sessions = await makeApp({ saved: "sessions" });
  sessions.calls.registered.find((destination) => destination.id === "home-layout").run();
  assert.equal(sessions.storage.get(LAYOUT), "classic");
  assert.deepEqual(sessions.calls.toasts.at(-1), ["Home goes back to the single page.", "info"]);
  sessions.env.flush();
  assert.equal(sessions.window.reloaded, 1);

  // A blocked profile cannot save the choice, but the switch does not throw.
  const blocked = createEnv({ throwing: true, now: NOW });
  createPage(blocked);
  blocked.window.MefiNav = { register() {}, go() {}, saveResume() {} };
  await blocked.load("builder.js");
  assert.doesNotThrow(() => blocked.window.MefiBuilder.setLayout("sessions"));
  assert.equal(blocked.window.MefiBuilder.layout(), "classic");
});

test("the workspace only hands New task, a task and a change request to the builder while it is active", async () => {
  const source = await readFile(new URL("../renderer/workspace.js", import.meta.url), "utf8");
  // Each of the three hand-offs is gated on the builder saying it is active, so
  // a classic Home never reaches into it (see tests/workspace_ui.test.mjs for the behaviour).
  assert.equal([...source.matchAll(/window\.MefiBuilder\?\.active\?\.\(\)/g)].length, 3);
  assert.match(source, /if \(window\.MefiBuilder\?\.active\?\.\(\)\) \{ window\.MefiBuilder\.openTask\(task\.id, \{ pane: tab === "evidence" \? "checks" : null \}\); return; \}/);
  assert.match(source, /if \(window\.MefiBuilder\?\.active\?\.\(\)\) \{ window\.MefiBuilder\.newTask\(\); return; \}/);
  assert.match(source, /if \(window\.MefiBuilder\?\.active\?\.\(\)\) return window\.MefiBuilder\.requestChange\(task\);/);
  // And the rail hooks in nav.js: the menu decorates only when the builder owns it.
  const nav = await readFile(new URL("../renderer/nav.js", import.meta.url), "utf8");
  assert.match(nav, /if \(window\.MefiBuilder\?\.paintRail\?\.\(\)\) return;\s*\n\s*const list = document\.getElementById\("app-rail-recent-list"\);/, "paintRecentTasks defers to the builder's list, and only when it painted one");
  assert.match(nav, /window\.MefiBuilder\?\.decorateRail\?\.\(\{ sections, foot \}\);\s*\n\s*paintBadges\(/, "renderRail hands the builder the sections and the foot");
});

// ---- the menu's groups ---------------------------------------------------------

// One board with a task in every kind of place the menu has to put it.
function board() {
  return [
    task("pinned-old", { status: "done", updatedAt: at(20), doneAt: at(20) }),                     // pinned: first, whatever it did
    task("asks-q", { updatedAt: at(1) }),                                                        // an open question names it
    task("asks-blocked", { updatedAt: at(2) }),
    task("asks-approval", { updatedAt: at(0, 8) }),
    task("runs", { status: "active", runId: "run-1", updatedAt: at(0, 13) }),
    task("checks", { status: "awaiting_verification", updatedAt: at(0, 9) }),
    task("today-a", { updatedAt: at(0, 9) }),
    task("today-b", { updatedAt: at(0, 12) }),
    task("yesterday", { updatedAt: at(1, 16) }),
    task("d3", { updatedAt: at(3) }),
    task("d6", { updatedAt: at(6) }),
    task("d8-done", { status: "done", updatedAt: at(8), doneAt: at(8) }),
    task("d30-open", { updatedAt: at(30) }),
    task("old-done-1", { status: "done", updatedAt: at(15), doneAt: at(15) }),
    task("old-done-2", { status: "done", updatedAt: at(40), doneAt: at(40) }),
    task("moved-again", { createdAt: at(50), updatedAt: at(50), lastAttempt: { at: at(0, 10) } }),  // a run today brings it to Today
    task("archived", { status: "archived", updatedAt: at(0) }),                                   // never listed
    { ...task("flagged"), archived: true },
    { title: "no id" },
    null,
  ].filter((row) => row !== null);
}
const STAGES = { "asks-blocked": "blocked", "asks-approval": "approval", runs: "running", checks: "review", "today-b": "waiting" };
const QUESTIONS = [{ id: "q1", status: "open", context: { taskId: "asks-q" }, question: "Which palette?", options: [] }, { id: "q2", status: "answered", context: { taskId: "today-a" } }];
const weekday = (daysAgo) => new Date(at(daysAgo)).toLocaleDateString([], { weekday: "long" });
const dated = (daysAgo) => new Date(at(daysAgo)).toLocaleDateString([], { month: "short", day: "numeric" });

test("the menu groups: Pinned, Needs you, Working, then by the day each last moved, and long-finished work folds into Older", async () => {
  const app = await makeApp({ saved: "sessions", tasks: board(), stages: STAGES, questions: QUESTIONS });
  const view = (found) => clean(found.map((group) => [group.title, group.rows.map((row) => row.id)]));
  const groups = app.B.groups(app.state.data.tasks, { now: NOW, pinned: new Set(["pinned-old"]), data: app.state.data });
  assert.deepEqual(view(groups), [
    ["Pinned", ["pinned-old"]],
    ["Needs you", ["asks-approval", "asks-q", "asks-blocked"]],                              // a decision, an approval, a block: newest first
    ["Working", ["runs", "checks"]],                                                          // running and being checked
    ["Today", ["today-b", "moved-again", "today-a"]],                                         // the latest run moved it, not its old update
    ["Yesterday", ["yesterday"]],
    [weekday(3), ["d3"]],                                                                     // this week: the weekday
    [weekday(6), ["d6"]],
    [dated(8), ["d8-done"]],                                                                  // last week: the date
    [dated(30), ["d30-open"]],                                                                // unfinished work is never folded away
    ["Older", ["old-done-1", "old-done-2"]],                                                  // finished more than two weeks ago
  ]);
  assert.deepEqual(clean(groups.map((group) => group.key)), ["pinned", "needs", "working", "today", "yesterday", `day:${new Date(at(3)).setHours(0, 0, 0, 0)}`, `day:${new Date(at(6)).setHours(0, 0, 0, 0)}`, `day:${new Date(at(8)).setHours(0, 0, 0, 0)}`, `day:${new Date(at(30)).setHours(0, 0, 0, 0)}`, "older"]);
  const flat = groups.flatMap((group) => group.rows.map((row) => row.id));
  for (const missing of ["archived", "flagged"]) assert.ok(!flat.includes(missing), `${missing} is not listed`);
  assert.equal(flat.length, 16, "every listed task appears once");
  assert.equal(new Set(flat).size, 16);
});

test("what each task is doing: a question, a block or an approval need you; a run or a check is working", async () => {
  const app = await makeApp({ saved: "sessions", tasks: board(), stages: STAGES, questions: QUESTIONS });
  const read = (id) => app.B.reading(app.state.data.tasks.find((row) => row.id === id), app.state.data);
  assert.deepEqual([read("asks-q").tone, read("asks-q").label], ["ask", "Needs your answer"], "an open question outranks the task's own stage");
  assert.equal(read("asks-q").question.id, "q1");
  assert.equal(read("asks-blocked").tone, "ask");
  assert.equal(read("asks-approval").tone, "ask");
  assert.equal(read("runs").tone, "run");
  assert.equal(read("checks").tone, "check");
  assert.equal(read("today-b").tone, "wait");
  assert.equal(read("today-a").tone, "ready", "an answered question does not hold it");
  assert.equal(read("d8-done").tone, "done");
  assert.equal(app.B.reading({ ...task("gone"), status: "done", dropped: { at: at(1) } }, app.state.data).tone, "dropped");
  // A task the shared summary has no word for reads from its own status.
  app.state.stages.solo = null;
  app.window.MefiTasks.workflowSummary = () => null;
  assert.equal(read("runs").tone, "run", "an active task with no summary still reads as running");
  assert.equal(read("checks").tone, "check");
  assert.equal(read("today-a").tone, "ready");
  assert.equal(read("d8-done").tone, "done");
});

test("a pinned task goes first whatever else it is, and a day heading is decided by the day the task last moved", async () => {
  const app = await makeApp({ saved: "sessions", tasks: board(), stages: STAGES, questions: QUESTIONS });
  const groups = (pinned) => app.B.groups(app.state.data.tasks, { now: NOW, pinned: new Set(pinned), data: app.state.data });
  assert.deepEqual(clean(groups(["runs", "asks-q", "yesterday"])[0].rows.map((row) => row.id)), ["runs", "yesterday", "asks-q"], "pins of any kind head the list, newest first");
  assert.ok(!groups(["runs"]).some((group) => group.key === "working" && group.rows.some((row) => row.id === "runs")), "and leave the group they came from");
  assert.equal(groups([]).some((group) => group.key === "pinned"), false, "no pins, no Pinned heading");
  // A day at the edge: late last night is Yesterday, early this morning is Today.
  const edge = [task("late", { updatedAt: at(1, 23, 59) }), task("early", { updatedAt: at(0, 0, 5) })];
  const found = app.B.groups(edge, { now: NOW, pinned: new Set(), data: app.state.data });
  assert.deepEqual(clean(found.map((group) => [group.title, group.rows.map((row) => row.id)])), [["Today", ["early"]], ["Yesterday", ["late"]]]);
  // A task with no time at all reads as moved now.
  const undated = app.B.groups([{ id: "u", title: "Undated", status: "open" }], { now: NOW, pinned: new Set(), data: app.state.data });
  assert.equal(undated[0].title, "Today");
  // Two weeks is the line: at fourteen days a finished task folds, at thirteen it keeps its date.
  const line = app.B.groups([task("thirteen", { status: "done", updatedAt: at(13), doneAt: at(13) }), task("fourteen", { status: "done", updatedAt: at(14), doneAt: at(14) })], { now: NOW, pinned: new Set(), data: app.state.data });
  assert.deepEqual(clean(line.map((group) => [group.title, group.rows.map((row) => row.id)])), [[dated(13), ["thirteen"]], ["Older", ["fourteen"]]]);
});

// ---- the menu on screen ----------------------------------------------------------

// The list as a reader sees it: a "# Heading" for each heading, then the rows.
const menuOf = (app) => app.document.getElementById("app-rail-sessions").children.map((node) => {
  if (node.classList.contains("builder-group")) return `# ${node.textContent}`;
  if (node.classList.contains("builder-sessions-head")) return "[head]";
  if (node.classList.contains("builder-older")) return `[older] ${node.textContent}`;
  if (node.dataset.key) return `${node.dataset.key}/${node.dataset.tone}`;
  return `<${node.tagName}> ${node.textContent}`;
});

test("the menu: the mode switch on top, then Chat with Mefi, Pinned, Needs you, Working and the days, with your name at the foot", async () => {
  const storage = new Map([["mefiStudio.builder.pins.p1", JSON.stringify(["pinned-old"])], ["mefiStudio.workspace.person", "Nate"]]);
  const app = await makeApp({ saved: "sessions", storage, tasks: board(), stages: STAGES, questions: QUESTIONS, running: [{ taskId: "runs", runId: "run-1" }] });
  const { page } = app;
  assert.equal(app.document.documentElement.dataset.railSessions, "", "the rail marks itself as the sessions menu");

  const first = page.sections.children[0];
  assert.ok(first.classList.contains("builder-mode-switch"), "the Vibe | Build switch heads the menu");
  assert.equal(first.getAttribute("role"), "radiogroup");
  const radios = first.querySelectorAll("button");
  assert.deepEqual(radios.map((radio) => [radio.dataset.uiMode, radio.getAttribute("aria-checked"), radio.getAttribute("role")]), [["vibe", "false", "radio"], ["build", "true", "radio"]]);
  assert.equal(page.sections.children.at(-1).id, "app-rail-sessions", "and the work list follows Home and the rest of the menu");

  assert.deepEqual(menuOf(app), [
    "[head]",
    "__chat/chat",
    "# Pinned", "pinned-old/done",
    "# Needs you", "asks-approval/ask", "asks-q/ask", "asks-blocked/ask",
    "# Working", "runs/run", "checks/check",
    "# Today", "today-b/wait", "moved-again/ready", "today-a/ready",
    "# Yesterday", "yesterday/ready",
    `# ${weekday(3)}`, "d3/ready",
    `# ${weekday(6)}`, "d6/ready",
    `# ${dated(8)}`, "d8-done/done",
    `# ${dated(30)}`, "d30-open/ready",
    "[older] Older · 2",
  ]);
  const list = app.document.getElementById("app-rail-sessions");
  const head = list.children[0];
  assert.equal(head.querySelector(".app-rail-heading").textContent, "Tasks");
  const chat = list.children[1];
  assert.equal(chat.querySelector(".label").textContent, "Chat with Mefi");
  assert.equal(chat.title, "Chat with Mefi · Conversation");
  const pinned = list.querySelector('[data-key="pinned-old"]');
  assert.equal(pinned.getAttribute("aria-label"), "Task pinned-old. Done. Pinned");
  assert.ok(pinned.querySelector(".builder-pinned"), "a pinned row carries its pin");
  const asks = list.querySelector('[data-key="asks-q"]');
  assert.equal(asks.getAttribute("aria-label"), "Task asks-q. Needs your answer");
  assert.equal(asks.title, "Task asks-q · Needs your answer");

  // You, at the foot: your initial, and what needs you now.
  const chip = page.foot.children[0];
  assert.equal(chip.id, "app-rail-person");
  assert.equal(chip.querySelector(".builder-avatar").textContent, "N");
  assert.deepEqual([chip.querySelector("b").textContent, chip.querySelector("small").textContent, chip.dataset.tone], ["Nate", "1 needs you", "ask"]);
});

test("the foot names what needs you, else what is working, else the project", async () => {
  const quiet = await makeApp({ saved: "sessions", tasks: [task("a")] });
  const chip = (app) => app.page.foot.children[0];
  assert.deepEqual([chip(quiet).querySelector(".builder-avatar").textContent, chip(quiet).querySelector("b").textContent, chip(quiet).querySelector("small").textContent, chip(quiet).dataset.tone], ["Y", "You", "Snake trial", "quiet"]);
  const busy = await makeApp({ saved: "sessions", tasks: [task("a")], running: [{ taskId: "a" }, { taskId: "b" }] });
  assert.deepEqual([chip(busy).querySelector("small").textContent, chip(busy).dataset.tone], ["2 agents working", "run"]);
  const one = await makeApp({ saved: "sessions", tasks: [task("a")], running: [{ taskId: "a" }] });
  assert.equal(chip(one).querySelector("small").textContent, "1 agent working");
  const asked = await makeApp({ saved: "sessions", tasks: [task("a")], running: [{ taskId: "a" }], questions: [{ id: "q", status: "open" }, { id: "r", status: "open" }] });
  assert.deepEqual([chip(asked).querySelector("small").textContent, chip(asked).dataset.tone], ["2 need you", "ask"], "a question outranks a run");
});

test("a row opens its task as a session, and the menu marks the one on screen", async () => {
  const app = await makeApp({ saved: "sessions", tasks: board(), stages: STAGES, questions: QUESTIONS });
  const row = (key) => app.document.getElementById("app-rail-sessions").querySelector(`[data-key="${key}"]`);
  assert.deepEqual(clean(app.B.view()), { view: "home", taskId: null });
  await row("today-a").click();
  assert.deepEqual(clean(app.calls.selected), [{ taskId: "today-a", projectId: "p1", title: "Task today-a" }], "the task becomes the one Home follows");
  assert.deepEqual(clean(app.calls.go.at(-1)), ["workspace", { view: "task", taskId: "today-a", projectId: "p1" }]);
  assert.deepEqual(clean(app.B.view()), { view: "task", taskId: "today-a" });
  assert.equal(JSON.parse(app.storage.get("mefiStudio.builder.view.p1")).taskId, "today-a", "and it is remembered for the next launch");
  app.env.flush();
  assert.equal(row("today-a").getAttribute("aria-current"), "page");
  assert.equal(row("today-b").getAttribute("aria-current"), null);
  await row("__chat").click();
  assert.deepEqual(clean(app.calls.go.at(-1)), ["workspace", { view: "chat" }]);
  assert.deepEqual(clean(app.B.view()), { view: "chat", taskId: null });
  app.env.flush();
  assert.equal(row("__chat").getAttribute("aria-current"), "page");
  assert.equal(row("today-a").getAttribute("aria-current"), null);
});

test("Chat with Mefi says when a reply is new, and stops when you have read it", async () => {
  const messages = [{ role: "user", at: at(0, 13, 0), text: "hi" }, { role: "assistant", at: at(0, 13, 5), text: "Hello" }];
  const app = await makeApp({ saved: "sessions", tasks: [task("a")], messages });
  const chat = () => app.document.getElementById("app-rail-sessions").querySelector('[data-key="__chat"]');
  assert.deepEqual([chat().dataset.tone, chat().title], ["new", "Chat with Mefi · New reply"]);
  await chat().click();
  app.env.flush();
  assert.equal(chat().dataset.tone, "chat", "opening the chat reads the reply");
  assert.ok(Number(app.storage.get("mefiStudio.builder.seen.p1")) >= at(0, 13, 5), "and that is remembered");
  // A reply that lands after you read the chat, while you are elsewhere, is new again.
  await app.document.getElementById("app-rail-sessions").querySelector('[data-key="a"]').click();
  app.state.data.assistant.messages = [...messages, { role: "assistant", at: NOW + 5 * 60000, text: "More" }];
  app.B.refresh(); app.env.flush();
  assert.equal(chat().dataset.tone, "new");
  // A companion the owner renamed is what the row says.
  const named = await makeApp({ saved: "sessions", storage: new Map([["mefiStudio.workspace.companion", "Pip"]]), tasks: [task("a")] });
  assert.equal(named.document.getElementById("app-rail-sessions").querySelector('[data-key="__chat"] .label').textContent, "Chat with Pip");
});

test("Older folds finished work away until you ask for it", async () => {
  const app = await makeApp({ saved: "sessions", tasks: board(), stages: STAGES, questions: QUESTIONS });
  const list = () => app.document.getElementById("app-rail-sessions");
  assert.equal(list().querySelector('[data-key="old-done-1"]'), null);
  assert.equal(list().querySelector(".builder-older").textContent, "Older · 3", "three finished more than two weeks ago (nothing is pinned here)");
  await list().querySelector(".builder-older").click();
  assert.deepEqual(menuOf(app).slice(-4), ["# Older", "old-done-1/done", "pinned-old/done", "old-done-2/done"], "newest first, under their own heading");
  assert.equal(list().querySelector(".builder-older"), null, "and the fold's button is gone");
});

// ---- the worktree mark -----------------------------------------------------------

test("a task whose run works in its own worktree wears the branch mark, and the mark follows the Worktrees page", async () => {
  let looks = 0;
  const worktrees = { peek: async () => { looks += 1; return { repo: true, tasks: ["today-a", "pinned-old"] }; } };
  const storage = new Map([["mefiStudio.builder.pins.p1", JSON.stringify(["pinned-old"])]]);
  const app = await makeApp({ saved: "sessions", storage, tasks: board(), stages: STAGES, questions: QUESTIONS, worktrees });
  const row = (key) => app.document.getElementById("app-rail-sessions").querySelector(`[data-key="${key}"]`);
  const marked = () => app.document.getElementById("app-rail-sessions").querySelectorAll(".builder-worktree").length;
  assert.equal(looks, 1, "the menu takes one quiet look when it first paints");
  await app.env.settle(); app.env.flush();
  assert.equal(marked(), 2, "the two tasks the list names carry the mark");
  assert.ok(row("today-a").querySelector(".builder-worktree"));
  assert.equal(row("today-a").title, "Task today-a · Ready to start · in its own worktree");
  assert.equal(row("today-a").getAttribute("aria-label"), "Task today-a. Ready to start. In its own worktree");
  assert.equal(row("today-b").querySelector(".builder-worktree"), null, "a task with no worktree has none");
  assert.equal(row("today-b").title, "Task today-b · Waiting", "and its words are unchanged");
  assert.equal(row("__chat").querySelector(".builder-worktree"), null, "Chat with Mefi never has one");
  const both = row("pinned-old");
  assert.ok(both.querySelector(".builder-worktree") && both.querySelector(".builder-pinned"), "a pinned task can carry both");
  assert.equal(both.getAttribute("aria-label"), "Task pinned-old. Done. In its own worktree. Pinned");
  assert.deepEqual(both.children.map((child) => child.classList.contains("builder-worktree") ? "worktree" : child.classList.contains("builder-pinned") ? "pin" : "other").slice(-2), ["worktree", "pin"], "the branch mark sits before the pin");

  // The Worktrees page announces a new list: the marks move with it, no repaint is wasted on the same one.
  app.env.emit("mefi:worktrees", { repo: true, tasks: ["runs"] });
  assert.equal(marked(), 1);
  assert.ok(row("runs").querySelector(".builder-worktree"));
  assert.equal(row("today-a").querySelector(".builder-worktree"), null, "a merged run's mark goes");
  const painted = app.document.getElementById("app-rail-sessions").children[0];
  app.env.emit("mefi:worktrees", { repo: true, tasks: ["runs"] });
  assert.equal(app.document.getElementById("app-rail-sessions").children[0], painted, "the same list repaints nothing");
  app.env.emit("mefi:worktrees", { repo: false, tasks: [] });
  assert.equal(marked(), 0, "a project that is not a repository has none");
  app.env.emit("mefi:worktrees", undefined);
  app.env.emit("mefi:worktrees", { tasks: "not a list" });
  assert.equal(marked(), 0, "an answer that is not a list is no list");
});

test("the menu looks for worktrees quietly: once per few seconds, again for another project, never when the page cannot answer", async () => {
  let looks = 0;
  const app = await makeApp({ saved: "sessions", tasks: board(), stages: STAGES, questions: QUESTIONS, worktrees: { peek: async () => { looks += 1; return { tasks: ["runs"] }; } } });
  await app.env.settle();
  for (let repaint = 0; repaint < 4; repaint += 1) { app.B.refresh(); app.env.flush(); }
  assert.equal(looks, 1, "repainting the menu does not ask the host again");
  // Another project has other worktrees: the old marks are dropped and the menu looks again.
  app.env.emit("mefi:project-changed");
  app.env.flush(); await app.env.settle(); app.env.flush();
  assert.equal(looks, 2, "a project change looks again");
  assert.equal(app.document.getElementById("app-rail-sessions").querySelectorAll(".builder-worktree").length, 1);

  // A look that fails leaves the menu as it was; a page with no Worktrees module gets no marks and no errors.
  const failing = await makeApp({ saved: "sessions", tasks: board(), worktrees: { peek: async () => { throw new Error("git is not installed"); } } });
  await failing.env.settle(); failing.env.flush();
  assert.equal(failing.document.getElementById("app-rail-sessions").querySelectorAll(".builder-worktree").length, 0);
  const without = await makeApp({ saved: "sessions", tasks: board() });
  await without.env.settle(); without.env.flush();
  assert.equal(without.document.getElementById("app-rail-sessions").querySelectorAll(".builder-worktree").length, 0);
  assert.ok(without.document.getElementById("app-rail-sessions").querySelector('[data-key="today-a"]'), "and the menu is drawn as ever");
});

test("the filter narrows the list as you type, says when nothing matches, and Escape puts everything back", async () => {
  const tasks = [task("a", { title: "Add a sitemap", prompt: "Generate sitemap.xml", updatedAt: at(0, 9) }), task("b", { title: "Fix the Login loop", prompt: "The redirect loops", updatedAt: at(0, 10) }), task("c", { title: "Dark mode", prompt: "Add a sitemap link too", updatedAt: at(0, 11) })];
  const app = await makeApp({ saved: "sessions", tasks });
  const list = () => app.document.getElementById("app-rail-sessions");
  const find = () => list().querySelector('[data-key="find"]');
  assert.equal(find().getAttribute("aria-pressed"), "false");
  assert.equal(find().title, "Filter this list");
  await find().click();
  assert.equal(find().getAttribute("aria-pressed"), "true");
  assert.equal(find().title, "Stop filtering");
  let input = list().querySelector(".builder-search-input");
  assert.ok(input, "a filter box opens under the heading");
  assert.equal(input.placeholder, "Filter tasks…");
  input.value = "sitemap";
  await input.trigger("input");
  assert.deepEqual(menuOf(app).filter((line) => /\/(ready|run|ask|done)$/.test(line)), ["c/ready", "a/ready"], "title and brief both count");
  input = list().querySelector(".builder-search-input");
  assert.equal(input.value, "sitemap", "what you typed is still there after the list repaints");
  input.value = "  LOGIN ";
  await input.trigger("input");
  assert.deepEqual(menuOf(app).filter((line) => /\/(ready)$/.test(line)), ["b/ready"], "case and spaces do not matter");
  input = list().querySelector(".builder-search-input");
  input.value = "zzz";
  await input.trigger("input");
  assert.equal(list().querySelector(".builder-empty-list").textContent, "No task matches that filter.");
  input = list().querySelector(".builder-search-input");
  await input.trigger("keydown", { key: "ArrowLeft" });
  assert.ok(list().querySelector(".builder-search-input"), "arrow keys in the box are the box's own");
  await input.trigger("keydown", { key: "Escape" });
  assert.equal(list().querySelector(".builder-search-input"), null, "Escape closes the filter");
  assert.deepEqual(menuOf(app).filter((line) => /\/ready$/.test(line)), ["c/ready", "b/ready", "a/ready"], "and shows every task again");
  assert.equal(list().querySelector(".builder-empty-list"), null);
});

test("an empty project says how tasks show up here", async () => {
  const app = await makeApp({ saved: "sessions", tasks: [] });
  const list = app.document.getElementById("app-rail-sessions");
  assert.equal(list.querySelector(".builder-empty-list").textContent, "Tasks you start show up here, like sessions.");
  assert.ok(list.querySelector('[data-key="__chat"]'), "Chat with Mefi is always there");
});

test("the menu follows Vibe and Build, and comes back whenever the rail is redrawn", async () => {
  // In Vibe the rail is Vibe's own; the switch and the list wait for Build.
  const app = await makeApp({ saved: "sessions", vibe: "vibe", tasks: board(), stages: STAGES });
  assert.equal(app.document.getElementById("app-rail-sessions"), null, "nothing is added to the rail while Vibe owns it");
  assert.equal(app.B.ownsRail(), false);
  assert.equal(app.B.paintRail(), false);
  assert.equal(app.document.documentElement.dataset.railSessions, undefined);
  app.state.vibe = "build";
  app.env.emit("mefi:shell");
  assert.ok(app.document.getElementById("app-rail-sessions"), "Build gets the menu");
  assert.equal(app.B.paintRail(), true);
  assert.equal(app.page.sections.children[0].querySelector('[data-ui-mode="build"]').getAttribute("aria-checked"), "true");
  // Back to Vibe: the list is not the builder's to paint, and nav.js is told so. nav.js
  // redraws the rail on the shell change and hands it over again; the builder clears its mark.
  app.state.vibe = "vibe";
  assert.equal(app.B.paintRail(), false);
  app.page.sections.replaceChildren();
  app.B.decorateRail({ sections: app.page.sections, foot: app.page.foot });
  assert.equal(app.document.documentElement.dataset.railSessions, undefined, "the mark is cleared for Vibe's rail");
  assert.equal(app.page.sections.children.length, 0, "and Vibe's rail is left as nav.js drew it");
  // nav.js rebuilds the rail on every shell change: the builder's parts join the new one each time.
  app.state.vibe = "build";
  app.page.sections.replaceChildren();
  app.page.foot.replaceChildren();
  app.env.emit("mefi:shell");
  assert.equal(app.page.sections.children.length, 2);
  assert.equal(app.page.sections.children[0].classList.contains("builder-mode-switch"), true);
  assert.equal(app.page.sections.querySelectorAll(".builder-mode-switch").length, 1, "never twice");
  assert.equal(app.page.sections.querySelectorAll("#app-rail-sessions").length, 1);
  assert.equal(app.page.foot.querySelectorAll("#app-rail-person").length, 1);
  assert.ok(menuOf(app).includes("today-a/ready"), "and the list is painted again");
  // A task board push repaints only the rows that changed.
  app.env.emit("mefi:shell");
  assert.equal(app.page.sections.querySelectorAll(".builder-mode-switch").length, 1);
});

// ---- Home adopts the layout ------------------------------------------------------

// A rule's declarations, found by a piece of its selector, from the stylesheet as written.
async function rules() {
  const css = await readFile(new URL("../renderer/builder.css", import.meta.url), "utf8");
  return (selector) => {
    const found = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, head]) => head.trim().endsWith(selector) || head.split(",").some((part) => part.trim().endsWith(selector)));
    return found.map(([, , body]) => body.replace(/\s+/g, " ").trim());
  };
}

test("once Home is on screen the layout adopts it: a session area, chips, a title bar, a dock and a window layer", async () => {
  const app = await makeApp({ saved: "sessions", tasks: board(), stages: STAGES, questions: QUESTIONS, running: [{ taskId: "runs", runId: "run-1" }], storage: new Map([["mefiStudio.workspace.person", "Nate"]]) });
  const { page, document } = app;
  assert.equal(app.B.active(), false, "nothing is adopted before Home is on screen");
  app.state.active = false;
  app.env.flush();
  assert.equal(document.getElementById("builder-home"), null, "a hidden Home is not touched");
  app.state.active = true;
  app.B.refresh(); app.env.flush();

  assert.equal(app.B.active(), true);
  assert.equal(document.documentElement.dataset.homeLayout, "sessions");
  assert.equal(page.layer.dataset.view, "home");
  assert.equal(page.content.children[0].id, "builder-home", "the New task page heads Home's content");
  assert.equal(page.content.children[1].id, "builder-task", "and the task session follows it");
  assert.equal(page.form.previousElementSibling, document.getElementById("builder-chips"), "the chips sit right above the composer");
  assert.equal(page.form.nextElementSibling.id, "builder-task-compose", "a task's own composer follows it");
  assert.equal(document.getElementById("builder-task-compose").hidden, true);
  assert.equal(page.form.hidden, false, "Home's composer is the New task composer");
  assert.equal(document.getElementById("builder-home").hidden, false);
  assert.equal(document.getElementById("builder-task").hidden, true);
  assert.equal(page.top.children[0].id, "builder-title", "the title bar's trail heads the top bar");
  assert.equal(page.actions.children[0].id, "builder-pane-toggles", "the pane toggles sit before the attention shortcut");
  assert.equal(page.actions.children[1], page.attention);
  assert.equal(document.getElementById("builder-dock").parentNode, page.homeLayout, "the dock is beside the conversation");
  assert.equal(document.getElementById("builder-floats").parentNode, page.layer, "windows float over the page");
  assert.equal(document.getElementById("builder-dock").getAttribute("aria-label"), "Docked panes");

  const greeting = document.getElementById("builder-home").querySelector("h1");
  assert.equal(greeting.textContent, "What's up next, Nate?");
  assert.equal(document.getElementById("builder-title").querySelector(".builder-trail").textContent, "Snake trial/New task");

  // Its own sections are found by id wherever they are.
  for (const id of ["walkthrough-invitation", "community-invitation", "workspace-focus-panel", "workspace-preview-panel", "workspace-dashboard", "workspace-form", "workspace-input", "workspace-send"]) {
    assert.ok(document.getElementById(id), `#${id} is still in the document`);
  }
  assert.equal(document.querySelectorAll("#walkthrough-invitation").length, 1, "one instance, never a copy");
  assert.equal(document.querySelectorAll("#workspace-focus-panel").length, 1);
});

test("the old drawer and folds become six panes, each holding its own section, and the toggles mirror them", async () => {
  const app = await makeApp({ saved: "sessions", tasks: board(), stages: STAGES, questions: QUESTIONS, running: [{ taskId: "runs", runId: "run-1" }] });
  app.env.flush();
  const { page, document } = app;
  const P = app.window.MefiPanes;
  assert.deepEqual(clean(P.list().map((pane) => [pane.id, pane.title])), [["activity", "Activity"], ["output", "Output"], ["checks", "Checks"], ["preview", "Preview"], ["queue", "Queue"], ["status", "Status"]]);
  const inPane = (id) => document.querySelector(`[data-pane="${id}"]`);
  assert.ok(inPane("activity").contains(page.focus), "Activity holds Current task");
  assert.ok(inPane("preview").contains(page.preview), "Preview holds App preview");
  assert.ok(inPane("queue").contains(page.queue), "Queue holds the backlog and the work list");
  assert.ok(inPane("status").contains(page.dashboard), "Status holds the dashboard");
  assert.ok(inPane("status").contains(page.recent), "and Home's recent activity");
  assert.ok(inPane("output").contains(document.getElementById("builder-output")));
  assert.ok(inPane("checks").contains(document.getElementById("builder-checks")));
  assert.equal(page.drawer.children.length, 0, "the drawer is emptied into the panes");

  // A running task asks for Activity; nothing else opens on its own.
  assert.deepEqual(clean(P.list().map((pane) => [pane.id, pane.where])), [["activity", "dock"], ["output", "closed"], ["checks", "closed"], ["preview", "closed"], ["queue", "closed"], ["status", "closed"]]);
  const toggles = document.getElementById("builder-pane-toggles").children;
  assert.deepEqual(toggles.map((toggle) => [toggle.dataset.paneToggle, toggle.getAttribute("aria-pressed"), toggle.dataset.where]), [["activity", "true", "dock"], ["output", "false", "closed"], ["checks", "false", "closed"], ["preview", "false", "closed"], ["queue", "false", "closed"], ["status", "false", "closed"]]);
  assert.equal(toggles[0].title, "Activity · docked");
  assert.equal(toggles[0].dataset.tone, "run", "the Activity toggle glows while a worker runs");
  assert.equal(P.list().length, document.querySelectorAll(".pane").length, "one element per pane");

  // A toggle opens and closes its pane, and the toggles follow a pane moved from the pane itself.
  await toggles[1].click();
  assert.equal(P.where("output"), "dock");
  assert.equal(toggles[1].getAttribute("aria-pressed"), "true");
  P.popOut("output");
  assert.equal(toggles[1].dataset.where, "float");
  assert.equal(toggles[1].title, "Output · in a window");
  await toggles[1].click();
  assert.equal(P.where("output"), "closed");
  assert.equal(toggles[1].getAttribute("aria-pressed"), "false");
  // Hand placement outranks the wish: close Activity while a worker runs and it stays closed.
  await toggles[0].click();
  assert.equal(P.where("activity"), "closed");
  app.B.refresh(); app.env.flush();
  assert.equal(P.where("activity"), "closed", "the owner's wish does not reopen what you closed");
  assert.equal(JSON.parse(app.storage.get("mefiStudio.panes.v1")).activity.chosen, true);
});

test("Activity opens while a worker runs and goes when the work stops, until you place it yourself", async () => {
  const app = await makeApp({ saved: "sessions", tasks: board(), stages: STAGES, running: [] });
  app.env.flush();
  const P = app.window.MefiPanes;
  assert.equal(P.where("activity"), "closed", "nothing running, nothing to show");
  app.state.data = { ...app.state.data, status: { running: [{ taskId: "runs", runId: "run-1" }] } };
  app.B.refresh(); app.env.flush();
  assert.equal(P.where("activity"), "dock");
  app.state.data = { ...app.state.data, status: { running: [] } };
  app.B.refresh(); app.env.flush();
  assert.equal(P.where("activity"), "closed", "and away again when the work is done");
  assert.equal(app.storage.has("mefiStudio.panes.v1"), false, "a wish is never stored as a placement");
});

// ---- the composer's bottom row ----------------------------------------------------

test("the composer's row keeps one line: Use a task outline and Plan an idea live in a + menu, whole", async () => {
  const app = await makeApp({ saved: "sessions", tasks: board(), stages: STAGES });
  const { page, document } = app;
  const outline = page.outline, plan = page.plan;
  let planned = 0, outlined = 0;
  plan.addEventListener("click", () => { planned += 1; });          // workspace.js's handlers, bound before the layout adopts the page
  outline.addEventListener("click", () => { outlined += 1; });
  app.env.flush();

  // The row keeps only the hint, the tools and Send; the two ghost buttons that crowded it have moved.
  const tools = page.bottom.children[1];
  assert.deepEqual([page.bottom.children[0].id, tools.className, page.bottom.children[2].id], ["workspace-compose-hint", "builder-compose-tools", "workspace-send"]);
  assert.deepEqual(tools.children.map((node) => node.id), ["builder-autonomy", "builder-more", "builder-worker-cli", "builder-worker-tier"], "permission, +, worker, tier: then Send");
  assert.equal(page.bottom.children.length, 3, "no other button is left in the row");
  assert.equal(outline.parentNode, document.getElementById("builder-more-menu"), "the outline button moved into the menu");
  assert.equal(plan.parentNode, document.getElementById("builder-more-menu"), "and so did Plan an idea");
  assert.equal(document.getElementById("workspace-task-outline"), outline, "the same buttons, with their ids");
  assert.equal(document.getElementById("workspace-plan-idea"), plan);
  assert.equal(outline.getAttribute("role"), "menuitem");
  assert.equal(plan.getAttribute("role"), "menuitem");

  const more = document.getElementById("builder-compose-more");
  const menu = document.getElementById("builder-more-menu");
  assert.equal(more.getAttribute("aria-label"), "More");
  assert.equal(more.getAttribute("aria-haspopup"), "menu");
  assert.equal(more.getAttribute("aria-expanded"), "false");
  assert.equal(more.getAttribute("aria-controls"), "builder-more-menu");
  assert.equal(menu.getAttribute("role"), "menu");
  assert.equal(menu.hidden, true, "closed until asked");
  assert.equal(more.querySelector("use").getAttribute("href"), "#g-add", "the button is a plus");
  assert.equal(document.getElementById("builder-more").parentNode, tools);

  // Open it, choose Plan an idea: Home's own handler runs, then the menu closes.
  await more.click();
  assert.equal(menu.hidden, false);
  assert.equal(more.getAttribute("aria-expanded"), "true");
  assert.equal(plan.focused, true, "the first shown item takes focus (the outline is hidden until Create task)");
  await plan.click();
  assert.equal(planned, 1, "the button still does what workspace.js made it do");
  assert.equal(menu.hidden, true);
  assert.equal(more.getAttribute("aria-expanded"), "false");
  // The purpose decides what shows, as it always did: the outline appears in Create task.
  outline.hidden = false;
  await more.click();
  await outline.click();
  assert.equal(outlined, 1);
  assert.equal(menu.hidden, true);
});

test("the stylesheet keeps the row to one line: pickers start narrow and share the room, the hint is out of the way, and the menus are not clipped", async () => {
  const css = await rules();
  const S = 'html[data-home-layout="sessions"] #workspace-layer .ws-composer';
  const one = (selector) => {
    const found = css(selector);
    assert.ok(found.length >= 1, `a rule for ${selector}`);
    return found.join(" ");
  };
  const order = (selector) => Number(/(?:^|[\s;])order:\s*(-?\d+)/.exec(one(selector))?.[1]);

  const composer = one(S);
  assert.match(composer, /display: flex/);
  assert.match(composer, /flex-wrap: wrap/, "a narrow window may still wrap, one item at a time");
  assert.match(composer, /overflow: visible/, "Home's sheet clips its rounded corners; the permission and + menus open upward and need the room");
  assert.match(one(`${S} :is(.ws-compose-top, .ws-compose-bottom, .file-input-tools, .builder-compose-tools)`), /display: contents/, "the pieces flatten into one row");

  // The pickers begin at a narrow width, so they count little toward the wrap, and share the rest of the line.
  const picker = one("#workspace-layer .builder-compose-tools .studio-select");
  assert.match(picker, /flex: 1 1 96px/);
  assert.match(picker, /min-width: 88px/);
  assert.match(picker, /max-width: 220px/, "and stop growing when the name fits");
  assert.match(one("#workspace-layer .builder-compose-tools .studio-select .studio-select-value"), /text-overflow: ellipsis/, "a long model name ends in an ellipsis instead of pushing Send down");
  // Home's own keyboard hint takes no room here; the task composer's intent hint takes what is spare.
  assert.match(one(`${S} #workspace-compose-hint`), /display: none/);
  assert.match(one(`${S} .builder-intent-hint`), /flex: 1 1 0/);
  assert.match(one(`${S} #builder-worker-cli-choice`), /margin-left: auto/, "the worker, its tier and Send stay together at the right");
  // Nothing sizes or orders the two buttons that moved into the menu as if they were still in the row.
  assert.deepEqual(css("#workspace-task-outline"), []);
  assert.deepEqual(css("#workspace-plan-idea"), []);

  // The row reads: files, purpose, permission, +, then (right) worker, tier, Send.
  const sequence = [order(`${S} .file-input-tools > button`), order(`${S} .ws-modes`), order(`${S} .builder-autonomy`), order(`${S} .builder-more`), order(`${S} #builder-worker-cli-choice`), order(`${S} #builder-worker-tier-choice`), order(`${S} :is(#workspace-send, #builder-task-send)`)];
  assert.deepEqual(sequence, [1, 2, 3, 4, 7, 8, 9]);
  assert.match(one(`${S} .builder-more`), /position: relative/, "the menu is placed against the +");

  // The menu: a small list above the +, shut unless opened, and a hidden item stays hidden.
  const menu = one(".builder-more-menu");
  assert.match(menu, /position: absolute/);
  assert.match(menu, /bottom: calc\(100% \+ 8px\)/, "it opens upward");
  assert.match(menu, /z-index: 30/);
  assert.match(one(".builder-more-menu[hidden]"), /display: none/);
  assert.match(one(`${S} .builder-more-menu > button[hidden]`), /display: none/, "Use a task outline stays out of the menu until Create task shows it");
});

test("the + menu opens on a click, moves with the arrow keys, and closes on Escape, an outside click or a pick", async () => {
  const app = await makeApp({ saved: "sessions", tasks: [task("a")] });
  const { page, document } = app;
  app.env.flush();
  page.outline.hidden = false;
  const more = document.getElementById("builder-compose-more");
  const menu = document.getElementById("builder-more-menu");
  const holder = document.getElementById("builder-more");
  const key = (key, target) => holder.trigger("keydown", { key, target });

  await more.click();
  assert.equal(menu.hidden, false);
  assert.equal(page.outline.focused, true, "focus goes to the first item");
  page.outline.focused = false;
  await key("ArrowDown", page.outline);
  assert.equal(page.plan.focused, true, "Down moves to the next");
  page.plan.focused = false;
  await key("ArrowDown", page.plan);
  assert.equal(page.outline.focused, true, "and wraps");
  page.outline.focused = false;
  await key("ArrowUp", page.outline);
  assert.equal(page.plan.focused, true, "Up goes back, and wraps too");
  page.plan.disabled = true;
  page.outline.focused = false;
  await key("ArrowDown", page.outline);
  assert.equal(page.outline.focused, true, "a disabled item is skipped");
  page.plan.disabled = false;

  more.focused = false;
  let stopped = false;
  await holder.trigger("keydown", { key: "Escape", target: page.plan, stopPropagation: () => { stopped = true; } });
  assert.equal(stopped, true, "the page's own Escape is not also fired");
  assert.equal(menu.hidden, true, "Escape closes it");
  assert.equal(more.focused, true, "and returns focus to the +");
  assert.equal(more.getAttribute("aria-expanded"), "false");
  // With the menu shut, Escape is the page's (it leaves a task, closes a window).
  stopped = false;
  await holder.trigger("keydown", { key: "Escape", target: more, stopPropagation: () => { stopped = true; } });
  assert.equal(stopped, false, "a closed menu does not swallow Escape");

  await more.click();
  assert.equal(menu.hidden, false);
  await more.click();
  assert.equal(menu.hidden, true, "the + toggles");
  await more.click();
  await document.body.trigger("click", { target: page.input });
  assert.equal(menu.hidden, true, "a click anywhere else closes it");
  await more.click();
  await document.body.trigger("click", { target: page.plan });
  assert.equal(menu.hidden, false, "a click inside it does not");
  await document.body.trigger("click", { target: more });
  assert.equal(menu.hidden, false, "nor does one on the + (its own handler decides)");
});

// ---- the chips above the composer and the worker beside Send -----------------------

/** A bridge that records what the builder asks of the host, and answers from what a test sets. */
function makeBridge(seed = {}) {
  const calls = [];
  const listeners = {};
  const on = (name) => (fn) => { listeners[name] = fn; };
  const state = {
    where: { ok: true, projectId: "p1", repo: true, branch: "land/builder", head: "2687d04", dirty: 3, worktrees: { on: false, forced: false } },
    routing: { ok: true, executorCli: "claude", executorModel: "claude-opus-4-1", executorModels: { claude: "claude-opus-4-1" }, executorTier: "heavy", executorTierModels: { claude: { heavy: "claude-opus-4-1", fast: "claude-sonnet-4-5" } }, executorTierDefaults: {} },
    clis: [{ id: "opencode", installed: true }, { id: "claude", installed: true }, { id: "codex", installed: true }, { id: "grok", installed: false }],
    stats: undefined,
    attempts: [],
    fail: {},
    ...seed,
  };
  const answer = async (name, value) => { calls.push([name]); if (state.fail[name]) return { ok: false, error: state.fail[name] }; return value; };
  const api = {
    workWhere: async () => answer("workWhere", state.where),
    workWorktrees: async (value) => { calls.push(["workWorktrees", value]); if (state.fail.workWorktrees) return { ok: false, error: state.fail.workWorktrees }; return { ok: true, worktrees: { on: value, forced: false } }; },
    getAiRouting: async () => { calls.push(["getAiRouting"]); return state.routing; },
    setAiRouting: async (patch) => { calls.push(["setAiRouting", patch]); if (state.fail.setAiRouting) return { ok: false, error: state.fail.setAiRouting }; Object.assign(state.routing, patch); return { ok: true }; },
    cliStatus: async () => state.clis,
    shellReveal: async (path) => { calls.push(["shellReveal", path]); },
    tasksAttempts: async (payload) => { calls.push(["tasksAttempts", payload]); if (state.fail.tasksAttempts) return { ok: false, error: state.fail.tasksAttempts }; return { ok: true, attempts: state.attempts }; },
    tasksSave: async (rows) => { calls.push(["tasksSave", rows]); return state.fail.tasksSave ? { ok: false, error: state.fail.tasksSave } : { ok: true }; },
    tasksCreate: async (payload) => { calls.push(["tasksCreate", payload]); return state.fail.tasksCreate ? { ok: false, error: state.fail.tasksCreate } : { ok: true }; },
    tasksAction: async (payload) => { calls.push(["tasksAction", payload]); return state.fail.tasksAction ? { ok: false, error: state.fail.tasksAction } : { ok: true }; },
    backlogControl: async (payload) => { calls.push(["backlogControl", payload]); return state.fail.backlogControl ? { ok: false, error: state.fail.backlogControl } : { ok: true }; },
    assistantAnswer: async (payload) => { calls.push(["assistantAnswer", payload]); return state.fail.assistantAnswer ? { ok: false, error: state.fail.assistantAnswer } : { ok: true }; },
    assistantMessage: async (text, projectId, context) => {
      calls.push(["assistantMessage", text, projectId, context]);
      if (state.fail.assistantMessage) return { ok: false, error: state.fail.assistantMessage };
      if (state.gate) await state.gate;
      return state.reply ?? { ok: true, state: { messages: [] } };
    },
    onTasks: on("tasks"), onAssistant: on("assistant"), onAssistantStatus: on("status"), onProjects: on("projects"),
  };
  if (state.stats !== undefined) api.workStats = async (options) => { calls.push(["workStats", options]); return typeof state.stats === "function" ? state.stats(options) : state.stats; };
  if (seed.only) for (const name of Object.keys(api)) if (!seed.only.includes(name) && !name.startsWith("on")) delete api[name];
  return Object.assign(api, { calls, listeners, state });
}

/** Let the page paint, its host calls settle, and it paint what they said. */
async function pump(app, rounds = 3) {
  for (let round = 0; round < rounds; round += 1) { app.env.flush(); await app.env.settle(); }
  app.env.flush();
}
const chipsOf = (app) => app.document.getElementById("builder-chips").children;
const texts = (node) => node.textContent;

test("the chips name where work runs: this PC, the project, its branch with what is uncommitted, and the Worktree switch", async () => {
  const bridge = makeBridge();
  const app = await makeApp({ saved: "sessions", tasks: [task("a")], bridge });
  const opened = [];
  app.window.MefiSidebar = { open: (options) => opened.push(options) };
  await pump(app);
  const chips = chipsOf(app);
  assert.deepEqual(chips.map((chip) => texts(chip).replace(/\s+/g, " ").trim()), ["Local", "Snake trial", "land/builder+3", "Worktree"]);
  assert.equal(chips[0].title, "Tasks run on this PC, in the folder beside it");
  assert.equal(chips[1].title, "/work/snake · switch project");
  await chips[1].click();
  assert.deepEqual(clean(opened), [{ focus: true, projectFocus: true }], "the project chip opens the project switcher");
  assert.equal(chips[2].title, "On branch land/builder · 3 uncommitted paths. Opens the folder.");
  assert.equal(chips[2].querySelector(".builder-chip-count").textContent, "+3");
  await chips[2].click();
  assert.deepEqual(bridge.calls.filter((call) => call[0] === "shellReveal"), [["shellReveal", "/work/snake"]], "the branch chip opens the folder");
  const box = chips[3];
  assert.equal(box.getAttribute("role"), "switch");
  assert.equal(box.getAttribute("aria-checked"), "false");
  assert.equal(box.disabled, false);
  assert.match(box.title, /^Off: runs work in your folder/);
  assert.equal(bridge.calls.filter((call) => call[0] === "workWhere").length, 1, "one read of the folder, not one per repaint");
});

test("the branch chip says what the folder is: one uncommitted path, nothing uncommitted, a detached head, no commits, or no repository", async () => {
  const cases = [
    [{ dirty: 1 }, "land/builder+1", "On branch land/builder · 1 uncommitted path. Opens the folder."],
    [{ dirty: 0 }, "land/builder", "On branch land/builder · nothing uncommitted. Opens the folder."],
    [{ branch: null, head: "abc1234" }, "detached abc1234+3", "No branch checked out · 3 uncommitted paths. Opens the folder."],
    [{ branch: null, head: null, dirty: 0 }, "no commits yet", "No branch checked out · nothing uncommitted. Opens the folder."],
  ];
  for (const [patch, label, title] of cases) {
    const app = await makeApp({ saved: "sessions", tasks: [task("a")], bridge: makeBridge({ where: { ok: true, projectId: "p1", repo: true, branch: "land/builder", head: "2687d04", dirty: 3, worktrees: { on: false }, ...patch } }) });
    await pump(app);
    const chips = chipsOf(app);
    assert.equal(texts(chips[2]).replace(/\s+/g, " ").trim(), label);
    assert.equal(chips[2].title, title);
  }
  const plain = await makeApp({ saved: "sessions", tasks: [task("a")], bridge: makeBridge({ where: { ok: true, projectId: "p1", repo: false, branch: null, dirty: 0, worktrees: { on: false } } }) });
  await pump(plain);
  assert.deepEqual(chipsOf(plain).map((chip) => texts(chip)), ["Local", "Snake trial"], "a folder that is not a repository has no branch and no Worktree switch");
  // An answer for another project is not this project's branch.
  const stale = await makeApp({ saved: "sessions", tasks: [task("a")], bridge: makeBridge({ where: { ok: true, projectId: "other", repo: true, branch: "x", dirty: 0, worktrees: {} } }) });
  await pump(stale);
  assert.deepEqual(chipsOf(stale).map((chip) => texts(chip)), ["Local", "Snake trial"]);
  // No host at all: the chips still say where and which project.
  const none = await makeApp({ saved: "sessions", tasks: [task("a")] });
  await pump(none);
  assert.deepEqual(chipsOf(none).map((chip) => texts(chip)), ["Local", "Snake trial"]);
});

test("the Worktree switch saves the choice, says what it did, and is locked when the environment forces it", async () => {
  const bridge = makeBridge();
  const app = await makeApp({ saved: "sessions", tasks: [task("a")], bridge });
  await pump(app);
  const box = () => chipsOf(app)[3];
  await box().click();
  assert.deepEqual(bridge.calls.filter((call) => call[0] === "workWorktrees"), [["workWorktrees", true]]);
  assert.deepEqual(app.calls.toasts.at(-1), ["Each run now gets its own worktree.", "good"]);
  await pump(app);
  assert.equal(box().getAttribute("aria-checked"), "true");
  assert.match(box().title, /^On: each run works in its own git worktree from HEAD/);
  await box().click();
  assert.deepEqual(bridge.calls.filter((call) => call[0] === "workWorktrees").at(-1), ["workWorktrees", false], "the switch toggles from what it shows");
  assert.deepEqual(app.calls.toasts.at(-1), ["Runs work in your folder again.", "good"]);
  bridge.state.fail.workWorktrees = "The settings file is locked.";
  await pump(app);
  await box().click();
  assert.equal(app.calls.toasts.at(-1)[1], "bad");
  assert.match(app.calls.toasts.at(-1)[0], /settings file is locked/);
  await pump(app);
  assert.equal(box().disabled, false, "a failed save leaves the switch usable");

  const forced = await makeApp({ saved: "sessions", tasks: [task("a")], bridge: makeBridge({ where: { ok: true, projectId: "p1", repo: true, branch: "main", dirty: 0, worktrees: { on: true, forced: true } } }) });
  await pump(forced);
  const locked = chipsOf(forced)[3];
  assert.equal(locked.disabled, true);
  assert.equal(locked.getAttribute("aria-checked"), "true");
  assert.match(locked.title, /MEFI_STUDIO_WORKTREE_RUNS=1 is set/);
  const older = await makeApp({ saved: "sessions", tasks: [task("a")], bridge: makeBridge({ only: ["workWhere", "getAiRouting"] }) });
  await pump(older);
  assert.equal(chipsOf(older)[3].disabled, true, "a host with no workWorktrees call cannot save it");
});

test("the worker and its tier sit beside Send, show what runs, and save through the same call Agents › Setup makes", async () => {
  const bridge = makeBridge();
  const app = await makeApp({ saved: "sessions", tasks: [task("a")], bridge });
  const cli = () => app.document.getElementById("builder-worker-cli");
  const tier = () => app.document.getElementById("builder-worker-tier");
  app.env.flush();
  assert.equal(cli().disabled, true, "the pickers wait for the host's answer");
  assert.equal(tier().disabled, true);
  await pump(app);
  assert.deepEqual(cli().children.map((option) => [option.value, option.textContent]), [["claude", "Claude Code · claude-opus-4-1"], ["opencode", "OpenCode"], ["codex", "Codex"]], "the current worker, then the installed ones (Grok is not installed)");
  assert.equal(cli().value, "claude");
  assert.deepEqual(tier().children.map((option) => [option.value, option.textContent]), [["auto", "Auto tier"], ["free", "Free tier"], ["fast", "Fast tier · claude-sonnet-4-5"], ["heavy", "Heavy tier · claude-opus-4-1"]]);
  assert.equal(tier().value, "heavy");
  assert.equal(cli().disabled, false);
  assert.equal(tier().disabled, false);
  assert.equal(cli().getAttribute("aria-label"), "Coding worker");
  assert.equal(tier().getAttribute("aria-label"), "Worker tier");

  cli().value = "codex";
  await cli().trigger("change");
  assert.deepEqual(clean(bridge.calls.filter((call) => call[0] === "setAiRouting")), [["setAiRouting", { executorCli: "codex" }]]);
  assert.deepEqual(app.calls.toasts.at(-1), ["Codex builds your tasks now. This project's team keeps it.", "good"]);
  await pump(app);
  assert.equal(cli().value, "codex", "and the picker shows what the host now holds");
  tier().value = "fast";
  await tier().trigger("change");
  assert.deepEqual(clean(bridge.calls.filter((call) => call[0] === "setAiRouting").at(-1)), ["setAiRouting", { executorTier: "fast" }]);
  assert.deepEqual(app.calls.toasts.at(-1), ["Fast tier saved. This project's team keeps it.", "good"]);
  await pump(app);
  bridge.state.fail.setAiRouting = "No key for that worker.";
  cli().value = "opencode";
  await cli().trigger("change");
  assert.equal(app.calls.toasts.at(-1)[1], "bad");
  assert.match(app.calls.toasts.at(-1)[0], /No key for that worker/);
  await pump(app);
  assert.equal(cli().disabled, false, "a refused save leaves the pickers usable");
});

test("a host with no installed-tools call lists the known workers, and one with no save call leaves the pickers read-only", async () => {
  const bridge = makeBridge({ only: ["workWhere", "getAiRouting", "setAiRouting"], routing: { ok: true, executorCli: "opencode", executorModel: "glm-5.1", executorTier: "bogus" } });
  const app = await makeApp({ saved: "sessions", tasks: [task("a")], bridge });
  await pump(app);
  const cli = app.document.getElementById("builder-worker-cli");
  assert.deepEqual(cli.children.map((option) => option.value), ["opencode", "claude", "codex", "grok", "antigravity"], "no list of installed tools: every known worker, under Antigravity's full name, not its short id");
  assert.equal(cli.children[0].textContent, "OpenCode · glm-5.1");
  assert.equal(app.document.getElementById("builder-worker-tier").value, "auto", "a tier the host does not know reads as Auto");
  const readOnly = await makeApp({ saved: "sessions", tasks: [task("a")], bridge: makeBridge({ only: ["workWhere", "getAiRouting"] }) });
  await pump(readOnly);
  assert.equal(readOnly.document.getElementById("builder-worker-cli").disabled, true);
  assert.equal(readOnly.document.getElementById("builder-worker-tier").disabled, true);
  // A routing that comes back refused shows no worker rather than a wrong one.
  const refused = await makeApp({ saved: "sessions", tasks: [task("a")], bridge: makeBridge({ routing: { ok: false, error: "no" } }) });
  await pump(refused);
  assert.equal(refused.document.getElementById("builder-worker-cli").disabled, true);
});

// ---- the New task page: the greeting and the stats card ---------------------------

const HOST_STATS = { ok: true, projectId: "p1", range: "all", since: null, totals: { tasks: 42, runs: 118, succeeded: 96, verified: 30, tokens: 48200000, activeDays: 21 }, days: [{ day: "2026-07-14", count: 3 }, { day: "2026-07-15", count: 1 }], hours: new Array(24).fill(0), peakHour: 14, models: [{ name: "Claude Code (opus)", runs: 60, tokens: 30000000, wins: 20, losses: 2 }, { name: "glm-5.1", runs: 40, tokens: null, wins: 0, losses: 0 }], store: { ok: true } };
const tilesOf = (app) => Object.fromEntries(app.document.getElementById("builder-home").querySelectorAll(".builder-tile").map((tile) => [tile.querySelector("span").textContent, tile.querySelector("strong").textContent]));

test("New task greets you and shows the host's counts: tasks, runs, tokens, active days, peak hour and top model", async () => {
  const bridge = makeBridge({ stats: HOST_STATS });
  const app = await makeApp({ saved: "sessions", tasks: [task("a")], bridge, storage: new Map([["mefiStudio.workspace.person", "Nate"]]) });
  await pump(app);
  const home = app.document.getElementById("builder-home");
  assert.equal(home.querySelector("h1").textContent, "What's up next, Nate?");
  assert.deepEqual(tilesOf(app), { Tasks: "42", Runs: "118", "Total tokens": "48M", "Active days": "21", "Peak hour": "2 PM", "Top model": "Claude Code (opus)" });
  assert.deepEqual(clean(bridge.calls.filter((call) => call[0] === "workStats")), [["workStats", { projectId: "p1", range: "all" }]]);
  assert.equal(home.querySelector(".builder-flourish").textContent, "Your agents have read and written about 62× War and Peace.");
  assert.ok(!home.querySelector(".builder-flourish").title, "counted from the ledgers, so no board-only note");
  const nameless = await makeApp({ saved: "sessions", tasks: [task("a")], bridge: makeBridge({ stats: HOST_STATS }) });
  await pump(nameless);
  assert.equal(nameless.document.getElementById("builder-home").querySelector("h1").textContent, "What's up next?");
});

test("the stats card's ranges ask the host again, and its Models tab lists each model with its share", async () => {
  const bridge = makeBridge({ stats: HOST_STATS });
  const app = await makeApp({ saved: "sessions", tasks: [task("a")], bridge });
  await pump(app);
  const home = () => app.document.getElementById("builder-home");
  const range = (id) => app.document.getElementById(`builder-stats-range-${id}`);
  assert.deepEqual(["all", "30d", "7d"].map((id) => range(id).getAttribute("aria-pressed")), ["true", "false", "false"]);
  await range("30d").click();
  await pump(app);
  assert.deepEqual(clean(bridge.calls.filter((call) => call[0] === "workStats").at(-1)), ["workStats", { projectId: "p1", range: "30d" }]);
  assert.deepEqual(["all", "30d", "7d"].map((id) => range(id).getAttribute("aria-pressed")), ["false", "true", "false"]);
  await range("7d").click();
  await pump(app);
  assert.equal(bridge.calls.filter((call) => call[0] === "workStats").at(-1)[1].range, "7d");
  // The tabs.
  assert.equal(app.document.getElementById("builder-stats-tab-overview").getAttribute("aria-selected"), "true");
  await app.document.getElementById("builder-stats-tab-models").click();
  assert.equal(app.document.getElementById("builder-stats-tab-models").getAttribute("aria-selected"), "true");
  const rows = home().querySelectorAll(".builder-model-row");
  assert.deepEqual(rows.map((row) => [row.querySelector("b").textContent, row.children[2].textContent]), [
    ["Claude Code (opus)", "60 runs · 30M tokens · 91% verified"],
    ["glm-5.1", "40 runs"],                                                   // no tokens recorded, no verdicts: nothing invented
  ]);
  assert.equal(rows[0].children[1].style["--share"], "60%", "a model's bar is its share of the runs");
  assert.equal(rows[1].children[1].style["--share"], "40%");
  assert.equal(home().querySelectorAll(".builder-tile").length, 0, "the Models tab replaces the tiles");
  await app.document.getElementById("builder-stats-tab-overview").click();
  assert.equal(home().querySelectorAll(".builder-tile").length, 6);
});

test("without the host's counts the card counts from the board and says so; it never invents a number", async () => {
  const tasks = [
    task("a", { createdAt: at(2), lastAttempt: { at: at(2, 15), route: "opencode-go/glm-5.1 · fast tier" }, status: "done", doneAt: at(1), verification: { state: "verified" } }),
    task("b", { createdAt: at(10), lastAttempt: { at: at(9, 10), route: "opencode-go/glm-5.1 · fast tier" } }),
    task("c", { createdAt: at(40) }),
  ];
  for (const bridge of [undefined, makeBridge(), makeBridge({ stats: { ok: false, error: "no ledger" } }), makeBridge({ stats: () => { throw new Error("gone"); } })]) {
    const app = await makeApp({ saved: "sessions", tasks, bridge });
    await pump(app);
    // 3 tasks made, 2 runs (a's and b's last attempts), no token counts at all.
    assert.deepEqual(tilesOf(app), { Tasks: "3", Runs: "2", "Total tokens": "—", "Active days": "5", "Peak hour": "12 PM", "Top model": "opencode-go/glm-5.1 · fast tier" });
    const note = app.document.getElementById("builder-home").querySelector(".builder-flourish");
    assert.equal(note.title, "Counted from this project's board. The desktop app adds runs and tokens from its ledgers.");
    const busiest = new Date(at(2)).toLocaleDateString([], { month: "long", day: "numeric" });
    assert.equal(note.textContent, `Your busiest day was ${busiest}, with 2 moments of work.`, "with no tokens to compare, the card names the busiest day");
  }
  const empty = await makeApp({ saved: "sessions", tasks: [] });
  await pump(empty);
  assert.deepEqual(tilesOf(empty), { Tasks: "0", Runs: "—", "Total tokens": "—", "Active days": "0", "Peak hour": "—", "Top model": "—" });
  assert.equal(empty.document.getElementById("builder-home").querySelector(".builder-flourish").textContent, "Start a task below and this fills in as your agents work.");
});

test("boardStats counts a range from the board alone", async () => {
  const app = await makeApp({ saved: "sessions", tasks: [] });
  const data = { tasks: [
    { id: "a", createdAt: at(2, 9), doneAt: at(1, 9), verification: { state: "verified" }, lastAttempt: { at: at(2, 10), route: "Route A" } },
    { id: "b", createdAt: at(10, 9), lastAttempt: { at: at(9, 9), via: "Route B" } },
    { id: "c", createdAt: at(40, 9), lastAttempt: { at: at(39, 9), route: "Route A" } },
  ] };
  const stats = (range) => app.B.boardStats(data, range, NOW);
  assert.deepEqual(clean([stats("all").tiles.tasks, stats("30d").tiles.tasks, stats("7d").tiles.tasks]), [3, 2, 1]);
  assert.deepEqual(clean([stats("all").tiles.runs, stats("30d").tiles.runs, stats("7d").tiles.runs]), [3, 2, 1]);
  assert.deepEqual(clean([stats("all").verified, stats("7d").verified, stats("7d").source]), [1, 1, "board"]);
  assert.equal(stats("all").tiles.tokens, null, "the board has no token counts");
  assert.deepEqual(clean(stats("all").models.map((model) => [model.name, model.runs])), [["Route A", 2], ["Route B", 1]]);
  assert.equal(stats("7d").tiles.runs, 1);
  assert.equal(stats("all").tiles.topModel, "Route A");
  assert.equal(stats("all").tiles.peakHour, 9);
  assert.equal(app.B.boardStats({ tasks: [] }, "all", NOW).tiles.runs, null, "no runs is unknown, not zero");
});

test("the heatmap is twenty-two weeks of days, a column a week, Sunday on top, and lights each day by its share of the busiest", async () => {
  const app = await makeApp({ saved: "sessions", tasks: [] });
  const key = (daysAgo) => { const d = new Date(at(daysAgo)); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const grid = app.B.heatmap([{ day: key(0), count: 8 }, { day: key(1), count: 4 }, { day: key(2), count: 1 }, { day: key(3), count: 0 }, { day: key(200), count: 5 }], NOW);
  assert.equal(grid.children.length, 22, "twenty-two weeks");
  assert.ok(grid.children.every((week) => week.children.length === 7), "seven days each");
  const cells = grid.children.flatMap((week) => week.children);
  const levels = cells.map((cell) => Number(cell.dataset.level));
  assert.equal(cells.length, 154);
  // 15 July 2026 is a Wednesday: this week's column runs Sunday to Saturday with the future greyed out.
  const thisWeek = grid.children.at(-1).children.map((cell) => Number(cell.dataset.level));
  assert.deepEqual(thisWeek, [0, 1, 2, 4, -1, -1, -1], "Sunday (0 moments), Monday (1), Tuesday (4), today (8, the busiest), then three days that have not come");
  assert.equal(levels.filter((level) => level > 0).length, 3, "three lit days: the 200-day-old one is off the map");
  assert.equal(levels.filter((level) => level === -1).length, 3, "three days of this week are still to come");
  const today = grid.children.at(-1).children[3];
  assert.equal(today.dataset.level, "4");
  assert.match(today.title, /: 8 moments of work$/);
  assert.match(grid.children.at(-1).children[2].title, /: 4 moments of work$/, "yesterday, at half the busiest, is level 2");
  assert.equal(grid.children.at(-1).children[2].dataset.level, "2");
  assert.match(grid.children.at(-1).children[1].title, /: 1 moment of work$/, "singular for one");
  assert.match(grid.children.at(-1).children[0].title, /: no work$/, "a quiet day says so");
  assert.ok(!grid.children.at(-1).children[4].title, "a day that has not come has no tip");
  assert.equal(grid.getAttribute("aria-label"), "Activity over the last 22 weeks: 3 active days.");
  assert.equal(grid.getAttribute("role"), "img");
  const empty = app.B.heatmap([], NOW);
  assert.equal(empty.getAttribute("aria-label"), "Activity over the last 22 weeks: 0 active days.");
  assert.ok(empty.children.flatMap((week) => week.children).every((cell) => cell.dataset.level === "0" || cell.dataset.level === "-1"));
  assert.equal(app.B.heatmap([{ day: key(0), count: 1 }], NOW).getAttribute("aria-label"), "Activity over the last 22 weeks: 1 active day.");
});

// ---- a task as a session -----------------------------------------------------------

/** The two-press confirm studio-ui.js gives a button that ends or drops something. */
const armStub = () => ({ arm(button, { run, armed }) { let ready = false, resting = ""; button.addEventListener("click", (event) => { if (!ready) { ready = true; resting = button.textContent; button.textContent = armed; return; } ready = false; button.textContent = resting; run(event); }); return button; } });

async function open(app, id) {
  app.B.openTask(id);
  await pump(app);
  return app.document.getElementById("builder-task");
}
const feed = (app) => app.document.querySelector("#builder-task .builder-feed").children.map((item) => ({
  kind: item.className.replace(/^builder-feed-item is-/, ""),
  head: item.children[0]?.textContent,
  text: item.querySelector(".builder-brief, .builder-feed-text")?.textContent ?? null,
  facts: item.querySelector(".builder-feed-facts")?.textContent ?? null,
  why: item.querySelector(".builder-feed-why")?.textContent ?? null,
  outcome: item.dataset.outcome ?? null,
  node: item,
}));
const buttons = (box) => box.querySelectorAll("button").map((node) => node.textContent || node.getAttribute("aria-label"));
const byLabel = (box, label) => box.querySelectorAll("button").find((node) => node.getAttribute("aria-label") === label) ?? null;

const DONE_TASK = () => task("s1", {
  title: "Add a sitemap", prompt: "Generate sitemap.xml from the routes.", acceptance: ["sitemap.xml exists", "routes are listed"], status: "done",
  createdAt: at(3), doneAt: at(1), updatedAt: at(1),
  logs: [{ at: at(3), text: "Task created" }, { at: at(3, 13), kind: "note", text: "Prefer the static generator" }, { at: at(2, 9), kind: "result", text: "Wrote sitemap.xml" }, { at: at(2, 10), text: "Started run" }, { at: at(2, 10, 30), text: "   " }],
  verification: { state: "verified", at: at(1, 9), reason: "21 tests passed" },
});
const ATTEMPTS = [
  { runId: "r1", outcome: "failed", startedAt: at(2, 11), seconds: 95, via: "claude cli · main", error: "Tests failed", tail: ["npm test", "1 failing"] },
  { runId: "r2", outcome: "finished-ok", startedAt: at(2, 14), seconds: 3700, via: "opencode-go/glm-5.1", result: "Done.", tail: ["ok"], fallbacks: [{ from: "claude" }] },
];

test("a task opens as a session: its brief, each note, every run and what it said, Mefi's notices and the verdict, in the order they happened", async () => {
  const bridge = makeBridge({ attempts: ATTEMPTS });
  const messages = [{ role: "assistant", kind: "notice", taskId: "s1", at: at(2, 12), text: "Retrying on OpenCode" }, { role: "assistant", kind: "notice", taskId: "other", at: at(2, 12), text: "Not this task" }, { role: "assistant", text: "A chat reply", at: at(2, 12) }];
  const app = await makeApp({ saved: "sessions", tasks: [DONE_TASK()], bridge, messages });
  await pump(app);
  const box = await open(app, "s1");
  assert.deepEqual(clean(app.calls.selected), [{ taskId: "s1", projectId: "p1", title: "Task s1" }].map((row) => ({ ...row, title: "Add a sitemap" })));
  assert.deepEqual(clean(bridge.calls.filter((call) => call[0] === "tasksAttempts")), [["tasksAttempts", { taskId: "s1", projectId: "p1" }]], "its runs are read once, not on every repaint");

  const head = box.querySelector(".builder-task-head");
  assert.equal(head.querySelector(".builder-pill").textContent, "Done");
  assert.equal(head.querySelector(".builder-pill").dataset.tone, "done");
  assert.equal(head.querySelector("h1").textContent, "Add a sitemap");
  assert.equal(head.querySelector(".builder-task-facts").textContent, "Started 3d ago · 2 runs");
  assert.deepEqual(buttons(head.querySelector(".builder-task-actions")), ["Request a change", "Pin this task", "Open on the task board"]);

  const items = feed(app);
  assert.deepEqual(items.map((item) => [item.kind, item.head]), [
    ["brief", "You asked"], ["note", "Note"], ["result", "Result"], ["log", "Update"], ["run", "Failed"], ["notice", "Mefi"], ["run", "Reported done"], ["verdict", "Verified"],
  ], "the clock decides the order, whatever kind it is; a blank line and 'Task created' are left out");
  assert.equal(items[0].text, "Generate sitemap.xml from the routes.");
  assert.deepEqual(items[0].node.querySelectorAll("li").map((li) => li.textContent), ["sitemap.xml exists", "routes are listed"], "the brief carries what it must pass");
  assert.equal(items[0].node.querySelector("small").textContent, "Done when");
  assert.equal(items[1].text, "Prefer the static generator");
  assert.equal(items[2].text, "Wrote sitemap.xml");
  assert.equal(items[3].text, "Started run");
  assert.equal(items[4].facts, "claude cli · main · took 2m");
  assert.equal(items[4].why, "Tests failed");
  assert.equal(items[4].outcome, "failed");
  assert.equal(items[4].node.querySelector("details.builder-said summary").textContent, "What it said");
  assert.equal(items[4].node.querySelector("details pre").textContent, "npm test\n1 failing");
  assert.equal(items[5].text, "Retrying on OpenCode", "Mefi's notice for this task, not another's, and not a chat reply");
  assert.equal(items[6].facts, "opencode-go/glm-5.1 · took 1h 2m · 1 fallback");
  assert.equal(items[6].text, "Done.");
  assert.equal(items[7].text, "21 tests passed");
  assert.equal(items[7].outcome, "finished-ok");
  assert.ok(items.every((item) => item.node.querySelector("time")), "every entry says when");
  assert.equal(box.querySelector(".builder-status-card").dataset.tone, "done");
});

test("a brief that already says when it is done is not followed by the list a second time", async () => {
  const brief = task("s2", { title: "Sitemap", prompt: "Generate sitemap.xml.\n\nDone when: it lists every route.", acceptance: ["it lists every route"], createdAt: at(1), updatedAt: at(1) });
  const app = await makeApp({ saved: "sessions", tasks: [brief], bridge: makeBridge() });
  await pump(app);
  await open(app, "s2");
  assert.equal(feed(app)[0].node.querySelectorAll("li").length, 0, "the words already carry the checks");
  const plain = task("s3", { title: "Other", prompt: "Make it faster.", acceptance: ["it is faster"], createdAt: at(1), updatedAt: at(1) });
  const app2 = await makeApp({ saved: "sessions", tasks: [plain], bridge: makeBridge() });
  await pump(app2);
  await open(app2, "s3");
  assert.deepEqual(feed(app2)[0].node.querySelectorAll("li").map((li) => li.textContent), ["it is faster"]);
  // A brief written by an agent says so.
  const agent = task("s4", { title: "By agent", prompt: "Refactor.", origin: "agent", createdAt: at(1), updatedAt: at(1) });
  const app3 = await makeApp({ saved: "sessions", tasks: [agent], bridge: makeBridge() });
  await pump(app3);
  await open(app3, "s4");
  assert.equal(feed(app3)[0].head, "An agent asked");
});

test("a task whose run is live shows Working now with its step and output, and Output opens the pane", async () => {
  const live = task("s5", { title: "Validate Snake", prompt: "Validate.", status: "active", runId: "run-9", createdAt: at(0, 9), updatedAt: at(0, 14), runProgress: { runId: "run-9", outputTail: ["a", "b", "c", "d", "e", "f", "g", "h"] } });
  const bridge = makeBridge({ attempts: [{ runId: "run-9", outcome: "unrecorded", startedAt: at(0, 13), via: "claude cli · main" }] });
  const app = await makeApp({ saved: "sessions", tasks: [live], stages: { s5: "running" }, running: [{ taskId: "s5", runId: "run-9", currentStep: "Bash running · npm test", route: "Fixture builder", progress: 0.4, phase: "running" }], bridge });
  await pump(app);
  const box = await open(app, "s5");
  const items = feed(app);
  assert.deepEqual(items.map((item) => [item.kind, item.head]), [["brief", "You asked"], ["run", "Working now"], ["live", "Working now"]], "the open run reads as live, and one live entry ends the feed");
  assert.equal(items[1].outcome, "running");
  assert.equal(items[2].text, "Bash running · npm test");
  assert.equal(items[2].node.querySelector(".builder-live-tail").textContent, "c\nd\ne\nf\ng\nh", "the last six lines");
  const progress = box.querySelector("progress.builder-progress");
  assert.equal(progress.value, 0.4);
  assert.equal(progress.getAttribute("aria-label"), "Reported progress: 40 percent");
  assert.equal(box.querySelector(".builder-task-facts").textContent.includes("Fixture builder"), true, "the worker's route is in the facts");
  assert.deepEqual(buttons(box.querySelector(".builder-task-actions")), ["Stop", "Watch live", "Pin this task", "Open on the task board"], "a running task cannot be dropped");
  const more = items[2].node.querySelector("button");
  assert.equal(more.textContent, "Output");
  await more.click();
  assert.equal(app.window.MefiPanes.where("output"), "dock", "the Output pane opens beside the page");
  await pump(app);
  assert.equal(app.document.getElementById("builder-output").querySelector(".builder-output-log").textContent, "a\nb\nc\nd\ne\nf\ng\nh");
  assert.match(app.document.getElementById("builder-output").querySelector(".builder-pane-lead").textContent, /Validate Snake · Bash running · npm test/);
});

test("Stop and Watch live act on the running task, and the buttons wait while a call is out", async () => {
  const live = task("s5", { title: "Validate Snake", prompt: "Validate.", status: "active", runId: "run-9", createdAt: at(0, 9), updatedAt: at(0, 14) });
  const bridge = makeBridge();
  const app = await makeApp({ saved: "sessions", tasks: [live], stages: { s5: "running" }, running: [{ taskId: "s5", runId: "run-9" }], bridge });
  app.window.MefiUi = armStub();
  await pump(app);
  const box = await open(app, "s5");
  const action = (label) => box.querySelectorAll(".builder-task-actions button").find((node) => node.textContent === label);
  await action("Watch live").click();
  assert.deepEqual(clean(app.calls.go.at(-1)), ["command", { taskId: "s5", projectId: "p1", selected: "task:s5", rail: "work", }].map((value, index) => (index === 1 ? { ...value } : value)));
  await action("Stop").click();
  assert.notEqual(action("Stop it?"), undefined, "the first press only asks");
  assert.equal(bridge.calls.filter((call) => call[0] === "tasksAction").length, 0);
  await action("Stop it?").click();
  await app.env.settle();
  assert.deepEqual(clean(bridge.calls.filter((call) => call[0] === "tasksAction")), [["tasksAction", { taskId: "s5", projectId: "p1", action: "stop" }]]);
  assert.deepEqual(app.calls.toasts.at(-1), ["Stopped. Its progress is saved.", "good"]);
  assert.ok(app.calls.refresh >= 1, "and Home reads the board again");
  // A refusal is said in words and leaves the button usable.
  bridge.state.fail.tasksAction = "That worker already finished.";
  await pump(app);
  await action("Stop").click();
  await action("Stop it?").click();
  await app.env.settle();
  assert.equal(app.calls.toasts.at(-1)[1], "bad");
  assert.match(app.calls.toasts.at(-1)[0], /already finished/);
});

test("a decision the task waits on is asked on the session, with its options and a box for your own words", async () => {
  const waiting = task("s6", { title: "Pick a theme", prompt: "Which palette?", createdAt: at(1), updatedAt: at(1) });
  const LONG = "Sand and a very long option label that goes on and on past sixty characters for sure";
  const question = { id: "q9", status: "open", context: { taskId: "s6" }, question: "Which palette should the menus use?", detail: "It changes every screenshot.", options: [{ id: "sage", label: "Sage", recommended: true, description: "Calm greens" }, { id: "sand", label: LONG }] };
  const bridge = makeBridge();
  const app = await makeApp({ saved: "sessions", tasks: [waiting], questions: [question], bridge });
  await pump(app);
  const box = await open(app, "s6");
  const card = box.querySelector(".builder-question");
  assert.equal(card.querySelector(".builder-kicker").textContent, "Needs your answer");
  assert.equal(card.querySelector("h2").textContent, "Which palette should the menus use?");
  assert.equal(card.querySelector("p").textContent, "It changes every screenshot.");
  const options = card.querySelectorAll(".builder-options button");
  assert.deepEqual(options.map((option) => [option.textContent.slice(0, 4), option.className, option.title || ""]), [["Sage", "primary mini", "Calm greens"], ["Sand", "ghost mini", ""]], "the recommended option leads");
  await options[0].click();
  await app.env.settle();
  assert.deepEqual(clean(bridge.calls.filter((call) => call[0] === "assistantAnswer")), [["assistantAnswer", { id: "q9", optionId: "sage" }]]);
  assert.deepEqual(app.calls.toasts.at(-1), ["Answered: Sage. Mefi carries on.", "good"]);
  await pump(app);
  await card.querySelectorAll(".builder-options button")[1].click();
  await app.env.settle();
  assert.equal(app.calls.toasts.at(-1)[0], `Answered: ${LONG.slice(0, 57)}…. Mefi carries on.`, "a long label is cut to fit the toast");
  assert.ok(LONG.length > 60, "the label really is longer than the toast holds");
  // In your own words.
  await pump(app);
  const own = box.querySelector(".builder-own-answer");
  const input = own.querySelector("input");
  await own.trigger("submit", {});
  assert.equal(input.focused, true, "an empty answer sends nothing and asks for words");
  input.value = "Something warmer, please";
  await own.trigger("submit", {});
  await app.env.settle();
  assert.deepEqual(clean(bridge.calls.filter((call) => call[0] === "assistantAnswer").at(-1)), ["assistantAnswer", { id: "q9", text: "Something warmer, please" }]);
  assert.equal(box.querySelector(".builder-status-card").dataset.tone, "ask");
});

test("what you can do with a task follows where it is: start, approve, try again, resume, request a change, drop", async () => {
  const board = [
    task("ready", { title: "Ready", createdAt: at(1), updatedAt: at(1) }),
    task("resumable", { title: "Resumable", continuation: { note: "x" }, createdAt: at(1), updatedAt: at(1) }),
    task("approval", { title: "Approval", buildScope: "scope-1", createdAt: at(1), updatedAt: at(1) }),
    task("blocked", { title: "Blocked", createdAt: at(1), updatedAt: at(1) }),
    task("owner", { title: "Owner held", createdAt: at(1), updatedAt: at(1) }),
    task("failed", { title: "Failed check", verification: { state: "failed" }, createdAt: at(1), updatedAt: at(1) }),
    task("finished", { title: "Finished", status: "done", createdAt: at(2), doneAt: at(1), updatedAt: at(1) }),
    task("checking", { title: "Checking", status: "awaiting_verification", createdAt: at(1), updatedAt: at(1) }),
    task("claimed", { title: "Claimed", runId: "r-claimed", createdAt: at(1), updatedAt: at(1) }),
    task("working", { title: "Working", createdAt: at(1), updatedAt: at(1) }),
  ];
  const stages = { approval: "approval", blocked: "blocked", checking: "review" };
  const backlog = { taskStates: [{ id: "approval", buildScope: "scope-2" }, { id: "owner", blockedBy: "owner" }] };
  const bridge = makeBridge();
  const started = [];
  const app = await makeApp({ saved: "sessions", tasks: board, stages, backlog, bridge, preview: { phase: "ready" }, running: [{ taskId: "working", runId: "r-w" }] });
  app.window.MefiUi = armStub();
  app.window.MefiAutonomy = { mount() {}, state: () => ({ level: "ask" }) };
  app.window.MefiWorkspace.startTask = (row) => { started.push(row.id); return Promise.resolve(); };
  app.window.MefiWorkspace.previewAction = (name) => started.push(`preview:${name}`);
  await pump(app);
  const labels = async (id) => { const box = await open(app, id); return buttons(box.querySelector(".builder-task-actions")); };
  assert.deepEqual(await labels("ready"), ["Start", "Pin this task", "Open on the task board", "Drop this task"]);
  assert.deepEqual(await labels("resumable"), ["Resume", "Pin this task", "Open on the task board", "Drop this task"], "a task with saved progress resumes");
  assert.deepEqual(await labels("approval"), ["Approve build", "Pin this task", "Open on the task board", "Drop this task"]);
  assert.deepEqual(await labels("blocked"), ["Try again", "Pin this task", "Open on the task board", "Drop this task"]);
  assert.deepEqual(await labels("owner"), ["Resume", "Pin this task", "Open on the task board", "Drop this task"], "held by you: Resume, not Try again");
  assert.deepEqual(await labels("failed"), ["Try again", "Pin this task", "Open on the task board", "Drop this task"]);
  assert.deepEqual(await labels("finished"), ["Open app", "Request a change", "Pin this task", "Open on the task board"], "a finished task can be followed up, and its app opened when it is running");
  assert.deepEqual(await labels("checking"), ["Pin this task", "Open on the task board"], "while checks run there is nothing to press but the task's own pages");
  assert.deepEqual(await labels("claimed"), ["Start", "Pin this task", "Open on the task board"], "a task a worker has claimed cannot be dropped out from under it");
  assert.deepEqual(await labels("working"), ["Stop", "Watch live", "Pin this task", "Open on the task board"], "nor one with a live run");

  const act = async (id, label) => { const box = await open(app, id); await box.querySelectorAll(".builder-task-actions button").find((node) => node.textContent === label).click(); await app.env.settle(); };
  await act("ready", "Start");
  assert.deepEqual(started, ["ready"], "Start goes through Home's own start, so it is one call however it is asked");
  await act("approval", "Approve build");
  assert.deepEqual(clean(bridge.calls.filter((call) => call[0] === "backlogControl")), [["backlogControl", { action: "approve", taskId: "approval", projectId: "p1", expectedScope: "scope-2" }]], "approval names the scope it was shown, so a changed plan is not approved by mistake");
  assert.deepEqual(app.calls.toasts.at(-1), ["Approved. It builds when a worker is free.", "good"]);
  app.window.MefiAutonomy = { mount() {}, state: () => ({ level: "accept" }) };
  app.B.refresh(); app.env.flush();
  assert.deepEqual(await labels("approval"), ["Accept this task", "Pin this task", "Open on the task board", "Drop this task"], "in accept mode the same button says so");
  await act("blocked", "Try again");
  await act("owner", "Resume");
  assert.deepEqual(clean(bridge.calls.filter((call) => call[0] === "tasksAction")), [["tasksAction", { taskId: "blocked", projectId: "p1", action: "retry" }], ["tasksAction", { taskId: "owner", projectId: "p1", action: "retry" }]]);
  await act("finished", "Open app");
  assert.equal(started.at(-1), "preview:open");
  // Drop asks first, then says how to undo it.
  const box = await open(app, "ready");
  const drop = () => byLabel(box, "Drop this task");
  await drop().click();
  assert.equal(bridge.calls.filter((call) => call[0] === "tasksAction" && call[1].action === "drop").length, 0, "the first press only asks");
  await drop().click();
  await app.env.settle();
  assert.deepEqual(clean(bridge.calls.filter((call) => call[0] === "tasksAction" && call[1].action === "drop")), [["tasksAction", { taskId: "ready", projectId: "p1", action: "drop" }]]);
  assert.match(app.calls.toasts.at(-1)[0], /^Dropped\. Reopen it from the board/);
  // The task board button goes to the board with this task selected.
  await byLabel(box, "Open on the task board").click();
  assert.deepEqual(clean(app.calls.go.at(-1)), ["tasks", { taskId: "ready", projectId: "p1", filter: "all" }]);
});

test("pinning a task lifts it to the top of the menu, and only the latest forty pins are kept", async () => {
  const app = await makeApp({ saved: "sessions", tasks: [task("a", { updatedAt: at(5) }), task("b", { updatedAt: at(1) })], bridge: makeBridge() });
  await pump(app);
  const box = await open(app, "a");
  const pin = () => byLabel(box, "Pin this task") ?? byLabel(box, "Unpin this task");
  assert.equal(pin().getAttribute("aria-pressed"), "false");
  assert.equal(pin().title, "Pin to the top of the menu");
  await pin().click();
  app.env.flush();
  assert.deepEqual(JSON.parse(app.storage.get("mefiStudio.builder.pins.p1")), ["a"]);
  assert.deepEqual(menuOf(app).slice(0, 5), ["[head]", "__chat/chat", "# Pinned", "a/ready", "# Today"].slice(0, 4).concat(menuOf(app).slice(4, 5)), "Pinned heads the list");
  assert.equal(menuOf(app).indexOf("# Pinned") < menuOf(app).indexOf("b/ready"), true);
  assert.equal(pin().getAttribute("aria-pressed"), "true");
  assert.equal(pin().title, "Unpin from the top of the menu");
  assert.equal(pin().getAttribute("aria-label"), "Unpin this task");
  await pin().click();
  app.env.flush();
  assert.deepEqual(JSON.parse(app.storage.get("mefiStudio.builder.pins.p1")), []);
  assert.ok(!menuOf(app).includes("# Pinned"));
  const many = await makeApp({ saved: "sessions", tasks: [task("t0")], bridge: makeBridge(), storage: new Map([["mefiStudio.builder.pins.p1", JSON.stringify(Array.from({ length: 45 }, (_, index) => `old-${index}`))]]) });
  await pump(many);
  const manyBox = await open(many, "t0");
  await byLabel(manyBox, "Pin this task").click();
  const kept = JSON.parse(many.storage.get("mefiStudio.builder.pins.p1"));
  assert.equal(kept.length, 40);
  assert.equal(kept.at(-1), "t0", "the newest pin is kept");
  assert.equal(kept[0], "old-6", "the oldest go first");
  // Pins that are not text are not pins.
  const odd = await makeApp({ saved: "sessions", tasks: [task("a"), task("b")], storage: new Map([["mefiStudio.builder.pins.p1", JSON.stringify([1, null, "a", {}])]]), bridge: makeBridge() });
  await pump(odd);
  assert.ok(menuOf(odd).includes("# Pinned"), "the one real pin still counts");
  const oddBox = await open(odd, "b");
  await byLabel(oddBox, "Pin this task").click();
  assert.deepEqual(JSON.parse(odd.storage.get("mefiStudio.builder.pins.p1")), ["a", "b"], "and what is written back is only task ids");
});

test("a task that is gone says so and offers a new one", async () => {
  const app = await makeApp({ saved: "sessions", tasks: [task("a")], bridge: makeBridge() });
  await pump(app);
  const box = await open(app, "gone");
  assert.equal(box.querySelector("h2").textContent, "This task is no longer on the board");
  assert.equal(box.querySelector("p").textContent, "It may have been deleted, or it belongs to another project.");
  await box.querySelector("button").click();
  assert.deepEqual(clean(app.calls.go.at(-1)), ["workspace", { view: "home" }]);
  assert.deepEqual(clean(app.B.view()), { view: "home", taskId: null });
  assert.equal(app.calls.composerMode.at(-1), "work", "and Home's composer is set to make a task");
});

// ---- the session's own composer: Note, Ask, Change ---------------------------------

const composerOf = (app) => ({
  form: app.document.getElementById("builder-task-compose"),
  input: app.document.getElementById("builder-task-input"),
  send: app.document.getElementById("builder-task-send"),
  hint: app.document.getElementById("builder-intent-hint"),
  intent: (id) => app.document.getElementById(`builder-intent-${id}`),
});
const pressed = (c) => ["note", "ask", "change"].filter((id) => c.intent(id).getAttribute("aria-pressed") === "true");
const say = async (app, words) => { const c = composerOf(app); c.input.value = words; await c.input.trigger("input", {}); };
const submit = async (app) => { await composerOf(app).form.trigger("submit", {}); await app.env.settle(); await app.env.settle(); };

test("a task's composer starts on what fits: Change on a finished task, Ask while a worker runs, Note on the rest", async () => {
  const live = task("live", { title: "Live", status: "active", runId: "r", createdAt: at(1), updatedAt: at(0, 14) });
  const app = await makeApp({ saved: "sessions", tasks: [DONE_TASK(), live, task("queued", { title: "Queued", createdAt: at(1), updatedAt: at(1) })], stages: { live: "running" }, running: [{ taskId: "live", runId: "r" }], bridge: makeBridge() });
  await pump(app);
  assert.equal(composerOf(app).form.hidden, true, "no task composer on the New task page");
  assert.equal(app.page.form.hidden, false);
  await open(app, "s1");
  const c = composerOf(app);
  assert.equal(c.form.hidden, false, "a task shows its own composer");
  assert.equal(app.page.form.hidden, true, "in place of Home's");
  assert.deepEqual(pressed(c), ["change"]);
  assert.equal(c.input.placeholder, "Describe the change you want…");
  assert.equal(c.hint.textContent, "Makes a new task linked to this one");
  assert.equal(c.send.textContent, "Create follow-up");
  await open(app, "live");
  assert.deepEqual(pressed(c), ["ask"]);
  assert.equal(c.input.placeholder, "Ask Mefi about this task…");
  assert.equal(c.hint.textContent, "Mefi answers here and in the chat");
  assert.equal(c.send.textContent, "Ask");
  await open(app, "queued");
  assert.deepEqual(pressed(c), ["note"]);
  assert.equal(c.input.placeholder, "Tell it something for its next run…");
  assert.equal(c.hint.textContent, "Its next run reads this");
  assert.equal(c.send.textContent, "Save note");
  assert.equal(c.intent("note").title, "A note its next run reads");
  await c.intent("ask").click();
  assert.deepEqual(pressed(c), ["ask"], "you can always choose another");
  assert.equal(c.input.focused, true, "and the box takes focus");
  // The prompt names the companion the owner chose, and a note while it runs says it is read by the next run.
  app.storage.set("mefiStudio.workspace.companion", "Pip");
  app.B.refresh(); app.env.flush();
  assert.equal(c.input.placeholder, "Ask Pip about this task…");
  assert.equal(c.hint.textContent, "Pip answers here and in the chat");
  await open(app, "live");
  await c.intent("note").click();
  assert.equal(c.hint.textContent, "Saved now, read by its next run");
});

test("each task and each purpose keeps its own unsent words", async () => {
  const app = await makeApp({ saved: "sessions", tasks: [DONE_TASK(), task("queued", { title: "Queued", createdAt: at(1), updatedAt: at(1) })], bridge: makeBridge() });
  await pump(app);
  await open(app, "s1");
  const c = composerOf(app);
  await say(app, "make it XML only");
  await c.intent("note").click();
  assert.equal(c.input.value, "", "a different purpose starts empty");
  await say(app, "remember the trailing slash");
  await c.intent("change").click();
  assert.equal(c.input.value, "make it XML only", "and the earlier words are still there");
  await open(app, "queued");
  assert.equal(c.input.value, "", "another task has its own box");
  await say(app, "second task's note");
  await open(app, "s1");
  await c.intent("note").click();
  assert.equal(c.input.value, "remember the trailing slash");
  await open(app, "queued");
  assert.equal(c.input.value, "second task's note");
});

test("a note is saved on the task with what it says, dated, and the next run reads it", async () => {
  const older = task("n1", { title: "Notable", createdAt: at(1), updatedAt: at(1), notes: "- first thing\n", logs: Array.from({ length: 40 }, (_, index) => ({ at: at(1, 8, index), text: `log ${index}` })) });
  const bridge = makeBridge();
  const app = await makeApp({ saved: "sessions", tasks: [older], bridge });
  await pump(app);
  await open(app, "n1");
  const c = composerOf(app);
  await say(app, "Prefer the static generator");
  await submit(app);
  const saved = clean(bridge.calls.find((call) => call[0] === "tasksSave")[1]);
  assert.equal(saved.length, 1, "one task row goes to the host");
  assert.equal(saved[0].id, "n1");
  assert.equal(saved[0].notes, "- first thing\n- Prefer the static generator", "appended under what was already noted");
  assert.deepEqual(saved[0].logs.at(-1), { at: NOW, kind: "note", text: "Prefer the static generator" });
  assert.equal(saved[0].logs.length, 40, "the log keeps its latest forty");
  assert.equal(saved[0].logs[0].text, "log 1", "the oldest one made room");
  assert.equal(saved[0].updatedAt, NOW);
  assert.ok(!("__reading" in saved[0]), "the menu's own bookkeeping never goes to the host");
  assert.deepEqual(app.calls.toasts.at(-1), ["Saved. Its next run reads it.", "good"]);
  assert.equal(c.input.value, "", "the box empties once it is saved");
  app.env.flush();
  assert.equal(c.send.disabled, false);
  assert.equal(c.send.textContent, "Save note");
  assert.ok(app.calls.refresh >= 1, "Home reads the board again");
  // Long notes keep their tail, so the newest words are never the ones lost.
  const long = task("n2", { title: "Long", createdAt: at(1), updatedAt: at(1), notes: "x".repeat(4100) });
  const b2 = makeBridge();
  const app2 = await makeApp({ saved: "sessions", tasks: [long], bridge: b2 });
  await pump(app2);
  await open(app2, "n2");
  await say(app2, "the newest words");
  await submit(app2);
  const notes = clean(b2.calls.find((call) => call[0] === "tasksSave")[1])[0].notes;
  assert.equal(notes.length, 4000);
  assert.ok(notes.endsWith("- the newest words"));
  // A refused save says why and keeps your words.
  const b3 = makeBridge({ fail: { tasksSave: "This task has a worker running." } });
  const app3 = await makeApp({ saved: "sessions", tasks: [task("n3", { title: "Busy", createdAt: at(1), updatedAt: at(1) })], bridge: b3 });
  await pump(app3);
  await open(app3, "n3");
  await say(app3, "keep me");
  await submit(app3);
  assert.equal(app3.calls.toasts.at(-1)[1], "bad");
  assert.match(app3.calls.toasts.at(-1)[0], /worker running/);
  assert.equal(composerOf(app3).input.value, "keep me", "the words are still there to try again");
  app3.env.flush();
  assert.equal(composerOf(app3).send.disabled, false, "and Send is usable again");
});

test("Ask puts your words to Mefi about this task, shows that it is thinking, and shows the reply under them", async () => {
  let release;
  const bridge = makeBridge({ gate: new Promise((resolve) => { release = resolve; }), reply: { ok: true, state: { messages: [{ role: "assistant", at: NOW + 1000, text: "The sitemap is done." }, { role: "assistant", kind: "notice", at: NOW + 2000, text: "A notice, not the answer" }] } } });
  const app = await makeApp({ saved: "sessions", tasks: [DONE_TASK()], bridge });
  await pump(app);
  await open(app, "s1");
  const c = composerOf(app);
  await c.intent("ask").click();
  await say(app, "Did you include the blog routes?");
  const sending = submit(app);
  await app.env.settle();
  app.env.flush();
  assert.deepEqual(clean(bridge.calls.find((call) => call[0] === "assistantMessage")), ["assistantMessage", "About the task \"Add a sitemap\" (s1): Did you include the blog routes?", "p1", { view: "Build · task", companion: "Mefi", taskId: "s1" }]);
  assert.equal(c.send.textContent, "Sending…", "while it is out");
  assert.equal(c.send.disabled, true);
  const asked = feed(app).find((item) => item.head === "You asked" && item.text === "Did you include the blog routes?");
  assert.ok(asked, "your question is in the feed at once");
  assert.equal(asked.node.querySelector(".builder-feed-note").textContent, "Mefi is thinking…");
  await say(app, "a second question while the first is out");
  await submit(app);
  assert.equal(bridge.calls.filter((call) => call[0] === "assistantMessage").length, 1, "one question at a time");
  await c.intent("note").click();
  await say(app, "a note I am writing meanwhile");
  release();
  await sending;
  await app.env.settle();
  await pump(app);
  assert.equal(c.input.value, "a note I am writing meanwhile", "an answer that lands does not empty a box you moved on to");
  await c.intent("ask").click();
  const answered = feed(app).find((item) => item.text === "Did you include the blog routes?");
  assert.equal(answered.node.querySelector(".builder-reply").textContent, "The sitemap is done.", "the reply, not the notice");
  assert.equal(answered.node.querySelector(".builder-reply-who").textContent, "Mefi");
  assert.equal(answered.node.querySelector(".builder-feed-note"), null, "the thinking line is gone");
  assert.equal(c.send.textContent, "Ask");
  assert.equal(c.send.disabled, false);

  // No reply in the answer: the chat has it.
  const plain = makeBridge({ reply: { ok: true, state: { messages: [] } } });
  const app2 = await makeApp({ saved: "sessions", tasks: [task("q", { title: "Q", createdAt: at(1), updatedAt: at(1), status: "active", runId: "r" })], stages: { q: "running" }, running: [{ taskId: "q", runId: "r" }], bridge: plain });
  await pump(app2);
  await open(app2, "q");
  await say(app2, "How is it going?");
  await submit(app2);
  await pump(app2);
  assert.equal(feed(app2).find((item) => item.text === "How is it going?").node.querySelector(".builder-reply").textContent, "Sent. The reply is in the chat.");
  // An error is shown under the question and toasted.
  const broken = makeBridge({ fail: { assistantMessage: "Mefi is offline." } });
  const app3 = await makeApp({ saved: "sessions", tasks: [task("q", { title: "Q", createdAt: at(1), updatedAt: at(1), status: "active", runId: "r" })], stages: { q: "running" }, running: [{ taskId: "q", runId: "r" }], bridge: broken });
  await pump(app3);
  await open(app3, "q");
  await say(app3, "Anyone there?");
  await submit(app3);
  await pump(app3);
  assert.equal(feed(app3).find((item) => item.text === "Anyone there?").node.querySelector(".builder-feed-why").textContent, "Mefi is offline.");
  assert.equal(app3.calls.toasts.at(-1)[1], "bad");
  assert.equal(composerOf(app3).input.value, "Anyone there?", "and the question is still in the box");
});

test("Change makes a follow-up task that names this one and what you want changed", async () => {
  const bridge = makeBridge();
  const app = await makeApp({ saved: "sessions", tasks: [DONE_TASK()], bridge });
  await pump(app);
  await open(app, "s1");
  await say(app, "Make it XML only\nand skip drafts\n" + "x".repeat(300));
  await submit(app);
  const [, payload] = clean(bridge.calls.find((call) => call[0] === "tasksCreate"));
  assert.equal(payload.projectId, "p1");
  assert.equal(payload.title, "Change: Make it XML only", "the title is the first line");
  assert.equal(payload.prompt, `Follow-up to task "Add a sitemap" (s1).\n\nRequested change:\nMake it XML only\nand skip drafts\n${"x".repeat(300)}`, "the brief carries all of it and says which task it follows");
  assert.deepEqual(app.calls.toasts.at(-1), ["Follow-up task created. It shows in the menu.", "good"]);
  assert.equal(composerOf(app).input.value, "");
  const long = makeBridge();
  const app2 = await makeApp({ saved: "sessions", tasks: [DONE_TASK()], bridge: long });
  await pump(app2);
  await open(app2, "s1");
  await say(app2, "y".repeat(400));
  await submit(app2);
  assert.equal(clean(long.calls.find((call) => call[0] === "tasksCreate")[1]).title.length, 180, "a title is kept to 180 characters");
  const refused = makeBridge({ fail: { tasksCreate: "That looks like a duplicate." } });
  const app3 = await makeApp({ saved: "sessions", tasks: [DONE_TASK()], bridge: refused });
  await pump(app3);
  await open(app3, "s1");
  await say(app3, "again");
  await submit(app3);
  assert.match(app3.calls.toasts.at(-1)[0], /duplicate/);
  assert.equal(composerOf(app3).input.value, "again");
});

test("Enter sends, Shift+Enter and composing do not, and words are needed", async () => {
  const bridge = makeBridge();
  const app = await makeApp({ saved: "sessions", tasks: [task("n", { title: "N", createdAt: at(1), updatedAt: at(1) })], bridge });
  await pump(app);
  await open(app, "n");
  const c = composerOf(app);
  const enter = async (extra = {}) => { let prevented = false; await c.input.trigger("keydown", { key: "Enter", preventDefault: () => { prevented = true; }, ...extra }); await app.env.settle(); await app.env.settle(); return prevented; };
  const saves = () => bridge.calls.filter((call) => call[0] === "tasksSave").length;
  await say(app, "with shift");
  assert.equal(await enter({ shiftKey: true }), false, "Shift+Enter is a new line");
  assert.equal(saves(), 0);
  assert.equal(await enter({ isComposing: true }), false, "Enter that picks a suggestion is not a send");
  assert.equal(saves(), 0);
  assert.equal(await enter({ key: "a" }), false);
  await say(app, "   ");
  assert.equal(await enter(), true, "Enter is taken from the box even with nothing to send");
  assert.equal(saves(), 0, "blank words are not a note");
  await say(app, "a real note");
  assert.equal(await enter(), true);
  assert.equal(saves(), 1, "Enter sends");
});

// ---- moving between New task, Chat and a task ---------------------------------------

test("New task, Chat with Mefi and a change request each set Home up for what they are", async () => {
  const app = await makeApp({ saved: "sessions", tasks: [DONE_TASK()], bridge: makeBridge() });
  await pump(app);
  app.B.openChat();
  assert.deepEqual(clean(app.calls.go.at(-1)), ["workspace", { view: "chat" }]);
  assert.equal(app.calls.composerMode.at(-1), "chat", "Home's composer is set to chat");
  assert.equal(app.page.layer.dataset.view, "chat");
  app.B.newTask();
  assert.deepEqual(clean(app.calls.go.at(-1)), ["workspace", { view: "home" }]);
  assert.equal(app.calls.composerMode.at(-1), "work", "New task is Home's composer set to make a task");
  assert.equal(app.page.layer.dataset.view, "home");
  assert.equal(app.B.requestChange({}), false, "a change needs a task");
  assert.equal(app.B.requestChange(null), false);
  assert.equal(app.B.requestChange(app.state.data.tasks[0]), true);
  await pump(app);
  assert.deepEqual(clean(app.B.view()), { view: "task", taskId: "s1" });
  assert.deepEqual(pressed(composerOf(app)), ["change"], "a change request opens the task with the composer set to make a follow-up");
  assert.equal(composerOf(app).input.focused, true);
  // From an open task, "Request a change" is the same.
  app.B.openTask("s1", { intent: "ask" });
  await pump(app);
  assert.deepEqual(pressed(composerOf(app)), ["ask"], "openTask can name the purpose");
  app.B.openTask("s1", { pane: "checks" });
  assert.equal(app.window.MefiPanes.where("checks"), "dock", "and the pane to open beside it");
});

test("the page follows the navigation: a task, the chat or New task from anywhere, and Escape leaves a task", async () => {
  const app = await makeApp({ saved: "sessions", tasks: [task("a", { title: "A", createdAt: at(1), updatedAt: at(1) })], bridge: makeBridge() });
  await pump(app);
  const nav = (params, id = "workspace", action = "open") => app.env.emit("mefi:nav", { id, action, params });
  nav({ view: "task", taskId: "a" });
  assert.deepEqual(clean(app.B.view()), { view: "task", taskId: "a" });
  nav({ view: "chat" });
  assert.deepEqual(clean(app.B.view()), { view: "chat", taskId: null });
  nav({ view: "home" });
  assert.deepEqual(clean(app.B.view()), { view: "home", taskId: null });
  nav({ view: "task", taskId: "a" }, "tasks");
  assert.deepEqual(clean(app.B.view()), { view: "home", taskId: null }, "another page's navigation is not ours");
  nav({ view: "task", taskId: "a" }, "workspace", "close");
  assert.equal(app.B.view().view, "home");
  nav({});
  assert.equal(app.B.view().view, "home", "an open with no view leaves the page as it is");

  // Escape leaves a task, but not from a box where it means something else.
  await open(app, "a");
  const leave = async (target) => { let prevented = false; await app.page.layer.trigger("keydown", { key: "Escape", target, preventDefault: () => { prevented = true; } }); return prevented; };
  assert.equal(await leave(composerOf(app).input), false, "Escape in the composer is the composer's");
  assert.equal(app.B.view().view, "task");
  const menu = app.env.node("div", { className: "pane-floating", parent: app.page.layer });
  const inWindow = app.env.node("button", { parent: menu });
  assert.equal(await leave(inWindow), false, "and a window's own Escape closes the window");
  assert.equal(app.B.view().view, "task");
  assert.equal(await leave(app.page.attention), true);
  assert.equal(app.B.view().view, "home", "Escape elsewhere on a task goes back to New task");
  assert.equal(await leave(app.page.attention), false, "and does nothing on New task");
});

test("the last page is restored per project, and a saved view that no longer makes sense opens New task", async () => {
  const view = (value) => new Map([["mefiStudio.builder.view.p1", typeof value === "string" ? value : JSON.stringify(value)]]);
  const rows = [task("a", { title: "A", createdAt: at(1), updatedAt: at(1) })];
  const taskView = await makeApp({ saved: "sessions", tasks: rows, storage: view({ view: "task", taskId: "a" }), bridge: makeBridge() });
  await pump(taskView);
  assert.deepEqual(clean(taskView.B.view()), { view: "task", taskId: "a" });
  assert.equal(taskView.page.layer.dataset.view, "task");
  assert.equal(taskView.document.getElementById("builder-task").hidden, false);
  assert.equal(taskView.page.form.hidden, true);
  const chatView = await makeApp({ saved: "sessions", tasks: rows, storage: view({ view: "chat" }), bridge: makeBridge() });
  await pump(chatView);
  assert.equal(chatView.B.view().view, "chat");
  assert.equal(chatView.calls.composerMode.at(-1), "chat");
  for (const stored of ["not json", "null", "[]", JSON.stringify({ view: "task" }), JSON.stringify({ view: "task", taskId: 7 }), JSON.stringify({ view: "elsewhere" })]) {
    const app = await makeApp({ saved: "sessions", tasks: rows, storage: view(stored), bridge: makeBridge() });
    await pump(app);
    assert.equal(app.B.view().view, "home", `${stored} opens New task`);
  }
  // A view that names a task since deleted says so rather than showing another.
  const gone = await makeApp({ saved: "sessions", tasks: rows, storage: view({ view: "task", taskId: "deleted" }), bridge: makeBridge() });
  await pump(gone);
  assert.equal(gone.document.getElementById("builder-task").querySelector("h2").textContent, "This task is no longer on the board");
  // Changing project forgets what was cached for the last one and reads the new project's saved page.
  const bridge = makeBridge({ attempts: [] });
  const app = await makeApp({ saved: "sessions", tasks: rows, storage: view({ view: "task", taskId: "a" }), bridge });
  await pump(app);
  assert.equal(bridge.calls.filter((call) => call[0] === "tasksAttempts").length, 1);
  app.env.emit("mefi:project-changed");
  await pump(app);
  assert.equal(bridge.calls.filter((call) => call[0] === "tasksAttempts").length, 2, "a project change reads the task's runs afresh");
});

test("a message sent in Chat mode from New task opens the chat, where its reply lands", async () => {
  const app = await makeApp({ saved: "sessions", tasks: [task("a")], bridge: makeBridge(), messages: [{ role: "user", at: at(0, 9), text: "earlier" }] });
  await pump(app);
  assert.equal(app.B.view().view, "home");
  // Home asks in Work mode: a sent message is a task, and the page stays.
  app.state.data = { ...app.state.data, mode: "work", assistant: { ...app.state.data.assistant, messages: [...app.state.data.assistant.messages, { role: "user", at: NOW - 5000, text: "a task" }] } };
  app.B.refresh(); app.env.flush();
  assert.equal(app.B.view().view, "home");
  // In Chat mode a message sent a moment ago moves to the chat.
  app.state.data = { ...app.state.data, mode: "chat", assistant: { ...app.state.data.assistant, messages: [...app.state.data.assistant.messages, { role: "user", at: NOW - 4000, text: "a question" }] } };
  app.B.refresh(); app.env.flush();
  assert.equal(app.B.view().view, "chat");
  // A message from long ago is history, not a send.
  const old = await makeApp({ saved: "sessions", tasks: [task("a")], bridge: makeBridge(), messages: [{ role: "user", at: at(0, 9), text: "earlier" }] });
  await pump(old);
  old.state.data = { ...old.state.data, mode: "chat", assistant: { ...old.state.data.assistant, messages: [...old.state.data.assistant.messages, { role: "user", at: NOW - 120000, text: "two minutes ago" }] } };
  old.B.refresh(); old.env.flush();
  assert.equal(old.B.view().view, "home", "a message more than a minute old is not one just sent");
});

test("the title bar names where you are, and its arrows follow the history", async () => {
  const app = await makeApp({ saved: "sessions", tasks: [task("a", { title: "A", createdAt: at(1), updatedAt: at(1) })], bridge: makeBridge() });
  const history = { canBack: false, canForward: false, went: [] };
  app.window.MefiNav.historyState = () => ({ canBack: history.canBack, canForward: history.canForward });
  app.window.MefiNav.back = () => history.went.push("back");
  app.window.MefiNav.forward = () => history.went.push("forward");
  await pump(app);
  const trail = () => app.document.getElementById("builder-title").querySelector(".builder-trail").textContent;
  const arrows = () => app.document.getElementById("builder-title").querySelectorAll("button");
  assert.equal(trail(), "Snake trial/New task");
  assert.deepEqual(arrows().map((arrow) => arrow.disabled), [true, true], "nothing to go back or forward to");
  history.canBack = true;
  app.B.refresh(); app.env.flush();
  assert.deepEqual(arrows().map((arrow) => arrow.disabled), [false, true]);
  await arrows()[0].click();
  assert.deepEqual(history.went, ["back"]);
  history.canForward = true;
  app.B.refresh(); app.env.flush();
  await arrows()[1].click();
  assert.deepEqual(history.went, ["back", "forward"]);
  assert.equal(arrows()[0].getAttribute("aria-label"), "Back");
  assert.equal(arrows()[1].getAttribute("aria-label"), "Forward");
  await open(app, "a");
  assert.equal(trail(), "Snake trial/Task");
  app.B.openChat();
  await pump(app);
  assert.equal(trail(), "Snake trial/Chat with Mefi");
  assert.equal(app.document.getElementById("builder-title").title, "/work/snake", "hover names the folder");
});

test("the page repaints when the workspace says its state moved, and a minute-old session is refreshed on a timer, never while hidden", async () => {
  const app = await makeApp({ saved: "sessions", tasks: [task("a", { title: "A", createdAt: at(1), updatedAt: at(1) })], bridge: makeBridge() });
  await pump(app);
  assert.deepEqual(menuOf(app).filter((line) => /\/ready$/.test(line)), ["a/ready"]);
  app.state.data = { ...app.state.data, tasks: [...app.state.data.tasks, deepFreeze(task("b", { title: "B", createdAt: at(0, 9), updatedAt: at(0, 9) }))] };
  app.env.emit("mefi:workspace-state");
  app.env.flush();
  assert.deepEqual(menuOf(app).filter((line) => /\/ready$/.test(line)), ["b/ready", "a/ready"], "a workspace push repaints the menu");
  app.state.data = { ...app.state.data, tasks: [] };
  app.bridge = undefined;
  // Each kind of host push does the same.
  assert.equal(app.env.intervals.length, 1, "one timer for the page");
  assert.equal(app.env.intervals[0].delay, 30000);
  const before = app.env.frames.length;
  app.env.intervals[0].callback();
  assert.equal(app.env.frames.length, before, "on New task the timer does nothing");
  app.state.data = { ...app.state.data, tasks: [task("a", { title: "A", createdAt: at(1), updatedAt: at(1) })] };
  await open(app, "a");
  app.env.intervals[0].callback();
  assert.ok(app.env.frames.length > 0, "on a session it repaints, so 'started 2h ago' keeps up");
  app.env.flush();
  app.env.timeouts.length = 0;
  app.document.hidden = true;
  app.env.intervals[0].callback();
  assert.equal(app.env.frames.length + app.env.timeouts.length, 0, "and never while the window is hidden: not a frame, not a timer");
});
