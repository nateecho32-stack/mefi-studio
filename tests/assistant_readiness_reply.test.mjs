import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { localReply, buildFacts } from "../scripts/assistant.mjs";
import backlog from "../scripts/backlog.cjs";

test("host facts count the whole stored board before limiting prompt context", async () => {
  const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
  const start = source.indexOf("async function assistantMessageFacts("), end = source.indexOf("function assistantMessageId()", start);
  const data = { tasks: Array.from({ length: 66 }, (_, i) => ({ id: String(i), title: `Task ${i}`, status: "open" })),
    requests: [{ title: "Task 0" }, { title: "New request" }], ideas: [], briefing: null };
  const env = vm.createContext({
    backlog, assistantState: { status: "running", prefs: {} }, autopilot: { execute: true, parallel: 3, jobs: [{ title: "Already finished", finished: true }] },
    assistantReadStore: async () => ({ sessions: [], todos: [], collisions: [], presence: [], uncommitted: [] }),
    getEyes: async () => ({ readJson: async (key) => data[key] }),
    TASKS_PATH: "tasks", REQUESTS_PATH: "requests", IDEAS_PATH: "ideas", BRIEFING_PATH: "briefing",
    assistantCache: { machine: { running: [] }, audit: { errors: 0, warnings: 0, findings: [] } }, updater: null,
    compareWork: () => 0, getAssistant: async () => ({ buildFacts, suggestWork: () => [] }),
    projects: { current: () => ({ id: "project_trippy", name: "2d Trippy Hell", path: "C:/work/2d Trippy Hell" }) },
    analyzerProjectReports: new Map([["project_trippy", {
      name: "2d Trippy Hell", analyzedAt: "2026-09-20T18:55:00.000Z",
      summary: { plans: 9, items: 240, missingReferences: 34 }, inventory: { files: 1200, sourceFiles: 974, testFiles: 2, documents: 86 },
      limitations: ["Scan truncated at 1200 files or 6000 directory entries; absence of evidence is inconclusive."],
      plans: [{ title: "newwork plan", source: "newwork-plan.md", sourceType: "file", status: "open", items: [{ text: "Add the next orbit", status: "open" }] }],
      startingPoints: [{ title: "Continue: Add the next orbit", firstStep: "Read PLAN.md" }],
    }]]),
    assistantClip: (value, max = 160) => { const line = String(value ?? "").replace(/\s+/g, " ").trim(); return line.length > max ? `${line.slice(0, max - 1)}…` : line; },
  });
  vm.runInContext(source.slice(start, end), env);
  const facts = await env.assistantMessageFacts(Date.now(), "builder status");
  assert.equal(facts.tasks.length, 40);
  assert.equal(facts.backlog.totalTasks, 66);
  assert.equal(facts.backlog.counts.readyTasks, 66);
  assert.equal(facts.backlog.counts.readyRequests, 1, "represented inbox work is not counted twice");
  assert.equal(facts.executor.running.length, 0, "settled entries never claim a live build worker");
  assert.equal(facts.project.name, "2d Trippy Hell", "the open folder rides the facts");
  assert.equal(facts.projectScan.plans[0].source, "newwork-plan.md", "the folder scan's plans ride the facts");
  assert.equal(facts.projectScan.partial, true, "a truncated scan is disclosed as partial");
});

test("builder replies use full readiness counts and distinguish assistant activity from build workers", () => {
  const facts = buildFacts({
    tasks: Array.from({ length: 66 }, (_, i) => ({ id: String(i), title: `Task ${i}`, status: "open" })),
    executor: { enabled: true, queued: 66, parallel: 3, running: [] },
    backlog: { counts: { ready: 45, readyTasks: 42, readyRequests: 3, review: 4, waiting: 5, blocked: 6, cooling: 2 }, totalTasks: 66, totalRequests: 3 },
  });
  assert.equal(facts.tasks.length, 40, "prompt context is bounded without truncating the real count");
  assert.equal(facts.backlog.totalTasks, 66);
  const reply = localReply({ text: "what is the builder doing", facts, state: { agents: [{ role: "responder", status: "running" }] } });
  assert.match(reply.text, /No build worker is running/);
  assert.match(reply.text, /42 tasks and 3 requests ready in one ranked queue/);
  assert.match(reply.text, /4 awaiting verification; 5 waiting for prerequisites; 6 need review; 2 cooling down/);
  assert.match(reply.text, /worker start has not been confirmed/);
  assert.doesNotMatch(reply.text, /behind the queue|66 requests|Nothing building/);
});

