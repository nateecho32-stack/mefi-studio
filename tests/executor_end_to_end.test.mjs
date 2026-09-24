import test from "node:test";
import assert from "node:assert/strict";
import { executorHost } from "./fixtures/host_executor.mjs";
import { captureTaskHandoffs } from "../scripts/task-handoffs.cjs";
import path from "node:path";

const task = (id, extra = {}) => ({ id, title: `Implement fixture ${id}`, prompt: `Implement ${id} and retain its full acceptance brief.`, status: "open", createdAt: 1, files: [`src/${id}.js`], ...extra });

test("real host loop dispatches, records streamed completion, verifies and starts the dependent task", async () => {
  const h = executorHost({ tasks: [task("first"), task("second", { dependsOn: ["first"], createdAt: 2 })] });
  h.wake(); await h.pump();
  assert.deepEqual(h.starts.map((start) => start.taskId), ["first"]);
  assert.equal(h.board().tasks[0].status, "active");
  assert.ok(h.starts[0].child.inputEnded); assert.match(h.starts[0].child.prompt, /Full saved task context/);
  assert.match(h.starts[0].child.prompt, /Keep verification and board bookkeeping in the current task/);
  assert.match(h.starts[0].child.prompt, /Never create a child task merely to close, update, verify or confirm another card/);
  assert.match(h.starts[0].child.prompt, /hand off only substantive unfinished work/);
  await h.finish("first"); await h.pump();
  assert.equal(h.board().tasks[0].status, "awaiting_verification", "worker output alone never closes the card");
  assert.equal(h.starts.length, 1, "dependencies wait through evidence flush dwell");
  h.advance(31000); h.wake(); await h.pump();
  assert.equal(h.board().tasks[0].status, "done");
  assert.equal(h.board().tasks[0].verification.state, "verified");
  assert.deepEqual(h.starts.map((start) => start.taskId), ["first", "second"]);
  assert.match(h.starts[1].child.prompt, /first/);
  await h.finish("second"); h.advance(31000); await h.pump();
  assert.ok(h.board().tasks.every((row) => row.status === "done"));
  assert.equal(h.autopilot.jobs.length, 0); assert.equal(h.registry.size, 0);
});

test("a task run gets its own small context file instead of the whole board, and old run files are pruned", async () => {
  const history = { version: 1, entries: [{ id: "revision_1_x", revision: 1, at: 1, kind: "saved", note: "", hash: "x", snapshot: { id: "second", prompt: "The original, longer brief." } }] };
  const h = executorHost({ tasks: [
    task("first", { status: "done", doneAt: 5, lastAttempt: { result: { parts: { done: "first output" } } }, contextHistory: { version: 1, entries: [] } }),
    task("second", { dependsOn: ["first"], createdAt: 2, contextHistory: history, members: [{ id: "member", title: "Grouped obligation", prompt: "Member brief" }] }),
    task("bystander", { status: "done", createdAt: 3, prompt: "x".repeat(5000) }),
  ] });
  h.wake(); await h.pump();
  assert.deepEqual(h.starts.map((start) => start.taskId), ["second"]);
  const files = h.runFiles();
  assert.equal(files.size, 1);
  const [[file, text]] = files;
  const runId = h.starts[0].runId;
  assert.equal(path.basename(file), `${runId}.json`);
  assert.equal(path.basename(path.dirname(file)), "task-runs");
  const prompt = h.starts[0].child.prompt;
  assert.ok(prompt.includes(`Full saved task context: read ${JSON.stringify(file)} and select task ID second`));
  assert.doesNotMatch(prompt, /find task id/, "the builder is not sent to the whole board file");
  const saved = JSON.parse(text);
  assert.equal(saved.runId, runId);
  assert.equal(saved.task.id, "second");
  assert.deepEqual(saved.task.contextHistory, history);
  assert.equal(saved.task.members[0].prompt, "Member brief");
  assert.deepEqual(saved.dependencies.map((row) => [row.id, row.status, row.contextHistory]), [["first", "done", undefined]]);
  assert.ok(!text.includes("x".repeat(5000)), "unrelated cards stay out of the run file");

  // Pruning keeps the newest files by the start time in the run id, never a young one, never a foreign name.
  const dir = path.dirname(file);
  const at = h.now();
  for (let index = 0; index < 60; index += 1) await h.env.writeFile(path.join(dir, `run_${at - 1 - index * 1000}_${index}.json`), "{}");
  await h.env.writeFile(path.join(dir, "notes.json"), "{}");
  assert.equal(await h.env.pruneTaskRunContexts(dir, at + 60 * 60000), 0, "nothing under two hours old is removed");
  const removed = await h.env.pruneTaskRunContexts(dir, at + 3 * 3600000);
  const left = [...h.runFiles().keys()].map((name) => path.basename(name));
  assert.equal(removed, 13);
  assert.equal(left.length, 49);
  assert.ok(left.includes(`${runId}.json`) && left.includes("notes.json"));
  assert.ok(left.includes(`run_${at - 1}_0.json`) && !left.includes(`run_${at - 1 - 59000}_59.json`));
});

