// The session list (renderer/sessions.js, the list column of Build's desktop in the 0.5 frame): how a board is grouped and worded, what a
// row says and offers, how a session is selected and remembered, and how the panels come and go. The real renderer/builder.js runs
// underneath in the shared fake DOM; the shell, the router, the workspace and the host are stand-ins that record what they are asked
// (tests/fixtures/sessions-env.mjs). The real-window half (fit, scrollers, real keys) is tests/sessions_render.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { sessionsApp, task, bridge, at, mins, clean, NOW } from "./fixtures/sessions-env.mjs";

const css = readFileSync(new URL("../renderer/sessions.css", import.meta.url), "utf8");
const board = () => [
  task("asking", { status: "active", runId: "r1", updatedAt: mins(4) }),
  task("blocked", { updatedAt: at(1), verification: { state: "failed", reason: "It failed." } }),
  task("working", { status: "active", runId: "r2", updatedAt: mins(1) }),
  task("working2", { status: "active", runId: "r3", updatedAt: mins(2) }),
  task("checking", { status: "awaiting_verification", updatedAt: mins(30) }),
  task("queued", { updatedAt: at(2) }), task("queued-old", { updatedAt: at(9) }),
  task("finished", { status: "done", doneAt: at(2), updatedAt: at(2), verification: { state: "verified" } }),
  task("finished-old", { status: "done", doneAt: at(6), updatedAt: at(6), verification: { state: "manual" } }),
  task("archived", { status: "archived" }),
];
const jobs = () => [
  { taskId: "asking", runId: "r1", currentStep: "Waiting for your answer", route: "OpenCode" },
  { taskId: "working", runId: "r2", currentStep: "Writing parseTags()", route: "Claude Code", progress: 0.6 },
  { taskId: "working2", runId: "r3", activity: "Reading the map", route: "OpenCode", progress: 0.3 },
];
const questions = () => [{ id: "q1", status: "open", title: "Reuse it?", at: mins(4), context: { taskId: "asking" }, options: [{ id: "y", label: "Yes", recommended: true }, { id: "n", label: "No" }] }];
const stages = { blocked: "blocked", checking: "review", working: "running", working2: "running", asking: "running" };
const open = (extra = {}) => sessionsApp({ tasks: board(), running: jobs(), questions: questions(), stages, ...extra });

// ---- grouping and wording -------------------------------------------------------------------------------------------------------

test("the list groups a board by where each task stands, newest first, with a count and a line of words under each title", async () => {
  const a = await open();
  await a.settle();
  assert.deepEqual(a.all("list", ".sx-gh").map((node) => [node.dataset.key, node.firstElementChild?.textContent ?? node.children[0].textContent, node.querySelector(".sx-count").textContent]),
    [["group:needs", "Needs you", "2"], ["group:running", "Running", "2"], ["group:review", "Review", "1"], ["group:queued", "Queued", "2"], ["group:done", "Done", "2"]]);
  assert.deepEqual(a.rowKeys(), ["asking", "blocked", "working", "working2", "checking", "queued", "queued-old", "finished", "finished-old"], "archived work stays on the board; the rest is newest first in each group");
  const words = (id) => a.row(id).querySelector(".sx-row-meta").textContent;
  assert.equal(words("asking"), "Asking a question · waiting 4m", "a worker waiting on you says so, and for how long");
  assert.equal(words("blocked"), "Needs attention");
  assert.equal(words("working"), "Claude Code · Writing parseTags()", "a run says who and what");
  assert.equal(words("working2"), "OpenCode · Reading the map");
  assert.equal(words("checking"), "Checking the result");
  assert.equal(words("queued"), "Ready to start");
  assert.equal(words("finished"), "Verified · 2d ago");
  assert.equal(words("finished-old"), "Confirmed by you · 6d ago");
  assert.deepEqual(a.all("list", ".sx-row").map((node) => node.dataset.tone), ["ask", "ask", "run", "run", "check", "ready", "ready", "done", "done"], "each row carries the tone its dot is drawn in");
  assert.equal(a.row("working").querySelector(".sx-row-bar b").style["--pct"], "60%", "a run's bar is as long as the progress it reports");
  assert.equal(a.row("queued").querySelector(".sx-row-bar"), null, "only a run has one");
});

test("finished work shows twelve rows and offers twenty-five more at a time; a group folds to its heading and the choice is remembered", async () => {
  const finished = Array.from({ length: 40 }, (_, index) => task(`d${String(index).padStart(2, "0")}`, { status: "done", doneAt: at(2) - index * 1000, updatedAt: at(2) - index * 1000 }));
  const a = await sessionsApp({ tasks: [task("ready"), ...finished] });
  await a.settle();
  assert.equal(a.all("list", ".sx-row").filter((node) => node.dataset.tone === "done").length, 12, "twelve to begin with");
  const older = a.one("list", ".sx-older");
  assert.match(older.textContent, /Show 25 older · 28 more/);
  await older.click(); await a.settle();
  assert.equal(a.all("list", ".sx-row").filter((node) => node.dataset.tone === "done").length, 37);
  assert.match(a.one("list", ".sx-older").textContent, /Show 3 older · 3 more/);
  // Folding a group keeps its heading and the count, and is remembered for the project.
  const head = a.all("list", ".sx-gh").find((node) => node.dataset.key === "group:done");
  assert.equal(head.getAttribute("aria-expanded"), "true");
  await head.click(); await a.settle();
  assert.equal(a.all("list", ".sx-row").filter((node) => node.dataset.tone === "done").length, 0);
  assert.equal(a.all("list", ".sx-gh").find((node) => node.dataset.key === "group:done").getAttribute("aria-expanded"), "false");
  assert.deepEqual(JSON.parse(a.storage.get("mefiStudio.sessions.v1")).p.p1.closed, { done: true });
  a.S.detach();
  const again = await sessionsApp({ tasks: [task("ready"), ...finished], storage: a.storage });
  await again.settle();
  assert.equal(again.all("list", ".sx-row").filter((node) => node.dataset.tone === "done").length, 0, "the next launch keeps it folded");
});

