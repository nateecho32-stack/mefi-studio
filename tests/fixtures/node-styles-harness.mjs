// The node-style suites' shared harness: renderer/node-styles.js loaded the
// way a blank page would load it (a vm holding only `window`), and a canvas
// stand-in that follows the full affine transform, so every point a painter
// touches is measured in screen space, and that counts what a frame builds.
//
// const styles = loadNodeStyles();            // window.MefiNodeStyles
// const ctx = recordingContext({ center: { x: 50, y: 50 } });
// styles.paint(ctx, "orbs", { x: 50, y: 50 }, 12, [220, 180, 110], { active: true });
// ctx.calls.fill, ctx.calls.reach, ctx.calls.log …
//
// Values made inside the vm come from another realm: compare arrays and
// objects from it with plain() (a JSON round trip), not deepStrictEqual.
import { readFileSync } from "node:fs";
import vm from "node:vm";

export const NODE_STYLES_SOURCE = readFileSync(new URL("../../renderer/node-styles.js", import.meta.url), "utf8");

export const plain = (value) => JSON.parse(JSON.stringify(value));

// A fresh module per call, so caches never leak between tests. `extra` adds
// globals to the vm (a test may want a Math spy, never the DOM).
export function loadNodeStyles(extra = {}) {
  const context = vm.createContext({ window: {}, ...extra });
  vm.runInContext(NODE_STYLES_SOURCE, context, { filename: "renderer/node-styles.js" });
  return context.window.MefiNodeStyles;
}

const STATE_KEYS = ["globalAlpha", "lineWidth", "fillStyle", "strokeStyle", "font", "textAlign", "textBaseline", "lineCap", "lineJoin", "lineDashOffset", "shadowBlur", "shadowColor", "globalCompositeOperation"];
const round = (value) => typeof value === "number" ? Math.round(value * 1e6) / 1e6 : value;