test("dispatch enforces shared-index commit hygiene and surfaces leftover staged files after a run", async () => {
  const h = executorHost({ tasks: [task("first")], gitStage: "M  src/swept.js\n?? fresh.txt\n M src/unstaged.js\n" });
  h.wake(); await h.pump();
  assert.match(h.starts[0].child.prompt, /git commit -m <msg> -- <your files>/);
  assert.match(h.starts[0].child.prompt, /leave nothing staged/);
  await h.finish("first"); await h.pump();
  assert.ok(h.logs.some((line) => /shared git index still holds 1 staged file\(s\).*src\/swept\.js/.test(line)), "the sweep precondition is named, not silent");
  assert.ok(h.autopilot.history.some((row) => row.kind === "warning" && /src\/swept\.js/.test(row.text)));
  const clean = executorHost({ tasks: [task("solo")] });
  clean.wake(); await clean.pump();
  await clean.finish("solo"); await clean.pump();
  assert.ok(!clean.logs.some((line) => /shared git index/.test(line)), "a clean index stays quiet");
});

test("a finish-time staged-index warning rides exactly the next dispatch in that repo as collab advice", async () => {
  // Dependents gate dispatch until verification, so each prompt is built at a
  // controlled moment: after the sweep arms, after the index heals, etc.
  const h = executorHost({ tasks: [task("first"), task("second", { dependsOn: ["first"], createdAt: 2 }), task("third", { dependsOn: ["first"], createdAt: 3 })], gitStage: "M  src/swept.js\n" });
  h.wake(); await h.pump();
  assert.match(h.starts[0].child.prompt, /CAUTION shared git index: the index currently holds staged-but-uncommitted file\(s\) \(src\/swept\.js\)/, "the dispatch-time probe warns about a staged index even with no parked warning");
  await h.finish("first"); await h.pump();
  assert.equal(h.autopilot.stagedIndexWarnings?.size, 1, "the finish sweep parks the warning on the dispatcher");
  // The index heals from here on: later runs' finish sweeps must not re-arm.
  const baseEyes = await h.env.getEyes();
  h.env.getEyes = async () => ({ ...baseEyes, gitPorcelain: async () => "" });
  h.advance(31000); h.wake(); await h.pump();
  assert.match(h.starts[1].child.prompt, /CAUTION shared git index: a previous run left staged-but-uncommitted file\(s\) \(src\/swept\.js\)/);
  assert.match(h.starts[1].child.prompt, /BEFORE editing/);
  await h.finish("second"); h.advance(31000); h.wake(); await h.pump();
  assert.ok(!/CAUTION shared git index/.test(h.starts[2].child.prompt), "the advice is consumed by one read, not repeated forever");
  assert.equal(h.autopilot.stagedIndexWarnings?.size, 0);
});

