// Behavioral tests for the board invariants — the ones the review called out:
// one identity per piece of work, ownership-fenced settlement, compaction
// that preserves obligations, and a delta-applied idea store. These drive the
// pure module (scripts/assistant.mjs) with fixtures, not source strings.
//
// Run: node --test tests/

import test from "node:test";
import assert from "node:assert/strict";
import {
  compact,
  mergeIdeas,
  isExtractionArtifact,
  housekeepingSweep,
  ownershipFence,
  fixThemeKey,
  planThemeKey,
  compactKey,
  isDoneMarkerLine,
  parseExecutorResult,
  isWedgedStart,
  advanceCursor,
  verifyCompletion,
  VERIFY_MAX_ATTEMPTS,
} from "../scripts/assistant.mjs";
import { requestsFromBriefing } from "../scripts/eyes.mjs";

const HOUR = 3600 * 1000;
const ide = (id, title, detail = "", tags = [], extra = {}) => ({ id, title, detail, tags, status: "new", at: 1, ...extra });
const task = (id, title, extra = {}) => ({
  id,
  title,
  prompt: extra.prompt ?? title,
  status: "open",
  source: "a-eyes",
  createdAt: 1,
  updatedAt: 1,
  ideas: [],
  ...extra,
});

// ---- idea ingestion: validated delta -----------------------------------------

test("mergeIdeas adds only unseen ideas and never touches existing rows", () => {
  const existing = [
    ide("i1", "Fix tar torch descriptions", "tar torch text wrong in catalog", ["catalog"], { status: "planned", taskId: "task_p1", read: true }),
    ide("i2", "Add minimap", "a minimap for navigation", ["world"]),
  ];
  const additions = [
    // verbatim re-scan of the same note
    ide("x1", "Fix tar torch descriptions", "tar torch text wrong in catalog"),
    // paraphrase: same title, different detail wording
    ide("x2", "Fix Tar Torch Descriptions!", "catalog descriptions for the tar torch are wrong"),
    // genuinely new
    ide("x3", "Golf scorecard", "track strokes per hole", ["golf"]),
  ];
  const { ideas, added } = mergeIdeas(existing, additions);
  assert.equal(added, 1);
  assert.equal(ideas.length, 3);
  // the planned stamp survives a late delta application
  assert.equal(ideas[0].status, "new"); // x3 prepended
  const relinked = ideas.find((idea) => idea.id === "i1");
  assert.equal(relinked.status, "planned");
  assert.equal(relinked.taskId, "task_p1");
});

test("mergeIdeas: a stale snapshot cannot revert promotion (the scan race)", () => {
  // The scan read this snapshot...
  const snapshot = [ide("i1", "Catalog audit", "audit catalog entries", ["catalog"])];
  // ...collected the row as an addition...
  const additions = [ide("new", "Catalog audit", "audit catalog entries", ["catalog"], { source: "chat" })];
  // ...the compactor promoted the idea while the AI call was out...
  const latest = [{ ...snapshot[0], status: "planned", taskId: "task_p9", read: true }];
  // ...and the late write must not resurrect the raw note.
  const { ideas, added } = mergeIdeas(latest, additions);
  assert.equal(added, 0);
  assert.equal(ideas.length, 1);
  assert.equal(ideas[0].status, "planned");
  assert.equal(ideas[0].taskId, "task_p9");
});

// ---- compaction: merging membership merges the job ---------------------------

test("same-theme plans merge into one task with every obligation represented", () => {
  const now = Date.now();
  const ideaRows = [
    ide("a", "Tar torch copy pass", "fix tar torch text", ["catalog"], { status: "planned", taskId: "plan_a", read: true }),
    ide("b", "Stick copy pass", "fix stick text", ["catalog"], { status: "planned", taskId: "plan_a", read: true }),
    ide("c", "Catalog integrity check", "contract for catalog", ["catalog"], { status: "planned", taskId: "plan_a", read: true }),
    ide("d", "V5 storey registration", "register storeys", ["catalog"], { status: "planned", taskId: "plan_b", read: true }),
    ide("e", "Storey carve sync", "sync carve", ["catalog"], { status: "planned", taskId: "plan_b", read: true }),
    ide("f", "World smoke for torch", "smoke the torch", ["catalog"], { status: "planned", taskId: "plan_b", read: true }),
  ];
  const plans = [
    task("plan_a", "Plan: catalog — 3 ideas", {
      createdAt: now,
      updatedAt: now,
      prompt: "Work through these catalog ideas the assistant collected.\n1. Tar torch copy pass — fix tar torch text\n2. Stick copy pass — fix stick text\n3. Catalog integrity check — contract for catalog",
      ideas: ["a", "b", "c"],
    }),
    task("plan_b", "Plan: catalog — 6 ideas", {
      createdAt: now,
      updatedAt: now,
      prompt: "Work through these catalog ideas the assistant collected.\n1. V5 storey registration — register storeys\n2. Storey carve sync — sync carve\n3. World smoke for torch — smoke the torch",
      ideas: ["d", "e", "f"],
    }),
  ];
  const out = compact({ requests: [], tasks: plans, ideas: ideaRows, collisions: null, now });
  assert.equal(out.tasks.length, 1, "one surviving plan");
  const winner = out.tasks[0];
  assert.deepEqual([...winner.ideas].sort(), ["a", "b", "c", "d", "e", "f"], "membership unioned");
  // every merged obligation is named in the runnable prompt
  for (const title of ["V5 storey registration", "World smoke for torch"]) {
    assert.ok(winner.prompt.includes(title), `prompt carries merged obligation: ${title}`);
  }
  // references rewired to the survivor — no idea points at a dead plan
  const outIdeas = out.ideas.filter((idea) => ["a", "b", "c", "d", "e", "f"].includes(idea.id));
  for (const idea of outIdeas) {
    assert.equal(idea.taskId, winner.id, `idea ${idea.id} relinked to survivor`);
    assert.equal(idea.status, "planned");
  }
  const survivingIds = new Set(out.tasks.map((item) => item.id));
  assert.ok(out.ideas.every((idea) => !idea.taskId || survivingIds.has(idea.taskId)), "no dangling plan links");
});

