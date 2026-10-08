// The studio pet (renderer/pets.js): Ember the dragon's flight is a small
// simulation stepped without a canvas, so these tests fly it through every
// mode and check it keeps to the window, sits still when motion is off, stays
// on its perch while you type, and reacts to finished work and to things that
// need you. Ember is free with every Studio; its skins ask the Shop what is
// owned, and every choice survives a reload.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

import { createDom } from "./fixtures/renderer-dom.mjs";

const source = await readFile(new URL("../renderer/pets.js", import.meta.url), "utf8");

function load({ storage = new Map(), owned = [], motion = "on", bridge = null } = {}) {
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
    // The Shop's owns(), stubbed: what this profile has.
    MefiShop: { owns: (item) => owned.includes(item) },
    ...(bridge ? { mefiStudio: bridge } : {}),
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

test("Ember is free and off until switched on; skins need the Shop; a Try borrows one without saving; choices survive a reload", () => {
  const storage = new Map();
  let env = load({ storage });
  assert.deepEqual(Array.from(env.pets.kinds(), (kind) => kind.item), [null, "studio:pet-cloud", "studio:pet-phoenix", "studio:pet-wisp"], "the dragon is no Shop item; the other pets are");
  assert.deepEqual(Array.from(env.pets.skins(), (skin) => skin.id), ["theme", "frost", "jade", "void", "gold"]);
  assert.equal(env.pets.state().on, false, "an existing profile gets no surprise dragon after an update");
  env.pets.set({ on: true, skin: "void", name: "  Smaug  " });
  assert.equal(env.pets.state().on, true, "switched on: shown, nothing to buy");
  assert.equal(env.pets.state().skin, "theme", "a skin that is not owned falls back to the theme's colours");
  assert.equal(env.pets.state().name, "Smaug");

  env.pets.preview({ kind: "dragon", skin: "frost" }, 120000);
  assert.equal(env.pets.state().skin, "frost", "a Try wears the skin");
  assert.equal(env.pets.state().preview, true);
  assert.ok(!String(storage.get("mefiStudio.pet.v1")).includes("frost"), "a Try is never saved");
  env.pets.endPreview();
  assert.equal(env.pets.state().skin, "theme");

  env = load({ storage });
  assert.equal(env.pets.state().on, true, "switched on: back after a restart");
  assert.equal(env.pets.state().name, "Smaug");
  env = load({ storage, owned: ["studio:skin-void"] });
  assert.equal(env.pets.state().skin, "void", "a bought skin comes back too");
});

test("Settings › Appearance gets one card for the pet and the menu effect, pointing at the Shop", () => {
  const env = load();
  const card = env.document.querySelector("#settings-flair");
  assert.ok(card, "the card is mounted");
  assert.equal(card.dataset.appearancePanel, "interface", "it lives with the Interface section");
  assert.match(card.textContent, /Ember the dragon flies around the studio/, "the dragon's switch is always there: it is free");
  assert.match(card.textContent, /Stays on its perch while you type/);
  assert.match(card.textContent, /Comes to tell you when something needs you/);
  assert.match(card.textContent, /Void scales \(in the Shop\)/);
  assert.match(card.textContent, /Try a skin for 2 minutes/);
  assert.match(card.textContent, /Open the Shop/);

  const owned = load({ owned: ["studio:skin-frost", "studio:skin-jade", "studio:skin-void", "studio:skin-gold"] });
  const text = owned.document.querySelector("#settings-flair").textContent;
  assert.doesNotMatch(text, /Try a skin/, "every skin owned: nothing left to try");
});

test("two pets play: they chase round each other; a friend's pet flies in, plays with yours, and flies out when it leaves", () => {
  const { pets } = load();
  const mine = pets.simulate({ seed: 31, id: "you" });
  const theirs = pets.simulate({ seed: 32, id: "guest:42", arrive: true });
  assert.ok(theirs.pet.x < 0 || theirs.pet.y < 0 || theirs.pet.x > 1280 || theirs.pet.y > 800, "a visitor starts outside the window");
  const world = WORLD();
  let closest = Infinity;
  for (let index = 0; index < 60 * 20; index += 1) {
    world.friends = [mine, theirs].map((sim) => ({ id: sim.pet.id, x: sim.pet.x, y: sim.pet.y }));
    mine.step(1 / 60, world);
    theirs.step(1 / 60, world);
    closest = Math.min(closest, Math.hypot(mine.pet.x - theirs.pet.x, mine.pet.y - theirs.pet.y));
  }
  assert.ok(theirs.pet.events.includes("play"), `the visitor came to play (${theirs.pet.events.join(" > ")})`);
  assert.ok(closest < 90, `they came within ${closest.toFixed(0)} px of each other`);
  theirs.leave(world);
  for (let index = 0; index < 60 * 8 && !theirs.pet.gone; index += 1) {
    world.friends = [mine, theirs].map((sim) => ({ id: sim.pet.id, x: sim.pet.x, y: sim.pet.y }));
    theirs.step(1 / 60, world);
  }
  assert.equal(theirs.pet.gone, true, "it left by the nearest side");
});

test("guests: a room's other pets get a view each (five at most), named for their owners; none with motion off", () => {
  const room = Array.from({ length: 7 }, (_, index) => ({ id: `u${index}`, name: `Friend ${index}`, pet: { kind: "dragon", skin: index === 1 ? "void" : "nope", name: `Pip ${index}` } }));
  room.push({ id: "u9", name: "No pet", pet: null });
  const env = load();
  assert.deepEqual(Array.from(env.pets.guests(room)), [], "your own pet is off: no visitors either");
  env.pets.set({ on: true });
  assert.deepEqual(Array.from(env.pets.guests(room)), ["u0", "u1", "u2", "u3", "u4"]);
  const canvases = env.document.body.children.filter((node) => node.className === "studio-pet is-guest");
  assert.equal(canvases.length, 5, "a canvas each, none for a member without a pet");
  assert.deepEqual(Array.from(env.pets.guests(room.slice(1, 3))), ["u1", "u2"], "those who left go");
  assert.deepEqual(Array.from(env.pets.guests([])), []);
  env.pets.guests(room);
  env.pets.set({ on: false });
  assert.equal(env.document.body.children.filter((node) => node.className === "studio-pet is-guest").length, 0, "switching yours off sends them all home");
  const still = load({ motion: "off" });
  still.pets.set({ on: true });
  assert.deepEqual(Array.from(still.pets.guests(room)), [], "motion Off: no visitors flying in");
});

test("motion turned Off while friends' pets visit sends them home at once; turned On again, they come back and Ember wakes", () => {
  const { document } = createDom({ ids: ["settings-category-appearance", "settings-appearance"] });
  document.readyState = "complete";
  document.documentElement.dataset.motion = "on";
  // Canvases that draw (so the loop runs), frames run by hand, the html element's watchers kept.
  const make = document.createElement;
  document.createElement = (tag) => {
    const element = make(tag);
    if (tag === "canvas") {
      // Every call answers with something gradient- and text-shaped.
      const answer = { addColorStop() {}, width: 10 };
      const ctx = new Proxy({}, { get: (target, key) => (key in target ? target[key] : () => answer), set: (target, key, value) => { target[key] = value; return true; } });
      element.getContext = () => ctx;
    }
    return element;
  };
  const watchers = [], frames = [], timers = [];
  class FakeObserver { constructor(callback) { this.callback = callback; } observe(target, options) { watchers.push({ target, options, callback: this.callback }); } }
  const events = {};
  const window = {
    innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1, location: { search: "" },
    addEventListener(name, callback) { (events[name] ||= []).push(callback); },
    dispatchEvent(event) { for (const callback of events[event.type] || []) callback(event); return true; },
    MefiShop: { owns: () => false },
  };
  let clock = 0;
  const context = vm.createContext({
    window, document, console, Math, Date, JSON, Number, Array, Object, Float32Array, Proxy, MutationObserver: FakeObserver,
    CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout() {},
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; }, cancelAnimationFrame() {}, performance: { now: () => clock },
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
  });
  vm.runInContext(source, context);
  for (const fn of timers.splice(0)) fn();
  const pets = window.MefiPets;
  const motion = watchers.find((watch) => watch.target === document.documentElement && watch.options.attributeFilter?.includes("data-motion"));
  assert.ok(motion, "pets.js watches html[data-motion]");
  const setMotion = (mode) => { document.documentElement.dataset.motion = mode; motion.callback([{ attributeName: "data-motion", target: document.documentElement }]); };
  const run = (count) => { for (let n = 0; n < count && (frames.length || timers.length); n += 1) { clock += 16; (frames.shift() || timers.shift())(); } };
  const guestCanvases = () => document.body.children.filter((node) => node.className === "studio-pet is-guest").length;
  pets.set({ on: true });
  const room = [{ id: "u1", name: "Sam", pet: { kind: "dragon", skin: "jade", name: "Pip" } }, { id: "u2", name: "Ari", pet: { kind: "dragon", skin: "gold", name: "Zed" } }];
  assert.deepEqual(Array.from(pets.guests(room)), ["u1", "u2"]);
  run(30);
  assert.equal(guestCanvases(), 2);
  setMotion("off");
  assert.equal(guestCanvases(), 0, "motion Off: friends' pets go home at once instead of falling asleep on screen");
  run(400);
  assert.equal(frames.length + timers.length, 0, "with motion Off and Ember asleep, no frames are drawn");
  setMotion("off");
  assert.equal(frames.length + timers.length, 0, "the same mode written again changes nothing");
  setMotion("on");
  assert.equal(guestCanvases(), 2, "motion On: they fly in again");
  assert.ok(frames.length + timers.length > 0, "and Ember's loop wakes");
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

// ---- the Shop's pets, petting, the chase and the little things ------------------------------------
const KINDS = ["dragon", "cloud", "phoenix", "wisp"];
// A drawing context that answers everything and counts what it was asked to do (`own` answers some calls itself).
function recorder(own = {}) {
  const calls = [];
  const ctx = new Proxy({}, { get: (_target, name) => (Object.hasOwn(own, name) ? own[name] : name in Object.prototype ? undefined : typeof name === "string" && /^(create\w+Gradient)$/.test(name) ? () => ({ addColorStop() {} }) : (...args) => { calls.push(name); return { width: 10 }; }), set: () => true });
  return { ctx, calls, fills: () => calls.filter((name) => name === "fill").length };
}
// A pet sat down on a perch the flight's own way: fly there, curl round the spot, rest.
function sitDown(sim, world) {
  world.perches = [{ x: 640, y: 620 }];
  sim.enter("perch", world);
  for (let n = 0; n < 60 * 20 && sim.pet.mode !== "rest"; n += 1) sim.step(1 / 60, world);
  assert.equal(sim.pet.mode, "rest", "sat down");
}
const turnBetween = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

test("every pet flies a minute inside the window with its body whole, through wander, perch, coil and rest; motion off is one still pose", () => {
  const { pets } = load();
  const lengths = { dragon: 26, cloud: 40, phoenix: 26, wisp: 18 };
  for (const kind of KINDS) {
    const sim = pets.simulate({ kind, seed: 11, width: 1280, height: 800 });
    assert.equal(sim.pet.kind, kind);
    let outside = 0;
    fly(sim, 60, WORLD(), (pet) => { if (pet.x < 0 || pet.y < 0 || pet.x > 1280 || pet.y > 800) outside += 1; });
    assert.equal(outside, 0, `${kind}: the head never leaves the window`);
    for (const mode of ["wander", "perch", "coil", "rest"]) assert.ok(sim.pet.events.includes(mode), `${kind} flew through ${mode} (${[...new Set(sim.pet.events)].join(", ")})`);
    assert.equal(sim.pet.spine.length, lengths[kind], `${kind}'s body`);
    for (let index = 1; index < sim.pet.spine.length; index += 1) {
      const length = linkLength(sim.pet.spine[index - 1], sim.pet.spine[index]);
      assert.ok(length > 2 && length < 7, `${kind} link ${index} is ${length.toFixed(2)} px`);
    }
    const still = pets.simulate({ kind, seed: 3 });
    const off = WORLD({ motion: "off" });
    still.step(1 / 60, off);
    const before = JSON.stringify(still.pet.spine);
    fly(still, 5, off);
    assert.deepEqual([still.pet.mode, JSON.stringify(still.pet.spine), still.pet.particles.length, still.pet.firefly], ["sleep", before, 0, null], `${kind}: motion off, asleep and still, nothing around it`);
  }
  assert.equal(pets.simulate({ kind: "cat" }).pet.kind, "dragon", "an unknown kind flies as Ember");
});

test("petting: a pointer that comes to rest on the pet for half a second stops it; it looks at the pointer and purrs, a few hearts rise and its name shows; it goes back when the hand leaves", () => {
  const { pets } = load();
  for (const kind of KINDS) {
    const sim = pets.simulate({ kind, seed: 5 });
    const world = WORLD();
    sitDown(sim, world);
    const spot = { x: sim.pet.spine[3].x, y: sim.pet.spine[3].y };
    world.pointer = { x: spot.x, y: spot.y, speed: 0, still: 0.05 };
    const rest = () => { world.pointer.still += 1 / 60; };
    fly(sim, 0.4, world, rest);
    assert.equal(sim.pet.mode, "rest", `${kind}: not yet at 0.4 s`);
    fly(sim, 0.2, world, rest);
    assert.equal(sim.pet.mode, "petted", `${kind}: half a second under the hand`);
    const head = { x: sim.pet.x, y: sim.pet.y };
    let hearts = 0;
    fly(sim, 4, world, (pet) => { rest(); hearts = Math.max(hearts, pet.particles.filter((bit) => bit.kind === "heart").length); });
    assert.equal(sim.pet.mode, "petted", `${kind}: it stays while the hand does`);
    assert.ok(Math.hypot(sim.pet.x - head.x, sim.pet.y - head.y) < 1, `${kind}: sitting, it stays where it sat`);
    assert.ok(sim.pet.purr > 0.9 && sim.pet.tag > 0.9, `${kind}: purring (${sim.pet.purr.toFixed(2)}), its name showing (${sim.pet.tag.toFixed(2)})`);
    assert.ok(sim.pet.hearts === 4 && hearts >= 1 && hearts <= 4, `${kind}: a few small hearts (${sim.pet.hearts}, ${hearts} at once)`);
    // Its head turned toward the hand, as far as a neck goes.
    const [a, b] = sim.pet.spine;
    const facing = Math.atan2(a.y - b.y, a.x - b.x), toward = Math.atan2(spot.y - a.y, spot.x - a.x);
    const before = turnBetween(facing, toward), after = turnBetween(facing + sim.pet.look, toward);
    assert.ok(after <= Math.max(0.12, before - Math.min(before, 1.05) * 0.8), `${kind}: looks at the pointer (${before.toFixed(2)} -> ${after.toFixed(2)})`);
    // The hand goes: back to its rest, the purr and the name fading.
    world.pointer = { x: spot.x + 320, y: spot.y, speed: 400, still: 0 };
    fly(sim, 0.8, world);
    assert.equal(sim.pet.mode, "rest", `${kind}: the hand left`);
    fly(sim, 1.5, world);
    assert.ok(sim.pet.purr < 0.05 && sim.pet.tag < 0.05, `${kind}: the purr and the name fade`);
  }
});

test("a flying pet the pointer lands on slows under the hand, then hovers there; after a long petting it waits for the hand to go and come back", () => {
  const { pets } = load();
  const sim = pets.simulate({ seed: 8 });
  const world = WORLD();
  fly(sim, 1, world);
  // The hand follows it a moment, then rests.
  for (let n = 0; n < 60 && sim.pet.mode !== "petted"; n += 1) {
    const at = sim.pet.spine[3];
    world.pointer = { x: at.x, y: at.y, speed: 120, still: 0.02 };
    sim.step(1 / 60, world);
  }
  assert.equal(sim.pet.mode, "petted", `petted mid-flight (${sim.pet.events.join(" > ")})`);
  const found = { x: sim.pet.x, y: sim.pet.y };
  let farthest = 0;
  fly(sim, 3, world, (pet) => { world.pointer.still += 1 / 60; world.pointer.speed = 0; farthest = Math.max(farthest, Math.hypot(pet.x - found.x, pet.y - found.y)); });
  assert.ok(farthest < 8, `hovers where the hand found it (${farthest.toFixed(1)} px)`);
  assert.ok(sim.pet.speed < 5);
  // Eighteen seconds is enough: it goes back to flying, and the same resting hand does not start it again.
  fly(sim, 16, world, () => { world.pointer.still += 1 / 60; });
  assert.equal(sim.pet.mode, "wander", "enough petting for now");
  const petted = sim.pet.events.filter((mode) => mode === "petted").length;
  fly(sim, 2, world, () => { world.pointer.still += 1 / 60; });
  assert.equal(sim.pet.events.filter((mode) => mode === "petted").length, petted, "not again until the hand goes and comes back");
});

test("never petted by accident: not by a pointer that had long been still when the pet flew under it, a quick swipe, while typing, with the switch off or with motion off", () => {
  const { pets } = load();
  const cases = [
    ["a resting pointer it flew under", {}, { still: 6 }],
    ["a swipe", {}, { speed: 2400 }],
    ["typing", { typing: true }, {}],
    ["Plays with your pointer off", { touch: false }, {}],
  ];
  for (const [what, extra, hand] of cases) {
    const sim = pets.simulate({ seed: 5 });
    const world = WORLD();
    sitDown(sim, world);
    Object.assign(world, extra);
    const at = sim.pet.spine[3];
    world.pointer = { x: at.x, y: at.y, speed: 0, still: 0.05, ...hand };
    fly(sim, 2, world, () => { world.pointer.still += 1 / 60; });
    assert.ok(!sim.pet.events.includes("petted"), `${what}: no petting`);
  }
  const still = pets.simulate({ seed: 5 });
  const world = WORLD({ motion: "off" });
  still.step(1 / 60, world);
  const at = still.pet.spine[3];
  world.pointer = { x: at.x, y: at.y, speed: 0, still: 0.05 };
  fly(still, 2, world, () => { world.pointer.still += 1 / 60; });
  assert.deepEqual([still.pet.mode, still.pet.purr], ["sleep", 0], "motion off: one still pose, petted or not");
});

test("quick circles near your pet: it gives chase for a moment, then lets it be a while; a friend's pet never chases, nor any with calm motion", () => {
  const { pets } = load();
  const circling = (sim, world, seconds, each = () => {}) => {
    const centre = { x: sim.pet.x + 70, y: sim.pet.y + 20 };
    let closest = Infinity, clock = 0;
    fly(sim, seconds, world, (pet) => {
      clock += 1 / 60;
      const a = clock * 9;
      world.pointer = { x: centre.x + Math.cos(a) * 55, y: centre.y + Math.sin(a) * 55, speed: 500, still: 0, circling: true, circle: centre };
      if (pet.mode === "chase") closest = Math.min(closest, Math.hypot(pet.x - world.pointer.x, pet.y - world.pointer.y));
      each(pet);
    });
    return closest;
  };
  const mine = pets.simulate({ seed: 31, id: "you" });
  const world = WORLD();
  fly(mine, 1, world);
  const closest = circling(mine, world, 1.2);
  assert.ok(mine.pet.events.includes("chase"), "it chases");
  assert.ok(closest < 40, `close behind the pointer (${closest.toFixed(0)} px)`);
  circling(mine, world, 3);
  assert.notEqual(mine.pet.mode, "chase", "for a moment only");
  const chases = mine.pet.events.filter((mode) => mode === "chase").length;
  circling(mine, world, 3);
  assert.equal(mine.pet.events.filter((mode) => mode === "chase").length, chases, "then it lets the pointer be a while");
  const guest = pets.simulate({ seed: 31, id: "guest:7" });
  fly(guest, 1, WORLD());
  const guestWorld = WORLD();
  circling(guest, guestWorld, 2);
  assert.ok(!guest.pet.events.includes("chase"), "a friend's pet does not chase your pointer");
  const calm = pets.simulate({ seed: 31, id: "you" });
  const calmWorld = WORLD({ motion: "calm" });
  fly(calm, 1, calmWorld);
  circling(calm, calmWorld, 2);
  assert.ok(!calm.pet.events.includes("chase"), "calm motion keeps it on its perch");
});

test("the little things are rare: minutes between a sneeze or a firefly, seconds between a resting flick", () => {
  const { pets } = load();
  for (const seed of [1, 2, 3, 4, 5]) {
    const { pet } = pets.simulate({ seed });
    assert.ok(pet.sneezeAt >= 240 && pet.sneezeAt <= 540, `a sneeze in 4 to 9 minutes (${pet.sneezeAt.toFixed(0)} s)`);
    assert.ok(pet.fireflyAt >= 300 && pet.fireflyAt <= 620, `a firefly in 5 to 10 minutes (${pet.fireflyAt.toFixed(0)} s)`);
    assert.ok(pet.flickAt >= 6 && pet.flickAt <= 15);
  }
  // Ten minutes of flight: a sneeze or two and a firefly or two, no more.
  const sim = pets.simulate({ seed: 12 });
  fly(sim, 600, WORLD());
  const fireflies = sim.pet.events.filter((mode) => mode === "firefly").length;
  assert.ok(fireflies <= 2, `${fireflies} fireflies in ten minutes`);
});

test("waking: a stretch and a yawn, wings spread for a moment; calm motion keeps it small; the kill switch skips it", () => {
  const { pets } = load();
  const wake = (extra = {}) => {
    const sim = pets.simulate({ seed: 5 });
    const world = WORLD(extra);
    sitDown(sim, world);
    world.quiet = 200;
    fly(sim, 0.5, world);
    assert.equal(sim.pet.mode, "sleep");
    world.quiet = 0;
    world.pointer = { x: sim.pet.x + 40, y: sim.pet.y, speed: 120, still: 0 };
    let yawn = 0, fold = 1;
    for (let n = 0; n < 60 * 3; n += 1) {
      sim.step(1 / 60, world);
      if (world.pointer) world.pointer.speed = 120;
      yawn = Math.max(yawn, sim.pet.yawn); fold = Math.min(fold, sim.pet.fold);
    }
    return { sim, yawn, fold };
  };
  const full = wake();
  assert.ok(full.sim.pet.events.includes("rest"), "awake");
  assert.ok(full.yawn > 0.8, `a big yawn (${full.yawn.toFixed(2)})`);
  assert.ok(full.fold < 0.7, `wings out in the stretch (fold ${full.fold.toFixed(2)})`);
  assert.equal(full.sim.pet.stretch, 0, "done in two seconds");
  const calm = wake({ motion: "calm" });
  assert.ok(calm.yawn > 0.2 && calm.yawn <= 0.61, `calm: a small one (${calm.yawn.toFixed(2)})`);
  const off = wake({ antics: false });
  assert.equal(off.yawn, 0, "the little things switched off: no yawn");
});

test("a flick of the tail at rest, a tiny sneeze of sparks, a firefly chased and lost; with calm a firefly drifts past and it only watches; none with the switch off", () => {
  const { pets } = load();
  // The flick.
  const flick = pets.simulate({ seed: 5 });
  const world = WORLD();
  sitDown(flick, world);
  flick.pet.flickAt = 0.01;
  flick.step(1 / 60, world);
  assert.ok(flick.pet.flick > 0, "a flick");
  // The sneeze: a little burst of sparks from the snout, half a second in.
  const sneeze = pets.simulate({ seed: 6 });
  const there = WORLD();
  sitDown(sneeze, there);
  sneeze.pet.sneezeAt = 0.01;
  let sparks = 0;
  fly(sneeze, 1, there, (pet) => { sparks = Math.max(sparks, pet.particles.filter((bit) => bit.kind === "spark").length); });
  assert.ok(sparks >= 5 && sparks <= 9, `a tiny sneeze (${sparks} sparks)`);
  // The firefly: chased, snapped at, gone.
  const hunter = pets.simulate({ seed: 7 });
  const sky = WORLD();
  fly(hunter, 1, sky);
  hunter.pet.fireflyAt = 0.01;
  hunter.step(1 / 60, sky);
  assert.equal(hunter.pet.mode, "firefly");
  assert.ok(hunter.pet.firefly && !hunter.pet.firefly.drift);
  let nearest = Infinity;
  fly(hunter, 6, sky, (pet) => { if (pet.firefly && pet.mode === "firefly") nearest = Math.min(nearest, Math.hypot(pet.firefly.x - pet.x, pet.firefly.y - pet.y)); });
  assert.ok(nearest < 60, `it got close (${nearest.toFixed(0)} px)`);
  assert.equal(hunter.pet.mode === "firefly", false, "and gave up or snapped");
  fly(hunter, 2, sky);
  assert.equal(hunter.pet.firefly, null, "the firefly flew off");
  // Calm: it drifts past, the pet watches from its perch.
  const watcher = pets.simulate({ seed: 8 });
  const calm = WORLD({ motion: "calm" });
  sitDown(watcher, calm);
  watcher.pet.fireflyAt = 0.01;
  watcher.step(1 / 60, calm);
  assert.ok(watcher.pet.firefly?.drift, "a firefly drifts past");
  let turned = 0;
  fly(watcher, 3, calm, (pet) => { turned = Math.max(turned, Math.abs(pet.look)); });
  assert.equal(watcher.pet.mode, "rest", "it stays put");
  assert.ok(!watcher.pet.events.includes("firefly"));
  assert.ok(turned > 0.1, "it watches the firefly go by");
  // The kill switch: none of it.
  const quiet = pets.simulate({ seed: 9 });
  const off = WORLD({ antics: false });
  sitDown(quiet, off);
  Object.assign(quiet.pet, { flickAt: 0.01, sneezeAt: 0.01, fireflyAt: 0.01 });
  fly(quiet, 2, off);
  assert.deepEqual([quiet.pet.flick, quiet.pet.sneeze, quiet.pet.firefly, quiet.pet.particles.filter((bit) => bit.kind === "spark").length], [0, 0, null, 0], "the little things switched off");
});

test("the Shop's pets: worn only once owned (Ember otherwise), each with its own name; a Try borrows one unsaved; the relay hears the pet on show", () => {
  const storage = new Map();
  const heard = [];
  const bridge = { hubPet: (pet) => { heard.push(JSON.parse(JSON.stringify(pet))); return Promise.resolve({ ok: true }); } };
  let env = load({ storage, bridge });
  assert.deepEqual(Array.from(env.pets.kinds(), (kind) => [kind.id, kind.item, kind.name]), [["dragon", null, "Ember the dragon"], ["cloud", "studio:pet-cloud", "Cloud dragon"], ["phoenix", "studio:pet-phoenix", "Phoenix"], ["wisp", "studio:pet-wisp", "Will-o'-wisp"]]);
  env.pets.set({ on: true, kind: "cloud" });
  assert.deepEqual([env.pets.state().kind, env.pets.state().name], ["dragon", "Ember"], "not owned: Ember flies, and the relay hears Ember");
  assert.equal(heard.at(-1).kind, "dragon");
  env = load({ storage, owned: ["studio:pet-cloud"], bridge });
  assert.deepEqual([env.pets.state().kind, env.pets.state().name], ["cloud", "Nimbus"], "owned: the choice comes back, with its own name");
  assert.deepEqual(heard.at(-1), { kind: "cloud", skin: "theme", name: "Nimbus" });
  env.pets.set({ name: "  Mist  " });
  assert.equal(env.pets.state().name, "Mist");
  env.pets.set({ kind: "dragon" });
  assert.equal(env.pets.state().name, "Ember", "Ember keeps its own name");
  env = load({ storage, owned: ["studio:pet-cloud"] });
  env.pets.set({ kind: "cloud" });
  assert.equal(env.pets.state().name, "Mist", "names survive a reload");
  env.pets.preview({ kind: "phoenix" }, 120000);
  assert.deepEqual([env.pets.state().kind, env.pets.state().preview, env.pets.state().name], ["phoenix", true, "Blaze"], "a Try");
  assert.ok(!String(storage.get("mefiStudio.pet.v1")).includes("phoenix"), "a Try is never saved");
  env.pets.endPreview();
  assert.equal(env.pets.state().kind, "cloud");
  assert.deepEqual(JSON.parse(storage.get("mefiStudio.pet.v1")).names, { cloud: "Mist" });
});

test("your pet and friends' pets fly as their own kinds; one this Studio does not know comes as Ember; a new kind gets a new body", () => {
  const env = load({ owned: ["studio:pet-wisp"] });
  env.pets.set({ on: true, kind: "wisp" });
  const kinds = () => Object.fromEntries(env.pets.flying().map((pet) => [pet.id, pet.kind]));
  assert.deepEqual(kinds(), { you: "wisp" });
  env.pets.guests([
    { id: "u1", name: "Sam", pet: { kind: "cloud", skin: "jade", name: "Nimbus" } },
    { id: "u2", name: "Ari", pet: { kind: "phoenix", skin: "gold", name: "Blaze" } },
    { id: "u3", name: "Lou", pet: { kind: "griffin", skin: "theme", name: "Grif" } },
  ]);
  assert.deepEqual(kinds(), { you: "wisp", "guest:u1": "cloud", "guest:u2": "phoenix", "guest:u3": "dragon" });
  env.pets.guests([{ id: "u1", name: "Sam", pet: { kind: "wisp", skin: "jade", name: "Nimbus" } }]);
  assert.deepEqual(kinds(), { you: "wisp", "guest:u1": "wisp" }, "the others went; Sam's pet changed");
  env.pets.preview({ kind: "dragon" }, 120000);
  assert.equal(kinds().you, "dragon", "a Try changes your pet's body too");
  env.pets.endPreview();
  assert.equal(kinds().you, "wisp");
});

test("Settings' pet card: a live picture of the pet, which pet (the Shop's once owned), its name and colours, and the pointer switch with how to pet it", async () => {
  const env = load({ owned: ["studio:pet-cloud"] });
  const card = env.document.querySelector("#settings-flair");
  const kinds = card.querySelector("#settings-pet-kind");
  assert.deepEqual(kinds.children.map((option) => [option.value, option.textContent, option.disabled]), [["dragon", "Ember the dragon", false], ["cloud", "Cloud dragon", false], ["phoenix", "Phoenix (in the Shop)", true], ["wisp", "Will-o'-wisp (in the Shop)", true]]);
  const stage = card.querySelector("canvas.settings-flair-preview");
  assert.ok(stage, "a picture of the pet");
  assert.deepEqual([stage.getAttribute("role"), stage.getAttribute("aria-label")], ["img", "Ember the dragon"]);
  assert.deepEqual(card.querySelectorAll(".settings-flair-pick .field-label").map((label) => label.textContent), ["Pet", "Name", "Colours"], "each control has its name above it");
  assert.equal(card.querySelector("#settings-pet-name").value, "Ember");
  assert.match(card.textContent, /Plays with your pointer/);
  assert.match(card.textContent, /Rest the pointer on Ember to pet it\. Circle the pointer quickly near it to play chase\./);
  assert.match(card.textContent, /More pets, skins and menu effects are in the Shop/);
  // Choosing the cloud dragon: the card follows, with its name in the switch and the picture.
  kinds.value = "cloud";
  await kinds.trigger("change");
  assert.equal(env.pets.state().kind, "cloud");
  const again = env.document.querySelector("#settings-flair");
  assert.equal(again.querySelector("#settings-pet-name").value, "Nimbus");
  assert.match(again.textContent, /Nimbus the cloud dragon swims around the studio/);
  assert.equal(again.querySelector("canvas.settings-flair-preview").getAttribute("aria-label"), "Nimbus the cloud dragon");
  const name = again.querySelector("#settings-pet-name");
  name.value = "Mist";
  await name.trigger("change");
  assert.equal(env.pets.state().name, "Mist");
  assert.match(again.textContent, /Mist the cloud dragon swims around the studio/);
  // The pointer switch, and a Try of a pet not owned yet.
  const touch = again.querySelectorAll("label.switch").find((label) => /Plays with your pointer/.test(label.textContent)).querySelector("input");
  touch.checked = false;
  await touch.trigger("change");
  assert.equal(env.pets.state().touch, false);
  const tryPet = again.querySelectorAll("button").find((button) => button.textContent === "Try a pet for 2 minutes");
  await tryPet.click();
  assert.deepEqual([env.pets.state().kind, env.pets.state().preview], ["phoenix", true]);
  const all = load({ owned: ["studio:pet-cloud", "studio:pet-phoenix", "studio:pet-wisp", "studio:skin-frost", "studio:skin-jade", "studio:skin-void", "studio:skin-gold"] });
  assert.doesNotMatch(all.document.querySelector("#settings-flair").textContent, /Try a/, "everything owned: nothing to try");
});

test("previews: every pet draws small and large, flying, resting or asleep; a calm loop that comes back round to where it began", () => {
  const { pets } = load();
  for (const kind of KINDS) {
    for (const [width, height] of [[96, 64], [300, 150], [360, 240]]) {
      for (const pose of ["fly", "rest", "sleep"]) {
        const paint = recorder();
        const canvas = { clientWidth: width, clientHeight: height, width, height, getContext: () => paint.ctx };
        assert.equal(pets.paintPreview(canvas, { kind, skin: "frost", time: 2.5, pose }), true);
        assert.ok(paint.fills() >= 8, `${kind} ${pose} at ${width}x${height}: ${paint.fills()} fills`);
      }
    }
  }
  // The loop: a frame and the same frame one turn later put the head in the same place (read off the drawing's moves).
  const first = (time) => {
    const transforms = [];
    const paint = recorder({ setTransform: (...args) => transforms.push(args) });
    const canvas = { clientWidth: 300, clientHeight: 200, width: 300, height: 200, getContext: () => paint.ctx };
    pets.paintPreview(canvas, { kind: "dragon", time });
    return transforms.at(-1).map((value) => Math.round(value));
  };
  const turn = (2 * Math.PI) / 1.1;
  assert.deepEqual(first(1 + turn), first(1), "one turn of the loop later, the same place");
});

test("a live preview moves only while it is on screen, the window shows and motion is on; the kill switch keeps it still", () => {
  const page = ({ storage = new Map(), motion = "on" } = {}) => {
    const { document } = createDom({ ids: [] });
    document.readyState = "complete";
    document.documentElement.dataset.motion = motion;
    const frames = [], watched = [];
    let clock = 0;
    class Watch { constructor(callback) { this.callback = callback; } observe(target) { watched.push({ target, callback: this.callback }); } unobserve() {} }
    const window = { innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1, location: { search: "" }, addEventListener() {}, dispatchEvent() { return true; }, MefiShop: { owns: () => true } };
    const context = vm.createContext({
      window, document, console, Math, Date, JSON, Number, Array, Object, Proxy, IntersectionObserver: Watch,
      CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
      localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) },
      setTimeout: () => 0, clearTimeout() {}, requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; }, cancelAnimationFrame() {}, performance: { now: () => clock },
      getComputedStyle: () => ({ getPropertyValue: () => "" }),
    });
    vm.runInContext(source, context);
    const paint = recorder();
    const canvas = { clientWidth: 200, clientHeight: 120, width: 200, height: 120, getContext: () => paint.ctx, isConnected: true };
    const run = (count) => { let ran = 0; for (let n = 0; n < count && frames.length; n += 1) { clock += 40; frames.shift()(clock); ran += 1; } return ran; };
    return { pets: window.MefiPets, canvas, paint, frames, watched, run, see: (on) => watched.at(-1).callback([{ target: canvas, isIntersecting: on }]) };
  };
  const live = page();
  const show = live.pets.livePreview(live.canvas, { kind: "cloud" });
  assert.equal(live.paint.fills(), 0, "nothing is drawn before it is seen");
  assert.equal(live.frames.length, 0, "and nothing moves");
  show.set({ skin: "gold" });
  assert.equal(live.paint.fills(), 0, "new colours wait for it to be seen too");
  live.see(true);
  assert.equal(live.run(10), 10, "on screen: it moves");
  const drawn = live.paint.fills();
  assert.ok(drawn > 0);
  live.see(false);
  live.run(5);
  assert.equal(live.frames.length, 0, "off screen: it stops");
  assert.equal(live.paint.fills(), drawn, "and draws nothing more");
  show.stop();
  const still = page({ motion: "off" });
  still.pets.livePreview(still.canvas, { kind: "wisp" });
  still.see(true);
  assert.ok(still.paint.fills() > 0, "motion Off: one still frame once it is seen");
  assert.equal(still.frames.length, 0, "and nothing after it");
  const killed = page({ storage: new Map([["mefiStudio.pet.livePreview", "off"]]) });
  killed.pets.livePreview(killed.canvas, { kind: "phoenix" });
  killed.see(true);
  assert.ok(killed.paint.fills() > 0);
  assert.equal(killed.frames.length, 0, "the kill switch keeps it still");
  assert.equal(killed.pets.state().livePreview, false);
  assert.equal(page({ storage: new Map([["mefiStudio.pet.antics", "off"]]) }).pets.state().antics, false, "and the little things' own switch is read at load");
});

