import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const fleet = require("../scripts/pc-fleet.cjs");

const NOW = 1_780_000_000_000;
const KEYS = { sign: `${"A".repeat(43)}=`, box: `${"B".repeat(43)}=` };
const project = (name = "acme/game") => ({ key: fleet.projectKey(`https://github.com/${name}.git`), name: name.split("/")[1] });
const GAME = project();

function state(overrides = {}) {
  return fleet.stateLine({
    now: NOW, name: "Desktop", kind: "desktop", stage: "ok", stayOn: "always", awake: true, running: 0, max: 3, paused: false,
    capacity: { canStart: true, resources: { cpuPercent: 20, availableMemoryMB: 6000, totalMemoryMB: 16000, holdKind: null } },
    projects: [{ ...GAME, open: true, share: true, queued: 1, running: 0 }],
    ...overrides,
  });
}
const peer = (id, overrides = {}, heardAt = NOW) => ({ id, name: id, relation: "mine", paired: true, heard: { state: state(overrides), at: heardAt } });
const task = (id, extra = {}) => ({ id, title: `Task ${id}`, prompt: `Do ${id}`, status: "queued", ...extra });

test("a GitHub project is known by the same key from every remote spelling, and nothing else is", () => {
  const key = fleet.projectKey("https://github.com/Acme/Game.git");
  assert.match(key, /^p-[0-9a-f]{16}$/);
  for (const spelling of ["git@github.com:acme/game.git", "ssh://git@github.com/acme/game", "https://user@github.com/ACME/game/"]) assert.equal(fleet.projectKey(spelling), key);
  assert.equal(fleet.projectKey("https://gitlab.com/acme/game.git"), null);
  assert.equal(fleet.projectKey(""), null);
  assert.ok(!key.includes("game"));
});

test("the status line carries resources, battery and slots, and stays under 3 KB", () => {
  const line = state({ battery: { level: 18, onBattery: true }, stage: "low", running: 1 });
  assert.deepEqual(line.battery, { level: 18, plugged: false });
  assert.equal(line.cpu, 20);
  assert.equal(line.freeMB, 6000);
  assert.deepEqual(line.slots, { running: 1, max: 3, canStart: true, hold: null });
  assert.equal(line.accepting, false, "a low battery takes no work");
  assert.equal(state().accepting, true);
  assert.equal(state({ paused: true }).accepting, false);
  assert.equal(state({ running: 3 }).accepting, false);
  const many = Array.from({ length: 30 }, (_, i) => ({ ...project(`acme/p${i}`), name: "x".repeat(60), share: true }));
  const big = state({ projects: many });
  assert.ok(Buffer.byteLength(JSON.stringify(big)) <= fleet.LIMITS.stateBytes);
  assert.ok(big.projects.length <= fleet.LIMITS.projects);
  // A received line is cleaned field by field.
  assert.deepEqual(fleet.cleanState(JSON.parse(JSON.stringify(line))), line);
  assert.equal(fleet.cleanState({ v: 2 }), null);
  assert.equal(fleet.cleanState({ v: 1, projects: [{ key: "evil" }], stage: "boom" }).stage, "ok");
});

test("why a PC is not taking work, judged by when this PC heard it", () => {
  assert.equal(fleet.whyNotTaking(peer("a").heard, NOW), null);
  assert.equal(fleet.whyNotTaking(peer("a", {}, NOW - 4 * 60_000).heard, NOW), "Not answering for 4 min");
  assert.equal(fleet.whyNotTaking(null, NOW), "Not answering yet");
  assert.equal(fleet.whyNotTaking(peer("a", { stage: "stopped" }).heard, NOW), "Stopped on low battery");
  assert.equal(fleet.whyNotTaking(peer("a", { capacity: { canStart: false, resources: { holdKind: "memory" } } }).heard, NOW), "Short of memory");
  assert.equal(fleet.whyNotTaking(peer("a", { running: 3 }).heard, NOW), "All 3 slots busy");
  assert.equal(fleet.whyNotTaking(peer("a").heard, NOW, project("acme/other")), "Does not have other");
  assert.equal(fleet.whyNotTaking(peer("a", { projects: [{ ...GAME, open: true, share: false }] }).heard, NOW, GAME), "game is not shared there");
  assert.equal(fleet.whyNotTaking(peer("a", { projects: [{ ...GAME, open: false, share: true }] }).heard, NOW, GAME), "game is not open there");
});

