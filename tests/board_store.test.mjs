// Behavioral tests for the SQLite board store: round-trip fidelity (the DB is
// authoritative but every consumer still speaks JSON arrays), first-run
// migration from the JSON views, transactional read-modify-write (in-place
// row edits persist; a throwing mutator rolls back), and view sync with
// DB-wins semantics.
//
// Run: node --test tests/

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { defaultBoardConfig, enableBoardStore, boardMutate, boardEnabled, closeBoardStore, readJson, writeJson, repairBoardView } from "../scripts/eyes.mjs";
import { fileURLToPath } from "node:url";

// Each test gets its own data dir + database: the store keeps one connection
// per dbPath in the process, and re-enabling with a new config switches it.
const dirs = [];
function freshBoard({ seedViews = null } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "mefi-board-"));
  dirs.push(dir);
  const dataDir = path.join(dir, "data");
  mkdirSync(dataDir, { recursive: true });
  if (seedViews) {
    for (const [name, rows] of Object.entries(seedViews)) {
      writeFileSync(path.join(dataDir, name), JSON.stringify(rows, null, 2));
    }
  }
  const config = defaultBoardConfig(dir);
  enableBoardStore({ dbPath: path.join(dir, "board", "board.db"), files: config.files });
  return {
    dir,
    files: config.files,
    read: (name) => JSON.parse(readFileSync(path.join(dataDir, name), "utf8")),
  };
}

test.after(async () => {
  closeBoardStore();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
});

test("round trip: arbitrary row fields survive the database verbatim", async () => {
  const board = freshBoard();
  const tasks = [
    {
      id: "task_1",
      title: "Polish the dream mode",
      prompt: "frame the idle camera",
      status: "awaiting_verification",
      color: "#e6c98d",
      source: "chat",
      createdAt: 1726900000000,
      updatedAt: 1726900001000,
      logs: [{ at: 1, kind: "status", text: "run finished (sentinel seen) — awaiting verification" }],
      ideas: [],
      refs: [{ kind: "file", title: "renderer/idle.js" }],
      lastAttempt: { runId: "run_1", code: 0, sawDone: true, sessionId: "ses_x", at: 2, result: { raw: "done: framing", parts: { done: "framing" } } },
      remaining: ["one more thing"],
      pin: true,
      pinAt: 3,
    },
    { id: "task_2", title: "另一个任务 — unicode ✓", status: "open", weird: { nested: [1, 2, { deep: null }] } },
  ];
  await writeJson(board.files.tasks, tasks);
  const rows = await readJson(board.files.tasks, []);
  assert.deepEqual(rows, tasks);
  assert.equal(rows[0].id, "task_1");
  // the exported view file agrees with the database
  assert.deepEqual(board.read("eyes-tasks.json"), tasks);
});

test("first-run migration imports non-empty views once, then the database wins", async () => {
  const board = freshBoard({
    seedViews: {
      "eyes-tasks.json": [{ id: "task_legacy", title: "Imported from the view", status: "open" }],
      "eyes-feature-ideas.json": [{ id: "idea_1", title: "Legacy idea", status: "new", taskId: "task_legacy" }],
    },
  });
  const tasks = await readJson(board.files.tasks, []);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].title, "Imported from the view");
  // the database is the authority now: a hand-edited view is a stale export
  const stale = board.read("eyes-tasks.json");
  stale[0].title = "hand edit";
  writeFileSync(board.files.tasks, JSON.stringify(stale, null, 2));
  const reread = await readJson(board.files.tasks, []);
  assert.equal(reread[0].title, "Imported from the view");
});

test("stale fork: a migrated database missing view rows degrades loudly to file mode", async () => {
  const board = freshBoard({
    seedViews: { "eyes-tasks.json": [{ id: "task_old", title: "Pre-fork row", status: "open" }] },
  });
  await readJson(board.files.tasks, []); // migrate; the database wins from here
  assert.equal(boardEnabled(), true);

  // the host later runs plain-file (store never enabled) and the view moves on
  const forked = [
    ...board.read("eyes-tasks.json"),
    { id: "task_new", title: "Only the view knows me", status: "open" },
  ];
  writeFileSync(board.files.tasks, JSON.stringify(forked, null, 2));
  closeBoardStore(); // reopen on the next read → the fork guard fires

  const rows = await readJson(board.files.tasks, []);
  assert.equal(boardEnabled(), false); // degraded: the files are the authority again
  assert.equal(rows.length, 2); // the FILE is served, not the stale database
  assert.equal(rows[1].id, "task_new");
});

