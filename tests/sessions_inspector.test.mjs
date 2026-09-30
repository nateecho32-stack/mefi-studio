// The inspector of Build's desktop inside the 0.5 frame (renderer/sessions.js, the right-hand column): five tabs for the selected
// session, Plan | Changes | Checks | Preview | Agent, with live counts. Changes and Checks (and Preview's Before / After) are
// review.js's own panels, mounted one at a time; here they are a stand-in that records what was mounted where and for which
// task, so what the inspector does with them is what is pinned (review.js's panels are pinned by tests/review_panels.test.mjs and
// tests/review_ui.test.mjs, and the two meet in tests/sessions_render.test.mjs). Plan and Agent are drawn here from the task and
// from tasks.js's own words for usage.
import test from "node:test";
import assert from "node:assert/strict";

import { sessionsApp, task, bridge, at, mins, clean } from "./fixtures/sessions-env.mjs";

const open = async (id, options = {}) => {
  const a = await sessionsApp(options);
  await a.settle();
  a.S.select(id, { route: false });
  await a.settle(4);
  return a;
};
const texts = (nodes) => nodes.map((node) => node.textContent.trim());
const tabs = (a) => a.all("inspector", ".sx-itab");
const pane = (a, name) => a.one("inspector", `#sessions-pane-${name}`);
const shown = (a) => a.all("inspector", ".sx-pane").filter((node) => !node.hidden).map((node) => node.dataset.pane);
const counts = (files, more = {}) => ({ files, additions: 10, deletions: 2, running: false, accepted: false, ...more });
const cards = (a, name) => pane(a, name).querySelectorAll(".sx-icard");
const card = (a, name, title) => cards(a, name).find((node) => node.querySelector("h4").ownText === title);

test("with no session open the inspector says so and draws no tabs; with one it has the five tabs, one stop in the tab order and each tab names its panel", async () => {
  const a = await sessionsApp({ tasks: [task("t1")] });
  await a.settle();
  assert.equal(a.one("inspector", "#sessions-itabs").hidden, true);
  assert.match(a.text("inspector", ".sx-insp-empty"), /Nothing selected/);
  assert.equal(a.inspector().dataset.empty, "true");
  assert.equal(a.reviews.live().length, 0, "nothing is mounted, so nothing is read");
  a.S.select("t1", { route: false }); await a.settle(4);
  assert.equal(a.one("inspector", "#sessions-itabs").hidden, false); assert.equal(a.one("inspector", ".sx-insp-empty").hidden, true);
  assert.deepEqual(tabs(a).map((node) => node.dataset.tab), ["plan", "changes", "checks", "preview", "agent"]);
  assert.deepEqual(texts(tabs(a).map((node) => node.querySelector(".sx-itab-l"))), ["Plan", "Changes", "Checks", "Preview", "Agent"]);
  assert.ok(tabs(a).every((node) => node.getAttribute("role") === "tab" && node.getAttribute("aria-controls") === `sessions-pane-${node.dataset.tab}`));
  assert.equal(a.one("inspector", "#sessions-itabs").getAttribute("role"), "tablist");
  assert.equal(tabs(a).filter((node) => node.tabIndex === 0).length, 1, "the tabs are one stop: the arrows move between them");
  assert.ok(a.all("inspector", ".sx-pane").every((node) => node.getAttribute("role") === "tabpanel" && node.getAttribute("aria-labelledby") === `sessions-itab-${node.dataset.pane}`));
  a.S.select("t1", { route: false });
  a.S.detach(); await a.settle();
  assert.equal(a.mounts.find((entry) => entry.region === "inspector").unmounted, true);
});

