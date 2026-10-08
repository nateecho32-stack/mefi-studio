// Social's own places (renderer/social.js): which pages stay in Social and which open in Studio, leaving for Studio
// without losing the page, the Friends card on Social's Home and the Projects page. A QA pass on 2026-10-06 found Social
// reading as a development dashboard with a social area attached; these are the pieces that keep it social. The real
// window is tests/today_render.test.mjs; renderer/nav.js asking studioOnly() is tests/vibe_frame.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createDom } from "./fixtures/renderer-dom.mjs";

const source = await readFile(new URL("../renderer/social.js", import.meta.url), "utf8");
const settle = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };

// What the page passes, as plain data (objects made inside the vm have another Object, so deepEqual would tell them apart).
const plain = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
function load({ mode = "vibe", bridge = {}, registry = {}, sessions = null, workspace = null, storage = new Map() } = {}) {
  const { document } = createDom();
  const lookup = document.getElementById;
  document.getElementById = (id) => lookup(id) ?? document.querySelector(`#${id}`);
  document.visibilityState = "visible";
  const create = document.createElement;
  document.createElement = (tag) => {
    const node = create(tag);
    node.style.setProperty ??= (key, value) => { node.style[key] = value; };
    node.focus = () => { document.activeElement = node; };
    Object.defineProperty(node, "isConnected", { get: () => document.body.contains(node), configurable: true });
    return node;
  };
  const docListeners = {};
  document.addEventListener = (type, fn) => { (docListeners[type] ??= []).push(fn); };
  document.removeEventListener = (type, fn) => { docListeners[type] = (docListeners[type] ?? []).filter((one) => one !== fn); };
  const timers = [];
  const goes = [], modes = [], toasts = [], registered = [], claimed = [], released = [];
  const state = { mode };
  const window = {
    addEventListener() {},
    MefiVibe: { mode: () => state.mode, setMode: (next, options) => { modes.push([next, plain(options)]); state.mode = next; return next; }, openPanel: (kind) => goes.push(["panel", kind]) },
    MefiNav: {
      get: (id) => registry[id] ?? null,
      go: (id, params) => { goes.push([id, plain(params ?? null)]); },
      register: (record) => registered.push(record), claim: (id) => claimed.push(id), release: (id) => released.push(id),
    },
    MefiToast: (text, kind) => toasts.push([text, kind]),
    MefiFriendsFront: { hubState: (hub) => ({ text: hub.error === "auth" ? "Your Discord sign-in has run out." : "Not connected." }) },
    ...(sessions ? { MefiSessions: sessions } : {}),
    ...(workspace ? { MefiWorkspace: workspace } : {}),
    mefiStudio: bridge,
  };
  // The page's clock, which a test moves on (the vm has its own Date, so the host's cannot be patched for it).
  const clock = { now: Date.now() };
  const context = vm.createContext({
    window, document, console,
    Date: class extends Date { static now() { return clock.now; } },
    localStorage: { getItem: (key) => storage.get(key) ?? null },
    setTimeout: (fn, ms) => { timers.push({ fn, ms, cancelled: false }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].cancelled = true; },
    requestAnimationFrame: (fn) => { fn(); return 1; },
  });
  vm.runInContext(source, context);
  return { window, document, social: window.MefiSocial, goes, modes, toasts, registered, claimed, released, timers, state, docListeners, clock };
}
const live = (timers) => timers.filter((timer) => !timer.cancelled);

