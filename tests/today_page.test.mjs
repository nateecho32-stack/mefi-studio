// Today, the page (renderer/today.js): Vibe's Home in layout v2, drawn from the picture renderer/vibe.js
// already keeps. It borrows the front door's own pieces (the greeting, the box that builds or talks, the
// starting points) and puts them back; it shows one line per session in four groups whose detail follows
// html[data-detail]; it answers a need in place; it opens a session through the tab strip or the route;
// and with layout v2 off it touches nothing. The Build host (the Today page a pinned tab opens) draws the
// same board. The real window (sizes, scrollbars, the backdrop, text size) is tests/today_render.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";

import { NOW, board, finished, job, loadToday, needApproval, needBlocked, needPlan, needQuestion, needReview, plain } from "./fixtures/today-env.mjs";

const everything = (over = {}) => board({
  needs: [needQuestion(), needApproval(), needBlocked(), needReview(), needPlan()],
  running: [job()],
  checking: [{ id: "t8", title: "Polish the onboarding copy" }],
  next: [{ id: "t9", title: "Translate the help page", stage: "queued" }],
  tasks: [finished(), finished({ id: "t21", title: "Tidy the footer links", doneAt: NOW - 7200000, verification: { state: "verified", reason: "The page loads and the links work." } })],
  messages: [{ id: "m1", kind: "notice", text: "Finished the typo fix and checked it.", at: NOW - 10 * 60000 }],
  ...over,
});
// The ids the script creates itself (today-page, today-board ...) are found through the document, as the script finds them.
const byId = (t, id) => t.document.getElementById(id);
const group = (t, key, root = "today-board") => byId(t, root).querySelector(`[data-group="${key}"]`);
const cardsOf = (t, key, root) => (group(t, key, root)?.querySelectorAll(".today-card, .today-need") ?? []);
const keysOf = (t, key, root) => cardsOf(t, key, root).map((card) => card.dataset.key);
const chips = (t, root = "today-summary") => byId(t, root).children.filter((chip) => !chip.hidden).map((chip) => chip.textContent);
const up = async (over = {}) => {
  const t = await loadToday({ layer: true, active: true, data: everything(), ...over });
  await t.settle();
  return t;
};

test("Vibe's front door borrows its pieces into Today, and stop() puts every one back where it was", async () => {
  const t = await loadToday({ layer: true, active: true, data: everything() });
  const before = { layer: t.front.order(t.front.layer), top: t.front.order(t.front.top), stage: t.front.order(t.front.stage) };
  const home = (byId(t, "vibe-compose").parentNode === t.front.stage);
  assert.equal(home, false, "already borrowed: the box is not in the stage any more");
  t.today.stop();
  await t.settle();
  // A fresh load of the same markup, to know what "where it was" is.
  const plainLoad = await loadToday({ layer: true, data: everything() });
  assert.deepEqual({ layer: t.front.order(t.front.layer), top: t.front.order(t.front.top), stage: t.front.order(t.front.stage) }, { layer: plainLoad.front.order(plainLoad.front.layer), top: plainLoad.front.order(plainLoad.front.top), stage: plainLoad.front.order(plainLoad.front.stage) }, "the front door is exactly as v1 draws it");
  assert.equal(byId(t, "vibe-layer").dataset.today, undefined, "and is no longer marked");
  assert.equal(byId(t, "today-page"), null, "the page is gone");
  assert.notDeepEqual(before.stage, t.front.order(t.front.stage), "(it had been different while Today was up)");
});

