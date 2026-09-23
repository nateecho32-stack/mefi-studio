// Mefi's Studio AI+ — Overhead view: node tree with colour-outlined task boxes
// and an overview mode that cycles the highlight through active tasks.
(function () {
  "use strict";

  const state = { nodes: [], edges: [], tasks: [], angle: 0.4, overview: false, cycleIndex: 0, lastCycle: 0, hover: null };
  // Hit boxes from the last frame, taskId → rect. They live outside the task
  // objects so the poll's unchanged-data signature never sees draw output.
  const boxes = new Map();
  // Box titles fitted to their drawn width, per font and title (draw's fitTitle).
  const titleFits = new Map();
  const el = {};
  let initialized = false;
  let raf = null;

  // Task/snapshot refresh cadence while the sheet is open. Polls pause while
  // document.hidden and back off while a poll reads the same data, so an idle
  // app makes far fewer IPC round trips; fresh data snaps back to the base.
  // Pushed board changes refresh the sheet at once (init); these only backstop.
  const POLL_INTERVAL_MS = 15000;
  const POLL_MAX_MS = 60000;
  let pollTimer = null;
  let pollDelay = POLL_INTERVAL_MS;

  function schedulePoll() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(poll, pollDelay);
  }

  async function poll() {
    pollTimer = null;
    if (!initialized || el.overlay.hidden) return;
    if (document.visibilityState !== "visible") {
      // Hidden app: skip the fetch; the base cadence rechecks so the view
      // catches up within one interval after the app is shown again.
      pollDelay = POLL_INTERVAL_MS;
      schedulePoll();
      return;
    }
    const before = JSON.stringify([state.nodes, state.edges, state.tasks]);
    await load();
    if (!initialized || el.overlay.hidden) return;
    pollDelay = JSON.stringify([state.nodes, state.edges, state.tasks]) === before ? Math.min(pollDelay * 2, POLL_MAX_MS) : POLL_INTERVAL_MS;
    schedulePoll();
  }

  const keywords = (text) => new Set((String(text).toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g) ?? []).slice(0, 10));

  function anchorFor(task) {
    const keys = keywords(`${task.title} ${task.prompt ?? ""}`);
    let best = null;
    let bestScore = 0;
    for (const node of state.nodes) {
      if (node.kind !== "session") continue;
      let score = 0;
      const label = String(node.label ?? "").toLowerCase();
      for (const key of keys) if (label.includes(key)) score += 1;
      if (score > bestScore) {
        best = node;
        bestScore = score;
      }
    }
    return best;
  }

  function project(node, offset) {
    const scale = 1.5;
    const cos = Math.cos(state.angle);
    const sin = Math.sin(state.angle);
    const x = (node.x - offset.x) * scale;
    const z = (node.z - offset.z) * scale;
    const y = node.y * scale;
    const rx = x * cos - z * sin;
    const rz = x * sin + z * cos;
    const depth = rz + 800;
    const k = 800 / Math.max(200, depth);
    return { x: el.width / 2 + rx * k, y: el.height / 2 + y * k - 30, k, depth };
  }

  function draw(time) {
    if (el.canvas.hidden) return;
    const ctx = el.ctx;
    ctx.clearRect(0, 0, el.width, el.height);
    ctx.fillStyle = "#030304";
    ctx.fillRect(0, 0, el.width, el.height);

    const active = state.tasks.filter((task) => task.status === "open" || task.status === "active");
    if (state.overview && active.length && time - state.lastCycle > 4000) {
      state.lastCycle = time;
      state.cycleIndex = (state.cycleIndex + 1) % active.length;
    }
    const focusTask = state.overview ? active[state.cycleIndex % Math.max(1, active.length)] : null;
    const focusAnchor = focusTask ? anchorFor(focusTask) : null;
    const offset = focusAnchor ? { x: focusAnchor.x * 0.6, y: 0, z: focusAnchor.z * 0.6 } : { x: 0, y: 0, z: 0 };

    const projected = state.nodes.map((node) => ({ node, p: project(node, offset) }));
    for (const edge of state.edges) {
      const a = projected[edge.a];
      const b = projected[edge.b];
      if (!a || !b) continue;
      ctx.strokeStyle = "rgba(201,168,106,0.2)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(a.p.x, a.p.y);
      ctx.lineTo(b.p.x, b.p.y);
      ctx.stroke();
    }
    for (const { node, p } of projected) {
      const colour = node.state === "done" ? "rgba(87,255,154,0.85)" : node.state === "active" ? "rgba(201,168,106,0.9)" : "rgba(236,229,216,0.5)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(2, node.r * p.k * 1.6), 0, Math.PI * 2);
      ctx.fillStyle = colour;
      ctx.fill();
    }

    // Boxes used to sit at anchor + 18px, so every task sharing a session drew
    // on top of the last one. Each box now hunts for a free slot: the four
    // sides of its node first, then a widening fan — the connector line keeps
    // the box tied to the node it describes.
    const BOX_WIDTH = 200;
    const BOX_HEIGHT = 40;
    const placed = [];
    const hits = (left, top) =>
      placed.some(
        (rect) =>
          left - 6 < rect.x + rect.w && left + BOX_WIDTH + 6 > rect.x && top - 6 < rect.y + rect.h && top + BOX_HEIGHT + 6 > rect.y
      );
    // A title is fitted to the box by its drawn width and marked when shortened;
    // a fixed 30 characters overran the box with wide letters and cut others
    // with no sign. A canvas that measures nothing keeps the old cut.
    const width = (text) => ctx.measureText?.(text)?.width;
    const fitTitle = (text) => {
      const title = String(text ?? "");
      if (!Number.isFinite(width(title))) return title.slice(0, 30);
      const key = `${ctx.font}|${title}`;
      if (titleFits.has(key)) return titleFits.get(key);
      const room = BOX_WIDTH - 20;
      let cut = title;
      if (width(title) > room) {
        while (cut.length > 1 && width(`${cut.trimEnd()}…`) > room) cut = cut.slice(0, -1);
        cut = `${cut.trimEnd()}…`;
      }
      titleFits.set(key, cut);
      if (titleFits.size > 400) titleFits.delete(titleFits.keys().next().value);
      return cut;
    };
    const clampLeft = (left) => Math.min(el.width - BOX_WIDTH - 12, Math.max(12, left));
    const clampTop = (top) => Math.min(el.height - BOX_HEIGHT - 12, Math.max(12, top));

    boxes.clear();
    active.forEach((task, index) => {
      const anchor = anchorFor(task);
      const fallbackAngle = (index / Math.max(1, active.length)) * Math.PI * 2;
      const position = anchor
        ? project(anchor, offset)
        : { x: el.width / 2 + Math.cos(fallbackAngle) * 240, y: el.height / 2 + Math.sin(fallbackAngle) * 160 };
      const focused = focusTask?.id === task.id || state.hover === task.id;
      const slots = [
        { left: position.x + 18, top: position.y - BOX_HEIGHT / 2 },
        { left: position.x - 18 - BOX_WIDTH, top: position.y - BOX_HEIGHT / 2 },
        { left: position.x - BOX_WIDTH / 2, top: position.y + 22 },
        { left: position.x - BOX_WIDTH / 2, top: position.y - 22 - BOX_HEIGHT },
      ];
      let slot = null;
      for (const candidate of slots) {
        const left = clampLeft(candidate.left);
        const top = clampTop(candidate.top);
        if (!hits(left, top)) {
          slot = { left, top };
          break;
        }
      }
      if (!slot) {
        // crowded frame: walk a fan around the node until something fits
        for (let radius = 64; radius <= 300 && !slot; radius += 36) {
          for (let step = 0; step < 12 && !slot; step += 1) {
            const angle = (step / 12) * Math.PI * 2 + radius * 0.11;
            const left = clampLeft(position.x + Math.cos(angle) * radius);
            const top = clampTop(position.y + Math.sin(angle) * radius);
            if (!hits(left, top)) slot = { left, top };
          }
        }
      }
      if (!slot) slot = { left: clampLeft(slots[0].left), top: clampTop(slots[0].top) };
      placed.push({ x: slot.left, y: slot.top, w: BOX_WIDTH, h: BOX_HEIGHT });
      const left = slot.left;
      const top = slot.top;
      ctx.globalAlpha = focused || !focusTask ? 1 : 0.62;
      ctx.strokeStyle = task.color ?? "#e6c98d";
      ctx.lineWidth = focused ? 2.4 : 1.4;
      ctx.shadowColor = focused ? task.color : "transparent";
      ctx.shadowBlur = focused ? 18 : 0;
      ctx.beginPath();
      ctx.roundRect(left, top, BOX_WIDTH, BOX_HEIGHT, 10);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(8,8,11,0.82)";
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = task.color ?? "#e6c98d";
      ctx.font = "600 10.5px system-ui";
      ctx.fillText(`${task.status.toUpperCase()}`, left + 10, top + 15);
      ctx.fillStyle = "#ece5d8";
      ctx.fillText(fitTitle(task.title), left + 10, top + 31);
      ctx.strokeStyle = `${task.color ?? "#e6c98d"}66`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(
        Math.min(Math.max(position.x, left), left + BOX_WIDTH),
        Math.min(Math.max(position.y, top), top + BOX_HEIGHT)
      );
      ctx.lineTo(position.x, position.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      boxes.set(task.id, { x: left, y: top, w: BOX_WIDTH, h: BOX_HEIGHT });
    });

    if (!window.MefiNav?.noMotion?.()) state.angle += 0.0009;
    raf = requestAnimationFrame(draw);
  }

  async function load() {
    const snapshot = window.MefiTree?.snapshot?.() ?? { nodes: [], edges: [] };
    const tasks = await window.mefiStudio?.tasksList?.();
    state.nodes = snapshot.nodes;
    state.edges = snapshot.edges;
    state.tasks = tasks?.tasks ?? [];
    renderLegend();
  }

  function renderLegend() {
    el.legend.textContent = "";
    const active = state.tasks.filter((task) => task.status === "open" || task.status === "active");
    if (!active.length) {
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = "No open tasks — add one in Tasks.";
      el.legend.append(li);
      return;
    }
    active.forEach((task) => {
      const li = document.createElement("li");
      li.classList.add("task-row");
      li.style.setProperty("--task-color", task.color);
      li.textContent = `${task.status}: ${task.title}`;
      li.title = task.prompt ?? "";
      el.legend.append(li);
    });
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const width = el.canvas.parentElement.clientWidth - 30;
    const height = 560;
    el.canvas.width = width * dpr;
    el.canvas.height = height * dpr;
    el.canvas.style.width = width + "px";
    el.canvas.style.height = height + "px";
    el.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    el.width = width;
    el.height = height;
  }

  async function open() {
    window.MefiNav?.claim?.("overhead");
    el.overlay.hidden = false;
    await load();
    // Esc, O, the backdrop or another sheet's claim() can close us while load()
    // is still awaiting: starting the loop then leaves it drawing forever.
    if (el.overlay.hidden) return;
    resize();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(draw);
    pollDelay = POLL_INTERVAL_MS;
    schedulePoll();
  }

  function close() {
    // Cancel above the guard so a close during open()'s await still lands.
    cancelAnimationFrame(raf);
    raf = null;
    clearTimeout(pollTimer);
    pollTimer = null;
    if (el.overlay.hidden) return;
    el.overlay.hidden = true;
    window.MefiNav?.release?.("overhead");
  }

  function init() {
    if (initialized) return;
    initialized = true;
    for (const [key, id] of Object.entries({
      overlay: "overhead-overlay",
      canvas: "overhead-canvas",
      legend: "overhead-legend",
      overviewToggle: "overhead-overview",
      close: "overhead-close",
      openButton: "overhead-open",
    })) {
      el[key] = document.getElementById(id);
    }
    el.ctx = el.canvas.getContext("2d");
    el.openButton?.addEventListener("click", open);
    window.mefiStudio?.onTasks?.(() => {
      if (!initialized || el.overlay?.hidden || document.visibilityState !== "visible") return;
      clearTimeout(pollTimer);
      pollDelay = POLL_INTERVAL_MS;
      pollTimer = setTimeout(poll, 250);
    });
    el.close?.addEventListener("click", close);
    el.overlay?.addEventListener("click", (event) => {
      if (event.target === el.overlay) close();
    });
    el.overviewToggle?.addEventListener("change", () => {
      state.overview = el.overviewToggle.checked;
      state.cycleIndex = 0;
      state.lastCycle = 0;
    });
    // A hidden app makes no poll fetches; showing it snaps a fresh poll now
    // instead of waiting out the remaining interval.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden || !initialized || el.overlay.hidden) return;
      clearTimeout(pollTimer);
      poll();
    });
    el.canvas.addEventListener("mousemove", (event) => {
      const rect = el.canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      state.hover = null;
      for (const [taskId, box] of boxes) {
        if (x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) {
          state.hover = taskId;
          el.canvas.style.cursor = "pointer";
          return;
        }
      }
      el.canvas.style.cursor = "default";
    });
    el.canvas.addEventListener("click", () => {
      const task = state.tasks.find((item) => item.id === state.hover);
      if (!task) return;
      // Clicking a task box takes you to that task — Tasks replaces this sheet.
      if (window.MefiNav) window.MefiNav.go("tasks", { taskId: task.id });
      else {
        window.MefiTasks?.open();
        window.MefiTasks?.selectTask?.(task.id);
      }
    });
    window.addEventListener("resize", () => !el.overlay.hidden && resize());
  }

  window.MefiOverhead = { open, close };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
