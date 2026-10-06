// The layout contract's stylesheet half. Every full-window layer and every
// width or offset that used to read --shell-rail-w or --shell-local-h for
// "where the free area starts" now reads the derived edges (--shell-x0, -x1,
// -y0, -y1, styles.css section 22), and with the four regions at 0 each must
// come out exactly as it did. The ledger (tests/fixtures/layout-contract-ledger.json)
// lists every declaration that moved, as it was on the base commit (996db71) and
// as it is now; this evaluates both sides, as CSS would, over every rail width,
// local-navigation height and window size v1 has, and over the sample regions of
// v2 (list 280, inspector 400, tab strip 36, status bar 28), where each must move
// by exactly the region it makes room for. What is left reading the raw
// variables is named, with its reason, so a new raw use is a decision and not an accident.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const cssFiles = (await readdir(new URL("../renderer/", import.meta.url))).filter((name) => name.endsWith(".css"));
const css = {};
// LF line ends whatever the checkout made of the files (Windows may give CRLF): some checks look at lines.
for (const name of cssFiles) css[name] = (await readFile(new URL(`../renderer/${name}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const ledger = JSON.parse(await readFile(new URL("./fixtures/layout-contract-ledger.json", import.meta.url), "utf8"));

// ---- a small CSS length evaluator: calc, min, max, clamp, var(), px vw vh ----
function evaluate(text, env, view) {
  let at = 0;
  const source = text.trim();
  const fail = () => { throw new Error(`cannot evaluate ${text} at ${at}`); };
  const peek = () => { while (source[at] === " ") at += 1; return source[at]; };
  const word = () => { const found = /^[a-z-]+(?=\()/.exec(source.slice(at)); return found ? found[0] : null; };
  function number() {
    const found = /^-?(\d*\.?\d+)(px|vw|vh|%|)/.exec(source.slice(at));
    if (!found) fail();
    at += found[0].length;
    const value = Number.parseFloat(found[0]);
    // A percentage is taken of a 1000px box: the comparison is of the same formula before and after, never of one box.
    return found[2] === "vw" ? (value * view.w) / 100 : found[2] === "vh" ? (value * view.h) / 100 : found[2] === "%" ? value * 10 : value;
  }
  function call(name) {
    at += name.length + 1;
    const args = [];
    if (name === "var") {
      const variable = /^--[\w-]+/.exec(source.slice(at));
      if (!variable) fail();
      at += variable[0].length;
      let fallback = null;
      if (peek() === ",") {
        at += 1;
        let depth = 0, end = at;
        for (; end < source.length; end += 1) { if (source[end] === "(") depth += 1; if (source[end] === ")") { if (!depth) break; depth -= 1; } }
        fallback = source.slice(at, end); at = end;
      }
      if (peek() !== ")") fail();
      at += 1;
      if (variable[0] in env) return env[variable[0]];
      if (fallback !== null) return evaluate(fallback, env, view);
      return NaN;
    }
    for (;;) { args.push(sum()); if (peek() === ",") { at += 1; continue; } break; }
    if (peek() !== ")") fail();
    at += 1;
    if (name === "calc") return args[0];
    if (name === "min") return Math.min(...args);
    if (name === "max") return Math.max(...args);
    if (name === "clamp") return Math.min(Math.max(args[0], args[1]), args[2]);
    return fail();
  }
  function atom() {
    const c = peek();
    if (c === "(") { at += 1; const value = sum(); if (peek() !== ")") fail(); at += 1; return value; }
    const name = word();
    return name ? call(name) : number();
  }
  function product() {
    let value = atom();
    for (;;) {
      const c = peek();
      if (c === "*") { at += 1; value *= atom(); } else if (c === "/") { at += 1; value /= atom(); } else return value;
    }
  }
  function sum() {
    let value = product();
    for (;;) {
      const c = peek();
      if (c === "+") { at += 1; value += product(); } else if (c === "-") { at += 1; value -= product(); } else return value;
    }
  }
  const value = sum();
  if (at < source.replace(/\s+$/, "").length) { peek(); if (at < source.length) fail(); }
  return value;
}
// A declaration's value is a list of terms (a shorthand has several), split outside parentheses.
function terms(value) {
  const out = []; let depth = 0, current = "";
  for (const c of value.trim()) {
    if (c === "(") depth += 1;
    if (c === ")") depth -= 1;
    if (c === " " && !depth) { if (current) out.push(current); current = ""; } else current += c;
  }
  if (current) out.push(current);
  // a calc written with spaces inside its parentheses stays one term
  return out;
}
// One value stands for all four sides of inset, as CSS has it.
const evaluateValue = (value, env, view, sides = 1) => { const list = terms(value).map((term) => evaluate(term, env, view)); return list.length === 1 && sides > 1 ? Array(sides).fill(list[0]) : list; };

// ---- the environments -------------------------------------------------------
const VIEWS = [[400, 373], [600, 560], [900, 700], [1100, 720], [1440, 900], [1920, 1080]].map(([w, h]) => ({ w, h }));
const STATIC = { "--s4": 16, "--gutter": 24, "--rail-gap": 84, "--rail-w-open": 372, "--appearance-w": 350, "--music-sheet-w": 400, "--gs-w": 480 };
function environment({ rail, open, localH, list = 0, inspector = 0, tabs = 0, status = 0 }) {
  const env = { ...STATIC, "--shell-rail-w": rail, "--shell-rail-open": open, "--shell-list-w": list, "--shell-inspector-w": inspector, "--shell-tabs-h": tabs, "--shell-status-h": status };
  env["--shell-x0"] = rail + list; env["--shell-x1"] = inspector; env["--shell-y1"] = status;
  if (localH !== undefined) { env["--shell-local-h"] = localH; env["--shell-y0"] = localH + tabs; }
  return env;
}
const V1_ENVS = [];
for (const rail of [0, 64, 72, 256]) for (const open of [256, 272]) for (const localH of [undefined, 56, 60]) V1_ENVS.push(environment({ rail, open, localH }));
const SAMPLE = { list: 280, inspector: 400, tabs: 36, status: 28 };

// What each property must move by in v2, per term, for the sample regions: [top, right, bottom, left] for the four-value shorthands.
const DELTAS = {
  left: [280], "padding-left": [280], "--appearance-left": [280],
  right: [400], "padding-right": [400],
  bottom: [28],
  top: [36], "padding-top": [36], "scroll-margin-top": [36], "--appearance-top": [36],
  inset: [36, 400, 28, 280],
  height: [-28], "max-height": [-64],
};

test("the ledger is the whole set of declarations that moved, and each is in the stylesheet as written", () => {
  // 74 moved; the classic Agents menu's max-width went with the menu.
  assert.ok(ledger.length >= 73, "the ledger lists every declaration that moved");
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const [file, property, , after] of ledger) {
    assert.ok(css[file], `${file} exists`);
    const declaration = (value) => new RegExp(`${escape(property)}:\\s*${escape(value)}\\s*[;}]`);
    assert.ok(declaration(after).test(css[file]), `${file}: ${property}: ${after}`);
    // That the old reads are gone is the raw-use test below: anything still reading the variables must be named there.
  }
});

test("with the regions at 0, every moved declaration is what it was, over every rail, bar height and window size", () => {
  let compared = 0;
  for (const [file, property, before, after] of ledger) {
    for (const env of V1_ENVS) for (const view of VIEWS) {
      const sides = property === "inset" ? 4 : 1;
      const was = evaluateValue(before, env, view, sides), now = evaluateValue(after, env, view, sides);
      assert.equal(now.length, was.length, `${file} ${property}: the same number of values`);
      now.forEach((value, index) => {
        // Undefined stays undefined: where --shell-local-h is not set (the classic shell) --shell-y0 is not either, and the fallback is the same.
        if (Number.isNaN(was[index])) return assert.ok(Number.isNaN(value), `${file} ${property}: ${after} is invalid where ${before} was`);
        assert.ok(Math.abs(value - was[index]) < 1e-9, `${file} ${property} in a ${view.w}x${view.h} window (rail ${env["--shell-rail-w"]}, bar ${env["--shell-local-h"]}): ${before} was ${was[index]}, ${after} is ${value}`);
      });
      compared += 1;
    }
  }
  assert.ok(compared > 1500, `a thousand comparisons and more (${compared})`);
});

test("with the sample regions up, each moved declaration moves by exactly the region it makes room for", () => {
  const view = { w: 1920, h: 1080 };
  const env1 = environment({ rail: 64, open: 256, localH: 56 });
  const env2 = environment({ rail: 64, open: 256, localH: 56, ...SAMPLE });
  let checked = 0;
  for (const [file, property, before, after] of ledger) {
    const sides = property === "inset" ? 4 : 1;
    const was = evaluateValue(before, env1, view, sides), now = evaluateValue(after, env2, view, sides);
    if (property in DELTAS && !/rail-open/.test(after)) {
      DELTAS[property].forEach((delta, index) => assert.ok(Math.abs(now[index] - was[index] - delta) < 1e-9, `${file} ${property}: moves by ${delta} in v2 (was ${was[index]}, is ${now[index]}): ${after}`));
      checked += 1;
    } else if (/width|--music-sheet-w/.test(property)) {
      // A sheet's width shrinks with the room (or stays, where its own cap is the smaller): never grows.
      now.forEach((value, index) => assert.ok(value <= was[index] + 1e-9, `${file} ${property}: a sheet is not wider than before (${after})`));
      checked += 1;
    } else if (/rail-open/.test(after)) {
      assert.ok(now[0] >= was[0], `${file} ${property}: the open rail's toast step keeps clear of the list`);
      checked += 1;
    } else assert.fail(`${file} ${property} has no expectation for v2`);
  }
  assert.equal(checked, ledger.length);
});

