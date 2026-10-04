// scripts/alerts.cjs: when Studio may tell Windows something and what it says.
// Every rule the owner set is walked through on its own: only while Studio is
// not the window being looked at, never inside quiet hours (which cross
// midnight and are the Discord remote's own), the same thing is not told twice
// for a while, at most twelve an hour, generic words unless task titles were
// chosen, and MEFI_STUDIO_NO_ALERTS or the master switch silences everything.
//
// Run: node --test tests/alerts.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const alerts = require("../scripts/alerts.cjs");
const remote = require("../scripts/remote.cjs");

const NOW = Date.UTC(2026, 8, 30, 15, 0, 0);
const MIN = 60 * 1000;
const need = (more = {}) => ({ kind: "need", items: [{ id: "q1", title: "Search notes by tag", detail: "Should #Work and #work count as the same tag?", ...more }] });
// Away from Studio, in the middle of the afternoon, nothing told yet.
const away = (more = {}) => ({ now: NOW, minuteOfDay: 15 * 60, focused: false, killed: false, quiet: null, sent: [], recent: {}, waiting: 3, ...more });

test("a fresh install: need and failed on, finished off, flash and count on, no sound, generic words", () => {
  assert.deepEqual(alerts.normalizePrefs(undefined), { on: true, need: true, fail: true, done: false, flash: true, badge: true, sound: false, titles: "generic" });
  assert.deepEqual(alerts.normalizePrefs(null), alerts.DEFAULTS);
  assert.deepEqual(alerts.normalizePrefs("nope"), alerts.DEFAULTS);
  assert.equal(Object.isFrozen(alerts.DEFAULTS), true);
});

test("saved choices are read strictly: only true and false count as a switch, only \"titles\" is another kind of words", () => {
  const prefs = alerts.normalizePrefs({ on: "yes", need: 0, fail: null, done: true, flash: "false", badge: false, sound: true, titles: "TITLES", extra: 1 });
  assert.deepEqual(prefs, { on: true, need: true, fail: true, done: true, flash: true, badge: false, sound: true, titles: "generic" });
  assert.equal(alerts.normalizePrefs({ titles: "titles" }).titles, "titles");
  assert.deepEqual(Object.keys(alerts.normalizePrefs({ stray: 1 })).sort(), [...alerts.FLAGS, "titles"].sort(), "nothing it does not know is kept");
});

test("a patch from Settings is validated: known keys, right types, nothing else; the saved object is never changed", () => {
  const saved = { on: true, need: true, done: false };
  const next = alerts.applyPatch(saved, { done: true, flash: false, need: "no", bogus: true, titles: "titles", sound: 1, badge: undefined });
  assert.deepEqual(next, { on: true, need: true, fail: true, done: true, flash: false, badge: true, sound: false, titles: "titles" });
  assert.deepEqual(saved, { on: true, need: true, done: false });
  assert.deepEqual(alerts.applyPatch(saved, null), alerts.normalizePrefs(saved));
  assert.equal(alerts.applyPatch({ titles: "titles" }, { titles: "anything" }).titles, "titles", "an unknown word for the words changes nothing");
  assert.equal(alerts.applyPatch({ titles: "titles" }, { titles: "generic" }).titles, "generic");
});

// ---- quiet hours ---------------------------------------------------------------------------------

test("quiet hours are the Discord remote's: the same rule decides what is a valid window", () => {
  const samples = [
    { from: "22:00", to: "07:00" }, { from: "00:00", to: "23:59" }, { from: "07:00", to: "07:00" }, { from: "24:00", to: "07:00" },
    { from: "7:00", to: "08:00" }, { from: "22:00" }, { to: "07:00" }, { from: "22:60", to: "07:00" }, { from: "10:00 PM", to: "7:00 AM" },
    null, undefined, "22:00", [], { from: 2200, to: 700 },
  ];
  for (const sample of samples) {
    assert.deepEqual(alerts.normalizeQuiet(sample), remote.normalizeSettings({ quiet: sample }).quiet, JSON.stringify(sample));
  }
  assert.deepEqual(alerts.normalizeQuiet({ from: "22:00", to: "07:00", extra: 1 }), { from: "22:00", to: "07:00" });
});

