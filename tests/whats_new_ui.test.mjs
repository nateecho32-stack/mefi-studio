// What's new in the page (renderer/whats-new.js): the toast rule the owner set,
// walked through against the real host block (tests/fixtures/whats-new-host.mjs)
// and the real template markup for the sheet and the Settings › Updates list. A
// first install is silent; an update shows one toast with a What's new action
// and never opens the sheet by itself; the toast is not repeated at the next
// launch; Got it (or Esc, or the close button) is remembered; the kill switch
// and the switch in Settings silence it; Read opens any version's notes without
// moving what has been read backwards.
//
// Run: node --test tests/whats_new_ui.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { domWith, templatePiece } from "./fixtures/parse-html.mjs";
import { launch } from "./fixtures/whats-new-host.mjs";

const source = await readFile(new URL("../renderer/whats-new.js", import.meta.url), "utf8");
const updatesMarkup = templatePiece('<p class="settings-eyebrow">What\'s new</p>', "</div>\n        </details>");
const sheetMarkup = templatePiece('<div id="whats-new-sheet"', "<!-- The tab pages' header");

// The host reads a real notes file, so waiting is by the calls themselves: every
// bridge call is tracked, and settle() returns once none is in flight (twice in
// a row, since one answer can start the next call).
const inflight = new Set();
const track = (promise) => { inflight.add(promise); promise.finally(() => inflight.delete(promise)); return promise; };
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function settle() {
  for (let quiet = 0, turn = 0; quiet < 2 && turn < 2000; turn += 1) {
    await tick();
    quiet = inflight.size ? 0 : quiet + 1;
  }
}

// One page load, talking to one host. Pass `host` to reuse a host's settings for a second launch.
function page(t, { host = null, hostOptions = {}, search = "", hidden = false, bridge = true } = {}) {
  const the = host ?? launch(t, hostOptions);
  const dom = domWith(updatesMarkup, sheetMarkup);
  dom.document.hidden = hidden;
  const toasts = [];
  const opened = [];
  const records = [];
  const timers = [];
  const window = {
    location: { search },
    MefiToast: (message, kind, options) => { toasts.push({ message, kind, options }); return { dismiss() {} }; },
    MefiNav: { register: (record) => { records.push(record); return record; } },
    open: (url) => opened.push(url),
    ...(bridge ? { mefiStudio: {
      releaseWhatsNew: () => track(the.call("release:whats-new")),
      releaseWhatsNewSeen: (payload) => track(the.call("release:whats-new-seen", { version: payload?.version, how: payload?.how === "announce" ? "announce" : "read" })),
      releaseWhatsNewSet: (on) => track(the.call("release:whats-new-set", { on: on === true })),
      openExternal: (url) => { opened.push(url); return { ok: true }; },
    } } : {}),
  };
  const context = vm.createContext({ window, document: dom.document, console, setTimeout: (run) => { timers.push(run); return timers.length; }, requestAnimationFrame: (run) => run() });
  vm.runInContext(source, context);
  const get = dom.get;
  const flush = async () => { for (const run of timers.splice(0)) run?.(); await settle(); };
  const texts = (id) => get(id).querySelectorAll("li").map((node) => node.textContent);
  return { host: the, dom, get, window, toasts, opened, records, flush, texts, whatsNew: window.MefiWhatsNew, sheet: get("whats-new-sheet") };
}

test("a first install is silent: no toast, no sheet, and its notes are already read", async (t) => {
  const p = page(t, { hostOptions: { existed: false } });
  await p.flush();
  assert.deepEqual(p.toasts, []);
  assert.equal(p.sheet.hidden, true);
  assert.equal(p.get("whats-new-list").querySelectorAll(".whats-new-fresh").length, 0, "nothing is marked New");
  assert.equal(p.host.state.settings.whatsNew.seen, "0.5.0");
});