test("paused builders and running workers are reported together without claiming queued work started", () => {
  const facts = { executor: { enabled: false, parallel: 3, adaptiveParallel: false, running: [{ title: "Real current task" }] }, backlog: { counts: { readyTasks: 8, readyRequests: 0 }, paused: true } };
  const reply = localReply({ text: "clean up the builder", facts });
  assert.match(reply.text, /Building now \(1\/3 worker slots\): "Real current task"/);
  assert.match(reply.text, /New workers are paused; current workers can finish/);
  assert.match(reply.text, /does not confirm that a worker has started/);
  assert.deepEqual(reply.actions, ["compact"]);
  assert.doesNotMatch(reply.text, /cap cuts|foreman takes|behind the queue/);
});

test("builder facts and replies retain machine admission decisions without reporting manual slots", () => {
  const resources = { cpuPercent: 94, availableMemoryMB: 1900, totalMemoryMB: 16384, requiredMemoryMB: 440, lagMs: 175, hostLagMs: 125, rendererLagMs: 175, lagPressure: true, holdKind: "lag", memoryShortfall: null, memoryWarning: null };
  const facts = buildFacts({ executor: { enabled: true, parallel: 2, running: Array.from({ length: 5 }, (_, index) => ({ title: `Work ${index}` })), capacity: { canStart: false, reason: "Studio is responding slowly", resources } } });
  assert.equal(facts.executor.adaptiveParallel, true);
  assert.deepEqual(facts.executor.capacity, { canStart: false, reason: "Studio is responding slowly", resources });
  const reply = localReply({ text: "builder status", facts });
  assert.match(reply.text, /Building now \(5 building · machine managed\)/);
  assert.match(reply.text, /and 2 more/);
  assert.match(reply.text, /Dispatch waiting: Studio is responding slowly/);
  assert.match(reply.text, /resume automatically when machine capacity recovers/);
  assert.doesNotMatch(reply.text, /worker slots/);
  const recovered = buildFacts({ executor: { ...facts.executor, capacity: { canStart: true, reason: null, resources: { ...resources, lagMs: 10, hostLagMs: 10, rendererLagMs: null, lagPressure: false, holdKind: null } } } });
  assert.equal(recovered.executor.capacity.resources.rendererLagMs, null, "a hidden renderer has no observed lag");
  assert.equal(recovered.executor.capacity.resources.lagPressure, false);
  assert.equal(recovered.executor.capacity.resources.cpuPercent, 94, "high CPU remains resource context after responsiveness recovers");
  assert.doesNotMatch(localReply({ text: "builder status", facts: recovered }).text, /Dispatch waiting|responding slowly/);
});