test("Today is drawn inside Vibe's own layer, after its sky, with the pieces in the order of the page", async () => {
  const t = await up();
  const layer = byId(t, "vibe-layer");
  assert.equal(layer.dataset.today, "on", "CSS steps the old stage and dock aside from this (the top bar stays: the project, New app, the conversation, Settings)");
  const page = byId(t, "today-page");
  assert.equal(page.parentNode, layer);
  assert.equal(page.getAttribute("aria-label"), "Today");
  assert.deepEqual(layer.children.map((child) => child.id || child.className.split(" ")[0]), ["vibe-sky", "vibe-top", "today-page", "vibe-stage", "vibe-dock"], "under the top bar that stays (so Tab reads the page top to bottom), over the backdrop's sky, so the node tree stays behind it");
  assert.equal(page.querySelector("#today-scroll").tabIndex, -1, "the scroller is not a tab stop of its own");
  assert.equal(page.querySelector(".today-head"), null, "no second top bar: Vibe's own keeps the project, New app and the conversation toggle");
  assert.deepEqual(t.front.order(t.front.top), ["vibe-top-left", "mode-switch", "vibe-top-actions"], "and is left exactly as it was");
  assert.equal(byId(t, "vibe-chat-toggle").parentNode.className.includes("vibe-top-actions"), true);
  assert.deepEqual(page.querySelector(".today-top").children.map((child) => child.id || child.className.split(" ")[0]), ["vibe-hero", "today-summary", "vibe-decisions"], "the greeting, the chips beside it, and what Mefi decided for you as one more count");
  assert.deepEqual(page.querySelector(".today-box").children.map((child) => child.id || child.className.split(" ")[0]).filter((id) => id.startsWith("vibe-")), ["vibe-compose", "vibe-hint", "vibe-flow", "vibe-feedback", "vibe-sparks", "vibe-gate", "vibe-last"], "the box that builds or talks, the line of keys (kept for the front door; today.css leaves it out, the buttons carry the keys), its wait, its answer, the starting points, what holds the agents back");
  assert.equal(byId(t, "vibe-build").querySelector(".today-key").textContent, "Ctrl Enter", "Build it carries its key, as the prototype's");
  assert.equal(byId(t, "vibe-build").getAttribute("aria-keyshortcuts"), "Control+Enter");
  assert.equal(byId(t, "vibe-talk").querySelector(".today-key").textContent, "Enter", "and Talk it over carries its own, so no line of keys is needed under the box");
  assert.equal(byId(t, "vibe-talk").getAttribute("aria-keyshortcuts"), "Enter");
  // The box is still Vibe's own element: Build it, Suggest a next step and the drafts keep working through vibe.js.
  assert.equal(byId(t, "vibe-compose").parentNode, page.querySelector(".today-box"));
  // The layer that is left behind holds what v1 had in it, minus what moved.
  assert.deepEqual(t.front.order(t.front.stage), ["vibe-lanes", "vibe-quiet"], "only v1's own lanes and quiet line stay behind (CSS hides them: Today draws its own)");
});

test("hide() keeps the page for next time, show() does not build a second one, and v1's front door is back on stop()", async () => {
  const t = await up();
  t.today.hide();
  assert.equal(t.today.snapshot().host, null);
  assert.equal(t.timers.filter((timer) => timer.every && !timer.cancelled).length, 0, "nothing ticks while the front door is away");
  t.today.show(); await t.settle();
  assert.equal(t.today.snapshot().host, "vibe");
  assert.equal(byId(t, "vibe-layer").children.filter((child) => child.id === "today-page").length, 1);
  assert.equal(byId(t, "vibe-compose").parentNode.className.includes("today-box"), true);
  t.today.stop();
  assert.equal(byId(t, "vibe-compose").parentNode, t.front.stage);
  assert.equal(byId(t, "vibe-chat-toggle").parentNode.className.includes("vibe-top-actions"), true, "the conversation toggle never left the top bar");
  assert.equal(byId(t, "vibe-project").parentNode.className.includes("vibe-top-left"), true);
});

test("the summary says what is going on, and its need chip is the popover's anchor, the same node from one push to the next", async () => {
  const t = await up();
  assert.deepEqual(chips(t), ["4 need you", "1 running", "3 to review"], "the digest's count (plans are not in it), what is live, what is under Review (a result, what is being checked, a plan)");
  const need = byId(t, "today-summary").querySelector('[data-chip="need"]');
  assert.equal(need.tagName, "button");
  assert.equal(need.getAttribute("aria-haspopup"), "dialog");
  assert.equal(need.dataset.act, "inbox");
  await need.click(); await t.settle();
  assert.equal(t.inbox().hidden, false, "it opens the Inbox");
  assert.equal(t.today.snapshot().inbox, true);
  assert.equal(need.getAttribute("aria-expanded"), "true", "and is the pill that popover hangs from");
  t.today.closeInbox();
  await t.push(everything({ needs: [needQuestion()] }));
  assert.equal(byId(t, "today-summary").querySelector('[data-chip="need"]'), need, "a push that changes the number keeps the chip");
  assert.deepEqual(chips(t), ["1 needs you", "1 running", "1 to review"], "a single one reads as one");
  await t.push(board({ needs: [], running: [], tasks: [] }));
  assert.deepEqual(chips(t), ["All clear"], "nothing waits, nothing runs: one calm chip");
});

