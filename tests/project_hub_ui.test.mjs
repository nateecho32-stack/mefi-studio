import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// renderer/project-hub.js (Friends › Project hub) in a vm with a tiny DOM and
// a fake bridge: it explains itself until the room service carries projects,
// shows your rank, credits and progress, lists and maps projects with the
// actions each needs, shares through hub:projects only, and follows the
// credits frame. Then main.cjs's HUB_PROJECT_METHODS gate.

const source = await readFile(new URL("../renderer/project-hub.js", import.meta.url), "utf8");
const main = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const flush = async () => { for (let i = 0; i < 40; i += 1) await Promise.resolve(); };
const ME = { id: "123456789012345678", name: "Mefi" };
const FRIEND = { id: "223456789012345678", name: "Aksana" };

class Element {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attrs = {}; this.listeners = {}; this.style = {}; this.hidden = false; this.className = ""; this.text = ""; this.value = ""; this.selected = false; }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map((child) => child.textContent).join(""); }
  append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key] ?? null; }
  removeAttribute(key) { delete this.attrs[key]; }
  addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); }
  click() { for (const listener of this.listeners.click ?? []) listener({ type: "click" }); }
  submit() { for (const listener of this.listeners.submit ?? []) listener({ type: "submit", preventDefault() {} }); }
  all() { return [this, ...this.children.flatMap((child) => child.all?.() ?? [])]; }
  find(id) { return this.all().find((item) => item.id === id) ?? null; }
  buttons(label) { return this.all().filter((item) => item.tagName === "BUTTON" && item.textContent === label); }
  byClass(name) { return this.all().filter((item) => item.className.split(" ").includes(name)); }
}

const project = (overrides = {}) => ({ id: "proj_a", url: "https://aksana.itch.io/void", host: "aksana.itch.io", title: "Void Runner", blurb: "Jump the void", kind: "game", owner: { id: FRIEND.id, name: "Aksana", rank: "ember" }, plays: 4, stars: 2, createdAt: 1, lastPlayedAt: 2, featuredUntil: null, starred: false, ...overrides });
const me = (overrides = {}) => ({ ok: true, user: ME, credits: { balance: 42, lifetime: 120, today: 7, todayCap: 60 }, rank: { key: "ember", name: "Ember", next: { key: "flame", name: "Flame", at: 200 }, progress: 0.47 }, specialRanks: ["builder"], streak: { days: 3, best: 5 }, featureCost: 100, canEarn: true, projects: [], ...overrides });

function environment({ status = { configured: true, linked: true, state: "ready", user: ME, projects: true }, list = [project()], featured = [], replies = {}, bridge = true } = {}) {
  const calls = [];
  let hubEvent = null;
  const api = bridge ? {
    hubStatus: async () => ({ ok: true, status }),
    hubConnect: async () => { calls.push(["connect"]); status = { ...status, state: "ready" }; return { ok: true, status }; },
    onHubEvent: (fn) => { hubEvent = fn; },
    hubProjects: async (method, ...args) => {
      calls.push([method, ...args]);
      if (method === "me") return replies.me ?? me();
      if (method === "projects") return { ok: true, projects: list, featured };
      const reply = replies[method];
      return typeof reply === "function" ? reply(...args) : reply ?? { ok: true };
    },
  } : undefined;
  const window = { mefiStudio: api, confirm: () => true, devicePixelRatio: 1 };
  const context = vm.createContext({
    window, document: { createElement: (tag) => new Element(tag) }, Date, Number, Array, Set, Map, Promise, JSON, Object, String, Math,
    requestAnimationFrame: (fn) => fn(), getComputedStyle: () => ({ getPropertyValue: () => "" }),
  });
  vm.runInContext(source, context);
  return { hub: window.MefiProjectHub, calls, push: (event) => hubEvent(event) };
}

