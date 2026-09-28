import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// renderer/rooms.js (Friends › Rooms) in a vm with a tiny DOM and a fake hub
// bridge: it explains itself until the hub is configured, linked and
// connected; lists rooms with the one action each needs; asks to join,
// decides, answers invites and makes rooms through hub:room only; shows chat
// as text with @names; follows live frames; and puts invites and requests on
// the Friends badge. Then main.cjs's HUB_ROOM_METHODS gate.

const source = await readFile(new URL("../renderer/rooms.js", import.meta.url), "utf8");
const main = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const flush = async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); };
const ME = { id: "123456789012345678", name: "Mefi" };
const FRIEND = { id: "223456789012345678", name: "Aksana" };

class Element {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attrs = {}; this.listeners = {}; this.hidden = false; this.disabled = false; this.className = ""; this.text = ""; this.value = ""; this.checked = false; }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map((child) => child.textContent).join(""); }
  append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key] ?? null; }
  removeAttribute(key) { delete this.attrs[key]; }
  addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); }
  click() { for (const listener of this.listeners.click ?? []) listener({ type: "click" }); }
  all() { return [this, ...this.children.flatMap((child) => child.all?.() ?? [])]; }
  find(id) { return this.all().find((item) => item.id === id) ?? null; }
  buttons(label) { return this.all().filter((item) => item.tagName === "BUTTON" && item.textContent === label); }
  byClass(name) { return this.all().filter((item) => item.className.split(" ").includes(name)); }
}

const room = (overrides = {}) => ({ id: "room_mine", name: "Lo-fi corner", kind: "hangout", policy: "request", listed: true, status: "active", you: "owner", ownerId: ME.id, memberCount: 3, maxMembers: 25, ...overrides });
const message = (overrides = {}) => ({ id: "423456789012345678", author: { id: FRIEND.id, name: "Aksana", viaStudio: true }, text: "hey <@123456789012345678>", createdAt: Date.UTC(2026, 8, 27, 20), editedAt: null, mentions: [{ id: ME.id, name: "Mefi" }], attachments: [], ...overrides });

function environment({ status = { configured: true, linked: true, state: "ready", user: ME }, rooms = [], requests = [], invites = [], replies = {}, bridge = true, extra = {} } = {}) {
  const calls = [];
  let hubEvent = null;
  const api = bridge ? {
    hubStatus: async () => ({ ok: true, status }),
    hubConnect: async () => { calls.push(["connect"]); status = { ...status, state: "ready" }; return { ok: true, status }; },
    hubRooms: async () => ({ ok: true, rooms }),
    hubSubscribe: (id, on) => { calls.push(["subscribe", id, on]); },
    onHubEvent: (fn) => { hubEvent = fn; },
    hubRoom: async (method, ...args) => {
      calls.push([method, ...args]);
      if (method === "requests") return { ok: true, requests };
      if (method === "invites") return { ok: true, invites };
      const reply = replies[method];
      return typeof reply === "function" ? reply(...args) : reply ?? { ok: true };
    },
    ...extra,
  } : undefined;
  const window = { mefiStudio: api, confirm: () => true };
  const context = vm.createContext({ window, document: { createElement: (tag) => new Element(tag) }, Date, Number, Array, Set, Map, Promise, JSON, Object, String });
  vm.runInContext(source, context);
  return { rooms: window.MefiRooms, calls, push: (event) => hubEvent(event), setStatus: (next) => { status = next; } };
}

test("the panel explains itself until the hub is configured, linked and connected", async () => {
  const none = environment({ bridge: false }).rooms.panel();
  assert.equal(none.find("rooms-status").textContent, "Rooms work in the desktop app.");
  const unset = environment({ status: { configured: false } }).rooms.panel();
  await flush();
  assert.equal(unset.dataset.state, "not-configured");
  assert.match(unset.find("rooms-status").textContent, /not connected to yet: add its address in Settings › Community › Connection details/);
  const unlinked = environment({ status: { configured: true, linked: false } }).rooms.panel();
  await flush();
  assert.equal(unlinked.find("rooms-status").textContent, "Link your Discord account to use rooms.");
  assert.ok(unlinked.find("rooms-link"));
  const off = environment({ status: { configured: true, linked: true, state: "off" }, rooms: [room()] });
  const panel = off.rooms.panel();
  await flush();
  assert.equal(panel.dataset.state, "off");
  panel.find("rooms-connect").click();
  await flush();
  assert.deepEqual(off.calls[0], ["connect"]);
  assert.equal(panel.dataset.state, "ready");
  assert.equal(panel.byClass("rooms-row").length, 1);
});