test("a task opens on its plan, and on its changes once it has any; the choice is settled when the changes are read and then stays put", async () => {
  const a = await open("t1", { tasks: [task("t1")] });
  assert.equal(a.S.tab(), "plan", "nothing changed yet: the plan");
  assert.deepEqual(shown(a), ["plan"]);
  a.reviews.setCounts("t1", counts(3)); await a.settle(3);
  assert.equal(a.S.tab(), "changes", "the changes were read and there are some: they lead");
  assert.deepEqual(shown(a), ["changes"]);
  // Another task: read first, none there, then some appear while it is being read: the plan stays.
  const b = await open("t1", { tasks: [task("t1")] });
  b.reviews.setCounts("t1", counts(0)); await b.settle(3);
  assert.equal(b.S.tab(), "plan", "a list that is empty: the plan, and that is settled");
  b.reviews.setCounts("t1", counts(5)); await b.settle(3);
  assert.equal(b.S.tab(), "plan", "a file appearing while someone reads the plan never moves the page under them");
  // After a moment with nothing read, the plan is settled too.
  const c = await open("t1", { tasks: [task("t1")] });
  c.tick(3000); c.S.refresh(); await c.settle(3);
  c.reviews.setCounts("t1", counts(2)); await c.settle(3);
  assert.equal(c.S.tab(), "plan");
});

test("the tab a person picks is theirs: it is kept for the task, for the project and across launches, and a route can name it", async () => {
  const storage = new Map();
  const a = await open("t1", { tasks: [task("t1"), task("t2")], storage });
  await tabs(a)[2].click(); await a.settle();
  assert.equal(a.S.tab(), "checks"); assert.deepEqual(shown(a), ["checks"]);
  assert.equal(tabs(a)[2].getAttribute("aria-selected"), "true"); assert.equal(tabs(a)[0].getAttribute("aria-selected"), "false");
  assert.equal(tabs(a)[2].tabIndex, 0); assert.equal(tabs(a)[0].tabIndex, -1);
  a.reviews.setCounts("t1", counts(4)); await a.settle(3);
  assert.equal(a.S.tab(), "checks", "changes arriving do not take it back");
  a.S.select("t2", { route: false }); await a.settle(4);
  assert.equal(a.S.tab(), "plan", "each task has its own");
  a.S.select("t1", { route: false }); await a.settle(4);
  assert.equal(a.S.tab(), "checks", "and keeps it");
  assert.deepEqual(JSON.parse(storage.get("mefiStudio.sessions.v1")).p.p1.itab, { t1: "checks" });
  a.S.detach();
  const b = await open("t1", { tasks: [task("t1"), task("t2")], storage });
  assert.equal(b.S.tab(), "checks", "the next launch");
  b.navigate("workspace", { view: "task", taskId: "t2", projectId: "p1", tab: "preview" }); await b.settle(4);
  assert.equal(b.S.tab(), "preview", "a route (a notification's View checks, a tab) names the tab");
  assert.equal(b.S.setTab("nonsense"), true); assert.equal(b.S.tab(), "preview", "an unknown tab is ignored");
  assert.equal(b.S.setTab("agent", "nobody"), false);
});

test("the arrow keys, Home and End move between the tabs and take the focus with them", async () => {
  const a = await open("t1", { tasks: [task("t1")] });
  const press = async (node, name) => { await node.trigger("keydown", { key: name }); await a.settle(); };
  await press(tabs(a)[0], "ArrowRight");
  assert.equal(a.S.tab(), "changes"); assert.equal(tabs(a)[1].focused, true, "focus goes with it");
  await press(tabs(a)[1], "ArrowLeft"); assert.equal(a.S.tab(), "plan");
  await press(tabs(a)[0], "ArrowLeft"); assert.equal(a.S.tab(), "agent", "it wraps round");
  await press(tabs(a)[4], "ArrowRight"); assert.equal(a.S.tab(), "plan");
  await press(tabs(a)[0], "End"); assert.equal(a.S.tab(), "agent");
  await press(tabs(a)[4], "Home"); assert.equal(a.S.tab(), "plan");
  await press(tabs(a)[0], "a"); assert.equal(a.S.tab(), "plan", "other keys are left alone");
});