test("four groups, one line each, in their order: Needs you, Running, Review, Done", async () => {
  const t = await up();
  const shown = byId(t, "today-board").querySelector(".today-groups").children.map((node) => node.dataset.group);
  assert.deepEqual(shown, ["needs", "running", "review", "done"]);
  assert.deepEqual(byId(t, "today-board").querySelector(".today-groups").children.map((node) => node.getAttribute("aria-label")), ["Needs you", "Running", "Review", "Done"], "the prototype's four columns (Done holds what finished today)");
  assert.deepEqual(keysOf(t, "needs"), ["need:question:q1", "need:approval:t5", "need:blocked:t6"]);
  assert.deepEqual(keysOf(t, "running"), ["run:t3", "next:t9"]);
  assert.deepEqual(keysOf(t, "review"), ["need:review:t7", "check:t8", "plan:pl1"], "a result ready to review first, then what is being checked, then the plan");
  assert.deepEqual(keysOf(t, "done"), ["done:t20", "done:t21"]);
  assert.deepEqual(group(t, "needs").querySelectorAll("h3 .today-count").map((node) => node.textContent), ["3"], "each group says how many");
  assert.deepEqual(group(t, "done").querySelectorAll("h3 .today-count").map((node) => node.textContent), ["2"]);
  assert.equal(group(t, "done").querySelector(".today-more"), null, "no 'more' while everything fits");
  // The feed is what the assistant already noticed.
  const latest = byId(t, "today-board").querySelector(".today-latest");
  assert.equal(latest.hidden, false);
  assert.deepEqual(latest.querySelectorAll(".today-latest-row").map((row) => row.textContent), ["Finished the typo fix and checked it.10 min ago"]);
});

test("all four columns show while a project is open, each saying when it is empty, as the prototype's board; no project says what to do", async () => {
  const t = await up({ data: board({ running: [job()] }) });
  const columns = () => byId(t, "today-board").querySelector(".today-groups").children;
  const empty = () => Object.fromEntries(columns().map((node) => [node.dataset.group, node.querySelector(".today-col-empty").hidden ? null : node.querySelector(".today-col-empty").textContent]));
  assert.deepEqual(columns().map((node) => node.dataset.group), ["needs", "running", "review", "done"]);
  assert.deepEqual(empty(), { needs: "Nothing is waiting on you.", running: null, review: "Nothing to review.", done: "Nothing finished yet today." });
  assert.equal(byId(t, "today-quiet").hidden, true, "the columns say it; no second line");
  const before = columns();
  await t.push(board());
  assert.deepEqual(columns().map((node, index) => node === before[index]), [true, true, true, true], "the columns stay put");
  assert.deepEqual(empty(), { needs: "Nothing is waiting on you.", running: "Nothing is running.", review: "Nothing to review.", done: "Nothing finished yet today." });
  assert.equal(byId(t, "today-quiet").hidden, true);
  assert.equal(byId(t, "today-quiet").getAttribute("role"), "status");
  await t.push(board({ projectId: null, projectName: "" }));
  assert.equal(columns().length, 0, "no project, no columns");
  assert.match(byId(t, "today-quiet").textContent, /^Pick a project to begin/, "no project is its own empty state");
  assert.equal(byId(t, "today-quiet").hidden, false);
});

test("detail follows html[data-detail]: titles only, plus status, or everything", async () => {
  const t = await up({ detail: "titles" });
  const running = () => cardsOf(t, "running")[0];
  const question = () => cardsOf(t, "needs")[0];
  assert.equal(running().querySelector(".today-card-meta"), null, "titles: a title and nothing else");
  assert.equal(running().querySelector(".today-bar"), null);
  assert.equal(question().querySelector(".today-card-quick"), null, "and no answer buttons: open it to decide");
  assert.equal(byId(t, "today-board").querySelector(".today-latest").hidden, true, "the feed is a status, not a title");
  // + status (the default)
  t.documentElement.dataset.detail = "status";
  t.window.dispatchEvent({ type: "mefi:appearance" }); await t.settle();
  assert.equal(running().querySelector(".today-card-meta").textContent, "2 min · building");
  assert.equal(running().querySelector(".today-bar i").style.width, "40%", "a bar for a job that reports its progress");
  assert.deepEqual(question().querySelectorAll(".today-card-quick [data-option]").map((node) => node.dataset.option), ["yes", "no"], "the first two options that are an answer by themselves");
  assert.equal(question().querySelector(".today-card-more"), null);
  assert.equal(byId(t, "today-board").querySelector(".today-latest").hidden, false);
  // everything
  t.documentElement.dataset.detail = "all";
  t.window.dispatchEvent({ type: "mefi:appearance" }); await t.settle();
  assert.equal(cardsOf(t, "done")[1].querySelectorAll(".today-card-more").map((node) => node.textContent).join(), "The page loads and the links work.", "what the checker said");
  // Unknown values are the default, never a blank board.
  t.documentElement.dataset.detail = "everything-and-more";
  t.window.dispatchEvent({ type: "mefi:appearance" }); await t.settle();
  assert.ok(running().querySelector(".today-card-meta"));
});

