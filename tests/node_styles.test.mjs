// renderer/node-styles.js (window.MefiNodeStyles): the painters the Command
// view and the tree rail share. The module loads whole into a vm holding only
// `window` (tests/fixtures/node-styles-harness.mjs), so nothing here depends
// on slice anchors. Sections: the module's frame (banners, registration,
// export), infra (seed, easing, motion, tint fades, theme tones, tiers,
// caches), the paint contract every style keeps, then the looks themselves,
// one section per owner so each can be replaced on its own.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { NODE_STYLES_SOURCE as source, loadNodeStyles, recordingContext, gradientsBuilt, plain } from "./fixtures/node-styles-harness.mjs";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [idle, tree, build, bookletTest] = await Promise.all([read("../renderer/idle.js"), read("../renderer/tree3d.js"), read("../scripts/build-booklet.mjs"), read("./booklet_build.test.mjs")]);
const STYLES = ["orbs", "glass", "minimal", "halo", "crystal", "singularity", "prism", "sigil"];
const BANNERS = ["infra", "shapes: void", "style: orbs", "style: glass", "style: minimal", "style: halo", "style: crystal", "style: singularity", "style: prism", "style: sigil", "overlays", "wires", "export"];
const HOOKS = ["speedup", "paint", "glyph", "ring", "hubDress", "orbit", "arrival", "select", "wire", "surge", "land", "reach"];
const lines = source.replace(/\r\n/g, "\n").split("\n");

// The text of one banner section, banner line excluded.
function sectionOf(name) {
  const start = lines.indexOf(`// ===== ${name} =====`);
  assert.ok(start >= 0, `missing the ${name} banner`);
  let end = start + 1;
  while (end < lines.length && !/^\/\/ ===== .+ =====$/.test(lines[end])) end += 1;
  return lines.slice(start + 1, end).join("\n");
}

// ===== the module's frame =====

test("node-styles.js loads into a bare vm and exports one frozen contract", () => {
  const styles = loadNodeStyles();
  assert.ok(styles, "window.MefiNodeStyles is set");
  assert.ok(Object.isFrozen(styles));
  assert.deepEqual(Object.keys(styles), ["version", "STYLES", "PREMIUM", "shapes", "seed", "hash", "approach", "motionRecord", "stepMotion", "shownTint", "theme", "inkOf", "tier", "paint", "glyph", "ring", "hubDress", "orbit", "arrival", "select", "wire", "surge", "land", "reach", "cacheStats"]);
  assert.equal(styles.version, 1);
  assert.deepEqual(plain(styles.STYLES), STYLES);
  assert.deepEqual(plain(styles.PREMIUM), ["singularity", "prism", "sigil"]);
  assert.ok(Object.isFrozen(styles.STYLES) && Object.isFrozen(styles.PREMIUM));
  for (const name of ["document", "Path2D", "OffscreenCanvas", "setTimeout", "requestAnimationFrame", "performance"]) {
    assert.ok(!new RegExp(`\\b${name}\\b`).test(source.replace(/^\s*\/\/.*$/gm, "")), `nothing in the module reaches for ${name}`);
  }
});

test("the module is cut into its owners' banner sections, in order, each registering one look", () => {
  const banners = lines.filter((line) => /^\/\/ ===== .+ =====$/.test(line));
  assert.deepEqual(banners, BANNERS.map((name) => `// ===== ${name} =====`), "exactly these banners, once each, in this order");
  for (const name of BANNERS) {
    const index = lines.indexOf(`// ===== ${name} =====`);
    assert.equal(lines[index - 1], "", `a blank line before the ${name} banner`);
    assert.equal(lines[index + 1], "", `a blank line after the ${name} banner`);
  }
  for (const name of BANNERS) {
    const text = sectionOf(name);
    const registered = [...text.matchAll(/^\s*LOOKS\.(\w+)\s*=/gm)].map((match) => match[1]);
    if (!name.startsWith("style: ")) { assert.deepEqual(registered, [], `${name} registers no look`); continue; }
    const style = name.slice("style: ".length);
    assert.deepEqual(registered, [style], `${name} registers exactly LOOKS.${style}`);
    // The entry's own keys, read by brace matching over its literal.
    const at = text.indexOf(`LOOKS.${style} = {`) + `LOOKS.${style} = `.length;
    let depth = 0, end = at;
    for (; end < text.length; end += 1) {
      if (text[end] === "{") depth += 1;
      else if (text[end] === "}" && --depth === 0) break;
    }
    const body = text.slice(at + 1, end);
    let keys = [], level = 0, token = "";
    for (const char of body) {
      if (char === "{" || char === "(" || char === "[") level += 1;
      else if (char === "}" || char === ")" || char === "]") level -= 1;
      else if (char === "," && level === 0) { keys.push(token); token = ""; continue; }
      token += char;
    }
    if (token.trim()) keys.push(token);
    keys = keys.map((entry) => entry.trim().split(/[:(\s]/)[0]).filter(Boolean);
    assert.deepEqual(keys, HOOKS, `LOOKS.${style} carries every hook, in the contract's order`);
  }
});

test("registration: the module is bundled before the rail and the Command view, everywhere it is listed", () => {
  assert.match(build, /readFile\(path\.join\(RENDERER, "node-styles\.js"\), "utf8"\)/);
  const parts = build.match(/const codeParts = \[([^\]]+)\]/)[1].split(",").map((name) => name.trim());
  assert.ok(parts.indexOf("nodeStyles") >= 0 && parts.indexOf("nodeStyles") < parts.indexOf("tree") && parts.indexOf("nodeStyles") < parts.indexOf("idle"), "codeParts: nodeStyles, tree, idle");
  assert.equal(parts.indexOf("nodeStyles"), parts.indexOf("tracker") + 1);
  const sources = [...build.match(/const CODE_SOURCES = \[([^\]]+)\]/)[1].matchAll(/"([\w.-]+)\.js"/g)].map((match) => match[1]);
  assert.equal(sources.indexOf("node-styles"), parts.indexOf("nodeStyles"), "CODE_SOURCES stays index-aligned with codeParts");
  assert.ok(sources.indexOf("node-styles") < sources.indexOf("tree3d") && sources.indexOf("node-styles") < sources.indexOf("idle"));
  const read = build.match(/const \[styles, [^\]]+\] = await Promise\.all/)[0];
  assert.ok(read.indexOf("nodeStyles") > read.indexOf("tracker") && read.indexOf("nodeStyles") < read.indexOf("tree"), "the destructured read list names it between tracker and tree");
  assert.ok(bookletTest.includes('"node-styles.js",'), "the booklet fixture copies it");
});

