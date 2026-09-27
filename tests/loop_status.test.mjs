import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { loopStatus } = require("../scripts/loop-status.cjs");

const NOW = Date.UTC(2026, 8, 27, 12, 0, 0);
const base = { now: NOW, project: true, held: false, assistantPaused: false, execute: true, parkedUntil: 0, running: 0, counts: { ready: 0, approval: 0, blocked: 0 }, level: "auto", aiConnected: true };
const status = (patch = {}) => loopStatus({ ...base, ...patch, counts: { ...base.counts, ...(patch.counts ?? {}) } });

test("the first gate a person would fix wins, and every stop names its one control", () => {
  const cases = [
    [{ project: false, held: true }, "no-project", "open-project"],
    [{ held: true, assistantPaused: true, counts: { ready: 2 } }, "held", "start"],
    [{ assistantPaused: true }, "paused", "start"],
    [{ execute: false }, "paused", "start"],
    [{ execute: false, parkedUntil: NOW + 60000, lastError: "opencode exited 1" }, "parked", "start"],
    [{ updateHold: "Studio update waiting for current builds to finish" }, "draining", null],
    [{ foremanStuck: true, counts: { ready: 3 } }, "stuck", "restart"],
    [{ running: 2, counts: { ready: 1 } }, "running", null],
    [{ counts: { ready: 2 }, waiting: "machine busy" }, "waiting", null],
    [{ counts: { ready: 1 } }, "starting", null],
    [{ counts: { approval: 3 } }, "approval", "review"],
    [{ counts: { blocked: 1 } }, "attention", "review"],
    [{ aiConnected: false }, "setup", "connect-ai"],
    [{}, "idle", null],
  ];
  for (const [patch, state, action] of cases) {
    const result = status(patch);
    assert.equal(result.state, state, JSON.stringify(patch));
    assert.equal(result.action?.id ?? null, action, JSON.stringify(patch));
    assert.ok(result.headline && typeof result.reason === "string", JSON.stringify(patch));
  }
});

test("the Agents switch reads off only for the launch hold and the owner's pause or stop", () => {
  assert.equal(status({ held: true }).on, false);
  assert.equal(status({ assistantPaused: true }).on, false);
  assert.equal(status({ execute: false }).on, false);
  // A breaker cooldown is not the owner turning agents off.
  assert.equal(status({ execute: false, parkedUntil: NOW + 1 }).on, true);
  // Nor is a park whose cooldown already passed: the next fill re-arms it, so
  // it reads as a plain stop only while execute is still false and not parked.
  assert.equal(status({ execute: false, parkedUntil: NOW - 1 }).state, "paused");
  for (const patch of [{ updateHold: "draining" }, { foremanStuck: true }, { running: 1 }, {}]) assert.equal(status(patch).on, true, JSON.stringify(patch));
});

test("approval waits say which permission mode holds them", () => {
  assert.match(status({ level: "ask", counts: { approval: 1 } }).reason, /Always ask.*yours too/);
  assert.match(status({ level: "accept", counts: { approval: 2 } }).reason, /Accept per task/);
  assert.match(status({ level: "elevated", counts: { approval: 1 } }).reason, /agents propose/);
  assert.equal(status({ counts: { approval: 1 } }).headline, "1 task needs your OK");
  assert.equal(status({ counts: { approval: 2 } }).headline, "2 tasks need your OK");
  // Idle says what will happen to the next task.
  assert.match(status({ level: "ask" }).reason, /wait for your OK/);
  assert.match(status({ level: "auto" }).reason, /start on their own/);
});

test("running work mentions what else is waiting, and wait reasons are trimmed", () => {
  assert.equal(status({ running: 1 }).headline, "1 agent working");
  assert.equal(status({ running: 1 }).reason, "");
  assert.match(status({ running: 2, counts: { ready: 1 }, waiting: "Manual worker limit reached (2/2)" }).reason, /1 more task waiting: Manual worker limit/);
  const long = status({ counts: { ready: 1 }, waiting: `machine busy ${"x".repeat(400)}` });
  assert.ok(long.reason.length <= 240);
  // An object reason (a cluster wait) reads by its text.
  assert.equal(status({ counts: { ready: 1 }, waiting: { text: "Cluster is focused on one task" } }).reason, "Cluster is focused on one task");
  // A held launch counts queued work so the owner knows what is waiting.
  assert.match(status({ held: true, counts: { ready: 1, approval: 1 } }).reason, /2 tasks will wait/);
});

test("the cooldown names when starts resume and the last error", () => {
  const result = status({ execute: false, parkedUntil: NOW + 600000, lastError: "spawn opencode ENOENT" });
  assert.match(result.reason, /wait until \d\d:\d\d/);
  assert.match(result.reason, /spawn opencode ENOENT/);
});

test("the backlog summary leads with a loop that holds every card", () => {
  const backlog = require("../scripts/backlog.cjs");
  const tasks = [{ id: "a", title: "Build a", prompt: "a", status: "open", createdAt: 1 }];
  // Without the loop a launch hold read "1 ready to work on" while nothing could start.
  assert.equal(backlog.summarizeBacklog({ tasks }).summary, "1 ready to work on");
  const held = status({ held: true, counts: { ready: 1 } });
  const summary = backlog.summarizeBacklog({ tasks, loop: held });
  assert.match(summary.summary, /^Agents are off\. Studio opened with agents off/);
  assert.equal(summary.waiting, summary.summary);
  // A loop that is merely working or waiting leaves the card-level summary alone.
  assert.equal(backlog.summarizeBacklog({ tasks, loop: status({ counts: { ready: 1 } }) }).summary, "1 ready to work on");
});

test("a ready card that shares a running worker's title says it waits for that worker", () => {
  const backlog = require("../scripts/backlog.cjs");
  const tasks = [
    { id: "live", title: "Fix the settings page", prompt: "a", status: "active", createdAt: 1 },
    { id: "twin", title: "Fix the settings page", prompt: "b", status: "open", createdAt: 2 },
    { id: "other", title: "Add a dark theme", prompt: "c", status: "open", createdAt: 3 },
  ];
  const jobs = [{ taskId: "live", title: "Fix the settings page" }, { taskId: "gone", title: "Add a dark theme", finished: true }];
  const states = Object.fromEntries(backlog.summarizeBacklog({ tasks, jobs }).taskStates.map((row) => [row.id, row]));
  assert.equal(states.live.stage, "running");
  assert.equal(states.twin.stage, "waiting");
  assert.equal(states.twin.blockedBy, "same-work");
  assert.match(states.twin.reason, /running worker on "Fix the settings page"/);
  // A finished job holds nothing.
  assert.equal(states.other.stage, "ready");
});

test("bad input never throws and falls back to a safe answer", () => {
  assert.equal(loopStatus().state, "idle");
  assert.equal(loopStatus({ counts: null, running: "x", level: "bogus" }).state, "idle");
  assert.equal(loopStatus({ counts: { ready: -4 } }).ready, 0);
});