test("Social keeps to its own pages: a Studio page or a session asked for from Social is Studio's; Home, Friends, Projects, Activity, the Inbox and Settings stay; in Studio nothing is", () => {
  const registry = {
    fleet: { id: "fleet", kind: "overlay", layer: "sheet" }, command: { id: "command", kind: "view", layer: null }, tasks: { id: "tasks", kind: "overlay", layer: "sheet" },
    agents: { id: "agents", kind: "overlay", layer: "sheet" }, trace: { id: "trace", kind: "overlay", layer: "sheet" }, worktrees: { id: "worktrees", kind: "overlay", layer: "sheet" },
    palette: { id: "palette", kind: "overlay", layer: "transient" }, "inbox-open": { id: "inbox-open", kind: "action", layer: null },
    "studio-api": { id: "studio-api", kind: "overlay", layer: "sheet", section: "settings" }, shortcuts: { id: "shortcuts", kind: "overlay", layer: "sheet", section: "help" },
  };
  const t = load({ registry });
  for (const id of ["fleet", "command", "tasks", "agents", "trace", "worktrees"]) assert.equal(t.social.studioOnly(id), true, `${id} is Studio's`);
  assert.equal(t.social.studioOnly("workspace", { view: "task", taskId: "t1" }), true, "a session is Studio's");
  assert.equal(t.social.studioOnly("workspace", {}), false, "Home is Social's own");
  for (const id of ["vibe", "friends-page", "inbox", "projects", "activity", "studio", "size", "setup-helper"]) assert.equal(t.social.studioOnly(id), false, `${id} stays in Social`);
  assert.equal(t.social.studioOnly("studio-api"), false, "a page of Settings stays, whatever it is called");
  assert.equal(t.social.studioOnly("shortcuts"), false, "and one of Help");
  assert.equal(t.social.studioOnly("palette"), false, "Search opens where you are");
  assert.equal(t.social.studioOnly("inbox-open"), false, "an action runs where you are");
  assert.equal(t.social.studioOnly("nothing-registered"), false);
  t.state.mode = "build";
  assert.equal(t.social.studioOnly("fleet"), false, "in Studio every page is at home");
});

test("leaving for Studio switches the mode under the page, says so once, and a task opens as its session there", () => {
  const opened = [];
  const t = load({ sessions: { active: () => true, open: (...args) => { opened.push(plain(args)); return true; } } });
  assert.equal(t.social.toStudio(), true);
  assert.deepEqual(t.modes, [["build", { go: false }]], "the page is kept: the mode changes without going Home");
  assert.equal(t.toasts.length, 1);
  assert.match(t.toasts[0][0], /Opened in Studio.*goes back/);
  assert.equal(t.social.toStudio(), false, "already in Studio: nothing to do");
  t.state.mode = "vibe";
  t.social.openInStudio("fleet", { pod: "p1" });
  assert.deepEqual(t.goes.at(-1), ["fleet", { pod: "p1" }]);
  assert.equal(t.toasts.length, 1, "the note is said once a session");
  t.state.mode = "vibe";
  assert.equal(t.social.openTask("t7", { tab: "changes" }), true);
  assert.equal(t.state.mode, "build");
  assert.deepEqual(opened.at(-1), ["t7", { preview: true, tab: "changes" }], "its session, on the tab asked for");
  const bare = load();
  bare.social.openTask("t9", { projectId: "p1" });
  assert.deepEqual(bare.goes.at(-1), ["tasks", { taskId: "t9", projectId: "p1", filter: "all" }], "without the session panels, Studio's board on that task");
});