test("the Void shapes are built once, frozen, only in node-styles.js", () => {
  const { shapes } = loadNodeStyles();
  assert.ok(Object.isFrozen(shapes), "the shared shapes cannot be edited by either painter");
  for (const name of ["trace", "prismFacets", "prismFacet", "prismTable", "prismEdge", "prismGlint", "sigilMarkCount", "sigilMarks", "sigilSeal"]) assert.equal(typeof shapes[name], "function", name);
  assert.ok(source.includes("function buildVoidShapes("));
  assert.ok(!idle.includes("function buildVoidShapes(") && !tree.includes("function buildVoidShapes("), "no second copy in idle.js or tree3d.js");
  for (const copy of ["PRISM_RIM", "SIGIL_MARKS", "tracePoints(", "tracePolygon("]) assert.ok(!source.includes(copy), `node-styles.js carries no ${copy}`);
});

// ===== infra =====

test("seed and hash give every node a stable phase in [0, 1)", () => {
  const { seed, hash } = loadNodeStyles();
  assert.equal(seed("") * 2 ** 32, 0x811c9dc5, "FNV-1a offset basis");
  assert.equal(seed("a") * 2 ** 32, 0xe40c292c, "FNV-1a of 'a'");
  assert.equal(seed("task:1"), seed("task:1"));
  assert.notEqual(seed("task:1"), seed("task:2"));
  assert.equal(seed(42), seed("42"), "ids are read as strings");
  const values = new Set();
  for (let k = 0; k < 64; k += 1) {
    const value = hash(seed("node"), k);
    assert.ok(value >= 0 && value < 1);
    assert.equal(value, hash(seed("node"), k));
    values.add(value);
  }
  assert.equal(values.size, 64, "each k draws its own number");
});

test("approach eases with separate rise and fall times, snaps close, and lands at once when it must", () => {
  const { approach } = loadNodeStyles();
  let value = 0;
  const steps = [];
  for (let frame = 0; frame < 3; frame += 1) steps.push(value = approach(value, 1, 1 / 30, 0.09, 0.16, false));
  assert.ok(steps[0] > 0 && steps[0] < steps[1] && steps[1] < steps[2] && steps[2] < 1, "rises toward the target over three 33 ms steps");
  assert.ok(Math.abs(steps[0] - (1 - Math.exp(-(1 / 30) / 0.09))) < 1e-12);
  const down = approach(1, 0, 1 / 30, 0.09, 0.16, false);
  assert.ok(Math.abs(1 - down - (1 - Math.exp(-(1 / 30) / 0.16))) < 1e-12, "falls on its own time constant");
  assert.equal(approach(0.997, 1, 1 / 30, 0.09, 0.16, false), 1, "snaps the last 0.004");
  assert.equal(approach(0.2, 1, 1 / 30, 0.09, 0.16, true), 1, "reduced motion lands at once");
  assert.equal(approach(0.2, 1, 0, 0.09, 0.16, false), 1, "no frame time lands at once");
  assert.equal(approach(NaN, 0.5, 1 / 30, 0.09, 0.16, false), 0.5, "no current value lands at once");
});

