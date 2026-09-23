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

  // Prism: a crystal that turns and splits the light. A bipyramid (an apex
  // above and below a girdle of six facets, four on a small gem) turns under
  // a fixed key light, so each facet brightens as it comes round into the
  // light and sinks as it leaves; a second light flashes a pavilion facet in
  // the theme's second hue. A band of light sweeps across the silhouette,
  // lighting a glint on the crown as it enters and a spectral fringe (rose,
  // the second hue, blue) along the lower right edge as it leaves. While it
  // works, crystal shards orbit a tilted ring behind and in front of it and
  // caustic sparkles flicker round it. The tint stays the body's colour; the
  // spectrum is only ever a highlight. The body is drawn in unit space under
  // translate(p)·scale(radius) from per-canvas cached paints and moves with
  // the node's clock; reduced motion holds a designed pose.

  // The gem, seen from a little above (PRISM_PITCH is the sine of the view's
  // tilt): apex heights, the girdle's radius and height, the crown's and the
  // pavilion's depth below and above the girdle.
  const PRISM_PITCH = 0.1163, PRISM_LEVEL = Math.sqrt(1 - PRISM_PITCH * PRISM_PITCH);
  const PRISM_TOP = -1.02 * PRISM_LEVEL, PRISM_BOTTOM = 1.08 * PRISM_LEVEL;
  const PRISM_GIRDLE = 0.86, PRISM_GIRDLE_Y = -0.26 * PRISM_LEVEL, PRISM_CROWN = 0.76, PRISM_PAVILION = 1.34;
  // Periods in animation seconds (the clock runs 2.5 times faster at work):
  // a turn, a sweep of the light band, a lap of the shards.
  const PRISM_SPIN = 7, PRISM_SWEEP = 3.2, PRISM_SHARD_LAP = 6;
  // The still pose: turned a twelfth so three crown tones show, the band
  // parked across the crown.
  const PRISM_STILL_TURN = Math.PI / 12, PRISM_STILL_BAND = -0.25;
  // The light band runs along this tilt, from the upper left to the lower
  // right: it lights the crown's glint first, then the fringe as it leaves.
  const PRISM_BAND_TILT = 0.62, PRISM_BAND_COS = Math.cos(PRISM_BAND_TILT), PRISM_BAND_SIN = Math.sin(PRISM_BAND_TILT);
  const PRISM_GLINT_X = -0.3, PRISM_GLINT_Y = -0.5;
  const PRISM_GLINT_AT = PRISM_GLINT_X * PRISM_BAND_COS + PRISM_GLINT_Y * PRISM_BAND_SIN;
  const PRISM_FLARE_AT = 0.52 * PRISM_BAND_COS + 0.38 * PRISM_BAND_SIN;
  // The spectrum's ends; the theme's second hue is its middle.
  const PRISM_ROSE = Object.freeze([255, 92, 148]), PRISM_BLUE = Object.freeze([104, 128, 255]);
  // Facet tones: fine enough steps that a facet turning slowly through the
  // light never ticks; the small kite's two planes sit on fixed steps.
  const PRISM_RAMP = 48, PRISM_KITE_BASE = Math.floor(PRISM_RAMP * 0.15), PRISM_KITE_LIT = Math.floor(PRISM_RAMP * 0.39);
  // Every facet tone stands at least this far off the background (luminance).
  const PRISM_APART = 22;
  const PRISM_SOLID = Object.freeze([]), PRISM_QUEUE_DASH = Object.freeze([2, 3]), PRISM_CREW_DASH = Object.freeze([2, 5]);
  // The shards' orbit: an ellipse 1.34 × .42 tilted −.35.
  const PRISM_ORBIT_X = 1.34, PRISM_ORBIT_Y = 0.42, PRISM_ORBIT_TILT = -0.35;
  const PRISM_ORBIT_COS = Math.cos(PRISM_ORBIT_TILT), PRISM_ORBIT_SIN = Math.sin(PRISM_ORBIT_TILT);

  function prismUnit(x, y, z) {
    const length = Math.hypot(x, y, z);
    return Object.freeze([x / length, y / length, z / length]);
  }
  // The key light (upper left, a little in front) and the second light
  // (lower right) whose narrow lobe makes a pavilion facet catch fire as it
  // turns through it: blue as it enters, the second hue, rose as it leaves.
  const PRISM_KEY = prismUnit(-0.75, -0.55, 0.38), PRISM_FILL = prismUnit(0.75, 0.35, 0.55);
  const PRISM_FIRE_AT = Math.atan2(PRISM_FILL[2], PRISM_FILL[0]), PRISM_FIRE_COS = Math.cos(PRISM_FIRE_AT), PRISM_FIRE_SIN = Math.sin(PRISM_FIRE_AT);

  // Per cut (4 or 6 girdle facets): the vertex and facet-middle angles as
  // cos/sin tables, so a frame turns the gem with two trig calls.
  function prismCut(sides) {
    const cut = {
      sides, vc: new Float64Array(sides), vs: new Float64Array(sides), fc: new Float64Array(sides), fs: new Float64Array(sides),
      apothem: PRISM_GIRDLE * Math.cos(Math.PI / sides), frontCos: Math.cos(Math.PI / sides),
    };
    for (let index = 0; index < sides; index += 1) {
      cut.vc[index] = Math.cos(index * TAU / sides); cut.vs[index] = Math.sin(index * TAU / sides);
      cut.fc[index] = Math.cos((index + 0.5) * TAU / sides); cut.fs[index] = Math.sin((index + 0.5) * TAU / sides);
    }
    cut.crownLength = Math.hypot(PRISM_CROWN, cut.apothem);
    cut.pavilionLength = Math.hypot(PRISM_PAVILION, cut.apothem);
    return Object.freeze(cut);
  }
  const PRISM_CUTS = Object.freeze({ 4: prismCut(4), 6: prismCut(6) });
  // Where the shards sit at k·2π/count, and their still pose (30°, 150°, 270° …).
  function prismSteps(count, start) {
    const steps = { c: new Float64Array(count), s: new Float64Array(count), pc: new Float64Array(count), ps: new Float64Array(count) };
    for (let index = 0; index < count; index += 1) {
      steps.c[index] = Math.cos(index * TAU / count); steps.s[index] = Math.sin(index * TAU / count);
      steps.pc[index] = Math.cos(start + index * TAU / count); steps.ps[index] = Math.sin(start + index * TAU / count);
    }
    return Object.freeze(steps);
  }
  const PRISM_SHARD_STEPS = Object.freeze({ 2: prismSteps(2, Math.PI / 6), 3: prismSteps(3, Math.PI / 6), 4: prismSteps(4, Math.PI / 6) });
  // Sixteen directions for the caustic sparkles (picked by hash, no trig).
  const PRISM_RING = prismSteps(16, 0);
  // Twelve directions for the arrival's rays.
  const PRISM_RAYS = prismSteps(12, 0);

  // The turned gem, one scratch for the node being painted: girdle vertices
  // (x, y, depth), each facet's light (crown, pavilion, the second light's
  // flash on the pavilion) and which facets face the viewer, and the visible
  // runs c0..c1 (crown) and p0..p1 (pavilion), which wrap.
  const PRISM_GEM = {
    sides: 6, vx: new Float64Array(6), vy: new Float64Array(6), vz: new Float64Array(6),
    crown: new Float64Array(6), pavilion: new Float64Array(6), flash: new Float64Array(6), hue: new Float64Array(6),
    crownOn: new Uint8Array(6), pavilionOn: new Uint8Array(6), c0: 0, c1: 0, p0: 0, p1: 0, front: 0,
  };
  function prismTurn(sides, theta) {
    const cut = PRISM_CUTS[sides], gem = PRISM_GEM, a = cut.apothem, s = PRISM_PITCH, c = PRISM_LEVEL;
    const ct = Math.cos(theta), st = Math.sin(theta);
    gem.sides = sides; gem.front = 0;
    for (let index = 0; index < sides; index += 1) {
      const ca = ct * cut.vc[index] - st * cut.vs[index], sa = st * cut.vc[index] + ct * cut.vs[index];
      gem.vx[index] = PRISM_GIRDLE * ca;
      gem.vy[index] = PRISM_GIRDLE_Y + PRISM_GIRDLE * s * sa;
      gem.vz[index] = sa;
      if (sa > gem.vz[gem.front]) gem.front = index;
      const cb = ct * cut.fc[index] - st * cut.fs[index], sb = st * cut.fc[index] + ct * cut.fs[index];
      // Facet normals in the gem's frame, tilted with the view (y' = y·c + z·s,
      // z' = z·c − y·s): a crown facet leans up and out, a pavilion one down.
      const cx = PRISM_CROWN * cb, cy = -a * c + PRISM_CROWN * sb * s, cz = a * s + PRISM_CROWN * sb * c;
      gem.crownOn[index] = cz > 0 ? 1 : 0;
      gem.crown[index] = (PRISM_KEY[0] * cx + PRISM_KEY[1] * cy + PRISM_KEY[2] * cz) / cut.crownLength;
      const px = PRISM_PAVILION * cb, py = a * c + PRISM_PAVILION * sb * s, pz = PRISM_PAVILION * sb * c - a * s;
      gem.pavilionOn[index] = pz > 0 ? 1 : 0;
      gem.pavilion[index] = (PRISM_KEY[0] * px + PRISM_KEY[1] * py + PRISM_KEY[2] * pz) / cut.pavilionLength;
      gem.flash[index] = (PRISM_FILL[0] * px + PRISM_FILL[1] * py + PRISM_FILL[2] * pz) / cut.pavilionLength;
      // Where the facet is in the second light's lobe: < 0 entering, > 0 leaving.
      gem.hue[index] = sb * PRISM_FIRE_COS - cb * PRISM_FIRE_SIN;
    }
    for (let index = 0; index < sides; index += 1) {
      const previous = (index + sides - 1) % sides, next = (index + 1) % sides;
      if (gem.crownOn[index] && !gem.crownOn[previous]) gem.c0 = index;
      if (gem.crownOn[index] && !gem.crownOn[next]) gem.c1 = index;
      if (gem.pavilionOn[index] && !gem.pavilionOn[previous]) gem.p0 = index;
      if (gem.pavilionOn[index] && !gem.pavilionOn[next]) gem.p1 = index;
    }
  }
  // The silhouette: the top apex, the girdle's right end down to the first
  // lit pavilion facet, the bottom apex, then up the left end. The visible
  // facets tile exactly this outline.
  function prismOutline(ctx) {
    const gem = PRISM_GEM, sides = gem.sides;
    ctx.moveTo(0, PRISM_TOP);
    for (let index = gem.c0; ; index = (index + 1) % sides) {
      ctx.lineTo(gem.vx[index], gem.vy[index]);
      if (index === gem.p0) break;
    }
    ctx.lineTo(0, PRISM_BOTTOM);
    const last = (gem.c1 + 1) % sides;
    for (let index = (gem.p1 + 1) % sides; ; index = (index + 1) % sides) {
      ctx.lineTo(gem.vx[index], gem.vy[index]);
      if (index === last) break;
    }
    ctx.closePath();
  }
  // One facet: an apex and the girdle edge from vertex `index` to the next.
  function prismFacet(ctx, apex, index) {
    const gem = PRISM_GEM, next = (index + 1) % gem.sides;
    ctx.moveTo(0, apex); ctx.lineTo(gem.vx[index], gem.vy[index]); ctx.lineTo(gem.vx[next], gem.vy[next]); ctx.closePath();
  }
  // A facet's light (−1 … 1) as a step on the tone ramp, through a gentle
  // curve (s^1.5) that keeps the lit crown facets apart instead of washing
  // them all out near the top.
  const prismStep = (light) => {
    const at = (light + 0.6) / 1.5;
    if (!(at > 0)) return 0;
    const step = Math.floor(at * Math.sqrt(at) * PRISM_RAMP);
    return step >= PRISM_RAMP ? PRISM_RAMP - 1 : step;
  };
  // A 0 → 1 → 0 triangle wave: twinkles without trig.
  const prismWave = (x) => { const f = x - Math.floor(x); return f < 0.5 ? 2 * f : 2 - 2 * f; };
  const prismLevel = (value, fallback) => Number.isFinite(value) ? clamp01(value) : fallback;
  // A concave four-point star (a glint, a sparkle) around (x, y).
  function prismStar(ctx, x, y, arm) {
    ctx.moveTo(x, y - arm);
    ctx.quadraticCurveTo(x, y, x + arm, y); ctx.quadraticCurveTo(x, y, x, y + arm);
    ctx.quadraticCurveTo(x, y, x - arm, y); ctx.quadraticCurveTo(x, y, x, y - arm);
    ctx.closePath();
  }

  // The tones of one tint under one theme: a ramp of facet tones from the
  // shadow (the tint sunk toward the background, or toward the dark ink on a
  // light theme) through the tint to the lit crown; the silhouette's under-
  // fill; the rim; a dark table for a glyph; the spectrum. Cached per tint
  // (and rebuilt when the theme changes), with every colour string built once.
  const prismToneCache = new WeakMap();
  const prismThemeOf = (value) => value && value.bg ? value : theme(null);
  // The theme the last body was painted under: wires, pulses and landings
  // carry none today, so they take the node canvas's (their own `theme` wins
  // once the callers pass one).
  let prismLastTheme = theme(null);
  const prismHookTheme = (o) => o.theme && o.theme.bg ? o.theme : prismLastTheme;
  const prismLuma = (rgb) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  // A tone pushed toward the theme's contrast ink until it stands
  // PRISM_APART off the background, so a pale tint's lit facets on a light
  // theme (or a deep tint's shadow on a dark one) never melt into the ground.
  // Runs once per tint and theme.
  function prismApart(tone, currentTheme) {
    const ground = prismLuma(currentTheme.bg);
    let apart = tone;
    for (let step = 1; step <= 20 && Math.abs(prismLuma(apart) - ground) < PRISM_APART; step += 1) apart = mix(tone, currentTheme.hi, step * 0.05);
    return apart;
  }
  function prismTones(tint, currentTheme) {
    let tones = prismToneCache.get(tint);
    if (tones && tones.theme === currentTheme) return tones;
    const light = currentTheme.light === true, low = light ? currentTheme.hi : currentTheme.bg;
    // A light theme keeps the lit tones nearer the tint: white-hot facets
    // would vanish into a pale ground.
    const dusk = mix(tint, low, light ? 0.52 : 0.76), shade = mix(tint, low, light ? 0.28 : 0.5), hot = mix(tint, WHITE, light ? 0.28 : 0.62);
    const ramp = new Array(PRISM_RAMP);
    for (let step = 0; step < PRISM_RAMP; step += 1) {
      const at = (step + 0.5) / PRISM_RAMP;
      const tone = at < 0.36 ? mix(dusk, shade, at / 0.36) : at < 0.68 ? mix(shade, tint, (at - 0.36) / 0.32) : mix(tint, hot, (at - 0.68) / 0.32);
      ramp[step] = rgba(prismApart(tone, currentTheme), 1);
    }
    const accent = currentTheme.accent2 ?? mix(tint, WHITE, 0.5);
    const specA = light ? mix(PRISM_ROSE, currentTheme.hi, 0.14) : mix(PRISM_ROSE, tint, 0.16);
    const specB = light ? mix(PRISM_BLUE, currentTheme.hi, 0.14) : mix(PRISM_BLUE, tint, 0.16);
    const ink = mix(tint, WHITE, 0.86), rim = light ? mix(tint, currentTheme.hi, 0.35) : tint;
    tones = {
      theme: currentTheme, light, key: `prism|${tint.join(",")}|${currentTheme.key}`, ink, ramp,
      // The lit glow's colour: a pale tint on a light theme, never a brown haze.
      glow: light ? mix(tint, WHITE, 0.55) : tint,
      base: rgba(mix(tint, low, light ? 0.6 : 0.84), 1),
      tint: rgba(tint, 1), hot: rgba(hot, 1), spec: rgba(mix(tint, WHITE, light ? 0.5 : 0.9), 1), white: rgba(WHITE, 1),
      rim: rgba(rim, 1), chosen: rgba(light ? mix(tint, currentTheme.hi, 0.55) : hot, 1),
      // The shards' lit and shaded halves, and the faint trace of their orbit.
      shardLit: rgba(light ? tint : hot, 1), shardShade: rgba(light ? rim : tint, 1), shardShadeAlpha: light ? 0.9 : 0.75,
      trace: rgba(rim, 1),
      table: rgba(mix(tint, low, 0.82), 1),
      accent: rgba(accent, 1),
      glare: rgba(light ? mix(tint, currentTheme.hi, 0.3) : mix(tint, WHITE, 0.82), 1),
      spectrum: [rgba(specA, 1), rgba(accent, 1), rgba(specB, 1)],
      strands: [rgba(specA, 1), rgba(tint, 1), rgba(specB, 1)],
    };
    prismToneCache.set(tint, tones);
    return tones;
  }
  // The two unit-space gradients a canvas keeps per tint and theme, each
  // built the first time it shows: the lit glow and the light band.
  function prismPaints(ctx, tones) {
    return cacheGet(ctx, tones.key) ?? cachePut(ctx, tones.key, { glow: null, sweep: null });
  }
  // The glow ends at 1.45 radii, inside the shards' orbit, so it lights the
  // gem without sealing it in a bubble.
  const PRISM_GLOW = 1.45;
  function prismGlow(ctx, tones) {
    const glow = ctx.createRadialGradient(0, 0, 0.55, 0, 0, PRISM_GLOW), colour = tones.glow;
    glow.addColorStop(0, rgba(colour, tones.light ? 0.22 : 0.3));
    glow.addColorStop(0.5, rgba(colour, tones.light ? 0.07 : 0.1));
    glow.addColorStop(1, rgba(colour, 0));
    return glow;
  }
  function prismSweep(ctx, tones) {
    const band = ctx.createLinearGradient(-0.34, 0, 0.34, 0);
    band.addColorStop(0, rgba(WHITE, 0));
    band.addColorStop(0.36, rgba(WHITE, 0.1));
    // (a light theme's band peaks in plain white: a tinted near-white would
    // bleach its paler crown into the ground)
    band.addColorStop(0.5, tones.light ? rgba(WHITE, 0.42) : rgba(tones.ink, 0.66));
    band.addColorStop(0.64, rgba(WHITE, 0.1));
    band.addColorStop(1, rgba(WHITE, 0));
    return band;
  }

  // A small gem (T0): a kite whose lit plane turns (its ridge swings with
  // the spin), a rim and the arrival flash. 9 lineTo, 3 fills, 1 stroke.
  function prismKite(ctx) {
    ctx.moveTo(0, PRISM_TOP); ctx.lineTo(PRISM_GIRDLE, PRISM_GIRDLE_Y); ctx.lineTo(0, PRISM_BOTTOM); ctx.lineTo(-PRISM_GIRDLE, PRISM_GIRDLE_Y); ctx.closePath();
  }
  function prismSmall(ctx, tones, n, base, theta, work, sel, kick, pixel) {
    ctx.globalAlpha = base;
    ctx.beginPath(); prismKite(ctx);
    ctx.fillStyle = n.glyph ? tones.table : tones.ramp[PRISM_KITE_BASE]; ctx.fill();
    const ridge = 0.55 * Math.sin(theta);
    ctx.beginPath();
    ctx.moveTo(0, PRISM_TOP); ctx.lineTo(-PRISM_GIRDLE, PRISM_GIRDLE_Y); ctx.lineTo(0, PRISM_BOTTOM); ctx.lineTo(ridge, PRISM_GIRDLE_Y); ctx.closePath();
    ctx.globalAlpha = base * (n.glyph ? 0.4 : 1); ctx.fillStyle = tones.ramp[PRISM_KITE_LIT]; ctx.fill();
    ctx.beginPath(); prismKite(ctx);
    ctx.globalAlpha = base * (n.chosen ? 1 : Math.min(1, 0.8 + 0.2 * work + 0.1 * sel));
    ctx.strokeStyle = n.chosen ? tones.chosen : tones.rim; ctx.lineWidth = (n.chosen ? 1.3 : 0.8 + 0.3 * work + 0.5 * sel) * pixel; ctx.stroke();
    if (kick > 0.01) { ctx.globalAlpha = base * 0.6 * kick; ctx.fillStyle = tones.spec; ctx.fill(); }
  }

  // The working shards: `count` crystals round a tilted ellipse, the ones
  // behind the gem (front false) drawn dim in the tint before it, the near
  // ones after it as two-tone crystals (the half facing the key light lit,
  // the other shaded: one fill per tone); each turns about its long axis, so
  // its width swells and thins as it goes. A faint trace of the orbit (T2+)
  // runs behind the gem and, for its near half, in front of it.
  function prismShards(ctx, tones, m, base, work, count, radius, time, still, front) {
    const steps = PRISM_SHARD_STEPS[count];
    const trace = work * (count >= 3 ? tierIn(radius, 2) : 0);
    if (trace > 0.02 && typeof ctx.ellipse === "function") {
      ctx.beginPath(); ctx.ellipse(0, 0, PRISM_ORBIT_X, PRISM_ORBIT_Y, PRISM_ORBIT_TILT, front ? 0 : Math.PI, front ? Math.PI : TAU);
      ctx.globalAlpha = base * (front ? 0.16 : 0.12) * trace; ctx.strokeStyle = tones.trace; ctx.lineWidth = 0.8 / radius; ctx.stroke();
    }
    const spin = still ? 0 : TAU * cycle(m, PRISM_SHARD_LAP), cs = Math.cos(spin), ss = Math.sin(spin);
    for (let pass = front ? 0 : 1; pass < 2; pass += 1) {
      let drawn = false;
      ctx.beginPath();
      for (let index = 0; index < count; index += 1) {
        const ck = still ? steps.pc[index] : cs * steps.c[index] - ss * steps.s[index];
        const sk = still ? steps.ps[index] : ss * steps.c[index] + cs * steps.s[index];
        if ((sk >= 0) !== front) continue;
        const ex = PRISM_ORBIT_X * ck, ey = PRISM_ORBIT_Y * sk;
        const x = ex * PRISM_ORBIT_COS - ey * PRISM_ORBIT_SIN, y = ex * PRISM_ORBIT_SIN + ey * PRISM_ORBIT_COS;
        const size = work * (0.8 + 0.28 * sk) * (index === 3 ? tierIn(radius, 3) : index === 2 ? tierIn(radius, 2) : tierIn(radius, 1));
        if (size < 0.04) continue;
        // A double-terminated crystal standing across the ring's plane: a
        // point, parallel sides, a point (sx, sy: a shoulder, .42 of the way
        // from the middle to a point); a far one is a plain dim diamond.
        const half = (still ? 0.1 : 0.06 + 0.09 * prismWave(time / 1900 + index * 0.37 + m.seed)) * size, tall = 0.34 * size;
        const ux = -PRISM_ORBIT_SIN * tall, uy = PRISM_ORBIT_COS * tall, wx = PRISM_ORBIT_COS * half, wy = PRISM_ORBIT_SIN * half;
        const sx = 0.42 * ux, sy = 0.42 * uy;
        ctx.moveTo(x - ux, y - uy);
        if (!front) { ctx.lineTo(x + wx, y + wy); ctx.lineTo(x + ux, y + uy); ctx.lineTo(x - wx, y - wy); }
        else if (pass === 1) { ctx.lineTo(x + wx - sx, y + wy - sy); ctx.lineTo(x + wx + sx, y + wy + sy); ctx.lineTo(x + ux, y + uy); }
        else { ctx.lineTo(x + ux, y + uy); ctx.lineTo(x - wx + sx, y - wy + sy); ctx.lineTo(x - wx - sx, y - wy - sy); }
        ctx.closePath();
        drawn = true;
      }
      if (!drawn) return;
      if (!front) { ctx.globalAlpha = base * 0.55; ctx.fillStyle = tones.tint; }
      else if (pass === 0) { ctx.globalAlpha = base * 0.95; ctx.fillStyle = tones.shardLit; }
      else { ctx.globalAlpha = base * tones.shardShadeAlpha; ctx.fillStyle = tones.shardShade; }
      ctx.fill();
    }
  }
  // Caustics: small four-point sparkles round a working gem (two, three at
  // T3), each living .7 s at a spot hashed from the node's seed and its
  // life; secondary to the shards.
  function prismCaustics(ctx, tones, m, base, work, radius, time, count) {
    const fade = work * tierIn(radius, 2);
    let drawn = false;
    ctx.beginPath();
    for (let index = 0; index < count; index += 1) {
      const at = time / 700 + index / count + m.seed * 5, life = at - Math.floor(at), turn = Math.floor(at) * 3 + index;
      const arm = 0.45 * life * (1 - life) * fade;
      if (arm < 0.025) continue;
      const direction = Math.floor(hash(m.seed, turn) * 16) & 15, far = 1.08 + 0.32 * hash(m.seed, turn + 7919);
      prismStar(ctx, PRISM_RING.c[direction] * far, PRISM_RING.s[direction] * far, arm);
      drawn = true;
    }
    if (!drawn) return;
    ctx.globalAlpha = base * 0.95; ctx.fillStyle = tones.glare; ctx.fill();
  }

  // A motion object without a clock (a hand-made one) holds the still pose;
  // the gem's turn for a motion (the arrival flash reuses the body's).
  const prismStill = (m, still) => still === true || m.still === true || !(Number.isFinite(m.clock) && Number.isFinite(m.seed));
  const prismTheta = (m, still) => still ? PRISM_STILL_TURN : TAU * cycle(m, PRISM_SPIN);

  function paintPrism(ctx, p, radius, tint, n, m) {
    if (!(radius > 0)) return;
    const currentTheme = prismThemeOf(n.theme);
    prismLastTheme = currentTheme;
    const tones = prismTones(tint, currentTheme), paints = prismPaints(ctx, tones);
    const base = n.alpha, still = prismStill(m, n.still), time = n.time, pixel = 1 / radius;
    const detail = n.detail >= 3 ? 3 : n.detail >= 2 ? 2 : n.detail >= 1 ? 1 : 0;
    const work = prismLevel(m.work, n.active ? 1 : 0), lit = prismLevel(m.lit, n.active || n.selected ? 1 : 0);
    const sel = prismLevel(m.sel, n.selected ? 1 : 0), kick = still ? 0 : prismLevel(m.kick, 0);
    const theta = prismTheta(m, still);
    ctx.save();
    ctx.translate(p.x, p.y); ctx.scale(radius, radius);
    // The glow, only while it works or is chosen, eased with the node.
    if (lit > 0.01) {
      paints.glow ??= prismGlow(ctx, tones);
      ctx.globalAlpha = base * lit * (still ? 0.86 : 0.72 + 0.28 * swell(m, 2.6));
      ctx.fillStyle = paints.glow; ctx.beginPath(); ctx.arc(0, 0, PRISM_GLOW, 0, TAU); ctx.fill();
    }
    if (detail === 0) {
      prismSmall(ctx, tones, n, base, theta, work, sel, kick, pixel);
      ctx.restore();
      voidMonogram(ctx, p, n, tones.ink);
      return;
    }
    const sides = detail >= 2 ? 6 : 4;
    prismTurn(sides, theta);
    const gem = PRISM_GEM;
    const shards = work > 0.02 ? (detail >= 3 ? 4 : detail === 2 ? 3 : 2) : 0;
    if (shards) prismShards(ctx, tones, m, base, work, shards, radius, time, still, false);
    // The body: the silhouette under-fill, then each facet in its light.
    ctx.globalAlpha = base;
    ctx.beginPath(); prismOutline(ctx); ctx.fillStyle = tones.base; ctx.fill();
    for (let index = 0; index < sides; index += 1) {
      if (gem.crownOn[index]) {
        ctx.beginPath(); prismFacet(ctx, PRISM_TOP, index);
        ctx.fillStyle = tones.ramp[prismStep(gem.crown[index])]; ctx.fill();
      }
      if (gem.pavilionOn[index]) {
        ctx.beginPath(); prismFacet(ctx, PRISM_BOTTOM, index);
        ctx.fillStyle = tones.ramp[prismStep(gem.pavilion[index])]; ctx.fill();
        // Fire: the second light catches this facet as it turns through the
        // lobe, blue as it enters, the second hue at the peak, rose as it
        // leaves (the two nearest hues cross-fade).
        const fire = (gem.flash[index] - 0.86) / 0.1;
        if (fire > 0) {
          // (softer on a four-facet gem, where one facet is a quarter of the body)
          const peak = (sides === 6 ? 0.78 : 0.6) * (fire >= 1 ? 1 : fire), hue = gem.hue[index], side = Math.min(1, Math.abs(hue) / 0.42);
          if (side < 0.98) { ctx.globalAlpha = base * peak * (1 - side); ctx.fillStyle = tones.accent; ctx.fill(); }
          if (side > 0.02) { ctx.globalAlpha = base * peak * side; ctx.fillStyle = tones.spectrum[hue < 0 ? 2 : 0]; ctx.fill(); }
          ctx.globalAlpha = base;
        }
      }
    }
    // Ridges (T3): the inner edges between lit facets, in the crown's light.
    const fine = detail >= 3 ? tierIn(radius, 3) : 0;
    if (fine > 0.02) {
      ctx.beginPath();
      for (let index = 0; index < sides; index += 1) {
        const previous = (index + sides - 1) % sides;
        if (gem.crownOn[index] && gem.crownOn[previous]) { ctx.moveTo(0, PRISM_TOP); ctx.lineTo(gem.vx[index], gem.vy[index]); }
        if (gem.pavilionOn[index] && gem.pavilionOn[previous]) { ctx.moveTo(0, PRISM_BOTTOM); ctx.lineTo(gem.vx[index], gem.vy[index]); }
      }
      ctx.moveTo(gem.vx[gem.p0], gem.vy[gem.p0]);
      for (let index = gem.p0; ; index = (index + 1) % sides) {
        const next = (index + 1) % sides;
        ctx.lineTo(gem.vx[next], gem.vy[next]);
        if (index === gem.p1) break;
      }
      ctx.globalAlpha = base * 0.3 * fine; ctx.strokeStyle = tones.hot; ctx.lineWidth = 0.7 * pixel; ctx.stroke();
    }
    // The light band: the silhouette again, filled with the band gradient
    // moved under it (the path stays put, only the band travels), then the
    // arrival flash and the rim on that same path.
    const band = still ? PRISM_STILL_BAND : -1.7 + 3.4 * cycle(m, PRISM_SWEEP);
    const small = tierIn(radius, 1), mid = detail >= 2 ? tierIn(radius, 2) : 0;
    ctx.beginPath(); prismOutline(ctx);
    if (small > 0.02) {
      paints.sweep ??= prismSweep(ctx, tones);
      ctx.save();
      ctx.rotate(PRISM_BAND_TILT); ctx.translate(band, 0);
      ctx.globalAlpha = base * small * (0.82 + 0.18 * work); ctx.fillStyle = paints.sweep; ctx.fill();
      ctx.restore();
    }
    if (kick > 0.01) { ctx.globalAlpha = base * 0.6 * kick; ctx.fillStyle = tones.spec; ctx.fill(); }
    ctx.globalAlpha = base * (n.chosen ? 1 : Math.min(1, 0.72 + 0.23 * work + 0.05 * sel));
    ctx.strokeStyle = n.chosen ? tones.chosen : tones.rim;
    ctx.lineWidth = (n.chosen ? 1.6 : 0.85 + 0.35 * work + 0.6 * sel) * pixel; ctx.stroke();
    // A glyph (an agent's role, the hub's monogram) sits on a dark table.
    if (n.glyph) {
      ctx.beginPath();
      ctx.moveTo(0, -0.6); ctx.lineTo(0.52, -0.12); ctx.lineTo(0, 0.68); ctx.lineTo(-0.52, -0.12); ctx.closePath();
      ctx.globalAlpha = base * 0.94; ctx.fillStyle = tones.table; ctx.fill();
      ctx.globalAlpha = base * 0.5; ctx.strokeStyle = tones.hot; ctx.lineWidth = 0.8 * pixel; ctx.stroke();
    }
    // The spectral fringe on the lower right edge flares as the band leaves
    // it (and on arrival): rose, the second hue and blue (T2+), one strand of
    // the second hue on a small gem.
    const flare = still ? 0.35 : Math.max(kick, 0, 1 - Math.abs(band - PRISM_FLARE_AT) / 0.55);
    const rx = gem.vx[gem.p0], ry = gem.vy[gem.p0], dx = -rx, dy = PRISM_BOTTOM - ry, edge = Math.hypot(dx, dy) || 1;
    const nx = dy / edge, ny = -dx / edge, strands = detail >= 2 ? 3 : 1;
    ctx.lineWidth = Math.max(0.75 * pixel, 0.06);
    ctx.lineCap = "round";
    const reachOut = 0.76 + 0.14 * flare;
    for (let index = 0; index < strands; index += 1) {
      const fade = strands === 1 ? small : index === 0 ? 1 : mid;
      if (fade <= 0.02) continue;
      const offset = strands === 1 ? 0.04 : 0.05 * index;
      ctx.beginPath();
      ctx.moveTo(rx + dx * 0.1 + nx * offset, ry + dy * 0.1 + ny * offset);
      ctx.lineTo(rx + dx * reachOut + nx * offset, ry + dy * reachOut + ny * offset);
      ctx.globalAlpha = base * (0.4 + 0.6 * flare) * fade;
      ctx.strokeStyle = strands === 1 ? tones.accent : tones.spectrum[index]; ctx.stroke();
    }
    // The key light's glint on the crown swells as the band crosses it.
    if (mid > 0.02 && !n.glyph) {
      const bump = still ? 0.6 : Math.max(0, 1 - Math.abs(band - PRISM_GLINT_AT) / 0.45);
      ctx.beginPath(); prismStar(ctx, PRISM_GLINT_X, PRISM_GLINT_Y, 0.2 * (0.5 + 0.5 * bump) * mid);
      ctx.globalAlpha = base * 0.92; ctx.fillStyle = tones.white; ctx.fill();
    }
    // A twinkle on the girdle vertex that turns to face the viewer (T3).
    if (fine > 0.02) {
      const cut = PRISM_CUTS[sides], front = gem.front;
      const facing = (gem.vz[front] - cut.frontCos) / (1 - cut.frontCos);
      const arm = (still ? 0.12 : 0.17 * facing * facing * (0.35 + 0.65 * prismWave(time / 2100 + m.seed))) * fine;
      if (arm > 0.015) {
        const x = gem.vx[front], y = gem.vy[front];
        ctx.beginPath(); prismStar(ctx, x, y, arm);
        ctx.globalAlpha = base * 0.95; ctx.fillStyle = tones.white; ctx.fill();
      }
    }
    if (shards) prismShards(ctx, tones, m, base, work, shards, radius, time, still, true);
    if (shards && detail >= 2 && !still) prismCaustics(ctx, tones, m, base, work, radius, time, detail >= 3 ? 3 : 2);
    ctx.restore();
    voidMonogram(ctx, p, n, tones.ink);
  }

  // A pop-in scale for a badge that just appeared (easeOutBack over 320 ms).
  function prismPop(m, time, still) {
    if (still || !Number.isFinite(m.statusAt) || !Number.isFinite(time)) return 1;
    const pop = easeOutBack((time - m.statusAt) / 320);
    return pop > 0.02 ? pop : 0.02;
  }
  // The error and done inks: the theme's amber and green, deepened on a
  // light theme so the ring, the badge's edge and its mark read on a pale
  // ground. Built once per theme.
  const prismStateCache = new WeakMap();
  function prismStates(currentTheme) {
    let inks = prismStateCache.get(currentTheme);
    if (!inks) {
      const light = currentTheme.light === true;
      inks = {
        amber: rgba(light ? mix(currentTheme.amber, currentTheme.hi, 0.35) : currentTheme.amber, 1),
        done: rgba(light ? mix(currentTheme.done, currentTheme.hi, 0.35) : currentTheme.done, 1),
        amberWell: rgba(currentTheme.amberWell, 1), doneWell: rgba(currentTheme.doneWell, 1),
      };
      prismStateCache.set(currentTheme, inks);
    }
    return inks;
  }
  // A status badge cut as a small gem: a diamond well in the state's colour
  // with a "!" or a tick, top right of the node.
  function prismBadge(ctx, x, y, pop, well, edge, mark) {
    ctx.save();
    ctx.translate(x, y); ctx.scale(pop, pop);
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(5.4, 0); ctx.lineTo(0, 6); ctx.lineTo(-5.4, 0); ctx.closePath();
    ctx.fillStyle = well; ctx.fill();
    ctx.strokeStyle = edge; ctx.lineWidth = 1; ctx.stroke();
    if (mark === "!") {
      ctx.fillStyle = edge; ctx.font = '700 8px system-ui, "Segoe UI", sans-serif'; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("!", 0, 0.5);
    } else {
      ctx.beginPath(); ctx.moveTo(-2.4, 0); ctx.lineTo(-0.7, 1.8); ctx.lineTo(2.4, -1.8);
      ctx.lineWidth = 1.4; ctx.stroke();
    }
    ctx.restore();
  }
  // The agent status ring: three short arcs of the spectrum chasing round
  // while it runs (each speeds up and stretches as it gains on the next); a
  // marching dashed ring while it waits; a pulsing amber ring and a "!" gem
  // when it failed; a tick gem when it finished.
  function prismRing(ctx, p, radius, tint, o) {
    const status = o.status ?? null, running = status === "running" || o.builder === true;
    if (!running && status !== "queued" && status !== "error" && status !== "done") return true;
    const currentTheme = prismThemeOf(o.theme), tones = prismTones(tint, currentTheme), m = motionOf(o);
    const still = o.still === true || m.still === true, ring = Number.isFinite(o.ring) ? o.ring : radius + 3.5;
    ctx.save();
    const base = ctx.globalAlpha;
    ctx.lineCap = "round";
    if (running) {
      ctx.globalAlpha = base * 0.2; ctx.strokeStyle = tones.tint; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.arc(p.x, p.y, ring, 0, TAU); ctx.stroke();
      const spin = still ? -Math.PI / 2 : TAU * cycle(m, 4.2);
      ctx.globalAlpha = base * 0.95; ctx.lineWidth = 1.5;
      for (let index = 0; index < 3; index += 1) {
        const home = spin + index * TAU / 3, at = still ? home : home + 0.5 * Math.sin(home);
        const span = still ? 0.62 : 0.62 + 0.2 * Math.cos(home);
        ctx.beginPath(); ctx.arc(p.x, p.y, ring, at, at + span);
        ctx.strokeStyle = tones.spectrum[index]; ctx.stroke();
      }
    } else if (status === "queued") {
      ctx.setLineDash(PRISM_QUEUE_DASH);
      ctx.lineDashOffset = still ? 0 : -((m.clock * 6) % 5);
      ctx.globalAlpha = base * 0.5; ctx.strokeStyle = tones.tint; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, ring, 0, TAU); ctx.stroke();
    } else {
      const error = status === "error", inks = prismStates(currentTheme);
      if (error) {
        ctx.globalAlpha = base * (0.55 + 0.35 * swell(m, 1.2, 0.5)); ctx.strokeStyle = inks.amber; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(p.x, p.y, ring, 0, TAU); ctx.stroke();
      }
      ctx.globalAlpha = base;
      prismBadge(ctx, p.x + radius + 3, p.y - radius - 3, prismPop(m, o.time, still), error ? inks.amberWell : inks.doneWell, error ? inks.amber : inks.done, error ? "!" : "tick");
    }
    ctx.restore();
    return true;
  }
  // The hub's dress: a breathing ring cut into three arcs of the spectrum,
  // turning slowly, and the dashed ring the crew rests on.
  function prismHub(ctx, p, radius, tint, o) {
    const currentTheme = prismThemeOf(o.theme), tones = prismTones(tint, currentTheme), m = motionOf(o);
    const still = o.still === true || m.still === true, breathe = Number.isFinite(o.breathe) ? o.breathe : 0.5;
    const ring = radius + 5 + breathe * 2.5, spin = still ? -Math.PI / 2 : TAU * cycle(m, 24);
    ctx.save();
    const base = ctx.globalAlpha;
    ctx.lineCap = "round"; ctx.lineWidth = 1.1;
    ctx.globalAlpha = base * (0.3 + 0.25 * breathe);
    for (let index = 0; index < 3; index += 1) {
      const from = spin + index * TAU / 3 + 0.2;
      ctx.beginPath(); ctx.arc(p.x, p.y, ring, from, from + TAU / 3 - 0.4);
      ctx.strokeStyle = tones.spectrum[index]; ctx.stroke();
    }
    if (o.crew) {
      ctx.setLineDash(PRISM_CREW_DASH);
      ctx.lineDashOffset = still ? 0 : -((m.clock * 2) % 7);
      ctx.globalAlpha = base * 0.12; ctx.strokeStyle = tones.tint; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.arc(p.x, p.y, radius * 3.1, 0, TAU); ctx.stroke();
    }
    ctx.restore();
    return true;
  }
  // The work orbit: a faint track and a comet whose tail disperses into the
  // spectrum (the second hue at the head, then rose, then blue), on the
  // node's integrated orbit phase.
  function prismOrbit(ctx, p, radius, tint, o) {
    const currentTheme = prismThemeOf(o.theme), tones = prismTones(tint ?? currentTheme.orbit, currentTheme);
    const m = o.motion ?? null, still = o.still === true || m?.still === true;
    const ring = Number.isFinite(o.ring) ? o.ring : radius + 9;
    const pose = Number.isFinite(o.phase) ? o.phase : Math.PI / 3;
    const phase = still ? pose : Number.isFinite(m?.orbit) ? m.orbit : pose;
    const dim = o.running === false ? 0.6 : 1;
    ctx.save();
    const base = ctx.globalAlpha;
    ctx.lineCap = "round";
    ctx.globalAlpha = base * 0.18 * dim; ctx.strokeStyle = tones.tint; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.arc(p.x, p.y, ring, 0, TAU); ctx.stroke();
    for (let segment = 2; segment >= 0; segment -= 1) {
      ctx.globalAlpha = base * dim * (0.88 - segment * 0.24); ctx.lineWidth = 2.5 - segment * 0.55;
      ctx.strokeStyle = segment === 0 ? tones.accent : segment === 1 ? tones.spectrum[0] : tones.spectrum[2];
      ctx.beginPath(); ctx.arc(p.x, p.y, ring, phase - (segment + 1) * 0.62, phase - segment * 0.62); ctx.stroke();
    }
    ctx.restore();
    return true;
  }
  // Arrival: a spectral flash. The gem itself (its turned outline, as the
  // body paints it this frame) flashes white, six long rays of the spectrum
  // shoot out (two per colour) with six short glints between them, and a
  // shockwave in the second hue opens ahead of them. A far, dimmed or
  // moving node (detail ≤ 1) gets the flash, the six rays and the ring.
  function prismArrival(ctx, p, radius, tint, t01, o) {
    const t = clamp01(t01), currentTheme = prismThemeOf(o.theme), tones = prismTones(tint, currentTheme);
    const m = motionOf(o), still = prismStill(m, o.still), detail = Number.isFinite(o.detail) ? o.detail : 3;
    const grow = easeOut(t), fade = 1 - t, alpha = Number.isFinite(o.alpha) ? o.alpha : 1;
    ctx.save();
    ctx.lineCap = "round";
    if (t < 0.5 && radius > 0) {
      ctx.save();
      ctx.translate(p.x, p.y); ctx.scale(radius, radius);
      ctx.beginPath();
      if (detail >= 1) { prismTurn(detail >= 2 ? 6 : 4, prismTheta(m, still)); prismOutline(ctx); } else prismKite(ctx);
      const flash = 1 - t / 0.5;
      ctx.globalAlpha = alpha * 0.85 * flash * Math.sqrt(flash); ctx.fillStyle = tones.spec; ctx.fill();
      ctx.restore();
    }
    // The starburst: tapered rays from just off the gem out past two radii
    // (the glints .6 as long), thinning as they fly and fade.
    const turn = (Number.isFinite(m.seed) ? m.seed : 0) * TAU, ct = Math.cos(turn), st = Math.sin(turn);
    const inner = radius * (0.92 + 0.3 * grow), outer = radius * (1.25 + 0.8 * grow), short = inner + 0.6 * (outer - inner);
    const wide = Math.max(1.3, 0.11 * radius) * (0.4 + 0.6 * fade);
    ctx.globalAlpha = alpha * 0.95 * (1 - t * t);
    for (let color = 0, colours = detail <= 1 ? 3 : 4; color < colours; color += 1) {
      ctx.beginPath();
      for (let ray = color === 3 ? 1 : color * 2; ray < 12; ray += color === 3 ? 2 : 6) {
        const cx = ct * PRISM_RAYS.c[ray] - st * PRISM_RAYS.s[ray], cy = st * PRISM_RAYS.c[ray] + ct * PRISM_RAYS.s[ray];
        const end = color === 3 ? short : outer, half = color === 3 ? wide * 0.6 : wide;
        const bx = p.x + cx * inner, by = p.y + cy * inner;
        ctx.moveTo(bx - cy * half, by + cx * half); ctx.lineTo(p.x + cx * end, p.y + cy * end); ctx.lineTo(bx + cy * half, by - cx * half); ctx.closePath();
      }
      ctx.fillStyle = color === 3 ? tones.glare : tones.spectrum[color]; ctx.fill();
    }
    if (t > 0.05) {
      ctx.globalAlpha = alpha * 0.5 * fade * fade; ctx.lineWidth = 1.1; ctx.strokeStyle = tones.accent;
      ctx.beginPath(); ctx.arc(p.x, p.y, radius * (1.15 + 0.95 * grow), 0, TAU); ctx.stroke();
    }
    ctx.restore();
    return true;
  }
  // Selection: a hover ring at 1.22 radii; the chosen node wears three arcs
  // of the spectrum at slightly different radii (a dispersed ring), turning
  // once in 9 s. A node let go keeps what it wore while its level fades, so
  // a chosen node's arcs fade out instead of turning into the hover ring
  // (remembered per motion record; a hovered node forgets it).
  const prismWasChosen = new WeakMap();
  function prismSelect(ctx, p, radius, tint, o) {
    const m = motionOf(o), still = o.still === true || m.still === true;
    const marked = o.selected === true || o.chosen === true;
    const sel = still ? (marked ? 1 : 0) : prismLevel(m.sel, marked ? 1 : 0);
    const keep = !still && o.motion != null && typeof o.motion === "object";
    if (keep) {
      if (o.chosen === true) { if (!prismWasChosen.has(m)) prismWasChosen.set(m, true); }
      else if ((o.selected === true || sel <= 0.01) && prismWasChosen.has(m)) prismWasChosen.delete(m);
    }
    if (sel <= 0.01 && o.chosen !== true) return true;
    const tones = prismTones(tint, prismThemeOf(o.theme)), alpha = Number.isFinite(o.alpha) ? o.alpha : 1;
    ctx.save();
    ctx.lineCap = "round";
    if (o.chosen === true || (keep && o.selected !== true && prismWasChosen.has(m))) {
      const spin = still ? -Math.PI / 2 : TAU * cycle(m, 9);
      ctx.globalAlpha = alpha * 0.95 * (o.chosen === true ? Math.max(sel, 0.4) : sel); ctx.lineWidth = 1.6;
      for (let index = 0; index < 3; index += 1) {
        const from = spin + index * TAU / 3 + 0.12;
        ctx.beginPath(); ctx.arc(p.x, p.y, radius * (1.2 + 0.04 * index), from, from + TAU / 3 - 0.24);
        ctx.strokeStyle = tones.spectrum[index]; ctx.stroke();
      }
    } else {
      ctx.globalAlpha = alpha * 0.7 * sel; ctx.lineWidth = 1.1; ctx.strokeStyle = tones.theme.light ? tones.rim : tones.hot;
      ctx.beginPath(); ctx.arc(p.x, p.y, radius * 1.22, 0, TAU); ctx.stroke();
    }
    ctx.restore();
    return true;
  }

  // Wires: a refracted beam. The line keeps the caller's pen (width, dash,
  // march, the hub's double line, the tree's S-curve); a lit (active or
  // inspected) edge gets a soft beam under it; a glint runs along it (3.2 s,
  // 1.1 s when active); near a large or lit target the beam splits into
  // three strands (rose, the tint, blue) that fan into the node. The far
  // (blurred) pen gets the line alone. On the rail, only the active session's
  // edges carry the glint; the rest keep the rail's plain line.
  function prismWireLine(ctx, a, b, o, width) {
    ctx.beginPath();
    if (o.double === true) {
      const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1, nx = -dy / length * 1.6, ny = dx / length * 1.6;
      ctx.moveTo(a.x + nx, a.y + ny); ctx.lineTo(b.x + nx, b.y + ny);
      ctx.moveTo(a.x - nx, a.y - ny); ctx.lineTo(b.x - nx, b.y - ny);
    } else {
      ctx.moveTo(a.x, a.y);
      if (o.curved === true && o.cp) ctx.bezierCurveTo(o.cp.x1, o.cp.y1, o.cp.x2, o.cp.y2, b.x, b.y);
      else ctx.lineTo(b.x, b.y);
    }
    ctx.lineWidth = width; ctx.stroke();
  }
  // A point u along the wire (its S-curve when curved) into PRISM_POINT.
  const PRISM_POINT = { x: 0, y: 0 };
  function prismAlong(a, b, o, u) {
    if (o.curved === true && o.cp) {
      const v = 1 - u, w0 = v * v * v, w1 = 3 * v * v * u, w2 = 3 * v * u * u, w3 = u * u * u;
      PRISM_POINT.x = w0 * a.x + w1 * o.cp.x1 + w2 * o.cp.x2 + w3 * b.x;
      PRISM_POINT.y = w0 * a.y + w1 * o.cp.y1 + w2 * o.cp.y2 + w3 * b.y;
    } else {
      PRISM_POINT.x = a.x + (b.x - a.x) * u; PRISM_POINT.y = a.y + (b.y - a.y) * u;
    }
    return PRISM_POINT;
  }
  function prismWire(ctx, a, b, o) {
    const rail = o.rail === true, active = o.active === true;
    if (rail && !active) return false;
    const tint = o.tint;
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    if (!tint || !(length > 1)) return false;
    const tones = prismTones(tint, prismHookTheme(o));
    const alpha = Number.isFinite(o.alpha) ? o.alpha : 1, width = Number.isFinite(o.width) ? o.width : 1;
    const time = Number.isFinite(o.time) ? o.time : 0, still = o.still === true, lit = active || o.inspected === true;
    const far = o.far === true, seed = Number.isFinite(o.seed) ? o.seed : 0;
    // The overlays' boost is taken on the stroke's alpha before its lifetime,
    // so an edge fading out fades its glint and strands with it.
    const lifetime = Number.isFinite(o.lifetime) ? clamp01(o.lifetime) : 1, core = lifetime > 0 ? alpha / lifetime : alpha;
    ctx.save();
    const base = ctx.globalAlpha;
    ctx.strokeStyle = tones.tint;
    if (lit && !far && !rail) {
      ctx.globalAlpha = base * alpha * 0.16; ctx.lineCap = "round"; ctx.setLineDash(PRISM_SOLID);
      prismWireLine(ctx, a, b, o, width + 2.6);
    }
    ctx.globalAlpha = base * alpha; ctx.lineCap = "butt";
    ctx.setLineDash(o.dash ?? PRISM_SOLID);
    ctx.lineDashOffset = o.march === true && !still ? (o.kind === "tether" ? -((time / 40) % 10) : -((time / 60) % 6)) : 0;
    prismWireLine(ctx, a, b, o, width);
    if (far) { ctx.restore(); return true; }
    ctx.setLineDash(PRISM_SOLID); ctx.lineDashOffset = 0; ctx.lineCap = "round";
    // The glint: a short bright dash running a → b, fading in and out at the ends.
    const u = still ? 0 : ((time / (active ? 1100 : 3200) + seed) % 1 + 1) % 1;
    if (!still) {
      const span = Math.min(0.2, Math.max(0.05, 18 / length)), head = u * (1 + span), tail = head - span;
      const from = tail < 0 ? 0 : tail, to = head > 1 ? 1 : head, ends = 4 * u * (1 - u);
      if (to > from && ends > 0.02) {
        ctx.beginPath();
        let point = prismAlong(a, b, o, from); ctx.moveTo(point.x, point.y);
        point = prismAlong(a, b, o, (from + to) / 2); ctx.lineTo(point.x, point.y);
        point = prismAlong(a, b, o, to); ctx.lineTo(point.x, point.y);
        ctx.globalAlpha = base * Math.min(1, core * 2.4) * lifetime * (active ? 0.85 : 0.55) * (ends > 1 ? 1 : ends);
        ctx.strokeStyle = tones.glare; ctx.lineWidth = width + 0.7; ctx.stroke();
      }
    }
    // The split: three strands fan from 2.4 target radii out into the node.
    // A lit edge splits into any tiered target but the smallest; a quiet one
    // only into a full-detail (T3) target. On the tree's S-curve the split
    // starts ON the drawn curve (its end tangent turns only in the last
    // pixels) and the strands aim from there into the node.
    const rB = Number.isFinite(o.rB) ? o.rB : 0, detail = Number.isFinite(o.detail) ? o.detail : 3;
    if (!rail && rB > 0 && detail >= (lit ? 1 : 3) && length > 3 * rB + 20) {
      const curved = o.curved === true && o.cp, back = 2.4 * rB / length;
      const split = 1 - (curved ? Math.min(0.45, back) : back);
      let sx = a.x + dx * split, sy = a.y + dy * split;
      if (curved) { const start = prismAlong(a, b, o, split); sx = start.x; sy = start.y; }
      const tx = b.x - sx, ty = b.y - sy, toward = Math.hypot(tx, ty) || 1, ux = tx / toward, uy = ty / toward;
      const spread = 0.35 * rB, nx = -uy * spread, ny = ux * spread;
      const flare = still ? 0.5 : Math.max(0, 1 - Math.abs(u - split) / 0.2);
      ctx.lineWidth = Math.max(0.8, width * 0.85);
      for (let index = 0; index < 3; index += 1) {
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(b.x + nx * (index - 1), b.y + ny * (index - 1));
        ctx.globalAlpha = base * Math.min(1, core * 1.6) * lifetime * (lit ? 1 : 0.7) * (0.4 + 0.6 * flare);
        ctx.strokeStyle = tones.strands[index]; ctx.stroke();
      }
    }
    ctx.restore();
    return true;
  }
  // Pulse colours: parsed once per colour, one stable triple each.
  const prismPulseColours = new Map();
  function prismPulseRgb(pulse) {
    if (Array.isArray(pulse?._rgb)) return pulse._rgb;
    const text = typeof pulse?.color === "string" ? pulse.color : "#a9ffcd";
    let triple = prismPulseColours.get(text);
    if (!triple) {
      const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(text.trim());
      const full = hex ? hex[1].length === 3 ? hex[1].replace(/./g, "$&$&") : hex[1] : "a9ffcd";
      const value = parseInt(full, 16);
      triple = Object.freeze([(value >> 16) & 255, (value >> 8) & 255, value & 255]);
      if (prismPulseColours.size >= 32) prismPulseColours.clear();
      prismPulseColours.set(text, triple);
    }
    return triple;
  }
  // A pulse: a white head with a fading tail runs the beam; from t .7 it
  // splits into three heads of the spectrum that fan into the node the way
  // the wire's strands do. A packet rides the head as a small gem. The rail
  // keeps its own pulses; reduced motion shows the beam lit, still.
  function prismSurge(ctx, from, to, t, pulse, o) {
    if (o.rail === true) return false;
    const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy);
    if (!(length >= 2)) return true;
    const tones = prismTones(prismPulseRgb(pulse), prismHookTheme(o));
    const small = pulse?.small === true, packet = pulse?.packet === true, detail = Number.isFinite(o.detail) ? o.detail : 3;
    ctx.save();
    const base = ctx.globalAlpha;
    ctx.lineCap = "round"; ctx.strokeStyle = tones.tint;
    if (o.still === true) {
      ctx.globalAlpha = base * 0.5; ctx.lineWidth = small ? 1.3 : 2;
      ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
      ctx.restore();
      return true;
    }
    const head = clamp01(t), ux = dx / length, uy = dy / length;
    // The wake: the whole beam warms while the pulse is on it.
    ctx.globalAlpha = base * 0.24 * 4 * head * (1 - head); ctx.lineWidth = small ? 1.1 : 1.6;
    ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
    // The tail: three segments behind the head, brighter toward it.
    const tail = Math.min(0.2, 60 / length);
    for (let index = 0; index < 3; index += 1) {
      const u0 = head - tail * (3 - index) / 3, u1 = head - tail * (2 - index) / 3;
      if (u1 <= 0) continue;
      const s0 = u0 < 0 ? 0 : u0;
      ctx.beginPath(); ctx.moveTo(from.x + dx * s0, from.y + dy * s0); ctx.lineTo(from.x + dx * u1, from.y + dy * u1);
      ctx.globalAlpha = base * (0.2 + 0.28 * index); ctx.lineWidth = (small ? 1.2 : 1.8) + 0.5 * index; ctx.stroke();
    }
    const x = from.x + dx * head, y = from.y + dy * head;
    // (a far, dimmed or moving target, detail ≤ 1, keeps one head)
    const split = detail <= 1 ? 0 : smooth01((head - 0.7) / 0.3), rTo = Number.isFinite(o.rTo) && o.rTo > 0 ? o.rTo : 6;
    const size = small ? 1.6 : packet ? 3 : 2.3;
    // The white head, fading as it splits.
    if (split < 1) {
      ctx.globalAlpha = base * (1 - split); ctx.fillStyle = tones.glare;
      ctx.beginPath();
      if (packet) { ctx.moveTo(x, y - size); ctx.lineTo(x + size * 0.7, y); ctx.lineTo(x, y + size); ctx.lineTo(x - size * 0.7, y); ctx.closePath(); }
      else ctx.arc(x, y, size, 0, TAU);
      ctx.fill();
    }
    if (split > 0) {
      const spread = 0.35 * rTo * split, nx = -uy * spread, ny = ux * spread, dot = size * 0.75;
      ctx.globalAlpha = base * split;
      for (let index = 0; index < 3; index += 1) {
        const hx = x + nx * (index - 1), hy = y + ny * (index - 1);
        ctx.beginPath(); ctx.arc(hx, hy, dot, 0, TAU); ctx.fillStyle = tones.spectrum[index]; ctx.fill();
      }
    }
    ctx.restore();
    return true;
  }
  // A pulse landing: a colour flash, three arcs of the spectrum opening out
  // round the node and a sparkle over it; the rail, and a far, dimmed or
  // moving target (detail ≤ 1), get one ring.
  function prismLand(ctx, p, radius, tint, u, o) {
    if (o.still === true) return false;
    const currentTheme = prismHookTheme(o), tones = prismTones(tint ?? currentTheme.orbit, currentTheme);
    const r = radius > 4 ? radius : 4, t = clamp01(u), grow = easeOut(t), fade = 1 - t;
    ctx.save();
    const base = ctx.globalAlpha;
    ctx.lineCap = "round";
    if (o.rail === true || (Number.isFinite(o.detail) && o.detail <= 1)) {
      ctx.globalAlpha = base * 0.8 * fade; ctx.strokeStyle = tones.accent; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(p.x, p.y, r * (1.1 + 0.5 * grow), 0, TAU); ctx.stroke();
      ctx.restore();
      return true;
    }
    const spin = (o.motion?.seed ?? 0) * TAU + grow * 0.9;
    ctx.globalAlpha = base * 0.9 * fade; ctx.lineWidth = 0.5 + 1.6 * fade;
    for (let index = 0; index < 3; index += 1) {
      const from = spin + index * TAU / 3 + 0.15;
      ctx.beginPath(); ctx.arc(p.x, p.y, r * (1.05 + 0.6 * grow), from, from + TAU / 3 - 0.3);
      ctx.strokeStyle = tones.spectrum[index]; ctx.stroke();
    }
    ctx.globalAlpha = base * 0.8 * fade * fade; ctx.fillStyle = tones.glare;
    ctx.beginPath(); prismStar(ctx, p.x, p.y - r * 0.3, r * (0.45 + 0.35 * grow)); ctx.fill();
    ctx.restore();
    return true;
  }
  // How far the look reaches: the shards while it works, the dispersed ring
  // while selected.
  function prismReach(m) {
    const work = prismLevel(m?.work, 0), sel = prismLevel(m?.sel, 0);
    return Math.max(1.1 + 0.45 * work, sel > 0.01 ? 1.3 : 1.1);
  }
  LOOKS.prism = { speedup: 2.5, paint: paintPrism, glyph: { scale: 0.56, ringGap: 3.5, ink: lightInk }, ring: prismRing, hubDress: prismHub, orbit: prismOrbit, arrival: prismArrival, select: prismSelect, wire: prismWire, surge: prismSurge, land: prismLand, reach: prismReach };

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