test("a card opens its session: in its thread when the session panels are there, else through the route", async () => {
  const sessions = [];
  const t = await up({ extras: { MefiSessions: { active: () => true, open: (...args) => { sessions.push(plain(args)); return true; } } } });
  await cardsOf(t, "running")[0].querySelector(".today-card-open").click();
  assert.deepEqual(sessions, [["t3", { preview: true }]]);
  assert.deepEqual(t.nav.gone, []);
  const u = await up();
  await cardsOf(u, "running")[0].querySelector(".today-card-open").click();
  assert.deepEqual(u.nav.gone, [["tasks", { taskId: "t3", projectId: "p1", filter: "all" }]]);
  await cardsOf(u, "done")[0].querySelector(".today-card-open").click();
  assert.deepEqual(u.nav.gone.at(-1), ["tasks", { taskId: "t20", projectId: "p1", filter: "all" }]);
  // A plan opens the plans page; a card for something with no task is not a button that does nothing.
  await cardsOf(u, "review").find((card) => card.dataset.key === "plan:pl1").querySelector(".today-card-open").click();
  assert.deepEqual(u.nav.gone.at(-1), ["plans", { planId: "pl1" }]);
  const lone = await up({ data: board({ running: [{ title: "Something without a task", phase: "working" }] }) });
  assert.equal(cardsOf(lone, "running")[0].querySelector(".today-card-open").disabled, true);
});

test("a need answers in place with its first two options, or opens the Inbox on it", async () => {
  const t = await up();
  const card = cardsOf(t, "needs")[0];
  await card.querySelector('[data-option="yes"]').click(); await t.settle();
  assert.deepEqual(t.callsOf("assistantAnswer"), [{ id: "q1", optionId: "yes", projectId: "p1" }], "one host call, the same one the Inbox makes");
  const decided = cardsOf(t, "needs")[0];
  assert.equal(decided.className.includes("is-decided"), true, "the card becomes its Decided line, in the same place");
  assert.match(decided.textContent, /^Decided · Answered: Yes, ignore case/);
  assert.equal(byId(t, "today-summary").querySelector('[data-chip="need"]').querySelector(".today-chip-text").textContent, "3 need you", "and the count moved at once");
  assert.deepEqual(group(t, "needs").querySelectorAll("h3 .today-count").map((node) => node.textContent), ["2"]);
  // A thing with no options of its own offers the app's first two actions for it, as the prototype's card offers its answers; More opens the Inbox on it.
  const approval = cardsOf(t, "needs").find((node) => node.dataset.key === "need:approval:t5");
  assert.deepEqual(approval.querySelectorAll(".today-card-quick button").map((node) => node.textContent), ["Approve build", "Drop it", "More"]);
  assert.equal(approval.querySelector(".today-card-q").textContent, "Your permission settings require approval of this brief before it can start.", "what holds it, in the card's own box");
  await approval.querySelector('[data-action="approve"]').click(); await t.settle();
  assert.deepEqual(t.callsOf("backlogControl"), [{ action: "approve", taskId: "t5", projectId: "p1", expectedScope: "scope-5" }], "the same call the Inbox makes");
  const blocked = cardsOf(t, "needs").find((node) => node.dataset.key === "need:blocked:t6");
  assert.deepEqual(blocked.querySelectorAll(".today-card-quick button").map((node) => node.textContent), ["Try again", "It's done", "More"]);
  assert.equal(blocked.querySelector(".today-card-open").textContent, "Fix the login redirect loop");
  assert.equal(blocked.querySelector(".today-card-meta").textContent, "Same failure repeating · 6 min");
  await blocked.querySelectorAll(".today-card-quick button").at(-1).click(); await t.settle();
  assert.equal(t.inbox().hidden, false);
  assert.equal(t.inbox().querySelector(".is-current").dataset.key, "blocked:t6");
});

