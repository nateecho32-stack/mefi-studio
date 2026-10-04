// Panes: the windows that pop in and out of Build's Home. A pane is one
// titled surface (Activity, Preview, Output, Checks, Queue, Status) that sits
// docked beside the page, stacked with the other docked panes, or floats over
// the page as a small window you can move and resize, and closes when you are
// done with it. Drag a docked pane's title bar off the dock to pop it out;
// drag a window back over the dock (or double-click its bar) to dock it.
//
// The pane's element moves between the dock and its window, so whatever it
// holds (a draft, a scroll position, an open disclosure) survives the trip.
// Where each pane lives, whether it is folded, and each window's place and
// size are remembered in localStorage (mefiStudio.panes.v1). A pane nobody
// has opened or closed by hand can follow its owner's wish (auto): Activity
// opens while the selected task runs, until you decide otherwise.
//
// Nothing here reads the host. A pane's owner hands over its content and
// keeps painting it; this module only places it. Windows float inside their
// host (Build's Home), so they come and go with that page.
(function () {
  "use strict";
  const STORE = "mefiStudio.panes.v1";
  const MIN_W = 260, MIN_H = 150, KEEP = 56;
  const panes = new Map();
  let dock = null;
  let floats = null;
  let host = null;
  // Closed panes wait here, hidden but still in the document: their owners
  // keep painting them and find their parts by id.
  let shelf = null;
  let raise = 10;
  let saved = load();

  // A stored array would take property writes that JSON.stringify then drops,
  // so only a plain object is a layout.
  function load() { try { const value = JSON.parse(localStorage.getItem(STORE) || "{}"); return value && typeof value === "object" && !Array.isArray(value) ? value : {}; } catch { return {}; } }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(saved)); } catch { /* the layout is a convenience */ } }
  function memory(id) { if (!saved[id] || typeof saved[id] !== "object") saved[id] = {}; return saved[id]; }
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  function glyph(name) {
    const svg = document.createElementNS?.("http://www.w3.org/2000/svg", "svg");
    if (!svg) return el("span", "glyph");
    svg.setAttribute("class", "glyph"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `#${name}`); svg.append(use);
    return svg;
  }
  function tool(name, label, onClick) {
    const button = el("button", `pane-tool pane-${name}`);
    button.type = "button"; button.title = label; button.setAttribute("aria-label", label);
    button.addEventListener("click", (event) => { event.stopPropagation(); onClick(); });
    return button;
  }
  const announce = () => { try { window.dispatchEvent(new CustomEvent("mefi:panes", { detail: { panes: list() } })); } catch { /* no events */ } };

  // A pane record: its definition, its element and where it is now.
  function register(def) {
    if (!def?.id || panes.has(def.id)) return panes.get(def?.id) ?? null;
    const element = el("section", "pane");
    element.dataset.pane = def.id;
    element.setAttribute("role", "region");
    element.setAttribute("aria-label", def.title);
    element.hidden = true;
    const bar = el("header", "pane-bar");
    const title = el("h2", "pane-title", def.title);
    const badge = el("span", "pane-badge"); badge.hidden = true;
    const tools = el("div", "pane-tools");
    const fold = tool("fold", `Fold ${def.title}`, () => setFolded(def.id, !memory(def.id).folded));
    const pop = tool("pop", `Pop ${def.title} out into a window`, () => (where(def.id) === "float" ? dockIn(def.id, { focus: true }) : popOut(def.id, { focus: true })));
    const shut = tool("close", `Close ${def.title}`, () => close(def.id, { focus: true }));
    fold.append(glyph("g-chev")); pop.append(glyph("g-external")); shut.append(glyph("g-close"));
    tools.append(fold, pop, shut);
    bar.append(glyph(def.glyph || "g-frame"), title, badge, tools);
    const body = el("div", "pane-body");
    if (def.content) body.append(def.content);
    const grip = el("span", "pane-grip"); grip.setAttribute("aria-hidden", "true");
    element.append(bar, body, grip);
    const pane = { id: def.id, def, element, bar, body, badge, fold, pop, grip, place: "closed", order: Number.isFinite(def.order) ? def.order : panes.size };
    panes.set(def.id, pane);
    wireDrag(pane); wireResize(pane);
    element.addEventListener("pointerdown", () => { if (pane.place === "float") lift(pane); }, true);
    element.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || pane.place !== "float" || event.defaultPrevented) return;
      if (event.target?.closest?.("select, [aria-expanded=true]")) return;
      event.preventDefault(); event.stopPropagation();
      close(pane.id, { focus: true });
    });
    try { def.build?.(body); } catch (error) { console.warn(`Pane ${def.id} could not build`, error); }
    return pane;
  }

  // The dock beside the page and the layer windows float in. The host is the
  // page they belong to: windows stay inside it and come and go with it.
  function attach({ dock: dockElement, floats: floatLayer, host: hostElement } = {}) {
    if (dockElement) dock = dockElement;
    if (floatLayer) floats = floatLayer;
    if (hostElement) host = hostElement;
    if (host && !shelf) {
      shelf = document.createElement("div");
      shelf.className = "pane-shelf"; shelf.hidden = true; shelf.setAttribute("aria-hidden", "true");
      host.append(shelf);
    }
    for (const pane of panes.values()) place(pane, restingPlace(pane), { quiet: true });
    paintDock();
    announce();
  }

  // Where a pane goes when nothing forces it: its remembered place, else its
  // owner's wish (auto), else closed.
  function restingPlace(pane) {
    const mem = memory(pane.id);
    if (mem.chosen && ["dock", "float", "closed"].includes(mem.where)) return mem.where;
    if (pane.wish) return mem.where === "float" ? "float" : "dock";
    return pane.def.start === "dock" && !mem.chosen ? "dock" : "closed";
  }

  function place(pane, next, { quiet = false } = {}) {
    if (!dock && next === "dock") next = "closed";
    if (!floats && next === "float") next = "dock";
    const was = pane.place;
    pane.place = next;
    const { element } = pane;
    element.dataset.where = next;
    element.classList.toggle("pane-floating", next === "float");
    element.classList.toggle("pane-docked", next === "dock");
    if (next === "closed") {
      element.hidden = true;
      clearGeometry(element);
      if (shelf && element.parentNode !== shelf) shelf.append(element);
      else if (!shelf && element.parentNode) element.remove();
    } else if (next === "dock") {
      element.hidden = false;
      clearGeometry(element);
      const after = [...dock.querySelectorAll(":scope > .pane")].find((other) => (panes.get(other.dataset.pane)?.order ?? 0) > pane.order);
      if (element.parentNode !== dock || element.nextElementSibling !== after) dock.insertBefore(element, after ?? null);
    } else {
      element.hidden = false;
      if (element.parentNode !== floats) floats.append(element);
      applyGeometry(pane);
      lift(pane);
    }
    element.dataset.folded = String(next === "dock" && memory(pane.id).folded === true);
    pane.fold.hidden = next !== "dock";
    pane.pop.title = next === "float" ? `Dock ${pane.def.title} beside the page` : `Pop ${pane.def.title} out into a window`;
    pane.pop.setAttribute("aria-label", pane.pop.title);
    pane.pop.classList.toggle("docks", next === "float");
    pane.fold.setAttribute("aria-expanded", String(memory(pane.id).folded !== true));
    if (was !== next) {
      try { if (next === "closed") pane.def.onHide?.(); else if (was === "closed") pane.def.onShow?.(); } catch { /* the owner repaints next time */ }
    }
    if (!quiet) { paintDock(); announce(); }
  }

  function paintDock() {
    if (!dock) return;
    const docked = [...panes.values()].filter((pane) => pane.place === "dock");
    dock.hidden = !docked.length;
    dock.dataset.count = String(docked.length);
    dock.dataset.open = String(docked.some((pane) => memory(pane.id).folded !== true));
    host?.setAttribute?.("data-dock", docked.length ? "open" : "closed");
  }

  function remember(pane, where) {
    const mem = memory(pane.id);
    mem.where = where; mem.chosen = true;
    save();
  }
  function focusIn(pane) {
    const target = pane.body.querySelector("[autofocus], button:not([disabled]), input, textarea, select, [tabindex='0']") ?? pane.pop;
    requestAnimationFrame?.(() => target?.focus?.({ preventScroll: true }));
  }

  function open(id, { where: next, focus = false } = {}) {
    const pane = panes.get(id);
    if (!pane) return false;
    const mem = memory(id);
    const target = next || (pane.place !== "closed" ? pane.place : mem.where === "float" ? "float" : "dock");
    place(pane, target);
    remember(pane, pane.place);
    if (focus) focusIn(pane);
    return true;
  }
  function close(id, { focus = false } = {}) {
    const pane = panes.get(id);
    if (!pane || pane.place === "closed") return false;
    const was = pane.place;
    place(pane, "closed");
    const mem = memory(id);
    mem.chosen = true; mem.where = "closed"; mem.lastWhere = was;
    save();
    if (focus) document.querySelector?.(`[data-pane-toggle="${id}"]`)?.focus?.({ preventScroll: true });
    return true;
  }
  function toggle(id, options = {}) {
    const pane = panes.get(id);
    if (!pane) return false;
    if (pane.place === "closed") {
      const last = memory(id).lastWhere;
      return open(id, { ...options, where: options.where || (last === "float" ? "float" : "dock") });
    }
    return close(id, options);
  }
  function popOut(id, { focus = false, at = null } = {}) {
    const pane = panes.get(id);
    if (!pane || !floats) return false;
    const mem = memory(id);
    if (at || !Number.isFinite(mem.x)) {
      const box = pane.element.getBoundingClientRect?.();
      const room = floats.getBoundingClientRect?.() ?? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
      const w = Number.isFinite(mem.w) ? mem.w : Math.max(MIN_W, Math.round(box?.width || pane.def.size?.w || 380));
      const h = Number.isFinite(mem.h) ? mem.h : Math.max(MIN_H, Math.round(Math.min(box?.height || 0, 520) || pane.def.size?.h || 360));
      const left = at ? at.x - room.left - Math.min(120, w / 2) : (box?.left ?? room.left + room.width / 2) - room.left - 40;
      const top = at ? at.y - room.top - 16 : (box?.top ?? room.top + 120) - room.top + 24;
      Object.assign(mem, { x: left, y: top, w, h });
    }
    place(pane, "float");
    remember(pane, "float");
    if (focus) focusIn(pane);
    return true;
  }
  function dockIn(id, { focus = false } = {}) {
    const pane = panes.get(id);
    if (!pane || !dock) return false;
    place(pane, "dock");
    remember(pane, "dock");
    if (focus) focusIn(pane);
    return true;
  }
  function setFolded(id, folded) {
    const pane = panes.get(id);
    if (!pane) return;
    memory(id).folded = Boolean(folded); save();
    pane.element.dataset.folded = String(pane.place === "dock" && Boolean(folded));
    pane.fold.setAttribute("aria-expanded", String(!folded));
    paintDock();
  }
  // The owner's wish for a pane nobody has placed by hand: shown while
  // wanted, gone otherwise. A hand-placed pane ignores it.
  function auto(id, wanted) {
    const pane = panes.get(id);
    if (!pane) return;
    pane.wish = Boolean(wanted);
    if (memory(id).chosen) return;
    const next = wanted ? (pane.place === "closed" ? "dock" : pane.place) : "closed";
    if (next !== pane.place) place(pane, next);
  }
  function badge(id, text = "", tone = "") {
    const pane = panes.get(id);
    if (!pane) return;
    const value = String(text ?? "");
    if (pane.badge.textContent !== value) pane.badge.textContent = value;
    pane.badge.hidden = !value;
    if (pane.badge.dataset.tone !== tone) pane.badge.dataset.tone = tone;
  }
  function where(id) { return panes.get(id)?.place ?? "closed"; }
  function list() { return [...panes.values()].sort((a, b) => a.order - b.order).map((pane) => ({ id: pane.id, title: pane.def.title, glyph: pane.def.glyph, where: pane.place })); }
  // Forget every hand placement: panes return to their owners' defaults.
  function reset() {
    saved = {}; save();
    for (const pane of panes.values()) place(pane, restingPlace(pane), { quiet: true });
    paintDock(); announce();
  }

  // ---- windows ----------------------------------------------------------------
  function room() {
    const box = floats?.getBoundingClientRect?.();
    return box && box.width > 0 ? box : { left: 0, top: 0, width: window.innerWidth || 1280, height: window.innerHeight || 800 };
  }
  function clamp(pane, mem = memory(pane.id)) {
    const box = room();
    const w = Math.max(MIN_W, Math.min(Number(mem.w) || pane.def.size?.w || 380, box.width - 16));
    const h = Math.max(MIN_H, Math.min(Number(mem.h) || pane.def.size?.h || 360, box.height - 16));
    const x = Math.max(KEEP - w, Math.min(Number(mem.x) || 0, box.width - KEEP));
    const y = Math.max(0, Math.min(Number(mem.y) || 0, box.height - 40));
    return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
  }
  function applyGeometry(pane) {
    const { x, y, w, h } = clamp(pane);
    const style = pane.element.style;
    style.left = `${x}px`; style.top = `${y}px`; style.width = `${w}px`; style.height = `${h}px`;
  }
  function clearGeometry(element) {
    const style = element.style;
    style.left = style.top = style.width = style.height = style.zIndex = "";
  }
  function lift(pane) {
    raise += 1;
    pane.element.style.zIndex = String(raise);
    for (const other of panes.values()) other.element.classList.toggle("pane-front", other === pane && pane.place === "float");
  }
  // Over the dock, or, with nothing docked, over the host's right edge where
  // the dock would open.
  function overDock(x, y) {
    let box = dock && !dock.hidden ? dock.getBoundingClientRect?.() : null;
    if (!(box?.width > 0)) {
      const page = host?.getBoundingClientRect?.();
      if (!(page?.width > 0)) return false;
      box = { left: page.right - 72, right: page.right, top: page.top, bottom: page.bottom };
    }
    return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
  }
  function dockZone(on) { host?.setAttribute?.("data-dock-target", on ? "on" : "off"); }

  // A title bar drags. Docked, it pops the pane out once the pointer leaves
  // the dock; floating, it moves the window, and letting go over the dock
  // docks it again.
  function wireDrag(pane) {
    const { bar } = pane;
    bar.addEventListener("dblclick", (event) => {
      if (event.target?.closest?.("button")) return;
      if (pane.place === "float") dockIn(pane.id); else if (pane.place === "dock") popOut(pane.id);
    });
    bar.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target?.closest?.("button, input, select, a")) return;
      if (pane.place === "closed") return;
      const start = { x: event.clientX, y: event.clientY };
      let dragging = pane.place === "float";
      let offset = null;
      const mem = memory(pane.id);
      if (dragging) { offset = { x: event.clientX - (Number(mem.x) || 0), y: event.clientY - (Number(mem.y) || 0) }; lift(pane); }
      try { bar.setPointerCapture?.(event.pointerId); } catch { /* not capturable */ }
      pane.element.classList.add("pane-grabbed");
      const move = (next) => {
        if (!dragging) {
          if (Math.hypot(next.clientX - start.x, next.clientY - start.y) < 10) return;
          if (overDock(next.clientX, next.clientY)) return;
          popOut(pane.id, { at: { x: next.clientX, y: next.clientY } });
          // Window coordinates are the host's; the pointer's are the page's.
          offset = { x: next.clientX - (Number(mem.x) || 0), y: next.clientY - (Number(mem.y) || 0) };
          dragging = true;
        }
        mem.x = next.clientX - offset.x; mem.y = next.clientY - offset.y;
        applyGeometry(pane);
        dockZone(overDock(next.clientX, next.clientY));
      };
      const up = (last) => {
        bar.removeEventListener("pointermove", move);
        bar.removeEventListener("pointerup", up);
        bar.removeEventListener("pointercancel", up);
        pane.element.classList.remove("pane-grabbed");
        dockZone(false);
        if (!dragging) return;
        if (last?.type === "pointerup" && overDock(last.clientX, last.clientY)) { dockIn(pane.id); return; }
        Object.assign(mem, clamp(pane, mem));
        save();
      };
      bar.addEventListener("pointermove", move);
      bar.addEventListener("pointerup", up);
      bar.addEventListener("pointercancel", up);
    });
  }
  function wireResize(pane) {
    pane.grip.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || pane.place !== "float") return;
      event.preventDefault(); event.stopPropagation();
      const mem = memory(pane.id);
      const start = { x: event.clientX, y: event.clientY, w: Number(mem.w) || pane.element.offsetWidth, h: Number(mem.h) || pane.element.offsetHeight };
      try { pane.grip.setPointerCapture?.(event.pointerId); } catch { /* not capturable */ }
      pane.element.classList.add("pane-sizing");
      const move = (next) => { mem.w = start.w + next.clientX - start.x; mem.h = start.h + next.clientY - start.y; applyGeometry(pane); };
      const up = () => {
        pane.grip.removeEventListener("pointermove", move);
        pane.grip.removeEventListener("pointerup", up);
        pane.grip.removeEventListener("pointercancel", up);
        pane.element.classList.remove("pane-sizing");
        Object.assign(mem, clamp(pane, mem)); save();
      };
      pane.grip.addEventListener("pointermove", move);
      pane.grip.addEventListener("pointerup", up);
      pane.grip.addEventListener("pointercancel", up);
    });
  }
  // A smaller window keeps every window reachable.
  window.addEventListener?.("resize", () => { for (const pane of panes.values()) if (pane.place === "float") applyGeometry(pane); });

  window.MefiPanes = { register, attach, open, close, toggle, popOut, dockIn, auto, badge, where, list, reset, setFolded, isOpen: (id) => where(id) !== "closed" };
})();
