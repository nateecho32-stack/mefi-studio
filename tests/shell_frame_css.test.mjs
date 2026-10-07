// The frame's stylesheet (renderer/shell.css), read as text: what a computed style
// would have to show is tests/shell_render.test.mjs. The rules pinned here are the
// ones the brief states outright and a refactor could drop without a test noticing:
// the splitters' 1 px line and wide hit area, opaque drawers, no text under 12 px,
// no native scroller, theme tokens, reduced motion, and the classic local
// navigation left out of the frame (its pages are the list column's page list).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const lf = (text) => text.replace(/\r\n/g, "\n");
const raw = lf(await readFile(new URL("../renderer/shell.css", import.meta.url), "utf8"));
const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
const js = lf(await readFile(new URL("../renderer/shell.js", import.meta.url), "utf8"));
// The sheet is too long to print when a pattern it must not hold is found: say where.
const absent = (text, pattern, message) => { const found = pattern.exec(text); assert.ok(!found, `${message}: found ${JSON.stringify(found?.[0])} at ${found?.index}`); };

// Every rule as { at: the at-rule it sits in, selector, body }.
function rules() {
  const found = [];
  const walk = (text, at) => {
    let from = 0;
    while (from < text.length) {
      const open = text.indexOf("{", from);
      if (open < 0) break;
      const head = text.slice(from, open).trim();
      let depth = 1, close = open + 1;
      while (close < text.length && depth) { if (text[close] === "{") depth += 1; else if (text[close] === "}") depth -= 1; close += 1; }
      const body = text.slice(open + 1, close - 1);
      if (head.startsWith("@keyframes")) found.push({ at: head, selector: head, body });
      else if (head.startsWith("@")) walk(body, head);
      else found.push({ at, selector: head, body });
      from = close;
    }
  };
  walk(css, "");
  return found;
}
const all = rules();
const rule = (selector) => all.filter((entry) => entry.selector.split(/,(?![^(]*\))/).map((one) => one.trim()).includes(selector));
const decl = (selector, property) => {
  for (const entry of rule(selector)) { const found = new RegExp(`(?:^|;|\\s)${property}\\s*:\\s*([^;]+)`).exec(entry.body); if (found) return found[1].trim(); }
  return null;
};

test("a splitter is a 1 px line with a wide invisible hit area, pointer capture friendly and keyboard visible", () => {
  assert.equal(decl("html[data-frame] .shell-split", "width"), "11px", "the area you can grab");
  assert.equal(decl("html[data-frame] .shell-split", "cursor"), "col-resize");
  assert.equal(decl("html[data-frame] .shell-split", "touch-action"), "none", "a touch drag is not a scroll");
  assert.equal(decl("html[data-frame] .shell-split::after", "width"), "1px", "the line you see");
  assert.match(decl("html[data-frame] .shell-split::after", "background"), /^transparent$/, "invisible at rest");
  assert.match(decl("html[data-frame] .shell-split:hover::after", "background"), /var\(--gold\)/);
  assert.ok(rule("html[data-frame] .shell-split:focus-visible::after").length, "a focused splitter is visible");
  assert.match(decl("html[data-frame] .shell-split:focus-visible::before", "box-shadow"), /var\(--gold-bright\)/);
  assert.ok(rule("html[data-frame] .shell-frame.is-dragging, html[data-frame] .shell-frame.is-dragging *").length || rule("html[data-frame] .shell-frame.is-dragging").length, "a drag holds the cursor");
  // Each splitter sits on its column's edge, centred on it (11 px, so 5 px either side of the line).
  assert.equal(decl("html[data-frame] .shell-split-rail", "left"), "calc(var(--frame-rail-w) - 5px)");
  assert.equal(decl("html[data-frame] .shell-split-list", "left"), "calc(var(--frame-rail-w) + var(--shell-list-w) - 5px)");
  assert.equal(decl("html[data-frame] .shell-split-inspector", "right"), "calc(var(--shell-inspector-w) - 5px)");
});

test("a drawer is opaque, under the bar and the strip, and stays inside the window", () => {
  const drawer = 'html[data-frame] .shell-column[data-state="drawer"]';
  assert.equal(decl(drawer, "background"), "var(--panel-solid)", "the page must not show through it");
  assert.equal(decl(drawer, "backdrop-filter"), "none");
  assert.equal(decl(drawer, "top"), "var(--shell-y0)");
  assert.match(decl(drawer, "max-width"), /100vw/);
  assert.equal(decl('html[data-frame][data-ui-mode="vibe"] .shell-column[data-state="drawer"]', "background") ?? decl(drawer, "background"), "var(--panel-solid)", "Vibe's glass does not reach a drawer");
  assert.match(decl("html[data-frame] .shell-scrim", "background"), /var\(--scrim\)/, "the scrim is the theme's");
  assert.equal(decl("html[data-frame] .shell-scrim", "top"), "var(--shell-y0)", "the bar stays clickable");
});