test("a staged-index warning older than half an hour is dropped instead of advising a healed repo", async () => {
  const h = executorHost({ tasks: [task("first"), task("second", { dependsOn: ["first"], createdAt: 2 })], gitStage: "M  src/swept.js\n" });
  h.wake(); await h.pump();
  await h.finish("first"); await h.pump();
  // Healed AND aged out: the index no longer holds the staged files and the
  // parked entry is past its window, so neither path advises.
  const baseEyes = await h.env.getEyes();
  h.env.getEyes = async () => ({ ...baseEyes, gitPorcelain: async () => "" });
  h.advance(31 * 60 * 1000); h.wake(); await h.pump();
  assert.ok(!/CAUTION shared git index/.test(h.starts[1].child.prompt), "stale warnings age out");
  assert.equal(h.autopilot.stagedIndexWarnings?.size, 0, "the stale entry is consumed, not left behind");
});

test("staged-index advice survives a dispatcher restart through the dispatch-time porcelain probe", async () => {
  const h = executorHost({ tasks: [task("first"), task("second", { dependsOn: ["first"], createdAt: 2 })], gitStage: "M  src/swept.js\n" });
  h.wake(); await h.pump();
  await h.finish("first"); await h.pump();
  assert.equal(h.autopilot.stagedIndexWarnings?.size, 1, "the warning is parked before the restart");
  // A Studio restart drops the in-memory map; the staged files survive it.
  h.autopilot.stagedIndexWarnings = new Map();
  h.advance(31000); h.wake(); await h.pump();
  assert.match(h.starts[1].child.prompt, /CAUTION shared git index: the index currently holds staged-but-uncommitted file\(s\) \(src\/swept\.js\)/, "the probe re-derives the warning the restart dropped");
  assert.match(h.starts[1].child.prompt, /BEFORE editing/);
  assert.equal(h.autopilot.stagedIndexWarnings?.size, 0, "the probe reads git, it does not touch the map");
});

test("manual Pause remains durable through a completing job, repeated wakes and expired breaker time", async () => {
  const h = executorHost({ tasks: [task("first"), task("second", { createdAt: 2 })] });
  h.wake(); await h.pump();
  h.autopilot.parkedUntil = h.now() - 1;
  await h.env.setAutopilot({ execute: false });
  await h.finish("first"); h.advance(31000); await h.pump();
  h.wake(); await h.pump();
  assert.equal(h.board().tasks[0].status, "done", "already-finished evidence can settle without new paid execution");
  assert.equal(h.autopilot.execute, false); assert.equal(h.autopilot.parkedUntil, 0);
  assert.equal(h.starts.length, 1); assert.equal(h.board().tasks[1].status, "open");
  await h.env.setAutopilot({ execute: true }); await h.pump();
  assert.equal(h.starts.length, 2); assert.equal(h.starts[1].taskId, "second");
});

test("an unavailable evidence store does not consume retries or block independent work", async () => {
  const h = executorHost({ tasks: [task("first"), task("dependent", { dependsOn: ["first"], createdAt: 2 }), task("independent", { createdAt: 3 })] });
  h.wake(); await h.pump();
  const { sessionId } = await h.finish("first"); h.evidence(sessionId, new Error("fixture store warming"));
  h.advance(31000); await h.pump();
  assert.deepEqual(h.starts.map((start) => start.taskId), ["first", "independent"]);
  assert.equal(h.board().tasks[0].status, "awaiting_verification");
  assert.equal(h.board().tasks[0].verifyAttempts, undefined);
  await h.finish("independent"); h.evidence(sessionId, [{ file: "src/first.js", status: "completed" }]);
  h.advance(31000); await h.pump();
  assert.equal(h.starts.at(-1).taskId, "dependent");
});