test("a card that waits on you is its session, as the prototype's board: the task, what it asks and how long, the question in its own box", async () => {
  const t = await up();
  const card = cardsOf(t, "needs")[0];
  assert.equal(card.querySelector(".today-card-open").textContent, "Search notes by tag", "the task it comes from is the title");
  assert.equal(card.querySelector(".today-card-meta").textContent, "Asking a question · 4 min");
  assert.equal(card.querySelector(".today-card-q").textContent, "Should #Work and #work count as the same tag?");
  assert.deepEqual(card.querySelectorAll(".today-card-quick button").map((node) => [node.textContent, node.className.includes("primary")]), [["Yes, ignore case", true], ["Keep them separate", false], ["More", false]], "the first answer is the filled one");
  // titles: the title alone.
  t.documentElement.dataset.detail = "titles"; t.window.dispatchEvent({ type: "mefi:appearance" }); await t.settle();
  assert.equal(cardsOf(t, "needs")[0].querySelector(".today-card-q"), null);
});

test("a result to review is a card under Review that opens on what it changed; one still being checked opens its session", async () => {
  const sessions = [];
  const t = await up({ extras: { MefiSessions: { active: () => true, open: (...args) => { sessions.push(plain(args)); return true; } } }, data: everything({ needs: [needReview(), needReview({ id: "t11", title: "Still being checked", checking: true })] }) });
  const [ready, checking] = cardsOf(t, "review");
  assert.equal(ready.dataset.key, "need:review:t7");
  assert.equal(ready.querySelector(".today-card-meta").textContent, "Ready to review · 6 min");
  assert.equal(ready.querySelector(".today-card-quick"), null, "Review's cards are lines to open, as the prototype's");
  await ready.querySelector(".today-card-open").click();
  assert.equal(checking.querySelector(".today-card-meta").textContent, "Checking its work · 6 min");
  await checking.querySelector(".today-card-open").click();
  assert.deepEqual(sessions, [["t7", { preview: true, tab: "changes" }], ["t11", { preview: true }]]);
  assert.deepEqual(group(t, "review").querySelectorAll("h3 .today-count").map((node) => node.textContent), ["3"], "the two results and the one being checked");
});

test("the quick answers are the first two options that answer by themselves; More opens the Inbox on the card", async () => {
  const many = needQuestion({ options: [{ id: "later", label: "Leave it", dismiss: true }, { id: "say", label: "Say it in words", text: true }, { id: "a", label: "First way" }, { id: "b", label: "Second way", recommended: true }, { id: "c", label: "Third way" }] });
  const t = await up({ data: board({ needs: [needApproval(), many] }) });
  const card = cardsOf(t, "needs")[1];
  assert.deepEqual(card.querySelectorAll(".today-card-quick [data-option]").map((node) => node.dataset.option), ["b", "a"], "two, the recommended one first; not the one that asks for words, not the one that leaves it");
  assert.equal(card.querySelector('[data-option="b"]').className.includes("primary"), true);
  const more = card.querySelectorAll(".today-card-quick button").find((node) => node.textContent === "More");
  await more.click(); await t.settle();
  assert.equal(t.inbox().hidden, false);
  assert.equal(t.inbox().querySelector(".is-current").dataset.key, "question:q1");
  assert.deepEqual(t.callsOf("assistantAnswer"), [], "looking is not answering");
});

test("a card that did not change is the same node after a push, so what is under the hand stays under the hand", async () => {
  const t = await up();
  const before = Object.fromEntries(["needs", "running", "review", "done"].map((key) => [key, cardsOf(t, key)]));
  const groups = byId(t, "today-board").querySelector(".today-groups").children;
  await t.push(everything());
  for (const key of Object.keys(before)) assert.deepEqual(cardsOf(t, key).map((card, index) => card === before[key][index]), before[key].map(() => true), `${key}: nothing rebuilt`);
  assert.deepEqual(byId(t, "today-board").querySelector(".today-groups").children.map((node, index) => node === groups[index]), [true, true, true, true]);
  // One job's progress moves: only its card is rebuilt.
  await t.push(everything({ running: [job({ progress: 0.7 })] }));
  assert.notEqual(cardsOf(t, "running")[0], before.running[0]);
  assert.equal(cardsOf(t, "running")[1], before.running[1], "the one next to it is the one it was");
  assert.equal(cardsOf(t, "needs")[1], before.needs[1]);
});

