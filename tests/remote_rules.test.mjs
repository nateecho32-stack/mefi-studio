// scripts/remote.cjs, the Discord remote's rules (docs/remote.md): only the
// owner's own account commands this PC, a message from Discord may look and
// talk but not approve without the PIN, five wrong PINs lock approvals, the
// replies read plainly and escape Discord's formatting, and alerts come once
// per change, wait out quiet hours and keep to their hourly cap.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const remote = require("../scripts/remote.cjs");
const plain = (value) => JSON.parse(JSON.stringify(value));
const ME = "123456789012345678";
const NOW = Date.UTC(2026, 8, 28, 18);
const MINUTE = 60000;

test("settings keep their defaults, clip the name and never show the PIN", () => {
  const fresh = remote.normalizeSettings(undefined, { hostname: "DESKTOP-HOME" });
  assert.deepEqual(plain(fresh), {
    on: false, name: "DESKTOP-HOME",
    notify: { needsYou: true, failed: true, stuck: true, done: false, digestHour: null },
    quiet: null, pin: null, lock: { failures: 0, lockedAt: 0 },
  });
  const pin = remote.hashPin("246810");
  const saved = remote.normalizeSettings({ on: true, name: "  Desk\nPC  ", notify: { done: true, digestHour: 20, needsYou: false }, quiet: { from: "23:00", to: "07:30" }, pin: { ...pin, setAt: 5 } });
  assert.equal(saved.name, "Desk PC");
  assert.deepEqual(plain(saved.notify), { needsYou: false, failed: true, stuck: true, done: true, digestHour: 20 });
  assert.deepEqual(plain(saved.quiet), { from: "23:00", to: "07:30" });
  const shown = remote.publicSettings(saved);
  assert.deepEqual(plain(shown), { on: true, name: "Desk PC", notify: saved.notify, quiet: saved.quiet, pinSet: true, locked: false });
  assert.ok(!JSON.stringify(shown).includes(pin.hash) && !JSON.stringify(shown).includes(pin.salt));
  assert.equal(remote.normalizeSettings({ quiet: { from: "25:00", to: "07:00" } }).quiet, null, "a bad time means no quiet hours");
  assert.equal(remote.normalizeSettings({ notify: { digestHour: 24 } }).notify.digestHour, null);
});

test("a patch changes only what it names; the PIN is never set through it", () => {
  const next = remote.applyPatch({ on: false, name: "Desk" }, { on: true, notify: { done: true }, pin: { salt: "0".repeat(32), hash: "0".repeat(64) }, name: "   " });
  assert.equal(next.on, true);
  assert.equal(next.name, "Desk", "a blank name keeps the old one");
  assert.equal(next.notify.done, true);
  assert.equal(next.notify.needsYou, true);
  assert.equal(next.pin, null);
  assert.equal(remote.applyPatch({ quiet: { from: "22:00", to: "06:00" } }, { quiet: null }).quiet, null);
});

test("the PIN is 4-12 digits, checked in constant time, and five wrong tries lock approvals", () => {
  assert.equal(remote.hashPin("12a4"), null);
  assert.equal(remote.hashPin("123"), null);
  const saved = { pin: remote.hashPin("4321") };
  assert.equal(remote.checkPin("4321", saved.pin), true);
  assert.equal(remote.checkPin("4322", saved.pin), false);
  assert.notEqual(remote.hashPin("4321").hash, saved.pin.hash, "a fresh salt each time");

  let settings = { ...saved };
  for (let tries = 1; tries <= 4; tries += 1) {
    const answer = remote.tryPin(settings, "0000", NOW);
    assert.equal(answer.ok, false);
    assert.equal(answer.left, 5 - tries);
    settings = { ...settings, lock: answer.lock };
  }
  const right = remote.tryPin(settings, "4321", NOW);
  assert.equal(right.ok, true, "the right PIN still works before the fifth miss");
  assert.deepEqual(plain(right.lock), { failures: 0, lockedAt: 0 });
  for (let tries = 1; tries <= 5; tries += 1) settings = { ...settings, lock: remote.tryPin(settings, "9999", NOW).lock };
  const locked = remote.tryPin(settings, "4321", NOW + MINUTE);
  assert.equal(locked.ok, false, "locked: even the right PIN is refused until Studio unlocks");
  assert.equal(locked.locked, true);
  assert.equal(settings.lock.lockedAt, NOW);
  assert.equal(remote.publicSettings(settings).locked, true);
  assert.equal(remote.tryPin({}, "4321", NOW).reason, "no-pin");
});

