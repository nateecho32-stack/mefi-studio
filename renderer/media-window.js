// A persistent, borderless home for the Links player. Moving this surface only
// changes geometry: its iframe/video is never reparented or recreated.
(() => {
  "use strict";
  const STORAGE_KEY = "mefiStudio.mediaWindow.v1";
  const GAP = 16;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
  const distance = (point, box) => Math.hypot(Math.max(box.x - point.x, 0, point.x - box.x - box.width), Math.max(box.y - point.y, 0, point.y - box.y - box.height));

  function create({ content, onClose, onSettings }) {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch {}
    let pinned = saved?.pinned === true;
    let avoid = saved?.avoid !== false;
    let box = null, shape = "video", minimized = false, gesture = null;
    let visible = false, hovered = false, yielded = false, awaySince = 0, lastDistance = Infinity, graceUntil = 0;
    let size = {};
    for (const key of ["video", "tall", "compact", "audio"]) {
      const value = saved?.size?.[key];
      if (value && typeof value === "object") size[key] = { width: finite(value.width, undefined), height: finite(value.height, undefined) };
    }
    const now = () => window.performance.now();
    const root = document.createElement("section");
    root.id = "media-window"; root.className = "media-window"; root.hidden = true;
    root.setAttribute("role", "region"); root.setAttribute("aria-label", "Media player");
    const controls = document.createElement("div"); controls.className = "media-window-controls";
    const button = (id, label, title, action) => {
      const node = document.createElement("button");
      node.type = "button"; node.id = `media-window-${id}`; node.textContent = label;
      node.title = title; node.setAttribute("aria-label", title);
      if (action) node.addEventListener("click", action);
      controls.append(node); return node;
    };
    const move = button("move", "⠿", "Move media · drag or use arrow keys (Shift for fine steps)");
    move.className = "media-window-move";
    const pin = button("pin", "Pin", "Pin media in place", () => { pinned = !pinned; paintToggles(); persist(); });
    const dodge = button("avoid", "Move aside", "Move aside near the pointer in menus", () => { avoid = !avoid; yielded = false; paintToggles(); persist(); });
    const minimize = button("minimize", "−", "Minimize media", () => {
      minimized = !minimized; root.dataset.minimized = String(minimized);
      minimize.textContent = minimized ? "↗" : "−";
      minimize.title = minimized ? "Restore media" : "Minimize media";
      minimize.setAttribute("aria-label", minimize.title); minimize.setAttribute("aria-pressed", String(minimized));
      root.setAttribute("aria-label", minimized ? "Media player minimized" : "Media player");
      layout();
    });
    button("close", "×", "Close media and stop playback", () => { hide(); onClose(); });
    const caption = document.createElement("button");
    caption.type = "button"; caption.className = "media-window-caption";
    caption.id = "media-window-settings"; caption.title = "Open Audio settings";
    caption.addEventListener("click", onSettings);
    root.append(content, controls, caption);
    const edges = [];
    for (const edge of ["n", "e", "s", "w", "ne", "se", "sw", "nw"]) {
      const grip = document.createElement("button");
      grip.type = "button"; grip.className = "media-window-resize"; grip.dataset.edge = edge;
      grip.id = `media-window-resize-${edge}`;
      grip.tabIndex = edge === "se" ? 0 : -1;
      grip.setAttribute("aria-label", "Resize media · drag or use arrow keys (Shift for fine steps)");
      grip.title = "Resize media";
      grip.addEventListener("pointerdown", (event) => start(event, edge));
      grip.addEventListener("keydown", (event) => keyboard(event, edge));
      root.append(grip); edges.push(grip);
    }
    document.body.append(root);

    function bounds() {
      // Keep the menu and local navigation reachable even at the 600px app minimum.
      const rail = document.getElementById("app-rail")?.getBoundingClientRect();
      const nav = document.getElementById("app-local-nav")?.getBoundingClientRect();
      const left = rail?.width > 0 ? clamp(rail.right, 0, Math.max(0, window.innerWidth - 320)) : 0;
      return { left: left + GAP, top: Math.max(GAP, (nav?.height > 0 ? nav.bottom : 0) + GAP), right: window.innerWidth - GAP, bottom: window.innerHeight - GAP };
    }
    function limits() {
      const area = bounds();
      const maxWidth = Math.max(1, area.right - area.left), maxHeight = Math.max(1, area.bottom - area.top);
      return { area, maxWidth, maxHeight, minWidth: Math.min(304, maxWidth), minHeight: Math.min(shape === "tall" ? 240 : shape === "audio" ? 104 : 152, maxHeight) };
    }
    function fit(candidate) {
      const { area, maxWidth, maxHeight, minWidth, minHeight } = limits();
      const width = clamp(finite(candidate.width, 440), minWidth, maxWidth);
      const height = clamp(finite(candidate.height, 248), minHeight, maxHeight);
      return { width, height, x: clamp(finite(candidate.x, area.right - width), area.left, area.right - width), y: clamp(finite(candidate.y, area.bottom - height), area.top, area.bottom - height) };
    }
    function visibleBox() { return minimized ? { ...box, width: Math.min(box.width, 304), height: 44 } : box; }
    function layout() {
      if (!box) return;
      box = fit(box);
      const current = visibleBox();
      Object.assign(root.style, { left: `${current.x}px`, top: `${current.y}px`, width: `${current.width}px`, height: `${current.height}px` });
      for (const grip of edges) grip.hidden = minimized;
    }
    function persist() {
      if (!box) return;
      const area = bounds();
      saved = { pinned, avoid, size, x: (box.x - area.left) / Math.max(1, area.right - area.left - box.width), y: (box.y - area.top) / Math.max(1, area.bottom - area.top - box.height) };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch {}
    }
    function paintToggles() {
      pin.setAttribute("aria-pressed", String(pinned)); dodge.setAttribute("aria-pressed", String(avoid));
      pin.title = pinned ? "Unpin media to allow Move aside" : "Pin media in place";
      pin.setAttribute("aria-label", pin.title);
      dodge.title = pinned ? "Move aside is paused while pinned" : "Move aside near the pointer in menus";
    }
    function show(link) {
      root.dataset.dodging = "false";
      const nextShape = link.shape || "video";
      if (!box || nextShape !== shape) {
        shape = nextShape;
        const defaults = shape === "tall" ? { width: 380, height: 352 } : shape === "compact" ? { width: 380, height: 152 } : shape === "audio" ? { width: 380, height: 104 } : { width: 440, height: 248 };
        const preferred = size[shape];
        box = fit({ ...defaults, width: finite(preferred?.width, defaults.width), height: finite(preferred?.height, defaults.height), x: box?.x, y: box?.y });
        const area = bounds();
        box.x = area.left + clamp(finite(saved?.x, 1), 0, 1) * Math.max(0, area.right - area.left - box.width);
        box.y = area.top + clamp(finite(saved?.y, 1), 0, 1) * Math.max(0, area.bottom - area.top - box.height);
      }
      caption.textContent = `${link.label} · Audio settings`;
      content.dataset.shape = shape; root.dataset.shape = shape;
      visible = true; root.hidden = false; layout();
      graceUntil = now() + 1600;
    }
    function hide() {
      if (minimized) minimize.click();
      end(); visible = false; root.hidden = true; hovered = false; yielded = false; awaySince = 0;
    }
    function reveal() {
      if (minimized) minimize.click();
      graceUntil = now() + 1600;
      move.focus({ preventScroll: true });
    }
    function start(event, edge = "move") {
      if (event.button !== 0 || gesture || !visible) return;
      event.preventDefault(); event.stopPropagation();
      gesture = { edge, x: event.clientX, y: event.clientY, box: { ...box }, target: event.currentTarget, pointerId: event.pointerId };
      root.dataset.dodging = "false";
      root.dataset.interacting = "true";
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture?.(event.pointerId);
      graceUntil = now() + 1600;
    }
    function changed(dx, dy, edge, origin) {
      const { area, minWidth, minHeight } = limits();
      if (edge === "move") return fit({ ...origin, x: origin.x + dx, y: origin.y + dy });
      let left = origin.x, top = origin.y, right = origin.x + origin.width, bottom = origin.y + origin.height;
      if (edge.includes("w")) left = clamp(left + dx, area.left, right - minWidth);
      if (edge.includes("e")) right = clamp(right + dx, left + minWidth, area.right);
      if (edge.includes("n")) top = clamp(top + dy, area.top, bottom - minHeight);
      if (edge.includes("s")) bottom = clamp(bottom + dy, top + minHeight, area.bottom);
      return fit({ x: left, y: top, width: right - left, height: bottom - top });
    }
    function end(event) {
      if (!gesture || event && event.pointerId !== gesture.pointerId) return;
      const previous = gesture; gesture = null;
      root.dataset.interacting = "false";
      try { previous.target.releasePointerCapture?.(previous.pointerId); } catch {}
      if (previous.edge !== "move") size = { ...size, [shape]: { width: box.width, height: box.height } };
      persist(); graceUntil = now() + 1600;
    }
    function keyboard(event, edge) {
      const vectors = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (!vectors[event.key] || !box) return;
      event.preventDefault(); event.stopPropagation();
      root.dataset.dodging = "false";
      const step = event.shiftKey ? 2 : 16;
      box = changed(vectors[event.key][0] * step, vectors[event.key][1] * step, edge, box);
      if (edge !== "move") size = { ...size, [shape]: { width: box.width, height: box.height } };
      layout(); persist();
    }
    function deepMenu() {
      const route = window.MefiNav?.top?.() || window.MefiNav?.current?.();
      return route && !["command", "workspace"].includes(route) || document.getElementById("music-dropdown")?.hidden === false || Boolean(document.querySelector(".surface-tools[open], .studio-more[open], .cmd-more-tools[open]"));
    }
    function pointer(event) {
      if (gesture) {
        if (event.pointerId !== gesture.pointerId) return;
        box = changed(event.clientX - gesture.x, event.clientY - gesture.y, gesture.edge, gesture.box);
        layout(); return;
      }
      if (!visible || minimized || event.buttons || event.pointerType && event.pointerType !== "mouse") return;
      const point = { x: event.clientX, y: event.clientY }, gap = distance(point, box), time = now();
      const approaching = gap < lastDistance; lastDistance = gap;
      // After one dodge, following the player always wins. Rearm only after
      // spending time away without approaching it, never while hovered/focused.
      if (yielded) {
        if (hovered || approaching || gap < 180) awaySince = 0;
        else if (!awaySince) awaySince = time;
        else if (time - awaySince > 2400) { yielded = false; awaySince = 0; }
        return;
      }
      if (!avoid || pinned || hovered || root.contains(document.activeElement) || time < graceUntil || !approaching || gap > 52 || !deepMenu()) return;
      if (document.documentElement.dataset.motion === "off" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || document.fullscreenElement) return;
      const area = bounds();
      const candidates = [
        { ...box, x: area.left, y: area.top }, { ...box, x: area.right - box.width, y: area.top },
        { ...box, x: area.left, y: area.bottom - box.height }, { ...box, x: area.right - box.width, y: area.bottom - box.height },
      ].filter((candidate) => distance(point, candidate) > 100);
      candidates.sort((a, b) => Math.hypot(a.x - box.x, a.y - box.y) - Math.hypot(b.x - box.x, b.y - box.y));
      if (!candidates.length) return;
      box = candidates[0]; yielded = true; awaySince = 0; lastDistance = distance(point, box);
      root.dataset.dodging = "true";
      // Automatic motion is transient; only a deliberate move/resize is saved.
      layout();
    }
    move.addEventListener("pointerdown", (event) => start(event));
    move.addEventListener("keydown", (event) => keyboard(event, "move"));
    root.addEventListener("pointerenter", () => { hovered = true; awaySince = 0; });
    root.addEventListener("pointerleave", () => { hovered = false; graceUntil = now() + 1200; });
    root.addEventListener("focusin", () => { awaySince = 0; });
    root.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.stopPropagation(); if (gesture) end(); else document.activeElement?.blur?.(); } });
    for (const node of [move, ...edges]) node.addEventListener("lostpointercapture", end);
    document.addEventListener("pointermove", pointer);
    document.addEventListener("pointerup", end); document.addEventListener("pointercancel", end);
    window.addEventListener("blur", () => { end(); hovered = false; });
    window.addEventListener("resize", () => { end(); root.dataset.dodging = "false"; layout(); });
    window.addEventListener("mefi:shell", layout);
    window.addEventListener("mefi:nav", () => { lastDistance = Infinity; awaySince = 0; root.dataset.dodging = "false"; layout(); });
    paintToggles();
    return { show, hide, reveal };
  }
  window.MefiMediaWindow = { create };
})();
