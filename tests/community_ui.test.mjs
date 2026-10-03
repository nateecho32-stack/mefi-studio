import { parseBookletInputs } from "../scripts/build-booklet.mjs";
// renderer/community.js in a vm with a fake DOM, bridge, storage and clock:
// window.MefiCommunity, the retired boot hint's cleanup, the weekly Discord
// card's quiet gates and buttons, Settings › Community and the palette
// action. The link unlocks nothing: every theme and node style is free. The DOM elements the module looks up are built from the
// real template, so a renamed id fails here instead of in the app.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../renderer/community.js", import.meta.url), "utf8");
const musicSource = await readFile(new URL("../renderer/music.js", import.meta.url), "utf8");
const template = await readFile(new URL("../renderer/booklet.template.html", import.meta.url), "utf8");
const buildSource = await readFile(new URL("../scripts/build-booklet.mjs", import.meta.url), "utf8");
const onboardingSource = await readFile(new URL("../renderer/onboarding.js", import.meta.url), "utf8");
const booklet = await readFile(new URL("../renderer/booklet.js", import.meta.url), "utf8");

// The boot hint the retired Void collection lock kept; init deletes it.
const HINT_KEY = "mefiStudio.community.v1";
// The weekly card's pitch and what the link is for (renderer/community.js).
const PITCH = "Share what you're building, swap model setups, and listen together with other builders.";
const USES = "Listen together uses this link to find your Void Engine rooms.";
const PRIVACY = "Linking reads your Discord id and name, and your roles and join date in the Void Engine server: when you link, about once a week (sooner after a failed check, then daily), and when you press Check now. Studio keeps them in its settings on this computer, with the sign-in encrypted in community-auth.json. Nothing about your projects is sent. Unlink revokes the sign-in and deletes both.";
// The Void collection's node styles, as music.js declares them and
// docs/community.md lists them.
const VOID_NODE_STYLES = [
  { key: "singularity", name: "Singularity", detail: "A black hole with a turning disc" },
  { key: "prism", name: "Prism", detail: "A turning crystal that splits light" },
  { key: "sigil", name: "Sigil", detail: "Hex runes that assemble as it works" },
];
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
  // Settings › Community puts its Connection details right after the card body.
  after(...items) { (this.siblingsAfter ??= []).push(...items); }
  scrollIntoView() { this.scrolled += 1; }
  focus() { focused = this; }
  all() { return this.children.flatMap((child) => [child, ...child.all()]); }
  button(label) { return this.all().find((child) => child.tag === "button" && child.textContent === label) ?? null; }
  labels() { return this.all().filter((child) => child.tag === "button").map((child) => child.textContent); }
}

function status(overrides = {}) {
  return {
    available: true, configured: true, linked: false, linking: false, member: false,
    user: null, roles: [], state: null,
    checkedAt: null, lastOkAt: null, nextCheckAt: null,
    prompt: { due: false, never: false, snoozeUntil: null },
    inviteUrl: "https://discord.gg/xgfKc5pVxG", serverUrl: "https://discord.com/channels/1345380333302059129",
    ...overrides,
  };
}
const due = (overrides = {}) => status({ prompt: { due: true, never: false, snoozeUntil: null }, ...overrides });
const member = (overrides = {}) => status({
  linked: true, member: true, state: "ok", user: { id: "42", username: "nova_builder", globalName: "Nova Builder" }, roles: ["111", "222"],
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
    ...overrides,
  };
}

