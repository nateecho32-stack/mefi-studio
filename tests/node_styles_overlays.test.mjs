// The shared overlays (renderer/node-styles.js `overlays` section: the free
// styles' agent status ring, hub dress, work orbit and arrival ring) and the
// Command view's own node marks around them (idle.js: the progress meter,
// the done-hold badge and its hold, the collision rim, the hover pop, the
// tint cross-fade and the label clearance a style's reach buys).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { NODE_STYLES_SOURCE, loadNodeStyles, recordingContext, gradientsBuilt, plain } from "./fixtures/node-styles-harness.mjs";

const idle = await readFile(new URL("../renderer/idle.js", import.meta.url), "utf8");
const section = (start, end) => {
  const a = idle.indexOf(start), b = idle.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `missing section ${start}`);
  return idle.slice(a, b);
};

const FREE = ["orbs", "glass", "minimal", "halo", "crystal"];
const P = { x: 50, y: 50 }, TINT = [120, 180, 220];
const DARK = { background: "#050507", text: "#ece5d8", accent2: "#36d1ff" };
const LIGHT = { background: "#f3f0e8", text: "#1d2330" };

// A motion record stepped `frames` 30 Hz frames in a state, ending at `time` ms.
function steppedRecord(styles, id, { active = false, selected = false, status = null, orbit = 0, progress = null, frames = 60, time = 2000, still = false, style = "orbs" } = {}) {
  const record = styles.motionRecord(new Map(), id);
  const flags = { style, active, selected, progress, orbit, status, time: 0, frame: 0 };
  for (let frame = 0; frame < frames; frame += 1) {
    flags.time = time - (frames - frame - 1) * (1000 / 30); flags.frame = frame;
    styles.stepMotion(record, flags, 1 / 30, still);
  }
  return record;
}
const strokeStyles = (ctx) => ctx.calls.strokes.map(({ style }) => style);
const arcs = (ctx) => ctx.calls.log.filter(([name]) => name === "arc");
const sets = (ctx, key) => ctx.calls.log.filter(([name]) => name === `set:${key}`).map(([, value]) => value);
const alphaOf = (style) => Number(String(style).match(/,([\d.]+)\)$/)?.[1]);

// ===== the module's shared overlays =====

test("the free styles share the overlay defaults, and selection stays with their rim", () => {
  const styles = loadNodeStyles();
  const theme = styles.theme(DARK);
  for (const style of FREE) {
    const ctx = recordingContext();
    assert.equal(styles.ring(ctx, style, P, 10, TINT, { status: "running", ring: 13.5, time: 0, still: true, theme }), true, `${style}: ring`);
    assert.equal(styles.hubDress(ctx, style, P, 15, TINT, { crew: true, time: 0, still: true, theme }), true, `${style}: hub dress`);
    assert.equal(styles.orbit(ctx, style, P, 12, TINT, { running: true, phase: 1, ring: 21, time: 0, still: true, theme }), true, `${style}: orbit`);
    assert.equal(styles.arrival(ctx, style, P, 12, TINT, 0.4, { alpha: 1, time: 0, still: false, motion: steppedRecord(styles, `a:${style}`) }), true, `${style}: arrival`);
    const before = ctx.calls.log.length;
    assert.equal(styles.select(ctx, style, P, 12, TINT, { selected: true, chosen: true, alpha: 1, time: 0, still: false, theme }), false, `${style}: selection reads through the rim`);
    assert.equal(ctx.calls.log.length, before, "and draws nothing of its own");
    assert.equal(ctx.calls.saves, ctx.calls.restores);
  }
});

