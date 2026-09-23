// The five free node styles in renderer/node-styles.js (Classic orbs, Soft
// glass, Minimal, Halo, Crystal): theme-aware bodies built from cached paints,
// every node animating from its own clock (idle calm, working 2.6 times as
// fast and brighter), a designed still pose under reduced motion, detail that
// follows the caller's tier, and a readable glyph ink on every body.
import test from "node:test";
import assert from "node:assert/strict";
import { NODE_STYLES_SOURCE as source, loadNodeStyles, recordingContext, gradientsBuilt, plain } from "./fixtures/node-styles-harness.mjs";

const FREE = ["orbs", "glass", "minimal", "halo", "crystal"];
const P = { x: 50, y: 50 }, TINT = [220, 180, 110];
const LIGHT = { background: "#f3f0e8", text: "#1d2330" };
const lines = source.replace(/\r\n/g, "\n").split("\n");
function sectionOf(name) {
  const start = lines.indexOf(`// ===== ${name} =====`);
  assert.ok(start >= 0, `missing the ${name} banner`);
  let end = start + 1;
  while (end < lines.length && !/^\/\/ ===== .+ =====$/.test(lines[end])) end += 1;
  return lines.slice(start + 1, end).join("\n");
}
const code = (text) => text.replace(/^\s*\/\/.*$/gm, "");
const luma = (rgba) => { const [r, g, b] = rgba.match(/[\d.]+/g).map(Number); return r * 0.2126 + g * 0.7152 + b * 0.0722; };
// The module's own channel blend (rounded), for expected tones.
const mix = (from, toward, amount) => from.map((value, index) => Math.round(value + (toward[index] - value) * amount));
const WHITE = [255, 255, 255], DARK_BG = [5, 5, 7], LIGHT_BG = [243, 240, 232];

// A motion record with its levels landed on the flags, at a given clock.
function motion(styles, { id = "task:a", style = "orbs", active = false, selected = false, clock = 0, still = false } = {}) {
  const m = styles.motionRecord(new Map(), id);
  styles.stepMotion(m, { style, active, selected, progress: null, orbit: 0, status: null, time: 0, frame: 1 }, 0, still);
  m.clock = clock;
  return m;
}
// The clock at which cycle(m, period) reads `phase` (the seed offsets it).
const clockAt = (m, period, phase) => (((phase * period - m.seed * 97) % period) + period) % period;
function frame(styles, style, { radius = 12, p = P, tint = TINT, ctx = recordingContext({ center: p }), ...o } = {}) {
  styles.paint(ctx, style, p, radius, tint, { kind: "task", ...o });
  return ctx;
}
const logOf = (ctx) => JSON.stringify(plain(ctx.calls.log));

