import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// Friends › Your PCs › My PCs (renderer/pc-fleet.js, main.cjs "My PCs") in a
// vm with a tiny DOM and a fake bridge: it reads on its own and holds a watch
// lease; each PC's row shows its readings and why it is not taking work;
// pairing shows the six numbers and answers through pcs:pair-answer; Send work
// here sends a new task or moves a ready card; the battery stop shows Continue;
// Keep this PC on, the battery lines and the project's switch save through
// pcs:set; handoffs offer Pick up and Drop; and pushes repaint it. Then Connect
// another PC, the walkthrough above the list, through its states: signed out
// (Sign in with Discord goes through MefiCommunity.link, then hubConnect),
// waiting for the other PC, a PC found with Pair, the six numbers either way,
// and folded to one button once a PC of the owner's is paired.

const source = await readFile(new URL("../renderer/pc-fleet.js", import.meta.url), "utf8");
const flush = async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); };
const plain = (value) => JSON.parse(JSON.stringify(value));

let focused = null; // the environment's document, whose activeElement focus() sets
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
  focus() { if (focused) focused.activeElement = this; }
  contains(other) { return this.all().includes(other); }
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

function environment(initial, { windowExtra = {}, apiExtra = {} } = {}) {
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
    ...Object.fromEntries(Object.entries(apiExtra).map(([name, value]) => [name, answer(name, value)])),
  };
  const timers = [];
  const window = { mefiStudio: api, ...windowExtra };
  const document = { createElement: (tag) => new Element(tag), activeElement: null };
  focused = document;
  const context = vm.createContext({ window, document, Date, Number, Array, Set, Map, Promise, Object, String, JSON, Math,
    setTimeout: (fn, ms) => { if (!ms) queueMicrotask(fn); else timers.push(fn); return timers.length; }, clearTimeout: () => {} });
  vm.runInContext(source, context);
  const box = window.MefiPcFleet.section(api);
  const walk = box.find("pc-walk");
  return { box, walk, calls, document, set: (value) => { current = value; }, push: (value) => pushed?.(value), status: () => box.find("pc-fleet-status").textContent, timers,
    live: () => walk.find("pc-walk-status").textContent, signed: () => walk.find("pc-walk-signed").textContent };
}

test("it reads on its own with a watch lease, and each PC's row says what it has and why it is not taking work", async () => {
  const env = environment(view());
  await flush();
  assert.equal(env.box.find("pc-fleet-list").hidden, false, "My PCs is out, not folded");
  assert.deepEqual(env.calls[0], ["pcsStatus", true], "the read holds the watch lease");
  assert.equal(env.timers.length, 1, "and renews it while the card is on the page");
  assert.equal(env.status(), "3 other PCs, 2 online.");
  const rows = env.box.find("pc-fleet-rows").children;
  assert.equal(rows[0].textContent, "Laptop · This PCCPU 23% · 5.8 GB free of 16 GB · Battery 54% · 1 of 3 running" + "Taking work" + "Rename");
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
  assert.equal(env.walk.hidden, false);
  env.push({ ok: false, error: "unavailable" });
  assert.equal(env.status(), "My PCs is not in this build.");
  assert.equal(env.walk.hidden, true, "with My PCs switched off there are no steps to follow");
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
  assert.equal(env.box.find("pc-fleet-handoffs").parentElement.hidden, false, "a waiting handoff is out in the list");
  env.push(view());
  assert.equal(env.box.find("pc-fleet-handoffs").parentElement.hidden, true, "and the block goes when none waits");
});

// ---- Connect another PC -------------------------------------------------------
const me = view().rows[0], tower = view().rows[2];
const signedOut = () => view({ relay: { state: "off", carries: false, linked: false, error: null }, rows: [me], asks: [] });
const stepStates = (env) => env.walk.find("pc-walk-steps").children.map((step) => step.dataset.state);
const stepWords = (env) => env.walk.find("pc-walk-steps").children.map((step) => step.children[1].children[0].textContent);

test("Connect another PC, signed out: the three steps are out, and Sign in with Discord goes the way Friends' own sign-in does", async () => {
  const signIns = [];
  let env = null;
  const community = { link: async () => { signIns.push("link"); env.set(view({ rows: [me] })); return { ok: true }; } };
  env = environment(signedOut(), { windowExtra: { MefiCommunity: community }, apiExtra: { hubConnect: { ok: true }, hubStatus: { ok: true, status: { linked: true, state: "ready", user: { name: "Mefi" } } } } });
  await flush();
  assert.equal(env.walk.tagName, "DETAILS");
  assert.equal(env.walk.open, true, "nothing is paired: the steps are out");
  assert.equal(env.walk.dataset.stage, "signin");
  assert.equal(env.walk.find("pc-walk-head").textContent, "Connect another PC");
  assert.deepEqual(stepWords(env), ["Open Studio on your other PC.", "Sign in to Friends with the same Discord account on both PCs.", "When your other PC shows up, press Pair and check that both screens show the same six numbers."]);
  assert.equal(env.signed(), "This PC is not signed in yet.");
  assert.equal(env.live(), "Your other PC shows up here once both PCs are signed in.");
  assert.deepEqual(stepStates(env), ["ahead", "now", "ahead"], "signing in here is the step to do");
  const signIn = env.walk.find("pc-walk-signin");
  assert.equal(signIn.hidden, false);
  assert.equal(env.box.find("pc-fleet-list").hidden, false, "My PCs stays under the steps");
  signIn.click();
  await flush();
  assert.deepEqual(signIns, ["link"], "MefiCommunity.link, the sign-in card's own path");
  assert.ok(env.calls.some(([name]) => name === "hubConnect"), "then it connects, as the sign-in card does");
  assert.equal(env.calls.filter(([name]) => name === "pcsStatus").length, 2, "and reads My PCs again");
  assert.equal(env.signed(), "✓ This PC is signed in as Mefi.", "the account's name, to match on the other PC");
  assert.equal(signIn.hidden, true);
  assert.equal(env.walk.dataset.stage, "waiting");
});

