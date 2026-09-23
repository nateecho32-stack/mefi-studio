// renderer/node-styles.js, the "wires" section: the wires, travelling pulses
// and landings every free style shares (WIRE_DEFAULTS), and the section's
// frame-cost rules. The module loads whole into a bare vm
// (tests/fixtures/node-styles-harness.mjs); the Command view's and the rail's
// call sites are pinned in command_graph and command_visuals.
import test from "node:test";
import assert from "node:assert/strict";
import { NODE_STYLES_SOURCE as source, loadNodeStyles, recordingContext, gradientsBuilt, plain } from "./fixtures/node-styles-harness.mjs";

const FREE = ["orbs", "glass", "minimal", "halo", "crystal"];
const TINT = [120, 180, 220];
const A = { x: 20, y: 80 }, B = { x: 260, y: 40 };
const lines = source.replace(/\r\n/g, "\n").split("\n");

// The code of one banner section, comments dropped.
function sectionOf(name) {
  const start = lines.indexOf(`// ===== ${name} =====`);
  assert.ok(start >= 0, `missing the ${name} banner`);
  let end = start + 1;
  while (end < lines.length && !/^\/\/ ===== .+ =====$/.test(lines[end])) end += 1;
  return lines.slice(start + 1, end).filter((line) => !/^\s*\/\//.test(line)).join("\n");
}

// A wire as the Command view hands it over (drawGraphConnectionsImpl).
const wire = (extra = {}) => ({
  kind: "task", tint: TINT, alpha: 0.55, width: 1.4, dash: [2, 4], march: false, flow: false, double: false, active: false,
  inspected: false, curved: false, cp: null, far: false, time: 0, still: false, seed: 0.3, rA: 9, rB: 12, detail: 3, lifetime: 1, ...extra,
});
const working = (extra = {}) => wire({ active: true, march: true, flow: true, ...extra });
// A pulse as idle.js and the rail queue them.
const pulse = (extra = {}) => ({ color: "#f1dcae", glow: "#e6c98d", wave: false, small: false, packet: false, start: 0, duration: 900, ...extra });
const look = (extra = {}) => ({ kind: "dot", time: 0, still: false, rTo: 12, detail: 3, pulse: null, motion: null, cp: null, ...extra });
const draw = (styles, style, o, ctx = recordingContext({ center: B })) => { const answer = styles.wire(ctx, style, A, B, o); return { ctx, answer, calls: ctx.calls }; };

test("the wires section keeps a frame free of allocations, gradients per frame and shadowBlur", () => {
  const code = sectionOf("wires");
  for (const banned of ["Array.from", ".filter(", ".map(", "shadowBlur", "shadowColor", ".filter =", "createLinearGradient", "createConicGradient", "new Array", "Path2D"]) {
    assert.ok(!code.includes(banned), `the wires section never uses ${banned}`);
  }
  assert.equal(code.split("createRadialGradient(").length - 1, 1, "one radial, the cached light sprite");
  assert.ok(code.includes("sprites.size >= LIGHT_SPRITES_MAX") && code.includes("const LIGHT_SPRITES_MAX = 32;"), "the sprites are capped at 32 a canvas");
  assert.ok(!/style === "/.test(code) && !/style !== "/.test(code), "the defaults never branch on a style's name (a style's feel is its WIRE_PACKS row)");
  assert.ok(code.includes("const WIRE_DEFAULTS = { wire: wireDefault, surge: surgeDefault, land: landDefault };"));
});

test("every free style draws its own wires, pulses and landings", () => {
  const styles = loadNodeStyles();
  for (const style of FREE) {
    const ctx = recordingContext();
    assert.equal(styles.wire(ctx, style, A, B, wire()), true, `${style}: wire`);
    assert.equal(styles.surge(ctx, style, A, B, 0.5, pulse(), look()), true, `${style}: surge`);
    assert.equal(styles.land(ctx, style, B, 12, TINT, 0.3, look()), true, `${style}: land`);
    assert.equal(ctx.calls.saves, ctx.calls.restores, `${style}: saves === restores`);
    assert.deepEqual(ctx.calls.shadowBlurs, [], `${style}: never sets shadowBlur`);
  }
});

test("a quiet wire is exactly one round-capped stroke, as the caller asked for it", () => {
  const styles = loadNodeStyles();
  for (const style of FREE) {
    for (const [kind, dash] of [["task", [2, 4]], ["session", []], ["todo", []], ["folded", [1, 5]], ["tether", [6, 4]]]) {
      const { calls, answer, ctx } = draw(styles, style, wire({ kind, dash }));
      assert.equal(answer, true);
      assert.equal(calls.stroke, 1, `${style} ${kind}: one stroke`);
      assert.deepEqual(calls.strokes[0], { style: "rgba(120,180,220,1)", alpha: 0.55, width: 1.4 }, `${style} ${kind}: its tint, alpha and width`);
      const at = calls.log.findIndex(([name]) => name === "stroke");
      assert.ok(calls.log.slice(0, at).some(([name, value]) => name === "set:lineCap" && value === "round"), `${style} ${kind}: round caps`);
      assert.deepEqual(plain(calls.log.filter(([name]) => name === "setLineDash").at(-1)?.slice(1) ?? []), dash, `${style} ${kind}: its dash`);
      assert.equal(gradientsBuilt(ctx), 0);
      assert.equal(ctx.lineCap, "butt", "the canvas comes back as it was");
      assert.deepEqual(ctx.getLineDash(), []);
    }
    // The far (blurred) pen gets the line alone, even for a working wire.
    assert.equal(draw(styles, style, working({ far: true })).calls.stroke, 1, `${style}: the far pen draws no overlays`);
    // A working wire with motion on but not marching (a Next branch) flows nothing.
    const quiet = draw(styles, style, wire({ active: true, march: false, flow: false }));
    assert.equal(quiet.calls.stroke, style === "minimal" ? 1 : 3, `${style}: an active wire that carries no work glows but does not flow`);
  }
});

test("a lit wire lays a soft glow under the line; minimal keeps its bare line", () => {
  const styles = loadNodeStyles();
  for (const style of FREE) {
    const { calls } = draw(styles, style, wire({ inspected: true }));
    if (style === "minimal") { assert.equal(calls.stroke, 1); continue; }
    assert.equal(calls.stroke, 3, `${style}: two glow strokes then the line`);
    const [outer, inner, line] = calls.strokes;
    assert.deepEqual(line, { style: "rgba(120,180,220,1)", alpha: 0.55, width: 1.4 }, `${style}: the line is still the caller's, last`);
    assert.ok(outer.width > inner.width && inner.width > line.width, `${style}: the glow is wider than the line, the outer widest`);
    assert.ok(outer.alpha < inner.alpha && inner.alpha < line.alpha, `${style}: and fainter`);
    assert.ok(calls.lineWidths.every((width) => width <= 5), `${style}: within the 5 px budget`);
    // An active wire glows brighter than an inspected one; below T2 one glow stroke.
    const active = draw(styles, style, wire({ active: true }));
    assert.ok(active.calls.strokes[1].alpha > inner.alpha, `${style}: work glows brighter than a look`);
    assert.equal(draw(styles, style, wire({ inspected: true, detail: 1 })).calls.stroke, 2, `${style}: one glow stroke below T2`);
    // The rail's hair-thin lines take a narrower glow.
    const rail = draw(styles, style, wire({ inspected: true, rail: true })).calls.strokes[0];
    assert.ok(rail.width < outer.width && rail.alpha < outer.alpha, `${style}: the rail's glow is narrower and fainter`);
  }
});

test("a working wire carries the style's flow: comet, sheen, bead, sparks", () => {
  const styles = loadNodeStyles();
  // glow strokes + the line + the flow's strokes (the head's light is a fill)
  const expected = { orbs: 2 + 1 + 3, glass: 2 + 1 + 2, minimal: 1 + 1, halo: 2 + 1 + 4, crystal: 2 + 1 + 3 };
  const lights = { orbs: 1, glass: 0, minimal: 0, halo: 1, crystal: 1 };
  for (const style of FREE) {
    const { calls, ctx } = draw(styles, style, working({ time: 700 }));
    assert.equal(calls.stroke, expected[style], `${style}: strokes`);
    assert.equal(calls.fill, lights[style], `${style}: the light round the flow's head`);
    assert.ok(calls.lineWidths.every((width) => width <= 5), `${style}: within the 5 px budget`);
    assert.ok(calls.alphas.every((alpha) => alpha > 0 && alpha <= 1), `${style}: alphas`);
    // Flow strokes are single dashes moved by the offset: a scratch pattern
    // refilled each time (setLineDash copies it), the last dash the caller's
    // own before the flow.
    const dashes = calls.log.filter(([name]) => name === "setLineDash").map((entry) => entry.slice(1));
    assert.ok(dashes.length >= 2, `${style}: the flow sets its own dash`);
    assert.deepEqual(ctx.getLineDash(), [], `${style}: and the canvas gets its own back`);
  }
});

test("flows run with the clock, stagger by seed, and hold a designed pose under reduced motion", () => {
  const styles = loadNodeStyles();
  const log = (style, o) => plain(draw(styles, style, o).calls.log);
  for (const style of FREE) {
    assert.notDeepEqual(log(style, working({ time: 0 })), log(style, working({ time: 400 })), `${style}: the flow moves`);
    assert.notDeepEqual(log(style, working({ time: 400, seed: 0.1 })), log(style, working({ time: 400, seed: 0.6 })), `${style}: wires do not flow in lockstep`);
    const still = (time) => log(style, working({ still: true, march: false, time }));
    assert.deepEqual(still(0), still(1234), `${style}: still`);
    assert.deepEqual(still(0), still(99999), `${style}: still`);
    const held = draw(styles, style, working({ still: true, march: false })).calls.stroke;
    const none = draw(styles, style, working({ still: true, march: false, flow: false })).calls.stroke;
    assert.ok(held > none, `${style}: reduced motion still shows the work, held mid-wire`);
  }
});

test("a curved wire keeps the caller's S-curve, the hub link stays doubled, and flows follow the curve", () => {
  const styles = loadNodeStyles();
  const cp = { x1: 20, y1: 60, x2: 260, y2: 60 };
  for (const style of FREE) {
    const { calls } = draw(styles, style, working({ curved: true, cp }));
    const curves = calls.log.filter(([name]) => name === "bezierCurveTo");
    assert.ok(curves.length >= 1 && curves.every((entry) => plain(entry.slice(1)).join() === [20, 60, 260, 60, 260, 40].join()), `${style}: the S-curve through the caller's controls`);
    assert.equal(calls.lineTo, style === "crystal" ? 2 : 0, `${style}: no straight chord drawn (crystal's one glint aside: two arms)`);
    const hub = draw(styles, style, wire({ kind: "hub", double: true, dash: [], width: 1, alpha: 0.34, active: true, march: true, flow: true })).calls;
    assert.equal(hub.strokes.at(-1).alpha, 0.34, `${style}: the doubled line last`);
    const moves = hub.log.slice(hub.log.findLastIndex(([name]) => name === "beginPath")).filter(([name]) => name === "moveTo").length;
    assert.equal(moves, 2, `${style}: two parallel lines in one stroke`);
    assert.ok(hub.stroke <= 3, `${style}: no flow on the hub link`);
  }
});

test("detail tiers trim the overlays from the tail down, never the line", () => {
  const styles = loadNodeStyles();
  for (const style of FREE) {
    const counts = [0, 1, 2, 3].map((detail) => draw(styles, style, working({ detail, time: 700 })).calls.stroke);
    for (let index = 1; index < counts.length; index += 1) assert.ok(counts[index] >= counts[index - 1], `${style}: ${counts}`);
    if (style !== "minimal") assert.ok(counts[0] < counts[3], `${style}: T0 draws less than T3 (${counts})`);
    assert.ok(counts[0] >= 2, `${style}: the line and the flow's head survive T0`);
    // Between two tiers the extras fade in with the thinner end's radius.
    const edge = draw(styles, style, working({ detail: 2, rA: 8.9, rB: 20, time: 700 })).calls.alphas;
    const full = draw(styles, style, working({ detail: 2, rA: 12, rB: 20, time: 700 })).calls.alphas;
    assert.ok(edge.reduce((sum, alpha) => sum + alpha, 0) <= full.reduce((sum, alpha) => sum + alpha, 0) + 1e-9, `${style}: fading in at the tier's cut`);
  }
});

test("every wire alpha follows the canvas alpha and the wire's lifetime", () => {
  const styles = loadNodeStyles();
  for (const style of FREE) {
    const full = draw(styles, style, working({ time: 700 })).calls.alphas;
    const ctx = recordingContext({ center: B });
    ctx.globalAlpha = 0.5;
    const dimmed = draw(styles, style, working({ time: 700 }), ctx).calls.alphas;
    assert.ok(dimmed.length === full.length && dimmed.every((alpha, index) => Math.abs(alpha - 0.5 * full[index]) < 1e-12), `${style}: scaled by the canvas alpha`);
    assert.equal(ctx.globalAlpha, 0.5, `${style}: and it comes back`);
    const fading = draw(styles, style, working({ time: 700, lifetime: 0.4, alpha: 0.22 })).calls.alphas;
    assert.ok(fading.every((alpha, index) => alpha <= full[index] + 1e-12), `${style}: a fading wire fades its overlays too`);
  }
});

test("a steady stream of wires builds each light once and nothing after", () => {
  const styles = loadNodeStyles();
  const warm = [230, 201, 141], teal = [87, 255, 154];
  for (const style of FREE) {
    const ctx = recordingContext();
    for (let frame = 0; frame < 60; frame += 1) {
      const time = frame * 33.3;
      for (const tint of [TINT, warm, teal]) styles.wire(ctx, style, A, B, working({ tint, time, seed: frame % 7 / 7 }));
      styles.wire(ctx, style, A, B, wire({ inspected: true, time }));
      if (frame === 0) assert.ok(gradientsBuilt(ctx) <= 3, `${style}: at most one light per tint`);
    }
    assert.equal(ctx.calls.radial, ["glass", "minimal"].includes(style) ? 0 : 3, `${style}: nothing built after the first frame`);
    assert.equal(ctx.calls.linear + ctx.calls.conic, 0);
    assert.equal(styles.cacheStats(ctx).entries, 0, "the lights live outside the node paint cache");
  }
});

test("on a light theme the flow leans dark and carries no light", () => {
  const styles = loadNodeStyles();
  const light = styles.theme({ background: "#f2efe6", text: "#1c1b18" });
  const dark = styles.theme({ background: "#050507", text: "#ece5d8" });
  for (const style of FREE) {
    const onDark = draw(styles, style, working({ time: 700, theme: dark })).calls;
    const onLight = draw(styles, style, working({ time: 700, theme: light })).calls;
    assert.equal(onLight.fill, 0, `${style}: no light sprite on a pale ground`);
    assert.equal(onLight.radial, 0);
    const flowInks = (calls) => calls.strokes.slice(-1).map((stroke) => stroke.style);
    if (style !== "minimal") assert.notDeepEqual(flowInks(onLight), flowInks(onDark), `${style}: the head's ink follows the theme`);
    const darkest = (calls) => Math.min(...calls.strokes.map(({ style: ink }) => { const [r, g, b] = ink.match(/\d+/g).map(Number); return r + g + b; }));
    assert.ok(darkest(onLight) < darkest(onDark), `${style}: toward the theme's highlight, which is dark there`);
  }
});

// ---------- pulses ----------

test("a travelling pulse is drawn from pieces of its own path and cached light, never a gradient per frame or shadowBlur", () => {
  const styles = loadNodeStyles();
  for (const style of FREE) {
    for (const spec of [pulse(), pulse({ small: true }), pulse({ wave: true }), pulse({ wave: true, packet: true, color: "#ffe9a8" })]) {
      const ctx = recordingContext();
      const kind = spec.wave ? "wave" : "dot";
      const one = pulse(spec);
      let first = null;
      for (let step = 1; step < 30; step += 1) {
        assert.equal(styles.surge(ctx, style, A, B, step / 30, one, look({ kind, time: step * 33 })), true);
        if (step === 1) first = gradientsBuilt(ctx);
      }
      assert.equal(gradientsBuilt(ctx), first, `${style} ${kind}: the lights are built once`);
      assert.ok(first <= 2, `${style} ${kind}: one light per colour (${first})`);
      assert.equal(ctx.calls.linear, 0, `${style} ${kind}: no linear gradient (the old tail)`);
      assert.deepEqual(ctx.calls.shadowBlurs, [], `${style} ${kind}: no shadowBlur`);
      assert.ok(ctx.calls.quadraticCurveTo > 0, `${style} ${kind}: the tail is quadratic sub-curves`);
      assert.equal(ctx.calls.bezierCurveTo, 0);
      assert.equal(ctx.calls.saves, ctx.calls.restores);
      assert.ok(ctx.calls.lineWidths.every((width) => width <= 5));
      assert.deepEqual(plain(one._rgb), [241, 220, 174].map((value, index) => spec.color === "#ffe9a8" ? [255, 233, 168][index] : value), "the parsed colour rides on the pulse");
    }
  }
});

test("a wave bows like a plucked string, and a pulse on a branch rides the branch's S-curve", () => {
  const styles = loadNodeStyles();
  const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy);
  const bow = Math.min(14, len * 0.12); // at t .5 the envelope is 1
  const ctx = recordingContext();
  styles.surge(ctx, "orbs", A, B, 0.5, pulse({ wave: true }), look({ kind: "wave" }));
  const [, cx, cy] = ctx.calls.log.find(([name]) => name === "quadraticCurveTo");
  const off = Math.hypot(cx - (A.x + B.x) / 2, cy - (A.y + B.y) / 2);
  assert.ok(Math.abs(off - bow) < 1e-6, `the wake bows ${bow} px off the chord (${off})`);
  const cp = { x1: A.x, y1: 60, x2: B.x, y2: 60 };
  for (const kind of ["dot", "wave"]) {
    const curve = recordingContext();
    styles.surge(curve, "orbs", A, B, 0.5, pulse({ wave: kind === "wave" }), look({ kind, cp }));
    assert.ok(curve.calls.bezierCurveTo > 0 && curve.calls.quadraticCurveTo === 0, `${kind}: cubic pieces of the branch's S-curve`);
  }
  // The pieces meet: each starts where the one before it ended.
  const pieces = recordingContext();
  styles.surge(pieces, "orbs", A, B, 0.7, pulse(), look());
  const starts = pieces.calls.log.filter(([name]) => name === "moveTo").map((entry) => entry.slice(1));
  const ends = pieces.calls.log.filter(([name]) => name === "quadraticCurveTo").map((entry) => entry.slice(3));
  for (let index = 1; index < ends.length; index += 1) assert.deepEqual(starts[index], ends[index - 1], "a continuous tail");
});

