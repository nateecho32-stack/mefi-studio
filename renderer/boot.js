// Mefi's Studio AI+ — the startup menu.
//
// A cold launch shows one gold node — the assistant — alone in the dark. Its
// agents fly out and spawn a small green node for every chat and source the
// Command tree is built from, each node naming the chat or thing it is
// reading; when a read lands, the node is cleaned away again in red. The real
// Command view builds underneath the whole time: once every read is done and
// the tree reports ready, the layer breathes "ready" and fades away into the
// constellation.
(function () {
  "use strict";

  // The constellation's own colour triples (idle.js NODE_RGB), so the boot
  // reads as the same world the fade lands in.
  const GOLD = [230, 201, 141];
  const GREEN = [104, 236, 164];
  const RED = [255, 156, 156];
  const IVORY = [236, 229, 216];
  const rgba = (triple, alpha) => `rgba(${triple[0]},${triple[1]},${triple[2]},${alpha})`;

  // One reader's life: the agent flies out, the node pops in green, the arc
  // sweeps while it is read, the read pulses home, the node dissolves red.
  const FLY_MS = 160;
  const BIRTH_MS = 140;
  const READ_MS = 220;
  const PULSE_MS = 120;
  const CLEAN_MS = 160;
  const LANES = 5; // agents reading in parallel
  const ORGANISE_MS = 80; // a brief handoff once the real graph is ready
  const HOLD_MS = 80; // the "ready" beat before the fade starts
  const FADE_MS = 480; // the CSS fade into the constellation
  const MIN_SHOW_MS = 450; // legibility floor — never a strobe
  const MAX_SHOW_MS = 5200; // a slow store must not hold the launch hostage
  const MAX_CHAT_NODES = 8; // mirrors the tree's capped roots
  const LABEL_MAX_PX = 170;
  const LABEL_FONT = '600 11.5px system-ui, "Segoe UI", sans-serif';
  const SUB_FONT = '10.5px system-ui, "Segoe UI", sans-serif';
  const GOLDEN_ANGLE = 2.399963; // organic, never-overlapping slot spacing
  const LIVE_WINDOW_MS = 15 * 60 * 1000; // "live" chats, as the tree sorts them

  const el = {};
  const boot = {
    active: false,
    phase: "reading", // reading → organising → ready → fading
    phaseAt: 0,
    startedAt: 0,
    raf: 0,
    queue: [], // { label, live } waiting for a free agent
    lanes: [], // readers on screen, each with its own timeline
    slot: 0,
    readsDone: 0,
    readsTotal: 0,
    dataDone: false,
    idleDone: false,
    current: "",
    assistantLine: "",
    title: "",
    count: "",
    openHome: null,
    timers: [],
    off: [],
    w: 0,
    h: 0,
    stars: [],
    timings: null,
  };

  const ease = (k) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);
  const lerp = (a, b, k) => a + (b - a) * k;

  function noMotion() {
    return (
      window.MefiNav?.noMotion?.() ??
      (document.body.classList.contains("no-motion") || window.matchMedia("(prefers-reduced-motion: reduce)").matches)
    );
  }

  // An IPC read that can neither hang the boot nor throw: a slow or missing
  // bridge answers null and its reader simply never spawns.
  function guard(promise, ms = 5200) {
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), ms);
    });
    return Promise.race([Promise.resolve(promise).catch(() => null), timeout]).finally(() => clearTimeout(timer));
  }

  // Several surfaces open together. Share only their concurrent, read-only
  // IPC requests; release settled promises so later opens see current data.
  // Writes (including task edits) always use the bridge directly.
  const reads = new Map();
  const readMethods = new Set(["assistantStatus", "assistantState", "eyesState", "tasksList", "ideasList", "eyesRequestsRead", "eyesBriefingRead", "eyesCheckpointsRead", "prefsGet"]);
  function read(method) {
    if (!readMethods.has(method)) return Promise.reject(new Error(`Not a shared read: ${method}`));
    if (reads.has(method)) return reads.get(method);
    const pending = Promise.resolve().then(() => window.mefiStudio?.[method]?.());
    reads.set(method, pending);
    const release = () => {
      if (reads.get(method) === pending) reads.delete(method);
    };
    pending.then(release, release);
    return pending;
  }

  // ---------- the reads ----------

  // Start every independent read together. The readers still arrive as their
  // data lands, but an assistant read no longer delays the session store.
  async function gather() {
    const bridge = window.mefiStudio;
    if (!bridge) {
      // Browser-only fallback (npm run start:web): no store to read.
      boot.assistantLine = "browser mode";
      return;
    }
    await Promise.all([
      guard(read("assistantState")).then((state) => {
        boot.assistantLine = state?.state?.prefs?.paused ? "paused" : "listening";
      }),
      readChats(),
      readSource(read("tasksList"), "the task board", (result) =>
        (Array.isArray(result?.tasks) ? result.tasks : []).filter((task) => task?.status === "open" || task?.status === "active").length
      ),
      readSource(read("ideasList"), "feature ideas", (result) =>
        (Array.isArray(result?.ideas) ? result.ideas : []).filter((idea) => !idea?.read).length
      ),
      readSource(read("eyesRequestsRead"), "the request inbox", (result) => (Array.isArray(result?.requests) ? result.requests.length : 0)),
      readSource(read("eyesBriefingRead"), "the latest briefing", (result) => (result?.briefing ? 1 : 0)),
      readSource(read("eyesCheckpointsRead"), "checkpoints", (result) => Object.keys(result?.checkpoints ?? {}).length),
    ]);
  }

  // Other chats, going on or happened: each becomes its own green reader node
  // named after the chat; anything past the cap folds into one summary node.
  async function readChats() {
    const result = await guard(read("eyesState"));
    const sessions = Array.isArray(result?.sessions) ? result.sessions : [];
    const now = Date.now();
    const chats = sessions.filter((session) => session?.id);
    chats.slice(0, MAX_CHAT_NODES).forEach((session) => {
      enqueue(String(session.title ?? session.id).trim() || "untitled chat", now - (session.timeUpdated ?? 0) < LIVE_WINDOW_MS);
    });
    const rest = chats.length - MAX_CHAT_NODES;
    if (rest > 0) enqueue(`${rest} older chat${rest === 1 ? "" : "s"}`, false);
    if (!chats.length) enqueue("the session store", false); // offline store: still a read, still a node
  }

  async function readSource(promise, label, countOf) {
    const result = await guard(promise);
    enqueue(label, false, Math.max(0, countOf(result) | 0));
  }

  function enqueue(label, live, count = -1) {
    boot.queue.push({ label, live, count });
    boot.readsTotal += 1;
    if (!boot.current) boot.current = label;
  }

  // ---------- lanes: the reader life-cycle ----------

  function stepLanes(now) {
    while (boot.lanes.length < LANES && boot.queue.length) {
      const job = boot.queue.shift();
      const t = boot.timings;
      const at = now;
      const ring = Math.min(boot.w, boot.h) * 0.3;
      const angle = -Math.PI / 2 + boot.slot * GOLDEN_ANGLE;
      boot.slot += 1;
      boot.lanes.push({
        ...job,
        at,
        fly: t.fly,
        born: t.fly + t.birth,
        readEnd: t.fly + t.birth + t.read,
        pulseEnd: t.fly + t.birth + t.read + t.pulse,
        gone: t.fly + t.birth + t.read + t.pulse + t.clean,
        x: boot.cx + Math.cos(angle) * ring,
        y: boot.cy + Math.sin(angle) * ring * 0.84,
        labelWidth: 0,
      });
    }
    const before = boot.lanes.length;
    boot.lanes = boot.lanes.filter((reader) => now - reader.at < reader.gone);
    if (boot.lanes.length < before) {
      boot.readsDone += before - boot.lanes.length;
      const next = boot.queue[0];
      boot.current = next ? next.label : boot.current;
    }
  }

  // ---------- drawing ----------

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    boot.w = window.innerWidth;
    boot.h = window.innerHeight;
    el.canvas.width = Math.max(1, Math.round(boot.w * dpr));
    el.canvas.height = Math.max(1, Math.round(boot.h * dpr));
    el.canvas.style.width = `${boot.w}px`;
    el.canvas.style.height = `${boot.h}px`;
    el.canvas.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
    boot.cx = boot.w / 2;
    boot.cy = boot.h * 0.44;
  }

  function makeStars() {
    boot.stars = Array.from({ length: 70 }, (_, index) => {
      const seed = index * 2654435761;
      // Unsigned shifts keep the seeded values in [0, 1). A signed shift
      // creates negative star radii and aborts the boot's first canvas frame.
      const rand = (n) => ((seed >>> n) % 1000) / 1000;
      return { x: rand(3), y: rand(7), size: 0.5 + rand(11) * 1.3, phase: rand(5) * Math.PI * 2, drift: 0.002 + rand(13) * 0.004 };
    });
  }

  function glow(ctx, x, y, radius, triple, alpha) {
    if (alpha <= 0 || radius <= 0) return;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
    grad.addColorStop(0, rgba(triple, alpha));
    grad.addColorStop(1, rgba(triple, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  function truncate(ctx, reader) {
    if (reader.displayLabel != null) return reader.displayLabel;
    let text = reader.label;
    while (text.length > 4 && ctx.measureText(`${text}…`).width > LABEL_MAX_PX) text = text.slice(0, -1);
    reader.displayLabel = text.length === reader.label.length ? text : `${text}…`;
    reader.labelWidth = ctx.measureText(reader.displayLabel).width;
    return reader.displayLabel;
  }

  function draw(now) {
    const ctx = el.canvas.getContext("2d");
    ctx.clearRect(0, 0, boot.w, boot.h);

    // far sky, the constellation's own starfield one room away
    for (const star of boot.stars) {
      const x = (((star.x * boot.w + now * star.drift) % boot.w) + boot.w) % boot.w;
      const twinkle = 0.55 + 0.45 * Math.sin(now / 2400 + star.phase);
      ctx.fillStyle = rgba(IVORY, 0.16 * twinkle);
      ctx.beginPath();
      ctx.arc(x, star.y * boot.h, star.size, 0, Math.PI * 2);
      ctx.fill();
    }

    // the assistant, the one node the boot starts from
    const breath = 1 + Math.sin(now / 820) * 0.09;
    glow(ctx, boot.cx, boot.cy, 54 * breath, GOLD, 0.16);
    ctx.strokeStyle = rgba(GOLD, 0.5 * breath);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(boot.cx, boot.cy, 19 * breath, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = rgba(GOLD, 0.95);
    ctx.beginPath();
    ctx.arc(boot.cx, boot.cy, 7.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = "center";
    ctx.font = LABEL_FONT;
    ctx.fillStyle = rgba(GOLD, 0.95);
    ctx.fillText("assistant", boot.cx, boot.cy + 40);
    ctx.font = SUB_FONT;
    ctx.fillStyle = rgba(IVORY, 0.55);
    ctx.fillText(boot.assistantLine || "waking", boot.cx, boot.cy + 55);

    for (const reader of boot.lanes) drawReader(ctx, reader, now);
    ctx.textAlign = "start";
  }

  function drawReader(ctx, reader, now) {
    const p = now - reader.at;
    const t = boot.timings;
    if (p < reader.fly) {
      // the agent is still in flight — a gold dot leaving the assistant
      const k = ease(p / reader.fly);
      glow(ctx, lerp(boot.cx, reader.x, k), lerp(boot.cy, reader.y, k), 8, GOLD, 0.5);
      return;
    }
    const dying = p >= reader.pulseEnd;
    const color = dying ? RED : GREEN;
    const kClean = dying ? (p - reader.pulseEnd) / t.clean : 0;
    const kBirth = p < reader.born ? ease((p - reader.fly) / t.birth) : 1;
    const alpha = dying ? 1 - kClean : kBirth;
    const radius = (5.5 + (reader.live ? 1.5 : 0)) * (dying ? 1 - kClean : kBirth);

    // edge: grows on birth, retracts home through the cleanup
    const reach = dying ? 1 - kClean : kBirth;
    ctx.strokeStyle = rgba(dying ? RED : GOLD, 0.22 * reach);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(boot.cx, boot.cy);
    ctx.lineTo(lerp(boot.cx, reader.x, reach), lerp(boot.cy, reader.y, reach));
    ctx.stroke();

    glow(ctx, reader.x, reader.y, 22 * (dying ? 1 - kClean : 1), color, 0.34 * alpha);
    ctx.fillStyle = rgba(color, alpha);
    ctx.beginPath();
    ctx.arc(reader.x, reader.y, Math.max(0.5, radius), 0, Math.PI * 2);
    ctx.fill();

    // the read: an arc sweeping closed around the node
    if (!dying && p >= reader.born && p < reader.pulseEnd) {
      const k = Math.min(1, (p - reader.born) / t.read);
      ctx.strokeStyle = rgba(GREEN, 0.85);
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.arc(reader.x, reader.y, radius + 4.5, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2);
      ctx.stroke();
    }
    // the read travelling home as a gold spark
    if (p >= reader.readEnd && p < reader.pulseEnd) {
      const k = ease((p - reader.readEnd) / t.pulse);
      glow(ctx, lerp(reader.x, boot.cx, k), lerp(reader.y, boot.cy, k), 7, GOLD, 0.6);
    }

    // the label names the chat or thing being read
    ctx.font = LABEL_FONT;
    const text = truncate(ctx, reader);
    const flip = reader.x + 14 + reader.labelWidth > boot.w - 12;
    ctx.textAlign = flip ? "right" : "start";
    const tx = flip ? reader.x - 12 : reader.x + 12;
    ctx.fillStyle = rgba(color, 0.9 * alpha);
    ctx.fillText(text, tx, reader.y + 4);
    if (reader.count > 0 && !dying) {
      ctx.font = SUB_FONT;
      ctx.fillStyle = rgba(IVORY, 0.5 * alpha);
      ctx.fillText(String(reader.count), tx, reader.y + 17);
    }
    ctx.textAlign = "start";
  }

  // ---------- status copy ----------

  function syncCopy() {
    const title =
      boot.phase === "organising"
        ? "organising the node tree"
        : boot.phase === "reading"
          ? boot.readsTotal
            ? "reading your chats"
            : "waking the assistant"
          : "ready";
    const count = boot.readsTotal ? `${boot.readsDone} / ${boot.readsTotal} read` : "";
    let line =
      boot.phase === "reading"
        ? boot.current
          ? `reading ${boot.current}`
          : boot.assistantLine
        : boot.phase === "organising"
          ? "organising"
          : boot.assistantLine === "paused"
            ? "paused"
            : "ready";
    if (line.length > 42) line = `${line.slice(0, 41)}…`; // the sublabel is centred — keep it on one line
    if (title !== boot.title) {
      boot.title = title;
      if (el.title) el.title.textContent = title;
    }
    if (count !== boot.count) {
      boot.count = count;
      if (el.count) el.count.textContent = count;
    }
    if (line !== boot.assistantLine) boot.assistantLine = line;
  }

  // ---------- gate: reading → organising → ready → fading ----------

  function stepGate(now) {
    const age = now - boot.startedAt;
    const minimum = noMotion() ? 0 : MIN_SHOW_MS;
    if (boot.phase === "reading") {
      // Command's first graph is already up: leftover theatrical readers
      // must not hold the fade after the tree is ready.
      if (boot.idleDone && boot.dataDone && age >= minimum) {
        boot.queue = [];
        boot.lanes = [];
        boot.phase = "organising";
        boot.phaseAt = now;
      } else if (age > MAX_SHOW_MS) {
        boot.phase = "organising";
        boot.phaseAt = now;
      }
    } else if (boot.phase === "organising" && now - boot.phaseAt >= (noMotion() ? 0 : ORGANISE_MS)) {
      boot.phase = "ready";
      boot.phaseAt = now;
    } else if (boot.phase === "ready" && now - boot.phaseAt >= (noMotion() ? 0 : HOLD_MS)) {
      boot.phase = "fading";
      fade();
    }
  }

  function fade() {
    el.layer.classList.add("done");
    boot.timers.push(setTimeout(teardown, noMotion() ? 0 : FADE_MS + 80));
  }

  // ---------- lifecycle ----------

  function teardown() {
    if (!boot.active) return;
    boot.active = false;
    cancelAnimationFrame(boot.raf);
    for (const timer of boot.timers) clearTimeout(timer);
    boot.timers = [];
    for (const off of boot.off) off();
    boot.off = [];
    el.layer.hidden = true;
    el.layer.classList.remove("done");
  }

  // A key or click never traps anyone in the boot: it jumps straight to the
  // fade. Swallow only the skip keys so the layer cannot leak them into the
  // menu underneath mid-launch.
  function skip(event) {
    if (!boot.active || boot.phase === "fading") return;
    if (event?.type === "keydown" && !["Enter", "Escape", " ", "Spacebar"].includes(event.key)) return;
    if (event?.type === "keydown") {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    boot.queue = [];
    boot.phase = "ready";
    boot.phaseAt = performance.now() - HOLD_MS;
  }

  function run(openHome) {
    el.layer = document.getElementById("boot-layer");
    el.canvas = document.getElementById("boot-canvas");
    el.title = document.getElementById("boot-title");
    el.count = document.getElementById("boot-count");
    if (!el.layer || !el.canvas || boot.active) {
      if (typeof openHome === "function") openHome();
      return;
    }
    boot.active = true;
    boot.phase = "reading";
    boot.startedAt = performance.now();
    boot.queue = [];
    boot.lanes = [];
    boot.slot = 0;
    boot.readsDone = 0;
    boot.readsTotal = 0;
    boot.dataDone = false;
    boot.idleDone = false;
    boot.current = "";
    boot.title = "";
    boot.count = "";
    boot.assistantLine = "waking";
    boot.timings = noMotion()
      ? { fly: 40, birth: 40, read: 90, pulse: 30, clean: 40 }
      : { fly: FLY_MS, birth: BIRTH_MS, read: READ_MS, pulse: PULSE_MS, clean: CLEAN_MS };
    el.layer.hidden = false;
    el.layer.classList.remove("done");
    resize();
    makeStars();

    const onResize = () => {
      if (boot.active) resize();
    };
    window.addEventListener("resize", onResize);
    el.layer.addEventListener("pointerdown", skip);
    window.addEventListener("keydown", skip, true);
    boot.off.push(() => window.removeEventListener("resize", onResize));
    boot.off.push(() => el.layer.removeEventListener("pointerdown", skip));
    boot.off.push(() => window.removeEventListener("keydown", skip, true));

    // Hand the launch to the Command view at once: its first graph build
    // overlaps the reads, so the fade lands on a tree that is already there.
    const launchHome = () => {
      if (typeof openHome === "function") openHome();
      Promise.resolve(window.MefiIdle?.ready?.())
        .catch(() => {})
        .then(() => {
          boot.idleDone = true;
        });
    };
    // idle.js wires its canvas at DOMContentLoaded. Join that event instead
    // of sleeping 140ms and hoping the DOM has finished by then.
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", launchHome, { once: true });
    else launchHome();

    gather()
      .catch(() => {})
      .finally(() => {
        boot.dataDone = true;
      });
    boot.raf = requestAnimationFrame(frame);
  }

  function frame(now) {
    if (!boot.active) return;
    boot.raf = requestAnimationFrame(frame);
    stepLanes(now);
    stepGate(now);
    syncCopy();
    draw(now);
  }

  // The prefs back-out (Command-on-launch turned off, answer arriving late)
  // and the skip share one path: stop reading, fade now.
  function cancel() {
    if (!boot.active || boot.phase === "fading") return;
    skip();
  }

  // ---- shared poll guard ---------------------------------------------------
  // Poll timers registered here are cleared the moment the window hides and
  // restarted the moment it shows, so a hidden tab issues no fetches and
  // hide/show toggles can never stack intervals: a key holds at most one
  // timer, every start clears before it sets, and the visibilitychange pass
  // only sets where none is running. (The boot's own beats are one-shot
  // timeouts and a rAF loop the browser already suspends while hidden.)
  const polls = new Map(); // key -> { fn, ms, timer }
  function pollStart(key, fn, ms) {
    pollStop(key);
    const poll = { fn, ms, timer: 0 };
    polls.set(key, poll);
    if (!document.hidden) poll.timer = setInterval(fn, ms);
    return key;
  }
  function pollStop(key) {
    const poll = polls.get(key);
    if (!poll) return;
    if (poll.timer) clearInterval(poll.timer);
    polls.delete(key);
  }
  document.addEventListener("visibilitychange", () => {
    for (const poll of polls.values()) {
      if (document.hidden) {
        if (poll.timer) clearInterval(poll.timer);
        poll.timer = 0;
      } else if (!poll.timer) {
        poll.timer = setInterval(poll.fn, poll.ms);
      }
    }
  });

  window.MefiBoot = { run, cancel, read, isActive: () => boot.active, pollStart, pollStop, pollActive: (key) => Boolean(polls.get(key)?.timer) };
})();