test("a window that crosses midnight is quiet on both sides of it, and the ends are from-inclusive, to-exclusive", () => {
  const night = { from: "22:00", to: "07:00" };
  const at = (h, m = 0) => h * 60 + m;
  assert.equal(alerts.quietNow(night, at(22)), true);
  assert.equal(alerts.quietNow(night, at(21, 59)), false);
  assert.equal(alerts.quietNow(night, at(23, 59)), true);
  assert.equal(alerts.quietNow(night, at(0)), true, "midnight itself");
  assert.equal(alerts.quietNow(night, at(6, 59)), true);
  assert.equal(alerts.quietNow(night, at(7)), false, "the end is the first minute that is not quiet");
  assert.equal(alerts.quietNow(night, at(15)), false);
  const lunch = { from: "12:00", to: "13:30" };
  assert.equal(alerts.quietNow(lunch, at(12)), true);
  assert.equal(alerts.quietNow(lunch, at(13, 29)), true);
  assert.equal(alerts.quietNow(lunch, at(13, 30)), false);
  assert.equal(alerts.quietNow(lunch, at(11, 59)), false);
  assert.equal(alerts.quietNow(null, at(3)), false, "no hours, never quiet");
  assert.equal(alerts.quietNow({ from: "22:00", to: "22:00" }, at(22)), false, "an empty window is no window");
  assert.equal(alerts.quietNow(night, Number.NaN), false);
  // The same answer as the remote's own rule for every minute of the day.
  for (const quiet of [night, lunch, { from: "00:00", to: "00:01" }, { from: "23:59", to: "00:00" }]) {
    for (let minute = 0; minute < 1440; minute += 1) assert.equal(alerts.quietNow(quiet, minute), remote.quietNow(quiet, minute), `${quiet.from}-${quiet.to} at ${minute}`);
  }
});

test("Settings sees quiet hours as a switch and two times: the saved window, or the remote's defaults while off", () => {
  assert.deepEqual(alerts.quietView(null), { on: false, from: "22:00", to: "07:00" });
  assert.deepEqual(alerts.quietView({ from: "23:00", to: "06:30" }), { on: true, from: "23:00", to: "06:30" });
  assert.deepEqual(alerts.quietView({ from: "23:00", to: "23:00" }), { on: false, from: "22:00", to: "07:00" }, "a window the remote would ignore is off here too");
});

test("a patch for the quiet hours: off clears, on takes the times given or the ones it had, a time alone changes a window that is on", () => {
  assert.equal(alerts.quietPatch({ from: "22:00", to: "07:00" }, { on: false }), null);
  assert.deepEqual(alerts.quietPatch(null, { on: true }), { from: "22:00", to: "07:00" }, "on with nothing saved starts from the defaults");
  assert.deepEqual(alerts.quietPatch(null, { on: true, from: "21:00", to: "06:00" }), { from: "21:00", to: "06:00" });
  assert.deepEqual(alerts.quietPatch({ from: "22:00", to: "07:00" }, { from: "23:30" }), { from: "23:30", to: "07:00" }, "only the start moved");
  assert.deepEqual(alerts.quietPatch({ from: "22:00", to: "07:00" }, { to: "08:00" }), { from: "22:00", to: "08:00" });
  assert.equal(alerts.quietPatch(null, { from: "21:00", to: "06:00" }), undefined, "times alone do not switch it on");
  assert.deepEqual(alerts.quietPatch({ from: "22:00", to: "07:00" }, { on: true, from: "9:00", to: "99:00" }), { from: "22:00", to: "07:00" }, "times that are not times are not taken");
  assert.deepEqual(alerts.quietPatch(null, { on: true, from: "10:00", to: "10:00" }), { from: "22:00", to: "07:00" }, "an empty window falls back to the defaults");
  assert.deepEqual(alerts.quietPatch({ from: "23:00", to: "06:00" }, { on: true, from: "10:00", to: "10:00" }), { from: "23:00", to: "06:00" }, "or to the window it had");
  assert.equal(alerts.quietPatch({ from: "22:00", to: "07:00" }, "on"), undefined);
  assert.equal(alerts.quietPatch({ from: "22:00", to: "07:00" }, {}), undefined);
});

