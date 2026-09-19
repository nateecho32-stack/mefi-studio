import test from "node:test";
import assert from "node:assert/strict";
import backlog from "../scripts/backlog.cjs";
import { backlogIdeaEligible, compact, exhaustedAttempts, housekeepingSweep, mergeIdeas, normalizeState, promoteIdeaBacklog, tidy } from "../scripts/assistant.mjs";

const HOUR = 3600000;
const now = 100 * HOUR;
const idea = (id, extra = {}) => ({ id, title: `Idea ${id}`, detail: `Requirements for ${id}`, at: 1, status: "new", ...extra });

test("backlog admission handles oldest singleton ideas, keeps full context, and is idempotent", () => {
  const ideas = [idea("new", { at: now }), idea("old", { detail: "x".repeat(1800), foldAttempts: 7, refs: [{ kind: "file", detail: "src/a.js" }], files: ["src/a.js"], projectId: "a" })];
  const input = structuredClone(ideas);
  const result = promoteIdeaBacklog({ ideas, limit: 1, now });
  assert.equal(result.promoted, 1);
  assert.deepEqual(result.tasks[0].ideas, ["old"]);
  assert.ok(result.tasks[0].prompt.includes("x".repeat(1800)));
  assert.deepEqual(result.tasks[0].refs, ideas[1].refs);
  assert.deepEqual(result.tasks[0].files, ["src/a.js"]);
  assert.equal(result.tasks[0].projectId, "a");
  assert.equal(result.ideas.find((row) => row.id === "old").taskId, result.tasks[0].id);
  assert.deepEqual(ideas, input);
  const next = promoteIdeaBacklog({ ...result, now });
  assert.equal(next.promoted, 1);
  assert.equal(new Set(next.tasks.map((row) => row.id)).size, 2, "same-clock passes cannot reuse an id");
  assert.equal(promoteIdeaBacklog({ ...next, now }).changed, false);
});

test("admission separates captured chat from kept ideas and honors explicit selection", () => {
  const chat = idea("chat", { source: "chat" });
  assert.equal(backlogIdeaEligible(chat), false);
  assert.equal(backlogIdeaEligible({ ...chat, status: "keep" }), true);
  const saved = [chat, idea("kept", { status: "keep" }), idea("done", { status: "done" }), idea("linked", { taskId: "task" })];
  assert.deepEqual(promoteIdeaBacklog({ ideas: saved, now }).tasks.map((row) => row.ideas[0]), ["kept"]);
  assert.deepEqual(promoteIdeaBacklog({ ideas: saved, ideaIds: ["chat"], now }).tasks.map((row) => row.ideas[0]), ["chat"]);
  assert.equal(promoteIdeaBacklog({ ideas: saved, limit: 0, now }).promoted, 0);
  const legacy = idea("accepted", { status: "accepted" });
  assert.equal(backlogIdeaEligible(legacy), false, "legacy acceptance does not authorize automatic duplicate work");
  assert.equal(promoteIdeaBacklog({ ideas: [legacy], ideaIds: [legacy.id], now }).promoted, 1, "an explicit action can recover a legacy idea without a task link");
});

test("existing obligation links and identical task bodies prevent duplicate dispatch", () => {
  const saved = idea("one");
  const tasks = [{ id: "existing", title: saved.title, prompt: saved.detail, status: "open", ideas: [] }];
  const out = promoteIdeaBacklog({ tasks, ideas: [saved], now });
  assert.equal(out.tasks.length, 1);
  assert.equal(out.ideas[0].taskId, "existing");
  assert.deepEqual(out.tasks[0].ideas, ["one"]);
  const sameTitle = promoteIdeaBacklog({ tasks, ideas: [{ ...saved, detail: "A different obligation" }], now });
  assert.equal(sameTitle.tasks.length, 2);
  assert.equal(compact({ ...sameTitle, now }).tasks.length, 2, "title-only compaction cannot erase different requirements");
});

test("waiting grouped plans remain durable and backlog mode suppresses unbounded fold admission", () => {
  const ideas = [idea("a", { tags: ["one"] }), idea("b", { tags: ["one"] }), idea("c", { tags: ["one"] })];
  assert.equal(compact({ ideas, now, promoteIdeas: false }).tasks.length, 0);
  const grouped = compact({ ideas, now });
  assert.equal(grouped.tasks.length, 1, "old ideas remain eligible");
  const later = compact({ tasks: grouped.tasks, ideas: grouped.ideas, now: now + 900 * HOUR });
  assert.deepEqual(later.tasks, grouped.tasks);
  assert.equal(later.report.plansDropped, 0);
});

test("same-title notes with distinct requirements survive compaction and grouped prompts retain their full bodies", () => {
  const details = ["a".repeat(1000), "b".repeat(1000), "c".repeat(1000)];
  const ideas = details.map((detail, index) => idea(String(index), { title: "Shared title", detail, tags: ["theme"] }));
  const result = compact({ ideas, now });
  assert.equal(result.ideas.length, 3);
  assert.equal(result.tasks.length, 1);
  for (const detail of details) assert.ok(result.tasks[0].prompt.includes(detail));
});

test("large saved idea inboxes and accepted history survive scans and tidy", () => {
  const saved = Array.from({ length: 450 }, (_, index) => idea(String(index)));
  saved.push(idea("accepted", { status: "accepted" }), idea("done", { status: "done" }));
  const merged = mergeIdeas(saved, [idea("fresh")], { cap: 4 });
  assert.equal(merged.ideas.length, 453);
  const result = tidy({ ideas: merged.ideas, now });
  assert.deepEqual(result.ideas, merged.ideas);
  assert.equal(result.report.ideasPruned, 0);
});

