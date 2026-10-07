// Mefi's Studio AI+ — exit effects for menus (window.MefiEffects).
//
// Menus, pop-ups and the Map's little panels normally fade out when they
// close (the "presence" CSS in styles.css and studio-ui.css). With a menu
// effect from the Shop on, they leave in style instead:
//
//   dissolve   crumbles into pixels from the top down, the dust falling away
//   embers     burns away from the edges inward, a glowing edge and embers rising
//   stardust   sweeps away from one side as drifting, twinkling stars
//
// How: when a known menu gets `hidden` (or a [popover] closes, or a custom
// dropdown is removed through leave()), the element is held where it was for
// the length of the effect (inline !important styles that keep it shown and
// still), and a mask eats it away in steps. Each step's mask is drawn from a
// field over the element's cells: a cell is gone once the effect's progress
// passes its value, so the same field decides where the particles start, on
// a small canvas laid over the element. Nothing here changes what a menu
// does: `hidden` still flips at once (tests and code read it), the pointer
// passes through a leaving menu, and a menu that opens again mid-way is put
// back at once. With motion off, or no effect chosen, nothing happens at all.
//
// The effects are Shop items (renderer/friends-shop.js); owner checks go
// through MefiShop.owns(). The choice lives in localStorage
// mefiStudio.effects.v1 so a restart keeps it.
//
//   list(), current(), use(id | "none"), preview(id, ms), endPreview(),
//   demo(element, id), leave(node)
(function () {
  "use strict";
  const STORE = "mefiStudio.effects.v1";
  const EFFECTS = Object.freeze([
    { id: "dissolve", item: "studio:fx-dissolve", name: "Dissolve", detail: "Menus crumble into pixels when they close.", ms: 430 },
    { id: "embers", item: "studio:fx-embers", name: "Burn away", detail: "Menus burn away from the edges with glowing embers.", ms: 620 },
    { id: "stardust", item: "studio:fx-stardust", name: "Stardust", detail: "Menus scatter into drifting stars.", ms: 560 },
  ]);
  // The menus that leave in style: floating menus, Map panels, pop-ups.
  // Whole pages and sheets keep their plain fade.
  const MENUS = [
    "#app-help-menu", ".surface-tools-menu", ".workspace .ws-project-actions > div", ".brains-menu",
    "#idle-hud .pop", "#idle-hud .legend-list", "#idle-info", ".walkthrough-coach",
    ".gs-pop", ".music-dropdown", ".companion-panel", ".shop-pop", ".studio-menu", "[data-exit-effect]",
  ].join(", ");
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const now = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());

  // ---- the field ----------------------------------------------------------------
  // A cell's value in [0, 1): it disappears once progress passes it.
  function hash(x, y, seed) {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2147483647)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  // Smooth value noise: the hash on a coarser lattice, blended.
  function smooth(x, y, scale, seed) {
    const fx = x / scale, fy = y / scale;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = hash(x0, y0, seed), b = hash(x0 + 1, y0, seed), c = hash(x0, y0 + 1, seed), d = hash(x0 + 1, y0 + 1, seed);
    return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
  }
  function field(kind, columns, rows, seed) {
    const values = new Float32Array(columns * rows);
    for (let j = 0; j < rows; j += 1) {
      for (let i = 0; i < columns; i += 1) {
        const white = hash(i, j, seed);
        let value;
        if (kind === "embers") {
          // Edges first: distance to the nearest edge, roughened.
          const edge = Math.min(i, columns - 1 - i, j, rows - 1 - j) / Math.max(1, Math.min(columns, rows) / 2);
          value = 0.5 * smooth(i, j, 6, seed) + 0.12 * white + 0.38 * clamp(edge, 0, 1);
        } else if (kind === "stardust") {
          value = 0.42 * smooth(i, j, 5, seed) + 0.18 * white + 0.4 * (i / Math.max(1, columns - 1));
        } else {
          value = 0.72 * white + 0.28 * (j / Math.max(1, rows - 1));
        }
        values[j * columns + i] = clamp(value, 0, 0.999);
      }
    }
    return values;
  }

  // ---- masks --------------------------------------------------------------------
  // Each step is a small picture, one pixel per cell, stretched over the
  // element without smoothing so the cells stay crisp.
  let maskCanvas = null;
  function maskAt(values, columns, rows, progress) {
    if (!maskCanvas) maskCanvas = document.createElement("canvas");
    maskCanvas.width = columns; maskCanvas.height = rows;
    const ctx = maskCanvas.getContext?.("2d");
    if (!ctx) return null;
    const image = ctx.createImageData(columns, rows);
    const data = image.data;
    for (let index = 0; index < values.length; index += 1) {
      const alpha = values[index] >= progress ? 255 : 0;
      const at = index * 4;
      data[at] = 255; data[at + 1] = 255; data[at + 2] = 255; data[at + 3] = alpha;
    }
    ctx.putImageData(image, 0, 0);
    try { return maskCanvas.toDataURL("image/png"); } catch { return null; }
  }
  // A plan is one effect's steps for one size of menu: the field and a mask
  // picture per step. A mask picture shows only once it is decoded, so plans
  // are made while a menu is open (prepare) and their pictures decoded and
  // kept; a menu of about the same size reuses one. Sizes go in 16 px steps.
  const STEPS = 14;
  const plans = new Map(); // "kind:columnsxrows" -> plan, oldest first
  function gridOf(rect) {
    const width = Math.ceil(rect.width / 16) * 16, height = Math.ceil(rect.height / 16) * 16;
    const cell = Math.max(4, Math.round(Math.sqrt((width * height) / 6000)));
    return { cell: Math.max(rect.width / Math.ceil(width / cell), 1), columns: Math.max(1, Math.ceil(width / cell)), rows: Math.max(1, Math.ceil(height / cell)), across: rect.width, down: rect.height };
  }
  function planFor(kind, columns, rows) {
    const key = `${kind}:${columns}x${rows}`;
    let plan = plans.get(key);
    if (plan) { plans.delete(key); plans.set(key, plan); return plan; }
    const values = field(kind, columns, rows, (Math.random() * 1e9) | 0);
    const urls = [];
    for (let step = 0; step < STEPS; step += 1) urls.push(maskAt(values, columns, rows, ((step + 1) / STEPS) * 1.08));
    urls.push(maskAt(values, columns, rows, 2));
    const images = urls.map((url) => {
      if (!url || typeof Image !== "function") return null;
      const image = new Image();
      image.src = url;
      image.decode?.().catch(() => { /* shown when it can be */ });
      return image;
    });
    plan = { key, values, columns, rows, urls, images };
    plans.set(key, plan);
    while (plans.size > 24) plans.delete(plans.keys().next().value);
    return plan;
  }
  // Made ahead while a menu is open, so its exit starts at once; the menu's
  // own display is noted too (hold pins it).
  const shownDisplay = new WeakMap();
  function prepare(element) {
    const id = active();
    if (id === "none" || still() || !element?.isConnected || typeof element.getBoundingClientRect !== "function") return false;
    const rect = element.getBoundingClientRect();
    if (!(rect.width > 4 && rect.height > 4)) return false;
    try { const shown = getComputedStyle(element).display; if (shown && shown !== "none") shownDisplay.set(element, shown); } catch { /* not noted */ }
    const grid = gridOf(rect);
    planFor(id, grid.columns, grid.rows);
    return true;
  }
  const soon = typeof requestIdleCallback === "function" ? (fn) => requestIdleCallback(fn, { timeout: 300 }) : (fn) => setTimeout(fn, 80);

  // ---- particles ------------------------------------------------------------------
  function readColours(element) {
    let style = null, root = null;
    try { style = getComputedStyle(element); root = getComputedStyle(document.documentElement); } catch { /* defaults */ }
    const pick = (value) => (value && !/rgba?\(\s*0,\s*0,\s*0,\s*0\)|transparent/.test(value) ? value : null);
    const accent = (root?.getPropertyValue?.("--canvas-accent") || root?.getPropertyValue?.("--gold") || "#e8b04a").trim();
    const second = (root?.getPropertyValue?.("--canvas-accent2") || root?.getPropertyValue?.("--accent-2") || accent).trim();
    const surface = pick(style?.backgroundColor) || (root?.getPropertyValue?.("--surface-raised") || "#2a2f3a").trim();
    const text = style?.color || "#e8e8e8";
    // A crumb is the surface mixed toward the text colour, so it shows on the page behind.
    const a = rgb(surface) || [42, 47, 58], b = rgb(text) || [232, 232, 232];
    const crumb = `rgb(${a.map((value, index) => Math.round(value * 0.62 + b[index] * 0.38)).join(", ")})`;
    return { surface, crumb, text, accent, second };
  }
  function rgb(value) {
    const text = String(value || "").trim();
    const long = /^#([0-9a-f]{6})$/i.exec(text);
    if (long) { const n = parseInt(long[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
    const parts = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text);
    return parts ? [Number(parts[1]), Number(parts[2]), Number(parts[3])] : null;
  }
  function overlay(rect, margin) {
    const canvas = document.createElement("canvas");
    canvas.className = "exit-effect-dust";
    canvas.setAttribute("aria-hidden", "true");
    const dpr = Math.min(2, Math.max(1, Number(window.devicePixelRatio) || 1));
    const width = Math.ceil(rect.width + margin * 2), height = Math.ceil(rect.height + margin * 2);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    canvas.style.transform = `translate3d(${Math.round(rect.left - margin)}px, ${Math.round(rect.top - margin)}px, 0)`;
    document.body.append(canvas);
    const ctx = canvas.getContext?.("2d") ?? null;
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { canvas, ctx, width, height };
  }

  // ---- playing one exit -----------------------------------------------------------
  const playing = new Map(); // element -> run
  const HOLD = [["opacity", "1"], ["translate", "none"], ["scale", "1"], ["pointer-events", "none"]];
  // Holds a closing menu shown, still and in place for the effect's length.
  // Its display is pinned inline (an inline !important outranks [hidden]), so
  // it stays even when something read the page right after it closed and its
  // own short fade had already begun; the value is what it showed as: still
  // there while a display transition runs, or noted by prepare() when it opened.
  function hold(element, ms) {
    // A [popover] keeps its place through the top layer's own transition
    // (beforetoggle comes before it closes), so its display is never pinned.
    let display = null;
    if (!element.matches?.("[popover]")) {
      try { const now = getComputedStyle(element).display; if (now && now !== "none") display = now; } catch { display = null; }
      display ||= shownDisplay.get(element) || null;
    }
    const names = [...HOLD.map(([name]) => name), "transition", "display", "visibility"];
    const saved = names.map((name) => [name, element.style.getPropertyValue(name), element.style.getPropertyPriority(name)]);
    for (const [name, value] of HOLD) element.style.setProperty(name, value, "important");
    element.style.setProperty("transition", `display ${ms}ms allow-discrete, overlay ${ms}ms allow-discrete`, "important");
    if (display) { element.style.setProperty("display", display, "important"); element.style.setProperty("visibility", "visible", "important"); }
    return () => { for (const [name, value, priority] of saved) { if (value) element.style.setProperty(name, value, priority); else element.style.removeProperty(name); } };
  }
  // A menu that left keeps its last, empty mask until it opens again, so
  // letting go of the hold never shows it for the length of its own fade.
  const masked = new WeakSet();
  function unmask(element) {
    if (!masked.has(element)) return;
    masked.delete(element);
    setMask(element, null);
    element.style.removeProperty("image-rendering");
  }
  function setMask(element, url) {
    const value = url ? `url("${url}")` : "";
    for (const prefix of ["", "-webkit-"]) {
      if (!url) { element.style.removeProperty(`${prefix}mask-image`); element.style.removeProperty(`${prefix}mask-size`); element.style.removeProperty(`${prefix}mask-repeat`); continue; }
      element.style.setProperty(`${prefix}mask-image`, value, "important");
      element.style.setProperty(`${prefix}mask-size`, "100% 100%", "important");
      element.style.setProperty(`${prefix}mask-repeat`, "no-repeat", "important");
    }
  }
  // `mode` says what happens around the effect: "exit" holds a closing menu in
  // place until it has gone, "remove" takes the element out at the end (a
  // removed dropdown), "demo" brings it back afterwards (the Shop's cards).
  // The length of an effect, times --exit-effect-pace on the root (1 unless a
  // test or a lab slows it down to look at it).
  function length(effect) {
    let pace = 1;
    try { pace = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--exit-effect-pace")) || 1; } catch { pace = 1; }
    return effect.ms * Math.max(0.1, Math.min(40, pace));
  }
  // Every menu closing at once is held first, then measured: reading one
  // menu's size starts the style change for all of them, and a plain fade
  // that has started cannot be held any more.
  function playAll(elements, id) {
    const effect = EFFECTS.find((item) => item.id === id);
    if (!effect) return;
    const ms = length(effect);
    const held = elements.filter((element) => element?.isConnected).map((element) => { stopRun(element); return [element, hold(element, ms + 40)]; });
    for (const [element, release] of held) play(element, id, { mode: "exit", release, ms });
  }
  function play(element, id, { mode = "exit", release: given = null, ms: known = null } = {}) {
    const effect = EFFECTS.find((item) => item.id === id);
    if (!effect || !element?.isConnected || typeof element.getBoundingClientRect !== "function") { given?.(); return false; }
    if (!given) stopRun(element);
    const ms = known || length(effect);
    const release = given || (mode === "exit" ? hold(element, ms + 40) : () => {});
    const rect = element.getBoundingClientRect();
    if (!(rect.width > 4 && rect.height > 4) || rect.bottom < 0 || rect.right < 0 || rect.top > (window.innerHeight || 1e5) || rect.left > (window.innerWidth || 1e5)) { release(); return false; }
    // About six thousand cells, never smaller than four pixels.
    const grid = gridOf(rect);
    const { values, columns, rows, urls } = planFor(effect.id, grid.columns, grid.rows);
    const cellX = rect.width / columns, cellY = rect.height / rows;
    element.style.setProperty("image-rendering", "pixelated", "important");
    const colours = readColours(element);
    const margin = effect.id === "embers" ? 70 : 90;
    const layer = overlay(rect, margin);
    const bits = [];
    const run = { element, release, layer, raf: 0, done: false, mode, last: 0 };
    playing.set(element, run);
    // The first step goes on now, before the first frame.
    let shown = 0;
    setMask(element, urls[0]);
    const start = now();
    // Particles start from cells as they go: a sample of cells, each with the
    // moment its cell disappears.
    const sample = Math.min(effect.id === "stardust" ? 170 : 240, columns * rows);
    const pending = [];
    for (let n = 0; n < sample; n += 1) {
      const i = Math.floor(Math.random() * columns), j = Math.floor(Math.random() * rows);
      pending.push({ at: values[j * columns + i] / 1.08, x: margin + (i + 0.5) * cellX, y: margin + (j + 0.5) * cellY });
    }
    pending.sort((a, b) => a.at - b.at);
    const tick = () => {
      run.raf = 0;
      if (run.done) return;
      const t = (now() - start) / ms;
      const progress = clamp(t, 0, 1) * 1.08;
      const step = Math.min(STEPS, Math.floor(clamp(t, 0, 1) * STEPS));
      if (step !== shown) { shown = step; setMask(element, urls[step]); }
      if (step >= STEPS) run.complete = true;
      while (pending.length && pending[0].at <= clamp(t, 0, 1)) spawn(effect.id, pending.shift(), bits, colours);
      const at = now();
      const dt = clamp((at - (run.last || at)) / 1000, 0, 0.05);
      run.last = at;
      drawBits(layer, effect.id, bits, values, columns, rows, cellX, cellY, margin, progress, t, dt);
      if (t < 1 || bits.length) run.raf = requestAnimationFrame(tick);
      else finish(run);
    };
    run.raf = requestAnimationFrame(tick);
    return true;
  }
  function spawn(kind, from, bits, colours) {
    let bit;
    if (kind === "embers") {
      bit = { x: from.x, y: from.y, vx: (Math.random() - 0.5) * 30, vy: -30 - Math.random() * 60, life: 0.7 + Math.random() * 0.6, size: 1.2 + Math.random() * 1.8, colour: Math.random() < 0.5 ? "255, 196, 92" : "255, 120, 48" };
    } else if (kind === "stardust") {
      bit = { x: from.x, y: from.y, vx: 20 + Math.random() * 60, vy: -20 - Math.random() * 50, life: 0.8 + Math.random() * 0.7, size: 1.4 + Math.random() * 2.2, colour: Math.random() < 0.5 ? colours.accent : colours.second, star: true, spin: Math.random() * 6 };
    } else {
      // Crumbs of the menu: its own surface lit a little, some of its accent.
      const pick = Math.random();
      const colour = pick < 0.55 ? colours.crumb : pick < 0.8 ? colours.accent : colours.text;
      bit = { x: from.x, y: from.y, vx: (Math.random() - 0.5) * 50, vy: 20 + Math.random() * 50, life: 0.45 + Math.random() * 0.45, size: 2 + Math.random() * 3, colour, square: true, gravity: 520, alpha: pick < 0.8 ? 1 : 0.55 };
    }
    bit.max = bit.life;
    bits.push(bit);
  }
  function drawBits(layer, kind, bits, values, columns, rows, cellX, cellY, margin, progress, t, dt) {
    const { ctx, width, height } = layer;
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    // The burning edge: cells still there that touch a gone one (or the
    // menu's own edge) and are about to go themselves glow.
    if (kind === "embers" && t < 1) {
      ctx.globalCompositeOperation = "lighter";
      const gone = (i, j) => i < 0 || j < 0 || i >= columns || j >= rows || values[j * columns + i] < progress;
      for (let j = 0; j < rows; j += 1) {
        for (let i = 0; i < columns; i += 1) {
          const gap = values[j * columns + i] - progress;
          if (gap < 0 || gap > 0.09) continue;
          if (!(gone(i - 1, j) || gone(i + 1, j) || gone(i, j - 1) || gone(i, j + 1))) continue;
          const heat = 1 - gap / 0.09;
          ctx.fillStyle = `rgba(255, ${Math.round(110 + 120 * heat)}, ${Math.round(30 + 70 * heat)}, ${0.3 + 0.6 * heat})`;
          ctx.fillRect(margin + i * cellX, margin + j * cellY, Math.ceil(cellX), Math.ceil(cellY));
        }
      }
    }
    for (let index = bits.length - 1; index >= 0; index -= 1) {
      const bit = bits[index];
      bit.life -= dt;
      if (bit.life <= 0) { bits.splice(index, 1); continue; }
      bit.vy += (bit.gravity || (kind === "embers" ? -20 : 0)) * dt;
      bit.x += bit.vx * dt; bit.y += bit.vy * dt;
      const fade = clamp(bit.life / bit.max, 0, 1);
      if (bit.square) {
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = fade * (bit.alpha ?? 1);
        ctx.fillStyle = bit.colour;
        ctx.fillRect(bit.x, bit.y, bit.size, bit.size);
      } else if (bit.star) {
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = fade * (0.6 + 0.4 * Math.sin(bit.life * 22 + bit.spin));
        ctx.fillStyle = bit.colour;
        const r = bit.size;
        ctx.beginPath();
        ctx.moveTo(bit.x, bit.y - r * 2); ctx.lineTo(bit.x + r * 0.45, bit.y - r * 0.45); ctx.lineTo(bit.x + r * 2, bit.y); ctx.lineTo(bit.x + r * 0.45, bit.y + r * 0.45);
        ctx.lineTo(bit.x, bit.y + r * 2); ctx.lineTo(bit.x - r * 0.45, bit.y + r * 0.45); ctx.lineTo(bit.x - r * 2, bit.y); ctx.lineTo(bit.x - r * 0.45, bit.y - r * 0.45);
        ctx.closePath(); ctx.fill();
      } else {
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = fade;
        ctx.fillStyle = `rgba(${bit.colour}, 1)`;
        ctx.beginPath(); ctx.arc(bit.x, bit.y, bit.size * (0.6 + fade * 0.6), 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
  function finish(run) {
    if (run.done) return;
    run.done = true;
    if (run.raf) cancelAnimationFrame(run.raf);
    run.layer.canvas.remove();
    if (run.mode === "remove") { run.element.remove(); playing.delete(run.element); return; }
    playing.delete(run.element);
    if (run.mode === "exit" && run.element.hidden && run.complete) {
      // Gone: the empty mask stays on until the menu is shown again.
      masked.add(run.element);
      run.release();
      return;
    }
    setMask(run.element, null);
    run.element.style.removeProperty("image-rendering");
    run.release();
  }
  function stopRun(element) { const run = playing.get(element); if (run) finish(run); }

  // ---- watching menus close -------------------------------------------------------
  let choice = "none";
  let borrowed = null; // a Shop Try: { id, timer }
  function readChoice() {
    let saved = "none";
    try { saved = JSON.parse(localStorage.getItem(STORE) || "null")?.exit ?? "none"; } catch { saved = "none"; }
    return EFFECTS.some((item) => item.id === saved) ? saved : "none";
  }
  const owns = (item) => window.MefiShop?.owns?.(item) === true;
  function active() {
    if (borrowed) return borrowed.id;
    const effect = EFFECTS.find((item) => item.id === choice);
    return effect && owns(effect.item) ? effect.id : "none";
  }
  const still = () => {
    const mode = document.documentElement?.dataset?.motion;
    return mode === "off" || window.MefiNav?.noMotion?.() === true;
  };
  const enabled = () => active() !== "none" && !still() && typeof requestAnimationFrame === "function";
  function sync() {
    const id = active();
    if (document.documentElement?.dataset) {
      if (id === "none") delete document.documentElement.dataset.exitEffect;
      else document.documentElement.dataset.exitEffect = id;
    }
  }
  function onMutations(records) {
    if (!enabled()) return;
    const leaving = [];
    for (const record of records) {
      const element = record.target;
      if (record.attributeName !== "hidden") continue;
      if (element.hidden) {
        // It was shown a moment ago and is a menu we know.
        if (record.oldValue !== null || !element.matches?.(MENUS) || leaving.includes(element)) continue;
        leaving.push(element);
      } else {
        unmask(element);
        if (playing.has(element)) stopRun(element);
        // A menu opened: its exit is made ready while it is read.
        if (element.matches?.(MENUS)) soon(() => { if (!element.hidden) prepare(element); });
      }
    }
    if (leaving.length) playAll(leaving, active());
  }
  function onToggle(event) {
    if (!enabled()) return;
    const element = event.target;
    if (!element?.matches?.("[popover]")) return;
    if (event.newState === "open") { unmask(element); soon(() => prepare(element)); }
    else if (event.newState === "closed" && element.matches?.(":popover-open")) play(element, active());
  }

  // ---- the API --------------------------------------------------------------------
  function use(id) {
    const next = EFFECTS.some((item) => item.id === id) ? id : "none";
    choice = next;
    try { localStorage.setItem(STORE, JSON.stringify({ exit: next })); } catch { /* a private store: this session only */ }
    sync();
    window.dispatchEvent?.(new CustomEvent("mefi:effects", { detail: { current: active() } }));
    return active();
  }
  function preview(id, ms = 120000) {
    if (!EFFECTS.some((item) => item.id === id)) return false;
    endPreview({ quiet: true });
    borrowed = { id, timer: setTimeout(() => endPreview(), Math.max(1000, Math.min(600000, Number(ms) || 120000))) };
    sync();
    return true;
  }
  function endPreview({ quiet = false } = {}) {
    if (!borrowed) return false;
    clearTimeout(borrowed.timer);
    borrowed = null;
    sync();
    if (!quiet) window.dispatchEvent?.(new CustomEvent("mefi:effects", { detail: { current: active() } }));
    return true;
  }
  // The Shop card's demo: the effect plays on the element in place, and the
  // element is back as it was once the effect is over.
  function demo(element, id) {
    if (!element?.isConnected || still()) return false;
    return play(element, id, { mode: "demo" });
  }
  // A closer that removes its menu (the custom dropdowns in studio-ui.js)
  // hands it here instead: it leaves in style and is removed after, or at
  // once when no effect is on. Its ids go first, so a menu opened again at
  // once never meets a twin.
  function leave(node) {
    if (!node?.isConnected) return false;
    if (!enabled()) { node.remove(); return false; }
    for (const item of [node, ...node.querySelectorAll("[id]")]) item.removeAttribute?.("id");
    node.setAttribute("aria-hidden", "true");
    node.style.setProperty("pointer-events", "none", "important");
    if (!play(node, active(), { mode: "remove" })) { node.remove(); return false; }
    return true;
  }

  function init() {
    if (init.done) return;
    init.done = true;
    choice = readChoice();
    sync();
    if (typeof MutationObserver === "function" && document.body) {
      new MutationObserver(onMutations).observe(document.body, { attributes: true, subtree: true, attributeFilter: ["hidden"], attributeOldValue: true });
    }
    document.addEventListener?.("beforetoggle", onToggle, true);
    window.addEventListener?.("mefi-shop-owned", sync);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else setTimeout(init, 0);

  window.MefiEffects = {
    list: () => EFFECTS.map(({ id, item, name, detail }) => ({ id, item, name, detail })),
    current: active,
    chosen: () => choice,
    use, preview, endPreview, demo, leave, prepare,
    // For tests: the field a given effect uses.
    field: (kind, columns, rows, seed) => Array.from(field(kind, columns, rows, seed)),
  };
})();
