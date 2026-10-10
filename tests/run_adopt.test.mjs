// Runs outlive the engine (docs/plans/scratch-tier.md WP0-B): the housekeeping
// pass of a relaunched Studio adopts a row whose worker is still alive and
// whose checkpoint names a journal (a job with no child process, read on from
// the journal's offset, ended by a pid watcher through the ordinary settle), a
// gone worker whose journal already holds the verdict is settled from it, one
// without a verdict goes through today's recovery, a settle the old engine
// recorded is never repeated, the updater's gate and the exit path keep such
// jobs alive, and the kill switch keeps today's behaviour. main.cjs is sliced
// by its marker comments into a vm with memory-only stores and a fake
// filesystem; no real process, file or timer beyond the tail's own poll.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import crypto from "node:crypto";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import * as assistant from "../scripts/assistant.mjs";
import * as history from "../scripts/task-history.mjs";
import backlog from "../scripts/backlog.cjs";
import taskHandoffs from "../scripts/task-handoffs.cjs";
import taskDelegation from "../scripts/task-delegation.cjs";
import executorResume from "../scripts/executor-resume.cjs";
import executorActivity from "../scripts/executor-activity.cjs";
import executorCore from "../scripts/executor-core.cjs";
import cliStream from "../scripts/cli-stream.cjs";
import runJournal from "../scripts/run-journal.cjs";
import runJournalHost from "../scripts/run-journal-host.cjs";
import localDirs from "../scripts/local-dirs.cjs";

