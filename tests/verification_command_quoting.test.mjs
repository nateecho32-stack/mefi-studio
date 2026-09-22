// The overseer's scheduled verification commands survive paths with spaces:
// focusedTestsForTask quotes every path segment, because the runner executes
// the string via shell:true and cmd.exe split "Coding projects" into
// "Coding, projects" ("Could not find 'C:/.../Coding, projects/...'").
// Run: node --test tests/verification_command_quoting.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { focusedTestsForTask, isVerificationCommand } from "../scripts/assistant.mjs";

const SPACED_TASK_REF = "C:/Users/example/Desktop/Coding projects/mefi-studio/tests/worker_responsiveness.test.mjs";

test("focused node commands quote spaced absolute test paths", () => {
  const commands = focusedTestsForTask({ refs: [SPACED_TASK_REF] }, null);
  assert.deepEqual(commands, [`node --test "${SPACED_TASK_REF}"`]);
  for (const command of commands) {
    assert.ok(isVerificationCommand(command), `still recognized as check evidence: ${command}`);
  }
});

test("focused python commands quote the discovery dir and pattern", () => {
  const commands = focusedTestsForTask({ refs: ["C:/my spaced tools/tools/test_mefi_studio_probe.py"] }, null);
  assert.deepEqual(commands, ['python -m unittest discover -s "C:/my spaced tools/tools" -p "test_mefi_studio_probe.py"']);
  assert.ok(isVerificationCommand(commands[0]), commands[0]);
});

test("a scheduled check really runs against a spaced path", { skip: process.platform !== "win32" }, () => {
  const root = mkdtempSync(join(tmpdir(), "mefi spaced check-"));
  try {
    mkdirSync(join(root, "tests"));
    const probe = join(root, "tests", "probe.test.mjs");
    writeFileSync(probe, [
      "import test from \"node:test\";",
      "import assert from \"node:assert/strict\";",
      "test(\"spaced path probe\", () => { assert.equal(1 + 1, 2); });",
      "",
    ].join("\n"));
    const ref = probe.replace(/\\/g, "/");
    const [command] = focusedTestsForTask({ refs: [ref] }, null);
    const quoted = spawnSync(command, { shell: true, encoding: "utf8", windowsHide: true, timeout: 60000 });
    assert.equal(quoted.status, 0, `quoted command must pass:\n${quoted.stdout}\n${quoted.stderr}`);
    const [unquoted] = [`node --test ${ref}`];
    const mangled = spawnSync(unquoted, { shell: true, encoding: "utf8", windowsHide: true, timeout: 60000 });
    assert.notEqual(mangled.status, 0, "the pre-fix unquoted form reproduces the recorded failure");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("relative spaced paths stay quoted too", () => {
  const commands = focusedTestsForTask({ files: ["my spaced dir/tests/probe.test.mjs"] }, null);
  assert.deepEqual(commands, ['node --test "my spaced dir/tests/probe.test.mjs"']);
});
