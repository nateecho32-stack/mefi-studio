// Mefi's Studio AI+ — Brain maps: the pipeline editor.
//
// A node graph over the same data scripts/brains.cjs validates and compiles.
// Click an output end, then an input end, and the two are wired; Space opens
// the parts search wherever the canvas is looking; the inspector on the right
// says, for whatever is selected, exactly what it may and may not do, which
// model it uses, and which switch it moves when the map goes live.
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
    search: { open: false, query: "", index: 0, at: null },
    drag: null,
  };
  const el = {};
  let initialized = false;

  const bridge = () => (typeof window === "undefined" ? null : window.mefiStudio ?? null);
  const typeOf = (type) => state.catalog?.nodes.find((item) => item.type === type) ?? null;
  const nodeById = (id) => state.map?.nodes.find((node) => node.id === id) ?? null;
  const groupLabel = (id) => state.catalog?.groups.find((group) => group.id === id)?.label ?? id;
  const permission = (key) => state.catalog?.permissions.find((item) => item.key === key) ?? { key, label: key, detail: "" };
  const clean = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const RUNS = {
    host: { label: "Live stage", detail: "The studio already runs this stage. This node holds its settings, and making the map live moves the switch behind it." },
    map: { label: "Run by the map", detail: "This node's rules are what the studio follows — editing it changes behaviour as soon as the map is saved." },
    draft: { label: "Drawing only", detail: "Saved and drawn, but nothing executes it." },
  };

  function nodeHeight(node) {
    const spec = typeOf(node.type);
    const rows = Math.max(spec?.inputs.length ?? 0, spec?.outputs.length ?? 0, 1);
    return HEAD_H + rows * PORT_H + FOOT_H;
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

  // ---- loading ---------------------------------------------------------------

  async function load({ id = null, keepSelection = false } = {}) {
    const api = bridge();
    if (!api?.brainsState) {
      state.map = null;
      renderAll();
      return;
    }
    try {
      if (!state.catalog) state.catalog = (await api.brainsCatalog())?.catalog ?? null;
      const list = await api.brainsState();
      state.maps = list?.maps ?? [];
      state.activeId = list?.activeId ?? null;
      const want = id ?? state.map?.id ?? state.activeId;
      const read = await api.brainsRead(want);
      if (read?.ok) {
        state.map = read.map;
        state.compiled = read.compiled ?? null;
        state.problems = read.compiled?.problems ?? [];
      }
      state.dirty = false;
      if (!keepSelection) state.selection = null;
      state.pending = null;
    } catch (error) {
      status(`Could not read the brain maps: ${error.message}`, "warn");
    }
    renderAll();
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
        state.problems = result.result?.problems ?? [];
        state.compiled = result.compiled ?? null;
        renderProblems();
        renderCanvas();
      } catch { /* a failed check leaves the last verdict on screen */ }
    };
    if (now) void run();
    else validateTimer = setTimeout(run, 260);
  }

  // ---- canvas -----------------------------------------------------------------

  function renderCanvas() {
    if (!el.canvas) return;
    el.canvas.textContent = "";
    if (!state.map) return;
    const errorNodes = new Set(state.problems.filter((item) => item.level === "error" && item.nodeId).map((item) => item.nodeId));
    const warnNodes = new Set(state.problems.filter((item) => item.level === "warn" && item.nodeId).map((item) => item.nodeId));
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
      if (errorNodes.has(node.id)) box.dataset.problem = "error";
      else if (warnNodes.has(node.id)) box.dataset.problem = "warn";
      if (state.selection?.kind === "node" && state.selection.id === node.id) box.dataset.selected = "true";
      box.style.left = `${node.x}px`;
      box.style.top = `${node.y}px`;
      box.style.height = `${height}px`;

      const head = document.createElement("div");
      head.className = "brains-node-head";
      const kind = document.createElement("span");
      kind.className = "brains-node-kind";
      kind.textContent = groupLabel(spec?.group ?? "control");
      const title = document.createElement("b");
      title.textContent = node.title;
      head.append(kind, title);
      if (!spec) {
        const unknown = document.createElement("span");
        unknown.className = "brains-node-flag";
        unknown.textContent = "unknown part";
        head.append(unknown);
      }
      box.append(head);

      const ports = document.createElement("div");
      ports.className = "brains-node-ports";
      ports.append(portColumn(node, spec?.inputs ?? [], "in"), portColumn(node, spec?.outputs ?? [], "out"));
      box.append(ports);

      const foot = document.createElement("p");
      foot.className = "brains-node-foot";
      foot.textContent = footNote(node, spec);
      box.append(foot);
      el.canvas.append(box);
    }
    const width = Math.max(1200, right + 360);
    const height = Math.max(700, bottom + 240);
    el.canvas.style.width = `${width}px`;
    el.canvas.style.height = `${height}px`;
    renderWires(width, height);
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
      if (state.pending && state.pending.node === node.id && state.pending.port === port.id && state.pending.dir === dir) button.dataset.armed = "true";
      else if (state.pending) button.dataset.target = state.pending.dir === dir ? "no" : (canJoin(state.pending, { node: node.id, port: port.id, dir }) ? "yes" : "no");
      const dot = document.createElement("i");
      dot.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.textContent = port.label;
      button.append(...(dir === "in" ? [dot, label] : [label, dot]));
      button.title = `${port.label} · carries ${port.kinds.join(", ")}${port.required ? " · required" : ""}. Click to ${state.pending ? "finish" : "start"} a wire.`;
      button.setAttribute("aria-label", `${dir === "in" ? "Input" : "Output"} ${port.label} on ${node.title}`);
      column.append(button);
    }
    return column;
  }

  function footNote(node, spec) {
    if (!spec) return "This build does not have this part.";
    const bits = [];
    if (node.model) bits.push(node.model.mode === "pinned" && node.model.model ? `model ${node.model.model}` : `${node.model.role} model`);
    if (spec.permissions.length) bits.push(`${spec.permissions.length} permission${spec.permissions.length === 1 ? "" : "s"}`);
    bits.push(RUNS[spec.runs]?.label.toLowerCase() ?? spec.runs);
    return bits.join(" · ");
  }

  function renderWires(width, height) {
    if (!el.wires) return;
    el.wires.setAttribute("viewBox", `0 0 ${width} ${height}`);
    el.wires.setAttribute("width", String(width));
    el.wires.setAttribute("height", String(height));
    el.wires.textContent = "";
    const badEdges = new Set(state.problems.filter((item) => item.level === "error" && item.edgeId).map((item) => item.edgeId));
    for (const edge of state.map.edges) {
      const from = portPoint(edge.from.node, edge.from.port, "out");
      const to = portPoint(edge.to.node, edge.to.port, "in");
      if (!from || !to) continue;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      const reach = Math.max(60, Math.abs(to.x - from.x) * 0.45);
      path.setAttribute("d", `M ${from.x} ${from.y} C ${from.x + reach} ${from.y}, ${to.x - reach} ${to.y}, ${to.x} ${to.y}`);
      path.setAttribute("class", "brains-wire");
      path.dataset.edge = edge.id;
      if (edge.feedback) path.dataset.feedback = "true";
      if (badEdges.has(edge.id)) path.dataset.problem = "error";
      if (state.selection?.kind === "edge" && state.selection.id === edge.id) path.dataset.selected = "true";
      const label = document.createElementNS("http://www.w3.org/2000/svg", "title");
      label.textContent = `${nodeById(edge.from.node)?.title ?? edge.from.node} → ${nodeById(edge.to.node)?.title ?? edge.to.node}${edge.feedback ? " (feedback: it lands on the next pass)" : ""}`;
      path.append(label);
      el.wires.append(path);
    }
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

  function clickPort(target) {
    const end = { node: target.dataset.node, port: target.dataset.port, dir: target.dataset.dir };
    if (!state.pending) {
      state.pending = end;
      status(`Wiring from ${nodeById(end.node)?.title ?? end.node} · ${end.port}. Click the other end, or press Escape.`);
      renderCanvas();
      return;
    }
    if (state.pending.node === end.node && state.pending.port === end.port && state.pending.dir === end.dir) {
      state.pending = null;
      status("Wire cancelled.");
      renderCanvas();
      return;
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
      return;
    }
    const from = state.pending.dir === "out" ? state.pending : end;
    const to = state.pending.dir === "out" ? end : state.pending;
    connect(from, to);
    state.pending = null;
  }

  function connect(from, to) {
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
    state.map.edges.push({ id, from: { ...from }, to: { ...to } });
    touch(`Wired ${nodeById(from.node)?.title} → ${nodeById(to.node)?.title}.`);
    select({ kind: "edge", id });
  }

  function deleteSelection() {
    if (!state.selection || !state.map) return;
    if (state.selection.kind === "edge") {
      const edge = state.map.edges.find((item) => item.id === state.selection.id);
      state.map.edges = state.map.edges.filter((item) => item.id !== state.selection.id);
      state.selection = null;
      touch(edge ? "Wire removed." : "");
      return;
    }
    const node = nodeById(state.selection.id);
    if (!node) return;
    state.map.nodes = state.map.nodes.filter((item) => item.id !== node.id);
    state.map.edges = state.map.edges.filter((edge) => edge.from.node !== node.id && edge.to.node !== node.id);
    state.selection = null;
    touch(`Removed "${node.title}" and its wires.`);
  }

  function touch(message = "") {
    state.dirty = true;
    if (message) status(message);
    renderCanvas();
    renderInspector();
    renderToolbar();
    revalidate();
  }

  function select(selection) {
    state.selection = selection;
    renderCanvas();
    renderInspector();
  }

  // ---- adding parts --------------------------------------------------------------

  function freeId(type) {
    const base = `n_${type.replace(/[^a-z0-9]+/gi, "_")}`;
    if (!nodeById(base)) return base;
    for (let index = 2; index < 200; index += 1) if (!nodeById(`${base}_${index}`)) return `${base}_${index}`;
    return `${base}_${Date.now()}`;
  }

  function addNode(type, at = null) {
    const spec = typeOf(type);
    if (!spec || !state.map) return null;
    const view = el.canvasWrap;
    const spot = at ?? {
      x: Math.round(((view?.scrollLeft ?? 0) + (view?.clientWidth ?? 900) / 2 - NODE_W / 2) / GRID) * GRID,
      y: Math.round(((view?.scrollTop ?? 0) + (view?.clientHeight ?? 600) / 2 - 80) / GRID) * GRID,
    };
    const node = {
      id: freeId(type),
      type,
      title: spec.label,
      x: Math.max(0, spot.x),
      y: Math.max(0, spot.y),
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
        connect(from, to);
        touch(`Added "${node.title}" and wired it in.`);
        select({ kind: "node", id: node.id });
        return node;
      }
      state.pending = null;
    }
    touch(`Added "${node.title}".`);
    select({ kind: "node", id: node.id });
    return node;
  }

  // ---- the parts panel -------------------------------------------------------------

  function renderParts() {
    if (!el.partsList) return;
    el.partsList.textContent = "";
    const query = state.partsQuery.trim().toLowerCase();
    const groups = state.catalog?.groups ?? [];
    for (const group of groups) {
      const parts = (state.catalog?.nodes ?? []).filter((node) => node.group === group.id
        && (!query || `${node.label} ${node.type} ${node.summary} ${node.can.join(" ")}`.toLowerCase().includes(query)));
      if (!parts.length) continue;
      const section = document.createElement("section");
      section.className = "brains-parts-group";
      const heading = document.createElement("h4");
      heading.textContent = group.label;
      const note = document.createElement("p");
      note.className = "brains-parts-detail";
      note.textContent = group.detail;
      section.append(heading, note);
      for (const part of parts) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "brains-part";
        button.dataset.type = part.type;
        button.dataset.runs = part.runs;
        const name = document.createElement("b");
        name.textContent = part.label;
        const runs = document.createElement("span");
        runs.className = "brains-part-runs";
        runs.textContent = RUNS[part.runs]?.label ?? part.runs;
        const summary = document.createElement("span");
        summary.className = "brains-part-summary";
        summary.textContent = part.summary;
        button.append(name, runs, summary);
        button.title = `${part.summary}\n\n${RUNS[part.runs]?.detail ?? ""}`;
        button.addEventListener("click", () => addNode(part.type));
        section.append(button);
      }
      el.partsList.append(section);
    }
    if (!el.partsList.children.length) {
      const empty = document.createElement("p");
      empty.className = "brains-empty";
      empty.textContent = query ? `No part matches "${state.partsQuery}".` : "The parts catalog is unavailable.";
      el.partsList.append(empty);
    }
  }

  // ---- the Space search ---------------------------------------------------------

  function openSearch(at = null) {
    if (!state.catalog) return;
    state.search = { open: true, query: "", index: 0, at };
    el.search.hidden = false;
    el.searchInput.value = "";
    renderSearch();
    el.searchInput.focus();
  }

  function closeSearch() {
    state.search.open = false;
    el.search.hidden = true;
    el.canvasWrap?.focus?.();
  }

  function searchMatches() {
    const query = state.search.query.trim().toLowerCase();
    const parts = state.catalog?.nodes ?? [];
    const scored = parts
      .map((part) => {
        const haystack = `${part.label} ${part.type} ${part.summary}`.toLowerCase();
        if (!query) return { part, score: 0 };
        if (part.label.toLowerCase().startsWith(query)) return { part, score: 3 };
        if (part.type.includes(query)) return { part, score: 2 };
        return { part, score: haystack.includes(query) ? 1 : -1 };
      })
      .filter((row) => row.score >= 0);
    scored.sort((a, b) => b.score - a.score);
    return scored.map((row) => row.part).slice(0, 12);
  }

  function renderSearch() {
    if (!el.searchList) return;
    const matches = searchMatches();
    state.search.index = Math.max(0, Math.min(state.search.index, matches.length - 1));
    el.searchList.textContent = "";
    for (const [index, part] of matches.entries()) {
      const row = document.createElement("li");
      row.className = "brains-search-row";
      row.dataset.type = part.type;
      if (index === state.search.index) row.dataset.active = "true";
      const name = document.createElement("b");
      name.textContent = part.label;
      const group = document.createElement("span");
      group.className = "brains-search-group";
      group.textContent = groupLabel(part.group);
      const summary = document.createElement("span");
      summary.className = "brains-search-summary";
      summary.textContent = part.summary;
      row.append(name, group, summary);
      row.addEventListener("click", () => {
        addNode(part.type, state.search.at);
        closeSearch();
      });
      el.searchList.append(row);
    }
    if (!matches.length) {
      const empty = document.createElement("li");
      empty.className = "brains-empty";
      empty.textContent = `Nothing matches "${state.search.query}".`;
      el.searchList.append(empty);
    }
    if (el.searchHint) {
      el.searchHint.textContent = state.pending
        ? "The new part is wired to the end you armed, when its ports allow it."
        : "Enter adds the highlighted part where the canvas is looking.";
    }
  }

  // ---- the inspector ---------------------------------------------------------------

  function renderInspector() {
    if (!el.inspector) return;
    el.inspector.textContent = "";
    if (!state.map) {
      el.inspector.append(note("Brain maps live in the desktop app."));
      return;
    }
    if (state.selection?.kind === "node") return renderNodeInspector(nodeById(state.selection.id));
    if (state.selection?.kind === "edge") return renderEdgeInspector(state.map.edges.find((edge) => edge.id === state.selection.id));
    return renderMapInspector();
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

  function renderNodeInspector(node) {
    if (!node) return;
    const spec = typeOf(node.type);
    const head = document.createElement("div");
    head.className = "brains-inspect-head";
    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = spec ? groupLabel(spec.group) : "Unknown part";
    const title = document.createElement("input");
    title.type = "text";
    title.className = "brains-title-input";
    title.value = node.title;
    title.setAttribute("aria-label", "Node name");
    title.addEventListener("input", () => {
      node.title = clean(title.value, 60) || (spec?.label ?? node.type);
      state.dirty = true;
      renderCanvas();
      renderToolbar();
    });
    head.append(eyebrow, title);
    el.inspector.append(head);

    if (!spec) {
      el.inspector.append(note(`This map was saved with a "${node.type}" part this build does not have. Delete it, or open the map in the build that made it.`, "brains-note warn"));
      el.inspector.append(dangerRow(node));
      return;
    }

    const runs = document.createElement("p");
    runs.className = "brains-runs";
    runs.dataset.runs = spec.runs;
    runs.textContent = `${RUNS[spec.runs]?.label ?? spec.runs}: ${RUNS[spec.runs]?.detail ?? ""}`;
    el.inspector.append(runs, note(spec.summary));
    if (spec.hostNote) el.inspector.append(note(spec.hostNote, "brains-note quiet"));
    if (spec.gate && state.catalog?.gates?.[spec.gate]) {
      const gate = state.catalog.gates[spec.gate];
      el.inspector.append(note(`Switch it moves: ${gate.label} — ${gate.detail}`, "brains-note gate"));
    }

    el.inspector.append(list("It can", spec.can, "brains-can"));
    el.inspector.append(list("It cannot", spec.cannot, "brains-cannot"));

    // Permissions, and whether this map actually grants them.
    const permissions = document.createElement("div");
    permissions.className = "brains-list";
    const permHeading = document.createElement("h4");
    permHeading.textContent = "Permissions";
    permissions.append(permHeading);
    if (!spec.permissions.length) permissions.append(note("This part needs no reach at all.", "brains-field-help"));
    for (const key of spec.permissions) {
      const info = permission(key);
      const row = document.createElement("label");
      row.className = "brains-permission";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = state.map.grants.includes(key);
      box.addEventListener("change", () => {
        state.map.grants = box.checked
          ? [...new Set([...state.map.grants, key])]
          : state.map.grants.filter((item) => item !== key);
        touch(box.checked ? `Granted ${info.label} on this map.` : `Took ${info.label} away from this map.`);
        renderInspector();
      });
      const text = document.createElement("span");
      const name = document.createElement("b");
      name.textContent = info.label;
      const detail = document.createElement("small");
      detail.textContent = info.detail;
      text.append(name, detail);
      row.append(box, text);
      permissions.append(row);
    }
    el.inspector.append(permissions);

    // The model this node uses.
    if (spec.model) {
      const modelWrap = document.createElement("div");
      modelWrap.className = "brains-list";
      const heading = document.createElement("h4");
      heading.textContent = "Model";
      modelWrap.append(heading);
      const mode = document.createElement("select");
      for (const [value, label] of [["inherit", "Follow Studio's routing"], ["role", "Pick the role it asks for"], ["pinned", "Always this model"]]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        if (node.model.mode === value) option.selected = true;
        mode.append(option);
      }
      mode.addEventListener("change", () => {
        node.model.mode = mode.value;
        if (mode.value !== "pinned") node.model.model = null;
        touch("Model choice changed.");
        renderInspector();
      });
      modelWrap.append(field("How it is chosen", mode, "Routing normally compares candidates per task. Pinning one takes that decision away from Jev for this node."));
      const role = document.createElement("select");
      for (const value of ["routine", "heavy", "judge", "worker"]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        if (node.model.role === value) option.selected = true;
        role.append(option);
      }
      role.disabled = node.model.mode === "inherit";
      role.addEventListener("change", () => { node.model.role = role.value; touch("Model role changed."); });
      modelWrap.append(field("Role", role, "Routine is the cheap pass, heavy is the reasoning one, judge answers classification questions, worker builds."));
      if (node.model.mode === "pinned") {
        const pinned = document.createElement("input");
        pinned.type = "text";
        pinned.value = node.model.model ?? "";
        pinned.placeholder = "model id, e.g. glm-5.3";
        pinned.addEventListener("input", () => { node.model.model = clean(pinned.value, 160) || null; state.dirty = true; renderToolbar(); });
        modelWrap.append(field("Model", pinned, "The id as the Model catalog lists it. An id your providers do not have falls back to your saved default."));
      }
      el.inspector.append(modelWrap);
    }

    // Its own settings.
    if (spec.settings?.length) {
      const settings = document.createElement("div");
      settings.className = "brains-list";
      const heading = document.createElement("h4");
      heading.textContent = "Settings";
      settings.append(heading);
      for (const setting of spec.settings) settings.append(settingControl(node, setting));
      el.inspector.append(settings);
    }

    // What is wired into it, and out of it.
    const wires = document.createElement("div");
    wires.className = "brains-list";
    const wiresHeading = document.createElement("h4");
    wiresHeading.textContent = "Wires";
    wires.append(wiresHeading);
    for (const port of spec.inputs) wires.append(wireRow(node, port, "in"));
    for (const port of spec.outputs) wires.append(wireRow(node, port, "out"));
    el.inspector.append(wires);
    el.inspector.append(dangerRow(node));
  }

  function wireRow(node, port, dir) {
    const row = document.createElement("p");
    row.className = "brains-wire-row";
    const edges = state.map.edges.filter((edge) => (dir === "in"
      ? edge.to.node === node.id && edge.to.port === port.id
      : edge.from.node === node.id && edge.from.port === port.id));
    const others = edges.map((edge) => nodeById(dir === "in" ? edge.from.node : edge.to.node)?.title ?? "?").join(", ");
    row.textContent = `${dir === "in" ? "←" : "→"} ${port.label} (${port.kinds.join("/")}): ${others || (port.required ? "nothing wired — this is an error" : "nothing wired")}`;
    if (!edges.length && port.required) row.dataset.problem = "error";
    return row;
  }

  function settingControl(node, setting) {
    const value = node.config?.[setting.key];
    if (setting.type === "boolean") {
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = value !== false;
      box.addEventListener("change", () => { node.config[setting.key] = box.checked; touch(""); });
      return field(setting.label, box, setting.help);
    }
    if (setting.type === "number") {
      const input = document.createElement("input");
      input.type = "number";
      input.value = String(value ?? setting.default ?? 0);
      if (setting.min !== undefined) input.min = String(setting.min);
      if (setting.max !== undefined) input.max = String(setting.max);
      input.addEventListener("change", () => {
        const next = Number(input.value);
        node.config[setting.key] = Number.isFinite(next) ? Math.max(setting.min ?? 0, Math.min(setting.max ?? 1e6, Math.round(next))) : setting.default;
        input.value = String(node.config[setting.key]);
        touch("");
      });
      return field(setting.label, input, setting.help);
    }
    if (setting.type === "enum") {
      const select = document.createElement("select");
      for (const option of setting.options) {
        const item = document.createElement("option");
        item.value = option;
        item.textContent = option;
        if (option === value) item.selected = true;
        select.append(item);
      }
      select.addEventListener("change", () => { node.config[setting.key] = select.value; touch(""); });
      return field(setting.label, select, setting.help);
    }
    if (setting.type === "map") {
      const select = document.createElement("select");
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
      select.addEventListener("change", () => { node.config[setting.key] = select.value; touch(""); });
      const wrap = field(setting.label, select, setting.help);
      if (value) {
        const open = document.createElement("button");
        open.type = "button";
        open.className = "ghost mini";
        open.textContent = "Open that map";
        open.addEventListener("click", () => void load({ id: value }));
        wrap.append(open);
      }
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
        box.checked = chosen.has(kind.kind);
        box.disabled = kind.alwaysAsk || !kind.autoAnswerable;
        box.addEventListener("change", () => {
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
    input.value = String(value ?? "");
    input.addEventListener("input", () => { node.config[setting.key] = clean(input.value, 400); state.dirty = true; renderToolbar(); });
    return field(setting.label, input, setting.help);
  }

  function dangerRow(node) {
    const row = document.createElement("div");
    row.className = "brains-danger";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "ghost mini";
    remove.textContent = "Delete this part";
    remove.addEventListener("click", () => { select({ kind: "node", id: node.id }); deleteSelection(); });
    row.append(remove);
    return row;
  }

  function renderEdgeInspector(edge) {
    if (!edge) return;
    const from = nodeById(edge.from.node);
    const to = nodeById(edge.to.node);
    const head = document.createElement("div");
    head.className = "brains-inspect-head";
    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = "Wire";
    const title = document.createElement("h3");
    title.textContent = `${from?.title ?? edge.from.node} → ${to?.title ?? edge.to.node}`;
    head.append(eyebrow, title);
    el.inspector.append(head, note(`Out of ${edge.from.port}, into ${edge.to.port}.`));
    const feedback = document.createElement("input");
    feedback.type = "checkbox";
    feedback.checked = edge.feedback === true;
    feedback.addEventListener("change", () => {
      if (feedback.checked) edge.feedback = true; else delete edge.feedback;
      touch(feedback.checked ? "This wire now carries into the next pass." : "This wire runs in order again.");
    });
    el.inspector.append(field("Feedback wire", feedback, "A feedback wire closes a loop: what it carries lands on the next pass instead of making the map impossible to order."));
    const row = document.createElement("div");
    row.className = "brains-danger";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "ghost mini";
    remove.textContent = "Delete this wire";
    remove.addEventListener("click", () => deleteSelection());
    row.append(remove);
    el.inspector.append(row);
  }

  function renderMapInspector() {
    const head = document.createElement("div");
    head.className = "brains-inspect-head";
    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = state.map.builtIn ? "Shipped pipeline" : "Brain map";
    const name = document.createElement("input");
    name.type = "text";
    name.className = "brains-title-input";
    name.value = state.map.name;
    name.setAttribute("aria-label", "Map name");
    name.addEventListener("input", () => { state.map.name = clean(name.value, 80) || "Untitled brain"; state.dirty = true; renderToolbar(); });
    head.append(eyebrow, name);
    el.inspector.append(head);

    const description = document.createElement("textarea");
    description.rows = 2;
    description.value = state.map.description ?? "";
    description.placeholder = "What this brain is for";
    description.addEventListener("input", () => { state.map.description = clean(description.value, 240) || null; state.dirty = true; renderToolbar(); });
    el.inspector.append(field("Description", description));
    el.inspector.append(note("Select a part or a wire to see what it may do. Press Space on the canvas to search the parts."));

    const grants = document.createElement("div");
    grants.className = "brains-list";
    const grantsHeading = document.createElement("h4");
    grantsHeading.textContent = "What this map grants";
    grants.append(grantsHeading, note("A part that needs reach this map does not grant is an error, not a quiet widening.", "brains-field-help"));
    for (const item of state.catalog?.permissions ?? []) {
      const needed = state.map.nodes.some((node) => typeOf(node.type)?.permissions.includes(item.key));
      const row = document.createElement("label");
      row.className = "brains-permission";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = state.map.grants.includes(item.key);
      box.addEventListener("change", () => {
        state.map.grants = box.checked ? [...new Set([...state.map.grants, item.key])] : state.map.grants.filter((key) => key !== item.key);
        touch("");
        renderInspector();
      });
      const text = document.createElement("span");
      const label = document.createElement("b");
      label.textContent = `${item.label}${needed ? " · needed" : ""}`;
      const detail = document.createElement("small");
      detail.textContent = item.detail;
      text.append(label, detail);
      row.append(box, text);
      grants.append(row);
    }
    el.inspector.append(grants);

    if (state.compiled?.gates) {
      const gates = document.createElement("div");
      gates.className = "brains-list";
      const heading = document.createElement("h4");
      heading.textContent = "What going live would move";
      gates.append(heading);
      for (const [key, gate] of Object.entries(state.catalog?.gates ?? {})) {
        const value = state.compiled.gates[key];
        const row = document.createElement("p");
        row.className = "brains-gate-row";
        row.textContent = value === null || value === undefined
          ? `${gate.label}: this map says nothing, so it is left alone.`
          : `${gate.label}: ${value === true ? "on" : value === false ? "off" : value}. ${gate.detail}`;
        gates.append(row);
      }
      el.inspector.append(gates);
    }

    const stats = document.createElement("p");
    stats.className = "brains-note quiet";
    stats.textContent = `${state.map.nodes.length} parts · ${state.map.edges.length} wires · ${state.compiled?.feedback?.length ?? 0} feedback`;
    el.inspector.append(stats);

    if (state.map.builtIn) {
      const row = document.createElement("div");
      row.className = "brains-danger";
      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "ghost mini";
      reset.textContent = "Reset to the shipped pipeline";
      reset.addEventListener("click", () => void resetMap());
      row.append(reset);
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
      el.problems.append(note(state.map ? "No problems. This map can go live." : "", "brains-problem ok"));
      return;
    }
    for (const problem of [...errors, ...warnings].slice(0, 8)) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "brains-problem";
      row.dataset.level = problem.level;
      row.textContent = problem.fix ? `${problem.text} ${problem.fix}` : problem.text;
      row.addEventListener("click", () => {
        if (problem.nodeId) select({ kind: "node", id: problem.nodeId });
        else if (problem.edgeId) select({ kind: "edge", id: problem.edgeId });
        scrollTo(problem.nodeId);
      });
      el.problems.append(row);
    }
    if (state.problems.length > 8) el.problems.append(note(`…and ${state.problems.length - 8} more.`, "brains-problem"));
  }

  function scrollTo(nodeId) {
    const node = nodeById(nodeId);
    if (!node || !el.canvasWrap) return;
    el.canvasWrap.scrollTo({ left: Math.max(0, node.x - 200), top: Math.max(0, node.y - 160), behavior: "smooth" });
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
    }
    const live = state.map && state.map.id === state.activeId;
    if (el.save) el.save.disabled = state.busy || !state.map || !state.dirty;
    if (el.activate) {
      el.activate.disabled = state.busy || !state.map || live || state.problems.some((item) => item.level === "error");
      el.activate.textContent = live ? "This map is live" : "Make this live";
    }
    if (el.deleteMap) el.deleteMap.disabled = state.busy || !state.map || state.map.builtIn;
    if (el.dirty) el.dirty.hidden = !state.dirty;
    if (el.liveTag) {
      el.liveTag.hidden = !live;
      el.liveTag.textContent = live ? "Live pipeline" : "";
    }
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

  // ---- host actions -------------------------------------------------------------

  async function save() {
    const api = bridge();
    if (!api?.brainsSave || !state.map || state.busy) return;
    state.busy = true;
    renderToolbar();
    try {
      const result = await api.brainsSave(state.map);
      if (!result?.ok) { status(result?.error ?? "That map could not be saved.", "warn"); return; }
      state.map = result.map;
      state.compiled = result.compiled ?? null;
      state.problems = result.compiled?.problems ?? [];
      state.dirty = false;
      const list = await api.brainsState();
      state.maps = list?.maps ?? state.maps;
      state.activeId = list?.activeId ?? state.activeId;
      status(`Saved "${state.map.name}".`);
    } catch (error) {
      status(`Could not save: ${error.message}`, "warn");
    } finally {
      state.busy = false;
      renderAll();
    }
  }

  // Activating moves real switches, so the owner sees the list first and says
  // yes to it. Nothing about a map is applied behind their back.
  async function activate() {
    const api = bridge();
    if (!api?.brainsActivate || !state.map || state.busy) return;
    if (state.dirty) await save();
    let plan = null;
    try { plan = await api.brainsGatePlan(state.map.id); } catch { plan = null; }
    const moves = plan?.moves ?? [];
    const summary = moves.length
      ? moves.map((move) => `• ${move.label}: ${describeGate(move.from)} → ${describeGate(move.to)}`).join("\n")
      : "• nothing — the switches already match this map";
    const confirmed = window.confirm(`Make "${state.map.name}" the live pipeline?\n\nThis moves:\n${summary}\n\nThe decision rules in it apply to the next issue an agent raises.`);
    if (!confirmed) { status("Left the live pipeline as it was."); return; }
    state.busy = true;
    renderToolbar();
    try {
      const result = await api.brainsActivate(state.map.id, { applyGates: true });
      if (!result?.ok) { status(result?.error ?? "That map could not go live.", "warn"); return; }
      state.activeId = state.map.id;
      status(result.moved?.length ? `"${state.map.name}" is live · moved ${result.moved.join(", ")}.` : `"${state.map.name}" is live.`);
      await load({ id: state.map.id, keepSelection: true });
    } catch (error) {
      status(`Could not activate: ${error.message}`, "warn");
    } finally {
      state.busy = false;
      renderToolbar();
    }
  }

  const describeGate = (value) => (value === true ? "on" : value === false ? "off" : value === null || value === undefined ? "untouched" : String(value));

  async function newMap({ from = null } = {}) {
    const api = bridge();
    if (!api?.brainsSave) return;
    const name = window.prompt(from ? "Name for the copy" : "Name for the new brain map", from ? `${from.name} copy` : "New brain");
    if (!name) return;
    const id = `map_${Date.now().toString(36)}`;
    const map = from
      ? { ...structuredClone(from), id, name: clean(name, 80), builtIn: false, active: false }
      : { schema: 1, id, name: clean(name, 80), description: null, builtIn: false, active: false, grants: [], nodes: [], edges: [] };
    state.busy = true;
    try {
      const result = await api.brainsSave({ ...map, allowEmpty: true });
      if (!result?.ok) { status(result?.error ?? "That map could not be created.", "warn"); return; }
      await load({ id: result.map.id });
      status(from ? `Copied to "${result.map.name}".` : `Created "${result.map.name}". Press Space on the canvas to add its first part.`);
    } finally {
      state.busy = false;
      renderToolbar();
    }
  }

  async function removeMap() {
    const api = bridge();
    if (!api?.brainsDelete || !state.map || state.map.builtIn) return;
    if (!window.confirm(`Delete "${state.map.name}"? This cannot be undone.`)) return;
    const result = await api.brainsDelete(state.map.id);
    if (!result?.ok) { status(result?.error ?? "That map could not be deleted.", "warn"); return; }
    await load({ id: null });
    status("Deleted.");
  }

  async function resetMap() {
    const api = bridge();
    if (!api?.brainsReset || !state.map?.builtIn) return;
    if (!window.confirm("Reset this map to the shipped pipeline? Your changes to it are lost.")) return;
    const result = await api.brainsReset(state.map.id);
    if (!result?.ok) { status(result?.error ?? "That map could not be reset.", "warn"); return; }
    await load({ id: state.map.id });
    status("Reset to the shipped pipeline.");
  }

  async function draft() {
    const api = bridge();
    if (!api?.brainsDraft || state.busy) return;
    const text = window.prompt("What should this brain do?\n\nThe assistant drafts it from the same parts catalog; you review the result before anything is saved.");
    if (!text) return;
    state.busy = true;
    status("Drafting…");
    renderToolbar();
    try {
      const result = await api.brainsDraft(text);
      if (!result?.ok) { status(result?.error ?? "The draft failed.", "warn"); return; }
      state.map = result.map;
      state.compiled = result.compiled ?? null;
      state.problems = result.compiled?.problems ?? [];
      state.dirty = true;
      state.selection = null;
      status(`Drafted${result.model ? ` by ${result.model}` : ""}. Nothing is saved yet — read it, fix what it got wrong, then Save.`);
    } catch (error) {
      status(`Could not draft: ${error.message}`, "warn");
    } finally {
      state.busy = false;
      renderAll();
    }
  }

  // ---- open / close -------------------------------------------------------------

  async function open(params = {}) {
    if (!initialized) init();
    window.MefiNav?.claim?.("brains");
    el.overlay.hidden = false;
    await load({ id: typeof params?.mapId === "string" ? params.mapId : null });
    if (params?.nodeType) {
      const node = state.map?.nodes.find((item) => item.type === params.nodeType);
      if (node) { select({ kind: "node", id: node.id }); scrollTo(node.id); }
    }
    el.canvasWrap?.focus?.({ preventScroll: true });
  }

  function close() {
    if (!el.overlay || el.overlay.hidden) return;
    if (state.dirty && !window.confirm("This brain map has unsaved changes. Close anyway?")) return;
    el.overlay.hidden = true;
    closeSearch();
    window.MefiNav?.release?.("brains");
  }

  // ---- input --------------------------------------------------------------------

  function onCanvasPointerDown(event) {
    const port = event.target?.closest?.(".brains-port");
    if (port) return;
    const head = event.target?.closest?.(".brains-node-head");
    const box = event.target?.closest?.(".brains-node");
    if (!box) {
      if (event.target === el.canvas || event.target === el.canvasWrap) {
        state.pending = null;
        select(null);
      }
      return;
    }
    select({ kind: "node", id: box.dataset.node });
    if (!head) return;
    const node = nodeById(box.dataset.node);
    if (!node) return;
    state.drag = { id: node.id, dx: event.clientX - box.getBoundingClientRect().left, dy: event.clientY - box.getBoundingClientRect().top };
    box.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function onCanvasPointerMove(event) {
    if (!state.drag) return;
    const node = nodeById(state.drag.id);
    if (!node) return;
    const rect = el.canvas.getBoundingClientRect();
    node.x = Math.max(0, Math.round((event.clientX - rect.left - state.drag.dx) / GRID) * GRID);
    node.y = Math.max(0, Math.round((event.clientY - rect.top - state.drag.dy) / GRID) * GRID);
    state.dirty = true;
    renderCanvas();
  }

  function onCanvasPointerUp() {
    if (!state.drag) return;
    state.drag = null;
    renderToolbar();
  }

  function onCanvasClick(event) {
    const port = event.target?.closest?.(".brains-port");
    if (port) { clickPort(port); return; }
    const wire = event.target?.closest?.(".brains-wire");
    if (wire) { select({ kind: "edge", id: wire.dataset.edge }); return; }
  }

  function typing(target) {
    return Boolean(target?.closest?.("input, textarea, select, [contenteditable]"));
  }

  function onKey(event) {
    if (!el.overlay || el.overlay.hidden) return;
    if (state.search.open) {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeSearch(); return; }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        state.search.index += event.key === "ArrowDown" ? 1 : -1;
        renderSearch();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const part = searchMatches()[state.search.index];
        if (part) { addNode(part.type, state.search.at); closeSearch(); }
        return;
      }
      return;
    }
    if (typing(event.target)) return;
    if (event.key === " " || event.code === "Space") {
      event.preventDefault();
      event.stopPropagation();
      openSearch();
      return;
    }
    if (event.key === "Escape" && state.pending) {
      event.preventDefault();
      event.stopPropagation();
      state.pending = null;
      status("Wire cancelled.");
      renderCanvas();
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && state.selection) {
      event.preventDefault();
      event.stopPropagation();
      deleteSelection();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      event.stopPropagation();
      void save();
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
    })) el[key] = document.getElementById(id);
    if (!el.overlay) return;
    el.close?.addEventListener("click", close);
    el.overlay.addEventListener("click", (event) => { if (event.target === el.overlay) close(); });
    el.save?.addEventListener("click", () => void save());
    el.activate?.addEventListener("click", () => void activate());
    el.newMap?.addEventListener("click", () => void newMap());
    el.duplicate?.addEventListener("click", () => void newMap({ from: state.map }));
    el.deleteMap?.addEventListener("click", () => void removeMap());
    el.draft?.addEventListener("click", () => void draft());
    el.switcher?.addEventListener("change", () => void load({ id: el.switcher.value }));
    el.partsSearch?.addEventListener("input", () => { state.partsQuery = el.partsSearch.value; renderParts(); });
    el.canvas?.addEventListener("pointerdown", onCanvasPointerDown);
    el.canvas?.addEventListener("click", onCanvasClick);
    el.wires?.addEventListener("click", onCanvasClick);
    window.addEventListener("pointermove", onCanvasPointerMove);
    window.addEventListener("pointerup", onCanvasPointerUp);
    el.canvasWrap?.addEventListener("dblclick", (event) => {
      if (event.target !== el.canvas && event.target !== el.canvasWrap) return;
      const rect = el.canvas.getBoundingClientRect();
      openSearch({ x: Math.round((event.clientX - rect.left) / GRID) * GRID, y: Math.round((event.clientY - rect.top) / GRID) * GRID });
    });
    el.searchInput?.addEventListener("input", () => { state.search.query = el.searchInput.value; state.search.index = 0; renderSearch(); });
    el.search?.addEventListener("click", (event) => { if (event.target === el.search) closeSearch(); });
    document.addEventListener("keydown", onKey, true);
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