const require = createRequire(import.meta.url);
const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host boundary: ${start}`);
  return source.slice(from, to);
};
const copy = (value) => structuredClone(value);
const ME = 101, OLD_ENGINE = 77, WORKER = 4100, GONE = 4200;
const RUN = "run_1700000000000_3";
const ENV = { MEFI_STUDIO_LOCAL_DIR: "C:\\fx\\local" };
const root = localDirs.localRoot({ platform: "win32", env: ENV, homedir: "C:\\fx\\home", userData: "C:\\fx\\userData" });
const JOURNAL = path.win32.join(root.runsDir("p1"), `${RUN}.out`);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, { maxMs = 4000 } = {}) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > maxMs) throw new Error("timed out waiting");
    await wait(25);
  }
}

// An in-memory filesystem with the slice of fs/promises the journal host uses.
function fakeFs() {
  const files = new Map();
  const key = (file) => String(file).replace(/\\/g, "/").toLowerCase();
  let fds = 20;
  const open = async (file, flag) => {
    const at = key(file);
    if (flag === "a" && !files.has(at)) files.set(at, Buffer.alloc(0));
    if (!files.has(at)) throw Object.assign(new Error(`ENOENT ${file}`), { code: "ENOENT" });
    const fd = fds++;
    return {
      fd,
      stat: async () => ({ size: files.get(at).length }),
      read: async (buffer, offset, length, position) => { const body = files.get(at); const got = body.subarray(position, position + length); got.copy(buffer, offset); return { bytesRead: got.length }; },
      close: async () => {},
    };
  };
  return {
    files, key,
    append: (file, text) => { const at = key(file); files.set(at, Buffer.concat([files.get(at) ?? Buffer.alloc(0), Buffer.from(text, "utf8")])); },
    text: (file) => files.get(key(file))?.toString("utf8") ?? null,
    api: {
      open, mkdir: async () => {},
      readFile: async (file) => { const body = files.get(key(file)); if (!body) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); return body.toString("utf8"); },
      writeFile: async (file, text) => { files.set(key(file), Buffer.from(String(text), "utf8")); },
      rename: async (from, to) => { files.set(key(to), files.get(key(from))); files.delete(key(from)); },
      rm: async (file) => { files.delete(key(file)); },
    },
  };
}

const row = (over = {}) => ({
  id: "t1", title: "Fix the thing", prompt: "Fix it.", status: "active", createdAt: 1, runId: RUN, lease: { pid: OLD_ENGINE, at: 5 }, runningAt: 1700000000000,
  runProgress: { version: 1, runId: RUN, pid: OLD_ENGINE, workerPid: WORKER, startedAt: 1700000000000, scope: null, pending: false, sessionId: null, progress: 0.5,
    todos: [{ content: "Read", status: "completed" }, { content: "Fix", status: "in_progress" }], outputTail: ["$ npm test"], result: null,
    journal: { path: JOURNAL, offset: 0, format: null } },
  ...over,
});

function adoptHost({ tasks = [], env = {}, alive = [WORKER], executorLog = "" } = {}) {
  const fs = fakeFs();
  if (executorLog) fs.append("C:\\fx\\data\\executor-log.jsonl", executorLog);
  let board = { tasks: copy(tasks), requests: [] };
  const live = new Set(alive);
  const notes = [], records = [], terminations = [], intervals = [], checkpoints = [];
  let settings = { executor: {} };
  const eyes = { readJson: async (key) => copy(board[key] ?? []), listChanges: () => [], listTodos: () => [] };
  const host = runJournalHost.createRunJournalHost({ fs: fs.api, watch: null });
  const vmEnv = vm.createContext({
    Date, crypto, path, console, backlog, taskHandoffs, taskDelegation, executorResume, executorActivity, executorCore, cliStream,
    process: { pid: ME, platform: "win32", env: { ...ENV, ...env }, kill: (pid) => { if (pid === ME || live.has(pid)) return true; throw Object.assign(new Error("gone"), { code: "ESRCH" }); } },
    app: { getPath: () => "C:\\fx\\userData" }, os: { homedir: () => "C:\\fx\\home" }, SMOKE: false, CAPTURE: false,
    optionalHelper: (_name, load) => load(),
    require: (name) => {
      if (name === "./scripts/run-journal.cjs") return runJournal;
      if (name === "./scripts/run-journal-host.cjs") return { createRunJournalHost: () => host };
      if (name === "./scripts/local-dirs.cjs") return localDirs;
      if (name === "node:fs") return { watch: () => ({ close() {}, on() {} }) };
      return require(`../${name.replace(/^\.\//, "")}`);
    },
    executorProcessAlive: (pid) => (pid === ME || live.has(pid) ? true : false),
    autopilot: { jobs: [], history: [] }, assistantState: { prefs: {} }, assistantModule: assistant,
    TASKS_PATH: "tasks", REQUESTS_PATH: "requests", EXECUTOR_LOG_PATH: "executor-log.jsonl", projectDataPath: (name) => `C:\\fx\\data\\${name}`,
    EXECUTOR_DONE_MARK: "MEFI_JOB_DONE", EXECUTOR_MAX_DEPTH: 3, EXECUTOR_MAX_HANDOFFS: 3, EXECUTOR_START_FAILURE_GRACE: 5, EXECUTOR_KILL_MS: 25 * 60 * 1000, EXECUTOR_PARALLEL_CAP: 3,
    VERIFY_DWELL_MS: 30000,
    projects: { current: () => ({ id: "p1", path: "C:\\fx\\repo" }), active: () => ({ id: "p1", path: "C:\\fx\\repo" }), find: () => null, run: (_project, fn) => fn() },
    getAssistant: async () => assistant, loadModule: async () => history, getEyes: async () => eyes,
    getReceiptsModule: async () => null, policyRecord() {}, refreshAutopilotQueue: async () => {},
    readSettings: async () => copy(settings),
    assistantClip: (value, limit) => String(value ?? "").slice(0, limit), logLine: (text) => notes.push(text),
    executorLog: async (record) => { records.push(record); fs.append("C:\\fx\\data\\executor-log.jsonl", `${JSON.stringify(record)}\n`); },
    pushAutopilotHistory: (kind, text) => vmEnv.autopilot.history.push({ kind, text }),
    emitAutopilot() {}, assistantAskForWork() {}, runVerificationJobs: async () => {}, kickVerificationSettlement() {}, verificationJobs: [],
    queueExecutorCheckpoint: (entry) => { checkpoints.push(executorResume.checkpoint(entry)); return Promise.resolve(); },
    spawn: (command, args) => { terminations.push({ command, args }); return { on() { return this; } }; },
    setInterval: (fn) => { const timer = { fn, unref() {} }; intervals.push(timer); return timer; }, clearInterval: (timer) => { if (timer) timer.cleared = true; },
    setTimeout, clearTimeout,
    mutateBoard: async (mutate) => {
      const next = copy(board);
      const patch = mutate(next) ?? {};
      for (const key of ["tasks", "requests"]) if (patch[key]) next[key] = patch[key];
      board = next;
      return { ...patch, written: ["tasks"] };
    },
  });
  vm.runInContext(section("// ---- live progress: Claude Code and Codex runs as event streams", "// ---- end of live progress"), vmEnv);
  vm.runInContext(section("// ---- Run journal ----", "// ---- end of the run journal ----"), vmEnv);
  vm.runInContext(section("const VERIFY_DWELL_MS =", "// One autopilot tick:"), vmEnv);
  const tick = () => { for (const timer of intervals) if (!timer.cleared) timer.fn(); };
  return { env: vmEnv, fs, board: () => copy(board), notes, records, terminations, checkpoints, live, tick, settings: (next) => { settings = next; } };
}

