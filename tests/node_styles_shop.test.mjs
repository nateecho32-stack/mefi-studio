// The two node styles the Shop sells (renderer/node-styles.js, "style:
// dragonscale" and "style: constellation"; relay/src/shop.mjs sells them as
// studio:style-dragonscale and studio:style-constellation, renderer/music.js
// wears them once they are owned). Dragon scales: a domed gem in rows of
// overlapping scales, a shimmer flashing scale after scale, fire in the seams
// and embers at work, a twisting ribbon for a wire, embers for pulses and a
// coiling tail round the chosen gem. Constellation: a star with a soft glow,
// a bright core and four breathing diffraction spikes, a diagonal pair at
// work, dotted star-chart wires that stop short of every star, shooting
// stars, and a ring of tiny stars round the selection. Loaded whole through
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
const SHOP = ["dragonscale", "constellation"];
const channels = (colour) => colour.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
const luminance = ([r, g, b]) => r * 0.2126 + g * 0.7152 + b * 0.0722;

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

test("both register every hook of their look, in the Shop's place among the styles, and speed up at work", () => {
  const styles = loadNodeStyles();
  assert.deepEqual(plain(styles.STYLES).slice(-2), SHOP, "the Shop's two come after the Void collection");
  assert.deepEqual(plain(styles.PREMIUM), ["singularity", "prism", "sigil"], "PREMIUM stays the Void collection's (free since 0.4.4)");
  const sections = { dragonscale: sectionOf("dragonscale", "style: constellation"), constellation: sectionOf("constellation", "overlays") };
  const hooks = {
    dragonscale: ["paint: paintDragonscale", "arrival: dragonArrival", "select: dragonSelect", "done: dragonDone", "absorb: dragonAbsorb", "wire: dragonWire", "surge: dragonSurge", "land: dragonLand", "reach: dragonReach", "speedup: 2.4"],
    constellation: ["paint: paintConstellation", "arrival: starArrival", "select: starSelect", "done: starDone", "absorb: starAbsorb", "wire: starWire", "surge: starSurge", "land: starLand", "reach: starReach", "speedup: 2.2"],
  };
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
    assert.ok(Math.abs(record.clock - clock - 0.05 * (style === "dragonscale" ? 2.4 : 2.2)) < 1e-12, `${style} runs its clock faster at work`);
    // A glyph's ink reads on the well under it: light on a dark page, dark on a light one.
    assert.ok(luminance(channels(styles.glyph(style, [120, 180, 220], styles.theme(DARK)).ink)) > 200);
    assert.ok(luminance(channels(styles.glyph(style, [120, 180, 220], styles.theme(LIGHT)).ink)) < 60);
  }
});

test("each keeps inside its budget at every tier and state, frame after frame, and inside its reach", () => {
  const styles = loadNodeStyles();
  // Worst case over eight seconds (two shimmer passes, a spike breath), per tier: canvas calls, arcs, lines, fills, strokes.
  const BUDGET = {
    dragonscale: { 0: { calls: 70, arc: 10, lineTo: 0, fill: 3, stroke: 4 }, 1: { calls: 125, arc: 26, lineTo: 0, fill: 3, stroke: 11 }, 2: { calls: 150, arc: 35, lineTo: 0, fill: 3, stroke: 13 }, 3: { calls: 160, arc: 38, lineTo: 0, fill: 6, stroke: 13 } },
    constellation: { 0: { calls: 48, arc: 2, lineTo: 7, fill: 3, stroke: 0 }, 1: { calls: 48, arc: 2, lineTo: 7, fill: 3, stroke: 0 }, 2: { calls: 48, arc: 2, lineTo: 7, fill: 3, stroke: 0 }, 3: { calls: 60, arc: 2, lineTo: 14, fill: 4, stroke: 0 } },
  };
  for (const style of SHOP) {
    for (const [name, flags] of Object.entries(STATES)) {
      for (const detail of [0, 1, 2, 3]) {
        const { record, step } = recordFor(styles, style, flags);
        const worst = { calls: 0, arc: 0, lineTo: 0, fill: 0, stroke: 0, reach: 0, pathReach: 0 };
        for (let frame = 0; frame < 240; frame += 1) {
          stepOn(styles, record, step, 1);
          const ctx = paintOnce(styles, style, RADII[detail], { ...flags, motion: record, time: step.time, detail });
          for (const key of ["arc", "lineTo", "fill", "stroke"]) worst[key] = Math.max(worst[key], ctx.calls[key]);
          worst.calls = Math.max(worst.calls, ctx.calls.log.length);
          worst.reach = Math.max(worst.reach, ctx.calls.reach / RADII[detail]);
          worst.pathReach = Math.max(worst.pathReach, ctx.calls.pathReach / RADII[detail]);
          assert.equal(ctx.calls.saves, ctx.calls.restores);
        }
        const budget = BUDGET[style][detail], label = `${style} ${name} T${detail} ${JSON.stringify(worst)}`;
        for (const key of ["calls", "arc", "lineTo", "fill", "stroke"]) assert.ok(worst[key] <= budget[key], `${label}: ${key} over ${budget[key]}`);
        assert.ok(worst.reach <= 1.62, `${label}: inside 1.62 radii`);
        if (style === "dragonscale") assert.ok(worst.pathReach <= 1 && (flags.active || flags.selected ? worst.reach <= 1.51 : worst.reach <= 1 + 1e-9), `${label}: the gem keeps to its disc; only a lit gem's glow and its embers pass it`);
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
    assert.equal(warm, style === "dragonscale" ? 2 : 3, `${style}: ${style === "dragonscale" ? "the dome and its warm glow" : "the glow, the spikes and the core"}`);
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

test("Constellation: a core, a glow and four spikes that breathe; the diagonal pair at work; a stale star's broken ring", () => {
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

test("selection: Dragon scales' ring and the chosen gem's coiling tail; Constellation's ring of tiny stars, more round the chosen one", () => {
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

test("Constellation's wire is a dotted chart line that stops short of each star; a dash of the caller's own is kept; a running star on a wire that carries work", () => {
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