// prepare(elements): runs on the fake DOM before the module does.
function environment({ bridge = null, storage = new Map(), search = "", workspace = true, guide = "complete", noMotion = false, missing = [], prepare = null } = {}) {
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
    addEventListener: listen(windowListeners),
    dispatchEvent: (event) => { events.push(event); return true; },
  };
  class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }
  prepare?.(elements);
  const context = vm.createContext({
    window, document, console, URLSearchParams, CustomEvent, Date: FakeDate,
    setTimeout: setTimer, clearTimeout: clearTimer,
    getComputedStyle: (element) => ({ display: element.hidden ? "none" : "block" }),
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: (key) => storage.delete(key) },
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

test("MefiCommunity is the link surface only: no unlock gate, previews, fork copy or agent prompt", () => {
  const env = environment();
  assert.deepEqual(Object.keys(env.api).sort(), ["cancelLink", "check", "init", "join", "link", "open", "refresh", "startup", "status", "unlink"]);
  for (const gone of ["has", "offer", "FORK_COPY", "AGENT_PROMPT", "copyAgentPrompt"]) assert.equal(env.api[gone], undefined, gone);
  assert.doesNotMatch(source, /mefi-community-change|entitlement|SELF_UNLOCKED|premiumCatalog/, "nothing in the renderer gates the Void collection");
});

test("the Void collection's node styles are music.js's, and docs/community.md lists each one as written", async () => {
  const literal = musicSource.match(/const NODE_STYLES = (\{[\s\S]*?\n {2}\});/);
  assert.ok(literal, "music.js declares NODE_STYLES");
  const styles = vm.runInNewContext(`(${literal[1]})`);
  const collection = Object.entries(styles).filter(([, style]) => style.collection === "void").map(([key, style]) => ({ key, name: style.name, detail: style.detail }));
  assert.deepEqual(VOID_NODE_STYLES, collection);
  assert.ok(Object.values(styles).every((style) => !("premium" in style)), "no node style is premium any more");
  const docs = await readFile(new URL("../docs/community.md", import.meta.url), "utf8");
  for (const style of VOID_NODE_STYLES) assert.ok(docs.includes(`| **${style.name}** | \`${style.key}\` | ${style.detail} |`), `docs/community.md's row for ${style.key}`);
});

test("every id the module looks up exists in the template", () => {
  assert.ok(LOOKED_UP.length >= 10);
  for (const id of LOOKED_UP) assert.ok(templateElement(id), `#${id} must exist in booklet.template.html`);
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|outerHTML/, "dynamic text goes through textContent only");
  const settings = template.match(/<details[^>]*id="settings-community"[^>]*>/)[0];
  assert.doesNotMatch(settings, /\sopen/, "Settings › Community is closed by default");
  assert.ok(template.indexOf('id="settings-community"') > template.indexOf('id="settings-studio"'), "the card sits after #settings-studio");
  assert.ok(template.includes('id="settings-category-general"'), "the Community card has a Settings category");
  assert.ok(template.indexOf('id="settings-community"') > template.indexOf('id="settings-category-general"'), "Community follows the General category heading");
  assert.ok(template.indexOf('id="community-invitation"') > template.indexOf('id="walkthrough-invitation"'), "the weekly card follows the walkthrough invitation");
  assert.match(template, /<optgroup label="Void collection[^"]*"><option value="void">Void<\/option><option value="eclipse">Eclipse<\/option><option value="abyss">Abyss<\/option><option value="dusk">Neon Dusk<\/option><\/optgroup>/);
});

test("registration: bundled after music and onboarding, before booklet, and started from the boot callback", () => {
  const sources = parseBookletInputs(buildSource).scripts;
  assert.ok(sources.includes("community.js"));
  assert.ok(sources.indexOf("music.js") < sources.indexOf("community.js"));
  assert.ok(sources.indexOf("onboarding.js") < sources.indexOf("community.js"));
  assert.ok(sources.indexOf("community.js") < sources.indexOf("booklet.js"), "community bundles before booklet");
  assert.match(onboardingSource, /status: \(\) => state\.status/, "MefiOnboarding exposes the walkthrough status the card waits on");
  assert.ok(booklet.indexOf("window.MefiCommunity?.startup?.()") > booklet.indexOf("window.MefiOnboarding?.startup?.({ automatic: true })"));
});

