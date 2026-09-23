// Sigil (renderer/node-styles.js, the `style: sigil` section): a hex seal
// whose runes write into hex cells that assemble while the node works. The
// module loads whole into a vm (tests/fixtures/node-styles-harness.mjs); the
// recording canvas follows every transform, so reach is measured on screen.
import test from "node:test";
import assert from "node:assert/strict";
import { loadNodeStyles, recordingContext, gradientsBuilt, plain } from "./fixtures/node-styles-harness.mjs";

const P = { x: 50, y: 50 };
const TINT = [120, 180, 220];
const FRAME = 1000 / 30;
const ACCENT = { background: "#050507", text: "#ece5d8", accent2: "#36d1ff" };
const LIGHT = { background: "#f3f0e8", text: "#1d2330", accent2: "#b07a2a" };
const luminance = (text) => { const [r, g, b] = String(text).match(/\d+(\.\d+)?/g).slice(0, 3).map(Number); return r * 0.2126 + g * 0.7152 + b * 0.0722; };
// WCAG relative luminance and contrast ratio of "rgba(r,g,b,a)" strings.
const relative = (text) => {
  const linear = (value) => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = String(text).match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
};
const contrast = (a, b) => (Math.max(relative(a), relative(b)) + 0.05) / (Math.min(relative(a), relative(b)) + 0.05);

// A motion record stepped at 30 Hz from time 0 to `time` (ms) in one state.
function stepped(styles, { id = "task:sigil", active = false, selected = false, status = null, still = false, time = 0, orbit = 0 } = {}) {
  const record = styles.motionRecord(new Map(), id);
  const flags = { style: "sigil", active, selected, progress: null, orbit, status, time: 0, frame: 0 };
  styles.stepMotion(record, flags, 0, still);
  for (let at = FRAME; at <= time + 1e-6; at += FRAME) {
    flags.time = at; flags.frame += 1;
    styles.stepMotion(record, flags, 1 / 30, still);
  }
  return record;
}
function paint(styles, options = {}, { radius = 12, tint = TINT, ctx = recordingContext() } = {}) {
  styles.paint(ctx, "sigil", P, radius, tint, { kind: "task", ...options });
  return ctx;
}
const counts = (ctx) => ({ lineTo: ctx.calls.lineTo, arc: ctx.calls.arc, fill: ctx.calls.fill, stroke: ctx.calls.stroke });
// The working cells in a paint's op log: every cell is a hexagon traced in
// the node's unit space, opened (vertex 0) beyond the seal and off the
// vertical axis, which nothing else in the look is. Answers their directions (0..5).
function cellsOf(ctx) {
  const cells = [];
  for (const [name, x, y] of ctx.calls.log) {
    if (name !== "moveTo" || !(Math.hypot(x, y) > 0.84) || !(Math.abs(x) > 0.3)) continue;
    cells.push((((Math.round(Math.atan2(y, x) / (Math.PI / 3))) % 6) + 6) % 6);
  }
  return cells;
}
// The path behind the stroke or fill at log index `at`: its points, in the
// coordinates they were traced in.
function pathBefore(log, at) {
  let start = at;
  while (start > 0 && log[start][0] !== "beginPath") start -= 1;
  return log.slice(start, at).filter(([name]) => name === "moveTo" || name === "lineTo").map(([, x, y]) => [x, y]);
}
const slotOf = ([x, y]) => (((Math.round(Math.atan2(y, x) / (Math.PI / 3))) % 6) + 6) % 6;
// How far out each working cell stands in a paint's op log (0 when it is not
// drawn): cell k opens (vertex 0, on top) at (.85 + .326e) along its normal,
// .32e up.
function extentsOf(ctx) {
  const out = [0, 0, 0, 0, 0, 0];
  for (const [name, x, y] of ctx.calls.log) {
    if (name !== "moveTo" || !(Math.hypot(x, y) > 0.84) || !(Math.abs(x) > 0.3)) continue;
    for (let k = 0; k < 6; k += 1) {
      const nx = Math.cos(k * Math.PI / 3), ny = Math.sin(k * Math.PI / 3), e = (x / nx - 0.85) / 0.326;
      if (e > 0 && Math.abs(ny * (0.85 + 0.326 * e) - 0.32 * e - y) < 1e-5) out[k] = Math.max(out[k], e);
    }
  }
  return out;
}

test("Sigil is a full style pack: its own body, glyph dress, rings, dial, orbit, marks, wires, pulses and landing", () => {
  const styles = loadNodeStyles();
  const theme = styles.theme(ACCENT);
  const hooks = [
    ["ring", () => styles.ring(recordingContext(), "sigil", P, 10, TINT, { status: "running", ring: 13.5, time: 100, still: false, theme })],
    ["hubDress", () => styles.hubDress(recordingContext(), "sigil", P, 15, TINT, { crew: true, breathe: 0.5, time: 100, still: false, theme })],
    ["orbit", () => styles.orbit(recordingContext(), "sigil", P, 12, TINT, { running: true, phase: 1, ring: 21, time: 100, still: false, theme })],
    ["arrival", () => styles.arrival(recordingContext(), "sigil", P, 12, TINT, 0.3, { alpha: 1, time: 100, still: false, theme })],
    ["select", () => styles.select(recordingContext(), "sigil", P, 12, TINT, { selected: true, chosen: true, alpha: 1, time: 100, still: false, theme })],
    ["wire", () => styles.wire(recordingContext(), "sigil", P, { x: 150, y: 90 }, { kind: "task", tint: TINT, alpha: 0.5, width: 1.4, active: true, march: true, time: 100, still: false, seed: 0.2, detail: 3, lifetime: 1 })],
    ["surge", () => styles.surge(recordingContext(), "sigil", P, { x: 150, y: 90 }, 0.5, { color: "#f1dcae", wave: true }, { kind: "wave", time: 100, still: false, detail: 3 })],
    ["land", () => styles.land(recordingContext(), "sigil", P, 12, TINT, 0.3, { kind: "dot", time: 100, still: false, detail: 3 })],
  ];
  for (const [name, call] of hooks) assert.equal(call(), true, `${name}: the style draws its own`);
  const dress = styles.glyph("sigil", TINT, theme);
  assert.deepEqual([dress.scale, dress.ringGap, typeof dress.ink], [0.52, 3.5, "string"]);
  assert.equal(styles.reach("sigil", stepped(styles)), 1, "at rest labels clear the seal");
  assert.ok(Math.abs(styles.reach("sigil", stepped(styles, { active: true, time: 3000 })) - 1.55) < 1e-9, "at work, the lattice and its sweep");
  // The legacy look is gone for good.
  const ctx = paint(styles);
  assert.ok(!ctx.calls.log.some(([name, , , r]) => name === "arc" && r === 0.9), "no ring-and-diamond seal of old");
});

