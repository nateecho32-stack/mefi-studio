// Mefi's Studio AI+ — node styles: the painters both node canvases share.
//
// The Command view (idle.js) and the tree rail (tree3d.js) paint every node
// through window.MefiNodeStyles, so the two canvases can no longer drift
// apart. Bundled before tree3d.js and idle.js; both look it up at draw time
// and fall back to a plain disc or line when it is absent (a bare harness).
// Nothing here touches the DOM, Path2D, OffscreenCanvas or a timer, so the
// file loads whole into a vm holding only `window`, or into a blank page.
//
// The file is cut into banner sections (`// ===== name =====`), each owned by
// one piece of work: infra, the Void collection's shared shapes, one section
// per style, the overlay and wire dispatchers, and the export. A style section
// registers exactly one LOOKS entry; every hook it leaves null keeps the
// caller's own legacy drawing (the dispatchers answer false, null or 1).
(function () {
  "use strict";

// ===== infra =====

  const STYLES = Object.freeze(["orbs", "glass", "minimal", "halo", "crystal", "singularity", "prism", "sigil"]);
  const PREMIUM = Object.freeze(["singularity", "prism", "sigil"]);
  const TAU = Math.PI * 2;
  const WHITE = Object.freeze([255, 255, 255]);
  const clamp01 = (value) => value <= 0 ? 0 : value >= 1 ? 1 : value;

  // Colour strings are built by the thousand per frame. Memoize them per
  // triple (a WeakMap frees them with the palette); a continuous alpha would
  // grow a triple's map without end, so past 64 entries it starts over.
  const colourCache = new WeakMap();
  const colourMap = (triple) => {
    let map = colourCache.get(triple);
    if (!map) { map = new Map(); colourCache.set(triple, map); }
    return map;
  };
  const rgba = (triple, alpha) => {
    const map = colourMap(triple);
    let value = map.get(alpha);
    if (value === undefined) {
      if (map.size >= 64) map.clear();
      value = `rgba(${triple.join(",")},${alpha})`;
      map.set(alpha, value);
    }
    return value;
  };
  // A continuous alpha in a colour string, quantised to 1/32 so the memo hits.
  const qa = (alpha) => Math.round(alpha * 32) / 32;
  // One channel-wise blend, rounded like every derived tone here.
  const mix = (from, toward, amount) => [
    Math.round(from[0] + (toward[0] - from[0]) * amount),
    Math.round(from[1] + (toward[1] - from[1]) * amount),
    Math.round(from[2] + (toward[2] - from[2]) * amount),
  ];

  // Gradients are evaluated under the transform at fill time, so a style
  // builds its unit-space paints once per canvas and key and reuses them.
  // Each context owns one bounded map (128 entries, oldest out first), so old
  // palettes cannot grow it forever; `created` counts every build.
  const PAINT_CACHE_MAX = 128;
  const paintCaches = new WeakMap();
  function paintCache(ctx) {
    let cache = paintCaches.get(ctx);
    if (!cache) { cache = { map: new Map(), created: 0 }; paintCaches.set(ctx, cache); }
    return cache;
  }
  function cacheGet(ctx, key) {
    return paintCaches.get(ctx)?.map.get(key);
  }
  function cachePut(ctx, key, paints) {
    const cache = paintCache(ctx);
    if (cache.map.size >= PAINT_CACHE_MAX) cache.map.delete(cache.map.keys().next().value);
    cache.map.set(key, paints);
    cache.created += 1;
    return paints;
  }
  function cacheStats(ctx) {
    const cache = paintCaches.get(ctx);
    return { entries: cache ? cache.map.size : 0, created: cache ? cache.created : 0 };
  }

  // A node's own phase, the same on both canvases: FNV-1a of its id, in [0, 1).
  function seed(id) {
    const text = String(id ?? "");
    let h = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      h ^= text.charCodeAt(index);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0) / 4294967296;
  }
  // A second stable number per (seed, k), in [0, 1): sparks, cells, scatter.
  function hash(value, k) {
    let h = Math.imul(((value * 4294967296) >>> 0) ^ Math.imul((k | 0) + 1, 0x9e3779b1), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  // An eased value toward `want`: `up` and `down` are the rise and fall time
  // constants in seconds. With no frame time, no current value or reduced
  // motion it lands at once, and it snaps the last 0.004.
  function approach(current, want, dt, up, down, still) {
    if (still || !(dt > 0) || !Number.isFinite(current)) return want;
    const next = current + (want - current) * (1 - Math.exp(-dt / (want > current ? up : down)));
    return Math.abs(next - want) < 0.004 ? want : next;
  }

  // Per-node motion lives in a Map keyed by id, never on the node objects:
  // both canvases rebuild those on every refresh, which would snap every
  // eased value back. A record is created once per id.
  function motionRecord(table, id) {
    let record = table.get(id);
    if (!record) {
      const phase = seed(id);
      record = {
        seed: phase, clock: 0, tempo: 1, still: false,
        lift: NaN, sel: 0, lit: 0, work: 0, kick: 0, age: 0,
        orbit: phase * TAU, progress: NaN,
        tint: null, from: null, to: null, tintAt: -1e9,
        status: undefined, statusAt: -1e9, seen: 0,
      };
      table.set(id, record);
    }
    return record;
  }

  // One step of a record. flags: { style, active, selected, lift?, progress,
  // orbit (seconds per turn, 0 for none), status, time (ms), frame, speedup? }.
  // `clock` is integrated (seconds × tempo), so going from idle to working
  // speeds a style up without a phase jump; reduced motion holds it.
  function stepMotion(record, flags, dt, still) {
    const active = flags.active === true, selected = flags.selected === true;
    const step = dt > 0 ? dt : 0;
    record.still = still === true;
    if (typeof flags.lift === "number") record.lift = approach(record.lift, flags.lift, dt, 0.09, 0.16, still);
    record.sel = approach(record.sel, selected ? 1 : 0, dt, 0.07, 0.14, still);
    record.lit = approach(record.lit, active || selected ? 1 : 0, dt, 0.12, 0.3, still);
    record.work = approach(record.work, active ? 1 : 0, dt, 0.25, 0.6, still);
    if (Number.isFinite(flags.progress)) record.progress = approach(record.progress, clamp01(flags.progress), dt, 0.35, 0.35, still);
    record.kick = still ? 0 : Math.max(0, record.kick - step / 0.45);
    record.age = active ? (still ? 1e9 : record.age + step) : 0;
    const speedup = Number.isFinite(flags.speedup) ? flags.speedup : LOOKS[flags.style]?.speedup ?? 2.6;
    record.tempo = 1 + (speedup - 1) * record.work;
    if (!still && step > 0) {
      record.clock += step * record.tempo;
      if (flags.orbit > 0) record.orbit += step * TAU / flags.orbit;
    }
    const status = flags.status ?? null;
    if (status !== record.status) {
      // A new record's first status is not news: no pop-in on first sight.
      record.statusAt = record.status === undefined ? -1e9 : Number.isFinite(flags.time) ? flags.time : 0;
      record.status = status;
    }
    if (Number.isFinite(flags.frame)) record.seen = flags.frame;
    return record;
  }

  // A tint change cross-fades over 450 ms in 12 quantised steps. The blended
  // triples are cached per (from, to) pair, so the colour memo and the paint
  // caches still hit during a fade. Compared by value; reduced motion snaps.
  const blends = new WeakMap();
  function blendTint(from, to, step) {
    if (step <= 0) return from;
    if (step >= 12) return to;
    let byTarget = blends.get(from);
    if (!byTarget) { byTarget = new WeakMap(); blends.set(from, byTarget); }
    let steps = byTarget.get(to);
    if (!steps) { steps = new Array(13).fill(null); byTarget.set(to, steps); }
    return steps[step] ??= mix(from, to, step / 12);
  }
  const sameTint = (a, b) => a === b || Boolean(a && b) && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  function shownTint(record, want, time, still) {
    if (!want) return want;
    if (!record.to) {
      record.from = record.to = record.tint = want;
      record.tintAt = time;
      return want;
    }
    if (!sameTint(record.to, want)) {
      record.from = record.tint ?? record.to;
      record.to = want;
      record.tintAt = time;
    }
    const t = (time - record.tintAt) / 450;
    if (still || !(t < 1)) {
      record.from = record.tint = record.to;
      return record.to;
    }
    const k = t <= 0 ? 0 : t * t * (3 - 2 * t);
    record.tint = blendTint(record.from, record.to, Math.round(k * 12));
    return record.tint;
  }

  // The pose a painter gets without a motion record (tests, the pixel oracle,
  // the first frame): fixed levels from the booleans, a still clock, fully
  // assembled. One shared scratch; nothing is allocated.
  const POSE = { seed: 0, clock: 0, tempo: 1, still: true, lift: 0, sel: 0, lit: 0, work: 0, kick: 0, age: 1e9, orbit: Math.PI / 3, progress: NaN };
  function poseOf(o) {
    const selected = o?.selected === true, active = o?.active === true;
    POSE.lift = POSE.sel = selected ? 1 : 0;
    POSE.lit = active || selected ? 1 : 0;
    POSE.work = active ? 1 : 0;
    return POSE;
  }
  const motionOf = (o) => o?.motion ?? poseOf(o);

  // Phase helpers over a motion record. cycle: where the node is in a period
  // of `period` animation seconds (offset by its seed, so nothing pulses in
  // lockstep); swell: 0..1 breathing, `pose` when still; turn: an angle.
  const cycle = (m, period) => ((((m.clock + m.seed * 97) / period) % 1) + 1) % 1;
  const swell = (m, period, pose = 0.5) => m.still ? pose : 0.5 + 0.5 * Math.sin(TAU * cycle(m, period));
  const turn = (m, period, pose = 0) => m.still ? pose : TAU * cycle(m, period);

  // One-shot curves over t in [0, 1] (clamped), for a cell assembling, a
  // badge popping in, an arrival ring: easeOut decelerates (cubic),
  // easeOutBack overshoots a little and settles, smooth01 is the smooth step.
  const easeOut = (t) => { const k = 1 - clamp01(t); return 1 - k * k * k; };
  const easeOutBack = (t) => { if (!(t > 0)) return 0; if (t >= 1) return 1; const k = t - 1; return 1 + 2.70158 * k * k * k + 1.70158 * k * k; };
  const smooth01 = (t) => { const k = clamp01(t); return k * k * (3 - 2 * k); };

  // A regular polygon as one closed subpath (the caller begins, fills and
  // strokes): `sides` vertices on radius r around (x, y), the first at angle
  // `rot` (−π/2 puts a vertex on top: a pointy-top hexagon). One moveTo,
  // sides − 1 lineTo, one closePath; nothing is allocated.
  function polyPath(ctx, x, y, r, sides, rot = 0) {
    const step = TAU / sides;
    ctx.moveTo(x + Math.cos(rot) * r, y + Math.sin(rot) * r);
    for (let index = 1; index < sides; index += 1) ctx.lineTo(x + Math.cos(rot + index * step) * r, y + Math.sin(rot + index * step) * r);
    ctx.closePath();
  }

  // A point on an ellipse (radii rx, ry, turned by `tilt`) at parameter
  // `angle`, written into the caller's own scratch `out` as { x, y, depth }.
  // depth = sin(angle): above 0 on the near half (below the centre line
  // before the tilt), so an orbit can pass behind a body and in front of it.
  function ellipseAt(cx, cy, rx, ry, tilt, angle, out) {
    const ex = Math.cos(angle) * rx, ey = Math.sin(angle) * ry, cos = Math.cos(tilt), sin = Math.sin(tilt);
    out.x = cx + ex * cos - ey * sin;
    out.y = cy + ex * sin + ey * cos;
    out.depth = Math.sin(angle);
    return out;
  }

  // The canvas palette as stable triples, built once per palette. `hi` is the
  // highlight a tone mixes toward (white on dark themes, near-black on light
  // ones); `orbit` is the theme's second hue or a blue that reads on the bg.
  function parseHex(value, strict = false) {
    if (typeof value !== "string") return null;
    const text = value.trim();
    if (/^#[\da-f]{6}$/i.test(text)) {
      const int = parseInt(text.slice(1), 16);
      return Object.freeze([(int >> 16) & 255, (int >> 8) & 255, int & 255]);
    }
    if (!strict && /^#[\da-f]{3}$/i.test(text)) {
      const int = parseInt(text.slice(1).split("").map((char) => char + char).join(""), 16);
      return Object.freeze([(int >> 16) & 255, (int >> 8) & 255, int & 255]);
    }
    return null;
  }
  const frozenMix = (from, toward, amount) => Object.freeze(mix(from, toward, amount));
  function buildTheme(bg, text, accent2, done, amber) {
    const light = bg[0] * 0.2126 + bg[1] * 0.7152 + bg[2] * 0.0722 > 145;
    const hi = Object.freeze(light ? [12, 14, 20] : [255, 255, 255]);
    return Object.freeze({
      key: [bg, text, accent2 ?? "-", done, amber].join("|"),
      bg, light, hi, text,
      track: frozenMix(bg, text, 0.2),
      orbit: accent2 ?? Object.freeze(light ? [52, 96, 178] : [125, 178, 255]),
      accent2,
      done, amber,
      doneWell: frozenMix(done, bg, 0.8),
      doneInk: frozenMix(done, hi, 0.5),
      amberWell: frozenMix(amber, bg, 0.8),
    });
  }
  const INK_DEFAULTS = buildTheme(Object.freeze([5, 5, 7]), Object.freeze([236, 229, 216]), null, Object.freeze([104, 236, 164]), Object.freeze([255, 212, 121]));
  const themes = new Map();
  function theme(palette) {
    if (!palette || typeof palette !== "object") return INK_DEFAULTS;
    const { background, text, accent2, done, amber } = palette;
    const memo = `${background}|${text}|${accent2}|${done}|${amber}`;
    let value = themes.get(memo);
    if (!value) {
      // The second hue only counts as a full #rrggbb (as the Void accent always has).
      value = buildTheme(parseHex(background) ?? INK_DEFAULTS.bg, parseHex(text) ?? INK_DEFAULTS.text, parseHex(accent2, true), parseHex(done) ?? INK_DEFAULTS.done, parseHex(amber) ?? INK_DEFAULTS.amber);
      if (themes.size >= 8) themes.clear();
      themes.set(memo, value);
    }
    return value;
  }

  // A tint's derived tones under a theme, cached per triple and rebuilt when
  // the theme changes: core/deep sink toward the background, spec/hot/frost/
  // ink rise toward the highlight. Read-only.
  const inks = new WeakMap();
  function inkOf(tint, currentTheme = INK_DEFAULTS) {
    const active = currentTheme ?? INK_DEFAULTS;
    let record = inks.get(tint);
    if (record && record.key === active.key) return record;
    record = {
      key: active.key,
      core: mix(tint, active.bg, 0.84), deep: mix(tint, active.bg, 0.86),
      spec: mix(tint, active.hi, 0.78), hot: mix(tint, active.hi, 0.6),
      frost: mix(tint, active.hi, 0.82), ink: mix(tint, active.hi, 0.9),
    };
    inks.set(tint, record);
    return record;
  }

  // A light glyph ink that keeps a trace of the hue, for glyphs on a dark body.
  const lightInks = new WeakMap();
  function lightInk(tint) {
    let ink = lightInks.get(tint);
    if (!ink) { ink = rgba(mix(tint, WHITE, 0.86), 1); lightInks.set(tint, ink); }
    return ink;
  }

  // Detail tiers by painted radius: T0 below 6 px, T1 to 8.5, T2 to 10.5, T3
  // above. The cuts sit clear of the common radii (todos 3.4–5.2, quiet
  // sessions 11), so orbiting never flips a node's detail. `cap` is the
  // caller's ceiling (far layer, dimmed, camera moving, frame cost); a tier's
  // extras fade in over its first 1.2 px (tierIn).
  const TIER_CUTS = Object.freeze([0, 6, 8.5, 10.5]);
  function tier(radius, cap = 3) {
    const level = radius >= 10.5 ? 3 : radius >= 8.5 ? 2 : radius >= 6 ? 1 : 0;
    const limit = Number.isFinite(cap) ? Math.max(0, Math.floor(cap)) : 3;
    return Math.min(level, limit);
  }
  const tierIn = (radius, level) => level <= 0 ? 1 : clamp01((radius - TIER_CUTS[Math.min(3, level)]) / 1.2);

  // Extra glow (the appearance toggle): a soft halo under any style, out to
  // 1.8 radii, 2.25 while the node is lit. `lit` is the node's eased 0..1
  // level (m.lit): the quiet and the lit halo cross-fade by globalAlpha, so
  // hover and selection never pop it, and at 0 or 1 only one of them draws.
  // One cache entry per canvas and tint holds both unit-space radials, each
  // built the first time it shows and drawn under the node's own transform,
  // so a steady frame builds nothing; paint() lays it under the look.
  function glowPaint(ctx, tint, lit) {
    const glow = ctx.createRadialGradient(0, 0, 0.25, 0, 0, lit ? 2.25 : 1.8);
    glow.addColorStop(0, rgba(tint, lit ? 0.32 : 0.16));
    glow.addColorStop(0.45, rgba(tint, lit ? 0.14 : 0.05));
    glow.addColorStop(1, rgba(tint, 0));
    return glow;
  }
  function extraGlow(ctx, p, radius, tint, lit) {
    const key = `glow|${tint.join(",")}`;
    const glow = cacheGet(ctx, key) ?? cachePut(ctx, key, { quiet: null, lit: null });
    const level = lit >= 1 ? 1 : lit > 0 ? lit : 0;
    const base = ctx.globalAlpha;
    ctx.save(); ctx.translate(p.x, p.y); ctx.scale(radius, radius);
    if (level < 1) {
      glow.quiet ??= glowPaint(ctx, tint, false);
      ctx.globalAlpha = base * (1 - level);
      ctx.fillStyle = glow.quiet; ctx.beginPath(); ctx.arc(0, 0, 1.8, 0, TAU); ctx.fill();
    }
    if (level > 0) {
      glow.lit ??= glowPaint(ctx, tint, true);
      ctx.globalAlpha = base * level;
      ctx.fillStyle = glow.lit; ctx.beginPath(); ctx.arc(0, 0, 2.25, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  // The registry: one entry per style, registered by its own section below.
  // Entry: { speedup, paint(ctx, p, radius, tint, o, m), glyph, ring, hubDress,
  // orbit, arrival, select, wire, surge, land, reach }.
  const LOOKS = Object.create(null);
  const lookOf = (style) => LOOKS[style] ?? null;
  const EMPTY = Object.freeze({});
  // A known style's hook `name`: its own, else the owning section's shared
  // default (`defaults`), else null. An unknown style has no hooks at all.
  function hookOf(style, name, defaults) {
    const look = lookOf(style);
    if (!look) return null;
    const hook = look[name] ?? defaults[name];
    return typeof hook === "function" ? hook : null;
  }

// ===== shapes: void =====

  // The Void collection's shapes, built once and shared by both canvases, so
  // the rail and the Command view cut the same gem and mark the same seal. The
  // helpers only add subpaths (the caller begins and fills), at a screen
  // position and radius or in unit space. This section is closed: a style's
  // new shapes live in its own section under a style prefix (sigilHex…).
  function buildVoidShapes() {
    // Prism: a kite-cut gem lit from the upper left, as x, y pairs in unit
    // space. A short crown over the girdle, a long pavilion below it; the
    // pavilion's two planes meet the girdle at the ridge.
    const rim = [0, -1.02, 0.86, -0.26, 0, 1.08, -0.86, -0.26]; // top, right, bottom, left
    const ridge = [-0.12, -0.26];
    // Sigil: its marks sit evenly between the two rings, the first at the top
    // ([cos, sin] per mark).
    const marks = { 3: [], 6: [] };
    for (const count of [3, 6]) {
      for (let index = 0; index < count; index += 1) {
        const angle = -Math.PI / 2 + index * Math.PI * 2 / count;
        marks[count].push(Math.cos(angle), Math.sin(angle));
      }
    }
    function trace(target, points, x = 0, y = 0, scale = 1) {
      target.moveTo(x + points[0] * scale, y + points[1] * scale);
      for (let index = 2; index < points.length; index += 2) target.lineTo(x + points[index] * scale, y + points[index + 1] * scale);
      target.closePath();
    }
    function triangle(target, a, b, c) {
      target.moveTo(a[0], a[1]); target.lineTo(b[0], b[1]); target.lineTo(c[0], c[1]); target.closePath();
    }
    const top = [rim[0], rim[1]], right = [rim[2], rim[3]], bottom = [rim[4], rim[5]], left = [rim[6], rim[7]];
    const markCount = (radius) => radius >= 11 ? 6 : radius >= 6 ? 3 : 0;
    return Object.freeze({
      prismRim: rim,
      trace,
      // Three planes on a readable gem (the lit crown, the pavilion's mid left
      // and its shadowed right), two halves on a small one, one plane on a tiny one.
      prismFacets: (radius) => radius >= 6 ? 3 : radius >= 3.5 ? 2 : 1,
      // Plane `index` of a `count`-plane cut, in unit space; its tone is the
      // index on the three-plane cut (0 light, 1 mid, 2 shadow), light then
      // mid on two, mid on one.
      prismFacet(target, count, index) {
        if (count === 3) {
          if (index === 0) triangle(target, top, right, left);
          else if (index === 1) triangle(target, left, ridge, bottom);
          else triangle(target, ridge, right, bottom);
        } else if (count === 2) triangle(target, top, index === 0 ? left : right, bottom);
        else trace(target, rim);
      },
      // The dark table a glyph sits on, so its light ink never crosses a facet.
      prismTable: (target, x, y, radius) => trace(target, rim, x, y + radius * 0.04, radius * 0.6),
      // The light that refracts out along the pavilion's lower right edge.
      prismEdge(target, x, y, radius) {
        target.moveTo(x + (right[0] + (bottom[0] - right[0]) * 0.12) * radius, y + (right[1] + (bottom[1] - right[1]) * 0.12) * radius);
        target.lineTo(x + (right[0] + (bottom[0] - right[0]) * 0.78) * radius, y + (right[1] + (bottom[1] - right[1]) * 0.78) * radius);
      },
      // One small four-point glint on the crown.
      prismGlint(target, x, y, radius) {
        const gx = x - radius * 0.26, gy = y - radius * 0.5, arm = radius * 0.17, waist = arm * 0.22;
        target.moveTo(gx, gy - arm); target.lineTo(gx + waist, gy - waist); target.lineTo(gx + arm, gy); target.lineTo(gx + waist, gy + waist);
        target.lineTo(gx, gy + arm); target.lineTo(gx - waist, gy + waist); target.lineTo(gx - arm, gy); target.lineTo(gx - waist, gy - waist); target.closePath();
      },
      // None below 6px, three small diamonds on a small seal, six on a large
      // one, each pointing out from the centre between the two rings.
      sigilMarkCount: markCount,
      sigilMarks(target, x, y, radius) {
        const count = markCount(radius);
        if (!count) return;
        const points = marks[count], at = radius * 0.73, long = Math.max(1.4, radius * 0.12), wide = long * 0.58;
        for (let index = 0; index < points.length; index += 2) {
          const cos = points[index], sin = points[index + 1], mx = x + cos * at, my = y + sin * at;
          target.moveTo(mx + cos * long, my + sin * long); target.lineTo(mx - sin * wide, my + cos * wide);
          target.lineTo(mx - cos * long, my - sin * long); target.lineTo(mx + sin * wide, my - cos * wide); target.closePath();
        }
      },
      // The centre seal: a small rotated square, or a dot on a tiny node.
      sigilSeal(target, x, y, radius) {
        if (radius < 6) { target.moveTo(x + Math.max(1.2, radius * 0.24), y); target.arc(x, y, Math.max(1.2, radius * 0.24), 0, Math.PI * 2); return; }
        const seal = radius * 0.2;
        target.moveTo(x, y - seal); target.lineTo(x + seal, y); target.lineTo(x, y + seal); target.lineTo(x - seal, y); target.closePath();
      },
    });
  }
  const SHAPES = buildVoidShapes();

  // The Void bodies' shared tones: hot, the whitened tint; ink, a light glyph
  // ink that keeps a trace of the hue; deep, a body dark enough to read as
  // depth, still carrying the hue; shade, the gem's shadow plane. The theme's
  // second hue (accent) is only ever a highlight; without one it is `hot`.
  const VOID_DEEP = Object.freeze([7, 8, 16]);
  function voidTones(tint, accent2) {
    const hot = mix(tint, WHITE, 0.6), ink = mix(tint, WHITE, 0.86), deep = mix(tint, VOID_DEEP, 0.86);
    return { hot, ink, deep, shade: mix(deep, tint, 0.4), accent: accent2 ?? hot };
  }
  // A node that wears a glyph (the hub's monogram, an agent's role) writes it
  // in the light ink, inside the dark body.
  function voidMonogram(ctx, p, o, ink) {
    if (!o.monogram) return;
    ctx.font = '600 10px system-ui, "Segoe UI", sans-serif'; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = rgba(ink, 1);
    ctx.fillText(o.kind === "music" ? "♪" : "M", p.x, p.y + 0.5);
  }

// ===== style: orbs =====

  // The five free looks share a few helpers, defined here in the first of
  // their sections. freeLevels: the node's eased lit, selected and working
  // levels (from its motion record, or from the flags for a bare pose), in
  // one scratch. freeKey: a look's paint-cache key for a tint under a theme,
  // built once per (theme, tint) pair and kept per theme, so a steady frame
  // builds no string even when two canvases paint under different themes.
  const FREE_LEVELS = { lit: 0, sel: 0, work: 0 };
  function freeLevels(n, m) {
    FREE_LEVELS.lit = Number.isFinite(m.lit) ? clamp01(m.lit) : n.active || n.selected ? 1 : 0;
    FREE_LEVELS.sel = Number.isFinite(m.sel) ? clamp01(m.sel) : n.selected ? 1 : 0;
    FREE_LEVELS.work = Number.isFinite(m.work) ? clamp01(m.work) : n.active ? 1 : 0;
    return FREE_LEVELS;
  }
  // A WeakMap per theme object, then per tint triple (both stable identities).
  function freeByTheme(memo, currentTheme) {
    let byTint = memo.get(currentTheme);
    if (!byTint) { byTint = new WeakMap(); memo.set(currentTheme, byTint); }
    return byTint;
  }
  function freeKey(memo, style, tint, currentTheme) {
    const byTint = freeByTheme(memo, currentTheme);
    let key = byTint.get(tint);
    if (key === undefined) { key = `${style}|${tint.join(",")}|${currentTheme.key}`; byTint.set(tint, key); }
    return key;
  }
  // On a light theme a bright tint (done green, amber) would melt into the
  // page, so each look's edge (a rim, a ring) takes a tone deepened toward
  // the theme's dark highlight; dark themes keep the tint. Built on a cache
  // miss only (mix makes a new triple).
  const freeEdge = (tint, currentTheme) => currentTheme.light ? mix(tint, currentTheme.hi, 0.6) : tint;
  // The rims breathe with the node, 4.2 s a breath (1.6 s working), at every
  // size and tier: ±25% of their alpha (the orb and glass rims their width
  // too), the motion a todo-sized node keeps.
  const freeBreath = (m) => 0.6 + 0.4 * swell(m, 4.2);
  // A dark ink that keeps a trace of the hue, for a glyph on a bright body.
  const FREE_DARK = Object.freeze([11, 14, 20]);
  const freeLuma = (triple) => triple[0] * 0.2126 + triple[1] * 0.7152 + triple[2] * 0.0722;
  // Each free look's glyph ink for a tint under a theme (the hub's monogram
  // and an agent's role glyph), cached per theme and triple: an orb writes
  // on its body's centre (the tint at about .76 over the theme-derived core),
  // so both its role glyph and its monogram take the ink that stands off
  // that centre (the monogram's thin letter stays light a little longer);
  // glass, halo and crystal wear theirs on a body sunk toward the
  // background, so the ink rises toward the theme's highlight; minimal
  // writes in its edge tone. `dot` is minimal's dot tone (the tint, deepened
  // a little less than an edge on a light page), `dotRest` that dot's fill
  // on a quiet node. The last (theme, tint) pair answers first: neighbours
  // in a frame mostly share a tint, so most nodes skip both WeakMaps.
  const freeInkMemo = new WeakMap();
  let freeInkTheme = null, freeInkTint = null, freeInkLast = null;
  function freeInks(tint, currentTheme) {
    const active = currentTheme ?? INK_DEFAULTS;
    if (tint === freeInkTint && active === freeInkTheme) return freeInkLast;
    const byTint = freeByTheme(freeInkMemo, active);
    let inks = byTint.get(tint);
    if (!inks) {
      const tones = inkOf(tint, active);
      const dark = mix(tint, FREE_DARK, 0.84), deep = mix(tint, FREE_DARK, 0.9), light = mix(tint, WHITE, 0.9);
      const centre = freeLuma(mix(tones.core, tint, 0.76));
      inks = {
        orbs: rgba(active.light ? (centre < 95 ? light : deep) : (centre > 150 ? deep : light), 1),
        orbsText: rgba(centre > (active.light ? 110 : 185) ? dark : light, 1),
        glass: rgba(tones.frost, 1),
        minimal: rgba(freeEdge(tint, active), 1),
        halo: rgba(tones.hot, 1),
        crystal: rgba(tones.ink, 1),
        dot: active.light ? mix(tint, active.hi, 0.55) : tint,
        dotRest: null,
      };
      inks.dotRest = rgba(inks.dot, qa(active.light ? 0.8 : 0.6));
      byTint.set(tint, inks);
    }
    freeInkTheme = active; freeInkTint = tint; freeInkLast = inks;
    return inks;
  }
  function freeMonogram(ctx, p, n, ink) {
    ctx.font = '600 10px system-ui, "Segoe UI", sans-serif'; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = ink; ctx.fillText(n.kind === "music" ? "♪" : "M", p.x, p.y + 0.5);
  }
  // The round looks trace their arcs in pixels, where the canvas draws them
  // fastest (its own transform is at most the display's scale; an arc drawn
  // under a translation costs about three times as much); only a cached
  // gradient needs the node's unit space, entered and left around its fill.
  // (Crystal's straight cut is as cheap in its unit space and stays there.)
  // A transform change re-maps the current path, so each clears the path
  // first, and the way back is the inverse (cheaper than a save and a
  // restore; paint() restores the canvas after the look in any case).
  // freeLeave leaves an empty path for the next draw to trace.
  function freeEnter(ctx, p, scale) { ctx.beginPath(); ctx.translate(p.x, p.y); ctx.scale(scale, scale); }
  function freeLeave(ctx, p, scale) { ctx.beginPath(); ctx.scale(1 / scale, 1 / scale); ctx.translate(-p.x, -p.y); }

  // Classic orbs: a luminous bead on an opaque, theme-derived core. The body
  // is one cached radial with the specular baked in (upper left), swaying a
  // little about its centre, so nothing inside the body ever changes its
  // brightness over time (the audio response reads it there). Around it a
  // halo breathes deeply with the rim (the motion a todo-sized orb shows;
  // clear inside .67 r, it lies over the core's outer ring, under the
  // body), and a light glint rides the rim: soft at rest, bright and quick
  // while the node works. On a light page the body's outer stops and a
  // firmer rim take the deepened edge tone.
  const orbKeys = new WeakMap();
  function orbPaints(ctx, tint, currentTheme) {
    const key = freeKey(orbKeys, "orbs", tint, currentTheme);
    const cached = cacheGet(ctx, key);
    if (cached) return cached;
    const spec = mix(tint, WHITE, 0.8), edge = freeEdge(tint, currentTheme), light = currentTheme.light;
    // The halo in its own unit space (scaled by the breathing reach): clear
    // inside half the reach (at least .67 r, so a translucent body never
    // shows it breathing through its middle), brightest just past that and
    // fading out to the reach. A plain disc, not a ring path, so it takes
    // the canvas's fast circle fill.
    const halo = ctx.createRadialGradient(0, 0, 0.5, 0, 0, 1);
    halo.addColorStop(0, rgba(tint, 0)); halo.addColorStop(0.12, rgba(tint, 0.21)); halo.addColorStop(0.36, rgba(tint, 0.15));
    halo.addColorStop(0.7, rgba(tint, 0.07)); halo.addColorStop(1, rgba(tint, 0));
    const body = ctx.createRadialGradient(-0.3, -0.36, 0, 0, 0, 1);
    body.addColorStop(0, rgba(spec, 0.96)); body.addColorStop(0.1, rgba(mix(tint, WHITE, 0.4), 0.9));
    body.addColorStop(0.28, rgba(tint, 0.8)); body.addColorStop(0.62, rgba(edge, light ? 0.5 : 0.42)); body.addColorStop(1, rgba(edge, light ? 0.35 : 0.1));
    return cachePut(ctx, key, { halo, body, edge, light, core: rgba(inkOf(tint, currentTheme).core, 1), glint: rgba(spec, 0.95) });
  }
  function paintOrbs(ctx, p, radius, tint, n, m) {
    const paints = orbPaints(ctx, tint, n.theme);
    const { lit, sel, work } = freeLevels(n, m);
    const base = n.alpha;
    const breath = swell(m, 4.2);
    const reach = 1.34 + 0.22 * lit + 0.24 * breath; // at most 1.8r; clear inside .67 r
    // The core, opaque at the caller's alpha.
    ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, TAU);
    ctx.fillStyle = paints.core; ctx.fill();
    // The two cached radials in the orb's unit space: the halo at its reach
    // (over the core's outer ring, under the body), then the body, swaying
    // about its centre.
    freeEnter(ctx, p, radius * reach);
    ctx.arc(0, 0, 1, 0, TAU);
    ctx.globalAlpha = base * (0.42 + 0.58 * lit) * (0.5 + 0.5 * breath);
    ctx.fillStyle = paints.halo; ctx.fill();
    ctx.beginPath(); ctx.scale(1 / reach, 1 / reach);
    const sway = !m.still && radius >= 5 ? 0.14 * (2 * swell(m, 7) - 1) : 0;
    if (sway) ctx.rotate(sway);
    ctx.arc(0, 0, 1, 0, TAU);
    ctx.globalAlpha = base;
    ctx.fillStyle = paints.body; ctx.fill();
    if (sway) { ctx.beginPath(); ctx.rotate(-sway); }
    freeLeave(ctx, p, radius);
    // The rim breathes with the halo (the same 4.2 s breath) in alpha and width.
    ctx.arc(p.x, p.y, radius, 0, TAU);
    ctx.strokeStyle = rgba(paints.edge, qa((paints.light ? 0.85 + 0.1 * lit + 0.05 * sel : 0.5 + 0.32 * lit + 0.18 * sel) * (0.55 + 0.45 * breath)));
    ctx.lineWidth = ((paints.light ? 1 : 0.8) + 0.5 * lit + 0.5 * sel) * (0.8 + 0.4 * breath); ctx.stroke();
    // The glint (T1 up, faded in over the tier's first 1.2 px): a streak of
    // rim light riding round the inside of the rim, clear of the body's
    // middle.
    const shown = n.detail >= 1 ? tierIn(radius, 1) : 0;
    if (shown > 0) {
      const angle = turn(m, 4.7, 0.35);
      ctx.globalAlpha = base * shown * (0.5 + 0.5 * work) * (0.75 + 0.25 * swell(m, 1.8, 1));
      ctx.strokeStyle = paints.glint; ctx.lineWidth = Math.max(0.8, radius * 0.09); ctx.lineCap = "round";
      ctx.beginPath(); ctx.arc(p.x, p.y, radius * 0.84, angle - 0.55, angle + 0.55); ctx.stroke();
    }
    // paint() restores the canvas after the look, so the glint's gain needs
    // undoing only when the monogram still has to be written.
    if (n.monogram) { ctx.globalAlpha = base; freeMonogram(ctx, p, n, freeInks(tint, n.theme).orbsText); }
  }
  LOOKS.orbs = { speedup: 2.6, paint: paintOrbs, glyph: { scale: 0.7, ringGap: 3.5, ink: (tint, currentTheme) => freeInks(tint, currentTheme).orbs }, ring: null, hubDress: null, orbit: null, arrival: null, select: null, wire: null, surge: null, land: null, reach: 1 };

// ===== style: glass =====

  // Soft glass: a pane sunk toward the background under a cached tint wash
  // that swells with the node's breath, a crisp rim breathing in alpha and
  // width (pulsing while it works), a frost ring, one light catch that sways
  // upper left and a caustic lower right. A soft frost sheen (a cached,
  // feathered band) sweeps across the pane from the light over most of each
  // pass, 2.6 times as often while it works; no clip, the band fills the
  // pane's own circle. On a light page the pane keeps most of the hue and
  // the frost layers are brighter, so the light still reads as light on it.
  const glassKeys = new WeakMap();
  // The sweep's direction, from the upper left toward the lower right.
  const GLASS_SWEEP_X = Math.cos(0.72), GLASS_SWEEP_Y = Math.sin(0.72);
  function glassPaints(ctx, tint, currentTheme) {
    const key = freeKey(glassKeys, "glass", tint, currentTheme);
    const cached = cacheGet(ctx, key);
    if (cached) return cached;
    const light = currentTheme.light;
    const wash = ctx.createLinearGradient(-0.9, -0.9, 0.9, 0.9);
    wash.addColorStop(0, rgba(tint, 0.46)); wash.addColorStop(0.5, rgba(tint, 0.12)); wash.addColorStop(1, rgba(tint, 0.05));
    const frost = mix(tint, WHITE, 0.82);
    // The sheen across the sweep's axis (.34 either side of its middle):
    // feathered edges, a brighter core.
    const sheen = ctx.createLinearGradient(-0.34 * GLASS_SWEEP_X, -0.34 * GLASS_SWEEP_Y, 0.34 * GLASS_SWEEP_X, 0.34 * GLASS_SWEEP_Y);
    sheen.addColorStop(0, rgba(frost, 0)); sheen.addColorStop(0.34, rgba(frost, light ? 0.28 : 0.16)); sheen.addColorStop(0.5, rgba(frost, light ? 0.7 : 0.42));
    sheen.addColorStop(0.66, rgba(frost, light ? 0.28 : 0.16)); sheen.addColorStop(1, rgba(frost, 0));
    return cachePut(ctx, key, {
      wash, sheen, frost, edge: freeEdge(tint, currentTheme), light,
      pane: rgba(mix(tint, currentTheme.bg, light ? 0.32 : 0.78), 0.92),
      catch: rgba(frost, light ? 0.9 : 0.62), caustic: light ? rgba(WHITE, 0.85) : rgba(mix(tint, WHITE, 0.35), 0.5),
    });
  }
  function paintGlass(ctx, p, radius, tint, n, m) {
    const paints = glassPaints(ctx, tint, n.theme);
    const { lit, sel, work } = freeLevels(n, m);
    const base = n.alpha;
    const breath = swell(m, 4.2);
    ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, TAU);
    ctx.fillStyle = paints.pane; ctx.fill();
    // The wash (its cached gradient in the pane's unit space) swells deeply
    // with the node's breath.
    freeEnter(ctx, p, radius);
    ctx.arc(0, 0, 1, 0, TAU);
    ctx.globalAlpha = base * (0.62 + 0.38 * lit) * (0.5 + 0.5 * breath);
    ctx.fillStyle = paints.wash; ctx.fill();
    // The sheen (T1 up): the first 80% of each 6.8 s pass (2.6 s working)
    // sweeps it from the upper left to the lower right, at full strength
    // through the middle of the sweep and easing in and out at the pane's
    // edges; reduced motion parks it by the light. The cached band moves
    // along the sweep; the pane's circle moves back under it.
    const shown = n.detail >= 1 ? tierIn(radius, 1) : 0;
    if (shown > 0) {
      let at = -0.5, envelope = 0.8;
      if (!m.still) {
        const u = cycle(m, 6.8) / 0.8;
        envelope = u < 1 ? smooth01(u / 0.15) * smooth01((1 - u) / 0.15) : 0;
        at = -1 + 2 * u;
      }
      const gain = shown * envelope * (0.65 + 0.35 * lit);
      if (gain > 0.004) {
        const dx = at * GLASS_SWEEP_X, dy = at * GLASS_SWEEP_Y;
        ctx.beginPath(); ctx.translate(dx, dy);
        ctx.arc(-dx, -dy, 1, 0, TAU);
        ctx.globalAlpha = base * gain;
        ctx.fillStyle = paints.sheen; ctx.fill();
        ctx.beginPath(); ctx.translate(-dx, -dy);
      }
    }
    freeLeave(ctx, p, radius);
    ctx.globalAlpha = base;
    // The rim breathes in alpha and width, and pulses on top of that while
    // the node works; a light page gets a firmer rim.
    ctx.arc(p.x, p.y, radius, 0, TAU);
    const pulse = work > 0 ? 1 - 0.2 * work * (1 - swell(m, 2.2)) : 1;
    const rim = paints.light ? 0.85 + 0.1 * lit + 0.05 * sel : 0.5 + 0.28 * lit + 0.22 * sel;
    ctx.strokeStyle = rgba(paints.edge, qa(rim * (0.55 + 0.45 * breath) * pulse)); ctx.lineWidth = (1 + 0.7 * sel) * (0.8 + 0.4 * breath); ctx.stroke();
    // The light catch, swaying upper left, at every size (on a small pane
    // it keeps a little over half the radius, clear of the centre).
    const sway = 0.3 * (2 * swell(m, 7.2) - 1), from = Math.PI * 1.1 + sway;
    ctx.lineCap = "round"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(radius * 0.55, radius - Math.max(2, radius * 0.22)), from, from + Math.PI * 0.47);
    ctx.strokeStyle = paints.catch; ctx.stroke();
    // T2 up: a frost ring inside the rim and a caustic lower right, drawn
    // last so their gains need no undoing (paint() restores the canvas).
    const fine = n.detail >= 2 ? tierIn(radius, 2) : 0;
    if (fine > 0) {
      ctx.globalAlpha = base * fine;
      ctx.beginPath(); ctx.arc(p.x, p.y, radius - Math.max(1.2, radius * 0.12), 0, TAU);
      ctx.strokeStyle = rgba(paints.frost, qa(paints.light ? 0.3 + 0.15 * lit : 0.14 + 0.1 * lit)); ctx.stroke();
      ctx.globalAlpha = base * fine * (0.6 + 0.4 * lit);
      ctx.beginPath(); ctx.arc(p.x, p.y, radius - Math.max(1.6, radius * 0.14), Math.PI * 0.12 + sway, Math.PI * 0.5 + sway);
      ctx.strokeStyle = paints.caustic; ctx.stroke();
    }
    if (n.monogram) { ctx.globalAlpha = base; freeMonogram(ctx, p, n, freeInks(tint, n.theme).glass); }
  }
  LOOKS.glass = { speedup: 2.6, paint: paintGlass, glyph: { scale: 0.66, ringGap: 3.5, ink: (tint, currentTheme) => freeInks(tint, currentTheme).glass }, ring: null, hubDress: null, orbit: null, arrival: null, select: null, wire: null, surge: null, land: null, reach: 1 };

// ===== style: minimal =====

  // Minimal: one breathing dot, larger while it works, with a sonar ring
  // going out from it (born soft, never glued to the dot); a selection ring
  // in the theme's text colour. On a light page the dot and the sonar take
  // a tone deepened toward the theme's dark highlight, at a firmer alpha.
  // An agent keeps a backing disc for its role glyph, the hub a larger dot
  // and no monogram.
  function paintMinimal(ctx, p, radius, tint, n, m) {
    const { lit, sel, work } = freeLevels(n, m);
    const base = n.alpha;
    const breath = 2 * swell(m, 3.6) - 1;
    const inks = freeInks(tint, n.theme), tone = inks.dot;
    let dot;
    ctx.beginPath();
    if (n.glyph && n.kind === "agent") {
      dot = radius * 0.78 * (1 + 0.05 * breath);
      ctx.arc(p.x, p.y, dot, 0, TAU);
      ctx.fillStyle = rgba(tint, qa(0.26 + 0.12 * lit)); ctx.fill();
    } else {
      dot = Math.max(2.5, radius * (n.monogram ? 0.62 : 0.46 + 0.14 * work + 0.05 * sel)) * (1 + (0.14 + 0.06 * work) * breath);
      ctx.arc(p.x, p.y, dot, 0, TAU);
      ctx.fillStyle = lit > 0 ? rgba(tone, qa(n.theme.light ? 0.8 + 0.2 * lit : 0.6 + 0.35 * lit)) : inks.dotRest; ctx.fill();
    }
    if (work > 0.01 && radius >= 4) {
      const u = m.still ? 0.45 : cycle(m, 4.2);
      const fade = 1 - u;
      ctx.globalAlpha = base * 0.6 * fade * Math.sqrt(fade) * work * smooth01(u / 0.25);
      ctx.beginPath(); ctx.arc(p.x, p.y, dot + (radius * 1.25 - dot) * u, 0, TAU);
      ctx.strokeStyle = rgba(tone, 1); ctx.lineWidth = 1; ctx.stroke();
      ctx.globalAlpha = base;
    }
    if (sel > 0.01) {
      ctx.globalAlpha = base * sel;
      ctx.beginPath(); ctx.arc(p.x, p.y, dot + 2.5, 0, TAU);
      ctx.strokeStyle = rgba(n.theme.text, 0.9); ctx.lineWidth = 1.5; ctx.stroke();
      ctx.globalAlpha = base;
    }
  }
  LOOKS.minimal = { speedup: 2.6, paint: paintMinimal, glyph: { scale: 0.62, ringGap: 2, ink: (tint, currentTheme) => freeInks(tint, currentTheme).minimal }, ring: null, hubDress: null, orbit: null, arrival: null, select: null, wire: null, surge: null, land: null, reach: 1 };

// ===== style: halo =====

  // Halo: a dark disc inside a glowing ring. The glow breathes deeply (no
  // shadowBlur): up to T2 a single soft band stroked outside the ring, from
  // T3 up a cached radial peaking on the ring, the two cross-fading over
  // T3's first 1.2 px (a quiet node below T1 skips it: too faint to see).
  // The ring breathes, a core dot pulses in size and brightness, an inner
  // ring turns its dashes from T2 up (crossing over from a solid one as T2
  // fades in), and a comet runs round the ring while the node works. On a
  // light page the ring, the inner ring and the core take the deepened edge
  // tone (the ring a firmer alpha) and the comet a dark head.
  const haloKeys = new WeakMap();
  // Eight dashes and eight gaps round the inner ring (a scratch the painter
  // fills; setLineDash copies it).
  const HALO_DASH = [1, 1];
  function haloPaints(ctx, tint, currentTheme) {
    const key = freeKey(haloKeys, "halo", tint, currentTheme);
    const cached = cacheGet(ctx, key);
    if (cached) return cached;
    const glow = ctx.createRadialGradient(0, 0, 0.55, 0, 0, 1.55);
    glow.addColorStop(0, rgba(tint, 0)); glow.addColorStop(0.3, rgba(tint, 0.16)); glow.addColorStop(0.45, rgba(tint, 0.42));
    glow.addColorStop(0.62, rgba(tint, 0.12)); glow.addColorStop(1, rgba(tint, 0));
    const tones = inkOf(tint, currentTheme);
    const comet = currentTheme.light ? mix(tint, currentTheme.hi, 0.8) : mix(tint, WHITE, 0.85);
    return cachePut(ctx, key, {
      glow, edge: freeEdge(tint, currentTheme), light: currentTheme.light, band: rgba(tint, 0.14),
      core: rgba(tones.core, 0.86), comet: rgba(comet, 0.9),
    });
  }
  function paintHalo(ctx, p, radius, tint, n, m) {
    const paints = haloPaints(ctx, tint, n.theme);
    const { lit, sel, work } = freeLevels(n, m);
    const base = n.alpha;
    const shown = n.detail >= 1 ? tierIn(radius, 1) : 0;
    // The glow: up to T2 one soft band stroked from the ring out to 1.45 r
    // (below T1, too faint to see on a quiet node, only a lit one keeps it,
    // faded in over T1's first 1.2 px); from T3 up the cached radial, in the
    // node's unit space (the two cross-fade over T3's first 1.2 px).
    const soft = n.detail >= 3 ? tierIn(radius, 3) : 0;
    const band = (1 - soft) * (lit + (1 - lit) * shown);
    if (band > 0.01 || soft > 0) {
      const glow = (0.45 + 0.55 * lit) * (0.65 + 0.35 * swell(m, 3.2));
      ctx.beginPath();
      if (band > 0.01) {
        ctx.globalAlpha = base * glow * band;
        ctx.arc(p.x, p.y, radius * 1.22, 0, TAU);
        ctx.strokeStyle = paints.band; ctx.lineWidth = radius * 0.45; ctx.stroke();
      }
      if (soft > 0) {
        freeEnter(ctx, p, radius);
        ctx.arc(0, 0, 1.55, 0, TAU);
        ctx.globalAlpha = base * glow * soft;
        ctx.fillStyle = paints.glow; ctx.fill();
        freeLeave(ctx, p, radius);
      }
      ctx.globalAlpha = base;
    }
    const ringWidth = 1.4 + 0.6 * lit + 0.4 * sel;
    ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, TAU);
    ctx.fillStyle = paints.core; ctx.fill();
    ctx.strokeStyle = rgba(paints.edge, qa((paints.light ? 0.82 + 0.16 * lit : 0.68 + 0.27 * lit) * freeBreath(m))); ctx.lineWidth = ringWidth; ctx.stroke();
    // The comet (T1 up, while it works): a bright head and a fading tail.
    if (shown > 0 && work > 0.02 && radius >= 5) {
      const head = turn(m, 4.4, -Math.PI / 2);
      ctx.lineCap = "round"; ctx.lineWidth = ringWidth + 1.2; ctx.strokeStyle = paints.comet;
      ctx.globalAlpha = base * shown * work * 0.45;
      ctx.beginPath(); ctx.arc(p.x, p.y, radius, head - 0.8, head); ctx.stroke();
      ctx.globalAlpha = base * shown * work;
      ctx.beginPath(); ctx.arc(p.x, p.y, radius, head, head + 0.9); ctx.stroke();
      ctx.globalAlpha = base;
    }
    // The core dot pulses in brightness as well as size, so it still beats
    // while a small node holds it at its 1.5 px floor.
    if (!n.glyph) {
      const beat = swell(m, 3.1);
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1.5, radius * 0.16 * (1 + (0.25 + 0.3 * work) * beat)), 0, TAU);
      ctx.fillStyle = rgba(paints.edge, qa(0.55 + 0.4 * beat)); ctx.fill();
    }
    // The inner ring (none on a node too small to hold it apart from the
    // core): solid below T2, dashed and turning from T2 up; while T2 fades
    // in over its first 1.2 px the two cross-fade, so a zoom never pops it.
    // Only the fade band sets gains (the alpha is at base on either side),
    // and the dash is left for paint()'s restore to clear: nothing is
    // stroked after it.
    if (radius >= 5) {
      const dashed = n.detail >= 2 ? tierIn(radius, 2) : 0;
      const fading = dashed > 0 && dashed < 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, radius * 0.6, 0, TAU);
      if (dashed < 1) {
        if (fading) ctx.globalAlpha = base * (1 - dashed);
        ctx.strokeStyle = rgba(paints.edge, 0.24); ctx.lineWidth = 0.8; ctx.stroke();
      }
      if (dashed > 0) {
        HALO_DASH[0] = HALO_DASH[1] = TAU * radius * 0.6 / 16;
        if (fading) ctx.globalAlpha = base * dashed;
        ctx.setLineDash(HALO_DASH);
        ctx.lineDashOffset = -turn(m, 14) * radius * 0.6;
        ctx.strokeStyle = rgba(paints.edge, qa(0.34 + 0.2 * work)); ctx.lineWidth = 0.8 + 0.3 * work; ctx.stroke();
      }
      if (fading) ctx.globalAlpha = base;
    }
    if (n.monogram) freeMonogram(ctx, p, n, freeInks(tint, n.theme).halo);
  }
  LOOKS.halo = { speedup: 2.6, paint: paintHalo, glyph: { scale: 0.6, ringGap: 3.5, ink: (tint, currentTheme) => freeInks(tint, currentTheme).halo }, ring: null, hubDress: null, orbit: null, arrival: null, select: null, wire: null, surge: null, land: null, reach: 1 };

