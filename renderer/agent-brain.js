// The Agent Brain's surfaces (docs/roadmap-0.4.0.md, M5-M9): the Agent brain
// sheet (a task's pipeline drawn live from work events, the Playbook shelf and
// the project map), the map hub on Home, and the docked companion. The host
// side is scripts/agent-brain-host.cjs, reached through window.mefiStudio.
//
// Pipeline motion follows recorded work events; the project explorer's camera
// and transitions follow navigation. Reduced motion draws every scene at rest.
(() => {
  "use strict";

  const bridge = () => window.mefiStudio ?? null;
  const $ = (id) => document.getElementById(id);
  const node = (tag, className = "", text = null) => {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text != null) item.textContent = String(text);
    return item;
  };
  const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = (t) => 1 - Math.pow(1 - clamp(t), 3);
  const easeInOut = (t) => { t = clamp(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
  const still = () => {
    try { if (typeof window.MefiNav?.noMotion === "function") return window.MefiNav.noMotion(); } catch {}
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  };
  const clip = (value, max) => { const text = String(value ?? "").replace(/\s+/g, " ").trim(); return text.length > max ? `${text.slice(0, max - 1)}…` : text; };
  const ago = (at) => {
    const ms = Date.now() - Number(at || 0);
    if (!Number.isFinite(ms) || ms < 0) return "";
    if (ms < 60000) return "just now";
    if (ms < 3600000) return `${Math.round(ms / 60000)} min ago`;
    if (ms < 86400000) return `${Math.round(ms / 3600000)} h ago`;
    return `${Math.round(ms / 86400000)} d ago`;
  };
  const companionName = () => {
    try { return (localStorage.getItem("mefiStudio.workspace.companion") || "Mefi").trim() || "Mefi"; } catch { return "Mefi"; }
  };
  const readLocal = (key, fallback) => { try { return localStorage.getItem(`mefiStudio.agentBrain.${key}`) ?? fallback; } catch { return fallback; } };
  const writeLocal = (key, value) => { try { localStorage.setItem(`mefiStudio.agentBrain.${key}`, value); } catch {} };

  // ---- palette and style packs -------------------------------------------------

  function palette() {
    const shared = window.MefiNodeVisuals?.palette();
    if (shared) return { ...shared, bg: shared.background, panel: shared.surface, line: rgba(shared.accent, 0.32), lineStrong: shared.accent, mint: shared.accent, ivory: shared.text, info: shared.accent2, violet: "#c7a8ff", ember: "#ffb36b" };
    const styles = getComputedStyle(document.documentElement);
    const read = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
    return {
      bg: read("--bg", "#050d13"), panel: read("--panel-solid", "#101f29"), line: read("--hairline", "rgba(70,112,110,.5)"),
      lineStrong: read("--hairline-strong", "#46706e"), mint: read("--gold", "#71cbb7"), bright: read("--gold-bright", "#a7f3da"),
      live: read("--live", "#57ff9a"), warn: read("--warn", "#ffd479"), bad: read("--bad", "#ff9c9c"), good: read("--good", "#afdfc2"),
      info: read("--info", "#9db7ff"), ivory: read("--ivory", "#e7f5ee"), muted: read("--muted", "#abc4c9"), dim: read("--dim", "#7c8a8c"),
      violet: "#c7a8ff", ember: "#ffb36b",
    };
  }
  function rgba(color, alpha) {
    const text = String(color).trim();
    if (text.startsWith("#")) {
      const hex = text.length === 4 ? text.slice(1).split("").map((c) => c + c).join("") : text.slice(1, 7);
      const n = parseInt(hex, 16);
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
    }
    const m = text.match(/rgba?\(([^)]+)\)/);
    if (m) { const [r, g, b] = m[1].split(",").map((part) => part.trim()); return `rgba(${r},${g},${b},${alpha})`; }
    return text;
  }
  const FONT = "system-ui, 'Segoe UI', sans-serif";
  function nodeStyle() {
    try { return window.MefiMusic?.graphPreferences?.().nodeStyle || "orbs"; } catch { return "orbs"; }
  }
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function hexPath(ctx, x, y, r, frac = 1) {
    ctx.beginPath();
    const n = 6 * frac;
    for (let i = 0; i <= Math.ceil(n); i += 1) {
      const k = Math.min(i, n);
      const a0 = Math.floor(k) * Math.PI / 3 - Math.PI / 2;
      const a1 = (Math.floor(k) + 1) * Math.PI / 3 - Math.PI / 2;
      const f = k - Math.floor(k);
      const px = lerp(Math.cos(a0), Math.cos(a1), f) * r + x;
      const py = lerp(Math.sin(a0), Math.sin(a1), f) * r + y;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    if (frac >= 1) ctx.closePath();
  }
  function label(ctx, text, x, y, { size = 12, weight = 500, color, align = "center", alpha = 1 } = {}) {
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  // One orb, drawn in the owner's node style. The Void packs have their own
  // bodies; the free styles are variations on the orb.
  function body(ctx, x, y, r, color, t, P, { rot = 0, style = nodeStyle() } = {}) {
    if (window.MefiNodeVisuals?.drawNode(ctx, { x, y }, r, color, { style, active: color === P.live })) return;
    if (style === "singularity") {
      ctx.save(); ctx.translate(x, y); ctx.rotate(t * 0.7 + rot);
      ctx.strokeStyle = rgba(P.ember, 0.85); ctx.lineWidth = Math.max(1.2, r * 0.22);
      ctx.beginPath(); ctx.ellipse(0, 0, r * 1.85, r * 0.55, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = rgba(color, 0.18); ctx.beginPath(); ctx.arc(x, y, r * 1.35, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#010306"; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = color; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.arc(x, y, r * 1.08, 0, Math.PI * 2); ctx.stroke();
      return;
    }
    if (style === "prism" || style === "crystal") {
      ctx.save(); ctx.translate(x, y); ctx.rotate(t * 0.5 + rot);
      const g = ctx.createLinearGradient(-r, -r, r, r);
      g.addColorStop(0, color); g.addColorStop(0.5, style === "prism" ? P.info : P.bright); g.addColorStop(1, style === "prism" ? P.violet : color);
      ctx.fillStyle = rgba(color, 0.13); ctx.beginPath(); ctx.arc(0, 0, r * 1.9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(0, -r * 1.3); ctx.lineTo(r, 0); ctx.lineTo(0, r * 1.3); ctx.lineTo(-r, 0); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, -r * 1.3); ctx.lineTo(0, r * 1.3); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.stroke();
      ctx.restore();
      return;
    }
    if (style === "sigil") {
      ctx.save(); ctx.translate(x, y); ctx.rotate(t * 0.35 + rot);
      ctx.fillStyle = rgba(color, 0.12); ctx.beginPath(); ctx.arc(0, 0, r * 1.8, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = color; ctx.lineWidth = 1.6; hexPath(ctx, 0, 0, r * 1.15); ctx.stroke();
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 3; i += 1) {
        const a = i * (Math.PI * 2 / 3);
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * 0.25, Math.sin(a) * r * 0.25); ctx.lineTo(Math.cos(a) * r * 0.75, Math.sin(a) * r * 0.75); ctx.stroke();
      }
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(0, 0, r * 0.2, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      return;
    }
    if (style === "minimal") {
      ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = rgba(color, 0.35); ctx.beginPath(); ctx.arc(x, y, r * 0.45, 0, Math.PI * 2); ctx.fill();
      return;
    }
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
    g.addColorStop(0, "#ffffff"); g.addColorStop(0.25, color); g.addColorStop(1, rgba(color, style === "glass" ? 0.25 : 0.55));
    ctx.fillStyle = rgba(color, style === "glass" ? 0.08 : 0.14); ctx.beginPath(); ctx.arc(x, y, r * 1.9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    if (style === "glass") { ctx.strokeStyle = rgba("#ffffff", 0.35); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); }
    if (style === "halo") { ctx.strokeStyle = rgba(color, 0.7); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, y, r * 1.6, t * 2, t * 2 + Math.PI * 1.4); ctx.stroke(); }
  }

  // The done beat at the step. A landed MefiNodeStyles.done hook draws it
  // first; the fallback below is the pack's own version.
  function popFx(ctx, x, y, r, p, t, P, ok = true) {
    const style = nodeStyle();
    try { if (window.MefiNodeStyles?.done?.(ctx, style, { x, y }, r, ok ? P.good : P.bad, p, { t }) === true) return; } catch {}
    const tint = ok ? P.good : P.bad;
    if (style === "singularity") {
      ctx.strokeStyle = rgba(P.ember, 1 - p); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, r * (1.4 + p * 2.6), 0, Math.PI * 2); ctx.stroke();
      body(ctx, x, y, r * (1 + 0.35 * Math.sin(p * Math.PI)), tint, t, P, { rot: p * 9, style });
    } else if (style === "prism" || style === "crystal") {
      for (let i = 0; i < 6; i += 1) {
        const a = i * Math.PI / 3 + p * 0.8, d = r * (1 + 3.4 * Math.sin(p * Math.PI));
        const sx = x + Math.cos(a) * d, sy = y + Math.sin(a) * d;
        ctx.fillStyle = [P.bright, P.info, P.violet][i % 3]; ctx.globalAlpha = 1 - p * 0.6;
        ctx.beginPath(); ctx.moveTo(sx, sy - 4); ctx.lineTo(sx + 3, sy + 3); ctx.lineTo(sx - 3, sy + 3); ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
      }
      body(ctx, x, y, r * (1 + 0.25 * Math.sin(p * Math.PI)), tint, t, P, { rot: p * 2, style });
    } else if (style === "sigil") {
      ctx.save(); ctx.translate(x, y); ctx.rotate(p * Math.PI / 3);
      ctx.strokeStyle = rgba(tint, 0.95); ctx.lineWidth = 1.6; hexPath(ctx, 0, 0, r * 2.5, easeOut(Math.min(1, p * 1.4))); ctx.stroke();
      ctx.restore();
      body(ctx, x, y, r, tint, t, P, { style });
    } else if (style === "minimal") {
      ctx.strokeStyle = tint; ctx.lineWidth = 2; ctx.beginPath();
      ctx.moveTo(x - r, y); ctx.lineTo(x - r * 0.2, y + r * 0.8 * easeOut(p * 2)); ctx.lineTo(x + r * 1.2 * easeOut(p * 1.5), y - r); ctx.stroke();
    } else {
      const bounce = 1 + 0.65 * Math.sin(p * Math.PI * 2.4) * Math.exp(-2.8 * p);
      ctx.strokeStyle = rgba(tint, (1 - p) * 0.9); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r * (1.2 + p * 3.2), 0, Math.PI * 2); ctx.stroke();
      body(ctx, x, y - Math.sin(p * Math.PI) * 6, r * bounce, tint, t, P, { style });
    }
  }
  function absorbFx(ctx, lead, leadR, p, t, P) {
    const style = nodeStyle();
    try { if (window.MefiNodeStyles?.absorb?.(ctx, style, { x: lead[0], y: lead[1] }, leadR, P.live, p, { t }) === true) return; } catch {}
    if (style === "singularity") {
      ctx.strokeStyle = rgba(P.ember, (1 - p) * 0.9); ctx.lineWidth = 1.4;
      for (let i = 0; i < 3; i += 1) { ctx.beginPath(); ctx.arc(lead[0], lead[1], leadR * (2.2 - p * 1.1 - i * 0.28), p * 6 + i, p * 6 + i + 2.2); ctx.stroke(); }
    } else if (style === "prism" || style === "crystal") {
      for (let i = 0; i < 6; i += 1) {
        const a = i * Math.PI / 3 + 0.3, d = leadR * (2.6 * (1 - easeOut(p)) + 0.4);
        ctx.fillStyle = [P.bright, P.info, P.violet][i % 3]; ctx.globalAlpha = 1 - p * 0.5;
        const sx = lead[0] + Math.cos(a) * d, sy = lead[1] + Math.sin(a) * d;
        ctx.beginPath(); ctx.moveTo(sx, sy - 4); ctx.lineTo(sx + 3, sy + 3); ctx.lineTo(sx - 3, sy + 3); ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
      }
    } else if (style === "sigil") {
      ctx.save(); ctx.translate(lead[0], lead[1]); ctx.rotate(-p * Math.PI);
      ctx.strokeStyle = rgba(P.bright, 1 - p); ctx.lineWidth = 1.4; hexPath(ctx, 0, 0, leadR * (1.9 - p * 0.6)); ctx.stroke();
      ctx.restore();
    } else {
      ctx.strokeStyle = rgba(P.live, (1 - p) * 0.8); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(lead[0], lead[1], leadR * (1 + p * 1.2), 0, Math.PI * 2); ctx.stroke();
    }
  }

  // A canvas that fits its box and paints on demand; `loop` keeps it moving
  // only while something is animating and the canvas is on screen.
  function makeCanvas(canvas, draw, heightForWidth = null) {
    const ctx = canvas.getContext("2d");
    const view = { W: 0, H: 0, dpr: 1, raf: 0, visible: true, hot: () => false };
    const resize = () => {
      const box = canvas.parentElement?.getBoundingClientRect?.();
      if (!box) return;
      view.dpr = Math.min(2, window.devicePixelRatio || 1);
      view.W = Math.max(canvas.dataset.viewport ? 1 : 240, Math.floor(box.width));
      view.H = Math.max(canvas.dataset.viewport ? 1 : 200, Math.floor(canvas.clientHeight || box.height || 360));
      if (heightForWidth) {
        view.H = heightForWidth(view.W);
        canvas.style.height = `${view.H}px`;
      }
      canvas.width = Math.round(view.W * view.dpr);
      canvas.height = Math.round(view.H * view.dpr);
      paint();
    };
    const paint = () => {
      if (!view.W) return;
      ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
      ctx.clearRect(0, 0, view.W, view.H);
      draw(ctx, view.W, view.H, still() ? 0 : performance.now() / 1000);
    };
    const frame = () => {
      view.raf = 0;
      if (!view.visible || document.hidden) return;
      paint();
      if (view.visible && view.hot() && !still()) view.raf = requestAnimationFrame(frame);
    };
    view.kick = () => { if (!view.raf && view.visible && !document.hidden) view.raf = requestAnimationFrame(frame); };
    document.addEventListener("visibilitychange", () => { if (!document.hidden) view.kick(); });
    view.paint = paint;
    view.resize = resize;
    try { new ResizeObserver(resize).observe(canvas.parentElement); } catch {}
    try { new IntersectionObserver((rows) => { view.visible = rows.some((row) => row.isIntersecting); if (view.visible) view.kick(); }).observe(canvas); } catch {}
    return view;
  }

  // ---- shared data -------------------------------------------------------------

  const data = {
    tasks: [],
    pipelines: {},
    running: [],
    recent: [],
    map: null,
    mapProject: null,
    places: { ideas: {}, plans: {} },
    shelf: [],
    recipes: [],
    ideas: [],
    plans: [],
    loadedAt: 0,
  };
  const listeners = new Set();
  const onData = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  const changed = (what) => { for (const fn of listeners) { try { fn(what); } catch {} } };

  async function loadBrain() {
    const api = bridge();
    if (!api?.brainState) return;
    const [state, tasks] = await Promise.all([api.brainState({}).catch(() => null), api.tasksList?.().catch(() => null)]);
    if (state?.ok) {
      data.pipelines = state.pipelines ?? {};
      data.running = state.running ?? [];
      data.recent = state.recent ?? [];
    }
    if (tasks?.ok) data.tasks = tasks.tasks ?? [];
    data.loadedAt = Date.now();
    changed("brain");
  }
  let mapRequest = 0;
  async function loadMap(rebuild = false) {
    const api = bridge();
    if (!api?.brainMap) return null;
    const request = ++mapRequest;
    const project = window.MefiWorkspace?.activeProjectId?.() ?? null;
    const result = await api.brainMap(rebuild).catch(() => null);
    if (request !== mapRequest || project !== (window.MefiWorkspace?.activeProjectId?.() ?? null)) return null;
    if (result?.ok) { data.map = result.map ?? null; data.mapProject = project; data.places = result.places ?? data.places; changed("map"); }
    return result;
  }
  async function loadPlaybook() {
    const api = bridge();
    if (!api?.brainPlaybook) return;
    const result = await api.brainPlaybook().catch(() => null);
    if (result?.ok) { data.shelf = result.shelf ?? []; data.recipes = result.recipes ?? []; changed("playbook"); }
  }
  async function loadWorkItems() {
    const api = bridge();
    const [ideas, plans] = await Promise.all([api?.ideasList?.().catch(() => null), api?.planningList?.({}).catch(() => null)]);
    data.ideas = Array.isArray(ideas?.ideas) ? ideas.ideas : Array.isArray(ideas) ? ideas : [];
    data.plans = Array.isArray(plans?.plans) ? plans.plans : [];
    changed("work");
  }
  const taskById = (id) => data.tasks.find((task) => task.id === id) ?? null;

  // ---- the pipeline scene --------------------------------------------------------

  // Where each part of a pipeline sits, top down: the head, the lead, the
  // folded work, then the steps by level (a step sits one level below its
  // deepest visible parent).
  function layoutPipeline(pipeline, W, H) {
    const steps = (pipeline?.steps ?? []).filter((step) => !step.folded);
    const folded = (pipeline?.steps ?? []).filter((step) => step.folded).length;
    const ids = new Set(steps.map((step) => step.id));
    const level = new Map();
    for (const step of steps) {
      const parents = (step.parents ?? []).filter((id) => ids.has(id));
      level.set(step.id, parents.length ? 1 + Math.max(...parents.map((id) => level.get(id) ?? 0)) : 0);
    }
    const levels = [];
    for (const step of steps) (levels[level.get(step.id)] ??= []).push(step);
    // A wide parallel stage wraps within its level. It never shrinks names
    // into illegible pills or pushes a branch outside the canvas.
    const columns = Math.max(1, Math.floor((W - 48) / 154));
    const rows = [];
    for (const row of levels) {
      if (!row) continue;
      for (let i = 0; i < row.length; i += columns) rows.push(row.slice(i, i + columns));
    }
    const top = folded ? 196 : 176;
    const gap = clamp((H - top - 48) / Math.max(1, rows.length), 68, 100);
    const pillW = clamp((W - 120) / Math.max(1, ...rows.map((row) => row?.length ?? 1)) - 18, 96, 150);
    const at = new Map();
    rows.forEach((row, index) => {
      (row ?? []).forEach((step, i) => {
        const span = (row.length - 1) * (pillW + 18);
        at.set(step.id, { x: W / 2 - span / 2 + i * (pillW + 18), y: top + index * gap + 18 });
      });
    });
    return {
      head: [W / 2, 40], lead: [W / 2, 108], desk: [Math.max(70, W * 0.12), 108], book: [Math.min(W - 60, W * 0.88), 108],
      fold: folded ? [W / 2, 162] : null, folded, at, pillW, pillH: 44, steps, height: top + rows.length * 76 + 48,
    };
  }

  const scene = {
    taskId: null,
    fx: [],
    motion: new Map(),
    orbit: 0,
  };
  const FX = {
    out: 0.9, pop: 0.5, back: 0.9, lap: 0.7, absorb: 0.45, report: 0.8, ask: 0.8, deskTrip: 3.6, grow: 1.4, archive: 1.8, edge: 0.7,
  };
  function addFx(kind, extra = {}) {
    if (still()) return;
    scene.fx.push({ kind, start: performance.now() / 1000, ...extra });
    if (scene.fx.length > 60) scene.fx.splice(0, scene.fx.length - 60);
    brainView?.kick();
  }
  function fxAlive(t) {
    scene.fx = scene.fx.filter((fx) => t - fx.start < (fx.dur ?? 3));
    return scene.fx.length > 0;
  }

  // What a work event does on the scene of the task being watched.
  function stageEvent(event) {
    if (!event || typeof event !== "object") return;
    const mine = event.taskId === scene.taskId || (Array.isArray(event.parents) && event.parents.includes(scene.taskId));
    if (event.kind === "pipeline" && event.role === "archivist" && event.taskId === scene.taskId) addFx("archive", { dur: FX.archive });
    if (!mine) return;
    const step = event.step ?? null;
    if (event.kind === "agent.out") addFx("out", { step, dur: FX.out, child: event.taskId !== scene.taskId });
    else if (event.kind === "agent.home") addFx("home", { step, ok: event.ok !== false, dur: FX.pop + FX.back + FX.lap + FX.absorb });
    else if (event.kind === "report") addFx("report", { dur: FX.report, text: event.text });
    else if (event.kind === "step.grow") addFx("grow", { step, dur: FX.grow });
    else if (event.kind === "step.finish") addFx("edge", { step, dur: FX.edge });
    else if (event.kind === "help.ask") addFx("ask", { dur: FX.ask, text: event.text });
    else if (event.kind === "help.answer") addFx("desk", { dur: FX.deskTrip, text: event.text, ok: event.ok !== false });
    else if ((event.kind === "file.read" || event.kind === "file.edit") && Array.isArray(event.files)) addFx("files", { dur: 3.2, files: event.files.slice(0, 4), edit: event.kind === "file.edit" });
  }

  function stepPoint(layout, id) {
    const target = layout.at.get(id);
    if (!target) return layout.fold ?? layout.lead;
    return target;
  }

  function drawPipeline(ctx, W, H, t) {
    const P = palette();
    const pipeline = scene.taskId ? data.pipelines[scene.taskId] : null;
    const task = scene.taskId ? taskById(scene.taskId) : null;
    ctx.fillStyle = P.bg; ctx.fillRect(0, 0, W, H);
    if (!pipeline) {
      label(ctx, "No pipeline yet", W / 2, H / 2 - 10, { size: 15, weight: 650, color: P.ivory });
      label(ctx, "A task gets one the moment a worker is prepared for it.", W / 2, H / 2 + 14, { size: 12, color: P.muted });
      return;
    }
    const L = layoutPipeline(pipeline, W, H);
    scene.layout = L;
    // Eased positions: a new step springs out of its parent, a folded one
    // slides into the fold, so growing and shrinking read as motion.
    for (const step of L.steps) {
      const target = L.at.get(step.id);
      const held = scene.motion.get(step.id);
      if (!held) {
        const parent = (step.parents ?? []).map((id) => scene.motion.get(id)).find(Boolean);
        scene.motion.set(step.id, { x: parent?.x ?? target.x, y: parent?.y ?? target.y, s: still() ? 1 : 0.2 });
      }
      const m = scene.motion.get(step.id);
      const k = still() ? 1 : 0.18;
      m.x = lerp(m.x, target.x, k); m.y = lerp(m.y, target.y, k); m.s = lerp(m.s, 1, k);
    }
    for (const id of [...scene.motion.keys()]) if (!L.at.has(id)) scene.motion.delete(id);
    const pos = (id) => { const m = scene.motion.get(id); return m ? [m.x, m.y] : (L.fold ?? L.lead); };

    // tethers
    ctx.setLineDash([2, 5]); ctx.strokeStyle = rgba(P.mint, 0.35); ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(L.head[0], L.head[1]); ctx.lineTo(L.lead[0], L.lead[1]); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(L.lead[0], L.lead[1]); ctx.lineTo(L.desk[0], L.desk[1]); ctx.stroke();
    ctx.setLineDash([]);
    // edges
    const byId = new Map(L.steps.map((step) => [step.id, step]));
    for (const step of L.steps) {
      const parents = (step.parents ?? []).filter((id) => byId.has(id));
      const from = parents.length ? parents.map(pos) : [L.fold ?? L.lead];
      for (const a of from) {
        const b = pos(step.id);
        const done = parents.length && parents.every((id) => byId.get(id)?.status === "done");
        const lit = scene.hover === step.id;
        ctx.strokeStyle = lit ? P.bright : done ? rgba(P.good, 0.4) : rgba(P.mint, step.status === "active" ? 0.65 : 0.3); ctx.lineWidth = lit ? 1.8 : 1.15;
        const y0 = a[1] + (parents.length ? L.pillH / 2 : 14), y1 = b[1] - L.pillH / 2, mid = (y0 + y1) / 2;
        ctx.beginPath(); ctx.moveTo(a[0], y0); ctx.bezierCurveTo(a[0], mid, b[0], mid, b[0], y1); ctx.stroke();
      }
    }
    // a pulse runs down the wires of a step that just finished
    for (const fx of scene.fx) {
      if (fx.kind !== "edge") continue;
      const p = (t - fx.start) / fx.dur;
      if (p < 0 || p > 1) continue;
      const from = pos(fx.step);
      for (const step of L.steps.filter((row) => (row.parents ?? []).includes(fx.step))) {
        const to = pos(step.id);
        ctx.fillStyle = P.live; ctx.beginPath(); ctx.arc(lerp(from[0], to[0], p), lerp(from[1] + L.pillH / 2, to[1] - L.pillH / 2, p), 3, 0, Math.PI * 2); ctx.fill();
      }
    }
    // the folded work
    if (L.fold) {
      const [x, y] = L.fold;
      ctx.fillStyle = P.panel; roundRect(ctx, x - 70, y - 14, 140, 28, 14); ctx.fill();
      ctx.strokeStyle = rgba(P.good, 0.7); ctx.lineWidth = 1.2; ctx.stroke();
      label(ctx, `${L.folded} step${L.folded === 1 ? "" : "s"} done ✓`, x, y, { size: 11.5, weight: 600, color: P.good });
    }
    // steps
    const statusColor = { queued: P.line, active: P.live, done: P.good, failed: P.bad, retry: P.warn };
    for (const step of L.steps) {
      const [x, y] = pos(step.id);
      const s = scene.motion.get(step.id)?.s ?? 1;
      const w = L.pillW * s, h = L.pillH * s;
      ctx.fillStyle = P.panel; roundRect(ctx, x - w / 2, y - h / 2, w, h, 10); ctx.fill();
      ctx.fillStyle = rgba(statusColor[step.status] ?? P.mint, step.status === "active" ? 0.12 : 0.045); ctx.fill();
      ctx.strokeStyle = statusColor[step.status] ?? P.line; ctx.lineWidth = step.status === "queued" ? 1 : 1.6; ctx.stroke();
      if (scene.hover === step.id) { ctx.strokeStyle = rgba(P.bright, 0.5); ctx.lineWidth = 1; roundRect(ctx, x - w / 2 - 4, y - h / 2 - 4, w + 8, h + 8, 12); ctx.stroke(); }
      if (s > 0.7) {
        const title = window.MefiNodeVisuals?.fitText(ctx, step.title, Math.max(0, w - 20), `650 13px ${FONT}`) ?? clip(step.title, Math.max(8, Math.floor(w / 7.5)));
        label(ctx, title, x, y - 7, { size: 13, weight: 650, color: P.ivory, alpha: s });
        const words = step.status === "done" ? "done ✓" : step.status === "active" ? "working" : step.status === "retry" ? "retrying" : step.status === "failed" ? "failed" : step.child ? "sub-agent" : "queued";
        label(ctx, words, x, y + 9, { size: 11, color: step.status === "queued" ? P.muted : statusColor[step.status], alpha: s });
      }
      const grow = scene.fx.find((fx) => fx.kind === "grow" && fx.step === step.id);
      if (grow) {
        const p = (t - grow.start) / grow.dur;
        if (p >= 0 && p <= 1) label(ctx, "+ step", x + w / 2 + 4, y - h / 2 - 6, { size: 11, weight: 700, color: P.live, align: "left", alpha: 1 - p });
      }
    }
    // head, lead, desk, Playbook
    const head = L.head, lead = L.lead;
    body(ctx, head[0], head[1], 17 * (1 + 0.04 * Math.sin(t * 2)), P.bright, t, P);
    label(ctx, companionName(), head[0] + 30, head[1] - 7, { size: 13, weight: 700, color: P.ivory, align: "left" });
    label(ctx, "head · plans", head[0] + 30, head[1] + 9, { size: 11, color: P.muted, align: "left" });
    body(ctx, lead[0], lead[1], 12, P.mint, t, P);
    const running = data.running.filter((run) => run.taskId === scene.taskId || byId.has(run.taskId)).length;
    label(ctx, "Lead", lead[0] + 34, lead[1] - 7, { size: 12.5, weight: 700, color: P.ivory, align: "left" });
    label(ctx, `${running} out · ${pipeline.summary?.done ?? 0} steps done`, lead[0] + 34, lead[1] + 9, { size: 11, color: P.muted, align: "left" });
    body(ctx, L.desk[0], L.desk[1], 9, P.warn, t, P);
    label(ctx, "Desk", L.desk[0], L.desk[1] + 22, { size: 11.5, weight: 650, color: P.ivory });
    const bump = scene.fx.some((fx) => fx.kind === "archive" && (t - fx.start) / fx.dur > 0.7) ? 1.15 : 1;
    ctx.fillStyle = P.panel; ctx.strokeStyle = P.violet; ctx.lineWidth = 1.3;
    roundRect(ctx, L.book[0] - 18 * bump, L.book[1] - 13 * bump, 36 * bump, 26 * bump, 4); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(L.book[0], L.book[1] - 13 * bump); ctx.lineTo(L.book[0], L.book[1] + 13 * bump); ctx.stroke();
    label(ctx, "Playbook", L.book[0], L.book[1] + 26, { size: 11.5, weight: 650, color: P.ivory });
    if (pipeline.recipeName) label(ctx, clip(pipeline.recipeName, 24), L.book[0], L.book[1] + 40, { size: 10.5, color: P.violet });

    // working sub-agents circle their active steps
    const active = L.steps.filter((step) => step.status === "active");
    active.forEach((step, i) => {
      const [x, y] = pos(step.id);
      const a = t * 1.9 + i * 2.1;
      const ax = x + (L.pillW / 2 + 9) * Math.cos(a), ay = y + (L.pillH / 2 + 8) * Math.sin(a);
      body(ctx, ax, ay, 6, step.child ? P.info : P.live, t, P);
      const asking = scene.fx.find((fx) => fx.kind === "ask" || (fx.kind === "desk" && t - fx.start < FX.deskTrip * 0.6));
      if (asking && i === 0) {
        ctx.fillStyle = P.warn; roundRect(ctx, ax - 8, ay - 28, 16, 15, 5); ctx.fill();
        label(ctx, "?", ax, ay - 20, { size: 11, weight: 800, color: "#000" });
      }
    });

    // the event choreography
    const firstActive = active[0] ? pos(active[0].id) : (L.steps.at(-1) ? pos(L.steps.at(-1).id) : lead);
    for (const fx of scene.fx) {
      const u = t - fx.start;
      if (fx.kind === "out") {
        const p = easeInOut(u / fx.dur);
        const to = fx.step ? pos(fx.step) : firstActive;
        const x = lerp(lead[0], to[0], p) - Math.sin(p * Math.PI) * 40, y = lerp(lead[1], to[1], p);
        for (let i = 1; i <= 6; i += 1) {
          const q = clamp(p - i * 0.04);
          ctx.fillStyle = rgba(P.mint, 0.3 * (1 - i / 7));
          ctx.beginPath(); ctx.arc(lerp(lead[0], to[0], q) - Math.sin(q * Math.PI) * 40, lerp(lead[1], to[1], q), 6 * (1 - i / 9), 0, Math.PI * 2); ctx.fill();
        }
        body(ctx, x, y, 6, fx.child ? P.info : P.mint, t, P);
      } else if (fx.kind === "home") {
        const from = fx.step ? pos(fx.step) : firstActive;
        const R = 12 + 16;
        if (u < FX.pop) popFx(ctx, from[0], from[1] - L.pillH / 2 - 6, 6, u / FX.pop, t, P, fx.ok);
        else if (u < FX.pop + FX.back) {
          const p = easeInOut((u - FX.pop) / FX.back);
          const start = [from[0], from[1] - L.pillH / 2 - 6], end = [lead[0] + R, lead[1]];
          const x = lerp(start[0], end[0], p) + Math.sin(p * Math.PI) * 50, y = lerp(start[1], end[1], p);
          for (let i = 1; i <= 6; i += 1) {
            const q = clamp(p - i * 0.04);
            ctx.fillStyle = rgba(fx.ok ? P.live : P.bad, 0.3 * (1 - i / 7));
            ctx.beginPath(); ctx.arc(lerp(start[0], end[0], q) + Math.sin(q * Math.PI) * 50, lerp(start[1], end[1], q), 6 * (1 - i / 9), 0, Math.PI * 2); ctx.fill();
          }
          body(ctx, x, y, 6, fx.ok ? P.live : P.bad, t, P);
        } else if (u < FX.pop + FX.back + FX.lap) {
          const a = ((u - FX.pop - FX.back) / FX.lap) * Math.PI * 2;
          body(ctx, lead[0] + R * Math.cos(a), lead[1] + R * Math.sin(a), 6, fx.ok ? P.live : P.bad, t, P);
        } else {
          const p = (u - FX.pop - FX.back - FX.lap) / FX.absorb;
          absorbFx(ctx, lead, 12, clamp(p), t, P);
          const k = 1 - easeOut(p);
          if (k > 0.05) body(ctx, lead[0] + R * (1 - p), lead[1], 6 * k, fx.ok ? P.live : P.bad, t, P);
        }
      } else if (fx.kind === "report") {
        const p = easeInOut(u / fx.dur);
        const x = lead[0], y = lerp(lead[1] - 14, head[1] + 18, p);
        ctx.fillStyle = P.live; ctx.beginPath();
        ctx.moveTo(x, y - 6); ctx.lineTo(x + 5, y + 2); ctx.lineTo(x + 1.6, y + 2); ctx.lineTo(x + 1.6, y + 6); ctx.lineTo(x - 1.6, y + 6); ctx.lineTo(x - 1.6, y + 2); ctx.lineTo(x - 5, y + 2); ctx.closePath(); ctx.fill();
      } else if (fx.kind === "ask") {
        const p = easeInOut(u / fx.dur);
        const x = lerp(firstActive[0], L.desk[0], p), y = lerp(firstActive[1], L.desk[1], p);
        ctx.fillStyle = P.warn; ctx.beginPath(); ctx.arc(x, y, 5.5, 0, Math.PI * 2); ctx.fill();
        label(ctx, "?", x, y + 0.5, { size: 9, weight: 800, color: "#000" });
      } else if (fx.kind === "desk") {
        const near = [firstActive[0] - L.pillW / 2 - 16, firstActive[1] - 8];
        const go = u / (fx.dur * 0.25), back = (u - fx.dur * 0.75) / (fx.dur * 0.25);
        const p = u < fx.dur * 0.25 ? easeInOut(go) : u > fx.dur * 0.75 ? 1 - easeInOut(back) : 1;
        const x = lerp(L.desk[0], near[0], p), y = lerp(L.desk[1], near[1], p);
        body(ctx, x, y, 6, P.warn, t, P);
        if (u > fx.dur * 0.25 && u < fx.dur * 0.8) {
          const cardQ = Math.min(1, (u - fx.dur * 0.25) / 0.3) * (1 - clamp((u - fx.dur * 0.7) / 0.3));
          const cw = Math.min(260, W * 0.4), cx = clamp(x - cw - 8, 8, W - cw - 8), cy = clamp(y - 20, 8, H - 60);
          ctx.globalAlpha = cardQ;
          ctx.fillStyle = "rgba(11,24,32,0.96)"; roundRect(ctx, cx, cy, cw, 48, 8); ctx.fill();
          ctx.strokeStyle = rgba(P.warn, 0.7); ctx.lineWidth = 1; ctx.stroke();
          label(ctx, fx.ok ? "Desk answer" : "Sent to you", cx + 10, cy + 13, { size: 11, weight: 650, color: P.warn, align: "left", alpha: cardQ });
          label(ctx, clip(fx.text, Math.floor(cw / 6.4)), cx + 10, cy + 32, { size: 11, color: P.ivory, align: "left", alpha: cardQ });
          ctx.globalAlpha = 1;
        }
      } else if (fx.kind === "files") {
        // The files a verified run read or changed drift out of its step and
        // fade: where the work has been, as it lands on the project map.
        const from = firstActive;
        fx.files.forEach((file, i) => {
          const p = clamp((u - i * 0.25) / (fx.dur - 0.8));
          if (p <= 0 || p >= 1) return;
          const name = String(file).split(/[\\/]/).pop();
          label(ctx, `${fx.edit ? "✎" : "◦"} ${clip(name, 26)}`, from[0] + L.pillW / 2 + 16 + p * 70, from[1] - 20 + i * 15 - p * 24, { size: 11, color: fx.edit ? P.live : P.muted, align: "left", alpha: 1 - p });
        });
      } else if (fx.kind === "archive") {
        const p = easeInOut(u / fx.dur);
        const mid = [W / 2 + L.pillW / 2 + 30, (lead[1] + H) / 2];
        const x = p < 0.5 ? lerp(L.book[0], mid[0], p * 2) : lerp(mid[0], L.book[0], (p - 0.5) * 2);
        const y = p < 0.5 ? lerp(L.book[1] - 30, mid[1], p * 2) : lerp(mid[1], L.book[1], (p - 0.5) * 2);
        body(ctx, x, y, 7, P.violet, t, P);
      }
    }
    if (task && task.title) label(ctx, clip(task.title, 60), 14, H - 14, { size: 11.5, color: P.dim, align: "left" });
  }

  // ---- the project map -------------------------------------------------------------

  // Systems laid out top down, like a graph that goes down: the warmest,
  // best-linked system first, then what it is linked to, level by level. A
  // row is ordered by where its links come from (the barycenter of the
  // systems already placed), so lines cross as little as they can.
  const warmthOf = (system) => Number(system?.warmth ?? system?.heat ?? 0) || 0;
  const systemPriority = (row) => {
    const path = String(row.path ?? row.id ?? "").toLowerCase();
    const support = /^(?:docs?|tests?|tools?|scripts?|fixtures?|\.codex|root(?:\/|$))/.test(path);
    return (row.tasks?.active ?? 0) * 150 + (row.tasks?.open ?? 0) * 35 + Math.sqrt(row.fileCount ?? 0) * 15 + Math.min(50, warmthOf(row) / 10) - (support ? 300 : 0);
  };
  const rankedSystems = (map) => [...(map?.systems ?? [])].sort((a, b) => systemPriority(b) - systemPriority(a) || String(a.name).localeCompare(String(b.name)));
  // The system a map opens on: the one with the most live work, then the
  // most open work, then the warmest.
  function openingSystem(map) {
    return rankedSystems(map)[0]?.id ?? null;
  }

  // The links worth drawing: the strongest (by strength; a notebook edited in
  // every commit is weak however often it co-changes) and at most three per
  // system, so the map stays readable. The rest stay in the data.
  function visibleLinks(map) {
    const rows = [...(map?.links ?? [])].sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0) || (b.weight ?? 0) - (a.weight ?? 0));
    const count = new Map();
    const kept = [];
    for (const link of rows) {
      if (link.strength != null && link.strength < 0.2) continue;
      if ((count.get(link.a) ?? 0) >= 3 || (count.get(link.b) ?? 0) >= 3) continue;
      count.set(link.a, (count.get(link.a) ?? 0) + 1);
      count.set(link.b, (count.get(link.b) ?? 0) + 1);
      kept.push(link);
    }
    return kept;
  }
  function layoutMap(map, W) {
    const systems = [...(map?.systems ?? [])].sort((a, b) => warmthOf(b) - warmthOf(a) || (b.fileCount ?? b.files?.length ?? 0) - (a.fileCount ?? a.files?.length ?? 0));
    const links = visibleLinks(map);
    const neighbours = new Map(systems.map((row) => [row.id, new Map()]));
    for (const link of links) {
      neighbours.get(link.a)?.set(link.b, link.weight ?? 1);
      neighbours.get(link.b)?.set(link.a, link.weight ?? 1);
    }
    const level = new Map();
    for (const root of systems) {
      if (level.has(root.id)) continue;
      level.set(root.id, level.size ? Math.max(...level.values()) + 1 : 0);
      const queue = [root.id];
      while (queue.length) {
        const id = queue.shift();
        const next = [...(neighbours.get(id) ?? new Map()).entries()].sort((a, b) => b[1] - a[1]).map(([other]) => other);
        for (const other of next) if (!level.has(other)) { level.set(other, level.get(id) + 1); queue.push(other); }
      }
    }
    const boxW = W < 520 ? Math.max(120, Math.floor((W - 36) / 2)) : 168;
    const boxH = 64, gapX = 16, gapY = 40;
    const perRow = Math.max(1, Math.floor((W - 24 + gapX) / (boxW + gapX)));
    const rows = [];
    for (const system of systems) {
      let row = level.get(system.id) ?? 0;
      while ((rows[row]?.length ?? 0) >= perRow) row += 1;
      (rows[row] ??= []).push(system);
    }
    const at = new Map();
    const dense = rows.filter(Boolean);
    dense.forEach((row, index) => {
      if (index > 0) {
        const bary = (system) => {
          const placed = [...(neighbours.get(system.id) ?? new Map()).entries()].filter(([other]) => at.has(other));
          if (!placed.length) return Infinity;
          const total = placed.reduce((sum, [, weight]) => sum + weight, 0);
          return placed.reduce((sum, [other, weight]) => sum + at.get(other).x * weight, 0) / total;
        };
        row.sort((a, b) => bary(a) - bary(b));
      }
      const span = (row.length - 1) * (boxW + gapX);
      row.forEach((system, i) => at.set(system.id, { x: W / 2 - span / 2 + i * (boxW + gapX), y: 26 + index * (boxH + gapY) + boxH / 2 }));
    });
    return { at, boxW, boxH, height: 26 + dense.length * (boxH + gapY), systems, links, neighbours };
  }

  function drawMap(ctx, W, H, t, map, selected, hovered = null) {
    const P = palette();
    ctx.fillStyle = P.bg; ctx.fillRect(0, 0, W, H);
    if (!map?.systems?.length) {
      label(ctx, "No systems yet", W / 2, H / 2 - 12, { size: 14, weight: 650, color: P.ivory });
      label(ctx, "The map is built from the project's git history and every verified run.", W / 2, H / 2 + 12, { size: 12, color: P.muted });
      return null;
    }
    const L = layoutMap(map, W);
    // Hover dims what is not linked; a choice only lights its own links.
    const focus = hovered ?? selected;
    const near = hovered ? new Set([hovered, ...(L.neighbours.get(hovered)?.keys() ?? [])]) : null;
    const maxWeight = Math.max(1, ...L.links.map((link) => link.weight ?? 1));
    for (const link of L.links) {
      const a = L.at.get(link.a), b = L.at.get(link.b);
      if (!a || !b) continue;
      const strength = link.strength != null ? Math.min(1, link.strength) : (link.weight ?? 1) / maxWeight;
      const lit = focus && (link.a === focus || link.b === focus);
      ctx.strokeStyle = lit ? rgba(P.bright, 0.55 + 0.4 * strength) : rgba(P.mint, focus ? 0.06 : 0.14 + 0.36 * strength);
      ctx.lineWidth = (lit ? 1.5 : 1) + 2.2 * strength;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.bezierCurveTo(a.x, (a.y + b.y) / 2, b.x, (a.y + b.y) / 2, b.x, b.y); ctx.stroke();
    }
    const maxWarmth = Math.max(1, ...L.systems.map(warmthOf));
    for (const system of L.systems) {
      const { x, y } = L.at.get(system.id);
      const faded = near && !near.has(system.id);
      ctx.save();
      if (faded) ctx.globalAlpha = 0.45;
      const warm = warmthOf(system) / maxWarmth;
      if (warm > 0.05) {
        ctx.fillStyle = rgba(P.live, 0.05 + 0.14 * warm * (still() ? 1 : 0.8 + 0.2 * Math.sin(t * 1.6 + x / 60)));
        roundRect(ctx, x - L.boxW / 2 - 6, y - L.boxH / 2 - 6, L.boxW + 12, L.boxH + 12, 14); ctx.fill();
      }
      ctx.fillStyle = P.panel; roundRect(ctx, x - L.boxW / 2, y - L.boxH / 2, L.boxW, L.boxH, 10); ctx.fill();
      const edge = selected === system.id ? P.bright : hovered === system.id ? P.mint : system.source === "cluster" ? rgba(P.mint, 0.45) : P.line;
      ctx.strokeStyle = edge; ctx.lineWidth = selected === system.id ? 2 : 1; ctx.stroke();
      const maxChars = Math.floor((L.boxW - 24) / 7);
      label(ctx, clip(system.name || system.id, maxChars), x - L.boxW / 2 + 12, y - 15, { size: 12.5, weight: 650, color: P.ivory, align: "left" });
      const where = system.source === "cluster" ? `in ${system.parent ?? ""}/` : system.path || "project root";
      label(ctx, clip(`${system.fileCount ?? system.files?.length ?? 0} files · ${where}`, maxChars + 4), x - L.boxW / 2 + 12, y + 2, { size: 10.5, color: P.muted, align: "left" });
      const counts = system.tasks ?? { done: 0, active: 0, open: 0 };
      const total = counts.done + counts.active + counts.open;
      const barW = L.boxW - 24; let cursor = x - L.boxW / 2 + 12;
      if (!total) { ctx.fillStyle = rgba(P.dim, 0.35); ctx.fillRect(cursor, y + 18, barW, 3); }
      for (const [key, color] of [["done", P.good], ["active", P.live], ["open", P.dim]]) {
        const w = total ? barW * ((counts[key] ?? 0) / total) : 0;
        if (w <= 0) continue;
        ctx.fillStyle = color; ctx.fillRect(cursor, y + 17, w, 4); cursor += w;
      }
      ctx.restore();
    }
    return L;
  }

  function systemAt(L, x, y) {
    if (!L) return null;
    for (const system of L.systems) {
      const at = L.at.get(system.id);
      if (Math.abs(x - at.x) <= L.boxW / 2 && Math.abs(y - at.y) <= L.boxH / 2) return system;
    }
    return null;
  }

  // One map on a canvas, shared by the Agent brain sheet and Home: it grows
  // to fit its systems (the stage scrolls), lights the hovered or chosen
  // system's links, shows a card on hover, and offers a keyboard picker and a
  // legend beside it. `onSelect` hears every choice.
  function mountLegacyMap({ canvas, stage, tools = null, minHeight = 300, onSelect }) {
    const widget = { layout: null, selected: null, hovered: null, view: null };
    const tip = node("div", "ab-tip");
    tip.hidden = true;
    tip.setAttribute("role", "tooltip");
    stage.append(tip);
    let picker = null;
    if (tools) {
      picker = node("select", "ab-picker");
      picker.setAttribute("aria-label", "Jump to a system");
      picker.addEventListener("change", () => choose(picker.value || null));
      const legend = node("div", "ab-legend");
      legend.append(
        node("span", "ab-key ab-key-done", "done"), node("span", "ab-key ab-key-live", "working"), node("span", "ab-key ab-key-open", "open"),
        node("span", "ab-key ab-key-glow", "recent work"), node("span", "ab-key ab-key-link", "change together"),
      );
      tools.append(picker, legend);
    }
    const find = (id) => data.map?.systems?.find((row) => row.id === id) ?? null;
    function choose(id) {
      widget.selected = id;
      if (picker) picker.value = id ?? "";
      widget.view.paint();
      onSelect?.(find(id));
    }
    function sync() {
      if (!picker) return;
      const systems = [...(data.map?.systems ?? [])].sort((a, b) => String(a.name).localeCompare(String(b.name)));
      const signature = systems.map((row) => `${row.id}:${row.name}`).join("|");
      if (picker.dataset.signature !== signature) {
        picker.dataset.signature = signature;
        picker.textContent = "";
        const first = node("option", "", "Jump to a system…");
        first.value = "";
        picker.append(first, ...systems.map((row) => { const option = node("option", "", `${row.name} · ${row.fileCount ?? row.files?.length ?? 0} files`); option.value = row.id; return option; }));
      }
      picker.value = widget.selected ?? "";
    }
    widget.view = makeCanvas(canvas, (ctx, W, H, t) => {
      widget.layout = drawMap(ctx, W, H, t, data.map, widget.selected, widget.hovered);
      // The canvas is as tall as the map; the stage around it scrolls.
      const want = Math.max(minHeight, Math.ceil((widget.layout?.height ?? 0) + 12));
      if (Math.abs((parseFloat(canvas.style.height) || 0) - want) > 4) {
        canvas.style.height = `${want}px`;
        requestAnimationFrame(() => widget.view.resize());
      }
    });
    widget.view.hot = () => false;
    const point = (event) => { const box = canvas.getBoundingClientRect(); return [event.clientX - box.left, event.clientY - box.top]; };
    canvas.addEventListener("click", (event) => choose(systemAt(widget.layout, ...point(event))?.id ?? null));
    canvas.addEventListener("mousemove", (event) => {
      const [x, y] = point(event);
      const system = systemAt(widget.layout, x, y);
      if ((system?.id ?? null) !== widget.hovered) { widget.hovered = system?.id ?? null; widget.view.paint(); }
      if (!system) { tip.hidden = true; return; }
      tip.textContent = "";
      tip.append(node("strong", "", system.name || system.id));
      if (system.what) tip.append(node("span", "", system.what));
      const counts = system.tasks ?? {};
      tip.append(node("span", "ab-quiet", `${system.fileCount ?? system.files?.length ?? 0} files · ${system.edits ?? 0} changes · tasks ${counts.done ?? 0} done, ${counts.active ?? 0} working, ${counts.open ?? 0} open`));
      const top = (system.files ?? []).slice(0, 3).map((row) => row.path.split("/").pop()).join(", ");
      if (top) tip.append(node("span", "ab-quiet", `Most changed: ${top}`));
      tip.hidden = false;
      const box = stage.getBoundingClientRect();
      const left = Math.min(event.clientX - box.left + stage.scrollLeft + 14, stage.scrollWidth - 250);
      tip.style.left = `${Math.max(6, left)}px`;
      tip.style.top = `${event.clientY - box.top + stage.scrollTop + 14}px`;
    });
    canvas.addEventListener("mouseleave", () => { tip.hidden = true; if (widget.hovered) { widget.hovered = null; widget.view.paint(); } });
    widget.choose = choose;
    widget.sync = () => { sync(); widget.view.paint(); };
    return widget;
  }

  // The explorer presents one scale at a time. A system opens into parts,
  // then a part opens into its present files. The isometric chunks share the
  // Command tree's depth cues without forcing every project into one graph.
  function mapParts(system) {
    const base = String(system.path ?? "").replace(/\/+$/, "");
    const groups = new Map();
    for (const file of system.catalog ?? system.files ?? []) {
      const rest = !base ? file.path : file.path.startsWith(base + "/") ? file.path.slice(base.length + 1) : file.path.split("/").pop();
      const bits = rest.split("/");
      const key = bits.length > 1 ? bits[0] : ":files";
      const part = groups.get(key) ?? { id: key, name: key === ":files" ? "Core files" : key.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()), files: [], present: 0, hot: 0 };
      part.files.push(file);
      if (file.present !== false) part.present += 1;
      part.hot += file.edits ?? 0;
      groups.set(key, part);
    }
    return [...groups.values()].sort((a, b) => b.present - a.present || b.hot - a.hot || a.name.localeCompare(b.name));
  }
  function drawChunk(ctx, item, x, y, scale, P, { selected = false, hovered = false, muted = false, labelScale = 1, showLabels = true } = {}) {
    const w = 61 * scale, h = 29 * scale, depth = 25 * scale;
    const tint = item.active ? P.live : item.hot ? P.mint : item.present === 0 ? P.dim : P.info;
    ctx.save();
    if (muted) ctx.globalAlpha *= 0.42;
    const finishes = window.MefiNodeVisuals?.surfacePaints(ctx, tint, Boolean(selected || hovered || item.active));
    if (finishes && (selected || hovered || item.active)) {
      ctx.save(); ctx.translate(x, y + 10); ctx.scale(w, w);
      ctx.fillStyle = finishes.glow; ctx.beginPath(); ctx.arc(0, 0, 2.4, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    } else if (selected || hovered || item.active) {
      const glow = ctx.createRadialGradient(x, y + 10, 4, x, y + 10, w * 1.7);
      glow.addColorStop(0, rgba(tint, selected ? 0.28 : 0.15)); glow.addColorStop(1, rgba(tint, 0));
      ctx.fillStyle = glow; ctx.fillRect(x - w * 2, y - h * 2, w * 4, h * 5);
    }
    ctx.beginPath(); ctx.moveTo(x - w, y); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h + depth); ctx.lineTo(x - w, y + depth); ctx.closePath();
    ctx.fillStyle = window.MefiNodeVisuals?.mix(P.panel, tint, 0.28) ?? rgba(tint, 0.24); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + w, y); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h + depth); ctx.lineTo(x + w, y + depth); ctx.closePath();
    ctx.fillStyle = window.MefiNodeVisuals?.mix(P.panel, tint, 0.12) ?? rgba(tint, 0.11); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x, y - h); ctx.lineTo(x + w, y); ctx.lineTo(x, y + h); ctx.lineTo(x - w, y); ctx.closePath();
    ctx.fillStyle = P.panel; ctx.fill();
    if (finishes) {
      ctx.save(); ctx.translate(x, y); ctx.scale(w, h);
      ctx.beginPath(); ctx.moveTo(0, -1); ctx.lineTo(1, 0); ctx.lineTo(0, 1); ctx.lineTo(-1, 0); ctx.closePath();
      ctx.fillStyle = finishes.glass; ctx.fill(); ctx.restore();
    } else { ctx.fillStyle = rgba(tint, selected ? 0.45 : 0.25); ctx.fill(); }
    ctx.strokeStyle = selected ? P.bright : hovered ? tint : rgba(tint, 0.55);
    ctx.lineWidth = selected ? 2.2 : 1.2; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - w, y + depth); ctx.lineTo(x, y + h + depth); ctx.lineTo(x + w, y + depth);
    ctx.strokeStyle = rgba(tint, 0.35); ctx.lineWidth = 1; ctx.stroke();
    if (item.active) { ctx.fillStyle = P.live; ctx.beginPath(); ctx.arc(x, y - 4 * scale, 5 * scale, 0, Math.PI * 2); ctx.fill(); }
    if (showLabels) {
      const titleSize = 12 * labelScale, metaSize = 10.5 * labelScale;
      const title = window.MefiNodeVisuals?.fitText(ctx, item.name, 180 * scale, `680 ${titleSize}px ${FONT}`) ?? clip(item.name, 22);
      const subtitle = window.MefiNodeVisuals?.fitText(ctx, item.subtitle, 180 * scale, `500 ${metaSize}px ${FONT}`) ?? item.subtitle;
      label(ctx, title, x, y + h + depth + 15 * labelScale, { size: titleSize, weight: 680, color: P.ivory });
      label(ctx, subtitle, x, y + h + depth + 31 * labelScale, { size: metaSize, color: P.muted });
    }
    ctx.restore();
  }
  function mountMap(options) {
    return window.MefiProjectMap.create({
      ...options, getMap: () => data.map, getProject: () => data.mapProject,
      partsOf: mapParts, rankSystems: rankedSystems, linksOf: visibleLinks,
      makeCanvas, drawChunk, palette, rgba, label, still,
    });
  }

  // What belongs to a system: its tasks (from the map's own record), and the
  // ideas and plans whose words name it.
  function regionItems(system) {
    if (!system) return { tasks: [], ideas: [], plans: [] };
    const words = [system.id, system.name, ...(String(system.path ?? "").split(/[\\/]/))].map((word) => String(word ?? "").toLowerCase()).filter((word) => word.length >= 4);
    const mentions = (text) => { const low = String(text ?? "").toLowerCase(); return words.some((word) => low.includes(word)); };
    const ids = new Set(system.taskIds ?? []);
    const tasks = data.tasks.filter((task) => ids.has(task.id) || mentions(`${task.title} ${task.prompt ?? ""}`)).slice(0, 12);
    // A placement the owner made wins over word matching, both ways: an item
    // placed on another system is not shown here even if its words match.
    const placed = (bucket, item) => data.places?.[bucket]?.[item.id];
    const ideas = data.ideas.filter((idea) => (placed("ideas", idea) ? placed("ideas", idea) === system.id : mentions(`${idea.title ?? ""} ${idea.text ?? idea.body ?? idea.detail ?? ""}`))).slice(0, 8);
    const plans = data.plans.filter((plan) => (placed("plans", plan) ? placed("plans", plan) === system.id : mentions(`${plan.title ?? plan.name ?? ""} ${plan.destination ?? plan.goal ?? ""}`))).slice(0, 6);
    const loose = data.ideas.filter((idea) => !placed("ideas", idea) && !ideas.includes(idea)).slice(0, 6);
    return { tasks, ideas, plans, loose };
  }

  // Where the map came from, in words.
  function sourceLine(map) {
    const count = map?.systems?.length ?? 0;
    const commits = map?.sources?.commits ?? 0;
    const runs = map?.sources?.runs ?? 0;
    const from = [commits ? `${commits} commit${commits === 1 ? "" : "s"}` : "", runs ? `${runs} verified run${runs === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ");
    return `${count} systems · ${map?.sources?.present ?? "?"} present files${from ? ` · work from ${from}` : ""}${map?.builtAt ? ` · scanned ${ago(map.builtAt)}` : ""}`;
  }

  function workOnRegion(system, part = null, file = null) {
    if (!system) return;
    window.MefiNav?.go?.("workspace");
    setTimeout(() => {
      const input = $("workspace-input");
      if (!input) return;
      $("workspace-mode-work")?.click?.();
      const hot = (file ? [file] : part?.files ?? system.files ?? []).slice(0, 3).map((row) => row.path).join(", ");
      const region = file ? file.path : `${system.name || system.id}${part ? ` / ${part.name}` : ""}${system.path ? ` (${system.path})` : ""}`;
      input.value = `In ${region}:\n\n<What should change here, and how do we check it?>\n${hot ? `\nFiles agents changed most here: ${hot}` : ""}`;
      input.focus();
      const at = input.value.indexOf("<What");
      input.setSelectionRange?.(at, at + "<What should change here, and how do we check it?>".length);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, 60);
  }

  function renderRegion(target, system, { compact = false, part = null, file = null } = {}) {
    target.textContent = "";
    const explorer = () => compact ? hub.map : sheetMap;
    if (!system) {
      target.append(node("p", "pm-region-kicker", "Project overview"), node("h3", "", "Find your next starting point"), node("p", "ab-quiet", "Inspect a system, follow what connects it, or search for a file. Double-click a chunk to explore inside."));
      const stats = node("div", "pm-overview-stats");
      const systems = data.map?.systems ?? [];
      for (const [value, name] of [[systems.length, "systems"], [data.map?.sources?.present ?? systems.reduce((sum, row) => sum + (row.fileCount ?? 0), 0), "present files"]]) {
        const stat = node("div", "pm-overview-stat"); stat.append(node("strong", "", value), node("span", "", name)); stats.append(stat);
      }
      target.append(stats);
      const section = node("section", "ab-region-list"); section.append(node("h4", "", "Places to explore"));
      const list = node("ul");
      for (const row of rankedSystems(data.map).slice(0, 6)) {
        const li = node("li"), open = node("button", "ab-link pm-region-row", row.name || row.id); open.type = "button";
        open.addEventListener("click", () => explorer()?.choose(row.id));
        li.append(open, node("span", "ab-quiet", row.tasks?.active ? `${row.tasks.active} working` : `${row.fileCount ?? 0} files`)); list.append(li);
      }
      section.append(list); target.append(section);
      return;
    }
    const head = node("div", "ab-region-head");
    head.append(node("p", "pm-region-kicker", file ? "File" : part ? "Part" : "System"));
    head.append(node("h3", "", file ? file.path.split("/").pop() : part?.name || system.name || system.id));
    if (system.what) head.append(node("p", "ab-quiet", system.what));
    if (file?.path || system.path) head.append(node("code", "ab-path", file?.path || system.path));
    head.append(node("p", "ab-focus", `${system.fileCount ?? 0} present files${system.historicalCount ? ` · ${system.historicalCount} no longer present` : ""}`));
    if (part) head.append(node("p", "ab-focus", `${part.name} · ${part.present} present files`));
    if (file) head.append(node("p", "ab-focus", `${file.path} · ${file.present === false ? "no longer present" : "present"}${file.edits ? ` · ${file.edits} changes` : ""}`));
    target.append(head);
    const actions = node("div", "pm-region-actions");
    if (!file) {
      const explore = node("button", "primary mini", part ? "Explore files →" : "Explore parts →"); explore.type = "button";
      explore.addEventListener("click", () => part ? explorer()?.enterPart(part.id) : explorer()?.choose(system.id)); actions.append(explore);
    }
    const work = node("button", "ghost mini", file ? "Work on this file" : "Work here");
    work.type = "button";
    work.addEventListener("click", () => workOnRegion(system, part, file));
    actions.append(work);
    if (file?.path) {
      const copy = node("button", "ghost mini", "Copy path"); copy.type = "button";
      copy.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(file.path); copy.textContent = "Copied"; }
        catch { window.MefiToast?.("The file path could not be copied", "warn"); }
      }); actions.append(copy);
    }
    target.append(actions);
    const { tasks, ideas, plans, loose } = regionItems(system);
    const place = async (kind, id, systemId) => {
      const result = await bridge()?.brainMapPlace?.({ kind, id, systemId }).catch(() => null);
      if (!result?.ok) { window.MefiToast?.(result?.error ?? "That could not be placed", "warn"); return; }
      data.places = result.places ?? data.places;
      changed("work");
    };
    const pinButton = (kind, item, here) => {
      const button = node("button", "ghost mini", here ? "Lift off" : "Place here");
      button.type = "button";
      button.title = here ? "Take this off the system; it will show wherever its words fit" : `Keep this on ${system.name || system.id}`;
      button.addEventListener("click", () => place(kind, item.id, here ? null : system.id));
      return button;
    };
    const list = (title, rows, render) => {
      const section = node("section", "ab-region-list");
      section.append(node("h4", "", `${title} · ${rows.length}`));
      if (!rows.length) section.append(node("p", "ab-quiet", "None yet"));
      const ol = node("ul");
      for (const row of rows) ol.append(render(row));
      section.append(ol);
      target.append(section);
    };
    if (!part && !file) {
      const related = (data.map?.links ?? []).filter(link => link.a === system.id || link.b === system.id).sort((a, b) => (b.strength ?? b.weight ?? 0) - (a.strength ?? a.weight ?? 0)).slice(0, 5)
        .map(link => data.map.systems.find(row => row.id === (link.a === system.id ? link.b : link.a))).filter(Boolean);
      if (related.length) list("Changes together", related, row => {
        const li = node("li"), open = node("button", "ab-link pm-region-row", `${row.name || row.id} →`); open.type = "button";
        open.addEventListener("click", () => explorer()?.choose(row.id)); li.append(open); return li;
      });
    }
    list("Tasks", tasks, (task) => {
      const li = node("li");
      const open = node("button", "ab-link", clip(task.title, 70));
      open.type = "button";
      open.addEventListener("click", () => window.MefiTasks?.open?.({ taskId: task.id }));
      li.append(open, node("span", `ab-chip ab-chip-${task.status === "done" ? "good" : task.status === "active" || task.status === "awaiting_verification" ? "live" : "dim"}`, task.status === "awaiting_verification" ? "verifying" : task.status ?? "open"));
      return li;
    });
    list("Ideas", ideas, (idea) => {
      const li = node("li");
      li.append(node("span", "", clip(idea.title ?? idea.text ?? "Idea", 70)), pinButton("idea", idea, data.places?.ideas?.[idea.id] === system.id));
      return li;
    });
    list("Plans", plans, (plan) => {
      const li = node("li");
      const open = node("button", "ab-link", clip(plan.title ?? plan.name ?? "Plan", 70));
      open.type = "button";
      open.addEventListener("click", () => window.MefiPlanning?.open?.({ planId: plan.id }));
      li.append(open, pinButton("plan", plan, data.plans && data.places?.plans?.[plan.id] === system.id));
      return li;
    });
    if (loose.length) {
      list("Ideas not on the map yet", loose, (idea) => {
        const li = node("li");
        li.append(node("span", "ab-quiet", clip(idea.title ?? idea.text ?? "Idea", 70)), pinButton("idea", idea, false));
        return li;
      });
    }
    if (!compact && !part) {
      const parts = mapParts(system);
      const section = node("section", "ab-region-list");
      section.append(node("h4", "", `Parts · ${parts.length}`));
      const ul = node("ul");
      for (const row of parts) {
        const li = node("li");
        const open = node("button", "ab-link pm-region-row", row.name); open.type = "button";
        open.addEventListener("click", () => explorer()?.enterPart(row.id));
        li.append(open, node("span", "ab-quiet", `${row.present} present`));
        ul.append(li);
      }
      section.append(ul); target.append(section);
    }
    if (!compact && part) {
      const files = node("section", "ab-region-list");
      const shown = part?.files ?? system.catalog ?? system.files ?? [];
      files.append(node("h4", "", `${part ? "Files in this part" : "Files in this system"} · ${shown.length}`));
      const ul = node("ul", "ab-files");
      for (const row of shown.slice(0, 40)) {
        const li = node("li");
        const open = node("button", "ab-link pm-region-row", row.path.split("/").pop()); open.type = "button"; open.title = row.path;
        open.addEventListener("click", () => explorer()?.enterFile(row.path));
        li.append(open, node("span", "ab-quiet", `${row.present === false ? "removed" : "present"}${row.edits ? ` · ${row.edits} changes` : ""}`));
        ul.append(li);
      }
      files.append(ul);
      if (shown.length > 40) files.append(node("p", "ab-quiet", `Showing 40 of ${shown.length} files. Browse or search the map to reach every file.`));
      target.append(files);
    }
  }

  // ---- the Agent brain sheet -------------------------------------------------------

  let brainView = null;
  let mapView = null;
  let sheetMap = null;
  let sheetTab = readLocal("tab", "map");
  let sheetReady = false;
  let replaying = false;

  const EVENT_WORDS = {
    "agent.out": (e) => `A sub-agent went out${e.title ? ` on "${clip(e.title, 50)}"` : ""}${e.model ? ` · ${e.model}` : ""}`,
    "agent.home": (e) => `${e.ok === false ? "A sub-agent came home without a result" : "A sub-agent came home"}${e.title ? ` from "${clip(e.title, 50)}"` : ""}`,
    report: (e) => `Report up the tree: ${clip(e.text, 90)}`,
    "step.start": (e) => `Step started: ${clip(e.title, 60)}`,
    "step.finish": (e) => `Step done: ${clip(e.title, 60)}`,
    "step.grow": (e) => `The pipeline grew: ${clip(e.title, 60)}`,
    "step.fold": (e) => `Folded ${e.count ?? ""} finished step${e.count === 1 ? "" : "s"}`,
    "help.ask": (e) => `Asked the desk: ${clip(e.text, 80)}`,
    "help.answer": (e) => (e.ok === false ? `The desk sent it to you: ${clip(e.text, 80)}` : `The desk answered: ${clip(e.text, 80)}`),
    pipeline: (e) => (e.role === "archivist" ? `Archivist: ${clip(e.text, 80)}` : `Pipeline ${clip(e.text, 80)}`),
    stage: (e) => `"${clip(e.title, 50)}" → ${String(e.stage ?? "").replace(/_/g, " ")}`,
    mail: (e) => `${e.from} → ${e.to}: ${clip(e.text, 70)}`,
    "file.read": (e) => `Read ${e.count ?? e.files?.length ?? 0} file(s)`,
    "file.edit": (e) => `Changed ${e.count ?? e.files?.length ?? 0} file(s)${e.files?.length ? `: ${clip(e.files.slice(0, 3).map((file) => String(file).split(/[\\/]/).pop()).join(", "), 60)}` : ""}`,
  };

  function sheetEls() {
    return {
      overlay: $("agent-brain-overlay"), tabs: [...document.querySelectorAll("#agent-brain-overlay [data-brain-tab]")],
      panes: { live: $("agent-brain-live"), playbook: $("agent-brain-playbook"), map: $("agent-brain-map"), seats: $("agent-brain-seats") },
      seats: $("agent-brain-seats-body"),
      list: $("agent-brain-list"), canvas: $("agent-brain-canvas"), feed: $("agent-brain-feed"), caption: $("agent-brain-caption"),
      replay: $("agent-brain-replay"), shelf: $("agent-brain-shelf"), recipe: $("agent-brain-recipe"),
      mapCanvas: $("agent-brain-map-canvas"), mapDetail: $("agent-brain-map-detail"), mapNote: $("agent-brain-map-note"), mapTools: $("agent-brain-map-tools"),
      rebuild: $("agent-brain-map-rebuild"), name: $("agent-brain-map-name"),
    };
  }

  // A narrow workspace shows a list/map or its details, with an explicit
  // return. Wide layouts retain both panes without an outer scroll container.
  const detailReturns = new Map();
  function showDetails(tab, show = true, source = null) {
    const pane = sheetEls().panes[tab]; if (!pane) return;
    if (show && source) detailReturns.set(tab, source);
    pane.dataset.detail = String(show);
    requestAnimationFrame(() => {
      if (tab === "map") mapView?.resize(); else if (tab === "live") brainView?.resize();
      if (window.matchMedia("(max-width: 900px)").matches) {
        let target = show ? pane.querySelector(".ab-narrow-back") : detailReturns.get(tab);
        if (!show && !target?.isConnected) target = pane.querySelector('[aria-pressed="true"], .ab-narrow-open');
        if (target?.isConnected) target.focus({ preventScroll: true });
      }
      window.MefiScroll?.refresh();
    });
  }
  function initDetailPanes(el) {
    const live = node("div", "ab-live-detail");
    const stage = el.canvas.parentElement;
    stage.before(live);
    live.append(stage, el.panes.live.querySelector(".ab-legend-brain"), $("agent-brain-task-systems"), el.feed);
    for (const [tab, label] of [["map", "Back to map"], ["live", "Back to pipelines"], ["playbook", "Back to recipes"]]) {
      const back = node("button", "ghost mini ab-narrow-back", `← ${label}`); back.type = "button";
      back.addEventListener("click", () => showDetails(tab, false)); el.panes[tab].prepend(back);
    }
    const details = node("button", "ghost mini ab-narrow-open", "Inspect →"); details.type = "button";
    details.addEventListener("click", () => showDetails("map", true, details)); el.mapTools.append(details);
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !isOpen() || !window.matchMedia("(max-width: 900px)").matches || el.panes[sheetTab]?.dataset.detail !== "true") return;
      event.preventDefault(); event.stopImmediatePropagation(); showDetails(sheetTab, false);
    }, true);
  }

  function initSheet() {
    if (sheetReady) return;
    const el = sheetEls();
    if (!el.overlay) return;
    sheetReady = true;
    if (window.MefiAgents) el.overlay.querySelector(".agent-brain-tabs").hidden = true;
    for (const tab of el.tabs) tab.addEventListener("click", () => showTab(tab.dataset.brainTab));
    brainView = makeCanvas(el.canvas, drawPipeline, (width) => Math.max(360, layoutPipeline(data.pipelines[scene.taskId], width, 360).height));
    wirePipelineHover(el);
    initDetailPanes(el);
    brainView.hot = () => fxAlive(performance.now() / 1000) || Object.values(data.pipelines).some((row) => row.steps?.some((step) => step.status === "active"));
    sheetMap = mountMap({ canvas: el.mapCanvas, stage: el.mapCanvas.parentElement, tools: el.mapTools, minHeight: 440,
      onSelect: (system, part, file) => renderRegion(el.mapDetail, system, { part, file }),
      onNavigate: () => { if (el.panes.map.dataset.detail === "true") showDetails("map", false); },
    });
    mapView = sheetMap.view;
    el.replay?.addEventListener("click", () => replayToday());
    el.rebuild?.addEventListener("click", async () => {
      el.mapNote.textContent = "Scanning present files and agent work…";
      const result = await loadMap(true);
      el.mapNote.textContent = result?.ok ? `${data.map?.systems?.length ?? 0} systems` : clip(result?.error ?? "The map could not be rebuilt", 80);
    });
    el.name?.addEventListener("click", async () => {
      el.mapNote.textContent = "Asking the lead to name the systems…";
      const result = await bridge()?.brainMapName?.().catch((error) => ({ ok: false, error: String(error?.message ?? error) }));
      if (result?.ok && result.map) { data.map = result.map; changed("map"); }
      el.mapNote.textContent = result?.ok ? result.note ?? "Named" : clip(result?.error ?? "Naming failed", 90);
      // The names arrive later as a map update, which reloads the map.
    });
  }

  // A step under the pointer: its card (who owns it, which model, when it
  // started and finished, what a sub-agent reported), and a click on a
  // sub-agent's step opens that task.
  function stepAt(x, y) {
    const L = scene.layout;
    if (!L) return null;
    for (const step of L.steps) {
      const m = scene.motion.get(step.id);
      if (m && Math.abs(x - m.x) <= L.pillW / 2 + 4 && Math.abs(y - m.y) <= L.pillH / 2 + 4) return step;
    }
    return null;
  }
  function placePipelineTooltip(stage, tip, event) {
    const box = stage.getBoundingClientRect();
    const pane = stage.closest(".agent-brain-pane")?.getBoundingClientRect() ?? box;
    const left = Math.max(0, pane.left - box.left), right = Math.min(box.width, pane.right - box.left);
    const top = Math.max(0, pane.top - box.top), bottom = Math.min(box.height, pane.bottom - box.top);
    tip.style.left = `${stage.scrollLeft + Math.max(left + 6, Math.min(event.clientX - box.left + 14, right - tip.offsetWidth - 6))}px`;
    tip.style.top = `${stage.scrollTop + Math.max(top + 6, Math.min(event.clientY - box.top + 14, bottom - tip.offsetHeight - 6))}px`;
  }
  function wirePipelineHover(el) {
    const stage = el.canvas.parentElement;
    const tip = node("div", "ab-tip");
    tip.hidden = true;
    tip.setAttribute("role", "tooltip");
    stage.append(tip);
    const legend = node("div", "ab-legend ab-legend-brain");
    legend.append(
      node("span", "ab-key ab-key-out", "going out"), node("span", "ab-key ab-key-live", "coming home"),
      node("span", "ab-key ab-key-help", "asking the desk"), node("span", "ab-key ab-key-book", "Playbook"),
      node("span", "ab-key ab-key-done", "done"), node("span", "ab-key ab-key-fail", "failed"),
    );
    stage.after(legend);
    const systems = node("div", "ab-systems");
    systems.id = "agent-brain-task-systems";
    systems.setAttribute("aria-label", "Systems this task touches");
    legend.after(systems);
    const point = (event) => { const box = el.canvas.getBoundingClientRect(); return [event.clientX - box.left, event.clientY - box.top]; };
    el.canvas.addEventListener("mousemove", (event) => {
      const step = stepAt(...point(event));
      if ((step?.id ?? null) !== scene.hover) { scene.hover = step?.id ?? null; brainView.paint(); }
      el.canvas.style.cursor = step?.child ? "pointer" : "default";
      if (!step) { tip.hidden = true; return; }
      const owner = step.child ? taskById(step.owner) : null;
      tip.textContent = "";
      tip.append(node("strong", "", step.title));
      const words = { queued: "Waiting", active: "Working", done: "Done", failed: "Failed", retry: "Being checked again" }[step.status] ?? step.status;
      tip.append(node("span", "", `${words}${step.grown ? " · added while working" : ""}${step.kind ? ` · ${step.kind}` : ""}`));
      if (owner || step.child) tip.append(node("span", "ab-quiet", `Sub-agent task: ${clip(owner?.title ?? step.owner, 60)}${step.child ? " · click to open" : ""}`));
      if (step.model) tip.append(node("span", "ab-quiet", `Model: ${step.model}`));
      const times = [step.startedAt ? `started ${ago(step.startedAt)}` : "", step.doneAt ? `finished ${ago(step.doneAt)}` : ""].filter(Boolean).join(" · ");
      if (times) tip.append(node("span", "ab-quiet", times));
      if (step.report) tip.append(node("span", "", `Report: ${clip(step.report, 160)}`));
      tip.hidden = false;
      placePipelineTooltip(stage, tip, event);
    });
    stage.addEventListener("scroll", () => { tip.hidden = true; });
    el.canvas.addEventListener("mouseleave", () => { tip.hidden = true; if (scene.hover) { scene.hover = null; brainView.paint(); } });
    el.canvas.addEventListener("click", (event) => {
      const step = stepAt(...point(event));
      if (step?.child && step.owner) window.MefiTasks?.open?.({ taskId: step.owner });
    });
  }

  function showTab(tab) {
    if (tab === "seats" && window.MefiAgents) return window.MefiNav.go("agents", { section: "setup", pane: "team" });
    const el = sheetEls();
    sheetTab = ["live", "playbook", "map", "seats"].includes(tab) ? tab : "map";
    writeLocal("tab", sheetTab);
    const title = { map: "Explore the project", live: "Live work", playbook: "Playbook", seats: "Agent seats" };
    const heading = $("agent-brain-heading");
    if (heading) heading.textContent = title[sheetTab];
    for (const button of el.tabs) button.setAttribute("aria-selected", String(button.dataset.brainTab === sheetTab));
    for (const [key, pane] of Object.entries(el.panes)) if (pane) pane.hidden = key !== sheetTab;
    if (sheetTab === "playbook") loadPlaybook();
    if (sheetTab === "map") { loadMap(false).then(() => mapView?.resize()); loadWorkItems(); }
    if (sheetTab === "live" && !data.map) loadMap(false).then(renderTaskSystems);
    if (sheetTab === "live") brainView?.resize();
    if (sheetTab === "seats") renderSeats();
    window.MefiNav?.note?.("agent-brain", { tab: sheetTab });
  }

  // The seats and the owner's two switches. Every change saves at once and
  // the pane redraws from what the host saved, never from what was typed.
  async function renderSeats(saved = null) {
    const el = sheetEls();
    if (!el.seats) return;
    const view = saved ?? (await bridge()?.brainSettings?.().catch(() => null));
    el.seats.textContent = "";
    if (!view?.ok) { el.seats.append(node("p", "ab-quiet", "Seats are not available in this build.")); return; }
    const save = async (payload) => {
      const result = await bridge()?.brainSettingsSave?.(payload).catch((error) => ({ ok: false, error: String(error?.message ?? error) }));
      if (!result?.ok) { window.MefiToast?.(result?.error ?? "That could not be saved", "warn"); return; }
      renderSeats(result);
    };
    const intro = node("p", "ab-quiet", view.zenKey ? "The lead and the desk answer on these models through OpenCode Zen." : "No OpenCode Zen key is saved, so the lead and the desk use your ordinary heavy route until one is.");
    el.seats.append(intro);
    const table = node("div", "ab-seats");
    for (const [seat, words] of [["lead", "Lead · hands out sub-agents and sums up their reports"], ["desk", "Desk · answers workers who ask for help"]]) {
      const row = node("div", "ab-seat");
      row.append(node("strong", "", words));
      const model = node("input", "ab-rename");
      model.type = "text";
      model.value = view.seats?.[seat]?.model ?? "";
      model.setAttribute("aria-label", `${seat} model`);
      model.addEventListener("change", () => save({ seats: { [seat]: { model: model.value.trim() } } }));
      const effort = node("select");
      effort.setAttribute("aria-label", `${seat} reasoning effort`);
      for (const level of ["minimal", "low", "medium", "high", "xhigh", "max"]) { const option = node("option", "", level); option.value = level; option.selected = level === view.seats?.[seat]?.effort; effort.append(option); }
      effort.addEventListener("change", () => save({ seats: { [seat]: { effort: effort.value } } }));
      const fastBox = node("label", "ab-quiet");
      const fast = node("input");
      fast.type = "checkbox";
      fast.checked = view.seats?.[seat]?.fast === true;
      fast.setAttribute("aria-label", `${seat} fast mode`);
      fast.addEventListener("change", () => save({ seats: { [seat]: { fast: fast.checked } } }));
      fastBox.append(fast, " Fast");
      row.append(model, effort, fastBox);
      table.append(row);
    }
    el.seats.append(table);
    const toggle = (key, title, text) => {
      const box = node("label", "ab-switch");
      const input = node("input");
      input.type = "checkbox";
      input.checked = view.agentBrain?.[key] === true;
      input.addEventListener("change", () => save({ [key]: input.checked }));
      const words = node("span");
      words.append(node("strong", "", title), node("span", "ab-quiet", text));
      box.append(input, words);
      el.seats.append(box);
    };
    toggle("deskTool", "Give workers the ask_desk tool", "OpenCode and Claude Code runs can ask the desk mid-run and wait for the answer. Off: they print MEFI_HELP lines and the answer reaches their next run.");
    toggle("headDrafts", "Let the head draft pipelines for complex tasks", "When no Playbook recipe fits a compound or systemic task, your heavy model drafts its steps once (at most 10 an hour). Off: such tasks start from the template until the Playbook has a recipe.");
    toggle("nestedDelegation", "Let delegated slices split again", "A sub-agent's part may be divided once more, never past three levels. Off: only an original task is divided, as before.");
  }

  function pickTask() {
    const ids = Object.keys(data.pipelines);
    if (scene.taskId && ids.includes(scene.taskId)) return scene.taskId;
    const running = data.running.map((run) => run.taskId).find((id) => ids.includes(id));
    if (running) return running;
    return ids.sort((a, b) => (data.pipelines[b].updatedAt ?? 0) - (data.pipelines[a].updatedAt ?? 0))[0] ?? null;
  }

  function renderList() {
    const el = sheetEls();
    if (!el.list) return;
    el.list.textContent = "";
    const rows = Object.values(data.pipelines).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).slice(0, 30);
    if (!rows.length) {
      el.list.append(node("p", "ab-quiet", "Pipelines appear here once a worker is prepared for a task: start one from Home or the task board."));
      const map = node("button", "ghost mini", "See the project map meanwhile");
      map.type = "button";
      map.addEventListener("click", () => showTab("map"));
      el.list.append(map);
      return;
    }
    for (const pipeline of rows) {
      const task = taskById(pipeline.taskId);
      const button = node("button", "ab-pipe");
      button.type = "button";
      button.setAttribute("aria-pressed", String(pipeline.taskId === scene.taskId));
      const s = pipeline.summary ?? {};
      const bar = node("span", "ab-progress");
      const fill = node("i");
      fill.style.width = `${Math.round(100 * (s.done ?? 0) / Math.max(1, s.total ?? 1))}%`;
      bar.append(fill);
      if (pipeline.done) button.classList.add("ab-pipe-done");
      button.append(node("strong", "", clip(task?.title ?? pipeline.taskId, 48)), node("span", "ab-quiet", `${s.done ?? 0}/${s.total ?? 0} steps${s.active ? ` · ${s.active} working` : ""}${pipeline.done ? " · verified" : ""}${pipeline.recipeName ? ` · ${clip(pipeline.recipeName, 24)}` : ""}`), bar);
      button.addEventListener("click", () => { scene.taskId = pipeline.taskId; scene.motion.clear(); renderList(); renderFeed(); showDetails("live", true, el.list.querySelector('[aria-pressed="true"]')); brainView?.resize(); brainView?.kick(); });
      el.list.append(button);
    }
  }

  // The map's systems this task has changed, as chips that open the map there.
  function renderTaskSystems() {
    const holder = $("agent-brain-task-systems");
    if (!holder) return;
    holder.textContent = "";
    const task = scene.taskId ? taskById(scene.taskId) : null;
    const rows = (data.map?.systems ?? []).filter((row) => (row.taskIds ?? []).includes(scene.taskId));
    if (!rows.length) {
      if (task) holder.append(node("span", "ab-quiet", "Systems appear here once this task's changes are verified."));
      return;
    }
    holder.append(node("span", "ab-quiet", "Systems it touches:"));
    for (const row of rows.slice(0, 8)) {
      const chip = node("button", "chip ab-system-chip", row.name || row.id);
      chip.type = "button";
      chip.title = `Open ${row.name || row.id} on the project map`;
      chip.addEventListener("click", () => { showTab("map"); sheetMap?.choose(row.id); });
      holder.append(chip);
    }
  }

  function renderFeed() {
    renderTaskSystems();
    const el = sheetEls();
    if (!el.feed) return;
    el.feed.textContent = "";
    const rows = data.recent.filter((event) => !scene.taskId || event.taskId === scene.taskId || event.parents?.includes?.(scene.taskId) || event.kind === "mail").slice(-30).reverse();
    for (const event of rows) {
      const words = EVENT_WORDS[event.kind]?.(event);
      if (!words) continue;
      const li = node("li");
      li.append(node("span", `ab-dot ab-dot-${event.kind.replace(/\./g, "-")}`), node("span", "", words), node("time", "ab-quiet", ago(event.at)));
      el.feed.append(li);
    }
    if (!el.feed.children.length) el.feed.append(node("li", "ab-quiet ab-feed-empty", scene.taskId ? "Nothing has happened on this task yet." : "Events appear here as agents work."));
  }

  // Today's recorded events for the watched task, played back at up to a
  // second apart, through the same handler the live events use.
  async function replayToday() {
    if (replaying || !scene.taskId) return;
    const el = sheetEls();
    const day = new Date();
    const stamp = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    const result = await bridge()?.brainEvents?.({ day: stamp, taskId: scene.taskId, limit: 400 }).catch(() => null);
    const rows = result?.events ?? [];
    if (!rows.length) { if (el.caption) el.caption.textContent = "Nothing recorded for this task today."; return; }
    replaying = true;
    if (el.replay) el.replay.disabled = true;
    let last = rows[0].at;
    for (const event of rows) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(1000, Math.max(120, (event.at - last) / 20))));
      last = event.at;
      stageEvent(event);
      if (el.caption) el.caption.textContent = EVENT_WORDS[event.kind]?.(event) ?? "";
    }
    replaying = false;
    if (el.replay) el.replay.disabled = false;
  }

  function renderShelf() {
    const el = sheetEls();
    if (!el.shelf) return;
    el.shelf.textContent = "";
    if (!data.shelf.length) {
      el.shelf.append(node("p", "ab-quiet", "The Playbook fills in as tasks are verified: each one files its pipeline's shape as a recipe."));
      el.recipe.textContent = "";
      return;
    }
    // The last recipe looked at, else the pinned one, else the first.
    let selected = readLocal("recipe", "");
    if (!data.shelf.some((row) => row.id === selected)) selected = (data.shelf.find((row) => row.pinned) ?? data.shelf[0]).id;
    for (const row of data.shelf) {
      const book = node("button", `ab-book ab-tone-${row.tone}${row.retired ? " ab-retired" : ""}`);
      book.type = "button";
      book.style.setProperty("--thick", String(row.thickness ?? 1));
      book.title = `${row.name} · ${row.runs} runs`;
      book.setAttribute("aria-pressed", String(row.id === selected));
      book.append(node("span", "ab-book-title", row.name), node("span", "ab-book-runs", `${row.runs}`));
      if (row.pinned) book.append(node("span", "ab-book-pin", "★"));
      book.addEventListener("click", () => { writeLocal("recipe", row.id); renderShelf(); showDetails("playbook", true, el.shelf.querySelector('[aria-pressed="true"]')); });
      el.shelf.append(book);
    }
    renderRecipe(data.recipes.find((recipe) => recipe.id === selected) ?? null, data.shelf.find((row) => row.id === selected) ?? null);
  }

  // A recipe's shape as a small top-down graph: the pipeline a task of this
  // kind is laid out with. Parents are step indexes, as the Playbook stores them.
  function recipeGraph(steps) {
    const NS = "http://www.w3.org/2000/svg";
    const level = steps.map(() => 0);
    steps.forEach((step, i) => {
      const parents = (Array.isArray(step.parents) ? step.parents : []).filter((p) => Number.isInteger(p) && p >= 0 && p < i);
      level[i] = parents.length ? 1 + Math.max(...parents.map((p) => level[p])) : (i ? level[i - 1] + 1 : 0);
    });
    const rows = [];
    steps.forEach((step, i) => (rows[level[i]] ??= []).push(i));
    const W = 320, boxW = 92, boxH = 22, gapY = 14;
    const at = [];
    rows.forEach((row, r) => (row ?? []).forEach((i, k) => { at[i] = { x: W / 2 + (k - ((row.length - 1) / 2)) * (boxW + 8), y: 10 + r * (boxH + gapY) }; }));
    const H = 10 + rows.length * (boxH + gapY);
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("class", "ab-recipe-graph");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `Recipe shape: ${steps.map((step) => step.title).join(", then ")}`);
    const el = (tag, attrs) => { const item = document.createElementNS(NS, tag); for (const [key, value] of Object.entries(attrs)) item.setAttribute(key, String(value)); return item; };
    steps.forEach((step, i) => {
      const parents = (Array.isArray(step.parents) ? step.parents : []).filter((p) => at[p]);
      for (const p of parents.length ? parents : i ? [i - 1] : []) {
        const a = at[p], b = at[i];
        if (!a || !b) continue;
        const y0 = a.y + boxH, y1 = b.y, mid = (y0 + y1) / 2;
        svg.append(el("path", { d: `M${a.x} ${y0} C${a.x} ${mid} ${b.x} ${mid} ${b.x} ${y1}`, class: "ab-rg-wire" }));
      }
    });
    steps.forEach((step, i) => {
      const { x, y } = at[i];
      svg.append(el("rect", { x: x - boxW / 2, y, width: boxW, height: boxH, rx: 6, class: `ab-rg-step ab-rg-${step.kind ?? "build"}` }));
      const text = el("text", { x, y: y + boxH / 2 + 4, "text-anchor": "middle", class: "ab-rg-label" });
      text.textContent = clip(step.title, 14);
      svg.append(text);
    });
    return svg;
  }

  function renderRecipe(recipe, row) {
    const el = sheetEls();
    el.recipe.textContent = "";
    if (!recipe) { el.recipe.append(node("p", "ab-quiet", "Choose a recipe to see its steps and how it has done.")); return; }
    const head = node("div", "ab-region-head");
    head.append(node("h3", "", recipe.name));
    const rate = row?.verifiedRate != null ? `${Math.round(row.verifiedRate * 100)}% verified` : "not enough runs yet";
    head.append(node("p", "ab-quiet", `${recipe.runs} runs · ${rate}${recipe.medianMs ? ` · about ${Math.max(1, Math.round(recipe.medianMs / 60000))} min` : ""} · ${recipe.shape?.intent ?? "any"}${recipe.shape?.complexity ? ` / ${recipe.shape.complexity}` : ""}`));
    el.recipe.append(head);
    el.recipe.append(recipeGraph(recipe.steps ?? []));
    const steps = node("ol", "ab-steps");
    for (const step of recipe.steps ?? []) steps.append(node("li", "", `${step.title}`));
    el.recipe.append(steps);
    const actions = node("div", "ab-actions");
    const act = async (action, extra = {}) => {
      const result = await bridge()?.brainPlaybookAction?.({ action, id: recipe.id, ...extra }).catch((error) => ({ ok: false, error: String(error?.message ?? error) }));
      if (!result?.ok) { window.MefiToast?.(result?.error ?? "That did not work", "warn"); return; }
      data.shelf = result.shelf ?? data.shelf; data.recipes = result.recipes ?? data.recipes;
      if (action === "delete") writeLocal("recipe", "");
      renderShelf();
    };
    const button = (text, run, className = "ghost mini") => { const b = node("button", className, text); b.type = "button"; b.addEventListener("click", run); actions.append(b); };
    button(recipe.pinned ? "Unpin" : "Pin as the default", () => act(recipe.pinned ? "unpin" : "pin"));
    button(recipe.retired ? "Restore" : "Retire", () => act(recipe.retired ? "restore" : "retire"));
    const rename = node("input", "ab-rename");
    rename.type = "text"; rename.value = recipe.name; rename.maxLength = 60; rename.setAttribute("aria-label", "Recipe name");
    rename.addEventListener("change", () => act("rename", { name: rename.value.trim() }));
    actions.append(rename);
    const remove = node("button", "ghost mini", "Delete");
    remove.type = "button";
    let armed = false;
    remove.addEventListener("click", () => {
      if (!armed) { armed = true; remove.textContent = "Delete: click again"; setTimeout(() => { armed = false; remove.textContent = "Delete"; }, 3000); return; }
      act("delete");
    });
    actions.append(remove);
    el.recipe.append(actions);
  }

  async function open(params = {}) {
    initSheet();
    const el = sheetEls();
    if (!el.overlay) return;
    window.MefiNav?.claim?.("agent-brain");
    el.overlay.hidden = false;
    if (typeof params.taskId === "string") { scene.taskId = params.taskId; scene.motion.clear(); }
    await loadBrain();
    scene.taskId = pickTask();
    showTab(typeof params.tab === "string" ? params.tab : sheetTab);
    renderList();
    renderFeed();
    if (typeof params.taskId === "string" && sheetTab === "live") showDetails("live", true, el.list.querySelector('[aria-pressed="true"]'));
    brainView?.resize();
    brainView?.kick();
  }
  function close() {
    const el = sheetEls();
    if (!el.overlay || el.overlay.hidden) return;
    el.overlay.hidden = true;
    window.MefiNav?.release?.("agent-brain");
  }
  const isOpen = () => $("agent-brain-overlay")?.hidden === false;

  onData((what) => {
    if (!isOpen()) return;
    if (what === "brain") { scene.taskId = pickTask(); renderList(); renderFeed(); brainView?.resize(); brainView?.kick(); }
    if (what === "playbook") renderShelf();
    if (what === "map" || what === "work") {
      sheetMap?.sync();
      const note = sheetEls().mapNote;
      if (note && data.map?.sources && !note.dataset.busy) note.textContent = sourceLine(data.map);
    }
  });

  window.MefiAgentBrain = { open, close, isOpen, showTab, stageEvent, tab: () => sheetTab, mapState: () => sheetMap?.inspect() };

  // ---- the hub on Home ------------------------------------------------------------

  const hub = { root: null, canvas: null, view: null, layout: null, selected: readLocal("region", ""), region: null, note: null, collapsed: readLocal("hub", "open") === "closed" };

  function initHub() {
    const root = $("ws-hub");
    if (!root || hub.root) return;
    // Project maps live in Agents → Workflows. Keep Home's conversation at
    // full height instead of mounting a second map above it on small screens.
    if (window.MefiAgents) { root.remove(); return; }
    hub.root = root;
    const head = node("div", "ws-hub-head");
    const titles = node("div");
    titles.append(node("p", "ws-kicker", "PROJECT MAP"), node("h2", "", "Your project, by system"));
    const tools = node("div", "ws-hub-tools");
    const toggle = node("button", "ghost mini", hub.collapsed ? "Show map" : "Hide map");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", String(!hub.collapsed));
    toggle.addEventListener("click", () => {
      hub.collapsed = !hub.collapsed;
      writeLocal("hub", hub.collapsed ? "closed" : "open");
      toggle.textContent = hub.collapsed ? "Show map" : "Hide map";
      toggle.setAttribute("aria-expanded", String(!hub.collapsed));
      applyHub();
    });
    const brain = node("button", "ghost mini", "Agent brain");
    brain.type = "button";
    brain.title = "Open the Agent brain: live pipelines, the Playbook and this map";
    brain.addEventListener("click", () => window.MefiNav?.go?.("agent-brain", { tab: "map" }));
    tools.append(brain, toggle);
    head.append(titles, tools);
    const body = node("div", "ws-hub-body");
    const stage = node("div", "ws-hub-stage");
    const hubTools = node("div", "ab-map-tools");
    hub.canvas = node("canvas", "ws-hub-canvas");
    hub.canvas.setAttribute("role", "img");
    hub.canvas.setAttribute("aria-label", "Project map: the systems agents have worked in, top down, with their tasks");
    stage.append(hub.canvas);
    hub.region = node("div", "ws-hub-region");
    hub.region.setAttribute("aria-live", "polite");
    body.append(stage, hub.region);
    hub.note = node("p", "ab-quiet ws-hub-note");
    root.append(head, hubTools, body, hub.note);
    hub.map = mountMap({ canvas: hub.canvas, stage, tools: hubTools, minHeight: 260, onSelect: (system) => {
      hub.selected = system?.id ?? "";
      writeLocal("region", hub.selected);
      renderRegion(hub.region, system, { compact: true });
    } });
    hub.view = hub.map.view;
    onData((what) => {
      if (!hub.root || hub.root.hidden) return;
      if (what === "map" || what === "work" || what === "brain") {
        // The busiest system is open until the owner picks another.
        if (!hub.selected || !data.map?.systems?.some((row) => row.id === hub.selected)) hub.selected = openingSystem(data.map) ?? "";
        hub.map.selected = hub.selected || null;
        hub.map.sync();
        renderRegion(hub.region, data.map?.systems?.find((row) => row.id === hub.selected) ?? null, { compact: true });
        const count = data.map?.systems?.length ?? 0;
        hub.note.textContent = count ? sourceLine(data.map) : "";
      }
    });
    const layer = $("workspace-layer");
    if (layer) {
      try { new MutationObserver(() => { if (!layer.hidden) refreshHub(); }).observe(layer, { attributes: true, attributeFilter: ["hidden"] }); } catch {}
    }
    applyHub();
    refreshHub();
  }

  function applyHub() {
    if (!hub.root) return;
    hub.root.hidden = false;
    hub.root.classList.toggle("collapsed", hub.collapsed);
    hub.root.closest(".ws-columns")?.classList.toggle("has-hub", !hub.collapsed);
    if (!hub.collapsed) hub.view?.resize();
  }

  let hubLoadedAt = 0;
  async function refreshHub() {
    if (!hub.root || Date.now() - hubLoadedAt < 5000) return;
    hubLoadedAt = Date.now();
    await Promise.all([loadMap(false), loadWorkItems(), loadBrain()]);
  }

  window.MefiHub = { refresh: () => { hubLoadedAt = 0; return refreshHub(); }, workOnRegion };

  // ---- the companion ------------------------------------------------------------------

  const LOOKS = ["wisp", "fox", "owl", "cat", "person"];
  const LOOK_NAMES = { wisp: "A wisp of light", fox: "A fox", owl: "An owl", cat: "A cat", person: "A person" };
  const companion = { orb: null, panel: null, badge: null, bubble: null, state: null, digest: null, open: false, seenTimer: null, refreshTimer: null, awayAt: 0 };

  // A small face for each look, drawn with shapes so it takes the theme.
  function lookSvg(look) {
    if (look === "wisp" && window.MefiCompanionHub?.face) return window.MefiCompanionHub.face();
    const eyes = '<circle cx="13" cy="15" r="1.6" class="c-eye"/><circle cx="19" cy="15" r="1.6" class="c-eye"/>';
    const shapes = {
      wisp: `<circle cx="16" cy="16" r="10" class="c-body"/><path d="M16 5c3 3 3 5 0 7" class="c-flame"/>${eyes}`,
      fox: `<path d="M6 8l5 5h10l5-5-2 12-8 6-8-6z" class="c-body"/>${eyes}<circle cx="16" cy="20" r="1.2" class="c-eye"/>`,
      owl: `<ellipse cx="16" cy="17" rx="9" ry="10" class="c-body"/><circle cx="12.5" cy="15" r="3.2" class="c-ring"/><circle cx="19.5" cy="15" r="3.2" class="c-ring"/>${eyes}<path d="M15 19l1 1.6 1-1.6z" class="c-eye"/>`,
      cat: `<path d="M7 9l3 4h12l3-4v12a9 7 0 0 1-18 0z" class="c-body"/>${eyes}<path d="M14.5 19h3" class="c-line"/>`,
      person: `<circle cx="16" cy="12" r="5.5" class="c-body"/><path d="M6 27a10 8 0 0 1 20 0z" class="c-body"/><circle cx="14" cy="12" r="1.2" class="c-eye"/><circle cx="18" cy="12" r="1.2" class="c-eye"/>`,
    };
    return `<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">${shapes[look] ?? shapes.wisp}</svg>`;
  }

  function initCompanion() {
    if (companion.orb) return;
    const orb = node("button", "companion-orb");
    orb.type = "button";
    orb.id = "companion-orb";
    orb.setAttribute("aria-haspopup", "dialog");
    orb.setAttribute("aria-expanded", "false");
    orb.title = `${companionName()}: what needs you and what happened`;
    const face = node("span", "companion-face");
    const badge = node("span", "companion-badge");
    badge.hidden = true;
    // Resting reads as resting: a slow "z" drifts up while nothing runs.
    const zz = node("span", "companion-zz", "z");
    zz.setAttribute("aria-hidden", "true");
    orb.append(face, badge, zz);
    const panel = node("section", "companion-panel");
    panel.id = "companion-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Your companion");
    panel.hidden = true;
    const bubble = node("button", "companion-bubble");
    bubble.type = "button";
    bubble.hidden = true;
    bubble.addEventListener("click", () => toggleCompanion(true));
    companion.orb = orb; companion.panel = panel; companion.badge = badge; companion.bubble = bubble;
    orb.addEventListener("click", () => { if (window.MefiCompanionHub) window.MefiCompanionHub.open(); else toggleCompanion(); });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && companion.open) { toggleCompanion(false); orb.focus(); } });
    document.addEventListener("pointerdown", (event) => { if (companion.open && !panel.contains(event.target) && !orb.contains(event.target) && !window.MefiSelect?.contains(event.target) && !window.MefiCompanionHub?.contains(event.target)) toggleCompanion(false); });
    placeOrb();
    document.body.append(panel, bubble);
    window.MefiCompanionUI?.attach({ orb, panel, bubble, toggle: toggleCompanion, preferences: savePrefs });
    window.MefiCompanionHub?.attach({ orb, panel, toggle: toggleCompanion, refresh: () => refreshCompanion(true) });
    // The rail rebuilds its foot; a child without the foot-item class is kept,
    // but the orb is put back if it was ever dropped.
    setInterval(placeOrb, 4000);
    paintCompanion();
    trackPresence();
    refreshCompanion();
  }

  function placeOrb() {
    if (window.MefiCompanionUI?.managed()) return;
    const foot = $("app-rail-foot");
    if (foot && companion.orb.parentElement !== foot) { foot.prepend(companion.orb); companion.orb.classList.remove("floating"); }
    else if (!foot && !companion.orb.isConnected) { document.body.append(companion.orb); companion.orb.classList.add("floating"); }
  }

  // Beside the orb, clear of the menu when the orb sits in it.
  function besideOrb(element) {
    if (element === companion.panel && window.MefiCompanionUI?.managed()) { window.MefiCompanionUI.position(); return; }
    const box = companion.orb.getBoundingClientRect();
    const rail = companion.orb.closest("#app-rail")?.getBoundingClientRect?.();
    element.style.left = `${Math.round(Math.max(box.right, rail?.right ?? 0) + 10)}px`;
    element.style.bottom = `${Math.max(12, Math.round(window.innerHeight - box.bottom))}px`;
  }

  function toggleCompanion(open = !companion.open, options = {}) {
    companion.open = open;
    companion.panel.hidden = !open;
    companion.orb.setAttribute("aria-expanded", String(open));
    window.MefiCompanionUI?.opened(open, options);
    if (open) {
      companion.bubble.hidden = true;
      besideOrb(companion.panel);
      refreshCompanion(true);
      if (!options.hover) companion.panel.querySelector("#companion-pane-ask textarea, button, select, input")?.focus?.();
    }
  }

  let companionRead = 0;
  async function refreshCompanion(force = false) {
    const api = bridge();
    if (!api?.companionState) return;
    if (!force && document.visibilityState === "hidden") return;
    const request = ++companionRead;
    const state = await api.companionState().catch(() => null);
    if (!state?.ok || request !== companionRead) return;
    companion.state = state;
    paintCompanion();
  }

  function paintCompanion() {
    const state = companion.state;
    const orb = companion.orb;
    if (!orb) return;
    const look = state?.look ?? "wisp";
    const face = orb.querySelector(".companion-face");
    // State refreshes should not restart the wisp's orbit or erase a reaction.
    if (orb.dataset.look !== look || !face.firstElementChild) face.innerHTML = lookSvg(look);
    orb.dataset.state = state?.state ?? "resting";
    orb.dataset.look = look;
    orb.dataset.style = nodeStyle();
    const count = state?.queue?.counts?.total ?? 0;
    companion.badge.hidden = count === 0;
    companion.badge.textContent = count > 9 ? "9+" : String(count);
    orb.setAttribute("aria-label", `${companionName()}: ${count ? `${count} need${count === 1 ? "s" : ""} you` : stateWords(state)}`);
    if (companion.open || window.MefiCompanionUI?.managed()) renderPanel();
  }

  function stateWords(state) {
    if (!state) return "connecting";
    if (state.state === "greeting") return "welcome back";
    if (state.state === "needs-you") return `${state.queue?.counts?.total ?? 0} need you`;
    if (state.state === "working") return "working";
    return "resting · nothing is running";
  }

  function renderPanel() {
    const panel = companion.panel;
    const state = companion.state;
    if (window.MefiCompanionUI?.managed()) {
      window.MefiCompanionUI.render({ state, name: companionName(), status: stateWords(state), digest: companion.digest, queueItem, dismissDigest: () => { companion.digest = null; renderPanel(); } });
      return;
    }
    panel.textContent = "";
    const head = node("header", "companion-head");
    const avatar = node("span", "companion-avatar");
    avatar.innerHTML = lookSvg(state?.look ?? "wisp");
    const titles = node("div");
    titles.append(node("strong", "", companionName()), node("span", "ab-quiet", stateWords(state)));
    const close = node("button", "ghost mini", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", () => toggleCompanion(false));
    head.append(avatar, titles, close);
    panel.append(head);
    if (companion.digest) {
      const card = node("section", "companion-digest");
      card.append(node("strong", "", companion.digest.headline ?? "Welcome back"));
      const ul = node("ul");
      for (const line of companion.digest.lines ?? []) ul.append(node("li", "", line));
      card.append(ul);
      const done = node("button", "ghost mini", "Thanks");
      done.type = "button";
      done.addEventListener("click", () => { companion.digest = null; renderPanel(); });
      card.append(done);
      panel.append(card);
    }
    const queue = node("section", "companion-queue");
    const items = state?.queue?.items ?? [];
    queue.append(node("h3", "", items.length ? `Needs you · ${items.length}` : "Nothing needs you"));
    if (!items.length) queue.append(node("p", "ab-quiet", state?.state === "working" ? "Agents are working. I'll call you if something comes up." : "All quiet. I'm resting until the next task."));
    for (const item of items.slice(0, 12)) queue.append(queueItem(item));
    panel.append(queue);
    const prefs = state?.preferences ?? [];
    if (prefs.length) {
      const section = node("section", "companion-prefs");
      section.append(node("h3", "", "What I've noticed"));
      const ul = node("ul");
      for (const line of prefs) ul.append(node("li", "", line));
      section.append(ul, node("p", "ab-quiet", "Suggestions only: I never answer for you."));
      panel.append(section);
    }
    const settings = node("details", "companion-settings");
    settings.append(node("summary", "", "Look and reach"));
    const lookPick = node("select");
    lookPick.setAttribute("aria-label", "How the companion looks");
    for (const look of LOOKS) { const option = node("option", "", LOOK_NAMES[look]); option.value = look; option.selected = look === (state?.look ?? "wisp"); lookPick.append(option); }
    lookPick.addEventListener("change", () => savePrefs({ look: lookPick.value }));
    const scopePick = node("select");
    scopePick.setAttribute("aria-label", "Which projects the companion covers");
    for (const [value, text] of [["project", "This project"], ["all", "All projects"]]) { const option = node("option", "", text); option.value = value; option.selected = value === (state?.scope ?? "project"); scopePick.append(option); }
    scopePick.addEventListener("change", () => savePrefs({ scope: scopePick.value }));
    const row = (text, control) => { const labelEl = node("label", "companion-row"); labelEl.append(node("span", "", text), control); return labelEl; };
    settings.append(row("Look", lookPick), row("Covers", scopePick), node("p", "ab-quiet", "The name comes from Settings › General."));
    panel.append(settings);
  }

  async function savePrefs(prefs) {
    const result = await bridge()?.companionPrefs?.(prefs).catch(() => null);
    if (!result?.ok) return result || { ok: false, error: "That could not be saved" };
    await refreshCompanion(true);
    return result;
  }

  function queueItem(item) {
    const row = node("article", `companion-item companion-${item.kind}`);
    const kinds = { question: item.issueKind === "owner" ? "Only you can do this" : "Question", approval: "Approve build", held: "Held for you", parked: "Parked", review: "Waiting on review" };
    row.append(node("span", "companion-kind", kinds[item.kind] ?? item.kind), node("strong", "", clip(item.title, 140)));
    if (item.project) row.append(node("span", "ab-quiet", item.project));
    const actions = node("div", "ab-actions");
    // Another project's ask is answered in that project: one button takes the
    // owner there (saving any running work first, as the project panel does).
    if (item.projectId) {
      const go = node("button", "ghost mini", `Open ${clip(item.project ?? "that project", 28)}`);
      go.type = "button";
      go.addEventListener("click", async () => {
        const result = await bridge()?.projectsSelect?.(item.projectId, { saveProgress: true }).catch(() => null);
        if (result && result.ok === false) window.MefiToast?.(result.error ?? "Could not switch projects", "warn");
        refreshCompanion(true);
      });
      actions.append(go);
      row.append(actions);
      return row;
    }
    for (const action of (item.actions ?? []).slice(0, 4)) {
      if (action.text) {
        const input = node("input", "ab-rename");
        input.type = "text";
        input.placeholder = action.label;
        input.setAttribute("aria-label", action.label);
        input.addEventListener("keydown", (event) => { if (event.key === "Enter" && input.value.trim()) act(item, action, input.value.trim()); });
        actions.append(input);
        continue;
      }
      const button = node("button", action.recommended ? "primary mini" : "ghost mini", action.label);
      button.type = "button";
      button.addEventListener("click", () => act(item, action));
      actions.append(button);
    }
    row.append(actions);
    return row;
  }

  // Every action goes through the same bridge the rest of the app uses; an
  // approval opens the task so its brief is read before the build is approved.
  async function act(item, action, text = null) {
    const api = bridge();
    let result = null;
    try {
      if (item.kind === "question") result = await api?.assistantAnswer?.({ id: item.id, optionId: action.id, ...(text ? { text } : {}) });
      else if (action.id === "retry") result = await api?.tasksAction?.({ taskId: item.taskId, action: "retry" });
      else { toggleCompanion(false); window.MefiTasks?.open?.({ taskId: item.taskId }); return; }
    } catch (error) {
      result = { ok: false, error: String(error?.message ?? error) };
    }
    // A question whose card has left the board is cleared by the host: a
    // notice, not a failure (refreshCompanion below drops it from the queue).
    if (result && result.ok === false) window.MefiToast?.(result.error ?? "That did not work", result.gone ? "info" : "warn");
    refreshCompanion(true);
  }

  // Presence: while the window is in front the owner is here; when it hides
  // or blurs they have stepped away, and coming back after ten minutes or
  // more brings a greeting with what happened meanwhile.
  function trackPresence() {
    const api = bridge();
    const here = () => document.visibilityState === "visible" && document.hasFocus();
    const away = () => { companion.awayAt = Date.now(); api?.companionSeen?.("hide").catch(() => {}); };
    const back = async (reason = "focus") => {
      const result = await api?.companionWelcome?.().catch(() => null);
      if (result?.digest) {
        companion.digest = result.digest;
        showBubble(result.digest.headline);
        refreshCompanion(true);
      }
      api?.companionSeen?.(reason === "focus" ? "active" : reason).catch(() => {});
    };
    window.addEventListener("blur", away);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") away(); else back(); });
    window.addEventListener("focus", () => back());
    api?.onCompanionWelcome?.(() => back("resume"));
    companion.seenTimer = setInterval(() => { if (here()) api?.companionSeen?.("active").catch(() => {}); }, 60000);
    back("start");
  }

  function showBubble(text) {
    if (!text || !companion.bubble || companion.state?.bubbles === false) return;
    companion.bubble.textContent = text;
    besideOrb(companion.bubble);
    companion.bubble.hidden = false;
    setTimeout(() => { if (companion.bubble) companion.bubble.hidden = true; }, 12000);
  }

  window.MefiCompanion = { open: () => toggleCompanion(true), close: () => toggleCompanion(false), refresh: () => refreshCompanion(true), state: () => companion.state };

  // ---- live wiring --------------------------------------------------------------------

  // One timer per refresh: a companion refresh must never cancel a pending
  // pipeline reload, or the live view goes stale.
  const timers = new Map();
  const soon = (fn, ms = 800) => { clearTimeout(timers.get(fn)); timers.set(fn, setTimeout(() => { timers.delete(fn); fn(); }, ms)); };
  // Pipelines and tasks are read for the sheet and Home's project map. With
  // neither on screen a task push does not re-read them: open() loads first.
  const wanted = () => isOpen() || $("ws-hub")?.hidden === false;
  const reloadBrain = () => { if (wanted()) loadBrain(); };
  const reloadCompanion = () => refreshCompanion();
  const reloadAll = () => { reloadBrain(); refreshCompanion(); };
  function wire() {
    const api = bridge();
    if (!api) return;
    api.onBrainEvent?.((event) => {
      data.recent.push(event);
      if (data.recent.length > 400) data.recent.splice(0, data.recent.length - 400);
      stageEvent(event);
      if (isOpen()) { const el = sheetEls(); if (el.caption) el.caption.textContent = EVENT_WORDS[event.kind]?.(event) ?? ""; }
      soon(reloadBrain, 600);
    });
    api.onBrainUpdate?.((payload) => {
      if (payload?.what === "map") loadMap(false);
      else if (payload?.what === "playbook") loadPlaybook();
      else soon(reloadBrain, 400);
      soon(reloadCompanion, 900);
    });
    api.onTasks?.(() => soon(reloadAll, 900));
    api.onAssistant?.(() => soon(reloadCompanion, 900));
    api.onProjects?.((result) => {
      if (!result?.activeId || result.activeId === data.mapProject) return;
      ++mapRequest; data.mapProject = result.activeId; data.map = null;
      data.places = { ideas: {}, plans: {} }; changed("map");
      if (isOpen() && sheetTab === "map") { loadMap(false); loadWorkItems(); }
    });
  }

  function init() {
    initSheet();
    initHub();
    initCompanion();
    wire();
    window.addEventListener("mefi-tree-preferences", () => { brainView?.paint(); paintCompanion(); });
    window.addEventListener("mefi-theme-change", () => {
      if (isOpen()) {
        if (sheetTab === "live") brainView?.paint();
        if (sheetTab === "map") sheetMap?.view?.paint();
      }
      if (!$("workspace-layer")?.hidden) hub.view?.paint();
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