test("times read the way people say them", () => {
  assert.equal(alerts.clockLabel("07:00"), "7:00 AM");
  assert.equal(alerts.clockLabel("22:00"), "10:00 PM");
  assert.equal(alerts.clockLabel("00:05"), "12:05 AM");
  assert.equal(alerts.clockLabel("12:30"), "12:30 PM");
  assert.equal(alerts.clockLabel("13:00"), "1:00 PM");
  assert.equal(alerts.clockLabel("7:00"), "");
});

// ---- what a thing is -------------------------------------------------------------------------------

test("a question is a need, a permission or a failure by the issue it carries; suggestions, notes and closed asks are nothing", () => {
  const ask = (more = {}) => ({ id: "q1", status: "open", kind: "question", title: "?", context: {}, ...more });
  assert.equal(alerts.kindOfQuestion(ask()), "need");
  assert.equal(alerts.kindOfQuestion(ask({ context: { issueKind: "scope" } })), "need");
  assert.equal(alerts.kindOfQuestion(ask({ context: { issueKind: "owner" } })), "need");
  assert.equal(alerts.kindOfQuestion(ask({ context: { issueKind: "permission" } })), "perm");
  assert.equal(alerts.kindOfQuestion(ask({ context: { issueKind: "check-failed" } })), "fail");
  assert.equal(alerts.kindOfQuestion(ask({ context: { issueKind: "run-failed" } })), "fail");
  assert.equal(alerts.kindOfQuestion(ask({ kind: "suggestion" })), null, "a suggestion is not a demand");
  assert.equal(alerts.kindOfQuestion(ask({ context: { severity: "note" } })), null, "a note asks nothing of you");
  assert.equal(alerts.kindOfQuestion(ask({ status: "answered" })), null);
  assert.equal(alerts.kindOfQuestion(null), null);
  assert.equal(alerts.kindOfQuestion(ask({ context: null })), "need");
});

test("a task's lifecycle event is a failure when it was parked, a need when it waits for approval, done when it finished", () => {
  assert.equal(alerts.kindOfTaskEvent("parked"), "fail");
  assert.equal(alerts.kindOfTaskEvent("needs-approval"), "need");
  assert.equal(alerts.kindOfTaskEvent("verified"), "done");
  assert.equal(alerts.kindOfTaskEvent("done"), "done");
  for (const quiet of ["started", "verifying", "retrying", "stopped", "held", "removed", "", undefined, null, "banana"]) assert.equal(alerts.kindOfTaskEvent(quiet), null, String(quiet));
});

// ---- deciding --------------------------------------------------------------------------------------------

test("away from Studio with nothing in the way, a need goes out: generic words, the flash, the count, a sound only when asked", () => {
  const result = alerts.decide(need(), {}, away());
  assert.equal(result.why, "");
  assert.deepEqual(result.notify, { key: "need:q1", kind: "need", ids: ["q1"], count: 1, title: "Something needs you", body: "A task is waiting for your answer.", silent: true, open: { kind: "need", id: "q1" } });
  assert.equal(result.flash, true);
  assert.equal(result.badge, 3);
  assert.equal(alerts.decide(need(), { sound: true }, away()).notify.silent, false, "sound on means the toast is not silent");
});

