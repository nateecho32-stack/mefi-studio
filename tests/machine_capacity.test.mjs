import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createWorkerCapacitySampler, describe, leaseStatus } from "../scripts/machine.mjs";

function fixture(overrides = {}) {
  let now = 1000;
  // A busy lifetime average must not hide today's spare capacity.
  let user = 900000, idle = 100000;
  let nextCpu = 20, timerLagMs = 0, freeMB = 8192, totalMB = 16384;
  let cpuAvailable = true, memoryAvailable = true;
  let cpuReads = 0, waits = 0;
  const advance = (cpu = nextCpu, ms = 3000) => {
    now += ms;
    user += ms * cpu / 100;
    idle += ms * (1 - cpu / 100);
  };
  const capacity = createWorkerCapacitySampler({
    cpus: () => {
      cpuReads += 1;
      if (!cpuAvailable) throw new Error("CPU unavailable");
      return [{ times: { user, nice: 0, sys: 0, idle, irq: 0 } }];
    },
    freemem: () => memoryAvailable ? freeMB * 1024 * 1024 : NaN,
    totalmem: () => totalMB * 1024 * 1024,
    clock: () => now,
    wait: async (ms) => { waits += 1; advance(nextCpu, ms + timerLagMs); },
    ...overrides,
  });
  return {
    capacity, advance,
    cpu: (percent) => { nextCpu = percent; },
    lag: (ms) => { timerLagMs = ms; },
    free: (mb) => { freeMB = mb; },
    total: (mb) => { totalMB = mb; },
    available: (cpu, memory = true) => { cpuAvailable = cpu; memoryAvailable = memory; },
    resetCpu: () => { user = 0; idle = 0; },
    reads: () => ({ cpuReads, waits }),
  };
}

test("machine admits responsive workers without a fixed worker limit and reports recent CPU deltas", async () => {
  const machine = fixture();
  const first = await machine.capacity({ running: 27 });
  assert.equal(first.canStart, true);
  assert.equal(first.reason, null);
  assert.equal(first.resources.cpuPercent, 20);
  assert.equal(first.resources.lagMs, 0);
  assert.equal(first.resources.running, 27);
  assert.equal(first.resources.totalMemoryMB, 16384);
  assert.equal(first.resources.requiredMemoryMB, 512);
  machine.cpu(50); machine.advance(50);
  assert.equal((await machine.capacity({ running: 100 })).resources.cpuPercent, 50);
  assert.deepEqual(machine.reads(), { cpuReads: 4, waits: 2 });
});

test("1.9 GB available on a 16 GB machine permits the fourth, fifth and tenth worker", async () => {
  const machine = fixture();
  machine.free(1903);
  for (const running of [3, 4, 9]) {
    const capacity = await machine.capacity({ running });
    assert.equal(capacity.canStart, true, `${running} existing workers must not create a memory hold`);
    assert.equal(capacity.reason, null);
    assert.equal(capacity.resources.memoryPressure, false);
    assert.equal(capacity.resources.availableMemoryMB, 1903);
    assert.equal(capacity.resources.totalMemoryMB, 16384);
    assert.equal(capacity.resources.requiredMemoryMB, 512);
    machine.advance();
  }
});

test("machine callers share the initial interval and cached readings stay detached", async () => {
  let release;
  let reads = 0, waits = 0, now = 1000, user = 100, idle = 100;
  const capacity = createWorkerCapacitySampler({
    cpus: () => { reads += 1; return [{ times: { user, nice: 0, sys: 0, idle, irq: 0 } }]; },
    freemem: () => 8 * 1024 ** 3,
    totalmem: () => 16 * 1024 ** 3,
    clock: () => now,
    wait: () => { waits += 1; return new Promise((resolve) => { release = resolve; }); },
  });
  const first = capacity({ running: 1 });
  const second = capacity({ running: 2 });
  assert.equal(waits, 1);
  assert.equal(reads, 1);
  now += 150; user += 30; idle += 120; release();
  const [one, two] = await Promise.all([first, second]);
  assert.equal(one.resources.running, 1);
  assert.equal(two.resources.running, 2);
  one.resources.cpuPercent = 99;
  assert.equal(two.resources.cpuPercent, 20);
  assert.equal((await capacity()).resources.cpuPercent, 20);
  assert.equal(reads, 2);
  now += 749;
  await capacity();
  assert.equal(reads, 2);
  now += 1; user += 100; idle += 650;
  const refreshed = capacity();
  assert.equal(reads, 3);
  now += 150; user += 30; idle += 120; release();
  await refreshed;
  assert.equal(reads, 4);
});

