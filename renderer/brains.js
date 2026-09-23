// Mefi's Studio AI+ — Brain maps: the pipeline editor.
//
// A node graph over the same data scripts/brains.cjs validates and compiles.
// Drag from an output end to an input end (or click one, then the other) and
// the two are wired; Space opens the parts search wherever the canvas is
// looking; the inspector on the right says, for whatever is selected, exactly
// what it may and may not do, which model it uses, and which switch it moves
// when the map goes live.
//
// The canvas is a viewport over a stage: scroll pans, Ctrl + scroll zooms
// around the pointer, F fits the whole map. Every coordinate a map stores is a
// stage coordinate, so zooming never changes what is saved.
//
// Nothing here decides anything by itself: every save, activation and draft
// goes through the host, which validates the map again before it counts.
(function () {
  "use strict";

  // Geometry is computed, not measured: ports sit on a fixed grid so a wire
  // can be drawn before the browser has laid the node out, and a node that is
  // dragged does not cost a reflow per frame.
  const NODE_W = 236;
  const HEAD_H = 48;
  const PORT_H = 36;
  const FOOT_H = 26;
  const GRID = 20;
  // Where the dot sits inside a port row, and the node border above the
  // first row: a wire has to land on the dot, not on the box edge.
  const PORT_INSET = 11;
  const BORDER = 1;
  // Low enough that Fit shows the whole shipped pipeline on a 1280px window
  // with both side panels open.
  const ZOOM_MIN = 0.1;
  const ZOOM_MAX = 2;
  const ZOOM_STEP = 1.2;
  // Below this zoom port labels are too small to read, so a node draws its
  // title large instead and the map reads as an overview rather than as noise.
  const FAR_ZOOM = 0.6;
  // A press that moves less than this is a click, not a drag.
  const DRAG_SLOP = 4;
  const HISTORY_LIMIT = 120;
  const VIEW_KEY = "mefi.brains.view";
  const LAYOUT_KEY = "mefi.brains.layout";
  const PART_MIME = "application/x-mefi-brain-part";
  const HINT = "Drag from an output end to an input end — or click one, then the other — to wire two parts.";
  const SVG_NS = "http://www.w3.org/2000/svg";

  const state = {
    catalog: null,
    maps: [],
    activeId: null,
    map: null,
    compiled: null,
    problems: [],
    selection: null,
    pending: null,
    dirty: false,
    busy: false,
    partsQuery: "",
    search: { open: false, query: "", index: 0, at: null, fromDrop: false },
    drag: null,
    gesture: null,
    view: { x: 0, y: 0, zoom: 1 },
    draft: null,
    layout: { parts: true, inspector: true, collapsed: [] },
    sections: new Map(),
    picked: new Set(),
    problemCursor: -1,
    problemsExpanded: false,
    projectId: null,
  };
  const history = { past: [], future: [], tag: null };
  const el = {};
  const nodeBoxes = new Map();
  const portButtons = new Map();
  const wirePaths = new Map();
  const partUse = new Map();
  const searchRows = [];
  const views = new Map();
  let savedSnapshot = null;
  let suppressClick = false;
  let initialized = false;
  let dialogState = null;

  const bridge = () => (typeof window === "undefined" ? null : window.mefiStudio ?? null);
  const typeOf = (type) => state.catalog?.nodes.find((item) => item.type === type) ?? null;
  const nodeById = (id) => state.map?.nodes.find((node) => node.id === id) ?? null;
  const groupLabel = (id) => state.catalog?.groups.find((group) => group.id === id)?.label ?? id;
  const permission = (key) => state.catalog?.permissions.find((item) => item.key === key) ?? { key, label: key, detail: "" };
  const kindLabel = (kind) => state.catalog?.portKinds?.find((item) => item.kind === kind)?.label ?? kind;
  const clean = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  // The host keeps coordinates inside ±4000; the stage has no edge of its own.
  const LIMIT = 4000;
  const snap = (value) => Math.max(-LIMIT, Math.min(LIMIT, Math.round(value / GRID) * GRID));
  const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
  const RUNS = {
    host: { label: "Live stage", short: "Studio", detail: "The studio already runs this stage; this node holds its settings." },
    map: { label: "Run by the map", short: "Map rules", detail: "This node's rules are what the studio follows — editing it changes behaviour as soon as the map is saved." },
    draft: { label: "Drawing only", short: "Note", detail: "Saved and drawn, but nothing executes it." },
  };

  function frame(fn) {
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") return window.requestAnimationFrame(fn);
    return setTimeout(fn, 16);
  }

  // Every store access is guarded: a blocked or private store throws on read,
  // and a view that is not remembered is a small loss, never an error.
  function readJson(key) {
    try {
      const raw = window.localStorage?.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
  function writeJson(key, value) {
    try {
      window.localStorage?.setItem(key, JSON.stringify(value));
    } catch {
      /* storage blocked — the preference simply does not persist */
    }
  }

  function svg(tag) {
    return document.createElementNS(SVG_NS, tag);
  }

  function glyph(id, className = "glyph") {
    const icon = svg("svg");
    icon.setAttribute("class", className);
    icon.setAttribute("aria-hidden", "true");
    icon.setAttribute("focusable", "false");
    const use = svg("use");
    use.setAttribute("href", `#${id}`);
    icon.append(use);
    return icon;
  }

  function specHeight(spec) {
    const rows = Math.max(spec?.inputs.length ?? 0, spec?.outputs.length ?? 0, 1);
    return HEAD_H + rows * PORT_H + FOOT_H;
  }

  // A toggle, drawn here rather than borrowed from the sprite: the sprite's
  // sliders icon already stands for some parts' kind.
  function switchIcon() {
    const icon = svg("svg");
    icon.setAttribute("class", "glyph");
    icon.setAttribute("viewBox", "0 0 16 16");
    icon.setAttribute("aria-hidden", "true");
    icon.setAttribute("focusable", "false");
    const track = svg("rect");
    for (const [key, value] of Object.entries({ x: "1.5", y: "4.5", width: "13", height: "7", rx: "3.5" })) track.setAttribute(key, value);
    const knob = svg("circle");
    for (const [key, value] of Object.entries({ cx: "10.5", cy: "8", r: "2", fill: "currentColor" })) knob.setAttribute(key, value);
    icon.append(track, knob);
    return icon;
  }

  function nodeHeight(node) {
    return specHeight(typeOf(node.type));
  }

  function portPoint(nodeId, portId, dir) {
    const node = nodeById(nodeId);
    const spec = typeOf(node?.type);
    if (!node || !spec) return null;
    const list = dir === "in" ? spec.inputs : spec.outputs;
    const index = list.findIndex((item) => item.id === portId);
    if (index < 0) return null;
    return { x: node.x + (dir === "in" ? PORT_INSET : NODE_W - PORT_INSET), y: node.y + BORDER + HEAD_H + index * PORT_H + PORT_H / 2 };
  }

  function wireD(from, to, { loop = true } = {}) {
    const dx = to.x - from.x;
    if (dx >= 0 || !loop || !state.map) {
      const reach = dx >= 0 ? Math.max(60, dx * 0.45) : Math.min(260, Math.max(90, Math.abs(to.y - from.y) * 0.5 + 60));
      return `M ${from.x} ${from.y} C ${from.x + reach} ${from.y}, ${to.x - reach} ${to.y}, ${to.x} ${to.y}`;
    }
    // A wire that runs backwards (a feedback loop) leaves to the right, dips
    // under every part between its two ends and comes back in from the left,
    // instead of slashing across the map. Both handles sit at one depth, and
    // a cubic's midpoint is (y0 + 6c + y3) / 8, so c puts the lowest point of
    // the curve 60px under the lowest part it passes.
    let floor = Math.max(from.y, to.y);
    for (const node of state.map.nodes) {
      if (node.x < from.x && node.x + NODE_W > to.x) floor = Math.max(floor, node.y + nodeHeight(node));
    }
    const depth = Math.round((8 * (floor + 60) - from.y - to.y) / 6);
    const reach = Math.min(200, Math.max(120, Math.abs(dx) * 0.08));
    return `M ${from.x} ${from.y} C ${from.x + reach} ${depth}, ${to.x - reach} ${depth}, ${to.x} ${to.y}`;
  }

  // ---- history -----------------------------------------------------------------
  // Every edit takes a snapshot of the map first, so Ctrl Z walks back through
  // wiring, deleting, moving and settings alike. A run of the same edit (typing
  // a title, nudging one part) is one step, not one per key.

  function checkpoint(tag = null) {
    if (!state.map) return;
    if (tag && history.tag === tag) return;
    history.past.push(JSON.stringify(state.map));
    if (history.past.length > HISTORY_LIMIT) history.past.shift();
    history.future = [];
    history.tag = tag;
  }

  function resetHistory() {
    history.past = [];
    history.future = [];
    history.tag = null;
  }

  function refreshDirty() {
    state.dirty = Boolean(state.map) && (savedSnapshot === null || JSON.stringify(state.map) !== savedSnapshot);
  }

  function stepHistory(direction) {
    const from = direction === "undo" ? history.past : history.future;
    const to = direction === "undo" ? history.future : history.past;
    if (!state.map || !from.length) return;
    to.push(JSON.stringify(state.map));
    state.map = JSON.parse(from.pop());
    history.tag = null;
    state.pending = null;
    if (state.selection?.kind === "node" && !nodeById(state.selection.id)) state.selection = null;
    if (state.selection?.kind === "edge" && !state.map.edges.some((edge) => edge.id === state.selection.id)) state.selection = null;
    state.picked = new Set([...state.picked].filter((id) => nodeById(id)));
    if (state.selection?.kind !== "node") {
      // The primary part is gone: a surviving picked part takes its place.
      const next = [...state.picked][0];
      state.selection = next ? { kind: "node", id: next } : state.selection?.kind === "edge" ? state.selection : null;
      if (!next) state.picked = new Set();
    }
    refreshDirty();
    status(direction === "undo" ? "Undone." : "Redone.");
    renderAll();
    revalidate();
  }

  // ---- loading ---------------------------------------------------------------

  async function load({ id = null, keepSelection = false } = {}) {
    const api = bridge();
    if (!api?.brainsState) {
      state.map = null;
      renderAll();
      return;
    }
    const previousId = state.map?.id ?? null;
    try {
      if (!state.catalog) state.catalog = (await api.brainsCatalog())?.catalog ?? null;
      const list = await api.brainsState();
      state.maps = list?.maps ?? [];
      state.activeId = list?.activeId ?? null;
      state.projectId = list?.projectId ?? null;
      const want = id ?? state.map?.id ?? state.activeId;
      let read = await api.brainsRead(want);
      // A map that is gone (deleted elsewhere, or a draft that never was
      // saved) falls back to the live one rather than an empty editor.
      if (!read?.ok && want !== state.activeId && state.activeId) read = await api.brainsRead(state.activeId);
      if (read?.ok) {
        state.map = read.map;
        state.compiled = read.compiled ?? null;
        state.problems = read.compiled?.problems ?? [];
      }
      savedSnapshot = state.map ? JSON.stringify(state.map) : null;
      state.dirty = false;
      state.draft = null;
      if (!keepSelection) {
        state.selection = null;
        state.picked = new Set();
      }
      state.pending = null;
      if (state.map?.id !== previousId || !keepSelection) resetHistory();
    } catch (error) {
      status(`Could not read the brain maps: ${error.message}`, "warn");
    }
    renderAll();
    if (state.map && state.map.id !== previousId) restoreView();
  }

  // Validation is the host's answer, not the editor's guess: the same module
  // that refuses a bad map on save is what draws the problems here.
  let validateTimer = null;
  function revalidate({ now = false } = {}) {
    clearTimeout(validateTimer);
    const run = async () => {
      const api = bridge();
      if (!api?.brainsValidate || !state.map) return;
      try {
        const result = await api.brainsValidate(state.map);
        if (!result?.ok) return;
        const before = JSON.stringify(state.problems);
        state.problems = result.result?.problems ?? [];
        state.compiled = result.compiled ?? null;
        renderProblems();
        // The canvas only draws problems; when they did not change it is
        // not rebuilt, so a verdict never lands as a flicker under a drag.
        if (JSON.stringify(state.problems) !== before && !state.gesture) renderCanvas();
        renderToolbar();
        // The inspector quotes problems and gate values too, but is never
        // rebuilt under a field the owner is typing in.
        const active = typeof document !== "undefined" ? document.activeElement : null;
        if (!active || !el.inspector?.contains?.(active)) renderInspector();
      } catch { /* a failed check leaves the last verdict on screen */ }
    };
    if (now) void run();
    else validateTimer = setTimeout(run, 260);
  }

  // ---- the viewport ---------------------------------------------------------------

  function viewSize() {
    return { w: el.canvasWrap?.clientWidth || 900, h: el.canvasWrap?.clientHeight || 600 };
  }

  function toWorld(clientX, clientY) {
    const rect = el.canvasWrap?.getBoundingClientRect?.() ?? { left: 0, top: 0 };
    return { x: (clientX - rect.left - state.view.x) / state.view.zoom, y: (clientY - rect.top - state.view.y) / state.view.zoom };
  }

  function applyView({ animate = false } = {}) {
    const { x, y, zoom } = state.view;
    if (el.stage) {
      el.stage.classList.toggle("animating", animate);
      el.stage.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
      el.stage.style.setProperty?.("--zoom", String(zoom));
      el.stage.dataset.lod = zoom < FAR_ZOOM ? "far" : "near";
      if (animate) setTimeout(() => el.stage?.classList.remove("animating"), 280);
    }
    if (el.canvasWrap) {
      // The dot grid moves with the stage; zoomed far out it thins to every
      // fourth dot instead of turning into a grey haze.
      let size = GRID * zoom;
      while (size < 10) size *= 4;
      el.canvasWrap.style.backgroundSize = `${size}px ${size}px`;
      el.canvasWrap.style.backgroundPosition = `${x}px ${y}px`;
    }
    if (el.zoomLevel) {
      el.zoomLevel.textContent = `${Math.round(zoom * 100)}%`;
      el.zoomLevel.setAttribute("aria-label", `${Math.round(zoom * 100)}% zoom. Press for 100%.`);
    }
    if (el.zoomIn) el.zoomIn.disabled = zoom >= ZOOM_MAX - 0.001;
    if (el.zoomOut) el.zoomOut.disabled = zoom <= ZOOM_MIN + 0.001;
    renderMinimapView();
    rememberView();
  }

  let viewQueued = false;
  function scheduleView() {
    if (viewQueued) return;
    viewQueued = true;
    frame(() => {
      viewQueued = false;
      applyView();
    });
  }

  let viewTimer = null;
  function rememberView() {
    if (!state.map?.id || !el.stage) return;
    views.set(state.map.id, { ...state.view });
    clearTimeout(viewTimer);
    viewTimer = setTimeout(() => {
      const saved = readJson(VIEW_KEY) ?? {};
      saved[state.map.id] = { ...state.view, at: Date.now() };
      const keep = Object.entries(saved).sort((a, b) => (b[1]?.at ?? 0) - (a[1]?.at ?? 0)).slice(0, 40);
      writeJson(VIEW_KEY, Object.fromEntries(keep));
    }, 500);
  }

  function restoreView() {
    if (!el.stage || !state.map) return;
    const stored = views.get(state.map.id) ?? readJson(VIEW_KEY)?.[state.map.id] ?? null;
    if (stored && Number.isFinite(stored.zoom) && Number.isFinite(stored.x) && Number.isFinite(stored.y)) {
      state.view = { x: stored.x, y: stored.y, zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, stored.zoom)) };
      applyView();
      return;
    }
    fit();
  }

  function zoomTo(next, anchor = null, { animate = false } = {}) {
    const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
    const { w, h } = viewSize();
    const at = anchor ?? { x: w / 2, y: h / 2 };
    const worldX = (at.x - state.view.x) / state.view.zoom;
    const worldY = (at.y - state.view.y) / state.view.zoom;
    state.view = { zoom, x: at.x - worldX * zoom, y: at.y - worldY * zoom };
    applyView({ animate });
  }

  function contentBounds(nodes = state.map?.nodes ?? []) {
    if (!nodes.length) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + NODE_W);
      maxY = Math.max(maxY, node.y + nodeHeight(node));
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  function fit({ animate = false } = {}) {
    const box = contentBounds();
    const { w, h } = viewSize();
    if (!box) {
      state.view = { x: 40, y: 40, zoom: 1 };
      applyView({ animate });
      return;
    }
    // Room for the view controls along the bottom edge.
    const padX = 48;
    const padTop = 56;
    const padBottom = 76;
    const zoom = Math.min(1, Math.max(ZOOM_MIN, Math.min((w - padX * 2) / box.w, (h - padTop - padBottom) / box.h)));
    state.view = {
      zoom,
      x: (w - box.w * zoom) / 2 - box.x * zoom,
      y: padTop + (h - padTop - padBottom - box.h * zoom) / 2 - box.y * zoom,
    };
    applyView({ animate });
    fittedView = { ...state.view };
  }

  // When the canvas changes size (a side panel hides or shows, the window is
  // resized) a fitted map is fitted again, and any other view keeps the map
  // where it was on screen instead of sliding with the canvas edge.
  let fittedView = null;
  let wrapLeft = null;
  function onWrapResize() {
    const rect = el.canvasWrap?.getBoundingClientRect?.();
    if (!rect || !rect.width || el.overlay?.hidden) {
      wrapLeft = null;
      return;
    }
    const sheetLeft = el.canvasWrap.closest?.(".brains-sheet")?.getBoundingClientRect?.().left ?? 0;
    const left = rect.left - sheetLeft;
    const fitted = fittedView && Math.abs(fittedView.x - state.view.x) < 0.5 && Math.abs(fittedView.y - state.view.y) < 0.5 && Math.abs(fittedView.zoom - state.view.zoom) < 0.0005;
    if (fitted && !state.gesture) fit();
    else {
      if (wrapLeft !== null && left !== wrapLeft && !state.gesture) {
        state.view.x += wrapLeft - left;
        applyView();
      }
      renderMinimapView();
    }
    wrapLeft = left;
  }

  function centerOn(node, { animate = true, zoom = null } = {}) {
    if (!node) return;
    const { w, h } = viewSize();
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom ?? Math.max(state.view.zoom, 0.85)));
    state.view = {
      zoom: next,
      x: w / 2 - (node.x + NODE_W / 2) * next,
      y: h / 2 - (node.y + nodeHeight(node) / 2) * next,
    };
    applyView({ animate });
  }

  // Keeps a part in view after it is added, nudged or reached with Tab.
  function ensureVisible(node) {
    if (!node || !el.stage) return;
    const { w, h } = viewSize();
    const z = state.view.zoom;
    const margin = 40;
    const left = node.x * z + state.view.x;
    const top = node.y * z + state.view.y;
    const right = left + NODE_W * z;
    const bottom = top + nodeHeight(node) * z;
    let dx = 0;
    let dy = 0;
    if (left < margin) dx = margin - left;
    else if (right > w - margin) dx = Math.max(margin - left, w - margin - right);
    if (top < margin) dy = margin - top;
    else if (bottom > h - margin) dy = Math.max(margin - top, h - margin - bottom);
    if (!dx && !dy) return;
    state.view.x += dx;
    state.view.y += dy;
    applyView({ animate: true });
  }

  function centerAtWorld(point) {
    const { w, h } = viewSize();
    state.view.x = w / 2 - point.x * state.view.zoom;
    state.view.y = h / 2 - point.y * state.view.zoom;
    scheduleView();
  }

  // ---- canvas -----------------------------------------------------------------

  // What the selection touches: its own wires light up and the rest recede, so
  // a part's place in the pipeline reads at a glance.
  function lighting() {
    const nodes = new Set();
    const edges = new Set();
    if (!state.map || !state.selection) return { nodes, edges, active: false };
    if (state.selection.kind === "node") {
      const picked = state.picked.size ? state.picked : new Set([state.selection.id]);
      for (const id of picked) nodes.add(id);
      for (const edge of state.map.edges) {
        if (picked.has(edge.from.node) || picked.has(edge.to.node)) {
          edges.add(edge.id);
          nodes.add(edge.from.node);
          nodes.add(edge.to.node);
        }
      }
    } else if (state.selection.kind === "edge") {
      const edge = state.map.edges.find((item) => item.id === state.selection.id);
      if (edge) {
        edges.add(edge.id);
        nodes.add(edge.from.node);
        nodes.add(edge.to.node);
      }
    }
    return { nodes, edges, active: edges.size > 0 || nodes.size > 0 };
  }

  function focusedCanvasTarget() {
    const active = typeof document !== "undefined" ? document.activeElement : null;
    if (!active || !el.canvas?.contains?.(active) || !active.dataset?.node) return null;
    return { node: active.dataset.node, port: active.dataset.port ?? null, dir: active.dataset.dir ?? null };
  }

  // Putting focus back after a rebuild is bookkeeping, not a choice: the part
  // box's focus listener ignores it, or it would re-select the part that had
  // focus and undo whatever selection the rebuild was drawing.
  let restoring = false;
  let tabbedAt = -Infinity;
  const tabbedRecently = () => Date.now() - tabbedAt < 600;
  function restoreFocus(target) {
    if (!target) return;
    const into = target.port ? portButtons.get(`${target.node}|${target.port}|${target.dir}`) : nodeBoxes.get(target.node);
    restoring = true;
    try {
      into?.focus?.({ preventScroll: true });
    } finally {
      restoring = false;
    }
  }

  function renderCanvas() {
    if (!el.canvas) return;
    const focused = focusedCanvasTarget();
    el.canvas.textContent = "";
    nodeBoxes.clear();
    portButtons.clear();
    if (!state.map) {
      renderWires(0, 0);
      renderMinimap();
      renderEmpty();
      return;
    }
    const errorNodes = new Map();
    const warnNodes = new Map();
    for (const problem of state.problems) {
      if (!problem.nodeId) continue;
      const bucket = problem.level === "error" ? errorNodes : problem.level === "warn" ? warnNodes : null;
      if (bucket && !bucket.has(problem.nodeId)) bucket.set(problem.nodeId, problem.text);
    }
    const lit = lighting();
    let right = 0;
    let bottom = 0;
    for (const node of state.map.nodes) {
      const spec = typeOf(node.type);
      const height = nodeHeight(node);
      right = Math.max(right, node.x + NODE_W);
      bottom = Math.max(bottom, node.y + height);
      const box = document.createElement("div");
      box.className = "brains-node";
      box.dataset.node = node.id;
      box.dataset.group = spec?.group ?? "control";
      box.dataset.runs = spec?.runs ?? "draft";
      const problemText = errorNodes.get(node.id) ?? warnNodes.get(node.id) ?? null;
      if (errorNodes.has(node.id)) box.dataset.problem = "error";
      else if (warnNodes.has(node.id)) box.dataset.problem = "warn";
      if (isPicked(node.id)) box.dataset.selected = "true";
      else if (lit.active && lit.nodes.has(node.id)) box.dataset.lit = "true";
      box.style.left = `${node.x}px`;
      box.style.top = `${node.y}px`;
      box.style.height = `${height}px`;
      box.dataset.rows = String((height - HEAD_H - FOOT_H) / PORT_H);
      box.tabIndex = 0;
      box.setAttribute("role", "group");
      box.setAttribute("aria-label", `${node.title}, ${spec ? groupLabel(spec.group) : "unknown"} part${problemText ? `. ${problemText}` : ""}`);
      box.addEventListener("focus", () => {
        if (restoring || !tabbedRecently()) return;
        const fresh = !(state.selection?.kind === "node" && state.selection.id === node.id);
        // Tabbing onto a part that is already picked keeps the group.
        if (fresh) select({ kind: "node", id: node.id }, { keepPicked: state.picked.has(node.id) });
        // Reached with Tab, a part off screen is brought into view and named;
        // pressed with the pointer, the view must not slide out from under a drag.
        if (state.gesture) return;
        ensureVisible(nodeById(node.id));
        if (fresh) status(`Selected "${node.title}". Arrow keys move it, Delete removes it, Tab reaches its ends.`);
      });

      const head = document.createElement("div");
      head.className = "brains-node-head";
      head.title = node.title;
      const top = document.createElement("span");
      top.className = "brains-node-top";
      if (spec?.glyph) top.append(glyph(spec.glyph, "glyph brains-node-glyph"));
      const kind = document.createElement("span");
      kind.className = "brains-node-kind";
      kind.textContent = groupLabel(spec?.group ?? "control");
      top.append(kind);
      const gate = spec?.gate ? state.catalog?.gates?.[spec.gate] : null;
      if (gate) {
        // The five parts that move a real switch when the map goes live.
        const mark = document.createElement("span");
        mark.className = "brains-node-switch";
        mark.title = `Moves "${gate.label}" when this map goes live. ${gate.detail}`;
        mark.append(switchIcon());
        top.append(mark);
      }
      if (problemText) {
        const alert = document.createElement("span");
        alert.className = "brains-node-alert";
        alert.dataset.level = errorNodes.has(node.id) ? "error" : "warn";
        alert.textContent = "!";
        alert.title = problemText;
        top.append(alert);
      }
      // Most parts are stages the studio already runs; only the exceptions
      // (rules the map runs itself, drawings nothing runs) carry a badge.
      if (spec && spec.runs !== "host") {
        const badge = document.createElement("span");
        badge.className = "brains-node-badge";
        badge.dataset.runs = spec.runs;
        badge.textContent = RUNS[spec.runs]?.short ?? spec.runs;
        badge.title = RUNS[spec.runs]?.detail ?? "";
        top.append(badge);
      }
      const title = document.createElement("b");
      const titleText = document.createElement("span");
      titleText.className = "brains-node-title";
      titleText.textContent = node.title;
      title.append(titleText);
      head.append(top, title);
      if (!spec) {
        const unknown = document.createElement("span");
        unknown.className = "brains-node-flag";
        unknown.textContent = "unknown part";
        head.append(unknown);
      }
      box.append(head);

      const ports = document.createElement("div");
      ports.className = "brains-node-ports";
      if (spec && !spec.inputs.length && !spec.outputs.length && typeof node.config?.text === "string") {
        // A note has no ends; its row carries what it says.
        const text = document.createElement("p");
        text.className = "brains-node-note";
        text.textContent = node.config.text || "Empty note — write it in the inspector.";
        text.title = node.config.text || "";
        ports.append(text);
      } else {
        ports.append(portColumn(node, spec?.inputs ?? [], "in"), portColumn(node, spec?.outputs ?? [], "out"));
      }
      box.append(ports);

      const foot = document.createElement("p");
      foot.className = "brains-node-foot";
      foot.textContent = footNote(node, spec);
      box.append(foot);
      el.canvas.append(box);
      nodeBoxes.set(node.id, box);
    }
    const width = Math.max(1200, right + 360);
    const height = Math.max(700, bottom + 240);
    el.canvas.style.width = `${width}px`;
    el.canvas.style.height = `${height}px`;
    renderWires(width, height);
    renderMinimap();
    renderEmpty();
    renderPartUse();
    if (!state.pending) hideGhost();
    restoreFocus(focused);
  }

  function portColumn(node, ports, dir) {
    const column = document.createElement("div");
    column.className = `brains-port-col ${dir}`;
    for (const port of ports) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "brains-port";
      button.dataset.node = node.id;
      button.dataset.port = port.id;
      button.dataset.dir = dir;
      const wired = state.map.edges.some((edge) => (dir === "in" ? edge.to.node === node.id && edge.to.port === port.id : edge.from.node === node.id && edge.from.port === port.id));
      button.dataset.wired = String(wired);
      if (port.required) button.dataset.required = "true";
      if (state.pending && state.pending.node === node.id && state.pending.port === port.id && state.pending.dir === dir) button.dataset.armed = "true";
      else if (state.pending) button.dataset.target = state.pending.dir === dir ? "no" : (canJoin(state.pending, { node: node.id, port: port.id, dir }) ? "yes" : "no");
      // Tab walks part to part; a part's ends join the order once it is
      // selected, and while a wire is armed every end that can take it does.
      const selected = state.selection?.kind === "node" && state.selection.id === node.id;
      button.tabIndex = selected || button.dataset.armed === "true" || button.dataset.target === "yes" ? 0 : -1;
      const dot = document.createElement("i");
      dot.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.textContent = port.label;
      button.append(...(dir === "in" ? [dot, label] : [label, dot]));
      button.title = `${port.label} · carries ${port.kinds.map(kindLabel).join(", ")}${port.required ? " · required" : ""}. Drag to another end, or click to ${state.pending ? "finish" : "start"} a wire.`;
      button.setAttribute("aria-label", `${dir === "in" ? "Input" : "Output"} ${port.label} on ${node.title}${wired ? ", wired" : port.required ? ", required, not wired" : ""}`);
      column.append(button);
      portButtons.set(`${node.id}|${port.id}|${dir}`, button);
    }
    return column;
  }

  function footNote(node, spec) {
    if (!spec) return "This build does not have this part.";
    const bits = [];
    if (node.model) bits.push(node.model.mode === "pinned" && node.model.model ? `model ${node.model.model}` : `${node.model.role} model`);
    if (spec.permissions.length) bits.push(`${spec.permissions.length} permission${spec.permissions.length === 1 ? "" : "s"}`);
    const gate = spec.gate ? state.catalog?.gates?.[spec.gate] : null;
    if (gate) bits.push(`moves ${gate.label}`);
    // "Live stage" is most parts; saying it on every one is noise.
    if (spec.runs !== "host" || !bits.length) bits.push(RUNS[spec.runs]?.label.toLowerCase() ?? spec.runs);
    return bits.join(" · ");
  }

  function renderWires(width, height) {
    wirePaths.clear();
    for (const layer of [el.wires, el.wireHits]) {
      if (!layer) continue;
      layer.setAttribute("viewBox", `0 0 ${width} ${height}`);
      layer.setAttribute("width", String(width));
      layer.setAttribute("height", String(height));
      layer.textContent = "";
    }
    if (!el.wires || !state.map) return;
    const badEdges = new Set(state.problems.filter((item) => item.level === "error" && item.edgeId).map((item) => item.edgeId));
    const lit = lighting();
    const hits = [];
    for (const edge of state.map.edges) {
      const from = portPoint(edge.from.node, edge.from.port, "out");
      const to = portPoint(edge.to.node, edge.to.port, "in");
      if (!from || !to) continue;
      const d = wireD(from, to);
      const path = svg("path");
      path.setAttribute("d", d);
      path.setAttribute("class", "brains-wire");
      path.dataset.edge = edge.id;
      path.dataset.group = typeOf(nodeById(edge.from.node)?.type)?.group ?? "control";
      if (edge.feedback) path.dataset.feedback = "true";
      if (badEdges.has(edge.id)) path.dataset.problem = "error";
      if (state.selection?.kind === "edge" && state.selection.id === edge.id) path.dataset.selected = "true";
      else if (lit.active) path.dataset[lit.edges.has(edge.id) ? "lit" : "dim"] = "true";
      const label = svg("title");
      label.textContent = wireTitle(edge);
      let hit = null;
      if (el.wireHits) {
        // The drawn wire is 2px; this invisible twin gives it a 14px reach
        // so it can be picked without pixel-hunting.
        hit = svg("path");
        hit.setAttribute("d", d);
        hit.setAttribute("class", "brains-wire-hit");
        hit.dataset.edge = edge.id;
        hit.append(label);
        // Backward wires loop under the map, so they count as the longest.
        hits.push({ hit, span: Math.abs(to.x - from.x) + Math.abs(to.y - from.y) + (to.x < from.x ? 1e6 : 0) });
      } else {
        path.append(label);
      }
      el.wires.append(path);
      wirePaths.set(edge.id, { path, hit });
    }
    // The wide pick bands overlap where wires run close together; the
    // shortest wires go on top, so a long wire never hides a short one it
    // passes over.
    hits.sort((a, b) => b.span - a.span);
    for (const { hit } of hits) el.wireHits.append(hit);
  }

  function wireTitle(edge) {
    const from = nodeById(edge.from.node);
    const to = nodeById(edge.to.node);
    return `${from?.title ?? edge.from.node} → ${to?.title ?? edge.to.node}${edge.feedback ? " (feedback: it lands on the next pass)" : ""}`;
  }

  // During a drag only the moved part's wires are redrawn.
  function updateWiresFor(nodeId) {
    for (const edge of state.map?.edges ?? []) {
      if (edge.from.node !== nodeId && edge.to.node !== nodeId) continue;
      const pair = wirePaths.get(edge.id);
      const from = portPoint(edge.from.node, edge.from.port, "out");
      const to = portPoint(edge.to.node, edge.to.port, "in");
      if (!pair || !from || !to) continue;
      const d = wireD(from, to);
      pair.path.setAttribute("d", d);
      pair.hit?.setAttribute("d", d);
    }
  }

  function drawGhost(point) {
    if (!el.ghost || !el.ghostPath || !state.pending) return;
    const anchor = portPoint(state.pending.node, state.pending.port, state.pending.dir);
    if (!anchor) return;
    el.ghostPath.setAttribute("d", state.pending.dir === "out" ? wireD(anchor, point, { loop: false }) : wireD(point, anchor, { loop: false }));
    el.ghost.dataset.on = "true";
  }

  function hideGhost() {
    if (el.ghost) el.ghost.dataset.on = "false";
  }

  function renderEmpty() {
    if (!el.empty) return;
    el.empty.hidden = !state.map || state.map.nodes.length > 0;
  }

  // ---- minimap -------------------------------------------------------------------

  let miniWorld = null;
  function renderMinimap() {
    if (!el.minimapSvg) return;
    el.minimapSvg.textContent = "";
    el.miniView = null;
    const box = contentBounds();
    if (el.minimap) el.minimap.hidden = !box;
    if (!box) { miniWorld = null; return; }
    const pad = 120;
    miniWorld = { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 };
    el.minimapSvg.setAttribute("viewBox", `${miniWorld.x} ${miniWorld.y} ${miniWorld.w} ${miniWorld.h}`);
    for (const edge of state.map.edges) {
      const from = nodeById(edge.from.node);
      const to = nodeById(edge.to.node);
      if (!from || !to) continue;
      const line = svg("line");
      line.setAttribute("x1", String(from.x + NODE_W));
      line.setAttribute("y1", String(from.y + nodeHeight(from) / 2));
      line.setAttribute("x2", String(to.x));
      line.setAttribute("y2", String(to.y + nodeHeight(to) / 2));
      line.setAttribute("class", "brains-mini-wire");
      el.minimapSvg.append(line);
    }
    for (const node of state.map.nodes) {
      const rect = svg("rect");
      rect.setAttribute("x", String(node.x));
      rect.setAttribute("y", String(node.y));
      rect.setAttribute("width", String(NODE_W));
      rect.setAttribute("height", String(nodeHeight(node)));
      rect.setAttribute("rx", "16");
      rect.setAttribute("class", "brains-mini-node");
      rect.dataset.group = typeOf(node.type)?.group ?? "control";
      if (isPicked(node.id)) rect.dataset.selected = "true";
      el.minimapSvg.append(rect);
    }
    const view = svg("rect");
    view.setAttribute("class", "brains-mini-view");
    el.minimapSvg.append(view);
    el.miniView = view;
    renderMinimapView();
  }

  function renderMinimapView() {
    if (!el.miniView || !miniWorld) return;
    const { w, h } = viewSize();
    const z = state.view.zoom;
    const x = -state.view.x / z;
    const y = -state.view.y / z;
    el.miniView.setAttribute("x", String(x));
    el.miniView.setAttribute("y", String(y));
    el.miniView.setAttribute("width", String(w / z));
    el.miniView.setAttribute("height", String(h / z));
    // The map is its own overview once all of it is on screen.
    const box = contentBounds();
    const fits = Boolean(box) && box.x >= x && box.y >= y && box.x + box.w <= x + w / z && box.y + box.h <= y + h / z;
    if (el.minimap) el.minimap.dataset.fits = String(fits);
  }

  function miniPoint(event) {
    const node = el.minimapSvg;
    const matrix = node?.getScreenCTM?.();
    if (!matrix || !node.createSVGPoint) return null;
    const point = node.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const world = point.matrixTransform(matrix.inverse());
    return { x: world.x, y: world.y };
  }

  // ---- wiring ------------------------------------------------------------------

  function canJoin(a, b) {
    const from = a.dir === "out" ? a : b;
    const to = a.dir === "out" ? b : a;
    if (from.dir !== "out" || to.dir !== "in" || from.node === to.node) return false;
    const fromSpec = typeOf(nodeById(from.node)?.type);
    const toSpec = typeOf(nodeById(to.node)?.type);
    const output = fromSpec?.outputs.find((item) => item.id === from.port);
    const input = toSpec?.inputs.find((item) => item.id === to.port);
    if (!output || !input) return false;
    return output.kinds.includes("any") || input.kinds.includes("any") || output.kinds.some((kind) => input.kinds.includes(kind));
  }

  // Whether a catalog part has any end the armed wire could land on.
  function partFits(spec, end = state.pending) {
    if (!end || !spec) return true;
    const kindsOf = (ports) => ports.flatMap((port) => port.kinds);
    const armed = typeOf(nodeById(end.node)?.type);
    const armedPort = (end.dir === "out" ? armed?.outputs : armed?.inputs)?.find((port) => port.id === end.port);
    if (!armedPort) return false;
    const other = kindsOf(end.dir === "out" ? spec.inputs : spec.outputs);
    return armedPort.kinds.includes("any") || other.includes("any") || armedPort.kinds.some((kind) => other.includes(kind));
  }

  function clickPort(target) {
    const end = { node: target.dataset.node, port: target.dataset.port, dir: target.dataset.dir };
    if (!state.pending) {
      state.pending = end;
      status(`Wiring from ${nodeById(end.node)?.title ?? end.node} · ${end.port}. Click the other end, or press Escape.`);
      renderCanvas();
      return false;
    }
    if (state.pending.node === end.node && state.pending.port === end.port && state.pending.dir === end.dir) {
      state.pending = null;
      status("Wire cancelled.");
      renderCanvas();
      return false;
    }
    if (!canJoin(state.pending, end)) {
      const from = state.pending.dir === "out" ? state.pending : end;
      const to = state.pending.dir === "out" ? end : state.pending;
      const fromSpec = typeOf(nodeById(from.node)?.type);
      const toSpec = typeOf(nodeById(to.node)?.type);
      const output = fromSpec?.outputs.find((item) => item.id === from.port);
      const input = toSpec?.inputs.find((item) => item.id === to.port);
      status(output && input
        ? `${output.label} carries ${output.kinds.join("/")}; ${input.label} takes ${input.kinds.join("/")}. They cannot be joined.`
        : "Wires run from an output to an input.", "warn");
      return false;
    }
    const from = state.pending.dir === "out" ? state.pending : end;
    const to = state.pending.dir === "out" ? end : state.pending;
    state.pending = null;
    connect(from, to);
    return true;
  }

  function connect(from, to, { record = true } = {}) {
    const id = `e_${from.node}_${from.port}_${to.node}_${to.port}`.replace(/[^a-z0-9_-]/gi, "_");
    // Two ends are already joined or they are not: the store dedupes on the
    // endpoints, so the canvas must not show a second wire whose only
    // difference is the id it was generated with.
    if (state.map.edges.some((edge) => edge.from.node === from.node && edge.from.port === from.port
      && edge.to.node === to.node && edge.to.port === to.port)) {
      status("Those two ends are already wired.");
      renderCanvas();
      return;
    }
    if (!roomFor(0, 1)) { renderCanvas(); return; }
    if (record) checkpoint();
    state.map.edges.push({ id, from: { ...from }, to: { ...to } });
    touch(`Wired ${nodeById(from.node)?.title} → ${nodeById(to.node)?.title}.`);
    select({ kind: "edge", id });
  }

  // A wire dropped on a part, not on one of its ends, lands on the first end
  // that can take it.
  function joinToNode(nodeId) {
    const spec = typeOf(nodeById(nodeId)?.type);
    if (!spec || !state.pending) return false;
    const list = state.pending.dir === "out" ? spec.inputs : spec.outputs;
    const dir = state.pending.dir === "out" ? "in" : "out";
    const free = list.filter((port) => canJoin(state.pending, { node: nodeId, port: port.id, dir }));
    const port = free.find((item) => !state.map.edges.some((edge) => (dir === "in" ? edge.to.node === nodeId && edge.to.port === item.id : edge.from.node === nodeId && edge.from.port === item.id))) ?? free[0];
    if (!port) return false;
    const other = { node: nodeId, port: port.id, dir };
    const from = state.pending.dir === "out" ? state.pending : other;
    const to = state.pending.dir === "out" ? other : state.pending;
    state.pending = null;
    connect(from, to);
    return true;
  }

  function cancelWire(message = "Wire cancelled.") {
    if (state.gesture?.kind === "wire") state.gesture = null;
    if (!state.pending) return;
    state.pending = null;
    hideGhost();
    status(message);
    renderCanvas();
  }

  function deleteSelection() {
    if (!state.selection || !state.map) return;
    if (state.selection.kind === "edge") {
      const edge = state.map.edges.find((item) => item.id === state.selection.id);
      if (edge) checkpoint();
      state.map.edges = state.map.edges.filter((item) => item.id !== state.selection.id);
      state.selection = null;
      touch(edge ? "Wire removed. Ctrl Z brings it back." : "");
      return;
    }
    const doomed = pickedNodes();
    if (!doomed.length) return;
    checkpoint();
    const ids = new Set(doomed.map((node) => node.id));
    if (state.pending && ids.has(state.pending.node)) {
      state.pending = null;
      hideGhost();
    }
    state.map.nodes = state.map.nodes.filter((item) => !ids.has(item.id));
    state.map.edges = state.map.edges.filter((edge) => !ids.has(edge.from.node) && !ids.has(edge.to.node));
    state.selection = null;
    state.picked = new Set();
    touch(doomed.length === 1 ? `Removed "${doomed[0].title}" and its wires.` : `Removed ${doomed.length} parts and their wires. Ctrl Z brings them back.`);
    el.canvasWrap?.focus?.({ preventScroll: true });
  }

  function touch(message = "") {
    refreshDirty();
    if (message) status(message);
    renderCanvas();
    renderInspector();
    renderToolbar();
    revalidate();
  }

  // For edits made from the inspector's own fields: the canvas and toolbar
  // follow, but the inspector is not rebuilt under the cursor.
  function touchQuiet() {
    refreshDirty();
    renderCanvas();
    renderToolbar();
    revalidate();
  }

  // The selection is one primary item (what the inspector shows) plus, for
  // parts, the set picked with Shift, Ctrl or a marquee. A plain select picks
  // just that part.
  function select(selection, { keepPicked = false } = {}) {
    state.selection = selection;
    if (!keepPicked) state.picked = new Set(selection?.kind === "node" ? [selection.id] : []);
    if (selection?.kind !== "node") state.picked = new Set();
    renderCanvas();
    renderInspector();
  }

  function isPicked(id) {
    return state.picked.has(id) || (state.selection?.kind === "node" && state.selection.id === id);
  }

  function pickedNodes() {
    const ids = state.picked.size ? state.picked : new Set(state.selection?.kind === "node" ? [state.selection.id] : []);
    return state.map?.nodes.filter((node) => ids.has(node.id)) ?? [];
  }

  // Paints the picked set onto the parts already on the canvas, for the
  // marquee, which changes it on every pointer move.
  function paintPicked() {
    for (const [id, box] of nodeBoxes) {
      if (state.picked.has(id)) box.dataset.selected = "true";
      else delete box.dataset.selected;
    }
  }

  // ---- adding parts --------------------------------------------------------------

  // The host keeps at most maxNodes parts and maxEdges wires and drops the
  // rest on save without a word, so the editor refuses before that happens.
  function roomFor(parts, wires = 0) {
    const maxNodes = state.catalog?.limits?.maxNodes ?? 120;
    const maxEdges = state.catalog?.limits?.maxEdges ?? 240;
    const nodes = state.map.nodes.length;
    const edges = state.map.edges.length;
    if (nodes + parts > maxNodes) {
      status(parts === 1 ? `This map already has ${nodes} parts, the most a map can hold.`
        : `That would make ${nodes + parts} parts; a map holds at most ${maxNodes}.`, "warn");
      return false;
    }
    if (edges + wires > maxEdges) {
      status(wires === 1 ? `This map already has ${edges} wires, the most a map can hold.`
        : `That would make ${edges + wires} wires; a map holds at most ${maxEdges}.`, "warn");
      return false;
    }
    return true;
  }

  function freeId(type) {
    const base = `n_${type.replace(/[^a-z0-9]+/gi, "_")}`;
    if (!nodeById(base)) return base;
    for (let index = 2; index < 200; index += 1) if (!nodeById(`${base}_${index}`)) return `${base}_${index}`;
    return `${base}_${Date.now()}`;
  }

  function overlaps(x, y, height, skip = null, margin = GRID) {
    return state.map.nodes.some((node) => node !== skip
      && x < node.x + NODE_W + margin && x + NODE_W + margin > node.x
      && y < node.y + nodeHeight(node) + margin && y + height + margin > node.y);
  }

  // A part that would land on another steps down, then over a column, rather
  // than stacking where it cannot be seen.
  function freeSpot(spot, height = HEAD_H + PORT_H * 2 + FOOT_H) {
    const start = { x: snap(spot.x), y: snap(spot.y) };
    for (let column = 0; column < 6; column += 1) {
      for (let row = 0; row < 14; row += 1) {
        const x = start.x + column * (NODE_W + GRID * 3);
        const y = start.y + row * GRID * 2;
        // A spot past the host's range would be moved on save.
        if (x > LIMIT || y > LIMIT) continue;
        if (!overlaps(x, y, height)) return { x, y };
      }
    }
    return start;
  }

  function viewCenterSpot() {
    const { w, h } = viewSize();
    const center = { x: (w / 2 - state.view.x) / state.view.zoom, y: (h / 2 - state.view.y) / state.view.zoom };
    return { x: snap(center.x - NODE_W / 2), y: snap(center.y - 80) };
  }

  // Where a part added without a drop point goes: beside the end a wire is
  // armed on, else as the next step after the selected part, else in the
  // middle of the view.
  function naturalSpot() {
    const armed = state.pending ? nodeById(state.pending.node) : null;
    if (armed) return { x: state.pending.dir === "out" ? armed.x + NODE_W + GRID * 4 : armed.x - NODE_W - GRID * 4, y: armed.y };
    const selected = state.selection?.kind === "node" ? nodeById(state.selection.id) : null;
    if (selected) return { x: selected.x + NODE_W + GRID * 4, y: selected.y };
    return viewCenterSpot();
  }

  function addNode(type, at = null) {
    const spec = typeOf(type);
    if (!spec || !state.map) return null;
    const fits = state.pending && partFits(spec);
    if (!roomFor(1, fits ? 1 : 0)) return null;
    checkpoint();
    const spot = freeSpot(at ?? naturalSpot(), specHeight(spec));
    const node = {
      id: freeId(type),
      type,
      title: spec.label,
      x: snap(spot.x),
      y: snap(spot.y),
      config: Object.fromEntries((spec.settings ?? []).map((setting) => [setting.key, Array.isArray(setting.default) ? [...setting.default] : setting.default])),
      model: spec.model ? { mode: "inherit", role: spec.model.role, model: null } : null,
    };
    state.map.nodes.push(node);
    // Adding a part it needs reach for grants that reach on the map, so the
    // new node is not born as an error the owner has to chase.
    for (const key of spec.permissions) if (!state.map.grants.includes(key)) state.map.grants.push(key);
    // A part added while a wire was armed finishes that wire when it can.
    if (state.pending) {
      const end = state.pending.dir === "out"
        ? (spec.inputs.find((port) => canJoin(state.pending, { node: node.id, port: port.id, dir: "in" })) ?? null)
        : (spec.outputs.find((port) => canJoin(state.pending, { node: node.id, port: port.id, dir: "out" })) ?? null);
      if (end) {
        const other = { node: node.id, port: end.id, dir: state.pending.dir === "out" ? "in" : "out" };
        const from = state.pending.dir === "out" ? state.pending : other;
        const to = state.pending.dir === "out" ? other : state.pending;
        state.pending = null;
        connect(from, to, { record: false });
        touch(`Added "${node.title}" and wired it in.`);
        select({ kind: "node", id: node.id });
        ensureVisible(node);
        return node;
      }
      state.pending = null;
    }
    touch(`Added "${node.title}".`);
    select({ kind: "node", id: node.id });
    ensureVisible(node);
    return node;
  }

  // Copies the picked parts, and the wires that run between them, a step
  // down and to the right. Wires to parts outside the copy stay with the
  // originals.
  function duplicateNode(id) {
    if (!state.map) return;
    const group = isPicked(id) && state.picked.size > 1 ? pickedNodes() : [nodeById(id)].filter(Boolean);
    if (!group.length) return;
    const picked = new Set(group.map((node) => node.id));
    if (!roomFor(group.length, state.map.edges.filter((edge) => picked.has(edge.from.node) && picked.has(edge.to.node)).length)) return;
    checkpoint();
    const ids = new Map();
    const copies = [];
    const single = group.length === 1;
    const offset = single ? null : { x: GRID * 2, y: GRID * 2 };
    for (const node of group) {
      const copy = {
        ...JSON.parse(JSON.stringify(node)),
        id: freeId(node.type),
        title: clean(`${node.title} copy`, 60),
        ...(single ? freeSpot({ x: node.x + GRID * 2, y: node.y + GRID * 2 }, nodeHeight(node)) : { x: snap(node.x + offset.x), y: snap(node.y + offset.y) }),
      };
      state.map.nodes.push(copy);
      ids.set(node.id, copy.id);
      copies.push(copy);
    }
    let wires = 0;
    for (const edge of [...state.map.edges]) {
      if (!ids.has(edge.from.node) || !ids.has(edge.to.node)) continue;
      const from = { ...edge.from, node: ids.get(edge.from.node) };
      const to = { ...edge.to, node: ids.get(edge.to.node) };
      state.map.edges.push({ id: `e_${from.node}_${from.port}_${to.node}_${to.port}`.replace(/[^a-z0-9_-]/gi, "_"), from, to, ...(edge.feedback ? { feedback: true } : {}) });
      wires += 1;
    }
    touch(single ? `Copied "${group[0].title}". Its wires stay with the original.` : `Copied ${group.length} parts${wires ? ` and the ${plural(wires, "wire")} between them` : ""}.`);
    state.picked = new Set(copies.map((copy) => copy.id));
    select({ kind: "node", id: copies[0].id }, { keepPicked: true });
    ensureVisible(copies[0]);
  }

  function nudge(dx, dy) {
    const group = state.selection?.kind === "node" ? pickedNodes() : [];
    if (!group.length) {
      state.view.x -= dx * 4;
      state.view.y -= dy * 4;
      applyView();
      return;
    }
    checkpoint(`nudge:${group.map((node) => node.id).join(",")}`);
    for (const node of group) {
      node.x = snap(node.x + dx);
      node.y = snap(node.y + dy);
    }
    refreshDirty();
    renderCanvas();
    renderToolbar();
    ensureVisible(nodeById(state.selection.id) ?? group[0]);
  }

  function pickAll() {
    if (!state.map?.nodes.length) return;
    state.picked = new Set(state.map.nodes.map((node) => node.id));
    select({ kind: "node", id: state.map.nodes[0].id }, { keepPicked: true });
    status(`Picked all ${plural(state.map.nodes.length, "part")}. Drag one to move them all; Delete removes them.`);
  }

  // Tidy lays the parts out in pipeline order: each part one column right of
  // the furthest part that feeds it, feedback wires ignored, and a leftover
  // loop broken at its leftmost part so every map has an order.
  function tidy() {
    const nodes = state.map?.nodes ?? [];
    if (nodes.length < 2) return;
    checkpoint();
    layoutPipeline();
    touch(`Lined up ${plural(nodes.length, "part")} in pipeline order. Ctrl Z puts them back.`);
    fit({ animate: true });
  }

  function layoutPipeline() {
    const nodes = state.map?.nodes ?? [];
    if (nodes.length < 2) return;
    const ids = new Set(nodes.map((node) => node.id));
    const incoming = new Map(nodes.map((node) => [node.id, []]));
    const outgoing = new Map(nodes.map((node) => [node.id, []]));
    for (const edge of state.map.edges) {
      if (edge.feedback || edge.from.node === edge.to.node || !ids.has(edge.from.node) || !ids.has(edge.to.node)) continue;
      incoming.get(edge.to.node).push(edge.from.node);
      outgoing.get(edge.from.node).push(edge.to.node);
    }
    const byPlace = (a, b) => a.x - b.x || a.y - b.y;
    const waiting = new Map(nodes.map((node) => [node.id, incoming.get(node.id).length]));
    const remaining = new Set(ids);
    const queue = nodes.filter((node) => waiting.get(node.id) === 0).sort(byPlace).map((node) => node.id);
    const rank = new Map();
    while (remaining.size) {
      if (!queue.length) queue.push([...remaining].map(nodeById).sort(byPlace)[0].id);
      const id = queue.shift();
      if (!remaining.has(id)) continue;
      remaining.delete(id);
      rank.set(id, Math.max(0, ...incoming.get(id).filter((pred) => rank.has(pred)).map((pred) => rank.get(pred) + 1)));
      for (const next of outgoing.get(id)) {
        waiting.set(next, waiting.get(next) - 1);
        if (waiting.get(next) <= 0 && remaining.has(next)) queue.push(next);
      }
    }
    const columns = [];
    for (const node of [...nodes].sort(byPlace)) (columns[rank.get(node.id)] ??= []).push(node.id);
    const GAP_X = 300;
    const GAP_Y = 40;
    // No column taller than this: one wide stage is cut into several columns
    // rather than running past the host's y limit.
    const SLOT_MAX = 2400;
    const heightOf = (column) => column.reduce((sum, id) => sum + nodeHeight(nodeById(id)), 0) + GAP_Y * (column.length - 1);
    // Pass one orders each rank by where the parts that feed it sit.
    const middle = new Map();
    const ordered = [];
    const provisional = Math.max(...columns.filter(Boolean).map(heightOf));
    for (const column of columns) {
      if (!column) continue;
      const weight = (id) => {
        const feeds = incoming.get(id).filter((pred) => middle.has(pred));
        return feeds.length ? feeds.reduce((sum, pred) => sum + middle.get(pred), 0) / feeds.length : nodeById(id).y;
      };
      column.sort((a, b) => weight(a) - weight(b));
      let y = (provisional - heightOf(column)) / 2;
      for (const id of column) {
        middle.set(id, y + nodeHeight(nodeById(id)) / 2);
        y += nodeHeight(nodeById(id)) + GAP_Y;
      }
      ordered.push(column);
    }
    // Pass two cuts tall ranks into slots and places them. The host clamps x
    // and y to ±4000, which would drop the tail of a long pipeline onto its
    // neighbours, so a row too long for the range continues on a band
    // underneath, and the whole layout starts far enough up and left to fit.
    const slots = [];
    for (const column of ordered) {
      let slot = [];
      for (const id of column) {
        if (slot.length && heightOf([...slot, id]) > SLOT_MAX) { slots.push(slot); slot = []; }
        slot.push(id);
      }
      if (slot.length) slots.push(slot);
    }
    const bandHeight = Math.max(...slots.map(heightOf));
    const perBand = Math.max(1, Math.floor((2 * LIMIT - NODE_W) / GAP_X) + 1);
    const bands = Math.ceil(slots.length / perBand);
    const inBand = Math.min(slots.length, perBand);
    const startX = Math.max(-LIMIT, Math.min(40, LIMIT - ((inBand - 1) * GAP_X + NODE_W)));
    const span = bands * bandHeight + (bands - 1) * GAP_Y * 4;
    const startY = Math.max(-LIMIT, Math.min(40, LIMIT - span));
    slots.forEach((slot, index) => {
      let y = startY + Math.floor(index / perBand) * (bandHeight + GAP_Y * 4) + (bandHeight - heightOf(slot)) / 2;
      for (const id of slot) {
        const node = nodeById(id);
        node.x = snap(startX + (index % perBand) * GAP_X);
        node.y = snap(y);
        y += nodeHeight(node) + GAP_Y;
      }
    });
  }

  // ---- the parts panel -------------------------------------------------------------

  function renderPartUse() {
    const counts = new Map();
    for (const node of state.map?.nodes ?? []) counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
    for (const [type, chipEl] of partUse) {
      const count = counts.get(type) ?? 0;
      chipEl.hidden = count === 0;
      chipEl.textContent = count > 1 ? `on map ×${count}` : "on map";
    }
  }

  function renderParts() {
    if (!el.partsList) return;
    el.partsList.textContent = "";
    partUse.clear();
    const query = state.partsQuery.trim().toLowerCase();
    const groups = state.catalog?.groups ?? [];
    const collapsed = new Set(state.layout.collapsed);
    for (const group of groups) {
      const parts = (state.catalog?.nodes ?? []).filter((node) => node.group === group.id
        && (!query || `${node.label} ${node.type} ${node.summary} ${node.can.join(" ")}`.toLowerCase().includes(query)));
      if (!parts.length) continue;
      const closed = !query && collapsed.has(group.id);
      const section = document.createElement("section");
      section.className = "brains-parts-group";
      section.dataset.group = group.id;
      section.dataset.collapsed = String(closed);
      const heading = document.createElement("h4");
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "brains-group-toggle";
      toggle.setAttribute("aria-expanded", String(!closed));
      toggle.title = group.detail;
      const dot = document.createElement("i");
      dot.className = "brains-dot";
      dot.setAttribute("aria-hidden", "true");
      const name = document.createElement("span");
      name.textContent = group.label;
      const count = document.createElement("span");
      count.className = "brains-count";
      count.textContent = String(parts.length);
      toggle.append(dot, name, count);
      toggle.addEventListener("click", () => {
        const next = new Set(state.layout.collapsed);
        if (next.has(group.id)) next.delete(group.id); else next.add(group.id);
        state.layout.collapsed = [...next];
        saveLayout();
        renderParts();
      });
      heading.append(toggle);
      const note = document.createElement("p");
      note.className = "brains-parts-detail";
      note.textContent = group.detail;
      note.hidden = closed;
      const items = document.createElement("div");
      items.className = "brains-parts-items";
      items.hidden = closed;
      for (const part of parts) items.append(partCard(part));
      section.append(heading, note, items);
      el.partsList.append(section);
    }
    if (!el.partsList.children.length) {
      const empty = document.createElement("p");
      empty.className = "brains-empty";
      empty.textContent = query ? `No part matches "${state.partsQuery}".` : "The parts catalog is unavailable.";
      el.partsList.append(empty);
    }
    renderPartUse();
  }

  function partCard(part) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "brains-part";
    button.dataset.type = part.type;
    button.dataset.runs = part.runs;
    button.dataset.group = part.group;
    button.draggable = true;
    const top = document.createElement("span");
    top.className = "brains-part-top";
    if (part.glyph) top.append(glyph(part.glyph, "glyph brains-part-glyph"));
    const name = document.createElement("b");
    name.textContent = part.label;
    top.append(name);
    // What runs it and how many the map has go on a line of their own, so
    // the name always keeps the full width.
    const meta = document.createElement("span");
    meta.className = "brains-part-meta";
    if (part.runs !== "host") {
      const runs = document.createElement("span");
      runs.className = "brains-part-runs";
      runs.dataset.runs = part.runs;
      runs.textContent = RUNS[part.runs]?.label ?? part.runs;
      meta.append(runs);
    }
    const used = document.createElement("span");
    used.className = "brains-part-used";
    used.hidden = true;
    meta.append(used);
    partUse.set(part.type, used);
    const summary = document.createElement("span");
    summary.className = "brains-part-summary";
    summary.textContent = part.summary;
    button.append(top, meta, summary);
    button.title = `${part.summary}\n\n${RUNS[part.runs]?.detail ?? ""}\n\nClick to add it where the canvas is looking, or drag it to a spot.`;
    button.addEventListener("click", () => addNode(part.type));
    button.addEventListener("dragstart", (event) => {
      event.dataTransfer?.setData?.(PART_MIME, part.type);
      event.dataTransfer?.setData?.("text/plain", part.label);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
      el.canvasWrap?.classList.add("drop-ready");
    });
    button.addEventListener("dragend", () => el.canvasWrap?.classList.remove("drop-ready"));
    return button;
  }

  // ---- the Space search ---------------------------------------------------------

  // One search, two modes: "add" lists the catalog (and, once something is
  // typed, parts already here); "find" (Ctrl F) lists only this map's parts.
  function openSearch(at = null, { fromDrop = false, mode = "add" } = {}) {
    if (!state.catalog || (mode === "find" && !state.map?.nodes.length)) return;
    state.search = { open: true, query: "", index: 0, at, fromDrop, mode };
    el.search.hidden = false;
    el.searchInput.value = "";
    el.searchInput.placeholder = mode === "find" ? "Find a part on this map…" : "Add a part, or find one on this map…";
    renderSearch();
    el.searchInput.focus();
  }

  function closeSearch() {
    const wasDrop = state.search.fromDrop;
    state.search.open = false;
    state.search.fromDrop = false;
    if (el.search) el.search.hidden = true;
    // A wire dragged into empty space only lives as long as its search.
    if (wasDrop && state.pending) cancelWire("Wire cancelled.");
    el.canvasWrap?.focus?.({ preventScroll: true });
  }

  function searchMatches() {
    const query = state.search.query.trim().toLowerCase();
    const parts = state.catalog?.nodes ?? [];
    const scored = parts
      .map((part, order) => {
        const haystack = `${part.label} ${part.type} ${part.summary} ${part.can.join(" ")} ${groupLabel(part.group)}`.toLowerCase();
        let score = -1;
        if (!query) score = 0;
        else if (part.label.toLowerCase().startsWith(query)) score = 3;
        else if (part.type.includes(query)) score = 2;
        else if (haystack.includes(query)) score = 1;
        // With a wire armed, the parts it can land on come first.
        if (score >= 0 && state.pending && partFits(part)) score += 10;
        return { part, score, order };
      })
      .filter((row) => row.score >= 0);
    scored.sort((a, b) => b.score - a.score || a.order - b.order);
    return scored.map((row) => row.part);
  }

  // Parts already on the map that match, so Space doubles as "go to".
  function searchNodes() {
    const query = state.search.query.trim().toLowerCase();
    const finding = state.search.mode === "find";
    if ((!query && !finding) || (!finding && state.pending) || !state.map) return [];
    // A title that starts with what was typed comes first, then one that
    // contains it, then a match on the part's kind or stage.
    const rank = (node) => {
      if (!query) return 1;
      const title = node.title.toLowerCase();
      if (title.startsWith(query)) return 3;
      if (title.includes(query)) return 2;
      return `${node.type} ${groupLabel(typeOf(node.type)?.group ?? "")}`.toLowerCase().includes(query) ? 1 : 0;
    };
    const found = state.map.nodes
      .map((node, order) => ({ node, order, score: rank(node) }))
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score || a.order - b.order)
      .map((row) => row.node);
    return finding ? found : found.slice(0, 6);
  }

  function searchEntries() {
    const nodes = searchNodes().map((node) => ({ kind: "node", node }));
    if (state.search.mode === "find") return nodes;
    return [...searchMatches().map((part) => ({ kind: "part", part })), ...nodes];
  }

  function chooseEntry(entry) {
    if (!entry) return;
    if (entry.kind === "node") {
      state.search.fromDrop = false;
      closeSearch();
      select({ kind: "node", id: entry.node.id });
      centerOn(entry.node);
      status(`Went to "${entry.node.title}".`);
      return;
    }
    addNode(entry.part.type, state.search.at);
    state.search.fromDrop = false;
    closeSearch();
  }

  function renderSearch({ reveal = false } = {}) {
    if (!el.searchList) return;
    const entries = searchEntries();
    state.search.index = Math.max(0, Math.min(state.search.index, entries.length - 1));
    el.searchList.textContent = "";
    searchRows.length = 0;
    let active = null;
    for (const [index, entry] of entries.entries()) {
      if (entry.kind === "node" && entries[index - 1]?.kind !== "node" && state.search.mode !== "find") {
        const divider = document.createElement("li");
        divider.className = "brains-search-divider";
        divider.setAttribute("role", "presentation");
        divider.textContent = "On this map";
        el.searchList.append(divider);
      }
      const row = document.createElement("li");
      row.id = `brains-search-option-${index}`;
      row.setAttribute("role", "option");
      const spec = entry.kind === "part" ? entry.part : typeOf(entry.node.type);
      row.className = entry.kind === "part" ? "brains-search-row" : "brains-search-row brains-search-goto";
      row.dataset.type = entry.kind === "part" ? entry.part.type : entry.node.type;
      row.dataset.group = spec?.group ?? "control";
      if (index === state.search.index) {
        row.dataset.active = "true";
        row.setAttribute("aria-selected", "true");
        active = row;
      }
      const fits = entry.kind === "part" && (!state.pending || partFits(entry.part));
      if (entry.kind === "part" && !fits) row.dataset.fits = "false";
      const name = document.createElement("b");
      if (spec?.glyph) name.append(glyph(spec.glyph, "glyph brains-part-glyph"));
      const label = document.createElement("span");
      label.textContent = entry.kind === "part" ? entry.part.label : entry.node.title;
      name.append(label);
      const group = document.createElement("span");
      group.className = "brains-search-group";
      group.textContent = entry.kind === "node" ? "Go to" : fits ? groupLabel(entry.part.group) : "Will not wire";
      const summary = document.createElement("span");
      summary.className = "brains-search-summary";
      summary.textContent = entry.kind === "part" ? entry.part.summary : `${spec?.label ?? entry.node.type} · already on this map`;
      row.append(name, group, summary);
      row.addEventListener("click", () => chooseEntry(entry));
      // Hover moves the highlight in place: rebuilding the list under the
      // pointer could swallow the click that follows.
      row.addEventListener("pointermove", () => {
        if (state.search.index === index) return;
        state.search.index = index;
        for (const item of searchRows) {
          const on = item === row;
          if (on) item.dataset.active = "true"; else delete item.dataset.active;
          item.setAttribute("aria-selected", String(on));
        }
        el.searchInput?.setAttribute("aria-activedescendant", row.id);
      });
      el.searchList.append(row);
      searchRows.push(row);
    }
    if (active) {
      el.searchInput?.setAttribute("aria-activedescendant", active.id);
      if (reveal) active.scrollIntoView?.({ block: "nearest" });
    } else {
      el.searchInput?.removeAttribute("aria-activedescendant");
    }
    if (!entries.length) {
      const empty = document.createElement("li");
      empty.className = "brains-empty";
      empty.textContent = `Nothing matches "${state.search.query}".`;
      el.searchList.append(empty);
    }
    if (el.searchHint) {
      el.searchHint.textContent = state.search.mode === "find"
        ? "Enter goes to the highlighted part and selects it. ↑ ↓ to choose, Esc to close."
        : state.pending
          ? "The new part is wired to the end you armed, when its ports allow it. Parts that fit are listed first."
          : "Enter adds the highlighted part where the canvas is looking. ↑ ↓ to choose, Esc to close. Ctrl F finds a part already on the map.";
    }
  }

  // ---- the inspector ---------------------------------------------------------------

  // The inspector is rebuilt after every edit. Rebuilding the same thing keeps
  // its scroll position and puts focus back on the control that had it, so a
  // checkbox ticked halfway down the list does not throw the owner to the top.
  let inspected = null;
  function renderInspector() {
    if (!el.inspector) return;
    const group = state.selection?.kind === "node" && state.picked.size > 1;
    const key = group ? `group:${[...state.picked].sort().join(",")}` : state.selection ? `${state.selection.kind}:${state.selection.id}` : `map:${state.map?.id ?? ""}`;
    const same = key === inspected;
    const scroll = same ? el.inspector.scrollTop : 0;
    const active = typeof document !== "undefined" ? document.activeElement : null;
    const focusKey = same && active && el.inspector.contains?.(active) ? active.dataset?.fkey ?? null : null;
    inspected = key;
    el.inspector.textContent = "";
    if (!state.map) {
      el.inspector.append(note("Brain maps live in the desktop app."));
      return;
    }
    if (group) renderGroupInspector();
    else if (state.selection?.kind === "node") renderNodeInspector(nodeById(state.selection.id));
    else if (state.selection?.kind === "edge") renderEdgeInspector(state.map.edges.find((edge) => edge.id === state.selection.id));
    else renderMapInspector();
    el.inspector.scrollTop = scroll;
    if (focusKey) [...(el.inspector.querySelectorAll?.("[data-fkey]") ?? [])].find((item) => item.dataset.fkey === focusKey)?.focus?.({ preventScroll: true });
  }

  const note = (text, className = "brains-note") => {
    const element = document.createElement("p");
    element.className = className;
    element.textContent = text;
    return element;
  };

  function field(label, control, help = null) {
    const wrap = document.createElement("label");
    wrap.className = "brains-field";
    const name = document.createElement("span");
    name.className = "brains-field-label";
    name.textContent = label;
    wrap.append(name, control);
    if (help) wrap.append(note(help, "brains-field-help"));
    return wrap;
  }

  function list(title, items, className) {
    const wrap = document.createElement("div");
    wrap.className = "brains-list";
    const heading = document.createElement("h4");
    heading.textContent = title;
    const ul = document.createElement("ul");
    ul.className = className;
    for (const item of items) {
      const li = document.createElement("li");
      li.textContent = item;
      ul.append(li);
    }
    wrap.append(heading, ul);
    return wrap;
  }

  // A collapsible inspector section. Only the owner's own clicks are
  // remembered, so a section that opens itself to show a problem closes again
  // once the problem is gone.
  function section(key, title, { count = null, open = true, tone = "" } = {}) {
    const wrap = document.createElement("details");
    wrap.className = "brains-section";
    wrap.dataset.section = key;
    wrap.open = state.sections.get(key) ?? open;
    const summary = document.createElement("summary");
    summary.dataset.fkey = `section:${key}`;
    const heading = document.createElement("h4");
    heading.textContent = title;
    summary.append(heading);
    if (count !== null) {
      const badge = document.createElement("span");
      badge.className = "brains-count";
      if (tone) badge.dataset.tone = tone;
      badge.textContent = String(count);
      summary.append(badge);
    }
    summary.addEventListener("click", () => state.sections.set(key, !wrap.open));
    wrap.append(summary);
    const body = document.createElement("div");
    body.className = "brains-section-body";
    wrap.append(body);
    return { wrap, body };
  }

  function chip(text, tone = "") {
    const element = document.createElement("span");
    element.className = "brains-chip";
    if (tone) element.dataset.tone = tone;
    element.textContent = text;
    return element;
  }

  function actionButton(label, onClick, { danger = false, title = "", fkey = null } = {}) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `ghost mini${danger ? " danger" : ""}`;
    button.textContent = label;
    if (title) button.title = title;
    if (fkey) button.dataset.fkey = fkey;
    button.addEventListener("click", onClick);
    return button;
  }

  function inspectHead(eyebrowText, control, { group = null, runs = null } = {}) {
    const head = document.createElement("div");
    head.className = "brains-inspect-head";
    if (group) head.dataset.group = group;
    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    if (group) {
      const dot = document.createElement("i");
      dot.className = "brains-dot";
      dot.setAttribute("aria-hidden", "true");
      eyebrow.append(dot);
    }
    const text = document.createElement("span");
    text.textContent = eyebrowText;
    eyebrow.append(text);
    if (runs) {
      const badge = document.createElement("span");
      badge.className = "brains-node-badge";
      badge.dataset.runs = runs;
      badge.textContent = RUNS[runs]?.label ?? runs;
      eyebrow.append(badge);
    }
    head.append(eyebrow, control);
    return head;
  }

  const ROLES = [
    ["routine", "Routine — the cheap pass"],
    ["heavy", "Heavy — the reasoning one"],
    ["judge", "Judge — classification questions"],
    ["worker", "Worker — the one that builds"],
  ];

  // Node inspector, in the order an owner uses it: what the part is and
  // whether it has a problem, then the dials it has, then what it may reach
  // and what it is wired to, then the full can / cannot contract.
  function renderNodeInspector(node) {
    if (!node) return;
    const spec = typeOf(node.type);
    const title = document.createElement("input");
    title.type = "text";
    title.className = "brains-title-input";
    title.value = node.title;
    title.dataset.fkey = "title";
    title.setAttribute("aria-label", "Node name");
    title.addEventListener("input", () => {
      checkpoint(`title:${node.id}`);
      node.title = clean(title.value, 60) || (spec?.label ?? node.type);
      // Only the title on the canvas changes; the rest is not rebuilt per key.
      const shown = nodeBoxes.get(node.id)?.querySelector?.(".brains-node-title");
      if (shown) shown.textContent = node.title;
      refreshDirty();
      renderToolbar();
      revalidate();
    });
    el.inspector.append(inspectHead(spec ? groupLabel(spec.group) : "Unknown part", title, { group: spec?.group ?? null, runs: spec?.runs ?? null }));

    if (!spec) {
      el.inspector.append(note(`This map was saved with a "${node.type}" part this build does not have. Delete it, or open the map in the build that made it.`, "brains-note warn"));
      el.inspector.append(dangerRow(node));
      return;
    }

    el.inspector.append(note(spec.summary, "brains-note lead"));
    for (const problem of state.problems.filter((item) => item.nodeId === node.id)) {
      el.inspector.append(note(problem.fix ? `${problem.text} ${problem.fix}` : problem.text, `brains-note problem ${problem.level === "error" ? "warn" : "caution"}`));
    }
    const runs = document.createElement("p");
    runs.className = "brains-runs";
    runs.dataset.runs = spec.runs;
    const switchNote = spec.runs !== "host" ? "" : spec.gate ? " Making the map live moves the switch below." : " Making the map live moves no switch for it.";
    runs.textContent = `${RUNS[spec.runs]?.label ?? spec.runs}: ${RUNS[spec.runs]?.detail ?? ""}${switchNote}`;
    el.inspector.append(runs);
    if (spec.gate && state.catalog?.gates?.[spec.gate]) {
      const gate = state.catalog.gates[spec.gate];
      el.inspector.append(note(`Switch it moves: ${gate.label} — ${gate.detail}`, "brains-note gate"));
    }

    // Its own settings.
    if (spec.settings?.length) {
      const settings = section("settings", "Settings", { count: spec.settings.length });
      for (const setting of spec.settings) settings.body.append(settingControl(node, setting));
      el.inspector.append(settings.wrap);
    }

    // The model this node uses.
    if (spec.model) {
      const model = section("model", "Model", { count: node.model.mode === "pinned" && node.model.model ? node.model.model : node.model.mode === "role" ? node.model.role : "routing" });
      const mode = document.createElement("select");
      mode.dataset.fkey = "model-mode";
      for (const [value, label] of [["inherit", "Follow Studio's routing"], ["role", "Pick the role it asks for"], ["pinned", "Always this model"]]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        if (node.model.mode === value) option.selected = true;
        mode.append(option);
      }
      mode.addEventListener("change", () => {
        checkpoint();
        node.model.mode = mode.value;
        if (mode.value !== "pinned") node.model.model = null;
        touch("Model choice changed.");
      });
      model.body.append(field("How it is chosen", mode, "Routing normally compares candidates per task. Pinning one takes that decision away from Jev for this node."));
      const role = document.createElement("select");
      role.dataset.fkey = "model-role";
      for (const [value, label] of ROLES) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        if (node.model.role === value) option.selected = true;
        role.append(option);
      }
      role.disabled = node.model.mode === "inherit";
      role.addEventListener("change", () => { checkpoint(); node.model.role = role.value; touch("Model role changed."); });
      model.body.append(field("Role", role, role.disabled ? "Studio's routing decides while this follows it." : "Which kind of model this part asks routing for."));
      if (node.model.mode === "pinned") {
        const pinned = document.createElement("input");
        pinned.type = "text";
        pinned.dataset.fkey = "model-pinned";
        pinned.value = node.model.model ?? "";
        pinned.placeholder = "model id, e.g. glm-5.3";
        pinned.addEventListener("input", () => { checkpoint(`model:${node.id}`); node.model.model = clean(pinned.value, 160) || null; touchQuiet(); });
        model.body.append(field("Model", pinned, "The id as the Model catalog lists it. An id your providers do not have falls back to your saved default."));
      }
      el.inspector.append(model.wrap);
    }

    // Permissions, and whether this map actually grants them.
    const missing = spec.permissions.filter((key) => !state.map.grants.includes(key));
    const perms = section("permissions", "Reach it needs", {
      count: spec.permissions.length ? `${spec.permissions.length - missing.length}/${spec.permissions.length}` : 0,
      tone: missing.length ? "error" : "",
      open: true,
    });
    if (!spec.permissions.length) perms.body.append(note("This part needs no reach at all.", "brains-field-help"));
    else perms.body.append(note("Grants belong to the whole map: ticking one here grants it to every part on this map.", "brains-field-help"));
    for (const key of spec.permissions) {
      const info = permission(key);
      const row = document.createElement("label");
      row.className = "brains-permission";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.dataset.fkey = `perm:${key}`;
      box.checked = state.map.grants.includes(key);
      if (!box.checked) row.dataset.problem = "error";
      box.addEventListener("change", () => {
        checkpoint();
        state.map.grants = box.checked
          ? [...new Set([...state.map.grants, key])]
          : state.map.grants.filter((item) => item !== key);
        touch(box.checked ? `Granted ${info.label} on this map.` : `Took ${info.label} away from this map.`);
      });
      const text = document.createElement("span");
      const name = document.createElement("b");
      name.textContent = info.label;
      const detail = document.createElement("small");
      detail.textContent = box.checked ? info.detail : `${info.detail} Not granted on this map — that is an error until it is.`;
      text.append(name, detail);
      row.append(box, text);
      perms.body.append(row);
    }
    el.inspector.append(perms.wrap);

    // What is wired into it, and out of it.
    const wiredCount = state.map.edges.filter((edge) => edge.from.node === node.id || edge.to.node === node.id).length;
    const wires = section("wires", "Wires", { count: wiredCount });
    for (const port of spec.inputs) wires.body.append(wireRow(node, port, "in"));
    for (const port of spec.outputs) wires.body.append(wireRow(node, port, "out"));
    if (!spec.inputs.length && !spec.outputs.length) wires.body.append(note("This part has no ends to wire.", "brains-field-help"));
    el.inspector.append(wires.wrap);

    const does = section("does", "What it can and cannot do");
    does.body.append(list("It can", spec.can, "brains-can"), list("It cannot", spec.cannot, "brains-cannot"));
    if (spec.hostNote) does.body.append(note(spec.hostNote, "brains-note quiet"));
    el.inspector.append(does.wrap);
    el.inspector.append(dangerRow(node));
  }

  // Several parts picked: what they are together, and what can be done to
  // all of them at once.
  function renderGroupInspector() {
    const group = pickedNodes();
    const title = document.createElement("h3");
    title.textContent = `${group.length} parts picked`;
    el.inspector.append(inspectHead("Selection", title));
    const ids = new Set(group.map((node) => node.id));
    const inside = state.map.edges.filter((edge) => ids.has(edge.from.node) && ids.has(edge.to.node)).length;
    const crossing = state.map.edges.filter((edge) => ids.has(edge.from.node) !== ids.has(edge.to.node)).length;
    el.inspector.append(note(`${plural(inside, "wire")} ${inside === 1 ? "runs" : "run"} between them and ${plural(crossing, "wire")} ${crossing === 1 ? "leads" : "lead"} in or out. Drag any of them to move them all; arrow keys nudge them together.`));
    const listing = document.createElement("div");
    listing.className = "brains-actions brains-picked";
    for (const node of group) {
      const link = document.createElement("button");
      link.type = "button";
      link.className = "brains-link";
      link.dataset.group = typeOf(node.type)?.group ?? "control";
      link.textContent = node.title;
      link.title = "Inspect just this part";
      link.addEventListener("click", () => { select({ kind: "node", id: node.id }); centerOn(node); });
      listing.append(link);
    }
    el.inspector.append(listing);
    const row = document.createElement("div");
    row.className = "brains-danger";
    row.append(
      actionButton("Duplicate them", () => duplicateNode(state.selection.id), { title: "Copy these parts and the wires between them (Ctrl D)", fkey: "group-duplicate" }),
      actionButton("Delete them", () => deleteSelection(), { danger: true, title: "Delete these parts and their wires (Delete)" }),
    );
    el.inspector.append(row);
  }

  function wireRow(node, port, dir) {
    const row = document.createElement("div");
    row.className = "brains-wire-row";
    const edges = state.map.edges.filter((edge) => (dir === "in"
      ? edge.to.node === node.id && edge.to.port === port.id
      : edge.from.node === node.id && edge.from.port === port.id));
    const label = document.createElement("span");
    label.className = "brains-wire-port";
    label.textContent = `${dir === "in" ? "←" : "→"} ${port.label} (${port.kinds.join("/")}): `;
    row.append(label);
    if (!edges.length) {
      const none = document.createElement("span");
      none.className = "brains-wire-none";
      none.textContent = port.required ? "nothing wired — this is an error" : "nothing wired";
      row.append(none);
      if (port.required) row.dataset.problem = "error";
      return row;
    }
    for (const edge of edges) {
      const otherId = dir === "in" ? edge.from.node : edge.to.node;
      const link = document.createElement("button");
      link.type = "button";
      link.className = "brains-link";
      link.textContent = nodeById(otherId)?.title ?? "?";
      link.title = "Select that part";
      link.addEventListener("click", () => {
        select({ kind: "node", id: otherId });
        centerOn(nodeById(otherId));
      });
      row.append(link);
    }
    return row;
  }

  function settingControl(node, setting) {
    const value = node.config?.[setting.key];
    const fkey = `setting:${setting.key}`;
    if (setting.type === "boolean") {
      const box = document.createElement("input");
      box.type = "checkbox";
      box.dataset.fkey = fkey;
      box.checked = value !== false;
      box.addEventListener("change", () => { checkpoint(); node.config[setting.key] = box.checked; touch(""); });
      return field(setting.label, box, setting.help);
    }
    if (setting.type === "number") {
      const input = document.createElement("input");
      input.type = "number";
      input.dataset.fkey = fkey;
      input.value = String(value ?? setting.default ?? 0);
      if (setting.min !== undefined) input.min = String(setting.min);
      if (setting.max !== undefined) input.max = String(setting.max);
      input.addEventListener("change", () => {
        checkpoint();
        const next = Number(input.value);
        node.config[setting.key] = Number.isFinite(next) ? Math.max(setting.min ?? 0, Math.min(setting.max ?? 1e6, Math.round(next))) : setting.default;
        input.value = String(node.config[setting.key]);
        touch("");
      });
      return field(setting.label, input, setting.help);
    }
    if (setting.type === "enum") {
      const select = document.createElement("select");
      select.dataset.fkey = fkey;
      for (const option of setting.options) {
        const item = document.createElement("option");
        item.value = option;
        item.textContent = option;
        if (option === value) item.selected = true;
        select.append(item);
      }
      select.addEventListener("change", () => { checkpoint(); node.config[setting.key] = select.value; touch(""); });
      return field(setting.label, select, setting.help);
    }
    if (setting.type === "map") {
      const select = document.createElement("select");
      select.dataset.fkey = fkey;
      const none = document.createElement("option");
      none.value = "";
      none.textContent = "— pick a brain map —";
      select.append(none);
      for (const map of state.maps) {
        if (map.id === state.map.id) continue;
        const item = document.createElement("option");
        item.value = map.id;
        item.textContent = map.name;
        if (map.id === value) item.selected = true;
        select.append(item);
      }
      select.addEventListener("change", () => { checkpoint(); node.config[setting.key] = select.value; touch(""); });
      const wrap = field(setting.label, select, setting.help);
      if (value) wrap.append(actionButton("Open that map", () => void switchTo(value), { fkey: `${fkey}:open` }));
      return wrap;
    }
    if (setting.type === "kinds") {
      const wrap = document.createElement("div");
      wrap.className = "brains-field";
      const name = document.createElement("span");
      name.className = "brains-field-label";
      name.textContent = setting.label;
      wrap.append(name, note(setting.help, "brains-field-help"));
      const chosen = new Set(Array.isArray(value) ? value : []);
      for (const kind of state.catalog?.issueKinds ?? []) {
        const row = document.createElement("label");
        row.className = "brains-permission";
        const box = document.createElement("input");
        box.type = "checkbox";
        box.dataset.fkey = `${fkey}:${kind.kind}`;
        box.checked = chosen.has(kind.kind);
        box.disabled = kind.alwaysAsk || !kind.autoAnswerable;
        box.addEventListener("change", () => {
          checkpoint();
          const next = new Set(Array.isArray(node.config[setting.key]) ? node.config[setting.key] : []);
          if (box.checked) next.add(kind.kind); else next.delete(kind.kind);
          node.config[setting.key] = [...next];
          touch("");
        });
        const text = document.createElement("span");
        const label = document.createElement("b");
        label.textContent = kind.label;
        const detail = document.createElement("small");
        detail.textContent = kind.alwaysAsk ? "Always yours to answer — this can never be automated."
          : kind.autoAnswerable ? "The assistant may settle this one inside the retry budget."
          : "Always asked: there is no safe automatic answer.";
        text.append(label, detail);
        row.append(box, text);
        wrap.append(row);
      }
      return wrap;
    }
    const input = document.createElement("input");
    input.type = "text";
    input.dataset.fkey = fkey;
    input.value = String(value ?? "");
    input.addEventListener("input", () => {
      checkpoint(`setting:${node.id}:${setting.key}`);
      node.config[setting.key] = clean(input.value, 400);
      touchQuiet();
    });
    return field(setting.label, input, setting.help);
  }

  function dangerRow(node) {
    const row = document.createElement("div");
    row.className = "brains-danger";
    if (typeOf(node.type)) row.append(actionButton("Duplicate", () => duplicateNode(node.id), { title: "Copy this part next to it (Ctrl D)" }));
    row.append(actionButton("Delete this part", () => { select({ kind: "node", id: node.id }); deleteSelection(); }, { danger: true, title: "Delete this part and its wires (Delete)" }));
    return row;
  }

  function renderEdgeInspector(edge) {
    if (!edge) return;
    const from = nodeById(edge.from.node);
    const to = nodeById(edge.to.node);
    const title = document.createElement("h3");
    title.textContent = `${from?.title ?? edge.from.node} → ${to?.title ?? edge.to.node}`;
    el.inspector.append(inspectHead(edge.feedback ? "Feedback wire" : "Wire", title, { group: typeOf(from?.type)?.group ?? null }));
    const output = typeOf(from?.type)?.outputs.find((item) => item.id === edge.from.port);
    const input = typeOf(to?.type)?.inputs.find((item) => item.id === edge.to.port);
    el.inspector.append(note(`Out of ${edge.from.port}, into ${edge.to.port}.`));
    if (output && input) {
      const shared = output.kinds.filter((kind) => input.kinds.includes(kind) || input.kinds.includes("any"));
      el.inspector.append(note(`It carries ${(shared.length ? shared : output.kinds).map(kindLabel).join(", ")}: ${output.label} on "${from.title}" into ${input.label} on "${to.title}".`, "brains-note quiet"));
    }
    for (const problem of state.problems.filter((item) => item.edgeId === edge.id)) {
      el.inspector.append(note(problem.fix ? `${problem.text} ${problem.fix}` : problem.text, `brains-note problem ${problem.level === "error" ? "warn" : "caution"}`));
    }
    const ends = document.createElement("div");
    ends.className = "brains-actions";
    if (from) ends.append(actionButton(`Go to ${from.title}`, () => { select({ kind: "node", id: from.id }); centerOn(from); }));
    if (to) ends.append(actionButton(`Go to ${to.title}`, () => { select({ kind: "node", id: to.id }); centerOn(to); }));
    el.inspector.append(ends);
    const feedback = document.createElement("input");
    feedback.type = "checkbox";
    feedback.dataset.fkey = "feedback";
    feedback.checked = edge.feedback === true;
    feedback.addEventListener("change", () => {
      checkpoint();
      if (feedback.checked) edge.feedback = true; else delete edge.feedback;
      touch(feedback.checked ? "This wire now carries into the next pass." : "This wire runs in order again.");
    });
    el.inspector.append(field("Feedback wire", feedback, "A feedback wire closes a loop: what it carries lands on the next pass instead of making the map impossible to order."));
    const row = document.createElement("div");
    row.className = "brains-danger";
    row.append(actionButton("Delete this wire", () => deleteSelection(), { danger: true, title: "Delete this wire (Delete)" }));
    el.inspector.append(row);
  }

  function requiredGrants() {
    const keys = new Set();
    for (const node of state.map?.nodes ?? []) for (const key of typeOf(node.type)?.permissions ?? []) keys.add(key);
    return keys;
  }

  // With nothing selected the inspector describes the map: what it is, what
  // making it live would move, then the reach it grants.
  function renderMapInspector() {
    const name = document.createElement("input");
    name.type = "text";
    name.className = "brains-title-input";
    name.dataset.fkey = "map-name";
    name.value = state.map.name;
    name.setAttribute("aria-label", "Map name");
    name.addEventListener("input", () => { checkpoint("map-name"); state.map.name = clean(name.value, 80) || "Untitled brain"; refreshDirty(); renderToolbar(); });
    el.inspector.append(inspectHead(state.draft ? "Draft — not saved yet" : state.map.builtIn ? "Shipped pipeline" : "Brain map", name));

    const description = document.createElement("textarea");
    description.rows = 2;
    description.dataset.fkey = "map-description";
    description.value = state.map.description ?? "";
    description.placeholder = "What this brain is for";
    description.addEventListener("input", () => { checkpoint("map-description"); state.map.description = clean(description.value, 240) || null; refreshDirty(); renderToolbar(); });
    el.inspector.append(field("Description", description));

    const stats = document.createElement("div");
    stats.className = "brains-chips";
    const live = state.map.id === state.activeId;
    stats.append(
      chip(plural(state.map.nodes.length, "part")),
      chip(plural(state.map.edges.length, "wire")),
      chip(`${state.compiled?.feedback?.length ?? 0} feedback`),
      chip(live ? "Live" : state.draft ? "Draft" : "Not live", live ? "live" : ""),
    );
    el.inspector.append(stats);
    el.inspector.append(note("Select a part or a wire to see what it may do. Press Space on the canvas to search the parts, or to jump to one already here."));

    if (state.compiled?.gates) {
      const entries = Object.entries(state.catalog?.gates ?? {});
      const set = entries.filter(([key]) => state.compiled.gates[key] !== null && state.compiled.gates[key] !== undefined).length;
      const gates = section("gates", live ? "What this map holds" : "What going live would move", { count: `${set}/${entries.length}` });
      for (const [key, gate] of entries) {
        const value = state.compiled.gates[key];
        const row = document.createElement("div");
        row.className = "brains-gate-row";
        const label = document.createElement("b");
        label.textContent = gate.label;
        const unset = value === null || value === undefined;
        row.append(label, chip(unset ? "left alone" : describeGate(value), unset ? "" : value === false ? "off" : "on"));
        row.append(note(unset ? "This map says nothing, so it is left alone." : gate.detail, "brains-field-help"));
        row.title = unset ? `${gate.label}: this map says nothing, so it is left alone.` : `${gate.label}: ${describeGate(value)}. ${gate.detail}`;
        gates.body.append(row);
      }
      el.inspector.append(gates.wrap);
    }

    const needed = requiredGrants();
    const granted = state.map.grants.filter((key) => (state.catalog?.permissions ?? []).some((item) => item.key === key));
    const lacking = [...needed].filter((key) => !state.map.grants.includes(key));
    const unused = granted.filter((key) => !needed.has(key));
    const grants = section("grants", "What this map grants", {
      count: `${granted.length}/${state.catalog?.permissions?.length ?? 0}`,
      tone: lacking.length ? "error" : "",
      // Open by itself only when something needs the owner's attention.
      open: lacking.length > 0 || unused.length > 0,
    });
    grants.body.append(note(lacking.length
      ? `${plural(lacking.length, "permission")} the parts need ${lacking.length === 1 ? "is" : "are"} not granted. A part that needs reach this map does not grant is an error, not a quiet widening.`
      : unused.length ? `Every part has the reach it needs, and ${unused.length === 1 ? "1 grant is" : `${unused.length} grants are`} used by no part.` : "Every part has exactly the reach it needs.", "brains-field-help"));
    if (lacking.length || unused.length) {
      const fixes = document.createElement("div");
      fixes.className = "brains-actions";
      if (lacking.length) {
        fixes.append(actionButton(`Grant what is needed (${lacking.length})`, () => {
          checkpoint();
          state.map.grants = [...new Set([...state.map.grants, ...lacking])];
          touch(`Granted ${lacking.map((key) => permission(key).label).join(", ")}.`);
        }, { fkey: "grant-fix" }));
      }
      if (unused.length) {
        fixes.append(actionButton(`Drop what no part uses (${unused.length})`, () => {
          checkpoint();
          state.map.grants = state.map.grants.filter((key) => needed.has(key));
          touch(`Took away ${unused.map((key) => permission(key).label).join(", ")}.`);
        }, { fkey: "grant-drop" }));
      }
      grants.body.append(fixes);
    }
    for (const item of state.catalog?.permissions ?? []) {
      const isNeeded = needed.has(item.key);
      const row = document.createElement("label");
      row.className = "brains-permission";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.dataset.fkey = `grant:${item.key}`;
      box.checked = state.map.grants.includes(item.key);
      if (isNeeded && !box.checked) row.dataset.problem = "error";
      else if (!isNeeded && box.checked) row.dataset.unused = "true";
      box.addEventListener("change", () => {
        checkpoint();
        state.map.grants = box.checked ? [...new Set([...state.map.grants, item.key])] : state.map.grants.filter((key) => key !== item.key);
        touch("");
      });
      const text = document.createElement("span");
      const label = document.createElement("b");
      label.textContent = item.label;
      if (isNeeded || box.checked) label.append(chip(isNeeded ? "needed" : "unused", isNeeded && !box.checked ? "off" : isNeeded ? "on" : ""));
      const detail = document.createElement("small");
      detail.textContent = item.detail;
      text.append(label, detail);
      row.append(box, text);
      grants.body.append(row);
    }
    el.inspector.append(grants.wrap);

    if (state.map.builtIn) {
      const row = document.createElement("div");
      row.className = "brains-danger";
      row.append(actionButton("Reset to the shipped pipeline", () => void resetMap()));
      el.inspector.append(row);
    }
  }

  // ---- problems, toolbar, status ------------------------------------------------

  function renderProblems() {
    if (!el.problems) return;
    el.problems.textContent = "";
    const errors = state.problems.filter((item) => item.level === "error");
    const warnings = state.problems.filter((item) => item.level === "warn");
    if (!state.problems.length) {
      const live = Boolean(state.map) && state.map.id === state.activeId;
      el.problems.append(note(state.map ? (live ? "No problems. This is the live pipeline." : "No problems. This map can go live.") : "", "brains-problem ok"));
      return;
    }
    const count = document.createElement("span");
    count.className = "brains-problem-count";
    count.dataset.level = errors.length ? "error" : "warn";
    count.textContent = [errors.length ? plural(errors.length, "error") : "", warnings.length ? plural(warnings.length, "warning") : ""].filter(Boolean).join(" · ");
    el.problems.append(count);
    el.problems.dataset.expanded = String(Boolean(state.problemsExpanded));
    // The toggle comes straight after the count, so it is never scrolled
    // out of the short status bar.
    if (state.problems.length > 8) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "brains-problem brains-problem-more";
      more.textContent = state.problemsExpanded ? "Show fewer" : `Show all ${state.problems.length}`;
      more.setAttribute("aria-expanded", String(Boolean(state.problemsExpanded)));
      more.addEventListener("click", () => {
        state.problemsExpanded = !state.problemsExpanded;
        renderProblems();
      });
      el.problems.append(more);
    }
    const shown = state.problemsExpanded ? state.problems.length : 8;
    for (const problem of [...errors, ...warnings].slice(0, shown)) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "brains-problem";
      row.dataset.level = problem.level;
      row.textContent = problem.fix ? `${problem.text} ${problem.fix}` : problem.text;
      if (problem.nodeId || problem.edgeId) row.title = "Show it on the canvas";
      row.addEventListener("click", () => {
        if (problem.nodeId) select({ kind: "node", id: problem.nodeId });
        else if (problem.edgeId) select({ kind: "edge", id: problem.edgeId });
        scrollTo(problem.nodeId ?? state.map?.edges.find((edge) => edge.id === problem.edgeId)?.from.node);
      });
      el.problems.append(row);
    }
  }

  // F8 and Shift F8 walk through the problems that belong to a part or a
  // wire, selecting each and bringing it into view.
  function stepProblem(direction) {
    const ordered = [...state.problems.filter((item) => item.level === "error"), ...state.problems.filter((item) => item.level === "warn")];
    const placed = ordered.filter((item) => item.nodeId || item.edgeId);
    if (!placed.length) {
      status(state.problems.length ? "The problems left are about the whole map, not one part." : "No problems to walk through.");
      return;
    }
    state.problemCursor = (((state.problemCursor ?? -1) + direction) % placed.length + placed.length) % placed.length;
    const problem = placed[state.problemCursor];
    if (problem.nodeId) select({ kind: "node", id: problem.nodeId });
    else select({ kind: "edge", id: problem.edgeId });
    scrollTo(problem.nodeId ?? state.map?.edges.find((edge) => edge.id === problem.edgeId)?.from.node);
    status(`Problem ${state.problemCursor + 1} of ${placed.length}: ${problem.text}`, problem.level === "error" ? "warn" : "");
  }

  function scrollTo(nodeId) {
    const node = nodeById(nodeId);
    if (!node) return;
    if (!el.stage) {
      el.canvasWrap?.scrollTo?.({ left: Math.max(0, node.x - 200), top: Math.max(0, node.y - 160), behavior: "smooth" });
      return;
    }
    centerOn(node);
  }

  function renderToolbar() {
    if (el.switcher) {
      el.switcher.textContent = "";
      for (const map of state.maps) {
        const option = document.createElement("option");
        option.value = map.id;
        option.textContent = `${map.name}${map.id === state.activeId ? " · live" : ""}${map.ok ? "" : ` · ${map.errors} problem${map.errors === 1 ? "" : "s"}`}`;
        if (state.map && map.id === state.map.id) option.selected = true;
        el.switcher.append(option);
      }
      if (state.draft && state.map) {
        const option = document.createElement("option");
        option.value = state.map.id;
        option.textContent = `${state.map.name} · ${state.draft.local ? "new, not saved" : "draft"}`;
        option.selected = true;
        el.switcher.append(option);
      }
    }
    const live = Boolean(state.map) && state.map.id === state.activeId;
    const errors = state.problems.filter((item) => item.level === "error").length;
    const empty = Boolean(state.map) && !state.map.nodes.length;
    if (el.save) {
      el.save.disabled = state.busy || !state.map || !state.dirty || empty;
      el.save.textContent = state.map && !state.dirty ? "Saved" : "Save";
      el.save.title = empty ? "Add a part first: the studio does not keep an empty map." : "Save this map (Ctrl S)";
      // The one thing to do next is the primary button: Save while there are
      // edits, Make this live once there are none.
      el.save.classList.toggle("primary", state.dirty && !empty);
    }
    if (el.activate) {
      el.activate.disabled = state.busy || !state.map || live || errors > 0;
      // The pill beside the map name says a map is live; the button only
      // appears when there is something to make live.
      el.activate.hidden = live;
      el.activate.textContent = live ? "This map is live" : "Make this live";
      el.activate.dataset.live = String(live);
      el.activate.classList.toggle("primary", !state.dirty);
      el.activate.title = live ? "The studio follows this map now."
        : errors ? `Fix ${plural(errors, "problem")} before this map can go live.`
        : state.dirty ? "Saves this map, then shows every switch it would move before anything changes."
        : "Make this the pipeline the studio follows. You see every switch it moves first.";
    }
    // Deleting the live map would make another one live without showing the
    // switches it moves, so another map has to go live first.
    if (el.deleteMap) {
      el.deleteMap.disabled = state.busy || !state.map || state.map.builtIn || Boolean(state.draft) || live;
      el.deleteMap.title = live ? "This map is live. Make another map live first." : state.map?.builtIn ? "The shipped pipeline cannot be deleted. Reset it instead." : "Delete this map";
    }
    // A draft or a new map has never been saved: duplicating it would save
    // only the copy and lose the original, so it is saved first instead.
    if (el.duplicate) {
      el.duplicate.disabled = state.busy || !state.map || Boolean(state.draft);
      el.duplicate.title = state.draft ? "Save this map first; then it can be copied." : "Copy this map, wires and all";
    }
    if (el.discard) el.discard.disabled = state.busy || !state.dirty;
    // While the host is answering, nothing else that talks to it can start.
    for (const button of [el.newMap, el.reset, el.draft, el.emptyDraft]) if (button) button.disabled = state.busy;
    if (el.reset) el.reset.hidden = !state.map?.builtIn;
    if (el.undo) el.undo.disabled = !history.past.length;
    if (el.redo) el.redo.disabled = !history.future.length;
    if (el.tidy) el.tidy.disabled = !state.map || state.map.nodes.length < 2;
    if (el.dirty) el.dirty.hidden = !state.dirty;
    if (el.liveTag) {
      el.liveTag.hidden = !live;
      el.liveTag.textContent = live ? "Live pipeline" : "";
    }
    renderBanner();
  }

  function renderBanner() {
    if (!el.banner) return;
    el.banner.hidden = !state.draft;
    if (!state.draft) return;
    const empty = !state.map?.nodes.length;
    if (el.bannerText) {
      el.bannerText.textContent = state.draft.local
        ? (empty ? "A new map, not saved yet. It is kept once it has a part." : "A new map, not saved yet.")
        : `Drafted${state.draft.model ? ` by ${state.draft.model}` : ""}. Nothing is saved yet — check the wiring, then save it as a new map.`;
    }
    if (el.bannerSave) {
      el.bannerSave.disabled = state.busy || empty;
      el.bannerSave.textContent = state.draft.local ? "Save it" : "Save as a new map";
    }
    if (el.bannerDiscard) el.bannerDiscard.textContent = state.draft.local ? "Discard" : "Discard draft";
  }

  function status(text, tone = "") {
    if (!el.status) return;
    el.status.textContent = text;
    el.status.dataset.tone = tone;
  }

  function renderAll() {
    renderParts();
    renderCanvas();
    renderInspector();
    renderProblems();
    renderToolbar();
  }

  // ---- the in-sheet dialog ------------------------------------------------------
  // window.prompt does not exist in Electron, and a native confirm cannot show
  // the list of switches a map moves, so every question the editor asks is a
  // panel inside the sheet. Resolves null when dismissed, or { action, value }.

  function ask(options) {
    const { title, input = null } = options;
    if (!el.dialog) {
      // No dialog in this document (a test harness): the plain browser prompts.
      if (input) {
        const value = window.prompt?.(title, input.value ?? "");
        if (value === null || value === undefined) return Promise.resolve(null);
        return (async () => {
          const error = options.submit ? await options.submit(String(value)) : null;
          if (error) { status(error, "warn"); return null; }
          return { action: "ok", value: String(value) };
        })();
      }
      return Promise.resolve(window.confirm?.(options.plain ?? title) ? { action: "ok", value: null } : null);
    }
    if (dialogState) finishDialog(null);
    return new Promise((resolve) => buildDialog(options, resolve));
  }

  function buildDialog(options, resolve) {
    const {
      eyebrow = "", title, body = null, input = null, examples = [], ok = "OK", cancel = "Cancel",
      danger = false, extra = null, submit = null, busyText = "Working…",
    } = options;
    const returnFocus = typeof document !== "undefined" ? document.activeElement : null;
    el.dialog.textContent = "";
    const panel = document.createElement("form");
    panel.className = "brains-dialog-panel";
    panel.setAttribute("role", "alertdialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "brains-dialog-title");
    panel.noValidate = true;
    panel.tabIndex = -1;
    if (eyebrow) panel.append(note(eyebrow, "eyebrow"));
    const heading = document.createElement("h3");
    heading.id = "brains-dialog-title";
    heading.textContent = title;
    panel.append(heading);
    if (typeof body === "string") panel.append(note(body, "brains-dialog-body"));
    else if (body) {
      body.classList?.add("brains-dialog-body");
      panel.append(body);
    }
    let control = null;
    if (input) {
      control = document.createElement(input.multiline ? "textarea" : "input");
      if (!input.multiline) control.type = "text";
      else control.rows = 4;
      control.className = "brains-dialog-input";
      control.value = input.value ?? "";
      control.placeholder = input.placeholder ?? "";
      control.setAttribute("aria-label", input.label ?? title);
      if (input.max) control.maxLength = input.max;
      panel.append(control);
      if (examples.length) {
        const row = document.createElement("div");
        row.className = "brains-dialog-examples";
        for (const text of examples) {
          const example = document.createElement("button");
          example.type = "button";
          example.className = "brains-chip brains-example";
          example.textContent = text;
          example.addEventListener("click", () => { control.value = text; control.focus(); });
          row.append(example);
        }
        panel.append(row);
      }
    }
    const error = note("", "brains-dialog-error");
    error.setAttribute("role", "alert");
    error.hidden = true;
    panel.append(error);
    const actions = document.createElement("div");
    actions.className = "brains-dialog-actions";
    const cancelButton = actionButton(cancel, () => finishDialog(null));
    actions.append(cancelButton);
    let extraButton = null;
    if (extra) {
      extraButton = actionButton(extra.label, () => finishDialog({ action: extra.action, value: control?.value ?? null }), { danger: extra.danger === true });
      actions.append(extraButton);
    }
    const okButton = document.createElement("button");
    okButton.type = "submit";
    okButton.className = `mini primary${danger ? " danger" : ""}`;
    okButton.textContent = ok;
    actions.append(okButton);
    panel.append(actions);

    const setBusy = (busy) => {
      for (const button of [okButton, cancelButton, extraButton]) if (button) button.disabled = busy;
      if (control) control.disabled = busy;
      panel.dataset.busy = String(busy);
      okButton.textContent = busy ? busyText : ok;
    };
    panel.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (panel.dataset.busy === "true") return;
      const value = control ? control.value.trim() : null;
      if (control && !value) {
        error.textContent = input?.required ?? "This needs an answer.";
        error.hidden = false;
        control.focus();
        return;
      }
      if (submit) {
        setBusy(true);
        let problem = null;
        try { problem = await submit(value); } catch (failure) { problem = failure?.message ?? String(failure); }
        if (dialogState?.panel !== panel) return;
        setBusy(false);
        if (problem) {
          error.textContent = problem;
          error.hidden = false;
          control?.focus();
          return;
        }
      }
      finishDialog({ action: "ok", value });
    });
    el.dialog.append(panel);
    el.dialog.hidden = false;
    dialogState = { resolve, panel, returnFocus, danger };
    (control ?? (danger ? cancelButton : okButton)).focus();
    if (control?.select && !input?.multiline) control.select();
  }

  function finishDialog(result, { force = false } = {}) {
    if (!dialogState) return;
    const { resolve, returnFocus } = dialogState;
    if (!force && dialogState.panel?.dataset.busy === "true" && result === null) return;
    dialogState = null;
    el.dialog.hidden = true;
    el.dialog.textContent = "";
    // A dialog opened from the Map menu cannot hand focus back to the menu
    // item (the menu is closed by then): the Map button takes it instead.
    const visible = returnFocus?.isConnected && returnFocus.getClientRects?.().length > 0;
    const back = visible ? returnFocus : returnFocus?.closest?.(".brains-menu") ? el.more : el.canvasWrap;
    back?.focus?.({ preventScroll: true });
    resolve(result);
  }

  function dialogKeys(event) {
    const behind = dialogState?.panel && typeof dialogState.panel.contains === "function" && event.target && !dialogState.panel.contains(event.target);
    if (behind && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      finishDialog(null);
      return;
    }
    // Enter answers from a one-line field, Ctrl Enter from the text box. The
    // editor listens in the capture phase, so the browser's own implicit
    // submit never sees the key; the dialog submits for itself.
    const field = event.target?.closest?.("input, textarea");
    if (event.key === "Enter" && field && ((field.tagName === "INPUT" && !event.shiftKey) || event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      event.stopPropagation();
      dialogState?.panel?.requestSubmit?.();
      return;
    }
    if (event.key === "Tab" && dialogState?.panel) {
      // Keep Tab inside the panel while it is open, even when focus has
      // wandered to its text or everything in it is disabled while busy.
      const panel = dialogState.panel;
      const focusable = [...panel.querySelectorAll("button, input, textarea, select")].filter((item) => !item.disabled);
      const active = document.activeElement;
      if (!focusable.length) {
        event.preventDefault();
        panel.focus();
      } else if (active === panel || !panel.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? focusable[focusable.length - 1] : focusable[0]).focus();
      } else if (event.shiftKey && active === focusable[0]) {
        event.preventDefault();
        focusable[focusable.length - 1].focus();
      } else if (!event.shiftKey && active === focusable[focusable.length - 1]) {
        event.preventDefault();
        focusable[0].focus();
      }
    }
    event.stopPropagation();
  }

  // ---- the map menu --------------------------------------------------------------

  function setMenu(open) {
    if (!el.menu || !el.more) return;
    el.menu.hidden = !open;
    el.more.setAttribute("aria-expanded", String(open));
    if (open && typeof el.menu.getBoundingClientRect === "function") {
      // Right-aligned under the button unless that would cross the sheet's
      // left edge (a wrapped toolbar), then left-aligned.
      el.menu.style.left = "";
      el.menu.style.right = "";
      const sheet = el.overlay.querySelector?.(".brains-sheet")?.getBoundingClientRect?.();
      const menu = el.menu.getBoundingClientRect();
      if (sheet && menu.left < sheet.left + 8) {
        el.menu.style.left = "0";
        el.menu.style.right = "auto";
      }
    }
    if (open) [...el.menu.querySelectorAll("button")].find((item) => !item.disabled && !item.hidden)?.focus();
  }

  function menuKeys(event) {
    const items = [...el.menu.querySelectorAll("button")].filter((item) => !item.disabled && !item.hidden);
    const index = items.indexOf(document.activeElement);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setMenu(false);
      el.more.focus();
      return true;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      const next = items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length];
      next?.focus();
      return true;
    }
    if (event.key === "Tab") setMenu(false);
    return false;
  }

  // ---- layout: the two side panels ------------------------------------------------

  function loadLayout() {
    const saved = readJson(LAYOUT_KEY);
    if (saved && typeof saved === "object") {
      state.layout.parts = saved.parts !== false;
      state.layout.inspector = saved.inspector !== false;
      state.layout.collapsed = Array.isArray(saved.collapsed) ? saved.collapsed.filter((item) => typeof item === "string").slice(0, 20) : [];
    }
  }

  function saveLayout() {
    writeJson(LAYOUT_KEY, state.layout);
  }

  function applyLayout() {
    if (el.body) {
      el.body.dataset.parts = state.layout.parts ? "shown" : "hidden";
      el.body.dataset.inspector = state.layout.inspector ? "shown" : "hidden";
    }
    for (const [button, open, what] of [[el.toggleParts, state.layout.parts, "parts"], [el.toggleInspector, state.layout.inspector, "inspector"]]) {
      if (!button) continue;
      button.setAttribute("aria-expanded", String(open));
      button.title = `${open ? "Hide" : "Show"} the ${what} (${what === "parts" ? "[" : "]"})`;
    }
    frame(() => renderMinimapView());
  }

  function togglePanel(which) {
    const toggle = which === "parts" ? el.toggleParts : el.toggleInspector;
    if (toggle && typeof getComputedStyle === "function" && getComputedStyle(toggle).display === "none") {
      const notice = `The ${which === "parts" ? "parts rail" : "inspector"} does not fit at this width. Space still searches the parts.`;
      status(notice);
      window.MefiToast?.(notice, "info");
      return;
    }
    state.layout[which] = !state.layout[which];
    saveLayout();
    applyLayout();
  }

  // ---- host actions -------------------------------------------------------------

  async function save() {
    const api = bridge();
    if (!api?.brainsSave || !state.map || state.busy) return false;
    if (!state.map.nodes.length) {
      status("Add a part first: the studio does not keep an empty map.", "warn");
      return false;
    }
    state.busy = true;
    renderToolbar();
    const sent = JSON.stringify(state.map);
    try {
      const result = await api.brainsSave(state.map);
      if (!result?.ok) { status(result?.error ?? "That map could not be saved.", "warn"); return false; }
      const wasDraft = Boolean(state.draft);
      // Edits made while the save was on its way stay on the canvas, and
      // stay marked unsaved; only an untouched map takes the host's copy. The
      // baseline is what was sent, so undoing those edits reads as saved.
      const adopt = JSON.stringify(state.map) === sent;
      savedSnapshot = adopt ? JSON.stringify(result.map) : sent;
      if (adopt) {
        state.map = result.map;
        state.compiled = result.compiled ?? null;
        state.problems = result.compiled?.problems ?? [];
      }
      refreshDirty();
      state.draft = null;
      const list = await api.brainsState();
      state.maps = list?.maps ?? state.maps;
      state.activeId = list?.activeId ?? state.activeId;
      const savedName = result.map?.name ?? state.map.name;
      status(`${wasDraft ? `Saved the draft as "${savedName}".` : `Saved "${savedName}".`}${state.dirty ? " Edits made since are not saved yet." : ""}`);
      return true;
    } catch (error) {
      status(`Could not save: ${error.message}`, "warn");
      return false;
    } finally {
      state.busy = false;
      renderAll();
    }
  }

  const describeGate = (value) => (value === true ? "on" : value === false ? "off" : value === null || value === undefined ? "untouched" : String(value));

  function movesList(moves) {
    const wrap = document.createElement("div");
    const listing = document.createElement("ul");
    listing.className = "brains-moves";
    if (!moves.length) {
      const li = document.createElement("li");
      li.textContent = "Nothing — the switches already match this map.";
      listing.append(li);
    }
    for (const move of moves) {
      const li = document.createElement("li");
      const label = document.createElement("b");
      label.textContent = move.label;
      const change = document.createElement("span");
      change.className = "brains-move";
      const arrow = document.createElement("span");
      arrow.setAttribute("aria-label", "to");
      arrow.textContent = "→";
      change.append(chip(describeGate(move.from)), arrow, chip(describeGate(move.to), move.to === false ? "off" : "on"));
      li.append(label, change);
      if (move.detail) li.append(note(move.detail, "brains-field-help"));
      listing.append(li);
    }
    wrap.append(listing, note("The decision rules in it apply to the next issue an agent raises.", "brains-field-help"));
    return wrap;
  }

  // Activating moves real switches, so the owner sees the list first and says
  // yes to it. Nothing about a map is applied behind their back.
  async function activate() {
    const api = bridge();
    if (!api?.brainsActivate || !state.map || state.busy) return;
    if (state.dirty && !(await save())) return;
    // Going live applies the saved map. If edits landed while it was saving,
    // the screen and the saved map differ, and that is not what gets applied.
    if (state.dirty) {
      status("Edits arrived while saving. Save again, then make it live.", "warn");
      return;
    }
    let plan = null;
    try { plan = await api.brainsGatePlan(state.map.id); } catch { plan = null; }
    const moves = plan?.moves ?? [];
    const summary = moves.length
      ? moves.map((move) => `• ${move.label}: ${describeGate(move.from)} → ${describeGate(move.to)}`).join("\n")
      : "• nothing — the switches already match this map";
    const answer = await ask({
      eyebrow: "Make this live",
      title: `Make "${state.map.name}" the live pipeline?`,
      plain: `Make "${state.map.name}" the live pipeline?\n\nThis moves:\n${summary}\n\nThe decision rules in it apply to the next issue an agent raises.`,
      body: movesList(moves),
      ok: moves.length === 1 ? "Make it live · move 1 switch" : moves.length ? `Make it live · move ${moves.length} switches` : "Make it live",
    });
    if (!answer) { status("Left the live pipeline as it was."); return; }
    state.busy = true;
    renderToolbar();
    try {
      const result = await api.brainsActivate(state.map.id, { applyGates: true });
      if (!result?.ok) { status(result?.error ?? "That map could not go live.", "warn"); return; }
      state.activeId = state.map.id;
      status(result.moved?.length ? `"${state.map.name}" is live · moved ${result.moved.join(", ")}.` : `"${state.map.name}" is live.`);
      // Activation changes which map is live, not the map: the list is read
      // again, and whatever is on the canvas stays as it is.
      const list = await api.brainsState();
      state.maps = list?.maps ?? state.maps;
      state.activeId = list?.activeId ?? state.activeId;
      renderAll();
    } catch (error) {
      status(`Could not activate: ${error.message}`, "warn");
    } finally {
      state.busy = false;
      renderToolbar();
    }
  }

  // Leaving a map with edits on it is a choice, never an accident.
  async function settleChanges(verb = "leave") {
    if (!state.dirty || !state.map) return true;
    if (!state.map.nodes.length) {
      // An empty map cannot be saved, so the only choice is to let it go.
      const answer = await ask({
        eyebrow: "Unsaved map",
        title: `Discard "${state.map.name}" before you ${verb}?`,
        plain: `"${state.map.name}" has no parts yet, so it cannot be saved. Discard it?`,
        body: "It has no parts yet, so there is nothing to save.",
        ok: "Discard it",
        danger: true,
      });
      return Boolean(answer);
    }
    const answer = await ask({
      eyebrow: "Unsaved changes",
      title: state.draft ? `Keep the draft before you ${verb}?` : `Save "${state.map.name}" before you ${verb}?`,
      plain: `"${state.map.name}" has unsaved changes. Discard them?`,
      body: state.draft ? "The drafted map has not been saved anywhere yet." : "Your edits to this map have not been saved.",
      ok: state.draft ? "Save the draft" : "Save",
      extra: { label: "Discard", action: "discard", danger: true },
    });
    if (!answer) return false;
    if (answer.action === "discard") return true;
    // The plain-confirm fallback means "discard"; the dialog's OK means save.
    if (!el.dialog) return true;
    if (!(await save())) return false;
    if (state.dirty) {
      status("Edits arrived while saving. Save them too before you go on.", "warn");
      return false;
    }
    return true;
  }

  async function switchTo(id) {
    if (!id || id === state.map?.id) return;
    if (!(await settleChanges("switch maps"))) {
      renderToolbar();
      return;
    }
    await load({ id });
  }

  async function newMap({ from = null } = {}) {
    const api = bridge();
    if (!api?.brainsSave) return;
    setMenu(false);
    if (from && state.draft) return;
    // A copy is "save as": it takes the canvas as it stands, edits included.
    if (!from && !(await settleChanges("start a new map"))) return;
    const edited = Boolean(from) && state.dirty;
    const answer = await ask({
      eyebrow: from ? "Duplicate" : "New brain map",
      title: from ? "Name for the copy" : "Name for the new brain map",
      body: from
        ? `The copy keeps every part, wire, grant and setting${edited ? ", including the edits you have not saved; the original stays as it was last saved" : ""}. It is not live until you make it live.`
        : "It starts empty. Add parts with Space, drag them in from the left, or ask Build with AI.",
      input: { value: from ? `${from.name} copy` : "New brain", label: "Map name", max: 80, required: "Give the map a name." },
      ok: from ? "Make the copy" : "Create",
    });
    const name = clean(answer?.value, 80);
    if (!name) return;
    const id = `map_${Date.now().toString(36)}`;
    const map = from
      ? { ...structuredClone(from), id, name, builtIn: false, active: false }
      : { schema: 1, id, name, description: null, builtIn: false, active: false, grants: [], nodes: [], edges: [] };
    // The host does not keep a map with no parts, so an empty map lives here
    // as an unsaved draft until its first part is added and it is saved.
    if (!map.nodes.length) {
      startLocal(map, `Created "${name}". It is saved once it has a part — press Space to add the first one.`);
      return;
    }
    state.busy = true;
    try {
      const result = await api.brainsSave(map);
      if (!result?.ok) { status(result?.error ?? "That map could not be created.", "warn"); return; }
      state.map = null;
      await load({ id: result.map.id });
      status(from ? `Copied to "${result.map.name}".` : `Created "${result.map.name}". Press Space on the canvas to add its first part.`);
    } finally {
      state.busy = false;
      renderToolbar();
    }
  }

  function startLocal(map, message) {
    const from = state.draft?.from ?? state.map?.id ?? null;
    state.map = map;
    state.compiled = null;
    state.problems = [{ level: "error", code: "empty", text: "This map has no nodes yet." }];
    savedSnapshot = null;
    state.dirty = true;
    state.selection = null;
    state.picked = new Set();
    state.pending = null;
    state.draft = { from, local: true, model: null };
    resetHistory();
    renderAll();
    fit();
    revalidate({ now: true });
    status(message);
  }

  // Throw away what has not been saved: back to the saved map, or out of a
  // draft to the map that was open before it.
  async function discardChanges() {
    setMenu(false);
    if (!state.dirty || !state.map) return;
    const answer = await ask({
      eyebrow: "Discard",
      title: state.draft ? `Discard "${state.map.name}"?` : `Discard your changes to "${state.map.name}"?`,
      plain: state.draft ? `Discard "${state.map.name}"? It has never been saved.` : `Discard your changes to "${state.map.name}"?`,
      body: state.draft ? "It has never been saved, so nothing of it is kept." : "The map goes back to how it was last saved.",
      ok: "Discard",
      danger: true,
    });
    if (!answer) return;
    if (state.draft) { await discardDraft(); return; }
    const id = state.map.id;
    state.map = null;
    state.dirty = false;
    savedSnapshot = null;
    await load({ id });
    status("Changes discarded.");
  }

  async function removeMap() {
    const api = bridge();
    setMenu(false);
    if (!api?.brainsDelete || !state.map || state.map.builtIn || state.draft || state.map.id === state.activeId) return;
    const answer = await ask({
      eyebrow: "Delete",
      title: `Delete "${state.map.name}"?`,
      plain: `Delete "${state.map.name}"? This cannot be undone.`,
      body: "This cannot be undone. A map another map calls cannot be deleted until that one is repointed.",
      ok: "Delete it",
      danger: true,
    });
    if (!answer) return;
    const result = await api.brainsDelete(state.map.id);
    if (!result?.ok) { status(result?.error ?? "That map could not be deleted.", "warn"); return; }
    savedSnapshot = null;
    state.map = null;
    await load({ id: null });
    status("Deleted.");
  }

  async function resetMap() {
    const api = bridge();
    setMenu(false);
    if (!api?.brainsReset || !state.map?.builtIn) return;
    const answer = await ask({
      eyebrow: "Reset",
      title: "Reset this map to the shipped pipeline?",
      plain: "Reset this map to the shipped pipeline? Your changes to it are lost.",
      body: "Your changes to it are lost. Whether it is live does not change.",
      ok: "Reset it",
      danger: true,
    });
    if (!answer) return;
    const result = await api.brainsReset(state.map.id);
    if (!result?.ok) { status(result?.error ?? "That map could not be reset.", "warn"); return; }
    const id = state.map.id;
    state.map = null;
    await load({ id });
    fit({ animate: true });
    status("Reset to the shipped pipeline.");
  }

  const DRAFT_EXAMPLES = [
    "Plan and brief everything, but ask me before anything is built",
    "Only take what I ask for by hand, and have a model check each ask",
    "Skip Jev and always use my default models",
  ];

  async function draft() {
    const api = bridge();
    if (!api?.brainsDraft || state.busy) return;
    if (!(await settleChanges("draft a new map"))) return;
    let drafted = null;
    const answer = await ask({
      eyebrow: "Build with AI",
      title: "What should this brain do?",
      body: "The assistant drafts it from the same parts catalog. Nothing is saved until you look at it and press Save.",
      input: { multiline: true, value: state.draftText ?? "", placeholder: "Say what should happen to an idea or a request, and where you want to decide.", label: "What the brain should do", max: 600, required: "Say what this brain should do." },
      examples: DRAFT_EXAMPLES,
      ok: "Draft it",
      busyText: "Drafting… this can take a minute",
      submit: async (text) => {
        state.draftText = text;
        status("Drafting…");
        const result = await api.brainsDraft(text);
        if (!result?.ok) return result?.error ?? "The draft failed.";
        drafted = result;
        return null;
      },
    });
    if (!answer || !drafted) {
      if (!drafted) status(HINT);
      return;
    }
    const from = state.draft?.from ?? state.map?.id ?? null;
    state.map = drafted.map;
    state.compiled = drafted.compiled ?? null;
    state.problems = drafted.compiled?.problems ?? [];
    savedSnapshot = null;
    state.dirty = true;
    state.selection = null;
    state.picked = new Set();
    state.pending = null;
    state.draft = { from, model: drafted.model ?? null };
    resetHistory();
    // A model's coordinates are a suggestion; parts it piled on top of each
    // other are laid out before anyone has to untangle them by hand.
    const piled = state.map.nodes.some((node) => overlaps(node.x, node.y, nodeHeight(node), node, 0));
    if (piled) layoutPipeline();
    status(`Drafted${drafted.model ? ` by ${drafted.model}` : ""}${piled ? " and laid out in pipeline order" : ""}. Nothing is saved yet — read it, fix what it got wrong, then Save.`);
    renderAll();
    fit({ animate: true });
  }

  async function discardDraft() {
    if (!state.draft) return;
    const from = state.draft.from;
    state.draft = null;
    state.map = null;
    await load({ id: from });
    status("Draft discarded.");
  }

  // ---- open / close -------------------------------------------------------------

  async function open(params = {}) {
    if (!initialized) init();
    const wasOpen = !el.overlay.hidden;
    window.MefiNav?.claim?.("brains");
    el.overlay.hidden = false;
    const wanted = typeof params?.mapId === "string" ? params.mapId : null;
    if (state.dirty && state.map) {
      // Edits are kept when the editor closes, but only for the project they
      // were made in: they must never be saved into another one.
      let list = null;
      try { list = await bridge()?.brainsState?.(); } catch { list = null; }
      if (!list || (list.projectId ?? null) === (state.projectId ?? null)) {
        if (list) {
          state.maps = list.maps ?? state.maps;
          state.activeId = list.activeId ?? state.activeId;
        }
        renderAll();
        applyView();
        if (!wasOpen) status(`Your unsaved changes to "${state.map.name}" are still here. Save them, or discard them from the Map menu.`);
        // A deep link to another map asks before it leaves these edits.
        if (wanted && wanted !== state.map.id) await switchTo(wanted);
      } else {
        state.dirty = false;
        savedSnapshot = null;
        state.map = null;
        state.draft = null;
        await load({ id: wanted });
        status("Unsaved edits made in another project were dropped when the project changed.", "warn");
      }
    } else {
      await load({ id: wanted });
    }
    if (params?.nodeType) {
      const node = state.map?.nodes.find((item) => item.type === params.nodeType);
      if (node) { select({ kind: "node", id: node.id }); scrollTo(node.id); }
    }
    el.canvasWrap?.focus?.({ preventScroll: true });
  }

  function close() {
    if (!el.overlay || el.overlay.hidden) return;
    if (dialogState) finishDialog(null, { force: true });
    // Closing never asks and never throws work away: unsaved edits stay here
    // and are on the canvas again the next time the editor opens.
    if (state.dirty && state.map) {
      window.MefiToast?.(`Unsaved changes to "${state.map.name}" are kept for when you reopen Brain maps.`, "info");
    }
    state.pending = null;
    state.gesture = null;
    el.marquee?.remove?.();
    if (el.canvasWrap) delete el.canvasWrap.dataset.gesture;
    el.overlay.hidden = true;
    setMenu(false);
    if (el.shortcuts) el.shortcuts.hidden = true;
    shortcutsReturn = null;
    closeSearch();
    window.MefiNav?.release?.("brains");
  }

  // ---- input --------------------------------------------------------------------

  const CHROME = ".brains-viewbar, .brains-minimap, .brains-banner, .brains-empty-state, .brains-rail-toggle";

  // Presses on parts and ports. Empty canvas is handled by onWrapPointerDown.
  function onCanvasPointerDown(event) {
    if (event.button > 0) return;
    suppressClick = false;
    const port = event.target?.closest?.(".brains-port");
    if (port) {
      state.gesture = {
        kind: "wire", moved: false, startX: event.clientX ?? 0, startY: event.clientY ?? 0,
        end: { node: port.dataset.node, port: port.dataset.port, dir: port.dataset.dir },
      };
      return;
    }
    const box = event.target?.closest?.(".brains-node");
    if (!box) return;
    const id = box.dataset.node;
    let collapse = false;
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      // Shift or Ctrl adds a part to the picked set, or takes it out again.
      const next = new Set(state.selection?.kind === "node" ? [...state.picked, state.selection.id] : []);
      if (next.has(id)) next.delete(id); else next.add(id);
      state.picked = next;
      const primary = next.has(id) ? id : [...next].pop() ?? null;
      select(primary ? { kind: "node", id: primary } : null, { keepPicked: true });
      if (!next.has(id)) return;
    } else if (state.picked.size > 1 && state.picked.has(id)) {
      // Pressing one of several picked parts keeps them all, so they can be
      // dragged together; a press that does not move narrows to this one.
      if (state.selection?.id !== id) select({ kind: "node", id }, { keepPicked: true });
      collapse = true;
    } else if (!(state.selection?.kind === "node" && state.selection.id === id)) {
      select({ kind: "node", id });
    }
    const node = nodeById(id);
    if (!node) return;
    const world = toWorld(event.clientX ?? 0, event.clientY ?? 0);
    const group = state.picked.size > 1 ? pickedNodes() : [node];
    state.drag = { id: node.id };
    state.gesture = {
      kind: "node", id: node.id, moved: false, startX: event.clientX ?? 0, startY: event.clientY ?? 0,
      grabX: world.x - node.x, grabY: world.y - node.y, fromX: node.x, fromY: node.y, depth: null, collapse,
      origins: new Map(group.map((item) => [item.id, { x: item.x, y: item.y }])),
    };
    event.preventDefault?.();
    frame(() => nodeBoxes.get(id)?.focus?.({ preventScroll: true }));
  }

  function onWrapPointerDown(event) {
    if (event.target?.closest?.(CHROME)) return;
    const middle = event.button === 1;
    if (!middle && (event.target?.closest?.(".brains-node") || event.target?.dataset?.edge)) return;
    if (event.button > 0 && !middle) return;
    suppressClick = false;
    if (event.shiftKey && !middle) {
      // Shift and drag on empty canvas draws a marquee that picks every part
      // it touches, added to what was already picked.
      const base = new Set(state.selection?.kind === "node" ? [...state.picked, state.selection.id] : []);
      state.gesture = { kind: "marquee", moved: false, startX: event.clientX, startY: event.clientY, base };
    } else {
      state.gesture = { kind: "pan", moved: false, middle, startX: event.clientX, startY: event.clientY, viewX: state.view.x, viewY: state.view.y };
    }
    if (middle) event.preventDefault?.();
    el.canvasWrap?.focus?.({ preventScroll: true });
  }

  function drawMarquee(gesture, clientX, clientY) {
    if (!el.canvasWrap) return;
    if (!el.marquee) {
      el.marquee = document.createElement("div");
      el.marquee.className = "brains-marquee";
      el.marquee.setAttribute("aria-hidden", "true");
    }
    if (!el.marquee.parentElement) el.canvasWrap.append(el.marquee);
    const rect = el.canvasWrap.getBoundingClientRect();
    const left = Math.min(gesture.startX, clientX) - rect.left;
    const top = Math.min(gesture.startY, clientY) - rect.top;
    const width = Math.abs(clientX - gesture.startX);
    const height = Math.abs(clientY - gesture.startY);
    Object.assign(el.marquee.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
    const a = toWorld(Math.min(gesture.startX, clientX), Math.min(gesture.startY, clientY));
    const b = toWorld(Math.max(gesture.startX, clientX), Math.max(gesture.startY, clientY));
    const next = new Set(gesture.base);
    for (const node of state.map?.nodes ?? []) {
      if (node.x < b.x && node.x + NODE_W > a.x && node.y < b.y && node.y + nodeHeight(node) > a.y) next.add(node.id);
    }
    state.picked = next;
    paintPicked();
  }

  function endMarquee() {
    el.marquee?.remove?.();
    const ids = [...state.picked];
    if (!ids.length) { select(null); return; }
    const primary = state.selection?.kind === "node" && state.picked.has(state.selection.id) ? state.selection.id : ids[ids.length - 1];
    select({ kind: "node", id: primary }, { keepPicked: true });
    status(ids.length === 1 ? `Picked "${nodeById(primary)?.title}".` : `Picked ${ids.length} parts. Drag one to move them all; Delete removes them.`);
  }

  function onPointerMove(event) {
    const gesture = state.gesture;
    if (!gesture) {
      if (state.pending && el.ghost && !state.search.open && event.target?.closest?.(".brains-canvas-wrap")) drawGhost(toWorld(event.clientX, event.clientY));
      return;
    }
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (!gesture.moved) {
      if (Math.hypot(dx, dy) < DRAG_SLOP) return;
      gesture.moved = true;
      if (el.canvasWrap) el.canvasWrap.dataset.gesture = gesture.kind;
      if (gesture.kind === "node") {
        gesture.future = history.future;
        checkpoint();
        gesture.depth = history.past.length;
      }
      if (gesture.kind === "wire") {
        state.pending = gesture.end;
        status(`Wiring from ${nodeById(gesture.end.node)?.title ?? gesture.end.node} · ${gesture.end.port}. Let go on a lit end, on a part, or on empty canvas to search for one.`);
        renderCanvas();
      }
    }
    if (gesture.kind === "pan") {
      state.view.x = gesture.viewX + dx;
      state.view.y = gesture.viewY + dy;
      scheduleView();
      return;
    }
    dragTo(gesture, event.clientX, event.clientY);
    edgePan(gesture, event.clientX, event.clientY);
  }

  function dragTo(gesture, clientX, clientY) {
    if (gesture.kind === "node") {
      const lead = nodeById(gesture.id);
      if (!lead) return;
      const world = toWorld(clientX, clientY);
      const x = snap(world.x - gesture.grabX);
      const y = snap(world.y - gesture.grabY);
      if (x === lead.x && y === lead.y) return;
      // Every picked part moves by the lead part's offset, so a lane keeps
      // its shape.
      const dx = x - gesture.fromX;
      const dy = y - gesture.fromY;
      for (const [id, origin] of gesture.origins ?? new Map([[gesture.id, { x: gesture.fromX, y: gesture.fromY }]])) {
        const node = nodeById(id);
        if (!node) continue;
        node.x = Math.max(-LIMIT, Math.min(LIMIT, origin.x + dx));
        node.y = Math.max(-LIMIT, Math.min(LIMIT, origin.y + dy));
        const box = nodeBoxes.get(id);
        if (box) {
          box.style.left = `${node.x}px`;
          box.style.top = `${node.y}px`;
        }
        updateWiresFor(id);
      }
    } else if (gesture.kind === "marquee") {
      drawMarquee(gesture, clientX, clientY);
    } else if (gesture.kind === "wire") {
      drawGhost(toWorld(clientX, clientY));
    } else if (gesture.kind === "mini") {
      const point = miniPoint({ clientX, clientY });
      if (point) centerAtWorld(point);
    }
  }

  // A part or a wire held against the edge of the canvas pans the view that
  // way, so it can be taken somewhere that is off screen.
  let edgePanFrame = null;
  function edgePan(gesture, clientX, clientY) {
    if (!el.stage || !gesture.moved || (gesture.kind !== "node" && gesture.kind !== "wire")) return;
    const rect = el.canvasWrap.getBoundingClientRect();
    const band = 36;
    const vx = clientX < rect.left + band ? 1 : clientX > rect.right - band ? -1 : 0;
    const vy = clientY < rect.top + band ? 1 : clientY > rect.bottom - band ? -1 : 0;
    gesture.edge = vx || vy ? { vx, vy, clientX, clientY } : null;
    if (gesture.edge && edgePanFrame === null) edgePanFrame = frame(stepEdgePan);
  }

  function stepEdgePan() {
    edgePanFrame = null;
    const gesture = state.gesture;
    if (!gesture?.edge) return;
    state.view.x += gesture.edge.vx * 14;
    state.view.y += gesture.edge.vy * 14;
    applyView();
    dragTo(gesture, gesture.edge.clientX, gesture.edge.clientY);
    edgePanFrame = frame(stepEdgePan);
  }

  function onPointerUp(event) {
    const gesture = state.gesture;
    if (!gesture) return;
    state.gesture = null;
    state.drag = null;
    if (el.canvasWrap) delete el.canvasWrap.dataset.gesture;
    if (!gesture.moved) {
      // A press that did not move: an empty-canvas click clears, a port press
      // is left to the click handler that wires it.
      if (gesture.kind === "node" && gesture.collapse) {
        select({ kind: "node", id: gesture.id });
        return;
      }
      // A Shift click on empty canvas keeps what is picked.
      if (gesture.kind === "marquee") return;
      if (gesture.kind === "pan") {
        if (gesture.middle) return;
        const hadWire = Boolean(state.pending);
        state.pending = null;
        hideGhost();
        if (hadWire) status("Wire cancelled.");
        if (state.selection) select(null);
        else renderCanvas();
      }
      return;
    }
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    if (gesture.kind === "node") {
      // A drag that ended where it began is not an edit and not an undo step.
      const node = nodeById(gesture.id);
      if (node && node.x === gesture.fromX && node.y === gesture.fromY && history.past.length === gesture.depth) {
        history.past.pop();
        history.future = gesture.future ?? [];
      }
      refreshDirty();
      renderCanvas();
      renderToolbar();
      return;
    }
    if (gesture.kind === "wire") finishWireDrag(event);
    if (gesture.kind === "marquee") endMarquee();
  }

  function finishWireDrag(event) {
    // Escape during the drag already cancelled it.
    if (!state.pending) {
      hideGhost();
      return;
    }
    const target = event.target;
    const port = target?.closest?.(".brains-port");
    if (port) {
      const wired = clickPort(port);
      if (!wired && state.pending) {
        state.pending = null;
        hideGhost();
        renderCanvas();
      }
      return;
    }
    const box = target?.closest?.(".brains-node");
    if (box) {
      if (!joinToNode(box.dataset.node)) {
        const title = nodeById(box.dataset.node)?.title ?? "that part";
        cancelWire(`"${title}" has no end that can take this wire.`);
        status(`"${title}" has no end that can take this wire.`, "warn");
      }
      return;
    }
    if (target?.closest?.(".brains-canvas-wrap") && !target.closest(CHROME)) {
      // Let go on empty canvas: find a part for the loose end, placed so its
      // matching port lands under the pointer.
      const point = toWorld(event.clientX, event.clientY);
      const at = {
        x: state.pending.dir === "out" ? point.x - PORT_INSET : point.x - NODE_W + PORT_INSET,
        y: point.y - BORDER - HEAD_H - PORT_H / 2,
      };
      openSearch(at, { fromDrop: true });
      return;
    }
    cancelWire();
  }

  // Pick bands are wide, so where two wires pass close together their bands
  // overlap. The wire whose line runs nearest the pointer wins, not whichever
  // band happens to be drawn on top.
  function nearestEdge(event, fallback) {
    if (typeof document.elementsFromPoint !== "function" || typeof DOMPoint !== "function") return fallback;
    const candidates = document.elementsFromPoint(event.clientX, event.clientY)
      .filter((item) => item.dataset?.edge && item.classList?.contains("brains-wire-hit"));
    if (candidates.length < 2) return fallback;
    let best = fallback;
    let bestDistance = Infinity;
    for (const hit of candidates) {
      const matrix = hit.getScreenCTM?.();
      if (!matrix || typeof hit.getTotalLength !== "function") continue;
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      const length = hit.getTotalLength();
      const distance = (at) => {
        const on = hit.getPointAtLength(Math.max(0, Math.min(length, at)));
        return (on.x - point.x) ** 2 + (on.y - point.y) ** 2;
      };
      // A coarse walk along the wire, then halving steps around the closest.
      const steps = 48;
      let at = 0;
      let nearest = Infinity;
      for (let index = 0; index <= steps; index += 1) {
        const here = distance((length * index) / steps);
        if (here < nearest) { nearest = here; at = (length * index) / steps; }
      }
      for (let span = length / steps; span > 0.5; span /= 2) {
        for (const next of [at - span, at + span]) {
          const here = distance(next);
          if (here < nearest) { nearest = here; at = next; }
        }
      }
      if (nearest < bestDistance) { bestDistance = nearest; best = hit.dataset.edge; }
    }
    return best;
  }

  function onCanvasClick(event) {
    if (suppressClick) { suppressClick = false; return; }
    const port = event.target?.closest?.(".brains-port");
    if (port) { clickPort(port); return; }
    const edge = event.target?.dataset?.edge ? nearestEdge(event, event.target.dataset.edge) : null;
    if (edge) {
      select({ kind: "edge", id: edge });
      // Keep the keyboard on the canvas so Delete reaches the wire.
      el.canvasWrap?.focus?.({ preventScroll: true });
    }
  }

  function onWheel(event) {
    if (!el.stage || event.target?.closest?.(".brains-search, .brains-dialog")) return;
    event.preventDefault();
    const rect = el.canvasWrap.getBoundingClientRect();
    const at = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (event.ctrlKey || event.metaKey) {
      // Ctrl + wheel, and a trackpad pinch, zoom around the pointer.
      const delta = event.deltaMode === 1 ? event.deltaY * 18 : event.deltaY;
      zoomTo(state.view.zoom * Math.exp(-delta * 0.0022), at);
      return;
    }
    const unit = event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? viewSize().h : 1;
    let dx = event.deltaX * unit;
    let dy = event.deltaY * unit;
    if (event.shiftKey && !dx) { dx = dy; dy = 0; }
    state.view.x -= dx;
    state.view.y -= dy;
    scheduleView();
  }

  function onDragOver(event) {
    const types = [...(event.dataTransfer?.types ?? [])];
    if (!types.includes(PART_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    el.canvasWrap?.classList.add("drop-ready");
  }

  function onDrop(event) {
    const type = event.dataTransfer?.getData?.(PART_MIME);
    el.canvasWrap?.classList.remove("drop-ready");
    if (!type) return;
    event.preventDefault();
    const point = toWorld(event.clientX, event.clientY);
    addNode(type, { x: point.x - NODE_W / 2, y: point.y - HEAD_H / 2 });
  }

  // Escape in the middle of a drag puts everything back where the press
  // found it: the parts, the view, the picked set, or the armed wire.
  function abortGesture() {
    const gesture = state.gesture;
    if (!gesture) return;
    state.gesture = null;
    state.drag = null;
    suppressClick = true;
    const clear = () => setTimeout(() => { suppressClick = false; }, 0);
    window.addEventListener?.("pointerup", clear, { once: true, capture: true });
    window.addEventListener?.("pointercancel", clear, { once: true, capture: true });
    if (el.canvasWrap) delete el.canvasWrap.dataset.gesture;
    if (gesture.kind === "pan" || gesture.kind === "mini") {
      state.view.x = gesture.viewX;
      state.view.y = gesture.viewY;
      applyView();
    } else if (gesture.kind === "node" && gesture.moved) {
      for (const [id, origin] of gesture.origins ?? []) {
        const node = nodeById(id);
        if (node) { node.x = origin.x; node.y = origin.y; }
      }
      if (history.past.length === gesture.depth) {
        history.past.pop();
        history.future = gesture.future ?? [];
      }
      refreshDirty();
      renderCanvas();
      renderToolbar();
    } else if (gesture.kind === "marquee") {
      el.marquee?.remove?.();
      state.picked = new Set(gesture.base);
      paintPicked();
    } else if (gesture.kind === "wire") {
      state.pending = null;
      hideGhost();
      renderCanvas();
    }
    status("Cancelled.");
  }

  // The legend and shortcuts sheet is modal: focus moves into it, Tab stays
  // in it, and no key reaches the canvas behind it.
  let shortcutsReturn = null;
  function openShortcuts() {
    if (!el.shortcuts) return;
    shortcutsReturn = typeof document !== "undefined" ? document.activeElement : null;
    el.shortcuts.hidden = false;
    el.shortcuts.querySelector?.("[data-close]")?.focus?.();
  }

  function closeShortcuts() {
    if (!el.shortcuts || el.shortcuts.hidden) return;
    el.shortcuts.hidden = true;
    const back = shortcutsReturn?.isConnected && shortcutsReturn.getClientRects?.().length ? shortcutsReturn : el.canvasWrap;
    shortcutsReturn = null;
    back?.focus?.({ preventScroll: true });
  }

  function shortcutsKeys(event) {
    if (event.key === "Escape" || event.key === "?") {
      stop(event);
      closeShortcuts();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === "a") {
      event.preventDefault();
      const body = el.shortcuts.querySelector?.(".brains-shortcuts-body");
      if (body) window.getSelection?.()?.selectAllChildren?.(body);
    }
    if (event.key === "Tab") {
      const stops = [...(el.shortcuts.querySelectorAll?.("button, [tabindex='0']") ?? [])];
      const index = stops.indexOf(document.activeElement);
      event.preventDefault();
      stops[(index + (event.shiftKey ? -1 : 1) + stops.length) % stops.length]?.focus?.();
    }
    // Arrows and Page keys still scroll the focused panel; nothing else
    // reaches the canvas or the app behind it.
    event.stopPropagation();
  }

  function typing(target) {
    return Boolean(target?.closest?.("input, textarea, select, [contenteditable]"));
  }

  // Whether the canvas has the keyboard: focus on it, on a part or an end
  // inside it, or nowhere in particular (the page itself or the sheet).
  function canvasHasKeys(target) {
    if (!target || target === el.canvasWrap || el.canvasWrap?.contains?.(target)) return true;
    return typeof document !== "undefined" && (target === document.body || target === document.documentElement || Boolean(target.classList?.contains?.("brains-sheet")));
  }

  function stop(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function onKey(event) {
    if (!el.overlay || el.overlay.hidden) return;
    if (event.key === "Tab") tabbedAt = Date.now();
    // A layer opened above the editor (the palette, help, the walkthrough)
    // owns the keyboard, and so does any field outside the sheet.
    const layer = window.MefiNav?.top?.();
    if (layer && layer !== "brains") return;
    const target = event.target;
    if (target && target !== document.body && target !== document.documentElement
      && typeof el.overlay.contains === "function" && typeof target.closest === "function" && !el.overlay.contains(target)) return;
    if (dialogState) { dialogKeys(event); return; }
    if (el.menu && !el.menu.hidden && menuKeys(event)) return;
    if (el.shortcuts && !el.shortcuts.hidden) { shortcutsKeys(event); return; }
    if (state.search.open) {
      if (event.key === "Escape") { stop(event); closeSearch(); return; }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        state.search.index += event.key === "ArrowDown" ? 1 : -1;
        renderSearch({ reveal: true });
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        chooseEntry(searchEntries()[state.search.index]);
        return;
      }
      // The search is modal: Tab stays in its field, and every other key is
      // the query's. If focus wandered off the field it is brought back, so
      // a letter lands there instead of opening another part of the app.
      if (event.key === "Tab") { event.preventDefault(); return; }
      if (target !== el.searchInput) el.searchInput?.focus?.();
      if (!event.ctrlKey && !event.metaKey && !event.altKey) event.stopPropagation();
      return;
    }
    const mod = event.ctrlKey || event.metaKey;
    const key = String(event.key ?? "");
    const lower = key.toLowerCase();
    // Ctrl S saves from anywhere, including the field being typed in: every
    // field has already written its value into the map by then.
    if (mod && lower === "s") { stop(event); void save(); return; }
    // Text fields keep their own undo; a checkbox or a select has none, so
    // there Ctrl Z walks the editor's history.
    const textEntry = Boolean(target?.closest?.("textarea, [contenteditable], input:not([type=checkbox]):not([type=radio]):not([type=range])"));
    if (mod && (lower === "z" || lower === "y") && !textEntry) {
      stop(event);
      stepHistory(lower === "y" || event.shiftKey ? "redo" : "undo");
      return;
    }
    if (typing(target)) {
      // Escape leaves a field for the canvas rather than closing the editor.
      if (key === "Escape") {
        stop(event);
        target.blur?.();
        el.canvasWrap?.focus?.({ preventScroll: true });
      }
      return;
    }
    if (mod && lower === "d") {
      stop(event);
      if (state.selection?.kind === "node") duplicateNode(state.selection.id);
      return;
    }
    const onCanvas = canvasHasKeys(target);
    if (mod && lower === "a" && onCanvas) { stop(event); pickAll(); return; }
    if (mod && lower === "f") { stop(event); openSearch(null, { mode: "find" }); return; }
    if (key === "F8") { stop(event); stepProblem(event.shiftKey ? -1 : 1); return; }
    if (mod || event.altKey) return;
    if (key === " " || event.code === "Space") {
      // A focused button (a port, a part card, a view control) keeps its own
      // Space; the canvas and the parts on it search the parts.
      if (target !== el.canvasWrap && target?.closest?.("button, a, summary, [role=button], [role=menuitem]")) return;
      stop(event);
      openSearch();
      return;
    }
    // Escape steps back one layer at a time: a drag in progress is undone,
    // then an armed wire, then the selection, and only then does the editor
    // close.
    if (key === "Escape" && state.gesture?.moved) {
      stop(event);
      abortGesture();
      return;
    }
    if (key === "Escape" && state.pending) {
      stop(event);
      cancelWire();
      return;
    }
    if (key === "Escape" && state.selection && onCanvas) {
      stop(event);
      select(null);
      status("Selection cleared. Escape again closes Brain maps.");
      return;
    }
    if ((key === "Delete" || key === "Backspace") && state.selection && onCanvas) {
      stop(event);
      deleteSelection();
      return;
    }
    // Arrows move the selected part (or the view) only while the canvas has
    // the keyboard; in the parts rail or the toolbar they keep their own job.
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[key] && onCanvas) {
      stop(event);
      const step = event.shiftKey ? GRID * 5 : GRID;
      nudge(arrows[key][0] * step, arrows[key][1] * step);
      return;
    }
    if (!el.stage) return;
    if (lower === "f") { stop(event); fit({ animate: true }); return; }
    if (key === "0") { stop(event); zoomTo(1, null, { animate: true }); return; }
    if (key === "+" || key === "=") { stop(event); zoomTo(state.view.zoom * ZOOM_STEP, null, { animate: true }); return; }
    if (key === "-" || key === "_") { stop(event); zoomTo(state.view.zoom / ZOOM_STEP, null, { animate: true }); return; }
    if (key === "[") { stop(event); togglePanel("parts"); return; }
    if (key === "]") { stop(event); togglePanel("inspector"); return; }
    if (key === "?") {
      stop(event);
      openShortcuts();
      return;
    }
  }

  function init() {
    if (initialized) return;
    initialized = true;
    for (const [key, id] of Object.entries({
      overlay: "brains-overlay", canvas: "brains-canvas", canvasWrap: "brains-canvas-wrap", wires: "brains-wires",
      inspector: "brains-inspector", partsList: "brains-parts-list", partsSearch: "brains-parts-search",
      problems: "brains-problems", status: "brains-status", switcher: "brains-switcher", save: "brains-save",
      activate: "brains-activate", newMap: "brains-new", duplicate: "brains-duplicate", deleteMap: "brains-delete",
      draft: "brains-draft", close: "brains-close", search: "brains-search", searchInput: "brains-search-input",
      searchList: "brains-search-list", searchHint: "brains-search-hint", dirty: "brains-dirty", liveTag: "brains-live",
      stage: "brains-stage", wireHits: "brains-wire-hits", ghost: "brains-ghost", ghostPath: "brains-ghost-path",
      minimap: "brains-minimap", minimapSvg: "brains-minimap-svg", zoomIn: "brains-zoom-in", zoomOut: "brains-zoom-out",
      zoomLevel: "brains-zoom-level", fit: "brains-fit", tidy: "brains-tidy", help: "brains-help", shortcuts: "brains-shortcuts",
      undo: "brains-undo", redo: "brains-redo", more: "brains-more", menu: "brains-more-menu", reset: "brains-reset", discard: "brains-discard",
      dialog: "brains-dialog", body: "brains-body", toggleParts: "brains-toggle-parts", toggleInspector: "brains-toggle-inspector",
      empty: "brains-empty-state", emptyAdd: "brains-empty-add", emptyDraft: "brains-empty-draft",
      banner: "brains-banner", bannerText: "brains-banner-text", bannerSave: "brains-banner-save", bannerDiscard: "brains-banner-discard",
    })) el[key] = document.getElementById(id);
    if (!el.overlay) return;
    loadLayout();
    applyLayout();
    el.close?.addEventListener("click", close);
    el.overlay.addEventListener("click", (event) => { if (event.target === el.overlay && pressedOnBackdrop(el.overlay)) close(); });
    el.save?.addEventListener("click", () => void save());
    el.activate?.addEventListener("click", () => void activate());
    el.newMap?.addEventListener("click", () => void newMap());
    el.duplicate?.addEventListener("click", () => { setMenu(false); void newMap({ from: state.map }); });
    el.deleteMap?.addEventListener("click", () => void removeMap());
    el.reset?.addEventListener("click", () => void resetMap());
    el.discard?.addEventListener("click", () => void discardChanges());
    el.draft?.addEventListener("click", () => void draft());
    el.emptyDraft?.addEventListener("click", () => void draft());
    el.emptyAdd?.addEventListener("click", () => openSearch());
    el.bannerSave?.addEventListener("click", () => void save());
    el.bannerDiscard?.addEventListener("click", () => void discardDraft());
    el.undo?.addEventListener("click", () => stepHistory("undo"));
    el.redo?.addEventListener("click", () => stepHistory("redo"));
    el.more?.addEventListener("click", () => setMenu(el.menu?.hidden !== false));
    el.switcher?.addEventListener("change", () => void switchTo(el.switcher.value));
    el.partsSearch?.addEventListener("input", () => { state.partsQuery = el.partsSearch.value; renderParts(); });
    el.canvas?.addEventListener("pointerdown", onCanvasPointerDown);
    el.canvasWrap?.addEventListener("pointerdown", onWrapPointerDown);
    el.canvas?.addEventListener("click", onCanvasClick);
    el.wires?.addEventListener("click", onCanvasClick);
    el.wireHits?.addEventListener("click", onCanvasClick);
    // Hover follows the same rule as a click: the nearest wire lights up.
    let hovered = null;
    const setHover = (id) => {
      if (id === hovered) return;
      const old = wirePaths.get(hovered);
      if (old) delete old.path.dataset.hover;
      hovered = id;
      const pair = wirePaths.get(id);
      if (pair) pair.path.dataset.hover = "true";
    };
    el.wireHits?.addEventListener("pointermove", (event) => {
      const own = event.target?.dataset?.edge;
      if (own) setHover(nearestEdge(event, own));
    });
    el.wireHits?.addEventListener("pointerout", (event) => {
      if (!event.relatedTarget?.dataset?.edge) setHover(null);
    });
    el.canvasWrap?.addEventListener("wheel", onWheel, { passive: false });
    el.canvasWrap?.addEventListener("dragover", onDragOver);
    el.canvasWrap?.addEventListener("dragleave", (event) => { if (event.target === el.canvasWrap) el.canvasWrap.classList.remove("drop-ready"); });
    el.canvasWrap?.addEventListener("drop", onDrop);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    el.canvasWrap?.addEventListener("dblclick", (event) => {
      if (event.target?.closest?.(`.brains-node, ${CHROME}`) || event.target?.dataset?.edge) return;
      const point = toWorld(event.clientX, event.clientY);
      openSearch({ x: point.x - NODE_W / 2, y: point.y - HEAD_H / 2 });
    });
    el.zoomIn?.addEventListener("click", () => zoomTo(state.view.zoom * ZOOM_STEP, null, { animate: true }));
    el.zoomOut?.addEventListener("click", () => zoomTo(state.view.zoom / ZOOM_STEP, null, { animate: true }));
    el.zoomLevel?.addEventListener("click", () => zoomTo(1, null, { animate: true }));
    el.fit?.addEventListener("click", () => fit({ animate: true }));
    el.tidy?.addEventListener("click", () => tidy());
    el.help?.addEventListener("click", () => { if (el.shortcuts?.hidden) openShortcuts(); else closeShortcuts(); });
    // A backdrop closes its layer only when the press began on it: a drag that
    // merely ends over the backdrop (a pan, a text selection) must not.
    let pressedOn = null;
    el.overlay.addEventListener("pointerdown", (event) => { pressedOn = event.target; }, true);
    el.shortcuts?.addEventListener("click", (event) => {
      if ((event.target === el.shortcuts && pressedOn === el.shortcuts) || event.target?.closest?.("[data-close]")) closeShortcuts();
    });
    el.toggleParts?.addEventListener("click", () => togglePanel("parts"));
    el.toggleInspector?.addEventListener("click", () => togglePanel("inspector"));
    el.minimap?.addEventListener("pointerdown", (event) => {
      event.preventDefault?.();
      event.stopPropagation?.();
      const viewX = state.view.x;
      const viewY = state.view.y;
      const point = miniPoint(event);
      if (point) centerAtWorld(point);
      state.gesture = { kind: "mini", moved: true, startX: event.clientX, startY: event.clientY, viewX, viewY };
    });
    el.dialog?.addEventListener("pointerdown", (event) => { if (event.target === el.dialog) finishDialog(null); });
    function pressedOnBackdrop(backdrop) { return pressedOn === null || pressedOn === backdrop; }
    el.searchInput?.addEventListener("input", () => { state.search.query = el.searchInput.value; state.search.index = 0; renderSearch(); });
    el.search?.addEventListener("click", (event) => { if (event.target === el.search && pressedOnBackdrop(el.search)) closeSearch(); });
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", (event) => {
      if (el.menu && !el.menu.hidden && !event.target?.closest?.(".brains-more")) setMenu(false);
    }, true);
    if (typeof ResizeObserver === "function" && el.canvasWrap) new ResizeObserver(onWrapResize).observe(el.canvasWrap);
    applyView();
    bridge()?.onBrains?.((payload) => {
      if (!payload?.maps) return;
      state.maps = payload.maps;
      state.activeId = payload.activeId ?? state.activeId;
      renderToolbar();
    });
  }

  window.MefiBrains = { open, close, isOpen: () => Boolean(el.overlay && !el.overlay.hidden) };
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
  }
})();
