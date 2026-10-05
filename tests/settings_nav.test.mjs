// Settings as one page: the list beside the cards (renderer/booklet.js) finds a
// setting, jumps to a card, follows the scroll and lands deep links; the
// Motion control and the Search entries live here too. The Settings markup is
// parsed out of the real template into the shared fake DOM, so a card or a
// row renamed on one side and not the other fails here.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { Element, createDom } from "./fixtures/renderer-dom.mjs";

const source = await readFile(new URL("../renderer/booklet.js", import.meta.url), "utf8");
const template = await readFile(new URL("../renderer/booklet.template.html", import.meta.url), "utf8");

// ---- the Settings page, parsed ------------------------------------------
// Just enough HTML for one well-formed template section: tags, attributes
// (quoted, bare and boolean), self-closing SVG children, text and comments.
const VOID = new Set(["input", "br", "hr", "img", "meta", "link", "use", "path", "circle", "rect", "ellipse", "source", "wbr"]);
const decode = (text) => text.replace(/&(amp|lt|gt|quot|#39);/g, (_, name) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[name]);
function parse(html) {
  const root = new Element("FRAGMENT");
  const stack = [root];
  const tokens = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
  for (const [whole, close, tag, attrs, selfClose, text] of html.matchAll(tokens)) {
    if (whole.startsWith("<!--")) continue;
    if (text !== undefined) {
      if (text.trim()) {
        const node = new Element("#text");
        node.textContent = decode(text);
        stack.at(-1).append(node);
      }
      continue;
    }
    const name = tag.toUpperCase();
    if (close) {
      const at = stack.findLastIndex((node) => node.tagName === name);
      if (at > 0) stack.length = at;
      continue;
    }
    const node = new Element(name);
    for (const [, key, double, single, bare] of attrs.matchAll(/([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      const value = decode(double ?? single ?? bare ?? "");
      node.setAttribute(key, value);
      if (key === "open") node.open = true;
      if (key === "checked") node.checked = true;
      if (key === "value") node.value = value;
      if (key === "type") node.type = value;
    }
    stack.at(-1).append(node);
    if (!selfClose && !VOID.has(tag.toLowerCase())) stack.push(node);
  }
  return root;
}
const settingsHtml = template.slice(template.indexOf('<section id="tab-studio"'), template.indexOf("</main>"));

const CATALOG = { schemaVersion: 1, hash: "fixture-hash", rosterHash: "fixture-roster", generatedAt: 0, models: [], plan: { name: "Fixture plan", priceUSDMonth: 0, window5hUSD: 0, weekUSD: 0, monthUSD: 0 } };
const CARDS = ["settings-setup", "settings-assistant", "settings-routing", "settings-workers", "settings-jev", "settings-studio", "settings-community", "settings-updates", "settings-diagnostics", "settings-integrations", "settings-styler", "settings-log"];

// desktop: a bridge with launchStudio (the desktop app); false is the browser
// build. storage seeds localStorage; coach: whether the walkthrough coach shows.
function environment({ desktop = true, storage = {}, coach = false, noMotion = false, audioMarkup = "", bridge: extra = {}, layout = null } = {}) {
  const { document, elements, get, body, documentElement } = createDom({ fromTemplate: () => true });
  const page = parse(settingsHtml);
  if (audioMarkup) page.querySelector("#settings-audio-media").append(parse(audioMarkup));
  body.append(page);
  for (const node of page.descendants()) if (node.id) elements.set(node.id, node);
  // The 0.5 layout (renderer/nav.js writes html[data-layout]); the panes Settings makes for it are found by id like the template's.
  if (layout) {
    documentElement.dataset.layout = layout;
    const byId = document.getElementById;
    document.getElementById = (id) => byId(id) ?? body.querySelector(`#${id}`);
  }
  get("booklet-data").textContent = JSON.stringify(CATALOG);
  get("walkthrough-coach").hidden = !coach;
  documentElement.scrollHeight = 4000;

  const clock = { now: 1_000_000 };
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.now])); }
    static now() { return clock.now; }
  }
  const frames = [];
  const listeners = new Map();
  const observers = [];
  const routes = [];
  const registered = [];
  const events = [];
  class IntersectionObserver {
    constructor(callback, options) { this.callback = callback; this.options = options; this.targets = []; observers.push(this); }
    observe(target) { this.targets.push(target); }
    disconnect() {}
  }
  const bridge = desktop ? {
    launchStudio: async () => ({}), onStudioLog() {},
    getApiKey: async () => ({ saved: false }),
    jevStatus: async () => ({ configured: false, enabled: true, route: "vercel", routes: {} }),
    getAiRouting: async () => ({ provider: "auto", models: {}, autoProviders: ["zai", "opencode"] }),
    cliStatus: async () => [],
    ...extra,
  } : undefined;
  const window = {
    mefiStudio: bridge,
    location: { href: "file:///fixture/renderer/booklet.html", search: "", reload() {} },
    innerHeight: 800,
    scrollY: 0,
    onscrollend: null,
    MefiGraph: { fmt: { money: String, int: String, ctx: String }, privacyLabel: () => "", mount: () => ({ redraw() {}, setDoc() {}, setSpeeds() {} }) },
    MefiBoot: { run() {} },
    MefiNav: {
      register: (dest) => { registered.push(dest); return dest; },
      go: (id, params) => { routes.push([id, params ?? null]); },
      get: (id) => ({ studio: { label: "Settings" }, booklet: { label: "Model catalog" } })[id] ?? null,
      noMotion: () => noMotion,
      syncMotion() {},
    },
    addEventListener: (type, fn) => { const list = listeners.get(type) ?? []; list.push(fn); listeners.set(type, list); },
    // What the page says to the rest of the window (mefi:settings-place, for the 0.5 layout's list column).
    dispatchEvent: (event) => { events.push({ type: event.type, detail: event.detail }); return true; },
  };
  const store = new Map(Object.entries(storage));
  const context = vm.createContext({
    window, document, console, URL, URLSearchParams, Date: FakeDate, IntersectionObserver,
    CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    localStorage: { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)) },
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; },
    cancelAnimationFrame() {},
    setTimeout: () => 0, clearTimeout() {},
  });
  vm.runInContext(source, context);
  const el = (id) => elements.get(id) ?? null;
  const rows = () => el("settings-nav").querySelectorAll(".settings-nav-item");
  return {
    window, document, el, clock, routes, registered, observers, store, documentElement, body, events,
    booklet: window.MefiBooklet,
    row: (jump) => rows().find((row) => row.dataset.settingsJump === jump) ?? null,
    link: (nav) => rows().find((row) => row.dataset.nav === nav) ?? null,
    current: () => rows().filter((row) => row.getAttribute("aria-current") === "true").map((row) => row.dataset.settingsCategory),
    panes: () => document.querySelectorAll("[data-settings-category-pane]").filter((node) => !node.hidden).map((node) => node.dataset.settingsCategoryPane),
    results: () => el("settings-search-results").children.map((node) => node.dataset.settingsResult),
    shownRows: () => rows().filter((row) => !row.hidden).map((row) => row.dataset.settingsJump ?? `link:${row.dataset.nav}`),
    shownCards: () => CARDS.filter((id) => el(id) && !el(id).hidden),
    fire: (type, event = {}) => { for (const fn of listeners.get(type) ?? []) fn({ type, ...event }); },
    frame: () => { const pending = frames.splice(0); pending.forEach((fn) => fn()); },
    // An observer report; entries name only the cards that just crossed an edge.
    observe: (ids = []) => observers[0]?.callback(ids.map((id) => ({ target: elements.get(id), isIntersecting: true, boundingClientRect: elements.get(id).getBoundingClientRect() }))),
    // Places a card on screen: top and bottom in window pixels.
    place: (id, top, height = 90) => { el(id).getBoundingClientRect = () => ({ top, bottom: top + height, left: 0, right: 900, width: 900, height }); },
    type: async (text) => { el("settings-find").value = text; await el("settings-find").trigger("input"); },
    key: async (key) => {
      const event = { key, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
      for (const fn of el("settings-find").listeners.keydown ?? []) fn(event);
      return event;
    },
  };
}

