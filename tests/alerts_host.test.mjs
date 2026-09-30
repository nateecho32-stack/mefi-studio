// scripts/alerts-host.cjs over stubs (tests/fixtures/alerts-host.mjs): a fake
// clock and timers, a Notification class that records what was shown and can be
// clicked, a window that records its flash and its taskbar count. The real
// rules and the real icon run. The story it pins: a question waits twenty
// seconds and is told only if it is still waiting, a burst is one notification,
// nothing is shown while Studio is being looked at or inside quiet hours, a
// click brings the window up and says what was clicked, the test waits for the
// owner to look away, the count follows what waits on the owner, and every
// failure is swallowed and logged by code, never by path.
//
// Run: node --test tests/alerts_host.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { MINUTE, SECOND, world } from "./fixtures/alerts-host.mjs";

const digestOf = (...ids) => ({ total: ids.length, items: ids.map((id) => ({ kind: "question", questionId: id, taskId: `task_${id}` })) });

test("after start, one look reads the digest and draws the count on the taskbar icon: 16 px, or 32 px on a scaled display", async () => {
  const t = world({ digest: digestOf("a", "b") });
  await t.host.start();
  assert.deepEqual(t.overlays(), [], "nothing before the first look");
  await t.advance(3 * SECOND);
  assert.deepEqual(t.overlays(), [["overlay", { width: 16, bytes: t.overlays()[0][1].bytes }, "2 waiting on you"]]);
  const big = world({ digest: digestOf("a"), scale: 2 });
  await big.host.start();
  await big.advance(3 * SECOND);
  assert.equal(big.overlays()[0][1].width, 32, "a 200% display gets the large picture");
  const linux = world({ digest: digestOf("a"), platform: "linux" });
  await linux.host.start();
  await linux.advance(3 * SECOND);
  assert.deepEqual(linux.overlays(), [], "only Windows has an overlay icon");
  assert.equal(linux.w.digestCalls, 1, "but it still looked");
});

test("the count follows what waits: it changes when the digest does, is not set twice, and clears at zero", async () => {
  const t = world({ digest: digestOf("a") });
  await t.host.start();
  await t.advance(3 * SECOND);
  t.w.digest = digestOf("a", "b", "c");
  t.host.poke();
  await t.advance(10 * SECOND);
  t.host.poke();
  await t.advance(10 * SECOND);
  t.w.digest = { total: 0, items: [] };
  t.host.poke();
  await t.advance(10 * SECOND);
  assert.deepEqual(t.overlays().map((call) => call[2]), ["1 waiting on you", "3 waiting on you", ""], "one call per change, and an empty one to clear it");
  assert.equal(t.overlays()[2][1], null, "the overlay is cleared, not drawn with a zero");
  // The count is of what waits, not of what the digest lists (it lists a dozen).
  const many = world({ digest: { total: 150, items: [] } });
  await many.host.start();
  await many.advance(3 * SECOND);
  assert.equal(many.overlays()[0][2], "99 waiting on you");
});

test("the count has its own switch and follows the master switch; with both off nothing is drawn", async () => {
  const noBadge = world({ settings: { alerts: { badge: false } }, digest: digestOf("a") });
  await noBadge.host.start();
  await noBadge.advance(3 * SECOND);
  assert.deepEqual(noBadge.overlays(), []);
  const off = world({ settings: { alerts: { on: false } }, digest: digestOf("a") });
  await off.host.start();
  await off.advance(3 * SECOND);
  assert.deepEqual(off.overlays(), []);
  assert.equal(off.w.digestCalls, 0, "with the master switch off it does not even look");
  assert.deepEqual(off.w.timers, [], "and arms nothing");
});