test("a row whose worker outlived the old Studio is adopted as a job, read on from its journal, and settled when the worker ends", async () => {
  const h = adoptHost({ tasks: [row()] });
  h.fs.append(JOURNAL, "first line\n");
  await h.env.autopilotHousekeeping();
  assert.equal(h.env.autopilot.jobs.length, 1, "adopted");
  const entry = h.env.autopilot.jobs[0];
  assert.deepEqual([entry.id, entry.child, entry.pid, entry.adopted, entry.ownerPid], [RUN, null, WORKER, true, ME]);
  const after = h.board().tasks[0];
  assert.deepEqual(after.lease, { pid: ME, at: after.lease.at }, "the claim is this Studio's now");
  assert.equal(after.runId, RUN, "and the run is still its own");
  assert.equal(after.status, "active");
  assert.ok(h.records.some((record) => record.event === "adopt" && record.runId === RUN && record.alive === true));
  assert.ok(h.notes.some((line) => /adopted "Fix the thing" from an earlier Studio: pid 4100 still running/.test(line)));
  assert.ok(h.checkpoints.some((saved) => saved.runId === RUN && saved.journal?.path === JOURNAL), "its checkpoint is written at once");
  await until(() => entry.spoke);
  assert.deepEqual(entry.outputTail.at(-1), "first line", "what was written before the relaunch is read first");
  h.fs.append(JOURNAL, "MEFI_RESULT: done: fixed it; remaining: none\nMEFI_JOB_DONE\n");
  await until(() => entry.sawDone);
  assert.equal(entry.resultNote?.raw?.includes("done: fixed it"), true);
  assert.ok(entry.journal.offset > 0, "the offset moves with what was read");
  await h.env.autopilotHousekeeping();
  assert.equal(h.env.autopilot.jobs.length, 1, "a later pass adopts nothing twice");
  // The worker ends: the watcher settles it through the ordinary path.
  h.live.delete(WORKER);
  h.tick();
  await until(() => h.env.autopilot.jobs.length === 0);
  const settled = h.board().tasks[0];
  assert.equal(settled.status, "awaiting_verification");
  assert.equal(settled.lastAttempt.runId, RUN);
  assert.equal(settled.lastAttempt.sawDone, true);
  assert.ok(settled.logs.some((line) => /run finished \(sentinel seen\)/.test(line.text)));
  const finish = h.records.find((record) => record.event === "finish");
  assert.equal(finish.runId, RUN);
  assert.equal(finish.ok, true);
  assert.equal(finish.result, "done: fixed it; remaining: none");
});