test("no bridge: the card never shows and Settings says linking needs the desktop app", async () => {
  const storage = new Map([[HINT_KEY, JSON.stringify({ premium: true, validUntil: null })]]);
  const env = environment({ storage });
  await env.boot();
  await env.advance(HOUR);
  assert.equal(card(env).hidden, true);
  assert.equal(env.events.length, 0);
  assert.equal(env.polls.length, 0);
  assert.match(body(env).textContent, /needs the desktop app/);
  assert.ok(body(env).textContent.includes(PITCH));
  assert.equal(env.api.open(), false);
  assert.deepEqual(env.routes, []);
  assert.match(env.toasts.at(-1).message, /needs the desktop app/);
  await env.api.join();
  assert.equal(env.api.status(), null);
});

test("init deletes the retired boot hint, and no status dispatches mefi-community-change", async () => {
  const storage = new Map([[HINT_KEY, JSON.stringify({ premium: true, validUntil: T0 + DAY })], ["other.key", "kept"]]);
  const bridge = fakeBridge(status());
  const env = environment({ bridge, storage });
  assert.equal(storage.has(HINT_KEY), false, "the old Void collection hint is gone at init");
  assert.equal(storage.get("other.key"), "kept");
  await env.boot();
  bridge.push(member());
  bridge.push(member({ state: "not-member", member: false, roles: [] }));
  assert.equal(storage.has(HINT_KEY), false, "no status writes it back");
  assert.equal(env.events.filter((event) => event.type === "mefi-community-change").length, 0);
  assert.doesNotThrow(() => environment({ bridge: fakeBridge(), storage: new Map([[HINT_KEY, "{not json"]]) }));
});

test("mefi-community-status follows whether linking is possible and whether the account is a member", async () => {
  const bridge = fakeBridge(status({ configured: false }));
  const env = environment({ bridge });
  await env.boot();
  const updates = () => env.events.filter((event) => event.type === "mefi-community-status").map((event) => ({ ...event.detail }));
  assert.deepEqual(updates(), [{ configured: false, linked: false, member: false, state: null, linking: false }], "one after the first status");
  bridge.push(status({ configured: false, prompt: { due: true, never: false, snoozeUntil: null } }));
  assert.equal(updates().length, 1, "a change that does not touch linking dispatches nothing");
  bridge.push(member());
  assert.deepEqual(updates().at(-1), { configured: true, linked: true, member: true, state: "ok", linking: false });
  bridge.push(member({ checkedAt: T0 }));
  assert.equal(updates().length, 2, "a new check time alone dispatches nothing");
  bridge.push(member({ state: "offline" }));
  bridge.push(member({ state: "relink" }));
  assert.deepEqual(updates().at(-1), { configured: true, linked: true, member: true, state: "relink", linking: false });
  bridge.push(member({ state: "not-member", member: false, roles: [] }));
  assert.deepEqual(updates().at(-1), { configured: true, linked: true, member: false, state: "not-member", linking: false });
  assert.equal(updates().length, 5);
});

