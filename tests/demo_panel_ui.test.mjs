// renderer/demo-panel.js in a vm with a fake DOM, bridge, storage and clock:
// the owner-only switch (settings.ui.demoPanel through prefs:get), the
// three-minute cadence that survives a relaunch, the four cards, the hold on
// hover, placement under the Command rail's Work tab from a layer of its own
// (never inside #idle-hud, whose boxes the tree fits around), the
// Ctrl Alt Shift D switch, and Ctrl Alt Shift F as Zen now (the camera
// flight itself is tests/camera_tour.test.mjs and command_director).
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../renderer/demo-panel.js", import.meta.url), "utf8");
const template = await readFile(new URL("../renderer/booklet.template.html", import.meta.url), "utf8");

const EVERY = 3 * 60 * 1000;
const FIRST = 20000;
const SLIDE = 9000;
const T0 = Date.UTC(2026, 8, 23, 18, 0, 0);
const flush = () => new Promise((resolve) => setImmediate(resolve));

class Element {
  constructor(tag, id = "", box = null) {
    this.tag = tag; this.id = id; this.box = box; this.children = []; this.parent = null;
    this.listeners = {}; this.attrs = {}; this.dataset = {}; this.hidden = false;
    this.className = ""; this.type = ""; this.title = ""; this.copy = ""; this.animations = [];
    this.style = { props: {}, setProperty(name, value) { this.props[name] = String(value); } };
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
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
    for (const fn of this.listeners[type] ?? []) fn(event);
    return event;
  }
  all() { return this.children.flatMap((child) => [child, ...child.all()]); }
  contains(node) { return node === this || this.all().includes(node); }
  querySelector(selector) {
    if (selector.startsWith(".")) return this.all().find((child) => child.className.split(" ").includes(selector.slice(1))) ?? null;
    return null;
  }
  matches() { return false; }
  focus() {}
  getBoundingClientRect() {
    const { left = 0, top = 0, width = 0, height = 0 } = this.box ?? {};
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top };
  }
  animate(frames, options) {
    const animation = { frames, options, paused: false, canceled: false, pause() { this.paused = true; }, play() { this.paused = false; }, cancel() { this.canceled = true; } };
    this.animations.push(animation);
    return animation;
  }
  find(className) { return this.all().find((child) => child.className.split(" ").includes(className)) ?? null; }
  buttonLabeled(label) { return this.all().find((child) => child.tag === "button" && child.textContent === label) ?? null; }
}

// The Command rail as the stylesheet lays it out at 1440 x 900: the rail is
// 320 px wide 24 px from the right edge, its tab strip runs across the top
// and Work is the second tab (Node is hidden until something is picked).
function commandRail() {
  const rail = new Element("aside", "cmd-rail", { left: 1096, top: 158, width: 320, height: 642 });
  const tabs = new Element("header", "", { left: 1108, top: 168, width: 296, height: 50 });
  tabs.className = "rail-tabs";
  const work = new Element("button", "cmd-rail-tab-work", { left: 1112, top: 172, width: 58, height: 42 });
  tabs.append(work);
  rail.append(tabs);
  return { rail, tabs, work };
}

