"use strict";

// My PCs' rules (docs/my-pcs.md): the status line a PC sends the others, the
// rows Friends › Your PCs shows, when a PC is short, which ready cards go to
// which PC, what a PC takes from an offer, project keys, paired-PC records
// and the outbox of "done" notes. Pure module: no Electron, no filesystem, no
// network, no clock reads (time is passed in). main.cjs "My PCs" owns the
// relay, the boards and the clock.
// The rules that keep the queue small live here:
// - moved, never copied: a moved card waits on its first PC (movedTo) and is
//   never offered again by itself;
// - pull, not push: a PC takes only what fits its free slots right now;
// - per project: at most LIMITS.movedPerProject cards out at once;
// - only ready cards move, never one that ran, waits for the owner, was pinned
//   or came from another PC.
// Guarded by tests/pc_fleet.test.mjs.
const crypto = require("node:crypto");

const LIMITS = Object.freeze({
  peers: 16, rows: 24, projects: 12, offerTasks: 4, movedPerProject: 2, parkedPerProject: 3,
  offerTtlMs: 120_000, answeringMs: 180_000, strainMs: 120_000, sendEveryMs: 60_000,
  outbox: 200, outboxMs: 14 * 24 * 60 * 60_000, titleChars: 90, promptChars: 6000, detailChars: 2000, files: 40,
  stateBytes: 3 * 1024, lowPeerBattery: 40,
});
const STAY_ON = Object.freeze(["off", "working", "always"]);
const STAGES = Object.freeze(["ok", "low", "stopped"]);
const KINDS = Object.freeze(["desktop", "laptop"]);
const RELATIONS = Object.freeze(["mine", "lender", "borrower"]);
const OUTCOMES = Object.freeze(["done", "failed", "dropped"]);
const WHY = Object.freeze(["battery", "memory", "busy", "you"]);
const PC_ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const KEY = /^[A-Za-z0-9+/]{43}=$/;
const PROJECT_KEY = /^p-[0-9a-f]{16}$/;
const TASK_ID = /^[A-Za-z0-9_.:-]{1,80}$/;
const { actorId } = require("./actor-contract.cjs");

