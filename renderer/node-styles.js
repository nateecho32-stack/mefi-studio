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

  // A black hole. A pitch-black horizon (.50) inside a thin photon ring
  // (.55), brightest on top where the lensed far side of the disc shows; a
  // tilted, squashed accretion disc (.62–1.08) whose far half passes behind
  // the horizon and whose near half crosses in front of it; an aura with a
  // lensing ring near 1.26. The disc's brightness is a FIXED Doppler conic
  // (the approaching left side burns white, the receding side dims to a
  // trace of the theme's second hue); a second conic of irregular bright
  // streaks is turned with ctx.rotate under the same path, so the plasma
  // circles the hole without a path or a gradient being rebuilt (4 s a turn
  // idle, four times faster at work). Matter streaks in all the time along
  // spiralling paths, faster as it falls; while it works, relativistic jets
  // leave along the disc's axis with knots travelling out. Every gradient is
  // a unit-space paint cached per canvas, tint and theme; levels ride
  // globalAlpha gains (never above the caller's alpha); reduced motion holds
  // one designed pose: streaks at the node's own angle, sparks frozen, jets
  // at full length.
  const HOLE_BLACK = Object.freeze([2, 1, 5]);
  const HOLE_NO_DASH = Object.freeze([]);
  const HOLE_QUEUE_DASH = Object.freeze([2, 3]);
  const HOLE_CREW_DASH = Object.freeze([2, 5]);
  // The streak conic's bright bands, as [centre, width, alpha] triples around
  // the turn: irregular on purpose, so the turning disc never looks spoked.
  // Nothing narrower than .07 of a turn: at the working spin (a turn a
  // second, .033 a frame at 30 Hz) no band jumps its own width in a frame.
  // No band fainter than .42, so the turn reads at rest too.
  const HOLE_BANDS = Object.freeze([
    0.05, 0.07, 0.6, 0.18, 0.1, 0.44, 0.31, 0.07, 0.52,
    0.46, 0.12, 0.42, 0.6, 0.07, 0.62, 0.76, 0.1, 0.46, 0.9, 0.07, 0.5,
  ]);
  const HOLE_SPARK_MAX = 8;
  // Spark scratch, five numbers per spark: tail x, y, head x, y, and the side
  // it is on (0 none, 1 behind the horizon, 2 in front), in the tilted frame.
  const HOLE_SPARKS = new Float64Array(HOLE_SPARK_MAX * 5);
  // One point scratch for the hooks (ellipse and curve points).
  const HOLE_POINT = { x: 0, y: 0, depth: 0 };
  const HOLE_BEND = { cx: 0, cy: 0, len: 0 };
  // The T0 hot spot's tail sits .55 rad behind its head on the disc.
  const HOLE_SPOT_COS = Math.cos(0.55), HOLE_SPOT_SIN = Math.sin(0.55);
  const HOLE_SPIRAL = { x0: 0, y0: 0, rho0: 0, angle0: 0, dir: 1, end: 0, rhoEnd: 0, cut: 0.85 };

  const holeFrac = (value) => value - Math.floor(value);
  // Where a node is in a period of `period` animation seconds, offset by its seed.
  const holePhase = (clock, seedValue, period) => holeFrac((clock + seedValue * 97) / period);
  // A level from the motion record, else the flag the caller passed.
  const holeLevel = (value, fallback) => Number.isFinite(value) ? clamp01(value) : fallback;
  // Every node leans its disc a little differently (−.38 … −.14 rad).
  const holeTilt = (seedValue) => -0.26 + (seedValue - 0.5) * 0.24;
  const holeSeed = (m) => m && Number.isFinite(m.seed) ? m.seed : 0;
  const holeClock = (m, o) => m && Number.isFinite(m.clock) ? m.clock : (Number.isFinite(o.time) ? o.time : 0) / 1000;

  // The tones of one tint under one theme, cached per triple. The horizon is
  // black on every theme; `hot` whitens the tint (less on a light theme, so
  // the disc keeps its colour against a pale page); `lens` draws the lensing
  // and selection rings (the tint itself on a light theme, where a whitened
  // ring would vanish); accent is the theme's second hue or a whitened tint.
  const holeToneMemo = new WeakMap();
  function holeTones(tint, currentTheme) {
    let tones = holeToneMemo.get(tint);
    if (tones && tones.themeKey === currentTheme.key) return tones;
    const light = currentTheme.light === true;
    const hot = mix(tint, WHITE, light ? 0.42 : 0.6), ink = mix(tint, WHITE, 0.86);
    // On a pale page brightness reads as depth: the approaching side and the
    // streaks go deeper and more saturated instead of whiter. The receding
    // side keeps the tint with only a trace of the second hue, so a state's
    // colour (done green, blocked amber) still owns the whole disc.
    const accent = currentTheme.accent2 ?? mix(tint, WHITE, 0.72);
    tones = {
      themeKey: currentTheme.key, light,
      key: `singularity|${tint.join(",")}|${currentTheme.key}`,
      hot, ink, lens: light ? tint : hot,
      beam: light ? mix(tint, HOLE_BLACK, 0.22) : hot,
      glint: light ? mix(tint, HOLE_BLACK, 0.45) : ink,
      rim: light ? mix(tint, HOLE_BLACK, 0.3) : ink,
      deep: mix(tint, currentTheme.bg, 0.86), shade: mix(tint, HOLE_BLACK, 0.7),
      accent, recede: mix(tint, accent, 0.3),
    };
    holeToneMemo.set(tint, tones);
    return tones;
  }

  // The body's paints: built once per canvas, tint and theme (7 gradients,
  // 2 of them conic), then only moved by the transform.
  function holePaints(ctx, tint, currentTheme) {
    const tones = holeTones(tint, currentTheme);
    const cached = cacheGet(ctx, tones.key);
    if (cached) return cached;
    const { hot, ink, lens, beam, glint, rim, deep, shade, recede } = tones;
    const conic = typeof ctx.createConicGradient === "function";
    // The aura: light bent round the shadow, brightest hugging it, with a
    // soft lensing ring near 1.26 radii. Hollow under the horizon (clear up to
    // .48), so a dimmed node's shadow stays black.
    const aura = ctx.createRadialGradient(0, 0, 0.45, 0, 0, 1.72);
    aura.addColorStop(0, rgba(tint, 0));
    aura.addColorStop(0.025, rgba(tint, 0));
    aura.addColorStop(0.08, rgba(tint, 0.5));
    aura.addColorStop(0.2, rgba(tint, 0.22));
    aura.addColorStop(0.4, rgba(tint, 0.08));
    aura.addColorStop(0.57, rgba(tint, 0.04));
    aura.addColorStop(0.64, rgba(lens, 0.15));
    aura.addColorStop(0.72, rgba(tint, 0.03));
    aura.addColorStop(1, rgba(tint, 0));
    // The Doppler beaming: the approaching (left) side white-hot, the
    // receding side dim, with a thin trace of the second hue. It never turns.
    const doppler = conic ? ctx.createConicGradient(Math.PI, 0, 0) : ctx.createRadialGradient(-0.6, 0, 0, -0.2, 0, 1.3);
    doppler.addColorStop(0, rgba(beam, 1));
    doppler.addColorStop(0.1, rgba(tint, 1));
    doppler.addColorStop(0.3, rgba(tint, 0.58));
    doppler.addColorStop(0.42, rgba(tint, 0.45));
    doppler.addColorStop(0.5, rgba(recede, 0.36));
    doppler.addColorStop(0.58, rgba(tint, 0.45));
    doppler.addColorStop(0.7, rgba(tint, 0.58));
    doppler.addColorStop(0.9, rgba(tint, 1));
    doppler.addColorStop(1, rgba(beam, 1));
    // The plasma streaks that turn (a banded sweep without conic support).
    const streaks = conic ? ctx.createConicGradient(0, 0, 0) : ctx.createLinearGradient(-1.1, 0, 1.1, 0);
    streaks.addColorStop(0, rgba(glint, 0));
    for (let index = 0; index < HOLE_BANDS.length; index += 3) {
      const at = HOLE_BANDS[index], half = HOLE_BANDS[index + 1] / 2;
      streaks.addColorStop(at - half, rgba(glint, 0));
      streaks.addColorStop(at, rgba(glint, HOLE_BANDS[index + 2]));
      streaks.addColorStop(at + half, rgba(glint, 0));
    }
    streaks.addColorStop(1, rgba(glint, 0));
    // The disc's white-hot inner edge, cooling outward into the page.
    const edge = ctx.createRadialGradient(0, 0, 0.6, 0, 0, 1.1);
    edge.addColorStop(0, rgba(rim, 0.85));
    edge.addColorStop(0.12, rgba(beam, 0.38));
    edge.addColorStop(0.4, rgba(beam, 0));
    edge.addColorStop(0.82, rgba(deep, 0));
    edge.addColorStop(1, rgba(deep, 0.55));
    // The horizon: pitch black with a soft shade edge.
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.52);
    core.addColorStop(0, rgba(HOLE_BLACK, 1));
    core.addColorStop(0.82, rgba(HOLE_BLACK, 1));
    core.addColorStop(0.95, rgba(shade, 1));
    core.addColorStop(1, rgba(shade, 0.6));
    // The photon ring, brightest on top: the far side of the disc, lensed.
    const photon = ctx.createLinearGradient(0, -0.58, 0, 0.58);
    photon.addColorStop(0, rgba(ink, 1));
    photon.addColorStop(0.5, rgba(hot, 0.95));
    photon.addColorStop(1, rgba(tint, 0.7));
    // Both jets in one symmetric paint (they leave from the horizon's edge,
    // hottest just past it).
    const jet = ctx.createLinearGradient(0, -1.6, 0, 1.6);
    jet.addColorStop(0, rgba(tint, 0));
    jet.addColorStop(0.22, rgba(beam, 0.45));
    jet.addColorStop(0.3, rgba(rim, 0.85));
    jet.addColorStop(0.7, rgba(rim, 0.85));
    jet.addColorStop(0.78, rgba(beam, 0.45));
    jet.addColorStop(1, rgba(tint, 0));
    return cachePut(ctx, tones.key, {
      tones, aura, doppler, streaks, edge, core, photon, jet,
      // Infalling matter: a whitened glint on a dark page, a deep beam on a pale one.
      spark: rgba(tones.light ? beam : glint, 0.8), knot: rgba(rim, 0.95), spot: rgba(rim, 1), black: rgba(HOLE_BLACK, 1),
      ring: tones.light ? rgba(tint, 1) : photon, glow: rgba(tint, 1), hot: rgba(hot, 1), lens: rgba(lens, 1),
    });
  }

  // How many infalling sparks a node carries, as a continuous count so a
  // tier change or the work easing in grows them instead of popping them:
  // none at T0, two at T1 while working, 3 → 5 at T2, 5 → 8 at T3.
  function holeSparkCount(detail, radius, work) {
    if (detail <= 0) return 0;
    const t1 = 2 * work;
    if (detail === 1) return t1 * tierIn(radius, 1);
    const t2 = 3 + 2 * work;
    if (detail === 2) return t1 + (t2 - t1) * tierIn(radius, 2);
    return t2 + (5 + 3 * work - t2) * tierIn(radius, 3);
  }
  // Spark k leaves the disc's rim (1.12 radii) and falls to the horizon
  // along a spiral (angle decreasing, with the disc), faster as it falls; its
  // streak grows from nothing, lengthens with its speed and closes up before
  // it vanishes.
  function holeSparkPoint(u, start, sq, at) {
    const rest = 1 - u;
    const rho = 0.52 + 0.6 * rest * Math.sqrt(rest);
    const phi = start - 4.5 * u * Math.sqrt(u);
    const sin = Math.sin(phi);
    HOLE_SPARKS[at] = rho * Math.cos(phi);
    HOLE_SPARKS[at + 1] = rho * sin * sq;
    return sin;
  }
  function holeSparkField(seedValue, clock, still, count, sq) {
    const n = Math.min(HOLE_SPARK_MAX, Math.ceil(count - 1e-9));
    for (let k = 0; k < n; k += 1) {
      const at = k * 5, presence = clamp01(count - k);
      const lag = hash(seedValue, k), start = TAU * hash(seedValue, k + 7);
      const u = still ? 0.12 + 0.76 * lag : holeFrac(clock / 3.6 + lag);
      // A streak spans at most ~.45 rad of its spiral (short near the
      // horizon, where it sweeps fastest), growing in and closing up.
      const length = Math.min(u, Math.min(0.12, 0.067 / Math.sqrt(u + 0.01)) * presence * Math.min(1, (1 - u) / 0.18));
      if (!(length > 0.002)) { HOLE_SPARKS[at + 4] = 0; continue; }
      holeSparkPoint(u - length, start, sq, at);
      const near = holeSparkPoint(u, start, sq, at + 2) > 0;
      // A spark behind the horizon and already inside its shadow is hidden.
      const hx = HOLE_SPARKS[at + 2], hy = HOLE_SPARKS[at + 3];
      HOLE_SPARKS[at + 4] = near ? 2 : hx * hx + hy * hy < 0.27 ? 0 : 1;
    }
    return n;
  }
  // One side's sparks (1 behind the horizon, 2 in front) in one stroke; the
  // round caps (set once by the painter) soften a thin streak's ends.
  function holeSparkStroke(ctx, n, side, style, alpha, width) {
    let any = false;
    for (let k = 0; k < n; k += 1) {
      const at = k * 5;
      if (HOLE_SPARKS[at + 4] !== side) continue;
      if (!any) { ctx.beginPath(); any = true; }
      ctx.moveTo(HOLE_SPARKS[at], HOLE_SPARKS[at + 1]); ctx.lineTo(HOLE_SPARKS[at + 2], HOLE_SPARKS[at + 3]);
    }
    if (!any) return;
    ctx.globalAlpha = alpha; ctx.strokeStyle = style; ctx.lineWidth = width; ctx.stroke();
  }
  // The disc's fills in the squashed disc frame, over the path already
  // built: the Doppler light stays put; the streaks turn by rotating the frame
  // between fills (the path was built before, so only the texture moves); the
  // hot inner edge on the near half.
  function holeDiscFills(ctx, paints, alpha, disc, streak, edge, spin) {
    ctx.globalAlpha = alpha * disc; ctx.fillStyle = paints.doppler; ctx.fill();
    if (streak > 0) {
      ctx.rotate(-spin);
      ctx.globalAlpha = alpha * streak; ctx.fillStyle = paints.streaks; ctx.fill();
      ctx.rotate(spin);
    }
    if (edge > 0) { ctx.globalAlpha = alpha * edge; ctx.fillStyle = paints.edge; ctx.fill(); }
  }
  // Where a disc ellipse (radius R, squashed by sq) enters the horizon's
  // circle (.52), as the angle past π on its far half; π/2 when it clears it.
  function holeEntry(R, sq) {
    const share = (0.2704 / (R * R) - sq * sq) / (1 - sq * sq);
    return share > 0 && share < 1 ? Math.acos(Math.sqrt(share)) : Math.PI / 2;
  }
  // The far half of the disc (upper, behind the horizon) and its image lensed
  // up over the top of the horizon: a crescent hugging the photon ring,
  // thickest on top and tapering into the disc at both sides. One path, so
  // the arc and the disc wear the same Doppler light and turning streaks (the
  // crescent is traced in the tilted frame, the half in the squashed one).
  // The far half is two wings that stop where they pass behind the horizon
  // (closed by a chord a hair inside it), so nothing is painted under the
  // shadow and a node at rest alpha keeps it black. The fill closes every
  // subpath itself.
  function holeFar(ctx, paints, alpha, sq, disc, streak, spin) {
    ctx.beginPath();
    ctx.arc(0, 0, 0.74, Math.PI + 0.26, TAU - 0.26);
    ctx.arc(0, 0, 0.585, TAU - 0.04, Math.PI + 0.04, true);
    ctx.scale(1, sq);
    const outer = holeEntry(1.08, sq), inner = holeEntry(0.62, sq);
    const ix = 0.62 * Math.cos(inner), iy = 0.62 * Math.sin(inner);
    ctx.moveTo(-1.08, 0);
    ctx.arc(0, 0, 1.08, Math.PI, Math.PI + outer);
    ctx.lineTo(-ix, -iy);
    ctx.arc(0, 0, 0.62, Math.PI + inner, Math.PI, true);
    ctx.moveTo(1.08 * Math.cos(outer), -1.08 * Math.sin(outer));
    ctx.arc(0, 0, 1.08, TAU - outer, TAU);
    ctx.lineTo(0.62, 0);
    ctx.arc(0, 0, 0.62, TAU, TAU - inner, true);
    holeDiscFills(ctx, paints, alpha, disc, streak, 0, spin);
    ctx.scale(1, 1 / sq);
  }
  // The near half (lower), crossing in front of the horizon.
  function holeNear(ctx, paints, alpha, sq, disc, streak, edge, spin) {
    ctx.scale(1, sq);
    ctx.beginPath();
    ctx.arc(0, 0, 1.08, 0, Math.PI); ctx.arc(0, 0, 0.62, Math.PI, 0, true);
    holeDiscFills(ctx, paints, alpha, disc, streak, edge, spin);
    ctx.scale(1, 1 / sq);
  }
  // T0 (under 6 px, most todos): a tiny ringed planet in at most 36 canvas
  // operations, dispatcher included. The aura (its breathe is invisible this
  // small; the lit level rides its alpha), the disc's halves traced as
  // ellipses (no squashing transform: the fixed Doppler light alone), the
  // horizon and a solid photon ring, and one hot spot riding the disc, drawn
  // behind the horizon or in front of it. The spot and the ring share one
  // stroke style and width, so whichever comes second sets neither.
  function holeTiny(ctx, paints, base, lit, kick, sq, spin, nearGain, radius, horizon) {
    const glow = Math.min(1, 0.78 + 0.22 * lit + 0.3 * kick);
    ctx.globalAlpha = base * glow;
    ctx.beginPath(); ctx.arc(0, 0, 1.72, 0, TAU); ctx.fillStyle = paints.aura; ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, 0, 1.08, 1.08 * sq, 0, Math.PI, TAU); ctx.ellipse(0, 0, 0.62, 0.62 * sq, 0, TAU, Math.PI, true);
    ctx.fillStyle = paints.doppler; ctx.fill();
    // The spot's head, and its tail .55 rad behind it on the disc.
    const angle = 2.3 - spin, cos = Math.cos(angle), sin = Math.sin(angle);
    const hx = 0.86 * cos, hy = 0.86 * sq * sin;
    const tx = 0.86 * (cos * HOLE_SPOT_COS - sin * HOLE_SPOT_SIN), ty = 0.86 * sq * (sin * HOLE_SPOT_COS + cos * HOLE_SPOT_SIN);
    const near = sin > 0, width = 0.9 / radius;
    if (!near) {
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy);
      ctx.strokeStyle = paints.spot; ctx.lineWidth = width; ctx.stroke();
    }
    ctx.globalAlpha = base;
    ctx.beginPath(); ctx.arc(0, 0, horizon, 0, TAU); ctx.fillStyle = paints.black; ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, horizon + 0.03, 0, TAU);
    if (near) { ctx.strokeStyle = paints.spot; ctx.lineWidth = width; }
    ctx.stroke();
    ctx.globalAlpha = base * glow * nearGain;
    ctx.beginPath(); ctx.ellipse(0, 0, 1.08, 1.08 * sq, 0, 0, Math.PI); ctx.ellipse(0, 0, 0.62, 0.62 * sq, 0, Math.PI, 0, true);
    ctx.fillStyle = paints.doppler; ctx.fill();
    if (near) { ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke(); }
  }

  function paintSingularity(ctx, p, radius, tint, o, m) {
    const currentTheme = o.theme ?? INK_DEFAULTS;
    const paints = holePaints(ctx, tint, currentTheme);
    const still = m.still === true || o.still === true;
    const detail = Number.isFinite(o.detail) ? o.detail : 3;
    const base = o.alpha;
    const lit = holeLevel(m.lit, o.active || o.selected ? 1 : 0);
    const work = holeLevel(m.work, o.active ? 1 : 0);
    const sel = holeLevel(m.sel, o.selected ? 1 : 0);
    const kick = still ? 0 : holeLevel(m.kick, 0);
    const seedValue = holeSeed(m);
    const clock = still || !Number.isFinite(m.clock) ? 0 : m.clock;
    const time = still ? 0 : o.time;
    const tilt = holeTilt(seedValue), cos = Math.cos(tilt), sin = Math.sin(tilt);
    const sq = still ? 0.34 : 0.34 * (1 + 0.06 * Math.sin(TAU * holePhase(clock, seedValue, 9)));
    const spin = TAU * holePhase(clock, seedValue, 4);
    const nearGain = o.glyph ? 0.4 : 1;
    // The hub's monogram (a fixed 10 px glyph) always sits on black: a small
    // hub widens its horizon to ~6.5 px (never past 1.7 radii).
    const horizon = o.monogram ? Math.min(1.7, Math.max(0.52, 6.5 / radius)) : 0.52;
    ctx.save();
    if (detail <= 0) {
      // One transform places, sizes and tilts the node.
      ctx.transform(radius * cos, radius * sin, -radius * sin, radius * cos, p.x, p.y);
      holeTiny(ctx, paints, base, lit, kick, sq, spin, nearGain, radius, horizon);
      ctx.restore();
      voidMonogram(ctx, p, o, paints.tones.ink);
      return;
    }
    // 1. The aura breathes, swells when lit and gulps inward when a pulse
    // lands; it is round, so it is drawn in the tilted frame, scaled once.
    const breathe = still ? 1 : 1 + 0.02 * Math.sin(TAU * holePhase(clock, seedValue, 4.6));
    const aura = (0.88 + 0.12 * lit) * breathe * (1 - 0.6 * kick * (1 - kick));
    const size = radius * aura;
    ctx.transform(size * cos, size * sin, -size * sin, size * cos, p.x, p.y);
    ctx.globalAlpha = base * Math.min(1, 0.7 + 0.3 * lit + 0.4 * kick);
    ctx.beginPath(); ctx.arc(0, 0, 1.72, 0, TAU); ctx.fillStyle = paints.aura; ctx.fill();
    ctx.scale(1 / aura, 1 / aura);
    const sparks = holeSparkCount(detail, radius, work);
    const n = sparks > 0 ? holeSparkField(seedValue, clock, still, sparks, sq) : 0;
    const jets = work > 0.02 ? work * 0.9 * tierIn(radius, 1) : 0;
    const knots = detail >= 3 ? jets * tierIn(radius, 3) : 0;
    // Round caps only for the short strokes (sparks, knots).
    if (n || knots > 0) ctx.lineCap = "round";
    // 2. Relativistic jets along the disc's axis while it works, flickering,
    // with knots travelling out (T3): one phase serves both jets, and a knot
    // is born at the horizon's rim and thins and fades before the tip.
    if (jets > 0) {
      const up = still ? 1.52 : 1.5 + 0.075 * Math.sin(time / 83 + 6 * seedValue);
      const down = still ? 1.52 : 1.5 + 0.075 * Math.sin(time / 71 + 2 + 6 * seedValue);
      ctx.beginPath();
      ctx.moveTo(-0.1, -0.53); ctx.lineTo(0, -up); ctx.lineTo(0.1, -0.53);
      ctx.moveTo(-0.1, 0.53); ctx.lineTo(0, down); ctx.lineTo(0.1, 0.53);
      ctx.globalAlpha = base * jets; ctx.fillStyle = paints.jet; ctx.fill();
      const f = still ? 0.45 : holeFrac(time / 600 + seedValue);
      const fade = knots * Math.sin(Math.PI * f);
      if (fade > 0.004) {
        const length = 0.14 * (1 - f) + 0.04;
        const top = 0.62 + (up - 0.94) * f, bottom = 0.62 + (down - 0.94) * f;
        ctx.beginPath();
        ctx.moveTo(0, -top); ctx.lineTo(0, -top - length);
        ctx.moveTo(0, bottom); ctx.lineTo(0, bottom + length);
        ctx.globalAlpha = base * fade; ctx.strokeStyle = paints.knot;
        ctx.lineWidth = Math.max(0.08, 1.1 / radius) * (1 - 0.55 * f); ctx.stroke();
      }
    }
    // 3. The far half of the disc and its lensed image, then the sparks
    // behind the horizon (brighter while it works).
    const disc = 0.85 + 0.15 * lit;
    const streak = (0.72 + 0.28 * work) * tierIn(radius, 1);
    const edge = detail >= 2 ? Math.min(1, 0.8 + 0.2 * lit + 0.35 * kick) * tierIn(radius, 2) : 0;
    const sparkGain = paints.tones.light ? 0.4 + 0.3 * work : 0.55 + 0.35 * work;
    const sparkWidth = Math.max(0.055, 0.8 / radius);
    holeFar(ctx, paints, base, sq, disc, streak, spin);
    if (n) holeSparkStroke(ctx, n, 1, paints.spark, base * sparkGain, sparkWidth);
    // 4. The horizon, then the photon ring (thicker when selected, flashing
    // when a pulse lands).
    ctx.globalAlpha = base;
    ctx.beginPath(); ctx.arc(0, 0, horizon, 0, TAU); ctx.fillStyle = horizon > 0.52 ? paints.black : paints.core; ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, horizon + 0.03, 0, TAU);
    ctx.lineWidth = Math.max(0.75 / radius, 0.07 + 0.04 * sel + 0.05 * kick);
    ctx.strokeStyle = paints.photon; ctx.stroke();
    // 5. The near half crossing in front of the horizon (faint on a node that
    // wears a glyph, so the glyph reads), then the sparks in front.
    holeNear(ctx, paints, base * nearGain, sq, disc, streak, edge, spin);
    if (n) holeSparkStroke(ctx, n, 2, paints.spark, base * nearGain * sparkGain, sparkWidth);
    ctx.restore();
    voidMonogram(ctx, p, o, paints.tones.ink);
  }

  // The hooks' shared frame: the node's own tilt and phase, whatever `o` carries.
  const holeTheme = (o) => o.theme ?? INK_DEFAULTS;
  const holeStill = (o) => o.still === true || o.motion?.still === true;
  const holeBase = (ctx) => Number.isFinite(ctx.globalAlpha) ? ctx.globalAlpha : 1;
  // A tilted ellipse through the transform: the path is built in the squashed
  // frame and stroked after restore(), so its line keeps an even width.
  function holeEllipsePath(ctx, p, rx, squash, tilt) {
    ctx.save();
    ctx.translate(p.x, p.y); ctx.rotate(tilt); ctx.scale(rx, rx * squash);
    ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU);
    ctx.restore();
  }
  // A point on a tilted ellipse (cos and sin of the tilt passed in).
  function holeOrbitPoint(p, rx, ry, cos, sin, angle) {
    const ex = Math.cos(angle) * rx, s = Math.sin(angle), ey = s * ry;
    HOLE_POINT.x = p.x + ex * cos - ey * sin;
    HOLE_POINT.y = p.y + ex * sin + ey * cos;
    HOLE_POINT.depth = s;
    return HOLE_POINT;
  }
  // How visible a point on a ring is when it swings behind the body: faint
  // where the horizon hides it, full clear of the body's width.
  const holeHidden = (point, p, radius) => point.depth >= 0 ? 1 : 0.3 + 0.7 * clamp01((Math.abs(point.x - p.x) - 0.45 * radius) / (0.5 * radius));
  // A comet on a tilted ellipse: a head and a three-segment tail fading
  // behind it (the motion runs with the disc, angle decreasing).
  function holeComet(ctx, p, radius, rx, ry, cos, sin, angle, head, tail, width, alpha, segments, size) {
    let px = 0, py = 0;
    for (let index = segments; index >= 0; index -= 1) {
      const point = holeOrbitPoint(p, rx, ry, cos, sin, angle + index * 0.3);
      if (index < segments) {
        const fade = holeHidden(point, p, radius);
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(point.x, point.y);
        ctx.globalAlpha = alpha * fade * (0.85 - 0.25 * index); ctx.strokeStyle = tail; ctx.lineWidth = width * (1 - 0.25 * index); ctx.stroke();
      }
      px = point.x; py = point.y;
    }
    // HOLE_POINT holds the head now (index 0 came last).
    const point = HOLE_POINT;
    ctx.globalAlpha = alpha * holeHidden(point, p, radius);
    ctx.beginPath(); ctx.arc(point.x, point.y, size, 0, TAU); ctx.fillStyle = head; ctx.fill();
  }
  // A small state badge at the node's upper right (error "!", done tick),
  // popping in when the status changes.
  function holeBadge(ctx, p, radius, pop, well, rim, ink, done) {
    const bx = p.x + radius + 3, by = p.y - radius - 3;
    ctx.save();
    ctx.translate(bx, by);
    if (pop !== 1) ctx.scale(pop, pop);
    ctx.beginPath(); ctx.arc(0, 0, 5, 0, TAU); ctx.fillStyle = rgba(well, 1); ctx.fill();
    ctx.strokeStyle = rgba(rim, 0.9); ctx.lineWidth = 1; ctx.stroke();
    if (done) {
      ctx.strokeStyle = rgba(ink, 1); ctx.lineWidth = 1.4; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(-2.6, 0); ctx.lineTo(-0.8, 1.9); ctx.lineTo(2.6, -2); ctx.stroke();
    } else {
      ctx.fillStyle = rgba(ink, 1); ctx.font = '700 8px system-ui, "Segoe UI", sans-serif'; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("!", 0, 0.5);
    }
    ctx.restore();
  }

  // The agent status ring: a spark orbiting a tilted ellipse around the hole
  // with a fading tail (running), a dashed ellipse that drifts (queued), an
  // amber ellipse that pulses with its "!" badge (error), a green tick (done).
  function ringSingularity(ctx, p, radius, tint, o) {
    const status = o.status ?? null;
    const running = status === "running" || o.builder === true;
    if (!running && status !== "queued" && status !== "error" && status !== "done") return true;
    const currentTheme = holeTheme(o), m = o.motion ?? null, still = holeStill(o);
    const seedValue = holeSeed(m), tilt = holeTilt(seedValue), time = Number.isFinite(o.time) ? o.time : 0;
    const ring = Number.isFinite(o.ring) ? o.ring : radius + 4;
    const base = holeBase(ctx);
    ctx.save();
    if (running) {
      const tones = holeTones(tint, currentTheme);
      holeEllipsePath(ctx, p, ring, 0.4, tilt);
      ctx.globalAlpha = base * 0.3; ctx.strokeStyle = rgba(tint, 1); ctx.lineWidth = 0.8; ctx.stroke();
      const angle = still ? 2.4 : 2.4 - TAU * holePhase(holeClock(m, o), seedValue, 5.6);
      const segments = (o.detail ?? 3) >= 2 ? 3 : 1;
      ctx.lineCap = "round";
      // A white-hot head on a dark page, a deep one on a pale page.
      holeComet(ctx, p, radius, ring, ring * 0.4, Math.cos(tilt), Math.sin(tilt), angle, rgba(tones.light ? tones.rim : tones.ink, 1), rgba(tones.lens, 1), 1.6, base, segments, 1.35);
    } else if (status === "queued") {
      holeEllipsePath(ctx, p, ring, 0.4, tilt);
      ctx.setLineDash?.(HOLE_QUEUE_DASH);
      ctx.lineDashOffset = still ? 0 : -((time / 90 + seedValue * 5) % 5);
      ctx.globalAlpha = base * 0.6; ctx.strokeStyle = rgba(tint, 1); ctx.lineWidth = 1; ctx.stroke();
      ctx.setLineDash?.(HOLE_NO_DASH);
    } else {
      const done = status === "done";
      const statusAt = m && Number.isFinite(m.statusAt) ? m.statusAt : -1e9;
      const pop = still ? 1 : Math.max(0.01, easeOutBack((time - statusAt) / 320));
      if (!done) {
        const pulse = still ? 1 : 0.72 + 0.28 * Math.sin(TAU * (time / 850 + seedValue));
        holeEllipsePath(ctx, p, ring, 0.4, tilt);
        ctx.globalAlpha = base * 0.85 * pulse; ctx.strokeStyle = rgba(currentTheme.amber, 1); ctx.lineWidth = 1.4; ctx.stroke();
        ctx.globalAlpha = base;
        holeBadge(ctx, p, radius, pop, currentTheme.amberWell, currentTheme.amber, currentTheme.amber, false);
      } else {
        ctx.globalAlpha = base;
        holeBadge(ctx, p, radius, pop, currentTheme.doneWell, currentTheme.done, currentTheme.done, true);
      }
    }
    ctx.restore();
    return true;
  }

  // The hub's dress: a lensing ring well outside the disc, brightest on top
  // like the body's photon ring, over a faint halo, breathing gently; with a
  // crew out, the faint dashed ring they rest on drifts round.
  function hubSingularity(ctx, p, radius, tint, o) {
    const currentTheme = holeTheme(o), m = o.motion ?? null, still = holeStill(o);
    const paints = holePaints(ctx, tint, currentTheme);
    const seedValue = holeSeed(m), clock = holeClock(m, o);
    const breathe = still ? 0.5 : 0.5 + 0.5 * Math.sin(TAU * holePhase(clock, seedValue, 6));
    const base = holeBase(ctx);
    const ring = radius * 1.52 + breathe * 1.8;
    ctx.save();
    ctx.beginPath(); ctx.arc(p.x, p.y, ring + 1.2, 0, TAU);
    ctx.globalAlpha = base * (0.06 + 0.05 * breathe); ctx.strokeStyle = paints.glow; ctx.lineWidth = 3.2; ctx.stroke();
    const scale = ring / 0.55;
    ctx.save();
    ctx.translate(p.x, p.y); ctx.rotate(holeTilt(seedValue)); ctx.scale(scale, scale);
    ctx.beginPath(); ctx.arc(0, 0, 0.55, 0, TAU);
    ctx.globalAlpha = base * (0.42 + 0.3 * breathe); ctx.strokeStyle = paints.ring; ctx.lineWidth = 0.95 / scale; ctx.stroke();
    ctx.restore();
    if (o.crew) {
      ctx.setLineDash?.(HOLE_CREW_DASH);
      ctx.lineDashOffset = still ? 0 : (Number.isFinite(o.time) ? o.time : 0) / 400 % 7;
      ctx.beginPath(); ctx.arc(p.x, p.y, radius * 3.1, 0, TAU);
      ctx.globalAlpha = base * 0.12; ctx.strokeStyle = paints.glow; ctx.lineWidth = 0.8; ctx.stroke();
      ctx.setLineDash?.(HOLE_NO_DASH);
    }
    ctx.restore();
    return true;
  }

  // The work orbit: a tilted ellipse at r + 9 with comets in the node's own
  // tint, passing behind the hole and in front of it on the integrated
  // orbit phase (two comets while Running, one while Next).
  function orbitSingularity(ctx, p, radius, tint, o) {
    const currentTheme = holeTheme(o), m = o.motion ?? null, still = holeStill(o);
    const colour = tint ?? currentTheme.orbit;
    const tones = holeTones(colour, currentTheme);
    const ring = Number.isFinite(o.ring) ? o.ring : radius + 9;
    const tilt = holeTilt(holeSeed(m));
    const base = holeBase(ctx);
    const detail = o.detail ?? 3;
    ctx.save();
    holeEllipsePath(ctx, p, ring, 0.36, tilt);
    ctx.globalAlpha = base * 0.24; ctx.strokeStyle = rgba(colour, 1); ctx.lineWidth = 0.8; ctx.stroke();
    const phase = still ? (Number.isFinite(o.phase) ? o.phase : Math.PI / 3) : m && Number.isFinite(m.orbit) ? m.orbit : Number.isFinite(o.phase) ? o.phase : 0;
    const cos = Math.cos(tilt), sin = Math.sin(tilt);
    const comets = o.running === false || detail <= 1 ? 1 : 2;
    // White-hot heads on a dark page; on a pale page, deep ones that read.
    const head = rgba(tones.light ? tones.rim : tones.ink, 1), trail = rgba(colour, 1);
    ctx.lineCap = "round";
    for (let comet = 0; comet < comets; comet += 1) {
      holeComet(ctx, p, radius, ring, ring * 0.36, cos, sin, -phase + comet * Math.PI, head, trail, detail >= 2 ? 1.8 : 1.3, base * 0.95, detail >= 2 ? 3 : 1, detail >= 2 ? 1.4 : 1.1);
    }
    ctx.restore();
    return true;
  }

  // Arrival, an implosion: two rings fall in from 2.4 radii to .7 (fading in
  // only once inside 2.2, so nothing reaches past it), the aura rushes in
  // behind them, and the photon ring flashes as they land.
  function arrivalSingularity(ctx, p, radius, tint, t01, o) {
    if (holeStill(o)) return true;
    const t = clamp01(t01), paints = holePaints(ctx, tint, holeTheme(o));
    const alpha = Number.isFinite(o.alpha) ? o.alpha : 1;
    ctx.save();
    const gulp = Math.sin(Math.PI * t);
    if (gulp > 0.01) {
      const scale = radius * (1.25 - 0.6 * t);
      ctx.save(); ctx.translate(p.x, p.y); ctx.scale(scale, scale);
      ctx.globalAlpha = alpha * 0.55 * gulp;
      ctx.beginPath(); ctx.arc(0, 0, 1.72, 0, TAU); ctx.fillStyle = paints.aura; ctx.fill();
      ctx.restore();
    }
    ctx.strokeStyle = paints.lens;
    for (let index = 0; index < 2; index += 1) {
      const u = (t - index * 0.25) / 0.75;
      if (!(u > 0 && u < 1)) continue;
      const rest = 1 - u, size = 0.7 + 1.7 * rest * rest;
      const gain = 0.7 * Math.sin(Math.PI * u) * clamp01((2.2 - size) / 0.4);
      if (gain <= 0.004) continue;
      ctx.globalAlpha = alpha * gain; ctx.lineWidth = 1.5 - 0.5 * index;
      ctx.beginPath(); ctx.arc(p.x, p.y, radius * size, 0, TAU); ctx.stroke();
    }
    if (t > 0.72) {
      ctx.globalAlpha = alpha * 0.85 * Math.sin(Math.PI * (t - 0.72) / 0.28);
      ctx.strokeStyle = paints.hot; ctx.lineWidth = Math.max(1, radius * 0.1);
      ctx.beginPath(); ctx.arc(p.x, p.y, radius * 0.55, 0, TAU); ctx.stroke();
    }
    ctx.restore();
    return true;
  }

  // Hover and selection: a ring at 1.18 radii lit like the photon ring; the
  // chosen node also sends a ripple out every 1.3 s, from outside the aura's
  // lensing band (1.32 → 1.7 radii), so the rings never blur into one.
  function selectSingularity(ctx, p, radius, tint, o) {
    const m = o.motion ?? null, still = holeStill(o);
    const sel = m && Number.isFinite(m.sel) ? clamp01(m.sel) : o.selected || o.chosen ? 1 : 0;
    if (sel <= 0.01 && !o.chosen) return true;
    const level = o.chosen ? Math.max(sel, 0.6) : sel;
    const paints = holePaints(ctx, tint, holeTheme(o));
    const alpha = Number.isFinite(o.alpha) ? o.alpha : 1;
    const seedValue = holeSeed(m);
    ctx.save();
    const scale = radius * 1.18 / 0.55;
    ctx.translate(p.x, p.y); ctx.rotate(holeTilt(seedValue)); ctx.scale(scale, scale);
    ctx.beginPath(); ctx.arc(0, 0, 0.55, 0, TAU);
    ctx.globalAlpha = alpha * (o.chosen ? 0.82 : 0.7) * level; ctx.strokeStyle = paints.ring; ctx.lineWidth = (o.chosen ? 1.2 : 0.95) / scale; ctx.stroke();
    ctx.restore();
    if (o.chosen) {
      const time = Number.isFinite(o.time) ? o.time : 0;
      const u = still ? 0.35 : holeFrac(time / 1300 + seedValue);
      ctx.save();
      ctx.globalAlpha = alpha * 0.5 * (1 - u) * Math.sqrt(1 - u) * level; ctx.strokeStyle = paints.lens; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, radius * (1.32 + 0.38 * u), 0, TAU); ctx.stroke();
      ctx.restore();
    }
    return true;
  }

  // The gravity-bent path between a and b: a quadratic that sags, its control
  // point off the middle on the downhill side, as far as the wire lies level
  // (a level wire sags most, a vertical one hangs straight). The same curve
  // whichever end it is traced from, so a pulse running against a wire's
  // direction rides the wire exactly; motes (s = u²) and the pulse's last
  // spiral carry the fall into the target.
  function holeBend(ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    const lean = len > 0 ? 0.13 * dx / len : 0;
    HOLE_BEND.len = len;
    HOLE_BEND.cx = (ax + bx) / 2 - dy * lean;
    HOLE_BEND.cy = (ay + by) / 2 + dx * lean;
    return HOLE_BEND;
  }
  // A point at s along a wire: the tree's S-curve (cubic) when it has one,
  // else the gravity bend (quadratic).
  function holeWirePoint(a, b, cp, s) {
    const r = 1 - s;
    if (cp) {
      const w0 = r * r * r, w1 = 3 * r * r * s, w2 = 3 * r * s * s, w3 = s * s * s;
      HOLE_POINT.x = w0 * a.x + w1 * cp.x1 + w2 * cp.x2 + w3 * b.x;
      HOLE_POINT.y = w0 * a.y + w1 * cp.y1 + w2 * cp.y2 + w3 * b.y;
    } else {
      HOLE_POINT.x = r * r * a.x + 2 * r * s * HOLE_BEND.cx + s * s * b.x;
      HOLE_POINT.y = r * r * a.y + 2 * r * s * HOLE_BEND.cy + s * s * b.y;
    }
    return HOLE_POINT;
  }
  function holeWirePath(ctx, a, b, cp, shift, nx, ny) {
    const ox = nx * shift, oy = ny * shift;
    ctx.moveTo(a.x + ox, a.y + oy);
    if (cp) ctx.bezierCurveTo(cp.x1 + ox, cp.y1 + oy, cp.x2 + ox, cp.y2 + oy, b.x + ox, b.y + oy);
    else ctx.quadraticCurveTo(HOLE_BEND.cx + ox, HOLE_BEND.cy + oy, b.x + ox, b.y + oy);
  }
  // A mote's colour: the wire's tint, lifted a little (per triple).
  const holeMoteMemo = new WeakMap();
  function holeMote(tint) {
    let value = holeMoteMemo.get(tint);
    if (!value) { value = rgba(mix(tint, WHITE, 0.4), 1); holeMoteMemo.set(tint, value); }
    return value;
  }
  // A wire bent by the target's gravity, with motes falling INTO the target
  // (s = u², so they speed up as they near it): three on an active wire, one
  // at rest on a wire between larger nodes (both ends T2+) or on the hub's,
  // a session's or an inspected wire; the many small wires stay one line
  // each. The tree's S-curves keep their shape; a far (blurred) pen gets the
  // line alone; the rail bends every edge (at the cost of the line) and
  // carries motes only on the active session's edges. One save/restore per
  // edge hands the canvas back as it was: measured in Electron's software
  // canvas it costs less than reading the stroke style back, and it replaces
  // resetting the dash, its offset and the cap by hand.
  function wireSingularity(ctx, a, b, o) {
    const tint = o.tint;
    if (!tint) return false;
    const bend = holeBend(a.x, a.y, b.x, b.y);
    if (!(bend.len > 1)) return true;
    const rail = o.rail === true, still = o.still === true;
    const cp = !rail && o.curved && o.cp ? o.cp : null;
    const alpha = Number.isFinite(o.alpha) ? o.alpha : 1;
    const time = Number.isFinite(o.time) ? o.time : 0;
    ctx.save();
    ctx.globalAlpha = alpha; ctx.strokeStyle = rgba(tint, 1); ctx.lineWidth = Number.isFinite(o.width) ? o.width : 1;
    const dash = o.dash && o.dash.length ? o.dash : null;
    if (dash) {
      ctx.setLineDash?.(dash);
      if (o.march && !still) {
        let period = 0;
        for (let index = 0; index < dash.length; index += 1) period += dash[index];
        if (period > 0) ctx.lineDashOffset = -((time / 55) % period);
      }
    }
    ctx.beginPath();
    if (o.double && !rail) {
      const nx = (a.y - b.y) / bend.len, ny = (b.x - a.x) / bend.len;
      holeWirePath(ctx, a, b, cp, 1.6, nx, ny); holeWirePath(ctx, a, b, cp, -1.6, nx, ny);
    } else holeWirePath(ctx, a, b, cp, 0, 0, 0);
    ctx.stroke();
    const active = o.active === true;
    const lively = active || o.inspected === true || o.kind === "hub" || o.kind === "session" || (Number.isFinite(o.detail) ? o.detail : 3) >= 2;
    const motes = o.far || !lively || rail && !active ? 0 : still ? (active ? 1 : 0) : active ? (rail ? 2 : 3) : 1;
    if (motes) {
      const period = active ? 900 : 2600, seedValue = Number.isFinite(o.seed) ? o.seed : 0;
      ctx.beginPath();
      for (let k = 0; k < motes; k += 1) {
        const u = still ? Math.sqrt(0.6) : holeFrac(time / period + seedValue + k / motes);
        const tail = Math.max(0, u - 0.045);
        const from = holeWirePoint(a, b, cp, tail * tail);
        ctx.moveTo(from.x, from.y);
        const to = holeWirePoint(a, b, cp, u * u);
        ctx.lineTo(to.x, to.y);
      }
      // Half as bright again as the line they ride, so a dimmed or fading
      // wire dims its motes with it.
      if (dash) ctx.setLineDash?.(HOLE_NO_DASH);
      ctx.lineCap = "round";
      ctx.globalAlpha = Math.min(0.9, alpha * 1.5); ctx.strokeStyle = holeMote(tint); ctx.lineWidth = active ? 1.8 : 1.4;
      ctx.stroke();
    }
    ctx.restore();
    return true;
  }

  // Pulse colours, parsed once per colour string.
  const holeColours = new Map();
  function holeColour(value) {
    const key = typeof value === "string" ? value : "";
    let triple = holeColours.get(key);
    if (triple) return triple;
    const text = key.trim().replace(/^#/, "");
    const full = text.length === 3 ? text[0] + text[0] + text[1] + text[1] + text[2] + text[2] : text.slice(0, 6);
    const int = /^[\da-f]{6}$/i.test(full) ? parseInt(full, 16) : 0xa9ffcd;
    triple = Object.freeze([(int >> 16) & 255, (int >> 8) & 255, int & 255]);
    if (holeColours.size >= 32) holeColours.clear();
    holeColours.set(key, triple);
    return triple;
  }
  // A pulse colour's spark: a cached unit radial per canvas (built once).
  const holeSparkKeys = new WeakMap();
  function holeSparkPaints(ctx, rgb) {
    let key = holeSparkKeys.get(rgb);
    if (!key) { key = `singularity|spark|${rgb.join(",")}`; holeSparkKeys.set(rgb, key); }
    const cached = cacheGet(ctx, key);
    if (cached) return cached;
    const hot = mix(rgb, WHITE, 0.55);
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    glow.addColorStop(0, rgba(hot, 0.9));
    glow.addColorStop(0.35, rgba(rgb, 0.4));
    glow.addColorStop(1, rgba(rgb, 0));
    return cachePut(ctx, key, { glow, head: rgba(hot, 1), tail: rgba(rgb, 1), line: rgba(rgb, 1) });
  }
  // Where a pulse is at t: accelerating (t²) along the bent path until 85%,
  // then spiralling round the target, falling toward its horizon.
  function holeSurgePoint(from, to, t) {
    if (t <= HOLE_SPIRAL.cut) {
      const k = t / HOLE_SPIRAL.cut;
      return holeWirePoint(from, to, null, HOLE_SPIRAL.end * k * k);
    }
    const v = (t - HOLE_SPIRAL.cut) / (1 - HOLE_SPIRAL.cut);
    const rho = HOLE_SPIRAL.rho0 + (HOLE_SPIRAL.rhoEnd - HOLE_SPIRAL.rho0) * v * (0.35 + 0.65 * v);
    const angle = HOLE_SPIRAL.angle0 + HOLE_SPIRAL.dir * 2.6 * v;
    HOLE_POINT.x = to.x + Math.cos(angle) * rho;
    HOLE_POINT.y = to.y + Math.sin(angle) * rho;
    return HOLE_POINT;
  }
  // A pulse: a spark speeding along the gravity bend with a three-segment
  // tail, spiralling round its target over the last 15% (a wave pulse also
  // warms its whole path). The rail keeps its own pulses.
  function surgeSingularity(ctx, from, to, t, pulse, o) {
    if (o.rail === true) return false;
    const bend = holeBend(from.x, from.y, to.x, to.y);
    if (!(bend.len > 2)) return true;
    const rgb = holeColour(pulse?.color);
    const paints = holeSparkPaints(ctx, rgb);
    const small = pulse?.small === true, wave = o.kind === "wave" || pulse?.wave === true;
    ctx.save();
    ctx.lineCap = "round";
    if (holeStill(o)) {
      ctx.globalAlpha = 0.5; ctx.strokeStyle = paints.line; ctx.lineWidth = small ? 1.3 : 2;
      ctx.beginPath(); holeWirePath(ctx, from, to, null, 0, 0, 0); ctx.stroke();
      ctx.restore();
      return true;
    }
    const head = clamp01(t);
    if (wave) {
      ctx.globalAlpha = 0.3 * Math.sin(Math.PI * head); ctx.strokeStyle = paints.line; ctx.lineWidth = small ? 1.2 : 1.7;
      ctx.beginPath(); holeWirePath(ctx, from, to, null, 0, 0, 0); ctx.stroke();
    }
    // The spiral starts where the bend comes within ~2 radii of the target
    // (near its end the curve runs at twice the control point's distance).
    const rTo = o.rTo > 0 ? o.rTo : 8;
    const pull = 2 * Math.hypot(bend.cx - to.x, bend.cy - to.y);
    const end = Math.min(0.96, Math.max(0.25, 1 - (rTo * 1.9 + 4) / pull));
    HOLE_SPIRAL.end = end;
    const start = holeWirePoint(from, to, null, end);
    const vx = start.x - to.x, vy = start.y - to.y;
    const tx = (1 - end) * (bend.cx - from.x) + end * (to.x - bend.cx), ty = (1 - end) * (bend.cy - from.y) + end * (to.y - bend.cy);
    HOLE_SPIRAL.rho0 = Math.hypot(vx, vy); HOLE_SPIRAL.angle0 = Math.atan2(vy, vx);
    HOLE_SPIRAL.dir = vx * ty - vy * tx >= 0 ? 1 : -1;
    HOLE_SPIRAL.rhoEnd = rTo * 0.55;
    const size = small ? 0.75 : wave ? 1.25 : 1;
    // The tail: three segments behind the head, thinning and fading.
    let point = holeSurgePoint(from, to, head);
    let px = point.x, py = point.y;
    const hx = px, hy = py;
    ctx.strokeStyle = paints.tail;
    for (let index = 1; index <= 3; index += 1) {
      point = holeSurgePoint(from, to, Math.max(0, head - index * (wave ? 0.035 : 0.028)));
      ctx.globalAlpha = 0.62 - 0.17 * index; ctx.lineWidth = size * (2.6 - 0.55 * index);
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(point.x, point.y); ctx.stroke();
      px = point.x; py = point.y;
    }
    // The head: a cached glow and a white-hot core.
    const glow = size * 5.5;
    ctx.save(); ctx.translate(hx, hy); ctx.scale(glow, glow);
    ctx.globalAlpha = 1; ctx.fillStyle = paints.glow; ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1; ctx.fillStyle = paints.head;
    ctx.beginPath(); ctx.arc(hx, hy, size * 1.7, 0, TAU); ctx.fill();
    if (pulse?.packet) {
      ctx.globalAlpha = 0.8; ctx.strokeStyle = paints.head; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(hx, hy, size * 3.6, 0, TAU); ctx.stroke();
    }
    ctx.restore();
    return true;
  }

  // A landing, an implosion: a ring falling from 1.9 radii into the horizon
  // (the rail's single ring of the style, too). The node's own paint answers
  // with its kick: the aura gulps and the photon ring flashes.
  function landSingularity(ctx, p, radius, tint, u, o) {
    if (holeStill(o) || !tint) return true;
    const k = clamp01(u), r = radius > 0 ? radius : 8;
    const gain = 0.85 * Math.sin(Math.PI * k);
    if (gain <= 0.004) return true;
    const rest = 1 - k;
    ctx.save();
    ctx.globalAlpha = gain; ctx.strokeStyle = rgba(tint, 1); ctx.lineWidth = 0.8 + 1.2 * rest;
    ctx.beginPath(); ctx.arc(p.x, p.y, r * (0.55 + 1.35 * rest * rest), 0, TAU); ctx.stroke();
    ctx.restore();
    return true;
  }

  // reach: the disc spans 1.08 radii; the jets 1.58 while it works.
  LOOKS.singularity = {
    speedup: 4,
    paint: paintSingularity,
    glyph: { scale: 0.56, ringGap: 4, ink: lightInk },
    ring: ringSingularity,
    hubDress: hubSingularity,
    orbit: orbitSingularity,
    arrival: arrivalSingularity,
    select: selectSingularity,
    wire: wireSingularity,
    surge: surgeSingularity,
    land: landSingularity,
    reach: (m) => 1.1 + 0.48 * holeLevel(m?.work, 0),
  };

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