// ===== style: crystal =====

  // Crystal: an octagonal brilliant, flat on top, lit from the upper left.
  // It turns slowly under that fixed light (40 s a turn, 15 s working): the
  // light is a cached gradient that stays put while the cut turns through
  // it, alternate facets sit in shadow, and the facet whose face meets the
  // light flashes, handing over to its neighbour as the gem turns (no tone
  // ever pops). A tilt breathes, a sparkle twinkles where the light
  // strikes, and a lit gem glows inside an octagon. Detail by tier: below
  // T1 a plain gem; T1 adds the shadow facets and the table; T2 the flash
  // and the sparkle; T3 the cut's lines on a lit gem or one of 12 px and up
  // (each fading in over its tier's first 1.2 px).
  const crystalKeys = new WeakMap();
  const CRYSTAL_LIGHT = -Math.PI * 0.75;
  const CRYSTAL_OCT = new Float64Array(16);
  for (let k = 0; k < 8; k += 1) {
    CRYSTAL_OCT[2 * k] = Math.cos(Math.PI / 8 + k * Math.PI / 4);
    CRYSTAL_OCT[2 * k + 1] = Math.sin(Math.PI / 8 + k * Math.PI / 4);
  }
  const CRYSTAL_GEM = new Float64Array(16); // this frame's turned, tilted cut
  const CRYSTAL_DARK = Object.freeze([8, 10, 18]);
  function crystalPaints(ctx, tint, currentTheme) {
    const key = freeKey(crystalKeys, "crystal", tint, currentTheme);
    const cached = cacheGet(ctx, key);
    if (cached) return cached;
    // A light theme keeps the shadow side shallow, so the gem never reads
    // as a dark blob on the page.
    const depth = currentTheme.light ? 0.4 : 0.76;
    const light = ctx.createLinearGradient(-0.85, -0.85, 0.85, 0.85);
    light.addColorStop(0, rgba(mix(tint, WHITE, currentTheme.light ? 0.64 : 0.5), 0.97));
    light.addColorStop(0.4, rgba(currentTheme.light ? mix(tint, WHITE, 0.2) : tint, 0.94));
    light.addColorStop(1, rgba(mix(tint, CRYSTAL_DARK, depth), 0.97));
    const tones = inkOf(tint, currentTheme);
    // The lit glow, inside an octagon (built with the rest, shown when lit).
    const glow = ctx.createRadialGradient(0, 0, 0.5, 0, 0, 1.55);
    glow.addColorStop(0, rgba(tint, 0.26)); glow.addColorStop(1, rgba(tint, 0));
    return cachePut(ctx, key, {
      light, glow, firm: currentTheme.light,
      shade: rgba(mix(tint, CRYSTAL_DARK, depth), currentTheme.light ? 0.36 : 0.46), flash: rgba(mix(tint, WHITE, 0.78), 0.92),
      table: rgba(mix(tint, WHITE, 0.3), 0.62), well: rgba(tones.deep, 0.92), hot: tones.hot,
      spark: rgba(mix(tint, WHITE, 0.88), 0.95),
    });
  }
  // One facet (k: the outline edge from vertex k to k + 1 down to the table).
  function crystalFacet(ctx, k) {
    const j = (k + 1) % 8;
    ctx.moveTo(CRYSTAL_GEM[2 * k], CRYSTAL_GEM[2 * k + 1]);
    ctx.lineTo(CRYSTAL_GEM[2 * j], CRYSTAL_GEM[2 * j + 1]);
    ctx.lineTo(CRYSTAL_GEM[2 * j] * 0.52, CRYSTAL_GEM[2 * j + 1] * 0.52);
    ctx.lineTo(CRYSTAL_GEM[2 * k] * 0.52, CRYSTAL_GEM[2 * k + 1] * 0.52);
    ctx.closePath();
  }
  function crystalOutline(ctx, scale) {
    ctx.moveTo(CRYSTAL_GEM[0] * scale, CRYSTAL_GEM[1] * scale);
    for (let k = 1; k < 8; k += 1) ctx.lineTo(CRYSTAL_GEM[2 * k] * scale, CRYSTAL_GEM[2 * k + 1] * scale);
    ctx.closePath();
  }
  function paintCrystal(ctx, p, radius, tint, n, m) {
    const paints = crystalPaints(ctx, tint, n.theme);
    const { lit, sel } = freeLevels(n, m);
    const base = n.alpha;
    const spin = turn(m, 40), cos = Math.cos(spin), sin = Math.sin(spin);
    const tilt = 1 - 0.07 * swell(m, 5.6);
    for (let k = 0; k < 8; k += 1) {
      const x = CRYSTAL_OCT[2 * k], y = CRYSTAL_OCT[2 * k + 1];
      CRYSTAL_GEM[2 * k] = x * cos - y * sin;
      CRYSTAL_GEM[2 * k + 1] = tilt * (x * sin + y * cos);
    }
    const shown = n.detail >= 1 ? tierIn(radius, 1) : 0;
    const flashes = n.detail >= 2 ? tierIn(radius, 2) : 0;
    // The whole gem in its unit space, one transform and no save of its own
    // (paint() restores the canvas); strokes divide their pixel widths by
    // the radius.
    freeEnter(ctx, p, radius);
    if (lit > 0.01) {
      ctx.globalAlpha = base * lit;
      ctx.fillStyle = paints.glow; ctx.beginPath(); crystalOutline(ctx, 1.55); ctx.fill();
      ctx.globalAlpha = base;
    }
    // The gem and its rim from one traced outline (the rim in unit space,
    // its width divided back out); the facets drawn over it catch the rim's
    // inner half, so the girdle takes the light with them.
    ctx.beginPath(); crystalOutline(ctx, 1);
    ctx.fillStyle = paints.light; ctx.fill();
    ctx.lineJoin = "round";
    ctx.strokeStyle = rgba(paints.hot, qa((paints.firm ? 0.7 + 0.2 * lit + 0.1 * sel : 0.45 + 0.4 * lit + 0.15 * sel) * freeBreath(m))); ctx.lineWidth = (0.9 + 0.5 * lit + 0.6 * sel) / radius; ctx.stroke();
    if (shown > 0) {
      // Alternate facets in shadow (T1 up), then the flash (T2 up): the
      // facet facing the light and its neighbour share it by how far each
      // has turned.
      ctx.globalAlpha = base * shown;
      ctx.beginPath(); for (let k = 1; k < 8; k += 2) crystalFacet(ctx, k);
      ctx.fillStyle = paints.shade; ctx.fill();
      if (flashes > 0) {
        const at = (CRYSTAL_LIGHT - spin) / (Math.PI / 4) - 1, first = Math.floor(at), share = at - first;
        ctx.fillStyle = paints.flash;
        for (let index = 0; index < 2; index += 1) {
          const weight = smooth01(index ? share : 1 - share) * (0.55 + 0.45 * lit) * flashes;
          if (weight < 0.02) continue;
          ctx.globalAlpha = base * weight;
          ctx.beginPath(); crystalFacet(ctx, (((first + index) % 8) + 8) % 8); ctx.fill();
        }
      }
      ctx.globalAlpha = base;
    }
    // The table: a glyph sits in a deep well at every size (its light ink
    // would sink into the bright gem otherwise; a wider one, to hold the
    // glyph); a plain gem shows its table from T1 up.
    if (n.glyph) {
      ctx.beginPath(); crystalOutline(ctx, 0.56);
      ctx.fillStyle = paints.well; ctx.fill();
    } else if (shown > 0) {
      ctx.globalAlpha = base * (0.8 + 0.2 * lit) * shown;
      ctx.beginPath(); crystalOutline(ctx, 0.52);
      ctx.fillStyle = paints.table; ctx.fill();
      ctx.globalAlpha = base;
    }
    // The cut's edges (T3, on a lit gem or one of 12 px and up): spokes from
    // the rim to the table, and the table.
    const edges = n.detail >= 3 ? tierIn(radius, 3) * Math.max(lit, clamp01(radius - 11)) : 0;
    if (edges > 0.01) {
      ctx.globalAlpha = base * edges;
      ctx.beginPath();
      for (let k = 0; k < 8; k += 1) {
        const x = CRYSTAL_GEM[2 * k], y = CRYSTAL_GEM[2 * k + 1];
        ctx.moveTo(x, y); ctx.lineTo(x * 0.52, y * 0.52);
      }
      crystalOutline(ctx, 0.52);
      ctx.strokeStyle = rgba(paints.hot, 0.3); ctx.lineWidth = 0.7 / radius; ctx.stroke();
      ctx.globalAlpha = base;
    }
    // The sparkle where the light strikes (T2 up): the first 14% of each
    // 3.4 s pass (1.3 s working).
    if (flashes > 0) {
      let envelope = 0.6;
      if (!m.still) { const u = cycle(m, 3.4) / 0.14; envelope = u < 1 ? Math.sin(Math.PI * u) : 0; }
      if (envelope > 0.02) {
        const x = -0.64, y = -0.64 * tilt, arm = 0.34 * envelope, waist = arm * 0.2;
        ctx.globalAlpha = base * flashes;
        ctx.beginPath();
        ctx.moveTo(x, y - arm); ctx.lineTo(x + waist, y - waist); ctx.lineTo(x + arm, y); ctx.lineTo(x + waist, y + waist);
        ctx.lineTo(x, y + arm); ctx.lineTo(x - waist, y + waist); ctx.lineTo(x - arm, y); ctx.lineTo(x - waist, y - waist); ctx.closePath();
        ctx.fillStyle = paints.spark; ctx.fill();
        ctx.globalAlpha = base;
      }
    }
    if (n.monogram) { freeLeave(ctx, p, radius); freeMonogram(ctx, p, n, freeInks(tint, n.theme).crystal); }
  }
  LOOKS.crystal = { speedup: 2.6, paint: paintCrystal, glyph: { scale: 0.56, ringGap: 3.5, ink: (tint, currentTheme) => freeInks(tint, currentTheme).crystal }, ring: null, hubDress: null, orbit: null, arrival: null, select: null, wire: null, surge: null, land: null, reach: 1 };

