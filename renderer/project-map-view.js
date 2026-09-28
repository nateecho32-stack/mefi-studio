// Project map navigation: evidence-backed relationships and a living work tree.
// The host owns discovery and grouping; this view never starts work itself.
(() => {
  "use strict";
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const element = (tag, name, text) => {
    const el = document.createElement(tag); el.className = name;
    if (text != null) el.textContent = text;
    return el;
  };
  const button = (name, text, title, action) => {
    const el = element("button", name, text); el.type = "button";
    el.title = title; el.setAttribute("aria-label", title); el.addEventListener("click", action); return el;
  };
  const keyOf = (location) => JSON.stringify([location.systemId, location.partId]);

  // Connected systems share a branch. Activity and scan ordering never shuffle
  // the geometry; only new relationship evidence can change the topology.
  function relationshipLayout(rows, links) {
    const byId = new Map(rows.map(row => [row.id, row]));
    const adjacent = new Map(rows.map(row => [row.id, new Set()]));
    const edges = links.filter(link => link.a !== link.b && byId.has(link.a) && byId.has(link.b));
    for (const edge of edges) { adjacent.get(edge.a).add(edge.b); adjacent.get(edge.b).add(edge.a); }
    const order = (a, b) => adjacent.get(b).size - adjacent.get(a).size || String(a).localeCompare(String(b));
    const visited = new Set(), nodes = [], regions = [];
    let top = 46, maxX = 250;
    for (const root of [...byId.keys()].filter(id => adjacent.get(id).size).sort(order)) {
      if (visited.has(root)) continue;
      const levels = [], queue = [[root, 0]]; visited.add(root);
      for (let index = 0; index < queue.length; index++) {
        const [id, depth] = queue[index]; (levels[depth] ??= []).push(id);
        for (const next of [...adjacent.get(id)].sort(order)) if (!visited.has(next)) { visited.add(next); queue.push([next, depth + 1]); }
      }
      const height = Math.max(...levels.map(items => items.length)) * 134;
      regions.push({ name: `Connected around ${byId.get(root).name}`, x: 16, y: top - 24 });
      for (let depth = 0; depth < levels.length; depth++) {
        const bucket = levels[depth].sort((a, b) => String(a).localeCompare(String(b)));
        bucket.forEach((id, index) => nodes.push({ row: byId.get(id), x: 125 + depth * 292, y: top + (height - bucket.length * 134) / 2 + index * 134 + 44 }));
        maxX = Math.max(maxX, 250 + depth * 292);
      }
      top += height + 56;
    }
    const unconnected = [...byId.keys()].filter(id => !visited.has(id)).sort((a, b) => String(a).localeCompare(String(b)));
    if (unconnected.length) {
      regions.push({ name: "Connections still to discover", x: 16, y: top - 24 });
      unconnected.forEach((id, index) => nodes.push({ row: byId.get(id), x: 125 + index % 3 * 292, y: top + Math.floor(index / 3) * 134 + 44 }));
      top += Math.ceil(unconnected.length / 3) * 134;
      maxX = Math.max(maxX, 250 + (Math.min(3, unconnected.length) - 1) * 292);
    }
    return { nodes, edges, regions, bounds: { w: maxX + 14, h: Math.max(160, top + 14) } };
  }

  function create({ canvas, stage, tools, minHeight, getMap, getProject, partsOf, rankSystems, linksOf, makeCanvas, palette, rgba, label, still, onSelect, onNavigate, onIdeaSelect }) {
    const widget = { systemId: null, partId: null, file: null, selected: null, hovered: null, view: null, layout: [] };
    const camera = { x: 0, y: 0, scale: 1 }, target = { ...camera };
    let focusId = null, filter = "all", query = "", rows = [], catalog = [], systems = new Map(), parts = new Map();
    let history = [], cursor = -1, project = getProject(), map = null, signature = "", shown = 60;
    let bounds = { w: 1, h: 1 }, pan = null, glide = { x: 0, y: 0 }, lastFrame = 0;
    let transition = null, needsFit = true, fitMode = true, suppressClick = false, moving = false, hoverMoving = false;
    const lifts = new Map();
    let navigatorOpen = false, navigatorTouched = false, width = 0, height = 0;
    let mode = "systems", ideaQuery = "", graphEdges = [], graphRegions = [], hierarchyRoot = null;
    const ideaExpansion = new Map();
    const motion = () => !still() && document.documentElement.dataset.motion !== "off";
    const level = () => widget.partId ? "files" : widget.systemId ? "parts" : "systems";
    const system = () => systems.get(widget.systemId) ?? null;
    const part = () => (parts.get(widget.systemId) ?? []).find(row => row.id === widget.partId) ?? null;
    const focused = () => rows.find(row => row.id === focusId) ?? null;
    const location = () => ({ systemId: widget.systemId, partId: widget.partId, focusId, camera: { ...target }, filter });
    canvas.dataset.viewport = "map"; canvas.tabIndex = 0;
    canvas.setAttribute("aria-label", "Interactive project map");
    canvas.setAttribute("aria-description", "Click to inspect. Double-click or Enter to explore. Arrow keys select, Shift and arrows pan. Drag to move, Control and wheel to zoom. Home fits; Backspace goes up. The contents list provides the same destinations.");
    stage.classList.add("pm-stage");

    const navigation = element("div", "pm-navigation");
    const back = button("ghost mini pm-history", "←", "Back in map (Alt+Left)", () => travel(-1));
    const forward = button("ghost mini pm-history", "→", "Forward in map (Alt+Right)", () => travel(1));
    const up = button("ghost mini pm-history", "↑", "Go up one level (Backspace)", () => parent());
    const trail = element("nav", "ab-map-breadcrumb"); trail.setAttribute("aria-label", "Project map location");
    const browse = button("ghost mini pm-browse", "Browse", "Show or hide map contents", () => setNavigator(!navigatorOpen, true));
    const modes = element("div", "pm-modes"); modes.setAttribute("aria-label", "Map view");
    for (const [id, title] of [["systems", "Systems"], ["ideas", "Ideas tree"]]) {
      const pick = button("pm-mode", title, `Show ${title.toLowerCase()}`, () => setMode(id)); pick.dataset.mode = id; modes.append(pick);
    }
    navigation.append(modes, back, forward, up, trail, browse);
    tools?.prepend(navigation);

    const navigator = element("aside", "pm-navigator"); navigator.setAttribute("aria-label", "Map contents");
    const searchBox = element("div", "pm-search-box");
    const search = element("input", "pm-search"); search.type = "search"; search.placeholder = "Find a system or file…";
    search.setAttribute("aria-label", "Search all project systems, parts and files"); search.autocomplete = "off"; search.spellcheck = false;
    searchBox.append(search);
    const filters = element("div", "pm-filters"); filters.setAttribute("aria-label", "Filter this map level");
    for (const [id, name] of [["all", "All"], ["working", "Working"], ["changed", "Changed"]]) {
      const pick = button("pm-filter", name, name === "All" ? "Show everything" : `Show ${name.toLowerCase()} items`, () => {
        saveStop(); filter = id; focusId = null; rebuildRows(); needsFit = true; syncControls(); inform(); wake();
      }); pick.dataset.filter = id; filters.append(pick);
    }
    const listTitle = element("div", "pm-list-title"); listTitle.setAttribute("role", "status");
    const index = element("div", "ab-map-index pm-list"); index.setAttribute("aria-label", "Visible map items");
    navigator.append(searchBox, filters, listTitle, index); stage.append(navigator);
    const heading = element("div", "pm-scene-heading"); const headingTitle = element("strong", ""), headingMeta = element("span", "");
    heading.append(headingTitle, headingMeta); stage.append(heading);
    const legend = element("div", "pm-legend"); legend.setAttribute("aria-label", "Map relationship legend");
    legend.append(element("span", "pm-legend-link", "Changed together"), element("span", "pm-legend-branch", "Contains"), element("span", "pm-legend-observed", "Agent explored")); stage.append(legend);
    const relationships = element("div", "pm-relationships"); relationships.setAttribute("aria-live", "polite"); navigator.append(relationships);
    const ideaPanel = element("section", "pm-ideas"); ideaPanel.hidden = true; ideaPanel.setAttribute("aria-label", "Ideas and work tree");
    const ideaIntro = element("div", "pm-ideas-intro");
    const ideaHeading = element("div", ""); ideaHeading.append(element("p", "pm-region-kicker", "Growing with your project"), element("h3", "", "Ideas become branches of work"), element("p", "ab-quiet", "Grouped by system, then by progress. Branches move as agents discover files and work moves forward."));
    const ideaSearch = element("input", "pm-search pm-idea-search"); ideaSearch.type = "search"; ideaSearch.placeholder = "Find an idea or task…"; ideaSearch.setAttribute("aria-label", "Search the ideas tree");
    ideaSearch.addEventListener("input", () => { ideaQuery = ideaSearch.value; renderIdeas(); });
    ideaIntro.append(ideaHeading, ideaSearch);
    const ideaRoot = element("div", "pm-idea-root"), ideaBranches = element("div", "pm-idea-branches");
    ideaPanel.append(ideaIntro, ideaRoot, ideaBranches); stage.append(ideaPanel);
    const status = element("span", "pm-status"); status.setAttribute("role", "status"); stage.append(status);
    const controls = element("div", "pm-camera"); controls.setAttribute("aria-label", "Map camera");
    const zoomOut = button("ghost mini", "−", "Zoom out", () => zoomAt(target.scale / 1.25));
    const zoomLabel = button("ghost mini pm-zoom-label", "100%", "Reset zoom to 100 percent", () => zoomAt(1));
    const zoom = element("input", "ab-map-zoom"); zoom.type = "range"; zoom.min = "5"; zoom.max = "240"; zoom.value = "100"; zoom.setAttribute("aria-label", "Map zoom");
    zoom.addEventListener("input", () => zoomAt(Number(zoom.value) / 100));
    const zoomIn = button("ghost mini", "+", "Zoom in", () => zoomAt(target.scale * 1.25));
    const fitButton = button("ghost mini", "Fit", "Fit all visible items (Home)", () => fit(true));
    controls.append(zoomOut, zoomLabel, zoom, zoomIn, fitButton); stage.append(controls);
    const hint = element("div", "pm-hint", "Click to inspect · Double-click to explore · Drag to move"); stage.append(hint);
    const mini = element("canvas", "pm-minimap"); mini.width = 152; mini.height = 98; mini.tabIndex = 0;
    mini.setAttribute("aria-label", "Map overview. Click to move the camera; Enter to fit the map."); stage.append(mini);
    const tooltip = element("div", "ab-tip pm-tooltip"); tooltip.hidden = true; stage.append(tooltip);
    const empty = element("div", "pm-empty"); empty.hidden = true; stage.append(empty);

    function setMode(next) {
      mode = next === "ideas" ? "ideas" : "systems"; stage.dataset.mode = mode; navigation.dataset.mode = mode;
      const pane = stage.closest(".agent-brain-pane"); if (pane) pane.dataset.mapMode = mode;
      ideaPanel.hidden = mode !== "ideas"; tooltip.hidden = true;
      for (const pick of modes.children) pick.setAttribute("aria-pressed", String(pick.dataset.mode === mode));
      syncControls(); if (mode === "ideas") renderIdeas(); else wake();
      onNavigate?.();
    }
    function renderIdeas() {
      const tree = map?.ideaTree ?? { groups: [], counts: {} }, words = ideaQuery.toLowerCase().trim().split(/\s+/).filter(Boolean);
      const matches = item => words.every(word => `${item.title} ${item.summary ?? ""} ${item.status ?? ""}`.toLowerCase().includes(word)) || (item.children ?? []).some(matches);
      const groups = tree.groups ?? [], counts = tree.counts ?? {};
      const active = document.activeElement, focusKey = ideaBranches.contains(active) ? active?.dataset.ideaAction : null;
      ideaRoot.replaceChildren(element("strong", "", "Your next version"), element("span", "", `${counts.ideas ?? 0} ideas · ${counts.queued ?? 0} queued · ${counts.active ?? 0} in progress · ${counts.done ?? 0} completed`));
      if (tree.truncated) ideaRoot.append(element("small", "pm-idea-match", `${tree.truncated} older items are available in Work.`));
      ideaBranches.replaceChildren();
      const disclosure = (name, title, key, count, open = true) => {
        const branch = element("details", name); branch.open = words.length > 0 || (ideaExpansion.get(key) ?? open);
        const summary = element("summary", ""); summary.append(element("span", "", title), element("small", "", String(count))); branch.append(summary);
        branch.addEventListener("toggle", () => { if (!words.length && branch.isConnected) ideaExpansion.set(key, branch.open); }); return branch;
      };
      function appendItem(parent, item, group, seen = new Set()) {
        if (seen.has(item.id)) return;
        const nextSeen = new Set(seen); nextSeen.add(item.id);
        const li = element("li", "pm-idea-node"); li.dataset.stage = item.stage || "ideas";
        const card = element("article", "pm-idea-card");
        const meta = element("div", "pm-idea-meta"); meta.append(element("span", "", item.kind === "task" ? "Task" : "Idea"), element("span", "", String(item.status || item.stage || "idea").replace(/[-_]/g, " ")));
        card.append(meta, element("strong", "pm-idea-title", item.title || "Untitled idea"));
        if (item.summary) card.append(element("p", "", item.summary));
        const matchLabel = { inferred: "Suggested grouping", placed: "Placed by you", files: "Matched to files", observed: "Agent discovered", linked: "Linked to work", unmapped: "Still finding its place" }[item.match];
        if (matchLabel) card.append(element("small", "pm-idea-match", matchLabel));
        if (onIdeaSelect) {
          const act = button("ghost mini pm-idea-action", "Work with Mefi", `Work with Mefi on ${item.title || "this idea"}`, () => onIdeaSelect(item, group)); act.dataset.ideaAction = item.id; card.append(act);
        }
        li.append(card);
        const children = (item.children ?? []).filter(child => !words.length || matches(child));
        if (children.length) {
          const branch = disclosure("pm-idea-children", "Related work", `node:${item.id}`, children.length);
          const list = element("ul", "pm-idea-items"); for (const child of children) appendItem(list, child, group, nextSeen); branch.append(list); li.append(branch);
        }
        parent.append(li);
      }
      for (const group of groups) {
        const stages = (group.stages ?? []).map(row => ({ ...row, items: (row.items ?? []).filter(item => !words.length || matches(item)) })).filter(row => row.items.length);
        if (!stages.length) continue;
        const branch = disclosure("pm-idea-group", group.name, `group:${group.id}`, stages.reduce((count, row) => count + row.items.length, 0)); branch.dataset.group = group.id;
        if (group.systemId && systems.has(group.systemId)) branch.append(button("ab-link pm-idea-system", "Explore system →", `Explore ${group.name}`, () => { setMode("systems"); go({ systemId: group.systemId }); }));
        for (const row of stages) {
          const stageBranch = disclosure("pm-idea-phase", row.name, `stage:${group.id}:${row.id}`, row.items.length, row.id !== "done"); stageBranch.dataset.stage = row.id;
          const items = element("ul", "pm-idea-items"); for (const item of row.items) appendItem(items, item, group); stageBranch.append(items); branch.append(stageBranch);
        }
        ideaBranches.append(branch);
      }
      if (!ideaBranches.children.length) ideaBranches.append(element("p", "pm-ideas-empty", words.length ? "No ideas or tasks match this search." : "Your first idea starts a branch. Ask Mefi in Vibe to modify, experiment, fix or improve something; saved ideas and tasks will grow here."));
      if (focusKey) [...ideaBranches.querySelectorAll("[data-idea-action]")].find(item => item.dataset.ideaAction === focusKey)?.focus({ preventScroll: true });
    }

    function wake() {
      if (!motion()) { Object.assign(camera, target); transition = null; glide = { x: 0, y: 0 }; lifts.clear(); hoverMoving = false; }
      widget.view?.paint(); widget.view?.kick();
    }
    function setNavigator(open, touched = false) {
      navigatorOpen = open; navigatorTouched ||= touched;
      navigator.hidden = !open; browse.setAttribute("aria-expanded", String(open)); stage.dataset.browse = String(open);
      if (width > 650) { needsFit = fitMode; wake(); }
    }
    function visibleArea() {
      const left = navigatorOpen && width > 650 ? 230 : 18;
      const top = height < 280 ? 66 : 112, bottom = height < 280 ? 55 : 80;
      return { left, top, w: Math.max(80, width - left - 22), h: Math.max(35, height - top - bottom) };
    }
    function buildCatalog() {
      systems = new Map((map?.systems ?? []).map(row => [row.id, row])); parts = new Map(); catalog = [];
      for (const row of rankSystems(map)) {
        const systemRow = { id: row.id, kind: "system", name: row.name || row.id, path: row.path || "Project root", systemId: row.id, partId: null,
          subtitle: `${row.fileCount ?? 0} files${row.tasks?.active ? ` · ${row.tasks.active} working` : ""}`, present: row.fileCount ?? 0, active: row.tasks?.active ?? 0, hot: row.edits ?? row.heat ?? row.warmth ?? 0, value: row };
        catalog.push(systemRow);
        const grouped = partsOf(row); parts.set(row.id, grouped);
        for (const group of grouped) {
          const partRow = { id: group.id, kind: "part", name: group.name, path: `${row.path || ""}${group.id === ":files" ? "" : group.id + "/"}`, systemId: row.id, partId: group.id,
            subtitle: `${group.present} files · ${group.hot} changes`, present: group.present, active: systemRow.active, hot: group.hot, value: group };
          catalog.push(partRow);
          for (const file of group.files) catalog.push({ id: file.path, kind: "file", name: file.path.split("/").pop(), path: file.path, systemId: row.id, partId: group.id,
            subtitle: file.present === false ? "Removed file" : file.edits ? `${file.edits} ${file.edits === 1 ? "change" : "changes"}` : "Present file", present: file.present === false ? 0 : 1, hot: file.edits ?? 0, active: 0, value: file });
        }
      }
      // Search normalisation is done once per scan, never per animation frame.
      for (const row of catalog) row.searchText = `${row.name} ${row.path} ${systems.get(row.systemId)?.name ?? ""}`.toLowerCase();
    }
    function rebuildRows() {
      const kind = { systems: "system", parts: "part", files: "file" }[level()];
      rows = catalog.filter(row => row.kind === kind && (kind === "system" || row.systemId === widget.systemId) && (kind !== "file" || row.partId === widget.partId));
      if (filter === "working") rows = rows.filter(row => row.active);
      if (filter === "changed") rows = rows.filter(row => row.hot > 0);
      if (focusId && !rows.some(row => row.id === focusId)) focusId = null;
      shown = 60; layout();
    }
    function layout() {
      hierarchyRoot = null;
      if (level() === "systems") {
        const graph = relationshipLayout(rows, linksOf(map));
        widget.layout = graph.nodes; graphEdges = graph.edges; graphRegions = graph.regions; bounds = graph.bounds; return;
      }
      // The parent and its visible containment branches stay on the map when
      // drilling down. Large folders grow vertically and remain searchable.
      const ordered = [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const columns = Math.min(5, Math.max(1, Math.ceil(Math.sqrt(rows.length))));
      bounds = { w: Math.max(264, Math.min(columns, rows.length) * 254 + 20), h: Math.max(220, Math.ceil(rows.length / columns) * 146 + 150) };
      hierarchyRoot = { x: bounds.w / 2, y: 45, name: part()?.name || system()?.name || "Project", kind: level() === "files" ? "Part" : "System" };
      widget.layout = ordered.map((row, index) => ({ row, x: 137 + index % columns * 254, y: 184 + Math.floor(index / columns) * 146 }));
      graphEdges = []; graphRegions = [];
    }
    function inform() {
      const row = focused();
      const selectedSystem = system() || systems.get(row?.systemId) || null;
      const selectedPart = part() || (row?.kind === "part" ? row.value : null);
      widget.selected = selectedSystem?.id ?? null; widget.file = row?.kind === "file" ? row.value : null;
      onSelect?.(selectedSystem, selectedPart, widget.file);
    }
    function saveStop() { if (cursor >= 0) history[cursor] = location(); }
    function go(next, { restore = false, direction = 1 } = {}) {
      if (mode !== "systems") setMode("systems");
      if (next.systemId && !systems.has(next.systemId)) return;
      if (next.partId && !(parts.get(next.systemId) ?? []).some(row => row.id === next.partId)) return;
      saveStop();
      const oldLayout = widget.layout, oldCamera = { ...camera };
      const same = keyOf(next) === keyOf(widget);
      widget.systemId = next.systemId ?? null; widget.partId = next.partId ?? null;
      focusId = next.focusId ?? null; filter = next.filter || "all"; query = ""; search.value = ""; widget.hovered = null; tooltip.hidden = true;
      pan = null; glide = { x: 0, y: 0 }; lifts.clear(); rebuildRows();
      if (!same && motion() && oldLayout.length && !restore) transition = { layout: oldLayout, camera: oldCamera, start: performance.now(), direction };
      else transition = null;
      if (restore && next.camera) { Object.assign(target, next.camera); constrain(target); fitMode = false; needsFit = false; }
      else { needsFit = true; fitMode = true; }
      if (!restore && same && cursor >= 0) history[cursor] = location();
      else if (!restore) {
        history = history.slice(0, cursor + 1); history.push(location());
        if (history.length > 80) history.shift(); cursor = history.length - 1;
      }
      syncControls(); inform(); wake();
      onNavigate?.();
      status.textContent = `${part()?.name || system()?.name || "Project"} · ${rows.length} ${level()}`;
      if (width <= 650) setNavigator(false);
    }
    function travel(delta) {
      const next = cursor + delta; if (next < 0 || next >= history.length) return;
      const stop = history[next]; go(stop, { restore: true, direction: delta }); cursor = next; syncControls();
    }
    function parent() {
      if (!widget.systemId) return;
      go({ systemId: widget.partId ? widget.systemId : null, partId: null, focusId: widget.partId || widget.systemId }, { direction: -1 });
    }
    function select(row, reveal = false) {
      if (!row) return;
      focusId = row.id; inform(); updateSelection();
      status.textContent = `${row.name} · ${row.subtitle}${row.kind !== "file" ? " · Enter to explore" : ""}`;
      if (reveal) {
        const at = widget.layout.find(item => item.row.id === row.id), area = visibleArea();
        if (at) {
          target.scale = Math.max(.85, target.scale); target.x = area.left + area.w / 2 - at.x * target.scale;
          target.y = area.top + area.h / 2 - (at.y + 28) * target.scale; fitMode = false; constrain(target);
        }
      }
      wake();
    }
    function activate(row = focused()) {
      if (!row) return;
      if (row.kind === "system") go({ systemId: row.systemId });
      else if (row.kind === "part") go({ systemId: row.systemId, partId: row.partId });
      else {
        if (widget.systemId !== row.systemId || widget.partId !== row.partId || query) go({ systemId: row.systemId, partId: row.partId, focusId: row.id });
        select(row, true);
        if (width <= 650) { setNavigator(false); stage.closest(".agent-brain-pane")?.querySelector(".ab-narrow-open")?.click(); }
      }
    }
    function updateSelection() {
      for (const el of index.querySelectorAll(".ab-index-item")) el.setAttribute("aria-pressed", String(!query && el.dataset.id === focusId));
      relationships.replaceChildren();
      const row = focused();
      relationships.hidden = !row || level() !== "systems";
      if (!row || level() !== "systems") return;
      relationships.append(element("strong", "", "Connected systems"));
      const adjacent = graphEdges.filter(edge => edge.a === row.id || edge.b === row.id);
      for (const edge of adjacent) {
        const other = systems.get(edge.a === row.id ? edge.b : edge.a); if (!other) continue;
        relationships.append(button("ab-link pm-related", `${other.name || other.id} · ${edge.label || "Changed together"}`, `Inspect ${other.name || other.id}: ${edge.label || "Changed together"}`, () => select(rows.find(item => item.id === other.id), true)));
      }
      if (!adjacent.length) relationships.append(element("span", "ab-quiet", "No relationship evidence yet. Connections appear as work touches these systems together."));
    }
    function listRows() {
      if (!query.trim()) return rows;
      const words = query.trim().toLowerCase().split(/\s+/);
      return catalog.filter(row => words.every(word => row.searchText.includes(word))).sort((a, b) => Number(b.name.toLowerCase() === query.toLowerCase()) - Number(a.name.toLowerCase() === query.toLowerCase()) || a.name.localeCompare(b.name));
    }
    function renderIndex() {
      const scroll = index.scrollTop, active = document.activeElement;
      const previousId = index.contains(active) ? active?.dataset.key : null;
      index.replaceChildren(); const results = listRows();
      listTitle.textContent = query.trim() ? `${results.length} results · whole project` : `${results.length} ${level()}`;
      for (const row of results.slice(0, shown)) {
        const line = element("div", "pm-list-row");
        const key = JSON.stringify([row.kind, row.systemId, row.partId, row.id]);
        const pick = button("ab-index-item", "", `${row.name} · ${row.path} · ${row.subtitle}`, () => query.trim() ? activate(row) : select(row, true));
        pick.dataset.id = row.id; pick.dataset.key = key; pick.dataset.kind = row.kind;
        pick.append(element("span", "pm-item-dot", row.kind === "file" ? "·" : "◇"), element("span", "pm-item-name", row.name), element("small", "", query.trim() ? row.path : row.subtitle));
        pick.addEventListener("dblclick", () => activate(row));
        pick.addEventListener("keydown", event => {
          if (event.key === "ArrowRight" || event.key === "Enter") { event.preventDefault(); activate(row); }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); const picks = [...index.querySelectorAll(".ab-index-item")]; picks[clamp(picks.indexOf(pick) + (event.key === "ArrowDown" ? 1 : -1), 0, picks.length - 1)]?.focus();
          }
        });
        line.append(pick);
        if (row.kind !== "file" && !query.trim()) line.append(button("pm-enter", "›", `Explore ${row.name}`, () => activate(row)));
        index.append(line);
      }
      if (results.length > shown) index.append(button("ghost mini pm-more", `Show more (${results.length - shown})`, "Show more map items", () => { shown += 60; renderIndex(); }));
      if (!results.length) index.append(element("p", "ab-quiet pm-no-results", query ? "No matches. Try a file name or a shorter phrase." : "Nothing in this filter. Choose All to see this level."));
      updateSelection(); index.scrollTop = scroll;
      if (previousId) [...index.querySelectorAll(".ab-index-item")].find(el => el.dataset.key === previousId)?.focus({ preventScroll: true });
    }
    function syncControls() {
      back.disabled = mode === "ideas" || cursor <= 0; forward.disabled = mode === "ideas" || cursor >= history.length - 1; up.disabled = mode === "ideas" || !widget.systemId;
      trail.replaceChildren();
      const crumb = (text, action, current) => {
        const el = button("ab-crumb", text, text, action);
        if (current) el.setAttribute("aria-current", "location"); trail.append(el);
      };
      crumb("Project", () => go({}), !widget.systemId);
      if (system()) crumb(system().name || system().id, () => go({ systemId: widget.systemId }), !widget.partId);
      if (part()) crumb(part().name, () => {}, true);
      for (const el of filters.children) el.setAttribute("aria-pressed", String(el.dataset.filter === filter));
      filters.hidden = Boolean(query.trim());
      headingTitle.textContent = part()?.name || system()?.name || "Your project";
      const working = rows.filter(row => row.active).length;
      headingMeta.textContent = `${rows.length} ${level()}${filter !== "all" ? ` · ${filter}` : working ? ` · ${working} working` : ""}${level() === "systems" ? ` · ${graphEdges.length} observed connections` : " · contains the branches below"}`;
      heading.title = part()?.name || system()?.name || "Your project";
      empty.hidden = rows.length > 0; empty.replaceChildren();
      if (!rows.length) {
        empty.append(element("strong", "", filter !== "all" ? "Nothing here matches this filter" : "Your map is ready to grow"), element("p", "", filter !== "all" ? "See everything at this level to keep exploring." : "Refresh files to map the systems in this project."));
        empty.append(button("ghost mini", filter !== "all" ? "Show all" : "Refresh files", "Show project files", () => {
          if (filter !== "all") { filter = "all"; rebuildRows(); syncControls(); wake(); }
          else document.getElementById("agent-brain-map-rebuild")?.click();
        }));
      }
      renderIndex();
      for (const pick of modes.children) pick.setAttribute("aria-pressed", String(pick.dataset.mode === mode));
    }
    search.addEventListener("input", () => { query = search.value; shown = 60; filters.hidden = Boolean(query.trim()); renderIndex(); });
    search.addEventListener("keydown", event => {
      if (event.key === "ArrowDown") { event.preventDefault(); index.querySelector(".ab-index-item")?.focus(); }
      if (event.key === "Enter") { event.preventDefault(); activate(listRows()[0]); }
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); query = ""; search.value = ""; syncControls(); canvas.focus(); }
    });

    function constrain(pose) {
      const area = visibleArea(), margin = 90;
      pose.x = clamp(pose.x, area.left + margin - bounds.w * pose.scale, area.left + area.w - margin);
      pose.y = clamp(pose.y, area.top + margin - bounds.h * pose.scale, area.top + area.h - margin);
    }
    function fit(all = true) {
      const area = visibleArea();
      target.scale = clamp(Math.min(area.w / bounds.w, area.h / bounds.h), all ? .05 : .55, 1.1);
      target.x = area.left + (area.w - bounds.w * target.scale) / 2;
      target.y = area.top + (area.h - bounds.h * target.scale) / 2;
      fitMode = true; needsFit = false; glide = { x: 0, y: 0 }; wake();
    }
    function zoomAt(scale, x, y) {
      const area = visibleArea(); x ??= area.left + area.w / 2; y ??= area.top + area.h / 2;
      scale = clamp(scale, .05, 2.4); const ratio = scale / target.scale;
      target.x = x - (x - target.x) * ratio; target.y = y - (y - target.y) * ratio; target.scale = scale;
      fitMode = false; glide = { x: 0, y: 0 }; constrain(target); wake();
    }
    function panBy(x, y, direct = false) {
      target.x += x; target.y += y; fitMode = false; constrain(target);
      if (direct) Object.assign(camera, target); wake();
    }
    function miniGeometry() {
      const scale = Math.min(136 / bounds.w, 78 / bounds.h);
      return { scale, x: (152 - bounds.w * scale) / 2, y: (98 - bounds.h * scale) / 2 };
    }
    function drawMini(P) {
      const ctx = mini.getContext("2d"), m = miniGeometry(), area = visibleArea();
      ctx.clearRect(0, 0, 152, 98);
      const points = new Map(widget.layout.map(item => [item.row.id, item]));
      ctx.strokeStyle = rgba(P.mint, .7); ctx.lineWidth = 1;
      for (const edge of graphEdges) {
        const a = points.get(edge.a), b = points.get(edge.b); if (!a || !b) continue;
        ctx.beginPath(); ctx.moveTo(m.x + a.x * m.scale, m.y + a.y * m.scale); ctx.lineTo(m.x + b.x * m.scale, m.y + b.y * m.scale); ctx.stroke();
      }
      for (const item of widget.layout) {
        ctx.fillStyle = item.row.id === focusId ? P.bright : item.row.active ? P.live : rgba(P.mint, .48);
        ctx.fillRect(m.x + (item.x - 50) * m.scale, m.y + (item.y - 20) * m.scale, Math.max(3, 100 * m.scale), Math.max(2, 55 * m.scale));
      }
      ctx.fillStyle = rgba(P.bright, .09); ctx.strokeStyle = rgba(P.bright, .9); ctx.lineWidth = 1;
      const x = m.x + (area.left - camera.x) / camera.scale * m.scale, y = m.y + (area.top - camera.y) / camera.scale * m.scale;
      ctx.fillRect(x, y, area.w / camera.scale * m.scale, area.h / camera.scale * m.scale);
      ctx.strokeRect(x, y, area.w / camera.scale * m.scale, area.h / camera.scale * m.scale);
    }
    mini.addEventListener("click", event => {
      const box = mini.getBoundingClientRect(), m = miniGeometry(), area = visibleArea();
      target.x = area.left + area.w / 2 - ((event.clientX - box.left) * 152 / box.width - m.x) / m.scale * target.scale;
      target.y = area.top + area.h / 2 - ((event.clientY - box.top) * 98 / box.height - m.y) / m.scale * target.scale;
      fitMode = false; constrain(target); wake();
    });
    mini.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); fit(true); } });
    function drawScene(ctx, layoutRows, pose, P, alpha = 1, offset = 0) {
      ctx.save(); ctx.globalAlpha = alpha; ctx.translate(pose.x, pose.y + offset); ctx.scale(pose.scale, pose.scale);
      const fontScale = clamp(1 / pose.scale, 1, 1.5);
      if (layoutRows === widget.layout) {
        const positions = new Map(layoutRows.map(item => [item.row.id, item]));
        for (const region of graphRegions) label(ctx, region.name, region.x, region.y, { size: 10 * fontScale, weight: 600, color: P.muted, align: "left" });
        for (const link of graphEdges) {
          const a = positions.get(link.a), b = positions.get(link.b); if (!a || !b) continue;
          const lit = [link.a, link.b].includes(widget.hovered || focusId);
          const direction = b.x >= a.x ? 1 : -1, sameColumn = a.x === b.x;
          const startX = a.x + 108 * direction, endX = b.x - 108 * direction;
          const midX = sameColumn ? a.x + 142 : (startX + endX) / 2, midY = (a.y + b.y) / 2;
          ctx.strokeStyle = rgba(lit ? P.bright : P.mint, lit ? .95 : .58); ctx.lineWidth = (lit ? 2.4 : 1.5) / pose.scale;
          ctx.beginPath(); ctx.moveTo(startX, a.y); ctx.bezierCurveTo(midX, a.y, midX, b.y, sameColumn ? b.x + 108 : endX, b.y); ctx.stroke();
          // All current edges mean shared change evidence, not dependency flow.
          if (pose.scale >= .5 || lit) {
            const text = link.label || "Changed together", size = 9 * fontScale;
            const lines = text === "Changed together" ? ["Changed", "together"] : [text];
            ctx.font = `500 ${size}px system-ui`; const textWidth = Math.max(...lines.map(line => ctx.measureText(line).width)) + 12;
            ctx.fillStyle = P.panel; ctx.beginPath(); ctx.roundRect(midX - textWidth / 2, midY - 15 * fontScale, textWidth, 30 * fontScale, 6); ctx.fill();
            for (let index = 0; index < lines.length; index++) label(ctx, lines[index], midX, midY + (index - (lines.length - 1) / 2) * 11 * fontScale, { size, color: lit ? P.bright : P.muted });
          }
        }
        if (hierarchyRoot && layoutRows.length) {
          const root = hierarchyRoot;
          ctx.strokeStyle = rgba(P.info, .55); ctx.lineWidth = 1.2 / pose.scale; ctx.setLineDash([4, 5]);
          for (const item of layoutRows) {
            ctx.beginPath(); ctx.moveTo(root.x, root.y + 32); ctx.lineTo(root.x, 104); ctx.lineTo(item.x - 120, 104); ctx.lineTo(item.x - 120, item.y); ctx.lineTo(item.x - 108, item.y); ctx.stroke();
          }
          ctx.setLineDash([]); ctx.fillStyle = P.panel; ctx.strokeStyle = rgba(P.info, .7);
          ctx.beginPath(); ctx.roundRect(root.x - 108, root.y - 30, 216, 62, 12); ctx.fill(); ctx.stroke();
          label(ctx, root.kind, root.x, root.y - 11, { size: 10 * fontScale, color: P.info });
          label(ctx, fitText(ctx, root.name, 192, 12 * fontScale), root.x, root.y + 10, { size: 12 * fontScale, weight: 650, color: P.ivory });
          label(ctx, "contains", root.x + 34, 91, { size: 9 * fontScale, color: P.muted });
        }
      }
      for (const item of layoutRows) {
        const screenX = item.x * pose.scale + pose.x, screenY = item.y * pose.scale + pose.y;
        if (screenX < -180 || screenX > width + 180 || screenY < -160 || screenY > height + 100) continue;
        const row = item.row, selected = focusId === row.id, hovered = widget.hovered === row.id;
        const tint = row.active ? P.live : row.hot ? P.mint : P.info;
        const x = item.x, y = item.y - (lifts.get(row.id) || 0);
        ctx.save(); if (!row.present) ctx.globalAlpha *= .55;
        ctx.fillStyle = P.panel; ctx.strokeStyle = selected ? P.bright : rgba(tint, hovered ? .95 : .5); ctx.lineWidth = (selected ? 2 : 1) / pose.scale;
        ctx.beginPath(); ctx.roundRect(x - 108, y - 44, 216, 88, 12); ctx.fill(); ctx.stroke();
        ctx.fillStyle = rgba(tint, selected || hovered ? .15 : .07); ctx.fill();
        ctx.fillStyle = tint; ctx.beginPath(); ctx.arc(x - 93, y - 22, row.active ? 4 : 3, 0, Math.PI * 2); ctx.fill();
        if (pose.scale >= .35) {
          label(ctx, fitText(ctx, row.name, 179, 12 * fontScale), x - 82, y - 22, { size: 12 * fontScale, weight: 650, color: P.ivory, align: "left" });
          label(ctx, fitText(ctx, row.subtitle, 190, 10 * fontScale), x - 93, y + 1, { size: 10 * fontScale, color: P.muted, align: "left" });
          const explored = row.value.exploration;
          const detail = explored ? `${explored.observedFiles} / ${explored.knownFiles} files explored` : row.kind === "system" ? "Explore to see its parts" : row.kind === "part" ? "Explore to see its files" : row.value.reads ? "Agent read this file" : row.hot ? "Work recorded here" : "Not explored yet";
          label(ctx, fitText(ctx, detail, 190, 9 * fontScale), x - 93, y + 24, { size: 9 * fontScale, color: explored?.observedFiles || row.hot ? tint : P.dim, align: "left" });
          if (explored?.knownFiles) {
            ctx.fillStyle = rgba(tint, .14); ctx.fillRect(x - 96, y + 38, 192, 2);
            ctx.fillStyle = tint; ctx.fillRect(x - 96, y + 38, 192 * clamp(explored.observedFiles / explored.knownFiles, 0, 1), 2);
          }
        }
        ctx.restore();
      }
      ctx.restore();
    }
    function fitText(ctx, text, maxWidth, size) {
      let value = String(text ?? ""); ctx.font = `600 ${size}px system-ui`;
      if (ctx.measureText(value).width <= maxWidth) return value;
      while (value.length > 1 && ctx.measureText(value + "…").width > maxWidth) value = value.slice(0, -1);
      return value + "…";
    }
    function draw(ctx, W, H) {
      const now = performance.now(), dt = Math.min(32, now - (lastFrame || now - 16)); lastFrame = now;
      if (width !== W || height !== H) {
        width = W; height = H;
        if (!navigatorTouched) setNavigator(W > 760);
        if (fitMode) needsFit = true;
        stage.dataset.short = String(H < 280);
      }
      if (needsFit) {
        const area = visibleArea(); target.scale = clamp(Math.min(area.w / bounds.w, area.h / bounds.h), height < 280 ? .15 : .55, 1.1);
        target.x = area.left + (area.w - bounds.w * target.scale) / 2; target.y = area.top + Math.max(0, (area.h - bounds.h * target.scale) / 2);
        needsFit = false;
        if (transition) { Object.assign(camera, target); } else if (!moving) Object.assign(camera, target);
      }
      if (!motion()) { Object.assign(camera, target); transition = null; glide.x = 0; glide.y = 0; }
      if (!pan && Math.hypot(glide.x, glide.y) > .02) {
        target.x += glide.x * dt; target.y += glide.y * dt; constrain(target);
        const decay = Math.exp(-dt / 135); glide.x *= decay; glide.y *= decay;
      } else if (!pan) { glide.x = 0; glide.y = 0; }
      const blend = 1 - Math.exp(-dt / (document.documentElement.dataset.motion === "calm" ? 45 : 72));
      if (widget.hovered && !lifts.has(widget.hovered)) lifts.set(widget.hovered, 0);
      hoverMoving = false;
      for (const [id, value] of lifts) {
        const aim = id === widget.hovered && motion() ? 8 : 0;
        const next = Math.abs(value - aim) < .05 ? aim : value + (aim - value) * blend;
        if (next !== aim) hoverMoving = true;
        if (!next && !aim) lifts.delete(id); else lifts.set(id, next);
      }
      moving = false;
      for (const key of ["x", "y", "scale"]) {
        const tolerance = key === "scale" ? .0005 : .08;
        if (Math.abs(camera[key] - target[key]) < tolerance) camera[key] = target[key];
        else { camera[key] += (target[key] - camera[key]) * blend; moving = true; }
      }
      const P = palette(); ctx.fillStyle = P.bg; ctx.fillRect(0, 0, W, H);
      const pitch = Math.max(24, 48 * camera.scale), offsetX = camera.x % pitch, offsetY = camera.y % pitch;
      ctx.fillStyle = rgba(P.mint, .15);
      for (let x = offsetX; x < W; x += pitch) for (let y = offsetY; y < H; y += pitch) ctx.fillRect(x, y, 1, 1);
      let enter = 1;
      if (transition) {
        const progress = clamp((now - transition.start) / (document.documentElement.dataset.motion === "calm" ? 180 : 360), 0, 1);
        enter = 1 - Math.pow(1 - progress, 3);
        drawScene(ctx, transition.layout, transition.camera, P, 1 - enter, -24 * enter * transition.direction);
        if (progress === 1) transition = null;
      }
      drawScene(ctx, widget.layout, camera, P, enter, transition ? 30 * (1 - enter) * transition.direction : 0);
      if (camera.scale < .4 && rows.length && H >= 280) label(ctx, "Zoom in or use Browse to see file names", W / 2, H - 78, { size: 12, color: P.muted });
      const percent = Math.round(target.scale * 100); zoom.value = String(percent); zoomLabel.textContent = `${percent}%`; zoom.setAttribute("aria-valuetext", `${percent} percent`);
      drawMini(P);
    }
    widget.view = makeCanvas(canvas, draw);
    widget.view.hot = () => moving || Boolean(transition) || Math.hypot(glide.x, glide.y) > .02 || hoverMoving;
    const resize = () => { canvas.style.height = `${Math.max(1, stage.clientHeight || minHeight)}px`; widget.view.resize(); widget.view.kick(); };
    try { new ResizeObserver(resize).observe(stage); } catch {}
    const point = event => { const box = canvas.getBoundingClientRect(); return { x: event.clientX - box.left, y: event.clientY - box.top }; };
    const hit = event => {
      const p = point(event), x = (p.x - camera.x) / camera.scale, y = (p.y - camera.y) / camera.scale;
      return widget.layout.find(item => Math.abs(item.x - x) < 108 && Math.abs(item.y - y) < 44)?.row ?? null;
    };
    canvas.addEventListener("click", event => { if (suppressClick) { suppressClick = false; return; } select(hit(event)); });
    canvas.addEventListener("dblclick", event => { if (!suppressClick) activate(hit(event)); });
    canvas.addEventListener("pointerdown", event => {
      if (event.button !== 0 || !event.isPrimary) return;
      canvas.focus({ preventScroll: true }); Object.assign(target, camera); glide = { x: 0, y: 0 }; transition = null;
      pan = { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, at: performance.now(), moved: false };
      suppressClick = false; canvas.setPointerCapture?.(event.pointerId); wake();
    });
    canvas.addEventListener("pointermove", event => {
      if (pan) {
        if (!pan.moved && Math.hypot(event.clientX - pan.startX, event.clientY - pan.startY) < 5) return;
        const now = performance.now(), dt = Math.max(8, now - pan.at), dx = event.clientX - pan.x, dy = event.clientY - pan.y;
        panBy(dx, dy, true); glide = { x: clamp(dx / dt, -2, 2), y: clamp(dy / dt, -2, 2) };
        pan = { ...pan, x: event.clientX, y: event.clientY, at: now, moved: true }; suppressClick = true;
        tooltip.hidden = true; canvas.style.cursor = "grabbing"; return;
      }
      const row = hit(event);
      if (widget.hovered !== (row?.id ?? null)) { widget.hovered = row?.id ?? null; wake(); }
      canvas.style.cursor = row ? "pointer" : "grab";
      tooltip.hidden = !row;
      if (row) {
        tooltip.replaceChildren(element("strong", "", row.name), element("span", "", row.path), element("span", "ab-quiet", `${row.subtitle} · ${row.kind === "file" ? "Click to inspect" : "Double-click to explore"}`));
        const p = point(event); tooltip.style.left = `${clamp(p.x + 16, 8, width - tooltip.offsetWidth - 8)}px`; tooltip.style.top = `${clamp(p.y + 20, 8, height - tooltip.offsetHeight - 8)}px`;
      }
    });
    function endPan(event) {
      if (!pan) return;
      const released = event.type === "pointerup";
      if (!released || performance.now() - pan.at > 85 || !pan.moved) glide = { x: 0, y: 0 };
      suppressClick ||= pan.moved; pan = null; canvas.style.cursor = "grab"; wake();
    }
    for (const type of ["pointerup", "pointercancel", "lostpointercapture", "blur"]) canvas.addEventListener(type, endPan);
    canvas.addEventListener("pointerleave", () => { widget.hovered = null; tooltip.hidden = true; wake(); });
    canvas.addEventListener("wheel", event => {
      event.preventDefault(); tooltip.hidden = true; const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1;
      if (event.ctrlKey || event.metaKey) { const p = point(event); zoomAt(target.scale * Math.exp(-event.deltaY * unit * .003), p.x, p.y); }
      else { glide = { x: 0, y: 0 }; panBy(-event.deltaX * unit, -event.deltaY * unit); }
    }, { passive: false });
    function keydown(event) {
      if (event.target !== canvas) return;
      const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (event.altKey && ["ArrowLeft", "ArrowRight"].includes(event.key)) travel(event.key === "ArrowLeft" ? -1 : 1);
      else if (directions[event.key]) {
        const [dx, dy] = directions[event.key];
        if (event.shiftKey) panBy(-dx * 100, -dy * 100);
        else {
          const origin = widget.layout.find(item => item.row.id === focusId);
          const next = !origin ? widget.layout[0] : widget.layout.filter(item => (item.x - origin.x) * dx + (item.y - origin.y) * dy > 1).sort((a, b) => {
            const score = item => Math.hypot(item.x - origin.x, item.y - origin.y) + Math.abs((item.x - origin.x) * dy - (item.y - origin.y) * dx) * 3;
            return score(a) - score(b);
          })[0];
          if (next) select(next.row, true);
        }
      } else if (event.key === "Enter") activate();
      else if (event.key === "Backspace" || event.key === "Escape") parent();
      else if (event.key === "Home" || event.key === "0") fit(true);
      else if (["+", "="].includes(event.key)) zoomAt(target.scale * 1.25);
      else if (event.key === "-") zoomAt(target.scale / 1.25);
      else if (event.key === "/") { setNavigator(true, true); search.focus(); }
      else return;
      event.preventDefault(); event.stopPropagation();
    }
    canvas.addEventListener("keydown", keydown);
    // Changes to motion preferences settle an in-flight drag or scene immediately.
    try { new MutationObserver(wake).observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] }); } catch {}
    window.matchMedia?.("(prefers-reduced-motion: reduce)").addEventListener?.("change", wake);
    document.addEventListener("visibilitychange", () => { if (document.hidden) { glide = { x: 0, y: 0 }; pan = null; transition = null; } });
    widget.choose = id => go({ systemId: id });
    widget.explore = () => activate();
    widget.enterPart = id => go({ systemId: widget.selected || widget.systemId, partId: id });
    widget.enterFile = path => { const row = catalog.find(row => row.kind === "file" && row.id === path); if (row) activate(row); };
    widget.overview = () => go({});
    widget.sync = () => {
      const nextProject = getProject();
      if (project !== nextProject) {
        project = nextProject; history = []; cursor = -1; widget.systemId = null; widget.partId = null; focusId = null; filter = "all"; query = ""; search.value = "";
        transition = null; glide = { x: 0, y: 0 }; map = null; signature = ""; needsFit = true; fitMode = true;
        ideaQuery = ""; ideaSearch.value = ""; ideaExpansion.clear(); setMode("systems");
      }
      const nextMap = getMap();
      if (map !== nextMap) { map = nextMap; buildCatalog(); }
      const previousLocation = keyOf(widget);
      if (!systems.has(widget.systemId)) { widget.systemId = null; widget.partId = null; }
      if (widget.partId && !part()) widget.partId = null;
      if (previousLocation !== keyOf(widget)) { needsFit = true; fitMode = true; transition = null; }
      const nextSignature = JSON.stringify([project, widget.systemId, widget.partId, catalog.map(row => [row.id, row.kind, row.subtitle, row.name, row.value.exploration]), map?.links, map?.ideaTree]);
      if (signature !== nextSignature) {
        signature = nextSignature; rebuildRows(); syncControls(); renderIdeas();
        const valid = stop => (!stop.systemId || systems.has(stop.systemId)) && (!stop.partId || (parts.get(stop.systemId) ?? []).some(row => row.id === stop.partId));
        cursor = history.slice(0, cursor + 1).filter(valid).length - 1; history = history.filter(valid);
      }
      if (cursor < 0) { history = [location()]; cursor = 0; syncControls(); }
      inform(); resize();
    };
    // Read-only geometry also lets renderer fixtures verify real camera motion.
    widget.showIdeas = () => setMode("ideas");
    widget.showSystems = () => setMode("systems");
    widget.inspect = () => ({ mode, level: level(), systemId: widget.systemId, partId: widget.partId, selected: focusId, camera: { ...camera }, target: { ...target }, moving: Boolean(widget.view.hot()), history: { index: cursor, length: history.length }, count: rows.length, bounds: { ...bounds }, edges: graphEdges.map(edge => ({ a: edge.a, b: edge.b, label: edge.label || "Changed together" })), nodes: widget.layout.map(item => ({ id: item.row.id, x: item.x * camera.scale + camera.x, y: item.y * camera.scale + camera.y, worldX: item.x, worldY: item.y })) });
    setNavigator(false); stage.dataset.mode = mode; widget.sync(); return widget;
  }
  window.MefiProjectMap = { create, relationshipLayout };
})();
