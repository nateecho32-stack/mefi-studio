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
// An ink string's channels, its chroma (max channel - min channel) and luma.
const channels = (ink) => ink.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
const chroma = (ink) => { const [r, g, b] = channels(ink); return Math.max(r, g, b) - Math.min(r, g, b); };
const lumaOf = (ink) => { const [r, g, b] = channels(ink); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const inks = (list) => list.map(({ style }) => style).filter((style) => typeof style === "string");
const LIGHT = { background: "#f2efe6", text: "#1c1b18" };
const LIGHT_LUMA = lumaOf("rgba(242,239,230,1)");
const CREAM = [241, 220, 174]; // the hub's pulse colour, #f1dcae: nearly the light ground itself

test("the wires section keeps a frame free of allocations, gradients per frame and shadowBlur", () => {
  const code = sectionOf("wires");
  for (const banned of ["Array.from", ".filter(", ".map(", "shadowBlur", "shadowColor", ".filter =", "createLinearGradient", "createConicGradient", "new Array", "Path2D"]) {
    assert.ok(!code.includes(banned), `the wires section never uses ${banned}`);
  }
  assert.equal(code.split("createRadialGradient(").length - 1, 1, "one radial, the cached light sprite");
  assert.ok(code.includes("let sprite = cacheGet(ctx, key);") && code.includes("cachePut(ctx, key, sprite);"), "the sprites live in the node paint cache (no second cache)");
  assert.ok(code.includes("key = `wire|light|${tone.join(\",\")}`; lightKeys.set(tone, key);"), "keyed by the tone's value, remembered per triple (no alpha, time or radius)");
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
      assert.deepEqual(plain(calls.log.slice(0, at).filter(([name]) => name === "setLineDash").at(-1)?.slice(1) ?? []), dash, `${style} ${kind}: its dash`);
      // No save per edge: the canvas gets its alpha, cap, dash and offset back
      // by hand, and a solid line never touches the dash at all.
      assert.equal(calls.saves, 0, `${style} ${kind}: no save`);
      if (!dash.length) assert.equal(calls.setLineDash, 0, `${style} ${kind}: a solid line sets no dash`);
      assert.equal(gradientsBuilt(ctx), 0);
      assert.equal(ctx.lineCap, "butt", "the canvas comes back as it was");
      assert.deepEqual([ctx.getLineDash(), ctx.lineDashOffset, ctx.globalAlpha], [[], 0, 1]);
    }
    // A caller that already draws round caps (the Command view's edge pass)
    // is not asked again.
    const round = recordingContext({ center: B });
    round.lineCap = "round";
    styles.wire(round, style, A, B, wire({ kind: "session", dash: [] }));
    assert.equal(round.calls.log.filter(([name]) => name === "set:lineCap").length, 1, `${style}: a round pen keeps its cap (the one set is the test's own)`);
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
  // glow strokes + the line + the flow's strokes (the head's light is a fill,
  // and so is crystal's sparkle)
  const expected = { orbs: 2 + 1 + 3, glass: 2 + 1 + 2, minimal: 1 + 1, halo: 2 + 1 + 4, crystal: 2 + 1 + 2 };
  const fills = { orbs: 1, glass: 0, minimal: 0, halo: 1, crystal: 2 };
  for (const style of FREE) {
    const { calls, ctx } = draw(styles, style, working({ time: 700 }));
    assert.equal(calls.stroke, expected[style], `${style}: strokes`);
    assert.equal(calls.fill, fills[style], `${style}: the light round the flow's head`);
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
    // (ends of unknown size: the whole curve, as the caller traced it)
    const { calls } = draw(styles, style, working({ curved: true, cp, rA: 0, rB: 0 }));
    const curves = calls.log.filter(([name]) => name === "bezierCurveTo");
    assert.ok(curves.length >= 1 && curves.every((entry) => plain(entry.slice(1)).join() === [20, 60, 260, 60, 260, 40].join()), `${style}: the S-curve through the caller's controls`);
    assert.ok(style === "crystal" ? calls.lineTo > 0 && calls.lineTo % 7 === 0 && calls.closePath === calls.lineTo / 7 : calls.lineTo === 0, `${style}: no straight chord drawn (crystal's sparkles aside: closed eight-point stars)`);
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

test("every wire stops at its ends' surfaces (inside each look's narrowest edge); pulses still ride to the centre", () => {
  const styles = loadNodeStyles();
  const ends = (style, extra = {}) => {
    const ctx = recordingContext({ center: B });
    styles.wire(ctx, style, A, B, wire({ kind: "session", dash: [], ...extra }));
    // (the line itself: the path up to the first stroke)
    const line = ctx.calls.log.slice(0, ctx.calls.log.findIndex(([name]) => name === "stroke"));
    const moves = line.filter(([name]) => name === "moveTo" || name === "lineTo" || name === "bezierCurveTo" || name === "quadraticCurveTo").map((entry) => plain(entry.slice(1)).slice(-2));
    return { from: moves[0], to: moves.at(-1), ctx };
  };
  const len = Math.hypot(B.x - A.x, B.y - A.y);
  const inset = { orbs: 0.96, glass: 0.96, minimal: 0.38, halo: 0.96, crystal: 0.85, prism: 0.56, sigil: 0.84, singularity: 0 };
  for (const [style, share] of Object.entries(inset)) {
    const { from, to } = ends(style);
    assert.ok(Math.abs(Math.hypot(from[0] - A.x, from[1] - A.y) - 9 * share) < 1e-6, `${style}: leaves a at ${share} of its radius`);
    assert.ok(Math.abs(Math.hypot(to[0] - B.x, to[1] - B.y) - 12 * share) < 1e-6, `${style}: meets b at ${share} of its radius`);
    // On the line between the centres.
    const cross = (to[0] - A.x) * (B.y - A.y) - (to[1] - A.y) * (B.x - A.x);
    assert.ok(Math.abs(cross / len) < 1e-6, `${style}: on the chord`);
  }
  // Ends of unknown size (0), and ends that overlap: nothing is cut / nothing shows.
  assert.deepEqual(ends("orbs", { rA: 0, rB: 0 }).from, [A.x, A.y]);
  const close = recordingContext();
  assert.equal(styles.wire(close, "glass", { x: 0, y: 0 }, { x: 15, y: 0 }, wire({ rA: 9, rB: 9 })), true, "overlapping ends: drawn (as nothing)");
  assert.equal(close.calls.stroke, 0);
  // On the tree's S-curve the wire is the curve's own piece: its ends sit on
  // the caller's curve, the caller's controls are handed back afterwards.
  const cp = { x1: 20, y1: 60, x2: 260, y2: 60 };
  const o = wire({ kind: "session", dash: [], curved: true, cp });
  const ctx = recordingContext();
  styles.wire(ctx, "glass", A, B, o);
  assert.equal(o.cp, cp, "the caller's controls come back");
  const curve = (u) => { const v = 1 - u; return [v * v * v * A.x + 3 * v * v * u * cp.x1 + 3 * v * u * u * cp.x2 + u * u * u * B.x, v * v * v * A.y + 3 * v * v * u * cp.y1 + 3 * v * u * u * cp.y2 + u * u * u * B.y]; };
  const onCurve = ([x, y]) => { let best = Infinity; for (let index = 0; index <= 4000; index += 1) { const [cx, cy] = curve(index / 4000); best = Math.min(best, Math.hypot(cx - x, cy - y)); } return best; };
  const start = plain(ctx.calls.log.find(([name]) => name === "moveTo").slice(1)), end = plain(ctx.calls.log.find(([name]) => name === "bezierCurveTo").slice(5));
  assert.ok(onCurve(start) < 0.05 && onCurve(end) < 0.05, "both ends on the caller's curve");
  assert.ok(Math.hypot(start[0] - A.x, start[1] - A.y) > 7 && Math.hypot(end[0] - B.x, end[1] - B.y) > 9, "and cut at the surfaces");
  // However wide or flat the S-curve (a wide terrace shelf, a tilted 3D
  // camera), each end is cut where the curve crosses that node's surface:
  // the S-curve leaves a node upright and slow and then swings wide, so an
  // estimate from its speed at the end cut far too much (a stub mid-link).
  for (const style of ["orbs", "sigil", "prism"]) {
    for (const [far, rA, rB] of [[{ x: 120, y: 80 }, 10, 10], [{ x: 240, y: 40 }, 10, 10], [{ x: 200, y: 8 }, 10, 10], [{ x: 200, y: 0.5 }, 10, 10], [{ x: 30, y: 6 }, 15, 4]]) {
      const near = { x: 0, y: 0 }, mid = far.y / 2;
      const flat = recordingContext();
      styles.wire(flat, style, near, far, wire({ kind: "session", dash: [], curved: true, cp: { x1: near.x, y1: mid, x2: far.x, y2: mid }, rA, rB }));
      const first = plain(flat.calls.log.find(([name]) => name === "moveTo").slice(1)), last = plain(flat.calls.log.find(([name]) => name === "bezierCurveTo").slice(5));
      const gapA = Math.hypot(first[0] - near.x, first[1] - near.y), gapB = Math.hypot(last[0] - far.x, last[1] - far.y);
      assert.ok(Math.abs(gapA - rA * inset[style]) < 0.75, `${style} ${far.x}x${far.y}: leaves a at its surface (${gapA.toFixed(2)} px, want ${(rA * inset[style]).toFixed(2)})`);
      assert.ok(Math.abs(gapB - rB * inset[style]) < 0.75, `${style} ${far.x}x${far.y}: meets b at its surface (${gapB.toFixed(2)} px, want ${(rB * inset[style]).toFixed(2)})`);
    }
  }
  // A pulse still rides to the target's centre.
  const surge = recordingContext();
  styles.surge(surge, "glass", A, B, 1, pulse(), look());
  assert.ok(surge.calls.log.some(([name, x, y]) => (name === "arc" || name === "moveTo") && Math.hypot(x - B.x, y - B.y) < 1e-6), "the pulse reaches the centre");
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
    const lights = ["glass", "minimal"].includes(style) ? 0 : 3;
    assert.equal(ctx.calls.radial, lights, `${style}: nothing built after the first frame`);
    assert.equal(ctx.calls.linear + ctx.calls.conic, 0);
    assert.deepEqual(plain(styles.cacheStats(ctx)), { entries: lights, created: lights }, `${style}: one node paint cache entry per tone, counted by cacheStats`);
  }
});

test("on a light theme the flow keeps the tint's hue and carries no light", () => {
  const styles = loadNodeStyles();
  const light = styles.theme(LIGHT);
  const dark = styles.theme({ background: "#050507", text: "#ece5d8" });
  const TINT_CHROMA = chroma(`rgba(${TINT},1)`);
  for (const style of FREE) {
    const onDark = draw(styles, style, working({ time: 700, theme: dark })).calls;
    const onLight = draw(styles, style, working({ time: 700, theme: light })).calls;
    assert.equal(onLight.radial, 0, `${style}: no light sprite on a pale ground`);
    assert.equal(onLight.fill, style === "crystal" ? 1 : 0, `${style}: no light fills (crystal's sparkle aside)`);
    // The flow's strokes are the ones after the caller's line.
    const line = onLight.strokes.findIndex((stroke) => stroke.style === "rgba(120,180,220,1)" && stroke.alpha === 0.55 && stroke.width === 1.4);
    const flow = onLight.strokes.slice(line + 1);
    assert.ok(flow.length >= 1, `${style}: a flow`);
    if (style === "glass") {
      // Glass's glint: a white core inside a band of the tint, never a grey smear.
      const [band, core] = flow;
      assert.equal(core.style, "rgba(255,255,255,1)", "glass: the core is white");
      assert.ok(core.width < band.width && core.alpha > band.alpha, `glass: a narrower, stronger core in the band (${band.width}/${band.alpha} → ${core.width}/${core.alpha})`);
      assert.ok(chroma(band.style) >= 0.5 * TINT_CHROMA, `glass: the band keeps the hue (${band.style})`);
      continue;
    }
    for (const ink of inks([...flow, ...onLight.fills])) {
      assert.ok(chroma(ink) >= 0.5 * TINT_CHROMA, `${style}: ${ink} keeps the tint's hue (chroma ${chroma(ink)} of ${TINT_CHROMA})`);
      assert.ok(lumaOf(ink) < LIGHT_LUMA - 60, `${style}: and reads on the pale ground (${ink})`);
    }
    // The head is the tint's deeper tone: darker than the body, and not the dark theme's.
    const head = flow.at(-1).style;
    assert.notEqual(head, onDark.strokes.at(-1).style, `${style}: the head's ink follows the theme`);
    assert.ok(lumaOf(head) < lumaOf(`rgba(${TINT},1)`) - 30, `${style}: the head sits deeper than the tint (${head})`);
  }
});

test("on a light theme a pale pulse colour deepens just enough to read; a strong one stays as it is", () => {
  const styles = loadNodeStyles();
  const light = styles.theme(LIGHT);
  const creamChroma = chroma(`rgba(${CREAM},1)`);
  for (const style of FREE) {
    const ctx = recordingContext();
    styles.surge(ctx, style, A, B, 0.5, pulse(), look({ theme: light }));
    const drawn = inks([...ctx.calls.strokes, ...ctx.calls.fills]);
    assert.ok(drawn.length >= 2, `${style}: a line and a head`);
    for (const ink of drawn) {
      assert.ok(chroma(ink) >= 0.5 * creamChroma, `${style}: ${ink} is still the cream's colour`);
      assert.ok(lumaOf(ink) <= LIGHT_LUMA - 70, `${style}: ${ink} reads on the pale ground`);
    }
    // The pulse's light is a haze of its own glow colour (#e6c98d), never a dark one.
    for (const { stops } of ctx.calls.gradients) assert.ok(stops.every(([, colour]) => colour.startsWith("rgba(230,201,141,")), `${style}: the light is the glow colour`);
    // A colour that already reads on the ground is drawn as it is.
    const strong = recordingContext();
    styles.surge(strong, style, A, B, 0.5, pulse({ color: "#c85a28" }), look({ theme: light }));
    assert.ok(strong.calls.strokes.some((stroke) => stroke.style === "rgba(200,90,40,1)"), `${style}: #c85a28 draws its line as it is`);
  }
});

test("minimal's bead stands out from the dashes it rides: pale, near opaque, well over the line's width", () => {
  const styles = loadNodeStyles();
  const dark = styles.theme({ background: "#050507", text: "#ece5d8" });
  const { calls } = draw(styles, "minimal", working({ time: 700, theme: dark }));
  const [line, bead] = calls.strokes;
  assert.deepEqual(line, { style: "rgba(120,180,220,1)", alpha: 0.55, width: 1.4 });
  assert.notEqual(bead.style, line.style, "the bead is not the wire's own ink");
  const [r, g, b] = bead.style.match(/\d+/g).map(Number);
  assert.ok(r + g + b > 120 + 180 + 220, `it is the tint's pale highlight (${bead.style})`);
  assert.ok(bead.alpha >= 0.9 && bead.width >= 3.5 && bead.width <= 5, `and a solid dot (${bead.alpha}, ${bead.width} px)`);
  assert.equal(calls.fill + calls.radial, 0, "and still no light");
});

test("a lit wire's glow breathes visibly; still, it holds one pose", () => {
  const styles = loadNodeStyles();
  // seed .3: the 2.6 s breath peaks at 2470 ms and bottoms out at 1170 ms
  const glow = (time, extra = {}) => draw(styles, "orbs", wire({ active: true, seed: 0.3, time, ...extra })).calls.strokes[1].alpha;
  assert.ok(glow(2470) >= 1.7 * glow(1170), `the breath swings the glow strongly (${glow(1170)} → ${glow(2470)})`);
  assert.equal(glow(1170, { still: true }), glow(2470, { still: true }), "reduced motion: one pose");
  const [low, high] = [glow(1170, { still: true }), glow(2470)];
  assert.ok(low < high, "the pose sits inside the breath");
});

test("a relay hop (session, todo) flows calmer than the task's own wire; o.flow gates the flow, march only the dashes", () => {
  const styles = loadNodeStyles();
  for (const style of FREE) {
    const flowAlphas = (o) => { const calls = draw(styles, style, o).calls; return calls.strokes.slice(-1)[0].alpha; };
    const task = flowAlphas(working({ time: 700 }));
    const hop = flowAlphas(working({ kind: "session", dash: [], time: 700, march: false }));
    assert.ok(Math.abs(hop - 0.6 * task) < 1e-9, `${style}: a session hop flows at .6 of the alpha (${task} → ${hop})`);
    // .7 of the pace: the hop's head sits where the task's sat 1/.7 as long ago
    const head = (o) => draw(styles, style, o).calls.log.filter(([name]) => name === "set:lineDashOffset").at(-1)[1];
    assert.ok(Math.abs(head(working({ kind: "todo", dash: [], march: false, time: 700 })) - head(working({ time: 490 }))) < 1e-6, `${style}: at .7 of the pace`);
    // A caller that says flow: true flows with motion on even without a march (the rail's tether).
    const quiet = draw(styles, style, wire({ active: true, march: false, flow: false })).calls.stroke;
    assert.ok(draw(styles, style, wire({ active: true, march: false, flow: true, time: 700 })).calls.stroke > quiet, `${style}: flow, not march, decides`);
    // A caller without the key falls back to march.
    const legacy = wire({ active: true, march: true, time: 700 });
    delete legacy.flow;
    assert.ok(draw(styles, style, legacy).calls.stroke > quiet, `${style}: march stands in for a missing flow`);
  }
});

test("crystal's glints are sparkles, not crosses, in the pulse's own colour on a light theme", () => {
  const styles = loadNodeStyles();
  const light = styles.theme(LIGHT);
  const { calls } = draw(styles, "crystal", working({ time: 700 }));
  assert.ok(calls.lineWidths.every((width) => width >= 1), "no hairline arms on the wire");
  const star = calls.log.slice(calls.log.findLastIndex(([name]) => name === "beginPath"));
  assert.ok(star.filter(([name]) => name === "lineTo").length === 7 && star.some(([name]) => name === "fill"), "a filled eight-point star");
  // Unequal arms: the long tips more than twice as far out as the short ones.
  const [tip, , side, , tail, , other] = star.filter(([name]) => name === "moveTo" || name === "lineTo").map(([, x, y]) => ({ x, y }));
  const long = Math.hypot(tip.x - tail.x, tip.y - tail.y) / 2, short = Math.hypot(side.x - other.x, side.y - other.y) / 2;
  assert.ok(long >= 2 * short && short > 0, `long ${long.toFixed(2)} px against short ${short.toFixed(2)} px`);
  const head = (theme) => { const ctx = recordingContext(); styles.surge(ctx, "crystal", A, B, 0.5, pulse(), look({ theme, time: 400 })); return ctx.calls; };
  const onDark = head(undefined), onLight = head(light);
  assert.deepEqual([onDark.stroke, onLight.stroke], [3, 3], "the tail's three pieces, and no glint strokes, in either theme");
  assert.equal(onLight.fill, onDark.fill, "the head keeps its diamond and its sparkle on a light ground");
  const sparkle = onLight.fills.at(-1).style;
  assert.ok(chroma(sparkle) >= 0.5 * chroma(`rgba(${CREAM},1)`) && lumaOf(sparkle) < LIGHT_LUMA - 90, `in the pulse's deeper tone, not a grey cross (${sparkle})`);
  // On the wire, a light theme keeps the leading spark's sparkle too.
  assert.equal(draw(styles, "crystal", working({ time: 700, theme: light })).calls.fill, 1, "the wire's sparkle on a light ground");
});

test("reduced motion on a light theme flashes a fainter, finer line", () => {
  const styles = loadNodeStyles();
  const light = styles.theme(LIGHT);
  for (const style of FREE) {
    const flash = (theme) => { const ctx = recordingContext(); styles.surge(ctx, style, A, B, 1, pulse(), look({ still: true, theme })); return ctx.calls.strokes[0]; };
    assert.deepEqual([flash(undefined).alpha, flash(undefined).width], [0.5, 2]);
    assert.deepEqual([flash(light).alpha, flash(light).width], [0.3, 1.5], `${style}: .3 and 1.5 px on a light ground`);
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
  // Crystal's landing is an octagon with four sparkles; halo's sends a second ring after the first.
  const gem = recordingContext();
  styles.land(gem, "crystal", B, 12, TINT, 0.3, look());
  assert.deepEqual([gem.calls.lineTo, gem.calls.closePath], [7 + 4 * 7, 5]);
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
      // The surge's last light and the landing's first meet at the same alpha
      // and the same size, on the Command view and on the rail, on either ground.
      for (const [rail, theme] of [[false, undefined], [true, undefined], [false, styles.theme(LIGHT)], [true, styles.theme(LIGHT)]]) {
        const arrive = recordingContext();
        styles.surge(arrive, style, A, B, 0.9999, pulse(), look({ rail, theme }));
        const land = recordingContext();
        styles.land(land, style, B, 12, [241, 220, 174], 0, look({ pulse: pulse(), rail, theme }));
        const where = `${style}${rail ? " on the rail" : ""}${theme ? " on a light ground" : ""}`;
        assert.ok(Math.abs(arrive.calls.fills.at(-1).alpha - land.calls.fills[0].alpha) < 0.01, `${where}: no pop at arrival`);
        const scale = (calls, pick) => pick(calls.log.filter(([name]) => name === "scale"))[1];
        const last = scale(arrive.calls, (list) => list.at(-1)), first = scale(land.calls, (list) => list[0]);
        assert.ok(Math.abs(first / last - 1) < 0.01, `${where}: the bloom keeps its size across the handover (${last} → ${first})`);
      }
    }
  }
});

test("a landing ring keeps travelling while it fades, in the tint's pale highlight on a dark ground", () => {
  const styles = loadNodeStyles();
  const dark = styles.theme({ background: "#050507", text: "#ece5d8" });
  const rings = (style, u, o = {}) => {
    const ctx = recordingContext({ center: B });
    styles.land(ctx, style, B, 12, TINT, u, look({ theme: dark, ...o }));
    const arcs = ctx.calls.log.filter(([name]) => name === "arc").map(([, , , r]) => r).filter((r) => r > 1.5);
    // crystal's ring is an octagon: its first vertex sits on the ring's radius
    const vertex = ctx.calls.log.find(([name]) => name === "moveTo");
    if (!arcs.length && vertex) arcs.push(Math.hypot(vertex[1] - B.x, vertex[2] - B.y));
    return { arcs, strokes: ctx.calls.strokes, calls: ctx.calls };
  };
  for (const style of FREE) {
    const half = rings(style, 0.5), late = rings(style, 0.75);
    assert.ok(late.arcs[0] >= 1.08 * half.arcs[0], `${style}: the ring is still growing late in its tail (${half.arcs[0]} → ${late.arcs[0]})`);
    const crisp = (ring) => ring.strokes.find((stroke) => stroke.style !== "rgba(120,180,220,1)") ?? ring.strokes.at(-1);
    assert.ok(crisp(late).alpha <= crisp(half).alpha * 0.15 + 1e-9, `${style}: its light falls off as the cube of what is left (${crisp(half).alpha} → ${crisp(late).alpha})`);
    const pale = rings(style, 0.3).strokes.filter((stroke) => stroke.style !== "rgba(120,180,220,1)");
    assert.ok(pale.length >= 1, `${style}: the crisp ring is not the raw tint on a dark ground`);
    for (const stroke of pale) {
      const [r, g, b] = stroke.style.match(/\d+/g).map(Number);
      assert.ok(r + g + b > 120 + 180 + 220, `${style}: it leans pale (${stroke.style})`);
    }
  }
  // Halo's second ring runs out past the first rather than merging into it.
  for (const u of [0.6, 0.75, 0.9]) {
    const { arcs } = rings("halo", u);
    assert.equal(arcs.length, 2, `halo at u ${u}: two rings`);
    assert.ok(arcs[1] - arcs[0] >= 3, `halo at u ${u}: ${arcs[1].toFixed(1)} is well outside ${arcs[0].toFixed(1)}`);
  }
  // The rail's small nodes: one crisp ring a short way out, and a small bloom.
  for (const style of FREE) {
    for (const u of [0, 0.3, 0.7]) {
      const rail = recordingContext({ center: B });
      styles.land(rail, style, B, 5, TINT, u, look({ theme: dark, rail: true, detail: 2 }));
      assert.ok(rail.calls.stroke <= 1, `${style} on the rail at u ${u}: one ring (${rail.calls.stroke})`);
      assert.ok(rail.calls.reach <= 3.2 * 5, `${style} on the rail at u ${u}: within 3.2r (${rail.calls.reach})`);
      assert.equal(rail.calls.lineTo, 0, `${style} on the rail: no rays`);
    }
  }
});

test("crystal lands as its gem: an octagon ring with four sparkles off alternate corners, not a reticle", () => {
  const styles = loadNodeStyles();
  for (const u of [0.1, 0.4]) {
    const ctx = recordingContext({ center: B });
    styles.land(ctx, "crystal", B, 12, TINT, u, look());
    const log = ctx.calls.log;
    assert.equal(log.filter(([name]) => name === "arc").length, 1, `u ${u}: no round ring (the bloom's disc alone)`);
    assert.ok(ctx.calls.strokes.every((stroke) => stroke.width > 1), `u ${u}: no hairline rays`);
    const points = log.filter(([name]) => name === "moveTo" || name === "lineTo").map(([, x, y]) => ({ x, y }));
    assert.equal(points.length, 8 + 4 * 8, `u ${u}: one octagon, four eight-point sparkles`);
    // The octagon: eight vertices on one radius, flat on top at rest (22.5° + k·45°, turned by .35·easeOut(u)).
    const octagon = points.slice(0, 8);
    const radius = Math.hypot(octagon[0].x - B.x, octagon[0].y - B.y);
    assert.ok(octagon.every((point) => Math.abs(Math.hypot(point.x - B.x, point.y - B.y) - radius) < 1e-4), `u ${u}: a regular octagon`);
    const turn = 0.35 * (1 - (1 - u) ** 3) + Math.PI / 8; // easeOut is the cubic
    const first = Math.atan2(octagon[0].y - B.y, octagon[0].x - B.x);
    assert.ok(Math.abs(first - turn) < 1e-4, `u ${u}: its first corner at 22.5°, turned by .35·easeOut(u) (${first.toFixed(3)})`);
    // Each sparkle sits 2 px off alternate corners (its centre: the midpoint of its long arms' tips).
    for (let index = 0; index < 4; index += 1) {
      const star = points.slice(8 + index * 8, 16 + index * 8);
      const cx = (star[0].x + star[4].x) / 2, cy = (star[0].y + star[4].y) / 2;
      const corner = octagon[index * 2];
      const out = Math.hypot(cx - B.x, cy - B.y);
      assert.ok(Math.abs(out - (radius + 2)) < 1e-4, `u ${u}: sparkle ${index} sits 2 px outside the ring (${out.toFixed(2)} vs ${radius.toFixed(2)})`);
      const along = ((cx - B.x) * (corner.x - B.x) + (cy - B.y) * (corner.y - B.y)) / (out * radius);
      assert.ok(along > 0.9999, `u ${u}: sparkle ${index} off corner ${index * 2}`);
    }
    assert.equal(ctx.calls.fill, 2, `u ${u}: the bloom, then the four sparkles in one fill`);
  }
  // The rail keeps its one small round ring.
  const rail = recordingContext({ center: B });
  styles.land(rail, "crystal", B, 5, TINT, 0.3, look({ rail: true, detail: 2 }));
  assert.deepEqual([rail.calls.stroke, rail.calls.lineTo, rail.calls.arc], [1, 0, 2], "the rail: the bloom's disc and one ring");
});

test("on a light theme a landing keeps the pulse's colour: tinted rings under a faint haze of its glow", () => {
  const styles = loadNodeStyles();
  const light = styles.theme(LIGHT);
  const creamChroma = chroma(`rgba(${CREAM},1)`);
  for (const style of FREE) {
    const land = (u) => { const ctx = recordingContext({ center: B }); styles.land(ctx, style, B, 12, CREAM, u, look({ theme: light, pulse: pulse() })); return ctx.calls; };
    const calls = land(0.3);
    assert.ok(calls.stroke >= 1, `${style}: a ring`);
    for (const ink of inks([...calls.strokes, ...calls.fills])) {
      assert.ok(chroma(ink) >= 0.5 * creamChroma && lumaOf(ink) <= LIGHT_LUMA - 70, `${style}: ${ink} is the cream, deepened to read`);
    }
    const flash = 0.7 ** 3;
    // the crisp ring is the last stroke (halo's second ring follows it)
    const crisp = calls.strokes.at(style === "halo" ? -2 : -1);
    assert.ok(Math.abs(crisp.alpha - (style === "glass" ? 0.5 : 0.7) * flash) < 1e-9, `${style}: the crisp ring at ${(style === "glass" ? 0.5 : 0.7)}·(1 - u)³ (${crisp.alpha})`);
    if (style !== "minimal") {
      const soft = calls.strokes[0];
      assert.ok(Math.abs(soft.alpha - 0.12 * 0.49) < 1e-9, `${style}: the soft ring at .12·(1 - u)² (${soft.alpha})`);
      assert.ok(calls.gradients.every(({ stops }) => stops.every(([, colour]) => colour.startsWith("rgba(230,201,141,"))), `${style}: the bloom is a haze of the glow colour, never a dark one`);
      assert.ok(Math.abs(calls.fills[0].alpha - 0.55 * 0.45 * 0.49) < 1e-9, `${style}: at .25·(1 - u)² (${calls.fills[0].alpha})`);
    }
  }
});

test("pulse lights share the node paint cache: one per colour, by value, within its bound", () => {
  const styles = loadNodeStyles();
  const ctx = recordingContext();
  const colour = (index) => `#${(0x203040 + index * 0x010203).toString(16).padStart(6, "0")}`;
  for (let index = 0; index < 40; index += 1) styles.surge(ctx, "orbs", A, B, 0.5, pulse({ color: colour(index), glow: colour(index) }), look());
  assert.equal(ctx.calls.radial, 40);
  assert.deepEqual(plain(styles.cacheStats(ctx)), { entries: 40, created: 40 }, "every light is a counted cache entry");
  for (const index of [0, 17, 39]) styles.surge(ctx, "orbs", A, B, 0.5, pulse({ color: colour(index), glow: colour(index) }), look());
  assert.equal(ctx.calls.radial, 40, "a colour seen before reuses its light");
  // A wire tint equal by value to a pulse colour shares its light.
  styles.wire(ctx, "orbs", A, B, working({ tint: [0x20, 0x30, 0x40], time: 700 }));
  assert.equal(ctx.calls.radial, 40, "equal triples share one sprite");
  for (let index = 40; index < 200; index += 1) styles.surge(ctx, "orbs", A, B, 0.5, pulse({ color: colour(index), glow: colour(index) }), look());
  assert.equal(styles.cacheStats(ctx).entries, 128, "the cache's own bound holds");
});