test("the free looks are cached and allocation-free, never blur, and carry no hard-coded chrome", () => {
  for (const style of FREE) {
    const text = code(sectionOf(`style: ${style}`));
    for (const banned of ["shadowBlur", "filter", "Array.from(", ".filter(", ".map(", ".forEach(", "#151a22", "#172331", "rgba(10,17,28", "rgba(12,19,31", "#eef3fa", "rgba(242,249,255", "#edf0f5", "rgba(231,243,255", "rgba(31,43,59"]) {
      assert.ok(!text.includes(banned), `${style}: no ${banned}`);
    }
    // Every gradient a look builds is made on a cache miss (its function reads
    // cacheGet first) or fills an empty slot of a cached record once.
    for (const match of text.matchAll(/create(Radial|Linear|Conic)Gradient/g)) {
      const before = text.slice(0, match.index), owner = before.slice(before.lastIndexOf("function "));
      const lastLines = before.split("\n").slice(-2).join("\n");
      assert.ok(owner.includes("cacheGet(") || /if \(!paints\.\w+\) \{\s*\n\s*paints\.\w+ = ctx\.$/.test(lastLines), `${style}: gradients are built on a cache miss, not per frame`);
    }
  }
});

test("steady frames build nothing: every state, size and place reuses one cached entry per tint", () => {
  for (const style of FREE) {
    const styles = loadNodeStyles();
    const ctx = recordingContext();
    const m = motion(styles, { style });
    const states = [{}, { selected: true }, { active: true }, { active: true, selected: true }, { kind: "agent", active: true }, { kind: "assistant" }];
    const pass = () => {
      for (let index = 0; index < 30; index += 1) {
        const state = states[index % states.length];
        styles.stepMotion(m, { style, active: state.active === true, selected: state.selected === true, progress: null, orbit: 0, status: null, time: index * 33, frame: index }, 1 / 30, false);
        styles.paint(ctx, style, { x: 20 + index * 3.1, y: 40 + index * 0.7 }, 3 + (index * 1.37) % 13, TINT, { kind: "task", ...state, motion: m, alpha: 0.4 + (index % 5) * 0.12 });
      }
    };
    pass();
    const warm = gradientsBuilt(ctx);
    pass(); pass();
    assert.equal(gradientsBuilt(ctx), warm, `${style}: no gradient after the first pass through every state`);
    assert.equal(styles.cacheStats(ctx).entries, style === "minimal" ? 0 : 1, `${style}: one cache entry per tint and theme`);
    // Another theme builds its own paints once, then nothing.
    const light = styles.theme(LIGHT);
    styles.paint(ctx, style, P, 12, TINT, { active: true, theme: light });
    const again = gradientsBuilt(ctx);
    styles.paint(ctx, style, P, 9, TINT, { active: true, theme: light, motion: m });
    assert.equal(gradientsBuilt(ctx), again, `${style}: a theme's paints are reused too`);
    assert.equal(ctx.calls.saves, ctx.calls.restores);
  }
});

test("every free look animates at rest and while working, from the node's own clock and seed", () => {
  const styles = loadNodeStyles();
  for (const style of FREE) {
    for (const active of [false, true]) {
      const logs = [0, 0.4, 1.3].map((clock) => logOf(frame(styles, style, { active, motion: motion(styles, { style, active, clock }) })));
      assert.notEqual(logs[0], logs[1], `${style}${active ? " working" : " at rest"} moves within 0.4 s`);
      assert.notEqual(logs[1], logs[2], `${style}${active ? " working" : " at rest"} keeps moving`);
    }
    const one = logOf(frame(styles, style, { motion: motion(styles, { style, id: "task:one", clock: 3 }) }));
    const two = logOf(frame(styles, style, { motion: motion(styles, { style, id: "task:two", clock: 3 }) }));
    assert.notEqual(one, two, `${style}: two nodes at the same moment sit at their own phases (no lockstep)`);
  }
});

test("reduced motion freezes every free look to one designed pose, the one a bare paint gets", () => {
  const styles = loadNodeStyles();
  for (const style of FREE) {
    for (const options of [{}, { active: true }, { selected: true }, { kind: "agent", active: true }, { kind: "assistant" }]) {
      const logs = [0, 1234, 99999].map((clock) => logOf(frame(styles, style, { ...options, motion: motion(styles, { style, active: options.active, selected: options.selected, clock, still: true }) })));
      assert.equal(logs[0], logs[1], `${style} ${JSON.stringify(options)}: still at t 0 and 1234`);
      assert.equal(logs[0], logs[2], `${style} ${JSON.stringify(options)}: still at t 99999`);
      assert.equal(logs[0], logOf(frame(styles, style, options)), `${style}: the still pose is the bare pose`);
    }
  }
});

test("the body sits at the caller's alpha and every layer is a gain on it, mid-ease too", () => {
  const styles = loadNodeStyles();
  for (const style of FREE) {
    for (const kind of ["task", "agent", "assistant"]) {
      const eased = () => { const m = motion(styles, { style, clock: 2.2 }); Object.assign(m, { lit: 0.5, sel: 0.3, work: 0.4, tempo: 1.64 }); return m; };
      const full = frame(styles, style, { kind, alpha: 1, motion: eased() }), dimmed = frame(styles, style, { kind, alpha: 0.37, motion: eased() });
      const a1 = full.calls.alphas, a2 = dimmed.calls.alphas;
      assert.ok(a2.length > 0 && a2.length === a1.length, `${style} ${kind}: the same operations dimmed`);
      assert.ok(a2.every((alpha, index) => alpha > 0 && alpha <= 0.37 + 1e-12 && Math.abs(alpha - 0.37 * a1[index]) < 1e-12), `${style} ${kind}: every layer scales with the caller's alpha`);
      assert.ok(a2.includes(0.37), `${style} ${kind}: the body at exactly the caller's alpha`);
    }
  }
});

test("small nodes stay cheap: at r 4 every free look is at most four draw calls", () => {
  const styles = loadNodeStyles();
  for (const style of FREE) {
    for (const options of [{}, { active: true }, { selected: true }, { active: true, selected: true }]) {
      const { calls } = frame(styles, style, { radius: 4, ...options, motion: motion(styles, { style, active: options.active, selected: options.selected, clock: 0.7 }) });
      assert.ok(calls.fill + calls.stroke <= 4, `${style} ${JSON.stringify(options)} at r 4: ${calls.fill} fills, ${calls.stroke} strokes`);
    }
  }
});

test("detail follows the caller's tier: the extras need T1 (crystal's cut lines T3) and fade in over the tier's first 1.2 px", () => {
  const styles = loadNodeStyles();
  const at = (style, detail, radius = 12) => frame(styles, style, { radius, active: true, detail, motion: motion(styles, { style, active: true, clock: 0.9 }) }).calls;
  assert.deepEqual([at("orbs", 0).stroke, at("orbs", 1).stroke], [1, 2], "orbs: the glint needs T1");
  assert.deepEqual([at("glass", 0).stroke, at("glass", 1).stroke, at("glass", 2).stroke], [2, 2, 4], "glass: the rim and light catch at every size; the frost ring and caustic need T2");
  const parked = (detail) => frame(styles, "glass", { detail, motion: motion(styles, { style: "glass", still: true }) }).calls;
  assert.deepEqual([parked(0).fill, parked(1).fill], [2, 3], "glass: the sheen needs T1");
  assert.deepEqual([at("halo", 0).setLineDash, at("halo", 1).setLineDash, at("halo", 2).setLineDash], [0, 0, 1], "halo: the dashed ring turns from T2 (solid below)");
  assert.deepEqual([at("halo", 0).stroke, at("halo", 1).stroke], [3, 5], "halo: the comet needs T1 (a lit node keeps its glow band and inner ring at T0)");
  const radialFills = (calls) => calls.fills.filter(({ style }) => typeof style !== "string").length;
  assert.deepEqual([radialFills(at("halo", 2)), at("halo", 2).stroke, radialFills(at("halo", 3)), at("halo", 3).stroke], [0, 5, 1, 4], "halo: the glow is a stroked band up to T2, the cached radial from T3");
  // Crystal (working, so lit: the glow is one fill at every tier): a plain gem
  // below T1; the shadow facets and the table at T1; the flash at T2; the
  // cut's lines at T3.
  assert.deepEqual([at("crystal", 0).fill, at("crystal", 1).fill], [2, 4], "crystal: the shadow facets and table need T1");
  assert.ok(at("crystal", 2).fill > at("crystal", 1).fill, "crystal: the flash needs T2");
  assert.deepEqual([at("crystal", 2).stroke - at("crystal", 1).stroke, at("crystal", 3).stroke - at("crystal", 2).stroke], [0, 1], "crystal: the cut's lines need T3");
  // A tier's extras fade in: the orb's glint at r 6.6 shows at half its r 8 strength.
  const glint = (radius) => at("orbs", 3, radius).strokes[1].alpha;
  assert.ok(Math.abs(glint(6.6) - glint(8) * 0.5) < 1e-9, "the glint fades in over T1's first 1.2 px");
});

test("Classic orbs: a theme-derived core, a baked specular, a halo ring outside the body and a glint clear of its middle", () => {
  const styles = loadNodeStyles();
  const fills = (ctx) => ctx.calls.fills.map(({ style }) => typeof style === "string" ? style : "gradient");
  assert.ok(fills(frame(styles, "orbs")).includes("rgba(39,33,23,1)"), "the core sinks the tint toward the dark background");
  assert.ok(fills(frame(styles, "orbs", { theme: styles.theme(LIGHT) })).includes(`rgba(${mix(TINT, LIGHT_BG, 0.84).join(",")},1)`), "and toward a light one");
  const ctx = frame(styles, "orbs", { active: true });
  const [halo, body] = ctx.calls.gradients;
  assert.deepEqual(plain(body.stops.map(([offset]) => offset)), [0, 0.1, 0.28, 0.62, 1], "the body is one five-stop radial");
  assert.equal(body.stops[0][1], `rgba(${mix(TINT, WHITE, 0.8).join(",")},0.96)`, "the specular is baked in (whitened tint), no flat white dot");
  assert.equal(halo.stops.at(-1)[1], "rgba(220,180,110,0)");
  // The halo is one disc (the fast circle fill) whose paint is clear inside
  // half its reach: at the smallest reach (1.38 r) that is .69 r, so a
  // translucent body never shows it breathing through its middle.
  assert.deepEqual(plain(halo.args), [0, 0, 0.5, 0, 0, 1]);
  assert.equal(halo.stops[0][1], "rgba(220,180,110,0)", "clear at its inner radius");
  assert.ok(!ctx.calls.log.some(([name, , , , , , back]) => name === "arc" && back === true), "no ring path (no anticlockwise inner arc)");
  // Inside .65 r nothing changes over time: the same core and body paints at the
  // caller's alpha, turned only about the centre (the halo between them is
  // clear inside .67 r); the glint stays past .79 r.
  const inside = (clock, active) => {
    const recorded = frame(styles, "orbs", { active, radius: 15, motion: motion(styles, { active, clock }) });
    const glint = recorded.calls.log.filter(([name, , , radius]) => name === "arc" && Math.abs(radius - 15 * 0.84) < 1e-6);
    assert.equal(glint.length, 1, "one glint streak on .84 r");
    assert.ok(recorded.calls.strokes[1].width <= 15 * 0.09 + 1e-9, "a streak no wider than .09 r: its inner edge stays past .79 r");
    const [core, , body] = recorded.calls.fills;
    return JSON.stringify([core, body]);
  };
  for (const active of [false, true]) {
    const reference = inside(0, active);
    for (const clock of [0.5, 1.7, 3.3, 6.1]) assert.equal(inside(clock, active), reference, "the body's paints and alpha hold still over time");
  }
  // The halo breathes and grows when lit, never past 1.8 r.
  let widest = 0;
  for (let clock = 0; clock < 5; clock += 0.1) widest = Math.max(widest, frame(styles, "orbs", { selected: true, active: true, motion: motion(styles, { active: true, selected: true, clock }) }).calls.reach);
  assert.ok(widest > 12 * 1.75 && widest <= 12 * 1.8 + 1e-9, `the lit halo reaches ${(widest / 12).toFixed(3)} r`);
  assert.ok(frame(styles, "orbs").calls.reach <= 12 * 1.5 + 1e-9, "a quiet halo stays close");
});

test("Classic orbs: the glint is soft at rest, twice as bright while working, and glides under 2 px a frame at r 15", () => {
  const styles = loadNodeStyles();
  const glintAlpha = (active) => frame(styles, "orbs", { active, motion: motion(styles, { active, clock: 1 }) }).calls.strokes[1].alpha;
  assert.ok(Math.abs(glintAlpha(true) - 2 * glintAlpha(false)) < 1e-9 && glintAlpha(false) > 0.3, "working doubles a glint that already shows at rest");
  const m = motion(styles, { active: true });
  let last = null, largest = 0;
  for (let index = 0; index < 60; index += 1) {
    styles.stepMotion(m, { style: "orbs", active: true, selected: false, progress: null, orbit: 0, status: null, time: index * 33, frame: index }, 1 / 30, false);
    const arc = frame(styles, "orbs", { radius: 15, active: true, motion: m }).calls.log.find(([name, , , radius]) => name === "arc" && Math.abs(radius - 12.6) < 1e-6);
    if (last !== null) largest = Math.max(largest, Math.abs(Math.atan2(Math.sin(arc[4] - last), Math.cos(arc[4] - last))) * 12.6);
    last = arc[4];
  }
  assert.ok(largest > 0.5 && largest <= 2, `the glint moves ${largest.toFixed(2)} px a frame`);
});

test("Soft glass: a tint-derived pane, a cached wash, and a feathered sheen that sweeps from the light", () => {
  const styles = loadNodeStyles();
  const ctx = frame(styles, "glass");
  assert.equal(ctx.calls.fills[0].style, `rgba(${mix(TINT, DARK_BG, 0.78).join(",")},0.92)`, "the pane sinks the tint toward the background");
  assert.equal(frame(styles, "glass", { theme: styles.theme(LIGHT) }).calls.fills[0].style, `rgba(${mix(TINT, LIGHT_BG, 0.32).join(",")},0.92)`, "and toward a light one, keeping most of the hue");
  const alphasOf = (gradient) => plain(gradient.stops.map(([, colour]) => Number(colour.match(/[\d.]+\)$/)[0].slice(0, -1))));
  const [, sheen] = ctx.calls.gradients;
  assert.deepEqual(alphasOf(sheen), [0, 0.16, 0.42, 0.16, 0], "the sheen is feathered, brightest in its middle");
  assert.deepEqual(alphasOf(frame(styles, "glass", { theme: styles.theme(LIGHT) }).calls.gradients[1]), [0, 0.28, 0.7, 0.28, 0], "brighter on a light page");
  // Idle: the sheen sweeps across the first 80% of each 6.8 s pass, from the
  // upper left: the band moves along its sweep (the translate between the
  // pane's way in and out of its unit space).
  const m = motion(styles);
  const along = (recorded) => {
    const moves = recorded.calls.log.filter(([name]) => name === "translate");
    return moves.length === 4 ? moves[1][1] / Math.cos(0.72) : null;
  };
  const shift = (phase) => {
    m.clock = clockAt(m, 6.8, phase);
    return along(frame(styles, "glass", { motion: m }));
  };
  const positions = [0.05, 0.25, 0.45, 0.75].map(shift);
  assert.ok(positions.every((value, index) => value !== null && (index === 0 || value > positions[index - 1])), `the band travels one way (${positions.map((value) => value?.toFixed(2)).join(", ")})`);
  assert.ok(positions[0] < -0.8 && positions[3] > 0.8, "across the whole pane");
  assert.equal(shift(0.9), null, "then the pane rests until the next pass");
  // Reduced motion parks the sheen near the light.
  assert.ok(Math.abs(along(frame(styles, "glass", { motion: motion(styles, { still: true }) })) + 0.5) < 1e-5, "reduced motion parks the band by the light");
  // The wash swells with the breath, and a working rim pulses on top of it.
  const layer = (clock, active, pick) => pick(frame(styles, "glass", { active, motion: motion(styles, { style: "glass", active, clock }) }).calls);
  const washes = [0, 1.05, 2.1, 3.15].map((clock) => layer(clock, false, (calls) => calls.fills[1].alpha));
  assert.ok(Math.max(...washes) / Math.min(...washes) > 1.2, `the wash swells (${washes.map((value) => value.toFixed(3)).join(", ")})`);
  const rimSpread = (active) => {
    const alphas = [0, 0.35, 0.7, 1.05, 1.4, 1.75, 2.1, 2.45, 2.8, 3.15, 3.5, 3.85].map((clock) => layer(clock, active, (calls) => Number(calls.strokes[0].style.match(/,([\d.]+)\)$/)[1])));
    return Math.max(...alphas) - Math.min(...alphas);
  };
  assert.ok(rimSpread(false) >= 0.05 && rimSpread(true) > 1.5 * rimSpread(false), `the rim breathes at rest (${rimSpread(false)}) and pulses harder while working (${rimSpread(true)})`);
});

