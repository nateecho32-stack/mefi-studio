// Today's picture of the project (renderer/today.js build()): what the Inbox lists,
// the number the top bar's pill shows, and the four groups of the board. It is a
// pure function of what vibe.js holds (MefiVibe.data()), so these suites feed it
// the rows vibe.js builds (tests/fixtures/today-env.mjs) and read what comes out.
//
// The contract: "N need you" is the length of the list the app already keeps
// (assistantState.needsYou), not a second count; a plan waiting on its owner is
// listed under Review but is not in it; what was handled a moment ago is out of
// the count at once; a card carries what the detail level (html[data-detail])
// asks for and no more; and with layout v2 off the script starts nothing at all.
import test from "node:test";
import assert from "node:assert/strict";

import { NOW, board, loadToday, needApproval, needBlocked, needFamily, needPlan, needQuestion, needReview, plain } from "./fixtures/today-env.mjs";

const { MefiToday } = (await loadToday({ layout: null })).window;
const build = (data, options = {}) => plain(MefiToday.build(data, { now: NOW, ...options }));
const task = (over = {}) => ({ id: "t1", projectId: "p1", title: "Search notes by tag", status: "open", ...over });

test("the count is the digest's list, one per entry, and a plan waiting on its owner is not in it", () => {
  const data = board({ needs: [needQuestion(), needApproval(), needBlocked(), needReview(), needFamily(), needPlan()] });
  const picture = build(data);
  assert.equal(picture.count, 5, "five entries in the digest; the plan is not one of them");
  assert.deepEqual(picture.items.map((item) => item.key), ["question:q1", "approval:t5", "blocked:t6", "review:t7", "family:t10"]);
  assert.deepEqual(picture.board.needs.map((card) => card.key), ["need:question:q1", "need:approval:t5", "need:blocked:t6", "need:family:t10"], "Needs you is the Inbox's decisions, as the prototype's column");
  assert.deepEqual(picture.board.review.map((card) => card.key), ["need:review:t7", "plan:pl1"], "a result to review is under Review, as the prototype's board has it (still in the Inbox and the count), and the plan waits there too");
  assert.equal(picture.board.review[0].meta, "Ready to review · 6 min");
  assert.match(picture.board.review[1].meta, /^Plan · its specification waits for your approval$/);
  assert.equal(build(board()).count, 0);
  assert.equal(build(null).count, 0, "no picture at all is nothing waiting");
});