test("boardMutate: in-place row edits persist; a no-op writes nothing", async () => {
  const board = freshBoard({
    seedViews: { "eyes-tasks.json": [{ id: "task_1", title: "A", status: "open", logs: [] }] },
  });
  await readJson(board.files.tasks, []); // trigger migration

  // in-place mutation of a row object (the pin/refs pattern) must persist
  const out = await boardMutate((working) => {
    const task = working.tasks.find((row) => row.id === "task_1");
    task.pin = true;
    task.logs = [...task.logs, { at: 9, kind: "status", text: "pinned" }];
    return { tasks: working.tasks, extra: "kept" };
  });
  assert.deepEqual(out.written, ["tasks"]);
  assert.equal(out.extra, "kept");
  const pinned = await readJson(board.files.tasks, []);
  assert.equal(pinned[0].pin, true);
  assert.equal(pinned[0].logs.length, 1);

  // a mutator that changes nothing writes nothing
  const noop = await boardMutate((working) => ({ tasks: working.tasks }));
  assert.deepEqual(noop.written, []);

  // a new row prepended via a fresh array lands, order preserved
  await boardMutate((working) => {
    working.tasks = [{ id: "task_0", title: "Newest", status: "open" }, ...working.tasks];
    return { tasks: working.tasks };
  });
  const rows = await readJson(board.files.tasks, []);
  assert.deepEqual(rows.map((row) => row.id), ["task_0", "task_1"]);
});

test("boardMutate: a throwing mutator rolls the whole transaction back", async () => {
  const board = freshBoard({
    seedViews: {
      "eyes-tasks.json": [{ id: "task_1", title: "A", status: "open" }],
      "eyes-feature-ideas.json": [{ id: "idea_1", title: "i", status: "planned", taskId: "task_1" }],
    },
  });
  await readJson(board.files.tasks, []);
  await assert.rejects(() =>
    boardMutate((working) => {
      working.tasks = []; // would be a disaster if it half-landed
      working.ideas = [];
      throw new Error("crash mid-pass");
    })
  );
  assert.equal((await readJson(board.files.tasks, [])).length, 1, "tasks untouched");
  assert.equal((await readJson(board.files.ideas, [])).length, 1, "ideas untouched");
  // the store still works after the rollback
  await boardMutate((working) => {
    working.tasks[0].status = "active";
    return { tasks: working.tasks };
  });
  const after = await readJson(board.files.tasks, []);
  assert.equal(after[0].status, "active");
});

test("dangling-link repair reads the same way the app's compactor asks", async () => {
  const board = freshBoard({
    seedViews: {
      "eyes-tasks.json": [{ id: "task_live", title: "Live", status: "open" }],
      "eyes-feature-ideas.json": [
        { id: "idea_1", title: "Stranded", status: "planned", taskId: "task_deleted", read: true },
        { id: "idea_2", title: "Linked", status: "planned", taskId: "task_live", read: true },
      ],
    },
  });
  await readJson(board.files.tasks, []);
  const result = await boardMutate((working) => {
    const live = new Set(working.tasks.map((task) => task.id));
    const relink = new Map();
    for (const idea of working.ideas) {
      if (idea.taskId && !live.has(idea.taskId)) relink.set(idea.id, idea.taskId);
    }
    if (!relink.size) return {};
    working.ideas = working.ideas.map((idea) => {
      if (!relink.has(idea.id)) return idea;
      const { taskId, ...rest } = idea;
      return { ...rest, status: "new", read: false, reopenOf: taskId, foldAttempts: 1 };
    });
    return { ideas: working.ideas, relinked: relink.size };
  });
  assert.equal(result.relinked, 1);
  const ideas = await readJson(board.files.ideas, []);
  assert.equal(ideas[0].status, "new");
  assert.equal(ideas[0].reopenOf, "task_deleted");
  assert.equal(ideas[1].taskId, "task_live");
});