test("each free style has its own pulse head and landing", () => {
  const styles = loadNodeStyles();
  const signature = (style) => {
    const ctx = recordingContext();
    styles.surge(ctx, style, A, B, 0.5, pulse(), look());
    styles.land(ctx, style, B, 12, [241, 220, 174], 0.3, look({ pulse: pulse() }));
    const c = ctx.calls;
    return `${c.arc}/${c.fill}/${c.stroke}/${c.lineTo}/${c.radial}`;
  };
  const seen = new Set(FREE.map(signature));
  assert.equal(seen.size, FREE.length, `five different pulses (${[...seen]})`);
  // Minimal stays flat: no light anywhere, one thin ring on landing.
  const flat = recordingContext();
  styles.surge(flat, "minimal", A, B, 0.9, pulse(), look());
  styles.surge(flat, "minimal", A, B, 0.5, pulse({ wave: true, packet: true }), look({ kind: "wave" }));
  styles.land(flat, "minimal", B, 12, TINT, 0.3, look());
  assert.equal(flat.calls.radial, 0);
  // Crystal's landing throws four rays; halo's sends a second ring after the first.
  const rays = recordingContext();
  styles.land(rays, "crystal", B, 12, TINT, 0.3, look());
  assert.equal(rays.calls.lineTo, 4);
  const rings = recordingContext();
  styles.land(rings, "halo", B, 12, TINT, 0.5, look());
  assert.equal(rings.calls.arc, 3, "the bloom, the ring and the second ring");
});

