// Prism (renderer/node-styles.js, "style: prism"): a crystal that turns and
// splits the light. The body is a bipyramid gem that turns under a fixed key
// light, with a light band sweeping across it, fire flashing on a pavilion
// facet, a spectral fringe, a glint and a twinkle; working adds orbiting
// shards and caustic sparkles. Its hooks draw the agent ring, hub dress, work
// orbit, arrival, selection, wires, pulses and landings in the same
// refraction language. Loaded whole through the shared harness.
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
const DARK = { background: "#030208", text: "#ece9ff", accent2: "#36d1ff" };
const LIGHT = { background: "#f3f0e8", text: "#1d2330", accent2: "#8a5a14" };
const luminance = ([r, g, b]) => r * 0.2126 + g * 0.7152 + b * 0.0722;
// Every turn of the gem fits in this hull (unit space, clockwise on screen):
// the apexes at -1.02 and 1.08 (times the view's cos), the girdle's vertices
// within .86 across and .1 above or below its middle.
const GEM_LEVEL = Math.sqrt(1 - 0.1163 ** 2), GIRDLE_Y = -0.26 * GEM_LEVEL;
const GEM_HULL = [[0, -1.02 * GEM_LEVEL], [0.86, GIRDLE_Y - 0.1], [0.86, GIRDLE_Y + 0.1], [0, 1.08 * GEM_LEVEL], [-0.86, GIRDLE_Y + 0.1], [-0.86, GIRDLE_Y - 0.1]];
const channels = (colour) => colour.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);

// A motion record stepped at 30 Hz in a node's state; `frames` more frames on.
function recordFor(styles, flags, frames = 90, id = "task:prism") {
  const record = styles.motionRecord(new Map(), id);
  const step = { style: "prism", active: flags.active === true, selected: flags.selected === true, progress: null, orbit: 1.1, status: flags.status ?? null, time: 0, frame: 0 };
  for (let frame = 0; frame < frames; frame += 1) { step.time = frame * 1000 / 30; step.frame = frame; styles.stepMotion(record, step, 1 / 30, false); }
  return { record, step };
}
function stepOn(styles, record, step, frames) {
  for (let frame = 0; frame < frames; frame += 1) { step.time += 1000 / 30; step.frame += 1; styles.stepMotion(record, step, 1 / 30, false); }
}
const paintOnce = (styles, radius, options, ctx = recordingContext({ center: P })) => {
  styles.paint(ctx, "prism", P, radius, TINT, { kind: "task", ...options });
  return ctx;
};

test("Prism registers every hook of its look and turns 2.5 times faster at work", () => {
  const styles = loadNodeStyles();
  const section = source.replace(/\r\n/g, "\n").split("\n// ===== style: prism =====\n")[1].split("\n// ===== style: sigil =====\n")[0];
  const entry = section.slice(section.indexOf("LOOKS.prism = {"));
  for (const hook of ["paint: paintPrism", "ring: prismRing", "hubDress: prismHub", "orbit: prismOrbit", "arrival: prismArrival", "select: prismSelect", "wire: prismWire", "surge: prismSurge", "land: prismLand", "reach: prismReach", "speedup: 2.5"]) assert.ok(entry.includes(hook), hook);
  // Nothing per frame allocates through array helpers, blurs or filters.
  const code = section.replace(/^\s*\/\/.*$/gm, "");
  for (const banned of ["Array.from", ".filter(", ".map(", "shadowBlur", ".filter =", "createPattern"]) assert.ok(!code.includes(banned), `no ${banned} in the Prism section`);
  const record = styles.motionRecord(new Map(), "task:speed");
  styles.stepMotion(record, { style: "prism", active: true, selected: false, progress: null, orbit: 0, status: null, time: 0, frame: 0 }, 5, true);
  const clock = record.clock;
  styles.stepMotion(record, { style: "prism", active: true, selected: false, progress: null, orbit: 0, status: null, time: 0, frame: 1 }, 0.05, false);
  assert.ok(Math.abs(record.clock - clock - 0.05 * 2.5) < 1e-12);
  const glyph = styles.glyph("prism", [120, 180, 220], null);
  assert.ok(glyph.scale > 0 && glyph.scale <= 1 && glyph.ringGap === 3.5 && luminance(channels(glyph.ink)) > 200, "a light glyph ink on the dark table");
});

test("Prism's detail steps down from a turning brilliant to a small kite within its budgets", () => {
  const styles = loadNodeStyles();
  // Worst case over a full turn (7 s) and three light sweeps, per tier and state.
  const BUDGET = {
    0: { quiet: 9, working: 9, arc: 1, fill: 4, stroke: 1 },
    1: { quiet: 22, working: 28, arc: 1, fill: 12, stroke: 3 },
    2: { quiet: 30, working: 40, arc: 1, fill: 17, stroke: 6 },
    3: { quiet: 42, working: 57, arc: 1, fill: 18, stroke: 7 },
  };
  for (const [name, flags] of Object.entries(STATES)) {
    for (const detail of [0, 1, 2, 3]) {
      const { record, step } = recordFor(styles, flags);
      const worst = { lineTo: 0, arc: 0, fill: 0, stroke: 0, reach: 0, pathReach: 0 };
      for (let frame = 0; frame < 230; frame += 1) {
        stepOn(styles, record, step, 1);
        const ctx = paintOnce(styles, RADII[detail], { ...flags, motion: record, time: step.time, detail });
        for (const key of ["lineTo", "arc", "fill", "stroke"]) worst[key] = Math.max(worst[key], ctx.calls[key]);
        worst.reach = Math.max(worst.reach, ctx.calls.reach / RADII[detail]);
        worst.pathReach = Math.max(worst.pathReach, ctx.calls.pathReach / RADII[detail]);
        assert.equal(ctx.calls.saves, ctx.calls.restores);
      }
      const budget = BUDGET[detail], label = `${name} T${detail} ${JSON.stringify(worst)}`;
      assert.ok(worst.lineTo <= (flags.active ? budget.working : budget.quiet), `${label}: lineTo`);
      assert.ok(worst.arc <= budget.arc && worst.fill <= budget.fill && worst.stroke <= budget.stroke, `${label}: arcs, fills, strokes`);
      assert.ok(worst.reach <= 1.8, `${label}: reach stays inside 1.8 radii`);
      assert.ok(worst.pathReach <= (flags.active ? 1.6 : 1.1), `${label}: shards within 1.6 radii at work, the gem within 1.1 at rest`);
    }
  }
  // A small gem keeps fewer planes: T3 > T1 > T0 in fills, a single stroke at T0.
  const fills = [3, 1, 0].map((detail) => paintOnce(styles, RADII[detail], { detail }).calls.fill);
  assert.ok(fills[0] > fills[1] && fills[1] > fills[2], `fewer facets as it shrinks (${fills})`);
});