test("a gone worker whose journal holds the verdict is settled from it; one without a verdict goes through today's recovery", async () => {
  const done = adoptHost({ tasks: [row({ runProgress: { ...row().runProgress, workerPid: GONE } })], alive: [] });
  done.fs.append(JOURNAL, "working\nMEFI_RESULT: done: all of it; remaining: none\nMEFI_JOB_DONE\n");
  await done.env.autopilotHousekeeping();
  await until(() => done.board().tasks[0].status === "awaiting_verification");
  const settled = done.board().tasks[0];
  assert.equal(settled.lastAttempt.runId, RUN);
  assert.equal(done.env.autopilot.jobs.length, 0);
  assert.ok(done.records.some((record) => record.event === "adopt" && record.alive === false));
  assert.ok(done.notes.some((line) => /its CLI had already finished/.test(line)));
  const open = adoptHost({ tasks: [row({ runProgress: { ...row().runProgress, workerPid: GONE } })], alive: [] });
  open.fs.append(JOURNAL, "working\nstill working\n");
  await open.env.autopilotHousekeeping();
  const recovered = open.board().tasks[0];
  assert.equal(open.env.autopilot.jobs.length, 0, "nothing to adopt");
  assert.equal(recovered.status, "open");
  assert.equal(recovered.runId, undefined);
  assert.equal(recovered.runProgress.pending, true, "the next attempt continues from the checkpoint (and WP0-C resumes its session)");
  assert.equal(recovered.runProgress.journal.path, JOURNAL, "the checkpoint keeps the journal it had");
});

test("the kill switch keeps today's behaviour: a leased live worker is left alone, nothing is adopted", async () => {
  const h = adoptHost({ tasks: [row()], env: { MEFI_STUDIO_NO_RUN_ADOPT: "1" } });
  await h.env.autopilotHousekeeping();
  assert.equal(h.env.autopilot.jobs.length, 0);
  const after = h.board().tasks[0];
  assert.deepEqual([after.runId, after.lease.pid, after.status], [RUN, OLD_ENGINE, "active"]);
  assert.equal(h.env.runJournalAdoptableAll(), true, "with nothing running a restart goes ahead as today");
  h.env.autopilot.jobs.push({ id: "x", pid: 5, journal: { path: "C:\\x.out", offset: 0 }, finished: false });
  assert.equal(h.env.runJournalAdoptableAll(), false, "the switch off: the updater waits for builds as today");
  assert.equal(h.env.runJournalKeeps(h.env.autopilot.jobs[0]), false, "and the exit path ends them as today");
});

test("a settle the old Studio recorded is not repeated, and a finish line already logged is not logged twice", async () => {
  // The old engine logged its finish line but died before the board write: settled once here, logged once in all.
  const logged = adoptHost({ tasks: [row()], executorLog: `${JSON.stringify({ event: "finish", runId: RUN, ok: true })}\n` });
  logged.fs.append(JOURNAL, "MEFI_JOB_DONE\n");
  await logged.env.autopilotHousekeeping();
  await until(() => logged.env.autopilot.jobs[0]?.sawDone);
  logged.live.delete(WORKER);
  logged.tick();
  await until(() => logged.env.autopilot.jobs.length === 0);
  assert.equal(logged.board().tasks[0].status, "awaiting_verification", "the card is settled");
  assert.equal(logged.records.filter((record) => record.event === "finish").length, 0, "the finish line was already in executor-log");
  // The old engine settled the card after all (the owner accepted the attempt meanwhile): nothing is written again.
  const settled = adoptHost({ tasks: [row()] });
  settled.fs.append(JOURNAL, "MEFI_JOB_DONE\n");
  await settled.env.autopilotHousekeeping();
  await until(() => settled.env.autopilot.jobs[0]?.sawDone);
  const before = settled.board().tasks[0];
  settled.env.mutateBoard = async (mutate) => {
    const next = { tasks: [{ ...before, acceptedAttempts: [{ n: 1, runId: RUN }] }], requests: [] };
    const patch = mutate(next) ?? {};
    return { ...patch, written: [] };
  };
  settled.live.delete(WORKER);
  settled.tick();
  await until(() => settled.env.autopilot.jobs.length === 0);
  assert.equal(settled.records.filter((record) => record.event === "finish").length, 0);
  assert.ok(settled.notes.some((line) => /settled by the earlier Studio already; not recorded twice/.test(line)));
});