test("the running arc eases with the work level and keeps the legacy sweep", () => {
  const styles = loadNodeStyles();
  const theme = styles.theme(DARK);
  const ring = (motion, time, still = false) => {
    const ctx = recordingContext();
    styles.ring(ctx, "orbs", P, 10, TINT, { status: "running", builder: false, ring: 13.5, time, still, detail: 3, motion, theme });
    return ctx;
  };
  const working = steppedRecord(styles, "agent:w", { active: true, status: "running" });
  assert.equal(working.work, 1);
  const full = ring(working, 1900);
  const comet = arcs(full).slice(0, 3), round4 = (value) => Math.round(value * 1e4) / 1e4;
  assert.ok(comet.every(([, x, y, radius]) => x === 50 && y === 50 && radius === 13.5), "on the status ring");
  assert.deepEqual([round4(comet[0][4]), round4(comet[2][5])], [round4(1900 / 380), round4(1900 / 380 + Math.PI * 1.3)], "a comet 1.3π long sweeping at time/380");
  assert.ok(comet.every((arc, index) => !index || Math.abs(arc[4] - comet[index - 1][5]) < 1e-6), "in three segments end to end");
  assert.deepEqual(strokeStyles(full).map(alphaOf), [0.24, 0.52, 0.9], "brightening toward the head, full strength at full work");
  assert.equal(full.calls.fill, 1, "a bright head bead");
  const small = recordingContext();
  styles.ring(small, "orbs", P, 10, TINT, { status: "running", ring: 13.5, time: 1900, still: false, detail: 0, motion: working, theme });
  assert.deepEqual([small.calls.stroke, small.calls.fill, alphaOf(small.calls.strokes[0].style)], [1, 0, 0.9], "the smallest tier keeps one plain arc");
  // A run that ends: the arc fades with the eased work level instead of blinking out.
  const flags = { style: "orbs", active: false, selected: false, progress: null, orbit: 0, status: "idle", time: 2000, frame: 61 };
  styles.stepMotion(working, flags, 1 / 30, false);
  const fading = ring(working, 2033);
  assert.ok(working.work > 0.8 && working.work < 1);
  assert.equal(alphaOf(strokeStyles(fading)[2]), 0.9 * Math.round(working.work * 32) / 32, "the arc's alpha is .9 × the work level (in 32nds)");
  for (let frame = 0; frame < 90; frame += 1) styles.stepMotion(working, flags, 1 / 30, false);
  assert.equal(ring(working, 5000).calls.stroke, 0, "gone once the work has eased out");
  // Reduced motion: the arc at rest, full strength, the same every frame.
  const quiet = steppedRecord(styles, "agent:q", { active: true, status: "running", still: true });
  const still = [0, 1234, 99999].map((time) => plain(ring(quiet, time, true).calls.log));
  assert.deepEqual(still[1], still[0]); assert.deepEqual(still[2], still[0]);
  assert.equal(alphaOf(strokeStyles(ring(quiet, 0, true))[2]), 0.9);
  const spinning = steppedRecord(styles, "agent:spinning", { active: true, status: "running" });
  assert.notDeepEqual(plain(ring(spinning, 0).calls.log), plain(ring(spinning, 400).calls.log), "animated frames differ");
  // No record (a bare caller): the status alone decides.
  const bare = recordingContext();
  styles.ring(bare, "orbs", P, 10, TINT, { status: "running", ring: 13.5, time: 0, still: false });
  assert.equal(alphaOf(bare.calls.strokes[2].style), 0.9);
  // On a light theme a pastel hue deepens a little to read as a thin ring.
  const pale = recordingContext();
  styles.ring(pale, "orbs", P, 10, TINT, { status: "running", ring: 13.5, time: 0, still: true, detail: 3, motion: null, theme: styles.theme(LIGHT) });
  assert.ok(pale.calls.strokes.length === 3 && pale.calls.strokes.every(({ style }) => !style.startsWith(`rgba(${TINT.join(",")},`)));
});