test("every kind says what it is, from which task, and how long it has waited", () => {
  const data = board({
    needs: [
      needQuestion(),
      needQuestion({ id: "q2", title: "builder-3 wants to write outside its task", context: { taskId: "t2", taskTitle: "Fix the sidebar", issueKind: "permission" } }),
      needQuestion({ id: "q3", title: "A check fails on Fix the login redirect loop", context: { taskId: "t3", taskTitle: "Fix the login redirect loop", issueKind: "check-failed" } }),
      needQuestion({ id: "q4", title: "Something only you can do", context: { taskId: "t4", taskTitle: "Sign in to the store", issueKind: "owner" } }),
      needApproval(), needBlocked({ row: { blockedBy: "relevance", reason: "A commit outside Studio added it." } }), needBlocked({ id: "t9", row: { blockedBy: "owner" } }), needReview(), needReview({ id: "t8", checking: true, since: NOW - 50 * 60000 }), needFamily(),
    ],
  });
  const by = Object.fromEntries(build(data).items.map((item) => [item.key, item]));
  assert.deepEqual([by["question:q1"].kind, by["question:q1"].label], ["question", "Question"]);
  assert.deepEqual([by["question:q2"].kind, by["question:q2"].label, by["question:q2"].tone], ["permission", "Permission", "warn"], "a permission is told by its issue");
  assert.deepEqual([by["question:q3"].kind, by["question:q3"].label, by["question:q3"].tone], ["failure", "Checks failed", "bad"]);
  assert.deepEqual([by["question:q4"].kind, by["question:q4"].label], ["question", "Only you can do this"]);
  assert.deepEqual([by["approval:t5"].kind, by["approval:t5"].label], ["approval", "Waiting for your go-ahead"]);
  assert.deepEqual([by["family:t10"].kind, by["family:t10"].label], ["approval", "Steps to approve"]);
  assert.deepEqual([by["blocked:t6"].kind, by["blocked:t6"].label], ["failure", "Maybe done outside Studio"]);
  assert.equal(by["blocked:t9"].label, "Stopped by you");
  // A task parked because its check failed says so, as the prototype's failure card does; one stuck for no reason it was told is Stuck.
  const parked = Object.fromEntries(build(board({ needs: [needBlocked({ id: "t11", row: { reason: "The first-paint budget failed." } }), needBlocked({ id: "t12", row: {} })], tasks: [{ id: "t11", status: "open", verification: { state: "failed" } }, { id: "t12", status: "open" }] })).items.map((item) => [item.key, item.label]));
  assert.deepEqual(parked, { "blocked:t11": "Checks failed", "blocked:t12": "Stuck" });
  assert.deepEqual([by["review:t7"].kind, by["review:t7"].label, by["review:t7"].tone], ["review", "Ready for review", "info"]);
  assert.equal(by["review:t8"].label, "Still checking", "a check that takes long is listed, and says so");
  // From which task: a question names the task it was asked about; a card is its own task.
  assert.equal(by["question:q1"].from, "Search notes by tag");
  assert.equal(by["question:q1"].taskId, "t1");
  assert.equal(by["approval:t5"].from, "", "an approval is the task itself");
  assert.equal(by["approval:t5"].taskId, "t5");
  // How long: the digest's own time, else the question's, else the card's.
  assert.equal(by["question:q1"].at, NOW - 4 * 60000);
  assert.equal(by["review:t8"].at, NOW - 6 * 60000, "the digest's time wins over a card's own");
  const bare = build(board({ needs: [needBlocked()], digest: false })).items[0];
  assert.equal(bare.at, 0, "no time known is no time shown");
});

test("a question offers the app's options, the recommended one first, with the ones that ask for words marked", () => {
  const data = board({ needs: [needQuestion({ options: [
    { id: "hold", label: "Leave it for review", dismiss: true },
    { id: "say", label: "Answer it in one line", action: { kind: "issue", action: "instruct" } },
    { id: "yes", label: "Yes, ignore case", recommended: true, description: "Most notes apps do" },
    { id: "no", label: "Keep them separate" },
  ], context: { taskId: "t1", taskTitle: "Search", suggestion: { optionId: "no", reason: "the last two answers were the same" } } })] });
  const [item] = build(data).items;
  assert.deepEqual(item.options.map((option) => option.id), ["yes", "hold", "say", "no"], "the recommended first, the rest as the app lists them");
  assert.deepEqual(item.options.map((option) => [option.id, option.recommended, option.text, option.dismiss]), [["yes", true, false, false], ["hold", false, false, true], ["say", false, true, false], ["no", true, false, false]], "Mefi's own suggestion counts as recommended");
  assert.equal(item.hint, "Mefi suggests: Keep them separate, because the last two answers were the same");
  assert.equal(item.options[0].description, "Most notes apps do");
});

