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

  // A luminous orb with an opaque centre: a restrained halo, one clear rim, a
  // small highlight, the hub's monogram. The halo and body are unit-space
  // paints cached per context and tint.
  function orbPaints(ctx, tint, active, selected) {
    const key = `orbs|${tint.join(",")}|${active}|${selected}`;
    let paints = cacheGet(ctx, key);
    if (paints) return paints;
    const halo = ctx.createRadialGradient(0, 0, 0.45, 0, 0, active || selected ? 1.9 : 1.45);
    halo.addColorStop(0, rgba(tint, active ? 0.22 : 0.1));
    halo.addColorStop(1, rgba(tint, 0));
    const body = ctx.createRadialGradient(-0.25, -0.3, 0, 0, 0, 1);
    body.addColorStop(0, rgba(tint, 0.95));
    body.addColorStop(0.42, rgba(tint, 0.48));
    body.addColorStop(1, rgba(tint, 0.1));
    return cachePut(ctx, key, { halo, body });
  }
  function paintOrbs(ctx, p, radius, tint, o) {
    const { active, selected } = o;
    const glowRadius = radius * (active || selected ? 1.9 : 1.45);
    const { halo, body } = orbPaints(ctx, tint, active, selected);
    // One transform block for both unit-space paints: the halo disc at its
    // glow radius, then the opaque core and the body over it. The circles are
    // traced in that same unit space (the transform maps them onto the exact
    // screen circles); the rim strokes in screen space.
    ctx.save(); ctx.translate(p.x, p.y); ctx.scale(radius, radius);
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(0, 0, glowRadius / radius, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fillStyle = "#151a22"; ctx.fill();
    ctx.fillStyle = body; ctx.fill();
    ctx.restore();
    ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = rgba(tint, selected ? 1 : active ? 0.85 : 0.55);
    ctx.lineWidth = selected ? 1.8 : active ? 1.3 : 0.8; ctx.stroke();
    if (!o.monogram) {
      ctx.fillStyle = "rgba(242,249,255,0.62)"; ctx.beginPath(); ctx.arc(p.x - radius * 0.25, p.y - radius * 0.3, Math.max(1, radius * 0.13), 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.font = '600 10px system-ui, "Segoe UI", sans-serif'; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = "#edf0f5"; ctx.fillText(o.kind === "music" ? "♪" : "M", p.x, p.y + 0.5);
    }
  }
  LOOKS.orbs = { speedup: 2.6, paint: paintOrbs, glyph: null, ring: null, hubDress: null, orbit: null, arrival: null, select: null, wire: null, surge: null, land: null, reach: 1 };

// ===== style: glass =====

  // A dark pane washed with the tint, a crisp rim and one light catch.
  function paintGlass(ctx, p, radius, tint, o) {
    const { active, selected } = o;
    ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = "#172331"; ctx.fill();
    const glass = ctx.createLinearGradient(p.x - radius, p.y - radius, p.x + radius, p.y + radius);
    glass.addColorStop(0, rgba(tint, active || selected ? 0.42 : 0.22)); glass.addColorStop(0.55, "rgba(31,43,59,0.15)"); glass.addColorStop(1, rgba(tint, 0.06));
    ctx.fillStyle = glass; ctx.fill(); ctx.strokeStyle = rgba(tint, selected ? 0.95 : active ? 0.72 : 0.42); ctx.lineWidth = selected ? 1.7 : 1; ctx.stroke();
    ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(2, radius - 3), Math.PI * 1.13, Math.PI * 1.6);
    ctx.strokeStyle = "rgba(231,243,255,0.55)"; ctx.lineWidth = 1; ctx.stroke();
  }
  LOOKS.glass = { speedup: 2.6, paint: paintGlass, glyph: null, ring: null, hubDress: null, orbit: null, arrival: null, select: null, wire: null, surge: null, land: null, reach: 1 };

// ===== style: minimal =====

  // A plain dot, larger while it works, ringed when selected.
  function paintMinimal(ctx, p, radius, tint, o) {
    const { active, selected } = o;
    ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(3, radius * (active ? 0.65 : 0.48)), 0, Math.PI * 2);
    ctx.fillStyle = rgba(tint, selected || active ? 0.95 : 0.6); ctx.fill();
    if (selected) { ctx.strokeStyle = "#eef3fa"; ctx.lineWidth = 1.5; ctx.stroke(); }
  }
  LOOKS.minimal = { speedup: 2.6, paint: paintMinimal, glyph: null, ring: null, hubDress: null, orbit: null, arrival: null, select: null, wire: null, surge: null, land: null, reach: 1 };

// ===== style: halo =====

  // A dark disc inside a glowing ring, a faint inner ring and a bright core.
  function paintHalo(ctx, p, radius, tint, o) {
    const { active, selected } = o;
    ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(10,17,28,0.82)"; ctx.fill();
    ctx.strokeStyle = rgba(tint, active || selected ? 0.95 : 0.68); ctx.lineWidth = active || selected ? 2 : 1.4;
    ctx.shadowColor = rgba(tint, 0.6); ctx.shadowBlur = active || selected ? 12 : 6; ctx.stroke(); ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.arc(p.x, p.y, radius * 0.6, 0, Math.PI * 2); ctx.strokeStyle = rgba(tint, 0.24); ctx.lineWidth = 0.8; ctx.stroke();
    ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1.5, radius * 0.16), 0, Math.PI * 2); ctx.fillStyle = rgba(tint, 0.9); ctx.fill();
  }
  LOOKS.halo = { speedup: 2.6, paint: paintHalo, glyph: null, ring: null, hubDress: null, orbit: null, arrival: null, select: null, wire: null, surge: null, land: null, reach: 1 };

