// Runs the Node suites the way `node --test "tests/**/*.test.mjs"` would, but
// holds the live Electron fixtures that drive real windows or measure
// wall-clock timing (the occlusion probe, the eyes log-tail toggle probe) out
// of the parallel stage: sibling test files loading the CPU inflate the IPC
// wall time and worker timer drift those fixtures measure, and two fixtures
// manipulating windows at once would fight over visibility, so they run in a
// second, serialized `node --test` invocation once the rest of the suite has
// drained. Exit codes chain like `&&`.
//
// The remaining Electron fixtures (render captures, the packaging privacy
// check) stay off the default file concurrency too, but keep a small bounded
// lane instead of full serialization: a loaded full run saw five simultaneous
// `node:test` cancellations across them (TESTRUNS, 2026-09-22), all of them
// fixture starvation rather than assertions. They run after the CPU-only
// stage at a fixed two-file width, so unrelated behavioural suites keep the
// default concurrency and a slow desktop cannot starve every capture at once.
//
// Flags: `--fast` leaves out every suite that launches the real Electron
// binary (render captures, the occlusion probe, the packaging privacy check:
// the slow, desktop-bound, load-sensitive ones) so a contributor gets a
// sub-minute signal; `npm run test:fast` is that plus no Python stage.
// `--list` prints the suites a run would select and exits. Python is not this
// script's business: `npm test` (scripts/run-all-tests.mjs) finds the
// interpreter before this stage starts.
//
// Several sessions gate this repository from their own worktrees on one PC,
// so every stage first takes its turn through scripts/test-lease.mjs: one
// Electron lane on the machine at a time, two parallel stages at a time,
// first come first served, with a line every 30 s naming who holds the turn.
// The parallel stage's width follows free memory (Node's default of one suite
// per hardware thread less one meant 15 at once on the owner's laptop, with
// ~0.7 GB free), and each stage starts its slowest suites first, from the
// timings scripts/test-timings.mjs records after every run. A stage that runs
// past its limit (test-lease.mjs stageLimitMs) is stopped with everything it
// started, and the runner names the suites that were still running.
//
// Before any of that: the vm/section() suites eval slices of the real sources
// (main.cjs, renderer/idle.js, ...) in sandboxes stubbed for the current
// content, and a run launched while another session has those files mid-edit
// reads transient bytes - slices land at different markers and reference
// collaborators the sandbox never stubbed, which is the rotating
// "ReferenceError: X is not defined" signature that hits a different test
// file each run while every file passes solo. So the sources must hold still
// for a beat before the stage launches, and a stage that fails against
// sources that moved mid-run says so instead of looking like a code flake.
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testsRoot = path.join(studio, "tests");
// command_render is one fixture of 60 routes, 16 settings categories, 12
// session tabs, audio and motion: 45-53s alone, and killed at its bound when
// it shared the two-file lane in a loaded full run (TESTRUNS, 2026-09-28).
const serialized = new Set(["occlusion_probe.test.mjs", "eyes_toggle_electron.test.mjs", "command_render.test.mjs"]);

const all = [];
for (const entry of await readdir(testsRoot, { recursive: true })) {
  if (entry.endsWith(".test.mjs")) all.push(path.join(testsRoot, entry));
}
all.sort();

const args = new Set(process.argv.slice(2));
const fast = args.has("--fast");
const listOnly = args.has("--list");

// A suite is "heavy" when its source reaches for the Electron binary or one of
// the *-electron.cjs fixtures: those need a desktop and a minute or more each.
const launchesElectron = /-electron\.cjs|electron[\\/]dist|require\("electron"\)/;
const heavy = new Set();
for (const file of all) {
  if (launchesElectron.test(await readFile(file, "utf8"))) heavy.add(file);
}
const selected = fast ? all.filter((file) => !heavy.has(file)) : all;
const inSerialized = (file) => serialized.has(path.basename(file));
const parallel = selected.filter((file) => !inSerialized(file) && !heavy.has(file));
const heavyLane = selected.filter((file) => !inSerialized(file) && heavy.has(file));
const exclusive = selected.filter(inSerialized);

if (listOnly) {
  // One write, and exit only when it has been taken: process.exit() straight after
  // console.log drops whatever a pipe has not accepted yet, so a slow reader (or a
  // small pipe on a busy machine) got a list cut off part way, and the guard in
  // tests/run_node_tests_fast.test.mjs failed at random.
  const text = selected.map((file) => `${path.relative(studio, file).split(path.sep).join("/")}\n`).join("");
  process.stdout.write(text, () => process.exit(0));
  await new Promise(() => {}); // the write callback ends the process
}