test("Minimal: a breathing dot, a sonar ring while working, a text-coloured selection ring; agents keep a backing disc", () => {
  const styles = loadNodeStyles();
  const radii = (ctx) => ctx.calls.log.filter(([name]) => name === "arc").map(([, , , radius]) => radius);
  const dots = [0, 0.9, 1.8].map((clock) => radii(frame(styles, "minimal", { motion: motion(styles, { style: "minimal", clock }) }))[0]);
  assert.ok(new Set(dots).size === 3 && Math.max(...dots) - Math.min(...dots) > 0.6, `the dot breathes (${dots.map((dot) => dot.toFixed(2)).join(", ")})`);
  assert.equal(frame(styles, "minimal").calls.stroke, 0, "a quiet dot draws one fill");
  // Working: a sonar ring goes out from the dot to 1.25 r, fading as it goes.
  const m = motion(styles, { style: "minimal", active: true });
  const sonar = [0.3, 0.6, 0.9].map((phase) => {
    m.clock = clockAt(m, 4.2, phase);
    const recorded = frame(styles, "minimal", { active: true, motion: m });
    return { radius: radii(recorded)[1], alpha: recorded.calls.strokes[0].alpha };
  });
  assert.ok(sonar[0].radius < sonar[1].radius && sonar[1].radius < sonar[2].radius && sonar[2].radius <= 12 * 1.25, "the ring grows");
  assert.ok(sonar[0].alpha > sonar[1].alpha && sonar[1].alpha > sonar[2].alpha, "and fades");
  assert.equal(frame(styles, "minimal", { selected: true }).calls.strokes[0].style, "rgba(236,229,216,0.9)", "selection rings in the theme's text colour");
  assert.equal(frame(styles, "minimal", { selected: true, theme: styles.theme(LIGHT) }).calls.strokes[0].style, "rgba(29,35,48,0.9)");
  // An agent: a backing disc for its glyph (written by the caller in the tint), no dot.
  const agent = frame(styles, "minimal", { kind: "agent", active: true });
  assert.deepEqual([radii(agent)[0], agent.calls.fills[0].style], [12 * 0.78, "rgba(220,180,110,0.375)"]);
  const hub = frame(styles, "minimal", { kind: "assistant", radius: 15 });
  assert.deepEqual([radii(hub)[0], hub.calls.fillText], [15 * 0.62, 0], "the hub: a larger dot, no monogram");
  assert.deepEqual(plain(styles.glyph("minimal", TINT, null)), { ink: "rgba(220,180,110,1)", scale: 0.62, ringGap: 2 });
});

