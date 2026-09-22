import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// tools/memory_audit.mjs is the owner's read-only view of the keeper's audit:
// it must print what it finds and never touch the data folder it reads.

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tool = path.join(studio, "tools", "memory_audit.mjs");
const NOW = 1_800_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;

const board = [
  {
    id: "task_claim",
    title: "Wire the retry banner",
    status: "open",
    updatedAt: NOW - 2 * HOUR,
    verification: { state: "unverified", reason: "no attributable edits and no named checks" },
    logs: Array.from({ length: 6 }, (_, i) => ({ at: NOW - (60 - i * 5) * MIN, kind: "status", text: `autopilot run failed (exit 1) · boom ${i} · retry 1/5` })),
  },
  { id: "task_done", title: "Ship the rail", status: "done", doneAt: NOW - HOUR, updatedAt: NOW - HOUR, verification: { state: "verified", reason: "2 changed file(s) in the attempt's session" } },
  { id: "task_review", title: "Confirm the restart", status: "awaiting_verification", updatedAt: NOW - 20 * HOUR },
  { id: "task_one", title: "Full-gate rerun on the quiet tree", status: "open", parentTaskId: "task_p1", updatedAt: NOW },
  { id: "task_two", title: "Full-gate rerun on the quiet tree — follow-up 6c5e94", originalTitle: "Full-gate rerun on the quiet tree", status: "open", parentTaskId: "task_p2", updatedAt: NOW },
];
const assistant = {
  housekeeping: { lastAt: NOW - HOUR, lastText: "nothing to tidy" },
  nodeFolders: {
    "task:task:task_claim": { updatedAt: NOW - 3 * HOUR, entries: [{ at: NOW - 3 * HOUR, kind: "run", role: "executor", text: 'autopilot "Wire the retry banner" — finished, verifying (exit 0)', cell: "ver", confidence: 0.85 }] },
    "task:task_done": { updatedAt: NOW - 2 * HOUR, entries: [{ at: NOW - 2 * HOUR, kind: "run", role: "executor", text: 'autopilot "Ship the rail" — finished, verifying (exit 0)', cell: "ver", confidence: 0.85 }] },
  },
  questions: [{ id: "q_stale", source: "issue", status: "open", title: "Try again?", context: { taskId: "task_done" }, options: [] }],
  overseer: {
    lessons: [
      { text: "builders reporting failures: 2 failed runs in the last half hour", hits: 8, lastAt: NOW - 2 * HOUR },
      { text: "builders reporting failures: 3 failed runs in the last half hour", hits: 3, lastAt: NOW - HOUR },
    ],
  },
};

async function dataFolder() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "memory-audit-"));
  await writeFile(path.join(dir, "eyes-tasks.json"), `${JSON.stringify(board, null, 2)}\n`);
  await writeFile(path.join(dir, "eyes-assistant.json"), `${JSON.stringify(assistant, null, 2)}\n`);
  return dir;
}
async function snapshot(dir) {
  const names = (await readdir(dir)).sort();
  const hashes = await Promise.all(names.map(async (name) => createHash("sha256").update(await readFile(path.join(dir, name))).digest("hex")));
  return names.map((name, index) => `${name} ${hashes[index]}`);
}
const audit = (...args) => spawnSync(process.execPath, [tool, ...args], { cwd: studio, encoding: "utf8", timeout: 60_000 });

test("the audit prints findings and leaves every byte of the data folder as it was", async (t) => {
  const dir = await dataFolder();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const before = await snapshot(dir);
  const result = audit("--data", dir, "--now", String(NOW));
  assert.equal(result.status, 0, result.stderr);
  const out = result.stdout;
  assert.match(out, /^Memory audit — /);
  assert.match(out, /outcomes counted over each card's whole log window/);
  assert.match(out, /would-hold \(1\)\n {2}task_claim {2}"Wire the retry banner"/, "six charged failures, no host hold: would hold");
  assert.match(out, /an unverified run is stored as a verification/);
  assert.match(out, /memory holds only the run's own claim; verification said: no attributable edits and no named checks/);
  assert.match(out, /stalled \(1\)\n {2}task_review/);
  assert.match(out, /legacy folder keys \(merged into task:task:<id> on the next write\): task:task_done/);
  assert.match(out, /append task:task:task_done: ver "verified done — 2 changed file\(s\) in the attempt's session"/);
  assert.match(out, /settle task:task:task_done: done/);
  assert.match(out, /open issue questions about finished or missing cards: q_stale/);
  assert.match(out, /Duplicate families \(1\)\n {2}"full gate rerun on the quiet tree"\n {4}task_one open · parent task_p1/);
  assert.match(out, /Duplicate lessons \(1\)\n {2}keeps "builders reporting failures: 3 failed runs in the last half hour" \(3 hits\)\n {4}folds "builders reporting failures: 2 failed runs/);
  assert.deepEqual(await snapshot(dir), before, "read-only: nothing in the data folder changed");

  const held = audit("--data", dir, "--now", String(NOW), "--host-hold", "--armed-at", String(NOW - 2 * HOUR));
  assert.equal(held.status, 0, held.stderr);
  assert.match(held.stdout, /looping \(1\)\n {2}task_claim/, "with the host's hold the same card is held");
  const armedNow = audit("--data", dir, "--now", String(NOW), "--armed-at", "now");
  assert.match(armedNow.stdout, /would-hold 0/, "armed now: no history is charged");
  assert.deepEqual(await snapshot(dir), before);
});

test("--json writes only under tools/logs/", async (t) => {
  const dir = await dataFolder();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const before = await snapshot(dir);
  const outside = path.join(dir, "record.json");
  const refused = audit("--data", dir, "--now", String(NOW), "--json", outside);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /--json must name a file under tools\/logs\//);
  assert.equal(existsSync(outside), false);
  const escaped = audit("--data", dir, "--now", String(NOW), "--json", "../escape.json");
  assert.equal(escaped.status, 1, "a relative path cannot climb out of tools/logs/");
  assert.equal(existsSync(path.join(studio, "tools", "escape.json")), false);

  const name = `memory-audit-test-${process.pid}.json`;
  const record = path.join(studio, "tools", "logs", name);
  t.after(() => rm(record, { force: true }));
  const written = audit("--data", dir, "--now", String(NOW), "--json", name);
  assert.equal(written.status, 0, written.stderr);
  assert.match(written.stdout, new RegExp(`Record: tools[\\\\/]logs[\\\\/]${name.replace(/\./g, "\\.")}`));
  const saved = JSON.parse(await readFile(record, "utf8"));
  assert.equal(saved.report.wouldHold, 1);
  assert.deepEqual(saved.supersedeQuestionIds, ["q_stale"]);
  assert.ok(saved.findings.some((row) => row.id === "task_claim" && row.state === "would-hold"));
  assert.deepEqual(await snapshot(dir), before, "the record never lands in the data folder");
});

test("a folder with no board data is an error, not an empty report", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "memory-audit-empty-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const result = audit("--data", dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no eyes-tasks\.json or eyes-assistant\.json/);
  assert.deepEqual(await readdir(dir), []);
});
