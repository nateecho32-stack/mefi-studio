// The node styles the Shop sells (renderer/node-styles.js, "style:
// dragonscale", "style: constellation", "style: lantern" and "style: neon";
// the relay sells them as studio:style-dragonscale, -constellation, -lantern
// and -neon, renderer/music.js wears them once they are owned). Dragon
// scales: a domed gem in rows of overlapping scales, a shimmer flashing scale
// after scale, fire in the seams and embers at work, a twisting ribbon for a
// wire, embers for pulses and a coiling tail round the chosen gem. Star
// chart: a star with a soft glow, a bright core and four breathing
// diffraction spikes, a diagonal pair at work, dotted star-chart wires that
// stop short of every star, shooting stars, and a ring of tiny stars round
// the selection. Lanterns: a paper lantern swinging on its cord, ribbed and
// capped, its candle breathing and flickering at work; festival lights along
// its wires, small lanterns floating as pulses, fireflies round the chosen
// one. Neon: a tube ring with a white-hot core over a bloom on its plate,
// broken where its electrodes are, a bead in its middle, buzzing on when
// work starts; lit tubes for wires, sparks of current for pulses, a second
// tube in the theme's second hue round the chosen sign. Loaded whole through
// the shared harness; the shared contracts every look keeps (restore, Extra
// glow, dimming, finish beats, a light page's 3:1) are in
// tests/node_styles.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { NODE_STYLES_SOURCE as source, loadNodeStyles, recordingContext, gradientsBuilt, plain } from "./fixtures/node-styles-harness.mjs";

