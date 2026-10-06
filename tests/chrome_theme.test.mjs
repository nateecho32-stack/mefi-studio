// The Chrome theme's stylesheet (renderer/chrome.css): bundled last so it wins
// the cascade, every rule scoped to html[data-studio-theme="chrome"] (only the
// Chrome swatch in the pickers looks like metal in every theme), paint only
// (no geometry, no type size, no scrolling) and static (no animation), the
// status colours left alone, and the ink on the metal, on the holo and the
// chrome titles at 4.5:1 or better on their darkest stops. The iridescent layer
// uses the website's --chrome-holo tokens as they are, keeps the ground matte,
// and draws its selection edges as thin border images. The palette and the
// default live in renderer/music.js (tests/music.test.mjs); this file holds the
// look to its promises.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { BOOKLET_INPUTS } from "../scripts/build-booklet.mjs";

const read = (name) => readFile(new URL(`../renderer/${name}`, import.meta.url), "utf8").then((text) => text.replace(/\r\n/g, "\n"));
const css = await read("chrome.css");
const SCOPE = 'html[data-studio-theme="chrome"]';

// Rules as { selectors, body, at }, nested @media blocks included.
function rules(text, at = null) {
  const out = [];
  const source = text.replace(/\/\*[\s\S]*?\*\//g, "");
  let index = 0;
  while (index < source.length) {
    const open = source.indexOf("{", index);
    if (open < 0) break;
    const head = source.slice(index, open).trim();
    let depth = 1, close = open + 1;
    for (; close < source.length && depth; close += 1) { if (source[close] === "{") depth += 1; else if (source[close] === "}") depth -= 1; }
    const body = source.slice(open + 1, close - 1);
    if (head.startsWith("@")) out.push(...rules(body, head));
    else out.push({ selectors: splitTop(head), body, at });
    index = close;
  }
  return out;
}
// Splits a selector list on its top-level commas (not those inside :is() or :not()).
function splitTop(list) {
  const parts = []; let depth = 0, start = 0;
  for (let index = 0; index < list.length; index += 1) {
    if (list[index] === "(") depth += 1; else if (list[index] === ")") depth -= 1;
    else if (list[index] === "," && depth === 0) { parts.push(list.slice(start, index).trim()); start = index + 1; }
  }
  parts.push(list.slice(start).trim());
  return parts.filter(Boolean);
}
const declarations = (body) => body.split(";").map((line) => line.trim()).filter(Boolean).map((line) => { const at = line.indexOf(":"); return [line.slice(0, at).trim(), line.slice(at + 1).trim()]; });
const channels = (hex) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
const luminance = (hex) => channels(hex).map((n) => (n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4)).reduce((sum, n, at) => sum + n * [.2126, .7152, .0722][at], 0);
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
const rootRule = () => rules(css).find((rule) => rule.selectors.length === 1 && rule.selectors[0] === SCOPE);
const token = (name) => declarations(rootRule().body).find(([key]) => key === name)?.[1];
const darkestOf = (stops) => stops.reduce((low, hex) => (luminance(hex) < luminance(low) ? hex : low));
// A colour stop as [r, g, b, alpha] (0-255, 0-1): #rrggbb, rgb(r g b) or rgb(r g b / a), and transparent.
const stopsOf = (gradient) => [...gradient.matchAll(/#[0-9a-f]{6}\b|rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+))?\s*\)|\btransparent\b/gi)].map((match) => {
  if (match[0].startsWith("#")) return [...channels(match[0]).map((n) => n * 255), 1];
  if (/transparent/i.test(match[0])) return [0, 0, 0, 0];
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])];
});
const hexOf = ([r, g, b]) => `#${[r, g, b].map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")}`;
const over = (top, under) => under.map((value, at) => (at === 3 ? 1 : top[at] * top[3] + value * (1 - top[3])));
// The rules whose bodies hold a pattern, as one selector list.
const selectorsWith = (pattern) => rules(css).filter((rule) => pattern.test(rule.body)).flatMap((rule) => rule.selectors).join("\n");
// Each border-image as { selectors, source, slice, widths, outset }; a var() in the widths is one value.
const borderImages = () => rules(css).flatMap((rule) => declarations(rule.body).filter(([key]) => key === "border-image").map(([, value]) => {
  const source = value.match(/^var\((--[\w-]+)\)/)?.[1];
  const [slice, widths, outset] = value.replace(/^var\([^)]*\)\s*/, "").split("/").map((part) => part.trim().match(/var\([^)]*\)|\S+/g));
  return { selectors: rule.selectors, body: rule.body, source, slice, widths, outset };
}));
const px = (value) => (value === "0" ? 0 : value.endsWith("px") ? parseFloat(value) : NaN);
// The website's tokens, word for word: the two pages must match.
const HOLO = {
  "--chrome-holo": "linear-gradient(115deg, #eef2f7 0%, #a8c5ff 26%, #c6b4ff 52%, #9de8da 78%, #eef2f7 100%)",
  "--chrome-holo-line": "linear-gradient(90deg, transparent, rgb(168 197 255 / .55) 18%, rgb(198 180 255 / .6) 50%, rgb(157 232 218 / .55) 82%, transparent)",
  "--chrome-holo-bar": "linear-gradient(180deg, #eef2f7, #a8c5ff 35%, #c6b4ff 65%, #9de8da)",
  "--chrome-holo-edge": "linear-gradient(150deg, rgb(238 242 247 / .42), rgb(168 197 255 / .22) 32%, rgb(198 180 255 / .12) 62%, rgb(157 232 218 / .24))",
  "--chrome-holo-glow": "rgb(168 197 255 / .22)",
};