test("more than six finished today show six and a link to the rest", async () => {
  const many = Array.from({ length: 9 }, (_, index) => finished({ id: `d${index}`, title: `Done thing ${index}`, doneAt: NOW - (index + 1) * 600000 }));
  const t = await up({ data: board({ tasks: many }) });
  assert.equal(cardsOf(t, "done").length, 6);
  const more = group(t, "done").querySelector(".today-more");
  assert.equal(more.hidden, false);
  assert.equal(more.textContent, "3 more");
  await more.click();
  assert.deepEqual(t.nav.gone.at(-1), ["tasks", { filter: "done" }]);
});

test("Mefi's clock: one slow timer while Today shows, which keeps 'min' honest, and none once it is away", async () => {
  const t = await up();
  const ticking = () => t.timers.filter((timer) => timer.every && !timer.cancelled);
  assert.equal(ticking().length, 1);
  assert.equal(ticking()[0].ms, 30000, "thirty seconds, not a poll");
  assert.match(cardsOf(t, "needs")[0].textContent, /4 min/);
  t.clock.now += 5 * 60000;
  await t.fire("all");
  assert.match(cardsOf(t, "needs")[0].textContent, /9 min/);
  t.today.hide();
  assert.equal(ticking().length, 0, "hidden: stopped");
  const count = t.timers.length;
  await t.push(everything({ needs: [needQuestion()] }));
  assert.equal(t.timers.length, count, "and a push while hidden starts none");
});

test("the Build host: the same board as a page a pinned tab or Search opens", async () => {
  const t = await loadToday({ layer: true, mode: "build", data: everything() });
  await t.settle();
  const record = t.nav.registered.find((entry) => entry.id === "today");
  assert.equal(record.kind, "overlay");
  assert.equal(record.element, "today-overlay");
  assert.equal(record.hidden(), false, "in Build it is listed");
  t.window.MefiVibe.mode = () => "vibe";
  assert.equal(record.hidden(), true, "in Vibe the front door is Today: no second entry for the same page");
  assert.equal(byId(t, "vibe-layer").dataset.today, undefined, "and Build's Vibe layer is not touched while Vibe is away");
  assert.equal(record.open({}), true);
  await t.settle();
  assert.deepEqual(t.nav.claimed, ["today"]);
  assert.equal(byId(t, "today-overlay").hidden, false);
  assert.deepEqual(chips(t, "today-overlay-summary"), ["4 need you", "1 running", "3 to review"]);
  assert.deepEqual(keysOf(t, "needs", "today-overlay-board"), ["need:question:q1", "need:approval:t5", "need:blocked:t6"]);
  assert.equal(record.isOpen(), true);
  assert.equal(t.timers.filter((timer) => timer.every && !timer.cancelled).length, 1, "one slow clock, for the page that is showing");
  // The same answer, the same call.
  await cardsOf(t, "needs", "today-overlay-board")[0].querySelector('[data-option="no"]').click(); await t.settle();
  assert.deepEqual(t.callsOf("assistantAnswer"), [{ id: "q1", optionId: "no", projectId: "p1" }]);
  // The need chip opens the popover from the page too.
  await byId(t, "today-overlay-summary").querySelector('[data-chip="need"]').click(); await t.settle();
  assert.equal(t.inbox().hidden, false);
  t.today.closeInbox();
  // Close goes through the nav so the history stays right; closing the page stops the clock.
  await byId(t, "today-close").click();
  assert.deepEqual(t.nav.closed, ["today"]);
  assert.deepEqual(t.nav.released, ["today"], "the nav closed it through the record, which let go of it");
  assert.equal(record.close(), false, "closing what is closed is nothing");
  assert.equal(byId(t, "today-overlay").hidden, true);
  assert.equal(t.timers.filter((timer) => timer.every && !timer.cancelled).length, 0);
  // A project that has nothing yet says so in this host's words.
  await t.push(board({ projectId: null, projectName: "" }));
  record.open({}); await t.settle();
  assert.match(byId(t, "today-overlay-quiet").textContent, /^Pick a project to begin: choose one from the project menu\./);
});