// ===== style: singularity =====

  // A near-black core behind a thin photon ring, inside an accretion disc
  // whose brightness turns with the angle, over a faint outer glow. Every
  // gradient (the conic disc included) is a unit-space paint cached per
  // context, tint, lit level and theme.
  function singularityGradients(ctx, tint, lit, currentTheme) {
    const key = `singularity|${tint.join(",")}|${lit}|${currentTheme.key}`;
    let paints = cacheGet(ctx, key);
    if (paints) return paints;
    const tones = voidTones(tint, currentTheme.accent2);
    const { hot, deep, shade, accent } = tones;
    const glow = ctx.createRadialGradient(0, 0, 0.5, 0, 0, lit ? 1.72 : 1.45);
    glow.addColorStop(0, rgba(tint, lit ? 0.46 : 0.3));
    glow.addColorStop(0.3, rgba(tint, lit ? 0.16 : 0.09));
    glow.addColorStop(1, rgba(tint, 0));
    // The accretion disc, brightest on its approaching (lower-left) side and
    // dimmest opposite, where a trace of the theme's second hue shows...
    const disc = typeof ctx.createConicGradient === "function" ? ctx.createConicGradient(Math.PI * 0.72, 0, 0) : ctx.createRadialGradient(-0.35, 0.35, 0, 0, 0, 1);
    disc.addColorStop(0, rgba(hot, 1));
    disc.addColorStop(0.14, rgba(tint, lit ? 1 : 0.94));
    disc.addColorStop(0.34, rgba(tint, lit ? 0.56 : 0.42));
    disc.addColorStop(0.5, rgba(accent, lit ? 0.3 : 0.2));
    disc.addColorStop(0.66, rgba(tint, lit ? 0.56 : 0.42));
    disc.addColorStop(0.86, rgba(tint, lit ? 1 : 0.94));
    disc.addColorStop(1, rgba(hot, 1));
    // ...and hottest at its inner edge, cooling into the glow outside.
    const fade = ctx.createRadialGradient(0, 0, 0.66, 0, 0, 0.97);
    fade.addColorStop(0, rgba(deep, 0));
    fade.addColorStop(1, rgba(deep, lit ? 0.5 : 0.62));
    // The horizon: black at the centre, warming to a deep tint just inside
    // the photon ring (a soft inner edge), then a thin black gap before the
    // disc begins.
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.68);
    core.addColorStop(0, "rgba(2,1,5,1)");
    core.addColorStop(0.62, "rgba(2,1,5,1)");
    core.addColorStop(0.87, rgba(shade, 1));
    core.addColorStop(0.92, "rgba(2,1,5,1)");
    core.addColorStop(1, "rgba(2,1,5,1)");
    return cachePut(ctx, key, { ...tones, glow, disc, fade, core });
  }
  function paintSingularity(ctx, p, radius, tint, o) {
    const { active, selected } = o;
    const lit = active || selected;
    const paints = singularityGradients(ctx, tint, lit, o.theme);
    const { glow, disc, fade, core, hot, deep } = paints;
    ctx.save(); ctx.translate(p.x, p.y); ctx.scale(radius, radius);
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, lit ? 1.72 : 1.45, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, 0.96, 0, Math.PI * 2);
    ctx.fillStyle = rgba(deep, 1); ctx.fill();
    ctx.fillStyle = disc; ctx.fill();
    ctx.fillStyle = fade; ctx.fill();
    ctx.fillStyle = core; ctx.beginPath(); ctx.arc(0, 0, 0.68, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.beginPath(); ctx.arc(p.x, p.y, radius * 0.6, 0, Math.PI * 2);
    ctx.strokeStyle = rgba(hot, lit ? 1 : 0.86); ctx.lineWidth = Math.max(0.7, radius * (lit ? 0.085 : 0.065)); ctx.stroke();
    if (selected) { ctx.beginPath(); ctx.arc(p.x, p.y, radius * 1.16, 0, Math.PI * 2); ctx.strokeStyle = rgba(hot, 0.9); ctx.lineWidth = 1.4; ctx.stroke(); }
    voidMonogram(ctx, p, o, paints.ink);
  }
  LOOKS.singularity = { speedup: 4, paint: paintSingularity, glyph: { scale: 0.56, ringGap: 3.5, ink: lightInk }, ring: null, hubDress: null, orbit: null, arrival: null, select: null, wire: null, surge: null, land: null, reach: 1 };

