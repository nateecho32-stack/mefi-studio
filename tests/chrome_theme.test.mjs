// The Chrome theme's stylesheet (renderer/chrome.css): bundled last so it wins
// the cascade, every rule scoped to html[data-studio-theme="chrome"] (only the
// Chrome swatch in the pickers looks like metal in every theme), paint only
// (no geometry, no type size, no scrolling), the status colours left alone,
// and the ink on the metal and the chrome titles at 4.5:1 or better on their
// darkest stops. The palette and the default live in renderer/music.js
// (tests/music.test.mjs); this file holds the look to its promises.
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
const token = (name) => {
  const root = rules(css).find((rule) => rule.selectors.length === 1 && rule.selectors[0] === SCOPE);
  return declarations(root.body).find(([key]) => key === name)?.[1];
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
  const banned = /^(?:width|height|min-|max-|margin|padding|top|left|right|bottom|inset|position|display|grid|flex|gap|order|font-size|font|line-height|overflow|scrollbar|z-index|--(?:live|live-dim|warn|bad|good|info|idea)$)/;
  const found = rules(css).flatMap((rule) => declarations(rule.body).map(([key]) => key)).filter((key) => banned.test(key));
  assert.deepEqual(found, []);
  // The one movement: a pressed primary sinks half a pixel, which moves nothing around it.
  assert.deepEqual(css.match(/transform:[^;]+/g), ["transform: translateY(.5px)"]);
});

test("the ink on the metal and the chrome titles read at 4.5:1 on their darkest stops", () => {
  const ink = token("--chrome-ink");
  assert.equal(ink, "#0a0a0c");
  for (const name of ["--chrome-metal", "--chrome-metal-hover", "--chrome-metal-press"]) {
    const stops = token(name).match(/#[0-9a-f]{6}/gi);
    assert.ok(stops.length >= 6, `${name} is a brushed gradient`);
    const darkest = stops.reduce((low, hex) => (luminance(hex) < luminance(low) ? hex : low));
    assert.ok(contrast(ink, darkest) >= 4.5, `${name}: ink on ${darkest} is ${contrast(ink, darkest).toFixed(2)}:1`);
  }
  const titleStops = token("--chrome-text").match(/#[0-9a-f]{6}/gi);
  const darkest = titleStops.reduce((low, hex) => (luminance(hex) < luminance(low) ? hex : low));
  for (const ground of ["#0a0a0c", "#141418"]) assert.ok(contrast(darkest, ground) >= 4.5, `a chrome title's darkest stop ${darkest} on ${ground}`);
  // The one chrome title is Vibe's greeting, which paints its words with a gradient in every theme.
  // Every other title keeps plain ink: the readability probes read a gradient behind text as its background.
  const titled = rules(css).filter((rule) => /background-clip: text/.test(rule.body)).flatMap((rule) => rule.selectors);
  assert.deepEqual(titled, [`${SCOPE} .vibe-hero h1`]);
  assert.doesNotMatch(css, /text-fill-color/);
});

test("the metal goes on primary buttons and chosen segments, and the selection is a thin chrome edge", () => {
  const selectorsWith = (pattern) => rules(css).filter((rule) => pattern.test(rule.body)).flatMap((rule) => rule.selectors).join("\n");
  const metal = selectorsWith(/background: var\(--chrome-metal\)/);
  for (const part of [".primary", ".mode-thumb", ".sx-switch button.on", "#task-filters .chip.on", '#idle-hud .rail-tab[aria-selected="true"]']) assert.ok(metal.includes(part), `${part} is metal`);
  const edge = selectorsWith(/var\(--chrome-edge\)/);
  for (const part of ['#app-rail [aria-current="page"]', ".sx-row[data-selected]", ".ts-item[data-active]", '.shell-page[aria-current="page"]']) assert.ok(edge.includes(part), `${part} has a chrome edge`);
});

test("Settings › You lists Chrome first, and Workspace's own copy of the theme defaults to it", async () => {
  const template = await read("booklet.template.html");
  const select = template.match(/<select id="workspace-accent">([\s\S]*?)<\/select>/);
  assert.ok(select, "the Studio theme select");
  const values = [...select[1].matchAll(/<option value="([\w-]+)"/g)].map((match) => match[1]);
  assert.equal(values[0], "chrome");
  assert.deepEqual([...values].sort(), ["abyss", "aurora", "chrome", "custom", "dusk", "eclipse", "ember", "gold", "midnight", "rose", "sage", "violet", "void"], "every theme once (Forest is 'sage' there)");
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
