// Launch timings (scripts/startup-marks.cjs and main.cjs's "Startup marks"
// block): main's marks and the page's land on one timeline, each page gives
// one [startup] line for Trace, and the first also the --startup-report file.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import marksModule from "../scripts/startup-marks.cjs";

const { createStartupMarks, reportPath, normalizePage, buildReport, formatLine, LIMITS } = marksModule;
// The block's own require, as main.cjs resolves it.
const require = createRequire(new URL("../main.cjs", import.meta.url));
const main = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const preload = (await readFile(new URL("../preload.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const section = (start, end) => {
  const from = main.indexOf(start), to = main.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `main boundary: ${start}`);
  return main.slice(from, to);
};
const flush = async () => { for (let count = 0; count < 20; count += 1) await Promise.resolve(); };

// Main started at ORIGIN; the page's navigation began 400 ms later.
const ORIGIN = 1_790_000_000_000.25;
const PAGE = ORIGIN + 400;
const page = (overrides = {}) => ({
  origin: PAGE,
  marks: { html: 60, "first-paint": 290, "first-contentful-paint": 300.04, script: 780, gate: 900, dcl: 1020, choose: 1021, chosen: 1026, release: 1840, ...overrides.marks },
  steps: overrides.steps ?? [
    { id: "workspace", start: 1030, end: 1311, ok: true, tries: 1 },
    { id: "catalog", start: 1030, end: 1200, ok: true, tries: 1 },
    { id: "tree", start: 1030, end: 1600, ok: true, tries: 1 },
    { id: "view", start: 1030, end: 1390, ok: true, tries: 1 },
    { id: "fonts", start: 1030, end: 1040, ok: true, tries: 1 },
  ],
  complete: overrides.complete ?? true,
});
function collector({ argv = [], env = {}, write } = {}) {
  let now = 95.2;
  const lines = [], writes = [];
  const listeners = new Map();
  const contents = { once: (name, fn) => listeners.set(name, fn) };
  const marks = createStartupMarks({
    origin: ORIGIN, now: () => now, argv, env,
    log: (line) => lines.push(line),
    write: write ?? (async (file, report) => { writes.push({ file, report }); }),
    about: () => ({ version: "0.4.5", platform: "win32" }),
  });
  return { marks, lines, writes, contents, listeners, at: (value) => { now = value; } };
}

test("reportPath: --startup-report <file>, --startup-report=<file>, then MEFI_STUDIO_STARTUP_REPORT", () => {
  assert.equal(reportPath(["electron", ".", "--startup-report", "C:\\temp\\r.json"], {}), "C:\\temp\\r.json");
  assert.equal(reportPath(["electron", ".", "--startup-report=out/r.json"], {}), "out/r.json");
  assert.equal(reportPath(["electron", "."], { MEFI_STUDIO_STARTUP_REPORT: " r.json " }), "r.json");
  assert.equal(reportPath(["electron", ".", "--startup-report", "a.json"], { MEFI_STUDIO_STARTUP_REPORT: "b.json" }), "a.json", "the command line wins");
  assert.equal(reportPath(["electron", ".", "--startup-report", "--smoke"], {}), null, "a flag is not a file name");
  assert.equal(reportPath(["electron", ".", "--startup-report="], {}), null);
  assert.equal(reportPath(["electron", "."], {}), null);
  assert.equal(reportPath(undefined, undefined), null);
});

test("main's marks: created marks main, the first of each mark wins, and watch() takes the window's own events", () => {
  const h = collector();
  h.at(380.06); h.marks.mark("ready");
  h.at(900); h.marks.mark("ready");
  h.marks.mark("not-a-main-mark");
  h.at(402.7); h.marks.watch(h.contents);
  h.at(1421); h.listeners.get("dom-ready")();
  h.at(1650); h.listeners.get("did-finish-load")();
  h.at(2000); h.listeners.get("dom-ready")();
  assert.deepEqual(h.marks.marks(), { main: 95.2, ready: 380.1, window: 402.7, "dom-ready": 1421, "did-finish-load": 1650 });
});

test("the page's marks join main's on one timeline, and the Trace line and the report follow", async () => {
  const h = collector({ argv: ["electron", ".", "--startup-report", "startup.json"] });
  h.at(380); h.marks.mark("ready");
  h.at(395.2); h.marks.watch(h.contents);
  h.at(1425); h.listeners.get("dom-ready")();
  h.at(2100); h.listeners.get("did-finish-load")();
  assert.deepEqual(h.marks.receive(page()), { ok: true, reload: false });
  await flush();
  const report = h.marks.report();
  assert.equal(report.version, 1);
  assert.equal(report.launchedAt, new Date(ORIGIN).toISOString());
  assert.deepEqual(report.about, { version: "0.4.5", platform: "win32" });
  assert.deepEqual(Object.keys(report.marks), ["main", "ready", "window", "navigation", "html", "first-paint", "first-contentful-paint", "script", "gate", "dcl", "choose", "dom-ready", "chosen", "did-finish-load", "release"], "in time order");
  assert.equal(report.marks.navigation, 400);
  assert.equal(report.marks.script, 1180, "page time 780 + the 400 ms between the two timeOrigins");
  assert.equal(report.marks["first-contentful-paint"], 700);
  assert.equal(report.marks.release, 2240);
  assert.deepEqual(report.steps[0], { id: "workspace", start: 1430, end: 1711, ms: 281, ok: true, tries: 1 });
  assert.deepEqual(report.summary, { ready: 380, firstPaint: 690, release: 2240, gate: 940, chooser: 5 });
  assert.equal(h.lines.length, 1);
  assert.equal(h.lines[0], "[startup] released 2240 ms after launch · app ready 380 · window 395 · page read 460 · first paint 690 · script 1180 · DOMContentLoaded 1420 · gate: workspace 281, catalog 170, tree 570, view 360, fonts 10 · launch screen 5 ms");
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].file, "startup.json");
  assert.equal(h.writes[0].report, report);
});

