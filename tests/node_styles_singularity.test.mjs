// Singularity, the Void collection's black hole (renderer/node-styles.js,
// section "style: singularity"): its body, its detail tiers and budgets, its
// motion and still pose, its paints' reuse, and every hook of its pack
// (status ring, hub dress, work orbit, arrival, selection, wires, pulses and
// landings).
import test from "node:test";
import assert from "node:assert/strict";
import { loadNodeStyles, recordingContext, gradientsBuilt, plain } from "./fixtures/node-styles-harness.mjs";

const P = { x: 50, y: 50 };
const TINT = [185, 176, 255];
const VOID = { background: "#030208", text: "#ece9ff", accent2: "#36d1ff" };
const LIGHT = { background: "#F3F0E8", text: "#1D2330" };
const paint = (styles, ctx, radius, options = {}, tint = TINT) => styles.paint(ctx, "singularity", P, radius, tint, { kind: "task", detail: styles.tier(radius), ...options });
const luminance = (text) => { const [r, g, b] = text.match(/\d+/g).slice(0, 3).map(Number); return r * 0.2126 + g * 0.7152 + b * 0.0722; };

// A motion record stepped at 30 Hz for `frames` frames in the given state.
function record(styles, { active = false, selected = false, frames = 60, still = false, id = "task:hole" } = {}) {
  const motion = styles.motionRecord(new Map(), id);
  const flags = { style: "singularity", active, selected, progress: null, orbit: active ? 1.1 : 0, status: null, time: 0, frame: 0 };
  for (let frame = 0; frame < frames; frame += 1) { flags.time = frame * 1000 / 30; flags.frame = frame; styles.stepMotion(motion, flags, 1 / 30, still); }
  return { motion, flags, step(count = 1) { for (let index = 0; index < count; index += 1) { flags.time += 1000 / 30; flags.frame += 1; styles.stepMotion(motion, flags, 1 / 30, still); } return flags.time; } };
}

// ===== the look =====

test("Singularity registers a full pack: every hook, a ×4 working clock, a light glyph ink and a reach that grows with its jets", () => {
  const styles = loadNodeStyles();
  const ctx = recordingContext();
  const theme = styles.theme(VOID);
  for (const call of [
    () => styles.ring(ctx, "singularity", P, 10, TINT, { status: "running", ring: 14, time: 0, still: true, theme }),
    () => styles.hubDress(ctx, "singularity", P, 15, TINT, { crew: false, breathe: 0.5, time: 0, still: true, theme }),
    () => styles.orbit(ctx, "singularity", P, 12, TINT, { running: true, phase: 1, ring: 21, time: 0, still: true, theme }),
    () => styles.arrival(ctx, "singularity", P, 12, TINT, 0.5, { alpha: 1, time: 0, still: false, theme }),
    () => styles.select(ctx, "singularity", P, 12, TINT, { selected: true, alpha: 1, time: 0, still: true, theme }),
    () => styles.wire(ctx, "singularity", P, { x: 150, y: 90 }, { kind: "task", tint: TINT, alpha: 0.5, width: 1, dash: [], time: 0, still: false, seed: 0.3 }),
    () => styles.surge(ctx, "singularity", P, { x: 150, y: 90 }, 0.5, { color: "#b9b0ff" }, { kind: "dot", time: 0, still: false, rTo: 10 }),
    () => styles.land(ctx, "singularity", P, 12, TINT, 0.5, { kind: "dot", time: 0, still: false, rTo: 12 }),
  ]) assert.equal(call(), true, "the style draws the hook itself");
  assert.equal(ctx.calls.saves, ctx.calls.restores, "every hook hands the canvas back as it found it");
  const glyph = styles.glyph("singularity", TINT, theme);
  assert.ok(luminance(glyph.ink) > 200 && glyph.scale === 0.56 && glyph.ringGap === 4, "a light glyph ink on the black horizon");
  const idle = record(styles), working = record(styles, { active: true });
  assert.equal(working.motion.tempo, 4, "working runs the clock four times faster");
  assert.ok(Math.abs(styles.reach("singularity", idle.motion) - 1.1) < 1e-9, "at rest the disc reaches 1.08 radii");
  assert.ok(Math.abs(styles.reach("singularity", working.motion) - 1.58) < 1e-6, "working, the jets reach 1.58");
});

test("a black horizon, a photon ring lit from the top, a Doppler disc and a turning conic of streaks", () => {
  const styles = loadNodeStyles();
  for (const palette of [VOID, LIGHT]) {
    const ctx = recordingContext();
    paint(styles, ctx, 12, { theme: styles.theme(palette) });
    const { gradients } = ctx.calls;
    assert.equal(ctx.calls.conic, 2, "two conic paints: the fixed Doppler light and the turning streaks");
    const [doppler, streaks] = gradients.filter(({ kind }) => kind === "conic");
    assert.ok(Math.abs(doppler.args[0] - Math.PI) < 1e-9, "the Doppler light is brightest on the approaching (left) side");
    // The receding side keeps the node's tint with a trace of the theme's
    // second hue, so a state's colour owns the whole disc.
    const channels = (text) => text.match(/[\d.]+/g).slice(0, 3).map(Number);
    const far = channels(doppler.stops.find(([offset]) => offset === 0.5)[1]);
    const accent = palette === VOID ? [54, 209, 255] : TINT.map((channel) => Math.round(channel + (255 - channel) * 0.72));
    const gap = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    assert.ok(gap(far, TINT) < gap(far, accent) / 2, `the receding side is the tint's (${far})`);
    assert.ok(doppler.stops.every(([, colour]) => !colour.startsWith(`rgba(${accent.join(",")},`)), "never the second hue alone");
    assert.equal(streaks.stops.length >= 20, true, "the streak conic carries its irregular bands");
    const core = gradients.find(({ kind, args }) => kind === "radial" && args[5] === 0.52);
    assert.equal(core.stops[0][1], "rgba(2,1,5,1)", "the horizon is black on every theme");
    const photon = gradients.find(({ kind, args }) => kind === "linear" && args[1] === -0.58);
    assert.ok(luminance(photon.stops[0][1]) > luminance(photon.stops[2][1]), "the photon ring is brightest on top (the lensed far side)");
  }
  // The Doppler fill never turns; the streaks do: the frame rotates between
  // them. One transform places, sizes and tilts the node.
  const { motion, step } = record(styles, { active: true });
  const frame = (time) => {
    const ctx = recordingContext();
    paint(styles, ctx, 12, { active: true, motion, time });
    const transforms = ctx.calls.log.filter(([name]) => name === "transform");
    assert.equal(transforms.length, 1, "one transform for the node");
    const [, a, b] = transforms[0];
    return { tilt: Math.atan2(b, a), spins: ctx.calls.log.filter(([name]) => name === "rotate").map(([, angle]) => angle) };
  };
  const first = frame(1000);
  step(3);
  const later = frame(1100);
  assert.ok(Math.abs(first.tilt - later.tilt) < 1e-6 && first.tilt < -0.1 && first.tilt > -0.4, "the disc keeps its tilt");
  assert.equal(first.spins.length, 4, "the streaks turn under each half's fill and turn back");
  assert.notDeepEqual(first.spins, later.spins, "and they turn");
});