test("Halo: a cached ring glow instead of shadowBlur, a turning dashed ring, a pulsing core and a comet while working", () => {
  const styles = loadNodeStyles();
  const ctx = recordingContext();
  for (const options of [{}, { active: true }, { selected: true }]) frame(styles, "halo", { ctx, ...options, motion: motion(styles, { style: "halo", active: options.active, selected: options.selected, clock: 2 }) });
  assert.deepEqual(ctx.calls.shadowBlurs, [], "no shadowBlur, ever");
  assert.equal(ctx.calls.radial, 1, "one cached ring glow per tint");
  assert.deepEqual(plain(ctx.calls.gradients[0].stops.map(([offset]) => offset)), [0, 0.3, 0.45, 0.62, 1], "peaking on the ring");
  const dashes = ctx.calls.log.filter(([name]) => name === "setLineDash");
  assert.ok(dashes.length === 3 && dashes.every(([, ...values]) => values.length === 2 && Math.abs(values[0] - Math.PI * 2 * 7.2 / 16) < 1e-6), "eight dashes on .6 r, one setLineDash a paint");
  assert.deepEqual(plain(ctx.getLineDash()), [], "paint()'s restore clears the dash (nothing is stroked after it)");
  const offset = (clock) => frame(styles, "halo", { motion: motion(styles, { style: "halo", clock }) }).calls.log.find(([name]) => name === "set:lineDashOffset")[1];
  assert.notEqual(offset(0), offset(1), "the dashed ring turns");
  const core = (clock) => frame(styles, "halo", { active: true, motion: motion(styles, { style: "halo", active: true, clock }) }).calls.log.find(([name, x, , radius]) => name === "arc" && x === 50 && radius < 12 * 0.4)[3];
  assert.notEqual(core(0), core(0.5), "the core pulses");
  assert.equal(frame(styles, "halo", { active: true }).calls.stroke - frame(styles, "halo").calls.stroke, 2, "working adds the comet's head and tail");
  assert.equal(frame(styles, "halo", { kind: "agent", active: true }).calls.fill, 2, "a glyph takes the core dot's place");
});

