// Mefi's Studio AI+ — Command view: the constellation that is also the menu.
//
// Sessions, todos and your own tasks are one 3D node graph on a full-screen
// canvas: the camera orbits and lerps toward the most recent activity, work
// paths glow, external reads vaporize into blue-white particles, evidence PNGs
// float in, and Zen mode plays dynamic bells keyed to how fast agents move.
// After five quiet minutes it opens itself in ambient mode; D (or the dock, the
// rail button, the palette) opens it as the menu. Keys, layers and every
// destination belong to nav.js — this file owns the canvas and its HUD.
(function () {
  "use strict";

  const IDLE_MS = 5 * 60 * 1000;
  const TASK_TOOLS = new Set(["edit", "write", "patch", "todowrite", "task"]);
  const PROFILES = {
    zen: { label: "Zen Bells", notes: [196, 261.63, 392], decay: 4.0, wave: "sine", gain: 0.15 },
    temple: { label: "Deep Temple", notes: [110, 164.81, 220], decay: 6.5, wave: "sine", gain: 0.17 },
    crystal: { label: "Crystal Bells", notes: [440, 554.37, 659.25, 880], decay: 2.4, wave: "triangle", gain: 0.11 },
    club: { label: "After Hours", notes: [146.83, 220, 293.66, 440], decay: 1.6, wave: "sawtooth", gain: 0.07 },
  };
  const PROFILE_ORDER = ["zen", "temple", "crystal", "club"];

  // One source of truth for every node colour: colorOf() and the DOM legend
  // both read this, so the legend can never drift from the canvas.
  const NODE_RGB = {
    session: [236, 229, 216], // ivory hub
    warm: [230, 201, 141], // gold: touched / in progress / active
    done: [104, 236, 164], // green: completed
    pending: [138, 128, 108], // dim: pending todo
    stale: [96, 88, 74], // stale session pushed to the outer ring
    pulse: [169, 255, 205],
    dust: [157, 183, 255],
    live: [87, 255, 154],
    collision: [255, 212, 121],
    task: [230, 201, 141], // fallback when a task has no colour
    assistant: [230, 201, 141], // champagne gold: the assistant service's own node
    amber: [255, 212, 121], // its ring when something needs attention
  };
  const rgb = (triple) => `rgb(${triple.join(",")})`;
  const rgba = (triple, alpha) => `rgba(${triple.join(",")},${alpha})`;

  // A striped swatch standing in for "every agent role its own colour" — the
  // stops come from the tree's palette, so the legend tracks the satellites.
  function agentSwatch() {
    const stops = ["watcher", "responder", "improver", "auditor"].map((role) => window.MefiTree?.agentColor?.(role) ?? "#e6c98d");
    return `linear-gradient(135deg, ${stops.join(", ")})`;
  }

  // Legend rows, in display order. `key` is written to data-sw, `sw` to the
  // --sw custom property, `label` is the row text.
  const LEGEND = [
    { key: "session", sw: rgb(NODE_RGB.session), label: "session hub" },
    { key: "active", sw: rgb(NODE_RGB.warm), label: "in progress · recently touched" },
    { key: "done", sw: rgb(NODE_RGB.done), label: "completed todo" },
    { key: "pending", sw: rgb(NODE_RGB.pending), label: "pending todo" },
    { key: "stale", sw: rgb(NODE_RGB.stale), label: "stale session — pushed to the outer ring" },
    { key: "task", sw: rgb(NODE_RGB.task), label: "your task — ring in its own colour" },
    { key: "checkpoint", sw: rgb(NODE_RGB.warm), label: "checkpoint note" },
    { key: "live", sw: rgba(NODE_RGB.live, 0.75), label: "live activity · last 90 s" },
    { key: "collision", sw: rgba(NODE_RGB.collision, 0.8), label: "collision · several agents on one path" },
    { key: "pulse", sw: rgb(NODE_RGB.pulse), label: "edit landing" },
    { key: "dust", sw: rgb(NODE_RGB.dust), label: "external read / web" },
    { key: "focus", sw: rgb(NODE_RGB.warm), label: "search match — dashed ring" },
    { key: "assistant", sw: rgb(NODE_RGB.assistant), label: "the assistant — its ring breathes while the service runs" },
    { key: "folded", sw: rgb(NODE_RGB.done), label: "finished sessions, folded into one node" },
    { key: "absorbed", sw: rgba(NODE_RGB.done, 0.8), label: "finished work — sinks into its host, readable on its card" },
    { key: "done-hold", sw: rgba(NODE_RGB.done, 0.95), label: "just finished — pulses until you read it, then sinks in" },
    { key: "work-pin", sw: "#7db2ff", label: "work on it — blue loop: next in the queue, looping while it builds" },
    { key: "meter", sw: "linear-gradient(90deg, #68eca4 62%, rgba(236,229,216,0.25) 62%)", label: "work-left meter — slim bar under a node: share of its todos done" },
    {
      key: "agent",
      sw: agentSwatch(),
      label: "an agent of the assistant — role colour while working, green done · amber error · dim queued; it flies back to the assistant when the job ends",
    },
  ];
  const AGENT_STATES = new Set(["running", "queued", "error", "done"]);

  const LABEL_FONT = '600 12px system-ui, "Segoe UI", sans-serif'; // sessions
  const LABEL_FONT_TASK = '600 11px system-ui, "Segoe UI", sans-serif'; // task nodes
  const LABEL_FONT_TODO = '11px system-ui, "Segoe UI", sans-serif'; // todos
  const LABEL_FONT_ROOT = '600 10.5px system-ui, "Segoe UI", sans-serif'; // root
  const LABEL_FONT_AGENT = '9.5px system-ui, "Segoe UI", sans-serif'; // the assistant's agents
  const BUILDER_ORBIT = 15; // how far a running builder circles the node it is building
  const BUILDER_FIELD = 78; // and how far out it sits when that work is not on the board
  const LABEL_MAX_PX = 180; // measureText clamp
  const LABEL_CANDIDATES = 60; // most nodes considered per frame
  const LABEL_BUDGET = 40; // most labels drawn per frame
  const LABEL_PAD = 5; // rect padding used for collision tests
  const LABEL_HEIGHT = 13; // tallest label line box
  const LABEL_SLOTS = ["right", "left", "below", "above"];
  const LABEL_CACHE_MAX = 400;

  // Node life-cycle: fresh work pops out of its host, finished work flies home
  // and sinks in. An absorb older than the TTL is recorded on the host without
  // replaying the flight — the user was not watching when it happened.
  const NODE_GROW_MS = 650;
  const NODE_ABSORB_MS = 800;
  const NODE_ABSORB_TTL = 6000;
  const ABSORBED_MAX = 8; // briefs a host keeps readable on its card
  // A task that finishes while the view watches holds the board before it
  // sinks: it pulses green and wears a wiggling "!" you can click to read the
  // work first. Anything already finished before the view saw it — archived
  // rows, deleted rows, the folded cluster of old finished sessions — skips
  // the ceremony and absorbs straight away.
  const DONE_HOLD_MS = 15000; // unread grace before the flight home plays on its own
  const DONE_ACK_MS = 4000; // a clicked task only waits out a calm beat
  const DONE_FRESH_MS = 90000; // done stamps older than this never earn the ceremony

  const ORBIT_BASE = 0.00055; // radians/frame at rest
  const ORBIT_ENERGY = 0.0022; // audio-energy term
  const ORBIT_EASE = 0.06; // velocity lerp per frame → ~1.2 s to settle
  const SETTLE_MS = 2500; // a wheel zoom holds the orbit still for a beat
  // Starfield: three depth bands wheeling at a fraction of the orbit rate, so
  // the far sky drifts slowly against the constellation. Positions are hashed
  // from seed+index — stable across frames and resizes, no stored array.
  const STAR_LAYERS = [
    { count: 110, seed: 11.3, spin: 0.012, tempo: 3400, size: 0.8, alpha: 0.45 },
    { count: 64, seed: 47.7, spin: 0.03, tempo: 2500, size: 1.3, alpha: 0.7 },
    { count: 18, seed: 91.1, spin: 0.055, tempo: 1900, size: 1.9, alpha: 0.95, flare: true },
  ];
  const ROTATE_SPEED = 0.005; // right-drag: radians per pixel
  const PITCH_MAX = 0.55; // right-drag vertical tilt clamp
  const CAMERA_EASE = 0.045;
  const POPUP_MS = 45000; // evidence popup interval
  const HUD_DIM_MS = 6000;
  const DEFAULT_HINT = "click a node to zoom in · drag to pan · right-drag to orbit · wheel to zoom · V 2D/3D · Esc leaves";
  const LABEL_MODES = ["auto", "all", "none"];

  // Camera autopilot modes: "orbit" keeps the whole tree framed at the largest
  // zoom that still shows every node, "follow" tracks the node the agent's
  // work sits on, "free" is whatever the user does with pan/zoom/clicks.
  const CAM_MODES = ["orbit", "follow", "free"];

  const storedLabels = readStore("mefiStudio.cmdLabels");

  const state = {
    active: false,
    zen: readStore("mefiStudio.zen") !== "0",
    profile: PROFILES[readStore("mefiStudio.zenProfile")] ? readStore("mefiStudio.zenProfile") : "zen",
    reactive: readStore("mefiStudio.zenReactive") === "1",
    audioSource: readStore("mefiStudio.zenSource") === "mic" ? "mic" : "desktop",
    bands: { bass: 0, mid: 0, treble: 0 },
    nodes: [],
    edges: [],
    angle: 0.5,
    camera: { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0 },
    pulses: [],
    particles: [],
    touches: new Map(),
    popups: [],
    pngs: [],
    popupAt: 0,
    lastTouch: 0,
    energy: 0.4,
    fit: 1.6,
    audio: null,
    bus: null,
    analyser: null,
    inputStream: null,
    inputPending: null, // source kind of the in-flight capture request
    timers: { idle: null, refresh: null },
    lastFrame: 0,
    lastInput: Date.now(),
    checkpoints: {},
    hudTimer: null,
    tasks: [],
    telemetryAt: 0,
    telemetry: "",
    selected: null,
    hoverNode: null,
    hoverBubble: null,
    panning: null,
    rotating: null,
    zoom: 1,
    pitch: 0,
    machineStatus: null,
    telemetryNodeCount: -1,
    ideasAt: 0,
    ideasUnread: 0,
    frameError: false,
    // Command-hub state
    ambient: true,
    orbit: "auto",
    orbitVel: 0,
    settleUntil: 0,
    labels: LABEL_MODES.includes(storedLabels) ? storedLabels : "auto",
    legendOpen: readStore("mefiStudio.cmdLegend") === "1",
    feedMenuOpen: readStore("mefiStudio.cmdFeedMenu") === "1",
    query: "",
    matches: [],
    matchSet: new Set(),
    matchIndex: -1,
    searchTimer: null,
    branch: null,
    labelRects: [],
    labelWidths: new Map(),
    hudRects: [],
    hudRectsAt: 0,
    tipNode: null,
    emptyVariant: null,
    treeStatus: "ok",
    progressCycle: 0,
    // The assistant service as the tree reports it: { status, tone, sublabel, unread }.
    assistant: null,
    assistantSending: false,
    // The card last told main its replies were seen.
    seenAt: 0,
    // Which node the card last rendered, so its scroll survives rebuilds.
    cardScrollId: null,
    // Per role: the last pulse / spark / done counters taken from the tree's
    // agent simulation, so each is rendered here exactly once.
    agentSeq: {},
    feed: [],
    feedDirty: true,
    feedSeen: new Set(), // autopilot-history keys already mirrored into the feed
    builderSignature: null, // which executor jobs the builder nodes were built from
    // Per-node life-cycle, keyed by node id (task:<id>, builder:<key>): bornAt
    // runs the pop-out, absorbAt the flight home. `absorbed` is what the host
    // keeps afterwards — the finished work's brief stays readable on its card.
    fx: new Map(),
    absorbed: new Map(),
    // task:<id> → { task, since, ackedAt }: finished work holding the board
    // for its grace window — green pulse, wiggling "!", one click to read it.
    doneHold: new Map(),
    foldedAbsorbedAt: 0, // the finished-sessions cluster already flew home once
    tasksSeeded: false, // first task read seeds as settled — no mass pop
    graphSeeded: false,
    lastTrickle: 0,
    requests: [],
    briefing: null,
    view: readStore("mefiStudio.cmdView") === "2d" ? "2d" : "3d",
    camMode: CAM_MODES.includes(readStore("mefiStudio.cmdCam")) ? readStore("mefiStudio.cmdCam") : "orbit",
    // Resolves when an enter()'s first tasks+graph build has settled; the
    // boot sequence waits on it before its fade reveals the constellation.
    readyPromise: null,
    workOnBusy: false,
  };

  const el = {};

  function readStore(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function writeStore(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {}
  }

  // Motion is a shared decision: nav owns the switch, we fall back locally so a
  // nav-less bundle still respects the OS preference.
  function noMotion() {
    return (
      window.MefiNav?.noMotion?.() ??
      (document.body.classList.contains("no-motion") || window.matchMedia("(prefers-reduced-motion: reduce)").matches)
    );
  }

  // ---------- audio ----------
  function ensureAudio() {
    if (state.audio) {
      if (state.audio.state === "suspended") state.audio.resume().catch(() => {});
      return state.audio;
    }
    try {
      state.audio = new (window.AudioContext || window.webkitAudioContext)();
      state.bus = state.audio.createGain();
      state.bus.gain.value = 0.9;
      state.analyser = state.audio.createAnalyser();
      state.analyser.fftSize = 512;
      state.bus.connect(state.analyser);
      state.analyser.connect(state.audio.destination);
    } catch {
      state.audio = null;
    }
    if (state.audio && state.reactive) useReactiveInput();
    return state.audio;
  }

  // Reactive glow listens to desktop audio (system loopback, via
  // getDisplayMedia + the main-process handler) unless the ambience popover
  // switches it to the microphone. The input stream feeds a dedicated analyser
  // that never reaches the speakers — the glow reads it, nothing monitors it.
  function useReactiveInput() {
    // inputStream only lands when the request resolves; inputPending holds the
    // source kind in flight so a same-source caller cannot double-request while
    // a source switch can still supersede a stale pending request.
    const mic = state.audioSource === "mic";
    const kind = mic ? "mic" : "desktop";
    if (!state.audio || state.inputStream || state.inputPending === kind) return;
    const request = mic
      ? navigator.mediaDevices?.getUserMedia?.({ audio: true })
      : navigator.mediaDevices?.getDisplayMedia?.({ video: true, audio: true });
    if (!request) return;
    state.inputPending = kind;
    Promise.resolve(request)
      .then((stream) => {
        if (state.inputPending === kind) state.inputPending = null;
        // The request can resolve after the switch went off, after the view
        // was left, or after the source select moved on: hand the device
        // straight back instead of glowing to a source nobody asked for.
        if (!state.reactive || !state.active || state.audioSource !== kind) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        // Desktop loopback arrives as screen video + system audio. Nothing
        // renders the video, so its track goes straight back to the OS and the
        // stream keeps only the audio.
        if (!mic) stream.getVideoTracks().forEach((track) => track.stop());
        if (!stream.getAudioTracks().length) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        state.inputStream = stream;
        const source = state.audio.createMediaStreamSource(stream);
        const inputAnalyser = state.audio.createAnalyser();
        inputAnalyser.fftSize = 512;
        source.connect(inputAnalyser);
        state.analyser = inputAnalyser;
      })
      .catch(() => {
        if (state.inputPending === kind) state.inputPending = null;
      });
  }

  function ensureReactiveInput() {
    if (!state.reactive) return;
    ensureAudio();
    useReactiveInput();
  }

  // Stopping the tracks is what clears the OS capture/recording indicator;
  // dropping the handle lets useReactiveInput() acquire again later, and the
  // glow goes back to the bell bus instead of reading a dead analyser.
  function releaseReactiveInput() {
    if (!state.inputStream) return;
    state.inputStream.getTracks().forEach((track) => track.stop());
    state.inputStream = null;
    if (!state.audio || !state.bus) return;
    state.bus.disconnect();
    state.analyser = state.audio.createAnalyser();
    state.analyser.fftSize = 512;
    state.bus.connect(state.analyser);
    state.analyser.connect(state.audio.destination);
  }

  function setAudioSource(source) {
    const next = source === "mic" ? "mic" : "desktop";
    if (next === state.audioSource) return;
    state.audioSource = next;
    writeStore("mefiStudio.zenSource", next);
    if (state.reactive && state.active) {
      releaseReactiveInput();
      ensureReactiveInput();
    }
  }

  function bell({ low = false, long = false, quick = false, level = 1 }) {
    if (!state.zen) return;
    const audio = ensureAudio();
    if (!audio) return;
    const profile = PROFILES[state.profile];
    const now = audio.currentTime;
    const pool = low ? profile.notes.slice(0, 2) : profile.notes;
    const frequency = pool[Math.floor(Math.random() * pool.length)] * (low ? 0.5 : 1);
    const duration = quick ? 0.7 : long ? profile.decay : profile.decay * 0.45;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = profile.wave;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(profile.gain * level, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(state.bus);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.1);
    if (low) {
      const second = audio.createOscillator();
      const secondGain = audio.createGain();
      second.type = "sine";
      second.frequency.value = frequency * 1.5;
      secondGain.gain.setValueAtTime(0.0001, now);
      secondGain.gain.exponentialRampToValueAtTime(profile.gain * 0.5 * level, now + 0.06);
      secondGain.gain.exponentialRampToValueAtTime(0.0001, now + duration * 0.8);
      second.connect(secondGain);
      secondGain.connect(state.bus);
      second.start(now);
      second.stop(now + duration);
    }
  }

  // The analyser spectrum is split into bass / mid / treble so the glow can
  // answer each part of the mix differently: bass swells pulses and nodes,
  // mids light the work paths, treble makes the starfield shimmer. Bands are
  // bin slices, not physical Hz — at fftSize 512 each bin is ~94 Hz, so the
  // first few bins are kick/bass weight and the tail is sparkle.
  function audioEnergy() {
    if (!state.analyser) {
      state.energy = 0.4;
      state.bands.bass = state.bands.mid = state.bands.treble = 0;
      return state.energy;
    }
    const buffer = new Uint8Array(state.analyser.frequencyBinCount);
    state.analyser.getByteFrequencyData(buffer);
    const bins = buffer.length;
    const band = (from, to) => {
      let sum = 0;
      for (let index = from; index < to; index += 1) sum += buffer[index];
      return sum / Math.max(1, to - from) / 255;
    };
    const bassEnd = Math.max(2, Math.ceil(bins * 0.02));
    const midEnd = Math.max(bassEnd + 1, Math.ceil(bins * 0.25));
    const bass = band(1, bassEnd);
    const mid = band(bassEnd, midEnd);
    const treble = band(midEnd, bins);
    // Music spectrum falls off with frequency, so each band gets its own gain
    // to land in the same usable range.
    state.bands.bass = Math.min(1, bass * 1.6);
    state.bands.mid = Math.min(1, mid * 2.2);
    state.bands.treble = Math.min(1, treble * 3);
    const level = bass * 0.5 + mid * 0.35 + treble * 0.15;
    state.energy = Math.max(0.15, Math.min(1, level * 2.4));
    return state.energy;
  }

  // ---------- layout / projection ----------
  function refreshGraph() {
    const snapshot = window.MefiTree?.snapshot?.();
    if (!snapshot) return;
    // Last live positions for the FX pass: a node leaving the board this
    // rebuild still flies home from where it was seen, while a dying node
    // keeps the start of its flight instead of restarting it mid-air.
    for (const node of state.nodes) {
      const fx = state.fx.get(node.id);
      if (fx && !node.dying) {
        fx.lastX = node.x;
        fx.lastY = node.y;
        fx.lastZ = node.z;
      }
    }
    for (const fx of state.fx.values()) fx.seen = false;
    // The finished-sessions cluster is done work like any other: fold it into
    // the root before the graph maps — filtering the snapshot keeps every
    // edge index true.
    const snapshotNodes = absorbFoldedCluster(snapshot.nodes);
    state.nodes = snapshotNodes.map((node) => ({ ...node, bx: node.x, by: node.y, bz: node.z }));
    state.edges = snapshot.edges.map((edge) => ({ ...edge }));
    // The tree summary and the autopilot status share this one slot, and both
    // carry a `running` — a roster COUNT in the summary, the list of build jobs
    // in the status. A plain replace let the count win on every rebuild, so
    // autopilotJobs() saw [1] (a phantom job) and never the real ones. Merge
    // the summary in under its own names and leave the job list alone.
    const summary = snapshot.assistant ?? null;
    if (summary) {
      state.assistant = {
        ...(state.assistant ?? {}),
        status: summary.status,
        tone: summary.tone,
        sublabel: summary.sublabel,
        unread: summary.unread,
        rosterAgents: summary.agents,
        rosterRunning: summary.running,
        rosterQueued: summary.queued,
      };
    }
    appendTaskNodes();
    appendDoneHoldNodes();
    appendBuilderNodes();
    sweepFx();
    state.graphSeeded = true;
    // The hub wears the whole board on its own meter: how much of the
    // sessions' work is done, at a glance.
    const todoNodes = state.nodes.filter((node) => node.kind === "todo");
    const hubNode = state.nodes.find((node) => node.kind === "assistant");
    if (hubNode) hubNode.progress = todoNodes.length ? todoNodes.filter((node) => node.state === "done").length / todoNodes.length : null;
    // Task nodes exist only here; the tree's agent simulation needs their
    // positions so a reference agent can fly to the task it gathers for.
    window.MefiTree?.setExternalNodes?.(
      state.nodes
        .filter((node) => node.kind === "task" && !node.dying)
        .map((node) => ({ id: node.id, kind: "task", label: node.label, x: node.x, y: node.y, z: node.z, anchorSessionId: node.anchorSessionId ?? null }))
    );
    autoFit();
    // Every node object is new: re-point the selection and the hover at the
    // live ones, and drop them when their node left the graph — a selection
    // pointing at a vanished node dims the whole constellation and stops orbit.
    if (state.selected) {
      const fresh = state.nodes.find((entry) => entry.id === state.selected.id);
      if (fresh) state.selected.node = fresh;
      else selectNode(null);
    }
    state.hoverNode = state.hoverNode ? state.nodes.find((entry) => entry.id === state.hoverNode.id) ?? null : null;
    state.hoverBubble = state.hoverBubble ? state.nodes.find((entry) => entry.id === state.hoverBubble.id) ?? null : null;
    state.treeStatus = window.MefiTree?.status?.() ?? (window.mefiStudio ? "ok" : "desktop-only");
    renderEmpty();
    updateAssistantPill();
    if (state.query) applyQuery();
    computeBranch();
    // Camera autopilot after a rebuild: orbit re-pins zoom so new nodes shrink
    // the fit instead of spilling out of frame, follow re-resolves the work
    // node. Neither ever pans to the most recently updated session — the graph
    // changing shape is not a reason to move the camera.
    if (state.camMode === "orbit") setZoom(1);
    else if (state.camMode === "follow" && state.active) applyCamMode();
  }

  // Open/active tasks join the constellation: anchored to a matching session
  // when the title overlaps it, otherwise spread on an outer ring. With a long
  // backlog the graph drowns in task nodes, so only the 12 most recently
  // updated render — the rest still count in the meta line and the dock pill.
  function appendTaskNodes() {
    const keys = (text) => new Set((String(text).toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g) ?? []).slice(0, 8));
    const tasks = [...(state.tasks ?? [])]
      .sort((a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0))
      .slice(0, 12);
    tasks.forEach((task, index) => {
      const taskKeys = keys(`${task.title} ${task.prompt ?? ""}`);
      let anchor = null;
      let best = 0;
      for (const node of state.nodes) {
        if (node.kind !== "session") continue;
        const label = String(node.label ?? "").toLowerCase();
        let score = 0;
        for (const key of taskKeys) if (label.includes(key)) score += 1;
        if (score > best) {
          best = score;
          anchor = node;
        }
      }
      const ring = (index / Math.max(1, tasks.length)) * Math.PI * 2;
      // Unanchored work rides its own outer shell, past the todo rings (which
      // reach ~166 from the root), so the constellation reads in bands:
      // sessions and their todos, then the workbench of loose tasks.
      const bx = anchor ? anchor.x + Math.cos(ring) * 40 : Math.cos(ring) * 205;
      const by = anchor ? anchor.y + 46 : 74 + Math.sin(index * 2.1) * 18;
      const bz = anchor ? anchor.z + Math.sin(ring) * 40 : Math.sin(ring) * 205;
      const node = {
        id: `task:${task.id}`,
        kind: "task",
        label: task.title,
        task,
        // The anchor lives on the node as well as on the edge: the card, the
        // arrow keys and the branch highlight all need it, and `sessionId`
        // must stay "this node belongs to that session".
        anchorSessionId: anchor ? anchor.id : null,
        color: task.color ?? "#e6c98d",
        state: task.status === "active" ? "active" : "task",
        r: 7,
        x: bx,
        y: by,
        z: bz,
        bx,
        by,
        bz,
      };
      state.nodes.push(node);
      // The life-cycle entry: pop-out and absorb both run against this host —
      // the session it echoes, or the assistant that handed the work out.
      const fx = ensureFx(node.id);
      fx.task = task;
      fx.builder = false;
      fx.anchorId = anchor?.id ?? absorbFallback()?.id ?? null;
      fx.seen = true;
      fx.wasRendered = true;
      const anchorIndex = anchor ? state.nodes.indexOf(anchor) : -1;
      if (anchorIndex >= 0) state.edges.push({ a: anchorIndex, b: state.nodes.length - 1, sessionId: anchor.id, task: true });
    });
  }

  // Loose words from a title, for matching a request against a node on the
  // board. Requests usually name the thing they are about ("Work on <session>").
  const titleKeys = (text) => new Set((String(text ?? "").toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g) ?? []).slice(0, 10));

  // Where a running job belongs on the board: its task, its session, or the node
  // whose title it echoes. A job with no home is not forced onto the assistant —
  // three of those stacked on one hub was the whole visual problem — it goes out
  // into its own ring instead (see appendBuilderNodes).
  function hostForJob(job) {
    if (job.taskId) {
      const task = state.nodes.find((node) => node.kind === "task" && node.task?.id === job.taskId);
      if (task) return task;
    }
    if (job.sessionId) {
      const session = state.nodes.find((node) => node.kind === "session" && node.id === job.sessionId);
      if (session) return session;
    }
    const keys = titleKeys(job.title);
    if (!keys.size) return null;
    let best = null;
    let score = 0;
    for (const node of state.nodes) {
      if (node.kind !== "task" && node.kind !== "session") continue;
      const label = String(node.label ?? "").toLowerCase();
      let hits = 0;
      for (const key of keys) if (label.includes(key)) hits += 1;
      if (hits > score) {
        score = hits;
        best = node;
      }
    }
    // Two shared words is coincidence; three is the same piece of work.
    return score >= 3 ? best : null;
  }

  // One node per running `opencode run`, for as long as the run lasts. The
  // roster satellites are quick passes — they spawn, hop a few nodes and go home
  // in seconds — so without these the only agents on screen were the ones NOT
  // doing the building, and the tree looked idle while three agents edited the
  // repo for ten minutes. A builder sits on the work it is doing where that work
  // is on the board, and out in its own ring where it is not.
  function appendBuilderNodes() {
    const jobs = autopilotJobs(state.assistant);
    if (!jobs.length) return;
    const hub = state.nodes.find((node) => node.kind === "assistant") ?? null;
    const homeless = jobs.filter((job) => !hostForJob(job));
    let loose = 0;
    jobs.forEach((job) => {
      const host = hostForJob(job);
      const anchor = host ?? hub;
      if (!anchor) return;
      let ring;
      let radius;
      let lift;
      if (host) {
        // Several builders can share one host (three slots, one plan), so each
        // takes its own angle rather than stacking on the same point.
        const siblings = jobs.filter((other) => hostForJob(other) === host);
        ring = (siblings.indexOf(job) / Math.max(1, siblings.length)) * Math.PI * 2;
        radius = BUILDER_ORBIT;
        lift = 8;
      } else {
        // No home on the board: take a slot in a wide ring around the assistant,
        // evenly spaced and staggered in height so three read as three agents
        // out working rather than one smudge on the hub.
        ring = (loose / Math.max(1, homeless.length)) * Math.PI * 2 + Math.PI / 6;
        radius = BUILDER_FIELD;
        lift = 14 + (loose % 2) * 16;
        loose += 1;
      }
      const node = {
        id: `builder:${job.taskId ?? job.sessionId ?? job.title ?? loose}`,
        kind: "agent",
        role: "builder",
        label: job.title ?? "building",
        status: "running",
        state: "running",
        text: job.title ?? "building",
        builder: true,
        job,
        // The run's own todo fraction, polled main-side: the work-left meter
        // under a building agent. null until the run writes todos.
        progress: typeof job.progress === "number" ? job.progress : null,
        startedAt: job.startedAt ?? 0,
        hostId: anchor.id,
        onHost: Boolean(host), // false = adrift in the assistant's ring
        orbit: ring,
        radius,
        lift,
        // The tether the draw loop already paints for an agent: to the work when
        // there is work to point at, to the assistant that sent it out otherwise.
        targetNode: anchor,
        r: 3.6,
        x: anchor.x + Math.cos(ring) * radius,
        y: anchor.y - lift,
        z: anchor.z + Math.sin(ring) * radius,
      };
      state.nodes.push(node);
      // Same life-cycle as a task: the builder pops out of its host when the
      // job starts and flies home into it when the run ends.
      const fx = ensureFx(node.id, { pop: true });
      fx.builder = true;
      fx.label = job.title ?? "building";
      fx.anchorId = anchor.id;
      fx.seen = true;
      fx.wasRendered = true;
      const anchorIndex = state.nodes.indexOf(anchor);
      if (anchorIndex >= 0) state.edges.push({ a: anchorIndex, b: state.nodes.length - 1, agent: true, builder: true });
    });
  }

  // ---------- node life-cycle (pop out / absorb) ----------
  function ensureFx(id, { pop = false } = {}) {
    let fx = state.fx.get(id);
    if (!fx) {
      // No entry means the node predates tracking: seeded, not news.
      fx = { bornAt: pop && state.graphSeeded ? Date.now() : -Infinity, absorbAt: null };
      state.fx.set(id, fx);
    }
    return fx;
  }

  // Where the flight home starts: the spot the node actually sits at, not the
  // layout slot it was dealt.
  function markAbsorb(id) {
    const fx = state.fx.get(id);
    if (!fx || fx.absorbAt != null) return;
    const node = state.nodes.find((entry) => entry.id === id);
    if (node && !node.dying) {
      fx.lastX = node.x;
      fx.lastY = node.y;
      fx.lastZ = node.z;
    }
    fx.absorbAt = Date.now();
  }

  // What finished work folds back into: its session when anchored — a task
  // host resolves to the session behind it — otherwise the assistant that
  // handed the work out, otherwise the root.
  function absorbHost(fx) {
    let host = fx.anchorId ? state.nodes.find((node) => node.id === fx.anchorId && !node.dying) : null;
    if (host?.kind === "task") host = (host.anchorSessionId ? nodeForSession(host.anchorSessionId) : null) ?? host;
    return host ?? absorbFallback();
  }

  function absorbFallback() {
    return assistantNode() ?? rootNode();
  }

  // The ghost of a finished node: it keeps its look while stepFx flies it home.
  function appendDyingNode(id, fx) {
    const host = absorbHost(fx);
    const sx = fx.lastX ?? host?.x ?? 0;
    const sy = fx.lastY ?? host?.y ?? 0;
    const sz = fx.lastZ ?? host?.z ?? 0;
    const node = {
      id,
      kind: fx.folded ? "folded" : fx.builder ? "agent" : "task",
      dying: true,
      label: fx.folded ? fx.label ?? "finished" : fx.builder ? fx.label ?? "building" : fx.task?.title ?? "task",
      task: fx.folded || fx.builder ? null : fx.task ?? null,
      role: fx.builder ? "builder" : null,
      status: "running",
      // A finished task flies home green — what sinks in is completed work.
      color: !fx.folded && !fx.builder && fx.task?.status === "done" ? "#68eca4" : fx.task?.color ?? "#e6c98d",
      state: !fx.folded && !fx.builder && fx.task?.status === "done" ? "done" : "task",
      anchorSessionId: fx.anchorId,
      r: fx.folded ? 6 : fx.builder ? 3.6 : 7,
      x: sx,
      y: sy,
      z: sz,
      bx: sx,
      by: sy,
      bz: sz,
    };
    state.nodes.push(node);
    const index = host ? state.nodes.indexOf(host) : -1;
    if (index >= 0) state.edges.push({ a: index, b: state.nodes.length - 1, task: !fx.builder, agent: Boolean(fx.builder) });
  }

  // The folded cluster of old finished sessions is done work that finished a
  // long time ago: no pulse, no "!" — that grace is only for work that was new
  // or open when it finished. The first graph folds it into the root once (one
  // clean flight home when the view was already up), its titles stay readable
  // on the root's card — the done list of the constellation — and the
  // Explorer's Finished group still lists every session. Returns the snapshot
  // nodes without the cluster.
  function absorbFoldedCluster(nodes) {
    const folded = nodes.find((node) => node.kind === "folded");
    if (!folded) return nodes;
    if (!state.foldedAbsorbedAt) {
      state.foldedAbsorbedAt = Date.now();
      const titles = (folded.titles ?? []).slice(0, ABSORBED_MAX);
      const count = folded.count ?? titles.length ?? 0;
      // The root of the graph still on screen — its id is stable across builds.
      const root = rootNode();
      const key = root?.id ?? "__root__";
      const at = Date.now();
      state.absorbed.set(
        key,
        [...titles.map((title) => ({ title: String(title), kind: "session", at })), ...(state.absorbed.get(key) ?? [])].slice(0, ABSORBED_MAX)
      );
      if (state.graphSeeded && !noMotion()) {
        const fx = ensureFx(folded.id);
        fx.folded = true;
        fx.label = `${count} finished`;
        fx.anchorId = root?.id ?? null;
        fx.removed = true; // the titles are already recorded above
        fx.wasRendered = true;
        fx.lastX = folded.x;
        fx.lastY = folded.y;
        fx.lastZ = folded.z;
        markAbsorb(folded.id);
      }
    }
    return nodes.filter((node) => node.kind !== "folded");
  }

  // A held done task keeps its node on the board for the grace window — at the
  // spot it finished on — so the green pulse and the "!" have something to
  // sit on while it waits to be read.
  function appendDoneHoldNodes() {
    for (const [id, hold] of state.doneHold) {
      if (state.nodes.some((node) => node.id === id)) continue;
      const fx = state.fx.get(id);
      if (!fx || fx.absorbAt != null) continue;
      const task = hold.task ?? fx.task;
      const host = fx.anchorId ? state.nodes.find((node) => node.id === fx.anchorId && !node.dying) : null;
      const sx = fx.lastX ?? host?.x ?? 190;
      const sy = fx.lastY ?? host?.y ?? 46;
      const sz = fx.lastZ ?? host?.z ?? 0;
      const node = {
        id,
        kind: "task",
        label: task?.title ?? "task",
        task,
        anchorSessionId: fx.anchorId ?? null,
        color: task?.color ?? "#e6c98d",
        state: "done",
        doneHold: true,
        r: 7,
        x: sx,
        y: sy,
        z: sz,
        bx: sx,
        by: sy,
        bz: sz,
      };
      state.nodes.push(node);
      const hostIndex = host ? state.nodes.indexOf(host) : -1;
      if (hostIndex >= 0) state.edges.push({ a: hostIndex, b: state.nodes.length - 1, sessionId: fx.anchorId, task: true });
    }
  }

  // After a rebuild: entries mid-flight get their dying node back; a node that
  // left the board without an absorb mark is a builder whose job ended — it
  // flies home too; an open task that lost its slice just waits for a slot.
  function sweepFx() {
    const now = Date.now();
    const still = noMotion();
    for (const [id, fx] of [...state.fx]) {
      if (fx.absorbAt != null) {
        if (still || !fx.wasRendered || now - fx.absorbAt > NODE_ABSORB_TTL) finalizeAbsorb(id, fx);
        else appendDyingNode(id, fx);
        continue;
      }
      if (fx.seen) continue;
      if (fx.builder) {
        markAbsorb(id);
        if (still || !fx.wasRendered) finalizeAbsorb(id, fx);
        else appendDyingNode(id, fx);
      } else {
        state.fx.delete(id); // pushed off the 12-node slice, not finished
      }
    }
    if (state.fx.size > 240) for (const key of [...state.fx.keys()].slice(0, state.fx.size - 160)) state.fx.delete(key);
  }

  // The flight ended (or never had to be seen): the work folds into its host's
  // absorbed list so the card can still read it, and the ghost node hides.
  function finalizeAbsorb(id, fx) {
    state.fx.delete(id);
    const node = state.nodes.find((entry) => entry.id === id);
    if (node) node._absorbed = true;
    if (state.selected?.id === id) selectNode(null);
    if (state.hoverNode?.id === id) state.hoverNode = null;
    const host = absorbHost(fx);
    if (!fx.removed) {
      const key = host?.id ?? fx.anchorId ?? "__assistant__";
      const entry = {
        title: fx.builder ? fx.label ?? "build" : fx.task?.title ?? "task",
        prompt: fx.task?.prompt ?? null,
        taskId: fx.builder ? null : fx.task?.id ?? null,
        kind: fx.builder ? "job" : "task",
        status: fx.task?.status ?? null,
        at: Date.now(),
      };
      state.absorbed.set(key, [entry, ...(state.absorbed.get(key) ?? [])].slice(0, ABSORBED_MAX));
      if (state.absorbed.size > 48) for (const stale of [...state.absorbed.keys()].slice(0, state.absorbed.size - 40)) state.absorbed.delete(stale);
    }
    if (host && state.active && !noMotion()) {
      spawnParticles(host, 10, { gold: true });
      bell({ quick: true, level: 0.5 });
    }
    if (fx.folded) pushFeed({ noFold: true, kind: "task", text: `finished sessions absorbed · ${fx.label ?? "cluster"}` });
    else if (!fx.builder && fx.task?.status === "done") pushFeed({ noFold: true, kind: "task", text: `task finished · ${fx.task.title ?? "task"}` });
    if (state.selected) renderInfo();
  }

  const easeOut = (t) => 1 - (1 - t) ** 3;
  const smoothStep = (t) => t * t * (3 - 2 * t);
  // A small overshoot on the way out, so a new node reads as popping free.
  const easeOutBack = (t) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;

  // Per-frame life-cycle step: _scale/_fade are all the draw loop reads; the
  // position lerp runs host → slot on the way out and spot → host on the way in.
  function stepFx(now) {
    for (const node of state.nodes) {
      node._scale = 1;
      node._fade = 1;
      const fx = state.fx.get(node.id);
      if (!fx) continue;
      if (fx.absorbAt != null) {
        const t = Math.min(1, Math.max(0, (now - fx.absorbAt) / NODE_ABSORB_MS));
        const e = smoothStep(t);
        const host = absorbHost(fx);
        const sx = fx.lastX ?? node.x;
        const sy = fx.lastY ?? node.y;
        const sz = fx.lastZ ?? node.z;
        if (host) {
          node.x = sx + (host.x - sx) * e;
          node.y = sy + (host.y - sy) * e;
          node.z = sz + (host.z - sz) * e;
        }
        node._scale = Math.max(0, 1 - e);
        node._fade = node._scale;
        if (t >= 1) finalizeAbsorb(node.id, fx);
        continue;
      }
      const age = fx.bornAt == null ? Infinity : now - fx.bornAt;
      if (age < 0 || age >= NODE_GROW_MS) continue;
      const t = age / NODE_GROW_MS;
      const e = easeOut(t);
      const host = absorbHost(fx);
      if (host && !fx.builder) {
        node.x = host.x + ((node.bx ?? node.x) - host.x) * e;
        node.y = host.y + ((node.by ?? node.y) - host.y) * e;
        node.z = host.z + ((node.bz ?? node.z) - host.z) * e;
      }
      node._scale = Math.max(0.01, easeOutBack(t));
      node._fade = Math.min(1, e * 2);
    }
  }

  // Grace expiry, stepped by the frame loop so the countdown only runs while
  // the constellation is actually on screen: an unread task absorbs on its
  // own once the window is out; a clicked one waits out its calm beat first.
  function stepDoneHold(now) {
    for (const [id, hold] of [...state.doneHold]) {
      if (now < (hold.ackedAt ?? hold.since) + (hold.ackedAt ? DONE_ACK_MS : DONE_HOLD_MS)) continue;
      // A node whose card is open is being read: the sink waits for the close.
      if (state.selected?.id === id) continue;
      state.doneHold.delete(id);
      const fx = state.fx.get(id);
      if (!fx || fx.absorbAt != null) continue;
      if (hold.task) fx.task = hold.task;
      fx.removed = false;
      markAbsorb(id);
    }
  }

  // Clicking a finished node — its "!" or the node itself — is the read: the
  // wiggle and the pulse calm down and the flight home is armed for a beat.
  function ackDoneHold(id) {
    const hold = state.doneHold.get(id);
    if (!hold || hold.ackedAt) return;
    hold.ackedAt = Date.now();
  }

  function takeTasks(tasks) {
    const all = Array.isArray(tasks) ? tasks : [];
    const open = all.filter((task) => task.status === "open" || task.status === "active");
    const openIds = new Set(open.map((task) => `task:${task.id}`));
    const byId = new Map(all.map((task) => [`task:${task.id}`, task]));
    const now = Date.now();
    for (const task of open) {
      const id = `task:${task.id}`;
      const fx = state.fx.get(id);
      if (!fx) {
        // New to the board: pop out of the host on the next rebuild. Tasks the
        // first read already knew about seed as settled — a whole backlog
        // popping at once reads as noise, not as news.
        state.fx.set(id, { bornAt: state.tasksSeeded ? Date.now() : -Infinity, absorbAt: null, task, builder: false });
      } else {
        fx.task = task;
        fx.removed = false;
        state.doneHold.delete(id); // reopened: it is work again, not finished work
        if (fx.absorbAt != null) {
          // Reopened mid-flight: grow back out of wherever it had sunk to.
          fx.absorbAt = null;
          fx.bornAt = Date.now();
        }
      }
    }
    for (const [id, fx] of state.fx) {
      if (fx.builder || fx.absorbAt != null || openIds.has(id)) continue;
      // Left the open set (done, archived, deleted): fly home and be absorbed.
      const stored = byId.get(id);
      fx.removed = !stored;
      if (stored) fx.task = stored;
      // Freshly finished work holds the board for its grace — pulse green, a
      // wiggling "!", one click to read it before it sinks. Everything else
      // (archived, deleted, done before the view watched) absorbs straight
      // away, the way it always did: the ceremony is only for work that was
      // new or open when it finished.
      const fresh =
        stored?.status === "done" &&
        state.tasksSeeded &&
        stored.doneAt > 0 &&
        now - stored.doneAt < DONE_FRESH_MS;
      if (fresh) {
        const hold = state.doneHold.get(id);
        if (hold) hold.task = stored;
        else state.doneHold.set(id, { task: stored, since: now, ackedAt: null });
      } else {
        state.doneHold.delete(id);
        markAbsorb(id);
      }
    }
    state.tasksSeeded = true;
    state.tasks = open;
  }

  async function refreshTasks() {
    try {
      const result = await window.mefiStudio?.tasksList?.();
      takeTasks(result?.tasks);
    } catch {}
  }

  // tasks:save overwrites the whole store: rewrite one task only from a list that
  // was read and still holds it, never from an empty or failed read.
  async function patchTask(id, patch) {
    try {
      const all = (await window.mefiStudio?.tasksList?.())?.tasks;
      if (!Array.isArray(all) || !all.some((entry) => entry.id === id)) return false;
      const now = Date.now();
      await window.mefiStudio.tasksSave(
        all.map((entry) => {
          if (entry.id !== id) return entry;
          const next = { ...entry, ...patch, updatedAt: now };
          // A finish from the constellation stamps doneAt like the board does,
          // so the task lands under the Done mark with a real finish time.
          if (patch.status === "done" && entry.status !== "done" && entry.status !== "archived") {
            next.doneAt = now;
            next.logs = [...(entry.logs ?? []), { at: now, kind: "status", text: "marked done" }].slice(-40);
          } else if (patch.status === "open" || patch.status === "active") {
            delete next.doneAt;
          }
          return next;
        })
      );
      return true;
    } catch {
      return false;
    }
  }

  function pillOf(name) {
    return el.pills?.[name] ?? null;
  }

  function writePill(name, { count, unit, hidden, warn = false, bad = false }) {
    const pill = pillOf(name);
    if (!pill) return;
    if (count != null) {
      const num = pill.querySelector(".num");
      if (num) num.textContent = String(count);
    }
    if (unit != null) {
      const text = pill.querySelector(".unit");
      if (text) text.textContent = unit;
    }
    pill.classList.toggle("warn", warn);
    pill.classList.toggle("bad", bad);
    pill.hidden = hidden;
  }

  async function updateTelemetry(force = false) {
    const nodeCount = state.nodes.length;
    if (!force && Date.now() - state.telemetryAt < 6000 && nodeCount === state.telemetryNodeCount) return state.telemetry;
    state.telemetryAt = Date.now();
    state.telemetryNodeCount = nodeCount;
    const badges = window.MefiNav?.badges ?? null;
    const sessions = badges?.sessions ?? state.nodes.filter((node) => node.kind === "session").length;
    const inProgress = badges?.progress ?? state.nodes.filter((node) => node.kind === "todo" && node.status === "in_progress").length;
    const openTasks = badges?.tasks ?? state.tasks.length;
    // nav already polls the ideas store for its badges; only run the local poll
    // when there is no nav (plain browser, stripped bundle).
    if (!badges && Date.now() - state.ideasAt > 30000) {
      state.ideasAt = Date.now();
      try {
        const ideaResult = await window.mefiStudio?.ideasList?.();
        state.ideasUnread = (ideaResult?.ideas ?? []).filter((idea) => !idea.read).length;
      } catch {}
    }
    const unread = badges?.ideas ?? state.ideasUnread;
    const machineValue =
      badges?.machine ??
      (state.machineStatus ? (state.machineStatus.leases?.exclusive ? "exclusive" : state.machineStatus.wait ? "busy" : "free") : null);
    const machine = machineValue ? `machine: ${machineValue}` : "";
    state.telemetry = `${sessions} sessions · ${inProgress} in progress · ${openTasks} open task${openTasks === 1 ? "" : "s"} · ${unread} unread idea${unread === 1 ? "" : "s"}${machine ? ` · ${machine}` : ""}`;
    if (el.telemetry) el.telemetry.title = state.telemetry;
    const offline = state.treeStatus !== "ok";
    writePill("sessions", { count: sessions, unit: sessions === 1 ? "session" : "sessions", hidden: offline });
    writePill("progress", { count: inProgress, unit: "in progress", hidden: offline || !inProgress });
    writePill("tasks", { count: openTasks, unit: openTasks === 1 ? "open task" : "open tasks", hidden: offline || !openTasks });
    writePill("ideas", { count: unread, unit: unread === 1 ? "unread idea" : "unread ideas", hidden: offline || !unread });
    writePill("machine", {
      unit: `machine · ${machineValue === "exclusive" ? "exclusive" : "busy"}`,
      hidden: offline || !(machineValue === "busy" || machineValue === "exclusive"),
      warn: machineValue === "busy",
      bad: machineValue === "exclusive",
    });
    const offlinePill = pillOf("offline");
    if (offlinePill) offlinePill.hidden = !offline;
    updateAssistantPill();
    return state.telemetry;
  }

  // ---------- the assistant ----------
  function assistantNode() {
    return state.nodes.find((node) => node.kind === "assistant") ?? null;
  }

  function foldedNode() {
    return state.nodes.find((node) => node.kind === "folded") ?? null;
  }

  // Drop a just-repeated user/assistant pair. Double-firing Work on it used
  // to paint the same ask twice; the saved thread may still carry a copy.
  function threadMessages(full) {
    const raw = Array.isArray(full?.messages) ? full.messages : [];
    const out = [];
    for (const message of raw) {
      if (!message) continue;
      const prev = out[out.length - 1];
      if (prev && prev.role === message.role && String(prev.text ?? "") === String(message.text ?? "")) continue;
      out.push(message);
      if (out.length < 4) continue;
      const a = out[out.length - 4];
      const b = out[out.length - 3];
      const c = out[out.length - 2];
      const d = out[out.length - 1];
      if (
        a.role === "user" &&
        c.role === "user" &&
        b.role !== "user" &&
        d.role !== "user" &&
        String(a.text ?? "") === String(c.text ?? "") &&
        String(b.text ?? "") === String(d.text ?? "")
      ) {
        out.splice(-2, 2);
      }
    }
    return out.slice(-30);
  }

  // One thread renderer for both surfaces (the rail console and the right-side
  // chat log): the newest bubbles, a thinking bubble while a reply is pending,
  // and the scroll pinned to the tail only while the reader already is.
  function fillThread(container, full) {
    if (!container) return;
    const pinned = container.scrollTop + container.clientHeight >= container.scrollHeight - 28;
    const top = container.scrollTop;
    container.textContent = "";
    const bridge = Boolean(window.mefiStudio?.assistantMessage);
    const messages = threadMessages(full);
    if (!messages.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = bridge ? "No messages yet — ask for a status, or give it work." : "The thread lives in the desktop app.";
      container.append(empty);
    }
    for (const message of messages) {
      const thought = message.role === "thinking";
      const bubble = document.createElement("div");
      bubble.className = `assistant-msg ${message.role === "user" ? "user" : thought ? "assistant thinking" : "assistant"}`;
      bubble.textContent = String(message.text ?? "");
      const when = document.createElement("span");
      when.className = "when";
      when.textContent = thought
        ? `${agoLabel(message.at) ?? ""} · thinking`
        : `${agoLabel(message.at) ?? ""}${message.role !== "user" && message.via === "local" ? " · local" : ""}`;
      bubble.append(when);
      container.append(bubble);
    }
    const live = String(full?.thinking?.text ?? "").trim();
    const last = messages[messages.length - 1];
    const sameLive = Boolean(live && last?.role === "thinking" && String(last.text ?? "") === live);
    if (replyPending(full) && !sameLive) container.append(thinkingBubble(full));
    container.scrollTop = pinned ? container.scrollHeight : top;
  }

  // The right-side chat log: the thread, the quick asks and a composer docked
  // beside the node card, so the assistant's side of every exchange — every
  // task ask, every "work on it", every reply — stays on screen while the
  // constellation works. Collapses to a slim header when the canvas is wanted.
  function renderChatLog() {
    if (!el.chatLog) return;
    const full = assistantFull();
    const summary = assistantSummary();
    const bridge = Boolean(window.mefiStudio?.assistantMessage);
    const agents = (Array.isArray(full?.agents) ? full.agents : []).filter((agent) => agent?.status === "running").length;
    const builders = autopilotJobs(state.assistant).length;
    const running = agents + builders;
    el.chatLog.dataset.running = String(running);
    if (el.chatLogState) {
      // Collapsed header keeps this line, so the tab itself shows how many
      // agents are in flight (roster + executor) instead of hiding behind +.
      const line = !bridge ? "desktop app only" : full?.status === "paused" ? "paused" : running ? `${running} running` : summary.sublabel ?? "idle";
      el.chatLogState.textContent = line;
      el.chatLogState.title = summary.detail ?? line;
    }
    if (el.chatLogDot) {
      el.chatLogDot.dataset.state =
        full?.status === "paused" ? "" : running ? "running" : summary.tone === "warn" || summary.tone === "offline" ? "bad" : "running";
    }
    fillThread(el.chatLogThread, full);
    if (el.chatLogInput) {
      el.chatLogInput.disabled = !bridge || state.assistantSending;
      const focused = full?.focus?.id ? full.focus : null;
      el.chatLogInput.placeholder = !bridge
        ? "desktop app only"
        : focused
          ? `Work on "${String(focused.label || focused.id).slice(0, 36)}"… (Enter)`
          : "Message the assistant… (Enter)";
      growArea(el.chatLogInput);
    }
    if (el.chatLogSend) {
      el.chatLogSend.disabled = !bridge || state.assistantSending;
      el.chatLogSend.textContent = state.assistantSending ? "…" : "Send";
    }
  }

  // Live-update can reload a torn idle.js that calls renderChatLog before the
  // function has landed. A missing painter must never fail Work on it: the
  // main process has already queued the job by then.
  function paintChatLog() {
    try {
      renderChatLog();
    } catch (error) {
      console.warn("[idle] chat log", error);
    }
  }

  function applyChatLogOpen(open) {
    state.chatLogOpen = Boolean(open);
    el.chatLog?.classList.toggle("collapsed", !state.chatLogOpen);
    el.chatLogToggle?.setAttribute("aria-expanded", String(state.chatLogOpen));
    el.chatLogToggle?.setAttribute("title", state.chatLogOpen ? "Collapse the chat log" : "Expand the chat log");
    if (el.chatLogToggle) el.chatLogToggle.textContent = state.chatLogOpen ? "–" : "+";
    el.hud?.classList.toggle("chat-log-open", state.chatLogOpen);
    state.hudRectsAt = 0;
  }

  // The service state as tree3d holds it (the full thread and log), and the
  // short summary every surface shares.
  function assistantFull() {
    return window.MefiTree?.assistantState?.() ?? null;
  }

  function assistantSummary() {
    return window.MefiTree?.assistantSummary?.() ?? { label: "Assistant", sublabel: "desktop app only", tone: "offline", pulse: false };
  }

  // The executor runs several opencode jobs at once: assistant.running is a
  // list (a lone object from an older main is still handled).
  const autopilotJobs = (assistant) => {
    const running = assistant?.running;
    return Array.isArray(running) ? running.filter(Boolean) : running ? [running] : [];
  };

  // Every node id the executor is building right now. A job carries a sessionId
  // only once watchRunSession has found the opencode session it spawned (up to
  // 30 s in, and never for a run that opens no session), and a task job carries
  // a taskId from the moment it starts. Keying the live treatments on sessionId
  // alone is why a task under construction sat there looking untouched — the
  // agents lit up, started, and nothing on the board ever moved.
  const autopilotBusyIds = (assistant) => {
    const ids = new Set();
    for (const job of autopilotJobs(assistant)) {
      if (job.sessionId) ids.add(job.sessionId);
      if (job.taskId) ids.add(job.taskId);
    }
    return ids;
  };
  // A node is "being built" when the executor holds its session or its task.
  const isBusyNode = (node, ids) => Boolean(node) && ids.size > 0 && (ids.has(node.id) || ids.has(node.sessionId) || ids.has(node.task?.id));

  // The ids behind Work on it: pinned open/active board tasks, and the node
  // targets of pinned inbox requests that have not been claimed yet. The blue
  // work ring rides from the click until the work finishes — queued first,
  // then looping bright while the executor holds it.
  function workPinIds() {
    const now = Date.now();
    if (!state.workPinSeen) state.workPinSeen = new Map();
    const ids = new Set();
    for (const request of Array.isArray(state.requests) ? state.requests : []) {
      const targetId = request?.target?.id;
      if (request?.pin && request.status !== "running" && targetId) ids.add(String(targetId));
    }
    for (const node of state.nodes) {
      const task = node.task;
      if (node.kind === "task" && task?.pin && (task.status === "open" || task.status === "active")) ids.add(String(task.id));
    }
    // The seen set is the bridge across the handoff: the claim clears the pin
    // exactly when the build starts, so the ring keys off "was pinned and is
    // now running" rather than the pin alone. Entries age out so a finished
    // job's node goes quiet again.
    for (const [id, at] of state.workPinSeen) if (now - at > 2 * 3600000) state.workPinSeen.delete(id);
    for (const id of ids) state.workPinSeen.set(id, now);
    return ids;
  }
  const matchesIdSet = (node, ids) => Boolean(node) && ids.size > 0 && (ids.has(String(node.id ?? "")) || ids.has(String(node.sessionId ?? "")) || ids.has(String(node.task?.id ?? "")));

  // Where the work currently sits, for follow camera: the newest executor
  // job's node — the opencode session it spawned or the task it is building —
  // or, with nothing in flight, the session the activity stream touched last.
  // Null when the board is quiet, so the camera holds instead of wandering.
  function workNode() {
    const jobs = autopilotJobs(state.assistant);
    for (let index = jobs.length - 1; index >= 0; index -= 1) {
      const job = jobs[index];
      const node =
        nodeForSession(job.sessionId) ??
        state.nodes.find((entry) => entry.kind === "task" && (entry.id === `task:${job.taskId}` || entry.task?.id === job.taskId));
      if (node) return node;
    }
    let best = null;
    let bestAt = -1;
    for (const node of state.nodes) {
      if (node.kind !== "session") continue;
      const at = state.touches.get(node.sessionId)?.at ?? 0;
      if (at > bestAt) {
        bestAt = at;
        best = node;
      }
    }
    return best;
  }

  function refreshAssistantCache() {
    const summary = assistantSummary();
    const full = assistantFull();
    // Merge, don't replace: the same slot also carries the autopilot status
    // (running jobs, parallel, queue depth) from the last push.
    state.assistant = { ...(state.assistant ?? {}), status: full?.status ?? null, tone: summary.tone, sublabel: summary.sublabel, unread: Number(full?.unread) || 0 };
  }

  // The pill stays whatever the store is doing: the service runs whether or not
  // the OpenCode database can be read, and it is the way back to the node.
  function updateAssistantPill() {
    const pill = pillOf("assistant");
    if (!pill) return;
    if (!window.mefiStudio?.assistantState) {
      pill.hidden = true;
      return;
    }
    const summary = assistantSummary();
    const full = assistantFull();
    const unread = Number(full?.unread) || 0;
    const working = (Array.isArray(full?.agents) ? full.agents : []).filter((agent) => agent.status === "running").length;
    const inFlight = Array.isArray(full?.work) ? full.work.length : 0;
    // Jobs in flight beat the agent count, which beats the service line.
    const line = inFlight ? `working on ${inFlight}` : working ? `${working} working` : summary.sublabel;
    const unit = pill.querySelector(".unit");
    if (unit) unit.textContent = `assistant · ${line}${unread ? ` · ${unread} new` : ""}`;
    pill.dataset.tone = summary.tone;
    pill.classList.toggle("warn", summary.tone === "warn" || summary.tone === "offline");
    pill.classList.remove("bad");
    // The short form is on the pill; the whole story is a hover away.
    pill.title = `${summary.label} · ${summary.detail ?? summary.sublabel}\nselect the assistant (M)`;
    pill.hidden = false;
  }

  // The assistant console lives in the A-Eyes rail while that panel is
  // visible; the floating card only serves the ≤900px layout that hides it.
  function chatMode() {
    return state.selected?.kind === "assistant" && feedVisible();
  }

  function composerInput() {
    return chatMode() ? el.chatInput ?? null : el.info?.querySelector(".assistant-composer input, .assistant-composer textarea") ?? null;
  }

  function focusComposer() {
    const input = composerInput();
    if (input && !input.disabled) input.focus();
  }

  function selectAssistant({ focus = false } = {}) {
    const node = assistantNode();
    if (!node) {
      window.MefiToast?.("no assistant node yet", "info");
      return false;
    }
    selectNode(node, { via: "key" });
    focusNode(node, { zoom: 1.4 });
    if (focus) focusComposer();
    return true;
  }

  function assistantTone() {
    const summary = assistantSummary();
    const full = assistantFull();
    return { tone: summary.tone, running: Boolean(window.mefiStudio?.assistantState) && full?.status === "running" };
  }

  // The satellites' statuses follow every push without a full snapshot.
  function syncAgentNodes() {
    const roster = assistantFull()?.agents;
    if (!Array.isArray(roster)) return;
    for (const node of state.nodes) {
      if (node.kind !== "agent") continue;
      const agent = roster.find((entry) => entry.role === node.role);
      if (!agent) continue;
      node.status = AGENT_STATES.has(agent.status) ? agent.status : "idle";
      node.state = node.status;
      node.text = agent.text ?? "";
      node.error = agent.error ?? null;
      node.lastRunAt = agent.lastRunAt ?? 0;
      node.runs = agent.runs ?? 0;
      // The meter reads this between rebuilds: a running agent's own fraction.
      node.progress = typeof agent.progress === "number" ? agent.progress : null;
    }
  }

  async function assistantPrefs(patch, label) {
    if (!window.mefiStudio?.assistantPrefs) {
      window.MefiToast?.("the assistant runs in the desktop app only", "info");
      return null;
    }
    try {
      const result = await window.mefiStudio.assistantPrefs(patch);
      if (!result?.ok) {
        window.MefiToast?.(`${label} not saved · ${result?.error ?? "unknown error"}`, "bad");
        return null;
      }
      if (result.state) window.MefiTree?.applyAssistant?.({ state: result.state });
      refreshAssistantCache();
      updateAssistantPill();
      if (state.selected?.kind === "assistant") renderInfo();
      const prefs = assistantFull()?.prefs ?? {};
      window.MefiToast?.(`${label} · ${Object.keys(patch).map((key) => `${key} ${prefs[key] ?? patch[key]}`).join(" · ")}`, "good");
      return result;
    } catch (error) {
      window.MefiToast?.(`${label} not saved · ${String(error?.message ?? error)}`, "bad");
      return null;
    }
  }

  // The autopilot's own prefs (executor switch, job width) live in
  // settings.ui.autopilot, not the assistant service state.
  async function autopilotPrefs(patch, label) {
    if (!window.mefiStudio?.assistantAutopilot) {
      window.MefiToast?.("the autopilot runs in the desktop app only", "info");
      return null;
    }
    try {
      const result = await window.mefiStudio.assistantAutopilot(patch);
      if (result?.ok === false) {
        window.MefiToast?.(`${label} not saved`, "bad");
        return null;
      }
      if (result) state.assistant = { ...(state.assistant ?? {}), ...result };
      updateAssistantPill();
      if (state.selected?.kind === "assistant") renderInfo();
      state.feedDirty = true;
      if (state.active) renderFeed();
      window.MefiToast?.(`${label} · ${result?.parallel ?? patch.parallel ?? "?"} at once`, "good");
      return result;
    } catch (error) {
      window.MefiToast?.(`${label} not saved · ${String(error?.message ?? error)}`, "bad");
      return null;
    }
  }

  // A message must always produce a reply; the reply itself lands through the
  // eyes:assistant push, this only carries the state the answer came with.
  // `origin` names the composer that sent it ("log" = the right-side chat log
  // panel), so only that field clears and keeps the keyboard.
  async function sendAssistant(text, origin = null) {
    const message = String(text ?? "").trim();
    if (!message) return null;
    if (!window.mefiStudio?.assistantMessage) {
      window.MefiToast?.("the assistant runs in the desktop app only", "info");
      return null;
    }
    if (state.assistantSending) return null;
    state.assistantSending = true;
    let sent = false;
    if (state.selected?.kind === "assistant") renderInfo();
    try {
      const result = await window.mefiStudio.assistantMessage(message);
      if (!result?.ok) {
        window.MefiToast?.(`not sent · ${result?.error ?? "unknown error"}`, "bad");
        return null;
      }
      sent = true;
      if (result.state) window.MefiTree?.applyAssistant?.({ state: result.state });
      return result;
    } catch (error) {
      window.MefiToast?.(`not sent · ${String(error?.message ?? error)}`, "bad");
      return null;
    } finally {
      state.assistantSending = false;
      refreshAssistantCache();
      updateAssistantPill();
      // A failed send hands the text back; a sent one clears the composer —
      // the rail's input is static, so it is emptied here rather than by the
      // card rebuild.
      // A chip send must not wipe a half-typed draft: the composer only
      // clears when its text is what just went out.
      if (sent && el.chatInput && chatMode() && el.chatInput.value.trim() === message) {
        el.chatInput.value = "";
        growArea(el.chatInput);
      }
      if (sent && origin === "log" && el.chatLogInput && el.chatLogInput.value.trim() === message) {
        el.chatLogInput.value = "";
        growArea(el.chatLogInput);
      }
      if (state.selected?.kind === "assistant") renderInfo({ clearDraft: sent ? message : false });
      // The composer keeps the keyboard: a sent message should not cost focus.
      if (sent && origin === "log") el.chatLogInput?.focus();
      else if (sent && chatMode()) el.chatInput?.focus();
      paintChatLog();
    }
  }

  // Work on it: the node becomes the assistant's next piece of work. Main
  // pins it (a board task) or queues it pinned (a session or todo), threads
  // the ask so the chat log shows it, and kicks the executor on the spot —
  // the blue work ring on the node starts with this call and loops until the
  // work is done.
  async function workOnNode(node) {
    if (state.workOnBusy) return;
    state.workOnBusy = true;
    const label = String(node.label ?? node.task?.title ?? node.id).slice(0, 60);
    const target =
      node.kind === "task"
        ? { kind: "task", id: node.task?.id ?? String(node.id).slice("task:".length), label: node.task?.title ?? label }
        : node.kind === "todo"
          ? { kind: "todo", id: node.id, label }
          : { kind: "session", id: node.sessionId ?? node.id, label };
    try {
      if (!window.mefiStudio?.assistantWorkOn) {
        await sendAssistant(`Work on "${label}"`);
        return;
      }
      const result = await window.mefiStudio.assistantWorkOn(target);
      if (!result?.ok) {
        window.MefiToast?.(`work on it failed · ${result?.error ?? "unknown error"}`, "bad");
        return;
      }
      if (result.state) window.MefiTree?.applyAssistant?.({ state: result.state });
      refreshAssistantCache();
      updateAssistantPill();
      window.MefiToast?.(`${result.where ?? "queued"} — it is next`, "good");
    } catch (error) {
      window.MefiToast?.(`work on it failed · ${String(error?.message ?? error)}`, "bad");
    } finally {
      state.workOnBusy = false;
      paintChatLog();
    }
  }

  async function assistantControl(action, label) {
    if (!window.mefiStudio?.assistantControl) {
      window.MefiToast?.("the assistant runs in the desktop app only", "info");
      return null;
    }
    try {
      const result = await window.mefiStudio.assistantControl(action);
      if (!result?.ok) {
        window.MefiToast?.(`${label} failed · ${result?.error ?? "unknown error"}`, "bad");
        return null;
      }
      if (result.state) window.MefiTree?.applyAssistant?.({ state: result.state });
      refreshAssistantCache();
      updateAssistantPill();
      if (state.selected?.kind === "assistant") renderInfo();
      const full = assistantFull();
      if (action === "tidy") window.MefiToast?.(full?.housekeeping?.lastText || "tidy pass done", "good");
      else if (action === "fix") {
        const last = (full?.fixes ?? []).slice(-1)[0];
        window.MefiToast?.(last ? `fix · ${String(last.text).slice(0, 90)}` : "fix pass done · nothing to repair", "good");
      } else if (action === "overseer") {
        const overseer = full?.overseer;
        window.MefiToast?.(overseer?.lastSummary ? `overseer · ${overseer.lastSummary}` : "overseer review queued", overseer?.health === "poor" ? "bad" : overseer?.health === "fair" ? "info" : "good");
      } else window.MefiToast?.(`assistant ${full?.status ?? action}`, "info");
      return result;
    } catch (error) {
      window.MefiToast?.(`${label} failed · ${String(error?.message ?? error)}`, "bad");
      return null;
    }
  }

  function onAssistantEvent(payload) {
    const applied = window.MefiTree?.applyAssistant?.(payload) ?? Promise.resolve();
    refreshAssistantCache();
    updateAssistantPill();
    paintChatLog();
    const kind = payload?.event?.kind ?? null;
    if (!kind) return;
    if (kind === "tick") {
      // The pill only — unless the card is open, whose heartbeat, next-tick and
      // problem rows would otherwise go stale (the draft survives the rebuild).
      if (state.selected?.kind === "assistant") renderInfo();
      return;
    }
    if (kind === "agent") {
      // "auditor started" / "briefer failed · …": the role leads the text.
      syncAgentNodes();
      const role = payload?.event?.role ?? String(payload?.event?.text ?? "").split(/\s+/)[0];
      const status = payload?.event?.status ?? null;
      const satellite = state.nodes.find((node) => node.kind === "agent" && node.role === role);
      const hub = assistantNode();
      if (state.active && hub && satellite && status !== "done") {
        // The direction is the story: an order leaves the assistant for the
        // satellite, a failure comes back the other way. (A finished job's
        // report home rides the brighter intel packet, next case.)
        const failed = status === "error" || /\bfailed\b|\berror\b/.test(String(payload?.event?.text ?? ""));
        const from = status === "error" ? satellite : hub;
        const to = status === "error" ? hub : satellite;
        state.pulses.push({ from, to, start: Date.now(), duration: 900, color: failed ? "#ffd479" : agentHex(role), glow: failed ? "#ffd479" : agentHex(role), wave: true });
        if (state.pulses.length > 24) state.pulses.shift();
      }
      if (state.selected?.kind === "assistant" || state.selected?.kind === "agent") renderInfo();
      return;
    }
    if (kind === "intel") {
      // A scout reported home: a packet pulse flies satellite → assistant
      // carrying the finding, and the card's Reported list keeps it on record.
      // Builders are executor jobs, not roster seats — match the job that
      // just spoke, falling back to any live builder node.
      const role = payload?.event?.role ?? null;
      const title = payload?.event?.title ?? null;
      const satellite = role
        ? state.nodes.find((node) => {
            if (node.kind !== "agent" || node.role !== role) return false;
            if (role === "builder" && title) return node.label === title || node.job?.title === title;
            return true;
          }) || (role === "builder" ? state.nodes.find((node) => node.kind === "agent" && node.role === "builder") : null)
        : null;
      const hub = assistantNode();
      if (state.active && hub && satellite) {
        state.pulses.push({ from: satellite, to: hub, start: Date.now(), duration: 1100, color: "#ffe9a8", glow: "#e6c98d", wave: true, packet: true });
        if (state.pulses.length > 24) state.pulses.shift();
      }
      if (state.selected?.kind === "assistant" || state.selected?.kind === "agent") renderInfo();
      return;
    }
    if (kind === "think") {
      // Overseer and thinker talking in the box: pulse between the satellite
      // and the hub so the conversation is visible on the tree.
      const role = payload?.event?.role ?? "thinker";
      const satellite = state.nodes.find((node) => node.kind === "agent" && node.role === role);
      const hub = assistantNode();
      if (state.active && hub && satellite && payload?.event?.text) {
        const fromOverseer = role === "overseer";
        state.pulses.push({
          from: fromOverseer ? satellite : hub,
          to: fromOverseer ? hub : satellite,
          start: Date.now(),
          duration: 900,
          color: agentHex(role),
          glow: agentHex(role),
          wave: true,
          packet: fromOverseer,
        });
        if (state.pulses.length > 24) state.pulses.shift();
      }
      if (state.selected?.kind === "assistant" || state.selected?.kind === "agent") renderInfo();
      return;
    }
    if (kind === "organize") {
      // tree3d reloads the store on organize; the snapshot is only right after.
      applied.then?.(() => {
        if (state.active && !document.body.dataset.sheet) refreshGraph();
      });
      return;
    }
    if (kind === "focus") {
      // A click pointed the assistant at a node (or cleared it): pulse to the
      // node and re-render the card so its focus row and placeholder keep up.
      const hub = assistantNode();
      const focus = payload?.event?.focus;
      const node = focus?.id ? state.nodes.find((entry) => entry.kind === focus.kind && entry.id === focus.id) : null;
      if (state.active && hub && node) {
        state.pulses.push({ from: hub, to: node, start: Date.now(), duration: 900, color: "#f1dcae", glow: "#e6c98d" });
        if (state.pulses.length > 24) state.pulses.shift();
      }
      if (state.selected) renderInfo();
      return;
    }
    if (!["message", "reply", "tidy", "fix"].includes(kind)) return;
    const selectedAssistant = state.selected?.kind === "assistant";
    if (state.active) {
      const root = rootNode();
      const node = assistantNode();
      if (root && node) {
        const inbound = kind === "message" || kind === "reply";
        state.pulses.push({ from: inbound ? node : root, to: inbound ? root : node, start: Date.now(), duration: 1400, color: "#f1dcae", glow: "#e6c98d" });
        if (state.pulses.length > 24) state.pulses.shift();
      }
    }
    if (selectedAssistant) renderInfo();
    if (kind === "reply" && state.active && !document.body.dataset.sheet && !selectedAssistant) {
      const messages = assistantFull()?.messages ?? [];
      const last = messages[messages.length - 1];
      const text = last?.role === "assistant" ? last.text : payload?.event?.text;
      if (text) window.MefiToast?.(`assistant · ${String(text).slice(0, 90)}`, "info");
    }
  }

  function focusNextInProgress() {
    const list = state.nodes
      .filter((node) => node.kind === "todo" && node.status === "in_progress")
      .sort((a, b) => (parentSession(b)?.updated ?? 0) - (parentSession(a)?.updated ?? 0));
    if (!list.length) {
      window.MefiToast?.("nothing in progress", "info");
      return;
    }
    state.progressCycle = (state.progressCycle + 1) % list.length;
    const node = list[state.progressCycle];
    selectNode(node);
    focusNode(node, { zoom: 1.5 });
  }

  function constellationHasWork() {
    for (const node of state.nodes) {
      if (node.dying) continue;
      if (node.kind === "session" || node.kind === "task" || node.kind === "folded") return true;
      if (node.kind === "agent" && node.builder) return true;
    }
    return autopilotJobs(state.assistant).length > 0;
  }

  function renderEmpty() {
    if (!el.empty) return;
    // Tasks, plans and builders are the constellation now: zero OpenCode
    // sessions must not drop a "No recent sessions" card over live work.
    if (constellationHasWork()) {
      if (!el.empty.hidden) state.hudRectsAt = 0;
      el.empty.hidden = true;
      return;
    }
    let variant = "store";
    let title = "No recent sessions";
    // The desktop-only copy is authored in the template (it carries a <code>
    // run line); only the store variants are written from here.
    let copy = "Nothing from the last 14 days in the OpenCode store.";
    if (!window.mefiStudio) {
      variant = "desktop-only";
      title = "No live constellation";
      copy = null;
    } else if (state.treeStatus === "unavailable") {
      title = "Store unavailable";
      copy = `The OpenCode store could not be read. ${window.MefiTree?.statusText?.() ?? ""}`.trim();
    }
    const wasHidden = el.empty.hidden;
    el.empty.hidden = false;
    if (wasHidden) state.hudRectsAt = 0;
    if (state.emptyVariant !== variant) {
      state.emptyVariant = variant;
      el.empty.dataset.variant = variant;
    }
    if (el.emptyTitle) el.emptyTitle.textContent = title;
    if (el.emptyCopy && copy) el.emptyCopy.textContent = copy;
    // The assistant node outlives the store: its card stays open over this panel.
    if (el.emptyAssistant) el.emptyAssistant.hidden = !assistantNode();
    if (state.selected && state.selected.kind !== "assistant") selectNode(null);
  }

  function renderHint() {
    if (!el.hint) return;
    let text = DEFAULT_HINT;
    if (state.treeStatus !== "ok") text = "desktop store not available · the dock still works";
    else if (state.query) text = "Enter cycles matches · Esc clears the search";
    else if (state.selected?.kind === "task") text = "Enter opens it in Tasks · [ ] other tasks · Esc clears";
    else if (state.selected?.kind === "assistant") text = "Enter sends · ↓ focuses the composer · Esc clears";
    else if (state.selected?.kind === "folded") text = "Enter lists them in the Explorer · ← → sessions · Esc clears";
    else if (state.selected) text = "Enter opens it in the Explorer · ↑ ↓ move · Esc clears";
    else if (state.camMode === "follow") text = "following the current work · C cycles camera modes · F fits";
    else if (state.orbit === "paused") text = "orbit paused · Space resumes · click a node · F fits";
    el.hint.textContent = text;
  }

  // The A-Eyes feed docks on the left; nudge the constellation right so it does
  // not slide under the panel. Half the panel width (~170 px) reads centered.
  function feedVisible() {
    // offsetWidth collapses to 0 when the ≤900px media query hides the panel
    return state.active && !!el.feed && !el.feed.hidden && el.feed.offsetWidth > 0;
  }

  function centerX() {
    return el.width / 2 + (feedVisible() ? 170 : 0);
  }

  function project(node) {
    const scale = state.fit * state.zoom;
    if (state.view === "2d") {
      // flat top-down map: x → screen x, z → screen y, no rotation or depth
      return {
        x: centerX() + (node.x + state.camera.x) * scale,
        y: el.height / 2 + (node.z + state.camera.z) * scale,
        k: 1,
        depth: 500,
      };
    }
    const cos = Math.cos(state.angle);
    const sin = Math.sin(state.angle);
    const tilt = Math.sin(state.angle * 0.37) * 0.35 + state.pitch;
    const x0 = (node.x + state.camera.x) * scale;
    const z0 = (node.z + state.camera.z) * scale;
    const y0 = (node.y + state.camera.y) * scale;
    const rx = x0 * cos - z0 * sin;
    const rz = x0 * sin + z0 * cos;
    const ry = y0 * Math.cos(tilt) - rz * Math.sin(tilt) * 0.4;
    // The camera backs off as the graph is scaled up, so a screen-filling fit (or
    // a deep zoom) keeps the same gentle perspective instead of ballooning the
    // near nodes. `depth` is reported on the 900 baseline the fades are tuned to.
    const distance = 900 * Math.max(1, scale / 1.6);
    const raw = rz + distance;
    const k = distance / Math.max(distance * 0.2, raw);
    return { x: centerX() + rx * k, y: el.height / 2 + ry * k, k, depth: (raw * 900) / distance };
  }

  // The HUD owns the top and bottom strips; fit against what is left.
  function usableArea() {
    return { w: Math.max(240, el.width - 40), h: Math.max(240, el.height - 160) };
  }

  function autoFit() {
    // Keep the whole constellation inside the frame at any window size.
    // The graph orbits around the vertical axis, so its horizontal reach is the
    // radius in the x/z plane at any angle, while its vertical reach is just y.
    // Fitting each axis against its own side of the safe area fills a wide
    // window instead of sizing everything to the shorter side.
    let reach = 1;
    let maxY = 1;
    for (const node of state.nodes) {
      if (state.view === "2d") {
        // flat map: horizontal reach is |x|, vertical reach is |z|
        reach = Math.max(reach, Math.abs(node.x));
        maxY = Math.max(maxY, Math.abs(node.z));
      } else {
        reach = Math.max(reach, Math.hypot(node.x, node.z));
        maxY = Math.max(maxY, Math.abs(node.y));
      }
    }
    const area = usableArea();
    // 1.3: perspective magnifies the near side (k up to ~1.25) and halos need air.
    const fitX = area.w / (reach * 2 * 1.3);
    const fitY = area.h / (maxY * 2 * 1.6);
    state.fit = Math.max(0.7, Math.min(2.4, Math.min(fitX, fitY)));
  }

  function setZoom(value) {
    state.zoom = Math.min(2.6, Math.max(0.45, value));
  }

  function fitAll() {
    state.camera.tx = 0;
    state.camera.ty = 0;
    state.camera.tz = 0;
    state.pitch = 0;
    setZoom(1);
    autoFit();
    if (noMotion()) {
      state.camera.x = 0;
      state.camera.y = 0;
      state.camera.z = 0;
    }
    hideTip();
  }

  function nodeState(node) {
    const touch = state.touches.get(node.sessionId);
    const fresh = touch ? Math.max(0, 1 - (Date.now() - touch.at) / 90000) : 0;
    return { touch, fresh };
  }

  function colorOf(node) {
    if (node.kind === "assistant") return NODE_RGB.assistant;
    if (node.kind === "folded") return NODE_RGB.done;
    if (node.kind === "agent") {
      // status first: amber on error, green when the last job is done, dim
      // slate while queued; a running or idle satellite wears the role colour
      if (node.status === "error") return NODE_RGB.amber;
      if (node.status === "done") return NODE_RGB.done;
      if (node.status === "queued") return NODE_RGB.pending;
      return agentRgb(node.role);
    }
    if (node.state === "stale") return NODE_RGB.stale;
    if (node.state === "done") return NODE_RGB.done;
    if (node.state === "active") return NODE_RGB.warm;
    if (node.kind === "todo") return NODE_RGB.pending;
    return NODE_RGB.session;
  }

  // Soft halo with a white-hot core, like the reference constellation. The
  // halo composites additively so overlapping glows bloom instead of fogging
  // over; the crisp core is drawn normally on top.
  function glowNode(ctx, x, y, radius, tint, { alpha = 1, spread = 6, white = 0.9 } = {}) {
    // The halo is additive but tight: a wide fog washed out the rims, the task
    // rings and the edge work, and read as overexposed where hubs clustered.
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius * spread);
    gradient.addColorStop(0, `rgba(255,255,255,${0.6 * alpha * white})`);
    gradient.addColorStop(0.18, `rgba(${tint},${0.5 * alpha})`);
    gradient.addColorStop(0.42, `rgba(${tint},${0.16 * alpha})`);
    gradient.addColorStop(0.7, `rgba(${tint},${0.04 * alpha})`);
    gradient.addColorStop(1, `rgba(${tint},0)`);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius * spread, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // a tinted body with a small white heart: the node's colour stays readable
    // at every depth and the crisp edge keeps the ring language legible
    ctx.fillStyle = `rgba(${tint},${0.85 * alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1.4, radius * 0.72), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(255,255,255,${0.8 * alpha * white})`;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.8, radius * 0.34), 0, Math.PI * 2);
    ctx.fill();
  }

  function hexToRgb(hex) {
    const value = String(hex).replace("#", "");
    const int = parseInt(value.length === 3 ? value.split("").map((char) => char + char).join("") : value, 16);
    return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
  }

  // The role colours live in the tree's palette (window.MefiTree.agentColor) so
  // the rail, the rosters and this constellation never disagree; here they are
  // wanted as RGB triples, converted and cached once per role.
  const agentRgbCache = new Map();
  function agentHex(role) {
    return window.MefiTree?.agentColor?.(role) ?? "#e6c98d";
  }
  function agentRgb(role) {
    let triple = agentRgbCache.get(role);
    if (!triple) {
      triple = hexToRgb(agentHex(role));
      agentRgbCache.set(role, triple);
    }
    return triple;
  }

  // A `wave` pulse never launches a dot: the line itself answers. It bows on
  // its normal like a plucked string while a bright head with a long fading
  // tail runs a -> b, then a bloom lands on the receiving node. Reduced motion
  // gets a single static flash of the whole line.
  function surgeLine(ctx, a, b, t, pulse, still) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 2) return;
    const [r, g, bl] = hexToRgb(pulse.color ?? "#a9ffcd");
    const tint = `${r},${g},${bl}`;
    if (still) {
      ctx.strokeStyle = `rgba(${tint},0.5)`;
      ctx.lineWidth = pulse.small ? 1.3 : 2;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      return;
    }
    const env = Math.sin(Math.PI * t);
    const bow = env * Math.min(14, len * 0.12);
    const cx = (a.x + b.x) / 2 + (-dy / len) * bow;
    const cy = (a.y + b.y) / 2 + (dx / len) * bow;
    ctx.save();
    // wake: the whole path warms under the surge
    ctx.strokeStyle = `rgba(${tint},${0.28 * env})`;
    ctx.lineWidth = pulse.small ? 1.3 : 1.9;
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
    ctx.lineWidth = pulse.packet ? 3.4 : pulse.small ? 1.8 : 2.7;
    ctx.shadowColor = pulse.glow ?? "#57ff9a";
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(cx, cy, b.x, b.y);
    ctx.stroke();
    ctx.restore();
    // a packet pulse carries cargo: a small diamond rides the head, so a
    // report coming home reads as a delivered finding, not just a signal
    if (pulse.packet) {
      const head = Math.min(1, Math.max(0, t));
      const inv = 1 - head;
      const px = inv * inv * a.x + 2 * inv * head * cx + head * head * b.x;
      const py = inv * inv * a.y + 2 * inv * head * cy + head * head * b.y;
      const size = 4.5 * env + 2;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = `rgba(${tint},${0.9 * env})`;
      ctx.shadowColor = pulse.glow ?? "#e6c98d";
      ctx.shadowBlur = 14;
      ctx.fillRect(-size / 2, -size / 2, size, size);
      ctx.restore();
    }
    // the signal lands: a quick bloom on the receiving node
    const land = Math.max(0, (t - 0.8) / 0.2);
    if (land > 0) {
      const bloom = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, 15);
      bloom.addColorStop(0, `rgba(${tint},${0.65 * land})`);
      bloom.addColorStop(1, `rgba(${tint},0)`);
      ctx.fillStyle = bloom;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 15, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawBubble(ctx, x, y, scale, alpha) {
    const w = 15 * scale;
    const h = 10.5 * scale;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#e6c98d";
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 4 * scale);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + 3 * scale, y + h - 1);
    ctx.lineTo(x + 2 * scale, y + h + 5 * scale);
    ctx.lineTo(x + 7.5 * scale, y + h - 1);
    ctx.fill();
    ctx.fillStyle = "#171307";
    ctx.fillRect(x + 3.2 * scale, y + 3.2 * scale, 3.2 * scale, 1.6 * scale);
    ctx.fillRect(x + 8.4 * scale, y + 3.2 * scale, 3.2 * scale, 1.6 * scale);
    ctx.globalAlpha = 1;
  }

  // ---------- graph helpers ----------
  // "Which branch does this node hang from" — sessions answer with themselves,
  // todos with their session, tasks with the session they were anchored to.
  function branchIdOf(node) {
    return node?.sessionId ?? node?.anchorSessionId ?? node?.id ?? null;
  }

  function nodeForSession(sessionId) {
    return state.nodes.find((node) => node.kind === "session" && node.id === sessionId) ?? null;
  }

  function rootNode() {
    return state.nodes.find((node) => node.kind === "root") ?? null;
  }

  function sessionNodes() {
    return state.nodes.filter((node) => node.kind === "session").sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0));
  }

  // What ← → walk at the top level: the assistant, the sessions, the folded cluster.
  function topNodes() {
    const first = assistantNode();
    const last = foldedNode();
    return [...(first ? [first] : []), ...sessionNodes(), ...(last ? [last] : [])];
  }

  function taskNodes() {
    return state.nodes.filter((node) => node.kind === "task" && !node.dying).sort((a, b) => (b.task?.updatedAt ?? 0) - (a.task?.updatedAt ?? 0));
  }

  function childrenOf(sessionId) {
    if (!sessionId) return [];
    const todos = state.nodes.filter((node) => node.kind === "todo" && node.sessionId === sessionId);
    const tasks = state.nodes.filter((node) => node.kind === "task" && !node.dying && node.anchorSessionId === sessionId);
    return todos.concat(tasks);
  }

  function parentSession(node) {
    if (!node) return null;
    if (node.kind === "session") return node;
    const sessionId = node.kind === "todo" ? node.sessionId : node.anchorSessionId;
    return sessionId ? nodeForSession(sessionId) : null;
  }

  function todosOf(sessionId) {
    return state.nodes.filter((node) => node.kind === "todo" && node.sessionId === sessionId);
  }

  function agoLabel(at) {
    if (!at) return null;
    const minutes = Math.max(0, Math.round((Date.now() - at) / 60000));
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  // ---------- A-Eyes feed panel ----------
  function basename(path) {
    return String(path ?? "").split(/[\\/]/).filter(Boolean).pop() ?? "";
  }

  // Newest first, capped at 40. `id` dedupes: the enter() seeding replays the
  // same eyes rows the live activity push already delivered. A repeat of the
  // same kind/tool/file/session folds into the newest row as a ×N count
  // instead of flooding the list.
  function pushFeed(item) {
    const { id, ...rest } = item;
    if (id && state.feed.some((entry) => entry.id === id)) return;
    const newest = state.feed[0];
    if (
      !rest.noFold && // distinct events (autopilot history) keep their own rows
      newest &&
      newest.kind === rest.kind &&
      (newest.tool ?? null) === (rest.tool ?? null) &&
      (newest.file ?? null) === (rest.file ?? null) &&
      (newest.sessionId ?? null) === (rest.sessionId ?? null)
    ) {
      newest.count = (newest.count ?? 1) + 1;
      newest.at = Date.now();
    } else {
      state.feed.unshift({ id: id ?? `${Date.now()}-${Math.random()}`, at: Date.now(), ...rest });
      if (state.feed.length > 40) state.feed.length = 40;
    }
    state.feedDirty = true;
    if (state.active) renderFeed();
  }

  function feedLine(item) {
    if (item.kind === "tool") return `${item.tool ?? "tool"} ${item.file ?? ""}`.trim();
    return String(item.text ?? "");
  }

  function requestTag(source) {
    return { fix: "FIX", collision: "COLLIDE", duplicate: "DUP", improver: "IMPROVE", grow: "GROW", expand: "EXPAND", audit: "AUDIT" }[source] ?? "REQ";
  }

  function renderFeed() {
    if (!el.feed || !state.feedDirty) return;
    state.feedDirty = false;
    const bridge = Boolean(window.mefiStudio);
    const assistant = state.assistant;
    const full = assistantFull();
    const jobs = autopilotJobs(assistant);
    const enabled = Boolean(assistant?.enabled);
    const recentPass = Boolean(assistant?.lastPassAt) && Date.now() - assistant.lastPassAt < 10 * 60 * 1000;

    let dot = "off";
    let text = "…";
    if (!bridge) text = "desktop only";
    else if (jobs.length) {
      dot = "running";
      text = jobs.length > 1 ? `running ×${jobs.length}` : "running";
    } else if (!assistant) text = "…";
    else if (assistant.waiting) {
      dot = "warm";
      text = `waiting · ${assistant.waiting}`;
    } else if (!assistant.execute) {
      dot = "bad";
      // The breaker only trips on infra failures; it re-arms itself when the
      // park cooldown passes, so say when that is rather than looking dead.
      const retryMin = assistant.parkedUntil ? Math.max(1, Math.ceil((assistant.parkedUntil - Date.now()) / 60000)) : 0;
      text = (assistant.infraFailures ?? 0) >= 3
        ? `paused · opencode not starting${retryMin ? ` · retry ~${retryMin}m` : ""}`
        : "paused";
    } else if (!enabled) text = "off";
    else {
      // Idle is the assistant's call, not an absence of one: say what the
      // foreman decided last time it looked, so an empty card is still an
      // answer ("all slots busy", "nothing to hand out").
      dot = recentPass ? "warm" : "off";
      const foreman = assistant.foreman;
      text = foreman?.text ? `assistant · ${foreman.text.replace(/^foreman (?:done|running) · /, "")}` : `auto · ${assistant.minutes ?? 5}m`;
    }
    if (el.feedDot) el.feedDot.dataset.state = dot;
    if (el.feedState) el.feedState.textContent = text;

    if (el.feedNow) {
      let nowText;
      if (jobs.length) {
        const oldest = jobs.reduce((min, job) => Math.min(min, job.startedAt ?? Date.now()), Date.now());
        const elapsed = Math.max(0, Date.now() - oldest);
        const minutes = Math.floor(elapsed / 60000);
        const titles = jobs.slice(0, 2).map((job) => job.title ?? "task").join(" · ");
        nowText = `running${jobs.length > 1 ? ` ×${jobs.length}` : ""}: ${titles}${jobs.length > 2 ? ` +${jobs.length - 2}` : ""} · ${minutes >= 1 ? `${minutes}m` : `${Math.floor(elapsed / 1000)}s`}`;
      } else {
        nowText = assistant?.history?.[0]?.text
          ?? assistant?.lastError
          ?? state.briefing?.summary
          ?? (state.feed.length ? feedLine(state.feed[0]) : null)
          ?? (bridge ? "watching for activity" : "the feed needs the desktop app");
      }
      el.feedNow.textContent = String(nowText);
      el.feedNow.title = String(nowText);
    }

    if (el.feedQueue || el.feedDrop) {
      const queueRow = (tagText, tagClass, title, hint) => {
        const li = document.createElement("li");
        const tag = document.createElement("span");
        tag.className = tagClass;
        tag.textContent = tagText;
        const name = document.createElement("span");
        name.className = "qt";
        name.textContent = title;
        li.title = hint;
        li.append(tag, name);
        return li;
      };
      // Jobs in flight stay visible at the top of the queue — they are still
      // queued work, just already claimed.
      const jobRow = (job) => queueRow("RUNNING", "src-tag running-chip", job.title ?? "task", job.title ?? "");
      const reqRow = (request) => queueRow(requestTag(request.source), `src-tag ${request.source ?? "manual"}`, request.title ?? request.prompt ?? "request", request.prompt ?? request.title ?? "");
      const runningTitles = new Set(jobs.map((job) => String(job.title ?? "").trim().toLowerCase()).filter(Boolean));
      const queued = state.requests.filter(
        (request) =>
          request &&
          request.status !== "running" &&
          request.status !== "done" &&
          !runningTitles.has(String(request.title ?? request.prompt ?? "").trim().toLowerCase())
      );
      if (el.feedQueue) {
        el.feedQueue.textContent = "";
        for (const job of jobs) el.feedQueue.append(jobRow(job));
        for (const request of queued.slice(0, 4)) el.feedQueue.append(reqRow(request));
        if (queued.length > 4) {
          const li = document.createElement("li");
          li.className = "more";
          const link = document.createElement("button");
          link.className = "more-link";
          link.textContent = `${queued.length - 4} more queued`;
          link.title = "Show the full queue";
          link.addEventListener("click", () => setFeedMenu(true));
          li.append(link);
          el.feedQueue.append(li);
        }
      }
      if (el.feedDrop) {
        // The header dropdown lists every queued request, not the rail's cap.
        el.feedDrop.textContent = "";
        for (const job of jobs) el.feedDrop.append(jobRow(job));
        for (const request of queued) el.feedDrop.append(reqRow(request));
        if (!jobs.length && !queued.length) {
          const li = document.createElement("li");
          li.className = "more";
          li.textContent = "queue empty";
          el.feedDrop.append(li);
        }
      }
    }

    if (el.feedAgents) {
      // The whole roster, not just the executor's in-flight jobs: every agent
      // the service runs, sorted so whoever is working floats to the top.
      const rank = { running: 0, queued: 1, error: 2, done: 3, idle: 4 };
      const roster = (Array.isArray(full?.agents) ? full.agents : [])
        .slice()
        .sort((a, b) => (rank[a?.status] ?? 5) - (rank[b?.status] ?? 5));
      el.feedAgents.textContent = "";
      el.feedAgents.hidden = !roster.length;
      for (const agent of roster) {
        const status = agent.status ?? "idle";
        const li = document.createElement("li");
        li.className = `agent-${status}`;
        li.style.borderLeftColor = agentHex(agent.role);
        const tag = document.createElement("span");
        tag.className = `src-tag ${status === "error" ? "fix" : status === "running" ? "running-chip" : status === "queued" ? "improver" : "stale"}`;
        tag.textContent = status.toUpperCase();
        const name = document.createElement("b");
        name.textContent = agent.role;
        if (status !== "error") name.style.color = agentHex(agent.role);
        const text = document.createElement("span");
        text.className = "text";
        text.textContent = String((status === "error" && agent.error) || agent.text || "");
        const when = document.createElement("span");
        when.className = "when";
        when.textContent = status === "running" ? `since ${agoShort(agent.since)}` : agent.lastRunAt ? agoShort(agent.lastRunAt) : "never";
        li.title = `${agent.role} · ${status}${text.textContent ? ` — ${text.textContent}` : ""}`;
        li.append(tag, name, text, when);
        el.feedAgents.append(li);
      }
    }

    if (el.feedList) {
      el.feedList.textContent = "";
      for (const item of state.feed) {
        const li = document.createElement("li");
        li.className = `feed-row ${item.kind}`;
        const tag = document.createElement("span");
        tag.className = "feed-tag";
        tag.textContent = item.kind === "tool" ? item.tool ?? "tool" : item.kind === "run" ? "a-eyes" : item.kind;
        const body = document.createElement("span");
        body.className = "feed-text";
        body.textContent = item.kind === "tool" ? item.file ?? item.tool ?? "" : item.text ?? "";
        if ((item.count ?? 1) > 1) body.textContent += ` ×${item.count}`;
        const ago = document.createElement("span");
        ago.className = "feed-ago";
        ago.textContent = agoLabel(item.at) ?? "";
        li.title = feedLine(item);
        li.append(tag, body, ago);
        if (item.sessionId) {
          li.classList.add("link");
          li.addEventListener("click", () => {
            const node = nodeForSession(item.sessionId);
            if (!node) return;
            selectNode(node);
            focusNode(node, { zoom: 1.5 });
          });
        }
        el.feedList.append(li);
      }
    }

    if (el.feedMeta) {
      // state.tasks is already filtered to open/active by takeTasks().
      // The assistant manages this queue, so the meta line names what it last
      // did with it rather than only counting what is left.
      const foreman = assistant?.foreman;
      const dispatch = foreman?.reason ? ` · assistant: ${foreman.reason}` : foreman?.runs ? ` · assistant dispatched ${foreman.runs}×` : "";
      el.feedMeta.textContent =
        `queue ${state.requests.length} · tasks ${state.tasks.length} open · jobs ${jobs.length}/${assistant?.parallel ?? 1}${dispatch}`;
    }

    if (el.autopilotToggle) {
      el.autopilotToggle.checked = enabled;
      el.autopilotToggle.disabled = state.treeStatus !== "ok";
      const wrap = el.autopilotToggle.closest(".switch");
      if (wrap) wrap.hidden = !bridge;
    }

    // With the assistant node selected the rail swaps the activity stream for
    // the chat console; anything else brings the feed back. The right-side
    // chat log mirrors the thread whatever is selected.
    const chatting = chatMode();
    if (el.feedActivity) el.feedActivity.hidden = chatting;
    if (el.feedChat) {
      el.feedChat.hidden = !chatting;
      if (chatting) renderChat();
    }
    paintChatLog();
  }

  // The composer is a textarea that grows with the draft up to a few lines.
  function growArea(area) {
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${Math.min(120, Math.max(38, area.scrollHeight))}px`;
  }

  // The reply-is-coming bubble: a responder job in the work journal means a
  // reply is being written, so the dots go up even from a second surface.
  function replyPending(full) {
    if (state.assistantSending) return true;
    if (String(full?.thinking?.text ?? "").trim()) return true;
    const work = Array.isArray(full?.work) ? full.work : [];
    if (work.some((job) => job.kind === "responder" || job.role === "responder" || job.kind === "think" || job.role === "thinker")) return true;
    const agents = Array.isArray(full?.agents) ? full.agents : [];
    return agents.some((agent) => agent?.role === "thinker" && agent.status === "running");
  }

  function thinkingBubble(full) {
    const bubble = document.createElement("div");
    bubble.className = "assistant-msg assistant thinking";
    const live = String(full?.thinking?.text ?? "").trim();
    if (live) {
      const line = document.createElement("span");
      line.className = "thought";
      line.textContent = live;
      bubble.append(line);
    }
    const dots = document.createElement("span");
    dots.className = "dots";
    dots.setAttribute("aria-label", live ? "the assistant is thinking" : "the assistant is replying");
    dots.append(document.createElement("i"), document.createElement("i"), document.createElement("i"));
    bubble.append(dots);
    return bubble;
  }

  // The assistant console in the rail. The composer and the action buttons are
  // static elements wired once in init() — only the status line, the thread
  // and the work journal rebuild — so a half-typed draft, input focus and the
  // scroll position all survive every push.
  function renderChat() {
    const full = assistantFull();
    const summary = assistantSummary();
    const bridge = Boolean(window.mefiStudio?.assistantMessage);

    if (el.chatStatus) {
      const ai = full?.ai ?? {};
      const bits = [bridge ? summary.sublabel : "desktop app only"];
      if (full) {
        bits.push(full.status === "paused" ? "paused" : `next ${inLabel(full.nextTickAt)}`);
        bits.push(!ai.keyPresent ? "local replies" : ai.online ? "AI online" : "AI offline");
        const unread = Number(full.unread) || 0;
        if (unread) bits.push(`${unread} unread`);
      }
      el.chatStatus.textContent = bits.join(" · ");
      el.chatStatus.title = summary.detail ?? el.chatStatus.textContent;
      el.chatStatus.dataset.tone = summary.tone ?? "";
    }

    if (el.chatThread) fillThread(el.chatThread, full);

    if (el.chatInput) {
      el.chatInput.disabled = !bridge || state.assistantSending;
      const focused = full?.focus?.id ? full.focus : null;
      el.chatInput.placeholder = !bridge
        ? "desktop app only"
        : focused
          ? `Work on "${String(focused.label || focused.id).slice(0, 40)}"… (Enter)`
          : "Message the assistant… (Enter)";
      growArea(el.chatInput);
    }
    if (el.chatSend) {
      el.chatSend.disabled = !bridge || state.assistantSending;
      el.chatSend.textContent = state.assistantSending ? "Sending…" : "Send";
    }
    if (el.chatPause) {
      el.chatPause.textContent = full?.status === "paused" ? "Resume" : "Pause";
      el.chatPause.disabled = !bridge;
    }

    if (el.chatWork) {
      el.chatWork.textContent = "";
      for (const job of (Array.isArray(full?.work) ? full.work : []).slice(0, 5)) {
        const li = document.createElement("li");
        const tag = document.createElement("span");
        tag.className = `src-tag ${job.status === "queued" ? "improver" : ""}`;
        tag.textContent = String(job.kind ?? job.role ?? "job").toUpperCase();
        const text = document.createElement("span");
        text.className = "text";
        text.textContent = String(job.text ?? "");
        text.title = `${text.textContent}${job.attempts > 1 ? ` · attempt ${job.attempts}` : ""}`;
        const when = document.createElement("span");
        when.className = "when";
        when.textContent = job.status === "queued" ? "queued" : `started ${agoShort(job.startedAt)}`;
        li.append(tag, text, when);
        el.chatWork.append(li);
      }
    }

    // Replies read here count as seen, the same as the Explorer thread: main
    // zeroes unread and pushes the state back.
    const unread = Number(full?.unread) || 0;
    if (bridge && unread > 0 && window.mefiStudio?.assistantControl && Date.now() - state.seenAt > 5000) {
      state.seenAt = Date.now();
      window.mefiStudio
        .assistantControl("seen")
        .then((result) => {
          if (result?.ok && result.state) {
            window.MefiTree?.applyAssistant?.({ state: result.state });
            refreshAssistantCache();
            updateAssistantPill();
            renderInfo();
          }
        })
        .catch(() => {});
    }
  }

  // Seconds matter for a heartbeat and a tick timer; minutes do not.
  function agoShort(at) {
    if (!at) return "never";
    const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
    return `${Math.round(seconds / 3600)}h ago`;
  }

  function inLabel(at) {
    if (!at) return "—";
    const seconds = Math.round((at - Date.now()) / 1000);
    if (seconds <= 0) return "due";
    return seconds < 60 ? `in ${seconds}s` : `in ${Math.round(seconds / 60)}m`;
  }

  // ---------- activity -> world ----------
  function focusOn(node) {
    state.camera.tx = -node.x;
    state.camera.ty = -node.y;
    state.camera.tz = -node.z;
  }

  function focusNode(node, { zoom } = {}) {
    if (!node) return;
    // Every focusNode call is a user decision (a click, a search hit, keyboard
    // navigation, a card link) — the camera belongs to them from here on.
    setCamMode("free", { quiet: true });
    focusOn(node);
    if (zoom) setZoom(Math.max(state.zoom, zoom));
  }

  function onActivity(data) {
    if (!state.active) return;
    const now = Date.now();
    for (const item of data.activity ?? []) {
      pushFeed({ id: item.id, at: item.time, kind: "tool", tool: item.tool, file: basename(item.file), sessionId: item.sessionId });
      const session = nodeForSession(item.sessionId);
      if (!session) continue;
      const touch = state.touches.get(item.sessionId) ?? { count: 0, at: now };
      touch.count += 1;
      touch.at = now;
      state.touches.set(item.sessionId, touch);
      state.lastTouch = now;
      // Only follow mode chases live activity; orbit and free keep their frame.
      if (state.camMode === "follow") focusOn(session);

      if (TASK_TOOLS.has(item.tool)) {
        const target = state.nodes.find((node) => node.sessionId === item.sessionId && node.kind === "todo") ?? session;
        state.pulses.push({ from: session, to: target, start: now, duration: 1400 });
        if (state.pulses.length > 24) state.pulses.shift();
        bell({ long: item.tool === "patch", level: 0.9 });
      } else {
        // external work (reads, greps, fetches) vaporizes into blue-white dust
        spawnParticles(session, item.tool === "websearch" || item.tool === "webfetch" ? 18 : 10);
        bell({ quick: true, level: 0.6 });
      }
    }
    if (data.todos) refreshGraph();
  }

  function spawnParticles(node, count, { gold = false, tint = null } = {}) {
    const projected = project(node);
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.4 + Math.random() * 1.6;
      state.particles.push({
        x: projected.x,
        y: projected.y,
        vx: Math.cos(angle) * speed * (gold ? 8 : 14),
        vy: Math.sin(angle) * speed * (gold ? 8 : 14) - 8,
        life: 1,
        decay: gold ? 0.02 + Math.random() * 0.02 : 0.006 + Math.random() * 0.012,
        size: gold ? 1 + Math.random() * 1.4 : 1.2 + Math.random() * 2.6,
        blue: Math.random() > 0.45 && !gold,
        gold,
        // "r,g,b" when the specks should carry an agent's role colour
        tint: tint ? tint.join(",") : null,
      });
    }
    if (state.particles.length > 600) state.particles.splice(0, state.particles.length - 600);
  }

  // The tree runs the agents' flights; this surface draws them with its own
  // projection. Positions come in every frame, the counters say when to pulse,
  // spark, or fire the bright "done" pulse — each rendered here exactly once.
  function syncAgentMotion(now) {
    const live = window.MefiTree?.agentPositions?.();
    if (!live) return;
    const hub = assistantNode();
    for (const node of state.nodes) {
      if (node.kind !== "agent" || node.dying) continue; // ghosts keep their own flight
      if (node.builder) {
        // No motion entry for a builder — it belongs to the executor, not the
        // roster — so it circles its anchor here. A builder on its work orbits
        // tightly; one with nowhere to sit drifts the wide ring, slower, so the
        // two read differently at a glance.
        const anchor = node.hostId ? state.nodes.find((entry) => entry.id === node.hostId) : null;
        if (anchor) {
          const radius = node.radius ?? BUILDER_ORBIT;
          const speed = node.onHost ? 2600 : 7200;
          const angle = node.orbit + (noMotion() ? 0 : now / speed);
          node.x = anchor.x + Math.cos(angle) * radius;
          node.y = anchor.y - (node.lift ?? 8) + (noMotion() ? 0 : Math.sin(now / 1400 + node.orbit) * 2);
          node.z = anchor.z + Math.sin(angle) * radius;
          node.targetNode = anchor;
        }
        // Three builders all labelled "building · 14m" said nothing. The title is
        // what distinguishes them; the clock rides along behind it.
        const seconds = node.startedAt ? Math.max(0, Math.round((Date.now() - node.startedAt) / 1000)) : 0;
        const elapsed = seconds < 90 ? `${seconds}s` : `${Math.round(seconds / 60)}m`;
        const title = String(node.text ?? "").replace(/^Work on\s+/i, "").replace(/^["']|["']$/g, "").trim();
        node.label = title ? `${title} · ${elapsed}` : `building · ${elapsed}`;
        continue;
      }
      const motion = live[node.role];
      if (!motion) continue;
      node.x = motion.x;
      node.y = motion.y;
      node.z = motion.z;
      node.phase = motion.phase;
      node.targetId = motion.targetId;
      const travelling = motion.phase === "flying" || motion.phase === "hovering";
      const target = travelling && motion.targetId ? state.nodes.find((entry) => entry.id === motion.targetId) ?? null : null;
      node.targetNode = target;
      node.label = travelling ? `${node.role} · ${target?.label ?? motion.targetLabel ?? "…"}` : node.role;
      const seen = state.agentSeq[node.role] ?? { pulse: motion.pulseSeq, spark: motion.sparkSeq, done: motion.doneSeq };
      if (motion.pulseSeq > seen.pulse && target) {
        const tint = agentHex(node.role);
        state.pulses.push({ from: node, to: target, start: now, duration: 320, color: tint, glow: tint, small: true, wave: true });
        if (state.pulses.length > 24) state.pulses.shift();
      }
      if (motion.sparkSeq > seen.spark && travelling && !noMotion()) spawnParticles(node, 3, { gold: true, tint: agentRgb(node.role) });
      if (motion.doneSeq > seen.done && hub) {
        const from = motion.lastTargetId ? state.nodes.find((entry) => entry.id === motion.lastTargetId) : null;
        state.pulses.push({ from: from ?? node, to: hub, start: now, duration: 700, color: "#fff2cc", glow: "#f1dcae", wave: true });
      }
      state.agentSeq[node.role] = { pulse: motion.pulseSeq, spark: motion.sparkSeq, done: motion.doneSeq };
    }
  }

  // ---------- evidence popups ----------
  async function loadPngs() {
    try {
      const result = await window.mefiStudio?.eyesState?.();
      state.pngs = result?.pngs?.map((png) => png.path) ?? [];
    } catch {
      state.pngs = [];
    }
  }

  function popup(force = false) {
    if (!state.pngs.length || state.popups.length >= 1) return;
    if (!force && !state.ambient) return;
    if (noMotion()) return;
    const path = state.pngs[Math.floor(Math.random() * state.pngs.length)];
    const image = document.createElement("img");
    image.className = "idle-pop";
    image.src = encodeURI("file:///" + path.replace(/\\/g, "/"));
    image.style.setProperty("--x", `${(10 + Math.random() * 62).toFixed(2)}%`);
    image.style.setProperty("--y", `${(12 + Math.random() * 58).toFixed(2)}%`);
    image.style.setProperty("--tilt", `${(Math.random() * 10 - 5).toFixed(1)}deg`);
    el.hud.parentElement.append(image);
    state.popups.push({ image, at: Date.now() });
    setTimeout(() => {
      image.classList.add("fade");
      setTimeout(() => image.remove(), 1800);
      state.popups = state.popups.filter((popup) => popup.image !== image);
    }, 7000);
  }

  // ---------- render ----------
  function orbitTarget(energy) {
    if (state.view === "2d") return 0; // the flat map does not revolve
    if (noMotion() || state.orbit === "paused") return 0;
    // Only a real gesture holds the orbit: a drag in progress, a selection or
    // a search. The pointer resting on the canvas is not one.
    if (state.panning || state.rotating) return 0;
    if (state.selected || state.query) return 0;
    if (Date.now() < state.settleUntil) return 0;
    return ORBIT_BASE + energy * ORBIT_ENERGY;
  }

  function computeBranch() {
    const node = state.selected?.node;
    if (!node) {
      state.branch = null;
      return;
    }
    if (node.kind === "session") state.branch = node.id;
    else if (node.kind === "todo") state.branch = node.sessionId ?? null;
    else if (node.kind === "task") state.branch = node.anchorSessionId ?? null;
    else state.branch = null;
  }

  // One multiplier per node/edge per frame: dim what the query or the selected
  // branch is not about.
  function emphasis(node) {
    if (state.query) return state.matchSet.has(node.id) ? 1 : 0.25;
    if (!state.branch) return 1;
    const sid = node.sessionId ?? node.anchorSessionId ?? node.id;
    if (sid === state.branch) return node.kind === "todo" ? 1.15 : 1;
    return 0.55;
  }

  // The circle a node's children ride, traced point by point through project()
  // so the ring carries the same tilt and perspective as the nodes on it.
  function traceRing(ctx, node, radius, yOffset = 0) {
    ctx.beginPath();
    const SEGMENTS = 44;
    for (let index = 0; index <= SEGMENTS; index += 1) {
      const t = (index / SEGMENTS) * Math.PI * 2;
      const p = project({ x: node.x + Math.cos(t) * radius, y: node.y + yOffset, z: node.z + Math.sin(t) * radius });
      if (index === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
  }

  let lastFrameAt = 0;
  function frame(time) {
    if (!state.active) return;
    if (document.body.dataset.sheet) {
      requestAnimationFrame(frame);
      return;
    }
    if (!document.hidden && time - lastFrameAt >= 33) {
      lastFrameAt = time;
      try {
        drawFrame(time);
      } catch (error) {
        if (!state.frameError) {
          state.frameError = true;
          console.error("[idle]", error?.message ?? error);
        }
      }
    }
    requestAnimationFrame(frame);
  }

  function drawFrame(time) {
    if (!state.lastFrame) state.lastFrame = time;
    const still = noMotion();
    const energy = audioEnergy();
    // Nodes the assistant has been told to work on (Work on it): pinned board
    // tasks plus pinned, still-queued inbox requests. One set per frame.
    const pinnedIds = workPinIds();
    const target = orbitTarget(energy);
    state.orbitVel += (target - state.orbitVel) * ORBIT_EASE;
    if (still) state.orbitVel = 0;
    state.angle += state.orbitVel;
    if (still) {
      state.camera.x = state.camera.tx;
      state.camera.y = state.camera.ty;
      state.camera.z = state.camera.tz;
    } else {
      state.camera.x += (state.camera.tx - state.camera.x) * CAMERA_EASE;
      state.camera.y += (state.camera.ty - state.camera.y) * CAMERA_EASE;
      state.camera.z += (state.camera.tz - state.camera.z) * CAMERA_EASE;
    }

    const { ctx } = el;
    ctx.clearRect(0, 0, el.width, el.height);

    // backdrop: near-black with a faint indigo cast — flat black read as dead
    // space behind the constellation
    const sky = ctx.createLinearGradient(0, 0, 0, el.height);
    sky.addColorStop(0, "#070912");
    sky.addColorStop(0.55, "#04050a");
    sky.addColorStop(1, "#030304");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, el.width, el.height);

    // nebulae: a cool wash up in a corner and a warm one low right, breathing
    // on a slow cycle and pinned to the sky rather than the camera
    const breathe = still ? 0.5 : (Math.sin(time / 14000) + 1) / 2;
    const nebula = (x, y, r, color, alpha) => {
      const wash = ctx.createRadialGradient(x, y, 0, x, y, r);
      wash.addColorStop(0, `rgba(${color},${alpha})`);
      wash.addColorStop(1, `rgba(${color},0)`);
      ctx.fillStyle = wash;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    };
    const diagonal = Math.hypot(el.width, el.height);
    nebula(el.width * 0.2, el.height * 0.14, diagonal * 0.4, "86,100,180", 0.05 + breathe * 0.02);
    nebula(el.width * 0.86, el.height * 0.84, diagonal * 0.34, "150,110,60", 0.03 + (still ? 0 : (1 - breathe) * 0.012));

    // starfield: three depth bands wheeling at a fraction of the orbit rate,
    // so the sky drifts against the constellation; sizes and tones vary, and
    // the brightest band carries a small cross flare
    for (const layer of STAR_LAYERS) {
      const turn = state.angle * layer.spin;
      const cos = Math.cos(turn);
      const sin = Math.sin(turn);
      const cx = el.width / 2;
      const cy = el.height / 2;
      for (let index = 0; index < layer.count; index += 1) {
        const seed = layer.seed + index * 127.1;
        const sx = (Math.sin(seed) * 0.5 + 0.5) * (el.width + 200) - 100;
        const sy = (Math.cos(seed * 1.7) * 0.5 + 0.5) * (el.height + 200) - 100;
        const x = cx + (sx - cx) * cos - (sy - cy) * sin;
        const y = cy + (sx - cx) * sin + (sy - cy) * cos;
        const twinkle = still
          ? layer.alpha * (0.35 + 0.5 * Math.abs(Math.sin(index * 1.31)))
          : layer.alpha * (0.3 + 0.7 * Math.abs(Math.sin(time / layer.tempo + index * 1.31)));
        ctx.globalAlpha = Math.min(1, twinkle * (0.55 + energy * 0.3 + state.bands.treble * 0.5));
        const tone = Math.sin(seed * 3.3);
        ctx.fillStyle = tone > 0.55 ? "#aebfff" : tone < -0.82 ? "#f0d9a8" : "#ece5d8";
        const size = layer.size * (0.8 + 0.4 * Math.abs(Math.sin(seed * 5.1)));
        ctx.fillRect(x, y, size, size);
        if (layer.flare) {
          ctx.globalAlpha *= 0.4;
          ctx.fillRect(x - size * 2, y - 0.5, size * 4, 1);
          ctx.fillRect(x - 0.5, y - size * 2, 1, size * 4);
        }
      }
    }
    ctx.globalAlpha = 1;

    // a soft ember where the constellation's mass sits — the world origin is
    // projected so the glow pans and zooms with the graph, not the window
    const core = project({ x: 0, y: -10, z: 0 });
    const coreR = diagonal * 0.42;
    const coreGlow = ctx.createRadialGradient(core.x, core.y, 0, core.x, core.y, coreR);
    coreGlow.addColorStop(0, `rgba(201,168,106,${0.05 + energy * 0.02 + state.bands.bass * 0.02})`);
    coreGlow.addColorStop(0.45, "rgba(130,112,84,0.022)");
    coreGlow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = coreGlow;
    ctx.fillRect(core.x - coreR, core.y - coreR, coreR * 2, coreR * 2);

    // vignette: the constellation sits in the middle of the frame, the edges fall away
    const outer = diagonal / 2;
    const vignette = ctx.createRadialGradient(el.width / 2, el.height / 2, outer * 0.45, el.width / 2, el.height / 2, outer);
    vignette.addColorStop(0, "rgba(3,3,6,0)");
    vignette.addColorStop(1, "rgba(2,2,6,0.6)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, el.width, el.height);

    syncAgentMotion(Date.now());
    stepFx(Date.now());
    stepDoneHold(Date.now());
    const projected = state.nodes.map((node) => ({ node, p: project(node) }));
    computeBranch();

    // orbit paths: hairline rings where children actually circle — todos ring
    // their session at r=46 (+34 below it), the agents ring the assistant at
    // r=34, and the sessions ride r=120 around the root
    {
      const root = rootNode();
      if (root) {
        traceRing(ctx, root, 120, 40); // session y wobbles ±30 around y=0
        ctx.strokeStyle = `rgba(201,168,106,${0.08 * (state.query ? 0.5 : 1)})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      const hub = assistantNode();
      if (hub && state.nodes.some((node) => node.kind === "agent")) {
        traceRing(ctx, hub, 34);
        ctx.strokeStyle = `rgba(230,201,141,${0.12 * emphasis(hub)})`;
        ctx.stroke();
      }
      for (const { node } of projected) {
        if (node.kind !== "session" || node.stale) continue;
        if (!state.nodes.some((entry) => entry.kind === "todo" && entry.sessionId === node.id)) continue;
        const { fresh } = nodeState(node);
        traceRing(ctx, node, 46, 34);
        ctx.strokeStyle = `rgba(201,168,106,${(0.08 + fresh * 0.12) * emphasis(node)})`;
        ctx.stroke();
      }
    }

    // edges (stems): hairlines that carry the tree shape — root → session and
    // root → assistant trunks are a touch heavier so the skeleton reads first,
    // brightness climbs along recently touched paths
    for (const edge of state.edges) {
      const a = projected[edge.a];
      const b = projected[edge.b];
      if (!a || !b || a.node._absorbed || b.node._absorbed) continue;
      const sessionId = edge.sessionId ?? b.node.sessionId;
      const { touch, fresh } = nodeState(b.node);
      const factor = emphasis(b.node);
      // The far side of the orbit fades — depth runs ~500 near to ~1300 far.
      const depthFade = 1 - Math.min(1, Math.max(0, ((a.p.depth + b.p.depth) / 2 - 640) / 700)) * 0.42;
      const trunk = b.node.kind === "session" || b.node.kind === "assistant" || b.node.kind === "folded";
      const base = (0.19 + energy * 0.05 + state.bands.mid * 0.09 + (state.view === "2d" ? 0.05 : 0)) * factor * depthFade * (trunk ? 1.2 : 1);
      const glow = fresh * Math.min(1, (touch?.count ?? 0) / 4) * 0.8 * factor;
      // A selection lights its branch through state.branch; a hover does the
      // same through the hovered node's own session so edges answer the cursor.
      const hoverBranch = state.hoverNode
        ? state.hoverNode.sessionId ?? state.hoverNode.anchorSessionId ?? state.hoverNode.id
        : null;
      const inBranch = !state.query && ((state.branch && sessionId === state.branch) || (hoverBranch && sessionId === hoverBranch));
      const gradient = ctx.createLinearGradient(a.p.x, a.p.y, b.p.x, b.p.y);
      gradient.addColorStop(0, `rgba(236,229,216,${base})`);
      gradient.addColorStop(
        1,
        inBranch
          ? `rgba(230,201,141,${Math.min(1, base + glow + 0.32)})`
          : `rgba(${fresh > 0.4 ? "230,201,141" : "180,170,150"},${base + glow})`
      );
      ctx.strokeStyle = gradient;
      ctx.lineWidth = (trunk ? 1.4 : 1) + glow * 2.2;
      ctx.beginPath();
      ctx.moveTo(a.p.x, a.p.y);
      ctx.lineTo(b.p.x, b.p.y);
      ctx.stroke();
    }

    // tethers: a travelling agent stays tied to the node it works on
    for (const { node, p } of projected) {
      if (node.kind !== "agent" || !node.targetNode) continue;
      const target = projected.find((entry) => entry.node === node.targetNode);
      if (!target) continue;
      const tint = agentRgb(node.role).join(",");
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.lineDashOffset = still ? 0 : -((time / 40) % 8);
      ctx.strokeStyle = `rgba(${tint},0.55)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(target.p.x, target.p.y);
      ctx.stroke();
      ctx.restore();
      const glow = ctx.createRadialGradient(target.p.x, target.p.y, 0, target.p.x, target.p.y, 8);
      glow.addColorStop(0, `rgba(${tint},0.9)`);
      glow.addColorStop(1, `rgba(${tint},0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(target.p.x, target.p.y, 8, 0, Math.PI * 2);
      ctx.fill();
    }

    // Hot paths get marching ants: dashes flow parent -> child, the direction
    // of work. A path is hot while its session was touched in the last 90 s or
    // the autopilot is running on it.
    {
      const runningIds = autopilotBusyIds(state.assistant);
      ctx.setLineDash([3, 7]);
      ctx.lineDashOffset = -(time / 60);
      ctx.lineWidth = 1.2;
      for (const edge of state.edges) {
        const a = projected[edge.a];
        const b = projected[edge.b];
        if (!a || !b || a.node._absorbed || b.node._absorbed) continue;
        const { fresh } = nodeState(b.node);
        const hot = fresh > 0.15 || isBusyNode(b.node, runningIds);
        if (!hot) continue;
        ctx.beginPath();
        ctx.moveTo(a.p.x, a.p.y);
        ctx.lineTo(b.p.x, b.p.y);
        ctx.strokeStyle = `rgba(230,201,141,${0.25 + fresh * 0.45})`;
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }

    // pulses: bright travelling dots on the working path — a line that ends
    // at an agent carries the signal itself instead (wave, see surgeLine)
    const now = Date.now();
    state.pulses = state.pulses.filter((pulse) => now - pulse.start < pulse.duration);
    for (const pulse of state.pulses) {
      const from = project(pulse.from);
      const to = project(pulse.to);
      const t = still ? 1 : Math.min(1, (now - pulse.start) / pulse.duration);
      if (pulse.wave) {
        surgeLine(ctx, from, to, t, pulse, still);
        continue;
      }
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      // a short comet tail behind the head, fading to nothing
      if (!still && t > 0.02) {
        const tailT = Math.max(0, t - 0.18);
        const tx = from.x + (to.x - from.x) * tailT;
        const ty = from.y + (to.y - from.y) * tailT;
        const [pr, pg, pb] = hexToRgb(pulse.color ?? "#a9ffcd");
        const trail = ctx.createLinearGradient(tx, ty, x, y);
        trail.addColorStop(0, `rgba(${pr},${pg},${pb},0)`);
        trail.addColorStop(1, `rgba(${pr},${pg},${pb},0.55)`);
        ctx.strokeStyle = trail;
        ctx.lineWidth = pulse.small ? 1.4 : 2.4;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(x, y, pulse.small ? 2.4 : 4 + energy * 3 + state.bands.bass * 5, 0, Math.PI * 2);
      ctx.fillStyle = pulse.color ?? "#a9ffcd";
      if (!still) {
        ctx.shadowColor = pulse.glow ?? "#57ff9a";
        ctx.shadowBlur = 22;
      }
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.lineCap = "butt";
    if (still) state.pulses = [];

    // particles: vaporized external work
    state.particles = state.particles.filter((particle) => particle.life > 0);
    const dt = still ? 0 : 0.016;
    for (const particle of state.particles) {
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vy += 6 * dt;
      particle.life -= still ? 0 : particle.decay;
      const life = Math.max(0, particle.life);
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, Math.max(0, particle.size * life), 0, Math.PI * 2);
      ctx.fillStyle = particle.tint ? `rgba(${particle.tint},${life * 0.9})` : particle.gold ? `rgba(241,220,174,${life * 0.9})` : particle.blue ? `rgba(157,183,255,${life * 0.85})` : `rgba(255,255,255,${life * 0.8})`;
      if (!still) {
        ctx.shadowColor = particle.tint ? `rgb(${particle.tint})` : particle.gold ? "#e6c98d" : particle.blue ? "#9db7ff" : "#ffffff";
        ctx.shadowBlur = 10;
      }
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    if (still) state.particles = [];

    // nodes: white-hot hubs, gold activity, green completions
    const ordered = [...projected].sort((a, b) => b.p.depth - a.p.depth);
    const assistantRing = assistantTone();
    for (const { node, p } of ordered) {
      if (node._absorbed) continue;
      const nodeScale = node._scale ?? 1;
      if (nodeScale <= 0.02) continue;
      const { touch, fresh } = nodeState(node);
      let [red, green, blue] = colorOf(node);
      if (node.kind === "task" && node.color) [red, green, blue] = hexToRgb(node.color);
      const hold = node.doneHold ? state.doneHold.get(node.id) ?? null : null;
      if (hold) [red, green, blue] = NODE_RGB.done; // finished work reads green while it waits to be read
      const isSession = node.kind === "session" || node.kind === "root";
      const isAssistant = node.kind === "assistant";
      const isFolded = node.kind === "folded";
      const isAgent = node.kind === "agent";
      if (isSession) {
        // hubs warm from ivory toward gold as they are touched
        const warm = Math.min(1, fresh * 0.8 + (touch?.count ?? 0) * 0.12);
        red = Math.round(236 + (230 - 236) * warm);
        green = Math.round(229 + (201 - 229) * warm);
        blue = Math.round(216 + (141 - 216) * warm);
      }
      const factor = emphasis(node);
      const boost = 1 + Math.min(0.9, (touch?.count ?? 0) * 0.16) * fresh;
      const softness = Math.min(1, Math.max(0, (p.depth - 420) / 620));
      const baseR = (node.kind === "root" ? 2.9 : node.kind === "task" || isAssistant || isFolded ? 2.6 : isSession ? 2.5 : isAgent && node.status === "running" ? 2.2 : 1.9) * node.r * p.k;
      // A running agent swells like an in-progress todo.
      const agentBeat = isAgent && node.status === "running" && !still ? 1 + Math.sin(time / 260) * 0.14 : 1;
      // A finished task under its grace breathes on its own rhythm.
      const doneBeat = hold && !hold.ackedAt && !still ? 1 + Math.sin(time / 300) * 0.12 : 1;
      // Audio and touch swell the hub gently: at full energy the old factors
      // doubled the halo and the cluster fused into one bloom.
      const radius = Math.max(0.4, baseR * boost * (1 + energy * 0.08 + state.bands.bass * 0.12) * agentBeat * doneBeat * nodeScale);
      // A stale session is still there, at less than half strength; an agent is
      // as bright as its status.
      const agentGlow = !isAgent ? 1 : node.status === "running" ? 1 : node.status === "error" ? 0.9 : node.status === "queued" ? 0.7 : node.status === "done" ? 0.55 : 0.45;
      const alpha = (0.45 + 0.4 * Math.min(1, (isAssistant ? 1 : fresh) + 0.25)) * (1 - softness * 0.42) * factor * (node.stale ? 0.5 : 1) * agentGlow * (node._fade ?? 1);
      glowNode(ctx, p.x, p.y, radius, `${red},${green},${blue}`, {
        alpha,
        spread: (state.view === "2d" ? 3.1 : 3.4) + softness * 0.8,
        white: (isAssistant ? 0.9 : isSession ? 0.75 : node.kind === "task" || isFolded ? 0.6 : isAgent ? 0.4 * agentGlow : 0.45) * (factor < 1 || node.stale ? 0.4 : 1),
      });
      node._px = p.x;
      node._py = p.y;
      node._pr = radius;
      // A hairline rim in the node's own colour separates the hub from its
      // halo, so the ring language (task colour, selection, focus) sits on a
      // crisp edge instead of dissolving into glow.
      if (isSession || isAssistant) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius + 1.2, 0, Math.PI * 2);
        ctx.strokeStyle = rgba([red, green, blue], 0.5 * factor * (node._fade ?? 1));
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      if (node.kind === "root") {
        // the anchor of the whole tree: a quiet gold collar, always visible
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius + 2.5, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(NODE_RGB.warm, 0.45 * factor);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      if (isAssistant) {
        // Gold and breathing while the service runs, still and grey when it is
        // paused, amber when the tone asks for attention.
        const { tone, running } = assistantRing;
        const breath = running && !still ? (Math.sin(time / 900) + 1) / 2 : 0.5;
        const ring = tone === "warn" || tone === "offline" ? NODE_RGB.amber : !running || tone === "paused" ? NODE_RGB.pending : NODE_RGB.assistant;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius + 5 + breath * 4, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(ring, (running ? 0.4 + breath * 0.45 : 0.6) * factor);
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
      if (isAgent && node.status === "running" && !node.dying) {
        // A running agent breathes a ring in its role colour, so the crew that
        // is actually working can be spotted across the constellation.
        const breath = still ? 0.5 : (Math.sin(time / 700) + 1) / 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius + 4 + breath * 3, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(agentRgb(node.role), (0.3 + breath * 0.4) * factor);
        ctx.lineWidth = 1.1;
        ctx.stroke();
      }
      if (isFolded) {
        for (const [gap, ringAlpha] of [[3.5, 0.55], [7, 0.3]]) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, radius + gap, 0, Math.PI * 2);
          ctx.strokeStyle = rgba(NODE_RGB.done, ringAlpha * factor);
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
      if (node.kind === "task") {
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius + 3.5, 0, Math.PI * 2);
        // the ring carries the status too: an active task wears it bright, an
        // open one waits dimmer, finished work turns the whole node green
        ctx.strokeStyle = `${node.color}${node.task?.status === "active" ? "cc" : "77"}`;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      if (hold) {
        // The finished pulse: a breathing green ring — calm once the node has
        // been read, then only a short beat before it sinks in.
        const breath = still ? 0.5 : (Math.sin(time / 480) + 1) / 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius + 4 + breath * 4, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(NODE_RGB.done, (hold.ackedAt ? 0.22 + breath * 0.12 : 0.34 + breath * 0.4) * factor);
        ctx.lineWidth = 1.3;
        ctx.stroke();
        if (!hold.ackedAt) {
          // The "!" of a finished task, rocking next to the node — click it
          // (or the node) to read the work before it is absorbed.
          const bx = p.x + node._pr + 12;
          const by = p.y - node._pr - 12;
          ctx.save();
          ctx.translate(bx, by);
          if (!still) ctx.rotate(Math.sin(time / 110) * 0.3);
          ctx.beginPath();
          ctx.arc(0, 0, 7.5, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(7,10,8,0.94)";
          ctx.fill();
          ctx.strokeStyle = rgba(NODE_RGB.done, 0.85);
          ctx.lineWidth = 1.4;
          ctx.stroke();
          ctx.fillStyle = "#b8ffd9";
          ctx.font = '700 10px system-ui, "Segoe UI", sans-serif';
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("!", 0, 0.5);
          ctx.restore();
          node._excl = { x: bx, y: by, r: 11 };
        } else node._excl = null;
      } else if (node._excl) node._excl = null;
      if (node.kind === "session" && fresh > 0.5) {
        // A live session breathes sonar rings; a still frame keeps one circle.
        if (still) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, radius * 2.1, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(87,255,154,${fresh * 0.45})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        } else {
          for (const phase of [0, 0.5]) {
            const cycle = ((time / 1600 + phase) % 1 + 1) % 1;
            ctx.beginPath();
            ctx.arc(p.x, p.y, radius * (1.3 + cycle * 2.2), 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(87,255,154,${fresh * 0.4 * (1 - cycle)})`;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }
      if (state.query && state.matchSet.has(node.id)) {
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius + 6, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(230,201,141,0.85)";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (state.hoverNode === node) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius + 6, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(236,229,216,0.55)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      if (state.selected?.id === node.id) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius + 8, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(230,201,141,0.95)";
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius + 14, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(201,168,106,0.28)";
        ctx.lineWidth = 6;
        ctx.stroke();
        ctx.lineWidth = 1;
      }
      // Each autopilot session wears a rotating dashed gold ring so it can be
      // spotted working from across the constellation; its hub is labelled.
      const runningIds = autopilotBusyIds(state.assistant);
      if (isBusyNode(node, runningIds)) {
        ctx.setLineDash([4, 5]);
        ctx.lineDashOffset = -(time / 45);
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius + 10, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(230,201,141,0.7)";
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
        if (node.kind === "session" && runningIds.has(node.id)) {
          ctx.font = LABEL_FONT_ROOT;
          ctx.textAlign = "center";
          ctx.fillStyle = "rgba(230,201,141,0.7)";
          ctx.fillText("A-EYES", p.x, p.y - radius - 14);
        }
      }
      // Work on it: a blue circle with a comet trail looping the node. Slow
      // drift while the ask sits queued, quick loop once the executor holds
      // it; the ring stops when the work finishes — the pin goes with the
      // task, the request leaves the queue, and the run's node ages out.
      const nodeIds = [String(node.id ?? ""), String(node.sessionId ?? ""), String(node.task?.id ?? "")].filter(Boolean);
      const pinQueued = nodeIds.some((id) => pinnedIds.has(id));
      const pinRunning = !pinQueued && nodeIds.some((id) => runningIds.has(id)) && nodeIds.some((id) => state.workPinSeen?.has(id));
      if (pinQueued || pinRunning) {
        const ringRadius = radius + 13;
        ctx.beginPath();
        ctx.arc(p.x, p.y, ringRadius, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(125,178,255,0.22)";
        ctx.lineWidth = 1.2;
        ctx.stroke();
        // The comet: three fading arcs chasing one head around the circle —
        // fast once the executor actually holds this node, drifting while it
        // waits.
        const period = nodeIds.some((id) => runningIds.has(id)) ? 1100 : 2400;
        const head = still ? Math.PI / 3 : ((time % period) / period) * Math.PI * 2;
        for (let i = 0; i < 3; i += 1) {
          const a1 = head - i * 0.62;
          const a0 = a1 - 0.62;
          ctx.beginPath();
          ctx.arc(p.x, p.y, ringRadius, a0, a1);
          ctx.strokeStyle = `rgba(125,178,255,${0.9 - i * 0.27})`;
          ctx.lineWidth = 2.6 - i * 0.6;
          ctx.stroke();
        }
        if (node.kind !== "task" || state.labels !== "none") {
          ctx.font = LABEL_FONT_ROOT;
          ctx.textAlign = "center";
          ctx.fillStyle = "rgba(125,178,255,0.8)";
          ctx.fillText("NEXT", p.x, p.y - ringRadius - 6);
        }
      }
      // Work-left meter: a slim bar under anything with a known fraction —
      // sessions by their todos, the assistant by the whole board, agents by
      // their own progress. The empty track is the work still to do; a full
      // green bar says none of it is.
      const meter = !node.dying && typeof node.progress === "number" && Number.isFinite(node.progress) ? Math.min(1, Math.max(0, node.progress)) : null;
      if (meter != null) {
        const trackW = Math.max(14, Math.min(30, radius * 4.5));
        const trackH = 2.4;
        const mx = p.x - trackW / 2;
        const my = p.y + radius + 5;
        ctx.globalAlpha = 0.8 * factor;
        ctx.fillStyle = "rgba(236,229,216,0.16)";
        ctx.beginPath();
        ctx.roundRect(mx, my, trackW, trackH, trackH / 2);
        ctx.fill();
        if (meter > 0) {
          ctx.fillStyle = meter >= 1 ? rgba(NODE_RGB.done, 0.95) : `rgba(${red},${green},${blue},0.95)`;
          ctx.beginPath();
          ctx.roundRect(mx, my, Math.max(trackH, trackW * meter), trackH, trackH / 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    }

    // checkpoint bubbles: gold message icons floating off session nodes
    for (const { node, p } of projected) {
      if (node.kind !== "session" || !node._pr) continue;
      const notes = state.checkpoints?.[node.id];
      if (!notes?.length) continue;
      const scale = Math.max(0.6, Math.min(1.5, p.k * 1.5));
      const bx = p.x + node._pr + 7 * scale;
      const by = p.y - node._pr - 17 * scale;
      drawBubble(ctx, bx, by, scale, 0.92);
      node._bubble = { x: bx, y: by, w: 15 * scale, h: 15 * scale, node };
    }

    // collision partners glow brighter: multiple agents on one path
    if (state.collisionSessions?.size) {
      for (const { node, p } of projected) {
        if (!state.collisionSessions.has(node.sessionId)) continue;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 22 + energy * 8 + state.bands.bass * 8, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,212,121,0.22)";
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }

    // While the autopilot runs, each of its sessions exhales a slow trickle
    // of dust.
    if (time - state.lastTrickle > 900) {
      const busy = autopilotBusyIds(state.assistant);
      if (busy.size) {
        state.lastTrickle = time;
        for (const id of busy) {
          const runningNode =
            nodeForSession(id) ?? state.nodes.find((node) => node.sessionId === id || node.id === id || node.task?.id === id);
          if (runningNode) spawnParticles(runningNode, 3);
        }
      }
    }

    drawLabels(projected);
  }

  // ---------- labels ----------
  function measure(ctx, font, text) {
    const key = `${font}|${text}`;
    let width = state.labelWidths.get(key);
    if (width == null) {
      if (state.labelWidths.size > LABEL_CACHE_MAX) state.labelWidths.clear();
      ctx.font = font;
      width = ctx.measureText(text).width;
      state.labelWidths.set(key, width);
    }
    return width;
  }

  function fontFor(node) {
    if (node.kind === "session" || node.kind === "assistant") return LABEL_FONT;
    if (node.kind === "task" || node.kind === "folded") return LABEL_FONT_TASK;
    if (node.kind === "root") return LABEL_FONT_ROOT;
    if (node.kind === "agent") return LABEL_FONT_AGENT;
    return LABEL_FONT_TODO;
  }

  function labelColour(node, alpha) {
    if (node.kind === "session") return `rgba(236,229,216,${node.stale ? alpha * 0.6 : alpha})`;
    if (node.kind === "root") return `rgba(201,168,106,${alpha})`;
    if (node.kind === "assistant") return rgba(NODE_RGB.assistant, alpha);
    if (node.kind === "folded") return rgba(NODE_RGB.done, alpha * 0.85);
    if (node.kind === "agent") return rgba(colorOf(node), node.status === "running" || node.status === "error" ? alpha : alpha * 0.7);
    if (node.kind === "task") {
      const [red, green, blue] = node.color ? hexToRgb(node.color) : NODE_RGB.task;
      return `rgba(${red},${green},${blue},${alpha})`;
    }
    return `rgba(154,143,125,${alpha})`;
  }

  function labelText(ctx, node, font) {
    // a travelling agent's label carries its target ("reference · Crafting bench recipes")
    const cap = node.kind === "session" ? 28 : node.kind === "task" ? 30 : node.kind === "root" ? 12 : node.kind === "assistant" ? 16 : node.kind === "folded" ? 20 : node.kind === "agent" ? (node.targetNode ? 30 : 12) : 34;
    let text = String(node.label ?? "").trim();
    if (!text) return "";
    if (node.kind === "root") text = text.toUpperCase();
    let clipped = text.length > cap;
    if (clipped) text = text.slice(0, cap);
    while (text.length > 1 && measure(ctx, font, text) > LABEL_MAX_PX) {
      text = text.slice(0, -1);
      clipped = true;
    }
    return clipped ? `${text}…` : text;
  }

  function labelCandidates(projected) {
    const mode = state.labels;
    const selectedId = state.selected?.id ?? null;
    const list = [];
    for (const item of projected) {
      const node = item.node;
      if (node.dying || node._absorbed) continue; // ghosts do not get a name
      let priority = -1;
      if (node.id === selectedId) priority = 0;
      else if (state.hoverNode === node) priority = 1;
      else if (state.query && state.matchSet.has(node.id)) priority = 2;
      else if (mode !== "none") {
        if (node.kind === "assistant") priority = 2.5; // always named, ahead of every session
        else if (node.kind === "session") priority = 3;
        else if (node.kind === "task" || node.kind === "folded") priority = 4;
        else if (node.kind === "root") priority = 5;
        else if (node.kind === "todo" && node.status === "in_progress") priority = 6;
        else if (node.kind === "todo" && state.branch && node.sessionId === state.branch) priority = 7;
        else if (node.kind === "agent") priority = mode === "all" ? 9 : node.targetNode ? 4.5 : node.status === "running" ? 5.5 : -1; // an agent at work names what it is on
        else if (mode === "all") priority = 8;
      }
      if (priority < 0) continue;
      if (priority > 2 && item.p.k < 0.55) continue; // far nodes stop shouting
      list.push({ node, p: item.p, priority });
    }
    list.sort((a, b) => a.priority - b.priority || a.p.depth - b.p.depth);
    return list.length > LABEL_CANDIDATES ? list.slice(0, LABEL_CANDIDATES) : list;
  }

  function slotRect(slot, p, radius, width) {
    const h = LABEL_HEIGHT;
    if (slot === "left") {
      const tx = p.x - radius - 8;
      const ty = p.y + 4;
      return { x: tx - width, y: ty - h + 3, w: width, h, tx, ty, align: "right" };
    }
    if (slot === "below") {
      const ty = p.y + radius + 14;
      return { x: p.x - width / 2, y: ty - h + 3, w: width, h, tx: p.x, ty, align: "center" };
    }
    if (slot === "above") {
      const ty = p.y - radius - 8;
      return { x: p.x - width / 2, y: ty - h + 3, w: width, h, tx: p.x, ty, align: "center" };
    }
    const tx = p.x + radius + 8;
    const ty = p.y + 4;
    return { x: tx, y: ty - h + 3, w: width, h, tx, ty, align: "left" };
  }

  function overlaps(rect, other) {
    return (
      rect.x - LABEL_PAD < other.x + other.w &&
      rect.x + rect.w + LABEL_PAD > other.x &&
      rect.y - LABEL_PAD < other.y + other.h &&
      rect.y + rect.h + LABEL_PAD > other.y
    );
  }

  function blocked(rect, excluded) {
    for (const placed of state.labelRects) if (overlaps(rect, placed)) return true;
    for (const zone of excluded) if (overlaps(rect, zone)) return true;
    return false;
  }

  // Panels are opaque; labels step around them instead of the constellation
  // moving out of the way. Rects are CSS pixels, the canvas coordinate space.
  function hudRects() {
    const now = Date.now();
    if (now - state.hudRectsAt < 250) return state.hudRects;
    state.hudRectsAt = now;
    const rects = [];
    const push = (node) => {
      if (!node || node.hidden) return;
      const box = node.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) rects.push({ x: box.left, y: box.top, w: box.width, h: box.height });
    };
    push(el.top);
    push(el.bottom);
    push(el.info);
    push(el.feed);
    push(el.chatLog);
    push(el.legend);
    push(el.empty);
    push(el.pop);
    state.hudRects = rects;
    return rects;
  }

  function drawLabels(projected) {
    for (const { node } of projected) node._label = null;
    const ctx = el.ctx;
    if (!ctx) return;
    state.labelRects.length = 0;
    const excluded = hudRects();
    const candidates = labelCandidates(projected);
    let drawn = 0;
    for (const { node, p, priority } of candidates) {
      if (drawn >= LABEL_BUDGET) break;
      const font = fontFor(node);
      const text = labelText(ctx, node, font);
      if (!text) continue;
      const width = measure(ctx, font, text);
      const radius = node._pr ?? 4;
      let rect = null;
      for (const slot of LABEL_SLOTS) {
        const candidate = slotRect(slot, p, radius, width);
        if (!blocked(candidate, excluded)) {
          rect = candidate;
          break;
        }
      }
      if (!rect) {
        if (priority > 2) continue; // crowded frame: only the important ones force a slot
        rect = slotRect("right", p, radius, width);
      }
      // Depth runs ~500 (nearest) to ~1300 (farthest) around the 900 pivot. Fading
      // from 700 keeps the front half of the orbit at full strength; the old 420
      // origin left mid-depth labels under half alpha, which read as muddy.
      const softness = Math.min(1, Math.max(0, (p.depth - 700) / 700));
      const alpha = priority <= 2 ? 1 : Math.max(0.32, Math.min(1, (0.96 - softness * 0.5) * emphasis(node)));
      ctx.font = font;
      ctx.textBaseline = "alphabetic";
      ctx.textAlign = rect.align;
      if (priority <= 2) {
        // the chip carries the node's colour on its border so a selected or
        // matched label reads as "that node", not just "highlighted"
        const [cr, cg, cb] = colorOf(node);
        ctx.fillStyle = "rgba(5,5,7,0.82)";
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},0.55)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(rect.x - 5, rect.y - 3, rect.w + 10, rect.h + 6, 6);
        ctx.fill();
        ctx.stroke();
      }
      ctx.lineJoin = "round";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(3,3,4,0.9)";
      ctx.strokeText(text, rect.tx, rect.ty);
      ctx.fillStyle = labelColour(node, alpha);
      ctx.fillText(text, rect.tx, rect.ty);
      state.labelRects.push(rect);
      node._label = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
      drawn += 1;
    }
    ctx.lineWidth = 1;
    ctx.textAlign = "left";
  }

  // ---------- hover tooltip ----------
  function tipKey() {
    if (state.hoverBubble) return `bubble:${state.hoverBubble.id}`;
    if (state.hoverNode) return `node:${state.hoverNode.id}`;
    return null;
  }

  function tipMeta(node) {
    const parts = [];
    parts.push(node.kind === "root" ? "root" : node.kind);
    if (node.kind === "todo") parts.push(String(node.status ?? "pending").replace("_", " "));
    else if (node.kind === "task") {
      parts.push(node.task?.status ?? "open");
      const hold = node.doneHold ? state.doneHold.get(node.id) : null;
      if (hold) parts.push(hold.ackedAt ? "read — sinking in" : "finished — click to read before it sinks");
    }
    else if (node.kind === "assistant") {
      const summary = assistantSummary();
      parts.push(summary.sublabel);
      const unread = Number(assistantFull()?.unread) || 0;
      if (unread) parts.push(`${unread} unread`);
      const absorbed = state.absorbed.get(node.id)?.length ?? 0;
      if (absorbed) parts.push(`${absorbed} absorbed`);
      return parts.filter(Boolean).join(" · ");
    } else if (node.kind === "folded") {
      parts.push(`${node.count ?? 0} finished session${node.count === 1 ? "" : "s"}`, "click to list them");
      return parts.join(" · ");
    } else if (node.kind === "agent") {
      const detail = node.status === "error" && node.error ? node.error : node.text;
      const home = node.status === "done" ? "back at the assistant" : null;
      return [node.role, node.status, detail ? String(detail).slice(0, 80) : null, home].filter(Boolean).join(" · ");
    } else if (node.kind === "session") {
      const todos = todosOf(node.id);
      if (todos.length) parts.push(`${todos.filter((entry) => entry.state === "done").length}/${todos.length} done`);
      if (node.stale) parts.push("stale");
      const absorbed = state.absorbed.get(node.id)?.length ?? 0;
      if (absorbed) parts.push(`${absorbed} absorbed`);
    }
    const session = parentSession(node);
    if (session?.agent) parts.push(session.agent);
    if (session?.model) parts.push(session.model);
    if (session?.updated) {
      const minutes = Math.max(0, Math.round((Date.now() - session.updated) / 60000));
      parts.push(minutes < 1 ? "active now" : `updated ${minutes}m ago`);
    }
    return parts.filter(Boolean).join(" · ");
  }

  function refreshTip(px, py) {
    if (!el.tip) return;
    const key = tipKey();
    if (!key || state.panning) {
      hideTip();
      return;
    }
    if (key !== state.tipNode) {
      state.tipNode = key;
      const title = el.tip.querySelector(".tip-title");
      const meta = el.tip.querySelector(".tip-meta");
      if (state.hoverBubble) {
        const notes = state.checkpoints?.[state.hoverBubble.id] ?? [];
        if (title) title.textContent = `${notes.length} checkpoint${notes.length === 1 ? "" : "s"}`;
        if (meta) meta.textContent = notes.length ? String(notes[0].note ?? "").slice(0, 60) : "";
      } else {
        const node = state.hoverNode;
        if (title) title.textContent = node.label ?? node.kind;
        if (meta) meta.textContent = tipMeta(node);
      }
    }
    el.tip.hidden = false;
    el.tip.style.setProperty("--x", `${Math.min(el.width - 260, px + 14)}px`);
    el.tip.style.setProperty("--y", `${Math.max(12, py - 12)}px`);
  }

  function hideTip() {
    state.tipNode = null;
    if (el.tip) el.tip.hidden = true;
  }

  // ---------- interaction ----------
  function nodeAt(x, y) {
    let best = null;
    for (const node of state.nodes) {
      if (node._px == null || node.dying || node._absorbed) continue;
      const distance = Math.hypot(node._px - x, node._py - y);
      if (distance <= node._pr + 8 && (!best || distance < best.distance)) best = { node, distance };
    }
    if (best) return best.node;
    // labels are part of the node: clicking the text selects it
    for (const node of state.nodes) {
      const rect = node._label;
      if (!rect) continue;
      if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) return node;
    }
    return null;
  }

  function bubbleAt(x, y) {
    for (const node of state.nodes) {
      const bubble = node._bubble;
      if (!bubble) continue;
      if (x >= bubble.x - 3 && x <= bubble.x + bubble.w + 3 && y >= bubble.y - 3 && y <= bubble.y + bubble.h + 3) return bubble.node;
    }
    return null;
  }

  // The wiggling "!" belongs to its node: hitting it selects — and reads —
  // the finished work exactly like clicking the node.
  function exclAt(x, y) {
    for (const node of state.nodes) {
      const excl = node._excl;
      if (!excl) continue;
      if (Math.hypot(excl.x - x, excl.y - y) <= excl.r) return node;
    }
    return null;
  }

  // Evidence popups are ambience: the moment the view is used as a menu they
  // fade out instead of floating over the node or the card being read.
  function dropPopups() {
    for (const entry of state.popups) {
      entry.image.classList.add("fade");
      setTimeout(() => entry.image.remove(), 1800);
    }
    state.popups = [];
  }

  // Selecting a session, todo or task also points the assistant at the node:
  // the service records the focus, the rail rings it, and the next message or
  // queued request grounds there. Debounced so an arrow-key walk or a redraw
  // settles into one call. The focus is sticky — clearing the selection does
  // not unfocus; clicking the node in the rail again does.
  let focusTimer = null;
  function focusAssistant(node) {
    clearTimeout(focusTimer);
    const send = () => {
      focusTimer = null;
      const target = node ? { kind: node.kind, id: node.id, label: node.label ?? node.id } : null;
      const sent = window.mefiStudio?.assistantFocus?.(target);
      if (sent?.then) sent.then((reply) => reply?.state && window.MefiTree?.applyAssistant?.({ state: reply.state })).catch(() => {});
    };
    if (node) focusTimer = setTimeout(send, 250);
    else send();
  }

  function selectNode(node, options = {}) {
    // Clearing empties the card: focus on one of its buttons (the close button,
    // Done, or a card whose node just left the graph) would fall to <body>.
    const focusInCard = !node && Boolean(el.info?.contains(document.activeElement));
    state.selected = node ? { id: node.id, kind: node.kind, node, via: options.via ?? "pointer" } : null;
    if (node?.doneHold) ackDoneHold(node.id); // the click is the read
    if (node && (node.kind === "session" || node.kind === "todo" || node.kind === "task")) focusAssistant(node);
    if (node) dropPopups();
    computeBranch();
    renderInfo();
    // Selecting the assistant swaps the rail into chat mode and back.
    state.feedDirty = true;
    if (state.active) renderFeed();
    if (focusInCard && state.active) el.canvas.focus?.({ preventScroll: true });
    renderHint();
    bumpHud();
  }

  function select(id) {
    const node = state.nodes.find((entry) => entry.id === id);
    if (!node) return false;
    selectNode(node);
    focusNode(node, { zoom: 1.4 });
    return true;
  }

  function selection() {
    const current = state.selected;
    if (!current) return null;
    const node = current.node;
    return {
      id: node.id,
      kind: node.kind,
      label: node.label ?? null,
      sessionId: node.kind === "session" ? node.id : node.kind === "todo" ? node.sessionId ?? null : null,
      taskId: node.kind === "task" ? node.task?.id ?? null : null,
      anchorSessionId: node.anchorSessionId ?? null,
      assistant: node.kind === "assistant",
      folded: node.kind === "folded" ? node.sessionIds ?? [] : null,
      node,
    };
  }

  function checkpointRef(node, note) {
    return [
      `A-EYES CHECKPOINT ${new Date(note.at).toISOString()}`,
      `session: ${node.label} (${node.agent ?? "?"} · ${node.model ?? "?"})`,
      `note: ${note.note}`,
      `files: ${(note.files ?? []).join(", ") || "n/a"}`,
      note.png ? `visual: ${note.png}` : "visual: n/a",
    ].join("\n");
  }

  // ---------- deep links ----------
  function nav(id, params) {
    if (window.MefiNav?.go) {
      window.MefiNav.go(id, params ?? {}, { source: "command" });
      return true;
    }
    return fallbackGo(id, params);
  }

  // Only reached when nav.js failed to evaluate: the card must still work.
  function fallbackGo(id, params = {}) {
    if (id === "explorer") {
      window.MefiExplorer?.open?.(params);
      return true;
    }
    if (id === "tasks") {
      window.MefiTasks?.open?.(params);
      if (params?.taskId) window.MefiTasks?.selectTask?.(params.taskId);
      return true;
    }
    if (id === "ideas") {
      window.MefiIdeas?.open?.(params);
      return true;
    }
    if (id === "eyes") {
      if (params?.sessionId !== undefined) {
        window.dispatchEvent(new CustomEvent("mefi:tree-select", { detail: { sessionId: params.sessionId } }));
      }
      if (params?.png) window.dispatchEvent(new CustomEvent("mefi:restore-png", { detail: { path: params.png } }));
      window.MefiBooklet?.showTab?.("eyes");
      exit();
      return true;
    }
    return false;
  }

  function primaryAction(node) {
    if (!node) return;
    if (node.kind === "task") {
      nav("tasks", { taskId: node.task?.id });
      return;
    }
    if (node.kind === "assistant") {
      // Send what is in the composer; with nothing typed, put the cursor there.
      const input = composerInput();
      if (input?.value.trim()) sendAssistant(input.value);
      else if (input && !input.disabled) input.focus();
      else nav("explorer", { assistant: true });
      return;
    }
    if (node.kind === "folded") {
      nav("explorer", { folded: true });
      return;
    }
    if (node.kind === "agent") {
      selectAssistant({ focus: true });
      return;
    }
    if (node.kind === "root") {
      nav("explorer");
      return;
    }
    const sessionId = node.kind === "todo" ? node.sessionId : node.id;
    nav("explorer", sessionId ? { sessionId } : {});
  }

  // ---------- selection card ----------
  function glyph(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "glyph");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `#${name}`);
    svg.append(use);
    return svg;
  }

  function statusBadge(node) {
    if (node.kind === "root") {
      return { text: `${state.nodes.filter((entry) => entry.kind === "session").length} sessions`, className: "badge" };
    }
    if (node.kind === "assistant") {
      const { tone } = assistantSummary();
      const full = assistantFull();
      if (!window.mefiStudio?.assistantState) return { text: "desktop only", className: "badge" };
      if (tone === "paused") return { text: "paused", className: "badge" };
      if (tone === "busy") return { text: "working", className: "badge premium" };
      if (tone === "warn") return { text: "attention", className: "badge trains" };
      if (tone === "offline") return { text: full?.status === "running" ? "offline" : "stopped", className: "badge trains" };
      return { text: "running", className: "badge free" };
    }
    if (node.kind === "folded") return { text: `${node.count ?? 0} finished`, className: "badge free" };
    if (node.kind === "agent") {
      const status = node.status ?? "idle";
      const className = status === "running" ? "badge premium" : status === "error" ? "badge legacy" : status === "queued" ? "badge trains" : status === "done" ? "badge free" : "badge";
      return { text: status, className };
    }
    if (node.kind === "session") {
      const { fresh } = nodeState(node);
      if (fresh > 0.5) return { text: "live", className: "badge premium" };
      const todos = todosOf(node.id);
      const done = todos.filter((entry) => entry.state === "done").length;
      const active = todos.some((entry) => entry.status === "in_progress");
      const className = todos.length && done === todos.length ? "badge free" : active ? "badge premium" : "badge";
      return { text: `${done}/${todos.length} done`, className };
    }
    if (node.kind === "todo") {
      const status = String(node.status ?? "pending");
      const text = status === "in_progress" ? "in progress" : status;
      const className = status === "completed" ? "badge free" : status === "in_progress" ? "badge premium" : "badge";
      return { text, className };
    }
    const status = node.task?.status ?? "open";
    const className = status === "active" ? "badge premium" : status === "done" ? "badge free" : "badge";
    return { text: status, className };
  }

  // Work that finished while this node hosted it: the absorbed brief stays
  // readable on the card long after the node that flew home is gone.
  function appendAbsorbed(info, node) {
    const list = state.absorbed.get(node.id) ?? [];
    if (!list.length) return;
    const details = document.createElement("details");
    details.className = "card-cps";
    details.open = list.length <= 2;
    const summary = document.createElement("summary");
    summary.textContent = `Absorbed work (${list.length})`;
    details.append(summary);
    for (const entry of list.slice(0, 6)) {
      const item = document.createElement("div");
      item.className = "cp-note checkpoint-note";
      item.textContent = `${entry.kind === "job" ? `job · ${entry.title}` : entry.title} · ${agoLabel(entry.at) ?? ""}`;
      item.title = entry.prompt ?? entry.title;
      if (entry.taskId) {
        item.style.cursor = "pointer";
        item.addEventListener("click", () => nav("tasks", { taskId: entry.taskId }));
      }
      details.append(item);
    }
    info.append(details);
  }

  // A node's context folder: what agents did here, what the chat settled, what
  // you pinned. It is saved on the node with the work; the keeper cleans it out
  // once the node is done.
  function appendNodeFolder(info, node) {
    const folders = assistantFull()?.nodeFolders ?? null;
    const folder = folders && typeof folders === "object" && !Array.isArray(folders) ? folders[`${node.kind}:${node.id}`] : null;
    const entries = Array.isArray(folder?.entries) ? folder.entries : [];
    const bridge = Boolean(window.mefiStudio?.assistantNodeContext);
    if (!bridge && !entries.length) return;
    const details = document.createElement("details");
    details.className = "card-cps card-folder";
    details.open = entries.length > 0;
    const summary = document.createElement("summary");
    summary.textContent = `Context folder (${entries.length})`;
    details.append(summary);
    if (entries.length) {
      const list = document.createElement("ul");
      list.className = "assistant-activity pin-list";
      for (const entry of entries.slice(-4).reverse()) {
        const li = document.createElement("li");
        const tag = document.createElement("b");
        tag.textContent = String(entry.kind ?? "note").toUpperCase();
        const text = document.createElement("span");
        text.className = "text";
        text.textContent = String(entry.text ?? "");
        text.title = text.textContent;
        const when = document.createElement("span");
        when.className = "when";
        when.textContent = agoShort(entry.at) ?? "";
        li.append(tag, text, when);
        list.append(li);
      }
      details.append(list);
    }
    if (bridge) {
      const row = document.createElement("div");
      row.className = "folder-add";
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "Save a note on this node…";
      input.setAttribute("aria-label", "Save a note on this node");
      const save = document.createElement("button");
      save.className = "ghost mini";
      save.textContent = "Save";
      save.addEventListener("click", async () => {
        const text = input.value.trim();
        if (!text || save.disabled) return;
        save.disabled = true;
        try {
          const result = await window.mefiStudio.assistantNodeContext({ target: { kind: node.kind, id: node.id }, text });
          if (result?.ok) {
            input.value = "";
            window.MefiToast?.("saved to the node's folder", "good");
            renderInfo();
          } else window.MefiToast?.(`not saved · ${result?.error ?? "unknown error"}`, "bad");
        } catch (error) {
          window.MefiToast?.(`not saved · ${String(error?.message ?? error)}`, "bad");
        } finally {
          save.disabled = false;
        }
      });
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          save.click();
        }
      });
      row.append(input, save);
      if (entries.length) {
        const clear = document.createElement("button");
        clear.className = "ghost mini";
        clear.textContent = "Clear";
        clear.title = "Empty this folder now — the keeper also cleans it once the node is done";
        clear.addEventListener("click", async () => {
          if (clear.disabled) return;
          clear.disabled = true;
          try {
            const result = await window.mefiStudio.assistantNodeContext({ target: { kind: node.kind, id: node.id }, clear: true });
            if (result?.ok) {
              window.MefiToast?.("folder cleared", "good");
              renderInfo();
            } else window.MefiToast?.(`not cleared · ${result?.error ?? "unknown error"}`, "bad");
          } catch (error) {
            window.MefiToast?.(`not cleared · ${String(error?.message ?? error)}`, "bad");
          } finally {
            clear.disabled = false;
          }
        });
        row.append(clear);
      }
      details.append(row);
    }
    info.append(details);
  }

  function renderInfo({ clearDraft = false } = {}) {
    if (!el.info) return;
    const selected = state.selected;
    // The assistant's surface moved into the A-Eyes rail; the floating card is
    // only the fallback for the narrow layout where the rail is hidden.
    if (selected?.kind === "assistant" && feedVisible()) {
      el.info.hidden = true;
      state.feedDirty = true;
      renderFeed();
      return;
    }
    // A push re-renders the card while a message may be half typed: carry the
    // draft, its focus and both scroll positions across the rebuild so a
    // heartbeat can never snap the card or the thread back to an end.
    // clearDraft holds the text that was just sent — the draft only drops
    // when it is that text, so a chip send keeps what you were typing.
    const draftInput = el.info.querySelector(".assistant-composer input, .assistant-composer textarea");
    const draft = draftInput && draftInput.value.trim() !== String(clearDraft ?? "") ? { value: draftInput.value, focused: document.activeElement === draftInput } : null;
    const oldThread = el.info.querySelector(".assistant-thread");
    const threadTop = oldThread?.scrollTop ?? 0;
    const threadPinned = !oldThread || oldThread.scrollTop + oldThread.clientHeight >= oldThread.scrollHeight - 28;
    const cardTop = state.cardScrollId === selected?.id ? el.info.scrollTop : 0;
    el.info.textContent = "";
    if (!selected) {
      el.info.hidden = true;
      state.cardScrollId = null;
      return;
    }
    el.info.hidden = false;
    const node = selected.node;
    const info = el.info;
    const kinds = { root: "Constellation", session: "Session", todo: "Todo", task: "Task", assistant: "Assistant", folded: "Finished sessions", agent: "Agent" };

    const kicker = document.createElement("div");
    kicker.className = "card-kicker";
    const eyebrow = document.createElement("span");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = kinds[node.kind] ?? "Node";
    const badgeInfo = statusBadge(node);
    const badge = document.createElement("span");
    badge.className = badgeInfo.className;
    badge.textContent = badgeInfo.text;
    const close = document.createElement("button");
    close.className = "ghost icon mini card-close";
    close.title = "Clear selection (Esc)";
    close.setAttribute("aria-label", "Clear selection");
    close.append(glyph("g-close"));
    close.addEventListener("click", () => selectNode(null));
    kicker.append(eyebrow, badge, close);

    const title = document.createElement("h3");
    title.className = "card-title clamp-3";
    title.textContent = node.label ?? node.kind;
    title.title = node.label ?? node.kind;
    info.append(kicker, title);

    const kv = document.createElement("div");
    kv.className = "kv";
    const row = (key, value, title) => {
      const k = document.createElement("span");
      k.className = "k";
      k.textContent = key;
      const v = document.createElement("span");
      v.textContent = String(value);
      if (title) v.title = String(title);
      kv.append(k, v);
    };
    const linkRow = (key, label, handler) => {
      const k = document.createElement("span");
      k.className = "k";
      k.textContent = key;
      const button = document.createElement("button");
      button.className = "link-value";
      button.textContent = label;
      button.addEventListener("click", handler);
      kv.append(k, button);
    };

    const actions = document.createElement("div");
    actions.className = "card-actions";
    const action = (label, handler, { primary = false, extra = "", title: hint = "" } = {}) => {
      const button = document.createElement("button");
      button.className = `${primary ? "primary" : "ghost"}${extra ? ` ${extra}` : ""}`;
      button.textContent = label;
      if (hint) button.title = hint;
      button.addEventListener("click", handler);
      actions.append(button);
      return button;
    };

    const session = parentSession(node);
    const sessionId = node.kind === "todo" ? node.sessionId : node.kind === "session" ? node.id : session?.id ?? null;

    if (node.kind === "root") {
      row("sessions", state.nodes.filter((entry) => entry.kind === "session").length);
      row("tasks", state.tasks.length);
      row("checkpoints", Object.values(state.checkpoints ?? {}).reduce((sum, list) => sum + list.length, 0));
      row("in progress", state.nodes.filter((entry) => entry.kind === "todo" && entry.status === "in_progress").length);
      info.append(kv);
      action("Open Explorer", () => primaryAction(node), { primary: true, title: "Session explorer (E)" });
      action("Tasks", () => nav("tasks"), { title: "Tasks (T)" });
      action("Ideas", () => nav("ideas"), { title: "Feature ideas (I)" });
      action("Fit all", () => fitAll(), { title: "Fit the constellation (F)" });
    } else if (node.kind === "assistant") {
      const full = assistantFull();
      const summary = assistantSummary();
      const bridge = Boolean(window.mefiStudio?.assistantMessage);
      row("status", bridge ? summary.sublabel : "desktop app only", summary.detail);
      if (full) {
        row("heartbeat", agoShort(full.heartbeatAt));
        row("next tick", full.status === "paused" ? "paused" : inLabel(full.nextTickAt));
        const ai = full.ai ?? {};
        row("AI", !ai.keyPresent ? "no key · local replies" : ai.online ? `online · ${ai.model ?? "auto"}` : "offline", ai.lastError ?? "");
        const counts = full.organization?.counts ?? {};
        row("sessions", `${counts.sessions ?? 0} · ${counts.folded ?? 0} folded · ${counts.stale ?? 0} stale`);
        const problems = Array.isArray(full.problems) ? full.problems : [];
        // Kinds on the row, the full texts in its tooltip.
        const label = window.MefiTree?.problemLabel ?? ((problem) => String(problem?.kind ?? "problem").replace(/-/g, " "));
        row(
          "problems",
          problems.length ? `${problems.length} · ${[...new Set(problems.map(label))].slice(0, 3).join(", ")}` : "none",
          problems.map((problem) => `${label(problem)}: ${problem.text ?? ""}`.trim()).join("\n")
        );
        if (Number(full.unread) > 0) row("unread", full.unread);
      }
      info.append(kv);

      const thread = document.createElement("div");
      thread.className = "assistant-thread";
      info.append(thread);
      fillThread(thread, full);
      thread.scrollTop = threadPinned ? thread.scrollHeight : threadTop;

      // Replies read here count as seen, the same as the Explorer thread: main
      // zeroes unread and pushes the state back.
      const unread = Number(full?.unread) || 0;
      if (bridge && state.active && unread > 0 && window.mefiStudio?.assistantControl && Date.now() - state.seenAt > 5000) {
        state.seenAt = Date.now();
        window.mefiStudio
          .assistantControl("seen")
          .then((result) => {
            if (result?.ok && result.state) {
              window.MefiTree?.applyAssistant?.({ state: result.state });
              refreshAssistantCache();
              updateAssistantPill();
              renderInfo();
            }
          })
          .catch(() => {});
      }

      const composer = document.createElement("div");
      composer.className = "assistant-composer";
      const input = document.createElement("textarea");
      input.rows = 1;
      input.autocomplete = "off";
      input.spellcheck = false;
      input.setAttribute("aria-label", "Message the assistant");
      const focused = full?.focus?.id ? full.focus : null;
      input.placeholder = !bridge
        ? "desktop app only"
        : focused
          ? `Work on "${String(focused.label || focused.id).slice(0, 40)}"… (Enter)`
          : "Message the assistant… (Enter)";
      input.disabled = !bridge || state.assistantSending;
      const send = document.createElement("button");
      send.className = "primary mini";
      send.textContent = state.assistantSending ? "Sending…" : "Send";
      send.disabled = !bridge || state.assistantSending;
      send.addEventListener("click", () => sendAssistant(input.value));
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          sendAssistant(input.value);
        }
      });
      input.addEventListener("input", () => growArea(input));
      composer.append(input, send);
      info.append(composer);
      // The same quick asks as the rail and the Explorer: one tap sends it.
      const chips = document.createElement("div");
      chips.className = "chat-chips";
      chips.setAttribute("aria-label", "Quick asks");
      for (const [label, msg] of [["Status", "status"], ["What next?", "what should I work on"], ["Log", "read the log"], ["Help", "help"]]) {
        const chip = document.createElement("button");
        chip.className = "ghost mini";
        chip.textContent = label;
        chip.disabled = !bridge || state.assistantSending;
        chip.addEventListener("click", () => sendAssistant(msg));
        chips.append(chip);
      }
      info.append(chips);
      if (draft) {
        input.value = draft.value;
        if (draft.focused && !input.disabled) input.focus();
      }
      growArea(input);
      // A sent message keeps the keyboard in the rebuilt composer.
      if (clearDraft && !input.disabled) input.focus();

      // The journal: every job in flight, so the card always says what is being
      // worked on (older state files have no `work`).
      const work = Array.isArray(full?.work) ? full.work : [];
      if (work.length) {
        const head = document.createElement("div");
        head.className = "card-sub";
        head.textContent = `Working on (${work.length})`;
        const list = document.createElement("ul");
        list.className = "assistant-work assistant-activity pin-list";
        for (const job of work.slice(0, 8)) {
          const li = document.createElement("li");
          const tag = document.createElement("span");
          tag.className = `src-tag ${job.status === "queued" ? "improver" : ""}`;
          tag.textContent = String(job.kind ?? job.role ?? "job").toUpperCase();
          const text = document.createElement("span");
          text.className = "text";
          text.textContent = String(job.text ?? "");
          text.title = `${text.textContent}${job.attempts > 1 ? ` · attempt ${job.attempts}` : ""}`;
          const when = document.createElement("span");
          when.className = "when";
          when.textContent = job.status === "queued" ? "queued" : `started ${agoShort(job.startedAt)}`;
          li.append(tag, text, when);
          list.append(li);
        }
        info.append(head, list);
      }

      // The scouts' reports home: what each agent last told the assistant, so
      // the card reads as the whole loop — find, report, plan, dispatch.
      const intelRows = Array.isArray(full?.intel) ? full.intel.slice(0, 6) : [];
      if (intelRows.length) {
        const head = document.createElement("div");
        head.className = "card-sub";
        head.textContent = "Reported";
        const list = document.createElement("ul");
        list.className = "assistant-intel assistant-activity pin-list";
        for (const row of intelRows) {
          const li = document.createElement("li");
          li.style.borderLeftColor = agentHex(row.role);
          const name = document.createElement("b");
          name.textContent = row.role;
          name.style.color = agentHex(row.role);
          const text = document.createElement("span");
          text.className = "text";
          text.textContent = String(row.text ?? "");
          text.title = text.textContent;
          const when = document.createElement("span");
          when.className = "when";
          when.textContent = row.at ? agoShort(row.at) : "";
          li.append(name, text, when);
          list.append(li);
        }
        info.append(head, list);
      }

      const roster = Array.isArray(full?.agents) ? full.agents : [];
      if (roster.length) {
        const list = document.createElement("ul");
        list.className = "assistant-roster assistant-activity pin-list";
        for (const agent of roster) {
          const li = document.createElement("li");
          li.className = `agent-${agent.status ?? "idle"}`;
          li.style.borderLeftColor = agentHex(agent.role);
          const tag = document.createElement("span");
          tag.className = `src-tag ${agent.status === "error" ? "fix" : agent.status === "running" ? "" : agent.status === "queued" ? "improver" : "stale"}`;
          tag.textContent = String(agent.status ?? "idle").toUpperCase();
          const name = document.createElement("b");
          name.textContent = agent.role;
          // The name carries the role's constellation colour; an errored agent
          // keeps the warning colour so it cannot be mistaken for healthy.
          if (agent.status !== "error") name.style.color = agentHex(agent.role);
          const text = document.createElement("span");
          text.className = "text";
          text.textContent = String((agent.status === "error" && agent.error) || agent.text || "");
          text.title = text.textContent;
          const when = document.createElement("span");
          when.className = "when";
          when.textContent = agent.status === "running" ? `since ${agoShort(agent.since)}` : agent.lastRunAt ? agoShort(agent.lastRunAt) : "never";
          li.append(tag, name, text, when);
          list.append(li);
        }
        info.append(list);
        // The pool's width: how many agents run at once, how many of them on
        // AI, and how many queued tasks the executor runs as opencode jobs.
        const steppers = document.createElement("div");
        steppers.className = "assistant-steppers";
        const stepper = (label, key, min, max, get, send) => {
          const value = Math.min(max, Math.max(min, Number(get()) || min));
          const wrap = document.createElement("div");
          wrap.className = "stepper";
          wrap.title = `${label}: ${min}–${max}`;
          const name = document.createElement("span");
          name.className = "k";
          name.textContent = label;
          const num = document.createElement("span");
          num.className = "num";
          num.textContent = String(value);
          const step = (delta) => {
            const button = document.createElement("button");
            button.className = "ghost mini icon";
            button.textContent = delta < 0 ? "−" : "+";
            button.setAttribute("aria-label", `${label} ${delta < 0 ? "down" : "up"}`);
            button.disabled = !bridge || value + delta < min || value + delta > max;
            button.addEventListener("click", () => send({ [key]: value + delta }, label));
            return button;
          };
          wrap.append(name, step(-1), num, step(1));
          steppers.append(wrap);
        };
        stepper("Parallel agents", "parallel", 1, 12, () => full?.prefs?.parallel, assistantPrefs);
        stepper("AI in parallel", "aiParallel", 1, 6, () => full?.prefs?.aiParallel, assistantPrefs);
        stepper("Autopilot jobs", "parallel", 1, 12, () => state.assistant?.parallel, autopilotPrefs);
        info.append(steppers);
      }

      // The R&D layer's last word: health, score, and how much the playbook holds.
      const overseer = full?.overseer;
      if (overseer && Number(overseer.reviews) > 0) {
        const line = document.createElement("p");
        line.className = "muted assistant-overseer";
        line.textContent = `overseer · ${overseer.health ?? "?"} ${overseer.score ?? "?"}/100 · ${overseer.lessons?.length ?? 0} lesson(s) — ${overseer.lastSummary || "no summary"}`;
        info.append(line);
      }

      const log = (full?.log ?? []).slice(-6).reverse();
      if (log.length) {
        const activity = document.createElement("ul");
        activity.className = "assistant-activity pin-list";
        for (const entry of log) {
          const li = document.createElement("li");
          const tag = document.createElement("span");
          tag.className = `src-tag ${entry.kind === "error" ? "fix" : entry.kind === "collision" ? "collision" : ["tidy", "organize", "fix"].includes(entry.kind) ? "tidy" : ["message", "reply", "think"].includes(entry.kind) ? "chat" : ""}`;
          tag.textContent = String(entry.kind ?? "log").toUpperCase();
          const text = document.createElement("span");
          text.className = "text";
          text.textContent = String(entry.text ?? "");
          text.title = text.textContent;
          const when = document.createElement("span");
          when.className = "when";
          when.textContent = agoShort(entry.at);
          li.append(tag, text, when);
          activity.append(li);
        }
        info.append(activity);
      }

      action("Send", () => primaryAction(node), { primary: true, title: "Send the message (Enter)" });
      action("Oversee", () => assistantControl("overseer", "overseer"), { title: "Run the overseer — it reviews the assistant's own work, tunes prefs and files upgrades" });
      action("Tidy now", () => assistantControl("tidy", "tidy"), { title: "Archive done tasks, prune ideas, clear resolved requests" });
      action("Fix now", () => assistantControl("fix", "fix"), { title: "Repair the catalog and data files, check the updater" });
      action(full?.status === "paused" ? "Resume" : "Pause", () => assistantControl(full?.status === "paused" ? "resume" : "pause", "control"), {
        title: "Pause or resume the assistant service",
      });
      action("Open Explorer", () => nav("explorer", { assistant: true }), { title: "The full thread in the Session explorer (E)" });
    } else if (node.kind === "folded") {
      row("sessions", node.count ?? 0);
      row("why", "finished and untouched for a while");
      info.append(kv);
      const titles = Array.isArray(node.titles) ? node.titles.slice(0, 8) : [];
      if (titles.length) {
        const list = document.createElement("ul");
        list.className = "pin-list card-list";
        for (const title of titles) {
          const li = document.createElement("li");
          li.textContent = title;
          li.title = title;
          list.append(li);
        }
        info.append(list);
      }
      action("Open Explorer", () => primaryAction(node), { primary: true, title: "List the finished sessions in the Session explorer (E)" });
    } else if (node.kind === "agent") {
      row("role", node.role ?? node.label);
      row("status", node.status ?? "idle");
      if (node.status === "running") row("since", agoShort(node.since));
      row("last run", node.lastRunAt ? agoShort(node.lastRunAt) : "never");
      row("runs", node.runs ?? 0);
      info.append(kv);
      const text = document.createElement("p");
      text.className = "muted clamp-3";
      text.textContent = String((node.status === "error" && node.error) || node.text || "nothing yet");
      info.append(text);
      action("Assistant", () => primaryAction(node), { primary: true, title: "Select the assistant (M)" });
    } else if (node.kind === "task") {
      const task = node.task;
      const anchor = node.anchorSessionId ? nodeForSession(node.anchorSessionId) : null;
      row("status", task.status);
      const hold = node.doneHold ? state.doneHold.get(node.id) : null;
      if (hold) row("absorb", hold.ackedAt ? "read — sinking in" : "finished — click to read before it sinks");
      row("refs", (task.refs ?? []).length);
      row("logs", (task.logs ?? []).length);
      row("ideas", (task.ideas ?? []).length);
      if (anchor) linkRow("anchored to", anchor.label ?? anchor.id, () => {
        selectNode(anchor);
        focusNode(anchor, { zoom: 1.4 });
      });
      else row("anchored to", "—");
      const taskFocus = assistantFull()?.focus;
      if (taskFocus?.kind === "task" && taskFocus.id === node.id) linkRow("assistant", "focused on this · unfocus", () => focusAssistant(null));
      else row("assistant", taskFocus?.id ? `on "${String(taskFocus.label || taskFocus.id).slice(0, 30)}"` : "—");
      const prompt = document.createElement("p");
      prompt.className = "muted clamp-3";
      prompt.textContent = task.prompt ?? "";
      info.append(kv, prompt);
      appendNodeFolder(info, node);
      action("Open in Tasks", () => primaryAction(node), { primary: true, title: "Tasks (T)" });
      action("Work on it", () => workOnNode(node), {
        title: "Make this task the assistant's next piece of work — pinned to the front, the executor starts it as soon as a slot frees",
      });
      if (task.status !== "active") {
        action("Activate", async () => {
          if (!(await patchTask(task.id, { status: "active" }))) {
            window.MefiToast?.(`${task.title} · not saved, the task store could not be read`, "bad");
            return;
          }
          await refreshTasks();
          renderInfo();
          window.MefiToast?.(`${task.title} → active`, "good");
        });
      }
      action(
        "Done",
        async () => {
          if (!(await patchTask(task.id, { status: "done" }))) {
            window.MefiToast?.(`${task.title} · not saved, the task store could not be read`, "bad");
            return;
          }
          await refreshTasks();
          refreshGraph();
          selectNode(null);
          window.MefiToast?.(`${task.title} done`, "good");
        },
        { extra: "good" }
      );
      action("Gather references", () => nav("tasks", { taskId: task.id, gather: true }));
      if (anchor) {
        action("Go to session", () => {
          selectNode(anchor);
          focusNode(anchor, { zoom: 1.4 });
        });
      }
    } else {
      // session / todo
      const todos = todosOf(sessionId);
      const done = todos.filter((entry) => entry.state === "done").length;
      if (node.kind === "session") {
        if (node.agent) row("agent", node.agent);
        if (node.model) row("model", node.model);
        const ago = agoLabel(node.updated);
        if (ago) row("updated", node.stale ? `${ago} · stale` : ago);
        row("todos", node.stale ? "hidden while stale" : `${done}/${todos.length}`);
        const touch = state.touches.get(node.id);
        if (touch) row("touches", `${touch.count} in 90s`);
      } else {
        if (session) {
          linkRow("session", session.label ?? session.id, () => {
            selectNode(session);
            focusNode(session, { zoom: 1.4 });
          });
        }
        row("status", String(node.status ?? "pending").replace("_", " "));
        const index = todos.findIndex((entry) => entry.id === node.id);
        if (index >= 0) row("step", `${index + 1} of ${todos.length}`);
        if (session?.agent) row("agent", session.agent);
        if (session?.model) row("model", session.model);
      }
      const notes = state.checkpoints?.[sessionId] ?? [];
      if (notes.length) row("checkpoints", notes.length);
      const focused = assistantFull()?.focus;
      if (focused?.kind === node.kind && focused.id === node.id) linkRow("assistant", "focused on this · unfocus", () => focusAssistant(null));
      else row("assistant", focused?.id ? `on "${String(focused.label || focused.id).slice(0, 30)}"` : "—");
      info.append(kv);

      if (node.kind === "session" && todos.length) {
        const meter = document.createElement("div");
        meter.className = "meter";
        const bar = document.createElement("i");
        meter.append(bar);
        bar.style.setProperty("--pct", `${Math.round((done / todos.length) * 100)}%`);
        info.append(meter);
      }

      if (notes.length) {
        const details = document.createElement("details");
        details.className = "card-cps";
        details.open = selected.via === "bubble" || notes.length <= 2;
        const summary = document.createElement("summary");
        summary.textContent = `Checkpoints (${notes.length})`;
        details.append(summary);
        notes.slice(0, 4).forEach((note) => {
          const noteText = document.createElement("div");
          noteText.className = "cp-note checkpoint-note";
          noteText.textContent = note.note;
          details.append(noteText);
          const cpActions = document.createElement("div");
          cpActions.className = "cp-actions";
          const cpButton = (label, handler) => {
            const button = document.createElement("button");
            button.className = "ghost mini";
            button.textContent = label;
            button.addEventListener("click", handler);
            cpActions.append(button);
          };
          const reference = checkpointRef(node, note);
          cpButton("Reference", async () => {
            await window.mefiStudio?.shellCopy?.(reference);
            window.MefiToast?.("checkpoint copied as chat context", "good");
          });
          cpButton("Explore", async () => {
            nav("explorer", { sessionId });
            await window.MefiExplorer?.runAssistant?.("explore", sessionId, { note: note.note, at: note.at, files: note.files ?? [] });
          });
          cpButton("Restore", () => {
            if (note.png) {
              nav("eyes", { sessionId, png: note.png });
            } else {
              window.mefiStudio?.shellCopy?.(`Restore ${node.label} to ${new Date(note.at).toISOString()} — files: ${(note.files ?? []).join(", ")}`);
              window.MefiToast?.("restore brief copied", "info");
            }
          });
          cpButton("Expand", async () => {
            nav("explorer", { sessionId });
            await window.MefiExplorer?.runAssistant?.("expand", sessionId, { note: note.note, at: note.at, files: note.files ?? [] });
          });
          details.append(cpActions);
        });
        info.append(details);
      }

      appendNodeFolder(info, node);
      const workHint = "Make this node the assistant's next piece of work — pinned to the front of the queue";
      if (node.kind === "session") {
        action("Open in Explorer", () => primaryAction(node), { primary: true, title: "Session explorer (E)" });
        action("Work on it", () => workOnNode(node), { title: workHint });
        action("Filter A-Eyes feed", () => nav("eyes", { sessionId }), { title: "A-Eyes (3)" });
        action("Focus", () => focusNode(node, { zoom: 1.6 }), { title: "Fit this branch (Shift F)" });
        if (window.mefiStudio?.shellCopy) {
          action("Copy id", async () => {
            await window.mefiStudio.shellCopy(sessionId);
            window.MefiToast?.("session id copied", "good");
          });
        }
      } else {
        action("Open session in Explorer", () => primaryAction(node), { primary: true, title: "Session explorer (E)" });
        action("Work on it", () => workOnNode(node), { title: workHint });
        action("Filter A-Eyes feed", () => nav("eyes", { sessionId }), { title: "A-Eyes (3)" });
        if (session) {
          action("Go to session", () => {
            selectNode(session);
            focusNode(session, { zoom: 1.4 });
          }, { title: "Up one level (↑)" });
        }
      }
    }
    if (node.kind === "session" || node.kind === "assistant" || node.kind === "root") appendAbsorbed(info, node);
    info.append(actions);
    el.info.scrollTop = cardTop;
    state.cardScrollId = selected.id;
  }

  // ---------- search ----------
  function applyQuery() {
    const query = state.query.toLowerCase();
    const previous = state.matchIndex >= 0 ? state.matches[state.matchIndex] : null;
    const hit = (node) => {
      const fields = [node.label];
      if (node.kind === "session") fields.push(node.agent, node.model, node.stale ? "stale" : null);
      else if (node.kind === "task") fields.push(node.task?.prompt, node.task?.status);
      else if (node.kind === "todo") fields.push(node.status);
      else if (node.kind === "assistant") fields.push("assistant", node.sublabel, node.tone);
      else if (node.kind === "folded") fields.push("finished", "folded", ...(node.titles ?? []));
      else if (node.kind === "agent") fields.push(node.role);
      return fields.some((field) => field && String(field).toLowerCase().includes(query));
    };
    const matches = [];
    const helper = assistantNode();
    if (helper && hit(helper)) matches.push(helper.id);
    for (const session of sessionNodes()) {
      if (hit(session)) matches.push(session.id);
      for (const child of todosOf(session.id)) if (hit(child)) matches.push(child.id);
    }
    const cluster = foldedNode();
    if (cluster && hit(cluster)) matches.push(cluster.id);
    for (const task of taskNodes()) if (hit(task)) matches.push(task.id);
    for (const agent of state.nodes) if (agent.kind === "agent" && hit(agent)) matches.push(agent.id);
    const root = rootNode();
    if (root && hit(root)) matches.push(root.id);
    state.matches = matches;
    state.matchSet = new Set(matches);
    state.matchIndex = previous ? matches.indexOf(previous) : -1;
    if (el.searchCount) {
      el.searchCount.textContent = !matches.length
        ? "no match"
        : matches.length === 1
          ? "1 match · Enter cycles"
          : `${matches.length} matches · Enter cycles`;
    }
    renderHint();
    return matches.length;
  }

  function search(text) {
    state.query = String(text ?? "").trim();
    if (!state.query) {
      clearSearch();
      return 0;
    }
    state.matchIndex = -1;
    return applyQuery();
  }

  function cycleMatch() {
    if (!state.matches.length) return;
    state.matchIndex = (state.matchIndex + 1) % state.matches.length;
    const node = state.nodes.find((entry) => entry.id === state.matches[state.matchIndex]);
    if (!node) return;
    selectNode(node);
    focusNode(node, { zoom: 1.4 });
  }

  function clearSearch() {
    state.query = "";
    state.matches = [];
    state.matchSet = new Set();
    state.matchIndex = -1;
    if (el.search) el.search.value = "";
    if (el.searchCount) el.searchCount.textContent = "";
    renderHint();
  }

  // ---------- legend, view controls, ambience ----------
  function renderLegend() {
    if (!el.legendList || el.legendList.childElementCount) return;
    for (const entry of LEGEND) {
      const li = document.createElement("li");
      li.className = "legend-row";
      const swatch = document.createElement("i");
      swatch.className = "sw";
      swatch.dataset.sw = entry.key;
      swatch.style.setProperty("--sw", entry.sw);
      const text = document.createElement("span");
      text.textContent = entry.label;
      li.append(swatch, text);
      el.legendList.append(li);
    }
    setLegend(state.legendOpen);
  }

  function setLegend(open) {
    state.legendOpen = Boolean(open);
    if (el.legendList) el.legendList.hidden = !state.legendOpen;
    el.legendToggle?.setAttribute("aria-expanded", String(state.legendOpen));
    writeStore("mefiStudio.cmdLegend", state.legendOpen ? "1" : "0");
  }

  function setFeedMenu(open) {
    state.feedMenuOpen = Boolean(open);
    if (el.feedDrop) el.feedDrop.hidden = !state.feedMenuOpen;
    el.feedMenu?.setAttribute("aria-expanded", String(state.feedMenuOpen));
    writeStore("mefiStudio.cmdFeedMenu", state.feedMenuOpen ? "1" : "0");
    state.feedDirty = true;
    if (state.active) renderFeed();
  }

  function syncViewControls() {
    if (el.orbitBtn) {
      const flat = state.view === "2d";
      const running = state.orbit !== "paused";
      el.orbitBtn.disabled = flat;
      el.orbitBtn.setAttribute("aria-pressed", running && !flat ? "true" : "false");
      el.orbitBtn.title = flat ? "Orbit (3D view only)" : running ? "Orbit on · Space pauses" : "Orbit paused · Space resumes";
    }
    if (el.camOrbitBtn) {
      const on = state.camMode === "orbit";
      el.camOrbitBtn.setAttribute("aria-pressed", on ? "true" : "false");
      el.camOrbitBtn.title = on
        ? "Camera: orbit — the whole tree stays framed · click for a free camera (C cycles orbit / follow / free)"
        : "Camera: orbit — keep the whole tree framed (C)";
    }
    if (el.camFollowBtn) {
      const on = state.camMode === "follow";
      el.camFollowBtn.setAttribute("aria-pressed", on ? "true" : "false");
      el.camFollowBtn.title = on
        ? "Camera: follow — tracking the current work · click for a free camera (C cycles orbit / follow / free)"
        : "Camera: follow — track the agent's current work (C)";
    }
    if (el.viewBtn) {
      el.viewBtn.dataset.view = state.view;
      const viewLabel = el.viewBtn.querySelector(".label");
      if (viewLabel) viewLabel.textContent = state.view === "2d" ? "2D" : "3D";
      el.viewBtn.title = state.view === "2d" ? "View: flat 2D map (V toggles 3D)" : "View: 3D orbit (V toggles 2D)";
    }
    if (el.labelsBtn) {
      el.labelsBtn.dataset.labels = state.labels;
      const label = el.labelsBtn.querySelector(".label");
      if (label) label.textContent = state.labels;
      el.labelsBtn.title = `Node labels: ${state.labels} (L cycles auto / all / none)`;
    }
  }

  function setOrbit(mode, options = {}) {
    const next =
      mode === undefined
        ? state.orbit === "paused"
          ? "auto"
          : "paused"
        : mode === true
          ? "auto"
          : mode === false
            ? "paused"
            : mode === "paused"
              ? "paused"
              : "auto";
    const changed = next !== state.orbit;
    state.orbit = next;
    syncViewControls();
    renderHint();
    if (changed && !options.quiet) window.MefiToast?.(next === "paused" ? "orbit paused" : "orbit resumed", "info");
  }

  // Camera autopilot. Orbit refits the whole constellation (the graph rebuild's
  // autoFit keeps it the largest frame that still shows every node). Follow
  // locks onto the node the agent's work sits on and moves as the work moves.
  // Free never moves on its own: it is where every direct camera gesture lands,
  // and the user's view wins until a mode is picked again.
  function applyCamMode() {
    if (state.camMode === "orbit") fitAll();
    else if (state.camMode === "follow") {
      const node = workNode();
      if (node) focusOn(node);
    }
  }

  function setCamMode(mode, options = {}) {
    const next = CAM_MODES.includes(mode) ? mode : "orbit";
    const changed = next !== state.camMode;
    state.camMode = next;
    // Quiet + unchanged (a wheel tick in free mode, say) skips the DOM churn;
    // an explicit mode click always re-syncs and re-applies.
    if (!options.quiet || changed) {
      if (changed) writeStore("mefiStudio.cmdCam", next);
      syncViewControls();
      renderHint();
      if (changed && !options.quiet) {
        window.MefiToast?.(
          next === "orbit" ? "camera: orbit — the whole tree stays in frame" : next === "follow" ? "camera: follow — tracking the current work" : "camera: free",
          "info"
        );
      }
    }
    applyCamMode();
  }

  function cycleCamMode() {
    setCamMode(CAM_MODES[(CAM_MODES.indexOf(state.camMode) + 1) % CAM_MODES.length]);
  }

  // A zoom the user asked for (wheel, buttons, keys): the mode steps aside.
  function userZoom(value) {
    setCamMode("free", { quiet: true });
    setZoom(value);
  }

  function setLabels(mode) {
    state.labels = LABEL_MODES.includes(mode) ? mode : "auto";
    writeStore("mefiStudio.cmdLabels", state.labels);
    state.labelWidths.clear();
    syncViewControls();
  }

  function nextLabels() {
    return LABEL_MODES[(LABEL_MODES.indexOf(state.labels) + 1) % LABEL_MODES.length];
  }

  function setView(mode) {
    const next = mode === "2d" ? "2d" : "3d";
    state.view = next;
    writeStore("mefiStudio.cmdView", next);
    if (next === "2d") state.orbitVel = 0; // no easing tail into the flat map
    syncViewControls();
    renderHint();
    fitAll();
    if (state.camMode === "follow") applyCamMode(); // refit recentered; go back to the work node
    window.MefiToast?.(next === "2d" ? "2D map view" : "3D orbit view", "info");
  }

  function onAmbienceOutside(event) {
    if (el.pop?.contains(event.target) || el.ambienceBtn?.contains(event.target)) return;
    closeAmbience();
  }

  function toggleAmbience() {
    if (!el.pop) return;
    if (el.pop.hidden) {
      el.pop.hidden = false;
      el.ambienceBtn?.setAttribute("aria-expanded", "true");
      document.addEventListener("mousedown", onAmbienceOutside);
      bumpHud();
    } else {
      closeAmbience();
    }
  }

  function closeAmbience() {
    if (!el.pop) return;
    if (!el.pop.hidden) document.removeEventListener("mousedown", onAmbienceOutside);
    el.pop.hidden = true;
    el.ambienceBtn?.setAttribute("aria-expanded", "false");
  }

  // ---------- keyboard ----------
  function stepThrough(list, current, delta) {
    if (!list.length) return null;
    const index = current ? list.findIndex((node) => node.id === current.id) : -1;
    if (index < 0) return delta > 0 ? list[0] : list[list.length - 1];
    return list[(index + delta + list.length) % list.length];
  }

  function moveTo(node) {
    if (!node) return;
    selectNode(node);
    focusNode(node);
  }

  function cycleSiblings(node, delta) {
    let list = topNodes();
    if (node && (node.kind === "todo" || node.kind === "task")) {
      const siblings = childrenOf(branchIdOf(node));
      list = siblings.length ? siblings : taskNodes();
    }
    moveTo(stepThrough(list, node, delta));
  }

  function cycleTasks(delta) {
    const list = taskNodes();
    if (!list.length) return;
    const current = state.selected?.node?.kind === "task" ? state.selected.node : null;
    moveTo(stepThrough(list, current, delta));
  }

  function descend(node) {
    if (!node || node.kind === "root") {
      moveTo(sessionNodes()[0] ?? null);
      return;
    }
    if (node.kind === "session") moveTo(childrenOf(node.id)[0] ?? null);
    else if (node.kind === "assistant") focusComposer();
  }

  function ascend(node) {
    if (!node) return;
    if (node.kind === "todo" || node.kind === "task") {
      moveTo(parentSession(node) ?? rootNode());
      return;
    }
    if (node.kind === "session" || node.kind === "assistant" || node.kind === "folded") moveTo(rootNode());
    else if (node.kind === "agent") moveTo(assistantNode() ?? rootNode());
  }

  function branchFit() {
    const node = state.selected?.node ?? sessionNodes()[0] ?? null;
    if (node) focusNode(node, { zoom: 1.6 });
  }

  function handleKey(event) {
    if (!state.active) return false;
    if (document.body.dataset.sheet) return false;
    if (event.ctrlKey || event.altKey || event.metaKey) return false;
    if (event.target?.closest?.("input, textarea, select, [contenteditable]")) return false;
    // Let a focused control keep Enter and Space (dock buttons, view controls, legend).
    const onControl = event.target?.closest?.("button, a, summary, [role='button']");
    if (onControl && (event.key === " " || event.key === "Enter" || event.key === "Spacebar")) return false;
    const node = state.selected?.node ?? null;
    switch (event.key) {
      case "ArrowRight":
        cycleSiblings(node, 1);
        return true;
      case "ArrowLeft":
        cycleSiblings(node, -1);
        return true;
      case "ArrowDown":
        descend(node);
        return true;
      case "ArrowUp":
        ascend(node);
        return true;
      case "Enter":
        if (node) primaryAction(node);
        else moveTo(sessionNodes()[0] ?? null);
        return true;
      case "Home":
        selectNode(rootNode());
        setCamMode("orbit");
        return true;
      case " ":
      case "Spacebar":
        setOrbit();
        return true;
      case "[":
        cycleTasks(-1);
        return true;
      case "]":
        cycleTasks(1);
        return true;
      case "0":
        userZoom(1);
        return true;
      case "+":
      case "=":
        userZoom(state.zoom * 1.12);
        return true;
      case "-":
      case "_":
        userZoom(state.zoom * 0.89);
        return true;
      default:
        break;
    }
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (key === "f") {
      if (event.shiftKey) branchFit();
      else setCamMode("orbit");
      return true;
    }
    if (key === "c") {
      cycleCamMode();
      return true;
    }
    if (key === "l") {
      setLabels(nextLabels());
      return true;
    }
    if (key === "n") {
      el.taskInput?.focus();
      return true;
    }
    if (key === "m") {
      selectAssistant({ focus: true });
      return true;
    }
    if (key === "s") {
      el.search?.focus();
      el.search?.select?.();
      return true;
    }
    if (key === "v") {
      setView(state.view === "2d" ? "3d" : "2d");
      return true;
    }
    return false;
  }

  // One Esc step per press; nav owns focus and the layers above this one.
  function escape() {
    if (!state.active) return false;
    if (el.pop && el.pop.hidden === false) {
      closeAmbience();
      return true;
    }
    if (state.query) {
      clearSearch();
      return true;
    }
    if (state.selected) {
      selectNode(null);
      return true;
    }
    exit();
    return true;
  }

  // ---------- lifecycle ----------
  function canDim() {
    return (
      state.active &&
      state.ambient &&
      !state.selected &&
      !state.query &&
      el.pop?.hidden !== false &&
      !document.body.dataset.sheet &&
      !el.hud.matches(":hover") &&
      !el.hud.contains(document.activeElement)
    );
  }

  function bumpHud() {
    if (!state.active || !el.hud) return;
    el.hud.classList.remove("dim");
    if (state.hudTimer) clearTimeout(state.hudTimer);
    state.hudTimer = null;
    if (!canDim()) return;
    state.hudTimer = setTimeout(() => {
      if (canDim()) el.hud.classList.add("dim");
    }, HUD_DIM_MS);
  }

  function applyEnterParams(params) {
    // A live-update reload hands back what saveState() captured: the selected
    // node by id (any kind) and the zoom, restored in that order.
    let applied = false;
    const selectedId = typeof params?.selected === "string" ? params.selected : "";
    if (selectedId && select(selectedId)) applied = true;
    if (typeof params?.zoom === "number" && Number.isFinite(params.zoom)) {
      setZoom(params.zoom);
      applied = true;
    }
    const sessionId = typeof params?.sessionId === "string" ? params.sessionId.trim() : "";
    if (!sessionId) return applied;
    const node = nodeForSession(sessionId);
    if (!node) return applied;
    selectNode(node);
    focusNode(node, { zoom: 1.5 });
    return true;
  }

  // What a live-update reload hands back to enter(): the selection and the zoom.
  function saveState() {
    return { selected: state.selected?.id ?? null, zoom: state.zoom };
  }

  function enter(force = false, params = {}) {
    if (!el.canvas || !el.hud) return;
    if (state.active) {
      applyEnterParams(params);
      return;
    }
    state.active = true;
    state.frameError = false;
    state.ambient = !force;
    state.orbit = "auto";
    state.orbitVel = 0;
    state.settleUntil = 0;
    state.rotating = null;
    state.pitch = 0;
    state.query = "";
    state.matches = [];
    state.matchSet = new Set();
    state.matchIndex = -1;
    if (el.search) el.search.value = "";
    if (el.searchCount) el.searchCount.textContent = "";
    closeAmbience();
    el.canvas.hidden = false;
    el.hud.hidden = false;
    el.hud.classList.toggle("forced", !state.ambient);
    document.body.classList.add("command-active");
    resize();
    renderLegend();
    syncViewControls();
    setCamMode(state.camMode, { quiet: true }); // a saved follow/orbit mode resumes where it left off
    // The first build as a promise: the boot sequence holds its fade until
    // this settles, so the constellation is already populated when it shows.
    state.readyPromise = refreshTasks()
      .catch(() => {})
      .then(() => {
        refreshGraph();
        selectNode(null);
        updateTelemetry(true);
        applyEnterParams(params);
      })
      .catch(() => {})
      .then(() => {});
    loadPngs();
    updateTelemetry(true);
    window.mefiStudio?.prefsGet?.().then((result) => {
      if (result?.ok && el.home) el.home.checked = result.prefs.commandHome !== false;
      if (result?.ok) writeStore("mefiStudio.commandHome", result.prefs.commandHome === false ? "0" : "1");
    });
    window.mefiStudio?.eyesCheckpointsRead?.().then((result) => {
      state.checkpoints = result?.checkpoints ?? {};
    });
    // The feed panel never opens cold: seed it from the store's recent
    // changes, then layer the live queue, briefing and autopilot status on top.
    window.mefiStudio?.eyesState?.().then((result) => {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      const changes = (Array.isArray(result?.changes) ? result.changes : [])
        .filter((change) => (change.time ?? 0) >= cutoff)
        .slice(0, 15);
      for (const change of [...changes].reverse()) {
        pushFeed({
          id: change.id,
          at: change.time,
          kind: "tool",
          tool: change.tool,
          file: basename(change.file),
          sessionId: change.sessionId,
        });
      }
    }).catch(() => {});
    window.mefiStudio?.eyesRequestsRead?.().then((result) => {
      state.requests = Array.isArray(result?.requests) ? result.requests : [];
      state.feedDirty = true;
      if (state.active) renderFeed();
    }).catch(() => {});
    window.mefiStudio?.eyesBriefingRead?.().then((result) => {
      state.briefing = result?.briefing ?? null;
      state.feedDirty = true;
      if (state.active) renderFeed();
    }).catch(() => {});
    window.mefiStudio?.assistantStatus?.().then((result) => {
      state.assistant = result?.status ?? result ?? null;
      state.feedDirty = true;
      if (state.active) renderFeed();
    }).catch(() => {});
    renderFeed();
    renderHint();
    bumpHud();
    state.lastTouch = Date.now();
    state.popupAt = Date.now() + 6000;
    if (state.zen) {
      bell({ long: true, low: true, level: 1 });
      bell({ quick: true, level: 0.7 });
    }
    // exit() handed the capture back. Take it again once per entry, bells on
    // or off, rather than on every bell: a refused request must not re-ask each
    // chime. Display capture needs a user gesture, so a gestureless auto-enter
    // can leave this pending — the input listener below retries on the first
    // real key/click.
    if (state.reactive) ensureReactiveInput();
    requestAnimationFrame(frame);
    state.timers.refresh = setInterval(tick, 4000);
    // A sheet may already cover the constellation (the quiet clock can open it
    // underneath one); stealing focus would break that dialog.
    if (!document.body.dataset.sheet) el.canvas.focus?.({ preventScroll: true });
    window.dispatchEvent(new CustomEvent("mefi:command", { detail: { active: true } }));
  }

  function exit() {
    if (!state.active) return;
    state.active = false;
    closeAmbience();
    hideTip();
    clearSearch();
    el.canvas.hidden = true;
    el.hud.hidden = true;
    el.hud.classList.remove("dim");
    el.hud.classList.remove("forced");
    if (state.hudTimer) clearTimeout(state.hudTimer);
    state.hudTimer = null;
    clearInterval(state.timers.refresh);
    state.selected = null;
    state.panning = null;
    state.rotating = null;
    state.hoverNode = null;
    state.hoverBubble = null;
    state.branch = null;
    if (el.info) {
      el.info.hidden = true;
      el.info.textContent = "";
    }
    state.cardScrollId = null;
    if (el.feedChat) el.feedChat.hidden = true;
    if (el.feedActivity) el.feedActivity.hidden = false;
    if (el.empty) el.empty.hidden = true;
    for (const popup of state.popups) popup.image.remove();
    state.popups = [];
    state.particles = [];
    state.pulses = [];
    if (state.audio?.state === "running") state.audio.suspend().catch(() => {});
    // Leaving Command hands the capture back: suspending the context alone
    // leaves the OS recording indicator lit for the rest of the session.
    releaseReactiveInput();
    const active = document.activeElement;
    if (active === el.canvas || el.hud.contains(active)) {
      (document.querySelector(".tab.active") ?? document.body).focus?.({ preventScroll: true });
    }
    document.body.classList.remove("command-active");
    window.dispatchEvent(new CustomEvent("mefi:command", { detail: { active: false } }));
  }

  function tick() {
    if (!state.active) return;
    if (document.body.dataset.sheet) return; // a sheet covers Command: do no work
    if (document.hidden) return; // hidden app: make no fetch; the visibilitychange listener snaps the view back on show
    refreshGraph();
    checkCollisions();
    updateTelemetry();
    if (autopilotJobs(state.assistant).length || chatMode()) state.feedDirty = true; // "running: … · Ns" and the chat status line age between status pushes
    renderFeed();
    if (state.ambient && Date.now() - state.popupAt > POPUP_MS) {
      state.popupAt = Date.now();
      popup();
    }
  }

  async function checkCollisions() {
    try {
      const result = await window.mefiStudio?.eyesCollisions?.();
      const colliding = (result?.collisions ?? []).flatMap((collision) =>
        (collision.sessions ?? []).map((entry) => (typeof entry === "string" ? entry : entry.sessionId))
      );
      const liveColliding = (result?.presence ?? [])
        .filter((row) => row?.colliding)
        .flatMap((row) => (row.editors ?? []).map((entry) => (typeof entry === "string" ? entry : entry.sessionId)));
      state.collisionSessions = new Set([...colliding, ...liveColliding].filter(Boolean));
    } catch {
      state.collisionSessions = new Set();
    }
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;
    el.canvas.width = width * dpr;
    el.canvas.height = height * dpr;
    el.canvas.style.width = width + "px";
    el.canvas.style.height = height + "px";
    el.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    el.width = width;
    el.height = height;
    state.labelWidths.clear();
    state.hudRectsAt = 0;
    if (state.camMode === "orbit") autoFit(); // a new window still shows every node
  }

  function armIdleTimer() {
    state.timers.idle = setInterval(() => {
      if (state.active) return;
      if (document.hidden) return; // a hidden window never idles into Command: no capture, bells or fetch work off-screen
      if (Date.now() - state.lastInput > IDLE_MS) enter();
    }, 10000);
  }

  function simulate({ pulses = 2, particles = 2, popup: withPopup = true } = {}) {
    bumpHud();
    const sessions = state.nodes.filter((node) => node.kind === "session");
    if (sessions.length) focusOn(sessions[0]);
    for (let index = 0; index < pulses && sessions.length; index += 1) {
      const session = sessions[index % sessions.length];
      const target = state.nodes.find((node) => node.sessionId === session.id && node.kind === "todo") ?? session;
      state.pulses.push({ from: session, to: target, start: Date.now() - index * 300, duration: 1600 });
    }
    for (let index = 0; index < particles && sessions.length; index += 1) {
      spawnParticles(sessions[index % sessions.length], 12);
    }
    if (withPopup) {
      state.popupAt = 0;
      popup(true);
    }
    state.angle += 0.4;
    for (const session of sessions.slice(0, 3)) {
      const touch = state.touches.get(session.id) ?? { count: 0, at: Date.now() };
      touch.count += 2;
      touch.at = Date.now();
      state.touches.set(session.id, touch);
      state.collisionSessions = new Set([...sessions.slice(0, 2).map((node) => node.id)]);
    }
  }

  function selectFirst(kind) {
    const node = state.nodes.find((entry) => entry.kind === kind);
    if (node) {
      selectNode(node);
      focusNode(node);
    }
    return node?.id ?? null;
  }

  // Command-view keys live here, but the help sheet is nav's: register one
  // display-only row per key so the two can never drift.
  const HELP_ROWS = [
    ["cmd-sessions", "← →", "Cycle sessions — or the siblings of the selected item"],
    ["cmd-children", "↑ ↓", "Up to the parent · down into todos and anchored tasks"],
    ["cmd-tasks", "[ ]", "Cycle task nodes"],
    ["cmd-enter", "Enter", "Run the selected node's first action"],
    ["cmd-dblclick", "Dbl-click", "Same, on the node you click"],
    ["cmd-rotate", "Right-drag", "Orbit the camera — sideways spins, vertical tilts"],
    ["cmd-fit", "F", "Fit the whole constellation"],
    ["cmd-branch", "Shift F", "Fit the selected branch"],
    ["cmd-home", "Home", "Select the root and fit"],
    ["cmd-zoom", "+ − 0", "Zoom in · out · reset"],
    ["cmd-orbit", "Space", "Pause / resume the orbit"],
    ["cmd-cam", "C", "Camera: orbit / follow / free"],
    ["cmd-view", "V", "Switch 3D orbit / flat 2D map"],
    ["cmd-labels", "L", "Node labels: auto / all / none"],
    ["cmd-search", "S", "Find a session, todo or task"],
    ["cmd-compose", "N", "Add a task"],
    ["cmd-assistant", "M", "Message the assistant"],
  ];

  function init() {
    if (!el.canvas) {
      el.canvas = document.getElementById("idle-layer");
      el.hud = document.getElementById("idle-hud");
      if (!el.canvas) return;
      el.ctx = el.canvas.getContext("2d");
      el.width = window.innerWidth;
      el.height = window.innerHeight;
    }
    el.info = document.getElementById("idle-info");
    el.chatLog = document.getElementById("cmd-chat");
    el.chatLogDot = document.getElementById("cmd-chat-dot");
    el.chatLogState = document.getElementById("cmd-chat-state");
    el.chatLogBody = document.getElementById("cmd-chat-body");
    el.chatLogThread = document.getElementById("cmd-chat-thread");
    el.chatLogInput = document.getElementById("cmd-chat-input");
    el.chatLogSend = document.getElementById("cmd-chat-send");
    el.chatLogToggle = document.getElementById("cmd-chat-toggle");
    el.chatLogJump = document.getElementById("cmd-chat-jump");
    el.telemetry = document.getElementById("idle-telemetry");
    el.taskInput = document.getElementById("idle-task-input");
    el.taskAdd = document.getElementById("idle-task-add");
    el.home = document.getElementById("idle-home");
    el.zen = document.getElementById("idle-zen");
    el.reactive = document.getElementById("idle-reactive");
    el.source = document.getElementById("idle-source");
    el.profile = document.getElementById("idle-profile");
    el.exitBtn = document.getElementById("idle-exit");
    el.search = document.getElementById("idle-search");
    el.searchCount = document.getElementById("idle-search-count");
    el.fitBtn = document.getElementById("idle-fit");
    el.orbitBtn = document.getElementById("idle-orbit");
    el.camOrbitBtn = document.getElementById("idle-cam-orbit");
    el.camFollowBtn = document.getElementById("idle-cam-follow");
    el.zoomIn = document.getElementById("idle-zoom-in");
    el.zoomOut = document.getElementById("idle-zoom-out");
    el.labelsBtn = document.getElementById("idle-labels");
    el.viewBtn = document.getElementById("idle-view");
    el.feed = document.getElementById("idle-feed");
    el.feedDot = document.getElementById("idle-feed-dot");
    el.feedState = document.getElementById("idle-feed-state");
    el.feedNow = document.getElementById("idle-feed-now");
    el.feedQueue = document.getElementById("idle-feed-queue");
    el.feedAgents = document.getElementById("idle-feed-agents");
    el.feedMenu = document.getElementById("idle-feed-menu");
    el.feedDrop = document.getElementById("idle-feed-drop");
    el.feedMeta = document.getElementById("idle-feed-meta");
    el.feedList = document.getElementById("idle-feed-list");
    el.feedActivity = document.getElementById("idle-feed-activity");
    el.feedChat = document.getElementById("idle-feed-chat");
    el.chatStatus = document.getElementById("idle-chat-status");
    el.chatThread = document.getElementById("idle-chat-thread");
    el.chatWork = document.getElementById("idle-chat-work");
    el.chatInput = document.getElementById("idle-chat-input");
    el.chatSend = document.getElementById("idle-chat-send");
    el.chatPause = document.getElementById("idle-chat-pause");
    el.chatChips = document.getElementById("idle-chat-chips");
    el.autopilotToggle = document.getElementById("idle-autopilot");
    el.ambienceBtn = document.getElementById("idle-ambience");
    el.pop = document.getElementById("idle-ambience-pop");
    el.legendToggle = document.getElementById("idle-legend-toggle");
    el.legend = document.getElementById("cmd-legend");
    el.legendList = document.getElementById("cmd-legend-list");
    el.empty = document.getElementById("cmd-empty");
    el.emptyTitle = document.getElementById("cmd-empty-title");
    el.emptyCopy = document.getElementById("cmd-empty-copy");
    el.emptyRetry = document.getElementById("cmd-empty-retry");
    el.emptyAssistant = document.getElementById("cmd-empty-assistant");
    el.tip = document.getElementById("cmd-tip");
    el.hint = document.getElementById("cmd-hint");
    el.top = el.hud?.querySelector(".cmd-top") ?? null;
    el.bottom = el.hud?.querySelector(".cmd-bottom") ?? null;
    el.pills = {};
    for (const name of ["sessions", "progress", "tasks", "ideas", "machine", "assistant", "offline"]) {
      el.pills[name] = el.telemetry?.querySelector(`[data-tele="${name}"]`) ?? null;
    }

    if (el.profile) {
      el.profile.innerHTML = PROFILE_ORDER.map((key) => `<option value="${key}" ${key === state.profile ? "selected" : ""}>${PROFILES[key].label}</option>`).join("");
      el.profile.addEventListener("change", () => {
        state.profile = el.profile.value;
        writeStore("mefiStudio.zenProfile", state.profile);
        bell({ quick: true, level: 0.8 });
      });
    }
    if (el.zen) {
      el.zen.checked = state.zen;
      el.zen.addEventListener("change", () => {
        state.zen = el.zen.checked;
        writeStore("mefiStudio.zen", state.zen ? "1" : "0");
        if (state.zen) bell({ long: true, low: true });
        else if (state.audio?.state === "running") state.audio.suspend().catch(() => {});
      });
    }
    if (el.reactive) {
      el.reactive.checked = state.reactive;
      el.reactive.addEventListener("change", () => {
        state.reactive = el.reactive.checked;
        writeStore("mefiStudio.zenReactive", state.reactive ? "1" : "0");
        if (el.source) el.source.disabled = !state.reactive;
        if (state.reactive) {
          ensureReactiveInput();
        } else {
          releaseReactiveInput();
        }
      });
    }
    if (el.source) {
      el.source.value = state.audioSource;
      el.source.disabled = !state.reactive;
      el.source.addEventListener("change", () => setAudioSource(el.source.value));
    }
    el.exitBtn?.addEventListener("click", exit);
    el.home?.addEventListener("change", () => {
      window.mefiStudio?.prefsSet?.({ commandHome: el.home.checked });
      writeStore("mefiStudio.commandHome", el.home.checked ? "1" : "0");
      window.MefiToast?.(`Command view ${el.home.checked ? "opens" : "stays off"} on launch`, "info");
    });

    const addTaskFromComposer = async () => {
      const text = el.taskInput?.value.trim();
      if (!text) return null;
      el.taskInput.value = "";
      // Adding a task IS messaging the assistant: the ask rides the thread
      // (visible in the chat log), the assistant creates the board task at
      // chat worth, kicks the executor, and both land without waiting for a
      // cadence. The direct board write is the browser-mode fallback only.
      if (window.mefiStudio?.assistantMessage) {
        const sent = await sendAssistant(text);
        if (sent?.ok) {
          window.MefiToast?.(`sent to the assistant · it is on the board and being scheduled`, "good");
          return sent;
        }
        if (!el.taskInput.value) el.taskInput.value = text; // hand the text back
        return null;
      }
      // Await the add so the list read below happens after the write landed.
      const created = await window.MefiTasks?.addTask(text);
      if (!created) {
        // Nothing was saved (tasks.js toasts the reason when it is loaded): hand
        // the text back unless the field has been typed into since.
        if (!el.taskInput.value) el.taskInput.value = text;
        return null;
      }
      await refreshTasks();
      refreshGraph();
      updateTelemetry();
      window.MefiToast?.(`task added · ${text.slice(0, 40)}`, "good");
      if (state.active) {
        const node = state.nodes.find((entry) => entry.id === `task:${created.id}`);
        if (node) {
          selectNode(node);
          focusNode(node, { zoom: 1.4 });
        }
      }
      return created;
    };
    el.taskAdd?.addEventListener("click", addTaskFromComposer);
    el.taskInput?.addEventListener("keydown", async (event) => {
      if (event.key !== "Enter") return;
      const created = await addTaskFromComposer();
      if (created && (event.ctrlKey || event.metaKey)) nav("tasks", { taskId: created.id });
    });

    el.search?.addEventListener("input", () => {
      clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(() => search(el.search.value), 80);
    });
    el.search?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") cycleMatch();
    });

    el.fitBtn?.addEventListener("click", () => setCamMode("orbit"));
    el.orbitBtn?.addEventListener("click", () => setOrbit());
    el.camOrbitBtn?.addEventListener("click", () => setCamMode(state.camMode === "orbit" ? "free" : "orbit"));
    el.camFollowBtn?.addEventListener("click", () => setCamMode(state.camMode === "follow" ? "free" : "follow"));
    el.zoomOut?.addEventListener("click", () => userZoom(state.zoom * 0.89));
    el.zoomIn?.addEventListener("click", () => userZoom(state.zoom * 1.12));
    el.labelsBtn?.addEventListener("click", () => setLabels(nextLabels()));
    el.viewBtn?.addEventListener("click", () => setView(state.view === "2d" ? "3d" : "2d"));
    el.autopilotToggle?.addEventListener("change", () => {
      window.mefiStudio?.assistantAutopilot?.({ enabled: el.autopilotToggle.checked, execute: el.autopilotToggle.checked });
    });
    el.chatSend?.addEventListener("click", () => sendAssistant(el.chatInput?.value));
    el.chatInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendAssistant(el.chatInput.value);
      }
    });
    el.chatInput?.addEventListener("input", () => growArea(el.chatInput));
    // The quick-ask chips send their prompt straight off — no typing needed.
    el.chatChips?.addEventListener("click", (event) => {
      const chip = event.target.closest("[data-msg]");
      if (chip) sendAssistant(chip.dataset.msg);
    });
    document.getElementById("idle-chat-tidy")?.addEventListener("click", () => assistantControl("tidy", "tidy"));
    document.getElementById("idle-chat-fix")?.addEventListener("click", () => assistantControl("fix", "fix"));
    document.getElementById("idle-chat-overseer")?.addEventListener("click", () => assistantControl("overseer", "overseer"));
    el.chatPause?.addEventListener("click", () => assistantControl(assistantFull()?.status === "paused" ? "resume" : "pause", "control"));
    // The right-side chat log: same thread, its own composer and collapse.
    state.chatLogOpen = readStore("mefiStudio.cmdChatLog") !== "0";
    applyChatLogOpen(state.chatLogOpen);
    el.chatLogSend?.addEventListener("click", () => sendAssistant(el.chatLogInput?.value, "log"));
    el.chatLogInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendAssistant(el.chatLogInput.value, "log");
      }
    });
    el.chatLogInput?.addEventListener("input", () => growArea(el.chatLogInput));
    el.chatLogToggle?.addEventListener("click", () => {
      applyChatLogOpen(!state.chatLogOpen);
      writeStore("mefiStudio.cmdChatLog", state.chatLogOpen ? "1" : "0");
    });
    el.chatLogJump?.addEventListener("click", () => selectAssistant({ focus: true }));
    el.chatLog?.querySelectorAll("[data-cmdchat-msg]")?.forEach((chip) => {
      chip.addEventListener("click", () => sendAssistant(chip.dataset.cmdchatMsg, "log"));
    });
    document.getElementById("idle-chat-explorer")?.addEventListener("click", () => nav("explorer", { assistant: true }));
    el.ambienceBtn?.addEventListener("click", toggleAmbience);
    el.legendToggle?.addEventListener("click", () => setLegend(!state.legendOpen));
    el.feedMenu?.addEventListener("click", () => setFeedMenu(!state.feedMenuOpen));
    setFeedMenu(state.feedMenuOpen);
    el.emptyRetry?.addEventListener("click", async () => {
      if (el.emptyRetry.disabled) return;
      el.emptyRetry.disabled = true;
      try {
        await window.MefiTree?.reload?.();
        refreshGraph();
        updateTelemetry(true);
      } finally {
        el.emptyRetry.disabled = false;
      }
    });
    pillOf("sessions")?.addEventListener("click", () => setCamMode("orbit"));
    pillOf("progress")?.addEventListener("click", () => focusNextInProgress());
    pillOf("assistant")?.addEventListener("click", () => selectAssistant());
    el.emptyAssistant?.addEventListener("click", () => selectAssistant({ focus: true }));

    // The broadcast carries the list that was just written. Using it skips a
    // second read that could land inside the next save and come back empty.
    window.mefiStudio?.onTasks?.(async (tasks) => {
      if (Array.isArray(tasks)) takeTasks(tasks);
      else await refreshTasks();
      if (state.active) refreshGraph();
    });
    window.addEventListener("resize", () => state.active && resize());

    // Mouse interacts with the constellation instead of dismissing it.
    // A right-drag orbits the camera; the menu key/gesture must not interrupt it.
    el.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    el.canvas.addEventListener("mousedown", (event) => {
      const rect = el.canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      state.ambient = false; // touching it makes it a menu
      if (state.panning || state.rotating) return; // a second button joins the drag in progress
      // The flat map has no orbit, so the right button pans there like the left.
      if (event.button === 2 && state.view !== "2d") {
        state.rotating = { x: event.clientX, y: event.clientY, angle: state.angle, pitch: state.pitch, moved: false };
        hideTip();
        return;
      }
      const bubbleNode = bubbleAt(x, y);
      if (bubbleNode) {
        selectNode(bubbleNode, { via: "bubble" });
        return;
      }
      // The finished "!" reads its task: select it, the ack follows.
      const exclNode = exclAt(x, y);
      if (exclNode) {
        selectNode(exclNode, { via: "excl" });
        return;
      }
      // An agent is part of the assistant: its click lands on the hub.
      const hit = nodeAt(x, y);
      const node = hit && hit.kind === "agent" ? assistantNode() ?? hit : hit;
      state.panning = { x: event.clientX, y: event.clientY, cam: { ...state.camera }, moved: false, node };
    });
    el.canvas.addEventListener("dblclick", (event) => {
      const rect = el.canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const bubbleNode = bubbleAt(x, y);
      if (bubbleNode) {
        selectNode(bubbleNode, { via: "bubble" });
        const details = el.info?.querySelector("details.card-cps");
        if (details) {
          details.open = true;
          details.scrollIntoView({ block: "nearest" });
        }
        return;
      }
      const exclNode = exclAt(x, y);
      if (exclNode) {
        primaryAction(exclNode);
        return;
      }
      const node = nodeAt(x, y);
      if (node) primaryAction(node);
      else setCamMode("orbit");
    });
    window.addEventListener("mousemove", (event) => {
      if (!state.active) return;
      const rect = el.canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (state.rotating) {
        const dx = event.clientX - state.rotating.x;
        const dy = event.clientY - state.rotating.y;
        if (!state.rotating.moved) {
          if (Math.hypot(dx, dy) <= 4) return;
          state.rotating.moved = true;
          hideTip();
        }
        state.angle = state.rotating.angle + dx * ROTATE_SPEED;
        state.pitch = Math.min(PITCH_MAX, Math.max(-PITCH_MAX, state.rotating.pitch + dy * ROTATE_SPEED));
        el.canvas.style.cursor = "grabbing";
        return;
      }
      if (state.panning) {
        if (!state.panning.moved) {
          if (Math.hypot(event.clientX - state.panning.x, event.clientY - state.panning.y) <= 4) return;
          state.panning.moved = true;
          setCamMode("free", { quiet: true }); // a drag is the user's camera now
          hideTip();
        }
        const scale = Math.max(0.2, state.fit * state.zoom);
        const dx = (event.clientX - state.panning.x) / scale;
        const dy = (event.clientY - state.panning.y) / scale;
        const base = state.panning.cam;
        if (state.view === "2d") {
          // flat map: screen deltas land on world x/z with no rotation
          state.camera.tx = base.tx + dx;
          state.camera.tz = base.tz + dy;
        } else {
          const cos = Math.cos(state.angle);
          const sin = Math.sin(state.angle);
          // screen x runs along the rotated x axis (rx = x*cos - z*sin), screen y along world y
          state.camera.tx = base.tx + dx * cos;
          state.camera.tz = base.tz - dx * sin;
          state.camera.ty = base.ty + dy;
        }
        state.camera.x = state.camera.tx;
        state.camera.y = state.camera.ty;
        state.camera.z = state.camera.tz;
        el.canvas.style.cursor = "grabbing";
        return;
      }
      if (event.target !== el.canvas) return;
      state.hoverNode = nodeAt(x, y) ?? exclAt(x, y);
      state.hoverBubble = bubbleAt(x, y);
      el.canvas.style.cursor = state.hoverNode || state.hoverBubble ? "pointer" : "default";
      refreshTip(x, y);
    });
    el.canvas.addEventListener("mouseleave", () => {
      state.hoverNode = null;
      state.hoverBubble = null;
      hideTip();
    });
    window.addEventListener("mouseup", () => {
      if (state.panning && !state.panning.moved) {
        const node = state.panning.node;
        if (node) {
          selectNode(node);
          focusNode(node, { zoom: node.kind === "session" || node.kind === "root" ? 1.6 : 1.9 });
        } else selectNode(null);
      }
      state.panning = null;
      state.rotating = null;
      if (state.active) el.canvas.style.cursor = "default";
    });
    el.canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        state.ambient = false;
        state.settleUntil = Date.now() + SETTLE_MS;
        userZoom(state.zoom * (event.deltaY > 0 ? 0.92 : 1.08));
      },
      { passive: false }
    );

    window.mefiStudio?.onMachineStatus?.((status) => {
      state.machineStatus = status;
      updateTelemetry(true);
    });
    window.mefiStudio?.onEyesActivity?.(onActivity);
    window.mefiStudio?.onStudioLog?.((line) => {
      const text = String(line ?? "");
      if (/^\[(assistant|autopilot|opencode)\]/.test(text)) pushFeed({ kind: "log", text: text.slice(0, 140) });
    });
    window.mefiStudio?.onBriefing?.((briefing) => {
      state.briefing = briefing ?? null;
      for (const alert of briefing?.alerts ?? []) {
        if (alert?.severity === "warn" || alert?.severity === "critical") pushFeed({ kind: "alert", text: alert.title ?? "alert" });
      }
      state.feedDirty = true;
      if (state.active) renderFeed();
    });
    window.mefiStudio?.onRequests?.((requests) => {
      state.requests = Array.isArray(requests) ? requests : [];
      state.feedDirty = true;
      if (state.active) renderFeed();
    });
    // The push carries the bare status object; assistantStatus() wraps it in
    // {ok, status} — accept either shape here.
    window.mefiStudio?.onAssistantStatus?.((status) => {
      state.assistant = status?.status ?? status ?? null;
      // Autopilot history (started/done/failed/paused) becomes gold "a-eyes"
      // feed rows. feedSeen + a stable id dedupe across status pushes; noFold
      // keeps each entry its own row instead of collapsing to a ×N count.
      for (const entry of state.assistant?.history ?? []) {
        if (!entry?.text) continue;
        const key = `${entry.at}|${entry.text}`;
        if (state.feedSeen.has(key)) continue;
        state.feedSeen.add(key);
        if (state.feedSeen.size > 300) state.feedSeen = new Set([...state.feedSeen].slice(-150));
        pushFeed({ id: `hist-${entry.at}-${entry.text}`, noFold: true, kind: "run", text: entry.text, at: entry.at });
      }
      // A pass just started: drift the camera to watch it work — unless the
      // user already picked a node, in which case their view wins.
      const jobs = autopilotJobs(state.assistant);
      // The builder nodes are built from this list, so any change to which jobs
      // are in flight has to redraw the graph — otherwise a run shows no agent
      // at all, or a finished one keeps orbiting a task nobody is building.
      const signature = jobs.map((job) => job.taskId ?? job.sessionId ?? job.title).join("|");
      if (signature !== state.builderSignature) {
        // A job id the last push did not carry is a builder the assistant just
        // sent out: mark it before the rebuild, pulse it after.
        const known = state.builderIds ?? new Set();
        const fresh = jobs.filter((job) => !known.has(job.taskId ?? job.sessionId ?? job.title));
        state.builderSignature = signature;
        state.builderIds = new Set(jobs.map((job) => job.taskId ?? job.sessionId ?? job.title));
        refreshGraph();
        // The hand-off, on screen: a packet pulse from the assistant to each
        // new builder, so a dispatch reads as the assistant sending work out.
        const hub = assistantNode();
        if (state.active && hub && fresh.length) {
          for (const job of fresh) {
            const key = job.taskId ?? job.sessionId ?? job.title;
            const node = state.nodes.find(
              (entry) => entry.kind === "agent" && entry.builder && (entry.job?.taskId ?? entry.job?.sessionId ?? entry.job?.title) === key,
            );
            if (!node) continue;
            state.pulses.push({ from: hub, to: node, start: Date.now(), duration: 1100, color: "#f1dcae", glow: "#e6c98d", wave: true, packet: true });
          }
          if (state.pulses.length > 24) state.pulses.splice(0, state.pulses.length - 24);
        }
      } else {
        // Same jobs, newer numbers: a run's todo fraction moved. Refresh the
        // meters in place — a full rebuild is for jobs joining or leaving.
        for (const node of state.nodes) {
          if (node.kind !== "agent" || !node.builder) continue;
          const key = node.job?.taskId ?? node.job?.sessionId ?? node.job?.title;
          const job = jobs.find((entry) => (entry.taskId ?? entry.sessionId ?? entry.title) === key);
          if (!job) continue;
          node.job = job;
          node.progress = typeof job.progress === "number" ? job.progress : null;
        }
      }
      // A pass starting or moving is the follow camera's business only: it
      // re-resolves the work node above via refreshGraph. Orbit and free keep
      // their view — no drifting to whichever node just started.
      state.feedDirty = true;
      if (state.active) renderFeed();
    });
    window.mefiStudio?.onCheckpoints?.((data) => {
      state.checkpoints = data ?? {};
      if (state.active) refreshGraph();
    });
    window.mefiStudio?.onAssistant?.(onAssistantEvent);
    // The rail's click on its assistant node lands here while Command is up.
    window.addEventListener("mefi:assistant-focus", (event) => {
      const node = event.detail?.node;
      if (node?.id) {
        // A rail click named a node — it pointed the assistant's work at it,
        // not the card. If the assistant's composer is up, stage the
        // instruction so one Enter sends it.
        const input = state.selected?.kind === "assistant" ? composerInput() : null;
        if (input && !input.disabled && !input.value.trim()) input.value = `Work on "${String(node.label ?? node.id).slice(0, 60)}"`;
        return;
      }
      if (state.active && !document.body.dataset.sheet) selectAssistant({ focus: true });
    });
    window.addEventListener("mefi:tree-select", () => {
      if (state.active) refreshGraph();
    });
    window.addEventListener("mefi:nav-badges", () => {
      if (state.active) updateTelemetry(true);
    });
    // A sheet closed over the constellation: catch up before it is looked at.
    window.addEventListener("mefi:nav", (event) => {
      if (event.detail?.action !== "close") return;
      if (!state.active || document.body.dataset.sheet) return;
      refreshGraph();
      updateTelemetry(true);
      bumpHud();
    });

    for (const [id, key, label] of HELP_ROWS) {
      window.MefiNav?.register?.({
        id,
        kind: "action",
        group: "command",
        key,
        label,
        short: label,
        glyph: null,
        badge: null,
        desc: label,
        showIn: { tabs: false, tools: false, dock: false, palette: false, help: true, footer: false },
      });
    }
    renderLegend();
    syncViewControls();
    renderHint();
    armIdleTimer();
    // Both timers bail while document.hidden (the refresh tick and the idle
    // auto-enter); one pass on show snaps the view and the quiet clock back
    // within a tick instead of waiting out the next interval.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) return;
      if (state.active) tick();
      else if (Date.now() - state.lastInput > IDLE_MS) enter();
    });
  }

  // Any interaction resets the quiet clock; a key, wheel or touch also turns the
  // screensaver into a menu (a bare mouse move must not).
  ["mousemove", "wheel", "touchstart", "keydown"].forEach((type) =>
    window.addEventListener(
      type,
      () => {
        state.lastInput = Date.now();
        if (state.active && type !== "mousemove") {
          state.ambient = false;
          el.hud?.classList.add("forced");
          // A gestureless auto-enter can leave a pending display-capture
          // request refused; a real key or click is the retry point.
          if (state.reactive && !state.inputStream && !state.inputPending) ensureReactiveInput();
        }
        bumpHud();
      },
      { passive: true }
    )
  );

  window.MefiIdle = {
    init,
    enter,
    exit,
    simulate,
    profiles: PROFILES,
    selectFirst,
    debugNodes: () => state.nodes.map((node) => ({ id: node.id, kind: node.kind, label: node.label, x: node._px, y: node._py })),
    isActive: () => state.active,
    escape,
    handleKey,
    selection,
    bumpHud,
    clearSearch,
    select,
    fitAll,
    setOrbit,
    setLabels,
    setAudioSource,
    search,
    selectAssistant,
    saveState,
    ready: () => state.readyPromise ?? Promise.resolve(),
    status: () => ({
      active: state.active,
      ambient: state.ambient,
      orbit: state.orbit,
      labels: state.labels,
      query: state.query,
      matches: state.matches.length,
      nodes: state.nodes.length,
      tree: state.treeStatus,
      audioSource: state.audioSource,
      listening: Boolean(state.inputStream),
    }),
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
