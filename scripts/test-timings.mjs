// Mefi's Studio AI+ — how long each test suite takes, so the slow ones start
// first.
//
// `node --test --test-concurrency=N` starts the files in the order it is
// given them. In alphabetical order a 90-second git suite could be the last
// one started, and the whole stage then waited a minute and a half on it
// alone. scripts/run-node-tests.mjs adds this file as a second reporter
// (beside spec on stdout); it writes one JSON line per finished file, and
// the runner folds them into a machine-wide record that orders the next run
// longest first. Every worktree on the PC shares that record: the suites are
// the same files.
//
// The record lives beside the test lease board (scripts/test-lease.mjs):
// %LOCALAPPDATA%\MefiStudio\test-timings.json on Windows, the temp folder
// elsewhere, or MEFI_TEST_TIMINGS. Losing it costs nothing but the order.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const TIMINGS_VERSION = 1;

export function timingsFile(env = process.env, platform = process.platform) {
  if (env.MEFI_TEST_TIMINGS) return path.resolve(env.MEFI_TEST_TIMINGS);
  if (platform === "win32" && env.LOCALAPPDATA) return path.join(env.LOCALAPPDATA, "MefiStudio", "test-timings.json");
  return path.join(os.tmpdir(), "mefi-studio-test-timings.json");
}

// The suite's key in the record: its path under the checkout, with forward
// slashes, so C:\wt\a\tests\x.test.mjs and the main checkout's copy agree.
export function suiteKey(file, root) {
  const relative = path.relative(root, file);
  return (relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : path.basename(file)).split(path.sep).join("/");
}

// node:test reporter. With process isolation each file is a top-level test
// named by the path it was given as (`tests\x.test.mjs`, relative to the
// runner's folder, which is this reporter's too), and its test:complete
// carries the file's whole wall time, from the child's start to its last test.
export function isFileCompletion(data, cwd = process.cwd()) {
  return data?.nesting === 0 && typeof data.file === "string" && typeof data.name === "string" &&
    path.resolve(cwd, data.name) === path.resolve(data.file);
}

export default async function* timingsReporter(source) {
  for await (const event of source) {
    if (event.type !== "test:complete") continue;
    const data = event.data ?? {};
    if (!isFileCompletion(data)) continue;
    const ms = Number(data.details?.duration_ms);
    if (!Number.isFinite(ms)) continue;
    yield `${JSON.stringify({ file: data.file, ms: Math.round(ms), passed: data.details?.passed !== false })}\n`;
  }
}

export function parseSamples(text) {
  const samples = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const sample = JSON.parse(line);
      if (sample && typeof sample.file === "string" && Number.isFinite(sample.ms)) samples.push(sample);
    } catch {
      // a line cut off by a killed run
    }
  }
  return samples;
}

export async function readTimings(file = timingsFile()) {
  try {
    const store = JSON.parse(await readFile(file, "utf8"));
    if (store?.version === TIMINGS_VERSION && store.suites && typeof store.suites === "object") return store;
  } catch {
    // missing or unreadable: start again
  }
  return { version: TIMINGS_VERSION, suites: {} };
}

// A new reading counts for 60% against the last estimate: one run on a busy
// machine moves the order, but does not decide it.
export function mergeTimings(store, samples, { root, now = Date.now(), weight = 0.6 } = {}) {
  const suites = { ...(store?.suites ?? {}) };
  for (const sample of samples) {
    const key = suiteKey(sample.file, root);
    const before = suites[key];
    const ms = before && Number.isFinite(before.ms) ? Math.round(weight * sample.ms + (1 - weight) * before.ms) : sample.ms;
    suites[key] = { ms, last: sample.ms, runs: (before?.runs ?? 0) + 1, passed: sample.passed !== false, at: new Date(now).toISOString() };
  }
  return { version: TIMINGS_VERSION, suites };
}

export async function writeTimings(store, file = timingsFile()) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(temp, `${JSON.stringify(store, null, 1)}\n`);
  try {
    await rename(temp, file);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}

// Folds one run's reporter output into the shared record. Another run may
// have written meanwhile, so the record is read again right before writing.
export async function recordRun(samplesFile, { root, file = timingsFile(), now = Date.now() } = {}) {
  let text = "";
  try {
    text = await readFile(samplesFile, "utf8");
  } catch {
    return 0;
  }
  const samples = parseSamples(text);
  if (!samples.length) return 0;
  await writeTimings(mergeTimings(await readTimings(file), samples, { root, now }), file);
  return samples.length;
}

// Longest known suite first. Suites the record has never seen go before all
// of them: a new suite has no estimate, and starting it early keeps a slow
// one from becoming the tail. Ties keep the incoming (alphabetical) order.
export function longestFirst(files, store, root) {
  const known = (file) => store?.suites?.[suiteKey(file, root)]?.ms;
  return files
    .map((file, index) => ({ file, index, ms: known(file) }))
    .sort((a, b) => {
      const aNew = !Number.isFinite(a.ms);
      const bNew = !Number.isFinite(b.ms);
      if (aNew !== bNew) return aNew ? -1 : 1;
      if (!aNew && a.ms !== b.ms) return b.ms - a.ms;
      return a.index - b.index;
    })
    .map((entry) => entry.file);
}

// The slowest suites in the record, for `node scripts/test-timings.mjs`.
export function slowest(store, count = 25) {
  return Object.entries(store?.suites ?? {})
    .filter(([, entry]) => Number.isFinite(entry?.ms))
    .sort((a, b) => b[1].ms - a[1].ms)
    .slice(0, count)
    .map(([suite, entry]) => ({ suite, ...entry }));
}