test("motion records live by id, integrate their clock and orbit, and ease every level", () => {
  const styles = loadNodeStyles();
  const table = new Map();
  const record = styles.motionRecord(table, "task:a");
  assert.equal(styles.motionRecord(table, "task:a"), record, "created once per id");
  assert.equal(table.size, 1);
  assert.equal(record.seed, styles.seed("task:a"));
  for (const key of ["seed", "clock", "tempo", "still", "lift", "sel", "lit", "work", "kick", "age", "orbit", "progress", "tint", "from", "to", "tintAt", "status", "statusAt", "seen"]) assert.ok(key in record, `record.${key}`);
  const flags = (extra = {}) => ({ style: "prism", active: false, selected: false, progress: null, orbit: 0, status: null, time: 0, frame: 1, ...extra });
  styles.stepMotion(record, flags({ active: true }), 0, false);
  assert.deepEqual([record.sel, record.lit, record.work], [0, 1, 1], "the first frame (no time) lands on its targets");
  assert.equal(record.seen, 1);
  // Working prism: the clock runs 2.5 times faster; idle, once.
  const clock = record.clock;
  styles.stepMotion(record, flags({ active: true, frame: 2 }), 0.05, false);
  assert.ok(Math.abs(record.clock - clock - 0.05 * 2.5) < 1e-12, "a working prism's clock runs at its speed-up");
  assert.equal(record.tempo, 2.5);
  const idle = styles.motionRecord(table, "task:b");
  styles.stepMotion(idle, flags({ style: "orbs" }), 0.05, false);
  assert.ok(Math.abs(idle.clock - 0.05) < 1e-12 && idle.tempo === 1, "an idle node's clock runs at wall speed");
  // Letting go of the work eases it down and slows the clock without a jump.
  styles.stepMotion(record, flags({ frame: 3 }), 0.05, false);
  assert.ok(record.work > 0.9 && record.work < 1, "work falls on its 0.6 s time constant");
  assert.ok(Math.abs(record.work - Math.exp(-0.05 / 0.6)) < 1e-12);
  assert.ok(record.tempo > 1 && record.tempo < 2.5);
  // The work orbit is an integrated phase too: a Running turn is 1.1 s.
  const orbit = record.orbit;
  styles.stepMotion(record, flags({ orbit: 1.1 }), 0.05, false);
  assert.ok(Math.abs(record.orbit - orbit - 0.05 * Math.PI * 2 / 1.1) < 1e-12);
  // Selection rises on its own clock; progress eases toward the reported fraction.
  styles.stepMotion(record, flags({ selected: true, progress: 0.5 }), 0.05, false);
  assert.ok(Math.abs(record.sel - (1 - Math.exp(-0.05 / 0.07))) < 1e-12);
  assert.equal(record.progress, 0.5, "the first known progress lands at once");
  styles.stepMotion(record, flags({ selected: true, progress: 1 }), 0.05, false);
  assert.ok(record.progress > 0.5 && record.progress < 1);
  // Reduced motion: the clock holds, levels land, a working node is fully assembled.
  const held = record.clock;
  record.kick = 1;
  styles.stepMotion(record, flags({ active: true }), 0.05, true);
  assert.equal(record.clock, held);
  assert.deepEqual([record.work, record.lit, record.kick, record.age, record.still], [1, 1, 0, 1e9, true]);
  // Status pop-in: the first status is not news, a change is.
  const agent = styles.motionRecord(table, "agent:a");
  styles.stepMotion(agent, flags({ status: "queued", time: 500 }), 0, false);
  assert.equal(agent.statusAt, -1e9);
  styles.stepMotion(agent, flags({ status: "running", time: 900 }), 0.03, false);
  assert.deepEqual([agent.status, agent.statusAt], ["running", 900]);
  // An arrival kick fades over 0.45 s.
  agent.kick = 1;
  styles.stepMotion(agent, flags({ status: "running", time: 1000 }), 0.09, false);
  assert.ok(Math.abs(agent.kick - 0.8) < 1e-12);
  // The age of the current work, reset when it stops.
  styles.stepMotion(agent, flags({ active: true }), 0.1, false);
  styles.stepMotion(agent, flags({ active: true }), 0.1, false);
  assert.ok(Math.abs(agent.age - 0.2) < 1e-12);
  styles.stepMotion(agent, flags(), 0.1, false);
  assert.equal(agent.age, 0);
  // The style's own speed-up, or one given outright.
  const sigil = styles.motionRecord(table, "sigil");
  styles.stepMotion(sigil, flags({ style: "sigil", active: true }), 0, false);
  assert.equal(sigil.tempo, 3);
  styles.stepMotion(sigil, flags({ style: "singularity", active: true }), 0, false);
  assert.equal(sigil.tempo, 4);
  styles.stepMotion(sigil, flags({ style: "nebula", active: true, speedup: 7 }), 0, false);
  assert.equal(sigil.tempo, 7);
});

test("a tint change cross-fades in twelve cached steps and snaps for reduced motion", () => {
  const { motionRecord, shownTint } = loadNodeStyles();
  const record = motionRecord(new Map(), "task:a");
  const gold = [230, 201, 141], green = [104, 236, 164];
  assert.equal(shownTint(record, gold, 1000, false), gold, "the first tint shows at once");
  assert.equal(shownTint(record, [230, 201, 141], 1016, false), gold, "an equal tint in a new array is no change");
  const seen = new Set();
  let last = null;
  for (let time = 1100; time <= 1600; time += 10) {
    last = shownTint(record, green, time, false);
    seen.add(last);
  }
  assert.equal(last, green, "the fade ends on the target itself");
  assert.ok(seen.size <= 13, `at most 13 triples across a fade (${seen.size})`);
  assert.ok(seen.size > 6, "the fade passes through its steps");
  const again = new Set();
  for (let time = 2000; time <= 2500; time += 10) again.add(shownTint(record, gold, time, false));
  for (let time = 3000; time <= 3500; time += 10) again.add(shownTint(record, green, time, false));
  assert.ok(again.size <= 26, "blended triples are cached, so a second fade reuses them");
  const middle = shownTint(record, gold, 4000, false);
  assert.equal(middle, green);
  const halfway = shownTint(record, gold, 4225, false);
  assert.deepEqual(plain(halfway), [167, 219, 153], "halfway (smooth step) is the sixth of twelve steps");
  assert.equal(shownTint(record, gold, 4230, true), gold, "reduced motion snaps to the target");
});