test("queued dashes march, the error ring pulses, and both come back as they were", () => {
  const styles = loadNodeStyles();
  const theme = styles.theme(DARK);
  const queued = steppedRecord(styles, "agent:queued", { status: "queued" });
  const at = (status, motion, time, still = false) => {
    const ctx = recordingContext();
    styles.ring(ctx, "glass", P, 10, TINT, { status, ring: 13.5, time, still, detail: 3, motion, theme });
    assert.equal(ctx.calls.saves, ctx.calls.restores);
    assert.deepEqual([ctx.getLineDash(), ctx.lineDashOffset, ctx.globalAlpha], [[], 0, 1], "the dash and alpha are put back");
    return ctx;
  };
  const offsets = [0, 60, 240].map((time) => sets(at("queued", queued, 2000 + time), "lineDashOffset")[0]);
  assert.deepEqual(plain(at("queued", queued, 2000).calls.log.find(([name]) => name === "setLineDash")), ["setLineDash", 2, 3]);
  assert.ok(new Set(offsets).size === 3, `the dashes march (${offsets})`);
  assert.equal(sets(at("queued", queued, 2240, true), "lineDashOffset")[0], 0, "reduced motion parks them");
  // The error ring pulses between .6 and .95 on a 1.3 s swell; at rest it sits near the legacy .85.
  const failed = steppedRecord(styles, "agent:error", { status: "error" });
  const seen = new Set();
  for (let step = 0; step < 40; step += 1) {
    failed.clock += 0.05;
    seen.add(alphaOf(strokeStyles(at("error", failed, 5000))[0]));
  }
  const levels = [...seen];
  assert.ok(levels.length >= 6 && Math.min(...levels) >= 0.59 && Math.max(...levels) <= 0.96 && Math.max(...levels) - Math.min(...levels) > 0.25, `it pulses (${levels.sort().join(", ")})`);
  const rest = at("error", steppedRecord(styles, "agent:error-still", { status: "error", still: true }), 5000, true);
  assert.equal(alphaOf(strokeStyles(rest)[0]), 0.84375);
  assert.deepEqual(rest.calls.texts.map(({ text, ink }) => [text, ink]), [["!", "rgba(255,212,121,1)"]], "the amber \"!\" badge");
  assert.ok(rest.calls.fills.some(({ style }) => style === `rgba(${plain(theme.amberWell).join(",")},1)`), "on the theme's amber well");
});

test("a new status pops its badge in with a little overshoot and sends one ring out", () => {
  const styles = loadNodeStyles();
  const theme = styles.theme(DARK);
  const record = steppedRecord(styles, "agent:finishing", { active: true, status: "running", time: 1000 });
  styles.stepMotion(record, { style: "orbs", active: false, selected: false, progress: null, orbit: 0, status: "done", time: 1000, frame: 99 }, 1 / 30, false);
  assert.equal(record.statusAt, 1000);
  const frame = (time) => {
    const ctx = recordingContext();
    styles.ring(ctx, "orbs", P, 10, TINT, { status: "done", ring: 13.5, time, still: false, detail: 3, motion: record, theme });
    return ctx;
  };
  const badgeScale = (ctx) => ctx.calls.log.find(([name]) => name === "scale")?.[1] ?? 0;
  const scales = [1000, 1080, 1160, 1240, 1320, 1600].map((time) => badgeScale(frame(time)));
  assert.equal(scales[0], 0, "not there yet the moment it turns");
  assert.ok(scales[2] > 1 && scales[2] < 1.12, `it overshoots a little (${scales[2]})`);
  assert.deepEqual(scales.slice(4), [1, 1], "and settles at full size by 320 ms");
  const done = frame(1600);
  assert.ok(done.calls.fills.some(({ style }) => style === `rgba(${plain(theme.doneWell).join(",")},1)`), "the tick sits on the theme's done well");
  assert.ok(done.calls.strokes.some(({ style }) => style === `rgba(${plain(theme.doneInk).join(",")},1)`), "in the theme's done ink");
  // The news ring leaves the status ring over 620 ms, then is gone.
  const flash = (ctx) => arcs(ctx).filter(([, , , radius, from, to]) => radius >= 13.5 && radius <= 20.5 && Math.abs(to - from - 2 * Math.PI) < 1e-5);
  assert.equal(flash(frame(1000)).length, 1);
  assert.ok(flash(frame(1300))[0][3] > flash(frame(1100))[0][3], "it grows");
  assert.equal(flash(frame(1700)).length, 0);
  // A status seen at first sight is not news: no pop, no ring.
  const seen = steppedRecord(styles, "agent:already-done", { status: "done", time: 1000 });
  const first = recordingContext();
  styles.ring(first, "orbs", P, 10, TINT, { status: "done", ring: 13.5, time: 1000, still: false, detail: 3, motion: seen, theme });
  assert.equal(badgeScale(first), 1);
  assert.equal(flash(first).length, 0);
  // A light theme brings its own wells and a darker ink.
  const light = styles.theme(LIGHT), pale = recordingContext();
  styles.ring(pale, "orbs", P, 10, TINT, { status: "error", ring: 13.5, time: 1000, still: true, detail: 3, motion: null, theme: light });
  assert.notEqual(plain(light.amberWell).join(","), plain(theme.amberWell).join(","));
  assert.ok(pale.calls.fills.some(({ style }) => style === `rgba(${plain(light.amberWell).join(",")},1)`));
  assert.notEqual(pale.calls.texts[0].ink, "rgba(255,212,121,1)", "the \"!\" darkens to read on a pale well");
  assert.ok(!pale.calls.strokes[0].style.startsWith("rgba(255,212,121,"), "and the amber ring deepens to read on a pale background");
  // Smaller nodes wear smaller badges.
  const small = recordingContext();
  styles.ring(small, "orbs", P, 5, TINT, { status: "done", ring: 8.5, time: 0, still: true, theme });
  assert.ok(badgeScale(small) < 1 && badgeScale(small) >= 0.64);
});