test("reduced motion draws one static flash; a pulse not under way draws nothing", () => {
  const styles = loadNodeStyles();
  for (const style of FREE) {
    const flash = (time) => { const ctx = recordingContext(); styles.surge(ctx, style, A, B, 1, pulse(), look({ still: true, time })); return ctx.calls; };
    assert.equal(flash(0).stroke, 1, `${style}: one stroke`);
    assert.deepEqual(plain(flash(0).log), plain(flash(5000).log), `${style}: the same flash whenever`);
    assert.equal(flash(0).quadraticCurveTo, 1, "the whole line, one piece");
    // The rail keeps drawing a pulse's frames under reduced motion: its flash fades with the pulse's life.
    const rail = recordingContext();
    styles.surge(rail, style, A, B, 0.75, pulse(), look({ still: true, rail: true }));
    assert.ok(Math.abs(rail.calls.strokes[0].alpha - 0.5 * 0.25) < 1e-9);
    const early = recordingContext();
    assert.equal(styles.surge(early, style, A, B, -0.2, pulse(), look()), true, "a hop queued for later is handled");
    assert.equal(early.calls.log.length, 0, "and draws nothing yet");
    // Landing under reduced motion (u = 1) or past its tail: nothing left to draw.
    const done = recordingContext();
    assert.equal(styles.land(done, style, B, 12, TINT, 1, look()), true);
    assert.equal(styles.land(done, style, B, 12, TINT, 0.2, look({ still: true })), true);
    assert.equal(done.calls.log.length, 0);
  }
});

