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
    0: { quiet: 9, working: 9, arc: 1, fill: 3, stroke: 1 },
    1: { quiet: 22, working: 28, arc: 1, fill: 12, stroke: 3 },
    2: { quiet: 30, working: 40, arc: 1, fill: 17, stroke: 5 },
    3: { quiet: 42, working: 57, arc: 1, fill: 18, stroke: 6 },
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
    for (const { style, alpha } of ctx.calls.fills) if (style === "rgba(54,209,255,1)" && alpha < 1) fire.add(Math.round(alpha * 10));
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
  let widest = 0;
  for (const t01 of [0.05, 0.25, 0.5, 0.75, 0.95]) {
    const ctx = recordingContext({ center: P });
    assert.equal(styles.arrival(ctx, "prism", P, 12, TINT, t01, { kind: "task", alpha: 0.9, time: 0, still: false, detail: 3, motion: record, theme }), true);
    assert.ok(ctx.calls.fill >= 4 && ctx.calls.alphas.every((alpha) => alpha <= 0.9 + 1e-12));
    widest = Math.max(widest, ctx.calls.reach / 12);
    assert.equal(ctx.calls.saves, ctx.calls.restores);
  }
  assert.ok(widest > 1.8 && widest <= 2.25, `the burst reaches out, inside 2.25 radii (${widest.toFixed(2)})`);
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
  assert.ok(styles.reach("prism", null) >= 1 && styles.reach("prism", record) <= 1.8 && styles.reach("prism", record) > 1.4, "label clearance widens for the shards");
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
  const railLand = recordingContext({ center: to });
  assert.equal(styles.land(railLand, "prism", to, 6, [241, 220, 174], 0.3, { kind: "dot", time: 0, still: false, rTo: 6, detail: 2, rail: true }), true);
  assert.deepEqual([railLand.calls.arc, railLand.calls.stroke], [1, 1], "the rail lands as a single ring");
  assert.equal(styles.land(recordingContext(), "prism", to, 12, [241, 220, 174], 1, { kind: "dot", time: 0, still: true, rTo: 12, detail: 3 }), false, "no landing under reduced motion");
});
