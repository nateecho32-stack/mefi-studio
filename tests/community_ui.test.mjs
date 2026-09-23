// renderer/community.js in a vm with a fake DOM, bridge, storage and clock:
// the member-perk gate (window.MefiCommunity), the boot hint, the weekly
// Discord card's quiet gates and buttons, Settings › Community and the
// palette action. The DOM elements the module looks up are built from the
// real template, so a renamed id fails here instead of in the app.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const source = await readFile(new URL("../renderer/community.js", import.meta.url), "utf8");
const musicSource = await readFile(new URL("../renderer/music.js", import.meta.url), "utf8");
const workspaceSource = await readFile(new URL("../renderer/workspace.js", import.meta.url), "utf8");
const template = await readFile(new URL("../renderer/booklet.template.html", import.meta.url), "utf8");
const buildSource = await readFile(new URL("../scripts/build-booklet.mjs", import.meta.url), "utf8");
const onboardingSource = await readFile(new URL("../renderer/onboarding.js", import.meta.url), "utf8");
const booklet = await readFile(new URL("../renderer/booklet.js", import.meta.url), "utf8");

const FORK = "Members of the Void Engine Discord unlock these. Studio is MIT-licensed: fork the project and unlock it yourself, or ask an agent to do it for you.";
const AGENT = "In my fork of Mefi's Studio AI+, set SELF_UNLOCKED to true in scripts/community.cjs so the Void collection themes and node styles unlock without Discord, then run npm run check and npm test.";
const HINT_KEY = "mefiStudio.community.v1";
// The second sentence of a locked item's note, for a configured, unlinked build.
const LINK_HINT = "Link your Discord membership to use it, or build it yourself (see below).";
const PRIVACY = "Linking reads your Discord id and name, and your roles and join date in the Void Engine server: when you link, about once a week (sooner after a failed check, then daily), and when you press Check now. Studio keeps them in its settings on this computer, with the sign-in encrypted in community-auth.json. Nothing about your projects is sent. Unlink revokes the sign-in and deletes both.";
// What music.js's MefiMusic.premiumCatalog() hands the Community card.
const CATALOG = {
  themes: [
    { key: "void", name: "Void", accent: "#7c6cff", bright: "#b9b0ff", accent2: "#36d1ff" },
    { key: "eclipse", name: "Eclipse", accent: "#e8a93c", bright: "#ffd98a", accent2: "#ff6a3d" },
    { key: "abyss", name: "Abyss", accent: "#2fd6c3", bright: "#8ff5e8", accent2: "#7b5cff" },
    { key: "dusk", name: "Neon Dusk", accent: "#ff5fa2", bright: "#ffa3cb", accent2: "#3fd0ff" },
  ],
  nodeStyles: [
    { key: "singularity", name: "Singularity", detail: "A black hole with a turning disc" },
    { key: "prism", name: "Prism", detail: "A turning crystal that splits light" },
    { key: "sigil", name: "Sigil", detail: "Hex runes that assemble as it works" },
  ],
};
const MINUTE = 60000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 8, 22, 12, 0, 0);

// Every id the module reaches through $("...") or wires with on("..."), with
// its tag and initial hidden state read from the template.
const LOOKED_UP = [...new Set([...source.matchAll(/(?:\$|\bon)\("([\w-]+)"/g)].map((match) => match[1]))];
function templateElement(id) {
  const match = template.match(new RegExp(`<(\\w+)\\s[^>]*\\bid="${id}"[^>]*>`));
  if (!match) return null;
  return { tag: match[1].toLowerCase(), hidden: /\shidden(?=[\s>=])/.test(match[0]) };
}

// The fake document's activeElement: focus() sets it, and each environment()
// starts it over. A removed element keeps it, as nothing here blurs.
let focused = null;
class Element {
  constructor(tag = "div", id = "") {
    this.tag = tag; this.id = id; this.children = []; this.listeners = {}; this.attrs = {}; this.dataset = {};
    this.style = { props: {}, setProperty(name, value) { this.props[name] = String(value); } };
    this.hidden = false; this.disabled = false; this.open = false; this.className = ""; this.title = ""; this.type = "";
    this.copy = ""; this.scrolled = 0;
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
      toggle: (name, force) => { const on = force === undefined ? !classes.has(name) : Boolean(force); if (on) classes.add(name); else classes.delete(name); return on; },
    };
  }
  set textContent(value) { this.copy = String(value); this.children = []; }
  get textContent() { return this.copy + this.children.map((child) => child.textContent).join(""); }
  append(...items) { for (const item of items) { this.children.push(item); item.parent = this; } }
  replaceChildren(...items) { this.children = []; this.copy = ""; this.append(...items); }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key] ?? null; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  emit(type, extra = {}) {
    const event = { type, target: this, prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() {}, ...extra };
    for (const fn of this.listeners[type] || []) fn(event);
    return event;
  }
  click() { if (!this.disabled) this.emit("click"); }
  scrollIntoView() { this.scrolled += 1; }
  focus() { focused = this; }
  all() { return this.children.flatMap((child) => [child, ...child.all()]); }
  button(label) { return this.all().find((child) => child.tag === "button" && child.textContent === label) ?? null; }
  labels() { return this.all().filter((child) => child.tag === "button").map((child) => child.textContent); }
}

