// The log core (scripts/log-core.cjs) on real folders: records in the kept
// shape, the level threshold, credentials masked before anything is written,
// batching and the exit path's synchronous flush, newest-first pages filtered
// by level, channel, source, run and text, switching off and on, and a folder
// another live Studio holds turning the core off without a throw. The folder
// choice (scripts/local-dirs.cjs) is at the end.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { createLogCore, normalize, prepare, compileFilter, levelOf, LIMITS } = require("../scripts/log-core.cjs");
const { localRoot, insideOneDrive, explain } = require("../scripts/local-dirs.cjs");
const { maskCredentials } = require("../scripts/redaction.cjs");

async function folder(t) {
  const base = await mkdtemp(path.join(tmpdir(), "mefi-logcore-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  return { dir: path.join(base, "logs"), archiveDir: path.join(base, "archive") };
}
let now = Date.UTC(2026, 9, 6, 12);
const core = (where, options = {}) => createLogCore({ ...where, clock: () => now, flushMs: 5, archive: { locks: new Set(), lockTries: 2, lockWaitMs: 5 }, ...options });
const lines = async (where) => {
  const text = (await Promise.all((await readdir(where.dir)).filter((name) => name.endsWith(".jsonl")).map((name) => readFile(path.join(where.dir, name), "utf8")))).join("");
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
};

test("records keep a fixed shape, clipped and with their level read from the words a caller used", () => {
  const record = normalize({ lvl: "WARNING", ch: "studio", src: "  autopilot  ", msg: "x".repeat(LIMITS.msg + 10), run: "run_1", task: "", data: { a: 1 } }, 5);
  assert.deepEqual(Object.keys(record), ["t", "lvl", "ch", "src", "msg", "run", "data"]);
  assert.equal(record.t, 5);
  assert.equal(record.lvl, "warn");
  assert.equal(record.src, "autopilot");
  assert.ok(record.msg.endsWith("(10 more characters)"));
  assert.deepEqual(["fatal", "err", "trace", "verbose", "nonsense"].map((word) => levelOf(word)), ["error", "error", "debug", "debug", "info"]);
  assert.equal(normalize("plain words", 9).ch, "studio", "a bare string is a studio line");
});

test("credentials are masked in the message and in data before anything is written", () => {
  const key = "sk-ant-api03-" + "A".repeat(40);
  const kept = prepare(normalize({ msg: `calling with ${key}`, data: { apiKey: "plain-secret-value", nested: { authorization: "Bearer abc.def.ghi", note: `see ${key}` }, big: "y".repeat(10) } }, 1), maskCredentials);
  assert.ok(!JSON.stringify(kept).includes(key), "a key in the words is masked");
  assert.equal(kept.data.apiKey, "[redacted]");
  assert.equal(kept.data.nested.authorization, "[redacted]");
  assert.ok(!kept.data.nested.note.includes(key));
  const huge = prepare(normalize({ msg: "m", data: { blob: "z".repeat(LIMITS.data + 1) } }, 1), maskCredentials);
  assert.deepEqual(huge.data, { clipped: true, bytes: JSON.stringify({ blob: "z".repeat(LIMITS.data + 1) }).length }, "data past 8 KB is replaced by its size");
});

test("lines under the threshold are not kept; batches reach the disk, and the exit path writes what waits", async (t) => {
  const where = await folder(t);
  const log = core(where);
  assert.equal(await log.opened(), true);
  assert.equal(log.log({ lvl: "debug", msg: "chatter" }), false, "info is the default threshold");
  assert.equal(log.log({ lvl: "info", src: "boot", msg: "[boot] up" }), true);
  log.log({ lvl: "error", src: "worker", msg: "[worker] failed", run: "run_7", task: "task_3" });
  await log.flush();
  assert.deepEqual((await lines(where)).map((record) => [record.lvl, record.src, record.msg, record.run ?? null]), [["info", "boot", "[boot] up", null], ["error", "worker", "[worker] failed", "run_7"]]);
  log.setLevel("debug");
  assert.equal(log.log({ lvl: "debug", msg: "now kept" }), true);
  log.log({ msg: "last words" });
  assert.equal(log.closeSync(), 2, "the exit path writes both, synchronously");
  assert.equal((await lines(where)).length, 4);
  await assert.rejects(readFile(path.join(where.dir, "log.lock")), /ENOENT/, "and lets go of the folder");
});

test("pages read newest first, filtered by level, channel, source, run and text, with a cursor", async (t) => {
  const where = await folder(t);
  const log = core(where);
  await log.opened();
  for (let at = 0; at < 30; at += 1) {
    now += 1;
    log.log({ lvl: at % 10 === 0 ? "error" : at % 3 === 0 ? "warn" : "info", ch: at % 2 ? "studio" : "assistant", src: at % 5 ? "autopilot" : "release", msg: `line ${at}${at === 17 ? " needle" : ""}`, run: at < 10 ? "run_a" : "run_b" });
  }
  const first = await log.readPage({ limit: 4 });
  assert.deepEqual(first.rows.map((row) => row.msg), ["line 29", "line 28", "line 27", "line 26"]);
  const second = await log.readPage({ before: first.next, limit: 4 });
  assert.deepEqual(second.rows.map((row) => row.msg), ["line 25", "line 24", "line 23", "line 22"]);
  assert.deepEqual((await log.readPage({ filter: { lvl: "error" } })).rows.map((row) => row.msg), ["line 20", "line 10", "line 0"]);
  assert.deepEqual((await log.readPage({ filter: { lvl: ["error", "warn"], ch: "studio" } })).rows.map((row) => row.msg), ["line 27", "line 21", "line 15", "line 9", "line 3"]);
  assert.deepEqual((await log.readPage({ filter: { src: "release", run: "run_a" } })).rows.map((row) => row.msg), ["line 5", "line 0"]);
  assert.deepEqual((await log.readPage({ filter: { text: "NEEDLE" } })).rows.map((row) => row.msg), ["line 17 needle"]);
  // Line n was logged at start + n + 1; `before` is strictly older.
  const older = await log.readPage({ before: now - 25, limit: 100 });
  assert.deepEqual(older.rows.map((row) => row.msg), ["line 3", "line 2", "line 1", "line 0"]);
  const { prefilter } = compileFilter({ ch: "studio", text: "needle" });
  assert.equal(prefilter('{"t":1,"lvl":"info","ch":"assistant","src":"a","msg":"needle"}'), false, "a raw line that cannot match is never parsed");
  assert.equal(prefilter('{"t":1,"lvl":"info","ch":"studio","src":"a","msg":"a Needle"}'), true);
  await log.close();
});

test("disable keeps nothing and drops what waits; enable keeps lines again", async (t) => {
  const where = await folder(t);
  const log = core(where);
  await log.opened();
  log.log({ msg: "before" });
  log.disable("settings.logs.keep is off");
  assert.equal(log.log({ msg: "while off" }), false);
  assert.deepEqual(log.status().on, false);
  log.enable();
  log.log({ msg: "after" });
  await log.flush();
  assert.deepEqual((await lines(where)).map((record) => record.msg), ["after"]);
  await log.close();
});

test("a folder another live Studio holds turns the core off once, without a throw", async (t) => {
  const where = await folder(t);
  await mkdir(where.dir, { recursive: true });
  await writeFile(path.join(where.dir, "log.lock"), JSON.stringify({ pid: 999999, at: 1 }));
  const errors = [];
  const log = core(where, { archive: { locks: new Set(), lockTries: 1, lockWaitMs: 1, isAlive: () => true }, onError: (error, where_) => errors.push(where_) });
  assert.equal(await log.opened(), false);
  assert.equal(log.status().on, false);
  assert.equal(log.log({ msg: "nowhere to go" }), false);
  assert.deepEqual(errors, ["open"]);
  assert.equal(log.flushSync(), 0);
});

// ---- the folder ------------------------------------------------------------------------

test("the local folder: the owner's choice, then MEFI_STUDIO_LOCAL_DIR, then the platform's, never inside OneDrive", () => {
  const win = { LOCALAPPDATA: "C:\\Users\\Ann\\AppData\\Local", OneDrive: "C:\\Users\\Ann\\OneDrive" };
  assert.equal(localRoot({ platform: "win32", env: win, userData: "C:\\Users\\Ann\\AppData\\Roaming\\Mefi" }).root, "C:\\Users\\Ann\\AppData\\Local\\MefiStudio");
  assert.equal(localRoot({ platform: "win32", env: { ...win, MEFI_STUDIO_LOCAL_DIR: "D:\\StudioLocal" }, userData: "C:\\x" }).rule, "env");
  assert.equal(localRoot({ platform: "win32", env: win, chosen: "E:\\Mine", userData: "C:\\x" }).root, "E:\\Mine");
  const refused = localRoot({ platform: "win32", env: { ...win, MEFI_STUDIO_LOCAL_DIR: "c:\\users\\ann\\onedrive\\studio" }, userData: "C:\\x" });
  assert.equal(refused.rule, "platform");
  assert.deepEqual(refused.rejected.map((entry) => [entry.rule, entry.reason, entry.detail]), [["env", "onedrive", "env:OneDrive"]], "case does not hide OneDrive on Windows");
  assert.match(explain(refused), /is inside OneDrive, so Studio keeps its local files in C:\\Users\\Ann\\AppData\\Local\\MefiStudio\./);
  assert.equal(insideOneDrive("C:\\Users\\Ann\\OneDrive - Contoso\\x", { platform: "win32", env: {} }), "segment:OneDrive - Contoso");
  const relative = localRoot({ platform: "linux", env: { MEFI_STUDIO_LOCAL_DIR: "logs", HOME: "/home/ann" }, userData: "/home/ann/.config/mefi" });
  assert.deepEqual([relative.root, relative.rejected[0].reason], ["/home/ann/.local/state/mefi-studio", "relative"]);
  assert.equal(localRoot({ platform: "linux", env: { XDG_STATE_HOME: "/state" }, userData: "/u" }).root, "/state/mefi-studio");
  assert.equal(localRoot({ platform: "darwin", env: { HOME: "/Users/ann" }, userData: "/u" }).root, "/Users/ann/Library/Application Support/MefiStudio");
  assert.equal(explain(localRoot({ platform: "linux", env: { HOME: "/home/ann" }, userData: "/u" })), "", "nothing to say when the first choice held");
});

test("with every candidate in OneDrive the answer is userData's local folder, flagged when that is synced too", () => {
  const env = { LOCALAPPDATA: "C:\\Users\\Ann\\OneDrive\\Local", OneDrive: "C:\\Users\\Ann\\OneDrive" };
  const fallback = localRoot({ platform: "win32", env, userData: "C:\\Users\\Ann\\OneDrive\\Roaming\\Mefi" });
  assert.deepEqual([fallback.rule, fallback.root, fallback.oneDrive], ["userData", "C:\\Users\\Ann\\OneDrive\\Roaming\\Mefi\\local", true]);
  assert.match(explain(fallback), /set MEFI_STUDIO_LOCAL_DIR to a folder outside it/);
  assert.throws(() => localRoot({ platform: "win32", env, userData: "" }), /absolute userData/);
});

test("the layout names safe folders", () => {
  const where = localRoot({ platform: "linux", env: { HOME: "/h" }, userData: "/u" });
  assert.equal(where.logsDir(), "/h/.local/state/mefi-studio/logs");
  assert.equal(where.archiveDir("log"), "/h/.local/state/mefi-studio/archive/log");
  const escaped = path.posix.basename(where.journalDir("../../etc"));
  assert.equal(path.posix.dirname(where.journalDir("../../etc")), "/h/.local/state/mefi-studio/journal", "an id never climbs out of the journal");
  assert.ok(!escaped.startsWith(".") && !escaped.includes("/"), escaped);
  assert.equal(path.posix.basename(where.journalDir("CON")), "_CON");
  assert.throws(() => where.journalDir("///"), /letters or digits/);
  assert.equal(where.migrationsDir("2026-10-06T12:00:00Z"), "/h/.local/state/mefi-studio/migrations/2026-10-06");
});