test("no text under 12 px, and every size scales with the interface scale", () => {
  const sizes = [];
  for (const entry of all) for (const match of entry.body.matchAll(/(?:^|;|\s)(font-size|font)\s*:\s*([^;]+)/g)) sizes.push({ selector: entry.selector, property: match[1], value: match[2].trim() });
  assert.ok(sizes.length >= 14, `read the sizes (${sizes.length})`);
  for (const { selector, property, value } of sizes) {
    for (const px of value.matchAll(/(\d+(?:\.\d+)?)px/g)) {
      const at = px.index;
      const floored = /max\(\s*12px/.test(value.slice(Math.max(0, at - 6), at + px[0].length)) || Number(px[1]) >= 12;
      assert.ok(floored, `${selector} { ${property}: ${value} }: ${px[0]} is under 12px`);
    }
  }
  assert.match(decl("html[data-frame] .shell-region", "--frame-fs"), /max\(12px, calc\(13px \* var\(--text-scale, 1\)\)\)/);
  assert.match(decl("html[data-frame] .shell-region", "--frame-fs-s"), /max\(12px, calc\(12px \* var\(--text-scale, 1\)\)\)/);
  absent(css, /font(?:-size)?\s*:[^;]*\b(?:[0-9]|1[01])(?:\.\d+)?px(?![^;]*max)/, "a literal small size with no floor");
});

test("a key hint inside a filled button takes the button's ink, so it reads on the fill", () => {
  // The frame's key style is muted ink on the chrome; on a primary button (New task's "Ctrl N") that was pale on teal.
  assert.match(decl("html[data-frame] .shell-region kbd", "color"), /var\(--muted\)/);
  assert.equal(decl("html[data-frame] .shell-region .primary kbd", "color"), "inherit");
  assert.match(decl("html[data-frame] .shell-region .primary kbd", "background"), /currentColor/);
});

test("no native scroller, no reserved gutter and only the app's tokens for colour, layer and shadow", () => {
  absent(css, /scrollbar-gutter|::-webkit-scrollbar|scrollbar-width|overflow(?:-[xy])?\s*:\s*scroll\b/, "panels use overflow auto, which the app's own scroller takes over");
  absent(css, /#[0-9a-fA-F]{3,8}\b/, "no hex colour");
  absent(css, /\brgba?\(/, "no literal rgb or rgba");
  absent(css, /\bhsla?\(/, "not allowed");
  for (const match of css.matchAll(/z-index\s*:\s*([^;}]+)/g)) assert.match(match[1], /var\(--z-(?:shell|workspace|transient)\)/, `z-index ${match[1].trim()} is a layer token`);
  for (const match of css.matchAll(/box-shadow\s*:\s*([^;}]+)/g)) assert.doesNotMatch(match[1], /\d+px\s+\d+px[^;]*(?:rgba|#)/, `box-shadow ${match[1].trim()} has no raw colour`);
  assert.match(decl("html[data-frame] .shell-top", "background"), /var\(--bg\)/, "the band is as opaque as the local navigation's, so a page under it does not show through");
});

test("geometry comes from the contract's derived edges only, and the layers are the local navigation's", () => {
  absent(css, /var\(--shell-rail-w\)|var\(--shell-local-h\)|var\(--shell-rail-open\)/, "the ledger in layout_contract_css does not grow");
  assert.equal(decl("html[data-frame] .shell-region", "--frame-rail-w"), "calc(var(--shell-x0) - var(--shell-list-w))");
  assert.equal(decl("html[data-frame] .shell-region", "--frame-top-h"), "calc(var(--shell-y0) - var(--shell-tabs-h))");
  assert.equal(decl("html[data-frame] .shell-top", "height"), "var(--frame-top-h)");
  assert.equal(decl("html[data-frame] .shell-top", "left"), "var(--frame-x0)");
  assert.equal(decl("html[data-frame] .shell-top", "z-index"), "calc(var(--z-shell) - 1)");
  assert.equal(decl("html[data-frame] .shell-status", "height"), "var(--shell-status-h)");
  assert.equal(decl("html[data-frame] .shell-tabs", "height"), "var(--shell-tabs-h)");
  assert.equal(decl("html[data-frame] .shell-main", "right"), "var(--shell-x1)");
  assert.equal(decl("html[data-frame] .shell-main", "bottom"), "var(--shell-y1)");
  assert.equal(decl("html[data-frame] .shell-main", "pointer-events"), "none", "main does not catch what belongs to the pages under it");
  assert.equal(decl("html[data-frame] .shell-inspector", "top"), "var(--shell-y0)");
  assert.equal(decl("html[data-frame] .shell-inspector", "width"), "var(--shell-inspector-w)");
  assert.equal(decl("html[data-frame] .shell-list", "width"), "var(--shell-list-w)");
  // Social's rail stands on its Home too (2026-10-06): the frame keeps the rail's width there, as on every other page.
  assert.ok(!/--frame-rail-w: 0px/.test(css), "nothing zeroes the rail's width on Social's Home any more");
  // The splitters are placed from the same three values, so they must be given them: a custom property that is
  // not defined on the element makes its whole calc() invalid, and the splitter falls back to where it would sit in the flow.
  for (const selector of ["html[data-frame] .shell-region", "html[data-frame] .shell-split"]) for (const name of ["--frame-rail-w", "--frame-top-h", "--frame-x0"]) assert.ok(decl(selector, name), `${selector} defines ${name}`);
  const geometry = all.filter((entry) => /\.shell-split/.test(entry.selector)).flatMap((entry) => [...entry.body.matchAll(/var\((--frame-[a-z0-9-]+)/g)].map((match) => match[1]));
  assert.ok(geometry.length >= 3, "the splitters read the frame's geometry");
  assert.equal(decl("html[data-frame] #vibe-layer", "top"), "var(--shell-y0)", "Vibe's layer starts under the bar");
  assert.equal(decl("html[data-frame] #vibe-layer", "left"), "var(--shell-x0)", "and beside Social's rail and the list");
});

test("the classic local navigation is not drawn in the frame: the bar's middle is the breadcrumb, and the page list is the list column's", () => {
  absent(css, /#app-local-nav/, "the classic local navigation is gone, so nothing draws or hides it");
  absent(css, /--frame-top-[lr]|data-frame-narrow|data-local/, "nothing is measured or squeezed for it any more");
  absent(js, /NARROW_BAND|data-frame-narrow|--frame-top-[lr]|dataset\.local/, "and the script measures nothing for it");
  // The page list: while it shows, the column's own panels make way; its rows are buttons, the one you are on is marked.
  assert.equal(decl('html[data-frame] .shell-list[data-pages="on"] > :is(.shell-stack, .shell-empty)', "display"), "none !important");
  assert.equal(decl("html[data-frame] .shell-pages", "overflow-y"), "auto", "a long list scrolls inside the column");
  assert.match(decl('html[data-frame] .shell-page[aria-current="page"]', "background"), /var\(--tint-gold-3/);
  assert.equal(decl("html[data-frame] .shell-page", "font-size"), "var(--frame-fs)", "at least 12 px, with the text size");
});

test("a rule in a container query repeats the html[data-frame] prefix, since a query adds no specificity", () => {
  const inside = all.filter((entry) => entry.at.startsWith("@container"));
  assert.ok(inside.length >= 12);
  for (const entry of inside) for (const selector of entry.selector.split(",")) assert.match(selector.trim(), /^html\[data-frame\]/, `${selector.trim()} would lose to the base rule`);
  assert.match(css, /container: shell-top \/ inline-size/, "the bar is the container its own queries measure");
});

test("motion: the drawer and the scrim animate, and stop under reduced motion and Motion off; nothing animates forever", () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[^]*html\[data-frame\] \.shell-column\[data-state="drawer"\], html\[data-frame\] \.shell-scrim \{ animation: none; \}/);
  assert.match(css, /html\[data-motion="off"\]\[data-frame\] \.shell-column\[data-state="drawer"\], html\[data-motion="off"\]\[data-frame\] \.shell-scrim \{ animation: none; \}/);
  assert.match(css, /html\[data-frame\] \.shell-split::after, html\[data-frame\] \.shell-switch i \{ transition: none; \}/);
  absent(css, /animation[^;]*\binfinite\b/, "a still window stays still");
});

test("every class the stylesheet styles is one the script makes, and the other way round for the structural ones", () => {
  const styled = new Set([...css.matchAll(/\.(shell-[a-z0-9-]+)/g)].map((match) => match[1]));
  assert.ok(styled.size > 30);
  // The three splitters are named from a template, shell-split-${name}.
  for (const name of styled) assert.ok(js.includes(name) || (name.startsWith("shell-split-") && js.includes("shell-split-${name}")), `${name} is styled and never built`);
  for (const name of ["shell-frame", "shell-top", "shell-list", "shell-inspector", "shell-tabs", "shell-main", "shell-status", "shell-scrim", "shell-split", "shell-menu", "shell-pill", "shell-search", "shell-mode"]) assert.ok(styled.has(name), `${name} is built and has a rule`);
});