test("the hub dress breathes on a 6 s cycle in the hub's own phase, and the crew ring drifts", () => {
  const styles = loadNodeStyles();
  const theme = styles.theme(DARK);
  const hub = steppedRecord(styles, "__assistant__");
  const dress = (clock, crew = false, still = false) => {
    const ctx = recordingContext();
    hub.clock = clock;
    styles.hubDress(ctx, "orbs", P, 15, TINT, { crew, breathe: 0.5, time: 0, still, detail: 3, motion: still ? null : hub, theme });
    assert.equal(ctx.calls.saves, ctx.calls.restores);
    return ctx;
  };
  const radius = (clock) => arcs(dress(clock))[0][3];
  assert.ok(Math.abs(radius(3) - radius(9)) < 1e-9, "one breath every 6 animation seconds");
  const sweep = [0, 1, 2, 3, 4, 5].map((clock) => radius(clock));
  assert.ok(Math.max(...sweep) - Math.min(...sweep) > 2, `it breathes visibly (${sweep.map((value) => value.toFixed(2))})`);
  assert.ok(Math.max(...sweep) <= 15 + 7.5 + 1e-9 && Math.min(...sweep) >= 20 - 1e-9);
  const other = steppedRecord(styles, "__assistant__:other");
  other.clock = 3;
  const ctx = recordingContext();
  styles.hubDress(ctx, "orbs", P, 15, TINT, { crew: false, time: 0, still: false, detail: 3, motion: other, theme });
  assert.notEqual(arcs(ctx)[0][3], radius(3), "each hub breathes in its own phase");
  const still = plain(dress(0, true, true).calls.log);
  assert.deepEqual(plain(dress(4.2, true, true).calls.log), still, "reduced motion: one still pose");
  assert.equal(arcs(dress(0, false, true))[0][3], 15 + 5 + 1.25);
  const crew = dress(1.5, true);
  assert.equal(arcs(crew)[1][3], 46.5, "the crew ring rests at 3.1 radii");
  assert.notEqual(sets(crew, "lineDashOffset")[0], sets(dress(2.5, true), "lineDashOffset")[0], "and drifts round");
});