test("theme() turns a palette into frozen triples, once per palette", () => {
  const { theme } = loadNodeStyles();
  const defaults = theme(null);
  assert.ok(Object.isFrozen(defaults));
  assert.equal(theme(undefined), defaults);
  assert.deepEqual(plain(defaults), {
    key: "5,5,7|236,229,216|-|104,236,164|255,212,121",
    bg: [5, 5, 7], light: false, hi: [255, 255, 255], text: [236, 229, 216], track: [51, 50, 49], orbit: [125, 178, 255], accent2: null,
    done: [104, 236, 164], amber: [255, 212, 121], doneWell: [25, 51, 38], doneInk: [180, 246, 210], amberWell: [55, 46, 30],
  });
  const dark = theme({ background: "#050507", text: "#ece5d8", accent2: "#36d1ff" });
  assert.equal(theme({ background: "#050507", text: "#ece5d8", accent2: "#36d1ff" }), dark, "an equal palette answers the same theme");
  assert.deepEqual(plain(dark.accent2), [54, 209, 255]);
  assert.equal(dark.orbit, dark.accent2, "the work orbit wears the second hue");
  assert.notEqual(dark.key, defaults.key);
  assert.equal(theme({ background: "#050507", accent2: "#3df" }).accent2, null, "the second hue counts only as a full #rrggbb");
  const light = theme({ background: "#f4f1ea", text: "#1a1a1a" });
  assert.equal(light.light, true);
  assert.deepEqual(plain(light.hi), [12, 14, 20], "light themes mix toward near-black");
  assert.deepEqual(plain(light.orbit), [52, 96, 178]);
  assert.deepEqual(plain(theme({ background: "#fff" }).bg), [255, 255, 255], "#rgb backgrounds parse");
  assert.equal(theme({ background: "not a colour" }).bg.join(","), "5,5,7");
});

test("inkOf derives a tint's tones under the theme and caches them per triple", () => {
  const { inkOf, theme } = loadNodeStyles();
  const tint = [220, 180, 110];
  const inks = inkOf(tint);
  assert.equal(inkOf(tint), inks, "cached per triple");
  assert.deepEqual(plain({ core: inks.core, deep: inks.deep, spec: inks.spec, hot: inks.hot, frost: inks.frost, ink: inks.ink }), {
    core: [39, 33, 23], deep: [35, 30, 21], spec: [247, 239, 223], hot: [241, 225, 197], frost: [249, 242, 229], ink: [252, 248, 241],
  });
  const light = theme({ background: "#f4f1ea" });
  const lit = inkOf(tint, light);
  assert.notEqual(lit, inks, "another theme rebuilds them");
  assert.deepEqual(plain(lit.core), [240, 231, 214]);
  assert.equal(inkOf(tint, light), lit);
});

test("detail tiers cut clear of the common radii and honour a cap", () => {
  const { tier } = loadNodeStyles();
  assert.deepEqual([3.4, 5.2, 5.99, 6, 8.49, 8.5, 10.49, 10.5, 11, 15].map((radius) => tier(radius)), [0, 0, 0, 1, 1, 2, 2, 3, 3, 3]);
  assert.equal(tier(15, 2), 2, "the rail and a moving camera cap at T2");
  assert.equal(tier(15, 1), 1);
  assert.equal(tier(4, 2), 0, "a cap never raises a tier");
  assert.equal(tier(15, 4), 3, "a lit node's cap + 1 still stops at T3");
  assert.equal(tier(15, -1), 0);
  assert.equal(tier(15, NaN), 3, "no cap is no cap");
});

// The infra section's private helpers, run on their own (they are shared by
// every style section but not exported).
function infraHelpers(names) {
  const context = vm.createContext({});
  return vm.runInContext(`(function () { "use strict";\n${sectionOf("infra")}\nreturn { ${names.join(", ")} }; })()`, context);
}

test("the shared one-shot curves, polygon path and ellipse point every section may use", () => {
  const { easeOut, easeOutBack, smooth01, polyPath, ellipseAt } = infraHelpers(["easeOut", "easeOutBack", "smooth01", "polyPath", "ellipseAt"]);
  for (const curve of [easeOut, easeOutBack, smooth01]) {
    assert.deepEqual([curve(-1), curve(0), curve(1), curve(2)], [0, 0, 1, 1], "each runs 0 → 1 and clamps outside");
  }
  assert.equal(easeOut(0.5), 0.875, "a cubic ease-out");
  assert.equal(smooth01(0.5), 0.5);
  assert.ok(Math.abs(smooth01(0.25) - 0.15625) < 1e-12, "the smooth step");
  const back = [0.2, 0.4, 0.6, 0.8].map(easeOutBack);
  assert.ok(Math.max(...back) > 1 && Math.max(...back) < 1.11, "easeOutBack overshoots a little, then settles");
  // A pointy-top hexagon: one subpath, five lineTo, the first vertex on top.
  const ctx = recordingContext({ center: { x: 50, y: 50 } });
  ctx.beginPath(); polyPath(ctx, 50, 50, 10, 6, -Math.PI / 2);
  assert.deepEqual([ctx.calls.moveTo, ctx.calls.lineTo, ctx.calls.closePath], [1, 5, 1]);
  assert.deepEqual(plain(ctx.calls.log[1]), ["moveTo", 50, 40]);
  assert.ok(Math.abs(ctx.calls.pathReach - 10) < 1e-9, "every vertex on the radius");
  const square = recordingContext();
  polyPath(square, 0, 0, 4, 4);
  assert.deepEqual(plain(square.calls.log[0]), ["moveTo", 4, 0], "rot defaults to 0");
  // ellipseAt writes into the caller's scratch and answers it.
  const out = { x: 0, y: 0, depth: 0 };
  assert.equal(ellipseAt(10, 20, 8, 3, 0, 0, out), out, "no allocation: the scratch comes back");
  assert.deepEqual(plain(out), { x: 18, y: 20, depth: 0 });
  ellipseAt(10, 20, 8, 3, 0, Math.PI / 2, out);
  assert.ok(Math.abs(out.x - 10) < 1e-9 && Math.abs(out.y - 23) < 1e-9 && out.depth === 1, "the near half sits below the centre line");
  ellipseAt(10, 20, 8, 3, Math.PI / 2, 0, out);
  assert.ok(Math.abs(out.x - 10) < 1e-9 && Math.abs(out.y - 28) < 1e-9, "the tilt turns the ellipse about its centre");
});

