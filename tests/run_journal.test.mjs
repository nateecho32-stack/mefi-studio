// The run journal's rules (scripts/run-journal.cjs, docs/plans/scratch-tier.md
// WP0-B): the checkpoint's journal record, lines out of a file read in pieces
// (a torn last line waits), the verdict a tail holds, which rows an earlier
// engine left can be adopted, the entry they become, the side-effects-once
// rule, the updater's gate and the kill switch. No file, process or timer.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const journal = createRequire(import.meta.url)("../scripts/run-journal.cjs");
const { journalName, journalRecord, splitLines, readTail, adoptEnabled, adoptable, adoptedEntry, alreadySettled, alreadyLogged, adoptableJob, restartSafe } = journal;

const ALIVE = 4100, DEAD = 4200, ME = 101, OLD_ENGINE = 77;
const isAlive = (pid) => (pid === ALIVE ? true : pid === DEAD || pid === OLD_ENGINE ? false : null);
const row = (over = {}) => ({
  id: "t1", title: "Fix the thing", status: "active", runId: "run_1700000000000_3", lease: { pid: OLD_ENGINE, at: 5 },
  runProgress: { version: 1, runId: "run_1700000000000_3", pid: OLD_ENGINE, workerPid: ALIVE, startedAt: 1700000000000, sessionId: null, progress: 0.5,
    todos: [{ content: "Read", status: "completed" }, { content: "Fix", status: "in_progress" }], outputTail: ["$ npm test", "3 passing"],
    cliSession: { cli: "claude", id: "0f8d6c1e-5b8a-4a51-9a33-9d0c2f3e4b5a", model: "haiku", account: null, cwd: "C:/repo" },
    journal: { path: "C:/local/journal/p1/runs/run_1700000000000_3.out", offset: 120, format: "claude" } },
  ...over,
});

test("the journal's name and its checkpoint record are bounded and tolerant", () => {
  assert.equal(journalName("run_1_2"), "run_1_2.out");
  assert.equal(journalName("run/1 2"), "run12.out", "only letters, digits, dash and underscore name a file");
  assert.throws(() => journalName("///"), /run id/);
  assert.deepEqual(journalRecord({ path: "C:/j/run.out", offset: 12.7, format: "claude", fd: 9, tail: {} }), { path: "C:/j/run.out", offset: 12, format: "claude" }, "the handle and the tail never reach the checkpoint");
  assert.deepEqual(journalRecord({ path: "C:/j/run.out", offset: -4, format: "text" }), { path: "C:/j/run.out", offset: 0, format: null });
  assert.equal(journalRecord(null), null);
  assert.equal(journalRecord({ offset: 3 }), null, "no path, no journal");
});

test("lines come out of pieces as wire() reads them, and a torn last line waits for its end", () => {
  let out = splitLines("", "one\r\ntwo\nthr");
  assert.deepEqual(out, { lines: ["one", "two"], rest: "thr" });
  out = splitLines(out.rest, "ee\nfour");
  assert.deepEqual(out, { lines: ["three"], rest: "four" });
  assert.deepEqual(splitLines("four", "\n"), { lines: ["four"], rest: "" });
  assert.deepEqual(splitLines("", "spin\rspin\n"), { lines: ["spin\rspin"], rest: "" }, "a lone CR stays inside its line");
  const long = "x".repeat(70000);
  assert.equal(splitLines("", `${long}\n`).lines[0].length, 65536, "a line that never ends is kept to 64 KiB");
});