test("the four groups: running, what is being checked, what finished today, and what waits", () => {
  // The afternoon of a local day, so "since midnight" means the same thing in every time zone.
  const noon = new Date(2026, 8, 30, 15, 0, 0).getTime();
  const midnight = new Date(noon); midnight.setHours(0, 0, 0, 0);
  const data = board({
    needs: [needQuestion()],
    running: [{ taskId: "t2", title: "Add tag chips", phase: "building", startedAt: noon - 5 * 60000, progress: 0.4 }, { taskId: "t3", title: "No progress known", phase: "preparing", startedAt: noon - 30000 }],
    next: [{ id: "t4", title: "Write the docs", stage: "ready" }, { id: "t5", title: "Wait for t2", stage: "waiting" }, { id: "t6", title: "Third one is left out" }],
    checking: [{ id: "t7", title: "Rename the settings tab", status: "awaiting_verification" }],
    tasks: [
      task({ id: "d1", title: "Done this morning", status: "done", doneAt: midnight.getTime() + 6 * 3600000, verification: { state: "verified", reason: "All checks passed" } }),
      task({ id: "d2", title: "Done in the small hours, inside twelve hours", status: "done", doneAt: noon - 11 * 3600000 }),
      task({ id: "d3", title: "Done two days ago", status: "done", doneAt: noon - 50 * 3600000 }),
      task({ id: "d4", title: "Dropped by you", status: "archived", dropped: { at: noon - 3600000 }, doneAt: noon - 3600000 }),
      task({ id: "d5", title: "Not finished", status: "open" }),
    ],
  });
  const { board: groups } = build(data, { now: noon });
  assert.deepEqual(groups.running.map((card) => [card.key, card.tone]), [["run:t2", "live"], ["run:t3", "live"], ["next:t4", "next"], ["next:t5", "next"]], "running jobs, then the next two in line");
  assert.equal(groups.running[0].progress, 0.4);
  assert.equal(groups.running[1].progress, null, "no progress known is a bar that only flows");
  assert.equal(groups.running[0].meta, "5 min · building", "for how long, and what it is doing (the prototype's \"builder-2 · 40 min · step 4/5\"; this run names no worker)");
  assert.equal(groups.running[2].meta, "up next · waits for a free worker");
  assert.equal(groups.running[3].meta, "waiting for what it depends on");
  assert.deepEqual(groups.review.map((card) => card.key), ["check:t7"]);
  assert.equal(groups.review[0].meta, "Checking its work");
  assert.deepEqual(groups.done.map((card) => card.key), ["done:d1", "done:d2"], "since midnight or the last twelve hours, newest first; a drop is not finished work");
  assert.match(groups.done[0].meta, /^Verified · /);
  assert.match(groups.done[1].meta, /^Done · /);
  assert.equal(groups.done[0].more[0], "All checks passed");
  assert.equal(groups.needs.length, 1);
  // A night owl: at 01:00 the morning's work is "today" for the twelve hours before it, not only since midnight.
  const late = new Date(2026, 8, 30, 1, 0, 0).getTime();
  const owl = build(board({ tasks: [task({ id: "e1", status: "done", doneAt: late - 8 * 3600000 }), task({ id: "e2", status: "done", doneAt: late - 13 * 3600000 })] }), { now: late });
  assert.deepEqual(owl.board.done.map((card) => card.key), ["done:e1"], "eight hours ago is still today's work; thirteen is not");
});

test("a task being checked that also waits on you (a long check) is listed once, under Review, and says it is still checking", () => {
  const data = board({ needs: [needReview({ id: "t7", checking: true })], checking: [{ id: "t7", title: "Rename the settings tab", status: "awaiting_verification" }, { id: "t8", title: "Another one", status: "verifying" }] });
  const { board: groups, count } = build(data);
  assert.equal(count, 1, "it is still in the Inbox's count");
  assert.deepEqual(groups.needs.map((card) => card.key), []);
  assert.deepEqual(groups.review.map((card) => card.key), ["need:review:t7", "check:t8"]);
  assert.match(groups.review[0].meta, /^Checking its work/);
  assert.equal(groups.review[0].checking, true, "so it opens its session, not its changes");
});

test("more than six finished today show six and say how many more", () => {
  const tasks = Array.from({ length: 9 }, (_, index) => task({ id: `d${index}`, title: `Finished ${index}`, status: "done", doneAt: NOW - (index + 1) * 60000 }));
  const { board: groups } = build(board({ tasks }));
  assert.equal(groups.done.length, 6);
  assert.equal(groups.doneMore, 3);
  assert.equal(groups.done[0].key, "done:d0", "newest first");
});