test("permanently malformed attempt windows use bounded retry instead of waiting forever or reading old evidence", async () => {
  const invalid = [
    { runId: "legacy-run", at: 900000 },
    { startedAt: Infinity, at: 900000 },
    { startedAt: 800000, at: 0 },
    { startedAt: 950000, at: 900000 },
  ];
  const h = executorHost({ execute: false, tasks: invalid.map((window, i) => task(`invalid-${i}`, { status: "awaiting_verification", verifyAttempts: i === 3 ? 2 : 0, lastAttempt: { sessionId: `saved-${i}`, code: 0, ...window } })) });
  // Reader failure would mean pending; old session edits would mean verified.
  // Neither is correct for an irreparably invalid attribution window.
  for (let i = 0; i < invalid.length; i++) h.evidence(`saved-${i}`, i % 2 ? new Error("must not read an invalid window") : [{ file: "old-session.js", status: "completed" }]);
  h.wake(); await h.pump();
  for (const [index, row] of h.board().tasks.entries()) {
    assert.equal(row.status, "open");
    assert.equal(row.verifyAttempts, index === 3 ? 3 : 1);
    assert.equal(row.verification.state, index === 3 ? "failed" : "unverified");
    assert.equal(row.verification.changedFiles, 0);
  }
  assert.equal(h.starts.length, 0, "verification cannot resume paused execution");
});

test("lost own claims recover while fresh foreign claims and missing prerequisites stay held", async () => {
  const h = executorHost({ tasks: [
    task("foreign", { status: "active", runId: "foreign-run", lease: { pid: 999, at: 999999 } }),
    task("orphan", { status: "active", runId: "old-local-run", lease: { pid: 101, at: 999999 }, createdAt: 2 }),
    task("missing", { dependsOn: ["not-in-project"], createdAt: 3 }),
  ] });
  h.wake(); await h.pump();
  assert.deepEqual(h.starts.map((start) => start.taskId), ["orphan"]);
  assert.equal(h.board().tasks[0].runId, "foreign-run");
  assert.equal(h.board().tasks[2].status, "open");
});

test("a delegated child completes before its parent verifies, with no duplicate parent run or retry charge", async () => {
  const h = executorHost({ tasks: [task("parent")] });
  h.wake(); await h.pump();
  const { entry } = await h.finish("parent", { lines: ["MEFI_NEXT: Complete fixture child :: Finish the missing integration", "MEFI_RESULT: done: basic implementation; remaining: Complete fixture child", "MEFI_JOB_DONE"] });
  await h.pump();
  const child = h.board().tasks.find((row) => row.parent);
  assert.ok(child, "the real promotion creates a visible child task");
  assert.equal(child.parent, task("parent").title);
  assert.equal(child.fromRun, entry.id, "promotion retains the originating attempt identity");
  assert.equal(h.board().requests.find((row) => row.parent)?.fromRun, entry.id);
  h.advance(31000); h.wake(); await h.pump();
  const parent = h.board().tasks.find((row) => row.id === "parent");
  assert.equal(parent.status, "awaiting_verification", "parent waits while child still runs");
  assert.equal(parent.verifyAttempts, undefined, "normal delegation must not spend the parent retry budget");
  assert.equal(parent.handoffState.state, "waiting");
  assert.deepEqual(parent.remaining, ["Complete fixture child"]);
  await h.finish(child.id); h.advance(31000); await h.pump();
  h.wake(); await h.pump(); // a parent earlier in the board sees its newly verified child next pass
  assert.equal(h.board().tasks.find((row) => row.id === child.id).status, "done");
  assert.equal(h.board().tasks.find((row) => row.id === "parent").status, "done");
  assert.deepEqual(h.starts.map((start) => start.taskId), ["parent", child.id]);
});

