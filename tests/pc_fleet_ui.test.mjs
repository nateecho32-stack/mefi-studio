import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// Friends › Your PCs › My PCs (renderer/pc-fleet.js, main.cjs "My PCs") in a
// vm with a tiny DOM and a fake bridge: it opens on its own and holds a watch
// lease; each PC's row shows its readings and why it is not taking work;
// pairing shows the six numbers and answers through pcs:pair-answer; Send work
// here sends a new task or moves a ready card; the battery stop shows Continue;
// Keep this PC on, the battery lines and the project's switch save through
// pcs:set; handoffs offer Pick up and Drop; and pushes repaint it.

const source = await readFile(new URL("../renderer/pc-fleet.js", import.meta.url), "utf8");
const flush = async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); };
const plain = (value) => JSON.parse(JSON.stringify(value));

class Element {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attrs = {}; this.listeners = {}; this.hidden = false; this.disabled = false; this.className = ""; this.text = ""; this.value = ""; this.checked = false; this.open = false; }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map((child) => (typeof child === "string" ? child : child.textContent)).join(""); }
  append(...children) { for (const child of children) { if (typeof child === "object") child.parentElement = this; this.children.push(child); } }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key] ?? null; }
  removeAttribute(key) { delete this.attrs[key]; }
  addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); }
  fire(type) { for (const listener of this.listeners[type] ?? []) listener({ type }); }
  click() { this.fire("click"); }
  focus() {}
  all() { return [this, ...this.children.flatMap((child) => (typeof child === "object" ? child.all() : []))]; }
  find(id) { return this.all().find((item) => item.id === id) ?? null; }
  byText(text) { return this.all().filter((item) => item.tagName === "BUTTON" && item.text === text); }
}

const state = (extra = {}) => ({ v: 1, cpu: 23, freeMB: 5939, totalMB: 16384, battery: null, stage: "ok", stayOn: "working", slots: { running: 1, max: 3, canStart: true, hold: null }, accepting: true, projects: [], ...extra });
const view = (extra = {}) => ({
  ok: true, me: { id: "pc-laptop", name: "Laptop" },
  relay: { state: "ready", carries: true, linked: true }, encryption: true,
  power: { reading: { level: 54, onBattery: true }, stage: "ok", continuedAt: null, lines: { low: 20, stop: 10 }, words: "Battery 54%, on battery" },
  stayOn: "working", awake: true,
  rows: [
    { id: "pc-laptop", name: "Laptop", kind: "laptop", self: true, mine: true, online: true, paired: true, relation: "mine", heard: { state: state({ battery: { level: 54, plugged: false } }), at: 1 }, why: null },
    { id: "pc-desk", name: "Desk", kind: "desktop", mine: true, online: true, paired: true, relation: "mine", heard: { state: state(), at: 1 }, why: null },
    { id: "pc-new", name: "Tower", kind: "desktop", mine: true, online: true, paired: false, relation: "mine", heard: null, why: "Not answering yet" },
    { id: "pc-old", name: "Old laptop", kind: "desktop", mine: true, online: false, paired: true, relation: "mine", heard: null, why: "Offline", lastSeen: Date.now() - 3 * 3600_000 },
  ],
  asks: [], project: { id: "p1", name: "Game", github: true, share: true },
  offers: [], movable: [{ id: "t1", title: "Fix the header" }], moved: [], waiting: [], held: 0, sent: [],
  handoffs: { at: 1, error: null, list: [] }, lend: [], notes: [], limits: { movedPerProject: 2, parkedPerProject: 3 },
  ...extra,
});

function environment(initial) {
  const calls = [];
  let current = initial, pushed = null;
  const answer = (name, value) => async (...args) => { calls.push([name, ...plain(args)]); return typeof value === "function" ? value(...args) : value; };
  const api = {
    pcsStatus: answer("pcsStatus", () => current),
    pcsSet: answer("pcsSet", () => current),
    pcsPair: answer("pcsPair", { ok: true, numbers: "123 456" }),
    pcsPairAnswer: answer("pcsPairAnswer", { ok: true }),
    pcsForget: answer("pcsForget", { ok: true }),
    pcsStart: answer("pcsStart", { ok: true }),
    pcsMove: answer("pcsMove", { ok: true }),
    pcsRecall: answer("pcsRecall", { ok: true }),
    pcsContinue: answer("pcsContinue", { ok: true, elsewhere: 1 }),
    pcsHandoffs: answer("pcsHandoffs", () => current),
    pcsPickUp: answer("pcsPickUp", { ok: true, tasks: 2 }),
    pcsDrop: answer("pcsDrop", { ok: true }),
    hubRoom: answer("hubRoom", { ok: true, members: [{ id: "222222222222222222", name: "Sam" }] }),
    onPcsEvent: (fn) => { pushed = fn; },
  };
  const timers = [];
  const window = { mefiStudio: api };
  const document = { createElement: (tag) => new Element(tag), activeElement: null };
  const context = vm.createContext({ window, document, Date, Number, Array, Set, Map, Promise, Object, String, JSON, Math,
    setTimeout: (fn, ms) => { if (!ms) queueMicrotask(fn); else timers.push(fn); return timers.length; }, clearTimeout: () => {} });
  vm.runInContext(source, context);
  const box = window.MefiPcFleet.section(api);
  return { box, calls, set: (value) => { current = value; }, push: (value) => pushed?.(value), status: () => box.find("pc-fleet-status").textContent, timers };
}

