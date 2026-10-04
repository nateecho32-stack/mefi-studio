"use strict";
// The fleet's host side (docs/fleet-overhaul-plan.md, Phase 1). main.cjs calls
// one-line hooks at moments it already knows about — a brain event, an
// executor status push, a board write, a run's end, a worktree merge — and this
// keeps each project's fleet (scripts/fleet.cjs) in data/projects/<id>/
// fleet.json and pushes `fleet:update` snapshots, only while a Fleet view holds
// a watch lease and only for the open project.
//
// Every entry point is per project, like agent-brain-host.cjs: the caller's
// project context decides which file is used, and state for each project is
// kept apart. Nothing here may fail the caller: each hook swallows its own
// errors and logs one line.

const path = require("node:path");
const fsp = require("node:fs/promises");
const fleet = require("./fleet.cjs");
const { writeJsonAtomic } = require("./agent-brain-host.cjs");

const LIMITS = Object.freeze({
  saveDelayMs: 5000,
  // One snapshot per half second at most: the executor status alone can
  // change four times a second while builders work.
  pushGapMs: 500,
  // A Fleet view renews its lease every 30 s while it is on screen; a view
  // that closed without saying so stops the pushes within a minute.
  leaseMs: 60 * 1000,
  teamCacheMs: 10 * 1000,
  leases: 8,
});

async function readJson(file) {
  try {
    return JSON.parse((await fsp.readFile(file, "utf8")).replace(/^﻿/, ""));
  } catch {
    return null;
  }
}