test("the updater's gate and the exit path: a journaled job is adoptable, a stop or a settle in flight is not", async () => {
  const h = adoptHost({ tasks: [row()] });
  await h.env.autopilotHousekeeping();
  const entry = h.env.autopilot.jobs[0];
  assert.equal(h.env.runJournalAdoptableAll(), true, "a restart may go ahead: the next Studio adopts it");
  assert.equal(h.env.runJournalKeeps(entry), true, "and the exit path leaves its worker running");
  await h.env.runJournalPrepareRestart();
  assert.ok(h.checkpoints.length >= 2, "the offsets are saved before the restart");
  entry.stop("stop all", false, "stopped");
  assert.deepEqual([...h.terminations.at(-1).args], ["/pid", String(WORKER), "/t", "/f"], "an adopted job is stopped by its process tree");
  assert.equal(h.env.runJournalAdoptableAll(), false, "a job being stopped is never left to the next Studio");
  assert.equal(h.env.runJournalKeeps(entry), false);
  entry.stopUser = true;
  h.live.delete(WORKER);
  h.tick();
  await until(() => h.env.autopilot.jobs.length === 0);
  const after = h.board().tasks[0];
  assert.equal(after.status, "open", "stopped on request: back to the queue");
  assert.equal(after.runProgress.pending, true, "with its progress saved");
  assert.equal(after.runFailures, undefined, "and nothing charged");
});

test("a live-progress journal is decoded as the attempt was: the sentinel inside a stream-json event still counts", async () => {
  const id = "0f8d6c1e-5b8a-4a51-9a33-9d0c2f3e4b5a";
  const h = adoptHost({ tasks: [row({ runProgress: { ...row().runProgress, journal: { path: JOURNAL, offset: 0, format: "claude" }, cliSession: { cli: "claude", id, model: "haiku", account: null, cwd: "C:\\fx\\repo" } } })] });
  const jsonl = (...events) => events.map((event) => JSON.stringify(event)).join("\n") + "\n";
  h.fs.append(JOURNAL, jsonl({ type: "system", subtype: "init", session_id: id, model: "claude-haiku-4-5" }));
  await h.env.autopilotHousekeeping();
  const entry = h.env.autopilot.jobs[0];
  assert.equal(entry.liveStream.format, "claude");
  await until(() => entry.spoke);
  assert.equal(entry.cliSession.id, id, "the same session the checkpoint kept: the stream's init changes nothing");
  h.fs.append(JOURNAL, jsonl(
    { type: "assistant", message: { id: "m1", content: [{ type: "tool_use", id: "todo", name: "TodoWrite", input: { todos: [{ content: "Fix", status: "completed" }] } }] } },
    { type: "assistant", message: { id: "m2", content: [{ type: "text", text: "Done.\nMEFI_RESULT: done: fixed; remaining: none\nMEFI_JOB_DONE" }] } },
  ));
  await until(() => entry.sawDone);
  assert.equal(entry.progress, 1);
  h.live.delete(WORKER);
  h.tick();
  await until(() => h.env.autopilot.jobs.length === 0);
  assert.equal(h.board().tasks[0].status, "awaiting_verification");
  assert.equal(h.board().tasks[0].lastAttempt.cliSession.id, id);
});