test("Settings offers seven stable categories and displays one pane", () => {
  const env = environment();
  env.booklet.showTab("studio");
  assert.deepEqual(env.el("settings-nav").querySelectorAll("[data-settings-category]").map((row) => row.dataset.settingsCategory), ["general", "appearance", "connections", "models", "automation", "audio", "system"]);
  assert.deepEqual(env.panes(), ["general"]);
  env.booklet.showTab("studio", { category: "audio" });
  assert.deepEqual(env.panes(), ["audio"], "category params from quick links are supported");
  for (const id of CARDS) assert.ok(env.el(id), `legacy anchor ${id} survives`);
  assert.ok(env.el("settings-category-general").contains(env.el("workspace-person-name")));
  assert.ok(env.el("settings-category-appearance").contains(env.el("motion-toggle")));
  assert.ok(env.el("settings-category-models").contains(env.el("executor-cli")));
  assert.ok(env.el("settings-category-automation").contains(env.el("jev-enabled")));
});

test("category selection preserves disclosures and remembers the last category", async () => {
  const env = environment();
  const category = env.el("settings-nav").querySelector('[data-settings-category="system"]');
  await env.el("settings-nav").trigger("click", { target: category, detail: 1 });
  assert.deepEqual(env.panes(), ["system"]);
  assert.equal(env.store.get("mefiStudio.settingsCategory"), "system");
  env.booklet.jumpToSettings("settings-log");
  assert.equal(env.el("settings-log").open, true);
  env.booklet.jumpToSettings("general");
  env.booklet.jumpToSettings("system");
  assert.equal(env.el("settings-log").open, true);
  const restored = environment({ storage: { "mefiStudio.settingsCategory": "audio" } });
  assert.deepEqual(restored.panes(), ["audio"]);
});

