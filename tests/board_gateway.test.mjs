// The board gateway's file path (mutateBoard in main.cjs) on the real reader
// (scripts/eyes.mjs) and project facade: unchanged rows are neither
// rewritten, broadcast nor re-hashed; a changed row is written, broadcast
// and given a revision; and a file rewritten underneath the process is read
// fresh and its drift recorded, because the reader validates bytes, never
// timestamps. Disposable temp folders only; no store, no live board.
//
// Run: node --test tests/

import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import * as eyes from "../scripts/eyes.mjs";
import { migrateLegacyRequests } from "../scripts/task-history.mjs";

const require = createRequire(import.meta.url);
const backlog = require("../scripts/backlog.cjs");
const taskContext = require("../scripts/task-context.cjs");
const { createProjects } = require("../scripts/projects.cjs");

const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
};
const gateway = section("const isThenable = (value) =>", "// Drop a claim this run still owns.");

async function harness() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mefi-gateway-"));
  const projects = createProjects({ defaultRoot: dir, studioRoot: dir, isDirectory: () => true });
  const scoped = projects.eyes(eyes);
  const sent = [];
  let revisions = 0;
  const context = vm.createContext({
    console, structuredClone, Buffer,
    getEyes: async () => scoped,
    withBoardLock: (fn) => fn(),
    send: (channel, payload) => sent.push({ channel, payload }),
    taskView: (task) => task,
    backlog,
    taskContext: { ...taskContext, recordTaskRevision: (...args) => { revisions += 1; return taskContext.recordTaskRevision(...args); } },
    REQUESTS_PATH: path.join(dir, "eyes-requests.json"),
    TASKS_PATH: path.join(dir, "eyes-tasks.json"),
    IDEAS_PATH: path.join(dir, "eyes-feature-ideas.json"),
  });
  vm.runInContext(gateway, context);
  // Rows carry the facade's project stamp from the start: a row created
  // without it is stamped on write and, as before this change, gains a
  // catch-up revision on the next pass because projectId is snapshot state.
  const project = projects.current();
  return {
    context, sent, scoped,
    task: (row) => ({ ...row, projectId: project.id, projectPath: project.path }),
    tasksFile: path.join(dir, "eyes-tasks.json"),
    revisions: () => revisions,
    reset: () => { revisions = 0; sent.length = 0; },
    close: () => rm(dir, { recursive: true, force: true }),
  };
}

const rowsOnDisk = async (h) => JSON.parse(await readFile(h.tasksFile, "utf8"));
// Arrays born inside the vm realm fail strict deep equality against host
// arrays; copy the written keys out before comparing.
const written = (result) => [...(result.written ?? [])];

test("untouched rows are not rewritten, broadcast or re-hashed; a changed row is", async () => {
  const h = await harness();
  try {
    const { mutateBoard } = h.context;
    const seed = await mutateBoard((board) => {
      board.tasks.push(h.task({ id: "t1", title: "One", status: "open", logs: [] }), h.task({ id: "t2", title: "Two", status: "open" }), h.task({ id: "t3", title: "Three", status: "done" }));
      return {};
    });
    assert.deepEqual(written(seed), ["tasks"]);
    assert.equal(h.revisions(), 3, "new rows are hashed once");
    assert.equal(h.sent.length, 1);
    assert.equal(h.sent[0].channel, "eyes:tasks");
    const before = await readFile(h.tasksFile, "utf8");

    h.reset();
    const same = await mutateBoard((board) => {
      board.tasks.find((task) => task.id === "t2").title = "Two"; // written back unchanged
      return {};
    });
    assert.deepEqual(written(same), [], "identical content is not a change");
    assert.equal(h.sent.length, 0);
    assert.equal(h.revisions(), 0, "rows the mutation left alone skip the snapshot hash");
    assert.equal(await readFile(h.tasksFile, "utf8"), before);

    h.reset();
    const edit = await mutateBoard((board) => {
      board.tasks.find((task) => task.id === "t1").title = "One, renamed";
      return { revisionKind: "renamed", revisionNote: "Task title updated" };
    });
    assert.deepEqual(written(edit), ["tasks"]);
    assert.equal(h.revisions(), 1, "only the edited row is hashed");
    assert.equal(h.sent.length, 1);
    assert.equal(h.sent[0].payload.find((task) => task.id === "t1").title, "One, renamed");
    const saved = await rowsOnDisk(h);
    assert.equal(saved.find((task) => task.id === "t1").contextHistory.entries.length, 2);
    assert.equal(saved.find((task) => task.id === "t1").contextHistory.entries.at(-1).kind, "renamed");
    assert.equal(saved.find((task) => task.id === "t2").contextHistory.entries.length, 1);
    assert.equal(saved.find((task) => task.id === "t3").contextHistory.entries.length, 1);

    // The saved history object rides every read while the file is unchanged;
    // row bodies are fresh copies each time.
    const readA = await h.scoped.readJson(h.context.TASKS_PATH, []);
    const readB = await h.scoped.readJson(h.context.TASKS_PATH, []);
    assert.equal(readA[1].contextHistory, readB[1].contextHistory);
    assert.notEqual(readA[1], readB[1]);
    assert.equal(edit.tasks.find((task) => task.id === "t2").contextHistory, readA[1].contextHistory, "and it is the object the gateway handed back");
  } finally {
    await h.close();
  }
});