test("a failed or retried step and a partial release say so in the line", () => {
  const report = buildReport({
    origin: ORIGIN, main: { ready: 300 },
    page: normalizePage(page({ complete: false, steps: [{ id: "workspace", start: 1030, end: 1300, ok: true, tries: 1 }, { id: "tree", start: 1030, end: 61030, ok: false, tries: 2 }] })),
  });
  const line = formatLine(report);
  assert.match(line, /^\[startup\] released 2240 ms after launch \(partial\) · /);
  assert.match(line, /gate: workspace 270, tree failed 60000 \(2 tries\) · /);
});

test("a later page is a reload: timed from its own navigation, logged, never written", async () => {
  const h = collector({ env: { MEFI_STUDIO_STARTUP_REPORT: "startup.json" } });
  h.marks.receive(page());
  const reload = page({ marks: { script: 700, release: 1400 } });
  reload.origin = ORIGIN + 3_600_000;
  assert.deepEqual(h.marks.receive(reload), { ok: true, reload: true });
  await flush();
  assert.equal(h.writes.length, 1, "only the launch writes the report");
  assert.match(h.lines[1], /^\[startup\] page reload: released 1400 ms after navigation · page read 60 · first paint 290 · script 700 · /);
  assert.equal(h.marks.report().marks.release, 2240, "the report stays the launch's");
});

test("the page's payload is checked and bounded", () => {
  const h = collector();
  for (const bad of [null, "text", {}, { origin: "soon" }, { origin: -1 }, { origin: Number.NaN }]) {
    assert.equal(h.marks.receive(bad).ok, false);
  }
  assert.deepEqual(h.lines, [], "nothing is logged for a payload without a timeOrigin");
  const marks = { script: 10, "Bad Name": 5, ["x".repeat(LIMITS.name + 1)]: 5, negative: -1, late: LIMITS.horizonMs + 1, text: "12", release: 30 };
  for (let index = 0; index < 60; index += 1) marks[`extra-${index}`] = index;
  const steps = Array.from({ length: 20 }, (_item, index) => ({ id: `step-${index}`, start: 1, end: 2, ok: true, tries: 1 }));
  steps.push({ id: "../../etc", start: 1, end: 2 }, { id: "", start: 1 });
  const clean = normalizePage({ origin: PAGE, marks, steps, complete: "yes" });
  assert.ok(Object.keys(clean.marks).length <= LIMITS.marks);
  assert.equal(clean.marks.script, 10);
  for (const name of ["Bad Name", "negative", "late", "text"]) assert.equal(name in clean.marks, false, name);
  assert.equal(clean.steps.length, LIMITS.steps);
  assert.equal(clean.complete, true);
  assert.deepEqual(normalizePage({ origin: PAGE, steps: [{ id: "tree", start: "a", end: null, ok: "no", tries: 0 }] }).steps, [{ id: "tree", start: null, end: null, ok: null, tries: 1 }]);
});

test("no report file without the flag; a failed write is logged; a broken about() still reports", async () => {
  const quiet = collector();
  quiet.marks.receive(page());
  await flush();
  assert.equal(quiet.writes.length, 0);
  assert.equal(quiet.marks.file(), null);

  const failing = collector({ argv: ["--startup-report=Z:\\nowhere\\r.json"], write: async () => { throw new Error("EACCES: permission denied"); } });
  failing.marks.receive(page());
  await flush();
  assert.match(failing.lines[1], /^\[startup\] writing the startup report to Z:\\nowhere\\r\.json failed: EACCES/);

  const lines = [];
  const bare = createStartupMarks({ origin: ORIGIN, now: () => 1, log: (line) => lines.push(line), about: () => { throw new Error("no app yet"); } });
  assert.equal(bare.receive(page()).ok, true);
  assert.deepEqual(bare.report().about, {});
  assert.throws(() => createStartupMarks({ origin: ORIGIN }), /clock/);
});

