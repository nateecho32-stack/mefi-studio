// The fleet's pure half (scripts/fleet.cjs): seats that outlive their runs,
// the wires between them, and what the Fleet view is told, driven with the
// same observations main's hooks feed it (brain events, executor status pushes
// and board writes) on a fake clock.
import test from "node:test";
import assert from "node:assert/strict";
import fleet from "../scripts/fleet.cjs";

const T0 = 1_800_000_000_000;
const MIN = 60 * 1000;

function start(state, { runId, taskId, title = "A task", at, parallel = 3, others = [] }) {
  fleet.observeStatus(state, { parallel, loop: { state: "running", on: true, ready: 0 }, running: [...others, { id: runId, taskId, title, startedAt: at, phase: "building", lastOutputAt: at }] }, at);
  fleet.observeEvent(state, { kind: "agent.out", at, runId, taskId, title, model: "fable-5", text: "opencode" });
}

function view(state, at, extra = {}) {
  return fleet.snapshot(state, { projectId: "project_1", projectName: "Mefi Studio", roster: [], team: { executorCli: "opencode", executorModel: "fable-5" }, at, ...extra });
}

const seat = (snapshot, id) => snapshot.pods.flatMap((pod) => pod.seats).find((item) => item.id === id);

test("known waits appear immediately, oldest first, preserve age on escalation and clear on answer", () => {
  const state = fleet.emptyState();
  const running = ["run_1", "run_2"].map((id, index) => ({ id, taskId: `task_${index}`, startedAt: T0, phase: "building" }));
  fleet.observeStatus(state, { parallel: 3, running }, T0);
  fleet.observeEvent(state, { kind: "help.ask", runId: "run_2", at: T0 + MIN, text: "Approve the preview permission" });
  fleet.observeEvent(state, { kind: "help.ask", runId: "run_1", at: T0 + 2 * MIN, text: "Which test owns this?" });
  let signals = fleet.health(state, T0 + 3 * MIN);
  assert.deepEqual(signals.map(item => item.id), ["ask:run_2", "ask:run_1"]);
  assert.equal(signals[0].reason, "Approve the preview permission");
  assert.equal(signals[0].severity, "info", "a fresh question is visible without an alarm");
  fleet.observeEvent(state, { kind: "help.answer", runId: "run_2", at: T0 + 4 * MIN, ok: false, text: "Owner permission required" });
  const blocked = seat(view(state, T0 + 5 * MIN), "builder-2");
  assert.equal(blocked.now.waitingSince, T0 + MIN);
  assert.equal(blocked.now.blocker, "Owner permission required");
  signals = fleet.health(state, T0 + 20 * MIN);
  assert.deepEqual(signals.map(item => item.id), ["escalated:run_2", "ask:run_1"], "known waits replace ambiguous quiet warnings");
  fleet.observeEvent(state, { kind: "help.answer", runId: "run_1", at: T0 + 21 * MIN, ok: true });
  assert.ok(!fleet.health(state, T0 + 21 * MIN).some(item => item.id === "ask:run_1"));
  fleet.observeEvent(state, { kind: "help.answer", runId: "run_2", at: T0 + 22 * MIN, ok: true });
  assert.equal(seat(view(state, T0 + 22 * MIN), "builder-2").status, "working");
  assert.ok(!fleet.health(state, T0 + 22 * MIN).some(item => item.id === "escalated:run_2"));
});

test("a long silent tool reports its tool state without claiming failure", () => {
  const state = fleet.emptyState();
  fleet.observeStatus(state, { parallel: 3, running: [{ id: "run_1", startedAt: T0, phase: "building", currentStep: "Bash running · full test suite", stepUpdatedAt: T0, tool: { name: "Bash", status: "running", since: T0 } }] }, T0);
  const quiet = fleet.health(state, T0 + 11 * MIN).find(item => item.id === "quiet:run_1");
  assert.match(quiet.reason, /full test suite/);
  assert.match(quiet.why, /Bash is reported in flight/);
  assert.match(quiet.why, /not proof of a failure/);
  assert.equal(seat(view(state, T0 + 11 * MIN), "builder-1").status, "working");
});

