"use strict";
// The fleet (docs/fleet-overhaul-plan.md, Phase 1): every agent seat on the
// open project's team, what each one is doing now, the generations (runs) each
// seat has had, and the wires between seats. The words are OpenRig's: a seat
// is a stable address ("builder-2@mefi-studio") that outlives its runs — the
// agent changes, the seat carries on — and a pod groups seats that share a job.
//
// Pure module: no Electron, no filesystem, no network, no processes, no
// timers, no clock reads. fleet-host.cjs feeds it what main already knows (a
// brain event, an executor status, a board write, a worktree merge, a run's
// end) with the time it happened, and saves serialize(state). Every function
// reads and updates only the state it is given.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const LIMITS = Object.freeze({
  lineage: 20,
  recent: 300,
  edges: 200,
  recentOut: 100,
  seatRecent: 40,
  runSeats: 400,
  builders: 12,
  title: 90,
  text: 160,
  recap: 1500,
  recapGenerations: 4,
  // A run the executor status dropped without coming home is concluded after
  // this long: agent.home normally lands first, a crashed run never does.
  goneGraceMs: 90 * 1000,
  quietMs: 10 * MINUTE,
  askMs: 15 * MINUTE,
  loopMs: 10 * MINUTE,
  retryGenerations: 3,
  retryWindowMs: 24 * HOUR,
  handoffTasks: 3,
  handoffWindowMs: 24 * HOUR,
  keptBranchMs: 24 * HOUR,
  escalationMs: 6 * HOUR,
});

// The pods, left to right on the graph: who plans and hands out work, who
// builds, who checks, and who keeps the house.
const PODS = Object.freeze([
  Object.freeze({ id: "lead", label: "Lead" }),
  Object.freeze({ id: "build", label: "Build" }),
  Object.freeze({ id: "check", label: "Check" }),
  Object.freeze({ id: "keep", label: "Keep" }),
]);

// Roster roles (scripts/assistant.mjs AGENT_ROLES) and the 0.4.0 seats
// (agentSeats) on their pods. A role this table does not know keeps the house.
const ROLE_POD = Object.freeze({
  lead: "lead", companion: "lead", foreman: "lead", thinker: "lead", "cluster-planner": "lead",
  overseer: "check", desk: "check", auditor: "check", "cluster-reviewer": "check",
});
// The chat's replies are the lead's work; the responder role is how it shows.
const ROLE_SEAT = Object.freeze({ responder: "lead", assistant: "lead" });
// Shown whether or not they have run: the seats the loop cannot work without.
const CORE = Object.freeze(["lead", "foreman", "overseer", "desk"]);
// The 0.4.0 seats that carry their own model choice (settings.agentSeats).
const MODEL_SEATS = Object.freeze(["lead", "desk", "companion", "scout", "overseer"]);
// Every seat a mail can name. A sender that is not one of these (a builder by
// its generic name, a test role) draws no wire.
const KNOWN_SEATS = new Set([...CORE, ...MODEL_SEATS, ...Object.keys(ROLE_POD), "watcher", "machine", "keeper", "compactor", "briefer", "improver", "ideas", "grower", "reference"]);

const OUTCOMES = Object.freeze(["lost", "awaiting", "failed", "stopped", "rejected", "verified"]);
// Later facts about one generation win over earlier ones: a run the status lost
// that then comes home, a finished run that is then verified or rejected.
const OUTCOME_RANK = Object.freeze({ lost: 0, awaiting: 1, failed: 1, stopped: 2, rejected: 3, verified: 3 });
const ROW_KINDS = new Set(["claimed", "handed_off", "delegated", "completed", "failed", "verified", "rejected", "stopped", "asked", "answered", "escalated", "reported", "mail", "merged", "kept_branch", "lost"]);
const EDGE_KINDS = new Set(["dispatch", "handoff", "delegation", "verify", "rework", "desk", "escalate", "report", "mail"]);
const PHASES = new Set(["preparing", "building", "finishing"]);
// loop.state values (scripts/loop-status.cjs) that mean ready work is not
// being taken: the "looks idle but held" signal.
const NOT_TAKING = new Set(["held", "paused", "parked", "draining", "stuck", "waiting", "approval", "attention", "setup"]);