function status(overrides = {}) {
  return {
    available: true, configured: true, linked: false, linking: false, selfUnlocked: false,
    user: null, roles: [], state: null,
    entitlement: { premium: false, perks: [], validUntil: null, reason: "unlinked" },
    checkedAt: null, lastOkAt: null, nextCheckAt: null,
    prompt: { due: false, never: false, snoozeUntil: null },
    inviteUrl: "https://discord.gg/xgfKc5pVxG", serverUrl: "https://discord.com/channels/1345380333302059129",
    forkCopy: FORK, agentPrompt: AGENT,
    ...overrides,
  };
}
const due = (overrides = {}) => status({ prompt: { due: true, never: false, snoozeUntil: null }, ...overrides });
const member = (overrides = {}) => status({
  linked: true, state: "ok", user: { id: "42", username: "nova_builder", globalName: "Nova Builder" }, roles: ["111", "222"],
  entitlement: { premium: true, perks: ["premium"], validUntil: T0 + 14 * DAY, reason: "member" },
  checkedAt: T0 - 2 * HOUR, lastOkAt: T0 - 2 * HOUR, nextCheckAt: T0 + 6 * DAY,
  ...overrides,
});

function fakeBridge(initial = status(), overrides = {}) {
  let current = initial;
  const calls = [];
  const listeners = [];
  const reply = () => ({ ok: true, status: current });
  return {
    calls, listeners,
    set(next) { current = next; },
    push(next) { current = next; for (const fn of listeners) fn(next); },
    communityStatus: async () => { calls.push(["status"]); return reply(); },
    communityLink: async () => { calls.push(["link"]); return reply(); },
    communityLinkCancel: async () => { calls.push(["link-cancel"]); return reply(); },
    communityCheck: async () => { calls.push(["check"]); return reply(); },
    communityUnlink: async () => { calls.push(["unlink"]); return reply(); },
    communityPrompt: async (action) => {
      calls.push(["prompt", action]);
      if (["shown", "snooze", "never", "joined"].includes(action)) current = { ...current, prompt: { ...current.prompt, due: false, never: action === "never" } };
      return reply();
    },
    communityOpen: async (target) => { calls.push(["open", target]); return reply(); },
    onCommunityEvent: (fn) => { listeners.push(fn); },
    shellCopy: async (text) => { calls.push(["copy", text]); return { ok: true }; },
    ...overrides,
  };
}

// music: a MefiMusic stand-in (the catalog); prepare(elements): runs on the
// fake DOM before the module does, e.g. to give the theme select its options.
function environment({ bridge = null, storage = new Map(), search = "", workspace = true, guide = "complete", noMotion = false, missing = [], music = null, prepare = null } = {}) {
  focused = null;
  const clock = { now: T0 };
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.now])); }
    static now() { return clock.now; }
  }
  const timers = []; let sequence = 0;
  const setTimer = (fn, ms = 0) => { const id = ++sequence; timers.push({ id, at: clock.now + Math.max(0, Number(ms) || 0), fn }); return id; };
  const clearTimer = (id) => { const at = timers.findIndex((timer) => timer.id === id); if (at >= 0) timers.splice(at, 1); };
  const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
  async function advance(ms) {
    const end = clock.now + ms;
    for (;;) {
      await settle();
      timers.sort((a, b) => a.at - b.at || a.id - b.id);
      const next = timers[0];
      if (!next || next.at > end) break;
      timers.shift();
      clock.now = next.at;
      next.fn();
    }
    clock.now = end;
    await settle();
  }

  const elements = new Map();
  for (const id of [...LOOKED_UP, "boot-layer", "community-invite-title"]) {
    if (missing.includes(id)) continue;
    const shape = templateElement(id);
    if (!shape) continue;
    const element = new Element(shape.tag, id);
    element.hidden = shape.hidden;
    elements.set(id, element);
  }
  elements.get("boot-layer").hidden = true;
  const windowListeners = new Map(); const documentListeners = new Map();
  const listen = (map) => (type, fn) => { const list = map.get(type) ?? []; list.push(fn); map.set(type, list); };
  const fire = (map) => (type, event = {}) => { for (const fn of [...(map.get(type) || [])]) fn({ type, preventDefault() {}, stopPropagation() {}, ...event }); };
  const document = {
    readyState: "complete", visibilityState: "visible", get activeElement() { return focused; }, body: new Element("body"),
    getElementById: (id) => elements.get(id) ?? null,
    createElement: (tag) => new Element(tag),
    addEventListener: listen(documentListeners),
  };
  // routes: the destination ids; visits: each go() with its params (a deep link).
  const routes = []; const visits = []; const toasts = []; const events = []; const registered = []; const polls = [];
  const window = {
    location: { search },
    mefiStudio: bridge,
    MefiNav: { register: (dest) => { registered.push(dest); return dest; }, go: (id, params) => { routes.push(id); visits.push({ id, params: params ? { ...params } : null }); }, state: { transient: null, sheet: null }, noMotion: () => noMotion },
    MefiOnboarding: { status: () => guide },
    MefiWorkspace: { isActive: () => workspace },
    MefiToast: (message, kind, options) => { toasts.push({ message, kind, options }); return { dismiss() {} }; },
    MefiBoot: { pollStart: (key, fn, ms) => { polls.push({ key, fn, ms }); return key; } },
    ...(music ? { MefiMusic: music } : {}),
    addEventListener: listen(windowListeners),
    dispatchEvent: (event) => { events.push(event); return true; },
  };
  class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }
  prepare?.(elements);
  const context = vm.createContext({
    window, document, console, URLSearchParams, CustomEvent, Date: FakeDate,
    setTimeout: setTimer, clearTimeout: clearTimer,
    getComputedStyle: (element) => ({ display: element.hidden ? "none" : "block" }),
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) },
  });
  vm.runInContext(source, context);
  return {
    api: window.MefiCommunity, window, document, bridge, storage, clock, timers, routes, visits, toasts, events, registered, polls,
    el: (id) => elements.get(id) ?? null,
    set guide(value) { guide = value; },
    set workspace(value) { workspace = value; },
    fireWindow: fire(windowListeners),
    fireDocument: fire(documentListeners),
    settle, advance,
    // startup, the first status read, and the first scheduled card attempt.
    async boot() { window.MefiCommunity.startup(); await advance(4000); },
  };
}

