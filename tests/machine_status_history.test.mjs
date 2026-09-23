import test from "node:test";
import assert from "node:assert/strict";
import { appendMachineStatusHistory, machineStatusSample, MACHINE_STATUS_HISTORY_LIMIT } from "../scripts/machine.mjs";

function tick(n, overrides = {}) {
  return {
    updatedAt: `2026-09-22T00:00:${String(n).padStart(2, "0")}.000Z`,
    reason: "poll",
    leases: { busy: false, totalWidth: 0 },
    running: [],
    capacity: { canStart: true, resources: { lagMs: 5, availableMemoryMB: 900, holdKind: null } },
    wait: false,
    lines: `tick ${n}`,
    ...overrides,
  };
}

test("history records the first tick and keeps it marked across later polls", () => {
  let history = [];
  for (let n = 1; n <= 5; n += 1) history = appendMachineStatusHistory(history, tick(n));
  assert.equal(history.length, 5);
  assert.equal(history[0].first, true);
  assert.equal(history[0].updatedAt, tick(1).updatedAt);
  assert.equal(history[4].updatedAt, tick(5).updatedAt);
  assert.deepEqual(
    history.map((entry) => entry.lines),
    ["tick 1", "tick 2", "tick 3", "tick 4", "tick 5"],
  );
});

test("history is bounded and never drops the first post-restart tick", () => {
  let history = [];
  for (let n = 1; n <= MACHINE_STATUS_HISTORY_LIMIT * 3; n += 1) history = appendMachineStatusHistory(history, tick(n));
  assert.equal(history.length, MACHINE_STATUS_HISTORY_LIMIT);
  assert.equal(history[0].first, true);
  assert.equal(history[0].lines, "tick 1");
  const last = history[history.length - 1];
  assert.equal(last.lines, `tick ${MACHINE_STATUS_HISTORY_LIMIT * 3}`);
  // oldest-to-newest order of the surviving window
  const stamps = history.map((entry) => entry.lines);
  assert.deepEqual(stamps, [...stamps].sort((a, b) => Number(a.split(" ")[1]) - Number(b.split(" ")[1])));
});

test("a custom limit is honored and truncated to at least two entries", () => {
  let history = [];
  for (let n = 1; n <= 5; n += 1) history = appendMachineStatusHistory(history, tick(n), { limit: 3 });
  assert.equal(history.length, 3);
  assert.equal(history[0].first, true);
  assert.equal(history[1].lines, "tick 4");
  assert.equal(history[2].lines, "tick 5");
  let tiny = [];
  for (let n = 1; n <= 4; n += 1) tiny = appendMachineStatusHistory(tiny, tick(n), { limit: 1 });
  assert.equal(tiny.length, 2);
  assert.equal(tiny[0].first, true);
  assert.equal(tiny[1].lines, "tick 4");
});

test("sample carries the hold classification a later observer needs", () => {
  const sample = machineStatusSample(tick(7, {
    capacity: { canStart: false, resources: { lagMs: 250, availableMemoryMB: 120, holdKind: "memory-severe", memoryPressure: true } },
    leases: { busy: true, totalWidth: 8 },
    running: [{ pid: 1 }, { pid: 2 }],
  }));
  assert.equal(sample.canStart, false);
  assert.equal(sample.holdKind, "memory-severe");
  assert.equal(sample.lagMs, 250);
  assert.equal(sample.availableMemoryMB, 120);
  assert.equal(sample.busy, true);
  assert.equal(sample.totalWidth, 8);
  assert.equal(sample.running, 2);
  assert.equal(sample.first, undefined);
});

test("malformed prior history degrades to a fresh, bounded ring", () => {
  let history = appendMachineStatusHistory(null, tick(1));
  assert.equal(history.length, 1);
  history = appendMachineStatusHistory({ not: "an array" }, tick(2));
  assert.equal(history.length, 1);
  assert.equal(history[0].lines, "tick 2");
});