test("every tier steps down to a clean small node: exact budgets for the still pose, never above them while animated", () => {
  const styles = loadNodeStyles();
  // [lineTo, arc, ellipse, fill, stroke] per tier (radius) and state: exact
  // in the still pose, and the ceiling while animated (every spark in view; a
  // spark behind the horizon and inside its shadow is not drawn, and a jet's
  // knot is not stroked while it is invisible).
  const POSE = {
    4.5: { quiet: [1, 3, 4, 4, 2], working: [1, 3, 4, 4, 2], chosen: [1, 3, 4, 4, 2] },
    7: { quiet: [2, 11, 0, 6, 1], working: [7, 11, 0, 7, 2], chosen: [2, 11, 0, 6, 1] },
    9.5: { quiet: [4, 11, 0, 7, 3], working: [9, 11, 0, 8, 3], chosen: [4, 11, 0, 7, 3] },
    12: { quiet: [5, 11, 0, 7, 3], working: [14, 11, 0, 8, 4], chosen: [5, 11, 0, 7, 3] },
  };
  const BUDGETS = {
    4.5: { quiet: [1, 3, 4, 4, 2], working: [1, 3, 4, 4, 2], chosen: [1, 3, 4, 4, 2] },
    7: { quiet: [2, 11, 0, 6, 1], working: [8, 11, 0, 7, 3], chosen: [2, 11, 0, 6, 1] },
    9.5: { quiet: [5, 11, 0, 7, 3], working: [11, 11, 0, 8, 3], chosen: [5, 11, 0, 7, 3] },
    12: { quiet: [7, 11, 0, 7, 3], working: [15, 11, 0, 8, 4], chosen: [7, 11, 0, 7, 3] },
  };
  const STATES = { quiet: {}, working: { active: true }, chosen: { selected: true, chosen: true } };
  const counts = (ctx) => [ctx.calls.lineTo, ctx.calls.arc, ctx.calls.ellipse, ctx.calls.fill, ctx.calls.stroke];
  for (const [radius, byState] of Object.entries(BUDGETS)) {
    for (const [state, budget] of Object.entries(byState)) {
      const pose = recordingContext();
      paint(styles, pose, Number(radius), STATES[state]);
      assert.deepEqual(counts(pose), POSE[radius][state], `r ${radius} ${state}: the still pose's budget`);
      const live = record(styles, { active: state === "working", selected: state === "chosen" });
      const most = [0, 0, 0, 0, 0];
      for (let frame = 0; frame < 150; frame += 1) {
        const time = live.step();
        const ctx = recordingContext();
        paint(styles, ctx, Number(radius), { ...STATES[state], motion: live.motion, time });
        counts(ctx).forEach((count, index) => { most[index] = Math.max(most[index], count); assert.ok(count <= budget[index], `r ${radius} ${state} frame ${frame}: ${counts(ctx)} within ${budget}`); });
      }
      assert.deepEqual(most, budget, `r ${radius} ${state}: the ceiling is reached, not padded`);
    }
  }
  // T0 is a tiny ringed planet: no streak conic fill, no sparks, no jets, one hot spot.
  const tiny = recordingContext();
  paint(styles, tiny, 4.5, { active: true });
  assert.equal(tiny.calls.rotate, 0, "nothing turns under the transform");
  assert.equal(tiny.calls.log.filter(([name]) => name === "scale").length, 0, "the halves are ellipses: no squashing transform");
  assert.equal(tiny.calls.lineTo, 1, "one hot spot rides the disc");
});

test("a steady node costs few canvas operations: 36 at T0 (most of a board's todos), and fixed ceilings above it", () => {
  const styles = loadNodeStyles();
  // Every call and property set of one warm paint, the dispatcher's save,
  // alpha and restore included; the ceiling over 150 animated frames (the
  // T0 spot behind the horizon and in front of it).
  // [quiet or chosen, working] per tier (radius).
  const CEILINGS = { 4.5: [36, 36], 7: [56, 81], 9.5: [76, 90], 12: [80, 103] };
  for (const [radius, [quiet, working]] of Object.entries(CEILINGS)) {
    for (const flags of [{}, { active: true }, { selected: true, chosen: true }, { kind: "agent", glyph: true, active: true }]) {
      const live = record(styles, { active: flags.active === true, selected: flags.selected === true });
      const ctx = recordingContext();
      paint(styles, ctx, Number(radius), { ...flags, motion: live.motion, time: live.flags.time });
      const sides = new Set();
      let most = 0;
      for (let frame = 0; frame < 150; frame += 1) {
        const time = live.step();
        const from = ctx.calls.log.length;
        paint(styles, ctx, Number(radius), { ...flags, motion: live.motion, time });
        const log = ctx.calls.log.slice(from);
        most = Math.max(most, log.length);
        if (Number(radius) < 6) sides.add(log.findIndex(([name]) => name === "lineTo") < log.findIndex(([name, , , r]) => name === "arc" && r === 0.52) ? "behind" : "front");
      }
      assert.equal(most, flags.active ? working : quiet, `r ${radius} ${JSON.stringify(flags)}: the ceiling of canvas operations`);
      if (Number(radius) < 6) assert.deepEqual([...sides].sort(), ["behind", "front"], "the T0 spot passes behind the horizon and in front of it");
    }
  }
});

