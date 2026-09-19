import test from "node:test";
import assert from "node:assert/strict";
import { createJevQueue, planIntake } from "../scripts/jev-loop.mjs";

const request = (title, source = "test") => ({ title, source, status: "open" });

test("intake never spends a call comparing a request to itself or its admission batch", () => {
  const additions = [request("fix startup loading"), request("fix startup rendering")];
  assert.equal(planIntake(additions, { requests: additions }).questions.length, 0);
  const plan = planIntake(additions, { requests: additions, tasks: [request("fix startup loading")] });
  assert.equal(plan.comparisons[0].hit.item.kind, "task");
  assert.equal(plan.comparisons[0].hit.item.title, additions[0].title);
});

test("intake ignores removed admissions and closed work; carries real remaining obligations", () => {
  const item = request("fix startup loading");
  assert.equal(planIntake([item], { tasks: [item] }).questions.length, 0);
  assert.equal(planIntake([item], { requests: [item], tasks: [{ ...item, status: "done" }] }).questions.length, 0);
  const plan = planIntake([item], { requests: [item], tasks: [{ ...item, status: "running", remaining: ["verify cold startup"] }] });
  assert.match(plan.questions[0].prompt, /verify cold startup/);
  assert.match(plan.questions[0].prompt, /status: running/);
});

function fixture(runBatch, options = {}) {
  let time = 1000;
  const timers = new Map();
  let id = 0;
  const queue = createJevQueue({ runBatch, minIntervalMs: 100, backoffMs: 1000,
    now: () => time, setTimer: (fn, ms) => { timers.set(++id, { fn, ms }); return id; },
    clearTimer: (key) => timers.delete(key), ...options });
  return { queue, timers, advance: (ms) => { time += ms; } };
}

test("arrivals during a call and cooldown are retained, batched once, and never overlap", async () => {
  let release;
  const calls = [];
  const { queue, advance } = fixture(async (items) => {
    calls.push(items.map((item) => item.title));
    if (calls.length === 1) await new Promise((resolve) => { release = resolve; });
    return { ok: true, attempted: true, proposals: items.length };
  }, { maxBatch: 2 });
  queue.enqueue([request("first load"), request("second load")]);
  const first = queue.flush();
  await Promise.resolve();
  queue.enqueue([request("third load")]);
  assert.equal(queue.flush(), first);
  assert.equal(calls.length, 1);
  release(); await first;
  assert.equal(queue.status().pending, 1);
  await queue.flush(); assert.equal(calls.length, 1);
  advance(100); await queue.flush();
  assert.deepEqual(calls, [["first load", "second load"], ["third load"]]);
  assert.equal(queue.status().proposals, 3);
  assert.equal(queue.status().pending, 0);
  queue.stop();
});

test("missing configuration retains work without using rate budget; save can wake it", async () => {
  let configured = false;
  const { queue } = fixture(async () => configured ? { ok: true, attempted: true } : { ok: true, defer: true, reason: "no-key" });
  queue.enqueue([request("startup loading")]); await queue.flush();
  assert.equal(queue.status().phase, "no-key");
  assert.equal(queue.status().calls, 0);
  assert.equal(queue.status().pending, 1);
  configured = true; queue.wake(); await queue.flush();
  assert.equal(queue.status().pending, 0);
  assert.equal(queue.status().calls, 1);
  queue.stop();
});

test("failed calls count, retry with backoff, and stop after three attempts", async () => {
  const { queue, advance } = fixture(async () => ({ ok: false, attempted: true, error: "unavailable" }));
  queue.enqueue([request("startup loading")]); await queue.flush();
  assert.equal(queue.status().phase, "retrying");
  advance(100); await queue.flush();
  assert.equal(queue.status().phase, "backoff");
  advance(100); await queue.flush();
  assert.equal(queue.status().calls, 2);
  advance(900); await queue.flush();
  assert.equal(queue.status().calls, 3);
  assert.equal(queue.status().pending, 0);
  assert.equal(queue.status().skipped, 1);
  queue.stop();
});

test("configuration changes during a stale call wake pending work after it settles", async () => {
  let release, calls = 0;
  const { queue } = fixture(async () => {
    calls += 1;
    if (calls === 1) return new Promise((resolve) => { release = resolve; });
    return { ok: true, attempted: true };
  });
  queue.enqueue([request("startup loading")]);
  const first = queue.flush(); await Promise.resolve();
  queue.wake(); release({ ok: true, defer: true, reason: "no-key" }); await first;
  await queue.flush();
  assert.equal(calls, 2);
  assert.equal(queue.status().pending, 0);
  queue.stop();
});

test("pending memory is bounded and duplicate enqueue cannot overwrite in-flight work", async () => {
  const { queue } = fixture(async () => ({ ok: true, attempted: false }), { maxPending: 2 });
  queue.enqueue([request("first startup"), request("first startup"), request("second startup"), request("third startup")]);
  assert.equal(queue.status().pending, 2);
  assert.equal(queue.status().skipped, 1);
  await queue.flush(); assert.equal(queue.status().pending, 0);
  queue.stop(); queue.enqueue([request("fourth startup")]);
  assert.equal(queue.status().pending, 0);
});