const card = (env) => env.el("community-invitation");
const body = (env) => env.el("community-settings-body");

test("the fork sentence and agent prompt are exact, and match scripts/community.cjs when it exists", () => {
  const env = environment();
  assert.equal(env.api.FORK_COPY, FORK);
  assert.equal(env.api.AGENT_PROMPT, AGENT);
  assert.ok(template.includes(FORK), "the weekly card's fine print carries the fork sentence");
  assert.equal(env.el("community-invite-fine").textContent, FORK);
  // music.js reads MefiCommunity.FORK_COPY; its fallback for start:web and load order is the same sentence.
  assert.ok(musicSource.includes(`const FORK_FALLBACK = ${JSON.stringify(FORK)};`), "music.js's fallback fork sentence");
  assert.match(musicSource, /window\.MefiCommunity\?\.FORK_COPY/);
  const rules = new URL("../scripts/community.cjs", import.meta.url);
  if (existsSync(rules)) {
    const community = createRequire(import.meta.url)(fileURLToPath(rules));
    assert.equal(community.FORK_COPY, FORK, "the renderer copy is a duplicate of the rules module's");
    assert.equal(community.AGENT_PROMPT, AGENT);
  }
});

test("every id the module looks up exists in the template", () => {
  assert.ok(LOOKED_UP.length >= 10);
  for (const id of LOOKED_UP) assert.ok(templateElement(id), `#${id} must exist in booklet.template.html`);
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|outerHTML/, "dynamic text goes through textContent only");
  const settings = template.match(/<details[^>]*id="settings-community"[^>]*>/)[0];
  assert.doesNotMatch(settings, /\sopen/, "Settings › Community is closed by default");
  assert.ok(template.indexOf('id="settings-community"') > template.indexOf('id="settings-studio"'), "the card sits after #settings-studio");
  assert.ok(template.includes('data-settings-jump="settings-community"'), "the settings nav can jump to it");
  assert.ok(template.indexOf('id="community-invitation"') > template.indexOf('id="walkthrough-invitation"'), "the weekly card follows the walkthrough invitation");
  assert.match(template, /<optgroup label="Void collection · Discord members"><option value="void">Void<\/option><option value="eclipse">Eclipse<\/option><option value="abyss">Abyss<\/option><option value="dusk">Neon Dusk<\/option><\/optgroup>/);
});

test("registration: bundled after music and onboarding, before booklet, and started from the boot callback", () => {
  assert.match(buildSource, /readFile\(path\.join\(RENDERER, "community\.js"\), "utf8"\)/);
  const joined = buildSource.match(/const codeParts = \[([^\]]+)\]/)[1].split(",").map((name) => name.trim());
  assert.ok(joined.indexOf("music") < joined.indexOf("community"));
  assert.ok(joined.indexOf("onboarding") < joined.indexOf("community"));
  assert.equal(joined.indexOf("community"), joined.indexOf("booklet") - 1);
  const sources = [...buildSource.match(/const CODE_SOURCES = \[([^\]]+)\]/)[1].matchAll(/"([\w.-]+)\.js"/g)].map((match) => match[1]);
  assert.equal(sources.indexOf("community"), sources.indexOf("booklet") - 1, "the source map lists it in the same place");
  assert.match(onboardingSource, /status: \(\) => state\.status/, "MefiOnboarding exposes the walkthrough status the card waits on");
  assert.ok(booklet.indexOf("window.MefiCommunity?.startup?.()") > booklet.indexOf("window.MefiOnboarding?.startup?.({ automatic: true })"));
});

test("no bridge: nothing unlocks, the card never shows and Settings says linking needs the desktop app", async () => {
  const storage = new Map([[HINT_KEY, JSON.stringify({ premium: true, validUntil: null })]]);
  const env = environment({ storage });
  assert.equal(env.api.has("premium"), false, "a leftover hint unlocks nothing without the desktop bridge");
  await env.boot();
  await env.advance(HOUR);
  assert.equal(card(env).hidden, true);
  assert.equal(env.events.length, 0);
  assert.equal(env.polls.length, 0);
  assert.match(body(env).textContent, /needs the desktop app/);
  assert.ok(body(env).textContent.includes(FORK));
  assert.equal(env.api.open(), false);
  assert.deepEqual(env.routes, []);
  assert.match(env.toasts.at(-1).message, /needs the desktop app/);
  await env.api.join();
  assert.equal(env.api.status(), null);
});