test("Prism builds its two paints once per canvas and tint and nothing on a steady frame", () => {
  const styles = loadNodeStyles();
  const ctx = recordingContext({ center: P });
  const { record, step } = recordFor(styles, { active: true, selected: true });
  const frame = (tint, time) => styles.paint(ctx, "prism", P, 12, tint, { kind: "task", active: true, selected: true, chosen: true, motion: record, time, detail: 3 });
  frame(TINT, step.time); frame(TINT, step.time + 33);
  const warm = gradientsBuilt(ctx);
  assert.equal(warm, 2, "the lit glow and the light band");
  for (let index = 0; index < 60; index += 1) { stepOn(styles, record, step, 1); frame([220, 180, 110], step.time); }
  frame(TINT, 5000); frame(TINT, 99999);
  assert.equal(gradientsBuilt(ctx), warm, "no gradient on a steady frame, a fresh equal tint or a late clock");
  const other = [104, 236, 164];
  frame(other, 6000); frame(other, 6033);
  const withOther = gradientsBuilt(ctx);
  frame(TINT, 6066); frame(other, 6099); frame(TINT, 6132);
  assert.equal(gradientsBuilt(ctx), withOther, "a tint change and back reuses both tints' paints");
  assert.equal(styles.cacheStats(ctx).entries, 2, "one cache entry per tint and theme: no lit level, time or radius in the key");
  // Paints belong to their canvas.
  const second = recordingContext({ center: P });
  styles.paint(second, "prism", P, 12, TINT, { kind: "task", active: true, motion: record, time: 1, detail: 3 });
  assert.equal(gradientsBuilt(second), 2);
  assert.deepEqual(ctx.calls.shadowBlurs, []);
});

test("Prism holds a designed still pose under reduced motion and animates otherwise", () => {
  const styles = loadNodeStyles();
  for (const [name, flags] of Object.entries({ ...STATES, agent: { kind: "agent", active: true }, hub: { kind: "assistant" } })) {
    for (const detail of [0, 1, 2, 3]) {
      const radius = RADII[detail] + (flags.kind === "assistant" ? 0.5 : 0);
      // No record (the shared pose) and a record stepped under reduced motion.
      const still = styles.motionRecord(new Map(), "task:still");
      styles.stepMotion(still, { style: "prism", active: flags.active === true, selected: flags.selected === true, progress: null, orbit: 1.1, status: null, time: 0, frame: 0 }, 1 / 30, true);
      for (const motion of [null, still]) {
        const logs = [0, 1234, 99999].map((time) => plain(paintOnce(styles, radius, { ...flags, motion, time, still: true, detail }).calls.log));
        assert.deepEqual(logs[1], logs[0], `${name} T${detail}: still at 1234 ms`);
        assert.deepEqual(logs[2], logs[0], `${name} T${detail}: still at 99999 ms`);
      }
      const { record, step } = recordFor(styles, flags);
      const before = plain(paintOnce(styles, radius, { ...flags, motion: record, time: step.time, detail }).calls.log);
      stepOn(styles, record, step, 12);
      const after = plain(paintOnce(styles, radius, { ...flags, motion: record, time: step.time, detail }).calls.log);
      assert.notDeepEqual(after, before, `${name} T${detail}: 400 ms later it has moved`);
    }
  }
  // Working is not idle: the shards and sparkles come in.
  const idle = recordFor(styles, {}), working = recordFor(styles, { active: true });
  assert.notDeepEqual(plain(paintOnce(styles, 12, { motion: idle.record, time: 3000 }).calls.log), plain(paintOnce(styles, 12, { active: true, motion: working.record, time: 3000 }).calls.log));
});

test("Prism's facets turn through the key light and a pavilion facet catches fire", () => {
  const styles = loadNodeStyles();
  const theme = styles.theme(DARK);
  const { record, step } = recordFor(styles, {});
  const tones = new Set(), fire = new Set(), shapes = new Set();
  for (let frame = 0; frame < 210; frame += 1) {
    stepOn(styles, record, step, 1);
    const ctx = paintOnce(styles, 12, { motion: record, time: step.time, detail: 3, theme });
    for (const { style } of ctx.calls.fills) if (typeof style === "string") tones.add(style);
    // (the fire's second hue is the theme's #36d1ff paled a quarter toward white)
    for (const { style, alpha } of ctx.calls.fills) if (style === "rgba(104,221,255,1)" && alpha < 1) fire.add(Math.round(alpha * 10));
    shapes.add(ctx.calls.log.filter(([name]) => name === "lineTo").slice(0, 3).map(([, x]) => x.toFixed(4)).join());
  }
  assert.ok(tones.size >= 9, `the facets pass through many tones as they turn (${tones.size})`);
  assert.ok(fire.size >= 3, "fire rises and falls on the pavilion in the second hue");
  // A six-facet girdle repeats every sixth of a turn: 35 frames of 210.
  assert.ok(shapes.size >= 30, `the girdle turns: the outline's vertices move every frame (${shapes.size})`);
  // The T0 kite's lit plane swings its ridge as the gem turns.
  const ridges = new Set();
  for (let frame = 0; frame < 60; frame += 1) {
    stepOn(styles, record, step, 1);
    const ctx = paintOnce(styles, 4.5, { motion: record, time: step.time, detail: 0 });
    ridges.add(ctx.calls.log.filter(([name]) => name === "lineTo")[5][1].toFixed(3));
  }
  assert.ok(ridges.size > 20, "a small gem's ridge visibly turns");
});

