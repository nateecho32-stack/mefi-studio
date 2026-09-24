// A test process is hung only after its CPU has stood still for idleSeconds of
// real time. One unchanged sample between two 5 s scans used to count as the
// whole 240 s window, so a briefly idle test run was killed as hung.
import test from "node:test";
import assert from "node:assert/strict";
import { classify } from "../scripts/machine.mjs";

const T0 = 1_800_000_000_000;
const limits = { idleSeconds: 240, maxAgeMinutes: 20, maxMemMB: 1500 };
const love = (cpuMs, extra = {}) => ({ pid: 101, parentPid: 9000, name: "lovec.exe", commandLine: "...\\lua_quality_runner", startedAt: T0 - 60_000, cpuMs, memMB: 300, ...extra });
const alive = () => true;

test("idle time is measured in elapsed time across scans, not per sample", () => {
  const progress = new Map();
  const scan = (at, row, previous) => classify({ processes: [row], previousCpu: new Map(previous == null ? [] : [[101, previous]]), now: at, limits, parentAlive: alive, progress }).verdicts[0];
  assert.equal(scan(T0, love(5000)).status, "healthy", "first sight: nothing to compare");
  assert.equal(scan(T0 + 5_000, love(5000), 5000).status, "healthy", "one unchanged 5 s sample is not a 240 s hang");
  assert.equal(scan(T0 + 120_000, love(5000), 5000).status, "healthy");
  assert.equal(scan(T0 + 240_000, love(5000), 5000).status, "hang", "240 s without CPU movement is a hang");
  assert.equal(scan(T0 + 245_000, love(5200), 5000).status, "healthy", "any CPU movement restarts the window");
  assert.equal(scan(T0 + 250_000, love(5200), 5200).status, "healthy");
  assert.equal(scan(T0 + 486_000, love(5200), 5200).status, "hang");
  // A reused pid is a new process: its window starts over.
  assert.equal(scan(T0 + 490_000, love(5200, { startedAt: T0 + 480_000 }), 5200).status, "healthy");
  // The caller's own previous sample still has to agree that nothing moved.
  assert.equal(scan(T0 + 900_000, love(5200, { startedAt: T0 + 480_000 }), 4000).status, "healthy");
  // A process that leaves the scan leaves the ledger.
  classify({ processes: [], now: T0 + 901_000, limits, parentAlive: alive, progress });
  assert.equal(progress.size, 0);
});

test("the one-sample reading stays available for fixtures that carry no timing", () => {
  const verdict = classify({ processes: [love(8000)], previousCpu: new Map([["101", 8000]]), now: T0, limits, parentAlive: alive, progress: null }).verdicts[0];
  assert.equal(verdict.status, "hang");
  assert.equal(verdict.killable, true);
});