function handedOffTasks() {
  const state = fleet.emptyState();
  const tasks = [{ id: "parent_task", title: "Prepare the parser", status: "active" },
    ...Array.from({ length: 3 }, (_, index) => ({ id: `child_${index}`, title: `Check parser part ${index}`, status: "active", fromRun: "parent_run" }))];
  fleet.observeTasks(state, tasks, T0);
  const parent = { id: "parent_run", taskId: "parent_task", title: "Prepare the parser", startedAt: T0, phase: "building", lastOutputAt: T0 };
  start(state, { runId: parent.id, taskId: parent.taskId, at: T0 });
  for (let index = 0; index < 3; index += 1) {
    start(state, { runId: `child_run_${index}`, taskId: `child_${index}`, at: T0 + (index + 1) * 1000, others: [parent] });
    fleet.observeEvent(state, { kind: "agent.home", runId: `child_run_${index}`, at: T0 + (index + 1) * 1000 + 1, ok: true });
  }
  return { state, tasks, parent };
}

const handoffNotes = (state, at = T0 + 5000) => fleet.health(state, at).filter(item => item.id.startsWith("handoff-progress:"));

test("real handoff observations produce an informational note without changing history, dispatch or attention", () => {
  const { state } = handedOffTasks();
  const before = fleet.serialize(state);
  const notes = handoffNotes(state);
  assert.equal(notes.length, 1); assert.equal(notes[0].seatId, "builder-1");
  assert.equal(notes[0].severity, "info"); assert.equal(notes[0].count, 3);
  assert.match(notes[0].why, /Waiting for verification can be normal/);
  assert.deepEqual(notes[0].evidence.map(item => item.taskId), ["child_2", "child_1", "child_0"]);
  assert.deepEqual(notes[0].inspect, { view: "seat", seatId: "builder-1" });
  assert.equal(view(state, T0 + 5000).counts.attention, 0);
  assert.deepEqual(fleet.serialize(state), before);
  assert.equal(state.live.runs.get("parent_run").seatId, "builder-1");
});

test("repeated handoff events and title changes cannot inflate distinct task activity", () => {
  const { state } = handedOffTasks();
  state.recent = state.recent.filter(item => item.kind !== "handed_off" || item.taskId !== "child_2");
  const original = state.recent.find(item => item.kind === "handed_off" && item.taskId === "child_0");
  state.recent.push(...Array.from({ length: 10 }, (_, index) => ({ ...original, at: T0 + 4000 + index, title: `Updated title ${index}` })));
  assert.deepEqual(handoffNotes(state), []);
});

test("a reported completion stays pending, while verified or human-confirmed child evidence clears its note", () => {
  for (const outcome of ["verified", "manual"]) {
    const { state, tasks } = handedOffTasks();
    assert.equal(handoffNotes(state).length, 1, "successful reports alone are not verified progress");
    fleet.observeTasks(state, tasks.map(task => task.id === "child_1" ? { ...task, status: "done", verification: { state: outcome, at: T0 + 6000 } } : task), T0 + 6000);
    assert.deepEqual(handoffNotes(state, T0 + 7000), []);
    assert.deepEqual(handoffNotes(fleet.normalize(fleet.serialize(state)), T0 + 7000), []);
  }
});

test("handoff notes expire, ignore future events, and do not reuse verification from before a new handoff", () => {
  const { state, tasks, parent } = handedOffTasks();
  assert.deepEqual(handoffNotes(state, T0 + fleet.LIMITS.handoffWindowMs + 5000), []);
  const row = state.recent.find(item => item.kind === "handed_off" && item.taskId === "child_2");
  row.at = T0 + 100000;
  assert.deepEqual(handoffNotes(state), []);
  row.at = T0 + 3000;
  fleet.observeTasks(state, tasks.map(task => task.id === "child_1" ? { ...task, status: "done", verification: { state: "verified", at: T0 + 6000 } } : task), T0 + 6000);
  assert.deepEqual(handoffNotes(state, T0 + 7000), []);
  fleet.observeTasks(state, tasks, T0 + 8000);
  start(state, { runId: "child_retry", taskId: "child_1", at: T0 + 9000, others: [parent] });
  assert.equal(handoffNotes(state, T0 + 10000)[0].count, 3);
});