test("only while Studio is not the window being looked at", () => {
  const focused = alerts.decide(need(), {}, away({ focused: true }));
  assert.equal(focused.notify, null);
  assert.equal(focused.flash, false);
  assert.match(focused.why, /^Studio is in front, so Windows stays quiet\. The inbox has it\.$/);
  const test = alerts.decide({ kind: "test", items: [] }, {}, away({ focused: true }));
  assert.equal(test.notify, null, "the test is held back too");
  assert.match(test.why, /Switch to another window/);
  assert.notEqual(alerts.decide(need(), {}, away({ focused: false })).notify, null);
  assert.notEqual(alerts.decide(need(), {}, away({ focused: undefined })).notify, null, "a context that says nothing is not focus");
});

test("never inside quiet hours (across midnight too); the test is exempt; the count still shows", () => {
  const quiet = { from: "22:00", to: "07:00" };
  const late = alerts.decide(need(), {}, away({ quiet, minuteOfDay: 23 * 60 + 30 }));
  assert.equal(late.notify, null);
  assert.equal(late.flash, false);
  assert.equal(late.why, "Quiet hours until 7:00 AM: no notification. The inbox still has it.");
  assert.equal(late.badge, 3, "the inbox and the count are not quiet");
  assert.equal(alerts.decide(need(), {}, away({ quiet, minuteOfDay: 3 * 60 })).notify, null, "after midnight");
  assert.equal(alerts.decide(need(), {}, away({ quiet, minuteOfDay: 7 * 60 })).notify?.kind, "need", "the end of the window is not quiet");
  assert.equal(alerts.decide(need(), {}, away({ quiet, minuteOfDay: 15 * 60 })).notify?.kind, "need");
  assert.equal(alerts.decide({ kind: "test", items: [] }, {}, away({ quiet, minuteOfDay: 23 * 60 })).notify?.kind, "test", "a test at night still arrives");
  assert.equal(alerts.decide(need(), {}, away({ quiet: null, minuteOfDay: 23 * 60 })).notify?.kind, "need", "no hours saved, no quiet");
  assert.equal(alerts.decide(need(), {}, away({ quiet: { from: "22:00", to: "22:00" }, minuteOfDay: 22 * 60 })).notify?.kind, "need", "a window the remote ignores is ignored here");
});

test("the same task and kind is not told twice for a while; a new one and a later one are", () => {
  const recent = { "need:q1": NOW - 5 * MIN };
  const again = alerts.decide(need(), {}, away({ recent }));
  assert.equal(again.notify, null);
  assert.equal(again.why, "Studio already told you about this a moment ago.");
  assert.notEqual(alerts.decide(need(), {}, away({ recent: { "need:q1": NOW - 16 * MIN } })).notify, null, "after fifteen minutes it may be told again");
  assert.notEqual(alerts.decide(need({ id: "q2" }), {}, away({ recent })).notify, null, "a different thing");
  assert.notEqual(alerts.decide({ kind: "fail", items: [{ id: "q1" }] }, {}, away({ recent })).notify, null, "the same id as another kind is another thing");
  const two = alerts.decide({ kind: "need", items: [{ id: "q1", title: "A" }, { id: "q2", title: "B" }] }, {}, away({ recent }));
  assert.deepEqual(two.notify.ids, ["q2"], "only what was not told is told");
  assert.equal(two.notify.count, 1);
  assert.equal(two.notify.open.id, "q2");
  assert.notEqual(alerts.decide({ kind: "test", items: [] }, {}, away({ recent: { "test:": NOW } })).notify, null, "the test is exempt");
});

test("several items about the same thing are one thing to tell", () => {
  const two = alerts.decide({ kind: "fail", items: [{ id: "t9", title: "Fix login" }, { id: "t9", title: "Fix login again" }, { id: "t8", title: "Other" }] }, { titles: "titles" }, away());
  assert.deepEqual([two.notify.ids, two.notify.count], [["t9", "t8"], 2]);
  assert.equal(two.notify.body, "Fix login · Other", "the first of the duplicates names it");
  const one = alerts.decide({ kind: "fail", items: [{ id: "t9" }, { id: "t9" }] }, {}, away());
  assert.equal(one.notify.body, "Checks failed. Open Studio to decide what happens next.", "one thing, so the words for one");
});