test("the work orbit runs on the integrated phase in the theme's orbit hue: four arcs, three segments, r + 9", () => {
  const styles = loadNodeStyles();
  const accent = styles.theme(DARK), plainDark = styles.theme({ background: "#050507", text: "#ece5d8" }), light = styles.theme(LIGHT);
  const record = steppedRecord(styles, "task:orbit", { active: true, orbit: 1.1 });
  const orbit = (theme, motion, still = false, phase = 0.4) => {
    const ctx = recordingContext();
    styles.orbit(ctx, "orbs", P, 12, TINT, { running: true, phase, ring: 21, time: 0, still, detail: 3, motion, theme });
    assert.equal(ctx.calls.saves, ctx.calls.restores);
    return ctx;
  };
  const ctx = orbit(accent, record);
  assert.equal(ctx.calls.arc, 4); assert.equal(ctx.calls.stroke, 4);
  assert.ok(arcs(ctx).every(([, x, y, radius]) => x === 50 && y === 50 && radius === 21));
  const head = arcs(ctx).at(-1);
  assert.ok(Math.abs(head[5] - record.orbit) < 1e-6, "the head segment ends at the record's orbit phase");
  assert.ok(strokeStyles(ctx).every((style) => style.startsWith("rgba(54,209,255,")), "in the theme's second hue");
  assert.ok(strokeStyles(orbit(plainDark, record)).every((style) => style.startsWith("rgba(125,178,255,")), "a blue that reads on a dark theme");
  assert.ok(strokeStyles(orbit(light, record)).every((style) => style.startsWith("rgba(52,96,178,")), "a deeper blue on a light one");
  assert.deepEqual(strokeStyles(ctx).map(alphaOf), [0.22, 0.32, 0.56, 0.8], "a faint track, then the comet fading toward its tail");
  const still = orbit(accent, record, true, Math.PI / 3);
  assert.ok(Math.abs(arcs(still).at(-1)[5] - Math.PI / 3) < 1e-6, "reduced motion parks it at the caller's still phase");
  assert.ok(Math.abs(arcs(orbit(accent, null, false, 0.9)).at(-1)[5] - 0.9) < 1e-6, "without a record, the caller's phase");
});

test("an arriving node sends a bright ring a radius out, and reduced motion lets it simply appear", () => {
  const styles = loadNodeStyles();
  const record = steppedRecord(styles, "task:new", { frames: 4 });
  const arrive = (t01, still = false, alpha = 0.8) => {
    const ctx = recordingContext();
    assert.equal(styles.arrival(ctx, "halo", P, 12, TINT, t01, { alpha, time: 0, still, detail: 3, motion: still ? null : record }), true);
    assert.equal(ctx.calls.saves, ctx.calls.restores); assert.equal(ctx.globalAlpha, 1);
    return ctx;
  };
  const early = arrive(0.1), late = arrive(0.7);
  const ringOf = (ctx) => arcs(ctx)[0][3];
  const eased = (t) => 1 - (1 - t) ** 3;
  assert.ok(Math.abs(ringOf(early) - 12 * (1 + eased(0.1))) < 1e-6 && Math.abs(ringOf(late) - 12 * (1 + eased(0.7))) < 1e-6, "the ring rides out on an ease-out");
  assert.ok(Math.abs(early.calls.alphas[0] - 0.8 * 0.7 * (1 - eased(0.1))) < 1e-12, "at .7 × (1 − e) of the caller's alpha");
  assert.ok(late.calls.lineWidths[0] < early.calls.lineWidths[0], "thinning as it goes");
  assert.ok(late.calls.alphas.every((alpha) => alpha < early.calls.alphas[0]), "and fades as it goes");
  assert.equal(late.calls.stroke, 2, "an echo follows a beat behind");
  assert.ok(late.calls.reach <= 12 * 2.25, `inside 2.25r (${late.calls.reach})`);
  assert.equal(arrive(0.5, true).calls.log.length, 0, "reduced motion draws no arrival");
});

