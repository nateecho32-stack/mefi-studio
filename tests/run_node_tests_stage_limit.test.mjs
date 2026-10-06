// Guards the stage limit in scripts/run-node-tests.mjs: a suite that never
// ends no longer holds its lane for good. A copy of the runner meets a suite
// that hangs forever (a child process keeps it alive, as an Electron window
// did for nine hours on 2026-10-06); with the limit at three seconds the
// stage is stopped with everything it started, the runner names the suite
// that was still running, and the run fails.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("a stage that runs past its limit is stopped, names what was still running, and fails the run", { timeout: 120_000 }, async (t) => {
  const copy = await mkdtemp(path.join(tmpdir(), "mefi-stage-limit-"));
  t.after(() => rm(copy, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }));
  await mkdir(path.join(copy, "scripts"));
  await mkdir(path.join(copy, "tests"));
  for (const name of ["run-node-tests.mjs", "test-lease.mjs", "test-timings.mjs"]) await copyFile(path.join(studio, "scripts", name), path.join(copy, "scripts", name));
  await writeFile(path.join(copy, "tests", "quick.test.mjs"), 'import test from "node:test";\ntest("returns", () => {});\n');
  // A child that never exits keeps the suite's own process alive, the way a fixture's window did.
  await writeFile(path.join(copy, "tests", "hang.test.mjs"),
    'import test from "node:test";\nimport { spawn } from "node:child_process";\n' +
    'test("waits on a child that never ends", () => new Promise(() => { spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" }); }));\n');
  const env = { ...process.env, MEFI_TEST_STAGE_LIMIT_MIN: "0.05", MEFI_TEST_LEASE_DIR: path.join(copy, "lease"), MEFI_TEST_TIMINGS: path.join(copy, "timings.json"), MEFI_TEST_LEASE: "" };
  delete env.NODE_TEST_CONTEXT;
  const started = Date.now();
  const child = spawn(process.execPath, ["scripts/run-node-tests.mjs", "--fast"], { cwd: copy, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  const seconds = (Date.now() - started) / 1000;
  assert.notEqual(code, 0, output);
  assert.ok(seconds < 60, `stopped in ${seconds.toFixed(1)} s, not left hanging`);
  assert.match(output, /this stage ran past its 3 s limit and was stopped with everything it started; still running then: tests\/hang\.test\.mjs/);
  assert.doesNotMatch(output, /still running then:[^\n]*quick\.test\.mjs/, "the suite that finished is not named");
  assert.match(output, /stage\(s\) failed: parallel/);
  assert.deepEqual((await readdir(path.join(copy, "lease"))).filter((name) => name.endsWith(".json")), [], "the turn was given back");
});
