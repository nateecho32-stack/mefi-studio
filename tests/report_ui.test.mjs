// Report a problem in the page (renderer/report.js): the Diagnostics card's
// real template markup, the real host block behind the bridge
// (tests/fixtures/report-host.mjs) and the real modules. The owner sees the
// file list with sizes, previews any file, swaps task titles for numbers, sees
// the crash record only while there is one, saves the zip through the host's
// dialog and is told nothing was uploaded; and after a crash the next start
// shows one toast whose two buttons both clear it and one of them opens the
// card. A page with no host hides the block.
//
// Run: node --test tests/report_ui.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { domWith, templatePiece } from "./fixtures/parse-html.mjs";
import { KEY, crashReport, folder, launch } from "./fixtures/report-host.mjs";

const source = await readFile(new URL("../renderer/report.js", import.meta.url), "utf8");
const cardMarkup = templatePiece('<details class="settings-optional settings-card" id="settings-diagnostics"', "<details class=\"settings-optional settings-card\" id=\"settings-integrations\"");

const inflight = new Set();
const track = (promise) => { inflight.add(promise); promise.finally(() => inflight.delete(promise)); return promise; };
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function settle() {
  // Wall-clock bounded, and it sleeps on the calls in flight instead of spinning
  // on setImmediate: real file reads take as long as they take on a busy machine.
  const deadline = Date.now() + 5000;
  for (let quiet = 0; quiet < 3 && Date.now() < deadline;) {
    if (inflight.size) {
      await Promise.race([Promise.allSettled([...inflight]), new Promise((resolve) => setTimeout(resolve, 50))]);
      quiet = 0;
    } else {
      await tick();
      quiet += 1;
    }
  }
}

// A page over a host launch. `crashOnce` makes the launch before this one a crash.
async function page(t, { crashOnce = false, hostOptions = {}, bridge = true, root = null, launchOptions = {}, gate = false, hidden = false } = {}) {
  const dir = root ?? folder(t);
  if (crashOnce) launch(t, dir, { pid: 50 }).start(); // a session that never closed
  const listeners = [];
  const host = launch(t, dir, { pid: 60, ...hostOptions, onSend: (channel, payload) => { if (channel === "report:crashed") listeners.forEach((listener) => listener(payload)); }, ...launchOptions });
  host.start();
  // The startup gate is above every toast until it is hidden; a window in the tray is `hidden`.
  const dom = domWith(cardMarkup, ...(gate ? ['<div id="boot-layer" role="dialog"></div>'] : []));
  dom.document.hidden = hidden;
  const toasts = [];
  const routes = []; // read through plain(): objects made inside the vm are of another realm
  const opened = [];
  const records = [];
  const calls = [];
  const timers = [];
  const call = (name, channel, payload) => { calls.push(name); return track(host.call(channel, payload)); };
  const window = {
    MefiToast: (message, kind, options) => { toasts.push({ message, kind, options }); return { dismiss() {} }; },
    MefiNav: { go: (id, params) => routes.push([id, params]), register: (record) => { records.push(record); return record; } },
    open: (url) => opened.push(url),
    ...(bridge ? { mefiStudio: {
      reportPreview: (options) => call("reportPreview", "report:preview", { replaceTitles: options?.replaceTitles === true, includeCrash: options?.includeCrash !== false }),
      reportSave: (payload) => call("reportSave", "report:save", { token: String(payload?.token ?? "") }),
      reportDismiss: () => call("reportDismiss", "report:dismiss"),
      reportSet: (payload) => call("reportSet", "report:set", typeof payload?.prompt === "boolean" ? { prompt: payload.prompt } : {}),
      onReportCrashed: (callback) => listeners.push(callback),
      openExternal: (url) => { opened.push(url); return { ok: true }; },
    } } : {}),
  };
  vm.runInContext(source, vm.createContext({ window, document: dom.document, console, setTimeout: (run) => { timers.push(run); return timers.length; } }));
  const get = dom.get;
  const card = get("settings-diagnostics");
  const open = async () => { card.open = true; await card.trigger("toggle"); await settle(); };
  const names = () => get("report-files").querySelectorAll(".report-file-name").map((node) => node.textContent);
  const plain = (value) => JSON.parse(JSON.stringify(value));
  return { dir, host, dom, get, card, open, names, toasts, routes: { get list() { return plain(routes); } }, opened, records, calls, window, report: window.MefiReport, timers, listeners, settle };
}