function environment({ prefs = {}, store = new Map(), active = true, now = T0 } = {}) {
  let clock = now;
  let seq = 0;
  const timers = new Map();
  const schedule = (fn, ms, every) => { const id = ++seq; timers.set(id, { fn, at: clock + Math.max(0, Number(ms) || 0), every }); return id; };
  const cancel = (id) => { timers.delete(id); };
  const calls = { get: 0, set: [], opened: [], community: [] };
  let saved = { ...prefs };
  const bridge = {
    prefsGet: async () => { calls.get += 1; return { ok: true, prefs: { blurMenu: true, ...saved } }; },
    // The patch is built in the vm's realm; a plain copy compares by value.
    prefsSet: async (patch) => { calls.set.push({ ...patch }); saved = { ...saved, ...patch }; return { ok: true, prefs: saved }; },
    openExternal: async (url) => { calls.opened.push(url); return { ok: true }; },
    communityOpen: async (target) => { calls.community.push(target); return { ok: true }; },
  };
  const { rail, tabs, work } = commandRail();
  const hud = new Element("div", "idle-hud");
  hud.append(rail);
  const body = new Element("body");
  body.append(hud);
  const head = new Element("head");
  const ids = new Map([["cmd-rail", rail], ["cmd-rail-tab-work", work], ["idle-hud", hud]]);
  const windowListeners = {};
  const state = { active, zenCalls: 0 };
  const document = {
    readyState: "complete", hidden: false, activeElement: body, head, body,
    getElementById: (id) => ids.get(id) ?? null,
    createElement: (tag) => new Element(tag),
    createElementNS: (_ns, tag) => new Element(tag),
    addEventListener() {},
  };
  const window = {
    mefiStudio: bridge,
    innerWidth: 1440, innerHeight: 900,
    MefiIdle: {
      isActive: () => state.active,
      settingsPreviewStatus: () => ({ active: false }),
      enterZen: () => { state.zenCalls += 1; return true; },
    },
    MefiNav: { noMotion: () => false, top: () => "command" },
    MefiCommunity: { status: () => ({ inviteUrl: "https://discord.gg/xgfKc5pVxG" }) },
    addEventListener: (type, fn) => { (windowListeners[type] ??= []).push(fn); },
    removeEventListener: (type, fn) => { windowListeners[type] = (windowListeners[type] ?? []).filter((item) => item !== fn); },
  };
  class FakeDate extends Date { static now() { return clock; } }
  const context = {
    window, document, Date: FakeDate, console,
    localStorage: { getItem: (key) => (store.has(key) ? store.get(key) : null), setItem: (key, value) => store.set(key, String(value)) },
    setTimeout: (fn, ms) => schedule(fn, ms, 0), clearTimeout: cancel,
    setInterval: (fn, ms) => schedule(fn, ms, Math.max(1, Number(ms) || 1)), clearInterval: cancel,
  };
  vm.runInNewContext(source, context, { filename: "demo-panel.js" });
  const panel = () => head.children.length ? body.children.find((child) => child.className === "demo-panel") ?? null : null;
  return {
    window, document, body, hud, rail, tabs, work, calls, store, state, timers, windowListeners,
    api: window.MefiDemoPanel,
    panel,
    now: () => clock,
    // Runs every timer that falls due within ms, in order, letting each
    // async tick settle before the next.
    async advance(ms) {
      const end = clock + ms;
      await flush();
      for (;;) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, timer] = next;
        clock = timer.at;
        if (timer.every) timer.at += timer.every;
        else timers.delete(id);
        timer.fn();
        await flush();
      }
      clock = end;
      await flush();
    },
    key(extra = {}) {
      const event = { type: "keydown", key: "D", ctrlKey: true, altKey: true, shiftKey: true, metaKey: false, code: "KeyD", repeat: false, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...extra };
      for (const fn of windowListeners.keydown ?? []) fn(event);
      return event;
    },
  };
}

test("another install: no demoPanel in its prefs means no card, no style and nothing scheduled", async () => {
  const env = environment();
  await env.advance(EVERY * 4);
  assert.equal(env.calls.get, 1, "one prefs read at launch");
  assert.equal(env.panel(), null);
  assert.equal(env.document.head.children.length, 0, "no stylesheet is added");
  assert.equal(env.timers.size, 0, "no timer is left running");
  assert.equal(env.api.show(), false, "show refuses while the switch is off");
  assert.equal(env.panel(), null);
});

test("no desktop bridge (start:web): the module stays inert", async () => {
  const env = environment();
  // A second copy of the module in a context whose window has no bridge.
  const window = { addEventListener() { throw new Error("must not bind"); } };
  const document = { readyState: "complete", addEventListener() {} };
  vm.runInNewContext(source, { window, document, Date, setTimeout, clearTimeout, setInterval, clearInterval, console, localStorage: null });
  await flush();
  assert.equal(window.MefiDemoPanel.status().enabled, false);
  assert.ok(env.api, "the first copy still exported its API");
});