test("the boot hint answers has('premium') before the first status, and every status rewrites it", async () => {
  const storage = new Map([[HINT_KEY, JSON.stringify({ premium: true, validUntil: T0 + DAY })]]);
  const bridge = fakeBridge(status());
  const env = environment({ bridge, storage });
  assert.equal(env.api.has("premium"), true, "a member's theme paints on launch");
  assert.equal(env.api.has("other"), false, "the hint covers premium alone");
  const stale = environment({ bridge: fakeBridge(), storage: new Map([[HINT_KEY, JSON.stringify({ premium: true, validUntil: T0 - 1 })]]) });
  assert.equal(stale.api.has("premium"), false, "an expired hint unlocks nothing");
  const garbage = environment({ bridge: fakeBridge(), storage: new Map([[HINT_KEY, "{not json"]]) });
  assert.equal(garbage.api.has("premium"), false);

  await env.boot();
  const changes = () => env.events.filter((event) => event.type === "mefi-community-change");
  assert.equal(env.api.has("premium"), false, "the first status replaces the hint");
  assert.deepEqual(JSON.parse(storage.get(HINT_KEY)), { premium: false, validUntil: null });
  assert.equal(changes().length, 1, "one mefi-community-change after the first status");
  assert.deepEqual({ ...changes()[0].detail }, { premium: false, perks: [], validUntil: null, reason: "unlinked" });

  bridge.push(member());
  assert.equal(env.api.has("premium"), true);
  assert.deepEqual(JSON.parse(storage.get(HINT_KEY)), { premium: true, validUntil: T0 + 14 * DAY });
  assert.equal(changes().length, 2);
  assert.equal(changes()[1].detail.reason, "member");
  bridge.push(member({ checkedAt: T0 }));
  assert.equal(changes().length, 2, "an unchanged entitlement dispatches nothing");
  bridge.push(member({ state: "not-member", roles: [], entitlement: { premium: false, perks: [], validUntil: null, reason: "not-member" } }));
  assert.equal(env.api.has("premium"), false);
  assert.equal(changes().length, 3);
});

test("mefi-community-status follows whether linking is possible, even with the entitlement unchanged", async () => {
  const bridge = fakeBridge(status({ configured: false }));
  const env = environment({ bridge });
  await env.boot();
  const updates = () => env.events.filter((event) => event.type === "mefi-community-status").map((event) => ({ ...event.detail }));
  assert.deepEqual(updates(), [{ configured: false, linked: false, state: null, linking: false }], "one after the first status");
  bridge.push(status({ configured: false, prompt: { due: true, never: false, snoozeUntil: null } }));
  assert.equal(updates().length, 1, "a change that does not touch linking dispatches nothing");
  const expired = { premium: false, perks: [], validUntil: T0 - DAY, reason: "expired" };
  bridge.push(member({ state: "offline", entitlement: expired }));
  bridge.push(member({ state: "relink", entitlement: expired }));
  assert.deepEqual(updates().at(-1), { configured: true, linked: true, state: "relink", linking: false });
  assert.equal(env.events.filter((event) => event.type === "mefi-community-change").length, 2, "the entitlement itself did not change between offline and relink");
});

test("the weekly card shows once when due and every quiet gate holds, and records it", async () => {
  const bridge = fakeBridge(due());
  const env = environment({ bridge });
  await env.boot();
  assert.equal(card(env).hidden, false);
  assert.deepEqual(bridge.calls.filter(([name]) => name === "prompt"), [["prompt", "shown"]]);
  assert.match(template, /<strong id="community-invite-title">Build with others in the Void Engine Discord<\/strong>/);
  assert.equal(env.el("community-invite-link").hidden, false);
  assert.equal(env.el("community-invite-copy").hidden, true, "the weekly card keeps to its four buttons");
  assert.equal(env.el("community-invite-note").hidden, true);
  assert.ok(card(env).classList.contains("community-enter"));
  assert.equal(env.polls[0].key, "community.prompt");
  assert.equal(env.polls[0].ms, 6 * HOUR);

  env.el("community-invite-later").click();
  await env.settle();
  assert.equal(card(env).hidden, true);
  bridge.push(due());
  env.polls[0].fn();
  env.fireDocument("visibilitychange");
  await env.advance(HOUR);
  assert.equal(card(env).hidden, true, "at most once a session");
});

test("the card waits until it is due, and never for a member", async () => {
  const bridge = fakeBridge(status());
  const env = environment({ bridge });
  await env.boot();
  await env.advance(HOUR);
  assert.equal(card(env).hidden, true);
  bridge.push(due());
  await env.advance(4000);
  assert.equal(card(env).hidden, false, "a pushed due status schedules the card");

  const entitled = environment({ bridge: fakeBridge(due({ entitlement: { premium: true, perks: ["premium"], validUntil: null, reason: "self" } })) });
  await entitled.boot();
  await entitled.advance(HOUR);
  assert.equal(card(entitled).hidden, true);
});

test("capture and smoke launches never show the card or read the status", async () => {
  for (const search of ["?capture=1", "?smoke=1"]) {
    const bridge = fakeBridge(due());
    const env = environment({ bridge, search });
    await env.boot();
    await env.advance(DAY);
    assert.equal(card(env).hidden, true, search);
    assert.deepEqual(bridge.calls, [], search);
  }
});

test("an open dialog, the boot gate, a new or unfinished walkthrough, typing or a hidden window hold the card", async () => {
  const gates = [
    ["transient", (env) => { env.window.MefiNav.state.transient = "palette"; }, (env) => { env.window.MefiNav.state.transient = null; }],
    ["boot gate", (env) => { env.el("boot-layer").hidden = false; }, (env) => { env.el("boot-layer").hidden = true; }],
    ["walkthrough new", (env) => { env.guide = "new"; }, (env) => { env.guide = "complete"; }],
    ["walkthrough reading", (env) => { env.guide = "reading"; }, (env) => { env.guide = "dismissed"; }],
    // The two invitations never stack, whatever the guide's status says.
    ["walkthrough invitation showing", (env) => { env.el("walkthrough-invitation").hidden = false; }, (env) => { env.el("walkthrough-invitation").hidden = true; }],
    ["hidden window", (env) => { env.document.visibilityState = "hidden"; }, (env) => { env.document.visibilityState = "visible"; }],
  ];
  for (const [label, block, clear] of gates) {
    const env = environment({ bridge: fakeBridge(due()) });
    block(env);
    await env.boot();
    await env.advance(MINUTE);
    assert.equal(card(env).hidden, true, `${label} holds the card`);
    clear(env);
    await env.advance(5000);
    assert.equal(card(env).hidden, false, `${label} released lets the card through`);
  }

  const typing = environment({ bridge: fakeBridge(due()) });
  typing.fireWindow("keydown", { key: "a" });
  await typing.boot();
  await typing.advance(35000);
  assert.equal(card(typing).hidden, true, "a key pressed in the last 45 s holds the card");
  await typing.advance(15000);
  assert.equal(card(typing).hidden, false);
});