// ===== style: prism =====

  // A kite-cut gem lit from the upper left: the crown in the whitened tint,
  // the pavilion's left plane in the tint and its right in shadow, a crisp
  // rim, the light that refracts out along the lower right edge in the
  // theme's second hue and one specular glint. A small gem keeps two planes,
  // a tiny one a single plane; a glyph sits on a dark table in a light ink.
  function prismPaints(ctx, tint, lit, currentTheme) {
    const key = `prism|${tint.join(",")}|${lit}|${currentTheme.key}`;
    let paints = cacheGet(ctx, key);
    if (paints) return paints;
    let glow = null;
    if (lit) {
      // The gem glows only while it works or is chosen.
      glow = ctx.createRadialGradient(0, 0, 0.55, 0, 0, 1.6);
      glow.addColorStop(0, rgba(tint, 0.3));
      glow.addColorStop(1, rgba(tint, 0));
    }
    return cachePut(ctx, key, { ...voidTones(tint, currentTheme.accent2), glow });
  }
  function paintPrism(ctx, p, radius, tint, o) {
    const { active, selected, glyph } = o;
    const lit = active || selected;
    const paints = prismPaints(ctx, tint, lit, o.theme);
    const { glow, hot, deep, shade, accent } = paints;
    const facets = SHAPES.prismFacets(radius);
    ctx.save(); ctx.translate(p.x, p.y); ctx.scale(radius, radius);
    if (glow) { ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, 1.6, 0, Math.PI * 2); ctx.fill(); }
    ctx.beginPath(); SHAPES.trace(ctx, SHAPES.prismRim);
    ctx.fillStyle = rgba(deep, 1); ctx.fill();
    for (let facet = 0; facet < facets; facet += 1) {
      const tone = facets === 1 ? 1 : facet; // 0 light, 1 mid, 2 shadow
      ctx.beginPath(); SHAPES.prismFacet(ctx, facets, facet);
      ctx.fillStyle = tone === 0 ? rgba(hot, lit ? 0.96 : 0.86) : tone === 1 ? rgba(tint, lit ? 0.86 : 0.7) : rgba(shade, 1);
      ctx.fill();
    }
    ctx.restore();
    if (glyph) {
      ctx.beginPath(); SHAPES.prismTable(ctx, p.x, p.y, radius);
      ctx.fillStyle = rgba(deep, 0.94); ctx.fill();
      ctx.strokeStyle = rgba(hot, 0.5); ctx.lineWidth = 0.8; ctx.stroke();
    }
    ctx.beginPath(); SHAPES.trace(ctx, SHAPES.prismRim, p.x, p.y, radius);
    ctx.strokeStyle = selected ? rgba(hot, 1) : rgba(tint, active ? 0.95 : 0.72); ctx.lineWidth = selected ? 1.6 : active ? 1.2 : 0.85; ctx.stroke();
    if (facets === 3) {
      ctx.beginPath(); SHAPES.prismEdge(ctx, p.x, p.y, radius);
      ctx.strokeStyle = rgba(accent, lit ? 1 : 0.86); ctx.lineWidth = Math.max(0.8, radius * 0.075); ctx.stroke();
      if (radius >= 8 && !glyph) {
        ctx.beginPath(); SHAPES.prismGlint(ctx, p.x, p.y, radius);
        ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.fill();
      }
    }
    voidMonogram(ctx, p, o, paints.ink);
  }
  LOOKS.prism = { speedup: 2.5, paint: paintPrism, glyph: { scale: 0.56, ringGap: 3.5, ink: lightInk }, ring: null, hubDress: null, orbit: null, arrival: null, select: null, wire: null, surge: null, land: null, reach: 1 };