test("a worktree run is marked wherever it shows, from what Worktrees already knows", async () => {
  const t = await loadToday({ layout: null, extras: { MefiWorktrees: { summary: () => ({ tasks: ["t2", "d1"] }) } } });
  const { board: groups } = plain(t.window.MefiToday.build(board({ running: [{ taskId: "t2", title: "In its own worktree", phase: "building", startedAt: NOW }, { taskId: "t3", title: "In the main checkout", phase: "building", startedAt: NOW }], tasks: [task({ id: "d1", status: "done", doneAt: NOW - 60000 })] }), { now: NOW }));
  assert.deepEqual(groups.running.map((card) => card.worktree), [true, false]);
  assert.equal(groups.done[0].worktree, true);
});

test("the detail level decides what a card carries: titles only, plus status, or everything", async () => {
  const t = await loadToday({ layout: null, extras: { MefiVibeFlow: { doing: (job) => ({ tool: "OpenCode", step: job.currentStep || "" }) } } });
  const data = board({
    needs: [needQuestion({ context: { taskId: "t1", taskTitle: "Search", evidence: ["npm test", "1 failing"], suggestion: { optionId: "yes", reason: "it is what people expect" } } })],
    running: [{ taskId: "t2", title: "Add tag chips", phase: "building", startedAt: NOW - 60000, currentStep: "editing src/tags.ts" }],
  });
  const at = (detail) => plain(t.window.MefiToday.build(data, { now: NOW, detail })).board;
  const titles = at("titles"), status = at("status"), all = at("all");
  assert.equal(titles.needs[0].quick, undefined, "titles: no answer buttons");
  assert.deepEqual(titles.needs[0].more, []);
  assert.deepEqual(status.needs[0].quick.map((option) => option.id), ["yes", "no"], "status: the first two options that answer at once");
  assert.deepEqual(status.needs[0].more, [], "status: one line, not the detail");
  assert.deepEqual(all.needs[0].more, ["Mefi suggests: Yes, ignore case, because it is what people expect", "1 failing"], "everything: what Mefi suggests and the last line the agent printed");
  assert.equal(status.running[0].meta, "OpenCode · 1 min · editing src/tags.ts", "the worker on it, for how long, and its live step, as the prototype's line");
  assert.deepEqual(status.running[0].more, [], "the step is on the line itself, so nothing repeats it");
});

test("what was handled a moment ago is out of the count, and its decided line keeps its place until it has been seen", () => {
  const data = board({ needs: [needQuestion(), needApproval(), needBlocked()] });
  const handled = new Map([["approval:t5", { at: NOW, showUntil: NOW + 8000, holdUntil: NOW + 90000, label: "Approved", undo: null, title: "Add a changelog page", kind: "approval", tone: "warn", kindLabel: "Waiting for your go-ahead", taskId: "t5", index: 1 }]]);
  const now = build(data, { handled });
  assert.equal(now.count, 2, "the pill counts what still needs you");
  assert.deepEqual(now.items.map((item) => [item.key, Boolean(item.handled)]), [["question:q1", false], ["approval:t5", true], ["blocked:t6", false]], "read as a decided line, in its place");
  assert.equal(now.board.needs.find((card) => card.key === "need:approval:t5").decided, true);
  // The host has caught up: the need left its list, and the line still stays for its few seconds, at the place it had.
  const caught = build(board({ needs: [needQuestion(), needBlocked()] }), { handled });
  assert.deepEqual(caught.items.map((item) => [item.key, Boolean(item.handled)]), [["question:q1", false], ["approval:t5", true], ["blocked:t6", false]]);
  assert.equal(caught.count, 2);
  // After the few seconds it is gone, and after the hold a need that never settled counts again.
  const seen = build(board({ needs: [needQuestion(), needBlocked()] }), { handled, now: NOW + 9000 });
  assert.deepEqual(seen.items.map((item) => item.key), ["question:q1", "blocked:t6"]);
  const unsettled = build(data, { handled, now: NOW + 91000 });
  assert.equal(unsettled.count, 3, "it was not settled after all: it needs you again");
  const hidden = build(data, { handled, now: NOW + 20000 });
  assert.equal(hidden.count, 2, "handled, but not yet dropped by the host: out of the count and out of the list");
  assert.deepEqual(hidden.items.map((item) => item.key), ["question:q1", "blocked:t6"]);
});

