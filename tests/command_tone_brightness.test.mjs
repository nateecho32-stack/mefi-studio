// Tree brightness away from 100% (idle.js toneBegin and the wires pass around
// it): a pass paints plain into a scratch OffscreenCanvas per layer and one
// filtered drawImage lays it down, instead of a canvas filter around every
// shape (which Chromium draws through a layer the size of the canvas).
// The real functions are sliced out of renderer/idle.js and run next to the
// real renderer/tree-dynamics.js, so the switch, the filter string and the
// brightness levels are the shipped ones. Canvases are fakes that record what
// they are asked to do; nothing here draws a pixel or reads a clock.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`../renderer/${name}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const idle = read("idle.js"), dynamicsSource = read("tree-dynamics.js");
const start = idle.indexOf("  function drawGraphConnections(");
const end = idle.indexOf("  // An agent tether's dash, handed to a style that draws the tether itself.", start);
assert.ok(start > 0 && end > start, "idle.js keeps drawGraphConnections and the tone helpers together, above the tether dash");
const toneSource = idle.slice(start, end);
const surfaceStart = idle.indexOf("  function drawNodeSurface(");
const surfaceEnd = idle.indexOf("  // ---------- agent dress:", surfaceStart);
assert.ok(surfaceStart > 0 && surfaceEnd > surfaceStart, "idle.js keeps drawNodeSurface above the agent dress");
const surfaceSource = idle.slice(surfaceStart, surfaceEnd);

const PEN = () => ({
  globalAlpha: 1, globalCompositeOperation: "source-over", fillStyle: "#000000", strokeStyle: "#000000", lineWidth: 1, lineCap: "butt", lineJoin: "miter",
  miterLimit: 10, lineDashOffset: 0, shadowOffsetX: 0, shadowOffsetY: 0, shadowBlur: 0, shadowColor: "rgba(0, 0, 0, 0)", font: "10px sans-serif",
  textAlign: "start", textBaseline: "alphabetic", direction: "ltr", letterSpacing: "0px", wordSpacing: "0px", fontKerning: "auto", fontStretch: "normal",
  fontVariantCaps: "normal", textRendering: "auto", imageSmoothingEnabled: true, imageSmoothingQuality: "low", filter: "none",
});
// A 2D context that keeps the state a real one keeps (the pen, the dash, the
// transform, and a save/restore stack) and logs the calls the tests care about.
function fakeContext(name, canvas, log) {
  let values = PEN(), dash = [], matrix = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const api = {
    canvas,
    wipe() { values = PEN(); dash = []; matrix = [1, 0, 0, 1, 0, 0]; stack.length = 0; },
    save() { log.push({ on: name, call: "save" }); stack.push({ values: { ...values }, dash: [...dash], matrix: [...matrix] }); },
    restore() { log.push({ on: name, call: "restore" }); const top = stack.pop(); if (top) ({ values, dash, matrix } = top); },
    setTransform(...args) {
      matrix = (args.length === 1 ? [args[0].a, args[0].b, args[0].c, args[0].d, args[0].e, args[0].f] : args).map(Number);
    },
    getTransform() { const [a, b, c, d, e, f] = matrix; return { a, b, c, d, e, f }; },
    setLineDash(list) { dash = [...list]; },
    getLineDash() { return [...dash]; },
    clearRect(...args) { log.push({ on: name, call: "clearRect", args, matrix: [...matrix] }); },
    fillRect(...args) { log.push({ on: name, call: "fillRect", args, fill: values.fillStyle }); },
    beginPath() {},
    arc() {},
    fill() { log.push({ on: name, call: "fill", fill: values.fillStyle, alpha: values.globalAlpha }); },
    stroke() { log.push({ on: name, call: "stroke", stroke: values.strokeStyle, width: values.lineWidth, alpha: values.globalAlpha }); },
    drawImage(image, ...args) {
      log.push({ on: name, call: "drawImage", from: image.name, args, filter: values.filter, alpha: values.globalAlpha, op: values.globalCompositeOperation, matrix: [...matrix], shadow: values.shadowColor });
    },
  };
  return new Proxy(api, {
    get: (target, key) => (key in target ? target[key] : values[key]),
    set(target, key, value) { if (key in target) target[key] = value; else values[key] = value; return true; },
    has: (target, key) => key in target || key in values,
  });
}