test("chrome.css is bundled once, after every other stylesheet, so it wins a tie", async () => {
  assert.equal(BOOKLET_INPUTS.styles.at(-1), "chrome.css");
  assert.equal(BOOKLET_INPUTS.styles.filter((name) => name === "chrome.css").length, 1);
  const booklet = (await read("booklet.html"));
  assert.equal(booklet.split(css).length - 1, 1, "the committed booklet carries chrome.css verbatim, once");
});

test("every Chrome rule is scoped to the Chrome theme, apart from the Chrome swatch in the pickers", () => {
  const all = rules(css);
  assert.ok(all.length > 30, "the stylesheet has its rules");
  const loose = all.flatMap((rule) => rule.selectors).filter((selector) => !selector.startsWith(SCOPE));
  assert.deepEqual(loose, ['.music-theme[data-theme="chrome"]::before'], "nothing else changes another theme");
  for (const rule of all.filter((one) => one.at)) assert.match(rule.at, /^@media \(prefers-reduced-motion: reduce\)$/, "the only block is the reduced-motion one");
});

test("Chrome paints and nothing more: no geometry, no type size, no scrolling, no status colour", () => {
  const banned = /^(?:width|height|min-|max-|margin|padding|top|left|right|bottom|inset|position|display|grid|flex|gap|order|font-size|font|line-height|overflow|scrollbar|z-index|border-image-outset|--(?:live|live-dim|warn|bad|good|info|idea)$)/;
  // A border's width or style would move what is around it; its colour and a border image do not.
  const border = /^border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-width|-style)?$/;
  const found = rules(css).flatMap((rule) => declarations(rule.body).map(([key]) => key)).filter((key) => banned.test(key) || border.test(key));
  assert.deepEqual(found, []);
  // A border image draws inside the border box (no outset) over widths of its own, so it takes no room.
  const images = borderImages();
  assert.ok(images.length >= 10, "the holo edges are border images");
  for (const image of images) assert.equal(image.outset, undefined, `${image.selectors[0]}: no outset, nothing painted outside the box`);
  // The one movement: a pressed primary sinks half a pixel, which moves nothing around it.
  assert.deepEqual(css.match(/transform:[^;]+/g), ["transform: translateY(.5px)"]);
});

test("Chrome is static: no keyframes, no animation, and the only transition is the metal's own hover and press", () => {
  assert.doesNotMatch(css, /@keyframes/);
  const keys = rules(css).flatMap((rule) => declarations(rule.body).map(([key]) => key));
  assert.deepEqual(keys.filter((key) => /^animation/.test(key)), []);
  const transitions = rules(css).filter((rule) => declarations(rule.body).some(([key]) => key === "transition"));
  assert.ok(transitions.every((rule) => rule.at || rule.selectors.every((selector) => selector.includes(".primary"))), "only the primary buttons ease, as before");
});