// ===== style: crystal =====

  // A hexagonal gem with a diagonal wash and three facet lines.
  function paintCrystal(ctx, p, radius, tint, o) {
    const { active, selected } = o;
    const points = Array.from({ length: 6 }, (_, index) => ({ x: p.x + Math.cos(index * Math.PI / 3 - Math.PI / 2) * radius, y: p.y + Math.sin(index * Math.PI / 3 - Math.PI / 2) * radius }));
    ctx.beginPath(); points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)); ctx.closePath();
    const gem = ctx.createLinearGradient(p.x - radius, p.y - radius, p.x + radius, p.y + radius);
    gem.addColorStop(0, rgba(tint, 0.8)); gem.addColorStop(0.45, rgba(tint, 0.28)); gem.addColorStop(1, "rgba(12,19,31,0.96)");
    ctx.fillStyle = gem; ctx.fill(); ctx.strokeStyle = rgba(tint, active || selected ? 0.95 : 0.6); ctx.lineWidth = selected ? 1.7 : 1; ctx.stroke();
    ctx.beginPath(); for (const point of points.filter((_, index) => index % 2 === 0)) { ctx.moveTo(p.x, p.y); ctx.lineTo(point.x, point.y); }
    ctx.strokeStyle = rgba(tint, 0.35); ctx.lineWidth = 0.7; ctx.stroke();
  }
  LOOKS.crystal = { speedup: 2.6, paint: paintCrystal, glyph: null, ring: null, hubDress: null, orbit: null, arrival: null, select: null, wire: null, surge: null, land: null, reach: 1 };

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

  // Sigil: a hex seal whose runes write into hex cells that assemble while
  // the node works.
  //
  // The body is a pointy-top hexagon (circumradius .98, so the working cells
  // sit off the vertical axis, clear of the progress meter and the label) in
  // a deep tone of the node's tint, with a tint well and a crisp rim. Inside
  // it a ring of six runes (.60 to .80) turns clockwise, 9 s a turn at rest
  // and three times faster at work, while a head rune strikes bright, one
  // rune every .7 s, and the one before it fades in the theme's second hue;
  // an inner hexagon (.42) counter-turns and a diamond seal breathes at the
  // centre. At work six hex cells slide out of the seal's edges one after
  // another and lock onto them (a honeycomb round the seal), a scan lights one
  // cell after another together with the rune beside it (1.4 s a circuit),
  // and a hexagon sweeps out to 1.52 under the cells. The cells fold back in,
  // last first, as the work eases off, and glide whenever the work stops or
  // starts halfway. Everything runs on the node's integrated clock, so a
  // node speeding up never jumps; reduced motion holds a designed pose (ring
  // at rest, rune and cell 0 lit, no sweep). Detail steps down with the tier:
  // T0 is the seal and one turning rune tick, T1 three runes and three cells,
  // T2 all six with the inner hexagon and the scan, T3 an inner border and the
  // head's spark. Every paint is a unit-space shape under the node's own
  // transform; the three radials (glow, well, spark) are built once per canvas
  // and tint, and every level eases through globalAlpha.
  const SIGIL_SEAL = 0.98;
  const SIGIL_CELL = 0.32;
  const SIGIL_SIXTH = Math.PI / 3;
  // A pointy-top unit hexagon (vertex 0 on top, then clockwise), its six edge
  // normals (0 pointing right: the cells' and the runes' directions) and the
  // hub's twelve dial directions.
  const SIGIL_HEX = new Float64Array(12);
  const SIGIL_NORMAL = new Float64Array(12);
  const SIGIL_DIAL = new Float64Array(24);
  for (let k = 0; k < 6; k += 1) {
    SIGIL_HEX[2 * k] = Math.cos(k * SIGIL_SIXTH - Math.PI / 2);
    SIGIL_HEX[2 * k + 1] = Math.sin(k * SIGIL_SIXTH - Math.PI / 2);
    SIGIL_NORMAL[2 * k] = Math.cos(k * SIGIL_SIXTH);
    SIGIL_NORMAL[2 * k + 1] = Math.sin(k * SIGIL_SIXTH);
  }
  for (let k = 0; k < 12; k += 1) {
    SIGIL_DIAL[2 * k] = Math.cos(k * Math.PI / 6 - Math.PI / 2);
    SIGIL_DIAL[2 * k + 1] = Math.sin(k * Math.PI / 6 - Math.PI / 2);
  }
  // Six runes in a slot's own frame (u out from the centre, v across it), two
  // strokes each: [u0, v0, u1, v1, u2, v2, u3, v3]. A joined rune's second
  // stroke starts where its first ends (one polyline); either way two lineTo.
  const SIGIL_SHAPES = [
    [0.6, 0, 0.8, 0, 0.8, 0, 0.71, 0.075], // a stave, a branch off its outer end
    [0.6, 0, 0.8, 0, 0.665, -0.07, 0.735, 0.07], // a stave and a slanted bar
    [0.8, 0, 0.6, 0, 0.6, 0, 0.69, -0.075], // a stave, a branch off its inner end
    [0.61, -0.07, 0.79, 0, 0.79, 0, 0.61, 0.07], // an arrowhead
    [0.6, -0.065, 0.7, 0.065, 0.7, 0.065, 0.8, -0.065], // a zig
    [0.62, -0.07, 0.78, 0.07, 0.62, 0.07, 0.78, -0.07], // a cross
  ];
  const SIGIL_JOINED = [true, false, true, true, true, false];
  // Every rune at every slot, already turned to the slot's direction.
  const SIGIL_RUNES = new Float64Array(6 * 6 * 8);
  for (let shape = 0; shape < 6; shape += 1) {
    for (let slot = 0; slot < 6; slot += 1) {
      const cos = SIGIL_NORMAL[2 * slot], sin = SIGIL_NORMAL[2 * slot + 1], at = (shape * 6 + slot) * 8;
      for (let q = 0; q < 4; q += 1) {
        // Drawn a tenth longer and wider than listed (.58 to .80), to read at 12 px.
        const u = 0.69 + (SIGIL_SHAPES[shape][2 * q] - 0.7) * 1.1, v = SIGIL_SHAPES[shape][2 * q + 1] * 1.15;
        SIGIL_RUNES[at + 2 * q] = u * cos - v * sin;
        SIGIL_RUNES[at + 2 * q + 1] = u * sin + v * cos;
      }
    }
  }
  // The chosen node's crown: the six points of a hexagram (tips at 1.3), cut
  // where they meet the seal (1.04), so no line crosses the runes. Per point:
  // base, tip, base, as x, y pairs; tip 0 on top. Unturned, every point sits
  // in a gap between two working cells (a point spans 21 to 39 degrees off a
  // cell's direction; a cell 15 either side of it), which is where the crown
  // settles while the node works.
  const SIGIL_CROWN = (() => {
    const tip = 1.3, inner = tip / Math.sqrt(3), clip = 1.04;
    const ix = inner * Math.cos(Math.PI / 6), iy = inner * Math.sin(Math.PI / 6);
    const dx = tip - ix, dy = -iy;
    const a = dx * dx + dy * dy, b = 2 * (ix * dx + iy * dy), c = ix * ix + iy * iy - clip * clip;
    const t = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
    const bx = ix + dx * t, by = iy + dy * t;
    const table = new Float64Array(36);
    for (let k = 0; k < 6; k += 1) {
      const cos = SIGIL_HEX[2 * k], sin = SIGIL_HEX[2 * k + 1];
      const points = [bx, by, tip, 0, bx, -by];
      for (let q = 0; q < 3; q += 1) {
        table[k * 6 + 2 * q] = points[2 * q] * cos - points[2 * q + 1] * sin;
        table[k * 6 + 2 * q + 1] = points[2 * q] * sin + points[2 * q + 1] * cos;
      }
    }
    return table;
  })();
  // The rune rhythm every Sigil wire is cut in (long, gap, dot, gap), one per
  // relationship, and its period for the drift.
  const SIGIL_DASHES = Object.freeze({
    session: Object.freeze([5, 2, 1.5, 2]), hub: Object.freeze([5, 2, 1.5, 2]), todo: Object.freeze([5, 2, 1.5, 2]),
    agent: Object.freeze([5, 2, 1.5, 2]), task: Object.freeze([1.5, 2.5, 1.5, 5]), folded: Object.freeze([1, 5]),
    tether: Object.freeze([6, 2, 1.5, 2]),
  });
  const SIGIL_PERIODS = Object.freeze({ session: 10.5, hub: 10.5, todo: 10.5, agent: 10.5, task: 10.5, folded: 6, tether: 11.5 });
  const SIGIL_QUEUED = Object.freeze([2, 3]);
  const SIGIL_NO_DASH = Object.freeze([]);
  const SIGIL_FONT = '700 8px system-ui, "Segoe UI", sans-serif';
  const SIGIL_AT = { x: 0, y: 0 };
  const SIGIL_CELLS = new Float64Array(6);
  // The work orbit's track circumscribes the caller's orbit circle (r + 9):
  // its flat sides touch that circle, so its bottom edge keeps the legacy
  // clearance over the progress meter, and its corners (15% further out)
  // point at the cells.
  const SIGIL_ORBIT_OUT = 1 / Math.cos(Math.PI / 6);

  const sigilFrac = (value) => value - Math.floor(value);
  const sigilNum = (value, fallback) => Number.isFinite(value) ? value : fallback;
  const sigilSlot = (value) => ((value % 6) + 6) % 6;
  // The alpha a hook was handed (a caller's fade × emphasis), to scale its
  // own levels by.
  const sigilBase = (ctx) => { const alpha = ctx.globalAlpha; return typeof alpha === "number" && alpha >= 0 ? alpha : 1; };

  // A pointy-top hexagon of circumradius r round (x, y), as one closed
  // subpath (five lineTo); the same turned by an angle given as its cosine
  // and sine; one edge of it (vertex k to vertex k + 1).
  function sigilHex(ctx, x, y, r) {
    ctx.moveTo(x + SIGIL_HEX[0] * r, y + SIGIL_HEX[1] * r);
    for (let k = 1; k < 6; k += 1) ctx.lineTo(x + SIGIL_HEX[2 * k] * r, y + SIGIL_HEX[2 * k + 1] * r);
    ctx.closePath();
  }
  function sigilHexTurned(ctx, x, y, r, cos, sin) {
    for (let k = 0; k < 6; k += 1) {
      const hx = SIGIL_HEX[2 * k], hy = SIGIL_HEX[2 * k + 1];
      const px = x + r * (cos * hx - sin * hy), py = y + r * (sin * hx + cos * hy);
      if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath();
  }
  function sigilEdge(ctx, x, y, r, k) {
    const from = sigilSlot(k) * 2, to = sigilSlot(k + 1) * 2;
    ctx.moveTo(x + SIGIL_HEX[from] * r, y + SIGIL_HEX[from + 1] * r);
    ctx.lineTo(x + SIGIL_HEX[to] * r, y + SIGIL_HEX[to + 1] * r);
  }
  // The flat-top hexagon (vertices on the edge normals, so its corners point
  // at the cells), for the work orbit: one closed subpath, five lineTo.
  function sigilFlatHex(ctx, x, y, r) {
    ctx.moveTo(x + SIGIL_NORMAL[0] * r, y + SIGIL_NORMAL[1] * r);
    for (let k = 1; k < 6; k += 1) ctx.lineTo(x + SIGIL_NORMAL[2 * k] * r, y + SIGIL_NORMAL[2 * k + 1] * r);
    ctx.closePath();
  }
  // A stretch of the flat-top hexagon's perimeter, from `from` to `to` in
  // edge units (vertex 0, on the right, at 0; to > from), as one open subpath.
  function sigilPerimeterPoint(x, y, r, s) {
    const edge = Math.floor(s), f = s - edge, a = sigilSlot(edge) * 2, b = sigilSlot(edge + 1) * 2;
    SIGIL_AT.x = x + r * (SIGIL_NORMAL[a] + (SIGIL_NORMAL[b] - SIGIL_NORMAL[a]) * f);
    SIGIL_AT.y = y + r * (SIGIL_NORMAL[a + 1] + (SIGIL_NORMAL[b + 1] - SIGIL_NORMAL[a + 1]) * f);
    return SIGIL_AT;
  }
  function sigilPerimeter(ctx, x, y, r, from, to) {
    let point = sigilPerimeterPoint(x, y, r, from);
    ctx.moveTo(point.x, point.y);
    for (let vertex = Math.floor(from) + 1; vertex < to; vertex += 1) {
      const k = sigilSlot(vertex) * 2;
      ctx.lineTo(x + SIGIL_NORMAL[k] * r, y + SIGIL_NORMAL[k + 1] * r);
    }
    point = sigilPerimeterPoint(x, y, r, to);
    ctx.lineTo(point.x, point.y);
  }
  // Rune `shape` at ring slot `slot`, in the (already turned) ring's frame.
  function sigilRune(ctx, shape, slot) {
    const at = (shape * 6 + slot) * 8;
    ctx.moveTo(SIGIL_RUNES[at], SIGIL_RUNES[at + 1]);
    ctx.lineTo(SIGIL_RUNES[at + 2], SIGIL_RUNES[at + 3]);
    if (!SIGIL_JOINED[shape]) ctx.moveTo(SIGIL_RUNES[at + 4], SIGIL_RUNES[at + 5]);
    ctx.lineTo(SIGIL_RUNES[at + 6], SIGIL_RUNES[at + 7]);
  }

  // A tint's tones under a theme, and its three radials, per canvas. The body
  // sinks toward the theme's background (a dark seal on a dark theme; on a
  // light one only halfway, so the seal carries its state's hue, an apricot
  // seal for amber, off the page) and the ink rises toward its highlight; on
  // a light theme the rim darkens (3:1 on the page for amber) and the glows
  // use the hue itself, so every state tint stays legible. The theme's second
  // hue is only ever a highlight (the tail rune, the lit cell, the crown, the
  // wire packets); without one, or when it is the tint's own hue (a working
  // node on a theme whose bright is its second hue), it is the tint risen
  // toward the highlight. A flash lights the seal in the whitened tint, or on
  // paper in the hue itself. Colour strings are all at alpha 1: every level
  // is a globalAlpha gain.
  const sigilKeys = new WeakMap();
  function sigilTones(tint, palette) {
    const light = palette.light === true, hi = palette.hi ?? WHITE, bg = palette.bg ?? theme(null).bg;
    const edge = light ? mix(tint, hi, 0.4) : tint;
    const deep = mix(tint, bg, light ? 0.5 : 0.84);
    const hot = mix(tint, hi, 0.55);
    const ink = mix(tint, hi, light ? 0.9 : 0.88);
    const rune = mix(tint, hi, light ? 0.55 : 0.42);
    const second = palette.accent2;
    const own = second ? Math.abs(second[0] - tint[0]) + Math.abs(second[1] - tint[1]) + Math.abs(second[2] - tint[2]) < 40 : true;
    const accent = own ? hot : second;
    const halo = light ? tint : hot;
    return {
      tint, edge, deep, hot, ink, rune, accent, halo, light,
      tintS: rgba(tint, 1), edgeS: rgba(edge, 1), deepS: rgba(deep, 1), hotS: rgba(hot, 1), inkS: rgba(ink, 1),
      runeS: rgba(rune, 1), accentS: rgba(accent, 1), flashS: rgba(halo, 1),
      glow: null, well: null, spark: null,
    };
  }
  function sigilPaints(ctx, tint, palette) {
    let memo = sigilKeys.get(tint);
    if (!memo || memo.theme !== palette.key) {
      memo = { theme: palette.key, key: `sigil|${tint.join(",")}|${palette.key}` };
      sigilKeys.set(tint, memo);
    }
    return cacheGet(ctx, memo.key) ?? cachePut(ctx, memo.key, sigilTones(tint, palette));
  }
  function sigilGlowPaint(ctx, tones) {
    const glow = ctx.createRadialGradient(0, 0, 0.5, 0, 0, 1.55);
    glow.addColorStop(0, rgba(tones.halo, 0.34));
    glow.addColorStop(0.45, rgba(tones.halo, 0.12));
    glow.addColorStop(1, rgba(tones.halo, 0));
    return glow;
  }
  function sigilWellPaint(ctx, tones) {
    const well = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.92);
    well.addColorStop(0, rgba(tones.tint, tones.light ? 0.4 : 0.3));
    well.addColorStop(0.6, rgba(tones.tint, tones.light ? 0.14 : 0.1));
    well.addColorStop(1, rgba(tones.tint, 0));
    return well;
  }
  function sigilSparkPaint(ctx, tones) {
    const spark = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    spark.addColorStop(0, rgba(tones.light ? tones.tint : tones.ink, 0.9));
    spark.addColorStop(0.4, rgba(tones.halo, 0.35));
    spark.addColorStop(1, rgba(tones.halo, 0));
    return spark;
  }
  // Wires and pulses are handed no theme: they read the one the Sigil bodies
  // were last painted in (a frozen, memoized palette record, never a caller's
  // scratch), else the defaults.
  let sigilTheme = null;
  const sigilThemeOf = (o) => o.theme ?? sigilTheme ?? theme(null);

  // The glyph ink on a Sigil body: the tint risen almost to the highlight
  // (light on a dark seal, dark on a light one).
  const sigilInks = new WeakMap();
  function sigilGlyphInk(tint, palette) {
    let memo = sigilInks.get(tint);
    if (!memo || memo.theme !== palette.key) {
      memo = { theme: palette.key, ink: rgba(mix(tint, palette.hi ?? WHITE, 0.88), 1) };
      sigilInks.set(tint, memo);
    }
    return memo.ink;
  }

  // How far out each working cell stands (0 folded in, 1 locked on, a little
  // over while it overshoots), into SIGIL_CELLS. While the node works each
  // assembles on the work's age, .12 s after the one before it; once it
  // stops they fold back in on the eased work level, the last one first.
  // The two curves are unrelated and the age restarts, so a work that stops
  // before its cells are out (or starts again while they fold) would jump:
  // each record keeps the extents it painted and the time (ms), a cell
  // never folds while the work runs nor comes out while it rests, and it
  // moves at most 1/.10 s out and 1/.16 s in, so any toggle glides (and the
  // first frame of a start eases off its steepest step). A second paint in
  // the same frame holds; a first sight, a gap over 250 ms, a clock running
  // back or reduced motion takes the curves as they are.
  const sigilCellState = new WeakMap();
  function sigilExtents(m, time, active, work, age, still) {
    for (let k = 0; k < 6; k += 1) {
      SIGIL_CELLS[k] = active ? easeOutBack((age - 0.12 * k) / 0.3) : smooth01((work - 0.15 - 0.09 * k) / 0.35);
    }
    let state = sigilCellState.get(m);
    if (still) {
      if (state) state[6] = NaN;
      return;
    }
    if (!state) {
      state = new Float64Array(7);
      state[6] = NaN;
      sigilCellState.set(m, state);
    }
    const gap = time - state[6];
    if (gap >= 0 && gap <= 250) {
      const dt = Math.min(gap, 50) / 1000, out = dt / 0.1, back = dt / 0.16;
      for (let k = 0; k < 6; k += 1) {
        const last = state[k];
        const want = active ? Math.max(SIGIL_CELLS[k], Math.min(last, 1)) : Math.min(SIGIL_CELLS[k], last);
        SIGIL_CELLS[k] = want > last + out ? last + out : want < last - back ? last - back : want;
      }
    }
    for (let k = 0; k < 6; k += 1) state[k] = SIGIL_CELLS[k];
    state[6] = time;
  }

  // The working cells: six (three at T1) pointy-top cells slide out of the
  // seal's edges along the edge normals and lock at 1.19, as far as
  // sigilExtents has them. The scan's cell (and the one it just left) wear
  // the second hue, and at T3 the struck rune is written into the lit cell,
  // engraved in the body's tone. Drawn under the seal, so the cells come out
  // of it.
  function sigilCells(ctx, tones, detail, base, work, lit, flare, trail, px, rune, engrave) {
    const step = detail >= 2 ? 1 : 2;
    const gain = Math.min(1, work / 0.25);
    const scan = detail >= 2;
    const left = sigilSlot(lit - 1);
    const leaving = scan && trail > 0.01 && SIGIL_CELLS[left] > 0.02;
    const lighting = scan && SIGIL_CELLS[lit] > 0.02;
    ctx.lineJoin = "miter";
    for (let pass = 0; pass < 3; pass += 1) {
      if (pass === 1 && !leaving || pass === 2 && !lighting) continue;
      ctx.beginPath();
      let drawn = false;
      for (let k = 0; k < 6; k += step) {
        const extent = SIGIL_CELLS[k];
        if (extent <= 0.02) continue;
        const mine = pass === 0 ? !(lighting && k === lit) && !(leaving && k === left) : k === (pass === 1 ? left : lit);
        if (!mine) continue;
        // Out from under the seal's edge to 1.176, where the cell's inner
        // edge sits flush with the seal's (a .05 gap).
        const reach = 0.85 + 0.326 * extent;
        sigilHex(ctx, SIGIL_NORMAL[2 * k] * reach, SIGIL_NORMAL[2 * k + 1] * reach, SIGIL_CELL * extent);
        drawn = true;
      }
      if (!drawn) continue;
      ctx.globalAlpha = base * gain * 0.95; ctx.fillStyle = tones.deepS; ctx.fill();
      if (pass === 0) {
        ctx.globalAlpha = base * gain * 0.9; ctx.strokeStyle = tones.edgeS; ctx.lineWidth = px; ctx.stroke();
      } else {
        const level = pass === 2 ? flare : trail;
        ctx.globalAlpha = base * gain * level * (pass === 2 ? 0.72 : 0.5); ctx.fillStyle = tones.accentS; ctx.fill();
        ctx.globalAlpha = base * gain * (pass === 2 ? 0.55 + 0.45 * flare : 0.9); ctx.strokeStyle = pass === 2 ? tones.hotS : tones.edgeS;
        ctx.lineWidth = (pass === 2 ? 1.2 : 1) * px; ctx.stroke();
      }
    }
    const extent = SIGIL_CELLS[lit], ink = lighting ? engrave * flare * Math.min(1, extent) : 0;
    if (ink > 0.01) {
      // The rune, moved from its ring slot (.69 out) to the cell's centre.
      const reach = 0.85 + 0.326 * extent, size = 0.95 * extent, dx = SIGIL_NORMAL[2 * lit], dy = SIGIL_NORMAL[2 * lit + 1];
      ctx.save();
      ctx.translate(dx * reach, dy * reach); ctx.scale(size, size); ctx.translate(-0.69 * dx, -0.69 * dy);
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath(); sigilRune(ctx, rune, lit);
      ctx.globalAlpha = base * gain * ink; ctx.strokeStyle = tones.deepS; ctx.lineWidth = 1.2 * px / size; ctx.stroke();
      ctx.restore();
    }
  }

  function paintSigil(ctx, p, radius, tint, n, m) {
    const palette = n.theme;
    sigilTheme = palette;
    const tones = sigilPaints(ctx, tint, palette);
    const r = radius > 0.5 ? radius : 0.5, px = 1 / r;
    const detail = Math.max(0, Math.min(3, Math.floor(sigilNum(n.detail, 3))));
    const base = n.alpha;
    const still = m.still === true;
    const clock = sigilNum(m.clock, 0), seed = sigilNum(m.seed, 0);
    const lit = clamp01(sigilNum(m.lit, n.active || n.selected ? 1 : 0));
    const work = clamp01(sigilNum(m.work, n.active ? 1 : 0));
    const sel = clamp01(sigilNum(m.sel, n.selected ? 1 : 0));
    const kick = still ? 0 : clamp01(sigilNum(m.kick, 0));
    const age = sigilNum(m.age, 1e9);
    // The ring's turn, and the scan: one step (a rune written, a cell lit)
    // every .7 clock seconds, so 1.4 s a circuit at work. `phase` runs
    // through the step: the head strikes in, holds, and hands over to the
    // next as it fades into the tail.
    const ring = still ? 0 : TAU * sigilFrac(clock / 9 + seed);
    const beat = clock / 0.7 + seed * 6;
    const slot = still ? 0 : sigilSlot(Math.floor(beat));
    const phase = still ? 0.5 : beat - Math.floor(beat);
    const flare = still ? 1 : (0.35 + 0.65 * easeOut(phase / 0.15)) * (1 - 0.2 * phase);
    const trail = still ? 0 : 0.8 * Math.pow(1 - phase, 1.5);
    ctx.save();
    ctx.translate(p.x, p.y); ctx.scale(r, r);
    // The glow, eased by the lit level; a landing pulse flashes it.
    const glow = Math.min(1, 0.9 * lit + 0.6 * kick);
    if (glow > 0.02) {
      tones.glow ??= sigilGlowPaint(ctx, tones);
      ctx.globalAlpha = base * glow; ctx.fillStyle = tones.glow;
      ctx.beginPath(); ctx.arc(0, 0, 1.55, 0, TAU); ctx.fill();
    }
    // An agent's status ring is its work sign: no lattice round an agent.
    const lattice = n.kind !== "agent";
    ctx.lineJoin = "miter";
    // At work a hexagon sweeps out from the rim to 1.52 and fades, under the
    // cells: a ripple through the gaps of the honeycomb.
    if (lattice && !still && work > 0.02) {
      const u = sigilFrac(clock / 4.8 + seed);
      const sweep = 0.6 * (1 - u) * (1 - u) * work;
      if (sweep > 0.01) {
        ctx.beginPath(); sigilHex(ctx, 0, 0, SIGIL_SEAL * (1 + 0.55 * u));
        ctx.globalAlpha = base * sweep; ctx.strokeStyle = tones.edgeS; ctx.lineWidth = 1.2 * px; ctx.stroke();
      }
    }
    // The rune beside the scan's cell (the ring's slot nearest its direction).
    const shape0 = Math.floor(seed * 6) % 6;
    const near = sigilSlot(slot - Math.round(ring / SIGIL_SIXTH));
    if (lattice) sigilExtents(m, n.time, n.active, work, age, still);
    if (lattice && work > 0.02 && detail >= 1) sigilCells(ctx, tones, detail, base, work, slot, flare, trail, px, (near + shape0) % 6, detail >= 3 ? tierIn(r, 3) : 0);
    // The seal: body, well, the landing flash, the rim.
    ctx.lineJoin = "miter";
    ctx.beginPath(); sigilHex(ctx, 0, 0, SIGIL_SEAL);
    ctx.globalAlpha = base; ctx.fillStyle = tones.deepS; ctx.fill();
    if (detail >= 1) {
      tones.well ??= sigilWellPaint(ctx, tones);
      ctx.globalAlpha = base * (0.6 + 0.4 * lit); ctx.fillStyle = tones.well; ctx.fill();
    }
    if (kick > 0.01) { ctx.globalAlpha = base * 0.5 * kick; ctx.fillStyle = tones.flashS; ctx.fill(); }
    ctx.globalAlpha = base * (tones.light ? 0.95 + 0.05 * lit : 0.85 + 0.15 * lit); ctx.strokeStyle = tones.edgeS;
    ctx.lineWidth = (1.1 + 0.45 * lit + 0.35 * sel + 0.4 * kick) * px; ctx.stroke();
    // T3: a faint inner border while the seal rests (the cells take over at work).
    const border = detail >= 3 ? 0.32 * (1 - work) * tierIn(r, 3) : 0;
    if (border > 0.01) {
      ctx.beginPath(); sigilHex(ctx, 0, 0, 0.86);
      ctx.globalAlpha = base * border; ctx.lineWidth = 0.6 * px; ctx.stroke();
    }
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (detail === 0) {
      // T0: one rune tick turning with the ring, and a centre dot.
      const angle = ring - Math.PI / 2, cos = Math.cos(angle), sin = Math.sin(angle);
      ctx.beginPath(); ctx.moveTo(cos * 0.42, sin * 0.42); ctx.lineTo(cos * 0.82, sin * 0.82);
      ctx.globalAlpha = base * 0.9; ctx.strokeStyle = tones.accentS; ctx.lineWidth = px; ctx.stroke();
      if (!n.glyph) {
        ctx.beginPath(); ctx.arc(0, 0, 0.26, 0, TAU);
        ctx.globalAlpha = base * 0.9; ctx.fillStyle = tones.edgeS; ctx.fill();
      }
    } else {
      const odd = detail >= 2 ? tierIn(r, 2) : 0;
      const dim = Math.min(1, 0.66 + 0.22 * lit + 0.35 * kick);
      ctx.save(); ctx.rotate(ring);
      // The runes: T1's three, then the other three as T2 fades them in.
      ctx.beginPath();
      for (let k = 0; k < 6; k += 2) sigilRune(ctx, (k + shape0) % 6, k);
      if (odd >= 1) for (let k = 1; k < 6; k += 2) sigilRune(ctx, (k + shape0) % 6, k);
      ctx.globalAlpha = base * dim; ctx.strokeStyle = tones.runeS; ctx.lineWidth = 1.15 * px; ctx.stroke();
      if (odd > 0 && odd < 1) {
        ctx.beginPath();
        for (let k = 1; k < 6; k += 2) sigilRune(ctx, (k + shape0) % 6, k);
        ctx.globalAlpha = base * dim * odd; ctx.stroke();
      }
      // The head: at rest the runes are written in turn round the ring; at
      // work the rune beside the scan's cell. They cross-fade with the work.
      const restHead = near === slot ? flare : flare * (1 - work);
      const workHead = near === slot ? 0 : flare * work;
      // The tail cools from the head's ink into the second hue over the
      // first fifth of the step, so the hand-over never flips its colour.
      const tail = odd > 0 ? trail * (1 - work) * odd : 0;
      if (tail > 0.01) {
        const cool = Math.min(1, phase / 0.2);
        ctx.beginPath(); sigilRune(ctx, (slot + 5 + shape0) % 6, sigilSlot(slot - 1));
        if (cool > 0.01) { ctx.globalAlpha = base * tail * cool; ctx.strokeStyle = tones.accentS; ctx.lineWidth = 1.2 * px; ctx.stroke(); }
        if (cool < 0.99) { ctx.globalAlpha = base * tail * (1 - cool); ctx.strokeStyle = tones.inkS; ctx.lineWidth = 1.6 * px; ctx.stroke(); }
      }
      const lead = workHead > restHead ? near : slot;
      const spark = detail >= 3 ? tierIn(r, 3) * Math.max(restHead, workHead) * 0.8 : 0;
      if (spark > 0.01) {
        tones.spark ??= sigilSparkPaint(ctx, tones);
        ctx.save(); ctx.translate(SIGIL_NORMAL[2 * lead] * 0.7, SIGIL_NORMAL[2 * lead + 1] * 0.7); ctx.scale(0.24, 0.24);
        ctx.globalAlpha = base * spark; ctx.fillStyle = tones.spark;
        ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill();
        ctx.restore();
      }
      ctx.strokeStyle = tones.inkS; ctx.lineWidth = 1.6 * px;
      if (restHead > 0.01) { ctx.beginPath(); sigilRune(ctx, (slot + shape0) % 6, slot); ctx.globalAlpha = base * restHead; ctx.stroke(); }
      if (workHead > 0.01) { ctx.beginPath(); sigilRune(ctx, (near + shape0) % 6, near); ctx.globalAlpha = base * workHead; ctx.stroke(); }
      ctx.restore();
      if (!n.glyph) {
        // The inner hexagon counter-turns (a vertex toward the runes at rest)...
        if (odd > 0) {
          const spin = still ? 0 : -TAU * sigilFrac(clock / 14 + seed * 0.5);
          ctx.beginPath(); sigilHexTurned(ctx, 0, 0, 0.42, -Math.sin(spin), Math.cos(spin));
          ctx.globalAlpha = base * (0.42 + 0.18 * work) * odd; ctx.strokeStyle = tones.edgeS; ctx.lineWidth = 0.8 * px; ctx.stroke();
        }
        // ...round the diamond seal, breathing.
        const size = 0.2 * (still ? 1 : 1 + 0.12 * Math.sin(TAU * sigilFrac(clock / 3.2 + seed * 0.37)));
        ctx.beginPath(); ctx.moveTo(0, -size); ctx.lineTo(size, 0); ctx.lineTo(0, size); ctx.lineTo(-size, 0); ctx.closePath();
        ctx.globalAlpha = base * (0.85 + 0.15 * lit); ctx.fillStyle = tones.edgeS; ctx.fill();
      }
    }
    ctx.restore();
    voidMonogram(ctx, p, n, tones.ink);
  }

  // The agent's status ring, a hexagon the glyph's gap out: at work two
  // opposite edges lit, stepping one edge every 120 ms with the two they left
  // fading; queued, a dashed hexagon marching; failed, an amber one pulsing
  // with its "!" badge; done, the green tick badge. Badges pop in.
  // The state colours a badge and the error ring wear: the theme's own on a
  // dark theme; on a light one darkened toward its ink, so amber and green
  // still read on a pale ground. Built once per theme.
  const sigilStateCache = new WeakMap();
  function sigilStates(palette) {
    let states = sigilStateCache.get(palette);
    if (!states) {
      const light = palette.light === true, hi = palette.hi ?? WHITE, bg = palette.bg ?? theme(null).bg;
      const amber = palette.amber ?? theme(null).amber, done = palette.done ?? theme(null).done;
      states = light
        ? { amber: mix(amber, hi, 0.42), amberWell: mix(amber, bg, 0.62), done: mix(done, hi, 0.42), doneWell: mix(done, bg, 0.62) }
        : { amber, amberWell: palette.amberWell ?? mix(amber, bg, 0.8), done, doneWell: palette.doneWell ?? mix(done, bg, 0.8) };
      sigilStateCache.set(palette, states);
    }
    return states;
  }
  function sigilBadge(ctx, x, y, pop, well, colour, bang, base) {
    ctx.save(); ctx.translate(x, y); ctx.scale(pop, pop);
    ctx.beginPath(); sigilHex(ctx, 0, 0, 5.4);
    ctx.globalAlpha = base; ctx.fillStyle = rgba(well, 1); ctx.fill();
    ctx.globalAlpha = base * 0.9; ctx.strokeStyle = rgba(colour, 1); ctx.lineWidth = 1; ctx.stroke();
    ctx.globalAlpha = base;
    if (bang) {
      ctx.font = SIGIL_FONT; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = rgba(colour, 1); ctx.fillText("!", 0, 0.5);
    } else {
      ctx.beginPath(); ctx.moveTo(-2.6, 0); ctx.lineTo(-0.8, 1.9); ctx.lineTo(2.6, -2);
      ctx.lineWidth = 1.4; ctx.stroke();
    }
    ctx.restore();
  }
  function sigilRing(ctx, p, radius, tint, o) {
    const status = o.status ?? null;
    const running = status === "running" || o.builder === true;
    if (!running && status !== "queued" && status !== "error" && status !== "done") return false;
    const palette = o.theme ?? theme(null);
    const tones = sigilPaints(ctx, tint, palette);
    const ring = sigilNum(o.ring, radius + 3.5);
    const still = o.still === true, time = sigilNum(o.time, 0), m = o.motion ?? null, seed = sigilNum(m?.seed, 0);
    const base = sigilBase(ctx);
    ctx.save();
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (running) {
      ctx.beginPath(); sigilHex(ctx, p.x, p.y, ring);
      ctx.globalAlpha = base * 0.24; ctx.strokeStyle = tones.edgeS; ctx.lineWidth = 1; ctx.stroke();
      const k = still ? 0 : sigilSlot(Math.floor(time / 120 + seed * 6));
      if (!still) {
        ctx.beginPath(); sigilEdge(ctx, p.x, p.y, ring, k + 5); sigilEdge(ctx, p.x, p.y, ring, k + 2);
        ctx.globalAlpha = base * 0.42; ctx.lineWidth = 1.2; ctx.stroke();
      }
      ctx.beginPath(); sigilEdge(ctx, p.x, p.y, ring, k); sigilEdge(ctx, p.x, p.y, ring, k + 3);
      ctx.globalAlpha = base * 0.95; ctx.lineWidth = 1.6; ctx.stroke();
    } else if (status === "queued") {
      ctx.setLineDash(SIGIL_QUEUED); ctx.lineDashOffset = still ? 0 : -((time / 90) % 5);
      ctx.beginPath(); sigilHex(ctx, p.x, p.y, ring);
      ctx.globalAlpha = base * 0.5; ctx.strokeStyle = tones.edgeS; ctx.lineWidth = 1; ctx.stroke();
    } else {
      const states = sigilStates(palette);
      const statusAt = m && Number.isFinite(m.statusAt) ? m.statusAt : -1e9;
      const pop = still ? 1 : easeOutBack((time - statusAt) / 320);
      // The badge sits up and to the right, 2 px of air off the ring.
      const bx = p.x + radius + 4, by = p.y - radius - 4;
      if (status === "error") {
        const pulse = still ? 1 : 0.5 + 0.5 * Math.sin(TAU * sigilFrac(time / 1200 + seed));
        ctx.beginPath(); sigilHex(ctx, p.x, p.y, ring);
        ctx.globalAlpha = base * (0.55 + 0.35 * pulse); ctx.strokeStyle = rgba(states.amber, 1); ctx.lineWidth = 1.4; ctx.stroke();
        if (pop > 0.02) sigilBadge(ctx, bx, by, pop, states.amberWell, states.amber, true, base);
      } else if (pop > 0.02) sigilBadge(ctx, bx, by, pop, states.doneWell, states.done, false, base);
    }
    ctx.restore();
    return true;
  }

  // The hub's dress: twelve rune ticks on a dial at r + 6 (every third one
  // long), turning once in 30 s, one of them lit and stepping round; the
  // crew's ring is cut in the rune rhythm.
  function sigilHub(ctx, p, radius, tint, o) {
    const palette = o.theme ?? theme(null);
    const tones = sigilPaints(ctx, tint, palette);
    const still = o.still === true, time = sigilNum(o.time, 0), seed = sigilNum(o.motion?.seed, 0);
    const step = sigilNum(o.detail, 3) >= 2 ? 1 : 3;
    const breathe = still ? 0.5 : clamp01(sigilNum(o.breathe, 0.5));
    const base = sigilBase(ctx), dial = radius + 6;
    ctx.save();
    ctx.translate(p.x, p.y); ctx.rotate(still ? 0 : TAU * sigilFrac(time / 30000 + seed));
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let k = 0; k < 12; k += step) {
      const cos = SIGIL_DIAL[2 * k], sin = SIGIL_DIAL[2 * k + 1], half = k % 3 === 0 ? 2 : 1.1;
      ctx.moveTo(cos * (dial - half), sin * (dial - half)); ctx.lineTo(cos * (dial + half), sin * (dial + half));
    }
    ctx.globalAlpha = base * (0.34 + 0.16 * breathe); ctx.strokeStyle = tones.edgeS; ctx.lineWidth = 1; ctx.stroke();
    const lit = still ? 0 : ((Math.floor(time / 600 + seed * 12) % 12) + 12) % 12;
    const tick = lit - lit % step, long = tick % 3 === 0 ? 2.4 : 1.6;
    ctx.beginPath(); ctx.moveTo(SIGIL_DIAL[2 * tick] * (dial - long), SIGIL_DIAL[2 * tick + 1] * (dial - long));
    ctx.lineTo(SIGIL_DIAL[2 * tick] * (dial + long), SIGIL_DIAL[2 * tick + 1] * (dial + long));
    ctx.globalAlpha = base * 0.9; ctx.strokeStyle = tones.hotS; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.restore();
    if (o.crew === true) {
      ctx.save();
      ctx.setLineDash(SIGIL_DASHES.session); ctx.lineDashOffset = still ? 0 : -((time / 400) % SIGIL_PERIODS.session);
      ctx.beginPath(); ctx.arc(p.x, p.y, radius * 3.1, 0, TAU);
      ctx.globalAlpha = base * 0.12; ctx.strokeStyle = tones.edgeS; ctx.lineWidth = 0.8; ctx.stroke();
      ctx.restore();
    }
    return true;
  }

  // The work orbit: a comet running round a flat-top hexagon whose sides
  // touch the caller's orbit circle (r + 9: the bottom side keeps the legacy
  // 2.5 px over the progress meter; the corners, 15% further out, point at
  // the cells and clear them) in the node's own tint (the theme's orbit hue
  // without one), three pieces fading behind its head, on the node's
  // integrated orbit phase.
  function sigilOrbit(ctx, p, radius, tint, o) {
    const palette = o.theme ?? theme(null);
    const tones = sigilPaints(ctx, tint ?? palette.orbit, palette);
    const ring = sigilNum(o.ring, radius + 9) * SIGIL_ORBIT_OUT;
    const still = o.still === true, m = o.motion ?? null;
    const phase = still ? sigilNum(o.phase, Math.PI / 3) : sigilNum(m?.orbit, sigilNum(o.phase, 0));
    const head = 6 * sigilFrac(phase / TAU) + 12;
    const base = sigilBase(ctx);
    ctx.save();
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); sigilFlatHex(ctx, p.x, p.y, ring);
    ctx.globalAlpha = base * 0.2; ctx.strokeStyle = tones.edgeS; ctx.lineWidth = 0.8; ctx.stroke();
    for (let piece = 2; piece >= 0; piece -= 1) {
      const to = head - piece * 0.55;
      ctx.beginPath(); sigilPerimeter(ctx, p.x, p.y, ring, to - 0.55, to);
      ctx.globalAlpha = base * (0.8 - piece * 0.24); ctx.lineWidth = 2.4 - piece * 0.6; ctx.stroke();
    }
    ctx.restore();
    return true;
  }

  // A node arriving: the seal flashes and rings out while six small hexes
  // break off its corners and fly out, turning. Nothing under reduced motion.
  function sigilArrival(ctx, p, radius, tint, t01, o) {
    if (o.still === true) return false;
    const u = clamp01(sigilNum(t01, 1));
    if (u >= 1) return true;
    const tones = sigilPaints(ctx, tint, o.theme ?? theme(null));
    const alpha = sigilNum(o.alpha, 1), fade = 1 - u;
    ctx.save();
    ctx.translate(p.x, p.y); ctx.scale(radius, radius);
    ctx.lineJoin = "miter";
    ctx.beginPath(); sigilHex(ctx, 0, 0, SIGIL_SEAL);
    ctx.globalAlpha = alpha * 0.7 * fade * fade; ctx.fillStyle = tones.flashS; ctx.fill();
    ctx.beginPath(); sigilHex(ctx, 0, 0, SIGIL_SEAL * (1 + 0.4 * easeOut(u)));
    ctx.globalAlpha = alpha * 0.8 * fade; ctx.strokeStyle = tones.edgeS; ctx.lineWidth = 1.4 / radius; ctx.stroke();
    const out = 1 + 0.85 * easeOut(u), size = 0.2 * (1 - 0.35 * u), cos = Math.cos(u * Math.PI), sin = Math.sin(u * Math.PI);
    ctx.beginPath();
    for (let k = 0; k < 6; k += 1) sigilHexTurned(ctx, SIGIL_HEX[2 * k] * out, SIGIL_HEX[2 * k + 1] * out, size, cos, sin);
    ctx.globalAlpha = alpha * 0.9 * fade; ctx.fillStyle = tones.accentS; ctx.fill();
    ctx.restore();
    return true;
  }

  // Hover: a hexagon at 1.2 in the whitened tint, breathing a little. While
  // the cells are out it opens to 1.7 and turns flat-top (30 degrees round),
  // a frame round the honeycomb, clear of the cells and inside the orbit's
  // track; on a chosen node it gives way to the crown there. Chosen: the six
  // points of a hexagram at 1.3 in the theme's second hue, turning once in
  // 20 s; while the node works the turn eases off and the crown settles with
  // every point in a gap between two cells, so it never crosses them (a
  // small node keeps a second hexagon instead, opening like the hover's).
  // An agent grows no cells: its marks keep their resting shape.
  // The crown's turn per motion record: the angle and the time (ms) it was
  // drawn at, integrated so that easing into the gaps never jumps.
  const sigilCrownState = new WeakMap();
  function sigilCrownTurn(m, time, seed, work) {
    const rest = TAU * sigilFrac(time / 20000 + seed);
    const settled = rest + work * (Math.round(rest / SIGIL_SIXTH) * SIGIL_SIXTH - rest);
    if (!m) return settled;
    let state = sigilCrownState.get(m);
    if (!state) {
      state = new Float64Array(2);
      state[1] = NaN;
      sigilCrownState.set(m, state);
    }
    const gap = time - state[1];
    let angle = settled;
    if (gap >= 0 && gap <= 250) {
      const dt = gap / 1000;
      angle = state[0] + dt * (TAU / 20) * (1 - work);
      const nearest = Math.round(angle / SIGIL_SIXTH) * SIGIL_SIXTH;
      angle = nearest + (angle - nearest) * Math.exp(-dt * work / 0.2);
    }
    angle -= TAU * Math.floor(angle / TAU);
    state[0] = angle; state[1] = time;
    return angle;
  }
  function sigilSelect(ctx, p, radius, tint, o) {
    const m = o.motion ?? null;
    const sel = clamp01(sigilNum(m?.sel, o.selected === true || o.chosen === true ? 1 : 0));
    if (sel < 0.01) return true;
    const tones = sigilPaints(ctx, tint, o.theme ?? theme(null));
    const still = o.still === true, time = sigilNum(o.time, 0), seed = sigilNum(m?.seed, 0);
    const chosen = o.chosen === true;
    const work = o.kind === "agent" ? 0 : clamp01(sigilNum(m?.work, o.active === true ? 1 : 0));
    const alpha = sigilNum(o.alpha, 1), detail = sigilNum(o.detail, 3);
    const open = work > 0.001, cos = open ? Math.cos(work * SIGIL_SIXTH / 2) : 1, sin = open ? Math.sin(work * SIGIL_SIXTH / 2) : 0;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    const breath = still || work >= 1 ? 0 : 0.03 * (1 - work) * Math.sin(TAU * sigilFrac(time / 1800 + seed));
    const hover = (1.2 + 0.5 * work + breath) * radius;
    const gain = 0.75 * sel * (chosen ? 1 - work : 1);
    if (gain > 0.01) {
      ctx.beginPath(); sigilHexTurned(ctx, 0, 0, hover, cos, sin);
      ctx.globalAlpha = alpha * gain; ctx.strokeStyle = tones.hotS; ctx.lineWidth = 1.4; ctx.stroke();
    }
    if (chosen) {
      ctx.strokeStyle = tones.accentS; ctx.globalAlpha = alpha * 0.85 * sel;
      if (detail >= 2) {
        ctx.rotate(still ? 0 : sigilCrownTurn(m, time, seed, work));
        ctx.scale(radius, radius);
        ctx.beginPath();
        for (let k = 0; k < 6; k += 1) {
          ctx.moveTo(SIGIL_CROWN[k * 6], SIGIL_CROWN[k * 6 + 1]);
          ctx.lineTo(SIGIL_CROWN[k * 6 + 2], SIGIL_CROWN[k * 6 + 3]);
          ctx.lineTo(SIGIL_CROWN[k * 6 + 4], SIGIL_CROWN[k * 6 + 5]);
        }
        ctx.lineWidth = 1.6 / radius; ctx.stroke();
      } else {
        ctx.beginPath(); sigilHexTurned(ctx, 0, 0, radius * (1.32 + 0.38 * work), cos, sin);
        ctx.lineWidth = 1.4; ctx.stroke();
      }
    }
    ctx.restore();
    return true;
  }

  // Wires: cut in the rune rhythm, drifting slowly at rest and marching while
  // the work runs, where a faint groove lies under the runes and two hex
  // packets in the second hue ride along, turning. The far (blurred) pen
  // keeps the runes alone. On the rail only an active session's wires carry
  // the runes; every other rail wire keeps its plain line.
  function sigilWirePath(ctx, a, b, cp) {
    ctx.moveTo(a.x, a.y);
    if (cp) ctx.bezierCurveTo(cp.x1, cp.y1, cp.x2, cp.y2, b.x, b.y);
    else ctx.lineTo(b.x, b.y);
  }
  function sigilAlong(a, b, cp, u) {
    if (cp) {
      const v = 1 - u, w0 = v * v * v, w1 = 3 * v * v * u, w2 = 3 * v * u * u, w3 = u * u * u;
      SIGIL_AT.x = w0 * a.x + w1 * cp.x1 + w2 * cp.x2 + w3 * b.x;
      SIGIL_AT.y = w0 * a.y + w1 * cp.y1 + w2 * cp.y2 + w3 * b.y;
    } else {
      SIGIL_AT.x = a.x + (b.x - a.x) * u;
      SIGIL_AT.y = a.y + (b.y - a.y) * u;
    }
    return SIGIL_AT;
  }
  function sigilWire(ctx, a, b, o) {
    const rail = o.rail === true;
    if (rail && o.active !== true) return false;
    if (!Array.isArray(o.tint)) return false;
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    if (!(len > 0.5)) return true;
    const tones = sigilPaints(ctx, o.tint, sigilThemeOf(o));
    const alpha = clamp01(sigilNum(o.alpha, 0.3)), width = sigilNum(o.width, 1);
    const still = o.still === true, time = sigilNum(o.time, 0);
    const kind = Object.hasOwn(SIGIL_PERIODS, o.kind) ? o.kind : "session";
    const cp = o.curved === true && o.cp ? o.cp : null;
    const active = o.active === true, overlays = !rail && o.far !== true;
    const base = sigilBase(ctx);
    ctx.save();
    ctx.lineCap = "butt"; ctx.lineJoin = "round"; ctx.strokeStyle = tones.edgeS;
    if (active && overlays) {
      ctx.beginPath(); sigilWirePath(ctx, a, b, cp);
      ctx.globalAlpha = base * alpha * 0.28; ctx.lineWidth = width + 2; ctx.stroke();
    }
    ctx.setLineDash(SIGIL_DASHES[kind]);
    ctx.lineDashOffset = still ? 0 : -((time / (o.march === true || rail ? 55 : 400)) % SIGIL_PERIODS[kind]);
    ctx.beginPath();
    if (o.double === true && !cp) {
      const nx = -dy / len * 1.6, ny = dx / len * 1.6;
      ctx.moveTo(a.x + nx, a.y + ny); ctx.lineTo(b.x + nx, b.y + ny);
      ctx.moveTo(a.x - nx, a.y - ny); ctx.lineTo(b.x - nx, b.y - ny);
    } else sigilWirePath(ctx, a, b, cp);
    ctx.globalAlpha = base * alpha; ctx.lineWidth = width; ctx.stroke();
    if (active && overlays && !still && sigilNum(o.detail, 3) >= 1) {
      ctx.setLineDash(SIGIL_NO_DASH);
      const seed = sigilNum(o.seed, 0), turn = time / 520, cos = Math.cos(turn), sin = Math.sin(turn);
      ctx.beginPath();
      for (let k = 0; k < 2; k += 1) {
        const u = sigilFrac(time / 1900 + seed + k / 2);
        const at = sigilAlong(a, b, cp, u);
        sigilHexTurned(ctx, at.x, at.y, 2.6 * Math.min(1, 4 * Math.sin(Math.PI * u)), cos, sin);
      }
      ctx.globalAlpha = base * 0.95 * clamp01(sigilNum(o.lifetime, 1)); ctx.fillStyle = tones.accentS; ctx.fill();
    }
    ctx.restore();
    return true;
  }

  // A pulse's colour, parsed once and kept on the pulse.
  function sigilPulseRgb(pulse) {
    if (!pulse || typeof pulse !== "object") return WHITE;
    if (!pulse._sigilRgb) {
      const text = typeof pulse.color === "string" ? pulse.color.trim() : "";
      const full = /^#[\da-f]{6}$/i.test(text) ? text.slice(1) : /^#[\da-f]{3}$/i.test(text) ? text[1] + text[1] + text[2] + text[2] + text[3] + text[3] : "a9ffcd";
      const value = parseInt(full, 16);
      pulse._sigilRgb = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
    }
    return pulse._sigilRgb;
  }
  // A travelling pulse: a turning hex packet with two smaller hexes trailing
  // it; a wave also writes a run of runes behind its head. Reduced motion: a
  // faint wire with the packet resting halfway. The rail keeps its own dot.
  function sigilSurge(ctx, from, to, t, pulse, o) {
    if (o.rail === true) return false;
    const dx = to.x - from.x, dy = to.y - from.y, len = Math.hypot(dx, dy);
    if (!(len > 2)) return true;
    const live = pulse ?? o.pulse ?? null;
    const tones = sigilPaints(ctx, sigilPulseRgb(live), sigilThemeOf(o));
    const size = live?.packet ? 4.2 : live?.small ? 2.4 : 3.4;
    const base = sigilBase(ctx);
    ctx.save();
    ctx.lineCap = "butt"; ctx.lineJoin = "round";
    if (o.still === true) {
      ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y);
      ctx.globalAlpha = base * 0.4; ctx.strokeStyle = tones.tintS; ctx.lineWidth = live?.small ? 1.2 : 1.6; ctx.stroke();
      ctx.beginPath(); sigilHex(ctx, from.x + dx * 0.5, from.y + dy * 0.5, size);
      ctx.globalAlpha = base * 0.9; ctx.fillStyle = tones.tintS; ctx.fill();
      ctx.restore();
      return true;
    }
    const head = clamp01(sigilNum(t, 1)), time = sigilNum(o.time, 0);
    const show = clamp01(head / 0.06), envelope = Math.sin(Math.PI * head);
    if (live?.wave) {
      const tail = Math.max(0, head - 0.3);
      ctx.setLineDash(SIGIL_DASHES.session); ctx.lineDashOffset = -((time / 55) % SIGIL_PERIODS.session);
      ctx.beginPath(); ctx.moveTo(from.x + dx * tail, from.y + dy * tail); ctx.lineTo(from.x + dx * head, from.y + dy * head);
      ctx.globalAlpha = base * (0.25 + 0.45 * envelope) * show; ctx.strokeStyle = tones.tintS; ctx.lineWidth = live.small ? 1.2 : 1.8; ctx.stroke();
      ctx.setLineDash(SIGIL_NO_DASH);
    }
    const turn = head * TAU * 1.25, cos = Math.cos(turn), sin = Math.sin(turn), gap = size * 2.3 / len;
    ctx.fillStyle = tones.tintS;
    for (let k = sigilNum(o.detail, 3) >= 2 ? 2 : 1; k >= 1; k -= 1) {
      const u = head - k * gap;
      if (u <= 0) continue;
      ctx.beginPath(); sigilHexTurned(ctx, from.x + dx * u, from.y + dy * u, size * (1 - 0.22 * k), cos, sin);
      ctx.globalAlpha = base * (0.7 - 0.25 * k) * show; ctx.fill();
    }
    const hx = from.x + dx * head, hy = from.y + dy * head;
    ctx.beginPath(); sigilHexTurned(ctx, hx, hy, size, cos, sin);
    ctx.globalAlpha = base * show; ctx.fill();
    ctx.globalAlpha = base * 0.9 * show; ctx.strokeStyle = tones.hotS; ctx.lineWidth = 1; ctx.stroke();
    if (live?.packet) {
      ctx.beginPath(); ctx.arc(hx, hy, size * 0.35, 0, TAU);
      ctx.globalAlpha = base * show; ctx.fillStyle = tones.hotS; ctx.fill();
    }
    ctx.restore();
    return true;
  }
  // A landing: a hexagon rings out from the node to 1.8r while six small
  // hexes spark off its edges, turning; on the rail the ring alone.
  function sigilLand(ctx, p, radius, tint, u, o) {
    const k = clamp01(sigilNum(u, 1));
    if (o.still === true || k >= 1) return true;
    const r = radius > 0 ? radius : sigilNum(o.rTo, 0) > 0 ? o.rTo : 8;
    const tones = sigilPaints(ctx, Array.isArray(tint) ? tint : sigilPulseRgb(o.pulse), sigilThemeOf(o));
    const base = sigilBase(ctx), fade = 1 - k;
    ctx.save();
    ctx.lineJoin = "miter";
    ctx.beginPath(); sigilHex(ctx, p.x, p.y, r * (1 + 0.8 * easeOut(k)));
    ctx.globalAlpha = base * 0.85 * fade * fade; ctx.strokeStyle = tones.tintS; ctx.lineWidth = 1.6 - 0.8 * k; ctx.stroke();
    if (o.rail !== true && sigilNum(o.detail, 3) >= 1) {
      const out = r * (1 + 0.7 * easeOut(k)), size = Math.max(1, r * 0.11) * (1 - 0.5 * k);
      const cos = Math.cos(k * Math.PI), sin = Math.sin(k * Math.PI);
      ctx.beginPath();
      for (let j = 0; j < 6; j += 1) sigilHexTurned(ctx, p.x + SIGIL_NORMAL[2 * j] * out, p.y + SIGIL_NORMAL[2 * j + 1] * out, size, cos, sin);
      ctx.globalAlpha = base * 0.85 * fade; ctx.fillStyle = tones.hotS; ctx.fill();
    }
    ctx.restore();
    return true;
  }

  // Labels clear the seal at rest and the lattice and its sweep at work, and
  // the selection's marks (the crown's tips at 1.3; the hover frame, 1.7 at
  // work) as the selection eases in.
  function sigilReach(m) {
    const work = clamp01(sigilNum(m?.work, 0)), sel = clamp01(sigilNum(m?.sel, 0));
    return 1 + Math.max(0.55 * work, sel * (0.3 + 0.4 * work));
  }

  LOOKS.sigil = { speedup: 3, paint: paintSigil, glyph: { scale: 0.52, ringGap: 3.5, ink: sigilGlyphInk }, ring: sigilRing, hubDress: sigilHub, orbit: sigilOrbit, arrival: sigilArrival, select: sigilSelect, wire: sigilWire, surge: sigilSurge, land: sigilLand, reach: sigilReach };

// ===== overlays =====

  // Every overlay dispatcher: the style's hook draws and the caller skips its
  // own legacy drawing (true), or the style has none, or its hook returned
  // false, and the caller draws as before. `o` travels to the hook as given,
  // and the style's name follows as the hook's last argument.

  // The hooks every look shares when it leaves its own null (the free
  // styles' overlays, say); none yet, so each caller keeps its own drawing.
  const OVERLAY_DEFAULTS = { ring: null, hubDress: null, orbit: null, arrival: null, select: null };

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