test("at most twelve an hour: the thirteenth waits for the inbox; older ones stop counting after an hour; the test is exempt", () => {
  const eleven = Array.from({ length: 11 }, (_, index) => NOW - (index + 1) * MIN);
  assert.notEqual(alerts.decide(need(), {}, away({ sent: eleven })).notify, null, "the twelfth goes");
  const twelve = [...eleven, NOW - 12 * MIN];
  const capped = alerts.decide(need(), {}, away({ sent: twelve }));
  assert.equal(capped.notify, null);
  assert.equal(capped.why, "Studio sends at most 12 notifications an hour. The inbox has the rest.");
  assert.equal(capped.badge, 3);
  const oldOnes = twelve.map((at, index) => (index < 3 ? NOW - 61 * MIN : at));
  assert.notEqual(alerts.decide(need(), {}, away({ sent: oldOnes })).notify, null, "three of them were an hour ago");
  assert.notEqual(alerts.decide({ kind: "test", items: [] }, {}, away({ sent: twelve })).notify, null);
  assert.equal(alerts.PER_HOUR, 12);
});

test("each kind has its own switch; a permission follows the need switch; the test has none", () => {
  const off = (key) => ({ [key]: false });
  assert.equal(alerts.decide(need(), off("need"), away()).notify, null);
  assert.equal(alerts.decide(need(), off("need"), away()).why, "No Windows notification: questions are off in Settings › Notifications.");
  assert.equal(alerts.decide({ kind: "perm", items: [{ id: "p1" }] }, off("need"), away()).notify, null, "permissions ride the same switch");
  assert.equal(alerts.decide({ kind: "perm", items: [{ id: "p1" }] }, off("need"), away()).why, "No Windows notification: permissions are off in Settings › Notifications.");
  assert.equal(alerts.decide({ kind: "fail", items: [{ id: "t1" }] }, off("fail"), away()).notify, null);
  assert.equal(alerts.decide({ kind: "fail", items: [{ id: "t1" }] }, off("fail"), away()).why, "No Windows notification: failures are off in Settings › Notifications.");
  assert.equal(alerts.decide({ kind: "done", items: [{ id: "t1" }] }, {}, away()).notify, null, "finished tasks are off by default");
  assert.equal(alerts.decide({ kind: "done", items: [{ id: "t1" }] }, {}, away()).why, "No Windows notification: finished tasks are off in Settings › Notifications.");
  assert.notEqual(alerts.decide({ kind: "done", items: [{ id: "t1" }] }, { done: true }, away()).notify, null);
  assert.notEqual(alerts.decide({ kind: "perm", items: [{ id: "p1" }] }, {}, away()).notify, null);
  assert.notEqual(alerts.decide({ kind: "test", items: [] }, { need: false, fail: false, done: false }, away()).notify, null);
});

test("the kill switch and the master switch silence everything, the count included", () => {
  const killed = alerts.decide(need(), {}, away({ killed: true }));
  assert.deepEqual([killed.notify, killed.flash, killed.badge], [null, false, 0]);
  assert.match(killed.why, /MEFI_STUDIO_NO_ALERTS/);
  const test = alerts.decide({ kind: "test", items: [] }, {}, away({ killed: true }));
  assert.equal(test.notify, null, "even the test");
  const off = alerts.decide(need(), { on: false }, away());
  assert.deepEqual([off.notify, off.flash, off.badge], [null, false, 0]);
  assert.equal(off.why, "Windows notifications are off in Settings › Notifications.");
  assert.equal(alerts.decide({ kind: "test", items: [] }, { on: false }, away()).notify, null, "the test does not override the master switch");
  assert.equal(alerts.decide(need(), { on: false, need: true }, away({ killed: true })).why.includes("MEFI_STUDIO_NO_ALERTS"), true, "the environment is named first");
});