test("opening the card builds the report: five files with sizes, a preview of the first, the total, and what is never included", async (t) => {
  const p = await page(t, { crashOnce: true });
  assert.deepEqual(p.calls, [], "nothing is built until the card is opened");
  await p.open();
  assert.deepEqual(p.calls, ["reportPreview"]);
  assert.deepEqual(p.names(), ["manifest.json", "tasks-summary.json", "trace-tail.log", "builders.log", "crash.jsonl"]);
  const rows = p.get("report-files").querySelectorAll(".report-file");
  assert.equal(rows.length, 5);
  assert.match(rows[0].querySelector("small").textContent, /Studio version, install kind/);
  assert.match(rows[0].querySelector(".report-file-size").textContent, /^\d+(?:\.\d)? KB$/);
  assert.match(p.get("report-total").textContent, /^5 files, \d+ KB in all\. Task titles are as you wrote them\.$/);
  assert.equal(p.get("report-preview-name").textContent, "manifest.json");
  assert.match(p.get("report-pre").textContent, /"studio": "0\.5\.0"/);
  assert.equal(rows[0].querySelector("button").disabled, true, "the file being viewed says Viewing");
  assert.equal(rows[0].querySelector("button").textContent, "Viewing");
  const never = p.get("report-never").querySelectorAll("li").map((row) => row.textContent);
  assert.equal(never.length, 5);
  assert.match(never[0], /settings\.json.*Holds your project paths/);
  assert.ok(never.some((line) => /vault/i.test(line)) && never.some((line) => /Screenshots and evidence/.test(line)) && never.some((line) => /project's files/.test(line)));
  assert.equal(p.get("report-save").disabled, false);
});

test("Preview shows any file in full, and the text on screen is redacted", async (t) => {
  const p = await page(t);
  await p.open();
  const rows = p.get("report-files").querySelectorAll(".report-file");
  await rows[2].querySelector("button").click();
  assert.equal(p.get("report-preview-name").textContent, "trace-tail.log");
  const trace = p.get("report-pre").textContent;
  assert.match(trace, /loop started for Secret Game/);
  assert.match(trace, /window:boot\.js:12/);
  const everything = p.host.state && p.get("report-pre").textContent;
  assert.ok(!everything.includes(KEY));
  const after = p.get("report-files").querySelectorAll(".report-file");
  assert.equal(after[2].querySelector("button").textContent, "Viewing");
  assert.equal(after[0].querySelector("button").textContent, "Preview");
  await after[3].querySelector("button").click();
  assert.match(p.get("report-pre").textContent, /all green/);
  assert.ok(!p.get("report-pre").textContent.includes("PLANTED0123456789"), "the key in a builder's output is not on screen");
  assert.equal(p.calls.length, 1, "previewing a file reads what is already held, not the host again");
});

test("Replace task titles with numbers rebuilds the report; the crash switch exists only while there is a record", async (t) => {
  const none = await page(t);
  await none.open();
  assert.equal(none.get("report-crash-switch").hidden, true, "no crash, no switch");
  assert.equal(none.get("report-crash").hidden, true);
  assert.deepEqual(none.names(), ["manifest.json", "tasks-summary.json", "trace-tail.log", "builders.log"]);

  const p = await page(t, { crashOnce: true });
  await p.open();
  assert.equal(p.get("report-crash-switch").hidden, false);
  assert.match(p.get("report-crash-label").textContent, /^Include the crash record · from /);
  assert.equal(p.get("report-crash").hidden, false);
  assert.match(p.get("report-crash").textContent, /^Studio closed without saying goodbye on .+\. Studio wrote a small record; it is in this report unless you switch it off\.$/);
  const titles = p.get("report-replace");
  titles.checked = true;
  await titles.trigger("change");
  await p.settle();
  assert.equal(p.calls.filter((name) => name === "reportPreview").length, 2);
  assert.match(p.get("report-total").textContent, /Task titles are numbers\./);
  await p.get("report-files").querySelectorAll(".report-file")[1].querySelector("button").click();
  assert.match(p.get("report-pre").textContent, /"task":"Task 1"/);
  assert.ok(!p.get("report-pre").textContent.includes("Secret Game"));
  const crash = p.get("report-crash-on");
  crash.checked = false;
  await crash.trigger("change");
  await p.settle();
  assert.deepEqual(p.names(), ["manifest.json", "tasks-summary.json", "trace-tail.log", "builders.log"], "switched off, the crash record is not in the list");
  await p.get("report-refresh").click();
  await p.settle();
  assert.equal(p.calls.filter((name) => name === "reportPreview").length, 4, "Read it again builds a fresh one");
});

test("Save zip goes through the host's dialog, says nothing was uploaded and shows the file; a cancel says so; a stale token rebuilds", async (t) => {
  const p = await page(t, { crashOnce: true });
  await p.open();
  await p.get("report-save").click();
  await p.settle();
  assert.match(p.get("report-status").textContent, /^Saved report\.zip \(\d+(?:\.\d)? KB\) and showed it in your file manager\. Nothing was uploaded\.$/);
  assert.equal(p.toasts.at(-1).kind, "good");
  assert.match(p.toasts.at(-1).message, /Nothing was uploaded/);
  const zipPath = p.get("report-status").textContent && path.join(p.dir, "Documents", "report.zip");
  assert.ok(fs.existsSync(zipPath), "the file is on disk where the dialog said");
  assert.deepEqual(p.host.shown, [zipPath], "and shown in the file manager");
  assert.equal(p.get("report-save").disabled, false, "and the button is back");

  const cancelled = await page(t, { crashOnce: true, launchOptions: { dialogPick: { canceled: true } } });
  await cancelled.open();
  await cancelled.get("report-save").click();
  await cancelled.settle();
  assert.equal(cancelled.get("report-status").textContent, "Not saved.");
  assert.equal(fs.existsSync(path.join(cancelled.dir, "Documents")), false);

  const stale = await page(t);
  await stale.open();
  stale.report.state.view.token = "gone";
  await stale.get("report-save").click();
  await stale.settle();
  assert.equal(stale.calls.filter((name) => name === "reportPreview").length, 2, "a report that is no longer held is built again");
});

test("Save is one request at a time: asking again while the dialog is open does nothing", async (t) => {
  const p = await page(t, { crashOnce: true });
  await p.open();
  const first = p.report.save();
  const second = p.report.save();
  await Promise.all([first, second]);
  await p.settle();
  assert.equal(p.calls.filter((name) => name === "reportSave").length, 1);
  assert.equal(p.host.shown.length, 1, "one file, shown once");
});

test("the switch for the prompt follows the host, and the kill switch shows why it is off", async (t) => {
  const p = await page(t, { crashOnce: true });
  await p.open();
  const box = p.get("report-prompt");
  assert.equal(box.checked, true);
  box.checked = false;
  await box.trigger("change", { target: box });
  await p.settle();
  assert.equal(p.host.state.settings.report.prompt, false);
  assert.match(p.get("report-status").textContent, /will not say anything after a crash/);
  box.checked = true;
  await box.trigger("change", { target: box });
  await p.settle();
  assert.equal(p.host.state.settings.report.prompt, true);

  const killed = await page(t, { crashOnce: true, hostOptions: { env: { MEFI_STUDIO_NO_CRASH_PROMPT: "1" } } });
  await killed.open();
  assert.equal(killed.get("report-prompt").disabled, true);
  assert.equal(killed.get("report-prompt-note").hidden, false);
  assert.match(killed.get("report-prompt-note").textContent, /MEFI_STUDIO_NO_CRASH_PROMPT/);
});

test("after a crash the next start shows one toast; Review the report opens the card and clears it, Dismiss clears it", async (t) => {
  const p = await page(t, { crashOnce: true });
  assert.deepEqual(p.toasts, [], "nothing until the host says the page is up");
  assert.equal(await p.host.pageUp(), true);
  assert.equal(p.toasts.length, 1);
  const toast = p.toasts[0];
  assert.equal(toast.kind, "warn");
  assert.equal(toast.message, "Studio closed unexpectedly.", "one short line: the toast sets its text beside two buttons in 380 px");
  assert.equal(toast.options.action.label, "Review the report");
  assert.equal(toast.options.secondary.label, "Dismiss");
  assert.equal(await p.host.pageUp(), false, "said once");
  assert.equal(p.toasts.length, 1);

  toast.options.action.run();
  await p.settle();
  assert.deepEqual(p.routes.list, [["studio", { section: "settings-report" }]], "the report card opens");
  assert.equal(p.host.rows().at(-1).kind, "dismissed", "and the prompt is cleared in the record");
  for (const run of p.timers.splice(0)) run();
  await p.settle();
  assert.ok(p.calls.includes("reportPreview"), "and the report is read as it opens");

  const other = await page(t, { crashOnce: true });
  await other.host.pageUp();
  other.toasts[0].options.secondary.run();
  await other.settle();
  assert.deepEqual(other.routes.list, [], "Dismiss opens nothing");
  assert.equal(other.host.rows().at(-1).kind, "dismissed");
});

test("the prompt waits for the startup gate and for a visible window: a toast under the gate is neither seen nor clickable", async (t) => {
  const p = await page(t, { crashOnce: true, gate: true, hidden: true });
  assert.equal(await p.host.pageUp(), true, "the host says its once");
  assert.deepEqual(p.toasts, [], "a window nobody is looking at says nothing");
  p.dom.document.hidden = false;
  await p.dom.document.body.trigger("visibilitychange");
  assert.deepEqual(p.toasts, [], "and one still behind the gate says nothing either");
  for (let turn = 0; turn < 5; turn += 1) for (const run of p.timers.splice(0)) run();
  assert.deepEqual(p.toasts, [], "it keeps waiting while the gate is up");
  p.get("boot-layer").hidden = true;
  for (const run of p.timers.splice(0)) run();
  assert.equal(p.toasts.length, 1, "the gate is gone: one toast");
  assert.equal(p.toasts[0].options.secondary.label, "Dismiss");
  assert.deepEqual(p.timers, [], "and nothing is left polling");

  // A window in the tray with no gate at all: nobody is looking yet, so nothing is said until it is shown.
  const tray = await page(t, { crashOnce: true, hidden: true });
  await tray.host.pageUp();
  assert.deepEqual(tray.toasts, [], "a window nobody is looking at says nothing");
  tray.dom.document.hidden = false;
  await tray.dom.document.body.trigger("visibilitychange");
  assert.equal(tray.toasts.length, 1, "and says it once when it is shown");

  // The wait is bounded: a launch that never leaves the gate stops asking, and the card still has the record.
  const stuck = await page(t, { crashOnce: true, gate: true });
  await stuck.host.pageUp();
  let rounds = 0;
  while (stuck.timers.length && rounds < 1000) { for (const run of stuck.timers.splice(0)) run(); rounds += 1; }
  assert.ok(rounds >= 100 && rounds < 1000, `the poll is slow and finite (${rounds} rounds)`);
  assert.deepEqual(stuck.toasts, []);
  await stuck.open();
  assert.match(stuck.get("report-crash").textContent, /Studio closed without saying goodbye/, "the card still says what happened");

  // No gate in the page at all (a harness window, a browser preview): straight away.
  const open = await page(t, { crashOnce: true });
  await open.host.pageUp();
  assert.equal(open.toasts.length, 1);
});

test("Search reaches Report a problem, the Discord invite opens outside Studio, and a page with no host hides the block", async (t) => {
  const p = await page(t);
  const [record] = p.records;
  assert.equal(record.id, "settings:report");
  assert.equal(record.label, "Settings › System › Report a problem");
  record.run();
  assert.deepEqual(p.routes.list.at(-1), ["studio", { section: "settings-report" }]);
  await p.get("report-discord").click();
  assert.deepEqual(p.opened, ["https://discord.gg/xgfKc5pVxG"]);

  const bare = await page(t, { bridge: false });
  assert.equal(bare.get("settings-report").hidden, true);
  assert.deepEqual(bare.records, []);
  await bare.open();
  assert.deepEqual(bare.calls, []);
});

test("the crash rows the page can name are the ones the host can write", () => {
  const words = [...source.matchAll(/^\s+"([a-z-]+)": "[^"]+",?$/gm)].map((match) => match[1]);
  assert.deepEqual(words.sort(), [...crashReport.CRASH_KINDS].sort(), "every kind has a sentence, and there is no sentence for a kind that does not exist");
});

test("in the 0.5 layout Report a problem is its own Settings place: opening Diagnostics, which no longer holds it, builds nothing, and the place builds it when it shows", async (t) => {
  const p = await page(t);
  // renderer/booklet.js moves the report out of Diagnostics into its own place.
  const report = p.get("settings-report");
  report.remove();
  p.dom.document.body.append(report);
  await p.open();
  assert.deepEqual(p.calls, [], "opening Diagnostics alone builds no report");
  await p.report.load();
  await p.settle();
  assert.deepEqual(p.calls, ["reportPreview"], "the place's own load builds it");
  assert.deepEqual(p.names(), ["manifest.json", "tasks-summary.json", "trace-tail.log", "builders.log"]);
});
