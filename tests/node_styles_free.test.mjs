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

test("detail follows the caller's tier: the extras need T1 (crystal's cut lines T2) and fade in over the tier's first 1.2 px", () => {
  const styles = loadNodeStyles();
  const at = (style, detail, radius = 12) => frame(styles, style, { radius, active: true, detail, motion: motion(styles, { style, active: true, clock: 0.9 }) }).calls;
  assert.deepEqual([at("orbs", 0).stroke, at("orbs", 1).stroke], [1, 2], "orbs: the glint needs T1");
  assert.deepEqual([at("glass", 0).stroke, at("glass", 1).stroke], [2, 4], "glass: the frost ring and caustic need T1");
  const parked = (detail) => frame(styles, "glass", { detail, motion: motion(styles, { style: "glass", still: true }) }).calls;
  assert.deepEqual([parked(0).fill, parked(1).fill], [2, 3], "glass: the sheen needs T1");
  assert.deepEqual([at("halo", 0).setLineDash, at("halo", 1).setLineDash], [0, 2], "halo: the dashed ring turns from T1 (solid below)");
  assert.deepEqual([at("halo", 0).stroke, at("halo", 1).stroke], [2, 4], "halo: the comet needs T1");
  assert.ok(at("crystal", 0).fill <= 2 && at("crystal", 1).fill >= 5, "crystal: the facets need T1");
  assert.equal(at("crystal", 2).stroke - at("crystal", 1).stroke, 1, "crystal: the cut's lines need T2");
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
  // The halo is a ring: its path turns back on the body's own edge.
  const hole = ctx.calls.log.find(([name, , , radius, , , back]) => name === "arc" && back === true && radius < 1);
  assert.ok(hole, "the halo path cuts the body out (an anticlockwise inner arc)");
  // Inside .65 r nothing changes over time: the same core and body paints at the
  // caller's alpha, turned only about the centre; the glint stays past .79 r.
  const inside = (clock, active) => {
    const recorded = frame(styles, "orbs", { active, radius: 15, motion: motion(styles, { active, clock }) });
    const glint = recorded.calls.log.filter(([name, , , radius]) => name === "arc" && Math.abs(radius - 15 * 0.84) < 1e-6);
    assert.equal(glint.length, 1, "one glint streak on .84 r");
    assert.ok(recorded.calls.strokes[1].width <= 15 * 0.09 + 1e-9, "a streak no wider than .09 r: its inner edge stays past .79 r");
    return JSON.stringify(recorded.calls.fills.slice(1));
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

test("Classic orbs: the glint is faint at rest, bright while working, and glides under 2 px a frame at r 15", () => {
  const styles = loadNodeStyles();
  const glintAlpha = (active) => frame(styles, "orbs", { active, motion: motion(styles, { active, clock: 1 }) }).calls.strokes[1].alpha;
  assert.ok(glintAlpha(true) > 2.5 * glintAlpha(false), "working brightens the glint");
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
  assert.equal(frame(styles, "glass", { theme: styles.theme(LIGHT) }).calls.fills[0].style, `rgba(${mix(TINT, LIGHT_BG, 0.6).join(",")},0.92)`, "and toward a light one, keeping more of the hue");
  const [, sheen] = ctx.calls.gradients;
  assert.deepEqual(plain(sheen.stops.map(([, colour]) => Number(colour.match(/[\d.]+\)$/)[0].slice(0, -1)))), [0, 0.12, 0.34, 0.12, 0], "the sheen is feathered, brightest in its middle");
  // Idle: the sheen sweeps across the first 55% of each 6.8 s pass, from the upper left.
  const m = motion(styles);
  const shift = (phase) => {
    m.clock = clockAt(m, 6.8, phase);
    const recorded = frame(styles, "glass", { motion: m });
    const move = recorded.calls.log.find(([name, , y]) => name === "translate" && y === 0);
    return move ? move[1] : null;
  };
  const positions = [0.05, 0.2, 0.35, 0.5].map(shift);
  assert.ok(positions.every((value, index) => value !== null && (index === 0 || value > positions[index - 1])), `the band travels one way (${positions.map((value) => value?.toFixed(2)).join(", ")})`);
  assert.ok(positions[0] < -0.9 && positions[3] > 0.9, "across the whole pane");
  assert.equal(shift(0.8), null, "then the pane rests until the next pass");
  // Reduced motion parks the sheen near the light.
  assert.equal(frame(styles, "glass", { motion: motion(styles, { still: true }) }).calls.log.find(([name, , y]) => name === "translate" && y === 0)[1], -0.5);
});

test("Minimal: a breathing dot, a sonar ring while working, a text-coloured selection ring; agents keep a backing disc", () => {
  const styles = loadNodeStyles();
  const radii = (ctx) => ctx.calls.log.filter(([name]) => name === "arc").map(([, , , radius]) => radius);
  const dots = [0, 0.9, 1.8].map((clock) => radii(frame(styles, "minimal", { motion: motion(styles, { style: "minimal", clock }) }))[0]);
  assert.ok(new Set(dots).size === 3 && Math.max(...dots) - Math.min(...dots) > 0.6, `the dot breathes (${dots.map((dot) => dot.toFixed(2)).join(", ")})`);
  assert.equal(frame(styles, "minimal").calls.stroke, 0, "a quiet dot draws one fill");
  // Working: a sonar ring goes out from the dot to 1.25 r, fading as it goes.
  const m = motion(styles, { style: "minimal", active: true });
  const sonar = [0.1, 0.5, 0.9].map((phase) => {
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
  assert.deepEqual([radii(agent)[0], agent.calls.fills[0].style], [12 * 0.78, "rgba(220,180,110,0.28125)"]);
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
  assert.ok(dashes.length === 6 && dashes.every(([, ...values], index) => index % 2 ? values.length === 0 : values.length === 2 && Math.abs(values[0] - Math.PI * 2 * 7.2 / 16) < 1e-6), "eight dashes on .6 r, reset right after");
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
  assert.ok(Math.abs(rim[0][1] - (50 + 12 * Math.cos(Math.PI / 8))) < 1e-6 && Math.abs(rim[0][2] - (50 + 12 * 0.965 * Math.sin(Math.PI / 8))) < 1e-6, "flat on top at rest (the tilt at its middle)");
  // The cut turns (40 s a turn at rest, 2.6 times as fast working) while the light gradient stays put.
  const turned = frame(styles, "crystal", { motion: motion(styles, { style: "crystal", clock: 5 }) });
  assert.notDeepEqual(plain(outline(turned)[0]), plain(rim[0]), "the gem turns");
  assert.equal(turned.calls.rotate, 0, "by its own geometry: the light gradient never turns with it");
  // The facet facing the light flashes alone; halfway between two facets, they share it.
  const m = motion(styles, { style: "crystal" });
  const flashes = (spin) => {
    m.clock = clockAt(m, 40, spin / (Math.PI * 2));
    return frame(styles, "crystal", { motion: m, detail: 1 }).calls.fills.filter(({ style }) => style === `rgba(${mix(TINT, WHITE, 0.78).join(",")},0.92)`).length;
  };
  assert.equal(flashes(0), 1, "a facet square to the light");
  assert.equal(flashes(Math.PI / 8), 2, "two facets sharing it");
  // A lit gem glows inside an octagon, built once; a quiet one never builds it.
  assert.equal(frame(styles, "crystal").calls.radial, 0);
  const lit = frame(styles, "crystal", { active: true });
  assert.ok(lit.calls.radial === 1 && lit.calls.reach <= 12 * 1.56, "the lit halo: one radial, inside 1.55 r");
  // The sparkle where the light strikes: 14% of each 3.4 s pass (1.3 s working).
  const sparkle = (phase) => { m.clock = clockAt(m, 3.4, phase); return frame(styles, "crystal", { motion: m }).calls.fill; };
  assert.equal(sparkle(0.07) - sparkle(0.5), 1, "twinkles, then rests");
  // Below T1 a plain gem: its lit and shadow sides and the rim.
  const small = frame(styles, "crystal", { radius: 5 });
  assert.deepEqual([small.calls.fill, small.calls.stroke], [1, 1]);
  // A light theme lifts the gem (no heavy blob on the page).
  const [dark] = frame(styles, "crystal").calls.gradients, [pale] = frame(styles, "crystal", { theme: styles.theme(LIGHT) }).calls.gradients;
  assert.ok(luma(pale.stops[1][1]) > luma(dark.stops[1][1]), "the mid tone is lighter on a light theme");
});

test("glyph dress: each free look writes its glyph and monogram in an ink that reads on its own body", () => {
  const styles = loadNodeStyles();
  const dark = styles.theme(null), light = styles.theme(LIGHT);
  const bright = [125, 178, 255], dim = [120, 60, 200];
  // Orbs: the role glyph's bold strokes dark on a bright hue, light on a dim one.
  assert.ok(luma(styles.glyph("orbs", bright, dark).ink) < 60 && luma(styles.glyph("orbs", dim, dark).ink) > 200);
  for (const [style, scale, gap] of [["glass", 0.66, 3.5], ["halo", 0.5, 3.5], ["crystal", 0.5, 3.5]]) {
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
