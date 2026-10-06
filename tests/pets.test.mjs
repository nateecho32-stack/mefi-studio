// The studio pet (renderer/pets.js): Ember the dragon's flight is a small
// simulation stepped without a canvas, so these tests fly it through every
// mode and check it keeps to the window, sits still when motion is off, stays
// on its perch while you type, and reacts to finished work and to things that
// need you. Its settings ask the Shop what is owned and survive a reload.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

import { createDom } from "./fixtures/renderer-dom.mjs";

const source = await readFile(new URL("../renderer/pets.js", import.meta.url), "utf8");

function load({ storage = new Map(), owned = [], motion = "on" } = {}) {
  const { document } = createDom({ ids: ["settings-category-appearance", "settings-appearance"] });
  document.readyState = "complete";
  document.documentElement.dataset.motion = motion;
  const events = {}, sent = [];
  const timers = [];
  class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }
  const window = {
    innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1, location: { search: "" },
    addEventListener(name, callback) { (events[name] ||= []).push(callback); },
    dispatchEvent(event) { sent.push(event); for (const callback of events[event.type] || []) callback(event); return true; },
    MefiShop: { owns: (item) => owned.includes(item) },
  };
  const context = vm.createContext({
    window, document, console, CustomEvent, Math, Date, JSON, Number, Array, Object, Float32Array,
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: (key) => storage.delete(key) },
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout() {},
    requestAnimationFrame: () => 0, cancelAnimationFrame() {}, performance: { now: () => 0 },
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
  });
  vm.runInContext(source, context);
  for (const fn of timers.splice(0)) fn();
  return { window, document, storage, sent, pets: window.MefiPets, owned };
}

const WORLD = (extra = {}) => ({ width: 1280, height: 800, motion: "on", perches: [{ x: 160, y: 760 }, { x: 1120, y: 760 }], avoid: [], quiet: 0, ...extra });
function fly(sim, seconds, world, each = () => {}) {
  const steps = Math.round(seconds * 60);
  for (let index = 0; index < steps; index += 1) { sim.step(1 / 60, world); each(sim.pet, index); }
}
const linkLength = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

test("a minute of free flight keeps Ember inside the window, its body whole, and visits wander, perch, coil and rest", () => {
  const { pets } = load();
  const sim = pets.simulate({ seed: 11, width: 1280, height: 800 });
  const world = WORLD();
  let outside = 0;
  fly(sim, 60, world, (pet) => {
    if (pet.x < 0 || pet.y < 0 || pet.x > 1280 || pet.y > 800) outside += 1;
  });
  assert.equal(outside, 0, "the head never leaves the window");
  const modes = new Set(sim.pet.events);
  for (const mode of ["wander", "perch", "coil", "rest"]) assert.ok(modes.has(mode), `flew through ${mode} (saw ${[...modes].join(", ")})`);
  // The body trails the head at fixed spacing: no link stretches or folds back on itself.
  const spine = sim.pet.spine;
  assert.equal(spine.length, 26);
  for (let index = 1; index < spine.length; index += 1) {
    const length = linkLength(spine[index - 1], spine[index]);
    assert.ok(length > 2 && length < 7, `link ${index} is ${length.toFixed(2)} px`);
  }
});

test("with motion off it settles on a perch asleep and never moves again", () => {
  const { pets } = load();
  const sim = pets.simulate({ seed: 3, width: 1280, height: 800 });
  const world = WORLD({ motion: "off" });
  sim.step(1 / 60, world);
  assert.equal(sim.pet.mode, "sleep");
  const before = sim.pet.spine.map((point) => [point.x, point.y]);
  fly(sim, 5, world);
  assert.deepEqual(sim.pet.spine.map((point) => [point.x, point.y]), before, "not one point moved in five seconds");
  assert.equal(sim.pet.particles.length, 0, "no fire, sparks or z's either");
  world.react = "celebrate";
  fly(sim, 1, world);
  assert.equal(sim.pet.mode, "sleep", "a finished job does not wake it with motion off");
});

test("calm motion and typing keep it on its perch", () => {
  const { pets } = load();
  const calm = pets.simulate({ seed: 5 });
  const world = WORLD({ motion: "calm" });
  fly(calm, 20, world);
  assert.ok(["rest", "sleep"].includes(calm.pet.mode), `calm: sitting (${calm.pet.mode})`);
  const sat = calm.pet.events.lastIndexOf("rest");
  assert.ok(sat >= 0 && !calm.pet.events.slice(sat).includes("wander"), "calm: never takes off again");

  const typing = pets.simulate({ seed: 5 });
  const busy = WORLD({ typing: true });
  fly(typing, 20, busy);
  assert.ok(["coil", "rest", "sleep"].includes(typing.pet.mode), `typing: on its perch (${typing.pet.mode})`);
  // Typing stops: after its rest it flies again.
  busy.typing = false;
  fly(typing, 40, busy);
  assert.ok(typing.pet.events.slice(-6).includes("wander"), "back to flying once you stop typing");
});