test("only the account this Studio signed in as can command it, with well-formed commands", () => {
  const frame = { requestId: "req_1", from: ME, command: "status", sentAt: NOW };
  assert.deepEqual(plain(remote.request(frame, ME)), { requestId: "req_1", command: "status" });
  assert.equal(remote.request({ ...frame, from: "999999999999999999" }, ME), null, "someone else's command");
  assert.equal(remote.request(frame, null), null, "no signed-in account, no commands");
  assert.equal(remote.request({ ...frame, command: "settings" }, ME), null);
  assert.equal(remote.request({ ...frame, requestId: "bad id!" }, ME), null);
  assert.equal(remote.request({ ...frame, command: "say", text: "   " }, ME), null);
  assert.equal(remote.request({ ...frame, command: "say", text: "x".repeat(2001) }, ME), null);
  assert.deepEqual(plain(remote.request({ ...frame, command: "say", text: " How is the login page going? " }, ME)), { requestId: "req_1", command: "say", text: "How is the login page going?" });
  assert.deepEqual(plain(remote.request({ ...frame, command: "button", buttonId: "ap-1a2b", pin: "4321" }, ME)), { requestId: "req_1", command: "button", buttonId: "ap-1a2b", pin: "4321" });
  assert.equal(remote.request({ ...frame, command: "button", buttonId: "ap-1a2b", pin: "12ab" }, ME), null);
  assert.equal(remote.request({ ...frame, command: "button", buttonId: "x".repeat(49) }, ME), null);
});

test("from Discord, chat may file, note, brake, stop and start work, but not approve, answer or close", () => {
  const gated = remote.gateActions({
    run: [{ kind: "create_task", title: "Add dark mode" }, { kind: "approve", taskId: "t1" }, { kind: "answer", questionId: "q1" }, { kind: "pause" }, { kind: "mark_done", taskId: "t2" }, { kind: "undo" }, { kind: "work_on", taskId: "t3" }],
    rejected: [{ action: { kind: "stop" }, reason: "not named" }],
    confirm: [{ kind: "create_task" }],
  });
  assert.deepEqual(gated.run.map((action) => action.kind), ["create_task", "pause", "work_on"]);
  assert.deepEqual(gated.rejected.map((row) => row.action.kind), ["stop", "approve", "answer", "mark_done", "undo"]);
  assert.match(gated.rejected[1].reason, /Approve button and your PIN/);
  assert.equal(gated.confirm.length, 1, "Ask cards still go to Studio");
});

const snapshot = {
  at: NOW, project: "Ruins Runner", state: "running", headline: "2 agents working",
  working: [{ title: "Add the *login* page", since: NOW - 12 * MINUTE, step: "Bash running · npm test" }, { title: "Fix tests", since: NOW - 65 * MINUTE, step: null }],
  needsYou: 2, needs: [], done: ["Tidy the menu"], failed: ["Port the shaders"],
};