test("an update shows one toast with a What's new action, never opens the sheet by itself, and does not repeat at the next launch", async (t) => {
  const p = page(t, { hostOptions: { settings: { projects: [] } } });
  await p.whatsNew.refresh();
  assert.equal(p.sheet.hidden, true, "loading the page opens nothing");
  await p.flush();
  assert.equal(p.toasts.length, 1, "one toast");
  assert.match(p.toasts[0].message, /Studio updated to 0\.5\.0\./);
  assert.equal(p.toasts[0].kind, "info");
  assert.equal(p.toasts[0].options.action.label, "What's new");
  assert.equal(p.sheet.hidden, true, "the toast does not open the sheet by itself");
  assert.equal(p.host.state.settings.whatsNew.announced, "0.5.0", "the host was told it was said");

  assert.equal(await p.whatsNew.announce(), false, "not twice in one page");
  assert.equal(p.toasts.length, 1);

  const next = page(t, { host: p.host });
  await next.flush();
  assert.deepEqual(next.toasts, [], "and not at the next launch either");
  assert.equal(next.get("whats-new-list").querySelectorAll(".whats-new-fresh").length, 1, "but Settings › Updates still marks the unread notes New");
});

test("the toast's action opens the sheet for this version, with the version before it dimmed; Got it closes it and is remembered", async (t) => {
  const p = page(t, { hostOptions: { settings: { projects: [] } } });
  await p.flush();
  await p.toasts[0].options.action.run();
  assert.equal(p.sheet.hidden, false);
  assert.equal(p.get("whats-new-title").textContent, "What's new in 0.5.0");
  assert.deepEqual(p.texts("whats-new-notes"), ["One calm shell.", "Windows tells you when something needs you."]);
  assert.equal(p.get("whats-new-before").hidden, false);
  assert.equal(p.get("whats-new-before-head").textContent, "Before that · 0.4.4");
  assert.deepEqual(p.texts("whats-new-before-notes"), ["Setup is one sign-in."]);
  assert.equal(p.get("whats-new-ok").focused, true, "focus lands on Got it");

  await p.get("whats-new-ok").click();
  await settle();
  assert.equal(p.sheet.hidden, true);
  assert.equal(p.host.state.settings.whatsNew.seen, "0.5.0", "Got it is remembered");
  assert.equal(p.get("whats-new-list").querySelectorAll(".whats-new-fresh").length, 0, "and the New mark goes");
  const next = page(t, { host: p.host });
  await next.flush();
  assert.deepEqual(next.toasts, []);
});

test("Esc and the close button also count as read; a click on the backdrop closes it; Tab stays inside", async (t) => {
  const p = page(t, { hostOptions: { settings: { projects: [] } } });
  await p.flush();
  p.whatsNew.open("0.5.0");
  const escape = { key: "Escape", preventDefault() {}, stopPropagation() {} };
  await p.dom.document.body.trigger("keydown", escape);
  await settle();
  assert.equal(p.sheet.hidden, true, "Esc closes it");
  assert.equal(p.host.state.settings.whatsNew.seen, "0.5.0");

  p.whatsNew.open("0.5.0");
  await p.get("whats-new-close").click();
  assert.equal(p.sheet.hidden, true);
  p.whatsNew.open("0.5.0");
  await p.sheet.click({ target: p.sheet });
  assert.equal(p.sheet.hidden, true, "the backdrop closes it");

  p.whatsNew.open("0.5.0");
  const stops = p.sheet.querySelectorAll("button");
  assert.ok(stops.length >= 3, "close, full changelog, Got it");
  p.dom.document.activeElement = stops.at(-1);
  await p.dom.document.body.trigger("keydown", { key: "Tab", shiftKey: false, preventDefault() {}, stopPropagation() {} });
  assert.equal(stops[0].focused, true, "Tab from the last button wraps to the first");
  await p.dom.document.body.trigger("keydown", { key: "Tab", shiftKey: true, preventDefault() {}, stopPropagation() {} });
});

