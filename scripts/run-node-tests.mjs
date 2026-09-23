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
// `--list` prints the suites a run would select and exits. Without `--fast`
// the runner first checks that `python` on PATH is Python 3, because
// `npm test` chains the tools/ contracts after this stage and a missing
// interpreter otherwise fails forty seconds in with a bare "not found".
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
import { readdir, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testsRoot = path.join(studio, "tests");
const serialized = new Set(["occlusion_probe.test.mjs", "eyes_toggle_electron.test.mjs"]);

const all = [];
for (const entry of await readdir(testsRoot, { recursive: true })) {
  if (entry.endsWith(".test.mjs")) all.push(path.join(testsRoot, entry));
}
all.sort();

const args = new Set(process.argv.slice(2));
const fast = args.has("--fast");
const listOnly = args.has("--list");
const skipPythonCheck = fast || listOnly || args.has("--skip-python-check");

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
  for (const file of selected) console.log(path.relative(studio, file).split(path.sep).join("/"));
  process.exit(0);
}

function pythonPreflight() {
  const probe = spawnSync("python", ["--version"], { encoding: "utf8" });
  const version = `${probe.stdout || ""}${probe.stderr || ""}`.trim();
  if (!probe.error && probe.status === 0 && /^Python 3\./.test(version)) return;
  const found = probe.error ? probe.error.code : version || `exit ${probe.status}`;
  console.error(
    `run-node-tests: npm test needs Python 3 on PATH as \`python\` for the contracts in tools/ (found: ${found}). ` +
      "Install it, or run `npm run test:fast` for the Node suites alone.",
  );
  process.exit(1);
}
if (!skipPythonCheck) pythonPreflight();
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

const runGroup = (files, concurrency = 0) => {
  const flags = concurrency > 0 ? [`--test-concurrency=${concurrency}`] : [];
  const run = spawnSync(process.execPath, ["--test", ...flags, ...files], { cwd: studio, stdio: "inherit" });
  return { failed: run.status !== 0 || Boolean(run.error), status: run.status };
};

// The CPU-only suites run first at the runner's default width; a failure is
// only trustworthy evidence about the code when the sources it read are the
// ones that launched it, so both stages re-check the fingerprint before
// reporting. Every stage runs even after one fails: stopping at the first red
// stage hid whether the Electron lane and the exclusive fixtures passed, so a
// fix needed a second full run just to learn that. The exit reports them all.
const failures = [];
const runStage = async (files, concurrency, label) => {
  if (!files.length) return;
  const outcome = runGroup(files, concurrency);
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

const settledAtLaunch = await waitForSettledSources();
await runStage(parallel, 0, "parallel");
// The Electron fixtures run after the CPU-only suites have drained, at a
// fixed two-file width: enough to overlap I/O waits, few enough that a
// loaded desktop cannot starve every capture at once.
await runStage(heavyLane, 2, "Electron fixture");
// The exclusive fixtures each get their own invocation: a single
// `node --test a b` call still runs the two files concurrently, and two
// live windows fighting over occlusion and visibility is exactly what this
// stage exists to prevent.
for (const file of exclusive) await runStage([file], 0, `exclusive ${path.basename(file)}`);
if (failures.length) {
  console.error(`run-node-tests: ${failures.length} stage(s) failed: ${failures.map((failure) => failure.label).join(", ")}`);
  process.exit(failures[0].status || 1);
}