const record = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const count = (value) => Math.max(0, Math.floor(finite(value) ?? 0));
// Text that came from a model or a friend is shown as it is, so the characters that
// reorder or hide text (bidi overrides and isolates, zero-width marks) never get through.
const HIDDEN_TEXT = /[\u200b\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;
function clip(value, max) {
  return String(value ?? "").replace(HIDDEN_TEXT, "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
// Run, task and session ids as main writes them; anything else is not an id.
function ident(value) {
  const text = clip(value, 80);
  return /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/.test(text) ? text : "";
}
// Seat ids and the one non-seat end of a wire ("you").
function seatIdent(value) {
  const text = clip(value, 40).toLowerCase();
  return /^[a-z0-9][a-z0-9-]*$/.test(text) ? text : "";
}
function builderIndex(seatId) {
  const match = /^builder-(\d+)$/.exec(String(seatId ?? ""));
  return match ? Number(match[1]) : 0;
}
// Builders by number, then the core seats in CORE order, then the rest by name.
function seatOrder(a, b) {
  const core = (seat) => (CORE.includes(seat.id) ? CORE.indexOf(seat.id) : CORE.length);
  return builderIndex(a.id) - builderIndex(b.id) || core(a) - core(b) || a.id.localeCompare(b.id);
}

// The project part of an address: its folder name, lowercased, never a path.
function slugOf(name) {
  const slug = String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return slug || "project";
}

function emptyLive() {
  return {
    runs: new Map(), // runId -> the live run on its seat
    tasks: new Map(), // taskId -> what the board last said
    taskSeat: new Map(), // taskId -> the seat that last worked it
    runSeat: new Map(), // runId -> its seat, kept after the run ends
    asks: new Map(), // runId -> an open question to the desk
    escalations: new Map(), // runId -> a question the desk passed to you
    status: null,
    statusSig: "",
    loopSince: null,
    seeded: false,
  };
}

function emptyState() {
  return { v: 1, seq: 0, seats: {}, recent: [], edges: [], live: emptyLive() };
}

function occupant(raw) {
  if (!record(raw)) return null;
  const runId = ident(raw.runId);
  const gen = count(raw.gen);
  if (!runId || gen < 1) return null;
  return {
    gen,
    runId,
    taskId: ident(raw.taskId) || null,
    title: clip(raw.title, LIMITS.title) || null,
    startedAt: finite(raw.startedAt),
    endedAt: finite(raw.endedAt),
    outcome: OUTCOMES.includes(raw.outcome) ? raw.outcome : null,
    reason: clip(raw.reason, LIMITS.text) || null,
    via: clip(raw.via, 60) || null,
    model: clip(raw.model, 80) || null,
    sessionId: ident(raw.sessionId) || null,
    branch: clip(raw.branch, 120) || null,
    merge: record(raw.merge) ? { merged: raw.merge.merged === true, reason: clip(raw.merge.reason, LIMITS.text) || null } : null,
    result: record(raw.result) ? { done: clip(raw.result.done, LIMITS.text) || null, next: clip(raw.result.next, LIMITS.text) || null } : null,
    edits: count(raw.edits),
  };
}

function row(raw) {
  if (!record(raw) || !ROW_KINDS.has(raw.kind)) return null;
  const at = finite(raw.at);
  if (at === null) return null;
  return {
    seq: count(raw.seq),
    at,
    kind: raw.kind,
    from: seatIdent(raw.from) || null,
    to: seatIdent(raw.to) || null,
    taskId: ident(raw.taskId) || null,
    title: clip(raw.title, LIMITS.title) || null,
    text: clip(raw.text, LIMITS.text) || null,
  };
}

function edge(raw) {
  if (!record(raw) || !EDGE_KINDS.has(raw.kind)) return null;
  const from = seatIdent(raw.from);
  const to = seatIdent(raw.to);
  const lastAt = finite(raw.lastAt);
  if (!from || !to || from === to || lastAt === null) return null;
  return { from, to, kind: raw.kind, count: Math.max(1, count(raw.count)), lastAt };
}

function reindex(state) {
  const live = state.live;
  live.taskSeat.clear();
  live.runSeat.clear();
  const gens = [];
  for (const [seatId, seat] of Object.entries(state.seats)) for (const gen of seat.lineage) gens.push([seatId, gen]);
  gens.sort((a, b) => (a[1].startedAt ?? 0) - (b[1].startedAt ?? 0));
  for (const [seatId, gen] of gens) {
    live.runSeat.set(gen.runId, seatId);
    if (gen.taskId) live.taskSeat.set(gen.taskId, seatId);
  }
}

// A saved fleet file, or null for a new one. Anything malformed is dropped
// rather than trusted: this file is only ever a view of what the board and the
// logs already hold.
function normalize(saved) {
  const state = emptyState();
  if (!record(saved) || saved.v !== 1) return state;
  state.seq = count(saved.seq);
  for (const [key, seat] of Object.entries(record(saved.seats) ? saved.seats : {})) {
    const seatId = seatIdent(key);
    if (!seatId || !record(seat)) continue;
    const lineage = (Array.isArray(seat.lineage) ? seat.lineage : []).map(occupant).filter(Boolean).slice(-LIMITS.lineage);
    // A generation that was running when Studio stopped ended with it.
    for (const gen of lineage) if (gen.outcome === null) gen.outcome = "lost";
    state.seats[seatId] = { gen: Math.max(count(seat.gen), lineage.at(-1)?.gen ?? 0), lineage };
  }
  state.recent = (Array.isArray(saved.recent) ? saved.recent : []).map(row).filter(Boolean).slice(-LIMITS.recent);
  state.edges = (Array.isArray(saved.edges) ? saved.edges : []).map(edge).filter(Boolean).slice(-LIMITS.edges);
  for (const item of state.recent) state.seq = Math.max(state.seq, item.seq);
  reindex(state);
  return state;
}

function serialize(state) {
  return { v: 1, seq: state.seq, seats: state.seats, recent: state.recent, edges: state.edges };
}

function pushRow(state, raw) {
  state.seq += 1;
  const item = row({ ...raw, seq: state.seq });
  if (!item) return;
  state.recent.push(item);
  if (state.recent.length > LIMITS.recent) state.recent.splice(0, state.recent.length - LIMITS.recent);
}

function wire(state, from, to, kind, at) {
  if (!from || !to || from === to || !EDGE_KINDS.has(kind)) return;
  let found = state.edges.find((item) => item.from === from && item.to === to && item.kind === kind);
  if (!found) {
    found = { from, to, kind, count: 0, lastAt: at };
    state.edges.push(found);
  }
  found.count += 1;
  found.lastAt = Math.max(found.lastAt, at);
  if (state.edges.length > LIMITS.edges) {
    state.edges.sort((a, b) => a.lastAt - b.lastAt);
    state.edges.splice(0, state.edges.length - LIMITS.edges);
  }
}

const generationOf = (state, seatId, runId) => (seatId ? state.seats[seatId]?.lineage.find((gen) => gen.runId === runId) ?? null : null);

// The latest generation that worked a task, wherever it sat.
function latestFor(state, taskId) {
  const seatId = state.live.taskSeat.get(taskId);
  const lineage = seatId ? state.seats[seatId]?.lineage ?? [] : [];
  for (let index = lineage.length - 1; index >= 0; index -= 1) if (lineage[index].taskId === taskId) return lineage[index];
  return null;
}

function setOutcome(gen, outcome, reason = null) {
  if (!gen || !OUTCOMES.includes(outcome)) return false;
  if (gen.outcome && OUTCOME_RANK[outcome] < OUTCOME_RANK[gen.outcome]) return false;
  gen.outcome = outcome;
  if (reason) gen.reason = clip(reason, LIMITS.text);
  return true;
}

function chooseBuilder(state, taskId) {
  const busy = new Set([...state.live.runs.values()].map((run) => run.seatId));
  // Continuity: a retry goes back to the seat that last worked the task, so
  // the seat's lineage reads as one line of generations.
  const last = taskId ? state.live.taskSeat.get(taskId) : null;
  if (last && builderIndex(last) && !busy.has(last)) return last;
  for (let index = 1; ; index += 1) if (!busy.has(`builder-${index}`)) return `builder-${index}`;
}

// A run takes a builder seat: the next generation of that seat. Where the work
// came from draws the wire into it — a handoff from another run, a parent's
// delegation, or the foreman's queue.
function occupy(state, { runId, taskId = null, title = null, at, via = null, model = null }) {
  const live = state.live;
  if (!runId || live.runs.has(runId) || live.runSeat.has(runId)) return false;
  const seatId = chooseBuilder(state, taskId);
  const seat = (state.seats[seatId] ??= { gen: 0, lineage: [] });
  seat.gen += 1;
  seat.lineage.push({ gen: seat.gen, runId, taskId, title, startedAt: at, endedAt: null, outcome: null, reason: null, via, model, sessionId: null, branch: null, merge: null, result: null, edits: 0 });
  if (seat.lineage.length > LIMITS.lineage) seat.lineage.splice(0, seat.lineage.length - LIMITS.lineage);
  live.runs.set(runId, { runId, seatId, gen: seat.gen, taskId, title, startedAt: at, phase: "preparing", step: null, activity: null, progress: null, lastOutputAt: null, stepAt: null, sessionId: null, route: null, branch: null, stopping: false, edits: 0, via, model, finish: null, seenInStatus: false, goneAt: null });
  live.runSeat.set(runId, seatId);
  if (live.runSeat.size > LIMITS.runSeats) live.runSeat.delete(live.runSeat.keys().next().value);
  const task = taskId ? live.tasks.get(taskId) : null;
  const handedBy = task?.fromRun ? live.runSeat.get(task.fromRun) : null;
  const parentSeat = task?.parentTaskId ? live.taskSeat.get(task.parentTaskId) : null;
  if (taskId) live.taskSeat.set(taskId, seatId);
  if (handedBy && handedBy !== seatId) {
    wire(state, handedBy, seatId, "handoff", at);
    pushRow(state, { at, kind: "handed_off", from: handedBy, to: seatId, taskId, title });
  } else if (parentSeat && parentSeat !== seatId) {
    wire(state, parentSeat, seatId, "delegation", at);
    pushRow(state, { at, kind: "delegated", from: parentSeat, to: seatId, taskId, title });
  } else {
    wire(state, "foreman", seatId, "dispatch", at);
    pushRow(state, { at, kind: "claimed", from: "foreman", to: seatId, taskId, title });
  }
  return true;
}

// A run's end, from its own report (agent.home) or from the status losing it.
// What main said at finish (observeFinish) decides stopped over failed.
function conclude(state, runId, at, { ok = null, source = "home" } = {}) {
  const live = state.live;
  const run = live.runs.get(runId);
  if (!run) {
    // Home after the status already lost the run: the report is the better fact.
    if (source !== "home") return false;
    const seatId = live.runSeat.get(runId);
    const gen = generationOf(state, seatId, runId);
    if (!gen || gen.outcome !== "lost") return false;
    return settleEnd(state, seatId, gen, at, ok === true ? "awaiting" : "failed");
  }
  live.runs.delete(runId);
  live.asks.delete(runId);
  const gen = generationOf(state, run.seatId, runId);
  if (!gen) return true;
  gen.endedAt ??= at;
  gen.sessionId = run.sessionId ?? gen.sessionId;
  gen.branch = run.branch ?? gen.branch;
  gen.edits = Math.max(gen.edits, run.edits);
  if (run.via && !gen.via) gen.via = run.via;
  const facts = run.finish ?? {};
  const okay = ok ?? facts.ok ?? null;
  const outcome = facts.userStop === true ? "stopped" : okay === true ? "awaiting" : okay === false ? "failed" : "lost";
  return settleEnd(state, run.seatId, gen, at, outcome);
}

function settleEnd(state, seatId, gen, at, outcome) {
  setOutcome(gen, outcome);
  const base = { at, taskId: gen.taskId, title: gen.title };
  if (outcome === "awaiting") {
    wire(state, seatId, "overseer", "verify", at);
    pushRow(state, { ...base, kind: "completed", from: seatId, to: "overseer" });
  } else if (outcome === "stopped") pushRow(state, { ...base, kind: "stopped", from: "you", to: seatId });
  else if (outcome === "failed") pushRow(state, { ...base, kind: "failed", from: seatId });
  else pushRow(state, { ...base, kind: "lost", from: seatId, text: "ended without reporting back" });
  return true;
}

// Mail names roster roles; a role that is not a seat is left out.
function mailSeat(role) {
  const name = seatIdent(role);
  const seatId = ROLE_SEAT[name] ?? name;
  return KNOWN_SEATS.has(seatId) ? seatId : "";
}

function observeEvent(state, event) {
  if (!record(event) || typeof event.kind !== "string") return false;
  const at = finite(event.at);
  if (at === null) return false;
  const live = state.live;
  const runId = ident(event.runId);
  switch (event.kind) {
    case "agent.out": {
      const via = clip(event.text, 60) || null;
      const model = clip(event.model, 80) || null;
      if (occupy(state, { runId, taskId: ident(event.taskId) || null, title: clip(event.title, LIMITS.title) || null, at, via, model })) return true;
      // Seated from the status first: the start event adds what it knows.
      const run = live.runs.get(runId);
      if (!run) return false;
      run.via = run.via ?? via;
      run.model = run.model ?? model;
      const gen = generationOf(state, run.seatId, runId);
      if (gen) { gen.via ??= via; gen.model ??= model; }
      return Boolean(via || model);
    }
    case "agent.home":
      return runId ? conclude(state, runId, at, { ok: event.ok === true, source: "home" }) : false;
    case "report": {
      const child = live.runSeat.get(runId) ?? live.taskSeat.get(ident(event.from));
      const parent = live.taskSeat.get(ident(event.taskId));
      if (!child || !parent || child === parent) return false;
      wire(state, child, parent, "report", at);
      pushRow(state, { at, kind: "reported", from: child, to: parent, taskId: ident(event.taskId) || null, title: clip(event.title, LIMITS.title) || null, text: event.text });
      return true;
    }
    case "help.ask": {
      const seatId = live.runSeat.get(runId);
      if (!seatId) return false;
      live.asks.set(runId, { at, taskId: ident(event.taskId) || null, text: clip(event.text, LIMITS.text) });
      wire(state, seatId, "desk", "desk", at);
      pushRow(state, { at, kind: "asked", from: seatId, to: "desk", taskId: ident(event.taskId) || null, text: event.text });
      return true;
    }
    case "help.answer": {
      const seatId = live.runSeat.get(runId);
      if (!seatId) return false;
      live.asks.delete(runId);
      if (event.ok === false) {
        live.escalations.set(runId, { at, taskId: ident(event.taskId) || null, text: clip(event.text, LIMITS.text) });
        wire(state, "desk", "you", "escalate", at);
        pushRow(state, { at, kind: "escalated", from: "desk", to: "you", taskId: ident(event.taskId) || null, text: event.text });
      } else {
        wire(state, "desk", seatId, "desk", at);
        pushRow(state, { at, kind: "answered", from: "desk", to: seatId, taskId: ident(event.taskId) || null, text: event.text });
      }
      return true;
    }
    case "mail": {
      const from = mailSeat(event.from);
      const to = mailSeat(event.to);
      if (!from || !to || from === to) return false;
      wire(state, from, to, "mail", at);
      pushRow(state, { at, kind: "mail", from, to, text: event.text });
      return true;
    }
    case "file.edit": {
      const run = live.runs.get(runId);
      if (!run) return false;
      run.edits += Math.max(1, count(event.count));
      return true;
    }
    default:
      return false;
  }
}

// What main said as the run settled: a stop by the owner, and the run's own
// summary of what it did and what is next.
function observeFinish(state, { runId, ok = false, userStop = false, result = null } = {}) {
  const run = state.live.runs.get(ident(runId));
  if (!run) return false;
  const parts = record(result?.parts) ? result.parts : {};
  const done = clip(parts.done || parts.result || result?.raw, LIMITS.text) || null;
  const next = clip(parts.next || parts.remaining, LIMITS.text) || null;
  run.finish = { ok: ok === true, userStop: userStop === true };
  const gen = generationOf(state, run.seatId, run.runId);
  if (gen && (done || next)) gen.result = { done, next };
  return false;
}

function observeMerge(state, { runId, branch = null, merged = false, reason = null } = {}, at) {
  const id = ident(runId);
  const seatId = state.live.runSeat.get(id);
  const gen = generationOf(state, seatId, id);
  if (!gen || finite(at) === null) return false;
  gen.branch = clip(branch, 120) || gen.branch;
  gen.merge = { merged: merged === true, reason: clip(reason, LIMITS.text) || null };
  pushRow(state, { at, kind: merged === true ? "merged" : "kept_branch", from: seatId, taskId: gen.taskId, title: gen.title, text: gen.branch });
  return true;
}

function loopOf(raw) {
  if (!record(raw)) return null;
  return {
    state: clip(raw.state, 20) || null,
    on: raw.on !== false,
    tone: clip(raw.tone, 20) || null,
    headline: clip(raw.headline, 160) || null,
    reason: clip(raw.reason, 200) || null,
    action: record(raw.action) && ident(raw.action.id) ? { id: ident(raw.action.id), label: clip(raw.action.label, 40) || null } : null,
    ready: count(raw.ready),
    running: count(raw.running),
    approval: count(raw.approval),
    blocked: count(raw.blocked),
  };
}

// The executor's status push (autopilotStatus). Runs it lists take seats; a
// run it stops listing is concluded after a grace period (sweep). True when
// something the fleet shows changed.
function observeStatus(state, status, at) {
  if (!record(status) || finite(at) === null) return false;
  const live = state.live;
  const loop = loopOf(status.loop);
  if (loop && live.loopSince?.state !== loop.state) live.loopSince = { state: loop.state, at };
  live.status = {
    parallel: Math.min(LIMITS.builders, Math.max(1, count(status.parallel) || 1)),
    mode: status.mode === "cluster" ? "cluster" : "swarm",
    held: status.held === true,
    waiting: clip(status.waiting, 200) || null,
    infraFailures: count(status.infraFailures),
    lastError: clip(status.lastError, LIMITS.text) || null,
    loop,
    cluster: (Array.isArray(status.clusterAgents) ? status.clusterAgents : []).slice(0, 24).map((agent) => ({
      id: ident(agent?.id), role: clip(agent?.role, 40) || null, status: clip(agent?.status, 20) || null, taskId: ident(agent?.taskId) || null, step: clip(agent?.step, 120) || null,
    })).filter((agent) => agent.id),
  };
  let changed = false;
  const seen = new Set();
  for (const raw of Array.isArray(status.running) ? status.running : []) {
    const runId = ident(raw?.id);
    if (!runId) continue;
    seen.add(runId);
    if (!live.runs.has(runId)) changed = occupy(state, { runId, taskId: ident(raw.taskId) || null, title: clip(raw.title, LIMITS.title) || null, at: finite(raw.startedAt) ?? at }) || changed;
    const run = live.runs.get(runId);
    if (!run) continue;
    Object.assign(run, {
      phase: PHASES.has(raw.phase) ? raw.phase : "building",
      step: clip(raw.currentStep, 160) || null,
      activity: clip(raw.activity, 160) || null,
      progress: finite(raw.progress),
      lastOutputAt: finite(raw.lastOutputAt),
      stepAt: finite(raw.stepUpdatedAt) ?? finite(raw.activityAt),
      sessionId: ident(raw.sessionId) || run.sessionId,
      route: clip(raw.route, 80) || run.route,
      branch: clip(raw.branch, 120) || run.branch,
      stopping: record(raw.stopping),
      seenInStatus: true,
      goneAt: null,
    });
  }
  for (const run of live.runs.values()) if (run.seenInStatus && !seen.has(run.runId) && run.goneAt === null) run.goneAt = at;
  changed = sweep(state, at) || changed;
  const signature = JSON.stringify([
    live.status.parallel, live.status.waiting, live.status.infraFailures, loop && [loop.state, loop.on, loop.headline, loop.reason, loop.ready],
    [...live.runs.values()].map((run) => [run.runId, run.phase, run.step, run.activity, run.progress, run.stopping, run.goneAt === null]),
    live.status.cluster.map((agent) => [agent.id, agent.status, agent.step]),
  ]);
  if (signature !== live.statusSig) {
    live.statusSig = signature;
    changed = true;
  }
  return changed;
}

// Conclude runs the status lost long enough ago, and let old asks and
// escalations go. Called with each observation and before a snapshot.
function sweep(state, at) {
  const live = state.live;
  let changed = false;
  for (const run of [...live.runs.values()]) {
    if (run.goneAt !== null && at - run.goneAt >= LIMITS.goneGraceMs) changed = conclude(state, run.runId, at, { source: "status" }) || changed;
  }
  for (const [runId, item] of [...live.escalations]) if (at - item.at >= LIMITS.escalationMs) { live.escalations.delete(runId); changed = true; }
  for (const [runId, item] of [...live.asks]) if (at - item.at >= LIMITS.escalationMs) { live.asks.delete(runId); changed = true; }
  return changed;
}

// Every board write (boardWritten). The first one only learns the board; after
// that a verdict, a rejection or the owner's stop becomes a row on the seat
// that built the card.
function observeTasks(state, tasks, at) {
  if (!Array.isArray(tasks) || finite(at) === null) return false;
  const live = state.live;
  const first = !live.seeded;
  live.seeded = true;
  let changed = false;
  const seen = new Set();
  for (const task of tasks) {
    const taskId = ident(task?.id);
    if (!taskId) continue;
    seen.add(taskId);
    const verification = record(task.verification) ? task.verification : {};
    const next = {
      title: clip(task.title, LIMITS.title) || null,
      status: clip(task.status, 30) || null,
      parentTaskId: ident(task.parentTaskId ?? task.delegatedFrom?.parentTaskId) || null,
      fromRun: ident(task.fromRun) || null,
      planningId: ident(task.planningId) || null,
      verifyState: clip(verification.state, 20) || null,
      verifyAt: clip(verification.at, 40) || null,
      held: record(task.ownerHold) || task.ownerHold === true,
    };
    const prev = live.tasks.get(taskId);
    live.tasks.set(taskId, next);
    if (first || !prev) continue;
    const seatId = live.taskSeat.get(taskId);
    if (!seatId) continue;
    const gen = latestFor(state, taskId);
    const base = { at, taskId, title: next.title };
    if (next.verifyAt && next.verifyAt !== prev.verifyAt) {
      if (next.status === "done" && (next.verifyState === "verified" || next.verifyState === "manual")) {
        setOutcome(gen, "verified");
        pushRow(state, { ...base, kind: "verified", from: next.verifyState === "manual" ? "you" : "overseer", to: seatId });
        changed = true;
      } else if (next.verifyState === "failed") {
        setOutcome(gen, "rejected");
        wire(state, "overseer", seatId, "rework", at);
        pushRow(state, { ...base, kind: "rejected", from: "overseer", to: seatId });
        changed = true;
      }
    }
    if (next.held && !prev.held && gen && gen.outcome !== "stopped") {
      setOutcome(gen, "stopped");
      pushRow(state, { ...base, kind: "stopped", from: "you", to: seatId });
      changed = true;
    }
  }
  for (const taskId of [...live.tasks.keys()]) if (!seen.has(taskId)) live.tasks.delete(taskId);
  return changed;
}

function rosterRows(roster) {
  const rows = new Map();
  for (const raw of Array.isArray(roster) ? roster : []) {
    const role = seatIdent(raw?.role);
    if (!role) continue;
    rows.set(role, { role, status: clip(raw.status, 20) || "idle", runs: count(raw.runs), since: finite(raw.since), lastRunAt: finite(raw.lastRunAt), text: clip(raw.text, LIMITS.text) || null, error: clip(raw.error, LIMITS.text) || null });
  }
  return rows;
}

function seatRuntime(team, seatId) {
  const choice = record(team?.agentSeats) && record(team.agentSeats[seatId]) ? team.agentSeats[seatId] : null;
  if (!choice) return null;
  const via = clip(choice.provider, 30) || null;
  const model = clip(choice.model, 80) || null;
  return via || model ? { via, model } : null;
}

function builderSeat(state, seatId, { slug, team, loopOn }) {
  const live = state.live;
  const saved = state.seats[seatId];
  const run = [...live.runs.values()].find((item) => item.seatId === seatId && item.goneAt === null) ?? null;
  const last = saved?.lineage.at(-1) ?? null;
  const ask = run ? live.asks.get(run.runId) : null;
  const escalated = run ? live.escalations.get(run.runId) : null;
  const cluster = run ? (live.status?.cluster ?? []).filter((agent) => agent.id.startsWith(`${run.runId}:`)) : [];
  return {
    id: seatId,
    pod: "build",
    role: "builder",
    kind: "builder",
    address: `${seatId}@${slug}`,
    runtime: run
      ? { via: run.via || clip(team?.executorCli, 30) || null, model: run.model || null, route: run.route || null }
      : { via: clip(team?.executorCli, 30) || null, model: clip(team?.executorModel, 80) || null, route: null },
    status: run ? (escalated ? "blocked" : ask ? "waiting" : "working") : loopOn ? "idle" : "off",
    now: run ? {
      runId: run.runId, taskId: run.taskId, title: run.title, phase: run.phase, step: run.step || run.activity,
      progress: run.progress, since: run.startedAt, lastOutputAt: run.lastOutputAt, edits: run.edits, branch: run.branch,
      stopping: run.stopping, cluster: cluster.map((agent) => ({ role: agent.role, status: agent.status, step: agent.step })),
    } : null,
    ctx: null,
    gen: saved?.gen ?? 0,
    last: !run && last ? { gen: last.gen, taskId: last.taskId ?? null, runId: last.runId ?? null, title: last.title, outcome: last.outcome, endedAt: last.endedAt } : null,
    lastAt: run ? run.lastOutputAt ?? run.startedAt : last?.endedAt ?? last?.startedAt ?? null,
    text: escalated ? `needs you: ${escalated.text}` : ask ? `asked the desk: ${ask.text}` : null,
  };
}

function rosterSeat(state, seatId, row, { slug, team }) {
  const live = state.live;
  const asks = seatId === "desk" ? live.asks.size : 0;
  const checking = seatId === "overseer" ? [...live.tasks.values()].filter((task) => task.status === "awaiting_verification").length : 0;
  const running = row && (row.status === "running" || row.status === "queued");
  const status = seatId === "desk" ? (asks ? "working" : "idle") : running ? "working" : row?.status === "error" ? "error" : "idle";
  const text = seatId === "desk" && asks ? `${asks} open question${asks === 1 ? "" : "s"}`
    : checking ? `${checking} to check`
      : row?.error || row?.text || null;
  return {
    id: seatId,
    pod: ROLE_POD[seatId] ?? "keep",
    role: seatId,
    // "seat": one of the 0.4.0 seats with its own model; "role": a roster role.
    kind: MODEL_SEATS.includes(seatId) ? "seat" : "role",
    address: `${seatId}@${slug}`,
    runtime: seatRuntime(team, seatId),
    status,
    now: running ? { title: row.text || null, since: row.since } : null,
    ctx: null,
    gen: row?.runs ?? 0,
    last: null,
    lastAt: row?.lastRunAt ?? null,
    text,
  };
}

// An observation, not a verdict about productivity: normal work can wait for
// verification. Count distinct child identities, never event volume, and
// only describe evidence retained by this project's bounded ledger.
function handoffHealth(state, at) {
  if (finite(at) === null) return [];
  const verified = new Map();
  const recordVerified = (taskId, time) => {
    if (taskId && finite(time) !== null && time <= at) verified.set(taskId, Math.max(verified.get(taskId) ?? 0, time));
  };
  for (const item of state.recent) if (item.kind === "verified") recordVerified(item.taskId, item.at);
  for (const seat of Object.values(state.seats)) {
    for (const gen of seat.lineage) if (gen.outcome === "verified") recordVerified(gen.taskId, gen.startedAt);
  }
  const bySeat = new Map();
  for (const item of state.recent) {
    if (item.kind !== "handed_off" || !item.taskId || !builderIndex(item.from) || !state.seats[item.from] ||
        !item.to || item.to === item.from || item.at < at - LIMITS.handoffWindowMs || item.at > at) continue;
    const tasks = bySeat.get(item.from) ?? new Map();
    const previous = tasks.get(item.taskId);
    if (!previous || item.at > previous.at) tasks.set(item.taskId, item);
    bySeat.set(item.from, tasks);
  }
  const signals = [];
  for (const [seatId, tasks] of bySeat) {
    const pending = [...tasks.values()].filter(item => (verified.get(item.taskId) ?? -1) < item.at).sort((a, b) => b.at - a.at || a.taskId.localeCompare(b.taskId));
    if (pending.length < LIMITS.handoffTasks) continue;
    signals.push({
      id: `handoff-progress:${seatId}`, severity: "info", seatId,
      summary: `${pending.length} handed-off tasks have no recorded verification`,
      reason: clip(pending.map(item => item.title || item.taskId).join("; "), LIMITS.text),
      why: "The retained history shows handoffs without later verification for these tasks. Waiting for verification can be normal; this note does not mean the work is stalled.",
      threshold: `${LIMITS.handoffTasks} distinct tasks handed off in the last 24 hours`,
      confidence: "recorded history only", count: pending.length,
      evidence: pending.slice(0, LIMITS.lineage).map(({ taskId, title, to, at }) => ({ taskId, title, to, at })),
      inspect: { view: "seat", seatId },
    });
  }
  return signals;
}

function health(state, at) {
  const live = state.live;
  const out = handoffHealth(state, at);
  const minutes = (ms) => Math.max(1, Math.round(ms / MINUTE));
  for (const run of live.runs.values()) {
    if (run.goneAt !== null) continue;
    const quietSince = Math.max(run.lastOutputAt ?? 0, run.stepAt ?? 0, run.startedAt ?? 0);
    if (quietSince && at - quietSince >= LIMITS.quietMs) {
      out.push({ id: `quiet:${run.runId}`, severity: "warn", seatId: run.seatId, summary: `${run.seatId} has been quiet for ${minutes(at - quietSince)} min`, reason: run.title, why: "No output, step or tool change from the worker in that time.", threshold: "10 min without output", inspect: { view: "seat", seatId: run.seatId } });
    }
  }
  for (const [runId, ask] of live.asks) {
    if (at - ask.at < LIMITS.askMs) continue;
    const seatId = live.runSeat.get(runId) ?? null;
    out.push({ id: `ask:${runId}`, severity: "warn", seatId, summary: `${seatId ?? "A builder"} has waited ${minutes(at - ask.at)} min for the desk`, reason: ask.text, why: "The desk has not answered the question yet.", threshold: "15 min without an answer", inspect: { view: "seat", seatId } });
  }
  for (const [runId, item] of live.escalations) {
    const seatId = live.runSeat.get(runId) ?? null;
    out.push({ id: `escalated:${runId}`, severity: "bad", seatId, summary: "The desk could not answer: this needs you", reason: item.text, why: "A builder asked, and the desk passed the question on.", threshold: "any escalation", inspect: { view: "task", taskId: item.taskId } });
  }
  const byTask = new Map();
  for (const [seatId, seat] of Object.entries(state.seats)) {
    for (const gen of seat.lineage) {
      if (!gen.taskId || at - (gen.startedAt ?? 0) > LIMITS.retryWindowMs) continue;
      const entry = byTask.get(gen.taskId) ?? { gens: 0, verified: false, title: gen.title, seatId };
      entry.gens += 1;
      entry.verified ||= gen.outcome === "verified";
      entry.seatId = seatId;
      byTask.set(gen.taskId, entry);
      if (gen.merge && !gen.merge.merged && at - (gen.endedAt ?? gen.startedAt ?? 0) < LIMITS.keptBranchMs) {
        out.push({ id: `kept:${gen.runId}`, severity: "info", seatId, summary: `${gen.branch || "A worktree branch"} was kept, not merged`, reason: gen.merge.reason, why: "The run's worktree could not be merged back, so its work waits on that branch.", threshold: "any kept branch in the last day", inspect: { view: "seat", seatId } });
      }
    }
  }
  for (const [taskId, entry] of byTask) {
    if (entry.gens < LIMITS.retryGenerations || entry.verified) continue;
    out.push({ id: `retry:${taskId}`, severity: "warn", seatId: entry.seatId, summary: `${entry.gens} runs on one task without a verified result`, reason: entry.title, why: "Repeated attempts are not moving the task forward.", threshold: `${LIMITS.retryGenerations} generations in a day`, inspect: { view: "task", taskId } });
  }
  const loop = live.status?.loop;
  if (loop && NOT_TAKING.has(loop.state) && loop.ready > 0 && live.loopSince && at - live.loopSince.at >= LIMITS.loopMs) {
    out.push({ id: `loop:${loop.state}`, severity: "warn", seatId: null, summary: loop.headline || "Agents are not taking the ready work", reason: loop.reason, why: `${loop.ready} ready task${loop.ready === 1 ? "" : "s"} for ${minutes(at - live.loopSince.at)} min.`, threshold: "10 min with ready work waiting", inspect: { view: "loop", action: loop.action } });
  }
  if (live.status?.infraFailures) {
    out.push({ id: "infra", severity: "warn", seatId: null, summary: `${live.status.infraFailures} worker start failure${live.status.infraFailures === 1 ? "" : "s"}`, reason: live.status.lastError, why: "The coding CLI did not start.", threshold: "any start failure", inspect: { view: "loop", action: null } });
  }
  const rank = { bad: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || a.id.localeCompare(b.id));
}

// What the Fleet view draws. `roster` is assistantState.agents, `team` the
// effective team settings; neither is kept.
function snapshot(state, { projectId = null, projectName = "", roster = [], team = {}, at } = {}) {
  const live = state.live;
  const slug = slugOf(projectName);
  const loopOn = live.status?.loop ? live.status.loop.on !== false : true;
  const rows = rosterRows(roster);
  const seats = [];
  const running = [...live.runs.values()];
  const builders = Math.min(LIMITS.builders, Math.max(live.status?.parallel ?? 1, ...running.map((run) => builderIndex(run.seatId)), 1));
  for (let index = 1; index <= builders; index += 1) seats.push(builderSeat(state, `builder-${index}`, { slug, team, loopOn }));
  const shown = new Set(CORE);
  for (const [role, item] of rows) {
    const seatId = ROLE_SEAT[role] ?? role;
    if (item.runs > 0 || item.status === "running" || item.status === "queued" || item.status === "error") shown.add(seatId);
  }
  if (seatRuntime(team, "companion")) shown.add("companion");
  const lead = rows.get("responder") ?? rows.get("lead") ?? null;
  for (const seatId of shown) seats.push(rosterSeat(state, seatId, seatId === "lead" ? lead : rows.get(seatId) ?? null, { slug, team }));
  const pods = PODS.map((pod) => ({ id: pod.id, label: pod.label, seats: seats.filter((seat) => seat.pod === pod.id).sort(seatOrder) }));
  const ids = new Set(seats.map((seat) => seat.id));
  ids.add("you");
  const signals = health(state, at);
  return {
    ok: true,
    projectId,
    project: { name: clip(projectName, 100) || null, slug },
    at,
    pods,
    edges: state.edges.filter((item) => ids.has(item.from) && ids.has(item.to)).sort((a, b) => b.lastAt - a.lastAt),
    recent: state.recent.slice(-LIMITS.recentOut).reverse(),
    health: signals,
    loop: live.status?.loop ?? null,
    counts: {
      seats: seats.length,
      working: seats.filter((seat) => seat.status === "working" || seat.status === "waiting").length,
      attention: signals.filter((signal) => signal.severity !== "info").length,
      openRows: live.status?.loop ? live.status.loop.ready : [...live.tasks.values()].filter((task) => task.status === "open").length,
    },
  };
}

// One seat in full, for its inspector: every generation it has had, newest
// first, its wires and the rows it took part in.
// Recorded handover only: live work is not a result, and a done report does
// not become verified until the board's evidence changes its outcome.
function seatRecap(state, seatId, { excludeRunId = null } = {}) {
  const id = seatIdent(seatId);
  if (!id || !state.seats[id]) return null;
  const seen = new Set();
  const generations = state.seats[id].lineage.slice().reverse().filter((gen) => {
    if (!gen.runId || gen.runId === excludeRunId || state.live.runs.has(gen.runId) || !gen.outcome || seen.has(gen.runId)) return false;
    seen.add(gen.runId);
    return true;
  }).slice(0, LIMITS.recapGenerations);
  if (!generations.length) return null;
  const labels = { verified: "Verified", awaiting: "Reported complete; verification pending", stopped: "Interrupted; progress saved", failed: "Failed", lost: "Ended without a completion report", rejected: "Completion rejected" };
  const lines = [`Seat ${id}: recorded previous work, not new task requirements.`];
  for (const gen of generations) {
    lines.push(`Generation ${gen.gen} (${gen.runId}), task ${gen.taskId || "unknown"}: ${gen.title || "Untitled"}. ${labels[gen.outcome] || gen.outcome}.`);
    if (gen.result?.done) lines.push(`Reported result: ${gen.result.done}`);
    if (gen.result?.next) lines.push(`Reported remaining work: ${gen.result.next}`);
    if (gen.reason) lines.push(`Recorded reason: ${gen.reason}`);
  }
  const oldest = Math.min(...generations.map((gen) => gen.startedAt ?? Infinity));
  const current = [...state.live.runs.values()].find((run) => run.seatId === id);
  const newest = current?.startedAt ?? Infinity;
  const handoffs = [];
  const handed = new Set();
  for (const item of state.recent.slice().reverse()) {
    if (item.kind !== "handed_off" || item.from !== id || item.at < oldest || item.at > newest) continue;
    const key = JSON.stringify([item.taskId, item.to, item.title]);
    if (handed.has(key)) continue;
    handed.add(key);
    handoffs.push({ taskId: item.taskId, to: item.to, title: item.title });
    if (handoffs.length === LIMITS.recapGenerations) break;
  }
  for (const item of handoffs) lines.push(`Handed to ${item.to || "another seat"}: ${item.title || "Untitled"} (${item.taskId || "unknown task"}).`);
  const full = lines.join("\n");
  const text = full.length > LIMITS.recap ? `${full.slice(0, LIMITS.recap - 1)}…` : full;
  return { text, truncated: full.length > LIMITS.recap, generations: generations.map((gen) => ({ runId: gen.runId, taskId: gen.taskId, gen: gen.gen, outcome: gen.outcome })), handoffs };
}

function runRecap(state, runId, taskId) {
  const run = state.live.runs.get(ident(runId));
  if (!run || !run.taskId || run.taskId !== ident(taskId)) return null;
  return seatRecap(state, run.seatId, { excludeRunId: run.runId });
}

function seatDetail(state, seatId, context = {}) {
  const id = seatIdent(seatId);
  const view = snapshot(state, context);
  const seat = view.pods.flatMap((pod) => pod.seats).find((item) => item.id === id) ?? null;
  if (!seat) return { ok: false, error: "That seat is not on this team." };
  const lineage = (state.seats[id]?.lineage ?? []).slice().reverse().map((gen) => ({ ...gen, running: state.live.runs.has(gen.runId) }));
  return {
    ok: true,
    seat,
    lineage,
    recap: seatRecap(state, id),
    edges: view.edges.filter((item) => item.from === id || item.to === id),
    recent: state.recent.filter((item) => item.from === id || item.to === id).slice(-LIMITS.seatRecent).reverse(),
    health: view.health.filter((signal) => signal.seatId === id),
  };
}

module.exports = {
  LIMITS,
  PODS,
  CORE,
  slugOf,
  emptyState,
  normalize,
  serialize,
  observeEvent,
  observeStatus,
  observeTasks,
  observeFinish,
  observeMerge,
  sweep,
  health,
  snapshot,
  seatDetail,
  seatRecap,
  runRecap,
};