test("explicit plan expiration relinks its ideas instead of stranding them", () => {
  const now = Date.now();
  const ideaRows = [
    ide("a", "World smoke for torch", "smoke the torch", ["world"], { status: "planned", taskId: "plan_old", read: true }),
    ide("b", "World smoke pipeline", "pipeline check", ["world"], { status: "planned", taskId: "plan_old", read: true }),
    ide("c", "Interaction smoke for torch", "interactions", ["world"], { status: "planned", taskId: "plan_old", read: true }),
  ];
  const stalePlan = task("plan_old", "Plan: world — 3 ideas", {
    createdAt: now - 24 * HOUR,
    updatedAt: now - 24 * HOUR,
    ideas: ["a", "b", "c"],
  });
  const first = compact({ requests: [], tasks: [stalePlan], ideas: ideaRows, collisions: null, now, limits: { stalePlanHours: 12 } });
  assert.equal(first.report.plansDropped, 1, "stale plan dropped");
  const relinked = first.ideas.filter((idea) => ["a", "b", "c"].includes(idea.id));
  for (const idea of relinked) {
    assert.equal(idea.status, "new", "idea back to visible");
    assert.equal(idea.taskId, undefined, "dead link removed");
    assert.equal(idea.reopenOf, "plan_old", "provenance kept");
    assert.equal(idea.foldAttempts, 1);
  }
  // Second pass: the theme is free and the ideas are recent re-opens, so the
  // work folds into a fresh plan — the observation snapshot was retired, the
  // obligation was not lost.
  const second = compact({ requests: [], tasks: [], ideas: first.ideas, collisions: null, now });
  assert.equal(second.tasks.length, 1, "re-folded into a fresh plan");
  assert.deepEqual([...second.tasks[0].ideas].sort(), ["a", "b", "c"]);
  // Expire that plan too: now the fold cap bites — the notes stay, no plan is
  // minted a third time.
  const expiredAgain = second.tasks[0]; // fresh plan, createdAt = now of pass 2
  const thirdInputNow = now + 13 * HOUR;
  const third = compact({
    requests: [],
    tasks: [{ ...expiredAgain, createdAt: thirdInputNow - 13 * HOUR, updatedAt: thirdInputNow - 13 * HOUR }],
    ideas: second.ideas,
    collisions: null,
    now: thirdInputNow,
    limits: { stalePlanHours: 12 },
  });
  assert.equal(third.report.plansDropped, 1);
  const afterThird = compact({ requests: [], tasks: [], ideas: third.ideas, collisions: null, now: thirdInputNow + HOUR });
  assert.equal(afterThird.tasks.length, 0, "no re-minted plan past the fold cap");
  assert.equal(afterThird.ideas.filter((idea) => ["a", "b", "c"].includes(idea.id) && idea.status === "new").length, 3, "notes remain readable");
});

test("dangling idea links from old passes are repaired on the next pass", () => {
  const now = Date.now();
  const ideaRows = [
    ide("a", "Depths contract", "contract step", ["depths"], { status: "planned", taskId: "task_plan_gone_0", read: true }),
    ide("b", "Depths gate", "gate", ["depths"], { status: "planned", taskId: "task_plan_gone_1", read: true }),
    ide("c", "Depths dashboard", "dashboard", ["depths"], { status: "planned", taskId: "task_plan_gone_0", read: true }),
  ];
  const out = compact({ requests: [], tasks: [], ideas: ideaRows, collisions: null, now });
  assert.equal(out.report.relinked, 3);
  for (const idea of out.ideas) {
    assert.equal(idea.status, "new");
    assert.ok(String(idea.reopenOf ?? "").startsWith("task_plan_gone"), "old plan id kept as provenance");
  }
});

// ---- AI review: task groups fold into plans -----------------------------------

test("the AI review folds related open tasks into one plan and relinks their ideas", () => {
  const now = Date.now();
  const tasks = [
    task("t1", "Session collision queue", { prompt: "queue edits per session so writers cannot clobber each other", ideas: ["i1"] }),
    task("t2", "Collaboration collision queue", { prompt: "one queue for collaborative edits and their owners" }),
    task("t3", "Minimap for the world", { prompt: "draw a minimap" }),
  ];
  const ideas = [ide("i1", "Collision queue", "queue edits", ["collab"], { status: "planned", taskId: "t1", read: true })];
  const out = compact({
    requests: [],
    tasks,
    ideas,
    collisions: null,
    now,
    taskGroups: [{ title: "collision queue", tasks: ["Session collision queue", "Collaboration collision queue"] }],
  });
  const plans = out.tasks.filter((item) => String(item.id).startsWith("task_plan_"));
  assert.equal(plans.length, 1);
  assert.equal(plans[0].title, "Plan: collision queue — 2 tasks");
  assert.match(plans[0].prompt, /Session collision queue/, "every obligation rides in the prompt");
  assert.match(plans[0].prompt, /Collaboration collision queue/);
  assert.deepEqual(plans[0].mergedFrom, ["t1", "t2"]);
  // Grouping never erases accepted work: the members stay on the board as
  // durable absorbed records, and the plan carries a complete snapshot of
  // each obligation so the grouping can be dissolved losslessly.
  const absorbedT1 = out.tasks.find((item) => item.id === "t1");
  const absorbedT2 = out.tasks.find((item) => item.id === "t2");
  assert.ok(absorbedT1 && absorbedT2, "absorbed members stay on the board as records");
  assert.equal(absorbedT1.status, "absorbed");
  assert.equal(absorbedT2.status, "absorbed");
  assert.equal(absorbedT1.absorbedInto, plans[0].id, "each member points at the plan that holds its work");
  assert.equal(absorbedT2.absorbedInto, plans[0].id);
  assert.deepEqual(
    plans[0].members.map((member) => member.id),
    ["t1", "t2"],
    "the plan snapshots every obligation it absorbed",
  );
  assert.equal(plans[0].members[0].prompt, "queue edits per session so writers cannot clobber each other", "the snapshot keeps the full prompt, not the clipped line");
  assert.ok(out.tasks.some((item) => item.id === "t3" && item.status === "open"), "unrelated work stays");
  assert.equal(out.report.taskPlanned, 2);
  assert.deepEqual(out.report.taskPlans, [plans[0].title]);
  const relinked = out.ideas.find((idea) => idea.id === "i1");
  assert.equal(relinked.taskId, plans[0].id, "the member's idea follows it onto the plan");
  assert.equal(relinked.status, "planned");
});