test("motion is opt-in: every animation and transition in the stylesheet sits inside prefers-reduced-motion: no-preference and yields to data-motion=off", () => {
  const moving = css.split(/\r?\n/).filter((line) => /(^|[\s{;])(animation|transition)\s*:/.test(line));
  assert.ok(moving.length >= 3, "there is motion to check: the pulse, the fade and the chevron");
  for (const line of moving) assert.match(line, /^@media \(prefers-reduced-motion: no-preference\) \{ html:not\(\[data-motion="off"\]\) /, `not gated: ${line.trim()}`);
});

test("every line of a row is drawn, and what a row says follows html[data-detail] in the stylesheet: titles, then status, then everything", async () => {
  const a = await open({ worktrees: { state: () => ({ list: { repo: true, rows: [{ kind: "run", branch: "mefi/tags", task: { taskId: "working" } }] } }), summary: () => ({ repo: true, tasks: ["working"] }), peek: () => Promise.resolve() } });
  await a.settle();
  const row = a.row("working");
  assert.ok(row.querySelector(".sx-row-meta") && row.querySelector(".sx-row-more") && row.querySelector(".sx-row-bar"), "the DOM holds the lot; the stylesheet says how much shows");
  assert.match(row.querySelector(".sx-row-more").textContent, /Claude Code · mefi\/tags/, "who is on it and where it runs");
  assert.match(css, /\.sx-row-more \{ display: none;/, "a row shows no extra line at the default level");
  assert.match(css, /html\[data-detail="titles"\] :is\(\.sx-row-meta, \.sx-row-more, \.sx-row-bar\) \{ display: none; \}/, "titles: nothing under a title");
  assert.match(css, /html\[data-detail="all"\] \.sx-row-more \{ display: block; \}/, "everything: the extra line too");
  // A change of setting needs no redraw: nothing in the script reads it.
  assert.doesNotMatch(readFileSync(new URL("../renderer/sessions.js", import.meta.url), "utf8"), /dataset\??\.detail/, "the script never reads the detail level");
});

test("a run in its own worktree wears the branch mark, from the list worktrees.js already holds; the look is quiet and throttled", async () => {
  let peeks = 0;
  const rows = { list: { repo: true, rows: [{ kind: "primary", path: "/w", branch: "main", task: null }, { kind: "run", path: "/w/r2", branch: "mefi/tags", state: "unpushed", task: { taskId: "working" } }, { kind: "run", path: "/w/gone", branch: "mefi/old", state: "missing", task: { taskId: "queued" } }] } };
  const worktrees = { state: () => rows, summary: () => ({ repo: true, tasks: ["working", "queued"] }), peek: () => { peeks += 1; return Promise.resolve(); } };
  const a = await open({ worktrees });
  await a.settle();
  const marked = a.all("list", ".sx-row").filter((node) => node.querySelector(".sx-branch")).map((node) => node.dataset.key);
  assert.deepEqual(marked.sort(), ["queued", "working"].sort(), "a checkout the list names wears the mark (a missing folder's name is in the summary too, without its branch)");
  assert.ok(a.row("working").querySelector(".sx-row-main").title.includes("in its own worktree"));
  assert.match(a.row("working").querySelector(".sx-row-more").textContent, /mefi\/tags/, "a checkout that is there names its branch on the extra line");
  assert.doesNotMatch(a.row("queued").querySelector(".sx-row-more").textContent, /mefi\/old/, "a folder that is gone does not lend its old branch name");
  assert.match(a.row("queued").querySelector(".sx-row-more").textContent, /own worktree/);
  assert.ok(peeks <= 2, `it asked for a fresh look a couple of times, not on every paint (${peeks})`);
  const before = peeks;
  for (let round = 0; round < 6; round += 1) { a.env.emit("mefi:workspace-state"); await a.settle(); }
  assert.equal(peeks, before, "and not again within a few seconds");
  // The worktrees page announces a change; the mark follows.
  rows.list = { repo: true, rows: [] };
  worktrees.summary = () => ({ repo: true, tasks: [] });
  a.env.emit("mefi:worktrees", { tasks: [] }); await a.settle();
  assert.equal(a.all("list", ".sx-branch").length, 0, "the mark goes when the checkout does");
});

test("a window nobody can see is not drawn, and is drawn once, current, when it is shown again", async () => {
  const a = await open();
  await a.settle();
  assert.equal(a.row("queued").querySelector(".sx-row-title").textContent, "Task queued");
  a.document.hidden = true;
  a.data.tasks = a.data.tasks.map((row) => (row.id === "queued" ? { ...row, title: "Renamed while hidden" } : row));
  a.env.emit("mefi:workspace-state"); a.env.emit("mefi:workspace-state"); await a.settle(4);
  assert.equal(a.row("queued").querySelector(".sx-row-title").textContent, "Task queued", "nothing was drawn for a window nobody sees");
  a.document.hidden = false; await a.document.body.trigger("visibilitychange"); await a.settle(4);
  assert.equal(a.row("queued").querySelector(".sx-row-title").textContent, "Renamed while hidden", "and it is current the moment it is shown");
});

test("a project that is not a git folder has no marks, and nothing asks for worktrees where the module is absent", async () => {
  const a = await open({ worktrees: { state: () => ({ list: { repo: false, rows: [] } }), summary: () => ({ repo: false, tasks: [] }), peek: () => Promise.resolve() } });
  await a.settle();
  assert.equal(a.all("list", ".sx-branch").length, 0);
  const b = await open();
  delete b.window.MefiWorktrees;
  b.env.emit("mefi:workspace-state"); await b.settle();
  assert.equal(b.all("list", ".sx-row").length, 9, "the list still draws");
});

// ---- the head, New task, Backlog and the filter -------------------------------------------------------------------------------------

test("the head names the project and its branch and opens the project menu; New task is Home's own box and puts the thread away", async () => {
  const a = await open();
  await a.settle();
  assert.equal(a.text("list", ".sx-proj-words b"), "Snake trial");
  assert.equal(a.text("list", ".sx-proj-words small"), "main", "the branch comes from work:where");
  assert.ok(a.api.of("workWhere").length >= 1 && a.api.of("workWhere").length <= 2);
  await a.one("list", "#sessions-project").click(); await a.settle();
  assert.ok(a.one("list", "#sessions-project-menu"), "the project menu opens on the head");
  await a.all("list", "#sessions-project-menu .sx-menu-item").find((node) => node.textContent.includes("All projects"))?.click();
  assert.deepEqual(clean(a.calls.sidebar), [{ focus: true, projectFocus: true }], "All projects is the panel the rest of the app opens");
  assert.equal(a.one("list", "#sessions-project-menu"), null, "and the menu goes");
  a.S.select("working"); await a.settle();
  assert.equal(a.S.selected(), "working");
  await a.one("list", "#sessions-new").click(); await a.settle();
  assert.equal(a.calls.compose, 1, "New task is Home's own message box in its task purpose: pictures, @ # / and chips are all there");
  assert.equal(a.S.selected(), null, "and the thread makes way for it");
  assert.match(a.one("list", "#sessions-new").textContent, /Ctrl N/);
});

test("the project menu lists every project with the open one checked, switches through Home's own project buttons, and opens a folder, a new app or all projects", async () => {
  const a = await open({ focus: true });
  a.data.projects = [{ id: "p1", name: "Snake trial", path: "/work/snake" }, { id: "p2", name: "Notes app", path: "/work/notes" }];
  // Home's own controls, which the menu presses (their rules, such as Save & switch for running agents, stay theirs).
  const pressed = [];
  const own = (id, attrs = {}) => { const node = a.document.createElement("button"); node.id = id; Object.assign(node.dataset, attrs); node.addEventListener("click", () => pressed.push(id || attrs.projectId)); return node; };
  const projects = a.document.createElement("div"); projects.id = "workspace-projects"; projects.append(own("", { projectId: "p1" }), own("", { projectId: "p2" }));
  a.document.body.append(projects, own("workspace-add-project"));
  a.window.MefiVibe.openPanel = (kind) => pressed.push(`vibe:${kind}`);
  a.env.emit("mefi:workspace-state"); await a.settle();
  const head = a.one("list", "#sessions-project");
  assert.equal(head.getAttribute("aria-haspopup"), "menu"); assert.equal(head.getAttribute("aria-expanded"), "false");
  await head.click(); await a.settle();
  const menu = a.one("list", "#sessions-project-menu");
  assert.equal(menu.getAttribute("role"), "menu"); assert.equal(head.getAttribute("aria-expanded"), "true");
  const items = () => a.all("list", "#sessions-project-menu .sx-menu-item");
  assert.deepEqual(items().map((node) => node.querySelector(".sx-menu-words span").textContent), ["Snake trial", "Notes app", "Open a folder…", "Start a new app…", "All projects…"]);
  assert.deepEqual(items().slice(0, 2).map((node) => [node.getAttribute("role"), node.getAttribute("aria-checked")]), [["menuitemradio", "true"], ["menuitemradio", "false"]], "the open project is the checked one");
  assert.equal(items()[1].querySelector("small").textContent, "/work/notes", "each says where it is");
  assert.equal(a.document.activeElement, items()[0], "the keyboard starts on the open project");
  await items()[0].trigger("keydown", { key: "ArrowDown" });
  assert.equal(a.document.activeElement, items()[1], "the arrows move through it");
  await items()[1].trigger("keydown", { key: "End" });
  assert.equal(a.document.activeElement, items()[4]);
  await items()[1].click(); await a.settle();
  assert.deepEqual(pressed, ["p2"], "a project switches through Home's own button for it");
  assert.equal(a.one("list", "#sessions-project-menu"), null);
  for (const [label, expected] of [["Snake trial", []], ["Open a folder…", ["workspace-add-project"]], ["Start a new app…", ["vibe:newapp"]]]) {
    pressed.length = 0;
    await head.click(); await a.settle();
    await items().find((node) => node.textContent.includes(label)).click(); await a.settle();
    assert.deepEqual(pressed, expected, label);
  }
  // Escape closes it and gives the head the focus back; a press elsewhere closes it too.
  await head.click(); await a.settle();
  await items()[0].trigger("keydown", { key: "Escape" }); await a.settle();
  assert.equal(a.one("list", "#sessions-project-menu"), null); assert.equal(a.document.activeElement, a.one("list", "#sessions-project"));
  await a.one("list", "#sessions-project").click(); await a.settle();
  await a.document.body.trigger("pointerdown", { target: a.document.body }); await a.settle();
  assert.equal(a.one("list", "#sessions-project-menu"), null);
  // A switch with no button of Home's own for it falls back to the project panel.
  projects.remove();
  await a.one("list", "#sessions-project").click(); await a.settle();
  await items()[1].click(); await a.settle();
  assert.deepEqual(clean(a.calls.sidebar), [{ focus: true, projectFocus: true }]);
});

test("under the project: the Git chip is git-sync.js's own, in its list look, and the worktrees chip counts the project's other checkouts and opens Work › Worktrees", async () => {
  const mounted = [];
  const rows = [{ kind: "primary", path: "/work/snake", branch: "main", state: "primary" }, { kind: "run", path: "/work/snake/.mefi/worktrees/r1", branch: "mefi/r1", state: "unpushed", task: { taskId: "working" } }, { kind: "dev", path: "/work/snake-docs", branch: "docs", state: "merged" }];
  const worktrees = { state: () => ({ list: { repo: true, rows, headline: "3 worktrees: 1 holds work that exists only on this PC." } }), summary: () => ({ repo: true, tasks: ["working"] }), peek: () => Promise.resolve() };
  const a = await open({ worktrees });
  a.window.MefiGitSync = { mount: (host, options) => { mounted.push([host.className, options.variant]); if (!host.children.length) { const slot = a.document.createElement("span"); slot.className = "gs-slot"; host.append(slot); } return host.children[0]; } };
  a.env.emit("mefi:workspace-state"); await a.settle();
  assert.deepEqual(mounted.at(-1), ["sx-git", "list"], "the one chip, with the branch before the state; its popover is the only one");
  assert.equal(a.one("list", "#sessions-gitrow .sx-git").children.length, 1, "mounting again on a redraw adds nothing");
  const trees = a.one("list", "#sessions-worktrees");
  assert.equal(trees.hidden, false); assert.equal(trees.textContent, "2 worktrees", "the main checkout is the project itself, not one of them");
  assert.match(trees.title, /1 holds work that exists only on this PC\. Open Work › Worktrees\./);
  await trees.click();
  assert.deepEqual(clean(a.calls.go.at(-1)), ["worktrees"]);
  rows.splice(1); a.env.emit("mefi:worktrees"); a.env.emit("mefi:workspace-state"); await a.settle();
  assert.equal(a.one("list", "#sessions-worktrees").hidden, true, "no other checkout: no chip");
  const order = a.list().children.map((node) => node.id || node.className);
  assert.ok(order.indexOf("sessions-project") < order.indexOf("sessions-gitrow") && order.indexOf("sessions-gitrow") < order.indexOf("sessions-new"), "project, then Git and worktrees, then New task");
});

test("Backlog lists plan drafts first and then ideas, the plans read from the Plans page's own call; a plan opens in Plans, and the two scans are a press away", async () => {
  const api = bridge();
  const plans = [
    { id: "plan_1", projectId: "p1", title: "Sync notes between devices", status: "planning", questions: [{ status: "open" }, { status: "resolved" }, { status: "open" }], updatedAt: at(1) },
    { id: "plan_2", projectId: "p1", title: "Tags", status: "converted", updatedAt: at(1) },
    { id: "plan_3", projectId: "p1", title: "Offline mode", status: "ready", questions: [], updatedAt: at(3) },
    { id: "plan_4", projectId: "p1", title: "Shelved", status: "planning", archivedAt: at(2), updatedAt: at(2) },
    { id: "plan_5", projectId: "other", title: "Another project's", status: "planning", updatedAt: at(1) },
  ];
  api.planningList = async (payload) => { api.calls.push(["planningList", payload]); return { ok: true, projectId: "p1", plans }; };
  const ideas = [{ id: "i1", title: "Share a note", source: "Mefi", at: at(1), status: "open" }];
  const a = await open({ api, ideas });
  await a.settle();
  assert.deepEqual(clean(api.of("planningList")[0]), ["planningList", { projectId: "p1" }], "read for this project");
  assert.equal(a.one("list", "#sessions-tab-backlog").textContent, "Backlog · 3", "the drafts count with the ideas");
  const scans = [];
  a.window.MefiNav.get = (id) => (id === "scanIdeas" ? { id, desc: "Read recent chats", run: () => scans.push("chats") } : null);
  await a.one("list", "#sessions-tab-backlog").click(); await a.settle();
  assert.equal(api.of("planningList").length, 2, "opening the tab reads them again");
  assert.deepEqual(a.rowKeys(), ["plan:plan_1", "plan:plan_3", "idea:i1"], "drafts that have not made their tasks, newest first, then the ideas");
  assert.equal(a.row("plan:plan_1").dataset.tone, "plan");
  assert.equal(a.row("plan:plan_1").querySelector(".sx-row-meta").textContent, "Plan draft · 2 open questions · 1d ago");
  assert.equal(a.row("plan:plan_3").querySelector(".sx-row-meta").textContent, "Plan approved, tasks not made yet · 3d ago");
  assert.match(a.row("plan:plan_1").querySelector(".sx-row-main").getAttribute("aria-label"), /^Plan: Sync notes between devices\./);
  await a.row("plan:plan_1").querySelector(".sx-row-main").click();
  assert.deepEqual(clean(a.calls.go.at(-1)), ["plans", { planId: "plan_1", view: "draft" }], "a draft opens as its own page in Plans");
  const buttons = a.all("list", ".sx-scan button");
  assert.deepEqual(buttons.map((node) => node.textContent), ["Scan the project", "Scan chats for ideas"]);
  await buttons[0].click(); assert.deepEqual(clean(a.calls.go.at(-1)), ["analyzer"], "the Analyzer reads the project");
  await buttons[1].click(); assert.deepEqual(scans, ["chats"], "the palette's own Scan chats for ideas");
  const input = a.one("list", "#sessions-find");
  input.value = "offline"; await input.trigger("input"); await a.settle();
  assert.deepEqual(a.rowKeys(), ["plan:plan_3"], "the filter narrows the drafts too");
  // A host without the call has ideas only.
  const plain = await open({ ideas });
  await plain.one("list", "#sessions-tab-backlog").click(); await plain.settle();
  assert.deepEqual(plain.rowKeys(), ["idea:i1"]);
});

test("Ctrl N starts a task from anywhere in Build, and does nothing in Vibe, under an overlay, or when something already took the key", async () => {
  const a = await open();
  await a.settle();
  const send = (extra = {}) => { const event = { type: "keydown", key: "n", ctrlKey: true, preventDefault() { this.prevented = true; }, ...extra }; a.window.dispatchEvent(event); return event; };
  let event = send();
  assert.equal(event.prevented, true); assert.equal(a.calls.compose, 1, "Ctrl N starts a task");
  event = send({ key: "N" }); assert.equal(a.calls.compose, 2, "either case of the letter");
  event = send({ ctrlKey: false, metaKey: true }); assert.equal(a.calls.compose, 3, "Cmd N on a Mac");
  for (const extra of [{ shiftKey: true }, { altKey: true }, { key: "m" }, { ctrlKey: false }, { defaultPrevented: true }]) { send(extra); assert.equal(a.calls.compose, 3, `not for ${JSON.stringify(extra)}`); }
  a.nav.topOverlay = "palette"; send(); assert.equal(a.calls.compose, 3, "an open overlay keeps the key");
  a.nav.topOverlay = null;
  a.window.MefiVibe = { mode: () => "vibe", isActive: () => true }; send(); assert.equal(a.calls.compose, 3, "Vibe has its own box");
});

test("Sessions | Backlog: the backlog lists the ideas nobody made a task of, newest first; the filter narrows either list and Escape clears it", async () => {
  const ideas = [{ id: "i2", title: "Tag suggestions", at: at(8), status: "open" }, { id: "i3", title: "Done already", at: at(1), status: "done" }, { id: "i1", title: "Share a note", detail: "a link", source: "Mefi", at: at(1), status: "open" }, { id: "i4", title: "Already a task", at: at(1), status: "open", taskId: "queued" }];
  const a = await open({ ideas });
  await a.settle();
  assert.equal(a.one("list", "#sessions-tab-backlog").textContent, "Backlog · 2", "the tab counts what is waiting");
  await a.one("list", "#sessions-tab-backlog").click(); await a.settle();
  assert.deepEqual(a.rowKeys(), ["idea:i1", "idea:i2"]);
  assert.equal(a.one("list", "#sessions-tab-backlog").getAttribute("aria-selected"), "true");
  assert.equal(JSON.parse(a.storage.get("mefiStudio.sessions.v1")).p.p1.tab, "backlog", "the last tab a person used is remembered");
  assert.equal(a.row("idea:i1").querySelector(".sx-row-meta").textContent, "From Mefi · 1d ago");
  await a.row("idea:i1").querySelector(".sx-row-main").click();
  assert.deepEqual(clean(a.calls.go.at(-1)), ["ideas", { ideaId: "i1" }], "an idea opens in the ideas page");
  const input = a.one("list", "#sessions-find");
  input.value = "tag"; await input.trigger("input"); await a.settle();
  assert.deepEqual(a.rowKeys(), ["idea:i2"]);
  input.value = "zzz"; await input.trigger("input"); await a.settle();
  assert.match(a.text("list", ".sx-empty"), /Nothing in the backlog matches that filter/);
  await input.trigger("keydown", { key: "Escape" }); await a.settle();
  assert.equal(input.value, "", "Escape clears the filter"); assert.equal(a.rowKeys().length, 2);
  await a.one("list", "#sessions-tab-sessions").click(); await a.settle();
  input.value = "TAG"; await input.trigger("input"); await a.settle();
  assert.deepEqual(a.rowKeys(), [], "no task has that word");
  input.value = "archived"; await input.trigger("input"); await a.settle();
  assert.deepEqual(a.rowKeys(), [], "archived work is not on the list");
  input.value = "finished"; await input.trigger("input"); await a.settle();
  assert.deepEqual(a.rowKeys(), ["finished", "finished-old"], "a word matches a title (or a brief)");
  input.value = "  TASK FINISHED "; await input.trigger("input"); await a.settle();
  assert.deepEqual(a.rowKeys(), ["finished", "finished-old"], "in any case, and spaces around it do not count (the titles read 'Task finished')");
  input.value = "do finished-old"; await input.trigger("input"); await a.settle();
  assert.deepEqual(a.rowKeys(), ["finished-old"], "the brief is searched too: only its prompt reads 'Do finished-old'");
});

test("the list says what to do when there is no project, no task or no match", async () => {
  const none = await sessionsApp({ tasks: [] });
  none.data.projectId = null; none.data.project = null;
  none.env.emit("mefi:workspace-state"); await none.settle();
  assert.match(none.text("list", ".sx-empty"), /Open a project folder/);
  await none.one("list", ".sx-empty button").click();
  assert.equal(none.calls.sidebar.length, 1);
  const empty = await sessionsApp({ tasks: [] });
  await empty.settle();
  assert.match(empty.text("list", ".sx-empty"), /Tasks you start show up here/);
  await empty.one("list", ".sx-empty button").click();
  assert.equal(empty.calls.compose, 1, "its button starts one");
});

test("the list is one tab panel named by the tab that is on, its headings and rows are buttons, and its tab stop is one", async () => {
  const a = await open();
  await a.settle();
  const panel = a.one("list", "#sessions-list-scroll");
  assert.equal(panel.getAttribute("role"), "tabpanel"); assert.equal(panel.getAttribute("aria-labelledby"), "sessions-tab-sessions");
  assert.deepEqual(a.all("list", "[role=tab]").map((node) => [node.id, node.getAttribute("aria-controls"), node.getAttribute("aria-selected")]), [["sessions-tab-sessions", "sessions-list-scroll", "true"], ["sessions-tab-backlog", "sessions-list-scroll", "false"]]);
  await a.one("list", "#sessions-tab-backlog").click(); await a.settle();
  assert.equal(panel.getAttribute("aria-labelledby"), "sessions-tab-backlog", "the panel follows the tab");
  assert.equal(a.all("list", "[role=list], [role=listitem]").length, 0, "no list roles that would hold headings and buttons");
  await a.one("list", "#sessions-tab-sessions").click(); await a.settle();
  assert.ok(a.all("list", ".sx-row-main").every((node) => node.tagName === "button" && node.type === "button"), "each row is a button");
  assert.ok(a.all("list", ".sx-row-main").every((node) => node.getAttribute("aria-label").startsWith("Task ")), "named by its title, then its state");
  assert.match(main(a, "asking").getAttribute("aria-label"), /^Task asking\. Needs your answer\. Asking a question · waiting 4m$/);
  assert.match(main(a, "working").getAttribute("aria-label"), /^Task working\. Working\. Claude Code · Writing parseTags\(\)$/);
});

test("MefiSessions.open opens a session in a tab of its own, newTask starts Home's box, and the model's list is the data the rows are drawn from", async () => {
  const a = await open();
  await a.settle();
  assert.equal(a.S.open("working"), true);
  assert.deepEqual(clean(a.calls.tabsOpened.at(-1)), ["workspace", { view: "task", taskId: "working", projectId: "p1" }, { preview: false }]);
  a.S.newTask(); assert.equal(a.calls.compose, 1); assert.equal(a.S.selected(), null);
  const data = a.data;
  const model = a.S.model.list(data, { now: NOW, pinned: new Set(["queued-old"]), open: "working", worktrees: new Map([["working", { branch: "mefi/x" }]]), counts: (id) => (id === "working" ? { files: 3, additions: 5, deletions: 1 } : null) });
  assert.deepEqual(clean(model.groups.map((group) => [group.key, group.count, group.rows.length, group.closed, group.older])), [["needs", 2, 2, false, 0], ["running", 2, 2, false, 0], ["review", 1, 1, false, 0], ["queued", 2, 2, false, 0], ["done", 2, 2, false, 0]]);
  const running = model.groups.find((group) => group.key === "running").rows.find((row) => row.id === "working");
  assert.deepEqual(clean({ selected: running.selected, worktree: running.worktree, extra: running.extra, status: running.status, progress: running.progress }), { selected: true, worktree: "mefi/x", extra: "Claude Code · mefi/x · +5 −1", status: "Claude Code · Writing parseTags()", progress: 0.6 });
  assert.equal(model.groups.find((group) => group.key === "queued").rows[0].id, "queued-old", "a pinned task leads its group");
  assert.deepEqual(clean(a.S.model.list(data, { now: NOW, query: "working" }).groups.map((group) => group.count)), [2], "a filter leaves only the groups that have a match");
  assert.deepEqual(clean(a.S.model.list(data, { now: NOW, closed: { done: true } }).groups.find((group) => group.key === "done")), { key: "done", title: "Done", tone: "done", count: 2, closed: true, older: 0, rows: [] });
  assert.equal(a.S.model.list(data, { now: NOW }).total, 9); assert.equal(a.S.model.list(data, { now: NOW, query: "zzz" }).total, 0);
  assert.deepEqual(clean(a.S.model.backlog({ ideas: [{ id: "i1", title: "Idea", source: "Mefi", at: at(1), status: "open" }] }, { now: NOW })), [{ id: "i1", title: "Idea", meta: "From Mefi · 1d ago" }]);
});

// ---- selecting a session ---------------------------------------------------------------------------------------------------------------

test("a click opens a session the way a tab remembers it, Home with view: task, and the row marks itself", async () => {
  const a = await open();
  await a.settle();
  await a.row("working").querySelector(".sx-row-main").click(); await a.settle();
  assert.deepEqual(clean(a.calls.tabsOpened), [["workspace", { view: "task", taskId: "working", projectId: "p1" }, { preview: true }]], "a single click is a preview tab");
  assert.equal(a.S.selected(), "working");
  assert.ok(a.row("working").hasAttribute("data-selected"));
  assert.equal(a.row("working").querySelector(".sx-row-main").getAttribute("aria-current"), "true");
  assert.equal(a.row("asking").querySelector(".sx-row-main").getAttribute("aria-current"), null);
  assert.deepEqual(clean(a.calls.selected), [{ taskId: "working", projectId: "p1", title: "Task working" }], "the rest of the app's 'current task' follows");
  // Without the tab strip the router opens it.
  const plain = await open({ tabs: false });
  await plain.settle();
  await plain.row("working").querySelector(".sx-row-main").click();
  assert.deepEqual(clean(plain.calls.go), [["workspace", { view: "task", taskId: "working", projectId: "p1" }]]);
  assert.equal(a.S.select("nobody"), false, "a task that is not on the board cannot be selected");
});

test("a session opened from anywhere (a tab, a notification, the palette) is selected in the list; Home by itself puts the thread away", async () => {
  const a = await open();
  await a.settle();
  a.navigate("workspace", { view: "task", taskId: "checking", projectId: "p1" }); await a.settle();
  assert.equal(a.S.selected(), "checking");
  assert.ok(a.row("checking").hasAttribute("data-selected"));
  assert.equal(a.calls.tabsOpened.length + a.calls.go.length, 0, "it was opened by the router already: nothing opens it again");
  a.navigate("workspace", { view: "task", taskId: "queued", projectId: "p-other" }); await a.settle();
  assert.equal(a.S.selected(), "checking", "another project's route is not this list's");
  a.navigate("workspace", { view: "task", taskId: "queued", projectId: "p1", tab: "checks" }); await a.settle();
  assert.equal(a.S.selected(), "queued"); assert.equal(a.S.tab(), "checks", "a route can name the inspector tab");
  a.navigate("workspace", {}); await a.settle();
  assert.equal(a.S.selected(), null, "Home asked for by itself shows Home");
  assert.equal(a.row("queued").hasAttribute("data-selected"), false);
  a.navigate("vibe", { view: "task", taskId: "finished", projectId: "p1" }); await a.settle();
  assert.equal(a.S.selected(), "finished", "Vibe's Home opens a session here too");
  a.navigate("settings", {}); await a.settle();
  assert.equal(a.S.selected(), "finished", "leaving for another page keeps the selection: the thread is simply not on screen");
});

test("nav.go('tasks', { taskId }) lands in the thread; the board itself stays one press away", async () => {
  const a = await open();
  await a.settle();
  assert.deepEqual(clean(a.S.redirect("tasks", { taskId: "working", projectId: "p1", filter: "all" })), { id: "workspace", params: { view: "task", taskId: "working", projectId: "p1" } });
  assert.deepEqual(clean(a.S.redirect("tasks", { taskId: "working", panel: "evidence" }).params), { view: "task", taskId: "working", projectId: "p1", tab: "checks" }, "View checks opens the Checks tab");
  assert.equal(a.S.redirect("tasks", { taskId: "working", board: true }), null, "the board is one press away (board: true)");
  assert.equal(a.S.redirect("tasks", {}), null, "a plain go('tasks') is the board");
  assert.equal(a.S.redirect("tasks", { taskId: "nobody" }), null, "a task that is gone is the board's to say");
  assert.equal(a.S.redirect("tasks", { taskId: "working", projectId: "p-other" }), null, "and another project's");
  assert.equal(a.S.redirect("command", { taskId: "working" }), null, "only the task board is redirected");
  assert.equal(a.S.redirect("workspace", { view: "task", taskId: "working" }), null, "and never twice");
  a.S.detach();
  assert.equal(a.S.redirect("tasks", { taskId: "working" }), null, "with the panels away it is the board");
});

test("renderer/nav.js hands a task opened by its id to the thread, and the layout switch to the panels: its two marked blocks", () => {
  // The blocks are the only change nav.js has for this; they are cut out by their markers and run on their own, since nav.js itself needs a whole page.
  const nav = readFileSync(new URL("../renderer/nav.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const blocks = [...nav.matchAll(/ *\/\/ ---- sessions \(renderer\/sessions\.js\) ----\n([\s\S]*?)\n *\/\/ ---- end of sessions ----/g)].map((match) => match[1]);
  assert.equal(blocks.length, 2, "one in go(), one in applyLayout()");
  assert.ok(nav.indexOf("function go(") < nav.indexOf(blocks[0]) && nav.indexOf(blocks[0]) < nav.indexOf("// In Vibe mode, Home is Vibe"), "the redirect comes first in go(), before anything is closed or opened");
  const applyAt = nav.indexOf("function applyLayout(");
  assert.ok(applyAt < nav.indexOf(blocks[1]) && nav.indexOf(blocks[1]) < nav.indexOf("\n  function ", applyAt + 1), "the switch is the last thing applyLayout() does");
  const goBlock = vm.runInNewContext(`(function (window, go, id, params, options) { ${blocks[0]}\n return "fell through"; })`);
  const seen = [];
  const follow = (...args) => { seen.push(args); return "followed"; };
  const route = { id: "workspace", params: { view: "task", taskId: "t1" } };
  assert.equal(goBlock({ MefiSessions: { redirect: (id) => (id === "tasks" ? route : null) } }, follow, "tasks", { taskId: "t1" }, { replace: true }), "followed", "the route the module names is the one that is taken");
  assert.deepEqual(seen, [["workspace", { view: "task", taskId: "t1" }, { replace: true }]], "with its params and the caller's own options");
  assert.equal(goBlock({ MefiSessions: { redirect: () => null } }, follow, "tasks", {}, {}), "fell through", "no route from the module: the router goes on as it was");
  assert.equal(goBlock({}, follow, "tasks", {}, {}), "fell through", "and without the module the route is the router's own");
  const applyBlock = vm.runInNewContext(`(function (window, on, was) { ${blocks[1]} })`);
  const calls = [];
  const module = { MefiSessions: { attach: () => calls.push("attach"), detach: () => calls.push("detach") } };
  applyBlock(module, true, false); applyBlock(module, false, true); applyBlock(module, false, false); applyBlock(module, true, true);
  assert.deepEqual(calls, ["attach", "detach", "attach"], "on draws the panels, off after on takes them away, off after off does nothing");
  assert.doesNotThrow(() => applyBlock({}, true, false), "a page without the module is unaffected");
});

test("what is selected is remembered for each project and comes back on the next launch; another project has its own", async () => {
  const storage = new Map();
  const a = await open({ storage });
  await a.settle();
  a.S.select("queued", { route: false }); a.S.setTab("changes"); await a.settle();
  const saved = JSON.parse(storage.get("mefiStudio.sessions.v1"));
  assert.equal(saved.p.p1.open, "queued"); assert.deepEqual(saved.p.p1.itab, { queued: "changes" });
  a.S.detach();
  const b = await open({ storage });
  await b.settle();
  assert.equal(b.S.selected(), "queued", "the session that was open is open again");
  assert.equal(b.S.tab(), "changes", "and so is the tab that was chosen for it");
  // Another project: its own memory, and back again.
  const find = b.one("list", "#sessions-find"); find.value = "queued"; await find.trigger("input"); await b.settle();
  assert.deepEqual(b.rowKeys(), ["queued", "queued-old"], "a filter is typed in the first project");
  b.data.projectId = "p2"; b.data.tasks = [task("other", { projectId: "p2" })];
  b.env.emit("mefi:project-changed", { projectId: "p2" }); await b.settle();
  assert.equal(b.S.selected(), null, "a project with no memory opens on Home");
  assert.deepEqual(b.rowKeys(), ["other"], "the filter was about the first project's words, and is gone (every row of this one shows)");
  assert.equal(find.value, "", "and the box does not keep the words it no longer applies");
  b.S.select("other", { route: false }); await b.settle();
  b.data.projectId = "p1"; b.data.tasks = board();
  b.env.emit("mefi:project-changed", { projectId: "p1" }); await b.settle();
  assert.equal(b.S.selected(), "queued", "the first project's session is still remembered");
  // The memory keeps the last twelve projects, not every one there ever was.
  for (let index = 0; index < 15; index += 1) { b.data.projectId = `px${index}`; b.data.tasks = [task("t", { projectId: `px${index}` })]; b.env.emit("mefi:project-changed", { projectId: `px${index}` }); await b.settle(); b.S.select("t", { route: false }); }
  assert.ok(Object.keys(JSON.parse(storage.get("mefiStudio.sessions.v1")).p).length <= 12, "twelve projects at most");
});

test("a remembered session that is not on the board is waited for while the board is empty and let go of, with a word, once it is not", async () => {
  const memory = () => new Map([["mefiStudio.sessions.v1", JSON.stringify({ p: { p1: { open: "deleted" } } })]]);
  // A slow launch: the board has not been read yet. The thread says so, in words, and keeps the memory.
  const slow = await sessionsApp({ tasks: [], storage: memory() });
  await slow.settle();
  assert.equal(slow.S.selected(), "deleted", "remembered until the board says otherwise");
  assert.match(slow.text("main", "#sessions-thread-scroll"), /Opening the session/);
  assert.equal(slow.calls.toasts.length, 0);
  slow.tick(7000); slow.env.emit("mefi:workspace-state"); await slow.settle();
  assert.equal(slow.S.selected(), null, "an empty board after a few seconds has no such session");
  // A board that has loaded and does not have it: it is gone (deleted elsewhere), and the person is told once.
  const loaded = await sessionsApp({ tasks: board(), running: jobs(), stages, storage: memory() });
  await loaded.settle();
  assert.equal(loaded.S.selected(), null, "the session that is not there is let go of");
  assert.deepEqual(loaded.calls.toasts.map((item) => item.message), ["That session is no longer on the board."]);
  assert.equal(JSON.parse(loaded.storage.get("mefiStudio.sessions.v1")).p.p1.open, null, "and forgotten");
  // One that was open and is deleted under you.
  const live = await sessionsApp({ tasks: board(), running: jobs(), stages });
  await live.settle();
  live.S.select("working", { route: false }); await live.settle();
  live.data.tasks = live.data.tasks.filter((row) => row.id !== "working"); live.env.emit("mefi:workspace-state"); await live.settle();
  assert.equal(live.S.selected(), null); assert.deepEqual(live.calls.toasts.map((item) => item.message), ["That session is no longer on the board."]);
});

// ---- the row's menu, rename and delete ------------------------------------------------------------------------------------------------

const openMenu = async (a, id) => { await a.row(id).querySelector('[data-part="menu"]').click(); await a.settle(); return a.all("list", ".sx-menu .sx-menu-item"); };
const labels = (items) => items.map((node) => node.textContent.trim());

test("a row's menu offers open in a tab, pin, rename, stop (only for a run) and delete, and closes on Escape or a press elsewhere", async () => {
  const a = await open();
  await a.settle();
  assert.deepEqual(labels(await openMenu(a, "queued")), ["Open in a new tab", "Pin to the top", "Rename", "Delete"]);
  assert.equal(a.one("list", ".sx-menu").getAttribute("role"), "menu");
  assert.equal(a.row("queued").querySelector('[data-part="menu"]').getAttribute("aria-expanded"), "true");
  await a.one("list", ".sx-menu").trigger("keydown", { key: "Escape" }); await a.settle();
  assert.equal(a.one("list", ".sx-menu"), null, "Escape closes it");
  assert.deepEqual(labels(await openMenu(a, "working")), ["Open in a new tab", "Pin to the top", "Rename", "Stop this task", "Delete"], "a run can be stopped from here");
  a.env.document.body.trigger("pointerdown", { target: a.env.document.body });
  await a.settle();
  assert.equal(a.one("list", ".sx-menu"), null, "a press elsewhere closes it");
  await openMenu(a, "queued");
  await a.all("list", ".sx-menu .sx-menu-item")[0].click();
  assert.deepEqual(clean(a.calls.tabsOpened.at(-1)), ["workspace", { view: "task", taskId: "queued", projectId: "p1" }, { preview: false }], "Open in a new tab pins a tab of its own");
  assert.equal(a.one("list", ".sx-menu"), null, "choosing closes the menu");
  const noTabs = await open({ tabs: false });
  await noTabs.settle();
  assert.equal((await openMenu(noTabs, "queued"))[0].textContent.trim(), "Open", "with no tab strip it is plain Open");
});

test("Pin puts a task first in its group and Unpin puts it back; the pin is the one the other layout keeps", async () => {
  const a = await open();
  await a.settle();
  await (await openMenu(a, "queued-old"))[1].click(); await a.settle();
  assert.deepEqual(a.all("list", ".sx-row").filter((node) => node.dataset.tone === "ready").map((node) => node.dataset.key), ["queued-old", "queued"], "a pinned task goes first in its group");
  assert.ok(a.row("queued-old").querySelector(".sx-pin"), "with a pin beside its title");
  assert.ok(a.B.pins().has("queued-old"), "builder.js holds the pin: Build's other layout shows it too");
  assert.equal(labels(await openMenu(a, "queued-old"))[1], "Unpin");
  await a.all("list", ".sx-menu .sx-menu-item")[1].click(); await a.settle();
  assert.deepEqual(a.all("list", ".sx-row").filter((node) => node.dataset.tone === "ready").map((node) => node.dataset.key), ["queued", "queued-old"]);
});

test("Rename turns the row into a box; Enter saves through the host, Escape puts it back, an empty or unchanged name does nothing", async () => {
  const a = await open();
  await a.settle();
  await (await openMenu(a, "queued"))[2].click(); await a.settle();
  const box = a.one("list", ".sx-rename");
  assert.ok(box, "the row is a text box"); assert.equal(box.value, "Task queued");
  box.value = "Dark mode for settings"; await box.trigger("input");
  await box.trigger("keydown", { key: "Enter" }); await a.settle();
  assert.deepEqual(clean(a.api.of("tasksAction")), [["tasksAction", { taskId: "queued", projectId: "p1", action: "rename", title: "Dark mode for settings" }]]);
  assert.equal(a.calls.refresh, 1, "the board is read again");
  assert.deepEqual(a.calls.toasts.at(-1).message, "Renamed.");
  // Escape and unchanged names.
  await (await openMenu(a, "queued"))[2].click(); await a.settle();
  await a.one("list", ".sx-rename").trigger("keydown", { key: "Escape" }); await a.settle();
  assert.equal(a.one("list", ".sx-rename"), null); assert.equal(a.api.of("tasksAction").length, 1, "Escape saves nothing");
  await (await openMenu(a, "queued"))[2].click(); await a.settle();
  const same = a.one("list", ".sx-rename"); same.value = "  Task queued "; await same.trigger("input"); await same.trigger("keydown", { key: "Enter" }); await a.settle();
  assert.equal(a.api.of("tasksAction").length, 1, "the name it already has (spaces aside) is not saved again");
  assert.equal(a.one("list", ".sx-rename"), null, "and the row is a row again");
  await (await openMenu(a, "queued"))[2].click(); await a.settle();
  const blank = a.one("list", ".sx-rename"); blank.value = "  "; await blank.trigger("input"); await blank.trigger("keydown", { key: "Enter" }); await a.settle();
  assert.equal(a.api.of("tasksAction").length, 1, "a blank name is not a name");
  // A host that refuses says why, and the list keeps the old name.
  a.api.state.fail.tasksAction = "The task store is busy.";
  await (await openMenu(a, "queued"))[2].click(); await a.settle();
  const again = a.one("list", ".sx-rename"); again.value = "Another"; await again.trigger("input"); await again.trigger("keydown", { key: "Enter" }); await a.settle();
  assert.equal(a.calls.toasts.at(-1).kind, "bad"); assert.match(a.calls.toasts.at(-1).message, /task store is busy/);
});

test("Delete asks first, goes through the board's own delete and offers Undo from Recently deleted; saying no deletes nothing", async () => {
  const a = await open();
  await a.settle();
  a.window.__confirmWith = false;
  await (await openMenu(a, "queued-old")).at(-1).click(); await a.settle();
  assert.equal(a.calls.confirms.length, 1); assert.match(a.calls.confirms[0][0], /Delete “Task queued-old”\? It stays in Recently deleted for 30 days\./); assert.deepEqual(clean(a.calls.confirms[0][1]), { label: "Delete" });
  assert.equal(a.api.of("tasksDelete").length, 0, "declined: nothing was deleted");
  a.window.__confirmWith = true;
  a.S.select("queued-old", { route: false }); await a.settle();
  await (await openMenu(a, "queued-old")).at(-1).click(); await a.settle();
  assert.deepEqual(clean(a.api.of("tasksDelete")), [["tasksDelete", { taskId: "queued-old", projectId: "p1" }]]);
  assert.equal(a.S.selected(), null, "deleting the session that is open closes it");
  const undo = a.calls.toasts.at(-1);
  assert.match(undo.message, /Deleted “Task queued-old”/); assert.equal(undo.options.action.label, "Undo"); assert.equal(undo.options.duration, 8000);
  await undo.options.action.run(); await a.settle();
  assert.deepEqual(clean(a.api.of("tasksUndelete")), [["tasksUndelete", { taskId: "queued-old", projectId: "p1" }]], "Undo brings it back from Recently deleted");
  assert.match(a.calls.toasts.at(-1).message, /Put back “Task queued-old”/);
  a.api.state.fail.tasksDelete = "Could not write the task store.";
  await (await openMenu(a, "queued")).at(-1).click(); await a.settle();
  assert.equal(a.calls.toasts.at(-1).kind, "bad"); assert.match(a.calls.toasts.at(-1).message, /Task not deleted/);
});

test("Stop in a run's menu is the thread's own two-press action: it asks the host to stop that run", async () => {
  const a = await open();
  await a.settle();
  const items = await openMenu(a, "working");
  await items.find((node) => node.textContent.trim() === "Stop this task").click(); await a.settle();
  assert.deepEqual(clean(a.api.of("tasksAction")), [["tasksAction", { taskId: "working", projectId: "p1", action: "stop" }]]);
  assert.match(a.calls.toasts.at(-1).message, /Stopped/);
});

// ---- the list's keys ----------------------------------------------------------------------------------------------------------------------

const key = async (a, node, name, extra = {}) => { await node.trigger("keydown", { key: name, ...extra }); await a.settle(); };
const main = (a, id) => a.row(id).querySelector('[data-part="main"]');

test("the keys: arrows move between rows and headings past each row's menu, Home and End go to the ends, Left and Right reach the menu, Enter opens", async () => {
  const a = await open();
  await a.settle();
  const focus = [];
  for (const node of a.all("list", "[data-nav]")) { const original = node.focus; node.focus = function (...args) { focus.push(`${this.closest("[data-key]")?.dataset.key}|${this.dataset.part || this.dataset.nav}`); return original.apply(this, args); }; }
  await key(a, main(a, "asking"), "ArrowDown");
  assert.equal(focus.at(-1), "blocked|main", "Down goes to the next row");
  await key(a, main(a, "blocked"), "ArrowDown");
  assert.equal(focus.at(-1), "group:running|group", "and on to the next group's heading");
  await key(a, main(a, "blocked"), "ArrowUp");
  assert.equal(focus.at(-1), "asking|main");
  await key(a, main(a, "asking"), "ArrowRight");
  assert.equal(focus.at(-1), "asking|menu", "Right reaches the row's menu button");
  await key(a, a.row("asking").querySelector('[data-part="menu"]'), "ArrowLeft");
  assert.equal(focus.at(-1), "asking|main");
  await key(a, main(a, "asking"), "End");
  assert.equal(focus.at(-1), "finished-old|main", "End goes to the last row, not its menu");
  await key(a, main(a, "asking"), "Home");
  assert.equal(focus.at(-1), "group:needs|group", "Home goes to the first heading");
  // Left and Right on a heading fold and unfold its group.
  const needs = a.all("list", ".sx-gh")[0];
  await key(a, needs, "ArrowLeft");
  assert.equal(a.all("list", ".sx-gh")[0].getAttribute("aria-expanded"), "false", "Left folds");
  await key(a, a.all("list", ".sx-gh")[0], "ArrowRight");
  assert.equal(a.all("list", ".sx-gh")[0].getAttribute("aria-expanded"), "true", "Right opens");
  // Exactly one stop in the tab order.
  assert.equal(a.all("list", "[data-nav]").filter((node) => node.tabIndex === 0).length, 1, "the list is one tab stop");
});

test("Delete removes the row with focus (after its confirm), F2 renames it and the menu key opens its menu", async () => {
  const a = await open();
  await a.settle();
  await key(a, main(a, "queued"), "F2");
  assert.ok(a.one("list", ".sx-rename"), "F2 renames");
  await a.one("list", ".sx-rename").trigger("keydown", { key: "Escape" }); await a.settle();
  await key(a, main(a, "queued"), "ContextMenu");
  assert.ok(a.one("list", ".sx-menu"), "the menu key opens the row's menu");
  await key(a, main(a, "queued"), "Escape");
  assert.equal(a.one("list", ".sx-menu"), null);
  await key(a, main(a, "queued"), "F10", { shiftKey: true });
  assert.ok(a.one("list", ".sx-menu"), "Shift F10 too");
  await key(a, main(a, "queued"), "Escape");
  await key(a, main(a, "queued"), "Delete");
  assert.equal(a.calls.confirms.length, 1, "Delete asks first");
  assert.equal(a.api.of("tasksDelete").length, 1);
  // Typing in the filter box or the rename box is not a list key.
  const input = a.one("list", "#sessions-find");
  await key(a, input, "Delete");
  assert.equal(a.calls.confirms.length, 1, "a key typed in the filter box stays there");
});

// ---- the panels come and go -------------------------------------------------------------------------------------------------------------

test("with the layout off (v1) nothing is drawn, nothing listens, nothing is stored and the host is never asked", async () => {
  const a = await open({ layout: "v1" });
  await a.settle();
  assert.equal(a.mounts.length, 0, "no panel was given to the shell");
  assert.equal(a.S.active(), false);
  assert.equal(a.S.attach(), false, "attach does nothing while the layout is off");
  assert.equal(a.env.frames.length + a.env.timeouts.length + a.env.intervals.length, 0, "no frame, timer or interval");
  for (const type of ["mefi:workspace-state", "mefi:nav", "mefi:project-changed", "mefi:layout", "mefi:shell-layout", "keydown", "resize", "mefi:worktrees", "visibilitychange"]) assert.equal(a.env.listeners(type), 0, `no ${type} listener`);
  assert.equal(a.storage.size, 0, "nothing stored");
  assert.deepEqual(a.api.calls, [], "the host was not asked for anything");
  assert.equal(a.S.redirect("tasks", { taskId: "working" }), null, "a link is left alone");
  assert.equal(a.document.getElementById("workspace-layer").hasAttribute("inert"), false);
  assert.deepEqual(Object.keys(a.api.state.pushes).map((name) => a.api.state.pushes[name].length), [0, 0, 0, 0, 0], "and no push channel was subscribed to");
});

test("a page with no shell draws nothing, waits for one and draws as soon as it says its regions moved or a moment later", async () => {
  const a = await open({ shell: false });
  await a.settle();
  assert.equal(a.S.active(), false); assert.equal(a.mounts.length, 0);
  assert.equal(a.env.listeners("mefi:shell-layout"), 1, "it waits for the shell to say something");
  assert.equal(a.env.intervals.length, 1, "and looks again now and then");
  a.window.MefiShell = a.shell;
  a.env.emit("mefi:shell-layout", { region: "list" }); await a.settle();
  assert.equal(a.S.active(), true); assert.deepEqual(a.mounts.map((entry) => entry.region), ["list", "main", "inspector"]);
  assert.equal(a.env.listeners("mefi:shell-layout") >= 1, true);
  // The same, by the timer, for a shell that never announces.
  const b = await open({ shell: false });
  b.window.MefiShell = b.shell;
  b.env.intervals[0].callback(); await b.settle();
  assert.equal(b.S.active(), true, "the interval's look draws the panels");
  // A shell that has nothing to mount into yet: no handle and no parent, so nothing is wired, and a later look tries again.
  const c = await open({ shell: false });
  const refusing = { active: () => true, mount: () => null, size: () => 0 };
  c.window.MefiShell = refusing;
  c.env.emit("mefi:layout", {}); await c.settle();
  assert.equal(c.S.active(), false, "a shell that cannot take a panel leaves it undrawn");
  c.window.MefiShell = c.shell;
  c.env.emit("mefi:layout", {}); await c.settle();
  assert.equal(c.S.active(), true);
  // A shell that says it is not active is not used.
  const d = await open({ shell: false });
  d.window.MefiShell = { ...d.shell, active: () => false };
  d.env.emit("mefi:layout", {}); await d.settle();
  assert.equal(d.S.active(), false);
});

test("turning the layout on later is one call, and attaching twice draws once; a mount that makes the shell announce does not attach again", async () => {
  const a = await open({ layout: "v1" });
  assert.equal(a.S.attach(), false);
  a.document.documentElement.dataset.layout = "v2";
  assert.equal(a.S.attach(), true); assert.equal(a.S.attach(), true);
  assert.equal(a.mounts.length, 3, "one panel for each region, once");
  // A shell that announces from inside mount (the real one tells its listeners when a region opens).
  const b = await open({ shell: false });
  const mounts = [];
  // The shell stops announcing after forty mounts, so a panel set that attaches over and over fails here instead of hanging the run.
  b.window.MefiShell = { active: () => true, size: () => 0, mount: (region, key, element) => { mounts.push(region); if (mounts.length < 40) b.env.emit("mefi:shell-layout", { region }); return { show() {}, hide() {}, unmount() {} }; } };
  b.env.emit("mefi:shell-layout", {}); await b.settle();
  assert.deepEqual(mounts, ["list", "main", "inspector"], "no recursion, no second set of panels");
});

test("the kill switch: ?sessions=off or a saved off leaves the panels out, ?sessions=on wins for one launch, and setEnabled turns them away and back", async () => {
  for (const [search, stored, expected] of [["?sessions=off", null, false], ["", "off", false], ["?sessions=on", "off", true], ["", "on", true], ["", null, true], ["?sessions=off", "on", false]]) {
    const storage = new Map(stored ? [["mefiStudio.sessions", stored]] : []);
    const a = await open({ search, storage });
    await a.settle();
    assert.equal(a.S.enabled(), expected, `${search || "no query"} with ${stored ?? "nothing"} saved`);
    assert.equal(a.S.active(), expected);
    assert.equal(a.mounts.length, expected ? 3 : 0);
  }
  const a = await open();
  await a.settle();
  assert.equal(a.S.setEnabled(false), false);
  assert.equal(a.S.active(), false); assert.ok(a.mounts.every((entry) => entry.unmounted), "every panel was taken back from the shell");
  assert.equal(a.storage.get("mefiStudio.sessions"), "off", "and it stays off");
  assert.equal(a.S.attach(), false); assert.equal(a.S.select("working"), false, "nothing answers while it is off");
  assert.equal(a.S.setEnabled(true), true);
  assert.equal(a.S.active(), true); assert.equal(a.storage.get("mefiStudio.sessions"), "on");
});

test("putting the panels away removes everything: the shell's handles, the listeners, the interval, the lightbox and the cover on Home", async () => {
  const a = await open();
  await a.settle();
  a.S.select("working", { route: false }); await a.settle();
  assert.equal(a.document.getElementById("workspace-layer").hasAttribute("inert"), true, "Home is covered while a session shows");
  assert.equal(a.env.listeners("mefi:workspace-state"), 1); assert.equal(a.env.intervals.length, 1); assert.deepEqual(a.env.cleared, [], "the clock that keeps 'waiting 4m' honest is running");
  a.S.detach(); await a.settle();
  assert.deepEqual(a.env.cleared, [1], "and it is stopped, that very one");
  assert.ok(a.mounts.every((entry) => entry.unmounted));
  for (const type of ["mefi:workspace-state", "mefi:nav", "mefi:project-changed", "mefi:layout", "mefi:shell-layout", "keydown", "resize", "mefi:worktrees", "mefi:appearance", "mefi:autonomy-changed"]) assert.equal(a.env.listeners(type), 0, `${type} is no longer listened to`);
  assert.equal(a.document.getElementById("workspace-layer").hasAttribute("inert"), false, "Home is uncovered");
  assert.equal(a.S.active(), false); assert.equal(a.S.selected(), null);
  const frames = a.env.frames.length;
  a.env.emit("mefi:workspace-state"); await a.settle();
  assert.equal(a.mounts.length, 3, "a push after that draws nothing");
  void frames; void NOW; void bridge;
});

test("while the frame's page list covers the column (another section's page), the list is not drawn; it is drawn, current, once it is uncovered", async () => {
  const a = await open();
  await a.settle();
  let covered = true;
  a.shell.pages = () => ({ shown: covered, section: covered ? "work" : null });
  a.navigate("tasks", {}); await a.settle();
  const before = a.rowKeys();
  a.data.tasks = [task("fresh", { updatedAt: mins(1) }), ...a.data.tasks];
  a.env.emit("mefi:workspace-state"); await a.settle();
  assert.deepEqual(a.rowKeys(), before, "nothing is drawn under the page list");
  assert.equal(a.mounts.find((entry) => entry.region === "list").shown, true, "the panel stays the shell's to show: only its drawing waits");
  covered = false;
  a.navigate("workspace", {}); a.env.emit("mefi:shell-layout", { what: "pages", shown: false }); await a.settle();
  assert.ok(a.rowKeys().includes("fresh"), "back on Home the list is the board as it is now");
});

test("the thread is shown only while a session is open and Home is the page; the list and the inspector follow; Home is covered only while the thread is", async () => {
  const a = await open();
  await a.settle();
  const shell = (region) => a.mounts.find((entry) => entry.region === region);
  assert.equal(shell("list").shown, true, "the list is always there");
  assert.equal(shell("main").shown, false, "no session, no thread: Home shows");
  assert.equal(shell("inspector").shown, true, "and the project's inspector");
  a.S.select("working", { route: false }); await a.settle();
  assert.equal(shell("main").shown, true); assert.equal(shell("inspector").shown, true);
  assert.equal(a.document.getElementById("workspace-layer").hasAttribute("inert"), true);
  a.navigate("settings", {}); await a.settle();
  assert.equal(shell("main").shown, false, "on another page the thread is not");
  assert.equal(shell("inspector").shown, false);
  assert.equal(a.document.getElementById("workspace-layer").hasAttribute("inert"), false);
  assert.equal(a.reviews.live().length, 0, "and nothing of the session's is read while it is out of sight");
  a.navigate("workspace", { view: "task", taskId: "working", projectId: "p1" }); await a.settle();
  assert.equal(shell("main").shown, true);
  assert.equal(a.reviews.live().length >= 1, true, "it is read again when it is back");
});
