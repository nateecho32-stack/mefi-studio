// main.cjs's "Log core" block, run from main.cjs's own text in a vm over a
// real temporary folder: lines logged before the core starts wait and are
// written in order, a studio line keeps Trace's level and source, a worker's
// own output is kept at debug level only, Trace's older pages come back as
// its rows (oldest first) with a cursor, the switches (MEFI_STUDIO_LOG_CORE=0,
// settings.logs.keep, settings.logs.level), a smoke launch's own folder, and
// the exit path. The hooks around main.cjs are pinned at the end.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";

const require = createRequire(import.meta.url);
// The block requires its modules the way main.cjs does, from the app's root.
const rootRequire = createRequire(new URL("../main.cjs", import.meta.url));
const trace = require("../scripts/trace.cjs");
const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
};
const block = section("// ---- Log core ----", "// ---- end of the log core ----");

async function host(t, { env = {}, settings = {}, smoke = false } = {}) {
  const base = await mkdtemp(path.join(os.tmpdir(), "mefi-logcore-host-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const local = path.join(base, "local-dir");
  const userData = path.join(base, "userData");
  const logged = [];
  const context = vm.createContext({
    require: rootRequire, trace, path, os, console,
    process: { env: { MEFI_STUDIO_LOCAL_DIR: local, ...env }, platform: process.platform, pid: process.pid },
    optionalHelper: (_request, load) => load(),
    readSettings: async () => settings,
    app: { getPath: () => userData },
    SMOKE: smoke, CAPTURE: false,
    traceStudio: trace.ring(100),
    logLine: (line) => logged.push(line),
  });
  vm.runInContext(`${block}\nthis.api = { logCorePersist, logCoreStart, logCoreFlushSync, logCoreSettings, logCoreFolder, logCoreReadPage, state: () => ({ logCore, logCoreOff, early: logCoreEarly.length, where: logCoreWhere }) };`, context);
  const onDisk = async (dir) => {
    const files = await readdir(dir).catch(() => []);
    const text = (await Promise.all(files.filter((name) => name.endsWith(".jsonl")).map((name) => readFile(path.join(dir, name), "utf8")))).join("");
    return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  };
  return { api: context.api, logged, local, userData, onDisk, context };
}

test("lines before the start wait, then reach the local folder in order with Trace's level and source", async (t) => {
  const h = await host(t);
  h.api.logCorePersist("studio", "[boot] window up");
  h.api.logCorePersist("studio", "[autopilot] run failed: exit 1");
  assert.equal(h.api.state().early, 2);
  const core = await h.api.logCoreStart();
  assert.ok(core, h.api.state().logCoreOff);
  assert.equal(h.api.state().where.rule, "env");
  assert.equal(h.api.logCoreFolder(), path.join(h.local, "logs"));
  h.api.logCorePersist("studio", "[builder] working", { echo: true, run: "run_1", task: "task_1" });
  h.api.logCorePersist("assistant", "error: no route", { lvl: "error", src: "overseer" });
  h.api.logCorePersist("renderer", "Uncaught TypeError", { lvl: "error", src: "tasks.js:12" });
  await core.flush();
  const records = await h.onDisk(path.join(h.local, "logs"));
  assert.deepEqual(records.map((record) => [record.ch, record.lvl, record.src, record.msg]), [
    ["studio", "info", trace.sourceOf("[boot] window up"), "[boot] window up"],
    ["studio", trace.levelOf("[autopilot] run failed: exit 1"), trace.sourceOf("[autopilot] run failed: exit 1"), "[autopilot] run failed: exit 1"],
    ["assistant", "error", "overseer", "error: no route"],
    ["renderer", "error", "tasks.js:12", "Uncaught TypeError"],
  ], "a worker's own output is under the default threshold");
  assert.match(h.logged.at(-1), /^\[logs\] the studio log is kept in /);
  h.api.logCoreFlushSync();
  await assert.rejects(readFile(path.join(h.local, "logs", "log.lock")), /ENOENT/, "the exit path lets go of the folder");
});

test("Trace's older pages come back as its rows, oldest first, filtered, with a cursor", async (t) => {
  const h = await host(t);
  const core = await h.api.logCoreStart();
  const start = Date.now() - 100000;
  for (let at = 0; at < 12; at += 1) h.api.logCorePersist("studio", at % 4 === 0 ? `[release] update failed ${at}` : `[autopilot] line ${at}`, { t: start + at });
  h.api.logCorePersist("assistant", "note: not the studio channel", { t: start + 5 });
  h.api.logCorePersist("studio", "[builder] output", { echo: true, t: start + 6 });
  await core.flush();
  const page = await h.api.logCoreReadPage({ before: start + 12, tail: 5 });
  assert.equal(page.ok, true);
  assert.deepEqual(page.rows.map((row) => row.text), ["[autopilot] line 7", "[release] update failed 8", "[autopilot] line 9", "[autopilot] line 10", "[autopilot] line 11"]);
  assert.deepEqual(Object.keys(page.rows[0]).sort(), ["at", "level", "source", "text"], "the shape trace.query rows have");
  assert.equal(page.older, true);
  const next = await h.api.logCoreReadPage({ before: page.next, tail: 100 });
  assert.deepEqual(next.rows.map((row) => row.text.split(" ").at(-1)), ["0", "1", "2", "3", "4", "5", "6"], "the cursor continues exactly, and the other channel and the worker output stay out");
  assert.equal(next.done, true);
  const problems = await h.api.logCoreReadPage({ before: start + 100, tail: 100, problems: true });
  assert.deepEqual(problems.rows.map((row) => row.level), problems.rows.map(() => trace.levelOf("[release] update failed 0")));
  assert.ok(problems.rows.length === 3 && problems.rows.every((row) => row.text.includes("failed")), JSON.stringify(problems.rows));
  const bySource = await h.api.logCoreReadPage({ before: start + 100, tail: 100, sources: [trace.sourceOf("[release] update failed 0")] });
  assert.equal(bySource.rows.length, 3);
  assert.deepEqual({ ...(await h.api.logCoreReadPage({ before: "nonsense" })) }, { ok: false, channel: "studio", error: "Older lines need a time or a cursor." });
  await core.close();
});

test("MEFI_STUDIO_LOG_CORE=0 keeps the log in memory only, as before", async (t) => {
  const h = await host(t, { env: { MEFI_STUDIO_LOG_CORE: "0" } });
  h.api.logCorePersist("studio", "[boot] up");
  assert.equal(h.api.state().early, 0);
  assert.equal(await h.api.logCoreStart(), null);
  assert.equal(h.api.logCoreFolder(), null);
  assert.deepEqual(await readdir(h.local).catch(() => []), []);
  assert.equal((await h.api.logCoreReadPage({ before: Date.now() })).ok, false);
});

test("settings.logs.keep off keeps nothing, a save turns it back on, and settings.logs.level reaches the core", async (t) => {
  const off = await host(t, { settings: { logs: { keep: false } } });
  off.api.logCorePersist("studio", "[boot] up");
  assert.equal(await off.api.logCoreStart(), null);
  assert.equal(off.api.state().logCoreOff, "settings.logs.keep is off");
  off.api.logCoreSettings({ logs: { keep: true } });
  assert.equal(off.api.state().logCoreOff, null, "the next launch keeps it again");

  const h = await host(t);
  const core = await h.api.logCoreStart();
  h.api.logCoreSettings({ logs: { keep: false } });
  h.api.logCorePersist("studio", "[autopilot] while off");
  h.api.logCoreSettings({ logs: { keep: true, level: "debug" } });
  h.api.logCorePersist("studio", "[builder] output now kept", { echo: true });
  await core.flush();
  const records = await h.onDisk(path.join(h.local, "logs"));
  assert.ok(!records.some((record) => record.msg.includes("while off")));
  assert.ok(records.some((record) => record.msg === "[builder] output now kept" && record.lvl === "debug"));
  await core.close();
});

test("a smoke or capture launch keeps its log under its own profile, never the owner's folder", async (t) => {
  const h = await host(t, { smoke: true });
  const core = await h.api.logCoreStart();
  assert.equal(h.api.state().where.rule, "chosen");
  assert.equal(h.api.logCoreFolder(), path.join(h.userData, "local", "logs"));
  assert.deepEqual(await readdir(h.local).catch(() => []), [], "MEFI_STUDIO_LOCAL_DIR is not touched");
  await core.close();
});

test("a flood before the start keeps the newest lines and says how many could not wait", async (t) => {
  const h = await host(t);
  for (let at = 0; at < 5010; at += 1) h.api.logCorePersist("studio", `[autopilot] early ${at}`);
  assert.equal(h.api.state().early, 5000);
  const core = await h.api.logCoreStart();
  await core.flush();
  const records = await h.onDisk(path.join(h.local, "logs"));
  assert.equal(records[0].msg, "[logs] 10 early lines could not be kept on disk");
  assert.equal(records[1].msg, "[autopilot] early 10");
  assert.equal(records.filter((record) => record.msg.startsWith("[autopilot] early")).length, 5000);
  await core.close();
});

test("main.cjs hooks: every log path persists, Trace pages through traceRead, the core starts after launch and closes on every exit", () => {
  assert.match(source, /function logLine\(line, meta = null\) \{[\s\S]{0,700}if \(typeof logCorePersist === "function"\) logCorePersist\("studio", text, meta\);/);
  assert.match(source, /logLine\(`\[\$\{runLabel\}\] \$\{read\.plain\}`, \{ echo: true, run: entry\.id, task: job\.ref\?\.id \?\? null \}\);/, "a worker's output is marked");
  assert.match(source, /if \(typeof logCorePersist === "function"\) logCorePersist\("assistant", `\$\{kind\}: \$\{entry\.text\}`/);
  assert.match(source, /if \(typeof logCorePersist === "function"\) logCorePersist\("renderer", /);
  assert.match(source, /if \(typeof logCoreStart === "function"\) setTimeout\(\(\) => \{ void logCoreStart\(\); \}, LOG_CORE_START_MS\)\.unref\?\.\(\);/);
  assert.ok((source.match(/if \(typeof logCoreFlushSync === "function"\) logCoreFlushSync\(\);/g) ?? []).length >= 3, "a restart, an update and process exit");
  const write = section("async function writeSettings(", "// One verdict for every settings.json read");
  assert.equal((write.match(/logCoreSettings\(next\)/g) ?? []).length, 2, "under the Rust host and in the Electron build");
  const read = section("async function traceRead(", "\n}\n");
  assert.match(read, /if \(channel !== "studio" \|\| typeof logCoreReadPage !== "function"\) return \{ ok: false, channel, error: "Older lines are kept for the studio log only\." \};/);
  assert.match(read, /older: channel === "studio" && Boolean\(read\?\.file\)/);
  assert.ok(source.indexOf("// ---- Log core ----") < source.indexOf("function logLine("), "declared before anything can log");
  assert.ok(!/^const logCoreModule|require\("\.\/scripts\/log-core\.cjs"\);$/m.test(source.slice(0, source.indexOf("// ---- Log core ----"))), "no eager require at startup");
});