const object = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const rows = (value) => (Array.isArray(value) ? value.filter(object) : []);
const whole = (value, min, max) => (Number.isFinite(Number(value)) && value !== null && value !== "" ? Math.min(max, Math.max(min, Math.round(Number(value)))) : null);
const line = (value, max) => String(value ?? "").replace(/[\x00-\x1f\x7f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const text = (value, max) => String(value ?? "").replace(/\r\n/g, "\n").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").slice(0, max);

// ---- projects --------------------------------------------------------------------

// "owner/name" of a GitHub remote in lower case, or null.
function githubName(remote) {
  const raw = String(remote ?? "").trim();
  const match = raw.match(/^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i);
  return match ? `${match[1]}/${match[2]}`.toLowerCase() : null;
}

// The key PCs know a project by: the relay never sees the repository's name.
function projectKey(remote) {
  const name = githubName(remote);
  return name ? `p-${crypto.createHash("sha256").update(name).digest("hex").slice(0, 16)}` : null;
}

const isProjectKey = (value) => typeof value === "string" && PROJECT_KEY.test(value);

// ---- the status line -------------------------------------------------------------

// What this PC tells the others, from main's own readings.
function stateLine({ now, name, kind, capacity, battery, stage, stayOn, awake, running, max, paused, projects }) {
  const resources = capacity?.resources ?? {};
  const slots = {
    running: whole(running, 0, 99) ?? 0,
    max: whole(max, 0, 99) ?? 0,
    canStart: capacity?.canStart !== false,
    hold: typeof resources.holdKind === "string" ? line(resources.holdKind, 24) : null,
  };
  const safeStage = STAGES.includes(stage) ? stage : "ok";
  const state = {
    v: 1, at: now, name: line(name, 40) || "PC", kind: KINDS.includes(kind) ? kind : "desktop",
    cpu: whole(resources.cpuPercent, 0, 100), freeMB: whole(resources.availableMemoryMB, 0, 1e7), totalMB: whole(resources.totalMemoryMB, 0, 1e7),
    battery: battery && !battery.error && Number.isFinite(battery.level) ? { level: whole(battery.level, 0, 100), plugged: !battery.onBattery } : null,
    stage: safeStage, stayOn: STAY_ON.includes(stayOn) ? stayOn : "working", awake: awake === true,
    slots,
    accepting: paused !== true && safeStage === "ok" && slots.canStart && slots.running < slots.max,
    projects: [],
  };
  for (const project of rows(projects).slice(0, LIMITS.projects)) {
    if (!isProjectKey(project.key)) continue;
    state.projects.push({ key: project.key, name: line(project.name, 60) || "project", open: project.open === true, share: project.share === true, queued: whole(project.queued, 0, 9999) ?? 0, running: whole(project.running, 0, 99) ?? 0 });
    if (Buffer.byteLength(JSON.stringify(state)) > LIMITS.stateBytes) { state.projects.pop(); break; }
  }
  return state;
}

// A status line another PC sent, checked field by field; null when unusable.
function cleanState(raw) {
  if (!object(raw) || raw.v !== 1) return null;
  const slots = object(raw.slots) ? raw.slots : {};
  const battery = object(raw.battery) && whole(raw.battery.level, 0, 100) !== null ? { level: whole(raw.battery.level, 0, 100), plugged: raw.battery.plugged === true } : null;
  return {
    v: 1, at: Number.isFinite(raw.at) ? raw.at : 0, name: line(raw.name, 40) || "PC", kind: KINDS.includes(raw.kind) ? raw.kind : "desktop",
    cpu: whole(raw.cpu, 0, 100), freeMB: whole(raw.freeMB, 0, 1e7), totalMB: whole(raw.totalMB, 0, 1e7), battery,
    stage: STAGES.includes(raw.stage) ? raw.stage : "ok", stayOn: STAY_ON.includes(raw.stayOn) ? raw.stayOn : "working", awake: raw.awake === true,
    slots: { running: whole(slots.running, 0, 99) ?? 0, max: whole(slots.max, 0, 99) ?? 0, canStart: slots.canStart !== false, hold: typeof slots.hold === "string" ? line(slots.hold, 24) : null },
    accepting: raw.accepting === true,
    projects: rows(raw.projects).slice(0, LIMITS.projects).filter((project) => isProjectKey(project.key)).map((project) => ({
      key: project.key, name: line(project.name, 60) || "project", open: project.open === true, share: project.share === true, queued: whole(project.queued, 0, 9999) ?? 0, running: whole(project.running, 0, 99) ?? 0,
    })),
  };
}

const freeSlots = (state) => (state ? Math.max(0, state.slots.max - state.slots.running) : 0);
// Answering is judged by when this PC heard it, never by the other PC's clock.
const answering = (heard, now) => Boolean(heard?.state) && Number.isFinite(heard.at) && now - heard.at <= LIMITS.answeringMs;

// Why a PC is not taking work (for one project, when given), or null.
function whyNotTaking(heard, now, project = null) {
  if (!answering(heard, now)) return heard?.at ? `Not answering for ${Math.max(1, Math.round((now - heard.at) / 60_000))} min` : "Not answering yet";
  const state = heard.state;
  if (state.stage === "stopped") return "Stopped on low battery";
  if (state.stage === "low") return "Low on battery";
  if (!state.slots.canStart) return /^memory/.test(state.slots.hold ?? "") ? "Short of memory" : "Busy";
  if (state.slots.max > 0 && state.slots.running >= state.slots.max) return `All ${state.slots.max} slots busy`;
  if (!state.accepting) return "Not taking work";
  if (project) {
    const has = state.projects.find((row) => row.key === project.key);
    if (!has) return `Does not have ${project.name || "this project"}`;
    if (!has.share) return `${project.name || "This project"} is not shared there`;
    // A PC runs work for its open project only (spawnNextJob), so a card sent
    // for another project would only wait there.
    if (!has.open) return `${project.name || "This project"} is not open there`;
  }
  return null;
}

// ---- when this PC is short -------------------------------------------------------

// "battery", "memory", "busy" or null. `holdSince` is when the capacity check
// started holding for memory and `fullSince` when every slot became busy
// (main keeps both); `ready` is how many cards wait. "busy" is how the queue
// is split between PCs: cards that would only wait here go where a slot is free.
function strainedWhy({ stage, capacity, holdSince, fullSince = null, now, ready }) {
  if (!(ready > 0)) return null;
  if (stage === "low" || stage === "stopped") return "battery";
  const hold = capacity?.resources?.holdKind ?? "";
  if (capacity?.canStart === false && /^memory/.test(hold) && Number.isFinite(holdSince) && now - holdSince >= LIMITS.strainMs) return "memory";
  if (Number.isFinite(fullSince) && now - fullSince >= LIMITS.strainMs) return "busy";
  return null;
}

// A board card that may move: ready, not started, not moved before, not sent
// by another PC or a friend, not the owner's pinned next card.
function movable(task, stage) {
  if (!object(task) || stage !== "ready" || !TASK_ID.test(String(task.id ?? ""))) return false;
  if (task.movedTo || task.fromPc || task.pin || task.runId || task.lease || task.runProgress?.pending || task.ownerHold) return false;
  if (Number(task.runFailures) > 0 || task.delegation || task.absorbedInto) return false;
  return Boolean(line(task.title, LIMITS.titleChars));
}

// What travels: the card as the owner would read it, bounded.
function cardOf(task) {
  const card = { id: String(task.id), title: line(task.title, LIMITS.titleChars), prompt: text(task.prompt ?? task.title, LIMITS.promptChars) };
  if (typeof task.details === "string" && task.details.trim()) card.details = text(task.details, LIMITS.detailChars);
  const files = (Array.isArray(task.files) ? task.files : []).filter((file) => typeof file === "string" && file && file.length <= 300).slice(0, LIMITS.files);
  if (files.length) card.files = files;
  if (typeof task.intent === "string" && task.intent) card.intent = line(task.intent, 40);
  return card;
}

function cleanCard(raw) {
  if (!object(raw) || !TASK_ID.test(String(raw.id ?? ""))) return null;
  const title = line(raw.title, LIMITS.titleChars);
  if (!title) return null;
  const card = { id: String(raw.id), title, prompt: text(raw.prompt || title, LIMITS.promptChars) };
  if (typeof raw.details === "string" && raw.details.trim()) card.details = text(raw.details, LIMITS.detailChars);
  const files = (Array.isArray(raw.files) ? raw.files : []).filter((file) => typeof file === "string" && file && file.length <= 300 && !/^[\\/]|^[A-Za-z]:|(^|[\\/])\.\.([\\/]|$)/.test(file)).slice(0, LIMITS.files);
  if (files.length) card.files = files;
  if (typeof raw.intent === "string" && raw.intent) card.intent = line(raw.intent, 40);
  return card;
}

// Paired PCs of the owner that could take this project's work now, best first:
// plugged in, then the most free slots, then the most free memory.
function rankPeers(peers, project, now) {
  return rows(peers)
    .filter((peer) => peer.relation === "mine" && peer.paired && !whyNotTaking(peer.heard, now, project))
    .filter((peer) => !peer.heard.state.battery || peer.heard.state.battery.plugged || peer.heard.state.battery.level >= LIMITS.lowPeerBattery)
    .map((peer) => ({ peer, free: freeSlots(peer.heard.state), plugged: !peer.heard.state.battery || peer.heard.state.battery.plugged, freeMB: peer.heard.state.freeMB ?? 0 }))
    .sort((a, b) => Number(b.plugged) - Number(a.plugged) || b.free - a.free || b.freeMB - a.freeMB || String(a.peer.id).localeCompare(String(b.peer.id)))
    .map((row) => row.peer);
}

// The offers to make now. `projects`: [{ key, name, share, ready: [task], out }]
// where `out` counts the project's cards already on other PCs; `pending` holds
// the ids of cards already in an unanswered offer. -> [{ to, project, tasks }].
function planOffers({ why, projects, peers, pending = new Set(), now }) {
  if (!WHY.includes(why)) return [];
  const room = new Map();
  const offers = [];
  for (const project of rows(projects)) {
    if (!project.share || !isProjectKey(project.key)) continue;
    let budget = LIMITS.movedPerProject - (whole(project.out, 0, 999) ?? 0);
    if (budget <= 0) continue;
    const cards = rows(project.ready).filter((task) => !pending.has(task.id)).map(cardOf).filter((card) => card.title);
    for (const peer of rankPeers(peers, { key: project.key, name: project.name }, now)) {
      if (budget <= 0 || !cards.length) break;
      const free = room.has(peer.id) ? room.get(peer.id) : freeSlots(peer.heard.state);
      const count = Math.min(free, budget, cards.length, LIMITS.offerTasks);
      if (count <= 0) continue;
      offers.push({ to: peer.id, toName: peer.name, project: { key: project.key, name: line(project.name, 60) }, why, tasks: cards.splice(0, count) });
      room.set(peer.id, free - count);
      budget -= count;
    }
  }
  return offers;
}

// What this PC takes from an offer: only what fits its free slots now, of a
// project it has, shares and has open. `known(card)` says the board already has it.
function takeOffer({ tasks, accepting, free, project, known = () => false }) {
  const take = [], decline = [];
  const cards = rows(tasks).slice(0, LIMITS.offerTasks);
  let room = accepting ? Math.max(0, whole(free, 0, 99) ?? 0) : 0;
  for (const raw of cards) {
    const card = cleanCard(raw);
    const id = String(raw?.id ?? "").slice(0, 80);
    if (!card) { decline.push({ id, reason: "unreadable" }); continue; }
    if (!project?.known) { decline.push({ id, reason: "no-project" }); continue; }
    if (!project.share) { decline.push({ id, reason: "not-shared" }); continue; }
    if (!project.open) { decline.push({ id, reason: "not-open" }); continue; }
    if (!accepting) { decline.push({ id, reason: "not-taking" }); continue; }
    if (known(card)) { decline.push({ id, reason: "already-here" }); continue; }
    if (room <= 0) { decline.push({ id, reason: "full" }); continue; }
    take.push(card);
    room -= 1;
  }
  return { take, decline };
}

// The words for a declined card, on its first PC.
const DECLINES = Object.freeze({
  unreadable: "it could not read the card", "no-project": "it does not have this project", "not-shared": "this project is not shared there", "not-open": "this project is not open there",
  "not-taking": "it is not taking work", "already-here": "it already has this task", full: "its slots are full", lapsed: "it did not answer in time",
});

// ---- paired PCs ------------------------------------------------------------------

function cleanPeer(raw) {
  if (!object(raw) || !PC_ID.test(String(raw.id ?? "")) || !RELATIONS.includes(raw.relation)) return null;
  if (raw.uid != null && !actorId(raw.uid)) return null;
  if (!object(raw.keys) || !KEY.test(String(raw.keys.sign)) || !KEY.test(String(raw.keys.box))) return null;
  return {
    id: raw.id, name: line(raw.name, 40) || "PC", relation: raw.relation, uid: raw.uid == null ? null : actorId(raw.uid),
    keys: { sign: raw.keys.sign, box: raw.keys.box }, pairedAt: Number.isFinite(raw.pairedAt) ? raw.pairedAt : 0,
    ...(raw.relation === "borrower" ? { auto: raw.auto === true } : {}),
    ...(Number.isFinite(raw.lastSeen) ? { lastSeen: raw.lastSeen } : {}),
  };
}

function cleanPeers(raw) {
  const out = [];
  for (const peer of rows(raw)) {
    const clean = cleanPeer(peer);
    if (clean && !out.some((row) => row.id === clean.id)) out.push(clean);
  }
  return out.slice(0, LIMITS.peers);
}

// Adds or replaces one paired PC. -> { peers } or { error }.
function addPeer(peers, peer) {
  const clean = cleanPeer(peer);
  if (!clean) return { error: "That PC could not be paired: its details were incomplete." };
  const others = cleanPeers(peers).filter((row) => row.id !== clean.id);
  if (others.length >= LIMITS.peers) return { error: `Up to ${LIMITS.peers} PCs can be paired. Forget one first.` };
  return { peers: [...others, clean] };
}

// ---- rows for Friends › Your PCs ------------------------------------------------

// Every PC this one knows: itself, the relay's roster (`roster`, the relay's
// pcs frame), what each said last (`heard`: id -> { state, at }) and the
// paired records, so a paired PC that is off still has a row.
function pcRows({ me, roster, heard, peers, now }) {
  const byId = new Map();
  const peerOf = new Map(cleanPeers(peers).map((peer) => [peer.id, peer]));
  const heardOf = (id) => (typeof heard?.get === "function" ? heard.get(id) : heard?.[id]) ?? null;
  const self = me?.id ? { id: me.id, name: line(me.name, 40) || "This PC", kind: KINDS.includes(me.kind) ? me.kind : "desktop", self: true, mine: true, online: true, paired: true, heard: { state: me.state ?? null, at: now }, relation: "mine" } : null;
  for (const pc of rows(roster).slice(0, LIMITS.rows)) {
    if (!PC_ID.test(String(pc.id ?? "")) || pc.id === me?.id) continue;
    const peer = peerOf.get(pc.id) ?? null;
    // A paired PC whose keys changed is not the PC that was paired.
    const keysMatch = !peer || (pc.keys?.sign === peer.keys.sign && pc.keys?.box === peer.keys.box);
    byId.set(pc.id, {
      id: pc.id, name: line(pc.name, 40) || peer?.name || "PC", kind: KINDS.includes(pc.kind) ? pc.kind : "desktop",
      owner: object(pc.owner) ? { id: String(pc.owner.id ?? ""), name: line(pc.owner.name, 40) } : null,
      mine: pc.mine === true, lends: pc.lends === true, online: true, since: Number.isFinite(pc.since) ? pc.since : null,
      keys: object(pc.keys) ? { sign: String(pc.keys.sign ?? ""), box: String(pc.keys.box ?? "") } : null,
      paired: Boolean(peer) && keysMatch, keysChanged: Boolean(peer) && !keysMatch,
      relation: peer?.relation ?? (pc.mine === true ? "mine" : pc.lends === true ? "lender" : null),
      auto: peer?.auto === true, heard: heardOf(pc.id),
    });
  }
  for (const peer of peerOf.values()) {
    if (byId.has(peer.id) || peer.id === me?.id) continue;
    byId.set(peer.id, { id: peer.id, name: peer.name, kind: "desktop", owner: null, mine: peer.relation === "mine", lends: peer.relation === "lender", online: false, since: null, keys: peer.keys, paired: true, keysChanged: false, relation: peer.relation, auto: peer.auto === true, heard: heardOf(peer.id), lastSeen: peer.lastSeen ?? null });
  }
  const list = [...byId.values()].map((row) => ({ ...row, why: row.online ? whyNotTaking(row.heard, now) : "Offline" }));
  // Own PCs first, then friends' lent PCs; online before offline; by name.
  list.sort((a, b) => Number(b.mine) - Number(a.mine) || Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
  return self ? [self, ...list] : list;
}

// ---- the outbox: "done" notes for a PC that is not online -----------------------

function outboxAdd(list, item, now) {
  if (!PC_ID.test(String(item?.to ?? "")) || !object(item?.body)) return rows(list);
  const key = `${item.to}|${item.body.type}|${item.body.taskId ?? item.body.offerId ?? ""}`;
  const kept = rows(list).filter((row) => `${row.to}|${row.body?.type}|${row.body?.taskId ?? row.body?.offerId ?? ""}` !== key && now - (row.at ?? 0) < LIMITS.outboxMs);
  return [...kept, { to: item.to, body: item.body, at: now }].slice(-LIMITS.outbox);
}

// -> { send: [items for PCs online now], keep: [the rest, expired ones dropped] }.
function outboxDue(list, online, now) {
  const send = [], keep = [];
  for (const row of rows(list)) {
    if (now - (row.at ?? 0) >= LIMITS.outboxMs) continue;
    (online.has(row.to) ? send : keep).push(row);
  }
  return { send, keep };
}

// The note a finished card sends home.
function doneNote(task) {
  const from = task?.fromPc;
  if (!object(from) || !TASK_ID.test(String(from.taskId ?? "")) || !PC_ID.test(String(from.id ?? ""))) return null;
  const outcome = task.status === "done" || (task.status === "archived" && (task.doneAt || task.verification?.state === "verified")) ? "done"
    : task.status === "archived" ? "dropped" : null;
  if (!outcome) return null;
  return { to: from.id, body: { type: "done", taskId: from.taskId, as: String(task.id), outcome, note: line(task.verification?.reason ?? task.result ?? "", 300) } };
}

module.exports = {
  LIMITS, STAY_ON, STAGES, RELATIONS, OUTCOMES, WHY, DECLINES,
  githubName, projectKey, isProjectKey, stateLine, cleanState, freeSlots, answering, whyNotTaking,
  strainedWhy, movable, cardOf, cleanCard, rankPeers, planOffers, takeOffer,
  cleanPeer, cleanPeers, addPeer, pcRows, outboxAdd, outboxDue, doneNote,
};
