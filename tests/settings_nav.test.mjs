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
function environment({ desktop = true, storage = {}, coach = false, noMotion = false } = {}) {
  const { document, elements, get, body, documentElement } = createDom({ fromTemplate: () => true });
  const page = parse(settingsHtml);
  body.append(page);
  for (const node of page.descendants()) if (node.id) elements.set(node.id, node);
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
  };
  const store = new Map(Object.entries(storage));
  const context = vm.createContext({
    window, document, console, URL, URLSearchParams, Date: FakeDate, IntersectionObserver,
    localStorage: { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)) },
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; },
    cancelAnimationFrame() {},
    setTimeout: () => 0, clearTimeout() {},
  });
  vm.runInContext(source, context);
  const el = (id) => elements.get(id) ?? null;
  const rows = () => el("settings-nav").querySelectorAll(".settings-nav-item");
  return {
    window, document, el, clock, routes, registered, observers, store, documentElement, body,
    booklet: window.MefiBooklet,
    row: (jump) => rows().find((row) => row.dataset.settingsJump === jump) ?? null,
    link: (nav) => rows().find((row) => row.dataset.nav === nav) ?? null,
    current: () => rows().filter((row) => row.getAttribute("aria-current") === "true").map((row) => row.dataset.settingsJump),
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

test("the parsed page carries every card, row, group and block the list names", () => {
  const env = environment();
  for (const id of CARDS) {
    assert.ok(env.el(id), `#${id} is in the template`);
    assert.ok(env.row(id), `the list jumps to #${id}`);
  }
  const groups = env.el("settings-nav").querySelectorAll(".settings-nav-group").map((group) => env.el(group.getAttribute("aria-labelledby")).textContent.trim());
  assert.deepEqual(groups, ["Connections", "Personal", "System"]);
  const block = (id) => env.el(id).closest("[data-settings-group]")?.dataset.settingsGroup;
  for (const id of CARDS.slice(0, 5)) assert.equal(block(id), "connections", `#${id} sits in Connections`);
  for (const id of ["settings-studio", "settings-community"]) assert.equal(block(id), "personal", `#${id} sits in Personal`);
  for (const id of CARDS.slice(7)) assert.equal(block(id), "system", `#${id} sits in System`);
  for (const id of ["workspace-person-name", "workspace-agent-name", "workspace-accent", "workspace-motion", "motion-toggle", "pref-blur", "idle-home"]) {
    assert.ok(env.el("settings-studio").contains(env.el(id)), `Your Studio holds #${id}`);
  }
  for (const id of ["speed-model", "speed-go"]) assert.ok(env.el("settings-diagnostics").contains(env.el(id)), `Diagnostics holds #${id}`);
  assert.deepEqual(env.el("motion-toggle").children.map((option) => option.textContent), ["Full", "Calm", "Off"]);
  assert.equal(env.link("command").dataset.navParams, '{"rail":"settings"}', "Agents & queue opens Command's Agents panel");
  assert.ok(env.link("music"), "Style & sound is a row that leaves for its sheet");
  assert.equal(env.el("settings-log").tagName, "DETAILS", "the Connection log stays a folding card");
});

test("a deep link lands on its card, lights it, and the spy holds until the scroll settles", async () => {
  const env = environment();
  env.booklet.showTab("studio", { section: "settings-community" });
  const card = env.el("settings-community");
  assert.equal(card.open, true, "the folded card opens");
  assert.equal(card.scrolledIntoView, true);
  assert.deepEqual(env.current(), ["settings-community"]);
  assert.equal(card.querySelector("summary").focused, true, "keyboard focus lands on the card");

  // While the jump scrolls, the cards it passes report in; none of them wins.
  env.place("settings-studio", 60, 100);
  env.place("settings-community", 200, 500);
  env.window.scrollY = 1200;
  env.fire("scroll");
  env.frame();
  env.observe(["settings-studio"]);
  assert.deepEqual(env.current(), ["settings-community"], "the scroll-spy is held while the jump scrolls");

  // Settled: the report that a sliver of Your Studio, above the target, is in
  // the band does not take the highlight from the card the link landed on.
  env.fire("scrollend");
  env.clock.now += 2000;
  env.observe(["settings-studio", "settings-community"]);
  assert.deepEqual(env.current(), ["settings-community"], "the card a jump landed on stays current");

  // The reader scrolls on: the spy follows the page again.
  env.place("settings-studio", 100, 100);
  env.place("settings-community", 300, 500);
  env.fire("scroll");
  env.frame();
  assert.deepEqual(env.current(), ["settings-studio"], "once the reader scrolls, the last card past the line is current");
});

test("deep links accept the cards' present names, and a missing card is ignored", () => {
  const env = environment();
  env.booklet.showTab("studio", { section: "providers" });
  assert.deepEqual(env.current(), ["settings-assistant"]);
  for (const alias of ["you", "appearance", "studio"]) {
    env.el("settings-studio").open = false;
    assert.equal(env.booklet.jumpToSettings(alias), true, `"${alias}" names Your Studio`);
    assert.equal(env.el("settings-studio").open, true);
    assert.deepEqual(env.current(), ["settings-studio"]);
  }
  assert.equal(env.booklet.jumpToSettings("updates"), true, "a bare name finds settings-<name>");
  assert.deepEqual(env.current(), ["settings-updates"]);
  assert.equal(env.booklet.jumpToSettings("nowhere"), false);
  assert.equal(env.booklet.jumpToSettings(""), false);
  assert.deepEqual(env.current(), ["settings-updates"], "a jump to nothing changes nothing");
});

test("under the walkthrough coach a jump scrolls without taking focus", () => {
  const env = environment({ coach: true });
  env.booklet.showTab("studio", { section: "settings-assistant" });
  assert.equal(env.el("settings-assistant").scrolledIntoView, true);
  assert.deepEqual(env.current(), ["settings-assistant"]);
  assert.notEqual(env.el("settings-assistant-heading").focused, true, "focus stays with the coach");
  const quiet = environment();
  quiet.booklet.showTab("studio", { section: "settings-assistant" });
  assert.equal(quiet.el("settings-assistant-heading").focused, true, "without the coach the heading takes focus");
  assert.equal(quiet.el("settings-assistant-heading").getAttribute("tabindex"), "-1", "a section's heading is made focusable for it");
});

test("the list's own rows jump without moving focus off the list", async () => {
  const env = environment();
  env.booklet.showTab("studio");
  await env.el("settings-nav").trigger("click", { target: env.row("settings-log") });
  assert.equal(env.el("settings-log").open, true);
  assert.deepEqual(env.current(), ["settings-log"]);
  assert.notEqual(env.el("settings-log").querySelector("summary").focused, true);
});

test("Find a setting narrows rows, cards, groups and blocks, and announces the count", async () => {
  const env = environment();
  env.booklet.showTab("studio");
  await env.type("updates");
  assert.deepEqual(env.shownRows(), ["settings-updates"]);
  assert.deepEqual(env.shownCards(), ["settings-updates"]);
  assert.equal(env.el("settings-find-status").textContent, "1 setting");
  assert.deepEqual(env.current(), ["settings-updates"], "the first match leads");
  const groups = env.el("settings-nav").querySelectorAll(".settings-nav-group");
  assert.deepEqual(groups.map((group) => group.hidden), [true, true, false], "groups left empty step aside");
  const blocks = env.document.querySelectorAll("#settings-sections .settings-block");
  assert.deepEqual(blocks.map((block) => block.hidden), [true, true, false], "blocks left empty step aside");

  // Terms carry synonyms, titles and summaries count, and every word must match.
  await env.type("api key");
  assert.deepEqual(env.shownRows(), ["settings-assistant"]);
  await env.type("theme");
  assert.deepEqual(env.shownRows(), ["settings-studio", "settings-community", "link:music"]);
  assert.equal(env.el("settings-find-status").textContent, "3 settings");
  await env.type("queue");
  assert.deepEqual(env.shownRows(), ["settings-workers", "link:command"], "Coding workers' summary (queued tasks) and the Agents & queue row");
  await env.type("status");
  assert.ok(env.shownRows().includes("settings-diagnostics"), "a card's summary is searched");
  await env.type("zzz nothing");
  assert.deepEqual(env.shownRows(), []);
  assert.equal(env.el("settings-find-status").textContent, "No settings match");
  assert.equal(env.el("settings-find-empty").hidden, false, "the list says nothing matched");

  // Esc clears the search and keeps focus in the field; an empty field lets Esc through.
  const esc = await env.key("Escape");
  assert.equal(esc.stopped, true);
  assert.equal(env.el("settings-find").value, "");
  assert.equal(env.shownRows().length, 14, "every row comes back");
  assert.equal(env.shownCards().length, CARDS.length);
  assert.equal(env.el("settings-find-status").textContent, "");
  assert.equal(env.el("settings-find-empty").hidden, true);
  const through = await env.key("Escape");
  assert.equal(through.stopped, false, "with nothing to clear, Esc goes on to nav");
});

test("Enter in Find opens the first match, or follows it when it leaves the page", async () => {
  const env = environment();
  env.booklet.showTab("studio");
  await env.type("intake");
  assert.deepEqual(env.shownRows(), ["settings-jev"]);
  const enter = await env.key("Enter");
  assert.equal(enter.prevented, true);
  assert.equal(env.el("settings-jev").open, true);
  assert.equal(env.el("settings-jev").scrolledIntoView, true);
  let clicked = 0;
  env.link("music").click = () => { clicked += 1; };
  await env.type("sound");
  assert.equal(env.shownRows()[0], "link:music");
  await env.key("Enter");
  assert.equal(clicked, 1, "a ↗ row is clicked, and nav's delegate takes it from there");
});

test("a deep link to a card the search is hiding brings every card back first", async () => {
  const env = environment();
  env.booklet.showTab("studio");
  await env.type("updates");
  env.booklet.showTab("studio", { section: "settings-studio" });
  assert.equal(env.el("settings-find").value, "");
  assert.equal(env.el("settings-studio").hidden, false);
  assert.deepEqual(env.current(), ["settings-studio"]);
});

test("Server Styler is searchable and its desktop card opens from a deep link", async () => {
  const env = environment();
  env.booklet.showTab("studio");
  await env.type("server styler");
  assert.deepEqual(env.shownRows(), ["settings-styler"]);
  assert.deepEqual(env.shownCards(), ["settings-styler"]);
  env.booklet.showTab("studio", { section: "settings-styler" });
  assert.equal(env.el("settings-styler").open, true);
  assert.deepEqual(env.current(), ["settings-styler"]);
});

test("scrolled to the very end, the last card lights", () => {
  const env = environment();
  env.booklet.showTab("studio");
  CARDS.forEach((id, index) => env.place(id, -2000 + index * 180));
  env.window.scrollY = 3200;
  env.documentElement.scrollHeight = 4000;
  env.fire("scroll");
  env.frame();
  assert.deepEqual(env.current(), ["settings-log"]);
  env.window.scrollY = 1000;
  env.place("settings-routing", 150, 600);
  env.place("settings-workers", 760);
  env.fire("scroll");
  env.frame();
  assert.deepEqual(env.current(), ["settings-routing"], "away from the end, the last card past the line is current");
});

test("buttons inside a card go through MefiNav and leave the card open", async () => {
  const env = environment();
  env.booklet.showTab("studio", { section: "settings-diagnostics" });
  const card = env.el("settings-diagnostics");
  const button = (nav) => card.querySelectorAll("[data-settings-nav]").find((node) => node.dataset.settingsNav === nav);
  for (const nav of ["profiler", "audit", "machine"]) {
    await env.el("settings-sections").trigger("click", { target: button(nav) });
    assert.deepEqual(env.routes.at(-1), [nav, null]);
  }
  assert.equal(card.open, true, "the card stays open behind the view it opened");
  await env.el("settings-sections").trigger("click", { target: env.el("settings-studio").querySelector("[data-settings-nav]") });
  assert.deepEqual(env.routes.at(-1), ["music", null], "Your Studio's More in Style & sound opens the sheet");
});

test("Search Studio gets one entry per card, each opening its card", () => {
  const env = environment();
  assert.deepEqual(env.registered.map((dest) => dest.id), CARDS.map((id) => `settings:${id}`));
  const providers = env.registered.find((dest) => dest.id === "settings:settings-assistant");
  assert.equal(providers.label, "Settings › Providers");
  assert.equal(providers.kind, "action");
  assert.equal(providers.section, "settings");
  assert.match(providers.searchTerms, /api key/);
  assert.equal(providers.glyph, "g-key");
  assert.deepEqual({ ...providers.showIn }, { tabs: false, tools: false, dock: false, palette: true, help: false, footer: false });
  providers.run();
  // params come from the module's realm: compare their shape, not their prototype
  assert.deepEqual(JSON.parse(JSON.stringify(env.routes.at(-1))), ["studio", { section: "settings-assistant" }]);
  assert.equal(env.registered.find((dest) => dest.id === "settings:settings-log").label, "Settings › Connection log");
});

test("the browser build drops desktop-only rows and cards but keeps the Connections note", () => {
  const env = environment({ desktop: false });
  env.booklet.showTab("studio");
  assert.equal(env.el("studio-desktop").hidden, true);
  assert.deepEqual(env.shownRows(), ["settings-studio", "settings-community", "link:music", "settings-diagnostics", "settings-integrations", "settings-log"]);
  assert.equal(env.el("settings-updates").hidden, true, "Updates needs the host");
  assert.equal(env.row("settings-styler").hidden, true, "Server Styler needs the host");
  assert.equal(env.el("settings-styler").hidden, true, "its card also needs the host");
  assert.equal(env.el("speed-go").closest("[data-desktop-only]").hidden, true, "so does the speed probe");
  const groups = env.el("settings-nav").querySelectorAll(".settings-nav-group");
  assert.deepEqual(groups.map((group) => group.hidden), [true, false, false], "Connections has nothing to list");
  const blocks = env.document.querySelectorAll("#settings-sections .settings-block");
  assert.equal(blocks[0].hidden, false, "its block stays to say why");
  assert.deepEqual(env.current(), ["settings-studio"]);
  assert.equal(env.booklet.jumpToSettings("providers"), false, "a desktop-only card cannot be landed on");
  assert.equal(blocks[0].scrolledIntoView, true, "the jump shows its block's note instead");
  assert.ok(!env.registered.some((dest) => ["settings:settings-assistant", "settings:settings-updates", "settings:settings-styler"].includes(dest.id)), "Search skips what the build cannot show");
  assert.ok(env.registered.some((dest) => dest.id === "settings:settings-studio"));
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
