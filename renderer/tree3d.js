// Mefi's Studio AI+ — 3D task-tree rail.
// Session/subagent/todo tree projected in 3D over a starfield; nodes light green
// as tasks complete and pulses travel the edges when live tool activity lands.
// The assistant service is its own node above the root, finished sessions fold
// into one cluster, and the assistant's organisation decides which roots show.
(function () {
  "use strict";

  const canvas = document.getElementById("tree-canvas");
  const rail = document.getElementById("tree-rail");
  const stats = document.getElementById("tree-stats");
  const tip = document.createElement("div");
  tip.className = "tree-tip";
  tip.hidden = true;
  rail.append(tip);

  const ctx = canvas.getContext("2d");
  let width = 0;
  let height = 0;
  let nodes = [];
  let edges = [];
  let pulses = [];
  let stars = [];
  let angle = 0.6;
  let hover = null;
  let activeSessionId = null;
  let checkpoints = {};
  let initialized = false;
  let readyPromise = null;
  const read = (method) => window.MefiBoot?.read ? window.MefiBoot.read(method) : Promise.resolve().then(() => window.mefiStudio?.[method]?.());
  // What the store told us last, for the Command view's empty state.
  let status = window.mefiStudio?.eyesState ? "ok" : "desktop-only";
  let statusText = "no session yet";
  // The rail's own line, without the assistant suffix paintStats() appends.
  let statsBase = "no session yet";
  // Set while the rail dispatches its own tree-select, so the listener that
  // follows other surfaces does not fight the click that started it.
  let suppress = false;
  // The assistant service state (data/eyes-assistant.json over IPC). Its
  // organisation drives buildGraph, its summary drives the assistant node.
  // lastKey/pending dedupe the eyes:assistant push, which every module's own
  // listener hands to applyAssistant().
  const assistant = { state: null, lastKey: null, pending: null };

  const COLORS = {
    pending: "#5a5346",
    active: "#c9a86a",
    done: "#57ff9a",
    session: "#ece5d8",
    assistant: "#e6c98d",
    amber: "#ffd479",
    grey: "#8a8070",
    stale: "#4a463e",
    edge: "rgba(201, 168, 106, 0.3)",
    edgeActive: "rgba(201, 168, 106, 0.62)",
  };
  const ASSISTANT_PULSE_KINDS = new Set(["tick", "organize", "tidy", "fix", "audit", "brief", "message", "reply", "think"]);
  // What one running agent reads as on the node (the tone stays "busy").
  const AGENT_VERBS = {
    watcher: "watching…",
    machine: "scanning the machine…",
    auditor: "auditing…",
    keeper: "tidying…",
    compactor: "compacting the queue…",
    foreman: "handing out work…",
    thinker: "thinking…",
    builder: "building…",
    briefer: "briefing…",
    overseer: "overseeing…",
    responder: "replying…",
    improver: "improving…",
    grower: "growing…",
    ideas: "scanning ideas…",
    reference: "gathering references…",
  };
  // One hue per role, so the satellites around the assistant read as a crew of
  // distinct agents instead of a ring of identical golds. Status still reads:
  // error stays amber everywhere, and the draw dims whatever is not running.
  // Amber/gold stay out of the table — they belong to errors and the assistant.
  const AGENT_COLORS = {
    watcher: "#8fd0ff", // sky — eyes on the sessions
    machine: "#b0bac7", // steel
    auditor: "#c9a7f5", // violet
    keeper: "#9fd6a0", // sage
    compactor: "#7fb8d4", // slate blue — the queue keeper
    foreman: "#ffb870", // amber-orange — hands work to the builders
    thinker: "#e8d5a3", // parchment — inner monologue in the assistant box
    builder: "#ffd27f", // warm gold — an opencode run actually editing the repo
    briefer: "#f0b078", // peach
    overseer: "#a8b8ff", // periwinkle
    responder: "#f2a7c0", // rose
    improver: "#7fe0c3", // mint
    grower: "#b8dc7a", // leaf
    ideas: "#e6a8e8", // orchid
    reference: "#9fe0e8", // aqua
  };
  // HSL -> #rrggbb for the hash fallback below (canvas accepts either, but
  // draw() appends a hex alpha, so the palette has to be hex).
  function hslHex(hue, sat, light) {
    const h = (((hue % 360) + 360) % 360) / 60;
    const chroma = (1 - Math.abs(2 * light - 1)) * sat;
    const x = chroma * (1 - Math.abs((h % 2) - 1));
    const [r, g, b] = h < 1 ? [chroma, x, 0] : h < 2 ? [x, chroma, 0] : h < 3 ? [0, chroma, x] : h < 4 ? [0, x, chroma] : h < 5 ? [x, 0, chroma] : [chroma, 0, x];
    const m = light - chroma / 2;
    const byte = (v) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
    return `#${byte(r)}${byte(g)}${byte(b)}`;
  }
  // A role this build does not know still gets a stable colour: hash the name
  // around the hue wheel at the palette's lightness.
  function agentColor(role) {
    const known = AGENT_COLORS[role];
    if (known) return known;
    let hash = 0;
    for (const char of String(role ?? "")) hash = (hash * 31 + char.charCodeAt(0)) | 0;
    return hslHex(hash, 0.5, 0.72);
  }
  const AGENT_RING = 34;
  // The last store answer, so a roster change can rebuild without a re-read.
  const cache = { sessions: [], todos: [], fallback: null };
  // Agent travel: one motion record per role, kept across rebuilds; the Command
  // view registers its task nodes here so a reference agent can fly to one.
  const FLY_MS = 650;
  const RETURN_MS = 500;
  const DWELL_MS = 900;
  // The shortest visit that reads as work. The host marks some jobs done a few
  // hundred milliseconds after they start; the satellite still finishes its
  // flight and spends this long at the target before it heads home.
  const MIN_VISIT_MS = 1400;
  const HOVER_LIFT = 26;
  const ORBIT_R = 9;
  // Agents at home are never quite still: the whole ring turns at this rate
  // (radians a second, every slot together, so the spacing holds) and each
  // agent bobs a little on a phase of its own.
  const HOME_SPIN = 0.06;
  const HOME_BOB = 1.5;
  const HOME_BOB_HZ = 0.7;
  // Running with nowhere to fly: lift off the home slot and circle it, so work
  // on the assistant itself still reads as work.
  const RUN_LIFT = 8;
  const RUN_ORBIT_R = 4;
  const PULSE_EVERY_MS = 350;
  const SPARK_MS = 450;
  const motions = new Map();
  let external = [];
  let sparks = [];
  const sparkSeen = {};

  function noMotion() {
    return (
      window.MefiNav?.noMotion?.() ??
      (document.body.classList.contains("no-motion") || window.matchMedia("(prefers-reduced-motion: reduce)").matches)
    );
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    width = rail.clientWidth;
    height = rail.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function seedStars() {
    stars = [];
    for (let index = 0; index < 170; index += 1) {
      stars.push({
        x: (Math.random() - 0.5) * 900,
        y: (Math.random() - 0.5) * 700,
        z: (Math.random() - 0.5) * 900,
        size: Math.random() * 1.4 + 0.3,
      });
    }
  }

  const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
  const relative = (ms) => (ms < 60000 ? `${Math.max(1, Math.round(ms / 1000))}s` : ms < 3600000 ? `${Math.round(ms / 60000)}m` : `${Math.round(ms / 3600000)}h`);
  // Cuts at a word, never through one, and says so.
  const clip = (text, max) => {
    const value = String(text ?? "").trim();
    if (value.length <= max) return value;
    const head = value.slice(0, max + 1);
    const at = head.lastIndexOf(" ");
    return `${(at > max * 0.5 ? head.slice(0, at) : head.slice(0, max)).replace(/[\s·,;:—-]+$/, "")}…`;
  };
  // A problem's kind as two words: the pill, the stats line and the status
  // line carry these, the full text rides in their tooltips.
  const PROBLEM_LABELS = {
    "update-held": "update held",
    "store-unavailable": "store unavailable",
    "ai-offline": "AI offline",
    audit: "audit findings",
    collision: "file collision",
    machine: "machine busy",
    "work-stale": "stale work",
  };
  const problemLabel = (problem) => PROBLEM_LABELS[problem?.kind] ?? String(problem?.kind ?? "problem").replace(/-/g, " ");

  // Renderer twin of scripts/assistant.mjs summarizeForTree (main-process only):
  // label / sublabel / tone / pulse for the assistant node, plus `detail`, the
  // untrimmed text for tooltips. Relative times only, never a date. A missing
  // key is not an alarm — local replies still work — so it shows on the card's
  // AI row, not here.
  function assistantSummary(source) {
    const label = "Assistant";
    const out = (sublabel, tone, pulse, detail) => ({ label, sublabel, tone, pulse, detail: detail ?? sublabel });
    if (!window.mefiStudio?.assistantState) return out("desktop app only", "offline", false);
    const state = source ?? null;
    if (!state) return out("starting…", "paused", false);
    const now = Date.now();
    const log = Array.isArray(state.log) ? state.log : [];
    const lastLog = log[log.length - 1] ?? null;
    const pulse = Boolean(lastLog && now - lastLog.at < 4000);
    if (state.status === "paused") return out("paused", "paused", pulse);
    const interval = Math.max(60000, Number(state.intervalMs) || 60000);
    if (state.heartbeatAt && now - state.heartbeatAt > Math.max(interval * 3, 5 * 60000)) {
      return out(`stalled · last tick ${relative(now - state.heartbeatAt)} ago`, "offline", pulse);
    }
    // The pool first: several agents at once, or the one that is running.
    const running = (Array.isArray(state.agents) ? state.agents : []).filter((agent) => agent.status === "running");
    if (running.length >= 2) return out(`${running.length} agents working`, "busy", true, running.map((agent) => `${agent.role}: ${agent.text || "running"}`).join("\n"));
    if (running.length === 1) return out(AGENT_VERBS[running[0].role] ?? `${running[0].role}…`, "busy", true, `${running[0].role}: ${running[0].text || "running"}`);
    const action = state.action ?? null;
    if (action?.kind && action.kind !== "idle" && action.kind !== "tick" && action.text && action.text !== "idle") {
      const text = clip(action.text, 60);
      return out(text.endsWith("…") ? text : `${text}…`, "busy", true, String(action.text));
    }
    const problems = Array.isArray(state.problems) ? state.problems : [];
    const aiDown = problems.find((problem) => problem.kind === "ai-offline");
    if (aiDown || (state.ai?.keyPresent && state.ai.online === false && state.ai.lastError)) {
      const reason = String(state.ai?.lastError ?? aiDown?.text ?? "unknown");
      return out(`AI offline · ${clip(reason, 40)}`, "offline", pulse, `AI offline · ${reason}`);
    }
    if (problems.length) {
      const detail = problems.map((problem) => `${problemLabel(problem)}: ${problem.text ?? ""}`.trim()).join("\n");
      return out(`${plural(problems.length, "problem")} · ${problemLabel(problems[0])}`, "warn", pulse, detail);
    }
    const housekeeping = state.housekeeping ?? null;
    const tidied = housekeeping
      ? (housekeeping.tasksArchived ?? 0) + (housekeeping.ideasPruned ?? 0) + (housekeeping.requestsCleared ?? 0) + (housekeeping.checkpointsDropped ?? 0)
      : 0;
    if (housekeeping?.lastAt && now - housekeeping.lastAt < 120000 && tidied > 0) {
      return out(`tidied ${plural(tidied, "item")}`, "ok", pulse, housekeeping.lastText || `tidied ${plural(tidied, "item")}`);
    }
    const fixes = Array.isArray(state.fixes) ? state.fixes : [];
    const lastFix = fixes[fixes.length - 1] ?? null;
    if (lastFix && now - lastFix.at < 120000) return out(`fixed · ${clip(lastFix.text ?? lastFix.kind, 48)}`, "ok", pulse, `fixed · ${lastFix.text ?? lastFix.kind}`);
    const focus = state.focus?.id ? state.focus : null;
    if (focus) return out(`focused on ${clip(focus.label || focus.id, 40)}`, "ok", pulse, `focused on ${focus.kind} "${focus.label || focus.id}"`);
    const next = state.nextTickAt ? state.nextTickAt - now : 0;
    return out(next > 1000 ? `running · next in ${relative(next)}` : "running · tick due", "ok", pulse);
  }

  function paintStats() {
    if (!window.mefiStudio?.assistantState) {
      stats.textContent = statsBase;
      stats.title = "";
      return;
    }
    const summary = assistantSummary(assistant.state);
    stats.textContent = `${statsBase} · assistant ${summary.sublabel}`;
    stats.title = summary.detail;
  }

  function agentRoster() {
    return window.mefiStudio?.assistantState && Array.isArray(assistant.state?.agents) ? assistant.state.agents.filter((agent) => agent?.role) : [];
  }

  function agentStateOf(agent) {
    return ["running", "queued", "error", "done"].includes(agent.status) ? agent.status : "idle";
  }

  // Keeps the assistant node's tone and the agents' statuses in step between
  // rebuilds. A roster whose roles changed needs the layout redone.
  function syncAssistantNode() {
    const node = nodes.find((entry) => entry.kind === "assistant");
    if (!node) return false;
    const summary = assistantSummary(assistant.state);
    node.state = summary.tone;
    node.tone = summary.tone;
    node.sublabel = summary.sublabel;
    const roster = agentRoster();
    const satellites = nodes.filter((entry) => entry.kind === "agent");
    if (roster.length !== satellites.length || roster.some((agent) => !satellites.some((entry) => entry.role === agent.role))) return true;
    for (const agent of roster) {
      const satellite = satellites.find((entry) => entry.role === agent.role);
      satellite.status = agentStateOf(agent);
      satellite.state = satellite.status;
      satellite.text = agent.text ?? "";
      satellite.error = agent.error ?? null;
      satellite.lastRunAt = agent.lastRunAt ?? 0;
      satellite.since = agent.since ?? 0;
      satellite.runs = agent.runs ?? 0;
      satellite.progress = typeof agent.progress === "number" ? agent.progress : null;
    }
    reconcileMotions(roster);
    return false;
  }

  function rebuild() {
    buildGraph(cache.sessions, cache.todos, cache.fallback ?? undefined);
  }

  // ---- agent travel ---------------------------------------------------------
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
  const hoverPoint = (target) => ({ x: target.x, y: target.y - HOVER_LIFT, z: target.z });
  const findNodeById = (id) => nodes.find((node) => node.id === id) ?? null;
  const agentNodeOf = (role) => nodes.find((node) => node.kind === "agent" && node.role === role) ?? null;
  // Where a home slot is *now*. buildGraph lays the ring out once; the ring
  // then turns slowly around the assistant and every agent bobs, so home is a
  // function of time and everything that wants one asks here. noMotion() gets
  // the still slot back, exactly as the layout placed it.
  function homePoint(home, now) {
    if (!home) return { x: 0, y: 0, z: 0 };
    if (noMotion()) return { x: home.x, y: home.y, z: home.z };
    const hub = home.hub ?? findNodeById("__assistant__") ?? { x: 0, y: -110, z: 0 };
    const seconds = (typeof now === "number" ? now : performance.now()) / 1000;
    const spin = seconds * HOME_SPIN;
    const cos = Math.cos(spin);
    const sin = Math.sin(spin);
    const dx = home.x - hub.x;
    const dz = home.z - hub.z;
    return {
      x: hub.x + dx * cos - dz * sin,
      y: home.y + Math.sin(seconds * Math.PI * 2 * HOME_BOB_HZ + (home.index ?? 0) * 1.1) * HOME_BOB,
      z: hub.z + dx * sin + dz * cos,
    };
  }

  function ensureMotion(node) {
    let motion = motions.get(node.role);
    if (!motion) {
      motion = {
        role: node.role,
        x: node.home.x,
        y: node.home.y,
        z: node.home.z,
        home: node.home,
        from: null,
        to: null,
        startedAt: 0,
        hoverStart: 0,
        dwellUntil: 0,
        lastPulseAt: 0,
        targets: [],
        index: 0,
        phase: "home",
        wantedId: null,
        targetId: null,
        targetLabel: null,
        lastTargetId: null,
        pulseSeq: 0,
        sparkSeq: 0,
        doneSeq: 0,
        // Set by requestReturn() while a finished job waits out MIN_VISIT_MS.
        pendingReturn: null,
      };
      motions.set(node.role, motion);
    }
    motion.home = node.home;
    return motion;
  }

  // A host target { kind, id } (or a bare id) as a node id both surfaces know.
  function targetIdOf(target) {
    if (!target) return null;
    if (typeof target === "string") return target;
    const id = String(target.id ?? "");
    switch (target.kind) {
      case "assistant":
        return "__assistant__";
      case "root":
        return "__root__";
      case "folded":
        return "__folded__";
      case "task":
        return id ? (id.startsWith("task:") ? id : `task:${id}`) : null;
      case "todo": {
        const node = findNodeById(id);
        if (node?.kind === "todo") return node.sessionId;
        return id.split(":")[0] || null;
      }
      default:
        return id || null;
    }
  }

  // Where a target sits in tree space: a rail node, a task node the Command view
  // registered, or the root while a task has no position anywhere yet.
  function resolveTarget(id) {
    if (!id) return null;
    const node = findNodeById(id);
    if (node) return { id: node.id, x: node.x, y: node.y, z: node.z, label: node.label };
    const ext = external.find((entry) => entry.id === id);
    if (ext) return { id: ext.id, x: ext.x, y: ext.y, z: ext.z, label: ext.label, external: true };
    if (id.startsWith("task:")) {
      const root = findNodeById("__root__");
      return root ? { id: root.id, x: root.x, y: root.y, z: root.z, label: root.label, fallback: true } : null;
    }
    return null;
  }

  // What the rail draws the tether to: the node itself, or — the rail has no
  // task nodes — the task's anchor session, else the root.
  function tetherNode(id) {
    const node = findNodeById(id);
    if (node) return node;
    const ext = external.find((entry) => entry.id === id);
    if (ext) return (ext.anchorSessionId && findNodeById(ext.anchorSessionId)) || findNodeById("__root__");
    return null;
  }

  // Targets from the event or the roster row; null when the host sent none.
  function eventTargets(event, row) {
    const list =
      Array.isArray(event?.targets) && event.targets.length
        ? event.targets
        : Array.isArray(row?.targets) && row.targets.length
          ? row.targets
          : event?.target
            ? [event.target]
            : row?.target
              ? [row.target]
              : null;
    if (!list) return null;
    const ids = list.map(targetIdOf).filter(Boolean);
    return ids.length ? ids : null;
  }

  // A sensible target when the host named none: reference → the task its text
  // names, watcher → the ordered sessions (and the folded cluster), keeper and
  // grower → the folded cluster, briefer → the active sessions, machine → the
  // root, everything else → the assistant.
  function deriveTargets(role, text) {
    const org = assistant.state?.organization ?? null;
    const has = (id) => Boolean(findNodeById(id));
    if (role === "reference") {
      const lower = String(text ?? "").toLowerCase();
      const words = (value) => String(value ?? "").toLowerCase().match(/[a-z0-9][a-z0-9_-]{3,}/g) ?? [];
      const hit = external.find((entry) => entry.kind === "task" && entry.label && lower.includes(String(entry.label).toLowerCase().slice(0, 40)));
      const near = hit ?? external.find((entry) => entry.kind === "task" && words(entry.label).filter((word) => lower.includes(word)).length >= 2);
      return near ? [near.id] : ["__assistant__"];
    }
    if (role === "watcher") {
      const ids = (Array.isArray(org?.order) ? org.order : []).filter(has);
      if (has("__folded__")) ids.push("__folded__");
      return ids.length ? ids : ["__root__"];
    }
    if (role === "keeper" || role === "grower") return [has("__folded__") ? "__folded__" : "__root__"];
    if (role === "briefer") {
      const ids = (Array.isArray(org?.active) ? org.active : []).filter(has);
      return ids.length ? ids : ["__assistant__"];
    }
    if (role === "machine") return ["__root__"];
    return ["__assistant__"];
  }

  function startHover(motion, now) {
    motion.phase = "hovering";
    motion.hoverStart = now;
    motion.dwellUntil = now + DWELL_MS;
    motion.lastPulseAt = now;
  }

  // Running, but the host named no node this rail knows (an auditor or an
  // improver working on the assistant itself): lift off the home slot and
  // circle it rather than sit frozen in the ring. hoverStart counts the visit,
  // so MIN_VISIT_MS applies here exactly as it does at a target.
  function startRunning(motion, wantedId, now) {
    motion.wantedId = wantedId ?? null;
    motion.targetId = null;
    motion.targetLabel = null;
    motion.from = { x: motion.x, y: motion.y, z: motion.z };
    motion.startedAt = now;
    motion.hoverStart = now;
    motion.dwellUntil = now + DWELL_MS;
    motion.lastPulseAt = now;
    motion.phase = "running";
  }

  // Doing stuff: a small surge down the tether and a few sparks, at most one
  // set every PULSE_EVERY_MS. The counters are what the Command view watches.
  function emitWork(motion, node, now) {
    if (now - motion.lastPulseAt < PULSE_EVERY_MS) return;
    motion.lastPulseAt = now;
    motion.pulseSeq += 1;
    motion.sparkSeq += 1;
    const to = tetherNode(motion.targetId);
    const tint = agentColor(node.role);
    if (to) pulses.push({ from: node, to, start: now, duration: 320, color: tint, glow: tint, small: true, wave: true });
  }

  // A return that requestReturn() held back leaves the moment the agent has
  // spent MIN_VISIT_MS at the target — with the bright pulse it was holding.
  function settleIfDue(motion, role, now) {
    if (!motion.pendingReturn || now - motion.hoverStart < MIN_VISIT_MS) return false;
    const bright = Boolean(motion.pendingReturn.bright);
    motion.pendingReturn = null;
    returnHome(role, bright);
    return true;
  }

  function flyTo(motion, wantedId, now) {
    const resolved = resolveTarget(wantedId);
    if (!resolved) {
      startRunning(motion, wantedId, now);
      return;
    }
    motion.wantedId = wantedId;
    motion.targetId = resolved.id;
    motion.targetLabel = resolved.label;
    motion.from = { x: motion.x, y: motion.y, z: motion.z };
    motion.to = hoverPoint(resolved);
    motion.startedAt = now;
    motion.phase = "flying";
    if (noMotion()) {
      motion.x = motion.to.x;
      motion.y = motion.to.y;
      motion.z = motion.to.z;
      startHover(motion, now);
    }
  }

  function setAgentTargets(role, ids) {
    const node = agentNodeOf(role);
    if (!node) return;
    const motion = ensureMotion(node);
    const list = (ids ?? []).filter(Boolean);
    if (!list.length) return;
    // Running again: whatever return was waiting on this visit is off.
    motion.pendingReturn = null;
    const same = motion.targets.length === list.length && motion.targets.every((id, index) => id === list[index]);
    if (same && (motion.phase === "flying" || motion.phase === "hovering")) return;
    motion.targets = list;
    motion.index = 0;
    flyTo(motion, list[0], performance.now());
  }

  function returnHome(role, bright) {
    const motion = motions.get(role);
    if (!motion || motion.phase === "home" || motion.phase === "returning") return;
    const now = performance.now();
    if (bright) {
      // One bright surge from the work back to the assistant: done.
      motion.doneSeq += 1;
      const from = tetherNode(motion.targetId);
      const hub = findNodeById("__assistant__");
      if (from && hub) pulses.push({ from, to: hub, start: now, duration: 700, color: "#fff2cc", glow: "#f1dcae", wave: true });
    }
    motion.pendingReturn = null;
    motion.lastTargetId = motion.targetId;
    motion.targets = [];
    motion.index = 0;
    motion.wantedId = null;
    motion.targetId = null;
    motion.targetLabel = null;
    motion.from = { x: motion.x, y: motion.y, z: motion.z };
    motion.startedAt = now;
    motion.phase = "returning";
    if (noMotion()) {
      const home = homePoint(motion.home, now);
      motion.x = home.x;
      motion.y = home.y;
      motion.z = home.z;
      motion.phase = "home";
    }
  }

  // What a done / error / idle asks for. The host finishes some jobs a few
  // hundred milliseconds after it started them, and a satellite that turns
  // round mid-flight never reads as having gone anywhere: while the agent is
  // still flying, or has been at the target for less than MIN_VISIT_MS, note
  // the return and let the visit run. settleIfDue() sends it home after that,
  // with the bright "done" pulse fired at the moment it actually leaves. A new
  // running event for the role cancels the wait (see setAgentTargets), and a
  // target that vanishes still brings the agent straight back.
  function requestReturn(role, bright) {
    const motion = motions.get(role);
    if (!motion || motion.phase === "home" || motion.phase === "returning") return;
    const visiting = motion.phase === "hovering" || motion.phase === "running";
    const spent = visiting ? performance.now() - motion.hoverStart : 0;
    if (!visiting || spent < MIN_VISIT_MS) {
      motion.pendingReturn = { bright: Boolean(bright) };
      // Hold it on the target it is on: no hopping to the next one now.
      motion.targets = motion.wantedId ? [motion.wantedId] : [];
      motion.index = 0;
      return;
    }
    returnHome(role, bright);
  }

  // The roster is the truth between events: a running row with a target flies,
  // a row that stopped comes home.
  function reconcileMotions(roster) {
    for (const agent of roster) {
      const phase = motions.get(agent.role)?.phase ?? "home";
      if (agent.status === "running") {
        const ids = eventTargets(null, agent);
        if (ids) setAgentTargets(agent.role, ids);
        else if (phase === "home") setAgentTargets(agent.role, deriveTargets(agent.role, agent.text));
      } else if (agent.status !== "queued" && phase !== "home" && phase !== "returning") {
        requestReturn(agent.role, agent.status === "done");
      }
    }
  }

  // Both canvases advance time-based flights before reading their positions.
  // The rail's frame cadence does not control Command's animation cadence.
  function advanceMotion(now) {
    const still = noMotion();
    for (const node of nodes) {
      if (node.kind !== "agent") continue;
      // Every agent gets a motion record, idle ones included: home drifts too.
      const motion = motions.get(node.role) ?? ensureMotion(node);
      motion.home = node.home;
      const home = homePoint(motion.home, now);
      if (motion.phase === "home") {
        motion.x = home.x;
        motion.y = home.y;
        motion.z = home.z;
      } else if (motion.phase === "returning") {
        // The slot it left has turned on since: aim at where home is now.
        const t = still ? 1 : Math.min(1, (now - motion.startedAt) / RETURN_MS);
        const e = easeInOut(t);
        motion.x = motion.from.x + (home.x - motion.from.x) * e;
        motion.y = motion.from.y + (home.y - motion.from.y) * e;
        motion.z = motion.from.z + (home.z - motion.from.z) * e;
        if (t >= 1) motion.phase = "home";
      } else if (motion.phase === "running") {
        const late = resolveTarget(motion.wantedId);
        // A node that only now exists (the Command view placed its task): go.
        if (late) {
          flyTo(motion, motion.wantedId, now);
        } else {
          const age = (now - motion.hoverStart) / 1000;
          const spin = still ? 0 : age * Math.PI;
          motion.x = home.x + (still ? 0 : Math.cos(spin) * RUN_ORBIT_R);
          motion.y = home.y - RUN_LIFT;
          motion.z = home.z + (still ? 0 : Math.sin(spin) * RUN_ORBIT_R);
          emitWork(motion, node, now);
          if (!settleIfDue(motion, node.role, now) && motion.targets.length > 1 && now >= motion.dwellUntil) {
            motion.index = (motion.index + 1) % motion.targets.length;
            flyTo(motion, motion.targets[motion.index], now);
          }
        }
      } else {
        const resolved = resolveTarget(motion.wantedId);
        if (!resolved) {
          returnHome(node.role, false);
        } else {
          // A task node the Command view placed after take-off: re-aim at it.
          if (resolved.id !== motion.targetId) flyTo(motion, motion.wantedId, now);
          motion.targetLabel = resolved.label;
          const anchor = hoverPoint(resolved);
          if (motion.phase === "flying") {
            motion.to = anchor;
            const t = still ? 1 : Math.min(1, (now - motion.startedAt) / FLY_MS);
            const e = easeInOut(t);
            motion.x = motion.from.x + (motion.to.x - motion.from.x) * e;
            motion.y = motion.from.y + (motion.to.y - motion.from.y) * e;
            motion.z = motion.from.z + (motion.to.z - motion.from.z) * e;
            if (t >= 1) startHover(motion, now);
          } else if (motion.phase === "hovering") {
            const age = (now - motion.hoverStart) / 1000;
            const spin = still ? 0 : age * Math.PI; // half a revolution per second
            const bob = still ? 0 : Math.sin(age * Math.PI * 2 * 1.2) * 3;
            motion.x = anchor.x + Math.cos(spin) * ORBIT_R;
            motion.y = anchor.y + bob;
            motion.z = anchor.z + Math.sin(spin) * ORBIT_R;
            emitWork(motion, node, now);
            // The job may have finished already: the visit still runs its
            // MIN_VISIT_MS, and only then does the agent head home.
            if (!settleIfDue(motion, node.role, now) && motion.targets.length > 1 && now >= motion.dwellUntil) {
              motion.index = (motion.index + 1) % motion.targets.length;
              flyTo(motion, motion.targets[motion.index], now);
            }
          }
        }
      }
      node.x = motion.x;
      node.y = motion.y;
      node.z = motion.z;
      node.phase = motion.phase;
      node.targetId = motion.targetId;
      node.targetLabel = motion.targetLabel;
    }
  }

  function agentPositions() {
    const out = {};
    for (const node of nodes) {
      if (node.kind !== "agent") continue;
      const motion = motions.get(node.role);
      // The motion record is the truth; the node follows it each frame.
      out[node.role] = {
        x: motion?.x ?? node.x,
        y: motion?.y ?? node.y,
        z: motion?.z ?? node.z,
        phase: motion?.phase ?? "home",
        targetId: motion?.targetId ?? null,
        targetLabel: motion?.targetLabel ?? null,
        lastTargetId: motion?.lastTargetId ?? null,
        pulseSeq: motion?.pulseSeq ?? 0,
        sparkSeq: motion?.sparkSeq ?? 0,
        doneSeq: motion?.doneSeq ?? 0,
      };
    }
    return out;
  }

  // `fallback` names the empty state when the store gave no roots: the store is
  // offline, the app runs in a browser, or there simply is nothing recent. The
  // root and the assistant node are built either way, so the assistant stays
  // visible and selectable whatever the store is doing.
  function buildGraph(sessions, todos, fallback = { status: "empty", text: "no recent sessions", stats: "no recent sessions" }) {
    cache.sessions = sessions;
    cache.todos = todos;
    cache.fallback = fallback;
    nodes = [];
    edges = [];
    const now = Date.now();
    const org = assistant.state?.organization ?? null;
    const byId = new Map(sessions.map((session) => [session.id, session]));
    const recent = (session) => !session.parentId && session.timeUpdated > now - 1000 * 60 * 60 * 24 * 14;
    const maxSessions = Math.max(1, Number(org?.policy?.maxSessions) || 8);
    const maxTodos = Math.max(1, Number(org?.policy?.maxTodosPerSession) || 14);
    const foldedIds = Array.isArray(org?.folded) ? org.folded.filter((id) => byId.has(id)) : [];
    const foldedSet = new Set(foldedIds);
    const staleSet = new Set(Array.isArray(org?.stale) ? org.stale : []);
    // The assistant's organisation decides the roots: active first, then working,
    // then stale, finished ones folded into one node. Before its first tick, or
    // when its ids no longer match the store, the old rule stands.
    const ordered = Array.isArray(org?.order) ? org.order.map((id) => byId.get(id)).filter((session) => session && recent(session)) : [];
    const organized = ordered.length || foldedIds.length ? ordered : null;
    // No organisation yet (first boot, or ids that no longer match the store):
    // newest first, capped like the organised list.
    const roots = organized
      ? organized.slice(0, maxSessions)
      : sessions.filter(recent).sort((a, b) => (b.timeUpdated ?? 0) - (a.timeUpdated ?? 0)).slice(0, maxSessions);

    const rootNode = { id: "__root__", kind: "root", label: "sessions", x: 0, y: -40, z: 0, state: "session", r: 5 };
    nodes.push(rootNode);
    const golden = Math.PI * (3 - Math.sqrt(5));
    roots.forEach((session, index) => {
      const baseAngle = index * golden;
      const radius = 120;
      const stale = staleSet.has(session.id);
      const node = {
        id: session.id,
        kind: "session",
        label: session.title || session.id,
        agent: session.agent,
        model: session.model?.id,
        updated: session.timeUpdated,
        stale,
        x: Math.cos(baseAngle) * radius,
        y: Math.sin(baseAngle * 0.7) * 30,
        z: Math.sin(baseAngle) * radius,
        state: "session",
        r: stale ? 4.8 : 6,
        todos: [],
      };
      nodes.push(node);
      edges.push({ a: rootNode, b: node });
      const sessionTodos = todos
        .filter((todo) => todo.sessionId === session.id)
        .sort((a, b) => a.position - b.position)
        .slice(0, maxTodos);
      // A stale session keeps its colour from its todos but draws none of them.
      const shown = stale ? [] : sessionTodos;
      node.todos = shown;
      const span = Math.max(1, shown.length);
      shown.forEach((todo, todoIndex) => {
        const todoAngle = (todoIndex / span) * Math.PI * 2;
        const todoNode = {
          id: `${session.id}:${todo.position}:${todoIndex}`,
          kind: "todo",
          label: todo.content,
          status: todo.status,
          sessionId: session.id,
          x: node.x + Math.cos(todoAngle) * 46,
          y: node.y + 34 + Math.sin(todoIndex * 1.3) * 8,
          z: node.z + Math.sin(todoAngle) * 46,
          state: todo.status === "completed" ? "done" : todo.status === "in_progress" ? "active" : "pending",
          r: 4,
        };
        nodes.push(todoNode);
        edges.push({ a: node, b: todoNode, sessionId: session.id });
      });
      const done = sessionTodos.filter((todo) => todo.status === "completed").length;
      const active = sessionTodos.some((todo) => todo.status === "in_progress");
      // A stale session keeps a done/active colour its todos earned; with
      // none to show it takes the dim stale tone.
      node.state = active ? "active" : sessionTodos.length && done === sessionTodos.length ? "done" : stale ? "stale" : "session";
      node.progress = sessionTodos.length ? done / sessionTodos.length : 0;
    });
    if (foldedIds.length) {
      const foldAngle = roots.length * golden;
      const foldedNode = {
        id: "__folded__",
        kind: "folded",
        // "sessions" is the load-bearing word: the fold counts finished agent
        // sessions (Explorer material), not the task board's Done pile.
        label: `${foldedIds.length} finished sessions`,
        count: foldedIds.length,
        sessionIds: foldedIds,
        titles: foldedIds.slice(0, 8).map((id) => byId.get(id)?.title || id),
        state: "done",
        r: 5,
        x: Math.cos(foldAngle) * 150,
        y: 58,
        z: Math.sin(foldAngle) * 150,
      };
      nodes.push(foldedNode);
      edges.push({ a: rootNode, b: foldedNode });
    }
    const summary = assistantSummary(assistant.state);
    const assistantNode = {
      id: "__assistant__",
      kind: "assistant",
      label: summary.label,
      sublabel: summary.sublabel,
      tone: summary.tone,
      state: summary.tone,
      x: 0,
      y: -110,
      z: 0,
      r: 6,
    };
    nodes.push(assistantNode);
    edges.push({ a: rootNode, b: assistantNode, assistant: true });
    // The pool's agents ring the assistant, one satellite per role.
    const roster = agentRoster();
    roster.forEach((agent, index) => {
      const spin = (index / Math.max(1, roster.length)) * Math.PI * 2;
      // The overseer is the R&D layer above the assistant, not a worker in the
      // ring — it hovers overhead and slowly turns around its own hub.
      const above = agent.role === "overseer";
      const home = {
        x: above ? assistantNode.x + 6 : assistantNode.x + Math.cos(spin) * AGENT_RING,
        y: above ? assistantNode.y - 26 : assistantNode.y + Math.sin(index * 1.7) * 6,
        z: above ? assistantNode.z + 6 : assistantNode.z + Math.sin(spin) * AGENT_RING,
        // The slot turns around this hub and bobs on this index: homePoint()
        // reads both, so the ring keeps its radius and its spacing while it
        // drifts.
        hub: { x: assistantNode.x, y: assistantNode.y, z: assistantNode.z },
        index,
      };
      // A satellite away from home keeps its place across a rebuild.
      const motion = motions.get(agent.role) ?? null;
      const away = motion && motion.phase !== "home";
      const spot = away ? motion : homePoint(home, performance.now());
      const agentNode = {
        id: `__agent__:${agent.role}`,
        kind: "agent",
        role: agent.role,
        label: agent.role,
        status: agentStateOf(agent),
        state: agentStateOf(agent),
        text: agent.text ?? "",
        error: agent.error ?? null,
        lastRunAt: agent.lastRunAt ?? 0,
        since: agent.since ?? 0,
        runs: agent.runs ?? 0,
        progress: typeof agent.progress === "number" ? agent.progress : null,
        home,
        phase: motion?.phase ?? "home",
        targetId: motion?.targetId ?? null,
        targetLabel: motion?.targetLabel ?? null,
        x: spot.x,
        y: spot.y,
        z: spot.z,
        r: above ? 4 : 3.2,
      };
      if (motion) motion.home = home;
      nodes.push(agentNode);
      edges.push({ a: assistantNode, b: agentNode, agent: true });
    });
    reconcileMotions(roster);

    const all = nodes.filter((node) => node.kind === "todo");
    const doneCount = all.filter((node) => node.state === "done").length;
    // The hub wears the whole board on its own meter: how much of the
    // sessions' work is done, at a glance.
    const hubNode = nodes.find((node) => node.kind === "assistant");
    if (hubNode) hubNode.progress = all.length ? doneCount / all.length : null;
    if (!roots.length && !foldedIds.length) {
      status = fallback.status;
      statusText = fallback.text;
      statsBase = fallback.stats;
    } else {
      statsBase = `${plural(roots.length, "session")}${foldedIds.length ? ` · ${foldedIds.length} folded` : ""} · ${plural(all.length, "task")} · ${all.length ? Math.round((doneCount / all.length) * 100) : 0}% done`;
      status = "ok";
      statusText = statsBase;
    }
    paintStats();
    // Keyboard focus follows its node across a rebuild (todos re-index,
    // sessions fold away) and drops when the node is gone.
    if (kbdFocus) setKbdFocus(findNodeById(kbdFocus.id));
    // The two numbers nav paints everywhere are already here: push them instead
    // of making nav fan out to IPC on every rail reload.
    const inProgress = nodes.filter((node) => node.kind === "todo" && node.status === "in_progress").length;
    window.MefiNav?.setBadge?.({ progress: inProgress, sessions: roots.length });
  }

  function project(node) {
    // Scale the whole constellation with the rail width so the collapsed rail
    // still hints at the tree and the expanded rail gets a full spread.
    const fit = Math.min(1.5, Math.max(0.55, width / 420));
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const x = (node.x * cos - node.z * sin) * fit;
    const z = (node.x * sin + node.z * cos) * fit;
    const y = node.y * fit;
    const depth = z + 430;
    const k = 520 / Math.max(120, depth);
    return {
      x: width / 2 + x * k,
      y: height / 2 + (y - 20) * k,
      k,
      depth,
    };
  }

  function colorOf(node) {
    if (node.kind === "assistant") return COLORS.assistant;
    if (node.kind === "agent") {
      // status first: amber on error, green when the last job is done, dim
      // slate while queued; a running or idle satellite wears the role colour
      if (node.status === "error") return COLORS.amber;
      if (node.status === "done") return COLORS.done;
      if (node.status === "queued") return COLORS.pending;
      return agentColor(node.role);
    }
    if (node.state === "stale") return COLORS.stale;
    if (node.state === "done") return COLORS.done;
    if (node.state === "active") return COLORS.active;
    if (node.state === "session") return node.progress === 1 ? COLORS.done : node.progress ? COLORS.active : COLORS.session;
    return COLORS.pending;
  }

  const hexRgb = (hex) => {
    const value = String(hex ?? "#a9ffcd").replace("#", "");
    const int = parseInt(value.length === 3 ? value.split("").map((char) => char + char).join("") : value, 16);
    return `${(int >> 16) & 255},${(int >> 8) & 255},${int & 255}`;
  };

  // A `wave` pulse never launches a dot: the line itself answers. It bows on
  // its normal like a plucked string while a bright head with a long fading
  // tail runs a -> b, then a bloom lands on the receiving node. Reduced motion
  // gets a fading flash of the whole line instead of the travel.
  function surgeLine(a, b, t, pulse, still) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 2) return;
    const tint = hexRgb(pulse.color);
    if (still) {
      ctx.strokeStyle = `rgba(${tint},${0.5 * (1 - t)})`;
      ctx.lineWidth = pulse.small ? 1.3 : 2;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      return;
    }
    const env = Math.sin(Math.PI * t);
    const bow = env * Math.min(13, len * 0.12);
    const cx = (a.x + b.x) / 2 + (-dy / len) * bow;
    const cy = (a.y + b.y) / 2 + (dx / len) * bow;
    ctx.save();
    // wake: the whole path warms under the surge
    ctx.strokeStyle = `rgba(${tint},${0.28 * env})`;
    ctx.lineWidth = pulse.small ? 1.2 : 1.8;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(cx, cy, b.x, b.y);
    ctx.stroke();
    // surge: a bright head with a long tail runs the line
    const head = Math.min(1, Math.max(0, t));
    const gradient = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    gradient.addColorStop(0, `rgba(${tint},0)`);
    gradient.addColorStop(Math.max(0, head - 0.45), `rgba(${tint},${0.22 * env})`);
    gradient.addColorStop(head, `rgba(${tint},${0.95 * env})`);
    gradient.addColorStop(Math.min(1, head + 0.03), `rgba(${tint},0)`);
    ctx.strokeStyle = gradient;
    ctx.lineWidth = pulse.small ? 1.7 : 2.6;
    ctx.shadowColor = pulse.glow ?? "#57ff9a";
    ctx.shadowBlur = 11;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(cx, cy, b.x, b.y);
    ctx.stroke();
    ctx.restore();
    // the signal lands: a quick bloom on the receiving node
    const land = Math.max(0, (t - 0.8) / 0.2);
    if (land > 0) {
      const bloom = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, 14);
      bloom.addColorStop(0, `rgba(${tint},${0.65 * land})`);
      bloom.addColorStop(1, `rgba(${tint},0)`);
      ctx.fillStyle = bloom;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 14, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawStars() {
    for (const star of stars) {
      const p = project(star);
      if (p.depth < 80) continue;
      const alpha = Math.max(0.05, Math.min(0.5, 1 - p.depth / 900));
      ctx.fillStyle = `rgba(236, 229, 216, ${alpha * 0.5})`;
      ctx.fillRect(p.x, p.y, star.size, star.size);
    }
  }

  function draw(time) {
    if (!width || !height) resize();
    ctx.clearRect(0, 0, width, height);
    drawStars();

    const projected = new Map();
    for (const node of nodes) projected.set(node, project(node));

    // edges, far to near
    const orderedEdges = [...edges].sort((a, b) => projected.get(b.a).depth - projected.get(a.a).depth);
    for (const edge of orderedEdges) {
      const a = projected.get(edge.a);
      const b = projected.get(edge.b);
      if (a.depth < 60 || b.depth < 60) continue;
      ctx.strokeStyle = edge.sessionId && edge.sessionId === activeSessionId ? COLORS.edgeActive : COLORS.edge;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // pulses — a line that ends at an agent carries the signal itself
    // (wave, see surgeLine); the rest stay travelling dots
    const still = noMotion();
    pulses = pulses.filter((pulse) => time - pulse.start < pulse.duration);
    for (const pulse of pulses) {
      const a = projected.get(pulse.from);
      const b = projected.get(pulse.to);
      if (!a || !b) continue;
      const t = Math.min(1, (time - pulse.start) / pulse.duration);
      if (pulse.wave) {
        surgeLine(a, b, t, pulse, still);
        continue;
      }
      const px = a.x + (b.x - a.x) * t;
      const py = a.y + (b.y - a.y) * t;
      ctx.beginPath();
      ctx.arc(px, py, pulse.small ? 2.2 : 3.4, 0, Math.PI * 2);
      ctx.fillStyle = pulse.color ?? "#a9ffcd";
      ctx.shadowColor = pulse.glow ?? "#57ff9a";
      ctx.shadowBlur = 14;
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // tethers: a travelling agent stays tied to the node it works on
    for (const node of nodes) {
      if (node.kind !== "agent") continue;
      const motion = motions.get(node.role);
      if (!motion || (motion.phase !== "flying" && motion.phase !== "hovering")) continue;
      const target = tetherNode(motion.targetId);
      const a = projected.get(node);
      const b = target ? projected.get(target) : null;
      if (!a || !b || a.depth < 60 || b.depth < 60) continue;
      const tint = hexRgb(agentColor(node.role));
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.lineDashOffset = noMotion() ? 0 : -((time / 40) % 8);
      ctx.strokeStyle = `rgba(${tint}, 0.55)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.restore();
      const glow = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, 7);
      glow.addColorStop(0, `rgba(${tint}, 0.9)`);
      glow.addColorStop(1, `rgba(${tint}, 0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 7, 0, Math.PI * 2);
      ctx.fill();
    }

    // nodes, far to near
    const ordered = [...nodes].sort((a, b) => projected.get(b).depth - projected.get(a).depth);
    const running = Boolean(window.mefiStudio?.assistantState) && assistant.state?.status === "running";
    for (const node of ordered) {
      const p = projected.get(node);
      if (p.depth < 60) continue;
      const isHover = hover === node;
      const isAssistant = node.kind === "assistant";
      const isFolded = node.kind === "folded";
      const isAgent = node.kind === "agent";
      const working = node.state === "active" || (isAgent && node.status === "running");
      const wobble = working && !noMotion() ? 1 + Math.sin(time / 260) * 0.14 : 1;
      const radius = Math.max(1.8, node.r * p.k * (isHover ? 1.6 : 1) * wobble);
      const color = colorOf(node);
      // Freshness: other concurrent sessions share this constellation, so fade
      // anything that has not been touched recently. The assistant is always
      // current, the folded cluster is history, a stale session sits at 0.45,
      // an agent is as bright as its status.
      const ageMinutes = node.updated ? (Date.now() - node.updated) / 60000 : 999;
      let fresh = isAssistant ? 1 : isFolded ? 0.7 : ageMinutes < 2 ? 1 : ageMinutes < 15 ? 0.85 : ageMinutes < 120 ? 0.6 : 0.4;
      if (isAgent)
        fresh =
          node.status === "running"
            ? 1
            : node.status === "error"
              ? 0.9
              : node.status === "queued"
                ? 0.65
                : node.status === "done"
                  ? 0.55
                  : 0.4;
      if (node.stale) fresh = Math.min(fresh, 0.45);
      // A tight halo over a solid core: wide gradients turned the small rail
      // nodes into one soft smear where the tree met the assistant ring.
      const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius * 2.6);
      gradient.addColorStop(0, color);
      gradient.addColorStop(0.45, color + "99");
      gradient.addColorStop(1, "transparent");
      ctx.globalAlpha = 0.9 * fresh;
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius * 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = fresh;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;
      if (node.kind === "session" && node.id === activeSessionId) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius + 5, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(236, 229, 216, 0.85)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      const focused = assistant.state?.focus;
      if (focused && node.kind === focused.kind && node.id === focused.id) {
        // The node the assistant was pointed at: a thin gold ring outside the
        // selection ring, breathing gently while the service runs.
        const breath = running && !noMotion() ? (Math.sin(time / 1200) + 1) / 2 : 0.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius + 9 + breath * 2, 0, Math.PI * 2);
        ctx.strokeStyle = COLORS.assistant;
        ctx.globalAlpha = 0.3 + breath * 0.35;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (isAssistant) {
        // A slow breathing gold ring while the service runs, a still grey ring
        // when paused, amber whenever the tone asks for attention.
        const tone = node.tone;
        const breath = running && !noMotion() ? (Math.sin(time / 900) + 1) / 2 : 0.5;
        const ringColor = tone === "warn" || tone === "offline" ? COLORS.amber : !running || tone === "paused" ? COLORS.grey : COLORS.assistant;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius + 4 + breath * 4, 0, Math.PI * 2);
        ctx.strokeStyle = ringColor;
        ctx.globalAlpha = running ? 0.35 + breath * 0.45 : 0.55;
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (isFolded) {
        // Two thin rings: one node standing for several sessions.
        for (const [gap, alpha] of [[3, 0.5], [6, 0.28]]) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, radius + gap, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(87, 255, 154, ${alpha})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
      const notes = node.kind === "session" ? checkpoints[node.id] : null;
      if (notes?.length) {
        const size = Math.max(5, 7 * p.k * (isHover ? 1.35 : 1));
        const bx = p.x + radius + 5;
        const by = p.y - radius - size * 1.8;
        ctx.globalAlpha = fresh;
        ctx.fillStyle = "#c9a86a";
        ctx.beginPath();
        ctx.roundRect(bx, by, size * 1.5, size, size * 0.35);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(bx + size * 0.25, by + size);
        ctx.lineTo(bx + size * 0.2, by + size * 1.55);
        ctx.lineTo(bx + size * 0.75, by + size);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      node._px = p.x;
      node._py = p.y;
      node._pr = radius;
      // Work-left meter: a slim bar under anything with a known fraction —
      // sessions by their todos, agents by their own progress, the assistant
      // by the whole board. The empty track is the work still to do; a full
      // green bar says none of it is.
      const meter = typeof node.progress === "number" && Number.isFinite(node.progress) ? Math.min(1, Math.max(0, node.progress)) : null;
      if (meter != null) {
        const trackW = Math.max(10, Math.min(24, radius * 4));
        const trackH = 2;
        const mx = p.x - trackW / 2;
        const my = p.y + radius + 4;
        ctx.globalAlpha = 0.85 * fresh;
        ctx.fillStyle = "rgba(236, 229, 216, 0.16)";
        ctx.beginPath();
        ctx.roundRect(mx, my, trackW, trackH, trackH / 2);
        ctx.fill();
        if (meter > 0) {
          ctx.fillStyle = meter >= 1 ? COLORS.done : color;
          ctx.beginPath();
          ctx.roundRect(mx, my, Math.max(trackH, trackW * meter), trackH, trackH / 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    }

    // sparks: a hovering agent throws off a few gold specks every pulse
    for (const node of nodes) {
      if (node.kind !== "agent" || node._px == null) continue;
      const motion = motions.get(node.role);
      if (!motion) continue;
      const seen = sparkSeen[node.role] ?? 0;
      if (motion.sparkSeq <= seen) continue;
      sparkSeen[node.role] = motion.sparkSeq;
      if (noMotion()) continue;
      const count = 2 + Math.round(Math.random());
      const tint = agentColor(node.role);
      for (let index = 0; index < count; index += 1) {
        sparks.push({ x: node._px, y: node._py, vx: (Math.random() - 0.5) * 1.8, vy: -0.5 - Math.random() * 1.2, born: time, color: tint });
      }
    }
    sparks = sparks.filter((spark) => time - spark.born < SPARK_MS);
    for (const spark of sparks) {
      const life = 1 - (time - spark.born) / SPARK_MS;
      spark.x += spark.vx;
      spark.y += spark.vy;
      ctx.globalAlpha = Math.max(0, life);
      ctx.fillStyle = spark.color ?? "#f1dcae";
      ctx.beginPath();
      ctx.arc(spark.x, spark.y, 1 + life, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (hover) {
      tip.hidden = false;
      if (hover.kind === "assistant") {
        const summary = assistantSummary(assistant.state);
        const log = Array.isArray(assistant.state?.log) ? assistant.state.log : [];
        const last = log[log.length - 1];
        // What is in flight beats what last happened.
        const work = Array.isArray(assistant.state?.work) ? assistant.state.work : [];
        const line = work.length ? `working on: ${String(work[0]?.text ?? work[0]?.kind ?? "").slice(0, 100)}` : last ? String(last.text).slice(0, 100) : "";
        tip.textContent =
          `${summary.label} · ${summary.sublabel}${line ? ` · ${line}` : ""}` +
          "\nclick: focus the assistant · double-click: open in the Explorer";
      } else if (hover.kind === "folded") {
        tip.textContent = `${plural(hover.count, "finished session")} · click to list them in the Explorer`;
      } else if (hover.kind === "agent") {
        const detail = hover.status === "error" && hover.error ? hover.error : hover.text;
        const progress = typeof hover.progress === "number" ? ` · ${Math.round(hover.progress * 100)}%` : "";
        const where = hover.targetLabel && (hover.phase === "flying" || hover.phase === "hovering") ? `\n→ ${String(hover.targetLabel).slice(0, 60)}` : "";
        tip.textContent = `${hover.role} · ${hover.status}${detail ? ` · ${String(detail).slice(0, 100)}` : ""}${progress}${where}\nclick: focus the assistant`;
      } else {
        const ageMinutes = hover.updated ? Math.round((Date.now() - hover.updated) / 60000) : null;
        const ageLabel = ageMinutes == null ? "" : ageMinutes < 1 ? " · active now" : ` · updated ${ageMinutes}m ago`;
        const notes = hover.kind === "session" ? checkpoints[hover.id] : null;
        const noteLabel = notes?.length ? `\ncheckpoint: ${String(notes[0].note).slice(0, 120)}` : "";
        const staleLabel = hover.stale ? " · stale" : "";
        const focused = assistant.state?.focus;
        const isFocused = focused && hover.kind === focused.kind && hover.id === focused.id;
        const reach = `\nclick: filter the feed · ${isFocused ? "unfocus the assistant" : "point the assistant at it"} · double-click: open in the Explorer`;
        tip.textContent =
          (hover.kind === "todo"
            ? `${hover.status}: ${hover.label}`
            : `${hover.label} · ${hover.agent ?? ""} ${hover.model ?? ""}${ageLabel}${staleLabel}${noteLabel}`) + reach;
      }
      tip.style.left = Math.min(width - 250, hover._px + 14) + "px";
      tip.style.top = Math.max(10, hover._py - 10) + "px";
    } else {
      tip.hidden = true;
    }
  }

  let lastDraw = 0;
  function loop(time) {
    // The rail is always on screen; 30fps is plenty for an ambient tree and
    // halves both its animation updates and canvas cost. Hidden windows skip
    // all animation work; time-based flights catch up when they are shown.
    if (!document.hidden && time - lastDraw >= 33) {
      if (!noMotion()) angle += 0.0016 * Math.min(3, (time - lastDraw) / 16.67);
      lastDraw = time;
      advanceMotion(time);
      draw(time);
    }
    requestAnimationFrame(loop);
  }

  function hitTest(x, y) {
    let best = null;
    let bestDistance = 16;
    for (const node of nodes) {
      if (node._px == null) continue;
      const distance = Math.hypot(node._px - x, node._py - y);
      const notes = node.kind === "session" ? checkpoints[node.id] : null;
      const threshold = Math.max(8, node._pr + (notes?.length ? 18 : 6));
      if (distance < threshold && distance < bestDistance + node._pr) {
        best = node;
        bestDistance = distance;
      }
    }
    return best;
  }

  function openExplorer(params) {
    if (window.MefiNav?.go) window.MefiNav.go("explorer", params);
    else window.MefiExplorer?.open?.(params);
  }

  // A click on a session or todo hands the node to the assistant as its focus:
  // the service records it, the rail rings it, and the responder walks to it on
  // the next message. Null clears the focus (the node was clicked again).
  function focusAssistant(node) {
    const target = node ? { kind: node.kind, id: node.id, label: node.label ?? node.id } : null;
    const sent = window.mefiStudio?.assistantFocus?.(target);
    if (sent?.then) sent.then((reply) => reply?.state && applyAssistant({ state: reply.state })).catch(() => {});
  }

  canvas.addEventListener("mousemove", (event) => {
    const rect = canvas.getBoundingClientRect();
    hover = hitTest(event.clientX - rect.left, event.clientY - rect.top);
    canvas.style.cursor = hover ? "pointer" : "default";
  });
  canvas.addEventListener("mouseleave", () => (hover = null));
  // One activation path for the mouse and the keyboard: a click and Enter or
  // Space on the focused node both land here.
  function activateNode(node) {
    if (!node) return;
    if (node.kind === "assistant" || node.kind === "agent") {
      // The Command view selects its assistant node, the open Explorer focuses
      // its composer; both listen for this.
      window.dispatchEvent(new CustomEvent("mefi:assistant-focus", { detail: { source: "rail" } }));
      return;
    }
    if (node.kind === "folded") {
      openExplorer({ folded: true });
      return;
    }
    const sessionId = node.kind === "todo" ? node.sessionId : node.kind === "session" ? node.id : null;
    activeSessionId = activeSessionId === sessionId ? null : sessionId;
    suppress = true;
    window.dispatchEvent(new CustomEvent("mefi:tree-select", { detail: { sessionId: activeSessionId } }));
    suppress = false;
    // The click also points the assistant at the node it landed on: click a
    // session or todo to focus it, click the focused node again to unfocus.
    // (Root and folded carry no work of their own, so they never take focus.)
    if (node.kind === "session" || node.kind === "todo") {
      const focused = assistant.state?.focus;
      const already = focused && focused.kind === node.kind && focused.id === node.id;
      focusAssistant(already ? null : node);
      if (!already) {
        // Explorer stages a draft for the node, the Command view re-reads its card.
        window.dispatchEvent(new CustomEvent("mefi:assistant-focus", { detail: { source: "rail", node: { kind: node.kind, id: node.id, label: node.label } } }));
      }
    }
    // The selection moved under the keyboard focus: the treeitem's
    // aria-selected must say so in the same breath.
    if (kbdFocus === node) setKbdFocus(node);
  }
  canvas.addEventListener("click", () => activateNode(hover));
  // A second click is a deep link. The two single clicks that precede it toggle
  // activeSessionId twice and cancel out, which is why the tour's click still works.
  canvas.addEventListener("dblclick", () => {
    if (!hover) return;
    if (hover.kind === "assistant" || hover.kind === "agent") {
      openExplorer({ assistant: true });
      return;
    }
    if (hover.kind === "folded") {
      openExplorer({ folded: true });
      return;
    }
    const sessionId = hover.kind === "todo" ? hover.sessionId : hover.kind === "session" ? hover.id : null;
    if (!sessionId) return;
    openExplorer({ sessionId });
  });
  // ---- keyboard + screen-reader access --------------------------------------
  // The canvas is the tree's one tab stop (role "tree"): arrows walk the
  // nodes, Enter/Space activate through the click path above, Escape drops
  // the focus. One hidden treeitem carries the roving aria-activedescendant
  // label, so a screen reader names whatever node the arrows land on.
  let kbdFocus = null;
  let kbdProxy = null;

  // What the hidden treeitem says for a node, in the tooltip's words.
  function kbdLabel(node) {
    if (node.kind === "assistant") return `Assistant · ${node.sublabel ?? ""}`;
    if (node.kind === "agent") return `agent ${node.role} · ${node.status}`;
    if (node.kind === "todo") return `task ${node.status}: ${node.label}`;
    return String(node.label ?? node.id);
  }

  function setKbdFocus(node) {
    kbdFocus = node ?? null;
    if (!kbdFocus) {
      canvas.removeAttribute("aria-activedescendant");
      return;
    }
    if (!kbdProxy) return;
    // The keyboard shares the pointer's hover, so the tooltip and the lift
    // ring land on the focused node and sighted keyboard users see it too.
    hover = kbdFocus;
    kbdProxy.setAttribute("aria-label", kbdLabel(kbdFocus));
    const selectedId = kbdFocus.kind === "session" ? kbdFocus.id : kbdFocus.kind === "todo" ? kbdFocus.sessionId : null;
    if (selectedId != null) kbdProxy.setAttribute("aria-selected", String(selectedId === activeSessionId));
    else kbdProxy.removeAttribute("aria-selected");
    canvas.setAttribute("aria-activedescendant", "tree-kbd-item");
  }

  // Sibling walk: from the focused node one step along the graph the rail
  // builds (root → sessions → their todos → the folded cluster → the
  // assistant → the agent ring), wrapping at both ends.
  function moveKbdFocus(step) {
    if (!nodes.length) return;
    const at = kbdFocus ? nodes.indexOf(kbdFocus) : -1;
    const next = at < 0 ? (step > 0 ? 0 : nodes.length - 1) : (at + step + nodes.length) % nodes.length;
    setKbdFocus(nodes[next]);
  }

  function onCanvasKeyDown(event) {
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      moveKbdFocus(1);
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      moveKbdFocus(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      setKbdFocus(nodes[0] ?? null);
    } else if (event.key === "End") {
      event.preventDefault();
      setKbdFocus(nodes[nodes.length - 1] ?? null);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activateNode(kbdFocus);
    } else if (event.key === "Escape") {
      setKbdFocus(null);
      hover = null;
    }
  }
  canvas.addEventListener("keydown", onCanvasKeyDown);
  canvas.addEventListener("blur", () => {
    setKbdFocus(null);
    hover = null;
  });
  // Selecting a session in the Command view or the Explorer lights it here too.
  window.addEventListener("mefi:tree-select", (event) => {
    if (suppress) return;
    activeSessionId = event.detail?.sessionId ?? null;
  });

  function spawnPulse(sessionId) {
    const target = nodes.find((node) => node.id === sessionId && node.kind === "session");
    if (!target) return;
    const from = nodes.find((node) => node.kind === "root") ?? target;
    pulses.push({ from, to: target, start: performance.now(), duration: 900 });
    // second hop: session -> a todo, so a long task visibly "bounces"
    const todo = target.todos?.find((item) => item.status === "in_progress") ?? target.todos?.[0];
    const todoNode = todo ? nodes.find((node) => node.sessionId === sessionId && node.label === todo.content) : null;
    if (todoNode) pulses.push({ from: target, to: todoNode, start: performance.now() + 420, duration: 700 });
  }

  // One entry point for every assistant state the renderer sees: the
  // eyes:assistant push and the { ok, state } answers of assistantMessage /
  // assistantControl / assistantPrefs. The push reaches each module's own
  // listener, so an event is applied once and later callers get the same
  // promise — the Command view waits on it before re-reading the snapshot after
  // an organize, whichever listener ran first.
  function applyAssistant(payload) {
    const state = payload?.state ?? null;
    const event = payload?.event ?? null;
    if (event) {
      const key = `${event.at}|${event.kind}|${event.text}`;
      if (key === assistant.lastKey) return assistant.pending ?? Promise.resolve();
      assistant.lastKey = key;
    }
    if (state) assistant.state = state;
    if (syncAssistantNode()) rebuild();
    paintStats();
    if (!event) return Promise.resolve();
    const root = nodes.find((node) => node.kind === "root");
    const target = nodes.find((node) => node.kind === "assistant");
    if (root && target && ASSISTANT_PULSE_KINDS.has(event.kind)) {
      // Work the service did travels root → assistant; the thread travels back.
      const inbound = event.kind === "message" || event.kind === "reply";
      pulses.push({ from: inbound ? target : root, to: inbound ? root : target, start: performance.now(), duration: 900, color: "#f1dcae", glow: "#e6c98d" });
    }
    if (target && event.kind === "focus" && event.focus?.id) {
      // "focused on X": the assistant's attention lands on the node.
      const node = nodes.find((entry) => entry.kind === event.focus.kind && entry.id === event.focus.id);
      if (node && node !== target) pulses.push({ from: target, to: node, start: performance.now(), duration: 900, color: "#f1dcae", glow: "#e6c98d" });
    }
    if (target && event.kind === "agent") {
      // "auditor started" / "briefer failed · …": the role leads the text.
      const text = String(event.text ?? "");
      // The host names the role and the status on the event itself ("auditor
      // started" is only the readable half); older events carry neither, so
      // the text and the roster row still stand in.
      const role = String(event.role ?? text.split(/\s+/)[0] ?? "");
      const satellite = agentNodeOf(role);
      const row = agentRoster().find((agent) => agent.role === role) ?? null;
      const failed = /\bfailed\b|\berror\b/.test(text);
      const tint = agentColor(role);
      if (satellite) pulses.push({ from: target, to: satellite, start: performance.now(), duration: 600, color: failed ? COLORS.amber : tint, glow: failed ? COLORS.amber : tint, wave: true });
      // The event says where the agent works; a host that names no target gets
      // one derived from the role, so the satellite always visibly goes to work.
      const named = ["running", "queued", "done", "error", "idle"].includes(event.status) ? event.status : null;
      const status = named ?? (row ? row.status : failed ? "error" : /\bdone\b|\bfinished\b/.test(text) ? "done" : "running");
      if (status === "running") {
        const targets = eventTargets(event, row);
        if (targets) setAgentTargets(role, targets);
        else if ((motions.get(role)?.phase ?? "home") === "home") setAgentTargets(role, deriveTargets(role, text));
      } else if (status !== "queued") {
        requestReturn(role, status === "done");
      }
    }
    if (event.kind === "organize") {
      // Fold and stale changes must show the moment the tick made them.
      assistant.pending = load()
        .catch(() => {})
        .finally(() => {
          assistant.pending = null;
        });
      return assistant.pending;
    }
    return Promise.resolve();
  }

  async function load() {
    if (!window.mefiStudio?.eyesState) {
      buildGraph([], [], { status: "desktop-only", text: "desktop mode only", stats: "desktop mode only" });
      return;
    }
    const result = await read("eyesState");
    loadResult(result);
  }

  function loadResult(result) {
    if (!result?.ok) {
      buildGraph([], [], {
        status: "unavailable",
        text: result?.error ? `store unavailable · ${result.error}` : "store unavailable",
        stats: "store offline",
      });
      return;
    }
    buildGraph(result.sessions, result.todos);
  }

  // The rail's pinned state is a preference: it must survive a reload, and the
  // button has to say which way it goes.
  function setPinned(on) {
    const pinned = Boolean(on);
    rail.classList.toggle("pinned", pinned);
    try {
      localStorage.setItem("mefiStudio.treePinned", pinned ? "1" : "0");
    } catch {}
    const button = document.getElementById("tree-pin");
    if (button) {
      button.setAttribute("aria-pressed", pinned ? "true" : "false");
      const label = button.querySelector(".label");
      if (label) label.textContent = pinned ? "Unpin" : "Pin";
      button.title = pinned ? "Unpin the rail (G)" : "Pin the rail open (G)";
    }
    resize();
    return pinned;
  }

  function togglePin(force) {
    return setPinned(typeof force === "boolean" ? force : !rail.classList.contains("pinned"));
  }

  async function init() {
    if (initialized || !canvas) return readyPromise;
    initialized = true;
    resize();
    seedStars();
    // The rail paints before anything is awaited: a refused IPC read must never
    // leave the canvas blank, and the Pin button must work from the first frame.
    // A blocked or private store throws on read, so that read is guarded too.
    let pinned = false;
    try {
      pinned = localStorage.getItem("mefiStudio.treePinned") === "1";
    } catch {}
    setPinned(pinned);
    document.getElementById("tree-pin")?.addEventListener("click", () => togglePin());
    window.addEventListener("resize", () => resize());
    // The rail animates its width; the canvas bitmap must follow or the tree
    // renders stretched while expanding.
    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(() => resize()).observe(rail);
    }
    // The tree's keyboard + screen-reader wiring: the template ships the same
    // role/tabindex as the no-JS baseline, these writes keep the two in step,
    // and the hidden treeitem gives the activedescendant something to name.
    canvas.setAttribute("tabindex", "0");
    canvas.setAttribute("role", "tree");
    canvas.setAttribute("aria-label", "Session tree");
    kbdProxy = document.createElement("div");
    kbdProxy.id = "tree-kbd-item";
    kbdProxy.setAttribute("role", "treeitem");
    kbdProxy.style.cssText = "position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;";
    rail.append(kbdProxy);
    canvas.setAttribute("aria-owns", "tree-kbd-item");
    requestAnimationFrame(loop);
    // Fetch organisation and sessions together, then build once with both.
    // Command waits for this promise before taking its initial snapshot.
    const checkpointRead = read("eyesCheckpointsRead").catch(() => null);
    readyPromise = Promise.all([
      read("assistantState").catch(() => null),
      read("eyesState").catch((error) => ({ ok: false, error: String(error?.message ?? error) })),
    ]).then(([result, sessions]) => {
      if (result?.ok && result.state) assistant.state = result.state;
      // The service restarted what the last close interrupted: say so once,
      // while the resume is fresh (the thread carries the same line).
      const resumed = assistant.state?.resumed ?? null;
      const jobs = Array.isArray(resumed?.jobs) ? resumed.jobs.length : 0;
      if (jobs > 0 && resumed?.at && Date.now() - resumed.at < 120000) {
        window.MefiToast?.(`Restarted ${plural(jobs, "interrupted job")}`, "info");
      }
      if (window.mefiStudio?.eyesState) loadResult(sessions);
      else buildGraph([], [], { status: "desktop-only", text: "desktop mode only", stats: "desktop mode only" });
    }).catch((error) => {
      buildGraph([], [], { status: "unavailable", text: `store unavailable · ${String(error?.message ?? error)}`, stats: "store offline" });
    });
    await readyPromise;
    window.mefiStudio?.onCheckpoints?.((data) => {
      checkpoints = data ?? {};
    });
    window.mefiStudio?.onEyesActivity?.((data) => {
      for (const item of data.activity ?? []) spawnPulse(item.sessionId);
      if (data.todos) load().catch(() => {}).then(() => requestAnimationFrame(() => draw(performance.now())));
    });
    window.mefiStudio?.onAssistant?.((payload) => applyAssistant(payload));
    try {
      const checkpointResult = await checkpointRead;
      checkpoints = checkpointResult?.checkpoints ?? {};
    } catch {
      checkpoints = {};
    }
  }

  window.MefiTree = {
    init,
    ready: () => readyPromise ?? Promise.resolve(),
    reload: load,
    debugNodes: () =>
      nodes
        .filter((node) => node._px != null)
        .map((node) => ({ id: node.id, kind: node.kind, label: node.label, x: Math.round(node._px), y: Math.round(node._py), r: node._pr })),
    // Raw 3D graph for the idle/dream view (its own camera and layout scale).
    snapshot: () => ({
      nodes: nodes.map((node) => ({
        id: node.id,
        kind: node.kind,
        label: node.label,
        agent: node.agent ?? null,
        model: node.model ?? null,
        updated: node.updated ?? null,
        progress: node.progress ?? null,
        sessionId: node.sessionId ?? node.id,
        status: node.status ?? null,
        state: node.state,
        stale: node.stale ?? false,
        count: node.count ?? null,
        sessionIds: node.sessionIds ?? null,
        titles: node.titles ?? null,
        tone: node.tone ?? null,
        sublabel: node.sublabel ?? null,
        role: node.role ?? null,
        text: node.text ?? null,
        error: node.error ?? null,
        lastRunAt: node.lastRunAt ?? null,
        since: node.since ?? null,
        runs: node.runs ?? null,
        ...(node.kind === "agent" ? { phase: node.phase ?? "home", targetId: node.targetId ?? null, targetLabel: node.targetLabel ?? null, progress: node.progress ?? null } : {}),
        r: node.r,
        x: node.x,
        y: node.y,
        z: node.z,
      })),
      edges: edges
        .map((edge) => ({
          a: nodes.indexOf(edge.a),
          b: nodes.indexOf(edge.b),
          sessionId: edge.sessionId ?? null,
        }))
        .filter((edge) => edge.a >= 0 && edge.b >= 0),
      assistant: (() => {
        const summary = assistantSummary(assistant.state);
        const roster = agentRoster();
        return {
          status: assistant.state?.status ?? null,
          tone: summary.tone,
          sublabel: summary.sublabel,
          unread: Number(assistant.state?.unread) || 0,
          agents: roster.length,
          running: roster.filter((agent) => agent.status === "running").length,
          queued: roster.filter((agent) => agent.status === "queued").length,
        };
      })(),
    }),
    // The assistant service as the renderer knows it. assistantSummary() with
    // no argument reads the current state; idle, explorer, nav and the palette
    // reuse it instead of carrying their own copy of the rules.
    assistantSummary: (state) => assistantSummary(state === undefined ? assistant.state : state),
    assistantState: () => assistant.state,
    applyAssistant,
    problemLabel,
    // The per-role satellite colour (hex), shared so the Command view, the
    // rosters and the rail can never disagree on which agent is which.
    agentColor,
    // Agent travel: live positions in tree space (the Command view overrides
    // its agent nodes from these every frame), and the Command-only task nodes
    // a reference agent may fly to.
    agentPositions,
    // Steps the flights by hand (the capture tour and tests, where frames are
    // scarce); the draw loop does this every frame on its own.
    advanceAgents: (now) => {
      advanceMotion(typeof now === "number" ? now : performance.now());
      return agentPositions();
    },
    setExternalNodes: (list) => {
      external = Array.isArray(list) ? list.filter((entry) => entry && typeof entry.id === "string").map((entry) => ({ ...entry })) : [];
    },
    togglePin,
    status: () => status,
    statusText: () => statusText,
    // Keyboard access, for the tests and the dev tools: focus a node by id,
    // read the focused node and the rail's selected session.
    focusNode: (id) => setKbdFocus(findNodeById(id) ?? null),
    focused: () => kbdFocus?.id ?? null,
    activeSession: () => activeSessionId,
  };
})();