test("Sigil steps down through the detail tiers to a seal and one turning rune tick", () => {
  const styles = loadNodeStyles();
  // [radius, detail]: [quiet, working, chosen] counts in the still pose.
  const table = [
    [4, 0, [{ lineTo: 6, arc: 1, fill: 2, stroke: 2 }, { lineTo: 6, arc: 2, fill: 3, stroke: 2 }, { lineTo: 6, arc: 2, fill: 3, stroke: 2 }]],
    [7, 1, [{ lineTo: 16, arc: 0, fill: 3, stroke: 3 }, { lineTo: 31, arc: 1, fill: 5, stroke: 4 }, { lineTo: 16, arc: 1, fill: 4, stroke: 3 }]],
    [9.5, 2, [{ lineTo: 27, arc: 0, fill: 3, stroke: 5 }, { lineTo: 57, arc: 1, fill: 7, stroke: 7 }, { lineTo: 27, arc: 1, fill: 4, stroke: 5 }]],
    [12, 3, [{ lineTo: 32, arc: 1, fill: 4, stroke: 5 }, { lineTo: 59, arc: 2, fill: 8, stroke: 7 }, { lineTo: 32, arc: 2, fill: 5, stroke: 5 }]],
  ];
  for (const [radius, detail, expected] of table) {
    const got = [{}, { active: true }, { selected: true, chosen: true }].map((options) => counts(paint(styles, { detail, ...options }, { radius })));
    assert.deepEqual(got, expected, `r ${radius}, T${detail}`);
  }
  // T0 is the seal (one hexagon) and one rune tick; the cells need T1.
  const tiny = paint(styles, { detail: 0, active: true }, { radius: 4 });
  assert.equal(tiny.calls.moveTo, 2);
  assert.deepEqual(cellsOf(tiny), []);
  assert.deepEqual(cellsOf(paint(styles, { detail: 1, active: true }, { radius: 7 })), [0, 2, 4], "T1 keeps three cells");
  assert.deepEqual(cellsOf(paint(styles, { detail: 2, active: true }, { radius: 9.5 })).sort(), [0, 1, 2, 3, 4, 5]);
  // A tier's extras fade in over its first 1.2 px: the other three runes and
  // the inner hexagon arrive faint just past the T2 cut.
  const edge = paint(styles, { detail: 2 }, { radius: 8.8 }), full = paint(styles, { detail: 2 }, { radius: 10.2 });
  assert.ok(Math.min(...edge.calls.strokes.map(({ alpha }) => alpha)) < 0.3 * Math.min(...full.calls.strokes.map(({ alpha }) => alpha)), "T2's runes fade in");
  // The detail a caller capped for the node wins over the radius.
  assert.deepEqual(counts(paint(styles, { detail: 1 }, { radius: 15 })), { lineTo: 16, arc: 0, fill: 3, stroke: 3 });
});

test("Sigil keeps its path work inside budget, working and chosen, frame after frame", () => {
  const styles = loadNodeStyles();
  const record = stepped(styles, { active: true, selected: true, time: 1500 });
  const flags = { style: "sigil", active: true, selected: true, progress: null, orbit: 0, status: null, time: 1500, frame: 45 };
  let most = { lineTo: 0, arc: 0 };
  for (let frame = 0; frame < 150; frame += 1) {
    flags.time += FRAME; flags.frame += 1;
    styles.stepMotion(record, flags, 1 / 30, false);
    const ctx = recordingContext();
    styles.paint(ctx, "sigil", P, 12, TINT, { kind: "task", active: true, selected: true, chosen: true, motion: record, time: flags.time, detail: 3 });
    styles.select(ctx, "sigil", P, 12, TINT, { kind: "task", selected: true, chosen: true, hover: false, active: true, alpha: 1, time: flags.time, still: false, detail: 3, motion: record });
    most = { lineTo: Math.max(most.lineTo, ctx.calls.lineTo), arc: Math.max(most.arc, ctx.calls.arc) };
  }
  assert.ok(most.lineTo <= 80, `T3 working + chosen, body and marks: ${most.lineTo} lineTo`);
  assert.ok(most.arc <= 12, `${most.arc} arcs`);
});

test("Sigil stays inside its reach: 1.8r steady, 1.6r of path at work, 1.1r at rest", () => {
  const styles = loadNodeStyles();
  for (const state of [{}, { selected: true }, { active: true }, { active: true, selected: true }]) {
    const record = stepped(styles, { ...state, time: 200 });
    const flags = { style: "sigil", active: state.active === true, selected: state.selected === true, progress: null, orbit: 0, status: null, time: 200, frame: 6 };
    for (let frame = 0; frame < 160; frame += 1) {
      flags.time += FRAME; flags.frame += 1;
      styles.stepMotion(record, flags, 1 / 30, false);
      const ctx = paint(styles, { ...state, motion: record, time: flags.time, detail: 3 });
      assert.ok(ctx.calls.reach <= 12 * 1.8 + 1e-9, `reach ${(ctx.calls.reach / 12).toFixed(3)}r`);
      assert.ok(ctx.calls.pathReach <= 12 * (state.active ? 1.6 : 1.1) + 1e-9, `path ${(ctx.calls.pathReach / 12).toFixed(3)}r (${JSON.stringify(state)})`);
      // The reach labels are told about covers everything drawn.
      assert.ok(ctx.calls.pathReach <= 12 * styles.reach("sigil", record) + 0.2, "reach(m) covers the lattice and its sweep");
    }
  }
});

test("Sigil builds its three radials once per canvas and tint, never in a steady frame", () => {
  const styles = loadNodeStyles();
  const ctx = recordingContext(), theme = styles.theme(ACCENT);
  const record = stepped(styles, { active: true, selected: true, time: 800 });
  const flags = { style: "sigil", active: true, selected: true, progress: null, orbit: 0, status: null, time: 800, frame: 24 };
  const frame = (tint = TINT, time = flags.time) => {
    styles.paint(ctx, "sigil", P, 12, tint, { kind: "task", active: true, selected: true, motion: record, time, detail: 3, theme });
    styles.paint(ctx, "sigil", { x: 90, y: 30 }, 7, tint, { kind: "todo", motion: null, time, detail: 1, theme });
  };
  record.kick = 1; frame();
  const warm = gradientsBuilt(ctx);
  assert.equal(warm, 3, "glow, well and spark");
  for (let index = 0; index < 150; index += 1) {
    flags.time += FRAME; flags.frame += 1;
    styles.stepMotion(record, flags, 1 / 30, false);
    frame();
  }
  frame(TINT, 5000);
  assert.equal(gradientsBuilt(ctx), warm, "no gradient in a steady frame, at t 5000 either");
  assert.equal(styles.cacheStats(ctx).entries, 1, "one entry per tint: no lit, time or radius in the key");
  frame([230, 201, 141]);
  const changed = gradientsBuilt(ctx);
  assert.equal(changed, warm + 3, "a new tint builds its own once");
  frame([120, 180, 220]); frame([230, 201, 141]);
  assert.equal(gradientsBuilt(ctx), changed, "a tint change and back reuses both");
  const other = recordingContext();
  styles.paint(other, "sigil", P, 12, TINT, { kind: "task", active: true, selected: true, motion: record, theme });
  assert.equal(gradientsBuilt(other), 3, "each canvas owns its paints");
  assert.equal(ctx.calls.shadowBlurs.length + other.calls.shadowBlurs.length, 0, "no shadowBlur, ever");
});