test("a question is told to Windows only after it has waited, in generic words, with the taskbar flashing", async () => {
  const t = world({ digest: digestOf("q1") });
  await t.host.start();
  await t.advance(3 * SECOND);
  assert.equal(t.w.digestCalls, 1, "the start's look");
  assert.equal(t.host.question(t.ask()), true);
  await t.advance(19 * SECOND);
  assert.equal(t.w.shown.length, 0, "nothing for the first twenty seconds: the assistant may answer it itself");
  assert.equal(t.w.digestCalls, 1, "and no look at the board for it before then");
  await t.advance(2 * SECOND);
  assert.equal(t.w.shown.length, 1);
  assert.equal(t.w.digestCalls, 2, "one look, when it came due");
  const [note] = t.w.shown;
  assert.deepEqual([note.options.title, note.options.body, note.options.silent], ["Something needs you", "A task is waiting for your answer.", true]);
  assert.ok(!JSON.stringify(note.options).includes("Search notes by tag"), "a task's title never travels by default");
  assert.deepEqual(note.options.icon, { file: "/app/assets/icon-256.png", isEmpty: note.options.icon.isEmpty }, "it carries Studio's icon");
  assert.deepEqual(t.flashes(), [true]);
  assert.ok(t.w.logs.includes("[alerts] told Windows: need (1)"));
  assert.ok(t.w.logs.every((line) => !line.includes("Search notes") && !line.includes("#Work")), "the log names no titles");
});

test("task titles travel only when the owner chose them", async () => {
  const t = world({ settings: { alerts: { titles: "titles", sound: true } }, digest: digestOf("q1") });
  await t.host.start();
  t.host.question(t.ask());
  await t.advance(21 * SECOND);
  assert.deepEqual([t.w.shown[0].options.title, t.w.shown[0].options.body, t.w.shown[0].options.silent], ["Something needs you", "Search notes by tag: Should #Work and #work count as the same tag?", false]);
});

test("a click brings the window up first, stops the flash and says what was clicked", async () => {
  const t = world({ digest: digestOf("q1") });
  await t.host.start();
  t.host.question(t.ask());
  await t.advance(21 * SECOND);
  t.w.calls.length = 0;
  t.w.shown[0].emit("click");
  assert.deepEqual(t.w.calls, [["showWindow"], ["flash", false], ["send", { kind: "need", id: "t1", taskId: "t1", projectId: "project_a" }]], "a question about a task is told by its task, and a click opens the task");
  assert.deepEqual(t.w.opened, [{ kind: "need", id: "t1", taskId: "t1", projectId: "project_a" }]);
  // Coming to the front by any other way ends the flash too.
  t.w.calls.length = 0;
  t.host.focus();
  assert.deepEqual(t.w.calls, [["flash", false]]);
});

test("a question about no task is told by its own id, and a click with no task opens nothing in particular", async () => {
  const t = world({ digest: digestOf("q5") });
  await t.host.start();
  t.host.question(t.ask({ id: "q5", context: {} }));
  await t.advance(21 * SECOND);
  t.w.shown[0].emit("click");
  assert.deepEqual(t.w.opened.at(-1), { kind: "need", id: "q5", taskId: null, projectId: "project_a" });
});

test("a task is one thing to tell however many questions and events name it", async () => {
  const t = world({ digest: { total: 1, items: [{ kind: "parked", taskId: "t9" }] } });
  await t.host.start();
  t.host.question(t.ask({ id: "qa", context: { issueKind: "check-failed", taskId: "t9", taskTitle: "Fix login" } }));
  t.host.question(t.ask({ id: "qb", context: { issueKind: "run-failed", taskId: "t9", taskTitle: "Fix login" } }));
  t.host.tasks([{ kind: "parked", taskId: "t9", title: "Fix login" }], [], "project_a");
  await t.advance(25 * SECOND);
  assert.equal(t.w.shown.length, 1, "the parked task and the two questions about it are one notification");
  assert.deepEqual([t.w.shown[0].options.title, t.w.shown[0].options.body], ["A task needs you", "Checks failed. Open Studio to decide what happens next."], "about one task, not three");
  // A permission asked about the same task is another kind, so another thing.
  t.host.question(t.ask({ id: "qp", context: { issueKind: "permission", taskId: "t9", taskTitle: "Fix login" } }));
  await t.advance(25 * SECOND);
  assert.equal(t.w.shown.length, 2);
  assert.equal(t.w.shown[1].options.title, "A permission is needed");
});

