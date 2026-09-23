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
  // T0 is the seal and one turning rune tick, T1 three runes and all six
  // cells (out in three steps of opposite pairs, no scan), T2 all six runes
  // with the inner hexagon and the scan, T3 an inner border, the rune
  // engraved in the lit cell and the head's spark. Every paint is a
  // unit-space shape under the node's own transform; the three radials
  // (glow, well, spark) are built once per canvas and tint, and every level
  // eases through globalAlpha.
  const SIGIL_SEAL = 0.98;
  const SIGIL_SIXTH = Math.PI / 3;
  // The lattice: a cell (a pointy-top hexagon, circumradius .27) slides out
  // from under the seal's edge (.85) and locks .29 further out, its inner
  // side .057 off the seal's. The lowest cell point (the bottom vertex of
  // the 60 and 120 degree cells) lies at 1.257, and at 1.309 at the top of
  // easeOutBack's overshoot (1.10); on a big node (r over 13.5) the whole
  // lattice (lock and cell alike) draws in by one factor so that even then
  // no cell reaches more than r + 4.2 px below the centre, clear of the
  // work-left meter at r + 5 (with the half-pixel rim, .3 px of air at the
  // overshoot's peak, a pixel and more once locked).
  const SIGIL_CELL = 0.27;
  const SIGIL_TUCK = 0.85;
  const SIGIL_LOCK = 0.29;
  const SIGIL_DROP = (SIGIL_TUCK + SIGIL_LOCK * 1.1) * Math.sin(Math.PI / 3) + SIGIL_CELL * 1.1;
  const sigilFit = (r) => Math.min(1, (1 + 4.2 / r) / SIGIL_DROP);
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
      tint, edge, deep, hot, ink, rune, accent, halo, light, own,
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
  // With `pairs` (T1) opposite cells move together, so the six come out in
  // three steps (0 and 3, 1 and 4, 2 and 5) and fold back the same way.
  // The two curves are unrelated and the age restarts, so a work that stops
  // before its cells are out (or starts again while they fold) would jump:
  // each record keeps the extents it painted and the time (ms), a cell
  // never folds while the work runs nor comes out while it rests, and it
  // moves at most 1/.10 s out and 1/.16 s in, so any toggle glides (and the
  // first frame of a start eases off its steepest step). A second paint in
  // the same frame holds; a first sight, a gap over 250 ms, a clock running
  // back or reduced motion takes the curves as they are.
  const sigilCellState = new WeakMap();
  function sigilExtents(m, time, active, work, age, still, pairs) {
    for (let k = 0; k < 6; k += 1) {
      const order = pairs ? k % 3 : k;
      SIGIL_CELLS[k] = active ? easeOutBack((age - 0.12 * order) / 0.3) : smooth01((work - 0.15 - 0.09 * order) / 0.35);
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

  // The working cells: six pointy-top cells slide out of the seal's edges
  // along the edge normals and lock at 1.14 (drawn in on a big node, see
  // sigilFit), as far as sigilExtents has them. From T2 the scan's cell wears
  // the second hue and the one it just left fades, and at T3 the struck rune
  // is written into the lit cell, engraved in the body's tone; T1 keeps them
  // plain, one path. Drawn under the seal, so the cells come out of it.
  function sigilCells(ctx, tones, r, detail, base, work, lit, flare, trail, px, rune, engrave) {
    const gain = Math.min(1, work / 0.25);
    const fit = sigilFit(r);
    const scan = detail >= 2;
    const left = sigilSlot(lit - 1);
    const leaving = scan && trail > 0.01 && SIGIL_CELLS[left] > 0.02;
    const lighting = scan && SIGIL_CELLS[lit] > 0.02;
    ctx.lineJoin = "miter";
    for (let pass = 0; pass < 3; pass += 1) {
      if (pass === 1 && !leaving || pass === 2 && !lighting) continue;
      ctx.beginPath();
      let drawn = false;
      for (let k = 0; k < 6; k += 1) {
        const extent = SIGIL_CELLS[k];
        if (extent <= 0.02) continue;
        const mine = pass === 0 ? !(lighting && k === lit) && !(leaving && k === left) : k === (pass === 1 ? left : lit);
        if (!mine) continue;
        const reach = fit * (SIGIL_TUCK + SIGIL_LOCK * extent);
        sigilHex(ctx, SIGIL_NORMAL[2 * k] * reach, SIGIL_NORMAL[2 * k + 1] * reach, fit * SIGIL_CELL * extent);
        drawn = true;
      }
      if (!drawn) continue;
      ctx.globalAlpha = base * gain * 0.95; ctx.fillStyle = tones.deepS; ctx.fill();
      if (pass === 0) {
        ctx.globalAlpha = base * gain * 0.9; ctx.strokeStyle = tones.edgeS; ctx.lineWidth = px; ctx.stroke();
      } else if (pass === 1) {
        // The cell just left fades out of the second hue; where that hue is
        // only the tint risen toward the highlight (aurora, a working mint
        // node) a fading wash of it reads grey, so it cools into the tint.
        ctx.globalAlpha = base * gain * trail * (tones.own ? 0.35 : 0.5); ctx.fillStyle = tones.own ? tones.edgeS : tones.accentS; ctx.fill();
        ctx.globalAlpha = base * gain * 0.9; ctx.strokeStyle = tones.edgeS; ctx.lineWidth = px; ctx.stroke();
      } else {
        ctx.globalAlpha = base * gain * flare * 0.72; ctx.fillStyle = tones.accentS; ctx.fill();
        ctx.globalAlpha = base * gain * (0.55 + 0.45 * flare); ctx.strokeStyle = tones.hotS; ctx.lineWidth = 1.2 * px; ctx.stroke();
      }
    }
    const extent = SIGIL_CELLS[lit], ink = lighting ? engrave * flare * Math.min(1, extent) : 0;
    if (ink > 0.01) {
      // The rune, moved from its ring slot (.69 out) to the cell's centre.
      const reach = fit * (SIGIL_TUCK + SIGIL_LOCK * extent), size = 0.8 * fit * extent, dx = SIGIL_NORMAL[2 * lit], dy = SIGIL_NORMAL[2 * lit + 1];
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
    const step = Math.floor(beat);
    const slot = still ? 0 : sigilSlot(step);
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
    // The rune beside the scan's cell: the ring's slot nearest the cell's
    // direction at the middle of the step, so the struck rune changes only
    // with a new strike, never while the ring turns on through the step (it
    // stays within 44 degrees of its cell: 30, and the 14 the ring turns in
    // half a step).
    const shape0 = Math.floor(seed * 6) % 6;
    const middle = TAU * sigilFrac(((step - seed * 6) * 0.7 + 0.35) / 9 + seed);
    const near = still ? slot : sigilSlot(slot - Math.round(middle / SIGIL_SIXTH));
    if (lattice) sigilExtents(m, n.time, n.active, work, age, still, detail < 2);
    if (lattice && work > 0.02 && detail >= 1) sigilCells(ctx, tones, r, detail, base, work, slot, flare, trail, px, (near + shape0) % 6, detail >= 3 ? tierIn(r, 3) : 0);
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
      // T0: one rune tick turning with the ring, in the state's own hue
      // risen toward the highlight (the one mark that moves carries the
      // state), and a centre dot.
      const angle = ring - Math.PI / 2, cos = Math.cos(angle), sin = Math.sin(angle);
      ctx.beginPath(); ctx.moveTo(cos * 0.42, sin * 0.42); ctx.lineTo(cos * 0.82, sin * 0.82);
      ctx.globalAlpha = base * 0.9; ctx.strokeStyle = tones.hotS; ctx.lineWidth = px; ctx.stroke();
      if (!n.glyph) {
        ctx.beginPath(); ctx.arc(0, 0, 0.26, 0, TAU);
        ctx.globalAlpha = base * 0.9; ctx.fillStyle = tones.edgeS; ctx.fill();
      }
    } else {
      const odd = detail >= 2 ? tierIn(r, 2) : 0;
      // Round an agent's glyph or the hub's monogram the resting runes stay
      // faint and the head strikes without its spark: the glyph leads.
      const dim = Math.min(1, 0.66 + 0.22 * lit + 0.35 * kick) * (n.glyph ? 0.55 : 1);
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
      const spark = detail >= 3 && !n.glyph ? tierIn(r, 3) * Math.max(restHead, workHead) * 0.8 : 0;
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
  // crew's ring is a flat-top hexagon (its sides touch the legacy 3.1r
  // circle, a corner toward each cell) cut in the rune rhythm.
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
      ctx.beginPath(); sigilFlatHex(ctx, p.x, p.y, radius * 3.1 * SIGIL_ORBIT_OUT);
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
    // Big enough to read as hexes (6 px corner to corner at r 12), and edged.
    const out = 1 + 0.85 * easeOut(u), size = 0.27 * (1 - 0.3 * u), cos = Math.cos(u * Math.PI), sin = Math.sin(u * Math.PI);
    ctx.beginPath();
    for (let k = 0; k < 6; k += 1) sigilHexTurned(ctx, SIGIL_HEX[2 * k] * out, SIGIL_HEX[2 * k + 1] * out, size, cos, sin);
    ctx.globalAlpha = alpha * 0.9 * fade; ctx.fillStyle = tones.accentS; ctx.fill();
    ctx.globalAlpha = alpha * 0.6 * fade; ctx.strokeStyle = tones.hotS; ctx.lineWidth = 1 / radius; ctx.stroke();
    ctx.restore();
    return true;
  }

  // Hover: a hexagon at 1.2 in the whitened tint, breathing a little. While
  // the cells are out it opens to 1.7 and turns flat-top (30 degrees round),
  // a frame round the honeycomb, clear of the cells and inside the orbit's
  // track; on a chosen node it gives way to the crown there. Chosen: the six
  // points of a hexagram at 1.3 in the theme's second hue, turning once in
  // 20 s; while the node works the turn eases off and the crown settles with
  // every point in a gap between two cells, so it never crosses them, and
  // breathes there with the scan (a small node keeps a second hexagon
  // instead, opening like the hover's and breathing inward).
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
      // The crown breathes with the scan (a breath a circuit: 1.4 s at work),
      // its tips between 1.235 and 1.365 once settled, still in the gaps; a
      // small node's hexagon breathes inward. The clock is the record's.
      const breathe = still ? 0 : Math.sin(TAU * sigilFrac(sigilNum(m?.clock, time / 1000) / 4.2 + seed));
      if (detail >= 2) {
        const swell = radius * (1 + 0.05 * work * breathe);
        ctx.rotate(still ? 0 : sigilCrownTurn(m, time, seed, work));
        ctx.scale(swell, swell);
        ctx.beginPath();
        for (let k = 0; k < 6; k += 1) {
          ctx.moveTo(SIGIL_CROWN[k * 6], SIGIL_CROWN[k * 6 + 1]);
          ctx.lineTo(SIGIL_CROWN[k * 6 + 2], SIGIL_CROWN[k * 6 + 3]);
          ctx.lineTo(SIGIL_CROWN[k * 6 + 4], SIGIL_CROWN[k * 6 + 5]);
        }
        ctx.lineWidth = 1.6 / swell; ctx.stroke();
      } else {
        ctx.beginPath(); sigilHexTurned(ctx, 0, 0, radius * (1.32 + 0.38 * work) * (1 - 0.015 * (1 + breathe)), cos, sin);
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

  // The wire hooks every look shares when it leaves its own null: the free
  // styles' wires, travelling pulses and landings (a Void look brings its
  // own; one that wants the caller's plain drawing sets () => false).
  //
  // A style's feel is its row of WIRE_PACKS (a style without a row borrows
  // the orbs'):
  //   glow, glowAlpha    the soft glow under a lit wire: px over the wire's
  //                      width, and its alpha
  //   flow               what runs along a wire that carries work: a comet
  //                      (orbs; halo's rides in a soft bead), a glass sheen,
  //                      a bead (minimal) or a pair of crystal sparks
  //   share, least, most its length: a share of the wire, clamped (px)
  //   speed, flowAlpha, flowWidth   px/s, alpha, px over the wire's width
  //   headWidth          a comet head's px over the flow's width
  //   spark, sparkAlpha  the soft light round its head: radius (0: none)
  //                      and its share of the flow's alpha
  //   head, landing      how a pulse's head and its landing look
  const FLOW_COMET = 1, FLOW_HALO = 2, FLOW_SHEEN = 3, FLOW_BEAD = 4, FLOW_SPARKS = 5;
  const HEAD_ORB = 1, HEAD_SOFT = 2, HEAD_FLAT = 3, HEAD_RING = 4, HEAD_GLINT = 5;
  const LAND_BLOOM = 1, LAND_SOFT = 2, LAND_RING = 3, LAND_DOUBLE = 4, LAND_RAYS = 5;
  const WIRE_PACKS = Object.freeze(Object.assign(Object.create(null), {
    orbs: Object.freeze({ glow: 2.8, glowAlpha: 0.24, flow: FLOW_COMET, share: 0.16, least: 10, most: 34, speed: 95, flowAlpha: 0.7, flowWidth: 0.6, headWidth: 1.6, spark: 7, sparkAlpha: 0.7, head: HEAD_ORB, landing: LAND_BLOOM }),
    glass: Object.freeze({ glow: 3.4, glowAlpha: 0.19, flow: FLOW_SHEEN, share: 0.24, least: 14, most: 48, speed: 70, flowAlpha: 0.42, flowWidth: 1.2, headWidth: 0, spark: 0, sparkAlpha: 0, head: HEAD_SOFT, landing: LAND_SOFT }),
    minimal: Object.freeze({ glow: 0, glowAlpha: 0, flow: FLOW_BEAD, share: 0, least: 0.01, most: 0.01, speed: 60, flowAlpha: 0.95, flowWidth: 2.2, headWidth: 0, spark: 0, sparkAlpha: 0, head: HEAD_FLAT, landing: LAND_RING }),
    halo: Object.freeze({ glow: 3.4, glowAlpha: 0.28, flow: FLOW_HALO, share: 0.18, least: 12, most: 40, speed: 120, flowAlpha: 0.75, flowWidth: 0.8, headWidth: 1.2, spark: 9, sparkAlpha: 0.55, head: HEAD_RING, landing: LAND_DOUBLE }),
    crystal: Object.freeze({ glow: 2.4, glowAlpha: 0.22, flow: FLOW_SPARKS, share: 0, least: 10.5, most: 10.5, speed: 105, flowAlpha: 0.8, flowWidth: 0.6, headWidth: 0, spark: 5, sparkAlpha: 0.55, head: HEAD_GLINT, landing: LAND_RAYS }),
  }));
  const packOf = (style) => WIRE_PACKS[style] ?? WIRE_PACKS.orbs;
  // No wire stroke is wider than this (the dense-graph budget).
  const WIRE_MAX = 5;
  // Dash patterns: shared, or one scratch refilled per stroke (setLineDash
  // copies what it is given), so a wire allocates nothing.
  const NO_DASH = Object.freeze([]);
  const FLOW_DASH = [0, 0];
  const SPARK_DASH = [3, 6, 1.5, 0];
  const SPARK_SPAN = 10.5;

  // One path scratch serves the wire or pulse being drawn: a quadratic (a
  // straight line is one with its control at the middle; a pulse's bow moves
  // that control off the chord) or a cubic through the tree's S-curve
  // controls. pathMeasure fills ARC with the length along it over ARC_STEPS
  // chords, so pathAlong can find a point by distance (a flow's head).
  const PATH = { straight: true, cubic: false, x0: 0, y0: 0, x1: 0, y1: 0, x2: 0, y2: 0, x3: 0, y3: 0, len: 0 };
  const PATH_AT = { x: 0, y: 0 }, PATH_C1 = { x: 0, y: 0 }, PATH_C2 = { x: 0, y: 0 };
  const ARC_STEPS = 8;
  const ARC = new Float64Array(ARC_STEPS + 1);
  // from → to bowed `bow` px off the chord, or along `cp` bowed alike.
  function pathSet(from, to, bow, cp) {
    const path = PATH;
    const dx = to.x - from.x, dy = to.y - from.y, len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * bow, ny = (dx / len) * bow;
    path.x0 = from.x; path.y0 = from.y; path.x3 = to.x; path.y3 = to.y;
    path.cubic = Boolean(cp);
    path.straight = !cp && bow === 0;
    if (cp) {
      path.x1 = cp.x1 + nx * (2 / 3); path.y1 = cp.y1 + ny * (2 / 3);
      path.x2 = cp.x2 + nx * (2 / 3); path.y2 = cp.y2 + ny * (2 / 3);
    } else {
      path.x1 = (from.x + to.x) / 2 + nx; path.y1 = (from.y + to.y) / 2 + ny;
    }
    path.len = len;
    return path;
  }
  // The path's blossom (polar form) at (u, v, w) into `out`: (u, u, u) is the
  // point at u; the piece over [u0, u1] has the controls (u0, u0, u1) and
  // (u0, u1, u1), a quadratic's one control (u0, u1) (w unused).
  function pathBlossom(path, u, v, w, out) {
    const iu = 1 - u, iv = 1 - v;
    if (path.cubic) {
      const iw = 1 - w;
      const k0 = iu * iv * iw, k1 = iu * iv * w + iu * v * iw + u * iv * iw, k2 = iu * v * w + u * iv * w + u * v * iw, k3 = u * v * w;
      out.x = k0 * path.x0 + k1 * path.x1 + k2 * path.x2 + k3 * path.x3;
      out.y = k0 * path.y0 + k1 * path.y1 + k2 * path.y2 + k3 * path.y3;
    } else {
      const k0 = iu * iv, k1 = iu * v + u * iv, k2 = u * v;
      out.x = k0 * path.x0 + k1 * path.x1 + k2 * path.x3;
      out.y = k0 * path.y0 + k1 * path.y1 + k2 * path.y3;
    }
    return out;
  }
  // The piece of the path over [u0, u1] as one subpath of the current path.
  function pathPiece(ctx, path, u0, u1) {
    const start = pathBlossom(path, u0, u0, u0, PATH_AT);
    ctx.moveTo(start.x, start.y);
    if (path.cubic) {
      pathBlossom(path, u0, u0, u1, PATH_C1);
      pathBlossom(path, u0, u1, u1, PATH_C2);
      const end = pathBlossom(path, u1, u1, u1, PATH_AT);
      ctx.bezierCurveTo(PATH_C1.x, PATH_C1.y, PATH_C2.x, PATH_C2.y, end.x, end.y);
    } else {
      pathBlossom(path, u0, u1, 0, PATH_C1);
      const end = pathBlossom(path, u1, u1, 0, PATH_AT);
      ctx.quadraticCurveTo(PATH_C1.x, PATH_C1.y, end.x, end.y);
    }
  }
  // The path's length (exact for a line; eight chords for a curve).
  function pathMeasure(path) {
    if (path.straight) return path.len;
    let x = path.x0, y = path.y0, total = 0;
    ARC[0] = 0;
    for (let step = 1; step <= ARC_STEPS; step += 1) {
      const u = step / ARC_STEPS;
      const at = pathBlossom(path, u, u, u, PATH_AT);
      total += Math.hypot(at.x - x, at.y - y);
      ARC[step] = total;
      x = at.x; y = at.y;
    }
    path.len = total;
    return total;
  }
  // The point `s` px along a measured path, into `out`.
  function pathAlong(path, s, out) {
    let u;
    if (path.straight || !(path.len > 0)) u = path.len > 0 ? s / path.len : 0;
    else {
      let step = 1;
      while (step < ARC_STEPS && ARC[step] < s) step += 1;
      const piece = ARC[step] - ARC[step - 1];
      u = (step - 1 + (piece > 0 ? (s - ARC[step - 1]) / piece : 0)) / ARC_STEPS;
    }
    u = clamp01(u);
    return pathBlossom(path, u, u, u, out);
  }

  // Soft light: a unit radial in one tone, drawn under translate·scale as a
  // disc. It stands in for the glow shadowBlur gave. The sprites live in the
  // canvas's node paint cache (cacheGet/cachePut) under `wire|light|r,g,b`:
  // keyed by value, so equal triples share one, and with no alpha, time or
  // radius in the key, so once a tone's sprite exists nothing is built per
  // frame. Each triple remembers its key, so a frame builds no strings.
  const lightKeys = new WeakMap();
  function lightKey(tone) {
    let key = lightKeys.get(tone);
    if (key === undefined) { key = `wire|light|${tone.join(",")}`; lightKeys.set(tone, key); }
    return key;
  }
  function lightSprite(ctx, tone) {
    const key = lightKey(tone);
    let sprite = cacheGet(ctx, key);
    if (sprite === undefined) {
      if (typeof ctx.createRadialGradient === "function") {
        sprite = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        sprite.addColorStop(0, rgba(tone, 0.85));
        sprite.addColorStop(0.18, rgba(tone, 0.5));
        sprite.addColorStop(0.45, rgba(tone, 0.15));
        sprite.addColorStop(1, rgba(tone, 0));
      } else sprite = rgba(tone, 0.2);
      cachePut(ctx, key, sprite);
    }
    return sprite;
  }
  // The sprite as a disc `radius` px round at (x, y), at globalAlpha `alpha`.
  function lightAt(ctx, tone, x, y, radius, alpha) {
    if (!(alpha > 0.004) || !(radius > 0)) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.translate(x, y);
    ctx.scale(radius, radius);
    ctx.fillStyle = lightSprite(ctx, tone);
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  // A light ground's tones that keep a tint's hue (inkOf's hot/spec sink
  // most of the way to the near-black highlight there and turn every tint
  // grey): `line` is the tint itself, deepened toward the highlight only as
  // far as a pale tint needs to read on the pale ground (luma WIRE_LIGHT_GAP
  // under the background's; the cream pulse colours need it, a saturated
  // wire tint does not), and `deep` is the tint .35 of the way to the
  // highlight (or .15 past the line's own lift), for heads, cores and
  // glints: darker than the line, and still more than half as colourful as
  // the tint. Cached per triple and rebuilt when the theme changes, like
  // inkOf, so a frame allocates nothing.
  const WIRE_LIGHT_GAP = 72;
  const wireLuma = (tone) => 0.2126 * tone[0] + 0.7152 * tone[1] + 0.0722 * tone[2];
  const wireLightTones = new WeakMap();
  function wireLightTone(tint, currentTheme) {
    let record = wireLightTones.get(tint);
    if (record && record.key === currentTheme.key) return record;
    const own = wireLuma(tint), floor = wireLuma(currentTheme.hi), ceiling = wireLuma(currentTheme.bg) - WIRE_LIGHT_GAP;
    const lift = own > ceiling && own > floor ? Math.min(0.6, (own - ceiling) / (own - floor)) : 0;
    const line = lift > 0 ? Object.freeze(mix(tint, currentTheme.hi, lift)) : tint;
    record = { key: currentTheme.key, line, deep: Object.freeze(mix(tint, currentTheme.hi, Math.max(0.35, lift + 0.15))) };
    wireLightTones.set(tint, record);
    return record;
  }

  // One repeat of a dash pattern (an odd list repeats twice over).
  function dashPeriod(dash) {
    let sum = 0;
    for (let index = 0; index < dash.length; index += 1) sum += dash[index];
    return dash.length % 2 ? sum * 2 : sum;
  }
  // How much of a tier's extras a wire shows: all above that tier, none below,
  // fading in over the tier's first 1.2 px at it (by the thinner end's radius;
  // all of them when no radius is known).
  function wireTier(detail, radius, level) {
    if (detail > level) return 1;
    if (detail < level) return 0;
    return radius > 0 ? tierIn(radius, level) : 1;
  }
  // The wire's path, begun afresh: the line, or the S-curve through `cp`.
  function wireTrace(ctx, a, b, cp) {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    if (cp) ctx.bezierCurveTo(cp.x1, cp.y1, cp.x2, cp.y2, b.x, b.y);
    else ctx.lineTo(b.x, b.y);
  }
  // One flow stroke over the traced path: a single dash `length` px long whose
  // leading end sits `head` px along the wire, repeating every `period` px.
  function flowStroke(ctx, length, period, head, width, alpha) {
    if (!(alpha > 0.002)) return;
    FLOW_DASH[0] = length;
    FLOW_DASH[1] = Math.max(0.01, period - length);
    ctx.setLineDash?.(FLOW_DASH);
    ctx.lineDashOffset = length - head;
    ctx.lineWidth = Math.min(WIRE_MAX, width);
    ctx.globalAlpha = alpha;
    ctx.stroke();
  }

  // A four-point sparkle round (x, y) as one closed subpath: long arms `arm`
  // px along (c, s), short ones at .45 of that across, pinched to a thin
  // waist between them, so it reads as a glint and never as a cross mark.
  // `c`, `s` are the turn's cosine and sine; the caller begins and fills.
  function wireSparkle(ctx, x, y, arm, c, s) {
    const short = arm * 0.45, waist = arm * 0.1;
    ctx.moveTo(x + c * arm, y + s * arm);
    ctx.lineTo(x + (c - s) * waist, y + (s + c) * waist);
    ctx.lineTo(x - s * short, y + c * short);
    ctx.lineTo(x - (c + s) * waist, y + (c - s) * waist);
    ctx.lineTo(x - c * arm, y - s * arm);
    ctx.lineTo(x - (c - s) * waist, y - (s + c) * waist);
    ctx.lineTo(x + s * short, y - c * short);
    ctx.lineTo(x + (c + s) * waist, y - (c - s) * waist);
    ctx.closePath();
  }

  // The flow along a wire that carries work. It moves `speed`·`pace` px/s
  // from a to b (the wire's seed staggers it) and repeats every `period` px,
  // so a long wire carries more than one; reduced motion holds it just past
  // the middle. Every stroke is one dash along the traced path, so it
  // follows the curve exactly. Tiers: the head always, the body and the
  // head's light from T1, the tail, the halo bead and the crystal glint from
  // T2. On a light theme the flow keeps the tint's hue (wireLightTone: the
  // body in the tint, heads, beads and sparks in its deeper tone, glass's
  // glint a white core in a tinted band) and the heads carry no light.
  function wireFlow(ctx, a, b, cp, pack, tint, currentTheme, width, gain, detail, thin, seed, time, still, pace) {
    const path = pathSet(a, b, 0, cp);
    const len = pathMeasure(path);
    if (!(len > 4)) return;
    const span = pack.flow === FLOW_SPARKS ? SPARK_SPAN : Math.min(pack.most, Math.max(pack.least, pack.share * len));
    const period = Math.max(span + 24, Math.min(len + span + Math.max(16, len * 0.12), 240));
    const travel = still ? 0.62 * len + 0.5 * span : (time / 1000) * pack.speed * pace + seed * period;
    const head = ((travel % period) + period) % period;
    const light = currentTheme.light === true;
    // bodyInk: a comet's tail and body; headInk: heads, beads and sparks
    let bodyInk, headInk, frost = null;
    if (light) { const tones = wireLightTone(tint, currentTheme); bodyInk = tones.line; headInk = tones.deep; }
    else { const tones = inkOf(tint, currentTheme); bodyInk = tones.hot; headInk = tones.spec; frost = tones.frost; }
    const alpha = gain * pack.flowAlpha;
    const body = wireTier(detail, thin, 1), tail = wireTier(detail, thin, 2);
    const extra = pack.flowWidth;
    // The soft light round each head on the wire, under the strokes.
    if (pack.spark > 0 && body > 0 && !light) {
      for (let at = head; at <= len; at += period) {
        const point = pathAlong(path, at, PATH_AT);
        lightAt(ctx, tint, point.x, point.y, pack.spark, alpha * pack.sparkAlpha * body);
      }
      wireTrace(ctx, a, b, cp);
    }
    if (pack.flow === FLOW_COMET || pack.flow === FLOW_HALO) {
      // A comet: a long faint tail, a brighter body, then a round head in the
      // highlight tone (halo's also rides in a wide soft bead of the tint).
      ctx.strokeStyle = rgba(bodyInk, 1);
      if (tail > 0) flowStroke(ctx, span, period, head, width + extra * 0.5, alpha * 0.42 * tail);
      if (body > 0) flowStroke(ctx, span * 0.45, period, head, width + extra * 0.85, alpha * 0.8 * body);
      if (pack.flow === FLOW_HALO && tail > 0) {
        ctx.strokeStyle = rgba(light ? bodyInk : tint, 1);
        flowStroke(ctx, 0.01, period, head, width + extra + 3.2, alpha * 0.34 * tail);
      }
      ctx.strokeStyle = rgba(headInk, 1);
      flowStroke(ctx, 0.01, period, head, width + extra + pack.headWidth, alpha);
    } else if (pack.flow === FLOW_SHEEN) {
      // A sheen: a long soft band of frost with a brighter core in its
      // middle, light gliding through a glass tube. On a light ground frost
      // would be a dark smear: the band is the tint, the core white.
      if (light) {
        ctx.strokeStyle = rgba(bodyInk, 1);
        flowStroke(ctx, span, period, head, width + extra, gain * 0.55);
        ctx.strokeStyle = rgba(WHITE, 1);
        if (body > 0) flowStroke(ctx, span * 0.4, period, head - span * 0.3, width + 0.3, Math.min(1, gain * 0.9 * body));
      } else {
        ctx.strokeStyle = rgba(frost, 1);
        flowStroke(ctx, span, period, head, width + extra, alpha * 0.55);
        if (body > 0) flowStroke(ctx, span * 0.4, period, head - span * 0.3, width + extra * 0.3, Math.min(1, alpha * 1.4 * body));
      }
    } else if (pack.flow === FLOW_BEAD) {
      // A bead: one round dot well over the line's width, in the highlight
      // tone (pale on a dark ground, the tint's deep tone on a light one),
      // and no light.
      ctx.strokeStyle = rgba(headInk, 1);
      flowStroke(ctx, 0.01, period, head, width + extra, alpha);
    } else {
      // Twin sparks (3 px, a gap, 1.5 px) in the highlight tone, twinkling;
      // from T2 a faint tinted light travels with them and the leading spark
      // throws a small turning sparkle.
      const twinkle = still ? 1 : 0.78 + 0.22 * Math.sin(TAU * (time / 700 + seed));
      if (tail > 0) {
        ctx.strokeStyle = rgba(light ? bodyInk : tint, 1);
        flowStroke(ctx, SPARK_SPAN, period, head, width + extra + 2.2, alpha * 0.24 * tail);
      }
      SPARK_DASH[3] = Math.max(0.01, period - SPARK_SPAN);
      ctx.setLineDash?.(SPARK_DASH);
      ctx.lineDashOffset = SPARK_SPAN - head;
      ctx.strokeStyle = rgba(headInk, 1);
      ctx.lineWidth = Math.min(WIRE_MAX, width + extra);
      ctx.globalAlpha = alpha * twinkle;
      ctx.stroke();
      if (tail > 0) {
        const turn = still ? Math.PI / 4 : (time / 1000) * 1.7 + seed * TAU;
        const arm = (3 + 1.4 * twinkle) * tail, c = Math.cos(turn), s = Math.sin(turn);
        ctx.fillStyle = rgba(headInk, 1);
        ctx.globalAlpha = alpha * twinkle * tail;
        ctx.beginPath();
        for (let at = head - 0.75; at <= len; at += period) {
          if (at < 0) continue;
          const point = pathAlong(path, at, PATH_AT);
          wireSparkle(ctx, point.x, point.y, arm, c, s);
        }
        ctx.fill();
      }
    }
  }

  // The free styles' wire: the caller's line, stroked ONCE exactly as asked
  // (its tint, alpha, width, dash and march), with round caps. A lit wire
  // (active or inspected) lays a soft glow under it that breathes (two wide
  // faint strokes from T2, one below), and an active wire carrying work
  // (o.flow; o.march for a caller without it) runs the style's flow over it:
  // a session or todo wire (a hop on the way to the work) at .7 of the pace
  // and .6 of the alpha, so the task's own wire stays the brightest. The far
  // (blurred) pen gets the line alone. The context comes back as it was.
  function wireDefault(ctx, a, b, o, style) {
    const tint = o.tint;
    if (!tint || !a || !b) return false;
    const pack = packOf(style);
    const alpha = Number.isFinite(o.alpha) ? clamp01(o.alpha) : 1;
    const width = Math.min(WIRE_MAX, o.width > 0 ? o.width : 1);
    const time = Number.isFinite(o.time) ? o.time : 0, still = o.still === true;
    const lifetime = Number.isFinite(o.lifetime) ? clamp01(o.lifetime) : 1;
    const detail = Number.isFinite(o.detail) ? o.detail : 3;
    const seed = Number.isFinite(o.seed) ? o.seed : 0;
    const thin = o.rA > 0 && o.rB > 0 ? Math.min(o.rA, o.rB) : o.rA > 0 ? o.rA : o.rB > 0 ? o.rB : 0;
    const double = o.double === true, cp = double ? null : o.cp ?? null;
    const near = o.far !== true;
    const lit = near && pack.glow > 0 && (o.active === true || o.inspected === true);
    const carries = typeof o.flow === "boolean" ? o.flow : o.march === true;
    const flows = near && !double && o.active === true && carries;
    const relay = o.kind === "session" || o.kind === "todo";
    const base = ctx.globalAlpha;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = rgba(tint, 1);
    if (lit) {
      const breath = still ? 0.5 : 0.5 + 0.5 * Math.sin(TAU * (time / 2600 + seed));
      // (the rail's hair-thin, crowded lines take a narrower, fainter glow)
      const railed = o.rail === true;
      const glow = base * lifetime * pack.glowAlpha * (o.active === true ? 1 : 0.6) * (0.55 + 0.45 * breath) * (railed ? 0.8 : 1);
      const spread = (double ? pack.glow + 3.2 : pack.glow) * (railed ? 0.7 : 1);
      const outer = wireTier(detail, thin, 2);
      wireTrace(ctx, a, b, cp);
      ctx.setLineDash?.(NO_DASH);
      if (outer > 0) {
        ctx.globalAlpha = glow * 0.5 * outer;
        ctx.lineWidth = Math.min(WIRE_MAX, width + spread);
        ctx.stroke();
      }
      ctx.globalAlpha = glow * (0.8 + 0.2 * (1 - outer));
      ctx.lineWidth = Math.min(WIRE_MAX, width + spread * (0.45 + 0.25 * (1 - outer)));
      ctx.stroke();
    }
    if (double) {
      // The hub link: two parallel lines 3.2 px apart, one stroke.
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * 1.6, ny = (dx / len) * 1.6;
      ctx.beginPath();
      ctx.moveTo(a.x + nx, a.y + ny); ctx.lineTo(b.x + nx, b.y + ny);
      ctx.moveTo(a.x - nx, a.y - ny); ctx.lineTo(b.x - nx, b.y - ny);
    } else if (!lit) wireTrace(ctx, a, b, cp);
    const dash = o.dash && o.dash.length ? o.dash : NO_DASH;
    const period = o.march === true && !still ? dashPeriod(dash) : 0;
    ctx.setLineDash?.(dash);
    // The dashes march toward b (a tether's faster), as the plain lines did.
    ctx.lineDashOffset = period > 0 ? -((time / (o.kind === "tether" ? 40 : 60)) % period) : 0;
    ctx.globalAlpha = base * alpha;
    ctx.lineWidth = width;
    ctx.stroke();
    if (flows) wireFlow(ctx, a, b, cp, pack, tint, o.theme ?? INK_DEFAULTS, width, base * lifetime * (relay ? 0.6 : 1), detail, thin, seed, time, still, relay ? 0.7 : 1);
    ctx.restore();
    return true;
  }

  // Travelling pulses (surge) and their landings (land). A pulse's tail is
  // drawn as pieces of its own path at rising alpha toward the head (the piece
  // over [u0, u1] of a quadratic or a cubic is one again, by de Casteljau),
  // and soft light sprites stand in for shadowBlur. A wave pulse bows its
  // line like a plucked string; a dot runs the line as it is; either rides
  // the tree's S-curve when the caller hands its controls (o.cp). The head
  // is the style's own (a hot orb; glass's softer; minimal's flat; halo's
  // ringed; crystal's a turning glint), and over the last fifth a bloom opens
  // on the receiving node, which land carries on after arrival. On a light
  // theme the pulse keeps its hue (wireLightTone: the line in the colour,
  // deepened only as far as a cream pulse needs to read, the core and head
  // in its deeper tone) and its light is a fainter haze of the colour, never
  // a dark one. Reduced motion: one static flash.
  const PULSE_DEFAULT = "#a9ffcd";
  const BLOOM_ALPHA = 0.55;
  // A tail behind its head in path fractions (stops from far to near), and
  // each piece's alpha and share of the head's width.
  const WAVE_TAIL = Object.freeze([0.45, 0.27, 0.14, 0.055, 0]);
  const WAVE_TAIL_ALPHA = Object.freeze([0.1, 0.24, 0.48, 0.85]);
  const WAVE_TAIL_WIDTH = Object.freeze([0.45, 0.62, 0.8, 1]);
  const DOT_TAIL = Object.freeze([0.2, 0.11, 0.045, 0]);
  const DOT_TAIL_ALPHA = Object.freeze([0.2, 0.42, 0.7]);
  const DOT_TAIL_WIDTH = Object.freeze([0.6, 0.8, 1]);

  // A pulse colour ("#rgb"/"#rrggbb") as one stable triple per string.
  const pulseTones = new Map();
  function pulseTone(color) {
    const key = typeof color === "string" ? color : PULSE_DEFAULT;
    let tone = pulseTones.get(key);
    if (!tone) {
      if (pulseTones.size >= 64) pulseTones.clear();
      tone = parseHex(key) ?? parseHex(PULSE_DEFAULT);
      pulseTones.set(key, tone);
    }
    return tone;
  }
  // The arrival bloom's radius on the receiving node; the rail's small
  // nodes take a smaller one at .6 of the light (RAIL_BLOOM).
  const bloomRadius = (radius, rail) => Math.max(rail ? 8 : 14, radius + (rail ? 5 : 9));
  const RAIL_BLOOM = 0.6;

  // The tail: one piece per stop pair, fainter and thinner away from the head
  // at u (butt caps, so neighbouring pieces never double up); below T2, or
  // for a flat head, only the two nearest it.
  function pulseTail(ctx, path, u, stops, alphas, widths, width, gain, short) {
    const pieces = alphas.length;
    ctx.lineCap = "butt";
    for (let index = short ? Math.max(0, pieces - 2) : 0; index < pieces; index += 1) {
      const u1 = u - stops[index + 1];
      if (u1 <= 0.001) continue;
      ctx.beginPath();
      pathPiece(ctx, path, Math.max(0, u - stops[index]), u1);
      ctx.globalAlpha = gain * alphas[index];
      ctx.lineWidth = width * widths[index];
      ctx.stroke();
    }
    ctx.lineCap = "round";
  }
  // A pulse's head at (x, y) in the style's way: `size` is the core's radius,
  // `alpha` the head's globalAlpha; `line`, `core` and `light` the pulse's
  // stroke, centre and light tones; `turn` spins a glint.
  function pulseHead(ctx, pack, x, y, size, alpha, line, core, light, lightAlpha, turn) {
    if (pack.head !== HEAD_FLAT) {
      const soft = pack.head === HEAD_SOFT;
      lightAt(ctx, light, x, y, size * (soft ? 4.4 : pack.head === HEAD_GLINT ? 2.8 : 3.3), alpha * lightAlpha * (soft ? 0.8 : 1));
    }
    ctx.globalAlpha = alpha;
    if (pack.head === HEAD_GLINT) {
      // A small diamond and a sparkle turning over it.
      ctx.fillStyle = rgba(line, 1);
      ctx.beginPath();
      ctx.moveTo(x, y - size * 1.2); ctx.lineTo(x + size * 0.85, y); ctx.lineTo(x, y + size * 1.2); ctx.lineTo(x - size * 0.85, y);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = rgba(core, 1);
      ctx.beginPath();
      wireSparkle(ctx, x, y, size * 2.6, Math.cos(turn), Math.sin(turn));
      ctx.fill();
      return;
    }
    ctx.fillStyle = rgba(pack.head === HEAD_FLAT ? line : core, 1);
    ctx.beginPath();
    ctx.arc(x, y, pack.head === HEAD_SOFT ? size * 0.8 : size, 0, TAU);
    ctx.fill();
    if (pack.head === HEAD_ORB || pack.head === HEAD_RING) {
      // the colour round a hot centre
      ctx.strokeStyle = rgba(line, 1);
      ctx.lineWidth = Math.max(0.6, size * 0.45);
      ctx.stroke();
    }
    if (pack.head === HEAD_RING) {
      ctx.globalAlpha = alpha * 0.7;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(x, y, size * 2.3, 0, TAU);
      ctx.stroke();
    }
  }

  // The free styles' travelling pulse (t runs 0 → 1 from `from` to `to`).
  function surgeDefault(ctx, from, to, t, pulse, o, style) {
    if (!pulse || !from || !to) return false;
    const len = Math.hypot(to.x - from.x, to.y - from.y);
    // Not under way yet, or nowhere to go: nothing to draw.
    if (!(t >= 0) || len < 2) return true;
    const u = t >= 1 ? 1 : t;
    const pack = packOf(style);
    const currentTheme = o.theme ?? INK_DEFAULTS, light = currentTheme.light === true;
    const tone = pulse._rgb ?? (pulse._rgb = pulseTone(pulse.color));
    let line, core;
    if (light) { const tones = wireLightTone(tone, currentTheme); line = tones.line; core = tones.deep; }
    else { line = tone; core = inkOf(tone, currentTheme).hot; }
    const glow = typeof pulse.glow === "string" ? pulseTone(pulse.glow) : tone;
    const lightAlpha = light ? 0.45 : 1;
    const cp = o.cp ?? null;
    const detail = Number.isFinite(o.detail) ? o.detail : 3;
    const rTo = o.rTo > 0 ? o.rTo : 0;
    const rail = o.rail === true;
    const bloom = bloomRadius(rTo, rail), bloomAlpha = BLOOM_ALPHA * lightAlpha * (rail ? RAIL_BLOOM : 1);
    const base = ctx.globalAlpha;
    const blooms = pack.landing !== LAND_RING;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.setLineDash?.(NO_DASH);
    ctx.strokeStyle = rgba(line, 1);
    if (o.still === true) {
      // One static flash of the whole line and the bloom it lands in (the
      // rail keeps drawing a pulse's frames, so there it fades with its life).
      // On a light ground the deeper line is a fainter, finer trace.
      const fade = rail ? 1 - u : 1;
      ctx.beginPath();
      pathPiece(ctx, pathSet(from, to, 0, cp), 0, 1);
      ctx.globalAlpha = base * (light ? 0.3 : 0.5) * fade;
      ctx.lineWidth = pulse.small ? (light ? 1.1 : 1.3) : light ? 1.5 : 2;
      ctx.stroke();
      if (blooms) lightAt(ctx, glow, to.x, to.y, bloom, base * bloomAlpha * 0.6 * fade);
      ctx.restore();
      return true;
    }
    const short = detail < 2 || pack.head === HEAD_FLAT;
    const turn = u * Math.PI * 1.5;
    if (pulse.wave === true || o.kind === "wave") {
      // The line bows like a plucked string, warms along its length, and a
      // bright head with a long tail runs it; a packet rides the head as a
      // small turning diamond (a finding coming home).
      const env = Math.sin(Math.PI * u);
      const path = pathSet(from, to, env * Math.min(rail ? 13 : 14, len * 0.12), cp);
      ctx.beginPath();
      pathPiece(ctx, path, 0, 1);
      ctx.globalAlpha = base * 0.28 * env;
      ctx.lineWidth = pulse.small ? 1.3 : 1.9;
      ctx.stroke();
      pulseTail(ctx, path, u, WAVE_TAIL, WAVE_TAIL_ALPHA, WAVE_TAIL_WIDTH, pulse.packet ? 3.4 : pulse.small ? 1.8 : 2.7, base * env, short);
      const at = pathBlossom(path, u, u, u, PATH_AT);
      const hx = at.x, hy = at.y;
      if (pulse.packet) {
        const size = 4.5 * env + 2;
        if (pack.head !== HEAD_FLAT) lightAt(ctx, glow, hx, hy, 9, base * 0.85 * env * lightAlpha);
        ctx.save();
        ctx.translate(hx, hy);
        ctx.rotate(Math.PI / 4 + u * Math.PI / 2);
        ctx.globalAlpha = base * 0.92 * env;
        ctx.fillStyle = rgba(line, 1);
        ctx.fillRect(-size / 2, -size / 2, size, size);
        ctx.fillStyle = rgba(core, 1);
        ctx.fillRect(-size / 5, -size / 5, size * 0.4, size * 0.4);
        ctx.restore();
      } else pulseHead(ctx, pack, hx, hy, (pulse.small ? 1.3 : 1.9) * (0.6 + 0.4 * env), base * env, line, core, glow, 0.85 * lightAlpha, turn);
    } else {
      // A dot runs the line with a short tail, its light and a hot centre.
      const path = pathSet(from, to, 0, cp);
      const rise = clamp01(u / 0.05);
      if (u > 0.02) pulseTail(ctx, path, u, DOT_TAIL, DOT_TAIL_ALPHA, DOT_TAIL_WIDTH, pulse.small ? 1.1 : 1.6, base * rise, short);
      const at = pathBlossom(path, u, u, u, PATH_AT);
      pulseHead(ctx, pack, at.x, at.y, pulse.small ? 1.5 : 2.2, base * rise, line, core, glow, 0.8 * lightAlpha, turn);
    }
    // The landing's first light: a bloom opens on the receiving node.
    const landing = (u - 0.8) / 0.2;
    if (landing > 0 && blooms) lightAt(ctx, glow, to.x, to.y, bloom, base * bloomAlpha * landing);
    ctx.restore();
    return true;
  }

  // The free styles' landing, after a pulse arrived (u runs 0 → 1 over the
  // tail): the bloom it came in with grows on from the surge's last size as
  // it fades, and a ring swells off the node's rim, soft from T2 (a wide
  // faint ring under a crisp one). The ring keeps travelling right to the
  // end (an ease-out square) while the crisp ring's light falls off as the
  // cube of what is left and the soft one widens into a haze (the square),
  // so it never parks as an outline; on a dark ground the crisp ring is the
  // tint's pale highlight, so it reads as light, not as a grey line, and on a
  // light one both rings keep the tint (wireLightTone) under a fainter haze
  // of it. Glass blooms wider and softer, minimal keeps one thin ring, halo
  // sends a second ring out past the first, and crystal's ring is an octagon
  // (its gem's outline) with four sparkles glinting off alternate corners.
  // On the rail (o.rail) the small nodes get one crisp round ring and a
  // smaller, fainter bloom.
  function landDefault(ctx, p, radius, tint, u, o, style) {
    if (!p || !tint) return false;
    if (o.still === true || !(u < 1)) return true;
    const pack = packOf(style);
    const currentTheme = o.theme ?? INK_DEFAULTS, light = currentTheme.light === true;
    const k = u > 0 ? u : 0, e = easeOut(k), fade = 1 - k, fall = fade * fade, flash = fall * fade, grow = 1 - fall;
    const pulse = o.pulse;
    // ink: the soft ring; edge: the crisp ring; spark: crystal's glints
    let ink, edge, spark;
    if (light) { const tones = wireLightTone(tint, currentTheme); ink = tones.line; edge = tones.line; spark = tones.deep; }
    else { ink = tint; edge = inkOf(tint, currentTheme).spec; spark = edge; }
    const glow = pulse && typeof pulse.glow === "string" ? pulseTone(pulse.glow) : tint;
    const r = radius > 0 ? radius : 0;
    const detail = Number.isFinite(o.detail) ? o.detail : 3;
    const rail = o.rail === true;
    const landing = pack.landing, soft = landing === LAND_SOFT, facets = landing === LAND_RAYS;
    const base = ctx.globalAlpha;
    ctx.save();
    if (landing !== LAND_RING) lightAt(ctx, glow, p.x, p.y, bloomRadius(r, rail) * (1 + (soft ? 0.55 : 0.3) * e), base * BLOOM_ALPHA * (rail ? RAIL_BLOOM : 1) * fall * (light ? 0.45 : 1));
    const rim = Math.max(3, r) + 1.5;
    ctx.strokeStyle = rgba(edge, 1);
    ctx.beginPath();
    if (rail) {
      // the rail: one crisp ring of the style, a short way out
      ctx.arc(p.x, p.y, rim + (3 + 0.4 * rim) * grow, 0, TAU);
      ctx.globalAlpha = base * 0.55 * flash;
      ctx.lineWidth = landing === LAND_RING ? 0.9 : 0.6 + 0.8 * fade;
      ctx.stroke();
      ctx.restore();
      return true;
    }
    const reach = 6 + 0.6 * rim, swell = rim + reach * grow;
    // crystal's ring is its gem's octagon (flat on top), turning a little
    const facet = Math.PI / 8 + 0.35 * e;
    if (facets) polyPath(ctx, p.x, p.y, swell, 8, facet);
    else ctx.arc(p.x, p.y, swell, 0, TAU);
    if (detail >= 2 && landing !== LAND_RING) {
      ctx.strokeStyle = rgba(ink, 1);
      ctx.globalAlpha = base * (light ? 0.12 : 0.16) * fall;
      ctx.lineWidth = 2.6 + 2.2 * k;
      ctx.stroke();
      ctx.strokeStyle = rgba(edge, 1);
    }
    ctx.globalAlpha = base * (light ? (soft ? 0.5 : 0.7) : soft ? 0.4 : landing === LAND_RING ? 0.7 : 0.62) * flash;
    ctx.lineWidth = landing === LAND_RING ? 0.9 : 0.6 + 1.2 * fade;
    ctx.stroke();
    if (landing === LAND_DOUBLE && detail >= 1 && k > 0.22) {
      // halo: a second, fainter ring starts late and runs out past the first
      const late = (k - 0.22) / 0.78, left = 1 - late;
      ctx.beginPath();
      ctx.arc(p.x, p.y, rim + 1.35 * reach * easeOut(late), 0, TAU);
      ctx.globalAlpha = base * 0.42 * left * left;
      ctx.lineWidth = 0.8;
      ctx.stroke();
    } else if (facets && detail >= 1) {
      // crystal: four upright sparkles glint just off alternate corners of
      // the octagon and turn with it (a quarter turn apart, so one sine and
      // one cosine place them all)
      const out = swell + 2, arm = 2 + 3 * fade;
      const vx = Math.cos(facet) * out, vy = Math.sin(facet) * out;
      const c = Math.cos(0.35 * e - Math.PI / 2), s = Math.sin(0.35 * e - Math.PI / 2);
      ctx.beginPath();
      wireSparkle(ctx, p.x + vx, p.y + vy, arm, c, s);
      wireSparkle(ctx, p.x - vy, p.y + vx, arm, c, s);
      wireSparkle(ctx, p.x - vx, p.y - vy, arm, c, s);
      wireSparkle(ctx, p.x + vy, p.y - vx, arm, c, s);
      ctx.fillStyle = rgba(spark, 1);
      ctx.globalAlpha = base * 0.75 * fall;
      ctx.fill();
    }
    ctx.restore();
    return true;
  }

  const WIRE_DEFAULTS = { wire: wireDefault, surge: surgeDefault, land: landDefault };
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
