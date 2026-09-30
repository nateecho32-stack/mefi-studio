// scripts/crash-report.cjs: what a report holds and what it never does, how it
// is redacted, and how the session marker tells a crash from a quit. The
// redaction tests plant a key, a home path, a user name and a task title in
// every place a real report reads and look for them in every file that comes
// out; the never-included tests read the file list itself; the marker tests
// walk a clean quit, an update restart, a roll back, a development run that
// was only stopped and a real crash through judgeSession.
//
// Run: node --test tests/crash_report.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const rep = require("../scripts/crash-report.cjs");

const NOW = Date.UTC(2026, 8, 30, 15, 0, 0);
const KEY = "sk-ant-api03-PLANTED0123456789abcdefghij";
const GH = "ghp_PlantedToken0123456789abcdefghijkl";
const HOME = "C:\\Users\\Nate";
const TITLE = "Fix the Moonlight Harbor login flow";
const PROJECT = "Moonlight Harbor";

function input(more = {}) {
  return {
    now: NOW,
    studio: { version: "0.5.0", install: "portable" },
    os: { platform: "win32", release: "10.0.26200", arch: "x64" },
    runtime: { electron: "44.4.1", chrome: "150.0.0.0", node: "24.21.0" },
    project: { name: PROJECT },
    route: { provider: "auto", models: { heavy: "claude-opus-5-5", routine: "sonnet-5-5" } },
    builder: { cli: "claude", tier: "auto" },
    tasks: [
      { id: "t1", title: TITLE, status: "done", verification: { state: "verified", checks: { total: 4, passed: 3, failed: 1 } }, builder: "Claude Code · Sonnet 5.5", updatedAt: NOW - 60000 },
      { id: "t2", title: "Add dark mode to the Harbor map", status: "active", verification: null, builder: null, updatedAt: NOW - 30000 },
      { id: "t3", title: "Tidy the docs", status: "awaiting_verification", verification: { state: "pending", checks: null }, builder: "Codex", updatedAt: NOW - 90000 },
    ],
    trace: [
      { at: NOW - 5000, level: "info", source: "tasks", text: `claimed "${TITLE}" for ${PROJECT}` },
      { at: NOW - 4000, level: "warn", source: "files", text: `read ${HOME}\\Documents\\${PROJECT}\\src\\login.ts and D:\\Work\\Harbor\\deep\\deeper\\file.ts` },
      { at: NOW - 3000, level: "error", source: "http", text: `POST api.example.com authorization: Bearer ${KEY} for nate@example.com from 10.0.0.7 as Nate on NATE-PC` },
    ],
    builderRuns: [
      { at: NOW - 2000, runId: "run_1_1", taskId: "t1", title: TITLE, ok: false, code: 1, seconds: 38, tail: [`ANTHROPIC_API_KEY=${KEY}`, `token: ${GH}`, "\u001b[31mred output\u001b[0m", `edit ${HOME}\\Documents\\${PROJECT}\\src\\a.ts`] },
    ],
    crashRows: [{ at: NOW - 3600000, kind: "renderer-unresponsive", detail: `the window stopped responding while "${TITLE}" ran`, session: NOW - 7200000, version: "0.5.0" }],
    scrub: { roots: [{ path: `${HOME}\\Documents\\${PROJECT}`, label: "<project>" }, { path: "C:\\Program Files\\Mefi", label: "<studio>" }, { path: HOME, label: "~" }], names: [{ name: "Nate", label: "<user>" }, { name: "NATE-PC", label: "<pc>" }] },
    ...more,
  };
}
const all = (bundle) => bundle.files.map((file) => `# ${file.name}\n${file.text}`).join("\n");

test("a report is exactly five named files; the crash record only when there is one and it was not switched off", () => {
  const bundle = rep.buildBundle(input());
  assert.deepEqual(bundle.files.map((file) => file.name), ["manifest.json", "tasks-summary.json", "trace-tail.log", "builders.log", "crash.jsonl"]);
  assert.deepEqual(bundle.files.map((file) => file.name), rep.FILES.map((file) => file.name), "in the order the card lists them");
  assert.ok(bundle.files.every((file) => file.about && file.bytes === Buffer.byteLength(file.text)));
  assert.equal(bundle.total, bundle.files.reduce((sum, file) => sum + file.bytes, 0));
  assert.deepEqual(rep.buildBundle(input(), { includeCrash: false }).files.map((file) => file.name), ["manifest.json", "tasks-summary.json", "trace-tail.log", "builders.log"]);
  assert.deepEqual(rep.buildBundle(input({ crashRows: [] })).files.map((file) => file.name), ["manifest.json", "tasks-summary.json", "trace-tail.log", "builders.log"], "no rows, no file");
  assert.doesNotThrow(() => JSON.parse(bundle.files[0].text));
  assert.doesNotThrow(() => JSON.parse(bundle.files[1].text), "the task summary is a valid JSON array, one task to a line");
  assert.equal(bundle.files[1].text.trim().split("\n").length, 3 + 2, "brackets plus one line per task");
});