test("on the page: a pointer resting on your pet pets it (the card's switch off, it does not), and quick circles near it start a chase", () => {
  const page = ({ motion = "calm" } = {}) => {
    const { document } = createDom({ ids: [] });
    document.readyState = "complete";
    document.documentElement.dataset.motion = motion;
    const make = document.createElement;
    document.createElement = (tag) => { const element = make(tag); if (tag === "canvas") element.getContext = () => recorder().ctx; return element; };
    const frames = [], timers = [], events = {};
    let clock = 0;
    const window = {
      innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1, location: { search: "" },
      addEventListener(name, callback) { (events[name] ||= []).push(callback); }, dispatchEvent() { return true; }, MefiShop: { owns: () => true },
    };
    const context = vm.createContext({
      window, document, console, Math, Date, JSON, Number, Array, Object, Proxy,
      CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
      localStorage: { getItem: () => null, setItem() {} },
      setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout() {},
      requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; }, cancelAnimationFrame() {}, performance: { now: () => clock },
      getComputedStyle: () => ({ getPropertyValue: () => "" }),
    });
    vm.runInContext(source, context);
    for (const fn of timers.splice(0)) fn();
    const pets = window.MefiPets;
    const run = (seconds) => { const end = clock + seconds * 1000; while (clock < end && (frames.length || timers.length)) { clock += 16; (frames.shift() || timers.shift())(clock); } };
    const move = (x, y) => { for (const callback of events.pointermove || []) callback({ type: "pointermove", clientX: x, clientY: y }); };
    const me = () => pets.flying().find((pet) => pet.id === "you");
    return { pets, run, move, me, tick: (ms) => { clock += ms; } };
  };
  const calm = page();
  calm.pets.set({ on: true });
  for (let n = 0; n < 40 && calm.me().mode !== "rest"; n += 1) calm.run(0.5);
  assert.equal(calm.me().mode, "rest", "calm motion: it sits on its perch");
  calm.move(calm.me().x, calm.me().y);
  calm.run(0.7);
  assert.equal(calm.me().mode, "petted", "a resting hand on it");
  const off = page();
  off.pets.set({ on: true, touch: false });
  for (let n = 0; n < 40 && off.me().mode !== "rest"; n += 1) off.run(0.5);
  off.move(off.me().x, off.me().y);
  off.run(0.7);
  assert.equal(off.me().mode, "rest", "Plays with your pointer off: no petting");
  const lively = page({ motion: "on" });
  lively.pets.set({ on: true });
  lively.run(1);
  const { x, y } = lively.me();
  for (let n = 0; n < 48; n += 1) { lively.tick(14); const a = (n / 30) * 2 * Math.PI; lively.move(x + 60 + Math.cos(a) * 50, y + Math.sin(a) * 50); }
  lively.run(0.05);
  assert.equal(lively.me().mode, "chase", "quick circles near it: a chase");
});

test("a pet's name sits on a nameplate in the page's own tone: dark words on a light page, light words on a dark one", () => {
  const { pets } = load();
  const sim = pets.simulate({ kind: "dragon", seed: 3, width: 800, height: 600 });
  for (const light of [true, false]) {
    const drawn = [];
    let fill = null;
    const ctx = new Proxy({}, {
      get: (target, name) => (name in target ? target[name]
        : typeof name === "string" && /^create\w+Gradient$/.test(name) ? () => ({ addColorStop() {} })
        : name === "fillText" ? (text) => drawn.push({ text, fill })
        : (...args) => ({ width: String(args[0] ?? "").length * 7 })),
      set: (target, name, value) => { if (name === "fillStyle") fill = value; target[name] = value; return true; },
    });
    pets.paint(ctx, sim.pet, "theme", { label: "Pip · Sam", light });
    const tag = drawn.find((entry) => entry.text === "Pip · Sam");
    assert.ok(tag, `the name is drawn (${light ? "light" : "dark"} page)`);
    assert.equal(tag.fill, light ? "#1c2333" : "#f3f5f9", "its words in the page's opposite tone, on a plate of its own");
  }
});
