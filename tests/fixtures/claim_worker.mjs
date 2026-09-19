// One racer in the claim-race regression (board_store.test.mjs). Prints
// exactly one line — CLAIMED, LOST, or ERROR — and exits 0 either way.
//
//   node tests/fixtures/claim_worker.mjs <dataDir> <dbPath> <taskId>
//
// The claim is a single transactional boardMutate: the freshness re-read, the
// open-check, and the claim write are one BEGIN IMMEDIATE, so of N processes
// racing the same open task, exactly one wins permission to launch.

import path from "node:path";
import { defaultBoardConfig, enableBoardStore, boardMutate, closeBoardStore } from "../../scripts/eyes.mjs";

const [dataDir, dbPath, taskId] = process.argv.slice(2);
if (!dataDir || !dbPath || !taskId) {
  console.log("ERROR");
  process.exit(0);
}

enableBoardStore({ dbPath, files: defaultBoardConfig(dataDir).files });

const deadline = Date.now() + 15000;
let outcome = "ERROR";
while (Date.now() < deadline) {
  let result = null;
  try {
    result = await boardMutate((board) => {
      const task = board.tasks.find((row) => row && row.id === taskId);
      if (!task || task.status !== "open" || task.runId) return null;
      task.status = "active";
      task.runId = `run_${process.pid}`;
      return {};
    });
  } catch {
    // BEGIN IMMEDIATE contention or a busy store: retry until the deadline.
    await new Promise((resolve) => setTimeout(resolve, 25));
    continue;
  }
  if (result && result.written && result.written.length) {
    outcome = "CLAIMED";
  } else {
    outcome = "LOST"; // the task was not open for us — someone else holds it
  }
  break;
}

closeBoardStore();
console.log(outcome);
process.exit(0);