test("a forced post-claim check refreshes CPU and memory inside the normal cache window", async () => {
  const machine = fixture();
  assert.equal((await machine.capacity()).canStart, true);
  machine.free(400);
  machine.cpu(98);
  // Ordinary status readers may still reuse the recent healthy observation.
  assert.equal((await machine.capacity()).canStart, true);
  const [first, second] = await Promise.all([
    machine.capacity({ force: true }),
    machine.capacity({ force: true }),
  ]);
  assert.equal(first.canStart, false);
  assert.equal(first.resources.availableMemoryMB, 400);
  assert.equal(first.resources.memoryPressure, true);
  assert.equal(first.resources.cpuPercent, 98);
  assert.equal(first.resources.lagPressure, false, "CPU use is informational even in the fresh check");
  assert.equal(second.canStart, false);
  assert.equal(second.resources.sampledAt, first.resources.sampledAt);
  assert.deepEqual(machine.reads(), { cpuReads: 4, waits: 2 });
  assert.equal((await machine.capacity()).canStart, false);
});

test("a forced post-claim check catches new host lag inside the normal cache window", async () => {
  const machine = fixture();
  assert.equal((await machine.capacity()).canStart, true);
  machine.lag(350);
  assert.equal((await machine.capacity()).canStart, true);
  const fresh = await machine.capacity({ force: true });
  assert.equal(fresh.canStart, false);
  assert.equal(fresh.resources.hostLagMs, 350);
  assert.equal(fresh.resources.memoryPressure, false);
  assert.match(fresh.reason, /responsiveness/);
});

test("sustained response lag holds new work and recovery needs two responsive readings", async () => {
  const machine = fixture();
  machine.lag(120);
  assert.equal((await machine.capacity()).canStart, true);
  // Reading one cached spike repeatedly cannot turn it into sustained pressure.
  assert.equal((await machine.capacity()).canStart, true);
  machine.lag(100); machine.advance();
  const busy = await machine.capacity();
  assert.equal(busy.canStart, false);
  assert.match(busy.reason, /responsiveness.*recover/);
  assert.equal(busy.resources.lagPressure, true);
  assert.equal(busy.resources.hostLagMs, 100);
  machine.lag(20); machine.advance();
  assert.equal((await machine.capacity()).canStart, false);
  machine.lag(70); machine.advance();
  assert.equal((await machine.capacity()).canStart, false);
  machine.lag(40); machine.advance();
  assert.equal((await machine.capacity()).canStart, false);
  machine.lag(30); machine.advance();
  assert.equal((await machine.capacity()).canStart, true);
});