// calls:
//   fill, stroke, arc, ellipse, lineTo, moveTo, quadraticCurveTo,
//   bezierCurveTo, closePath, fillText, fillRect, rect, roundRect, rotate,
//   setLineDash                           counts
//   radial, linear, conic                 gradients created
//   gradients                             [{ kind, args, stops: [[offset, colour]] }]
//   saves, restores                       save()/restore() calls
//   reach                                 farthest screen distance from `center`
//                                         of anything drawn (arcs add radius × scale)
//   pathReach                             the same for path points only
//                                         (moveTo/lineTo/curve ends and midpoints)
//   lineWidths                            every stroke's lineWidth × current scale
//   fills, strokes                        [{ style, alpha, width? }] per call
//   alphas                                globalAlpha at every fill and stroke
//   texts                                 [{ text, ink, alpha }]
//   shadowBlurs                           every shadowBlur value set
//   log                                   every call, [name, ...args rounded to 1e-6];
//                                         a gradient logs as its tag (below)
// Like a real canvas, ctx.transform(a, b, c, d, e, f) multiplies the current
// matrix and ctx.getTransform() reads it as { a, b, c, d, e, f }; ctx.matrix()
// reads it as [a, b, c, d, e, f]. Every gradient carries a stable tag,
// "grad:<kind>#<n>(<args>)" plus its stops once any are added, which is what
// the log records when it is set as a fill or stroke, so two frames that fill
// with different cached paints never compare equal.
export function recordingContext({ center = { x: 50, y: 50 }, conic = true } = {}) {
  const calls = {
    fill: 0, stroke: 0, arc: 0, ellipse: 0, lineTo: 0, moveTo: 0, quadraticCurveTo: 0, bezierCurveTo: 0, closePath: 0,
    fillText: 0, fillRect: 0, rect: 0, roundRect: 0, rotate: 0, setLineDash: 0,
    radial: 0, linear: 0, conic: 0, gradients: [],
    saves: 0, restores: 0, reach: 0, pathReach: 0,
    lineWidths: [], fills: [], strokes: [], alphas: [], texts: [], shadowBlurs: [], log: [],
  };
  let m = [1, 0, 0, 1, 0, 0];
  let dash = [];
  let current = null; // the path's current point, in user space
  const stack = [];
  const props = { globalAlpha: 1, lineWidth: 1, fillStyle: "#000000", strokeStyle: "#000000", font: "10px sans-serif", textAlign: "start", textBaseline: "alphabetic", lineCap: "butt", lineJoin: "miter", lineDashOffset: 0, shadowBlur: 0, shadowColor: "rgba(0,0,0,0)", globalCompositeOperation: "source-over" };
  const multiply = (a, b) => [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ];
  const apply = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const scaleOf = () => Math.max(Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3]));
  const distance = (x, y) => { const [sx, sy] = apply(x, y); return Math.hypot(sx - center.x, sy - center.y); };
  const point = (x, y, extra = 0) => { calls.reach = Math.max(calls.reach, distance(x, y) + extra * scaleOf()); };
  const pathPoint = (x, y) => { point(x, y); calls.pathReach = Math.max(calls.pathReach, distance(x, y)); };
  const log = (name, args) => calls.log.push([name, ...Array.from(args, round)]);
  // A gradient's tag: its kind, its index among this canvas's gradients, its
  // arguments and (once added) its stops.
  const TAG = Symbol("gradient");
  const tagOf = (value) => value && typeof value === "object" && value[TAG] ? value[TAG]() : round(value);
  const gradient = (kind, args) => {
    calls[kind] += 1;
    const record = { kind, args: Array.from(args), stops: [] };
    const name = `grad:${kind}#${calls.gradients.length}(${record.args.map(round).join(",")})`;
    calls.gradients.push(record);
    log(`create:${kind}`, args);
    const tag = () => record.stops.length ? `${name}[${record.stops.map(([offset, colour]) => `${round(offset)} ${colour}`).join(";")}]` : name;
    return {
      [TAG]: tag,
      addColorStop: (offset, colour) => { record.stops.push([offset, colour]); calls.log.push(["addColorStop", name, round(offset), colour]); },
    };
  };
  const ctx = {
    calls,
    transform(a, b, c, d, e, f) { m = multiply(m, [a, b, c, d, e, f]); log("transform", arguments); },
    getTransform: () => ({ a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5] }),
    matrix: () => m.slice(),
    save() { calls.saves += 1; stack.push({ m: m.slice(), dash: dash.slice(), props: STATE_KEYS.map((key) => props[key]) }); log("save", []); },
    restore() {
      calls.restores += 1; log("restore", []);
      const saved = stack.pop();
      if (!saved) return;
      m = saved.m; dash = saved.dash;
      STATE_KEYS.forEach((key, index) => { props[key] = saved.props[index]; });
    },
    translate(x, y) { m = multiply(m, [1, 0, 0, 1, x, y]); log("translate", arguments); },
    scale(sx, sy = sx) { m = multiply(m, [sx, 0, 0, sy, 0, 0]); log("scale", arguments); },
    rotate(angle) { calls.rotate += 1; const c = Math.cos(angle), s = Math.sin(angle); m = multiply(m, [c, s, -s, c, 0, 0]); log("rotate", arguments); },
    setTransform(a, b, c, d, e, f) { m = [a, b, c, d, e, f]; log("setTransform", arguments); },
    resetTransform() { m = [1, 0, 0, 1, 0, 0]; log("resetTransform", []); },
    beginPath() { current = null; log("beginPath", []); },
    closePath() { calls.closePath += 1; log("closePath", []); },
    moveTo(x, y) { calls.moveTo += 1; pathPoint(x, y); current = [x, y]; log("moveTo", arguments); },
    lineTo(x, y) { calls.lineTo += 1; pathPoint(x, y); current = [x, y]; log("lineTo", arguments); },
    quadraticCurveTo(cx, cy, x, y) {
      calls.quadraticCurveTo += 1;
      if (current) pathPoint(0.25 * current[0] + 0.5 * cx + 0.25 * x, 0.25 * current[1] + 0.5 * cy + 0.25 * y);
      pathPoint(x, y); current = [x, y]; log("quadraticCurveTo", arguments);
    },
    bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
      calls.bezierCurveTo += 1;
      if (current) pathPoint((current[0] + 3 * c1x + 3 * c2x + x) / 8, (current[1] + 3 * c1y + 3 * c2y + y) / 8);
      pathPoint(x, y); current = [x, y]; log("bezierCurveTo", arguments);
    },
    arc(x, y, r) { calls.arc += 1; point(x, y, r); log("arc", arguments); },
    ellipse(x, y, rx, ry) { calls.ellipse += 1; point(x, y, Math.max(Math.abs(rx), Math.abs(ry))); log("ellipse", arguments); },
    rect(x, y, w, h) { calls.rect += 1; pathPoint(x, y); pathPoint(x + w, y + h); log("rect", arguments); },
    roundRect(x, y, w, h) { calls.roundRect += 1; pathPoint(x, y); pathPoint(x + w, y + h); log("roundRect", arguments); },
    fill() { calls.fill += 1; calls.fills.push({ style: this.fillStyle, alpha: this.globalAlpha }); calls.alphas.push(this.globalAlpha); log("fill", []); },
    stroke() {
      calls.stroke += 1;
      const width = this.lineWidth * scaleOf();
      calls.lineWidths.push(width);
      calls.strokes.push({ style: this.strokeStyle, alpha: this.globalAlpha, width });
      calls.alphas.push(this.globalAlpha);
      log("stroke", []);
    },
    fillRect(x, y, w, h) { calls.fillRect += 1; point(x, y); point(x + w, y + h); calls.fills.push({ style: this.fillStyle, alpha: this.globalAlpha }); calls.alphas.push(this.globalAlpha); log("fillRect", arguments); },
    strokeRect(x, y, w, h) { point(x, y); point(x + w, y + h); log("strokeRect", arguments); },
    clearRect() {}, clip() { log("clip", []); },
    fillText(text, x, y) { calls.fillText += 1; point(x, y); calls.texts.push({ text, ink: this.fillStyle, alpha: this.globalAlpha }); log("fillText", arguments); },
    measureText: (text) => ({ width: String(text).length * 6 }),
    setLineDash(values) { calls.setLineDash += 1; dash = Array.from(values); log("setLineDash", values); },
    getLineDash: () => dash.slice(),
    drawImage() { log("drawImage", []); },
    createRadialGradient(...args) { return gradient("radial", args); },
    createLinearGradient(...args) { return gradient("linear", args); },
  };
  if (conic) ctx.createConicGradient = (...args) => gradient("conic", args);
  for (const key of STATE_KEYS) {
    Object.defineProperty(ctx, key, {
      enumerable: true,
      get: () => props[key],
      set: (value) => {
        props[key] = value;
        if (key === "shadowBlur") calls.shadowBlurs.push(value);
        calls.log.push([`set:${key}`, tagOf(value)]);
      },
    });
  }
  return ctx;
}

// How many gradients a recorded context has built so far.
export const gradientsBuilt = (ctx) => ctx.calls.radial + ctx.calls.linear + ctx.calls.conic;
