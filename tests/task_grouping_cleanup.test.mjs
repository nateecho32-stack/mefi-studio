import test from "node:test";
import assert from "node:assert/strict";
import { compact, taskObligationKey, tidy } from "../scripts/assistant.mjs";

const now = 1_000_000_000;
const task = (id, title, extra = {}) => ({ id, title, prompt: title, status: "open", createdAt: 1, ...extra });
const group = (tasks, names = tasks.map((row) => row.title), limits = {}) => compact({ tasks, now, taskGroups: [{ title: "Related release work", tasks: names }], limits });

test("AI grouping counts unique member IDs, preserves input order and rejects repeated singleton names", () => {
  const a = task("a", "First obligation"), b = task("b", "Second obligation");
  assert.equal(group([a], [a.title, a.title, a.title]).tasks.length, 1);
  const result = group([a, b], [b.title, b.title, a.title, b.title]);
  const parent = result.tasks.find((row) => row.members);
  assert.deepEqual(parent.members.map((row) => row.id), ["b", "a"]);
  assert.equal(result.report.taskPlanned, 2);
});

test("grouping cannot bypass failed verification, retry budgets, live leases or cooldown", () => {
  for (const held of [{ runFailures: 5 }, { runFailures: 1 }, { verifyAttempts: 1 }, { verification: { state: "failed" } }, { nextRunAt: now + 1 }, { lease: { pid: 222, at: now } }]) {
    const blocked = task("blocked", "Blocked obligation", held), ready = task("ready", "Ready obligation");
    const result = group([blocked, ready]);
    assert.equal(result.tasks.some((row) => row.members), false, JSON.stringify(held));
    assert.deepEqual(result.tasks.find((row) => row.id === "blocked"), blocked);
  }
});

test("same display title with different prompt, acceptance or file scope survives cleanup and title-only grouping stays ambiguous", () => {
  const rows = [task("one", "Export results", { prompt: "Export CSV" }), task("two", "Export results", { prompt: "Export JSON" }), task("three", "Export results", { prompt: "Export JSON", acceptance: ["Preserve Unicode"] }), task("four", "Export results", { prompt: "Export JSON", files: ["other.js"] })];
  const result = compact({ tasks: rows, now });
  assert.deepEqual(result.tasks, rows);
  const grouped = group([...rows, task("other", "Build toolbar")], ["Export results", "Build toolbar"]);
  assert.equal(grouped.tasks.some((row) => row.members), false);
  assert.equal(grouped.tasks.length, 5);
  assert.equal(taskObligationKey(task("same", "Simple action!")), taskObligationKey(task("same2", "simple action")));
  assert.equal(taskObligationKey(rows[0]), taskObligationKey({ ...rows[0], id: "another", logs: [{ text: "Provenance" }], runId: "held" }));
});

test("dissolving a group recovers durable handoffs and history without duplicating a separately restored member ID", () => {
  const a = task("a", "First obligation", { handoff: "Continue from saved context", handoffId: "handoff-one", fromRun: "run-one", parentTaskId: "previous", originalTitle: "Original obligation", logs: [{ at: 1, text: "Original work" }], lastAttempt: { result: "Earlier evidence" } });
  const b = task("b", "Second obligation");
  // Older versions could group handoffs. New admissions stay protected, but
  // dissolving an already saved group must still restore its full lineage.
  const { handoffId, fromRun, ...beforeLineage } = a;
  const result = group([beforeLineage, b]);
  const parent = result.tasks.find((row) => row.members);
  Object.assign(parent.members[0], { handoffId, fromRun });
  assert.equal(parent.members[0].handoff, a.handoff);
  const separatelyRestored = { ...b, prompt: "Preserve current operator edits" };
  const dissolved = compact({ tasks: [parent, separatelyRestored], now: now + 100_000, limits: { stalePlanHours: 0 } });
  assert.equal(dissolved.tasks.filter((row) => row.id === "b").length, 1);
  assert.equal(dissolved.tasks.find((row) => row.id === "b").prompt, separatelyRestored.prompt);
  const restored = dissolved.tasks.find((row) => row.id === "a");
  assert.equal(restored.handoff, a.handoff);
  for (const key of ["handoffId", "fromRun", "parentTaskId", "originalTitle"]) assert.equal(restored[key], a[key]);
  assert.equal(restored.lastAttempt.result, "Earlier evidence");
  assert.ok(restored.logs.some((entry) => entry.text === "Original work"));
});