test("claimed members and unknown titles never fold; a singleton group is skipped", () => {
  const now = Date.now();
  const tasks = [
    task("held", "Session collision queue", { runId: "run_1", status: "active" }),
    task("t2", "Collaboration collision queue"),
  ];
  const out = compact({
    requests: [],
    tasks,
    ideas: [],
    collisions: null,
    now,
    taskGroups: [{ title: "queue", tasks: ["Session collision queue", "Collaboration collision queue", "A task that does not exist"] }],
  });
  assert.equal(out.tasks.filter((item) => String(item.id).startsWith("task_plan_")).length, 0, "the held copy breaks the group");
  assert.ok(out.tasks.some((item) => item.id === "held") && out.tasks.some((item) => item.id === "t2"));

  const single = compact({
    requests: [],
    tasks: [task("t1", "Solo work")],
    ideas: [],
    collisions: null,
    now,
    taskGroups: [{ title: "solo", tasks: ["Solo work"] }],
  });
  assert.equal(single.tasks.filter((item) => String(item.id).startsWith("task_plan_")).length, 0, "one task is not a group");
});

test("a theme that already has a plan is not re-minted as a task group", () => {
  const now = Date.now();
  const tasks = [
    task("p1", "Plan: queue — 3 ideas", { createdAt: now, updatedAt: now, ideas: ["x", "y", "z"] }),
    task("t1", "Session collision queue"),
    task("t2", "Collaboration collision queue"),
  ];
  const out = compact({
    requests: [],
    tasks,
    ideas: [],
    collisions: null,
    now,
    taskGroups: [{ title: "queue", tasks: ["Session collision queue", "Collaboration collision queue"] }],
  });
  assert.equal(out.tasks.filter((item) => String(item.id).startsWith("task_plan_")).length, 0, "no second plan is minted for the taken theme");
  assert.ok(out.tasks.some((item) => item.id === "p1") && out.tasks.some((item) => item.id === "t1"), "the members stay put when the theme is taken");
});

test("a task group absorbs at most planTaskCap members", () => {
  const now = Date.now();
  const tasks = [];
  for (let index = 0; index < 10; index++) tasks.push(task(`t${index}`, `Collision queue part ${index}`));
  const out = compact({
    requests: [],
    tasks,
    ideas: [],
    collisions: null,
    now,
    taskGroups: [{ title: "queue", tasks: tasks.map((item) => item.title) }],
  });
  const plans = out.tasks.filter((item) => String(item.id).startsWith("task_plan_"));
  assert.equal(plans.length, 1);
  assert.match(plans[0].title, /8 tasks/);
  assert.equal(out.tasks.filter((item) => item.status === "absorbed").length, 8, "the absorbed members stay on the board as records");
  assert.equal(out.tasks.filter((item) => item.status === "open" && !String(item.id).startsWith("task_plan_")).length, 2, "the overflow stays on the board");
});

test("an explicitly expired task-fold plan relinks its ideas like an idea-fold plan", () => {
  const now = Date.now();
  const old = now - 13 * HOUR;
  const tasks = [
    task("tp", "Plan: queue — 2 tasks", { createdAt: old, updatedAt: old, ideas: ["i1"] }),
    task("fresh", "Fresh work"),
  ];
  const ideas = [ide("i1", "Collision queue", "queue edits", [], { status: "planned", taskId: "tp", read: true })];
  const out = compact({ requests: [], tasks, ideas, collisions: null, now, limits: { stalePlanHours: 12 } });
  assert.ok(!out.tasks.some((item) => item.id === "tp"), "the leftover task plan leaves the board");
  assert.ok(out.tasks.some((item) => item.id === "fresh"));
  assert.equal(out.report.plansDropped, 1);
  const relinked = out.ideas.find((idea) => idea.id === "i1");
  assert.equal(relinked.status, "new", "the idea goes back to visible");
  assert.equal(relinked.taskId, undefined);
});

// ---- fix families: scoped, not global ----------------------------------------

test("fix tickets in one family but aimed at different files stay separate", () => {
  const dupA = { title: "Fix: duplicate sessions", source: "fix", problemFamily: "dup", problemFiles: ["scripts/eyes.mjs"] };
  const dupB = { title: "Fix: duplicate declarations", source: "fix", problemFamily: "dup", problemFiles: ["scripts/auditor.mjs"] };
  assert.notEqual(fixThemeKey(dupA), fixThemeKey(dupB), "same family, different targets: different jobs");
  const dupA2 = { title: "Fix: duplicate root cause", source: "fix", problemFiles: ["scripts/eyes.mjs"] };
  assert.equal(fixThemeKey(dupA), fixThemeKey(dupA2), "same family, same target: one job");
  // fileless tickets share the bare family (nothing to scope on)
  assert.equal(fixThemeKey({ title: "Fix: stalled work", source: "fix" }), "fix:stale");
});