test("Prism's small kite (T0) is lit like the larger gem and catches the light band as it passes", () => {
  const styles = loadNodeStyles();
  const theme = styles.theme(DARK);
  // A todo (always T0) is a crystal, not a grey chip: its lit plane reaches
  // past the tint toward hot, its base plane sits in the shade (a strong
  // ridge), and the two average three quarters of the tint.
  for (const tint of [TINT, [255, 212, 121], [104, 236, 164], [185, 176, 255]]) {
    const ctx = recordingContext({ center: P });
    styles.paint(ctx, "prism", P, 4.5, tint, { kind: "task", time: 0, detail: 0, theme });
    const [plane, lit] = ctx.calls.fills.map(({ style }) => luminance(channels(style)));
    assert.ok(lit >= 0.6 * luminance(tint) && lit > plane, `${tint}: the lit plane reads (${lit.toFixed(0)} of ${luminance(tint).toFixed(0)})`);
    assert.ok(lit >= luminance(tint) && plane >= 0.4 * luminance(tint) && plane + lit >= 1.4 * luminance(tint), `${tint}: a lit crystal, not a grey chip (${plane.toFixed(0)} / ${lit.toFixed(0)})`);
  }
  // The band crosses it in the big gem's rhythm: a spec flash over the whole
  // kite rises and falls, and is gone while the band is away.
  const { record, step } = recordFor(styles, {});
  const levels = new Set();
  let away = 0;
  for (let frame = 0; frame < 120; frame += 1) {
    stepOn(styles, record, step, 1);
    const ctx = paintOnce(styles, 4.5, { motion: record, time: step.time, detail: 0, theme });
    if (ctx.calls.fill === 2) away += 1;
    else levels.add(Math.round(ctx.calls.fills[2].alpha * 40));
  }
  assert.ok(levels.size >= 6 && away >= 20, `the band's flash sweeps in and out (${levels.size} levels, ${away} frames dark)`);
});

test("Prism's working shards are two-tone crystals on a traced, tilted orbit, the caustics secondary", () => {
  const styles = loadNodeStyles();
  const theme = styles.theme(DARK);
  // TINT's lit tone (mixed .62 toward white) and the tint itself.
  const LIT = "rgba(242,227,200,1)", SHADE = "rgba(220,180,110,1)";
  const { record, step } = recordFor(styles, { active: true });
  let twoTone = 0, back = 0, quads = { 2: 0, 3: 0 };
  for (let frame = 0; frame < 180; frame += 1) {
    stepOn(styles, record, step, 1);
    const ctx = paintOnce(styles, 15, { active: true, motion: record, time: step.time, detail: 3, theme });
    const lit = ctx.calls.fills.some(({ style, alpha }) => style === LIT && Math.abs(alpha - 0.95) < 1e-9);
    const shade = ctx.calls.fills.some(({ style, alpha }) => style === SHADE && Math.abs(alpha - 0.75) < 1e-9);
    if (lit && shade) twoTone += 1;
    if (ctx.calls.fills.some(({ style, alpha }) => style === SHADE && Math.abs(alpha - 0.55) < 1e-9)) back += 1;
    // The orbit's trace: its far half behind the gem, its near half in front.
    const ellipses = ctx.calls.log.filter(([name]) => name === "ellipse").map((call) => call.slice(3, 8).map((value) => Math.round(value * 1000) / 1000));
    assert.deepEqual(ellipses, [[1.34, 0.42, -0.35, 3.142, 6.283], [1.34, 0.42, -0.35, 0, 1.04], [1.34, 0.42, -0.35, 2.102, 3.142]]);
    // The near half's two arcs stay off the body: outside the hull every turn
    // of the gem fits in (its apexes and the girdle's band) by .05 radii.
    for (const [rx, ry, tilt, from, to] of ellipses.slice(1)) {
      for (let sample = 0; sample <= 24; sample += 1) {
        const angle = from + (to - from) * sample / 24, ex = rx * Math.cos(angle), ey = ry * Math.sin(angle);
        const x = ex * Math.cos(tilt) - ey * Math.sin(tilt), y = ex * Math.sin(tilt) + ey * Math.cos(tilt);
        let outside = -Infinity;
        for (let edge = 0; edge < GEM_HULL.length; edge += 1) {
          const [x0, y0] = GEM_HULL[edge], [x1, y1] = GEM_HULL[(edge + 1) % GEM_HULL.length], length = Math.hypot(x1 - x0, y1 - y0);
          outside = Math.max(outside, ((x - x0) * (y1 - y0) - (y - y0) * (x1 - x0)) / length);
        }
        assert.ok(outside >= 0.05, `the front trace clears the gem at ${angle.toFixed(2)} (${outside.toFixed(3)})`);
      }
    }
    quads[3] = Math.max(quads[3], ctx.calls.quadraticCurveTo);
    quads[2] = Math.max(quads[2], paintOnce(styles, 9.8, { active: true, motion: record, time: step.time, detail: 2, theme }).calls.quadraticCurveTo);
  }
  assert.equal(twoTone, 180, "a near shard is always cut in a lit and a shaded half");
  assert.ok(back > 60, `the far shards pass behind the gem in the dim tint (${back}/180)`);
  // Glint and twinkle (4 curves each) plus three caustic sparkles at T3; glint and two at T2.
  assert.ok(quads[3] <= 4 + 4 + 3 * 4 && quads[2] <= 4 + 2 * 4, JSON.stringify(quads));
  // The shards stand tall enough to read: every near shard's lit half spans
  // .5 radii or more (the log keeps the unit-space points the gem is drawn in).
  const ctx = paintOnce(styles, 15, { active: true, motion: record, time: step.time, detail: 3, theme });
  const log = plain(ctx.calls.log), at = log.findLastIndex(([name, style]) => name === "set:fillStyle" && style === LIT);
  const opened = at - log.slice(0, at).reverse().findIndex(([name]) => name === "beginPath");
  const shards = [];
  for (const [name, x, y] of log.slice(opened, at)) {
    if (name === "moveTo") shards.push([[x, y]]);
    else if (name === "lineTo") shards.at(-1).push([x, y]);
  }
  assert.ok(shards.length >= 1);
  for (const points of shards) {
    let span = 0;
    for (const [x0, y0] of points) for (const [x1, y1] of points) span = Math.max(span, Math.hypot(x1 - x0, y1 - y0));
    assert.ok(span >= 0.5, `a near shard is a real crystal, not a speck (${span.toFixed(2)} r)`);
  }
  // No trace on a small (T1) gem, which keeps two shards.
  assert.equal(paintOnce(styles, 7.5, { active: true, motion: record, time: step.time, detail: 1, theme }).calls.ellipse, 0);
});