test("each room offers the one action it needs, and invites and requests reach the badge", async () => {
  const env = environment({
    rooms: [room(), room({ id: "room_open", name: "Open jam", you: "none", ownerId: FRIEND.id }), room({ id: "room_inv", name: "Invite club", you: "invited", policy: "invite" }), room({ id: "room_req", name: "Asked", you: "requested", ownerId: FRIEND.id }), room({ id: "room_shut", status: "closed" })],
    requests: [{ id: "req_them", roomId: "room_mine", requester: FRIEND, note: "can I join?", status: "pending", createdAt: 1 }, { id: "req_me", roomId: "room_req", requester: ME, note: "", status: "pending", createdAt: 1 }],
    invites: [{ id: "inv_1", roomId: "room_inv", roomName: "Invite club", invitedBy: FRIEND, status: "pending", expiresAt: 9e12 }],
  });
  let notified = 0;
  env.rooms.subscribe(() => { notified += 1; });
  const panel = env.rooms.panel();
  await flush();
  const rows = panel.byClass("rooms-row").map((row) => [row.dataset.room, row.byClass("rooms-button").map((item) => item.textContent)]);
  assert.deepEqual(rows, [["room_mine", ["Open"]], ["room_open", ["Ask to join"]], ["room_inv", ["Accept invite", "Decline"]], ["room_req", ["Cancel"]]], "a closed room is not listed");
  assert.equal(env.rooms.pending(), 2, "one invite to answer and one request to decide");
  assert.ok(notified >= 1);
  assert.equal(panel.find("rooms-tab-requests").textContent, "Requests (1)");
  assert.equal(panel.find("rooms-tab-invites").textContent, "Invites (1)");
});

test("asking to join, deciding, answering invites and making a room go through hub:room", async () => {
  const env = environment({
    rooms: [room({ id: "room_open", name: "Open jam", you: "none", ownerId: FRIEND.id })],
    requests: [{ id: "req_them", roomId: "room_open", requester: FRIEND, note: "hi", status: "pending", createdAt: 1 }],
    invites: [{ id: "inv_1", roomId: "room_x", roomName: "X", invitedBy: FRIEND, status: "pending", expiresAt: 9e12 }],
    replies: {
      requestJoin: { ok: true, request: {} },
      createRoom: (fields) => (fields.name === "Nope" ? { ok: false, error: "forbidden", reason: "room-host-role" } : { ok: true, room: { name: fields.name } }),
    },
  });
  const panel = env.rooms.panel();
  await flush();
  panel.buttons("Ask to join")[0].click();
  const note = panel.byClass("rooms-note")[0];
  note.value = "love this music";
  panel.buttons("Send request")[0].click();
  await flush();
  assert.deepEqual(env.calls.find((call) => call[0] === "requestJoin"), ["requestJoin", "room_open", "love this music"]);
  assert.equal(panel.find("rooms-status").textContent, "Asked to join Open jam. The owner will decide.");
  panel.find("rooms-tab-requests").click();
  assert.match(panel.byClass("rooms-quote")[0].textContent, /^hi$/);
  panel.buttons("Let them in")[0].click();
  await flush();
  assert.deepEqual(env.calls.find((call) => call[0] === "decide"), ["decide", "req_them", "approve"]);
  panel.find("rooms-tab-invites").click();
  panel.buttons("Join")[0].click();
  await flush();
  assert.deepEqual(env.calls.find((call) => call[0] === "acceptInvite"), ["acceptInvite", "inv_1"]);
  panel.find("rooms-tab-rooms").click();
  panel.find("rooms-create-name").value = "  Night owls  ";
  panel.find("rooms-create-kind").value = "cowork";
  panel.find("rooms-create-policy").value = "invite";
  panel.find("rooms-create-listed").checked = false;
  panel.find("rooms-create").click();
  await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(env.calls.find((call) => call[0] === "createRoom"))), ["createRoom", { name: "Night owls", kind: "cowork", policy: "invite", listed: false }]);
  assert.equal(panel.find("rooms-status").textContent, "Night owls is ready.");
  panel.find("rooms-create-name").value = "Nope";
  panel.find("rooms-create").click();
  await flush();
  assert.equal(panel.find("rooms-status").textContent, "Creating rooms needs the Room Host role in the Void Engine server.", "the hub's reason in plain words");
});