test("Sigil holds a designed still pose under reduced motion and moves strongly otherwise", () => {
  const styles = loadNodeStyles();
  const theme = styles.theme(ACCENT);
  const states = [{}, { active: true }, { selected: true, chosen: true }, { kind: "agent", active: true }, { kind: "assistant" }];
  for (const state of states) {
    const logs = [0, 1234, 99999].map((time) => plain(paint(styles, { ...state, motion: stepped(styles, { active: state.active === true, selected: state.selected === true, still: true, time: Math.min(time, 3000) }), time, still: true, theme }).calls.log));
    assert.deepEqual(logs[1], logs[0], `${JSON.stringify(state)} still at 1234 ms`);
    assert.deepEqual(logs[2], logs[0], `${JSON.stringify(state)} still at 99999 ms`);
    const moving = [0, 400].map((time) => plain(paint(styles, { ...state, motion: stepped(styles, { active: state.active === true, selected: state.selected === true, time: time + 2000 }), time: time + 2000, theme }).calls.log));
    assert.notDeepEqual(moving[1], moving[0], `${JSON.stringify(state)} moves within 400 ms`);
  }
  // Every hook: identical when still whatever the time, different 400 ms apart when not.
  const hookAt = (time, still) => {
    const ctx = recordingContext(), motion = stepped(styles, { active: true, selected: true, still, time: 900, status: "running" });
    styles.ring(ctx, "sigil", P, 10, TINT, { status: "running", ring: 13.5, time, still, motion, theme });
    styles.ring(ctx, "sigil", P, 10, TINT, { status: "queued", ring: 13.5, time, still, motion, theme });
    styles.ring(ctx, "sigil", P, 10, TINT, { status: "error", ring: 13.5, time, still, motion, theme });
    styles.hubDress(ctx, "sigil", P, 15, TINT, { crew: true, breathe: still ? 0.5 : (Math.sin(time / 1900) + 1) / 2, time, still, motion, theme });
    styles.orbit(ctx, "sigil", P, 12, TINT, { running: true, phase: still ? Math.PI / 3 : time / 1100 * Math.PI * 2, ring: 21, time, still, motion: still ? motion : { ...motion, orbit: time / 1100 * Math.PI * 2 }, theme });
    styles.select(ctx, "sigil", P, 12, TINT, { kind: "task", selected: true, chosen: true, alpha: 1, time, still, detail: 3, motion, theme });
    styles.wire(ctx, "sigil", P, { x: 150, y: 90 }, { kind: "task", tint: TINT, alpha: 0.5, width: 1.4, active: true, march: !still, time, still, seed: 0.3, detail: 3, lifetime: 1 });
    styles.wire(ctx, "sigil", P, { x: 150, y: 20 }, { kind: "session", tint: TINT, alpha: 0.3, width: 1, active: false, time, still, seed: 0.6, detail: 3, lifetime: 1 });
    return plain(ctx.calls.log);
  };
  assert.deepEqual(hookAt(1234, true), hookAt(0, true));
  assert.deepEqual(hookAt(99999, true), hookAt(0, true));
  assert.notDeepEqual(hookAt(2400, false), hookAt(2000, false));
});

test("Sigil at work assembles its cells one after another and folds them back, last first", () => {
  const styles = loadNodeStyles();
  const record = styles.motionRecord(new Map(), "task:lattice");
  const flags = { style: "sigil", active: false, selected: false, progress: null, orbit: 0, status: null, time: 0, frame: 0 };
  styles.stepMotion(record, flags, 0, false);
  const frame = () => {
    flags.time += FRAME; flags.frame += 1;
    styles.stepMotion(record, flags, 1 / 30, false);
    return cellsOf(paint(styles, { active: flags.active, motion: record, time: flags.time, detail: 3 }));
  };
  for (let index = 0; index < 10; index += 1) assert.deepEqual(frame(), [], "no cells at rest");
  flags.active = true;
  const rising = [];
  for (let index = 0; index < 36; index += 1) rising.push(frame());
  assert.notDeepEqual(plain(rising[0]).sort(), [0, 1, 2, 3, 4, 5], "not all at once");
  let order = [];
  rising.forEach((cells, index) => {
    const before = index ? rising[index - 1] : [];
    assert.ok(cells.length - before.length <= 1, `one new cell a frame at most (${before} → ${cells})`);
    for (const cell of cells) if (!order.includes(cell)) order.push(cell);
  });
  assert.deepEqual(order, [0, 1, 2, 3, 4, 5], "they come out in turn, clockwise from the right");
  assert.equal(rising.at(-1).length, 6, "all six locked on within 1.2 s");
  flags.active = false;
  const falling = [];
  for (let index = 0; index < 90; index += 1) falling.push(frame());
  order = [];
  falling.forEach((cells, index) => {
    const before = index ? falling[index - 1] : rising.at(-1);
    assert.ok(before.length - cells.length <= 1, "one cell folds back a frame at most");
    for (const cell of before) if (!cells.includes(cell) && !order.includes(cell)) order.push(cell);
  });
  assert.deepEqual(order, [5, 4, 3, 2, 1, 0], "they fold back last first");
  assert.ok(falling.findIndex((cells) => !cells.length) < 45, "and are gone within 1.5 s");
  // Working and resting are different drawings; an agent's ring is its work sign.
  assert.notDeepEqual(plain(paint(styles, { active: true }).calls.log), plain(paint(styles).calls.log));
  assert.deepEqual(cellsOf(paint(styles, { kind: "agent", active: true })), [], "no lattice round an agent");
});

test("Sigil's cells glide when the work stops before they are out, or starts again while they fold", () => {
  const styles = loadNodeStyles();
  const run = (script) => {
    const record = styles.motionRecord(new Map(), "task:toggle");
    const flags = { style: "sigil", active: false, selected: false, progress: null, orbit: 0, status: null, time: 0, frame: 0 };
    styles.stepMotion(record, flags, 0, false);
    const frames = [];
    for (const [active, count] of script) {
      flags.active = active;
      for (let index = 0; index < count; index += 1) {
        flags.time += FRAME; flags.frame += 1;
        styles.stepMotion(record, flags, 1 / 30, false);
        frames.push({ active, work: record.work, cells: extentsOf(paint(styles, { active, motion: record, time: flags.time, detail: 3 })) });
      }
    }
    frames.forEach(({ cells }, index) => {
      if (!index) return;
      cells.forEach((extent, k) => assert.ok(Math.abs(extent - frames[index - 1].cells[k]) <= 0.35, `cell ${k} moves ${(extent - frames[index - 1].cells[k]).toFixed(2)} in one frame (frame ${index})`));
    });
    return frames;
  };
  // Stopped .3 s in: cells 0 to 2 are out, 3 to 5 not yet; none comes out now.
  const early = run([[false, 10], [true, 9], [false, 45]]);
  const stop = early.findIndex(({ active }, index) => index > 10 && !active);
  assert.ok(early[stop - 1].cells[2] > 0.3 && early[stop - 1].cells[3] === 0, `half assembled when it stops (${early[stop - 1].cells.map((e) => e.toFixed(2))})`);
  for (let index = stop; index < early.length; index += 1) {
    early[index].cells.forEach((extent, k) => assert.ok(extent <= early[index - 1].cells[k] + 1e-9, `cell ${k} only folds once the work stops`));
  }
  assert.deepEqual(early.at(-1).cells, [0, 0, 0, 0, 0, 0], "and all are in again");
  // Started again at work ≈ .45, halfway through the fold: no cell folds away
  // to come out again; the ones still out stay and the rest follow.
  const refold = run([[true, 60], [false, 14], [true, 40]]);
  const restart = refold.findIndex(({ active }, index) => index > 60 && active);
  const held = refold[restart - 1];
  assert.ok(held.work > 0.4 && held.work < 0.5 && held.cells[1] > 0.3, `folding when it starts again (work ${held.work.toFixed(2)}, ${held.cells.map((e) => e.toFixed(2))})`);
  for (let index = restart; index < refold.length; index += 1) {
    refold[index].cells.forEach((extent, k) => assert.ok(extent >= held.cells[k] - 1e-9, `cell ${k} holds (${extent.toFixed(2)} < ${held.cells[k].toFixed(2)})`));
  }
  assert.ok(refold.at(-1).cells.every((extent) => Math.abs(extent - 1) < 1e-6), "and all six lock on again");
  // A second paint of the same record in the same frame changes nothing.
  const record = styles.motionRecord(new Map(), "task:twice");
  const flags = { style: "sigil", active: true, selected: false, progress: null, orbit: 0, status: null, time: 0, frame: 0 };
  styles.stepMotion(record, flags, 0, false);
  for (let index = 0; index < 5; index += 1) { flags.time += FRAME; styles.stepMotion(record, flags, 1 / 30, false); paint(styles, { active: true, motion: record, time: flags.time }); }
  assert.deepEqual(extentsOf(paint(styles, { active: true, motion: record, time: flags.time })), extentsOf(paint(styles, { active: true, motion: record, time: flags.time })));
});