test("two questions about one task: when the first is answered the second is still told", async () => {
  const t = world({ digest: digestOf("qa", "qb"), open: new Set(["qa", "qb"]) });
  await t.host.start();
  t.host.question(t.ask({ id: "qa" }));
  t.host.question(t.ask({ id: "qb" }));
  t.w.openQuestions = new Set(["qb"]); // the first was answered, the second is still waiting
  await t.advance(25 * SECOND);
  assert.equal(t.w.shown.length, 1, "the owner still hears that something waits");
});

test("a question the assistant answers itself in the meantime never pings", async () => {
  const t = world({ digest: digestOf("q1"), open: new Set(["q1"]) });
  await t.host.start();
  t.host.question(t.ask());
  await t.advance(10 * SECOND);
  t.w.openQuestions = new Set(); // answered
  await t.advance(30 * SECOND);
  assert.deepEqual(t.w.shown, []);
  assert.deepEqual(t.flashes(), []);
});

test("nothing is shown while Studio is being looked at, and what waited through it is not told afterwards", async () => {
  const t = world({ digest: digestOf("q1") });
  await t.host.start();
  t.w.looked = true;
  t.host.question(t.ask());
  await t.advance(25 * SECOND);
  assert.equal(t.w.shown.length, 0, "Studio was in front when it came due");
  assert.deepEqual(t.flashes(), []);
  t.w.looked = false;
  await t.advance(3 * MINUTE);
  assert.equal(t.w.shown.length, 0, "the inbox has it; Windows is not told late");
  // The next thing, with Studio away, is told.
  t.host.question(t.ask({ id: "q2" }));
  await t.advance(21 * SECOND);
  assert.equal(t.w.shown.length, 1);
});

test("quiet hours are the Discord remote's: nothing inside them (across midnight), the count still shows, and leaving them re-opens the door", async () => {
  const t = world({ settings: { remote: { quiet: { from: "22:00", to: "07:00" } } }, digest: digestOf("q1") });
  await t.host.start();
  t.w.minute = 23 * 60 + 30;
  t.host.question(t.ask());
  await t.advance(21 * SECOND);
  assert.equal(t.w.shown.length, 0);
  assert.equal(t.overlays().at(-1)[2], "1 waiting on you", "the count is not quiet");
  t.w.minute = 2 * 60;
  t.host.question(t.ask({ id: "q2" }));
  await t.advance(21 * SECOND);
  assert.equal(t.w.shown.length, 0, "after midnight");
  t.w.minute = 7 * 60;
  t.host.question(t.ask({ id: "q3" }));
  await t.advance(21 * SECOND);
  assert.equal(t.w.shown.length, 1, "at seven the quiet is over");
});

test("a burst of questions is one notification that says how many", async () => {
  const t = world({ digest: digestOf("a", "b", "c") });
  await t.host.start();
  t.host.question(t.ask({ id: "a", context: {} }));
  await t.advance(1 * SECOND);
  t.host.question(t.ask({ id: "b", context: {} }));
  await t.advance(2 * SECOND);
  t.host.question(t.ask({ id: "c", context: {} }));
  await t.advance(20 * SECOND);
  assert.equal(t.w.shown.length, 1);
  assert.deepEqual([t.w.shown[0].options.title, t.w.shown[0].options.body], ["Something needs you", "3 things are waiting for you."]);
  t.w.calls.length = 0;
  t.w.shown[0].emit("click");
  assert.equal(t.w.opened[0].id, "a", "a click goes to the first of them");
  assert.equal(t.w.logs.filter((line) => line.startsWith("[alerts] told")).length, 1);
});

test("a permission, a failed check and a plain question are told as what they are; a suggestion and a note are not told", async () => {
  const t = world({ digest: digestOf("p", "f", "n", "s", "x") });
  await t.host.start();
  t.host.question(t.ask({ id: "p", context: { issueKind: "permission" } }));
  t.host.question(t.ask({ id: "f", context: { issueKind: "check-failed", taskId: "t2" } }));
  t.host.question(t.ask({ id: "n", context: { issueKind: "scope" } }));
  t.host.question(t.ask({ id: "s", kind: "suggestion" }));
  t.host.question(t.ask({ id: "x", context: { severity: "note" } }));
  await t.advance(21 * SECOND);
  assert.deepEqual(t.w.shown.map((note) => note.options.title), ["Something needs you", "A permission is needed", "A task needs you"], "a question, then a permission, then a failure");
  assert.equal(t.w.shown.length, 3);
});