test("Crystal: an octagonal brilliant turning under a fixed light, flashing the facet that faces it", () => {
  const styles = loadNodeStyles();
  const outline = (ctx) => {
    const at = ctx.calls.log.findIndex(([name]) => name === "set:strokeStyle");
    const moves = ctx.calls.log.slice(0, at).filter(([name]) => name === "moveTo" || name === "lineTo");
    return moves.slice(-8);
  };
  const still = frame(styles, "crystal");
  const rim = outline(still);
  assert.equal(still.calls.arc, 0, "no arcs anywhere: an octagon cut from lines");
  // The cut is traced in the gem's unit space (the canvas at its centre, scaled by its radius).
  assert.ok(Math.abs(rim[0][1] - Math.cos(Math.PI / 8)) < 1e-6 && Math.abs(rim[0][2] - 0.965 * Math.sin(Math.PI / 8)) < 1e-6, "flat on top at rest (the tilt at its middle)");
  // The cut turns (40 s a turn at rest, 2.6 times as fast working) while the light gradient stays put.
  const turned = frame(styles, "crystal", { motion: motion(styles, { style: "crystal", clock: 5 }) });
  assert.notDeepEqual(plain(outline(turned)[0]), plain(rim[0]), "the gem turns");
  assert.equal(turned.calls.rotate, 0, "by its own geometry: the light gradient never turns with it");
  // The facet facing the light flashes alone; halfway between two facets, they share it.
  const m = motion(styles, { style: "crystal" });
  const flashes = (spin) => {
    m.clock = clockAt(m, 40, spin / (Math.PI * 2));
    return frame(styles, "crystal", { motion: m, detail: 2 }).calls.fills.filter(({ style }) => style === `rgba(${mix(TINT, WHITE, 0.78).join(",")},0.92)`).length;
  };
  assert.equal(flashes(0), 1, "a facet square to the light");
  assert.equal(flashes(Math.PI / 8), 2, "two facets sharing it");
  // A lit gem glows inside an octagon. The glow is built with the gem's other
  // paints on the cache miss (so cacheStats counts it), and a quiet gem never
  // draws it.
  const quiet = frame(styles, "crystal");
  assert.ok(quiet.calls.radial === 1 && quiet.calls.linear === 1 && quiet.calls.reach <= 12 * 1.2, "a quiet gem: its paints built once, no glow drawn");
  const lit = frame(styles, "crystal", { active: true });
  assert.ok(lit.calls.radial === 1 && lit.calls.reach > 12 * 1.5 && lit.calls.reach <= 12 * 1.56, "the lit halo: inside 1.55 r");
  // The sparkle where the light strikes: 14% of each 3.4 s pass (1.3 s working).
  const sparkle = (phase) => { m.clock = clockAt(m, 3.4, phase); return frame(styles, "crystal", { motion: m }).calls.fill; };
  assert.equal(sparkle(0.07) - sparkle(0.5), 1, "twinkles, then rests");
  // Below T1 a plain gem: one lit gradient and the rim; a glyph node keeps
  // its deep well at every size (its light ink would sink into the gem).
  const small = frame(styles, "crystal", { radius: 5 });
  assert.deepEqual([small.calls.fill, small.calls.stroke], [1, 1]);
  for (const [radius, detail] of [[5, 3], [6, 3], [12, 0]]) {
    const agent = frame(styles, "crystal", { kind: "agent", active: true, radius, detail });
    assert.equal(agent.calls.fills.filter(({ style }) => style === "rgba(35,30,21,0.92)").length, 1, `crystal agent at r ${radius}, T${detail}: one deep well`);
  }
  // A light theme lifts the gem (no heavy blob on the page).
  const [dark] = frame(styles, "crystal").calls.gradients, [pale] = frame(styles, "crystal", { theme: styles.theme(LIGHT) }).calls.gradients;
  assert.ok(luma(pale.stops[1][1]) > luma(dark.stops[1][1]), "the mid tone is lighter on a light theme");
});