test("a landing swells off the rim and fades over its tail, continuing the arrival bloom", () => {
  const styles = loadNodeStyles();
  for (const style of FREE) {
    const ring = (u) => {
      const ctx = recordingContext({ center: B });
      styles.land(ctx, style, B, 12, TINT, u, look());
      const arcs = ctx.calls.log.filter(([name]) => name === "arc").map(([, , , r]) => r);
      return { radius: Math.max(...arcs.filter((r) => r > 1.5)), alpha: Math.max(...ctx.calls.strokes.map((s) => s.alpha)), calls: ctx.calls };
    };
    const early = ring(0.1), late = ring(0.8);
    assert.ok(early.calls.strokes.length > 0, `${style}: a ring`);
    assert.ok(late.alpha < early.alpha, `${style}: fading`);
    assert.ok(early.calls.reach <= 12 * 3 + 20, `${style}: within reach (${early.calls.reach})`);
    assert.equal(early.calls.saves, early.calls.restores);
    if (style !== "minimal") {
      // The surge's last light and the landing's first meet at the same alpha.
      const arrive = recordingContext();
      styles.surge(arrive, style, A, B, 0.9999, pulse(), look());
      const land = recordingContext();
      styles.land(land, style, B, 12, [241, 220, 174], 0, look({ pulse: pulse() }));
      assert.ok(Math.abs(arrive.calls.fills.at(-1).alpha - land.calls.fills[0].alpha) < 0.01, `${style}: no pop at arrival`);
    }
  }
});

test("pulse lights are capped at 32 a canvas, oldest out first", () => {
  const styles = loadNodeStyles();
  const ctx = recordingContext();
  const colour = (index) => `#${(0x203040 + index * 0x010203).toString(16).padStart(6, "0")}`;
  for (let index = 0; index < 40; index += 1) styles.surge(ctx, "orbs", A, B, 0.5, pulse({ color: colour(index), glow: colour(index) }), look());
  assert.equal(ctx.calls.radial, 40);
  styles.surge(ctx, "orbs", A, B, 0.5, pulse({ color: colour(39), glow: colour(39) }), look());
  assert.equal(ctx.calls.radial, 40, "a recent colour reuses its light");
  styles.surge(ctx, "orbs", A, B, 0.5, pulse({ color: colour(0), glow: colour(0) }), look());
  assert.equal(ctx.calls.radial, 41, "the oldest was let go");
});