test("the width formulas shrink by both columns: the main area minus list and inspector, in a window where the cap is not the limit", () => {
  const env = environment({ rail: 64, open: 256, localH: 56, list: 280, inspector: 400 });
  const view = { w: 1100, h: 720 };
  const was = evaluate("calc(92vw - var(--shell-rail-w))", environment({ rail: 64, open: 256, localH: 56 }), view);
  const now = evaluate("calc(92vw - var(--shell-x0) - var(--shell-x1))", env, view);
  assert.equal(was - now, 680);
});

// ---- what still reads the raw variables -------------------------------------
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
// [file, a literal fragment of the line, why the raw variable is right there]
const RAW = [
  ["styles.css", "--shell-rail-w: 0px;", "the default: no rail unless the rail shell turns one on"],
  ["styles.css", 'html[data-shell="rail"] { --shell-rail-w: 64px; --shell-rail-open: 256px; --shell-local-h: 56px; }', "the rail shell's inputs"],
  ["styles.css", 'html[data-shell="rail"][data-rail-pinned] { --shell-rail-w: var(--shell-rail-open); }', "a pinned rail is as wide as an open one"],
  ["styles.css", "--shell-x0: calc(var(--shell-rail-w) + var(--shell-list-w));", "the derived edge"],
  ["styles.css", "--shell-y0: calc(var(--shell-local-h) + var(--shell-tabs-h));", "the derived edge"],
  ["styles.css", "width: var(--shell-rail-w); box-sizing: border-box;", "the rail's own width"],
  ["styles.css", "{ width: var(--shell-rail-open); box-shadow: var(--shadow-2); }", "the rail's own width when hovered or focused: it opens over the page"],
  ["styles.css", "{ width: var(--shell-rail-open); }", "the same, for the strip that blocks the pointer across the open rail"],
  ["styles.css", '[data-nav-section="agents"]) { padding-top: var(--shell-local-h); }', "a tab page in Work or Agents starts under the bar, at its own height (layout v2 adds the strip for in-flow pages only, below)"],
  ["styles.css", "#workspace-sidebar-panel { left: var(--shell-rail-w);", "the project panel slides out of the rail's edge, over whatever is beside the rail (and stops above the status bar, as the rail does)"],
  ["styles.css", "clip-path: inset(0 0 0 var(--shell-rail-open))", "the open rail covers the floats layer's left strip"],
  ["styles.css", "max(var(--shell-rail-open), var(--shell-x0))", "toasts step aside to the open rail's edge, or past the list when that is further"],
  ["agents.css", "body[data-nav-section=agents] { --shell-local-h: 60px; }", "the agents section's bar is taller: an input"],
  ["builder.css", "--shell-rail-open: 272px;", "Build's sessions layout opens the rail wider: an input"],
  ["vibe.css", "{ --shell-rail-w: 72px; }", "Vibe's rail is 72px: an input"],
  ["vibe.css", "width: var(--shell-rail-w, 72px);", "Vibe's own rail's width"],
  ["vibe.css", "left: calc(var(--shell-rail-w) + 10px);", "the project panel beside Vibe's rail, as beside Build's"],
];
test("what still reads --shell-rail-w, --shell-rail-open or --shell-local-h is the rail itself, the local navigation's own height, or an input", () => {
  const found = [];
  for (const [file, text] of Object.entries(css)) {
    stripComments(text).split("\n").forEach((line, index) => { if (/--shell-(?:rail-w|rail-open|local-h)\b/.test(line)) found.push({ file, line: line.trim(), at: index + 1 }); });
  }
  const unnamed = found.filter(({ file, line }) => !RAW.some(([owner, fragment]) => owner === file && line.includes(fragment)));
  assert.deepEqual(unnamed, [], "a new raw use must say which of these it is: the rail itself, the local navigation's own height, or an input. A free-area edge reads --shell-x0, -x1, -y0 or -y1");
  for (const [file, fragment, why] of RAW) assert.ok(found.some((entry) => entry.file === file && entry.line.includes(fragment)), `${file} still has: ${fragment} (${why})`);
});

