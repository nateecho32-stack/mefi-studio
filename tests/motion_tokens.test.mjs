// The motion tokens in renderer/styles.css are one system: the spring easing
// is a sampled damped spring, not a hand-drawn curve, and every duration the
// renderer animates with comes from the token set. These tests re-derive the
// spring from its own zeta and omega so the curve cannot drift from its
// definition, and keep the reduced-motion switch zeroing every duration.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = (await readFile(new URL("../renderer/styles.css", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const firstRoot = css.slice(css.indexOf(":root {"), css.indexOf("\n}\n", css.indexOf(":root {")));

function token(name) {
  // Anchored to a declaration start, so a comment that mentions the name is skipped.
  const match = new RegExp(`(?:^|[\\n;])\\s*${name}:\\s*([^;]+);`).exec(firstRoot);
  assert.ok(match, `${name} is defined in the first :root`);
  return match[1].trim();
}

// Unit step response of a damped spring with ratio zeta and natural
// frequency omega (per unit of normalised time).
function spring(zeta, omega, t) {
  const damped = omega * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * omega * t) * (Math.cos(damped * t) + ((zeta * omega) / damped) * Math.sin(damped * t));
}

test("--ease-spring samples the damped spring its --spring-zeta and --spring-omega describe", () => {
  const zeta = Number(token("--spring-zeta"));
  const omega = Number(token("--spring-omega"));
  assert.ok(zeta > 0 && zeta < 1, "an underdamped spring, so it settles with a small overshoot");
  const curve = token("--ease-spring").replace(/\s+/g, " ");
  const body = /^linear\((.*)\)$/.exec(curve);
  assert.ok(body, "--ease-spring is a linear() easing");
  const stops = body[1].split(",").map((part) => part.trim().split(" "));
  assert.deepEqual(stops[0], ["0"], "starts at rest");
  assert.deepEqual(stops.at(-1), ["1"], "ends on target");
  for (const [value, at] of stops.slice(1, -1)) {
    const t = Number.parseFloat(at) / 100;
    assert.ok(Math.abs(Number(value) - spring(zeta, omega, t)) <= 0.005, `stop ${value} at ${at} matches the spring (${spring(zeta, omega, t).toFixed(4)})`);
  }
  const peak = Math.max(...stops.map(([value]) => Number(value)));
  assert.ok(peak > 1 && peak < 1.05, "a visible but small overshoot");
});

test("durations form one ordered scale, exits run shorter than entries", () => {
  const ms = (name) => Number.parseFloat(token(name));
  const scale = ["--motion-instant", "--motion-fast", "--motion-base", "--motion-slow", "--motion-spring", "--motion-ambient"].map(ms);
  assert.deepEqual([...scale].sort((a, b) => a - b), scale, "instant < fast < base < slow < spring < ambient");
  assert.match(token("--motion-exit"), /calc\(var\(--motion-base\) \* \.7\)/, "exits are 0.7 of an entry");
});

test("the motion switch zeroes every duration and reaches view transitions", () => {
  const off = css.slice(css.indexOf('html[data-motion="off"] {'), css.indexOf("}", css.indexOf('html[data-motion="off"] {')));
  for (const name of ["--motion-instant", "--motion-fast", "--motion-base", "--motion-slow", "--motion-spring", "--motion-ambient"]) {
    assert.match(off, new RegExp(`${name}: 0ms`), `${name} is zero with motion off`);
  }
  assert.match(css, /html\[data-motion="off"\] \*, html\[data-motion="off"\] \*::before, html\[data-motion="off"\] \*::after,/);
  assert.match(css, /html\[data-motion="off"\]::view-transition-group\(\*\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[^}]*\{[^}]*\}[^}]*\{[^}]*\}\s*::view-transition-group\(\*\)/);
});