test("the owner's machine: first card 20 s after launch, four cards 9 s apart, then every three minutes", async () => {
  const env = environment({ prefs: { demoPanel: true } });
  await env.advance(FIRST - 1000);
  assert.equal(env.panel(), null, "nothing before the first delay");
  await env.advance(1000);
  const panel = env.panel();
  assert.ok(panel, "the card is built");
  assert.equal(panel.hidden, false);
  assert.equal(panel.parent, env.body, "a layer of its own, straight under body");
  assert.equal(env.hud.contains(panel), false, "never inside #idle-hud, whose boxes the tree fits around");
  assert.equal(env.rail.contains(panel), false, "and never inside the rail, whose box sets the tree's right edge");
  assert.deepEqual(env.api.status().slide, "what");
  assert.match(panel.textContent, /Mefi's Studio AI\+/);
  assert.match(panel.textContent, /1 \/ 4/);

  const seen = [env.api.status().slide];
  for (let i = 0; i < 3; i += 1) {
    await env.advance(SLIDE);
    seen.push(env.api.status().slide);
  }
  assert.deepEqual(seen, ["what", "how", "get", "discord"]);
  assert.match(panel.textContent, /discord\.gg\/xgfKc5pVxG/);
  await env.advance(SLIDE);
  assert.equal(panel.hidden, true, "it closes after the last card");
  assert.equal(env.api.status().open, false);

  // The next one is three minutes after the first one opened.
  const openedAt = T0 + FIRST;
  await env.advance(openedAt + EVERY - env.now() - 1000);
  assert.equal(panel.hidden, true);
  await env.advance(1000);
  assert.equal(panel.hidden, false, "back at three minutes");
  assert.equal(env.api.status().slide, "what");
  assert.equal(env.api.status().shows, 2);
});

test("it hangs under the Work tab: the tab strip's width, 10 px below it, the caret on Work's centre", async () => {
  const env = environment({ prefs: { demoPanel: true } });
  await env.advance(FIRST);
  const panel = env.panel();
  assert.equal(panel.style.left, "1108px");
  assert.equal(panel.style.top, `${168 + 50 + 10}px`);
  assert.equal(panel.style.width, "296px");
  assert.equal(panel.dataset.caret, "top");
  assert.equal(panel.style.props["--demo-caret"], `${Math.round(1112 + 58 / 2 - 1108)}px`);
  // The rail's own box is untouched, so usableArea() has nothing new to fit around.
  assert.deepEqual(env.rail.getBoundingClientRect(), { left: 1096, top: 158, width: 320, height: 642, right: 1416, bottom: 800, x: 1096, y: 158 });
  assert.deepEqual(env.rail.children.map((child) => child.className), ["rail-tabs"]);
});

test("inspect mode's upright tab strip puts the card to its left, caret pointing right at Work", async () => {
  const env = environment({ prefs: { demoPanel: true } });
  env.rail.box = { left: 880, top: 76, width: 540, height: 802 };
  env.tabs.box = { left: 1354, top: 76, width: 56, height: 802 };
  env.work.box = { left: 1358, top: 130, width: 48, height: 44 };
  await env.advance(FIRST);
  const panel = env.panel();
  assert.equal(panel.dataset.caret, "right");
  assert.equal(panel.style.width, "360px");
  assert.equal(panel.style.left, `${1354 - 10 - 360}px`);
  assert.equal(panel.style.top, "130px");
  assert.equal(panel.style.props["--demo-caret"], "22px");
});

test("hovering holds the card; leaving gives it the rest of its time", async () => {
  const env = environment({ prefs: { demoPanel: true } });
  await env.advance(FIRST);
  const panel = env.panel();
  await env.advance(4000);
  panel.emit("pointerenter");
  assert.equal(env.api.status().held, true);
  const bar = panel.find("demo-bar").animations.at(-1);
  assert.equal(bar.paused, true, "the progress bar stops with it");
  await env.advance(60000);
  assert.equal(env.api.status().slide, "what", "a minute under the pointer, still the first card");
  panel.emit("pointerleave");
  await env.advance(SLIDE - 4000 - 1);
  assert.equal(env.api.status().slide, "what");
  await env.advance(1);
  assert.equal(env.api.status().slide, "how");
});

test("the close, the dots and the buttons", async () => {
  const env = environment({ prefs: { demoPanel: true } });
  await env.advance(FIRST);
  const panel = env.panel();
  const dots = panel.find("demo-dots").children;
  dots[2].emit("click");
  assert.equal(env.api.status().slide, "get");
  panel.buttonLabeled("Open releases").emit("click");
  await flush();
  assert.deepEqual(env.calls.opened, ["https://github.com/nateecho32-stack/mefi-studio/releases/latest"]);
  dots[3].emit("click");
  panel.buttonLabeled("Join the Discord").emit("click");
  await flush();
  assert.deepEqual(env.calls.community, ["invite"], "the invite opens through community:open");
  panel.find("demo-close").emit("click");
  assert.equal(panel.hidden, true);
  await env.advance(EVERY - 1000);
  assert.equal(panel.hidden, true, "closing waits for the next three-minute mark");
  await env.advance(1000);
  assert.equal(panel.hidden, false);
});

test("a due card waits for Command, and leaving Command puts it away", async () => {
  const env = environment({ prefs: { demoPanel: true }, active: false });
  await env.advance(FIRST + 30000);
  assert.equal(env.panel(), null, "not while another view is up");
  const reads = env.calls.get;
  env.state.active = true;
  await env.advance(5000);
  assert.equal(env.panel()?.hidden, false, "it shows once Command is back");
  assert.ok(env.calls.get - reads <= 1, "waiting re-reads the switch at most once a minute");
  env.state.active = false;
  await env.advance(1000);
  assert.equal(env.panel().hidden, true);
});

test("a relaunch keeps the cadence: the stored time holds the next card back", async () => {
  const store = new Map([["mefiStudio.demoPanel.lastShown", String(T0 - 60000)]]);
  const env = environment({ prefs: { demoPanel: true }, store });
  await env.advance(FIRST);
  assert.equal(env.panel(), null, "a minute ago is too recent");
  await env.advance(EVERY - 60000 - FIRST - 1);
  assert.equal(env.panel(), null);
  await env.advance(1);
  assert.equal(env.panel()?.hidden, false);
});

test("Ctrl Alt Shift D turns it off and on through prefs:set", async () => {
  const env = environment({ prefs: { demoPanel: true } });
  await env.advance(FIRST);
  assert.equal(env.panel().hidden, false);
  const off = env.key();
  assert.equal(off.prevented, true);
  await flush();
  assert.deepEqual(env.calls.set, [{ demoPanel: false }]);
  assert.equal(env.panel().hidden, true);
  await env.advance(EVERY * 3);
  assert.equal(env.panel().hidden, true, "off stays off");
  assert.equal(env.timers.size, 0);

  env.key();
  await flush();
  assert.deepEqual(env.calls.set.at(-1), { demoPanel: true });
  assert.equal(env.panel().hidden, false, "on shows a card straight away");
  assert.equal(env.key({ shiftKey: false }).prevented, false, "Ctrl Alt D alone is not the switch");
});

test("the settings switch turned off by hand closes it at the next check", async () => {
  const env = environment({ prefs: { demoPanel: true } });
  await env.advance(FIRST);
  await env.window.mefiStudio.prefsSet({ demoPanel: false });
  await env.advance(EVERY);
  assert.equal(env.panel().hidden, true);
  await env.advance(EVERY * 2);
  assert.equal(env.panel().hidden, true);
});

test("the ids it reaches exist in the template and its text goes through textContent", () => {
  for (const id of new Set([...source.matchAll(/getElementById\("([\w-]+)"\)/g)].map((match) => match[1]))) {
    assert.match(template, new RegExp(`id="${id}"`), `#${id} is in booklet.template.html`);
  }
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|outerHTML/);
});