test("Prism marks a selected node, glows while lit, flashes on a landing kick and fades with the caller", () => {
  const styles = loadNodeStyles();
  const quiet = paintOnce(styles, 12, {}), selected = paintOnce(styles, 12, { selected: true }), chosen = paintOnce(styles, 12, { selected: true, chosen: true });
  assert.ok(Math.max(...selected.calls.lineWidths) > Math.max(...quiet.calls.lineWidths), "selected raises the rim");
  assert.ok(Math.max(...chosen.calls.lineWidths) >= Math.max(...selected.calls.lineWidths));
  assert.equal(quiet.calls.radial + quiet.calls.arc, 0, "no glow at rest");
  assert.equal(selected.calls.arc, 1, "the lit glow");
  const { record, step } = recordFor(styles, {});
  const calm = paintOnce(styles, 12, { motion: record, time: step.time }).calls.fills.length;
  record.kick = 1;
  const kicked = paintOnce(styles, 12, { motion: record, time: step.time });
  assert.equal(kicked.calls.fills.length, calm + 1, "a landing flashes the gem once");
  // Every layer is proportional to the caller's alpha, the body at exactly it.
  for (const flags of [{}, { active: true }, { selected: true, chosen: true }, { kind: "agent", active: true }]) {
    const full = paintOnce(styles, 12, { ...flags, motion: record, time: step.time, alpha: 1 });
    const dim = paintOnce(styles, 12, { ...flags, motion: record, time: step.time, alpha: 0.3 });
    assert.equal(dim.calls.alphas.length, full.calls.alphas.length);
    assert.ok(dim.calls.alphas.every((alpha, index) => alpha > 0 && alpha <= 0.3 + 1e-12 && Math.abs(alpha - 0.3 * full.calls.alphas[index]) < 1e-12));
    assert.ok(dim.calls.alphas.includes(0.3));
  }
});

test("Prism keeps the tint dominant and reads on dark and light themes", () => {
  const styles = loadNodeStyles();
  for (const palette of [DARK, LIGHT]) {
    const theme = styles.theme(palette), bg = channels(`${parseInt(palette.background.slice(1, 3), 16)},${parseInt(palette.background.slice(3, 5), 16)},${parseInt(palette.background.slice(5), 16)}`);
    for (const tint of [[104, 236, 164], [255, 212, 121], [185, 176, 255]]) {
      const ctx = recordingContext({ center: P });
      styles.paint(ctx, "prism", P, 12, tint, { kind: "task", time: 0, detail: 3, theme });
      const body = ctx.calls.fills.filter(({ style, alpha }) => typeof style === "string" && alpha === 1).map(({ style }) => channels(style));
      // The facets stand well off the background on either theme.
      const facets = body.slice(1).reduce((sum, rgb) => sum + luminance(rgb), 0) / (body.length - 1);
      assert.ok(Math.abs(facets - luminance(bg)) > 40, `${palette.background} ${tint}: the gem stands off the background (${facets.toFixed(0)})`);
      // The facets carry the tint's hue: most facet tones lean the way the tint leans.
      const lean = (rgb) => rgb.indexOf(Math.max(...rgb));
      const hue = body.slice(1).filter((rgb) => lean(rgb) === lean(tint)).length;
      assert.ok(hue >= Math.ceil((body.length - 1) / 2), `${palette.background} ${tint}: the tint stays dominant (${hue}/${body.length - 1})`);
    }
    // The hub's monogram is written in a light ink on the dark table.
    const hub = recordingContext({ center: P });
    styles.paint(hub, "prism", P, 15, [120, 180, 220], { kind: "assistant", theme });
    const [monogram] = hub.calls.texts;
    assert.equal(monogram.text, "M");
    assert.ok(luminance(channels(monogram.ink)) > 200, `light ink (${monogram.ink})`);
    const table = hub.calls.fills.find(({ alpha }) => Math.abs(alpha - 0.94) < 1e-9);
    assert.ok(table && luminance(channels(table.style)) < 90, "on a dark table");
  }
});

test("Prism stays legible on a light theme: every facet off the ground, a pale glow and band, deeper state inks", () => {
  const styles = loadNodeStyles();
  const theme = styles.theme(LIGHT), ground = luminance([243, 240, 232]);
  // Over a full turn (7 s), no opaque facet of a pale state tint melts into the cream.
  for (const tint of [[255, 212, 121], [104, 236, 164], [185, 176, 255]]) {
    const { record, step } = recordFor(styles, {});
    let closest = Infinity, tone = "";
    for (let frame = 0; frame < 215; frame += 1) {
      stepOn(styles, record, step, 1);
      const ctx = recordingContext({ center: P });
      styles.paint(ctx, "prism", P, 15, tint, { kind: "task", motion: record, time: step.time, detail: 3, theme });
      for (const { style, alpha } of ctx.calls.fills) {
        if (typeof style !== "string" || alpha !== 1) continue;
        const apart = Math.abs(luminance(channels(style)) - ground);
        if (apart < closest) { closest = apart; tone = style; }
      }
    }
    assert.ok(closest >= 20, `${tint}: every opaque facet stands off the light ground (closest ${tone}, ${closest.toFixed(1)})`);
  }
  // The lit glow is built from a paled tint (no brown haze), ends at 1.45
  // radii (inside the shards' orbit), and the light band peaks in plain white.
  const tint = [160, 110, 60];
  const lit = recordingContext({ center: P });
  styles.paint(lit, "prism", P, 15, tint, { kind: "task", selected: true, time: 0, detail: 3, theme });
  const glow = lit.calls.gradients.find(({ kind }) => kind === "radial"), band = lit.calls.gradients.find(({ kind }) => kind === "linear");
  assert.equal(glow.args.at(-1), 1.45);
  assert.ok(luminance(channels(glow.stops[0][1])) > luminance(tint) + 40, `a pale glow (${glow.stops[0][1]})`);
  assert.ok(band.stops.some(([offset, colour]) => offset === 0.5 && colour === "rgba(255,255,255,0.42)"));
  const dark = recordingContext({ center: P });
  styles.paint(dark, "prism", P, 15, tint, { kind: "task", selected: true, time: 0, detail: 3, theme: styles.theme(DARK) });
  assert.equal(dark.calls.gradients.find(({ kind }) => kind === "radial").stops[0][1], "rgba(160,110,60,0.3)", "a dark theme keeps the tint's own glow");
  // The error and done rings deepen their state colours on the cream.
  for (const [status, raw] of [["error", "rgba(255,212,121,1)"], ["done", "rgba(104,236,164,1)"]]) {
    const ctx = recordingContext({ center: P });
    styles.ring(ctx, "prism", P, 8, TINT, { status, builder: false, ring: 11.5, time: 1000, still: true, detail: 3, motion: null, theme });
    const edges = ctx.calls.strokes.map(({ style }) => style);
    assert.ok(!edges.includes(raw) && edges.every((style) => ground - luminance(channels(style)) > 60), `${status}: a deeper ink on a light theme (${edges})`);
  }
});

