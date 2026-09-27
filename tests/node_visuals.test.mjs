import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../renderer/node-visuals.js", import.meta.url), "utf8");
function fixture() {
  let gradients = 0, measures = 0, theme = "#10232c";
  const listeners = {};
  const window = { addEventListener: (name, fn) => { listeners[name] = fn; } };
  const env = vm.createContext({ window, document: { documentElement: {} }, getComputedStyle: () => ({ getPropertyValue: (key) => key === "--panel-solid" ? theme : "" }) });
  vm.runInContext(source, env);
  const ctx = new Proxy({ font: "13px sans-serif", measureText(text) { measures++; return { width: Array.from(text).reduce((w, c) => w + (c === "W" ? 12 : 6), 0) }; } }, {
    get(target, key) {
      if (key in target) return target[key];
      if (String(key).startsWith("create")) return () => { gradients++; return { addColorStop() {} }; };
      return () => {};
    },
  });
  return { window, visual: window.MefiNodeVisuals, ctx, gradients: () => gradients, measures: () => measures,
    theme(value) { theme = value; listeners["mefi-theme-change"](); } };
}
test("shared finishes reuse paints across moving nodes, separate contexts and invalidate theme colors", () => {
  const f = fixture();
  const styles = ["orbs", "glass", "minimal", "halo", "crystal", "singularity", "prism", "sigil"];
  for (let frame = 0; frame < 20; frame++) for (const style of styles) {
    assert.equal(f.visual.drawNode(f.ctx, { x: frame * 2, y: 90 }, 4 + frame / 3, "#71cbb7", { style, active: true, glyph: frame % 2 === 0 }), true);
  }
  assert.equal(f.gradients(), 3, "position, radius and style reuse unit-space paints");
  f.theme("#f2ede5");
  assert.equal(f.visual.palette().surface, "#f2ede5");
  f.visual.drawNode(f.ctx, { x: 10, y: 10 }, 10, "#71cbb7", { active: true });
  assert.equal(f.gradients(), 6, "new theme gets new paints");
  const other = fixture();
  f.visual.drawNode(other.ctx, { x: 10, y: 10 }, 10, "#71cbb7", { active: true });
  assert.equal(other.gradients(), 3, "a canvas owns its gradients");
  for (let i = 0; i < 120; i++) f.visual.drawNode(f.ctx, { x: 0, y: 0 }, 8, `rgb(${i},100,120)`);
  const before = f.gradients();
  f.visual.drawNode(f.ctx, { x: 0, y: 0 }, 8, "rgb(119,100,120)");
  assert.equal(f.gradients(), before);
  f.visual.drawNode(f.ctx, { x: 0, y: 0 }, 8, "rgb(0,100,120)");
  assert.equal(f.gradients(), before + 3, "old paints are evicted");
});
test("text fitting measures wide characters, preserves unicode and restores the caller's font", () => {
  const f = fixture();
  const result = f.visual.fitText(f.ctx, "WWW emoji 🪐 name", 56, "600 13px sans-serif");
  assert.ok(f.ctx.measureText(result).width <= 56);
  assert.ok(result.endsWith("…"));
  assert.equal(f.ctx.font, "13px sans-serif");
  const before = f.measures();
  assert.equal(f.visual.fitText(f.ctx, "WWW emoji 🪐 name", 56, "600 13px sans-serif"), result);
  assert.equal(f.measures(), before, "unchanged labels are not remeasured each frame");
  assert.equal(f.visual.fitText(f.ctx, "🪐🪐🪐", 18), "🪐🪐🪐");
  assert.equal(f.visual.fitText(f.ctx, "a long title", 3), "");
});
test("connection endpoints stop at node rims and stay ordered for overlapping nodes", () => {
  const { visual } = fixture();
  assert.equal(visual.endpoints({ x: 0, y: 0 }, { x: 100, y: 0 }, 10, 20).a.x, 10);
  assert.equal(visual.endpoints({ x: 0, y: 0 }, { x: 100, y: 0 }, 10, 20).b.x, 80);
  const short = visual.endpoints({ x: 0, y: 0 }, { x: 8, y: 0 }, 10, 20);
  assert.ok(short.a.x < short.b.x);
  assert.equal(visual.endpoints({ x: 4, y: 4 }, { x: 4, y: 4 }, 10, 20).a.x, 4);
});