test("the flash follows its switch and a notification that went; the count follows its switch and is capped at 99", () => {
  assert.equal(alerts.decide(need(), { flash: false }, away()).flash, false);
  assert.equal(alerts.decide(need(), { flash: true }, away({ focused: true })).flash, false, "nothing went out, nothing flashes");
  assert.equal(alerts.decide(need(), { badge: false }, away()).badge, 0);
  assert.equal(alerts.decide(need(), {}, away({ waiting: 0 })).badge, 0);
  assert.equal(alerts.decide(need(), {}, away({ waiting: 250 })).badge, 99);
  assert.equal(alerts.decide(need(), {}, away({ waiting: -4 })).badge, 0);
  assert.equal(alerts.badgeFor(5, {}, {}), 5);
  assert.equal(alerts.badgeFor(5, { on: false }, {}), 0);
  assert.equal(alerts.badgeFor(5, { badge: false }, {}), 0);
  assert.equal(alerts.badgeFor(5, {}, { killed: true }), 0);
  assert.equal(alerts.badgeFor("3", {}, {}), 3);
  assert.equal(alerts.BADGE_MAX, 99);
});

test("the words: generic by default; task titles only when chosen; several things say how many; the test names nothing", () => {
  const generic = alerts.decide(need(), {}, away());
  assert.ok(!JSON.stringify(generic).includes("Search notes by tag"), "a task's title never travels by default");
  assert.ok(!JSON.stringify(generic).includes("#Work"));
  const titled = alerts.decide(need(), { titles: "titles" }, away());
  assert.deepEqual([titled.notify.title, titled.notify.body], ["Something needs you", "Search notes by tag: Should #Work and #work count as the same tag?"]);
  const plain = alerts.decide({ kind: "need", items: [{ id: "q9" }] }, { titles: "titles" }, away());
  assert.equal(plain.notify.body, "A task is waiting for your answer.", "nothing to name, so the generic words");
  const three = alerts.decide({ kind: "need", items: ["A", "B", "C"].map((title, index) => ({ id: `q${index}`, title })) }, {}, away());
  assert.deepEqual([three.notify.title, three.notify.body, three.notify.count], ["Something needs you", "3 things are waiting for you.", 3]);
  const named = alerts.decide({ kind: "need", items: ["A", "B", "C", "D", "E"].map((title, index) => ({ id: `q${index}`, title })) }, { titles: "titles" }, away());
  assert.equal(named.notify.body, "A · B · C · and 2 more");
  assert.equal(alerts.decide({ kind: "fail", items: [{ id: "t1" }, { id: "t2" }] }, {}, away()).notify.body, "2 tasks need a decision. Open Studio to see them.");
  assert.equal(alerts.decide({ kind: "done", items: [{ id: "t1" }, { id: "t2" }] }, { done: true }, away()).notify.title, "Tasks are ready");
  assert.equal(alerts.decide({ kind: "perm", items: [{ id: "p1" }, { id: "p2" }] }, {}, away()).notify.title, "Permissions are needed");
  const test = alerts.decide({ kind: "test", items: [{ id: "x", title: "A secret title" }] }, { titles: "titles" }, away());
  assert.deepEqual([test.notify.title, test.notify.body], ["Test notification", "Alerts are working. Nothing needs you."]);
  assert.deepEqual([test.notify.ids, test.notify.count, test.notify.open], [[], 0, { kind: "test", id: null }], "it tells no thing, so a click on it opens nothing in particular");
  assert.equal(alerts.decide({ kind: "need", items: [{ id: "q1", title: "x".repeat(400) }] }, { titles: "titles" }, away()).notify.body.length <= 180, true, "a long title is cut");
  assert.deepEqual(alerts.GENERIC.need, ["Something needs you", "A task is waiting for your answer."]);
  assert.deepEqual(alerts.GENERIC.fail, ["A task needs you", "Checks failed. Open Studio to decide what happens next."]);
  assert.deepEqual(alerts.GENERIC.done, ["A task is ready", "Open Studio to review it."]);
  assert.deepEqual(alerts.GENERIC.perm, ["A permission is needed", "A builder is asking before it goes on."]);
});