test("the weekly card shows once when due and every quiet gate holds, and records it", async () => {
  const bridge = fakeBridge(due());
  const env = environment({ bridge });
  await env.boot();
  assert.equal(card(env).hidden, false);
  assert.deepEqual(bridge.calls.filter(([name]) => name === "prompt"), [["prompt", "shown"]]);
  assert.match(template, /<strong id="community-invite-title">Build with others in the Void Engine Discord<\/strong>/);
  assert.equal(env.el("community-invite-link").hidden, false);
  for (const id of ["community-invite-copy", "community-invite-note"]) {
    assert.equal(templateElement(id)?.hidden ?? true, true, `#${id} never shows: the weekly card keeps to its four buttons`);
    assert.ok(!LOOKED_UP.includes(id), `community.js no longer reaches #${id}`);
  }
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
  bridge.push(member({ prompt: { due: true, never: false, snoozeUntil: null } }));
  assert.equal(card(env).hidden, true, "linking as a member puts the weekly card away");

  const linked = environment({ bridge: fakeBridge(member({ prompt: { due: true, never: false, snoozeUntil: null } })) });
  await linked.boot();
  await linked.advance(HOUR);
  assert.equal(card(linked).hidden, true);
  assert.equal(linked.toasts.length, 0);
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
  assert.equal(never.env.toasts.at(-1).message, "Settings › General › Community has the link any time.");
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
  assert.equal(shown.options.action.label, "Open Community");
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
  assert.equal(entry.label, "Void Engine Discord");
  assert.doesNotMatch(`${entry.desc} ${entry.searchTerms}`, /perk|unlock|premium/i);
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
  assert.deepEqual(body(env).labels(), ["Join the Discord", "Link my Discord"]);
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
  assert.ok(text.includes(USES), "the card says what the link is for");
  assert.match(text, /Last checked 2 hours ago · next check in 6 days/);
  assert.doesNotMatch(text, /perk|unlock|premium|Void collection/i, "the link unlocks nothing");
  assert.deepEqual(body(env).labels(), ["Check now", "Unlink"]);
  assert.equal(body(env).button("Check now").className, "ghost mini", "one size for the row");
  assert.equal(body(env).button("Unlink").className, "ghost mini community-unlink", "Unlink is the quiet secondary");
  // Guard-rail 2: what is read, when (a failed check retries sooner), where it is kept, and how to unlink.
  assert.equal(env.el("community-privacy").textContent, PRIVACY);
  assert.ok(template.includes(`<p class="muted" id="community-privacy">${PRIVACY}</p>`), "the template carries the same line before the script runs");

  bridge.calls.length = 0;
  body(env).button("Check now").click();
  await env.settle();
  body(env).button("Unlink").click();
  await env.settle();
  assert.deepEqual(bridge.calls, [["check"], ["unlink"]]);

  bridge.push(member({ state: "offline" }));
  assert.match(body(env).textContent, /Couldn't reach Discord\. Studio tries again soon\./);
  assert.match(body(env).textContent, /Member2 roles/, "a failed check keeps the last answer");
  bridge.push(member({ state: "relink" }));
  assert.match(body(env).textContent, /Discord needs you to link again\./);
  assert.equal(body(env).button("Link my Discord").className, "primary mini", "the next step leads the row, at the row's size, under the one link label");
  assert.equal(body(env).labels().includes("Link again"), false);
  bridge.push(member({ state: "not-member", member: false, roles: [] }));
  assert.match(body(env).textContent, /Your Discord account isn't in the Void Engine server\./);
  assert.doesNotMatch(body(env).textContent, /Member/, "no member badge");
  assert.deepEqual(body(env).labels(), ["Join the Discord", "Check now", "Unlink"]);
  assert.equal(body(env).button("Join the Discord").className, "primary mini");
  bridge.push(member({ state: "session" }));
  assert.match(body(env).textContent, /This link lasts until Studio closes/);
  bridge.push(status({ configured: false }));
  assert.match(body(env).textContent, /Discord linking isn't set up on this PC yet\. Add the link app ID under Connection details below\./);
  assert.deepEqual(body(env).labels(), ["Join the Discord"]);
  bridge.push(status());
  assert.ok(body(env).textContent.includes(PITCH) && body(env).textContent.includes(USES));
  assert.deepEqual(body(env).labels(), ["Join the Discord", "Link my Discord"]);
  assert.equal(body(env).button("Link my Discord").className, "primary");
  bridge.push(status({ available: false }));
  assert.match(body(env).textContent, /Community linking isn't available in this build\./);
  assert.deepEqual(body(env).labels(), []);
  bridge.push(status({ linking: true }));
  bridge.calls.length = 0;
  body(env).button("Cancel").click();
  await env.settle();
  assert.deepEqual(bridge.calls, [["link-cancel"]]);
});

test("a throttled check, a failed link, a not-member link and a good link report through the status line and toasts", async () => {
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

  const outsider = environment({ bridge: fakeBridge(status(), { communityLink: async () => ({ ok: false, error: "not-member", status: member({ state: "not-member", member: false, roles: [] }) }) }) });
  await outsider.boot();
  await outsider.api.link();
  assert.equal(outsider.el("community-settings-status").textContent, "Your Discord account isn't in the Void Engine server yet. Join, then choose Check now.");
  const offer = outsider.toasts.at(-1);
  assert.equal(offer.kind, "info");
  assert.equal(offer.options.action.label, "Join the Discord");
  offer.options.action.run();
  await outsider.settle();
  assert.deepEqual(outsider.bridge.calls.slice(-2), [["open", "invite"], ["prompt", "joined"]]);

  const good = environment({ bridge: fakeBridge(status()) });
  await good.boot();
  assert.equal((await good.api.link()).ok, true);
  assert.equal(good.el("community-settings-status").textContent, "Discord linked.");
  assert.deepEqual({ message: good.toasts.at(-1).message, kind: good.toasts.at(-1).kind }, { message: "Discord linked.", kind: "good" });
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

test("Community has its own glyph: the sprite symbol, the sidebar button, the settings card and the palette entry", () => {
  assert.match(template, /<symbol id="g-community" viewBox="0 0 16 16">/);
  assert.match(template, /id="workspace-community"[^>]*><svg class="glyph" aria-hidden="true"><use href="#g-community"\/>/);
  assert.match(template, /id="settings-category-general"[\s\S]*id="settings-community"><summary><span class="settings-card-glyph"[^>]*><svg class="glyph"><use href="#g-community"\/>/);
  assert.match(template, /id="settings-community"><summary><span class="settings-card-glyph" aria-hidden="true"><svg class="glyph"><use href="#g-community"\/>/);
  const env = environment({ bridge: fakeBridge() });
  assert.equal(env.registered.find((dest) => dest.id === "community").glyph, "g-community");
});


test("Connection details: read once, open while linking is not set up, saved with the reason or whether the hub answers", async () => {
  const APP = "1400000000000000001";
  const saves = [];
  const view = { ok: true, clientId: "", hubUrl: "", environment: { clientId: false, hubUrl: false }, linkReady: false, hubReady: false };
  const bridge = fakeBridge(status({ configured: false }), {
    communitySetup: async (values) => {
      if (!values) return view;
      saves.push({ ...values });
      if (values.clientId === "abc") return { ...view, ok: false, error: "invalid", errors: { clientId: "The link app ID is the Mefi Studio Link Application ID: 17 to 20 digits." } };
      bridge.set(status());
      return { ok: true, clientId: values.clientId, hubUrl: values.hubUrl, environment: { clientId: false, hubUrl: true }, linkReady: true, hubReady: true, health: { ok: true, protocol: 1, paused: false }, status: status() };
    },
  });
  const env = environment({ bridge });
  await env.boot();
  const box = body(env).siblingsAfter?.[0];
  assert.ok(box, "the details sit right after the card body");
  assert.equal(box.id, "community-setup");
  assert.equal(box.open, true, "opened while linking is not set up");
  assert.match(body(env).textContent, /Add the link app ID under Connection details below/);
  const field = (id) => box.all().find((child) => child.id === id);
  const save = field("community-setup-save");
  field("community-setup-client").value = "abc";
  field("community-setup-hub").value = "https://hub.example.com";
  save.click(); await env.advance(0);
  assert.match(field("community-setup-status").textContent, /17 to 20 digits/);
  field("community-setup-client").value = APP;
  save.click(); await env.advance(0);
  assert.deepEqual(saves.at(-1), { clientId: APP, hubUrl: "https://hub.example.com" });
  assert.equal(field("community-setup-status").textContent, "Saved. Link my Discord is ready above. The hub answered.");
  assert.deepEqual(body(env).labels(), ["Join the Discord", "Link my Discord"], "the card offers Link my Discord at once");
  assert.equal(field("community-setup-env").hidden, false);
  assert.match(field("community-setup-env").textContent, /MEFI_STUDIO_HUB_URL is set on this PC and wins/);
  assert.equal(body(env).siblingsAfter.length, 1, "built once, however often the card repaints");
});