test("parallel and deep pipelines keep readable cards inside a scrollable scene", async () => {
  const brain = await readFile(new URL("../renderer/agent-brain.js", import.meta.url), "utf8");
  const start = brain.indexOf("  function layoutPipeline("), end = brain.indexOf("  const scene =", start);
  const env = vm.createContext({ clamp: (v, low, high) => Math.min(high, Math.max(low, v)) });
  vm.runInContext(brain.slice(start, end), env);
  for (const width of [240, 320, 500, 900]) for (const parallel of [true, false]) {
    const steps = Array.from({length:12},(_,i)=>({id:`step-${i}`,parents:i&&(!parallel||i===11)?[`step-${i-1}`]:[]}));
    const initial = env.layoutPipeline({steps}, width, 360);
    const layout = env.layoutPipeline({steps}, width, Math.max(360, initial.height));
    const boxes = [...layout.at].map(([id,p])=>({id,x:p.x-layout.pillW/2,y:p.y-layout.pillH/2,w:layout.pillW,h:layout.pillH}));
    assert.ok(layout.pillW>=96 && layout.pillH>=44);
    for(const box of boxes){
      assert.ok(box.x>=0 && box.x+box.w<=width, `${width}: ${box.id} fits horizontally`);
      assert.ok(box.y>=0 && box.y+box.h<=Math.max(360,initial.height), `${width}: ${box.id} is reachable by scrolling`);
      for(const other of boxes)if(box!==other)assert.ok(box.x+box.w<=other.x||other.x+other.w<=box.x||box.y+box.h<=other.y||other.y+other.h<=box.y,"step cards do not overlap");
    }
  }
});

test("pipeline hover titles stay in the visible pane after inner or outer scrolling", async () => {
  const brain = await readFile(new URL("../renderer/agent-brain.js", import.meta.url), "utf8");
  const start = brain.indexOf("  function placePipelineTooltip("), end = brain.indexOf("  function wirePipelineHover(", start);
  const env = vm.createContext({}); vm.runInContext(brain.slice(start, end), env);
  for (const scrollTop of [0, 220]) for (const outerScroll of [0, 180]) {
    const box = {left:80,right:580,top:180-outerScroll,bottom:780-outerScroll,width:500,height:600};
    const pane = {left:64,right:600,top:160,bottom:560};
    const stage = {scrollLeft:0,scrollTop,getBoundingClientRect:()=>box,closest:()=>({getBoundingClientRect:()=>pane})};
    const tip = {style:{},offsetWidth:260,offsetHeight:100};
    env.placePipelineTooltip(stage,tip,{clientX:555,clientY:530});
    const left = parseFloat(tip.style.left)+box.left, top = parseFloat(tip.style.top)-scrollTop+box.top;
    assert.ok(left>=pane.left && left+tip.offsetWidth<=pane.right);
    assert.ok(top>=pane.top && top+tip.offsetHeight<=pane.bottom);
  }
});
test("the prism draws its Void rim from MefiNodeStyles.shapes, and polygons without it", () => {
  const f = fixture();
  const traced = [];
  f.visual.drawNode(f.ctx, { x: 0, y: 0 }, 8, "#71cbb7", { style: "prism" });
  assert.equal(traced.length, 0, "no shapes module: the fallback polygon draws");
  const rim = [[0, -1], [1, 0], [0, 1]];
  const window = f.window;
  window.MefiNodeStyles = { shapes: { prismRim: rim, trace: (target, points) => traced.push(points) } };
  window.MefiTree = { voidShapes: { prismRim: [], trace: () => assert.fail("the rail no longer provides the Void shapes") } };
  assert.equal(f.visual.drawNode(f.ctx, { x: 0, y: 0 }, 8, "#71cbb7", { style: "prism" }), true);
  assert.ok(traced.length >= 2 && traced.every((points) => points === rim), "the fill and the stroke both trace the shared prism rim");
});
test("every MefiNodeStyles member a renderer script probes is one node-styles.js exports", async () => {
  const { loadNodeStyles } = await import("./fixtures/node-styles-harness.mjs");
  const { readdir } = await import("node:fs/promises");
  const exported = new Set(Object.keys(loadNodeStyles()));
  const dir = new URL("../renderer/", import.meta.url);
  const probes = [];
  for (const name of (await readdir(dir)).filter((file) => file.endsWith(".js"))) {
    const text = await readFile(new URL(name, dir), "utf8");
    for (const match of text.matchAll(/MefiNodeStyles\??\.([A-Za-z_$][\w$]*)/g)) probes.push([name, match[1]]);
  }
  assert.ok(probes.some(([name, member]) => name === "node-visuals.js" && member === "shapes"), "the prism reads the shared shapes");
  for (const [name, member] of probes) assert.ok(exported.has(member), `${name} probes MefiNodeStyles.${member}, which node-styles.js does not export`);
});
