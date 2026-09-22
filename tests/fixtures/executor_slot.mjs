// One slot of the concurrent-executor smoke (board_store.test.mjs). Prints
// exactly one line and exits 0 either way.
//
//   node tests/fixtures/executor_slot.mjs <dataDir> <dbPath>
//
// The slot mirrors the parallel executor's pick and settle in main.cjs: it
// claims the oldest open task with one transactional boardMutate (the
// freshness re-read, the open-check, and the claim write are one BEGIN
// IMMEDIATE, stamped with a { pid, at } lease), then settles the finished run
// behind the same ownership fence the real finish() uses — a run that no
// longer owns its claim must not close someone else's attempt.

import { defaultBoardConfig, enableBoardStore, boardMutate, closeBoardStore } from "../../scripts/eyes.mjs";

const [dataDir, dbPath] = process.argv.slice(2);
if (!dataDir || !dbPath) {
  console.log("ERROR");
  process.exit(0);
}

enableBoardStore({ dbPath, files: defaultBoardConfig(dataDir).files });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const deadline = Date.now() + 15000;
const runId = `run_${process.pid}`;

try {
  // ---- the pick + claim: one atomic step, never a read then a write -------
  let claimedId = null;
  let idle = false;
  while (Date.now() < deadline && !claimedId && !idle) {
    let result = null;
    try {
      result = await boardMutate((board) => {
        const startedAt = Date.now();
        const open = board.tasks
          .filter((row) => row && row.status === "open" && !row.runId)
          .sort((a, b) => (a.createdAt ?? a.updatedAt ?? 0) - (b.createdAt ?? b.updatedAt ?? 0));
        const current = open[0];
        if (!current) return null; // nothing open: this slot parks
        current.status = "active";
        current.runId = runId;
        current.updatedAt = startedAt;
        current.lease = { pid: process.pid, at: startedAt };
        claimedId = current.id; // synchronous mutator: the capture is safe
        return {};
      });
    } catch {
      // BEGIN IMMEDIATE contention or a busy store: retry like the fill
      // loop does instead of parking the slot.
      await sleep(25);
      continue;
    }
    if (claimedId) break;
    // The mutator ran and claimed nothing — but under contention our snapshot
    // may be stale, so only believe IDLE when the store says nothing changed.
    if (result && Array.isArray(result.written) && result.written.length === 0) idle = true;
    else await sleep(25);
  }

  if (!claimedId) {
    closeBoardStore();
    console.log(idle ? "IDLE" : "ERROR");
    process.exit(0);
  }

  // ---- the settle: fenced by the runId, exactly like finish() -------------
  let settled = false;
  let fenced = false;
  while (Date.now() < deadline && !settled && !fenced) {
    let owned = false; // the fence passed inside this attempt's mutator
    let result = null;
    try {
      result = await boardMutate((board) => {
        const task = board.tasks.find((row) => row && row.id === claimedId);
        if (!task || task.runId !== runId) return null; // ownership fence
        owned = true;
        task.status = "awaiting_verification";
        task.lastAttempt = { runId, code: 0, sawDone: true, at: Date.now() };
        task.logs = [...(task.logs ?? []), { at: Date.now(), kind: "status", text: "run finished (sentinel seen) — awaiting verification" }].slice(-40);
        return {};
      });
    } catch {
      await sleep(25);
      continue;
    }
    if (!owned) {
      fenced = true; // someone else owns the claim now — report, do not write
      break;
    }
    settled = Boolean(Array.isArray(result?.written) && result.written.length);
    if (!settled) await sleep(25);
  }

  closeBoardStore();
  console.log(settled ? `CLAIMED ${claimedId} ${process.pid}` : fenced ? `LOST ${claimedId}` : "ERROR");
  process.exit(0);
} catch (error) {
  closeBoardStore();
  console.log("ERROR");
  process.exit(0);
}