test("nothing is painted under the horizon, so a node at rest alpha keeps a black shadow", () => {
  const styles = loadNodeStyles();
  const ctx = recordingContext();
  paint(styles, ctx, 12, { active: true, alpha: 0.65 });
  const log = plain(ctx.calls.log);
  const core = log.findIndex(([name, x, y, r]) => name === "arc" && x === 0 && y === 0 && r === 0.52);
  assert.ok(core > 0);
  const before = log.slice(0, core).filter(([name]) => name === "moveTo" || name === "lineTo");
  // The far wings are traced in the squashed disc frame (.34 in the still pose).
  const edge = before.filter(([, x, y]) => Math.abs(Math.hypot(x, y * 0.34) - 0.52) < 0.002);
  assert.equal(edge.length, 2, "the far half's two wings stop at the horizon's edge (closed by a chord)");
  assert.ok(before.some(([name, , y]) => name === "moveTo" && Math.abs(y) === 0.53), "the jets leave from the horizon's rim");
  const aura = ctx.calls.gradients.find(({ kind, args }) => kind === "radial" && args[5] === 1.72);
  assert.deepEqual(aura.stops.slice(0, 2).map(([, colour]) => colour.endsWith(",0)")), [true, true], "the aura is hollow under the horizon");
  assert.equal(log.filter(([name, x, y, r]) => name === "arc" && x === 0 && y === 0 && r === 0.52).length, 1, "and the horizon is one fill");
});

test("reach stays inside 1.8 radii, and the path inside 1.6 while it works (1.45 at rest)", () => {
  const styles = loadNodeStyles();
  for (const [state, flags] of Object.entries({ quiet: {}, working: { active: true }, chosen: { selected: true, chosen: true }, glyph: { kind: "agent", active: true, glyph: true } })) {
    for (const radius of [4.5, 7, 9.5, 12, 15]) {
      const live = record(styles, { active: flags.active === true, selected: flags.selected === true });
      let reach = 0, path = 0;
      for (let frame = 0; frame < 150; frame += 1) {
        const time = live.step();
        if (frame === 40) live.motion.kick = 1;
        const ctx = recordingContext();
        paint(styles, ctx, radius, { ...flags, motion: live.motion, time });
        reach = Math.max(reach, ctx.calls.reach / radius); path = Math.max(path, ctx.calls.pathReach / radius);
      }
      assert.ok(reach <= 1.8, `${state} r ${radius}: reach ${reach.toFixed(3)}r`);
      assert.ok(path <= (flags.active ? 1.6 : 1.45), `${state} r ${radius}: path reach ${path.toFixed(3)}r`);
    }
  }
});

test("steady frames build nothing: no gradient after warm-up, at time 5000, or after a tint changes and comes back", () => {
  const styles = loadNodeStyles();
  const theme = styles.theme(VOID);
  const ctx = recordingContext({ conic: true });
  const other = [104, 236, 164];
  const live = record(styles, { active: true });
  paint(styles, ctx, 12, { active: true, motion: live.motion, time: 0, theme });
  const warm = gradientsBuilt(ctx);
  assert.equal(warm, 7, "seven unit-space paints per canvas, tint and theme (two conic)");
  for (const time of [33, 400, 5000, 99999]) {
    live.step();
    paint(styles, ctx, 12, { active: true, motion: live.motion, time, theme });
    paint(styles, ctx, 9, { selected: true, chosen: true, motion: live.motion, time, theme, alpha: 0.4 });
    paint(styles, ctx, 4.5, { time, theme });
  }
  assert.equal(gradientsBuilt(ctx), warm, "moving, resizing, lighting and dimming reuse the same paints");
  paint(styles, ctx, 12, { theme }, other);
  const withOther = gradientsBuilt(ctx);
  assert.equal(withOther, warm + 7, "another tint builds its own paints once");
  paint(styles, ctx, 12, { theme, time: 5000 });
  paint(styles, ctx, 12, { theme, time: 5000 }, other);
  assert.equal(gradientsBuilt(ctx), withOther, "going back to a tint reuses its paints");
  assert.equal(ctx.calls.shadowBlurs.length, 0, "no shadowBlur, ever");
  assert.ok(!ctx.calls.log.some(([name]) => name === "set:filter" || name === "clip"), "no filter, no clip");
  assert.ok(styles.cacheStats(ctx).entries <= 4, "no lit or selected level in the keys");
});

test("reduced motion holds one designed pose; a live record animates, working differs from idle", () => {
  const styles = loadNodeStyles();
  const snapshot = (options) => { const ctx = recordingContext(); paint(styles, ctx, 12, options); return plain(ctx.calls.log); };
  for (const flags of [{}, { active: true }, { selected: true, chosen: true }, { kind: "assistant" }]) {
    const still = record(styles, { active: flags.active === true, selected: flags.selected === true, still: true });
    const poses = [0, 1234, 99999].map((time) => { still.step(); return snapshot({ ...flags, motion: still.motion, time, still: true }); });
    assert.deepEqual(poses[1], poses[0], "the still record is the same at 0 and 1234 ms");
    assert.deepEqual(poses[2], poses[0], "and at 99999 ms");
    const bare = [0, 1234, 99999].map((time) => snapshot({ ...flags, time, still: true }));
    assert.deepEqual(bare[1], bare[0]); assert.deepEqual(bare[2], bare[0]);
  }
  for (const active of [false, true]) {
    const live = record(styles, { active });
    const first = snapshot({ active, motion: live.motion, time: 0 });
    live.step(12);
    assert.notDeepEqual(snapshot({ active, motion: live.motion, time: 400 }), first, `${active ? "working" : "idle"}: the disc turns and the sparks fall by 400 ms`);
  }
  const idle = recordingContext(), working = recordingContext();
  paint(styles, idle, 12, {});
  paint(styles, working, 12, { active: true });
  assert.ok(working.calls.lineTo > idle.calls.lineTo && working.calls.fill > idle.calls.fill, "working adds jets and more sparks");
  assert.notDeepEqual(plain(working.calls.log), plain(idle.calls.log));
});