test("a PC is short on battery at once and on memory only after two minutes of holding", () => {
  const held = { canStart: false, resources: { holdKind: "memory" } };
  assert.equal(fleet.strainedWhy({ stage: "low", now: NOW, ready: 1 }), "battery");
  assert.equal(fleet.strainedWhy({ stage: "low", now: NOW, ready: 0 }), null, "nothing waiting, nothing to move");
  assert.equal(fleet.strainedWhy({ stage: "ok", capacity: held, holdSince: NOW - 60_000, now: NOW, ready: 2 }), null);
  assert.equal(fleet.strainedWhy({ stage: "ok", capacity: held, holdSince: NOW - 120_000, now: NOW, ready: 2 }), "memory");
  assert.equal(fleet.strainedWhy({ stage: "ok", capacity: { canStart: false, resources: { holdKind: "lag" } }, holdSince: NOW - 600_000, now: NOW, ready: 2 }), null);
  // Every slot busy for two minutes with cards waiting: the queue is split.
  assert.equal(fleet.strainedWhy({ stage: "ok", capacity: { canStart: true }, fullSince: NOW - 60_000, now: NOW, ready: 2 }), null);
  assert.equal(fleet.strainedWhy({ stage: "ok", capacity: { canStart: true }, fullSince: NOW - 120_000, now: NOW, ready: 2 }), "busy");
  assert.equal(fleet.strainedWhy({ stage: "ok", capacity: { canStart: true }, fullSince: NOW - 120_000, now: NOW, ready: 0 }), null);
});

test("only ready, untouched cards move", () => {
  assert.equal(fleet.movable(task("t1"), "ready"), true);
  assert.equal(fleet.movable(task("t1"), "approval"), false);
  for (const extra of [{ movedTo: { id: "x" } }, { fromPc: { id: "x" } }, { pin: true }, { runId: "r" }, { runProgress: { pending: true } }, { ownerHold: { at: 1 } }, { runFailures: 1 }, { delegation: {} }]) {
    assert.equal(fleet.movable(task("t1", extra), "ready"), false, JSON.stringify(extra));
  }
  const card = fleet.cardOf(task("t1", { files: ["src/a.js", "x".repeat(400)], details: "why", intent: "fix" }));
  assert.deepEqual(card, { id: "t1", title: "Task t1", prompt: "Do t1", details: "why", files: ["src/a.js"], intent: "fix" });
  assert.equal(fleet.cleanCard({ id: "t2", title: "x", files: ["../etc/passwd", "C:\\win", "/abs", "ok.js"] }).files.join(), "ok.js");
});

test("offers go to the best PC, never over its free slots or the project's two", () => {
  const peers = [
    peer("pc-laptop", { battery: { level: 80, onBattery: true }, running: 0, max: 3 }),
    peer("pc-desk", { running: 2, max: 3 }),
    peer("pc-big", { running: 0, max: 4 }),
    peer("pc-low", { battery: { level: 30, onBattery: true } }),
    { ...peer("pc-friend"), relation: "lender" },
    { ...peer("pc-unpaired"), paired: false },
  ];
  const ready = [task("t1"), task("t2"), task("t3"), task("t4")];
  const offers = fleet.planOffers({ why: "battery", projects: [{ ...GAME, share: true, ready, out: 0 }], peers, now: NOW });
  // Plugged-in pc-big first (4 free), but the project's limit is 2 cards out.
  assert.deepEqual(offers.map((offer) => [offer.to, offer.tasks.map((card) => card.id)]), [["pc-big", ["t1", "t2"]]]);
  // One already out: one more at most.
  assert.equal(fleet.planOffers({ why: "battery", projects: [{ ...GAME, share: true, ready, out: 1 }], peers, now: NOW })[0].tasks.length, 1);
  assert.deepEqual(fleet.planOffers({ why: "battery", projects: [{ ...GAME, share: true, ready, out: 2 }], peers, now: NOW }), []);
  // A card already offered is not offered twice; an unshared project never.
  assert.deepEqual(fleet.planOffers({ why: "memory", projects: [{ ...GAME, share: true, ready, out: 0 }], peers, pending: new Set(["t1", "t2", "t3"]), now: NOW })[0].tasks.map((card) => card.id), ["t4"]);
  assert.deepEqual(fleet.planOffers({ why: "memory", projects: [{ ...GAME, share: false, ready, out: 0 }], peers, now: NOW }), []);
  // Only friends' or unpaired PCs: nothing moves by itself.
  assert.deepEqual(fleet.planOffers({ why: "memory", projects: [{ ...GAME, share: true, ready, out: 0 }], peers: peers.slice(4), now: NOW }), []);
});