test("admitted handoffs survive title, Fix family, Plan theme and explicit stale-plan compaction", () => {
  const accepted = [
    task("fix-a", "Fix: duplicate sessions", { prompt: "Repair session ownership", handoffId: "follow-a", fromRun: "run-a" }),
    task("fix-b", "Fix: duplicate sessions", { prompt: "Repair session ownership", handoffId: "follow-b", fromRun: "run-b" }),
    task("legacy", "Fix: subsystem overlap", { prompt: "Preserve old lineage without an ID", fromRun: "legacy-run" }),
    task("plan-a", "Plan: release — 2 tasks", { prompt: "Ship preserved scope A", handoffId: "follow-c", fromRun: "run-a" }),
    task("plan-b", "Plan: release — 3 tasks", { prompt: "Ship preserved scope B", handoffId: "follow-d", fromRun: "run-b" }),
  ];
  const claimed = task("claimed", "Fix: duplicate root-cause sessions", { runId: "active-run", status: "active" });
  const result = compact({ tasks: [...accepted, claimed], now, limits: { stalePlanHours: 0 }, taskGroups: [{ title: "Release", tasks: accepted.map((row) => row.title) }] });
  for (const row of accepted) assert.deepEqual(result.tasks.find((candidate) => candidate.id === row.id), row);
  assert.equal(result.report.taskPlanned, 0);
});

test("unpromoted handoffs bypass broad title/theme, collision and age cleanup", () => {
  const requests = [
    { title: "Fix: duplicate sessions", prompt: "First accepted remaining obligation", source: "fix", at: 1, handoffId: "one", fromRun: "run-one" },
    { title: "Fix: duplicate sessions", prompt: "Different accepted remaining obligation", source: "fix", at: 1, handoffId: "two", fromRun: "run-two" },
    { title: "Fix: subsystem overlap", source: "collision", sessions: ["a", "b"], file: "same.js", at: 1, handoffId: "three", fromRun: "run-three" },
    { title: "Fix: subsystem overlap", source: "collision", sessions: ["a", "b"], file: "same.js", at: 1, handoffId: "four", fromRun: "run-four" },
    { title: "Fix: duplicate sessions", source: "audit", at: 1, fromRun: "legacy-run" },
  ];
  const result = compact({ requests, tasks: [task("generic", requests[0].title, { status: "done" })], collisions: [], now });
  assert.deepEqual(result.requests, requests);
  const cleaned = tidy({ tasks: [], ideas: [], requests, checkpoints: {}, collisions: [], audit: { findings: [] }, now });
  assert.deepEqual(cleaned.requests, requests, "tidy cannot interpret accepted handoffs as stale auto-filed alerts");
});

test("handoff request absorption requires exact lineage on a durable task or preserved member snapshot", () => {
  const request = (handoffId, fromRun) => ({ title: "Fix: duplicate sessions", prompt: "Remaining work", handoffId, fromRun, source: "fix", at: 1 });
  const requests = [request("archived", "old-run"), request("saved", "group-run"), request("archived", "new-run"), request("saved", "wrong-run"), request("only-id", undefined)];
  const tasks = [
    task("history", "Renamed completed handoff", { status: "archived", handoffId: "archived", fromRun: "old-run" }),
    task("group", "Completed group", { status: "done", members: [{ id: "missing-row", title: "Original handoff", handoffId: "saved", fromRun: "group-run" }] }),
    task("partial", "Partial lineage", { status: "done", handoffId: "only-id" }),
  ];
  const result = compact({ tasks, requests, now });
  assert.deepEqual(result.requests, requests.slice(2));
  assert.equal(result.report.absorbed, 2);
});