test("selection thickens the photon ring, a landing kicks it, and a glyph node dims the disc's near half", () => {
  const styles = loadNodeStyles();
  const quiet = recordingContext(), chosen = recordingContext();
  paint(styles, quiet, 12, {});
  paint(styles, chosen, 12, { selected: true, chosen: true });
  assert.ok(Math.max(...chosen.calls.lineWidths) > Math.max(...quiet.calls.lineWidths), "the selected node's ring is wider");
  const live = record(styles);
  const photonWidth = () => { const ctx = recordingContext(); paint(styles, ctx, 12, { motion: live.motion, time: live.flags.time }); return Math.max(...ctx.calls.lineWidths); };
  const rest = photonWidth();
  live.motion.kick = 1; live.step();
  assert.ok(photonWidth() > rest, "a landed pulse flashes the photon ring");
  live.step(20);
  assert.ok(Math.abs(photonWidth() - rest) < 1e-9, "and it settles as the kick decays");
  // The hub: the monogram in a light ink on the black horizon, on dark and light themes.
  for (const palette of [VOID, LIGHT]) {
    const hub = recordingContext();
    paint(styles, hub, 15, { kind: "assistant", theme: styles.theme(palette), alpha: 0.8 });
    const [monogram] = hub.calls.texts;
    assert.equal(monogram.text, "M");
    assert.ok(luminance(monogram.ink) > 200, `the hub's M reads on the horizon (${monogram.ink})`);
    assert.equal(monogram.alpha, 0.8, "at the caller's alpha");
  }
  const plainNode = recordingContext(), agent = recordingContext();
  paint(styles, plainNode, 12, { kind: "task" });
  paint(styles, agent, 12, { kind: "agent", glyph: true });
  const bare = plainNode.calls.alphas, dressed = agent.calls.alphas;
  assert.equal(dressed.length, bare.length);
  const changed = bare.map((alpha, index) => [alpha, dressed[index]]).filter(([from, to]) => from !== to);
  assert.ok(changed.length >= 3 && changed.every(([from, to]) => Math.abs(to - from * 0.4) < 1e-9), "the near half (and the sparks in front) cross a glyph at .4");
});

test("infalling sparks leave the disc's rim, glow brighter while it works, and go deep on a pale page", () => {
  const styles = loadNodeStyles();
  const sparkRuns = (active, palette) => {
    const theme = styles.theme(palette);
    const live = record(styles, { active });
    // The sparks are the only strokes in a colour at .8.
    const isSpark = (value) => typeof value === "string" && value.endsWith(",0.8)");
    const alphas = new Set(), inks = new Set();
    let farthest = 0;
    for (let frame = 0; frame < 120; frame += 1) {
      const time = live.step();
      const ctx = recordingContext();
      paint(styles, ctx, 12, { active, motion: live.motion, time, theme });
      const log = plain(ctx.calls.log);
      log.forEach(([name, value], index) => {
        if (name !== "set:strokeStyle" || !isSpark(value)) return;
        for (let at = index - 1; at >= 0 && log[at][0] !== "beginPath"; at -= 1) if (log[at][0] === "moveTo" || log[at][0] === "lineTo") farthest = Math.max(farthest, Math.abs(log[at][1]));
      });
      for (const stroke of ctx.calls.strokes) if (isSpark(stroke.style)) { alphas.add(Math.round(stroke.alpha * 1000) / 1000); inks.add(stroke.style); }
    }
    return { alphas: [...alphas], inks: [...inks], farthest };
  };
  const quiet = sparkRuns(false, VOID), working = sparkRuns(true, VOID);
  assert.ok(quiet.farthest > 0.9 && quiet.farthest <= 1.12 + 1e-9, `born on the disc, not in empty space (${quiet.farthest.toFixed(3)})`);
  assert.deepEqual(quiet.alphas, [0.55], "a quiet disc's sparks are soft");
  assert.deepEqual(working.alphas, [0.9], "a working disc's burn brighter");
  const pale = sparkRuns(false, LIGHT);
  assert.deepEqual(pale.alphas, [0.4], "on a pale page: softer still");
  assert.ok(pale.inks.length === 1 && luminance(pale.inks[0]) < luminance("rgba(243,240,232,1)") - 60, `and deep, not white (${pale.inks[0]})`);
  assert.ok(luminance(quiet.inks[0]) > 200, "white-hot on a dark page");
});

test("a jet's knots are born at the horizon's rim, thin as they travel out and fade before the tip: no blink at the wrap", () => {
  const styles = loadNodeStyles();
  const live = record(styles, { active: true });
  const knot = "rgba(245,244,255,0.95)"; // the tint's rim ink on a dark page
  let previous = null, drawn = 0, farthest = 0, faintest = 1, jump = 0;
  for (let frame = 0; frame < 90; frame += 1) {
    const time = live.step();
    const ctx = recordingContext();
    paint(styles, ctx, 15, { active: true, motion: live.motion, time });
    const log = plain(ctx.calls.log);
    const at = log.findIndex(([name, value]) => name === "set:strokeStyle" && value === knot);
    const stroke = at < 0 ? null : ctx.calls.strokes.find(({ style }) => style === knot);
    const alpha = stroke ? stroke.alpha : 0;
    if (stroke) {
      drawn += 1;
      faintest = Math.min(faintest, alpha);
      // The two knots' ends, in the node's unit frame (the jet's axis is y).
      const ends = log.slice(0, at).reverse();
      const path = ends.slice(0, ends.findIndex(([name]) => name === "beginPath")).filter(([name]) => name === "moveTo" || name === "lineTo");
      assert.equal(path.length, 4, "one knot on each jet, in one stroke");
      for (const [, x, y] of path) { assert.equal(x, 0); farthest = Math.max(farthest, Math.abs(y)); assert.ok(Math.abs(y) >= 0.62 - 1e-9, "never inside the horizon's rim"); }
    }
    if (previous !== null) jump = Math.max(jump, Math.abs(alpha - previous));
    previous = alpha;
  }
  assert.ok(drawn > 60, `the knots run all the time (${drawn} of 90 frames)`);
  assert.ok(farthest <= 1.5 + 0.075 - 0.32 + 0.18 + 1e-9 && farthest < 1.45, `they stop well short of the tip (${farthest.toFixed(2)})`);
  assert.ok(faintest < 0.12, "they fade to almost nothing at both ends of their run");
  assert.ok(jump < 0.2, `no knot blinks on or off between frames (largest step ${jump.toFixed(3)})`);
});