test("glyph dress: each free look writes its glyph and monogram in an ink that reads on its own body", () => {
  const styles = loadNodeStyles();
  const dark = styles.theme(null), light = styles.theme(LIGHT);
  // Orbs: the role glyph stands off the body's centre (the tint at about .76
  // over the theme-derived core), on the dark and the light theme alike.
  for (const theme of [dark, light]) {
    for (const tint of [[125, 178, 255], [120, 60, 200], [150, 150, 160]]) {
      const centre = luma(`rgb(${mix(mix(tint, theme.bg, 0.84), tint, 0.76).join(",")})`);
      const ink = styles.glyph("orbs", tint, theme).ink;
      assert.ok(Math.abs(luma(ink) - centre) >= 90, `orbs ${theme.light ? "light" : "dark"} [${tint}]: ink ${ink} on a centre of luma ${centre.toFixed(1)}`);
    }
  }
  // Minimal writes in its edge tone: the tint, deepened on a light page.
  assert.equal(styles.glyph("minimal", TINT, light).ink, `rgba(${mix(TINT, [12, 14, 20], 0.6).join(",")},1)`);
  assert.ok(Math.abs(luma(styles.glyph("minimal", [125, 178, 255], light).ink) - luma("rgb(243,240,232)")) >= 90, "minimal: a light-blue glyph still reads on cream");
  for (const [style, scale, gap] of [["glass", 0.66, 3.5], ["halo", 0.6, 3.5], ["crystal", 0.56, 3.5]]) {
    // These bodies sink toward the background: the ink rises toward the theme's highlight.
    assert.deepEqual([styles.glyph(style, TINT, dark).scale, styles.glyph(style, TINT, dark).ringGap], [scale, gap]);
    assert.ok(luma(styles.glyph(style, TINT, dark).ink) > 170, `${style}: a light ink on a dark theme`);
    assert.ok(luma(styles.glyph(style, TINT, light).ink) < 110, `${style}: a dark ink on a light theme`);
  }
  // The hub's monogram, written by the look itself.
  const monogram = (style, theme, tint = [150, 140, 230]) => frame(styles, style, { kind: "assistant", radius: 15, tint, theme }).calls.texts[0];
  for (const style of ["orbs", "glass", "halo", "crystal"]) {
    assert.equal(monogram(style, dark)?.text, "M", `${style} writes the hub's M`);
    assert.ok(luma(monogram(style, dark).ink) > 170, `${style}: the M reads light on a dark theme (${monogram(style, dark).ink})`);
  }
  assert.ok(luma(monogram("orbs", light, [176, 122, 42]).ink) < 90, "orbs: a dark M on a light theme's pale body");
  assert.equal(frame(styles, "crystal", { kind: "agent", active: true }).calls.fills.filter(({ style }) => style === "rgba(35,30,21,0.92)").length, 1, "crystal: a glyph sits on a deep table");
  for (const style of FREE) assert.equal(styles.reach(style, null), 1, `${style} keeps labels at its radius`);
});