test("the hub explains itself until the room service carries projects", async () => {
  assert.equal(environment({ bridge: false }).hub.card().find("project-hub-status").textContent, "The project hub works in the desktop app.");
  const unlinked = environment({ status: { configured: true, linked: false } }).hub.card();
  await flush();
  assert.equal(unlinked.dataset.state, "not-linked");
  const old = environment({ status: { configured: true, linked: true, state: "ready", projects: false } }).hub.card();
  await flush();
  assert.equal(old.dataset.state, "unsupported");
  assert.equal(old.find("project-hub-status").textContent, "This room service has no project hub yet.");
  // Linked but not connected: opening the hub connects by itself, once.
  const off = environment({ status: { configured: true, linked: true, state: "off", projects: true } });
  const card = off.hub.card();
  await flush();
  assert.deepEqual(off.calls[0], ["connect"]);
  assert.equal(card.dataset.state, "ready");
  assert.equal(unlinked.find("project-hub-link").textContent, "Link Discord", "and linking starts right there");
});

test("your rank, credits, progress and special ranks; the map and the lists offer the actions each project needs", async () => {
  const env = environment({ list: [project(), project({ id: "proj_mine", title: "My Tool", kind: "tool", owner: { id: ME.id, name: "Mefi", rank: "ember" } })] });
  const card = env.hub.card();
  await flush();
  const head = card.byClass("project-hub-me")[0].textContent;
  assert.match(head, /Ember42 credits/);
  assert.match(head, /80 more to Flame · today 7\/60 · 3-day streak/);
  assert.match(head, /Builder/);
  assert.equal(card.byClass("project-hub-meter-fill")[0].style.width, "47%");
  assert.equal(card.byClass("project-hub-canvas").length, 1, "the Star map is the first view");
  assert.equal(card.byClass("project-hub-map-item").length, 2, "every star is also a button in the list under the map");
  card.byClass("project-hub-map-item")[0].click();
  await flush();
  const detail = card.byClass("project-hub-detail")[0];
  assert.equal(detail.buttons("Star").length, 1, "someone else's project can be starred");
  card.byClass("project-hub-map-item")[1].click();
  assert.equal(card.byClass("project-hub-detail")[0].buttons("Feature (100 credits)").length, 1, "your own can be featured");
  assert.equal(card.byClass("project-hub-detail")[0].buttons("Star").length, 0, "and never starred by you");

  card.find("project-hub-tab-top").click();
  await flush();
  assert.deepEqual(env.calls.filter(([method]) => method === "projects").at(-1), ["projects", "top"]);
  card.buttons("Play")[0].click();
  await flush();
  assert.deepEqual(env.calls.at(-1), ["playProject", "proj_a"]);
  assert.match(card.find("project-hub-status").textContent, /opened in your browser\. Play for 2 minutes and it counts for you both/);
});

test("sharing goes through hub:projects with the form's fields, and refusals say why", async () => {
  const env = environment({ replies: { shareProject: (fields) => (fields.url.includes("bit.ly") ? { ok: false, error: "bad-request", reason: "bad-link" } : { ok: true, credited: 0, project: project() }) } });
  const card = env.hub.card();
  await flush();
  card.find("project-hub-tab-share").click();
  await flush();
  const form = card.byClass("project-hub-share")[0];
  card.find("project-hub-url").value = "https://bit.ly/x";
  card.find("project-hub-name").value = "Thing";
  form.submit();
  await flush();
  assert.match(card.find("project-hub-status").textContent, /Short links and home-network addresses are not allowed/);
  card.find("project-hub-url").value = "https://me.itch.io/thing";
  card.find("project-hub-blurb").value = " A thing ";
  form.submit();
  await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(env.calls.filter(([method]) => method === "shareProject").at(-1))), ["shareProject", { url: "https://me.itch.io/thing", title: "Thing", blurb: "A thing", kind: "game" }]);
  assert.equal(card.find("project-hub-status").textContent, "Shared. When members play it for two minutes, you both earn credits.");
});