test("a tail is read for its verdict: the sentinel on its own line, the first MEFI_RESULT, the last real line", () => {
  const body = "Working...\n\u001b[32m$ npm test\u001b[0m\nMEFI_RESULT: done: fixed it; remaining: none\nMEFI_JOB_DONE\nbye\nMEFI_JOB_DO";
  const read = readTail(body);
  assert.equal(read.sawDone, true);
  assert.equal(read.resultLine, "MEFI_RESULT: done: fixed it; remaining: none");
  assert.equal(read.lastWords, "bye");
  assert.equal(read.rest, "MEFI_JOB_DO", "a torn last line is not a line yet");
  assert.equal(readTail("quoting MEFI_JOB_DONE in prose\n").sawDone, false, "the sentinel counts only on a line of its own");
  assert.equal(readTail("MEFI_JOB_DONE").sawDone, false, "unterminated: not yet");
  assert.equal(readTail("MEFI_JOB_DONE", { torn: false }).sawDone, true, "a closed file's last line counts");
  const strict = readTail("done\nMEFI_JOB_DONE\n", { isDone: (line, mark) => line.trim() === mark, parseResult: () => null });
  assert.equal(strict.sawDone, true);
  const huge = `${"noise\n".repeat(200000)}MEFI_JOB_DONE\n`;
  assert.equal(readTail(huge).sawDone, true, "only the end of a huge journal is scanned, and the verdict is there");
});

test("the kill switch: MEFI_STUDIO_NO_RUN_ADOPT=1 or settings.executor.adoptRuns false", () => {
  assert.equal(adoptEnabled(null, {}), true);
  assert.equal(adoptEnabled({ executor: { adoptRuns: false } }, {}), false);
  assert.equal(adoptEnabled({ executor: { adoptRuns: true } }, { MEFI_STUDIO_NO_RUN_ADOPT: "1" }), false);
  assert.equal(adoptEnabled({ executor: { liveProgress: false } }, { MEFI_STUDIO_NO_RUN_ADOPT: "0" }), true);
});

test("adoptable: a live worker with a journal, a gone worker only with a verdict, nothing this engine owns", () => {
  const ctx = { ownerPid: ME, isAlive, ownedRuns: new Set() };
  const alive = adoptable(row(), ctx);
  assert.deepEqual([alive.ok, alive.reason, alive.worker, alive.journal.offset], [true, "alive", ALIVE, 120]);
  const dead = row({ runProgress: { ...row().runProgress, workerPid: DEAD } });
  assert.deepEqual(adoptable(dead, ctx), { ok: false, reason: "worker gone" });
  assert.equal(adoptable(dead, { ...ctx, verdict: (runId) => runId === "run_1700000000000_3" }).reason, "dead", "its journal already holds the verdict");
  assert.equal(adoptable(dead, { ...ctx, verdict: true }).ok, true);
  const unknown = row({ runProgress: { ...row().runProgress, workerPid: 9999 } });
  assert.equal(adoptable(unknown, ctx).reason, "unknown", "access denied is still a live worker, never a dead one");
  assert.equal(adoptable(row(), { ...ctx, ownedRuns: new Set(["run_1700000000000_3"]) }).reason, "owned");
  assert.equal(adoptable(row({ lease: { pid: ALIVE, at: 1 } }), ctx).reason, "owner alive", "another running engine's claim is its own");
  assert.equal(adoptable(row({ runProgress: { ...row().runProgress, journal: null } }), ctx).reason, "no journal");
  assert.equal(adoptable(row({ runProgress: { ...row().runProgress, runId: "run_other" } }), ctx).reason, "no checkpoint");
  assert.equal(adoptable(row({ runProgress: { ...row().runProgress, pending: true } }), ctx).reason, "already interrupted");
  assert.equal(adoptable(row({ runId: null }), ctx).reason, "no run");
  assert.equal(adoptable(row({ runProgress: { ...row().runProgress, workerPid: 0 } }), ctx).reason, "no worker pid");
});

