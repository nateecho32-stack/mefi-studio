// The Inbox (renderer/today.js): everything that waits on the owner, from the list the
// app already keeps, and what can be done about each thing, through the calls the
// rest of the app already makes. Every kind is walked: a question (and a permission,
// which is one), an approval, steps to approve, a stuck task, a result to check.
// Each action calls the right host function once, and a second press does nothing:
// while it is in flight and after it landed. What was done leaves a "Decided" line,
// with an Undo only where the app has a way back. Keys, the popover, the notification
// hand-off and what happens when the host says no are pinned here too.
import test from "node:test";
import assert from "node:assert/strict";

import { NOW, board, loadToday, needApproval, needBlocked, needFamily, needQuestion, needReview, plain } from "./fixtures/today-env.mjs";

const press = async (t, node, turns = 1) => { for (let i = 0; i < turns; i += 1) await node.click(); await t.settle(); };
const inboxOf = (t) => t.inbox();
const cardOf = (t, key) => inboxOf(t).querySelector(`[data-key="${key}"]`);
const buttonNamed = (card, label) => card.querySelectorAll("button").find((node) => node.textContent === label) ?? null;
const words = (card) => card.textContent;
const open = async (t, data, focus = null) => { if (data) await t.push(data); t.today.openInbox(null, { focus }); await t.settle(); return inboxOf(t); };

