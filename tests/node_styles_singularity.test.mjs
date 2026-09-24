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
    // (on a pale page the disc is lit in the tint deepened a third of the
    // way to the ink: a quiet hole there is a black core in a coloured ring,
    // never a grey planet)
    const disc = palette === VOID ? TINT : TINT.map((channel, index) => Math.round(channel + ([12, 14, 20][index] - channel) * 0.35));
    assert.equal(doppler.stops.find(([offset]) => offset === 0.1)[1], `rgba(${disc.join(",")},1)`, "the disc wears the state's own colour");
    assert.ok(gap(far, disc) < gap(far, accent) / 2, `the receding side is the tint's (${far})`);
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
  // T0 at rest: the horizon, its ring, the disc in one path and the spot;
  // lit, the aura too. T1 keeps the far half's Doppler light alone.
  const POSE = {
    4.5: { quiet: [2, 1, 2, 2, 2], working: [2, 2, 2, 3, 2], chosen: [2, 2, 2, 3, 2] },
    7: { quiet: [2, 11, 0, 5, 1], working: [7, 11, 0, 6, 2], chosen: [2, 11, 0, 5, 1] },
    9.5: { quiet: [4, 11, 0, 7, 3], working: [9, 11, 0, 8, 3], chosen: [4, 11, 0, 7, 3] },
    12: { quiet: [5, 11, 0, 7, 3], working: [14, 11, 0, 8, 4], chosen: [5, 11, 0, 7, 3] },
  };
  const BUDGETS = {
    4.5: { quiet: [2, 1, 2, 2, 2], working: [2, 2, 2, 3, 2], chosen: [2, 2, 2, 3, 2] },
    7: { quiet: [2, 11, 0, 5, 1], working: [8, 11, 0, 6, 3], chosen: [2, 11, 0, 5, 1] },
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
  // T0 is a tiny ringed planet: no conic, no sparks, no jets, the visible
  // disc in one path (one chord along the horizon's edge), one hot spot.
  const tiny = recordingContext({ conic: true });
  paint(styles, tiny, 4.5, { active: true });
  assert.equal(tiny.calls.rotate, 0, "nothing turns under the transform");
  assert.equal(tiny.calls.log.filter(([name]) => name === "scale").length, 0, "the disc is ellipses: no squashing transform");
  assert.equal(tiny.calls.ellipse, 2, "the disc's outer and inner edges");
  assert.equal(tiny.calls.lineTo, 2, "a chord along the horizon and one hot spot riding the disc");
  const flat = tiny.calls.log.filter(([name, value]) => name === "set:fillStyle" && String(value).startsWith("grad:"));
  assert.ok(flat.every(([, value]) => !String(value).startsWith("grad:conic")), "under 6 px the Doppler light is a flat left-to-right paint, no conic");
});

test("a todo-sized hole wears its state's colour: its ring in the disc's tone, the white-hot spot only while lit", () => {
  const styles = loadNodeStyles();
  const theme = styles.theme(VOID);
  const pens = (tint, options = {}) => {
    const ctx = recordingContext();
    styles.paint(ctx, "singularity", P, 4, tint, { kind: "todo", detail: 0, theme, ...options });
    return ctx.calls.strokes.map(({ style }) => style);
  };
  const chroma = (text) => { const [r, g, b] = text.match(/[\d.]+/g).slice(0, 3).map(Number); return Math.max(r, g, b) - Math.min(r, g, b); };
  for (const tint of [[104, 236, 164], [255, 212, 121]]) {
    const [ring, spot] = pens(tint);
    assert.ok(chroma(ring) >= 0.6 * chroma(`rgb(${tint})`), `the ring keeps the state's hue (${ring})`);
    assert.equal(spot ?? ring, ring, "at rest the spot shares the ring's pen");
    const lit = pens(tint, { active: true });
    assert.ok(lit.length >= 2 && chroma(lit.at(-1)) < chroma(ring), "lit, the spot burns white-hot");
  }
  assert.notEqual(pens([104, 236, 164])[0], pens([255, 212, 121])[0], "a done and a blocked todo are told apart");
  // The flat light keeps the beam to its very edge (the disc is the state's colour).
  const ctx = recordingContext();
  styles.paint(ctx, "singularity", P, 4, [104, 236, 164], { kind: "todo", detail: 0, theme });
  const flat = ctx.calls.gradients.find(({ kind, args }) => kind === "linear" && args[0] === -1.08);
  assert.deepEqual(plain(flat.stops.map(([offset]) => offset)), [0, 0.08, 0.2, 0.5, 0.8, 1]);
});

