import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { LEGS, runLegs } from "../scripts/run-all-tests.mjs";

test("npm test runs every leg even after one fails, and exits with the failure", () => {
  const ran = [];
  const lines = [];
  const status = runLegs(LEGS, { run: (leg) => { ran.push(leg.label); return { status: leg.label === "Node suites" ? 1 : 0 }; }, log: (line) => lines.push(line) });
  assert.deepEqual(ran, ["Node suites", "Python contracts", "normalized-path lock"]);
  assert.equal(status, 1);
  assert.match(lines.join("\n"), /FAIL {2}Node suites[\s\S]*pass {2}Python contracts[\s\S]*pass {2}normalized-path lock/);
  assert.equal(runLegs(LEGS, { run: () => ({ status: 0 }), log: () => {} }), 0);
  assert.equal(runLegs(LEGS, { run: (leg) => (leg.label === "Python contracts" ? { error: new Error("ENOENT") } : { status: 0 }), log: () => {} }), 1, "a leg that cannot start is a failure");
});

test("package.json's test script is the driver, and the runner no longer exits on its first failing stage", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts.test, "node scripts/run-all-tests.mjs");
  const runner = await readFile(new URL("../scripts/run-node-tests.mjs", import.meta.url), "utf8");
  const stages = runner.slice(runner.indexOf("const runStage = async"));
  assert.doesNotMatch(stages.slice(0, stages.indexOf("const settledAtLaunch")), /process\.exit/, "a failing stage is recorded, not fatal");
});