test("legacy deep links reveal their new categories and keep their targets", () => {
  const env = environment();
  for (const [alias, category, target] of [["providers", "connections", "settings-assistant"], ["Your Studio", "general", "settings-studio"], ["preferences", "general", "settings-studio"], ["decision-model", "connections", "settings-jev"], ["coding-workers", "models", "settings-workers"], ["updates", "system", "settings-updates"], ["appearance", "appearance", "settings-category-appearance"], ["audio", "audio", "settings-category-audio"]]) {
    assert.equal(env.booklet.jumpToSettings(alias), true, alias);
    assert.deepEqual(env.panes(), [category]);
    assert.equal(env.el(target).scrolledIntoView, true);
  }
  assert.equal(env.booklet.jumpToSettings("missing"), false);
  assert.deepEqual(env.panes(), ["audio"]);
});

test("search returns individual controls with category paths, never entered secrets or log contents", async () => {
  const env = environment();
  await env.type("companion name");
  assert.deepEqual(env.results(), ["workspace-agent-name"]);
  assert.match(env.el("settings-search-results").textContent, /Settings \/ General/);
  assert.deepEqual(env.panes(), [], "results replace the category body");
  env.el("jev-key").value = "private-test-secret";
  env.el("studio-log").textContent = "private-test-log";
  await env.type("private-test");
  assert.deepEqual(env.results(), []);
  assert.equal(env.el("settings-find-status").textContent, "No settings match");
  assert.equal(env.el("settings-find-empty").hidden, false);
});

test("Enter reveals a matching field and opens its containing provider disclosure", async () => {
  const env = environment();
  await env.type("custom provider api key");
  assert.deepEqual(env.results(), ["custom-key"]);
  assert.equal(env.el("custom-key").closest("details").open, false);
  await env.key("Enter");
  assert.deepEqual(env.panes(), ["connections"]);
  assert.equal(env.el("custom-key").closest("details").open, true);
  assert.equal(env.el("custom-key").focused, true);
  assert.equal(env.el("settings-find").value, "");
});

test("search results can be selected and Escape clears without navigating away", async () => {
  const env = environment();
  await env.type("blur behind panels");
  assert.deepEqual(env.results(), ["pref-blur"]);
  await env.el("settings-sections").trigger("click", { target: env.el("settings-search-results").children[0] });
  assert.deepEqual(env.panes(), ["appearance"]);
  assert.equal(env.el("pref-blur").focused, true);
  await env.type("nothing matching");
  const event = await env.key("Escape");
  assert.equal(event.stopped, true);
  assert.deepEqual(env.panes(), ["appearance"]);
  assert.equal(env.el("settings-search-results").hidden, true);
  assert.equal((await env.key("Escape")).stopped, false);
});

test("search reveals a conditional music field before focusing the exact result", async () => {
  for (const [category, id, label] of [["appearance", "music-color-accent-hex", "Accent hex color"], ["audio", "music-link-url", "Media link"]]) {
    const env = environment();
    const panel = new Element("section"); panel.hidden = true;
    const control = new Element("input"); control.id = id; control.setAttribute("aria-label", label);
    panel.append(control); env.el(`settings-${category}-media`).append(panel);
    const get = env.document.getElementById;
    env.document.getElementById = (key) => key === id ? control : get(key);
    const revealed = [];
    env.window.MefiMusic = { revealSettingsTarget: (target) => { revealed.push(target.id); if (target === control) panel.hidden = false; } };
    control.focus = () => { assert.equal(panel.hidden, false, "the configuration panel is visible before focus"); env.document.activeElement = control; };
    await env.type(label);
    assert.deepEqual(env.results(), [id]);
    assert.equal(panel.hidden, true, "searching alone does not change the visible configuration");
    await env.key("Enter");
    assert.deepEqual(revealed, [id]);
    assert.deepEqual(env.panes(), [category]);
    assert.ok(env.document.activeElement === control);
  }
});