function interruptedHandoff() {
  const obligations = captureTaskHandoffs({ id: "run_940000_parent", depth: 0, handoffs: [{ title: "Recover fixture continuation", prompt: "Preserve the exact acceptance brief after interrupted admission." }] }, { kind: "task", ref: { id: "parent" }, title: "Implement fixture parent" }, { now: 950000 });
  const parent = task("parent", { status: "awaiting_verification", remaining: [obligations[0].title], lastAttempt: { runId: "run_940000_parent", startedAt: 940000, at: 950000, code: 0, sawDone: true, sessionId: "saved-session", handoffs: obligations, result: { parts: { remaining: obligations[0].title } } } });
  return { parent, obligation: obligations[0] };
}

test("restart after parent settlement recovers its exact unadmitted child and completes without rerunning the parent", async () => {
  const { parent, obligation } = interruptedHandoff();
  const h = executorHost({ tasks: [parent] });
  h.evidence("saved-session", [{ file: "src/parent.js", status: "completed" }]);
  h.wake(); await h.pump();
  const child = h.board().tasks.find((row) => row.handoffId === obligation.handoffId);
  assert.ok(child); assert.equal(child.prompt, obligation.prompt);
  assert.deepEqual(h.starts.map((start) => start.taskId), [child.id]);
  h.wake(); await h.pump();
  assert.equal(h.board().tasks.filter((row) => row.handoffId === obligation.handoffId).length, 1);
  await h.finish(child.id); h.advance(31000); await h.pump(); h.wake(); await h.pump();
  assert.equal(h.board().tasks.find((row) => row.id === "parent").status, "done");
  assert.equal(h.starts.length, 1);
});

test("an exhausted delegated child holds its parent for review without blocking independent work", async () => {
  const { parent, obligation } = interruptedHandoff();
  const child = task("child", { ...obligation, id: "child", createdAt: 2, status: "open", runFailures: 4 });
  const h = executorHost({ tasks: [parent, child, task("independent", { createdAt: 3 })] });
  h.evidence("saved-session", [{ file: "src/parent.js", status: "completed" }]);
  h.wake(); await h.pump();
  assert.equal(h.starts[0].taskId, "child");
  await h.finish("child", { code: 1, lines: ["fixture child failed"] }); await h.pump();
  h.advance(31000); h.wake(); await h.pump();
  const saved = h.board().tasks.find((row) => row.id === "parent");
  assert.equal(saved.status, "awaiting_verification"); assert.equal(saved.verifyAttempts, undefined);
  assert.equal(saved.handoffState.state, "blocked"); assert.match(saved.handoffState.reason, /needs review/);
  assert.equal(h.board().tasks.find((row) => row.id === "child").runFailures, 5);
  assert.deepEqual(h.starts.map((start) => start.taskId), ["child", "independent"]);
  await h.finish("independent"); h.advance(31000); await h.pump();
  assert.equal(h.board().tasks.find((row) => row.id === "independent").status, "done");
  assert.equal(h.starts.length, 2, "repeated housekeeping neither retries an exhausted child nor duplicates its parent");
});

test("observed failed checks override the worker's passing prose while the next independent task starts", async () => {
  const h = executorHost({ tasks: [task("first"), task("second", { createdAt: 2 })] });
  h.wake(); await h.pump();
  await h.finish("first", { lines: ["MEFI_RESULT: done: implementation; tests: npm test passed; remaining: none", "MEFI_JOB_DONE"], observedChecks: [{ command: "npm test", status: "completed", exitCode: 1, passed: false, startedAt: h.now() }] });
  h.advance(31000); await h.pump();
  const saved = h.board().tasks.find((row) => row.id === "first");
  assert.equal(saved.status, "open"); assert.equal(saved.verifyAttempts, 1);
  assert.match(saved.verification.reason, /recorded checks failed/);
  assert.deepEqual(h.starts.map((start) => start.taskId), ["first", "second"]);
});