test("the four region variables are assigned in one place: styles.css gives each 0, and the fold zeroes the two columns; nothing else sets them", () => {
  const assigned = [];
  for (const [file, text] of Object.entries(css)) {
    stripComments(text).split("\n").forEach((line) => {
      for (const found of line.matchAll(/(--shell-(?:list-w|inspector-w|tabs-h|status-h))\s*:\s*([^;}]+)/g)) assigned.push(`${file} ${found[1]}: ${found[2].trim()}`);
    });
  }
  assert.deepEqual(assigned.sort(), [
    "styles.css --shell-inspector-w: 0px",
    "styles.css --shell-inspector-w: 0px !important",
    "styles.css --shell-list-w: 0px",
    "styles.css --shell-list-w: 0px !important",
    "styles.css --shell-status-h: 0px",
    "styles.css --shell-tabs-h: 0px",
  ], "a region's size is given by MefiNav.layout.set() (an inline value on html), never by a stylesheet");
});

test("layout v2 makes room above and below a tab page only while a tab page is showing", () => {
  const styles = css["styles.css"];
  const gate = ":not(.workspace-active, .command-active, .vibe-active):not(:has(.workspace-page:not([hidden])))";
  const escaped = gate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.ok(new RegExp(`html\\[data-layout="v2"\\]\\[data-shell="rail"\\] body${escaped} \\{ padding-top: var\\(--shell-tabs-h\\); padding-bottom: calc\\(40px \\+ var\\(--shell-y1\\)\\); \\}`).test(styles), "the strip above, the status bar below");
  assert.ok(new RegExp(`body:is\\(\\[data-nav-section="work"\\], \\[data-nav-section="agents"\\]\\)${escaped} \\{ padding-top: var\\(--shell-y0\\); \\}`).test(styles), "and Work and Agents start under the bar and the strip");
  assert.ok(new RegExp(`@media \\(max-width: 900px\\) \\{\\s*html\\[data-layout="v2"\\]\\[data-shell="rail"\\] body${escaped} \\{ padding-bottom: calc\\(32px \\+ var\\(--shell-y1\\)\\); \\}`).test(styles), "with the narrow body's own 32px");
  // The base rules keep v1's own vertical padding: a fixed layer's page must not get a taller document.
  assert.ok(/padding: 0 var\(--gutter\) 40px;\n  max-width: 1560px;/.test(styles), "40px below, as before");
  assert.ok(/body \{ padding: 0 var\(--s4\) 32px; padding-right: calc\(var\(--s4\) \+ var\(--shell-x1\)\); \}/.test(styles), "32px below in a narrow window, as before");
});

