import test from "node:test";
import assert from "node:assert/strict";
import { compact, groupTasks, housekeepingSweep, taskObligationKey, tidy } from "../scripts/assistant.mjs";

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

test("interrupted requests retain saved progress through all automatic cleanup paths", () => {
  const saved = { pending: true, runId: "interrupted", sessionId: "saved-session", outputTail: ["half completed"] };
  const requests = [
    { title: "Fix: duplicate sessions", prompt: "Finish audit repair", source: "audit", at: 1, runProgress: saved },
    { title: "Fix: subsystem overlap", prompt: "Finish the collision repair", source: "collision", sessions: ["a", "b"], file: "same.js", at: 1, runProgress: saved },
  ];
  const board = [task("done", requests[0].title, { status: "done" })];
  assert.deepEqual(housekeepingSweep({ requests, tasks: board, now }).requests, requests);
  assert.deepEqual(compact({ requests, tasks: board, collisions: [], now }).requests, requests);
  assert.deepEqual(tidy({ requests, tasks: board, collisions: [], audit: { findings: [] }, now }).requests, requests);
});

test("saved interrupted tasks survive duplicates, group expiry and grouping until they resume", () => {
  const saved = { pending: true, runId: "interrupted", sessionId: "saved-session" };
  const resumed = task("resume", "Finish export", { runProgress: saved });
  const duplicate = task("duplicate", resumed.title, { updatedAt: now });
  const peer = task("peer", "Finish layout");
  const plan = task("task_plan_resume", "Plan: release — 2 tasks", { runProgress: saved });
  const rows = [resumed, duplicate, peer, plan];
  assert.deepEqual(housekeepingSweep({ tasks: rows, now }).tasks.find((row) => row.id === resumed.id), resumed);
  const cleaned = compact({ tasks: rows, now, limits: { stalePlanHours: 0 } });
  assert.deepEqual(cleaned.tasks.find((row) => row.id === resumed.id), resumed);
  assert.deepEqual(cleaned.tasks.find((row) => row.id === plan.id), plan);
  const grouped = groupTasks({ tasks: [resumed, peer], groups: [{ title: "Release", tasks: [resumed.title, peer.title] }], now });
  assert.equal(grouped.absorbed, 0);
  assert.deepEqual(grouped.tasks, [resumed, peer]);
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

test("grouping delivers complete briefs and separate acceptance fields to the builder and restores them", () => {
  const first = task("first", `${"Long task title ".repeat(8)}with final title requirement`, {
    prompt: `${"Preserve all requested behavior. ".repeat(40)}FINAL PROMPT ACCEPTANCE: keep Unicode exports.`,
    description: "Support the saved release workflow",
    acceptance: ["Every exported row must retain its original ID"],
    acceptanceCriteria: { finalCheck: "Validate trailing empty cells" },
    requirements: ["Preserve timezone offsets"],
    constraints: ["No external account"],
    scope: { exclude: "Cloud sync" },
    remaining: ["Check exported nested tasks"],
    context: "The existing consumer reads a versioned file",
    notes: ["Do not alter the saved source data"],
    projectId: "studio", projectPath: "C:/work/studio",
    futureScopeField: { accepted: ["A requirement added by a newer task writer"] },
  });
  const second = task("second", "Add export menu", { projectId: "studio", projectPath: "C:/work/studio" });
  const saved = structuredClone(first);
  const result = group([first, second]);
  const parent = result.tasks.find((row) => row.members);
  assert.ok(parent.prompt.includes(first.title));
  assert.ok(parent.prompt.includes(first.prompt));
  for (const key of ["description", "context", "projectId", "projectPath"]) assert.ok(parent.prompt.includes(first[key]), key);
  for (const text of ["Every exported row", "Validate trailing empty cells", "Preserve timezone offsets", "No external account", "Cloud sync", "Check exported nested tasks", "Do not alter the saved source data"]) assert.ok(parent.prompt.includes(text), text);
  assert.doesNotMatch(parent.prompt, /do the ones that still make sense|say why you skipped/i);
  assert.deepEqual(first, saved, "grouping is pure");
  first.acceptance.push("A later source edit");
  assert.deepEqual(parent.members[0].acceptance, saved.acceptance, "snapshot is detached from mutable caller data");
  const restored = compact({ tasks: [parent], now: now + 100_000, limits: { stalePlanHours: 0 } }).tasks.find((row) => row.id === "first");
  for (const key of ["acceptance", "acceptanceCriteria", "requirements", "constraints", "scope", "remaining", "context", "notes", "projectId", "projectPath", "futureScopeField"]) assert.deepEqual(restored[key], saved[key], key);
});

test("a grouped task carries unioned references and file claims plus the strongest priority and existing pin", () => {
  const ref = { kind: "file", file: "shared.js", detail: "Keep the shared check" };
  const first = task("first", "Export task details", { file: "export.js", files: ["shared.js"], refs: [ref], priority: 1, projectId: "studio", projectPath: "C:/work/studio" });
  const second = task("second", "Export acceptance checks", { files: ["shared.js"], problemFiles: ["checks.js"], refs: [ref, { kind: "url", url: "https://example.test/spec" }], priority: 4, workPin: true, pinnedAt: 77, projectId: "studio", projectPath: "C:/work/studio" });
  const parent = group([first, second]).tasks.find((row) => row.members);
  assert.deepEqual(parent.files, ["export.js", "shared.js", "checks.js"]);
  assert.deepEqual(parent.refs, [ref, second.refs[1]]);
  assert.equal(parent.priority, 4);
  assert.equal(parent.workPin, true);
  assert.equal(parent.pinnedAt, 77);
  assert.equal(parent.projectId, "studio");
  assert.equal(parent.projectPath, "C:/work/studio");
});

test("grouping and same-theme merges respect project boundaries and explicit build approvals", () => {
  const first = task("first", "Export details", { projectId: "one", projectPath: "C:/work/one" });
  for (const scope of [{ projectId: "two", projectPath: "C:/work/two" }, { projectId: "one", projectPath: "C:/work/different" }, {}]) {
    const second = task("second", "Export checks", scope);
    assert.equal(group([first, second]).report.taskPlanned, 0, JSON.stringify(scope));
    const plans = [first, second].map((row, index) => ({ ...row, title: `Plan: exports — ${index + 2} tasks` }));
    assert.deepEqual(compact({ tasks: plans, now }).tasks, plans, "matching themes cannot merge across projects");
  }
  const approved = task("approved", "Approved export", { buildApproval: { scope: "saved-scope", approvedAt: 5 } });
  assert.equal(group([approved, task("other", "Export checks")]).report.taskPlanned, 0);
  const duplicate = { ...approved, id: "copy", buildApproval: undefined, updatedAt: now };
  assert.deepEqual(compact({ tasks: [approved, duplicate], now }).tasks.find((row) => row.id === approved.id), approved, "approval keeps its stable ID");
});

test("merged task groups rebuild every member's full requirements even when related idea records exist", () => {
  const members = [task("one", "First member", { prompt: "first ".repeat(100) + "END ONE", acceptance: ["ACCEPT ONE"] }), task("two", "Second member"), task("three", "Third member", { constraints: ["CONSTRAINT THREE"] }), task("four", "Fourth member")];
  const first = groupTasks({ tasks: members.slice(0, 2), groups: [{ title: "export", tasks: members.slice(0, 2).map((row) => row.title) }], now }).plans[0];
  const second = groupTasks({ tasks: members.slice(2), groups: [{ title: "export", tasks: members.slice(2).map((row) => row.title) }], now: now + 1 }).plans[0];
  first.ideas = ["idea-one"]; second.ideas = ["idea-two"];
  second.refs = [{ kind: "file", file: "merged.js" }]; second.files = ["merged.js"]; second.priority = 5; second.workPin = true;
  const result = compact({ tasks: [first, second], ideas: [{ id: "idea-one", title: "Related idea one", taskId: first.id, status: "planned" }, { id: "idea-two", title: "Related idea two", taskId: second.id, status: "planned" }], now: now + 2 });
  assert.equal(result.tasks.length, 1);
  const parent = result.tasks[0];
  for (const text of ["END ONE", "ACCEPT ONE", "CONSTRAINT THREE", "Related idea one", "Related idea two"]) assert.ok(parent.prompt.includes(text), text);
  assert.equal(parent.members.length, 4);
  assert.deepEqual(parent.files, ["merged.js"]);
  assert.deepEqual(parent.refs, second.refs);
  assert.equal(parent.priority, 5); assert.equal(parent.workPin, true);
});

test("explicit grouping only changes chosen tasks, keeps all ideas and allocates collision-free IDs", () => {
  const tasks = [task(`task_plan_${now.toString(36)}_0`, "Existing old group", { createdAt: 1 }), task("one", "Chosen first"), task("two", "Chosen second"), task("three", "Unrelated duplicate"), task("four", "Unrelated duplicate")];
  const ideas = Array.from({ length: 3 }, (_, index) => ({ id: `idea-${index}`, title: `Ungrouped idea ${index}`, status: "new", tags: ["same"] }));
  const saved = structuredClone({ tasks, ideas });
  const result = groupTasks({ tasks, ideas, groups: [{ title: "Selected work", tasks: ["Chosen first", "Chosen second"] }], now, limits: { stalePlanHours: 0 } });
  assert.equal(result.plans.length, 1); assert.equal(result.absorbed, 2);
  assert.equal(result.tasks.length, tasks.length + 1);
  assert.equal(new Set(result.tasks.map((row) => row.id)).size, result.tasks.length);
  assert.deepEqual(result.ideas, ideas, "explicit grouping never admits unrelated ideas");
  for (const id of [tasks[0].id, "three", "four"]) assert.deepEqual(result.tasks.find((row) => row.id === id), tasks.find((row) => row.id === id));
  assert.deepEqual({ tasks, ideas }, saved);
});

test("grouping and dissolution preserve idea ownership recorded only on the idea", () => {
  const tasks = [task("one", "First accepted task"), task("two", "Second accepted task")];
  const ideas = [{ id: "linked", title: "Accepted idea", status: "planned", taskId: "one" }];
  const grouped = groupTasks({ tasks, ideas, groups: [{ title: "Accepted release work", tasks: tasks.map((row) => row.title) }], now });
  assert.equal(grouped.ideas[0].taskId, grouped.plans[0].id);
  assert.deepEqual(grouped.plans[0].members[0].ideas, ["linked"]);
  const dissolved = compact({ tasks: grouped.plans, ideas: grouped.ideas, now: now + 100_000, limits: { stalePlanHours: 0 } });
  assert.equal(dissolved.ideas[0].taskId, "one");
  assert.equal(dissolved.ideas[0].status, "planned");
  assert.deepEqual(dissolved.tasks.find((row) => row.id === "one").ideas, ["linked"]);
});