test("an unrelated completed card with the same title cannot swallow or falsely finish a new delegated obligation", async () => {
  const h = executorHost({ tasks: [task("parent"), task("unrelated", { title: "Shared generic title", prompt: "Old separate work", status: "done", doneAt: 999999 })] });
  h.wake(); await h.pump();
  await h.finish("parent", { lines: ["MEFI_NEXT: Shared generic title :: New distinct acceptance scope", "MEFI_RESULT: done: parent portion; remaining: Shared generic title", "MEFI_JOB_DONE"] }); await h.pump();
  const child = h.board().tasks.find((row) => row.handoffId);
  assert.ok(child); assert.equal(child.originalTitle, "Shared generic title"); assert.match(child.title, /follow-up/);
  assert.equal(child.prompt, "New distinct acceptance scope");
  h.advance(31000); h.wake(); await h.pump();
  assert.equal(h.board().tasks.find((row) => row.id === "parent").status, "awaiting_verification");
  await h.finish(child.id); h.advance(31000); await h.pump(); h.wake(); await h.pump();
  assert.equal(h.board().tasks.find((row) => row.id === "parent").status, "done");
  assert.deepEqual(h.starts.map((start) => start.taskId), ["parent", child.id]);
});

for (const [oldTitle, childTitle] of [["Fix: stale imports", "Fix: stale imports"], ["Plan: queue — 2 tasks", "Plan: queue — 3 tasks"]]) test(`themed handoff ${childTitle} gets a durable child card instead of disappearing after direct request completion`, async () => {
  const h = executorHost({ tasks: [task("parent"), task("unrelated", { title: oldTitle, prompt: "Different old scope", status: "done", doneAt: 999999 })] });
  h.wake(); await h.pump();
  await h.finish("parent", { lines: [`MEFI_NEXT: ${childTitle} :: New distinct acceptance scope`, `MEFI_RESULT: done: parent portion; remaining: ${childTitle}`, "MEFI_JOB_DONE"] }); await h.pump();
  const child = h.board().tasks.find((row) => row.handoffId);
  assert.ok(child, "theme deduplication cannot swallow admitted lineage");
  assert.ok(h.starts.every((start) => start.taskId), "no child runs as an ephemeral inbox record");
  await h.finish(child.id); h.advance(31000); await h.pump(); h.wake(); await h.pump();
  assert.equal(h.board().tasks.find((row) => row.id === "parent").status, "done");
  assert.deepEqual(h.starts.map((start) => start.taskId), ["parent", child.id]);
});

test("handoffs beyond the promotion batch wait for durable cards while all three worker slots refill", async () => {
  const parent = (id) => {
    const handoffs = captureTaskHandoffs({ id: `run_940000_${id}`, depth: 0, handoffs: Array.from({ length: 3 }, (_, i) => ({ title: `${id} child ${i}`, prompt: `Exact ${id} obligation ${i}` })) }, { kind: "task", ref: { id }, title: id }, { now: 950000 });
    return task(id, { status: "awaiting_verification", remaining: handoffs.map((row) => row.title), lastAttempt: { runId: `run_940000_${id}`, startedAt: 940000, at: 950000, code: 0, sawDone: true, sessionId: id, handoffs } });
  };
  const h = executorHost({ tasks: [parent("parent-a"), parent("parent-b")], parallel: 3 });
  for (const id of ["parent-a", "parent-b"]) h.evidence(id, [{ file: `src/${id}.js`, status: "completed" }]);
  h.wake(); await h.pump();
  assert.equal(h.starts.length, 3); assert.ok(h.starts.every((start) => start.taskId));
  assert.equal(h.board().tasks.filter((row) => row.handoffId).length, 3);
  for (const start of [...h.starts]) await h.finish(start.taskId);
  h.advance(31000); await h.pump();
  assert.equal(h.starts.length, 6); assert.ok(h.starts.every((start) => start.taskId));
  assert.equal(h.board().tasks.filter((row) => row.handoffId).length, 6);
  for (const start of h.starts.slice(3)) await h.finish(start.taskId);
  h.advance(31000); await h.pump(); h.wake(); await h.pump();
  assert.ok(h.board().tasks.every((row) => row.status === "done"));
  assert.equal(new Set(h.starts.map((start) => start.taskId)).size, 6);
});