test("Settings search excludes transient music content while retaining player and configuration controls", async () => {
  const env = environment({ audioMarkup: `
    <ol class="music-queue"><li><button id="transient-track">Transient music track</button></li></ol>
    <div class="music-recent"><button id="transient-recent">Transient music recent link</button></div>
    <article class="music-suggestion"><button id="transient-recommendation">Transient music suggestion</button></article>
    <button id="music-radio-stop">Stop radio</button>
    <label>Music volume<input id="music-volume" type="range" aria-label="Music volume"></label>
    <button id="music-recommend">Ask for recommendations</button>
  ` });
  await env.type("transient music");
  assert.deepEqual(env.results(), []);
  assert.ok(!env.registered.some((item) => item.id.startsWith("settings:transient-")), "global Search also omits changing content actions");
  for (const [query, id] of [["Stop radio", "music-radio-stop"], ["Music volume", "music-volume"], ["Ask for recommendations", "music-recommend"]]) {
    await env.type(query);
    assert.deepEqual(env.results(), [id]);
    assert.ok(env.registered.some((item) => item.id === `settings:${id}`), "persistent controls remain in global Search");
  }
});

test("a direct link clears a pending search and the walkthrough keeps focus", async () => {
  const env = environment({ coach: true });
  await env.type("updates");
  env.booklet.showTab("studio", { section: "settings-community" });
  assert.equal(env.el("settings-find").value, "");
  assert.deepEqual(env.panes(), ["general"]);
  assert.equal(env.el("settings-community").open, true);
  assert.notEqual(env.el("settings-community").querySelector("summary").focused, true);
});

test("providers start as compact status rows and preserve every credential control", () => {
  const env = environment();
  const providers = env.el("settings-assistant").querySelectorAll(".provider-tile");
  assert.equal(providers.length, 11);
  assert.ok(providers.every((node) => node.tagName === "DETAILS" && !node.open));
  for (const id of ["zai-key", "api-key", "zen-key", "openrouter-key", "lmstudio-endpoint", "custom-key"]) assert.ok(env.el(id).closest(".provider-tile"));
});

test("global Search registers control paths and preserves legacy card entries", () => {
  const env = environment();
  const companion = env.registered.find((item) => item.id === "settings:workspace-agent-name");
  assert.equal(companion.label, "Settings › General › Companion name");
  companion.run();
  assert.deepEqual(JSON.parse(JSON.stringify(env.routes.at(-1))), ["studio", { section: "workspace-agent-name" }]);
  assert.ok(env.registered.some((item) => item.id === "settings:settings-assistant"));
  assert.ok(env.registered.some((item) => item.id === "settings:settings-log"));
});

test("browser Settings keeps categories but excludes unavailable desktop controls from search", async () => {
  const env = environment({ desktop: false });
  env.booklet.showTab("studio");
  assert.equal(env.el("studio-desktop").hidden, true);
  assert.equal(env.booklet.jumpToSettings("providers"), false);
  assert.deepEqual(env.panes(), ["connections"]);
  assert.equal(env.el("studio-browser").hidden, false);
  await env.type("custom provider api key");
  assert.deepEqual(env.results(), []);
  assert.ok(!env.registered.some((item) => item.id === "settings:custom-key"));
});

test("Automation keeps admission and queue execution as separate settings", async () => {
  const env = environment();
  let current = { known: true, newWorkKnown: true, newWork: false, enabled: true, parallel: 2, adaptiveParallel: false, autoBuild: false, mode: "swarm" };
  const changes = [];
  env.window.MefiIdle = { queueSettings: () => current, setQueueSetting: async (key, value) => { changes.push([key, value]); current = { ...current, [key]: value }; } };
  env.booklet.jumpToSettings("automation");
  assert.equal(env.el("settings-new-work").checked, false);
  assert.equal(env.el("settings-queue-enabled").checked, true);
  env.el("settings-new-work").checked = true;
  await env.el("settings-new-work").trigger("change");
  assert.deepEqual(changes, [["newWork", true]]);
  assert.equal(current.enabled, true);
  env.el("settings-build-mode").value = "auto";
  await env.el("settings-build-mode").trigger("change");
  assert.deepEqual(changes.at(-1), ["autoBuild", true]);
  current = { ...current, newWork: false, enabled: false, mode: "cluster" };
  env.fire("mefi:queue-settings", { detail: current });
  assert.equal(env.el("settings-new-work").checked, false, "a confirmed service push refreshes admission");
  assert.equal(env.el("settings-queue-enabled").checked, false, "executor pushes refresh the queue preference");
  assert.equal(env.el("settings-agent-mode").value, "cluster");
  assert.equal(changes.length, 2, "synchronization never resubmits the setting");
});