test("a small hub widens its horizon so the monogram always sits on black", () => {
  const styles = loadNodeStyles();
  for (const palette of [VOID, LIGHT]) {
    const theme = styles.theme(palette);
    for (const radius of [3, 4.5, 8, 12.5, 15]) {
      const ctx = recordingContext();
      paint(styles, ctx, radius, { kind: "assistant", theme });
      const log = plain(ctx.calls.log);
      // The horizon is the arc filled right after a pure-black or core fill style is set.
      const fillAt = log.findIndex(([name, value]) => name === "set:fillStyle" && (value === "rgba(2,1,5,1)" || String(value).includes("0 rgba(2,1,5,1)")));
      const arc = log.slice(0, fillAt).reverse().find(([name]) => name === "arc");
      const size = arc[3] * radius;
      assert.ok(size >= Math.min(6.45, 1.7 * radius) - 1e-6, `r ${radius}: a ${size.toFixed(1)} px horizon under the M`);
      assert.ok(arc[3] <= 1.7 + 1e-9, "never past 1.7 radii");
      if (radius >= 12.5) assert.ok(Math.abs(arc[3] - 0.52) < 1e-9, "a full-size hub keeps the .52 horizon");
      assert.equal(ctx.calls.texts[0].text, "M");
    }
  }
});

test("every layer follows the caller's alpha, on both themes and without conic gradients", () => {
  const styles = loadNodeStyles();
  for (const palette of [VOID, LIGHT]) for (const conic of [true, false]) for (const flags of [{}, { active: true }, { kind: "agent", glyph: true, active: true }]) {
    const live = record(styles, { active: flags.active === true });
    live.motion.kick = 0.6;
    const full = recordingContext({ conic }), dimmed = recordingContext({ conic });
    const theme = styles.theme(palette);
    paint(styles, full, 12, { ...flags, alpha: 1, motion: live.motion, time: 700, theme });
    paint(styles, dimmed, 12, { ...flags, alpha: 0.3, motion: live.motion, time: 700, theme });
    const a = full.calls.alphas, b = dimmed.calls.alphas;
    assert.equal(a.length, b.length);
    assert.ok(b.every((alpha, index) => alpha > 0 && alpha <= 0.3 + 1e-12 && Math.abs(alpha - 0.3 * a[index]) < 1e-12), "each layer at a gain of the caller's alpha, never above it");
    assert.ok(b.includes(0.3), "the horizon at exactly the caller's alpha");
  }
});

// ===== the pack's hooks =====

test("the status ring: a spark on a tilted ellipse while running; queued, error and done keep their colours and badges", () => {
  const styles = loadNodeStyles();
  const theme = styles.theme(VOID);
  const live = record(styles, { active: true, id: "agent:watcher" });
  const ring = (status, extra = {}) => { const ctx = recordingContext(); ctx.globalAlpha = 0.9; assert.equal(styles.ring(ctx, "singularity", P, 10, TINT, { status, builder: false, ring: 14, time: live.flags.time, still: false, detail: 3, motion: live.motion, theme, ...extra }), true); assert.equal(ctx.calls.saves, ctx.calls.restores); assert.equal(ctx.globalAlpha, 0.9); return ctx; };
  const running = ring("running");
  assert.equal(running.calls.stroke, 4, "the ellipse and a three-segment tail");
  assert.equal(running.calls.fill, 1, "one spark");
  assert.ok(running.calls.alphas.every((alpha) => alpha <= 0.9 + 1e-12), "never above the caller's alpha");
  live.step(3);
  assert.notDeepEqual(plain(ring("running").calls.log), plain(running.calls.log), "the spark orbits");
  assert.equal(ring("running", { detail: 1 }).calls.stroke, 2, "a small node keeps one tail segment");
  const queued = ring("queued");
  assert.deepEqual(plain(queued.calls.log.find(([name]) => name === "setLineDash")), ["setLineDash", 2, 3], "queued: a dashed ellipse");
  const error = ring("error");
  assert.ok(error.calls.strokes.some(({ style }) => style === "rgba(255,212,121,1)"), "error: the theme's amber ellipse");
  assert.deepEqual(error.calls.texts.map(({ text }) => text), ["!"], "and its badge");
  const done = ring("done");
  assert.ok(done.calls.strokes.some(({ style }) => style === "rgba(104,236,164,1)") && done.calls.lineTo === 2, "done: a green tick badge");
  // A badge pops in when the status changes (easeOutBack over 320 ms).
  live.motion.statusAt = live.flags.time - 60;
  const popping = ring("error");
  assert.ok(popping.calls.log.some(([name, sx]) => name === "scale" && sx < 1), "a new badge grows in");
  const none = ring(null);
  assert.equal(none.calls.stroke + none.calls.fill, 0, "no status, nothing to draw");
  // On a pale page the spark's head goes deep instead of white, so it reads.
  const page = luminance("rgba(243,240,232,1)");
  const pale = ring("running", { theme: styles.theme(LIGHT) });
  assert.ok(luminance(pale.calls.fills[0].style) < page - 60, `a deep head on the light theme (${pale.calls.fills[0].style})`);
  assert.ok(luminance(running.calls.fills[0].style) > 200, "a white-hot head on a dark one");
  // Agents in the same state never pulse or march in lockstep: each keeps its own phase.
  const other = record(styles, { active: true, id: "agent:scout" });
  const phases = (status, motion) => { const ctx = recordingContext(); styles.ring(ctx, "singularity", P, 10, TINT, { status, builder: false, ring: 14, time: 1234, still: false, detail: 3, motion, theme }); return plain(ctx.calls.log).filter(([name]) => name === "set:lineDashOffset" || name === "set:globalAlpha"); };
  assert.notDeepEqual(phases("queued", live.motion), phases("queued", other.motion), "queued dashes drift by the agent's own seed");
  assert.notDeepEqual(phases("error", live.motion), phases("error", other.motion), "the error ellipse pulses by the agent's own seed");
  assert.deepEqual(plain(ring("running", { still: true, time: 0 }).calls.log), plain(ring("running", { still: true, time: 5000 }).calls.log), "still: the spark is parked");
});