test("the retry loop is bounded; a return to the window tries again", async () => {
  const bridge = fakeBridge(due());
  const env = environment({ bridge });
  env.window.MefiNav.state.transient = "help";
  await env.boot();
  await env.advance(125 * 5000);
  assert.equal(env.timers.length, 0, "no timer survives the retry budget");
  env.window.MefiNav.state.transient = null;
  await env.advance(HOUR);
  assert.equal(card(env).hidden, true);
  env.fireDocument("visibilitychange");
  await env.advance(4000);
  assert.equal(card(env).hidden, false);
});

test("card buttons: join, link, not now, don't show again and Escape reach the right bridge calls", async () => {
  const run = async (press) => {
    const bridge = fakeBridge(due());
    const env = environment({ bridge });
    await env.boot();
    bridge.calls.length = 0;
    await press(env);
    await env.settle();
    assert.equal(card(env).hidden, true);
    return { calls: bridge.calls, env };
  };
  assert.deepEqual((await run((env) => env.el("community-invite-join").click())).calls, [["open", "invite"], ["prompt", "joined"]]);
  assert.deepEqual((await run((env) => env.el("community-invite-link").click())).calls, [["link"]]);
  assert.deepEqual((await run((env) => env.el("community-invite-later").click())).calls, [["prompt", "snooze"]]);
  const never = await run((env) => env.el("community-invite-never").click());
  assert.deepEqual(never.calls, [["prompt", "never"]]);
  assert.equal(never.env.toasts.at(-1).message, "Settings › Community has the link any time.");
  const escape = await run((env) => { const event = card(env).emit("keydown", { key: "Escape" }); assert.equal(event.prevented, true); });
  assert.deepEqual(escape.calls, [["prompt", "snooze"]]);

  const unconfigured = environment({ bridge: fakeBridge(due({ configured: false })) });
  await unconfigured.boot();
  assert.equal(card(unconfigured).hidden, false);
  assert.equal(unconfigured.el("community-invite-link").hidden, true, "no link button until the build has a Discord client id");
});

test("with reduced motion the card appears without its entrance", async () => {
  const env = environment({ bridge: fakeBridge(due()), noMotion: true });
  await env.boot();
  assert.equal(card(env).hidden, false);
  assert.equal(card(env).classList.contains("community-enter"), false);
});

test("outside the workspace the card is a toast whose action opens Settings › Community", async () => {
  const bridge = fakeBridge(due());
  const env = environment({ bridge, workspace: false });
  await env.boot();
  assert.equal(card(env).hidden, true);
  const shown = env.toasts.at(-1);
  assert.match(shown.message, /Void Engine Discord/);
  assert.equal(shown.kind, "info");
  assert.equal(shown.options.duration, 12000);
  assert.equal(shown.options.action.label, "See the perks");
  assert.deepEqual(bridge.calls.filter(([name]) => name === "prompt"), [["prompt", "shown"]]);
  shown.options.action.run();
  assert.deepEqual(env.routes, ["studio"]);
  assert.equal(env.el("settings-community").open, true);
});

test("the palette action is a palette-only action that opens Settings › Community", async () => {
  const env = environment({ bridge: fakeBridge() });
  const entry = env.registered.find((dest) => dest.id === "community");
  assert.ok(entry, "registered with MefiNav");
  assert.equal(entry.kind, "action");
  assert.equal(entry.label, "Void Engine Discord & perks");
  assert.equal(entry.showIn.palette, true);
  for (const place of ["tools", "dock", "tabs", "help", "footer"]) assert.equal(entry.showIn[place], false, `stays out of ${place}`);
  entry.run();
  assert.deepEqual(env.routes, ["studio"]);
  assert.deepEqual(env.visits.at(-1), { id: "studio", params: { section: "settings-community" } }, "a deep link to the card, which Settings opens and scrolls to");
  assert.equal(env.el("settings-community").open, true, "and the card is opened here as well");
  env.routes.length = 0;
  env.el("workspace-community").click();
  assert.deepEqual(env.routes, ["studio"], "the sidebar Community button opens the same card");
  assert.deepEqual(env.visits.at(-1).params, { section: "settings-community" });
});