console.log(
  `run-node-tests: ${selected.length} suites` +
    (fast ? ` (--fast: ${heavy.size} Electron suites skipped, Python stage not part of this script)` : ` (${heavy.size} launch Electron)`),
);

// What the section()/vm suites read off disk. Everything except the two
// curated data files under data/ is tree state; data/ itself also holds the
// live app's continuously rewritten stores, which must stay out of the
// fingerprint or it would never settle.
const watchRoots = ["main.cjs", "preload.cjs", "scripts", "renderer", "tests", "data/models.json"];
const watchable = /\.(mjs|cjs|js|css|html|json)$/;

async function sourceFingerprint() {
  const hash = createHash("sha256");
  for (const root of watchRoots) {
    const base = path.join(studio, root);
    let entries = [];
    try {
      entries = await readdir(base, { recursive: true, withFileTypes: true });
    } catch {
      continue; // a root may be absent in trimmed checkouts
    }
    for (const entry of entries.sort((a, b) => (a.parentPath ?? a.path).localeCompare(b.parentPath ?? b.path) || a.name.localeCompare(b.name))) {
      if (!entry.isFile() || !watchable.test(entry.name)) continue;
      const parent = entry.parentPath ?? entry.path;
      const full = path.join(parent, entry.name);
      const info = await stat(full).catch(() => null);
      if (!info || !info.isFile()) continue;
      hash.update(root);
      hash.update(path.sep + parent + path.sep + entry.name);
      hash.update(await readFile(full));
    }
  }
  return hash.digest("hex");
}

const settlePause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForSettledSources() {
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const before = await sourceFingerprint();
    await settlePause(1500);
    const after = await sourceFingerprint();
    if (before === after) return after;
    console.log(`run-node-tests: sources still changing (attempt ${attempt}/10), waiting for the tree to settle`);
  }
  console.error(
    "run-node-tests: sources kept changing for 15+ seconds - another session is mid-edit. " +
      "Running now reproduces the rotating vm ReferenceErrors (slices read transient bytes); " +
      "rerun once the tree is quiet.",
  );
  process.exit(1);
}

// The lease and the timings are only needed once suites actually run, so a
// --list copy of this script stays a single file.
const lease = await import("./test-lease.mjs");
const timings = await import("./test-timings.mjs");
const timingStore = await timings.readTimings();
const samplesDir = await mkdtemp(path.join(os.tmpdir(), "mefi-test-timings-"));
let samplesSeq = 0;

// Paths go in relative to the checkout (the child's cwd): ~300 absolute paths
// under a deep clone (a temp or OneDrive folder) passed Windows' 32,767-
// character command-line limit, and the spawn failed with ENAMETOOLONG before
// a single suite ran, printing nothing but "stage failed".
// The child runs asynchronously: a blocked event loop would stop the lease's
// heartbeat, and after ten silent minutes other runs would take the turn.
const runGroup = async (files, concurrency = 0, kind = "suites") => {
  const flags = concurrency > 0 ? [`--test-concurrency=${concurrency}`] : [];
  const samples = path.join(samplesDir, `stage-${(samplesSeq += 1)}.jsonl`);
  const reporters = [
    "--test-reporter=spec", "--test-reporter-destination=stdout",
    `--test-reporter=${pathToFileURL(path.join(studio, "scripts", "test-timings.mjs")).href}`, `--test-reporter-destination=${samples}`,
  ];
  const ordered = timings.longestFirst(files, timingStore, studio);
  const limit = lease.stageLimitMs(kind);
  let stopped = false;
  const outcome = await new Promise((resolve) => {
    const child = spawn(process.execPath, ["--test", ...flags, ...reporters, ...ordered.map((file) => path.relative(studio, file))], { cwd: studio, stdio: "inherit" });
    // A hung suite must not hold its lane for good: past the limit the stage goes, with everything it started.
    const timer = setTimeout(() => { stopped = true; lease.killTree(child.pid); }, limit);
    child.once("error", (error) => { clearTimeout(timer); resolve({ error }); });
    child.once("close", (status) => { clearTimeout(timer); resolve({ status }); });
  });
  if (outcome.error) console.error(`run-node-tests: could not start node --test: ${outcome.error.message}`);
  if (stopped) {
    let text = "";
    try { text = await readFile(samples, "utf8"); } catch { /* nothing finished */ }
    const finished = new Set(timings.parseSamples(text).map((sample) => path.resolve(sample.file)));
    const left = ordered.filter((file) => !finished.has(path.resolve(file))).map((file) => path.relative(studio, file).split(path.sep).join("/"));
    const span = limit >= 60_000 ? `${Math.round(limit / 60_000)} min` : `${Math.round(limit / 1000)} s`;
    console.error(`run-node-tests: this stage ran past its ${span} limit and was stopped with everything it started; ` +
      `still running then: ${left.slice(0, 10).join(", ") || "(none recorded)"}${left.length > 10 ? ` and ${left.length - 10} more` : ""}`);
  }
  await timings.recordRun(samples, { root: studio }).catch((error) => console.error(`run-node-tests: suite timings not saved (${error.message})`));
  return { failed: stopped || outcome.status !== 0 || Boolean(outcome.error), status: stopped ? 1 : outcome.status };
};