test("the hub's lensing ring breathes well outside the disc; the work orbit is a tilted ellipse with comets in the node's tint", () => {
  const styles = loadNodeStyles();
  const theme = styles.theme(VOID);
  const live = record(styles);
  const hub = recordingContext();
  styles.hubDress(hub, "singularity", P, 15, TINT, { crew: true, breathe: 0.5, time: 1000, still: false, detail: 3, motion: live.motion, theme });
  assert.ok(hub.calls.reach > 15 * 1.5 && hub.calls.log.some(([name]) => name === "setLineDash"), "a lensing ring past 1.5 radii and the crew's dashed ring");
  assert.equal(hub.calls.saves, hub.calls.restores);
  const breaths = new Set();
  for (let frame = 0; frame < 60; frame += 1) {
    live.step(3);
    const ctx = recordingContext();
    styles.hubDress(ctx, "singularity", P, 15, TINT, { crew: false, breathe: 0.5, time: live.flags.time, still: false, detail: 3, motion: live.motion, theme });
    breaths.add(ctx.calls.log.find(([name]) => name === "arc")[3].toFixed(2));
  }
  assert.ok(breaths.size > 10, "the ring breathes");
  const orbit = recordingContext();
  const working = record(styles, { active: true });
  assert.equal(styles.orbit(orbit, "singularity", P, 12, TINT, { running: true, phase: 1, ring: 21, time: 1000, still: false, detail: 3, motion: working.motion, theme }), true);
  assert.ok(!orbit.calls.strokes.some(({ style }) => String(style).startsWith("rgba(125,178,255")), "no hard-coded orbit blue");
  assert.ok(orbit.calls.strokes.some(({ style }) => style === "rgba(185,176,255,1)"), "the comets' tails wear the node's tint");
  assert.equal(orbit.calls.fill, 2, "two comets while Running");
  assert.ok(orbit.calls.reach <= 21 + 2 + 1e-9, "on the r + 9 ellipse");
  const next = recordingContext();
  styles.orbit(next, "singularity", P, 12, null, { running: false, phase: 1, ring: 21, time: 1000, still: false, detail: 3, motion: working.motion, theme });
  assert.equal(next.calls.fill, 1, "one comet while Next, in the theme's orbit hue without a tint");
  // The comets' heads: white-hot on a dark page, deep on a pale one.
  const pale = recordingContext();
  styles.orbit(pale, "singularity", P, 12, TINT, { running: true, phase: 1, ring: 21, time: 1000, still: false, detail: 3, motion: working.motion, theme: styles.theme(LIGHT) });
  assert.ok(pale.calls.fills.every(({ style }) => luminance(style) < luminance("rgba(243,240,232,1)") - 60), "heads that read on the light theme");
  assert.ok(orbit.calls.fills.every(({ style }) => luminance(style) > 200), "and glow on the dark one");
});

test("arrival implodes inside 2.25 radii; selection rings at 1.18 and the chosen node ripples", () => {
  const styles = loadNodeStyles();
  const theme = styles.theme(VOID);
  // The screen-space rings (the gulp's unit arc and the photon flash are smaller).
  const rings = (t) => {
    const ctx = recordingContext();
    assert.equal(styles.arrival(ctx, "singularity", P, 12, TINT, t, { alpha: 0.8, time: 0, still: false, theme }), true);
    assert.ok(ctx.calls.reach <= 12 * 2.25 + 1e-9, `t ${t}: reach ${(ctx.calls.reach / 12).toFixed(2)}r`);
    assert.ok(ctx.calls.alphas.every((alpha) => alpha <= 0.8 + 1e-12));
    assert.equal(ctx.calls.saves, ctx.calls.restores);
    return ctx.calls.log.filter(([name, , , r]) => name === "arc" && r > 12 * 0.6).map(([, , , r]) => r / 12);
  };
  for (const t of [0.05, 0.2, 0.4, 0.6, 0.8, 0.95]) assert.ok(rings(t).every((size) => size >= 0.7 - 1e-9 && size <= 2.2 + 1e-9), `t ${t}: rings between .7 and 2.2 radii`);
  const [early] = rings(0.25), [late] = rings(0.55);
  assert.ok(early > late, `the first ring falls inward (${early.toFixed(2)} → ${late.toFixed(2)})`);
  assert.equal(rings(0.6).length, 2, "a second ring follows it in");
  const still = recordingContext();
  styles.arrival(still, "singularity", P, 12, TINT, 0.5, { alpha: 1, time: 0, still: true, theme });
  assert.equal(still.calls.stroke + still.calls.fill, 0, "reduced motion: no implosion");
  const select = (options) => { const ctx = recordingContext(); assert.equal(styles.select(ctx, "singularity", P, 12, TINT, { kind: "task", alpha: 1, detail: 3, theme, ...options }), true); return ctx; };
  const hover = select({ selected: true, hover: true, time: 0, still: false });
  assert.equal(hover.calls.stroke, 1, "hover: one ring");
  assert.ok(Math.abs(hover.calls.reach - 12 * 1.18) < 1.2, "at 1.18 radii");
  const chosen = select({ selected: true, chosen: true, time: 200, still: false });
  assert.equal(chosen.calls.stroke, 2, "chosen: the ring and a ripple");
  // The ripple leaves from outside the aura's lensing band (~1.26), so the
  // select ring, the band and the ripple never blur into one outline.
  for (let time = 0; time < 1300; time += 50) {
    const ripple = select({ selected: true, chosen: true, time, still: false }).calls.log.filter(([name]) => name === "arc").at(-1)[3] / 12;
    assert.ok(ripple >= 1.32 - 1e-9 && ripple <= 1.7 + 1e-9, `the ripple at ${ripple.toFixed(2)} radii`);
  }
  assert.notDeepEqual(plain(select({ selected: true, chosen: true, time: 900, still: false }).calls.log), plain(chosen.calls.log), "the ripple travels");
  assert.deepEqual(plain(select({ selected: true, chosen: true, time: 0, still: true }).calls.log), plain(select({ selected: true, chosen: true, time: 9000, still: true }).calls.log), "still: parked");
  const fading = select({ selected: false, time: 0, still: false, motion: { seed: 0.2, clock: 0, sel: 0.005, still: false } });
  assert.equal(fading.calls.stroke, 0, "nothing once the selection has faded out");
});

