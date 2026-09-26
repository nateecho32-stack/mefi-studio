import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("../renderer/tree-dynamics.js", import.meta.url), "utf8");
function setup(storage = new Map()) {
  const events = [];
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.events = {}; this.type = ""; }
    append(child) { this.children.push(child); }
    setAttribute(key, value) { this[key] = value; }
    addEventListener(key, fn) { this.events[key] = fn; }
  }
  const window = { dispatchEvent: event => events.push(event.type) };
  vm.runInNewContext(source, { window, CustomEvent: class { constructor(type) { this.type = type; } }, document: { createElement: tag => new Element(tag) }, localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } });
  return { d: window.MefiTreeDynamics, storage, events, Element };
}
const area = { x: 100, y: 50, w: 800, h: 500 };
const graph = (n = 12) => Array.from({ length: n }, (_, i) => ({ node: { id: `node-${i}`, x: i, kind: "task" }, p: { x: 200 + i % 6 * 90, y: 130 + Math.floor(i / 6) * 90, k: 1 } }));
const coords = nodes => nodes.map(({ p }) => [p.x, p.y]);
function settled(d, nodes, options = {}) {
  const result = structuredClone(nodes);
  d.apply(result, area, { dt: 100, time: 1300, ...options });
  return result;
}
test("tree modes persist bounded controls and migrate the previous dark-region preference", () => {
  const { d, storage, events } = setup();
  d.update({ mode: "hybrid", width: -50, rotation: 999, smoothing: NaN, nodeSize: "large", videoTarget: "bright", adaptCount: false });
  const prefs = d.preferences();
  assert.equal(prefs.width, .4); assert.equal(prefs.rotation, 180); assert.equal(prefs.nodeSize, 1); assert.equal(prefs.smoothing, 2);
  assert.equal(prefs.adaptCount, false); assert.equal(d.musicEnabled(), true); assert.equal(d.videoEnabled(), true);
  assert.deepEqual({ ...setup(storage).d.preferences() }, { ...prefs });
  assert.ok(events.includes("mefi:tree-dynamics"));
  assert.equal(setup(new Map([["mefiStudio.mediaWindow.v1", '{"trackDark":true}']])).d.preferences().mode, "hybrid");
});
test("live shapes remain finite and in bounds for empty, single and dense trees without modifying anchors", () => {
  for (const shape of ["layout", "ring", "wave", "spiral"]) for (const n of [0, 1, 12, 160]) {
    const { d } = setup(); d.update({ shape, width: .4, height: .4, rotation: 145, x: 1, y: -1, nodeSize: 1.6 });
    const nodes = graph(n), result = settled(d, nodes);
    assert.equal(d.status().count, n);
    assert.deepEqual(result.map(({ node }) => node.x), nodes.map(({ node }) => node.x));
    for (const { p, node } of result) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(node._treeScale));
      assert.ok(p.x >= area.x && p.x <= area.x + area.w && p.y >= area.y && p.y <= area.y + area.h);
    }
  }
});
test("dense shapes reduce node size and increase the sampled footprint with count adaptation", () => {
  const { d } = setup(); d.update({ shape: "ring", mode: "video" }); d.setVideoAvailable(true);
  const sparse = settled(d, graph(8)), smallFootprint = d.sampleRequest().coverageW;
  const dense = settled(d, graph(120)), largeFootprint = d.sampleRequest().coverageW;
  assert.ok(dense[0].node._treeScale < sparse[0].node._treeScale);
  assert.ok(largeFootprint > smallFootprint);
  d.update({ adaptCount: false });
  assert.equal(settled(d, graph(120))[0].node._treeScale, 1);
});
test("music controls move geometry and nodes, while steady, silence, zero response and reduced motion settle them", () => {
  const nodes = graph();
  const options = { music: { bass: .9, mid: .7, treble: .6 }, linked: true, response: 1 };
  const quiet = settled(setup().d, nodes);
  const loud = settled(setup().d, nodes, options);
  assert.notDeepEqual(coords(loud), coords(quiet)); assert.ok(loud[0].node._treeScale > quiet[0].node._treeScale);
  for (const extra of [{ still: true }, { response: 0 }, { linked: false }]) assert.deepEqual(coords(settled(setup().d, nodes, { ...options, ...extra })), coords(quiet));
  const { d } = setup(); d.update({ mode: "steady" }); assert.deepEqual(coords(settled(d, nodes, options)), coords(quiet));
  d.update({ mode: "music", nodeMotion: 0, shapeMotion: 0, positionMotion: 0 });
  assert.deepEqual(coords(settled(d, nodes, options)), coords(quiet));
});
test("video follows stable dark or bright regions, honors dwell and rejects stale or malformed samples", () => {
  const { d } = setup(); d.update({ mode: "hybrid", dwell: 15 }); d.setVideoAvailable(true);
  let token = d.sampleRequest().revision;
  const dark = [.05, .3, .8, .4, .5, .7, .8, .8, .9];
  assert.equal(d.acceptSample(dark, token, 10000), false); assert.equal(d.acceptSample(dark, token, 15000), true);
  assert.equal(d.status().scene.x, -1); assert.equal(d.status().scene.y, -1);
  const moved = settled(d, graph()), baseline = settled(setup().d, graph());
  assert.notDeepEqual(coords(moved), coords(baseline));
  token = d.sampleRequest().revision;
  const opposite = [...dark].reverse();
  assert.equal(d.acceptSample(opposite, token, 20000), false); assert.equal(d.acceptSample(opposite, token, 25000), false);
  assert.equal(d.acceptSample(opposite, token, 35000), true);
  d.update({ videoTarget: "bright" });
  assert.equal(d.acceptSample(dark, token, 50000), false);
  const brightToken = d.sampleRequest().revision;
  d.acceptSample(dark, brightToken, 55000); assert.equal(d.acceptSample(dark, brightToken, 60000), true);
  assert.equal(d.status().scene.x, 1); assert.equal(d.status().scene.y, 1);
  assert.equal(d.acceptSample([NaN], brightToken), false);
  d.setVideoAvailable(false); assert.equal(d.sampleRequest(), null); assert.equal(d.status().scene, null);
});
test("geometry eases toward edits and releases to manual camera control", () => {
  const { d } = setup(), nodes = graph(); d.update({ shape: "ring", smoothing: 2 });
  const first = structuredClone(nodes); d.apply(first, area, { dt: .016 });
  const last = settled(d, nodes);
  assert.ok(Math.hypot(first[0].p.x - nodes[0].p.x, first[0].p.y - nodes[0].p.y) < Math.hypot(last[0].p.x - nodes[0].p.x, last[0].p.y - nodes[0].p.y));
  assert.deepEqual(coords(settled(d, nodes, { interactive: true })), coords(nodes));
});
test("Appearance and Audio controls synchronize, persist edits, and reset together", () => {
  const { d, Element, storage } = setup();
  const a = d.mount(new Element("section"), "appearance"), b = d.mount(new Element("section"), "audio");
  const all = root => [root, ...root.children.flatMap(all)];
  const input = all(a).find(e => e.id === "appearance-tree-mode"); input.value = "hybrid"; input.events.change();
  assert.equal(all(b).find(e => e.id === "audio-tree-mode").value, "hybrid");
  assert.equal(setup(storage).d.preferences().mode, "hybrid");
  const width = all(b).find(e => e.id === "audio-tree-width"); width.value = ".5"; width.events.input();
  assert.equal(all(a).find(e => e.id === "appearance-tree-width").value, "0.5");
  all(a).find(e => e.tagName === "button").events.click();
  assert.equal(width.value, "1"); assert.equal(input.value, "music");
});

