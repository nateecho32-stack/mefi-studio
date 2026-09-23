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