test("the briefing's closing instruction does not give every Fix: brief the duplicate theme", () => {
  const filed = [
    { severity: "warn", title: "stale lock file blocks the updater", detail: "The updater waits on a stale lock.", sessionIds: ["ses_u"] },
    { severity: "warn", title: "Test suite fails on CI", detail: "Three suites time out.", sessionIds: ["ses_t"] },
    { severity: "warn", title: "Duplicate root-cause sessions", detail: "Two sessions chase one bug.", sessionIds: ["ses_x", "ses_y"] },
  ].flatMap((alert) => requestsFromBriefing({ alerts: [alert] }));
  assert.equal(filed.length, 3, "fixture: the briefing files all three");
  assert.ok(filed.every((request) => /Find the root cause, fix it/.test(request.prompt)), "fixture: each brief ends with the instruction");
  assert.deepEqual(filed.map(fixThemeKey), ["fix:stale", null, "fix:dup"], "only the alert itself names the problem");
});

test("compaction collapses only same-target fix tickets", () => {
  const now = Date.now();
  const tickets = [
    task("t1", "Fix: duplicate sessions", { source: "fix", problemFiles: ["scripts/eyes.mjs"] }),
    task("t2", "Fix: overlapping triage", { source: "fix", problemFiles: ["scripts/eyes.mjs"] }),
    task("t3", "Fix: duplicate declarations", { source: "fix", problemFiles: ["scripts/auditor.mjs"] }),
  ];
  const out = compact({ requests: [], tasks: tickets, ideas: [], collisions: null, now });
  const eyesTickets = out.tasks.filter((item) => (item.problemFiles ?? []).includes("scripts/eyes.mjs"));
  assert.equal(eyesTickets.length, 1, "the eyes.mjs family collapses to one job");
  assert.ok(out.tasks.some((item) => (item.problemFiles ?? []).includes("scripts/auditor.mjs")), "the auditor.mjs target is untouched");
  assert.equal(out.tasks.length, 2);
});

// ---- duplicate collapse spares live claims -----------------------------------

test("two claimed copies of one title both survive compaction", () => {
  const now = Date.now();
  const tasks = [
    task("t1", "Polish the dream mode", { runId: "run_1", status: "active" }),
    task("t2", "polish the dream mode!", { runId: "run_2", status: "active" }),
  ];
  const out = compact({ requests: [], tasks, ideas: [], collisions: null, now });
  assert.equal(out.tasks.length, 2, "two live attempts are not deduped away");
});

test("a claimed copy wins over a fresher unclaimed duplicate", () => {
  const now = Date.now();
  const tasks = [
    task("t1", "Polish the dream mode", { runId: "run_1", status: "active" }),
    task("t2", "Polish the dream mode", { updatedAt: now }),
  ];
  const out = compact({ requests: [], tasks, ideas: [], collisions: null, now });
  assert.equal(out.tasks.length, 1);
  assert.equal(out.tasks[0].runId, "run_1");
});

// ---- ownership fence ---------------------------------------------------------

test("ownershipFence: only the owning attempt settles a record", () => {
  const owned = { runId: "run_1" };
  assert.equal(ownershipFence(owned, "run_1"), true);
  assert.equal(ownershipFence(owned, "run_2"), false, "stale completion cannot settle someone else's attempt");
  assert.equal(ownershipFence(null, "run_1"), false);
  assert.equal(ownershipFence({}, "run_1"), false, "a record with no owner is nobody's to settle");
  assert.equal(ownershipFence({}, "run_1", { requireOwner: false }), true, "inbox rows may be completed idempotently when unclaimed");
  assert.equal(ownershipFence({ runId: "run_2" }, "run_1", { requireOwner: false }), false);
});

// ---- housekeeping sweep ------------------------------------------------------

test("housekeepingSweep: stuck claims requeue, owner requests never age out", () => {
  const now = Date.now();
  const requests = [
    { id: "r1", title: "Fix x", source: "fix", at: now - 60 * HOUR }, // auto: expired
    { id: "r2", title: "Work on login", source: "chat", at: now - 200 * HOUR }, // owner: kept forever
    { id: "r3", title: "Manual ask", source: "manual", at: now - 200 * HOUR }, // unknown source: kept
    { id: "r4", title: "Fix y", source: "fix", status: "running", runId: "run_dead", at: now - HOUR }, // dead claim: requeued
  ];
  const tasks = [
    task("t1", "Stuck task", { status: "active", runId: "run_dead2" }),
    task("t2", "Manually active", { status: "active" }), // no runId: untouched
    task("done1", "Old done", { status: "done", updatedAt: now - 100 * HOUR }),
  ];
  const out = housekeepingSweep({ requests, tasks, liveRuns: new Set(), now, prefs: { tidyDoneAfterHours: 24 } });
  assert.ok(!out.requests.some((r) => r.id === "r1"), "stale auto request pruned");
  assert.ok(out.requests.some((r) => r.id === "r2"), "chat request survives");
  assert.ok(out.requests.some((r) => r.id === "r3"), "unknown-source request survives");
  const r4 = out.requests.find((r) => r.id === "r4");
  assert.equal(r4?.status, undefined, "dead claim requeued");
  assert.equal(out.report.requestsRequeued, 1);
  const t1 = out.tasks.find((t) => t.id === "t1");
  assert.equal(t1.status, "open");
  assert.equal(t1.runId, undefined);
  assert.equal(out.tasks.find((t) => t.id === "t2")?.status, "active");
  assert.equal(out.tasks.find((t) => t.id === "done1")?.status, "archived", "aged completion remains visible in history");
});