test("the tab labels carry live counts: the files changed, and the checks that passed of the checks there are", async () => {
  const a = await open("t1", { tasks: [task("t1", { verificationRun: { results: [{ ok: true }, { ok: true }, { ok: false }, { ok: null }] } })] });
  const number = (index) => tabs(a)[index].querySelector(".sx-itab-n");
  assert.equal(number(1).hidden, true, "no count until the list has been read");
  assert.equal(number(2).textContent, "2/4"); assert.equal(tabs(a)[2].getAttribute("aria-label"), "Checks, 2 of 4 passed");
  a.reviews.setCounts("t1", counts(7)); await a.settle(3);
  assert.equal(number(1).textContent, "7"); assert.equal(number(1).hidden, false); assert.equal(tabs(a)[1].getAttribute("aria-label"), "Changes, 7 files changed");
  a.reviews.setCounts("t1", counts(1)); await a.settle(3);
  assert.equal(number(1).textContent, "1"); assert.equal(tabs(a)[1].getAttribute("aria-label"), "Changes, 1 file changed");
  a.reviews.setCounts("t1", counts(0)); await a.settle(3);
  assert.equal(number(1).hidden, true, "nothing changed, nothing to count");
  a.data.tasks = [task("t1", { verificationRun: { results: [{ ok: true }, { ok: true }, { ok: true }, { ok: true }] } })]; a.S.refresh(); await a.settle(3);
  assert.equal(number(2).textContent, "4/4", "the checks follow the task");
  assert.equal(tabs(a)[0].getAttribute("aria-label"), "Plan");
});

test("review.js's panels are mounted for the session: Changes at once (so its count is live), Checks and Preview the first time they are shown, all taken down with the session", async () => {
  const a = await open("t1", { tasks: [task("t1")] });
  const live = () => a.reviews.live().map((entry) => entry.options.panel);
  assert.deepEqual(live(), ["changes"], "only Changes, and it is read even while it is not the tab on screen");
  const first = a.reviews.live()[0];
  assert.deepEqual(clean(first.options), { taskId: "t1", projectId: "p1", panel: "changes", labelledBy: "sessions-itab-changes" });
  assert.equal(first.host, pane(a, "changes"), "it draws into its own tab's panel");
  await tabs(a)[2].click(); await a.settle();
  assert.deepEqual(live(), ["changes", "checks"]);
  assert.equal(a.reviews.live()[1].options.labelledBy, "sessions-itab-checks");
  assert.notEqual(a.reviews.live()[1].host, pane(a, "checks"), "under what the inspector says itself, in a box of review's own");
  assert.equal(pane(a, "checks").children.includes(a.reviews.live()[1].host), true);
  await tabs(a)[3].click(); await a.settle();
  assert.deepEqual(live(), ["changes", "checks", "preview"]);
  for (let round = 0; round < 3; round += 1) { a.S.refresh(); await a.settle(2); }
  assert.equal(a.reviews.mounts.length, 3, "drawing again mounts nothing again");
  // Another session: the old ones are taken down and new ones mounted for it.
  a.data.tasks.push(task("t2")); a.S.select("t2", { route: false }); await a.settle(4);
  assert.equal(a.reviews.mounts.slice(0, 3).every((entry) => entry.unmounted), true);
  assert.deepEqual(a.reviews.live().map((entry) => [entry.options.taskId, entry.options.panel]), [["t2", "changes"]], "a session's own: Checks and Preview wait to be shown");
  // Away from Home, or deselected: nothing stays mounted.
  a.navigate("settings", {}); await a.settle();
  assert.equal(a.reviews.live().length, 0, "nothing is read for a session that is not on screen");
  a.navigate("workspace", { view: "task", taskId: "t2", projectId: "p1" }); await a.settle(4);
  assert.equal(a.reviews.live().length, 1);
  a.S.detach();
  assert.equal(a.reviews.live().length, 0);
});

test("a page without review.js says so in the Changes tab and does not break the others", async () => {
  const a = await open("t1", { tasks: [task("t1")], review: false });
  await tabs(a)[1].click(); await a.settle();
  assert.match(pane(a, "changes").textContent, /part of the desktop app/);
  await tabs(a)[0].click(); await a.settle();
  assert.ok(card(a, "plan", "Brief"));
});