// ---- the review's persistence regressions ---------------------------------------

test("boardMutate: an async mutator is rejected and rolls the whole transaction back", async () => {
  const board = freshBoard({
    seedViews: {
      "eyes-tasks.json": [{ id: "task_1", title: "A", status: "open", logs: [] }],
      "eyes-feature-ideas.json": [{ id: "idea_1", title: "i", status: "planned", taskId: "task_1" }],
    },
  });
  await readJson(board.files.tasks, []);
  // The async mutator's replacement array and in-place edit are partial
  // application waiting to happen: the store refuses the mutator outright and
  // nothing it did survives.
  await assert.rejects(
    () =>
      boardMutate(async (working) => {
        working.tasks[0].status = "active";
        working.tasks = [];
        working.ideas = [];
        return { tasks: [], ideas: [] };
      }),
    /synchronous/,
  );
  // Give the stray promise's tagged catch a tick so it cannot surface as an
  // unhandled rejection after the test ends.
  await new Promise((resolve) => setImmediate(resolve));
  const tasks = await readJson(board.files.tasks, []);
  assert.equal(tasks.length, 1, "the in-place edit did not survive");
  assert.equal(tasks[0].status, "open");
  assert.equal((await readJson(board.files.ideas, [])).length, 1, "ideas untouched");
});

test("repairBoardView: a torn export is quarantined and regenerated from the database", async () => {
  const board = freshBoard({
    seedViews: {
      "eyes-tasks.json": [
        { id: "task_1", title: "Valid work one", status: "open" },
        { id: "task_2", title: "Valid work two", status: "open" },
      ],
    },
  });
  await readJson(board.files.tasks, []); // migrate into the store
  // Damage ONLY the export, the way a crash mid-write would.
  writeFileSync(board.files.tasks, '{"id": "task_1", "title": "Valid work on');
  const repaired = await repairBoardView(board.files.tasks);
  assert.equal(repaired.handled, true, "a store-backed view is repaired by the store");
  assert.equal(repaired.kind, "tasks");
  assert.equal(repaired.count, 2, "every database row survived the repair");
  assert.ok(existsSync(repaired.quarantine), "the torn export is kept aside for forensics");
  assert.deepEqual(board.read("eyes-tasks.json"), [
    { id: "task_1", title: "Valid work one", status: "open" },
    { id: "task_2", title: "Valid work two", status: "open" },
  ], "the view is regenerated from the authority");
  assert.deepEqual(await readJson(board.files.tasks, []), [
    { id: "task_1", title: "Valid work one", status: "open" },
    { id: "task_2", title: "Valid work two", status: "open" },
  ]);
});

test("repairBoardView: a plain data file is not the store's to repair", async () => {
  const board = freshBoard();
  const plain = board.files.requests.replace("eyes-requests.json", "assistant-history.json");
  writeFileSync(plain, "not json");
  const repaired = await repairBoardView(plain);
  assert.deepEqual(repaired, { handled: false });
});

test("task-id uniqueness is enforced by the store, not by caller discipline", async () => {
  const board = freshBoard({
    seedViews: { "eyes-tasks.json": [{ id: "task_1", title: "A", status: "open" }] },
  });
  await readJson(board.files.tasks, []);
  await assert.rejects(
    () => writeJson(board.files.tasks, [{ id: "task_1", title: "A", status: "open" }, { id: "task_1", title: "B", status: "open" }]),
    undefined,
    "a duplicate-id write must fail loudly instead of conflating two jobs",
  );
  // The store still works after the rejected write.
  await writeJson(board.files.tasks, [{ id: "task_1", title: "A", status: "active" }]);
  assert.equal((await readJson(board.files.tasks, []))[0].status, "active");
});