test("seat recaps retain interrupted and verified history without treating a live run as finished", () => {
  const state = fleet.emptyState();
  fleet.observeTasks(state, [{ id: "task_a", status: "active" }], T0);
  start(state, { runId: "interrupted", taskId: "task_a", at: T0 });
  fleet.observeFinish(state, { runId: "interrupted", userStop: true, result: { parts: { done: "Saved parser checkpoint", remaining: "Finish parser" } } });
  fleet.observeEvent(state, { kind: "agent.home", at: T0 + 1000, runId: "interrupted", ok: false });
  start(state, { runId: "resumed", taskId: "task_a", at: T0 + 2000 });
  fleet.observeFinish(state, { runId: "resumed", ok: true, result: { parts: { done: "Parser tests passed" } } });
  fleet.observeEvent(state, { kind: "agent.home", at: T0 + 3000, runId: "resumed", ok: true });
  const pending = fleet.seatRecap(state, "builder-1");
  assert.match(pending.text, /verification pending/);
  fleet.observeTasks(state, [{ id: "task_a", status: "done", verification: { state: "verified", at: T0 + 4000 } }], T0 + 4000);
  start(state, { runId: "current", taskId: "task_b", title: "Unfinished current task", at: T0 + 5000 });
  const recap = fleet.runRecap(state, "current", "task_b");
  assert.deepEqual(recap.generations.map(gen => gen.outcome), ["verified", "stopped"]);
  assert.match(recap.text, /Verified/); assert.match(recap.text, /Interrupted; progress saved/);
  assert.match(recap.text, /Finish parser/); assert.doesNotMatch(recap.text, /Unfinished current task/);
  assert.equal(fleet.runRecap(state, "current", "different_task"), null);
  assert.equal(fleet.runRecap(state, "unknown_run", "task_b"), null);
  const reloaded = fleet.normalize(fleet.serialize(state));
  assert.match(fleet.seatRecap(reloaded, "builder-1").text, /Saved parser checkpoint/);
});

test("seat recap handoffs collapse exact repeats and retain distinct saved child tasks", () => {
  const state = fleet.emptyState();
  start(state, { runId: "parent", taskId: "task_a", at: T0 });
  fleet.observeEvent(state, { kind: "agent.home", at: T0 + 1000, runId: "parent", ok: true });
  const row = { kind: "handed_off", from: "builder-1", to: "builder-2", taskId: "child_a", title: "Verify parser", at: T0 + 2000 };
  state.recent.push(row, { ...row }, { ...row, taskId: "child_b" });
  const recap = fleet.seatRecap(state, "builder-1");
  assert.deepEqual(recap.handoffs.map(item => item.taskId), ["child_b", "child_a"]);
  assert.equal(recap.text.split("Handed to").length - 1, 2);
});

test("seat recaps stay bounded and retain the newest generations without rewriting the ledger", () => {
  const state = fleet.emptyState();
  for (let index = 0; index < 8; index += 1) {
    start(state, { runId: `run_${index}`, taskId: "task_a", title: "T".repeat(90), at: T0 + index * 2000 });
    fleet.observeFinish(state, { runId: `run_${index}`, ok: true, result: { parts: { done: "D".repeat(160), remaining: "R".repeat(160) } } });
    fleet.observeEvent(state, { kind: "agent.home", at: T0 + index * 2000 + 1000, runId: `run_${index}`, ok: true });
  }
  const before = fleet.serialize(state);
  const recap = fleet.seatRecap(state, "builder-1");
  assert.equal(recap.generations.length, 4); assert.equal(recap.generations[0].runId, "run_7");
  assert.ok(recap.text.length <= 1500); assert.equal(recap.truncated, true);
  assert.deepEqual(fleet.serialize(state), before); assert.equal(state.seats["builder-1"].lineage.length, 8);
  assert.equal(fleet.seatRecap(state, "not-a-seat"), null);
});

test("a team shows its pods left to right with a builder seat per parallel slot and the core seats", () => {
  const state = fleet.emptyState();
  fleet.observeStatus(state, { parallel: 2, loop: { state: "idle", on: true, ready: 0 }, running: [] }, T0);
  const snapshot = view(state, T0, { roster: [{ role: "watcher", status: "done", runs: 3 }, { role: "grower", status: "idle", runs: 0 }] });
  assert.deepEqual(snapshot.pods.map((pod) => pod.id), ["lead", "build", "check", "keep"]);
  assert.deepEqual(snapshot.pods.map((pod) => pod.seats.map((item) => item.id)), [["lead", "foreman"], ["builder-1", "builder-2"], ["overseer", "desk"], ["watcher"]]);
  assert.equal(seat(snapshot, "builder-1").address, "builder-1@mefi-studio");
  assert.deepEqual(seat(snapshot, "builder-1").runtime, { via: "opencode", model: "fable-5", route: null });
  assert.equal(seat(snapshot, "builder-2").status, "idle");
  assert.equal(snapshot.counts.seats, 7);
});