test("a Discord account outside the server gets Join the Discord and Check again; a room service that is not connected gets Connect", async () => {
  const joined = [];
  const community = { link: async () => ({ ok: false, error: "not-member" }), join: async () => { joined.push("join"); }, check: async () => ({ ok: true }) };
  // friends-front.js hubState: the sentence for the connection and the one thing that helps.
  const hubState = (hub) => (hub.state === "ready" ? { action: null, text: "" } : { action: "connect", text: "Not connected to the room service yet." });
  const env = environment(signedOut(), { windowExtra: { MefiCommunity: community, MefiFriendsFront: { hubState } }, apiExtra: { hubConnect: { ok: true } } });
  await flush();
  env.walk.find("pc-walk-signin").click();
  await flush();
  assert.match(env.signed(), /isn't in the Void Engine server yet\. Join it, then check again\./);
  assert.deepEqual(["pc-walk-signin", "pc-walk-join", "pc-walk-recheck", "pc-walk-connect"].map((id) => env.walk.find(id).hidden), [true, false, false, true]);
  env.walk.find("pc-walk-join").click();
  assert.deepEqual(joined, ["join"]);
  env.set(view({ rows: [me], relay: { state: "off", carries: false, linked: true, error: null } }));
  env.walk.find("pc-walk-recheck").click();
  await flush();
  assert.ok(env.calls.some(([name]) => name === "hubConnect"));
  assert.equal(env.signed(), "✓ This PC is signed in. Not connected to the room service yet.");
  assert.equal(env.walk.find("pc-walk-connect").hidden, false);
  assert.equal(env.live(), "Your other PC shows up here once this PC is connected.");
});

test("signed in, it waits for the other PC; a PC that shows up gets Pair, and the steps then show the numbers to check", async () => {
  const env = environment(view({ rows: [me] }));
  await flush();
  assert.equal(env.walk.open, true);
  assert.equal(env.walk.dataset.stage, "waiting");
  assert.equal(env.live(), "Waiting for your other PC to sign in…");
  assert.equal(env.signed(), "✓ This PC is signed in.");
  assert.deepEqual(stepStates(env), ["now", "ahead", "ahead"], "the other PC's turn: open Studio there");
  assert.equal(env.box.find("pc-fleet-project").hidden, true, "no other PC paired: no project switch yet");
  // Tower signs in with the same account.
  env.push(view({ rows: [me, tower] }));
  assert.equal(env.walk.dataset.stage, "found");
  assert.equal(env.live(), "Found Tower:Pair");
  assert.deepEqual(stepStates(env), ["done", "done", "now"]);
  env.set(view({ rows: [me, tower], asks: [{ id: "pc-new", dir: "out", name: "Tower", numbers: "123 456", relation: "mine", at: 1 }] }));
  env.walk.find("pc-walk-status").byText("Pair")[0].click();
  await flush();
  assert.deepEqual(env.calls.find((row) => row[0] === "pcsPair"), ["pcsPair", "pc-new"], "the same pairing the row's Pair asks for");
  assert.equal(env.live(), "Tower should now show 123 456. If it does, choose Pair there.");
  assert.equal(env.status(), "1 other PC, 1 online.", "the steps say the numbers; the status line does not repeat them");
  assert.equal(env.box.find("pc-fleet-asks").children[0].hidden, true, "nor does the asks list while the steps are out");
});

test("another PC's ask shows its numbers with Pair and Not mine in the steps; a friend's ask stays in the list", async () => {
  const env = environment(view({ rows: [me, tower], asks: [
    { id: "pc-new", dir: "in", name: "Tower", numbers: "654 321", relation: "mine", at: 1 },
    { id: "pc-sam", dir: "in", name: "Sam's PC", numbers: "111 222", relation: "borrow", at: 1 },
  ] }));
  await flush();
  assert.equal(env.walk.dataset.stage, "asked");
  assert.equal(env.live(), "Tower asks to pair. Pair only if its screen shows 654 321.PairNot mine");
  assert.deepEqual(env.box.find("pc-fleet-asks").children.map((item) => item.hidden), [true, false]);
  env.walk.find("pc-walk-status").byText("Pair")[0].click();
  await flush();
  assert.deepEqual(env.calls.find((row) => row[0] === "pcsPairAnswer"), ["pcsPairAnswer", "pc-new", true]);
});

test("a Pair pressed in the steps keeps the keyboard in the step, and the fold after pairing hands it to Connect another PC", async () => {
  const env = environment(view({ rows: [me, tower] }));
  await flush();
  const pair = env.walk.find("pc-walk-status").byText("Pair")[0];
  pair.focus();
  env.set(view({ rows: [me, tower], asks: [{ id: "pc-new", dir: "out", name: "Tower", numbers: "123 456", relation: "mine", at: 1 }] }));
  pair.click();
  await flush();
  assert.equal(env.document.activeElement, env.walk.find("pc-walk-status"), "the line that took its place, which says the numbers");
  // Tower said yes on its own screen: the steps fold, and the focus goes to their one button.
  env.document.activeElement = env.walk.find("pc-walk-steps");
  env.push(view({ rows: [me, { ...tower, paired: true, why: null }] }));
  assert.equal(env.walk.open, false);
  assert.equal(env.document.activeElement, env.walk.find("pc-walk-head"));
});

test("once a PC of the owner's is paired the steps fold to one Connect another PC button, which opens them again", async () => {
  const env = environment(view({ rows: [me, tower] }));
  await flush();
  assert.equal(env.walk.open, true);
  // Tower said yes on its screen: paired.
  const paired = view({ rows: [me, { ...tower, paired: true, why: null }] });
  env.push(paired);
  assert.equal(env.walk.open, false, "folded to its one button");
  assert.equal(env.walk.find("pc-walk-head").textContent, "Connect another PC");
  assert.equal(env.box.find("pc-fleet-project").hidden, false, "the project's switch shows once a PC is paired");
  // The owner opens it again; it stays open through the next answers, and says who is paired.
  env.walk.find("pc-walk-head").click();
  env.walk.open = true; // the browser's toggle after the click
  env.push(paired);
  assert.equal(env.walk.open, true);
  assert.equal(env.live(), "Paired with Tower. Waiting for another PC to sign in…");
  assert.deepEqual(stepStates(env), ["done", "done", "done"]);
  env.walk.find("pc-walk-head").click();
  env.walk.open = false;
  env.push(view());
  assert.equal(env.walk.open, false, "folded again, by the owner's own press");
  // Already paired when the card opens: folded from the start.
  const again = environment(view());
  await flush();
  assert.equal(again.walk.open, false);
  assert.equal(again.walk.dataset.stage, "found", "Tower, not paired yet, is still there to pair from its row");
});

test("the first step says where to get Studio; Rename opens this PC's name from its own row; Power and battery and Lend fold", async () => {
  const env = environment(view(), { apiExtra: { openExternal: { ok: true }, shellCopy: { ok: true } } });
  await flush();
  assert.match(env.walk.textContent, /Not on it yet\? Get it from github\.com\/nateecho32-stack\/mefi-studio\/releases/);
  env.walk.find("pc-walk-get").click();
  env.walk.find("pc-walk-copy").click();
  await flush();
  const url = "https://github.com/nateecho32-stack/mefi-studio/releases/latest";
  assert.deepEqual(env.calls.filter((row) => ["openExternal", "shellCopy"].includes(row[0])), [["openExternal", url], ["shellCopy", url]]);
  assert.equal(env.walk.find("pc-walk-copy").parentElement.textContent.endsWith("Copied."), true);
  // Rename.
  const row = env.box.find("pc-fleet-rename");
  assert.equal(row.hidden, true);
  env.box.find("pc-fleet-rename-open").click();
  assert.equal(row.hidden, false);
  assert.equal(env.box.find("pc-fleet-name").value, "Laptop");
  env.box.find("pc-fleet-name").value = "Travel laptop";
  env.box.find("pc-fleet-name-save").click();
  await flush();
  assert.deepEqual(env.calls.filter((call) => call[0] === "pcsSet").at(-1), ["pcsSet", { name: "Travel laptop" }]);
  assert.equal(row.hidden, true, "saved, the name row folds back");
  // The two groups that pc-sync.js mounts below its GitHub one.
  assert.deepEqual(Object.keys(env.box.parts), ["walk", "list", "power", "lend"]);
  const power = env.box.find("pc-fleet-power"), lend = env.box.find("pc-fleet-lending");
  assert.deepEqual([power.tagName, power.open, lend.tagName, lend.open], ["DETAILS", false, "DETAILS", false]);
  assert.ok(power.find("pc-fleet-stay") && power.find("pc-fleet-battery") && lend.find("pc-fleet-lend-find"));
  assert.equal(power.children[0].textContent, "Power and battery");
  env.push(view({ stayOn: "always", lend: [{ id: "222222222222222222", name: "Sam", auto: false }] }));
  assert.equal(power.children[0].textContent, "Power and battery" + "Kept on", "the summary says what is on");
  assert.equal(lend.children[0].textContent, "Lend this PC to a friend" + "Lent to Sam");
});