test("failed termination preserves file ownership while independent work continues and recovers after confirmed exit", async () => {
  const h = executorHost({ parallel: 2, tasks: [task("stuck"), task("overlap", { files: ["src/stuck.js"], createdAt: 2 }), task("independent", { createdAt: 3 })] });
  h.wake(); await h.pump();
  assert.deepEqual(h.starts.map((start) => start.taskId), ["stuck", "independent"]);
  const stuck = h.autopilot.jobs.find((job) => job.taskId === "stuck");
  stuck.stop("fixture worker budget expired");
  assert.equal(h.terminations[0].pid, stuck.pid);
  h.terminations[0].child.emit("error", new Error("fixture permission denied"));
  await h.finish("independent"); h.advance(31000); await h.pump();
  assert.equal(h.board().tasks.find((row) => row.id === "independent").status, "done");
  assert.equal(h.board().tasks.find((row) => row.id === "stuck").status, "active");
  assert.equal(h.board().tasks.find((row) => row.id === "overlap").status, "open");
  assert.equal(h.starts.length, 2, "a free slot cannot bypass the live writer's file claim");
  assert.equal(h.registry.size, 1);
  assert.equal(stuck.finished, false);
  assert.match(stuck.stopping.error, /permission denied/);
  await h.timers.findLast((timer) => timer.delay === 15000 && !timer.cancelled).fn();
  h.terminations[1].child.emit("close", 0);
  // Process callbacks begin asynchronous board settlement; drain its microtasks
  // before asking the foreman to claim the newly available file.
  for (let tick = 0; tick < 12; tick++) await Promise.resolve();
  h.wake(); await h.pump();
  const saved = h.board().tasks.find((row) => row.id === "stuck");
  assert.equal(saved.runFailures, 1);
  assert.equal(saved.status, "open");
  assert.deepEqual(h.starts.map((start) => start.taskId), ["stuck", "independent", "overlap"]);
  assert.equal(h.registry.size, 1, "only the next worker owns the shared file after termination");
});

test("a run at the depth limit that hands off anyway settles on its own evidence instead of stalling its chain", async () => {
  const h = executorHost({ tasks: [task("leaf", { depth: 3 })] });
  h.wake(); await h.pump();
  assert.match(h.starts[0].child.prompt, /Do not hand off any further work/, "the limit is stated in the brief");
  await h.finish("leaf", { lines: ["MEFI_NEXT: One more piece :: do the next part", "MEFI_RESULT: done: the change; remaining: none", "MEFI_JOB_DONE"] });
  await h.pump();
  const reported = h.board().tasks.find((row) => row.id === "leaf");
  assert.equal(reported.remaining, undefined, "a hand-off past the limit is not an obligation the card could ever discharge");
  assert.ok(reported.logs.some((row) => /1 hand-off\(s\) declined at the depth limit, not queued: "One more piece"/.test(row.text)), "the declined title stays visible on the card");
  assert.equal(h.board().requests.length, 0, "nothing is queued past the chain's limit");
  h.advance(31000); h.wake(); await h.pump();
  assert.equal(h.board().tasks.find((row) => row.id === "leaf").status, "done");
  assert.equal(h.starts.length, 1, "the leaf runs once instead of being reopened three times and parked");
});

test("below the depth limit a hand-off still becomes a child the parent waits for", async () => {
  const h = executorHost({ tasks: [task("middle", { depth: 2 })] });
  h.wake(); await h.pump();
  await h.finish("middle", { lines: ["MEFI_NEXT: One more piece :: do the next part", "MEFI_RESULT: done: the change; remaining: none", "MEFI_JOB_DONE"] });
  await h.pump();
  assert.deepEqual(h.board().tasks.find((row) => row.id === "middle").remaining, ["One more piece"]);
  assert.ok(!h.board().tasks.find((row) => row.id === "middle").logs.some((row) => /declined/.test(row.text)));
});