// ---- Plan ------------------------------------------------------------------------------------------------------------------------------------

test("Plan says where the task stands, what it was asked, what it is done when and its earlier briefs", async () => {
  const prompt = "Make the list friendly.\n\nGoal:\nAn empty list says what to do next.\n\nDone when:\n- The list says No notes yet\n- Tests pass\n\nKeep unchanged:\nThe toolbar.";
  const a = await open("t1", { tasks: [task("t1", { prompt, status: "awaiting_verification", acceptance: ["The list says No notes yet", "Tests pass", "It looks right"] })], stages: { t1: "review" } });
  const titles = cards(a, "plan").map((node) => node.querySelector("h4").ownText);
  assert.deepEqual(titles, ["Where it stands", "Brief", "Done when", "Versions"]);
  assert.equal(cards(a, "plan")[0].querySelector("h4 .r").textContent, "Checking the result", "what the reading says, beside the title");
  const stands = card(a, "plan", "Where it stands");
  assert.match(stands.textContent, /Ready for a worker/); assert.match(stands.textContent, /Next: Start this task when you are ready\./); assert.match(stands.textContent, /Checks\s*No completion checks recorded/);
  const brief = card(a, "plan", "Brief");
  assert.match(brief.querySelector(".sx-text").textContent, /Make the list friendly\./, "what was said before the outline");
  assert.deepEqual(texts(brief.querySelectorAll(".sx-mini-h")), ["Goal", "Keep unchanged"], "the outline's parts, with their own headings");
  assert.match(brief.textContent, /An empty list says what to do next\./); assert.match(brief.textContent, /The toolbar\./);
  assert.doesNotMatch(brief.textContent, /Done when/, "the done-when lines have a card of their own");
  assert.deepEqual(texts(card(a, "plan", "Done when").querySelectorAll("li")), ["The list says No notes yet", "Tests pass", "It looks right"], "the task's own acceptance lines win");
  // The outline's own lines stand in when the task has none.
  const b = await open("t1", { tasks: [task("t1", { prompt })] });
  assert.deepEqual(texts(card(b, "plan", "Done when").querySelectorAll("li")), ["The list says No notes yet", "Tests pass"]);
  // A brief that is just words is shown as they are; a blocker is said.
  const c = await open("t1", { tasks: [task("t1", { prompt: "Just fix it." })], stages: { t1: "blocked" }, backlog: { taskStates: [{ id: "t1", stage: "blocked", reason: "Waiting for the owner." }] } });
  assert.equal(card(c, "plan", "Brief").querySelector(".sx-text").textContent, "Just fix it.");
  assert.equal(card(c, "plan", "Done when"), undefined, "no lines, no card");
});

test("the outline reads back the way Home writes it: Goal, Done when, Keep unchanged, in any case, with bullets or without", async () => {
  const a = await open("t1", { tasks: [task("t1")] });
  const outline = (text) => clean(a.S.model.outline(text));
  assert.deepEqual(outline("Goal:\nShip it\n\nDone when:\n- a\n* b\n• c\n\nKeep unchanged:\nThe API"), { intro: "", parts: [{ key: "goal", label: "Goal", lines: ["Ship it"] }, { key: "done when", label: "Done when", lines: ["a", "b", "c"] }, { key: "keep unchanged", label: "Keep unchanged", lines: ["The API"] }] });
  assert.deepEqual(outline("intro line\nGOAL: one line\nDONE WHEN:").parts.map((part) => part.key), ["goal"], "an empty part is left out");
  assert.equal(outline("intro line\nGOAL: one line").intro, "intro line");
  assert.equal(outline("Nothing like an outline here."), null);
  assert.equal(outline(""), null); assert.equal(outline(null), null);
});

