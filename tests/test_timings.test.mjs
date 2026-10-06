// Guards scripts/test-timings.mjs: each suite's wall time is recorded after a
// run, shared by every worktree on the PC, and the next run starts the
// slowest suites first.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import timingsReporter, {
  isFileCompletion, longestFirst, mergeTimings, parseSamples, readTimings, recordRun, slowest, suiteKey, timingsFile,
} from "../scripts/test-timings.mjs";

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function scratch(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mefi-timings-test-"));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  return dir;
}

test("the record is machine-wide, and a suite has one key in every worktree", () => {
  assert.equal(timingsFile({ LOCALAPPDATA: "C:\\L" }, "win32"), path.join("C:\\L", "MefiStudio", "test-timings.json"));
  assert.equal(timingsFile({ MEFI_TEST_TIMINGS: "t.json" }, "win32"), path.resolve("t.json"));
  const a = path.join(path.sep, "wt", "a");
  const b = path.join(path.sep, "work", "Mefi Studio");
  assert.equal(suiteKey(path.join(a, "tests", "x.test.mjs"), a), "tests/x.test.mjs");
  assert.equal(suiteKey(path.join(b, "tests", "x.test.mjs"), b), "tests/x.test.mjs");
  assert.equal(suiteKey(path.join(path.sep, "elsewhere", "y.test.mjs"), a), "y.test.mjs");
});

test("the reporter writes one line per finished file, from the file's own completion", async () => {
  const file = path.join(process.cwd(), "tests", "x.test.mjs");
  const given = path.join("tests", "x.test.mjs");
  async function* events() {
    yield { type: "test:start", data: { file, name: given, nesting: 0 } };
    yield { type: "test:complete", data: { file, name: "a test inside", nesting: 0, details: { duration_ms: 3, passed: true } } };
    yield { type: "test:complete", data: { file, name: "nested", nesting: 1, details: { duration_ms: 1 } } };
    yield { type: "test:complete", data: { file, name: given, nesting: 0, details: { duration_ms: 1234.6, passed: false } } };
    yield { type: "test:summary", data: { file, duration_ms: 9 } };
  }
  const lines = [];
  for await (const line of timingsReporter(events())) lines.push(line);
  assert.deepEqual(lines.map((line) => JSON.parse(line)), [{ file, ms: 1235, passed: false }]);
  // A file in a subfolder is named by the path it was given as.
  const nested = path.join(process.cwd(), "tests", "x.test.mjs");
  assert.equal(isFileCompletion({ nesting: 0, file: nested, name: path.join("tests", "x.test.mjs") }), true);
  assert.equal(isFileCompletion({ nesting: 0, file: nested, name: "x.test.mjs" }), false, "a test inside it named like the file is not the file");
  assert.equal(isFileCompletion({ nesting: 0, file: nested, name: nested }), true, "absolute paths too");
});

test("a new reading moves the estimate without deciding it, and torn lines are skipped", () => {
  const samples = parseSamples('{"file":"/r/tests/a.test.mjs","ms":1000,"passed":true}\n{"file":"/r/tests/b.te\n\n{"file":"/r/tests/c.test.mjs","ms":50}\n');
  assert.equal(samples.length, 2);
  const first = mergeTimings(null, samples, { root: "/r", now: 0 });
  assert.equal(first.suites["tests/a.test.mjs"].ms, 1000);
  const second = mergeTimings(first, [{ file: "/other/tests/a.test.mjs", ms: 2000, passed: false }], { root: "/other", now: 0 });
  assert.equal(second.suites["tests/a.test.mjs"].ms, 1600, "60% new, 40% old");
  assert.equal(second.suites["tests/a.test.mjs"].last, 2000);
  assert.equal(second.suites["tests/a.test.mjs"].runs, 2);
  assert.equal(second.suites["tests/a.test.mjs"].passed, false);
  assert.equal(second.suites["tests/c.test.mjs"].ms, 50, "suites not in this run keep their estimate");
});

test("the slowest known suite starts first, new suites before all of them, ties keep their order", () => {
  const root = path.join(path.sep, "r");
  const at = (name) => path.join(root, "tests", name);
  const store = { suites: { "tests/a.test.mjs": { ms: 10 }, "tests/b.test.mjs": { ms: 90_000 }, "tests/c.test.mjs": { ms: 10 }, "tests/d.test.mjs": { ms: 4000 } } };
  const files = ["a", "b", "c", "d", "new"].map((name) => at(`${name}.test.mjs`));
  assert.deepEqual(longestFirst(files, store, root).map((file) => path.basename(file)), ["new.test.mjs", "b.test.mjs", "d.test.mjs", "a.test.mjs", "c.test.mjs"]);
  assert.deepEqual(longestFirst(files, null, root), files, "no record: the incoming order");
  assert.deepEqual(slowest(store, 2).map((row) => [row.suite, row.ms]), [["tests/b.test.mjs", 90_000], ["tests/d.test.mjs", 4000]]);
});

test("a run's samples join the shared record, re-read right before writing", async (t) => {
  const dir = await scratch(t);
  const store = path.join(dir, "deep", "timings.json");
  const samples = path.join(dir, "run.jsonl");
  await writeFile(samples, `${JSON.stringify({ file: path.join(dir, "tests", "one.test.mjs"), ms: 700, passed: true })}\n`);
  assert.equal(await recordRun(samples, { root: dir, file: store }), 1);
  assert.equal(await recordRun(path.join(dir, "missing.jsonl"), { root: dir, file: store }), 0);
  const saved = await readTimings(store);
  assert.equal(saved.suites["tests/one.test.mjs"].ms, 700);
  await writeFile(store, "{ torn");
  assert.deepEqual((await readTimings(store)).suites, {}, "an unreadable record starts again");
  assert.match(await readFile(store, "utf8"), /torn/, "reading never rewrites it");
});

test("with node --test, the reporter records every file's wall time", { timeout: 60_000 }, async (t) => {
  const dir = await scratch(t);
  await writeFile(path.join(dir, "slow.test.mjs"), 'import test from "node:test";\ntest("waits", () => new Promise((resolve) => setTimeout(resolve, 250)));\n');
  await writeFile(path.join(dir, "quick.test.mjs"), 'import test from "node:test";\ntest("returns", () => {});\n');
  const out = path.join(dir, "samples.jsonl");
  // A node --test started from inside a test inherits NODE_TEST_CONTEXT and
  // speaks the runner's child protocol instead of using its reporters.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, [
    "--test", "--test-concurrency=2",
    "--test-reporter=spec", "--test-reporter-destination=stdout",
    `--test-reporter=${pathToFileURL(path.join(studio, "scripts", "test-timings.mjs")).href}`, `--test-reporter-destination=${out}`,
    "slow.test.mjs", "quick.test.mjs",
  ], { cwd: dir, env, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /waits/, "the spec output still reaches the console");
  const samples = parseSamples(await readFile(out, "utf8"));
  const byName = Object.fromEntries(samples.map((sample) => [path.basename(sample.file), sample]));
  assert.deepEqual(Object.keys(byName).sort(), ["quick.test.mjs", "slow.test.mjs"]);
  assert.ok(byName["slow.test.mjs"].ms >= 250, `slow took ${byName["slow.test.mjs"].ms} ms`);
  assert.equal(byName["quick.test.mjs"].passed, true);
});