test("Sigil's rest tail cools from ink into the second hue; the sweep runs under the cells; a second hue that is the tint's own gives way", () => {
  const styles = loadNodeStyles();
  const theme = styles.theme(ACCENT);
  const ink = styles.glyph("sigil", TINT, theme).ink, accent = "rgba(54,209,255,1)";
  // A record at rest `phase` of the way through a rune step (a step is .7 clock s).
  const atPhase = (phase) => {
    const record = stepped(styles, { time: 0 });
    record.clock = 0.7 * (40 + phase - ((record.seed * 6) % 1));
    return paint(styles, { motion: record, time: 1000, theme });
  };
  const inkAndAccent = (ctx) => {
    let style = null, alpha = 1;
    const strokes = { ink: [], accent: [] };
    for (const [name, value] of ctx.calls.log) {
      if (name === "set:strokeStyle") style = value;
      if (name === "set:globalAlpha") alpha = value;
      if (name === "stroke" && (style === ink || style === accent)) strokes[style === ink ? "ink" : "accent"].push(alpha);
    }
    return strokes;
  };
  const fresh = inkAndAccent(atPhase(0.02)), cooled = inkAndAccent(atPhase(0.5));
  assert.equal(fresh.ink.length, 2, "just after the step the old head is still mostly ink");
  assert.ok(fresh.accent.length <= 1 && (fresh.accent[0] ?? 0) < Math.min(...fresh.ink), `and barely the second hue (${fresh.accent} < ${fresh.ink})`);
  assert.deepEqual([cooled.ink.length, cooled.accent.length], [1, 1], "halfway on, the tail is all second hue");
  // The sweep hexagon (centred, past the seal) is stroked before any cell is filled.
  const record = stepped(styles, { active: true, time: 2000 });
  record.clock = 4.8 * (10 + 0.3 - (record.seed % 1));
  const log = paint(styles, { active: true, motion: record, time: 2000, theme }).calls.log;
  const sweep = log.findIndex(([name], at) => name === "stroke" && (() => { const [first] = pathBefore(log, at); return first && Math.abs(first[0]) < 1e-9 && -first[1] > 1.05; })());
  const cell = log.findIndex(([name], at) => name === "fill" && pathBefore(log, at).some(([x, y]) => Math.hypot(x, y) > 0.84 && Math.abs(x) > 0.3));
  assert.ok(sweep > 0 && cell > sweep, `the sweep (${sweep}) under the cells (${cell})`);
  // Aurora: its second hue is the working tint itself, so the lit cell (and
  // the crown) take the tint risen toward white instead.
  const mint = [167, 243, 218], aurora = styles.theme({ background: "#050d13", text: "#e7f5ee", accent2: "#a7f3da" });
  const hot = `rgba(${mint.map((value) => Math.round(value + (255 - value) * 0.55)).join(",")},1)`;
  const cellFills = (tint) => {
    const ctx = recordingContext();
    styles.paint(ctx, "sigil", P, 12, tint, { kind: "task", active: true, theme: aurora });
    const log = ctx.calls.log, found = new Set();
    let style = null;
    log.forEach(([name, value], at) => {
      if (name === "set:fillStyle") style = value;
      const [first] = name === "fill" ? pathBefore(log, at) : [];
      if (first && Math.hypot(...first) > 0.84 && Math.abs(first[0]) > 0.3) found.add(style);
    });
    return found;
  };
  const deep = `rgba(${mint.map((value, index) => Math.round(value + ([5, 13, 19][index] - value) * 0.84)).join(",")},1)`;
  assert.deepEqual([...cellFills(mint)].sort(), [deep, hot].sort(), `the lit cell in ${hot}, not mint on mint`);
  const crown = recordingContext();
  styles.select(crown, "sigil", P, 12, mint, { kind: "task", selected: true, chosen: true, alpha: 1, time: 0, still: true, detail: 3, motion: null, theme: aurora });
  assert.equal(crown.calls.strokes.at(-1).style, hot);
  assert.ok(cellFills(TINT).has("rgba(167,243,218,1)"), "another tint keeps the theme's second hue");
});