test("offer() opens Settings › Community with a note naming the locked item, or the inline card", async () => {
  const env = environment({ bridge: fakeBridge() });
  await env.boot();
  assert.equal(env.api.offer({ kind: "nodeStyle", key: "prism", name: "Prism" }), true);
  assert.deepEqual(env.routes, ["studio"]);
  const settings = env.el("settings-community");
  assert.equal(settings.open, true);
  assert.equal(env.el("community-settings-note").hidden, false);
  assert.equal(env.el("community-settings-note").textContent, `The Prism node style is part of the Void collection. ${LINK_HINT}`);
  await env.advance(0);
  assert.equal(settings.scrolled, 1);
  assert.ok(body(env).textContent.includes(FORK));
  assert.deepEqual(body(env).labels(), ["Join the Discord", "Link my Discord", "Copy agent prompt"]);
  env.api.open();
  assert.equal(env.el("community-settings-note").hidden, true, "a plain open clears the note");

  const bridge = fakeBridge();
  const inline = environment({ bridge, missing: ["settings-community"] });
  await inline.boot();
  inline.api.offer({ kind: "theme", key: "dusk", name: "Neon Dusk" });
  assert.equal(card(inline).hidden, false);
  assert.equal(inline.el("community-invite-note").textContent, `Neon Dusk is part of the Void collection. ${LINK_HINT}`);
  assert.equal(inline.el("community-invite-copy").hidden, false);
  bridge.calls.length = 0;
  inline.el("community-invite-later").click();
  await inline.settle();
  assert.equal(card(inline).hidden, true);
  assert.deepEqual(bridge.calls, [], "closing an offer card is not a weekly snooze");
});

test("offer({ navigate: false }) explains in place: the inline card or a toast, never a route change", async () => {
  // The Workspace theme select fires on every arrow key; it must not leave the workspace (WCAG 3.2.2).
  assert.match(workspaceSource, /MefiMusic\?\.applyTheme\?\.\([^\n]*, true, \{ navigate: false \}\)/, "workspace.js asks for the in-place explanation");

  const env = environment({ bridge: fakeBridge() });
  await env.boot();
  assert.equal(env.api.offer({ kind: "theme", key: "void", name: "Void", navigate: false }), true);
  assert.deepEqual(env.routes, [], "no navigation");
  assert.equal(env.el("settings-community").open, false);
  assert.equal(card(env).hidden, false, "the workspace's inline card explains it");
  assert.equal(env.el("community-invite-note").textContent, `Void is part of the Void collection. ${LINK_HINT}`);
  assert.equal(env.el("community-invite-copy").hidden, false, "with the Copy agent prompt button");
  env.api.offer({ kind: "theme", key: "dusk", name: "Neon Dusk", navigate: false });
  assert.deepEqual(env.routes, [], "stepping on through the list stays put");
  assert.equal(env.el("community-invite-note").textContent, `Neon Dusk is part of the Void collection. ${LINK_HINT}`);

  const away = environment({ bridge: fakeBridge(), workspace: false });
  await away.boot();
  away.api.offer({ kind: "theme", key: "abyss", name: "Abyss", navigate: false });
  assert.deepEqual(away.routes, []);
  const shown = away.toasts.at(-1);
  assert.equal(shown.message, `Abyss is part of the Void collection. ${FORK}`);
  assert.equal(shown.options.action.label, "See the perks");
  shown.options.action.run();
  assert.deepEqual(away.routes, ["studio"], "only the toast's own action opens Settings");
  assert.equal(away.el("community-settings-note").textContent, `Abyss is part of the Void collection. ${LINK_HINT}`);

  const web = environment();
  assert.equal(web.api.offer({ kind: "theme", key: "void", name: "Void", navigate: false }), false);
  assert.deepEqual(web.routes, []);
  assert.match(web.toasts.at(-1).message, /needs the desktop app/);
  assert.doesNotThrow(() => web.api.offer(null));
});

test("Settings › Community keeps keyboard focus on the pressed control across rebuilds", async () => {
  let release;
  let checks = 0;
  const bridge = fakeBridge(member(), { communityCheck: () => { checks += 1; return new Promise((resolve) => { release = resolve; }); } });
  const env = environment({ bridge });
  await env.boot();
  const checkNow = body(env).button("Check now");
  checkNow.focus();
  checkNow.click();
  const checking = body(env).button("Checking…");
  assert.ok(checking && checking !== checkNow, "the card was rebuilt");
  assert.equal(env.document.activeElement, checking, "focus follows to the busy control");
  assert.equal(checking.getAttribute("aria-disabled"), "true");
  assert.equal(checking.disabled, false, "a busy control stays focusable");
  assert.equal(body(env).button("Unlink").getAttribute("aria-disabled"), "true");
  checking.click();
  body(env).button("Unlink").click();
  await env.settle();
  assert.equal(checks, 1, "busy controls ignore presses");
  assert.deepEqual(bridge.calls.filter(([name]) => name === "unlink"), []);
  release({ ok: true, status: member({ checkedAt: T0 }) });
  await env.settle();
  assert.equal(env.document.activeElement, body(env).button("Check now"), "and back when the check lands");
  assert.equal(body(env).button("Check now").getAttribute("aria-disabled"), null);

  const elsewhere = new Element("button");
  elsewhere.focus();
  bridge.push(member({ checkedAt: T0 + MINUTE }));
  assert.equal(env.document.activeElement, elsewhere, "a status push never pulls focus into the card");

  // Unlink: the pressed control is gone afterwards, so focus lands on the new card's first control.
  bridge.set(status());
  body(env).button("Unlink").focus();
  body(env).button("Unlink").click();
  await env.settle();
  assert.deepEqual(body(env).labels(), ["Join the Discord", "Link my Discord", "Copy agent prompt"]);
  assert.equal(env.document.activeElement, body(env).button("Join the Discord"));
});