test("Prism's working effects on a light theme are crystal light: pale-lit two-tone shards, sparkles in the spectrum", () => {
  const styles = loadNodeStyles();
  const theme = styles.theme(LIGHT), ground = luminance([243, 240, 232]);
  // The spectrum, as the running agent ring draws it.
  const ring = recordingContext({ center: P });
  styles.ring(ring, "prism", P, 10, [160, 130, 85], { status: "running", builder: false, ring: 13.5, time: 0, still: true, detail: 3, motion: null, theme });
  const [rose, second, blue] = ring.calls.strokes.slice(1).map(({ style }) => style);
  for (const tint of [[160, 130, 85], [255, 212, 121], [104, 236, 164]]) {
    const { record, step } = recordFor(styles, { active: true });
    const lits = new Set(), shades = new Set(), sparkles = new Set();
    for (let frame = 0; frame < 150; frame += 1) {
      stepOn(styles, record, step, 1);
      const ctx = recordingContext({ center: P });
      styles.paint(ctx, "prism", P, 15, tint, { kind: "task", active: true, motion: record, time: step.time, detail: 3, theme });
      // The last layers: the near shards' lit (.95) and shaded (.9) halves,
      // then the caustic sparkles (.95), each a single fill.
      for (const { style, alpha } of ctx.calls.fills) {
        if (Math.abs(alpha - 0.9) < 1e-9) shades.add(style);
        else if (Math.abs(alpha - 0.95) < 1e-9 && style !== "rgba(255,255,255,1)") (style === rose || style === blue || style === second ? sparkles : lits).add(style);
      }
    }
    assert.equal(lits.size, 1, `${tint}: one lit tone for the shards (${[...lits]})`);
    assert.equal(shades.size, 1, `${tint}: one shaded tone (${[...shades]})`);
    const lit = luminance(channels([...lits][0])), shade = luminance(channels([...shades][0]));
    assert.ok(lit >= 110 && lit - shade >= 70, `${tint}: the lit half catches the light (${lit.toFixed(0)} over ${shade.toFixed(0)})`);
    assert.ok(Math.abs(lit - ground) >= 22 && Math.abs(shade - ground) >= 22, `${tint}: both halves stand off the cream`);
    // The sparkles: rose and blue by turns (never the dark second hue or a
    // darkened tint, which read as grit), each light enough to glint.
    assert.deepEqual([...sparkles].sort(), [blue, rose].sort(), `${tint}: sparkles in the spectrum (${[...sparkles]})`);
    for (const style of sparkles) assert.ok(luminance(channels(style)) >= 110, style);
  }
  // A dark theme keeps its glare sparkles: one fill for them all.
  const dark = styles.theme(DARK), { record, step } = recordFor(styles, { active: true });
  let most = 0;
  for (let frame = 0; frame < 60; frame += 1) {
    stepOn(styles, record, step, 1);
    const ctx = recordingContext({ center: P });
    styles.paint(ctx, "prism", P, 15, TINT, { kind: "task", active: true, motion: record, time: step.time, detail: 3, theme: dark });
    most = Math.max(most, ctx.calls.fills.filter(({ style, alpha }) => style === "rgba(249,242,229,1)" && Math.abs(alpha - 0.95) < 1e-9).length);
  }
  assert.equal(most, 1);
});

test("Prism's agent ring chases three hues, and keeps queued, error and done in their state colours", () => {
  const styles = loadNodeStyles();
  const theme = styles.theme(DARK);
  const ring = (status, extra = {}) => {
    const ctx = recordingContext({ center: P });
    ctx.globalAlpha = 0.8;
    const answer = styles.ring(ctx, "prism", P, 10, TINT, { status, builder: false, ring: 13.5, time: 1000, still: false, detail: 3, motion: null, theme, ...extra });
    assert.equal(answer, true);
    assert.equal(ctx.calls.saves, ctx.calls.restores);
    assert.equal(ctx.globalAlpha, 0.8, "the caller's alpha comes back");
    assert.ok(ctx.calls.alphas.every((alpha) => alpha <= 0.8 + 1e-12));
    return ctx;
  };
  const { record, step } = recordFor(styles, { active: true, status: "running" });
  const running = ring("running", { motion: record, time: step.time });
  assert.equal(running.calls.arc, 4, "a faint track and three short arcs");
  assert.deepEqual(new Set(running.calls.strokes.slice(1).map(({ style }) => style)).size, 3, "in three hues");
  stepOn(styles, record, step, 6);
  assert.notDeepEqual(plain(ring("running", { motion: record, time: step.time }).calls.log), plain(running.calls.log), "they chase round");
  const queued = ring("queued");
  assert.equal(queued.calls.setLineDash, 1, "queued is a dashed ring");
  const error = ring("error");
  assert.ok(error.calls.strokes.some(({ style }) => style === "rgba(255,212,121,1)") && error.calls.texts[0]?.text === "!", "error: an amber ring and a '!' gem");
  const done = ring("done");
  assert.ok(done.calls.strokes.some(({ style }) => style === "rgba(104,236,164,1)") && done.calls.lineTo >= 5, "done: a green tick gem");
  // A badge pops in after its status changes (easeOutBack over 320 ms).
  const popping = styles.motionRecord(new Map(), "agent:pop");
  popping.statusAt = 1000;
  const early = ring("done", { motion: popping, time: 1040 }), settled = ring("done", { motion: popping, time: 1400 });
  const scaleOf = (ctx) => ctx.calls.log.find(([name]) => name === "scale")[1];
  assert.ok(scaleOf(early) < 0.6 && Math.abs(scaleOf(settled) - 1) < 1e-9, "the badge pops in");
  const bare = ring(null);
  assert.equal(bare.calls.stroke + bare.calls.fill, 0, "an idle agent wears no ring");
});