test("housekeepingSweep: claimed copies win title collapse; two claims both stay", () => {
  const now = Date.now();
  const tasks = [
    task("unclaimed", "Same title", { updatedAt: now }),
    task("claimed", "same title", { runId: "run_9", status: "active" }),
    task("claimA", "Two claims", { runId: "run_a", status: "active" }),
    task("claimB", "two claims", { runId: "run_b", status: "active" }),
  ];
  const out = housekeepingSweep({ requests: [], tasks, liveRuns: new Set(["run_9", "run_a", "run_b"]), now });
  assert.ok(out.tasks.some((t) => t.id === "claimed"), "claimed copy wins");
  assert.ok(!out.tasks.some((t) => t.id === "unclaimed"), "unclaimed duplicate dropped");
  assert.ok(out.tasks.some((t) => t.id === "claimA") && out.tasks.some((t) => t.id === "claimB"), "two live attempts both stay");
});

// ---- identity helpers --------------------------------------------------------

test("housekeeping preserves distinct obligations that share a display title", () => {
  const now = Date.now();
  const tasks = [
    task("csv", "Export results", { prompt: "Export CSV", updatedAt: now }),
    task("json", "Export results", { prompt: "Export JSON", updatedAt: now }),
    task("unicode", "Export results", { prompt: "Export JSON", acceptance: ["Preserve Unicode"], updatedAt: now }),
    task("other-file", "Export results", { prompt: "Export JSON", files: ["other.js"], updatedAt: now }),
  ];
  const result = housekeepingSweep({ tasks, requests: [], liveRuns: new Set(), now });
  assert.deepEqual(result.tasks.map((row) => row.id), tasks.map((row) => row.id));
});

test("housekeeping keeps an aged delegated request until its durable handoff is resolved", () => {
  const now = Date.now();
  const request = { title: "Delegated check", prompt: "Exact child scope", source: "agent", at: now - 72 * 3600000, handoffId: "handoff-one", fromRun: "run-parent" };
  const result = housekeepingSweep({ tasks: [], requests: [request], liveRuns: new Set(), now });
  assert.deepEqual(result.requests, [request]);
  assert.equal(result.report.requestsPruned, 0);
});

test("planThemeKey: idea counts do not make new themes", () => {
  assert.equal(planThemeKey("Plan: catalog — 6 ideas"), planThemeKey("Plan: catalog — 4 ideas"));
  assert.equal(planThemeKey("Plan: assets — 3 ideas"), "assets");
  assert.equal(planThemeKey("Polish the dream mode"), null);
  // the AI review folds tasks into plans the same way — one theme, either shape
  assert.equal(planThemeKey("Plan: collision queue — 2 tasks"), "collision queue");
  assert.equal(planThemeKey("Plan: queue — 3 ideas"), planThemeKey("Plan: queue — 2 tasks"));
});

test("compactKey: punctuation and case do not make new work", () => {
  assert.equal(compactKey("Fix the auditor."), compactKey("fix the auditor"));
});

test("compactKey: a Work on it title is the label it points at, not new work", () => {
  assert.equal(compactKey('Work on "Post-commit quiet-tree gate rerun"'), compactKey("Post-commit quiet-tree gate rerun"));
  assert.equal(compactKey("work on 'Tidy the board'."), compactKey("Tidy the board"));
  // A real instruction that merely starts with the phrase stays itself.
  assert.notEqual(compactKey("Work on the gate rerun carefully"), compactKey("the gate rerun carefully"));
});

// ---- verdict sentinel: strict, not substring ---------------------------------

test("isDoneMarkerLine: the verdict is the sentinel line, never a quote of it", () => {
  assert.equal(isDoneMarkerLine("MEFI_JOB_DONE"), true);
  assert.equal(isDoneMarkerLine("  MEFI_JOB_DONE  "), true, "whitespace around the mark is fine");
  assert.equal(isDoneMarkerLine("MEFI_JOB_DONE — catalog rewritten, contract green"), true, "a short trailing note is allowed");
  assert.equal(isDoneMarkerLine("MEFI_JOB_DONE."), true, "trailing punctuation is allowed");
  // prose that merely CONTAINS the mark must not flip the job to done
  assert.equal(isDoneMarkerLine("Do not print MEFI_JOB_DONE until every obligation is verified"), false);
  assert.equal(isDoneMarkerLine('the sentinel is "MEFI_JOB_DONE" and here is why'), false);
  assert.equal(isDoneMarkerLine("as promised: MEFI_JOB_DONE"), false);
  assert.equal(isDoneMarkerLine(""), false);
  assert.equal(isDoneMarkerLine(null), false);
});

// ---- structured result line ---------------------------------------------------

test("parseExecutorResult: the worker's own account attaches to the attempt", () => {
  const parsed = parseExecutorResult('MEFI_RESULT: done: tar torch + stick copy; remaining: catalog contract; ran: world smoke');
  assert.ok(parsed);
  assert.equal(parsed.parts.done, "tar torch + stick copy");
  assert.equal(parsed.parts.remaining, "catalog contract");
  assert.equal(parsed.parts.ran, "world smoke");
  assert.ok(parsed.raw.length <= 300);
  assert.equal(parseExecutorResult("some ordinary output line"), null);
  assert.equal(parseExecutorResult("MEFI_RESULT:"), null, "empty result is not a result");
});

// ---- wedged-start detection ----------------------------------------------------

test("isWedgedStart: silent and session-less past the budget is a wedge; speech or a session is life", () => {
  const budget = 3 * 60 * 1000;
  // the wedge: nothing printed, no session registered, budget elapsed
  assert.equal(isWedgedStart({ spoke: false, sessionId: null, ageMs: budget, budgetMs: budget }), true);
  assert.equal(isWedgedStart({ ageMs: budget + 1000, budgetMs: budget }), true, "defaults are silent and session-less");
  // a run that said anything is alive, however quiet since
  assert.equal(isWedgedStart({ spoke: true, sessionId: null, ageMs: budget + 60000, budgetMs: budget }), false);
  // a run whose session registered is alive even if it has not spoken
  assert.equal(isWedgedStart({ spoke: false, sessionId: "ses_a", ageMs: budget + 60000, budgetMs: budget }), false);
  // before the budget nothing is a wedge yet — slow starts get their window
  assert.equal(isWedgedStart({ spoke: false, sessionId: null, ageMs: budget - 1, budgetMs: budget }), false);
  // a zero/negative budget never fires — a mis-set constant cannot kill every run
  assert.equal(isWedgedStart({ spoke: false, sessionId: null, ageMs: 9 * 60 * 1000, budgetMs: 0 }), false);
});

