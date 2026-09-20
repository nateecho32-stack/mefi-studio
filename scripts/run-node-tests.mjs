// Runs the Node suites the way `node --test "tests/**/*.test.mjs"` would, but
// holds the live Electron fixtures that drive real windows or measure
// wall-clock timing (the occlusion probe, the eyes log-tail toggle probe) out
// of the parallel stage: sibling test files loading the CPU inflate the IPC
// wall time and worker timer drift those fixtures measure, and two fixtures
// manipulating windows at once would fight over visibility, so they run in a
// second, serialized `node --test` invocation once the rest of the suite has
// drained. Exit codes chain like `&&`.
import { readdir } from "node:fs/promises";
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

for (const group of [parallel, exclusive]) {
  if (!group.length) continue;
  const run = spawnSync(process.execPath, ["--test", ...group], { cwd: studio, stdio: "inherit" });
  if (run.status !== 0 || run.error) process.exit(run.status ?? 1);
}