test("on a light page bright tints keep a deepened edge; dark themes keep the tint itself", () => {
  const styles = loadNodeStyles();
  const light = styles.theme(LIGHT), page = luma("rgb(243,240,232)");
  // The edge each look draws (the orb, glass and halo rims: first stroke; the
  // minimal dot: first fill), at rest in the still pose: its colour, and how
  // far it lands from the page at the alpha it is painted with (string alpha
  // times the canvas's).
  const edge = (style, tint, theme) => {
    const { calls } = frame(styles, style, { tint, theme });
    const { style: colour, alpha } = style === "minimal" ? calls.fills[0] : calls.strokes[0];
    return { colour, painted: alpha * Number(colour.match(/,([\d.]+)\)$/)[1]) };
  };
  for (const tint of [[104, 236, 164], [255, 212, 121]]) {
    for (const style of ["orbs", "glass", "halo", "minimal"]) {
      const { colour, painted } = edge(style, tint, light);
      const standing = painted * Math.abs(luma(colour) - page);
      assert.ok(standing >= 90, `${style} [${tint}] on the light page: ${colour} stands ${standing.toFixed(1)} luma off the page`);
      assert.ok(edge(style, tint, null).colour.startsWith(`rgba(${tint.join(",")},`), `${style} [${tint}] on a dark theme keeps the tint`);
    }
  }
  // The orb's body deepens toward its edge on a light page too; a dark theme keeps the tint's faint edge.
  const body = (theme) => frame(styles, "orbs", { tint: [104, 236, 164], theme }).calls.gradients[1].stops.slice(3).map(([, colour]) => colour);
  const deepened = mix([104, 236, 164], [12, 14, 20], 0.6).join(",");
  assert.deepEqual(plain(body(light)), [`rgba(${deepened},0.5)`, `rgba(${deepened},0.35)`]);
  assert.deepEqual(plain(body(null)), ["rgba(104,236,164,0.42)", "rgba(104,236,164,0.1)"]);
  // The halo's working comet stands off its ring: a whiter head on a dark
  // theme, a darker one than the deepened ring on a light page.
  const halo = (theme) => frame(styles, "halo", { tint: [104, 236, 164], active: true, theme }).calls.strokes;
  const [ringDark, cometDark] = halo(null), [ringLight, cometLight] = halo(light);
  assert.ok(luma(cometDark.style) > 230 && luma(cometDark.style) - luma(ringDark.style) > 40, `dark: comet ${cometDark.style} on ring ${ringDark.style}`);
  assert.ok(luma(cometLight.style) < 115 && luma(ringLight.style) - luma(cometLight.style) > 20, `light: comet ${cometLight.style} on ring ${ringLight.style}`);
});

