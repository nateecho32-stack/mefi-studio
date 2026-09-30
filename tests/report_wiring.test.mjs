// main.cjs's "Report a problem" block, sliced out and run against stubs with the
// real modules (tests/fixtures/report-host.mjs): what the four report:* channels
// answer, what the report is made from (and that a saved key or the project list
// in settings never is), which process events close the session marker and which
// write the crash record, and that the hooks in the window, the quit and the
// first page are where the story needs them. The launches are real sequences
// over a real temp folder: a quit, an update restart (exit code 0) and a crash.
//
// Run: node --test tests/report_wiring.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { extractZip } from "../scripts/release-updater.mjs";
import { KEY, block, folder, handlers, launch, main, preload } from "./fixtures/report-host.mjs";

test("four channels: the report's own reading and saving wait for a project switch, the prompt's state does not; the bridge names exactly those", () => {
  const found = [...handlers.matchAll(/ipcMain\.handle\("(report:[a-z-]+)"/g)].map((match) => match[1]);
  assert.deepEqual(found, ["report:preview", "report:save", "report:dismiss", "report:set"]);
  const appWide = main.match(/const APP_WIDE_CHANNELS = new Set\(\[([^\]]*)\]\)/)[1];
  assert.match(appWide, /"report:dismiss"/);
  assert.match(appWide, /"report:set"/);
  assert.doesNotMatch(appWide, /"report:preview"/, "the report reads the open project's tasks and log");
  assert.doesNotMatch(appWide, /"report:save"/);
  assert.doesNotMatch(main.match(/const APP_WIDE_PREFIXES = \[([^\]]*)\]/)[1], /"report:"/);
  for (const channel of found) assert.match(preload, new RegExp(`ipcRenderer\\.invoke\\("${channel}"`), `${channel} has a bridge entry`);
  assert.match(preload, /onReportCrashed: \(callback\) => ipcRenderer\.on\("report:crashed"/);
  assert.match(preload, /reportSet: \(payload\) => ipcRenderer\.invoke\("report:set", typeof payload\?\.prompt === "boolean" \? \{ prompt: payload\.prompt \} : \{\}\)/, "the bridge never turns the prompt off by leaving a field out");
  assert.match(main, /send\("report:crashed", payload\)/, "main sends the one push");
});