test("a steady node costs few canvas operations: 23 at T0 at rest (most of a board's todos), and fixed ceilings above it", () => {
  const styles = loadNodeStyles();
  // Every call and property set of one warm paint, the dispatcher's save,
  // alpha and restore included; the ceiling over 150 animated frames. A T0
  // node draws its aura only while lit.
  // (a lit T0 node's hot spot turns white-hot: one pen more than at rest)
  const CEILINGS = { 4.5: { quiet: 23, working: 29, chosen: 29 }, 7: { quiet: 49, working: 74, chosen: 49 }, 9.5: { quiet: 74, working: 88, chosen: 74 }, 12: { quiet: 78, working: 101, chosen: 78 } };
  for (const [radius, ceiling] of Object.entries(CEILINGS)) {
    for (const [state, flags] of Object.entries({ quiet: {}, working: { active: true }, chosen: { selected: true, chosen: true }, glyph: { kind: "agent", glyph: true, active: true } })) {
      const live = record(styles, { active: flags.active === true, selected: flags.selected === true });
      const ctx = recordingContext();
      paint(styles, ctx, Number(radius), { ...flags, motion: live.motion, time: live.flags.time });
      const spot = new Set();
      let most = 0;
      for (let frame = 0; frame < 150; frame += 1) {
        const time = live.step();
        const from = ctx.calls.log.length;
        paint(styles, ctx, Number(radius), { ...flags, motion: live.motion, time });
        const log = ctx.calls.log.slice(from);
        most = Math.max(most, log.length);
        if (Number(radius) < 6) spot.add(log.filter(([name]) => name === "lineTo").length === 2 ? "shown" : "hidden");
      }
      assert.equal(most, ceiling[state === "glyph" ? "working" : state], `r ${radius} ${state}: the ceiling of canvas operations`);
      if (Number(radius) < 6) assert.deepEqual([...spot].sort(), ["hidden", "shown"], "the T0 spot rides round the disc and hides behind the horizon");
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
  assert.equal(warm, 8, "eight unit-space paints per canvas, tint and theme (two conic, and T0's flat Doppler light)");
  for (const time of [33, 400, 5000, 99999]) {
    live.step();
    paint(styles, ctx, 12, { active: true, motion: live.motion, time, theme });
    paint(styles, ctx, 9, { selected: true, chosen: true, motion: live.motion, time, theme, alpha: 0.4 });
    paint(styles, ctx, 4.5, { time, theme });
  }
  assert.equal(gradientsBuilt(ctx), warm, "moving, resizing, lighting and dimming reuse the same paints");
  paint(styles, ctx, 12, { theme }, other);
  const withOther = gradientsBuilt(ctx);
  assert.equal(withOther, warm + 8, "another tint builds its own paints once");
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
      // Each arc's radius on screen (the frame's scale when it was traced).
      const screen = [];
      const arc = ctx.arc.bind(ctx);
      ctx.arc = (x, y, r, ...rest) => { const [a, b] = ctx.matrix(); screen.push(r * Math.hypot(a, b)); return arc(x, y, r, ...rest); };
      paint(styles, ctx, radius, { kind: "assistant", theme });
      const log = plain(ctx.calls.log);
      // The horizon is the arc filled right after a pure-black or core fill style is set.
      const fillAt = log.findIndex(([name, value]) => name === "set:fillStyle" && (value === "rgba(2,1,5,1)" || String(value).includes("0 rgba(2,1,5,1)")));
      const size = screen[log.slice(0, fillAt).filter(([name]) => name === "arc").length - 1];
      assert.ok(size >= Math.min(6.45, 1.7 * radius) - 1e-6, `r ${radius}: a ${size.toFixed(1)} px horizon under the M`);
      assert.ok(size <= 1.7 * radius + 1e-9, "never past 1.7 radii");
      if (radius >= 12.5) assert.ok(Math.abs(size - 0.52 * radius) < 1e-9, "a full-size hub keeps the .52 horizon");
      assert.equal(ctx.calls.texts[0].text, "M");
    }
  }
});