test("a run takes a seat as its next generation, goes home, and is verified on the same seat", () => {
  const state = fleet.emptyState();
  fleet.observeTasks(state, [{ id: "task_a", title: "Wire the fleet", status: "active" }], T0);
  start(state, { runId: "run_1", taskId: "task_a", title: "Wire the fleet", at: T0 });
  let snapshot = view(state, T0 + 1000);
  assert.equal(seat(snapshot, "builder-1").status, "working");
  assert.equal(seat(snapshot, "builder-1").now.runId, "run_1");
  assert.equal(seat(snapshot, "builder-1").gen, 1);
  assert.deepEqual(snapshot.recent.map((row) => [row.kind, row.from, row.to]), [["claimed", "foreman", "builder-1"]]);

  fleet.observeEvent(state, { kind: "agent.home", at: T0 + 5 * MIN, runId: "run_1", taskId: "task_a", ok: true });
  fleet.observeTasks(state, [{ id: "task_a", title: "Wire the fleet", status: "awaiting_verification" }], T0 + 5 * MIN);
  fleet.observeTasks(state, [{ id: "task_a", title: "Wire the fleet", status: "done", verification: { state: "verified", at: T0 + 9 * MIN } }], T0 + 9 * MIN);
  snapshot = view(state, T0 + 10 * MIN);
  assert.equal(seat(snapshot, "builder-1").status, "idle");
  // The ids let the page open the run's task and its orb from an idle seat.
  assert.deepEqual(seat(snapshot, "builder-1").last, { gen: 1, taskId: "task_a", runId: "run_1", title: "Wire the fleet", outcome: "verified", endedAt: T0 + 5 * MIN });
  assert.deepEqual(snapshot.recent.map((row) => row.kind), ["verified", "completed", "claimed"]);
  assert.deepEqual(snapshot.edges.map((item) => [item.from, item.to, item.kind]).sort(), [["builder-1", "overseer", "verify"], ["foreman", "builder-1", "dispatch"]]);
  const detail = fleet.seatDetail(state, "builder-1", { projectName: "Mefi Studio", at: T0 + 10 * MIN });
  assert.equal(detail.lineage.length, 1);
  assert.equal(detail.lineage[0].model, "fable-5");
  assert.equal(detail.lineage[0].via, "opencode");
});

test("a retry goes back to the seat that last worked the task; a parallel run takes the next free seat", () => {
  const state = fleet.emptyState();
  fleet.observeTasks(state, [{ id: "task_a", status: "active" }, { id: "task_b", status: "open" }], T0);
  start(state, { runId: "run_1", taskId: "task_a", at: T0 });
  fleet.observeEvent(state, { kind: "agent.home", at: T0 + MIN, runId: "run_1", ok: false });
  start(state, { runId: "run_2", taskId: "task_b", at: T0 + 2 * MIN });
  assert.equal(state.live.runSeat.get("run_2"), "builder-1");
  // task_a's seat is busy with task_b now, so its retry sits on builder-2.
  start(state, { runId: "run_3", taskId: "task_a", at: T0 + 3 * MIN, others: [{ id: "run_2", taskId: "task_b", startedAt: T0 + 2 * MIN, phase: "building" }] });
  assert.equal(state.live.runSeat.get("run_3"), "builder-2");
  fleet.observeEvent(state, { kind: "agent.home", at: T0 + 4 * MIN, runId: "run_3", ok: false });
  fleet.observeEvent(state, { kind: "agent.home", at: T0 + 4 * MIN, runId: "run_2", ok: true });
  // Both free again: the next retry of task_a returns to builder-2, its last seat.
  start(state, { runId: "run_4", taskId: "task_a", at: T0 + 5 * MIN });
  assert.equal(state.live.runSeat.get("run_4"), "builder-2");
  assert.deepEqual(state.seats["builder-2"].lineage.map((gen) => [gen.gen, gen.runId]), [[1, "run_3"], [2, "run_4"]]);
  assert.deepEqual(state.seats["builder-1"].lineage.map((gen) => [gen.gen, gen.outcome]), [[1, "failed"], [2, "awaiting"]]);
});