test("the ink on the metal, on the holo and the chrome titles read at 4.5:1 on their darkest stops", () => {
  const ink = token("--chrome-ink");
  assert.equal(ink, "#0a0a0c");
  for (const name of ["--chrome-metal", "--chrome-metal-hover", "--chrome-metal-press"]) {
    const stops = token(name).match(/#[0-9a-f]{6}/gi);
    assert.ok(stops.length >= 6, `${name} is a brushed gradient`);
    assert.equal(stops.length, stopsOf(token(name)).length, `${name} is opaque`);
    const darkest = darkestOf(stops);
    assert.ok(contrast(ink, darkest) >= 4.5, `${name}: ink on ${darkest} is ${contrast(ink, darkest).toFixed(2)}:1`);
  }
  // The holo is a fill under ink (Vibe's project mark): every stop of it reads with the ink.
  const holo = token("--chrome-holo").match(/#[0-9a-f]{6}/gi);
  assert.equal(holo.length, stopsOf(token("--chrome-holo")).length, "the holo fill is opaque");
  for (const hex of holo) assert.ok(contrast(ink, hex) >= 4.5, `ink on the holo's ${hex} is ${contrast(ink, hex).toFixed(2)}:1`);
  const inked = selectorsWith(/background: var\(--chrome-holo\);[\s\S]*color: var\(--chrome-ink\)/);
  assert.ok(inked.includes(".vibe-project-mark"), "Vibe's project mark is the holo, in the metal's ink");
  // Under the pointer the holo edge lies over the hover metal: on its darkest stop each of the edge's stops only lightens it.
  const hoverDarkest = darkestOf(token("--chrome-metal-hover").match(/#[0-9a-f]{6}/gi));
  const under = [...channels(hoverDarkest).map((n) => n * 255), 1];
  for (const stop of stopsOf(token("--chrome-holo-edge"))) {
    const seen = hexOf(over(stop, under));
    assert.ok(contrast(ink, seen) >= contrast(ink, hoverDarkest) - .01, `the holo edge's ${stop} over ${hoverDarkest} keeps the ink at ${contrast(ink, seen).toFixed(2)}:1`);
  }
  assert.ok(selectorsWith(/background: var\(--chrome-holo-edge\), var\(--chrome-metal-hover\)/).includes(".primary"), "a primary under the pointer");
  const titleStops = token("--chrome-text").match(/#[0-9a-f]{6}/gi);
  assert.equal(titleStops.length, stopsOf(token("--chrome-text")).length, "the title's stops are all opaque, so the darkest one is what the eye gets");
  const darkest = darkestOf(titleStops);
  for (const ground of ["#0a0a0c", "#141418"]) assert.ok(contrast(darkest, ground) >= 4.5, `a chrome title's darkest stop ${darkest} on ${ground}`);
  // The one chrome title is Vibe's greeting, which paints its words with a gradient in every theme.
  // Every other title keeps plain ink: the readability probes read a gradient behind text as its background.
  const titled = rules(css).filter((rule) => /background-clip: text/.test(rule.body)).flatMap((rule) => rule.selectors);
  assert.deepEqual(titled, [`${SCOPE} .vibe-hero h1`]);
  assert.doesNotMatch(css, /text-fill-color/);
});

test("the metal goes on primary buttons and chosen segments, and the selection is a thin holo edge over a plain chrome one", () => {
  const metal = selectorsWith(/background: var\(--chrome-metal\)/);
  for (const part of [".primary", ".mode-thumb", ".sx-switch button.on", "#task-filters .chip.on", '#idle-hud .rail-tab[aria-selected="true"]']) assert.ok(metal.includes(part), `${part} is metal`);
  const images = borderImages();
  const imageOf = (part) => images.find((image) => image.selectors.some((selector) => selector.includes(part)));
  // The rail's current place, the selected session row, the frame's current page and the palette's active row:
  // a 2px holo bar on the left edge only, along the straight run between the rounded corners.
  for (const part of ['#app-rail [aria-current="page"]', ".sx-row[data-selected]", '.shell-page[aria-current="page"]', "li.palette-row.active"]) {
    const bar = imageOf(part);
    assert.ok(bar, `${part} has a holo bar`);
    assert.equal(bar.source, "--chrome-holo-bar", part);
    assert.deepEqual(bar.slice, ["0", "0", "0", "1"], `${part}: the left edge only`);
    assert.equal(bar.widths[3], "2px", `${part}: 2px wide`);
    assert.ok(bar.widths[0] !== "0" && bar.widths[0] === bar.widths[2], `${part}: clear of the corners at both ends`);
  }
  // The open tab and the inspector's tabs: a 2px line of the holo on the bottom edge only.
  for (const part of [".ts-item[data-active]", ".sx-ptab.on", ".sx-itab.on"]) {
    const line = imageOf(part);
    assert.ok(line, `${part} has a holo underline`);
    assert.equal(line.source, "--chrome-holo", part);
    assert.deepEqual(line.slice, ["0", "0", "1", "0"], `${part}: the bottom edge only`);
    assert.equal(line.widths[2], "2px", `${part}: 2px tall`);
  }
  // The hairlines between the frame's bars, and along a floating menu's top: 1px.
  for (const part of [".shell-top", ".ts-strip", ".shell-status", ".palette-sheet", ".ts-pop", ".today-inbox", ".sx-menu", ".shell-menu"]) {
    const hairline = imageOf(part);
    assert.ok(hairline, `${part} has a holo hairline`);
    assert.equal(hairline.source, "--chrome-holo-hairline", part);
    assert.equal(hairline.slice.filter((value) => value !== "0").length, 1, `${part}: one edge`);
  }
  // Every edge stays thin: where a border image draws (a side its slice keeps), its width is 2px at most, 1px for a hairline.
  for (const image of images) {
    assert.equal(image.widths?.length, 4, `${image.selectors[0]}: the widths are spelled out`);
    const most = image.source === "--chrome-holo-hairline" ? 1 : 2;
    image.slice.forEach((value, side) => { if (value !== "0") assert.ok(px(image.widths[side]) <= most, `${image.selectors[0]}: ${image.widths[side]} on the side it draws`); });
  }
  assert.deepEqual(rules(css).flatMap((rule) => declarations(rule.body).map(([key]) => key)).filter((key) => /^border-image-/.test(key)), [], "the shorthand only, so each image is read whole");
  // A selection's holo edge lies over its plain chrome one (an inset shadow round the corners, or the border's own colour),
  // which is what shows if the image cannot be drawn. (Vibe's rounder shapes only move the image clear of their corners:
  // the plain edge is the base rule's, or Vibe's own rim.)
  for (const image of images.filter((one) => one.source !== "--chrome-holo-hairline" && !one.selectors.every((selector) => selector.includes('[data-ui-mode="vibe"]')))) assert.match(image.body, /var\(--chrome-edge\)/, `${image.selectors[0]} keeps the plain chrome edge under its holo one`);
  const fallback = selectorsWith(/border-(?:left|bottom)-color: var\(--chrome-edge\)[\s\S]*border-image: var\(--chrome-holo/);
  for (const part of [".sx-row[data-selected]", '.shell-page[aria-current="page"]', ".sx-ptab.on", ".sx-itab.on", '.music-theme[aria-pressed="true"]']) assert.ok(fallback.includes(part), `${part}: a border of its own, in the plain chrome edge`);
  // A glyph can only take a colour: the current page's and the open tab's icons stay plain chrome.
  const glyphs = selectorsWith(/^\s*color: var\(--chrome-edge\)/);
  for (const part of ['.shell-page[aria-current="page"] .glyph', ".ts-item[data-active] .ts-ico"]) assert.ok(glyphs.includes(part), part);
});

test("the iridescent layer is the website's tokens word for word, each in use, kept to edges and lights, and the ground stays matte", () => {
  for (const [name, value] of Object.entries(HOLO)) assert.equal(token(name)?.replace(/\s+/g, " "), value, `${name} is the website's value`);
  // Each is used: in a rule, or in another token a rule uses.
  const all = rules(css).flatMap((rule) => declarations(rule.body).map(([key, value]) => ({ rule, key, value })));
  const used = (name) => all.some((one) => one.key !== name && one.value.includes(`var(${name})`) && (!one.key.startsWith("--") || used(one.key)));
  for (const name of [...Object.keys(HOLO), "--chrome-holo-hairline"]) assert.ok(used(name), `${name} is used`);
  for (const { rule, key, value } of all.filter((one) => !one.key.startsWith("--"))) {
    // The bar, the line and the hairline are edges, never a fill: the readability probes read a gradient on a text's box as what is behind every word.
    if (/var\(--chrome-holo-(?:bar|line|hairline)\)/.test(value)) assert.equal(key, "border-image", `${rule.selectors[0]}: ${key}`);
    // The glow is a light around a part, never a fill.
    if (/var\(--chrome-holo-glow\)/.test(value)) assert.equal(key, "box-shadow", `${rule.selectors[0]}: ${key}`);
  }
  // The hairline is the holo line itself at low strength (a quarter or so), in a plain hairline no brighter than a hairline.
  const hairline = token("--chrome-holo-hairline").match(/^-webkit-cross-fade\(linear-gradient\(rgb\(255 255 255 \/ (\.\d+)\), rgb\(255 255 255 \/ \1\)\), var\(--chrome-holo-line\), (\d+)%\)$/);
  assert.ok(hairline, "a cross-fade of a plain hairline and --chrome-holo-line");
  assert.ok(Number(hairline[1]) * (1 - Number(hairline[2]) / 100) <= .2 && Number(hairline[2]) <= 35, `the plain line at ${hairline[1]}, the holo line at ${hairline[2]}%`);
  // The ground: an ice, a lilac and an aqua wash at 2-5% at the default glow (.35), 6% at most at full glow.
  const washes = [...token("--studio-scene").matchAll(/rgb\((\d+) (\d+) (\d+) \/ calc\(([\d.]+) \+ var\(--studio-glow\) \* ([\d.]+)\)\)/g)].filter((match) => match[1] !== "255");
  assert.deepEqual(washes.map((match) => hexOf(match.slice(1, 4).map(Number))), ["#a8c5ff", "#c6b4ff", "#9de8da"], "the holo's three tints");
  for (const match of washes) {
    const at = (glow) => Number(match[4]) + glow * Number(match[5]);
    assert.ok(at(.35) >= .02 && at(.35) <= .05 && at(1) <= .06, `${match[0]}: ${at(.35).toFixed(3)} at the default glow`);
  }
  // Vibe's sky: the same three tints, faint: at the heart of each glow (before vibe.css blurs it by 90px) 12% at most.
  const sky = rules(css).filter((rule) => rule.selectors.some((selector) => selector.includes(".vibe-aurora")));
  const opacity = Number(declarations(sky.find((rule) => rule.selectors[0] === `${SCOPE} .vibe-aurora`).body).find(([key]) => key === "opacity")[1]);
  for (const [name, hue] of [["one", "168 197 255"], ["two", "198 180 255"], ["three", "157 232 218"]]) {
    const glow = sky.find((rule) => rule.selectors[0].endsWith(`.vibe-aurora.${name}`))?.body || "";
    const heart = glow.match(new RegExp(`radial-gradient\\(circle, rgb\\(${hue} \\/ (\\.\\d+)\\)`));
    assert.ok(heart, `the aurora's ${name} is the holo's ${hue}`);
    assert.ok(opacity * Number(heart[1]) <= .12, `the aurora's ${name} at ${(opacity * Number(heart[1])).toFixed(3)}`);
  }
  // The sheen on raised surfaces: silver to a whisper of ice and lilac, gone by about half the height.
  const sheen = stopsOf(token("--studio-sheen"));
  assert.ok(sheen.every((stop) => stop[3] <= .05), "a whisper");
  assert.match(token("--studio-sheen"), /, transparent (?:[0-4]\d|5[0-5])%\)$/, "gone by half the height");
});

test("Settings › You lists Chrome first, and Workspace's own copy of the theme defaults to it", async () => {
  const template = await read("booklet.template.html");
  const select = template.match(/<select id="workspace-accent">([\s\S]*?)<\/select>/);
  assert.ok(select, "the Studio theme select");
  const values = [...select[1].matchAll(/<option value="([\w-]+)"/g)].map((match) => match[1]);
  assert.equal(values[0], "chrome");
  assert.deepEqual([...values].sort(), ["abyss", "aurora", "chrome", "custom", "daylight", "dusk", "eclipse", "ember", "gold", "midnight", "paper", "rose", "sage", "violet", "void"], "every theme once (Forest is 'sage' there)");
  const workspace = await read("workspace.js");
  assert.equal((workspace.match(/storage\.get\("accent", "chrome"\)/g) || []).length, 2);
  assert.ok(workspace.includes('["accent", "accent", "chrome"]'));
  assert.ok(!/"accent", "aurora"/.test(workspace));
});

test("the Command view under Chrome has a sky of its own", async () => {
  const idle = await read("idle.js");
  const map = idle.match(/const THEME_BACKDROP = \{ chrome: "(\w+)"/);
  assert.ok(map, "chrome follows a backdrop");
  assert.ok(new RegExp(`\\n    ${map[1]}: "`).test(idle.slice(idle.indexOf("const BACKDROPS = {"), idle.indexOf("const BACKDROP_ORDER"))), `${map[1]} is a real scene`);
});