test("it opens on its own with a watch lease, and each PC's row says what it has and why it is not taking work", async () => {
  const env = environment(view());
  await flush();
  assert.equal(env.box.open, true);
  assert.deepEqual(env.calls[0], ["pcsStatus", true], "the read holds the watch lease");
  assert.equal(env.timers.length, 1, "and renews it while open");
  assert.equal(env.status(), "3 other PCs, 2 online.");
  const rows = env.box.find("pc-fleet-rows").children;
  assert.equal(rows[0].textContent, "Laptop · This PCCPU 23% · 5.8 GB free of 16 GB · Battery 54% · 1 of 3 running" + "Taking work");
  assert.match(rows[1].textContent, /^Desk · desktopCPU 23%.*Taking work/);
  assert.match(rows[2].textContent, /Tower · desktopNot paired yet/);
  assert.equal(rows[2].byText("Pair").length, 1);
  assert.match(rows[3].textContent, /Offline since 3 h ago/);
  assert.equal(rows[3].dataset.state, "offline");
  assert.equal(rows[1].byText("Send work here").length, 1);
});

test("the status line names what stands in the way", async () => {
  const env = environment(view());
  await flush();
  for (const [value, words] of [
    [view({ relay: { state: "ready", carries: true, linked: false } }), /Sign in with Discord in Friends/],
    [view({ relay: { state: "ready", carries: false, linked: true } }), /does not carry My PCs yet/],
    [view({ relay: { state: "connecting", carries: false, linked: true } }), /Connecting/],
    [view({ encryption: false }), /cannot keep this PC's keys safe/],
    [view({ rows: view().rows.slice(0, 1) }), /No other PC yet/],
  ]) {
    env.push(value);
    assert.match(env.status(), words);
  }
});

test("pairing: this PC asks and says what to check; another PC's ask shows the numbers with Pair and Not mine", async () => {
  const env = environment(view());
  await flush();
  env.box.find("pc-fleet-rows").children[2].byText("Pair")[0].click();
  await flush();
  assert.deepEqual(env.calls.find((row) => row[0] === "pcsPair"), ["pcsPair", "pc-new"]);
  assert.match(env.status(), /Check that Tower shows 123 456, then choose Pair there/);
  env.push(view({ asks: [{ id: "pc-new", dir: "in", name: "Tower", numbers: "654 321", relation: "mine", at: 1 }] }));
  const ask = env.box.find("pc-fleet-asks").children[0];
  assert.match(ask.textContent, /Tower asks to pair\. Pair only if its screen shows 654 321\./);
  ask.byText("Not mine")[0].click();
  await flush();
  assert.deepEqual(env.calls.find((row) => row[0] === "pcsPairAnswer"), ["pcsPairAnswer", "pc-new", false]);
});

test("Send work here sends a new task, or moves one of the project's ready cards", async () => {
  const env = environment(view());
  await flush();
  env.box.find("pc-fleet-rows").children[1].byText("Send work here")[0].click();
  const form = env.box.find("pc-fleet-send");
  assert.equal(form.hidden, false);
  assert.deepEqual(env.box.find("pc-fleet-pick").children.map((option) => option.text), ["A new task", "Move: Fix the header"]);
  env.box.find("pc-fleet-send-go").click();
  assert.equal(env.status(), "Give the task a title.");
  env.box.find("pc-fleet-title").value = "Add a dark mode";
  env.box.find("pc-fleet-send-go").click();
  await flush();
  assert.deepEqual(env.calls.find((row) => row[0] === "pcsStart"), ["pcsStart", { pcId: "pc-desk", title: "Add a dark mode", prompt: "Add a dark mode" }]);
  assert.equal(form.hidden, true);
  env.box.find("pc-fleet-rows").children[1].byText("Send work here")[0].click();
  env.box.find("pc-fleet-pick").value = "t1";
  env.box.find("pc-fleet-pick").fire("change");
  assert.equal(env.box.find("pc-fleet-title").hidden, true);
  env.box.find("pc-fleet-send-go").click();
  await flush();
  assert.deepEqual(env.calls.find((row) => row[0] === "pcsMove"), ["pcsMove", "t1", "pc-desk"]);
  assert.match(env.status(), /Offered to Desk/);
});

test("a battery stop shows Continue; cards out on other PCs can be brought back", async () => {
  const env = environment(view({ power: { ...view().power, stage: "stopped", reading: { level: 9, onBattery: true } }, held: 2, moved: [{ id: "t9", title: "Ship it", to: "Desk", toId: "pc-desk", pending: false }] }));
  await flush();
  const banner = env.box.find("pc-fleet-stop");
  assert.equal(banner.hidden, false);
  assert.match(banner.textContent, /Stopped at 9% battery\. 2 tasks were stopped with progress saved and parked for your other PCs\. Nothing runs here until you choose Continue\./);
  env.box.find("pc-fleet-continue").click();
  await flush();
  assert.ok(env.calls.some((row) => row[0] === "pcsContinue"));
  assert.match(env.status(), /1 task is on another PC now/);
  const moved = env.box.find("pc-fleet-moved");
  assert.match(moved.textContent, /Ship it · on Desk/);
  moved.children[0].byText("Bring back")[0].click();
  await flush();
  assert.deepEqual(env.calls.find((row) => row[0] === "pcsRecall"), ["pcsRecall", "t9", false]);
});

test("Keep this PC on, the battery lines, the name and the project's switch save through pcs:set", async () => {
  const env = environment(view());
  await flush();
  const stay = env.box.find("pc-fleet-stay");
  assert.equal(stay.checked, false);
  stay.checked = true;
  stay.fire("change");
  await flush();
  env.box.find("pc-fleet-low").value = "10";
  env.box.find("pc-fleet-stop-at").value = "15";
  env.box.find("pc-fleet-battery-save").click();
  assert.match(env.status(), /stop level must be below/);
  env.box.find("pc-fleet-low").value = "30";
  env.box.find("pc-fleet-battery-save").click();
  await flush();
  const share = env.box.find("pc-fleet-share");
  share.checked = false;
  share.fire("change");
  await flush();
  assert.deepEqual(env.calls.filter((row) => row[0] === "pcsSet").map((row) => row[1]), [{ stayOn: "always" }, { battery: { low: 30, stop: 15 } }, { share: { projectId: "p1", on: false } }]);
  env.push(view({ project: { id: "p2", name: "Notes", github: false, share: false }, power: { ...view().power, reading: null } }));
  assert.equal(share.disabled, true);
  assert.match(env.box.textContent, /no GitHub repository, so its work stays on this PC/);
  assert.equal(env.box.find("pc-fleet-battery").hidden, true, "no battery, no battery lines");
});

test("handoffs offer Pick up and Drop; lending finds a friend and saves the list", async () => {
  const env = environment(view({ handoffs: { at: 1, error: null, list: [{ branch: "mefi/handoff/laptop-20261006-1402", sha: "a".repeat(40), mine: false, pcName: "Laptop", why: "battery", level: 9, at: Date.now() - 120_000, titles: ["Fix the header"] }] } }));
  await flush();
  const item = env.box.find("pc-fleet-handoffs").children[0];
  assert.match(item.textContent, /Fix the header · from Laptop at 9% battery · 2 min ago/);
  item.byText("Pick up")[0].click();
  await flush();
  assert.deepEqual(env.calls.find((row) => row[0] === "pcsPickUp"), ["pcsPickUp", "mefi/handoff/laptop-20261006-1402", "a".repeat(40)]);
  assert.match(env.status(), /Picked up: 2 tasks/);
  env.box.find("pc-fleet-lend-find").value = "Sam";
  env.box.find("pc-fleet-lend-find-go").click();
  await flush();
  env.box.find("pc-fleet-lend-found").children[0].byText("Lend to them")[0].click();
  await flush();
  assert.deepEqual(env.calls.filter((row) => row[0] === "pcsSet").at(-1), ["pcsSet", { lend: [{ id: "222222222222222222", name: "Sam", auto: false }] }]);
});