// ===== style: sigil =====

  // A calm double ring (the outer crisp, the inner faint) with a few small
  // diamonds in the theme's second hue between them and a seal at the centre;
  // a node that wears a glyph shows its glyph instead of the seal.
  function sigilPaints(ctx, tint, lit, currentTheme) {
    const key = `sigil|${tint.join(",")}|${lit}|${currentTheme.key}`;
    let paints = cacheGet(ctx, key);
    if (paints) return paints;
    let glow = null;
    if (lit) {
      // The seal glows only while it works or is chosen.
      glow = ctx.createRadialGradient(0, 0, 0.55, 0, 0, 1.6);
      glow.addColorStop(0, rgba(tint, 0.3));
      glow.addColorStop(1, rgba(tint, 0));
    }
    // A faint well of the node's hue inside the seal, for depth.
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.92);
    core.addColorStop(0, rgba(tint, lit ? 0.22 : 0.15));
    core.addColorStop(1, rgba(tint, 0));
    return cachePut(ctx, key, { ...voidTones(tint, currentTheme.accent2), glow, core });
  }
  function paintSigil(ctx, p, radius, tint, o) {
    const { active, selected, glyph } = o;
    const lit = active || selected;
    const paints = sigilPaints(ctx, tint, lit, o.theme);
    const { glow, core, deep, accent } = paints;
    ctx.save(); ctx.translate(p.x, p.y); ctx.scale(radius, radius);
    if (glow) { ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, 1.6, 0, Math.PI * 2); ctx.fill(); }
    ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fillStyle = rgba(deep, 0.92); ctx.fill();
    ctx.fillStyle = core; ctx.fill();
    ctx.restore();
    ctx.beginPath(); ctx.arc(p.x, p.y, radius * 0.9, 0, Math.PI * 2);
    ctx.strokeStyle = rgba(tint, lit ? 1 : 0.8); ctx.lineWidth = selected ? 2 : lit ? 1.5 : 1.1; ctx.stroke();
    if (radius >= 6) {
      ctx.beginPath(); ctx.arc(p.x, p.y, radius * 0.56, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(tint, lit ? 0.5 : 0.36); ctx.lineWidth = 0.8; ctx.stroke();
      ctx.beginPath(); SHAPES.sigilMarks(ctx, p.x, p.y, radius); ctx.fillStyle = rgba(accent, lit ? 1 : 0.88); ctx.fill();
    }
    if (!glyph) {
      ctx.beginPath(); SHAPES.sigilSeal(ctx, p.x, p.y, radius);
      ctx.fillStyle = rgba(tint, lit ? 1 : 0.9); ctx.fill();
    }
    voidMonogram(ctx, p, o, paints.ink);
  }
  LOOKS.sigil = { speedup: 3, paint: paintSigil, glyph: { scale: 0.56, ringGap: 3.5, ink: lightInk }, ring: null, hubDress: null, orbit: null, arrival: null, select: null, wire: null, surge: null, land: null, reach: 1 };

