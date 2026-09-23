#!/usr/bin/env node
// Mefi's Studio AI+ — `npm test`: the Node suites (scripts/run-node-tests.mjs),
// the Python contracts in tools/, and the normalized-path lock proof.
//
// Every leg runs even when an earlier one fails. The old `a && b && c` chain
// stopped at the first red leg, so a failing Node suite hid whether the
// Python contracts and the lock still held and cost a second full run to
// find out. Each leg's output streams as it runs; a summary follows, and the
// exit is non-zero when any leg failed.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const LEGS = [
  { label: "Node suites", command: process.execPath, args: ["scripts/run-node-tests.mjs"] },
  { label: "Python contracts", command: "python", args: ["-m", "unittest", "discover", "-s", "tools", "-p", "test_mefi_studio_*.py"] },
  { label: "normalized-path lock", command: process.execPath, args: ["tools/test_normalized_path_lock.mjs"] },
];

export function runLegs(legs = LEGS, { run = (leg) => spawnSync(leg.command, leg.args, { cwd: studio, stdio: "inherit" }), log = console.log } = {}) {
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
  process.exit(runLegs());
}
