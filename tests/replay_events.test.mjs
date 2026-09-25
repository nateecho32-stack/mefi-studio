import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { parseArgs, formatList } from "../tools/replay-events.mjs";

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tool = path.join(studio, "tools", "replay-events.mjs");

// Local wall-clock times, so the day filter holds in any timezone.
const local = (day, hours, minutes = 0, seconds = 0) => new Date(2026, 8, day, hours, minutes, seconds).getTime();
const jsonl = (rows) => `${rows.map((row) => (typeof row === "string" ? row : JSON.stringify(row))).join("\n")}\n`;

async function tempDir(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "replay-events-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

const run = (...args) => spawnSync(process.execPath, [tool, ...args], { encoding: "utf8", timeout: 30000 });

test("parseArgs reads the day, data dir and output flags", () => {
  const options = parseArgs(["--day", "2026-09-23"]);
  assert.deepEqual(options, { day: "2026-09-23", data: path.join(studio, "data"), json: false, list: false, help: false });
  const custom = parseArgs(["--list", "--data", "some/dir", "--json", "--day", "2026-09-22"]);
  assert.equal(custom.day, "2026-09-22");
  assert.equal(custom.data, path.resolve("some/dir"));
  assert.equal(custom.json, true);
  assert.equal(custom.list, true);
  assert.equal(parseArgs(["--day=2026-01-02", "--data=x"]).data, path.resolve("x"));
  assert.equal(parseArgs(["--help"]).help, true, "help needs no day");
});

test("parseArgs rejects missing, malformed and unknown arguments", () => {
  assert.throws(() => parseArgs([]), /--day is required/);
  assert.throws(() => parseArgs(["--day"]), /--day needs a value/);
  assert.throws(() => parseArgs(["--day", "--json"]), /--day needs a value/);
  assert.throws(() => parseArgs(["--day", "2026-02-30"]), /real date/);
  assert.throws(() => parseArgs(["--day", "yesterday"]), /real date/);
  assert.throws(() => parseArgs(["--day", "2026-09-23", "--data"]), /--data needs a value/);
  assert.throws(() => parseArgs(["--day", "2026-09-23", "--verbose"]), /unknown argument: --verbose/);
  assert.throws(() => parseArgs(["--day", "2026-09-23", "--json=1"]), /unknown argument/);
  assert.throws(() => parseArgs(["2026-09-23"]), /unknown argument/);
});

test("formatList times each event from the first", () => {
  const start = local(23, 10);
  const text = formatList([
    { v: 1, at: start, kind: "agent.out", taskId: "task_a", runId: "run_1" },
    { v: 1, at: start + 5000, kind: "step.start", taskId: "task_a", step: "build", text: "writing the patch" },
    { v: 1, at: start + 65000, kind: "report", taskId: "task_a", title: "Fix save" },
    { v: 1, at: start + 3725000, kind: "mail" },
  ]);
  assert.deepEqual(text.split("\n"), [
    "+00:00 agent.out  task_a",
    "+00:05 step.start task_a build writing the patch",
    "+01:05 report     task_a Fix save",
    "+62:05 mail       -",
  ]);
  assert.equal(formatList([]), "");
  assert.equal(formatList(null), "");
  assert.equal(formatList([{ at: 2000, kind: "stage" }, { at: 1000, kind: "stage", text: "late row" }]).split("\n")[1], "-00:01 stage - late row");
});

async function recordedDay(t, { extraOut = false } = {}) {
  const dir = await tempDir(t);
  const events = [
    { v: 1, at: local(22, 23, 0), kind: "agent.out", taskId: "task_old", runId: "run_0" },
    { v: 1, at: local(23, 10, 0, 0), kind: "agent.out", taskId: "task_a", runId: "run_1" },
    { v: 1, at: local(23, 10, 0, 5), kind: "step.start", taskId: "task_a", runId: "run_1", step: "build" },
    { v: 1, at: local(23, 10, 1, 0), kind: "file.edit", taskId: "task_a", runId: "run_1", files: ["main.cjs"] },
    "not json",
    { v: 1, at: local(23, 10, 2, 0), kind: "agent.home", taskId: "task_a", runId: "run_1", ok: true },
    { v: 1, at: local(23, 11, 0, 0), kind: "agent.out", taskId: "task_b", runId: "run_2" },
    { v: 1, at: local(23, 11, 30, 0), kind: "agent.home", taskId: "task_b", runId: "run_2", ok: false },
  ];
  if (extraOut) events.push({ v: 1, at: local(23, 12), kind: "agent.out", taskId: "task_c", runId: "run_3" });
  const ledger = [
    { at: local(22, 23, 0), event: "start", runId: "run_0", task: "task_old" },
    { at: local(23, 10, 0, 0), event: "start", runId: "run_1", task: "task_a" },
    { at: local(23, 10, 2, 0), event: "finish", runId: "run_1", task: "task_a", ok: true },
    { at: local(23, 11, 0, 0), event: "start", runId: "run_2", task: "task_b" },
    { at: local(23, 11, 10, 0), event: "fallback", runId: "run_2", task: "task_b" },
    { at: local(23, 11, 30, 0), event: "finish", runId: "run_2", task: "task_b", ok: false },
    { at: local(24, 0, 0, 1), event: "start", runId: "run_9", task: "task_next" },
  ];
  await writeFile(path.join(dir, "work-events.jsonl"), jsonl(events), "utf8");
  await writeFile(path.join(dir, "executor-log.jsonl"), jsonl(ledger), "utf8");
  return dir;
}

test("the CLI replays a matching day and exits 0", async (t) => {
  const dir = await recordedDay(t);
  const json = run("--day", "2026-09-23", "--data", dir, "--json");
  assert.equal(json.status, 0, json.stderr);
  const { summary, compare } = JSON.parse(json.stdout);
  assert.deepEqual(summary, {
    total: 6,
    byKind: { "step.start": 1, "agent.out": 2, "agent.home": 2, "file.edit": 1 },
    tasks: 2, agentsOut: 2, agentsHome: 2, firstAt: local(23, 10), lastAt: local(23, 11, 30),
  });
  assert.deepEqual(compare, { ok: true, events: { out: 2, home: 2 }, ledger: { starts: 2, finishes: 2 }, diff: { out: 0, home: 0 } });

  const human = run("--day", "2026-09-23", "--data", dir, "--list");
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /^\+00:00 agent\.out\s+task_a/m);
  assert.match(human.stdout, /^\+00:05 step\.start\s+task_a build$/m);
  assert.match(human.stdout, /^\+90:00 agent\.home\s+task_b$/m);
  assert.match(human.stdout, /events: 6 across 2 tasks, 10:00:00 to 11:30:00/);
  assert.match(human.stdout, /agents: 2 out, 2 home/);
  assert.match(human.stdout, /Ledger: 2 starts, 2 finishes/);
  assert.match(human.stdout, /compare: ok/);
  assert.doesNotMatch(run("--day", "2026-09-23", "--data", dir).stdout, /\+00:00/, "the list is opt-in");
});

