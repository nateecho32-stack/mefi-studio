// Guards the `--fast` and `--list` modes of scripts/run-node-tests.mjs: the
// fast selection must leave out every suite that launches Electron and keep
// the plain behavioural suites, and must never invent files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function list(...flags) {
  const run = spawnSync(process.execPath, ["scripts/run-node-tests.mjs", "--list", ...flags], { cwd: studio, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.split(/\r?\n/).filter(Boolean);
}

test("--fast leaves out every suite that launches Electron", () => {
  const full = list();
  const fast = list("--fast");
  assert.ok(full.includes("tests/occlusion_probe.test.mjs"), "full run includes the occlusion probe");
  assert.ok(full.includes("tests/board.test.mjs"), "full run includes a plain suite");
  assert.ok(!fast.includes("tests/occlusion_probe.test.mjs"), "fast run skips the occlusion probe");
  assert.ok(!fast.includes("tests/eyes_toggle_electron.test.mjs"), "fast run skips the eyes toggle probe");
  assert.ok(!fast.includes("tests/package_privacy.test.mjs"), "fast run skips the packaging check");
  assert.ok(fast.includes("tests/board.test.mjs"), "fast run keeps plain suites");
  // Rarely this failed in a full run on a busy machine and passed alone; if it does again, the sizes and whether the
  // full list had the file say whether the listing or the classification is at fault.
  const self = "tests/run_node_tests_fast.test.mjs";
  assert.ok(fast.includes(self), `fast run keeps this guard (fast ${fast.length} suites, full ${full.length}, full has it: ${full.includes(self)})`);
  assert.ok(fast.length < full.length);
  for (const file of fast) assert.ok(full.includes(file), `${file} is a real suite`);
});