test("what a report never holds is written down, and no file of a report can be one of them", () => {
  assert.deepEqual(rep.NEVER_INCLUDED.map((item) => item.name), ["settings.json", "auth.json and community-auth.json", "The vault", "Screenshots and evidence", "Your project's files"]);
  assert.ok(rep.NEVER_INCLUDED.every((item) => item.why.length > 10), "each says why");
  const names = rep.buildBundle(input()).files.map((file) => file.name);
  for (const name of names) {
    assert.doesNotMatch(name, /settings|auth|community|vault|screenshot|evidence|\.png$|\.jpe?g$|\.db$|\.sqlite/i, `${name} would be one of the files a report never holds`);
    assert.ok(rep.FILES.some((file) => file.name === name), `${name} is on the published list`);
  }
  // Nothing else in the input can reach the output: unexpected fields are never read.
  const sneaky = input({ settings: { apiKey: KEY, projects: [HOME] }, auth: { token: GH }, vault: { key: KEY }, screenshot: `data:image/png;base64,${KEY}`, files: { "src/secret.ts": KEY } });
  sneaky.tasks[0].secret = GH;
  sneaky.tasks[0].brief = `the brief holds ${KEY}`;
  const text = all(rep.buildBundle(sneaky));
  assert.ok(!text.includes("PLANTED0123456789") && !text.includes("PlantedToken0123456789"), "no planted secret reaches the report through a field the builder does not read");
  assert.ok(!text.includes("brief"), "nor a task's own brief");
});