test("a credits frame updates the balance and says why", async () => {
  const env = environment();
  const card = env.hub.card();
  await flush();
  env.push({ type: "credits", balance: 47, lifetime: 125, today: 12, delta: 5, reason: "played", rank: "ember" });
  assert.equal(card.find("project-hub-status").textContent, "+5 credits: someone played your project.");
  env.push({ type: "played", projectId: "proj_a", counted: true, credited: { owner: 5, you: 2 } });
  assert.equal(card.find("project-hub-status").textContent, "Play counted: +2 credits for you.");
});

test("anyone can report someone else's project with a reason; a moderator can also take it off", async () => {
  const env = environment();
  const card = env.hub.card();
  await flush();
  card.find("project-hub-tab-new").click();
  await flush();
  const row = () => card.all().find((item) => item.dataset?.project === "proj_a");
  const buttons = (label) => row().buttons(label);
  assert.equal(buttons("Remove (moderator)").length, 0, "members see Report, not Remove");
  buttons("Report")[0].click();
  assert.equal(buttons("Cancel report").length, 1);
  buttons("Not safe to open")[0].click();
  await flush();
  assert.deepEqual(env.calls.find((call) => call[0] === "reportProject"), ["reportProject", "proj_a", "Not safe to open"]);
  assert.equal(card.find("project-hub-status").textContent, "Thanks. A moderator will look at it.");
  assert.equal(buttons("Report").length, 1, "the reasons close again");

  const mod = environment({ replies: { me: me({ moderator: true }) } });
  const modCard = mod.hub.card();
  await flush();
  modCard.find("project-hub-tab-new").click();
  await flush();
  const modRow = modCard.all().find((item) => item.dataset?.project === "proj_a");
  assert.equal(modRow.buttons("Remove (moderator)").length, 1);
});

test("credits on hold say why and until when; credits taken back say so", async () => {
  const until = Date.UTC(2026, 9, 12);
  const day = new Date(until).toLocaleDateString([], { day: "numeric", month: "long" });
  for (const [hold, words] of [
    [{ reason: "new-account", until }, `Credits start when your Discord account is 30 days old on ${day}. Until then, plays and stars you give count for no one.`],
    [{ reason: "new-member", until }, `Credits start a week after you joined the Void Engine server on ${day}.`],
    [{ reason: "forgot-me", until }, `Credits are paused for 30 days after Forget me, until ${day}.`],
    [{ reason: "read-only", until: null }, "Credits are paused while your account is read-only in the server."],
  ]) {
    const env = environment({ replies: { me: me({ canEarn: false, hold }) } });
    const card = env.hub.card();
    await flush();
    assert.equal(card.byClass("project-hub-hold")[0].textContent, words, hold.reason);
  }
  const env = environment();
  const card = env.hub.card();
  await flush();
  assert.equal(card.byClass("project-hub-hold").length, 0, "nothing to say when credits count");
  env.push({ type: "credits", balance: 40, lifetime: 40, today: 0, delta: -8, reason: "revoked", rank: "spark" });
  assert.equal(card.find("project-hub-status").textContent, "A moderator took back 8 credits that came from farming.");
});

test("main lets the renderer call only the hub's project methods, and plays only https links", () => {
  assert.match(main, /const HUB_PROJECT_METHODS = Object\.freeze\(\{ me: 0, memberCard: 1, projects: 1, shareProject: 1, removeProject: 1, playProject: 1, star: 2, feature: 1, reportProject: 2 \}\);/);
  assert.match(main, /ipcMain\.handle\("hub:projects", async \(_event, payload\) => hubProjects\(String\(payload\?\.method \?\? ""\), Array\.isArray\(payload\?\.args\) \? payload\.args : \[\]\)\);/);
  assert.match(main, /if \(link\?\.protocol !== "https:"\) return \{ ok: false, error: "bad-link" \};/);
  assert.ok(!/innerHTML/.test(source), "text only, never markup");
});