const P = { x: 50, y: 50 };
const TINT = [220, 180, 110];
const RADII = { 0: 4.5, 1: 7.5, 2: 9.8, 3: 12 };
const STATES = {
  quiet: {},
  working: { active: true },
  chosen: { selected: true, chosen: true },
  "working chosen": { active: true, selected: true, chosen: true },
};
const DARK = { background: "#0a0a0c", text: "#edeff2", accent2: "#36d1ff" };
const LIGHT = { background: "#eef1f5", text: "#18202c" };
const SHOP = ["dragonscale", "constellation", "lantern", "neon"];
const channels = (colour) => colour.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
const luminance = ([r, g, b]) => r * 0.2126 + g * 0.7152 + b * 0.0722;
// WCAG contrast of two triples.
const linear = (channel) => { const c = channel / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const relative = ([r, g, b]) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
const contrast = (a, b) => (Math.max(relative(a), relative(b)) + 0.05) / (Math.min(relative(a), relative(b)) + 0.05);

// A motion record stepped at 30 Hz in a node's state; `frames` more frames on.
function recordFor(styles, style, flags, frames = 90, id = `task:${style}`) {
  const record = styles.motionRecord(new Map(), id);
  const step = { style, active: flags.active === true, selected: flags.selected === true, progress: null, orbit: 1.1, status: flags.status ?? null, time: 0, frame: 0 };
  for (let frame = 0; frame < frames; frame += 1) { step.time = frame * 1000 / 30; step.frame = frame; styles.stepMotion(record, step, 1 / 30, false); }
  return { record, step };
}
function stepOn(styles, record, step, frames) {
  for (let frame = 0; frame < frames; frame += 1) { step.time += 1000 / 30; step.frame += 1; styles.stepMotion(record, step, 1 / 30, false); }
}
const paintOnce = (styles, style, radius, options, ctx = recordingContext({ center: P }), tint = TINT) => {
  styles.paint(ctx, style, P, radius, tint, { kind: "task", ...options });
  return ctx;
};
// The section's own text (banner to banner), comments left out.
const sectionOf = (name, next) => source.replace(/\r\n/g, "\n").split(`\n// ===== style: ${name} =====\n`)[1].split(`\n// ===== ${next} =====\n`)[0];

test("each registers every hook of its look, in the Shop's place among the styles, and speeds up at work", () => {
  const styles = loadNodeStyles();
  assert.deepEqual(plain(styles.STYLES).slice(-4), SHOP, "the Shop's come after the Void collection");
  assert.deepEqual(plain(styles.PREMIUM), ["singularity", "prism", "sigil"], "PREMIUM stays the Void collection's (free since 0.4.4)");
  const sections = { dragonscale: sectionOf("dragonscale", "style: constellation"), constellation: sectionOf("constellation", "style: lantern"), lantern: sectionOf("lantern", "style: neon"), neon: sectionOf("neon", "overlays") };
  const hooks = {
    dragonscale: ["paint: paintDragonscale", "arrival: dragonArrival", "select: dragonSelect", "done: dragonDone", "absorb: dragonAbsorb", "wire: dragonWire", "surge: dragonSurge", "land: dragonLand", "reach: dragonReach", "speedup: 2.4"],
    constellation: ["paint: paintConstellation", "arrival: starArrival", "select: starSelect", "done: starDone", "absorb: starAbsorb", "wire: starWire", "surge: starSurge", "land: starLand", "reach: starReach", "speedup: 2.2"],
    lantern: ["paint: paintLantern", "arrival: lanternArrival", "select: lanternSelect", "done: lanternDone", "absorb: lanternAbsorb", "wire: lanternWire", "surge: lanternSurge", "land: lanternLand", "reach: lanternReach", "speedup: 1.8"],
    neon: ["paint: paintNeon", "arrival: neonArrival", "select: neonSelect", "done: neonDone", "absorb: neonAbsorb", "wire: neonWire", "surge: neonSurge", "land: neonLand", "reach: neonReach", "speedup: 2.2"],
  };
  const SPEEDUP = { dragonscale: 2.4, constellation: 2.2, lantern: 1.8, neon: 2.2 };
  for (const style of SHOP) {
    const entry = sections[style].slice(sections[style].indexOf(`LOOKS.${style} = {`));
    for (const hook of hooks[style]) assert.ok(entry.includes(hook), `${style}: ${hook}`);
    // The agent ring, the hub's dress and the work orbit are the free looks' own.
    assert.ok(entry.includes("ring: null, hubDress: null, orbit: null"), `${style} keeps the shared ring, hub dress and orbit`);
    // Nothing per frame allocates through array helpers, blurs, filters or Path2D.
    const code = sections[style].replace(/^\s*\/\/.*$/gm, "");
    for (const banned of ["Array.from", ".filter(", ".map(", "shadowBlur", ".filter =", "createPattern", "Path2D", "new Array"]) assert.ok(!code.includes(banned), `no ${banned} in the ${style} section`);
    const record = styles.motionRecord(new Map(), `task:${style}`);
    styles.stepMotion(record, { style, active: true, selected: false, progress: null, orbit: 0, status: null, time: 0, frame: 0 }, 5, true);
    const clock = record.clock;
    styles.stepMotion(record, { style, active: true, selected: false, progress: null, orbit: 0, status: null, time: 0, frame: 1 }, 0.05, false);
    assert.ok(Math.abs(record.clock - clock - 0.05 * SPEEDUP[style]) < 1e-12, `${style} runs its clock faster at work`);
    // A glyph's ink reads on what it sits on: the dark wells and the neon's
    // plate take a light ink on a dark page and a dark one on a light page;
    // a lantern inks its glyph dark on a paper label (its own test).
    const dark = luminance(channels(styles.glyph(style, [120, 180, 220], styles.theme(DARK)).ink)), light = luminance(channels(styles.glyph(style, [120, 180, 220], styles.theme(LIGHT)).ink));
    if (style === "lantern") assert.ok(dark < 60 && light < 60, `${style}: dark ink (${dark}, ${light})`);
    else assert.ok(dark > 200 && light < 60, `${style}: light ink on a dark page, dark on a light one (${dark}, ${light})`);
  }
});

test("each keeps inside its budget at every tier and state, frame after frame, and inside its reach", () => {
  const styles = loadNodeStyles();
  // Worst case over eight seconds (two shimmer passes, a spike breath, two
  // swings), per tier: canvas calls, arcs, ellipses, lines, fills, strokes.
  const BUDGET = {
    dragonscale: { 0: { calls: 70, arc: 10, ellipse: 0, lineTo: 0, fill: 3, stroke: 4 }, 1: { calls: 125, arc: 26, ellipse: 0, lineTo: 0, fill: 3, stroke: 11 }, 2: { calls: 150, arc: 35, ellipse: 0, lineTo: 0, fill: 3, stroke: 13 }, 3: { calls: 160, arc: 38, ellipse: 0, lineTo: 0, fill: 6, stroke: 13 } },
    constellation: { 0: { calls: 48, arc: 2, ellipse: 0, lineTo: 7, fill: 3, stroke: 0 }, 1: { calls: 48, arc: 2, ellipse: 0, lineTo: 7, fill: 3, stroke: 0 }, 2: { calls: 48, arc: 2, ellipse: 0, lineTo: 7, fill: 3, stroke: 0 }, 3: { calls: 60, arc: 2, ellipse: 0, lineTo: 14, fill: 4, stroke: 0 } },
    // the glow, the candle, the paper, its ribs and rim; the caps (T1), the cord and lips (T2), the tassel (T3)
    lantern: { 0: { calls: 60, arc: 2, ellipse: 2, lineTo: 0, fill: 3, stroke: 2 }, 1: { calls: 82, arc: 2, ellipse: 2, lineTo: 6, fill: 4, stroke: 3 }, 2: { calls: 102, arc: 2, ellipse: 2, lineTo: 9, fill: 4, stroke: 5 }, 3: { calls: 115, arc: 2, ellipse: 2, lineTo: 13, fill: 5, stroke: 5 } },
    // the plate, the bloom, the tube and its core; the electrodes (T1), the bead (T2), the glass (T3)
    neon: { 0: { calls: 40, arc: 3, ellipse: 0, lineTo: 0, fill: 2, stroke: 2 }, 1: { calls: 48, arc: 5, ellipse: 0, lineTo: 0, fill: 3, stroke: 2 }, 2: { calls: 50, arc: 6, ellipse: 0, lineTo: 0, fill: 3, stroke: 2 }, 3: { calls: 56, arc: 7, ellipse: 0, lineTo: 0, fill: 3, stroke: 3 } },
  };
  for (const style of SHOP) {
    for (const [name, flags] of Object.entries(STATES)) {
      for (const detail of [0, 1, 2, 3]) {
        const { record, step } = recordFor(styles, style, flags);
        const worst = { calls: 0, arc: 0, ellipse: 0, lineTo: 0, fill: 0, stroke: 0, reach: 0, pathReach: 0 };
        for (let frame = 0; frame < 240; frame += 1) {
          stepOn(styles, record, step, 1);
          const ctx = paintOnce(styles, style, RADII[detail], { ...flags, motion: record, time: step.time, detail });
          for (const key of ["arc", "ellipse", "lineTo", "fill", "stroke"]) worst[key] = Math.max(worst[key], ctx.calls[key]);
          worst.calls = Math.max(worst.calls, ctx.calls.log.length);
          worst.reach = Math.max(worst.reach, ctx.calls.reach / RADII[detail]);
          worst.pathReach = Math.max(worst.pathReach, ctx.calls.pathReach / RADII[detail]);
          assert.equal(ctx.calls.saves, ctx.calls.restores);
        }
        const budget = BUDGET[style][detail], label = `${style} ${name} T${detail} ${JSON.stringify(worst)}`;
        for (const key of ["calls", "arc", "ellipse", "lineTo", "fill", "stroke"]) assert.ok(worst[key] <= budget[key], `${label}: ${key} over ${budget[key]}`);
        assert.ok(worst.reach <= 1.62, `${label}: inside 1.62 radii`);
        if (style === "dragonscale") assert.ok(worst.pathReach <= 1 && (flags.active || flags.selected ? worst.reach <= 1.51 : worst.reach <= 1 + 1e-9), `${label}: the gem keeps to its disc; only a lit gem's glow and its embers pass it`);
        else if (style === "lantern") assert.ok(worst.pathReach <= 1.2 + 1e-9 && worst.reach <= 1.55 + 1e-9, `${label}: the cord's knot is its highest point and the glow its widest`);
        else if (style === "neon") assert.ok(worst.pathReach <= 0.9 && worst.reach <= 1.32 + 1e-9, `${label}: the tubes stay on the plate and the bloom inside 1.32 radii`);
        else assert.ok(worst.pathReach <= 1.6, `${label}: the spikes stay within 1.6 radii`);
        assert.ok(styles.reach(style, record) >= Math.min(worst.reach, 1.3) - 1e-9 || !flags.active, `${label}: the declared reach covers the bright part`);
      }
    }
  }
});

test("each builds its paints once per canvas, tint and theme, and nothing on a steady frame", () => {
  const styles = loadNodeStyles();
  for (const style of SHOP) {
    const ctx = recordingContext({ center: P });
    const { record, step } = recordFor(styles, style, { active: true, selected: true });
    const frame = (tint, time) => styles.paint(ctx, style, P, 12, tint, { kind: "task", active: true, selected: true, chosen: true, motion: record, time, detail: 3 });
    frame(TINT, step.time); frame(TINT, step.time + 33);
    const warm = gradientsBuilt(ctx);
    const BUILT = { dragonscale: [2, "the dome and its warm glow"], constellation: [3, "the glow, the spikes and the core"], lantern: [3, "the glow, the paper and the candle's light"], neon: [1, "the bloom"] };
    assert.equal(warm, BUILT[style][0], `${style}: ${BUILT[style][1]}`);
    for (let index = 0; index < 60; index += 1) { stepOn(styles, record, step, 1); frame([220, 180, 110], step.time); }
    frame(TINT, 99999);
    assert.equal(gradientsBuilt(ctx), warm, `${style}: no gradient on a steady frame, a fresh equal tint or a late clock`);
    assert.equal(styles.cacheStats(ctx).entries, 1, `${style}: one cache entry per tint and theme`);
    assert.deepEqual(ctx.calls.shadowBlurs, []);
  }
});

test("each holds one designed still pose under reduced motion and moves otherwise", () => {
  const styles = loadNodeStyles();
  for (const style of SHOP) {
    for (const [name, flags] of Object.entries({ ...STATES, agent: { kind: "agent", active: true }, hub: { kind: "assistant" }, stale: { stale: true } })) {
      for (const detail of [0, 1, 2, 3]) {
        const radius = RADII[detail];
        const still = styles.motionRecord(new Map(), "task:still");
        styles.stepMotion(still, { style, active: flags.active === true, selected: flags.selected === true, progress: null, orbit: 1.1, status: null, time: 0, frame: 0 }, 1 / 30, true);
        for (const motion of [null, still]) {
          const logs = [0, 1234, 99999].map((time) => plain(paintOnce(styles, style, radius, { ...flags, motion, time, still: true, detail }).calls.log));
          assert.deepEqual(logs[1], logs[0], `${style} ${name} T${detail}: still at 1234 ms`);
          assert.deepEqual(logs[2], logs[0], `${style} ${name} T${detail}: still at 99999 ms`);
        }
        const { record, step } = recordFor(styles, style, flags);
        const before = plain(paintOnce(styles, style, radius, { ...flags, motion: record, time: step.time, detail }).calls.log);
        stepOn(styles, record, step, 12);
        const after = plain(paintOnce(styles, style, radius, { ...flags, motion: record, time: step.time, detail }).calls.log);
        assert.notDeepEqual(after, before, `${style} ${name} T${detail}: 400 ms later it has moved`);
      }
    }
  }
});

test("Dragon scales: rows of scales by tier, a shimmer that flashes scale after scale and rests, fire in the seams and embers at work", () => {
  const styles = loadNodeStyles();
  // The scales a tier shows: a todo's pair, a second row at T1, all eight from T2 (edges; T1 up adds their shadows).
  const scales = (detail) => {
    const ctx = paintOnce(styles, "dragonscale", RADII[detail], { detail, still: true });
    // (an edge sits on its row, .45 and .15 above and below the middle; a shadow lies a little lower)
    const edges = ctx.calls.log.filter(([name, , y, r, from, to]) => name === "arc" && Math.abs(r - 0.3 * RADII[detail]) < 1e-6 && from === 0 && Math.abs(to - Math.PI) < 1e-5 && [-45, -15, 15, 45].includes(Math.round((y - P.y) / RADII[detail] * 100)));
    return new Set(edges.map(([, x, y]) => `${Math.round((x - P.x) / RADII[detail] * 100)},${Math.round((y - P.y) / RADII[detail] * 100)}`)).size;
  };
  assert.deepEqual([0, 1, 2, 3].map(scales), [2, 5, 8, 8]);
  // The shimmer: over a 5.2 s pass the flash colour lights scales for the first 65% and none after.
  const { record, step } = recordFor(styles, "dragonscale", {});
  const flash = (ctx) => ctx.calls.strokes.filter(({ style }) => style === "rgba(251,231,189,1)").length;
  const lit = [];
  for (let frame = 0; frame < 156; frame += 1) {
    stepOn(styles, record, step, 1);
    lit.push(flash(paintOnce(styles, "dragonscale", 12, { motion: record, time: step.time, detail: 3 })));
  }
  assert.ok(Math.max(...lit) >= 2 && Math.max(...lit) <= 6, `a few scales lit at a time, never all eight (${Math.max(...lit)})`);
  assert.ok(lit.filter((count) => count === 0).length >= 40, "and a rest between passes");
  // Fire in the seams and embers rising, only at work (the embers from T3).
  const seams = (options) => paintOnce(styles, "dragonscale", 12, { detail: 3, ...options }).calls.strokes.filter(({ style }) => style === "rgba(255,168,91,1)").length;
  assert.equal(seams({}), 0);
  assert.equal(seams({ active: true }), 1, "one stroke: the seams and the bezel, one path");
  const embers = (detail) => paintOnce(styles, "dragonscale", RADII[detail], { active: true, detail }).calls.fills.filter(({ style }) => style === "rgba(255,181,112,1)").length;
  assert.deepEqual([embers(2), embers(3)], [0, 3]);
  // A light page keeps the dome's hue and deepens the rim to the free looks' edge tone.
  const light = styles.theme(LIGHT);
  const lightCtx = paintOnce(styles, "dragonscale", 12, { detail: 3, theme: light, alpha: 0.85 });
  const rim = lightCtx.calls.strokes.at(-1);
  assert.ok(luminance(channels(rim.style)) < 90 && rim.width >= 1.4, `a firm, deep rim on a pale page (${rim.style}, ${rim.width})`);
});

test("Star chart: a core, a glow and four spikes that breathe; the diagonal pair at work; a stale star's broken ring", () => {
  const styles = loadNodeStyles();
  // The four spikes: one closed star of eight points, its arms along the axes, breathing between .98 and 1.38 radii at rest.
  const arms = [];
  const { record, step } = recordFor(styles, "constellation", {});
  for (let frame = 0; frame < 200; frame += 1) {
    stepOn(styles, record, step, 1);
    const ctx = paintOnce(styles, "constellation", 12, { motion: record, time: step.time, detail: 3 });
    const [, x] = ctx.calls.log.find(([name]) => name === "moveTo");
    arms.push(x);
  }
  assert.ok(Math.min(...arms) >= 0.97 && Math.min(...arms) < 1.02 && Math.max(...arms) > 1.34 && Math.max(...arms) <= 1.39, `the spikes breathe (${Math.min(...arms).toFixed(2)} to ${Math.max(...arms).toFixed(2)})`);
  // The diagonal pair: a second star turned off the axes, at work from T3 only.
  const stars = (options) => paintOnce(styles, "constellation", RADII[options.detail], options).calls.log.filter(([name]) => name === "moveTo").length;
  assert.deepEqual([stars({ detail: 3 }), stars({ detail: 3, active: true }), stars({ detail: 2, active: true })], [1, 2, 1]);
  // The core: the star's heart whiter than the tint, its edge the tint; on a light page an ink-dark one.
  const coreStops = (theme) => paintOnce(styles, "constellation", 12, { detail: 3, theme: styles.theme(theme) }).calls.gradients.at(-1).stops.map(([, colour]) => colour);
  assert.equal(coreStops(DARK)[0], "rgba(249,243,232,1)");
  assert.ok(coreStops(DARK).includes("rgba(220,180,110,1)"), "the tint is the star's colour");
  assert.ok(luminance(channels(coreStops(LIGHT)[0])) < 70, "a printed star on a pale page");
  // A stale star wears a broken ring from T1 up (1.5 on, 2 off).
  const dashes = (detail) => paintOnce(styles, "constellation", RADII[detail], { stale: true, detail }).calls.log.filter(([name, on, off]) => name === "setLineDash" && Math.abs(on / off - 0.75) < 1e-4).length;
  assert.deepEqual([dashes(0), dashes(1), dashes(3)], [0, 1, 1]);
});

test("selection: Dragon scales' ring and the chosen gem's coiling tail; Star chart's ring of tiny stars, more round the chosen one", () => {
  const styles = loadNodeStyles();
  const select = (style, options, radius = 12) => { const ctx = recordingContext({ center: P }); assert.equal(styles.select(ctx, style, P, radius, TINT, { time: 0, still: true, ...options }), true); return ctx; };
  // Nothing marked, nothing drawn.
  for (const style of SHOP) assert.equal(select(style, {}).calls.log.length, 0);
  const hover = select("dragonscale", { selected: true });
  assert.deepEqual([hover.calls.arc, hover.calls.stroke, hover.calls.fill], [1, 1, 0], "a hover: one warm ring");
  assert.ok(Math.abs(hover.calls.reach - 12 * 1.24) < 1e-6);
  const coil = select("dragonscale", { selected: true, chosen: true });
  assert.deepEqual([coil.calls.stroke, coil.calls.fill], [6, 1], "the chosen gem: two tails of three pieces, an ember at each head");
  const tiny = (options, radius) => select("constellation", options, radius).calls.log.filter(([name]) => name === "moveTo").length;
  assert.deepEqual([tiny({ selected: true }), tiny({ selected: true, chosen: true })], [8, 12]);
  const small = select("constellation", { selected: true, chosen: true }, 4.5);
  assert.ok(small.calls.pathReach >= 4.5 + 4.5 - 1e-6, "round a todo the ring keeps 4.5 px off it");
  // The ring turns and twinkles in time; reduced motion holds it.
  const record = styles.motionRecord(new Map(), "task:sel");
  styles.stepMotion(record, { style: "constellation", active: false, selected: true, progress: null, orbit: 0, status: null, time: 0, frame: 0 }, 1 / 30, false);
  const at = (clock) => { record.clock = clock; return JSON.stringify(plain(select("constellation", { selected: true, chosen: true, motion: record, still: false }).calls.log)); };
  assert.notEqual(at(1), at(3));
  // The reach grows with the eased selection, so labels glide out.
  const reaches = [0, 0.5, 1].map((sel) => styles.reach("constellation", { sel, work: 0 }));
  assert.ok(reaches[0] < reaches[1] && reaches[1] < reaches[2] && reaches[2] <= 1.65 + 1e-9);
  assert.ok(styles.reach("dragonscale", { sel: 0, work: 1 }) >= 1.45, "a working gem's embers");
});

test("their wires and pulses follow the caller's flow, curve and theme, as the Void looks' do", () => {
  const a = { x: 20, y: 200 }, b = { x: 220, y: 40 };
  const offer = (extra = {}) => ({ kind: "task", tint: [220, 180, 110], alpha: 0.55, width: 1.4, dash: [], march: false, flow: false, double: false, active: true, inspected: false, curved: false, cp: null, far: false, time: 1000, still: false, seed: 0.3, rA: 8, rB: 12, detail: 3, lifetime: 1, theme: null, ...extra });
  const wireLog = (styles, style, extra) => { const ctx = recordingContext({ center: b }); styles.wire(ctx, style, a, b, offer(extra)); return JSON.stringify(plain(ctx.calls.log)); };
  for (const style of SHOP) {
    const styles = loadNodeStyles();
    assert.notEqual(wireLog(styles, style, { flow: true }), wireLog(styles, style, { flow: false }), `${style}: flow runs the work overlay`);
    assert.notEqual(wireLog(styles, style, { flow: true, still: true }), wireLog(styles, style, { flow: false, still: true }), `${style}: a still pose holds the flow`);
    assert.equal(wireLog(styles, style, { flow: true, still: true, time: 0 }), wireLog(styles, style, { flow: true, still: true, time: 99999 }), `${style}: that pose never moves`);
    const fresh = wireLog(loadNodeStyles(), style, { flow: true });
    styles.paint(recordingContext(), style, a, 12, [220, 180, 110], { kind: "task", active: true, theme: styles.theme(DARK) });
    assert.equal(wireLog(styles, style, { flow: true }), fresh, `${style}: a wire offered no theme takes the defaults`);
    // Every alpha a gain on the canvas's own, and the canvas back as it was.
    const ctx = recordingContext({ center: b });
    ctx.globalAlpha = 0.5; ctx.lineCap = "butt";
    styles.wire(ctx, style, a, b, offer({ flow: true, dash: [2, 4], march: true }));
    assert.deepEqual([ctx.globalAlpha, ctx.lineCap, ctx.lineDashOffset, ctx.getLineDash().length], [0.5, "butt", 0, 0]);
    assert.ok(ctx.calls.alphas.every((alpha) => alpha <= 0.5 + 1e-12));
    // A pulse on a tree S-curve rides the curve as drawn.
    const cp = { x1: a.x, y1: 120, x2: b.x, y2: 120 };
    const curve = [];
    for (let s = 0; s <= 400; s += 1) { const u = s / 400, v = 1 - u; curve.push([v ** 3 * a.x + 3 * v * v * u * cp.x1 + 3 * v * u * u * cp.x2 + u ** 3 * b.x, v ** 3 * a.y + 3 * v * v * u * cp.y1 + 3 * v * u * u * cp.y2 + u ** 3 * b.y]); }
    const offCurve = (x, y) => Math.min(...curve.map(([cx, cy]) => Math.hypot(cx - x, cy - y)));
    for (const t of [0.3, 0.6]) {
      const pulseCtx = recordingContext({ center: b });
      const pulse = { color: "#f1dcae", duration: 900, start: 4 };
      assert.equal(styles.surge(pulseCtx, style, a, b, t, pulse, { kind: "dot", time: 400, still: false, rTo: 12, detail: 3, pulse, motion: null, cp, theme: null }), true);
      const points = pulseCtx.calls.log.filter(([name, x, y]) => (name === "moveTo" || name === "lineTo" || name === "arc") && x > 10 && y > 10 && Math.hypot(x - b.x, y - b.y) > 1);
      assert.ok(points.length > 0, `${style} draws its pulse at t ${t}`);
      // (Dragon scales' sparks drift a few pixels off the line as they age)
      for (const [name, x, y] of points) assert.ok(offCurve(x, y) <= (style === "dragonscale" ? 10 : 6), `${style} at t ${t}: ${name} (${x}, ${y}) sits ${offCurve(x, y).toFixed(1)} px off the curve`);
    }
    // A landing lands; reduced motion draws none.
    const land = recordingContext({ center: b });
    assert.equal(styles.land(land, style, b, 12, [241, 220, 174], 0.4, { kind: "dot", time: 0, still: false, rTo: 12, detail: 3, pulse: { color: "#f1dcae", start: 4 }, theme: null }), true);
    assert.ok(land.calls.stroke + land.calls.fill > 0);
    const held = recordingContext({ center: b });
    styles.land(held, style, b, 12, [241, 220, 174], 1, { still: true });
    assert.equal(held.calls.log.length, 0);
  }
});

test("Dragon scales' wire is the caller's line with a twisting ribbon on a lively wire; the far pen, the rail and the hub's double line keep the line alone", () => {
  const styles = loadNodeStyles();
  const a = { x: 20, y: 200 }, b = { x: 220, y: 40 };
  const run = (extra) => { const ctx = recordingContext({ center: b }); styles.wire(ctx, "dragonscale", a, b, { kind: "session", tint: [220, 180, 110], alpha: 0.3, width: 1, dash: [], active: false, flow: false, detail: 3, seed: 0.2, time: 500, theme: null, ...extra }); return ctx; };
  const ribbon = run({});
  assert.deepEqual([ribbon.calls.stroke, ribbon.calls.fill], [1, 1], "the line, then the ribbon over it");
  assert.ok(ribbon.calls.lineTo >= 2 * 25 && ribbon.calls.lineTo <= 2 * 31, `a sample every 8 px along 256 px, both edges (${ribbon.calls.lineTo})`);
  for (const plainWire of [{ far: true }, { rail: true }, { double: true }, { kind: "todo", detail: 1 }]) {
    const ctx = run(plainWire);
    assert.deepEqual([ctx.calls.stroke, ctx.calls.fill], [1, 0], `${JSON.stringify(plainWire)}: the line alone`);
  }
  // The twist flows toward b on a wire that carries work, faster than on a quiet one; a still pose holds it.
  const shape = (extra) => JSON.stringify(plain(run(extra).calls.log.filter(([name]) => name === "lineTo")));
  assert.notEqual(shape({ time: 500 }), shape({ time: 700 }));
  assert.equal(shape({ time: 500, still: true }), shape({ time: 9999, still: true }));
  // The caller's dash and march are kept.
  const dashed = run({ dash: [2, 4], march: true, kind: "task" });
  assert.deepEqual(plain(dashed.calls.log.find(([name]) => name === "setLineDash")).slice(1), [2, 4]);
});

test("Star chart's wire is a dotted chart line that stops short of each star; a dash of the caller's own is kept; a running star on a wire that carries work", () => {
  const styles = loadNodeStyles();
  const a = { x: 20, y: 200 }, b = { x: 220, y: 40 };
  const run = (extra) => { const ctx = recordingContext({ center: b }); styles.wire(ctx, "constellation", a, b, { kind: "session", tint: [220, 180, 110], alpha: 0.3, width: 1, dash: [], active: false, flow: false, detail: 3, seed: 0.2, time: 500, theme: null, rA: 10, rB: 10, ...extra }); return ctx; };
  const quiet = run({});
  const dash = plain(quiet.calls.log.find(([name]) => name === "setLineDash")).slice(1);
  assert.ok(dash.length === 2 && dash[0] === 1.3 && dash[1] > dash[0] * 2, `dots: a short dash and a longer gap (${dash})`);
  // The line stops 1.2 radii short of each star (a chart's gap round its stars).
  const [, x0, y0] = quiet.calls.log.find(([name]) => name === "moveTo");
  assert.ok(Math.abs(Math.hypot(x0 - a.x, y0 - a.y) - 12) < 1e-6, "12 px off a 10 px star");
  assert.deepEqual(plain(run({ dash: [6, 4], kind: "tether" }).calls.log.find(([name]) => name === "setLineDash")).slice(1), [6, 4], "a tether keeps its dash");
  const working = run({ active: true, flow: true });
  assert.ok(working.calls.fill >= 1, "a small star runs along a wire that carries work");
  assert.equal(run({ active: true, flow: true, far: true }).calls.fill, 0, "the far pen keeps the dots alone");
  assert.equal(quiet.calls.fill, 0, "a quiet wire runs none");
});

// ---- Lanterns ----

// The ellipses a paint traced, as [x, y, rx, ry, rotation, from, to]; a lantern's ribs are its quadratic curves.
const ellipses = (ctx) => ctx.calls.log.filter(([name]) => name === "ellipse").map(([, ...args]) => args);
const ribsOf = (ctx) => ctx.calls.log.filter(([name]) => name === "quadraticCurveTo").map(([, ...args]) => args);
// The rim: the paper's whole outline, traced in pixels (rx .9 of the radius).
const rimOf = (ctx, radius) => ellipses(ctx).find(([, , rx, , , from, to]) => from === 0 && Math.abs(to - 2 * Math.PI) < 1e-5 && Math.abs(rx - 0.9 * radius) < 1e-6);
// The fill colour set next after the first log entry `find` matches.
function fillAfter(ctx, find) {
  const log = ctx.calls.log, start = log.findIndex(find);
  const set = start < 0 ? null : log.slice(start).find(([name]) => name === "set:fillStyle");
  return set ? set[1] : null;
}

test("Lanterns: a paper lantern on its cord, ribbed by tier, capped from T1, its cord and lit lips from T2 and a tassel at T3", () => {
  const styles = loadNodeStyles();
  const at = (detail, options = {}) => paintOnce(styles, "lantern", RADII[detail], { detail, still: true, ...options });
  // The ribs (each the front of a ring, bowing down): the middle one, two more from T1, the outer pair from T2.
  assert.deepEqual([0, 1, 2, 3].map((detail) => ribsOf(at(detail)).length), [1, 3, 5, 5]);
  // (the still pose leans 0.03 rad, so the paper sits half a pixel off the node's centre)
  for (const [, cy, x, y] of ribsOf(at(3))) assert.ok(cy > y && Math.hypot(x - P.x, y - P.y) <= 0.9 * 12 + 0.5, "each bows down, inside the paper");
  // The caps, two closed four-cornered paths from T1; the cord (from the knot) and the caps' two lips from T2; the
  // tassel's cord and its tuft (a third closed path) at T3.
  assert.deepEqual([0, 1, 2, 3].map((detail) => at(detail).calls.closePath), [0, 2, 2, 3]);
  assert.deepEqual([0, 1, 2, 3].map((detail) => at(detail).calls.lineTo), [0, 6, 9, 13]);
  const knot = (detail) => at(detail).calls.log.some(([name, x, y]) => name === "moveTo" && Math.abs(x - P.x) < 1e-6 && Math.abs(y - (P.y - 1.2 * RADII[detail])) < 1e-6);
  assert.deepEqual([knot(1), knot(2), knot(3)], [false, true, true], "the cord hangs from a knot 1.2 radii above the node");
  // The glow, the paper and the candle's light are cached radials; the paper at the caller's alpha, the rest gains on it.
  const ctx = at(3, { alpha: 0.65 });
  const radials = ctx.calls.fills.filter(({ style }) => typeof style === "object");
  assert.equal(radials.length, 3);
  assert.equal(radials[1].alpha, 0.65, "the paper at the caller's alpha");
  assert.ok(radials[0].alpha < 0.65 && radials[2].alpha < 0.65, "the glow and the candle are gains on it");
  // A stale lantern's rim is dashed from T1 (the shared 3:4), the rest of it whole.
  const stale = at(3, { stale: true }).calls.log.filter(([name, ...dash]) => name === "setLineDash" && dash.length === 2);
  assert.deepEqual(plain(stale).map((entry) => entry.slice(1)), [[1.5, 2]]);
});

test("Lanterns swing about their knot in their own phase, a little wider at work, and a landing pushes them; a glyph's lantern swings less; reduced motion leans still", () => {
  const styles = loadNodeStyles();
  const turns = (flags, frames = 150) => {
    const { record, step } = recordFor(styles, "lantern", flags);
    const out = [];
    for (let frame = 0; frame < frames; frame += 1) { stepOn(styles, record, step, 1); out.push(rimOf(paintOnce(styles, "lantern", 12, { ...flags, motion: record, time: step.time, detail: 3 }), 12)[4]); }
    return { out, record, step };
  };
  const span = (list) => Math.max(...list) - Math.min(...list);
  const quiet = turns({}).out, working = turns({ active: true }).out, glyph = turns({ kind: "agent", glyph: true }).out;
  assert.ok(Math.max(...quiet.map(Math.abs)) <= 0.055 + 1e-9 && span(quiet) > 0.08, `a swing of about 3° either way (${span(quiet).toFixed(3)} rad)`);
  assert.ok(Math.max(...working.map(Math.abs)) <= 0.055 * 1.3 + 1e-9 && span(working) > span(quiet), "wider at work");
  assert.ok(span(glyph) < span(quiet) * 0.4, "a lantern wearing a glyph swings a third as far");
  // The paper's centre moves with the swing while the knot stays put; a landing's kick pushes it over.
  const { record, step } = turns({}, 1);
  const rim = () => rimOf(paintOnce(styles, "lantern", 12, { motion: record, time: step.time, detail: 3 }), 12);
  const before = rim();
  record.kick = 1;
  const pushed = rim();
  assert.ok(Math.abs(pushed[4] - before[4] - 0.06) < 1e-9, "a push of 0.06 rad");
  assert.ok(pushed[0] < before[0], "the paper swings out under the knot");
  // Reduced motion: one lean, whatever the clock.
  const still = [0, 1234, 99999].map((time) => rimOf(paintOnce(styles, "lantern", 12, { still: true, time, detail: 3 }), 12)[4]);
  assert.deepEqual(still, [0.03, 0.03, 0.03]);
});

test("Lanterns: the candle breathes at rest and flickers at work, and a landing's kick lights it", () => {
  const styles = loadNodeStyles();
  const candleOf = (ctx) => ctx.calls.fills.filter(({ style }) => typeof style === "object")[2].alpha;
  const series = (flags) => {
    const { record, step } = recordFor(styles, "lantern", flags);
    const out = [];
    for (let frame = 0; frame < 150; frame += 1) { stepOn(styles, record, step, 1); out.push(candleOf(paintOnce(styles, "lantern", 12, { ...flags, motion: record, time: step.time, detail: 3 }))); }
    return { out, record, step };
  };
  const jumps = (list) => list.slice(1).map((value, index) => Math.abs(value - list[index]));
  const mean = (list) => list.reduce((sum, value) => sum + value, 0) / list.length;
  const span = (list) => Math.max(...list) - Math.min(...list);
  const rest = series({}).out, work = series({ active: true }).out;
  assert.ok(Math.max(...jumps(rest)) < 0.01 && span(rest) > 0.02, `at rest it breathes smoothly (${span(rest).toFixed(3)})`);
  assert.ok(Math.max(...jumps(work)) > 0.03 && span(work) > 0.15, `at work it flickers (${span(work).toFixed(3)})`);
  assert.ok(mean(work) > mean(rest) + 0.2, "and burns brighter");
  const { record, step } = series({});
  const lit = (kick) => { record.kick = kick; return candleOf(paintOnce(styles, "lantern", 12, { motion: record, time: step.time, detail: 3 })); };
  assert.ok(lit(1) > lit(0) + 0.3, "a landing lights it");
});

test("Lanterns ink a glyph dark on a paper label that reads at 7:1 in a dark and a light theme; a task wears none", () => {
  const styles = loadNodeStyles();
  for (const palette of [DARK, LIGHT]) {
    const theme = styles.theme(palette);
    for (const tint of [[120, 180, 220], [104, 236, 164], [59, 86, 160], [230, 201, 141], [255, 212, 121]]) {
      const ctx = recordingContext({ center: P });
      styles.paint(ctx, "lantern", P, 12, tint, { kind: "agent", glyph: true, active: true, detail: 3, theme, still: true });
      const paper = fillAfter(ctx, ([name, , , rx]) => name === "ellipse" && Math.abs(rx - 0.56 * 12) < 1e-6);
      assert.ok(paper, "a label under the glyph");
      const ink = styles.glyph("lantern", tint, theme).ink;
      const ratio = contrast(channels(ink), channels(paper));
      assert.ok(ratio >= 7, `${palette.background} ${tint}: the ink reads ${ratio.toFixed(1)}:1 on its label`);
    }
  }
  assert.equal(ellipses(paintOnce(styles, "lantern", 12, { detail: 3, still: true })).filter(([, , rx]) => Math.abs(rx - 0.56 * 12) < 1e-6).length, 0, "a task has no label");
  // The hub writes its monogram on the label in the same ink.
  const hub = paintOnce(styles, "lantern", 14, { kind: "assistant", detail: 3, still: true });
  assert.deepEqual(hub.calls.texts.map(({ text }) => text), ["M"]);
  assert.equal(hub.calls.texts[0].ink, styles.glyph("lantern", TINT, null).ink);
});

test("Lanterns on a light page keep the paper's hue, ink the caps and the cord, and deepen the rim", () => {
  const styles = loadNodeStyles();
  const light = styles.theme(LIGHT);
  const ctx = paintOnce(styles, "lantern", 12, { detail: 3, theme: light, alpha: 0.85, still: true }, recordingContext({ center: P }), [104, 236, 164]);
  const rim = ctx.calls.strokes.find(({ width }) => width >= 1.4);
  assert.ok(rim && luminance(channels(rim.style)) < 90, `a firm, deep rim (${rim?.style})`);
  const caps = fillAfter(ctx, ([name]) => name === "closePath");
  assert.ok(luminance(channels(caps)) < 50, `ink-dark caps (${caps})`);
  const paper = ctx.calls.gradients[0].stops.map(([, colour]) => channels(colour));
  assert.ok(paper.some(([r, g, b]) => g > r + 60 && g > b + 30), "the paper keeps the done green");
});

// ---- Neon ----

const arcsOf = (ctx) => ctx.calls.log.filter(([name]) => name === "arc").map(([, ...args]) => args);

test("Neon: a tube ring with a white-hot core over a bloom on its plate; its break and electrodes from T1, a bead from T2, a highlight on the glass at T3", () => {
  const styles = loadNodeStyles();
  const at = (detail, options = {}) => paintOnce(styles, "neon", RADII[detail], { detail, still: true, ...options });
  const ring = (detail) => arcsOf(at(detail)).find(([, , r]) => Math.abs(r - 0.78 * RADII[detail]) < 1e-6);
  assert.ok(Math.abs(ring(0)[3] - Math.PI / 2) < 1e-6 && Math.abs(ring(0)[4] - Math.PI * 2.5) < 1e-5, "whole below T1");
  for (const detail of [1, 2, 3]) assert.ok(Math.abs(ring(detail)[3] - (Math.PI / 2 + 0.32)) < 1e-6 && Math.abs(ring(detail)[4] - (Math.PI * 2.5 - 0.32)) < 1e-5, `T${detail}: broken at the bottom`);
  // The plate and the bloom, then the electrodes from T1 (one fill, a disc at each end of the ring).
  assert.deepEqual([0, 1, 2, 3].map((detail) => at(detail).calls.fill), [2, 3, 3, 3]);
  const plate = at(3, { alpha: 0.65 });
  assert.equal(plate.calls.fills[0].alpha, 0.65, "the plate at the caller's alpha");
  assert.equal(plate.calls.strokes[0].alpha, 0.65, "a lit tube at it too");
  // The bead from T2 (a tenth of the radius, 1 to 2 px), not under a glyph.
  const bead = (detail, options) => arcsOf(at(detail, options)).filter(([x, y, r]) => x === P.x && y === P.y && r <= 2 && r >= 1).length;
  assert.deepEqual([0, 1, 2, 3].map((detail) => bead(detail)), [0, 0, 1, 1]);
  assert.equal(bead(3, { kind: "agent", glyph: true }), 0, "a glyph burns there instead");
  // The tube and its core, one path, the core 0.4 of the tube; the glass's highlight at T3.
  const [tube, core] = at(3).calls.strokes;
  assert.ok(Math.abs(tube.width - 12 * 0.13) < 1e-9 && Math.abs(core.width - 12 * 0.13 * 0.4) < 1e-9);
  assert.ok(luminance(channels(core.style)) > luminance(channels(tube.style)) + 40, "a white-hot core");
  assert.deepEqual([2, 3].map((detail) => arcsOf(at(detail)).filter(([, , , from, to]) => Math.abs(from + 2.55) < 1e-6 && Math.abs(to + 2.05) < 1e-6).length), [0, 1]);
  // A stale sign's tubes are dead in places: dashed 3 on, 4 off from T1.
  assert.deepEqual(plain(at(3, { stale: true }).calls.log.filter(([name, ...dash]) => name === "setLineDash" && dash.length === 2)).map((entry) => entry.slice(1)), [[3, 4]]);
});

test("Neon buzzes on when work starts: its tube stutters through the work's first second, then burns steady with now and then a blink; reduced motion stays lit", () => {
  const styles = loadNodeStyles();
  const record = styles.motionRecord(new Map(), "task:neon");
  const flags = { style: "neon", active: false, selected: false, progress: null, orbit: 0, status: null, time: 0, frame: 0 };
  const advance = () => { flags.time += 1000 / 60; flags.frame += 1; styles.stepMotion(record, flags, 1 / 60, false); };
  const tube = () => paintOnce(styles, "neon", 12, { active: flags.active, motion: record, time: flags.time, detail: 3 }).calls.strokes[0].alpha;
  for (let frame = 0; frame < 60; frame += 1) advance();
  assert.equal(tube(), 1, "idle: lit");
  flags.active = true;
  const strike = [];
  for (let frame = 0; frame < 60; frame += 1) { advance(); strike.push(tube()); }
  const drops = strike.filter((alpha, index) => alpha < 0.65 && (index === 0 || strike[index - 1] >= 0.9)).length;
  assert.ok(drops >= 2 && strike.slice(0, 30).some((alpha) => alpha >= 0.99), `it stutters on (${strike.map((alpha) => alpha.toFixed(2)).join(" ")})`);
  assert.ok(strike.slice(-3).every((alpha) => alpha === 1), "lit by the end of its first second");
  // Then steady, a short blink now and then (at most 5 frames), never a stutter again.
  const run = [];
  for (let frame = 0; frame < 60 * 60; frame += 1) { advance(); run.push(tube()); }
  const blinks = [];
  for (let index = 0; index < run.length; index += 1) if (run[index] < 1 && (index === 0 || run[index - 1] === 1)) { let end = index; while (end < run.length && run[end] < 1) end += 1; blinks.push(end - index); }
  assert.ok(blinks.length >= 1 && blinks.length <= 30 && blinks.every((length) => length <= 5), `blinks now and then (${blinks})`);
  assert.ok(run.filter((alpha) => alpha === 1).length / run.length > 0.97, "and burns steady between them");
  // Reduced motion: lit and steady.
  assert.equal(paintOnce(styles, "neon", 12, { active: true, still: true, detail: 3 }).calls.strokes[0].alpha, 1);
});

test("Neon on a light page is lit glass by day: a deep tube round a paler core under a faint bloom, 3:1 off the page", () => {
  const styles = loadNodeStyles();
  const light = styles.theme(LIGHT), page = channels("rgb(238,241,245)");
  for (const tint of [[104, 236, 164], [255, 212, 121], [150, 146, 138]]) {
    const ctx = paintOnce(styles, "neon", 12, { detail: 3, theme: light, alpha: 0.85, still: true }, recordingContext({ center: P }), tint);
    const [tube, core] = ctx.calls.strokes;
    assert.ok(luminance(channels(core.style)) > luminance(channels(tube.style)), `${tint}: a paler core`);
    const shown = channels(tube.style).map((channel, index) => page[index] + (channel - page[index]) * tube.alpha);
    assert.ok(contrast(shown, page) >= 3, `${tint}: the tube reads ${contrast(shown, page).toFixed(2)}:1 on the page`);
  }
});

test("selection: a lantern's warm ring and the chosen one's fireflies; a neon sign's outer tube, and round the chosen one two arcs in the theme's second hue that turn", () => {
  const styles = loadNodeStyles();
  const select = (style, options, radius = 12) => { const ctx = recordingContext({ center: P }); assert.equal(styles.select(ctx, style, P, radius, TINT, { time: 0, still: true, ...options }), true); return ctx; };
  const hover = select("lantern", { selected: true });
  assert.deepEqual([hover.calls.arc, hover.calls.stroke, hover.calls.fill], [1, 1, 0], "a hover: one warm ring");
  assert.deepEqual([select("lantern", { selected: true, chosen: true, theme: styles.theme(DARK) }).calls.fill, select("lantern", { selected: true, chosen: true, theme: styles.theme(LIGHT) }).calls.fill], [6, 3], "the chosen lantern's three fireflies: a soft light and a dot each (the dots alone on a light page)");
  const sign = select("neon", { selected: true });
  assert.deepEqual([sign.calls.arc, sign.calls.stroke], [1, 3], "a hover: an outer tube's bloom, tube and core");
  const chosen = select("neon", { selected: true, chosen: true, theme: styles.theme(DARK) });
  assert.deepEqual([chosen.calls.arc, chosen.calls.stroke], [2, 3], "the chosen sign: two arcs, one path");
  const tube = channels(chosen.calls.strokes[1].style);
  assert.ok(tube[2] > tube[0] + 80, `in the theme's second hue, #36d1ff (${tube})`);
  // Both move in time; reduced motion holds them.
  for (const style of ["lantern", "neon"]) {
    const record = styles.motionRecord(new Map(), "task:sel");
    styles.stepMotion(record, { style, active: false, selected: true, progress: null, orbit: 0, status: null, time: 0, frame: 0 }, 1 / 30, false);
    const at = (clock, still = false) => { record.clock = clock; return JSON.stringify(plain(select(style, { selected: true, chosen: true, motion: record, still }).calls.log)); };
    assert.notEqual(at(1), at(3), `${style}: it moves`);
    assert.equal(at(1, true), at(3, true), `${style}: reduced motion holds it`);
  }
  assert.ok(styles.reach("lantern", { sel: 1, work: 0 }) >= 1.6 && styles.reach("neon", { sel: 1, work: 0 }) >= 1.4, "the reach covers the fireflies and the outer tube");
});

test("Lanterns' wire is the caller's line with festival lights on a lively wire, a chase running toward b along one that carries work; the far pen, the rail and the hub's double line keep the line alone", () => {
  const styles = loadNodeStyles();
  const a = { x: 20, y: 200 }, b = { x: 220, y: 40 }, chord = Math.hypot(b.x - a.x, b.y - a.y);
  const run = (extra) => { const ctx = recordingContext({ center: b }); styles.wire(ctx, "lantern", a, b, { kind: "session", tint: [220, 180, 110], alpha: 0.3, width: 1, dash: [], active: false, flow: false, detail: 3, seed: 0.2, time: 500, theme: null, ...extra }); return ctx; };
  const lights = run({});
  assert.equal(lights.calls.stroke, 1, "the line");
  assert.equal(lights.calls.arc, Math.round(chord / 15), "a light every 15 px or so");
  assert.ok(lights.calls.fill >= 1 && lights.calls.fill <= 2, "the dim lights and the bright ones, a fill each");
  for (const plainWire of [{ far: true }, { rail: true }, { double: true }, { kind: "todo", detail: 1 }]) {
    const ctx = run(plainWire);
    assert.deepEqual([ctx.calls.stroke, ctx.calls.fill], [1, 0], `${JSON.stringify(plainWire)}: the line alone`);
  }
  // The chase: the bright lights (the bigger ones) move toward b as time runs, a full round every 84 px; a still pose parks it.
  const bright = (extra) => run({ active: true, flow: true, ...extra }).calls.log.filter(([name, , , r]) => name === "arc" && r > 1.5).map(([, x, y]) => ((x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y)) / chord);
  const phase = (list) => { let x = 0, y = 0; for (const s of list) { x += Math.cos(2 * Math.PI * s / 84); y += Math.sin(2 * Math.PI * s / 84); } return Math.atan2(y, x); };
  let advance = 0, last = phase(bright({ time: 0 }));
  for (let time = 50; time <= 1200; time += 50) { const next = phase(bright({ time })); advance += ((next - last + 3 * Math.PI) % (2 * Math.PI)) - Math.PI; last = next; }
  assert.ok(advance > 1.5 * Math.PI, `toward b, a round in 1.2 s (${advance.toFixed(2)} rad)`);
  assert.deepEqual(bright({ time: 500, still: true }), bright({ time: 99999, still: true }));
  // A quiet lively wire twinkles: a new few every 0.65 s, held by a still pose.
  const twinkles = (extra) => JSON.stringify(run(extra).calls.log.filter(([name, , , r]) => name === "arc" && r > 1.5));
  assert.notEqual(twinkles({ time: 0 }), twinkles({ time: 1950 }));
  assert.equal(twinkles({ time: 0, still: true }), twinkles({ time: 1950, still: true }));
  // The caller's dash and march are kept.
  const dashed = run({ dash: [2, 4], march: true, kind: "task" });
  assert.deepEqual(plain(dashed.calls.log.find(([name]) => name === "setLineDash")).slice(1), [2, 4]);
});

test("Neon's wire is a lit tube on a lively wire: a bloom under the caller's line and a hot core over it, running as current toward b along one that carries work; the far pen, the rail and the hub's double line keep the line alone", () => {
  const styles = loadNodeStyles();
  const a = { x: 20, y: 200 }, b = { x: 220, y: 40 };
  const run = (extra) => { const ctx = recordingContext({ center: b }); styles.wire(ctx, "neon", a, b, { kind: "session", tint: [220, 180, 110], alpha: 0.3, width: 1, dash: [], active: false, flow: false, detail: 3, seed: 0.2, time: 500, theme: null, ...extra }); return ctx; };
  const [bloom, line, core] = run({}).calls.strokes;
  assert.ok(bloom && line && core, "three strokes over one path");
  assert.ok(bloom.width > line.width && core.width < line.width && bloom.alpha < line.alpha, "a wide faint bloom under the line, a thin core over it");
  assert.ok(luminance(channels(core.style)) > luminance(channels(line.style)), "a hot core");
  for (const plainWire of [{ far: true }, { rail: true }, { double: true }, { kind: "todo", detail: 1 }]) assert.equal(run(plainWire).calls.stroke, 1, `${JSON.stringify(plainWire)}: the line alone`);
  // The current: the core runs in 9 px dashes, flowing toward b; a still pose holds it.
  const current = (extra) => { const log = run({ active: true, flow: true, ...extra }).calls.log; return [plain(log.find(([name, on]) => name === "setLineDash" && on === 9)).slice(1), log.filter(([name]) => name === "set:lineDashOffset").map(([, value]) => value)[0]]; };
  assert.deepEqual(current({})[0], [9, 7]);
  assert.notEqual(current({ time: 500 })[1], current({ time: 560 })[1]);
  assert.ok(((current({ time: 500 })[1] - current({ time: 560 })[1]) % 16 + 16) % 16 > 0, "the dashes move toward b");
  assert.equal(current({ time: 500, still: true })[1], current({ time: 99999, still: true })[1]);
  // The caller's dash and march are kept on the line.
  const dashed = run({ dash: [2, 4], march: true, kind: "task" });
  assert.deepEqual(plain(dashed.calls.log.find(([name]) => name === "setLineDash")).slice(1), [2, 4]);
});