// The CPU-only suites run first at a width that follows free memory; a
// failure is only trustworthy evidence about the code when the sources it
// read are the ones that launched it, so both stages re-check the fingerprint
// before reporting. Every stage runs even after one fails: stopping at the
// first red stage hid whether the Electron lane and the exclusive fixtures
// passed, so a fix needed a second full run just to learn that. The exit
// reports them all.
const failures = [];
const runStage = async (files, concurrency, label, kind = "suites") => {
  if (!files.length) return;
  const outcome = await runGroup(files, concurrency, kind);
  if (!outcome.failed) return;
  failures.push({ label, status: outcome.status ?? 1 });
  if ((await sourceFingerprint()) !== settledAtLaunch) {
    console.error(
      `run-node-tests: sources changed while the ${label} stage was running - vm-section failures in this run ` +
        "may be transient-content reads (the rotating ReferenceError signature), not code regressions. " +
        "Rerun on a quiet tree before acting on them.",
    );
  }
};

const waitedNote = (turn) => (turn.waitedMs >= 1000 ? `, after waiting ${Math.round(turn.waitedMs / 1000)} s for a turn` : "");
const settledAtLaunch = await waitForSettledSources();
if (parallel.length) {
  const turn = await lease.acquire({ lane: "suites", label: "npm test: parallel Node suites", tree: studio });
  try {
    const freeMB = lease.freeMemoryMB();
    const width = lease.suggestWidth({ freeMB, threads: os.availableParallelism() });
    await turn.update({ width });
    console.log(`run-node-tests: parallel stage, ${width} suites at a time (${Math.round(freeMB)} MB free)${waitedNote(turn)}`);
    await runStage(parallel, width, "parallel");
  } finally {
    await turn.release();
  }
}
// The Electron fixtures run after the CPU-only suites have drained, two files
// at a time (one when free memory has no room for a second window): enough to
// overlap I/O waits, few enough that a loaded desktop cannot starve every
// capture at once. The exclusive fixtures follow inside the same turn, so no
// other run's windows open between them.
if (heavyLane.length || exclusive.length) {
  const turn = await lease.acquire({ lane: "windows", label: "npm test: Electron fixtures", tree: studio });
  try {
    const freeMB = lease.freeMemoryMB();
    const width = lease.suggestWindowWidth({ freeMB });
    await turn.update({ width });
    if (heavyLane.length) console.log(`run-node-tests: Electron lane, ${width} window(s) at a time (${Math.round(freeMB)} MB free)${waitedNote(turn)}`);
    await runStage(heavyLane, width, "Electron fixture", "windows");
    // The exclusive fixtures each get their own invocation: a single
    // `node --test a b` call still runs the two files concurrently, and two
    // live windows fighting over occlusion and visibility is exactly what this
    // stage exists to prevent.
    for (const file of exclusive) {
      await turn.update({ label: `npm test: ${path.basename(file)}` });
      await runStage([file], 0, `exclusive ${path.basename(file)}`, "exclusive");
    }
  } finally {
    await turn.release();
  }
}
await rm(samplesDir, { recursive: true, force: true }).catch(() => {});
if (failures.length) {
  console.error(`run-node-tests: ${failures.length} stage(s) failed: ${failures.map((failure) => failure.label).join(", ")}`);
  process.exit(failures[0].status || 1);
}
