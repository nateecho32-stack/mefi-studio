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
    verify: [151, 179, 244], // cool periwinkle: a finished attempt being checked
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
  // Colour strings are built by the thousand per frame (an orb's halo, body
  // and rim, every edge and label). Memoize them per palette triple so a hot
  // frame reuses one string instead of joining and formatting it each time:
  // a WeakMap keyed on the triple array frees entries with the palette, and
  // the per-triple map stays small because alphas are a handful of literals
  // (a continuous alpha evicts the map past 64 entries).
  const colourCache = new WeakMap();
  const colourMap = (triple) => {
    let map = colourCache.get(triple);
    if (!map) { map = new Map(); colourCache.set(triple, map); }
    return map;
  };
  const rgb = (triple) => {
    const map = colourMap(triple);
    let value = map.get(-1);
    if (value === undefined) { value = `rgb(${triple.join(",")})`; map.set(-1, value); }
    return value;
  };
  const rgba = (triple, alpha) => {
    const map = colourMap(triple);
    let value = map.get(alpha);
    if (value === undefined) {
      if (map.size >= 64) map.clear();
      value = `rgba(${triple.join(",")},${alpha})`;
      map.set(alpha, value);
    }
    return value;
  };

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
    { key: "active", sw: rgb(NODE_RGB.warm), label: "current work — highlighted orb" },
    { key: "verify", sw: rgb(NODE_RGB.verify), label: "awaiting verification — cool blue rim" },
    { key: "done", sw: rgb(NODE_RGB.done), label: "completed todo" },
    { key: "pending", sw: rgb(NODE_RGB.pending), label: "pending todo" },
    { key: "stale", sw: rgb(NODE_RGB.stale), label: "stale session — pushed to the outer ring" },
    { key: "task", sw: rgb(NODE_RGB.task), label: "saved task — brighter while active" },
    { key: "checkpoint", sw: rgb(NODE_RGB.warm), label: "checkpoint note" },
    { key: "pulse", sw: rgb(NODE_RGB.pulse), label: "edit landing" },
    { key: "dust", sw: rgb(NODE_RGB.dust), label: "external read / web" },
    { key: "focus", sw: rgb(NODE_RGB.warm), label: "search match — bright orb and label" },
    { key: "assistant", sw: rgb(NODE_RGB.assistant), label: "the Studio assistant — M orb" },
    { key: "folded", sw: rgb(NODE_RGB.done), label: "finished sessions, folded into one node" },
    { key: "absorbed", sw: rgba(NODE_RGB.done, 0.8), label: "finished work — sinks into its host, readable on its card" },
    { key: "done-hold", sw: rgba(NODE_RGB.done, 0.95), label: "just finished — click ! to read its work" },
    { key: "work-pin", sw: "#7db2ff", label: "work on it — Next or Running label" },
    { key: "meter", sw: "linear-gradient(90deg, #e6c98d 62%, rgba(236,229,216,0.25) 62%)", label: "reported progress — shown only when known for active or inspected work" },
    {
      key: "agent",
      sw: agentSwatch(),
      label: "active assistant agent — orb in its role colour with its role glyph; a spinning ring means it is working",
    },
    { key: "speech", sw: rgba(NODE_RGB.session, 0.85), label: "speech bubble — what an agent is doing right now; → a report going out, ← one landing" },
    { key: "packet", sw: "#ffe9a8", label: "packet — a finding or a hand-out travelling between agents" },
    { key: "trail", sw: agentSwatch(), label: "trail — an agent in flight to the node it works on" },
    { key: "callout", sw: rgba(NODE_RGB.session, 0.8), label: "callout — leader, top bar with number and done/left, thoughts below; hover lifts it, click focuses" },
  ];
  const AGENT_STATES = new Set(["running", "queued", "error", "done"]);

  const LABEL_FONT = '600 13px system-ui, "Segoe UI", sans-serif'; // sessions
  const LABEL_FONT_TASK = '600 12px system-ui, "Segoe UI", sans-serif'; // task nodes
  const LABEL_FONT_TODO = '12px system-ui, "Segoe UI", sans-serif'; // todos
  const LABEL_FONT_ROOT = '600 11px system-ui, "Segoe UI", sans-serif'; // root
  const LABEL_FONT_AGENT = '11px system-ui, "Segoe UI", sans-serif'; // the assistant's agents
  const BUILDER_ORBIT = 15; // how far a running builder circles the node it is building
  const BUILDER_FIELD = 78; // and how far out it sits when that work is not on the board
  const LABEL_MAX_PX = 230; // measureText clamp
  const LABEL_CANDIDATES = 60; // most nodes considered per frame
  const LABEL_BUDGET = 40; // most labels drawn per frame
  const LABEL_PAD = 8; // leave air between chips as well as their text
  const LABEL_HEIGHT = 16; // tallest label line box
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
    { count: 52, seed: 11.3, spin: 0.012, tempo: 3400, size: 0.7, alpha: 0.22 },
    { count: 18, seed: 47.7, spin: 0.03, tempo: 2500, size: 1, alpha: 0.28 },
  ];
  // Backdrop scenes: the sky behind the constellation. "follow" picks the scene
  // that belongs to the active colour theme (Style & sound); any other key is
  // an explicit override, remembered per machine. Every scene is tinted from
  // the live palette, so a custom theme still gets its own sky.
  const BACKDROPS = {
    follow: "Follow theme",
    aurora: "Aurora ribbons",
    deepspace: "Deep space",
    nebula: "Nebula",
    embers: "Rising embers",
    fireflies: "Fireflies",
    bokeh: "Soft bokeh",
    dust: "Warm dust",
    grid: "Quiet grid",
    minimal: "Minimal",
  };
  const BACKDROP_ORDER = ["follow", "aurora", "deepspace", "nebula", "embers", "fireflies", "bokeh", "dust", "grid", "minimal"];
  const THEME_BACKDROP = { gold: "dust", midnight: "deepspace", forest: "fireflies", violet: "nebula", ember: "embers", aurora: "aurora", rose: "bokeh", custom: "dust",
    // The Void collection (members' themes, gated in music.js).
    void: "deepspace", eclipse: "dust", abyss: "fireflies", dusk: "grid" };
  // Speech bubbles: what an agent says while it works, drawn beside its orb.
  const SPEECH_TTL = 4200; // a plain remark
  const SPEECH_TTL_LONG = 6500; // a reply or a finding worth reading
  const SPEECH_MAX = 8; // bubbles on screen at once; the oldest yields
  const SPEECH_FADE_IN = 160;
  const SPEECH_FADE_OUT = 420;
  const SPEECH_FONT = '500 11px system-ui, "Segoe UI", sans-serif';
  const TRAIL_MS = 520; // how long a flying agent's wake lingers
  const TRAIL_MAX = 14;
  // Callouts: the leader leaves the orb at this angle, runs one of these
  // lengths, then turns into the horizontal top bar. A card keeps its place
  // for CALLOUT_HOLD_MS after something blocks it before it moves, so an
  // orbiting tree does not make the cards hop.
  const CALLOUT_ANGLE = (70 * Math.PI) / 180;
  const CALLOUT_COS = Math.cos(CALLOUT_ANGLE);
  const CALLOUT_SIN = Math.sin(CALLOUT_ANGLE);
  const CALLOUT_LENGTHS = [46, 74, 106, 140];
  const CALLOUT_MIN_W = 116;
  const CALLOUT_MAX_W = 236;
  const CALLOUT_TITLE_H = 17;
  const CALLOUT_SUB_H = 13; // the status line under the title (done/left, %, verifying)
  const CALLOUT_LINE_H = 14;
  const CALLOUT_BUDGET = 6; // full cards at rest; the rest fall back to compact labels, cards on hover / selection / focus
  const CALLOUT_HOLD_MS = 260;
  const CALLOUT_TITLE_FONT = '600 12.5px system-ui, "Segoe UI", sans-serif';
  const CALLOUT_NUMBER_FONT = '700 9.5px system-ui, "Segoe UI", sans-serif';
  const CALLOUT_COUNTS_FONT = '10.5px system-ui, "Segoe UI", sans-serif';
  const CALLOUT_LINE_FONT = SPEECH_FONT;
  const CARD_STYLES = ["auto", "outline", "filled"];
  // Focus: how close a click brings the camera, by what was clicked — less
  // on a parent so its children stay in frame — and the slow turn behind it.
  const FOCUS_ZOOM = { task: 2.4, todo: 2.4, agent: 2.2, session: 1.7, "task-group": 1.6, assistant: 1.45, root: 1.35, folded: 1.5 };
  const FOCUS_DRIFT = 0.55; // of ORBIT_BASE
  const ROTATE_SPEED = 0.005; // right-drag: radians per pixel
  const PITCH_MAX = 0.55; // right-drag vertical tilt clamp
  const CAMERA_EASE = 0.045;   // per 30 fps frame; drawFrame converts it to elapsed time
  // The camera's glide: seconds for a critically damped approach (95% in
  // about 2.4x this, velocity kept across retargets). See smoothDamp().
  const CAMERA_SMOOTH = 0.38;
  // A critically damped step toward target that keeps its velocity in
  // vel[key] (the Game Programming Gems 4 form): no overshoot, no lurch from
  // rest, and a retarget mid-flight bends the path instead of restarting it.
  function smoothDamp(current, target, vel, key, smoothTime, dt) {
    if (!(dt > 0)) return current;
    const omega = 2 / smoothTime;
    const x = omega * dt;
    const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const change = current - target;
    const temp = ((vel[key] ?? 0) + omega * change) * dt;
    vel[key] = ((vel[key] ?? 0) - omega * temp) * decay;
    return target + (change + temp) * decay;
  }
  const POPUP_MS = 45000; // evidence popup interval
  const HUD_DIM_MS = 6000;
  const AMBIENT_ZEN_MS = 30000;
  const DEFAULT_HINT = "click a node to zoom in · drag to pan · right-drag to orbit · wheel to zoom · V 2D/3D · Esc leaves";
  const LABEL_MODES = ["auto", "all", "none"];

  // Camera autopilot modes: "orbit" keeps the whole tree framed at the largest
  // zoom that still shows every node, "follow" tracks the node the agent's
  // work sits on, "free" is whatever the user does with pan/zoom/clicks.
  const CAM_MODES = ["orbit", "follow", "free"];

  const storedLabels = readStore("mefiStudio.cmdLabels");
  const initialAudioPreferences = readAudioPreferences();

  const state = {
    active: false,
    zen: readStore("mefiStudio.zen") !== "0",
    profile: PROFILES[readStore("mefiStudio.zenProfile")] ? readStore("mefiStudio.zenProfile") : "zen",
    reactive: readStore("mefiStudio.zenReactive") === "1",
    audioSource: ["auto", "local", "desktop", "mic"].includes(readStore("mefiStudio.audioSource.v2")) ? readStore("mefiStudio.audioSource.v2") : readStore("mefiStudio.zenSource") === "mic" ? "mic" : "auto",
    bands: { bass: 0, mid: 0, treble: 0 },
    music: null,
    audioResponse: initialAudioPreferences.response,
    audioEffects: { waves: initialAudioPreferences.waves, nodes: initialAudioPreferences.nodes, percussion: initialAudioPreferences.percussion, background: initialAudioPreferences.background, splitBands: initialAudioPreferences.splitBands },
    spectrumBuffer: null,
    waveformBuffer: null,
    inputSource: null,
    inputError: null,
    inputGeneration: 0,
    captureArmed: false, // OS capture starts only after an explicit control gesture in this visit.
    musicUiAt: 0,
    localAudio: null,
    mediaElements: new WeakMap(),
    nodes: [],
    edges: [],
    angle: 0.5,
    camera: { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0 },
    pulses: [],
    particles: [],
    touches: new Map(),
    collisionSessions: new Set(),
    popups: [],
    pngs: [],
    popupAt: 0,
    lastTouch: 0,
    energy: 0.4,
    fit: 1.6,
    overviewScale: 1,
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
    ambientZenEnabled: readStore("mefiStudio.ambientZen") === "1",
    ambientZen: false,
    zenRestore: null,
    tasks: [],
    allTasks: [],
    taskGroups: [],
    expandedTaskGroups: new Set(),
    taskLayout: new Map(),
    projectId: null, // the folder the command view is showing; a change reloads the tree
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
    pickerHoldUntil: 0,
    // Command-hub state
    ambient: true,
    // The Orbit switch (Space) as the owner last left it, remembered per machine.
    orbit: readStore("mefiStudio.cmdOrbit") === "auto" ? "auto" : "paused",
    nodeStyle: "orbs",
    nodeLayout: "constellation",
    orbitTrails: false,
    extraGlow: false,
    orbitVel: 0,
    settleUntil: 0,
    labels: LABEL_MODES.includes(storedLabels) ? storedLabels : "auto",
    legendOpen: readStore("mefiStudio.cmdLegend") === "1",
    feedMenuOpen: readStore("mefiStudio.cmdFeedMenu") === "1",
    feedCollapsed: readStore("mefiStudio.cmdFeedCollapsed") === "1",
    railTab: ["work", "settings", "assistant", "done", "ask"].includes(readStore("mefiStudio.cmdRailTab")) ? readStore("mefiStudio.cmdRailTab") : "work",
    // The tab to come back to when a selection clears. "node" is never stored.
    railHome: ["work", "settings", "assistant", "done", "ask"].includes(readStore("mefiStudio.cmdRailTab")) ? readStore("mefiStudio.cmdRailTab") : "work",
    focusMode: false,
    // Set when Esc takes the menus back by hand. Selecting another node then
    // leaves the chrome where the owner put it, until the selection clears.
    focusOptOut: false,
    railCollapsed: false,
    doneEntries: null,
    doneAt: 0,
    doneLoading: false,
    doneCollapsed: readStore("mefiStudio.cmdDoneCollapsed") === "1",
    doneFilter: "all",
    doneClearing: false,
    askSending: false,
    lastAssistantSelected: false,
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
    graphArea: null,
    graphAreaAt: 0,
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
    agentLayout: new Map(), // displayed positions survive graph/status rebuilds
    feed: [],
    feedDirty: true,
    backlog: null,
    backlogReadAt: 0,
    backlogReadPending: false,
    backlogRevision: 0,
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
    follow: null,
    followReadAt: 0,
    followZoomTarget: null,
    zoomTarget: null, // a zoom the camera glides to (a click, a search hit); null once settled
    cameraMoving: false, // set per frame while the camera or its zoom is still in flight
    center: null, // the eased projection centre (stepCenter); null snaps it on the next frame
    graphFrame: null, // the rectangle between the fixed rails, before floating panels carve it (usableArea)
    followStatusKey: "",
    completedTaskIds: new Set(),
    // Resolves when an enter()'s first tasks+graph build has settled; the
    // boot sequence waits on it before its fade reveals the constellation.
    readyPromise: null,
    workOnBusy: false,
    newWorkBusy: false,
    // Backdrop scene and speech bubbles (Ambience pop), remembered per machine.
    backdrop: BACKDROP_ORDER.includes(readStore("mefiStudio.cmdBackdrop")) ? readStore("mefiStudio.cmdBackdrop") : "follow",
    themeKey: null, // the Style & sound key the canvas last synced to
    bubbles: readStore("mefiStudio.cmdBubbles") !== "0",
    speech: new Map(), // node id → the bubble it is showing
    speechRects: [], // bubble surfaces drawn this frame; labels step around them
    hoverSpeech: null, // node id whose bubble is under the pointer (it stays up)
    deferred: [], // { at, run }: frame-stepped timers for staggered effects
    agentTrails: new Map(), // node id → recent screen points of a flying agent
    agentPhases: {}, // role → the motion phase last seen, for arrival remarks
    callouts: new Map(), // node id → the placement its callout keeps between frames
    calloutRects: [], // card surfaces drawn this frame; labels and bubbles step around them
    hoverCallout: null, // node id whose callout is under the pointer (it lifts)
    focus: null, // { id, kind, since }: the node a click zoomed onto; the rest blurs behind it
    focusRestore: null, // what focus changed (the orbit setting), put back on exit
    focusIds: null, // this frame's sharp set, read by the label and bubble painters
    cardStyle: CARD_STYLES.includes(readStore("mefiStudio.cmdCardStyle")) ? readStore("mefiStudio.cmdCardStyle") : "auto",
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
      state.analyser.fftSize = 2048;
      state.analyser.smoothingTimeConstant = 0;
      state.analyser.minDecibels = -120;
      state.analyser.maxDecibels = -10;
      state.bus.connect(state.analyser);
      state.analyser.connect(state.audio.destination);
    } catch {
      state.audio = null;
    }
    if (state.audio && state.reactive) useReactiveInput();
    return state.audio;
  }

  // Auto follows the Studio player when a local track is loaded. Explicit
  // Desktop and Microphone choices keep their source even as the queue changes.
  // Captured input feeds an analyser without monitoring it through the speakers.
  function useReactiveInput() {
    // inputStream only lands when the request resolves; inputPending holds the
    // source kind in flight so a same-source caller cannot double-request while
    // a source switch can still supersede a stale pending request.
    if (!state.reactive || !state.active) return;
    const selection = state.audioSource;
    const mic = selection === "mic";
    const kind = mic ? "mic" : "desktop";
    // Imported tracks can feed the analyser directly, without a second audio
    // capture request. Spotify stays external because its frame is isolated.
    const localElement = selection === "auto" || selection === "local" ? localMusicElement() : null;
    if (state.audio && localElement) { useLocalMusicInput(localElement); return; }
    if (selection === "local") { renderMusicStatus(true); return; }
    if (!state.audio || !state.captureArmed || state.inputStream || state.inputPending === kind || state.inputError) return;
    const generation = ++state.inputGeneration;
    let request;
    try {
      request = mic
        ? navigator.mediaDevices?.getUserMedia?.({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
        : navigator.mediaDevices?.getDisplayMedia?.({ video: true, audio: true });
    } catch (error) {
      state.inputError = String(error?.message ?? "Audio access unavailable");
      renderMusicStatus(true);
      return;
    }
    if (!request) {
      state.inputError = "Audio capture is unavailable in this window";
      renderMusicStatus(true);
      return;
    }
    state.inputPending = kind;
    renderMusicStatus(true);
    Promise.resolve(request)
      .then((stream) => {
        if (generation === state.inputGeneration) state.inputPending = null;
        // The request can resolve after the switch went off, after the view
        // was left, or after the source select moved on: hand the device
        // straight back instead of glowing to a source nobody asked for.
        if (generation !== state.inputGeneration || !state.reactive || !state.active || state.audioSource !== selection) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        // Desktop loopback arrives as screen video + system audio. Nothing
        // renders the video, so its track goes straight back to the OS and the
        // stream keeps only the audio.
        if (!mic) stream.getVideoTracks().forEach((track) => track.stop());
        if (!stream.getAudioTracks().length) {
          stream.getTracks().forEach((track) => track.stop());
          state.inputError = "No audio was shared. Choose a source with audio enabled";
          renderMusicStatus(true);
          return;
        }
        state.inputStream = stream;
        const source = state.audio.createMediaStreamSource(stream);
        const inputAnalyser = state.audio.createAnalyser();
        inputAnalyser.fftSize = 2048;
        inputAnalyser.smoothingTimeConstant = 0;
        inputAnalyser.minDecibels = -120;
        inputAnalyser.maxDecibels = -10;
        source.connect(inputAnalyser);
        state.inputSource = source;
        state.analyser = inputAnalyser;
        state.music = null;
        for (const track of stream.getAudioTracks()) track.addEventListener?.("ended", () => {
          if (state.inputStream !== stream) return;
          releaseReactiveInput();
          state.inputError = "Audio source disconnected. Click Connect audio to reconnect";
          renderMusicStatus(true);
        }, { once: true });
        renderMusicStatus(true);
      })
      .catch((error) => {
        if (generation !== state.inputGeneration) return;
        state.inputPending = null;
        if (state.inputStream) releaseReactiveInput();
        state.inputError = error?.name === "NotAllowedError" ? "Audio access was not allowed. Click Connect audio to try again" : String(error?.message ?? "Audio capture could not start");
        renderMusicStatus(true);
      });
  }

  function ensureReactiveInput() {
    if (!state.reactive) return;
    ensureAudio();
    useReactiveInput();
  }

  // Radio runs on Studio's own decks, so it reaches the analyser the same way a
  // local file does; Spotify stays external. A tuned station has no queue, and
  // the src test below is the real "something is loaded" check either way.
  function localMusicElement() {
    const player = window.MefiMusic?.status?.();
    if (player?.source !== "local" && player?.source !== "radio") return null;
    if (player.source === "local" && !(player.queueLength > 0)) return null;
    const element = window.MefiMusic?.getAudioElement?.();
    return element && (element.getAttribute?.("src") || element.src || element.currentSrc) ? element : null;
  }

  function useLocalMusicInput(element) {
    if (state.localAudio?.element === element) return true;
    try {
      if (state.inputStream || state.inputPending) releaseReactiveInput();
      let record = state.mediaElements.get(element);
      if (!record) {
        const source = state.audio.createMediaElementSource(element);
        source.connect(state.audio.destination);
        const analyser = state.audio.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0;
        analyser.minDecibels = -120;
        analyser.maxDecibels = -10;
        // This output stays connected after leaving Command. Turning off the
        // visualizer must never mute a track that the player is still playing.
        record = { element, source, analyser, connected: false };
        state.mediaElements.set(element, record);
      }
      if (!record.connected) { record.source.connect(record.analyser); record.connected = true; }
      state.localAudio = record;
      state.analyser = record.analyser;
      state.inputError = null;
      state.music = null;
      renderMusicStatus(true);
      return true;
    } catch (error) {
      state.inputError = String(error?.message ?? "This track could not connect to the visualizer");
      renderMusicStatus(true);
      return false;
    }
  }

  // Stopping the tracks is what clears the OS capture/recording indicator;
  // dropping the handle lets useReactiveInput() acquire again later, and the
  // glow goes back to the bell bus instead of reading a dead analyser.
  function releaseReactiveInput() {
    state.inputGeneration += 1;
    state.captureArmed = false;
    state.inputPending = null;
    const stream = state.inputStream;
    const local = state.localAudio;
    state.localAudio = null;
    if (local?.connected) { local.source.disconnect(local.analyser); local.connected = false; }
    state.inputStream = null;
    stream?.getTracks().forEach((track) => track.stop());
    state.inputSource?.disconnect();
    state.inputSource = null;
    state.music = null;
    state.bands = { bass: 0, mid: 0, treble: 0 };
    if (!stream && !local) { renderMusicStatus(true); return; }
    if (!state.audio || !state.bus) return;
    state.bus.disconnect();
    state.analyser = state.audio.createAnalyser();
    state.analyser.fftSize = 2048;
    state.analyser.smoothingTimeConstant = 0;
    state.analyser.minDecibels = -120;
    state.analyser.maxDecibels = -10;
    state.bus.connect(state.analyser);
    state.analyser.connect(state.audio.destination);
    renderMusicStatus(true);
  }

  function setAudioSource(source) {
    const next = ["auto", "local", "desktop", "mic"].includes(source) ? source : "auto";
    if (next === state.audioSource) return;
    state.audioSource = next;
    state.inputError = null;
    writeStore("mefiStudio.audioSource.v2", next);
    if (el.source) el.source.value = next;
    if (state.reactive && state.active) {
      releaseReactiveInput();
      state.captureArmed = true;
      ensureReactiveInput();
    }
    renderMusicStatus(true);
  }

  function setMusicReactive(enabled) {
    state.reactive = Boolean(enabled);
    state.captureArmed = state.reactive;
    state.inputError = null;
    writeStore("mefiStudio.zenReactive", state.reactive ? "1" : "0");
    if (el.reactive) el.reactive.checked = state.reactive;
    if (el.source) el.source.disabled = false;
    if (state.reactive && state.active) ensureReactiveInput();
    else releaseReactiveInput();
    renderMusicStatus(true);
  }

  function renderMusicStatus(force = false) {
    const now = Date.now();
    if (!force && now - state.musicUiAt < 100) return;
    state.musicUiAt = now;
    const status = audioStatus();
    const { listening } = status;
    const enabled = state.reactive && (listening || state.inputPending || state.audioSource === "local" && !state.inputError);
    if (el.musicStatus) el.musicStatus.textContent = status.text;
    if (el.musicToggle) {
      el.musicToggle.setAttribute("aria-pressed", String(Boolean(enabled)));
      el.musicToggle.dataset.state = state.inputError ? "error" : listening ? "listening" : state.inputPending ? "pending" : "off";
      el.musicToggle.title = `${status.description} ${enabled ? "Click to stop linking." : "Click to connect."} Change source in Style & sound.`;
      el.musicToggle.setAttribute("aria-label", status.text);
    }
    if (el.musicLevel) {
      el.musicLevel.style.setProperty("--music-level", String(listening && !noMotion() ? state.music?.energy ?? 0 : 0));
      for (const [index, band] of ["bass", "mid", "treble"].entries()) {
        const bar = el.musicLevel.children[index];
        if (bar) bar.style.setProperty("--band-level", String(listening && !noMotion() ? state.bands[band] : 0));
      }
    }
    // Publish connection/player transitions, not every FFT frame. Controls can
    // stay synchronized without a separate polling loop or noisy live region.
    const key = JSON.stringify([status.reactive, status.selection, status.source, status.phase, status.text, status.error, status.response, status.effects]);
    if (key !== state.audioUiKey) {
      state.audioUiKey = key;
      if (typeof CustomEvent === "function") window.dispatchEvent?.(new CustomEvent("mefi-audio-change", { detail: status }));
    }
  }

  function audioStatus() {
    const listening = Boolean(state.inputStream || state.localAudio);
    const pending = Boolean(state.inputPending);
    const source = state.localAudio ? "local" : state.inputStream || pending ? state.audioSource === "mic" ? "mic" : "desktop" : state.audioSource;
    const paused = Boolean(state.localAudio?.element?.paused || state.localAudio?.element?.ended);
    const sourceName = source === "mic" ? "Microphone" : source === "local" ? "Studio player" : "Desktop audio";
    const phase = !state.reactive ? "off" : state.inputError ? "error" : pending ? "pending" : listening ? paused ? "paused" : "listening" : "ready";
    const text = phase === "off" ? "Audio link off" : phase === "error" ? "Audio unavailable" : phase === "pending" ? "Connecting audio…" : phase === "paused" ? "Track paused" : phase === "listening" ? (state.music?.energy > 0.035 ? `${source === "local" ? "Track" : source === "mic" ? "Mic" : "Desktop"} linked` : "Listening · quiet") : state.audioSource === "local" ? "Add a track to link" : "Connect audio";
    const description = state.inputError || (listening ? paused ? "Studio track is paused. Play it to animate the nodes." : `Following ${sourceName.toLowerCase()}. Bass, mids and treble animate the nodes and connections.` : pending ? `Connecting to ${sourceName.toLowerCase()}…` : state.audioSource === "local" ? "Add a local track, then play it to animate the nodes." : state.audioSource === "auto" ? "Follows loaded Studio tracks directly. Connect to desktop audio when no track is loaded." : `Connect to ${sourceName.toLowerCase()} to animate the nodes.`);
    return { reactive: state.reactive, selection: state.audioSource, source, listening, pending, error: state.inputError, phase, text, label: text, description, response: state.audioResponse ?? 0.35, effects: { waves: state.audioEffects?.waves !== false, nodes: state.audioEffects?.nodes !== false, percussion: state.audioEffects?.percussion === true, background: state.audioEffects?.background === true, splitBands: state.audioEffects?.splitBands !== false }, bands: { ...state.bands }, energy: state.music?.energy ?? 0, beat: state.music?.beat ?? 0, kick: state.music?.kick ?? 0, snare: state.music?.snare ?? 0, hat: state.music?.hat ?? 0, bassline: state.music?.bassline ?? 0 };
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

  // Float FFT magnitudes retain quiet notes that byte spectra round away. Each
  // band follows its own recent level; normalization changes only the picture,
  // never playback volume. Positive spectral changes give low/mid/high attack
  // cues (kick/snare/hat), while sustained bass has its own smooth envelope.
  // These are rhythmic signal features, not instrument or stem separation.
  function analyzeMusicSpectrum(buffer, sampleRate, fftSize, previous, now, options = {}) {
    const clamp = (value) => Math.max(0, Math.min(1, value));
    const prior = previous ?? {};
    const dt = Math.max(1, Math.min(1000, now - (prior.at ?? now - 33)));
    const hzPerBin = (Number(sampleRate) || 48000) / (Number(fftSize) || buffer.length * 2 || 2048);
    const envelope = (old = 0, target, attack = 55, release = 260) => old + (target - old) * (1 - Math.exp(-dt / (target > old ? attack : release)));
    const samples = options.waveform;
    let wavePeak = 0;
    if (samples?.length) {
      for (let index = 0; index < samples.length; index += 1) wavePeak = Math.max(wavePeak, Math.abs(Number(samples[index]) || 0));
    }
    const waveGate = clamp((20 * Math.log10(Math.max(1e-12, wavePeak)) + 112) / 12);
    const amplitudes = new Float32Array(buffer.length);
    let spectrumPeak = 0;
    for (let index = 1; index < buffer.length; index += 1) {
      const value = Number(buffer[index]);
      amplitudes[index] = options.decibels ? Number.isFinite(value) ? 10 ** (Math.min(0, value) / 20) : 0 : clamp((value || 0) / 255);
      if (index * hzPerBin >= 20 && index * hzPerBin < 16000) spectrumPeak = Math.max(spectrumPeak, amplitudes[index]);
    }
    const bandState = {}, targets = {}, attacks = {};
    for (const [name, fromHz, toHz, cue, hold] of [
      ["bass", 20, 250, "kick", 125], ["mid", 250, 4000, "snare", 95], ["treble", 4000, 16000, "hat", 65],
    ]) {
      const from = Math.max(1, Math.ceil(fromHz / hzPerBin));
      const to = Math.min(buffer.length, Math.ceil(toHz / hzPerBin));
      const history = prior.bandState?.[name] ?? {};
      let squares = 0, peak = 0, fluxSquares = 0, fluxPeak = 0;
      for (let index = from; index < to; index += 1) {
        const value = amplitudes[index];
        const delta = Math.max(0, value - (prior.spectrum?.[index] ?? 0));
        squares += value * value;
        peak = Math.max(peak, value);
        fluxSquares += delta * delta;
        fluxPeak = Math.max(fluxPeak, delta);
      }
      const count = Math.max(1, to - from);
      const raw = Math.sqrt(squares / count) * 0.65 + peak * 0.35;
      // Time samples establish the source floor: FFT windowing spreads a quiet
      // drum across bins far below its audible waveform level. The FFT-only
      // fallback allows that extra headroom. Relative gating prevents a loud
      // sine's faint FFT leakage from lighting every frequency band.
      const sourceGate = samples?.length ? waveGate : clamp((20 * Math.log10(Math.max(1e-12, peak)) + 120) / 12);
      const gate = sourceGate * clamp((peak / Math.max(1e-12, spectrumPeak) - 0.001) / 0.003);
      const oldReference = Math.max(1e-7, history.reference ?? raw);
      // Release in log space lets a large volume reduction settle in seconds,
      // instead of waiting through a long linear peak decay from a loud track.
      const reference = Math.max(1e-7, raw, oldReference * Math.exp(Math.log(Math.max(1e-7, raw) / oldReference) * (1 - Math.exp(-dt / 900))));
      const target = clamp(raw / reference * 0.86) * gate;
      const flux = clamp((Math.sqrt(fluxSquares / count) * 0.65 + fluxPeak * 0.35) / reference * Math.min(2, 33 / dt)) * gate;
      const onset = target > 0.12 && flux > Math.max(0.14, (history.fluxMean ?? 0) * 1.8 + 0.045) && now - (history.lastOnset ?? -1000) >= hold;
      targets[name] = target;
      attacks[cue] = onset ? clamp(0.42 + flux * 0.65) * gate : 0;
      bandState[name] = { reference, raw, fluxMean: envelope(history.fluxMean, flux, 700, 700), lastOnset: onset ? now : history.lastOnset ?? -1000 };
    }
    const kick = Math.max(attacks.kick, (prior.kick ?? 0) * Math.exp(-dt / 190));
    const snare = Math.max(attacks.snare, (prior.snare ?? 0) * Math.exp(-dt / 135));
    const hat = Math.max(attacks.hat, (prior.hat ?? 0) * Math.exp(-dt / 85));
    const onset = Math.max(attacks.kick, attacks.snare, attacks.hat);
    const sorted = Object.values(targets).sort((a, b) => b - a);
    const level = sorted[0] * 0.62 + sorted[1] * 0.25 + sorted[2] * 0.13;
    const waveform = new Array(64).fill(0);
    let waveStart = 0;
    if (samples?.length) {
      // Align the beginning to a rising crossing to keep long bass waves legible.
      for (let index = 1; index < Math.min(256, samples.length / 4); index += 1) {
        if (samples[index - 1] <= 0 && samples[index] > 0) { waveStart = index; break; }
      }
    }
    for (let index = 0; index < waveform.length; index += 1) {
      const position = waveStart + index * Math.max(0, (samples?.length ?? 1) - waveStart - 1) / (waveform.length - 1);
      const left = Math.floor(position), fraction = position - left;
      const sample = samples?.length ? (Number(samples[left]) || 0) * (1 - fraction) + (Number(samples[Math.min(left + 1, samples.length - 1)]) || 0) * fraction : 0;
      const target = Math.max(-1, Math.min(1, sample / Math.max(1e-7, wavePeak))) * waveGate;
      waveform[index] = envelope(prior.waveform?.[index], target, samples?.length && waveGate ? 24 : 90, samples?.length && waveGate ? 24 : 90);
    }
    return {
      at: now,
      bass: envelope(prior.bass, targets.bass),
      mid: envelope(prior.mid, targets.mid, 45, 220),
      treble: envelope(prior.treble, targets.treble, 32, 155),
      energy: envelope(prior.energy, level, 65, 280),
      beat: Math.max(onset, (prior.beat ?? 0) * Math.exp(-dt / 190)),
      kick, snare, hat, bassline: envelope(prior.bassline, targets.bass, 100, 360), waveform,
      bassMean: envelope(prior.bassMean, bandState.bass.raw, 650, 650), bassRaw: bandState.bass.raw,
      lastBeat: onset ? now : prior.lastBeat ?? -1000, peak: spectrumPeak, bandState, spectrum: amplitudes,
    };
  }

  function audioEnergy() {
    if (!state.analyser || state.reactive && !state.inputStream && !state.localAudio) {
      state.energy = state.reactive ? 0 : 0.25;
      state.bands.bass = state.bands.mid = state.bands.treble = 0;
      state.music = null;
      renderMusicStatus();
      return state.energy;
    }
    const decibels = typeof state.analyser.getFloatFrequencyData === "function";
    const BufferType = decibels ? Float32Array : Uint8Array;
    if (!(state.spectrumBuffer instanceof BufferType) || state.spectrumBuffer.length !== state.analyser.frequencyBinCount) state.spectrumBuffer = new BufferType(state.analyser.frequencyBinCount);
    const paused = state.localAudio?.element?.paused || state.localAudio?.element?.ended;
    if (paused) state.spectrumBuffer.fill(decibels ? -Infinity : 0);
    else if (decibels) state.analyser.getFloatFrequencyData(state.spectrumBuffer);
    else state.analyser.getByteFrequencyData(state.spectrumBuffer);
    let waveform;
    if (typeof state.analyser.getFloatTimeDomainData === "function") {
      if (state.waveformBuffer?.length !== state.analyser.fftSize) state.waveformBuffer = new Float32Array(state.analyser.fftSize);
      if (paused) state.waveformBuffer.fill(0);
      else state.analyser.getFloatTimeDomainData(state.waveformBuffer);
      waveform = state.waveformBuffer;
    }
    state.music = analyzeMusicSpectrum(state.spectrumBuffer, state.audio?.sampleRate, state.analyser.fftSize, state.music, Date.now(), { decibels, waveform });
    state.bands.bass = state.music.bass;
    state.bands.mid = state.music.mid;
    state.bands.treble = state.music.treble;
    state.energy = state.music.energy;
    renderMusicStatus();
    return state.energy;
  }

  // ---------- layout / projection ----------
  function visibleGraphSnapshot(snapshot, candidates = snapshot.nodes) {
    const nodes = candidates.filter((node) => node.kind !== "agent" || node.status === "running" || node.retiring);
    const indices = new Map(nodes.map((node, index) => [node.id, index]));
    const edges = snapshot.edges.map((edge) => ({ ...edge, a: indices.get(snapshot.nodes[edge.a]?.id), b: indices.get(snapshot.nodes[edge.b]?.id) }))
      .filter((edge) => edge.a != null && edge.b != null);
    return { nodes, edges };
  }

  function refreshGraph() {
    const profiler = globalThis.window?.MefiProfiler;
    const span = profiler?.begin("command.graph");
    try { return refreshGraphImpl(); }
    finally { profiler?.end(span); }
  }

  function refreshGraphImpl() {
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
    const visible = visibleGraphSnapshot(snapshot, absorbFoldedCluster(snapshot.nodes));
    state.nodes = visible.nodes.map((node) => ({ ...node, bx: node.x, by: node.y, bz: node.z }));
    state.edges = visible.edges;
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
    appendMusicNode();
    appendTaskNodes();
    appendDoneHoldNodes();
    appendBuilderNodes();
    sweepFx();
    // Callout numbers: sessions in the order the tree shows them, tasks in
    // board order — stable while the board holds, never derived from a slot.
    let sessionOrdinal = 0;
    for (const node of state.nodes) if (node.kind === "session") node.ordinal = `S${++sessionOrdinal}`;
    const boardIndex = new Map((state.allTasks?.length ? state.allTasks : state.tasks ?? []).map((task, index) => [String(task.id), index + 1]));
    for (const node of state.nodes) if ((node.kind === "task" || node.kind === "task-group") && node.task) node.ordinal = `T${boardIndex.get(String(node.task.id)) ?? "?"}`;
    const firstGraph = !state.graphSeeded;
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
    if (firstGraph) autoFit();
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

  function musicNodeDetails() {
    const player = window.MefiMusic?.status?.();
    if (!player) return null;
    const title = String(player.title || "Music player");
    return {
      music: player,
      label: player.source === "spotify" ? "Spotify · open player" : player.playing ? `Playing · ${title}` : player.source === "radio" ? `Radio · ${title}` : player.queueLength ? `Music · ${title}` : "Music · add tracks",
      state: player.playing ? "active" : "music",
    };
  }

  function appendMusicNode() {
    const details = musicNodeDetails();
    if (!details) return;
    state.nodes.push({ id: "__music__", kind: "music", ...details, r: 7, x: 150, y: -100, z: -65, bx: 150, by: -100, bz: -65 });
  }

  function syncMusicNode() {
    const details = musicNodeDetails();
    const node = state.nodes.find((entry) => entry.kind === "music");
    if (node && details) Object.assign(node, details);
    else if (details && state.active) refreshGraph();
    if (details?.music.playing && state.audio?.state === "suspended") state.audio.resume().catch(() => {});
    if (!state.reactive || !state.active) return;
    const element = localMusicElement();
    if (element && (state.audioSource === "auto" || state.audioSource === "local")) {
      state.inputError = null;
      ensureReactiveInput();
    } else if (state.localAudio) {
      releaseReactiveInput();
    }
    renderMusicStatus(true);
  }

  // Reserve stable positions for visible tasks. A priority/status update may
  // change which cards lead the queue, but must not shuffle every node around.
  function taskPlacements(tasks, graphNodes, jobs, previous = new Map(), retainedIds = new Set(tasks.map((task) => task.id))) {
    const sessions = graphNodes.filter((node) => node.kind === "session");
    const keys = (text) => new Set((String(text).toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g) ?? []).slice(0, 8));
    const entries = tasks.map((task) => {
      const sessionId = jobs.find((job) => job.taskId === task.id)?.sessionId ?? task.run?.sessionId;
      let anchor = sessions.find((session) => sessionId && (session.id === sessionId || session.sessionId === sessionId)) ?? null;
      if (!anchor) {
        const taskKeys = keys(`${task.title} ${task.prompt ?? ""}`);
        let best = 1; // a single generic word is not enough to claim a relationship.
        for (const session of sessions) {
          const words = keys(session.label);
          const score = [...taskKeys].filter((word) => words.has(word)).length;
          if (score > best) { best = score; anchor = session; }
        }
      }
      return { task, anchor, group: anchor?.id ?? "__loose__" };
    });
    const used = new Map();
    const reserve = (group, slot) => {
      const slots = used.get(group) ?? new Set();
      slots.add(slot); used.set(group, slots);
    };
    const layout = new Map([...previous].filter(([id]) => retainedIds.has(id)));
    // A real assignment change moves the task into its new branch and frees
    // the old slot. Status and priority changes retain the same position.
    for (const entry of entries) if (layout.get(entry.task.id)?.group !== entry.group) layout.delete(entry.task.id);
    for (const prior of layout.values()) reserve(prior.group, prior.slot);
    for (const entry of entries) {
      const prior = layout.get(entry.task.id);
      if (prior && Number.isInteger(prior.slot) && prior.slot >= 0) {
        entry.slot = prior.slot; entry.group = prior.group; reserve(entry.group, prior.slot);
      }
    }
    for (const entry of entries) {
      if (entry.slot == null) {
        let slot = 0;
        while (used.get(entry.group)?.has(slot)) slot += 1;
        entry.slot = slot; reserve(entry.group, slot);
      }
      const { anchor, slot } = entry;
      const angle = slot * 2.399963;
      const radius = anchor ? 78 + Math.floor(slot / 4) * 32 : 215 + Math.floor(slot / 12) * 34;
      const prior = layout.get(entry.task.id);
      entry.x = Number.isFinite(prior?.x) ? prior.x : (anchor?.x ?? 0) + Math.cos(angle) * radius;
      entry.y = Number.isFinite(prior?.y) ? prior.y : (anchor?.y ?? 0) + 48 + (slot % 3) * 34;
      entry.z = Number.isFinite(prior?.z) ? prior.z : (anchor?.z ?? 0) + Math.sin(angle) * radius;
      layout.set(entry.task.id, { group: entry.group, slot, x: entry.x, y: entry.y, z: entry.z });
    }
    return { entries, layout };
  }

  // Chores the assistant filed on its own — A-Eyes alerts, overseer upgrades,
  // audits, collisions, ideas, grow work — are not the user's asks. They fold
  // into the hub that filed them instead of earning a node and a label each.
  // A pin is the user pointing at one: pinned work always keeps its node.
  const AGENT_FILED_SOURCES = new Set(["a-eyes", "overseer", "audit", "collision", "duplicate", "fix", "improver", "grow", "idea", "agent", "uncommitted"]);
  const agentFiledTask = (task) => AGENT_FILED_SOURCES.has(String(task?.source ?? "")) && !task?.pin && !task?.pinnedAt && !task?.workPin;
  const FILED_LIMIT = 12;

  // Open/active tasks join the constellation: anchored to a matching session
  // when the title overlaps it, otherwise spread on an outer ring. With a long
  // backlog the graph drowns in task nodes. Show active and explicitly pinned
  // work before the latest tasks; the full board stays available in Tasks.
  // The assistant's own chores ride the hub (see drawFiledWork and the card).
  function appendTaskNodes() {
    const runningTasks = new Set(autopilotJobs(state.assistant).map((job) => job.taskId).filter(Boolean));
    const rank = (task) => runningTasks.has(task.id) ? 0 : task.status === "active" ? 1 : task.workPin || task.pinnedAt ? 2 : 3;
    const entries = window.MefiTaskGroups?.graphTasks(state.allTasks, { groups: state.taskGroups, runningIds: runningTasks, expanded: state.expandedTaskGroups }) ?? [...(state.tasks ?? [])]
      .sort((a, b) => rank(a) - rank(b) || (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0))
      .slice(0, 12).map((task) => ({ task }));
    const metadata = new Map(entries.map((entry) => [entry.task.id, entry]));
    const retained = new Set([...(state.allTasks ?? state.tasks ?? []).map((task) => task.id), ...state.taskGroups.map((group) => group.id), ...state.taskGroups.flatMap((group) => group.members.map((member) => member.id))]);
    // The hub is where the assistant's chores land. Their slots go to work the
    // user actually owns. Without a hub on the board they keep their nodes —
    // filed work must never leave the view just because the hub is folded.
    const hub = state.nodes.find((node) => node.kind === "assistant") ?? null;
    const filed = new Map();
    if (hub) {
      const grouped = new Set(state.taskGroups.flatMap((group) => [String(group.id), ...group.members.map((member) => String(member.id))]));
      const chores = (state.tasks ?? [])
        .filter((task) => agentFiledTask(task) && !grouped.has(String(task.id)))
        .sort((a, b) => rank(a) - rank(b) || (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0))
        .slice(0, FILED_LIMIT);
      for (const task of chores) filed.set(String(task.id), task);
      hub.filedWork = chores;
    }
    const placed = taskPlacements(entries.filter((entry) => !filed.has(String(entry.task.id))).map((entry) => entry.task), state.nodes, autopilotJobs(state.assistant), state.taskLayout, retained);
    state.taskLayout = placed.layout;
    placed.entries.forEach(({ task, anchor, x: bx, y: by, z: bz }) => {
      const entry = metadata.get(task.id);
      // Work on it: a task pinned to a session or todo on the board is that
      // node's work, not a second node beside it. The task stays on the board;
      // the graph shows the work where the user pointed. Group members and
      // plan parents keep their own nodes so the group hierarchy stays true.
      const target = task.target;
      const targetId = ["session", "todo"].includes(String(target?.kind ?? "")) ? String(target?.id ?? "") : "";
      const host = targetId && !entry.taskGroup && !entry.member
        ? state.nodes.find((candidate) => (candidate.kind === "session" || candidate.kind === "todo") && !candidate.dying && (candidate.id === targetId || candidate.sessionId === targetId))
        : null;
      if (host) {
        host.workTask = task;
        const fx = ensureFx(`task:${task.id}`);
        fx.task = task;
        fx.builder = false;
        fx.anchorId = host.id;
        fx.seen = true;
        // It never rendered a node of its own: its finish folds straight into
        // the host instead of flying a ghost out of it.
        fx.wasRendered = false;
        return;
      }
      const node = {
        id: `task:${task.id}`,
        kind: entry.taskGroup?.kind === "approved-plan" ? "task-group" : "task",
        label: task.title,
        task,
        taskGroup: entry.taskGroup ?? null,
        groupParentId: entry.groupParentId ?? null,
        groupMember: entry.member ?? null,
        readOnly: Boolean(entry.readOnly),
        // The anchor lives on the node as well as on the edge: the card, the
        // arrow keys and the branch highlight all need it, and `sessionId`
        // must stay "this node belongs to that session".
        anchorSessionId: anchor ? anchor.id : null,
        color: task.color ?? null,
        state: ["active", "awaiting_verification"].includes(task.status) ? "active" : "task",
        r: entry.taskGroup ? 10 : 7,
        x: bx,
        y: by,
        z: bz,
        bx,
        by,
        bz,
      };
      state.nodes.push(node);
      const groupParent = node.groupParentId ? state.nodes.find((candidate) => candidate.id === node.groupParentId) : null;
      const edgeAnchor = groupParent ?? anchor;
      if (edgeAnchor) state.edges.push({ a: state.nodes.indexOf(edgeAnchor), b: state.nodes.length - 1, sessionId: anchor?.id, task: true, taskGroup: Boolean(groupParent) });
      // Saved obligations are read-only leaves, not new task lifecycle events.
      if (node.readOnly) return;
      // The life-cycle entry: pop-out and absorb both run against this host —
      // the session it echoes, or the assistant that handed the work out.
      const fx = ensureFx(node.id);
      fx.task = task;
      fx.builder = false;
      fx.anchorId = anchor?.id ?? absorbFallback()?.id ?? null;
      fx.seen = true;
      fx.wasRendered = true;
    });
    // A folded chore still gets its life-cycle entry: it never renders a node,
    // and when it finishes it sinks into the hub's absorbed list instead of
    // vanishing without a trace.
    for (const [id, task] of filed) {
      const fx = ensureFx(`task:${id}`);
      fx.task = task;
      fx.builder = false;
      fx.anchorId = hub.id;
      fx.seen = true;
      fx.wasRendered = false;
      fx.filed = true;
    }
  }

  function toggleTaskGroup(node) {
    const id = node?.taskGroup?.id;
    if (!id) return;
    if (state.expandedTaskGroups.has(id)) state.expandedTaskGroups.delete(id);
    else state.expandedTaskGroups.add(id);
    refreshGraph();
    renderInfo();
  }

  // Loose words from a title, for matching a request against a node on the
  // board. Requests usually name the thing they are about ("Work on <session>").
  const titleKeys = (text) => new Set((String(text ?? "").toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g) ?? []).slice(0, 10));

  // Work on it pins work to the node the user pointed at (a session or a todo):
  // the running ring, the card and the builder belong on that node, not on a
  // second node echoing its name. Null when the target is not on the board.
  function targetHostNode(target) {
    const id = ["session", "todo"].includes(String(target?.kind ?? "")) ? String(target?.id ?? "") : "";
    if (!id) return null;
    return state.nodes.find((node) => (node.kind === "session" || node.kind === "todo") && !node.dying && (node.id === id || node.sessionId === id)) ?? null;
  }

  // Where a running job belongs on the board: its task, its session, or the node
  // whose title it echoes. A job with no home is not forced onto the assistant —
  // three of those stacked on one hub was the whole visual problem — it goes out
  // into its own ring instead (see appendBuilderNodes).
  function hostForJob(job) {
    if (job.taskId) {
      const task = state.nodes.find((node) => node.kind === "task" && node.task?.id === job.taskId);
      if (task) return task;
      // Work on it: the task lives on the node it was pinned to, not on a node
      // of its own, so the builder orbits that node.
      const owned = (state.allTasks ?? []).find((entry) => entry?.id === job.taskId);
      const host = targetHostNode(owned?.target);
      if (host) return host;
    }
    if (job.sessionId) {
      const session = state.nodes.find((node) => node.kind === "session" && node.id === job.sessionId);
      if (session) return session;
    }
    // A queued request the executor already claimed carries its target only on
    // the request row: the worker belongs on the node the request names.
    const request = (Array.isArray(state.requests) ? state.requests : []).find((entry) => entry?.title && entry.title === job.title);
    const requested = targetHostNode(request?.target);
    if (requested) return requested;
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
    let loose = 0;
    jobs.forEach((job) => {
      const host = hostForJob(job);
      const anchor = host ?? hub;
      if (!anchor) return;
      const id = `builder:${job.taskId ?? job.sessionId ?? job.title ?? loose++}`;
      const fx = ensureFx(id, { pop: true });
      // Slots belong to a worker, not to its current index in a status poll.
      // A peer starting, finishing or being reordered cannot move this orbit.
      if (fx.orbitSlot == null || fx.anchorId !== anchor.id) {
        const used = new Set([...state.fx.entries()].filter(([key, entry]) => key !== id && entry.builder && entry.anchorId === anchor.id).map(([, entry]) => entry.orbitSlot));
        fx.orbitSlot = 0;
        while (used.has(fx.orbitSlot)) fx.orbitSlot += 1;
      }
      let ring;
      let radius;
      let lift;
      if (host) {
        // Several builders can share one host (three slots, one plan), so each
        // takes its own angle rather than stacking on the same point.
        ring = fx.orbitSlot * Math.PI * 2 / 3;
        radius = BUILDER_ORBIT;
        lift = 8;
      } else {
        // No home on the board: take a slot in a wide ring around the assistant,
        // evenly spaced and staggered in height so three read as three agents
        // out working rather than one smudge on the hub.
        ring = fx.orbitSlot * Math.PI * 2 / 3 + Math.PI / 6;
        radius = BUILDER_FIELD;
        lift = 14 + (fx.orbitSlot % 2) * 16;
      }
      const node = {
        id,
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
        x: fx.lastX ?? anchor.x + Math.cos(ring) * radius,
        y: fx.lastY ?? anchor.y - lift,
        z: fx.lastZ ?? anchor.z + Math.sin(ring) * radius,
      };
      state.nodes.push(node);
      // A builder that just appeared is the foreman handing work out: say so
      // once, on the tree, the moment it pops.
      if (state.active && state.graphSeeded && Number.isFinite(fx.bornAt) && !fx.announced && Date.now() - fx.bornAt < 1500 && typeof announceHandout === "function") {
        fx.announced = true;
        announceHandout(node);
      }
      // Same life-cycle as a task: the builder pops out of its host when the
      // job starts and flies home into it when the run ends.
      // A brief gap in the job list can reverse an exit. Reuse the same
      // visible worker instead of adding a duplicate ghost or restarting it.
      if (fx.absorbAt != null) {
        const t = Math.max(0, Math.min(1, (Date.now() - fx.absorbAt) / NODE_ABSORB_MS));
        fx.resumeOpacity = 1 - smoothStep(t);
        fx.resumeAt = Date.now();
      }
      fx.absorbAt = null;
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
      // Work on it finished: it folds into the node it was pinned to instead of
      // parking a finished node beside it.
      if (targetHostNode(task?.target)) { state.doneHold.delete(id); markAbsorb(id); continue; }
      // A chore the assistant filed has no node of its own to hold: it sinks
      // straight into the hub's absorbed list.
      if (fx.filed) { state.doneHold.delete(id); markAbsorb(id); continue; }
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
        color: task?.color ?? null,
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
      node._scale = node.kind === "agent" ? node.motionOpacity ?? 1 : 1;
      node._fade = node._scale;
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
      if (fx.resumeAt != null) {
        const t = Math.max(0, Math.min(1, (now - fx.resumeAt) / 240));
        node._scale = node._fade = fx.resumeOpacity + (1 - fx.resumeOpacity) * smoothStep(t);
        if (t >= 1) fx.resumeAt = null;
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
    state.allTasks = all;
    state.taskGroups = window.MefiTaskGroups?.groupTasks(all) ?? [];
    const groupIds = new Set(state.taskGroups.map((group) => group.id));
    for (const id of state.expandedTaskGroups) if (!groupIds.has(id)) state.expandedTaskGroups.delete(id);
    const members = new Set(state.taskGroups.flatMap((group) => group.members.map((member) => `task:${member.id}`)));
    const open = all.filter((task) => ["open", "active", "awaiting_verification"].includes(task.status));
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
      if (members.has(id)) { state.fx.delete(id); state.doneHold.delete(id); continue; }
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
    state.completedTaskIds = new Set(all.filter((task) => task.status === "done" || task.status === "archived").map((task) => task.id));
  }

  const read = (method) => window.MefiBoot?.read ? window.MefiBoot.read(method) : Promise.resolve().then(() => window.mefiStudio?.[method]?.());

  // A project switch re-scopes everything the board draws: tree3d reloads the
  // folder's session store on this same event, the task push carries the new
  // folder's tasks, and the layout caches must not keep the previous project's
  // positions. The first event is the startup adoption, which the initial
  // reads already reflect, so only a real switch takes a fresh snapshot.
  function projectChanged(event) {
    const nextProject = event.detail?.projectId ?? null;
    const switched = Boolean(state.projectId && nextProject && nextProject !== state.projectId);
    state.projectId = nextProject;
    state.screenLayout = null;
    state.agentLayout.clear();
    state.agentSeq = {};
    state.agentPhases = {};
    state.taskLayout = new Map();
    state.graphSeeded = false;
    // Remarks, wakes and pending effects belong to the old project's tree,
    // and so does what sank into the assistant orb.
    state.speech?.clear?.();
    state.speechRects = [];
    state.deferred = [];
    state.agentTrails?.clear?.();
    state.absorbed?.delete?.("__assistant__");
    state.callouts?.clear?.();
    state.calloutRects = [];
    state.hoverCallout = null;
    if (typeof exitFocus === "function") exitFocus();
    state.backlogRevision += 1;
    state.backlogReadAt = 0;
    state.backlog = null;
    state.backlogError = null;
    state.feedDirty = true;
    if (switched) {
      state.readyPromise = Promise.resolve(window.MefiTree?.ready?.())
        .then(() => {
          refreshGraph();
          updateTelemetry(true);
        })
        .catch(() => {});
    }
    if (state.active) renderFeed();
  }

  async function refreshTasks(shared = false) {
    try {
      // Only the initial view shares reads. A refresh following a write must
      // fetch after that write, even if an older startup request is pending.
      const result = await (shared ? read("tasksList") : window.mefiStudio?.tasksList?.());
      takeTasks(result?.tasks);
    } catch {}
  }

  // Confirm a task done through the host's targeted status action, the same
  // one the task board uses. tasks:save never takes status from a form, so a
  // whole-list save here only ever appended a "marked done" log line.
  async function confirmTaskDone(task) {
    try {
      const result = await window.mefiStudio?.tasksAction?.({ action: "status", status: "done", taskId: task.id, projectId: task.projectId || undefined });
      return result?.ok ? { ok: true } : { ok: false, error: result?.error || "the task store is unavailable" };
    } catch (error) {
      return { ok: false, error: error?.message || "the task store is unavailable" };
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
  // Every feed push repaints the chat log, and most pushes (a worker's stdout
  // lines) change nothing the thread shows; rebuilding it anyway cost two
  // forced layouts of the whole document per push (7.6 ms each on the live
  // Command view), so a thread that would read the same is left alone.
  const threadPainted = new WeakMap();
  function fillThread(container, full) {
    if (!container) return;
    const bridge = Boolean(window.mefiStudio?.assistantMessage);
    const messages = threadMessages(full);
    const rows = messages.map((message) => {
      const thought = message.role === "thinking";
      return [
        message.role === "user" ? "user" : thought ? "assistant thinking" : "assistant",
        String(message.text ?? ""),
        thought
          ? `${agoLabel(message.at) ?? ""} · thinking`
          : `${agoLabel(message.at) ?? ""}${message.role !== "user" && message.via === "local" ? " · local" : ""}`,
      ];
    });
    const live = String(full?.thinking?.text ?? "").trim();
    const last = messages[messages.length - 1];
    const sameLive = Boolean(live && last?.role === "thinking" && String(last.text ?? "") === live);
    const pending = replyPending(full) && !sameLive;
    const signature = JSON.stringify([bridge, rows, pending, pending && live]);
    if (threadPainted.get(container) === signature && container.firstChild) return;
    threadPainted.set(container, signature);
    const pinned = container.scrollTop + container.clientHeight >= container.scrollHeight - 28;
    const top = container.scrollTop;
    container.textContent = "";
    if (!messages.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = bridge ? "No messages yet — ask for a status, or give it work." : "The thread lives in the desktop app.";
      container.append(empty);
    }
    for (const [kind, text, label] of rows) {
      const bubble = document.createElement("div");
      bubble.className = `assistant-msg ${kind}`;
      bubble.textContent = text;
      const when = document.createElement("span");
      when.className = "when";
      when.textContent = label;
      bubble.append(when);
      container.append(bubble);
    }
    if (pending) container.append(thinkingBubble(full));
    container.scrollTop = pinned ? container.scrollHeight : top;
  }

  function commandChatActivity(full, jobs = [], backlog = null) {
    const active = (Array.isArray(full?.agents) ? full.agents : []).filter((agent) => agent?.status === "running");
    const agents = active.length;
    const builds = jobs.length;
    const paused = full?.status === "paused" || backlog?.paused;
    const review = Number(backlog?.counts?.review) || 0;
    const parts = [];
    if (agents) parts.push(`${agents} agent${agents === 1 ? "" : "s"}`);
    if (builds) parts.push(`${builds} build${builds === 1 ? "" : "s"}`);
    const line = parts.join(" · ") || (paused ? "Paused" : review ? `${review} awaiting verification` : backlog?.waiting ? "Waiting" : "Idle");
    const detail = [
      ...active.map((agent) => `${agent.role || "Agent"}: ${agent.text || "working"}`),
      ...jobs.map((job) => `Build: ${job.title || "Untitled task"}`),
      paused ? "New scheduling is paused; current work can finish." : backlog?.waiting,
      review ? `${review} finished attempt${review === 1 ? " is" : "s are"} awaiting verification.` : "",
    ].filter(Boolean).join("\n");
    return { agents, builds, running: agents + builds, line, detail };
  }

  // The right-side chat log: the thread, the quick asks and a composer docked
  // beside the node card, so the assistant's side of every exchange — every
  // task ask, every "work on it", every reply — stays on screen while the
  // constellation works. Collapses to a slim header when the canvas is wanted.
  function renderChatLog() {
    if (!el.chatLog) return;
    renderNewWorkControl();
    const full = assistantFull();
    const summary = assistantSummary();
    const bridge = Boolean(window.mefiStudio?.assistantMessage);
    const activity = commandChatActivity(full, autopilotJobs(state.assistant), state.backlog);
    const running = activity.running;
    el.chatLog.dataset.running = String(running);
    el.chatLog.dataset.agents = String(activity.agents);
    el.chatLog.dataset.builds = String(activity.builds);
    if (el.chatLogState) {
      // Service agents and code builds are different kinds of concurrent
      // work. Keep both counts visible rather than collapsing them to one.
      const line = !bridge ? "desktop app only" : activity.line;
      el.chatLogState.textContent = line;
      el.chatLogState.title = activity.detail || summary.detail || line;
    }
    if (el.chatLogDot) {
      el.chatLogDot.dataset.state =
        running ? "running" : summary.tone === "warn" || summary.tone === "offline" ? "bad" : "off";
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
    if (typeof applyRailCollapsed === "function") applyRailCollapsed();
    state.graphAreaAt = 0;
    state.hudRectsAt = 0;
  }

  // ---- the right rail: Work · Settings · Assistant · Done · Ask ------------
  // The live-work feed, the work settings and the assistant chat share one
  // docked panel. Each view keeps its own head and collapse control; the rail
  // only decides which view is on screen and whether the panel shrinks to its
  // header.
  // "node" is the selected node's own detail. It is a view, not a destination:
  // its tab only exists while something is picked, and it is never written to
  // the remembered tab, so clearing the selection lands you back where you were.
  const RAIL_VIEWS = ["node", "work", "settings", "assistant", "done", "ask"];

  function applyRailCollapsed() {
    const collapsed = state.railTab === "work" ? state.feedCollapsed
      : state.railTab === "assistant" ? !state.chatLogOpen
      : state.railTab === "done" ? state.doneCollapsed
      : false;
    state.railCollapsed = collapsed;
    el.rail?.classList.toggle("rail-collapsed", collapsed);
  }

  function setRailTab(name, { save = true, focus = false } = {}) {
    let view = RAIL_VIEWS.includes(name) ? name : "work";
    // The node view cannot be entered without a node; a stale one falls back to
    // whatever the owner last chose for themselves.
    if (view === "node" && !state.selected) view = state.railHome ?? "work";
    if (view !== "node") state.railHome = view;
    state.railTab = view;
    for (const button of el.railTabs ?? []) {
      const selected = button.dataset.railView === view;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
      if (selected && focus) button.focus();
    }
    if (el.nodePanel) el.nodePanel.hidden = view !== "node";
    if (el.feed) el.feed.hidden = view !== "work";
    if (el.settings) el.settings.hidden = view !== "settings";
    if (el.chatLog) el.chatLog.hidden = view !== "assistant";
    if (el.done) el.done.hidden = view !== "done";
    if (el.asks) el.asks.hidden = view !== "ask";
    // Never remember "node": it belongs to a selection, not to a launch.
    if (save && view !== "node") writeStore("mefiStudio.cmdRailTab", view);
    applyRailCollapsed();
    if (view === "node") renderInfo();
    if (view === "settings") renderSettingsPanel();
    if (view === "done") void loadDoneLog();
    if (view === "ask") renderAsks();
    state.graphAreaAt = 0;
    state.hudRectsAt = 0;
  }

  function railQuestions(full = null) {
    const source = full ?? assistantFull();
    return Array.isArray(source?.questions) ? source.questions : [];
  }

  // The tab counters: running builds on Work, unread replies on Assistant,
  // open decisions on Ask.
  function renderRailBadges(full = null) {
    const jobs = autopilotJobs(state.assistant);
    if (el.railWorkBadge) {
      el.railWorkBadge.hidden = !jobs.length;
      el.railWorkBadge.textContent = String(jobs.length);
      el.railWorkBadge.title = jobs.length ? `${jobs.length} build${jobs.length === 1 ? "" : "s"} running` : "";
    }
    const unread = Number(full?.unread ?? assistantFull()?.unread ?? state.assistant?.unread) || 0;
    if (el.railAssistantBadge) {
      el.railAssistantBadge.hidden = !unread;
      el.railAssistantBadge.textContent = String(unread);
      el.railAssistantBadge.title = unread ? `${unread} unread repl${unread === 1 ? "y" : "ies"}` : "";
    }
    const waiting = railQuestions(full).filter((question) => question.status === "open").length;
    if (el.railAskBadge) {
      el.railAskBadge.hidden = !waiting;
      el.railAskBadge.textContent = String(waiting);
      el.railAskBadge.title = waiting ? `${waiting} decision${waiting === 1 ? "" : "s"} waiting` : "";
    }
  }

  // The done log: the durable executor ledger — the builds that finished off —
  // read from the host on demand so a reload shows the file, not a cache.
  async function loadDoneLog() {
    if (!el.doneList || state.doneClearing) return;
    if (!window.mefiStudio?.assistantDoneLog) {
      if (el.doneState) el.doneState.textContent = "desktop app only";
      renderDone();
      return;
    }
    if (state.doneLoading) return;
    state.doneLoading = true;
    if (el.doneState) el.doneState.textContent = "Loading…";
    try {
      const result = await window.mefiStudio.assistantDoneLog({ limit: 80 });
      state.doneEntries = Array.isArray(result?.entries) ? result.entries : [];
      state.doneAt = Date.now();
    } catch {
      state.doneEntries = state.doneEntries ?? [];
    } finally {
      state.doneLoading = false;
      renderDone();
    }
  }

  // The done log collapses to its head: the count and the Clear button stay
  // reachable while the list tucks away, and the choice is remembered.
  function setDoneCollapsed(collapsed, { save = true } = {}) {
    state.doneCollapsed = Boolean(collapsed);
    el.done?.classList.toggle("done-collapsed", state.doneCollapsed);
    if (el.doneToggle) {
      el.doneToggle.textContent = state.doneCollapsed ? "+" : "–";
      el.doneToggle.setAttribute("aria-expanded", String(!state.doneCollapsed));
      el.doneToggle.title = state.doneCollapsed ? "Expand the done log" : "Collapse the done log";
    }
    applyRailCollapsed();
    if (save) writeStore("mefiStudio.cmdDoneCollapsed", state.doneCollapsed ? "1" : "0");
  }

  // Clear: the host wipes the finish rows from the executor ledger and the tab
  // reads empty. It asks first, because the rows go for good and the button
  // sits beside the filters where a stray click is easy. No other ceremony —
  // the absorb flight belongs to the nodes on the tree, which collapse into
  // their host when their work finishes off.
  async function clearDoneLog() {
    if (state.doneClearing || !el.doneList || !window.mefiStudio?.assistantClearDoneLog) return;
    const entries = state.doneEntries ?? [];
    if (!entries.length) return;
    if (typeof window.MefiConfirm === "function") {
      const count = entries.length;
      const approved = await window.MefiConfirm(`Clear ${count} record${count === 1 ? "" : "s"} from the done log? This cannot be undone.`, { label: "Clear" });
      if (!approved || state.doneClearing) return;
    }
    state.doneClearing = true;
    if (el.doneClear) el.doneClear.disabled = true;
    try {
      const result = await window.mefiStudio.assistantClearDoneLog();
      if (!result?.ok) {
        window.MefiToast?.(`clear failed · ${result?.error ?? "unknown error"}`, "bad");
        return;
      }
      state.doneEntries = [];
      state.doneAt = Date.now();
      window.MefiToast?.(`cleared ${entries.length} record${entries.length === 1 ? "" : "s"} from the done log`, "good");
    } catch (error) {
      window.MefiToast?.(`clear failed · ${String(error?.message ?? error)}`, "bad");
    } finally {
      state.doneClearing = false;
      renderDone();
    }
  }

  // The filter chips over the list: every record, only the successes, or
  // only the failures. Each chip carries its count so the split is readable
  // without switching.
  const DONE_FILTERS = ["all", "ok", "failed"];
  const doneOk = (entry) => entry?.ok !== false;

  function setDoneFilter(name) {
    state.doneFilter = DONE_FILTERS.includes(name) ? name : "all";
    renderDone();
  }

  function renderDone() {
    if (!el.doneList) return;
    const entries = state.doneEntries ?? [];
    const okCount = entries.filter(doneOk).length;
    const failedCount = entries.length - okCount;
    if (el.doneClear) {
      el.doneClear.disabled = state.doneClearing || !entries.length;
      el.doneClear.title = entries.length
        ? `Clear ${entries.length} record${entries.length === 1 ? "" : "s"} — the done log clears for good`
        : "Nothing to clear yet";
    }
    const filter = DONE_FILTERS.includes(state.doneFilter) ? state.doneFilter : "all";
    for (const button of el.doneFilters ?? []) {
      const name = button.dataset.doneFilter;
      button.setAttribute("aria-pressed", String(name === filter));
      const count = button.querySelector("b");
      if (count) count.textContent = entries.length ? String(name === "ok" ? okCount : name === "failed" ? failedCount : entries.length) : "";
    }
    const shown = filter === "all" ? entries : entries.filter((entry) => doneOk(entry) === (filter === "ok"));
    el.doneList.textContent = "";
    if (!shown.length) {
      const empty = document.createElement("li");
      empty.className = "done-empty";
      empty.textContent = !window.mefiStudio ? "The done log is available in the desktop app."
        : !entries.length ? "Nothing has finished yet. Builds that finish off land here."
        : filter === "failed" ? "No failed builds in this log." : "No successful builds in this log.";
      el.doneList.append(empty);
    }
    for (const entry of shown) {
      const row = document.createElement("li");
      row.className = "done-row";
      row.dataset.ok = String(doneOk(entry));
      row.dataset.kind = entry.kind === "build" ? "build" : "run";
      const head = document.createElement("div");
      head.className = "done-row-head";
      const verdict = document.createElement("span");
      verdict.className = "done-verdict";
      verdict.textContent = doneOk(entry) ? "Done" : "Failed";
      const when = document.createElement("span");
      when.className = "done-when";
      when.textContent = agoLabel(entry.at) ?? "";
      when.title = entry.at ? new Date(entry.at).toLocaleString() : "";
      head.append(verdict, when);
      const title = document.createElement(entry.taskId || entry.sessionId ? "button" : "span");
      title.className = "done-title";
      title.textContent = entry.title || "Untitled";
      if (entry.taskId) {
        title.type = "button";
        title.addEventListener("click", () => nav("tasks", { taskId: entry.taskId, filter: "all" }));
      } else if (entry.sessionId) {
        title.type = "button";
        title.addEventListener("click", () => nav("explorer", { sessionId: entry.sessionId }));
      }
      row.append(head, title);
      if (entry.detail) {
        const detail = document.createElement("span");
        detail.className = "done-detail";
        detail.textContent = entry.detail;
        row.append(detail);
      }
      el.doneList.append(row);
    }
    if (el.doneState) el.doneState.textContent = !entries.length ? "Nothing yet"
      : failedCount ? `${okCount} done · ${failedCount} failed`
      : `${entries.length} record${entries.length === 1 ? "" : "s"}`;
  }

  // The Ask cards: every open decision with its options, the recommended one
  // flagged, and the answer history kept beside it.
  function renderAsks(full = null) {
    if (!el.askList) return;
    const questions = railQuestions(full);
    const open = questions.filter((question) => question.status === "open");
    const closed = questions.filter((question) => question.status !== "open").slice(-5);
    el.askList.textContent = "";
    if (!questions.length) {
      const empty = document.createElement("li");
      empty.className = "ask-empty";
      empty.textContent = "Nothing is waiting on you. When an agent needs a decision, it asks here with a recommended option.";
      el.askList.append(empty);
    }
    for (const question of open) el.askList.append(askCard(question));
    if (closed.length) {
      // The answered history sits under a divider so open decisions stay
      // visibly ahead of what is already settled.
      const divider = document.createElement("li");
      divider.className = "ask-divider";
      divider.setAttribute("role", "presentation");
      divider.textContent = open.length ? "Recently answered" : "Answered";
      el.askList.append(divider);
    }
    for (const question of closed) el.askList.append(askCard(question));
    if (el.askState) el.askState.textContent = open.length ? `${open.length} waiting` : questions.length ? "All answered" : "Nothing waiting";
  }

  function askCard(question) {
    const card = document.createElement("li");
    card.className = "ask-card";
    card.dataset.kind = question.kind === "suggestion" ? "suggestion" : "question";
    card.dataset.status = question.status ?? "open";
    const head = document.createElement("div");
    head.className = "ask-head";
    const kind = document.createElement("span");
    kind.className = "ask-kind";
    kind.textContent = question.kind === "suggestion" ? "Suggestion" : "Question";
    const when = document.createElement("span");
    when.className = "ask-when";
    when.textContent = agoLabel(question.at) ?? "";
    when.title = question.at ? new Date(question.at).toLocaleString() : "";
    head.append(kind, when);
    const title = document.createElement("p");
    title.className = "ask-title";
    title.textContent = question.title ?? "";
    card.append(head, title);
    if (question.detail) {
      const detail = document.createElement("p");
      detail.className = "ask-detail";
      detail.textContent = question.detail;
      card.append(detail);
    }
    // What the decision is ABOUT. A question raised by an agent carries the
    // task it belongs to and the evidence it saw, so the card can be read
    // without opening anything else — and opened from here when it cannot.
    if (question.context) {
      const context = question.context;
      const chips = document.createElement("div");
      chips.className = "ask-context";
      if (context.severity) {
        const severity = document.createElement("span");
        severity.className = "ask-chip";
        severity.dataset.severity = context.severity;
        severity.textContent = context.severity === "blocker" ? "Blocked" : context.severity === "decision" ? "Decision" : "Note";
        chips.append(severity);
      }
      if (context.taskTitle) {
        const task = document.createElement(context.taskId ? "button" : "span");
        task.className = "ask-chip task";
        task.textContent = context.taskTitle;
        if (context.taskId) {
          task.type = "button";
          task.title = "Open this task on the board";
          task.addEventListener("click", () => nav("tasks", { taskId: context.taskId, filter: "all" }));
        }
        chips.append(task);
      }
      if (context.file || context.check) {
        const where = document.createElement("span");
        where.className = "ask-chip";
        where.textContent = context.check ? `check: ${context.check}` : context.file;
        chips.append(where);
      }
      if (chips.children.length) card.append(chips);
      if (Array.isArray(context.evidence) && context.evidence.length) {
        const evidence = document.createElement("pre");
        evidence.className = "ask-evidence";
        evidence.textContent = context.evidence.slice(-3).join("\n");
        evidence.title = "The last lines the agent printed before it asked";
        card.append(evidence);
      }
    }
    if (question.status === "open") {
      const options = document.createElement("div");
      options.className = "ask-options";
      for (const option of Array.isArray(question.options) ? question.options : []) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ask-option";
        button.dataset.option = option.id;
        if (option.recommended) button.dataset.recommended = "true";
        const label = document.createElement("span");
        label.textContent = option.label;
        if (option.recommended) {
          const rec = document.createElement("span");
          rec.className = "ask-rec";
          rec.textContent = "Recommended";
          label.append(rec);
        }
        button.append(label);
        if (option.description) {
          const desc = document.createElement("span");
          desc.className = "ask-option-desc";
          desc.textContent = option.description;
          button.append(desc);
        }
        button.addEventListener("click", () => void answerQuestion(question.id, option.id, null, button));
        options.append(button);
      }
      card.append(options);
      const custom = document.createElement("form");
      custom.className = "ask-custom";
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "Or type your own answer…";
      input.setAttribute("aria-label", "Write an answer");
      const send = document.createElement("button");
      send.type = "submit";
      send.className = "ghost mini";
      send.textContent = "Send";
      custom.append(input, send);
      custom.addEventListener("submit", (event) => {
        event.preventDefault();
        const text = input.value.trim();
        if (text) void answerQuestion(question.id, null, text, send);
      });
      card.append(custom);
      // Whether a decision reaches you at all is a node in the live brain
      // map, so the card links to the part that decided to ask.
      if (question.source === "issue") {
        const links = document.createElement("div");
        links.className = "ask-links";
        const rules = document.createElement("button");
        rules.type = "button";
        rules.className = "ghost mini";
        rules.textContent = "Why am I being asked?";
        rules.title = "Open the brain map at the triage part that decided this needs you";
        rules.addEventListener("click", () => nav("brains", { nodeType: "issue.triage" }));
        links.append(rules);
        card.append(links);
      }
    } else if (question.answer) {
      const note = document.createElement("p");
      note.className = "ask-answer-note";
      note.textContent = question.status === "dismissed" ? `Dismissed: ${question.answer.label ?? "not now"}`
        : question.status === "expired" ? "Expired without an answer"
        : question.status === "superseded" ? "Superseded by a newer question"
        : `You chose: ${question.answer.label ?? question.answer.text ?? "answered"}`;
      // An answer the host could not carry out (the task left the board, the
      // split chain is at the map's limit) says why instead of reading as done.
      if (question.status === "answered" && question.answer.error) {
        note.textContent += ` — not applied: ${question.answer.error}`;
        card.dataset.applied = "false";
      }
      card.append(note);
    }
    return card;
  }

  async function answerQuestion(id, optionId, text, button) {
    if (state.askSending) return;
    if (!window.mefiStudio?.assistantAnswer) {
      window.MefiToast?.("Answers are available in the desktop app", "warn");
      return;
    }
    state.askSending = true;
    if (button) button.disabled = true;
    try {
      const result = await window.mefiStudio.assistantAnswer({ id, optionId, text });
      if (result?.ok === false && result?.error) window.MefiToast?.(result.error, "warn");
    } catch (error) {
      window.MefiToast?.(`Answer failed: ${error.message}`, "warn");
    } finally {
      state.askSending = false;
      renderAsks();
      renderRailBadges();
    }
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
      if (job.taskId) {
        ids.add(job.taskId);
        // A task pinned to a board node lights that node, wherever the task
        // itself would have been drawn.
        const target = (state.allTasks ?? []).find((entry) => entry?.id === job.taskId)?.target;
        if (["session", "todo"].includes(String(target?.kind ?? "")) && target?.id) ids.add(String(target.id));
      }
    }
    // A pinned request the executor already claimed keeps its target lit for
    // as long as the run lasts.
    for (const request of Array.isArray(state.requests) ? state.requests : []) {
      const target = request?.target;
      if (request?.status === "running" && ["session", "todo"].includes(String(target?.kind ?? "")) && target?.id) ids.add(String(target.id));
    }
    return ids;
  };
  // A node is "being built" when the executor holds its session or its task.
  // `ids` is caller-supplied, so an early frame that runs before the set was
  // built reads as "nothing busy" instead of throwing on `.size`.
  const isBusyNode = (node, ids) => Boolean(node) && (ids?.size ?? 0) > 0 && (ids.has(node.id) || ids.has(node.sessionId) || ids.has(node.task?.id));

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
    // A pinned task drawn on its target node instead of its own keeps the
    // "up next" ring on that node.
    for (const task of state.allTasks ?? []) {
      const target = task?.target;
      if (task?.pin && (task.status === "open" || task.status === "active") && ["session", "todo"].includes(String(target?.kind ?? "")) && target?.id) ids.add(String(target.id));
    }
    // The seen set is the bridge across the handoff: the claim clears the pin
    // exactly when the build starts, so the ring keys off "was pinned and is
    // now running" rather than the pin alone. Entries age out so a finished
    // job's node goes quiet again.
    for (const [id, at] of state.workPinSeen) if (now - at > 2 * 3600000) state.workPinSeen.delete(id);
    for (const id of ids) state.workPinSeen.set(id, now);
    return ids;
  }

  // Follow resolves the actual worker's task before its session. Activity can
  // move attention between workers, but never redirects it to an unrelated
  // maintenance session merely because that session reported most recently.
  function followCandidates(nodes, jobs, touches, now, completedTaskIds = new Set()) {
    const candidates = [];
    const seen = new Set();
    const at = (id) => id ? Number(touches.get(id)?.at) || 0 : 0;
    for (const job of jobs) {
      if (job.taskId && completedTaskIds.has(job.taskId)) continue;
      const task = nodes.find((node) => node.kind === "task" && (job.taskId && (node.task?.id === job.taskId || node.id === `task:${job.taskId}`) || job.sessionId && node.task?.run?.sessionId === job.sessionId));
      if (task && (task.dying || ["done", "archived"].includes(task.task?.status))) continue;
      // Work on it draws the task on the node it was pinned to: Follow frames
      // that node instead of falling back to the worker's own session.
      const target = !task && job.taskId ? (state.allTasks ?? []).find((entry) => entry?.id === job.taskId)?.target : null;
      const targetId = ["session", "todo"].includes(String(target?.kind ?? "")) ? String(target?.id ?? "") : "";
      const host = targetId ? nodes.find((entry) => (entry.kind === "session" || entry.kind === "todo") && !entry.dying && (entry.id === targetId || entry.sessionId === targetId)) : null;
      const session = job.sessionId ? nodes.find((node) => node.kind === "session" && (node.id === job.sessionId || node.sessionId === job.sessionId)) : null;
      const builder = nodes.find((node) => node.builder && !node.dying && (job.taskId && node.job?.taskId === job.taskId || job.sessionId && node.job?.sessionId === job.sessionId || !job.taskId && !job.sessionId && node.job === job));
      const node = task ?? host ?? session ?? builder;
      if (!node || seen.has(node.id)) continue;
      seen.add(node.id);
      const todo = session ? nodes.find((entry) => entry.kind === "todo" && entry.sessionId === session.id && (entry.status === "in_progress" || entry.state === "active")) : null;
      const context = [node, session, todo].filter((entry, index, list) => entry && !entry.dying && list.indexOf(entry) === index);
      candidates.push({
        key: node.id, node, context,
        title: task?.task?.title ?? job.title ?? node.label ?? "Current task",
        sessionId: session?.id ?? job.sessionId ?? null,
        taskId: task?.task?.id ?? job.taskId ?? null,
        activityAt: Math.max(at(node.id), at(task?.task?.id), at(job.sessionId)),
        startedAt: Number(job.startedAt) || 0,
        pinned: Boolean(task?.task?.workPin || task?.task?.pinnedAt),
        stage: job.phase === "verifying" || job.stage === "verifying" ? "Verifying" : todo?.label ? String(todo.label) : "Working",
      });
    }
    if (!candidates.length && !jobs.length) {
      const recent = nodes.filter((node) => node.kind === "session" && !node.dying && now - at(node.id) < 90000 && at(node.id) > 0)
        .sort((a, b) => at(b.id) - at(a.id))[0];
      if (recent) candidates.push({ key: recent.id, node: recent, context: [recent], title: recent.label, activityAt: at(recent.id), startedAt: 0, stage: "Recent activity", sessionId: recent.id, taskId: null });
    }
    return candidates.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.activityAt - a.activityAt || a.startedAt - b.startedAt || a.key.localeCompare(b.key));
  }

  function chooseFollowTarget(candidates, previous, now, { reducedMotion = false, preferredId = null } = {}) {
    if (!candidates.length) return null;
    const current = candidates.find((candidate) => candidate.key === previous?.key);
    const selected = !previous && preferredId ? candidates.find((candidate) => candidate.context.some((node) => node.id === preferredId)) : null;
    let target = current ?? selected ?? candidates[0];
    let reason = current ? previous.reason : previous ? "Next active task" : selected ? "Selected task" : target.pinned ? "Prioritized task" : "Active task";
    const dwell = now - (previous?.since ?? now);
    if (current && candidates.length > 1 && dwell >= 8000) {
      const fresh = candidates.find((candidate) => candidate.key !== current.key && candidate.activityAt > Math.max(current.activityAt + 1000, previous.since));
      if (fresh) { target = fresh; reason = "Latest work activity"; }
      else if (!reducedMotion && dwell >= 18000 && !current.pinned) {
        const stable = [...candidates].sort((a, b) => a.startedAt - b.startedAt || a.key.localeCompare(b.key));
        target = stable[(stable.findIndex((candidate) => candidate.key === current.key) + 1) % stable.length];
        reason = "Next active worker";
      }
    }
    return { ...target, since: target.key === previous?.key ? previous.since : now, reason };
  }

  // Fit stable task/session/todo anchors. Orbiting worker positions are omitted
  // from the bounds, so their animation cannot pump the camera's zoom.
  function followFrame(target, area, { view, angle, pitch, fit, overviewScale = 1 }) {
    const points = (target.context.length ? target.context : [target.node]).map((node) => node._layoutAnchor ?? node);
    const targetPoint = target.node._layoutAnchor ?? target.node;
    const bounds = (axis) => [Math.min(...points.map((node) => node[axis] || 0)), Math.max(...points.map((node) => node[axis] || 0))];
    const center = {};
    for (const axis of ["x", "y", "z"]) {
      const [low, high] = bounds(axis);
      center[axis] = (targetPoint[axis] || 0) * 0.6 + (low + high) * 0.2;
    }
    let reachX = 48;
    let reachY = 38;
    const tilt = Math.sin(angle * 0.37) * 0.35 + pitch;
    for (const node of points) {
      const x = (node.x || 0) - center.x;
      const y = (node.y || 0) - center.y;
      const z = (node.z || 0) - center.z;
      const rx = view === "2d" ? x : x * Math.cos(angle) - z * Math.sin(angle);
      const ry = view === "2d" ? z : y * Math.cos(tilt) - (x * Math.sin(angle) + z * Math.cos(angle)) * Math.sin(tilt) * 0.4;
      reachX = Math.max(reachX, Math.abs(rx) + 26);
      reachY = Math.max(reachY, Math.abs(ry) + 26);
    }
    const scale = Math.min(Math.max(100, area.w - 180) / (reachX * 2.5), Math.max(90, area.h - 120) / (reachY * 2.5));
    return { x: -center.x, y: -center.y, z: -center.z, zoom: Math.max(0.65, Math.min(2.35, scale / Math.max(0.01, fit * overviewScale))) };
  }

  function updateFollowCamera(now = Date.now(), force = false) {
    if (!state.active || state.camMode !== "follow" || state.panning || state.rotating) return;
    if (!force && now - state.followReadAt < 250) return;
    state.followReadAt = now;
    const candidates = followCandidates(state.nodes, autopilotJobs(state.assistant), state.touches, now, state.completedTaskIds);
    const next = chooseFollowTarget(candidates, state.follow, now, { reducedMotion: noMotion(), preferredId: state.selected?.id });
    state.follow = next;
    if (next) {
      const frame = followFrame(next, usableArea(), state);
      state.camera.tx = frame.x;
      state.camera.ty = frame.y;
      state.camera.tz = frame.z;
      if (state.followZoomTarget == null || Math.abs(frame.zoom - state.followZoomTarget) > 0.055) state.followZoomTarget = frame.zoom;
      if (noMotion()) {
        state.camera.x = frame.x; state.camera.y = frame.y; state.camera.z = frame.z;
        setZoom(state.followZoomTarget);
      }
    } else state.followZoomTarget = null;
    renderFollowStatus();
  }

  function renderFollowStatus() {
    const active = state.camMode === "follow";
    const title = state.follow?.title ?? "Waiting for active work";
    const stage = state.follow?.stage ?? "Camera holds while the board is quiet";
    const key = `${active}|${title}|${stage}|${state.follow?.reason ?? ""}`;
    if (key === state.followStatusKey) return;
    state.followStatusKey = key;
    if (el.followStatus) {
      el.followStatus.hidden = !active;
      el.followStatus.textContent = `${title} · ${stage}`;
      el.followStatus.title = state.follow?.reason ?? stage;
    }
    if (el.camFollowBtn) el.camFollowBtn.title = active ? `Following ${title} · ${stage}. ${state.follow?.reason ?? "Waiting for actual activity"}. Click to hold this view.` : "Follow active tasks and their current work (C)";
    if (active) renderHint();
  }

  function refreshAssistantCache() {
    const summary = assistantSummary();
    const full = assistantFull();
    // Merge, don't replace: the same slot also carries the autopilot status
    // (running jobs, parallel, queue depth) from the last push.
    state.assistant = { ...(state.assistant ?? {}), status: full?.status ?? null, tone: summary.tone, sublabel: summary.sublabel, unread: Number(full?.unread) || 0 };
    renderNewWorkControl();
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

  // Either rail console counts: the Work tab's inline chat (chatMode) or the
  // rail's own Assistant tab. Only when neither is on screen does the floating
  // card draw the assistant.
  function railOwnsAssistant() {
    return state.selected?.kind === "assistant" && (feedVisible() || chatLogVisible());
  }

  function composerInput() {
    if (chatMode()) return el.chatInput ?? null;
    if (railOwnsAssistant()) return el.chatLogInput ?? null;
    return infoHost()?.querySelector(".assistant-composer input, .assistant-composer textarea") ?? null;
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

  // The satellites' statuses follow every push without a full snapshot.
  function syncAgentNodes() {
    const roster = assistantFull()?.agents;
    if (!Array.isArray(roster)) return;
    for (const node of state.nodes) {
      if (node.kind !== "agent" || node.builder || node.dying) continue;
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
      if (!result || result.ok === false) {
        window.MefiToast?.(`${label} not saved${result?.error ? ` · ${result.error}` : ""}`, "bad");
        return null;
      }
      if (result) state.assistant = { ...(state.assistant ?? {}), ...result };
      updateAssistantPill();
      if (state.selected?.kind === "assistant") renderInfo();
      state.feedDirty = true;
      if (state.active) renderFeed();
      const savedChoice = Object.hasOwn(patch, "mode")
        ? result.mode === "cluster" ? "Cluster" : "Swarm"
        : Object.hasOwn(patch, "autoBuild")
        ? result.autoBuild === false ? "Verify first" : "Auto build"
        : result.adaptiveParallel !== false ? "Machine managed" : `manual limit: ${result.parallel ?? patch.parallel ?? "?"}`;
      window.MefiToast?.(`${label} · ${savedChoice}`, "good");
      return result;
    } catch (error) {
      window.MefiToast?.(`${label} ${Object.hasOwn(patch, "autoBuild") || Object.hasOwn(patch, "mode") ? "update could not be confirmed" : "not saved"} · ${String(error?.message ?? error)}`, "bad");
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
  // the ask so the chat log shows it, and requests dispatch when unpaused —
  // the blue work ring on the node starts with this call and loops until the
  // work is done.
  async function workOnNode(node) {
    if (state.workOnBusy || node?.readOnly || node?.kind === "task-group") return;
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
      window.MefiToast?.(`${result.where ?? "queued"}. ${result.dispatch?.message ?? "Open Builder to follow its status."}`, result.dispatch?.held ? "info" : "good");
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
      if (result.autopilot) state.assistant = { ...(state.assistant ?? {}), ...result.autopilot };
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
      } else if (action === "start-work") window.MefiToast?.("new work is on · queued work can start when ready", "good");
      else if (action === "pause") window.MefiToast?.("new work is off · current jobs can finish", "info");
      else if (action === "stop-all") {
        const stopped = Number(result.stopped) || 0;
        window.MefiToast?.(stopped ? `stopped ${stopped} agent(s) · progress saved, work stays queued` : "no agents were running · new work is off", stopped ? "good" : "info");
      }
      else window.MefiToast?.(`assistant ${full?.status ?? action}`, "info");
      return result;
    } catch (error) {
      window.MefiToast?.(`${label} failed · ${String(error?.message ?? error)}`, "bad");
      return null;
    }
  }

  // The brake: every running agent stops now, each run's progress is
  // checkpointed, and new dispatch parks until the operator resumes.
  async function stopAllAgents() {
    if (state.stopAllBusy) return null;
    state.stopAllBusy = true;
    if (el.stopState) el.stopState.textContent = "stopping…";
    try {
      const result = await assistantControl("stop-all", "stop all agents");
      state.feedDirty = true;
      if (state.active) renderFeed();
      return result;
    } finally {
      state.stopAllBusy = false;
      if (el.stopState) el.stopState.textContent = "";
    }
  }

  // Restart Studio with the agents stopped first, so running builds cannot
  // defer the relaunch. The app comes back paused; Resume starts work again.
  async function restartStudio() {
    if (!window.mefiStudio?.appRestart) {
      window.MefiToast?.("restart runs in the desktop app only", "info");
      return null;
    }
    if (state.restartBusy) return null;
    state.restartBusy = true;
    if (el.stopState) el.stopState.textContent = "stopping agents…";
    try {
      const result = await window.mefiStudio.appRestart({ stopAgents: true });
      if (result?.deferred) window.MefiToast?.(`restart deferred · ${result.reason ?? "work is still running"}`, "info");
      else if (result?.ok === false) window.MefiToast?.(`restart failed · ${result.error ?? "unknown error"}`, "bad");
      return result;
    } catch (error) {
      window.MefiToast?.(`restart failed · ${String(error?.message ?? error)}`, "bad");
      return null;
    } finally {
      state.restartBusy = false;
      if (el.stopState) el.stopState.textContent = "";
    }
  }

  function newWorkStatus() {
    const full = assistantFull();
    const known = Boolean(full?.status) && typeof state.assistant?.execute === "boolean";
    return { known, enabled: known && full.status !== "paused" && state.assistant.execute !== false };
  }

  function renderNewWorkControl() {
    const { known, enabled } = newWorkStatus();
    const available = typeof window.mefiStudio?.assistantControl === "function";
    const busy = Boolean(state.newWorkBusy);
    const label = busy ? "Saving…" : !available ? "Desktop only" : !known ? "Loading…" : enabled ? "On" : "Off";
    for (const input of [el.chatLogNewWork, el.chatPause]) {
      if (!input) continue;
      input.checked = enabled;
      input.indeterminate = !known;
      input.disabled = !available || !known || busy;
      input.setAttribute("aria-busy", String(busy));
      input.setAttribute("aria-description", busy ? "Saving new work setting." : !available ? "Available in the desktop app." : !known ? "Loading new work setting." : "Allow new work to start. Turning this off pauses new work; current jobs can finish.");
    }
    for (const note of [el.chatLogNewWorkState, el.chatNewWorkState]) {
      if (note) note.textContent = label;
    }
  }

  async function changeNewWork(enabled) {
    const current = newWorkStatus();
    if (typeof enabled !== "boolean" || state.newWorkBusy || !current.known || !window.mefiStudio?.assistantControl || current.enabled === enabled) {
      renderNewWorkControl();
      return false;
    }
    state.newWorkBusy = true;
    renderNewWorkControl();
    try {
      const result = await assistantControl(enabled ? "start-work" : "pause", "new work");
      state.feedDirty = true;
      if (state.active) renderFeed();
      if (result) await refreshCommandBacklog(true);
      return Boolean(result);
    } finally {
      state.newWorkBusy = false;
      renderNewWorkControl();
      paintChatLog();
    }
  }

  function onAssistantEvent(payload) {
    const applied = window.MefiTree?.applyAssistant?.(payload) ?? Promise.resolve();
    refreshAssistantCache();
    updateAssistantPill();
    paintChatLog();
    if (typeof renderRailBadges === "function") renderRailBadges(payload?.state ?? null);
    if (state.railTab === "ask" && typeof renderAsks === "function") renderAsks(payload?.state ?? null);
    if (state.railTab === "done" && typeof loadDoneLog === "function" && Date.now() - (state.doneAt ?? 0) > 4000) void loadDoneLog();
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
      if (state.active && satellite) {
        // The satellite says what it is doing: the hop label for a running
        // agent, the outcome for a finished or failed one, "queued" while it
        // waits. The role prefix goes — the orb is already the role.
        const remark = agentRemark(payload?.event?.text, role);
        if (status === "error") say(satellite, remark || "failed", { kind: "error", ttl: SPEECH_TTL_LONG });
        else if (status === "done") say(satellite, remark || "done", { kind: "done" });
        else if (status === "queued") say(satellite, "queued · waiting for a slot", { ttl: 2600 });
        else if (remark) say(satellite, remark);
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
        // Sending and receiving, said out loud: the scout's bubble shows the
        // finding leaving (→), the hub's shows it landing (←) once the packet
        // arrives, so a hand-over reads as one exchange.
        const finding = agentRemark(payload?.event?.text, role);
        if (finding) {
          say(satellite, finding, { kind: "send", ttl: SPEECH_TTL_LONG });
          say(hub, `${role}: ${finding}`, { kind: "receive", ttl: SPEECH_TTL_LONG, delay: 1000 });
        }
      }
      if (state.selected?.kind === "assistant" || state.selected?.kind === "agent") renderInfo();
      return;
    }
    if (kind === "mail") {
      // One agent wrote to another: a packet rides sender → recipient in the
      // sender's colour, the sender's bubble shows the note leaving (→) and
      // the recipient's shows it landing (←) once the packet arrives. A read
      // (no sender on the event) is the recipient taking its notes: its own
      // bubble alone, so a pile being worked through never redraws the delivery.
      const from = payload?.event?.from ?? null;
      const to = payload?.event?.to ?? null;
      const note = String(payload?.event?.note ?? "").trim();
      const hub = assistantNode();
      const seat = (role) => (role === "assistant" ? hub : role ? state.nodes.find((node) => node.kind === "agent" && node.role === role) ?? null : null);
      const sender = seat(from);
      const recipient = seat(to);
      if (state.active && from && note && sender && recipient && sender !== recipient) {
        state.pulses.push({ from: sender, to: recipient, start: Date.now(), duration: 1100, color: agentHex(from), glow: agentHex(from), wave: true, packet: true });
        if (state.pulses.length > 24) state.pulses.shift();
        say(sender, `${to}: ${note}`, { kind: "send", ttl: SPEECH_TTL_LONG });
        say(recipient, `${from}: ${note}`, { kind: "receive", ttl: SPEECH_TTL_LONG, delay: 1000 });
      } else if (state.active && !from && recipient) {
        say(recipient, agentRemark(payload?.event?.text, to) || "reading notes", { ttl: SPEECH_TTL_LONG });
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
        // The thought itself, in a dotted bubble: the overseer's lands on the
        // hub as well, since that is who it is talking to.
        const thought = String(payload.event.text).slice(0, 160);
        say(satellite, thought, { kind: "think", ttl: SPEECH_TTL_LONG });
        if (fromOverseer) say(hub, `overseer: ${thought}`, { kind: "receive", ttl: SPEECH_TTL_LONG, delay: 900 });
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
        say(hub, `looking at "${String(focus.label ?? node.label ?? focus.id).slice(0, 44)}"`, { ttl: 3200 });
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
        // The conversation on the tree: your message lands on the hub, the
        // reply is said from it; tidy and fix passes get a plain remark.
        const line = String(payload?.event?.text ?? "").trim();
        if (kind === "reply") {
          const messages = assistantFull()?.messages ?? [];
          const last = messages[messages.length - 1];
          say(node, last?.role === "assistant" && last.text ? last.text : line || "replied", { ttl: SPEECH_TTL_LONG });
        } else if (kind === "message") say(node, line ? `you: ${line}` : "reading your message", { kind: "receive" });
        else say(node, line || (kind === "tidy" ? "tidied up" : "fixed things"), { kind: "done" });
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
    } else if (typeof window.MefiTree?.note?.() === "string" && window.MefiTree.note()) {
      // The store file exists but has no session schema yet: say what is
      // missing and how to fill it instead of "nothing in the last 14 days".
      title = "No sessions in the store yet";
      copy = window.MefiTree.note();
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
    else if (state.camMode === "follow") text = state.follow ? `Following ${state.follow.title} · drag or zoom to hold your own view` : "Waiting for active work · the camera holds here";
    else if (state.orbit === "paused") text = "spin paused · Space resumes · click a node · F fits";
    el.hint.textContent = text;
  }

  // The graph lives in the space left by the actual panels, including shorter
  // windows and an expanded conversation. Cache measurements between frames.
  function feedVisible() {
    // offsetWidth collapses to 0 when the ≤900px media query hides the panel
    return state.active && !state.feedCollapsed && !!el.feed && !el.feed.hidden && el.feed.offsetWidth > 0;
  }

  // The rail's own Assistant tab, measured the same way: the ≤900px media
  // query hides the whole rail, and setRailTab hides the panel off-tab.
  function chatLogVisible() {
    return state.active && state.chatLogOpen && !!el.chatLog && !el.chatLog.hidden && el.chatLog.offsetWidth > 0;
  }

  function railVisible() {
    return state.active && !!el.rail && !el.rail.hidden && el.rail.offsetWidth > 0;
  }

  // Inspect mode: the detail owns the rail and every other surface retreats to
  // its edge. Shaped like setAmbientZen — one body class, then let the CSS and
  // usableArea() do the work — with one deliberate difference: the HUD stays
  // interactive. Zen means "leave me alone"; this means "let me read one
  // thing", so every collapsed edge must still take a click.
  function setFocusMode(active) {
    const next = Boolean(active);
    if (next === state.focusMode) return false;
    state.focusMode = next;
    document.body.classList.toggle("command-focus", next);
    state.graphAreaAt = 0;
    state.hudRectsAt = 0;
    return true;
  }

  // Where a selected node's detail is drawn. The rail owns it whenever the rail
  // is on screen — full height, one scroller. The floating card is the
  // narrow-layout fallback, for the ≤900px width that hides the rail outright.
  function infoHost() {
    return (railVisible() && el.nodePanel) ? el.nodePanel : el.info;
  }

  // The projection centre is the middle of the clear rectangle. When a
  // floating panel moves it — the selection card opening on a click, the
  // Follow banner — the centre glides there at the camera's rate, so the
  // tree slides instead of jumping. It snaps when the frame itself changes
  // (the window, the rails, a feed toggle: the layout re-seeds against it
  // anyway), in the overview camera, whose back-off is instant, and under
  // reduced motion. Returns how far it still has to go, in pixels.
  function stepCenter(area, still, ease = CAMERA_EASE) {
    const frame = state.graphFrame ?? area;
    const frameKey = `${frame.x},${frame.y},${frame.w},${frame.h}`;
    const tx = area.x + area.w / 2, ty = area.y + area.h / 2;
    const center = state.center;
    const left = center ? Math.hypot(tx - center.x, ty - center.y) : 0;
    if (!center || still || state.camMode === "orbit" || center.frameKey !== frameKey || left < 0.25) {
      state.center = { x: tx, y: ty, frameKey };
      return 0;
    }
    center.x += (tx - center.x) * ease;
    center.y += (ty - center.y) * ease;
    return left * (1 - ease);
  }

  function centerX() {
    if (state.center) return state.center.x;
    const area = usableArea();
    return area.x + area.w / 2;
  }

  function centerY() {
    if (state.center) return state.center.y;
    const area = usableArea();
    return area.y + area.h / 2;
  }

  function project(node) {
    const scale = state.fit * state.zoom;
    const framing = state.overviewScale ?? 1;
    if (state.view === "2d") {
      // flat top-down map: x → screen x, z → screen y, no rotation or depth
      return {
        x: centerX() + (node.x + state.camera.x) * scale * framing,
        y: centerY() + (node.z + state.camera.z) * scale * framing,
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
    return { x: centerX() + rx * k * framing, y: centerY() + ry * k * framing, k, depth: (raw * 900) / distance };
  }

  function unprojectForLayout(point, source) {
    const scale = Math.max(0.01, state.fit * state.zoom);
    const framing = state.overviewScale ?? 1;
    if (state.view === "2d") return { x: (point.x - centerX()) / (scale * framing) - state.camera.x, y: source.y, z: (point.y - centerY()) / (scale * framing) - state.camera.z };
    const base = project(source);
    const distance = 900 * Math.max(1, scale / 1.6);
    const rz = base.depth * distance / 900 - distance;
    const rx = (point.x - centerX()) / (base.k * framing), ry = (point.y - centerY()) / (base.k * framing);
    const cos = Math.cos(state.angle), sin = Math.sin(state.angle);
    const tilt = Math.sin(state.angle * 0.37) * 0.35 + state.pitch;
    return { x: (rx * cos + rz * sin) / scale - state.camera.x, y: (ry + rz * Math.sin(tilt) * 0.4) / Math.cos(tilt) / scale - state.camera.y, z: (-rx * sin + rz * cos) / scale - state.camera.z };
  }

  // The HUD owns the top and bottom strips; fit against what is left.
  // The rail's width at rest (the --command-rail-width token), read once per
  // window size: inspect mode widens the live box, the layout frame does not.
  function railRestWidth() {
    if (!Number.isFinite(state.railRestWidth)) {
      const value = el.hud && typeof getComputedStyle === "function" ? parseFloat(getComputedStyle(el.hud).getPropertyValue("--command-rail-width")) : NaN;
      state.railRestWidth = Number.isFinite(value) ? value : 0;
    }
    return state.railRestWidth;
  }

  function usableArea() {
    if (state.settingsPreview) {
      const area = state.settingsPreview;
      state.graphFrame = { x: area.x, y: area.y, w: area.w, h: area.h };
      return { x: area.x, y: area.y, w: area.w, h: area.h };
    }
    if (state.ambientZen) {
      state.graphFrame = { x: 28, y: 28, w: Math.max(1, el.width - 56), h: Math.max(1, el.height - 56) };
      return { ...state.graphFrame };
    }
    const now = Date.now();
    if (state.graphArea && now - state.graphAreaAt < 250) return state.graphArea;
    const visibleBox = (node) => {
      if (!node || node.hidden) return null;
      const box = node.getBoundingClientRect();
      return box.width > 0 && box.height > 0 ? box : null;
    };
    let left = 28;
    let right = el.width - 28;
    let top = 110;
    let bottom = el.height - 86;
    const header = visibleBox(el.top);
    const dock = visibleBox(el.bottom);
    const rail = visibleBox(el.rail);
    const feed = visibleBox(el.feed);
    const chat = visibleBox(el.chatLog);
    if (header) top = Math.max(top, header.bottom + 20);
    if (dock) bottom = Math.min(bottom, dock.top - 24);
    // The app's navigation rail floats over the canvas's left edge, the way the
    // work rail floats over its right; fit the graph beside it, not under it.
    const appRail = visibleBox(el.appRail);
    if (appRail) left = Math.max(left, appRail.right + 28);
    // The merged rail owns the right gutter; when it is collapsed its short
    // header still blocks the top strip.
    if (rail) {
      if (state.railCollapsed) top = Math.max(top, rail.bottom + 24);
      else {
        // Inspect mode widens the rail over the canvas on every selection. The
        // frame, which the saved layout is keyed on, keeps the rail's resting
        // edge so a click never re-seeds the tree; the wider box is carved out
        // of the clear rectangle below and the projection centre glides after it.
        const rest = state.focusMode ? railRestWidth() : 0;
        const edge = rest > 0 ? Math.max(rail.left, rail.right - rest) : rail.left;
        right = Math.min(right, edge - 28);
      }
    } else {
      if (feed && !state.feedCollapsed && feed.left < el.width / 2) left = Math.max(left, feed.right + 28);
      if (chat && state.chatLogOpen && chat.left > el.width / 2) right = Math.min(right, chat.left - 28);
      // Collapsing a panel returns its side gutter, but its visible header is
      // still an obstruction. Begin the free canvas below those short headers.
      if (feed && state.feedCollapsed) top = Math.max(top, feed.bottom + 24);
      if (chat && !state.chatLogOpen) top = Math.max(top, chat.bottom + 24);
    }
    // At compact widths CSS can put the feed above the map. Only reserve a
    // side panel if it leaves enough room for an actual interactive graph.
    if (right - left < 220) {
      left = appRail ? appRail.right + 12 : 24;
      right = el.width - 24;
      if (feed && feed.height < el.height * 0.48) top = Math.max(top, feed.bottom + 20);
    }
    if (bottom - top < 160) top = Math.max(20, bottom - 160);
    // The frame: what is left between the fixed rails before floating panels
    // carve it. The persisted node layout is keyed on it (layoutProjectedGraphImpl).
    state.graphFrame = { x: left, y: top, w: Math.max(160, right - left), h: Math.max(160, bottom - top) };
    let spaces = [{ ...state.graphFrame }];
    // Details, menus and the Follow banner can extend into the space between
    // the main rails. Fit the graph into the largest remaining clear rectangle
    // instead of merely hiding its labels behind those panels. (The persisted
    // node layout is keyed on the frame above, not on this rectangle, so the
    // selection card opening on a click carves the rectangle without
    // re-seeding the tree, and the projection centre glides after it —
    // stepCenter — instead of jumping.)
    for (const panel of [feed, chat, state.focusMode && !state.railCollapsed ? rail : null, visibleBox(el.info), visibleBox(el.followStatus), visibleBox(el.legend), visibleBox(el.pop)]) {
      if (!panel) continue;
      const x = panel.left - 20, y = panel.top - 20, rightEdge = panel.right + 20, bottomEdge = panel.bottom + 20;
      spaces = spaces.flatMap((area) => {
        const r = area.x + area.w, b = area.y + area.h;
        if (x >= r || rightEdge <= area.x || y >= b || bottomEdge <= area.y) return [area];
        return [
          { ...area, w: x - area.x }, { ...area, x: rightEdge, w: r - rightEdge },
          { ...area, h: y - area.y }, { ...area, y: bottomEdge, h: b - bottomEdge },
        ].filter((space) => space.w > 0 && space.h > 0);
      });
    }
    const usable = spaces.filter((area) => area.w >= 160 && area.h >= 160);
    state.graphArea = (usable.length ? usable : spaces).sort((a, b) => b.w * b.h - a.w * a.h)[0] ?? { x: left, y: top, w: 1, h: 1 };
    state.graphAreaAt = now;
    return state.graphArea;
  }

  function autoFit({ ease = false } = {}) {
    // Keep the whole constellation inside the frame at any window size.
    // An explicit fit (F, Fit, a restore) lands at once; the refit a panel
    // opening or closing asks for eases there (drawFrame steps state.fit
    // toward fitTarget), so selecting a node no longer pops the tree's scale.
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
    const fitX = Math.max(120, area.w - 96) / (reach * 2 * 1.3);
    const fitY = Math.max(100, area.h - 60) / (maxY * 2 * 1.6);
    const next = Math.max(0.24, Math.min(2.4, Math.min(fitX, fitY)));
    if (ease && !noMotion() && Number.isFinite(state.fit)) {
      state.fitTarget = next;
      return;
    }
    state.fitTarget = null;
    const visibleScale = state.fit * state.zoom;
    state.fit = next;
    if (state.camMode === "follow") state.zoom = Math.max(0.45, Math.min(2.6, visibleScale / state.fit));
  }

  function setZoom(value) {
    state.zoom = Math.min(2.6, Math.max(0.45, value));
    state.zoomTarget = null; // an instant zoom (wheel, fit, restore) ends any glide
  }

  // A zoom the camera glides to instead of snapping: the frame loop eases
  // state.zoom toward it at the camera's own rate, so a click closes in on a
  // node with the scale and the pan arriving together. Snapping the scale
  // first threw the clicked node outward from the centre (off-screen for an
  // edge node) before the pan brought it back — the jump a click used to
  // make. Reduced motion lands at once, like the camera does.
  function glideZoom(value) {
    const target = Math.min(2.6, Math.max(0.45, value));
    if (noMotion()) { setZoom(target); return; }
    state.zoomTarget = target;
  }

  function fitAll() {
    // Fit is an explicit layout repair, including after an edge-on orbit or
    // a drag still in progress. Automatic refits keep the user's orientation.
    state.angle = 0.5;
    state.pitch = 0;
    state.orbitVel = 0;
    state.settleUntil = Date.now() + SETTLE_MS;
    state.panning = null;
    state.rotating = null;
    state.follow = null;
    state.followReadAt = 0;
    state.followZoomTarget = null;
    state.agentLayout?.clear();
    state.graphAreaAt = 0;
    state.hudRectsAt = 0;
    if (el.canvas) el.canvas.style.cursor = "default";
    setCamMode("orbit", { quiet: true });
  }

  // A layout switch (arrangement, 2D/3D, Fit, Orbit) is instant underneath:
  // the new anchors are saved at once and the harnesses read them at once. On
  // screen each node travels from where it was painted to its new spot
  // (drawFrame blends the projected points), so the tree morphs instead of
  // teleporting. A switch mid-morph starts from the positions on screen.
  function beginLayoutMorph(ms = 240) {
    if (noMotion()) return;
    const from = new Map();
    for (const node of state.nodes) if (Number.isFinite(node._px) && Number.isFinite(node._py)) from.set(node.id, { x: node._px, y: node._py });
    if (from.size) state.morph = { from, at: globalThis.performance?.now?.() ?? Date.now(), ms };
  }

  function refitLayout() {
    if (state.active && typeof beginLayoutMorph === "function") beginLayoutMorph();
    state.screenLayout = null;
    state.overviewScale = 1;
    state.center = null; // the centre snaps to the refit frame
    state.camera.tx = 0;
    state.camera.ty = 0;
    state.camera.tz = 0;
    state.pitch = 0;
    setZoom(1);
    autoFit();
    // A fit creates new managed anchors immediately. Seed them against the
    // final camera, otherwise its later easing carries edge nodes out of view.
    state.camera.x = 0;
    state.camera.y = 0;
    state.camera.z = 0;
    hideTip();
  }

  function nodeState(node) {
    const touch = state.touches.get(node.sessionId);
    const fresh = touch ? Math.max(0, 1 - (Date.now() - touch.at) / 90000) : 0;
    return { touch, fresh };
  }

  function colorOf(node) {
    if (node.kind === "music") return NODE_RGB.warm;
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
    if (node._workLabel === "Verifying" || (node.task ?? node.workTask)?.status === "awaiting_verification") return NODE_RGB.verify;
    if (node._workLabel === "Running") return NODE_RGB.warm;
    if (node._workLabel === "Next") return NODE_RGB.dust;
    if (node.state === "stale") return NODE_RGB.stale;
    if (node.state === "done") return NODE_RGB.done;
    if (node.state === "active") return NODE_RGB.warm;
    if (node.kind === "task") return NODE_RGB.task;
    if (node.kind === "todo") return NODE_RGB.pending;
    return NODE_RGB.session;
  }

  // Hover and selection come forward in about 90 ms and settle back in about
  // 160 ms; with no frame time (or reduced motion) they land at once.
  function easeLift(current, want, dt, still) {
    if (still || !(dt > 0) || !Number.isFinite(current)) return want;
    const next = current + (want - current) * (1 - Math.exp(-dt / (want > current ? 0.09 : 0.16)));
    return Math.abs(next - want) < 0.01 ? want : next;
  }

  function nodeVisualProfile(node) {
    const focused = state.hoverNode === node || Boolean(state.selected && state.selected.id === node.id);
    const verifying = node._workLabel === "Verifying" || (node.task ?? node.workTask)?.status === "awaiting_verification";
    const working = !verifying && (node._workLabel === "Running" || node.state === "active") || node.kind === "agent" && node.status === "running";
    const always = working || node.kind === "assistant";
    // Hover and selection ease an orb forward and back (drawFrame steps
    // node._lift); working orbs and the hub stay forward. Without a stepped
    // value the profile answers at once, as it always did.
    const lift = always ? 1 : Number.isFinite(node._lift) ? node._lift : focused ? 1 : 0;
    return { prominent: always || focused, maxRadius: 11 + 4 * lift, alpha: 0.65 + 0.35 * lift, shape: "circle" };
  }

  function setSettingsPreview(rect) {
    if (state.ambientZen) setAmbientZen(false);
    if (rect && [rect.x, rect.y, rect.w, rect.h].every(Number.isFinite) && rect.w >= 160 && rect.h >= 160) {
      const next = { x: Math.max(0, rect.x), y: Math.max(0, rect.y), w: rect.w, h: rect.h };
      if (!state.previewRestore) state.previewRestore = { wasActive: state.active, camera: { ...state.camera }, camMode: state.camMode, fit: state.fit, zoom: state.zoom, overviewScale: state.overviewScale ?? 1, angle: state.angle, pitch: state.pitch, follow: state.follow, followZoomTarget: state.followZoomTarget, screenLayout: state.screenLayout, nodeLayout: state.nodeLayout };
      const changed = !state.settingsPreview || Object.keys(next).some((key) => next[key] !== state.settingsPreview[key]);
      state.settingsPreview = next;
      state.graphArea = null; state.graphAreaAt = 0;
      if (!state.active) enter(true);
      if (changed) {
        // The settings preview frames the real graph without overwriting the
        // saved camera mode. Its former view is restored when the panel closes.
        state.camMode = "orbit"; state.orbitVel = 0; refitLayout();
      }
      return;
    }
    if (rect) return;
    const previous = state.previewRestore;
    state.settingsPreview = null; state.previewRestore = null;
    state.graphArea = null; state.graphAreaAt = 0;
    if (!previous) return;
    for (const key of ["camera", "camMode", "fit", "zoom", "overviewScale", "angle", "pitch", "follow", "followZoomTarget"]) state[key] = previous[key];
    state.screenLayout = previous.nodeLayout === state.nodeLayout ? previous.screenLayout : null;
    if (!previous.wasActive) exit();
    else { syncViewControls(); renderHint(); }
  }

  function applyTreePreferences(preferences = {}) {
    if (typeof preferences.orbitTrails === "boolean") state.orbitTrails = preferences.orbitTrails;
    if (typeof preferences.extraGlow === "boolean") state.extraGlow = preferences.extraGlow;
    // music.js owns the style names and gates the Void collection, so it
    // only ever sends a style the viewer may see; a bare harness without it
    // still knows the built-in eight.
    const music = globalThis.window?.MefiMusic;
    const known = typeof music?.isNodeStyle === "function" ? music.isNodeStyle(preferences.nodeStyle) : ["orbs", "glass", "minimal", "halo", "crystal", "singularity", "prism", "sigil"].includes(preferences.nodeStyle);
    const style = known ? preferences.nodeStyle : state.nodeStyle;
    const layout = ["constellation", "tree", "radial", "helix", "layers"].includes(preferences.nodeLayout) ? preferences.nodeLayout : state.nodeLayout;
    state.nodeStyle = style;
    if (layout === state.nodeLayout) return;
    state.nodeLayout = layout;
    state.screenLayout = null;
    if (state.active && el.width && el.height) refitLayout();
  }

  function traceNodeSurface(ctx, _shape, x, y, radius) {
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
  }

  // Gradients are evaluated under the transform at fill time. Reuse unit
  // paints while retaining the original screen-space paths, rims and glyphs.
  // The context owns its paints; old palettes cannot grow the cache forever.
  function orbPaints(ctx, tint, active, selected) {
    const contexts = state.orbPaintCache ??= new WeakMap();
    let cache = contexts.get(ctx);
    if (!cache) { cache = new Map(); contexts.set(ctx, cache); }
    const key = `${tint.join(",")}|${Boolean(active)}|${Boolean(selected)}`;
    let paints = cache.get(key);
    if (paints) return paints;
    const halo = ctx.createRadialGradient(0, 0, 0.45, 0, 0, active || selected ? 1.9 : 1.45);
    halo.addColorStop(0, rgba(tint, active ? 0.22 : 0.1));
    halo.addColorStop(1, rgba(tint, 0));
    const body = ctx.createRadialGradient(-0.25, -0.3, 0, 0, 0, 1);
    body.addColorStop(0, rgba(tint, 0.95));
    body.addColorStop(0.42, rgba(tint, 0.48));
    body.addColorStop(1, rgba(tint, 0.1));
    paints = { halo, body };
    if (cache.size >= 128) cache.delete(cache.keys().next().value);
    cache.set(key, paints);
    return paints;
  }

  // ---------- the Void collection's node styles ----------
  // The orbs' frame budget applies: every gradient (the conic accretion disc
  // included) is a unit-space paint cached per context, tint and theme hue;
  // the derived tones are cached triples so rgba() memoizes their strings. A
  // frame allocates nothing new and every path has a fixed, small number of
  // segments. The node's own tint (done green, working lavender, error amber)
  // stays the dominant colour; the theme's second hue (accent2) is only ever a
  // highlight.
  // The gem and seal shapes are tree3d.js's (bundled first and shared on
  // window.MefiTree.voidShapes), so the rail cuts the same gem; without them
  // (a bare harness) the gem falls back to a plain disc and the seal to a dot.
  function voidShapes() {
    return globalThis.window?.MefiTree?.voidShapes ?? null;
  }
  // The theme's second hue, parsed once per theme change (music.js resolves it
  // on the canvas palette; a free theme's falls back to its bright tone).
  let premiumAccentHex = null, premiumAccentRgb = null;
  function premiumAccent(fallback) {
    const hex = state.canvasPalette?.accent2 ?? null;
    if (hex !== premiumAccentHex) {
      premiumAccentHex = hex;
      const value = typeof hex === "string" && /^#[\da-f]{6}$/i.test(hex) ? parseInt(hex.slice(1), 16) : NaN;
      premiumAccentRgb = Number.isNaN(value) ? null : [(value >> 16) & 255, (value >> 8) & 255, value & 255];
    }
    return premiumAccentRgb ?? fallback;
  }

  function premiumPaints(ctx, tint, style, lit) {
    const contexts = state.premiumPaintCache ??= new WeakMap();
    let cache = contexts.get(ctx);
    if (!cache) { cache = new Map(); contexts.set(ctx, cache); }
    const key = `${style}|${tint.join(",")}|${lit}|${premiumAccentHex}`;
    let paints = cache.get(key);
    if (paints) return paints;
    const mix = (toward, amount) => tint.map((value, index) => Math.round(value + (toward[index] - value) * amount));
    // hot: the whitened tint; ink: a light glyph ink that keeps a trace of the
    // hue; deep: a body dark enough to read as depth, still carrying the hue.
    const hot = mix([255, 255, 255], 0.6), ink = mix([255, 255, 255], 0.86), deep = mix([7, 8, 16], 0.86);
    const shade = deep.map((value, index) => Math.round(value + (tint[index] - value) * 0.4));
    const accent = premiumAccent(hot);
    const conic = typeof ctx.createConicGradient === "function";
    let glow = null, disc = null, fade = null, core = null;
    if (style === "singularity") {
      glow = ctx.createRadialGradient(0, 0, 0.5, 0, 0, lit ? 1.72 : 1.45);
      glow.addColorStop(0, rgba(tint, lit ? 0.46 : 0.3));
      glow.addColorStop(0.3, rgba(tint, lit ? 0.16 : 0.09));
      glow.addColorStop(1, rgba(tint, 0));
      // The accretion disc, brightest on its approaching (lower-left) side and
      // dimmest opposite, where a trace of the theme's second hue shows...
      disc = conic ? ctx.createConicGradient(Math.PI * 0.72, 0, 0) : ctx.createRadialGradient(-0.35, 0.35, 0, 0, 0, 1);
      disc.addColorStop(0, rgba(hot, 1));
      disc.addColorStop(0.14, rgba(tint, lit ? 1 : 0.94));
      disc.addColorStop(0.34, rgba(tint, lit ? 0.56 : 0.42));
      disc.addColorStop(0.5, rgba(accent, lit ? 0.3 : 0.2));
      disc.addColorStop(0.66, rgba(tint, lit ? 0.56 : 0.42));
      disc.addColorStop(0.86, rgba(tint, lit ? 1 : 0.94));
      disc.addColorStop(1, rgba(hot, 1));
      // ...and hottest at its inner edge, cooling into the glow outside.
      fade = ctx.createRadialGradient(0, 0, 0.66, 0, 0, 0.97);
      fade.addColorStop(0, rgba(deep, 0));
      fade.addColorStop(1, rgba(deep, lit ? 0.5 : 0.62));
      // The horizon: black at the centre, warming to a deep tint just inside
      // the photon ring (a soft inner edge), then a thin black gap before the
      // disc begins.
      core = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.68);
      core.addColorStop(0, "rgba(2,1,5,1)");
      core.addColorStop(0.62, "rgba(2,1,5,1)");
      core.addColorStop(0.87, rgba(shade, 1));
      core.addColorStop(0.92, "rgba(2,1,5,1)");
      core.addColorStop(1, "rgba(2,1,5,1)");
    } else if (lit) {
      // Prism and Sigil glow only while they work or are chosen.
      glow = ctx.createRadialGradient(0, 0, 0.55, 0, 0, 1.6);
      glow.addColorStop(0, rgba(tint, 0.3));
      glow.addColorStop(1, rgba(tint, 0));
    }
    if (style === "sigil") {
      // A faint well of the node's hue inside the seal, for depth.
      core = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.92);
      core.addColorStop(0, rgba(tint, lit ? 0.22 : 0.15));
      core.addColorStop(1, rgba(tint, 0));
    }
    paints = { hot, ink, deep, shade, accent, glow, disc, fade, core };
    if (cache.size >= 128) cache.delete(cache.keys().next().value);
    cache.set(key, paints);
    return paints;
  }

  // The light ink a role glyph wears on the Void collection's dark bodies
  // (Singularity's core, Prism's table, Sigil's seal), or null for the orbs'
  // own ink. Agent tints are long-lived triples, so the ink is kept per tint
  // and a frame builds no cache key for it.
  const premiumInks = new WeakMap();
  function premiumGlyphInk(ctx, tint) {
    const style = state.nodeStyle;
    if (style !== "singularity" && style !== "prism" && style !== "sigil") return null;
    let ink = premiumInks.get(tint);
    if (!ink) { ink = rgba(premiumPaints(ctx, tint, style, false).ink, 1); premiumInks.set(tint, ink); }
    return ink;
  }

  // A near-black core behind a thin photon ring, inside an accretion disc
  // whose brightness turns with the angle, over a faint outer glow.
  function drawSingularity(ctx, p, radius, tint, lit, selected) {
    const paints = premiumPaints(ctx, tint, "singularity", lit);
    const { glow, disc, fade, core, hot, deep } = paints;
    ctx.save(); ctx.translate(p.x, p.y); ctx.scale(radius, radius);
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, lit ? 1.72 : 1.45, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, 0.96, 0, Math.PI * 2);
    ctx.fillStyle = rgba(deep, 1); ctx.fill();
    ctx.fillStyle = disc; ctx.fill();
    ctx.fillStyle = fade; ctx.fill();
    ctx.fillStyle = core; ctx.beginPath(); ctx.arc(0, 0, 0.68, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.beginPath(); ctx.arc(p.x, p.y, radius * 0.6, 0, Math.PI * 2);
    ctx.strokeStyle = rgba(hot, lit ? 1 : 0.86); ctx.lineWidth = Math.max(0.7, radius * (lit ? 0.085 : 0.065)); ctx.stroke();
    if (selected) { ctx.beginPath(); ctx.arc(p.x, p.y, radius * 1.16, 0, Math.PI * 2); ctx.strokeStyle = rgba(hot, 0.9); ctx.lineWidth = 1.4; ctx.stroke(); }
    return paints;
  }

  // A kite-cut gem lit from the upper left: the crown in the whitened tint,
  // the pavilion's left plane in the tint and its right in shadow, a crisp
  // rim, the light that refracts out along the lower right edge in the
  // theme's second hue and one specular glint. A small gem keeps two planes,
  // a tiny one a single plane; a glyph sits on a dark table in a light ink.
  function drawPrism(ctx, p, radius, tint, lit, active, selected, glyph) {
    const shapes = voidShapes();
    const paints = premiumPaints(ctx, tint, "prism", lit);
    const { glow, hot, deep, shade, accent } = paints;
    const facets = shapes ? shapes.prismFacets(radius) : 0;
    ctx.save(); ctx.translate(p.x, p.y); ctx.scale(radius, radius);
    if (glow) { ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, 1.6, 0, Math.PI * 2); ctx.fill(); }
    ctx.beginPath();
    if (shapes) shapes.trace(ctx, shapes.prismRim); else ctx.arc(0, 0, 0.9, 0, Math.PI * 2);
    ctx.fillStyle = rgba(deep, 1); ctx.fill();
    if (!shapes) { ctx.fillStyle = rgba(tint, lit ? 0.86 : 0.7); ctx.fill(); }
    for (let facet = 0; facet < facets; facet += 1) {
      const tone = facets === 1 ? 1 : facet; // 0 light, 1 mid, 2 shadow
      ctx.beginPath(); shapes.prismFacet(ctx, facets, facet);
      ctx.fillStyle = tone === 0 ? rgba(hot, lit ? 0.96 : 0.86) : tone === 1 ? rgba(tint, lit ? 0.86 : 0.7) : rgba(shade, 1);
      ctx.fill();
    }
    ctx.restore();
    if (glyph && shapes) {
      ctx.beginPath(); shapes.prismTable(ctx, p.x, p.y, radius);
      ctx.fillStyle = rgba(deep, 0.94); ctx.fill();
      ctx.strokeStyle = rgba(hot, 0.5); ctx.lineWidth = 0.8; ctx.stroke();
    }
    ctx.beginPath();
    if (shapes) shapes.trace(ctx, shapes.prismRim, p.x, p.y, radius); else ctx.arc(p.x, p.y, radius * 0.9, 0, Math.PI * 2);
    ctx.strokeStyle = selected ? rgba(hot, 1) : rgba(tint, active ? 0.95 : 0.72); ctx.lineWidth = selected ? 1.6 : active ? 1.2 : 0.85; ctx.stroke();
    if (facets === 3) {
      ctx.beginPath(); shapes.prismEdge(ctx, p.x, p.y, radius);
      ctx.strokeStyle = rgba(accent, lit ? 1 : 0.86); ctx.lineWidth = Math.max(0.8, radius * 0.075); ctx.stroke();
      if (radius >= 8 && !glyph) {
        ctx.beginPath(); shapes.prismGlint(ctx, p.x, p.y, radius);
        ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.fill();
      }
    }
    return paints;
  }

  // A calm double ring (the outer crisp, the inner faint) with a few small
  // diamonds in the theme's second hue between them and a seal at the centre;
  // a node that wears a glyph shows its glyph instead of the seal.
  function drawSigil(ctx, p, radius, tint, lit, selected, glyph) {
    const shapes = voidShapes();
    const paints = premiumPaints(ctx, tint, "sigil", lit);
    const { glow, core, deep, accent } = paints;
    ctx.save(); ctx.translate(p.x, p.y); ctx.scale(radius, radius);
    if (glow) { ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, 1.6, 0, Math.PI * 2); ctx.fill(); }
    ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fillStyle = rgba(deep, 0.92); ctx.fill();
    ctx.fillStyle = core; ctx.fill();
    ctx.restore();
    ctx.beginPath(); ctx.arc(p.x, p.y, radius * 0.9, 0, Math.PI * 2);
    ctx.strokeStyle = rgba(tint, lit ? 1 : 0.8); ctx.lineWidth = selected ? 2 : lit ? 1.5 : 1.1; ctx.stroke();
    if (radius >= 6) {
      ctx.beginPath(); ctx.arc(p.x, p.y, radius * 0.56, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(tint, lit ? 0.5 : 0.36); ctx.lineWidth = 0.8; ctx.stroke();
      if (shapes) { ctx.beginPath(); shapes.sigilMarks(ctx, p.x, p.y, radius); ctx.fillStyle = rgba(accent, lit ? 1 : 0.88); ctx.fill(); }
    }
    if (!glyph) {
      ctx.beginPath();
      if (shapes) shapes.sigilSeal(ctx, p.x, p.y, radius); else ctx.arc(p.x, p.y, Math.max(1.2, radius * 0.24), 0, Math.PI * 2);
      ctx.fillStyle = rgba(tint, lit ? 1 : 0.9); ctx.fill();
    }
    return paints;
  }

  function drawNodeSurface(ctx, node, p, radius, tint, { selected = false, active = false, alpha = 1 } = {}) {
    ctx.save();
    ctx.globalAlpha = (node._fade ?? 1) * alpha;
    node._extraGlow = state.extraGlow === true;
    if (node._extraGlow) {
      const spread = radius * (active || selected ? 2.25 : 1.8);
      const glow = ctx.createRadialGradient(p.x, p.y, radius * 0.25, p.x, p.y, spread);
      glow.addColorStop(0, rgba(tint, active || selected ? 0.32 : 0.16));
      glow.addColorStop(0.45, rgba(tint, active || selected ? 0.14 : 0.05));
      glow.addColorStop(1, rgba(tint, 0));
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(p.x, p.y, spread, 0, Math.PI * 2); ctx.fill();
    }
    const style = state.nodeStyle ?? "orbs";
    if (style === "halo") {
      ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(10,17,28,0.82)"; ctx.fill();
      ctx.strokeStyle = rgba(tint, active || selected ? 0.95 : 0.68); ctx.lineWidth = active || selected ? 2 : 1.4;
      ctx.shadowColor = rgba(tint, 0.6); ctx.shadowBlur = active || selected ? 12 : 6; ctx.stroke(); ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.arc(p.x, p.y, radius * 0.6, 0, Math.PI * 2); ctx.strokeStyle = rgba(tint, 0.24); ctx.lineWidth = 0.8; ctx.stroke();
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1.5, radius * 0.16), 0, Math.PI * 2); ctx.fillStyle = rgba(tint, 0.9); ctx.fill();
      ctx.restore(); return;
    }
    if (style === "crystal") {
      const points = Array.from({ length: 6 }, (_, index) => ({ x: p.x + Math.cos(index * Math.PI / 3 - Math.PI / 2) * radius, y: p.y + Math.sin(index * Math.PI / 3 - Math.PI / 2) * radius }));
      ctx.beginPath(); points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)); ctx.closePath();
      const gem = ctx.createLinearGradient(p.x - radius, p.y - radius, p.x + radius, p.y + radius);
      gem.addColorStop(0, rgba(tint, 0.8)); gem.addColorStop(0.45, rgba(tint, 0.28)); gem.addColorStop(1, "rgba(12,19,31,0.96)");
      ctx.fillStyle = gem; ctx.fill(); ctx.strokeStyle = rgba(tint, active || selected ? 0.95 : 0.6); ctx.lineWidth = selected ? 1.7 : 1; ctx.stroke();
      ctx.beginPath(); for (const point of points.filter((_, index) => index % 2 === 0)) { ctx.moveTo(p.x, p.y); ctx.lineTo(point.x, point.y); }
      ctx.strokeStyle = rgba(tint, 0.35); ctx.lineWidth = 0.7; ctx.stroke();
      ctx.restore(); return;
    }
    if (style === "singularity" || style === "prism" || style === "sigil") {
      const lit = active || selected;
      const monogram = node.kind === "assistant" || node.kind === "music";
      // A node that wears a glyph (the hub's monogram, an agent's role) gets
      // a dark body to wear it on: the core, the gem's table, the seal.
      const glyph = monogram || node.kind === "agent" && radius >= 4.5;
      const paints = style === "singularity" ? drawSingularity(ctx, p, radius, tint, lit, selected)
        : style === "prism" ? drawPrism(ctx, p, radius, tint, lit, active, selected, glyph)
          : drawSigil(ctx, p, radius, tint, lit, selected, glyph);
      if (monogram) {
        ctx.font = '600 10px system-ui, "Segoe UI", sans-serif'; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillStyle = rgba(paints.ink, 1);
        ctx.fillText(node.kind === "music" ? "♪" : "M", p.x, p.y + 0.5);
      }
      ctx.restore(); return;
    }
    if (style === "minimal") {
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(3, radius * (active ? 0.65 : 0.48)), 0, Math.PI * 2);
      ctx.fillStyle = rgba(tint, selected || active ? 0.95 : 0.6); ctx.fill();
      if (selected) { ctx.strokeStyle = "#eef3fa"; ctx.lineWidth = 1.5; ctx.stroke(); }
      ctx.restore(); return;
    }
    if (style === "glass") {
      traceNodeSurface(ctx, "circle", p.x, p.y, radius);
      ctx.fillStyle = "#172331"; ctx.fill();
      const glass = ctx.createLinearGradient(p.x - radius, p.y - radius, p.x + radius, p.y + radius);
      glass.addColorStop(0, rgba(tint, active || selected ? 0.42 : 0.22)); glass.addColorStop(0.55, "rgba(31,43,59,0.15)"); glass.addColorStop(1, rgba(tint, 0.06));
      ctx.fillStyle = glass; ctx.fill(); ctx.strokeStyle = rgba(tint, selected ? 0.95 : active ? 0.72 : 0.42); ctx.lineWidth = selected ? 1.7 : 1; ctx.stroke();
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(2, radius - 3), Math.PI * 1.13, Math.PI * 1.6);
      ctx.strokeStyle = "rgba(231,243,255,0.55)"; ctx.lineWidth = 1; ctx.stroke();
      ctx.restore(); return;
    }
    const glowRadius = radius * (active || selected ? 1.9 : 1.45);
    const { halo, body } = orbPaints(ctx, tint, active, selected);
    // One transform block for both unit-space paints: the halo disc at its
    // glow radius, then the opaque core and the body over it. The circles are
    // traced in that same unit space (the transform maps them onto the exact
    // screen circles), so the three save/restore pairs the screen-space
    // version needed become one per orb; the rim strokes in screen space.
    ctx.save(); ctx.translate(p.x, p.y); ctx.scale(radius, radius);
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(0, 0, glowRadius / radius, 0, Math.PI * 2); ctx.fill();
    // A luminous orb with an opaque centre: restrained halo, one clear rim.
    ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fillStyle = "#151a22"; ctx.fill();
    ctx.fillStyle = body; ctx.fill();
    ctx.restore();
    traceNodeSurface(ctx, "circle", p.x, p.y, radius);
    ctx.strokeStyle = rgba(tint, selected ? 1 : active ? 0.85 : 0.55);
    ctx.lineWidth = selected ? 1.8 : active ? 1.3 : 0.8; ctx.stroke();
    if (!["assistant", "music"].includes(node.kind)) {
      ctx.fillStyle = "rgba(242,249,255,0.62)"; ctx.beginPath(); ctx.arc(p.x - radius * 0.25, p.y - radius * 0.3, Math.max(1, radius * 0.13), 0, Math.PI * 2); ctx.fill();
    }
    if (node.kind === "assistant" || node.kind === "music") {
      ctx.font = '600 10px system-ui, "Segoe UI", sans-serif'; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = "#edf0f5"; ctx.fillText(node.kind === "music" ? "♪" : "M", p.x, p.y + 0.5);
    }
    ctx.restore();
  }

  // ---------- agent dress: glyph, status ring, wake; the hub's breathing ----------
  // The role glyph inside the orb and a ring that says what the agent is up
  // to: a spinning arc while it works, a dashed ring while it waits its turn,
  // amber when it failed, a green tick for a beat when it just finished.
  function drawAgentDress(ctx, node, p, radius, tint, time, still) {
    if (node.kind !== "agent" || node._absorbed || radius < 4.5 || state.nodeStyle === "minimal") return;
    ctx.save();
    ctx.globalAlpha = (node._fade ?? 1) * Math.max(0.35, emphasis(node));
    const hex = agentHex(node.role);
    // On the Void collection's near-black bodies the glyph takes a light ink
    // and sits inside the core.
    const premiumInk = premiumGlyphInk(ctx, tint);
    window.MefiTree?.agentGlyph?.(ctx, node.role, p.x, p.y, radius * (premiumInk ? 0.56 : 0.7), premiumInk ?? window.MefiTree?.glyphInk?.(hex) ?? "#0b1016");
    const ring = radius + 3.5;
    if (node.status === "running" || node.builder) {
      const phase = still ? 0 : time / 380;
      ctx.beginPath(); ctx.arc(p.x, p.y, ring, phase, phase + Math.PI * 1.3);
      ctx.strokeStyle = rgba(tint, 0.9); ctx.lineWidth = 1.3; ctx.stroke();
      if (!still) {
        ctx.beginPath(); ctx.arc(p.x, p.y, ring, phase + Math.PI * 1.5, phase + Math.PI * 1.7);
        ctx.strokeStyle = rgba(tint, 0.35); ctx.lineWidth = 1; ctx.stroke();
      }
    } else if (node.status === "queued") {
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.arc(p.x, p.y, ring, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(tint, 0.5); ctx.lineWidth = 1; ctx.stroke();
      ctx.setLineDash([]);
    } else if (node.status === "error") {
      ctx.beginPath(); ctx.arc(p.x, p.y, ring, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(NODE_RGB.amber, 0.85); ctx.lineWidth = 1.4; ctx.stroke();
      const bx = p.x + radius + 3, by = p.y - radius - 3;
      ctx.beginPath(); ctx.arc(bx, by, 5, 0, Math.PI * 2); ctx.fillStyle = "#3a2a12"; ctx.fill();
      ctx.strokeStyle = rgba(NODE_RGB.amber, 0.9); ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = rgb(NODE_RGB.amber); ctx.font = '700 8px system-ui, "Segoe UI", sans-serif'; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("!", bx, by + 0.5);
    } else if (node.status === "done") {
      const bx = p.x + radius + 3, by = p.y - radius - 3;
      ctx.beginPath(); ctx.arc(bx, by, 5, 0, Math.PI * 2); ctx.fillStyle = "#173025"; ctx.fill();
      ctx.strokeStyle = rgba(NODE_RGB.done, 0.85); ctx.lineWidth = 1; ctx.stroke();
      ctx.strokeStyle = rgb(NODE_RGB.done); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(bx - 2.6, by); ctx.lineTo(bx - 0.8, by + 1.9); ctx.lineTo(bx + 2.6, by - 2); ctx.stroke();
    }
    ctx.restore();
    // The wake: only while the satellite actually travels, sampled from the
    // painted position so it follows whatever the layout decided, camera
    // moves included. Builders circle in place and leave none.
    const travelling = !node.builder && (node.phase === "flying" || node.phase === "returning");
    if (travelling && !still) {
      const trail = state.agentTrails.get(node.id) ?? [];
      trail.push({ x: p.x, y: p.y, at: time });
      while (trail.length > TRAIL_MAX || (trail.length && time - trail[0].at > TRAIL_MS)) trail.shift();
      state.agentTrails.set(node.id, trail);
    } else state.agentTrails.delete(node.id);
  }

  // Wakes are painted under the orbs, from the positions of the frames before.
  function drawAgentTrails(ctx, time) {
    if (!state.agentTrails.size) return;
    for (const [id, trail] of state.agentTrails) {
      if (!trail.length || time - trail[trail.length - 1].at > TRAIL_MS) { state.agentTrails.delete(id); continue; }
      const node = state.nodes.find((entry) => entry.id === id);
      if (!node || trail.length < 2) continue;
      const tint = agentRgb(node.role);
      ctx.save();
      ctx.lineCap = "round";
      for (let index = 1; index < trail.length; index += 1) {
        const life = 1 - (time - trail[index].at) / TRAIL_MS;
        if (life <= 0) continue;
        ctx.strokeStyle = rgba(tint, 0.6 * life);
        ctx.lineWidth = 0.8 + 2.6 * (index / trail.length);
        ctx.beginPath(); ctx.moveTo(trail[index - 1].x, trail[index - 1].y); ctx.lineTo(trail[index].x, trail[index].y); ctx.stroke();
      }
      ctx.restore();
    }
  }

  // The hub's own dress: a slow breathing halo and the faint ring the crew
  // rests on.
  function drawHubDress(ctx, node, p, radius, tint, time, still) {
    if (node.kind !== "assistant" || node._absorbed) return;
    const breathe = still ? 0.5 : (Math.sin(time / 1900) + 1) / 2;
    ctx.save();
    ctx.globalAlpha = (node._fade ?? 1) * emphasis(node);
    const ring = radius + 5 + breathe * 2.5;
    ctx.beginPath(); ctx.arc(p.x, p.y, ring, 0, Math.PI * 2);
    ctx.strokeStyle = rgba(tint, 0.18 + breathe * 0.14); ctx.lineWidth = 1; ctx.stroke();
    if (state.nodes.some((entry) => entry.kind === "agent" && !entry.builder && !entry.dying)) {
      ctx.setLineDash([2, 5]);
      ctx.beginPath(); ctx.arc(p.x, p.y, radius * 3.1, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(tint, 0.1); ctx.lineWidth = 0.8; ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  function drawWorkOrbit(ctx, node, p, radius, time, still) {
    node._orbitTrail = null;
    if (!state.orbitTrails || !["Running", "Next"].includes(node._workLabel) || node.kind === "agent") return;
    const running = node._workLabel === "Running";
    const phase = still ? Math.PI / 3 : time / (running ? 1100 : 2400) * Math.PI * 2;
    const ring = radius + 9;
    ctx.save(); ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(125,178,255,0.22)"; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.arc(p.x, p.y, ring, 0, Math.PI * 2); ctx.stroke();
    for (let segment = 2; segment >= 0; segment -= 1) {
      ctx.strokeStyle = `rgba(125,178,255,${0.8 - segment * 0.24})`; ctx.lineWidth = 2.6 - segment * 0.6;
      ctx.beginPath(); ctx.arc(p.x, p.y, ring, phase - (segment + 1) * 0.62, phase - segment * 0.62); ctx.stroke();
    }
    ctx.restore();
    node._orbitTrail = { drawn: true, animated: !still, segments: 3, phase, radius: ring };
  }

  // The chores the assistant filed for itself park as pips under the hub — one
  // per open chore, the running one spinning a small ring — instead of a node
  // and a label each. The ledger on the hub card names them.
  const FILED_PIP_MAX = 6;
  const FILED_PIP_RING = 12; // how far the hub's filed pips hang from its rim
  function drawFiledWork(ctx, node, p, radius, runningIds, time, still) {
    node._filedPips = null;
    if (node.kind !== "assistant") return;
    const filed = node.filedWork;
    if (!filed?.length || node._absorbed || (node._fade ?? 1) <= 0.02) return;
    const shown = filed.slice(0, FILED_PIP_MAX);
    // Clear of the hub's progress meter (radius + 5): a pip row is a second,
    // separate readout, not a tick on that bar.
    const spread = 0.3;
    const ring = radius + FILED_PIP_RING;
    const angleOf = (index) => Math.PI / 2 + (index - (shown.length - 1) / 2) * spread;
    ctx.save();
    ctx.globalAlpha = (node._fade ?? 1) * emphasis(node);
    shown.forEach((task, index) => {
      const angle = angleOf(index);
      const x = p.x + Math.cos(angle) * ring;
      const y = p.y + Math.sin(angle) * ring;
      const verifying = task.status === "awaiting_verification";
      const running = runningIds.has(task.id);
      ctx.beginPath();
      ctx.arc(x, y, running ? 2.1 : 1.6, 0, Math.PI * 2);
      ctx.fillStyle = verifying ? rgba(NODE_RGB.verify, 0.9) : rgba(NODE_RGB.task, running ? 0.95 : 0.55);
      ctx.fill();
      if (running) {
        const phase = still ? 0 : time / 420;
        ctx.beginPath();
        ctx.arc(x, y, 3.6, phase, phase + Math.PI * 1.25);
        ctx.strokeStyle = rgba(NODE_RGB.task, 0.85);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    });
    if (filed.length > shown.length) {
      const angle = angleOf(shown.length);
      ctx.font = '600 8px system-ui, "Segoe UI", sans-serif';
      ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillStyle = rgba(NODE_RGB.task, 0.7);
      ctx.fillText(`+${filed.length - shown.length}`, p.x + Math.cos(angle) * ring + 4, p.y + Math.sin(angle) * ring);
    }
    ctx.restore();
    node._filedPips = { drawn: true, count: filed.length };
  }

  function graphLayoutSeeds(projected, area, layout, parentIds, slots, fixed = new Map()) {
    if (layout === "tree") return tidyBranchSeeds(projected, area, parentIds, fixed);
    if (layout === "layers") return terraceSeeds(projected, area, parentIds, fixed);
    if (layout === "constellation") return constellationSeeds(projected, area, parentIds, slots, fixed);
    const forest = layoutForest(projected, parentIds);
    const tree = tidyBranchSeeds(projected, area, forest.parents, new Map());
    const phases = layout === "helix" ? null : branchSectorPhases(tree, area, forest.parents, forest.root);
    const maxDepth = Math.max(1, ...[...tree.values()].map((point) => point.depth));
    const cx = area.x + area.w / 2, cy = area.y + area.h / 2;
    const rx = Math.max(24, (area.w - 100) / 2), ry = Math.max(24, (area.h - 100) / 2);
    const seeds = new Map();
    forest.order.forEach((id, index) => {
      const branch = tree.get(id);
      let point;
      if (layout === "helix") {
        // Walk each branch together instead of scattering children by ID.
        const progress = forest.order.length > 1 ? index / (forest.order.length - 1) : 0.5;
        const phase = progress * Math.PI * 4 - Math.PI / 2;
        point = { x: cx + Math.cos(phase) * rx * 0.9, y: area.y + 50 + progress * Math.max(1, area.h - 100), depth: branch.depth, phase };
      } else {
        // Elliptical rings follow dependency depth and the same angular
        // sector for each branch, using both dimensions of the viewport.
        const phase = phases.get(id);
        const radius = Math.sqrt(branch.depth / maxDepth);
        point = { x: cx + Math.cos(phase) * rx * radius, y: cy + Math.sin(phase) * ry * radius, depth: branch.depth, phase };
      }
      seeds.set(id, fixed.get(id) ?? point);
    });
    return seeds;
  }

  function layoutForest(projected, parentIds) {
    const nodes = new Map(projected.map(({ node }) => [node.id, node]));
    const parents = new Map([...parentIds].filter(([child, parent]) => nodes.has(child) && nodes.has(parent) && child !== parent));
    const ids = [...nodes.keys()].sort((a, b) => Number(nodes.get(b).kind === "root") - Number(nodes.get(a).kind === "root") || String(a).localeCompare(String(b)));
    const root = ids.find((id) => nodes.get(id).kind === "root");
    if (root) for (const id of ids) if (id !== root && !parents.has(id)) parents.set(id, root);
    const children = new Map(ids.map((id) => [id, []]));
    for (const id of ids) if (parents.has(id)) children.get(parents.get(id)).push(id);
    const order = [], seen = new Set();
    const visit = (id) => { if (seen.has(id)) return; seen.add(id); order.push(id); for (const child of children.get(id)) visit(child); };
    for (const id of ids) if (!parents.has(id)) visit(id);
    for (const id of ids) visit(id);
    return { nodes, parents, children, order, root };
  }

  function terraceSeeds(projected, area, parentIds, fixed) {
    const forest = layoutForest(projected, parentIds);
    const tree = tidyBranchSeeds(projected, area, forest.parents, new Map());
    const levels = new Map();
    for (const id of forest.order) {
      const depth = tree.get(id).depth;
      if (!levels.has(depth)) levels.set(depth, []);
      levels.get(depth).push(id);
    }
    // Centered shelves distinguish Terraces from the subtree columns in
    // Branches. Dense shelves wrap before neighbouring orbs can touch.
    const maxDepth = Math.max(1, ...levels.keys());
    const bands = [...levels].sort(([a], [b]) => a - b).map(([depth, ids]) => {
      const width = Math.max(52, area.w - 100) * (0.65 + 0.35 * depth / maxDepth);
      const xs = ids.map((id) => tree.get(id).x), left = Math.min(...xs), right = Math.max(...xs);
      const rows = [];
      // Keep each sibling group in its own columns when a shelf wraps.
      // Restarting x at the left edge on every row interleaved branches.
      const entries = [...ids].sort((a, b) => tree.get(a).x - tree.get(b).x || String(a).localeCompare(String(b))).map((id) => {
        const x = area.x + area.w / 2 + (right > left ? (tree.get(id).x - (left + right) / 2) / (right - left) * width : 0);
        const radius = forest.nodes.get(id).kind === "todo" ? 8 : 21;
        let row = rows.findIndex((last) => x - radius - 12 >= last);
        if (row < 0) row = rows.length;
        rows[row] = x + radius;
        return { id, x, row };
      });
      return { depth, entries, rows: rows.length };
    });
    const units = Math.max(1, bands.reduce((sum, band) => sum + band.rows, 0) - 1 + Math.max(0, bands.length - 1));
    const seeds = new Map();
    let top = 0;
    for (const band of bands) {
      band.entries.forEach(({ id, x, row }) => {
        const point = { x,
          y: area.y + 50 + (top + row) * Math.max(1, area.h - 100) / units, depth: band.depth };
        seeds.set(id, fixed.get(id) ?? point);
      });
      top += band.rows + 1;
    }
    return seeds;
  }

  function constellationSeeds(projected, area, parentIds, slots, fixed) {
    const nodes = new Map(projected.map(({ node }) => [node.id, node]));
    const root = [...nodes.values()].filter((node) => node.kind === "root").sort((a, b) => String(a.id).localeCompare(String(b.id)))[0];
    const parents = new Map(parentIds);
    // Loose backlog and landmarks get separate sectors around the same hub.
    // They used to share a tiny central ring and collide into a diagonal pile.
    if (root) for (const node of nodes.values()) if (node.id !== root.id && !parents.has(node.id)) parents.set(node.id, root.id);
    const tree = tidyBranchSeeds(projected, area, parents, new Map());
    const phases = branchSectorPhases(tree, area, parents, root?.id);
    const depths = [...tree.entries()].filter(([id]) => id !== root?.id).map(([, point]) => point.depth);
    const minDepth = Math.min(...depths, 1), maxDepth = Math.max(...depths, minDepth + 1);
    const cx = area.x + area.w / 2, cy = area.y + area.h / 2;
    const rx = Math.max(24, (area.w - 96) / 2), ry = Math.max(24, (area.h - 96) / 2);
    const branchIds = new Set(parents.values());
    const points = new Map();
    for (const [id, point] of tree) {
      if (!slots.has(id)) slots.set(id, { group: parents.get(id) ?? "__roots__", slot: slots.size });
      if (id === root?.id) { points.set(id, { x: cx, y: cy, depth: 0 }); continue; }
      const phase = phases.get(id);
      const radius = !branchIds.has(id) && parents.get(id) === root?.id ? 0.86
        : 0.58 + 0.36 * Math.max(0, point.depth - minDepth) / Math.max(1, maxDepth - minDepth);
      points.set(id, { x: cx + Math.cos(phase) * rx * radius, y: cy + Math.sin(phase) * ry * radius, depth: point.depth, phase });
    }
    const adjusted = new Map();
    for (const [id, point] of points) {
      if (fixed.has(id)) { adjusted.set(id, fixed.get(id)); continue; }
      let parent = parents.get(id);
      const seen = new Set([id]);
      while (parent && !seen.has(parent) && !fixed.has(parent)) { seen.add(parent); parent = parents.get(parent); }
      const original = points.get(parent), anchor = fixed.get(parent);
      adjusted.set(id, original && anchor ? { ...point, x: point.x + anchor.x - original.x, y: point.y + anchor.y - original.y } : point);
    }
    return adjusted;
  }

  function branchSectorPhases(tree, area, parents, root) {
    const phases = new Map([...tree].map(([id, point]) => [id,
      (point.x - area.x - 32) / Math.max(1, area.w - 64) * Math.PI * 2 - Math.PI / 2]));
    const branches = new Map(), groups = new Map();
    for (const id of tree.keys()) {
      if (id === root) continue;
      let branch = id, parent = parents.get(branch);
      const seen = new Set([id]);
      while (parent && parent !== root && tree.has(parent) && !seen.has(parent)) {
        seen.add(parent); branch = parent; parent = parents.get(branch);
      }
      branches.set(id, branch);
      if (!groups.has(branch)) groups.set(branch, { id: branch, count: 0, extent: 0 });
      const group = groups.get(branch);
      group.count += 1;
      group.extent = Math.max(group.extent, Math.abs(phases.get(id) - phases.get(branch)));
    }
    // Neighbouring IDs often describe the same kind of work. Spread their
    // branch sectors around the circle so tasks do not all collect on one
    // side while quiet sessions occupy the other. The ordering stays stable
    // across input recency changes; saved world anchors still win on refresh.
    const ordered = [...groups.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .map((group, index) => ({ ...group, order: (index * 0.61803398875) % 1 }))
      .sort((a, b) => a.order - b.order);
    const weight = ordered.reduce((sum, group) => sum + Math.sqrt(group.count), 0);
    let cursor = -Math.PI / 2;
    for (const group of ordered) {
      const width = Math.PI * 2 * Math.sqrt(group.count) / Math.max(1, weight);
      group.anchor = cursor + width / 2;
      // Keep descendants on their parent's side, without reserving an almost
      // complete circle for a large branch and then leaving it empty.
      group.scale = Math.min(Math.PI / 3, width * 0.46) / Math.max(0.001, group.extent);
      groups.set(group.id, group);
      cursor += width;
    }
    const dominant = [...ordered].sort((a, b) => b.count - a.count || String(a.id).localeCompare(String(b.id)))[0];
    const total = ordered.reduce((sum, group) => sum + group.count, 0);
    // A wide screen has room across the top/bottom of a fan, rather than
    // along its narrow right edge. Orient only a genuinely dominant branch.
    const rotation = dominant?.count >= 6 && dominant.count > total * 0.4
      ? (area.w >= area.h ? -Math.PI / 2 : 0) - dominant.anchor : 0;
    return new Map([...phases].map(([id, phase]) => {
      const group = groups.get(branches.get(id));
      return [id, group ? group.anchor + rotation + (phase - phases.get(group.id)) * group.scale : phase];
    }));
  }

  function primaryBranchParents(projected, edges) {
    const nodes = new Map(projected.map(({ node }) => [node.id, node]));
    const candidates = new Map();
    for (const edge of edges) {
      const parent = projected[edge.a]?.node, child = projected[edge.b]?.node;
      if (!parent || !child || parent.kind === "agent" || child.kind === "agent" || child.kind === "root" || parent.id === child.id) continue;
      if (!candidates.has(child.id)) candidates.set(child.id, []);
      candidates.get(child.id).push(parent.id);
    }
    const parents = new Map();
    for (const [id, choices] of [...candidates].sort(([a], [b]) => String(a).localeCompare(String(b)))) {
      const node = nodes.get(id), preferred = node.groupParentId ?? node.sessionId ?? node.anchorSessionId;
      const ordered = [...new Set(choices)].sort((a, b) => Number(b === preferred) - Number(a === preferred) || String(a).localeCompare(String(b)));
      for (const parent of ordered) {
        const seen = new Set([id]); let cursor = parent;
        while (cursor && !seen.has(cursor)) { seen.add(cursor); cursor = parents.get(cursor); }
        if (cursor) continue;
        parents.set(id, parent); break;
      }
    }
    return parents;
  }

  function cachedBranchParents(projected, edges) {
    const cached = state.branchTopology;
    let unchanged = cached?.nodes.length === projected.length * 3 && cached.edges.length === edges.length * 2;
    for (let index = 0; unchanged && index < projected.length; index += 1) {
      const node = projected[index].node, offset = index * 3;
      unchanged = cached.nodes[offset] === node.id && cached.nodes[offset + 1] === node.kind
        && cached.nodes[offset + 2] === (node.groupParentId ?? node.sessionId ?? node.anchorSessionId);
    }
    for (let index = 0; unchanged && index < edges.length; index += 1) {
      unchanged = cached.edges[index * 2] === edges[index].a && cached.edges[index * 2 + 1] === edges[index].b;
    }
    if (unchanged) return cached.parents;
    // Projections are recreated every frame and nodes/edges can mutate in
    // place. Retain only the latest copied topology scalars, not object refs.
    const nodes = [], endpoints = [];
    for (const { node } of projected) nodes.push(node.id, node.kind, node.groupParentId ?? node.sessionId ?? node.anchorSessionId);
    for (const edge of edges) endpoints.push(edge.a, edge.b);
    const parents = primaryBranchParents(projected, edges);
    state.branchTopology = { nodes, edges: endpoints, parents };
    return parents;
  }

  // Each layout has a real, deterministic volume. The initial screen spacing
  // stays readable; rotating the camera reveals separated branches and tiers.
  function layoutDepthSource(node, seed, area, layout, parents) {
    if (state.view === "2d") return { x: 0, y: 0, z: 0 };
    let branch = node.id, cursor = parents.get(branch), level = 0;
    const seen = new Set([branch]);
    while (cursor && !seen.has(cursor)) { seen.add(cursor); level += 1; if (parents.has(cursor)) branch = cursor; cursor = parents.get(cursor); }
    let hash = 0; for (const letter of String(branch)) hash = (hash * 31 + letter.charCodeAt(0)) >>> 0;
    const lane = (hash % 997) / 996 * 2 - 1;
    const span = Math.min(area.w, area.h) * 0.36;
    let depth = lane * span * 0.65 + Math.min(4, level) * span * 0.09;
    if (layout === "helix") depth = Math.sin(seed?.phase ?? 0) * span;
    else if (layout === "layers") depth = (Math.min(4, seed?.depth ?? level) - 1.5) * span * 0.42 + lane * span * 0.28;
    else if (layout === "constellation" || layout === "radial") {
      // Nearby screen neighbours share a smooth depth surface. Independent
      // branch depths pulled them through one another on a small camera turn.
      // A curved saddle and distinct dependency tiers give the overview real
      // front/back volume, including after Fit. Its mixed curvature cannot
      // collapse into a tilted plane, and neighbouring branches stay coherent.
      const nx = ((seed?.x ?? area.x + area.w / 2) - area.x - area.w / 2) / Math.max(1, area.w / 2);
      const ny = ((seed?.y ?? area.y + area.h / 2) - area.y - area.h / 2) / Math.max(1, area.h / 2);
      depth = span * (0.7 * nx * ny + 0.25 * ny + 0.1 * Math.min(4, level));
    }
    if (node.kind === "root") depth = 0;
    const scale = Math.max(0.01, state.fit * state.zoom);
    return { x: Math.sin(state.angle) * depth / scale - state.camera.x, y: -state.camera.y, z: Math.cos(state.angle) * depth / scale - state.camera.z };
  }

  function tidyBranchSeeds(projected, area, parentIds, fixed) {
    const nodes = new Map(projected.map(({ node }) => [node.id, node]));
    const children = new Map([...nodes.keys()].map((id) => [id, []]));
    const roots = [];
    for (const id of [...nodes.keys()].sort()) {
      const parent = parentIds.get(id);
      if (parent && parent !== id && nodes.has(parent)) children.get(parent).push(id);
      else roots.push(id);
    }
    const spans = new Map(), levels = new Map(), seeds = new Map(), visiting = new Set();
    const measure = (id) => {
      if (spans.has(id)) return spans.get(id);
      if (visiting.has(id)) return 28;
      visiting.add(id);
      const kids = children.get(id) ?? [];
      const width = Math.max(nodes.get(id)?.kind === "todo" ? 24 : 48, kids.reduce((sum, child) => sum + measure(child), 0) + Math.max(0, kids.length - 1) * 12);
      visiting.delete(id); spans.set(id, width); return width;
    };
    // A malformed disconnected cycle is still visible as a bounded forest.
    for (const id of nodes.keys()) measure(id);
    const reached = new Set();
    const mark = (id) => { if (reached.has(id)) return; reached.add(id); for (const child of children.get(id) ?? []) mark(child); };
    for (const id of roots) mark(id);
    for (const id of nodes.keys()) if (!reached.has(id)) { roots.push(id); mark(id); }
    const total = roots.reduce((sum, id) => sum + spans.get(id), 0) + Math.max(0, roots.length - 1) * 22;
    const scale = Math.max(1, area.w - 64) / Math.max(1, total);
    const place = (id, left, depth, seen = new Set()) => {
      if (seen.has(id) || seeds.has(id)) return;
      const nextSeen = new Set([...seen, id]), kids = children.get(id) ?? [];
      const width = spans.get(id);
      let cursor = left;
      for (const child of kids) { place(child, cursor, depth + 1, nextSeen); cursor += spans.get(child) + 12; }
      const childPoints = kids.map((child) => seeds.get(child)).filter(Boolean);
      const x = childPoints.length ? (childPoints[0].x + childPoints.at(-1).x) / 2 : area.x + 32 + (left + width / 2) * scale;
      const point = { x, y: 0, depth };
      seeds.set(id, point);
      if (!levels.has(depth)) levels.set(depth, []);
      levels.get(depth).push(id);
    };
    let cursor = 0;
    for (const id of roots) {
      const kind = nodes.get(id).kind;
      place(id, cursor, kind === "root" ? 0 : ["session", "assistant", "music"].includes(kind) ? 1 : 2);
      cursor += spans.get(id) + 22;
    }
    // Dense sibling rows wrap vertically within their level, preserving their
    // left-to-right subtree order instead of spiralling through other branches.
    const groups = [];
    for (const [depth, ids] of [...levels].sort(([a], [b]) => a - b)) {
      const rows = [];
      for (const id of ids.sort((a, b) => seeds.get(a).x - seeds.get(b).x || String(a).localeCompare(String(b)))) {
        const point = seeds.get(id), radius = nodes.get(id).kind === "todo" ? 8 : 21;
        let row = rows.findIndex((last) => point.x - radius - 12 >= last);
        if (row < 0) row = rows.length;
        rows[row] = point.x + radius; point.row = row;
      }
      groups.push({ depth, ids, rows: rows.length });
    }
    const units = Math.max(1, groups.reduce((sum, group) => sum + group.rows, 0) - 1 + Math.max(0, groups.length - 1) * 0.85);
    let levelTop = 0;
    for (const group of groups) {
      for (const id of group.ids) {
        const point = seeds.get(id);
        point.y = area.y + 40 + (levelTop + point.row) * Math.max(1, area.h - 80) / units;
        if (fixed.has(id)) Object.assign(point, fixed.get(id));
      }
      levelTop += group.rows + 0.85;
    }
    return seeds;
  }

  function arrangeProjectedNodes(projected, area, { mode = "orbit", fixedIds = new Set() } = {}) {
    const visible = projected.filter(({ node, p }) => !node.dying && !node._absorbed && Number.isFinite(p.x) && Number.isFinite(p.y));
    if (!visible.length) return projected;
    const entries = [...visible].sort((a, b) => Number(fixedIds.has(b.node.id)) - Number(fixedIds.has(a.node.id)) || String(a.node.id).localeCompare(String(b.node.id)));
    if (mode === "orbit" && !fixedIds.size) {
      const xs = visible.map(({ p }) => p.x), ys = visible.map(({ p }) => p.y);
      const left = Math.min(...xs), top = Math.min(...ys), w = Math.max(1, Math.max(...xs) - left), h = Math.max(1, Math.max(...ys) - top);
      const scale = Math.max(0.8, Math.min(1.55, (area.w - 100) / w, (area.h - 100) / h));
      for (const { p } of visible) { p.x = area.x + area.w / 2 + (p.x - left - w / 2) * scale; p.y = area.y + area.h / 2 + (p.y - top - h / 2) * scale; }

    }
    const cells = new Map();
    const keys = (rect) => {
      const result = [];
      for (let x = Math.floor(rect.x / 64); x <= Math.floor((rect.x + rect.w) / 64); x += 1)
        for (let y = Math.floor(rect.y / 64); y <= Math.floor((rect.y + rect.h) / 64); y += 1) result.push(`${x}:${y}`);
      return result;
    };
    const placed = (rect) => keys(rect).some((key) => (cells.get(key) ?? []).some((other) => rect.x < other.x + other.w && rect.x + rect.w > other.x && rect.y < other.y + other.h && rect.y + rect.h > other.y));
    // Reserve a little extra room for circular 3D views before anchors become
    // fixed. This depends on the viewport, never on a changing work status.
    const rotationRoom = state.view === "3d" && ["constellation", "radial"].includes(state.nodeLayout ?? "constellation")
      ? Math.min(16, Math.max(0, (area.w - 480) / 40)) : 0;
    for (const { node, p } of entries) {
      // Reserve the largest work rim even while idle. Appearance/effect or
      // status changes must never trigger a reflow of established anchors.
      const diameter = (node.kind === "todo" ? 14 : 38) + rotationRoom;
      const size = { w: diameter, h: diameter };
      const bounds = (x, y) => ({ x: x - size.w / 2 - 7, y: y - size.h / 2 - 7, w: size.w + 14, h: size.h + 14 });
      if (fixedIds.has(node.id)) {
        const rect = bounds(p.x, p.y);
        for (const key of keys(rect)) { if (!cells.has(key)) cells.set(key, []); cells.get(key).push(rect); }
        continue;
      }
      let best = null;
      // A deterministic spiral gives crowded clusters room without changing
      // their persisted positions or introducing random frame-to-frame jitter.
      for (let attempt = 0; attempt < 73; attempt += 1) {
        const distance = attempt ? 20 * Math.ceil(attempt / 12) : 0;
        const turn = (attempt % 12) * Math.PI / 6;
        const x = Math.min(area.x + area.w - size.w / 2 - 10, Math.max(area.x + size.w / 2 + 10, p.x + Math.cos(turn) * distance));
        const y = Math.min(area.y + area.h - size.h / 2 - 10, Math.max(area.y + size.h / 2 + 10, p.y + Math.sin(turn) * distance));
        const rect = bounds(x, y);
        if (!placed(rect)) { best = { x, y, rect }; break; }
      }
      if (!best) {
        let nearest = Infinity;
        for (let y = area.y + size.h / 2 + 10; y <= area.y + area.h - size.h / 2 - 10; y += size.h + 16) {
          for (let x = area.x + size.w / 2 + 10; x <= area.x + area.w - size.w / 2 - 10; x += size.w + 16) {
            const distance = (x - p.x) ** 2 + (y - p.y) ** 2;
            if (distance >= nearest) continue;
            const rect = bounds(x, y);
            if (!placed(rect)) { best = { x, y, rect }; nearest = distance; }
          }
        }
      }
      if (!best) best = { x: p.x, y: p.y, rect: bounds(p.x, p.y) };
      p.x = best.x; p.y = best.y;
      for (const key of keys(best.rect)) { if (!cells.has(key)) cells.set(key, []); cells.get(key).push(best.rect); }
    }
    return projected;
  }

  function layoutProjectedGraph(projected, area, mode, animationTime = Date.now(), still = false) {
    const profiler = globalThis.window?.MefiProfiler;
    const span = profiler?.begin("command.layout");
    try { return layoutProjectedGraphImpl(projected, area, mode, animationTime, still); }
    finally { profiler?.end(span); }
  }

  function layoutProjectedGraphImpl(projected, area, mode, animationTime, still) {
    const layoutName = state.nodeLayout ?? "constellation";
    // Keyed on the frame between the rails, not on the clear rectangle: a
    // floating panel (the selection card on a click) shrinks the rectangle
    // without changing where the anchors belong, and re-seeding every anchor
    // for it made the tree jump under the click. Orbit's overview back-off
    // below still keeps the anchors inside the clear rectangle.
    const frame = state.graphFrame ?? area;
    const key = `${layoutName}|${state.view}|${frame.x},${frame.y},${frame.w},${frame.h}`;
    if (state.screenLayout?.key !== key) {
      state.screenLayout = { key, nodes: new Map(), slots: new Map() };
      state.overviewScale = 1;
    }
    const layout = state.screenLayout.nodes;
    const anchors = projected.filter(({ node }) => node.kind !== "agent");
    const retained = new Set([...anchors.map(({ node }) => node.id), ...(state.allTasks ?? state.tasks ?? []).map((task) => `task:${task.id}`), ...(state.taskGroups ?? []).flatMap((group) => [`task:${group.id}`, ...group.members.map((member) => `task:${member.id}`)])]);
    for (const id of layout.keys()) if (!retained.has(id)) layout.delete(id);
    for (const id of state.screenLayout.slots.keys()) if (!retained.has(id)) state.screenLayout.slots.delete(id);
    const parentIds = cachedBranchParents(projected, state.edges ?? []);
    state.branchParents = parentIds;
    const previousParents = state.screenLayout.parents ??= new Map();
    for (const id of previousParents.keys()) if (!retained.has(id)) previousParents.delete(id);
    const relocated = new Set();
    for (const { node } of anchors) {
      if (!node.dying && previousParents.has(node.id) && previousParents.get(node.id) !== (parentIds.get(node.id) ?? null)) relocated.add(node.id);
    }
    // Release the whole affected subtree, including temporarily hidden group
    // members. Keeping their old anchors stretches links across the scene
    // when a task gains a session or an approved plan changes its grouping.
    let changed = relocated.size > 0;
    while (changed) {
      changed = false;
      for (const [id, parent] of previousParents) {
        if (!relocated.has(id) && (relocated.has(parent) || relocated.has(parentIds.get(id)))) {
          relocated.add(id); changed = true;
        }
      }
    }
    for (const id of relocated) { layout.delete(id); state.screenLayout.slots.delete(id); }
    for (const { node } of anchors) previousParents.set(node.id, parentIds.get(node.id) ?? null);
    const fixedIds = new Set();
    for (const { node, p } of anchors) {
      const saved = layout.get(node.id);
      const world = saved?.world ?? { x: node.x, y: node.y, z: node.z };
      const source = saved ? project(world) : { ...p };
      if (saved) { Object.assign(p, source); fixedIds.add(node.id); }
      node._layoutAnchor = { ...world };
    }
    // A narrow tree needs clear bands where active task names can fit.
    // Filling every last gap with orbs otherwise leaves Auto with no labels.
    const labelGutter = area.w < 480 ? Math.max(0, Math.min(64, (area.h - 240) / 2)) : 0;
    const nodeArea = { ...area, y: area.y + labelGutter, h: area.h - labelGutter * 2 };
    let seeds = new Map();
    if (fixedIds.size !== anchors.length) {
      const fixed = new Map(anchors.filter(({ node }) => fixedIds.has(node.id)).map(({ node, p }) => [node.id, { x: p.x, y: p.y }]));
      seeds = graphLayoutSeeds(anchors, nodeArea, layoutName, parentIds, state.screenLayout.slots);
      for (const { node, p } of anchors) {
        if (fixedIds.has(node.id) || !seeds.has(node.id)) continue;
        const seed = seeds.get(node.id);
        // A new child joins its established branch. Rebalancing a fresh
        // imaginary tree must not send it across the saved parent's branch.
        let parent = parentIds.get(node.id);
        const seen = new Set([node.id]);
        while (parent && !seen.has(parent) && !fixed.has(parent)) { seen.add(parent); parent = parentIds.get(parent); }
        const original = seeds.get(parent), saved = fixed.get(parent);
        p.x = seed.x + (original && saved ? saved.x - original.x : 0);
        p.y = seed.y + (original && saved ? saved.y - original.y : 0);
      }
    }
    // Saved anchors only need projection. Rebuilding the collision grid for
    // an entirely fixed graph cannot move a node and wastes every idle frame.
    if (fixedIds.size !== anchors.length) arrangeProjectedNodes(anchors, nodeArea, { mode: "free", fixedIds });
    for (const { node, p } of anchors) {
      if (layout.has(node.id)) continue;
      const depthSource = layoutDepthSource(node, seeds.get(node.id), area, layoutName, parentIds);
      const anchor = unprojectForLayout(p, depthSource);
      layout.set(node.id, { world: anchor }); node._layoutAnchor = { ...anchor };
      Object.assign(p, project(anchor));
    }
    // Fixed world anchors can project beyond their initial frame as a 3D
    // orbit turns. Back the overview off as a whole, preserving perspective
    // and anchors, so panel clipping never removes work from the overview.
    // Free/Follow retain their intentional pan and zoom into part of the tree.
    if (mode === "orbit") {
      const cx = area.x + area.w / 2, cy = area.y + area.h / 2;
      const halfW = Math.max(1, area.w / 2 - 28), halfH = Math.max(1, area.h / 2 - 28);
      const previousScale = state.overviewScale ?? 1;
      let scale = 1;
      for (const { node, p } of anchors) {
        if (node.dying || node._absorbed) continue;
        scale = Math.min(scale, halfW / Math.max(1, Math.abs(p.x - cx) / previousScale), halfH / Math.max(1, Math.abs(p.y - cy) / previousScale));
      }
      state.overviewScale = scale;
      if (scale !== previousScale) for (const { node, p } of anchors) Object.assign(p, project(node._layoutAnchor));
    }
    const occupied = anchors.filter(({ node }) => !node.dying && !node._absorbed).map(({ node, p }) => ({ x: p.x, y: p.y, radius: node.kind === "todo" ? 8 : 25 }));
    const agentLayout = state.agentLayout ??= new Map();
    const agents = projected.filter(({ node }) => node.kind === "agent" && !node._absorbed).sort((a, b) => a.node.id.localeCompare(b.node.id));
    const visibleAgents = new Set(agents.map(({ node }) => node.id));
    for (const id of agentLayout.keys()) if (!visibleAgents.has(id)) agentLayout.delete(id);
    for (const { node, p } of agents) {
      Object.assign(p, project(node));
      const fx = state.fx?.get(node.id);
      const targetId = node.dying ? absorbHost(fx)?.id : node.targetNode?.id ?? node.targetId ?? node.hostId;
      const host = anchors.find((entry) => entry.node.id === targetId) ?? anchors.find((entry) => entry.node.kind === "assistant");
      if (host) {
        let saved = agentLayout.get(node.id);
        // Carry camera movement through immediately. Only a worker changing
        // its destination or clearance slot should ease across the scene.
        if (saved?.hostId === host.node.id && saved.layoutKey === key) {
          const dx = host.p.x - saved.hostX, dy = host.p.y - saved.hostY;
          saved.x += dx; saved.y += dy;
          if (saved.returnFrom) { saved.returnFrom.x += dx; saved.returnFrom.y += dy; }
        }
        const original = project(host.node);
        const dx = p.x - original.x, dy = p.y - original.y;
        // The distance still left in a flight is not the destination's orbit.
        const radius = Math.max(42, Math.min(72, Math.hypot(dx, dy))), phase = Math.atan2(dy, dx);
        const offset = saved?.hostId === host.node.id ? saved.offset ?? 0 : 0;
        const hostInView = host.p.x >= area.x && host.p.x <= area.x + area.w && host.p.y >= area.y && host.p.y <= area.y + area.h;
        let best = null, bestClearance = -Infinity;
        // Keep the worker beside its host, clear of neighbouring work rims
        // and panel edges. Only satellites move; task anchors stay fixed.
        for (let attempt = 0; attempt < 48; attempt += 1) {
          const step = attempt % 12;
          const turn = offset + Math.ceil(step / 2) * (step % 2 ? 1 : -1) * Math.PI / 6;
          const angle = phase + turn;
          const distance = radius + Math.floor(attempt / 12) * 18;
          const rawX = host.p.x + Math.cos(angle) * distance, rawY = host.p.y + Math.sin(angle) * distance;
          // Panning a host offscreen takes its workers with it instead of
          // pinning unrelated satellites to the edge of the current view.
          const x = hostInView ? Math.max(nodeArea.x + 14, Math.min(nodeArea.x + nodeArea.w - 14, rawX)) : rawX;
          const y = hostInView ? Math.max(nodeArea.y + 14, Math.min(nodeArea.y + nodeArea.h - 14, rawY)) : rawY;
          const clearance = occupied.reduce((gap, other) => Math.min(gap, Math.hypot(x - other.x, y - other.y) - other.radius - 13), Infinity);
          if (clearance > bestClearance) { best = { x, y, offset: turn }; bestClearance = clearance; }
          if (clearance >= 3) break;
        }
        if (!saved) {
          const growing = fx && Number.isFinite(fx.bornAt) && Date.now() - fx.bornAt < NODE_GROW_MS;
          const launch = !still && node.phase === "flying" ? anchors.find((entry) => entry.node.kind === "assistant")?.p : null;
          const start = launch ?? (growing && !still ? host.p : best);
          saved = { x: start.x, y: start.y, at: animationTime };
          agentLayout.set(node.id, saved);
        }
        if (node.dying && fx) {
          // Return from the point actually drawn, including its clearance
          // offset. Fading workers may reach the hub instead of its outer ring.
          saved.returnFrom ??= { x: saved.x, y: saved.y };
          const t = still ? 1 : Math.max(0, Math.min(1, (Date.now() - fx.absorbAt) / NODE_ABSORB_MS));
          const ease = t * t * (3 - 2 * t);
          saved.x = saved.returnFrom.x + (host.p.x - saved.returnFrom.x) * ease;
          saved.y = saved.returnFrom.y + (host.p.y - saved.returnFrom.y) * ease;
        } else {
          saved.returnFrom = null;
          const returning = node.retiring && ["returning", "home"].includes(node.phase);
          const destination = returning ? host.p : best;
          // Time-based interpolation keeps the same feel at different frame
          // rates. A resumed/slow frame cannot skip the whole transition.
          const dt = Math.max(0, Math.min(64, animationTime - saved.at));
          const blend = still ? 1 : 1 - Math.exp(-dt / 180);
          saved.x += (destination.x - saved.x) * blend;
          saved.y += (destination.y - saved.y) * blend;
        }
        Object.assign(saved, { at: animationTime, hostId: host.node.id, hostX: host.p.x, hostY: host.p.y, offset: best.offset, layoutKey: key });
        p.x = saved.x; p.y = saved.y;
        occupied.push({ x: p.x, y: p.y, radius: 13 });
      }
      node._layoutAnchor = null;
    }
  }

  function hexToRgb(hex) {
    const value = String(hex).replace("#", "");
    const int = parseInt(value.length === 3 ? value.split("").map((char) => char + char).join("") : value, 16);
    return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
  }

  function syncGraphTheme() {
    const style = window.getComputedStyle?.(document.documentElement);
    if (!style) return;
    const color = (name, fallback) => {
      const value = style.getPropertyValue(name).trim();
      return /^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(value) ? hexToRgb(value) : fallback;
    };
    const theme = window.MefiMusic?.themePalette?.() ?? null;
    const palette = theme?.canvas;
    state.canvasPalette = palette ?? null;
    state.themeKey = theme?.theme ?? document.documentElement?.dataset?.studioTheme ?? null;
    NODE_RGB.warm = palette?.bright ? hexToRgb(palette.bright) : color("--gold-bright", NODE_RGB.warm);
    NODE_RGB.task = [...NODE_RGB.warm];
    NODE_RGB.assistant = [...NODE_RGB.warm];
    NODE_RGB.session = palette?.text ? hexToRgb(palette.text) : color("--ivory", NODE_RGB.session);
    NODE_RGB.pending = palette?.muted ? hexToRgb(palette.muted) : color("--muted", NODE_RGB.pending);
    NODE_RGB.stale = palette?.dim ? hexToRgb(palette.dim) : color("--dim", NODE_RGB.stale);
    const bg = hexToRgb(palette?.background ?? "#050507");
    NODE_RGB.verify = bg[0] * 0.2126 + bg[1] * 0.7152 + bg[2] * 0.0722 > 145 ? [59, 86, 160] : [151, 179, 244];
    NODE_RGB.task = NODE_RGB.pending.map((value, index) => Math.round(value * 0.6 + NODE_RGB.verify[index] * 0.4));
    state.canvasAccent = NODE_RGB.warm.join(",");
    for (const key of ["active", "task", "verify", "checkpoint", "focus", "assistant"]) {
      const tint = key === "verify" ? NODE_RGB.verify : key === "task" || key === "checkpoint" ? NODE_RGB.task : NODE_RGB.warm;
      const entry = LEGEND.find((item) => item.key === key);
      if (entry) entry.sw = rgb(tint);
      el.legendList?.querySelector(`[data-sw="${key}"]`)?.style.setProperty("--sw", rgb(tint));
    }
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
    const w = 11 * scale;
    const h = 10 * scale;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = state.canvasPalette?.background ?? "#101620";
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 2.5 * scale);
    ctx.fill();
    ctx.strokeStyle = rgba(NODE_RGB.pending, 0.75); ctx.lineWidth = 0.9; ctx.stroke();
    ctx.fillStyle = rgba(NODE_RGB.session, 0.75);
    ctx.fillRect(x + 3 * scale, y + 3 * scale, 5 * scale, scale);
    ctx.fillRect(x + 3 * scale, y + 6 * scale, 3.5 * scale, scale);
    ctx.restore();
  }

  // ---------- speech bubbles, deferred effects ----------
  // A frame-stepped timer: staggered effects (a row of records flying home,
  // a reply landing after its packet) wait on the animation loop instead of
  // setTimeout, so a hidden or paused view never fires them into the void.
  function later(delay, run) {
    state.deferred.push({ at: Date.now() + Math.max(0, delay), run });
  }

  function stepDeferred(now) {
    if (!state.deferred.length) return;
    const due = state.deferred.filter((entry) => entry.at <= now);
    if (!due.length) return;
    state.deferred = state.deferred.filter((entry) => entry.at > now);
    for (const entry of due) {
      try { entry.run(); } catch (error) { console.error("[idle] deferred effect failed", error); }
    }
  }

  // "watcher · scanned "Swamp biome"" → "scanned "Swamp biome"": the role is
  // already the orb; the bubble carries only what it is doing.
  function agentRemark(text, role) {
    let remark = String(text ?? "").trim();
    if (role) remark = remark.replace(new RegExp(`^${String(role).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(?:done|running|queued|error|idle)?\\s*[·:]?\\s*`, "i"), "");
    return remark.replace(/\s+/g, " ").slice(0, 160);
  }

  // One bubble per node. A repeat of the same remark only refreshes the
  // clock; a new remark replaces the old bubble and restarts its fade.
  // `kind` shapes the marker: say · send (→) · receive (←) · think · done · error.
  function say(node, text, { kind = "say", ttl = SPEECH_TTL, tint = null, delay = 0 } = {}) {
    if (!state.bubbles || !node || !text) return null;
    const id = typeof node === "string" ? node : node.id;
    if (!id) return null;
    if (delay > 0) {
      later(delay, () => say(id, text, { kind, ttl, tint }));
      return null;
    }
    const remark = String(text).replace(/\s+/g, " ").trim().slice(0, 160);
    if (!remark) return null;
    const now = Date.now();
    const existing = state.speech.get(id);
    if (existing && existing.text === remark && existing.kind === kind) {
      existing.at = now;
      existing.ttl = Math.max(existing.ttl, ttl);
      return existing;
    }
    const bubble = { id, text: remark, kind, at: now, ttl, tint, lines: null };
    state.speech.set(id, bubble);
    if (state.speech.size > SPEECH_MAX) {
      const oldest = [...state.speech.values()].sort((a, b) => a.at - b.at)[0];
      if (oldest && oldest.id !== id) state.speech.delete(oldest.id);
    }
    return bubble;
  }

  function clearSpeech(id = null) {
    if (id == null) state.speech.clear();
    else state.speech.delete(id);
  }

  // Expiry runs on the frame clock, so a bubble under the pointer stays up
  // and a view that was hidden does not lose everything said while away.
  function stepSpeech(now) {
    for (const [id, bubble] of state.speech) {
      if (state.hoverSpeech === id) { bubble.at = Math.max(bubble.at, now - bubble.ttl + SPEECH_FADE_OUT + 200); continue; }
      if (now - bubble.at > bubble.ttl) state.speech.delete(id);
    }
  }

  // Bubble alpha over its life: a short fade in, a hold, a longer fade out.
  // Reduced motion shows and hides without the ramps.
  function speechAlpha(bubble, now, still) {
    const age = now - bubble.at;
    if (still) return age <= bubble.ttl ? 1 : 0;
    const tail = bubble.ttl - age;
    return Math.max(0, Math.min(1, age / SPEECH_FADE_IN, tail / SPEECH_FADE_OUT));
  }

  // Word-wrap a remark to at most two lines of `maxWidth`, ellipsis on the last.
  // A card re-wraps its remark on every frame it is drawn, and the wrap
  // depends only on the text and the width, so the last few hundred are kept.
  const SPEECH_LINE_CACHE_MAX = 300;
  function speechLines(ctx, text, maxWidth) {
    const cache = state.speechLineCache ??= new Map();
    const key = `${Math.round(maxWidth)}|${text}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const lines = speechLinesImpl(ctx, text, maxWidth);
    if (cache.size >= SPEECH_LINE_CACHE_MAX) cache.clear();
    cache.set(key, lines);
    return lines;
  }

  function speechLinesImpl(ctx, text, maxWidth) {
    ctx.font = SPEECH_FONT;
    const words = String(text).split(" ");
    const lines = [];
    let line = "";
    let index = 0;
    for (; index < words.length; index += 1) {
      const word = words[index];
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth || !line) line = candidate;
      else {
        lines.push(line);
        line = word;
        if (lines.length === 2) break;
      }
    }
    if (lines.length < 2 && line) lines.push(line);
    const clipped = lines.length === 2 && (index < words.length || ctx.measureText(lines[1]).width > maxWidth);
    let last = lines[lines.length - 1] ?? "";
    if (clipped || ctx.measureText(last).width > maxWidth) {
      while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
      lines[lines.length - 1] = `${last}…`;
    }
    return lines;
  }

  const SPEECH_MARKS = {
    send: (ctx, x, y, tint) => { ctx.strokeStyle = tint; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y); ctx.moveTo(x + 1, y - 3); ctx.lineTo(x + 4, y); ctx.lineTo(x + 1, y + 3); ctx.stroke(); },
    receive: (ctx, x, y, tint) => { ctx.strokeStyle = tint; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x + 4, y); ctx.lineTo(x - 4, y); ctx.moveTo(x - 1, y - 3); ctx.lineTo(x - 4, y); ctx.lineTo(x - 1, y + 3); ctx.stroke(); },
    think: (ctx, x, y, tint) => { ctx.fillStyle = tint; for (const dx of [-4, 0, 4]) { ctx.beginPath(); ctx.arc(x + dx, y, 1.2, 0, Math.PI * 2); ctx.fill(); } },
    done: (ctx, x, y, tint) => { ctx.strokeStyle = tint; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(x - 4, y); ctx.lineTo(x - 1, y + 3); ctx.lineTo(x + 4, y - 3); ctx.stroke(); },
    error: (ctx, x, y, tint) => { ctx.strokeStyle = tint; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 1); ctx.moveTo(x, y + 3.2); ctx.lineTo(x, y + 3.5); ctx.stroke(); },
  };

  // The bubbles: placed beside their node, clear of the HUD, of each other and
  // of other orbs; labels are placed afterwards and step around them.
  function drawSpeech(projected) {
    state.speechRects = [];
    for (const { node } of projected) node._speech = null;
    if (!state.speech.size) return;
    const ctx = el.ctx;
    if (!ctx) return;
    const now = Date.now();
    const still = noMotion();
    const excluded = [...hudRects()];
    const hitsNode = nodeLabelBlocker(projected);
    const byId = new Map(projected.map((entry) => [entry.node.id, entry]));
    const area = usableArea();
    const maxWidth = Math.min(210, Math.max(120, area.w * 0.28));
    const bubbles = [...state.speech.values()].sort((a, b) => b.at - a.at);
    for (const bubble of bubbles) {
      const node = byId.get(bubble.id)?.node;
      // a node with a callout says it inside the card instead, and an agent on
      // a card-bearing node speaks through that card
      if (!node || node._absorbed || node.dying || node._callout || node._px == null || (node._fade ?? 1) <= 0.02) continue;
      if (typeof hostedOnCard === "function" && hostedOnCard(node)) continue;
      const alpha = speechAlpha(bubble, now, still) * Math.max(0.35, node._fade ?? 1);
      if (alpha <= 0.01) continue;
      const lines = bubble.lines ?? speechLines(ctx, bubble.text, maxWidth - 22);
      bubble.lines = lines;
      ctx.font = SPEECH_FONT;
      const textWidth = Math.max(...lines.map((line) => ctx.measureText(line).width));
      const marked = Boolean(SPEECH_MARKS[bubble.kind]);
      const w = Math.ceil(textWidth + 18 + (marked ? 13 : 0));
      const h = 12 + lines.length * 14;
      const reach = (node._pr ?? 6) + 9;
      const px = node._px, py = node._py;
      // Four corners at the orb's rim, then the same corners a step further
      // out, then straight above and below: a crowded hub still finds air for
      // its bubbles. A bubble with nowhere to go waits for the next frame
      // rather than sitting on top of another one.
      const slots = [];
      for (const distance of [0, 18, 36]) {
        const r = reach + distance;
        slots.push(
          { x: px + r, y: py - r - h + 6, tail: "bl" },
          { x: px - r - w, y: py - r - h + 6, tail: "br" },
          { x: px + r, y: py + r - 6, tail: "tl" },
          { x: px - r - w, y: py + r - 6, tail: "tr" },
          { x: px - w / 2, y: py - r - h - 2, tail: "bl" },
          { x: px - w / 2, y: py + r + 2, tail: "tl" },
        );
      }
      let rect = null;
      for (const slot of slots) {
        const candidate = { x: slot.x, y: slot.y, w, h, tail: slot.tail };
        if (candidate.x < area.x + 4 || candidate.y < area.y + 4 || candidate.x + w > area.x + area.w - 4 || candidate.y + h > area.y + area.h - 4) continue;
        if (blocked(candidate, excluded) || blocked(candidate, state.speechRects) || hitsNode(candidate, node)) continue;
        rect = candidate;
        break;
      }
      if (!rect) continue;
      const triple = bubble.tint ? hexToRgb(bubble.tint) : node.kind === "agent" ? agentRgb(node.role) : node.kind === "assistant" ? NODE_RGB.assistant : NODE_RGB.session;
      const mark = bubble.kind === "error" ? rgb(NODE_RGB.amber) : bubble.kind === "done" ? rgb(NODE_RGB.done) : rgb(triple);
      const paper = state.canvasPalette?.background ?? "#101620";
      // a bubble outside the focused branch paints on the far (blurred) layer
      const pen = state.focusIds && el.farCtx && !state.focusIds.has(node.id) ? el.farCtx : ctx;
      pen.save();
      pen.globalAlpha = alpha;
      // tail: a short wedge from the bubble's near corner toward the orb
      const tailX = rect.tail.endsWith("l") ? rect.x + 10 : rect.x + rect.w - 10;
      const tailY = rect.tail.startsWith("b") ? rect.y + rect.h : rect.y;
      const towardX = tailX + (px - tailX) * 0.35, towardY = tailY + (py - tailY) * 0.45;
      pen.beginPath();
      pen.moveTo(tailX - 4, tailY); pen.lineTo(tailX + 4, tailY); pen.lineTo(towardX, towardY); pen.closePath();
      pen.fillStyle = paper; pen.fill();
      pen.strokeStyle = rgba(triple, 0.55); pen.lineWidth = 1; pen.stroke();
      // body
      pen.beginPath(); pen.roundRect(rect.x, rect.y, rect.w, rect.h, 8);
      pen.fillStyle = paper; pen.fill();
      pen.fillStyle = rgba(triple, 0.1); pen.fill();
      if (bubble.kind === "think") pen.setLineDash([3, 3]);
      pen.strokeStyle = bubble.kind === "error" ? rgba(NODE_RGB.amber, 0.8) : rgba(triple, 0.6); pen.lineWidth = 1; pen.stroke();
      pen.setLineDash([]);
      // the seam where the tail meets the body
      pen.fillStyle = paper;
      pen.fillRect(tailX - 3.5, rect.tail.startsWith("b") ? tailY - 1.5 : tailY - 0.5, 7, 2);
      let textX = rect.x + 9;
      if (marked) { SPEECH_MARKS[bubble.kind](pen, rect.x + 11, rect.y + 12, mark); textX += 13; }
      pen.font = SPEECH_FONT; pen.textAlign = "left"; pen.textBaseline = "alphabetic";
      pen.fillStyle = rgba(NODE_RGB.session, 0.95);
      lines.forEach((line, index) => pen.fillText(line, textX, rect.y + 16 + index * 14));
      pen.restore();
      node._speech = { ...rect, id: bubble.id };
      state.speechRects.push({ x: rect.x - 4, y: rect.y - 4, w: rect.w + 8, h: rect.h + 8 });
    }
  }

  // A builder starting is the foreman handing work out: a packet leaves the
  // foreman (the hub, when no foreman sits on the ring) for the new builder,
  // the foreman says what it handed out and the builder answers it is on it.
  function announceHandout(builder) {
    const hub = assistantNode();
    const foreman = state.nodes.find((entry) => entry.kind === "agent" && entry.role === "foreman" && !entry.dying && !entry.builder) ?? hub;
    if (!foreman || foreman === builder) return;
    const title = String(builder.job?.title ?? builder.label ?? "work").replace(/^Work on\s+/i, "").replace(/^["']|["']$/g, "").slice(0, 48);
    state.pulses.push({ from: foreman, to: builder, start: Date.now(), duration: 900, color: agentHex("foreman"), glow: agentHex("foreman"), wave: true, packet: true });
    if (state.pulses.length > 24) state.pulses.shift();
    say(foreman, `handed out "${title}"`, { kind: "send" });
    say(builder, `on it: "${title}"`, { kind: "receive", delay: 900 });
  }

  function speechAt(x, y) {
    for (const node of state.nodes) {
      const rect = node._speech;
      if (!rect) continue;
      if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) return node;
    }
    return null;
  }

  // Backdrop: "follow" resolves to the scene the colour theme owns.
  function activeBackdrop() {
    if (state.backdrop !== "follow" && BACKDROPS[state.backdrop]) return state.backdrop;
    return THEME_BACKDROP[state.themeKey] ?? "dust";
  }

  function setBackdrop(key) {
    const next = BACKDROP_ORDER.includes(key) ? key : "follow";
    state.backdrop = next;
    writeStore("mefiStudio.cmdBackdrop", next);
    if (el.backdrop && el.backdrop.value !== next) el.backdrop.value = next;
    return activeBackdrop();
  }

  function setBubbles(enabled) {
    state.bubbles = Boolean(enabled);
    writeStore("mefiStudio.cmdBubbles", state.bubbles ? "1" : "0");
    if (!state.bubbles) clearSpeech();
    if (el.bubbles) el.bubbles.checked = state.bubbles;
    return state.bubbles;
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
    return state.nodes.filter((node) => ["task", "task-group"].includes(node.kind) && !node.dying).sort((a, b) => (b.task?.updatedAt ?? 0) - (a.task?.updatedAt ?? 0));
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
  // same kind/tool/file/session/text folds into the newest row as a ×N count
  // instead of flooding the list; different log lines keep their own rows.
  // A worker's streamed transcript is the exception: consecutive [opencode]
  // lines share one live row showing the latest line, or a single run would
  // push every run-history row out of the 40.
  const transcriptRow = (row) => row?.kind === "log" && /^\[opencode\]/.test(row.text ?? "");
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
      (newest.sessionId ?? null) === (rest.sessionId ?? null) &&
      ((newest.text ?? null) === (rest.text ?? null) || (transcriptRow(newest) && transcriptRow(rest)))
    ) {
      newest.count = (newest.count ?? 1) + 1;
      newest.at = Date.now();
      if (transcriptRow(rest)) newest.text = rest.text;
    } else {
      state.feed.unshift({ id: id ?? `${Date.now()}-${Math.random()}`, at: Date.now(), ...rest });
      if (state.feed.length > 40) state.feed.length = 40;
    }
    state.feedDirty = true;
    if (state.active) paintFeedSoon();
  }

  // Each renderFeed rebuilds the whole rail (feed rows, roster, queue, chat
  // log), and a worker's stdout arrives here a line at a time, a dozen a
  // second with several running. A push after a quiet FEED_PUSH_MS paints at
  // once; pushes inside that window share one trailing paint, so a burst
  // costs at most four rail rebuilds a second instead of one per line.
  const FEED_PUSH_MS = 250;
  let feedPaintTimer = 0;
  let feedPaintedAt = 0;
  function paintFeedSoon() {
    if (feedPaintTimer) return;
    const wait = feedPaintedAt + FEED_PUSH_MS - Date.now();
    if (wait <= 0) {
      feedPaintedAt = Date.now();
      renderFeed();
      return;
    }
    feedPaintTimer = setTimeout(() => {
      feedPaintTimer = 0;
      feedPaintedAt = Date.now();
      if (state.active) renderFeed();
    }, wait);
  }

  function feedLine(item) {
    if (item.kind === "tool") return `${item.tool ?? "tool"} ${item.file ?? ""}`.trim();
    return String(item.text ?? "");
  }

  function requestTag(source) {
    return { fix: "FIX", collision: "COLLIDE", duplicate: "DUP", improver: "IMPROVE", grow: "GROW", expand: "EXPAND", audit: "AUDIT" }[source] ?? "REQ";
  }

  // Readiness comes from the same scheduler snapshot as the board. Reading it
  // is observational: opening Command never starts or reprioritizes a job.
  async function refreshCommandBacklog(force = false) {
    if (!state.active || !window.mefiStudio?.backlogStatus || state.backlogReadPending || (!force && Date.now() - state.backlogReadAt < 3500)) return;
    const revision = state.backlogRevision;
    state.backlogReadPending = true;
    state.backlogReadAt = Date.now();
    let timeout;
    try {
      // This is a read-only snapshot. An unanswered IPC must not permanently
      // hold the refresh gate; late replies cannot mutate state after the race.
      const result = await Promise.race([
        window.mefiStudio.backlogStatus(),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Queue status took too long to respond. Refresh to try again.")), 12000); }),
      ]);
      if (revision !== state.backlogRevision) return;
      state.backlog = result?.ok ? result : null;
      state.backlogError = result?.ok ? null : result?.error || "Queue status could not be loaded.";
    } catch (error) {
      if (revision === state.backlogRevision) {
        state.backlog = null;
        state.backlogError = error?.message || "Queue status could not be loaded.";
      }
    } finally {
      clearTimeout(timeout);
      if (revision === state.backlogRevision) state.backlogReadAt = Date.now();
      state.backlogReadPending = false;
      state.feedDirty = true;
      if (state.active) renderFeed();
    }
  }

  function elapsedLabel(at, now = Date.now()) {
    if (!Number.isFinite(Number(at)) || Number(at) <= 0) return "Time unavailable";
    const seconds = Math.max(0, Math.floor((now - Number(at)) / 1000));
    if (seconds < 60) return `${seconds}s elapsed`;
    const minutes = Math.floor(seconds / 60);
    return minutes < 60 ? `${minutes}m ${seconds % 60}s elapsed` : `${Math.floor(minutes / 60)}h ${minutes % 60}m elapsed`;
  }

  function commandJobDetail(job, nodes = []) {
    const current = job.sessionId && nodes.find((node) => node.kind === "todo" && node.sessionId === job.sessionId && node.status === "in_progress");
    const progress = typeof job.progress === "number" && Number.isFinite(job.progress) ? Math.max(0, Math.min(1, job.progress)) : null;
    const preparing = job.phase === "preparing";
    const helper = preparing && (state.assistant?.clusterAgents || []).find((agent) => agent.status === "running" && (!agent.taskId || agent.taskId === job.taskId));
    return {
      title: String(job.title || "Untitled task"),
      stage: job.stopping ? `Stopping worker safely · ${job.stopping.reason || "waiting for the worker to exit"}${job.stopping.error ? ` · ${job.stopping.error}` : ""}` : preparing ? helper?.step || "Preparing task context before the builder starts" : current?.label ? String(current.label) : progress === 1 ? "Reported steps complete · finishing the run" : "Worker is running · waiting for its next update",
      progress: job.stopping || preparing ? null : progress,
      elapsed: elapsedLabel(job.startedAt),
    };
  }

  function commandQueue(assistant, requests, backlog) {
    const jobs = autopilotJobs(assistant);
    const runningTitles = new Set(jobs.map((job) => String(job.title ?? "").trim().toLowerCase()).filter(Boolean));
    if (Array.isArray(backlog?.next)) return backlog.next.filter((item) => item.stage !== "approval" && !runningTitles.has(String(item.title ?? "").trim().toLowerCase()));
    if (assistant?.autoBuild === false) return [];
    return (Array.isArray(requests) ? requests : []).filter((request) => request &&
      (!request.status || ["open", "pending", "queued"].includes(request.status)) &&
      !runningTitles.has(String(request.title ?? request.prompt ?? "").trim().toLowerCase())
    ).map((request) => ({ ...request, kind: "request", stage: "queued", title: request.title || request.prompt || "Queued request" }));
  }

  function currentWorkCard(job) {
    const detail = commandJobDetail(job, state.nodes);
    const card = document.createElement("article");
    card.className = "feed-current-card";
    const head = document.createElement("div");
    head.className = "feed-current-head";
    const badge = document.createElement("span");
    badge.className = "feed-current-label";
    badge.textContent = job.stopping ? "Stopping safely" : job.phase === "preparing" ? "Task preparation" : "Working now";
    const time = document.createElement("span");
    time.className = "feed-current-time";
    time.textContent = detail.elapsed;
    state.currentJobTimes.push({ element: time, startedAt: job.startedAt });
    head.append(badge, time);
    const title = document.createElement(job.taskId || job.sessionId ? "button" : "strong");
    title.className = "feed-current-title";
    title.textContent = detail.title;
    if (job.taskId) title.addEventListener("click", () => nav("tasks", { taskId: job.taskId, filter: "all" }));
    else if (job.sessionId) title.addEventListener("click", () => nav("explorer", { sessionId: job.sessionId }));
    const stage = document.createElement("p");
    stage.className = "feed-current-stage";
    stage.textContent = detail.stage;
    card.append(head, title, stage);
    if (detail.progress != null) {
      const progress = document.createElement("progress");
      progress.className = "feed-current-progress";
      progress.max = 1;
      progress.value = detail.progress;
      progress.setAttribute("aria-label", "Worker-reported steps completed");
      const caption = document.createElement("span");
      caption.className = "feed-progress-caption";
      caption.textContent = `${Math.round(detail.progress * 100)}% of reported steps · verification follows`;
      card.append(progress, caption);
    }
    return card;
  }

  function renderParallelControl() {
    const known = Number.isFinite(Number(state.assistant?.parallel)) && Number(state.assistant.parallel) >= 1;
    for (const control of [el.feedParallel, el.infoParallel].filter(Boolean)) {
      control.disabled = Boolean(state.parallelSaving) || !known || !window.mefiStudio?.assistantAutopilot;
      if (!state.parallelSaving) control.value = state.assistant?.adaptiveParallel !== false ? "machine" : String(Math.max(1, Math.min(3, Math.round(Number(state.assistant?.parallel) || 2))));
      control.setAttribute("aria-busy", String(Boolean(state.parallelSaving)));
      control.title = "Machine managed starts independent, eligible work while Studio remains responsive. Starts are staggered to recheck performance; new starts wait when Studio is laggy and resume when it recovers. Manual limits cap concurrent builds. Pause, approvals and file claims still apply.";
    }
  }

  function createBuildParallelControl() {
    const wrap = document.createElement("label");
    wrap.className = "stepper";
    const label = document.createElement("span");
    label.className = "k";
    label.textContent = "Parallel builds";
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Build scheduling capacity");
    for (const [value, text] of [["machine", "Machine managed"], ["1", "Manual: 1 worker"], ["2", "Manual: 2 workers"], ["3", "Manual: 3 workers"]]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      select.append(option);
    }
    select.addEventListener("change", () => void changeBuildParallel(select.value));
    el.infoParallel = select;
    wrap.append(label, select);
    renderParallelControl();
    return wrap;
  }

  async function changeBuildParallel(value) {
    if (state.parallelSaving) return false;
    const adaptiveParallel = value === "machine";
    const parallel = Number(value);
    if (!adaptiveParallel && (!Number.isInteger(parallel) || parallel < 1 || parallel > 3)) { renderParallelControl(); return false; }
    state.parallelSaving = true;
    renderParallelControl();
    try {
      // Choosing capacity never turns scheduling on or changes a pause.
      const result = await autopilotPrefs(adaptiveParallel ? { adaptiveParallel: true } : { adaptiveParallel: false, parallel }, "Parallel builds");
      return Boolean(result);
    } finally {
      state.parallelSaving = false;
      renderParallelControl();
    }
  }

  function renderBuildModeControl() {
    if (!el.feedBuildMode) return;
    const known = typeof state.assistant?.autoBuild === "boolean";
    el.feedBuildMode.disabled = Boolean(state.buildModeSaving) || !known || !window.mefiStudio?.assistantAutopilot;
    if (!state.buildModeSaving) el.feedBuildMode.value = state.assistant?.autoBuild === false ? "verify" : "auto";
    el.feedBuildMode.setAttribute("aria-busy", String(Boolean(state.buildModeSaving)));
    el.feedBuildMode.title = "Auto build starts eligible tasks automatically. Verify first holds each new or changed brief for your approval. Running work continues.";
  }

  function renderAgentModeControl() {
    const assistant = state.assistant;
    const known = ["swarm", "cluster"].includes(assistant?.mode);
    // The tree toolbar (quick switch) and the rail's Agents view show the same selector.
    for (const control of [el.feedAgentMode, el.settingsAgentMode].filter(Boolean)) {
      control.disabled = Boolean(state.agentModeSaving) || !known || !window.mefiStudio?.assistantAutopilot;
      if (!state.agentModeSaving) control.value = assistant?.mode === "cluster" ? "cluster" : "swarm";
      control.setAttribute("aria-busy", String(Boolean(state.agentModeSaving)));
      control.title = "Both modes use the Assistant to plan, delegate subtasks and review results. Swarm also works across ready tasks; Cluster keeps agents on one shared task. Applies to all projects; current work finishes when switching.";
    }
    if (el.feedAgentModeNote) el.feedAgentModeNote.textContent = state.agentModeSaving ? "Saving agent mode…" : !window.mefiStudio ? "Available in the desktop app." : !known ? "Loading agent mode…" : assistant.mode === "swarm"
      ? "Swarm · agents collaborate on tasks and their subtasks across the queue. Pause, approvals and capacity still apply."
      : assistant.clusterFocus?.title ? `Cluster · agents focus on: ${assistant.clusterFocus.title}`
      : autopilotJobs(assistant).length ? "Cluster · current workers finish before agents focus on one task."
      : "Cluster · the Assistant and builders share one task, delegate independent subtasks, then combine the results.";
    renderAgentsGlance();
  }

  // Settings live in their own rail view. The same renderers also run on every
  // work-feed pass, so the two views can never disagree about saved state.
  function renderSettingsPanel() {
    renderParallelControl();
    renderBuildModeControl();
    renderAgentModeControl();
    if (el.autopilotToggle) {
      el.autopilotToggle.checked = Boolean(state.assistant?.enabled);
      el.autopilotToggle.disabled = state.treeStatus !== "ok";
      const wrap = el.autopilotToggle.closest(".setting-row") ?? el.autopilotToggle.closest(".switch");
      if (wrap) wrap.hidden = !window.mefiStudio;
    }
    if (el.settingsState) {
      el.settingsState.textContent = !window.mefiStudio ? "Desktop only"
        : !state.assistant ? "…"
        : state.assistant.enabled ? "Autopilot on" : "Autopilot off";
      el.settingsState.dataset.on = String(Boolean(window.mefiStudio && state.assistant?.enabled));
    }
    renderAgentsGlance();
  }

  // The three chips above the Agents controls: the queue switch, how many builds
  // are running under which cap, and the coordination mode. Painted from the same
  // assistant state the controls read, so the two can never disagree.
  function renderAgentsGlance() {
    const chip = (element, text, tone) => {
      if (!element) return;
      const value = element.querySelector("b");
      if (value) value.textContent = text;
      element.dataset.tone = tone;
    };
    if (!el.glanceAutopilot && !el.glanceWorkers && !el.glanceMode) return;
    if (!window.mefiStudio) {
      for (const element of [el.glanceAutopilot, el.glanceWorkers, el.glanceMode]) chip(element, "Desktop only", "idle");
      return;
    }
    const assistant = state.assistant;
    const on = Boolean(assistant?.enabled);
    chip(el.glanceAutopilot, !assistant ? "…" : on ? "On" : "Off", !assistant ? "idle" : on ? "ok" : "off");
    const running = assistant ? autopilotJobs(assistant).length : 0;
    const cap = el.feedParallel?.value === "machine" ? "auto cap" : Number(el.feedParallel?.value) > 0 ? `cap ${el.feedParallel.value}` : "";
    chip(el.glanceWorkers, `${running} running${cap ? ` · ${cap}` : ""}`, running ? "ok" : "idle");
    const mode = assistant?.mode === "cluster" ? "Cluster" : assistant?.mode === "swarm" ? "Swarm" : "…";
    chip(el.glanceMode, mode, mode === "…" ? "idle" : "ok");
  }

  async function changeAgentMode(mode) {
    if (state.agentModeSaving) return false;
    if (!["swarm", "cluster"].includes(mode)) { renderAgentModeControl(); return false; }
    state.agentModeSaving = true;
    renderAgentModeControl();
    try {
      const result = await autopilotPrefs({ mode }, "Agent mode");
      if (!result && window.mefiStudio?.assistantStatus) {
        const previous = state.assistant;
        let timeout;
        try {
          const fresh = await Promise.race([
            window.mefiStudio.assistantStatus(),
            new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Agent mode status is unavailable.")), 12000); }),
          ]);
          const status = fresh?.status ?? fresh;
          if (fresh?.ok !== false && ["swarm", "cluster"].includes(status?.mode) && state.assistant === previous) {
            state.assistant = { ...(state.assistant ?? {}), ...status };
            state.feedDirty = true;
            if (state.active) renderFeed();
          }
        } catch { /* Preserve the last confirmed status when recovery fails. */ }
        finally { clearTimeout(timeout); }
      }
      return Boolean(result);
    } finally {
      state.agentModeSaving = false;
      renderAgentModeControl();
    }
  }

  // A status push replaces the autopilot status, but the graph rebuild merges
  // its tree summary into this same slot under its own names (refreshGraphImpl);
  // only those survive, so a push that drops a list (clusterAgents) drops it.
  const GRAPH_SUMMARY_KEYS = ["status", "tone", "sublabel", "unread", "rosterAgents", "rosterRunning", "rosterQueued"];
  function adoptAssistantStatus(next) {
    if (!next) { state.assistant = null; return; }
    const kept = {};
    for (const key of GRAPH_SUMMARY_KEYS) if (state.assistant && key in state.assistant) kept[key] = state.assistant[key];
    state.assistant = { ...kept, ...next };
  }

  function commandAgentRoster(assistant, full) {
    const helpers = (Array.isArray(assistant?.clusterAgents) ? assistant.clusterAgents : []).map((agent) => ({
      ...agent,
      role: `cluster-${String(agent.role || "agent").replace(/^cluster-/, "")}`,
      label: String(agent.role || "agent").replace(/^cluster-/, "").replace(/^./, (letter) => letter.toUpperCase()),
      status: agent.status === "failed" ? "error" : agent.status === "skipped" ? "idle" : agent.status,
      text: `${agent.taskTitle || assistant?.clusterFocus?.title || "Shared task"} · ${agent.step || agent.status || "Waiting"}`,
      error: agent.status === "failed" ? agent.step || "Preparation failed" : null,
      cluster: true,
    }));
    const helperRoles = new Set(helpers.map((agent) => agent.role));
    const service = (Array.isArray(full?.agents) ? full.agents : [])
      .filter((agent) => !helperRoles.has(agent.role))
      .map((agent) => /^cluster-(planner|reviewer)$/.test(agent.role) ? { ...agent, label: agent.role.replace("cluster-", "").replace(/^./, (letter) => letter.toUpperCase()), cluster: true } : agent);
    return [...helpers, ...service];
  }

  async function changeBuildMode(value) {
    if (state.buildModeSaving) return false;
    if (!["auto", "verify"].includes(value)) { renderBuildModeControl(); return false; }
    state.buildModeSaving = true;
    renderBuildModeControl();
    try {
      const result = await autopilotPrefs({ autoBuild: value === "auto" }, "Build mode");
      if (!result && window.mefiStudio?.assistantStatus) {
        // A lost acknowledgement may still have saved the mode. Read it back;
        // a newer status push takes precedence over this recovery snapshot.
        const previous = state.assistant;
        let timeout;
        try {
          const fresh = await Promise.race([
            window.mefiStudio.assistantStatus(),
            new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Build mode status is unavailable.")), 12000); }),
          ]);
          const status = fresh?.status ?? fresh;
          if (fresh?.ok !== false && typeof status?.autoBuild === "boolean" && state.assistant === previous) {
            state.assistant = { ...(state.assistant ?? {}), ...status };
            state.feedDirty = true;
            if (state.active) renderFeed();
          }
        } catch { /* Keep the latest saved status when the read also fails. */ }
        finally { clearTimeout(timeout); }
      }
      if (result) await refreshCommandBacklog(true);
      return Boolean(result);
    } finally {
      state.buildModeSaving = false;
      renderBuildModeControl();
    }
  }

  function retryTimeLabel(at) {
    if (!Number.isFinite(Number(at)) || Number(at) <= 0) return "";
    const seconds = Math.max(0, Math.ceil((Number(at) - Date.now()) / 1000));
    if (!seconds) return "Retry is due; waiting for the next scheduling pass.";
    return `Next automatic retry in ${seconds < 60 ? `${seconds}s` : `${Math.ceil(seconds / 60)}m`}.`;
  }

  function renderCommandAttention() {
    if (!el.feedAttention) return;
    const approvals = Array.isArray(state.backlog?.approval) ? state.backlog.approval : [];
    const blocked = [...approvals, ...(Array.isArray(state.backlog?.blocked) ? state.backlog.blocked : [])];
    const countAttention = (state.backlog?.counts?.blocked ?? blocked.length - approvals.length) + (state.backlog?.counts?.approval ?? approvals.length);
    const retry = retryTimeLabel(state.backlog?.nextRetryAt);
    const signature = JSON.stringify([blocked.slice(0, 3), countAttention, retry, state.backlogError]);
    if (signature === state.feedAttentionSignature) return;
    state.feedAttentionSignature = signature;
    el.feedAttention.textContent = "";
    if (blocked.length) {
      const head = document.createElement("div");
      head.className = "feed-section-head";
      const heading = document.createElement("h3");
      heading.textContent = "Needs attention";
      const count = document.createElement("span");
      count.textContent = String(countAttention);
      heading.append(count);
      const review = document.createElement("button");
      review.className = "ghost mini feed-review";
      review.textContent = "Review all";
      review.setAttribute("aria-label", approvals.length ? "Review all tasks needing attention or approval" : "Review all blocked tasks");
      review.addEventListener("click", () => nav("tasks", { filter: "all", readiness: "blocked" }));
      head.append(heading, review);
      el.feedAttention.append(head);
    }
    if (state.backlogError) {
      const message = document.createElement("p");
      message.className = "feed-attention-note";
      message.textContent = `Queue status unavailable · ${state.backlogError}`;
      const refresh = document.createElement("button");
      refresh.className = "ghost mini";
      refresh.textContent = "Refresh status";
      refresh.addEventListener("click", async () => {
        refresh.disabled = true;
        try { await refreshCommandBacklog(true); } finally { refresh.disabled = false; }
      });
      el.feedAttention.append(message, refresh);
    }
    for (const item of blocked.slice(0, 3)) {
      const row = document.createElement("div");
      row.className = "feed-attention-row";
      const title = document.createElement("button");
      title.className = "feed-attention-title";
      title.textContent = item.title;
      title.title = item.stage === "approval" ? "Review this brief and approve its build" : "Open this work to review its result or correct its prerequisites";
      title.addEventListener("click", () => item.kind === "task" ? nav("tasks", { taskId: item.id, filter: "all" }) : nav("explorer", { assistant: true }));
      const reason = document.createElement("p");
      reason.className = "feed-attention-reason";
      reason.textContent = item.reason || "This work needs your review.";
      row.append(title, reason);
      el.feedAttention.append(row);
    }
    if (retry) {
      const note = document.createElement("p");
      note.className = "feed-attention-note";
      note.textContent = retry;
      el.feedAttention.append(note);
    }
    el.feedAttention.hidden = !blocked.length && !retry && !state.backlogError;
  }

  function renderFeed() {
    if (!el.feed || !state.feedDirty) return;
    state.feedDirty = false;
    const bridge = Boolean(window.mefiStudio);
    const assistant = state.assistant;
    const full = assistantFull();
    // Selected-assistant chat swaps the activity stream for the console; the
    // roster band belongs to the work view and hides with it.
    const chatting = chatMode();
    const jobs = autopilotJobs(assistant);
    const preparingCount = jobs.filter((job) => job.phase === "preparing").length;
    const buildingCount = jobs.length - preparingCount;
    const enabled = Boolean(assistant?.enabled);
    const recentPass = Boolean(assistant?.lastPassAt) && Date.now() - assistant.lastPassAt < 10 * 60 * 1000;
    refreshCommandBacklog();
    renderSettingsPanel();
    renderCommandAttention();
    const activeAgent = commandAgentRoster(assistant, full).find((agent) => agent?.status === "running");

    let dot = "off";
    let text = "…";
    if (!bridge) text = "desktop only";
    else if (preparingCount) {
      dot = "running";
      text = buildingCount ? `${buildingCount} building · ${preparingCount} preparing` : "task preparation";
    } else if (jobs.length) {
      dot = "running";
      text = jobs.length > 1 ? `running ×${jobs.length}` : "running";
    } else if (activeAgent?.cluster) {
      dot = "running";
      text = "task preparation";
    } else if (!assistant) text = "…";
    else if (!assistant.execute || full?.status === "paused") {
      // A pause (New work off, Stop all, or the assistant service paused)
      // outranks the last waiting reason, which is stale while paused.
      dot = "bad";
      // The breaker only trips on infra failures; it re-arms itself when the
      // park cooldown passes, so say when that is rather than looking dead.
      const retryMin = assistant.parkedUntil ? Math.max(1, Math.ceil((assistant.parkedUntil - Date.now()) / 60000)) : 0;
      text = (assistant.infraFailures ?? 0) >= 3
        ? `paused · worker CLI not starting${retryMin ? ` · retry ~${retryMin}m` : ""}`
        : "paused";
    } else if (assistant.waiting) {
      dot = "warm";
      // Main's reasons often open with "waiting for/on …"; drop it so the
      // header does not read "waiting · waiting for …".
      text = `waiting · ${String(assistant.waiting).replace(/^waiting (?:for|on) /i, "")}`;
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

    const workSignature = JSON.stringify(jobs.length
      ? jobs.map((job) => { const detail = commandJobDetail(job, state.nodes); return [job.taskId, job.sessionId, job.startedAt, job.phase, detail.title, detail.stage, detail.progress]; })
      : [activeAgent?.role, activeAgent?.text, assistant?.execute, full?.status, state.backlog?.waiting, state.backlog?.summary, assistant?.waiting, assistant?.lastError, bridge]);
    if (el.feedNow && state.currentWorkSignature !== workSignature) {
      state.currentWorkSignature = workSignature;
      state.currentJobTimes = [];
      el.feedNow.textContent = "";
      for (const job of jobs) el.feedNow.append(currentWorkCard(job));
      if (!jobs.length) {
        const card = document.createElement("article");
        card.className = "feed-current-card quiet";
        const label = document.createElement("span");
        label.className = "feed-current-label";
        label.textContent = activeAgent?.cluster ? "Task preparation" : activeAgent ? "Assistant activity" : "Current work";
        const title = document.createElement("strong");
        title.className = "feed-current-title";
        title.textContent = activeAgent?.cluster ? activeAgent.taskTitle || assistant?.clusterFocus?.title || "Preparing a shared task" : activeAgent ? `${activeAgent.role} is working` : assistant?.execute === false || full?.status === "paused" ? "New work is paused" : "No worker running";
        const note = document.createElement("p");
        note.className = "feed-current-note";
        note.textContent = activeAgent?.text || state.backlog?.waiting || state.backlog?.summary || assistant?.waiting || assistant?.lastError || (bridge ? "Watching the queue for the next task." : "Live work is available in the desktop app.");
        card.append(label, title, note);
        el.feedNow.append(card);
      }
    }
    // Frequent log pushes should update the clock without replacing a
    // focused task-details button underneath the reader.
    for (const clock of state.currentJobTimes ?? []) clock.element.textContent = elapsedLabel(clock.startedAt);

    const metricSignature = JSON.stringify(state.backlog?.counts ?? null);
    if (el.feedMetrics && state.feedMetricSignature !== metricSignature) {
      state.feedMetricSignature = metricSignature;
      el.feedMetrics.textContent = "";
      const counts = state.backlog?.counts;
      if (counts) {
        for (const [kind, value, label] of [["ready", counts.ready, "Ready"], ["review", counts.review, "Verifying"], ["waiting", (counts.waiting ?? 0) + (counts.cooling ?? 0), "Waiting"], ["blocked", (counts.blocked ?? 0) + (counts.approval ?? 0), "Needs attention"]]) {
          const metric = document.createElement("button");
          metric.className = "feed-metric";
          metric.dataset.state = kind;
          metric.dataset.empty = String(!(value > 0));
          const number = document.createElement("strong");
          number.textContent = String(value ?? 0);
          const name = document.createElement("span");
          name.textContent = label;
          metric.append(number, name);
          metric.title = kind === "blocked" ? "Review build approvals, failures and missing or cyclic prerequisites" : kind === "waiting" ? "Inspect prerequisite waits and scheduled retries" : "Open matching tasks on the board";
          metric.addEventListener("click", () => nav("tasks", { filter: "all", readiness: kind }));
          el.feedMetrics.append(metric);
        }
      }
      el.feedMetrics.hidden = !counts;
    }

    const queued = commandQueue(assistant, state.requests, state.backlog);
    const nextCount = state.backlog?.counts?.ready ?? queued.length;
    const queueSignature = JSON.stringify([queued, nextCount, state.feedMenuOpen, Boolean(state.backlog), state.backlogError]);
    if ((el.feedQueue || el.feedDrop) && state.feedQueueSignature !== queueSignature) {
      state.feedQueueSignature = queueSignature;
      const queueRow = (item, index) => {
        const li = document.createElement("li");
        const tag = document.createElement("span");
        tag.className = "feed-queue-rank";
        tag.textContent = String(index + 1).padStart(2, "0");
        const name = document.createElement("button");
        name.className = "qt";
        name.textContent = item.title;
        name.addEventListener("click", () => item.kind === "task" ? nav("tasks", { taskId: item.id, filter: "all" }) : nav("explorer", { assistant: true }));
        li.title = item.reason || item.prompt || item.title;
        li.dataset.kind = item.kind;
        li.append(tag, name);
        return li;
      };
      if (el.feedQueueCount) el.feedQueueCount.textContent = String(nextCount);
      if (el.feedMenu) {
        el.feedMenu.hidden = queued.length <= 3;
        el.feedMenu.textContent = state.feedMenuOpen ? "Show less" : `Show ${Math.min(5, queued.length - 3)} more`;
      }
      if (el.feedQueue) {
        el.feedQueue.textContent = "";
        for (const [index, item] of queued.slice(0, 3).entries()) el.feedQueue.append(queueRow(item, index));
        if (!queued.length) {
          const li = document.createElement("li");
          li.className = "more";
          li.textContent = state.backlogError ? "Queue status unavailable" : state.backlog ? "No ready tasks waiting" : "No requests waiting";
          el.feedQueue.append(li);
        }
      }
      if (el.feedDrop) {
        // The disclosure continues the list; it never repeats running work
        // or the three entries already visible above it.
        el.feedDrop.textContent = "";
        for (const [index, item] of queued.slice(3, 8).entries()) el.feedDrop.append(queueRow(item, index + 3));
        if (nextCount > 8) {
          const li = document.createElement("li");
          li.className = "more";
          const link = document.createElement("button");
          link.className = "more-link";
          link.textContent = "Open full task board";
          link.addEventListener("click", () => nav("tasks", { filter: "all" }));
          li.append(link);
          el.feedDrop.append(li);
        }
        el.feedDrop.hidden = !state.feedMenuOpen || queued.length <= 3;
      }
    }

    if (el.feedAgents) {
      // The whole roster, not just the executor's in-flight jobs: every agent
      // the service runs, sorted so whoever is working floats to the top.
      const rank = { running: 0, queued: 1, error: 2, done: 3, idle: 4 };
      const roster = commandAgentRoster(assistant, full)
        .sort((a, b) => (rank[a?.status] ?? 5) - (rank[b?.status] ?? 5));
      if (el.feedAgentsCount) {
        const active = roster.filter((agent) => agent?.status === "running").length;
        const problems = roster.filter((agent) => agent?.status === "error").length;
        el.feedAgentsCount.textContent = problems ? `${problems} need attention` : active ? `${active} working` : "Quiet";
        el.feedAgentsCount.dataset.state = problems ? "error" : active ? "running" : "idle";
      }
      el.feedAgents.textContent = "";
      el.feedAgents.hidden = !roster.length;
      if (el.feedAgentsSection) el.feedAgentsSection.hidden = !roster.length || chatting;
      for (const agent of roster) {
        const status = agent.status ?? "idle";
        const li = document.createElement("li");
        li.className = `agent-${status}`;
        li.style.borderLeftColor = agentHex(agent.role);
        // Two lines per agent: status, name and elapsed on the first, what the
        // agent is doing (or why it failed) wrapping on the second.
        const head = document.createElement("span");
        head.className = "agent-row-head";
        const tag = document.createElement("span");
        tag.className = `src-tag ${status === "error" ? "fix" : status === "running" ? "running-chip" : status === "queued" ? "improver" : "stale"}`;
        tag.textContent = status.toUpperCase();
        const name = document.createElement("b");
        name.textContent = agent.label || agent.role;
        if (status !== "error") name.style.color = agentHex(agent.role);
        const when = document.createElement("span");
        when.className = "when";
        when.textContent = agent.cluster ? agent.status === "running" && agent.since ? elapsedLabel(agent.since) : "" : status === "running" ? elapsedLabel(agent.since) : agent.lastRunAt ? agoShort(agent.lastRunAt) : "Not run yet";
        const text = document.createElement("span");
        text.className = "text";
        text.textContent = String((status === "error" && agent.error) || agent.text || "").replace(new RegExp(`^${String(agent.role ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} (?:done|running|queued|error)\\s*[·:]?\\s*`, "i"), "");
        head.append(tag, name, when);
        li.title = `${agent.role} · ${status}${text.textContent ? ` — ${text.textContent}` : ""}`;
        li.append(head);
        if (text.textContent) li.append(text);
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
      const machineManaged = assistant?.adaptiveParallel !== false;
      const capacityHold = assistant?.capacity?.canStart === false ? assistant.capacity.reason || "Waiting for machine capacity" : null;
      const waiting = assistant?.execute === false ? "new work paused" : capacityHold || state.backlog?.waiting || assistant?.waiting;
      el.feedMeta.textContent = assistant?.mode === "cluster"
        ? `${preparingCount ? `${preparingCount} preparing · ` : ""}${buildingCount} building · cluster focus${waiting ? ` · ${waiting}` : ""}`
        : machineManaged && assistant
        ? `${preparingCount ? `${preparingCount} preparing · ` : ""}${buildingCount} building · machine managed${waiting ? ` · ${waiting}` : ""}`
        : state.backlog?.waiting || (jobs.length
        ? `${preparingCount ? `${preparingCount} preparing · ${buildingCount} building · ` : ""}${jobs.length} of ${assistant?.parallel ?? 1} worker slots in use${assistant?.execute === false ? " · new work paused" : ""}`
        : state.backlog?.summary || assistant?.waiting || "The board keeps task results and verification details.");
    }

    // With the assistant node selected the rail swaps the activity stream for
    // the chat console; anything else brings the feed back. The right-side
    // chat log mirrors the thread whatever is selected.
    if (el.feedActivity) el.feedActivity.hidden = chatting;
    if (el.feedChat) {
      el.feedChat.hidden = !chatting;
      if (chatting) renderChat();
    }
    // Bringing a selection forward is the rail's "node" view now — selectNode
    // owns that, for every kind, so the assistant no longer gets a special flip
    // of its own that raced the floating card's suppression guard.
    state.lastAssistantSelected = state.selected?.kind === "assistant";
    if (typeof renderRailBadges === "function") renderRailBadges();
    if (state.railTab === "ask" && typeof renderAsks === "function") renderAsks();
    paintChatLog();
  }

  // The composer is a textarea that grows with the draft up to a few lines.
  function growArea(area) {
    if (!area) return;
    area.style.height = "auto";
    const height = Math.min(120, Math.max(38, area.scrollHeight));
    area.style.height = `${height}px`;
    area.style.overflowY = area.scrollHeight > height + 1 ? "auto" : "hidden";
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
          ? `Work on "${String(focused.label || focused.id).slice(0, 22).trimEnd()}${String(focused.label || focused.id).length > 22 ? "…" : ""}"`
          : "Message the assistant…";
      if (bridge) el.chatInput.title = "Enter sends · Shift+Enter for a new line";
      growArea(el.chatInput);
    }
    if (el.chatSend) {
      el.chatSend.disabled = !bridge || state.assistantSending;
      el.chatSend.textContent = state.assistantSending ? "Sending…" : "Send";
    }
    renderNewWorkControl();

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

    // The work that sank into the assistant orb, in the rail console too —
    // the floating card is hidden while the rail shows the assistant.
    if (el.chatAbsorbed && el.chatAbsorbedList) {
      const ledger = state.absorbed.get("__assistant__") ?? [];
      el.chatAbsorbed.hidden = !ledger.length;
      const summary = el.chatAbsorbed.querySelector("summary");
      if (summary) summary.textContent = `Absorbed work (${ledger.length})`;
      el.chatAbsorbedList.textContent = "";
      for (const entry of ledger.slice(0, ABSORBED_MAX)) el.chatAbsorbedList.append(absorbedRow(entry));
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
    const point = node._layoutAnchor ?? node;
    state.camera.tx = -point.x;
    state.camera.ty = -point.y;
    state.camera.tz = -point.z;
  }

  function focusNode(node, { zoom } = {}) {
    if (!node) return;
    // Every focusNode call is a user decision (a click, a search hit, keyboard
    // navigation, a card link) — the camera belongs to them from here on.
    setCamMode("free", { quiet: true, transient: true });
    focusOn(node);
    if (zoom) glideZoom(Math.max(state.zoomTarget ?? state.zoom, zoom));
  }

  function onActivity(data) {
    if (!state.active) return;
    const now = Date.now();
    for (const item of data.activity ?? []) {
      pushFeed({ id: item.id, at: item.time, kind: "tool", tool: item.tool, file: basename(item.file), sessionId: item.sessionId });
      const session = nodeForSession(item.sessionId);
      if (!session) continue;
      const touch = state.touches.get(item.sessionId) ?? { count: 0, at: 0 };
      touch.count += 1;
      touch.at = Math.max(touch.at || 0, Number(item.time) > 0 ? Math.min(now, Number(item.time)) : now);
      state.touches.set(item.sessionId, touch);
      state.lastTouch = now;

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
    else if (state.camMode === "follow") updateFollowCamera(now, true);
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

  // The tree owns the agents' flights; this surface advances them while its
  // canvas is visible, including when the small tree rail is asleep.
  // Positions come in every frame; the counters say when to pulse,
  // spark, or fire the bright "done" pulse — each rendered here exactly once.
  function syncAgentMotion(now, animationTime) {
    const profiler = globalThis.window?.MefiProfiler;
    const span = profiler?.begin("command.agents");
    try { return syncAgentMotionImpl(now, animationTime); }
    finally { profiler?.end(span); }
  }

  function syncAgentMotionImpl(now, animationTime) {
    // Flights use the animation clock; Command's dated work effects use now.
    const live = window.MefiTree?.advanceAgents?.(animationTime) ?? window.MefiTree?.agentPositions?.() ?? {};
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
          const angle = node.orbit + (noMotion() ? 0 : animationTime / speed);
          node.x = anchor.x + Math.cos(angle) * radius;
          node.y = anchor.y - (node.lift ?? 8) + (noMotion() ? 0 : Math.sin(animationTime / 1400 + node.orbit) * 2);
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
      node.motionOpacity = motion?.opacity ?? (motion ? 1 : 0);
      node.retiring = Boolean(motion?.retiring);
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
      // Arrivals and departures, said out loud: the flight ending on a node
      // is "at …", the turn for home is "heading home".
      const phases = state.agentPhases ??= {};
      const previousPhase = phases[node.role];
      phases[node.role] = motion.phase;
      if (state.active && previousPhase && previousPhase !== motion.phase && typeof say === "function") {
        if (previousPhase === "flying" && motion.phase === "hovering" && target) say(node, `at "${String(target.label ?? motion.targetLabel ?? "").slice(0, 40)}"`, { ttl: 2600 });
        else if (motion.phase === "returning" && previousPhase !== "home") say(node, "heading home", { ttl: 1800 });
      }
      const seen = state.agentSeq[node.role] ?? { pulse: motion.pulseSeq, spark: motion.sparkSeq, done: motion.doneSeq };
      if (motion.pulseSeq > seen.pulse && target) {
        const tint = agentHex(node.role);
        state.pulses.push({ from: node, to: target, start: now, duration: 520, color: tint, glow: tint, small: true, wave: true });
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
      const result = await read("eyesState");
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
    if (state.ambientZen) return noMotion() || state.view === "2d" ? 0 : ORBIT_BASE * 0.65;
    if (state.camMode === "follow") return 0; // the working branch stays readable while its agents move.
    if (state.view === "2d") return 0; // the flat map does not revolve
    if (noMotion() || state.orbit === "paused") return 0;
    // Only a real gesture holds the orbit: a drag in progress, a selection or
    // a search. The pointer resting on the canvas is not one.
    if (state.panning || state.rotating) return 0;
    // A focused node keeps the rest of the tree turning slowly behind it.
    if (state.focus && state.view !== "2d" && !noMotion()) return ORBIT_BASE * FOCUS_DRIFT;
    if (state.selected || state.query) return 0;
    if (Date.now() < state.settleUntil) return 0;
    return ORBIT_BASE + (state.reactive ? 0 : energy) * ORBIT_ENERGY;
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
  function followsNode(node, focus) {
    if (!focus) return false;
    if (focus.context?.some((entry) => entry.id === node.id)) return true;
    if (node.kind !== "agent") return false;
    const ids = new Set([focus.key, focus.taskId, focus.sessionId].filter(Boolean));
    return [node.hostId, node.targetId, node.targetNode?.id, node.job?.taskId, node.job?.sessionId].some((id) => id && ids.has(id));
  }

  function emphasis(node) {
    if (state.query) return state.matchSet.has(node.id) ? 1 : 0.25;
    if (state.camMode === "follow" && state.follow) {
      if (followsNode(node, state.follow)) return 1;
      if (node.kind === "music" || node.kind === "assistant") return 0.7;
      return node._workLabel === "Running" ? 0.45 : 0.2;
    }
    if (!state.branch) return 1;
    const sid = node.sessionId ?? node.anchorSessionId ?? node.id;
    if (sid === state.branch) return node.kind === "todo" ? 1.15 : 1;
    return 0.55;
  }

  // A native <select> picker paints on this same main thread: Chromium shows
  // the popup widget first and fills it from a script that queues behind
  // whatever the page is doing. With the constellation drawing at 30 fps that
  // script can wait long enough that the picker sits open as a blank grey box
  // ("the dropdown shows no menu"), so the frame loop and the refresh tick
  // yield from the moment a select is engaged (mousedown, focus or a keyboard
  // open) until it changes, blurs or the page is clicked elsewhere. The hold
  // is bounded: a select left focused never freezes the view for good.
  const PICKER_HOLD_MS = 6000;
  function pickerHeld(now = performance.now()) {
    return state.pickerHoldUntil > now;
  }
  function holdForPicker(target) {
    if (!(target instanceof HTMLSelectElement)) return;
    state.pickerHoldUntil = performance.now() + PICKER_HOLD_MS;
  }
  function releasePicker() {
    state.pickerHoldUntil = 0;
  }
  function watchPickers() {
    document.addEventListener("mousedown", (event) => {
      if (event.target instanceof HTMLSelectElement) holdForPicker(event.target);
      else releasePicker();
    }, true);
    document.addEventListener("focusin", (event) => holdForPicker(event.target), true);
    document.addEventListener("keydown", (event) => {
      if (!(event.target instanceof HTMLSelectElement)) return;
      if (event.altKey || ["ArrowDown", "ArrowUp", " ", "Enter", "F4"].includes(event.key)) holdForPicker(event.target);
    }, true);
    for (const type of ["change", "focusout"]) {
      document.addEventListener(type, (event) => {
        if (event.target instanceof HTMLSelectElement) releasePicker();
      }, true);
    }
  }

  // Animation state belongs to the scheduler, independent of graph styling.
  // Command draws at 30 fps at rest and at the display's rate (capped near
  // 60-75 fps) while the camera, a zoom or a drag is moving, as long as the
  // measured frame cost leaves room for it.
  const AMBIENT_FRAME_MS = 30;
  const HOT_FRAME_MS = 12;
  const HOT_FRAME_BUDGET_MS = 9;
  let lastFrameAt = 0;
  let frameRequest = 0;
  function frame(time) {
    if (!state.active) return;
    if (document.body.dataset.sheet && !(state.settingsPreview && document.body.dataset.sheet === "music") || pickerHeld(time)) {
      frameRequest = requestAnimationFrame(frame);
      return;
    }
    // ~30 fps. The gate sits a little under the two-tick spacing (33.3 ms at
    // 60 Hz): vsync timestamps jitter by a millisecond or two, and a 32.9 ms
    // tick that missed a 33 ms gate cost a whole extra tick — a 50 ms hitch
    // that read as judder in every camera glide.
    const hot = state.motionHot && Number.isFinite(state.frameCost) && state.frameCost < HOT_FRAME_BUDGET_MS;
    if (!document.hidden && time - lastFrameAt >= (hot ? HOT_FRAME_MS : AMBIENT_FRAME_MS)) {
      lastFrameAt = time;
      const profiler = globalThis.window?.MefiProfiler;
      const span = profiler?.begin("command.frame");
      const clock = globalThis.performance;
      const startedAt = clock?.now?.();
      try {
        drawFrame(time);
      } catch (error) {
        if (!state.frameError) {
          state.frameError = true;
          // The stack, not just the message: a one-shot early-frame error must
          // name its own function and line, or the cold-boot hunt starts blind.
          console.error("[idle]", error?.stack ?? String(error?.message ?? error));
        }
      } finally {
        profiler?.end(span);
        // A smoothed cost of the draw itself decides whether the hot cadence
        // can be afforded; one slow frame does not flip it.
        if (Number.isFinite(startedAt)) {
          const cost = clock.now() - startedAt;
          state.frameCost = Number.isFinite(state.frameCost) ? state.frameCost * 0.9 + cost * 0.1 : cost;
        }
      }
    }
    frameRequest = requestAnimationFrame(frame);
  }

  function normalizeAudioPreferences(value, legacyResponse = null) {
    const saved = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const legacy = legacyResponse == null || legacyResponse === "" ? NaN : Number(legacyResponse);
    const response = typeof saved.response === "number" && Number.isFinite(saved.response) ? saved.response : Number.isFinite(legacy) ? Math.max(0, Math.min(2, legacy)) * 0.35 : 0.35;
    return { response: Math.max(0, Math.min(2, response)), waves: typeof saved.waves === "boolean" ? saved.waves : true, nodes: typeof saved.nodes === "boolean" ? saved.nodes : true, percussion: saved.percussion === true, background: saved.background === true, splitBands: typeof saved.splitBands === "boolean" ? saved.splitBands : true };
  }

  function readAudioPreferences() {
    let saved;
    try { saved = JSON.parse(readStore("mefiStudio.audioVisuals.v1")); } catch {}
    return normalizeAudioPreferences(saved, readStore("mefiStudio.audioResponse"));
  }

  function persistAudioPreferences() {
    writeStore("mefiStudio.audioVisuals.v1", JSON.stringify({ response: state.audioResponse, ...state.audioEffects }));
  }

  function setAudioEffects(changes = {}) {
    const effects = normalizeAudioPreferences(state.audioEffects);
    delete effects.response;
    for (const key of ["waves", "nodes", "percussion", "background", "splitBands"]) if (typeof changes?.[key] === "boolean") effects[key] = changes[key];
    state.audioEffects = effects;
    if (!effects.waves) state.audioWaves = [];
    persistAudioPreferences();
    renderMusicStatus(true);
  }

  function setAudioResponse(value) {
    const next = Number(value);
    if (!Number.isFinite(next)) return;
    state.audioResponse = Math.max(0, Math.min(2, next));
    if (!state.audioResponse) state.audioWaves = [];
    persistAudioPreferences();
    renderMusicStatus(true);
  }

  function visualMusicResponse(music, effects = {}) {
    if (!music || effects.percussion === true) return music;
    return { ...music, beat: 0, kick: 0, snare: 0, hat: 0 };
  }

  function connectionAudioBand(from, to) {
    let hash = 0;
    for (const char of `${from}:${to}`) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return ["bass", "mid", "treble"][hash % 3];
  }

  function connectionMusicResponse(music, band) {
    if (!music || band === "mix") return music;
    // A full-mix waveform would make every cable jump to the same drum hit.
    // Split cables use only their own band's envelope and attack contour.
    return { bass: band === "bass" ? music.bass : 0, bassline: band === "bass" ? music.bassline ?? music.bass : 0,
      mid: band === "mid" ? music.mid : 0, treble: band === "treble" ? music.treble : 0,
      kick: band === "bass" ? music.kick ?? music.beat : 0, snare: band === "mid" ? music.snare : 0,
      hat: band === "treble" ? music.hat : 0, beat: 0, waveform: [] };
  }

  // A node keeps its frequency voice across sorting, camera moves and rebuilds.
  // Music changes light within the existing surface, never its layout or status.
  function nodeAudioResponse(node, music, enabled, response = 1) {
    let band = "mid";
    if (["root", "assistant", "music"].includes(node.kind)) band = "bass";
    else if (["todo", "agent", "checkpoint"].includes(node.kind)) band = "treble";
    else if (node.kind === "task" && !node.taskGroup) {
      let hash = 0;
      for (const char of String(node.id)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
      band = ["bass", "mid", "treble"][hash % 3];
    }
    const clamp = (value) => Math.max(0, Math.min(1, Number(value) || 0));
    const strength = Number.isFinite(Number(response)) ? Math.max(0, Math.min(2, Number(response))) : 0.35;
    const transient = band === "bass" ? music?.kick : band === "mid" ? music?.snare : music?.hat;
    const beat = enabled ? clamp((clamp(transient ?? music?.beat) * 0.85 + clamp(music?.beat) * 0.15) * strength) : 0;
    const level = enabled ? clamp((clamp(music?.[band]) * 0.82 + clamp(music?.energy) * 0.18) * strength) : 0;
    return { band, level, beat };
  }

  function drawNodeAudio(ctx, node, p, radius, tint, response, music = null, time = 0) {
    const { level, beat } = response;
    if (level < 0.005 && beat < 0.005) return;
    ctx.save();
    ctx.globalAlpha = (node._fade ?? 1) * emphasis(node);
    // Leave the status rim and central music/assistant glyph readable.
    const core = radius * (0.28 + level * 0.42 + beat * 0.1);
    const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, Math.max(1, core));
    glow.addColorStop(0, rgba(tint, Math.min(0.9, level * 0.58 + beat * 0.32)));
    glow.addColorStop(1, rgba(tint, 0));
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1, core), 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = rgba(tint, level * 0.6 + beat * 0.24);
    ctx.lineWidth = Math.min(1.8, radius * 0.14);
    ctx.beginPath(); ctx.arc(p.x, p.y, radius * (0.72 + level * 0.12), 0, Math.PI * 2); ctx.stroke();
    // The live waveform folds around the inside of each orb. Higher bands
    // add fine detail; drum attacks open the contour without moving the node.
    if (music?.waveform?.length && level > 0.02) {
      const samples = music.waveform;
      const turns = response.band === "treble" ? 7 : response.band === "mid" ? 4 : 2;
      ctx.beginPath();
      for (let index = 0; index <= 32; index += 1) {
        const angle = index / 32 * Math.PI * 2;
        const sample = samples[Math.floor(index % 32 / 32 * samples.length)] || 0;
        const ripple = Math.sin(angle * turns - time / 280) * beat * 0.08 + sample * level * 0.12;
        const r = radius * Math.max(0.35, Math.min(0.92, 0.57 + level * 0.15 + ripple));
        const x = p.x + Math.cos(angle) * r, y = p.y + Math.sin(angle) * r;
        if (index) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.strokeStyle = rgba(tint, level * 0.5 + beat * 0.4); ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  // Sample the real connection path, including branch curves, and displace
  // only its interior along the local normal. Endpoints remain on their nodes.
  function audioConnectionWave(a, b, music, response = 1, time = 0, curved = false, seed = 0) {
    const clamp = (value) => Math.max(0, Math.min(1, Number(value) || 0));
    const strength = Number.isFinite(Number(response)) ? Math.max(0, Math.min(2, Number(response))) : 0.35;
    const bass = clamp(music?.bassline ?? music?.bass), mid = clamp(music?.mid), treble = clamp(music?.treble);
    const kick = clamp(music?.kick ?? music?.beat), snare = clamp(music?.snare), hat = clamp(music?.hat);
    const activity = Math.max(bass, mid, treble, kick, snare, hat);
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    if (strength === 0 || activity < 0.008 || length < 4 || !Number.isFinite(length)) return null;
    const span = Math.min(12, length * 0.07) * strength;
    const cycles = Math.max(1, Math.min(3, length / 160));
    const segments = Math.max(16, Math.min(56, Math.ceil(length / 9)));
    const phase = time / 1800, tau = Math.PI * 2;
    const samples = music?.waveform ?? [];
    const points = [];
    let amplitude = 0;
    for (let index = 0; index <= segments; index += 1) {
      const t = index / segments, u = 1 - t;
      const x = curved ? a.x + dx * (3 * t * t - 2 * t * t * t) : a.x + dx * t;
      const y = curved ? a.y + dy * (1.5 * t - 1.5 * t * t + t * t * t) : a.y + dy * t;
      const tx = curved ? dx * 6 * t * u : dx;
      const ty = curved ? dy * (1.5 - 3 * t + 3 * t * t) : dy;
      const tangent = Math.hypot(tx, ty) || length;
      const samplePosition = ((t * 2 + phase * 0.14 + seed * 0.03) % 1) * samples.length;
      const sampleIndex = Math.floor(samplePosition), blend = samplePosition - sampleIndex;
      const sample = samples.length ? (samples[sampleIndex] || 0) * (1 - blend) + (samples[(sampleIndex + 1) % samples.length] || 0) * blend : 0;
      const broad = Math.sin(tau * (t * cycles - phase * 0.65) + seed) * (bass * 0.65 + kick * 0.3);
      const body = Math.sin(tau * (t * (cycles * 2 + 1) - phase * 1.25) + seed * 0.7) * (mid * 0.32 + snare * 0.28);
      const detail = Math.sin(tau * (t * (cycles * 4 + 3) - phase * 2.4)) * (treble * 0.15 + hat * 0.25);
      const displacement = Math.max(-1, Math.min(1, broad + body + detail * 0.65 + sample * activity * 0.12));
      const offset = index === 0 || index === segments ? 0 : Math.sin(Math.PI * t) * span * displacement;
      amplitude = Math.max(amplitude, Math.abs(offset));
      points.push({ x: x - ty / tangent * offset, y: y + tx / tangent * offset });
    }
    return { points, amplitude, activity: activity * Math.min(1, strength), bass, mid, treble, kick, snare, hat };
  }

  function drawAudioConnection(ctx, a, b, tint, lifetime, time, curved = false, sourceLink = false) {
    if (lifetime <= 0.02) return;
    let seed = 0;
    for (const char of `${a.node.id}:${b.node.id}`) seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
    const band = state.audioEffects?.splitBands === false ? "mix" : connectionAudioBand(a.node.id, b.node.id);
    const music = connectionMusicResponse(visualMusicResponse(state.music, state.audioEffects), band);
    const wave = audioConnectionWave(a.p, b.p, music, state.audioResponse, time, curved, seed % 628 / 100);
    if (!wave) return;
    const { points, activity } = wave;
    const attack = Math.max(wave.kick, wave.snare, wave.hat) * Math.min(1, Math.max(0, state.audioResponse ?? 0.35));
    const bandTint = wave.treble > wave.bass && wave.treble > wave.mid ? NODE_RGB.session : wave.mid > wave.bass ? NODE_RGB.pending : NODE_RGB.warm;
    const color = tint.map((channel, index) => Math.round(channel * 0.4 + (bandTint?.[index] ?? channel) * 0.6));
    ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) ctx.lineTo(points[index].x, points[index].y);
    ctx.strokeStyle = rgba(color, lifetime * activity * 0.12); ctx.lineWidth = sourceLink ? 7 : 5; ctx.stroke();
    ctx.strokeStyle = rgba(color, lifetime * Math.min(0.85, activity * 0.62 + attack * 0.2));
    ctx.lineWidth = (sourceLink ? 1.6 : 1.1) + attack * 0.9; ctx.stroke();
    ctx.restore();
    state.audioWaves.push({ from: a.node.id, to: b.node.id, sourceLink, band, ...wave });
  }

  function drawGraphConnections(ctx, projected, runningIds, audioLinked = false, time = 0, layers = null) {
    const profiler = globalThis.window?.MefiProfiler;
    const span = profiler?.begin("command.connections");
    try { return drawGraphConnectionsImpl(ctx, projected, runningIds, audioLinked, time, layers); }
    finally { profiler?.end(span); }
  }

  // One look per relationship, so the eye can tell what a line means before
  // reading either end: root→session plain, session→todo faint and tinted by
  // the todo's state, a task's anchor dotted, the hub link doubled, the
  // finished cluster stippled. The active path (a running worker's node) is
  // the bright one and its dots march while the work runs.
  function edgeStyleFor(edge, a, b, { active = false, inspected = false, primary = false } = {}) {
    const hub = Boolean(edge.assistant) || (a.node.kind === "root" && b.node.kind === "assistant") || (a.node.kind === "assistant" && b.node.kind === "root");
    if (hub) return { kind: "hub", dash: [], width: 1, alpha: 0.34, double: true };
    if (edge.task || b.node.kind === "task" || b.node.kind === "task-group") return { kind: "task", dash: [2, 4], width: active || inspected ? 1.4 : 1, alpha: inspected ? 0.7 : active ? 0.55 : primary ? 0.32 : 0.12, march: active };
    if (b.node.kind === "todo") return { kind: "todo", dash: [], width: active ? 1.2 : 0.8, alpha: b.node.state === "done" ? 0.3 : inspected ? 0.6 : active ? 0.5 : 0.14 };
    if (b.node.kind === "folded") return { kind: "folded", dash: [1, 5], width: 0.9, alpha: 0.22 };
    return { kind: "session", dash: [], width: inspected ? 1.3 : 0.9, alpha: inspected ? 0.65 : active ? 0.5 : primary ? 0.3 : 0.16 };
  }

  function drawGraphConnectionsImpl(ctx, projected, runningIds, audioLinked, time, layers = null) {
    state.audioWaves = [];
    audioLinked = audioLinked && state.audioEffects?.waves !== false && state.audioResponse !== 0;
    // A line with an end outside the focused branch paints on the far layer.
    const far = layers?.far ?? ctx;
    const focusIds = layers?.focusIds ?? null;
    const penFor = (a, b) => (focusIds && far !== ctx && !(focusIds.has(a.node.id) && focusIds.has(b.node.id)) ? far : ctx);
    const marching = typeof noMotion === "function" ? !noMotion() : false;
    // Keep the work tether underneath each waveform so its endpoints and
    // assignment remain readable as the sound bends the connection.
    for (const edge of state.edges) {
      const a = projected[edge.a], b = projected[edge.b];
      if (!a || !b || a.node._absorbed || b.node._absorbed || a.node.kind === "agent" || b.node.kind === "agent") continue;
      const lifetime = Math.min(a.node._fade ?? 1, b.node._fade ?? 1);
      if (lifetime <= 0.02) continue;
      const sessionId = edge.sessionId ?? b.node.sessionId;
      const inspected = state.branch && sessionId === state.branch || state.hoverNode === a.node || state.hoverNode === b.node;
      const active = b.node._workLabel !== "Verifying" && isBusyNode(b.node, runningIds);
      const branches = state.nodeLayout === "tree" || state.nodeLayout === "layers";
      const primary = state.branchParents?.get(b.node.id) === a.node.id;
      const tint = active || inspected ? colorOf(b.node) : b.node.kind === "todo" && b.node.state === "done" ? NODE_RGB.done ?? NODE_RGB.task : NODE_RGB.task;
      const style = edgeStyleFor(edge, a, b, { active, inspected, primary });
      const response = audioLinked && state.audioEffects?.splitBands === false ? b.node._audioResponse : null;
      const light = response ? response.level * 0.24 + response.beat * 0.12 : 0;
      const pen = penFor(a, b);
      pen.strokeStyle = rgba(tint, lifetime * Math.min(0.95, style.alpha + light));
      pen.lineWidth = style.width + light * 1.8;
      pen.setLineDash?.(style.dash);
      pen.lineDashOffset = style.march && marching ? -((time / 60) % 6) : 0;
      if (style.double) {
        const dx = b.p.x - a.p.x, dy = b.p.y - a.p.y, len = Math.hypot(dx, dy) || 1;
        const nx = (-dy / len) * 1.6, ny = (dx / len) * 1.6;
        pen.beginPath();
        pen.moveTo(a.p.x + nx, a.p.y + ny); pen.lineTo(b.p.x + nx, b.p.y + ny);
        pen.moveTo(a.p.x - nx, a.p.y - ny); pen.lineTo(b.p.x - nx, b.p.y - ny);
        pen.stroke();
      } else {
        pen.beginPath(); pen.moveTo(a.p.x, a.p.y);
        if (primary && branches) {
          const middle = (a.p.y + b.p.y) / 2;
          pen.bezierCurveTo(a.p.x, middle, b.p.x, middle, b.p.x, b.p.y);
        } else pen.lineTo(b.p.x, b.p.y);
        pen.stroke();
      }
      pen.setLineDash?.([]);
      pen.lineDashOffset = 0;
      if (audioLinked) drawAudioConnection(pen, a, b, tint, lifetime, time, Boolean(primary && branches));
    }

    // The managed host follows assignments and return flights. Draw one link
    // to that host instead of also retaining the original Assistant tether.
    const byId = new Map(projected.map((entry) => [entry.node.id, entry]));
    const assistant = projected.find(({ node }) => node.kind === "assistant");
    for (const { node, p } of projected) {
      if (node.kind !== "agent" || node._absorbed || (node._fade ?? 1) <= 0.02) continue;
      const hostId = state.agentLayout?.get(node.id)?.hostId ?? node.targetNode?.id ?? node.targetId ?? node.hostId;
      const target = byId.get(hostId) ?? assistant;
      if (!target || target.node._absorbed || target.node === node) continue;
      const lifetime = Math.min(node._fade ?? 1, target.node._fade ?? 1);
      if (lifetime <= 0.02) continue;
      const response = audioLinked && state.audioEffects?.splitBands === false ? node._audioResponse : null;
      const light = response ? response.level * 0.24 + response.beat * 0.12 : 0;
      // an agent's tether: dashed, and marching toward the work while it runs
      const pen = penFor({ node, p }, target);
      pen.strokeStyle = rgba(agentRgb(node.role), lifetime * ((state.nodeLayout === "tree" ? 0.18 : 0.38) + light));
      pen.lineWidth = 1 + light * 1.8;
      pen.setLineDash?.([6, 4]);
      pen.lineDashOffset = marching && (node.status === "running" || node.builder) ? -((time / 40) % 10) : 0;
      pen.beginPath(); pen.moveTo(p.x, p.y); pen.lineTo(target.p.x, target.p.y); pen.stroke();
      pen.setLineDash?.([]);
      pen.lineDashOffset = 0;
      if (audioLinked) drawAudioConnection(pen, { node, p }, target, agentRgb(node.role), lifetime, time);
    }
    // This is the audio source's visual cable, kept outside the task graph so
    // playing music cannot create a prerequisite or rearrange the layout.
    const music = audioLinked ? projected.find(({ node }) => node.kind === "music") : null;
    const hub = assistant ?? projected.find(({ node }) => node.kind === "root");
    if (music && hub && !music.node._absorbed && !hub.node._absorbed) {
      drawAudioConnection(ctx, music, hub, NODE_RGB.warm, Math.min(music.node._fade ?? 1, hub.node._fade ?? 1), time, false, true);
    }
  }

  // ---------- backdrop scenes ----------
  // Deterministic pseudo-random per (seed, index): stable across frames and
  // resizes, so nothing is stored and a still frame is exactly repeatable.
  const hash01 = (seed, index, salt = 0) => {
    const value = Math.sin(seed * 12.9898 + index * 78.233 + salt * 37.719) * 43758.5453;
    return value - Math.floor(value);
  };

  // The sky behind the constellation: the theme background, the scene the
  // theme (or the override) asked for, then the core glow and the vignette
  // every scene shares. Motion off freezes every scene at its resting pose.
  function drawBackdrop(ctx, time, still, energy, musicBands, musicBeat) {
    const width = el.width, height = el.height;
    ctx.clearRect(0, 0, width, height);
    const scene = activeBackdrop();
    const backdrop = hexToRgb(state.canvasPalette?.background ?? "#050507");
    const accent = state.canvasPalette?.accent ? hexToRgb(state.canvasPalette.accent) : NODE_RGB.warm;
    const bright = NODE_RGB.warm;
    const ink = NODE_RGB.session;
    const diagonal = Math.hypot(width, height);
    const clock = still ? 0 : time;
    const breathe = still ? 0.5 : (Math.sin(time / 14000) + 1) / 2;
    const skyTint = backdrop.map((channel, index) => Math.round(channel * 0.95 + accent[index] * 0.05));
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, rgb(skyTint));
    sky.addColorStop(0.55, rgb(backdrop));
    sky.addColorStop(1, rgb(backdrop.map((channel) => Math.round(channel * 0.97))));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);
    const nebula = (x, y, r, triple, alpha) => {
      if (alpha <= 0.002) return;
      const wash = ctx.createRadialGradient(x, y, 0, x, y, r);
      wash.addColorStop(0, rgba(triple, alpha));
      wash.addColorStop(1, rgba(triple, 0));
      ctx.fillStyle = wash;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    };
    // starfield: depth bands wheeling at a fraction of the orbit rate, so the
    // sky drifts against the constellation; sizes and tones vary, and a
    // flared band carries a small cross
    const stars = (layers) => {
      const cx = width / 2, cy = height / 2;
      for (const layer of layers) {
        const turn = state.angle * layer.spin;
        const cos = Math.cos(turn), sin = Math.sin(turn);
        for (let index = 0; index < layer.count; index += 1) {
          const seed = layer.seed + index * 127.1;
          const sx = (Math.sin(seed) * 0.5 + 0.5) * (width + 200) - 100;
          const sy = (Math.cos(seed * 1.7) * 0.5 + 0.5) * (height + 200) - 100;
          const x = cx + (sx - cx) * cos - (sy - cy) * sin;
          const y = cy + (sx - cx) * sin + (sy - cy) * cos;
          const twinkle = still ? layer.alpha * (0.35 + 0.5 * Math.abs(Math.sin(index * 1.31))) : layer.alpha * (0.3 + 0.7 * Math.abs(Math.sin(time / layer.tempo + index * 1.31)));
          ctx.globalAlpha = Math.min(1, twinkle * (0.5 + energy * 0.15 + musicBands.treble * 0.7));
          const tone = Math.sin(seed * 3.3);
          ctx.fillStyle = tone > 0.55 ? rgb(NODE_RGB.dust) : tone < -0.82 ? rgb(bright) : rgb(ink);
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
    };
    if (scene === "dust") {
      // the classic sky: two breathing nebulae, the stars, warm motes adrift
      nebula(width * 0.2, height * 0.14, diagonal * 0.4, NODE_RGB.pending, 0.03 + breathe * 0.012);
      nebula(width * 0.86, height * 0.84, diagonal * 0.34, bright, 0.03 + (1 - breathe) * 0.012);
      stars(STAR_LAYERS);
      for (let index = 0; index < 46; index += 1) {
        const span = width + 40, drop = height + 40;
        const drift = hash01(3.1, index) * span + (clock / (9000 + hash01(3.2, index) * 9000)) * 60 * (hash01(3.3, index) - 0.5);
        const rise = hash01(3.4, index) * drop - (clock / 16000) * drop * (0.15 + hash01(3.5, index) * 0.2);
        const x = ((drift % span) + span) % span - 20;
        const y = ((rise % drop) + drop) % drop - 20;
        ctx.globalAlpha = 0.08 + hash01(3.7, index) * 0.16 + energy * 0.1;
        ctx.fillStyle = rgb(bright);
        ctx.beginPath(); ctx.arc(x, y, 0.8 + hash01(3.6, index) * 1.8, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    } else if (scene === "deepspace") {
      // a faint milky band across the sky, three depths of stars, the odd meteor
      ctx.save();
      ctx.translate(width / 2, height / 2);
      ctx.rotate(-0.42);
      const band = ctx.createLinearGradient(0, -diagonal * 0.12, 0, diagonal * 0.12);
      band.addColorStop(0, rgba(ink, 0));
      band.addColorStop(0.5, rgba(ink, 0.06 + energy * 0.02));
      band.addColorStop(1, rgba(ink, 0));
      ctx.fillStyle = band;
      ctx.fillRect(-diagonal, -diagonal * 0.12, diagonal * 2, diagonal * 0.24);
      ctx.restore();
      nebula(width * 0.75, height * 0.2, diagonal * 0.3, accent, 0.045 + breathe * 0.015);
      stars([
        { count: 130, seed: 11.3, spin: 0.012, tempo: 3400, size: 0.8, alpha: 0.4 },
        { count: 50, seed: 47.7, spin: 0.03, tempo: 2500, size: 1.1, alpha: 0.52 },
        { count: 14, seed: 91.2, spin: 0.05, tempo: 1900, size: 1.6, alpha: 0.62, flare: true },
      ]);
      if (!still) {
        const bucket = Math.floor(time / 6500);
        const phase = (time % 6500) / 6500;
        if (hash01(7.7, bucket) > 0.55 && phase < 0.22) {
          const t = phase / 0.22;
          const x = hash01(7.8, bucket) * width + t * 260, y = hash01(7.9, bucket) * height * 0.5 + t * 110;
          const streak = ctx.createLinearGradient(x - 70, y - 30, x, y);
          streak.addColorStop(0, rgba(ink, 0));
          streak.addColorStop(1, rgba(ink, 0.75 * Math.sin(Math.PI * t)));
          ctx.strokeStyle = streak; ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.moveTo(x - 70, y - 30); ctx.lineTo(x, y); ctx.stroke();
        }
      }
    } else if (scene === "nebula") {
      // billowing clouds in the theme's own hues, drifting on a long cycle
      for (let index = 0; index < 7; index += 1) {
        const x = (0.12 + hash01(5.1, index) * 0.76) * width + Math.sin(clock / (23000 + index * 3100) + index) * 40;
        const y = (0.1 + hash01(5.2, index) * 0.8) * height + Math.cos(clock / (27000 + index * 2300) + index * 2) * 30;
        const r = diagonal * (0.16 + hash01(5.3, index) * 0.18);
        const mix = hash01(5.4, index);
        nebula(x, y, r, mix < 0.4 ? accent : mix < 0.7 ? bright : NODE_RGB.dust, 0.045 + hash01(5.5, index) * 0.035 + energy * 0.02 + (index === 0 ? musicBands.bass * 0.03 : 0));
      }
      stars([{ count: 60, seed: 11.3, spin: 0.012, tempo: 3400, size: 0.7, alpha: 0.2 }, { count: 20, seed: 47.7, spin: 0.03, tempo: 2500, size: 1, alpha: 0.28 }]);
    } else if (scene === "aurora") {
      // curtains across the upper sky: each ribbon is three stacked bands, the
      // tallest the faintest, so the light gathers along its upper edge
      stars([{ count: 60, seed: 11.3, spin: 0.012, tempo: 3400, size: 0.7, alpha: 0.2 }]);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const ribbons = [
        { base: 0.16, amp: 26, speed: 9000, k: 0.006, triple: accent, alpha: 0.05 },
        { base: 0.24, amp: 34, speed: 12500, k: 0.0045, triple: NODE_RGB.done, alpha: 0.035 },
        { base: 0.11, amp: 20, speed: 7200, k: 0.008, triple: NODE_RGB.dust, alpha: 0.03 },
      ];
      const step = 28;
      for (const [rIndex, ribbon] of ribbons.entries()) {
        const tops = [];
        for (let x = -step; x <= width + step; x += step) {
          const wave = Math.sin(x * ribbon.k + clock / ribbon.speed + rIndex * 1.7) * ribbon.amp + Math.sin(x * ribbon.k * 2.3 - clock / (ribbon.speed * 0.7)) * ribbon.amp * 0.35;
          const tall = 70 + Math.sin(x * ribbon.k * 1.6 + clock / (ribbon.speed * 1.3)) * 28 + energy * 40 + musicBands.mid * 30;
          tops.push({ x, top: height * ribbon.base + wave, tall });
        }
        for (const depth of [1, 0.6, 0.3]) {
          ctx.beginPath();
          tops.forEach((point, index) => index ? ctx.lineTo(point.x, point.top) : ctx.moveTo(point.x, point.top));
          for (let index = tops.length - 1; index >= 0; index -= 1) ctx.lineTo(tops[index].x, tops[index].top + tops[index].tall * depth);
          ctx.closePath();
          ctx.fillStyle = rgba(ribbon.triple, ribbon.alpha * (0.7 + 0.3 * breathe));
          ctx.fill();
        }
      }
      ctx.restore();
    } else if (scene === "embers") {
      // heat below, embers rising through it and cooling as they climb
      const heat = ctx.createLinearGradient(0, height * 0.55, 0, height);
      heat.addColorStop(0, rgba(accent, 0));
      heat.addColorStop(1, rgba(accent, 0.16 + energy * 0.08 + musicBands.bass * 0.08));
      ctx.fillStyle = heat;
      ctx.fillRect(0, height * 0.55, width, height * 0.45);
      nebula(width * 0.5, height * 1.05, diagonal * 0.4, bright, 0.06 + breathe * 0.02);
      for (let index = 0; index < 64; index += 1) {
        const speed = 14000 + hash01(6.1, index) * 16000;
        const life = ((clock / speed + hash01(6.2, index)) % 1 + 1) % 1;
        const x = hash01(6.3, index) * width + Math.sin(clock / 2600 + index) * 14 * life;
        const y = height + 10 - life * (height + 20);
        const glow = (1 - life * 0.7) * (0.6 + 0.4 * Math.abs(Math.sin(clock / 300 + index)));
        ctx.globalAlpha = Math.max(0, Math.min(1, glow));
        ctx.fillStyle = life < 0.5 ? rgb(bright) : rgb(accent);
        ctx.beginPath(); ctx.arc(x, y, 1.1 + hash01(6.4, index) * 1.9, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      stars([{ count: 26, seed: 11.3, spin: 0.012, tempo: 3400, size: 0.7, alpha: 0.14 }]);
    } else if (scene === "fireflies") {
      // mist in two slow bands, fireflies blinking in and out above it
      for (const [index, band] of [{ y: 0.62, h: 0.22, alpha: 0.05 }, { y: 0.8, h: 0.26, alpha: 0.07 }].entries()) {
        const drift = Math.sin(clock / (19000 + index * 5000)) * 30;
        const mist = ctx.createLinearGradient(0, height * band.y + drift, 0, height * (band.y + band.h) + drift);
        mist.addColorStop(0, rgba(NODE_RGB.done, 0));
        mist.addColorStop(0.5, rgba(NODE_RGB.done, band.alpha));
        mist.addColorStop(1, rgba(NODE_RGB.done, 0));
        ctx.fillStyle = mist;
        ctx.fillRect(0, height * band.y + drift - 10, width, height * band.h + 20);
      }
      nebula(width * 0.3, height * 0.1, diagonal * 0.3, accent, 0.03);
      stars([{ count: 30, seed: 11.3, spin: 0.012, tempo: 3400, size: 0.7, alpha: 0.16 }]);
      for (let index = 0; index < 34; index += 1) {
        const blink = still ? 0.6 : Math.max(0, Math.sin(clock / (1300 + hash01(4.1, index) * 1800) + hash01(4.2, index) * 6.28));
        if (blink < 0.15) continue;
        const x = hash01(4.3, index) * width + Math.sin(clock / (5000 + hash01(4.4, index) * 4000) + index) * 24;
        const y = height * (0.3 + hash01(4.5, index) * 0.65) + Math.cos(clock / (6000 + hash01(4.6, index) * 5000) + index * 1.3) * 18;
        const size = 1.4 + blink * 1.6;
        const glow = ctx.createRadialGradient(x, y, 0, x, y, size * 4);
        glow.addColorStop(0, rgba(NODE_RGB.live, blink * 0.55));
        glow.addColorStop(1, rgba(NODE_RGB.live, 0));
        ctx.fillStyle = glow;
        ctx.fillRect(x - size * 4, y - size * 4, size * 8, size * 8);
        ctx.globalAlpha = Math.pow(blink, 1.5);
        ctx.fillStyle = "#e8ffd0";
        ctx.beginPath(); ctx.arc(x, y, size * 0.6, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }
    } else if (scene === "bokeh") {
      // soft discs of light drifting slowly, the bigger ones further out of focus
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let index = 0; index < 22; index += 1) {
        const r = 18 + hash01(8.1, index) * 70;
        const x = hash01(8.2, index) * width + Math.sin(clock / (17000 + hash01(8.3, index) * 12000) + index) * 36;
        const y = hash01(8.4, index) * height + Math.cos(clock / (21000 + hash01(8.5, index) * 9000) + index * 0.7) * 28;
        const mix = hash01(8.6, index);
        const triple = mix < 0.5 ? accent : mix < 0.8 ? bright : ink;
        const alpha = (0.035 + hash01(8.7, index) * 0.05) * (0.8 + 0.2 * breathe) + energy * 0.02;
        const disc = ctx.createRadialGradient(x, y, r * 0.55, x, y, r);
        disc.addColorStop(0, rgba(triple, alpha));
        disc.addColorStop(0.85, rgba(triple, alpha * 0.8));
        disc.addColorStop(1, rgba(triple, 0));
        ctx.fillStyle = disc;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      ctx.restore();
      stars([{ count: 24, seed: 11.3, spin: 0.012, tempo: 3400, size: 0.7, alpha: 0.12 }]);
    } else if (scene === "grid") {
      // a quiet drafting grid that drifts with the orbit, brighter in the middle
      const step = 48;
      const shift = ((state.angle * 140) % step + step) % step;
      ctx.save();
      const fade = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, diagonal * 0.55);
      fade.addColorStop(0, rgba(accent, 0.09 + energy * 0.04));
      fade.addColorStop(1, rgba(accent, 0.015));
      ctx.strokeStyle = fade; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = -step + shift; x <= width + step; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, height); }
      for (let y = -step + shift * 0.6; y <= height + step; y += step) { ctx.moveTo(0, y); ctx.lineTo(width, y); }
      ctx.stroke();
      ctx.restore();
      nebula(width / 2, height / 2, diagonal * 0.3, accent, 0.03 + breathe * 0.01);
    } else {
      // minimal: the sky, one soft wash, the vignette
      nebula(width * 0.5, height * 0.5, diagonal * 0.35, accent, 0.02);
    }
    // a soft ember where the constellation's mass sits — the world origin is
    // projected so the glow pans and zooms with the graph, not the window
    const core = project({ x: 0, y: -10, z: 0 });
    const coreR = diagonal * 0.42;
    const coreGlow = ctx.createRadialGradient(core.x, core.y, 0, core.x, core.y, coreR);
    coreGlow.addColorStop(0, rgba(bright, (scene === "minimal" ? 0.015 : 0.025) + energy * 0.015 + musicBands.bass * 0.03 + musicBeat * 0.02));
    coreGlow.addColorStop(0.45, rgba(bright, 0.015));
    coreGlow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = coreGlow;
    ctx.fillRect(core.x - coreR, core.y - coreR, coreR * 2, coreR * 2);
    // vignette: the constellation sits in the middle of the frame, the edges fall away
    const outer = diagonal / 2;
    const vignette = ctx.createRadialGradient(width / 2, height / 2, outer * 0.45, width / 2, height / 2, outer);
    vignette.addColorStop(0, rgba(backdrop, 0));
    vignette.addColorStop(1, rgba(backdrop, 0.55));
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
  }

  // ---------- callouts: leader, top bar, title row, thought bubble ----------
  // Every session, task, the hub and each working agent carries a callout: a
  // leader leaving the orb at CALLOUT_ANGLE, a horizontal top bar, the short
  // title with its number and done/left counts above the bar, and below it a
  // bubble with what the agents think or do there. Placement is chosen among
  // a few fixed candidates (side × up/down × length) that keep the leader and
  // the card clear of other orbs, cards and the HUD, and the choice is kept
  // from frame to frame so the tree can orbit without the cards wandering.
  const CALLOUT_KINDS = new Set(["session", "task", "task-group", "assistant", "agent", "root", "folded"]);
  // Equal-priority cards keep their locale order; one collator is far cheaper
  // than String#localeCompare, which builds one per call.
  const idCollator = typeof Intl !== "undefined" && Intl.Collator ? new Intl.Collator() : { compare: (a, b) => a.localeCompare(b) };

  function calloutCandidates(previous) {
    const list = [];
    if (previous) list.push({ side: previous.side, vert: previous.vert, length: previous.length });
    for (const length of CALLOUT_LENGTHS) {
      for (const [side, vert] of [[1, -1], [-1, -1], [1, 1], [-1, 1]]) {
        if (previous && previous.side === side && previous.vert === vert && previous.length === length) continue;
        list.push({ side, vert, length });
      }
    }
    return list;
  }

  // The card's words: number, title, mark, counts and up to two bubble lines.
  function calloutContent(node, { rich = false } = {}) {
    const speech = state.speech?.get(node.id) ?? null;
    const lines = [];
    let mark = "dot";
    let counts = null;
    let title = String(node.label ?? node.kind ?? "").trim();
    let number = node.ordinal ?? null;
    const workers = state.nodes.filter((entry) => entry.kind === "agent" && !entry.dying && !entry._absorbed && entry !== node && (entry.targetNode?.id === node.id || entry.hostId === node.id || entry.targetId === node.id));
    if (node.kind === "session") {
      const todos = todosOf(node.id);
      const done = todos.filter((todo) => todo.state === "done").length;
      counts = todos.length ? `${done} done · ${todos.length - done} left` : node.stale ? "stale" : null;
      mark = todos.length && done === todos.length ? "check" : node.state === "active" ? "live" : "dot";
    } else if (node.kind === "task" || node.kind === "task-group") {
      const task = node.task ?? {};
      const members = node.taskGroup?.members ?? null;
      if (members?.length) {
        const done = members.filter((member) => ["done", "archived", "absorbed"].includes(member.status)).length;
        counts = `${done} done · ${members.length - done} left`;
      } else if (typeof node.progress === "number" && Number.isFinite(node.progress)) counts = `${Math.round(node.progress * 100)}%`;
      else counts = node._workLabel === "Verifying" ? "verifying" : node._workLabel === "Next" ? "up next" : node._workLabel === "Running" ? "running" : task.status === "done" ? "done" : null;
      mark = task.status === "done" ? "check" : task.status === "awaiting_verification" || node._workLabel === "Verifying" ? "verify" : node._workLabel === "Running" || node.state === "active" ? "live" : "dot";
    } else if (node.kind === "assistant") {
      title = "Assistant";
      number = null;
      const running = Number(state.assistant?.rosterRunning) || 0;
      const queued = Number(state.assistant?.rosterQueued) || 0;
      counts = running || queued ? `${running} working · ${queued} queued` : null;
      mark = "hub";
    } else if (node.kind === "agent") {
      title = node.builder ? "Builder" : String(node.role ?? "agent");
      number = null;
      if (node.builder && node.startedAt) {
        const seconds = Math.max(0, Math.round((Date.now() - node.startedAt) / 1000));
        counts = seconds < 90 ? `${seconds}s` : `${Math.round(seconds / 60)}m`;
      } else if (typeof node.progress === "number" && Number.isFinite(node.progress)) counts = `${Math.round(node.progress * 100)}%`;
      mark = node.status === "error" ? "error" : node.status === "done" ? "check" : node.status === "running" || node.builder ? "live" : "dot";
    } else if (node.kind === "root") {
      title = "Sessions";
      number = null;
      counts = `${state.nodes.filter((entry) => entry.kind === "session").length} sessions`;
    } else if (node.kind === "folded") {
      number = null;
      counts = `${node.count ?? 0} finished`;
      mark = "check";
    }
    if (speech) lines.push({ text: speech.text, kind: speech.kind });
    else if (workers.length) {
      // The agents here speak through this card: the freshest remark wins.
      const spoken = workers.map((worker) => ({ worker, bubble: state.speech?.get(worker.id) ?? null })).sort((a, b) => (b.bubble?.at ?? 0) - (a.bubble?.at ?? 0))[0];
      const { worker, bubble } = spoken;
      const name = worker.builder ? "builder" : worker.role;
      if (bubble) lines.push({ text: `${name} · ${bubble.text}`, kind: bubble.kind });
      else lines.push({ text: `${name} · ${agentRemark(worker.text, worker.role) || "working here"}`, kind: "say" });
    }
    else if (node.kind === "agent") {
      const remark = agentRemark(node.status === "error" && node.error ? node.error : node.text, node.role);
      if (remark) lines.push({ text: remark, kind: node.status === "error" ? "error" : "say" });
      const target = node.targetNode?.label ?? node.targetLabel;
      if (target && (node.status === "running" || node.builder)) lines.push({ text: `at "${String(target).slice(0, 40)}"`, kind: "muted" });
    } else if (rich && node.kind === "assistant") {
      // Quiet detail (the hub's summary, a task's prompt, a session's model
      // and age) only on the card you hover, select or focus: at rest a
      // card without live thoughts is just its title bar.
      const sub = window.MefiTree?.assistantSummary?.()?.sublabel;
      if (sub) lines.push({ text: String(sub), kind: "muted" });
    } else if (rich && node.kind === "task" && node.task?.prompt) lines.push({ text: String(node.task.prompt).replace(/\s+/g, " ").slice(0, 90), kind: "muted" });
    else if (rich && node.kind === "session") {
      const meta = [node.agent, node.model].filter(Boolean).join(" ");
      const when = node.updated ? agoLabel(node.updated) : null;
      const text = [meta, when].filter(Boolean).join(" · ");
      if (text) lines.push({ text, kind: "muted" });
    }
    return { number, title, mark, counts, lines: lines.slice(0, 2) };
  }

  function clipLine(ctx, font, text, maxWidth) {
    let value = String(text ?? "").replace(/\s+/g, " ").trim();
    if (measure(ctx, font, value) <= maxWidth) return value;
    while (value.length > 1 && measure(ctx, font, `${value}…`) > maxWidth) value = value.slice(0, -1);
    return `${value.trimEnd()}…`;
  }

  // The card's measurements: its width from the title row, the title clipped
  // to what is left beside the number, the status line (the counts) under
  // it on its own row so a long title is not squeezed by "2 done · 1 left",
  // the bubble lines wrapped (one remark may take two lines; two remarks
  // take one each).
  function calloutSize(ctx, content) {
    const numberW = content.number ? measure(ctx, CALLOUT_NUMBER_FONT, content.number) + 13 : 0;
    const countsW = content.counts ? measure(ctx, CALLOUT_COUNTS_FONT, content.counts) + 28 : 0;
    const fullTitle = measure(ctx, CALLOUT_TITLE_FONT, content.title);
    const w = Math.max(CALLOUT_MIN_W, countsW, Math.min(CALLOUT_MAX_W, 22 + numberW + fullTitle + 8));
    const title = clipLine(ctx, CALLOUT_TITLE_FONT, content.title, Math.max(30, w - 22 - numberW - 8));
    const subH = content.counts ? CALLOUT_SUB_H : 0;
    let lines = [];
    if (content.lines.length === 1) lines = speechLines(ctx, content.lines[0].text, w - 22 - (SPEECH_MARKS[content.lines[0].kind] ? 13 : 0)).map((text, index) => ({ text, kind: index === 0 ? content.lines[0].kind : "cont" }));
    else lines = content.lines.map((line) => ({ text: clipLine(ctx, CALLOUT_LINE_FONT, line.text, w - 22 - (SPEECH_MARKS[line.kind] ? 13 : 0)), kind: line.kind }));
    const bubbleH = lines.length ? 9 + lines.length * CALLOUT_LINE_H : 0;
    return { w, title, lines, subH, bubbleH };
  }

  // Distance from a point to a segment, for routing leaders around orbs.
  function segmentDistance(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
  }

  function segmentHitsRect(ax, ay, bx, by, rect) {
    for (let step = 0; step <= 8; step += 1) {
      const t = step / 8, x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
      if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) return true;
    }
    return false;
  }

  // Where one candidate puts the leader, the bar and the card, in screen space.
  function calloutLayout(node, p, candidate, size) {
    const r = (node._pr ?? 6) + 3;
    const sx = p.x + candidate.side * CALLOUT_COS * r;
    const sy = p.y + candidate.vert * CALLOUT_SIN * r;
    const ex = p.x + candidate.side * CALLOUT_COS * (r + candidate.length);
    const ey = p.y + candidate.vert * CALLOUT_SIN * (r + candidate.length);
    const x = candidate.side > 0 ? ex : ex - size.w;
    // The plate: the title row, then the status line when there is one, its
    // bottom edge on the bar.
    const plateH = CALLOUT_TITLE_H + 3 + (size.subH ?? 0);
    const top = ey - plateH;
    const h = plateH + (size.bubbleH ? size.bubbleH + 4 : 2);
    return {
      side: candidate.side, vert: candidate.vert, length: candidate.length,
      sx, sy, ex, ey, w: size.w, plateH,
      rect: { x, y: top, w: size.w, h },
      bubble: size.bubbleH ? { x, y: ey + 4, w: size.w, h: size.bubbleH } : null,
    };
  }

  // How much a candidate collides: 0 is clean. Hard faults (off the viewport,
  // under the HUD, on another card, over an orb) score CALLOUT_HARD or more;
  // a leader crossing an orb or another card is a soft fault a card may live
  // with when nothing cleaner exists.
  const CALLOUT_HARD = 5;
  function calloutPenalty(node, layout, projected, placedRects, hud, hitsNode, area) {
    const { rect } = layout;
    let score = 0;
    if (rect.x < area.x + 6 || rect.y < area.y + 6 || rect.x + rect.w > area.x + area.w - 6 || rect.y + rect.h > area.y + area.h - 6) score += 10;
    if (blocked(rect, hud)) score += 8;
    for (const other of placedRects) if (overlaps(rect, other)) score += 6;
    if (hitsNode(rect, node)) score += CALLOUT_HARD;
    if (typeof hitsNode.leaderHitsNode === "function") {
      if (hitsNode.leaderHitsNode(layout.sx, layout.sy, layout.ex, layout.ey, node)) score += 2;
    } else {
      for (const other of projected) {
        if (other.node === node || other.node._absorbed || other.node.dying || other.p?.x == null) continue;
        if (segmentDistance(other.p.x, other.p.y, layout.sx, layout.sy, layout.ex, layout.ey) < (other.node._pr ?? 4) + 5) { score += 2; break; }
      }
    }
    for (const other of placedRects) if (segmentHitsRect(layout.sx, layout.sy, layout.ex, layout.ey, other)) { score += 2; break; }
    return score;
  }

  // Pick this node's placement: the previous one while it is still clean,
  // else the first clean candidate, else the least soft-faulted one, else
  // hold the previous spot for a beat (a turning tree usually clears it
  // again), else — only for the card the user is on — the least-bad spot.
  function placeCallout(node, p, size, projected, placedRects, hud, hitsNode, area, now, allowDirty = false) {
    const previous = state.callouts.get(node.id) ?? null;
    // While the camera is in flight (a click closing in, a search hit) a card
    // keeps the spot it had: re-deciding every frame against neighbours that
    // are still moving made the cards hop. Placement resumes once the camera
    // settles, with a fresh hold for whatever ended up blocked.
    if (previous && state.cameraMoving) {
      state.callouts.set(node.id, { ...previous, blockedSince: null, at: now });
      return calloutLayout(node, p, previous, size);
    }
    let chosen = null, soft = null, softScore = Infinity, fallback = null, fallbackScore = Infinity;
    for (const candidate of calloutCandidates(previous)) {
      const layout = calloutLayout(node, p, candidate, size);
      const score = calloutPenalty(node, layout, projected, placedRects, hud, hitsNode, area);
      if (score === 0) { chosen = layout; break; }
      if (score < CALLOUT_HARD && score < softScore) { softScore = score; soft = layout; }
      if (score < fallbackScore) { fallbackScore = score; fallback = layout; }
    }
    if (!chosen && soft) chosen = soft;
    if (chosen) {
      state.callouts.set(node.id, { side: chosen.side, vert: chosen.vert, length: chosen.length, blockedSince: null, at: now });
      return chosen;
    }
    // Nothing clean. Hold the previous spot for a beat; after that the card
    // steps aside (its node keeps a compact label) unless it is the one the
    // user is on, which may take the least-bad spot rather than vanish.
    const blockedSince = previous?.blockedSince ?? now;
    const held = previous && now - blockedSince < CALLOUT_HOLD_MS;
    const layout = held ? calloutLayout(node, p, previous, size) : allowDirty ? fallback : null;
    if (previous) previous.blockedSince = blockedSince;
    if (!layout) return null;
    state.callouts.set(node.id, { side: layout.side, vert: layout.vert, length: layout.length, blockedSince, at: now });
    return layout;
  }

  // An agent on a node that carries its own card speaks through that card;
  // it gets neither a card nor a floating bubble of its own.
  function hostedOnCard(node) {
    if (node.kind !== "agent") return false;
    const at = node.targetNode ?? (node.hostId ? state.nodes.find((entry) => entry.id === node.hostId) : null);
    return Boolean(at && CALLOUT_KINDS.has(at.kind) && at.kind !== "agent");
  }

  // Is an agent on this node right now (flying to it, hovering it, building it)?
  function agentOn(node) {
    return state.nodes.some((entry) => entry.kind === "agent" && !entry.dying && !entry._absorbed && entry !== node && (entry.targetNode?.id === node.id || entry.hostId === node.id));
  }

  // Placement order: the card the user is on, the focused branch, the hub,
  // then whatever has work on it (a running task, a node an agent is at) —
  // they pick their spots first, so a crowd costs the quiet cards, not them.
  // The nodes an agent is on right now, as one set per pass: the placement
  // sort asks this for every card it compares, and a scan of every node per
  // comparison made the sort quadratic in the size of the constellation.
  function agentHostIds(nodes) {
    const ids = new Set();
    for (const entry of nodes) {
      if (entry.kind !== "agent" || entry.dying || entry._absorbed) continue;
      if (entry.targetNode?.id != null) ids.add(entry.targetNode.id);
      if (entry.hostId != null) ids.add(entry.hostId);
    }
    return ids;
  }

  function calloutPriority(node, focusIds, hosted = null) {
    if (state.hoverCallout === node.id || state.hoverNode === node || state.selected?.id === node.id) return 0;
    if (focusIds?.has(node.id)) return 1;
    if (node.kind === "assistant") return 2;
    if ((node.kind === "task" || node.kind === "task-group") && node._workLabel === "Running") return 2.2;
    if (node.kind !== "agent" && (hosted ? hosted.has(node.id) : agentOn(node))) return 2.3;
    if (node.kind === "agent" && (node.status === "running" || node.builder)) return 2.5;
    // Verifying is waiting, not work: a burst of finished runs used to fill
    // the card budget with "verifying" cards ahead of the sessions being
    // read. They rank behind live sessions now and stay one hover away.
    if ((node.kind === "task" || node.kind === "task-group") && node._workLabel === "Verifying") return 3.4;
    if ((node.kind === "task" || node.kind === "task-group") && (node._workLabel || node.state === "active")) return 2.6;
    if (node.kind === "session") return node.stale ? 5 : 3;
    if (node.kind === "task" || node.kind === "task-group") return 4;
    if (node.kind === "root" || node.kind === "folded") return 6;
    return 7;
  }

  function drawCallouts(projected, { near, far = near, focusIds = null, dt = 0 } = {}) {
    state.calloutRects = [];
    for (const { node } of projected) { node._callout = null; node._cardRect = null; }
    if (state.labels === "none" || !near) return;
    const still = noMotion();
    const now = Date.now();
    const area = usableArea();
    const hud = hudRects();
    const hitsNode = nodeLabelBlocker(projected);
    const hosted = agentHostIds(state.nodes);
    // Only an agent working somewhere without a card (a todo, the open ring)
    // gets a card of its own; the rest speak through their host's card.
    const wanted = projected
      .filter(({ node, p }) => CALLOUT_KINDS.has(node.kind) && !node.dying && !node._absorbed && node._px != null && (node._fade ?? 1) > 0.02 && (node.kind !== "agent" || ((node.status === "running" || node.builder) && !hostedOnCard(node))))
      .filter(({ node, p }) => p.k >= 0.55 || state.hoverCallout === node.id || state.selected?.id === node.id)
      .map((entry) => ({ entry, priority: calloutPriority(entry.node, focusIds, hosted), id: String(entry.node.id) }))
      .sort((a, b) => a.priority - b.priority || idCollator.compare(a.id, b.id))
      .map(({ entry }) => entry);
    const placedRects = [];
    let drawn = 0;
    for (const { node, p } of wanted) {
      if (drawn >= CALLOUT_BUDGET && state.hoverCallout !== node.id && state.selected?.id !== node.id) break;
      // The card the user is on (hover, selection, focus) gets the detail
      // lines and may take a crowded spot; every other card stays clean or
      // steps aside to a compact label (work in progress was placed first,
      // so it is the quiet cards that step aside).
      const important = state.hoverCallout === node.id || state.selected?.id === node.id || Boolean(focusIds?.has(node.id));
      const content = calloutContent(node, { rich: important });
      const size = calloutSize(near, content);
      const layout = placeCallout(node, p, size, projected, placedRects, hud, hitsNode, area, now, important);
      if (!layout) continue;
      const dimmed = focusIds ? !focusIds.has(node.id) : false;
      const lifted = state.hoverCallout === node.id;
      // The card's lift eases like the orb's (about 90 ms in, 160 ms out);
      // with no frame time, or reduced motion, it lands at once.
      const lifts = (state.cardLift ??= new Map());
      const want = lifted ? 1 : 0;
      const from = lifts.get(node.id) ?? 0;
      let lift = want;
      if (!still && dt > 0) {
        lift = from + (want - from) * (1 - Math.exp(-dt / (want > from ? 0.09 : 0.16)));
        if (Math.abs(lift - want) < 0.01) lift = want;
      }
      if (lift > 0) lifts.set(node.id, lift); else lifts.delete(node.id);
      drawCallout(dimmed && far !== near ? far : near, node, layout, content, size, { lifted, lift, dimmed, still });
      const hit = { x: Math.min(layout.rect.x, layout.sx) - 8, y: Math.min(layout.rect.y, layout.sy) - 8 };
      hit.w = Math.max(layout.rect.x + layout.rect.w, layout.sx) + 8 - hit.x;
      hit.h = Math.max(layout.rect.y + layout.rect.h, layout.sy) + 8 - hit.y;
      node._callout = { ...layout, hit, content };
      node._cardRect = { ...layout.rect };
      placedRects.push({ x: layout.rect.x - 4, y: layout.rect.y - 4, w: layout.rect.w + 8, h: layout.rect.h + 8 });
      drawn += 1;
    }
    state.calloutRects = placedRects;
    if (state.callouts.size > 80) for (const id of [...state.callouts.keys()]) if (!state.nodes.some((entry) => entry.id === id)) state.callouts.delete(id);
  }

  function drawCalloutMark(ctx, mark, x, y, tint) {
    ctx.save();
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (mark === "check") { ctx.strokeStyle = rgb(NODE_RGB.done); ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(x - 4, y); ctx.lineTo(x - 1, y + 3); ctx.lineTo(x + 4, y - 3); ctx.stroke(); }
    else if (mark === "verify") { ctx.strokeStyle = rgb(NODE_RGB.verify); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x - 2.5, y); ctx.lineTo(x - 0.5, y + 2); ctx.lineTo(x + 2.8, y - 2); ctx.stroke(); }
    else if (mark === "error") { ctx.strokeStyle = rgb(NODE_RGB.amber); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = rgb(NODE_RGB.amber); ctx.fillRect(x - 0.7, y - 2.5, 1.4, 3); ctx.fillRect(x - 0.7, y + 1.3, 1.4, 1.4); }
    else if (mark === "live") { ctx.fillStyle = rgba(tint, 0.95); ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = rgba(tint, 0.45); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, 5.2, 0, Math.PI * 2); ctx.stroke(); }
    else if (mark === "hub") { ctx.strokeStyle = rgba(tint, 0.95); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = rgba(tint, 0.95); ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill(); }
    else { ctx.fillStyle = rgba(tint, 0.75); ctx.beginPath(); ctx.arc(x, y, 2.6, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }

  // One card: a tab-shaped plate (rounded top, paper backdrop) whose bottom
  // edge is the bar in the node's own style (double for the hub, dashed for
  // an agent, a square cap for a task), the leader and its rim dot from the
  // bar's near corner to the orb, the title row on the plate with the status
  // line under it, the bubble hanging below. Hover lifts the card a touch and
  // glows it; outside a focused branch it paints dimmer (and on the blurred
  // layer).
  function drawCallout(ctx, node, layout, content, size, { lifted = false, lift = lifted ? 1 : 0, dimmed = false, still = true } = {}) {
    const tint = node.kind === "agent" ? agentRgb(node.role) : colorOf(node);
    const selected = state.selected?.id === node.id;
    const styleChoice = state.cardStyle === "auto" ? (lifted || selected || content.mark === "live" ? "filled" : "outline") : state.cardStyle;
    // At rest a card sits back a little; the one the user is on comes forward,
    // easing with the hover (lift) rather than switching in one frame.
    const forwardMix = selected ? 1 : Math.max(0, Math.min(1, lift));
    const baseFilled = state.cardStyle === "auto" ? selected || content.mark === "live" : state.cardStyle === "filled";
    const fillMix = baseFilled ? 1 : state.cardStyle === "auto" ? forwardMix : 0;
    const alpha = (node._fade ?? 1) * (dimmed ? 0.5 : 0.86 + 0.14 * forwardMix) * Math.max(0.4, emphasis(node));
    const paper = state.canvasPalette?.background ?? "#101620";
    const { sx, sy, ex, ey, side, rect, bubble, w } = layout;
    const plateH = layout.plateH ?? CALLOUT_TITLE_H + 3 + (size.subH ?? 0);
    const filled = styleChoice === "filled";
    ctx.save();
    ctx.globalAlpha = alpha;
    if (lift > 0.001 && !still) {
      const s = 1 + 0.06 * lift;
      ctx.translate(ex, ey); ctx.scale(s, s); ctx.translate(-ex, -ey);
      ctx.shadowColor = rgba(tint, 0.35 * lift); ctx.shadowBlur = 14 * lift;
    }
    // The plate: paper first so the sky never shows through the words, then
    // a wash of the node's tint, then a hairline in it.
    const plate = () => { ctx.beginPath(); ctx.roundRect(rect.x, rect.y, w, plateH, [7, 7, 0, 0]); };
    plate();
    ctx.fillStyle = paper; ctx.globalAlpha = alpha * (0.78 + 0.16 * fillMix); ctx.fill(); ctx.globalAlpha = alpha;
    ctx.fillStyle = rgba(tint, 0.06 + 0.08 * fillMix); ctx.fill();
    ctx.shadowBlur = 0;
    plate();
    ctx.strokeStyle = rgba(tint, Math.max(0.32 + 0.13 * fillMix, 0.6 * forwardMix)); ctx.lineWidth = 1; ctx.stroke();
    // The leader from the bar's near corner down to the orb, with its rim dot.
    ctx.strokeStyle = rgba(tint, 0.55 + 0.25 * forwardMix); ctx.lineWidth = 1; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.fillStyle = rgba(tint, 0.9); ctx.beginPath(); ctx.arc(sx, sy, 1.8, 0, Math.PI * 2); ctx.fill();
    // The bar along the plate's bottom edge.
    const barEnd = ex + side * w;
    ctx.lineWidth = 1.5 + 0.5 * forwardMix;
    ctx.strokeStyle = rgba(tint, 0.75 + 0.2 * forwardMix);
    if (node.kind === "assistant") {
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(ex, ey - 1.5); ctx.lineTo(barEnd, ey - 1.5); ctx.moveTo(ex, ey + 1.5); ctx.lineTo(barEnd, ey + 1.5); ctx.stroke();
    } else {
      if (node.kind === "agent") ctx.setLineDash([5, 3]);
      ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(barEnd, ey); ctx.stroke();
      ctx.setLineDash([]);
      if (node.kind === "task" || node.kind === "task-group") { ctx.fillStyle = rgba(tint, 0.95); ctx.fillRect(barEnd - (side > 0 ? 3.5 : 0), ey - 2, 3.5, 4); }
    }
    // The title row: mark, number chip, title.
    let x = rect.x + 6;
    const baseline = rect.y + 14;
    drawCalloutMark(ctx, content.mark, x + 5, baseline - 4, tint);
    x += 15;
    if (content.number) {
      ctx.font = CALLOUT_NUMBER_FONT;
      const nw = ctx.measureText(content.number).width + 8;
      ctx.beginPath(); ctx.roundRect(x, baseline - 10.5, nw, 13, 3.5); ctx.fillStyle = rgba(tint, filled ? 0.28 : 0.2); ctx.fill();
      ctx.fillStyle = rgba(tint, 1); ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.fillText(content.number, x + 4, baseline - 0.5);
      x += nw + 5;
    }
    ctx.font = CALLOUT_TITLE_FONT; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.fillStyle = rgba(NODE_RGB.session, 0.96);
    ctx.fillText(size.title, x, baseline);
    // The status line under the title, in the colour of what it says.
    if (content.counts && size.subH) {
      const statusRgb = content.mark === "error" ? NODE_RGB.amber : content.mark === "verify" ? NODE_RGB.verify : content.mark === "check" ? NODE_RGB.done : content.mark === "live" ? tint : NODE_RGB.pending;
      ctx.font = CALLOUT_COUNTS_FONT; ctx.textAlign = "left";
      ctx.fillStyle = rgba(statusRgb, content.mark === "dot" ? 0.95 : 0.85);
      ctx.fillText(content.counts, rect.x + 21, baseline + CALLOUT_SUB_H);
    }
    if (bubble && size.lines.length) {
      ctx.beginPath(); ctx.roundRect(bubble.x, bubble.y, bubble.w, bubble.h, 7);
      if (filled) {
        ctx.fillStyle = paper; ctx.globalAlpha = alpha * 0.92; ctx.fill(); ctx.globalAlpha = alpha;
        ctx.fillStyle = rgba(tint, 0.12); ctx.fill();
        ctx.strokeStyle = rgba(tint, 0.8);
      } else {
        ctx.fillStyle = paper; ctx.globalAlpha = alpha * 0.6; ctx.fill(); ctx.globalAlpha = alpha;
        ctx.strokeStyle = rgba(tint, 0.5);
      }
      ctx.lineWidth = 1;
      if (size.lines.some((line) => line.kind === "think")) ctx.setLineDash([3, 3]);
      ctx.stroke(); ctx.setLineDash([]);
      let ly = bubble.y + 14;
      for (const line of size.lines) {
        let tx = bubble.x + 9;
        const marker = SPEECH_MARKS[line.kind];
        if (marker) { marker(ctx, tx + 4, ly - 4, line.kind === "error" ? rgb(NODE_RGB.amber) : line.kind === "done" ? rgb(NODE_RGB.done) : rgb(tint)); tx += 13; }
        ctx.font = CALLOUT_LINE_FONT; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
        ctx.fillStyle = line.kind === "muted" ? rgba(NODE_RGB.pending, 0.95) : line.kind === "error" ? rgba(NODE_RGB.amber, 0.95) : rgba(NODE_RGB.session, 0.92);
        ctx.fillText(line.text, tx, ly);
        ly += CALLOUT_LINE_H;
      }
    }
    ctx.restore();
  }

  // The card itself (a little padded) or a point within a few pixels of its
  // leader; when cards sit close together the smaller card under the
  // pointer wins, and a card beats a leader.
  function calloutAt(x, y) {
    let best = null, bestArea = Infinity;
    for (const node of state.nodes) {
      const layout = node._callout;
      if (!layout) continue;
      const { rect } = layout;
      const inside = x >= rect.x - 4 && x <= rect.x + rect.w + 4 && y >= rect.y - 4 && y <= rect.y + rect.h + 4;
      const onLeader = !inside && segmentDistance(x, y, layout.sx, layout.sy, layout.ex, layout.ey) <= 6;
      if (!inside && !onLeader) continue;
      const area = inside ? rect.w * rect.h : 1e12;
      if (area < bestArea) { best = node; bestArea = area; }
    }
    return best;
  }

  // ---------- focus: click to close in, the rest turns softly behind ----------
  // The branch that stays sharp around a node: a session with its todos, its
  // anchored tasks and the agents on them; a task with its anchor; the hub
  // with its crew; an agent with the hub and the node it works on.
  function focusSetFor(node) {
    const ids = new Set([node.id]);
    const agentsOn = (targets) => {
      for (const entry of state.nodes) {
        if (entry.kind !== "agent" || entry.dying) continue;
        const at = entry.targetNode?.id ?? entry.targetId ?? entry.hostId ?? null;
        if (at && targets.has(at)) ids.add(entry.id);
      }
    };
    if (node.kind === "session") {
      for (const child of childrenOf(node.id)) ids.add(child.id);
      agentsOn(new Set(ids));
    } else if (node.kind === "todo") {
      if (node.sessionId) ids.add(node.sessionId);
      agentsOn(new Set(ids));
    } else if (node.kind === "task" || node.kind === "task-group") {
      if (node.anchorSessionId) ids.add(node.anchorSessionId);
      for (const member of node.taskGroup?.members ?? []) ids.add(`task:${member.id}`);
      agentsOn(new Set([node.id]));
    } else if (node.kind === "assistant") {
      for (const entry of state.nodes) if ((entry.kind === "agent" && !entry.builder && !entry.dying) || entry.kind === "root") ids.add(entry.id);
    } else if (node.kind === "root") {
      for (const entry of state.nodes) if (["session", "assistant", "folded"].includes(entry.kind)) ids.add(entry.id);
    } else if (node.kind === "agent") {
      const hub = assistantNode();
      if (hub) ids.add(hub.id);
      const at = node.targetNode ?? (node.hostId ? state.nodes.find((entry) => entry.id === node.hostId) : null);
      if (at) ids.add(at.id);
    }
    return ids;
  }

  // The ids that paint sharp this frame — null when nothing is focused or
  // hovered, so the far layer only carries the sky.
  function splitIds() {
    const ids = new Set();
    const focused = state.focus ? state.nodes.find((entry) => entry.id === state.focus.id) : null;
    if (focused) for (const id of focusSetFor(focused)) ids.add(id);
    const hovered = state.hoverCallout ? state.nodes.find((entry) => entry.id === state.hoverCallout) : null;
    if (hovered) for (const id of focusSetFor(hovered)) ids.add(id);
    return focused || hovered ? ids : null;
  }

  function syncFarLayer(focusIds) {
    if (!el.far?.classList) return;
    el.far.classList.toggle("focused", Boolean(state.focus));
    el.far.classList.toggle("soft", !state.focus && Boolean(focusIds));
  }

  function enterFocus(node) {
    if (!node || node.kind === "music") return false;
    if (!state.focus) state.focusRestore = { orbit: state.orbit };
    state.focus = { id: node.id, kind: node.kind, since: Date.now() };
    selectNode(node);
    setCamMode("free", { quiet: true, transient: true });
    focusOn(node);
    glideZoom(FOCUS_ZOOM[node.kind] ?? 1.9);
    if (state.orbit === "paused" && state.view !== "2d" && !noMotion()) setOrbit("auto", { quiet: true });
    state.settleUntil = 0;
    return true;
  }

  function exitFocus() {
    if (!state.focus) return false;
    state.focus = null;
    const restore = state.focusRestore;
    state.focusRestore = null;
    if (restore && restore.orbit !== state.orbit) setOrbit(restore.orbit, { quiet: true });
    return true;
  }

  // The whole tree back in view: the camera glides out to the fitted frame
  // at the same rate a click closed in (pan targets to the origin, zoom
  // target 1, fit recomputed for the current window). Reduced motion lands
  // at once, the way the frame loop snaps every glide.
  function frameTree() {
    state.camera.tx = 0;
    state.camera.ty = 0;
    state.camera.tz = 0;
    autoFit();
    glideZoom(1);
    if (noMotion()) {
      state.camera.x = 0;
      state.camera.y = 0;
      state.camera.z = 0;
    }
  }

  // Letting go of a node by hand (empty canvas, Esc, the card's close
  // button): the selection and the focus clear, and the tree comes back
  // into frame. Nothing to let go of leaves the camera where the user put it.
  function releaseNode() {
    const held = Boolean(state.selected || state.focus);
    exitFocus();
    selectNode(null);
    if (held) frameTree();
    return held;
  }

  function setCardStyle(style) {
    state.cardStyle = CARD_STYLES.includes(style) ? style : "auto";
    writeStore("mefiStudio.cmdCardStyle", state.cardStyle);
    if (el.cardStyle && el.cardStyle.value !== state.cardStyle) el.cardStyle.value = state.cardStyle;
    return state.cardStyle;
  }

  function drawFrame(time) {
    // One clock per frame: how long since the last draw, clamped to 50 ms, as
    // a hidden tab, an open sheet or a held picker pauses the loop and
    // resuming must not leap by the whole pause. The eases were tuned per
    // 30 fps frame; perSec() turns one into the fraction to cover for the time
    // that really passed, so a glide takes the same wall-clock time at any
    // frame rate (exact at 30 Hz) and a dropped frame no longer slows it down.
    const perSec = (perFrame30, seconds) => 1 - Math.pow(1 - perFrame30, seconds * 30);
    const dt = Math.min(0.05, Math.max(0, (time - (state.lastFrame ?? time)) / 1000));
    state.lastFrame = time;
    const still = noMotion();
    const measuredEnergy = audioEnergy();
    const backgroundLinked = !still && state.reactive && Boolean(state.inputStream || state.localAudio) && state.audioEffects?.background === true && state.audioResponse > 0;
    const energy = backgroundLinked ? measuredEnergy * Math.min(1, state.audioResponse) : 0;
    const musicBands = backgroundLinked ? { bass: state.bands.bass * Math.min(1, state.audioResponse), mid: state.bands.mid * Math.min(1, state.audioResponse), treble: state.bands.treble * Math.min(1, state.audioResponse) } : { bass: 0, mid: 0, treble: 0 };
    const musicBeat = !backgroundLinked || state.audioEffects?.percussion !== true || !state.reactive || !state.inputStream && !state.localAudio ? 0 : (state.music?.beat ?? 0) * Math.min(1, state.audioResponse);
    const audioLinked = !still && state.reactive && Boolean(state.inputStream || state.localAudio);
    // Nodes the assistant has been told to work on (Work on it): pinned board
    // tasks plus pinned, still-queued inbox requests. One set per frame.
    const pinnedIds = workPinIds();
    const visualMusic = visualMusicResponse(state.music, state.audioEffects);
    const audioNodes = audioLinked && state.audioEffects?.nodes !== false && state.audioResponse > 0;
    const graphArea = usableArea();
    const graphFrameKey = `${graphArea.x},${graphArea.y},${graphArea.w},${graphArea.h}`;
    if (state.graphFrameKey !== graphFrameKey) {
      state.graphFrameKey = graphFrameKey;
      if (state.camMode === "orbit" || state.camMode === "follow") autoFit({ ease: true });
    }
    // A refit eases in about a fifth of a second; Follow keeps the visible
    // scale while it does, exactly as the instant fit would.
    if (Number.isFinite(state.fitTarget)) {
      const before = state.fit;
      const settle = still || Math.abs(state.fitTarget - state.fit) < 0.0015;
      state.fit = settle ? state.fitTarget : state.fit + (state.fitTarget - state.fit) * perSec(0.18, dt);
      if (state.camMode === "follow") state.zoom = Math.max(0.45, Math.min(2.6, state.zoom * before / state.fit));
      if (settle) state.fitTarget = null;
    }
    const cameraEase = perSec(CAMERA_EASE, dt);
    const centerFlight = stepCenter(graphArea, still, cameraEase);
    updateFollowCamera(Date.now());
    const target = orbitTarget(energy);
    state.orbitVel += (target - state.orbitVel) * perSec(ORBIT_EASE, dt);
    if (still) state.orbitVel = 0;
    // orbitVel is radians per 30 fps frame, as tuned
    state.angle += state.orbitVel * dt * 30;
    // The camera glides on a critically damped spring (CAMERA_SMOOTH): it
    // eases out of rest instead of lurching at full speed, settles in about
    // 0.9 s instead of crawling for two, and a click that retargets mid-glide
    // keeps the velocity it has. A drag moves the camera directly (x = tx)
    // and leaves no velocity behind.
    const camVel = (state.camVel ??= { x: 0, y: 0, z: 0, zoom: 0 });
    if (still || state.panning) {
      state.camera.x = state.camera.tx;
      state.camera.y = state.camera.ty;
      state.camera.z = state.camera.tz;
      camVel.x = 0; camVel.y = 0; camVel.z = 0;
    } else {
      state.camera.x = smoothDamp(state.camera.x, state.camera.tx, camVel, "x", CAMERA_SMOOTH, dt);
      state.camera.y = smoothDamp(state.camera.y, state.camera.ty, camVel, "y", CAMERA_SMOOTH, dt);
      state.camera.z = smoothDamp(state.camera.z, state.camera.tz, camVel, "z", CAMERA_SMOOTH, dt);
    }
    if (state.camMode === "follow" && state.followZoomTarget != null && !still) state.zoom += (state.followZoomTarget - state.zoom) * perSec(0.065, dt);
    if (state.zoomTarget != null) {
      // The glide a click (or a search hit) asked for: the same ease as the
      // camera, so scale and pan settle together; snap and stop once there.
      if (still || Math.abs(state.zoomTarget - state.zoom) < 0.003) {
        setZoom(state.zoomTarget);
        camVel.zoom = 0;
      } else {
        // In log space, so doubling and halving the scale take the same time;
        // the same spring as the pan, so scale and pan settle together.
        state.zoom = Math.exp(smoothDamp(Math.log(state.zoom), Math.log(state.zoomTarget), camVel, "zoom", CAMERA_SMOOTH, dt));
      }
    } else camVel.zoom = 0;
    // Callouts keep their spots while the camera is in flight (placeCallout):
    // "in flight" is a pan still worth more than a few pixels, or a zoom glide.
    const flightPx = Math.hypot(state.camera.tx - state.camera.x, state.camera.ty - state.camera.y, state.camera.tz - state.camera.z) * state.fit * state.zoom * (state.overviewScale ?? 1);
    state.cameraMoving = !still && (flightPx > 8 || centerFlight > 8 || (state.zoomTarget != null && Math.abs(state.zoomTarget - state.zoom) > 0.03));
    // What earns the display's full rate: a glide, a zoom, or a hand on the tree.
    state.motionHot = !still && (state.cameraMoving || flightPx > 0.5 || centerFlight > 0.5 || state.zoomTarget != null || Number.isFinite(state.fitTarget) || Boolean(state.morph || state.lifeHot || state.panning || state.rotating));

    const { ctx } = el;
    // Two layers: the sky, and while a node is focused or a card hovered
    // everything outside that branch, paint on the far canvas (which the CSS
    // blurs); the rest paints here, sharp. With no far canvas it all lands here.
    const far = el.farCtx ?? ctx;
    const profiler = globalThis.window?.MefiProfiler;
    const backdropSpan = profiler?.begin("command.backdrop");
    try {
      // The canvas paints its own sky, so CSS alone cannot apply a theme: the
      // scene follows the colour theme (or the Ambience override) and is
      // tinted from the live palette in light and dark palettes alike.
      drawBackdrop(far, time, still, energy, musicBands, musicBeat);
      if (far !== ctx) ctx.clearRect(0, 0, el.width, el.height);
    } finally { profiler?.end(backdropSpan); }

    // A followed branch can be zoomed past the rest of the constellation.
    // Keep those distant nodes from drawing through the header and work rails.
    ctx.save();
    ctx.beginPath();
    ctx.rect(graphArea.x, graphArea.y, graphArea.w, graphArea.h);
    ctx.clip();
    if (far !== ctx) { far.save(); far.beginPath(); far.rect(graphArea.x, graphArea.y, graphArea.w, graphArea.h); far.clip(); }

    syncAgentMotion(Date.now(), time);
    stepFx(Date.now());
    stepDoneHold(Date.now());
    const projected = state.nodes.map((node) => ({ node, p: project(node) }));
    const runningIds = autopilotBusyIds(state.assistant);
    const runningJobs = autopilotJobs(state.assistant);
    for (const { node } of projected) {
      node._orbitTrail = null; node._extraGlow = false;
      const wantLift = state.hoverNode === node || state.selected?.id === node.id ? 1 : 0;
      node._lift = easeLift(node._lift, wantLift, dt, still);
      node._audioResponse = nodeAudioResponse(node, visualMusic, audioNodes, state.audioResponse);
      node._bubble = null; node._bubblePaint = null;
      const ids = [node.id, node.sessionId, node.task?.id, node.workTask?.id].filter(Boolean).map(String);
      const work = node.task ?? node.workTask ?? null;
      node._workLabel = work?.status === "awaiting_verification" ? "Verifying" : (ids.some((id) => runningIds.has(id)) || node.kind === "todo" && node.status === "in_progress") ? "Running" : ids.some((id) => pinnedIds.has(id)) ? "Next" : null;
      if (node.kind === "task") {
        const job = runningJobs.find((entry) => entry.taskId === node.task?.id);
        node.progress = typeof job?.progress === "number" && Number.isFinite(job.progress) ? job.progress : null;
      }
    }
    layoutProjectedGraph(projected, graphArea, state.camMode, time, still);
    if (state.morph) {
      const elapsed = (globalThis.performance?.now?.() ?? Date.now()) - state.morph.at;
      const t = still ? 1 : Math.max(0, Math.min(1, elapsed / state.morph.ms));
      if (t < 1) {
        const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        for (const entry of projected) {
          const from = state.morph.from.get(entry.node.id);
          if (from) entry.p = { ...entry.p, x: from.x + (entry.p.x - from.x) * e, y: from.y + (entry.p.y - from.y) * e };
        }
      } else state.morph = null;
    }
    // Life cycle on screen: fresh work grows out of its host and finished
    // work flies home and sinks in. stepFx eases scale and fade, but saved
    // screen anchors win over its world-space travel, so the travel is
    // blended here, between the painted points (builders keep returnFrom).
    let lifeHot = false;
    if (state.fx.size && !still) {
      const nowFx = Date.now();
      const pointOf = new Map(projected.map(({ node, p }) => [node.id, p]));
      for (const entry of projected) {
        const fx = state.fx.get(entry.node.id);
        if (!fx || fx.builder) continue;
        const hostP = pointOf.get(absorbHost(fx)?.id);
        if (!hostP) continue;
        if (fx.absorbAt != null) {
          const t = Math.min(1, Math.max(0, (nowFx - fx.absorbAt) / NODE_ABSORB_MS));
          fx.fromScreen ??= { x: entry.p.x, y: entry.p.y };
          const e = smoothStep(t);
          entry.p = { ...entry.p, x: fx.fromScreen.x + (hostP.x - fx.fromScreen.x) * e, y: fx.fromScreen.y + (hostP.y - fx.fromScreen.y) * e };
          lifeHot = true;
        } else if (fx.bornAt != null && nowFx - fx.bornAt >= 0 && nowFx - fx.bornAt < NODE_GROW_MS) {
          const e = easeOut((nowFx - fx.bornAt) / NODE_GROW_MS);
          entry.p = { ...entry.p, x: hostP.x + (entry.p.x - hostP.x) * e, y: hostP.y + (entry.p.y - hostP.y) * e };
          lifeHot = true;
        }
      }
    }
    state.lifeHot = lifeHot;
    const screenPoints = new Map(projected.map(({ node, p }) => [node.id, p]));
    computeBranch();
    // A focused node that left the graph releases the focus; otherwise the
    // sharp set decides which layer each element paints on this frame.
    if (state.focus && !state.nodes.some((entry) => entry.id === state.focus.id)) exitFocus();
    // Racking focus out: the far canvas un-blurs over its CSS transition
    // (260 ms). The nodes that were on it stay there until it has, then come
    // back to the sharp layer, rather than all snapping sharp in one frame.
    // The blur class itself follows the live set, so the un-blur starts now.
    const liveFocusIds = splitIds();
    let focusIds = liveFocusIds;
    if (liveFocusIds || still) state.farHold = liveFocusIds ? { ids: liveFocusIds, until: 0 } : null;
    else if (state.farHold) {
      state.farHold.until ||= Date.now() + 280;
      if (Date.now() < state.farHold.until) focusIds = state.farHold.ids;
      else state.farHold = null;
    }
    state.focusIds = focusIds;
    const layerFor = (node) => (focusIds && far !== ctx && !focusIds.has(node.id) ? far : ctx);

    drawGraphConnections(ctx, projected, runningIds, audioLinked, time, { far, focusIds });

    // pulses: bright travelling dots on the working path — a line that ends
    // at an agent carries the signal itself instead (wave, see surgeLine)
    const now = Date.now();
    state.pulses = state.pulses.filter((pulse) => now - pulse.start < pulse.duration);
    for (const pulse of state.pulses) {
      // A pulse launched from a HUD row (an absorbed record) starts at that
      // screen point rather than at a node.
      const from = screenPoints.get(pulse.from.id) ?? project(pulse.from);
      const to = screenPoints.get(pulse.to.id) ?? project(pulse.to);
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
        ctx.lineWidth = pulse.small ? 0.8 : 1.2;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(x, y, pulse.small ? 1.5 : 2.2 + musicBands.bass * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = pulse.color ?? "#a9ffcd";
      if (!still) {
        ctx.shadowColor = pulse.glow ?? "#57ff9a";
        ctx.shadowBlur = 3;
      }
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.lineCap = "butt";
    if (still) state.pulses = [];

    // particles: vaporized external work
    state.particles = state.particles.filter((particle) => particle.life > 0);
    // Particles were tuned at 0.016 of their velocity per 30 fps frame.
    const frames30 = still ? 0 : dt * 30;
    const step = 0.016 * frames30;
    for (const particle of state.particles) {
      particle.x += particle.vx * step;
      particle.y += particle.vy * step;
      particle.vy += 6 * step;
      particle.life -= particle.decay * frames30;
      const life = Math.max(0, particle.life);
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, Math.max(0, particle.size * life), 0, Math.PI * 2);
      ctx.fillStyle = particle.tint ? `rgba(${particle.tint},${life * 0.9})` : particle.gold ? `rgba(241,220,174,${life * 0.9})` : particle.blue ? `rgba(157,183,255,${life * 0.85})` : `rgba(255,255,255,${life * 0.8})`;
      if (!still) {
        ctx.shadowColor = particle.tint ? `rgb(${particle.tint})` : particle.gold ? "#e6c98d" : particle.blue ? "#9db7ff" : "#ffffff";
        ctx.shadowBlur = 2;
      }
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    if (still) state.particles = [];

    // wakes: what a flying agent leaves behind, under the orbs
    drawAgentTrails(ctx, time);

    // Familiar luminous orbs: one restrained halo and one status rim.
    // Managed anchors stay fixed while work and compact labels update.
    const ordered = [...projected].sort((a, b) => b.p.depth - a.p.depth);
    const nodesSpan = profiler?.begin("command.nodes");
    try {
    for (const { node, p } of ordered) {
      if (node._absorbed) continue;
      // outside the focused branch an orb paints on the far (blurred) layer
      const ctx = layerFor(node);
      const nodeScale = node._scale ?? 1;
      if (nodeScale <= 0.02) continue;
      const visual = nodeVisualProfile(node);
      const active = node._workLabel !== "Verifying" && (isBusyNode(node, runningIds) || node.state === "active" || node.kind === "agent" && node.status === "running");
      // Live file clash: checkCollisions only holds sessions with active
      // edits, so this boost never fires for settled, idle-only groups.
      const colliding = state.collisionSessions.size > 0 && Boolean(node.sessionId) && state.collisionSessions.has(node.sessionId);
      const selected = state.selected?.id === node.id || state.hoverNode === node || state.query && state.matchSet.has(node.id);
      const hold = node.doneHold ? state.doneHold.get(node.id) ?? null : null;
      const tint = hold ? NODE_RGB.done : colliding && active && node.kind !== "agent" ? NODE_RGB.collision : colorOf(node);
      const factor = emphasis(node);
      const base = node.kind === "todo" ? 4.5 : node.kind === "assistant" ? 15 : node.kind === "agent" ? 10 : node.kind === "task" ? 12 : 11;
      const radius = Math.max(2, Math.min(visual.maxRadius, base * Math.max(0.75, Math.min(1.15, p.k))) * nodeScale);
      node._px = p.x; node._py = p.y; node._pr = radius;
      drawNodeSurface(ctx, node, p, radius, tint, { selected: Boolean(selected), active, alpha: Math.max(0.35, visual.alpha * factor) });
      drawWorkOrbit(ctx, node, p, radius, time, still);
      drawFiledWork(ctx, node, p, radius, runningIds, time, still);
      drawAgentDress(ctx, node, p, radius, tint, time, still);
      drawHubDress(ctx, node, p, radius, tint, time, still);
      // Work-left meter: only a known worker fraction, never inferred activity.
      if ((active || selected) && typeof node.progress === "number" && Number.isFinite(node.progress)) {
        const fraction = Math.max(0, Math.min(1, node.progress));
        ctx.fillStyle = "#303947"; ctx.fillRect(p.x - 9, p.y + radius + 5, 18, 1.5);
        ctx.fillStyle = rgba(tint, 0.8); ctx.fillRect(p.x - 9, p.y + radius + 5, 18 * fraction, 1.5);
      }
      drawNodeAudio(ctx, node, p, radius, tint, node._audioResponse, audioNodes ? visualMusic : null, time / 1.8);
      // Collision boost: a thin amber rim, same restraint as the music beat —
      // the clash color marks the session while the fight is still live.
      if (colliding && (active || selected)) {
        traceNodeSurface(ctx, visual.shape, p.x, p.y, radius + 2.5);
        ctx.strokeStyle = rgba(NODE_RGB.collision, 0.55);
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      node._excl = null;
      if (hold && !hold.ackedAt) {
        const bx = p.x + radius + 6, by = p.y - radius - 5;
        ctx.beginPath(); ctx.roundRect(bx - 6, by - 6, 12, 12, 3);
        ctx.fillStyle = "#173025"; ctx.fill(); ctx.strokeStyle = rgba(NODE_RGB.done, 0.8); ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = "#a7e5c0"; ctx.font = '600 9px system-ui, "Segoe UI", sans-serif'; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("!", bx, by);
        node._excl = { x: bx, y: by, r: 9 };
      }
    }
    } finally { profiler?.end(nodesSpan); }

    // Checkpoint notes stay discoverable without competing with current work.
    const badgeExclusions = [...hudRects()];
    for (const { node, p } of projected) {
      if (node.kind !== "session" || !node._pr) continue;
      const notes = state.checkpoints?.[node.id];
      if (!notes?.length) continue;
      const scale = Math.max(0.85, Math.min(1.05, p.k));
      const bx = p.x + node._pr + 4, by = p.y - node._pr - 7;
      const paint = { x: bx, y: by, w: 11 * scale, h: 10 * scale };
      const hit = { x: bx - 5, y: by - 5, w: paint.w + 10, h: paint.h + 10, node };
      if (hit.x < graphArea.x || hit.y < graphArea.y || hit.x + hit.w > graphArea.x + graphArea.w || hit.y + hit.h > graphArea.y + graphArea.h || badgeExclusions.some((zone) => overlaps(hit, zone))) continue;
      if (projected.some((other) => other.node !== node && !other.node._absorbed && overlaps(hit, { x: other.p.x - (other.node._pr ?? 4), y: other.p.y - (other.node._pr ?? 4), w: (other.node._pr ?? 4) * 2, h: (other.node._pr ?? 4) * 2 }))) continue;
      drawBubble(layerFor(node), bx, by, scale, state.hoverNode === node || state.hoverBubble === node ? 1 : 0.65);
      node._bubble = hit; node._bubblePaint = paint;
      badgeExclusions.push(hit);
    }

    // callouts first (leader, bar, title row, thoughts), then the remaining
    // bubbles and the compact labels stepping around them
    stepDeferred(Date.now());
    stepSpeech(Date.now());
    drawCallouts(projected, { near: ctx, far, focusIds, dt });
    drawSpeech(projected);
    drawLabels(projected);
    ctx.restore();
    if (far !== ctx) far.restore();
    syncFarLayer(liveFocusIds);
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
    if (node.kind === "session" || node.kind === "assistant" || node.kind === "music") return LABEL_FONT;
    if (node.kind === "task" || node.kind === "folded") return LABEL_FONT_TASK;
    if (node.kind === "root") return LABEL_FONT_ROOT;
    if (node.kind === "agent") return LABEL_FONT_AGENT;
    return LABEL_FONT_TODO;
  }

  function labelColour(node, alpha) {
    if (node.kind === "music") return rgba(NODE_RGB.warm, alpha);
    if (node.kind === "session") return `rgba(236,229,216,${node.stale ? alpha * 0.6 : alpha})`;
    if (node.kind === "root") return rgba(NODE_RGB.warm, alpha);
    if (node.kind === "assistant") return rgba(NODE_RGB.assistant, alpha);
    if (node.kind === "folded") return rgba(NODE_RGB.done, alpha * 0.85);
    if (node.kind === "agent") return rgba(colorOf(node), node.status === "running" || node.status === "error" ? alpha : alpha * 0.7);
    if (node.kind === "task") {
      const [red, green, blue] = node.color ? hexToRgb(node.color) : NODE_RGB.task;
      return `rgba(${red},${green},${blue},${alpha})`;
    }
    return `rgba(154,143,125,${alpha})`;
  }

  function labelText(ctx, node, font, { separateStatus = false, maxWidth, maxChars } = {}) {
    // a travelling agent's label carries its target ("reference · Crafting bench recipes")
    const cap = node.kind === "session" || node.kind === "task" ? 44 : node.kind === "root" ? 12 : node.kind === "assistant" ? 16 : node.kind === "folded" ? 20 : node.kind === "agent" ? (node.targetNode ? 36 : 14) : 34;
    let text = String(node.label ?? "").trim();
    if (!text) return "";
    if (node.kind === "agent" && state.labels === "auto") {
      if (node.builder) {
        const seconds = node.startedAt ? Math.max(0, Math.round((Date.now() - node.startedAt) / 1000)) : null;
        text = `Builder${seconds != null ? ` · ${seconds < 90 ? `${seconds}s` : `${Math.round(seconds / 60)}m`}` : ""}`;
      } else text = String(node.role || text.split(" · ")[0]);
    }
    if (node.kind === "root") text = text.toUpperCase();
    else if (node._workLabel && node.kind !== "agent" && !separateStatus) text = `${node._workLabel} · ${text}`;
    if (node.taskGroup) text = `${state.expandedTaskGroups.has(node.taskGroup.id) ? "−" : "+"} ${node.taskGroup.members.length} · ${text}`;
    const compact = state.labels === "auto" && state.selected?.id !== node.id && state.hoverNode !== node;
    const charLimit = maxChars ?? (compact ? Math.min(cap, 32) : cap);
    // Side panels can leave less than 300px for the graph. Shorten overview
    // titles to that clear width so crowded work still has room for a name.
    const widthLimit = maxWidth ?? (compact ? Math.min(180, LABEL_MAX_PX, Math.max(80, usableArea().w * 0.4)) : LABEL_MAX_PX);
    let clipped = text.length > charLimit;
    if (clipped) text = text.slice(0, charLimit);
    while (text.length > 1 && measure(ctx, font, `${text}${clipped ? "…" : ""}`) > widthLimit) {
      text = text.slice(0, -1);
      clipped = true;
    }
    return clipped ? `${text}…` : text;
  }

  // The verifying cards that still earn a name at rest: the newest
  // VERIFYING_NAMED by attempt time (ordinal, then id, as the tie-break so the
  // set is stable between frames). Everything else verifying is an orb.
  const VERIFYING_NAMED = 2;
  // One numeric-aware collator for the tie-break: localeCompare builds one
  // per call, and this sort runs every frame over every verifying card.
  const verifyingCollator = typeof Intl !== "undefined" && Intl.Collator ? new Intl.Collator(undefined, { numeric: true }) : { compare: (a, b) => a.localeCompare(b, undefined, { numeric: true }) };
  function recentVerifyingIds(projected) {
    const rows = [];
    for (const { node } of projected) {
      if (node.kind !== "task" || node._workLabel !== "Verifying" || node.dying || node._absorbed) continue;
      const task = node.task ?? node.workTask ?? {};
      const at = Number(task.lastAttempt?.at) || Number(task.updatedAt) || 0;
      rows.push({ id: node.id, at, ordinal: String(node.ordinal ?? "") });
    }
    if (rows.length <= VERIFYING_NAMED) return new Set(rows.map((row) => row.id));
    rows.sort((a, b) => b.at - a.at || verifyingCollator.compare(b.ordinal, a.ordinal) || verifyingCollator.compare(String(a.id), String(b.id)));
    return new Set(rows.slice(0, VERIFYING_NAMED).map((row) => row.id));
  }

  function workLabelLines(ctx, node, font, workStatus, maxWidth = 200) {
    if (!workStatus || usableArea().w < 480) return [labelText(ctx, node, font, { separateStatus: Boolean(workStatus) })];
    // Working names need enough context to distinguish simultaneous jobs.
    // Wrap at words before clipping; the stored title remains untouched.
    const width = Math.min(maxWidth, usableArea().w * 0.4);
    const title = labelText(ctx, node, font, { separateStatus: true, maxWidth: Infinity, maxChars: Infinity }).replace(/\s+/g, " ");
    if (measure(ctx, font, title) <= width) return [title];
    const fittingLength = (text, suffix = "") => {
      let low = 1, high = text.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (measure(ctx, font, text.slice(0, middle) + suffix) <= width) low = middle;
        else high = middle - 1;
      }
      return low;
    };
    let end = fittingLength(title);
    const word = title.lastIndexOf(" ", end);
    if (word > end / 2) end = word;
    const first = title.slice(0, end).trimEnd();
    let rest = title.slice(end).trimStart();
    if (measure(ctx, font, rest) > width) {
      rest = rest.slice(0, fittingLength(rest, "…"));
      rest = `${rest.trimEnd()}…`;
    }
    return [first, rest];
  }

  function labelBudget() {
    if (state.labels !== "auto") return LABEL_BUDGET;
    const area = usableArea();
    // Auto is an overview, including in Orbit and Free view. Base its density
    // on the actual clear canvas, so opening a panel cannot leave a text wall.
    if (area.w < 480 || area.h < 400) return 4;
    return area.w < 800 || area.h < 480 ? 6 : 8;
  }

  function labelCandidates(projected) {
    const mode = state.labels;
    const selectedId = state.selected?.id ?? null;
    const focus = state.camMode === "follow" ? state.follow : null;
    const hasWorkerTask = projected.some(({ node }) => node.kind === "task" && !node.dying && !node._absorbed && node._workLabel !== "Verifying" && (node.state === "active" || node._workLabel === "Running"));
    // Verifying cards are all waiting on the same overseer pass, so naming
    // every one of them says nothing a HUD count does not. Only the newest
    // few keep a name at rest; the rest are tinted orbs, named on hover,
    // selection, search or All.
    const recentVerifying = recentVerifyingIds(projected);
    const list = [];
    for (const item of projected) {
      const node = item.node;
      if (node.dying || node._absorbed || node._callout || (node._fade ?? 1) <= 0.02) continue; // ghosts do not get a name; a callout already carries it
      let priority = -1;
      if (node.id === selectedId) priority = 0;
      else if (state.hoverNode === node) priority = 1;
      else if (state.camMode === "follow" && state.follow?.key === node.id) priority = 1.5;
      else if (state.query && state.matchSet.has(node.id)) priority = 2;
      else if (mode !== "none") {
        if (node.kind === "task" && node._workLabel !== "Verifying" && (node._workLabel === "Running" || node.state === "active")) priority = 2.15;
        else if (node.kind === "assistant") priority = 2.22;
        else if (node._workLabel === "Verifying") priority = recentVerifying.has(node.id) ? 2.45 : 4;
        else if (node._workLabel === "Next") priority = 2.55;
        else if (node.kind !== "todo" && node._workLabel === "Running" || node.builder && node.status === "running") priority = 2.6;
        else if (node.kind === "music") priority = 2.7;
        else if (node.taskGroup) priority = 2.9;
        else if (node.kind === "session") priority = 3;
        else if (node.kind === "task" || node.kind === "folded") priority = 4;
        else if (node.kind === "root") priority = 5;
        else if (node.kind === "todo" && node.status === "in_progress") priority = 3.2;
        else if (node.kind === "todo" && state.branch && node.sessionId === state.branch) priority = 7;
        // An agent's glyph already says which role it is: a name only while it
        // is away at work (a builder, or a running agent whose target is not
        // the hub it rests at), or when every label is on.
        else if (node.kind === "agent") {
          const target = node.targetNode ?? node.targetId ?? null;
          const away = node.builder || (target && (node.targetNode?.kind ?? null) !== "assistant" && node.targetId !== "__assistant__");
          priority = (node.status === "running" || node.builder) && away ? 2.8 : mode === "all" ? 9 : -1;
        }
        else if (mode === "all") priority = 8;
      }
      if (priority < 0) continue;
      if (mode === "auto" && priority > 2) {
        // The saved tree stays intact. Quiet names become available on hover,
        // selection, search, or All; they do not compete with current work.
        const landmark = node.kind === "assistant" || node.kind === "music" || Boolean(node.taskGroup);
        const activeTask = node.kind === "task" && (node._workLabel === "Verifying" ? recentVerifying.has(node.id) : node.state === "active" || ["Running", "Next"].includes(node._workLabel));
        const activeAgent = node.kind === "agent" && node.status === "running";
        const related = focus ? followsNode(node, focus) : Boolean(state.branch && node.sessionId === state.branch || selectedId && node.sessionId === selectedId);
        const step = node.kind === "todo" && node.status === "in_progress" && related;
        const session = node.kind === "session" && !hasWorkerTask && !focus;
        if (!landmark && !activeTask && !activeAgent && !step && !session) continue;
        if (focus && activeAgent && !followsNode(node, focus)) continue;
      }
      if (priority > 2 && item.p.k < 0.55) continue; // far nodes stop shouting
      list.push({ node, p: item.p, priority });
    }
    // Stable ties keep Orbit from constantly swapping the labels being read.
    list.sort((a, b) => a.priority - b.priority || String(a.node.id).localeCompare(String(b.node.id)));
    if (mode === "auto") {
      let quietSessions = 0;
      const budget = labelBudget();
      return list.filter(({ node, priority }) => priority <= 2 || node.kind !== "session" || ++quietSessions <= 2).slice(0, budget);
    }
    return list.length > LABEL_CANDIDATES ? list.slice(0, LABEL_CANDIDATES) : list;
  }

  function slotRect(slot, p, radius, width, h = LABEL_HEIGHT) {
    if (slot === "left") {
      const tx = p.x - radius - 8;
      const ty = p.y + h / 2 - 4;
      return { x: tx - width, y: ty - h + 3, w: width, h, tx, ty, align: "right" };
    }
    if (slot === "below") {
      const ty = p.y + radius + h + 5;
      return { x: p.x - width / 2, y: ty - h + 3, w: width, h, tx: p.x, ty, align: "center" };
    }
    if (slot === "above") {
      const ty = p.y - radius - 15;
      return { x: p.x - width / 2, y: ty - h + 3, w: width, h, tx: p.x, ty, align: "center" };
    }
    const tx = p.x + radius + 8;
    const ty = p.y + h / 2 - 4;
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
    if (rect.x < 12 || rect.y < 12 || rect.x + rect.w > el.width - 12 || rect.y + rect.h > el.height - 12) return true;
    if (state.camMode === "follow" || state.labels === "auto" || state.settingsPreview) {
      const area = usableArea();
      if (rect.x < area.x + 5 || rect.y < area.y + 5 || rect.x + rect.w > area.x + area.w - 5 || rect.y + rect.h > area.y + area.h - 5) return true;
    }
    for (const placed of state.labelRects) if (overlaps(rect, placed)) return true;
    for (const zone of excluded) if (overlaps(rect, zone)) return true;
    return false;
  }

  // Important labels can search hundreds of free slots. Only nearby nodes
  // can obstruct one; keep the exact padded overlap test inside those cells.
  function nodeLabelBlocker(projected) {
    const cells = new Map(), broad = [], rects = [], ghosts = [];
    const cellSize = 64;
    for (const { node, p } of projected) {
      if (node.dying || node._absorbed) continue;
      if ((node._fade ?? 1) <= 0.02) { ghosts.push({ node, cx: p.x, cy: p.y, reach: (node._pr ?? 4) + 5 }); continue; }
      const radius = Math.max(5, node._orbitTrail?.radius ?? node._pr ?? 4) + 3;
      const rect = { node, x: p.x - radius, y: p.y - radius, w: radius * 2, h: radius * 2, cx: p.x, cy: p.y, reach: (node._pr ?? 4) + 5 };
      rects.push(rect);
      const left = Math.floor(rect.x / cellSize), right = Math.floor((rect.x + rect.w) / cellSize);
      const top = Math.floor(rect.y / cellSize), bottom = Math.floor((rect.y + rect.h) / cellSize);
      // A malformed or unusually large bound must never grow an unbounded grid.
      if (!Number.isFinite(left + right + top + bottom) || (right - left + 1) * (bottom - top + 1) > 64) { broad.push(rect); continue; }
      for (let x = left; x <= right; x += 1) {
        if (!cells.has(x)) cells.set(x, new Map());
        const column = cells.get(x);
        for (let y = top; y <= bottom; y += 1) {
          if (!column.has(y)) column.set(y, []);
          column.get(y).push(rect);
        }
      }
    }
    const search = (left, right, top, bottom, hits) => {
      if (!Number.isFinite(left + right + top + bottom) || (right - left + 1) * (bottom - top + 1) > 256) return rects.some(hits);
      if (broad.some(hits)) return true;
      for (let x = left; x <= right; x += 1) {
        const column = cells.get(x);
        if (!column) continue;
        for (let y = top; y <= bottom; y += 1) if (column.get(y)?.some(hits)) return true;
      }
      return false;
    };
    const blocker = (surface, node) => {
      const left = Math.floor((surface.x - LABEL_PAD) / cellSize), right = Math.floor((surface.x + surface.w + LABEL_PAD) / cellSize);
      const top = Math.floor((surface.y - LABEL_PAD) / cellSize), bottom = Math.floor((surface.y + surface.h + LABEL_PAD) / cellSize);
      return search(left, right, top, bottom, (rect) => rect.node !== node && overlaps(surface, rect));
    };
    // A callout leader crossing an orb: the same grid, queried along the
    // segment's bounds grown by the widest reach any orb tests against, so a
    // card's candidates check the few orbs nearby instead of every node.
    let maxReach = 0;
    for (const rect of rects) if (rect.reach > maxReach) maxReach = rect.reach;
    blocker.leaderHitsNode = (sx, sy, ex, ey, node) => {
      const hits = (rect) => rect.node !== node && segmentDistance(rect.cx, rect.cy, sx, sy, ex, ey) < rect.reach;
      if (ghosts.some(hits)) return true;
      const left = Math.floor((Math.min(sx, ex) - maxReach) / cellSize), right = Math.floor((Math.max(sx, ex) + maxReach) / cellSize);
      const top = Math.floor((Math.min(sy, ey) - maxReach) / cellSize), bottom = Math.floor((Math.max(sy, ey) + maxReach) / cellSize);
      return search(left, right, top, bottom, hits);
    };
    return blocker;
  }

  // Panels are opaque; labels step around them instead of the constellation
  // moving out of the way. Rects are CSS pixels, the canvas coordinate space.
  function hudRects() {
    if (state.ambientZen) return [];
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
    push(el.followStatus);
    push(el.bottom);
    push(el.info);
    push(el.rail);
    push(el.feed);
    push(el.chatLog);
    push(el.legend);
    push(el.appRail);
    push(el.empty);
    push(el.pop);
    state.hudRects = rects;
    return rects;
  }

  function drawLabels(projected) {
    const profiler = globalThis.window?.MefiProfiler;
    const span = profiler?.begin("command.labels");
    try { return drawLabelsImpl(projected); }
    finally { profiler?.end(span); }
  }

  function drawLabelsImpl(projected) {
    for (const { node } of projected) { node._label = null; node._labelLines = []; node._cardRect = null; }
    const ctx = el.ctx;
    if (!ctx) return;
    state.labelRects.length = 0;
    const excluded = [...hudRects(), ...(state.calloutRects ?? []), ...(state.speechRects ?? []), ...projected.flatMap(({ node }) => node._bubble ? [node._bubble] : [])];
    const candidates = labelCandidates(projected);
    const budget = labelBudget();
    const hitsNode = nodeLabelBlocker(projected);
    let drawn = 0;
    for (const { node, p, priority } of candidates) {
      if (drawn >= budget) break;
      // Running and up-next work get the two-line plate with a header; a
      // verifying card is only waiting, so it keeps the compact one-line
      // chip ("Verifying · title") in the verify tint — a burst of finished
      // runs no longer stacks tall VERIFYING plates across the graph.
      const workStatus = node.kind === "task" && ["Running", "Next"].includes(node._workLabel) ? node._workLabel : null;
      const verifying = node.kind === "task" && node._workLabel === "Verifying";
      const font = fontFor(node);
      let lines = workLabelLines(ctx, node, font, workStatus);
      if (!lines[0]) continue;
      let height = workStatus ? 33 + (lines.length - 1) * 16 : LABEL_HEIGHT;
      let width = Math.max(...lines.map((line) => measure(ctx, font, line)), workStatus ? 72 : 0);
      // The hub's filed pips hang below its rim: give its label the extra ring
      // so the chip cannot park on top of them.
      const radius = (node._orbitTrail?.radius ?? node._pr ?? 4) + (node.kind === "assistant" && node.filedWork?.length ? FILED_PIP_RING : 0);
      let rect = null, paint = null;
      const needsName = priority <= 2.15 || node.kind === "task" && node._workLabel === "Running";
      const placeNearby = () => {
        for (const distance of [0, 20, 40]) {
          let best = Infinity;
          for (const slot of LABEL_SLOTS) {
            // Slide along the orb's sides before sending a label far away.
            // Corner slots use the nearby whitespace missed by four axial rays.
            const vertical = slot === "left" || slot === "right";
            const shift = vertical ? height / 2 + 8 : width / 2;
            for (const offset of needsName ? [0, -shift, shift] : [0]) {
              const candidate = slotRect(slot, p, radius + distance, width, height);
              if (vertical) { candidate.y += offset; candidate.ty += offset; }
              else { candidate.x += offset; candidate.tx += offset; }
              const surface = { x: candidate.x - 7, y: candidate.y - 4, w: candidate.w + 14, h: candidate.h + 8 };
              const dx = Math.max(surface.x - p.x, 0, p.x - surface.x - surface.w);
              const dy = Math.max(surface.y - p.y, 0, p.y - surface.y - surface.h);
              const score = dx * dx + dy * dy + ((surface.x + surface.w / 2 - p.x) ** 2 + (surface.y + surface.h / 2 - p.y) ** 2) * 0.04;
              if (score >= best - 0.01 || blocked(surface, excluded) || hitsNode(surface, node)) continue;
              best = score; rect = candidate; paint = surface;
            }
          }
          if (rect) break;
        }
        if (needsName && !rect) {
          // Search the whole nearby perimeter, not just rays through the orb.
          // On a dense branch a diagonal pocket may be much closer than the
          // first axial opening, especially beside a moving worker satellite.
          const area = usableArea(), w = width + 14, h = height + 8;
          const reach = radius + 80;
          const left = Math.max(area.x + 12, p.x - reach - w), right = Math.min(area.x + area.w - w - 12, p.x + reach);
          const top = Math.max(area.y + 12, p.y - reach - h), bottom = Math.min(area.y + area.h - h - 12, p.y + reach);
          let nearest = Infinity;
          for (let y = top; y <= bottom; y += 12) {
            for (let x = left; x <= right; x += 12) {
              const dx = Math.max(x - p.x, 0, p.x - x - w), dy = Math.max(y - p.y, 0, p.y - y - h);
              const gap = Math.hypot(dx, dy);
              const score = gap * gap + ((x + w / 2 - p.x) ** 2 + (y + h / 2 - p.y) ** 2) * 0.04;
              if (gap < radius + 4 || gap > reach || score >= nearest - 0.01) continue;
              const surface = { x, y, w, h };
              if (blocked(surface, excluded) || hitsNode(surface, node)) continue;
              nearest = score; paint = surface;
              rect = { x: x + 7, y: y + 4, w: width, h: height, tx: x + 7, ty: y + h - 7, align: "left" };
            }
          }
        }
      };
      placeNearby();
      if (!rect && needsName && workStatus && usableArea().w >= 480 && !lines.at(-1).endsWith("…")) {
        const original = { lines, width, height };
        const content = lines.join("").replace(/\s/g, "");
        // A narrower two-line chip can fit beside a passing satellite. Keep
        // exactly the same title content instead of sending it across the tree.
        for (const maxWidth of [180, 160, 140]) {
          const wrapped = workLabelLines(ctx, node, font, workStatus, maxWidth);
          if (wrapped.join("").replace(/\s/g, "") !== content) continue;
          const nextHeight = 33 + (wrapped.length - 1) * 16;
          const nextWidth = Math.max(72, ...wrapped.map((line) => measure(ctx, font, line)));
          if (nextHeight === height && nextWidth === width) continue;
          lines = wrapped; height = nextHeight; width = nextWidth;
          placeNearby();
          if (rect) break;
        }
        if (!rect) { lines = original.lines; width = original.width; height = original.height; }
      }
      if (!rect && needsName) {
        const area = usableArea();
        const w = width + 14, h = height + 8;
        let nearest = Infinity;
        for (let y = area.y + 12; y + h <= area.y + area.h - 12; y += 28) {
          for (let x = area.x + 12; x + w <= area.x + area.w - 12; x += 32) {
            const distance = (x + w / 2 - p.x) ** 2 + (y + h / 2 - p.y) ** 2;
            if (distance >= nearest) continue;
            const gap = Math.hypot(Math.max(x - p.x, 0, p.x - x - w), Math.max(y - p.y, 0, p.y - y - h));
            if (gap < radius + 4) continue;
            const surface = { x, y, w, h };
            if (blocked(surface, excluded) || hitsNode(surface, node)) continue;
            nearest = distance; paint = surface;
            rect = { x: x + 7, y: y + 4, w: width, h: height, tx: x + 7, ty: y + h - 7, align: "left" };
          }
        }
      }
      if (!rect) continue;
      const alpha = priority <= 2 ? 1 : Math.max(0.6, Math.min(1, emphasis(node)));
      const endX = Math.max(paint.x, Math.min(p.x, paint.x + paint.w));
      const endY = Math.max(paint.y, Math.min(p.y, paint.y + paint.h));
      // a label outside the focused branch paints on the far (blurred) layer
      const pen = state.focusIds && el.farCtx && !state.focusIds.has(node.id) ? el.farCtx : ctx;
      const previousAlpha = pen.globalAlpha;
      pen.globalAlpha = node._fade ?? 1;
      const gap = Math.hypot(endX - p.x, endY - p.y);
      if (gap > radius + 14) {
        pen.strokeStyle = "rgba(172,185,202,0.32)"; pen.lineWidth = 0.8;
        pen.beginPath(); pen.moveTo(p.x + (endX - p.x) * (radius + 2) / gap, p.y + (endY - p.y) * (radius + 2) / gap);
        pen.lineTo(endX, endY); pen.stroke();
      }
      pen.beginPath(); pen.roundRect(paint.x, paint.y, paint.w, paint.h, 7);
      pen.fillStyle = state.canvasPalette?.background ?? "#101620"; pen.fill();
      pen.fillStyle = rgba(NODE_RGB.session, 0.045); pen.fill();
      pen.strokeStyle = rgba(workStatus || verifying ? colorOf(node) : NODE_RGB.pending, priority <= 2 ? 0.75 : workStatus === "Running" ? 0.45 : verifying ? 0.35 : 0.25); pen.lineWidth = 1; pen.stroke();
      if (workStatus) {
        pen.font = '600 9px system-ui, "Segoe UI", sans-serif'; pen.textBaseline = "alphabetic"; pen.textAlign = "left";
        pen.fillStyle = rgba(colorOf(node), alpha);
        pen.fillText(workStatus === "Verifying" ? "VERIFYING" : workStatus === "Next" ? "UP NEXT" : "RUNNING", paint.x + 8, paint.y + 13);
      }
      pen.font = font; pen.textBaseline = "alphabetic"; pen.textAlign = workStatus ? "left" : rect.align;
      pen.fillStyle = state.canvasPalette ? rgba(NODE_RGB.session, alpha) : node.kind === "agent" ? labelColour(node, alpha) : `rgba(222,229,239,${alpha})`;
      lines.forEach((text, index) => pen.fillText(text, workStatus ? paint.x + 8 : rect.tx, workStatus ? paint.y + 30 + index * 16 : rect.ty));
      pen.globalAlpha = previousAlpha ?? 1;
      state.labelRects.push(paint); node._label = { ...paint }; node._labelLines = lines; drawn += 1;
    }
    ctx.lineWidth = 1; ctx.textAlign = "left";
  }

  // ---------- hover tooltip ----------
  function tipKey() {
    if (state.hoverBubble) return `bubble:${state.hoverBubble.id}`;
    if (state.hoverNode) return `node:${state.hoverNode.id}`;
    if (state.hoverSpeech) return `speech:${state.hoverSpeech}`;
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
      const filed = Array.isArray(node.filedWork) ? node.filedWork : [];
      if (filed.length) {
        const busy = autopilotBusyIds(state.assistant);
        const running = filed.find((task) => busy.has(task.id));
        parts.push(`${filed.length} filed${running ? ` · running ${String(running.title ?? "").slice(0, 48)}` : ""}`);
      }
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
    // An orb with a callout already says what the tooltip would; keep the
    // tip for bubbles, checkpoint notes and orbs without a card.
    if (!key || state.panning || (state.hoverNode?._callout && !state.hoverBubble && !state.hoverSpeech)) {
      hideTip();
      return;
    }
    if (key !== state.tipNode) {
      state.tipNode = key;
      // The pointer is in canvas space (the canvas is fixed at inset 0) but the
      // tip lives in #idle-hud, which the app rail shifts right: measure the
      // HUD's origin once per tip, not on every move.
      const hudBox = el.hud?.getBoundingClientRect?.();
      state.tipOrigin = hudBox ? { left: hudBox.left, top: hudBox.top, width: hudBox.width } : null;
      const title = el.tip.querySelector(".tip-title");
      const meta = el.tip.querySelector(".tip-meta");
      if (state.hoverSpeech && !state.hoverBubble && !state.hoverNode) {
        // The full remark, for a bubble that had to clip itself.
        const bubble = state.speech.get(state.hoverSpeech);
        const speaker = state.nodes.find((entry) => entry.id === state.hoverSpeech);
        if (title) title.textContent = speaker ? (speaker.kind === "agent" ? speaker.role : speaker.label ?? speaker.kind) : "";
        if (meta) meta.textContent = bubble?.text ?? "";
      } else if (state.hoverBubble) {
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
    const origin = state.tipOrigin ?? { left: 0, top: 0, width: el.width };
    el.tip.style.setProperty("--x", `${Math.max(8, Math.min(origin.width - 260, px - origin.left + 14))}px`);
    el.tip.style.setProperty("--y", `${Math.max(12, py - origin.top - 12)}px`);
  }

  function hideTip() {
    state.tipNode = null;
    if (el.tip) el.tip.hidden = true;
  }

  // ---------- interaction ----------
  function nodeAt(x, y) {
    const area = usableArea();
    if (x < area.x || y < area.y || x > area.x + area.w || y > area.y + area.h) return null;
    let best = null;
    for (const node of state.nodes) {
      if (node._px == null || node.dying || node._absorbed || (node._fade ?? 1) <= 0.02) continue;
      const distance = Math.hypot(node._px - x, node._py - y);
      const hit = node.kind === "task" ? Math.abs(node._px - x) <= node._pr + 6 && Math.abs(node._py - y) <= node._pr + 6 : distance <= node._pr + 8;
      if (hit && (!best || distance < best.distance)) best = { node, distance };
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
    if (node?.kind === "music") {
      window.MefiMusic?.open?.();
      bumpHud();
      return;
    }
    // Clearing empties the detail: focus on one of its buttons (the close
    // button, Done, or a card whose node just left the graph) would fall to
    // <body>. Either surface can hold it, so ask both.
    const focusInCard = !node && (Boolean(el.info?.contains(document.activeElement)) || Boolean(el.nodePanel?.contains(document.activeElement)));
    state.selected = node ? { id: node.id, kind: node.kind, node, via: options.via ?? "pointer" } : null;
    if (!node) exitFocus(); // letting go of the selection lets go of the focus too
    if (node?.doneHold) ackDoneHold(node.id); // the click is the read
    if (node && !node.readOnly && (node.kind === "session" || node.kind === "todo" || node.kind === "task")) focusAssistant(node);
    if (node) dropPopups();
    computeBranch();
    // The rail carries the detail: reveal its tab and hand it the rail while a
    // node is picked, then give the rail back to the tab you were on.
    if (typeof setRailTab === "function") {
      if (el.railTabNode) el.railTabNode.hidden = !node || !railVisible();
      if (node && railVisible()) setRailTab("node", { save: false });
      else if (state.railTab === "node") setRailTab(state.railHome ?? "work", { save: false });
    }
    // Letting go of the selection also forgets that the owner asked for the
    // menus back, so the next node opens in inspect mode again.
    if (!node) state.focusOptOut = false;
    if (typeof setFocusMode === "function") setFocusMode(Boolean(node) && railVisible() && !state.focusOptOut);
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
    if (id === "brains") {
      window.MefiBrains?.open?.(params);
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
    if (node.kind === "task-group") { toggleTaskGroup(node); return; }
    if (node.groupMember?.canonical === false) return;
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
    if (node.kind === "task-group") return { text: `${node.taskGroup.members.length} tasks`, className: "badge" };
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
    return { text: window.MefiStage?.label?.(status, node.task) ?? status, className };
  }

  function appendTaskGroupInfo(info, node) {
    const group = node.taskGroup;
    if (!group) return;
    const toggle = document.createElement("button");
    toggle.className = "ghost";
    toggle.dataset.taskGroupToggle = group.id;
    const expanded = state.expandedTaskGroups.has(group.id);
    toggle.textContent = `${expanded ? "Collapse" : "Expand"} ${group.members.length} tasks`;
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.addEventListener("click", () => toggleTaskGroup(node));
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = "Running work stays visible. Saved member details remain here even when the graph is collapsed.";
    info.append(toggle, note);
    const list = document.createElement("div");
    list.className = "task-group-members";
    for (const member of group.members) {
      const task = member.task;
      const details = document.createElement("details");
      details.className = "card-cps";
      details.dataset.taskGroupMember = member.id;
      const summary = document.createElement("summary");
      const status = task.status === "awaiting_verification" ? "Verifying" : task.status ?? "saved";
      summary.textContent = `${task.title || member.id} · ${status}`;
      const prompt = document.createElement("p");
      prompt.className = "muted";
      prompt.style.whiteSpace = "pre-wrap";
      prompt.textContent = task.prompt || member.snapshot?.prompt || "No additional brief.";
      details.append(summary, prompt);
      const context = Object.fromEntries(["refs", "ideas", "files", "dependsOn", "acceptance", "acceptanceCriteria", "contextHistory", "handoff", "logs"].flatMap((key) => {
        const value = task[key] ?? member.snapshot?.[key];
        return value != null && (!Array.isArray(value) || value.length) ? [[key, value]] : [];
      }));
      if (Object.keys(context).length) {
        const saved = document.createElement("details");
        const heading = document.createElement("summary");
        heading.textContent = "Saved context and history";
        const history = document.createElement("pre");
        history.style.whiteSpace = "pre-wrap";
        history.style.overflowWrap = "anywhere";
        history.textContent = JSON.stringify(context, null, 2);
        saved.append(heading, history);
        details.append(saved);
      }
      if (member.canonical) {
        const open = document.createElement("button");
        open.className = "ghost mini"; open.textContent = "Open in Tasks";
        open.addEventListener("click", () => nav("tasks", { taskId: member.id, filter: "all" }));
        details.append(open);
      }
      list.append(details);
    }
    info.append(list);
  }

  // Work that finished while this node hosted it: the absorbed brief stays
  // readable on the card long after the node that flew home is gone.
  function appendAbsorbed(info, node) {
    const list = state.absorbed.get(node.id) ?? [];
    if (!list.length) return;
    const details = document.createElement("details");
    details.className = "card-cps absorbed-ledger";
    details.open = list.length <= 2;
    const summary = document.createElement("summary");
    summary.textContent = `Absorbed work (${list.length})`;
    details.append(summary);
    for (const entry of list.slice(0, node.kind === "assistant" ? ABSORBED_MAX : 6)) details.append(absorbedRow(entry));
    info.append(details);
  }

  // One absorbed brief: its verdict, what it was and when it sank in — a
  // click opens the task or the session it came from.
  function absorbedRow(entry) {
    const item = document.createElement("div");
    item.className = "cp-note checkpoint-note absorbed-row";
    item.dataset.ok = String(entry.ok !== false);
    const verdict = entry.kind === "job" ? "job" : entry.kind === "session" ? "session" : "done";
    item.textContent = `${verdict} · ${entry.title} · ${agoLabel(entry.absorbedAt ?? entry.at) ?? ""}`;
    item.title = entry.detail || entry.prompt || entry.title;
    if (entry.taskId) {
      item.style.cursor = "pointer";
      item.addEventListener("click", () => nav("tasks", { taskId: entry.taskId, filter: "all" }));
    } else if (entry.sessionId) {
      item.style.cursor = "pointer";
      item.addEventListener("click", () => nav("explorer", { sessionId: entry.sessionId }));
    }
    return item;
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
    const host = infoHost();
    if (!host) return;
    state.graphAreaAt = 0;
    state.hudRectsAt = 0;
    // Only one detail surface exists at a time: whichever host is not drawing
    // is emptied and hidden outright. The rail's own panel takes its
    // visibility from setRailTab, never from here.
    const spare = host === el.info ? el.nodePanel : el.info;
    if (spare) { spare.hidden = true; spare.textContent = ""; }
    const showHost = (visible) => { if (host !== el.nodePanel) host.hidden = !visible; };
    const selected = state.selected;
    // The assistant's surface moved into the rail; the floating card is only
    // the fallback for the narrow layout where the rail is hidden. Ask whether
    // the RAIL owns the assistant, not whether the Work feed is up: selecting
    // the assistant flips the rail to its Assistant tab (renderFeed), which
    // hides #idle-feed — and this guard then un-suppressed the card beside the
    // console the rail was already showing.
    if (railOwnsAssistant()) {
      showHost(false);
      if (host === el.nodePanel) host.textContent = "";
      state.feedDirty = true;
      renderFeed();
      return;
    }
    // A push re-renders the card while a message may be half typed: carry the
    // draft, its focus and both scroll positions across the rebuild so a
    // heartbeat can never snap the card or the thread back to an end.
    // clearDraft holds the text that was just sent — the draft only drops
    // when it is that text, so a chip send keeps what you were typing.
    const draftInput = host.querySelector(".assistant-composer input, .assistant-composer textarea");
    const draft = draftInput && draftInput.value.trim() !== String(clearDraft ?? "") ? { value: draftInput.value, focused: document.activeElement === draftInput } : null;
    const oldThread = host.querySelector(".assistant-thread");
    const threadTop = oldThread?.scrollTop ?? 0;
    const threadPinned = !oldThread || oldThread.scrollTop + oldThread.clientHeight >= oldThread.scrollHeight - 28;
    const cardTop = state.cardScrollId === selected?.id ? host.scrollTop : 0;
    el.infoParallel = null;
    if (!selected) {
      // The floating card fades out (styles.css presence) with what it last
      // showed; the next selection rebuilds it. The rail panel empties now.
      if (host === el.nodePanel) host.textContent = "";
      showHost(false);
      state.cardScrollId = null;
      return;
    }
    host.textContent = "";
    showHost(true);
    const node = selected.node;
    const info = host;
    const kinds = { root: "Constellation", session: "Session", todo: "Todo", task: "Task", "task-group": "Task group", assistant: "Assistant", folded: "Finished sessions", agent: "Agent" };

    const kicker = document.createElement("div");
    kicker.className = "card-kicker";
    const eyebrow = document.createElement("span");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = node.taskGroup ? "Task group" : node.groupMember ? "Saved group member" : kinds[node.kind] ?? "Node";
    const badgeInfo = statusBadge(node);
    const badge = document.createElement("span");
    badge.className = badgeInfo.className;
    badge.textContent = badgeInfo.text;
    const close = document.createElement("button");
    close.className = "ghost icon mini card-close";
    close.title = "Clear selection (Esc)";
    close.setAttribute("aria-label", "Clear selection");
    close.append(glyph("g-close"));
    close.addEventListener("click", () => releaseNode());
    kicker.append(eyebrow, badge, close);

    const title = document.createElement("h3");
    title.className = "card-title clamp-3";
    title.textContent = node.label ?? node.kind;
    title.title = node.label ?? node.kind;
    // The assistant card's eyebrow already reads "Assistant": no second line.
    info.append(kicker);
    if (node.kind !== "assistant" || String(node.label ?? "").trim().toLowerCase() !== "assistant") info.append(title);

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
      return v;
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
      action("Fit all", () => fitAll(), { title: "Rearrange and fit the node tree (F)" });
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

      // The chores the assistant filed for itself live here instead of on the
      // ring: one row per chore, running ones first.
      const filed = Array.isArray(node.filedWork) ? node.filedWork : [];
      if (filed.length) {
        const details = document.createElement("details");
        details.className = "card-cps";
        details.open = filed.length <= 3;
        const summary = document.createElement("summary");
        summary.textContent = `Filed by the assistant (${filed.length})`;
        details.append(summary);
        const busy = autopilotBusyIds(state.assistant);
        for (const task of filed.slice(0, 8)) {
          const item = document.createElement("div");
          item.className = "cp-note checkpoint-note";
          const status = busy.has(task.id) ? (window.MefiStage?.label?.("running") ?? "running") : (window.MefiStage?.label?.(task.status, task, { short: true }) ?? String(task.status ?? "open").replace("_", " "));
          item.classList.add("filed-row");
          if (busy.has(task.id)) item.classList.add("is-running");
          const name = document.createElement("span");
          name.className = "text";
          name.textContent = task.title ?? "task";
          const when = document.createElement("span");
          when.className = "when";
          when.textContent = status;
          item.append(name, when);
          item.title = task.prompt ?? task.title ?? "";
          item.style.cursor = "pointer";
          item.addEventListener("click", () => nav("tasks", { taskId: task.id, filter: "all" }));
          details.append(item);
        }
        info.append(details);
      }

      const threadHead = document.createElement("div");
      threadHead.className = "card-sub";
      threadHead.textContent = "Thread";
      const thread = document.createElement("div");
      thread.className = "assistant-thread";
      info.append(threadHead, thread);
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
          ? `Work on "${String(focused.label || focused.id).slice(0, 22).trimEnd()}${String(focused.label || focused.id).length > 22 ? "…" : ""}"`
          : "Message the assistant…";
      if (bridge) input.title = "Enter sends · Shift+Enter for a new line";
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

      // What the agents said to each other: the notes between seats, newest
      // first, unread ones lit — the loop's side conversations on record.
      const mailRows = Array.isArray(full?.mail) ? [...full.mail].filter((row) => row && row.from && row.to).sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).slice(0, 6) : [];
      if (mailRows.length) {
        const head = document.createElement("div");
        head.className = "card-sub";
        head.textContent = "Said to each other";
        const list = document.createElement("ul");
        list.className = "assistant-intel assistant-mail assistant-activity pin-list";
        for (const row of mailRows) {
          const li = document.createElement("li");
          li.style.borderLeftColor = agentHex(row.from);
          if (!row.readAt) li.classList.add("unread");
          const name = document.createElement("b");
          name.textContent = `${row.from} → ${row.to}`;
          name.style.color = agentHex(row.from);
          const text = document.createElement("span");
          text.className = "text";
          text.textContent = String(row.text ?? "");
          text.title = `${text.textContent}${row.readAt ? "" : " · unread"}`;
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
        steppers.append(createBuildParallelControl());
        info.append(steppers);
      }
      if (!roster.length) {
        const head = document.createElement("div");
        head.className = "card-sub";
        head.textContent = "Capacity";
        const control = createBuildParallelControl();
        control.classList.add("stepper-row");
        info.append(head, control);
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
        const head = document.createElement("div");
        head.className = "card-sub";
        head.textContent = "Recent";
        info.append(head);
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

      action("Open Explorer", () => nav("explorer", { assistant: true }), { primary: true, title: "The full thread in the Session explorer (E)" });
      action(full?.status === "paused" ? "Resume" : "Pause", () => assistantControl(full?.status === "paused" ? "start-work" : "pause", "control"), {
        title: "Pause or resume the assistant service",
      });
      action("Tidy", () => assistantControl("tidy", "tidy"), { title: "Archive done tasks, prune ideas, clear resolved requests" });
      action("Fix", () => assistantControl("fix", "fix"), { title: "Repair the catalog and data files, check the updater" });
      action("Oversee", () => assistantControl("overseer", "overseer"), { title: "Run the overseer — it reviews the assistant's own work, tunes prefs and files upgrades" });
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
    } else if (node.kind === "task-group") {
      row("tasks", node.taskGroup.members.length);
      row("source", "approved plan");
      info.append(kv);
      appendTaskGroupInfo(info, node);
      action("Open Tasks", () => nav("tasks"));
    } else if (node.kind === "task") {
      const task = node.task;
      const anchor = node.anchorSessionId ? nodeForSession(node.anchorSessionId) : null;
      // The kicker badge already says the status; the table starts with what it does not.
      if (node.readOnly) row("view", "read-only group member");
      const hold = node.doneHold ? state.doneHold.get(node.id) : null;
      if (hold) row("absorb", hold.ackedAt ? "read — sinking in" : "finished — click to read before it sinks");
      // Three counters read as one line: what the task carries with it.
      const carried = [["refs", (task.refs ?? []).length], ["logs", (task.logs ?? []).length], ["ideas", (task.ideas ?? []).length]];
      row("context", carried.some(([, count]) => count) ? carried.filter(([, count]) => count).map(([name, count]) => `${count} ${name}`).join(" · ") : "nothing attached yet");
      if (anchor) linkRow("anchored to", anchor.label ?? anchor.id, () => {
        selectNode(anchor);
        focusNode(anchor, { zoom: 1.4 });
      });
      // The assistant row only when it says something: focused here, or busy elsewhere.
      const taskFocus = assistantFull()?.focus;
      if (taskFocus?.kind === "task" && taskFocus.id === node.id) linkRow("assistant", "focused on this · unfocus", () => focusAssistant(null));
      else if (taskFocus?.id) row("assistant", `on "${String(taskFocus.label || taskFocus.id).slice(0, 30)}"`);
      info.append(kv);
      if (String(task.prompt ?? "").trim()) {
        const prompt = document.createElement("p");
        prompt.className = node.readOnly ? "muted" : "muted clamp-3";
        prompt.textContent = task.prompt;
        info.append(prompt);
      }
      appendTaskGroupInfo(info, node);
      if (!node.readOnly) appendNodeFolder(info, node);
      if (node.groupMember?.canonical !== false) action("Open in Tasks", () => primaryAction(node), { primary: true, title: "Tasks (T)" });
      if (!node.readOnly) {
      action("Work on it", () => workOnNode(node), {
        title: "Prioritize this task. Machine managed starts eligible work while Studio remains responsive; prerequisites, approval, file claims and any selected manual build limit still apply.",
      });
      action(
        "Done",
        async () => {
          const result = await confirmTaskDone(task);
          if (!result.ok) {
            window.MefiToast?.(`${task.title} · not marked done: ${result.error}`, "bad");
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
      }
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
        const todoCell = row("todos", node.stale ? "hidden while stale" : todos.length ? `${done} of ${todos.length} done` : "none yet");
        if (!node.stale && todos.length) {
          const meter = document.createElement("span");
          meter.className = "kv-meter";
          const bar = document.createElement("i");
          bar.style.setProperty("--pct", `${Math.round((done / todos.length) * 100)}%`);
          meter.append(bar);
          todoCell.append(meter);
        }
        const touch = state.touches.get(node.id);
        if (touch) row("touches", `${touch.count} in 90s`);
      } else {
        if (session) {
          linkRow("session", session.label ?? session.id, () => {
            selectNode(session);
            focusNode(session, { zoom: 1.4 });
          });
        }
        const index = todos.findIndex((entry) => entry.id === node.id);
        if (index >= 0) row("step", `${index + 1} of ${todos.length}`);
        if (session?.agent) row("agent", session.agent);
        if (session?.model) row("model", session.model);
      }
      const notes = state.checkpoints?.[sessionId] ?? [];
      if (notes.length) row("checkpoints", notes.length);
      const focused = assistantFull()?.focus;
      if (focused?.kind === node.kind && focused.id === node.id) linkRow("assistant", "focused on this · unfocus", () => focusAssistant(null));
      else if (focused?.id) row("assistant", `on "${String(focused.label || focused.id).slice(0, 30)}"`);
      info.append(kv);

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
      const workHint = "Prioritize this work. Machine managed starts eligible, independent work while Studio remains responsive; Pause, approvals, prerequisites and file claims still apply.";
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
    host.scrollTop = cardTop;
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
      else if (node.kind === "assistant") fields.push("assistant", node.sublabel, node.tone, ...(node.filedWork ?? []).map((task) => task?.title));
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
      el.orbitBtn.title = flat ? "Spin (3D view only)" : running ? "Spin on · Space pauses" : "Spin paused · Space resumes";
    }
    // The camera mode "orbit" reads as Overview on screen: Spin is the only
    // control that turns the tree, so the toolbar never shows two "Orbit"s.
    if (el.camOrbitBtn) {
      const on = state.camMode === "orbit";
      el.camOrbitBtn.setAttribute("aria-pressed", on ? "true" : "false");
      el.camOrbitBtn.title = on
        ? "Camera: overview — the whole tree stays framed · click for a free camera (C cycles overview / follow / free)"
        : "Camera: overview — keep the whole tree framed (C)";
    }
    if (el.camFollowBtn) {
      const on = state.camMode === "follow";
      el.camFollowBtn.setAttribute("aria-pressed", on ? "true" : "false");
      el.camFollowBtn.title = on
        ? `Following ${state.follow?.title ?? "active tasks"}. Click to hold this view.`
        : "Follow active tasks and their current work (C)";
    }
    if (el.viewBtn) {
      el.viewBtn.dataset.view = state.view;
      const viewLabel = el.viewBtn.querySelector(".label");
      if (viewLabel) viewLabel.textContent = state.view === "2d" ? "2D" : "3D";
      el.viewBtn.title = state.view === "2d" ? "View: flat 2D map (V toggles 3D)" : "View: 3D orbit (V toggles 2D)";
      el.viewBtn.setAttribute("aria-label", state.view === "2d" ? "Map: flat 2D" : "Map: 3D orbit");
    }
    if (el.labelsBtn) {
      el.labelsBtn.dataset.labels = state.labels;
      const label = el.labelsBtn.querySelector(".label");
      if (label) label.textContent = state.labels;
      el.labelsBtn.title = state.labels === "auto" ? "Auto labels: current work and inspected nodes · hover or search for more (L cycles labels)" : `Node labels: ${state.labels} (L cycles auto / all / none)`;
      el.labelsBtn.setAttribute("aria-label", `Node labels: ${state.labels}`);
    }
    // Map and Labels sit one menu away, so View ▾ carries their state.
    if (el.viewMenuBtn) el.viewMenuBtn.title = `View: ${state.view === "2d" ? "flat 2D map" : "3D orbit"} · labels ${state.labels} · zoom`;
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
    // Focus borrows the orbit quietly; only the owner's own switch is saved,
    // and it is also the setting that leaving a focused node goes back to.
    if (!options.quiet) {
      writeStore("mefiStudio.cmdOrbit", next);
      if (state.focusRestore) state.focusRestore.orbit = next;
    }
    syncViewControls();
    renderHint();
    if (changed && !options.quiet) window.MefiToast?.(next === "paused" ? "spin paused" : "spin resumed", "info");
  }

  // Camera autopilot. Orbit refits the whole constellation (the graph rebuild's
  // autoFit keeps it the largest frame that still shows every node). Follow
  // locks onto the node the agent's work sits on and moves as the work moves.
  // Free never moves on its own: it is where every direct camera gesture lands,
  // and the user's view wins until a mode is picked again.
  function applyCamMode() {
    if (state.camMode === "orbit") refitLayout();
    else if (state.camMode === "follow") updateFollowCamera(Date.now(), true);
    renderFollowStatus();
  }

  function setCamMode(mode, options = {}) {
    const next = CAM_MODES.includes(mode) ? mode : "orbit";
    const changed = next !== state.camMode;
    state.camMode = next;
    if (changed && next === "follow") {
      state.follow = null;
      state.followReadAt = 0;
      state.followZoomTarget = null;
      state.orbitVel = 0;
    } else if (changed) {
      state.followZoomTarget = null;
      if (next === "free") {
        state.camera.tx = state.camera.x;
        state.camera.ty = state.camera.y;
        state.camera.tz = state.camera.z;
      }
    }
    // Quiet + unchanged (a wheel tick in free mode, say) skips the DOM churn;
    // an explicit mode click always re-syncs and re-applies. A transient step
    // into free (a wheel zoom, a drag, a node click) lasts for this visit
    // only: the next launch starts from the mode the owner last picked.
    if (!options.quiet || changed) {
      if (changed && !options.transient) writeStore("mefiStudio.cmdCam", next);
      syncViewControls();
      renderHint();
      if (changed && !options.quiet) {
        window.MefiToast?.(
          next === "orbit" ? "camera: overview — the whole tree stays in frame" : next === "follow" ? "camera: follow — tracking the current work" : "camera: free",
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
    setCamMode("free", { quiet: true, transient: true });
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
    if (next === state.view) return;
    state.view = next;
    writeStore("mefiStudio.cmdView", next);
    if (next === "2d") state.orbitVel = 0; // no easing tail into the flat map
    syncViewControls();
    renderHint();
    refitLayout();
    if (state.camMode === "follow") applyCamMode(); // refit recentered; go back to the work node
    window.dispatchEvent(new CustomEvent("mefi-tree-view", { detail: { view: next } }));
    if (!state.settingsPreview) window.MefiToast?.(next === "2d" ? "2D map view" : "3D orbit view", "info");
  }

  // The toolbar's popovers hang from the button that opened them: under the
  // toolbar strip, right edges lined up with the button, inside the HUD (which
  // starts at the app menu's edge). The top bar runs to two rows below 1650px
  // and three below 760px, so the fixed top: 70px this replaces landed on the
  // composer there. The inline styles win over the .pop defaults.
  function placePop(pop, anchor) {
    if (!pop || !anchor || !el.hud) return;
    const button = anchor.getBoundingClientRect();
    if (!button.width && !button.height) return;
    const strip = anchor.closest?.(".cmd-tools")?.getBoundingClientRect?.() ?? button;
    const hud = el.hud.getBoundingClientRect();
    const edge = 12;
    const top = Math.round(Math.max(button.bottom, strip.bottom) - hud.top + 6);
    const widest = Math.max(edge, hud.width - pop.offsetWidth - edge);
    pop.style.top = `${top}px`;
    pop.style.right = `${Math.min(widest, Math.max(edge, Math.round(hud.right - button.right)))}px`;
    pop.style.maxHeight = `${Math.max(160, Math.round(hud.height - top - edge))}px`;
  }

  // Whether a HUD list can be seen: its own hidden flag says too little once
  // a breakpoint hides its corner (Legend and Usage go at 1100px and below).
  function shownOnScreen(node) {
    if (!node || node.hidden !== false) return false;
    return typeof node.checkVisibility === "function" ? node.checkVisibility() : (node.getClientRects?.().length ?? 0) > 0;
  }

  // The Usage breakdown is tracker.js's; Command only asks it to close, and
  // only while it is on screen. Says whether there was one to close.
  function closeUsagePop() {
    if (!shownOnScreen(el.usagePop) || typeof window.MefiUsageTracker?.setOpen !== "function") return false;
    window.MefiUsageTracker.setOpen(false);
    return true;
  }

  function onAmbienceOutside(event) {
    if (el.pop?.contains(event.target) || el.ambienceBtn?.contains(event.target)) return;
    closeAmbience();
  }

  function toggleAmbience(event) {
    if (!el.pop) return;
    if (el.pop.hidden) {
      closeViewMenu();
      closeUsagePop();
      el.pop.hidden = false;
      el.ambienceBtn?.setAttribute("aria-expanded", "true");
      placePop(el.pop, el.ambienceBtn);
      document.addEventListener("mousedown", onAmbienceOutside);
      // Opened from the keyboard, focus steps into the dialog itself so the
      // next Tab reaches its first row instead of Leave. Never onto a select:
      // a focused select holds the frame loop (holdForPicker).
      if (event?.detail === 0) el.pop.focus?.({ preventScroll: true });
      bumpHud();
    } else {
      closeAmbience();
    }
  }

  function closeAmbience({ focus = false } = {}) {
    if (!el.pop) return;
    if (!el.pop.hidden) document.removeEventListener("mousedown", onAmbienceOutside);
    el.pop.hidden = true;
    el.ambienceBtn?.setAttribute("aria-expanded", "false");
    if (focus) el.ambienceBtn?.focus?.({ preventScroll: true });
  }

  // View ▾ holds Map (2D/3D), Labels and zoom. A click, Enter or Space opens
  // it onto its first item; arrows and Home/End move, Esc closes it back onto
  // its button and Tab closes it on the way past. It stays open under its own
  // items (zoom twice, cycle the labels). Closed, it owns no key at all, so
  // every single-key shortcut still reaches the canvas.
  function viewMenuItems() {
    return [...(el.viewPop?.querySelectorAll?.("[role='menuitem']") ?? [])].filter((item) => !item.disabled);
  }

  function onViewMenuOutside(event) {
    if (el.viewPop?.contains(event.target) || el.viewMenuBtn?.contains(event.target)) return;
    closeViewMenu();
  }

  function openViewMenu() {
    if (!el.viewPop || el.viewPop.hidden === false) return;
    closeAmbience();
    closeUsagePop();
    el.viewPop.hidden = false;
    el.viewMenuBtn?.setAttribute("aria-expanded", "true");
    placePop(el.viewPop, el.viewMenuBtn);
    document.addEventListener("mousedown", onViewMenuOutside);
    viewMenuItems()[0]?.focus?.({ preventScroll: true });
    bumpHud();
  }

  function closeViewMenu({ focus = false } = {}) {
    if (!el.viewPop) return;
    if (el.viewPop.hidden === false) document.removeEventListener("mousedown", onViewMenuOutside);
    el.viewPop.hidden = true;
    el.viewMenuBtn?.setAttribute("aria-expanded", "false");
    if (focus) el.viewMenuBtn?.focus?.({ preventScroll: true });
  }

  function toggleViewMenu() {
    if (el.viewPop?.hidden === false) closeViewMenu({ focus: true });
    else openViewMenu();
  }

  // Keys inside the open menu stop here, so an arrow never also walks the
  // node tree underneath. Letters still bubble: V and L work from the menu.
  function viewMenuKey(event) {
    const items = viewMenuItems();
    if (!items.length) return;
    const at = items.indexOf(document.activeElement);
    let next = null;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = (at + 1) % items.length;
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = at < 0 ? items.length - 1 : (at - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeViewMenu({ focus: true });
      return;
    } else if (event.key === "Tab") {
      // Leave from the button, so Tab carries on along the toolbar.
      closeViewMenu({ focus: true });
      return;
    }
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    items[next].focus({ preventScroll: true });
  }

  function viewMenuFocusOut(event) {
    const next = event.relatedTarget;
    if (next && !el.viewPop?.contains(next) && next !== el.viewMenuBtn) closeViewMenu();
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
        fitAll();
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
      else fitAll();
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
    // What opened last closes first: the toolbar's popovers, then the
    // corner's Usage and Legend lists (only while they can be seen), and only
    // then the search, the inspected node and Command itself.
    if (el.viewPop && el.viewPop.hidden === false) {
      closeViewMenu({ focus: true });
      return true;
    }
    if (el.pop && el.pop.hidden === false) {
      closeAmbience({ focus: el.pop.contains(document.activeElement) });
      return true;
    }
    if (closeUsagePop()) return true;
    if (state.legendOpen && shownOnScreen(el.legendList)) {
      setLegend(false);
      return true;
    }
    if (state.query) {
      clearSearch();
      return true;
    }
    // The menus come back before the selection goes: one Esc to see the rest
    // of the app again without losing the node you were reading, a second to
    // let go of the node itself.
    if (state.focusMode) {
      state.focusOptOut = true;
      setFocusMode(false);
      return true;
    }
    if (state.focus || state.selected) {
      releaseNode();
      return true;
    }
    leave();
    return true;
  }

  // Leave Command for the view it was entered from; nav owns that memory.
  function leave() {
    if (window.MefiNav?.leaveCommand) window.MefiNav.leaveCommand();
    else exit();
  }

  // ---------- lifecycle ----------
  function canAmbientZen() {
    const top = window.MefiNav?.top?.();
    const focus = document.activeElement;
    return Boolean(state.ambientZenEnabled && state.active && !document.hidden && !state.settingsPreview &&
      !document.body.dataset.sheet && (!top || top === "command") &&
      !state.panning && !state.rotating && !state.query &&
      // No open menu or popover fades out from under the pointer: Ambience,
      // View and the Usage breakdown all hold Zen off while they are up.
      el.pop?.hidden !== false && el.viewPop?.hidden !== false &&
      document.getElementById?.("cmd-usage-pop")?.hidden !== false && (!state.feedMenuOpen || state.feedCollapsed) &&
      !Array.from(document.querySelectorAll?.("#idle-hud details[open]") ?? []).some((node) => !node.closest?.("[hidden]")) &&
      !focus?.matches?.("input, textarea, select, [contenteditable='true']"));
  }

  function setAmbientZen(active) {
    const next = Boolean(active);
    if (next === state.ambientZen || (next && !canAmbientZen())) return false;
    state.ambientZen = next;
    if (next) {
      state.zenRestore = { camera: { ...state.camera }, camMode: state.camMode, orbit: state.orbit, orbitVel: state.orbitVel, angle: state.angle, pitch: state.pitch, follow: state.follow, followZoomTarget: state.followZoomTarget };
      state.camMode = "orbit";
      state.orbit = noMotion() ? "paused" : "auto";
      state.orbitVel = 0;
      // Preserve managed anchors and framing. Ambient mode is a temporary
      // camera movement, never a layout change or an audio/capture gesture.
      hideTip();
    } else if (state.zenRestore) {
      // Resume the prior camera mode from this angle. Rewinding the ambient
      // orbit on the first mouse move would make every fixed point jump.
      const currentView = { camera: state.camera, angle: state.angle, pitch: state.pitch, orbitVel: 0 };
      Object.assign(state, state.zenRestore, currentView);
      state.zenRestore = null;
    }
    document.body.classList.toggle("command-zen", next);
    state.graphAreaAt = 0;
    state.hudRectsAt = 0;
    if (el.hud) { el.hud.inert = next; el.hud.classList.remove("dim"); }
    syncViewControls();
    return true;
  }

  function wakeAmbientZen(now = Date.now()) {
    state.lastInput = now;
    return setAmbientZen(false);
  }

  function setAmbientZenEnabled(enabled) {
    state.ambientZenEnabled = Boolean(enabled);
    writeStore("mefiStudio.ambientZen", state.ambientZenEnabled ? "1" : "0");
    if (el.ambientZen) el.ambientZen.checked = state.ambientZenEnabled;
    wakeAmbientZen();
    bumpHud();
  }

  function checkAmbientZen(now = Date.now()) {
    if (!canAmbientZen()) {
      if (state.ambientZen) setAmbientZen(false);
      state.lastInput = now;
      return false;
    }
    if (!state.ambientZen && now - state.lastInput >= AMBIENT_ZEN_MS) setAmbientZen(true);
    return state.ambientZen;
  }

  function setFeedCollapsed(collapsed, save = true) {
    state.feedCollapsed = Boolean(collapsed);
    el.feed?.classList.toggle("collapsed", state.feedCollapsed);
    if (el.feedContent) el.feedContent.hidden = state.feedCollapsed;
    el.feedToggle?.setAttribute("aria-expanded", String(!state.feedCollapsed));
    if (el.feedToggle) el.feedToggle.title = state.feedCollapsed ? "Expand live work" : "Collapse live work";
    if (save) writeStore("mefiStudio.cmdFeedCollapsed", state.feedCollapsed ? "1" : "0");
    if (typeof applyRailCollapsed === "function") applyRailCollapsed();
    state.graphAreaAt = 0;
    state.hudRectsAt = 0;
    if (state.selected?.kind === "assistant") { state.feedDirty = true; renderInfo(); renderFeed(); }
  }

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
    // node by id (any kind) and the zoom, restored in that order. A rail tab
    // ("ask" for waiting decisions) can be named by any caller.
    let applied = false;
    if (typeof params?.rail === "string" && typeof setRailTab === "function") { setRailTab(params.rail, { focus: true }); applied = true; }
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
    state.lastInput = Date.now();
    state.frameError = false;
    state.ambient = !force;
    // Keep the user's orbit choice; a fresh view starts with fixed points.
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
    closeViewMenu();
    el.canvas.hidden = false;
    if (el.far) el.far.hidden = false;
    el.hud.hidden = false;
    el.hud.classList.toggle("forced", !state.ambient);
    document.body.classList.add("command-active");
    resize();
    renderLegend();
    syncViewControls();
    setCamMode(state.camMode, { quiet: true }); // a saved follow/orbit mode resumes where it left off
    // The first build as a promise: the boot sequence holds its fade until
    // this settles, so the constellation is already populated when it shows.
    state.readyPromise = Promise.all([refreshTasks(true), window.MefiTree?.ready?.()])
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
    read("prefsGet").then((result) => {
      if (result?.ok && el.home) el.home.checked = result.prefs.commandHome !== false;
      if (result?.ok) writeStore("mefiStudio.commandHome", result.prefs.commandHome === false ? "0" : "1");
    });
    read("eyesCheckpointsRead").then((result) => {
      state.checkpoints = result?.checkpoints ?? {};
    });
    // The feed panel never opens cold: seed it from the store's recent
    // changes, then layer the live queue, briefing and autopilot status on top.
    read("eyesState").then((result) => {
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
    read("eyesRequestsRead").then((result) => {
      state.requests = Array.isArray(result?.requests) ? result.requests : [];
      state.feedDirty = true;
      if (state.active) renderFeed();
    }).catch(() => {});
    read("eyesBriefingRead").then((result) => {
      state.briefing = result?.briefing ?? null;
      state.feedDirty = true;
      if (state.active) renderFeed();
    }).catch(() => {});
    read("assistantStatus").then((result) => {
      adoptAssistantStatus(result?.status ?? result ?? null);
      state.feedDirty = true;
      if (state.active) renderFeed();
    }).catch(() => {});
    renderFeed();
    renderHint();
    window.MefiUsageTracker?.open?.();
    bumpHud();
    state.lastTouch = Date.now();
    state.popupAt = Date.now() + 6000;
    if (state.zen && !state.settingsPreview) {
      bell({ long: true, low: true, level: 1 });
      bell({ quick: true, level: 0.7 });
    }
    // exit() handed the capture back. Take it again once per entry, bells on
    // or off, rather than on every bell: a refused request must not re-ask each
    // chime. Display capture needs a user gesture, so a gestureless auto-enter
    // can leave this pending — the input listener below retries on the first
    // real key/click.
    if (state.reactive && !state.settingsPreview) ensureReactiveInput();
    frameRequest = requestAnimationFrame(frame);
    state.timers.refresh = setInterval(tick, 4000);
    // A sheet may already cover the constellation (the quiet clock can open it
    // underneath one); stealing focus would break that dialog.
    if (!document.body.dataset.sheet) el.canvas.focus?.({ preventScroll: true });
    window.dispatchEvent(new CustomEvent("mefi:command", { detail: { active: true } }));
  }

  function exit() {
    if (!state.active) return;
    setAmbientZen(false);
    state.active = false;
    cancelAnimationFrame(frameRequest);
    frameRequest = 0;
    closeAmbience();
    closeViewMenu();
    hideTip();
    clearSearch();
    el.canvas.hidden = true;
    if (el.far) { el.far.hidden = true; el.far.classList?.remove("focused", "soft"); }
    state.focus = null;
    state.focusRestore = null;
    state.focusIds = null;
    state.hoverCallout = null;
    state.callouts.clear();
    state.calloutRects = [];
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
    for (const surface of [el.info, el.nodePanel]) {
      if (!surface) continue;
      surface.hidden = true;
      surface.textContent = "";
    }
    if (el.railTabNode) el.railTabNode.hidden = true;
    if (typeof setFocusMode === "function") setFocusMode(false);
    state.focusOptOut = false;
    state.cardScrollId = null;
    if (el.feedChat) el.feedChat.hidden = true;
    if (el.feedActivity) el.feedActivity.hidden = false;
    if (el.empty) el.empty.hidden = true;
    for (const popup of state.popups) popup.image.remove();
    state.popups = [];
    state.particles = [];
    state.pulses = [];
    state.speech.clear();
    state.speechRects = [];
    state.hoverSpeech = null;
    state.deferred = [];
    state.agentTrails.clear();
    const playerAudio = window.MefiMusic?.getAudioElement?.();
    if (state.audio?.state === "running" && !(playerAudio && state.mediaElements.has(playerAudio))) state.audio.suspend().catch(() => {});
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
    if (document.body.dataset.sheet && !(state.settingsPreview && document.body.dataset.sheet === "music")) return;
    if (pickerHeld()) return; // an opening picker gets the main thread; the next tick catches up
    if (document.hidden) return; // hidden app: make no fetch; the visibilitychange listener snaps the view back on show
    refreshCommandBacklog();
    refreshGraph();
    checkCollisions();
    updateTelemetry();
    if (autopilotJobs(state.assistant).length || chatMode()) state.feedDirty = true; // "running: … · Ns" and the chat status line age between status pushes
    renderFeed();
    globalThis.MefiUsageTracker?.tick?.();
    if (state.ambient && !state.settingsPreview && Date.now() - state.popupAt > POPUP_MS) {
      state.popupAt = Date.now();
      popup();
    }
  }

  async function checkCollisions() {
    try {
      const result = await window.mefiStudio?.eyesCollisions?.();
      // Only live activity keeps the collision tint. An idle-only group is
      // history — the fix flow already treats it as "finish and merge" — so
      // sessions with no active edit must never enter the live set.
      const colliding = (result?.collisions ?? []).flatMap((collision) =>
        (collision.sessions ?? [])
          .filter((entry) => entry && typeof entry === "object" && entry.active === true)
          .map((entry) => entry.sessionId)
      );
      const liveColliding = (result?.presence ?? [])
        .filter((row) => row?.colliding)
        .flatMap((row) => (row.editors ?? [])
          .filter((entry) => entry && typeof entry === "object" && entry.active === true)
          .map((entry) => entry.sessionId));
      state.collisionSessions = new Set([...colliding, ...liveColliding].filter(Boolean));
    } catch {
      state.collisionSessions = new Set();
    }
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;
    // Writing a canvas's width clears and reallocates its bitmap (about 13 MB
    // each at 1080p and 125%), so an entry or a no-op resize keeps both.
    const bitmapW = Math.round(width * dpr);
    const bitmapH = Math.round(height * dpr);
    const fit = (canvas, ctx) => {
      if (canvas.width !== bitmapW || canvas.height !== bitmapH) {
        canvas.width = bitmapW;
        canvas.height = bitmapH;
      }
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
      ctx.setTransform(bitmapW / width, 0, 0, bitmapH / height, 0, 0);
    };
    fit(el.canvas, el.ctx);
    if (el.far && el.farCtx) fit(el.far, el.farCtx);
    el.width = width;
    el.height = height;
    state.labelWidths.clear();
    state.speechLineCache?.clear();
    state.hudRectsAt = 0;
    state.graphAreaAt = 0;
    state.railRestWidth = null;
    state.center = null;
    if (state.camMode === "orbit") autoFit(); // a new window still shows every node
  }

  function armIdleTimer() {
    if (state.timers.idle) clearInterval(state.timers.idle);
    state.timers.idle = setInterval(() => {
      if (state.active) { checkAmbientZen(); return; }
      if (document.hidden) return; // a hidden window never idles into Command: no capture, bells or fetch work off-screen
      if (Date.now() - state.lastInput > IDLE_MS) enter();
    }, 1000);
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
    ["cmd-fit", "F", "Rearrange and fit the whole node tree"],
    ["cmd-branch", "Shift F", "Fit the selected branch"],
    ["cmd-home", "Home", "Select the root and fit"],
    ["cmd-zoom", "+ − 0", "Zoom in · out · reset"],
    ["cmd-orbit", "Space", "Pause / resume the spin"],
    ["cmd-cam", "C", "Camera: overview / follow / free"],
    ["cmd-view", "V", "Switch 3D orbit / flat 2D map"],
    ["cmd-labels", "L", "Node labels: auto / all / none"],
    ["cmd-search", "S", "Find a session, todo or task"],
    ["cmd-compose", "N", "Add a task"],
    ["cmd-assistant", "M", "Message the assistant"],
  ];

  function init() {
    if (!el.canvas) {
      el.canvas = document.getElementById("idle-layer");
    // The far layer: the sky, and whatever a focused branch pushes behind it.
    el.far = document.getElementById("idle-layer-far");
    el.farCtx = el.far?.getContext?.("2d") ?? null;
      el.hud = document.getElementById("idle-hud");
      if (!el.canvas) return;
      el.ctx = el.canvas.getContext("2d");
      el.width = window.innerWidth;
      el.height = window.innerHeight;
    }
    syncGraphTheme();
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
    el.chatLogNewWork = document.getElementById("cmd-chat-new-work");
    el.chatLogNewWorkState = document.getElementById("cmd-chat-new-work-state");
    el.rail = document.getElementById("cmd-rail");
    el.appRail = document.getElementById("app-rail");
    el.railBody = document.getElementById("cmd-rail-body");
    el.nodePanel = document.getElementById("cmd-node");
    el.railTabNode = document.getElementById("cmd-rail-tab-node");
    el.railTabs = [...(el.rail?.querySelectorAll(".rail-tab[data-rail-view]") ?? [])];
    el.railWorkBadge = document.getElementById("cmd-rail-work-badge");
    el.railAssistantBadge = document.getElementById("cmd-rail-assistant-badge");
    el.railAskBadge = document.getElementById("cmd-rail-ask-badge");
    el.settings = document.getElementById("cmd-settings");
    el.settingsState = document.getElementById("cmd-settings-state");
    el.glanceAutopilot = document.getElementById("cmd-glance-autopilot");
    el.glanceWorkers = document.getElementById("cmd-glance-workers");
    el.glanceMode = document.getElementById("cmd-glance-mode");
    el.done = document.getElementById("cmd-done");
    el.doneList = document.getElementById("cmd-done-list");
    el.doneState = document.getElementById("cmd-done-state");
    el.doneRefresh = document.getElementById("cmd-done-refresh");
    el.doneToggle = document.getElementById("cmd-done-toggle");
    el.doneClear = document.getElementById("cmd-done-clear");
    el.doneFilters = [...document.querySelectorAll("#cmd-done-filter [data-done-filter]")];
    el.asks = document.getElementById("cmd-asks");
    el.askList = document.getElementById("cmd-ask-list");
    el.askState = document.getElementById("cmd-ask-state");
    el.telemetry = document.getElementById("idle-telemetry");
    el.taskInput = document.getElementById("idle-task-input");
    el.taskAdd = document.getElementById("idle-task-add");
    el.home = document.getElementById("idle-home");
    el.zen = document.getElementById("idle-zen");
    el.ambientZen = document.getElementById("idle-ambient-zen");
    el.reactive = document.getElementById("idle-reactive");
    el.musicToggle = document.getElementById("idle-music-toggle");
    el.musicStatus = document.getElementById("idle-music-status");
    el.musicLevel = document.getElementById("idle-music-level");
    el.source = document.getElementById("idle-source");
    el.profile = document.getElementById("idle-profile");
    el.backdrop = document.getElementById("idle-backdrop");
    el.bubbles = document.getElementById("idle-bubbles");
    el.cardStyle = document.getElementById("idle-card-style");
    el.chatAbsorbed = document.getElementById("idle-chat-absorbed");
    el.chatAbsorbedList = document.getElementById("idle-chat-absorbed-list");
    el.exitBtn = document.getElementById("idle-exit");
    el.search = document.getElementById("idle-search");
    el.searchCount = document.getElementById("idle-search-count");
    el.fitBtn = document.getElementById("idle-fit");
    el.orbitBtn = document.getElementById("idle-orbit");
    el.camOrbitBtn = document.getElementById("idle-cam-orbit");
    el.camFollowBtn = document.getElementById("idle-cam-follow");
    el.followStatus = document.getElementById("idle-follow-status");
    el.zoomIn = document.getElementById("idle-zoom-in");
    el.zoomOut = document.getElementById("idle-zoom-out");
    el.labelsBtn = document.getElementById("idle-labels");
    el.viewBtn = document.getElementById("idle-view");
    el.feed = document.getElementById("idle-feed");
    el.feedToggle = document.getElementById("idle-feed-toggle");
    el.feedContent = document.getElementById("idle-feed-content");
    el.feedDot = document.getElementById("idle-feed-dot");
    el.feedState = document.getElementById("idle-feed-state");
    el.feedParallel = document.getElementById("idle-feed-parallel");
    el.feedBuildMode = document.getElementById("idle-feed-build-mode");
    el.feedAgentMode = document.getElementById("idle-feed-agent-mode");
    el.settingsAgentMode = document.getElementById("idle-settings-agent-mode");
    el.feedAgentModeNote = document.getElementById("idle-feed-agent-mode-note");
    el.stopAll = document.getElementById("idle-stop-all");
    el.restart = document.getElementById("idle-restart");
    el.stopState = document.getElementById("idle-stop-state");
    el.feedNow = document.getElementById("idle-feed-now");
    el.feedMetrics = document.getElementById("idle-feed-metrics");
    el.feedQueue = document.getElementById("idle-feed-queue");
    el.feedAttention = document.getElementById("idle-feed-attention");
    el.feedQueueCount = document.getElementById("idle-feed-queue-count");
    el.feedAgents = document.getElementById("idle-feed-agents");
    el.feedAgentsCount = document.getElementById("idle-feed-agents-count");
    el.feedAgentsSection = document.getElementById("idle-feed-agent-section");
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
    el.chatNewWorkState = document.getElementById("idle-chat-new-work-state");
    el.chatChips = document.getElementById("idle-chat-chips");
    el.autopilotToggle = document.getElementById("idle-autopilot");
    el.ambienceBtn = document.getElementById("idle-ambience");
    el.pop = document.getElementById("idle-ambience-pop");
    el.viewMenuBtn = document.getElementById("idle-view-menu");
    el.viewPop = document.getElementById("idle-view-pop");
    el.usagePop = document.getElementById("cmd-usage-pop");
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
    if (el.ambientZen) {
      el.ambientZen.checked = state.ambientZenEnabled;
      el.ambientZen.addEventListener("change", () => setAmbientZenEnabled(el.ambientZen.checked));
    }
    if (el.zen) {
      el.zen.checked = state.zen;
      el.zen.addEventListener("change", () => {
        state.zen = el.zen.checked;
        writeStore("mefiStudio.zen", state.zen ? "1" : "0");
        if (state.zen) bell({ long: true, low: true });
        else if (state.audio?.state === "running" && !state.reactive && !state.mediaElements.has(window.MefiMusic?.getAudioElement?.())) state.audio.suspend().catch(() => {});
      });
    }
    if (el.reactive) {
      el.reactive.checked = state.reactive;
      el.reactive.addEventListener("change", () => setMusicReactive(el.reactive.checked));
    }
    el.musicToggle?.addEventListener("click", () => setMusicReactive(!state.reactive || !state.inputStream && !state.localAudio && !state.inputPending && (state.audioSource !== "local" || Boolean(state.inputError))));
    renderMusicStatus(true);
    if (el.source) {
      el.source.value = state.audioSource;
      el.source.disabled = false;
      el.source.addEventListener("change", () => setAudioSource(el.source.value));
    }
    if (el.backdrop) {
      el.backdrop.innerHTML = BACKDROP_ORDER.map((key) => `<option value="${key}" ${key === state.backdrop ? "selected" : ""}>${BACKDROPS[key]}</option>`).join("");
      el.backdrop.addEventListener("change", () => setBackdrop(el.backdrop.value));
    }
    if (el.bubbles) {
      el.bubbles.checked = state.bubbles;
      el.bubbles.addEventListener("change", () => setBubbles(el.bubbles.checked));
    }
    if (el.cardStyle) {
      el.cardStyle.value = state.cardStyle;
      el.cardStyle.addEventListener("change", () => setCardStyle(el.cardStyle.value));
    }
    el.exitBtn?.addEventListener("click", leave);
    watchPickers();
    el.home?.addEventListener("change", () => {
      window.mefiStudio?.prefsSet?.({ commandHome: el.home.checked });
      writeStore("mefiStudio.commandHome", el.home.checked ? "1" : "0");
      window.MefiToast?.(`Workspace ${el.home.checked ? "opens" : "stays off"} on launch`, "info");
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

    el.fitBtn?.addEventListener("click", () => fitAll());
    el.orbitBtn?.addEventListener("click", () => setOrbit());
    el.camOrbitBtn?.addEventListener("click", () => setCamMode(state.camMode === "orbit" ? "free" : "orbit"));
    el.camFollowBtn?.addEventListener("click", () => setCamMode(state.camMode === "follow" ? "free" : "follow"));
    el.zoomOut?.addEventListener("click", () => userZoom(state.zoom * 0.89));
    el.zoomIn?.addEventListener("click", () => userZoom(state.zoom * 1.12));
    el.labelsBtn?.addEventListener("click", () => setLabels(nextLabels()));
    el.viewBtn?.addEventListener("click", () => setView(state.view === "2d" ? "3d" : "2d"));
    // Busy while the host saves, and back to the confirmed state on failure:
    // a switch that shows On when nothing was saved would say work is running.
    el.autopilotToggle?.addEventListener("change", async () => {
      const toggle = el.autopilotToggle;
      const wanted = toggle.checked;
      if (!window.mefiStudio?.assistantAutopilot) return;
      toggle.disabled = true;
      toggle.setAttribute("aria-busy", "true");
      try {
        const result = await window.mefiStudio.assistantAutopilot({ enabled: wanted, execute: wanted });
        if (!result || result.ok === false) throw new Error(result?.error ?? "the host did not confirm it");
      } catch (error) {
        toggle.checked = !wanted;
        window.MefiToast?.(`Autopilot not saved · ${String(error?.message ?? error)}`, "bad");
      } finally {
        toggle.disabled = false;
        toggle.removeAttribute("aria-busy");
      }
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
    el.chatPause?.addEventListener("change", () => void changeNewWork(el.chatPause.checked));
    el.chatLogNewWork?.addEventListener("change", () => void changeNewWork(el.chatLogNewWork.checked));
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
    // The rail's tabs: one visible view, roving focus, remembered between runs.
    for (const button of el.railTabs ?? []) button.addEventListener("click", () => setRailTab(button.dataset.railView));
    el.rail?.querySelector(".rail-tabs")?.addEventListener("keydown", (event) => {
      // The Node tab is only there while something is selected: walk the tabs
      // that are actually on screen, so an arrow never lands on nothing.
      const tabs = (el.railTabs ?? []).filter((button) => !button.hidden);
      const index = tabs.findIndex((button) => button.getAttribute("aria-selected") === "true");
      let next = null;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = tabs.length - 1;
      if (next === null || !tabs[next]) return;
      event.preventDefault();
      setRailTab(tabs[next].dataset.railView, { focus: true });
    });
    el.doneRefresh?.addEventListener("click", () => void loadDoneLog());
    el.doneToggle?.addEventListener("click", () => setDoneCollapsed(!state.doneCollapsed));
    el.doneClear?.addEventListener("click", () => void clearDoneLog());
    for (const button of el.doneFilters ?? []) button.addEventListener("click", () => setDoneFilter(button.dataset.doneFilter));
    setDoneCollapsed(state.doneCollapsed, { save: false });
    setRailTab(state.railTab, { save: false });
    document.getElementById("idle-chat-explorer")?.addEventListener("click", () => nav("explorer", { assistant: true }));
    el.ambienceBtn?.addEventListener("click", toggleAmbience);
    // A way out of Ambience (Style & sound ↗) closes it on the way.
    el.pop?.addEventListener("click", (event) => { if (event.target?.closest?.("[data-nav]")) closeAmbience(); });
    el.viewMenuBtn?.addEventListener("click", toggleViewMenu);
    el.viewPop?.addEventListener("keydown", viewMenuKey);
    el.viewPop?.addEventListener("focusout", viewMenuFocusOut);
    // Both popovers hang from their buttons, so they follow them on a resize.
    window.addEventListener("resize", () => {
      if (el.pop?.hidden === false) placePop(el.pop, el.ambienceBtn);
      if (el.viewPop?.hidden === false) placePop(el.viewPop, el.viewMenuBtn);
    });
    el.legendToggle?.addEventListener("click", () => setLegend(!state.legendOpen));
    el.feedMenu?.addEventListener("click", () => setFeedMenu(!state.feedMenuOpen));
    el.feedToggle?.addEventListener("click", () => setFeedCollapsed(!state.feedCollapsed));
    setFeedCollapsed(state.feedCollapsed, false);
    el.feedParallel?.addEventListener("change", () => void changeBuildParallel(el.feedParallel.value));
    el.feedBuildMode?.addEventListener("change", () => void changeBuildMode(el.feedBuildMode.value));
    el.feedAgentMode?.addEventListener("change", () => void changeAgentMode(el.feedAgentMode.value));
    el.settingsAgentMode?.addEventListener("change", () => void changeAgentMode(el.settingsAgentMode.value));
    el.stopAll?.addEventListener("click", () => void stopAllAgents());
    el.restart?.addEventListener("click", () => void restartStudio());
    setFeedMenu(state.feedMenuOpen);
    window.addEventListener("mefi:project-changed", projectChanged);
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
      // A speech bubble belongs to its speaker: clicking it opens the card
      // (an agent's lands on the hub, like clicking the agent itself).
      const speaker = speechAt(x, y);
      if (speaker) {
        selectNode(speaker.kind === "agent" ? assistantNode() ?? speaker : speaker, { via: "speech" });
        return;
      }
      // The finished "!" reads its task: select it, the ack follows.
      const exclNode = exclAt(x, y);
      if (exclNode) {
        selectNode(exclNode, { via: "excl" });
        return;
      }
      // An orb (or its label) wins over a card behind it; a callout belongs to
      // its node, so pressing the card is pressing the orb. An agent is part
      // of the assistant: its click lands on the hub.
      const hit = nodeAt(x, y) ?? calloutAt(x, y);
      const node = hit && hit.kind === "agent" ? assistantNode() ?? hit : hit;
      state.panning = { x: event.clientX, y: event.clientY, cam: { ...state.camera, tx: state.camera.x, ty: state.camera.y, tz: state.camera.z }, moved: false, node };
    });
    el.canvas.addEventListener("dblclick", (event) => {
      const rect = el.canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const bubbleNode = bubbleAt(x, y);
      if (bubbleNode) {
        selectNode(bubbleNode, { via: "bubble" });
        const details = infoHost()?.querySelector("details.card-cps");
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
      else fitAll();
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
          setCamMode("free", { quiet: true, transient: true }); // a drag is the user's camera now
          hideTip();
        }
        const scale = Math.max(0.01, state.fit * state.zoom * (state.overviewScale ?? 1));
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
      state.hoverSpeech = state.hoverNode || state.hoverBubble ? null : speechAt(x, y)?.id ?? null;
      // A hovered callout lifts and sharpens while the rest softens; the card
      // is its own explanation, so no tooltip rides along.
      state.hoverCallout = state.hoverNode || state.hoverBubble || state.hoverSpeech ? null : calloutAt(x, y)?.id ?? null;
      el.canvas.style.cursor = state.hoverNode || state.hoverBubble || state.hoverSpeech || state.hoverCallout ? "pointer" : "default";
      if (state.hoverCallout) hideTip();
      else refreshTip(x, y);
    });
    el.canvas.addEventListener("mouseleave", () => {
      state.hoverNode = null;
      state.hoverBubble = null;
      state.hoverSpeech = null;
      state.hoverCallout = null;
      hideTip();
    });
    window.addEventListener("mouseup", () => {
      if (state.panning && !state.panning.moved) {
        const node = state.panning.node;
        // A click on a node or its callout focuses it: the camera closes in
        // (less on a parent, so its children stay in frame) and the rest of
        // the tree keeps turning, softly blurred, behind it. Empty canvas
        // lets go and brings the whole tree back into view.
        if (node) enterFocus(node);
        else releaseNode();
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
        // Proportional to the wheel's own delta: a mouse notch (100 px, or 3
        // lines) is the same 8% step as before, while a trackpad's stream of
        // small deltas zooms in small steps instead of 8% per event.
        const perUnit = event.deltaMode === 1 ? 0.0278 : event.deltaMode === 2 ? 0.0834 : 0.000834;
        const delta = Math.max(-240, Math.min(240, Number(event.deltaY) || 0));
        if (delta) userZoom(state.zoom * Math.exp(-delta * perUnit));
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
    // {ok, status} — accept either shape here. The roster counts the graph
    // rebuild put in this slot survive the push (adoptAssistantStatus).
    window.mefiStudio?.onAssistantStatus?.((status) => {
      adoptAssistantStatus(status?.status ?? status ?? null);
      renderNewWorkControl();
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
      const signature = jobs.map((job) => job.taskId ?? job.sessionId ?? job.title).sort().join("|");
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
      wakeAmbientZen();
      if (document.hidden) return;
      if (state.active) tick();
      else if (Date.now() - state.lastInput > IDLE_MS) enter();
    });
  }

  // Any interaction resets the quiet clock; a key, wheel or touch also turns the
  // screensaver into a menu (a bare mouse move must not).
  ["mousemove", "pointerdown", "wheel", "touchstart", "keydown", "focusin"].forEach((type) =>
    window.addEventListener(
      type,
      () => {
        const woke = wakeAmbientZen();
        if (state.active && type !== "mousemove") {
          state.ambient = false;
          el.hud?.classList.add("forced");
          // A gestureless auto-enter can leave a pending display-capture
          // request refused; a real key or click is the retry point.
          if (!woke && type !== "focusin" && type !== "pointerdown" && state.reactive && !state.settingsPreview && !state.inputStream && !state.inputPending) ensureReactiveInput();
        }
        bumpHud();
      },
      { passive: true, capture: true }
    )
  );

  window.addEventListener("mefi-music-change", syncMusicNode);
  window.addEventListener("mefi-theme-change", syncGraphTheme);
  window.addEventListener("mefi-tree-preferences", (event) => applyTreePreferences(event.detail ?? {}));
  applyTreePreferences(window.MefiMusic?.graphPreferences?.() ?? {});

  window.MefiIdle = {
    init,
    enter,
    exit,
    simulate,
    profiles: PROFILES,
    selectFirst,
    agentMotionStatus: () => state.nodes.filter((node) => node.kind === "agent").map((node) => ({
      id: node.id, role: node.role, phase: node.phase ?? null, retiring: Boolean(node.retiring), dying: Boolean(node.dying),
      opacity: node._absorbed ? 0 : node._fade ?? node.opacity ?? 1,
      world: { x: node.x, y: node.y, z: node.z }, screen: { x: node._px, y: node._py },
    })),
    debugNodes: () => state.nodes.map((node) => ({ id: node.id, kind: node.kind, label: node.label, workStatus: node._workLabel, filedWork: (node.filedWork ?? []).map((task) => task.id), x: node._px, y: node._py, radius: node._pr, layoutAnchor: node._layoutAnchor ? { ...node._layoutAnchor } : null, labelRect: node._label ? { ...node._label } : null, labelLines: [...(node._labelLines ?? [])], cardRect: node._cardRect ? { ...node._cardRect } : null, bubbleRect: node._bubblePaint ? { ...node._bubblePaint } : null, bubbleHitRect: node._bubble ? { x: node._bubble.x, y: node._bubble.y, w: node._bubble.w, h: node._bubble.h } : null, shape: nodeVisualProfile(node).shape, visualStyle: state.nodeStyle, audioResponse: node._audioResponse ? { ...node._audioResponse } : null, orbitTrail: node._orbitTrail ? { ...node._orbitTrail } : null, extraGlow: node._extraGlow === true })),
    graphViewport: () => ({ ...usableArea() }),
    geometryStatus: () => ({ view: state.view, angle: state.angle, pitch: state.pitch, links: state.edges.map(({ a, b }) => ({ from: state.nodes[a]?.id ?? null, to: state.nodes[b]?.id ?? null })), nodes: state.nodes.map((node) => ({ id: node.id, anchor: node._layoutAnchor ? { ...node._layoutAnchor } : null, world: { x: node.x, y: node.y, z: node.z }, projected: project(node._layoutAnchor ?? node) })) }),
    setSettingsPreview,
    ambientZenStatus: () => ({ enabled: state.ambientZenEnabled, active: state.ambientZen, delayMs: AMBIENT_ZEN_MS, idleMs: Math.max(0, Date.now() - state.lastInput), eligible: canAmbientZen(), feedCollapsed: state.feedCollapsed }),
    settingsPreviewStatus: () => ({ active: Boolean(state.settingsPreview), viewport: state.settingsPreview ? { ...state.settingsPreview } : null, camera: { ...state.camera }, zoom: state.zoom, fit: state.fit, previousWasActive: state.previewRestore?.wasActive ?? null }),
    followStatus: () => ({ mode: state.camMode, taskId: state.follow?.taskId ?? null, nodeId: state.follow?.key ?? null, title: state.follow?.title ?? null, stage: state.follow?.stage ?? null, reason: state.follow?.reason ?? null, since: state.follow?.since ?? null, zoom: state.zoom, targetZoom: state.followZoomTarget }),
    audioStatus,
    audioWaveStatus: () => ({ connections: (state.active && state.reactive && (state.inputStream || state.localAudio) && !noMotion() ? state.audioWaves ?? [] : []).map((wave) => ({ ...wave, points: wave.points.map((point) => ({ ...point })) })) }),
    isActive: () => state.active,
    escape,
    handleKey,
    selection,
    bumpHud,
    clearSearch,
    select,
    fitAll,
    setOrbit,
    setView,
    setLabels,
    setAudioSource,
    setMusicReactive,
    setAudioResponse,
    setAudioEffects,
    setBackdrop,
    setBubbles,
    // What the sky is showing and what the agents are saying — for the
    // capture tour, the tests and the dev tools.
    backdropStatus: () => ({ choice: state.backdrop, scene: activeBackdrop(), theme: state.themeKey, options: [...BACKDROP_ORDER] }),
    speechStatus: () => [...state.speech.values()].map((bubble) => ({ id: bubble.id, text: bubble.text, kind: bubble.kind, age: Date.now() - bubble.at, ttl: bubble.ttl })),
    say: (id, text, options) => Boolean(say(id, text, options)),
    absorbedStatus: () => (state.absorbed.get("__assistant__") ?? []).map((entry) => ({ ...entry })),
    // Callouts and focus — the placements the cards hold, and what a click
    // brought the camera onto.
    enterFocus: (id) => enterFocus(typeof id === "string" ? state.nodes.find((node) => node.id === id) ?? null : id),
    exitFocus,
    setCardStyle,
    focusStatus: () => ({ id: state.focus?.id ?? null, kind: state.focus?.kind ?? null, since: state.focus?.since ?? null, restore: state.focusRestore ? { ...state.focusRestore } : null, sharp: state.focusIds ? [...state.focusIds] : null, farLayer: Boolean(el.farCtx), hover: state.hoverCallout, zoom: state.zoom, orbit: state.orbit }),
    calloutStatus: () => state.nodes.filter((node) => node._callout).map((node) => ({ id: node.id, kind: node.kind, side: node._callout.side, vert: node._callout.vert, length: node._callout.length, rect: { ...node._callout.rect }, hit: { ...node._callout.hit }, leader: { x1: node._callout.sx, y1: node._callout.sy, x2: node._callout.ex, y2: node._callout.ey }, title: node._callout.content.title, number: node._callout.content.number, counts: node._callout.content.counts, mark: node._callout.content.mark, lines: node._callout.content.lines.map((line) => line.text) })),
    search,
    selectAssistant,
    saveState,
    ready: () => state.readyPromise ?? Promise.resolve(),
    status: () => ({
      active: state.active,
      ambient: state.ambient,
      orbit: state.orbit,
      view: state.view,
      nodeStyle: state.nodeStyle,
      nodeLayout: state.nodeLayout,
      orbitTrails: state.orbitTrails,
      extraGlow: state.extraGlow,
      ambientZen: state.ambientZen,
      ambientZenEnabled: state.ambientZenEnabled,
      feedCollapsed: state.feedCollapsed,
      labels: state.labels,
      query: state.query,
      matches: state.matches.length,
      nodes: state.nodes.length,
      tree: state.treeStatus,
      audioSource: state.audioSource,
      listening: Boolean(state.inputStream),
      backdrop: activeBackdrop(),
      bubbles: state.bubbles,
      cardStyle: state.cardStyle,
      focus: state.focus?.id ?? null,
    }),
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