test("the same thing is not told twice for fifteen minutes; later it may be", async () => {
  const t = world({ digest: digestOf("q1") });
  await t.host.start();
  t.host.question(t.ask());
  await t.advance(21 * SECOND);
  assert.equal(t.w.shown.length, 1);
  await t.advance(5 * MINUTE);
  t.host.question(t.ask());
  await t.advance(25 * SECOND);
  assert.equal(t.w.shown.length, 1, "asked about again five minutes on: not told twice");
  await t.advance(11 * MINUTE);
  t.host.question(t.ask());
  await t.advance(25 * SECOND);
  assert.equal(t.w.shown.length, 2, "sixteen minutes on it may be told again");
});

test("at most twelve an hour; the inbox has the rest; the hour rolls on", async () => {
  const t = world({ digest: digestOf("q0") });
  await t.host.start();
  for (let index = 0; index < 14; index += 1) {
    t.host.question(t.ask({ id: `q${index}`, context: {} }));
    await t.advance(21 * SECOND);
    await t.advance(20 * SECOND);
  }
  assert.equal(t.w.shown.length, 12, "the thirteenth and fourteenth were not sent");
  const state = await t.host.state();
  assert.deepEqual(state.hour, { sent: 12, max: 12 });
  await t.advance(61 * MINUTE);
  t.host.question(t.ask({ id: "later", context: {} }));
  await t.advance(25 * SECOND);
  assert.equal(t.w.shown.length, 13, "an hour on, it may send again");
});

test("a parked task is a failure, a task that waits for approval is a need, a finished one is told only when that is switched on", async () => {
  const t = world({ digest: { total: 2, items: [{ kind: "parked", taskId: "t9" }, { kind: "approval", taskId: "t8" }] } });
  await t.host.start();
  t.host.tasks([{ kind: "parked", taskId: "t9", title: "Fix the login flow" }, { kind: "verified", taskId: "t7", title: "Dark mode" }, { kind: "retrying", taskId: "t6", title: "x" }], [{ kind: "needs-approval", taskId: "t8", title: "Add tags" }], "project_b");
  await t.advance(25 * SECOND);
  assert.deepEqual(t.w.shown.map((note) => note.options.title), ["Something needs you", "A task needs you"], "a need and a failure; the finished one is off by default; a retry is nothing");
  t.w.calls.length = 0;
  t.w.shown[1].emit("click");
  assert.deepEqual(t.w.opened.at(-1), { kind: "fail", id: "t9", taskId: "t9", projectId: "project_b" }, "a click on a task opens it in the project it belongs to");
  const done = world({ settings: { alerts: { done: true } }, digest: { total: 0, items: [] } });
  await done.host.start();
  done.host.tasks([{ kind: "verified", taskId: "t7", title: "Dark mode" }, { kind: "done", taskId: "t7", title: "Dark mode" }], [], null);
  await done.advance(25 * SECOND);
  assert.deepEqual(done.w.shown.map((note) => [note.options.title, note.options.body]), [["A task is ready", "Open Studio to review it."]], "verified and done are one thing");
});

test("a task that is no longer waiting when it comes due is not told; one the digest cannot list is", async () => {
  const gone = world({ digest: { total: 0, items: [] } });
  await gone.host.start();
  gone.host.tasks([{ kind: "parked", taskId: "t9", title: "x" }], [], null);
  await gone.advance(25 * SECOND);
  assert.deepEqual(gone.w.shown, [], "the owner already dealt with it");
  const crowded = world({ digest: { total: 30, items: [{ kind: "question", questionId: "z", taskId: "tz" }] } });
  await crowded.host.start();
  crowded.host.tasks([{ kind: "parked", taskId: "t9", title: "x" }], [], null);
  await crowded.advance(25 * SECOND);
  assert.equal(crowded.w.shown.length, 1, "the digest lists a dozen, so an absent one may only be out of sight");
  const blind = world({ digest: new Error("board unreadable") });
  await blind.host.start();
  blind.host.tasks([{ kind: "parked", taskId: "t9", title: "x" }], [], null);
  await blind.advance(25 * SECOND);
  assert.equal(blind.w.shown.length, 1, "an unreadable board does not cancel what the event said");
});