test("a zero-lag recovery sample explains the pending readings instead of citing healthy lag", async () => {
  const machine = fixture();
  machine.lag(100);
  assert.equal((await machine.capacity()).canStart, true);
  machine.lag(100); machine.advance();
  const latched = await machine.capacity();
  assert.equal(latched.canStart, false);
  assert.equal(latched.resources.lagPressure, true);
  // First responsive reading keeps the hold but must not blame the healthy
  // sample: the alert "blocked despite 0 ms lag" was a self-contradiction.
  machine.lag(0); machine.advance();
  const recovering = await machine.capacity();
  assert.equal(recovering.canStart, false);
  assert.equal(recovering.resources.lagMs, 0);
  assert.doesNotMatch(recovering.reason, /0 ms/);
  assert.match(recovering.reason, /recover \(1 of 2 responsive readings/);
  machine.advance();
  const recovered = await machine.capacity();
  assert.equal(recovered.canStart, true);
  assert.equal(recovered.reason, null);
});

test("severe response lag immediately prevents another worker", async () => {
  const machine = fixture();
  machine.lag(300);
  const result = await machine.capacity();
  assert.equal(result.canStart, false);
  assert.equal(result.resources.hostLagMs, 300);
  assert.equal(result.resources.lagMs, 300);
  assert.match(result.reason, /responsiveness.*300 ms lag/);
});

test("high CPU alone allows more workers while measured responsiveness stays healthy", async () => {
  const machine = fixture();
  machine.cpu(99);
  for (const running of [3, 4, 9]) {
    const result = await machine.capacity({ running });
    assert.equal(result.canStart, true);
    assert.equal(result.resources.cpuPercent, 99);
    assert.equal(result.resources.lagPressure, false);
    machine.advance();
  }
});

test("renderer lag combines with host lag and new renderer readings bypass cached capacity", async () => {
  const machine = fixture();
  assert.equal((await machine.capacity({ lagMs: 10 })).canStart, true);
  const severe = await machine.capacity({ lagMs: 350 });
  assert.equal(severe.canStart, false);
  assert.equal(severe.resources.hostLagMs, 0);
  assert.equal(severe.resources.rendererLagMs, 350);
  assert.equal(severe.resources.lagMs, 350);
  assert.equal((await machine.capacity({ lagMs: 20 })).canStart, false);
  machine.advance();
  assert.equal((await machine.capacity({ lagMs: 20 })).canStart, true);
  machine.lag(320); machine.advance();
  const hostSlow = await machine.capacity({ lagMs: 5 });
  assert.equal(hostSlow.canStart, false);
  assert.equal(hostSlow.resources.lagMs, 320);
});

test("concurrent lag checks share sampling and retain the strongest renderer observation", async () => {
  const machine = fixture();
  const [first, second] = await Promise.all([
    machine.capacity({ lagMs: 5 }),
    machine.capacity({ lagMs: 350 }),
  ]);
  assert.equal(first.canStart, false);
  assert.equal(second.canStart, false);
  assert.equal(first.resources.lagMs, 350);
  assert.equal(second.resources.lagMs, 350);
  assert.deepEqual(machine.reads(), { cpuReads: 2, waits: 1 });
});

test("memory admission holds below the 512 MB emergency floor and recovers at the floor", async () => {
  const machine = fixture();
  machine.free(511);
  const low = await machine.capacity();
  assert.equal(low.canStart, false);
  assert.equal(low.resources.memoryPressure, true);
  assert.match(low.reason, /511 MB available; 512 MB needed/);
  machine.free(512); machine.advance();
  assert.equal((await machine.capacity()).canStart, true);
  machine.free(511); machine.advance();
  assert.equal((await machine.capacity()).canStart, false);
  machine.free(513); machine.advance();
  assert.equal((await machine.capacity()).canStart, true);
  machine.free(0); machine.advance();
  assert.equal((await machine.capacity()).resources.memoryPressure, true);
});

test("missing memory holds admission, while unavailable CPU does not block responsive work", async () => {
  const machine = fixture();
  machine.available(false);
  const responsive = await machine.capacity();
  assert.equal(responsive.canStart, true);
  assert.equal(responsive.resources.cpuPercent, null);
  assert.equal(responsive.resources.lagMs, 0);
  machine.available(false, false);
  machine.advance();
  const missing = await machine.capacity();
  assert.equal(missing.canStart, false);
  assert.match(missing.reason, /memory readings/);
  assert.equal(missing.resources.cpuPercent, null);
  assert.equal(missing.resources.availableMemoryMB, null);
  machine.available(true); machine.advance();
  assert.equal((await machine.capacity()).canStart, true);
  machine.total(0); machine.advance();
  assert.match((await machine.capacity()).reason, /memory readings/);
  machine.total(100); machine.advance();
  assert.match((await machine.capacity()).reason, /memory readings/);
  machine.total(16384); machine.resetCpu(); machine.advance();
  assert.equal((await machine.capacity()).canStart, true);
});

test("stale CPU baselines start a fresh interval instead of averaging old activity", async () => {
  const machine = fixture();
  await machine.capacity();
  machine.advance(99, 30000);
  machine.cpu(15);
  const result = await machine.capacity();
  assert.equal(result.canStart, true);
  assert.equal(result.resources.cpuPercent, 15);
  assert.deepEqual(machine.reads(), { cpuReads: 4, waits: 2 });
});

test("empty and non-progressing CPU snapshots remain unknown without holding responsive work", async () => {
  const empty = fixture({ cpus: () => [] });
  const emptyResult = await empty.capacity();
  assert.equal(emptyResult.canStart, true);
  assert.equal(emptyResult.resources.cpuPercent, null);
  const stopped = fixture({ cpus: () => [{ times: { user: 1, nice: 0, sys: 0, idle: 99, irq: 0 } }] });
  const stoppedResult = await stopped.capacity();
  assert.equal(stoppedResult.canStart, true);
  assert.equal(stoppedResult.resources.cpuPercent, null);
});

test("machine summaries explain measured capacity alongside test coordination", async () => {
  const machine = fixture();
  machine.cpu(98);
  machine.lag(400);
  const capacity = await machine.capacity();
  const summary = describe({ capacity, leases: { busy: false }, processes: [{ test: true }] });
  assert.match(summary, /CPU 98%, 8192 MB RAM available/);
  assert.match(summary, /400 ms response lag/);
  assert.match(summary, /Waiting for machine responsiveness to recover/);
  assert.match(summary, /no active test leases/);
  assert.match(summary, /1 LOVE test process/);
  assert.doesNotMatch(describe({ capacity: { canStart: false, reason: "Waiting for machine CPU readings." } }), /undefined|NaN/);
});

test("a missing lease directory fails open while an unreadable one fails closed", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mefi-lease-scope-"));
  try {
    const none = await leaseStatus({ repoRoot: root, alive: () => true });
    assert.equal(none.busy, false, "no lease board yet must read as a free machine");
    assert.deepEqual(none.holders, []);
    await mkdir(path.join(root, "tools", "logs"), { recursive: true });
    // A file sitting where the board belongs makes readdir fail with a
    // non-ENOENT code (ENOTDIR here; EACCES/EPERM behave the same): the error
    // must propagate so the foreman's lease path stays fail closed.
    await writeFile(path.join(root, "tools", "logs", "_lease"), "not a directory");
    await assert.rejects(
      leaseStatus({ repoRoot: root, alive: () => true }),
      (error) => error?.code !== "ENOENT",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