test("a first Automation search loads confirmed controls and transfers focus from the loading row", async () => {
  const env = environment();
  let current = { known: false, newWorkKnown: false }, resolveRead, reads = 0;
  const pending = new Promise((resolve) => { resolveRead = resolve; });
  env.window.MefiIdle = { queueSettings: () => current, refreshQueueSettings: () => { reads += 1; return pending; } };
  const control = env.el("settings-parallel");
  for (const node of [control, control.closest("label")]) node.focus = () => { env.document.activeElement = node; };
  env.booklet.showTab("studio", { section: "settings-parallel" });
  assert.equal(control.disabled, true);
  assert.ok(env.document.activeElement === control.closest("label"), "a disabled field still has a meaningful focus destination");
  await Promise.resolve();
  assert.equal(reads, 1);
  current = { known: true, newWorkKnown: true, newWork: true, enabled: true, parallel: 2, adaptiveParallel: false, autoBuild: false, mode: "cluster" };
  resolveRead(current);
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
  assert.equal(control.disabled, false);
  assert.equal(control.value, "2");
  assert.ok(env.document.activeElement === control);
  assert.equal(env.el("settings-new-work").disabled, false);
  assert.equal(env.el("settings-automation-status").textContent, "");
});

test("unavailable Automation keeps focus on its row and does not pretend the setting loaded", async () => {
  const env = environment();
  env.window.MefiIdle = { queueSettings: () => ({ known: false, newWorkKnown: false }), refreshQueueSettings: async () => { throw new Error("Offline"); } };
  const row = env.el("settings-parallel").closest("label");
  row.focus = () => { env.document.activeElement = row; };
  env.booklet.showTab("studio", { section: "settings-parallel" });
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
  assert.equal(env.el("settings-parallel").disabled, true);
  assert.ok(env.document.activeElement === row);
  assert.match(env.el("settings-automation-status").textContent, /unavailable/);
});

test("a refused Automation save restores confirmed values and reports the failure", async () => {
  const env = environment();
  env.window.MefiIdle = { queueSettings: () => ({ known: true, newWorkKnown: true, newWork: true, enabled: false, parallel: 1, adaptiveParallel: true, autoBuild: true, mode: "swarm" }), setQueueSetting: async () => false };
  env.booklet.jumpToSettings("automation");
  env.el("settings-queue-enabled").checked = true;
  await env.el("settings-queue-enabled").trigger("change");
  assert.equal(env.el("settings-queue-enabled").checked, false);
  assert.match(env.el("settings-automation-status").textContent, /not saved/);
});

test("Motion offers Full, Calm and Off, and the palette's toggle flips Off and back", async () => {
  const env = environment();
  const motion = env.el("motion-toggle");
  const pressed = () => env.document.querySelectorAll('[data-segmented-for="motion-toggle"] button[data-value]').filter((button) => button.getAttribute("aria-pressed") === "true").map((button) => button.dataset.value);
  const group = env.document.querySelector('[data-segmented-for="motion-toggle"]');
  const choose = (value) => group.trigger("click", { target: group.querySelector(`button[data-value="${value}"]`) });
  assert.equal(motion.value, "full");
  assert.deepEqual(pressed(), ["full"]);
  assert.equal(env.body.classList.contains("no-motion"), false);
  assert.equal(env.el("workspace-motion").disabled, false);

  await choose("calm");
  assert.equal(env.body.classList.contains("ws-still"), true, "Calm stills the interface");
  assert.equal(env.body.classList.contains("no-motion"), false, "the node tree keeps moving");
  assert.equal(env.store.get("mefiStudio.motion"), "calm");
  assert.deepEqual(pressed(), ["calm"]);
  assert.equal(env.el("workspace-motion").disabled, true, "the companion's own switch waits for Full");

  await motion.click();
  assert.equal(motion.value, "off", "a click on the select is the palette's Toggle animations");
  assert.equal(env.body.classList.contains("no-motion"), true);
  assert.equal(env.body.classList.contains("ws-still"), false);
  assert.equal(env.store.get("mefiStudio.motion"), "0", "Off keeps the stored value it always had");
  await motion.click();
  assert.equal(motion.value, "calm", "and back to the level before");

  motion.value = "full";
  await motion.trigger("change");
  assert.equal(env.store.get("mefiStudio.motion"), "1");
  assert.equal(env.body.classList.contains("ws-still"), false);

  const off = environment({ storage: { "mefiStudio.motion": "0" } });
  assert.equal(off.el("motion-toggle").value, "off", "a saved Off from the old switch still reads as Off");
  assert.equal(off.body.classList.contains("no-motion"), true);
});