test("each canvas owns one bounded paint cache that cacheStats reads", () => {
  const styles = loadNodeStyles();
  const ctx = recordingContext();
  assert.deepEqual(plain(styles.cacheStats(ctx)), { entries: 0, created: 0 });
  styles.paint(ctx, "orbs", { x: 50, y: 50 }, 12, [220, 180, 110]);
  assert.deepEqual(plain(styles.cacheStats(ctx)), { entries: 1, created: 1 });
  styles.paint(ctx, "orbs", { x: 60, y: 40 }, 9, [220, 180, 110], { alpha: 0.4 });
  assert.deepEqual(plain(styles.cacheStats(ctx)), { entries: 1, created: 1 }, "position, radius and alpha reuse the paints");
  for (let index = 0; index < 140; index += 1) styles.paint(ctx, "orbs", { x: 50, y: 50 }, 12, [index, 101, 201]);
  assert.deepEqual(plain(styles.cacheStats(ctx)), { entries: 128, created: 141 }, "capped at 128, oldest out first");
  assert.deepEqual(plain(styles.cacheStats(recordingContext())), { entries: 0, created: 0 }, "another canvas starts empty");
});

test("the recording canvas follows transform() like a real one and tells gradients apart in its log", () => {
  const ctx = recordingContext({ center: { x: 0, y: 0 } });
  ctx.save(); ctx.transform(1, 0, 0, 0.4, 10, 0);
  assert.deepEqual(plain(ctx.getTransform()), { a: 1, b: 0, c: 0, d: 0.4, e: 10, f: 0 });
  ctx.beginPath(); ctx.moveTo(0, 10);
  assert.ok(Math.abs(ctx.calls.pathReach - Math.hypot(10, 4)) < 1e-9, "a squash applies to the points drawn under it");
  ctx.restore();
  assert.deepEqual(plain(ctx.matrix()), [1, 0, 0, 1, 0, 0]);
  const first = ctx.createRadialGradient(0, 0, 0, 0, 0, 1), second = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  first.addColorStop(0, "red"); second.addColorStop(0, "red");
  ctx.fillStyle = first; ctx.fillStyle = second; ctx.fillStyle = first;
  const sets = ctx.calls.log.filter(([name]) => name === "set:fillStyle").map(([, value]) => value);
  assert.deepEqual(sets, ["grad:radial#0(0,0,0,0,0,1)[0 red]", "grad:radial#1(0,0,0,0,0,1)[0 red]", "grad:radial#0(0,0,0,0,0,1)[0 red]"], "each paint logs as its own tag");
  assert.deepEqual(plain(ctx.calls.log.filter(([name]) => name === "addColorStop")), [["addColorStop", "grad:radial#0(0,0,0,0,0,1)", 0, "red"], ["addColorStop", "grad:radial#1(0,0,0,0,0,1)", 0, "red"]]);
});

// ===== the paint contract, every style =====

test("every style restores the canvas, honours an unknown style as orbs, and adds a bounded extra glow", () => {
  const styles = loadNodeStyles();
  for (const style of STYLES) for (const options of [{}, { active: true }, { selected: true, chosen: true }, { kind: "agent", active: true }, { kind: "assistant" }]) {
    const ctx = recordingContext();
    ctx.globalAlpha = 0.73; ctx.lineWidth = 3; ctx.fillStyle = "#123456";
    styles.paint(ctx, style, { x: 50, y: 50 }, 12, [120, 180, 220], options);
    assert.equal(ctx.calls.saves, ctx.calls.restores, `${style} leaves the canvas state as it found it`);
    assert.deepEqual([ctx.globalAlpha, ctx.lineWidth, ctx.fillStyle, plain(ctx.matrix())], [0.73, 3, "#123456", [1, 0, 0, 1, 0, 0]]);
    assert.ok(ctx.calls.fill + ctx.calls.stroke > 0, `${style} draws something`);
  }
  const unknown = recordingContext(), orbs = recordingContext();
  styles.paint(unknown, "nebula", { x: 50, y: 50 }, 12, [120, 180, 220]);
  styles.paint(orbs, "orbs", { x: 50, y: 50 }, 12, [120, 180, 220]);
  assert.deepEqual(plain(unknown.calls.log), plain(orbs.calls.log), "an unknown style paints the default orbs");
  for (const style of STYLES) {
    const plainCtx = recordingContext(), glowing = recordingContext();
    styles.paint(plainCtx, style, { x: 50, y: 50 }, 12, [120, 180, 220]);
    styles.paint(glowing, style, { x: 50, y: 50 }, 12, [120, 180, 220], { extraGlow: true });
    assert.equal(glowing.calls.radial, plainCtx.calls.radial + 1, `${style}: Extra glow adds one halo`);
    assert.ok(glowing.calls.reach > 12 * 1.5 && glowing.calls.reach <= 12 * 2.25 + 1e-9, `${style}: the glow leaves a crisp edge (${glowing.calls.reach.toFixed(1)}px)`);
    // The halo is a cached unit-space paint: the next frame builds no radial.
    const built = glowing.calls.radial;
    styles.paint(glowing, style, { x: 70, y: 30 }, 9, [120, 180, 220], { extraGlow: true, alpha: 0.5 });
    assert.equal(glowing.calls.radial, built, `${style}: Extra glow reuses its halo on later frames`);
    const lit = recordingContext();
    styles.paint(lit, style, { x: 50, y: 50 }, 12, [120, 180, 220], { extraGlow: true, active: true });
    assert.ok(lit.calls.reach > 12 * 1.8 && lit.calls.reach <= 12 * 2.25 + 1e-9, `${style}: a lit glow reaches further, still inside 2.25r (${lit.calls.reach.toFixed(1)}px)`);
  }
});