test("the brief's earlier versions come from the host while Plan shows, five at a time, and Restore puts one back", async () => {
  const entries = Array.from({ length: 7 }, (_, index) => ({ id: `rev_${index}`, kind: index === 0 ? "Edited brief" : "Saved brief", at: at(1, 12, index), note: index === 1 ? "by Mefi" : "", snapshot: { prompt: `Version ${index} of the brief` } }));
  const a = await open("t1", { tasks: [task("t1")], api: bridge({ history: { ok: true, entries, hasMore: true } }) });
  assert.deepEqual(clean(a.api.of("tasksHistory")), [["tasksHistory", { taskId: "t1", projectId: "p1" }]], "read once, for this task");
  const versions = card(a, "plan", "Versions");
  assert.equal(versions.querySelector("h4 .r").textContent, "7+");
  const rows = versions.querySelectorAll(".sx-version");
  assert.equal(rows.length, 5, "five, not the whole history");
  assert.match(rows[0].textContent, /Edited brief/); assert.match(rows[0].textContent, /Version 0 of the brief/); assert.match(rows[1].textContent, /by Mefi/);
  assert.match(versions.querySelector(".sx-link").textContent, /All versions on the task board/);
  await versions.querySelector(".sx-link").click();
  assert.deepEqual(clean(a.calls.go.at(-1)), ["tasks", { taskId: "t1", projectId: "p1", board: true }]);
  await rows[2].querySelector("button").click(); await a.settle();
  assert.deepEqual(clean(a.api.of("tasksRestore")), [["tasksRestore", { taskId: "t1", projectId: "p1", revisionId: "rev_2" }]]);
  assert.match(a.calls.toasts.at(-1).message, /Earlier brief restored\. Files, status and checks are unchanged\./);
  assert.ok(a.calls.refresh >= 1, "the board is read again");
  assert.equal(a.api.of("tasksHistory").length >= 2, true, "and the versions are read again");
  a.api.state.fail.tasksRestore = "That brief is gone.";
  await card(a, "plan", "Versions").querySelectorAll(".sx-version")[0].querySelector("button").click(); await a.settle();
  assert.equal(a.calls.toasts.at(-1).kind, "bad"); assert.match(a.calls.toasts.at(-1).message, /That brief is gone\./);
});

test("while a worker holds the task its brief cannot be restored, and a host without versions says so", async () => {
  const entries = [{ id: "rev_1", kind: "Saved brief", at: at(1), snapshot: { prompt: "Old" } }];
  const a = await open("t1", { tasks: [task("t1", { status: "active", runId: "r" })], running: [{ taskId: "t1", runId: "r" }], api: bridge({ history: { ok: true, entries } }) });
  const restore = card(a, "plan", "Versions").querySelector(".sx-version button");
  assert.equal(restore.disabled, true); assert.match(restore.title, /Wait for the current worker/);
  const none = await open("t1", { tasks: [task("t1")], api: bridge({ history: { ok: true, entries: [] } }) });
  assert.match(card(none, "plan", "Versions").textContent, /Saved changes to this task will appear here\./);
  const failing = await open("t1", { tasks: [task("t1")], api: bridge({ fail: { tasksHistory: "No history." } }) });
  assert.match(card(failing, "plan", "Versions").textContent, /No history\./);
  const bare = await sessionsApp({ tasks: [task("t1")] });
  delete bare.api.tasksHistory; await bare.settle(); bare.S.select("t1", { route: false }); await bare.settle(4);
  assert.match(card(bare, "plan", "Versions").textContent, /part of the desktop app/);
});

// ---- Checks, Preview and Agent ------------------------------------------------------------------------------------------------------------------

test("Checks says what the task must pass and how its last check run went, with review.js's advisory checks under it", async () => {
  const row = task("t1", { acceptance: ["The list says No notes yet"], verificationRun: { state: "failed", results: [{ name: "unit tests", ok: true }, { name: "first paint", ok: false, detail: "2.4 s" }] }, verification: { state: "failed", reason: "The budget failed." } });
  const a = await open("t1", { tasks: [row] });
  await tabs(a)[2].click(); await a.settle();
  const own = pane(a, "checks").querySelector(".sx-own");
  assert.match(own.textContent, /Done when/); assert.match(own.textContent, /The list says No notes yet/);
  assert.match(own.textContent, /Last check run/); assert.match(own.textContent, /Passed.*unit tests/); assert.match(own.textContent, /Failed.*first paint/); assert.match(own.textContent, /2\.4 s/);
  assert.match(own.textContent, /Not accepted: The budget failed\./);
  assert.equal(a.reviews.live().find((entry) => entry.options.panel === "checks").host.parentNode, pane(a, "checks"), "review.js's checks sit under it, in the same tab");
  // It follows the task.
  a.data.tasks = [task("t1", { acceptance: ["Changed"], verificationRun: { results: [{ name: "all", ok: true }] }, verification: { state: "verified", reason: "All good." } })]; a.S.refresh(); await a.settle(3);
  assert.match(pane(a, "checks").querySelector(".sx-own").textContent, /Verified: All good\./);
});