test("two processes race for one open task: exactly one claim wins", async () => {
  const board = freshBoard({
    seedViews: { "eyes-tasks.json": [{ id: "contested", title: "One slot of work", status: "open" }] },
  });
  await readJson(board.files.tasks, []); // migrate into the store
  const workerPath = fileURLToPath(new URL("./fixtures/claim_worker.mjs", import.meta.url));
  const outcomes = await Promise.all(
    Array.from({ length: 5 }, () =>
      new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [workerPath, board.dir, path.join(board.dir, "board", "board.db"), "contested"], {
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
        let out = "";
        child.stdout.on("data", (chunk) => (out += chunk));
        child.stderr.on("data", (chunk) => (out += chunk));
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, out: out.trim() }));
      })),
  );
  const claimed = outcomes.filter((row) => row.out === "CLAIMED");
  assert.equal(claimed.length, 1, `exactly one process may launch: ${JSON.stringify(outcomes)}`);
  assert.ok(outcomes.every((row) => row.code === 0 && (row.out === "CLAIMED" || row.out === "LOST")), `every racer exits cleanly: ${JSON.stringify(outcomes)}`);
  const finalTask = (await readJson(board.files.tasks, []))[0];
  assert.equal(finalTask.status, "active", "the winning claim is on the board");
  assert.match(String(finalTask.runId), /^run_\d+$/, "the board names the winning run");
});

// ---- the parallel-executor smoke -------------------------------------------------

// Spawns one executor slot process (a fixture mirroring main.cjs's
// transactional claim + fenced settle) and resolves its single output line.
function executorSlot(dir, dbPath) {
  const workerPath = fileURLToPath(new URL("./fixtures/executor_slot.mjs", import.meta.url));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [workerPath, dir, dbPath], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (out += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out: out.trim() }));
  });
}

test("concurrent executor slots drain a board with no double claims and lease stamps", async () => {
  const board = freshBoard({
    seedViews: {
      "eyes-tasks.json": [
        { id: "task_a", title: "Oldest", status: "open", createdAt: 1 },
        { id: "task_b", title: "Middle", status: "open", createdAt: 2 },
        { id: "task_c", title: "Newest", status: "open", createdAt: 3 },
      ],
    },
  });
  await readJson(board.files.tasks, []); // migrate into the store
  // Seven slots over three tasks: the pool is wider than the work, exactly the
  // shape that used to double-spawn when the claim was a read then a write.
  const dbPath = path.join(board.dir, "board", "board.db");
  const outcomes = await Promise.all(Array.from({ length: 7 }, () => executorSlot(board.dir, dbPath)));
  const lines = outcomes.map((row) => row.out);
  assert.ok(
    outcomes.every((row) => row.code === 0 && /^(CLAIMED|IDLE|LOST)( |$)/.test(row.out)),
    `every slot exits cleanly with one verdict: ${JSON.stringify(outcomes)}`,
  );
  const claimed = lines.filter((line) => line.startsWith("CLAIMED")).map((line) => line.split(" ")[1]);
  assert.equal(claimed.length, 3, `every task is claimed exactly once: ${JSON.stringify(lines)}`);
  assert.equal(new Set(claimed).size, 3, `no two slots hold the same task: ${JSON.stringify(lines)}`);
  assert.deepEqual([...new Set(claimed)].sort(), ["task_a", "task_b", "task_c"], "no task is left behind");
  const rows = await readJson(board.files.tasks, []);
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const id of claimed) {
    const task = byId.get(id);
    assert.equal(task.status, "awaiting_verification", `${id} settled behind the ownership fence`);
    assert.match(String(task.runId), /^run_\d+$/, `${id} names its owning run`);
    assert.ok(task.lease && Number.isFinite(task.lease.at) && task.lease.pid > 0, `${id} carries a collision lease`);
    const slotPid = Number(lines.find((line) => line.startsWith(`CLAIMED ${id} `)).split(" ")[2]);
    assert.equal(task.lease.pid, slotPid, `${id}'s lease names the slot that claimed it`);
    assert.equal(task.lastAttempt?.sawDone, true, `${id} keeps the attempt's evidence`);
  }
});