test("wires bend under gravity with motes falling into the target; far pens and the rail get only the cheap line", () => {
  const styles = loadNodeStyles();
  const a = { x: 20, y: 120 }, b = { x: 220, y: 40 };
  const base = { kind: "task", tint: TINT, alpha: 0.4, width: 1.2, dash: Object.freeze([2, 4]), march: true, double: false, active: false, inspected: false, curved: false, cp: null, far: false, time: 1000, still: false, seed: 0.3, rA: 8, rB: 10, detail: 3, lifetime: 1 };
  // One save/restore per edge: the alpha, stroke style, width, cap, dash and
  // its offset go back as they were.
  const wire = (extra = {}, from = a, to = b) => {
    const ctx = recordingContext({ center: to });
    ctx.globalAlpha = 0.9; ctx.lineCap = "butt"; ctx.strokeStyle = "#123456"; ctx.lineWidth = 2;
    assert.equal(styles.wire(ctx, "singularity", from, to, { ...base, ...extra }), true);
    assert.ok(ctx.calls.saves <= 1 && ctx.calls.saves === ctx.calls.restores);
    assert.deepEqual([ctx.globalAlpha, ctx.strokeStyle, ctx.lineWidth, ctx.lineCap, ctx.lineDashOffset, ctx.getLineDash()], [0.9, "#123456", 2, "butt", 0, []]);
    return ctx;
  };
  const quiet = wire();
  assert.equal(quiet.calls.quadraticCurveTo, 1, "a gravity-bent curve");
  assert.equal(quiet.calls.stroke, 2, "the line and its mote");
  assert.equal(quiet.calls.moveTo, 2, "one mote at rest");
  assert.equal(gradientsBuilt(quiet), 0, "wires build no gradients");
  assert.equal(quiet.calls.shadowBlurs.length, 0);
  assert.ok(quiet.calls.log.some(([name, value]) => name === "set:lineCap" && value === "round"), "round-capped motes");
  assert.equal(wire({ active: true }).calls.moveTo, 4, "three motes on an active wire");
  // The bend sags like a hanging line: the same curve whichever end it is
  // traced from, off the middle on the downhill side, most when level.
  const controlOf = (ctx) => ctx.calls.log.find(([name]) => name === "quadraticCurveTo").slice(1, 3);
  const control = controlOf(quiet), back = controlOf(wire({}, b, a));
  assert.ok(Math.abs(control[0] - back[0]) < 1e-6 && Math.abs(control[1] - back[1]) < 1e-6, "one curve both ways");
  const sag = (from, to) => { const [cx, cy] = controlOf(wire({ march: false, dash: Object.freeze([]) }, from, to)); return [cx - (from.x + to.x) / 2, cy - (from.y + to.y) / 2]; };
  const [, down] = sag(a, b);
  assert.ok(down > 0, "the bend sags downward");
  assert.ok(Math.abs(sag({ x: 0, y: 0 }, { x: 200, y: 0 })[1] - 26) < 1e-6, "a level wire sags most (.13 of its length at the control)");
  assert.deepEqual(sag({ x: 50, y: 0 }, { x: 50, y: 200 }).map((value) => Math.abs(value)), [0, 0], "a vertical wire hangs straight");
  // The many small wires stay one line at rest; the larger ones, the hub's,
  // a session's and an inspected wire carry their mote.
  assert.equal(wire({ detail: 1 }).calls.stroke, 1, "a quiet wire to a T1 node: the line alone");
  assert.equal(wire({ detail: 1, kind: "session" }).calls.stroke, 2, "a session's wire keeps its mote");
  assert.equal(wire({ detail: 1, inspected: true }).calls.stroke, 2, "so does an inspected one");
  // Motes follow the wire's own alpha (half as bright again), so dimming reads even.
  const moteAlpha = (alpha) => wire({ alpha }).calls.strokes.at(-1).alpha;
  assert.ok(Math.abs(moteAlpha(0.4) - 0.6) < 1e-12 && Math.abs(moteAlpha(0.08) - 0.12) < 1e-12, "a dimmed wire's mote dims with it");
  // Motes speed up into the target: a mote's step grows as it falls in.
  const moteAt = (time) => { const ctx = wire({ time }); const moves = ctx.calls.log.filter(([name]) => name === "lineTo"); return moves.at(-1).slice(1); };
  const gap = (t0, t1) => { const [x0, y0] = moteAt(t0), [x1, y1] = moteAt(t1); return Math.hypot(x1 - x0, y1 - y0); };
  const start = (0.02 - 0.3) * 2600; // u .02 for seed .3
  const early = gap(start + 2600 * 0.1, start + 2600 * 0.15), late = gap(start + 2600 * 0.85, start + 2600 * 0.9);
  assert.ok(late > early * 2, `the mote accelerates into the target (${early.toFixed(1)} → ${late.toFixed(1)} px)`);
  assert.equal(wire({ detail: 0 }).calls.stroke, 1, "a quiet wire to a T0 node (a todo) stays one line");
  assert.equal(wire({ detail: 0, active: true }).calls.moveTo, 4, "an active one still carries its motes");
  const far = wire({ far: true, active: true });
  assert.equal(far.calls.stroke, 1, "a far (blurred) pen draws the line alone");
  const s = wire({ curved: true, cp: { x1: 20, y1: 80, x2: 220, y2: 80 } });
  assert.equal(s.calls.bezierCurveTo, 1, "the tree's S-curve keeps its shape");
  assert.equal(wire({ double: true, dash: Object.freeze([]) }).calls.quadraticCurveTo, 2, "the hub's double line bends as a pair");
  const still = (time, active) => plain(wire({ still: true, march: false, time, active }).calls.log);
  assert.deepEqual(still(0, true), still(9000, true), "still: one frozen mote");
  assert.equal(wire({ still: true, active: false }).calls.stroke, 1, "still and quiet: the line alone");
  const rail = wire({ rail: true, dash: Object.freeze([]), march: false, detail: 2 });
  assert.equal(rail.calls.quadraticCurveTo, 1, "the rail bends every edge");
  assert.equal(rail.calls.stroke, 1, "at the cost of the line");
  assert.equal(wire({ rail: true, active: true, detail: 2 }).calls.moveTo, 3, "motes only on the rail's active edges (two)");
  const tetherLike = recordingContext();
  assert.equal(styles.wire(tetherLike, "singularity", a, b, { ...base, tint: null }), false, "no tint: the caller's own line");
});