test("a memory hold rides the facts and the reply names finishing or compacting work as the remedy", () => {
  // The dispatch alert this integrates: a small memory shortfall (345 MB free,
  // 440 MB needed) holds starts; the structured class must survive into the
  // facts so the remedy is memory-shaped, not "wait for responsiveness".
  const facts = buildFacts({
    executor: {
      enabled: true, parallel: 2, adaptiveParallel: true, running: [{ title: "worldgen triage" }],
      capacity: {
        canStart: false,
        reason: "Machine memory is low (345 MB available; 440 MB needed before another worker).",
        resources: { cpuPercent: 8, availableMemoryMB: 345, totalMemoryMB: 16384, requiredMemoryMB: 440, lagMs: 12, hostLagMs: 12, rendererLagMs: null, lagPressure: false, holdKind: "memory", memoryShortfall: "small", memoryWarning: null },
      },
    },
  });
  assert.equal(facts.executor.capacity.resources.holdKind, "memory");
  assert.equal(facts.executor.capacity.resources.memoryShortfall, "small");
  assert.equal(facts.executor.capacity.resources.requiredMemoryMB, 440);
  const reply = localReply({ text: "builder status", facts });
  assert.match(reply.text, /Dispatch waiting: Machine memory is low \(345 MB available; 440 MB needed/);
  assert.match(reply.text, /Finishing or compacting existing work frees memory and resumes new starts/);
  assert.doesNotMatch(reply.text, /resume automatically when machine capacity recovers/);

  // The severe tier keeps its distinct wording and never borrows the lag text.
  const severe = buildFacts({
    executor: { enabled: true, parallel: 2, running: [], capacity: { canStart: false, reason: "Machine memory is critically low (250 MB available; 300 MB severe floor) — refusing another worker even with the memory override.", resources: { availableMemoryMB: 250, requiredMemoryMB: 440, lagMs: 5, hostLagMs: 5, rendererLagMs: null, lagPressure: false, holdKind: "memory-severe", memoryShortfall: "severe", memoryWarning: null } } },
  });
  const severeReply = localReply({ text: "builder status", facts: severe });
  assert.match(severeReply.text, /Finishing or compacting existing work frees memory and resumes new starts/);

  // The latched severe-memory parallelism cap keeps the memory-shaped remedy
  // too: releasing workers frees memory, it is not a responsiveness wait.
  const capped = buildFacts({
    executor: { enabled: true, parallel: 2, adaptiveParallel: true, running: [{ title: "worldgen triage" }], capacity: { canStart: false, reason: "Machine memory is recovering from the severe floor (350 MB available; 450 MB needed) — worker parallelism stays capped at 4 until free memory recovers.", resources: { availableMemoryMB: 350, requiredMemoryMB: 440, lagMs: 5, hostLagMs: 5, rendererLagMs: null, lagPressure: false, holdKind: "memory-cap", memoryShortfall: "small", memoryWarning: null } } },
  });
  const cappedReply = localReply({ text: "builder status", facts: capped });
  assert.match(cappedReply.text, /Dispatch waiting: Machine memory is recovering from the severe floor/);
  assert.match(cappedReply.text, /Finishing or compacting existing work frees memory and resumes new starts/);
  assert.doesNotMatch(cappedReply.text, /resume automatically when machine capacity recovers/);

  // An overridden small shortfall admits work: the warning rides the facts
  // while the hold is gone.
  const overridden = buildFacts({
    executor: { enabled: true, parallel: 2, running: [], capacity: { canStart: true, reason: null, resources: { availableMemoryMB: 345, requiredMemoryMB: 440, lagMs: 0, hostLagMs: 0, rendererLagMs: 0, lagPressure: false, holdKind: null, memoryShortfall: "small", memoryWarning: "Machine memory is low (345 MB available; 440 MB needed before another worker) — starting on the explicit memory override." } } },
  });
  assert.equal(overridden.executor.capacity.resources.memoryWarning, "Machine memory is low (345 MB available; 440 MB needed before another worker) — starting on the explicit memory override.");
  assert.doesNotMatch(localReply({ text: "builder status", facts: overridden }).text, /Dispatch waiting/);
});

test("dispatch holds and unavailable readiness remain explicit", () => {
  const held = localReply({ text: "builder status", facts: { executor: { enabled: true, running: [] }, backlog: { counts: { ready: 2, readyTasks: 2 }, waiting: "Machine reserved by another test run" } } });
  assert.match(held.text, /Dispatch waiting: Machine reserved/);
  const unknown = localReply({ text: "builder status", facts: { executor: { enabled: true, queued: 7, running: [] } } });
  assert.match(unknown.text, /7 work items queued; detailed readiness is unavailable/);
  assert.doesNotMatch(unknown.text, /7 requests/);
});

test("compaction counts scheduler eligibility and confirms only the dispatch request", async () => {
  const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
  const start = source.indexOf("async function assistantCompactorJob("), end = source.indexOf("async function assistantKeeperJob(", start);
  const tasks = [{ id: "first", title: "First", status: "open" }, { id: "second", title: "Dependent", status: "open", dependsOn: ["first"] }, { id: "failed", title: "Needs review", status: "open", runFailures: 5 }];
  let asked = 0;
  const env = vm.createContext({
    backlog, autopilot: { jobs: [], execute: true }, assistantState: { status: "running", prefs: {} }, assistantCache: {},
    getAssistant: async () => ({ compact: ({ tasks }) => ({ tasks, requests: [], ideas: [], report: { runnable: 3, text: "nothing to compact · 3 jobs runnable", reviewed: {}, plans: [] } }) }),
    mutateBoard: async (fn) => ({ ...fn({ tasks, requests: [], ideas: [] }), written: [] }),
    compareWork: () => 0, assistantClip: (value) => value, assistantLog() {}, assistantHop: async () => {}, ROOT_NODE: {},
    assistantAskForWork: () => { asked += 1; return true; },
  });
  vm.runInContext(source.slice(start, end), env);
  env.consumeReviewedTaskGroups = async () => null;
  const result = await env.assistantCompactorJob(Date.now(), {});
  assert.equal(result.intel.runnable, 1);
  assert.match(result.text, /1 work item ready/);
  assert.match(result.text, /dispatch requested; worker start is not yet confirmed/);
  assert.doesNotMatch(result.text, /3 jobs runnable|handed to the foreman/);
  assert.equal(asked, 1);
  env.assistantState.status = "paused";
  env.assistantAskForWork = () => false;
  assert.match((await env.assistantCompactorJob(Date.now(), {})).text, /new workers paused/);
});