test("the page header names the tab, and the catalog's status line stays with the catalog", () => {
  const env = environment();
  env.booklet.showTab("studio");
  assert.equal(env.el("page-title").textContent, "Settings");
  assert.equal(env.el("status").hidden, true);
  env.booklet.showTab("booklet");
  assert.equal(env.el("page-title").textContent, "Model catalog");
  assert.equal(env.el("status").hidden, false);
  env.booklet.showTab("eyes");
  assert.equal(env.el("page-title").textContent, "Activity & evidence", "a tab nav does not name still has its title");
});

test("Blur behind panels mirrors the Studio-wide preference tasks.js paints", () => {
  const off = environment();
  off.documentElement.setAttribute("data-no-blur", "");
  off.el("pref-blur").checked = true;
  off.booklet.showTab("studio");
  assert.equal(off.el("pref-blur").checked, false, "blur switched off elsewhere reads off here before the Task board ever opens");
  const on = environment();
  on.el("pref-blur").checked = false;
  on.booklet.showTab("studio");
  assert.equal(on.el("pref-blur").checked, true);
});

// Server Styler is a separate project most people never check out: without one
// the card would only say where it is missing, beside a Start that cannot work.
const styler = (state) => ({ serverStylerStatus: async () => ({ ok: state !== "missing", state, message: state === "missing" ? "Server Styler project missing." : "Server Styler is stopped." }) });
const settle = async () => { for (let index = 0; index < 10; index += 1) await Promise.resolve(); };

test("with no Server Styler checkout its card leaves Settings, Settings search and global Search", async () => {
  const env = environment({ bridge: styler("missing") });
  const entry = env.registered.find((item) => item.id === "settings:settings-styler");
  assert.ok(entry, "global Search registers the card at boot, before the host has answered");
  env.booklet.showTab("studio", { category: "system" }); await settle();
  assert.equal(env.el("settings-styler").hidden, true);
  assert.equal(entry.hidden(), true, "global Search stops offering it");
  assert.equal(env.registered.find((item) => item.short === "Start Server Styler").hidden(), true, "and its buttons");
  await env.type("server styler");
  assert.deepEqual(env.results(), [], "Settings search finds neither the card nor its buttons");
  assert.equal(env.booklet.jumpToSettings("server-styler"), false, "a deep link cannot land on it");
  assert.equal(env.el("settings-integrations").hidden, false, "the other cards stay");
});

test("a found Server Styler checkout keeps its card, in Settings and in both searches", async () => {
  const env = environment({ bridge: styler("stopped") });
  env.booklet.showTab("studio", { category: "system" }); await settle();
  assert.equal(env.el("settings-styler").hidden, false);
  assert.equal(env.el("server-styler-status").textContent, "Server Styler is stopped.");
  assert.equal(env.registered.find((item) => item.id === "settings:settings-styler").hidden(), false);
  await env.type("server styler");
  assert.ok(env.results().includes("settings-styler"));
});

// ---- the 0.5 layout: the prototype's places (booklet.js, "Settings in the 0.5 layout") ----
const placeRows = (env) => env.el("settings-nav-list").children.map((group) => [group.querySelector(".settings-nav-heading")?.textContent ?? null, group.querySelectorAll(".settings-nav-item").map((row) => row.dataset.settingsCategory ?? `nav:${row.dataset.nav}`)]);
const paneOf = (env, id) => env.document.getElementById(id)?.closest("[data-settings-category-pane]")?.dataset.settingsCategoryPane ?? null;