test("Prism's hub dress, work orbit, arrival and selection draw in the spectrum", () => {
  const styles = loadNodeStyles();
  const theme = styles.theme(DARK);
  const hub = recordingContext({ center: P });
  assert.equal(styles.hubDress(hub, "prism", P, 15, TINT, { crew: true, breathe: 0.5, time: 0, still: false, detail: 3, motion: null, theme }), true);
  assert.equal(hub.calls.arc, 4, "three arcs of the spectrum and the crew's dashed ring");
  assert.equal(hub.calls.setLineDash, 1);
  // The orbit rides the integrated phase and never falls back to the legacy blue.
  const { record, step } = recordFor(styles, { active: true });
  const orbitAt = () => {
    const ctx = recordingContext({ center: P });
    assert.equal(styles.orbit(ctx, "prism", P, 12, null, { running: true, phase: 0, ring: 21, time: step.time, still: false, detail: 3, motion: record, theme }), true);
    return ctx;
  };
  const first = orbitAt();
  assert.equal(first.calls.arc, 4);
  assert.ok(!JSON.stringify(first.calls.log).includes("rgba(125,178,255"), "no legacy blue");
  assert.ok(first.calls.reach <= 21 + 3, "on its ring at r + 9");
  stepOn(styles, record, step, 5);
  assert.notDeepEqual(plain(orbitAt().calls.log), plain(first.calls.log), "the comet travels with motion.orbit");
  // Arrival: a starburst and a shockwave, bounded, fading to nothing.
  const arrive = (t01, detail = 3, radius = 12) => {
    const ctx = recordingContext({ center: P });
    assert.equal(styles.arrival(ctx, "prism", P, radius, TINT, t01, { kind: "task", alpha: 0.9, time: 0, still: false, detail, motion: record, theme }), true);
    assert.equal(ctx.calls.saves, ctx.calls.restores);
    assert.ok(ctx.calls.alphas.every((alpha) => alpha <= 0.9 + 1e-12));
    return ctx;
  };
  // Each ray is a tapered triangle (moveTo, lineTo tip, lineTo, closePath): [length, base width] in px.
  const raysOf = (ctx) => {
    const log = plain(ctx.calls.log), rays = [];
    for (let index = 0; index + 3 < log.length; index += 1) {
      const [move, tip, other, close] = log.slice(index, index + 4);
      if (move[0] !== "moveTo" || tip[0] !== "lineTo" || other[0] !== "lineTo" || close[0] !== "closePath") continue;
      const baseX = (move[1] + other[1]) / 2, baseY = (move[2] + other[2]) / 2;
      rays.push([Math.hypot(tip[1] - P.x, tip[2] - P.y) - Math.hypot(baseX - P.x, baseY - P.y), Math.hypot(move[1] - other[1], move[2] - other[2])]);
    }
    return rays;
  };
  let widest = 0;
  for (const t01 of [0.05, 0.25, 0.5, 0.75, 0.95]) {
    const ctx = arrive(t01);
    assert.ok(ctx.calls.fill >= 4);
    widest = Math.max(widest, ctx.calls.reach / 12);
  }
  assert.ok(widest > 1.8 && widest <= 2.25, `the burst reaches out, inside 2.25 radii (${widest.toFixed(2)})`);
  // Halfway through, the long rays still reach .7 radii past their bases, on bases a few pixels wide.
  const halfway = raysOf(arrive(0.5, 3, 15)), long = halfway.filter(([length]) => length >= 0.7 * 15);
  assert.equal(halfway.length, 12, "six rays and six glints");
  assert.equal(long.length, 6, `six long rays (${halfway.map(([length]) => (length / 15).toFixed(2))})`);
  const early = raysOf(arrive(0.25, 3, 15)).sort((one, two) => two[0] - one[0]).slice(0, 6);
  assert.ok(early.every(([, width]) => width >= 2.5), `the long rays have body (${early.map(([, width]) => width.toFixed(1))} px)`);
  // The flash lights the gem's own turned outline, not a stand-in kite: the
  // first path is the body's silhouette at the same turn.
  // (every filled path, as its unit-space points)
  const pathsOf = (ctx) => {
    const paths = [];
    let points = [];
    for (const [name, x, y] of plain(ctx.calls.log)) {
      if (name === "beginPath") points = [];
      else if (name === "moveTo" || name === "lineTo") points.push([x, y]);
      else if (name === "fill") paths.push(JSON.stringify(points));
    }
    return paths;
  };
  const body = recordingContext({ center: P });
  styles.paint(body, "prism", P, 12, TINT, { kind: "task", time: 0, detail: 3, motion: record, theme });
  const [flash] = pathsOf(arrive(0.1));
  assert.ok(pathsOf(body).includes(flash), "the flash fills the body's own silhouette");
  const kite = pathsOf(arrive(0.1, 0))[0];
  assert.ok(flash !== kite && JSON.parse(kite).length === 4, "the turned gem's silhouette; the small kite at T0");
  // A far, dimmed or moving node gets the flash, the six rays and the ring, no glints.
  const plainBurst = arrive(0.3, 1);
  assert.equal(raysOf(plainBurst).length, 6);
  assert.equal(plainBurst.calls.stroke, 1);
  // Selection: a hover ring at 1.22 radii; the chosen node's three arcs turn.
  const hover = recordingContext({ center: P });
  styles.select(hover, "prism", P, 12, TINT, { kind: "task", selected: true, chosen: false, hover: true, alpha: 1, time: 0, still: true, detail: 3, motion: null, theme });
  assert.deepEqual(hover.calls.log.filter(([name]) => name === "arc").map((call) => call[3]), [12 * 1.22]);
  const chosenAt = () => {
    const ctx = recordingContext({ center: P });
    styles.select(ctx, "prism", P, 12, TINT, { kind: "task", selected: true, chosen: true, hover: false, alpha: 1, time: step.time, still: false, detail: 3, motion: record, theme });
    return ctx;
  };
  const chosen = chosenAt();
  assert.equal(chosen.calls.arc, 3);
  assert.ok(Math.max(...chosen.calls.lineWidths) >= 1.6);
  stepOn(styles, record, step, 10);
  assert.notDeepEqual(plain(chosenAt().calls.log), plain(chosen.calls.log), "the dispersed ring turns");
  const idle = recordingContext({ center: P });
  styles.select(idle, "prism", P, 12, TINT, { kind: "task", selected: false, chosen: false, alpha: 1, time: 0, still: true, detail: 3, motion: null, theme });
  assert.equal(idle.calls.stroke, 0, "nothing to mark");
  // Let go, a node fades out in what it wore: the chosen node's dispersed
  // arcs (at .95 × its easing level), a hovered node's ring.
  const letGo = (was) => {
    const { record: held, step: steps } = recordFor(styles, { selected: true }, 30, `task:${was}`);
    const select = (flags) => {
      const ctx = recordingContext({ center: P });
      styles.select(ctx, "prism", P, 12, TINT, { kind: "task", selected: false, chosen: false, hover: false, alpha: 1, time: steps.time, still: false, detail: 3, motion: held, theme, ...flags });
      return ctx;
    };
    select(was === "chosen" ? { selected: true, chosen: true } : { selected: true, hover: true });
    steps.selected = false;
    stepOn(styles, held, steps, 3);
    assert.ok(held.sel > 0.2 && held.sel < 0.9);
    return { ctx: select({}), sel: held.sel };
  };
  const chosenFade = letGo("chosen"), hoverFade = letGo("hovered");
  assert.equal(chosenFade.ctx.calls.arc, 3, "a chosen node's arcs fade out as arcs");
  assert.ok(chosenFade.ctx.calls.alphas.every((alpha) => Math.abs(alpha - 0.95 * chosenFade.sel) < 1e-9));
  assert.deepEqual(hoverFade.ctx.calls.log.filter(([name]) => name === "arc").map((call) => call[3]), [12 * 1.22], "a hovered node's ring fades out as a ring");
  assert.ok(styles.reach("prism", null) >= 1 && styles.reach("prism", record) <= 1.8 && styles.reach("prism", record) > 1.4, "label clearance widens for the shards");
  // On a small gem the marks keep off the kite (which spans 1.08 radii) by a
  // pixel or more past their pen, instead of closing into a coloured donut:
  // the chosen arcs 2.4 px out or more on a finer pen, the hover ring 2.6 px.
  for (const radius of [3, 4.5, 6]) {
    const mark = (flags) => {
      const ctx = recordingContext({ center: P });
      styles.select(ctx, "prism", P, radius, TINT, { kind: "task", selected: true, hover: false, alpha: 1, time: 0, still: true, detail: 0, motion: null, theme, ...flags });
      const rings = ctx.calls.log.filter(([name]) => name === "arc").map((call) => call[3]), pen = Math.max(...ctx.calls.lineWidths);
      assert.ok(rings.every((ring) => ring - pen / 2 >= 1.08 * radius + 1), `r ${radius}: off the gem (${rings.map((ring) => ring.toFixed(1))}, pen ${pen})`);
      return Math.max(...rings);
    };
    const outer = mark({ chosen: true });
    assert.ok(outer <= 2.25 * radius, `r ${radius}: the ring stays inside 2.25 radii`);
    mark({ chosen: false, hover: true });
    if (radius >= 6) assert.ok(outer <= styles.reach("prism", { sel: 1 }) * radius, "a chosen node's reach covers its ring from 6 px up");
  }
});

