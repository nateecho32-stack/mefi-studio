// The fleet host (scripts/fleet-host.cjs) with a fake clock, fake timers and a
// temp data folder: pushes only while a Fleet view watches, coalesced to one
// per half second, per project, and the seats' lineage saved and reloaded.
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import host from "../scripts/fleet-host.cjs";

const T0 = 1_800_000_000_000;
const settle = () => new Promise((resolve) => setImmediate(resolve));
// The hosts a test has made. flush waits for what each of them has started, not for a guessed number of
// event-loop turns: on a loaded machine the first file read outlasted a fixed count.
const live = new Set();
const flush = async () => {
  for (let round = 0; round < 3; round += 1) {
    for (const fleet of live) for (const scope of fleet._scopes.values()) { await scope.loaded; await scope.writes; }
    for (let turn = 0; turn < 10; turn += 1) await settle();
  }
};

function fakeTimers(clock) {
  const pending = [];
  return {
    setTimeout(fn, ms) {
      const timer = { at: clock.t + ms, fn, unref() {} };
      pending.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      const index = pending.indexOf(timer);
      if (index >= 0) pending.splice(index, 1);
    },
    async advance(ms) {
      clock.t += ms;
      for (;;) {
        pending.sort((a, b) => a.at - b.at);
        const due = pending[0];
        if (!due || due.at > clock.t) break;
        pending.shift();
        due.fn();
        await flush();
      }
    },
  };
}

async function harness({ tasks = [], project = "project_1", active = () => true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "fleet-host-"));
  const clock = { t: T0 };
  const timers = fakeTimers(clock);
  const sent = [];
  let current = project;
  const fleet = host.createFleetHost({
    dataFile: (name) => path.join(root, current, name),
    projectId: () => current,
    projectName: () => (current === "project_1" ? "Mefi Studio" : "Other Game"),
    isActive: (id) => active(id, current),
    send: (channel, payload) => sent.push({ channel, payload }),
    now: () => clock.t,
    status: () => ({ parallel: 2, loop: { state: "idle", on: true, ready: 0 }, running: [] }),
    roster: () => [{ role: "foreman", status: "running", runs: 2 }],
    team: async () => ({ executorCli: "opencode", executorModel: "fable-5" }),
    readTasks: async () => tasks,
    timers,
  });
  live.add(fleet);
  return { fleet, sent, clock, timers, root, switchTo: (id) => { current = id; }, done: () => { live.delete(fleet); return rm(root, { recursive: true, force: true }); } };
}

const running = (runId, taskId, at) => ({ parallel: 2, loop: { state: "running", on: true, ready: 1 }, running: [{ id: runId, taskId, title: `Work on ${taskId}`, startedAt: at, phase: "building", lastOutputAt: at }] });
const builderOf = (view) => view.pods.find((pod) => pod.id === "build").seats[0];

test("nothing is pushed until a Fleet view watches, and a new watcher gets a snapshot at once", async () => {
  const h = await harness();
  try {
    await h.fleet.observeStatus(running("run_1", "task_a", T0));
    await flush();
    assert.equal(h.sent.length, 0);
    assert.deepEqual(h.fleet.watch({ id: "fleet-view", on: true }), { ok: true, watching: true, leaseMs: host.LIMITS.leaseMs });
    await flush();
    assert.equal(h.sent.length, 1);
    assert.equal(h.sent[0].channel, "fleet:update");
    const view = h.sent[0].payload;
    assert.equal(view.projectId, "project_1");
    assert.equal(builderOf(view).status, "working");
    assert.equal(view.pods.find((pod) => pod.id === "lead").seats.find((seat) => seat.id === "foreman").status, "working");
    assert.ok(view.rev >= 1);
  } finally {
    await h.done();
  }
});

test("changes inside half a second share one trailing push that carries the newest state", async () => {
  const h = await harness();
  try {
    h.fleet.watch({ on: true });
    await flush();
    h.sent.length = 0;
    await h.timers.advance(1000);
    await h.fleet.observeStatus(running("run_1", "task_a", h.clock.t));
    await flush();
    assert.equal(h.sent.length, 1, "the first change after a quiet gap goes out at once");
    for (const step of ["Reading", "Editing", "Testing"]) {
      const status = running("run_1", "task_a", T0);
      status.running[0].currentStep = step;
      await h.fleet.observeStatus(status);
    }
    await flush();
    assert.equal(h.sent.length, 1, "the next ones wait for the trailing push");
    await h.timers.advance(host.LIMITS.pushGapMs);
    await flush();
    assert.equal(h.sent.length, 2);
    assert.equal(builderOf(h.sent[1].payload).now.step, "Testing");
  } finally {
    await h.done();
  }
});

test("a lapsed lease stops the pushes, and closing the view stops them at once", async () => {
  const h = await harness();
  try {
    h.fleet.watch({ id: "a", on: true });
    await flush();
    h.sent.length = 0;
    await h.timers.advance(host.LIMITS.leaseMs + 1);
    await h.fleet.observeStatus(running("run_1", "task_a", h.clock.t));
    await flush();
    assert.equal(h.sent.length, 0);
    h.fleet.watch({ id: "b", on: true });
    await flush();
    assert.equal(h.sent.length, 1);
    assert.deepEqual(h.fleet.watch({ id: "b", on: false }), { ok: true, watching: false });
    await h.timers.advance(1000);
    await h.fleet.observeStatus(running("run_2", "task_b", h.clock.t));
    await flush();
    assert.equal(h.sent.length, 1);
  } finally {
    await h.done();
  }
});

