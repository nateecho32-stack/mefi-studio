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
  { file: "scripts/decision-ledger.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads.", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  { file: "scripts/decision-memory.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads.", keeps: ["electron", "filesystem", "network", "clock"] },
  { file: "scripts/model-learning.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads.", keeps: ["electron", "filesystem", "network", "clock"] },
  { file: "scripts/autonomy.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads.", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  { file: "scripts/brains.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads.", keeps: ["electron", "filesystem", "network", "clock"] },
  { file: "scripts/agent-issues.cjs", says: "Pure module: no Electron, no filesystem, no network. Time is injectable", keeps: ["electron", "filesystem", "network", "injectableClock"] },
  { file: "scripts/policy.mjs", says: "Pure module: no Electron, no network, no clock reads (time is injected)", keeps: ["electron", "network", "clock"] },
  { file: "scripts/first-map.mjs", says: "Pure module: no filesystem, no process, no network.", keeps: ["filesystem", "processes", "network"] },
  { file: "scripts/work-classification.mjs", says: "(no network)", keeps: ["network"] },
  { file: "scripts/context-manager.cjs", says: "This module neither reads/writes saved state", keeps: ["filesystem"] },
  { file: "scripts/task-context.cjs", says: "Pure: callers persist the", keeps: ["filesystem"] },
  { file: "scripts/task-attempts.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads.", keeps: ["electron", "filesystem", "network", "clock"] },
  { file: "scripts/task-delegation.cjs", says: "This pure module runs inside the board mutation gateway", keeps: ["electron", "filesystem", "network", "processes"] },
  { file: "scripts/habits.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads.", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  // How skills are used and the answer styles Studio ships; agent-addons.cjs and main.cjs "Skills and connectors everywhere" own the files and settings.
  { file: "scripts/skill-use.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads.", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  { file: "scripts/builtin-skills.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads.", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  { file: "scripts/trace.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads.", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  { file: "scripts/request-sizing.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads.", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  { file: "scripts/new-app.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads.", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  { file: "scripts/provider-breaker.cjs", says: "no module-level singleton", keeps: ["filesystem", "network", "processes", "timers"] },
  { file: "scripts/community.cjs", says: "Pure module: no Electron, no filesystem, no network. Time is injectable", keeps: ["electron", "filesystem", "network", "injectableClock"] },
  { file: "scripts/room-history.cjs", says: "Pure module: no Electron, no filesystem, no network. Time is injectable", keeps: ["electron", "filesystem", "network", "injectableClock"] },
  { file: "scripts/task-oversight.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads (time is", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  { file: "scripts/work-admission.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads.", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  { file: "scripts/executor-core.cjs", says: "Pure module: no Electron, no filesystem, no network, no processes, no", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  // The Agent Brain's pure halves (docs/roadmap-0.4.0.md); agent-brain-host.cjs owns their I/O.
  { file: "scripts/pipelines.cjs", says: "Pure module: no Electron, no filesystem, no clock reads (time is injected),", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  { file: "scripts/playbook.cjs", says: "Pure module: no Electron, no filesystem, no clock reads (time is injected),", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  { file: "scripts/project-map.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads (time", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  { file: "scripts/desk.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads.", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  // The Discord remote's rules (docs/remote.md); main.cjs "Discord remote" owns the I/O.
  { file: "scripts/remote.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads.", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  // The Studio API's rules (docs/studio-api.md); studio-api-server.cjs listens and main.cjs "Other apps" owns the I/O.
  { file: "scripts/studio-api.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads.", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  // Windows notifications, the taskbar flash and the count on the taskbar icon: when Studio may speak, what it says and the picture of the count; alerts-host.cjs and main.cjs "Notifications" own the window, the Notification and the clock.
  { file: "scripts/alerts.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads (time is", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  { file: "scripts/badge-icon.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads.", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  // Report a problem: what a report holds, how it is redacted and how a session ended, and the zip it is saved as; report-host.cjs and main.cjs "Report a problem" own the I/O.
  { file: "scripts/crash-report.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads (time is", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  { file: "scripts/zip-lite.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads.", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  // What's new after an update (assets/whats-new.json); main.cjs "What's new" owns the file and the setting.
  { file: "scripts/whats-new.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads.", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  { file: "scripts/desk-resolve.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads.", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  { file: "scripts/companion.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads (time", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  { file: "scripts/outside-work.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads.", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  // The companion as a pet and a friend; agent-brain-host.cjs and main's "Companion friends" block own their I/O.
  { file: "scripts/companion-pet.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads (time", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  { file: "scripts/companion-friends.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads (time", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  // Several logins per coding CLI; main.cjs's block of that name owns the folders and the marks file.
  { file: "scripts/cli-accounts.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads (time is", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  // How hard a model thinks and when a stuck job steps up; main.cjs's "How hard a coding attempt thinks" block owns the reads.
  { file: "scripts/model-ladder.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads.", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  // Which model does which kind of job; main.cjs's block of that name reads the ledgers and writes the routes.
  { file: "scripts/model-kinds.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads.", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  // The fleet's seats and wires (docs/fleet-overhaul-plan.md); fleet-host.cjs owns its I/O.
  { file: "scripts/fleet.cjs", says: "Pure module: no Electron, no filesystem, no network, no processes, no", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  // The GitHub link's vocabulary and rules (chip states, repository names, failure sentences, the publish plan); git-actions.cjs owns its I/O.
  { file: "scripts/git-link.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads.", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  // The community model feed (docs/model-community.md); main's "model community feed and probes" block owns the file and the fetch.
  { file: "scripts/model-community.cjs", says: "Pure module: no Electron, no filesystem, no clock reads.", keeps: ["electron", "filesystem", "network", "processes", "clock"] },
  // The records an installing update helper and the app pass each other; main.cjs "Release updates: the safety net" owns the I/O.
  { file: "scripts/update-safety.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads (time is", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  // A task's usage tab and its time limit (renderer/tasks.js); main's "Task time limit" block owns the timer, the stop and the reads.
  { file: "scripts/task-cap.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads.", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  { file: "scripts/task-metrics.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads (`now` is", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  { file: "scripts/image-attach.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads.", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  { file: "scripts/skill-format.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads.", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  { file: "scripts/mentions.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads.", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  { file: "scripts/gitignore-lite.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads.", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  // Build's Home greeting card (renderer/builder.js); main's "work:stats" handler reads the ledgers and passes their rows and `now` in.
  { file: "scripts/work-stats.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads.", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  // The project's standing rules for its agents (ZA8); agent-addons.cjs reads the two project files and puts the block in a prompt.
  { file: "scripts/agent-rules.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads.", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  // What Studio's own models may see of a project's files (ZA9); project-search.cjs owns the folder walk and the reads.
  { file: "scripts/project-ignore.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads.", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  // Recently deleted (ZA3): the rules and the store's shape; main.cjs "Board trash" owns the file.
  { file: "scripts/board-trash.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads (time is", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  // Attempt review: snapshots, changed files, Accept and Revert, advisory checks, before and after shots, and their switches; the *-host modules and main's "Attempt review" block own the I/O.
  { file: "scripts/attempt-snapshots.cjs", says: "Pure module: no Electron, no filesystem, no network, no processes, no", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  { file: "scripts/review-prefs.cjs", says: "Pure module: no Electron, no filesystem, no network, no processes, no", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  { file: "scripts/advisory-checks.cjs", says: "Pure module: no Electron, no filesystem, no network, no processes, no", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  { file: "scripts/attempt-evidence.cjs", says: "Pure module: no Electron, no filesystem, no network, no processes, no", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  // What a board push carries; main.cjs sendRows owns the window and the clock.
  { file: "scripts/row-push.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads.", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  // readSettings' memory and the launch timings; main.cjs's blocks of those names own their stat, reads and writes.
  { file: "scripts/settings-cache.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads (time", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  { file: "scripts/startup-marks.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads (time", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  // Live progress from Claude Code and Codex, and cache-friendly provider calls; main.cjs's blocks of those names own the processes, settings and requests.
  { file: "scripts/cli-stream.cjs", says: "Pure module: no Electron, filesystem, network, processes, timers or clock", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  { file: "scripts/prompt-cache.cjs", says: "Pure module: no Electron, filesystem, network, processes, timers or clock", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
  // Where this PC's own files live (never inside OneDrive); main.cjs's "Log core" block makes the folders.
  { file: "scripts/local-dirs.cjs", says: "Pure module: no Electron, no filesystem, no network, no clock reads.", keeps: ["electron", "filesystem", "network", "processes", "timers", "clock"] },
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
