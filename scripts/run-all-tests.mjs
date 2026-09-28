#!/usr/bin/env node
// Mefi's Studio AI+ — `npm test`: the Node suites (scripts/run-node-tests.mjs),
// the Python contracts in tools/, and the normalized-path lock proof.
//
// Every leg runs even when an earlier one fails. The old `a && b && c` chain
// stopped at the first red leg, so a failing Node suite hid whether the
// Python contracts and the lock still held and cost a second full run to
// find out. Each leg's output streams as it runs; a summary follows, and the
// exit is non-zero when any leg failed.
//
// Python is found before anything runs: a missing interpreter otherwise
// failed the run minutes in, after the Node stage, with a bare "not found".
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The names Python 3 goes by, in order. python.org's Windows installer puts
// only the `py` launcher on PATH by default, and Windows' own `python.exe`
// and `python3.exe` are Store stubs (App Execution Aliases) that print an
// install hint and exit 9009, so asking for `python` alone failed on a fresh
// machine with a message about the Microsoft Store.
export const PYTHON_CANDIDATES = process.platform === "win32"
  ? [["python"], ["py", "-3"], ["python3"]]
  : [["python"], ["python3"]];

// A candidate counts only when it runs and prints its major version as 3: the
// Store stub prints nothing to stdout and a Python 2 `python` prints 2, so
// both fall through to the next name. Returns the interpreter as a command
// plus the arguments that select it, and what each rejected name answered.
export function findPython({
  candidates = PYTHON_CANDIDATES,
  probe = (command, args) => spawnSync(command, args, { encoding: "utf8", windowsHide: true, timeout: 15000 }),
} = {}) {
  const tried = [];
  for (const [command, ...prefix] of candidates) {
    const name = [command, ...prefix].join(" ");
    const outcome = probe(command, [...prefix, "-c", "import sys; print(sys.version_info[0])"]) ?? {};
    const major = String(outcome.stdout ?? "").trim();
    if (!outcome.error && outcome.status === 0 && major === "3") return { command, args: prefix, name, tried };
    tried.push(`${name}: ${outcome.error ? outcome.error.code ?? outcome.error.message : /^\d+$/.test(major) ? `Python ${major}` : `exit ${outcome.status ?? "?"}`}`);
  }
  return { command: null, args: [], name: null, tried };
}

export function pythonMissing(tried) {
  return `run-all-tests: npm test needs Python 3 for the contracts in tools/ (tried ${tried.join("; ")}). ` +
    "Install Python 3 from python.org (its `py` launcher is enough; a `python` that only opens the Microsoft Store is " +
    "Windows' App Execution Alias, not Python), or run `npm run test:fast` for the Node suites alone.";
}

export function testLegs(python) {
  return [
    { label: "Node suites", command: process.execPath, args: ["scripts/run-node-tests.mjs"] },
    { label: "Python contracts", command: python.command, args: [...python.args, "-m", "unittest", "discover", "-s", "tools", "-p", "test_mefi_studio_*.py"] },
    { label: "normalized-path lock", command: process.execPath, args: ["tools/test_normalized_path_lock.mjs"] },
  ];
}

export function runLegs(legs, { run = (leg) => spawnSync(leg.command, leg.args, { cwd: studio, stdio: "inherit" }), log = console.log } = {}) {
  const results = legs.map((leg) => {
    const started = Date.now();
    const outcome = run(leg);
    const status = outcome.error ? 1 : outcome.status ?? 1;
    return { label: leg.label, ok: status === 0, status, seconds: Math.round((Date.now() - started) / 1000), error: outcome.error?.message ?? null };
  });
  log("\nnpm test summary:");
  for (const result of results) {
    log(`  ${result.ok ? "pass" : "FAIL"}  ${result.label} (${result.seconds} s${result.ok ? "" : `, exit ${result.status}${result.error ? `, ${result.error}` : ""}`})`);
  }
  return results.every((result) => result.ok) ? 0 : (results.find((result) => !result.ok).status || 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const python = findPython();
  if (!python.command) {
    console.error(pythonMissing(python.tried));
    process.exit(1);
  }
  if (python.name !== "python") console.log(`run-all-tests: Python contracts run with \`${python.name}\``);
  process.exit(runLegs(testLegs(python)));
}