test("Extra glow eases with the node's lit level: the quiet and lit halos cross-fade instead of popping", () => {
  const styles = loadNodeStyles();
  const tint = [120, 180, 220], p = { x: 50, y: 50 }, base = 0.8;
  const record = styles.motionRecord(new Map(), "task:glow");
  const flags = { style: "minimal", active: true, selected: false, progress: null, orbit: 0, status: null, time: 0, frame: 0 };
  const ctx = recordingContext();
  // Minimal's body is one flat fill, so every gradient fill is a glow layer.
  const glowFrame = () => {
    const from = ctx.calls.fills.length;
    styles.paint(ctx, "minimal", p, 12, tint, { active: true, alpha: base, extraGlow: true, motion: record });
    return ctx.calls.fills.slice(from).filter(({ style }) => typeof style === "object").map(({ alpha }) => alpha);
  };
  assert.deepEqual(glowFrame(), [base], "not lit yet: the quiet halo alone, at the caller's alpha");
  const shares = [];
  for (let frame = 0; frame < 40 && record.lit < 1; frame += 1) {
    styles.stepMotion(record, flags, 1 / 30, false);
    const layers = glowFrame();
    if (record.lit < 1) {
      assert.equal(layers.length, 2, "while it eases, both halos show");
      assert.ok(Math.abs(layers[0] - base * (1 - record.lit)) < 1e-12 && Math.abs(layers[1] - base * record.lit) < 1e-12, "weighted by the eased lit level, never above the caller's alpha");
      shares.push(layers[1] / base);
    } else assert.deepEqual(layers, [base], "fully lit: the lit halo alone");
  }
  assert.equal(record.lit, 1);
  assert.ok(shares.length >= 3 && shares.every((share, index) => index === 0 ? share < 0.35 : share > shares[index - 1] && share - shares[index - 1] < 0.35), "the lit share climbs in small steps (no pop)");
  const built = ctx.calls.radial;
  assert.equal(built, 2, "each halo is built once, the first time it shows");
  glowFrame(); glowFrame();
  assert.equal(ctx.calls.radial, built, "a steady frame builds nothing");
  assert.equal(styles.cacheStats(ctx).entries, 1, "one cache entry per tint holds both halos: no lit level in the key");
  // Reduced motion snaps the level; a motion object without one reads the flags.
  styles.stepMotion(record, { ...flags, active: false }, 1 / 30, true);
  assert.deepEqual(glowFrame(), [base]);
  const bare = recordingContext();
  styles.paint(bare, "minimal", p, 12, tint, { selected: true, extraGlow: true, motion: { seed: 0, clock: 0, still: true } });
  assert.ok(bare.calls.reach > 12 * 1.8, "a selected node without a lit level glows lit");
});

test("every style respects Follow/search dimming and its lifecycle fade", () => {
  const styles = loadNodeStyles();
  for (const style of STYLES) {
    // No conic gradients on this canvas: the typeof fallback must stay.
    const full = recordingContext({ conic: false }), dimmed = recordingContext({ conic: false });
    styles.paint(full, style, { x: 50, y: 50 }, 12, [120, 180, 220], { kind: "task", alpha: 1 });
    styles.paint(dimmed, style, { x: 50, y: 50 }, 12, [120, 180, 220], { kind: "task", alpha: 0.5 * 0.4 });
    const base = 0.5 * 0.4, a1 = full.calls.alphas, a2 = dimmed.calls.alphas;
    assert.ok(a2.length > 0 && a2.length === a1.length, `${style} draws the same operations dimmed`);
    assert.ok(a2.every((alpha, index) => alpha > 0 && alpha <= base + 1e-12 && Math.abs(alpha - base * a1[index]) < 1e-12), `${style} scales every layer by the caller's fade × emphasis`);
    assert.ok(a2.includes(base), `${style} paints its body at the caller's alpha`);
  }
});

test("style hooks a look leaves null keep the caller's own drawing", () => {
  const styles = loadNodeStyles();
  const ctx = recordingContext(), p = { x: 50, y: 50 }, tint = [120, 180, 220];
  for (const style of ["nebula", "__proto__", "constructor", undefined]) {
    assert.equal(styles.ring(ctx, style, p, 12, tint, {}), false);
    assert.equal(styles.hubDress(ctx, style, p, 12, tint, {}), false);
    assert.equal(styles.orbit(ctx, style, p, 12, tint, {}), false);
    assert.equal(styles.arrival(ctx, style, p, 12, tint, 0.5, {}), false);
    assert.equal(styles.select(ctx, style, p, 12, tint, {}), false);
    assert.equal(styles.wire(ctx, style, p, { x: 90, y: 90 }, {}), false);
    assert.equal(styles.surge(ctx, style, p, { x: 90, y: 90 }, 0.5, {}, {}), false);
    assert.equal(styles.land(ctx, style, p, 12, tint, 0.5, {}), false);
    assert.equal(styles.glyph(style, tint, null), null);
    assert.equal(styles.reach(style, null), 1);
  }
  assert.equal(ctx.calls.log.length, 0, "declining draws nothing");
  for (const style of STYLES) {
    // Whatever a look answers, it answers in the contract's shapes.
    for (const call of [() => styles.ring(ctx, style, p, 12, tint, { status: "running", ring: 15.5, time: 0, still: true }), () => styles.hubDress(ctx, style, p, 15, tint, { crew: true, time: 0, still: true }), () => styles.orbit(ctx, style, p, 12, tint, { running: true, phase: 1, ring: 21, time: 0, still: true }), () => styles.arrival(ctx, style, p, 12, tint, 0.5, { time: 0, still: true }), () => styles.select(ctx, style, p, 12, tint, { selected: true, time: 0, still: true })]) {
      assert.equal(typeof call(), "boolean");
    }
    const glyph = styles.glyph(style, tint, null);
    if (glyph) assert.ok(typeof glyph.ink === "string" && glyph.scale > 0 && glyph.scale <= 1 && Number.isFinite(glyph.ringGap), `${style}: glyph dress`);
    const reach = styles.reach(style, null);
    assert.ok(reach >= 1 && reach <= 2.25, `${style}: reach ${reach}`);
  }
});