test("handed-off and delegated work draws its wire from the seat it came from", () => {
  const state = fleet.emptyState();
  fleet.observeTasks(state, [{ id: "task_a", status: "active" }], T0);
  start(state, { runId: "run_1", taskId: "task_a", at: T0 });
  fleet.observeTasks(state, [
    { id: "task_a", status: "active" },
    { id: "task_h", status: "open", fromRun: "run_1", title: "Follow-up from the run" },
    { id: "task_c", status: "open", parentTaskId: "task_a", title: "A delegated part" },
  ], T0 + MIN);
  start(state, { runId: "run_2", taskId: "task_h", title: "Follow-up from the run", at: T0 + 2 * MIN, others: [{ id: "run_1", taskId: "task_a", startedAt: T0, phase: "building" }] });
  start(state, { runId: "run_3", taskId: "task_c", title: "A delegated part", at: T0 + 3 * MIN, others: [{ id: "run_1", taskId: "task_a", startedAt: T0, phase: "building" }, { id: "run_2", taskId: "task_h", startedAt: T0 + 2 * MIN, phase: "building" }] });
  const snapshot = view(state, T0 + 4 * MIN);
  const wires = snapshot.edges.map((item) => `${item.from}>${item.to}:${item.kind}`).sort();
  assert.ok(wires.includes("builder-1>builder-2:handoff"), wires.join(", "));
  assert.ok(wires.includes("builder-1>builder-3:delegation"), wires.join(", "));
  assert.deepEqual(snapshot.recent.slice(0, 2).map((row) => [row.kind, row.from, row.to]), [["delegated", "builder-1", "builder-3"], ["handed_off", "builder-1", "builder-2"]]);
  // A delegated child's report flows back up to its parent's seat.
  fleet.observeEvent(state, { kind: "report", at: T0 + 5 * MIN, taskId: "task_a", from: "task_c", runId: "run_3", text: "added the reducer" });
  assert.ok(view(state, T0 + 5 * MIN).edges.some((item) => item.from === "builder-3" && item.to === "builder-1" && item.kind === "report"));
});

test("a question to the desk makes the seat wait; an escalation blocks it on you", () => {
  const state = fleet.emptyState();
  start(state, { runId: "run_1", taskId: "task_a", at: T0 });
  fleet.observeEvent(state, { kind: "help.ask", at: T0 + MIN, runId: "run_1", taskId: "task_a", text: "Which test file owns this?" });
  let snapshot = view(state, T0 + MIN);
  assert.equal(seat(snapshot, "builder-1").status, "waiting");
  assert.equal(seat(snapshot, "desk").status, "working");
  assert.equal(seat(snapshot, "desk").text, "1 open question");
  fleet.observeEvent(state, { kind: "help.answer", at: T0 + 2 * MIN, runId: "run_1", taskId: "task_a", ok: false, text: "escalated: needs the owner" });
  snapshot = view(state, T0 + 2 * MIN);
  assert.equal(seat(snapshot, "builder-1").status, "blocked");
  assert.ok(snapshot.edges.some((item) => item.from === "desk" && item.to === "you" && item.kind === "escalate"));
  assert.equal(snapshot.health[0].severity, "bad");
  assert.equal(snapshot.health[0].seatId, "builder-1");
});

test("the owner's stop outranks the run's failed exit, and a stopped card says who stopped it", () => {
  const state = fleet.emptyState();
  fleet.observeTasks(state, [{ id: "task_a", status: "active" }], T0);
  start(state, { runId: "run_1", taskId: "task_a", at: T0 });
  fleet.observeFinish(state, { runId: "run_1", ok: false, userStop: true, result: { parts: { done: "read the files", next: "wire the IPC" } } });
  fleet.observeEvent(state, { kind: "agent.home", at: T0 + MIN, runId: "run_1", ok: false });
  const gen = state.seats["builder-1"].lineage[0];
  assert.equal(gen.outcome, "stopped");
  assert.deepEqual(gen.result, { done: "read the files", next: "wire the IPC" });
  assert.deepEqual(view(state, T0 + MIN).recent[0], { seq: 2, at: T0 + MIN, kind: "stopped", from: "you", to: "builder-1", taskId: "task_a", title: "A task", text: null });
});