test("Prism's wires refract: a glint runs the beam and splits into three strands near a large target", () => {
  const styles = loadNodeStyles();
  const a = { x: 10, y: 150 }, b = { x: 210, y: 40 };
  const wire = (extra = {}) => {
    const ctx = recordingContext({ center: b });
    ctx.globalAlpha = 1;
    const o = { kind: "task", tint: TINT, alpha: 0.55, width: 1.4, dash: [2, 4], march: true, double: false, active: true, inspected: false, curved: false, cp: null, far: false, time: 700, still: false, seed: 0.3, rA: 8, rB: 12, detail: 3, lifetime: 1, ...extra };
    const answer = styles.wire(ctx, "prism", a, b, o);
    return { ctx, answer };
  };
  const active = wire();
  assert.equal(active.answer, true);
  assert.equal(active.ctx.calls.saves, active.ctx.calls.restores);
  assert.deepEqual(active.ctx.getLineDash(), [], "the pen's dash comes back");
  assert.deepEqual(plain(active.ctx.calls.log.filter(([name]) => name === "setLineDash")).map((call) => call.slice(1)), [[], [2, 4], []], "the beam's underlay is solid, the line keeps the pen's dash, the overlays are solid");
  const strands = active.ctx.calls.strokes.filter(({ width }) => Math.abs(width - 1.19) < 0.01);
  assert.equal(strands.length, 3, "three strands");
  assert.deepEqual(new Set(strands.map(({ style }) => style)).size, 3, "rose, the tint and blue");
  assert.ok(active.ctx.calls.log.some(([name, x, y]) => name === "lineTo" && Math.hypot(x - b.x, y - b.y) < 12 * 0.36 + 1e-9 && Math.hypot(x - b.x, y - b.y) > 0.1), "the strands fan into the node");
  assert.equal(gradientsBuilt(active.ctx), 0);
  assert.deepEqual(active.ctx.calls.shadowBlurs, []);
  // Quiet and small: no split; the glint still runs.
  const quiet = wire({ active: false, dash: [], march: false, detail: 1, rB: 5 });
  assert.equal(quiet.ctx.calls.stroke, 2, "the line and its glint");
  // The far (blurred) pen: the line alone. The hub's double line stays double.
  const far = wire({ far: true });
  assert.equal(far.ctx.calls.stroke, 1);
  const double = wire({ far: true, double: true, dash: [] });
  assert.deepEqual([double.ctx.calls.stroke, double.ctx.calls.moveTo], [1, 2]);
  // Reduced motion: no glint, the strands held.
  const stillA = wire({ still: true, time: 0 }), stillB = wire({ still: true, time: 5000 });
  assert.deepEqual(plain(stillA.ctx.calls.log), plain(stillB.ctx.calls.log));
  // The S-curve keeps its bezier; the glint moves along it.
  const curved = wire({ curved: true, cp: { x1: a.x, y1: 95, x2: b.x, y2: 95 } });
  assert.ok(curved.ctx.calls.bezierCurveTo >= 1);
  // On the tree's S-curve the strands split off the drawn curve itself (its
  // end tangent turns vertical only in the last pixels), never off a point
  // hanging beside it.
  {
    const from = { x: 100, y: 40 }, to = { x: 300, y: 140 }, middle = (from.y + to.y) / 2, cp = { x1: from.x, y1: middle, x2: to.x, y2: middle };
    const ctx = recordingContext({ center: to });
    styles.wire(ctx, "prism", from, to, { kind: "session", tint: [180, 170, 255], alpha: 0.6, width: 1.4, dash: [], march: false, double: false, active: true, inspected: true, curved: true, cp, far: false, time: 700, still: false, seed: 0.3, rA: 8, rB: 12, detail: 3, lifetime: 1 });
    const starts = plain(ctx.calls.log).filter(([name]) => name === "moveTo").slice(-3);
    for (const [, x, y] of starts) {
      let nearest = Infinity;
      for (let index = 0; index <= 2000; index += 1) {
        const u = index / 2000, v = 1 - u;
        const cx = v * v * v * from.x + 3 * v * v * u * cp.x1 + 3 * v * u * u * cp.x2 + u * u * u * to.x;
        const cy = v * v * v * from.y + 3 * v * v * u * cp.y1 + 3 * v * u * u * cp.y2 + u * u * u * to.y;
        nearest = Math.min(nearest, Math.hypot(cx - x, cy - y));
      }
      assert.ok(nearest <= 1.5 && Math.hypot(x - to.x, y - to.y) > 12, `a strand starts on the curve, outside the node (${nearest.toFixed(2)} px off)`);
    }
  }
  // An edge fading out through its lifetime fades its glint and strands with
  // it: every layer scales with the lifetime, however bright the stroke.
  const bright = wire({ alpha: 0.9, lifetime: 1 }), fading = wire({ alpha: 0.45, lifetime: 0.5 });
  assert.equal(fading.ctx.calls.alphas.length, bright.ctx.calls.alphas.length);
  assert.ok(fading.ctx.calls.alphas.every((alpha, index) => Math.abs(alpha - 0.5 * bright.ctx.calls.alphas[index]) < 1e-12), `${fading.ctx.calls.alphas} vs ${bright.ctx.calls.alphas}`);
  // Strands into a quiet edge's target only at full detail; a lit edge's into any but the smallest.
  const strandsOf = (extra) => wire({ dash: [], march: false, ...extra }).ctx.calls.strokes.filter(({ width }) => Math.abs(width - 1.19) < 0.01).length;
  assert.deepEqual([2, 3].map((detail) => strandsOf({ active: false, detail })), [0, 3]);
  assert.deepEqual([0, 1].map((detail) => strandsOf({ detail })), [0, 3]);
  assert.notDeepEqual(plain(wire({ time: 100 }).ctx.calls.log), plain(wire({ time: 400 }).ctx.calls.log), "the glint travels");
  // The rail: only the active session's edges carry the glint; the rest stay plain.
  const railQuiet = wire({ rail: true, active: false, detail: 2, dash: [], march: false });
  assert.deepEqual([railQuiet.answer, railQuiet.ctx.calls.stroke, railQuiet.ctx.calls.saves], [false, 0, 0]);
  const rail = wire({ rail: true, detail: 2, dash: [], march: false, width: 1 });
  assert.equal(rail.answer, true);
  assert.equal(rail.ctx.calls.stroke, 2, "the rail's line and the glint, no strands");
});