// ===== the free styles: Classic orbs, Soft glass, Minimal, Halo, Crystal =====
// (the free looks' own suite is tests/node_styles_free.test.mjs)

test("orbs retain luminous cores and a single status rim without stacked status rings", () => {
  const styles = loadNodeStyles();
  for (const kind of ["task", "agent", "session"]) {
    const ctx = recordingContext();
    styles.paint(ctx, "orbs", { x: 50, y: 50 }, 12, [220, 180, 110], { kind, active: true });
    assert.equal(ctx.calls.radial, 2, "one breathing halo and one body with its specular");
    // One rim on the body's edge (lit, at the middle of its breath: .82 × .775);
    // the only other stroke is the glint riding inside it.
    const [rim, glint, ...rest] = ctx.calls.strokes;
    assert.deepEqual([rim.style, rim.width, rest.length], ["rgba(220,180,110,0.625)", 1.3, 0]);
    assert.ok(glint.style === "rgba(248,240,226,0.95)" && glint.width < rim.width, "the glint is a thin streak of light, not a second status ring");
    assert.ok(ctx.calls.fills.some(({ style }) => style === "rgba(39,33,23,1)"), "an opaque, theme-derived core: connections never show through it");
    assert.ok(!ctx.calls.fills.some(({ style }) => typeof style === "string" && (style === "#151a22" || style.startsWith("rgba(242,249,255"))), "no hard-coded navy core or flat white dot");
  }
});

test("Classic, Soft glass and Minimal use distinct rendering without altering node geometry", () => {
  const styles = loadNodeStyles();
  const counts = {};
  for (const style of ["orbs", "glass", "minimal"]) {
    const ctx = recordingContext();
    styles.paint(ctx, style, { x: 50, y: 50 }, 12, [220, 180, 110], { kind: "task", active: true });
    const { radial, linear, fill, stroke } = ctx.calls;
    counts[style] = { radial, linear, fill, stroke };
    if (style !== "orbs") assert.ok(ctx.calls.reach <= 12 + 1e-9, `${style} draws inside the node's own radius`);
  }
  assert.deepEqual(counts, { orbs: { radial: 2, linear: 0, fill: 3, stroke: 2 }, glass: { radial: 0, linear: 2, fill: 3, stroke: 4 }, minimal: { radial: 0, linear: 0, fill: 1, stroke: 1 } });
});

test("Extra glow adds a bounded visible halo to every chosen style without changing geometry", () => {
  const styles = loadNodeStyles();
  for (const style of ["orbs", "glass", "minimal"]) {
    const ctx = recordingContext({ center: { x: 100, y: 100 } });
    styles.paint(ctx, style, { x: 100, y: 100 }, 12, [220, 180, 110], { kind: "task" });
    const normal = ctx.calls.radial, bodyReach = ctx.calls.reach, bodyPath = ctx.calls.pathReach;
    styles.paint(ctx, style, { x: 100, y: 100 }, 12, [220, 180, 110], { kind: "task", extraGlow: true });
    assert.equal(ctx.calls.radial - normal, 1, "the base paints are reused; enabling glow adds one new halo");
    assert.ok(ctx.calls.reach > bodyReach && ctx.calls.reach > 12 && ctx.calls.reach <= 12 * 2.25 + 1e-9, "glow leaves a crisp edge instead of filling the surrounding branch");
    assert.equal(ctx.calls.pathReach, bodyPath, "the glow changes no node geometry");
  }
});

test("Halo and Crystal use distinct bounded surfaces while preserving node positions", () => {
  const styles = loadNodeStyles();
  for (const style of ["halo", "crystal"]) {
    for (const active of [false, true]) {
      const ctx = recordingContext();
      styles.paint(ctx, style, { x: 50, y: 50 }, 12, [120, 180, 220], { kind: "task", active });
      const { calls } = ctx;
      assert.equal(calls.saves, calls.restores);
      assert.deepEqual(calls.shadowBlurs, [], `${style} never sets shadowBlur`);
      if (style === "halo") assert.ok(calls.arc === (active ? 6 : 4) && calls.lineTo === 0, `halo: glow, body and ring, dashed inner ring, core${active ? ", comet head and tail" : ""} (${calls.arc} arcs)`);
      else assert.ok(calls.lineTo >= 8 && calls.arc === 0, `crystal cuts an octagon with lines only (${calls.lineTo} lineTo, ${calls.arc} arcs)`);
      assert.ok(calls.pathReach <= 12 * 1.56, `${style} keeps its geometry on the node (${calls.pathReach.toFixed(1)}px)`);
      const built = gradientsBuilt(ctx);
      styles.paint(ctx, style, { x: 70, y: 40 }, 9, [120, 180, 220], { kind: "task", active });
      assert.equal(gradientsBuilt(ctx), built, `${style} reuses its cached paints on the next frame`);
    }
  }
});