function createFleetHost(options = {}) {
  const {
    dataFile,
    projectId = () => "default",
    projectName = () => "",
    isActive = () => true,
    send = () => {},
    logLine = () => {},
    now = Date.now,
    // Pulled when a snapshot is built, never kept: the executor status (for a
    // first snapshot before any push), the roster and the team's settings.
    status = () => null,
    roster = () => [],
    team = async () => ({}),
    readTasks = async () => [],
    timers = { setTimeout, clearTimeout },
  } = options;
  if (typeof dataFile !== "function") throw new Error("createFleetHost needs dataFile(name)");
  const scopes = new Map();
  const warned = new Set();

  function warn(where, error) {
    const key = `${where}:${String(error?.message ?? error).slice(0, 60)}`;
    if (warned.has(key)) return;
    warned.add(key);
    logLine(`[fleet] ${where} failed: ${String(error?.message ?? error).slice(0, 160)}`);
  }

  // The file path is fixed when a project's scope is first made, inside that
  // project's context, so a timer that fires later still writes to the right
  // folder whatever project is open by then.
  function scope() {
    const id = String(projectId() ?? "default");
    let s = scopes.get(id);
    if (s) return s;
    s = {
      id,
      name: String(projectName() ?? ""),
      file: dataFile("fleet.json"),
      state: fleet.emptyState(),
      loaded: null,
      writes: Promise.resolve(),
      saveTimer: null,
      pushTimer: null,
      lastPushAt: 0,
      leases: new Map(),
      team: null,
      teamAt: 0,
      rev: 0,
    };
    scopes.set(id, s);
    return s;
  }

  // The saved seats and wires, then the board as it stands (learned without
  // rows: only changes after this point become rows).
  function ready(s) {
    if (!s.loaded) {
      s.loaded = (async () => {
        s.state = fleet.normalize(await readJson(s.file));
        const tasks = await Promise.resolve().then(readTasks).catch(() => []);
        fleet.observeTasks(s.state, Array.isArray(tasks) ? tasks : [], now());
      })().catch((error) => warn("load", error));
    }
    return s.loaded;
  }

  function persist(s) {
    s.writes = s.writes.then(() => writeJsonAtomic(s.file, fleet.serialize(s.state))).catch((error) => warn("save", error));
    return s.writes;
  }

  function scheduleSave(s) {
    if (s.saveTimer) return;
    s.saveTimer = timers.setTimeout(() => {
      s.saveTimer = null;
      persist(s);
    }, LIMITS.saveDelayMs);
    s.saveTimer?.unref?.();
  }

  function watched(s) {
    if (!isActive(s.id)) return false;
    const at = now();
    for (const [key, until] of s.leases) if (until <= at) s.leases.delete(key);
    return s.leases.size > 0;
  }

  async function teamOf(s) {
    if (s.team && now() - s.teamAt < LIMITS.teamCacheMs) return s.team;
    try {
      s.team = (await team()) ?? {};
    } catch (error) {
      warn("team", error);
      s.team = s.team ?? {};
    }
    s.teamAt = now();
    return s.team;
  }

  function rosterRows() {
    try {
      const rows = roster();
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }

  async function build(s) {
    const at = now();
    if (!s.state.live.status) {
      try {
        const current = status();
        if (current) fleet.observeStatus(s.state, current, at);
      } catch {}
    }
    fleet.sweep(s.state, at);
    const view = fleet.snapshot(s.state, { projectId: s.id, projectName: s.name, roster: rosterRows(), team: await teamOf(s), at });
    return { ...view, rev: s.rev };
  }

  async function pushNow(s) {
    if (!watched(s)) return;
    s.lastPushAt = now();
    try {
      const view = await build(s);
      if (watched(s)) send("fleet:update", view);
    } catch (error) {
      warn("push", error);
    }
  }

  // The first change after a quiet half second goes out at once; later ones
  // share one trailing push, built when it goes, so it carries the newest state.
  function schedulePush(s) {
    if (!watched(s) || s.pushTimer) return;
    const wait = Math.max(0, s.lastPushAt + LIMITS.pushGapMs - now());
    if (wait === 0) {
      pushNow(s);
      return;
    }
    s.pushTimer = timers.setTimeout(() => {
      s.pushTimer = null;
      pushNow(s);
    }, wait);
    s.pushTimer?.unref?.();
  }

  function changed(s) {
    s.rev += 1;
    scheduleSave(s);
    schedulePush(s);
  }

  // Each hook runs after the project's file is loaded, in call order, and in
  // the project whose context called it.
  function hook(where, apply) {
    let s;
    try {
      s = scope();
    } catch (error) {
      warn(where, error);
      return Promise.resolve();
    }
    return ready(s).then(() => {
      try {
        if (apply(s.state, now())) changed(s);
      } catch (error) {
        warn(where, error);
      }
    });
  }

  return {
    observeEvent: (event) => hook("event", (state) => fleet.observeEvent(state, event)),
    observeStatus: (current) => hook("status", (state, at) => fleet.observeStatus(state, current, at)),
    observeTasks: (tasks) => hook("tasks", (state, at) => fleet.observeTasks(state, tasks, at)),
    observeFinish: (info) => hook("finish", (state) => fleet.observeFinish(state, info ?? {})),
    observeMerge: (info) => hook("merge", (state, at) => fleet.observeMerge(state, info ?? {}, at)),

    async snapshot() {
      const s = scope();
      await ready(s);
      return build(s);
    },

    async seat(payload = {}) {
      const s = scope();
      await ready(s);
      const at = now();
      fleet.sweep(s.state, at);
      return fleet.seatDetail(s.state, String(payload?.seatId ?? ""), { projectId: s.id, projectName: s.name, roster: rosterRows(), team: await teamOf(s), at });
    },

    async recap({ runId, taskId } = {}) {
      const s = scope();
      const current = status();
      const at = now();
      await ready(s);
      if (String(projectId()) !== s.id || !isActive(s.id)) return null;
      // Prompt assembly may precede the trailing executor push: use the
      // actual status to resolve this run's assigned seat, never guess it.
      if (fleet.observeStatus(s.state, current, at)) changed(s);
      return fleet.runRecap(s.state, runId, taskId);
    },

    // A new Fleet watcher gets a snapshot at once; renewals extend the lease.
    watch(payload = {}) {
      const s = scope();
      const key = String(payload?.id ?? "fleet").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "fleet";
      if (payload?.on === false) {
        s.leases.delete(key);
        return { ok: true, watching: watched(s) };
      }
      const was = watched(s);
      if (!s.leases.has(key) && s.leases.size >= LIMITS.leases) s.leases.delete(s.leases.keys().next().value);
      s.leases.set(key, now() + LIMITS.leaseMs);
      if (!was) ready(s).then(() => schedulePush(s));
      return { ok: true, watching: true, leaseMs: LIMITS.leaseMs };
    },

    // What a seat's buttons act on: the run it holds now, or its last one.
    // main performs the stop (stopTaskRun); opening a task or a log is the
    // renderer's navigation.
    async action(payload = {}) {
      const s = scope();
      await ready(s);
      const detail = fleet.seatDetail(s.state, String(payload?.seatId ?? ""), { projectId: s.id, projectName: s.name, at: now() });
      if (!detail.ok) return detail;
      const current = detail.seat.now;
      const last = detail.lineage[0] ?? null;
      const kind = String(payload?.action ?? "");
      if (kind === "stop") {
        if (!current?.taskId) return { ok: false, error: "That seat is not running anything." };
        // The run the owner was looking at when they armed Stop: a seat that has moved on to
        // another run (or another project's seat of the same name) is not stopped by mistake.
        const seen = String(payload?.runId ?? "");
        if (seen && seen !== current.runId) return { ok: false, error: "That seat has moved on to another run. Look again before stopping it." };
        return { ok: true, action: kind, taskId: current.taskId, runId: current.runId };
      }
      if (kind === "open-task" || kind === "open-log") {
        const taskId = current?.taskId ?? last?.taskId ?? null;
        const runId = current?.runId ?? last?.runId ?? null;
        return taskId ? { ok: true, action: kind, taskId, runId } : { ok: false, error: "That seat has not worked on a task yet." };
      }
      return { ok: false, error: "Unknown fleet action." };
    },

    // Tests and quit: every pending save written.
    async flush() {
      for (const s of scopes.values()) {
        if (s.saveTimer) {
          timers.clearTimeout(s.saveTimer);
          s.saveTimer = null;
          if (s.loaded) persist(s);
        }
        await s.writes;
      }
    },

    _scopes: scopes,
  };
}

module.exports = { createFleetHost, LIMITS, path };