test("small nodes keep breathing: at r 5 on T0 every free look still moves", () => {
  const styles = loadNodeStyles();
  for (const style of FREE) {
    for (const active of [false, true]) {
      const [a, b] = [0, 1.2].map((clock) => logOf(frame(styles, style, { radius: 5, detail: 0, active, motion: motion(styles, { style, active, clock }) })));
      assert.notEqual(a, b, `${style}${active ? " working" : " at rest"} at r 5, T0`);
    }
  }
});

test("the breath is deep enough to see on a todo-sized node: rims swing by a third or more at r 4 on T0", () => {
  const styles = loadNodeStyles();
  // Over one 4.2 s breath at rest, the first stroke (the orb and glass rims,
  // halo's ring) at the alpha it is painted with: string alpha times the
  // canvas's.
  for (const style of ["orbs", "glass", "halo", "crystal"]) {
    const m = motion(styles, { style });
    const painted = [];
    for (let step = 0; step < 24; step += 1) {
      m.clock = clockAt(m, 4.2, step / 24);
      const { style: colour, alpha } = frame(styles, style, { radius: 4, detail: 0, alpha: 0.65, motion: m }).calls.strokes[0];
      painted.push(alpha * Number(colour.match(/,([\d.]+)\)$/)[1]));
    }
    const swing = Math.max(...painted) / Math.min(...painted);
    assert.ok(swing >= 1.35, `${style}: the rim's alpha swings ${swing.toFixed(2)}x over a breath`);
  }
  // Halo's core dot pulses in brightness even at its 1.5 px floor.
  const m = motion(styles, { style: "halo" });
  const dots = [0.25, 0.75].map((phase) => { m.clock = clockAt(m, 3.1, phase); return frame(styles, "halo", { radius: 4, detail: 0, motion: m }).calls.fills.at(-1).style; });
  assert.deepEqual(plain(dots.map((colour) => Number(colour.match(/,([\d.]+)\)$/)[1]))), [0.9375, 0.5625], "the core dot beats from .55 to .95");
  // The orb's halo swells with the same breath: its gain doubles from the
  // breath's low to its high, and its reach grows.
  const orb = motion(styles);
  const halo = [0.75, 0.25].map((phase) => { orb.clock = clockAt(orb, 4.2, phase); const { calls } = frame(styles, "orbs", { radius: 4, detail: 0, motion: orb }); return { gain: calls.fills[1].alpha, reach: calls.reach }; });
  assert.ok(Math.abs(halo[1].gain / halo[0].gain - 2) < 1e-9 && halo[1].reach > halo[0].reach, `the orb's halo swells (${JSON.stringify(halo)})`);
  // On a light page Soft glass's sheen crosses the pane at more than half strength.
  const glass = motion(styles, { style: "glass" });
  glass.clock = clockAt(glass, 6.8, 0.4);
  const { fills } = frame(styles, "glass", { theme: styles.theme(LIGHT), motion: glass }).calls;
  assert.ok(fills.length === 3 && fills[2].alpha >= 0.5, `mid-sweep sheen at ${fills[2]?.alpha}`);
});

test("soft entrances: the minimal sonar is born faint, and halo's inner ring cross-fades into its dashes", () => {
  const styles = loadNodeStyles();
  const m = motion(styles, { style: "minimal", active: true });
  const sonar = (phase) => { m.clock = clockAt(m, 4.2, phase); return frame(styles, "minimal", { active: true, motion: m }).calls.strokes[0].alpha; };
  assert.ok(sonar(0.005) < 0.05 && sonar(0.06) < sonar(0.12), `born faint (${sonar(0.005).toFixed(3)}), then brightening`);
  // Across T2's first 1.2 px the solid and the dashed ring share the stroke.
  const inner = (radius) => {
    const { calls } = frame(styles, "halo", { radius, motion: motion(styles, { style: "halo", clock: 1 }) });
    return calls.strokes.filter(({ width }) => Math.abs(width - 0.8) < 1e-9).map(({ alpha }) => Number(alpha.toFixed(6)));
  };
  assert.deepEqual(inner(8.3), [1], "solid below T2");
  assert.deepEqual(inner(9.1), [0.5, 0.5], "half and half halfway through the fade");
  assert.deepEqual(inner(10), [1], "dashed once T2 is in");
  // Halo's glow band and its radial cross-fade over T3's first 1.2 px.
  const glow = (radius) => {
    const { calls } = frame(styles, "halo", { radius, motion: motion(styles, { style: "halo", clock: 1 }) });
    return [calls.radial > 0 ? calls.fills[0].alpha : 0, calls.strokes.length > 0 && Math.abs(calls.strokes[0].width - radius * 0.45) < 1e-9 ? calls.strokes[0].alpha : 0];
  };
  const [radial, band] = glow(11.1), [, bandBelow] = glow(10.3), [radialAbove, bandAbove] = glow(12);
  assert.ok(radial > 0 && band > 0 && Math.abs(radial - band) < 1e-9 && bandBelow > band && radialAbove > radial && bandAbove === 0, "band below T3, radial above, half and half between");
});