test("a PC's slots are shared across projects in one plan", () => {
  const other = project("acme/site");
  const peers = [peer("pc-desk", { running: 2, max: 3, projects: [{ ...GAME, open: true, share: true }, { ...other, open: true, share: true }] })];
  const offers = fleet.planOffers({ why: "memory", projects: [{ ...GAME, share: true, ready: [task("a1")], out: 0 }, { ...other, share: true, ready: [task("b1")], out: 0 }], peers, now: NOW });
  assert.equal(offers.length, 1, "one free slot, one card");
});

test("a PC takes only what fits now, of a project it has and shares", () => {
  const tasks = [task("t1"), task("t2"), task("t3"), { id: "bad" }];
  const known = { known: true, open: true, share: true };
  assert.deepEqual(fleet.takeOffer({ tasks, accepting: true, free: 2, project: known }).take.map((card) => card.id), ["t1", "t2"]);
  const declined = fleet.takeOffer({ tasks, accepting: true, free: 2, project: known }).decline;
  assert.deepEqual(declined, [{ id: "t3", reason: "full" }, { id: "bad", reason: "unreadable" }]);
  assert.deepEqual(fleet.takeOffer({ tasks: [task("t1")], accepting: false, free: 2, project: known }).decline, [{ id: "t1", reason: "not-taking" }]);
  assert.deepEqual(fleet.takeOffer({ tasks: [task("t1")], accepting: true, free: 2, project: { known: false } }).decline, [{ id: "t1", reason: "no-project" }]);
  assert.deepEqual(fleet.takeOffer({ tasks: [task("t1")], accepting: true, free: 2, project: { known: true, open: true, share: false } }).decline, [{ id: "t1", reason: "not-shared" }]);
  assert.deepEqual(fleet.takeOffer({ tasks: [task("t1")], accepting: true, free: 2, project: { known: true, open: false, share: true } }).decline, [{ id: "t1", reason: "not-open" }]);
  assert.deepEqual(fleet.takeOffer({ tasks: [task("t1")], accepting: true, free: 2, project: known, known: () => true }).decline, [{ id: "t1", reason: "already-here" }]);
  assert.ok(Object.keys(fleet.DECLINES).includes("full"));
});

test("paired records are cleaned, bounded and replaced by id", () => {
  const record = { id: "pc-desk", name: "Desk", relation: "mine", keys: KEYS, pairedAt: NOW };
  assert.deepEqual(fleet.addPeer([], record).peers, [{ id: "pc-desk", name: "Desk", relation: "mine", uid: null, keys: KEYS, pairedAt: NOW }]);
  assert.equal(fleet.addPeer([record], { ...record, name: "Desk 2" }).peers.length, 1);
  assert.match(fleet.addPeer([], { ...record, keys: { sign: "x", box: "y" } }).error, /incomplete/);
  const full = Array.from({ length: fleet.LIMITS.peers }, (_, i) => ({ ...record, id: `pc-${i}` }));
  assert.match(fleet.addPeer(full, { ...record, id: "pc-new" }).error, /Up to 16/);
  assert.equal(fleet.cleanPeer({ ...record, relation: "borrower", auto: true }).auto, true);
  assert.equal(fleet.cleanPeer({ ...record, relation: "boss" }), null);
});