test("the Friends card: nothing without the room service, one line and the way in when signed out, who is online with rooms and what was shared when ready", async () => {
  const none = load({ bridge: {} });
  const hidden = none.social.peopleCard();
  assert.equal(hidden.hidden, true, "no room service in this build: no card at all");
  // Signed out.
  const out = load({ bridge: { hubStatus: async () => ({ ok: true, status: { configured: true, linked: false } }), hubRoom: async () => ({ ok: true }) } });
  const card = out.social.peopleCard();
  out.document.body.append(card);
  await settle();
  assert.equal(card.dataset.state, "signed-out");
  assert.match(card.querySelector(".social-card-note").textContent, /See who's online/);
  const signIn = card.querySelector("#social-people-signin");
  assert.equal(signIn.textContent, "Sign in with Discord");
  await signIn.click();
  assert.deepEqual(out.goes.at(-1), ["friends-page", { place: "lobby" }], "The Lobby's own sign-in card does the asking");
  // Signed in and not connected yet: looking is the ask, once.
  let connects = 0;
  const state = { linked: true, configured: true, state: "off", error: null };
  const waiting = load({ bridge: { hubStatus: async () => ({ ok: true, status: { ...state } }), hubConnect: async () => { connects += 1; state.state = "ready"; state.front = true; }, hubRoom: async () => ({ ok: false }) } });
  const connecting = waiting.social.peopleCard();
  waiting.document.body.append(connecting);
  await settle(); await settle();
  assert.equal(connects, 1);
  assert.equal(connecting.dataset.state, "error", "connected, and the front page could not be read: it says so and tries again");
  assert.ok(live(waiting.timers).some((timer) => timer.ms === 300000), "in five minutes: Home is up most of the day, and each read is one request on the relay's budget");
  // Ready: who is online (not you), where they are, the rooms open now and what was shared.
  const front = {
    ok: true,
    online: { count: 3, people: [
      { id: "me", name: "You" },
      { id: "u1", name: "Maxwell", where: { id: "room_jam", name: "Friday jam" }, building: { project: "Pixel Forge" } },
      { id: "u2", name: "Jabilee", where: { id: "lobby", name: "Lobby" } },
      { id: "u3", name: "Rook Smith", where: null, building: { project: "Patch Notes Bot" } },
    ] },
    rooms: [{ id: "room_jam", name: "Friday jam", kind: "hangout", status: "active", you: "owner", memberCount: 4, here: 2 }, { id: "room_cw", name: "Cowork", kind: "cowork", status: "active", you: "none", memberCount: 2, here: 0 }],
    top: { id: "p1", title: "Pixel Forge", kind: "tool", owner: { name: "Maxwell" } },
    fresh: [{ id: "p1", title: "Pixel Forge", kind: "tool", owner: { name: "Maxwell" } }, { id: "p2", title: "Tiny Tides", kind: "game", owner: { name: "Tess" } }],
  };
  const ready = load({ bridge: { hubStatus: async () => ({ ok: true, status: { configured: true, linked: true, state: "ready", front: true, user: { id: "me" } } }), hubRoom: async (method) => (method === "front" ? front : { ok: true }) } });
  const people = ready.social.peopleCard();
  ready.document.body.append(people);
  await settle(); await settle();
  assert.equal(people.dataset.state, "ready");
  assert.equal(people.querySelector(".social-online").textContent.trim(), "3 online");
  const faces = people.querySelectorAll(".social-person");
  assert.deepEqual(faces.map((node) => node.dataset.person), ["u1", "u2", "u3"], "everyone online but you");
  assert.deepEqual(faces.map((node) => node.querySelector("small").textContent), ["In Friday jam", "In the Lobby", "Building Patch Notes Bot"]);
  assert.equal(faces[2].querySelector(".social-face").textContent, "RS");
  await faces[0].querySelector("button").click();
  assert.deepEqual(ready.goes.at(-1), ["friends-page", { place: "rooms", room: "room_jam" }], "a friend in a room opens that room");
  const rows = people.querySelectorAll(".social-row");
  assert.deepEqual(rows.map((row) => row.querySelector("b").textContent), ["Friday jam", "Cowork", "Pixel Forge", "Tiny Tides"], "the rooms open now, then what was shared, each once");
  assert.deepEqual(rows.slice(0, 2).map((row) => row.querySelector("button").textContent), ["Open", "Join"]);
  assert.equal(rows[0].querySelector("small").textContent, "Hangout · 2 here now");
  // It reads again in five minutes, sooner when the window comes back after a minute away, and stops when it leaves the page.
  assert.ok(live(ready.timers).some((timer) => timer.ms === 300000));
  for (const fn of ready.docListeners.visibilitychange ?? []) fn();
  assert.equal(live(ready.timers).some((timer) => timer.ms === 800), false, "the window coming back right away reads nothing new");
  people.dispose();
  assert.equal(live(ready.timers).length, 0, "nothing left ticking");
  assert.equal((ready.docListeners.visibilitychange ?? []).length, 0);
});

test("Projects lists your projects with the open one marked, and opening one goes through Home's own switch, then Home", async () => {
  const selected = [];
  let active = "p1";
  const workspace = { activeProjectId: () => active, selectProject: async (id) => { selected.push(id); active = id; } };
  const t = load({ workspace, bridge: { projectsList: async () => ({ ok: true, activeId: "p1", projects: [{ id: "p1", name: "Notes app", path: "C:/Users/me/Mefi Apps/Notes app" }, { id: "p2", name: "Second project", path: "C:/work/second" }] }) } });
  const record = t.registered.find((entry) => entry.id === "projects");
  assert.ok(record, "Projects is a page of the registry");
  assert.equal(record.kind, "overlay");
  assert.equal(record.element, "projects-overlay");
  assert.equal(record.open(), true);
  await settle();
  assert.deepEqual(t.claimed, ["projects"]);
  const rows = t.document.getElementById("projects-list").querySelectorAll(".social-project");
  assert.deepEqual(rows.map((row) => [row.dataset.project, row.querySelector("b").textContent, row.querySelector("small").textContent, row.querySelector("button").textContent]),
    [["p1", "Notes app", "…/Mefi Apps/Notes app", "Open now"], ["p2", "Second project", "…/work/second", "Open"]]);
  assert.equal(rows[0].dataset.current, "true");
  await rows[1].querySelector("button").click();
  await settle();
  assert.deepEqual(selected, ["p2"], "Home's own switch, which asks before it stops working agents");
  assert.deepEqual(t.goes.at(-1), ["vibe", null], "then Home, in the project just opened");
  await t.document.getElementById("projects-new-app").click();
  assert.deepEqual(t.goes.slice(-2), [["vibe", null], ["panel", "newapp"]], "New app is the front door's own panel");
  assert.equal(record.close(), true);
  assert.deepEqual(t.released, ["projects"]);
  assert.equal(record.close(), false, "closing what is closed is nothing");
});

test("two switches per device put Social back as it was: every page in Social's rail, and no Friends card", async () => {
  const registry = { fleet: { id: "fleet", kind: "overlay", layer: "sheet" } };
  const pages = load({ registry, storage: new Map([["mefiStudio.social.allPages", "on"]]) });
  assert.equal(pages.social.studioOnly("fleet"), false, "with the switch on, a Studio page opens inside Social again");
  assert.equal(pages.social.studioOnly("workspace", { view: "task" }), false);
  const card = load({ storage: new Map([["mefiStudio.social.friendsCard", "off"]]), bridge: { hubStatus: async () => ({ ok: true, status: { configured: true, linked: true, state: "ready" } }), hubRoom: async () => ({ ok: true }) } });
  const off = card.social.peopleCard();
  assert.equal(off.hidden, true);
  assert.equal(card.timers.length, 0, "and it asks the relay nothing");
});

test("the Friends card reads nothing while Social's Home is out of sight, and catches up when Home shows again", async () => {
  let reads = 0;
  const t = load({ bridge: { hubStatus: async () => { reads += 1; return { ok: true, status: { configured: true, linked: true, state: "ready", front: true, user: { id: "me" } } }; }, hubRoom: async () => ({ ok: true, online: { count: 1, people: [] }, rooms: [] }) } });
  const card = t.social.peopleCard();
  let shown = true;
  card.getClientRects = () => (shown ? [{}] : []);
  t.document.body.append(card);
  await settle(); await settle();
  assert.equal(reads, 1, "one read when it shows");
  // Studio is up: Home's layer is hidden, and the card with it.
  shown = false;
  const due = live(t.timers).find((timer) => timer.ms === 300000);
  due.cancelled = true; due.fn();
  await settle();
  assert.equal(reads, 1, "nothing is read for a card nobody can see");
  assert.ok(live(t.timers).some((timer) => timer.ms === 300000), "it looks again later");
  // Home again, a minute or more after the last read: renderer/today.js show() wakes it.
  shown = true;
  t.clock.now += 120000;
  card.wake();
  const soon = live(t.timers).find((timer) => timer.ms === 800);
  assert.ok(soon, "a read soon, not in five minutes");
  soon.cancelled = true; soon.fn();
  await settle(); await settle();
  assert.equal(reads, 2);
  card.dispose();
});
