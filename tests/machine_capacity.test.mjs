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
  assert.equal(first.resources.requiredMemoryMB, 440);
  assert.equal(first.resources.holdKind, null);
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
    assert.equal(capacity.resources.requiredMemoryMB, 440);
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

test("a latch that settles between the recovery and busy lines lifts after lagMaxHoldMs, and a busy reading restarts that clock", async () => {
  const machine = fixture({ lagMaxHoldMs: 60_000 });
  machine.lag(150);
  await machine.capacity();
  machine.advance();
  assert.equal((await machine.capacity()).resources.lagPressure, true, "two busy readings latch the hold");
  // 70 ms: under the busy line, over the 40 ms recovery line. Before the cap
  // this held forever, since each such reading reset the recovery count.
  machine.lag(70);
  machine.advance();
  const calm = await machine.capacity();
  assert.equal(calm.canStart, false);
  assert.match(calm.reason, /the hold lifts in \d+ s/);
  for (let i = 0; i < 10; i += 1) { machine.advance(); await machine.capacity(); }
  machine.lag(120); machine.advance();
  assert.equal((await machine.capacity()).canStart, false, "a busy reading restarts the clock");
  machine.lag(70);
  for (let i = 0; i < 19; i += 1) { machine.advance(); assert.equal((await machine.capacity()).canStart, false, `still held at ${i}`); }
  machine.advance();
  const lifted = await machine.capacity();
  assert.equal(lifted.canStart, true, "a minute under the busy line lifts the hold");
  assert.equal(lifted.resources.lagPressure, false);
  // Relatching still takes two busy readings.
  machine.lag(150); machine.advance();
  assert.equal((await machine.capacity()).canStart, true);
  machine.advance();
  assert.equal((await machine.capacity()).canStart, false);
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
  assert.equal(result.resources.holdKind, "lag");
  assert.doesNotMatch(result.reason, /memory/i, "the lag hold must not borrow the memory gate's wording");
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

test("memory admission holds below the 440 MB emergency floor and recovers at the floor", async () => {
  const machine = fixture();
  machine.free(439);
  const low = await machine.capacity();
  assert.equal(low.canStart, false);
  assert.equal(low.resources.memoryPressure, true);
  assert.equal(low.resources.holdKind, "memory");
  assert.match(low.reason, /439 MB available; 440 MB needed/);
  assert.doesNotMatch(low.reason, /responsiveness|lag/i, "the memory hold must not borrow the lag gate's wording");
  machine.free(440); machine.advance();
  assert.equal((await machine.capacity()).canStart, true);
  machine.free(439); machine.advance();
  assert.equal((await machine.capacity()).canStart, false);
  machine.free(441); machine.advance();
  assert.equal((await machine.capacity()).canStart, true);
  machine.free(0); machine.advance();
  assert.equal((await machine.capacity()).resources.memoryPressure, true);
});

test("the tuned floor admits the observed 474-585 MB free range instead of nondeterministically blocking", async () => {
  const machine = fixture();
  for (const freeMB of [474, 512, 585]) {
    machine.free(freeMB); machine.advance();
    const observed = await machine.capacity();
    assert.equal(observed.canStart, true, `${freeMB} MB free is inside the observed machine range and must admit work`);
    assert.equal(observed.resources.holdKind, null);
  }
});

test("a small memory shortfall holds by default and demotes to a distinct warning only under the explicit override", async () => {
  const machine = fixture();
  machine.free(400); // inside the warn band: at or above the 300 MB severe floor, under the 440 MB sum
  const blocked = await machine.capacity({ force: true });
  assert.equal(blocked.canStart, false, "default behavior must keep blocking small shortfalls");
  assert.equal(blocked.resources.holdKind, "memory");
  assert.equal(blocked.resources.memoryShortfall, "small");
  assert.equal(blocked.resources.memoryWarning, null);
  assert.doesNotMatch(blocked.reason, /override/, "the default hold must not mention the override");
  machine.advance();
  const warned = await machine.capacity({ force: true, memoryWarnOverride: true });
  assert.equal(warned.canStart, true, "the override flag admits the small shortfall");
  assert.equal(warned.reason, null);
  assert.equal(warned.resources.holdKind, null, "an overridden shortfall is a warning, not a hold");
  assert.equal(warned.resources.memoryShortfall, "small");
  assert.match(warned.resources.memoryWarning, /400 MB available; 440 MB needed/);
  assert.match(warned.resources.memoryWarning, /explicit memory override/, "the warning must be distinctly worded");
  machine.advance();
  const perCallOff = await machine.capacity({ force: true, memoryWarnOverride: false });
  assert.equal(perCallOff.canStart, false, "an explicit per-call false beats the sampler default and blocks again");
});

test("the severe memory floor blocks even with the override flag and holds at both boundaries", async () => {
  const machine = fixture();
  machine.free(299);
  const severe = await machine.capacity({ force: true, memoryWarnOverride: true });
  assert.equal(severe.canStart, false, "below the severe floor the override must not admit work");
  assert.equal(severe.resources.holdKind, "memory-severe");
  assert.equal(severe.resources.memoryShortfall, "severe");
  assert.equal(severe.resources.memoryWarning, null);
  assert.match(severe.reason, /299 MB available/);
  assert.match(severe.reason, /severe floor/, "the severe hold must be distinctly worded");
  machine.free(300); machine.advance();
  const atFloor = await machine.capacity({ force: true, memoryWarnOverride: true });
  assert.equal(atFloor.canStart, true, "equal to the floor is the small band, so the override admits");
  assert.equal(atFloor.resources.memoryShortfall, "small");
  machine.free(439); machine.advance();
  const justUnder = await machine.capacity({ force: true, memoryWarnOverride: true });
  assert.equal(justUnder.canStart, true, "439 MB is the small band under the 440 MB sum");
  assert.equal(justUnder.resources.memoryShortfall, "small");
  machine.free(440); machine.advance();
  const clear = await machine.capacity({ force: true, memoryWarnOverride: true });
  assert.equal(clear.canStart, true);
  assert.equal(clear.resources.memoryShortfall, null);
  assert.equal(clear.resources.memoryWarning, null, "no warning may leak when admission is clear");
});

test("a sampler-level override flag admits small shortfalls without per-call arguments", async () => {
  const machine = fixture({ memoryWarnOverride: true });
  machine.free(350);
  const admitted = await machine.capacity({ force: true });
  assert.equal(admitted.canStart, true);
  assert.equal(admitted.resources.memoryShortfall, "small");
  assert.match(admitted.resources.memoryWarning, /350 MB available; 440 MB needed/);
});

test("an under-floor dip latches a parallelism cap that outlives the floor and ignores the override", async () => {
  const machine = fixture();
  machine.free(299);
  const severe = await machine.capacity({ force: true, running: 4, memoryWarnOverride: true });
  assert.equal(severe.canStart, false);
  assert.equal(severe.resources.holdKind, "memory-severe");
  // One under-floor sample must not latch the cap by itself: a solitary dip
  // that recovers straight into the small band stays a plain overrideable
  // shortfall, exactly like any other flicker-above-the-floor reading.
  machine.free(350); machine.advance();
  const single = await machine.capacity({ force: true, running: 4, memoryWarnOverride: true });
  assert.equal(single.canStart, true, "a single under-floor sample never latches the cap");
  assert.equal(single.resources.memorySevereCapped, false);
  assert.equal(single.resources.memoryShortfall, "small");
  // Two consecutive under-floor readings engage the latch. Recovering just
  // past the floor must not re-admit: the latched cap holds the recovery
  // band, so a host with 4 workers stops flapping on every oscillation
  // across 300 MB.
  machine.free(299); machine.advance();
  assert.equal((await machine.capacity({ force: true, running: 4, memoryWarnOverride: true })).canStart, false);
  machine.free(299); machine.advance();
  const latched = await machine.capacity({ force: true, running: 4, memoryWarnOverride: true });
  assert.equal(latched.resources.memorySevereCapped, true, "two consecutive under-floor samples latch the cap");
  machine.free(350); machine.advance();
  const capped = await machine.capacity({ force: true, running: 4, memoryWarnOverride: true });
  assert.equal(capped.canStart, false, "the recovery band must not admit on the override");
  assert.equal(capped.resources.holdKind, "memory-cap");
  assert.equal(capped.resources.memorySevereCapped, true);
  assert.match(capped.reason, /recovering from the severe floor/);
  assert.match(capped.reason, /parallelism stays capped at 4/);
  assert.match(capped.reason, /450 MB needed/);
  assert.equal(capped.resources.memoryWarning, null, "the cap must not leak the override warning while holding");
  assert.match(describe({ capacity: capped, leases: { busy: false }, processes: [] }), /recovering from the severe floor/, "the machine summary carries the cap hold reason for the panel");
  machine.free(449); machine.advance();
  assert.equal((await machine.capacity({ force: true, running: 4 })).canStart, false, "one MB short of the release threshold the cap holds");
  // Release needs consecutive readings too: the host was observed flickering
  // 197 -> 526 -> 354 MB across the boundaries on solitary samples, so one
  // 451 MB blip between band readings must not lift the cap.
  machine.free(451); machine.advance();
  assert.equal((await machine.capacity({ force: true, running: 4 })).canStart, false, "a single release-side reading keeps the cap");
  machine.free(449); machine.advance();
  assert.equal((await machine.capacity({ force: true, running: 4 })).canStart, false, "a band reading after a release blip restarts the streak");
  machine.free(450); machine.advance();
  assert.equal((await machine.capacity({ force: true, running: 4 })).canStart, false, "the first of two consecutive release readings keeps the cap");
  machine.free(450); machine.advance();
  const released = await machine.capacity({ force: true, running: 4 });
  assert.equal(released.canStart, true, "two consecutive readings past floor plus margin release the cap");
  assert.equal(released.resources.holdKind, null);
  assert.equal(released.resources.memorySevereCapped, false);
});

test("oscillating readings across both boundaries stay held until consecutive readings clear the recovery band", async () => {
  const machine = fixture();
  machine.free(299);
  await machine.capacity({ force: true, running: 4, memoryWarnOverride: true });
  machine.free(299); machine.advance();
  await machine.capacity({ force: true, running: 4, memoryWarnOverride: true });
  for (const freeMB of [360, 299, 380, 310, 440]) {
    machine.free(freeMB); machine.advance();
    const held = await machine.capacity({ force: true, running: 4, memoryWarnOverride: true });
    assert.equal(held.canStart, false, `${freeMB} MB after an under-floor dip must stay held`);
  }
  // Solitary 451 MB blips between band readings reproduce the observed host
  // flicker (197 -> 526 -> 354 MB): without consecutive-sample release the
  // cap toggled per reading and re-admitted workers into the band.
  for (const freeMB of [451, 340, 451, 360]) {
    machine.free(freeMB); machine.advance();
    assert.equal((await machine.capacity({ force: true, running: 4, memoryWarnOverride: true })).canStart, false, `a solitary ${freeMB} MB reading must not release the cap`);
  }
  machine.free(450); machine.advance();
  assert.equal((await machine.capacity({ force: true, running: 4, memoryWarnOverride: true })).canStart, false, "the first clear reading alone keeps the cap");
  machine.free(450); machine.advance();
  assert.equal((await machine.capacity({ force: true, running: 4, memoryWarnOverride: true })).canStart, true, "two consecutive clear readings release the cap");
});

test("the severe-memory cap starves nobody: a drained pool may still start its first worker", async () => {
  const machine = fixture();
  machine.free(299);
  await machine.capacity({ force: true, running: 4 });
  machine.free(299); machine.advance();
  await machine.capacity({ force: true, running: 4 });
  machine.free(350); machine.advance();
  const solo = await machine.capacity({ force: true, running: 0, memoryWarnOverride: true });
  assert.equal(solo.canStart, true, "with no workers running the cap defers to the normal small-band rules");
  assert.equal(solo.resources.memorySevereCapped, true, "the latch itself stays visible in the resources");
  assert.equal(solo.resources.memoryShortfall, "small");
  assert.match(solo.resources.memoryWarning, /explicit memory override/);
  // The panel summary must not read as a fully free machine while the latch
  // holds: admission is clear for this one worker, parallelism is not.
  assert.match(describe({ capacity: solo, leases: { busy: false }, processes: [] }), /cap still latched/, "the latched cap surfaces in the machine summary even while one worker may start");
});

test("the cap reads each caller's live worker count from one cached sample", async () => {
  const machine = fixture();
  machine.free(299);
  await machine.capacity({ force: true, running: 2 });
  machine.free(299); machine.advance();
  await machine.capacity({ force: true, running: 2 });
  machine.free(350); machine.advance();
  await machine.capacity({ force: true, running: 0, memoryWarnOverride: true });
  const [pooled, drained] = await Promise.all([
    machine.capacity({ running: 4, memoryWarnOverride: true }),
    machine.capacity({ running: 0, memoryWarnOverride: true }),
  ]);
  assert.equal(pooled.resources.sampledAt, drained.resources.sampledAt, "both verdicts share the cached sample");
  assert.equal(pooled.canStart, false);
  assert.equal(pooled.resources.holdKind, "memory-cap");
  assert.equal(drained.canStart, true, "the same cached reading admits the first worker of a drained pool");
  assert.equal(drained.resources.holdKind, null);
});

test("unknown memory readings never take the override path", async () => {
  const machine = fixture({ memoryWarnOverride: true });
  machine.available(true, false);
  const missing = await machine.capacity();
  assert.equal(missing.canStart, false);
  assert.equal(missing.resources.holdKind, "unknown");
  assert.equal(missing.resources.memoryShortfall, null);
  assert.equal(missing.resources.memoryWarning, null);
  assert.match(missing.reason, /memory readings/);
});

test("summaries surface the overridden memory warning alongside healthy admission", async () => {
  const machine = fixture({ memoryWarnOverride: true });
  machine.free(400);
  const capacity = await machine.capacity({ force: true });
  const summary = describe({ capacity, leases: { busy: false }, processes: [] });
  assert.match(summary, /400 MB available; 440 MB needed.*override/);
  assert.doesNotMatch(summary, /Waiting for machine memory/);
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