test("a project that is not open is never pushed, and each project keeps its own file", async () => {
  let open = "project_1";
  const h = await harness({ active: (id) => id === open });
  try {
    h.fleet.watch({ on: true });
    await flush();
    h.sent.length = 0;
    h.switchTo("project_2");
    await h.timers.advance(1000);
    await h.fleet.observeStatus(running("run_9", "task_z", h.clock.t));
    await flush();
    assert.equal(h.sent.length, 0, "project_2 is not the open project");
    await h.timers.advance(host.LIMITS.saveDelayMs);
    await h.fleet.flush();
    const other = JSON.parse(await readFile(path.join(h.root, "project_2", "fleet.json"), "utf8"));
    assert.deepEqual(Object.keys(other.seats), ["builder-1"]);
    open = "project_2";
    h.fleet.watch({ on: true });
    await flush();
    assert.equal(h.sent.at(-1).payload.projectId, "project_2");
    assert.equal(h.sent.at(-1).payload.project.slug, "other-game");
  } finally {
    await h.done();
  }
});

test("generations are saved and come back after a restart, and a snapshot works before any push", async () => {
  const tasks = [{ id: "task_a", title: "Wire the fleet", status: "active" }];
  const first = await harness({ tasks });
  try {
    await first.fleet.observeStatus(running("run_1", "task_a", T0));
    await first.fleet.observeEvent({ v: 1, kind: "agent.home", at: T0 + 1000, runId: "run_1", taskId: "task_a", ok: true });
    await first.fleet.observeStatus(running("run_2", "task_a", T0 + 2000));
    await first.timers.advance(host.LIMITS.saveDelayMs);
    await first.fleet.flush();
    const saved = JSON.parse(await readFile(path.join(first.root, "project_1", "fleet.json"), "utf8"));
    assert.deepEqual(saved.seats["builder-1"].lineage.map((gen) => [gen.gen, gen.runId]), [[1, "run_1"], [2, "run_2"]]);

    const second = host.createFleetHost({
      dataFile: (name) => path.join(first.root, "project_1", name),
      projectId: () => "project_1",
      projectName: () => "Mefi Studio",
      now: () => T0 + 60_000,
      status: () => ({ parallel: 1, loop: { state: "idle", on: true, ready: 0 }, running: [] }),
      readTasks: async () => tasks,
    });
    const view = await second.snapshot();
    const builder = builderOf(view);
    assert.equal(builder.gen, 2);
    assert.equal(builder.status, "idle");
    assert.deepEqual(builder.last, { gen: 2, taskId: "task_a", runId: "run_2", title: "Work on task_a", outcome: "lost", endedAt: null });
    const detail = await second.seat({ seatId: "builder-1" });
    assert.deepEqual(detail.lineage.map((gen) => [gen.gen, gen.outcome]), [[2, "lost"], [1, "awaiting"]]);
  } finally {
    await first.done();
  }
});

test("a seat button acts on the run it holds, or its last one", async () => {
  const h = await harness();
  try {
    await h.fleet.observeStatus(running("run_1", "task_a", T0));
    assert.deepEqual(await h.fleet.action({ seatId: "builder-1", action: "stop" }), { ok: true, action: "stop", taskId: "task_a", runId: "run_1" });
    await h.fleet.observeEvent({ v: 1, kind: "agent.home", at: T0 + 1000, runId: "run_1", taskId: "task_a", ok: false });
    assert.deepEqual(await h.fleet.action({ seatId: "builder-1", action: "stop" }), { ok: false, error: "That seat is not running anything." });
    assert.deepEqual(await h.fleet.action({ seatId: "builder-1", action: "open-log" }), { ok: true, action: "open-log", taskId: "task_a", runId: "run_1" });
    assert.equal((await h.fleet.action({ seatId: "nobody", action: "stop" })).ok, false);
    assert.equal((await h.fleet.action({ seatId: "builder-1", action: "format-disk" })).ok, false);
  } finally {
    await h.done();
  }
});

test("hooks never throw into the caller, whatever they are given", async () => {
  const h = await harness();
  try {
    for (const bad of [null, undefined, 42, "text", [], { kind: "agent.out" }, { kind: "agent.out", at: "soon" }]) {
      await h.fleet.observeEvent(bad);
      await h.fleet.observeStatus(bad);
      await h.fleet.observeTasks(bad);
      await h.fleet.observeFinish(bad);
      await h.fleet.observeMerge(bad);
    }
    const view = await h.fleet.snapshot();
    assert.equal(view.ok, true);
    assert.deepEqual(view.recent, []);
  } finally {
    await h.done();
  }
});

test("Stop names the run the owner was looking at, and a seat that moved on is not stopped by mistake", async () => {
  const h = await harness();
  try {
    await h.fleet.observeStatus(running("run_1", "task_a", T0));
    assert.deepEqual(await h.fleet.action({ seatId: "builder-1", action: "stop", runId: "run_1" }), { ok: true, action: "stop", taskId: "task_a", runId: "run_1" }, "the run that was on screen is the one held");
    assert.deepEqual(await h.fleet.action({ seatId: "builder-1", action: "stop", runId: "" }), { ok: true, action: "stop", taskId: "task_a", runId: "run_1" }, "a caller with no run in mind gets the seat's current one");
    const refused = await h.fleet.action({ seatId: "builder-1", action: "stop", runId: "run_0" });
    assert.equal(refused.ok, false);
    assert.match(refused.error, /moved on to another run/);
    await h.fleet.observeEvent({ v: 1, kind: "agent.home", at: T0 + 1000, runId: "run_1", taskId: "task_a", ok: true });
    await h.fleet.observeStatus(running("run_2", "task_b", T0 + 2000));
    assert.equal((await h.fleet.action({ seatId: "builder-1", action: "stop", runId: "run_1" })).ok, false, "the seat took another task after the click was armed");
  } finally {
    await h.done();
  }
});