test("status, made and digest read plainly and escape Discord's formatting", () => {
  const status = remote.statusReply(snapshot, { now: NOW });
  assert.equal(status.text, "**Ruins Runner** · 2 agents working\n• Add the \\*login\\* page (12 min)\n• Fix tests (1 h 5 min)\n2 things need you · today: 1 done, 1 stopped");
  assert.deepEqual(status.buttons.map((row) => row.id), ["needs", "pause"]);
  assert.deepEqual(remote.statusReply({ ...snapshot, state: "held", working: [], needsYou: 0 }, { now: NOW }).buttons.map((row) => row.id), ["resume"]);
  assert.match(remote.statusReply(null, { now: NOW }).text, /could not read/);

  const made = remote.madeReply(snapshot, { now: NOW });
  assert.equal(made.text, "**Building now**\n• Add the \\*login\\* page (12 min) — Bash running · npm test\n• Fix tests (1 h 5 min)\n**Finished today**\n• Tidy the menu\n**Stopped today**\n• Port the shaders");
  assert.equal(remote.madeReply({ ...snapshot, working: [], done: [], failed: [] }, { now: NOW }).text, "Nothing is being built right now.");

  assert.equal(remote.digestReply({ headline: "While you were away (3 h): 2 done.", lines: ["Done: A", "Done: B_c"] }).text, "While you were away (3 h): 2 done.\n• Done: A\n• Done: B\\_c");
  assert.equal(remote.sayReply({ text: "On it.", results: ["Filed \"Add dark mode\"; it waits for your OK."] }).text, "On it.\n\nFiled \"Add dark mode\"; it waits for your OK.");
});

test("needs lists everything waiting, and offers Approve only with a PIN that works", () => {
  const needs = { total: 3, items: [{ id: "approval:t1", kind: "approval", title: "Ship the settings page" }, { id: "q1", kind: "question", title: "Which font?" }, { id: "approval:t2", kind: "approval", title: "Add sound" }] };
  const withPin = remote.needsReply(needs, { pinReady: true, approvals: [{ id: "ap-1", index: 1 }, { id: "ap-3", index: 3 }] });
  assert.equal(withPin.text, "3 things need you:\n1. Approve: Ship the settings page\n2. Question: Which font? (in Studio)\n3. Approve: Add sound");
  assert.deepEqual(plain(withPin.buttons), [{ id: "ap-1", label: "Approve 1", style: "success", pin: true }, { id: "ap-3", label: "Approve 3", style: "success", pin: true }]);
  const without = remote.needsReply(needs, { pinReady: false, approvals: [{ id: "ap-1", index: 1 }] });
  assert.deepEqual(without.buttons, []);
  assert.match(without.text, /Set an approval PIN in Studio/);
  assert.equal(remote.needsReply({ total: 0, items: [] }).text, "Nothing needs you on this PC right now.");
});

test("quiet hours can wrap past midnight", () => {
  const quiet = { from: "23:00", to: "07:00" };
  assert.equal(remote.quietNow(quiet, 23 * 60 + 30), true);
  assert.equal(remote.quietNow(quiet, 6 * 60 + 59), true);
  assert.equal(remote.quietNow(quiet, 7 * 60), false);
  assert.equal(remote.quietNow({ from: "13:00", to: "14:00" }, 13 * 60 + 5), true);
  assert.equal(remote.quietNow(null, 0), false);
});

test("alerts: the first look only remembers, then each change is told once", () => {
  const settings = { on: true };
  const needs = { items: [{ id: "q1", kind: "question", title: "Which font?" }] };
  const look = (memory, extra = {}) => remote.alerts({ memory, snapshot, needs, settings, now: NOW, minuteOfDay: 12 * 60, day: "2026-09-28", approvalButton: (item) => ({ id: `ap-${item.id}`, label: "Approve", style: "success", pin: true }), ...extra });
  const first = look(null);
  assert.deepEqual(first.notices, [], "no burst of old news after a start");
  const again = look(first.memory);
  assert.deepEqual(again.notices, [], "nothing changed");

  const moreNeeds = { items: [...needs.items, { id: "approval:t9", kind: "approval", title: "Ship it" }] };
  const moreSnapshot = { ...snapshot, failed: [...snapshot.failed, "Build the map"], done: [...snapshot.done, "Fix audio"] };
  const changed = remote.alerts({ memory: again.memory, snapshot: moreSnapshot, needs: moreNeeds, settings, now: NOW, minuteOfDay: 12 * 60, day: "2026-09-28", approvalButton: (item) => ({ id: `ap-${item.id}`.slice(0, 48), label: "Approve", style: "success", pin: true }) });
  assert.deepEqual(changed.notices.map((row) => [row.kind, row.text]), [["needs-you", "🙋 Needs you: Ship it"], ["failed", "⚠️ Stopped: Build the map"]], "done is off by default");
  assert.equal(changed.notices[0].buttons[0].pin, true);
  const quietAgain = remote.alerts({ memory: changed.memory, snapshot: moreSnapshot, needs: moreNeeds, settings, now: NOW + MINUTE, minuteOfDay: 12 * 60 + 1, day: "2026-09-28" });
  assert.deepEqual(quietAgain.notices, [], "told once");
});