test("the test notification: sent at once when Studio is away, even in quiet hours, and not counted toward the hour", async () => {
  const t = world({ settings: { remote: { quiet: { from: "22:00", to: "07:00" } } } });
  t.w.minute = 23 * 60;
  const result = await t.host.test();
  assert.deepEqual(result, { ok: true, sent: true, why: "" });
  assert.deepEqual([t.w.shown[0].options.title, t.w.shown[0].options.body], ["Test notification", "Alerts are working. Nothing needs you."]);
  assert.deepEqual(t.flashes(), [true]);
  t.w.shown[0].emit("click");
  assert.deepEqual(t.w.opened.at(-1), { kind: "test", id: null, taskId: null, projectId: null }, "a click on it just brings Studio up");
  assert.deepEqual((await t.host.state()).hour, { sent: 0, max: 12 });
  for (let index = 0; index < 15; index += 1) await t.host.test();
  assert.equal(t.w.shown.length, 16, "no cap on the test");
});

test("the test waits for the owner to look away, because nothing is sent to a window being looked at; then it is sent", async () => {
  const t = world({ looked: true });
  const pending = t.host.test();
  await t.tick();
  await t.advance(5 * SECOND);
  assert.equal(t.w.shown.length, 0);
  t.host.away(); // a blur that did not take Studio out of view
  assert.equal(t.w.shown.length, 0);
  t.w.looked = false;
  t.host.away();
  assert.deepEqual(await pending, { ok: true, sent: true, why: "" });
  assert.equal(t.w.shown.length, 1);
  assert.deepEqual(t.w.timers.filter((timer) => timer.at > t.w.now + 30 * SECOND), [], "the wait's timer is gone");
});

test("the test stops waiting after a minute, and a second test replaces the first", async () => {
  const t = world({ looked: true });
  const first = t.host.test();
  await t.tick(); // it has read the settings and is waiting
  await t.advance(60 * SECOND);
  assert.deepEqual(await first, { ok: true, sent: false, waited: true, why: "Studio stayed in front, so no test notification was sent." });
  const second = t.host.test();
  await t.tick();
  await t.advance(1 * SECOND);
  const third = t.host.test();
  await t.tick();
  assert.deepEqual(await second, { ok: true, sent: false, superseded: true, why: "Another test replaced this one." });
  t.w.looked = false;
  t.host.away();
  assert.equal((await third).sent, true);
  assert.equal(t.w.shown.length, 1);
});

test("the test says why when alerts are off, and does nothing when the environment turned them off", async () => {
  const off = world({ settings: { alerts: { on: false } }, looked: true });
  assert.deepEqual(await off.host.test(), { ok: true, sent: false, why: "Windows notifications are off in Settings › Notifications." }, "no waiting for a notification that cannot go");
  const killed = world({ env: { MEFI_STUDIO_NO_ALERTS: "1" } });
  const result = await killed.host.test();
  assert.deepEqual([result.ok, result.killed, result.sent], [false, true, false]);
  assert.match(result.why, /MEFI_STUDIO_NO_ALERTS/);
  assert.deepEqual(killed.w.shown, []);
  const none = world({ supported: false });
  assert.deepEqual(await none.host.test(), { ok: false, sent: false, why: "Windows could not show it." });
});

test("the kill switch: nothing is watched, queued, shown, flashed or drawn, and the card can say so", async () => {
  const t = world({ env: { MEFI_STUDIO_NO_ALERTS: "1" }, digest: digestOf("q1") });
  await t.host.start();
  assert.equal(t.host.question(t.ask()), false);
  assert.equal(t.host.tasks([{ kind: "parked", taskId: "t9", title: "x" }], [], null), false);
  t.host.poke();
  await t.advance(5 * MINUTE);
  assert.deepEqual([t.w.shown, t.w.calls, t.w.digestCalls], [[], [], 0]);
  assert.deepEqual(t.w.timers, [], "not one timer");
  const state = await t.host.state();
  assert.equal(state.killed, true);
  assert.equal(state.prefs.on, true, "the saved choice is untouched: the environment wins for this session");
});