test("Settings › Community renders each link state with plain text", async () => {
  const bridge = fakeBridge(member({ user: { id: "7", username: "<img src=x>", globalName: "Nova Builder" } }));
  const env = environment({ bridge });
  await env.boot();
  const text = body(env).textContent;
  assert.match(text, /^NB/, "an initials avatar, no remote image");
  assert.ok(text.includes("@<img src=x>"), "names stay text");
  assert.match(text, /Member2 roles/);
  assert.match(text, /Void collection — 4 themes and 3 node stylesOn/);
  assert.match(text, /Last checked 2 hours ago · next check in 6 days/);
  assert.deepEqual(body(env).labels(), ["Check now", "Unlink"]);
  assert.equal(body(env).button("Check now").className, "ghost mini", "one size for the row");
  assert.equal(body(env).button("Unlink").className, "ghost mini community-unlink", "Unlink is the quiet secondary");
  assert.equal(text.includes(FORK), false, "a member is not pitched the fork");
  // Guard-rail 2: what is read, when (a failed check retries sooner), where it is kept, and how to unlink.
  assert.equal(env.el("community-privacy").textContent, PRIVACY);
  assert.ok(template.includes(`<p class="muted" id="community-privacy">${PRIVACY}</p>`), "the template carries the same line before the script runs");

  bridge.calls.length = 0;
  body(env).button("Check now").click();
  await env.settle();
  body(env).button("Unlink").click();
  await env.settle();
  assert.deepEqual(bridge.calls, [["check"], ["unlink"]]);

  bridge.push(member({ state: "offline", entitlement: { premium: true, perks: ["premium"], validUntil: T0 + 10 * DAY, reason: "grace" } }));
  assert.match(body(env).textContent, /Couldn't reach Discord\. Perks stay on until /);
  bridge.push(member({ state: "relink", entitlement: { premium: true, perks: ["premium"], validUntil: T0 + 3 * DAY, reason: "grace" } }));
  assert.equal(body(env).button("Link my Discord").className, "primary mini", "the next step leads the row, at the row's size, under the one link label");
  assert.equal(body(env).labels().includes("Link again"), false);
  bridge.push(member({ state: "not-member", roles: [], entitlement: { premium: false, perks: [], validUntil: null, reason: "not-member" } }));
  assert.match(body(env).textContent, /Your Discord account isn't in the Void Engine server\./);
  assert.deepEqual(body(env).labels().slice(0, 3), ["Join the Discord", "Check now", "Unlink"]);
  assert.equal(body(env).button("Join the Discord").className, "primary mini");
  assert.match(body(env).textContent, /LockedLast checked/);
  assert.ok(body(env).textContent.includes(FORK), "a locked account keeps the fork path");
  bridge.push(status({ configured: false }));
  assert.match(body(env).textContent, /Discord linking isn't set up in this build yet\./);
  assert.deepEqual(body(env).labels(), ["Join the Discord", "Copy agent prompt"]);
  bridge.push(status({ selfUnlocked: true, entitlement: { premium: true, perks: ["premium"], validUntil: null, reason: "self" } }));
  assert.match(body(env).textContent, /This build unlocks the Void collection itself \(SELF_UNLOCKED\), so it needs no Discord link\./);
  assert.equal(body(env).button("Join the Discord").className, "ghost mini", "joining is optional here");
  bridge.push(status({ linking: true }));
  bridge.calls.length = 0;
  body(env).button("Cancel").click();
  await env.settle();
  assert.deepEqual(bridge.calls, [["link-cancel"]]);
});

test("a throttled check, a failed link and the agent prompt report through the status line and toasts", async () => {
  const bridge = fakeBridge(member(), {
    communityCheck: async () => ({ ok: false, error: "throttled", status: member() }),
    communityLink: async () => ({ ok: false, error: "port-busy", status: status() }),
  });
  const env = environment({ bridge });
  await env.boot();
  await env.api.check();
  assert.equal(env.el("community-settings-status").textContent, "Checked a moment ago. Try again in a minute.");
  await env.api.link();
  assert.match(env.el("community-settings-status").textContent, /local sign-in port/);
  assert.equal(env.toasts.at(-1).kind, "bad");
  assert.equal(await env.api.copyAgentPrompt(), true);
  assert.deepEqual(bridge.calls.at(-1), ["copy", AGENT]);
  assert.equal(env.toasts.at(-1).kind, "good");
  assert.equal(env.toasts.at(-1).message, "Agent prompt copied");
});

test("link() waits out any running call; busy, storage and a dropped check read in plain words", async () => {
  let release;
  const bridge = fakeBridge(member(), { communityCheck: () => new Promise((resolve) => { release = resolve; }) });
  const env = environment({ bridge });
  await env.boot();
  const checking = env.api.check();
  assert.deepEqual({ ...(await env.api.link()) }, { ok: false, error: "busy" }, "a link pressed during a check is refused, like check() and unlink()");
  assert.deepEqual(bridge.calls.filter(([name]) => name === "link"), []);
  // Main sets a check's answer aside when a link or unlink landed meanwhile.
  release({ ok: false, error: "canceled", status: member() });
  await checking;
  const dropped = env.el("community-settings-status").textContent;
  assert.notEqual(dropped, "Linking canceled.", "a dropped check is not a canceled link");
  assert.match(dropped, /during the check.*Check now/);

  const failing = environment({ bridge: fakeBridge(member(), {
    communityLink: async () => ({ ok: false, error: "busy", status: member() }),
    communityUnlink: async () => ({ ok: false, error: "storage", status: member() }),
  }) });
  await failing.boot();
  await failing.api.link();
  assert.equal(failing.el("community-settings-status").textContent, "Studio is still linking or unlinking. Try again in a moment.");
  await failing.api.unlink();
  assert.equal(failing.el("community-settings-status").textContent, "Studio couldn't finish deleting its saved sign-in. Try Unlink again.");
});

test("a locked item's note follows the account: the hint changes with the link state and goes once the collection unlocks", async () => {
  const bridge = fakeBridge(status());
  const env = environment({ bridge });
  await env.boot();
  env.api.offer({ kind: "theme", key: "eclipse", name: "Eclipse" });
  const note = env.el("community-settings-note");
  assert.equal(note.textContent, `Eclipse is part of the Void collection. ${LINK_HINT}`);
  bridge.push(member({ state: "not-member", roles: [], entitlement: { premium: false, perks: [], validUntil: null, reason: "not-member" } }));
  assert.equal(note.textContent, "Eclipse is part of the Void collection. Join the Void Engine Discord to use it, or build it yourself (see below).");
  bridge.push(member());
  assert.equal(note.hidden, true, "a member needs no unlock note");
});

test("the Workspace theme select marks locked Void collection options, keeps them enabled and restores them on unlock", async () => {
  const LABELS = [["aurora", "Aurora"], ["gold", "Studio gold"], ["sage", "Forest"], ["custom", "Custom colors"], ["void", "Void"], ["eclipse", "Eclipse"], ["abyss", "Abyss"], ["dusk", "Neon Dusk"]];
  const withOptions = (elements) => { elements.get("workspace-accent").options = LABELS.map(([value, textContent]) => ({ value, textContent, disabled: false })); };
  const labels = (env) => env.el("workspace-accent").options.map((option) => option.textContent);
  const env = environment({ bridge: fakeBridge(status()), music: { premiumCatalog: () => CATALOG }, prepare: withOptions });
  assert.deepEqual(labels(env), ["Aurora", "Studio gold", "Forest", "Custom colors", "Void · members", "Eclipse · members", "Abyss · members", "Neon Dusk · members"]);
  assert.ok(env.el("workspace-accent").options.every((option) => option.disabled === false), "locked options stay choosable: choosing one explains the lock");
  env.fireWindow("mefi-community-change", { detail: { premium: true, perks: ["premium"], validUntil: null, reason: "member" } });
  assert.deepEqual(labels(env).slice(4), ["Void", "Eclipse", "Abyss", "Neon Dusk"], "unlocking restores the template's names");
  env.fireWindow("mefi-community-change", { detail: { premium: false, perks: [], validUntil: null, reason: "not-member" } });
  assert.deepEqual(labels(env).slice(4), ["Void · members", "Eclipse · members", "Abyss · members", "Neon Dusk · members"]);
  assert.doesNotMatch(workspaceSource, /· members/, "workspace.js is not touched for this");

  const hinted = environment({ bridge: fakeBridge(member()), music: { premiumCatalog: () => CATALOG }, prepare: withOptions, storage: new Map([[HINT_KEY, JSON.stringify({ premium: true, validUntil: null })]]) });
  assert.deepEqual(labels(hinted).slice(4), ["Void", "Eclipse", "Abyss", "Neon Dusk"], "a member's boot hint shows the plain names at launch");
  assert.doesNotThrow(() => environment({ bridge: fakeBridge(), prepare: withOptions }), "no catalog, no relabel");
});

test("Community has its own glyph: the sprite symbol, the sidebar button, the settings nav, the card and the palette entry", () => {
  assert.match(template, /<symbol id="g-community" viewBox="0 0 16 16">/);
  assert.match(template, /id="workspace-community"[^>]*><svg class="glyph" aria-hidden="true"><use href="#g-community"\/>/);
  assert.match(template, /data-settings-jump="settings-community"[^>]*><svg class="glyph"[^>]*><use href="#g-community"\/>/);
  assert.match(template, /id="settings-community"><summary><span class="settings-card-glyph" aria-hidden="true"><svg class="glyph"><use href="#g-community"\/>/);
  const env = environment({ bridge: fakeBridge() });
  assert.equal(env.registered.find((dest) => dest.id === "community").glyph, "g-community");
});

test("the showcase names the unlock state, and a member's Choose a Void theme opens Style & sound at the collection", async () => {
  const pressed = new Element("button");
  pressed.setAttribute("aria-pressed", "true");
  const group = new Element("div", "music-premium-themes");
  group.firstElementChild = new Element("button");
  group.querySelector = (selector) => selector === '[aria-pressed="true"]' ? pressed : null;
  const bridge = fakeBridge(status());
  const env = environment({ bridge, music: { premiumCatalog: () => CATALOG }, prepare: (elements) => elements.set("music-premium-themes", group) });
  await env.boot();
  const state = env.el("community-showcase-state");
  assert.equal(state.textContent, "For members of the Void Engine Discord");
  assert.equal(state.getAttribute("data-unlocked"), "false");
  assert.equal(env.el("community-choose").hidden, true, "only a member is offered the themes");
  const [themes, styles] = env.el("community-showcase-items").children;
  assert.deepEqual(themes.children.map((item) => item.textContent), ["Void", "Eclipse", "Abyss", "Neon Dusk"]);
  assert.deepEqual(styles.children.map((item) => item.textContent), ["Singularity", "Prism", "Sigil"]);
  assert.equal(themes.children[0].children[0].children[0].className, "void-swatch", "the two-tone swatch");

  bridge.push(member());
  assert.equal(state.textContent, "Unlocked with your Void Engine membership");
  assert.equal(state.getAttribute("data-unlocked"), "true");
  assert.equal(env.el("community-choose").hidden, false);
  env.el("community-choose").click();
  assert.deepEqual(env.routes, ["music"]);
  await env.advance(0);
  assert.equal(env.document.activeElement, pressed, "keyboard focus lands on the theme in use");
  assert.equal(group.scrolled, 1);

  bridge.push(status({ selfUnlocked: true, entitlement: { premium: true, perks: ["premium"], validUntil: null, reason: "self" } }));
  assert.equal(state.textContent, "Unlocked in this build");
});