// ---- ingestion cursor ----------------------------------------------------------

test("advanceCursor: material is consumed once, and a failed pass re-reads its window", () => {
  const rows = [{ at: 100, id: "a" }, { at: 900, id: "z" }, { at: 500, id: "m" }];
  assert.deepEqual(advanceCursor(rows, { at: 0, id: "" }), { at: 900, id: "z" });
  // a pass over an empty window keeps the cursor where it was
  assert.deepEqual(advanceCursor([], { at: 900, id: "z" }), { at: 900, id: "z" });
  // cursor only moves forward even if a caller hands older rows
  assert.deepEqual(advanceCursor([{ at: 10, id: "a" }], { at: 900, id: "z" }), { at: 900, id: "z" });
  // duplicate timestamps break the tie on part id: the keyset tuple advances
  // past exactly the rows that were fetched, so a page boundary can never
  // skip (or re-read) a same-timestamp row
  assert.deepEqual(advanceCursor([{ at: 900, id: "zz" }], { at: 900, id: "z" }), { at: 900, id: "zz" });
  assert.deepEqual(advanceCursor([{ at: 900, id: "b" }], { at: 900, id: "z" }), { at: 900, id: "z" });
  // a legacy bare-timestamp cursor (pre-keyset store) upgrades cleanly
  assert.deepEqual(advanceCursor([{ at: 1000, id: "m" }], 900), { at: 1000, id: "m" });
});
// ---- one id allocator across the whole pass ------------------------------------

test("idea plans and AI task groups in one pass never share an id", () => {
  const now = Date.now();
  const ideas = [
    ide("i1", "Catalog idea one", "one", ["catalog"], { at: now }),
    ide("i2", "Catalog idea two", "two", ["catalog"], { at: now }),
    ide("i3", "Catalog idea three", "three", ["catalog"], { at: now }),
  ];
  const tasks = [
    task("t1", "Session collision queue", { prompt: "queue edits per session" }),
    task("t2", "Collaboration collision queue", { prompt: "one queue for collaboration" }),
    task("t3", "Unrelated work"),
  ];
  const out = compact({
    requests: [],
    tasks,
    ideas,
    collisions: null,
    now,
    taskGroups: [{ title: "collision queue", tasks: ["Session collision queue", "Collaboration collision queue"] }],
  });
  const ids = out.tasks.map((item) => String(item.id)).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length, "every work item carries a unique id");
  const plans = out.tasks.filter((item) => String(item.id).startsWith("task_plan_"));
  assert.equal(plans.length, 2, "both generators folded in the same pass");
  // Idea links point at a task that actually exists under that id.
  for (const idea of out.ideas) {
    if (!idea.taskId) continue;
    assert.ok(ids.includes(String(idea.taskId)), `idea ${idea.id} links to a live task`);
  }
  const catalogPlan = plans.find((plan) => /ideas/.test(plan.title));
  const groupedPlan = plans.find((plan) => /tasks/.test(plan.title));
  assert.ok(catalogPlan && groupedPlan, "both an idea plan and a task plan exist");
  assert.notEqual(catalogPlan.id, groupedPlan.id, "the two generators minted different ids");
  const linked = out.ideas.filter((idea) => idea.taskId === catalogPlan.id);
  assert.equal(linked.length, 3, "every folded idea references the idea plan");
});

// ---- grouping preserves obligations; expiry restores them ----------------------

test("an AI task grouping keeps every obligation through its own expiry", () => {
  const now = Date.now();
  const longPrompt = "Rebuild the collision queue: keep per-session edits isolated, rebase owners, and verify every file still parses after the merge.";
  const t1 = task("t1", "Session collision queue", {
    prompt: longPrompt,
    files: ["scripts/eyes.mjs"],
    priority: 2,
    createdAt: now,
    updatedAt: now,
  });
  const t2 = task("t2", "Collaboration collision queue", {
    prompt: "Fold the collaboration queue into one owner-aware card.",
    file: "ui/board.js",
    ideas: [],
    createdAt: now,
    updatedAt: now,
  });
  const folded = compact({
    requests: [],
    tasks: [t1, t2],
    ideas: [],
    collisions: null,
    now,
    taskGroups: [{ title: "queue", tasks: ["Session collision queue", "Collaboration collision queue"] }],
  });
  const plan = folded.tasks.find((item) => String(item.id).startsWith("task_plan_"));
  assert.ok(plan, "the grouping folded");
  assert.equal(plan.members.length, 2);
  assert.equal(plan.members[0].prompt, longPrompt, "the plan's snapshot keeps the full prompt, not a clipped line");
  assert.ok(plan.prompt.includes(longPrompt), "the builder sees the obligation in full");
  // The plan sits unclaimed past the stale horizon — nothing claimed it.
  const later = now + 13 * HOUR;
  const expired = compact({ requests: [], tasks: folded.tasks, ideas: folded.ideas, collisions: null, now: later, limits: { stalePlanHours: 12 } });
  assert.ok(!expired.tasks.some((item) => String(item.id).startsWith("task_plan_")), "the expired grouping leaves the board");
  const restored1 = expired.tasks.find((item) => item.id === "t1");
  const restored2 = expired.tasks.find((item) => item.id === "t2");
  assert.ok(restored1 && restored2, "both original obligations are back on the board");
  assert.equal(restored1.status, "open");
  assert.equal(restored2.status, "open");
  assert.equal(restored1.prompt, longPrompt, "the original body survived the grouping and its expiry");
  assert.deepEqual(restored1.files, ["scripts/eyes.mjs"], "write scopes ride through");
  assert.equal(restored1.priority, 2, "priority rides through");
  assert.equal(restored2.file, "ui/board.js");
});