// ===== the Void collection: Singularity, Prism, Sigil =====

// One premium style's shared checks at radius 12: a surface and an outline,
// a restored canvas, a bounded reach, a fixed amount of path work, paints
// reused on the next frame and owned by their canvas, a selected node marked,
// and the hub's monogram in a light ink. Answers the style's signature.
function premiumSurface(style, extra = () => {}) {
  const styles = loadNodeStyles();
  const node = { kind: "task", active: true };
  const first = recordingContext();
  styles.paint(first, style, { x: 50, y: 50 }, 12, [220, 180, 110], node);
  const { calls } = first;
  assert.ok(calls.fill > 0 && calls.stroke > 0, `${style} paints a surface and an outline`);
  assert.equal(calls.saves, calls.restores, `${style} leaves the canvas state as it found it`);
  assert.ok(calls.reach <= 12 * 1.8, `${style} stays inside its glow radius (${calls.reach.toFixed(1)}px)`);
  assert.ok(calls.pathReach <= 12 * 1.1, `${style} keeps its facets and marks on the node (${calls.pathReach.toFixed(1)}px)`);
  assert.ok(calls.lineTo < 64 && calls.arc < 8, `${style} has a small, fixed amount of path work`);
  extra(styles, first);
  const signature = `${calls.arc}/${calls.lineTo}/${calls.fill}/${calls.stroke}`;
  // The next frame, with a fresh but equal tint, allocates no new paints.
  const gradients = gradientsBuilt(first);
  styles.paint(first, style, { x: 80, y: 20 }, 12, [220, 180, 110], node);
  assert.equal(gradientsBuilt(first), gradients, `${style} reuses its cached paints`);
  // Paints belong to their context: another canvas builds its own once.
  const other = recordingContext();
  styles.paint(other, style, { x: 50, y: 50 }, 12, [220, 180, 110], node);
  assert.equal(gradientsBuilt(other), gradients);
  styles.paint(other, style, { x: 50, y: 50 }, 12, [220, 180, 110], node);
  assert.equal(gradientsBuilt(other), gradients);
  const quiet = recordingContext(), chosen = recordingContext();
  styles.paint(quiet, style, { x: 50, y: 50 }, 12, [120, 180, 220], { kind: "task" });
  styles.paint(chosen, style, { x: 50, y: 50 }, 12, [120, 180, 220], { kind: "task", selected: true });
  assert.ok(Math.max(...chosen.calls.lineWidths) > Math.max(...quiet.calls.lineWidths), `${style} marks the selected node`);
  if (style !== "singularity") assert.ok(quiet.calls.reach <= 12 * 1.1, `${style} glows only while it works or is chosen`);
  // The hub's monogram reads on every Void body: a light ink, never the dark one.
  const hub = recordingContext();
  styles.paint(hub, style, { x: 50, y: 50 }, 15, [120, 180, 220], { kind: "assistant" });
  const [monogram] = hub.calls.texts, ink = monogram?.ink.match(/\d+/g)?.slice(0, 3).map(Number);
  assert.equal(monogram?.text, "M");
  assert.ok(ink && ink[0] * 0.2126 + ink[1] * 0.7152 + ink[2] * 0.0722 > 200, `${style} writes the hub's M in a light ink (${monogram?.ink})`);
  return signature;
}

test("Singularity draws a bounded black hole whose accretion disc turns with the angle", () => {
  premiumSurface("singularity", (_styles, first) => assert.equal(first.calls.conic, 1, "the accretion disc's brightness turns with the angle"));
});

test("Prism cuts a bounded gem that keeps fewer facets as it shrinks", () => {
  premiumSurface("prism");
  // Prism cuts fewer planes as it shrinks: three, then two halves, then one.
  const styles = loadNodeStyles();
  const fills = [12, 5, 3].map((radius) => { const recorded = recordingContext(); styles.paint(recorded, "prism", { x: 50, y: 50 }, radius, [120, 180, 220], { kind: "task" }); return recorded.calls.fill; });
  assert.ok(fills[0] > fills[1] && fills[1] > fills[2], `a small gem keeps fewer facets (${fills.join(", ")} fills)`);
});

test("Sigil draws a bounded seal whose marks follow its size", () => {
  premiumSurface("sigil");
  const styles = loadNodeStyles();
  const [small, medium, large] = [4, 8, 12].map((radius) => { const recorded = recordingContext(); styles.paint(recorded, "sigil", { x: 50, y: 50 }, radius, [120, 180, 220], { kind: "task" }); return recorded; });
  assert.equal(small.calls.lineTo, 0, "a tiny sigil skips marks it could not show");
  // Three marks on a small seal, six on a large one (three lineTo per diamond, plus the seal's three).
  assert.equal(medium.calls.lineTo, 3 * 3 + 3, "a small sigil carries three marks around its seal");
  assert.equal(large.calls.lineTo, 6 * 3 + 3, "a large sigil carries six");
});

test("each premium style has its own drawing", () => {
  const styles = loadNodeStyles();
  const signatures = new Set(["singularity", "prism", "sigil"].map((style) => {
    const ctx = recordingContext();
    styles.paint(ctx, style, { x: 50, y: 50 }, 12, [220, 180, 110], { kind: "task", active: true });
    return `${ctx.calls.arc}/${ctx.calls.lineTo}/${ctx.calls.fill}/${ctx.calls.stroke}`;
  }));
  assert.equal(signatures.size, 3);
});
