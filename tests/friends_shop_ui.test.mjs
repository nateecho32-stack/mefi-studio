import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createDom } from "./fixtures/renderer-dom.mjs";
import { NODE_STYLES_SOURCE, recordingContext } from "./fixtures/node-styles-harness.mjs";

// renderer/friends-shop.js (the Shop, a page of its own: route "shop") in a vm
// with the shared fake DOM, a fake bridge (hubShop as main's hub:shop hands
// answers over) and recorders standing in for renderer/pets.js, effects.js and
// music.js: the page's views, the month's drop as a banner made from its own
// data, the Featured shelf, a card per item with its live preview, price and
// badges, a card's detail (Try, Buy, Get, Use, Report, Remove), Ember free
// with every Studio (a switch, never a price), Try for two minutes (one at a
// time, ended by Stop, the clock and leaving), Buy only after an explicit yes,
// a tip for the maker of a member's pack (never a Studio item's), every
// refusal in plain words (an item that rotated out too), Make a style (the
// relay's check, the contrast readout, Publish, Unlist, List again, how many
// times a pack was got), the signed-out showroom, a member's sale, the page
// and its kill switches, the owned cache, and the ways in.

const read = async (file) => (await readFile(new URL(file, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const source = await read("../renderer/friends-shop.js");
const styles = await read("../renderer/friends-shop.css");
const hubSource = await read("../renderer/companion-hub.js");
const navSource = await read("../renderer/nav.js");
const shellSource = await read("../renderer/shell.js");
const socialSource = await read("../renderer/social.js");
const builder = await read("../scripts/build-booklet.mjs");
const template = await read("../renderer/booklet.template.html");
const flush = async () => { for (let i = 0; i < 80; i += 1) await Promise.resolve(); };
const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const STORE = "mefiStudio.shop.v1";
const ME = "123456789012345678";
const NOVA = { id: "200000000000000001", name: "Nova" };
const DAY = 86_400_000;
const SYNTHWAVE = { v: 1, palette: { accent: "#ff4fa3", accent2: "#8b5cff", background: "#0d0b1f", surface: "#17132e", text: "#f3ecff" }, nodeStyle: "halo", material: "atmosphere", font: "display" };
const NIGHT = { v: 1, palette: { accent: "#ffb347", accent2: "#7f5af0", background: "#101014", surface: "#1b1b22", text: "#f4f1ea" }, nodeStyle: "glass", material: "studio", font: "studio" };
const PAPER = { v: 1, palette: { accent: "#9b3d12", background: "#fbf6ee", surface: "#ffffff", text: "#2b2118" }, nodeStyle: "minimal", material: "focus", font: "serif" };
const studioItem = (id, kind, name, price, extra = {}) => ({ id, kind, name, blurb: "", price, requires: null, maker: null, data: null, sales: 0, owned: false, status: "listed", createdAt: 1, updatedAt: 1, drop: null, available: true, leaves: null, ...extra });
// The month's drop, as the relay lists it: on sale for twenty days more, with two of the catalog's items in it.
const LEAVES = new Date(Date.now() + 20 * DAY + 3_600_000).toISOString();
const IN_DROP = { drop: "2026-10", leaves: LEAVES };
// The relay's Studio catalog: Ember the dragon is not in it (free with every Studio); its scales are sold on their own.
const CATALOG = [
  studioItem("studio:skin-frost", "skin", "Frost scales", 40, { blurb: "Ember in icy blue." }),
  studioItem("studio:skin-void", "skin", "Void scales", 60, { blurb: "Ember in black with a violet glow.", ...IN_DROP }),
  studioItem("studio:fx-dissolve", "effect", "Dissolve", 60, { blurb: "Menus crumble into pixels when they close." }),
  studioItem("studio:fx-embers", "effect", "Burn away", 90, { blurb: "Menus burn away from the edges with glowing embers.", ...IN_DROP }),
  studioItem("studio:style-dragonscale", "nodestyle", "Dragon scales", 80, { blurb: "Nodes covered in shimmering dragon scales, with ember sparks along the wires." }),
  studioItem("studio:style-constellation", "nodestyle", "Star chart", 80, { blurb: "Nodes as bright stars joined by star-chart lines, with shooting stars." }),
  studioItem("studio:pack-synthwave", "pack", "Synthwave", 50, { blurb: "Hot pink and violet on midnight blue.", data: SYNTHWAVE }),
];
const DROPS = {
  current: { id: "2026-10", name: "Haunted Hollow", blurb: "Pumpkins, lanterns and friendly spirits for October.", from: "2026-10-01T00:00:00Z", until: LEAVES, colors: { accent: "#ff8a3d", accent2: "#9b6bff", background: "#140d1c" }, items: ["studio:skin-void", "studio:fx-embers"] },
  next: { id: "2026-11", name: "Frost Fair", blurb: "Ice lanterns.", from: LEAVES, until: new Date(Date.parse(LEAVES) + 30 * DAY).toISOString(), colors: { accent: "#7fd3ff", accent2: "#c3a6ff", background: "#0b1622" } },
  last: null,
};
const ROTATION = { drops: DROPS, featured: ["studio:skin-frost", "studio:fx-dissolve", "studio:style-dragonscale", "studio:pack-synthwave"], featuredUntil: new Date(Date.now() + 3 * DAY + 3_600_000).toISOString() };
const EMBER = "studio:pet-dragon";
const MEMBER_PACKS = [
  studioItem("pack_nightmarket0001", "pack", "Night market", 30, { blurb: "Neon on wet streets.", maker: NOVA, data: NIGHT, sales: 12 }),
  studioItem("pack_paper000000001", "pack", "Paper", 0, { maker: NOVA, data: PAPER, sales: 3 }),
];
const MINE = [
  studioItem("pack_mine0000000001", "pack", "Tide pool", 40, { maker: { id: ME, name: "Mefi" }, data: NIGHT, sales: 5, earned: 120, owned: true }),
  studioItem("pack_mine0000000002", "pack", "Old paper", 0, { maker: { id: ME, name: "Mefi" }, data: PAPER, sales: 1, status: "unlisted", owned: true }),
];

// painters: renderer/node-styles.js loads into the page and every canvas records what it is asked to draw
// (canvas._ctx); frames: requestAnimationFrame and an IntersectionObserver that sees every live part, with env.frame(ms)
// running the frame that is due.
function environment({ hub = { configured: true, linked: true, state: "ready", user: { id: ME } }, views = {}, answers = {}, storage = new Map(), throwing = false, modules = { pets: true, effects: true, music: true }, moderator = false, motion = "on", hubShop = true, owned = [], before = null, painters = false, frames = false, popups = null } = {}) {
  const dom = createDom();
  const { document } = dom;
  const create = document.createElement;
  document.createElement = (tag) => {
    const el = create(tag);
    el.style.setProperty = (key, value) => { el.style[key] = String(value); };
    el.style.removeProperty = (key) => { delete el.style[key]; };
    if (painters && tag === "canvas") el.getContext = () => (el._ctx ??= recordingContext({ center: { x: 180, y: 90 } }));
    return el;
  };
  document.createElementNS = (_namespace, tag) => document.createElement(tag);
  dom.documentElement.dataset.motion = motion;
  before?.(document);
  const calls = [], shown = [], went = [], fired = [], timers = [], registered = [], claimed = [], released = [], signIns = [];
  let hear = null;
  // The relay: views by name, purchases that land in what you own, and refusals given per method.
  const relay = { owned: clone(owned) };
  const replies = {
    studio: { ok: true, items: CATALOG, next: null, balance: 240, canEarn: true, hold: null, ...ROTATION },
    new: { ok: true, items: MEMBER_PACKS, next: null, balance: 240, canEarn: true, hold: null, ...ROTATION },
    top: { ok: true, items: [...MEMBER_PACKS].reverse(), next: null, balance: 240, canEarn: true, hold: null, ...ROTATION },
    owned: { ok: true, items: [], next: null, balance: 240, canEarn: true, hold: null, ...ROTATION },
    mine: { ok: true, items: MINE, next: null, balance: 240, canEarn: true, hold: null, ...ROTATION },
    ...views,
  };
  const api = {
    hubStatus: async () => ({ ok: true, status: clone(hub) }),
    hubConnect: async () => ({ ok: true }),
    onHubEvent: (fn) => { hear = fn; },
  };
  if (hubShop) {
    api.hubShop = async (method, ...args) => {
      calls.push([method, ...clone(args)]);
      if (method === "shop") return clone(replies[args[0]] ?? { ok: true, items: [] });
      if (method === "shopOwned") return clone(answers.shopOwned ?? { ok: true, items: relay.owned });
      // main's own copy of the catalog for the showroom (main.cjs hubShopCatalog): no relay asked.
      if (method === "shopCatalog") return clone(answers.shopCatalog ?? { ok: true, local: true, view: "studio", items: CATALOG, next: null, ...ROTATION });
      const answer = typeof answers[method] === "function" ? answers[method](...clone(args)) : answers[method];
      // A purchase (or a refusal that says you own it already) is in what the relay says you own from then on.
      // hub-client's shopBuy answers { ok, item, paid, balance }.
      if (method === "shopBuy" && (!answer || answer.error === "owned")) {
        const item = [...CATALOG, ...MEMBER_PACKS].find((entry) => entry.id === args[0]);
        if (item) relay.owned.push({ id: item.id, kind: item.kind, name: item.name, data: item.data, updatedAt: 5 });
        const paid = args[1] + (args[2] ?? 0);
        if (!answer) return { ok: true, item: clone({ ...item, owned: true }), paid, balance: 240 - paid };
      }
      return clone(answer ?? { ok: true });
    };
  }
  const pet = { on: false, kind: "dragon", skin: "theme", name: "Ember" };
  let effect = "none", applied = null;
  const window = {
    mefiStudio: api,
    MefiNav: { go: (...args) => went.push(clone(args)), register: (dest) => registered.push(dest), claim: (id) => claimed.push(id), release: (id) => released.push(id) },
    MefiFriendsMod: { isMod: () => moderator, subscribe: () => {} },
    // Friends' sign-in card, with its own Sign in with Discord (renderer/friends-front.js gate()), which records its presses.
    MefiFriendsFront: {
      gate: () => {
        const el = document.createElement("section"); el.id = "friends-gate"; el.className = "friends-gate";
        const signIn = document.createElement("button"); signIn.id = "friends-gate-signin"; signIn.textContent = "Sign in with Discord";
        signIn.addEventListener("click", () => signIns.push("signin"));
        el.append(signIn);
        return el;
      },
      ...(popups ? { popups } : {}),
    },
    addEventListener: () => {},
    dispatchEvent: (event) => { fired.push(event.type); return true; },
  };
  if (modules.pets) window.MefiPets = {
    kinds: () => [{ id: "dragon", item: "studio:pet-dragon", name: "Ember" }],
    skins: () => [{ id: "theme", item: null, name: "Your theme's colours" }, { id: "frost", item: "studio:skin-frost", name: "Frost scales" }],
    state: () => ({ ...pet }),
    set: (patch) => { shown.push(["pets.set", clone(patch)]); Object.assign(pet, patch); },
    preview: (options, ms) => shown.push(["pets.preview", clone(options), ms]),
    endPreview: () => shown.push(["pets.endPreview"]),
    paintPreview: (_canvas, options) => shown.push(["pets.paint", options.kind, options.skin, options.size ?? null, options.time]),
  };
  if (modules.effects) window.MefiEffects = {
    list: () => [{ id: "dissolve", item: "studio:fx-dissolve", name: "Dissolve" }],
    current: () => effect,
    use: (id) => { shown.push(["effects.use", id]); effect = id; },
    preview: (id, ms) => shown.push(["effects.preview", id, ms]),
    endPreview: () => shown.push(["effects.endPreview"]),
    demo: (element, id) => shown.push(["effects.demo", id, element?.className ?? null]),
  };
  // music.js wears a Shop node style only once MefiShop owns it (as renderer/music.js applyNodeStyle does).
  let wornStyle = "orbs";
  const SHOP_STYLES = [["dragonscale", "studio:style-dragonscale", "Dragon scales"], ["constellation", "studio:style-constellation", "Star chart"], ["lantern", "studio:style-lantern", "Lanterns"], ["neon", "studio:style-neon", "Neon"]];
  if (modules.music) window.MefiMusic = {
    applyPack: (data, save) => { shown.push(["music.applyPack", clone(data), save]); applied = clone(data); },
    previewPack: (data) => shown.push(["music.previewPack", clone(data)]),
    endPreview: () => shown.push(["music.endPreview"]),
    packInfo: () => applied,
    nodeStyles: () => [{ key: "halo", name: "Halo" }],
    shopStyles: () => SHOP_STYLES.map(([key, item, name]) => ({ key, item, name, detail: "", owned: window.MefiShop.owns(item) })),
    previewNodeStyle: (key) => { shown.push(["music.previewNodeStyle", key]); return SHOP_STYLES.some(([style]) => style === key); },
    applyNodeStyle: (key, save) => {
      shown.push(["music.applyNodeStyle", key, save]);
      const entry = SHOP_STYLES.find(([style]) => style === key);
      if (!entry || window.MefiShop.owns(entry[1])) wornStyle = key;
      return wornStyle;
    },
    nodeStyle: () => wornStyle,
    themePalette: () => ({ canvas: { background: "#050507", text: "#ece5d8", muted: "#a4a9b2", bright: "#eef1f5", accent2: "#36d1ff" } }),
  };
  const localStorage = throwing
    ? { getItem() { throw new Error("storage refused"); }, setItem() { throw new Error("storage refused"); } }
    : { getItem: (key) => (storage.has(key) ? storage.get(key) : null), setItem: (key, value) => { storage.set(key, String(value)); } };
  const timer = (fn, ms) => { timers.push({ fn, ms, live: true }); return timers.length; };
  const stop = (id) => { if (timers[id - 1]) timers[id - 1].live = false; };
  const rafs = new Map();
  let rafId = 0;
  const context = vm.createContext({
    window, document, localStorage, console,
    setTimeout: timer, clearTimeout: stop, setInterval: timer, clearInterval: stop,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    ...(frames ? {
      requestAnimationFrame: (fn) => { rafs.set(++rafId, fn); return rafId; },
      cancelAnimationFrame: (id) => { rafs.delete(id); },
      IntersectionObserver: class { constructor(callback) { this.callback = callback; } observe(target) { this.callback([{ target, isIntersecting: true }]); } unobserve() {} },
    } : {}),
  });
  if (painters) vm.runInContext(NODE_STYLES_SOURCE, context);
  vm.runInContext(source, context);
  return {
    window, document, shop: window.MefiShop, calls, shown, went, fired, storage, relay, pet, registered, claimed, released, signIns,
    hear: (event) => hear?.(event),
    // Runs the animation frame that is due, at `ms`.
    frame: (ms) => { const due = [...rafs.values()]; rafs.clear(); for (const fn of due) fn(ms); },
    // Runs the live timers of one length (a try's two minutes, its one-second clock).
    elapse: (ms) => { for (const entry of timers.filter((item) => item.live && item.ms === ms)) { entry.live = ms === 1000; entry.fn(); } },
    // The try's two minutes and its one-second clock (an effect's little menu waits on its own timer).
    tryTimers: () => timers.filter((item) => item.live && (item.ms === 1000 || item.ms === 120000)).length,
  };
}

// The first card for an item (a scope narrows it: "featured", "drop", "home", "packs", "owned", a category's view).
const item = (card, id, scope = null) => card.querySelectorAll("article").find((el) => el.dataset.item === id && (!scope || el.querySelector(".friends-shop-open")?.id.startsWith(`friends-shop-open-${scope}-`))) ?? null;
const buttons = (el, label) => el.querySelectorAll("button").filter((control) => control.textContent === label);
const one = (el, label) => { const found = buttons(el, label); assert.equal(found.length, 1, `one "${label}" button (${found.length})`); return found[0]; };
const status = (card) => card.querySelector("#friends-shop-status").textContent;
const banner = (card) => card.querySelector("#friends-shop-try");
const detailOf = (card) => card.querySelector("#friends-shop-detail");
// Opens an item's detail from its card (the card's name is its button) and hands the dialog back.
async function detail(card, id, scope = null) {
  const box = item(card, id, scope);
  assert.ok(box, `a card for ${id}`);
  await box.querySelector(".friends-shop-open").click();
  await flush();
  const dialog = detailOf(card);
  assert.equal(dialog.open, true, `${id}'s detail opened`);
  assert.equal(dialog.dataset.item, id);
  return dialog;
}
const said = (card) => card.querySelector("#friends-shop-detail-status")?.textContent ?? null;
async function open(env, view = null) {
  if (view) env.shop.open(view);
  const card = env.shop.card();
  await flush();
  return card;
}
async function showView(card, label) { await one(card.querySelector("#friends-shop-views"), label).click(); await flush(); }
const shopCalls = (env, method) => env.calls.filter(([name]) => name === method);
// The last thing a module was asked to do (every repaint also draws the pets' still frames).
const acted = (env) => env.shown.filter(([what]) => what !== "pets.paint").at(-1);

test("Home: the month's drop as a banner made from its own data, its pieces, the next drop, the Featured shelf and every category, a clean card per item, and your balance", async () => {
  const env = environment();
  const card = await open(env);
  assert.equal(card.dataset.state, "ready");
  assert.deepEqual(shopCalls(env, "shop"), [["shop", "studio"]]);
  assert.equal(card.querySelector("#friends-shop-title").textContent, "Shop");
  assert.equal(card.querySelector("#friends-shop-balance").textContent, "240 credits");
  assert.equal(card.querySelector("#friends-shop-balance").hidden, false);
  await one(card, "How to earn credits").click();
  assert.deepEqual(env.went.at(-1), ["friends-page", { place: "events" }], "how to earn credits is Friends › Events");
  assert.deepEqual(card.querySelectorAll('[role="tab"]').map((tab) => [tab.textContent, tab.getAttribute("aria-selected")]), [["Home", "true"], ["Pets", "false"], ["Menu effects", "false"], ["Node styles", "false"], ["Themes", "false"], ["Community", "false"], ["Owned", "false"], ["Make a style", "false"]]);
  // The banner: the drop's colours as custom properties, a text colour that reads on them, its month and time left.
  const hero = card.querySelector("#friends-shop-hero");
  assert.ok(hero, "the drop's banner");
  assert.deepEqual([hero.style["--drop-accent"], hero.style["--drop-accent2"], hero.style["--drop-bg"], hero.style["--drop-ink"]], ["#ff8a3d", "#9b6bff", "#140d1c", "#ffffff"]);
  assert.match(card.querySelector(".friends-shop-hero-kicker").textContent, /^October drop · Leaves in 20 days$/);
  assert.equal(card.querySelector("#friends-shop-hero-name").textContent, "Haunted Hollow");
  assert.equal(card.querySelector(".friends-shop-hero-note").textContent, "2 pieces for this month only. Everyone who gets one keeps it.");
  // Its pieces live inside it: the scales flying in the big tile first, then the effect playing by itself.
  assert.deepEqual(card.querySelectorAll(".friends-shop-hero-tile").map((tile) => tile.dataset.kind), ["skin", "effect"]);
  assert.equal(card.querySelector(".friends-shop-hero-stage").getAttribute("aria-hidden"), "true", "the pieces are its picture; their cards are below");
  assert.equal(card.querySelector(".friends-shop-hero-tile canvas").dataset.size, "big");
  assert.deepEqual(card.querySelector("#friends-shop-group-drop").querySelectorAll("article").map((el) => el.dataset.item), ["studio:skin-void", "studio:fx-embers"], "the drop's items as cards under it");
  assert.match(card.querySelector("#friends-shop-group-drop").textContent, /^In Haunted HollowOn sale until /);
  assert.equal(card.querySelector("#friends-shop-teaser").textContent, "Next drop: Frost Fair, in 20 days.", "the next drop, a teaser without its items, said as a time from now (a UTC midnight is the evening before in the Americas)");
  const featured = card.querySelector("#friends-shop-group-featured");
  assert.deepEqual(featured.querySelectorAll("article").map((el) => el.dataset.item), ROTATION.featured);
  assert.match(featured.textContent, /^Featured this weekNew picks in 3 days\./);
  assert.deepEqual(["pets", "effects", "nodestyles", "themes"].map((key) => card.querySelector(`#friends-shop-group-home-${key}-title`)?.textContent), ["Pets", "Menu effects", "Node styles", "Themes"]);
  assert.equal(card.querySelector("#friends-shop-group-home-pets").querySelectorAll("article")[0].dataset.item, EMBER, "Ember comes first among the pets");
  // A card: its live preview, its badges, its name as the one button, and its price. Nothing else to press.
  const frost = item(card, "studio:skin-frost", "home");
  assert.equal(frost.querySelector("canvas.friends-shop-pet").dataset.skin, "frost", "scales are shown on Ember, flying on a canvas");
  assert.ok(env.shown.some(([what, kind, skin]) => what === "pets.paint" && kind === "dragon" && skin === "frost"), "MefiPets.paintPreview drew it");
  assert.equal(frost.textContent, "Frost scales40 credits");
  assert.deepEqual(frost.querySelectorAll("button").map((control) => [control.textContent, control.getAttribute("aria-haspopup")]), [["Frost scales", "dialog"]]);
  assert.equal(frost.getAttribute("aria-labelledby"), frost.querySelector("button").id, "the card is named by its item");
  const voidScales = item(card, "studio:skin-void", "drop");
  assert.deepEqual(voidScales.querySelectorAll(".friends-shop-badge").map((badge) => badge.textContent), ["New"], "a drop's own item is new");
  assert.equal(frost.querySelector(".friends-shop-badges"), null, "a classic item carries no badge");
  const dissolve = item(card, "studio:fx-dissolve", "home");
  assert.ok(dissolve.querySelector(".friends-shop-menu"), "an effect has a little menu to play on");
  await dissolve.trigger("pointerenter");
  assert.deepEqual(env.shown.find(([what]) => what === "effects.demo"), ["effects.demo", "dissolve", "friends-shop-menu"], "pointing at it plays the effect on its menu");
  const mock = item(card, "studio:pack-synthwave", "home").querySelector(".friends-shop-mock");
  assert.equal(mock.getAttribute("aria-hidden"), "true");
  assert.deepEqual([mock.style["--pack-accent"], mock.style["--pack-bg"], mock.style["--pack-text"]], ["#ff4fa3", "#0d0b1f", "#f3ecff"]);
  assert.deepEqual([mock.dataset.nodeStyle, mock.dataset.material, mock.dataset.font], ["halo", "atmosphere", "display"]);
  assert.ok(mock.querySelectorAll(".friends-shop-mock-orb").length === 2 && mock.querySelector(".friends-shop-mock-side") && mock.querySelector(".friends-shop-mock-rail") && mock.querySelector(".friends-shop-mock-button"), "a title bar, a rail, a list, two node orbs and a button: it reads like Studio");
  // The category views show one category each, from the same read of the list.
  await showView(card, "Node styles");
  assert.deepEqual(card.querySelector("#friends-shop-group-nodestyles").querySelectorAll("article").map((el) => el.dataset.item), ["studio:style-dragonscale", "studio:style-constellation"]);
  await showView(card, "Pets");
  assert.deepEqual(card.querySelector("#friends-shop-group-pets").querySelectorAll("article").map((el) => el.dataset.item), [EMBER, "studio:skin-frost", "studio:skin-void"]);
  assert.deepEqual(shopCalls(env, "shop"), [["shop", "studio"]], "Studio's categories share one read");
});

test("a detail is a dialog with a large live preview, what the item is, Try for 2 minutes and Buy; Esc and the close button put it away", async () => {
  const env = environment();
  const card = await open(env);
  const dialog = await detail(card, "studio:skin-void", "drop");
  assert.match(dialog.querySelector(".friends-shop-detail-kicker").textContent, /^Pets · Haunted Hollow$/);
  assert.equal(dialog.querySelector("#friends-shop-detail-name").textContent, "Void scales");
  assert.match(dialog.textContent, /by Mefi StudioEmber in black with a violet glow\.60 creditsLeaves in 20 days/);
  const canvas = dialog.querySelector("canvas.friends-shop-pet");
  assert.equal(canvas.dataset.size, "big", "the detail's preview is the big one");
  assert.deepEqual(dialog.querySelectorAll(".friends-shop-actions button").map((control) => control.textContent), ["Try for 2 minutes", "Buy for 60"]);
  await dialog.trigger("keydown", { key: "Escape" });
  assert.equal(dialog.open, false, "Esc closes it");
  assert.equal(dialog.children.length, 0);
  const again = await detail(card, "studio:fx-embers", "drop");
  assert.ok(env.shown.some(([what, id]) => what === "effects.demo" && id === "embers") || again.querySelector(".friends-shop-stage")?.dataset.size === "big", "an effect's big menu plays by itself while it shows");
  await one(again, "×").click();
  assert.equal(again.open, false, "the close button closes it");
  await (await detail(card, "studio:skin-frost", "home")).trigger("click", { target: detailOf(card) });
  assert.equal(detailOf(card).open, false, "a press on the dimmed page around it closes it");
});

test("Ember the dragon is free with every Studio: no price, Try or Buy, just a switch in its detail", async () => {
  const env = environment({ views: { studio: { ok: true, items: [studioItem(EMBER, "pet", "Ember the dragon", 150), ...CATALOG], next: null, balance: 240, canEarn: true, hold: null, ...ROTATION } } });
  const card = await open(env);
  assert.equal(card.querySelectorAll("article").filter((el) => el.dataset.item === EMBER).length, 1, "a relay that still lists Ember shows it once, as Studio's gift");
  const ember = item(card, EMBER);
  assert.equal(ember.textContent, "Ember the dragonFree");
  assert.ok(ember.querySelector("canvas.friends-shop-pet"), "Ember flies on its card");
  assert.ok(env.shown.some(([what, kind, skin]) => what === "pets.paint" && kind === "dragon" && skin === "theme"));
  const dialog = await detail(card, EMBER);
  assert.match(dialog.textContent, /Ember the dragonFree with every StudioA little dragon that flies around your studio/);
  assert.equal(buttons(dialog, "Try for 2 minutes").length + dialog.querySelectorAll("button").filter((control) => /^Buy/.test(control.textContent)).length, 0, "nothing to try or buy");
  assert.equal(env.shop.owns(EMBER), true, "everyone owns Ember");
  const toggle = () => card.querySelector("#friends-shop-ember-switch");
  assert.equal(toggle().getAttribute("role"), "switch");
  assert.equal(toggle().getAttribute("aria-checked"), "false");
  assert.match(toggle().textContent, /Show EmberOff/);
  await toggle().click();
  assert.deepEqual(acted(env), ["pets.set", { on: true, kind: "dragon" }], "the switch is MefiPets.set({ on }), and On is Ember");
  assert.equal(toggle().getAttribute("aria-checked"), "true");
  assert.match(toggle().textContent, /Show EmberOn/);
  assert.equal(status(card), "Ember is out. Look for it around your studio.");
  assert.equal(said(card), "Ember is out. Look for it around your studio.", "the detail says it too, over the page");
  assert.deepEqual(item(card, EMBER).querySelectorAll(".friends-shop-badge").map((badge) => badge.textContent), ["In use"], "its card says it is out");
  await toggle().click();
  assert.deepEqual(acted(env), ["pets.set", { on: false }]);
  assert.equal(status(card), "Ember is resting.");
  assert.equal(shopCalls(env, "shopBuy").length, 0);
});

test("a pet from the Shop: its card flies it, Try borrows it, Use lets it out, and Ember's switch says Ember rests meanwhile", async () => {
  const cloud = studioItem("studio:pet-cloud", "pet", "Cloud dragon", 120, { blurb: "A long, wingless dragon that swims through the air in waves." });
  const env = environment({ views: { studio: { ok: true, items: [cloud, ...CATALOG], next: null, balance: 240, canEarn: true, hold: null, ...ROTATION } } });
  let card = await open(env);
  assert.equal(item(card, "studio:pet-cloud").querySelector("canvas").dataset.kind, "cloud", "the card flies the cloud dragon");
  assert.ok(env.shown.some(([what, kind]) => what === "pets.paint" && kind === "cloud"));
  const look = await detail(card, "studio:pet-cloud");
  assert.match(look.textContent, /A long, wingless dragon that swims through the air in waves\./);
  await one(look, "Try for 2 minutes").click();
  assert.deepEqual(env.shown.find(([what]) => what === "pets.preview"), ["pets.preview", { kind: "cloud", skin: "theme" }, 120000], "a Try borrows it");
  await one(banner(card), "Stop").click();
  // Owned, it is put to use; Ember's own switch then reads Off, and On brings Ember back.
  const owned = environment({ owned: [{ id: "studio:pet-cloud", kind: "pet", name: "Cloud dragon", data: null, updatedAt: 1 }], views: { studio: { ok: true, items: [{ ...cloud, owned: true }, ...CATALOG], next: null, balance: 240, canEarn: true, hold: null, ...ROTATION } } });
  card = await open(owned);
  await one(await detail(card, "studio:pet-cloud"), "Use").click();
  assert.deepEqual(acted(owned), ["pets.set", { on: true, kind: "cloud" }]);
  card = await open(owned);
  const toggle = (await detail(card, EMBER)).querySelector("#friends-shop-ember-switch");
  assert.equal(toggle.getAttribute("aria-checked"), "false", "the cloud dragon is out, so Ember is resting");
  await toggle.click();
  assert.deepEqual(acted(owned), ["pets.set", { on: true, kind: "dragon" }]);
});

test("a pet's card flies on seconds: the frame at 5 s draws it at 5, and a still frame at 0", async () => {
  const env = environment({ frames: true });
  await open(env);
  env.frame(5000);
  const times = env.shown.filter(([what]) => what === "pets.paint").map((entry) => entry[4]);
  assert.ok(times.includes(0), "the still frame each card starts with");
  assert.ok(times.includes(5), `the 5000 ms frame draws time 5 (${times.join(", ")})`);
  assert.ok(times.every((time) => time < 100), "never milliseconds, which spun the pet round its loop many times a frame");
});

test("motion off: a pet is one still frame; nothing plays on hover", async () => {
  const env = environment({ motion: "off" });
  const card = await open(env);
  assert.ok(env.shown.some(([what]) => what === "pets.paint"));
  await item(card, "studio:fx-dissolve").trigger("pointerenter");
  assert.equal(env.shown.some(([what]) => what === "effects.demo"), false);
});

test("Try for 2 minutes: the detail steps aside, one item at a time, a banner with the time left, ended by Stop, by the clock and by leaving", async () => {
  const env = environment();
  const card = await open(env);
  await one(await detail(card, "studio:skin-frost", "home"), "Try for 2 minutes").click();
  assert.deepEqual(env.shown.find(([what]) => what === "pets.preview"), ["pets.preview", { kind: "dragon", skin: "frost" }, 120000]);
  assert.equal(detailOf(card).open, false, "the detail steps aside, so the tried item can be seen");
  assert.equal(banner(card).hidden, false);
  assert.equal(card.querySelector("#friends-shop-try-words").textContent, "Trying Frost scales · 2:00 left");
  assert.ok(one(banner(card), "Buy") && one(banner(card), "Stop"));
  assert.equal(buttons(await detail(card, "studio:skin-frost", "home"), "Stop trying").length, 1, "its detail says it is on");
  // Another try ends the first.
  await one(await detail(card, "studio:fx-dissolve", "home"), "Try for 2 minutes").click();
  assert.deepEqual(env.shown.filter(([what]) => what === "pets.endPreview").length, 1, "the scales' try ended first");
  assert.deepEqual(env.shown.find(([what]) => what === "effects.preview"), ["effects.preview", "dissolve", 120000]);
  assert.ok(env.shown.some(([what, id]) => what === "effects.demo" && id === "dissolve"), "its card plays the effect it is trying");
  assert.equal(card.querySelector("#friends-shop-try-words").textContent, "Trying Dissolve · 2:00 left");
  await one(banner(card), "Stop").click();
  assert.equal(env.shown.filter(([what]) => what === "effects.endPreview").length, 1);
  assert.equal(banner(card).hidden, true);
  assert.equal(status(card), "Stopped trying Dissolve.");
  // The clock ends it.
  await one(await detail(card, "studio:pack-synthwave", "home"), "Try for 2 minutes").click();
  assert.deepEqual(env.shown.find(([what]) => what === "music.previewPack"), ["music.previewPack", { id: "studio:pack-synthwave", name: "Synthwave", ...SYNTHWAVE }]);
  env.elapse(120000);
  assert.equal(env.shown.filter(([what]) => what === "music.endPreview").length, 1);
  assert.equal(banner(card).hidden, true);
  assert.equal(status(card), "Your two minutes with Synthwave are over.");
  // Leaving the Shop ends it.
  await one(await detail(card, "studio:skin-void", "drop"), "Try for 2 minutes").click();
  assert.deepEqual(env.shown.filter(([what]) => what === "pets.preview").at(-1), ["pets.preview", { kind: "dragon", skin: "void" }, 120000]);
  card.dispose();
  assert.equal(env.shown.filter(([what]) => what === "pets.endPreview").length, 2, "leaving ends the try");
  assert.equal(env.tryTimers(), 0, "no clock is left running");
});

test("Buy asks first, naming the item, the price and the balance after; a yes buys it (no tip for Studio's items) and updates what you own", async () => {
  const env = environment();
  const card = await open(env);
  const embers = await detail(card, "studio:fx-embers", "drop");
  await one(embers, "Buy for 90").click();
  assert.equal(shopCalls(env, "shopBuy").length, 0, "nothing is spent without a yes");
  assert.equal(embers.querySelector(".friends-shop-ask").textContent, "Buy Burn away for 90 credits? You will have 150 credits left.");
  assert.equal(embers.querySelector(".friends-shop-tips"), null, "Studio's own items never take a tip");
  await one(embers, "Not now").click();
  assert.equal(embers.querySelector(".friends-shop-confirm"), null);
  assert.equal(shopCalls(env, "shopBuy").length, 0);
  await one(embers, "Buy for 90").click();
  await one(embers, "Yes, buy it").click();
  await flush();
  assert.deepEqual(shopCalls(env, "shopBuy"), [["shopBuy", "studio:fx-embers", 90]], "the price alone, no tip argument");
  assert.equal(env.shop.owns("studio:fx-embers"), true);
  assert.deepEqual(clone(env.shop.owned("effect")).map((entry) => [entry.id, entry.name]), [["studio:fx-embers", "Burn away"]]);
  assert.ok(JSON.parse(env.storage.get(STORE)).owned["studio:fx-embers"], "the cache is kept");
  assert.ok(env.fired.includes("mefi-shop-owned"), "the rest of Studio hears it");
  assert.ok(shopCalls(env, "shopOwned").length >= 2, "what you own is read again after the purchase");
  assert.equal(card.querySelector("#friends-shop-balance").textContent, "150 credits");
  assert.equal(status(card), "Burn away is yours. Use it any time.");
  assert.equal(said(card), "Burn away is yours. Use it any time.");
  assert.equal(buttons(embers, "Use").length, 1);
  assert.equal(buttons(embers, "Try for 2 minutes").length, 0);
  assert.equal(item(card, "studio:fx-embers", "drop").querySelector(".friends-shop-owned").textContent, "Owned", "its card says so");
});

test("buying what you are trying keeps it on", async () => {
  const env = environment();
  const card = await open(env);
  await one(await detail(card, "studio:fx-dissolve", "home"), "Try for 2 minutes").click();
  await one(banner(card), "Buy").click();
  assert.equal(banner(card).querySelector(".friends-shop-ask").textContent, "Buy Dissolve for 60 credits? You will have 180 credits left.");
  await one(banner(card), "Yes, buy it").click();
  await flush();
  assert.deepEqual(shopCalls(env, "shopBuy"), [["shopBuy", "studio:fx-dissolve", 60]]);
  assert.ok(env.shown.some(([what]) => what === "effects.endPreview"));
  assert.deepEqual(acted(env), ["effects.use", "dissolve"]);
  assert.equal(status(card), "Dissolve is yours, and in use.");
  assert.equal(banner(card).hidden, true);
});

test("every refusal says why in plain words, and what to do", async () => {
  const until = Date.UTC(2026, 10, 3);
  const cases = [
    ["studio:fx-embers", "Buy for 90", { ok: false, error: "short", balance: 20, price: 90 }, /^You need 70 credits more for Burn away\. Earn them by playing and starring friends' projects, building together, co-work hours and the Build Jam\.$/],
    // Nothing sold today needs another item first; the refusal is still said plainly for what comes later.
    ["studio:skin-frost", "Buy for 40", { ok: false, error: "needs", needs: "studio:fx-dissolve" }, /^Get Dissolve first\.$/],
    ["studio:skin-frost", "Buy for 40", { ok: false, error: "price-changed", price: 60 }, /^The price of Frost scales changed to 60 credits\. Buy it for that\?$/],
    ["studio:fx-dissolve", "Buy for 60", { ok: false, error: "hold", hold: { reason: "new-member", until } }, /^Credits start a week after you joined the Void Engine server on /],
    ["studio:fx-dissolve", "Buy for 60", { ok: false, error: "gone" }, /^Dissolve is no longer in the Shop\.$/],
    ["studio:skin-void", "Buy for 60", { ok: false, error: "not-available", drop: "2026-10" }, /^This one has rotated out\. Everyone who got it keeps it\.$/],
    ["studio:pack-synthwave", "Buy for 50", { ok: false, error: "owned" }, /^You already own Synthwave\.$/],
    ["studio:pack-synthwave", "Buy for 50", { ok: false, error: "own" }, /^That's your own pack, so it's already yours to use\.$/],
    ["studio:pack-synthwave", "Buy for 50", { ok: false, error: "no-tip" }, /^Synthwave cannot take a tip: tips are only for members' style packs\. Buy it without one\?$/],
    ["studio:pack-synthwave", "Buy for 50", { ok: false, error: "rate-limited" }, /^Slow down a moment, then try again\.$/],
  ];
  for (const [id, label, answer, words] of cases) {
    const env = environment({ answers: { shopBuy: answer } });
    const card = await open(env);
    const dialog = await detail(card, id);
    await one(dialog, label).click();
    await one(dialog, "Yes, buy it").click();
    await flush();
    assert.match(status(card), words, `${answer.error}: ${status(card)}`);
    assert.match(said(card), words, `${answer.error}: the detail says it too`);
    if (answer.error === "short") {
      const ask = dialog.querySelector(".friends-shop-ask").textContent;
      assert.match(ask, /^You need 70 credits more/, "the question becomes how many more credits are needed");
      assert.equal(buttons(dialog, "Yes, buy it").length, 0, "and offers no yes");
      await one(dialog, "How to earn credits").click();
      assert.deepEqual(env.went.at(-1), ["friends-page", { place: "events" }]);
      assert.equal(card.querySelector("#friends-shop-balance").textContent, "20 credits");
    }
    if (answer.error === "price-changed") {
      assert.equal(dialog.querySelector(".friends-shop-ask").textContent, "The price changed to 60 credits. Buy Frost scales for 60 credits? You will have 180 credits left.", "the new price is asked again");
      await one(dialog, "Yes, buy it").click();
      await flush();
      assert.deepEqual(shopCalls(env, "shopBuy").at(-1), ["shopBuy", "studio:skin-frost", 60], "the yes is for the new price");
    }
    if (answer.error === "no-tip") assert.equal(buttons(dialog, "Yes, buy it").length, 1, "the question stays, without a tip");
    if (answer.error === "gone" || answer.error === "not-available") assert.equal(shopCalls(env, "shop").length, 2, "the list is read again");
    if (answer.error === "not-available") assert.equal(buttons(dialog, "Buy for 60").length, 0, "nothing more to buy: it left with its drop");
    if (answer.error === "owned") assert.equal(env.shop.owns(id), true);
  }
});

test("a known short balance says so before asking the relay", async () => {
  const env = environment({ views: { studio: { ok: true, items: CATALOG, next: null, balance: 30, canEarn: true, hold: null, ...ROTATION } } });
  const card = await open(env);
  const dialog = await detail(card, "studio:fx-embers");
  await one(dialog, "Buy for 90").click();
  assert.match(dialog.querySelector(".friends-shop-ask").textContent, /^You need 60 credits more for Burn away\./);
  assert.equal(shopCalls(env, "shopBuy").length, 0);
});

test("a teaser whose start has passed (a list read before it) says nothing", async () => {
  const env = environment({ views: { studio: { ok: true, items: CATALOG, next: null, balance: 240, canEarn: true, hold: null, ...ROTATION, drops: { ...DROPS, next: { ...DROPS.next, from: new Date(Date.now() - DAY).toISOString() } } } } });
  const card = await open(env);
  assert.equal(card.querySelector("#friends-shop-teaser"), null);
  assert.ok(card.querySelector("#friends-shop-hero"), "the rest of Home is there");
});

test("badges: New for a drop's own item and a member's pack of this week, Leaving soon in a drop's last week, In use for what you wear", async () => {
  const soon = new Date(Date.now() + 3 * DAY + 3_600_000).toISOString();
  const items = CATALOG.map((entry) => (entry.drop ? { ...entry, leaves: soon } : entry));
  const env = environment({ owned: [{ id: "studio:fx-dissolve", kind: "effect", name: "Dissolve", data: null, updatedAt: 1 }], views: { studio: { ok: true, items, next: null, balance: 240, canEarn: true, hold: null, ...ROTATION, drops: { ...DROPS, current: { ...DROPS.current, until: soon } } }, new: { ok: true, items: [{ ...MEMBER_PACKS[0], createdAt: Date.now() - DAY }, { ...MEMBER_PACKS[1], createdAt: Date.now() - 30 * DAY }], next: null, balance: 240, canEarn: true, hold: null, ...ROTATION } } });
  await env.shop.refresh();
  const card = await open(env);
  const badges = (id, scope) => item(card, id, scope).querySelectorAll(".friends-shop-badge").map((badge) => badge.textContent);
  assert.deepEqual(badges("studio:skin-void", "drop"), ["Leaving soon"], "its drop's last week");
  assert.match(card.querySelector(".friends-shop-hero-kicker").textContent, /Leaves in 3 days$/);
  await one(await detail(card, "studio:fx-dissolve", "home"), "Use").click();
  assert.deepEqual(badges("studio:fx-dissolve", "home"), ["In use"]);
  assert.equal(item(card, "studio:fx-dissolve", "home").querySelector(".friends-shop-owned").textContent, "Owned");
  await showView(card, "Community");
  assert.deepEqual(badges("pack_nightmarket0001", "packs"), ["New"], "a member's pack published this week");
  assert.equal(item(card, "pack_paper000000001", "packs").querySelector(".friends-shop-badges"), null);
});

test("a member's pack takes an optional tip for its maker: quick picks, the total and the balance after, and hubShop gets it", async () => {
  const env = environment();
  const card = await open(env, "packs");
  const night = await detail(card, "pack_nightmarket0001");
  assert.equal(night.querySelector(".friends-shop-detail-kicker").textContent, "Community");
  await one(night, "Buy for 30").click();
  const tips = () => night.querySelector(".friends-shop-tips");
  assert.match(tips().textContent, /^Add a tip for the makerNo tip51025/);
  assert.match(tips().textContent, /Nova gets up to three quarters of what you pay\.$/);
  assert.equal(night.querySelector(".friends-shop-ask").textContent, "Buy Night market for 30 credits? You will have 210 credits left.");
  assert.equal(night.querySelector("#friends-shop-tip-pack_nightmarket0001-0").getAttribute("aria-pressed"), "true", "no tip unless you choose one");
  await night.querySelector("#friends-shop-tip-pack_nightmarket0001-10").click();
  assert.equal(night.querySelector(".friends-shop-ask").textContent, "Buy Night market for 30 credits and tip its maker 10 credits? That is 40 credits in all. You will have 200 credits left.");
  assert.equal(night.querySelector("#friends-shop-tip-pack_nightmarket0001-10").getAttribute("aria-pressed"), "true");
  // Another amount, up to 100.
  const other = () => night.querySelector("#friends-shop-tip-pack_nightmarket0001-other");
  other().value = "7";
  await other().trigger("change");
  assert.match(night.querySelector(".friends-shop-ask").textContent, /tip its maker 7 credits\? That is 37 credits in all\. You will have 203 credits left\.$/);
  other().value = "500";
  await other().trigger("change");
  assert.match(night.querySelector(".friends-shop-ask").textContent, /tip its maker 100 credits\? That is 130 credits in all\./, "a tip is never more than 100");
  await night.querySelector("#friends-shop-tip-pack_nightmarket0001-5").click();
  await one(night, "Yes, buy it").click();
  await flush();
  assert.deepEqual(shopCalls(env, "shopBuy"), [["shopBuy", "pack_nightmarket0001", 30, 5]]);
  assert.equal(status(card), "Night market is yours. Thank you for the 5 credit tip. Use it any time.");
  assert.equal(card.querySelector("#friends-shop-balance").textContent, "205 credits");

  // A small balance turns off the tips it cannot cover.
  const poor = environment({ views: { new: { ok: true, items: MEMBER_PACKS, next: null, balance: 35, canEarn: true, hold: null, ...ROTATION } } });
  const poorCard = await open(poor, "packs");
  const poorNight = await detail(poorCard, "pack_nightmarket0001");
  await one(poorNight, "Buy for 30").click();
  const picks = poorNight.querySelectorAll(".friends-shop-tip-picks button").map((pick) => [pick.textContent, pick.disabled]);
  assert.deepEqual(picks, [["No tip", false], ["5", false], ["10", true], ["25", true]]);
});

test("a free member's pack reads Free · tips welcome; Get asks first and can carry a tip; then Use applies it", async () => {
  const env = environment();
  const card = await open(env);
  await showView(card, "Community");
  assert.deepEqual(shopCalls(env, "shop").at(-1), ["shop", "new"]);
  assert.match(item(card, "pack_paper000000001").textContent, /Paperby NovaFree · tips welcome3 sales$/, "(its little window says its name too)");
  assert.match(item(card, "pack_nightmarket0001").textContent, /30 credits12 sales/, "a member's pack shows its sales");
  const paper = await detail(card, "pack_paper000000001");
  await one(paper, "Get").click();
  assert.equal(shopCalls(env, "shopBuy").length, 0, "Get asks first: a tip may go with it");
  assert.equal(paper.querySelector(".friends-shop-ask").textContent, "Get Paper? It's free.");
  await paper.querySelector("#friends-shop-tip-pack_paper000000001-5").click();
  assert.equal(paper.querySelector(".friends-shop-ask").textContent, "Get Paper and tip its maker 5 credits? You will have 235 credits left.");
  await paper.querySelector("#friends-shop-tip-pack_paper000000001-0").click();
  await one(paper, "Yes, get it").click();
  await flush();
  assert.deepEqual(shopCalls(env, "shopBuy"), [["shopBuy", "pack_paper000000001", 0, 0]]);
  assert.equal(status(card), "Paper is yours. Use it any time.");
  await one(paper, "Use").click();
  assert.deepEqual(acted(env), ["music.applyPack", { id: "pack_paper000000001", name: "Paper", ...PAPER }, true]);
  assert.equal(buttons(paper, "Use").length, 0);
  assert.match(paper.textContent, /In use/);
  await one(card, "×").click();
  await one(card, "Top").click();
  await flush();
  assert.deepEqual(shopCalls(env, "shop").at(-1), ["shop", "top"]);
  assert.equal(card.querySelector("#friends-shop-sort-top").getAttribute("aria-pressed"), "true");
  // A relay that refuses for the tip alone: the pack is still offered, with a tip the balance covers.
  const tight = environment({ answers: { shopBuy: { ok: false, error: "short", balance: 3, price: 0 } } });
  const tightCard = await open(tight, "packs");
  const tightPaper = await detail(tightCard, "pack_paper000000001");
  await one(tightPaper, "Get").click();
  await tightPaper.querySelector("#friends-shop-tip-pack_paper000000001-5").click();
  await one(tightPaper, "Yes, get it").click();
  await flush();
  assert.equal(status(tightCard), "You have 3 credits: enough for Paper, not for that tip. Choose a smaller tip, or none.");
  assert.equal(buttons(tightPaper, "Yes, get it").length, 1);
});

test("Use per kind: Ember's switch, scales dress it, an effect and a pack are put on; an effect turns off", async () => {
  const owned = [
    { id: "studio:skin-frost", kind: "skin", name: "Frost scales", data: null, updatedAt: 1 },
    { id: "studio:fx-dissolve", kind: "effect", name: "Dissolve", data: null, updatedAt: 1 },
    { id: "studio:pack-synthwave", kind: "pack", name: "Synthwave", data: SYNTHWAVE, updatedAt: 1 },
  ];
  const env = environment({ owned, views: { owned: { ok: true, items: CATALOG.filter((entry) => owned.some((mine) => mine.id === entry.id)).map((entry) => ({ ...entry, owned: true })), next: null, balance: 240, canEarn: true, hold: null } } });
  const card = await open(env, "owned");
  assert.deepEqual(shopCalls(env, "shop"), [["shop", "owned"]], "open(view) lands on that view");
  assert.deepEqual(env.went.at(-1), ["shop", { view: "owned" }], "the Shop's own page");
  assert.equal(card.querySelectorAll("article")[0].dataset.item, EMBER, "Ember is yours too, with its switch");
  await (await detail(card, EMBER)).querySelector("#friends-shop-ember-switch").click();
  assert.deepEqual(acted(env), ["pets.set", { on: true, kind: "dragon" }]);
  await one(await detail(card, "studio:skin-frost"), "Use").click();
  assert.deepEqual(acted(env), ["pets.set", { skin: "frost" }]);
  assert.equal(status(card), "Frost scales is in use.");
  await one(await detail(card, "studio:fx-dissolve"), "Use").click();
  assert.deepEqual(acted(env), ["effects.use", "dissolve"]);
  await one(await detail(card, "studio:pack-synthwave"), "Use").click();
  assert.deepEqual(acted(env), ["music.applyPack", { id: "studio:pack-synthwave", name: "Synthwave", ...SYNTHWAVE }, true]);
  for (const id of ["studio:skin-frost", "studio:fx-dissolve", "studio:pack-synthwave"]) assert.match(item(card, id).textContent, /^.+Owned$/, id);
  const dissolve = await detail(card, "studio:fx-dissolve");
  assert.match(dissolve.textContent, /In use/);
  await one(dissolve, "Turn off").click();
  assert.deepEqual(acted(env), ["effects.use", "none"]);
  assert.equal(buttons(dissolve, "Use").length, 1);
});

test("Node styles: their own section, a live board per card, Try puts one on the real tree for two minutes, Buy asks first, then Use wears it", async () => {
  const env = environment({ painters: true });
  const card = await open(env);
  const section = card.querySelector("#friends-shop-group-home-nodestyles");
  assert.deepEqual(section.querySelectorAll("article").map((el) => el.dataset.item), ["studio:style-dragonscale", "studio:style-constellation"], "both node styles, under Node styles");
  const dragon = () => item(card, "studio:style-dragonscale", "home");
  assert.match(dragon().textContent, /^Dragon scales80 credits$/);
  const board = dragon().querySelector("canvas");
  assert.equal(board.dataset.nodeStyle, "dragonscale", "the card paints its own style");
  assert.equal(board.getAttribute("role"), "img");
  assert.match(board.getAttribute("aria-label"), /^Dragon scales: /);
  assert.equal(item(card, "studio:style-constellation").querySelector("canvas").dataset.nodeStyle, "constellation");
  // Try: the real tree wears it, nothing is saved, and Stop (or the clock) takes it off.
  const look = await detail(card, "studio:style-dragonscale", "home");
  assert.match(look.textContent, /Nodes covered in shimmering dragon scales, with ember sparks along the wires\.80 credits/);
  assert.equal(look.querySelector("canvas").dataset.size, "big");
  await one(look, "Try for 2 minutes").click();
  assert.deepEqual(acted(env), ["music.previewNodeStyle", "dragonscale"]);
  assert.equal(card.querySelector("#friends-shop-try-words").textContent, "Trying Dragon scales · 2:00 left");
  await one(banner(card), "Stop").click();
  assert.deepEqual(acted(env), ["music.endPreview"]);
  await one(await detail(card, "studio:style-constellation"), "Try for 2 minutes").click();
  env.elapse(120000);
  assert.deepEqual(acted(env), ["music.endPreview"], "the two minutes end it");
  // Buy asks first; a Studio item never takes a tip; then Use wears it.
  const buying = await detail(card, "studio:style-dragonscale", "home");
  await one(buying, "Buy for 80").click();
  assert.equal(buying.querySelector(".friends-shop-ask").textContent, "Buy Dragon scales for 80 credits? You will have 160 credits left.");
  assert.equal(buying.querySelector(".friends-shop-tips"), null);
  await one(buying, "Yes, buy it").click();
  await flush();
  assert.deepEqual(shopCalls(env, "shopBuy"), [["shopBuy", "studio:style-dragonscale", 80]]);
  assert.equal(env.shop.owns("studio:style-dragonscale"), true);
  assert.deepEqual(clone(env.shop.owned("nodestyle")).map((entry) => [entry.id, entry.kind, entry.name]), [["studio:style-dragonscale", "nodestyle", "Dragon scales"]]);
  await one(buying, "Use").click();
  assert.deepEqual(acted(env), ["music.applyNodeStyle", "dragonscale", true]);
  assert.equal(status(card), "Dragon scales is in use.");
  assert.match(buying.textContent, /In use/);
  assert.equal(buttons(buying, "Turn off").length, 0, "another style is chosen in Settings, so no Turn off");
});

test("buying a node style while trying it keeps it on, and an owned one in the Owned view puts it on", async () => {
  const env = environment();
  const card = await open(env);
  await one(await detail(card, "studio:style-constellation"), "Try for 2 minutes").click();
  await one(banner(card), "Buy").click();
  await one(banner(card), "Yes, buy it").click();
  await flush();
  assert.ok(env.shown.some(([what]) => what === "music.endPreview"), "the try ends first");
  assert.deepEqual(acted(env), ["music.applyNodeStyle", "constellation", true]);
  assert.equal(status(card), "Star chart is yours, and in use.");
  // The relay says a style is owned before this PC's list does (another PC bought it): Use still wears it.
  const other = environment({ views: { owned: { ok: true, items: [{ ...CATALOG.find((entry) => entry.id === "studio:style-dragonscale"), owned: true }], next: null, balance: 240, canEarn: true, hold: null } }, answers: { shopOwned: { ok: true, items: [] } } });
  const ownedCard = await open(other, "owned");
  assert.equal(other.shop.owns("studio:style-dragonscale"), false, "not on this PC's list yet");
  await one(await detail(ownedCard, "studio:style-dragonscale"), "Use").click();
  assert.deepEqual(acted(other), ["music.applyNodeStyle", "dragonscale", true]);
  assert.equal(other.shop.owns("studio:style-dragonscale"), true, "the relay's word goes on the list first");
  assert.equal(status(ownedCard), "Dragon scales is in use.");
});

test("a node style's board paints through MefiNodeStyles in the theme's sky, moves only while on screen with motion on, and holds one still frame with motion off", async () => {
  for (const motion of ["on", "off"]) {
    const env = environment({ painters: true, frames: true, motion });
    const card = await open(env);
    const board = item(card, "studio:style-constellation").querySelector("canvas");
    const ctx = board._ctx;
    assert.ok(ctx, "the board has a canvas to paint on");
    // What a frame draws (the paints the first one builds, cached for the rest, left out).
    const drawn = (list) => JSON.stringify(list.filter(([name]) => !name.startsWith("create:") && name !== "addColorStop"));
    const frame = (ms) => { const from = ctx.calls.log.length; env.frame(ms); return drawn(ctx.calls.log.slice(from)); };
    // The frame painted as the card was made is the style's still pose.
    const made = drawn(ctx.calls.log);
    assert.ok(made.includes('"fillRect"') && made.includes('"set:fillStyle","#050507"'), "the theme's own sky behind the nodes");
    assert.ok(ctx.calls.fill + ctx.calls.stroke > 12, "nodes and wires were painted");
    const first = frame(1000);
    assert.equal(ctx.calls.saves, ctx.calls.restores, "the canvas comes back as it was");
    if (motion === "on") {
      assert.notEqual(first, made, "on screen with motion on, it moves");
      assert.notEqual(frame(1400), first, "and keeps moving");
    } else {
      assert.equal(first, made, "with motion off it is the one still frame");
      assert.equal(frame(1400), "[]", "and no other frame is asked for");
    }
    const dragon = item(card, "studio:style-dragonscale").querySelector("canvas")._ctx;
    assert.notEqual(JSON.stringify(dragon.calls.log.slice(-40)), JSON.stringify(ctx.calls.log.slice(-40)), "each card paints its own style");
  }
});

test("motion Calm: the cards hold their still frame; only the banner's pieces and an open detail move, and they are drawn bigger", async () => {
  const env = environment({ frames: true, motion: "calm" });
  const card = await open(env);
  // A card's pet is drawn at its own size; a big one (the banner's, a detail's) is given a size to grow to.
  const small = () => env.shown.filter(([what, , , size]) => what === "pets.paint" && size === null).length;
  const big = () => env.shown.filter(([what, , , size]) => what === "pets.paint" && size > 1).length;
  const before = small(), banner_ = big();
  env.frame(1000);
  env.frame(1400);
  assert.equal(small(), before, "the cards hold their still frame");
  assert.ok(big() > banner_, "the banner's scales fly");
  await detail(card, "studio:skin-frost", "home");
  const opened = big(), held = small();
  env.frame(2000);
  assert.ok(big() > opened, "the detail's pet flies");
  assert.equal(small(), held, "and the cards still hold");
});

// The catalog's two new node styles (relay/src/shop.mjs: Lanterns in October's drop, Neon a classic): the Shop
// shows any node style it sells, each card with its own live board, and its detail tries, buys and wears it.
test("Lanterns (October's drop) and Neon are node style cards once the catalog sells them: a live board in each style, Try, Buy and Use", async () => {
  const LANTERN = studioItem("studio:style-lantern", "nodestyle", "Lanterns", 80, { blurb: "Glowing paper lanterns that sway, their warm light flickering at work.", ...IN_DROP });
  const NEON = studioItem("studio:style-neon", "nodestyle", "Neon", 80, { blurb: "Bright neon tubes with a soft glow that buzz on when work starts." });
  const env = environment({
    painters: true,
    views: { studio: { ok: true, items: [...CATALOG, LANTERN, NEON], next: null, balance: 240, canEarn: true, hold: null, ...ROTATION } },
    // A Studio item the test catalog does not list: the purchase lands in what the relay says you own, as a real one does.
    answers: { shopBuy: (id, price) => { owned.push({ id, kind: "nodestyle", name: "Lanterns", data: null, updatedAt: 5 }); return { ok: true, item: { ...LANTERN, owned: true }, paid: price, balance: 240 - price }; } },
  });
  const owned = env.relay.owned;
  const card = await open(env);
  for (const [id, key, name] of [["studio:style-lantern", "lantern", "Lanterns"], ["studio:style-neon", "neon", "Neon"]]) {
    const box = item(card, id);
    assert.ok(box, `${name} has a card`);
    const board = box.querySelector("canvas");
    assert.equal(board.dataset.nodeStyle, key, `${key}: the card paints its own style`);
    assert.ok(board._ctx.calls.fill + board._ctx.calls.stroke > 12, `${key}: nodes and wires were painted`);
    assert.equal(board._ctx.calls.saves, board._ctx.calls.restores);
    assert.match(board.getAttribute("aria-label"), new RegExp(`^${name}: `));
    await one(await detail(card, id), "Try for 2 minutes").click();
    assert.deepEqual(acted(env), ["music.previewNodeStyle", key]);
    assert.equal(card.querySelector("#friends-shop-try-words").textContent, `Trying ${name} · 2:00 left`);
    await one(banner(card), "Stop").click();
  }
  const buying = await detail(card, "studio:style-lantern");
  await one(buying, "Buy for 80").click();
  assert.equal(buying.querySelector(".friends-shop-ask").textContent, "Buy Lanterns for 80 credits? You will have 160 credits left.");
  await one(buying, "Yes, buy it").click();
  await flush();
  assert.deepEqual(shopCalls(env, "shopBuy").at(-1), ["shopBuy", "studio:style-lantern", 80]);
  assert.equal(env.shop.owns("studio:style-lantern"), true);
  await one(buying, "Use").click();
  assert.deepEqual(acted(env), ["music.applyNodeStyle", "lantern", true]);
  assert.equal(status(card), "Lanterns is in use.");
});

// The style packs for October's drop and the classic shelf (tests/fixtures/shop-themes-2026-10.json, added to the
// catalog at merge): the editor's check and the relay's both pass every one and keep the same pack.
test("the new style packs pass the editor's check and the relay's alike, and both keep the same pack", async () => {
  const { checkPack: relayCheck } = await import("../relay/src/shop-pack.mjs");
  const themes = JSON.parse(await readFile(new URL("./fixtures/shop-themes-2026-10.json", import.meta.url), "utf8"));
  const { shop } = environment({ hubShop: false });
  assert.equal(themes.length, 8);
  for (const theme of themes) {
    const relay = relayCheck(theme.data), studio = shop.checkPack(theme.data);
    assert.deepEqual([relay.ok, studio.ok], [true, true], `${theme.name}: ${studio.why ?? relay.error ?? ""}`);
    assert.deepEqual(clone(studio.data), relay.pack, `${theme.name}: the same pack from both`);
    // Each paints as a tiny app window from its own colours, as a pack's card does.
    assert.equal(typeof shop.contrast(theme.data.palette.accent, theme.data.palette.surface), "number");
  }
});

test("a part not in this build says so in its detail instead of failing", async () => {
  const env = environment({ modules: { pets: false, effects: false, music: false } });
  const card = await open(env);
  for (const id of [EMBER, "studio:skin-frost", "studio:fx-dissolve", "studio:pack-synthwave"]) {
    const dialog = await detail(card, id, id === EMBER ? null : "home");
    assert.match(dialog.textContent, /Comes with the next Studio update\./, id);
    assert.deepEqual(dialog.querySelectorAll("button").map((control) => control.textContent), ["×"], `${id} offers nothing it cannot do`);
    await one(dialog, "×").click();
  }
  assert.ok(item(card, EMBER).querySelector(".friends-shop-placeholder"), "a still placeholder where Ember would fly");
  const old = environment({ hubShop: false });
  const oldCard = await open(old);
  assert.equal(oldCard.dataset.state, "unavailable");
  assert.equal(status(oldCard), "The Shop: Comes with the next Studio update.");
});

test("signed out, the same page is a showroom: Studio's items from this PC's copy of the catalog, Try, and Sign in to get it; members' packs need sign-in", async () => {
  const storage = new Map([[STORE, JSON.stringify({ owned: { "studio:fx-dissolve": { kind: "effect", name: "Dissolve", data: null, updatedAt: 1 }, pack_paper000000001: { kind: "pack", name: "Paper", data: PAPER, updatedAt: 1 } }, at: 1 })]]);
  const env = environment({ storage, hub: { configured: true, linked: false, state: "off" } });
  const card = await open(env);
  assert.equal(card.dataset.state, "not-linked");
  assert.deepEqual(shopCalls(env, "shopCatalog"), [["shopCatalog"]], "this PC's copy of the catalog");
  assert.equal(shopCalls(env, "shop").length, 0, "nothing is asked of a relay you are not signed in to");
  assert.equal(card.querySelector("#friends-shop-views").hidden, false, "the views are there to look around");
  assert.equal(card.querySelector("#friends-shop-balance").hidden, true, "no balance to show");
  assert.match(card.querySelector("#friends-shop-notice").textContent, /^You're signed out\. Look around and try anything for two minutes; sign in with Discord to get what you like\.Sign in$/);
  assert.equal(status(card), "", "the line at the top says it once");
  assert.ok(card.querySelector("#friends-shop-hero"), "the drop's banner");
  assert.ok(card.querySelector("#friends-shop-group-featured"));
  const gate = card.querySelector("#friends-gate");
  assert.ok(gate, "Friends' one sign-in card, at the foot");
  assert.equal(card.querySelector("#friends-shop-body").children.at(-1), gate);
  // Prices from the copy, Try as signed in, and in place of Buy the one thing that helps.
  assert.match(item(card, "studio:skin-frost", "home").textContent, /^Frost scales40 credits$/);
  const frost = await detail(card, "studio:skin-frost", "home");
  assert.deepEqual(frost.querySelectorAll(".friends-shop-actions button").map((control) => control.textContent), ["Try for 2 minutes", "Sign in to get it"]);
  await one(frost, "Try for 2 minutes").click();
  assert.deepEqual(env.shown.find(([what]) => what === "pets.preview"), ["pets.preview", { kind: "dragon", skin: "frost" }, 120000], "Try works signed out");
  assert.deepEqual(banner(card).querySelectorAll("button").map((control) => control.textContent), ["Sign in to get it", "Stop"]);
  await one(banner(card), "Stop").click();
  assert.deepEqual(env.signIns, [], "nothing signs in by itself");
  await one(await detail(card, "studio:skin-frost", "home"), "Sign in to get it").click();
  assert.equal(detailOf(card).open, false, "the detail steps aside for the sign-in");
  assert.deepEqual(env.signIns, ["signin"], "one press starts Friends' own sign-in");
  assert.equal(gate.querySelector("#friends-gate-signin").focused, true, "its card takes the keyboard");
  assert.ok(gate.classList.contains("is-called"), "and says it is the one");
  gate.querySelector("#friends-gate-signin").disabled = true;
  await one(card.querySelector("#friends-shop-notice"), "Sign in").click();
  assert.deepEqual(env.signIns, ["signin"], "a sign-in already on its way is only brought into view");
  // What you own keeps working: Studio's items say Owned with Use; a member's pack is under Owned.
  assert.match(item(card, "studio:fx-dissolve", "home").textContent, /^DissolveOwned$/);
  await one(await detail(card, "studio:fx-dissolve", "home"), "Use").click();
  assert.deepEqual(acted(env), ["effects.use", "dissolve"]);
  await showView(card, "Owned");
  assert.deepEqual(card.querySelectorAll("article").map((el) => el.dataset.item), [EMBER, "studio:fx-dissolve", "pack_paper000000001"]);
  await showView(card, "Community");
  assert.equal(card.querySelector("#friends-shop-group-packs").textContent, "CommunityStyle packs members make and share, free or for credits.Sign inMembers' packs need sign-in: they come from the room service.");
  await showView(card, "Make a style");
  assert.equal(card.querySelector("#friends-shop-publish").textContent, "Sign in to publish");
  assert.match(card.querySelector("#friends-shop-mine").textContent, /Sign in to publish a style and to see the ones you published\./);
  assert.equal(shopCalls(env, "shop").length, 0, "still nothing asked of the relay");

  // Out of reach: Connect is the one thing that helps.
  const offline = environment({ storage, hub: { configured: true, linked: true, state: "offline", error: "network" } });
  const off = await open(offline);
  assert.equal(one(off.querySelector("#friends-shop-notice"), "Connect").id, "friends-shop-notice-way");
  assert.equal(buttons(await detail(off, "studio:skin-frost", "home"), "Connect to get it").length, 1);
  // A room service without the Shop: the showroom says so.
  const older = environment({ storage, views: { studio: { ok: false, error: "unsupported" } }, answers: { shopOwned: { ok: false, error: "unsupported" } } });
  const old = await open(older);
  assert.equal(old.dataset.state, "unsupported");
  assert.match(old.querySelector("#friends-shop-notice").textContent, /The Shop isn't on this room service yet/);
  assert.ok(item(old, "studio:fx-dissolve"));
});

test("the showroom's kill switch: mefiStudio.shop.showroom off shows a signed-out Shop only Friends' sign-in and what you own", async () => {
  const storage = new Map([["mefiStudio.shop.showroom", "off"], [STORE, JSON.stringify({ owned: { "studio:fx-dissolve": { kind: "effect", name: "Dissolve", data: null, updatedAt: 1 } }, at: 1 })]]);
  const env = environment({ storage, hub: { configured: true, linked: false, state: "off" } });
  const card = await open(env);
  assert.equal(card.dataset.state, "not-linked");
  assert.equal(shopCalls(env, "shopCatalog").length, 0, "no showroom asked for");
  assert.ok(card.querySelector("#friends-gate"), "Friends' one sign-in card");
  assert.equal(card.querySelector("#friends-shop-views").hidden, true);
  assert.match(card.querySelector("#friends-shop-yours").textContent, /Your items/);
  assert.ok(item(card, EMBER, "yours"), "Ember is everyone's");
  await one(await detail(card, "studio:fx-dissolve", "yours"), "Use").click();
  assert.deepEqual(acted(env), ["effects.use", "dissolve"]);
});

test("the owned cache survives a reload, and a storage that throws only keeps it for this session", async () => {
  const storage = new Map();
  const first = environment({ storage, owned: [{ id: "studio:skin-frost", kind: "skin", name: "Frost scales", data: null, updatedAt: 3 }, { id: "studio:pack-synthwave", kind: "pack", name: "Synthwave", data: SYNTHWAVE, updatedAt: 3 }] });
  assert.equal((await first.shop.refresh()).changed, true);
  const reloaded = environment({ storage, hubShop: false });
  assert.equal(reloaded.shop.owns("studio:skin-frost"), true);
  assert.deepEqual(clone(reloaded.shop.owned()).map((entry) => entry.id).sort(), ["studio:pack-synthwave", "studio:skin-frost"]);
  assert.deepEqual(clone(reloaded.shop.pack("studio:pack-synthwave")), SYNTHWAVE);
  assert.equal(reloaded.shop.pack("studio:skin-frost"), null);
  const broken = new Map([[STORE, "{not json"]]);
  const damaged = environment({ storage: broken, hubShop: false }).shop;
  assert.equal(damaged.owns("studio:skin-frost"), false, "a damaged cache reads as empty");
  assert.equal(damaged.owns(EMBER), true, "Ember comes with every Studio, cache or not");
  const refused = environment({ throwing: true, owned: [{ id: "studio:fx-dissolve", kind: "effect", name: "Dissolve", data: null, updatedAt: 1 }] });
  assert.equal(refused.shop.owns("studio:fx-dissolve"), false);
  assert.equal((await refused.shop.refresh()).ok, true, "a storage that throws does not stop the read");
  assert.equal(refused.shop.owns("studio:fx-dissolve"), true, "kept in memory");
  const card = await open(refused);
  assert.equal(card.dataset.state, "ready");
});

test("a connection coming up reads what you own again; a member's sale moves the balance, says so (Friends' pop-up, or this page with pop-ups off) and reads Your packs again", async () => {
  const env = environment();
  const card = await open(env);
  const reads = shopCalls(env, "shopOwned").length;
  env.hear({ type: "status", status: { state: "off" } });
  env.hear({ type: "status", status: { state: "ready" } });
  await flush();
  assert.ok(shopCalls(env, "shopOwned").length > reads, "what you own is read again");
  env.hear({ type: "credits", delta: 22, balance: 262, reason: "sale" });
  assert.equal(card.querySelector("#friends-shop-balance").textContent, "262 credits");
  assert.equal(status(card), "A member got one of your style packs: +22 credits.", "no pop-up here, so the page says it");
  // With Friends' pop-ups on, the toast says it (renderer/friends-front.js) and the page only moves the balance.
  const quiet = environment({ popups: { on: () => true } });
  const quietCard = await open(quiet, "make");
  const mineReads = shopCalls(quiet, "shop").filter(([, view]) => view === "mine").length;
  quiet.hear({ type: "credits", delta: 1, balance: 241, reason: "sale" });
  assert.equal(quietCard.querySelector("#friends-shop-balance").textContent, "241 credits");
  await flush();
  assert.notEqual(status(quietCard), "A member got one of your style packs: +1 credit.");
  assert.equal(shopCalls(quiet, "shop").filter(([, view]) => view === "mine").length, mineReads + 1, "Your packs is read again for its counts");
});

test("checkPack is the relay's check: data only, known keys, #rrggbb, 2 KB, and readable text", () => {
  const { shop } = environment({ hubShop: false });
  const good = shop.checkPack({ v: 1, palette: { accent: "#FF4FA3", accent2: "#8B5CFF", background: "#0D0B1F", surface: "#17132E", text: "#F3ECFF" }, nodeStyle: "halo", material: "atmosphere", font: "display" });
  assert.equal(good.ok, true);
  assert.deepEqual(clone(good.data), SYNTHWAVE, "colours are lower-cased");
  assert.equal(shop.checkPack({ v: 1, palette: { accent: "#9b3d12", background: "#fbf6ee", surface: "#ffffff", text: "#2b2118" } }).ok, true, "the second accent and the choices are optional");
  const bad = [
    [null, "bad-pack"], [[], "bad-pack"], ["#fff", "bad-pack"],
    [{ ...SYNTHWAVE, css: "body{}" }, "bad-pack"],
    [{ ...SYNTHWAVE, palette: { ...SYNTHWAVE.palette, glow: "#ffffff" } }, "bad-pack"],
    [{ ...SYNTHWAVE, palette: { ...SYNTHWAVE.palette, text: "#fff" } }, "bad-pack"],
    [{ ...SYNTHWAVE, palette: { ...SYNTHWAVE.palette, text: "white" } }, "bad-pack"],
    [{ ...SYNTHWAVE, palette: { accent: "#ff4fa3", background: "#0d0b1f", surface: "#17132e" } }, "bad-pack"],
    [{ ...SYNTHWAVE, nodeStyle: "comic" }, "bad-pack"], [{ ...SYNTHWAVE, material: "chrome" }, "bad-pack"], [{ ...SYNTHWAVE, font: "papyrus" }, "bad-pack"],
    [{ ...SYNTHWAVE, v: 2 }, "bad-pack"], [{ palette: SYNTHWAVE.palette }, "bad-pack"],
    [{ ...SYNTHWAVE, image: "x".repeat(3000) }, "too-big"],
    [{ ...SYNTHWAVE, palette: { ...SYNTHWAVE.palette, text: "#3a3550" } }, "low-contrast"],
    [{ ...SYNTHWAVE, palette: { ...SYNTHWAVE.palette, surface: "#d8d0f0" } }, "low-contrast"],
    [{ ...SYNTHWAVE, palette: { ...SYNTHWAVE.palette, accent: "#2a1a40" } }, "low-contrast"],
  ];
  for (const [data, error] of bad) {
    const result = shop.checkPack(data);
    assert.equal(result.ok, false, JSON.stringify(data)?.slice(0, 80));
    assert.equal(result.error, error, `${JSON.stringify(data)?.slice(0, 80)}: ${result.why}`);
    assert.equal(typeof result.why, "string");
  }
  assert.equal(shop.checkPack({ ...SYNTHWAVE, palette: { ...SYNTHWAVE.palette, text: "#fff" } }).why, "Text: enter a colour as #RRGGBB.");
  assert.match(shop.checkPack({ ...SYNTHWAVE, palette: { ...SYNTHWAVE.palette, text: "#3a3550" } }).why, /^Text on background is \d+(\.\d)?:1\. It needs 4\.5:1 to be easy to read\.$/);
  assert.match(shop.checkPack({ ...SYNTHWAVE, palette: { ...SYNTHWAVE.palette, accent: "#2a1a40" } }).why, /^Accent on background is \d+(\.\d)?:1\. It needs 4\.5:1 to read as text\.$/);
  // The accent is read as text too, so 3:1 is no longer enough: Sakura's first accent (3.9:1 on its page) is refused.
  const sakura = { v: 1, palette: { accent: "#d6457a", accent2: "#8a6bd1", background: "#fbf6f4", surface: "#ffffff", text: "#2b1f24" } };
  assert.deepEqual([shop.checkPack(sakura).error, shop.checkPack(sakura).field], ["low-contrast", "palette.accent"]);
  assert.equal(shop.checkPack({ ...sakura, palette: { ...sakura.palette, accent: "#b8325f" } }).ok, true, "its deepened accent reads 5.4:1");
  assert.equal(shop.checkPack({ ...SYNTHWAVE, css: "x" }).why, "A style has no part called “css”.");
  // WCAG contrast: black on white is 21:1, a colour on itself 1:1; anything else is not a colour.
  assert.equal(shop.contrast("#000000", "#ffffff"), 21);
  assert.equal(shop.contrast("#ffffff", "#000000"), 21);
  assert.equal(shop.contrast("#777777", "#777777"), 1);
  assert.equal(shop.contrast("#fff", "#000000"), null);
  assert.ok(Math.abs(shop.contrast("#767676", "#ffffff") - 4.54) < 0.01, "the grey the web calls just readable");
  assert.deepEqual(clone(shop.checkListing({ name: "  Night   market ", blurb: "", price: 30 })), { ok: true, name: "Night market", blurb: "", price: 30 });
  for (const [listing, error] of [[{ name: "A", price: 0 }, "name"], [{ name: "x".repeat(41), price: 0 }, "name"], [{ name: "Fine", blurb: "y".repeat(161), price: 0 }, "blurb"], [{ name: "Fine", price: 5 }, "price"], [{ name: "Fine", price: 251 }, "price"], [{ name: "Fine", price: 12.5 }, "price"]]) {
    assert.equal(shop.checkListing(listing).error, error, JSON.stringify(listing));
  }
});

test("Make a style: a live preview and contrast readout; the check stops Publish with a plain reason; Publish, Use it myself", async () => {
  const env = environment({ answers: { shopPublish: (fields) => ({ ok: true, pack: { ...studioItem("pack_new000000000001", "pack", fields.name, fields.price, { data: fields.data, maker: { id: ME, name: "Mefi" } }) } }) } });
  const card = await open(env, "make");
  assert.deepEqual(shopCalls(env, "shop"), [["shop", "mine"]]);
  const set = async (id, value, type = "input") => { const field = card.querySelector(`#${id}`); field.value = value; await field.trigger(type); };
  await set("friends-shop-pack-name", "Night market");
  for (const [key, value] of Object.entries({ accent: "#ffb347", accent2: "#7f5af0", background: "#000000", surface: "#1b1b22", text: "#ffffff" })) await set(`friends-shop-colour-${key}-hex`, value);
  const readout = () => card.querySelector("#friends-shop-contrast").textContent;
  assert.match(readout(), /Text on background 21:1✓ Easy to read/);
  assert.match(readout(), /Text on panels \d+(\.\d)?:1✓ Easy to read/);
  assert.match(readout(), /Accent on background \d+(\.\d)?:1✓ Reads as text/);
  const preview = card.querySelector("#friends-shop-make-preview");
  assert.equal(preview.style["--pack-bg"], "#000000");
  assert.equal(preview.querySelector(".friends-shop-mock-title").textContent, "Night market");
  assert.equal(card.querySelector("#friends-shop-check").textContent, "Ready to publish, free.");
  // Grey text on a grey background: the readout says so and Publish is held with the reason.
  await set("friends-shop-colour-text-hex", "#222222");
  assert.match(readout(), /Text on background 1\.\d:1Needs 4\.5:1/);
  assert.match(card.querySelector("#friends-shop-check").textContent, /^Text on background is 1\.\d:1\. It needs 4\.5:1 to be easy to read\.$/);
  assert.equal(card.querySelector("#friends-shop-publish").getAttribute("aria-disabled"), "true");
  await card.querySelector("#friends-shop-form").trigger("submit");
  await flush();
  assert.equal(shopCalls(env, "shopPublish").length, 0, "nothing is sent while the check fails");
  assert.match(status(card), /^Not published yet: Text on background is 1\.\d:1\./);
  await set("friends-shop-colour-text-hex", "#fff");
  assert.equal(card.querySelector("#friends-shop-colour-text-hex").getAttribute("aria-invalid"), "true");
  assert.equal(card.querySelector("#friends-shop-check").textContent, "Text: enter a colour as #RRGGBB.");
  await set("friends-shop-colour-text-hex", "#FFFFFF");
  // For credits: 30.
  await set("friends-shop-pack-price-mode", "credits", "change");
  assert.equal(card.querySelector("#friends-shop-pack-price").hidden, false);
  await set("friends-shop-pack-price", "30");
  assert.equal(card.querySelector("#friends-shop-check").textContent, "Ready to publish for 30 credits.");
  await set("friends-shop-pack-node", "crystal", "change");
  assert.equal(preview.dataset.nodeStyle, "crystal");
  await card.querySelector("#friends-shop-use-mine").click();
  const local = acted(env);
  assert.equal(local[0], "music.applyPack");
  assert.match(local[1].id, /^local:/, "Use it myself stays on this PC: a local id, no relay");
  assert.equal(local[2], true);
  assert.equal(shopCalls(env, "shopPublish").length, 0);
  await card.querySelector("#friends-shop-form").trigger("submit");
  await flush();
  assert.deepEqual(shopCalls(env, "shopPublish"), [["shopPublish", { name: "Night market", blurb: "", price: 30, data: { v: 1, palette: { accent: "#ffb347", accent2: "#7f5af0", background: "#000000", surface: "#1b1b22", text: "#ffffff" }, nodeStyle: "crystal", material: "studio", font: "studio" } }]]);
  assert.equal(status(card), "Night market is in the Shop, for 30 credits.");
  assert.equal(card.querySelector("#friends-shop-publish").textContent, "Save changes", "the editor now changes the published pack");
});

test("selling for credits waits for good standing; free packs publish now", async () => {
  const until = Date.UTC(2026, 10, 3);
  const env = environment({ views: { mine: { ok: true, items: [], next: null, balance: 0, canEarn: false, hold: { reason: "new-account", until } } }, answers: { shopPublish: { ok: false, error: "hold", hold: { reason: "new-account", until } } } });
  const card = await open(env, "make");
  assert.match(card.querySelector(".friends-shop-hold").textContent, /^Selling for credits: Credits start when your Discord account is 30 days old on .+ You can publish it free now\.$/);
  const mode = card.querySelector("#friends-shop-pack-price-mode");
  assert.equal(mode.children.find((option) => option.value === "credits").disabled, true);
  assert.match(card.querySelector("#friends-shop-mine").textContent, /You have not published a style pack yet\. Make one above, then press Publish\./, "an empty list says the next step");
});

test("Publish's refusals in plain words: the relay's limits, a name clash and a hold (a word and its day)", async () => {
  const until = Date.UTC(2026, 10, 3);
  const cases = [
    [{ ok: false, error: "limit", reason: "listed-packs" }, "You have 12 packs listed. Unlist one to publish another."],
    [{ ok: false, error: "limit", reason: "daily-publishes" }, "You have published 4 packs today. Try again tomorrow."],
    [{ ok: false, error: "limit", reason: "shop-full" }, "The Shop is full right now. Try again another day."],
    [{ ok: false, error: "conflict", reason: "name-taken" }, "You already have a listed pack with that name."],
    [{ ok: false, error: "low-contrast" }, "Its text is too hard to read: text needs 4.5:1 on the background and on panels, and so does the accent on the background (it is read as text too)."],
    [{ ok: false, error: "hold", hold: "new-account", until }, /^Credits start when your Discord account is 30 days old on .+ You can publish it free now\.$/],
  ];
  for (const [answer, words] of cases) {
    const env = environment({ answers: { shopPublish: answer } });
    const card = await open(env, "make");
    const name = card.querySelector("#friends-shop-pack-name");
    name.value = "Night market";
    await name.trigger("input");
    await card.querySelector("#friends-shop-form").trigger("submit");
    await flush();
    assert.equal(shopCalls(env, "shopPublish").length, 1, `${answer.error} ${answer.reason ?? ""}: sent once`);
    if (typeof words === "string") assert.equal(status(card), words);
    else assert.match(status(card), words);
  }
});

test("Your packs: how many times each was got and credits earned, Edit reopens the editor, Unlist and List again", async () => {
  const env = environment();
  const card = await open(env, "make");
  const mine = card.querySelector("#friends-shop-mine");
  assert.match(mine.textContent, /Tide poolListed · 40 credits · Got 5 times · 120 credits earned/);
  assert.match(mine.textContent, /Old paperNot listed · Free · Got once/);
  await one(mine, "Unlist").click();
  await flush();
  assert.deepEqual(shopCalls(env, "shopUnlist"), [["shopUnlist", "pack_mine0000000001"]]);
  assert.equal(status(card), "Tide pool is no longer listed. Members who got it keep it.");
  await one(card.querySelector("#friends-shop-mine"), "List again").click();
  await flush();
  assert.deepEqual(shopCalls(env, "shopUpdate"), [["shopUpdate", "pack_mine0000000002", { listed: true }]]);
  const tide = card.querySelectorAll("li").find((row) => row.dataset.item === "pack_mine0000000001");
  await one(tide, "Edit").click();
  assert.equal(card.querySelector("#friends-shop-pack-name").value, "Tide pool");
  assert.equal(card.querySelector("#friends-shop-colour-background-hex").value, "#101014");
  assert.equal(card.querySelector("#friends-shop-make-title").textContent, "Change Tide pool");
  await card.querySelector("#friends-shop-form").trigger("submit");
  await flush();
  assert.deepEqual(shopCalls(env, "shopUpdate").at(-1), ["shopUpdate", "pack_mine0000000001", { name: "Tide pool", blurb: "", price: 40, data: NIGHT }]);
  assert.equal(status(card), "Tide pool is saved. Members who got it see the new look.");
  await one(card, "Start a new style").click();
  assert.equal(card.querySelector("#friends-shop-pack-name").value, "");
  assert.equal(card.querySelector("#friends-shop-publish").textContent, "Publish");
  const fresh = environment({ views: { mine: { ok: true, items: [{ ...MINE[0], sales: 0 }], next: null, balance: 0, canEarn: true, hold: null } } });
  assert.match((await open(fresh, "make")).querySelector("#friends-shop-mine").textContent, /No one has got it yet/);
});

test("Report on a member's pack: a reason and an optional line; Remove only for moderators", async () => {
  const env = environment();
  const card = await open(env, "packs");
  const night = await detail(card, "pack_nightmarket0001");
  assert.equal(buttons(night, "Remove").length, 0, "members never see Remove");
  await one(night, "Report").click();
  const form = night.querySelector("form.friends-shop-report");
  assert.ok(form);
  await form.trigger("submit");
  assert.equal(status(card), "Choose what is wrong with it first.");
  assert.equal(shopCalls(env, "shopReport").length, 0);
  form.querySelectorAll("input").find((radio) => radio.type === "radio" && radio.value === "Copies someone else's work").checked = true;
  form.querySelector(".friends-shop-report-text").value = "  It is the Synthwave pack renamed.  ";
  await form.trigger("submit");
  await flush();
  assert.deepEqual(shopCalls(env, "shopReport"), [["shopReport", "pack_nightmarket0001", { reason: "Copies someone else's work", text: "It is the Synthwave pack renamed." }]]);
  assert.equal(status(card), "Thanks. A moderator will look at it.");
  assert.equal(night.querySelector("form.friends-shop-report"), null);
  const studioCard = await open(environment(), "studio");
  assert.equal(buttons(await detail(studioCard, "studio:pack-synthwave"), "Report").length, 0, "Studio's own items are not reported");

  const mod = environment({ moderator: true });
  const modCard = await open(mod, "packs");
  await one(await detail(modCard, "pack_nightmarket0001"), "Remove").click();
  await flush();
  assert.deepEqual(shopCalls(mod, "modShopRemove"), [["modShopRemove", "pack_nightmarket0001", {}]]);
  assert.equal(status(modCard), "Night market is out of the Shop.");
  assert.equal(detailOf(modCard).open, false, "the detail of a pack that is gone closes");
});

test("its own page: the route shop opens and closes it, open(view) goes there, and the page kill switch keeps it a Friends place", async () => {
  const env = environment();
  const dest = env.registered.find((entry) => entry.id === "shop");
  assert.ok(dest, "MefiNav knows the route");
  assert.deepEqual([dest.kind, dest.layer, dest.section, dest.element, dest.focus, dest.glyph], ["overlay", "sheet", "friends", "friends-shop-page", "#friends-shop-title", "g-shop"]);
  assert.equal(dest.showIn.palette, false, "Search finds it through Friends' own Shop row, which opens this page");
  assert.equal(dest.isOpen(), false);
  dest.open({ view: "packs" });
  await flush();
  const page = env.document.body.querySelector("#friends-shop-page");
  assert.ok(page, "a page of its own");
  assert.ok(page.classList.contains("workspace-page") && page.classList.contains("friends-shop-page"));
  assert.equal(page.hidden, false);
  assert.deepEqual(env.claimed, ["shop"]);
  const root = page.querySelector("#friends-shop");
  assert.equal(root.dataset.view, "packs", "on the view it was asked for");
  assert.ok(root.classList.contains("is-page"));
  assert.equal(dest.isOpen(), true);
  await one(await detail(root, "pack_nightmarket0001"), "Try for 2 minutes").click();
  dest.close();
  assert.equal(page.hidden, true);
  assert.deepEqual(env.released, ["shop"]);
  assert.ok(env.shown.some(([what]) => what === "music.endPreview"), "leaving the page ends a try");
  assert.equal(page.querySelector("#friends-shop"), null, "nothing of it is left running");
  assert.equal(env.shop.open("owned"), true);
  assert.deepEqual(env.went.at(-1), ["shop", { view: "owned" }]);
  assert.equal(env.shop.pageOn(), true);
  const old = environment({ storage: new Map([["mefiStudio.shop.page", "off"]]) });
  assert.equal(old.shop.pageOn(), false);
  old.shop.open("owned");
  assert.deepEqual(old.went.at(-1), ["friends-page", { place: "shop" }], "with the page off, the Shop is Friends' place again");
  assert.equal((await open(old)).dataset.view, "owned");
});

test("the route, the place, Search, Social and Settings know the Shop; text only, and none of the old words", async () => {
  assert.match(hubSource, /\{ id: "shop", label: "Shop", glyph: "g-shop", about: "[^"]+" \}/);
  assert.match(hubSource, /if \(\(params\.place === "shop" \|\| params\.target === "shop"\) && window\.MefiShop\?\.pageOn\?\.\(\) === true\) return window\.MefiNav\?\.go\?\.\("shop"\) \?\? false;/, "Friends' place opens the page");
  assert.match(hubSource, /const here = friendsOpen\(\) \? friendsPage\.place : window\.MefiNav\?\.current\?\.\(\) === "shop" \? "shop" : null;/, "and is current while it shows");
  assert.ok(hubSource.indexOf('id: "shop"') < hubSource.indexOf('id: "mod"'), "the Shop comes before Moderation");
  assert.match(navSource, /\["friends-shop", "Shop", "g-shop", "[^"]+", "shop", "shop store buy credits pet dragon effects dissolve style pack theme make sell scales tip"\]/);
  assert.match(navSource, /"friends-events": "events", "friends-shop": "shop" \};/);
  assert.match(navSource, /if \(id === "friends-page" && params\?\.place === "shop" && window\.MefiShop\?\.pageOn\?\.\(\) === true && get\("shop"\)\) \{/, "every way in lands on the page");
  assert.match(navSource, /WORKSPACE_PAGES\.add\("shop"\);/);
  assert.match(navSource, /friends: \["friends-page", "shop"\],/);
  assert.match(navSource, /"project-hub", "friends-events", "friends-shop"\]\) \{ const dest = get\(id\);/);
  assert.match(shellSource, /current: \(id === "friends-page" \|\| \(id === "shop" && place\.id === "shop"\)\) && Boolean\(place\.current\)/, "the list column marks the Shop's row");
  assert.match(shellSource, /if \(place === "friends" && id === "shop"\) return \["Friends", "Shop"\];/, "the breadcrumb says Friends / Shop");
  assert.match(socialSource, /const PAGES = Object\.freeze\(\[[^\]]*"shop"\]\);/, "the page stays in Social");
  assert.match(builder, /"friends-events\.js",\n {4}"friends-shop\.js",/);
  assert.match(builder, /"friends-events\.css",\n {4}"friends-shop\.css",/);
  assert.match(template, /<symbol id="g-shop" viewBox="0 0 16 16">/);
  assert.equal((template.match(/<symbol id="g-shop"/g) ?? []).length, 1);
  assert.ok(!/innerHTML/.test(source), "text only, never markup");
  for (const [name, text] of [["friends-shop.js", source], ["friends-shop.css", styles]]) assert.doesNotMatch(text, /perk|unlock|premium|entitlement/i, `${name} sells and owns; it never uses the old words`);
  assert.doesNotMatch(styles, /#[0-9a-f]{3,8}\b/i, "the stylesheet uses the theme's tokens, no fixed colours");
  for (const size of styles.matchAll(/font(?:-size)?:[^;]*?(\d+(?:\.\d+)?)px/g)) assert.ok(Number(size[1]) >= 12, `no text under 12px (${size[0]})`);
  assert.match(styles, /\.friends-shop-item:has\(\.friends-shop-open:focus-visible\) \{ outline: 2px solid var\(--gold-bright\)/, "the keyboard's ring goes round the whole card");
  assert.match(styles, /\.friends-shop-hero :is\(\.friends-shop-hero-kicker, \.friends-shop-hero-name, \.friends-shop-hero-blurb, \.friends-shop-hero-note\) \{ color: var\(--drop-ink\); \}/, "the banner's words keep the drop's ink in every theme");
});

test("Settings › Appearance's Theme section gets a way in to the Shop", async () => {
  const env = environment({
    before: (document) => {
      const look = document.createElement("div"); look.id = "music-look";
      const theme = document.createElement("section"); theme.className = "music-section music-colors"; theme.dataset.appearancePanel = "themes";
      look.append(theme); document.body.append(look);
    },
  });
  const cardIn = env.document.querySelector("#friends-shop-settings");
  assert.ok(cardIn, "mounted beside the colour themes");
  assert.equal(cardIn.dataset.appearancePanel, "themes", "the Theme tab shows and hides it with the themes");
  assert.equal(cardIn.querySelector("h3").textContent, "Pets, menu effects and style packs");
  assert.equal(env.shop.mountSettings(), true);
  assert.equal(env.document.querySelectorAll("#friends-shop-settings").length, 1, "mounted once");
  await one(cardIn, "Open the Shop").click();
  assert.deepEqual(env.went.at(-1), ["shop", { view: "studio" }]);
});

// The Shop's editor and the relay judge a pack the same way: every case in the
// shared fixture gets the same answer from both (relay/src/shop-pack.mjs).
test("the editor's pack check and the relay's agree on every shared case", async () => {
  const { checkPack: relayCheck } = await import("../relay/src/shop-pack.mjs");
  const cases = JSON.parse(await readFile(new URL("./fixtures/shop-pack-cases.json", import.meta.url), "utf8"));
  const { shop } = environment();
  assert.ok(cases.length >= 8, "the fixture has cases");
  for (const item of cases) {
    const relay = relayCheck(item.data);
    const studio = shop.checkPack(item.data);
    assert.equal(relay.ok, item.ok, `relay: ${item.name}`);
    assert.equal(studio.ok, item.ok, `Studio: ${item.name}`);
    if (!item.ok) assert.equal(studio.error, relay.error, `same refusal: ${item.name}`);
  }
});