test("the master switch: turning it off clears the count and the flash and forgets what was waiting", async () => {
  const t = world({ digest: digestOf("q1") });
  await t.host.start();
  t.host.question(t.ask());
  await t.advance(3 * SECOND);
  assert.equal(t.overlays().at(-1)[2], "1 waiting on you");
  await t.host.set({ on: false });
  assert.equal(t.overlays().at(-1)[1], null, "the count is cleared");
  assert.ok(t.flashes().includes(false), "and the flash stopped");
  await t.advance(3 * MINUTE);
  assert.deepEqual(t.w.shown, [], "what was waiting is not told after all");
  await t.host.set({ on: true });
  await t.advance(15 * SECOND);
  assert.equal(t.overlays().at(-1)[2], "1 waiting on you", "and back on it is drawn again");
});

test("turning the master switch off forgets what was waiting, even when it is turned on again before anything looked", async () => {
  const t = world({ digest: digestOf("q1") });
  await t.host.start();
  t.host.question(t.ask());
  await t.advance(5 * SECOND);
  await t.host.set({ on: false });
  await t.host.set({ on: true });
  await t.advance(45 * SECOND);
  assert.deepEqual(t.w.shown, [], "it came up while alerts were off for a moment: it is not told now");
  t.host.question(t.ask({ id: "q2", context: {} }));
  await t.advance(25 * SECOND);
  assert.equal(t.w.shown.length, 1, "what comes up after that is");
});

test("a thing that is already waiting keeps its place: asking again does not start its twenty seconds over", async () => {
  const t = world({ digest: digestOf("q1") });
  await t.host.start();
  assert.equal(t.host.question(t.ask()), true);
  await t.advance(15 * SECOND);
  assert.equal(t.host.question(t.ask()), false, "already waiting");
  assert.equal(t.host.tasks([{ kind: "parked", taskId: "t9", title: "x" }], [], null), true);
  assert.equal(t.host.tasks([{ kind: "parked", taskId: "t9", title: "x" }], [], null), false, "a task is one wait too");
  await t.advance(6 * SECOND);
  assert.equal(t.w.shown.length, 1, "told twenty seconds after the first time it came up, not after the last");
});

test("a board that floods the queue keeps the newest two hundred, and one notification says how many", async () => {
  const t = world({ digest: { total: 300, items: [] } });
  await t.host.start();
  const events = Array.from({ length: 250 }, (_, index) => ({ kind: "parked", taskId: `t${index}`, title: `Task ${index}` }));
  assert.equal(t.host.tasks(events, [], "project_a"), true);
  await t.advance(25 * SECOND);
  assert.equal(t.w.shown.length, 1);
  assert.equal(t.w.shown[0].options.body, "200 tasks need a decision. Open Studio to see them.", "the oldest fifty fell out of the queue");
  t.w.shown[0].emit("click");
  assert.equal(t.w.opened.at(-1).id, "t50", "a click goes to the oldest one still in it");
});

test("alerts:set validates what it is given, saves only what changed and answers with the state", async () => {
  const t = world();
  const first = await t.host.set({ done: true, flash: false, need: "no", bogus: 1, titles: "titles" });
  assert.deepEqual(t.w.settings.alerts, { on: true, need: true, fail: true, done: true, flash: false, badge: true, sound: false, titles: "titles" });
  assert.deepEqual(first.prefs, t.w.settings.alerts);
  assert.equal(first.ok, true);
  assert.deepEqual(first.quiet, { on: false, from: "22:00", to: "07:00" });
  const before = JSON.stringify(t.w.settings);
  const writes = t.w.writes;
  assert.equal(writes, 1, "the first change was one write");
  await t.host.set({ done: true });
  await t.host.set({ nonsense: 5 });
  await t.host.set(null);
  await t.host.set("x");
  assert.equal(JSON.stringify(t.w.settings), before, "nothing changed, nothing written");
  assert.equal(t.w.writes, writes, "and the file was not even saved again: settings.json is written only when a choice changed");
  const again = world({ settings: { projects: [], alerts: { need: false } } });
  await again.host.set({ fail: false });
  assert.deepEqual(again.w.settings.projects, [], "the rest of the settings are left alone");
  assert.equal(again.w.settings.alerts.need, false);
});

