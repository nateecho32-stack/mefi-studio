// scripts/report-host.cjs: the host half of Report a problem and the crash
// prompt, run against a real temp folder with the real rules and zip writer
// and stubbed dialogs, windows and settings. The session story is walked as a
// sequence of launches: a clean quit, an update restart and a roll back never
// prompt; a session that never closed prompts once, once per crash, and not at
// all with the kill switch or the setting off, while the record is still
// written. The report is previewed, then saved as exactly what was previewed,
// only where the Save dialog says, and sent nowhere.
//
// Run: node --test tests/report_host.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { extractZip } from "../scripts/release-updater.mjs";

const require = createRequire(import.meta.url);
const rep = require("../scripts/crash-report.cjs");
const zipLite = require("../scripts/zip-lite.cjs");
const { createReportHost, CRASH_FILE_MAX, PROMPT_DELAY_MS, RECORD_GAP_MS } = require("../scripts/report-host.cjs");

const START = Date.UTC(2026, 8, 30, 12, 0, 0);

// One folder of data, shared by every launch of one test; each launch is a new host with a new pid.
function world(t) {
  const root = fs.mkdtempSync(path.join(tmpdir(), "mefi-report-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 }));
  const state = { now: START, settings: {}, sent: [], logs: [], dialogs: [], shown: [], pick: null, collectFails: false, ids: 0 };
  const dataDir = path.join(root, "data");
  const documents = path.join(root, "Documents");
  const launch = ({ pid = 100 + state.ids, install = "portable", env = {}, updateResult = null } = {}) => {
    const updateResultPath = path.join(root, `update-result-${pid}.json`);
    if (updateResult) fs.writeFileSync(updateResultPath, JSON.stringify(updateResult));
    const host = createReportHost({
      fs, rep, zip: zipLite, dataDir, updateResultPath, env, pid, version: "0.5.0", install,
      now: () => state.now,
      collect: async () => {
        if (state.collectFails) throw new Error("the board could not be read");
        return {
          studio: { version: "0.5.0", install }, os: { platform: "win32", release: "10", arch: "x64" }, project: { name: "Moonlight Harbor" },
          tasks: [{ id: "t1", title: "Fix the Moonlight Harbor login", status: "done", verification: { state: "verified", checks: { total: 2, passed: 2, failed: 0 } }, builder: "Codex", updatedAt: state.now }],
          trace: [{ at: state.now, level: "warn", source: "exec", text: "sk-ant-api03-PLANTED0123456789abcdefghij used by C:\\Users\\Nate\\x.ts" }],
          builderRuns: [], scrub: { roots: [{ path: "C:\\Users\\Nate", label: "~" }], names: [] },
        };
      },
      // The OS dialog only ever answers with a folder that exists.
      showSaveDialog: async (parent, options) => {
        state.dialogs.push({ parent, options });
        const answer = state.pick ?? { canceled: false, filePath: path.join(documents, "picked.zip") };
        if (!answer.canceled && path.dirname(answer.filePath) === documents) fs.mkdirSync(documents, { recursive: true });
        return answer;
      },
      showItemInFolder: (file) => state.shown.push(file), documentsPath: () => documents, getWindow: () => "the-window",
      send: (payload) => state.sent.push(payload), readSettings: async () => structuredClone(state.settings),
      updateSettings: async (mutate) => { const next = structuredClone(state.settings); if ((await mutate(next)) === false) return; state.settings = next; },
      log: (line) => state.logs.push(line), id: () => `token${(state.ids += 1)}`,
    });
    return host;
  };
  const rows = () => (fs.existsSync(path.join(dataDir, "crash.jsonl")) ? rep.parseRows(fs.readFileSync(path.join(dataDir, "crash.jsonl"), "utf8")) : []);
  const marker = () => rep.parseMarker(fs.readFileSync(path.join(dataDir, "session-marker.json"), "utf8"));
  return { root, dataDir, documents, state, launch, rows, marker };
}

test("the first launch writes a running marker and says nothing", async (t) => {
  const w = world(t);
  const host = w.launch({ pid: 100 });
  const verdict = host.boot();
  assert.equal(verdict.crashed, false);
  assert.deepEqual([w.marker().state, w.marker().pid, w.marker().startedAt, w.marker().install], ["running", 100, START, "portable"]);
  assert.equal(await host.pageUp(), false);
  assert.deepEqual(w.state.sent, []);
  assert.deepEqual(w.rows(), []);
});

test("a clean quit never prompts, and neither does an update restart or a roll back (both are exits with code 0)", async (t) => {
  for (const why of ["quit", "exit", "session-end", "update", "rollback"]) {
    const w = world(t);
    const first = w.launch({ pid: 100 });
    first.boot();
    w.state.now += 60000;
    assert.equal(first.end(why), true, why);
    assert.equal(w.marker().state, "closed");
    assert.equal(w.marker().why, why);
    const second = w.launch({ pid: 101 });
    assert.equal(second.boot().crashed, false, why);
    assert.equal(await second.pageUp(), false);
    assert.deepEqual(w.state.sent, [], why);
    assert.deepEqual(w.rows(), [], "and nothing is written down");
  }
});

test("a session that never closed prompts once: at the first page, not at a reload, and dismissing clears it", async (t) => {
  const w = world(t);
  w.launch({ pid: 100 }).boot();
  w.state.now += 3600000; // it ran for an hour and then vanished
  const next = w.launch({ pid: 101 });
  const verdict = next.boot();
  assert.deepEqual([verdict.crashed, verdict.prompt, verdict.kind], [true, true, "no-clean-exit"]);
  assert.deepEqual(w.rows().map((row) => [row.kind, row.session]), [["no-clean-exit", START]], "the record says so, tied to the session that ended");
  assert.equal(w.marker().pid, 101, "and this launch has its own marker");
  assert.equal(await next.pageUp(), true);
  assert.deepEqual(w.state.sent, [{ at: START, kind: "no-clean-exit" }]);
  assert.equal(await next.pageUp(), false, "the page loaded again: it is not said twice");
  assert.equal(w.state.sent.length, 1);
  const state = await next.state();
  assert.deepEqual([state.crash?.kind, state.crashes, state.pending], ["no-clean-exit", 1, false]);

  // Nobody clicked; the app then quits cleanly and starts again: still nothing more to say.
  next.end("quit");
  const third = w.launch({ pid: 102 });
  assert.equal(third.boot().crashed, false);
  assert.equal(await third.pageUp(), false);
  assert.equal(w.state.sent.length, 1);
});

test("dismiss clears the prompt before it is sent and leaves a mark in the record", async (t) => {
  const w = world(t);
  w.launch({ pid: 100 }).boot();
  const next = w.launch({ pid: 101 });
  next.boot();
  assert.deepEqual(next.dismiss(), { ok: true, dismissed: true });
  assert.equal(await next.pageUp(), false, "cleared, so nothing is said");
  assert.equal(w.rows().at(-1).kind, "dismissed");
  assert.deepEqual(next.dismiss(), { ok: true, dismissed: false }, "and again changes nothing");
  assert.equal(rep.bundleCrashRows(w.rows(), { now: w.state.now }).length, 1, "the crash itself stays in the record for the report");
});

test("what the last session wrote down decides the kind, and only that session's rows count", async (t) => {
  const w = world(t);
  const first = w.launch({ pid: 100 });
  first.boot();
  w.state.now += 5000;
  assert.equal(first.record("renderer-unresponsive", "the window stopped responding"), true);
  w.state.now += RECORD_GAP_MS + 1;
  assert.equal(first.record("main-exception", "TypeError: x is not a function", { origin: "uncaughtException" }), true);
  assert.equal(first.record("invented", "no"), false, "only known kinds are written");
  assert.deepEqual(w.rows().map((row) => [row.kind, row.session]), [["renderer-unresponsive", START], ["main-exception", START]]);
  const next = w.launch({ pid: 101 });
  const verdict = next.boot();
  assert.deepEqual([verdict.kind, verdict.recorded], ["main-exception", true]);
  assert.equal(w.rows().length, 2, "a session that wrote its own crash down does not get a second row");
  await next.pageUp();
  assert.deepEqual(w.state.sent, [{ at: START + 5000 + RECORD_GAP_MS + 1, kind: "main-exception" }]);
});

test("a hang is one row, not one per second; the file never grows past its cap", async (t) => {
  const w = world(t);
  const host = w.launch({ pid: 100 });
  host.boot();
  for (let index = 0; index < 5; index += 1) { w.state.now += 1000; host.record("renderer-unresponsive", "still hung"); }
  assert.equal(w.rows().length, 1, "five hang events inside the gap are one row");
  for (let index = 0; index < 900; index += 1) { w.state.now += RECORD_GAP_MS + 1; host.record("renderer-gone", `crashed ${index} ${"x".repeat(60)}`); }
  const size = fs.statSync(path.join(w.dataDir, "crash.jsonl")).size;
  assert.ok(size <= CRASH_FILE_MAX + 1000, `${size} bytes`);
  assert.ok(w.rows().length <= rep.LIMITS.crashRows + 100, `trimmed to the newest rows once it grew (${w.rows().length})`);
  assert.match(w.rows().at(-1).detail, /crashed 899/, "the newest row is kept");
});

test("the kill switch and the setting stop the prompt, and the record is still written", async (t) => {
  const killed = world(t);
  killed.launch({ pid: 100 }).boot();
  const a = killed.launch({ pid: 101, env: { MEFI_STUDIO_NO_CRASH_PROMPT: "1" } });
  a.boot();
  assert.equal(await a.pageUp(), false);
  assert.deepEqual(killed.state.sent, []);
  assert.equal(killed.rows().length, 1, "the record may still be written");
  assert.equal((await a.state()).killed, true);

  const off = world(t);
  off.launch({ pid: 100 }).boot();
  const b = off.launch({ pid: 101 });
  b.boot();
  assert.equal((await b.setPrompt(false)).prompt, false);
  assert.equal(off.state.settings.report.prompt, false);
  assert.equal(await b.pageUp(), false);
  assert.deepEqual(off.state.sent, []);
  assert.equal((await b.setPrompt("yes")).ok, false);
  assert.equal((await b.setPrompt(true)).prompt, true);

  const on = world(t);
  on.launch({ pid: 100 }).boot();
  const c = on.launch({ pid: 101, env: { MEFI_STUDIO_NO_CRASH_PROMPT: "0" } });
  c.boot();
  assert.equal(await c.pageUp(), true, "only 1 turns the switch on");
});

test("an update that did not start and was rolled back is recorded, not prompted", async (t) => {
  const w = world(t);
  w.launch({ pid: 100 }).boot();
  const next = w.launch({ pid: 101, updateResult: { ok: false, rolledBack: true, stage: "boot", from: "0.5.0", to: "0.5.1", at: START } });
  const verdict = next.boot();
  assert.deepEqual([verdict.crashed, verdict.prompt, verdict.kind], [true, false, "update-rolled-back"]);
  assert.equal(await next.pageUp(), false);
  assert.deepEqual(w.state.sent, []);
  assert.deepEqual(w.rows().map((row) => row.kind), ["update-rolled-back"], "the record says what happened, for a report");
});

test("a development run that was only stopped is not a crash", async (t) => {
  const w = world(t);
  w.launch({ pid: 100, install: "source" }).boot();
  const next = w.launch({ pid: 101, install: "source" });
  assert.equal(next.boot().crashed, false);
  assert.equal(await next.pageUp(), false);
  assert.deepEqual(w.rows(), []);
});

test("a torn marker, a torn record and an unwritable folder never stop a launch", async (t) => {
  const torn = world(t);
  fs.mkdirSync(torn.dataDir, { recursive: true });
  fs.writeFileSync(path.join(torn.dataDir, "session-marker.json"), '{"state":"runni');
  fs.writeFileSync(path.join(torn.dataDir, "crash.jsonl"), '{"at":5,"kind":"renderer-gone"}\n{"at":');
  const host = torn.launch({ pid: 101 });
  assert.equal(host.boot().crashed, false, "an unreadable marker is no evidence");
  assert.equal(torn.marker().state, "running", "and it is replaced");

  const blocked = world(t);
  fs.writeFileSync(blocked.dataDir, "a file where the folder should be");
  const stuck = blocked.launch({ pid: 100 });
  assert.doesNotThrow(() => stuck.boot());
  assert.equal(stuck.end("quit"), false);
  assert.equal(stuck.record("renderer-gone", "x"), false);
  assert.ok(blocked.state.logs.some((line) => /could not write/.test(line)), "it says so in the log");
  assert.ok(blocked.state.logs.every((line) => !line.includes(blocked.dataDir) && !line.includes(tmpdir())), "and names the failure by its code, never with the path an fs message carries");
  assert.ok(blocked.state.logs.some((line) => /\((?:ENOTDIR|EEXIST|EACCES|ENOENT)\)/.test(line)), "the code is there");
});

test("the preview lists every file with its size and text; the text is redacted; nothing is written by looking", async (t) => {
  const w = world(t);
  const host = w.launch({ pid: 100 });
  host.boot();
  host.record("renderer-gone", "crashed");
  const view = await host.preview({});
  assert.equal(view.ok, true);
  assert.deepEqual(view.files.map((file) => file.name), ["manifest.json", "tasks-summary.json", "trace-tail.log", "builders.log", "crash.jsonl"]);
  for (const file of view.files) assert.equal(file.bytes, Buffer.byteLength(file.text), `${file.name}: the size is the size of the text shown`);
  assert.equal(view.total, view.files.reduce((sum, file) => sum + file.bytes, 0));
  const text = view.files.map((file) => file.text).join("\n");
  assert.ok(!text.includes("PLANTED0123456789") && !text.includes("C:\\Users\\Nate"), "the planted key and home folder are not in what the owner reads");
  assert.deepEqual(view.never.map((item) => item.name), rep.NEVER_INCLUDED.map((item) => item.name));
  assert.deepEqual(view.crash, { at: START, kind: "renderer-gone" });
  assert.deepEqual([view.prompt, view.killed, view.replaceTitles, view.includeCrash], [true, false, false, true]);
  assert.ok(text.includes("Moonlight Harbor"), "titles are in it by default");
  const numbered = await host.preview({ replaceTitles: true, includeCrash: false });
  assert.ok(!numbered.files.map((file) => file.text).join("\n").includes("Moonlight"), "and gone when asked");
  assert.equal(numbered.files.some((file) => file.name === "crash.jsonl"), false);
  assert.equal(fs.existsSync(w.documents), false, "looking wrote nothing");
  w.state.collectFails = true;
  assert.match((await host.preview({})).error, /could not be built/);
});

test("Save writes exactly the previewed bundle, where the dialog says, then shows it; it sends nothing anywhere", async (t) => {
  const w = world(t);
  const host = w.launch({ pid: 100 });
  host.boot();
  host.record("renderer-gone", "crashed");
  const view = await host.preview({});
  w.state.now += 60000;
  // The trace has moved on since, but what is saved is what was read.
  const saved = await host.save({ token: view.token });
  assert.equal(saved.ok, true, saved.error);
  assert.equal(saved.path, path.join(w.documents, "picked.zip"));
  assert.deepEqual(saved.files, view.files.map((file) => file.name));
  assert.deepEqual(w.state.shown, [saved.path], "shown in the file manager");
  const dialog = w.state.dialogs[0];
  assert.equal(dialog.parent, "the-window");
  assert.equal(dialog.options.defaultPath, path.join(w.documents, "Studio-report-2026-09-30.zip"), "Documents and a dated name are only where the dialog starts");
  assert.deepEqual(dialog.options.filters, [{ name: "Zip archive", extensions: ["zip"] }]);
  const out = path.join(w.root, "out");
  await extractZip(saved.path, out);
  for (const file of view.files) assert.equal(fs.readFileSync(path.join(out, file.name), "utf8"), file.text, `${file.name} is what the owner read`);
  assert.deepEqual(fs.readdirSync(w.documents), ["picked.zip"], "no temp file is left behind");
  assert.ok(w.state.logs.some((line) => /nothing was sent/.test(line)));
});

test("Save refuses what was not previewed or has gone stale, adds .zip, and cancelling writes nothing", async (t) => {
  const w = world(t);
  const host = w.launch({ pid: 100 });
  host.boot();
  for (const token of [undefined, "", "guess", "token999"]) assert.equal((await host.save({ token })).stale, true, String(token));
  const view = await host.preview({});
  w.state.now += 16 * 60 * 1000;
  assert.equal((await host.save({ token: view.token })).stale, true, "a read report is held for fifteen minutes");
  const again = await host.preview({});
  w.state.pick = { canceled: true, filePath: undefined };
  assert.deepEqual(await host.save({ token: again.token }), { ok: false, canceled: true });
  assert.equal(fs.existsSync(w.documents), false, "nothing was written");
  w.state.pick = { canceled: false, filePath: path.join(w.documents, "no-extension") };
  const saved = await host.save({ token: again.token });
  assert.equal(saved.path, path.join(w.documents, "no-extension.zip"));
  w.state.pick = { canceled: false, filePath: path.join(w.root, "nowhere", "deeper", "r.zip") };
  assert.match((await host.save({ token: again.token })).error, /was not saved/, "a folder that cannot be written is an error, not a crash");
  for (let index = 0; index < 5; index += 1) await host.preview({});
  assert.equal((await host.save({ token: again.token })).stale, true, "only the last few previews are kept");
});

test("nothing in the report modules can send anything: no network, no processes", () => {
  for (const file of ["scripts/report-host.cjs", "scripts/crash-report.cjs", "scripts/zip-lite.cjs"]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(source, /require\(\s*["'](?:node:)?(?:https?|net|tls|dgram|dns|child_process|worker_threads)["']\s*\)|\bfetch\s*\(|\bWebSocket\b|XMLHttpRequest|sendBeacon|openExternal/, `${file} has no way to send anything`);
  }
  assert.ok(PROMPT_DELAY_MS >= 1000, "the prompt waits for the page");
});