test("the popover lists each thing with what it is, which task it is from and how long it has waited", async () => {
  const t = await loadToday({ data: board({ needs: [needQuestion(), needApproval(), needBlocked(), needReview()] }) });
  await open(t);
  const node = inboxOf(t);
  assert.equal(node.hidden, false);
  assert.equal(node.getAttribute("role"), "dialog");
  assert.equal(node.getAttribute("aria-label"), "Inbox");
  assert.equal(node.querySelector(".today-inbox-count").textContent, "4", "the popover's own count is the list's length");
  const [first] = node.querySelectorAll(".today-need");
  assert.match(words(first), /^Questionfrom Search notes by tag4 minShould #Work and #work count as the same tag\?/, "kind, from which task, how long, what");
  assert.equal(first.querySelector("time").textContent, "4 min");
  assert.equal(first.getAttribute("aria-labelledby"), first.querySelector("h5").id, "each card is named by what it asks");
  assert.deepEqual(node.querySelectorAll(".today-need").map((card) => card.dataset.key), ["question:q1", "approval:t5", "blocked:t6", "review:t7"]);
  // A second push with nothing new keeps the very same nodes.
  const before = node.querySelectorAll(".today-need");
  await t.push(board({ needs: [needQuestion(), needApproval(), needBlocked(), needReview()] }));
  assert.deepEqual(node.querySelectorAll(".today-need").map((card, index) => card === before[index]), [true, true, true, true], "a repaint that changes nothing rebuilds nothing");
});

test("an answer is one host call with the question, the option and the project, then a Decided line; a second press does nothing", async () => {
  const t = await loadToday({ data: board({ needs: [needQuestion(), needApproval()] }) });
  await open(t);
  const told = []; t.today.onChange((count) => told.push(count));
  const card = cardOf(t, "question:q1");
  const yes = card.querySelector('[data-option="yes"]');
  yes.click(); yes.click(); // two presses in the same turn
  await t.settle();
  assert.deepEqual(t.callsOf("assistantAnswer"), [{ id: "q1", optionId: "yes", projectId: "p1" }], "once, with nothing it was not asked");
  const decided = cardOf(t, "question:q1");
  assert.match(words(decided), /^Decided · Answered: Yes, ignore case/);
  assert.equal(decided.className.includes("is-decided"), true);
  assert.equal(decided.querySelectorAll("button").length, 0, "the answer is the owner's: no Undo where the app has none");
  assert.equal(t.today.count(), 1, "out of the count at once");
  assert.deepEqual(told, [1], "and the pill hears it");
  assert.equal(t.vibe.refreshes, 1, "the page reads again so the host's own list catches up");
  assert.equal(inboxOf(t).querySelector(".today-inbox-count").textContent, "1");
  // The decided line is not a card any more: pressing through a stale handle does nothing.
  yes.click(); await t.settle();
  assert.equal(t.callsOf("assistantAnswer").length, 1, "refused after it landed");
});

test("words of your own: the box answers with text, an empty box does nothing, and an option that asks for words waits for them", async () => {
  const t = await loadToday({ data: board({ needs: [needQuestion()] }) });
  await open(t);
  let card = cardOf(t, "question:q1");
  const input = card.querySelector(".today-need-input");
  const form = card.querySelector("form");
  form.trigger("submit"); await t.settle();
  assert.deepEqual(t.callsOf("assistantAnswer"), [], "nothing typed, nothing sent");
  input.value = "  Case never matters here  ";
  input.trigger("input");
  form.trigger("submit"); await t.settle();
  assert.deepEqual(t.callsOf("assistantAnswer"), [{ id: "q1", text: "Case never matters here", projectId: "p1", optionId: null }]);
  assert.match(words(cardOf(t, "question:q1")), /Decided · Answered: Case never matters here/);
  // An option that asks for one line does not answer by itself.
  const u = await loadToday({ data: board({ needs: [needQuestion()] }) });
  await open(u);
  card = cardOf(u, "question:q1");
  const say = card.querySelector('[data-option="say"]');
  await press(u, say);
  assert.deepEqual(u.callsOf("assistantAnswer"), [], "it only asks for the line");
  assert.match(card.querySelector(".today-need-input").placeholder, /one-line answer/);
  const box = card.querySelector(".today-need-input");
  box.value = "Ignore the case";
  box.trigger("input");
  card.querySelector("form").trigger("submit"); await u.settle();
  assert.deepEqual(u.callsOf("assistantAnswer"), [{ id: "q1", optionId: "say", text: "Ignore the case", projectId: "p1" }], "the option and the words go together");
});

test("Enter in the box sends it, and a half-typed answer survives a push that changes another card", async () => {
  const t = await loadToday({ data: board({ needs: [needQuestion(), needQuestion({ id: "q2", title: "Second question?", context: { taskId: "t2", taskTitle: "Other" } })] }) });
  await open(t);
  const first = cardOf(t, "question:q1");
  const input = first.querySelector(".today-need-input");
  input.value = "half a thought"; input.trigger("input");
  await t.push(board({ needs: [needQuestion(), needQuestion({ id: "q2", title: "Second question? (edited)", context: { taskId: "t2", taskTitle: "Other" } })] }));
  assert.equal(cardOf(t, "question:q1"), first, "the card that did not change is the same node");
  assert.equal(cardOf(t, "question:q1").querySelector(".today-need-input").value, "half a thought", "and keeps what was typed");
  assert.match(words(cardOf(t, "question:q2")), /Second question\? \(edited\)/, "the one that changed was rebuilt");
  // A rebuild of the card being typed in keeps the draft too.
  await t.push(board({ needs: [needQuestion({ title: "Should #Work and #work count as the same tag? (reworded)" }), needQuestion({ id: "q2", title: "Second question? (edited)", context: { taskId: "t2", taskTitle: "Other" } })] }));
  assert.equal(cardOf(t, "question:q1").querySelector(".today-need-input").value, "half a thought", "the draft outlives a rebuild of its own card");
  // The keyboard was in that box: the rebuilt card's box has it now, not the page.
  t.document.activeElement = cardOf(t, "question:q1").querySelector(".today-need-input");
  await t.push(board({ needs: [needQuestion({ title: "Should #Work and #work count as the same tag? (reworded again)" }), needQuestion({ id: "q2", title: "Second question? (edited)", context: { taskId: "t2", taskTitle: "Other" } })] }));
  assert.equal(cardOf(t, "question:q1").querySelector(".today-need-input").focused, true, "focus follows the answer box into its rebuilt card");
  const box = cardOf(t, "question:q1").querySelector(".today-need-input");
  let sent = false;
  box.trigger("keydown", { key: "Enter", isComposing: false }); await t.settle();
  sent = t.callsOf("assistantAnswer").length === 1;
  assert.equal(sent, true, "Enter sends it");
  assert.equal(t.callsOf("assistantAnswer")[0].text, "half a thought");
});

test("an approval is approved with the scope the host gave, and Drop asks twice; Undo reopens a drop", async () => {
  const t = await loadToday({ data: board({ needs: [needApproval()] }) });
  await open(t);
  let card = cardOf(t, "approval:t5");
  assert.deepEqual(card.querySelectorAll(".today-need-options button").map((node) => node.textContent), ["Approve build", "Drop it"]);
  const drop = buttonNamed(card, "Drop it");
  await press(t, drop);
  assert.deepEqual(t.callsOf("tasksAction"), [], "the first press only asks");
  assert.equal(drop.textContent, "Drop this task?");
  await press(t, drop);
  assert.deepEqual(t.callsOf("tasksAction"), [{ taskId: "t5", projectId: "p1", action: "drop" }]);
  card = cardOf(t, "approval:t5");
  assert.match(words(card), /^Decided · DroppedAdd a changelog page/);
  const undo = buttonNamed(card, "Undo");
  assert.ok(undo, "a drop can be reopened, as the Tasks page does");
  undo.click(); undo.click(); await t.settle();
  assert.deepEqual(t.callsOf("tasksAction").slice(1), [{ taskId: "t5", projectId: "p1", action: "status", status: "open" }], "Undo is one reopen, even pressed twice in one turn");
  assert.equal(t.today.count(), 1, "and the task is waiting on you again");
  assert.ok(cardOf(t, "approval:t5").querySelector(".today-need-options"), "as a card, not a decided line");
  // Approving.
  const u = await loadToday({ data: board({ needs: [needApproval()] }) });
  await open(u);
  await press(u, buttonNamed(cardOf(u, "approval:t5"), "Approve build"));
  assert.deepEqual(u.callsOf("backlogControl"), [{ action: "approve", taskId: "t5", projectId: "p1", expectedScope: "scope-5" }]);
  assert.match(words(cardOf(u, "approval:t5")), /Decided · Approved\. It builds when a worker is free/);
  assert.equal(buttonNamed(cardOf(u, "approval:t5"), "Undo"), null, "an approval has no way back");
});

test("an approval the host cannot vouch for is not approved from here", async () => {
  const t = await loadToday({ data: board({ needs: [needApproval({ row: { id: "t5", canApprove: false, buildScope: "scope-5" } }), needApproval({ id: "t6", title: "No scope", row: { id: "t6", canApprove: true } })] }) });
  await open(t);
  for (const key of ["approval:t5", "approval:t6"]) {
    const approve = buttonNamed(cardOf(t, key), "Approve build");
    assert.equal(approve.disabled, true, `${key}: Approve waits for a brief it can name`);
    assert.match(approve.title, /Open the task to review its current brief/);
    await press(t, approve);
  }
  assert.deepEqual(t.callsOf("backlogControl"), []);
  const acceptMode = await loadToday({ data: board({ needs: [needApproval()] }), extras: { MefiAutonomy: { state: () => ({ level: "accept", projectId: "p1", decisions: [] }) } } });
  await open(acceptMode);
  assert.ok(buttonNamed(cardOf(acceptMode, "approval:t5"), "Accept this task"), "in Accept per task the verb is the mode's own");
});

test("steps to approve start together, stop at the first refusal, or become one task", async () => {
  const t = await loadToday({ data: board({ needs: [needFamily()] }), bridge: { backlogControl: (args) => (args.taskId === "t12" ? { ok: false, error: "That brief changed. Open it and read it again." } : { ok: true }) } });
  await open(t);
  const card = cardOf(t, "family:t10");
  assert.match(words(card), /2 steps wait for your go-ahead/);
  assert.deepEqual(card.querySelectorAll(".today-need-options button").map((node) => node.textContent), ["Start all 2 steps", "Make it one task"]);
  await press(t, buttonNamed(card, "Start all 2 steps"));
  assert.deepEqual(t.callsOf("backlogControl"), [
    { action: "approve", taskId: "t11", projectId: "p1", expectedScope: "s11" },
    { action: "approve", taskId: "t12", projectId: "p1", expectedScope: "s12" },
  ], "each step with its own scope, in order");
  assert.match(words(cardOf(t, "family:t10")), /That brief changed/, "a refusal is said on the card");
  assert.equal(t.today.count(), 1, "and it still waits on you");
  // The first step refusing means the second is never asked: nothing is half-started behind a refusal.
  const first = await loadToday({ data: board({ needs: [needFamily()] }), bridge: { backlogControl: (args) => (args.taskId === "t11" ? { ok: false, error: "That brief changed. Open it and read it again." } : { ok: true }) } });
  await open(first);
  await press(first, buttonNamed(cardOf(first, "family:t10"), "Start all 2 steps"));
  assert.deepEqual(first.callsOf("backlogControl").map((call) => call.taskId), ["t11"], "it stops at the first refusal");
  assert.equal(first.today.count(), 1);
  const one = await loadToday({ data: board({ needs: [needFamily()] }) });
  await open(one);
  const merge = buttonNamed(cardOf(one, "family:t10"), "Make it one task");
  await press(one, merge);
  assert.deepEqual(one.callsOf("tasksAction"), [], "it asks first");
  await press(one, merge);
  assert.deepEqual(one.callsOf("tasksAction"), [{ taskId: "t10", projectId: "p1", action: "merge-steps" }]);
  assert.match(words(cardOf(one, "family:t10")), /Decided · Kept as one task/);
});

test("a stuck task is tried again, marked done after a second press, or dropped; done and drop can be reopened", async () => {
  const t = await loadToday({ data: board({ needs: [needBlocked()] }) });
  await open(t);
  let card = cardOf(t, "blocked:t6");
  assert.match(words(card), /Same failure repeating/);
  assert.match(words(card), /The same check failed three times\./, "why it stopped");
  assert.deepEqual(card.querySelectorAll(".today-need-options button").map((node) => node.textContent), ["Try again", "It's done", "Drop it"], "Try again is the hold's own verb");
  await press(t, buttonNamed(card, "Try again"));
  assert.deepEqual(t.callsOf("tasksAction"), [{ taskId: "t6", projectId: "p1", action: "retry" }]);
  assert.equal(buttonNamed(cardOf(t, "blocked:t6"), "Undo"), null, "a retry has no way back");
  const u = await loadToday({ data: board({ needs: [needBlocked({ row: { id: "t6", blockedBy: "owner", canRetry: true } })] }) });
  await open(u);
  card = cardOf(u, "blocked:t6");
  assert.equal(buttonNamed(card, "Resume").className.includes("primary"), true, "a stop you made is resumed, not retried");
  const done = buttonNamed(card, "It's done");
  await press(u, done); await press(u, done);
  assert.deepEqual(u.callsOf("tasksAction"), [{ taskId: "t6", projectId: "p1", action: "status", status: "done" }]);
  await press(u, buttonNamed(cardOf(u, "blocked:t6"), "Undo"));
  assert.deepEqual(u.callsOf("tasksAction").at(-1), { taskId: "t6", projectId: "p1", action: "status", status: "open" });
  // A card that cannot be retried (its check is running) is not offered the retry.
  const v = await loadToday({ data: board({ needs: [needBlocked({ row: { id: "t6", blockedBy: "loop", canRetry: false } })] }) });
  await open(v);
  assert.equal(buttonNamed(cardOf(v, "blocked:t6"), "Try again").disabled, true);
  const w = await loadToday({ data: board({ needs: [needBlocked({ row: { id: "t6", blockedBy: "loop" } })], tasks: [{ id: "t6", title: "Fix the login redirect loop", status: "verifying" }] }) });
  await open(w);
  assert.equal(buttonNamed(cardOf(w, "blocked:t6"), "Try again").disabled, true, "nor while the task itself is being verified");
  const x = await loadToday({ data: board({ needs: [needBlocked({ row: { id: "t6", blockedBy: "loop" } })], tasks: [{ id: "t6", title: "Fix the login redirect loop", status: "blocked" }] }) });
  await open(x);
  assert.equal(buttonNamed(cardOf(x, "blocked:t6"), "Try again").disabled, false);
});

test("a result to check is confirmed or sent back; one whose check is still running can only be marked done", async () => {
  const t = await loadToday({ data: board({ needs: [needReview()], tasks: [{ id: "t7", title: "Rename the settings tab", status: "awaiting_verification", verification: { state: "failed", reason: "The checker could not start a browser." } }] }) });
  await open(t);
  let card = cardOf(t, "review:t7");
  assert.match(words(card), /The checker could not start a browser\./, "the checker's word is shown");
  assert.deepEqual(card.querySelectorAll(".today-need-options button").map((node) => node.textContent), ["Confirm done", "Send it back"]);
  await press(t, buttonNamed(card, "Confirm done"));
  assert.deepEqual(t.callsOf("tasksAction"), [{ taskId: "t7", projectId: "p1", action: "status", status: "done" }]);
  assert.ok(buttonNamed(cardOf(t, "review:t7"), "Undo"), "a confirmation can be reopened");
  const back = await loadToday({ data: board({ needs: [needReview()] }) });
  await open(back);
  await press(back, buttonNamed(cardOf(back, "review:t7"), "Send it back"));
  assert.deepEqual(back.callsOf("tasksAction"), [{ taskId: "t7", projectId: "p1", action: "retry" }]);
  const running = await loadToday({ data: board({ needs: [needReview()], tasks: [{ id: "t7", title: "Rename", status: "verifying" }] }) });
  await open(running);
  assert.equal(buttonNamed(cardOf(running, "review:t7"), "Send it back").disabled, true, "not while its check runs");
  const long = await loadToday({ data: board({ needs: [needReview({ checking: true, since: NOW - 50 * 60000 })] }) });
  await open(long);
  assert.deepEqual(cardOf(long, "review:t7").querySelectorAll(".today-need-options button").map((node) => node.textContent), ["It's done"], "a long check can be confirmed by you, never dropped");
});

test("a permission is answered through the question's own options, recommended first, like any question", async () => {
  const permission = needQuestion({ id: "q9", title: "builder-3 wants to write outside its task", context: { taskId: "t3", taskTitle: "Fix the sidebar", issueKind: "permission" },
    options: [{ id: "grant", label: "Grant it for this task" }, { id: "deny", label: "Deny", recommended: true }, { id: "hold", label: "Leave it for review", dismiss: true }] });
  const t = await loadToday({ data: board({ needs: [permission] }) });
  await open(t);
  const card = cardOf(t, "question:q9");
  assert.equal(card.dataset.kind, "permission");
  assert.match(words(card), /^Permissionfrom Fix the sidebar/);
  assert.deepEqual(card.querySelectorAll("[data-option]").map((node) => node.dataset.option), ["deny", "grant", "hold"], "the safe answer first");
  await press(t, card.querySelector('[data-option="grant"]'));
  assert.deepEqual(t.callsOf("assistantAnswer"), [{ id: "q9", optionId: "grant", projectId: "p1" }]);
  assert.match(words(cardOf(t, "question:q9")), /Decided · Answered: Grant it for this task/);
});

test("when the host says no the card says why, keeps its buttons and still counts; a question that closed meanwhile is a notice", async () => {
  let reply = { ok: false, error: "The selected project changed." };
  const t = await loadToday({ data: board({ needs: [needQuestion()] }), bridge: { assistantAnswer: () => reply } });
  await open(t);
  await press(t, cardOf(t, "question:q1").querySelector('[data-option="yes"]'));
  let card = cardOf(t, "question:q1");
  assert.equal(card.querySelector(".today-need-note").textContent, "The selected project changed.");
  assert.equal(card.querySelector(".today-need-note").getAttribute("role"), "alert");
  assert.equal(t.today.count(), 1, "nothing was decided");
  assert.equal(card.querySelector('[data-option="yes"]').disabled, false, "and it can be tried again");
  reply = { ok: true };
  await press(t, card.querySelector('[data-option="yes"]'));
  assert.equal(t.callsOf("assistantAnswer").length, 2);
  assert.match(words(cardOf(t, "question:q1")), /Decided/);
  // A call that throws reads as a sentence, not a stack.
  const u = await loadToday({ data: board({ needs: [needBlocked()] }), bridge: { tasksAction: () => { throw new TypeError("Cannot read properties of undefined"); } } });
  await open(u);
  await press(u, buttonNamed(cardOf(u, "blocked:t6"), "Try again"));
  assert.equal(cardOf(u, "blocked:t6").querySelector(".today-need-note").textContent, "That did not go through. You can also open the task.");
  // gone: the host cleared it.
  const gone = await loadToday({ data: board({ needs: [needQuestion()] }), bridge: { assistantAnswer: () => ({ ok: false, gone: true, error: "That question is no longer waiting." }) } });
  await open(gone);
  await press(gone, cardOf(gone, "question:q1").querySelector('[data-option="no"]'));
  assert.match(words(cardOf(gone, "question:q1")), /Decided · That question is no longer waiting\./);
  assert.equal(gone.today.count(), 0, "it is not waiting any more");
  // The host had already dropped it (its push came first): the notice still stands where the question was.
  let late = null;
  late = await loadToday({ data: board({ needs: [needQuestion(), needBlocked()] }), bridge: { assistantAnswer: async () => { await late.push(board({ needs: [needBlocked()] })); return { ok: false, gone: true, error: "That question is no longer waiting." }; } } });
  await open(late);
  await press(late, cardOf(late, "question:q1").querySelector('[data-option="no"]'));
  assert.deepEqual(inboxOf(late).querySelectorAll(".today-need").map((card) => card.dataset.key), ["question:q1", "blocked:t6"]);
  assert.match(words(cardOf(late, "question:q1")), /^Decided · That question is no longer waiting\./);
});

test("a decided line leaves by itself, the count does not come back, and a need the host never settled returns", async () => {
  const data = board({ needs: [needQuestion(), needBlocked()] });
  const t = await loadToday({ data });
  await open(t);
  await press(t, cardOf(t, "question:q1").querySelector('[data-option="yes"]'));
  assert.equal(t.today.count(), 1);
  assert.ok(cardOf(t, "question:q1"), "the decided line is there");
  t.clock.now += 9000;
  await t.fire();
  assert.equal(cardOf(t, "question:q1"), null, "gone after a few seconds");
  assert.equal(t.today.count(), 1, "the host is slow to drop it; it stays out of the count");
  t.clock.now += 90000;
  await t.fire("all");
  assert.equal(t.today.count(), 2, "never settled: it is waiting on you again");
  assert.ok(cardOf(t, "question:q1").querySelector(".today-need-options"));
  await press(t, cardOf(t, "question:q1").querySelector('[data-option="no"]'));
  assert.deepEqual(t.callsOf("assistantAnswer").map((call) => call.optionId), ["yes", "no"], "and it can be answered again: the old hold does not refuse it");
  // Nothing keeps ticking for a hold that ended: the sweep stops once there is nothing left to sweep.
  const pending = (run) => run.timers.filter((timer) => !timer.cancelled && !timer.every).length;
  t.clock.now += 120000;
  await t.fire("all");
  assert.equal(pending(t), 0, "no timer is left running for a decision that is settled");
  // Once the host drops it, the hold is forgotten.
  const u = await loadToday({ data });
  await open(u);
  await press(u, cardOf(u, "question:q1").querySelector('[data-option="yes"]'));
  await u.push(board({ needs: [needBlocked()] }));
  u.clock.now += 9000;
  await u.fire();
  assert.equal(u.today.count(), 1);
  assert.equal(pending(u), 0, "the host dropped it and the line was seen: nothing left to sweep");
  assert.deepEqual(plain(u.today.snapshot()).items.map((item) => item.key), ["blocked:t6"]);
  await u.push(board({ needs: [needQuestion(), needBlocked()] }));
  assert.equal(u.today.count(), 2, "a new question with the same id after the host forgot it is a new thing");
});

test("Decide later puts a thing last for now, it still needs you, and Decide now puts it back", async () => {
  const t = await loadToday({ data: board({ needs: [needQuestion(), needApproval(), needBlocked()] }) });
  await open(t);
  const order = () => inboxOf(t).querySelectorAll(".today-need").map((card) => card.dataset.key);
  await press(t, buttonNamed(cardOf(t, "question:q1"), "Decide later"));
  assert.deepEqual(order(), ["approval:t5", "blocked:t6", "question:q1"]);
  assert.equal(t.today.count(), 3, "it still waits on you, so the count says so");
  assert.equal(cardOf(t, "question:q1").className.includes("is-later"), true);
  assert.deepEqual(t.callsOf("assistantAnswer"), [], "nothing is sent to the host: it is only put off");
  await t.push(board({ needs: [needQuestion(), needApproval(), needBlocked()] }));
  assert.deepEqual(order(), ["approval:t5", "blocked:t6", "question:q1"], "a push does not undo it");
  await press(t, buttonNamed(cardOf(t, "question:q1"), "Decide now"));
  assert.deepEqual(order(), ["question:q1", "approval:t5", "blocked:t6"]);
  assert.deepEqual(plain(t.today.snapshot()).later, []);
  // Put off, then the project changes: nothing of it carries over.
  await press(t, buttonNamed(cardOf(t, "approval:t5"), "Decide later"));
  t.window.dispatchEvent({ type: "mefi:project-changed", detail: { projectId: "p2" } });
  await t.settle();
  assert.deepEqual(plain(t.today.snapshot()).later, []);
});

test("a thing opens its task through the tab strip when there is one, else through the route", async () => {
  const tabs = [];
  const t = await loadToday({ data: board({ needs: [needBlocked()] }), extras: { MefiTabs: { open: (...args) => tabs.push(plain(args)) } } });
  await open(t);
  await press(t, buttonNamed(cardOf(t, "blocked:t6"), "Open task"));
  assert.deepEqual(tabs, [["tasks", { taskId: "t6", projectId: "p1", filter: "all" }, { preview: true }]], "a preview tab, like every page you look at");
  assert.deepEqual(t.nav.gone, []);
  assert.equal(inboxOf(t).hidden, true, "and the popover gets out of the way");
  const u = await loadToday({ data: board({ needs: [needBlocked()] }) });
  await open(u);
  await press(u, buttonNamed(cardOf(u, "blocked:t6"), "Open task"));
  assert.deepEqual(u.nav.gone, [["tasks", { taskId: "t6", projectId: "p1", filter: "all" }]]);
  // A question about no task has nothing to open.
  const w = await loadToday({ data: board({ needs: [needQuestion({ context: {} })] }) });
  await open(w);
  assert.equal(buttonNamed(cardOf(w, "question:q1"), "Open task"), null);
});

test("J and K move, a number picks an option, Enter opens the task, Esc closes and gives the keyboard back", async () => {
  const tabs = [];
  const t = await loadToday({ data: board({ needs: [needQuestion(), needApproval(), needBlocked()] }), extras: { MefiTabs: { open: (...args) => tabs.push(plain(args)) } } });
  const pill = t.document.createElement("button");
  t.document.activeElement = pill;
  t.today.openInbox(pill); await t.settle();
  const current = () => inboxOf(t).querySelectorAll(".today-need").findIndex((card) => card.className.includes("is-current"));
  assert.equal(current(), 0);
  t.inboxKey("j"); assert.equal(current(), 1);
  t.inboxKey("ArrowDown"); assert.equal(current(), 2);
  t.inboxKey("j"); assert.equal(current(), 2, "the last stays the last");
  t.inboxKey("k"); t.inboxKey("ArrowUp"); assert.equal(current(), 0);
  t.inboxKey("k"); assert.equal(current(), 0);
  // A number answers the current thing with its nth option.
  t.inboxKey("2"); await t.settle();
  assert.deepEqual(t.callsOf("assistantAnswer"), [{ id: "q1", optionId: "no", projectId: "p1" }], "2 is the second option");
  // An option that asks for words is not answered by a number, and a digit past the list does nothing.
  const u = await loadToday({ data: board({ needs: [needQuestion()] }) });
  await open(u);
  u.inboxKey("3"); u.inboxKey("7"); await u.settle();
  assert.deepEqual(u.callsOf("assistantAnswer"), []);
  // A letter or a digit typed in here is for here, used or not: Studio's own one-key places (2) and Vibe's panels (T) stay out of it.
  assert.equal(u.inboxKey("9"), true, "a digit past the options is still not a place");
  assert.equal(u.inboxKey("x"), true, "nor is a letter");
  assert.equal(u.inboxKey("Tab"), false, "Tab still walks the buttons");
  assert.equal(u.inboxKey(" "), false, "and Space still presses the one that has the focus");
  // The keyboard is the popover's while it is inside it, which is what tells Vibe's shortcuts to wait.
  const inside = inboxOf(u).querySelector("button");
  u.document.activeElement = inside;
  assert.equal(u.today.ownsKeys(), true);
  u.document.activeElement = u.body;
  assert.equal(u.today.ownsKeys(), false, "focus elsewhere: Vibe's keys are Vibe's");
  u.document.activeElement = inside; u.today.closeInbox();
  assert.equal(u.today.ownsKeys(), false, "closed: nobody's");
  u.today.openInbox(null); await u.settle();
  // Typing in the answer box is typing: no keys are taken.
  const box = cardOf(u, "question:q1").querySelector(".today-need-input");
  u.inboxKey("1", { target: box }); u.inboxKey("j", { target: box }); await u.settle();
  assert.deepEqual(u.callsOf("assistantAnswer"), []);
  u.inboxKey("1"); await u.settle();
  assert.deepEqual(u.callsOf("assistantAnswer"), [{ id: "q1", optionId: "yes", projectId: "p1" }], "1 is the first option");
  // Enter on a card opens its task.
  const card = inboxOf(t).querySelectorAll(".today-need")[1];
  t.inboxKey("j"); t.inboxKey("Enter", { target: card }); await t.settle();
  assert.deepEqual(tabs, [["tasks", { taskId: "t5", projectId: "p1", filter: "all" }, { preview: true }]]);
  // Esc closes and the keyboard goes back to where it was.
  const v = await loadToday({ data: board({ needs: [needQuestion()] }) });
  const opener = v.document.createElement("button");
  v.document.activeElement = opener;
  v.today.openInbox(opener); await v.settle();
  assert.equal(opener.getAttribute("aria-expanded"), "true");
  assert.equal(v.inboxKey("Escape"), true);
  assert.equal(inboxOf(v).hidden, true);
  assert.equal(opener.focused, true, "focus returns to what opened it");
  assert.equal(opener.getAttribute("aria-expanded"), "false");
});

test("Ctrl J opens and closes the Inbox from anywhere, and nothing else does", async () => {
  const t = await loadToday({ data: board({ needs: [needQuestion()] }) });
  assert.equal(t.key("j", { ctrlKey: true }), true, "the chord is taken");
  await t.settle();
  assert.equal(inboxOf(t).hidden, false);
  t.key("j", { ctrlKey: true });
  assert.equal(inboxOf(t).hidden, true, "and pressed again it closes");
  assert.equal(t.key("j"), false, "a plain j is the page's");
  assert.equal(t.key("j", { ctrlKey: true, shiftKey: true }), false);
  assert.equal(t.key("j", { ctrlKey: true, altKey: true }), false);
  const off = await loadToday({ layout: null });
  assert.equal(off.key("j", { ctrlKey: true }), false, "in v1 the chord is nobody's");
});

test("the pill is a toggle: a press on it while the Inbox is open closes it, and the click that follows does not reopen it", async () => {
  const t = await loadToday({ data: board({ needs: [needQuestion()] }) });
  const pill = t.document.createElement("button");
  pill.getBoundingClientRect = () => ({ left: 900, right: 1040, top: 10, bottom: 42, width: 140, height: 32 });
  t.today.openInbox(pill); await t.settle();
  const press1 = { target: pill };
  for (const callback of t.body.listeners.pointerdown ?? []) callback(press1);
  assert.equal(inboxOf(t).hidden, true, "the press closed it");
  assert.equal(t.today.openInbox(pill), true, "the click that follows is handled, and does nothing: a caller that falls back on false must not");
  assert.equal(inboxOf(t).hidden, true);
  assert.equal(inboxOf(t).hidden, true, "it did not reopen");
  assert.equal(t.today.openInbox(pill), true, "a later click opens it");
  assert.equal(inboxOf(t).hidden, false);
  // A press elsewhere closes it, a press inside does not.
  const outside = t.document.createElement("div");
  for (const callback of t.body.listeners.pointerdown ?? []) callback({ target: inboxOf(t).querySelector(".today-inbox-head") });
  assert.equal(inboxOf(t).hidden, false, "inside: stays");
  for (const callback of t.body.listeners.pointerdown ?? []) callback({ target: outside });
  assert.equal(inboxOf(t).hidden, true, "outside: closes");
});

test("the popover sits under its pill and inside the free area, and follows a resize", async () => {
  const t = await loadToday({ data: board({ needs: [needQuestion()] }) });
  const pill = t.document.createElement("button");
  pill.getBoundingClientRect = () => ({ left: 900, right: 1040, top: 10, bottom: 42, width: 140, height: 32 });
  t.today.openInbox(pill); await t.settle();
  const node = inboxOf(t);
  assert.equal(node.style.width, "452px");
  assert.equal(node.style.top, "50px", "eight pixels under the pill");
  assert.equal(node.style.left, `${1040 - 452}px`, "its right edge on the pill's");
  assert.equal(node.style.maxHeight, `${700 - 50 - 12}px`, "and never past the bottom of the free area");
  // Anchored far right: pulled back inside the free area (right edge 1100).
  pill.getBoundingClientRect = () => ({ left: 1150, right: 1290, top: 10, bottom: 42, width: 140, height: 32 });
  t.window.dispatchEvent({ type: "resize" }); await t.settle();
  assert.equal(node.style.left, `${1100 - 452 - 12}px`);
  // A narrow window: the popover shrinks to fit, never wider than the free area.
  t.nav.usable = () => ({ left: 64, top: 56, right: 400, bottom: 560, width: 336, height: 504 });
  t.window.dispatchEvent({ type: "resize" }); await t.settle();
  assert.equal(node.style.width, "312px", "the free area less a gutter on each side");
  assert.equal(Number.parseInt(node.style.left, 10) >= 64 + 12, true);
  // No pill at all: the top right of the free area. With one seen before, Ctrl J and the rest open under it.
  t.today.closeInbox(); t.nav.usable = () => ({ left: 0, top: 40, right: 1000, bottom: 700, width: 1000, height: 660 });
  t.today.openInbox(null); await t.settle();
  assert.equal(inboxOf(t).style.top, "50px", "the pill it was opened from last is remembered");
  // A pill low in the window (the status bar's "waiting on you") opens it upward, never pushed off the bottom.
  const low = await loadToday({ data: board({ needs: [needQuestion()] }) });
  low.nav.usable = () => ({ left: 64, top: 56, right: 1100, bottom: 760, width: 1036, height: 704 });
  const status = low.document.createElement("button");
  status.getBoundingClientRect = () => ({ left: 300, right: 420, top: 768, bottom: 792, width: 120, height: 24 });
  low.today.openInbox(status); await low.settle();
  assert.equal(inboxOf(low).style.bottom, "40px", "its bottom edge eight pixels above the status bar item");
  assert.equal(inboxOf(low).style.top, "");
  assert.equal(inboxOf(low).dataset.side, "above");
  assert.equal(inboxOf(low).style.left, `${64 + 12}px`, "right edge on the item's would leave the window: pulled inside the free area");
  assert.equal(Number.parseInt(inboxOf(low).style.maxHeight, 10) <= 768 - 8 - 56, true, "and never taller than the room above it");
  low.today.closeInbox(); low.today.openInbox(pill); await low.settle();
  assert.equal(inboxOf(low).style.bottom, "", "moved back under a pill that has room");
  assert.equal(inboxOf(low).dataset.side, "below");
  const bare = await loadToday({ data: board({ needs: [needQuestion()] }) });
  bare.nav.usable = () => ({ left: 0, top: 40, right: 1000, bottom: 700, width: 1000, height: 660 });
  bare.today.openInbox(null); await bare.settle();
  assert.equal(inboxOf(bare).style.top, "48px");
  assert.equal(inboxOf(bare).style.left, `${1000 - 452 - 12}px`);
});

test("a need raised anywhere opens the Inbox on it: by kind and id, and when it has not arrived yet", async () => {
  const t = await loadToday({ data: board({ needs: [needQuestion(), needApproval(), needBlocked()] }) });
  assert.equal(t.today.openNeed({ kind: "approval", id: "t5" }), true);
  await t.settle();
  const current = () => inboxOf(t).querySelectorAll(".today-need").find((card) => card.className.includes("is-current"))?.dataset.key;
  assert.equal(current(), "approval:t5");
  assert.equal(t.today.openNeed("q1"), true, "a bare string is a question's id");
  await t.settle();
  assert.equal(current(), "question:q1");
  // An id the page has not heard of yet: the Inbox opens, the page reads, and lands on it.
  const late = needQuestion({ id: "q7", title: "A question that just arrived", context: { taskId: "t7", taskTitle: "New" } });
  t.window.MefiVibe.refresh = async () => { t.vibe.refreshes += 1; await t.push(board({ needs: [needQuestion(), late] })); };
  assert.equal(t.today.openNeed({ kind: "question", id: "q7" }), true);
  await t.settle();
  assert.equal(current(), "question:q7", "focused once it is known");
  // A plan is not in the Inbox: its own page opens.
  assert.equal(t.today.openNeed({ kind: "plan", id: "pl1" }), true);
  assert.deepEqual(t.nav.gone.at(-1), ["plans", { planId: "pl1" }]);
});

test("a click on a Windows notification: a burst opens the Inbox, one thing its task, a question with no task that question", async () => {
  const tabs = [];
  const t = await loadToday({ data: board({ needs: [needBlocked(), needQuestion()] }), extras: { MefiTabs: { open: (...args) => tabs.push(plain(args)) } } });
  assert.equal(t.today.openFromAlert({ kind: "test", id: null }), false, "the test notification is alerts.js's own: it just leaves Studio in front");
  assert.equal(t.today.openFromAlert({ kind: "need", id: "a", taskId: "ta", projectId: "p1", count: 3 }), true);
  await t.settle();
  assert.equal(inboxOf(t).hidden, false, "several: the Inbox");
  assert.deepEqual(tabs, []);
  t.today.closeInbox();
  assert.equal(t.today.openFromAlert({ kind: "fail", id: "t6", taskId: "t6", projectId: "p1" }), true);
  assert.deepEqual(tabs, [["tasks", { taskId: "t6", projectId: "p1", filter: "all" }, { preview: true }]], "one thing: its task, in the project it belongs to");
  assert.equal(inboxOf(t).hidden, true);
  assert.equal(t.today.openFromAlert({ kind: "fail", id: "t6", taskId: "t6", projectId: "p1", count: 1 }), true, "a count of one is one thing");
  assert.equal(tabs.length, 2);
  assert.equal(inboxOf(t).hidden, true);
  assert.equal(t.today.openFromAlert({ kind: "need", id: "q1", taskId: null, projectId: "p1" }), true);
  await t.settle();
  assert.equal(inboxOf(t).hidden, false, "a question about no task: the Inbox, on that question");
  assert.equal(inboxOf(t).querySelectorAll(".today-need").find((card) => card.className.includes("is-current")).dataset.key, "question:q1");
  t.today.closeInbox();
  assert.equal(t.today.openFromAlert({}), true, "a click that names nothing still lands on the Inbox");
  assert.equal(inboxOf(t).hidden, false);
  const off = await loadToday({ layout: null });
  assert.equal(off.today.openFromAlert({ kind: "need", taskId: "t1", count: 3 }), false, "in v1 alerts.js does what it always did");
});

test("the Inbox says what Mefi decided for you, with the Undo the app offers", async () => {
  const decisions = [
    { id: "d0", label: "Retried the sidebar fix", reason: "...", at: NOW - 60000, undone: NOW },
    { id: "d1", label: "Kept the oldest card", reason: "...", at: NOW - 50000 },
    { id: "d2", label: "Merged a duplicate", reason: "...", at: NOW - 40000 },
    { id: "d3", label: "Not applied", failed: true },
  ];
  const t = await loadToday({ data: board({ needs: [needQuestion()] }), extras: { MefiAutonomy: { state: () => ({ projectId: "p1", level: "auto", decisions }), refresh: async () => {} } } });
  await open(t);
  const foot = inboxOf(t).querySelector(".today-inbox-foot");
  assert.equal(foot.hidden, false);
  assert.match(foot.textContent, /^Mefi decided · Merged a duplicateUndoAll 2$/, "the newest that applied, and how many there are");
  await press(t, buttonNamed(foot, "Undo"));
  assert.deepEqual(t.callsOf("autonomyUndo"), [{ id: "d2", projectId: "p1" }]);
  // Another project's decisions are not this project's.
  const other = await loadToday({ data: board({ needs: [needQuestion()] }), extras: { MefiAutonomy: { state: () => ({ projectId: "p9", decisions }) } } });
  await open(other);
  assert.equal(inboxOf(other).querySelector(".today-inbox-foot").hidden, true);
  const none = await loadToday({ data: board({ needs: [needQuestion()] }) });
  await open(none);
  assert.equal(inboxOf(none).querySelector(".today-inbox-foot").hidden, true, "no decisions, no line");
});

test("Open as a tab keeps the list open as a page, through the registry", async () => {
  const t = await loadToday({ data: board({ needs: [needQuestion()] }) });
  await open(t);
  await press(t, inboxOf(t).querySelector('[data-act="page"]'));
  assert.equal(inboxOf(t).hidden, true);
  assert.deepEqual(t.nav.claimed, ["inbox"]);
  const overlay = t.get("inbox-overlay");
  assert.equal(overlay.hidden, false);
  assert.match(t.get("inbox-lead").textContent, /^1 thing waits on you\.$/);
  assert.equal(t.get("inbox-list").querySelectorAll(".today-need").length, 1);
  assert.equal(t.get("inbox-empty").hidden, true);
  // The same card, the same call, the same Decided line.
  await press(t, t.get("inbox-list").querySelector('[data-option="yes"]'));
  assert.deepEqual(t.callsOf("assistantAnswer"), [{ id: "q1", optionId: "yes", projectId: "p1" }]);
  assert.match(t.get("inbox-lead").textContent, /^Nothing is waiting on you\.$/);
  // Close goes through the nav so its history stays right.
  await t.get("inbox-close").click();
  assert.deepEqual(t.nav.closed, ["inbox"]);
  t.today.closeInboxPage();
  assert.deepEqual(t.nav.released, ["inbox"]);
  assert.equal(overlay.hidden, true);
  // Nothing waiting: the page says so.
  const empty = await loadToday({ data: board() });
  empty.today.openInboxPage(); await empty.settle();
  assert.equal(empty.get("inbox-empty").hidden, false);
  assert.equal(empty.get("inbox-list").hidden, true);
  // The decided-for-you history is the one Vibe's panel shows.
  const history = [];
  const withHistory = await loadToday({ data: board(), extras: { MefiAutonomy: { state: () => ({ projectId: "p1", decisions: [{ id: "d1", label: "Kept the oldest" }] }), history: (root, data) => history.push([root.id, data.projectId]) } } });
  withHistory.today.openInboxPage(); await withHistory.settle();
  assert.deepEqual(history, [["inbox-decided", "p1"]]);
});

test("the routes are there for Search, Shortcuts and the tab strip, and Ctrl J is on the sheet as a chord", async () => {
  const t = await loadToday();
  const inbox = t.nav.registered.find((record) => record.id === "inbox");
  assert.deepEqual([inbox.label, inbox.kind, inbox.layer, inbox.element, inbox.showIn.palette, inbox.showIn.help, inbox.showIn.tabs, inbox.showIn.tools], ["Inbox", "overlay", "sheet", "inbox-overlay", true, true, false, false]);
  assert.equal(inbox.isOpen(), false);
  inbox.open({}); await t.settle();
  assert.equal(inbox.isOpen(), true);
  inbox.close();
  assert.equal(inbox.isOpen(), false);
  const action = t.nav.registered.find((record) => record.id === "inbox-open");
  assert.equal(action.chord, "Ctrl J");
  assert.equal(action.keyMatch({ key: "j" }), false, "the registry's own key loop never takes it: the chord is handled before it");
  action.run(); await t.settle();
  assert.equal(inboxOf(t).hidden, false);
});

test("an answer that lands after the project changed decides nothing in the new project", async () => {
  let release = null;
  const slow = new Promise((resolve) => { release = resolve; });
  const t = await loadToday({ data: board({ needs: [needQuestion()] }), bridge: { assistantAnswer: () => slow } });
  await open(t);
  cardOf(t, "question:q1").querySelector('[data-option="yes"]').click(); await t.settle();
  assert.equal(cardOf(t, "question:q1").getAttribute("aria-busy"), "true", "in flight");
  // The other project has a question with the very same id.
  await t.push(board({ projectId: "p2", projectName: "Other", needs: [needQuestion()] }));
  t.window.dispatchEvent({ type: "mefi:project-changed", detail: { projectId: "p2" } }); await t.settle();
  release({ ok: true }); await t.settle();
  assert.equal(t.today.count(), 1, "the other project's question still waits on you");
  assert.ok(cardOf(t, "question:q1").querySelector(".today-need-options"), "as a card, not a decided line");
  assert.equal(t.vibe.refreshes, 0, "and nothing is re-read for an answer that belongs to a project that is gone");
});

test("a decided line keeps its place when the host's push reaches the page before its reply does", async () => {
  let t = null;
  const after = board({ needs: [needApproval(), needBlocked()] });
  t = await loadToday({ data: board({ needs: [needQuestion(), needApproval(), needBlocked()] }), bridge: { assistantAnswer: async () => { await t.push(after); return { ok: true }; } } });
  await open(t);
  await press(t, cardOf(t, "question:q1").querySelector('[data-option="yes"]'));
  assert.deepEqual(inboxOf(t).querySelectorAll(".today-need").map((card) => card.dataset.key), ["question:q1", "approval:t5", "blocked:t6"], "the question was first, so its Decided line is first, not sent to the end");
  assert.match(words(cardOf(t, "question:q1")), /^Decided · Answered: Yes, ignore case/);
  assert.equal(t.today.count(), 2);
});
