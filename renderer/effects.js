// Mefi's Studio AI+ — exit effects for menus (window.MefiEffects).
//
// Menus, pop-ups, popovers and Search normally fade out when they close (the
// "presence" CSS in styles.css and studio-ui.css). With a menu effect from the
// Shop on, they leave in style instead:
//
//   dissolve   crumbles into pixels from the top down, the dust falling away
//   embers     burns away from the edges inward, a glowing edge and embers rising
//   stardust   sweeps away from one side as drifting, twinkling stars
//   wind       drifts aside like sand in the wind, its grains streaming off
//   shatter    cracks like a pane of glass, then falls away in shards
//   spirits    fades into ghostly wisps of smoke that rise and curl away
//   glitch     tears into slices that jump with a colour split and blink out
//
// How: when a known menu gets `hidden` (or a [popover] closes, or a dropdown
// or right-click menu is handed to leave(), or Search closes), the element is
// held where it was for the length of the effect (inline !important styles
// that keep it shown and still), and a mask eats it away in steps. Each step's
// mask is drawn from a field over the element's cells: a cell is gone once the
// effect's progress passes its value, so the same field decides where the
// particles start, on a small canvas laid over the element. Nothing here
// changes what a menu does: `hidden` still flips at once (tests and code read
// it), a leaving menu is inert and hidden from screen readers at once (focus
// goes where its closer sends it, when it sends it), the pointer passes
// through it, and a menu that opens again mid-way is put back at once. With
// motion off, or no effect chosen ("It fades out"), nothing happens at all.
//
// The effects are Shop items (renderer/friends-shop.js); owner checks go
// through MefiShop.owns(). The choice lives in localStorage
// mefiStudio.effects.v1 so a restart keeps it.
//
//   list(), current(), chosen(), use(id | "none"), preview(id, ms), endPreview(),
//   demo(element, id), loop(element, id) -> stop(), leave(node), prepare(element)
(function () {
  "use strict";
  const STORE = "mefiStudio.effects.v1";
  // `drop` is the Shop month an effect came with ("2026-10"); null: always in the Shop.
  const EFFECTS = Object.freeze([
    { id: "dissolve", item: "studio:fx-dissolve", name: "Dissolve", detail: "Menus crumble into pixels when they close.", ms: 430, drop: null },
    { id: "embers", item: "studio:fx-embers", name: "Burn away", detail: "Menus burn away from the edges with glowing embers.", ms: 620, drop: null },
    { id: "stardust", item: "studio:fx-stardust", name: "Stardust", detail: "Menus scatter into drifting stars.", ms: 560, drop: null },
    { id: "wind", item: "studio:fx-wind", name: "Blown away", detail: "Menus drift aside like sand in the wind.", ms: 720, drop: null },
    { id: "shatter", item: "studio:fx-shatter", name: "Shatter", detail: "Menus crack like glass and fall away in shards.", ms: 780, drop: null },
    { id: "spirits", item: "studio:fx-spirits", name: "Spirits", detail: "Menus fade into ghostly wisps that rise and curl away.", ms: 900, drop: "2026-10" },
    { id: "glitch", item: "studio:fx-glitch", name: "Glitch", detail: "Menus tear into flickering slices and blink out.", ms: 600, drop: null },
  ]);
  // How each effect is drawn: the room its particles get around the menu
  // (left, top, right, bottom), how many cells start one, the most alive at
  // once (a frame's particle work stays small on any menu), its mask steps,
  // and its mask: crisp cells, soft cells (smoke), slices or a pane's shards.
  const KIND = Object.freeze({
    dissolve: { pad: [90, 90, 90, 90], sample: 240, cap: 240, steps: 14, mask: "cells", scale: 1.08 },
    embers: { pad: [70, 70, 70, 70], sample: 240, cap: 240, steps: 14, mask: "cells", scale: 1.08 },
    stardust: { pad: [90, 90, 90, 90], sample: 170, cap: 170, steps: 14, mask: "cells", scale: 1.08 },
    wind: { pad: [60, 100, 380, 90], sample: 400, cap: 420, steps: 16, mask: "cells", scale: 1.08, cells: 13000 },
    shatter: { pad: [120, 70, 120, 400], sample: 0, cap: 160, steps: 14, mask: "shards", scale: 1.08 },
    spirits: { pad: [110, 300, 110, 60], sample: 110, cap: 130, steps: 22, mask: "soft", scale: 1.16 },
    glitch: { pad: [80, 30, 80, 30], sample: 0, cap: 96, steps: 16, mask: "slices", scale: 1.08 },
  });
  // The menus that leave in style: floating menus, Map panels, pop-ups and
  // popovers. Whole pages and sheets keep their plain fade.
  const MENUS = [
    "#app-help-menu", ".surface-tools-menu", ".workspace .ws-project-actions > div", ".brains-menu",
    "#idle-hud .pop", "#idle-hud .legend-list", "#idle-info", ".walkthrough-coach",
    ".gs-pop", ".music-dropdown", ".companion-panel", ".shop-pop", ".studio-menu",
    ".autonomy-popover", ".chat-tools-popover", "#today-inbox", ".builder-more-menu", "#sessions-run-menu", "#sessions-itab-menu",
    "[data-exit-effect]",
  ].join(", ");
  // Where a menu above stands open in place, `hidden` does not close it (the
  // run menu shows the permission choices inline): it never plays there.
  const STAYS = ".sx-runmenu .autonomy-popover";
  // Overlays that leave through one part: Search's scrim fades as usual while
  // its sheet leaves in style.
  const PARTS = [["#palette-overlay", ".palette-sheet"]];
  const EMPTY = "linear-gradient(transparent, transparent)";
  const TAU = Math.PI * 2;
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
  // Value noise: the hash on the whole-number lattice, blended.
  function lattice(fx, fy, seed) {
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = hash(x0, y0, seed), b = hash(x0 + 1, y0, seed), c = hash(x0, y0 + 1, seed), d = hash(x0 + 1, y0 + 1, seed);
    return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
  }
  const smooth = (x, y, scale, seed) => lattice(x / scale, y / scale, seed);
  // A small seeded random source (mulberry32): the same seed, the same pane or slices.
  function seeded(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function field(kind, columns, rows, seed) {
    if (kind === "shatter") return pane(columns, rows, seed).values;
    if (kind === "glitch") return slices(columns, rows, seed).values;
    const values = new Float32Array(columns * rows);
    const across = Math.max(1, columns - 1), down = Math.max(1, rows - 1);
    for (let j = 0; j < rows; j += 1) {
      for (let i = 0; i < columns; i += 1) {
        const white = hash(i, j, seed);
        let value;
        if (kind === "embers") {
          // Edges first: distance to the nearest edge, roughened.
          const edge = Math.min(i, columns - 1 - i, j, rows - 1 - j) / Math.max(1, Math.min(columns, rows) / 2);
          value = 0.5 * smooth(i, j, 6, seed) + 0.12 * white + 0.38 * clamp(edge, 0, 1);
        } else if (kind === "stardust") {
          value = 0.42 * smooth(i, j, 5, seed) + 0.18 * white + 0.4 * (i / across);
        } else if (kind === "wind") {
          // Sand: the side the wind blows toward goes first, in grains drawn
          // out along the wind (the noise is long across and short down).
          const along = 1 - (0.85 * (i / across) + 0.15 * (1 - j / down));
          value = 0.68 * along + 0.17 * lattice(i / 10, j / 1.5, seed) + 0.15 * white;
        } else if (kind === "spirits") {
          // Smoke: soft clouds lifting away, the top first.
          value = 0.42 * lattice(i / 7, j / 5, seed) + 0.16 * lattice(i / 2.5, j / 2.5, seed + 31) + 0.42 * (j / down);
        } else {
          value = 0.72 * white + 0.28 * (j / down);
        }
        values[j * columns + i] = clamp(value, 0, 0.999);
      }
    }
    return values;
  }

  // ---- Shatter's pane of glass ----------------------------------------------------
  // Struck once in its upper middle: cracks run out from there to the edges,
  // rings of cracks join them, and the pieces between fall nearest first. In
  // cell units; each piece knows the mask step it falls at, and every cell of
  // a piece has that piece's value, so a piece goes whole.
  const cross = (ax, ay, bx, by) => ax * by - ay * bx;
  // The part of a convex polygon on one side of the line a→b (side 1 or -1).
  function clipHalf(poly, a, b, side) {
    const out = [];
    const at = (p) => cross(b[0] - a[0], b[1] - a[1], p[0] - a[0], p[1] - a[1]) * side;
    for (let n = 0; n < poly.length; n += 1) {
      const p = poly[n], q = poly[(n + 1) % poly.length];
      const sp = at(p), sq = at(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) { const k = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k]); }
    }
    return out;
  }
  function area(poly) {
    let sum = 0;
    for (let n = 0; n < poly.length; n += 1) { const p = poly[n], q = poly[(n + 1) % poly.length]; sum += p[0] * q[1] - q[0] * p[1]; }
    return Math.abs(sum) / 2;
  }
  function inside(poly, x, y) {
    let sign = 0;
    for (let n = 0; n < poly.length; n += 1) {
      const p = poly[n], q = poly[(n + 1) % poly.length];
      const c = cross(q[0] - p[0], q[1] - p[1], x - p[0], y - p[1]);
      if (Math.abs(c) < 1e-9) continue;
      if (!sign) sign = Math.sign(c);
      else if (Math.sign(c) !== sign) return false;
    }
    return true;
  }
  // A box with rounded corners as a convex polygon (each corner in a few
  // straight steps), and a convex polygon cut to it.
  function roundBox(width, height, radius) {
    const r = Math.max(0, Math.min(radius, width / 2, height / 2)), out = [];
    for (const [cx, cy, from] of [[width - r, r, -Math.PI / 2], [width - r, height - r, 0], [r, height - r, Math.PI / 2], [r, r, Math.PI]]) {
      for (let n = 0; n <= 4; n += 1) { const angle = from + (n / 4) * (Math.PI / 2); out.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]); }
    }
    return out;
  }
  function clipBox(poly, width, height, radius) {
    const box = roundBox(width, height, radius);
    let out = poly;
    for (let n = 0; n < box.length && out.length >= 3; n += 1) out = clipHalf(out, box[n], box[(n + 1) % box.length], 1);
    return out;
  }
  function pane(columns, rows, seed, steps = KIND.shatter.steps) {
    const random = seeded(seed ^ 0x5bd1e995);
    const W = columns, H = rows;
    const P = [W * (0.34 + 0.32 * random()), H * (0.2 + 0.24 * random())];
    const box = [[0, 0], [W, 0], [W, H], [0, H]];
    const far = Math.max(...box.map(([x, y]) => Math.hypot(x - P[0], y - P[1])));
    const count = 8 + Math.floor(random() * 3);
    const turn = random() * TAU;
    const angles = Array.from({ length: count }, (_, k) => turn + ((k + 0.2 + 0.6 * random()) / count) * TAU);
    const dirs = angles.map((angle) => [Math.cos(angle), Math.sin(angle)]);
    const rings = [0.15, 0.34, 0.56, 0.8];
    const radii = dirs.map(() => { let last = 0; return rings.map((part) => (last = Math.max(last * 1.35, part * far * (0.8 + 0.4 * random())))); });
    const pieces = [];
    for (let k = 0; k < count; k += 1) {
      const next = (k + 1) % count, d0 = dirs[k], d1 = dirs[next];
      let rest = clipHalf(clipHalf(box, P, [P[0] + d0[0], P[1] + d0[1]], 1), P, [P[0] + d1[0], P[1] + d1[1]], -1);
      for (let m = 0; m < rings.length && rest.length >= 3; m += 1) {
        const a = [P[0] + d0[0] * radii[k][m], P[1] + d0[1] * radii[k][m]];
        const b = [P[0] + d1[0] * radii[next][m], P[1] + d1[1] * radii[next][m]];
        const near = Math.sign(cross(b[0] - a[0], b[1] - a[1], P[0] - a[0], P[1] - a[1])) || 1;
        const inner = clipHalf(rest, a, b, near), outer = clipHalf(rest, a, b, -near);
        if (inner.length < 3 || outer.length < 3 || area(inner) < 0.8 || area(outer) < 0.8) continue;
        pieces.push({ poly: inner, sector: k });
        rest = outer;
      }
      if (rest.length >= 3 && area(rest) > 0.05) pieces.push({ poly: rest, sector: k });
    }
    // Nearest the blow first, a little out of order, over the steps after the cracks.
    for (const piece of pieces) {
      piece.center = piece.poly.reduce((sum, p) => [sum[0] + p[0] / piece.poly.length, sum[1] + p[1] / piece.poly.length], [0, 0]);
      piece.order = Math.hypot(piece.center[0] - P[0], piece.center[1] - P[1]) / far + 0.16 * random();
    }
    const first = 3, last = steps - 2;
    [...pieces].sort((x, y) => x.order - y.order).forEach((piece, rank, all) => { piece.step = first + Math.round((rank / Math.max(1, all.length - 1)) * (last - first)); });
    const values = new Float32Array(columns * rows);
    const bySector = Array.from({ length: count }, () => []);
    for (const piece of pieces) bySector[piece.sector].push(piece);
    for (let j = 0; j < rows; j += 1) {
      for (let i = 0; i < columns; i += 1) {
        const x = i + 0.5, y = j + 0.5;
        const rel = ((((Math.atan2(y - P[1], x - P[0]) - angles[0]) % TAU) + TAU) % TAU);
        let k = 0;
        while (k + 1 < count && angles[k + 1] - angles[0] <= rel) k += 1;
        const piece = bySector[k].find((item) => inside(item.poly, x, y)) || pieces.find((item) => inside(item.poly, x, y))
          || pieces.reduce((best, item) => (Math.hypot(item.center[0] - x, item.center[1] - y) < Math.hypot(best.center[0] - x, best.center[1] - y) ? item : best), pieces[0]);
        values[j * columns + i] = Math.min(0.999, ((piece.step + 0.5) / steps) * 1.08);
      }
    }
    return { P, far, pieces, values, steps };
  }

  // ---- Glitch's slices ------------------------------------------------------------
  // Bands one to three cells tall, most cut once or twice across; every piece
  // blinks out on its own beat (none in the first fifth, while it only jumps).
  function slices(columns, rows, seed) {
    const random = seeded(seed ^ 0x2c1b3c6d);
    const values = new Float32Array(columns * rows), owner = new Int32Array(columns * rows);
    const pieces = [];
    for (let j = 0; j < rows;) {
      const tall = Math.min(rows - j, 1 + Math.floor(random() * 3));
      const cuts = random() < 0.35 ? 0 : random() < 0.6 ? 1 : 2;
      const edges = [0, ...Array.from({ length: cuts }, () => Math.floor(columns * (0.12 + 0.76 * random()))).sort((a, b) => a - b), columns];
      for (let n = 0; n + 1 < edges.length; n += 1) {
        const i0 = edges[n], i1 = edges[n + 1];
        if (i1 <= i0) continue;
        const piece = { i0, i1, j0: j, j1: j + tall, value: 0.24 + 0.72 * random() };
        const id = pieces.push(piece) - 1;
        for (let y = j; y < j + tall; y += 1) for (let x = i0; x < i1; x += 1) { values[y * columns + x] = piece.value; owner[y * columns + x] = id; }
      }
      j += tall;
    }
    return { values, owner, pieces };
  }

  // ---- masks --------------------------------------------------------------------
  // Each step is a small picture, one pixel per cell, stretched over the
  // element (crisp cells without smoothing; smoke smoothed), or the pane's
  // pieces drawn as shapes.
  let maskCanvas = null;
  function scratch(width, height) {
    if (!maskCanvas) maskCanvas = document.createElement("canvas");
    maskCanvas.width = width; maskCanvas.height = height;
    return maskCanvas.getContext?.("2d") ?? null;
  }
  const picture = () => { try { return maskCanvas.toDataURL("image/png"); } catch { return null; } };
  // alpha(index) -> 0..255 for every cell.
  function cellMask(columns, rows, alpha) {
    const ctx = scratch(columns, rows);
    if (!ctx) return null;
    const image = ctx.createImageData(columns, rows);
    const data = image.data;
    for (let index = 0; index < columns * rows; index += 1) {
      const at = index * 4;
      data[at] = 255; data[at + 1] = 255; data[at + 2] = 255; data[at + 3] = alpha(index);
    }
    ctx.putImageData(image, 0, 0);
    return picture();
  }
  function paneMask(glass, columns, rows, step, scale) {
    const ctx = scratch(columns * scale, rows * scale);
    if (!ctx) return null;
    ctx.clearRect?.(0, 0, columns * scale, rows * scale);
    ctx.fillStyle = "#fff";
    const kept = glass.pieces.filter((piece) => piece.step > step);
    if (kept.length === glass.pieces.length) ctx.fillRect(0, 0, columns * scale, rows * scale);
    else if (kept.length) {
      // One path, so the seams between pieces still in place never show.
      ctx.beginPath();
      for (const piece of kept) {
        piece.poly.forEach(([x, y], n) => (n ? ctx.lineTo(x * scale, y * scale) : ctx.moveTo(x * scale, y * scale)));
        ctx.closePath();
      }
      ctx.fill();
    }
    return picture();
  }
  // A plan is one effect's steps for one size of menu: the field and a mask
  // picture per step. A mask picture shows only once it is decoded, so plans
  // are made while a menu is open (prepare), a few steps at a time in idle
  // moments, and their pictures decoded and kept; a menu of about the same
  // size reuses one. Sizes go in 16 px steps.
  const plans = new Map(); // "kind:columnsxrows" -> plan, oldest first
  let held = 0; // mask pixels the plans keep, under about four million
  function gridOf(rect, cells = 6000) {
    const width = Math.ceil(rect.width / 16) * 16, height = Math.ceil(rect.height / 16) * 16;
    const cell = Math.max(4, Math.round(Math.sqrt((width * height) / cells)));
    return { cell: Math.max(rect.width / Math.ceil(width / cell), 1), columns: Math.max(1, Math.ceil(width / cell)), rows: Math.max(1, Math.ceil(height / cell)), across: rect.width, down: rect.height };
  }
  function load(url) {
    if (!url || typeof Image !== "function") return null;
    const image = new Image();
    image.src = url;
    image.decode?.().catch(() => { /* shown when it can be */ });
    return image;
  }
  function planFor(kind, columns, rows) {
    const key = `${kind}:${columns}x${rows}`;
    let plan = plans.get(key);
    if (plan) { plans.delete(key); plans.set(key, plan); return plan; }
    const spec = KIND[kind];
    const seed = (Math.random() * 1e9) | 0;
    const steps = spec.steps;
    let values, glass = null, cut = null, weight = columns * rows * (steps + 1), make;
    if (spec.mask === "shards") {
      glass = pane(columns, rows, seed, steps);
      values = glass.values;
      weight = columns * rows * 4 * (steps + 1);
      make = (step) => paneMask(glass, columns, rows, step, 2);
    } else if (spec.mask === "slices") {
      cut = slices(columns, rows, seed);
      values = cut.values;
      make = (step) => {
        if (step >= steps) return cellMask(columns, rows, () => 0);
        const threshold = ((step + 1) / steps) * spec.scale;
        // About to go, a piece blinks first; just gone, it may flash back once.
        const shown = cut.pieces.map((piece, id) => {
          const near = piece.value - threshold, beat = hash(id, step, 977);
          if (near >= 0) return !(near < 0.2 && beat < 0.38);
          return near > -0.12 && beat > 0.84;
        });
        return cellMask(columns, rows, (index) => (shown[cut.owner[index]] ? 255 : 0));
      };
    } else {
      values = field(kind, columns, rows, seed);
      const soft = spec.mask === "soft" ? spec.scale - 1 : 0;
      make = (step) => {
        if (step >= steps) return cellMask(columns, rows, () => 0);
        const threshold = ((step + 1) / steps) * spec.scale;
        return cellMask(columns, rows, soft
          ? (index) => Math.round(clamp((values[index] - threshold + soft) / soft, 0, 1) * 255)
          : (index) => (values[index] >= threshold ? 255 : 0));
      };
    }
    plan = { key, kind, values, columns, rows, urls: [], images: [], glass, cut, steps, weight, filling: false };
    // One more step's picture; false once every step has one.
    plan.more = () => {
      if (plan.urls.length > steps) return false;
      const url = make(plan.urls.length);
      plan.urls.push(url); plan.images.push(load(url));
      return plan.urls.length <= steps;
    };
    // Every step now (an exit that starts before its plan was made ahead).
    plan.ready = () => { while (plan.more()); return plan; };
    plans.set(key, plan);
    held += weight;
    while (plans.size > 24 || (held > 4e6 && plans.size > 1)) {
      const oldest = plans.keys().next().value;
      held -= plans.get(oldest).weight;
      plans.delete(oldest);
    }
    return plan;
  }
  // A plan's pictures, a few at a time while the page is idle: never one long task.
  function fill(plan) {
    if (plan.filling || plan.urls.length > plan.steps) return;
    plan.filling = true;
    const work = (deadline) => {
      const until = now() + clamp(deadline?.timeRemaining?.() ?? 6, 2, 8);
      while (plan.more() && now() < until);
      if (plan.urls.length <= plan.steps) soon(work); else plan.filling = false;
    };
    soon(work);
  }
  // Made ahead while a menu is open, so its exit starts at once; the menu's
  // own display is noted too (hold pins it).
  const shownDisplay = new WeakMap();
  function prepare(element, id = active()) {
    if (!KIND[id] || still() || !element?.isConnected || typeof element.getBoundingClientRect !== "function") return false;
    const rect = element.getBoundingClientRect();
    if (!(rect.width > 4 && rect.height > 4)) return false;
    try { const shown = getComputedStyle(element).display; if (shown && shown !== "none") shownDisplay.set(element, shown); } catch { /* not noted */ }
    const grid = gridOf(rect, KIND[id].cells);
    fill(planFor(id, grid.columns, grid.rows));
    return true;
  }
  const soon = typeof requestIdleCallback === "function" ? (fn) => requestIdleCallback(fn, { timeout: 300 }) : (fn) => setTimeout(fn, 80);

  // ---- colours ------------------------------------------------------------------
  function parseRgb(value) {
    const text = String(value || "").trim();
    const long = /^#([0-9a-f]{6})$/i.exec(text);
    if (long) { const n = parseInt(long[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
    const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(text);
    if (short) return [1, 2, 3].map((at) => parseInt(short[at] + short[at], 16));
    const parts = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text);
    return parts ? [Number(parts[1]), Number(parts[2]), Number(parts[3])] : null;
  }
  // Any CSS colour (a theme's color-mix() too) as [r, g, b], through a canvas.
  let probe;
  function rgbOf(value) {
    const parsed = parseRgb(value);
    if (parsed || !value) return parsed;
    try {
      if (probe === undefined) probe = document.createElement("canvas").getContext?.("2d") ?? null;
      if (!probe) return null;
      probe.fillStyle = "#000";
      probe.fillStyle = String(value);
      return parseRgb(probe.fillStyle);
    } catch { return null; }
  }
  const mixRgb = (a, b, k) => a.map((value, index) => Math.round(value * (1 - k) + b[index] * k));
  const css = (rgb, alpha = 1) => (alpha >= 1 ? `rgb(${rgb.join(", ")})` : `rgba(${rgb.join(", ")}, ${alpha})`);
  function readColours(element) {
    let style = null, root = null;
    try { style = getComputedStyle(element); root = getComputedStyle(document.documentElement); } catch { /* defaults */ }
    const pick = (value) => (value && !/rgba?\(\s*0,\s*0,\s*0,\s*0\)|transparent/.test(value) ? value : null);
    const accent = (root?.getPropertyValue?.("--canvas-accent") || root?.getPropertyValue?.("--gold") || "#e8b04a").trim();
    const second = (root?.getPropertyValue?.("--canvas-accent2") || root?.getPropertyValue?.("--accent-2") || accent).trim();
    const surface = pick(style?.backgroundColor) || (root?.getPropertyValue?.("--surface-raised") || "#2a2f3a").trim();
    const text = style?.color || "#e8e8e8";
    // A crumb is the surface mixed toward the text colour, so it shows on the page behind.
    const s = rgbOf(surface) || [42, 47, 58], t = rgbOf(text) || [232, 232, 232];
    const crumb = css(mixRgb(s, t, 0.38));
    const dark = (0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2]) / 255 < 0.5;
    return { surface, crumb, text, accent, second, dark, s, t, a: rgbOf(accent) || [232, 176, 74], b: rgbOf(second) || rgbOf(accent) || [139, 92, 255] };
  }
  // The menu's corner radius in px (its top left one), never more than half its size.
  function radiusOf(element, rect) {
    let radius = 0;
    try { radius = Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0; } catch { radius = 0; }
    return Math.max(0, Math.min(radius, rect.width / 2, rect.height / 2));
  }
  // A soft round puff in one colour, drawn once and stamped many times (Spirits).
  const puffs = new Map();
  function puffOf(rgb) {
    const key = rgb.join(",");
    if (puffs.has(key)) return puffs.get(key);
    let sprite = null;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 64; canvas.height = 64;
      const g = canvas.getContext?.("2d");
      const shade = g?.createRadialGradient?.(32, 32, 0, 32, 32, 32);
      if (shade?.addColorStop) {
        shade.addColorStop(0, css(rgb, 0.9)); shade.addColorStop(0.42, css(rgb, 0.38)); shade.addColorStop(1, css(rgb, 0));
        g.fillStyle = shade; g.fillRect(0, 0, 64, 64);
        sprite = canvas;
      }
    } catch { sprite = null; }
    puffs.set(key, sprite);
    return sprite;
  }

  // ---- the canvas laid over a leaving menu -----------------------------------------
  // As large as the menu and the effect's room around it, cut to the window. It
  // draws in the menu's own frame: (room left, room top) is the menu's corner.
  function overlay(rect, pad) {
    const canvas = document.createElement("canvas");
    canvas.className = "exit-effect-dust";
    canvas.setAttribute("aria-hidden", "true");
    const dpr = Math.min(2, Math.max(1, Number(window.devicePixelRatio) || 1));
    const want = [rect.left - pad[0], rect.top - pad[1], rect.right + pad[2], rect.bottom + pad[3]];
    const right = Math.min(want[2], Number(window.innerWidth) || want[2]), bottom = Math.min(want[3], Number(window.innerHeight) || want[3]);
    const left = Math.floor(Math.max(want[0], 0)), top = Math.floor(Math.max(want[1], 0));
    const width = Math.max(1, Math.ceil(right - left)), height = Math.max(1, Math.ceil(bottom - top));
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    canvas.style.transform = `translate3d(${left}px, ${top}px, 0)`;
    document.body.append(canvas);
    const ctx = canvas.getContext?.("2d") ?? null;
    const layer = { canvas, ctx, dpr, left, top, shift: [want[0] - left, want[1] - top] };
    frameOf(layer);
    return layer;
  }
  const frameOf = (layer) => layer.ctx?.setTransform(layer.dpr, 0, 0, layer.dpr, layer.shift[0] * layer.dpr, layer.shift[1] * layer.dpr);
  function wipe(layer) {
    const { ctx, canvas } = layer;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    frameOf(layer);
  }

  // ---- playing one exit -----------------------------------------------------------
  const playing = new Map(); // element -> run
  const HOLD = [["opacity", "1"], ["translate", "none"], ["scale", "1"], ["pointer-events", "none"]];
  const SCRIM = [["background-color", "transparent"], ["backdrop-filter", "none"], ["-webkit-backdrop-filter", "none"]];
  // Sets attributes for a while; puts back what was there, unless something
  // else changed them in the meantime.
  function mark(element, pairs) {
    const before = pairs.map(([name, value]) => { const was = element.getAttribute?.(name) ?? null; element.setAttribute?.(name, value); return [name, value, was]; });
    return () => {
      for (const [name, value, was] of before) {
        if ((element.getAttribute?.(name) ?? null) !== value) continue;
        if (was === null) element.removeAttribute?.(name); else element.setAttribute?.(name, was);
      }
    };
  }
  // Holds a closing menu shown, still and in place for the effect's length.
  // Its display is pinned inline (an inline !important outranks [hidden]), so
  // it stays even when something read the page right after it closed and its
  // own short fade had already begun; the value is what it showed as: still
  // there while a display transition runs, or noted by prepare() when it opened.
  // It is inert and hidden from screen readers at once: what is leaving is not
  // there any more for the keyboard. `scrim`: an overlay whose own backdrop
  // fades while its part leaves.
  function hold(element, ms, { scrim = false } = {}) {
    // A [popover] keeps its place through the top layer's own transition
    // (beforetoggle comes before it closes), so its display is never pinned.
    const popover = element.matches?.("[popover]") === true;
    const names = [...HOLD.map(([name]) => name), "transition", "display", "visibility", "will-change", "filter", ...(scrim ? SCRIM.map(([name]) => name) : [])];
    const saved = names.map((name) => [name, element.style.getPropertyValue(name), element.style.getPropertyPriority(name)]);
    // The transition goes first: a menu whose style was not worked out again
    // since it closed then keeps its display through it, to be read below.
    const fade = Math.round(Math.min(ms, 420) * 0.75);
    element.style.setProperty("transition", `display ${ms}ms allow-discrete, overlay ${ms}ms allow-discrete${scrim ? `, background-color ${fade}ms ease-in, backdrop-filter ${fade}ms ease-in` : ""}`, "important");
    let display = null;
    if (!popover) {
      try { const shown = getComputedStyle(element).display; if (shown && shown !== "none") display = shown; } catch { display = null; }
      display ||= shownDisplay.get(element) || null;
    }
    for (const [name, value] of HOLD) element.style.setProperty(name, value, "important");
    if (scrim) for (const [name, value] of SCRIM) element.style.setProperty(name, value, "important");
    if (display) { element.style.setProperty("display", display, "important"); element.style.setProperty("visibility", "visible", "important"); }
    const marks = mark(element, [["inert", ""], ["aria-hidden", "true"]]);
    return () => {
      for (const [name, value, priority] of saved) { if (value) element.style.setProperty(name, value, priority); else element.style.removeProperty(name); }
      marks();
    };
  }
  // A menu that left keeps its last, empty mask until it opens again, so
  // letting go of the hold never shows it for the length of its own fade.
  const masked = new WeakSet();
  function unmask(element) {
    if (!element || !masked.has(element)) return;
    masked.delete(element);
    setMask(element, null);
    element.style.removeProperty("image-rendering");
  }
  function setMask(element, url, raw = false) {
    const value = url ? (raw ? url : `url("${url}")`) : "";
    for (const prefix of ["", "-webkit-"]) {
      if (!url) { element.style.removeProperty(`${prefix}mask-image`); element.style.removeProperty(`${prefix}mask-size`); element.style.removeProperty(`${prefix}mask-repeat`); continue; }
      element.style.setProperty(`${prefix}mask-image`, value, "important");
      element.style.setProperty(`${prefix}mask-size`, "100% 100%", "important");
      element.style.setProperty(`${prefix}mask-repeat`, "no-repeat", "important");
    }
  }
  // The length of an effect, times --exit-effect-pace on the root (1 unless a
  // test or a lab slows it down to look at it).
  function length(effect) {
    let pace = 1;
    try { pace = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--exit-effect-pace")) || 1; } catch { pace = 1; }
    return effect.ms * Math.max(0.1, Math.min(40, pace));
  }
  // Every menu closing at once is held first, then measured: reading one
  // menu's size starts the style change for all of them, and a plain fade
  // that has started cannot be held any more. An overlay is held before its part.
  function playAll(entries, id) {
    const effect = EFFECTS.find((item) => item.id === id);
    if (!effect) return;
    const ms = length(effect);
    const held = entries.filter(({ element }) => element?.isConnected).map(({ element, host }) => {
      stopRun(element);
      const letGo = [host ? hold(host, ms + 40, { scrim: true }) : null, hold(element, ms + 40)];
      return [element, host, () => { for (const release of letGo) release?.(); }];
    });
    for (const [element, host, release] of held) play(element, id, { mode: "exit", release, ms, host });
  }
  // `mode` says what happens around the effect: "exit" holds a closing menu in
  // place until it has gone, "remove" takes the element out at the end (a
  // removed dropdown), "demo" brings it back afterwards (the Shop's cards).
  function play(element, id, { mode = "exit", release: given = null, ms: known = null, host = null, done = null } = {}) {
    const effect = EFFECTS.find((item) => item.id === id);
    if (!effect || !element?.isConnected || typeof element.getBoundingClientRect !== "function") { given?.(); return false; }
    if (!given) stopRun(element);
    const ms = known || length(effect);
    const release = given || (mode === "exit" ? hold(element, ms + 40) : () => {});
    const rect = element.getBoundingClientRect();
    if (!(rect.width > 4 && rect.height > 4) || rect.bottom < 0 || rect.right < 0 || rect.top > (window.innerHeight || 1e5) || rect.left > (window.innerWidth || 1e5)) { release(); return false; }
    const spec = KIND[effect.id];
    // About six thousand cells (sand finer), never smaller than four pixels.
    const grid = gridOf(rect, spec.cells);
    const plan = planFor(effect.id, grid.columns, grid.rows).ready();
    const { values, columns, rows, urls, steps } = plan;
    const cellX = rect.width / columns, cellY = rect.height / rows;
    // Outside a hold, the inline styles an effect touches are put back after it.
    const touched = ["translate", "filter", "will-change"].map((name) => [name, element.style.getPropertyValue(name), element.style.getPropertyPriority(name)]);
    if (spec.mask === "cells" || spec.mask === "slices") element.style.setProperty("image-rendering", "pixelated", "important");
    const layer = overlay(rect, spec.pad);
    // Smoke is soft: the whole canvas is blurred a little, on the graphics card.
    if (effect.id === "spirits") layer.canvas.style.filter = "blur(2px)";
    const run = {
      element, kind: effect.id, spec, release, layer, raf: 0, done: false, mode, last: 0, host, onDone: done, plan,
      rect, cellX, cellY, ox: spec.pad[0], oy: spec.pad[1], colours: readColours(element), bits: [], frame: 0, moved: "", drift: [0, 0], radius: radiusOf(element, rect),
      restore: mode === "exit" ? null : () => { for (const [name, value, priority] of touched) { if (value) element.style.setProperty(name, value, priority); else element.style.removeProperty(name); } },
    };
    playing.set(element, run);
    // The first step goes on now, before the first frame.
    let shown = 0;
    setMask(element, urls[0]);
    if (effect.id === "wind" || effect.id === "spirits" || effect.id === "shatter") element.style.setProperty("will-change", "translate", "important");
    if (effect.id === "glitch") {
      run.filter = glitchFilter();
      if (run.filter) element.style.setProperty("filter", `url("#${GLITCH}")`, "important");
    }
    const start = now();
    run.pending = due(run, values, columns, rows);
    const tick = () => {
      run.raf = 0;
      if (run.done) return;
      const at = now();
      const t = (at - start) / ms;
      const u = clamp(t, 0, 1);
      const step = Math.min(steps, Math.floor(u * steps));
      if (step !== shown) { shown = step; setMask(element, urls[step]); }
      if (step >= steps) run.complete = true;
      const dt = clamp((at - (run.last || at)) / 1000, 0, 0.05);
      run.last = at;
      run.frame += 1;
      if (mode === "demo") follow(run);
      if (u < 1) move(run, u);
      if (run.filter && u < 1) glitchFrame(run, u);
      while (run.pending.length && run.pending[0].at <= u) spawn(run, run.pending.shift());
      paint(run, u, dt);
      if (t < 1 || run.bits.length) run.raf = requestAnimationFrame(tick);
      else finish(run);
    };
    run.raf = requestAnimationFrame(tick);
    return true;
  }
  // What starts particles, in the order they start: a sample of cells (each
  // when its cell goes), the pane's pieces (each when it falls) or the slices.
  function due(run, values, columns, rows) {
    const { spec, plan, ox, oy, cellX, cellY } = run;
    const list = [];
    if (plan.glass) {
      for (const piece of plan.glass.pieces) list.push({ at: piece.step / plan.steps, piece });
    } else if (plan.cut) {
      for (const piece of plan.cut.pieces) list.push({ at: piece.value / spec.scale, piece });
    } else {
      const sample = Math.min(spec.sample, columns * rows);
      for (let n = 0; n < sample; n += 1) {
        const i = Math.floor(Math.random() * columns), j = Math.floor(Math.random() * rows);
        list.push({ at: values[j * columns + i] / spec.scale, x: ox + (i + 0.5) * cellX, y: oy + (j + 0.5) * cellY });
      }
    }
    return list.sort((a, b) => a.at - b.at);
  }
  // The Shop's sample can scroll while it plays: the canvas stays over it.
  // Its box includes the effect's own drift, which the drawing already has.
  function follow(run) {
    // A sample swapped for a fresh one mid-play has no place any more: the canvas stays put.
    if (run.element.isConnected === false) return;
    const rect = run.element.getBoundingClientRect?.();
    if (!rect || !(rect.width > 0)) return;
    const left = rect.left - run.drift[0], top = rect.top - run.drift[1];
    if (Math.abs(left - run.rect.left) < 0.5 && Math.abs(top - run.rect.top) < 0.5) return;
    run.layer.left += left - run.rect.left; run.layer.top += top - run.rect.top;
    const { width, height } = run.rect;
    run.rect = { left, top, width, height, right: left + width, bottom: top + height };
    run.layer.canvas.style.transform = `translate3d(${Math.round(run.layer.left)}px, ${Math.round(run.layer.top)}px, 0)`;
  }
  // What the menu itself does while it goes, as a translate: it drifts aside
  // with the wind, jolts at the blow that cracks it, lifts as it turns to
  // smoke, jumps now and then as it glitches.
  function move(run, u) {
    let x = 0, y = 0;
    if (run.kind === "wind") { x = 100 * u ** 1.6; y = -8 * u; }
    else if (run.kind === "shatter") { const k = Math.max(0, 1 - u / 0.2); x = Math.sin(u * 170) * 2.4 * k; y = Math.cos(u * 130) * 1.2 * k; }
    else if (run.kind === "spirits") y = -14 * u * u;
    else if (run.kind === "glitch") x = run.frame % 3 === 0 && Math.random() < 0.3 ? (Math.random() - 0.5) * 10 * Math.min(1, u * 3) : 0;
    else return;
    // What is drawn follows what is shown: the translate as written, to a tenth of a pixel.
    run.drift = [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
    const value = `${run.drift[0].toFixed(1)}px ${run.drift[1].toFixed(1)}px`;
    if (value !== run.moved) { run.moved = value; run.element.style.setProperty("translate", value, "important"); }
  }

  // ---- Glitch's tear and colour split ----------------------------------------------
  // One SVG filter for every glitching menu: noise in horizontal bands moves
  // each band of the real menu sideways, and its red and its green-blue are
  // pulled apart. Its numbers change every other frame while a menu glitches.
  const GLITCH = "mefi-exit-glitch";
  let glitchDefs = null;
  function glitchFilter() {
    if (glitchDefs?.svg.isConnected) return glitchDefs;
    const ns = "http://www.w3.org/2000/svg";
    try {
      const svg = document.createElementNS?.(ns, "svg");
      if (!svg?.setAttribute) return null;
      svg.setAttribute("class", "exit-effect-defs");
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("focusable", "false");
      svg.setAttribute("width", "0"); svg.setAttribute("height", "0");
      svg.innerHTML = `<filter id="${GLITCH}" x="-6%" y="0" width="112%" height="100%" color-interpolation-filters="sRGB">`
        + `<feTurbulence type="fractalNoise" baseFrequency="0 0.055" numOctaves="1" seed="3" result="noise"/>`
        + `<feComponentTransfer in="noise" result="bands"><feFuncR type="discrete" tableValues="0.5 0.5 0.14 0.5 0.5 0.86 0.5 0.32 0.5 0.68 0.5 0.5"/>`
        + `<feFuncG type="discrete" tableValues="0.5"/><feFuncB type="discrete" tableValues="0.5"/><feFuncA type="discrete" tableValues="1"/></feComponentTransfer>`
        + `<feDisplacementMap in="SourceGraphic" in2="bands" scale="0" xChannelSelector="R" yChannelSelector="G" result="torn"/>`
        + `<feColorMatrix in="torn" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="red"/>`
        + `<feOffset in="red" dx="0" dy="0" result="redShift"/>`
        + `<feColorMatrix in="torn" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0" result="cyan"/>`
        + `<feOffset in="cyan" dx="0" dy="0" result="cyanShift"/>`
        + `<feBlend in="redShift" in2="cyanShift" mode="screen"/></filter>`;
      document.body.append(svg);
      const part = (selector) => svg.querySelector?.(selector) ?? null;
      const offsets = svg.querySelectorAll?.("feOffset") ?? [];
      glitchDefs = { svg, noise: part("feTurbulence"), tear: part("feDisplacementMap"), red: offsets[0] ?? null, cyan: offsets[1] ?? null };
      return glitchDefs.tear ? glitchDefs : null;
    } catch { return null; }
  }
  function glitchFrame(run, u) {
    if (run.frame % 2) return;
    const parts = run.filter;
    const burst = Math.random() < 0.3 ? 1 : 0.3;
    const strength = clamp(u * 2.4, 0, 1) * burst;
    const split = (1.2 + 4.5 * clamp(u * 2, 0, 1)) * (Math.random() < 0.5 ? 1 : -1);
    parts.noise?.setAttribute("seed", String(1 + Math.floor(Math.random() * 997)));
    parts.tear?.setAttribute("scale", (strength * 48).toFixed(1));
    parts.red?.setAttribute("dx", split.toFixed(1));
    parts.cyan?.setAttribute("dx", (-split).toFixed(1));
  }

  // ---- particles ------------------------------------------------------------------
  const rnd = Math.random;
  function spawn(run, from) {
    const { kind, colours, bits, spec } = run;
    if (bits.length >= spec.cap) return;
    const add = (bit) => { if (bits.length < spec.cap) { bit.max = bit.life; bits.push(bit); } };
    if (kind === "embers") {
      add({ x: from.x, y: from.y, vx: (rnd() - 0.5) * 30, vy: -30 - rnd() * 60, life: 0.7 + rnd() * 0.6, size: 1.2 + rnd() * 1.8, colour: rnd() < 0.5 ? "255, 196, 92" : "255, 120, 48" });
    } else if (kind === "stardust") {
      add({ x: from.x, y: from.y, vx: 20 + rnd() * 60, vy: -20 - rnd() * 50, life: 0.8 + rnd() * 0.7, size: 1.4 + rnd() * 2.2, colour: rnd() < 0.5 ? colours.accent : colours.second, star: true, spin: rnd() * 6 });
    } else if (kind === "wind") {
      // A grain of the menu: mostly its own surface lit a little, some of its
      // text and accent; now and then a flake, and a breath of dust. Grains
      // from the same height sway together, so they stream in ribbons.
      const pick = rnd();
      const tone = pick < 0.5 ? 0 : pick < 0.78 ? 1 : pick < 0.9 ? 2 : 3;
      const flake = rnd() < 0.08;
      const x = from.x + run.drift[0] + (rnd() - 0.5) * run.cellX, y = from.y + run.drift[1] + (rnd() - 0.5) * run.cellY;
      add({ grain: true, flake, x, y, vx: 10 + rnd() * 40, vy: -6 + rnd() * 8, ax: flake ? 300 + rnd() * 300 : 600 + rnd() * 700, life: 0.6 + rnd() * 0.5, size: flake ? 2.2 + rnd() * 1.6 : 0.9 + rnd() * 1.1, tone, phase: from.y * 0.04 + rnd() * 0.4, wave: 80 + rnd() * 80, lift: 40 + rnd() * 50 });
      if (rnd() < 0.12) add({ dust: true, x, y, vx: 10 + rnd() * 30, vy: -6 - rnd() * 10, ax: 380 + rnd() * 260, life: 0.7 + rnd() * 0.4, size: 7 + rnd() * 9, phase: from.y * 0.045, wave: 16, lift: 24, alpha: 0.08 + rnd() * 0.08 });
    } else if (kind === "spirits") {
      // Where the menu thins, smoke: curling wisps, and soft puffs for body.
      const tone = rnd() < 0.65 ? 0 : 1;
      const x = from.x + run.drift[0], y = from.y + run.drift[1];
      const big = rnd() < 0.12;
      if (rnd() < 0.42) add({ wisp: true, x, y, vx: (rnd() - 0.5) * 50, vy: -90 - rnd() * 90, life: 1.2 + rnd() * 0.7, width: big ? 7 + rnd() * 4 : 2.5 + rnd() * 3.5, phase: rnd() * TAU, curl: 2.4 + rnd() * 2.6, sway: 50 + rnd() * 90, alpha: big ? 0.12 + rnd() * 0.08 : 0.18 + rnd() * 0.16, tone, trail: [] });
      else add({ puff: true, x, y, vx: (rnd() - 0.5) * 20, vy: -40 - rnd() * 50, life: 0.9 + rnd() * 0.7, size: 9 + rnd() * 9, grow: 30 + rnd() * 24, phase: rnd() * TAU, curl: 2 + rnd() * 2, sway: 20 + rnd() * 30, alpha: 0.06 + rnd() * 0.08, tone });
    } else if (kind === "shatter") {
      shardOf(run, from.piece);
    } else if (kind === "glitch") {
      sliceOf(run, from.piece);
    } else {
      // Crumbs of the menu: its own surface lit a little, some of its accent.
      const pick = rnd();
      const colour = pick < 0.55 ? colours.crumb : pick < 0.8 ? colours.accent : colours.text;
      add({ x: from.x, y: from.y, vx: (rnd() - 0.5) * 50, vy: 20 + rnd() * 50, life: 0.45 + rnd() * 0.45, size: 2 + rnd() * 3, colour, square: true, gravity: 520, alpha: pick < 0.8 ? 1 : 0.55 });
    }
  }
  // A piece of glass lets go: it falls with a little push away from the blow,
  // turning as it goes, and a few splinters fly off its edges.
  function shardOf(run, piece) {
    const { cellX, cellY, ox, oy, bits, spec, plan } = run;
    const [px, py] = plan.glass.P;
    const cx = ox + piece.center[0] * cellX, cy = oy + piece.center[1] * cellY;
    const away = Math.atan2(piece.center[1] - py, piece.center[0] - px);
    // Pieces near the blow fly off harder.
    const push = (30 + rnd() * 70) * (1.8 - Math.min(1, piece.order));
    // In px, cut to the menu's rounded corners (a corner piece keeps its curve).
    let shape = piece.poly.map(([x, y]) => [x * cellX, y * cellY]);
    if (run.radius > 1) shape = clipBox(shape, run.rect.width, run.rect.height, run.radius);
    if (shape.length < 3) return;
    shape = shape.map(([x, y]) => [ox + x - cx, oy + y - cy]);
    const reach = Math.max(4, ...shape.map(([x, y]) => Math.hypot(x, y)));
    const add = (bit) => { if (bits.length < spec.cap) { bit.max = bit.life; bits.push(bit); } };
    add({ shard: true, shape, reach, x: cx, y: cy, vx: Math.cos(away) * push, vy: Math.sin(away) * push * 0.4 - 40 - rnd() * 70, turn: 0, spin: (rnd() - 0.5) * 6, tilt: rnd() * TAU, roll: (rnd() < 0.5 ? -1 : 1) * (3 + rnd() * 7), life: 0.7 + rnd() * 0.3, flash: 1 });
    for (let n = 0; n < 2; n += 1) {
      const [x, y] = shape[Math.floor(rnd() * shape.length)];
      const angle = rnd() * TAU, speed = 80 + rnd() * 160;
      add({ splinter: true, x: cx + x, y: cy + y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 60, size: 1.5 + rnd() * 2.5, spin: rnd() * TAU, life: 0.35 + rnd() * 0.3 });
    }
  }
  // A slice blinks out: now and then a colour-split ghost of part of it flicks
  // sideways, and a few bright pixels scatter.
  function sliceOf(run, piece) {
    const { cellX, cellY, ox, oy, bits, spec } = run;
    const x = ox + piece.i0 * cellX, y = oy + piece.j0 * cellY, w = (piece.i1 - piece.i0) * cellX, h = (piece.j1 - piece.j0) * cellY;
    const push = (bit) => { if (bits.length < spec.cap) { bit.max = bit.life; bits.push(bit); } };
    if (rnd() < 0.6) {
      const part = w * (0.25 + rnd() * 0.45), shift = (rnd() < 0.5 ? -1 : 1) * (4 + rnd() * 14);
      push({ ghost: true, x: x + rnd() * (w - part) + shift, y, w: part, h, tone: rnd() < 0.5 ? 0 : 1, vx: shift * 5, life: 0.04 + rnd() * 0.06 });
    }
    for (let n = 0; n < 2; n += 1) push({ pixel: true, x: x + rnd() * w, y: y + rnd() * h, w: 2 + rnd() * 8, h: 1 + rnd() * 2, tone: Math.floor(rnd() * 3), vx: (rnd() - 0.5) * 900, life: 0.06 + rnd() * 0.14 });
  }

  // ---- drawing a frame ---------------------------------------------------------------
  function paint(run, u, dt) {
    const { ctx } = run.layer;
    if (!ctx) return;
    wipe(run.layer);
    if (run.kind === "embers" && u < 1) edgeGlow(run, u * run.spec.scale);
    if (run.kind === "shatter") cracks(run, u);
    if (run.kind === "glitch" && u < 1) scanlines(run, u);
    drawBits(run, dt);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
  // The burning edge: cells still there that touch a gone one (or the menu's
  // own edge) and are about to go themselves glow.
  function edgeGlow(run, progress) {
    const { ctx } = run.layer, { values, columns, rows } = run.plan, { ox, oy, cellX, cellY } = run;
    ctx.globalCompositeOperation = "lighter";
    const gone = (i, j) => i < 0 || j < 0 || i >= columns || j >= rows || values[j * columns + i] < progress;
    for (let j = 0; j < rows; j += 1) {
      for (let i = 0; i < columns; i += 1) {
        const gap = values[j * columns + i] - progress;
        if (gap < 0 || gap > 0.09) continue;
        if (!(gone(i - 1, j) || gone(i + 1, j) || gone(i, j - 1) || gone(i, j + 1))) continue;
        const heat = 1 - gap / 0.09;
        ctx.fillStyle = `rgba(255, ${Math.round(110 + 120 * heat)}, ${Math.round(30 + 70 * heat)}, ${0.3 + 0.6 * heat})`;
        ctx.fillRect(ox + i * cellX, oy + j * cellY, Math.ceil(cellX), Math.ceil(cellY));
      }
    }
  }
  // Shatter: a flash where it was struck, cracks racing out from there, then
  // the cracks of the pieces still in place (never along the menu's own edge).
  function cracks(run, u) {
    const { ctx } = run.layer, { glass, columns, rows, steps } = run.plan, { ox, oy, cellX, cellY, colours } = run;
    const px = ox + glass.P[0] * cellX + run.drift[0], py = oy + glass.P[1] * cellY + run.drift[1];
    const step = Math.floor(u * steps);
    const grow = clamp(u / 0.15, 0, 1), reach = (1 - (1 - grow) ** 3) * glass.far * Math.max(cellX, cellY);
    if (u >= 1) return;
    const edge = (x, y) => Math.abs(x) < 1e-6 || Math.abs(y) < 1e-6 || Math.abs(x - columns) < 1e-6 || Math.abs(y - rows) < 1e-6;
    ctx.save();
    // Inside the menu's own rounded shape, and while they run, inside the circle they have reached.
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") ctx.roundRect(ox + run.drift[0], oy + run.drift[1], run.rect.width, run.rect.height, run.radius);
    else ctx.rect(ox + run.drift[0], oy + run.drift[1], run.rect.width, run.rect.height);
    ctx.clip();
    if (grow < 1) { ctx.beginPath(); ctx.arc(px, py, Math.max(1, reach), 0, TAU); ctx.clip(); }
    ctx.beginPath();
    for (const piece of glass.pieces) {
      if (piece.step <= step) continue;
      const poly = piece.poly;
      for (let n = 0; n < poly.length; n += 1) {
        const p = poly[n], q = poly[(n + 1) % poly.length];
        if (edge(p[0], p[1]) && edge(q[0], q[1]) && (Math.abs(p[0] - q[0]) < 1e-6 || Math.abs(p[1] - q[1]) < 1e-6)) continue;
        ctx.moveTo(ox + p[0] * cellX + run.drift[0], oy + p[1] * cellY + run.drift[1]);
        ctx.lineTo(ox + q[0] * cellX + run.drift[0], oy + q[1] * cellY + run.drift[1]);
      }
    }
    ctx.lineCap = "round";
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = colours.dark ? "rgba(0, 0, 0, 0.42)" : "rgba(255, 255, 255, 0.95)";
    ctx.stroke();
    ctx.lineWidth = 1.1;
    ctx.strokeStyle = colours.dark ? "rgba(235, 246, 255, 0.85)" : "rgba(58, 66, 86, 0.5)";
    ctx.stroke();
    ctx.restore();
    // The blow itself: a quick flash where it landed.
    if (u < 0.16) {
      const k = 1 - u / 0.16;
      const glow = ctx.createRadialGradient?.(px, py, 0, px, py, 46);
      if (glow?.addColorStop) {
        glow.addColorStop(0, `rgba(255, 255, 255, ${0.85 * k})`); glow.addColorStop(1, "rgba(255, 255, 255, 0)");
        ctx.globalCompositeOperation = colours.dark ? "lighter" : "source-over";
        ctx.globalAlpha = 1;
        ctx.fillStyle = glow;
        ctx.fillRect(px - 46, py - 46, 92, 92);
      }
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }
  // Glitch: thin bright lines and colour blocks that flick over the menu, and
  // at the end the line an old screen shrinks to as it switches off.
  function scanlines(run, u) {
    const { ctx } = run.layer, { ox, oy, rect, drift } = run;
    const w = rect.width, h = rect.height;
    ctx.globalCompositeOperation = run.colours.dark ? "lighter" : "source-over";
    if (u > 0.08 && u < 0.88 && rnd() < 0.45) {
      const y = oy + rnd() * h;
      ctx.globalAlpha = 0.35 + rnd() * 0.35;
      ctx.fillStyle = rnd() < 0.5 ? "rgb(255, 255, 255)" : "rgb(0, 229, 255)";
      ctx.fillRect(ox + drift[0], y, w, 1 + Math.floor(rnd() * 2));
    }
    if (u > 0.12 && u < 0.85 && rnd() < 0.3) {
      ctx.globalAlpha = 0.28 + rnd() * 0.25;
      ctx.fillStyle = rnd() < 0.5 ? "rgb(255, 42, 109)" : "rgb(0, 229, 255)";
      ctx.fillRect(ox + rnd() * w * 0.8 + drift[0], oy + rnd() * h, 16 + rnd() * w * 0.4, 2 + rnd() * 7);
    }
    if (u > 0.86) {
      const k = (u - 0.86) / 0.14, cy = oy + h * 0.5, half = (w / 2) * (1 - k) ** 2;
      ctx.globalAlpha = 0.9 * (1 - k * 0.5);
      ctx.fillStyle = run.colours.dark ? "rgb(220, 250, 255)" : "rgb(40, 52, 72)";
      ctx.fillRect(ox + w / 2 - half, cy - 1, half * 2, 2);
      ctx.globalAlpha = 0.35 * (1 - k);
      ctx.fillStyle = "rgb(0, 229, 255)";
      ctx.fillRect(ox + w / 2 - half - 6, cy - 3, half * 2 + 12, 6);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
  const WIND_TONES = (colours) => (colours.dark
    ? [css(mixRgb(colours.s, colours.t, 0.5)), css(mixRgb(colours.s, [255, 255, 255], 0.3)), colours.accent, colours.text]
    : [css(mixRgb(colours.s, colours.t, 0.55)), css(mixRgb(colours.s, colours.t, 0.32)), colours.accent, colours.text]);
  const GHOSTS = ["rgb(255, 42, 109)", "rgb(0, 229, 255)", "rgb(255, 255, 255)"];
  function drawBits(run, dt) {
    const { ctx } = run.layer, { kind, bits, colours } = run;
    // Move every bit, and let go of the spent ones.
    for (let index = bits.length - 1; index >= 0; index -= 1) {
      const bit = bits[index];
      bit.life -= dt;
      if (bit.life <= 0) { bits.splice(index, 1); continue; }
      const age = bit.max - bit.life;
      if (bit.grain || bit.dust) {
        // The wind picks up speed, lifts them a little and sways them, more the further they go.
        bit.vx += bit.ax * dt; bit.vy += (Math.sin(age * 6 + bit.phase) * bit.wave * (0.6 + age * 1.8) - bit.lift) * dt;
      } else if (bit.wisp || bit.puff) {
        // Smoke rises faster as it warms, slows in the air, and curls more the higher it gets.
        bit.vy = bit.vy * (1 - 0.35 * dt) - (bit.wisp ? 150 : 70) * dt;
        bit.x += Math.sin(bit.phase + age * bit.curl) * bit.sway * (0.4 + age) * dt;
        if (bit.trail) { bit.trail.unshift(bit.x, bit.y); if (bit.trail.length > 72) bit.trail.length = 72; }
      } else if (bit.shard) {
        bit.vy += 1900 * dt; bit.turn += bit.spin * dt; bit.tilt += bit.roll * dt; bit.flash = Math.max(0, bit.flash - dt * 9);
      } else if (bit.splinter) {
        bit.vy += 1400 * dt; bit.spin += 9 * dt;
      } else if (bit.ghost || bit.pixel) {
        bit.x += bit.vx * dt;
        continue;
      } else {
        bit.vy += (bit.gravity || (kind === "embers" ? -20 : 0)) * dt;
      }
      bit.x += bit.vx * dt; bit.y += bit.vy * dt;
    }
    if (kind === "wind") { drawGrains(run); return; }
    for (const bit of bits) {
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
      } else if (bit.wisp || bit.puff) {
        drawSmoke(run, bit, fade);
      } else if (bit.shard) {
        drawShard(run, bit, fade);
      } else if (bit.splinter) {
        ctx.globalCompositeOperation = colours.dark ? "lighter" : "source-over";
        ctx.globalAlpha = fade * 0.9;
        ctx.fillStyle = colours.dark ? "rgb(225, 240, 255)" : css(mixRgb(colours.s, colours.t, 0.3));
        const r = bit.size, c = Math.cos(bit.spin) * r, s = Math.sin(bit.spin) * r;
        ctx.beginPath(); ctx.moveTo(bit.x + c, bit.y + s); ctx.lineTo(bit.x - s * 0.6, bit.y + c * 0.6); ctx.lineTo(bit.x - c * 0.8, bit.y - s * 0.8); ctx.closePath(); ctx.fill();
      } else if (bit.ghost || bit.pixel) {
        ctx.globalCompositeOperation = colours.dark ? "lighter" : "source-over";
        ctx.globalAlpha = (bit.ghost ? 0.3 : 0.8) * (rnd() < 0.25 ? 0.3 : 1);
        ctx.fillStyle = GHOSTS[bit.ghost ? bit.tone : bit.tone % 3];
        ctx.fillRect(bit.x, bit.y, bit.w, bit.h);
      } else {
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = fade;
        ctx.fillStyle = `rgba(${bit.colour}, 1)`;
        ctx.beginPath(); ctx.arc(bit.x, bit.y, bit.size * (0.6 + fade * 0.6), 0, TAU); ctx.fill();
      }
    }
  }
  // Sand: a haze of dust first, then every grain a short streak along its
  // way (a flake a little square), drawn one colour at a time.
  function drawGrains(run) {
    const { ctx } = run.layer, { bits, colours } = run;
    const tones = run.tones ||= WIND_TONES(colours);
    const haze = puffOf(colours.dark ? mixRgb(colours.s, colours.t, 0.45) : mixRgb(colours.s, colours.t, 0.3));
    ctx.globalCompositeOperation = "source-over";
    if (haze) {
      for (const bit of bits) {
        if (!bit.dust) continue;
        const fade = clamp(bit.life / bit.max, 0, 1), age = bit.max - bit.life;
        const r = bit.size * (1 + age * 1.6);
        ctx.globalAlpha = bit.alpha * fade * Math.min(1, age / 0.12);
        ctx.drawImage(haze, bit.x - r * 1.8, bit.y - r * 0.7, r * 3.6, r * 1.4);
      }
    }
    for (let tone = 0; tone < tones.length; tone += 1) {
      ctx.fillStyle = tones[tone];
      for (const bit of bits) {
        if (!bit.grain || bit.tone !== tone) continue;
        const fade = clamp(bit.life / bit.max, 0, 1);
        ctx.globalAlpha = fade * (tone === 2 ? 0.85 : 1);
        if (bit.flake) { ctx.fillRect(bit.x, bit.y, bit.size, bit.size); continue; }
        // A bright head and a fainter tail as long as its speed.
        const tail = Math.min(34, Math.max(1, bit.vx * 0.06));
        ctx.fillRect(bit.x - 1.5, bit.y, bit.size + 1.5, bit.size);
        ctx.globalAlpha *= 0.38;
        ctx.fillRect(bit.x - tail, bit.y + bit.size * 0.15, tail, bit.size * 0.7);
      }
    }
  }
  // Spirits: wisps of smoke as thin ribbons, widest at their head, that curl
  // as they rise, with soft puffs for body; pale light on a dark menu, a
  // smoky grey on a light one. The canvas is blurred a little (play()).
  const SPIRIT_TONES = { dark: [[206, 236, 255], [178, 255, 226]], light: [[84, 94, 126], [116, 92, 148]] };
  function drawSmoke(run, bit, fade) {
    const { ctx } = run.layer, { colours } = run;
    const tones = colours.dark ? SPIRIT_TONES.dark : SPIRIT_TONES.light;
    const age = bit.max - bit.life;
    const alpha = bit.alpha * Math.min(1, age / 0.18) * fade ** 1.2 * (colours.dark ? 1 : 0.85);
    ctx.globalCompositeOperation = colours.dark ? "lighter" : "source-over";
    if (bit.puff) {
      const sprite = puffOf(tones[bit.tone]);
      const r = bit.size + bit.grow * age;
      ctx.globalAlpha = alpha;
      if (sprite) ctx.drawImage(sprite, bit.x - r, bit.y - r * 1.3, r * 2, r * 2.6);
      return;
    }
    const trail = bit.trail, total = trail.length / 2;
    if (total < 5) return;
    // The ribbon's two sides, from every other point of its way: each pushed
    // out across the way it went, widest at the head, wider as it spreads.
    const count = Math.ceil(total / 2), left = [], right = [];
    for (let k = 0; k < count; k += 1) {
      const n = Math.min(total - 1, k * 2), a = Math.max(0, n - 2), b = Math.min(total - 1, n + 2);
      const dx = trail[b * 2] - trail[a * 2], dy = trail[b * 2 + 1] - trail[a * 2 + 1];
      const span = Math.hypot(dx, dy) || 1;
      const w = bit.width * (0.45 + age * 1.1) * (1 - k / count) ** 0.7 * Math.min(1, (k + 1) / 2) ** 0.5;
      const x = trail[n * 2], y = trail[n * 2 + 1], nx = -dy / span, ny = dx / span;
      left.push(x + nx * w, y + ny * w); right.push(x - nx * w, y - ny * w);
    }
    ctx.beginPath();
    ctx.moveTo(left[0], left[1]);
    for (let n = 1; n < count; n += 1) ctx.quadraticCurveTo(left[n * 2 - 2], left[n * 2 - 1], (left[n * 2 - 2] + left[n * 2]) / 2, (left[n * 2 - 1] + left[n * 2 + 1]) / 2);
    ctx.lineTo(right[count * 2 - 2], right[count * 2 - 1]);
    for (let n = count - 2; n >= 0; n -= 1) ctx.quadraticCurveTo(right[n * 2 + 2], right[n * 2 + 3], (right[n * 2 + 2] + right[n * 2]) / 2, (right[n * 2 + 3] + right[n * 2 + 1]) / 2);
    ctx.closePath();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = css(tones[bit.tone]);
    ctx.fill();
  }
  // A piece of glass: the menu's own surface, a sheen that comes and goes as
  // it turns, and a bright edge; a flash as it first lets go.
  function drawShard(run, bit, fade) {
    const { ctx } = run.layer, { colours } = run;
    const turnOut = Math.abs(Math.cos(bit.tilt));
    ctx.save();
    ctx.translate(bit.x, bit.y);
    ctx.rotate(bit.turn);
    ctx.scale(1, Math.max(0.16, turnOut));
    ctx.beginPath();
    bit.shape.forEach(([x, y], n) => (n ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    const life = Math.min(1, fade / 0.55);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = life * 0.96;
    ctx.fillStyle = css(colours.dark ? mixRgb(colours.s, [255, 255, 255], 0.05) : mixRgb(colours.s, colours.t, 0.06));
    ctx.fill();
    // The light catches it as it turns: a narrow sheen across the glass.
    const glint = 0.04 + 0.2 * Math.abs(Math.sin(bit.tilt)) ** 3 + 0.45 * bit.flash;
    const sheen = ctx.createLinearGradient?.(-bit.reach, -bit.reach, bit.reach, bit.reach);
    if (sheen?.addColorStop) {
      const at = 0.3 + 0.4 * (0.5 + 0.5 * Math.sin(bit.tilt));
      sheen.addColorStop(0, "rgba(255, 255, 255, 0)"); sheen.addColorStop(Math.max(0, at - 0.14), "rgba(255, 255, 255, 0)");
      sheen.addColorStop(at, `rgba(255, 255, 255, ${clamp(glint, 0, 1).toFixed(3)})`);
      sheen.addColorStop(Math.min(1, at + 0.14), "rgba(255, 255, 255, 0)"); sheen.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.globalAlpha = life;
      ctx.fillStyle = sheen;
      ctx.fill();
    }
    ctx.globalAlpha = life;
    ctx.lineWidth = 1;
    ctx.strokeStyle = colours.dark ? `rgba(224, 242, 255, ${(0.45 + 0.45 * turnOut).toFixed(3)})` : `rgba(52, 60, 80, ${(0.32 + 0.3 * turnOut).toFixed(3)})`;
    ctx.stroke();
    ctx.restore();
  }
  function finish(run) {
    if (run.done) return;
    run.done = true;
    if (run.raf) cancelAnimationFrame(run.raf);
    run.layer.canvas.remove();
    playing.delete(run.element);
    if (run.mode === "remove") { run.element.remove(); return; }
    const owner = run.host || run.element;
    if (run.mode === "exit" && closed(owner) && run.complete) {
      // Gone: the empty mask stays on until the menu is shown again, and an
      // overlay gets one too, so its scrim never shows for its own fade.
      masked.add(run.element);
      if (run.host) { setMask(run.host, EMPTY, true); masked.add(run.host); }
      run.release();
      run.onDone?.();
      return;
    }
    setMask(run.element, null);
    run.element.style.removeProperty("image-rendering");
    run.restore?.();
    run.release();
    if (run.mode === "demo") comeBack(run.element);
    run.onDone?.();
  }
  // Still closed: hidden, or a popover no longer open.
  function closed(element) {
    if (element.hidden) return true;
    try { return element.matches?.("[popover]") === true && element.matches(":popover-open") === false; } catch { return false; }
  }
  // The Shop's sample menu comes back gently for its next look.
  function comeBack(element) {
    try { element.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 480, easing: "ease-out" }); } catch { /* shown as it is */ }
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
  const motion = () => document.documentElement?.dataset?.motion || "on";
  const still = () => motion() === "off" || window.MefiNav?.noMotion?.() === true;
  const enabled = () => active() !== "none" && !still() && typeof requestAnimationFrame === "function";
  function sync() {
    const id = active();
    if (document.documentElement?.dataset) {
      if (id === "none") delete document.documentElement.dataset.exitEffect;
      else document.documentElement.dataset.exitEffect = id;
    }
  }
  // An overlay that leaves through one of its parts: that part.
  function partOf(element) {
    for (const [overlaySelector, partSelector] of PARTS) {
      if (element.matches?.(overlaySelector)) return element.querySelector?.(partSelector) ?? null;
    }
    return null;
  }
  const isMenu = (element) => element.matches?.(MENUS) === true && element.matches?.(STAYS) !== true;
  function onMutations(records) {
    const on = enabled();
    const leaving = [];
    for (const record of records) {
      const element = record.target;
      if (record.attributeName !== "hidden") continue;
      const part = partOf(element);
      const target = part || element;
      if (element.hidden) {
        // It was shown a moment ago and is a menu we know.
        if (!on || record.oldValue !== null || leaving.some((entry) => entry.element === target)) continue;
        if (!part && !isMenu(element)) continue;
        leaving.push({ element: target, host: part ? element : null });
      } else {
        // Shown again: the empty mask its last exit left comes off whether or
        // not an effect is still on (a Try that ended, motion turned Off).
        unmask(element);
        if (part) unmask(part);
        if (playing.has(target)) stopRun(target);
        // A menu opened: its exit is made ready while it is read.
        if (on && (part || isMenu(element))) soon(() => { if (!element.hidden) prepare(target); });
      }
    }
    if (leaving.length) playAll(leaving, active());
  }
  function onToggle(event) {
    const element = event.target;
    if (!element?.matches?.("[popover]")) return;
    // Opened again (mid-effect too): back at once and whole.
    if (event.newState === "open") { unmask(element); if (playing.has(element)) stopRun(element); if (enabled()) soon(() => prepare(element)); }
    else if (event.newState === "closed" && enabled() && element.matches?.(":popover-open")) play(element, active());
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
  // element is back as it was once the effect is over. While it plays, a
  // promise that settles once the element is back (the Shop waits on it
  // before its next look); false when nothing plays.
  function demo(element, id) {
    if (!element?.isConnected || still()) return false;
    let settle = null;
    const over = new Promise((resolve) => { settle = resolve; });
    return play(element, id, { mode: "demo", done: () => settle(true) }) ? over : false;
  }
  // The Shop's big previews: the effect plays on a sample menu, the menu comes
  // back gently, and after a calm pause it plays again, only while the sample
  // is on screen, the window is in view and motion is on (not Calm, not Off).
  // Stops by itself once the sample leaves the page. Returns stop().
  function loop(element, id, { rest = 1700 } = {}) {
    if (!element || !EFFECTS.some((item) => item.id === id)) return () => {};
    const state = { on: true, seen: true, timer: 0, observer: null };
    const ready = () => state.seen && !document.hidden && motion() === "on" && !still() && typeof requestAnimationFrame === "function";
    const later = (ms) => { clearTimeout(state.timer); state.timer = setTimeout(cycle, ms); };
    function cycle() {
      state.timer = 0;
      if (!state.on) return;
      if (!element.isConnected) { stop(); return; }
      // Off screen or in the background: the observer and the window bring it back.
      // With motion not on, a slow look now and then is all it costs.
      if (!ready()) { if (state.seen && !document.hidden) later(2500); return; }
      if (playing.has(element)) { later(300); return; }
      if (!play(element, id, { mode: "demo", done: () => { if (state.on) later(rest); } })) later(rest);
    }
    const onShow = () => { if (state.on && !state.timer && !playing.has(element) && !document.hidden) later(400); };
    function stop() {
      if (!state.on) return;
      state.on = false;
      clearTimeout(state.timer);
      state.observer?.disconnect?.();
      document.removeEventListener?.("visibilitychange", onShow);
      if (playing.get(element)?.mode === "demo") stopRun(element);
    }
    if (typeof IntersectionObserver === "function") {
      state.observer = new IntersectionObserver((entries) => {
        state.seen = entries.some((entry) => entry.isIntersecting);
        if (state.seen) onShow();
        else if (playing.get(element)?.mode === "demo") stopRun(element);
      });
      state.observer.observe(element);
    }
    document.addEventListener?.("visibilitychange", onShow);
    soon(() => { if (state.on) prepare(element, id); });
    later(700);
    return stop;
  }
  // A closer that removes its menu (the dropdowns in studio-ui.js, the tab
  // strip's right-click and other menus in tabs.js) hands it here instead: it
  // leaves in style and is removed after, or at once when no effect is on.
  // Its ids go first, so a menu opened again at once never meets a twin, and
  // it is inert and hidden from screen readers at once.
  function leave(node) {
    if (!node || node.isConnected === false) return false;
    // Already on its way out: a second close (a redraw) lets it finish.
    if (playing.get(node)?.mode === "remove") return true;
    if (!enabled()) { node.remove(); return false; }
    for (const item of [node, ...node.querySelectorAll("[id]")]) item.removeAttribute?.("id");
    node.setAttribute("aria-hidden", "true");
    node.setAttribute("inert", "");
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
    list: () => EFFECTS.map(({ id, item, name, detail, ms, drop }) => ({ id, item, name, detail, ms, drop })),
    current: active,
    chosen: () => choice,
    use, preview, endPreview, demo, loop, leave,
    prepare: (element) => prepare(element),
    // For tests: the field a given effect uses.
    field: (kind, columns, rows, seed) => Array.from(field(kind, columns, rows, seed)),
  };
})();