test("a pulse accelerates along the bend and spirals round its target; the landing implodes; the rail keeps its own pulses", () => {
  const styles = loadNodeStyles();
  const from = { x: 20, y: 150 }, to = { x: 260, y: 40 };
  const pulse = { color: "#b9b0ff", glow: "#b9b0ff", small: false, packet: false, wave: false, start: 0, duration: 900 };
  const surge = (t, extra = {}, ctx = recordingContext({ center: to })) => { assert.equal(styles.surge(ctx, "singularity", from, to, t, pulse, { kind: "dot", time: t * 900, still: false, rTo: 10, detail: 3, pulse, motion: null, ...extra }), true); return ctx; };
  const head = (ctx) => { const arc = ctx.calls.log.filter(([name]) => name === "arc").at(-1); return { x: arc[1], y: arc[2] }; };
  const warm = recordingContext({ center: to });
  surge(0.5, {}, warm);
  const built = gradientsBuilt(warm);
  assert.equal(built, 1, "one cached spark glow per pulse colour");
  for (const t of [0.1, 0.6, 0.9, 0.99]) surge(t, {}, warm);
  assert.equal(gradientsBuilt(warm), built, "no gradient per frame");
  assert.equal(warm.calls.shadowBlurs.length, 0, "no shadowBlur");
  assert.equal(warm.calls.saves, warm.calls.restores);
  const step = (t0, t1) => { const p0 = head(surge(t0)), p1 = head(surge(t1)); return Math.hypot(p1.x - p0.x, p1.y - p0.y); };
  assert.ok(step(0.6, 0.7) > step(0.1, 0.2) * 2, "the spark speeds up as it falls (t²)");
  const angle = (t) => { const p = head(surge(t)); return Math.atan2(p.y - to.y, p.x - to.x); };
  const distance = (t) => { const p = head(surge(t)); return Math.hypot(p.x - to.x, p.y - to.y); };
  assert.ok(distance(0.85) <= 10 * 1.9 + 4 + 1e-6 && distance(0.99) < 10 * 0.8, "over the last 15% it closes in on the horizon");
  let swept = Math.abs(angle(0.99) - angle(0.86));
  if (swept > Math.PI) swept = 2 * Math.PI - swept;
  assert.ok(swept > 1.5, `spiralling round it (${swept.toFixed(2)} rad)`);
  const wave = surge(0.5, { kind: "wave" });
  assert.ok(wave.calls.quadraticCurveTo >= 1, "a wave pulse warms its bent path");
  // A pulse that runs against a wire's direction (a satellite into the hub,
  // a node back to the root) rides the wire drawn the other way.
  const drawn = recordingContext();
  styles.wire(drawn, "singularity", from, to, { kind: "task", tint: [185, 176, 255], alpha: 0.4, width: 1, dash: Object.freeze([]), time: 0, still: false, seed: 0.3, detail: 3 });
  const [cx, cy] = drawn.calls.log.find(([name]) => name === "quadraticCurveTo").slice(1, 3);
  const curve = [];
  for (let k = 0; k <= 2000; k += 1) { const s = k / 2000, r = 1 - s; curve.push([r * r * from.x + 2 * r * s * cx + s * s * to.x, r * r * from.y + 2 * r * s * cy + s * s * to.y]); }
  const offWire = (point) => Math.min(...curve.map(([x, y]) => Math.hypot(x - point.x, y - point.y)));
  const backward = (t, extra = {}) => { const ctx = recordingContext({ center: from }); styles.surge(ctx, "singularity", to, from, t, pulse, { kind: "dot", time: t * 900, still: false, rTo: 10, detail: 3, pulse, motion: null, ...extra }); return ctx; };
  for (const t of [0.05, 0.2, 0.4, 0.6, 0.8]) {
    const miss = offWire(head(backward(t)));
    assert.ok(miss < 1.5, `t ${t}: a pulse against the wire stays on it (${miss.toFixed(2)} px off)`);
  }
  const warmPath = backward(0.5, { kind: "wave" }).calls.log.find(([name]) => name === "quadraticCurveTo").slice(1, 3);
  assert.ok(Math.abs(warmPath[0] - cx) < 1e-6 && Math.abs(warmPath[1] - cy) < 1e-6, "and a wave warms the same curve");
  assert.equal(surge(1, { still: true }).calls.stroke, 1, "reduced motion: one static flash of the path");
  const rail = recordingContext();
  assert.equal(styles.surge(rail, "singularity", from, to, 0.5, pulse, { kind: "dot", time: 0, still: false, rTo: 6, pulse, motion: null, detail: 2, rail: true }), false, "the rail keeps its own pulse");
  assert.equal(rail.calls.log.length, 0);
  // The landing: one ring falling into the horizon; nothing under reduced motion.
  const radii = [0.2, 0.5, 0.8].map((u) => { const ctx = recordingContext(); assert.equal(styles.land(ctx, "singularity", to, 10, [185, 176, 255], u, { kind: "dot", time: 0, still: false, rTo: 10 }), true); assert.equal(gradientsBuilt(ctx), 0); assert.equal(ctx.calls.stroke, 1); return ctx.calls.log.find(([name]) => name === "arc")[3]; });
  assert.ok(radii[0] > radii[1] && radii[1] > radii[2] && radii[0] <= 10 * 1.9, "an implosion ring");
  const stillLand = recordingContext();
  assert.equal(styles.land(stillLand, "singularity", to, 10, [185, 176, 255], 1, { still: true, rail: true }), true);
  assert.equal(stillLand.calls.log.length, 0);
});
