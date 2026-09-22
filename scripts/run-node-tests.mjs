// Runs the Node suites the way `node --test "tests/**/*.test.mjs"` would, but
// holds the live Electron fixtures that drive real windows or measure
// wall-clock timing (the occlusion probe, the eyes log-tail toggle probe) out
// of the parallel stage: sibling test files loading the CPU inflate the IPC
// wall time and worker timer drift those fixtures measure, and two fixtures
// manipulating windows at once would fight over visibility, so they run in a
// second, serialized `node --test` invocation once the rest of the suite has
// drained. Exit codes chain like `&&`.
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
const parallel = all.filter((file) => !serialized.has(path.basename(file)));
const exclusive = all.filter((file) => serialized.has(path.basename(file)));

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

const runGroup = (files) => {
  const run = spawnSync(process.execPath, ["--test", ...files], { cwd: studio, stdio: "inherit" });
  return { failed: run.status !== 0 || Boolean(run.error), status: run.status };
};

const settledAtLaunch = await waitForSettledSources();
if (parallel.length) {
  const outcome = runGroup(parallel);
  if (outcome.failed) {
    // A failed parallel stage is only trustworthy evidence about the code
    // when the sources it read are the ones that launched it. If they moved
    // mid-run, the vm-section failures may be transient-content reads (the
    // rotating ReferenceError signature), not regressions.
    if ((await sourceFingerprint()) !== settledAtLaunch) {
      console.error(
        "run-node-tests: sources changed while the suite was running - vm-section failures in this run " +
          "may be transient-content reads (the rotating ReferenceError signature), not code regressions. " +
          "Rerun on a quiet tree before acting on them.",
      );
    }
    process.exit(outcome.status ?? 1);
  }
}
// The exclusive fixtures each get their own invocation: a single
// `node --test a b` call still runs the two files concurrently, and two
// live windows fighting over occlusion and visibility is exactly what this
// stage exists to prevent.
for (const file of exclusive) {
  const outcome = runGroup([file]);
  if (outcome.failed) process.exit(outcome.status ?? 1);
}