test("the hooks are where the story needs them: the window, the quit, the first page and the start", () => {
  assert.match(main, /window\.webContents\.on\("render-process-gone", \(_event, details\) => \{ if \(details\?\.reason !== "clean-exit"\) reportRecord\("renderer-gone"/);
  assert.match(main, /window\.on\("unresponsive", \(\) => reportRecord\("renderer-unresponsive"/);
  assert.match(main, /window\.on\("session-end", \(\) => reportEnd\("session-end"\)\);/);
  assert.match(main, /endSession\("quit"\);\n  if \(typeof reportEnd === "function"\) reportEnd\("quit"\);/, "a quit closes the marker beside the session record, guarded: suites that run the quit handler on its own do not have it");
  assert.match(main, /window\.webContents\.once\("did-finish-load", \(\) => setTimeout\(\(\) => \{ reportHost\?\.pageUp\(\)/, "the prompt waits for the first page, once");
  assert.match(main, /registerIpc\(\);\n  bootHealthStart\(\);\n  reportStart\(\);/, "the marker starts with the app, after the boot record");
  assert.match(block, /process\.on\("exit", \(code\) => \{ if \(code === 0\) reportEnd\("exit"\); \}\)/);
  assert.match(block, /process\.on\("uncaughtExceptionMonitor"/, "a monitor, not a handler: main's own error dialog is untouched");
  assert.doesNotMatch(block, /process\.on\("uncaughtException"/);
});

test("harness windows, the CLI modes and a build without the modules keep no marker and answer that reports are unavailable", async (t) => {
  for (const mode of [{ smoke: true }, { cli: true }, { missing: true }]) {
    const root = folder(t);
    const h = launch(t, root, { mode });
    h.start();
    assert.equal(h.marker(), null, JSON.stringify(mode));
    assert.deepEqual(await h.call("report:preview", {}), { ok: false, error: "Reports are not available in this build." });
    assert.deepEqual(await h.call("report:dismiss"), { ok: false, error: "Reports are not available in this build." });
    h.events.process.get("exit")(0);
    assert.equal(h.marker(), null, "and closing writes nothing either");
  }
});

test("the story over real launches: a quit, an update restart (exit code 0) and a crash", async (t) => {
  const root = folder(t);
  const a = launch(t, root, { pid: 100 });
  a.start();
  assert.equal(a.marker().state, "running");
  // The updater's app.exit(0): no before-quit, only the process's own exit event.
  a.events.process.get("exit")(0);
  assert.deepEqual([a.marker().state, a.marker().why], ["closed", "exit"]);
  const b = launch(t, root, { pid: 101 });
  b.start();
  assert.equal(await b.pageUp(), false, "an update restart says nothing");
  // A failing exit code, then a start: it never closed.
  b.events.process.get("exit")(1);
  assert.equal(b.marker().state, "running");
  const bStarted = b.marker().startedAt;
  const c = launch(t, root, { pid: 102 });
  c.start();
  assert.equal(await c.pageUp(), true);
  assert.deepEqual(c.sent, [["report:crashed", { at: bStarted, kind: "no-clean-exit" }]]);
  assert.equal(await c.pageUp(), false, "once per crash");
  // A crash with a record: the kind is what was written down.
  c.events.process.get("uncaughtExceptionMonitor")(new TypeError("x is not a function"), "uncaughtException");
  c.events.app.get("child-process-gone")({}, { type: "Utility", reason: "crashed", exitCode: 1 });
  c.events.app.get("child-process-gone")({}, { type: "GPU", reason: "clean-exit", exitCode: 0 });
  assert.deepEqual(c.rows().filter((row) => row.session === c.marker().startedAt).map((row) => row.kind), ["main-exception"], "a utility process and a clean GPU exit are not written down");
  const d = launch(t, root, { pid: 103 });
  d.start();
  assert.equal(await d.pageUp(), true);
  assert.equal(d.sent[0][1].kind, "main-exception");
  assert.match(d.rows().at(-1).detail ?? d.rows().find((row) => row.kind === "main-exception").detail, /TypeError: x is not a function/);
});

test("the kill switch is read from the environment, and the setting from the card", async (t) => {
  const root = folder(t);
  launch(t, root, { pid: 100 }).start();
  const killed = launch(t, root, { pid: 101, env: { MEFI_STUDIO_NO_CRASH_PROMPT: "1" } });
  killed.start();
  assert.equal(await killed.pageUp(), false);
  assert.equal(killed.rows().length, 1, "the record is written all the same");
  const state = await killed.call("report:set", { prompt: false });
  assert.equal(state.prompt, false);
  assert.equal(killed.state.settings.report.prompt, false);
  assert.equal((await killed.call("report:set", {})).ok, false, "a call that says neither on nor off changes nothing");
});

test("the report is made from the board, the log and the run ledger only: no key, no project list, no archived task", async (t) => {
  const root = folder(t);
  const h = launch(t, root);
  h.start();
  const view = await h.call("report:preview", { replaceTitles: false, includeCrash: true });
  assert.equal(view.ok, true, view.error);
  const text = view.files.map((file) => file.text).join("\n");
  assert.ok(!text.includes("PLANTED0123456789"), "a saved key and a task's stray field never reach it");
  assert.ok(!text.includes("C:\\Users\\Nate"), "the home folder is gone");
  assert.ok(!text.includes("NATE-PC") && !/\bNate\b/.test(text));
  assert.ok(!text.includes("Archived one"), "an archived task is not in the summary");
  assert.ok(!text.includes("projects"), "the project list in settings is not read");
  const manifest = JSON.parse(view.files[0].text);
  assert.deepEqual([manifest.studio, manifest.install, manifest.route.provider, manifest.route.models, manifest.builder.cli, manifest.os.platform], ["0.5.0", "portable", "claude", { heavy: "opus-5-5" }, "claude", "win32"], "the route and builder in use, and only model names");
  assert.match(view.files[1].text, /Claude Code · Sonnet 5\.5/);
  assert.match(view.files[2].text, /files {2}opened ~\\Documents\\notes\.txt for <user> on <pc>/, "this PC's home folder (here one the shared scrubber cannot know: a redirected profile), user name and PC name are each removed by main's own list");
  assert.ok(!text.includes("D:\\Profiles"), "the redirected home is gone");
  assert.match(view.files[2].text, /loop started for Secret Game/, "the project's name stays unless the owner asks for numbers");
  assert.match(view.files[2].text, /window:boot\.js:12  TypeError in the window/, "the window's own warnings ride along, tagged");
  assert.match(view.files[3].text, /all green/);
  assert.ok(!view.files[3].text.includes(KEY));
  const numbered = await h.call("report:preview", { replaceTitles: true });
  assert.ok(!numbered.files.map((file) => file.text).join("\n").includes("Secret Game"));
  assert.match(numbered.files[2].text, /loop started for Project 1/);
});

test("Save goes through the dialog, writes exactly what was read and shows it; a stale token and a cancel change nothing", async (t) => {
  const root = folder(t);
  const h = launch(t, root);
  h.start();
  const view = await h.call("report:preview", {});
  const saved = await h.call("report:save", { token: view.token });
  assert.equal(saved.ok, true, saved.error);
  assert.deepEqual(h.shown, [saved.path]);
  assert.match(saved.path, /report\.zip$/);
  const out = path.join(root, "extracted");
  await extractZip(saved.path, out);
  for (const file of view.files) assert.equal(fs.readFileSync(path.join(out, file.name), "utf8"), file.text);
  assert.equal((await h.call("report:save", { token: "not-a-token" })).stale, true);
  assert.equal((await h.call("report:save", { token: 5 })).stale, true, "a token that is not text is no token");
  const cancelled = launch(t, folder(t), { dialogPick: { canceled: true } });
  cancelled.start();
  const again = await cancelled.call("report:preview", {});
  assert.deepEqual(await cancelled.call("report:save", { token: again.token }), { ok: false, canceled: true });
});