test("Read opens any version's notes, and reading an older version never moves what has been read backwards", async (t) => {
  const p = page(t, { hostOptions: { settings: { whatsNew: { on: true, seen: "0.5.0", announced: "0.5.0" } } } });
  await p.flush();
  assert.deepEqual(p.toasts, []);
  const rows = p.get("whats-new-list").querySelectorAll(".whats-new-row");
  assert.equal(rows.length, 2, "0.5.0 and 0.4.4");
  assert.match(rows[0].querySelector("b").textContent, /^0\.5\.0 · installed/);
  assert.equal(rows[1].querySelector("small").textContent, "Setup is one sign-in.", "each row shows the version's first sentence");
  await rows[1].querySelector("button").click();
  assert.equal(p.get("whats-new-title").textContent, "What's new in 0.4.4");
  assert.equal(p.get("whats-new-before").hidden, true, "nothing older to show");
  await p.get("whats-new-ok").click();
  await settle();
  assert.equal(p.host.state.settings.whatsNew.seen, "0.5.0", "reading 0.4.4 leaves 0.5.0 read");
});

test("the full changelog opens in the browser, and Search lists the notes only while there are some", async (t) => {
  const p = page(t, { hostOptions: { settings: { projects: [] } } });
  await p.flush();
  await p.get("whats-new-changelog").click();
  assert.deepEqual(p.opened, ["https://github.com/nateecho32-stack/mefi-studio/blob/main/CHANGELOG.md"]);
  const [record] = p.records;
  assert.equal(record.id, "release-notes");
  assert.notEqual(record.id, "whats-new", "Vibe already owns that Search record");
  assert.equal(record.hidden(), false);
  record.run();
  assert.equal(p.sheet.hidden, false);
  const none = page(t, { hostOptions: { version: "0.3.0" } });
  await none.flush();
  assert.equal(none.records[0].hidden(), true, "no notes for this build, so nothing to search for");
  assert.match(none.get("whats-new-list").querySelector(".whats-new-empty").textContent, /no notes for 0\.3\.0/i);
  const between = page(t, { hostOptions: { version: "0.4.5", settings: { projects: [] } } });
  await between.flush();
  assert.deepEqual(between.toasts, [], "0.4.5 has no notes of its own, so an update to it says nothing");
  assert.equal(between.records[0].hidden(), true);
});

test("the kill switch says nothing and shows why; the switch in Settings turns it off and on", async (t) => {
  const killed = page(t, { hostOptions: { settings: { projects: [] }, env: { MEFI_STUDIO_NO_WHATS_NEW: "1" } } });
  await killed.flush();
  assert.deepEqual(killed.toasts, []);
  assert.equal(killed.get("whats-new-on").disabled, true);
  assert.equal(killed.get("whats-new-note").hidden, false);
  assert.match(killed.get("whats-new-note").textContent, /MEFI_STUDIO_NO_WHATS_NEW/);
  assert.equal(killed.get("whats-new-list").querySelectorAll(".whats-new-row").length, 2, "the notes stay readable");

  const p = page(t, { hostOptions: { settings: { projects: [] } } });
  await p.whatsNew.refresh();
  const box = p.get("whats-new-on");
  assert.equal(box.checked, true);
  box.checked = false;
  await box.trigger("change", { target: box });
  await settle();
  assert.equal(p.host.state.settings.whatsNew.on, false);
  await p.flush();
  assert.deepEqual(p.toasts, [], "switched off, an update says nothing");
  box.checked = true;
  await box.trigger("change", { target: box });
  await settle();
  assert.equal(p.host.state.settings.whatsNew.on, true);
});

test("a window in the tray waits to be seen, a harness window and a page with no host say nothing", async (t) => {
  const p = page(t, { hostOptions: { settings: { projects: [] } }, hidden: true });
  await p.flush();
  assert.deepEqual(p.toasts, [], "nobody is looking yet");
  p.dom.document.hidden = false;
  await p.dom.document.body.trigger("visibilitychange");
  await settle();
  assert.equal(p.toasts.length, 1, "the toast comes when the window is shown");

  const smoke = page(t, { hostOptions: { settings: { projects: [] } }, search: "?smoke=1" });
  await smoke.flush();
  assert.deepEqual(smoke.toasts, []);
  assert.equal(smoke.host.state.settings.whatsNew, undefined, "and it did not record anything");

  const bare = page(t, { bridge: false });
  await bare.flush();
  assert.deepEqual(bare.toasts, []);
  assert.deepEqual(bare.records, [], "a browser preview with no host registers nothing");
});