test("Preview shows the project preview's state and its controls (Start, Open app, Stop, Check again) through the workspace's own path", async () => {
  const a = await open("t1", { tasks: [task("t1")], preview: { phase: "stopped", available: true, canStop: false } });
  await tabs(a)[3].click(); await a.settle();
  const own = () => pane(a, "preview").querySelector(".sx-own");
  const buttons = () => own().querySelectorAll("button");
  assert.match(own().textContent, /Project preview/); assert.match(own().textContent, /Stopped/);
  assert.deepEqual(texts(buttons()), ["Start preview", "Stop preview", "Check again"]);
  assert.equal(buttons()[1].disabled, true, "nothing to stop");
  await buttons()[0].click(); await a.settle();
  assert.deepEqual(a.calls.preview, ["start"]);
  a.data.preview = { phase: "ready", available: true, canStop: true, url: "http://localhost:5173/" }; a.S.refresh(); await a.settle(3);
  assert.match(own().textContent, /Preview ready/); assert.match(own().textContent, /http:\/\/localhost:5173\//);
  assert.deepEqual(texts(buttons()), ["Open app", "Stop preview", "Check again"]);
  await buttons()[0].click(); await a.settle();
  await buttons()[1].click(); await a.settle();
  await buttons()[2].click(); await a.settle();
  assert.deepEqual(a.calls.preview, ["start", "open", "stop", "status"], "each is the workspace's own action");
  a.data.preview = { phase: "failed", error: "The dev server exited.", available: true }; a.S.refresh(); await a.settle(3);
  assert.match(own().textContent, /Preview failed/); assert.match(own().textContent, /The dev server exited\./); assert.equal(buttons()[0].textContent, "Retry preview");
  a.data.preview = { phase: "starting", available: true }; a.S.refresh(); await a.settle(3);
  assert.equal(buttons()[0].textContent, "Starting…"); assert.equal(buttons()[0].disabled, true);
  a.data.preview = null; a.S.refresh(); await a.settle(3);
  assert.match(own().textContent, /Checking…/);
  a.window.MefiWorkspace.previewAction = undefined; a.S.refresh(); await a.settle(3);
  assert.ok(buttons().every((node) => node.disabled), "no workspace, no controls");
});

test("Preview's Before and After are review.js's, mounted under the controls when the tab is first shown", async () => {
  const a = await open("t1", { tasks: [task("t1")] });
  await tabs(a)[3].click(); await a.settle();
  const mount = a.reviews.live().find((entry) => entry.options.panel === "preview");
  assert.ok(mount); assert.equal(mount.options.labelledBy, "sessions-itab-preview");
  assert.equal(mount.host.parentNode, pane(a, "preview"));
  assert.equal(pane(a, "preview").children[0].classList.contains("sx-own"), true, "the controls come first");
});

const report = (more = {}) => ({ ok: true, attempt: { live: false, startedAt: mins(40), seconds: 1560, stoppedAtLimit: false, route: { label: "Claude Code" }, tokens: { state: "not-reported" }, cost: { state: "not-reported" } }, task: { attempts: 2, seconds: 2900, secondsUnknown: false, subtasks: 1, tokens: { state: "not-reported" }, cost: { state: "not-reported" } }, cap: { enabled: true, minutes: 25, effectiveMinutes: 25, min: 5, step: 5, ceilingMinutes: 60, raised: false }, coverage: { reasons: ["Some runs are not in the ledger."] }, ...more });

test("Agent says who is on the task, what it is doing, what it took in tasks.js's own words, and how long an attempt may run", async () => {
  const a = await open("t1", { tasks: [task("t1", { status: "active", runId: "r" })], running: [{ taskId: "t1", runId: "r", route: "Claude Code", currentStep: "Writing parseTags()", startedAt: mins(12) }], api: bridge({ metrics: report() }) });
  await tabs(a)[4].click(); await a.settle(4);
  assert.deepEqual(clean(a.api.of("taskMetrics")), [["taskMetrics", { taskId: "t1", projectId: "p1" }]], "read once, for this task, while the tab shows");
  const who = card(a, "agent", "Worker");
  assert.match(who.textContent, /Worker\s*Claude Code/); assert.match(who.textContent, /Doing\s*Writing parseTags\(\)/); assert.match(who.textContent, /Running for\s*12m/);
  assert.match(card(a, "agent", "This attempt").textContent, /Time\s*26 min/); assert.match(card(a, "agent", "This attempt").textContent, /Tokens\s*Not reported/); assert.match(card(a, "agent", "This attempt").textContent, /Claude Code does not report tokens or cost to Studio/);
  const whole = card(a, "agent", "Whole task");
  assert.match(whole.textContent, /with 1 sub-task/); assert.match(whole.textContent, /Attempts\s*2/); assert.match(whole.textContent, /Tokens and cost\s*Time only/);
  assert.match(pane(a, "agent").textContent, /Some runs are not in the ledger\./);
  await who.querySelector('[data-spec="stop"]').click(); await who.querySelector('[data-spec="stop"]').click(); await a.settle();
  assert.deepEqual(clean(a.api.of("tasksAction")), [["tasksAction", { taskId: "t1", projectId: "p1", action: "stop" }]], "Stop is here too, behind its two presses");
  const links = pane(a, "agent").querySelectorAll(".sx-acts");
  await links[links.length - 1].querySelector("button").click();
  assert.deepEqual(clean(a.calls.go.at(-1)), ["tasks", { taskId: "t1", projectId: "p1", filter: "all", board: true }]);
  // A task nothing runs on: idle, no Stop, the last attempt's route.
  const idle = await open("t1", { tasks: [task("t1", { lastAttempt: { route: "OpenCode" } })], api: bridge({ metrics: report({ attempt: null }) }) });
  await tabs(idle)[4].click(); await idle.settle(4);
  assert.match(card(idle, "agent", "Worker").textContent, /Worker\s*OpenCode/); assert.match(card(idle, "agent", "Worker").textContent, /Doing\s*Idle/);
  assert.equal(card(idle, "agent", "Worker").querySelector('[data-spec="stop"]'), null);
  assert.equal(card(idle, "agent", "This attempt"), undefined);
});

test("the time limit steps by the host's own step, never past its ends, and the host is told the new number", async () => {
  const a = await open("t1", { tasks: [task("t1")], api: bridge({ metrics: report() }) });
  await tabs(a)[4].click(); await a.settle(4);
  const limit = () => card(a, "agent", "Limit");
  const [shorter, longer] = limit().querySelectorAll(".sx-stepper button");
  assert.equal(limit().querySelector(".sx-stepper b").textContent, "25 min");
  await longer.click(); await a.settle(3);
  assert.deepEqual(clean(a.api.of("tasksCap")), [["tasksCap", { taskId: "t1", minutes: 30, projectId: "p1" }]]);
  assert.ok(a.api.of("taskMetrics").length >= 2, "and the usage is read again");
  await shorter.click(); await a.settle(3);
  assert.equal(a.api.of("tasksCap")[1][1].minutes, 20);
  const ends = await open("t1", { tasks: [task("t1")], api: bridge({ metrics: report({ cap: { enabled: true, minutes: 5, effectiveMinutes: 5, min: 5, step: 5, ceilingMinutes: 5, raised: false } }) }) });
  await tabs(ends)[4].click(); await ends.settle(4);
  const steppers = card(ends, "agent", "Limit").querySelectorAll(".sx-stepper button");
  assert.equal(steppers[0].disabled, true); assert.equal(steppers[1].disabled, true); assert.match(card(ends, "agent", "Limit").textContent, /5 min is the longest Studio lets one attempt run\./);
  const off = await open("t1", { tasks: [task("t1")], api: bridge({ metrics: report({ cap: { enabled: false } }) }) });
  await tabs(off)[4].click(); await off.settle(4);
  assert.match(card(off, "agent", "Limit").textContent, /Time limits are switched off on this PC/); assert.equal(card(off, "agent", "Limit").querySelector(".sx-stepper"), null);
  const raised = await open("t1", { tasks: [task("t1")], api: bridge({ metrics: report({ cap: { enabled: true, minutes: 90, effectiveMinutes: 60, min: 5, step: 5, ceilingMinutes: 60, raised: true } }) }) });
  await tabs(raised)[4].click(); await raised.settle(4);
  assert.match(card(raised, "agent", "Limit").textContent, /This task asks for 90 min, but Studio ends every attempt at 60 min at the latest\./);
  a.api.state.fail.tasksCap = "The limit could not be saved.";
  await longer.click(); await a.settle(3);
  assert.equal(a.calls.toasts.at(-1).kind, "bad");
});

test("a usage report that cannot be read says so and is not read on every paint; a host without one shows only what the page knows", async () => {
  const a = await open("t1", { tasks: [task("t1")], api: bridge({ fail: { taskMetrics: "The ledger is busy." } }) });
  await tabs(a)[4].click(); await a.settle(4);
  assert.match(pane(a, "agent").textContent, /The ledger is busy\./);
  const reads = a.api.of("taskMetrics").length;
  for (let round = 0; round < 4; round += 1) { a.S.refresh(); await a.settle(2); }
  assert.equal(a.api.of("taskMetrics").length, reads, "the same answer is not asked for again and again");
  const bare = await sessionsApp({ tasks: [task("t1")] });
  delete bare.api.taskMetrics; await bare.settle(); bare.S.select("t1", { route: false }); await bare.settle(4);
  await tabs(bare)[4].click(); await bare.settle(3);
  assert.ok(card(bare, "agent", "Worker"), "the page's own facts still show"); assert.equal(card(bare, "agent", "This attempt"), undefined);
  // Nothing is read for the Agent tab until it is shown.
  const lazy = await open("t1", { tasks: [task("t1")], api: bridge({ metrics: report() }) });
  assert.equal(lazy.api.of("taskMetrics").length, 0); assert.equal(lazy.api.of("tasksHistory").length, 1, "Plan is what is on screen, so its versions are read");
});

test("See the changes from the thread asks the shell for the inspector when it has been closed, and does not when it is showing or folded", async () => {
  const a = await open("t1", { tasks: [task("t1")] });
  const calls = [];
  a.shell.size = () => 0; a.shell.resize = (...args) => calls.push(args);
  a.S.setTab("changes"); await a.settle();
  assert.deepEqual(calls, [["inspector", 380]], "a closed column is opened");
  a.shell.size = () => 300; calls.length = 0;
  a.S.setTab("checks"); await a.settle();
  assert.deepEqual(calls, [], "an open one is left as it is");
  a.shell.size = () => 0; a.document.documentElement.dataset.layoutFold = "list inspector";
  a.S.setTab("agent"); await a.settle();
  assert.deepEqual(calls, [], "a folded one is the shell's drawer, not ours to resize");
  a.shell.reveal = (name) => calls.push(["reveal", name]);
  a.S.setTab("plan"); await a.settle();
  assert.deepEqual(calls, [["reveal", "inspector"]], "a shell that can reveal a region is asked to");
  a.shell.size = () => 0; calls.length = 0;
  await tabs(a)[1].trigger("keydown", { key: "ArrowRight" });
  assert.deepEqual(calls, [], "moving between tabs with the keys never opens a column");
});