test("nothing at all is a calm board in the model (the page draws the four columns, each saying it is empty)", () => {
  const picture = build(board());
  assert.equal(picture.quiet, true);
  assert.deepEqual(Object.values(picture.board).slice(0, 4).map((cards) => cards.length), [0, 0, 0, 0]);
  assert.equal(build(board({ running: [{ taskId: "t2", title: "Busy", phase: "building" }] })).quiet, false);
  assert.equal(build(board({ needs: [needQuestion()] })).quiet, false);
});

test("Latest is the task notices the assistant already keeps, newest first, without its own bookkeeping lines", () => {
  const messages = [
    { id: "m1", kind: "notice", taskId: "t1", text: "Search notes by tag started", at: NOW - 5 * 60000 },
    { id: "m2", kind: "notice", taskId: "__needs_you__", text: "2 items need you", at: NOW - 4 * 60000 },
    { id: "m3", role: "user", text: "a chat message", at: NOW - 3 * 60000 },
    { id: "m4", kind: "notice", taskId: "t2", text: "Add tag chips passed its checks", at: NOW - 2 * 60000 },
  ];
  const { board: groups } = build(board({ messages }));
  assert.deepEqual(groups.latest.map((note) => note.text), ["Add tag chips passed its checks", "Search notes by tag started"]);
});

test("with layout v2 off the script starts nothing: no route, no watcher, no listener, no timer, no count", async () => {
  const t = await loadToday({ layout: null });
  assert.equal(t.today.isOn(), false);
  assert.deepEqual(t.nav.registered, [], "no route is registered");
  assert.equal(t.vibe.watchers.size, 0, "it does not ask Vibe for its data");
  assert.deepEqual(Object.keys(t.events), [], "no window listener");
  assert.deepEqual(t.timers, []);
  assert.equal(t.today.count(), 0);
  assert.deepEqual(plain(t.today.items()), []);
  assert.equal(t.today.openInbox(null), false, "the Inbox does not open");
  assert.equal(t.today.openNeed({ kind: "question", id: "q1" }), false, "so Vibe's own drawer answers a need, as in v1");
  assert.equal(t.today.openFromAlert({ kind: "need", taskId: "t1" }), false, "and alerts.js opens the task itself");
  assert.equal(t.today.show(), false);
  assert.equal(t.today.takesNeeds(), false);
  assert.equal(t.document.querySelector("#today-inbox"), null);
  assert.equal(t.get("vibe-layer").dataset.today, undefined, "Vibe's layer is untouched");
  assert.deepEqual(t.calls, [], "and nothing reached the host");
});

test("a layout other than v2 is also off", async () => {
  const t = await loadToday({ layout: "v1" });
  assert.equal(t.today.isOn(), false);
  assert.equal(t.vibe.watchers.size, 0);
});

test("started in v2 it registers its routes, asks Vibe for its data once, and listens for what it needs", async () => {
  const t = await loadToday({ data: board({ needs: [needQuestion()] }) });
  assert.equal(t.today.isOn(), true);
  assert.deepEqual(t.nav.registered.map((record) => [record.id, record.kind, record.layer ?? null, record.section]), [["today", "overlay", "sheet", "home"], ["inbox", "overlay", "sheet", "work"], ["home-chat", "action", null, "home"], ["inbox-open", "action", null, "home"]]);
  assert.equal(t.vibe.watchers.size, 1, "one watcher on Vibe's data");
  assert.deepEqual(Object.keys(t.events).sort(), ["keydown", "mefi:appearance", "mefi:layout", "mefi:nav", "mefi:project-changed"], "the navigation says which view of Home is up (Build's Today or the conversation)");
  assert.equal(t.today.count(), 1);
  assert.equal(t.today.start(), false, "starting again changes nothing");
  assert.equal(t.vibe.watchers.size, 1);
  const today = t.nav.registered.find((record) => record.id === "today");
  assert.equal(today.hidden(), true, "Vibe's Home is Today already, so Search lists it once");
  const build = await loadToday({ mode: "build" });
  assert.equal(build.nav.registered.find((record) => record.id === "today").hidden(), false, "in Build it is the pinned tab's page");
});