test("the 0.5 layout files Settings into the prototype's places, in its order and under its headings", () => {
  const env = environment({ layout: "v2" });
  assert.deepEqual(placeRows(env), [
    [null, ["general", "notifications", "appearance", "nav:size", "looks", "audio"]],
    ["Updates and help", ["updates", "problem"]],
    ["Advanced", ["system"]],
    // Categories the places do not name keep a row until renderer/agents.js takes them to Agents › Setup.
    [null, ["connections", "models", "automation"]],
  ]);
  const rows = env.el("settings-nav").querySelectorAll(".settings-nav-item");
  assert.deepEqual(rows.map((row) => row.querySelector(".label").textContent).slice(0, 9), ["General", "Notifications", "Appearance", "Size and density", "Map look", "Sound and music", "Updates", "Report a problem", "System"]);
  assert.ok(rows.find((row) => row.dataset.nav === "size").classList.contains("is-sub"), "Size and density sits under Appearance");
  assert.equal(env.el("settings-nav-list").dataset.places, "v2");
  assert.equal(env.el("tab-studio").getAttribute("data-places"), "v2");
  // The cards that become places of their own move, ids and all; nothing is copied.
  for (const [card, place] of [["settings-notifications", "notifications"], ["settings-updates", "updates"], ["settings-report", "problem"], ["settings-studio", "general"], ["settings-community", "general"], ["settings-diagnostics", "system"], ["settings-integrations", "system"]]) assert.equal(paneOf(env, card), place, `${card} is in ${place}`);
  for (const id of ["alerts-quiet", "release-check", "report-replace", "whats-new-on"]) assert.equal(env.body.querySelectorAll(`#${id}`).length, 1, `${id} exists once`);
  assert.equal(env.document.getElementById("settings-notifications").dataset.settingsPlaceCard, "notifications");
  assert.equal(env.document.getElementById("settings-category-notifications-heading").textContent, "Notifications");
  assert.equal(env.document.getElementById("settings-category-audio-heading").textContent, "Sound and music");
  assert.equal(env.document.getElementById("settings-category-general").querySelector(".settings-category-head p").textContent, "Names, startup and community", "General no longer says it holds notifications");
  // Find a setting moves to the page, beside its title.
  assert.equal(env.document.getElementById("settings-find").closest("#settings-nav"), null);
  assert.ok(env.document.getElementById("settings-find").closest("#settings-sections"));
  assert.deepEqual(JSON.parse(JSON.stringify(env.booklet.settingsPlaces().map((place) => [place.id, place.group, place.sub, place.route]))), [["general", null, false, null], ["notifications", null, false, null], ["appearance", null, false, null], ["size", null, true, "size"], ["looks", null, false, null], ["audio", null, false, null], ["updates", "Updates and help", false, null], ["problem", "Updates and help", false, null], ["system", "Advanced", false, null]]);
});

test("in the 0.5 layout Settings says where it is (settingsLocation) and says so once per change of place or of search (mefi:settings-place)", async () => {
  const env = environment({ layout: "v2" });
  env.booklet.showTab("studio");
  assert.deepEqual(JSON.parse(JSON.stringify(env.booklet.settingsLocation())), { id: "general", label: "General", search: false });
  const said = () => env.events.filter((event) => event.type === "mefi:settings-place").map((event) => JSON.parse(JSON.stringify(event.detail)));
  const before = said().length;
  env.booklet.jumpToSettings("notifications");
  env.booklet.jumpToSettings("alerts-quiet");
  env.booklet.showTab("studio");
  assert.deepEqual(said().slice(before), [{ place: "notifications", search: false }], "a repaint that moved nothing says nothing");
  assert.equal(env.booklet.settingsLocation().label, "Notifications");
  await env.type("stay quiet");
  assert.deepEqual(said().at(-1), { place: "notifications", search: true }, "Find a setting showing results is a change too");
  assert.equal(env.booklet.settingsLocation().search, true);
  assert.equal(environment().booklet.settingsLocation(), null, "the classic layout has no places to say");
});

test("asking for the places files Settings into them when the layout came on after Settings was wired", () => {
  const env = environment();
  assert.equal(env.booklet.settingsPlaces(), null);
  env.documentElement.dataset.layout = "v2";
  const byId = env.document.getElementById;
  env.document.getElementById = (id) => byId(id) ?? env.body.querySelector(`#${id}`);
  assert.deepEqual(JSON.parse(JSON.stringify(env.booklet.settingsPlaces().map((place) => place.id))), ["general", "notifications", "appearance", "size", "looks", "audio", "updates", "problem", "system"]);
  assert.equal(env.el("tab-studio").getAttribute("data-places"), "v2");
});

test("the classic layout keeps its seven categories, and no place of the 0.5 layout", () => {
  const env = environment();
  assert.equal(env.booklet.settingsPlaces(), null);
  assert.equal(env.el("tab-studio").getAttribute("data-places"), null);
  assert.equal(env.el("settings-find").closest("#settings-nav")?.id, "settings-nav");
  assert.equal(paneOf(env, "settings-notifications"), "general");
  assert.equal(paneOf(env, "settings-report"), "system");
  assert.equal(env.document.querySelector('[data-settings-category-pane="notifications"]'), null);
});