test("alerts wait out quiet hours for what still needs you, and leave the rest to the digest", () => {
  const settings = { on: true, quiet: { from: "23:00", to: "07:00" }, notify: { digestHour: 8 } };
  const base = remote.alerts({ memory: null, snapshot, needs: { items: [] }, settings, now: NOW, minuteOfDay: 22 * 60, day: "2026-09-28" }).memory;
  const night = remote.alerts({ memory: base, snapshot: { ...snapshot, failed: [...snapshot.failed, "Night failure"] }, needs: { items: [{ id: "q7", kind: "question", title: "Late question" }] }, settings, now: NOW, minuteOfDay: 23 * 60 + 30, day: "2026-09-28" });
  assert.deepEqual(night.notices, []);
  const morning = remote.alerts({ memory: { ...night.memory, digestDay: "2026-09-28" }, snapshot: { ...snapshot, failed: [], done: [] }, needs: { items: [{ id: "q7", kind: "question", title: "Late question" }] }, settings, now: NOW + 9 * 60 * MINUTE, minuteOfDay: 8 * 60 + 5, day: "2026-09-29" });
  assert.deepEqual(morning.notices.map((row) => row.kind), ["needs-you", "digest"], "the question waited; the night's failure is in the digest");
});

test("agents sitting on work get one alert per stretch, and alerts keep to their hourly cap", () => {
  const settings = { on: true };
  const held = { ...snapshot, state: "held", headline: "Agents are off", working: [], done: [], failed: [] };
  let memory = remote.alerts({ memory: null, snapshot: held, needs: { items: [] }, settings, now: NOW, minuteOfDay: 600, day: "d" }).memory;
  memory = remote.alerts({ memory, snapshot: held, needs: { items: [] }, settings, now: NOW + 5 * MINUTE, minuteOfDay: 605, day: "d" }).memory;
  const later = remote.alerts({ memory, snapshot: held, needs: { items: [] }, settings, now: NOW + 16 * MINUTE, minuteOfDay: 616, day: "d" });
  assert.equal(later.notices.length, 1);
  assert.equal(later.notices[0].kind, "stuck");
  assert.deepEqual(later.notices[0].buttons.map((row) => row.id), ["resume"]);
  assert.equal(remote.alerts({ memory: later.memory, snapshot: held, needs: { items: [] }, settings, now: NOW + 40 * MINUTE, minuteOfDay: 640, day: "d" }).notices.length, 0, "once per stretch");

  const many = { items: Array.from({ length: 20 }, (_, index) => ({ id: `q${index}`, kind: "question", title: `Q${index}` })) };
  const flood = remote.alerts({ memory: { ...memory, needs: [] }, snapshot: held, needs: many, settings, now: NOW, minuteOfDay: 600, day: "d" });
  assert.equal(flood.notices.length, remote.NOTICES_PER_HOUR);
  const next = remote.alerts({ memory: flood.memory, snapshot: held, needs: many, settings, now: NOW + MINUTE, minuteOfDay: 601, day: "d" });
  assert.equal(next.notices.length, 0, "the rest wait for the next hour");
  const hourLater = remote.alerts({ memory: next.memory, snapshot: held, needs: many, settings, now: NOW + 61 * MINUTE, minuteOfDay: 661, day: "d" });
  assert.equal(hourLater.notices.filter((row) => row.kind === "needs-you").length, 20 - remote.NOTICES_PER_HOUR);
});