// ---- verification: the acceptance contract, not "did a file change" ------------

test("verifyCompletion: evidence, not edits, decides completion", () => {
  // Session work with attributable edits verifies.
  assert.equal(verifyCompletion({ verdictOk: true, changedFiles: 3, hasSession: true }).state, "verified");
  // Session work with no edits and no claimed checks does not — and it is
  // bounded, not an immediate reopen-and-respawn.
  const noEdits = verifyCompletion({ verdictOk: true, changedFiles: 0, hasSession: true });
  assert.equal(noEdits.state, "unverified");
  assert.equal(noEdits.attemptNo, 1);
  // A test/audit-only run needs its actual terminal result, not just prose.
  const observedChecks = [{ command: "npm test", status: "completed", exitCode: 0, passed: true, startedAt: 1000 }];
  assert.equal(verifyCompletion({ verdictOk: true, changedFiles: 0, hasSession: true, resultNote: { parts: { ran: "npm test" } } }).state, "unverified");
  assert.equal(verifyCompletion({ verdictOk: true, changedFiles: 0, hasSession: true, observedChecks, resultNote: { parts: { ran: "npm test" } } }).state, "verified");
  // No session: the verdict alone proves nothing.
  assert.equal(verifyCompletion({ verdictOk: true, changedFiles: 0, hasSession: false }).state, "unverified");
  assert.equal(verifyCompletion({ verdictOk: true, changedFiles: 5, hasSession: false }).state, "unverified", "edits without a session are not attributable");
  // An account without an attributed session is still only a claim.
  assert.equal(verifyCompletion({ verdictOk: true, changedFiles: 0, hasSession: false, resultNote: { parts: { tests: "lua parse pass" } } }).state, "unverified");
  // A builder CLI that writes no OpenCode session can never supply that
  // evidence: park it for the owner at once rather than retrying blind. It is
  // never verified, and a real failure still reads as that failure.
  const sessionless = verifyCompletion({ verdictOk: true, changedFiles: 5, hasSession: false, sessionlessRoute: "grok" });
  assert.equal(sessionless.state, "failed");
  assert.equal(sessionless.attemptNo, 1);
  assert.match(sessionless.reason, /grok runs leave no session the verifier can read/);
  assert.equal(verifyCompletion({ verdictOk: false, hasSession: false, sessionlessRoute: "grok" }).reason, "the run did not report success");
  assert.equal(verifyCompletion({ verdictOk: true, changedFiles: 2, hasSession: true, sessionlessRoute: "grok" }).state, "verified", "a session, when present, is judged as usual");
  // Partial results never verify, whatever the edits say.
  assert.equal(verifyCompletion({ verdictOk: true, changedFiles: 4, hasSession: true, resultNote: { parts: { remaining: "catalog contract" } } }).state, "unverified");
  assert.equal(verifyCompletion({ verdictOk: true, changedFiles: 4, hasSession: true, remaining: ["handoff: follow-up"] }).state, "unverified");
  // A reported check failure is never evidence.
  const failedTests = verifyCompletion({ verdictOk: true, changedFiles: 2, hasSession: true, resultNote: { parts: { tests: "failed: world smoke" } } });
  assert.equal(failedTests.state, "unverified");
  // A run that did not report success is not verified however many files moved.
  assert.equal(verifyCompletion({ verdictOk: false, changedFiles: 9, hasSession: true }).state, "unverified");
  // The retry budget is bounded: past it, the attempt is failed — the caller
  // parks the card instead of scheduling the same unproven run again.
  const last = verifyCompletion({ verdictOk: true, changedFiles: 0, hasSession: true, priorAttempts: VERIFY_MAX_ATTEMPTS - 1 });
  assert.equal(last.state, "failed");
  const within = verifyCompletion({ verdictOk: true, changedFiles: 0, hasSession: true, priorAttempts: VERIFY_MAX_ATTEMPTS - 2 });
  assert.equal(within.state, "unverified");
});

// ---- durable leases and absorbed members in the sweep ---------------------------

test("housekeepingSweep: a fresh foreign lease holds a claim; stale or own dead runs requeue", () => {
  const now = Date.now();
  const MINUTE = 60 * 1000;
  const running = (id, pid, age) => ({
    id,
    title: `work ${id}`,
    prompt: "x",
    at: now,
    source: "chat",
    status: "running",
    runId: `run_${id}`,
    runningAt: now - age,
    lease: { pid, at: now - age },
  });
  const own = running("own", 111, 1000);
  const foreignFresh = running("foreign", 999, 1000);
  const foreignStale = running("stale", 999, 31 * MINUTE);
  const out = housekeepingSweep({
    requests: [own, foreignFresh, foreignStale],
    tasks: [],
    liveRuns: new Set(),
    now,
    pid: 111,
  });
  const byId = new Map(out.requests.map((row) => [row.id, row]));
  assert.equal(byId.get("own").status, undefined, "our own dead run requeues immediately");
  assert.equal(byId.get("foreign").status, "running", "a fresh foreign lease is another process's live attempt");
  assert.equal(byId.get("stale").status, undefined, "a stale foreign lease is a dead process's claim");
  assert.equal(out.report.requestsRequeued, 2);
});