test("the CLI exits 1 when the stream and the ledger disagree", async (t) => {
  const dir = await recordedDay(t, { extraOut: true });
  const json = run("--day", "2026-09-23", "--data", dir, "--json");
  assert.equal(json.status, 1);
  const { compare } = JSON.parse(json.stdout);
  assert.deepEqual(compare, { ok: false, events: { out: 3, home: 2 }, ledger: { starts: 2, finishes: 2 }, diff: { out: 1, home: 0 } });
  const human = run("--day", "2026-09-23", "--data", dir);
  assert.equal(human.status, 1);
  assert.match(human.stdout, /MISMATCH \(agents out \+1 vs starts, home 0 vs finishes\)/);
});

test("the CLI treats missing files as an empty day, and exits 2 on bad arguments", async (t) => {
  const dir = await tempDir(t);
  const empty = run("--day", "2026-09-23", "--data", dir, "--json");
  assert.equal(empty.status, 0, empty.stderr);
  assert.equal(JSON.parse(empty.stdout).summary.total, 0);
  const noDay = run("--data", dir);
  assert.equal(noDay.status, 2);
  assert.match(noDay.stderr, /--day is required/);
  assert.match(noDay.stderr, /usage:/);
  assert.equal(run("--day", "2026-02-30").status, 2);
  assert.equal(run("--day", "2026-09-23", "--bogus").status, 2);
  const help = run("--help");
  assert.equal(help.status, 0);
  assert.match(help.stdout, /usage:/);
});