// ---- Zen now ----------------------------------------------------------------
test("Ctrl Alt Shift F is Zen now on the owner's machine, and left alone everywhere else", async () => {
  const env = environment({ prefs: { demoPanel: true } });
  await flush();
  const event = env.key({ key: "F", code: "KeyF" });
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  assert.equal(env.state.zenCalls, 1, "MefiIdle.enterZen switches Zen on and starts its flight");
  env.key({ key: "F", code: "KeyF", repeat: true });
  assert.equal(env.state.zenCalls, 1, "a held chord does not repeat");
  assert.equal(env.key({ key: "F", code: "KeyF", shiftKey: false }).prevented, false, "Ctrl Alt F alone is not the chord");

  const other = environment();
  await flush();
  const passed = other.key({ key: "F", code: "KeyF" });
  assert.equal(passed.prevented, false, "another install never claims the chord");
  assert.equal(other.state.zenCalls, 0);
});

test("demo mode has no camera or input code of its own: Zen owns the flight", async () => {
  const env = environment({ prefs: { demoPanel: true } });
  await env.advance(60000);
  for (const type of ["pointermove", "pointerdown", "wheel"]) assert.equal((env.windowListeners[type] ?? []).length, 0, `${type} is not bound`);
  assert.doesNotMatch(source, /setDirector|command-tour|demoTour/);
});