test("every shared overlay builds nothing per frame, never blurs, and hands the canvas back", () => {
  const styles = loadNodeStyles();
  const theme = styles.theme(DARK);
  const records = { agent: steppedRecord(styles, "agent:perf", { active: true, status: "running" }), hub: steppedRecord(styles, "hub:perf"), task: steppedRecord(styles, "task:perf", { active: true, orbit: 1.1 }) };
  const ctx = recordingContext();
  ctx.globalAlpha = 0.7; ctx.lineWidth = 3; ctx.strokeStyle = "#123456";
  for (let frame = 0; frame < 60; frame += 1) {
    const time = 1000 + frame * 33;
    for (const status of ["running", "queued", "error", "done"]) styles.ring(ctx, "crystal", P, 10, TINT, { status, ring: 13.5, time, still: false, detail: frame % 4, motion: records.agent, theme });
    styles.hubDress(ctx, "crystal", P, 15, TINT, { crew: true, time, still: false, detail: 3, motion: records.hub, theme });
    styles.orbit(ctx, "crystal", P, 12, TINT, { running: true, phase: 1, ring: 21, time, still: false, detail: 3, motion: records.task, theme });
    styles.arrival(ctx, "crystal", P, 12, TINT, (frame % 20) / 20, { alpha: 0.7, time, still: false, detail: 3, motion: records.task });
  }
  assert.equal(gradientsBuilt(ctx), 0);
  assert.deepEqual(ctx.calls.shadowBlurs, []);
  assert.equal(ctx.calls.saves, ctx.calls.restores);
  assert.deepEqual([ctx.globalAlpha, ctx.lineWidth, ctx.strokeStyle, ctx.lineDashOffset, ctx.getLineDash(), plain(ctx.matrix())], [0.7, 3, "#123456", 0, [], [1, 0, 0, 1, 0, 0]]);
  assert.ok(ctx.calls.alphas.every((alpha) => alpha <= 0.7 + 1e-12), "no overlay brightens past the caller's alpha");
  const overlays = NODE_STYLES_SOURCE;
  const body = overlays.slice(overlays.indexOf("// ===== overlays ====="), overlays.indexOf("// ===== wires ====="));
  for (const banned of ["shadowBlur", "filter =", "Array.from", ".filter(", ".map(", "createRadialGradient", "createLinearGradient", "createConicGradient", "rgba(125,178,255"]) assert.ok(!body.includes(banned), `the overlays avoid ${banned}`);
  assert.ok(!/if \(style === /.test(body), "the defaults never switch on a style name");
});

// ===== the Command view's own marks (idle.js) =====

test("a held done task stays on the board through its grace, then flies home", () => {
  let now = 1_000_000;
  const host = { id: "session:a", kind: "session", x: 10, y: 20, z: 0 };
  const task = { id: "t1", title: "Rename the biome", status: "done", doneAt: now };
  const state = { nodes: [], edges: [], fx: new Map(), doneHold: new Map(), selected: null };
  const dying = [], finalized = [];
  const env = vm.createContext({
    state, Math, Map, Date: { now: () => now },
    DONE_HOLD_MS: 15000, DONE_ACK_MS: 4000, NODE_ABSORB_TTL: 6000,
    targetHostNode: () => null, noMotion: () => false,
    appendDyingNode: (id) => dying.push(id), finalizeAbsorb: (id) => { finalized.push(id); state.fx.delete(id); },
  });
  vm.runInContext(section("function markAbsorb(", "// What finished work folds back into"), env);
  vm.runInContext(section("function appendDoneHoldNodes(", "// After a rebuild: entries mid-flight"), env);
  vm.runInContext(section("function sweepFx(", "// The flight ended (or never had to be seen)"), env);
  vm.runInContext(section("function stepDoneHold(", "// Clicking a finished node"), env);
  // The task just finished: takeTasks left its entry and a hold behind.
  state.fx.set("task:t1", { bornAt: -Infinity, absorbAt: null, task, builder: false, anchorId: host.id, wasRendered: true, lastX: 40, lastY: 50, lastZ: 0 });
  state.doneHold.set("task:t1", { task, since: now, ackedAt: null });
  // refreshGraphImpl's part: every entry unseen, the board rebuilt, then swept.
  const refresh = () => {
    for (const fx of state.fx.values()) fx.seen = false;
    state.nodes = [host]; state.edges = [];
    env.appendDoneHoldNodes(); env.sweepFx();
    return state.nodes.find((node) => node.id === "task:t1") ?? null;
  };
  for (const at of [0, 4000, 8000, 12000, 14900]) {
    now = 1_000_000 + at;
    env.stepDoneHold(now);
    const held = refresh();
    assert.ok(held?.doneHold, `the finished node is still held ${at / 1000} s in`);
    assert.deepEqual([held.x, held.y], [40, 50], "at the spot it finished on");
    assert.ok(state.fx.has("task:t1"), "its life-cycle entry survives the sweep");
  }
  // The grace runs out: the node is marked to fly home and the next rebuild flies it.
  now = 1_000_000 + 15100;
  env.stepDoneHold(now);
  assert.equal(state.doneHold.has("task:t1"), false);
  assert.equal(state.fx.get("task:t1")?.absorbAt, now, "the flight home is armed");
  refresh();
  assert.deepEqual(dying, ["task:t1"], "and the absorb flight plays");
  assert.deepEqual(finalized, []);
});

function badgeEnv(theme = null) {
  const state = { nodeTheme: theme };
  const rgba = (triple, alpha) => `rgba(${triple.join(",")},${alpha})`;
  const env = vm.createContext({ state, Math, rgba, NODE_RGB: { done: [104, 236, 164] }, window: {} });
  vm.runInContext(section("  const DONE_BADGE_WELL", "  function drawWorkOrbit("), env);
  return env;
}

test("the done-hold badge beats, echoes and wiggles, while its label box never moves", () => {
  const env = badgeEnv();
  const node = { id: "task:t1", _m: { seed: 0.1 } };
  const frame = (time, still = false) => {
    const ctx = recordingContext();
    env.drawDoneBadge(ctx, node, { x: 100, y: 100 }, 10, time, still);
    assert.equal(ctx.calls.saves, ctx.calls.restores);
    return ctx;
  };
  const excl = [];
  const scaleOf = (ctx) => ctx.calls.log.find(([name]) => name === "scale")[1];
  const angleOf = (ctx) => ctx.calls.log.find(([name]) => name === "rotate")[1];
  const scales = [], angles = [];
  for (let time = 0; time < 4800; time += 40) {
    const ctx = frame(time);
    excl.push(plain(node._excl));
    scales.push(scaleOf(ctx)); angles.push(angleOf(ctx));
  }
  assert.ok(excl.every((box) => box.x === 116 && box.y === 85 && box.r === 9), "the exclusion box is fixed");
  assert.ok(Math.max(...scales) > 1.09 && Math.min(...scales) === 1, "it beats up to a tenth bigger");
  assert.ok(angles.filter((angle) => angle !== 0).length > 5 && Math.max(...angles.map(Math.abs)) > 0.1, "and wiggles once a cycle");
  assert.ok(angles.filter((angle) => angle !== 0).length < angles.length / 4, "for about half a second of its 4.8 s");
  const echoes = [0, 200, 400, 600, 800, 1000, 1200, 1400].map((time) => frame(time).calls.stroke);
  assert.ok(echoes.includes(3) && echoes.includes(1), "on every beat the node pulses a ring and an echo leaves the badge");
  const still = [0, 777, 99999].map((time) => plain(frame(time, true).calls.log));
  assert.deepEqual(still[1], still[0]); assert.deepEqual(still[2], still[0]);
  assert.deepEqual([scaleOf(frame(0, true)), angleOf(frame(0, true)), frame(0, true).calls.stroke], [1, 0, 1], "reduced motion: a still badge, no echo");
  const texts = frame(0, true).calls.texts;
  assert.deepEqual(texts.map(({ text, ink }) => [text, ink]), [["!", "rgba(167,229,192,1)"]], "the legacy greens without a theme");
  const themed = badgeEnv(loadNodeStyles().theme(LIGHT));
  const ctx = recordingContext();
  themed.drawDoneBadge(ctx, node, { x: 100, y: 100 }, 10, 0, true);
  assert.notEqual(ctx.calls.texts[0].ink, "rgba(167,229,192,1)", "a light theme's own ink");
});

test("the work-left meter eases on the record's progress over the theme's track and fades with the work", () => {
  const styles = loadNodeStyles();
  const theme = styles.theme(DARK);
  const env = badgeEnv(theme);
  env.window.MefiNodeStyles = styles;
  const record = steppedRecord(styles, "task:meter", { active: true, progress: 0.2 });
  const flags = { style: "orbs", active: true, selected: false, progress: 0.8, orbit: 0, status: null, time: 2000, frame: 70 };
  styles.stepMotion(record, flags, 1 / 30, false);
  const node = { id: "task:meter", progress: 0.8, _m: record, _fade: 1 };
  const meter = (radius = 12, active = true, still = false) => {
    const ctx = recordingContext();
    env.drawProgressMeter(ctx, node, { x: 100, y: 100 }, radius, TINT, active, false, 2000, still);
    assert.equal(ctx.calls.saves, ctx.calls.restores);
    return ctx;
  };
  const bars = (ctx) => ctx.calls.log.filter(([name]) => name === "roundRect");
  const easing = bars(meter());
  assert.deepEqual(easing[0].slice(1), [100 - 9.6, 100 + 12 + 5, 19.2, 2, 1], "width 1.6r (14–22 px), 2 px high, under the node");
  assert.ok(easing[1][3] > 19.2 * 0.2 && easing[1][3] < 19.2 * 0.8, "the fill eases toward the new fraction");
  assert.equal(meter().calls.fills[0].style, `rgba(${plain(theme.track).join(",")},0.9)`, "on the theme's track");
  assert.deepEqual([bars(meter(4))[0][3], bars(meter(30))[0][3]], [14, 22], "never shorter than 14 px or longer than 22");
  assert.equal(bars(meter(12, true, true))[1][3], 19.2 * 0.8, "reduced motion shows the fraction itself");
  // The meter fades out with the work instead of vanishing.
  flags.active = false;
  styles.stepMotion(record, flags, 1 / 30, false);
  const fading = meter(12, false);
  assert.ok(fading.calls.alphas[0] > 0.5 && fading.calls.alphas[0] < 1);
  for (let frame = 0; frame < 120; frame += 1) styles.stepMotion(record, flags, 1 / 30, false);
  assert.equal(meter(12, false).calls.fill, 0);
  node.progress = null;
  assert.equal(meter().calls.fill, 0, "never an inferred fraction");
});

test("the node loop cross-fades tints, pops the hover, pulses the clash rim and hands labels the style's reach", () => {
  const frame = section("function drawFrame(", "function measure(");
  const loop = frame.slice(frame.indexOf("    for (const { node, p } of ordered) {"), frame.indexOf("    // Checkpoint notes stay discoverable"));
  for (const line of [
    "tint = nodeStyles.shownTint(motion, tint, time, still);",
    "const pop = motion ? 1 + 0.05 * motion.sel : 1;",
    "* nodeScale) * pop;",
    "node._styleReach = nodeStyles ? radius * nodeStyles.reach(state.nodeStyle ?? \"orbs\", motion) : 0;",
    "drawProgressMeter(ctx, node, p, radius, tint, active, Boolean(selected), time, still);",
    "if (hold && !hold.ackedAt) drawDoneBadge(ctx, node, p, radius, time, still);",
    "rgba(NODE_RGB.collision, 0.55)",
  ]) assert.ok(loop.includes(line), `the node loop carries ${line}`);
  assert.ok(loop.indexOf("nodeStyles.stepMotion(") < loop.indexOf("const radius ="), "the motion steps before the radius reads its eased hover");
  for (const gone of ["motion.tint = tint", "#303947", "#173025", "#a7e5c0", "fillRect("]) assert.ok(!loop.includes(gone), `the loop no longer carries ${gone}`);
  // appendDoneHoldNodes keeps the held entry through the sweep.
  assert.ok(section("function appendDoneHoldNodes(", "// After a rebuild").includes("fx.seen = true;"));
});

test("labels step clear of a look that reaches past its node", () => {
  const area = { x: 0, y: 0, w: 1440, h: 900 };
  const state = { labels: "auto", query: "", matchSet: new Set(), labelRects: [], labelWidths: new Map(), hudRects: [], hudRectsAt: 0, nodes: [] };
  const env = vm.createContext({ state, el: { width: 1440, height: 900, ctx: {} }, Date, Math, usableArea: () => area, emphasis: () => 1, colorOf: () => [1, 2, 3], rgba: () => "#000", NODE_RGB: {} });
  vm.runInContext(section("const LABEL_FONT =", "// Node life-cycle:"), env);
  vm.runInContext(section("function measure(ctx", "// ---------- hover tooltip"), env);
  const node = { id: "sigil", _pr: 12 }, projected = [{ node, p: { x: 200, y: 200 } }];
  // A plain node blocks 3 px past its rim, and labels keep LABEL_PAD (8) clear.
  const surface = { x: 200 + 12 + 3 + 8 + 1, y: 195, w: 30, h: 10 };
  assert.equal(env.nodeLabelBlocker(projected)(surface, null), false, "clear of a plain 12 px node");
  node._styleReach = 12 * 1.6;
  assert.equal(env.nodeLabelBlocker(projected)(surface, null), true, "a look drawn to 1.6r blocks as far");
  node._styleReach = 0;
  assert.equal(env.nodeLabelBlocker(projected)(surface, null), false);
});