test("node and line brightness are independent, bounded and bypassed without losing saved values", () => {
  const { d, storage } = setup();
  const near = { filter: "none" }, far = { filter: "blur(2px)" };
  assert.equal(d.beginPaint([near, far], "nodes"), null, "normal brightness adds no filter work");
  d.update({ nodeBrightness: 1.6, lineBrightness: .4, outlines: true });
  let restore = d.beginPaint([near, far, near], "nodes");
  assert.equal(near.filter, "brightness(1.6)"); assert.equal(far.filter, "blur(2px) brightness(1.6)");
  restore(); assert.equal(near.filter, "none"); assert.equal(far.filter, "blur(2px)");
  restore = d.beginPaint([near], "lines"); assert.equal(near.filter, "brightness(0.4)"); restore();
  d.update({ nodeBrightnessEnabled: false });
  assert.equal(d.beginPaint([near], "nodes"), null);
  assert.equal(d.preferences().nodeBrightness, 1.6);
  assert.equal(setup(storage).d.preferences().nodeBrightnessEnabled, false);
  assert.equal(setup(storage).d.preferences().outlines, true);
  d.update({ nodeBrightness: 100, lineBrightness: -10, lineBrightnessEnabled: "no", outlines: "yes" });
  assert.equal(d.preferences().nodeBrightness, 2); assert.equal(d.preferences().lineBrightness, 0);
  assert.equal(d.preferences().lineBrightnessEnabled, true);
});

test("brightness edits retain the video tracking region and node outlines are explicitly optional", () => {
  const { d } = setup();
  d.update({ mode: "video" }); d.setVideoAvailable(true);
  const token = d.sampleRequest().revision, scores = [.01, .5, .8, .5, .6, .8, .8, .8, .9];
  d.acceptSample(scores, token, 10000); d.acceptSample(scores, token, 15000);
  const before = JSON.stringify(d.status().scene);
  d.update({ nodeBrightness: 1.5, lineBrightnessEnabled: false, outlines: true });
  assert.equal(d.sampleRequest().revision, token); assert.equal(JSON.stringify(d.status().scene), before);
  const strokes = [], pen = { globalAlpha: 1, save() {}, restore() {}, beginPath() {}, arc() {}, stroke() { strokes.push(this.strokeStyle); } };
  d.outline(pen, "orbs", { x: 20, y: 20 }, 10, null);
  assert.deepEqual(strokes, ["rgba(0,0,0,0.9)", "rgba(255,255,255,0.9)"]);
  d.update({ outlines: false }); d.outline(pen, "orbs", { x: 20, y: 20 }, 10, null);
  assert.equal(strokes.length, 2, "disabling outlines does not alter the underlying node painting");
});

test("media and Appearance brightness controls synchronize, disable sliders and reset only visibility", () => {
  const { d, Element } = setup(), all = root => [root, ...root.children.flatMap(all)];
  const a = d.mount(new Element("section"), "appearance"), b = d.mountVisibility(new Element("section"), "media");
  const input = (root, id) => all(root).find(e => e.id === id);
  d.update({ mode: "hybrid", width: .5 });
  const slider = input(b, "media-tree-nodeBrightness"); slider.value = "1.7"; slider.events.input();
  assert.equal(input(a, "appearance-tree-nodeBrightness").value, "1.7");
  const toggle = input(a, "appearance-tree-nodeBrightnessEnabled"); toggle.checked = false; toggle.events.change();
  assert.equal(slider.disabled, true); assert.equal(slider.value, "1.7");
  all(b).find(e => e.tagName === "button").events.click();
  assert.equal(slider.disabled, false); assert.equal(slider.value, "1");
  assert.equal(d.preferences().mode, "hybrid"); assert.equal(d.preferences().width, .5);
});