test("an adopted row becomes a job with no child, the checkpoint's state and the journal to read on from", () => {
  const found = adoptable(row(), { ownerPid: ME, isAlive, ownedRuns: new Set() });
  const entry = adoptedEntry(row(), { now: 1700000500000, ownerPid: ME, journal: found.journal, worker: found.worker });
  assert.equal(entry.id, "run_1700000000000_3");
  assert.equal(entry.child, null);
  assert.equal(entry.pid, ALIVE);
  assert.equal(entry.ownerPid, ME);
  assert.equal(entry.adopted, true);
  assert.equal(entry.taskId, "t1");
  assert.equal(entry.kind, "task");
  assert.equal(entry.startedAt, 1700000000000);
  assert.deepEqual(entry.journal, { path: "C:/local/journal/p1/runs/run_1700000000000_3.out", offset: 120, format: "claude" });
  assert.deepEqual(entry.liveStream, { format: "claude", cli: "claude", model: "haiku", account: null, cwd: "C:/repo" });
  assert.equal(entry.cliSession.id, "0f8d6c1e-5b8a-4a51-9a33-9d0c2f3e4b5a");
  assert.deepEqual(entry.outputTail, ["$ npm test", "3 passing"]);
  assert.equal(entry.spoke, true, "a run with saved output had spoken");
  assert.equal(entry.progress, 0.5);
  assert.deepEqual(entry.todos.map((todo) => todo.status), ["completed", "in_progress"]);
  assert.equal(entry.sawDone, false, "the verdict is read from the journal, never assumed");
  assert.ok(entry.calls instanceof Set);
  const plain = adoptedEntry(row({ runProgress: { ...row().runProgress, journal: { path: "C:/j.out", offset: 0 }, outputTail: [], cliSession: undefined } }), { now: 1, ownerPid: ME, journal: { path: "C:/j.out", offset: 0, format: null }, worker: ALIVE });
  assert.equal(plain.liveStream, null, "a text-mode journal is read as text");
  assert.equal(plain.spoke, false);
});

test("alreadySettled: a settle the old engine recorded is never repeated", () => {
  const id = "run_1700000000000_3";
  assert.equal(alreadySettled(row(), id), false);
  assert.equal(alreadySettled({ ...row(), lastAttempt: { runId: id } }, id), true, "the card already carries the attempt");
  assert.equal(alreadySettled({ ...row(), lastAttempt: { runId: "run_other" } }, id), false);
  assert.equal(alreadySettled({ ...row(), acceptedAttempts: [{ n: 2, runId: id }] }, id), true, "the owner accepted it");
  assert.equal(alreadySettled({ ...row(), contextHistory: [{ id: "h1", snapshot: { lastAttempt: { runId: id } } }] }, id), true, "a history snapshot was taken after it");
  assert.equal(alreadySettled({ ...row(), contextHistory: { version: 2, entries: [{ id: "h1", runId: id }] } }, id), true, "a v2 history entry names the run");
  assert.equal(alreadySettled(null, id), false);
  assert.equal(alreadyLogged([{ event: "start", runId: id }, { event: "finish", runId: id }], id), true, "executor-log holds its finish line");
  assert.equal(alreadyLogged([{ event: "finish", runId: "run_x" }], id), false);
  assert.equal(alreadyLogged([{ event: "finish", runId: id }], null), false);
  assert.equal(alreadySettled(row(), id), false, "a logged finish alone does not mean the card was settled: finish() logs first, then writes the board");
});

test("the updater's gate: a restart goes ahead only when every running job can be adopted", () => {
  const good = { id: "a", pid: 10, journal: { path: "C:/a.out", offset: 0 }, finished: false };
  assert.equal(adoptableJob(good), true);
  assert.equal(adoptableJob({ ...good, journal: null }), false, "pipes: the next engine cannot read it");
  assert.equal(adoptableJob({ ...good, pid: null }), false);
  assert.equal(adoptableJob({ ...good, finishing: true }), false, "mid-settle is never interrupted");
  assert.equal(adoptableJob({ ...good, settlementPending: true }), false);
  assert.equal(adoptableJob({ ...good, stopping: { since: 1 } }), false);
  assert.equal(restartSafe([]), true);
  assert.equal(restartSafe([good, { ...good, id: "b" }]), true);
  assert.equal(restartSafe([good, { ...good, id: "b", journal: null }]), false);
  assert.equal(restartSafe([good], { enabled: false }), false, "the switch off keeps today's wait");
});