test("Prism's pulses split into the spectrum near the node and land as a colour flash", () => {
  const styles = loadNodeStyles();
  const from = { x: 10, y: 150 }, to = { x: 210, y: 40 };
  const pulse = { color: "#f1dcae", glow: "#e6c98d", wave: false, packet: false, small: false, start: 0, duration: 900 };
  const surge = (t, extra = {}) => {
    const ctx = recordingContext({ center: to });
    const answer = styles.surge(ctx, "prism", from, to, t, pulse, { kind: "dot", time: t * 900, still: false, rTo: 12, detail: 3, pulse, motion: null, ...extra });
    assert.equal(ctx.calls.saves, ctx.calls.restores);
    assert.deepEqual(ctx.calls.shadowBlurs, []);
    return { ctx, answer };
  };
  const early = surge(0.4);
  assert.equal(early.answer, true);
  assert.equal(early.ctx.calls.arc, 1, "one white head");
  const late = surge(0.95);
  assert.equal(new Set(late.ctx.calls.fills.map(({ style }) => style)).size >= 3, true, "three heads of the spectrum");
  assert.equal(gradientsBuilt(late.ctx), 0);
  const packet = styles.surge(recordingContext(), "prism", from, to, 0.3, { ...pulse, packet: true }, { kind: "wave", time: 270, still: false, rTo: 12, detail: 3 });
  assert.equal(packet, true);
  const still = surge(1, { still: true });
  assert.deepEqual([still.ctx.calls.stroke, still.ctx.calls.fill], [1, 0], "reduced motion: the beam, lit and still");
  assert.equal(surge(0.5, { rail: true }).answer, false, "the rail keeps its own pulses");
  // Landing: three arcs of the spectrum open round the node, and a sparkle.
  for (const u of [0, 0.4, 0.9]) {
    const ctx = recordingContext({ center: to });
    assert.equal(styles.land(ctx, "prism", to, 12, [241, 220, 174], u, { kind: "dot", time: 0, still: false, rTo: 12, detail: 3, pulse, motion: null }), true);
    assert.deepEqual([ctx.calls.arc, ctx.calls.fill], [3, 1]);
    assert.ok(ctx.calls.reach <= 12 * 2.25);
    assert.equal(gradientsBuilt(ctx), 0);
  }
  // A far, dimmed or moving target (detail ≤ 1): one head to the end, one ring on landing.
  const lowHead = surge(0.95, { detail: 1 });
  assert.deepEqual([lowHead.ctx.calls.arc, new Set(lowHead.ctx.calls.fills.map(({ style }) => style)).size], [1, 1]);
  const lowLand = recordingContext({ center: to });
  assert.equal(styles.land(lowLand, "prism", to, 12, [241, 220, 174], 0.3, { kind: "dot", time: 0, still: false, rTo: 12, detail: 1, pulse, motion: null }), true);
  assert.deepEqual([lowLand.calls.arc, lowLand.calls.stroke, lowLand.calls.fill], [1, 1, 0]);
  const railLand = recordingContext({ center: to });
  assert.equal(styles.land(railLand, "prism", to, 6, [241, 220, 174], 0.3, { kind: "dot", time: 0, still: false, rTo: 6, detail: 2, rail: true }), true);
  assert.deepEqual([railLand.calls.arc, railLand.calls.stroke], [1, 1], "the rail lands as a single ring");
  assert.equal(styles.land(recordingContext(), "prism", to, 12, [241, 220, 174], 1, { kind: "dot", time: 0, still: true, rTo: 12, detail: 3 }), false, "no landing under reduced motion");
  // A landing takes the pulse's colour the way its surge does, one stable
  // triple per colour: idle hands over pulse._rgb, a fresh array for every
  // pulse, which would rebuild the tones on every landing. It is never read.
  let reads = 0;
  const fresh = () => new Proxy([241, 220, 174], { get(target, key) { reads += 1; return Reflect.get(target, key); } });
  const landings = [0, 1].map(() => {
    const own = { ...pulse, _rgb: fresh() }, ctx = recordingContext({ center: to });
    assert.equal(styles.land(ctx, "prism", to, 12, own._rgb, 0.4, { kind: "dot", time: 0, still: false, rTo: 12, detail: 3, pulse: own, motion: null }), true);
    return plain(ctx.calls.log);
  });
  assert.equal(reads, 0, "the fresh per-pulse array is never read");
  assert.deepEqual(landings[1], landings[0]);
  const landed = new Set(landings[0].filter(([name]) => name === "set:strokeStyle").map(([, style]) => style));
  assert.ok([...new Set(late.ctx.calls.fills.map(({ style }) => style))].filter((style) => landed.has(style)).length >= 3, "the landing's arcs are the surge's spectrum");
});