test("a room shows chat as text with @names, follows live frames, and sends or says why not", async () => {
  const env = environment({
    rooms: [room()],
    replies: {
      messages: { ok: true, messages: [message(), message({ id: "523456789012345678", author: { id: ME.id, name: "Mefi", viaStudio: true }, text: "<img src=x onerror=alert(1)>" })], hasMore: true },
      sendMessage: (_id, text) => (text === "fail" ? { ok: false, reason: "rate-limited" } : { ok: true, messageId: "623456789012345678" }),
    },
  });
  const panel = env.rooms.panel();
  await flush();
  panel.buttons("Open")[0].click();
  await flush();
  assert.deepEqual(env.calls.find((call) => call[0] === "subscribe"), ["subscribe", "room_mine", true]);
  assert.equal(panel.dataset.view, "room");
  const texts = () => panel.byClass("rooms-message-text").map((item) => item.textContent);
  assert.deepEqual(texts(), ["hey @Mefi", "<img src=x onerror=alert(1)>"], "mentions read as names; markup stays text");
  assert.equal(panel.buttons("Load earlier").length, 1);
  assert.deepEqual(panel.byClass("rooms-message").map((item) => item.byClass("rooms-button").map((b) => b.textContent)), [["Report"], ["Delete"]]);
  env.push({ type: "message", roomId: "room_mine", message: message({ id: "723456789012345678", text: "new one" }) });
  env.push({ type: "message", roomId: "room_other", message: message({ id: "823456789012345678", text: "elsewhere" }) });
  env.push({ type: "messageDelete", roomId: "room_mine", messageId: "423456789012345678" });
  assert.deepEqual(texts(), ["<img src=x onerror=alert(1)>", "new one"]);
  const box = panel.find("rooms-compose");
  box.value = "fail";
  panel.find("rooms-send").click();
  await flush();
  assert.equal(panel.find("rooms-status").textContent, "Not sent: Slow down a moment, then try again.");
  assert.equal(box.value, "fail", "a message that did not go stays in the box");
  box.value = "hello friends";
  panel.find("rooms-send").click();
  await flush();
  assert.deepEqual(env.calls.filter((call) => call[0] === "sendMessage").at(-1), ["sendMessage", "room_mine", "hello friends"]);
  assert.equal(box.value, "");
  panel.find("rooms-back").click();
  await flush();
  assert.deepEqual(env.calls.filter((call) => call[0] === "subscribe").at(-1), ["subscribe", "room_mine", false]);
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|outerHTML/, "rooms.js never builds markup from strings");
});

test("main passes only the listed room methods, with no more arguments than each takes", async () => {
  const from = main.indexOf("const HUB_ROOM_METHODS");
  const to = main.indexOf("// ---- end of the rooms hub", from);
  assert.ok(from > 0 && to > from);
  const seen = [];
  const client = new Proxy({}, { get: (_target, method) => (...args) => { seen.push([method, ...args]); return { ok: true }; } });
  const context = vm.createContext({ Object, Array, Promise, hubCall: async (work) => work(client) });
  vm.runInContext(`${main.slice(from, to)}\nthis.hubRoom = hubRoom;`, context);
  assert.deepEqual({ ...(await context.hubRoom("constructor", [])) }, { ok: false, error: "bad-request" });
  assert.deepEqual({ ...(await context.hubRoom("toString", [])) }, { ok: false, error: "bad-request" });
  assert.deepEqual({ ...(await context.hubRoom("requests", ["extra"])) }, { ok: false, error: "bad-request" });
  await context.hubRoom("createRoom", [{ name: "x", kind: "hangout" }]);
  await context.hubRoom("sendMessage", ["room_a", () => "not data"]);
  assert.deepEqual(JSON.parse(JSON.stringify(seen)), [["createRoom", { name: "x", kind: "hangout" }], ["sendMessage", "room_a", null]]);
  assert.match(main, /ipcMain\.handle\("hub:room", async \(_event, payload\) => hubRoom\(String\(payload\?\.method \?\? ""\), Array\.isArray\(payload\?\.args\) \? payload\.args : \[\]\)\);/);
});

test("every room says moderators can read it; a cowork room offers to carry the open project's file claims", async () => {
  const links = [];
  let view = { ok: true, repo: "owner/app", roomId: null, leases: [] };
  const env = environment({
    rooms: [room({ id: "room_work", name: "Build crew", kind: "cowork" }), room()],
    replies: { messages: { ok: true, messages: [], hasMore: false } },
    extra: {
      coworkStatus: async () => view,
      coworkLink: async (roomId) => { links.push(roomId); view = { ...view, roomId, leases: roomId ? [{ title: "Refactor", paths: ["src/app.js", "src/b.js", "src/c.js", "src/d.js"], exclusive: true, here: false }, { title: "Fix login", paths: ["lib/u.js"], exclusive: true, here: true }] : [] }; return view; },
    },
  });
  const panel = env.rooms.panel();
  await flush();
  panel.all().find((item) => item.dataset?.room === "room_work")?.children.flatMap((child) => child.all?.() ?? [child]).find((item) => item.tagName === "BUTTON")?.click();
  await flush();
  assert.equal(panel.find("rooms-privacy").textContent, "Void Engine moderators can read every room.");
  const box = panel.find("rooms-cowork");
  assert.ok(box, "a cowork room shows its part in the open project");
  assert.match(box.textContent, /Let owner\/app's agents claim the files they edit here/);
  panel.find("rooms-cowork-link").click();
  await flush();
  assert.deepEqual(links, ["room_work"]);
  assert.match(box.textContent, /owner\/app's agents claim the files they edit here/);
  assert.deepEqual(panel.find("rooms-claims").children.map((row) => row.textContent), ["Another PC · Refactor · src/app.js, src/b.js, src/c.js +1 more", "This PC · Fix login · lib/u.js"]);
  env.push({ type: "claims", roomId: "room_work", leases: [] });
  await flush();
  panel.find("rooms-cowork-link").click();
  await flush();
  assert.deepEqual(links, ["room_work", null], "and can stop");
});
