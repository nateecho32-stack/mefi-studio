import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

// Several modules promise, in their own header, not to touch the filesystem,
// the network, the clock or Electron — the ones the board gateway runs inside a
// transaction and the vm-hosted suites load with no host. A header is only a
// comment, so this suite holds each module to the promise it makes: the phrase
// must still be in the header, and the code must not break it. A new module
// that declares "Pure module: no …" has to be added here, or the last test
// fails. (A structure test in the manner of BetterC0de's
// bootstrap.structure.test.ts.)

const PROMISES = [
  { file: "scripts/brains.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads.", keeps: ["electron", "filesystem", "network", "clock"] },
  { file: "scripts/agent-issues.cjs", says: "Pure module: no Electron, no filesystem, no network. Time is injectable", keeps: ["electron", "filesystem", "network", "injectableClock"] },
  { file: "scripts/policy.mjs", says: "Pure module: no Electron, no network, no clock reads (time is injected)", keeps: ["electron", "network", "clock"] },
  { file: "scripts/first-map.mjs", says: "Pure module: no filesystem, no process, no network.", keeps: ["filesystem", "processes", "network"] },
  { file: "scripts/work-classification.mjs", says: "(no network)", keeps: ["network"] },
  { file: "scripts/context-manager.cjs", says: "This module neither reads/writes saved state", keeps: ["filesystem"] },
  { file: "scripts/task-context.cjs", says: "Pure: callers persist the", keeps: ["filesystem"] },
  { file: "scripts/task-attempts.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads.", keeps: ["electron", "filesystem", "network", "clock"] },
  { file: "scripts/task-delegation.cjs", says: "This pure module runs inside the board mutation gateway", keeps: ["electron", "filesystem", "network", "processes"] },
  { file: "scripts/provider-breaker.cjs", says: "no module-level singleton", keeps: ["filesystem", "network", "processes", "timers"] },
  { file: "scripts/community.cjs", says: "Pure module: no Electron, no filesystem, no network. Time is injectable", keeps: ["electron", "filesystem", "network", "injectableClock"] },
  { file: "scripts/task-oversight.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads (time is", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  { file: "scripts/work-admission.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads.", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  { file: "scripts/executor-core.cjs", says: "Pure module: no Electron, no filesystem, no network, no processes, no", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  // The Agent Brain's pure halves (docs/roadmap-0.4.0.md); agent-brain-host.cjs owns their I/O.
  { file: "scripts/pipelines.cjs", says: "Pure module: no Electron, no filesystem, no clock reads (time is injected),", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  { file: "scripts/playbook.cjs", says: "Pure module: no Electron, no filesystem, no clock reads (time is injected),", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  { file: "scripts/project-map.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads (time", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  { file: "scripts/desk.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads.", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  { file: "scripts/companion.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads (time", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
];

const CLOCK = /\bDate\.now\s*\(|new\s+Date\s*\(\s*\)|\bperformance\.now\s*\(/;
const CHECKS = {
  electron: { means: "loads Electron", test: (line) => /require\(\s*["']electron["']\s*\)|from\s+["']electron["']/.test(line) },
  filesystem: { means: "loads the filesystem", test: (line) => /require\(\s*["'](node:)?fs(\/promises)?["']\s*\)|from\s+["'](node:)?fs(\/promises)?["']/.test(line) },
  network: { means: "reaches the network", test: (line) => /require\(\s*["'](node:)?(http|https|net|tls|dgram|dns)["']\s*\)|from\s+["'](node:)?(http|https|net|tls|dgram|dns)["']|\bfetch\s*\(|\bWebSocket\b|\bXMLHttpRequest\b/.test(line) },
  processes: { means: "starts processes", test: (line) => /require\(\s*["'](node:)?child_process["']\s*\)|from\s+["'](node:)?child_process["']/.test(line) },
  timers: { means: "schedules a timer", test: (line) => /\bset(Timeout|Interval|Immediate)\s*\(/.test(line) },
  clock: { means: "reads the clock", test: (line) => CLOCK.test(line) },
  // The clock only as the default of an injectable `now` parameter.
  injectableClock: { means: "reads the clock outside a `now = Date.now()` default", test: (line) => CLOCK.test(line.replace(/\bnow\s*=\s*Date\.now\(\)/g, "")) },
};

// Comments hold the promises, and often name the very things they rule out, so
// only code is checked. Blanking keeps line numbers true for the report.
function codeLines(source) {
  const blanked = source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ""))
    .replace(/^\s*\/\/.*$/gm, "");
  return blanked.split("\n");
}

const read = async (file) => (await readFile(new URL(`../${file}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");

for (const { file, says, keeps } of PROMISES) {
  test(`${file} keeps the promise in its header`, async () => {
    const source = await read(file);
    assert.ok(source.slice(0, 4000).includes(says), `${file} no longer says "${says}" — update this suite with the header`);
    const lines = codeLines(source);
    for (const check of keeps) {
      const broken = lines.map((line, index) => [index + 1, line]).filter(([, line]) => CHECKS[check].test(line));
      assert.deepEqual(broken.map(([number, line]) => `${file}:${number} ${line.trim()}`), [],
        `${file} promises otherwise, but ${CHECKS[check].means}`);
    }
  });
}

test("every module that declares itself pure is held to it here", async () => {
  const dir = new URL("../scripts/", import.meta.url);
  const listed = new Set(PROMISES.map((entry) => entry.file));
  const unlisted = [];
  for (const name of (await readdir(dir)).filter((entry) => /\.(c|m)?js$/.test(entry)).sort()) {
    const header = (await read(`scripts/${name}`)).slice(0, 4000);
    if (/Pure module: no\b/.test(header) && !listed.has(`scripts/${name}`)) unlisted.push(`scripts/${name}`);
  }
  assert.deepEqual(unlisted, [], "these headers promise purity that no test enforces");
});