// ===== overlays =====

  // Every overlay dispatcher: the style's hook draws and the caller skips its
  // own legacy drawing (true), or the style has none, or its hook returned
  // false, and the caller draws as before. `o` travels to the hook as given,
  // and the style's name follows as the hook's last argument.

  // The hooks every look shares when it leaves its own null: the free
  // styles' agent status ring, hub dress, work orbit and arrival ring. Each
  // reads the node's motion record (the still pose from its flags without
  // one), draws in screen space inside its own save and builds nothing: no
  // gradient, no shadow, no array or object per call. Selection needs no
  // mark of its own: the free styles show it through their rim (Minimal
  // rings its own dot), so `select` stays null and answers false.
  const OVERLAY_DEFAULTS = { ring: overlayRing, hubDress: overlayHubDress, orbit: overlayOrbit, arrival: overlayArrival, select: null };

  const OVERLAY_NO_DASH = Object.freeze([]);
  const QUEUED_DASH = Object.freeze([2, 3]); // 5 px period: the march wraps there
  const CREW_DASH = Object.freeze([2, 5]);
  const ORBIT_TRAIL = Object.freeze([0.8, 0.56, 0.32]); // head first
  const STATUS_POP_MS = 320; // a new status's badge and ring pop in over this
  const STATUS_FLASH_MS = 620; // the one-shot ring a finish or a failure sends out
  // The running comet, tail to head: segment bounds (× π), alphas, widths.
  const RING_COMET = Object.freeze([0, 0.45, 0.9, 1.3]);
  const RING_COMET_ALPHA = Object.freeze([0.24, 0.52, 0.9]);
  // On a light theme the faint tail would sink into the pale background:
  // the tail segments sit higher there, the head the same.
  const RING_COMET_ALPHA_LIGHT = Object.freeze([0.34, 0.62, 0.9]);
  const RING_COMET_WIDTH = Object.freeze([1, 1.15, 1.35]);
  const RING_HEAD = 0.9, RING_HEAD_WIDTH = 1.3; // the plain arc, and the head segment's alpha

  // The state colours as marks on the theme: the done green and the amber
  // themselves on a dark theme; on a light one they sink toward the
  // highlight (the rings a little, the error "!" more) so they still read
  // against a pale background and a pale well. Cached per theme.
  const stateInks = new WeakMap();
  function overlayInks(currentTheme) {
    let inks = stateInks.get(currentTheme);
    if (!inks) {
      const { light, amber, done, hi } = currentTheme;
      inks = Object.freeze({
        amber: light ? Object.freeze(mix(amber, hi, 0.35)) : amber,
        done: light ? Object.freeze(mix(done, hi, 0.35)) : done,
        mark: light ? Object.freeze(mix(amber, hi, 0.55)) : amber,
      });
      stateInks.set(currentTheme, inks);
    }
    return inks;
  }
  const overlayStateInk = (currentTheme, done) => done ? overlayInks(currentTheme).done : overlayInks(currentTheme).amber;
  // A node's own hue as a thin mark: itself on a dark theme; on a light one
  // nearly half way toward the highlight, so a pastel role colour still
  // reads as a 1 px ring (and a comet's tail) on a pale background. Cached
  // per tint and theme.
  const tintInks = new WeakMap();
  function overlayTintInk(tint, currentTheme) {
    if (!currentTheme.light) return tint;
    let record = tintInks.get(tint);
    if (!record || record.key !== currentTheme.key) {
      record = { key: currentTheme.key, ink: Object.freeze(mix(tint, currentTheme.hi, 0.45)) };
      tintInks.set(tint, record);
    }
    return record.ink;
  }

  // Reduced motion: the caller says so, or the node's record was stepped
  // under it. A bare caller without a record is still only when it says so
  // (the still pose then only fills in its levels; its phases run on o.time).
  const overlayStill = (o, m) => o.still === true || o.motion != null && m.still === true;

  // How far a status change has come in, 0 → 1 over STATUS_POP_MS (1 when
  // still, without a record, or for the status a node was first seen with).
  function overlayPop(o, m, still) {
    if (still || !o.motion || !Number.isFinite(o.time)) return 1;
    return clamp01((o.time - m.statusAt) / STATUS_POP_MS);
  }

  // A status badge off the node's upper right: an amber "!" or a done tick
  // on the theme's well. It pops in with a little overshoot (easeOutBack)
  // and keeps the legacy geometry (radius 5, 8 px mark) at radius ≥ 10,
  // shrinking with smaller nodes so a badge never outgrows its node.
  function overlayBadge(ctx, p, radius, pop, currentTheme, done) {
    const grow = easeOutBack(pop);
    if (grow <= 0.02) return;
    const size = radius >= 10 ? 1 : Math.max(0.64, radius / 10);
    ctx.save();
    ctx.translate(p.x + radius + 3, p.y - radius - 3); ctx.scale(grow * size, grow * size);
    ctx.beginPath(); ctx.arc(0, 0, 5, 0, TAU);
    ctx.fillStyle = rgba(done ? currentTheme.doneWell : currentTheme.amberWell, 1); ctx.fill();
    ctx.strokeStyle = rgba(overlayStateInk(currentTheme, done), done ? 0.85 : 0.9); ctx.lineWidth = 1; ctx.stroke();
    if (done) {
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.strokeStyle = rgba(currentTheme.doneInk, 1); ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(-2.6, 0); ctx.lineTo(-0.8, 1.9); ctx.lineTo(2.6, -2); ctx.stroke();
    } else {
      ctx.fillStyle = rgba(overlayInks(currentTheme).mark, 1);
      ctx.font = '700 8px system-ui, "Segoe UI", sans-serif'; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("!", 0, 0.5);
    }
    ctx.restore();
  }

  // The agent status ring in the node's own hue. Running: a comet sweeps at
  // the legacy speed (time/380) in the node's own phase, brightening toward
  // a bright head bead, its strength eased by the work level, so a run fades
  // in and out instead of blinking. Queued: a dashed ring whose dashes
  // march. Error: an amber ring that pulses (1.3 s: stronger, wider and a
  // little further out on the beat) with an "!" badge. Done:
  // a tick badge. A new status pops its badge in, fades its ring in, and a
  // finish or failure sends one soft ring out. Every eased level is a
  // globalAlpha gain over literal (or 32nds) colour alphas. Reduced motion:
  // every mark at rest, full strength.
  function overlayRing(ctx, p, radius, tint, o) {
    const m = motionOf(o);
    const still = overlayStill(o, m);
    const status = o.status ?? null;
    const running = status === "running" || o.builder === true;
    const ring = Number.isFinite(o.ring) ? o.ring : radius + 3.5;
    const detail = Number.isFinite(o.detail) ? o.detail : 3;
    const time = Number.isFinite(o.time) ? o.time : 0;
    const currentTheme = o.theme ?? INK_DEFAULTS;
    // Each node's marks run in its own phase, so a crew never moves in step.
    const offset = o.motion ? m.seed || 0 : 0;
    // The arc's strength follows the eased work level; the flags decide it
    // when there is no record or nothing may ease.
    const level = o.motion && !still ? m.work : running ? 1 : 0;
    const pop = overlayPop(o, m, still);
    ctx.save();
    const base = ctx.globalAlpha;
    if (level > 0.01) {
      // A comet 1.3π long sweeping at the legacy speed: three segments that
      // brighten toward a bright head bead. On the smallest tier one plain
      // arc (the extras would only smudge); the taper and the bead come in
      // with the tier's fade-in, so a zoom never snaps them.
      const phase = still ? 0 : time / 380 + offset * TAU;
      const hue = overlayTintInk(tint, currentTheme);
      ctx.globalAlpha = base * level;
      if (detail >= 1) {
        const taper = tierIn(radius, 1);
        const alphas = currentTheme.light ? RING_COMET_ALPHA_LIGHT : RING_COMET_ALPHA;
        for (let segment = 0; segment < 3; segment += 1) {
          ctx.beginPath(); ctx.arc(p.x, p.y, ring, phase + RING_COMET[segment] * Math.PI, phase + RING_COMET[segment + 1] * Math.PI);
          // Its alpha from the plain arc's to its own (in 32nds between).
          const alpha = alphas[segment];
          ctx.strokeStyle = rgba(hue, alpha === RING_HEAD || taper >= 1 ? alpha : taper <= 0 ? RING_HEAD : qa(RING_HEAD + (alpha - RING_HEAD) * taper));
          ctx.lineWidth = RING_HEAD_WIDTH + (RING_COMET_WIDTH[segment] - RING_HEAD_WIDTH) * taper; ctx.stroke();
        }
        const extra = level * taper;
        if (extra > 0.02) {
          const head = phase + Math.PI * 1.3;
          ctx.globalAlpha = base * extra;
          ctx.beginPath(); ctx.arc(p.x + Math.cos(head) * ring, p.y + Math.sin(head) * ring, 1.45, 0, TAU);
          ctx.fillStyle = rgba(inkOf(tint, currentTheme).hot, 0.95); ctx.fill();
        }
      } else {
        ctx.beginPath(); ctx.arc(p.x, p.y, ring, phase, phase + Math.PI * 1.3);
        ctx.strokeStyle = rgba(hue, RING_HEAD); ctx.lineWidth = RING_HEAD_WIDTH; ctx.stroke();
      }
      ctx.globalAlpha = base;
    }
    if (status === "queued") {
      if (ctx.setLineDash) { ctx.setLineDash(QUEUED_DASH); ctx.lineDashOffset = still ? 0 : -((time / 120 + offset * 5) % 5); }
      ctx.globalAlpha = base * pop;
      ctx.beginPath(); ctx.arc(p.x, p.y, ring, 0, TAU);
      ctx.strokeStyle = rgba(overlayTintInk(tint, currentTheme), 0.5); ctx.lineWidth = 1; ctx.stroke();
      if (ctx.setLineDash) { ctx.setLineDash(OVERLAY_NO_DASH); ctx.lineDashOffset = 0; }
    } else if (status === "error" || status === "done") {
      const done = status === "done";
      const hue = overlayStateInk(currentTheme, done);
      if (!done) {
        // The ring swells on the beat in strength, width and size; at rest
        // it sits near the legacy .85 and 1.4 px (a bare caller pulses on
        // o.time).
        const beat = still ? 0.71 : o.motion ? swell(m, 1.3, 0.71) : 0.5 + 0.5 * Math.sin(TAU * time / 1300);
        ctx.globalAlpha = base * pop;
        ctx.beginPath(); ctx.arc(p.x, p.y, ring + 0.6 * beat, 0, TAU);
        ctx.strokeStyle = rgba(hue, qa(0.6 + 0.35 * beat)); ctx.lineWidth = 1.2 + 0.5 * beat; ctx.stroke();
      }
      // The news: one soft ring out from the status ring as the status turns.
      const since = o.motion && !still ? time - m.statusAt : Infinity;
      if (since >= 0 && since < STATUS_FLASH_MS && detail >= 1) {
        const u = since / STATUS_FLASH_MS;
        ctx.globalAlpha = base * (1 - u);
        ctx.beginPath(); ctx.arc(p.x, p.y, ring + 7 * easeOut(u), 0, TAU);
        ctx.strokeStyle = rgba(hue, 0.55); ctx.lineWidth = 1.2; ctx.stroke();
      }
      ctx.globalAlpha = base;
      overlayBadge(ctx, p, radius, pop, currentTheme, done);
    }
    ctx.restore();
  }

  // The hub's dress: a ring that breathes on a 6 s cycle in the hub's own
  // phase (faster while it works, like every clock), and, while agents are
  // out, the faint dashed ring the crew rests on, drifting slowly round (a
  // T1 extra: it fades in over that tier's first pixels).
  function overlayHubDress(ctx, p, radius, tint, o) {
    const m = motionOf(o);
    const still = overlayStill(o, m);
    // Without a record, the caller's own breath and clock.
    const breathe = still ? 0.5 : o.motion ? swell(m, 6) : Number.isFinite(o.breathe) ? o.breathe : 0.5;
    const clock = o.motion ? m.clock : (Number.isFinite(o.time) ? o.time : 0) / 1000;
    const hue = overlayTintInk(tint, o.theme ?? INK_DEFAULTS);
    ctx.save();
    ctx.beginPath(); ctx.arc(p.x, p.y, radius + 5 + breathe * 2.5, 0, TAU);
    ctx.strokeStyle = rgba(hue, qa(0.18 + breathe * 0.14)); ctx.lineWidth = 1 + breathe * 0.3; ctx.stroke();
    const crewIn = o.crew === true && (Number.isFinite(o.detail) ? o.detail : 3) >= 1 ? tierIn(radius, 1) : 0;
    if (crewIn > 0) {
      if (crewIn < 1) ctx.globalAlpha *= crewIn;
      if (ctx.setLineDash) { ctx.setLineDash(CREW_DASH); ctx.lineDashOffset = still ? 0 : -((clock * 2.2) % 7); }
      ctx.beginPath(); ctx.arc(p.x, p.y, radius * 3.1, 0, TAU);
      ctx.strokeStyle = rgba(hue, 0.1); ctx.lineWidth = 0.8; ctx.stroke();
      if (ctx.setLineDash) { ctx.setLineDash(OVERLAY_NO_DASH); ctx.lineDashOffset = 0; }
    }
    ctx.restore();
  }

  // The work orbit round a Running or Next node: a faint track and a comet
  // of three segments in the theme's orbit hue (its second hue, or a blue
  // that reads on its background), running on the record's integrated
  // phase so a node that starts or stops working never jumps. Four arcs,
  // three segments, at o.ring (r + 9). A Running orbit comes in with the
  // eased work level (from .3, so it never hides); a Next one waits at .65.
  // `o.run` (0..1, optional) is how far the orbit is a Running one: the
  // idle caller eases it over a Running <-> Next change, so the strength
  // glides between the two instead of stepping.
  function overlayOrbit(ctx, p, radius, _tint, o) {
    const m = motionOf(o);
    const still = overlayStill(o, m);
    const legacy = Number.isFinite(o.phase) ? o.phase : Math.PI / 3;
    const phase = still ? legacy : o.motion && Number.isFinite(m.orbit) ? m.orbit : legacy;
    const ring = Number.isFinite(o.ring) ? o.ring : radius + 9;
    const hue = (o.theme ?? INK_DEFAULTS).orbit;
    const run = Number.isFinite(o.run) ? clamp01(o.run) : o.running === true ? 1 : 0;
    const working = !still && o.motion ? 0.3 + 0.7 * clamp01(m.work) : 1;
    ctx.save();
    if (run < 1) ctx.globalAlpha *= run <= 0 ? 0.65 : 0.65 + (working - 0.65) * run;
    else if (working < 1) ctx.globalAlpha *= working;
    ctx.lineCap = "round";
    ctx.strokeStyle = rgba(hue, 0.22); ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.arc(p.x, p.y, ring, 0, TAU); ctx.stroke();
    for (let segment = 2; segment >= 0; segment -= 1) {
      ctx.strokeStyle = rgba(hue, ORBIT_TRAIL[segment]); ctx.lineWidth = 2.6 - segment * 0.6;
      ctx.beginPath(); ctx.arc(p.x, p.y, ring, phase - (segment + 1) * 0.62, phase - segment * 0.62); ctx.stroke();
    }
    ctx.restore();
  }

  // A node growing in (t01 0 → 1 over its grow): a bright ring leaves its rim
  // like a shock front, a full radius out on an ease-out, thinning and
  // fading on the clock (not on its eased position, so it stays in sight
  // for the whole grow), with a fainter echo in the node's hue a beat
  // behind. The node itself overshoots as it grows, so the rings stay inside
  // 2.25 of its radius. Reduced motion: the node simply appears.
  function overlayArrival(ctx, p, radius, tint, t01, o) {
    const m = motionOf(o);
    if (overlayStill(o, m) || !(t01 < 1)) return true;
    const base = Number.isFinite(o.alpha) ? o.alpha : 1;
    const e = easeOut(t01);
    ctx.save();
    ctx.strokeStyle = rgba(inkOf(tint, o.theme ?? INK_DEFAULTS).hot, 1);
    ctx.globalAlpha = base * 0.7 * (1 - t01) ** 1.4; ctx.lineWidth = 1.6 - 0.8 * t01;
    ctx.beginPath(); ctx.arc(p.x, p.y, radius * (1 + e), 0, TAU); ctx.stroke();
    const echo = (t01 - 0.22) / 0.78;
    if (echo > 0 && (Number.isFinite(o.detail) ? o.detail : 3) >= 1) {
      const e2 = easeOut(echo);
      ctx.strokeStyle = rgba(tint, 1);
      ctx.globalAlpha = base * 0.4 * (1 - echo) ** 1.4; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, radius * (1 + 0.6 * e2), 0, TAU); ctx.stroke();
    }
    ctx.restore();
    return true;
  }

  // Normalised paint options, one scratch reused by every call.
  const NORMAL = { kind: "task", selected: false, chosen: false, active: false, alpha: 1, glyph: false, monogram: false, motion: null, time: 0, still: false, detail: 3, extraGlow: false, theme: INK_DEFAULTS };
  function normalise(o, radius) {
    const n = NORMAL;
    n.kind = typeof o.kind === "string" ? o.kind : "task";
    n.selected = o.selected === true;
    n.chosen = o.chosen === true;
    n.active = o.active === true;
    n.alpha = Number.isFinite(o.alpha) ? o.alpha : 1;
    n.monogram = typeof o.monogram === "boolean" ? o.monogram : n.kind === "assistant" || n.kind === "music";
    n.glyph = typeof o.glyph === "boolean" ? o.glyph : n.monogram || n.kind === "agent" && radius >= 4.5;
    n.motion = o.motion ?? null;
    n.time = Number.isFinite(o.time) ? o.time : 0;
    n.still = o.still === true;
    n.detail = Number.isFinite(o.detail) ? o.detail : 3;
    n.extraGlow = o.extraGlow === true;
    n.theme = o.theme ?? INK_DEFAULTS;
    return n;
  }

  // One node's surface, in the style's look (orbs for an unknown style). The
  // caller's alpha is its fade times its emphasis; the context comes back as
  // it was handed over.
  function paint(ctx, style, p, radius, tint, o = EMPTY) {
    const n = normalise(o ?? EMPTY, radius);
    const m = n.motion ?? poseOf(n);
    ctx.save();
    ctx.globalAlpha = n.alpha;
    // The glow follows the eased lit level (a bare motion object without one
    // falls back to the flags).
    if (n.extraGlow) extraGlow(ctx, p, radius, tint, Number.isFinite(m.lit) ? m.lit : n.active || n.selected ? 1 : 0);
    (lookOf(style) ?? LOOKS.orbs).paint(ctx, p, radius, tint, n, m);
    ctx.restore();
  }

  // The style's glyph dress for an agent's role glyph or the hub's monogram:
  // { ink, scale, ringGap } in one shared scratch (read it at once), or null
  // for the orb's own ink at 0.7 of the radius.
  const GLYPH = { ink: null, scale: 0.7, ringGap: 3.5 };
  function glyph(style, tint, currentTheme) {
    const look = lookOf(style)?.glyph;
    if (!look) return null;
    GLYPH.ink = typeof look.ink === "function" ? look.ink(tint, currentTheme ?? INK_DEFAULTS) : look.ink ?? null;
    GLYPH.scale = Number.isFinite(look.scale) ? look.scale : 0.7;
    GLYPH.ringGap = Number.isFinite(look.ringGap) ? look.ringGap : 3.5;
    return GLYPH;
  }

  // The agent status ring (running, queued, error, done, badges included).
  function ring(ctx, style, p, radius, tint, o) {
    const hook = hookOf(style, "ring", OVERLAY_DEFAULTS);
    return hook !== null && hook(ctx, p, radius, tint, o ?? EMPTY, style) !== false;
  }
  // The hub's own dress around the assistant node.
  function hubDress(ctx, style, p, radius, tint, o) {
    const hook = hookOf(style, "hubDress", OVERLAY_DEFAULTS);
    return hook !== null && hook(ctx, p, radius, tint, o ?? EMPTY, style) !== false;
  }
  // The work orbit around a Running or Next node.
  function orbit(ctx, style, p, radius, tint, o) {
    const hook = hookOf(style, "orbit", OVERLAY_DEFAULTS);
    return hook !== null && hook(ctx, p, radius, tint, o ?? EMPTY, style) !== false;
  }
  // A node arriving (t01 runs 0 → 1 over its grow).
  function arrival(ctx, style, p, radius, tint, t01, o) {
    const hook = hookOf(style, "arrival", OVERLAY_DEFAULTS);
    return hook !== null && hook(ctx, p, radius, tint, t01, o ?? EMPTY, style) !== false;
  }
  // The selection mark over a selected, hovered or chosen node.
  function select(ctx, style, p, radius, tint, o) {
    const hook = hookOf(style, "select", OVERLAY_DEFAULTS);
    return hook !== null && hook(ctx, p, radius, tint, o ?? EMPTY, style) !== false;
  }
  // How far past its radius a style draws (a multiple of the radius), so labels
  // can clear it; 1 for a style that stays on its disc.
  function reach(style, m) {
    const value = lookOf(style)?.reach;
    if (typeof value === "function") {
      const answer = value(m ?? POSE);
      return Number.isFinite(answer) ? answer : 1;
    }
    return Number.isFinite(value) ? value : 1;
  }