test("a file rewritten underneath the process is read fresh and its drift is recorded, as before", async () => {
  const h = await harness();
  try {
    const { mutateBoard } = h.context;
    await mutateBoard((board) => {
      board.tasks.push(h.task({ id: "t1", title: "One", status: "open" }), h.task({ id: "t2", title: "Two", status: "open" }));
      return {};
    });
    const rows = await rowsOnDisk(h);
    rows.find((task) => task.id === "t2").title = "Two, edited by another process";
    await writeFile(h.tasksFile, JSON.stringify(rows, null, 2));

    h.reset();
    const pass = await mutateBoard(() => ({}));
    assert.equal(h.revisions(), 2, "rows from a fresh parse are hashed again");
    assert.deepEqual(written(pass), ["tasks"], "the drifted row gains a catch-up revision");
    const saved = await rowsOnDisk(h);
    assert.equal(saved.find((task) => task.id === "t2").title, "Two, edited by another process");
    assert.equal(saved.find((task) => task.id === "t2").contextHistory.entries.length, 2);
    assert.equal(saved.find((task) => task.id === "t1").contextHistory.entries.length, 1);

    h.reset();
    assert.deepEqual(written(await mutateBoard(() => ({}))), []);
    assert.equal(h.revisions(), 0);
  } finally {
    await h.close();
  }
});

test("a refusing mutator carries its verdict through untouched and an async mutator is rejected", async () => {
  const h = await harness();
  try {
    const { mutateBoard } = h.context;
    await mutateBoard((board) => { board.tasks.push(h.task({ id: "t1", title: "One", status: "open" })); return {}; });
    h.reset();
    const refused = await mutateBoard((board) => (board.tasks[0].status === "open" ? { ok: false, error: "no" } : {}));
    assert.equal(refused.ok, false);
    assert.equal(refused.error, "no");
    assert.deepEqual(written(refused), []);
    assert.equal(h.sent.length, 0);
    assert.equal(h.revisions(), 0);
    assert.equal((await rowsOnDisk(h))[0].title, "One");
    await assert.rejects(mutateBoard(async () => ({})), { name: "TypeError" });
  } finally {
    await h.close();
  }
});

test("sameRows answers as JSON.stringify equality did, without serializing shared history", async () => {
  const h = await harness();
  try {
    const { sameRows } = h.context;
    const history = { version: 1, entries: [{ id: "revision_1_a", revision: 1, hash: "a", snapshot: { id: "a" } }] };
    assert.equal(sameRows([{ id: "a", contextHistory: history }], [{ id: "a", contextHistory: history }]), true);
    assert.equal(sameRows([{ id: "a", contextHistory: history }], [{ id: "a", contextHistory: structuredClone(history) }]), true, "equal history text");
    assert.equal(sameRows([{ id: "a", contextHistory: history }], [{ id: "a", contextHistory: { ...history, entries: [] } }]), false);
    assert.equal(sameRows([{ id: "a", title: "x", contextHistory: history }], [{ id: "a", title: "y", contextHistory: history }]), false);
    assert.equal(sameRows([{ id: "a", logs: [{ at: 1 }] }], [{ id: "a", logs: [{ at: 1 }] }]), true);
    assert.equal(sameRows([{ id: "a", logs: [{ at: 1 }] }], [{ id: "a", logs: [{ at: 2 }] }]), false);
    assert.equal(sameRows([1, "two", null], [1, "two", null]), true);
    assert.equal(sameRows([{ id: "a" }], [{ id: "a" }, null]), false);
    assert.equal(sameRows([undefined], [null]), true, "an array slot serializes undefined as null");
    assert.equal(sameRows([{ id: "a" }], null), false);
    assert.equal(sameRows([], []), true);
  } finally {
    await h.close();
  }
});

// The legacy migration moves an older build's "verifying" inbox row onto the
// board (autopilotHousekeepingPass, scripts/task-history.mjs). The file store
// writes the inbox before the tasks, so a one-step move lost the finished
// attempt when the tasks write failed after the inbox write had landed.
test("a failed tasks write while a verifying row moves to the board loses nothing", async () => {
  const h = await harness();
  try {
    const { mutateBoard, TASKS_PATH } = h.context;
    const row = { title: "Finished before the upgrade", prompt: "Keep the picker visible", at: 5, source: "manual", status: "verifying",
      lastAttempt: { runId: "run-v", sessionId: "session-v", startedAt: 1, at: 2, code: 0 } };
    await mutateBoard((board) => { board.requests.push(row); return {}; });
    // The same step the housekeeping mutation takes.
    const migrate = (board) => {
      const legacy = migrateLegacyRequests(board.requests, { tasks: board.tasks, now: 1000 });
      if (legacy.changed) { board.requests = legacy.requests; board.tasks = [...legacy.tasks, ...board.tasks]; }
      return {};
    };
    const write = h.scoped.writeJson;
    let fail = true;
    h.scoped.writeJson = async (file, value) => {
      if (fail && file === TASKS_PATH) { fail = false; throw Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" }); }
      return write(file, value);
    };
    await assert.rejects(mutateBoard(migrate), /ENOSPC/);
    const inbox = async () => JSON.parse(await readFile(path.join(path.dirname(TASKS_PATH), "eyes-requests.json"), "utf8"));
    assert.deepEqual((await inbox()).map((saved) => saved.status), ["verifying"], "the row is still in the inbox");
    await mutateBoard(migrate);
    assert.deepEqual((await rowsOnDisk(h)).map((task) => task.status), ["awaiting_verification"], "the retry saves the task");
    assert.equal((await inbox()).length, 1, "and keeps the row until a pass sees that task");
    await mutateBoard(migrate);
    assert.deepEqual(await inbox(), [], "then the row goes");
    assert.equal((await rowsOnDisk(h)).length, 1, "with one task, not two");
  } finally {
    await h.close();
  }
});
