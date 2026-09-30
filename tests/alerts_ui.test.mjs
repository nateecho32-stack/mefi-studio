// Notifications in the page (renderer/alerts.js): the Settings › General card's
// real template markup, the real host behind the bridge (tests/fixtures/
// alerts-host.mjs: real rules, fake clock and Notification) and the real
// script. The owner sees the seven switches, the quiet hours as a switch and
// two times (the Discord remote's own), the two kinds of words with a sample,
// and the test button, which waits for them to look away; a notification that is
// clicked opens its task, else Home. A page with no host hides the card.
//
// Run: node --test tests/alerts_ui.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { domWith, templatePiece } from "./fixtures/parse-html.mjs";
import { SECOND, world } from "./fixtures/alerts-host.mjs";

const source = await readFile(new URL("../renderer/alerts.js", import.meta.url), "utf8");
const template = (await readFile(new URL("../renderer/booklet.template.html", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const cardMarkup = templatePiece('<details class="settings-optional settings-card" id="settings-notifications"', '<details class="settings-optional settings-card" id="settings-community">');

const inflight = new Set();
const track = (promise) => { inflight.add(promise); promise.finally(() => inflight.delete(promise)); return promise; };
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function settle() {
  const deadline = Date.now() + 5000;
  for (let quiet = 0; quiet < 3 && Date.now() < deadline;) {
    if (inflight.size) { await Promise.race([Promise.allSettled([...inflight]), new Promise((resolve) => setTimeout(resolve, 50))]); quiet = 0; }
    else { await tick(); quiet += 1; }
  }
}

// A page over a host. `worldOptions` shape the host's world (settings, looked, env ...).
async function page(t, { bridge = true, vibe = true, worldOptions = {}, get = null } = {}) {
  const fixture = world(worldOptions);
  const w = fixture.w;
  const dom = domWith(cardMarkup);
  const calls = [], remote = [], opens = [], navs = [], entered = [];
  const window = {
    MefiNav: { go: (id, params) => navs.push([id, params]) },
    MefiVibe: { landing: () => (vibe ? "vibe" : "build"), enter: () => entered.push("vibe") },
    MefiWorkspace: { enter: () => entered.push("workspace") },
    ...(bridge ? { mefiStudio: {
      alertsGet: () => { calls.push("get"); return get ? get() : track(fixture.host.state()); },
      alertsSet: (patch) => { calls.push(["set", patch]); return track(fixture.host.set(patch)); },
      alertsTest: () => { calls.push("test"); return track(fixture.host.test()); },
      onRemoteEvent: (callback) => remote.push(callback),
      onAlertsOpen: (callback) => opens.push(callback),
    } } : {}),
  };
  vm.runInContext(source, vm.createContext({ window, document: dom.document, console }));
  const get$ = dom.get;
  const card = get$("settings-notifications");
  const open = async () => { card.open = true; await card.trigger("toggle"); await settle(); };
  const plain = (value) => JSON.parse(JSON.stringify(value));
  const flip = async (id, on) => { const box = get$(id); box.checked = on; await box.trigger("change"); await settle(); };
  const pick = async (id, value) => { const select = get$(id); select.value = value; await select.trigger("change"); await settle(); };
  const switches = () => Object.fromEntries(["on", "need", "fail", "done", "flash", "badge", "sound"].map((key) => [key, get$(`alerts-${key}`).checked]));
  t.after(() => fixture.host.close());
  return { w, host: fixture.host, advance: fixture.advance, dom, get: get$, card, open, calls, remote, opens, navs, entered, window, flip, pick, switches, plain, alerts: window.MefiAlerts };
}

test("the card is one of General's, found by Search through its words, and a page with no host hides it", async (t) => {
  const general = template.indexOf('id="settings-category-general"');
  const next = template.indexOf('id="settings-category-appearance"');
  const at = template.indexOf('id="settings-notifications"');
  assert.ok(general >= 0 && at > general && at < next, "the card sits in the General pane");
  assert.ok(template.indexOf('id="settings-studio"') < at && at < template.indexOf('id="settings-community"'), "after Profile & startup, before Community");
  assert.match(template, /<p>Names, startup, notifications and community<\/p>/);
  const p = await page(t);
  const summary = p.card.querySelector("summary").textContent;
  assert.match(summary, /^Notifications/);
  for (const word of ["Windows", "alerts", "taskbar", "flash", "count", "quiet hours"]) assert.ok(summary.toLowerCase().includes(word.toLowerCase()), `Search finds the card by "${word}"`);
  assert.match(template, /<symbol id="g-bell"/, "the bell glyph is in the sprite");
  const bare = await page(t, { bridge: false });
  assert.equal(bare.card.hidden, true);
  await bare.open();
  assert.deepEqual(bare.calls, []);
});

test("nothing is read until the card opens; then it shows the defaults: need and failed on, finished off, flash and count on, quiet off, generic words", async (t) => {
  const p = await page(t);
  assert.deepEqual(p.calls, [], "nothing at launch");
  await p.open();
  assert.deepEqual(p.calls, ["get"]);
  assert.deepEqual(p.switches(), { on: true, need: true, fail: true, done: false, flash: true, badge: true, sound: false });
  assert.equal(p.get("alerts-quiet").checked, false);
  assert.equal(p.get("alerts-quiet-times").hidden, true, "no hours to pick while quiet hours are off");
  assert.deepEqual([p.get("alerts-quiet-from").value, p.get("alerts-quiet-to").value], ["22:00", "07:00"]);
  const buttons = p.get("alerts-titles").querySelectorAll("button");
  assert.deepEqual(buttons.map((button) => [button.dataset.value, button.getAttribute("aria-pressed")]), [["generic", "true"], ["titles", "false"]]);
  assert.equal(p.get("alerts-sample-title").textContent, "Something needs you");
  assert.equal(p.get("alerts-sample-body").textContent, "A task is waiting for your answer.");
  assert.match(p.get("alerts-titles-note").textContent, /^Windows keeps notification text in its history/);
  assert.equal(p.get("alerts-note").hidden, true);
  assert.equal(p.get("alerts-test").disabled, false);
  assert.equal(p.get("alerts-rows").classList.contains("is-dim"), false);
  assert.equal(p.get("alerts-sound").checked, false, "no sound unless asked");
});

test("a switch saves and the card follows the host's answer; the master switch dims the rest and leaves it usable", async (t) => {
  const p = await page(t);
  await p.open();
  await p.flip("alerts-done", true);
  assert.deepEqual(p.plain(p.calls.at(-1)), ["set", { done: true }]);
  assert.equal(p.w.settings.alerts.done, true);
  assert.equal(p.switches().done, true);
  await p.flip("alerts-flash", false);
  assert.equal(p.w.settings.alerts.flash, false);
  await p.flip("alerts-sound", true);
  assert.equal(p.w.settings.alerts.sound, true);
  await p.flip("alerts-on", false);
  assert.equal(p.w.settings.alerts.on, false);
  assert.equal(p.get("alerts-rows").classList.contains("is-dim"), true, "the rows under the master switch are dimmed");
  assert.equal(p.get("alerts-need").disabled, false, "but can still be set for when it is turned back on");
  await p.flip("alerts-on", true);
  assert.equal(p.get("alerts-rows").classList.contains("is-dim"), false);
  assert.deepEqual(p.plain(p.w.settings.alerts), { on: true, need: true, fail: true, done: true, flash: false, badge: true, sound: true, titles: "generic" });
  // A second window's change shows the next time the card opens.
  await p.host.set({ need: false });
  p.card.open = false;
  await p.open();
  assert.equal(p.get("alerts-need").checked, false);
});

test("quiet hours are a switch and two times, written to the Discord remote's own setting", async (t) => {
  const p = await page(t, { worldOptions: { settings: { remote: { on: true, name: "Studio PC", quiet: null } } } });
  await p.open();
  await p.flip("alerts-quiet", true);
  assert.deepEqual(p.plain(p.calls.at(-1)), ["set", { quiet: { on: true } }]);
  assert.deepEqual(p.plain(p.w.settings.remote), { on: true, name: "Studio PC", quiet: { from: "22:00", to: "07:00" } });
  assert.equal(p.get("alerts-quiet-times").hidden, false, "the times appear when the switch is on");
  assert.equal(p.w.remotePushes, 1, "the Friends card is told");
  await p.pick("alerts-quiet-from", "23:00");
  assert.deepEqual(p.plain(p.calls.at(-1)), ["set", { quiet: { on: true, from: "23:00", to: "07:00" } }]);
  assert.deepEqual(p.plain(p.w.settings.remote.quiet), { from: "23:00", to: "07:00" });
  await p.pick("alerts-quiet-to", "06:00");
  assert.deepEqual(p.plain(p.w.settings.remote.quiet), { from: "23:00", to: "06:00" });
  assert.equal(p.w.settings.alerts, undefined, "no second copy of the hours");
  await p.pick("alerts-quiet-to", "23:00");
  assert.deepEqual(p.plain(p.w.settings.remote.quiet), { from: "23:00", to: "06:00" }, "a window that starts and ends together is refused, and the card goes back to what is saved");
  assert.equal(p.get("alerts-quiet-to").value, "06:00");
  await p.flip("alerts-quiet", false);
  assert.equal(p.w.settings.remote.quiet, null);
  assert.equal(p.get("alerts-quiet-times").hidden, true);
  assert.deepEqual(p.plain(p.w.settings.remote), { on: true, name: "Studio PC", quiet: null }, "the rest of the remote's settings untouched");
});

test("hours saved from the Friends card show as they are, even off the hour", async (t) => {
  const p = await page(t, { worldOptions: { settings: { remote: { quiet: { from: "22:30", to: "07:15" } } } } });
  await p.open();
  assert.equal(p.get("alerts-quiet").checked, true);
  assert.equal(p.get("alerts-quiet-times").hidden, false);
  assert.deepEqual([p.get("alerts-quiet-from").value, p.get("alerts-quiet-to").value], ["22:30", "07:15"]);
  const options = p.get("alerts-quiet-from").querySelectorAll("option");
  assert.equal(options.length, 25, "the 24 hours and the one saved time");
  assert.equal(options.at(-1).textContent, "10:30 PM");
  assert.equal(p.get("alerts-quiet-to").querySelectorAll("option").at(-1).textContent, "7:15 AM");
});

test("what a notification says: generic by default, task titles when chosen, with the warning and a sample", async (t) => {
  const p = await page(t);
  await p.open();
  const [generic, titles] = p.get("alerts-titles").querySelectorAll("button");
  await titles.click();
  await settle();
  assert.deepEqual(p.plain(p.calls.at(-1)), ["set", { titles: "titles" }]);
  assert.equal(p.w.settings.alerts.titles, "titles");
  assert.deepEqual([generic.getAttribute("aria-pressed"), titles.getAttribute("aria-pressed")], ["false", "true"]);
  assert.match(p.get("alerts-titles-note").textContent, /^The notification names the task and the question\. Anyone who can see your screen or your notification history can read it\.$/);
  assert.equal(p.get("alerts-sample-body").textContent, "Search notes by tag: Should #Work and #work count as the same tag?");
  await generic.click();
  await settle();
  assert.equal(p.w.settings.alerts.titles, "generic");
  assert.equal(p.get("alerts-sample-body").textContent, "A task is waiting for your answer.");
});

test("Send me a test notification: sent at once when Studio is away, and the card says what to do when it is not", async (t) => {
  const away = await page(t);
  await away.open();
  await away.get("alerts-test").click();
  await settle();
  assert.equal(away.w.shown.length, 1);
  assert.deepEqual([away.w.shown[0].options.title, away.w.shown[0].options.body], ["Test notification", "Alerts are working. Nothing needs you."]);
  assert.match(away.get("alerts-status").textContent, /^Sent\. If it did not appear, Windows may be holding notifications back/);
  assert.equal(away.get("alerts-test").disabled, false, "and the button is back");

  const front = await page(t, { worldOptions: { looked: true } });
  await front.open();
  const clicked = front.get("alerts-test").click();
  await tick();
  assert.match(front.get("alerts-status").textContent, /^Sending… If Studio is in front, switch to another window/);
  assert.equal(front.get("alerts-test").disabled, true, "one test at a time");
  await front.get("alerts-test").click();
  assert.equal(front.calls.filter((call) => call === "test").length, 1, "a second click while one waits does nothing");
  assert.equal(front.w.shown.length, 0, "nothing sent to a window being looked at");
  front.w.looked = false;
  front.host.away();
  await clicked;
  await settle();
  assert.equal(front.w.shown.length, 1, "it arrives as the owner looks away");
  assert.match(front.get("alerts-status").textContent, /^Sent\./);
  assert.equal(front.get("alerts-test").disabled, false);

  const stayed = await page(t, { worldOptions: { looked: true } });
  await stayed.open();
  const waiting = stayed.get("alerts-test").click();
  await tick();
  await stayed.advance(61 * SECOND);
  await waiting;
  await settle();
  assert.equal(stayed.get("alerts-status").textContent, "Studio stayed in front, so no test notification was sent.");
  assert.equal(stayed.get("alerts-test").disabled, false);
});

test("the test says why when notifications are off", async (t) => {
  const p = await page(t, { worldOptions: { settings: { alerts: { on: false } } } });
  await p.open();
  await p.get("alerts-test").click();
  await settle();
  assert.equal(p.get("alerts-status").textContent, "Windows notifications are off in Settings › Notifications.");
  assert.equal(p.w.shown.length, 0);
});

test("the kill switch shows why everything is off and disables what cannot work", async (t) => {
  const p = await page(t, { worldOptions: { env: { MEFI_STUDIO_NO_ALERTS: "1" } } });
  await p.open();
  assert.equal(p.get("alerts-note").hidden, false);
  assert.equal(p.get("alerts-note").textContent, "Turned off for this session by MEFI_STUDIO_NO_ALERTS.");
  for (const id of ["alerts-on", "alerts-need", "alerts-done", "alerts-flash", "alerts-badge", "alerts-sound", "alerts-quiet", "alerts-test"]) assert.equal(p.get(id).disabled, true, id);
  assert.equal(p.get("alerts-on").checked, true, "the saved choice is shown as it is; the environment wins for this session");
  const unsupported = await page(t, { worldOptions: { supported: false } });
  await unsupported.open();
  assert.equal(unsupported.get("alerts-note").textContent, "Windows notifications are not available on this PC.");
});

test("a change in the Discord remote's quiet hours shows here without reopening the card", async (t) => {
  const p = await page(t);
  await p.open();
  assert.equal(p.get("alerts-quiet").checked, false);
  p.remote[0]({ ok: true, settings: { on: true, quiet: { from: "21:00", to: "06:00" } } });
  assert.equal(p.get("alerts-quiet").checked, true);
  assert.deepEqual([p.get("alerts-quiet-from").value, p.get("alerts-quiet-to").value], ["21:00", "06:00"]);
  assert.equal(p.get("alerts-quiet-times").hidden, false);
  p.remote[0]({ ok: true, settings: { on: true, quiet: null } });
  assert.equal(p.get("alerts-quiet").checked, false);
  assert.equal(p.get("alerts-quiet-times").hidden, true);
  assert.equal(p.get("alerts-quiet-from").value, "21:00", "the hours it had are kept for when it is turned back on");
  assert.doesNotThrow(() => { p.remote[0](null); p.remote[0]({ ok: true }); p.remote[0]({ settings: { on: true } }); }, "a status that says nothing about quiet hours changes nothing");
  assert.equal(p.calls.filter((call) => call === "get").length, 1, "and none of it read the host again");
});

test("a click on a notification opens its task in its project, else Home; the test leaves Studio in front", async (t) => {
  const p = await page(t);
  assert.equal(p.opens.length, 1, "the page listens from the start");
  p.opens[0]({ kind: "need", id: "q1", taskId: "t1", projectId: "project_a" });
  assert.deepEqual(p.plain(p.navs), [["tasks", { taskId: "t1", projectId: "project_a", filter: "all" }]]);
  p.opens[0]({ kind: "fail", id: "t9", taskId: "t9", projectId: null });
  assert.deepEqual(p.plain(p.navs.at(-1)), ["tasks", { taskId: "t9", filter: "all" }], "no project named, none sent");
  p.opens[0]({ kind: "need", id: "q2", taskId: null, projectId: "project_a" });
  assert.deepEqual(p.entered, ["vibe"], "a question about nothing in particular goes Home, where what needs you is shown");
  p.opens[0]({ kind: "test", id: null, taskId: null, projectId: null });
  assert.equal(p.navs.length, 2);
  assert.deepEqual(p.entered, ["vibe"], "nothing to open for the test");
  const build = await page(t, { vibe: false });
  build.opens[0]({ kind: "need", id: "q3", taskId: null, projectId: null });
  assert.deepEqual(build.entered, ["workspace"], "Build's Home when Studio starts there");
  assert.doesNotThrow(() => { p.opens[0](null); p.opens[0]({}); p.opens[0]({ taskId: 5 }); });
  p.window.MefiNav = null;
  assert.doesNotThrow(() => p.opens[0]({ kind: "need", taskId: "t1" }), "a page without its navigation cannot open anything and says nothing");
});

test("a read that fails says so, and the card stays usable", async (t) => {
  const refused = await page(t, { get: async () => ({ ok: false, error: "Notifications are not available in this build." }) });
  await refused.open();
  assert.equal(refused.get("alerts-note").hidden, false);
  assert.equal(refused.get("alerts-note").textContent, "Notifications are not available in this build.");
  const broken = await page(t, { get: () => Promise.reject(new Error("the bridge went away")) });
  await broken.open();
  assert.match(broken.get("alerts-note").textContent, /^Notifications could not be read: the bridge went away$/);
  const unsaved = await page(t);
  await unsaved.open();
  unsaved.window.mefiStudio.alertsSet = () => Promise.resolve({ ok: false, error: "The settings file is read-only." });
  await unsaved.flip("alerts-done", true);
  assert.equal(unsaved.get("alerts-status").textContent, "The settings file is read-only.");
  assert.equal(unsaved.get("alerts-done").checked, false, "the card goes back to what the host has");
});