test("a finished job gets a loop with fire and sparkles; something that needs you gets a visit", () => {
  const { pets } = load();
  const sim = pets.simulate({ seed: 8 });
  const world = WORLD();
  fly(sim, 2, world);
  world.react = "celebrate";
  let fire = 0, sparks = 0;
  fly(sim, 1.3, world, (pet) => {
    fire = Math.max(fire, pet.particles.filter((bit) => bit.kind === "fire").length);
    sparks = Math.max(sparks, pet.particles.filter((bit) => bit.kind === "spark").length);
  });
  assert.ok(sim.pet.events.includes("loop"), "it looped");
  assert.ok(fire > 5 && sparks > 3, `fire ${fire}, sparks ${sparks}`);
  assert.equal(sim.pet.mode, "wander", "and flies on after");

  world.visit = { x: 1180, y: 40 };
  world.react = "alert";
  let closest = Infinity;
  fly(sim, 5, world, (pet) => { closest = Math.min(closest, Math.hypot(pet.x - (1180 - 60), pet.y - (40 + 40))); });
  assert.ok(sim.pet.events.includes("visit"));
  assert.ok(closest < 60, `came within ${closest.toFixed(0)} px of the Inbox`);

  const shy = pets.simulate({ seed: 8 });
  const away = WORLD({ come: false });
  fly(shy, 1, away);
  away.visit = { x: 1180, y: 40 };
  away.react = "alert";
  fly(shy, 2, away);
  assert.ok(!shy.pet.events.includes("visit"), "Come and tell me switched off: it stays where it is");
});

test("a resting pointer draws it over; a fast pointer makes it dart away; a window in the background sends it to sleep", () => {
  const { pets } = load();
  const sim = pets.simulate({ seed: 21 });
  const world = WORLD();
  fly(sim, 1, world);
  // The owner moves the mouse near it now and then and lets it rest there.
  for (let round = 0; round < 6 && !sim.pet.events.includes("curious"); round += 1) {
    world.pointer = { x: sim.pet.x + 160, y: sim.pet.y + 40, speed: 0, still: 0 };
    fly(sim, 4, world, () => { world.pointer.still += 1 / 60; });
  }
  assert.ok(sim.pet.events.includes("curious"), `came to look (${sim.pet.events.join(" > ")})`);

  const darting = pets.simulate({ seed: 22 });
  const busy = WORLD();
  fly(darting, 1, busy);
  busy.pointer = { x: darting.pet.x + 20, y: darting.pet.y, speed: 2400, still: 0 };
  fly(darting, 0.2, busy);
  assert.ok(darting.pet.events.includes("dash"), "a quick swipe through it scares it off");

  const sleepy = pets.simulate({ seed: 23 });
  const elsewhere = WORLD({ background: true });
  fly(sleepy, 25, elsewhere);
  assert.equal(sleepy.pet.mode, "sleep", "another app in front: it naps");
});

test("the pet shows only when owned, a Try borrows it without saving, and choices survive a reload", () => {
  const storage = new Map();
  let env = load({ storage });
  assert.deepEqual(Array.from(env.pets.kinds(), (kind) => kind.item), ["studio:pet-dragon"]);
  assert.deepEqual(Array.from(env.pets.skins(), (skin) => skin.id), ["theme", "frost", "jade", "void", "gold"]);
  env.pets.set({ on: true, skin: "void", name: "  Smaug  " });
  assert.equal(env.pets.state().on, false, "not owned: switched on, but not shown");
  assert.equal(env.pets.state().name, "Smaug");

  env.pets.preview({ kind: "dragon", skin: "frost" }, 120000);
  assert.equal(env.pets.state().on, true, "a Try shows it");
  assert.equal(env.pets.state().skin, "frost");
  assert.equal(env.pets.state().preview, true);
  assert.ok(!String(storage.get("mefiStudio.pet.v1")).includes("frost"), "a Try is never saved");
  env.pets.endPreview();
  assert.equal(env.pets.state().on, false);

  env = load({ storage, owned: ["studio:pet-dragon"] });
  assert.equal(env.pets.state().on, true, "owned and switched on: back after a restart");
  assert.equal(env.pets.state().skin, "theme", "a skin that is not owned falls back to the theme's colours");
  assert.equal(env.pets.state().name, "Smaug");
  env = load({ storage, owned: ["studio:pet-dragon", "studio:skin-void"] });
  assert.equal(env.pets.state().skin, "void");
});

test("Settings › Appearance gets one card for the pet and the menu effect, pointing at the Shop", () => {
  const env = load();
  const card = env.document.querySelector("#settings-flair");
  assert.ok(card, "the card is mounted");
  assert.equal(card.dataset.appearancePanel, "interface", "it lives with the Interface section");
  assert.match(card.textContent, /Ember the dragon \(in the Shop\)/);
  assert.match(card.textContent, /Try it for 2 minutes/);
  assert.match(card.textContent, /Open the Shop/);

  const owned = load({ owned: ["studio:pet-dragon"] });
  const text = owned.document.querySelector("#settings-flair").textContent;
  assert.match(text, /Ember the dragon flies around the studio/);
  assert.match(text, /Stays on its perch while you type/);
  assert.match(text, /Comes to tell you when something needs you/);
});

test("a preview frame for the Shop's cards draws without a page", () => {
  const { pets } = load();
  const calls = [];
  const ctx = new Proxy({}, { get: (_target, name) => (name in Object.prototype ? undefined : typeof name === "string" && /^(create\w+Gradient)$/.test(name) ? () => ({ addColorStop() {} }) : (...args) => { calls.push(name); return undefined; }), set: () => true });
  const canvas = { clientWidth: 300, clientHeight: 200, width: 300, height: 200, getContext: () => ctx };
  assert.equal(pets.paintPreview(canvas, { kind: "dragon", skin: "gold", time: 1.2 }), true);
  assert.ok(calls.filter((name) => name === "fill").length > 20, "the body, wings, horns and head are filled");
  assert.equal(pets.paintPreview(canvas, { kind: "cat" }), false, "an unknown pet draws nothing");
});
