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