test("a run the status loses is concluded after the grace period, and a late report home refines it", () => {
  const state = fleet.emptyState();
  start(state, { runId: "run_1", taskId: "task_a", at: T0 });
  fleet.observeStatus(state, { parallel: 3, loop: { state: "running", on: true, ready: 0 }, running: [] }, T0 + MIN);
  assert.equal(seat(view(state, T0 + MIN), "builder-1").status, "idle", "a lost run no longer shows as working");
  assert.ok(state.live.runs.has("run_1"), "but it is not concluded before the grace period");
  fleet.sweep(state, T0 + MIN + fleet.LIMITS.goneGraceMs);
  assert.equal(state.seats["builder-1"].lineage[0].outcome, "lost");
  fleet.observeEvent(state, { kind: "agent.home", at: T0 + 3 * MIN, runId: "run_1", ok: true });
  assert.equal(state.seats["builder-1"].lineage[0].outcome, "awaiting");
  // The status listing the finished run again for a moment does not seat it twice.
  fleet.observeStatus(state, { parallel: 3, running: [{ id: "run_1", taskId: "task_a", startedAt: T0, phase: "finishing" }] }, T0 + 3 * MIN);
  assert.equal(state.live.runs.size, 0);
  assert.equal(state.seats["builder-1"].gen, 1);
});

test("mail draws wires only between seats the team has", () => {
  const state = fleet.emptyState();
  fleet.observeEvent(state, { kind: "mail", at: T0, from: "overseer", to: "foreman", text: "two cards are repeating work" });
  fleet.observeEvent(state, { kind: "mail", at: T0, from: "assistant", to: "keeper", text: "tidy the done column" });
  fleet.observeEvent(state, { kind: "mail", at: T0, from: "builder", to: "foreman", text: "generic sender" });
  fleet.observeEvent(state, { kind: "mail", at: T0, from: "C:\\Users\\someone", to: "foreman", text: "a path is not a seat" });
  assert.deepEqual(state.edges.map((item) => `${item.from}>${item.to}`), ["overseer>foreman", "lead>keeper"]);
});

test("health names quiet runs, retry loops, kept branches and a loop holding ready work", () => {
  const state = fleet.emptyState();
  fleet.observeTasks(state, [{ id: "task_a", status: "active" }], T0);
  for (let index = 1; index <= 3; index += 1) {
    start(state, { runId: `run_${index}`, taskId: "task_a", at: T0 + index * MIN });
    fleet.observeEvent(state, { kind: "agent.home", at: T0 + index * MIN + 1000, runId: `run_${index}`, ok: false });
  }
  fleet.observeMerge(state, { runId: "run_3", branch: "mefi/run_3", merged: false, reason: "conflict in main.cjs" }, T0 + 4 * MIN);
  start(state, { runId: "run_9", taskId: "task_b", at: T0 + 5 * MIN });
  fleet.observeStatus(state, { parallel: 3, loop: { state: "paused", on: false, ready: 4, headline: "Agents are paused", reason: "Paused from the tray" }, running: [{ id: "run_9", taskId: "task_b", startedAt: T0 + 5 * MIN, phase: "building", lastOutputAt: T0 + 5 * MIN }] }, T0 + 6 * MIN);
  const ids = fleet.health(state, T0 + 20 * MIN).map((signal) => signal.id);
  assert.deepEqual(ids.sort(), ["kept:run_3", "loop:paused", "quiet:run_9", "retry:task_a"]);
  const snapshot = view(state, T0 + 20 * MIN);
  assert.equal(snapshot.counts.attention, 3, "the kept branch is information, not attention");
  assert.equal(seat(snapshot, "builder-2").status, "off", "idle builders read as off while agents are paused");
  assert.equal(snapshot.loop.headline, "Agents are paused");
});