test("housekeeping keeps large task backlogs and distinct completed attempts", () => {
  const tasks = Array.from({ length: 40 }, (_, index) => ({ id: String(index), title: `Work ${index}`, status: "open", source: "a-eyes", createdAt: 1 }));
  tasks.push({ id: "done-a", title: "Repeatable", status: "done", updatedAt: 1, lastAttempt: { runId: "run-a" } }, { id: "done-b", title: "Repeatable", status: "archived", updatedAt: 2, lastAttempt: { runId: "run-b" } }, { id: "open", title: "Repeatable", status: "open" });
  const before = structuredClone(tasks);
  const result = housekeepingSweep({ tasks, now });
  assert.equal(result.tasks.length, tasks.length);
  assert.equal(result.tasks.find((row) => row.id === "done-a").status, "archived");
  assert.equal(result.tasks.find((row) => row.id === "done-a").lastAttempt.runId, "run-a");
  assert.deepEqual(tasks, before);
});

test("compaction and keeper retain operator requests and overflow work", () => {
  const requests = Array.from({ length: 240 }, (_, index) => ({ title: `Owner ${index}`, prompt: `Request ${index}`, source: "chat", at: 1 }));
  assert.equal(compact({ requests, now, limits: { keepRequests: 2 } }).requests.length, 240);
  assert.equal(tidy({ requests, now }).requests.length, 240);
  const tasks = Array.from({ length: 30 }, (_, index) => ({ id: `chore-${index}`, title: `Overseer: task ${index}`, status: "open", createdAt: 1 }));
  assert.equal(compact({ tasks, now, limits: { maxSelfMaintenance: 2 } }).tasks.length, 30);
});

test("failed attempts require explicit retry instead of silently reviving on a timer", () => {
  const blocked = [{ id: "run", title: "Run failures", status: "open", runFailures: 5, updatedAt: 1, nextRunAt: 2 }, { id: "verify", title: "Verification failures", status: "open", verifyAttempts: 3 }, { id: "failed", title: "Failed verification", status: "open", verification: { state: "failed" } }];
  assert.ok(blocked.every((row) => exhaustedAttempts(row)));
  const result = compact({ tasks: blocked, now });
  assert.deepEqual(result.tasks, blocked);
  assert.equal(result.report.revived, 0);
  assert.equal(result.report.runnable, 0);
  assert.equal(normalizeState({ prefs: { backlogMode: true } }, now).prefs.backlogMode, true);
});

test("dependency sources and targets survive title/theme dedupe and automatic grouping", () => {
  const tasks = [
    { id: "required", title: "Project registry", status: "open", updatedAt: 1 },
    { id: "richer", title: "Project registry", status: "open", updatedAt: 9, logs: [{ text: "newer" }] },
    { id: "waiting", title: "Build picker", status: "open", dependsOn: ["required"] },
    { id: "other", title: "Picker implementation", status: "open" },
    { id: "fix-a", title: "Fix: Duplicate task view", source: "fix", status: "open", problemFiles: ["view.js"] },
    { id: "fix-b", title: "Fix: Collision task view", source: "fix", status: "open", problemFiles: ["view.js"], dependsOn: ["fix-a"] },
  ];
  const result = compact({ tasks, now, taskGroups: [{ title: "Picker", tasks: ["Build picker", "Picker implementation"] }] });
  for (const id of ["required", "waiting", "fix-a", "fix-b"]) assert.ok(result.tasks.some((row) => row.id === id), `${id} survives`);
  assert.deepEqual(result.tasks.find((row) => row.id === "waiting").dependsOn, ["required"]);
  assert.equal(result.tasks.find((row) => row.id === "waiting").status, "open");
  const swept = housekeepingSweep({ tasks: result.tasks, now });
  assert.ok(swept.tasks.some((row) => row.id === "required"));
  assert.deepEqual(swept.tasks.find((row) => row.id === "waiting").dependsOn, ["required"]);
});

test("completed grouping members retain provenance for dependent work", () => {
  const plan = { id: "plan", title: "Plan", status: "done", doneAt: now - 1, updatedAt: now, verification: { state: "verified", reason: "Checks passed" } };
  const member = { id: "member", title: "Member", status: "absorbed", absorbedInto: "plan" };
  const result = housekeepingSweep({ tasks: [plan, member], now });
  const completed = result.tasks.find((row) => row.id === "member");
  assert.equal(completed.status, "archived");
  assert.equal(completed.doneAt, now - 1);
  assert.equal(completed.completionFromTaskId, "plan");
  assert.equal(completed.verification.inheritedFromTaskId, "plan");
});

test("archiving a known legacy completion cannot reblock its dependent tasks", () => {
  const completed = { id: "completed", title: "Legacy completion", status: "done", updatedAt: 1 };
  const dependent = { id: "dependent", title: "Next step", status: "open", dependsOn: ["completed"] };
  const tasks = [completed, dependent];
  assert.equal(backlog.workState(dependent, now, { tasks }).stage, "ready");
  for (const result of [tidy({ tasks, now }), housekeepingSweep({ tasks, now })]) {
    const archived = result.tasks.find((task) => task.id === completed.id);
    assert.equal(archived.status, "archived");
    assert.equal(archived.doneAt, 1);
    assert.equal(backlog.workState(dependent, now, { tasks: result.tasks }).stage, "ready");
  }
});