test("rows: this PC first, then own PCs online, then offline paired ones; changed keys are not trusted", () => {
  const peers = [
    { id: "pc-desk", name: "Desk", relation: "mine", keys: KEYS, pairedAt: NOW },
    { id: "pc-old", name: "Old laptop", relation: "mine", keys: KEYS, pairedAt: NOW, lastSeen: NOW - 86_400_000 },
  ];
  const roster = [
    { id: "pc-desk", name: "Desk", kind: "desktop", mine: true, lends: false, keys: KEYS, since: NOW },
    { id: "pc-sam", name: "Sam's PC", kind: "desktop", mine: false, lends: true, owner: { id: "1".repeat(18), name: "Sam" }, keys: { ...KEYS, box: `${"C".repeat(43)}=` }, since: NOW },
    { id: "pc-new", name: "New", kind: "laptop", mine: true, lends: false, keys: { sign: `${"D".repeat(43)}=`, box: KEYS.box }, since: NOW },
    { id: "pc-me", name: "Me", mine: true, keys: KEYS },
  ];
  const heard = new Map([["pc-desk", { state: state(), at: NOW }]]);
  const list = fleet.pcRows({ me: { id: "pc-me", name: "Laptop", kind: "laptop", state: state() }, roster, heard, peers, now: NOW });
  assert.deepEqual(list.map((row) => row.id), ["pc-me", "pc-desk", "pc-new", "pc-old", "pc-sam"]);
  assert.equal(list[0].self, true);
  const desk = list.find((row) => row.id === "pc-desk");
  assert.equal(desk.paired, true);
  assert.equal(desk.why, null);
  assert.equal(list.find((row) => row.id === "pc-new").paired, false);
  assert.equal(list.find((row) => row.id === "pc-old").why, "Offline");
  assert.equal(list.find((row) => row.id === "pc-sam").relation, "lender");
  // A paired PC answering with other keys is shown, but as not paired.
  const swapped = fleet.pcRows({ me: { id: "pc-me" }, roster: [{ ...roster[0], keys: roster[2].keys }], heard, peers, now: NOW });
  assert.equal(swapped[1].paired, false);
  assert.equal(swapped[1].keysChanged, true);
});

test("the outbox keeps one note per card, sends to PCs online and forgets after 14 days", () => {
  let box = fleet.outboxAdd([], { to: "pc-a", body: { type: "done", taskId: "t1", outcome: "done" } }, NOW);
  box = fleet.outboxAdd(box, { to: "pc-a", body: { type: "done", taskId: "t1", outcome: "dropped" } }, NOW + 1);
  box = fleet.outboxAdd(box, { to: "pc-b", body: { type: "done", taskId: "t2", outcome: "done" } }, NOW);
  assert.equal(box.length, 2);
  assert.equal(box.find((row) => row.to === "pc-a").body.outcome, "dropped");
  const due = fleet.outboxDue(box, new Set(["pc-a"]), NOW + 10);
  assert.deepEqual(due.send.map((row) => row.to), ["pc-a"]);
  assert.deepEqual(due.keep.map((row) => row.to), ["pc-b"]);
  assert.deepEqual(fleet.outboxDue(box, new Set(["pc-a", "pc-b"]), NOW + fleet.LIMITS.outboxMs + 5), { send: [], keep: [] });
});

test("a finished card from another PC writes its note home", () => {
  const fromPc = { id: "pc-laptop", name: "Laptop", taskId: "task_origin" };
  assert.deepEqual(fleet.doneNote({ id: "task_here", status: "done", fromPc, verification: { reason: "verified" } }),
    { to: "pc-laptop", body: { type: "done", taskId: "task_origin", as: "task_here", outcome: "done", note: "verified" } });
  assert.equal(fleet.doneNote({ id: "x", status: "archived", dropped: { at: 1 }, fromPc }).body.outcome, "dropped");
  assert.equal(fleet.doneNote({ id: "x", status: "queued", fromPc }), null);
  assert.equal(fleet.doneNote({ id: "x", status: "done" }), null);
});