test("the saved file round-trips bounded, drops what it cannot trust and ends runs cut off by a restart", () => {
  const state = fleet.emptyState();
  for (let index = 1; index <= fleet.LIMITS.lineage + 5; index += 1) {
    start(state, { runId: `run_${index}`, taskId: `task_${index}`, at: T0 + index * MIN });
    if (index < fleet.LIMITS.lineage + 5) fleet.observeEvent(state, { kind: "agent.home", at: T0 + index * MIN + 1, runId: `run_${index}`, ok: true });
  }
  const saved = JSON.parse(JSON.stringify(fleet.serialize(state)));
  saved.seats["C:\\bad path"] = { gen: 1, lineage: [{ gen: 1, runId: "run_x" }] };
  saved.recent.push({ kind: "exploded", at: T0 });
  saved.edges.push({ from: "builder-1", to: "builder-1", kind: "mail", count: 1, lastAt: T0 });
  const restored = fleet.normalize(saved);
  assert.equal(restored.seats["builder-1"].lineage.length, fleet.LIMITS.lineage);
  assert.equal(restored.seats["builder-1"].gen, fleet.LIMITS.lineage + 5);
  assert.equal(restored.seats["builder-1"].lineage.at(-1).outcome, "lost", "the run that was live at the save ended with Studio");
  assert.ok(!Object.keys(restored.seats).some((key) => key.includes("\\")));
  assert.ok(restored.recent.every((item) => item.kind !== "exploded"));
  assert.ok(restored.edges.every((item) => item.from !== item.to));
  assert.equal(restored.live.taskSeat.get(`task_${fleet.LIMITS.lineage + 5}`), "builder-1");
  assert.equal(fleet.normalize(null).seq, 0);
  assert.equal(fleet.normalize({ v: 2, seats: {} }).seq, 0);
});

test("a snapshot carries clipped titles and ids only — never prompts or paths", () => {
  const state = fleet.emptyState();
  const long = "x".repeat(400);
  fleet.observeTasks(state, [{ id: "task_a", status: "active", title: long, prompt: "SECRET PROMPT TEXT", files: ["C:\\Users\\me\\secret.txt"] }], T0);
  start(state, { runId: "run_1", taskId: "task_a", title: long, at: T0 });
  const text = JSON.stringify(view(state, T0 + 1000));
  assert.ok(!text.includes("SECRET PROMPT TEXT"));
  assert.ok(!text.includes("secret.txt"));
  assert.ok(!text.includes("x".repeat(fleet.LIMITS.title + 1)));
});

test("text that reorders or hides other text never reaches a snapshot", () => {
  const state = fleet.emptyState();
  const marks = [0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0x200b, 0x200e, 0x200f, 0x2060, 0xfeff].map((code) => String.fromCharCode(code)).join("");
  const title = `Pay${marks} the invoice${String.fromCharCode(0x202e)}txt.exe`;
  start(state, { runId: "run_1", taskId: "task_a", title, at: T0 });
  fleet.observeEvent(state, { kind: "mail", at: T0 + 500, from: "foreman", to: "lead", text: `all${marks} clear` });
  const text = JSON.stringify(view(state, T0 + 1000));
  for (const code of [0x202a, 0x202b, 0x202d, 0x202e, 0x2066, 0x2069, 0x200b, 0x200e, 0x200f, 0x2060, 0xfeff]) {
    assert.ok(!text.includes(String.fromCharCode(code)), `U+${code.toString(16)} is left out`);
  }
  assert.match(text, /Pay the invoicetxt\.exe/);
  assert.match(text, /all clear/);
});

test("an idle seat's last run carries the ids that let the page open its task and its orb", () => {
  const state = fleet.emptyState();
  start(state, { runId: "run_1", taskId: "task_a", title: "First", at: T0 });
  assert.equal(seat(view(state, T0 + MIN), "builder-1").last, null, "a seat that is running has no last run");
  fleet.observeEvent(state, { kind: "agent.home", at: T0 + 2 * MIN, runId: "run_1", taskId: "task_a", title: "First", ok: true });
  fleet.observeStatus(state, { parallel: 3, loop: { state: "running", on: true, ready: 0 }, running: [] }, T0 + 2 * MIN);
  const last = seat(view(state, T0 + 3 * MIN), "builder-1").last;
  assert.equal(last.taskId, "task_a");
  assert.equal(last.runId, "run_1");
  assert.equal(seat(view(state, T0 + 3 * MIN), "lead").last, null, "a seat with no runs has none");
});
