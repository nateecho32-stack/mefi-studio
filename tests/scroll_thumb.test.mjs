import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

// The thumb a scroll hint draws on a pane's edge (renderer/studio-ui.js). Native
// scrollbars are hidden everywhere on purpose; this indicator says a pane can
// scroll and where, without taking layout width. Its geometry is a pure function
// sliced out of the source the way the other studio-ui suites do, and the wiring
// is pinned against the source and the stylesheet: an indicator in the hint
// layer only, never in the pane, never catching the pointer.

const source = (await readFile(new URL("../renderer/studio-ui.js", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const css = (await readFile(new URL("../renderer/studio-ui.css", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const from = source.indexOf("  const MIN_THUMB = ");
const to = source.indexOf("  function track(el)", from);
assert.ok(from >= 0 && to > from, "thumb markers");

const context = vm.createContext({});
vm.runInContext(`${source.slice(from, to)}\nthis.thumbOf = thumbOf; this.MIN_THUMB = MIN_THUMB;`, context);
const { MIN_THUMB } = context;
// Objects made inside the vm have another realm's prototype: compare plain copies.
const thumbOf = (...args) => { const result = context.thumbOf(...args); return result && { size: result.size, at: result.at }; };

test("nothing to scroll draws no thumb", () => {
  assert.equal(thumbOf(0, 400, 400, 388), null, "content exactly fits");
  assert.equal(thumbOf(0, 400, 401, 388), null, "a pixel of overflow is not scrollable in practice (under the 2 px slack)");
  assert.equal(thumbOf(0, 400, 380, 388), null, "content shorter than the view");
  assert.equal(thumbOf(0, 400, 900, 0), null, "no room to draw in");
  assert.equal(thumbOf(0, 400, Number.NaN, 388), null);
});

test("the thumb is as long as the visible share of the whole", () => {
  // Half of the content is visible, so the thumb fills half of the 400 px track.
  assert.deepEqual(thumbOf(0, 500, 1000, 400), { size: 200, at: 0 });
  // A quarter visible: a quarter of the track.
  assert.deepEqual(thumbOf(0, 250, 1000, 400), { size: 100, at: 0 });
});

test("it sits at the top, the middle and the bottom in step with the scroll offset", () => {
  assert.equal(thumbOf(0, 500, 1000, 400).at, 0);
  assert.equal(thumbOf(250, 500, 1000, 400).at, 100, "half way through the scrollable 500 px is half way through the 200 px of free track");
  assert.equal(thumbOf(500, 500, 1000, 400).at, 200, "at the end it touches the far end of the track");
});

test("a long page keeps a thumb long enough to see, and an overscroll never leaves the track", () => {
  const long = thumbOf(0, 500, 200000, 400);
  assert.equal(long.size, MIN_THUMB);
  assert.equal(thumbOf(-40, 500, 1000, 400).at, 0, "a bounce past the top");
  assert.equal(thumbOf(900, 500, 1000, 400).at, 200, "a bounce past the bottom");
  const short = thumbOf(0, 40, 4000, 20);
  assert.equal(short.size, 20, "never longer than the track, even below the minimum");
  assert.equal(short.at, 0);
});

test("the same function draws a horizontal thumb (offset, view and total are just lengths)", () => {
  assert.deepEqual(thumbOf(300, 600, 1200, 300), { size: 150, at: 75 });
});

test("the thumb lives in the hint layer: added per region, drawn from refresh(), never in the pane", () => {
  assert.match(source, /thumbs: \{ y: node\("i", "studio-scroll-thumb thumb-y"\), x: node\("i", "studio-scroll-thumb thumb-x"\) \}/);
  assert.match(source, /for \(const bar of Object\.values\(region\.thumbs\)\) \{ bar\.hidden = true; hint\.append\(bar\); \}/, "appended to the hint, hidden until there is something to scroll");
  assert.match(source, /const thumbs = \{ y: y \? thumbOf\(el\.scrollTop, height, el\.scrollHeight, /, "the vertical thumb exists only while the pane overflows vertically");
  assert.match(source, /hint\.classList\.add\("scrolling"\)/);
  assert.match(source, /clearTimeout\(region\.fade\);\n\s+hint\.classList\.remove\("scrolling"\);/, "a hidden hint drops its pending fade");
});

test("the stylesheet keeps it an indicator: absolute, no pointer, hidden by default, shown on hover or after a scroll", () => {
  const rule = (selector) => css.split("\n").find((line) => line.startsWith(`${selector} {`)) ?? "";
  assert.match(rule(".studio-scroll-thumb"), /position: absolute;/);
  assert.match(rule(".studio-scroll-thumb"), /pointer-events: none;/);
  assert.match(rule(".studio-scroll-thumb"), /opacity: 0;/);
  assert.match(css, /\.studio-scroll-hint\.active \.studio-scroll-thumb, \.studio-scroll-hint\.engaged \.studio-scroll-thumb, \.studio-scroll-hint\.scrolling \.studio-scroll-thumb \{ opacity: \.5; \}/);
  assert.match(css, /\.studio-scroll-thumb\[hidden\] \{ display: none; \}/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{.*\.studio-scroll-thumb \{ transition: none; \}/);
  // Native bars stay hidden everywhere: the thumb is what shows a pane can scroll.
  assert.match(css, /html, body, body \* \{ scrollbar-width: none !important; scrollbar-gutter: auto !important; \}/);
});