test("Sigil's runes are written in turn at rest, and at work the rune beside the lit cell strikes", () => {
  const styles = loadNodeStyles();
  const theme = styles.theme(ACCENT);
  const ink = styles.glyph("sigil", TINT, theme).ink, accent = "rgba(54,209,255,1)";
  const headOf = (ctx) => {
    const log = ctx.calls.log;
    let at = -1, style = null;
    log.forEach(([name, value], index) => { if (name === "set:strokeStyle") style = value; if (name === "stroke" && style === ink) at = index; });
    return at < 0 ? null : slotOf(pathBefore(log, at)[0]);
  };
  // At rest: the head moves one rune on at every step, always clockwise.
  const rest = stepped(styles, { time: 0 });
  const flags = { style: "sigil", active: false, selected: false, progress: null, orbit: 0, status: null, time: 0, frame: 0 };
  const heads = [];
  for (let index = 0; index < 200; index += 1) {
    flags.time += FRAME; flags.frame += 1;
    styles.stepMotion(rest, flags, 1 / 30, false);
    const head = headOf(paint(styles, { motion: rest, time: flags.time, theme }));
    if (head !== null && head !== heads.at(-1)) heads.push(head);
  }
  assert.ok(heads.length >= 8, `the head strikes rune after rune (${heads})`);
  heads.forEach((head, index) => { if (index) assert.equal(head, (heads[index - 1] + 1) % 6, `in turn: ${heads}`); });
  // At work: the lit cell steps round the lattice and the rune nearest it strikes.
  const work = stepped(styles, { active: true, time: 2000 });
  Object.assign(flags, { active: true, time: 2000 });
  const lit = new Set();
  for (let index = 0; index < 60; index += 1) {
    flags.time += FRAME; flags.frame += 1;
    styles.stepMotion(work, flags, 1 / 30, false);
    const ctx = paint(styles, { active: true, motion: work, time: flags.time, theme });
    const log = ctx.calls.log;
    let fillAt = -1, fill = null;
    log.forEach(([name, value], at) => { if (name === "set:fillStyle") fill = value; if (name === "fill" && fill === accent) fillAt = at; });
    const cell = cellsOf({ calls: { log: log.slice(0, fillAt).filter((_entry, at, rows) => at > rows.map(([name]) => name).lastIndexOf("beginPath")) } })[0];
    lit.add(cell);
    const turn = log.find(([name]) => name === "rotate")[1];
    const head = headOf(ctx), gap = Math.abs(((turn + head * Math.PI / 3 - cell * Math.PI / 3) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
    assert.ok(gap <= Math.PI / 6 + 0.02, `the struck rune sits beside the lit cell (${(gap * 180 / Math.PI).toFixed(1)}°)`);
  }
  assert.equal(lit.size, 6, "the scan lights every cell in a 2 s window (1.4 s a circuit)");
  // At T3 the struck rune is written into the lit cell: the same rune,
  // engraved in the body's tone, at the cell's centre.
  const still = paint(styles, { active: true, theme, detail: 3 });
  const body = still.calls.fills.find(({ style }) => typeof style === "string").style;
  const log = still.calls.log;
  let style = null, engraved = -1, struck = -1;
  log.forEach(([name, value], at) => { if (name === "set:strokeStyle") style = value; if (name === "stroke" && style === body) engraved = at; if (name === "stroke" && style === ink) struck = at; });
  assert.ok(engraved > 0, "a rune engraved in the lit cell");
  const inCell = pathBefore(log, engraved), onRing = pathBefore(log, struck);
  assert.deepEqual(inCell.map(([x, y]) => [Math.round((x - 0.69) * 1e6), Math.round(y * 1e6)]), onRing.map(([x, y]) => [Math.round((x - 0.69) * 1e6), Math.round(y * 1e6)]), "the very rune struck on the ring (cell 0 and rune 0 in the still pose)");
  assert.equal(paint(styles, { active: true, theme, detail: 2 }, { radius: 9.5 }).calls.strokes.filter(({ style: s }) => s === body).length, 0, "T2 keeps the cells plain");
});

test("Sigil's levels are globalAlpha gains on the caller's alpha, with the body at exactly that alpha", () => {
  const styles = loadNodeStyles();
  const record = stepped(styles, { active: true, selected: true, time: 1300 });
  record.kick = 0.7;
  for (const detail of [0, 1, 2, 3]) {
    const ctx = recordingContext();
    ctx.globalAlpha = 0.9; ctx.lineWidth = 2;
    styles.paint(ctx, "sigil", P, 12, TINT, { kind: "task", active: true, selected: true, alpha: 0.5, motion: record, time: 1300, detail, theme: styles.theme(ACCENT) });
    const { alphas, saves, restores, fills, strokes } = ctx.calls;
    assert.ok(alphas.every((alpha) => alpha > 0 && alpha <= 0.5 + 1e-12), `T${detail}: every layer within the caller's alpha`);
    assert.ok(alphas.includes(0.5), `T${detail}: the body at exactly the caller's alpha`);
    assert.equal(saves, restores);
    assert.deepEqual([ctx.globalAlpha, ctx.lineWidth, plain(ctx.matrix())], [0.9, 2, [1, 0, 0, 1, 0, 0]]);
    for (const { style } of [...fills, ...strokes]) if (typeof style === "string") assert.match(style, /,1\)$/, "colour strings stay at alpha 1 (the memo hits)");
  }
  // A landing kick flashes the seal: one more fill, a brighter glow.
  const calm = stepped(styles, { time: 900 }), kicked = stepped(styles, { time: 900 });
  kicked.kick = 1;
  assert.equal(paint(styles, { motion: kicked, time: 900 }).calls.fill, paint(styles, { motion: calm, time: 900 }).calls.fill + 2, "the flash and the glow");
});

test("Sigil marks a selected node, and wears its glyphs in an ink that reads on either theme", () => {
  const styles = loadNodeStyles();
  const quiet = paint(styles), chosen = paint(styles, { selected: true, chosen: true });
  assert.ok(Math.max(...chosen.calls.lineWidths) > Math.max(...quiet.calls.lineWidths), "a selected seal's rim is heavier");
  const dark = recordingContext();
  styles.paint(dark, "sigil", P, 15, TINT, { kind: "assistant" });
  const [monogram] = dark.calls.texts;
  assert.equal(monogram.text, "M");
  assert.ok(luminance(monogram.ink) > 200, `the hub's M in a light ink (${monogram.ink})`);
  const light = recordingContext(), paper = styles.theme(LIGHT);
  styles.paint(light, "sigil", P, 15, TINT, { kind: "music", theme: paper });
  assert.equal(light.calls.texts[0].text, "♪");
  assert.ok(luminance(light.calls.texts[0].ink) < 90, `a dark ink on a light theme (${light.calls.texts[0].ink})`);
  assert.ok(luminance(styles.glyph("sigil", TINT, paper).ink) < 90 && luminance(styles.glyph("sigil", TINT, styles.theme(ACCENT)).ink) > 200, "agents' glyphs too");
  // The body sinks toward the theme's background: dark on a dark theme, a
  // pale tint on a light one, where the rim darkens so a state tint still reads.
  const bodyOf = (theme) => { const ctx = paint(styles, { theme }); return [ctx.calls.fills[0].style, ctx.calls.strokes[0].style]; };
  const [darkBody] = bodyOf(styles.theme(ACCENT)), [paleBody, paleRim] = bodyOf(paper);
  assert.ok(luminance(darkBody) < 60 && luminance(paleBody) > 170, `${darkBody} / ${paleBody}`);
  assert.ok(luminance(paleRim) < luminance("rgba(120,180,220,1)") - 40, `a darker rim on paper (${paleRim})`);
  // On paper the seal carries its state's hue: a blocked (amber) seal stands
  // off the page, and its rim still reads at 3:1.
  const page = "rgba(243,240,232,1)";
  const amber = recordingContext();
  styles.paint(amber, "sigil", P, 12, [255, 212, 121], { kind: "task", theme: paper });
  const [amberBody, amberRim] = [amber.calls.fills[0].style, amber.calls.strokes[0].style];
  assert.ok((relative(page) - relative(amberBody)) / relative(page) >= 0.06, `an apricot seal, not the page (${amberBody})`);
  const [r, g, b] = amberBody.match(/\d+/g).map(Number);
  assert.ok(r - b > 60 && g - b > 40, `and amber in hue (${amberBody})`);
  assert.ok(contrast(amberRim, page) >= 3, `the rim at ${contrast(amberRim, page).toFixed(2)}:1 (${amberRim})`);
});

test("Sigil's agent ring steps two opposite hexagon edges; queued, failed and done keep their colours and badges", () => {
  const styles = loadNodeStyles();
  const theme = styles.theme(ACCENT);
  const ring = (status, time, extra = {}) => {
    const ctx = recordingContext({ center: P });
    ctx.globalAlpha = 0.8;
    const drawn = styles.ring(ctx, "sigil", P, 10, TINT, { status, builder: false, ring: 13.5, time, still: false, detail: 3, motion: null, theme, ...extra });
    assert.equal(ctx.calls.saves, ctx.calls.restores);
    assert.equal(ctx.globalAlpha, 0.8);
    return { drawn, ctx };
  };
  const running = ring("running", 10);
  assert.equal(running.drawn, true);
  assert.deepEqual([running.ctx.calls.stroke, running.ctx.calls.lineTo], [3, 9], "the track, the two edges left behind, the two lit");
  assert.ok(running.ctx.calls.pathReach <= 13.5 + 1e-9 && running.ctx.calls.pathReach > 13.4, "on a hexagon the glyph's gap out");
  assert.ok(running.ctx.calls.alphas.every((alpha) => alpha > 0 && alpha <= 0.8 + 1e-12), "within the caller's alpha");
  assert.deepEqual(plain(ring("running", 60).ctx.calls.log), plain(running.ctx.calls.log), "an edge holds for 120 ms");
  assert.notDeepEqual(plain(ring("running", 130).ctx.calls.log), plain(running.ctx.calls.log), "then steps on");
  assert.equal(ring(null, 0, { builder: true }).drawn, true, "a builder counts as running");
  const queued = ring("queued", 0).ctx;
  assert.ok(queued.calls.log.some(([name, ...dash]) => name === "setLineDash" && dash.join() === "2,3"), "queued: dashed");
  assert.notDeepEqual(plain(ring("queued", 400).ctx.calls.log), plain(queued.calls.log), "and marching");
  const error = ring("error", 5000).ctx;
  assert.ok(error.calls.strokes.some(({ style }) => style === "rgba(255,212,121,1)"), "failed: the amber ring");
  assert.deepEqual(error.calls.texts.map(({ text }) => text), ["!"], "and its badge");
  // The badge sits at (r + 4, −r − 4): its hexagon (5.4 out) comes no nearer
  // the centre than 14.9 px, the ring's hexagon no further than 12.1 px that way.
  assert.deepEqual(plain(error.calls.log.find(([name]) => name === "translate")), ["translate", P.x + 14, P.y - 14], "the badge keeps 2 px of air off the ring");
  const done = ring("done", 5000).ctx;
  assert.deepEqual([done.calls.texts.length, done.calls.strokes.some(({ style }) => style === "rgba(104,236,164,1)")], [0, true], "done: the green tick");
  for (const status of ["idle", null, "unknown"]) {
    const other = ring(status, 0);
    assert.deepEqual([other.drawn, other.ctx.calls.log.length], [false, 1], `${status}: declined, nothing drawn`);
  }
  // A badge pops in from the moment the status changed.
  const scaleOf = (ctx) => ctx.calls.log.filter(([name]) => name === "scale").map(([, sx]) => sx)[0];
  const motion = { seed: 0, statusAt: 1000 };
  assert.ok(scaleOf(ring("done", 1040, { motion }).ctx) < 0.6, "small at first");
  assert.equal(scaleOf(ring("done", 1400, { motion }).ctx), 1, "settled after 320 ms");
  // On a light theme the state colours darken so they read on paper.
  const paper = ring("error", 5000, { theme: styles.theme(LIGHT) }).ctx;
  assert.ok(paper.calls.strokes.every(({ style }) => style !== "rgba(255,212,121,1)"), "amber, darkened on a light theme");
});

test("Sigil's hub dial, work orbit, arrival and selection speak the same hex language", () => {
  const styles = loadNodeStyles();
  const theme = styles.theme(ACCENT);
  // The hub: twelve rune ticks on a dial at r + 6, one lit, turning in 30 s; the crew ring in the rune rhythm.
  const hub = recordingContext();
  styles.hubDress(hub, "sigil", P, 15, TINT, { crew: true, breathe: 0.5, time: 0, still: false, detail: 3, motion: null, theme });
  assert.deepEqual([hub.calls.moveTo, hub.calls.lineTo, hub.calls.stroke, hub.calls.arc], [13, 13, 3, 1]);
  assert.ok(hub.calls.log.some(([name, ...dash]) => name === "setLineDash" && dash.join() === "5,2,1.5,2"));
  const small = recordingContext();
  styles.hubDress(small, "sigil", P, 15, TINT, { crew: false, breathe: 0.5, time: 0, still: false, detail: 1, motion: null, theme });
  assert.equal(small.calls.lineTo, 5, "a capped hub keeps its four long ticks");
  // The work orbit: a flat-top hexagon (a corner toward each cell) in the node's tint, never the old blue.
  const orbit = recordingContext();
  styles.orbit(orbit, "sigil", P, 12, TINT, { running: true, phase: 1, ring: 21, time: 0, still: false, detail: 3, motion: { seed: 0, orbit: 2 }, theme });
  assert.deepEqual(plain(orbit.calls.log.find(([name]) => name === "moveTo")), ["moveTo", 74.248711, 50], "the track's first corner points right, 21/cos 30° out");
  // Its sides touch the caller's orbit circle (r + 9): the bottom side stays
  // 2.5 px under the progress meter (r + 5 … r + 6.5), as the legacy circle did,
  // and neither the track nor the comet comes inside it (the cells end at 1.46r).
  const points = orbit.calls.log.filter(([name]) => name === "moveTo" || name === "lineTo").map(([, x, y]) => [x - P.x, y - P.y]);
  assert.ok(points.every(([x, y]) => Math.hypot(x, y) >= 21 - 1e-6), "nothing inside r + 9");
  assert.ok(Math.abs(Math.max(...points.map(([, y]) => y)) - 21) < 1e-6, "the bottom side lies at r + 9");
  for (let phase = 0; phase < 6.3; phase += 0.35) {
    const lap = recordingContext();
    styles.orbit(lap, "sigil", P, 12, TINT, { running: true, phase, ring: 21, time: 0, still: false, detail: 3, motion: { seed: 0, orbit: phase }, theme });
    const at = lap.calls.log.filter(([name]) => name === "moveTo" || name === "lineTo").map(([, x, y]) => Math.hypot(x - P.x, y - P.y));
    assert.ok(Math.min(...at) >= 21 - 1e-6 && Math.max(...at) <= 21 / Math.cos(Math.PI / 6) + 1e-6, `the comet keeps to the track (phase ${phase.toFixed(2)})`);
  }
  assert.ok(orbit.calls.strokes.every(({ style }) => style === "rgba(120,180,220,1)"), "in the node's own tint");
  assert.ok(!JSON.stringify(orbit.calls.log).includes("125,178,255"));
  const phased = recordingContext();
  styles.orbit(phased, "sigil", P, 12, TINT, { running: true, phase: 1, ring: 21, time: 0, still: false, detail: 3, motion: { seed: 0, orbit: 3 }, theme });
  assert.notDeepEqual(plain(phased.calls.log), plain(orbit.calls.log), "the comet runs on the node's integrated orbit phase");
  const untinted = recordingContext();
  styles.orbit(untinted, "sigil", P, 12, null, { running: true, phase: 1, ring: 21, time: 0, still: true, detail: 3, motion: null, theme });
  assert.ok(untinted.calls.strokes.every(({ style }) => style === "rgba(54,209,255,1)"), "no tint yet: the theme's orbit hue");
  // Arrival: a flash, a ring and six hexes off the corners; nothing when still.
  assert.equal(styles.arrival(recordingContext(), "sigil", P, 12, TINT, 0.3, { alpha: 1, still: true, theme }), false);
  let widest = 0;
  const peaks = [0.1, 0.5, 0.9].map((t01) => {
    const ctx = recordingContext();
    styles.arrival(ctx, "sigil", P, 12, TINT, t01, { alpha: 0.8, time: 0, still: false, detail: 3, theme });
    widest = Math.max(widest, ctx.calls.reach);
    assert.ok(ctx.calls.alphas.every((alpha) => alpha > 0 && alpha <= 0.8 + 1e-12));
    return Math.max(...ctx.calls.alphas);
  });
  assert.ok(peaks[0] > peaks[1] && peaks[1] > peaks[2], "it fades as the node settles");
  assert.ok(widest <= 12 * 2.25, `arrival reach ${(widest / 12).toFixed(2)}r`);
  // Selection: a hexagon at 1.2 on hover; the hexagram's six points at 1.3 once chosen.
  const hover = recordingContext();
  styles.select(hover, "sigil", P, 12, TINT, { kind: "task", selected: true, chosen: false, alpha: 1, time: 0, still: true, detail: 3, motion: null, theme });
  assert.deepEqual([hover.calls.lineTo, hover.calls.stroke], [5, 1]);
  assert.ok(Math.abs(hover.calls.pathReach - 14.4) < 1e-9);
  const chosen = recordingContext();
  styles.select(chosen, "sigil", P, 12, TINT, { kind: "task", selected: true, chosen: true, alpha: 1, time: 0, still: true, detail: 3, motion: null, theme });
  assert.deepEqual([chosen.calls.lineTo, chosen.calls.stroke], [17, 2]);
  assert.equal(chosen.calls.strokes[1].style, "rgba(54,209,255,1)", "the crown in the theme's second hue");
  assert.ok(Math.abs(chosen.calls.pathReach - 15.6) < 1e-6, "tips at 1.3r");
  const capped = recordingContext();
  styles.select(capped, "sigil", P, 12, TINT, { kind: "task", selected: true, chosen: true, alpha: 1, time: 0, still: true, detail: 1, motion: null, theme });
  assert.equal(capped.calls.lineTo, 10, "a small node keeps a second hexagon instead");
  const easing = recordingContext();
  styles.select(easing, "sigil", P, 12, TINT, { kind: "task", selected: false, chosen: false, alpha: 1, time: 0, still: false, detail: 3, motion: { seed: 0, sel: 0.4, work: 0 }, theme });
  assert.ok(Math.abs(easing.calls.alphas[0] - 0.75 * 0.4) < 1e-12, "the mark eases with the selection");
});

test("Sigil's selection marks keep off the working cells: the crown settles into their gaps, the hover frame opens round them", () => {
  const styles = loadNodeStyles();
  const theme = styles.theme(ACCENT);
  const SIXTH = Math.PI / 3;
  const offCell = (angle) => { const rest = ((angle % SIXTH) + SIXTH) % SIXTH; return Math.min(rest, SIXTH - rest); };
  const turnDelta = (a, b) => { const d = (((b - a) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI; return Math.abs(d); };
  // A chosen node at rest, then at work, the crown drawn every 30 Hz frame.
  const record = stepped(styles, { selected: true, time: 600 });
  const flags = { style: "sigil", active: false, selected: true, progress: null, orbit: 0, status: null, time: 600, frame: 18 };
  const crown = () => {
    flags.time += FRAME; flags.frame += 1;
    styles.stepMotion(record, flags, 1 / 30, false);
    const ctx = recordingContext({ center: P });
    styles.select(ctx, "sigil", P, 12, TINT, { kind: "task", selected: true, chosen: true, hover: false, active: flags.active, alpha: 1, time: flags.time, still: false, detail: 3, motion: record, theme });
    const log = ctx.calls.log, turn = log.find(([name]) => name === "rotate")[1];
    const scaled = log.findIndex(([name]) => name === "scale");
    const points = log.slice(scaled).filter(([name]) => name === "moveTo" || name === "lineTo").map(([, x, y]) => [Math.hypot(x, y), Math.atan2(y, x) + turn]);
    return { turn, points };
  };
  const turns = [];
  for (let index = 0; index < 20; index += 1) turns.push(crown().turn);
  assert.ok(turnDelta(turns[0], turns.at(-1)) > 0.15, "at rest the crown turns");
  flags.active = true;
  let last = turns.at(-1), settled = null;
  for (let index = 0; index < 90; index += 1) {
    settled = crown();
    assert.ok(turnDelta(last, settled.turn) <= 0.1, `the crown eases into place (${(turnDelta(last, settled.turn) * 180 / Math.PI).toFixed(2)}° in a frame)`);
    last = settled.turn;
  }
  assert.ok(offCell(settled.turn) < 0.01, "at work it settles on a sixth: its points sit between the cells");
  for (const [reach, angle] of settled.points) assert.ok(reach <= 1.3 + 1e-5 && offCell(angle) >= 20 * Math.PI / 180, `a crown point ${(offCell(angle) * 180 / Math.PI).toFixed(1)}° off a cell`);
  assert.ok(turnDelta(settled.turn, crown().turn) < 1e-3, "and holds there");
  // Hovered (not chosen) at work: a flat-top frame at 1.7r round the honeycomb,
  // every cell vertex at least .12r inside it.
  assert.ok(extentsOf(paint(styles, { active: true, theme })).every((extent) => Math.abs(extent - 1) < 1e-6), "the still pose's cells, all locked on");
  const worker = stepped(styles, { active: true, selected: true, time: 3000 });
  const frame = recordingContext({ center: P });
  styles.select(frame, "sigil", P, 12, TINT, { kind: "task", selected: true, chosen: false, hover: true, active: true, alpha: 1, time: 3000, still: false, detail: 3, motion: worker, theme });
  const corners = frame.calls.log.filter(([name]) => name === "moveTo" || name === "lineTo").map(([, x, y]) => [x / 12, y / 12]);
  assert.equal(corners.length, 6);
  for (const [x, y] of corners) assert.ok(Math.abs(Math.hypot(x, y) - 1.7) < 1e-5 && offCell(Math.atan2(y, x)) < 1e-5, "flat-top, a corner toward each cell");
  const inradius = 1.7 * Math.cos(Math.PI / 6);
  for (let k = 0; k < 6; k += 1) {
    for (let v = 0; v < 6; v += 1) {
      const cx = 1.176 * Math.cos(k * SIXTH) + 0.32 * Math.cos(v * SIXTH - Math.PI / 2), cy = 1.176 * Math.sin(k * SIXTH) + 0.32 * Math.sin(v * SIXTH - Math.PI / 2);
      for (let side = 0; side < 6; side += 1) {
        const depth = inradius - (cx * Math.cos(side * SIXTH + Math.PI / 6) + cy * Math.sin(side * SIXTH + Math.PI / 6));
        assert.ok(depth >= 0.12, `cell ${k} vertex ${v} is ${depth.toFixed(3)}r inside side ${side}`);
      }
    }
  }
  // A chosen node at work leaves the hover frame to its crown; labels clear both marks.
  const both = recordingContext();
  styles.select(both, "sigil", P, 12, TINT, { kind: "task", selected: true, chosen: true, active: true, alpha: 1, time: 3000, still: false, detail: 3, motion: worker, theme });
  assert.deepEqual([both.calls.stroke, both.calls.lineTo], [1, 12], "the crown alone");
  assert.ok(Math.abs(styles.reach("sigil", stepped(styles, { selected: true, time: 2000 })) - 1.3) < 1e-9, "a selected seal at rest: the crown's tips");
  assert.ok(Math.abs(styles.reach("sigil", worker) - 1.7) < 1e-9, "at work: the hover frame");
});

test("Sigil wires are cut in the rune rhythm; active ones march with a groove and two hex packets", () => {
  const styles = loadNodeStyles();
  const a = { x: 20, y: 80 }, b = { x: 220, y: 30 };
  const wire = (extra = {}, pen = recordingContext({ center: a })) => {
    pen.globalAlpha = 1;
    const drawn = styles.wire(pen, "sigil", a, b, { kind: "session", tint: TINT, alpha: 0.4, width: 1, dash: [], march: false, double: false, active: false, inspected: false, curved: false, cp: null, far: false, time: 1000, still: false, seed: 0.3, rA: 8, rB: 8, detail: 3, lifetime: 1, ...extra });
    assert.equal(pen.calls.saves, pen.calls.restores);
    assert.deepEqual([pen.globalAlpha, pen.getLineDash().length, pen.lineDashOffset], [1, 0, 0], "the pen comes back as it was");
    assert.equal(gradientsBuilt(pen) + pen.calls.shadowBlurs.length, 0, "no gradient, no shadowBlur");
    return { drawn, pen };
  };
  const dashOf = (pen) => pen.calls.log.filter(([name]) => name === "setLineDash").map(([, ...dash]) => dash.join())[0];
  const offsetOf = (pen) => pen.calls.log.filter(([name]) => name === "set:lineDashOffset").map(([, value]) => value)[0];
  const quiet = wire();
  assert.equal(quiet.drawn, true);
  assert.deepEqual([quiet.pen.calls.stroke, quiet.pen.calls.fill, dashOf(quiet.pen)], [1, 0, "5,2,1.5,2"], "one stroke in the rune rhythm");
  assert.deepEqual(quiet.pen.calls.alphas, [0.4]);
  assert.ok(Math.abs(offsetOf(wire({ time: 1400 }).pen) - offsetOf(quiet.pen)) === 1, "drifting slowly at rest (1 px in 400 ms)");
  assert.equal(dashOf(wire({ kind: "task" }).pen), "1.5,2.5,1.5,5");
  assert.equal(dashOf(wire({ kind: "folded" }).pen), "1,5");
  assert.equal(dashOf(wire({ kind: "tether" }).pen), "6,2,1.5,2");
  const active = wire({ kind: "task", active: true, march: true, width: 1.4, alpha: 0.55 });
  assert.deepEqual([active.pen.calls.stroke, active.pen.calls.fill, active.pen.calls.lineTo], [2, 1, 12], "the groove, the runes and two hex packets");
  assert.equal(active.pen.calls.lineWidths[0], 3.4, "the groove lies two pixels wider");
  assert.equal(active.pen.calls.fills[0].style, "rgba(194,221,239,1)", "no second hue known yet: packets in the whitened tint");
  assert.notDeepEqual(plain(wire({ kind: "task", active: true, march: true, time: 1100 }).pen.calls.log), plain(active.pen.calls.log), "marching");
  const far = wire({ kind: "task", active: true, march: true, far: true });
  assert.deepEqual([far.pen.calls.stroke, far.pen.calls.fill], [1, 0], "the far pen keeps the runes alone");
  const still = wire({ kind: "task", active: true, still: true });
  assert.deepEqual([still.pen.calls.fill, offsetOf(still.pen)], [0, 0], "still: no packets, no drift");
  const double = wire({ kind: "hub", double: true });
  assert.deepEqual([double.pen.calls.moveTo, double.pen.calls.lineTo, double.pen.calls.stroke], [2, 2, 1], "the hub's double line");
  const curve = wire({ curved: true, cp: { x1: 20, y1: 55, x2: 220, y2: 55 }, active: true });
  assert.equal(curve.pen.calls.bezierCurveTo, 2, "the S-curve kept, groove and runes");
  // The rail: only an active session's wires carry the runes; the rest keep their plain line.
  const railQuiet = wire({ rail: true, detail: 2 });
  assert.deepEqual([railQuiet.drawn, railQuiet.pen.calls.log.length], [false, 1]);
  const railActive = wire({ rail: true, active: true, detail: 2 });
  assert.deepEqual([railActive.drawn, railActive.pen.calls.stroke, railActive.pen.calls.fill, dashOf(railActive.pen)], [true, 1, 0, "5,2,1.5,2"]);
  assert.equal(styles.wire(recordingContext(), "sigil", a, b, { kind: "session", tint: null }), false, "no tint: the caller's line");
  // A theme on the offer (or the one the bodies were painted in) gives the packets its second hue.
  styles.paint(recordingContext(), "sigil", P, 12, TINT, { theme: styles.theme(ACCENT) });
  assert.equal(wire({ active: true }).pen.calls.fills[0].style, "rgba(54,209,255,1)");
});

test("Sigil pulses run as a turning hex packet with two trailing hexes and land in a hex burst", () => {
  const styles = loadNodeStyles();
  const from = { x: 20, y: 80 }, to = { x: 220, y: 30 };
  const surge = (t, pulse, extra = {}) => {
    const ctx = recordingContext({ center: to });
    const drawn = styles.surge(ctx, "sigil", from, to, t, pulse, { kind: pulse.wave ? "wave" : "dot", time: 400, still: false, rTo: 12, detail: 3, pulse, motion: null, ...extra });
    assert.equal(ctx.calls.saves, ctx.calls.restores);
    assert.equal(gradientsBuilt(ctx) + ctx.calls.shadowBlurs.length, 0, "no gradient, no shadowBlur");
    return { drawn, ctx };
  };
  const dot = { color: "#f1dcae" };
  const flying = surge(0.5, dot);
  assert.deepEqual([flying.drawn, flying.ctx.calls.fill, flying.ctx.calls.lineTo], [true, 3, 15], "head and two trailing hexes");
  assert.deepEqual(plain(dot._sigilRgb), [241, 220, 174], "the colour is parsed once and kept on the pulse");
  const kept = dot._sigilRgb;
  surge(0.6, dot);
  assert.equal(dot._sigilRgb, kept);
  assert.equal(surge(0.5, dot, { detail: 1 }).ctx.calls.fill, 2, "a small target keeps one trailing hex");
  assert.ok(surge(0.01, dot).ctx.calls.alphas.every((alpha) => alpha < 0.25), "fades in off its start");
  const wave = surge(0.5, { color: "#8fd0ff", wave: true, packet: true }).ctx;
  assert.deepEqual([wave.calls.setLineDash > 0, wave.calls.arc], [true, 1], "a wave writes runes behind it; a packet carries its cargo");
  const still = surge(1, dot, { still: true }).ctx;
  assert.deepEqual([still.calls.stroke, still.calls.fill], [1, 1], "still: a faint wire with the packet resting halfway");
  assert.equal(styles.surge(recordingContext(), "sigil", from, to, 0.5, dot, { kind: "dot", rail: true, detail: 2 }), false, "the rail keeps its own pulse");
  // The landing: a hexagon ringing out to 1.8r and six small hexes off its edges.
  const land = (u, extra = {}) => {
    const ctx = recordingContext({ center: to });
    const drawn = styles.land(ctx, "sigil", to, 12, [241, 220, 174], u, { kind: "dot", time: 0, still: false, rTo: 12, detail: 3, pulse: dot, motion: null, ...extra });
    assert.equal(gradientsBuilt(ctx) + ctx.calls.shadowBlurs.length, 0);
    return { drawn, ctx };
  };
  const burst = land(0.4);
  assert.deepEqual([burst.drawn, burst.ctx.calls.stroke, burst.ctx.calls.fill, burst.ctx.calls.lineTo], [true, 1, 1, 35]);
  let widest = 0;
  for (let u = 0; u < 1; u += 0.05) widest = Math.max(widest, land(u).ctx.calls.reach);
  assert.ok(widest <= 12 * 2.25 && widest > 12 * 1.6, `landing reach ${(widest / 12).toFixed(2)}r`);
  assert.deepEqual([land(1).ctx.calls.log.length, land(0.5, { still: true }).ctx.calls.log.length], [0, 0], "done, or still: nothing");
  const rail = land(0.4, { rail: true, detail: 2 }).ctx;
  assert.deepEqual([rail.calls.stroke, rail.calls.fill], [1, 0], "on the rail a single ring");
  const unknown = recordingContext();
  assert.equal(styles.land(unknown, "sigil", to, 0, [1, 2, 3], 0.3, { rTo: 0, detail: 3 }), true, "a target not measured yet lands at a default size");
});
