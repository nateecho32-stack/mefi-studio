// Guards the `--fast` and `--list` modes of scripts/run-node-tests.mjs: the
// fast selection must leave out every suite that launches Electron and keep
// the plain behavioural suites, and must never invent files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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

// process.exit() straight after console.log loses what a pipe has not taken yet: with a slow reader the
// list came back cut off part way. A checkout with thousands of suites makes the list bigger than a pipe
// holds, so this fails at once if the list is printed and then dropped.
test("--list hands over the whole list to a reader that is slow to read it", { timeout: 60000 }, async () => {
  const copy = await mkdtemp(path.join(tmpdir(), "mefi-list-flush-"));
  try {
    await mkdir(path.join(copy, "scripts")); await mkdir(path.join(copy, "tests"));
    await copyFile(path.join(studio, "scripts", "run-node-tests.mjs"), path.join(copy, "scripts", "run-node-tests.mjs"));
    const count = 4000;
    await Promise.all(Array.from({ length: count }, (_, index) => writeFile(path.join(copy, "tests", `a_suite_with_a_rather_long_name_${String(index).padStart(5, "0")}.test.mjs`), "// nothing\n")));
    const child = spawn(process.execPath, ["scripts/run-node-tests.mjs", "--list"], { cwd: copy, stdio: ["ignore", "pipe", "inherit"] });
    let received = "";
    child.stdout.setEncoding("utf8");
    child.stdout.pause();
    setTimeout(() => { child.stdout.on("data", (chunk) => { received += chunk; }); child.stdout.resume(); }, 700);
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    assert.equal(code, 0);
    const lines = received.split("\n").filter(Boolean);
    assert.equal(lines.length, count, "every suite is listed, not just the first few hundred");
    assert.equal(lines.at(-1), `tests/a_suite_with_a_rather_long_name_${String(count - 1).padStart(5, "0")}.test.mjs`);
  } finally {
    assert.equal(path.dirname(copy), path.resolve(tmpdir()));
    await rm(copy, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 });
  }
});