test("housekeepingSweep: a verifying request belongs to its verification pass, not the queue", () => {
  const now = Date.now();
  const verifying = {
    id: "r1",
    title: "Fix the queue",
    prompt: "x",
    at: now,
    source: "chat",
    status: "verifying",
    runId: "run_1",
    lastAttempt: { runId: "run_1", code: 0, sawDone: true, at: now - 1000 },
  };
  const out = housekeepingSweep({ requests: [verifying], tasks: [], liveRuns: new Set(), now, pid: 1 });
  assert.equal(out.requests[0].status, "verifying", "the row rides until verification settles it");
  assert.equal(out.report.requestsRequeued, 0);
});

test("housekeepingSweep: absorbed members follow their grouping", () => {
  const now = Date.now();
  const plan = (id, title, status) => ({ id, title, status, source: "a-eyes", createdAt: now, updatedAt: now, ideas: [], logs: [] });
  const member = (id, title, planId) => ({ id, title, prompt: "p", status: "absorbed", absorbedInto: planId, source: "a-eyes", createdAt: now, updatedAt: now, ideas: [], logs: [] });
  const planLive = plan("plan1", "Plan: queue — 2 tasks", "open");
  const planDone = plan("plan2", "Plan: art — 2 tasks", "done");
  const absorbedLive = member("t1", "member one", "plan1");
  const absorbedDone = member("t2", "member two", "plan2");
  const absorbedOrphan = member("t3", "member three", "plan_gone");
  const out = housekeepingSweep({ requests: [], tasks: [planLive, planDone, absorbedLive, absorbedDone, absorbedOrphan], liveRuns: new Set(), now, pid: 1 });
  const byId = new Map(out.tasks.map((row) => [row.id, row]));
  assert.equal(byId.get("t1").status, "absorbed", "a member of a live plan stays absorbed");
  assert.equal(byId.get("t2").status, "archived", "a member of a finished grouping archives with it");
  const orphan = byId.get("t3");
  assert.equal(orphan.status, "open", "a member whose grouping vanished is restored to open work");
  assert.equal(orphan.absorbedInto, undefined);
  assert.equal(orphan.prompt, "p", "the restored member keeps its body");
});

// ---- idea identity: sourceKey --------------------------------------------------

test("mergeIdeas: sourceKey suppresses a re-scanned note even when title and detail were reworded", () => {
  const stored = [
    {
      id: "i1",
      title: "Reworded by the AI review",
      detail: "polish the collision visuals for readability",
      sourceKey: "add a collision queue for editing sessions",
      status: "new",
    },
  ];
  const rescan = [
    {
      id: "i2",
      title: "Add a collision queue for editing sessions",
      detail: "add a collision queue for editing sessions",
      sourceKey: "add a collision queue for editing sessions",
    },
  ];
  const out = mergeIdeas(stored, rescan);
  assert.equal(out.added, 0, "the same source note is not minted twice");
});

// ---- chat-noise gate ------------------------------------------------------------

test("mergeIdeas rejects chat-noise extraction artifacts before they reach the store", () => {
  // The shapes that actually landed in the live store (6 rows, extraction:2)
  // before the manual sweep — narration, status reports, progress chatter.
  const noise = [
    { title: "Now update my TESTRUNS row", detail: "Now update my TESTRUNS row and add the missing row for the concurrent session's check (additive only)" },
    { title: "Python contracts pass", detail: "Python contracts pass. Let me find the exact registered Lua checks next." },
    { title: "I'll start by exploring", detail: "I'll start by exploring the codebase to understand the existing systems before planning this multi-part feature." },
    { title: "All green (49 tests)", detail: "All green (49 tests). Adding capture shots for Tasks and Reference, then running the sweep." },
    { title: "Recon done", detail: "Recon done. Starting with the missing spell registry check and gathering the contract." },
    { title: "Wave 3 landed", detail: "Wave 3 landed. Two bounded gaps surfaced in the carve path and the world check." },
    { title: "What's left to polish?", detail: "What's left, needs polish, or still needs more work?" },
    // Status reports still narrate when the pattern sits in the main clause —
    // the gate only relaxes for subordinate tails.
    { title: "Contract tests pass", detail: "Contract tests pass; the next wave starts now." },
    { title: "Sweep status", detail: "The contract tests pass and the shared gate is green. Queue the follow-ups." },
  ];
  const out = mergeIdeas([], noise);
  assert.equal(out.added, 0, "narration, status reports and bare questions never become ideas");
  assert.equal(out.rejected, noise.length);
  for (const row of noise) assert.equal(isExtractionArtifact(row), true, JSON.stringify(row.title));

  // Genuine proposals — including lowercase detail bodies and real directives —
  // must still pass the gate. Conditional proposals carry their precondition in
  // a subordinate tail ("after contract tests pass") and survive the scoping.
  const genuine = [
    { title: "Fix tar torch descriptions", detail: "tar torch text wrong in catalog" },
    { title: "Add a collision queue for editing sessions", detail: "add a collision queue for editing sessions" },
    { title: "Equipment system", detail: "Local coop has no per-player equipment system at all, so bare P2 is consistent" },
    { title: "Sweep unwired systems", detail: "Look into systems that are not fully wired up or up to date with polish, flag these and make a plan" },
    { title: "Feature request", detail: "We should improve unique feature number 1 for this project." },
    { title: "Retry policy", detail: "Should stale checks retry with a warm cache on later boots?" },
    // The row that motivated the clause scoping (idea_1789701012846_a89e1).
    { title: "World feature smoke for torch interaction", detail: "Add main-game world feature smoke covering torch and interaction integration after contract tests pass." },
    { title: "Gate the exporter", detail: "Run the exporter smoke once the contract suite passes." },
    { title: "Re-check icons", detail: "Re-run the stat-icon check before the suite passes." },
  ];
  const kept = mergeIdeas([], genuine);
  assert.equal(kept.added, genuine.length, "genuine proposals pass the gate");
  assert.equal(kept.rejected, 0);
  for (const row of genuine) assert.equal(isExtractionArtifact(row), false, JSON.stringify(row.title));
});