test("a place shows alone, its cards open when it shows, and the place you were on comes back", () => {
  const env = environment({ layout: "v2" });
  env.booklet.showTab("studio");
  assert.deepEqual(env.panes(), ["general"]);
  assert.equal(env.el("settings-notifications").open, false, "Notifications are read when they open, not at launch");
  assert.equal(env.el("settings-community").open, true, "a place shows its panels open the first time");
  env.el("settings-community").open = false;
  env.booklet.showTab("studio", { category: "notifications" });
  assert.deepEqual(env.panes(), ["notifications"]);
  assert.deepEqual(env.current(), ["notifications"]);
  assert.equal(env.el("settings-notifications").open, true, "the card is the page");
  assert.equal(env.el("tab-studio").getAttribute("data-settings-place"), "notifications");
  assert.equal(env.store.get("mefiStudio.settingsCategory"), "notifications");
  env.booklet.showTab("studio", { category: "general" });
  assert.equal(env.el("settings-community").open, false, "and after that stays as you left it");
  env.booklet.showTab("studio", { category: "notifications" });
  const again = environment({ layout: "v2", storage: { "mefiStudio.settingsCategory": "notifications" } });
  again.booklet.showTab("studio");
  assert.deepEqual(again.panes(), ["notifications"]);
  // The classic layout does not know the place and opens on General.
  const classic = environment({ storage: { "mefiStudio.settingsCategory": "notifications" } });
  classic.booklet.showTab("studio");
  assert.deepEqual(classic.panes(), ["general"]);
});

test("Map look is the Appearance pane at its Nodes section, Appearance at Theme, each under its own title", () => {
  const env = environment({ layout: "v2" });
  const clicked = [];
  for (const button of env.el("appearance-sections").querySelectorAll("[data-appearance-section]")) {
    button.addEventListener("click", () => { clicked.push(button.dataset.appearanceSection); for (const other of env.el("appearance-sections").querySelectorAll("[data-appearance-section]")) other.setAttribute("aria-pressed", String(other === button)); });
  }
  env.booklet.showTab("studio");
  assert.equal(env.booklet.jumpToSettings("looks"), true);
  assert.deepEqual(env.panes(), ["appearance"]);
  assert.deepEqual(env.current(), ["looks"]);
  assert.equal(env.el("tab-studio").getAttribute("data-settings-place"), "looks");
  assert.deepEqual(clicked, ["nodes"]);
  assert.equal(env.el("settings-category-appearance-heading").textContent, "Map look");
  assert.equal(env.booklet.jumpToSettings("appearance"), true);
  assert.deepEqual(env.current(), ["appearance"]);
  assert.deepEqual(clicked, ["nodes", "themes"]);
  assert.equal(env.el("settings-category-appearance-heading").textContent, "Appearance");
  // A control under Nodes or Layout belongs to Map look; one under Interface to Appearance.
  env.el("settings-tree").dataset.appearancePanel = "nodes";
  env.el("settings-appearance").dataset.appearancePanel = "interface";
  env.booklet.jumpToSettings("settings-tree");
  assert.deepEqual(env.current(), ["looks"]);
  env.booklet.jumpToSettings("settings-appearance");
  assert.deepEqual(env.current(), ["appearance"]);
});

test("deep links and Search land on the place that holds a control now", async () => {
  const env = environment({ layout: "v2" });
  for (const [section, place] of [["settings-updates", "updates"], ["updates", "updates"], ["release-check", "updates"], ["settings-report", "problem"], ["report", "problem"], ["alerts-quiet", "notifications"], ["notifications", "notifications"], ["settings-community", "general"], ["settings-diagnostics", "system"], ["audio", "audio"], ["music", "audio"]]) {
    assert.equal(env.booklet.jumpToSettings(section), true, section);
    assert.deepEqual(env.current(), [place], `${section} lands on ${place}`);
  }
  await env.type("stay quiet");
  assert.deepEqual(env.results(), ["alerts-quiet"]);
  assert.match(env.el("settings-search-results").textContent, /Settings \/ Notifications/);
  const quiet = env.registered.filter((item) => item.id === "settings:alerts-quiet").at(-1);
  assert.equal(quiet.label, "Settings › Notifications › Stay quiet at night", "global Search names the new place");
  const save = env.registered.filter((item) => item.id === "settings:report-save").at(-1);
  assert.equal(save.label, "Settings › Report a problem › Save zip…");
});