test("quiet hours are written to the remote's own setting, and the remote's card is told", async () => {
  const t = world({ settings: { remote: { on: true, name: "Studio PC", quiet: null } } });
  const state = await t.host.set({ quiet: { on: true, from: "23:00", to: "06:30" } });
  assert.deepEqual(t.w.settings.remote, { on: true, name: "Studio PC", quiet: { from: "23:00", to: "06:30" } }, "only the quiet hours of the remote's settings changed");
  assert.deepEqual(state.quiet, { on: true, from: "23:00", to: "06:30" });
  assert.equal(t.w.remotePushes, 1);
  assert.equal(t.w.settings.alerts, undefined, "and no second copy in the alerts settings");
  await t.host.set({ quiet: { from: "22:00" } });
  assert.deepEqual(t.w.settings.remote.quiet, { from: "22:00", to: "06:30" }, "a time alone moves a window that is on");
  await t.host.set({ quiet: { on: true, from: "22:00" } });
  assert.equal(t.w.remotePushes, 2, "no change, no push");
  await t.host.set({ quiet: { on: false } });
  assert.equal(t.w.settings.remote.quiet, null);
  assert.equal(t.w.remotePushes, 3);
  const bare = world();
  await bare.host.set({ quiet: { on: true } });
  assert.deepEqual(bare.w.settings, { remote: { quiet: { from: "22:00", to: "07:00" } } }, "with no remote settings at all, only the hours are written");
  await bare.host.set({ quiet: { on: true, from: "9:00", to: "99:99" } });
  assert.deepEqual(bare.w.settings.remote.quiet, { from: "22:00", to: "07:00" }, "times that are not times are not saved");
  await bare.host.set({ quiet: "always" });
  await bare.host.set({ quiet: { on: "yes" } });
  assert.deepEqual(bare.w.settings.remote.quiet, { from: "22:00", to: "07:00" });
});

test("a change in the remote's quiet hours reaches the next look, so there is one clock", async () => {
  const t = world({ digest: digestOf("q1") });
  await t.host.start();
  t.w.settings = { remote: { quiet: { from: "00:00", to: "23:59" } } }; // set from the Friends card
  t.w.minute = 12 * 60;
  t.host.question(t.ask());
  await t.advance(25 * SECOND);
  assert.deepEqual(t.w.shown, [], "quiet by the remote's setting");
  assert.deepEqual((await t.host.state()).quiet, { on: true, from: "00:00", to: "23:59" });
});

test("alerts:get: the choices, the quiet hours, what is in force, what waits and how much of the hour is used", async () => {
  const t = world({ settings: { alerts: { done: true }, remote: { quiet: { from: "22:00", to: "07:00" } } }, digest: digestOf("a", "b") });
  await t.host.start();
  await t.advance(3 * SECOND);
  const state = await t.host.state();
  assert.deepEqual(state, { ok: true, prefs: { on: true, need: true, fail: true, done: true, flash: true, badge: true, sound: false, titles: "generic" }, quiet: { on: true, from: "22:00", to: "07:00" }, killed: false, supported: true, platform: "win32", waiting: 2, hour: { sent: 0, max: 12 } });
  const none = world({ supported: false });
  assert.equal((await none.host.state()).supported, false, "a machine with no notification support says so");
});

test("one look in ten seconds however often the board moves", async () => {
  const t = world({ digest: digestOf("a") });
  await t.host.start();
  await t.advance(3 * SECOND);
  assert.equal(t.w.digestCalls, 1);
  for (let index = 0; index < 50; index += 1) { t.host.tasks([], [], null); await t.advance(100); }
  await t.advance(10 * SECOND);
  assert.equal(t.w.digestCalls, 2, "fifty board writes in five seconds, one more look");
  await t.advance(10 * MINUTE);
  assert.ok(t.w.digestCalls >= 10 && t.w.digestCalls <= 13, `and a look a minute when nothing happens (${t.w.digestCalls})`);
});