test("the checks run in the order a person would expect, and nothing throws on rubbish", () => {
  const everything = { killed: true, focused: true, quiet: { from: "00:00", to: "23:59" }, minuteOfDay: 600, recent: { "need:q1": NOW }, sent: Array(20).fill(NOW) };
  assert.match(alerts.decide(need(), { on: false, need: false }, away(everything)).why, /MEFI_STUDIO_NO_ALERTS/, "killed first");
  assert.match(alerts.decide(need(), { on: false, need: false }, away({ ...everything, killed: false })).why, /off in Settings/, "then the master switch");
  assert.match(alerts.decide(need(), { need: false }, away({ ...everything, killed: false })).why, /questions are off/, "then the kind");
  assert.match(alerts.decide(need(), {}, away({ ...everything, killed: false })).why, /in front/, "then focus");
  assert.match(alerts.decide(need(), {}, away({ ...everything, killed: false, focused: false })).why, /Quiet hours/, "then quiet hours");
  assert.match(alerts.decide(need(), {}, away({ ...everything, killed: false, focused: false, quiet: null })).why, /already told/, "then the dedupe");
  assert.match(alerts.decide(need(), {}, away({ ...everything, killed: false, focused: false, quiet: null, recent: {} })).why, /at most 12/, "then the cap");
  for (const rubbish of [undefined, null, 5, "x", [], {}, { kind: "banana" }, { kind: "need" }, { kind: "need", items: "no" }, { kind: "need", items: [null, 3, {}] }]) {
    assert.doesNotThrow(() => alerts.decide(rubbish, null, null), JSON.stringify(rubbish));
    assert.equal(alerts.decide(rubbish, {}, away()).notify, null, JSON.stringify(rubbish));
  }
  assert.equal(alerts.decide({ kind: "banana", items: [] }, {}, away()).why, "That is not something Studio tells Windows about.");
  assert.equal(alerts.decide({ kind: "need", items: [] }, {}, away()).why, "There is nothing to tell you.");
});

// ---- remembering, settling, grouping -------------------------------------------------------------------

test("a notification that went out is remembered for the dedupe and the hour; the test and old entries are not", () => {
  const first = alerts.decide(need(), {}, away());
  const memory = alerts.remember({ sent: [], recent: {} }, first.notify, NOW);
  assert.deepEqual(memory, { sent: [NOW], recent: { "need:q1": NOW } });
  assert.equal(alerts.decide(need(), {}, away({ ...memory })).notify, null, "and so it is not told twice");
  const later = alerts.remember({ sent: [NOW - 70 * MIN, NOW - 10 * MIN], recent: { "need:old": NOW - 20 * MIN, "need:q0": NOW - 10 * MIN } }, null, NOW);
  assert.deepEqual(later, { sent: [NOW - 10 * MIN], recent: { "need:q0": NOW - 10 * MIN } }, "an hour and fifteen minutes are as long as it remembers");
  const test = alerts.remember({ sent: [], recent: {} }, alerts.decide({ kind: "test", items: [] }, {}, away()).notify, NOW);
  assert.deepEqual(test, { sent: [], recent: {} }, "the test is not counted");
  const many = alerts.decide({ kind: "need", items: [{ id: "a" }, { id: "b" }] }, {}, away());
  assert.deepEqual(alerts.remember(null, many.notify, NOW).recent, { "need:a": NOW, "need:b": NOW }, "every thing a notification told is remembered");
  const crowd = {};
  for (let index = 0; index < 500; index += 1) crowd[`need:${index}`] = NOW - (index % 14) * MIN;
  assert.ok(Object.keys(alerts.remember({ sent: [], recent: crowd }, null, NOW).recent).length <= 400, "bounded");
});