function load({ offscreen = true, noContext = false } = {}) {
  const log = [], made = [], ended = [], impl = [];
  class FakeOffscreen {
    constructor(width, height) { this.name = `scratch${made.length}`; this.w = width; this.h = height; this.resized = 0; this.pen = null; made.push(this); }
    get width() { return this.w; }
    set width(value) { this.w = value; this.resized += 1; this.pen?.wipe(); }
    get height() { return this.h; }
    set height(value) { this.h = value; this.resized += 1; this.pen?.wipe(); }
    getContext(kind) { assert.equal(kind, "2d"); return noContext ? null : (this.pen ??= fakeContext(this.name, this, log)); }
  }
  const window = { dispatchEvent() {}, MefiProfiler: { begin: (name) => name, end: (span) => ended.push(span) } };
  const sandbox = {
    window, document: {}, localStorage: { getItem: () => null, setItem() {} }, CustomEvent: class { constructor(type) { this.type = type; } },
    drawGraphConnectionsImpl: (...args) => { impl.push(args); return "wires"; },
    // What drawNodeSurface's plain disc (the path without the node styles) leans on.
    state: { nodeStyle: "orbs", extraGlow: false }, traceNodeSurface() {}, rgba: (tint, alpha) => `rgba(${tint.join(", ")}, ${alpha})`,
    ...(offscreen ? { OffscreenCanvas: FakeOffscreen } : {}),
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(dynamicsSource, context);
  vm.runInContext(toneSource, context);
  vm.runInContext(surfaceSource, context);
  const layer = (name, width = 1000, height = 600) => fakeContext(name, { width, height }, log);
  return {
    log, made, ended, impl, dynamics: window.MefiTreeDynamics, window, layer, sandbox,
    toneBegin: context.toneBegin, drawGraphConnections: context.drawGraphConnections, drawNodeSurface: context.drawNodeSurface,
  };
}
const on = (env, name, call) => env.log.filter((entry) => entry.on === name && entry.call === call);

test("at 100% brightness toneBegin returns null and touches nothing, whatever the switch says", () => {
  const env = load(), near = env.layer("near"), far = env.layer("far");
  let reads = 0;
  env.dynamics.fastBrightness = () => { reads += 1; return false; };
  assert.equal(env.toneBegin("nodes", near), null);
  assert.equal(env.toneBegin("lines", near, far), null);
  env.dynamics.update({ nodeBrightness: 2, nodeBrightnessEnabled: false });
  assert.equal(env.toneBegin("nodes", near), null, "an adjustment turned off is 100% too");
  assert.equal(reads, 0, "the switch is read only once a pass is brightened, so the default path pays nothing");
  assert.equal(env.made.length, 0, "no scratch canvas is made"); assert.equal(env.log.length, 0, "and no layer is touched");
  env.dynamics.update({ nodeBrightnessEnabled: true }); delete env.dynamics.beginPaint;
  assert.equal(env.toneBegin("nodes", near), null, "a harness without beginPaint paints as it always did");
});

test("a scratch canvas is made once per layer, reused by every pass, cleared each time and resized with its layer", () => {
  const env = load(), near = env.layer("near"), far = env.layer("far");
  env.dynamics.update({ nodeBrightness: 2, lineBrightness: 1.5 });
  for (const [kind, focus] of [["nodes", null], ["lines", null], ["nodes", far]]) env.toneBegin(kind, near, focus).finish();
  assert.equal(env.made.length, 2, "one scratch for the near layer, one for the far layer, made on the first pass that used it");
  assert.deepEqual(env.made.map((canvas) => [canvas.w, canvas.h]), [[1000, 600], [1000, 600]]);
  assert.equal(env.made.reduce((sum, canvas) => sum + canvas.resized, 0), 0, "a layer that keeps its size never resizes its scratch");
  const clears = on(env, "scratch0", "clearRect");
  assert.equal(clears.length, 3, "the near scratch is wiped at the start of each of the three passes");
  for (const clear of clears) { assert.deepEqual(clear.args, [0, 0, 1000, 600]); assert.deepEqual(clear.matrix, [1, 0, 0, 1, 0, 0], "under the identity transform, so the whole bitmap goes"); }
  near.canvas.width = 1250; near.canvas.height = 750;
  const tone = env.toneBegin("nodes", near);
  assert.deepEqual([env.made[0].w, env.made[0].h], [1250, 750], "the scratch follows its layer's bitmap");
  assert.equal(env.made[0].resized, 2); assert.equal(env.made.length, 2, "resized, not remade");
  assert.deepEqual(on(env, "scratch0", "clearRect").at(-1).args, [0, 0, 1250, 750]);
  tone.finish(); env.toneBegin("nodes", near).finish();
  assert.equal(env.made[0].resized, 2, "and left alone at the new size");
});

test("the far layer takes part only when the pass hands it in, which Command does while a branch is focused", () => {
  const env = load(), near = env.layer("near"), far = env.layer("far");
  env.dynamics.update({ nodeBrightness: 2 });
  const single = env.toneBegin("nodes", near);
  assert.equal(single.far, null); assert.notEqual(single.near, near, "the pass paints on the scratch, not on the layer");
  single.finish();
  assert.equal(env.made.length, 1, "no far scratch is made without a focus");
  assert.equal(env.log.filter((entry) => entry.on === "far").length, 0, "the far layer is not touched at all");
  const both = env.toneBegin("nodes", near, far);
  assert.notEqual(both.far, null); assert.notEqual(both.far, both.near); assert.notEqual(both.far, far);
  assert.equal(env.made.length, 2);
  both.finish();
  assert.deepEqual(env.log.filter((entry) => entry.call === "drawImage").map((entry) => entry.on), ["near", "near", "far"], "one draw for the first pass, then one per layer for the second, near first");
});

test("the layer's pen goes into the scratch and the pen the pass leaves comes back out", () => {
  const env = load(), near = env.layer("near");
  env.dynamics.update({ nodeBrightness: 2 });
  const before = { fillStyle: "#123456", strokeStyle: "rgba(1, 2, 3, 0.5)", lineWidth: 3, lineCap: "square", lineJoin: "round", miterLimit: 4, globalAlpha: 0.4,
    globalCompositeOperation: "lighter", shadowBlur: 7, shadowColor: "rgba(9, 9, 9, 0.5)", font: "12px serif", textAlign: "center", textBaseline: "middle", lineDashOffset: 2 };
  Object.assign(near, before); near.setLineDash([6, 4]); near.setTransform(2, 0, 0, 2, 10, 20);
  const tone = env.toneBegin("nodes", near), pen = tone.near;
  for (const [key, value] of Object.entries(before)) assert.equal(pen[key], value, `the scratch starts with the layer's ${key}`);
  assert.deepEqual(pen.getLineDash(), [6, 4]); assert.deepEqual(pen.getTransform(), near.getTransform(), "and its transform, so the pass draws where it always did");
  pen.lineCap = "round"; pen.lineWidth = 5; pen.fillStyle = "#abcdef"; pen.globalAlpha = 0.7; pen.setLineDash([]); pen.lineDashOffset = 0; pen.setTransform(1, 0, 0, 1, 3, 4);
  tone.finish();
  assert.equal(near.lineCap, "round", "the wires pass leaves its cap for the pass that follows, as it did on the real layer");
  assert.equal(near.lineWidth, 5); assert.equal(near.fillStyle, "#abcdef"); assert.equal(near.globalAlpha, 0.7);
  assert.deepEqual(near.getLineDash(), []); assert.equal(near.lineDashOffset, 0);
  assert.deepEqual(near.getTransform(), { a: 1, b: 0, c: 0, d: 1, e: 3, f: 4 });
  assert.equal(near.globalCompositeOperation, "lighter", "what laying the scratch down needs does not leak back");
  assert.equal(near.shadowColor, "rgba(9, 9, 9, 0.5)"); assert.equal(near.filter, "none");
});

test("finish lays each scratch down once through the brightness filter, plainly and pixel for pixel, and leaves the layer as it was", () => {
  const env = load(), near = env.layer("near"), far = env.layer("far");
  env.dynamics.update({ nodeBrightness: 2 });
  near.globalAlpha = 0.3; near.globalCompositeOperation = "lighter"; near.shadowColor = "rgba(0, 0, 0, 0.5)"; near.setTransform(2, 0, 0, 2, 5, 5);
  far.filter = "blur(2px)";
  const tone = env.toneBegin("nodes", near, far);
  tone.near.fillRect(1, 2, 3, 4); tone.far.fillRect(5, 6, 7, 8);
  assert.deepEqual(env.log.filter((entry) => entry.on === "near" || entry.on === "far"), [], "nothing reaches a real layer while the pass runs");
  assert.equal(near.filter, "none"); assert.equal(far.filter, "blur(2px)", "the pass itself runs without any filter");
  tone.finish();
  const laid = env.log.filter((entry) => entry.call === "drawImage");
  assert.deepEqual(laid.map((entry) => [entry.on, entry.from, entry.args, entry.filter]), [
    ["near", "scratch0", [0, 0], "brightness(2)"],
    ["far", "scratch1", [0, 0], "blur(2px) brightness(2)"],
  ], "one filtered draw per layer, and the far layer keeps its own filter in front of the brightness");
  for (const entry of laid) {
    assert.deepEqual(entry.matrix, [1, 0, 0, 1, 0, 0], "drawn under the identity transform, so the bitmaps line up"); assert.equal(entry.alpha, 1);
    assert.equal(entry.op, "source-over"); assert.equal(entry.shadow, "rgba(0, 0, 0, 0)");
  }
  assert.equal(near.filter, "none"); assert.equal(far.filter, "blur(2px)", "each layer's filter is back the way it was");
  for (const name of ["near", "far"]) assert.equal(on(env, name, "save").length, on(env, name, "restore").length, `${name}'s saves and restores balance`);
  assert.equal(near.globalAlpha, 0.3); assert.equal(near.globalCompositeOperation, "lighter"); assert.equal(near.shadowColor, "rgba(0, 0, 0, 0.5)");
  assert.deepEqual(near.getTransform(), { a: 2, b: 0, c: 0, d: 2, e: 5, f: 5 });
  env.dynamics.update({ lineBrightness: 0.5 });
  env.toneBegin("lines", near).finish();
  assert.equal(on(env, "near", "drawImage").at(-1).filter, "brightness(0.5)", "the wires pass takes the line brightness");
});

test("the filter goes around the whole pass, as before, when the switch is off, and lays nothing down afterwards", () => {
  const env = load(), near = env.layer("near"), far = env.layer("far");
  far.filter = "blur(2px)";
  env.dynamics.update({ nodeBrightness: 1.6, fastBrightness: false });
  let tone = env.toneBegin("nodes", near, far);
  assert.equal(tone.near, near); assert.equal(tone.far, far, "the pass paints on the real layers");
  assert.equal(near.filter, "brightness(1.6)"); assert.equal(far.filter, "blur(2px) brightness(1.6)");
  tone.finish();
  assert.equal(near.filter, "none"); assert.equal(far.filter, "blur(2px)");
  assert.equal(env.made.length, 0, "no scratch canvas is made"); assert.equal(env.log.filter((entry) => entry.call === "drawImage").length, 0);
  env.dynamics.update({ fastBrightness: true });
  tone = env.toneBegin("nodes", near);
  assert.notEqual(tone.near, near, "turning it back on takes the next frame");
  tone.finish();
});

test("without OffscreenCanvas, or a 2D context, or a sized layer, the pass falls back to the filter around it", () => {
  const cases = { "no OffscreenCanvas": [{ offscreen: false }, 1000], "no 2D context for it": [{ noContext: true }, 1000], "a layer with no size yet": [{}, 0] };
  for (const [what, [options, width]] of Object.entries(cases)) {
    const env = load(options), near = env.layer("near", width, width && 600);
    env.dynamics.update({ nodeBrightness: 2 });
    const tone = env.toneBegin("nodes", near);
    assert.equal(tone.near, near, `${what}: it paints on the real layer`); assert.equal(near.filter, "brightness(2)", what);
    tone.finish();
    assert.equal(near.filter, "none", `${what}: and puts the filter back`);
    assert.equal(env.log.filter((entry) => entry.call === "drawImage").length, 0, what);
  }
});

test("the wires pass paints on the scratch pens and lays them down once, even if it throws", () => {
  const env = load(), near = env.layer("near"), far = env.layer("far"), projected = [], layers = { far, focusIds: null };
  // 100%: the pass is handed the real layers, untouched, and its result passes through.
  assert.equal(env.drawGraphConnections(near, projected, new Set(), false, 0, layers), "wires");
  assert.equal(env.impl[0][0], near); assert.equal(env.impl[0][5], layers); assert.equal(env.ended.length, 1, "the profiler span ends");
  assert.equal(env.log.length, 0); assert.equal(env.made.length, 0);
  env.dynamics.update({ lineBrightness: 2 });
  // No focus: the pass paints on the near scratch, and the far layer takes no lines.
  env.impl.length = 0;
  assert.equal(env.drawGraphConnections(near, projected, new Set(), false, 0, layers), "wires");
  assert.notEqual(env.impl[0][0], near, "the pass is handed a scratch pen");
  assert.equal(env.impl[0][5], layers, "and the layers as they were, since no focus sends a wire to the far layer");
  assert.equal(on(env, "near", "drawImage").length, 1); assert.equal(on(env, "far", "drawImage").length, 0);
  assert.equal(env.made.length, 1);
  // A focus: the far layer's wires go to the far scratch, and both are laid down.
  env.impl.length = 0;
  const focused = { far, focusIds: new Set(["a"]) };
  env.drawGraphConnections(near, projected, new Set(), false, 0, focused);
  const [pen, , , , , handed] = env.impl[0];
  assert.notEqual(pen, near); assert.notEqual(handed.far, far, "the focused pass draws its far wires on the far scratch");
  assert.equal(handed.focusIds, focused.focusIds);
  assert.equal(on(env, "near", "drawImage").length, 2); assert.equal(on(env, "far", "drawImage").length, 1);
  assert.equal(env.made.length, 2);
  // The pass throws: the layers still get what it drew, and the profiler span still ends.
  env.sandbox.drawGraphConnectionsImpl = () => { throw new Error("boom"); };
  const laidBefore = env.log.filter((entry) => entry.call === "drawImage").length, endedBefore = env.ended.length;
  assert.throws(() => env.drawGraphConnections(near, projected, new Set(), false, 0, focused), /boom/);
  assert.equal(env.log.filter((entry) => entry.call === "drawImage").length, laidBefore + 2, "both scratches are laid down anyway");
  assert.equal(env.ended.length, endedBefore + 1);
  assert.equal(near.filter, "none");
});

test("a brightened nodes pass paints its outlines outside the scratch only above 100% with outlines on", () => {
  const env = load(), near = env.layer("near");
  const outside = (extra) => {
    if (extra) env.dynamics.update(extra);
    const tone = env.toneBegin("nodes", near), value = tone?.outside;
    tone?.finish();
    return value;
  };
  assert.equal(outside({ nodeBrightness: 2 }), false, "outlines are off");
  assert.equal(outside({ outlines: true }), true);
  assert.equal(outside({ nodeBrightness: 0.5 }), false, "below 100% nothing clamps, so an outline in the pass is exact and stays there");
  assert.ok(!outside({ nodeBrightness: 2, fastBrightness: false }), "with the switch off the filter round the pass already leaves an outline's black and white as they are");
  assert.equal(outside({ fastBrightness: true, nodeBrightnessEnabled: false }), undefined, "and at 100% there is no pass to speak of");
});

test("outlines land on the real layer and node bodies in the scratch, which is laid down after every outline", () => {
  const env = load(), near = env.layer("near");
  env.dynamics.update({ nodeBrightness: 2, outlines: true });
  const paint = (toTheLayer) => {
    env.log.length = 0;
    const tone = env.toneBegin("nodes", near);
    for (const [x, _fade] of [[100, 0.5], [130, 1]]) env.drawNodeSurface(tone.near, { _fade }, { x, y: 50 }, 12, [200, 120, 60], { alpha: 0.8, outlineOn: toTheLayer && tone.outside ? near : null });
    tone.finish();
    return env.log.filter((entry) => ["stroke", "fill", "drawImage"].includes(entry.call));
  };
  const outside = paint(true);
  assert.deepEqual(outside.map((entry) => `${entry.on}:${entry.call}`), [
    "near:stroke", "near:stroke", "scratch0:fill", "scratch0:stroke",
    "near:stroke", "near:stroke", "scratch0:fill", "scratch0:stroke",
    "near:drawImage",
  ], "each outline goes to the layer, each body to the scratch, and the scratch goes down last");
  assert.deepEqual(outside.filter((entry) => entry.on === "near" && entry.call === "stroke").map((entry) => [entry.stroke, entry.width, entry.alpha]),
    [["rgba(0,0,0,0.9)", 4, 0.4], ["rgba(255,255,255,0.9)", 1, 0.4], ["rgba(0,0,0,0.9)", 4, 0.8], ["rgba(255,255,255,0.9)", 1, 0.8]], "black then white, at each node's own fade and alpha, never brightened");
  assert.equal(outside.at(-1).filter, "brightness(2)");
  assert.deepEqual(paint(false).map((entry) => `${entry.on}:${entry.call}`), [
    "scratch0:stroke", "scratch0:stroke", "scratch0:fill", "scratch0:stroke",
    "scratch0:stroke", "scratch0:stroke", "scratch0:fill", "scratch0:stroke",
    "near:drawImage",
  ], "without the layer to paint on, the outline is part of the pass, as it is below 100%");
});

test("nothing changes at 100%: a node and its outline paint on the layer itself and nothing is laid down", () => {
  const env = load(), near = env.layer("near");
  env.dynamics.update({ outlines: true });
  assert.equal(env.toneBegin("nodes", near), null);
  env.drawNodeSurface(near, { _fade: 1 }, { x: 100, y: 50 }, 12, [200, 120, 60], { outlineOn: null });
  assert.deepEqual(env.log.filter((entry) => ["stroke", "fill", "drawImage"].includes(entry.call)).map((entry) => `${entry.on}:${entry.call}`), ["near:stroke", "near:stroke", "near:fill", "near:stroke"]);
  assert.equal(env.made.length, 0);
});

test("the nodes pass paints through the scratch pens and hands each node the layer its outline goes to", () => {
  for (const marker of [
    'const nodeTone = toneBegin("nodes", ctx, focusIds && far !== ctx ? far : null);',
    "const ctx = !nodeTone ? layer : layer === el.ctx ? nodeTone.near : nodeTone.far ?? layer;",
    "const cap = Math.min(costCap, layer !== el.ctx || factor <= 0.3 ? 1 :",
    "surface.outlineOn = nodeTone?.outside ? layer : null;",
    "drawNodeSurface(ctx, node, p, radius, tint, surface);",
    "} finally { nodeTone?.finish(); profiler?.end(nodesSpan); }",
    "MefiTreeDynamics?.outline?.(outlineOn ?? ctx,",
    'const tone = toneBegin("lines", ctx, farPen);',
  ]) assert.ok(idle.includes(marker), `idle.js carries ${marker}`);
});