test("the settings file is read when something is about to be told and every few minutes, not at every look", async () => {
  const t = world({ digest: digestOf("a") });
  await t.host.start();
  assert.equal(t.w.reads, 1, "once at the start");
  await t.advance(4 * MINUTE);
  assert.equal(t.w.reads, 1, "four minutes of looks read nothing more");
  await t.advance(2 * MINUTE);
  assert.equal(t.w.reads, 2, "and once after five");
  t.host.question(t.ask());
  await t.advance(25 * SECOND);
  assert.ok(t.w.reads >= 3, "a thing about to be told reads the choices first, so a change made elsewhere is honoured");
  assert.equal(t.w.shown.length, 1);
});

test("a change that arrives while a look is reading the board is not lost: the look is done again", async () => {
  const t = world({ digest: digestOf("a") });
  let release;
  t.w.digestGate = new Promise((resolve) => { release = resolve; });
  await t.host.start();
  await t.advance(3 * SECOND); // the start's look is now waiting on the board
  assert.equal(t.w.digestCalls, 1);
  t.w.digest = digestOf("a", "b", "c"); // the owner's queue grew after the look began
  t.host.poke();
  t.w.digestGate = null;
  release();
  await t.tick();
  await t.tick();
  assert.equal(t.overlays().at(-1)[2], "1 waiting on you", "the look that was reading drew what it read");
  await t.advance(10 * SECOND);
  assert.equal(t.overlays().at(-1)[2], "3 waiting on you", "and the next look, which the poke asked for, drew the change");
});

test("a new window starts with no count: it is drawn again", async () => {
  const t = world({ digest: digestOf("a") });
  await t.host.start();
  await t.advance(3 * SECOND);
  assert.equal(t.overlays().length, 1);
  t.host.windowMade();
  assert.equal(t.overlays().length, 2, "the same count, on the new window");
  t.w.windowGone = true;
  assert.doesNotThrow(() => t.host.windowMade());
  assert.doesNotThrow(() => t.host.focus());
});

test("every failure is swallowed and logged by code: a notification that will not show, an icon that will not set, a digest that will not read", async () => {
  const t = world({ digest: digestOf("q1") });
  await t.host.start();
  t.w.failShow = true;
  t.host.question(t.ask());
  await t.advance(25 * SECOND);
  assert.deepEqual(t.w.shown, []);
  assert.ok(t.w.logs.includes("[alerts] could not show a notification (E_FAIL)"));
  t.w.failOverlay = true;
  t.w.digest = digestOf("a", "b");
  t.host.windowMade();
  assert.ok(t.w.logs.includes("[alerts] could not set the taskbar count (EPERM)"));
  assert.ok(t.w.logs.every((line) => !/Users|Nate|toast|\\/.test(line)), "no path, no name in any line");
  t.w.digest = new Error("the board could not be read at C:\\Users\\Nate\\board.json");
  t.host.poke();
  await t.advance(70 * SECOND);
  assert.ok(t.w.logs.every((line) => !line.includes("Nate")));
  const none = world({ supported: false, digest: digestOf("q1") });
  await none.host.start();
  none.host.question(none.ask());
  await none.advance(25 * SECOND);
  assert.deepEqual(none.w.shown, [], "no Notification support, nothing shown, nothing thrown");
});

test("close stops everything: no timers, no queue, and a test that was waiting is answered", async () => {
  const t = world({ looked: true, digest: digestOf("q1") });
  await t.host.start();
  t.host.question(t.ask());
  const waiting = t.host.test();
  await t.tick();
  t.host.close();
  assert.deepEqual(await waiting, { ok: true, sent: false, why: "Studio is closing." });
  assert.deepEqual(t.w.timers, []);
  assert.equal(t.host.question(t.ask({ id: "q2" })), false);
  await t.advance(5 * MINUTE);
  assert.deepEqual([t.w.shown, t.w.digestCalls], [[], 0]);
});

test("it starts from the defaults, before anything is saved: need and failed on, finished off", async () => {
  const t = world({ digest: digestOf("a") });
  await t.host.start();
  t.host.tasks([{ kind: "verified", taskId: "x", title: "x" }], [], null);
  t.host.question(t.ask({ id: "a" }));
  await t.advance(25 * SECOND);
  assert.equal(t.w.shown.length, 1, "the question, not the finished task");
});