test("every layer follows the caller's alpha, on both themes and without conic gradients", () => {
  const styles = loadNodeStyles();
  for (const palette of [VOID, LIGHT]) for (const conic of [true, false]) for (const flags of [{}, { active: true }, { kind: "agent", glyph: true, active: true }]) for (const radius of [4.5, 12]) {
    const live = record(styles, { active: flags.active === true });
    live.motion.kick = 0.6;
    const full = recordingContext({ conic }), dimmed = recordingContext({ conic });
    const theme = styles.theme(palette);
    paint(styles, full, radius, { ...flags, alpha: 1, motion: live.motion, time: 700, theme });
    paint(styles, dimmed, radius, { ...flags, alpha: 0.3, motion: live.motion, time: 700, theme });
    const a = full.calls.alphas, b = dimmed.calls.alphas;
    assert.equal(a.length, b.length);
    assert.ok(b.every((alpha, index) => alpha > 0 && alpha <= 0.3 + 1e-12 && Math.abs(alpha - 0.3 * a[index]) < 1e-12), "each layer at a gain of the caller's alpha, never above it");
    assert.ok(b.includes(0.3), "the horizon at exactly the caller's alpha");
  }
});

test("nothing jumps at the T0/T1 cut: the aura keeps its size and level, the disc its light, as a node grows past 6 px", () => {
  const styles = loadNodeStyles();
  // The aura's fill (its paint, alpha, arc and the frame's scale) and the
  // Doppler level, just under and just over 6 px, lit and kicked.
  const auraOf = (radius, flags, kick) => {
    const live = record(styles, { active: flags.active === true, selected: flags.selected === true, still: true });
    live.motion.kick = kick; live.motion.still = false;
    const ctx = recordingContext();
    const found = [];
    const arc = ctx.arc.bind(ctx);
    ctx.arc = (x, y, r, ...rest) => { const [a, b] = ctx.matrix(); found.push({ r, scale: Math.hypot(a, b), alpha: ctx.globalAlpha }); return arc(x, y, r, ...rest); };
    paint(styles, ctx, radius, { ...flags, motion: live.motion, time: 0 });
    const aura = found.find(({ r }) => Math.abs(r - 1.36) < 1e-9);
    // T0's flat Doppler paint, or the conic above it.
    const disc = ctx.calls.fills.find(({ style }) => /^grad:conic|^grad:linear#\d+\(-1\.08,0,1\.08,0\)/.test(String(style)));
    return { screen: aura ? aura.r * aura.scale : 0, alpha: aura ? aura.alpha : 0, disc: disc ? disc.alpha : 0 };
  };
  for (const [flags, kick] of [[{ selected: true, chosen: true }, 0], [{ active: true }, 0], [{ selected: true }, 0.5]]) {
    const below = auraOf(5.999, flags, kick), above = auraOf(6.001, flags, kick);
    assert.ok(below.screen > 0 && Math.abs(below.screen - above.screen) < 0.02, `the aura's reach holds (${below.screen.toFixed(3)} → ${above.screen.toFixed(3)} px)`);
    assert.ok(Math.abs(below.alpha - above.alpha) < 0.01, `and its level (${below.alpha.toFixed(3)} → ${above.alpha.toFixed(3)})`);
    assert.ok(Math.abs(below.disc - above.disc) < 0.01, `the disc's light holds (${below.disc.toFixed(3)} → ${above.disc.toFixed(3)})`);
  }
  // At rest a T0 node wears no aura, and one just past 6 px barely any: it
  // fades in over the tier's first 1.2 px.
  assert.equal(auraOf(5.5, {}, 0).alpha, 0, "a quiet T0 node: no aura");
  assert.ok(auraOf(6.05, {}, 0).alpha < 0.04 && auraOf(7.3, {}, 0).alpha > 0.69, "a quiet one fades its in from 6 to 7.2 px");
});

// ===== the pack's hooks =====

test("the status ring: a spark on a tilted ellipse while running; queued, error and done keep their colours and badges", () => {
  const styles = loadNodeStyles();
  const theme = styles.theme(VOID);
  const live = record(styles, { active: true, id: "agent:watcher" });
  const ring = (status, extra = {}) => { const ctx = recordingContext(); ctx.globalAlpha = 0.9; assert.equal(styles.ring(ctx, "singularity", P, 10, TINT, { status, builder: false, ring: 14, time: live.flags.time, still: false, detail: 3, motion: live.motion, theme, ...extra }), true); assert.equal(ctx.calls.saves, ctx.calls.restores); assert.equal(ctx.globalAlpha, 0.9); return ctx; };
  // The ellipse's arcs, the tail's strokes and the head, as drawn.
  const parts = (ctx) => {
    const log = plain(ctx.calls.log);
    const arcs = log.filter(([name, x, y, r]) => name === "arc" && x === 0 && y === 0 && r === 1).map(([, , , , from, to]) => [from, to]);
    return { arcs, tail: log.filter(([name]) => name === "lineTo").length, heads: ctx.calls.fill };
  };
  const running = ring("running");
  const drawn = parts(running);
  assert.deepEqual(drawn.arcs.map(([from, to]) => [Number(from.toFixed(6)), Number(to.toFixed(6))]), [[3.141593, 6.283185], [0, 3.141593]], "the ellipse in two halves: the far one behind the hole, then the near one");
  const halves = running.calls.strokes.slice(0, 2).map(({ alpha }) => alpha);
  assert.ok(Math.abs(halves[0] - halves[1] / 2) < 1e-12 && Math.abs(halves[1] - 0.9 * 0.3) < 1e-12, `the far half at half the near half's alpha (${halves})`);
  assert.equal(running.calls.stroke, 2 + drawn.tail, "and a tail of up to three segments");
  assert.ok(drawn.tail <= 3 && drawn.heads <= 1, "one spark");
  assert.ok(running.calls.alphas.every((alpha) => alpha <= 0.9 + 1e-12), "never above the caller's alpha");
  live.step(3);
  assert.notDeepEqual(plain(ring("running").calls.log), plain(running.calls.log), "the spark orbits");
  const small = ring("running", { detail: 1 });
  assert.equal(parts(small).arcs.length, 1, "a small node's ellipse is one stroke");
  assert.ok(parts(small).tail <= 1, "and keeps one tail segment");
  const queued = ring("queued");
  assert.deepEqual(plain(queued.calls.log.find(([name]) => name === "setLineDash")), ["setLineDash", 2, 3], "queued: a dashed ellipse");
  // A small agent's queued ring opens up (rounder, longer dashes; a heavier
  // line on a pale page) so it reads as a ring, not as specks.
  const squashOf = (ctx) => { const scale = plain(ctx.calls.log).find(([name]) => name === "scale"); return scale[2] / scale[1]; };
  const queuedSmall = ring("queued", { detail: 1 });
  assert.deepEqual(plain(queuedSmall.calls.log.find(([name]) => name === "setLineDash")), ["setLineDash", 3, 2.5]);
  assert.ok(Math.abs(squashOf(queuedSmall) - 0.55) < 1e-9 && Math.abs(squashOf(queued) - 0.4) < 1e-9, "rounder when small");
  assert.deepEqual([queuedSmall.calls.strokes[0].width, ring("queued", { detail: 1, theme: styles.theme(LIGHT) }).calls.strokes[0].width], [1, 1.2], "a heavier line on a pale page");
  const error = ring("error");
  assert.ok(error.calls.strokes.some(({ style }) => style === "rgba(255,212,121,1)"), "error: the theme's amber ellipse");
  assert.deepEqual(error.calls.texts.map(({ text }) => text), ["!"], "and its badge");
  const done = ring("done");
  assert.ok(done.calls.strokes.some(({ style }) => style === "rgba(104,236,164,1)") && done.calls.lineTo === 2, "done: a green tick badge");
  // The badges sit in dark wells on every theme, so the "!" and the tick
  // read on a pale page too, and the error ellipse holds against it.
  const contrast = (one, two) => {
    const lum = (text) => { const channel = text.match(/[\d.]+/g).slice(0, 3).map((value) => { const c = Number(value) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * channel[0] + 0.7152 * channel[1] + 0.0722 * channel[2]; };
    const [a, b] = [lum(one), lum(two)].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
  };
  for (const palette of [LIGHT, VOID]) {
    const bg = palette === LIGHT ? "rgba(243,240,232,1)" : "rgba(3,2,8,1)";
    const paleError = ring("error", { theme: styles.theme(palette) }), paleDone = ring("done", { theme: styles.theme(palette) });
    const errorWell = paleError.calls.fills[0].style, doneWell = paleDone.calls.fills[0].style;
    assert.ok(contrast(paleError.calls.texts[0].ink, errorWell) >= 4.5, `the "!" reads in its well (${contrast(paleError.calls.texts[0].ink, errorWell).toFixed(1)}:1)`);
    const tick = paleDone.calls.strokes.at(-1).style;
    assert.ok(contrast(tick, doneWell) >= 4.5, `the tick reads in its well (${contrast(tick, doneWell).toFixed(1)}:1)`);
    const ellipse = paleError.calls.strokes.find(({ width }) => width === 1.4).style;
    assert.ok(contrast(ellipse, bg) >= 3, `the error ellipse holds against the page (${contrast(ellipse, bg).toFixed(1)}:1)`);
  }
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
  // The ellipse's far half, which crosses the top of the horizon, at half
  // the near half's alpha (above T1).
  const halves = plain(orbit.calls.log).filter(([name, x, y, r]) => name === "arc" && x === 0 && y === 0 && r === 1).map(([, , , , from, to]) => [Number(from.toFixed(4)), Number(to.toFixed(4))]);
  assert.deepEqual(halves, [[3.1416, 6.2832], [0, 3.1416]], "the orbit's ellipse in two halves");
  assert.ok(Math.abs(orbit.calls.strokes[0].alpha * 2 - orbit.calls.strokes[1].alpha) < 1e-12, "the far one at half alpha");
  // Behind the hole a comet is gone within .55 radii of its centre (the
  // black horizon hides it), whatever the phase.
  let hidden = 0, shown = 0;
  for (let phase = 0; phase < 6.28; phase += 0.05) {
    const ctx = recordingContext();
    styles.orbit(ctx, "singularity", P, 12, TINT, { running: false, phase, ring: 14, time: 0, still: true, detail: 3, motion: null, theme });
    const log = plain(ctx.calls.log);
    const tilt = log.find(([name]) => name === "rotate")[1];
    const head = log.filter(([name, , , r]) => name === "arc" && r === 1.4).at(-1);
    if (!head || !ctx.calls.fill) { hidden += 1; continue; }
    shown += 1;
    const dx = head[1] - P.x, dy = head[2] - P.y;
    const behind = -dx * Math.sin(tilt) + dy * Math.cos(tilt) < -1e-9;
    assert.ok(!behind || Math.hypot(dx, dy) >= 12 * 0.55 - 1e-9, `phase ${phase.toFixed(2)}: no head on the black behind the hole (${Math.hypot(dx, dy).toFixed(2)} px out)`);
  }
  assert.ok(hidden > 0 && shown > hidden, `a tight orbit's comet hides behind the horizon for part of its turn (${hidden} of ${hidden + shown})`);
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
  assert.equal(rings(0.6).length, 2, "a second ring follows the first in");
  // The caller grows the node while this runs (idle.js: easeOutBack over
  // the 650 ms); on screen each ring only ever falls inward, from where it
  // shows to where it lands, and never past 2.25 final radii.
  const grow = (t) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
  const screen = [[], []];
  for (let k = 1; k < 200; k += 1) {
    const t = k / 200, radius = 12 * Math.max(0.01, grow(t));
    const ctx = recordingContext();
    styles.arrival(ctx, "singularity", P, radius, TINT, t, { alpha: 1, time: 0, still: false, theme });
    // The rings are the strokes in the lensing ink, first ring first.
    const log = plain(ctx.calls.log);
    const arcs = log.filter(([name, x, y, r, from, to]) => name === "arc" && x === P.x && y === P.y && r > radius * 0.6 && to - from > 6);
    const gains = ctx.calls.strokes.filter(({ width }) => width === 1.5 || width === 1).map(({ width }) => width === 1.5 ? 0 : 1);
    arcs.forEach(([, , , r], index) => { if (gains[index] !== undefined) screen[gains[index]].push([t, r / 12]); });
  }
  for (const [index, ring] of screen.entries()) {
    assert.ok(ring.length > 40, `ring ${index + 1} shows over the grow`);
    for (let k = 1; k < ring.length; k += 1) assert.ok(ring[k][1] <= ring[k - 1][1] + 1e-9, `ring ${index + 1} at t ${ring[k][0].toFixed(3)}: ${ring[k - 1][1].toFixed(3)} → ${ring[k][1].toFixed(3)} final radii, never outward`);
    assert.ok(ring[0][1] <= 2.25 && ring.at(-1)[1] < 0.9, `ring ${index + 1} falls from ${ring[0][1].toFixed(2)} to ${ring.at(-1)[1].toFixed(2)} final radii`);
  }
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
  // No save/restore per edge: the alpha, cap, dash and its offset are set
  // back by hand (every alpha a gain on the caller's).
  const wire = (extra = {}, from = a, to = b) => {
    const ctx = recordingContext({ center: to });
    ctx.globalAlpha = 0.9; ctx.lineCap = "butt"; ctx.strokeStyle = "#123456"; ctx.lineWidth = 2;
    assert.equal(styles.wire(ctx, "singularity", from, to, { ...base, ...extra }), true);
    assert.equal(ctx.calls.saves, 0, "no save per edge");
    assert.deepEqual([ctx.globalAlpha, ctx.lineCap, ctx.lineDashOffset, ctx.getLineDash()], [0.9, "butt", 0, []]);
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
  // Motes follow the wire's own alpha (half as bright again), so dimming
  // reads even (and the canvas's: wire() hands them a pen at .9).
  const moteAlpha = (alpha) => wire({ alpha }).calls.strokes.at(-1).alpha;
  assert.ok(Math.abs(moteAlpha(0.4) - 0.9 * 0.6) < 1e-12 && Math.abs(moteAlpha(0.08) - 0.9 * 0.12) < 1e-12, "a dimmed wire's mote dims with it");
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

test("wires, pulses and landings follow the caller's alpha, and keep their hue on a pale page", () => {
  const styles = loadNodeStyles();
  const a = { x: 20, y: 120 }, b = { x: 220, y: 40 };
  const wireO = { kind: "task", tint: TINT, alpha: 0.4, width: 1, dash: Object.freeze([2, 4]), march: true, flow: true, active: true, inspected: false, curved: false, cp: null, far: false, time: 1000, still: false, seed: 0.3, rA: 8, rB: 10, detail: 3, lifetime: 1 };
  const pulse = { color: "#f1dcae", glow: "#e6c98d", wave: false, small: false, packet: true, start: 0, duration: 900 };
  const look = { kind: "dot", time: 1000, still: false, rTo: 10, detail: 3, pulse, motion: null, cp: null };
  const draws = {
    wire: (ctx, theme) => styles.wire(ctx, "singularity", a, b, { ...wireO, theme }),
    surge: (ctx, theme) => styles.surge(ctx, "singularity", a, b, 0.6, pulse, { ...look, theme }),
    land: (ctx, theme) => styles.land(ctx, "singularity", b, 10, [241, 220, 174], 0.4, { ...look, theme, pulse: { ...pulse, _holeAngle: 1, _holeDir: 1 } }),
  };
  for (const [hook, draw] of Object.entries(draws)) {
    const full = recordingContext(), dim = recordingContext();
    dim.globalAlpha = 0.4;
    draw(full, null); draw(dim, null);
    assert.ok(full.calls.alphas.length > 0 && dim.calls.alphas.length === full.calls.alphas.length, `${hook}: the same marks`);
    assert.ok(dim.calls.alphas.every((alpha, index) => Math.abs(alpha - 0.4 * full.calls.alphas[index]) < 1e-9), `${hook}: every alpha scales with the caller's (${full.calls.alphas} vs ${dim.calls.alphas})`);
    assert.equal(dim.globalAlpha, 0.4, `${hook}: and the canvas gets its own back`);
  }
  // On a pale page: the wire and its motes, the pulse and its landing in the
  // colour deepened as far as it needs; the head 3:1 or more on the page, no
  // pale haze, a tether at least 1.2 px.
  const light = styles.theme(LIGHT);
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lum = (text) => { const [r, g, bl] = text.match(/[\d.]+/g).slice(0, 3).map(Number); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(bl); };
  const ratio = (x, y) => (Math.max(lum(x), lum(y)) + 0.05) / (Math.min(lum(x), lum(y)) + 0.05);
  const page = "rgb(243,240,232)";
  const surge = recordingContext();
  draws.surge(surge, light);
  assert.equal(gradientsBuilt(surge), 0, "no haze sprite on a pale page");
  const head = surge.calls.fills.at(-1);
  assert.ok(head.alpha >= 0.9 && ratio(head.style, page) >= 3, `the head ${head.style} reads ${ratio(head.style, page).toFixed(2)}:1 on the page`);
  const wired = recordingContext();
  draws.wire(wired, light);
  assert.ok(wired.calls.strokes.every(({ style }) => !style.startsWith(`rgba(${TINT.join(",")},`)), "the wire and its motes deepen on a pale page");
  const tether = recordingContext();
  styles.wire(tether, "singularity", a, b, { ...wireO, kind: "tether", width: 1, theme: light });
  assert.ok(tether.calls.strokes[0].width >= 1.2, "a tether is at least 1.2 px on a pale page");
});

test("a pulse accelerates along the bend and is captured by its target without braking; the landing implodes and swirls; the rail's ride the bent edge", () => {
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
  // The capture: a 30 Hz frame of the pulse at a time over its last
  // quarter, the head never brakes (each step at least .9 of the one
  // before), turns at most 30° a frame, and ends inside the target's photon
  // ring; how far it curls round the target is what its frames allow: a
  // fast pulse dives in with a hook, a slow short one curls round.
  const frames = (a, b, rTo, duration) => {
    const own = { ...pulse, duration };
    const at = (t) => { const ctx = recordingContext(); styles.surge(ctx, "singularity", a, b, t, own, { kind: "dot", time: t * duration, still: false, rTo, detail: 3, pulse: own, motion: null }); return head(ctx); };
    const points = [];
    for (let k = Math.round(duration / 33.3 / 4); k >= 0; k -= 1) points.push(at(1 - k * 33.3 / duration));
    const around = (point) => Math.atan2(point.y - b.y, point.x - b.x);
    let sweep = Math.abs(around(points.at(-1)) - around(at(0.7)));
    if (sweep > Math.PI) sweep = 2 * Math.PI - sweep;
    return { points, sweep, pulse: own };
  };
  const sweeps = [];
  for (const [a, b, rTo, duration] of [[{ x: 100, y: 300 }, { x: 400, y: 200 }, 10, 1000], [from, to, 10, 900], [to, from, 10, 900], [{ x: 20, y: 400 }, { x: 560, y: 60 }, 14, 1400], [{ x: 200, y: 200 }, { x: 262, y: 180 }, 8, 1600], [{ x: 100, y: 100 }, { x: 140, y: 150 }, 5, 520]]) {
    const { points, sweep } = frames(a, b, rTo, duration);
    const steps = points.slice(1).map((point, k) => [point.x - points[k].x, point.y - points[k].y]);
    for (let k = 1; k < steps.length; k += 1) {
      const before = Math.hypot(...steps[k - 1]), after = Math.hypot(...steps[k]);
      assert.ok(after >= 0.9 * before, `${b.x},${b.y} frame ${k}: the head never brakes (${before.toFixed(1)} → ${after.toFixed(1)} px)`);
      let turn = Math.abs(Math.atan2(steps[k][1], steps[k][0]) - Math.atan2(steps[k - 1][1], steps[k - 1][0]));
      if (turn > Math.PI) turn = 2 * Math.PI - turn;
      assert.ok(turn <= Math.PI / 6 + 1e-9, `${b.x},${b.y} frame ${k}: it turns ${(turn * 180 / Math.PI).toFixed(1)}° (≤ 30°)`);
    }
    const end = points.at(-1);
    assert.ok(Math.hypot(end.x - b.x, end.y - b.y) <= rTo * 0.55 + 1e-6, "and falls into the horizon");
    sweeps.push(sweep);
  }
  assert.ok(sweeps[4] > 0.6 && sweeps[4] > 3 * sweeps[0], `a slow short pulse curls round its target (${(sweeps[4] * 180 / Math.PI).toFixed(0)}°), a fast long one dives in (${(sweeps[0] * 180 / Math.PI).toFixed(0)}°)`);
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
  // The rail's pulses ride the bent edge all the way: smaller, no glow, no capture.
  const railAt = (t) => { const ctx = recordingContext(); assert.equal(styles.surge(ctx, "singularity", from, to, t, pulse, { kind: "dot", time: t * 900, still: false, rTo: 6, pulse, motion: null, detail: 2, rail: true }), true); return ctx; };
  for (const t of [0.2, 0.5, 0.8, 0.95, 1]) {
    const ctx = railAt(t);
    assert.equal(gradientsBuilt(ctx), 0, "no glow sprite on the rail");
    const core = ctx.calls.log.filter(([name]) => name === "arc").at(-1);
    assert.ok(Math.abs(core[3] - 0.6 * 1.7) < 1e-9, "a smaller head");
    const miss = offWire({ x: core[1], y: core[2] });
    assert.ok(miss < 1.5, `t ${t}: on the bent edge (${miss.toFixed(2)} px off)`);
  }
  // The landing: one ring falling into the horizon, and, after a pulse the
  // capture handed over, the spark swirling once round the hole just
  // outside its disc, from where it went in and the way it was turning.
  const radii = [0.2, 0.5, 0.8].map((u) => { const ctx = recordingContext(); assert.equal(styles.land(ctx, "singularity", to, 10, [185, 176, 255], u, { kind: "dot", time: 0, still: false, rTo: 10 }), true); assert.equal(gradientsBuilt(ctx), 0); assert.equal(ctx.calls.stroke, 1); return ctx.calls.log.find(([name]) => name === "arc")[3]; });
  assert.ok(radii[0] > radii[1] && radii[1] > radii[2] && radii[0] <= 10 * 1.9, "an implosion ring");
  const landed = frames(from, to, 10, 900).pulse;
  assert.ok(Number.isFinite(landed._holeAngle) && Math.abs(landed._holeDir) === 1, "the capture keeps its entry on the pulse");
  let previous = null, turned = 0;
  for (let k = 1; k < 12; k += 1) {
    const u = k * 33.3 / 380, ctx = recordingContext();
    styles.land(ctx, "singularity", to, 10, [185, 176, 255], Math.min(1, u), { kind: "dot", time: 0, still: false, rTo: 10, pulse: landed });
    const swirl = plain(ctx.calls.log).filter(([name]) => name === "arc")[1];
    if (u >= 1) { assert.equal(swirl, undefined, "gone once it has landed"); continue; }
    assert.ok(swirl[3] >= 10 * 1.05 - 1e-9 && swirl[3] <= 10 * 1.5 + 1e-9, `the swirl stays outside the disc (${(swirl[3] / 10).toFixed(2)} radii)`);
    const lead = landed._holeDir > 0 ? swirl[5] : swirl[4];
    if (previous !== null) { assert.ok((lead - previous) * landed._holeDir > 0, "it turns the way the pulse came in"); turned += Math.abs(lead - previous); }
    previous = lead;
  }
  assert.ok(turned > 4, `about a turn round the hole (${turned.toFixed(1)} rad)`);
  const stillLand = recordingContext();
  assert.equal(styles.land(stillLand, "singularity", to, 10, [185, 176, 255], 1, { still: true, rail: true }), true);
  assert.equal(stillLand.calls.log.length, 0);
});
