import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { findPython, pythonMissing, runLegs, testLegs } from "../scripts/run-all-tests.mjs";

const PYTHON = { command: "python", args: [], name: "python" };

test("npm test runs every leg even after one fails, and exits with the failure", () => {
  const ran = [];
  const lines = [];
  const legs = testLegs(PYTHON);
  const status = runLegs(legs, { run: (leg) => { ran.push(leg.label); return { status: leg.label === "Node suites" ? 1 : 0 }; }, log: (line) => lines.push(line) });
  assert.deepEqual(ran, ["Node suites", "Python contracts", "normalized-path lock"]);
  assert.equal(status, 1);
  assert.match(lines.join("\n"), /FAIL {2}Node suites[\s\S]*pass {2}Python contracts[\s\S]*pass {2}normalized-path lock/);
  assert.equal(runLegs(legs, { run: () => ({ status: 0 }), log: () => {} }), 0);
  assert.equal(runLegs(legs, { run: (leg) => (leg.label === "Python contracts" ? { error: new Error("ENOENT") } : { status: 0 }), log: () => {} }), 1, "a leg that cannot start is a failure");
});

test("package.json's test script is the driver, and the runner no longer exits on its first failing stage", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts.test, "node scripts/run-all-tests.mjs");
  const runner = await readFile(new URL("../scripts/run-node-tests.mjs", import.meta.url), "utf8");
  const stages = runner.slice(runner.indexOf("const runStage = async"));
  assert.doesNotMatch(stages.slice(0, stages.indexOf("const settledAtLaunch")), /process\.exit/, "a failing stage is recorded, not fatal");
});

// What each name answers on a python.org install that took the installer's
// defaults: Windows' own python.exe Store stub (its real stderr and 9009), the
// `py` launcher with Python 3 behind it, and no python3 at all.
const answers = {
  python: { status: 9009, stdout: "", stderr: "Python was not found; run without arguments to install from the Microsoft Store, or disable this shortcut from Settings > Apps > Advanced app settings > App execution aliases.\r\n" },
  "py -3": { status: 0, stdout: "3\r\n", stderr: "" },
  python3: { status: null, stdout: "", stderr: "", error: Object.assign(new Error("spawn python3 ENOENT"), { code: "ENOENT" }) },
};
const probeWith = (table, seen = []) => (command, args) => {
  const name = [command, ...args.slice(0, args.indexOf("-c"))].join(" ");
  seen.push({ name, args });
  return table[name] ?? { status: null, stdout: "", error: Object.assign(new Error("ENOENT"), { code: "ENOENT" }) };
};
const CANDIDATES = [["python"], ["py", "-3"], ["python3"]];

test("npm test finds Python 3 through the py launcher when python is the Store stub", () => {
  const seen = [];
  const python = findPython({ candidates: CANDIDATES, probe: probeWith(answers, seen) });
  assert.equal(python.command, "py");
  assert.deepEqual(python.args, ["-3"]);
  assert.equal(python.name, "py -3");
  assert.deepEqual(seen.map((call) => call.name), ["python", "py -3"], "stops at the first real Python 3");
  assert.deepEqual(seen[1].args, ["-3", "-c", "import sys; print(sys.version_info[0])"], "each name must report its own major version");
  assert.deepEqual(python.tried, ["python: exit 9009"]);
  const contracts = testLegs(python).find((leg) => leg.label === "Python contracts");
  assert.equal(contracts.command, "py");
  assert.deepEqual(contracts.args.slice(0, 4), ["-3", "-m", "unittest", "discover"], "the contracts run under the interpreter that was found");
});

test("a Python 2 python is passed over, and a plain python 3 is taken first", () => {
  const two = findPython({ candidates: CANDIDATES, probe: probeWith({ ...answers, python: { status: 0, stdout: "2\n" }, "py -3": { status: 103, stdout: "" }, python3: { status: 0, stdout: "3\n" } }) });
  assert.equal(two.name, "python3");
  assert.deepEqual(two.tried, ["python: Python 2", "py -3: exit 103"]);
  const three = findPython({ candidates: CANDIDATES, probe: probeWith({ ...answers, python: { status: 0, stdout: "3\n" } }) });
  assert.equal(three.name, "python");
  assert.deepEqual(three.args, []);
});

test("with no Python 3 anywhere, npm test says what it tried and how to fix it", () => {
  const none = findPython({ candidates: CANDIDATES, probe: probeWith({ python: answers.python }) });
  assert.equal(none.command, null);
  assert.deepEqual(none.tried, ["python: exit 9009", "py -3: ENOENT", "python3: ENOENT"]);
  const message = pythonMissing(none.tried);
  assert.match(message, /needs Python 3 for the contracts in tools\//);
  assert.match(message, /python: exit 9009; py -3: ENOENT; python3: ENOENT/);
  assert.match(message, /`py` launcher/);
  assert.match(message, /npm run test:fast/);
});