test("the project changing starts Today from nothing: no old decided lines, no old drafts, no old order", async () => {
  const t = await up();
  await cardsOf(t, "needs")[0].querySelector('[data-option="yes"]').click(); await t.settle();
  assert.equal(t.today.count(), 3);
  t.today.openInbox(null); await t.settle();
  t.inbox().querySelector('[data-key="approval:t5"]').querySelectorAll("button").find((node) => node.textContent === "Decide later").click(); await t.settle();
  assert.deepEqual(plain(t.today.snapshot()).later, ["approval:t5"]);
  await t.push(everything({ projectId: "p2", projectName: "Other", needs: [needQuestion()] }));
  t.window.dispatchEvent({ type: "mefi:project-changed", detail: { projectId: "p2" } }); await t.settle();
  assert.equal(t.today.count(), 1, "the other project's question waits on you, whatever was decided here");
  assert.deepEqual(plain(t.today.snapshot()).later, []);
  assert.equal(cardsOf(t, "needs")[0].className.includes("is-decided"), false);
});

test("a host that is away, or has no project, or no bridge: the page still draws, and says so", async () => {
  const t = await up({ data: null });
  assert.match(byId(t, "today-quiet").textContent, /^Pick a project to begin/);
  assert.equal(t.today.count(), 0);
  const bare = await loadToday({ layer: true, active: true, data: everything(), extras: { mefiStudio: {} } });
  await bare.settle();
  await cardsOf(bare, "needs")[0].querySelector('[data-option="yes"]').click(); await bare.settle();
  assert.match(cardsOf(bare, "needs")[0].textContent, /Answers are available in the desktop app\./, "an honest sentence, not a silent nothing");
  assert.equal(bare.today.count(), 4, "and nothing was decided");
});

test("switching back to v1 live gives the front door back at once, and a layout change while v2 stays re-places the popover", async () => {
  const t = await up();
  const pill = t.document.createElement("button");
  let bottom = 42;
  pill.getBoundingClientRect = () => ({ left: 900, right: 1040, top: 10, bottom, width: 140, height: 32 });
  t.today.openInbox(pill); await t.settle();
  assert.equal(t.inbox().style.top, "50px");
  bottom = 82;
  t.window.dispatchEvent({ type: "mefi:layout", detail: { on: true } });
  assert.equal(t.inbox().style.top, "90px", "a region opening moves the free area: the popover follows");
  delete t.documentElement.dataset.layout;
  t.window.dispatchEvent({ type: "mefi:layout", detail: { on: false } });
  await t.settle();
  assert.equal(t.today.isOn(), false);
  assert.equal(byId(t, "today-page"), null, "the page is gone");
  assert.equal(byId(t, "vibe-layer").dataset.today, undefined);
  assert.equal(byId(t, "vibe-compose").parentNode, t.front.stage, "and the box is back where v1 draws it");
  assert.equal(t.inbox(), null, "the popover is gone with it");
  assert.equal(t.timers.filter((timer) => timer.every && !timer.cancelled).length, 0);
  assert.equal(t.vibe.watchers.size, 0, "Vibe is not asked to tell it anything any more");
});

test("v1 is untouched: nothing borrowed, nothing drawn, nothing heard, nothing asked of the host", async () => {
  const t = await loadToday({ layout: null, layer: true, active: true, data: everything() });
  await t.settle();
  assert.equal(t.today.show(), false);
  assert.equal(byId(t, "vibe-layer").dataset.today, undefined);
  assert.equal(byId(t, "today-page"), null);
  assert.deepEqual(t.front.order(t.front.stage), ["vibe-hero", "vibe-compose", "vibe-flow", "vibe-feedback", "vibe-sparks", "vibe-decisions", "vibe-gate", "vibe-lanes", "vibe-quiet", "vibe-last"], "the stage is what the template has");
  assert.deepEqual(t.front.order(t.front.top), ["vibe-top-left", "mode-switch", "vibe-top-actions"]);
  assert.deepEqual(t.events, {}, "no listener on the window");
  assert.equal(t.timers.length, 0);
  assert.deepEqual(t.calls, []);
  assert.equal(t.vibe.watchers.size, 0, "and Vibe is not asked to watch for anyone");
  assert.equal(t.today.count(), 0);
  assert.equal(t.today.openInbox(null), false);
  assert.equal(t.nav.registered.length, 0);
});