test("a thing waits twenty seconds before Windows hears of it, and the look says when the next one is ready", () => {
  assert.equal(alerts.SETTLE_MS, 20000);
  const pending = [{ id: "a", at: NOW - 25000 }, { id: "b", at: NOW - 5000 }, { id: "c", at: NOW - 1000 }];
  const split = alerts.settle(pending, NOW);
  assert.deepEqual(split.due.map((item) => item.id), ["a"]);
  assert.deepEqual(split.waiting.map((item) => item.id), ["b", "c"]);
  assert.equal(split.next, 15000, "the oldest waiting one is ready in fifteen seconds");
  assert.deepEqual(alerts.settle([], NOW), { due: [], waiting: [], next: null });
  assert.equal(alerts.settle([{ id: "x", at: NOW - 20000 }], NOW).due.length, 1, "exactly twenty seconds is enough");
  assert.equal(alerts.settle([{ id: "x", at: NOW }], NOW, 500).next, 500);
});

test("once one thing is ready, what would be ready within five seconds goes with it: a burst of questions is one notification", () => {
  assert.equal(alerts.GRACE_MS, 5000);
  const burst = [{ id: "a", at: NOW - 20000 }, { id: "b", at: NOW - 16000 }, { id: "c", at: NOW - 15000 }, { id: "d", at: NOW - 14000 }];
  const split = alerts.settle(burst, NOW);
  assert.deepEqual(split.due.map((item) => item.id), ["a", "b", "c"], "b and c were asked within five seconds of a");
  assert.deepEqual(split.waiting.map((item) => item.id), ["d"]);
  assert.equal(split.next, 6000);
  const none = alerts.settle([{ id: "b", at: NOW - 16000 }, { id: "c", at: NOW - 15000 }], NOW);
  assert.deepEqual(none.due, [], "with nothing ripe, nothing is early");
  assert.equal(none.next, 4000);
});

test("what is due is grouped by kind, a question before a permission before a failure before a finished task", () => {
  const items = [{ kind: "done", id: "d1" }, { kind: "fail", id: "f1" }, { kind: "need", id: "n1" }, { kind: "perm", id: "p1" }, { kind: "need", id: "n2" }, { kind: "test", id: "t" }, null, { kind: "banana", id: "b" }];
  const groups = alerts.groups(items);
  assert.deepEqual(groups.map((group) => group.kind), ["need", "perm", "fail", "done"]);
  assert.deepEqual(groups[0].items.map((item) => item.id), ["n1", "n2"]);
  assert.deepEqual(alerts.groups(undefined), []);
});

test("what alerts:get answers: the choices, the quiet hours, what is in force and how much of the hour is used", () => {
  const view = alerts.view({ prefs: { done: true }, quiet: { from: "23:00", to: "06:00" }, killed: false, supported: true, waiting: 4, sent: [NOW - MIN, NOW - 90 * MIN], now: NOW, platform: "win32" });
  assert.deepEqual(view, { ok: true, prefs: { on: true, need: true, fail: true, done: true, flash: true, badge: true, sound: false, titles: "generic" }, quiet: { on: true, from: "23:00", to: "06:00" }, killed: false, supported: true, platform: "win32", waiting: 4, hour: { sent: 1, max: 12 } });
  const bare = alerts.view({});
  assert.deepEqual([bare.prefs, bare.quiet.on, bare.killed, bare.supported, bare.waiting], [alerts.DEFAULTS, false, false, true, 0]);
  assert.equal(alerts.view({ killed: true }).killed, true);
  assert.equal(alerts.view({ supported: false }).supported, false);
});