// ===== wires =====

  // The wire hooks every look shares when it leaves its own null (the free
  // styles' wires, say); none yet, so each caller keeps its plain lines.
  const WIRE_DEFAULTS = { wire: null, surge: null, land: null };
  // One connection between two painted points (a and b are {x, y}).
  function wire(ctx, style, a, b, o) {
    const hook = hookOf(style, "wire", WIRE_DEFAULTS);
    return hook !== null && hook(ctx, a, b, o ?? EMPTY, style) !== false;
  }
  // A travelling pulse at t (0..1) from `from` to `to`.
  function surge(ctx, style, from, to, t, pulse, o) {
    const hook = hookOf(style, "surge", WIRE_DEFAULTS);
    return hook !== null && hook(ctx, from, to, t, pulse, o ?? EMPTY, style) !== false;
  }
  // A pulse landing on its node (u runs 0 → 1 over the landing).
  function land(ctx, style, p, radius, tint, u, o) {
    const hook = hookOf(style, "land", WIRE_DEFAULTS);
    return hook !== null && hook(ctx, p, radius, tint, u, o ?? EMPTY, style) !== false;
  }

// ===== export =====

  for (const style of STYLES) Object.freeze(LOOKS[style]);
  Object.freeze(LOOKS);
  Object.freeze(OVERLAY_DEFAULTS);
  Object.freeze(WIRE_DEFAULTS);
  // Infra helpers the style sections share; named here so the ones no look
  // uses yet keep the linter quiet.
  void [cycle, swell, turn, qa, tierIn, motionOf, easeOut, easeOutBack, smooth01, polyPath, ellipseAt];
  window.MefiNodeStyles = Object.freeze({
    version: 1, STYLES, PREMIUM, shapes: SHAPES,
    seed, hash, approach, motionRecord, stepMotion, shownTint, theme, inkOf, tier,
    paint, glyph, ring, hubDress, orbit, arrival, select,
    wire, surge, land, reach, cacheStats,
  });
})();