test("the full-window layers take all four edges from the free area", () => {
  const styles = css["styles.css"];
  const has = (text, pattern, message) => assert.ok(pattern.test(text), message);
  has(styles, /html\[data-shell="rail"\] \.workspace-page \{ top: var\(--shell-y0\); right: var\(--shell-x1\); bottom: var\(--shell-y1\); left: var\(--shell-x0\);/, "pages");
  has(styles, /html\[data-shell="rail"\] \.music-overlay \{ left: var\(--shell-x0\); right: var\(--shell-x1\); bottom: var\(--shell-y1\); \}/, "sheets");
  has(styles, /html\[data-shell="rail"\] #idle-hud \{ top: var\(--shell-y0\); \}/, "Command's HUD");
  has(styles, /#app-rail \{\s*position: fixed; top: 0; bottom: var\(--shell-y1\); left: 0;/, "the rail stops above the status bar");
  has(css["agents.css"], /\.agents-overlay \{ position: fixed; inset: var\(--shell-y0, 72px\) var\(--shell-x1, 0px\) var\(--shell-y1, 0px\) var\(--shell-x0, 80px\);/, "the agents page");
  has(css["vibe.css"], /inset: var\(--shell-tabs-h\) var\(--shell-x1\) var\(--shell-y1\) var\(--shell-list-w\);/, "Vibe's own home has no rail or local navigation, so it claims only what can sit beside it");
  has(css["vibe.css"], /\.vibe-rail \{\s*position: fixed; top: 0; bottom: var\(--shell-y1\);/, "Vibe's rail stops above the status bar");
  has(styles, /html\[data-shell="rail"\] #workspace-sidebar-panel \{ left: var\(--shell-rail-w\); height: calc\(100% - var\(--shell-y1\)\); \}/, "and so does the project panel that slides out of it");
  has(css["music.css"], /html\[data-layout="v2"\] body \{ --appearance-w: min\(clamp\(320px, 28vw, 390px\), calc\(100vw - var\(--shell-x0, 0px\) - var\(--shell-x1, 0px\) - 24px\)\); \}/, "the Appearance editor takes the room that is there between the columns, in v2 only");
  has(css["vibe.css"], /body\.vibe-active:not\(:has\(\.workspace-page:not\(\[hidden\]\)\)\) #toast-host \{ left: calc\(var\(--shell-list-w\) \+ 24px\); bottom: calc\(104px \+ var\(--shell-y1\)\); \}/, "toasts on Vibe's Home stand right of the list and above the status bar");
});