test("keys, home folders, this PC's names, addresses and long paths are gone from every file", () => {
  const text = all(rep.buildBundle(input()));
  for (const leaked of [KEY, GH, "PLANTED0123456789", "PlantedToken0123456789", "Bearer sk-", HOME, "C:\\Users", "nate@example.com", "10.0.0.7", "NATE-PC", "Nate", "D:\\Work", "Harbor\\deep"]) {
    assert.ok(!text.includes(leaked), `"${leaked}" must not be in the report`);
  }
  assert.match(text, /\[redacted/, "a mark says something was removed");
  assert.match(text, /<email>/);
  assert.match(text, /<address>/);
  assert.match(text, /<user>/);
  assert.match(text, /<pc>/);
  assert.match(text, /<project>\\src\\login\.ts/, "the project's folder becomes <project>, and the file inside it stays readable");
  assert.match(text, /<path>\\deeper\\file\.ts/, "a folder outside every known root keeps its last two steps");
  assert.doesNotMatch(text, /\u001b/, "terminal colour codes are stripped");
  assert.doesNotMatch(text, /\[31m|\[0m/, "and leave nothing of themselves behind");
  assert.match(text, /^  red output$/m, "the words in the colour stay");
  assert.doesNotMatch(text, /\[redacted\] credential\]/, "one plain mark per key");
});

test("token shapes the outbound scrubber does not know are removed too, alone and inside a sentence", () => {
  const shapes = {
    // Built from pieces: a whole token-shaped string in a source file trips secret scanners.
    slack: ["xoxb", "1234567890", "abcdefghijKLMN"].join("-"),
    github: "github_pat_11ABCDEFG0abcdefghij_KLMNOPQRSTUVWXYZ0123",
    google: "AIzaSyA1234567890abcdefghijklmnopqrstuv",
    gitlab: "glpat-abcdefghijklmnop1234",
    jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrst",
  };
  const scrub = rep.makeScrubber();
  for (const [name, secret] of Object.entries(shapes)) {
    assert.equal(scrub(`before ${secret} after`), "before [redacted credential] after", name);
  }
  const trace = rep.buildBundle(input({ trace: Object.values(shapes).map((secret, index) => ({ at: NOW - index, level: "info", source: "x", text: `saw ${secret}` })) })).files[2].text;
  for (const secret of Object.values(shapes)) assert.ok(!trace.includes(secret), "not in the trace file either");
});

test("a title or a project name too short to swap inside other text is still numbered where a whole value stands for it", () => {
  const short = input({ project: { name: "Zed" }, tasks: [{ id: "a", title: "Fix", status: "active" }], trace: [], builderRuns: [{ at: NOW, runId: "run_1", taskId: "a", title: "Fix", ok: true, code: 0, seconds: 1, tail: [] }], crashRows: [] });
  const numbered = rep.buildBundle(short, { replaceTitles: true });
  assert.match(numbered.files[0].text, /"project": "Project 1"/);
  assert.deepEqual(JSON.parse(numbered.files[1].text).map((row) => row.task), ["Task 1"]);
  assert.match(numbered.files[3].text, /"Task 1"  ok/);
  const plain = rep.buildBundle(short);
  assert.match(plain.files[0].text, /"project": "Zed"/);
  assert.deepEqual(JSON.parse(plain.files[1].text).map((row) => row.task), ["Fix"]);
});

test("titles stay by default and become numbers on request, in every file, the same number everywhere", () => {
  const plain = all(rep.buildBundle(input()));
  assert.ok(plain.includes(TITLE), "task titles are in the report unless the owner asks otherwise");
  assert.ok(plain.includes(PROJECT));
  const numbered = rep.buildBundle(input(), { replaceTitles: true });
  const text = all(numbered);
  for (const hidden of [TITLE, "Moonlight", "Harbor", "dark mode", "Tidy the docs"]) assert.ok(!text.includes(hidden), `"${hidden}" must not be in the numbered report`);
  assert.equal(numbered.replacedTitles, true);
  const summary = JSON.parse(numbered.files[1].text);
  assert.deepEqual(summary.map((row) => row.task), ["Task 1", "Task 2", "Task 3"]);
  assert.match(numbered.files[0].text, /"project": "Project 1"/);
  assert.match(numbered.files[2].text, /claimed "Task 1" for Project 1/, "the trace says Task 1 where the title was");
  assert.match(numbered.files[3].text, /"Task 1"  failed/, "and so does the builders' log, by the run's task");
  assert.match(numbered.files[4].text, /while \\"Task 1\\" ran/, "and the crash record");
  assert.equal(rep.buildBundle(input({ builderRuns: [{ at: NOW, runId: "run_9", taskId: "gone", title: "A deleted task's title", ok: true, code: 0, seconds: 1, tail: [] }] }), { replaceTitles: true }).files[3].text.includes("deleted task"), false, "a run whose task is not in the list is not named either");
});

test("the task summary says state, builder and checks one line per task", () => {
  const rows = JSON.parse(rep.buildBundle(input()).files[1].text);
  assert.deepEqual(rows[0], { task: TITLE, state: "done (verified)", builder: "Claude Code · Sonnet 5.5", checks: "3/4, 1 failed", updated: "2026-09-30T14:59:00Z" });
  assert.equal(rows[1].state, "active");
  assert.equal(rows[1].builder, null);
  assert.equal(rows[1].checks, "none");
  assert.equal(rows[2].state, "awaiting_verification (pending)");
  assert.equal(rep.buildBundle(input({ tasks: [] })).files[1].text, "[]\n");
});

test("the manifest names the version, install, OS, model and builder and counts tasks and crashes", () => {
  const manifest = JSON.parse(rep.buildBundle(input()).files[0].text);
  assert.equal(manifest.studio, "0.5.0");
  assert.equal(manifest.install, "portable");
  assert.equal(manifest.built, "2026-09-30T15:00:00Z");
  assert.deepEqual(manifest.os, { platform: "win32", release: "10.0.26200", arch: "x64" });
  assert.deepEqual(manifest.route, { provider: "auto", models: { heavy: "claude-opus-5-5", routine: "sonnet-5-5" } });
  assert.deepEqual(manifest.builder, { cli: "claude", tier: "auto" });
  assert.deepEqual(manifest.tasks, { total: 3, running: 1, review: 1, done: 1 });
  assert.equal(manifest.crashes, 1);
  assert.equal(manifest.titlesReplaced, false);
  assert.equal(manifest.project, PROJECT);
});

test("every log is bounded: the trace to 1,000 rows, the builders to a dozen runs, a file to a size, saying what was left out", () => {
  const trace = Array.from({ length: 1500 }, (_, index) => ({ at: NOW - (1500 - index) * 1000, level: "info", source: "loop", text: `row ${index}` }));
  const kept = rep.buildBundle(input({ trace })).files[2].text.trim().split("\n");
  assert.equal(kept.length, 1000);
  assert.match(kept[0], /row 500$/, "the newest thousand");
  assert.match(kept.at(-1), /row 1499$/);
  const runs = Array.from({ length: 20 }, (_, index) => ({ at: NOW + index, runId: `run_${index}`, taskId: "t1", title: "x", ok: true, code: 0, seconds: 1, tail: ["line"] }));
  const text = rep.buildBundle(input({ builderRuns: runs })).files[3].text;
  assert.equal((text.match(/^# /gm) ?? []).length, rep.LIMITS.builderRuns);
  assert.match(text, /run_19/);
  assert.ok(!text.includes("run_7 "), "older runs fall out");
  const huge = Array.from({ length: 3000 }, (_, index) => ({ at: NOW - index, level: "info", source: "s", text: `${index} ${"x".repeat(480)}` }));
  const capped = rep.buildBundle(input({ trace: huge.reverse() }), {}).files[2];
  assert.ok(capped.bytes <= rep.LIMITS.fileBytes + 200, `${capped.bytes} bytes`);
  assert.equal(rep.buildBundle(input({ tasks: Array.from({ length: 500 }, (_, index) => ({ id: `t${index}`, title: `Task title ${index}`, status: "open" })) })).files[1].text.trim().split("\n").length, rep.LIMITS.tasks + 2);
});

test("the crash record keeps a week, drops bookkeeping and stays out when switched off", () => {
  const rows = [
    rep.crashRow({ now: NOW - 9 * 86400000, kind: "renderer-gone", detail: "crashed" }),
    rep.crashRow({ now: NOW - 3600000, kind: "main-exception", detail: `TypeError: nope at ${HOME}\\a.js`, session: 5, version: "0.5.0", origin: "uncaughtException" }),
    rep.crashRow({ now: NOW - 3000000, kind: "dismissed", session: 5 }),
  ];
  const bundle = rep.buildBundle(input({ crashRows: rows }));
  const crash = bundle.files.find((file) => file.name === "crash.jsonl").text.trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(crash.length, 1, "a nine-day-old row and the bookkeeping row are left out");
  assert.equal(crash[0].kind, "main-exception");
  assert.ok(!bundle.files.find((file) => file.name === "crash.jsonl").text.includes("C:\\Users"), "and its text is redacted like the rest");
  assert.equal(rep.buildBundle(input({ crashRows: rows }), { includeCrash: false }).files.some((file) => file.name === "crash.jsonl"), false);
});

test("rows are small, known and survive a torn file; the file keeps its newest fifty of the last week", () => {
  const row = rep.crashRow({ now: NOW, kind: "renderer-gone", detail: "x".repeat(900), session: 7, version: "0.5.0", exitCode: 139, origin: "y".repeat(90), secret: "no" });
  assert.deepEqual(Object.keys(row).sort(), ["at", "detail", "exitCode", "kind", "origin", "session", "version"]);
  assert.equal(row.detail.length, 200);
  assert.equal(rep.crashRow({ now: NOW, kind: "invented" }).kind, "no-clean-exit", "an unknown kind is the general one");
  const text = `${rep.serializeRows([row, rep.crashRow({ now: NOW + 1, kind: "gpu-gone" })])}{"at":123,"kind":"renderer-gone","deta`;
  assert.equal(rep.parseRows(text).length, 2, "a torn last line is skipped");
  assert.deepEqual(rep.parseRows("not json\n[]\n{\"at\":0,\"kind\":\"x\"}\n"), []);
  const many = Array.from({ length: 80 }, (_, index) => rep.crashRow({ now: NOW - index * 1000, kind: "renderer-gone" })).reverse();
  assert.equal(rep.keepRows(many, { now: NOW }).length, rep.LIMITS.crashRows);
  assert.equal(rep.keepRows(many, { now: NOW + 8 * 86400000 }).length, 0);
  assert.equal(rep.serializeRows([]), "");
});

// ---- the session marker ---------------------------------------------------------------------------

const STARTED = NOW - 3600000;
const running = (more = {}) => ({ ...rep.beginSession({ now: STARTED, pid: 4242, version: "0.5.0", install: "portable" }), ...more });

test("a launch writes a running marker; closing it says how and only the first close counts", () => {
  const marker = rep.beginSession({ now: STARTED, pid: 4242, version: "0.5.0", install: "portable" });
  assert.deepEqual(marker, { v: 1, state: "running", pid: 4242, startedAt: STARTED, version: "0.5.0", install: "portable" });
  const closed = rep.endSession(marker, { now: NOW, why: "update" });
  assert.deepEqual(closed, { ...marker, state: "closed", endedAt: NOW, why: "update" });
  assert.equal(rep.endSession(closed, { now: NOW + 1, why: "quit" }), null, "a second close changes nothing");
  assert.equal(rep.endSession(null, { now: NOW }), null);
  assert.equal(rep.endSession(marker, { now: NOW, why: "banana" }).why, "quit", "an unknown reason is a plain quit");
  assert.deepEqual(rep.parseMarker(JSON.stringify(closed)), closed, "and the file reads back");
  assert.deepEqual(rep.parseMarker(`\uFEFF${JSON.stringify(closed)}`), closed, "a file saved with a byte-order mark reads too");
  assert.equal(rep.parseMarker("{ torn"), null);
  assert.equal(rep.parseMarker(JSON.stringify({ state: "running" })), null, "no start time, no marker");
  assert.equal(rep.parseMarker('{"state":"sleeping","startedAt":5}'), null);
});

test("a clean quit, an update restart, a roll back and a sign-out are not crashes", () => {
  for (const why of ["quit", "exit", "update", "rollback", "session-end"]) {
    const verdict = rep.judgeSession(rep.endSession(running(), { now: NOW, why }), { pid: 9000 });
    assert.equal(verdict.crashed, false, why);
    assert.equal(verdict.prompt, false, why);
    assert.equal(verdict.why, why, "and it says how the last session closed");
  }
  assert.equal(rep.judgeSession(null, { pid: 9000 }).crashed, false, "the first launch ever has no last session");
  assert.equal(rep.judgeSession(running(), { pid: 4242 }).crashed, false, "this very process re-reading its own marker");
  assert.equal(rep.judgeSession({ state: "weird" }, { pid: 1 }).crashed, false);
});

test("a session that never closed is a crash and the next start says so, with the last thing it wrote down", () => {
  const bare = rep.judgeSession(running(), { pid: 9000 });
  assert.deepEqual([bare.crashed, bare.prompt, bare.kind, bare.at, bare.session, bare.recorded], [true, true, "no-clean-exit", STARTED, STARTED, false]);
  const rows = [
    rep.crashRow({ now: STARTED - 5000, kind: "renderer-gone", session: STARTED - 99999 }),
    rep.crashRow({ now: STARTED + 1000, kind: "renderer-unresponsive", session: STARTED }),
    rep.crashRow({ now: STARTED + 9000, kind: "main-exception", session: STARTED }),
    rep.crashRow({ now: STARTED + 9500, kind: "dismissed", session: STARTED }),
  ];
  const older = rep.judgeSession(running(), { pid: 9000, rows: [rows[0]] });
  assert.deepEqual([older.crashed, older.kind, older.recorded], [true, "no-clean-exit", false], "a session that wrote nothing is not given an older session's crash");
  const recorded = rep.judgeSession(running(), { pid: 9000, rows });
  assert.deepEqual([recorded.crashed, recorded.prompt, recorded.kind, recorded.at, recorded.recorded], [true, true, "main-exception", STARTED + 9000, true], "the newest crash row of that session, not an older session's and not bookkeeping");
});

test("an update that did not stand and was rolled back is recorded but never prompts", () => {
  const verdict = rep.judgeSession(running(), { pid: 9000, updateResult: { ok: false, rolledBack: true, stage: "boot", from: "0.5.0", to: "0.5.1" } });
  assert.deepEqual([verdict.crashed, verdict.prompt, verdict.kind], [true, false, "update-rolled-back"]);
  const failedRollback = rep.judgeSession(running(), { pid: 9000, updateResult: { ok: false, rolledBack: false, rollbackFailed: true } });
  assert.equal(failedRollback.prompt, true, "an update result that did not roll anything back is not that");
});

test("a development run that was only stopped is not a crash, unless it wrote a real crash down", () => {
  const source = running({ install: "source" });
  assert.equal(rep.judgeSession(source, { pid: 9000 }).crashed, false, "Ctrl+C in a terminal is not a report");
  assert.equal(rep.judgeSession(source, { pid: 9000 }).why, "source-run");
  const wrote = rep.judgeSession(source, { pid: 9000, rows: [rep.crashRow({ now: STARTED + 5, kind: "renderer-gone", session: STARTED })] });
  assert.deepEqual([wrote.crashed, wrote.prompt, wrote.kind], [true, true, "renderer-gone"]);
  assert.equal(rep.judgeSession(running({ install: "portable" }), { pid: 9000 }).prompt, true, "an installed build that vanished always is");
});