test("timeOrigins too far apart to trust keep the page's own timeline", () => {
  const far = page();
  far.origin = ORIGIN + LIMITS.horizonMs + 1;
  const report = buildReport({ origin: ORIGIN, main: { ready: 380 }, page: normalizePage(far) });
  assert.equal(report.timeline, "ms since the page's navigation started");
  assert.equal(report.marks.ready, undefined, "main's marks are left out rather than misplaced");
  assert.equal(report.marks.release, 1840);
  assert.equal(report.launchedAt, undefined);
});

// ---- where main.cjs and preload.cjs hook it in ----------------------------------------

const block = section("// ---- Startup marks ---", "// ---- end of the startup marks ---");

test("main.cjs: the block is the first statement and makes the collector from the real module", () => {
  // Only Node's compile cache may come first: it must precede every require,
  // this block's included, and costs a fraction of a millisecond.
  const code = main.split("\n").filter((line) => line.trim() && !line.trim().startsWith("//"));
  const first = code[0].includes("enableCompileCache") ? 1 : 0;
  assert.ok(first === 0 || /^try \{ if \(process\.env\.MEFI_STUDIO_NO_COMPILE_CACHE !== "1"\) require\("node:module"\)\.enableCompileCache/.test(code[0]), "only the compile cache runs before the main mark");
  assert.ok(code[first].startsWith("const startupMarks ="), "nothing else runs before the main mark");
  assert.ok(block.includes('require("./scripts/startup-marks.cjs")'), "written out, so the updater's scanner sees it");
  const run = ({ env = {}, argv = ["electron", "."] } = {}) => {
    const lines = [], writes = [];
    const context = vm.createContext({
      process: { env, argv, versions: { electron: "44.4.1" }, platform: "win32" },
      performance: { timeOrigin: ORIGIN, now: () => 12.5 },
      optionalHelper: (_request, load) => load(), require,
      logLine: (line) => lines.push(line),
      authStore: { atomicWriteJson: async (file, report) => { writes.push({ file, report }); } },
      path, app: { getVersion: () => "0.4.5", isPackaged: false }, SMOKE: true, CAPTURE: false,
    });
    vm.runInContext(`${block}\nthis.startupMarks = startupMarks;`, context);
    return { startupMarks: context.startupMarks, lines, writes };
  };
  assert.equal(run({ env: { MEFI_STUDIO_STARTUP_MARKS: "0" } }).startupMarks, null, "MEFI_STUDIO_STARTUP_MARKS=0 turns it off");
  const h = run({ argv: ["electron", ".", "--smoke", "--startup-report", "logs/startup.json"] });
  assert.deepEqual(h.startupMarks.marks(), { main: 12.5 });
  h.startupMarks.receive(page());
  return flush().then(() => {
    assert.match(h.lines[0], /^\[startup\] released /);
    assert.equal(h.writes.length, 1);
    assert.equal(h.writes[0].file, path.resolve("logs/startup.json"), "a relative report path resolves where the launch ran");
    assert.equal(h.writes[0].report.about.version, "0.4.5");
    assert.equal(h.writes[0].report.about.smoke, true);
  });
});

test("main.cjs: app ready, the window and startup:marks are one guarded line each; the page learns when marks are off", () => {
  const guard = 'if (typeof startupMarks !== "undefined" && startupMarks)';
  const ready = section("app.whenReady().then(() => {", "  registerIpc();");
  assert.ok(ready.includes(`${guard} startupMarks.mark("ready");`), "app ready is the first thing the ready handler does");
  const create = section("function createWindow() {", "\n}\n");
  const made = create.indexOf("window = new BrowserWindow({");
  const watched = create.indexOf(`${guard} startupMarks.watch(window.webContents);`);
  assert.ok(made >= 0 && watched > made && watched < create.indexOf("loadView().catch("), "watched as soon as the window exists, before the page loads");
  assert.match(create, /smoke: SMOKE \? "1" : "0", \.\.\.layoutQuery\(\), \.\.\.\(typeof startupMarks !== "undefined" && startupMarks \? \{\} : \{ marks: "0" \}\) \}/);
  assert.match(main, /ipcMain\.handle\("startup:marks", \(_event, payload\) => \(typeof startupMarks !== "undefined" && startupMarks \? startupMarks\.receive\(payload\) : \{ ok: false/);
  assert.match(preload, /startupMarks: \(payload\) => ipcRenderer\.invoke\("startup:marks", payload \?\? \{\}\),/);
  assert.ok(main.includes('"startup:"'), "startup:* channels are app-wide, never held by a project switch");
});
