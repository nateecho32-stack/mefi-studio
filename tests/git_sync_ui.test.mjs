// renderer/git-sync.js (the Push and Pull chip, its popover and the Save and
// push, Publish, Link and Sign in dialogs) in a vm with the shared fake DOM and
// a fake git bridge (tests/fixtures/git-sync-bridge.cjs). Pinned here: every
// state id draws its label, tone and glyph; the popover opens, closes on Esc,
// on a click away, on a move of focus, on a navigation and on a window blur,
// and gives the focus back to the chip; a direct outward action asks twice
// (armed, then sent) and a second operation waits for the first; Save and push
// counts what is ticked, leaves blocked files out and commits nothing on its
// own; Publish is private by default and public needs the name typed back;
// the sign-in dialog looks every two seconds only while it is open; Check now
// refreshes at most once a minute; routine changes go to one status region and
// only failures to the alert. Real geometry and pixels are for an Electron
// capture (the fixture's pageSource feeds one).
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

import { createDom, Element } from "./fixtures/renderer-dom.mjs";

const require = createRequire(import.meta.url);
const kit = require("./fixtures/git-sync-bridge.cjs");
const source = await readFile(new URL("../renderer/git-sync.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../renderer/git-sync.css", import.meta.url), "utf8");
const navSource = await readFile(new URL("../renderer/nav.js", import.meta.url), "utf8");
const vibeSource = await readFile(new URL("../renderer/vibe.js", import.meta.url), "utf8");
const shellSource = await readFile(new URL("../renderer/shell.js", import.meta.url), "utf8");
const sessionsSource = await readFile(new URL("../renderer/sessions.js", import.meta.url), "utf8");

const settle = () => new Promise((resolve) => setImmediate(resolve));
const flush = async () => { for (let i = 0; i < 40; i += 1) await Promise.resolve(); await settle(); for (let i = 0; i < 40; i += 1) await Promise.resolve(); };
// What the vm hands back is copied out of its realm before deep equality sees it.
const plain = (value) => (value === undefined ? value : JSON.parse(JSON.stringify(value)));

function load({ state = "ahead", over, replies, taken, account, ghInstalled, width = 1920, bridge = true, vibe = null, storage = null } = {}) {
  const fake = kit.createFakeGitBridge({ state, over, replies, taken, account, ghInstalled });
  // What main pushes on projects:changed reaches the window through onProjects; the fake keeps the callback to itself, so catch it on the way in.
  const projectListeners = [];
  const onProjects = fake.api.onProjects;
  fake.api.onProjects = (callback) => { projectListeners.push(callback); onProjects(callback); };
  const dom = createDom();
  const { document, body } = dom;
  class Node extends Element {
    constructor(tag) { super(tag); this.style = { setProperty(name, value) { this[name] = value; } }; }
    get isConnected() { let node = this; while (node) { if (node === body) return true; node = node.parentNode; } return false; }
    getClientRects() { return this.isConnected ? [{}] : []; }
    focus() { document.activeElement = this; this.focused = true; }
    blur() { if (document.activeElement === this) document.activeElement = null; this.focused = false; }
  }
  document.createElement = (tag) => new Node(tag);
  document.createElementNS = (_namespace, tag) => new Node(tag);
  const clock = { now: Date.now() };
  class FakeDate extends Date { static now() { return clock.now; } }
  const timers = [];
  let timerId = 0;
  const listeners = {};
  const toasts = [];
  const composed = [];
  const stored = new Map(Object.entries(storage ?? {}));
  const window = {
    mefiStudio: bridge ? fake.api : undefined,
    innerWidth: width, innerHeight: 1080,
    addEventListener: (name, fn) => { (listeners[name] ??= []).push(fn); },
    removeEventListener: (name, fn) => { listeners[name] = (listeners[name] ?? []).filter((entry) => entry !== fn); },
    dispatchEvent: (event) => { for (const fn of listeners[event.type] ?? []) fn(event); },
    MefiToast: (text, kind, options) => { toasts.push({ text, kind, action: options?.action ?? null }); },
    MefiUi: { plainError: (error, fallback) => String(error?.message || "") || fallback },
  };
  if (vibe) window.MefiVibe = { composeEvolution: (options) => { composed.push(plain(options)); return true; } };
  const sandbox = vm.createContext({
    window, document, console, Date: FakeDate, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    localStorage: { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => { stored.set(key, String(value)); } },
    setTimeout: (fn, ms = 0) => { timerId += 1; timers.push({ id: timerId, fn, at: clock.now + ms, every: 0 }); return timerId; },
    clearTimeout: (id) => { const at = timers.findIndex((timer) => timer.id === id); if (at >= 0) timers.splice(at, 1); },
    setInterval: (fn, ms) => { timerId += 1; timers.push({ id: timerId, fn, at: clock.now + ms, every: ms }); return timerId; },
    clearInterval: (id) => { const at = timers.findIndex((timer) => timer.id === id); if (at >= 0) timers.splice(at, 1); },
  });
  vm.runInContext(source, sandbox);
  const advance = async (ms) => {
    const end = clock.now + ms;
    for (;;) {
      const due = timers.filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      clock.now = Math.max(clock.now, due.at);
      if (due.every) due.at += due.every; else timers.splice(timers.indexOf(due), 1);
      due.fn();
      await flush();
    }
    clock.now = end;
    await flush();
  };
  const fire = (name, event = {}) => { for (const fn of [...(listeners[name] ?? [])]) fn({ type: name, ...event }); };
  // The row most cases mount the plain chip in (no variant); the list column's and Vibe's are made by their own cases.
  const nav = new Node("nav");
  nav.id = "chip-row";
  body.append(nav);
  const h = { fake, dom, document, body, window, sync: window.MefiGitSync, nav, timers, toasts, composed, stored, clock, advance, fire, listeners };
  h.q = (selector, root = document) => root.querySelector(selector);
  h.all = (selector, root = document) => root.querySelectorAll(selector);
  h.chip = () => nav.querySelector(".gs-chip");
  h.pop = () => document.querySelector(".gs-pop");
  h.pushProjects = (payload) => { for (const callback of projectListeners) callback(JSON.parse(JSON.stringify(payload))); };
  h.role = (root, role) => root.querySelectorAll("[data-role]").find((node) => node.dataset.role === role) ?? null;
  // The dialog on top: the last one showing, or the last one that was (closed and fading).
  h.sheet = () => { const sheets = document.querySelectorAll(".gs-sheet"); return sheets.filter((sheet) => !sheet.parentNode.hidden).at(-1) ?? sheets.at(-1) ?? null; };
  h.status = () => document.querySelector("#git-sync-status").textContent;
  h.alert = () => document.querySelector("#git-sync-alert").textContent;
  h.text = (node) => node.textContent;
  h.mount = () => h.sync.mount(nav);
  h.open = async () => { await h.chip().click(); await flush(); return h.pop(); };
  return h;
}
const ready = async (options) => { const h = load(options); h.mount(); await flush(); return h; };

// ---- the chip ---------------------------------------------------------------------------

test("every state id draws its label, tone and glyph, and the chip is a button that opens a dialog", async () => {
  const h = await ready({ state: "in-sync" });
  assert.equal(kit.STATE_IDS.length, 31, "the boards' vocabulary has 31 states");
  const chip = h.chip();
  assert.equal(chip.tagName, "button");
  assert.equal(chip.getAttribute("aria-haspopup"), "dialog");
  assert.equal(chip.getAttribute("aria-expanded"), "false");
  for (const id of kit.STATE_IDS) {
    const model = kit.sampleModel(id);
    h.fake.push(model);
    assert.equal(chip.dataset.state, id, id);
    assert.equal(chip.dataset.tone, model.tone, `${id} tone`);
    assert.equal(chip.querySelector(".gs-chip-label").textContent, model.label, `${id} label`);
    assert.equal(chip.getAttribute("aria-label"), `GitHub sync: ${model.label}`, `${id} keeps a name that says what it is, and holds its label, when the label is hidden`);
    const glyph = chip.querySelector("svg");
    assert.equal(glyph.dataset.glyph, model.glyph, `${id} glyph`);
    assert.ok(glyph.children.length > 0, `${id} has a drawing`);
    assert.equal(glyph.getAttribute("aria-hidden"), "true");
  }
  h.fake.push(kit.sampleModel("checking"));
  assert.match(chip.querySelector("svg").className, /gs-spin/, "checking spins");
  h.fake.push(kit.sampleModel("pushing"));
  assert.match(chip.querySelector("svg").children[0].getAttribute("class"), /gs-arc/, "pushing turns its arc");
});

test("the count rides as a badge for what is waiting, and a tone outside the five reads as neutral", async () => {
  const h = await ready({ state: "ahead" });
  const badge = h.chip().querySelector(".gs-chip-badge");
  assert.equal(badge.textContent, "2");
  assert.equal(badge.hidden, false);
  h.fake.push(kit.sampleModel("behind"));
  assert.equal(badge.textContent, "3");
  h.fake.push(kit.sampleModel("uncommitted"));
  assert.equal(h.chip().querySelector(".gs-chip-badge").textContent, "4");
  h.fake.push(kit.sampleModel("in-sync"));
  assert.equal(h.chip().querySelector(".gs-chip-badge").hidden, true, "counts hide at zero");
  h.fake.push({ ...kit.sampleModel("ahead"), tone: "purple", glyph: "constructor" });
  assert.equal(h.chip().dataset.tone, "neutral");
  assert.equal(h.chip().querySelector("svg").dataset.glyph, "ahead", "an unknown glyph name falls back to the state's own drawing");
});

test("nothing draws without a project or a bridge, and a project switch forgets the old answer and looks again", async () => {
  const none = await ready({ bridge: false });
  assert.equal(none.chip().parentNode.hidden, true, "the browser preview has no host");
  assert.equal(none.sync.model(), null);
  assert.equal(none.sync.open(), false);

  const h = await ready({ replies: { gitState: { ok: false } } });
  assert.equal(h.chip().parentNode.hidden, true, "no project open: no chip");

  const g = await ready({ state: "ahead" });
  assert.equal(g.chip().parentNode.hidden, false);
  g.fake.hold("gitState");
  g.fire("mefi:project-changed");
  assert.equal(g.chip().parentNode.hidden, true, "the old project's answer is dropped at once");
  assert.equal(g.fake.names().filter((name) => name === "gitState").length, 2);
  g.fake.push(kit.sampleModel("behind"));
  g.fake.release("gitState", { ok: true, model: kit.sampleModel("in-sync") });
  await flush();
  assert.equal(g.chip().dataset.state, "in-sync");
});

test("the chip goes at the tail of its row and back there after the row is rebuilt; in Vibe it follows New app", async () => {
  const h = await ready();
  const first = h.nav.children[h.nav.children.length - 1];
  assert.equal(first, h.chip().parentNode);
  assert.equal(first.dataset.variant, undefined, "no variant asked for: the plain tone chip");
  assert.equal(h.sync.mount(new h.nav.constructor("div"), { variant: "bar" }).dataset.variant, undefined, "the section bar's variant is gone: an unknown one is the plain chip");
  h.nav.textContent = "";
  h.nav.append(new h.nav.constructor("button"));
  h.mount();
  h.mount();
  assert.equal(h.nav.children.length, 2, "mounting again adds nothing");
  assert.equal(h.nav.children[1], first, "the same chip, back at the tail");

  const cluster = new h.nav.constructor("div");
  const project = new h.nav.constructor("button");
  const newApp = new h.nav.constructor("button");
  const after = new h.nav.constructor("div");
  cluster.append(project, newApp, after);
  h.body.append(cluster);
  const slot = h.sync.mount(cluster, { after: newApp, variant: "vibe" });
  assert.equal(cluster.children.indexOf(slot), 2, "right after New app");
  assert.equal(slot.dataset.variant, "vibe");
  assert.equal(cluster.children.length, 4);
});

test("in the 0.5 frame's list column the chip carries the branch before the state, keeps its words, and opens the same popover", async () => {
  const h = await ready({ state: "uncommitted" });
  const head = new h.nav.constructor("div");
  h.body.append(head);
  const slot = h.sync.mount(head, { variant: "list" });
  assert.equal(slot.dataset.variant, "list");
  assert.equal(h.sync.mount(head, { variant: "list" }), slot, "mounting again keeps the one chip");
  const chip = slot.querySelector(".gs-chip");
  const model = kit.sampleModel("uncommitted");
  assert.equal(chip.querySelector(".gs-chip-branch-name").textContent, model.branch, "the branch the host names");
  assert.ok(chip.querySelector(".gs-chip-sep"), "a rule between the branch and the state");
  assert.equal(chip.querySelector(".gs-chip-label").textContent, model.label, "the host's own words for the state");
  assert.equal(chip.querySelector(".gs-chip-badge").hidden, true, "the words carry the count: no badge as well");
  assert.equal(chip.getAttribute("aria-label"), `GitHub sync: ${model.branch}, ${model.label}`, "its name holds both visible parts");
  assert.equal(h.chip().querySelector(".gs-chip-branch"), null, "the bar's chip is as it was");
  h.fake.push({ ...kit.sampleModel("in-sync"), branch: "" });
  assert.equal(chip.querySelector(".gs-chip-branch"), null, "no branch named, no branch drawn");
  await chip.click(); await flush();
  assert.equal(h.pop().hidden, false, "one popover for every chip");
  assert.equal(chip.getAttribute("aria-expanded"), "true");
  assert.match(styles, /\.gs-slot\[data-variant="list"\] \.gs-chip \{[^}]*height: 28px/, "a 28px chip in the list column");
  assert.match(styles, /\.gs-slot\[data-variant="list"\] \.gs-chip:not\(\.gs-chip-static\) \.gs-chip-label \{ display: inline; \}/, "that keeps its words in a small window");
});

test("vibe.js and the frame's list column (shell.js, sessions.js) hand the chip its place, and the stylesheet keeps the chip's rules", () => {
  assert.match(vibeSource, /window\.MefiGitSync\?\.mount\?\.\(\$\("new-app"\)\?\.parentNode, \{ after: \$\("new-app"\), variant: "vibe" \}\)/);
  assert.match(shellSource, /window\.MefiGitSync\?\.mount\?\.\(pages\.git, \{ variant: "list" \}\)/, "a section's page list");
  assert.match(sessionsSource, /window\.MefiGitSync\?\.mount\?\.\(panel\.git, \{ variant: "list" \}\)/, "a session list's head");
  assert.doesNotMatch(navSource, /MefiGitSync/, "nav.js draws no section bar, so it mounts no chip");
  assert.match(styles, /@media \(max-width: 899px\)[^}]*\{[^}]*\.gs-chip:not\(\.gs-chip-static\) \{[^}]*width: 36px/, "under 900px the chip is a 36px glyph");
  assert.match(styles, /\.gs-chip:not\(\.gs-chip-static\) \.gs-chip-label \{ display: none; \}/, "and its words go");
  assert.match(styles, /body\.command-zen \.gs-slot \{ display: none; \}/, "hidden in Zen");
  assert.doesNotMatch(styles, /data-shell/, "the rail is the only shell: nothing hides the chip outside it");
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.gs-spin, \.gs-arc, \.gs-march \{ animation: none; \}/);
  assert.match(styles, /\.gs-slot\[data-variant="vibe"\] \.gs-chip \{[^}]*height: 36px/, "36px in Vibe");
  assert.match(styles, /\.gs-chip \{[^}]*min-height: 26px/, "26px tone chip elsewhere");
  assert.match(styles, /\.gs-pop \{[^}]*position: fixed[^}]*var\(--studio-float-fill/, "a fixed popover on the menu recipe");
  assert.doesNotMatch(styles, /\.gs-chip[^{]*\{[^}]*color: var\(--(good|info|warn|bad)\)/, "tone never colours a chip's words");
});

// ---- the popover --------------------------------------------------------------------------

test("the chip opens the popover: title row, one sentence, the numbers, one primary, one secondary, and the footer", async () => {
  const h = await ready({ state: "ahead", over: { details: ["a1", "b2"] } });
  const pop = await h.open();
  assert.equal(pop.hidden, false);
  assert.equal(pop.getAttribute("role"), "dialog");
  assert.equal(pop.getAttribute("aria-label"), "GitHub sync for Mefi's Studio AI+");
  assert.equal(h.chip().getAttribute("aria-expanded"), "true");
  assert.equal(h.document.activeElement, pop, "focus moves into the popover");
  assert.equal(pop.querySelector(".gs-branch").textContent, "main");
  assert.equal(pop.querySelector(".gs-chip-static .gs-chip-label").textContent, "2 to push");
  assert.equal(pop.querySelector(".gs-sentence").textContent, "Some work on this PC is not on GitHub yet.");
  assert.deepEqual(pop.querySelectorAll(".gs-facts dt").map((node) => node.textContent), ["Not pushed", "On GitHub"]);
  assert.deepEqual(pop.querySelectorAll(".gs-facts dd").map((node) => node.textContent), ["2 commits on main", "nateecho32-stack/mefi-studio"]);
  assert.deepEqual(pop.querySelectorAll(".gs-lines li").map((node) => node.textContent), ["a1", "b2"]);
  assert.equal(h.role(pop, "primary").textContent, "Push 2 commits");
  assert.equal(pop.querySelectorAll("button").filter((node) => node.className.includes("primary")).length, 1, "one primary, never two competing buttons");
  assert.equal(pop.querySelector(".gs-when").textContent, "Last checked 3 minutes ago");
  assert.equal(h.role(pop, "check-now").textContent, "Check now");
  assert.equal(h.role(pop, "open-github").textContent, "Open on GitHub");
  assert.equal(h.role(pop, "friends").textContent, "Details in Friends › Your PCs");
  assert.equal(h.fake.names().filter((name) => name === "gitState").length, 2, "opening reads the local picture again");
  assert.equal(h.pop(), pop, "one persistent popover");
});

test("Esc closes it and the focus goes back to the chip; the second press of Esc does not fall through", async () => {
  const h = await ready();
  const pop = await h.open();
  let stopped = 0;
  await pop.trigger("keydown", { key: "Escape", stopPropagation() { stopped += 1; } });
  assert.equal(pop.hidden, true);
  assert.equal(h.chip().getAttribute("aria-expanded"), "false");
  assert.equal(h.document.activeElement, h.chip(), "focus returns to the chip");
  assert.equal(stopped, 1, "Escape is this popover's, not the page's");
  await pop.trigger("keydown", { key: "Escape", stopPropagation() { stopped += 1; } });
  assert.equal(stopped, 1, "closed: it leaves Escape alone");
  await h.open();
  await h.chip().click();
  assert.equal(h.pop().hidden, true, "the chip toggles it");
  assert.equal(h.document.activeElement, h.chip());
  await h.open();
  await h.role(h.pop(), "close").click();
  assert.equal(h.pop().hidden, true, "the close button does the same");
  assert.equal(h.document.activeElement, h.chip());
});

test("Enter, Space and the arrows stay inside the popover (Command behind it would read them as its own), while letters travel on to the shortcuts", async () => {
  const h = await ready();
  const pop = await h.open();
  let stopped = 0;
  const press = (key, extra = {}) => pop.trigger("keydown", { key, stopPropagation() { stopped += 1; }, ...extra });
  for (const key of ["Enter", " ", "ArrowLeft", "ArrowDown", "Home", "PageDown"]) await press(key);
  assert.equal(stopped, 6, "nothing on the popover answers them, and the page must not either");
  for (const key of ["n", "3", "?"]) await press(key);
  assert.equal(stopped, 6, "opening the popover does not swallow a letter shortcut");
  await press("k", { ctrlKey: true });
  await press("Enter", { altKey: true });
  assert.equal(stopped, 6, "chords pass");
  await h.chip().trigger("keydown", { key: "ArrowRight", stopPropagation() { stopped += 1; } });
  assert.equal(stopped, 6, "on the chip the arrows still reach the bar, which moves along its buttons");
});

test("it lets go on a click away, a move of focus, a navigation and a window blur, and never takes the focus back then", async () => {
  const h = await ready();
  const other = new h.nav.constructor("button");
  h.body.append(other);
  await h.open();
  await h.body.trigger("pointerdown", { target: h.pop() });
  assert.equal(h.pop().hidden, false, "a click inside stays");
  await h.body.trigger("pointerdown", { target: other });
  assert.equal(h.pop().hidden, true, "a click away closes it");

  await h.open();
  other.focus();
  await h.pop().trigger("focusout", { relatedTarget: other });
  await h.advance(0);
  assert.equal(h.pop().hidden, true, "focus moved on: closed");
  assert.equal(h.document.activeElement, other, "and the focus stays where it went");

  await h.open();
  h.fire("mefi:nav", { detail: { id: "tasks" } });
  assert.equal(h.pop().hidden, true, "a navigation closes it, so letter shortcuts are never swallowed");

  await h.open();
  h.fire("blur");
  assert.equal(h.pop().hidden, true, "a window blur closes it");

  await h.open();
  h.fake.push(null);
  assert.equal(h.pop().hidden, true, "no state to show: closed");
});

test("the popover repaints when a new state is pushed and keeps the focus on the same button", async () => {
  const h = await ready({ state: "behind" });
  const pop = await h.open();
  const primary = h.role(pop, "primary");
  primary.focus();
  h.fake.push({ ...kit.sampleModel("behind"), counts: { ahead: 0, behind: 5, dirty: 0 }, primary: { id: "pull", label: "Pull 5 commits", confirm: false } });
  assert.equal(h.role(pop, "primary").textContent, "Pull 5 commits");
  assert.equal(h.document.activeElement, h.role(pop, "primary"), "the focus follows the button to its new drawing");
  assert.equal(h.pop().hidden, false, "a repaint is not a blur");
});

test("each state's popover carries its own words: diverged shows both sides, signed out and unlinked add their notes", async () => {
  const h = await ready({ state: "diverged" });
  let pop = await h.open();
  assert.deepEqual(pop.querySelectorAll(".gs-cell").map((cell) => cell.textContent), ["This PC2 commitsnot on GitHub", "GitHub3 commitsnot on this PC"]);
  assert.equal(h.role(pop, "primary").textContent, "Put my commits on top of GitHub's");
  assert.match(pop.textContent, /Both sets of work stay\. If the same lines clash, nothing is changed\./);
  assert.equal(pop.querySelectorAll(".gs-facts dt").some((node) => node.textContent === "Not pushed"), false, "the two sides replace the counts");

  h.fake.push(kit.sampleModel("signed-out"));
  assert.match(h.pop().textContent, /You sign in on GitHub's own page\. Studio never asks for your password\./);
  assert.equal(h.role(h.pop(), "primary").textContent, "Sign in to GitHub");
  assert.equal(h.role(h.pop(), "check-now"), null, "nothing to check while signed out");
  assert.equal(h.role(h.pop(), "open-github"), null, "and nothing to open yet: the footer keeps only the way to Your PCs");
  assert.equal(h.role(h.pop(), "friends").textContent, "Details in Friends › Your PCs");

  h.fake.push(kit.sampleModel("no-remote"));
  pop = h.pop();
  assert.deepEqual(pop.querySelectorAll(".gs-facts dd").map((node) => node.textContent), ["Not linked yet"]);
  assert.match(pop.textContent, /You choose the name and who can see it next\. Private is the default\./);
  assert.equal(h.role(pop, "secondary").textContent, "Link to a repo I already have");

  h.fake.push(kit.sampleModel("in-sync"));
  pop = h.pop();
  assert.deepEqual(pop.querySelectorAll(".gs-facts dd").map((node) => node.textContent), ["Nothing", "nateecho32-stack/mefi-studio"]);
  assert.equal(h.role(pop, "primary").textContent, "Check GitHub");
  assert.equal(h.role(pop, "secondary").textContent, "Open on GitHub");
  assert.equal(h.role(pop, "check-now"), null, "Check GitHub is the primary, so no second Check now");
});

test("a long list of detail lines waits behind Show, a Show with nothing to show is left out, and a door this build lacks is not drawn dead", async () => {
  const lines = ["one", "two", "three", "four", "five"];
  const h = await ready({ state: "check-failed", over: { details: lines } });
  const pop = await h.open();
  assert.deepEqual(pop.querySelectorAll(".gs-lines li").map((node) => node.textContent), ["one", "two", "three"]);
  assert.match(pop.querySelector(".gs-lines").className, /gs-output/, "a failure's lines read as output");
  assert.equal(h.role(pop, "primary"), null, "Ask Mefi has no door without a Vibe brief to stage it in");
  const show = h.role(pop, "secondary");
  assert.equal(show.textContent, "Show check output");
  await show.click();
  assert.deepEqual(h.pop().querySelectorAll(".gs-lines li").map((node) => node.textContent), lines);
  assert.equal(h.role(h.pop(), "secondary").textContent, "Show less");
  h.fake.push({ ...kit.sampleModel("check-failed"), details: ["only one"] });
  assert.equal(h.role(h.pop(), "secondary"), null, "nothing more to show: no Show button");
  h.fake.push(kit.sampleModel("conflict"));
  assert.equal(h.role(h.pop(), "secondary"), null, "Open the folder has no door here");

  const asked = await ready({ state: "check-failed", vibe: true });
  const open = await asked.open();
  const ask = asked.role(open, "primary");
  assert.equal(ask.textContent, "Ask Mefi to fix it");
  await ask.click();
  assert.equal(asked.composed.length, 1);
  assert.equal(asked.composed[0].intent, "fix");
  assert.match(asked.composed[0].prompt, /The project's check failed, so nothing was pushed/);
  assert.equal(asked.pop().hidden, true, "the popover steps aside for the brief");
});

// ---- the primary: armed, one at a time, and what it answers with ------------------------------------

test("Push arms on the first press and sends on the second; the arming lapses after three seconds, on Esc and on blur", async () => {
  const h = await ready({ state: "ahead" });
  let pop = await h.open();
  let primary = h.role(pop, "primary");
  await primary.click();
  assert.deepEqual(h.fake.names().filter((name) => name === "gitPush"), [], "one press sends nothing");
  primary = h.role(h.pop(), "primary");
  assert.match(primary.className, /gs-armed/);
  assert.equal(primary.getAttribute("aria-pressed"), "true");
  assert.match(h.pop().textContent, /Press again to confirm\. Nothing is sent until you do\./);
  assert.equal(h.status(), "Press again to push 2 commits.");
  await h.advance(3000);
  assert.doesNotMatch(h.role(h.pop(), "primary").className, /gs-armed/, "three seconds later it is a plain button again");
  assert.equal(h.fake.names().includes("gitPush"), false);

  await h.role(h.pop(), "primary").click();
  assert.match(h.role(h.pop(), "primary").className, /gs-armed/);
  await h.pop().trigger("keydown", { key: "Escape" });
  assert.equal(h.pop().hidden, false, "the first Esc only disarms");
  assert.doesNotMatch(h.role(h.pop(), "primary").className, /gs-armed/);
  await h.role(h.pop(), "primary").click();
  await h.role(h.pop(), "primary").trigger("blur");
  assert.doesNotMatch(h.role(h.pop(), "primary").className, /gs-armed/, "leaving the button disarms it");

  await h.role(h.pop(), "primary").click();
  h.fake.hold("gitPush");
  const second = h.role(h.pop(), "primary");
  second.focus();
  await second.click();
  await flush();
  assert.deepEqual(plain(h.fake.last("gitPush")), [{ projectId: "p1" }], "the second press sends the push for the project it was drawn for, and with no other options");
  assert.equal(h.chip().dataset.state, "pushing", "the chip answers at once");
  assert.equal(h.role(h.pop(), "primary").getAttribute("aria-disabled"), "true", "held while it works");
  assert.equal(h.role(h.pop(), "primary").disabled, false, "and not disabled: the focus stays on the button that was pressed");
  assert.equal(h.document.activeElement, h.role(h.pop(), "primary"));
  assert.equal(h.role(h.pop(), "primary").textContent, "Pushing…");
  await h.role(h.pop(), "primary").click();
  assert.deepEqual(h.fake.names().filter((name) => name === "gitPush"), ["gitPush"], "pressing it while it works sends nothing more");
  h.fake.release("gitPush");
  await flush();
  assert.equal(h.document.activeElement?.dataset?.role, "primary", "the focus goes on to the button that takes its place");
  assert.equal(h.chip().dataset.state, "success");
  assert.deepEqual(plain(h.toasts.at(-1)).text, "Pushed 2 commits to GitHub.");
  assert.equal(h.toasts.at(-1).kind, "good");
  assert.equal(h.toasts.at(-1).action.label, "Open on GitHub");
  await h.toasts.at(-1).action.run();
  assert.deepEqual(plain(h.fake.last("openExternal")), ["https://github.com/nateecho32-stack/mefi-studio"]);
});

test("a second operation waits for the first, and a pull that needs no confirming goes at once", async () => {
  const h = await ready({ state: "behind" });
  await h.open();
  h.fake.hold("gitPull");
  await h.role(h.pop(), "primary").click();
  await flush();
  assert.deepEqual(h.fake.pending(), ["gitPull"]);
  assert.equal(h.chip().dataset.state, "pulling");
  const chip = h.chip();
  await chip.click();
  await h.role(h.pop(), "check-now")?.click?.();
  assert.deepEqual(h.fake.names().filter((name) => name === "gitCheck" || name === "gitPush"), [], "nothing else is sent while the pull is out");
  h.fake.release("gitPull");
  await flush();
  assert.equal(h.toasts.at(-1).text, "Pulled 3 commits from GitHub.");
  assert.equal(h.toasts.at(-1).action, null, "only a push offers Open on GitHub");
});

test("a pull while agents build asks first (the question is the confirm), then pulls anyway", async () => {
  const h = await ready({ state: "agents-working" });
  await h.open();
  assert.match(h.pop().textContent, /Agents are still changing files in this project\. Pull now anyway\?/);
  assert.equal(h.role(h.pop(), "primary").textContent, "Pull now");
  assert.equal(h.role(h.pop(), "secondary").textContent, "Wait");
  await h.role(h.pop(), "secondary").click();
  assert.equal(h.pop().hidden, true, "Wait just closes the popover");
  assert.equal(h.fake.names().includes("gitPull"), false);
  await h.open();
  await h.role(h.pop(), "primary").click();
  assert.deepEqual(plain(h.fake.last("gitPull")), [{ anyway: true, projectId: "p1" }], "a plain pull would not say anyway, and this one names the project it was drawn for");
});

test("a secondary the host marks as confirming asks twice too, and rebase asks before it puts commits on top", async () => {
  const both = { ...kit.sampleModel("ahead"), counts: { ahead: 2, behind: 0, dirty: 3 }, primary: { id: "save-and-push", label: "Save and push 3 files", confirm: false }, secondary: { id: "push", label: "Push 2 commits only", confirm: true } };
  const h = await ready({ state: "ahead", over: both });
  await h.open();
  assert.equal(h.role(h.pop(), "primary").textContent, "Save and push 3 files");
  await h.role(h.pop(), "secondary").click();
  assert.deepEqual(h.fake.names().filter((name) => name === "gitPush"), [], "one press only arms");
  assert.match(h.role(h.pop(), "secondary").className, /gs-armed/);
  assert.match(h.pop().textContent, /Press again to confirm\./);
  assert.match(h.role(h.pop(), "primary").className, /^((?!gs-armed).)*$/, "the primary is not the armed one");
  await h.role(h.pop(), "secondary").click();
  await flush();
  assert.deepEqual(plain(h.fake.last("gitPush")), [{ projectId: "p1" }], "the confirmed secondary pushes for the project it was drawn for");

  const diverged = await ready({ state: "diverged" });
  await diverged.open();
  await diverged.role(diverged.pop(), "primary").click();
  assert.equal(diverged.fake.names().includes("gitRebase"), false);
  assert.equal(diverged.status(), "Press again to put my commits on top of GitHub's.");
  await diverged.role(diverged.pop(), "primary").click();
  await flush();
  assert.deepEqual(diverged.fake.names().filter((name) => name === "gitRebase"), ["gitRebase"]);
  assert.deepEqual(plain(diverged.fake.last("gitRebase")), [{ projectId: "p1" }], "the rebase names the project it was drawn for");
  assert.equal(diverged.toasts.at(-1).text, "Put 2 commits from this PC on top of GitHub's.");
});

test("a working state lists its steps instead of running them together, and draws the host's own stages when it sends them", async () => {
  const h = await ready({ state: "pushing" });
  const pop = await h.open();
  assert.deepEqual(pop.querySelectorAll(".gs-stage-label").map((node) => node.textContent), ["Checking nothing was left out", "Running the project's check", "Uploading 2 commits"]);
  assert.deepEqual(pop.querySelectorAll(".gs-stage").map((row) => row.dataset.state), ["step", "step", "step"], "nothing says how far it got, so none is drawn as done");
  assert.equal(pop.querySelector(".gs-sentence"), null, "the sentence is those same steps run together");
  assert.equal(h.role(pop, "primary").textContent, "Pushing…");
  assert.equal(h.role(pop, "primary").getAttribute("aria-disabled"), "true");
  assert.equal(pop.querySelector(".gs-stages").getAttribute("aria-label"), "Push progress");
  assert.equal(pop.querySelector(".gs-pop-foot"), null, "a working state shows its steps and nothing under them");
  h.fake.push({ ...kit.sampleModel("pushing"), stages: [{ label: "Checking nothing was left out", state: "done" }, { label: "Running the project's check", state: "active" }, { label: "Uploading 2 commits", state: "waiting" }] });
  assert.deepEqual(h.pop().querySelectorAll(".gs-stage").map((row) => row.dataset.state), ["done", "active", "waiting"]);
  assert.deepEqual(h.pop().querySelectorAll(".gs-stage .sr-only").map((node) => node.textContent), ["done", "in progress", "waiting"], "the state is a word as well as a picture");
  h.fake.push(kit.sampleModel("saving"));
  assert.equal(h.pop().querySelector(".gs-sentence").textContent, "Saving 4 files on this PC.", "a working state with no steps says its sentence");
});

test("the host's own hint lines and repeated numbers are not shown twice", async () => {
  const h = await ready({ state: "diverged" });
  const pop = await h.open();
  assert.equal(pop.textContent.split("Both sets of work stay.").length - 1, 1, "the hint once, under the button");
  assert.equal(pop.querySelectorAll(".gs-lines li").length, 0, "the numbers already sit in the two boxes");
  h.fake.push(kit.sampleModel("uncommitted"));
  assert.equal(h.pop().textContent.split("Uncommitted files stay on this PC unless you save them.").length - 1, 1);
  h.fake.push({ ...kit.sampleModel("ahead"), details: ["2 commits on main not pushed yet.", "3 uncommitted files in this checkout.", "Branch wip/cli on this PC: 1 commit not on main."] });
  assert.deepEqual(h.pop().querySelectorAll(".gs-lines li").map((node) => node.textContent), ["Branch wip/cli on this PC: 1 commit not on main."]);
  const old = { ...kit.sampleModel("uncommitted"), details: [] };
  h.fake.push(old);
  assert.match(h.pop().textContent, /Uncommitted files stay on this PC unless you save them\./, "and one that the host left out is still said");
});

test("the chip's badge follows the host's short number", async () => {
  const h = await ready({ state: "ahead", over: { short: "9", counts: { ahead: 2, behind: 0, dirty: 0 } } });
  assert.equal(h.chip().querySelector(".gs-chip-badge").textContent, "9");
});

test("a failure is a toast, and it also goes to the alert region while routine changes go to the status region", async () => {
  const h = await ready({ state: "ahead", replies: { gitPush: { ok: false, error: "The project's check failed, so nothing was pushed. Fix it, then sync again.", model: kit.sampleModel("check-failed") } } });
  assert.equal(h.status(), "", "the first look announces nothing");
  h.fake.push(kit.sampleModel("behind"));
  assert.equal(h.status(), "GitHub sync: 3 to pull", "a routine change is read out once, with whose it is");
  assert.equal(h.alert(), "");
  h.fake.push(kit.sampleModel("ahead"));
  assert.equal(h.status(), "GitHub sync: 2 to push");
  h.fake.push(kit.sampleModel("ahead"));
  assert.equal(h.status(), "GitHub sync: 2 to push");
  assert.equal(h.document.querySelector("#git-sync-status").getAttribute("role"), "status");
  assert.equal(h.document.querySelector("#git-sync-alert").getAttribute("role"), "alert");
  await h.open();
  await h.role(h.pop(), "primary").click();
  await h.role(h.pop(), "primary").click();
  await flush();
  assert.equal(h.chip().dataset.state, "check-failed");
  assert.equal(h.alert(), "The project's check failed, so nothing was pushed. Fix it, then sync again.");
  assert.equal(h.toasts.at(-1).kind, "bad");
});

test("Check now refreshes at most once a minute, and Last checked reads the model's own clock", async () => {
  const h = await ready({ state: "ahead" });
  await h.open();
  await h.role(h.pop(), "check-now").click();
  assert.equal(h.fake.names().filter((name) => name === "gitCheck").length, 1);
  assert.equal(h.pop().querySelector(".gs-when").textContent, "Last checked just now");
  const link = h.role(h.pop(), "check-now");
  assert.equal(link.getAttribute("aria-disabled"), "true", "just checked: it says so");
  await link.click();
  assert.equal(h.fake.names().filter((name) => name === "gitCheck").length, 1, "a second press inside the minute does nothing");
  await h.advance(61000);
  assert.equal(h.role(h.pop(), "check-now").getAttribute("aria-disabled"), null);
  await h.role(h.pop(), "check-now").click();
  assert.equal(h.fake.names().filter((name) => name === "gitCheck").length, 2, "a minute later it looks again");
  await h.advance(5 * 60 * 1000);
  assert.match(h.pop().querySelector(".gs-when").textContent, /^Last checked \d+ minutes ago$/, "the words follow the clock while the popover is open");
});

// ---- Save and push ---------------------------------------------------------------------------------

const rowsOf = (h) => h.all(".gs-file-item", h.sheet()).map((row) => ({ path: row.querySelector(".gs-file-path").textContent, box: row.querySelector("input"), note: row.querySelector(".gs-strip-text")?.textContent ?? null, kind: row.querySelector(".gs-file-kind").textContent, size: row.querySelector(".gs-file-size").textContent }));
const tick = async (row, on) => { row.box.checked = on; await row.box.trigger("change"); };

test("Save and push lists the files with what changed, unticks what the host holds back, and blocks what it stopped", async () => {
  const h = await ready({ state: "uncommitted" });
  await h.open();
  assert.equal(h.role(h.pop(), "primary").textContent, "Save and push 4 files");
  await h.role(h.pop(), "primary").click();
  await flush();
  assert.equal(h.pop().hidden, true, "the popover steps aside");
  const sheet = h.sheet();
  assert.equal(sheet.getAttribute("role"), "dialog");
  assert.equal(sheet.getAttribute("aria-modal"), "true");
  assert.equal(sheet.querySelector("h2").textContent, "Save and push");
  assert.equal(sheet.querySelector(".gs-eyebrow").textContent, "Mefi's Studio AI+");
  assert.deepEqual(plain(h.fake.names().filter((name) => name === "gitSavePreview")), ["gitSavePreview"]);
  assert.deepEqual(plain(h.fake.last("gitSavePreview")), [{ projectId: "p1" }], "the host is asked about the project the dialog was opened for");
  const rows = rowsOf(h);
  assert.deepEqual(rows.map((row) => [row.path, row.kind, row.box.checked, row.box.disabled]), [
    ["scripts/sync.mjs", "Changed", true, false],
    ["renderer/pc-sync.js", "Changed", true, false],
    ["docs/github-linking.md", "New", true, false],
    ["old-notes.txt", "Deleted", true, false],
    ["installer.exe", "New", false, false],
    ["config/keys.txt", "New", false, true],
  ]);
  assert.equal(rows[4].size, "62 MB");
  assert.equal(rows[4].note, "installer.exe is 62 MB. GitHub warns about files over 50 MB.", "the host's own sentence, not its short label");
  assert.equal(rows[5].note, "Stopped: a private key file in config/keys.txt. It stays out of this save.");
  assert.equal(sheet.querySelector(".gs-tally").textContent, "4 of 6 ticked");
  assert.match(sheet.textContent, /Studio saves the files you keep ticked as one commit on main, then pushes it to GitHub\. Files you leave out stay on this PC\./);
  assert.equal(h.role(sheet, "primary").textContent, "Save and push 4 files");
  assert.equal(h.document.activeElement, sheet.querySelector("#git-sync-message"), "the focus lands on the message: a second Enter pressed at once commits nothing");
  assert.deepEqual(sheet.querySelectorAll(".gs-dialog-buttons button").map((node) => node.textContent), ["Cancel", "Save only", "Save and push 4 files"]);
});

test("the count in the primary follows the checkboxes, the default message follows the count, and none ticked turns it off", async () => {
  const h = await ready({ state: "uncommitted" });
  const done = h.sync.showSave({ push: true });
  await flush();
  const rows = rowsOf(h);
  const sheet = h.sheet();
  const message = sheet.querySelector("#git-sync-message");
  assert.equal(message.placeholder, "Studio save: 4 files");
  await tick(rows[2], false);
  assert.equal(sheet.querySelector(".gs-tally").textContent, "3 of 6 ticked");
  assert.equal(h.role(sheet, "primary").textContent, "Save and push 3 files");
  assert.equal(message.placeholder, "Studio save: 3 files");
  assert.match(sheet.textContent, /If you leave it empty, Studio uses Studio save: 3 files/);
  await tick(rows[4], true);
  assert.equal(h.role(sheet, "primary").textContent, "Save and push 4 files");
  for (const row of rows.slice(0, 5)) await tick(row, false);
  assert.equal(sheet.querySelector(".gs-tally").textContent, "0 of 6 ticked");
  const primary = h.role(sheet, "primary");
  assert.equal(primary.textContent, "Save and push");
  assert.equal(primary.disabled, true);
  await primary.click();
  assert.deepEqual(h.fake.names().filter((name) => name === "gitSave"), [], "nothing ticked: nothing saved");
  assert.equal(sheet.querySelectorAll(".gs-dialog-buttons button")[1].disabled, true, "Save only waits too");
  await h.role(sheet, "primary").trigger("keydown", { key: "Escape" });
  await sheet.trigger("keydown", { key: "Escape" });
  assert.deepEqual(plain(await done), { canceled: true });
  assert.equal(h.sheet().parentNode.hidden, true, "Escape cancels: nothing was saved");
  assert.equal(h.fake.names().includes("gitSave"), false);
});

test("Save and push sends only the ticked, unblocked paths and the typed message, and commits nothing before that", async () => {
  const h = await ready({ state: "uncommitted" });
  h.chip().focus();
  const done = h.sync.showSave({ push: true });
  await flush();
  assert.equal(h.fake.names().includes("gitSave"), false, "opening the dialog commits nothing");
  const rows = rowsOf(h);
  await tick(rows[3], false);
  const message = h.sheet().querySelector("#git-sync-message");
  message.value = "  Link Studio to GitHub  ";
  h.fake.hold("gitSave");
  await h.role(h.sheet(), "primary").click();
  await flush();
  assert.deepEqual(plain(h.fake.last("gitSave")), [{ paths: ["scripts/sync.mjs", "renderer/pc-sync.js", "docs/github-linking.md"], message: "Link Studio to GitHub", push: true, projectId: "p1" }]);
  assert.equal(h.chip().dataset.state, "saving", "the chip says the save is under way");
  assert.match(h.sheet().querySelector(".gs-dialog-note").textContent, /^Saving 3 files on this PC\.$/);
  assert.equal(h.sheet().getAttribute("aria-busy"), "true");
  await h.sheet().trigger("keydown", { key: "Escape" });
  assert.equal(h.sheet().parentNode.hidden, false, "a dialog in the middle of a host call waits");
  h.fake.release("gitSave");
  const result = plain(await done);
  assert.deepEqual(result, { ok: true, saved: 3, pushed: true, sha: "abc1234" });
  assert.equal(h.toasts.at(-1).text, "Saved 3 files and pushed to GitHub.");
  assert.equal(h.toasts.at(-1).kind, "good");
  assert.equal(h.document.querySelector(".gs-sheet").parentNode.hidden, true);
  assert.equal(h.document.activeElement, h.chip(), "focus goes back to where it came from");
});

test("Save only leaves the push out, an empty message falls back to the default, and a refusal keeps the dialog open", async () => {
  const h = await ready({ state: "uncommitted", replies: { gitSave: { ok: false, error: "Studio could not save: a merge is in progress." } } });
  h.sync.showSave({ push: false });
  await flush();
  assert.equal(h.document.activeElement.id, "git-sync-message", "the same when only Save was asked for: neither button starts focused");
  await h.sheet().querySelectorAll(".gs-dialog-buttons button")[1].click();
  await flush();
  assert.deepEqual(plain(h.fake.last("gitSave")), [{ paths: ["scripts/sync.mjs", "renderer/pc-sync.js", "docs/github-linking.md", "old-notes.txt"], message: "Studio save: 4 files", push: false, projectId: "p1" }]);
  assert.equal(h.sheet().parentNode.hidden, false, "a refusal leaves the dialog and the ticks as they were");
  assert.equal(h.sheet().querySelector(".gs-dialog-note").textContent, "Studio could not save: a merge is in progress.");
  assert.equal(h.sheet().querySelector(".gs-dialog-note").getAttribute("role"), "alert", "the dialog's own note is the alert");
  assert.equal(h.alert(), "", "and the page's alert region does not say it again");
  assert.equal(rowsOf(h).filter((row) => row.box.checked).length, 4);
  assert.equal(h.role(h.sheet(), "primary").disabled, false, "and it can be tried again");
});

test("a save asked for while another GitHub action is out is refused in words, and can be tried again", async () => {
  const h = await ready({ state: "in-sync" });
  await h.open();
  h.fake.hold("gitCheck");
  await h.role(h.pop(), "primary").click();
  await flush();
  assert.equal(h.chip().dataset.state, "checking");
  h.sync.showSave({ push: true });
  await flush();
  await h.role(h.sheet(), "primary").click();
  await flush();
  assert.equal(h.fake.names().includes("gitSave"), false, "nothing was sent behind the check");
  assert.equal(h.sheet().querySelector(".gs-dialog-note").textContent, "Another GitHub action is still running. Try again in a moment.");
  assert.equal(h.sheet().querySelector(".gs-dialog-note").getAttribute("aria-live"), "assertive");
  assert.equal(h.role(h.sheet(), "primary").disabled, false, "the dialog is as it was");
  h.fake.release("gitCheck");
  await flush();
  await h.role(h.sheet(), "primary").click();
  await flush();
  assert.equal(h.fake.names().includes("gitSave"), true, "once the check is done, the save goes");
});

test("agents building need an acknowledgement, a refusal from the host stops the save, and no git name is said in words", async () => {
  const preview = (extra) => ({ replies: { gitSavePreview: { ok: true, branch: "main", message: "Studio save: 1 file", identity: { ok: true }, refusal: null, builders: false, files: [{ path: "a.txt", status: "changed", bytes: 1, include: true }], ...extra } }, state: "uncommitted" });
  const h = await ready(preview({ builders: true }));
  h.sync.showSave({ push: true });
  await flush();
  assert.match(h.sheet().textContent, /Agents are still changing files in this project\. Save now anyway\?/);
  const primary = h.role(h.sheet(), "primary");
  assert.equal(primary.disabled, true, "held until it is acknowledged");
  const ack = h.sheet().querySelector(".gs-ack input");
  ack.checked = true;
  await ack.trigger("change");
  assert.equal(h.role(h.sheet(), "primary").disabled, false);
  await h.role(h.sheet(), "primary").click();
  await flush();
  assert.deepEqual(plain(h.fake.last("gitSave")), [{ paths: ["a.txt"], message: "Studio save: 1 file", push: true, ignoreBuilders: true, projectId: "p1" }]);

  const merge = await ready(preview({ refusal: { kind: "merge", text: "A merge is in progress in this project. Finish it or stop it, then save." } }));
  merge.sync.showSave();
  await flush();
  assert.match(merge.sheet().textContent, /A merge is in progress in this project\. Finish it or stop it, then save\./);
  assert.equal(merge.role(merge.sheet(), "primary").disabled, true);
  await merge.role(merge.sheet(), "primary").click();
  assert.equal(merge.fake.names().includes("gitSave"), false);

  const account = await ready(preview({ identity: { ok: true, name: "nateecho32-stack", email: "nateecho32-stack@users.noreply.github.com", fromAccount: true } }));
  account.sync.showSave();
  await flush();
  assert.match(account.sheet().textContent, /Git does not know who you are on this PC yet\. Studio will save as nateecho32-stack, from your GitHub sign-in\./);
  assert.equal(account.role(account.sheet(), "primary").disabled, false, "the account's name is enough to save");

  const nobody = await ready(preview({ identity: { ok: false, fromAccount: false } }));
  nobody.sync.showSave({ push: false });
  await flush();
  assert.match(nobody.sheet().textContent, /Git does not know who you are on this PC\. Sign in to GitHub, or set your name and email in Git\./);
  assert.equal(nobody.role(nobody.sheet(), "primary").disabled, true, "with nobody to save as, the host would refuse");
  nobody.fake.setAccount(null);
  void nobody.sheet().querySelectorAll("button").find((node) => node.textContent === "Sign in to GitHub").click();
  await flush();
  assert.equal(nobody.all(".gs-sheet").length, 2, "the sign-in opens over the save");
  nobody.fake.setAccount("nateecho32-stack");
  await nobody.advance(2000);
  assert.equal(nobody.all(".gs-sheet").filter((sheet) => !sheet.parentNode.hidden).length, 1, "and the save opens again to look afresh once signed in");
  assert.equal(nobody.fake.names().filter((name) => name === "gitSavePreview").length, 2);
});

// ---- Publish ----------------------------------------------------------------------------------------

const publishForm = (h) => {
  const sheet = h.sheet();
  return {
    sheet,
    primary: () => h.role(sheet, "primary"),
    creates: () => sheet.querySelector(".gs-creates-name").textContent,
    visibility: (value) => sheet.querySelectorAll(".gs-seg-item").find((node) => node.dataset.value === value),
    typed: () => sheet.querySelector(".gs-public input"),
    publicBox: () => sheet.querySelector(".gs-public"),
    note: () => sheet.querySelector(".gs-dialog-note").textContent,
  };
};

test("Publish opens private by default, names owner/name live, and looks at the name before anything is created", async () => {
  const h = await ready({ state: "no-remote" });
  await h.open();
  await h.role(h.pop(), "primary").click();
  await flush();
  const form = publishForm(h);
  assert.equal(form.sheet.querySelector("h2").textContent, "Publish to GitHub");
  assert.deepEqual(h.fake.names().filter((name) => name.startsWith("gitOwners") || name.startsWith("gitPublish")), ["gitOwners", "gitPublishPreview"]);
  assert.deepEqual(plain(h.fake.last("gitPublishPreview")), [{ owner: "nateecho32-stack", name: "Mefi-s-Studio-AI", gitignore: true, license: "none", projectId: "p1" }]);
  assert.equal(form.creates(), "nateecho32-stack/Mefi-s-Studio-AI");
  assert.equal(form.visibility("private").getAttribute("aria-checked"), "true");
  assert.equal(form.visibility("public").getAttribute("aria-checked"), "false");
  assert.equal(form.visibility("private").tabIndex, 0, "one tab stop in the group");
  assert.equal(form.visibility("public").tabIndex, -1);
  assert.equal(form.publicBox().hidden, true);
  assert.equal(form.primary().textContent, "Publish private repository");
  assert.equal(form.primary().disabled, false);
  assert.equal(form.note(), "Private. Only you can see it.");
  assert.match(form.sheet.textContent, /Studio writes this file before the first commit\./);
  assert.match(form.sheet.textContent, /No LICENSE file is added\./);
  assert.deepEqual(form.sheet.querySelectorAll(".gs-group-row").map((row) => row.textContent), ["src/2 files", "assets/1 file", "Top level1 file"]);
  assert.equal(form.sheet.querySelector(".gs-files-title").textContent, "Files that will be included");

  const name = form.sheet.querySelector(".gs-name-box .gs-input:not([readonly])") ?? form.sheet.querySelectorAll("input").find((node) => node.value === "Mefi-s-Studio-AI");
  name.value = "Field Notes";
  await name.trigger("input");
  assert.equal(form.creates(), "nateecho32-stack/Field-Notes", "the name is shown as GitHub will have it, at once");
  assert.match(form.sheet.textContent, /Spaces and symbols become hyphens\./);
  assert.equal(form.primary().disabled, true, "held until the host has looked at that name");
  await h.advance(320);
  assert.deepEqual(plain(h.fake.last("gitPublishPreview")), [{ owner: "nateecho32-stack", name: "Field Notes", gitignore: true, license: "none", projectId: "p1" }]);
  assert.equal(form.primary().disabled, false);
  await form.primary().click();
  await flush();
  const sent = plain(h.fake.last("gitPublish"))[0];
  assert.deepEqual(sent, { owner: "nateecho32-stack", name: "Field-Notes", visibility: "private", description: "", gitignore: true, license: "none", projectId: "p1" });
  assert.equal("confirmPublic" in sent, false, "a private repository carries no public confirmation");
});

test("Public shows what it means and stays off until the exact owner/name is typed back", async () => {
  const h = await ready({ state: "no-remote" });
  const done = h.sync.showPublish();
  await flush();
  const form = publishForm(h);
  await form.visibility("public").click();
  assert.equal(form.visibility("public").getAttribute("aria-checked"), "true");
  assert.equal(form.publicBox().hidden, false);
  assert.match(form.publicBox().textContent, /Public means anyone on GitHub can see this project's files, its history, the README and the LICENSE\./);
  assert.match(form.publicBox().textContent, /Type nateecho32-stack\/Mefi-s-Studio-AI to make it public/);
  assert.equal(form.primary().textContent, "Publish public repository");
  assert.equal(form.primary().disabled, true);
  assert.equal(form.note(), "Type the name to make it public.");
  await form.primary().click();
  assert.equal(h.fake.names().includes("gitPublish"), false, "a press on a held button sends nothing");
  for (const wrong of ["nateecho32-stack", "mefi-s-studio-ai", "nateecho32-stack/Mefi-s-Studio-AI-2", "Mefi-s-Studio-AI", ""]) {
    form.typed().value = wrong;
    await form.typed().trigger("input");
    assert.equal(form.primary().disabled, true, `"${wrong}" is not the name`);
  }
  form.typed().value = "nateecho32-stack/Mefi-s-Studio-AI";
  await form.typed().trigger("input");
  assert.equal(form.primary().disabled, false);
  assert.match(form.publicBox().querySelector(".gs-inline-status").textContent, /Matches\. You can publish now\./);
  assert.equal(form.note(), "Public. Anyone on GitHub can see it.");
  // Going back to private forgets the typed name.
  await form.visibility("private").click();
  await form.visibility("public").click();
  assert.equal(form.primary().disabled, true);
  form.typed().value = "nateecho32-stack/Mefi-s-Studio-AI";
  await form.typed().trigger("input");
  await form.primary().click();
  await flush();
  assert.deepEqual(plain(h.fake.last("gitPublish"))[0], { owner: "nateecho32-stack", name: "Mefi-s-Studio-AI", visibility: "public", description: "", gitignore: true, license: "none", confirmPublic: "nateecho32-stack/Mefi-s-Studio-AI", projectId: "p1" });
  const shown = h.sheet();
  assert.match(shown.textContent, /Published nateecho32-stack\/Mefi-s-Studio-AI\./);
  assert.equal(h.chip().dataset.state, "success");
  const open = shown.querySelectorAll("button").find((node) => node.textContent === "Open on GitHub");
  await open.click();
  assert.deepEqual(plain(h.fake.last("openExternal")), ["https://github.com/nateecho32-stack/Mefi-s-Studio-AI"]);
  await shown.querySelectorAll("button").find((node) => node.textContent === "Done").click();
  assert.deepEqual(plain(await done), { ok: true, repo: "nateecho32-stack/Mefi-s-Studio-AI", url: "https://github.com/nateecho32-stack/Mefi-s-Studio-AI" });
});

test("the arrow keys walk the visibility and licence choices, and the other fields go to the host as typed", async () => {
  const h = await ready({ state: "no-remote" });
  h.sync.showPublish();
  await flush();
  const form = publishForm(h);
  await form.visibility("private").trigger("keydown", { key: "ArrowRight" });
  assert.equal(form.visibility("public").getAttribute("aria-checked"), "true");
  assert.equal(h.document.activeElement, form.visibility("public"));
  await form.visibility("public").trigger("keydown", { key: "ArrowLeft" });
  assert.equal(form.visibility("private").getAttribute("aria-checked"), "true");
  const licenses = form.sheet.querySelectorAll(".gs-seg-row .gs-seg-item");
  assert.deepEqual(licenses.map((node) => node.textContent), ["None", "MIT", "Apache-2.0"]);
  await licenses[0].trigger("keydown", { key: "ArrowRight" });
  assert.equal(licenses[1].getAttribute("aria-checked"), "true");
  assert.match(form.sheet.textContent, /Adds a LICENSE file with your name and this year\./);
  const description = form.sheet.querySelectorAll("input").find((node) => node.placeholder === "What is this project?");
  description.value = "Field notes for the studio";
  await description.trigger("input");
  const ignore = form.sheet.querySelector(".gs-check");
  assert.equal(ignore.getAttribute("aria-checked"), "true");
  await ignore.click();
  assert.equal(ignore.getAttribute("aria-checked"), "false");
  assert.equal(form.primary().disabled, true, "what goes in depends on it, so the host looks again first");
  await h.advance(320);
  assert.deepEqual(plain(h.fake.last("gitPublishPreview")), [{ owner: "nateecho32-stack", name: "Mefi-s-Studio-AI", gitignore: false, license: "mit", projectId: "p1" }]);
  assert.match(form.sheet.textContent, /Nothing is kept out\. Build folders and secrets can be included\./);
  await form.primary().click();
  await flush();
  assert.deepEqual(plain(h.fake.last("gitPublish"))[0], { owner: "nateecho32-stack", name: "Mefi-s-Studio-AI", visibility: "private", description: "Field notes for the studio", gitignore: false, license: "mit", projectId: "p1" });
});

const preview = (over) => ({ ok: true, repo: "nateecho32-stack/Mefi-s-Studio-AI", valid: true, sanitized: "Mefi-s-Studio-AI", taken: false, issue: null, suggestions: [], files: [{ path: "src/a.js", bytes: 10 }], total: 1, truncated: false, warn: [], blocked: [], oneDrive: false, weakDrive: false, renameBranch: false, needsSignIn: false, needsFirstCommit: true, publishIssue: null, ...over });

test("a taken name, a stopped secret and a name GitHub will not take each hold Publish back and say why", async () => {
  const h = await ready({ state: "no-remote", taken: ["nateecho32-stack/Mefi-s-Studio-AI"] });
  h.sync.showPublish();
  await flush();
  let form = publishForm(h);
  assert.equal(form.primary().disabled, true);
  assert.equal(form.note(), "That name is taken.");
  assert.match(form.sheet.textContent, /nateecho32-stack\/Mefi-s-Studio-AI already exists\. Link to it, or pick another name\./);
  const others = form.sheet.querySelectorAll("button").filter((node) => /^Use /.test(node.textContent));
  assert.deepEqual(others.map((node) => node.textContent), ["Use Mefi-s-Studio-AI-2", "Use Mefi-s-Studio-AI-3"], "the host's own suggestions");
  await others[1].click();
  await h.advance(320);
  assert.equal(form.creates(), "nateecho32-stack/Mefi-s-Studio-AI-3");
  assert.equal(form.primary().disabled, false, "a free name goes");

  const secret = await ready({ state: "no-remote", replies: { gitPublishPreview: preview({ warn: [{ path: "assets/intro-reel.mp4", kind: "large", label: "62 MB", text: "assets/intro-reel.mp4 is 62 MB. GitHub warns about files over 50 MB.", mb: 62 }], blocked: [{ path: "config/keys.txt", kind: "secret", rule: "*.txt", label: "a private key file", text: "Stopped: a private key file in config/keys.txt." }] }) } });
  secret.sync.showPublish();
  await flush();
  form = publishForm(secret);
  assert.equal(form.primary().disabled, true, "a secret in the project stops it");
  assert.match(form.sheet.textContent, /Stopped: a private key file in config\/keys\.txt\./);
  assert.match(form.sheet.textContent, /assets\/intro-reel\.mp4 is 62 MB\. GitHub warns about files over 50 MB\./);
  assert.equal(form.note(), "Stopped: config/keys.txt cannot go to GitHub. Move it out of the project, then look again.");
  const before = secret.fake.names().filter((name) => name === "gitPublishPreview").length;
  await form.sheet.querySelectorAll("button").find((node) => node.textContent === "Look again").click();
  await flush();
  assert.equal(secret.fake.names().filter((name) => name === "gitPublishPreview").length, before + 1, "Look again asks the host again");

  const bad = await ready({ state: "no-remote", replies: { gitPublishPreview: preview({ repo: "", valid: false, sanitized: "", issue: "Give the project a GitHub name.", files: [], total: 0 }) } });
  bad.sync.showPublish();
  await flush();
  form = publishForm(bad);
  assert.equal(form.primary().disabled, true);
  assert.equal(form.note(), "Give the project a GitHub name.");

  const unsure = await ready({ state: "no-remote", replies: { gitPublishPreview: preview({ taken: null }) } });
  unsure.sync.showPublish();
  await flush();
  form = publishForm(unsure);
  assert.match(form.sheet.textContent, /Studio could not check whether that name is free\. It finds out when it publishes\./);
  assert.equal(form.primary().disabled, false, "a name GitHub could not be asked about is not held back");
});

test("a stop the host names (a drive that cannot keep Git, a project inside another) holds Publish and says it in the host's words", async () => {
  const words = "This drive cannot keep a Git project reliably. Move the project to an NTFS drive first.";
  const h = await ready({ state: "no-remote", replies: { gitPublishPreview: preview({ weakDrive: true, publishIssue: { kind: "weak-drive", text: words } }) } });
  h.sync.showPublish();
  await flush();
  const form = publishForm(h);
  assert.equal(form.primary().disabled, true);
  assert.equal(form.note(), words);
  assert.equal(form.sheet.textContent.split(words).length - 1, 2, "in the strip and the footer, not a third time");
});

test("a project with more files than the host lists says how many it shows", async () => {
  const h = await ready({ state: "no-remote", replies: { gitPublishPreview: preview({ files: [{ path: "a/x.js", bytes: 1 }, { path: "b.js", bytes: 1 }], total: 9 }) } });
  h.sync.showPublish();
  await flush();
  assert.equal(h.sheet().querySelector(".gs-section-head .gs-muted").textContent, "9 files");
  assert.match(h.sheet().querySelector(".gs-groups").textContent, /Showing 2 of 9 files\./);
});

test("the OneDrive note shows once and stays dismissed; a failed publish says where it stopped and offers the way on", async () => {
  const replies = { gitPublishPreview: preview({ oneDrive: true, renameBranch: true }) };
  const h = await ready({ state: "no-remote", replies });
  h.sync.showPublish();
  await flush();
  assert.match(h.sheet().textContent, /This folder syncs with OneDrive\. Git works, but OneDrive can lock or duplicate \.git files\./);
  assert.match(h.sheet().textContent, /Studio renames this project's first branch to main before it uploads\./);
  const dismiss = h.sheet().querySelectorAll("button").find((node) => node.getAttribute("aria-label") === "Dismiss");
  await dismiss.click();
  assert.doesNotMatch(h.sheet().textContent, /OneDrive/);
  assert.equal(h.stored.get("mefiStudio.git.oneDriveNote"), "1");
  const again = await ready({ state: "no-remote", replies, storage: { "mefiStudio.git.oneDriveNote": "1" } });
  again.sync.showPublish();
  await flush();
  assert.doesNotMatch(again.sheet().textContent, /OneDrive/, "not again once it was dismissed");

  const failing = await ready({ state: "no-remote", replies: { gitPublish: { ok: false, kind: "exists", error: "nateecho32-stack/Mefi-s-Studio-AI already exists.", steps: [{ id: "commit", label: "Saving a first commit", ok: true }, { id: "create", label: "Creating nateecho32-stack/Mefi-s-Studio-AI", ok: false }] } } });
  failing.sync.showPublish();
  await flush();
  failing.fake.hold("gitPublish");
  await failing.role(failing.sheet(), "primary").click();
  await flush();
  assert.equal(failing.chip().dataset.state, "publishing");
  assert.match(failing.sheet().textContent, /Publishing…/);
  assert.deepEqual(failing.all(".gs-stage", failing.sheet()).map((row) => row.dataset.state), ["step", "step", "step"], "no progress is invented while the host works");
  failing.fake.release("gitPublish");
  await flush();
  assert.match(failing.sheet().textContent, /nateecho32-stack\/Mefi-s-Studio-AI already exists\. Link to it, or pick another name\./);
  assert.deepEqual(failing.all(".gs-stage", failing.sheet()).map((row) => row.dataset.state), ["done", "failed"]);
  assert.deepEqual(failing.sheet().querySelectorAll(".gs-dialog-buttons button").map((node) => node.textContent), ["Close", "Link to it", "Use Mefi-s-Studio-AI-2"]);
  assert.equal(failing.sheet().getAttribute("aria-busy"), "false");
});

test("signed out, Publish waits for the sign-in dialog and carries on once the account is there", async () => {
  const h = await ready({ state: "no-remote", account: null });
  const done = h.sync.showPublish();
  await flush();
  assert.match(h.sheet().textContent, /Sign in to GitHub first\./);
  // The button waits for the sign-in dialog to end, so the press is not awaited.
  void h.sheet().querySelectorAll(".gs-dialog-buttons button").find((node) => node.textContent === "Sign in to GitHub").click();
  await flush();
  assert.equal(h.all(".gs-sheet").length, 2, "the sign-in dialog opens over it");
  assert.equal(h.all(".gs-overlay")[0].inert, true, "and the one underneath is out of reach");
  h.fake.setAccount("nateecho32-stack");
  await h.advance(2000);
  assert.equal(h.all(".gs-sheet").filter((sheet) => !sheet.parentNode.hidden).length, 1);
  assert.equal(h.all(".gs-overlay")[0].inert, false);
  assert.equal(h.all(".gs-creates-name").length, 1, "the publish form is there once signed in");
  assert.equal(h.fake.names().includes("gitPublishPreview"), true);
  await h.sheet().trigger("keydown", { key: "Escape" });
  assert.deepEqual(plain(await done), { canceled: true });
});

// ---- Sign in -----------------------------------------------------------------------------------------

test("the sign-in dialog opens the setup window once, looks for the account every two seconds and stops when it closes", async () => {
  const h = await ready({ state: "signed-out", account: null });
  await h.open();
  await h.role(h.pop(), "primary").click();
  await flush();
  const sheet = h.sheet();
  assert.equal(sheet.querySelector("h2").textContent, "Sign in to GitHub");
  assert.match(sheet.textContent, /Finish in the setup window, then choose Check again\./);
  assert.match(sheet.textContent, /Waiting for GitHub… Studio also checks by itself\./);
  assert.match(sheet.textContent, /Studio never sees your password or token\./);
  assert.deepEqual(h.fake.names().filter((name) => name === "pcSetupAction"), ["pcSetupAction"]);
  assert.deepEqual(plain(h.fake.last("pcSetupAction")), ["github-login"]);
  assert.equal(h.timers.filter((timer) => timer.every === 2000).length, 1, "polling started");
  const looks = () => h.fake.names().filter((name) => name === "githubAccount").length;
  const first = looks();
  await h.advance(2000);
  assert.equal(looks(), first + 1);
  await h.advance(4000);
  assert.equal(looks(), first + 3, "every two seconds");
  assert.equal(h.fake.names().filter((name) => name === "pcSetupAction").length, 1, "the setup window is not opened again");
  await sheet.querySelectorAll(".gs-dialog-buttons button").find((node) => node.textContent === "Cancel").click();
  assert.equal(h.timers.filter((timer) => timer.every === 2000).length, 0, "closing stops the polling");
  const after = looks();
  await h.advance(10000);
  assert.equal(looks(), after, "no more looks once it is closed");
  assert.equal(h.document.activeElement, h.chip(), "focus goes back to the chip");
});

test("Check again looks at once, and the dialog closes with the account name when GitHub knows it", async () => {
  const h = await ready({ state: "signed-out", account: null });
  const done = h.sync.showSignIn();
  await flush();
  const before = h.fake.names().filter((name) => name === "githubAccount").length;
  const states = h.fake.names().filter((name) => name === "gitState").length;
  const again = h.sheet().querySelectorAll(".gs-dialog-buttons button").find((node) => node.textContent === "Check again");
  await again.click();
  await flush();
  assert.equal(h.fake.names().filter((name) => name === "githubAccount").length, before + 1);
  h.fake.setAccount("nateecho32-stack");
  await again.click();
  await flush();
  assert.deepEqual(plain(await done), { ok: true, account: "nateecho32-stack" });
  assert.equal(h.toasts.at(-1).text, "Signed in as nateecho32-stack.");
  assert.equal(h.timers.filter((timer) => timer.every === 2000).length, 0);
  assert.equal(h.status(), "Signed in as nateecho32-stack.");
  assert.equal(h.fake.names().filter((name) => name === "gitState").length, states + 1, "the chip looks again");
});

test("a setup window that would not open is asked for again only on the button, not every two seconds", async () => {
  const h = await ready({ state: "signed-out", account: null, replies: { pcSetupAction: { ok: false, error: "That setup window is already open. Finish or close it first." } } });
  const done = h.sync.showSignIn();
  await flush();
  assert.match(h.sheet().textContent, /That setup window is already open\. Finish or close it first\./);
  await h.advance(6000);
  assert.equal(h.fake.names().filter((name) => name === "pcSetupAction").length, 1, "the poll only looks for the account");
  await h.sheet().querySelectorAll(".gs-dialog-buttons button").find((node) => node.textContent === "Try again").click();
  await flush();
  assert.equal(h.fake.names().filter((name) => name === "pcSetupAction").length, 2);
  await h.sheet().trigger("keydown", { key: "Escape" });
  assert.deepEqual(plain(await done), { canceled: true });
});

test("a signed-in account skips the setup window, and a missing GitHub CLI offers to install it", async () => {
  const signed = await ready({ state: "signed-out", account: "nateecho32-stack" });
  const quick = signed.sync.showSignIn();
  await flush();
  assert.deepEqual(plain(await quick), { ok: true, account: "nateecho32-stack" });
  assert.equal(signed.fake.names().includes("pcSetupAction"), false);

  const missing = await ready({ state: "signed-out", account: null, ghInstalled: false });
  const dialog = missing.sync.showSignIn();
  await flush();
  assert.match(missing.sheet().textContent, /GitHub CLI is not installed on this PC\./);
  assert.equal(missing.fake.names().includes("pcSetupAction"), false, "no sign-in window until there is a CLI to sign in with");
  await missing.sheet().querySelectorAll(".gs-dialog-buttons button").find((node) => node.textContent === "Install it").click();
  await flush();
  assert.deepEqual(plain(missing.fake.last("pcSetupAction")), ["install-gh"]);
  await missing.sheet().trigger("keydown", { key: "Escape" });
  assert.deepEqual(plain(await dialog), { canceled: true });
  assert.equal(missing.timers.filter((timer) => timer.every === 2000).length, 0);
});

// ---- Link to a repository ---------------------------------------------------------------------------------

test("Link lists the account's repositories, needs one chosen, and links only what the host listed", async () => {
  const h = await ready({ state: "no-remote" });
  await h.open();
  await h.role(h.pop(), "secondary").click();
  await flush();
  const sheet = h.sheet();
  assert.equal(sheet.querySelector("h2").textContent, "Link to a repository");
  const repos = sheet.querySelectorAll(".gs-repo");
  assert.deepEqual(repos.map((row) => row.dataset.repo), ["nateecho32-stack/mefi-studio", "nateecho32-stack/field-notes", "void-engine/void-engine-bot"]);
  assert.equal(repos[0].querySelector(".gs-tag").textContent, "Public");
  assert.equal(repos[1].querySelector(".gs-tag").textContent, "Private");
  assert.equal(sheet.querySelector('[role="radiogroup"]').getAttribute("aria-label"), "Your repositories");
  const link = h.role(sheet, "primary");
  assert.equal(link.textContent, "Link this project");
  assert.equal(link.disabled, true);
  await link.click();
  assert.equal(h.fake.names().includes("gitLink"), false);
  await repos[1].click();
  assert.equal(sheet.querySelectorAll(".gs-repo").filter((row) => row.getAttribute("aria-checked") === "true").map((row) => row.dataset.repo).join(), "nateecho32-stack/field-notes");
  assert.equal(h.role(sheet, "primary").disabled, false);
  await h.role(sheet, "primary").click();
  await flush();
  assert.deepEqual(plain(h.fake.last("gitLink")), ["nateecho32-stack/field-notes", { projectId: "p1" }], "the link names the repository the host listed and the project the dialog was opened for");
  assert.equal(h.toasts.at(-1).text, "Linked to nateecho32-stack/field-notes.");
  assert.equal(h.chip().dataset.state, "in-sync");
  assert.equal(h.sheet().parentNode.hidden, true);
});

test("a refused link keeps the dialog open with the host's reason in plain words", async () => {
  const h = await ready({ state: "no-remote", replies: { gitLink: { ok: false, kind: "unrelated", error: "unrelated histories" } } });
  h.sync.showLink();
  await flush();
  await h.all(".gs-repo")[0].click();
  await h.role(h.sheet(), "primary").click();
  await flush();
  assert.equal(h.sheet().parentNode.hidden, false);
  assert.equal(h.sheet().querySelector(".gs-dialog-note").textContent, "That repository has a different history from this project, so Studio did not link them.");
  assert.equal(h.sheet().querySelector(".gs-dialog-note").getAttribute("role"), "alert");
  assert.equal(h.chip().dataset.state, "no-remote", "nothing changed");
  const empty = await ready({ state: "no-remote", replies: { gitLinkRepos: { ok: true, repos: [] } } });
  empty.sync.showLink();
  await flush();
  assert.match(empty.sheet().textContent, /Your GitHub account has no repositories yet\. Publish this project instead\./);
});

// ---- dialogs in general --------------------------------------------------------------------------------------

test("a dialog keeps Tab inside, keeps the page's letter shortcuts out, and a project switch cancels it", async () => {
  const h = await ready({ state: "uncommitted" });
  const done = h.sync.showSave();
  await flush();
  const sheet = h.sheet();
  const buttons = sheet.querySelectorAll(".gs-dialog-buttons button");
  buttons.at(-1).focus();
  let prevented = 0;
  await sheet.trigger("keydown", { key: "Tab", preventDefault() { prevented += 1; } });
  assert.equal(prevented, 1);
  assert.notEqual(h.document.activeElement, buttons.at(-1), "Tab from the last control wraps to the first");
  let stopped = 0;
  await sheet.trigger("keydown", { key: "t", stopPropagation() { stopped += 1; } });
  assert.equal(stopped, 1, "a letter never reaches the shortcuts behind the dialog");
  let defaulted = 0;
  for (const key of ["Enter", " ", "ArrowDown", "Home"]) await sheet.trigger("keydown", { key, stopPropagation() { stopped += 1; }, preventDefault() { defaulted += 1; } });
  assert.equal(stopped, 5, "nor do Enter, Space and the arrows: Command would read them as its selected node's");
  assert.equal(defaulted, 0, "and a button still answers them: only their travel stops");
  await sheet.trigger("keydown", { key: "k", ctrlKey: true, stopPropagation() { stopped += 1; } });
  assert.equal(stopped, 5, "a chord (Ctrl+K) still reaches the palette");
  const again = h.sync.showSave();
  assert.equal(h.all(".gs-sheet").length, 1, "asking again for an open dialog opens no second one");
  h.fire("mefi:project-changed");
  assert.deepEqual(plain(await done), { canceled: true, silent: true });
  assert.deepEqual(plain(await again), { canceled: true, silent: true }, "and answers with the same ending");
  assert.equal(h.sheet().parentNode.hidden, true);
});

test("the popover closes before a dialog opens from it, so the chip is not left expanded", async () => {
  const h = await ready({ state: "no-remote" });
  await h.open();
  await h.role(h.pop(), "primary").click();
  await flush();
  assert.equal(h.pop().hidden, true);
  assert.equal(h.chip().getAttribute("aria-expanded"), "false");
  await h.sheet().trigger("keydown", { key: "Escape" });
  assert.equal(h.document.activeElement, h.chip(), "and Cancel puts the focus back on the chip");
});

test("the browser preview keeps every entry point quiet: no bridge, no dialog work, no throw", async () => {
  const h = await ready({ bridge: false });
  for (const open of [() => h.sync.showSave(), () => h.sync.showLink(), () => h.sync.showPublish(), () => h.sync.showSignIn()]) {
    const done = open();
    await flush();
    assert.ok(h.sheet(), "the dialog opens and says where it works");
    await h.sheet().trigger("keydown", { key: "Escape" });
    assert.deepEqual(plain(await done), { canceled: true });
  }
  assert.equal(h.chip().parentNode.hidden, true);
});

// ---- keyboard, names and touch (the accessibility review) ----------------------------------------------

test("the chip's name says what it is and holds its visible label; a change is read out with whose it is", async () => {
  const h = await ready({ state: "ahead" });
  assert.equal(h.chip().getAttribute("aria-label"), "GitHub sync: 2 to push");
  assert.equal(h.chip().title, h.chip().getAttribute("aria-label"), "the tooltip and the name agree, so a reader hears it once");
  h.fake.push(kit.sampleModel("behind"));
  assert.equal(h.status(), "GitHub sync: 3 to pull");
});

test("Tab leaves the popover by way of its chip: Shift+Tab from the top goes back to it, Tab from the bottom carries on from it", async () => {
  const h = await ready({ state: "ahead" });
  let pop = await h.open();
  let prevented = 0;
  await pop.trigger("keydown", { key: "Tab", shiftKey: true, preventDefault() { prevented += 1; } });
  assert.equal(h.pop().hidden, true, "Shift+Tab from the popover's own top closes it");
  assert.equal(h.document.activeElement, h.chip(), "and puts the focus on the chip, not somewhere far behind it");
  assert.equal(prevented, 1, "the browser is not left to move it on from there");

  pop = await h.open();
  const items = pop.querySelectorAll("button, a[href]");
  items[0].focus();
  await pop.trigger("keydown", { key: "Tab", shiftKey: true, preventDefault() { prevented += 1; } });
  assert.equal(h.pop().hidden, true, "and from the first control");
  assert.equal(h.document.activeElement, h.chip());

  pop = await h.open();
  const controls = pop.querySelectorAll("button, a[href]");
  controls[1].focus();
  prevented = 0;
  await pop.trigger("keydown", { key: "Tab", preventDefault() { prevented += 1; } });
  assert.equal(h.pop().hidden, false, "a Tab between two controls is the browser's");
  assert.equal(prevented, 0);
  controls.at(-1).focus();
  await pop.trigger("keydown", { key: "Tab", preventDefault() { prevented += 1; } });
  assert.equal(h.pop().hidden, true, "Tab from the last control closes it");
  assert.equal(h.document.activeElement, h.chip(), "with the focus on the chip, so the next Tab is the one after the chip");
  assert.equal(prevented, 0, "and it is the browser that takes that step");
});

test("a file's checkbox is named by its row and described by why it is held or flagged; Leave it out says which file", async () => {
  const h = await ready({ state: "uncommitted" });
  h.sync.showSave({ push: true });
  await flush();
  const rows = h.all(".gs-file-item", h.sheet());
  const boxes = rows.map((row) => row.querySelector("input"));
  assert.ok(boxes.every((box) => box.getAttribute("aria-label") === null), "no aria-label: it would replace the row's words with the bare path");
  assert.equal(rows[0].querySelector(".gs-file").textContent, "Changedscripts/sync.mjs", "what happened and the path name the box");
  assert.equal(rows[4].querySelector(".gs-file").textContent, "Newinstaller.exe62 MB", "and so does the size");
  assert.equal(boxes[0].getAttribute("aria-describedby"), null, "an ordinary row has nothing more to say");
  for (const [at, path] of [[4, "installer.exe"], [5, "config/keys.txt"]]) {
    const words = rows[at].querySelector(".gs-strip-text");
    assert.ok(words.id, `${path}: the reason has an id`);
    assert.equal(boxes[at].getAttribute("aria-describedby"), words.id, `${path}: the box is described by its reason`);
  }
  assert.equal(boxes[5].disabled, true);
  const leave = rows[4].querySelectorAll("button").find((node) => node.textContent === "Leave it out");
  assert.equal(leave.getAttribute("aria-label"), "Leave it out: installer.exe");
});

test("with nothing ticked the held buttons say why, and the note clears when something is ticked again", async () => {
  const h = await ready({ state: "uncommitted" });
  h.sync.showSave({ push: true });
  await flush();
  const rows = rowsOf(h);
  const note = () => h.sheet().querySelector(".gs-dialog-note");
  assert.equal(note().textContent, "");
  for (const row of rows.slice(0, 5)) await tick(row, false);
  assert.equal(note().textContent, "Tick at least one file to save.");
  assert.equal(note().getAttribute("aria-live"), "polite", "a hint is a status, not an alert");
  await tick(rows[0], true);
  assert.equal(note().textContent, "");
});

test("a failure in a dialog is read out once, by the dialog's own note; nothing else says it again", async () => {
  const h = await ready({ state: "uncommitted", replies: { gitSave: { ok: false, error: "Studio could not save: a merge is in progress." } } });
  h.sync.showSave({ push: true });
  await flush();
  const note = h.sheet().querySelector(".gs-dialog-note");
  assert.equal(note.getAttribute("role"), "status", "routine: polite");
  await h.role(h.sheet(), "primary").click();
  await flush();
  assert.equal(note.getAttribute("role"), "alert");
  assert.equal(note.getAttribute("aria-live"), "assertive");
  assert.equal(note.textContent, "Studio could not save: a merge is in progress.");
  assert.equal(h.alert(), "", "the page's alert region does not repeat it (it sits outside the modal)");

  const failing = await ready({ state: "no-remote", replies: { gitPublish: { ok: false, kind: "exists", error: "nateecho32-stack/Mefi-s-Studio-AI already exists.", steps: [] } } });
  failing.sync.showPublish();
  await flush();
  await failing.role(failing.sheet(), "primary").click();
  await flush();
  assert.equal(failing.sheet().querySelector(".gs-done").getAttribute("role"), "alert", "a failed publish is an alert where it is drawn");
  assert.equal(failing.alert(), "", "and only there");

  const noPreview = await ready({ state: "uncommitted", replies: { gitSavePreview: { ok: false, error: "Studio could not look at your changes." } } });
  noPreview.sync.showSave();
  await flush();
  assert.equal(noPreview.sheet().querySelector(".gs-strip").getAttribute("role"), "alert", "a dialog that opens on a failure says so");
  const noRepos = await ready({ state: "no-remote", replies: { gitLinkRepos: { ok: false, error: "Sign in to GitHub first." } } });
  noRepos.sync.showLink();
  await flush();
  assert.equal(noRepos.sheet().querySelector(".gs-strip").getAttribute("role"), "alert");
});

test("a publish that starts keeps the focus in the dialog, and a sign-in whose buttons are swapped does too", async () => {
  const h = await ready({ state: "no-remote" });
  h.sync.showPublish();
  await flush();
  const form = publishForm(h);
  form.primary().focus();
  h.fake.hold("gitPublish");
  await form.primary().click();
  await flush();
  assert.equal(h.document.activeElement, form.sheet, "the button that was pressed is gone: the dialog holds the focus, not the page behind it");
  h.fake.release("gitPublish");
  await flush();
  assert.match(form.sheet.textContent, /Published nateecho32-stack\/Mefi-s-Studio-AI\./);
  assert.equal(h.document.activeElement.textContent, "Open on GitHub", "and a finished one puts it on what comes next");

  const s = await ready({ state: "signed-out", account: null, replies: { pcSetupAction: { ok: false, error: "That setup window is already open. Finish or close it first." } } });
  s.sync.showSignIn();
  await flush();
  const retry = s.sheet().querySelectorAll(".gs-dialog-buttons button").find((node) => node.textContent === "Try again");
  retry.focus();
  s.fake.setAccount(null);
  s.fake.hold("pcSetupAction");
  await retry.click();
  await flush();
  s.fake.release("pcSetupAction", { ok: true, message: "Finish in the setup window, then choose Check again." });
  await flush();
  assert.equal(s.document.activeElement.textContent, "Check again", "the swapped button hands its focus to the new primary");
});

test("a primary the host holds stays reachable, says why, and does nothing when pressed", async () => {
  const held = { ...kit.sampleModel("ahead"), primary: { id: "push", label: "Push 2 commits", confirm: true, disabled: true, why: "Nothing on this branch is waiting to be pushed." } };
  const h = await ready({ state: "ahead", over: held });
  const pop = await h.open();
  const primary = h.role(pop, "primary");
  assert.equal(primary.disabled, false, "still in the tab order");
  assert.equal(primary.getAttribute("aria-disabled"), "true");
  assert.match(primary.className, /gs-held/);
  assert.equal(pop.querySelector("#git-sync-why").textContent, "Nothing on this branch is waiting to be pushed.");
  assert.equal(primary.getAttribute("aria-describedby"), "git-sync-why", "the reason is read with the button");
  await primary.click();
  await primary.click();
  await flush();
  assert.equal(h.fake.names().includes("gitPush"), false, "a held button sends nothing, however often it is pressed");
  assert.doesNotMatch(h.role(h.pop(), "primary").className, /gs-armed/, "and does not arm");
  assert.equal(h.role(h.pop(), "primary").getAttribute("aria-pressed"), null);
});

test("the repository list keeps one tab stop when a filter hides the chosen repository", async () => {
  const repos = Array.from({ length: 10 }, (_, i) => ({ repo: `me/repo-${i}`, private: i % 2 === 0, description: "", updatedAt: "" }));
  const h = await ready({ state: "no-remote", replies: { gitLinkRepos: { ok: true, repos } } });
  h.sync.showLink();
  await flush();
  const sheet = h.sheet();
  const stops = () => h.all(".gs-repo", sheet).filter((node) => node.tabIndex === 0).map((node) => node.dataset.repo);
  assert.deepEqual(stops(), ["me/repo-0"], "nothing chosen: the first is the way in");
  await h.all(".gs-repo", sheet)[3].click();
  assert.deepEqual(stops(), ["me/repo-3"], "chosen: that one");
  const finder = sheet.querySelectorAll("input").find((node) => node.placeholder === "Find a repository");
  finder.value = "repo-7";
  await finder.trigger("input");
  assert.deepEqual(stops(), ["me/repo-7"], "the chosen one is filtered out: the group still has a way in");
  finder.value = "nothing-like-that";
  await finder.trigger("input");
  assert.deepEqual(stops(), [], "no matches: no radios, and nothing to tab to");
});

test("the renderer never calls an Array method on a live DOM list (a NodeList has no filter, find or at, and the fake DOM's lists are arrays)", () => {
  // The vm's fake DOM hands back arrays, so a .find() on querySelectorAll passes here and throws in a browser.
  const bare = /querySelectorAll\([^)]*\)\s*\.(?:filter|find|map|some|every|reduce|at|slice|indexOf|flatMap|findLast)\(/;
  assert.doesNotMatch(source, bare, "wrap the list in Array.from first");
  assert.doesNotMatch(source, /\.children\s*\.(?:at|filter|find|map|some|every|slice|indexOf)\(/, "and so does .children");
  assert.match(source, /Array\.from\(root\.querySelectorAll\(FOCUSABLE\)\)\.filter/, "the focus trap's list is copied");
});

test("the stylesheet keeps the touch sizes and the light palette's contrast fixes, and nothing of the section bar", () => {
  const coarse = styles.slice(styles.lastIndexOf("@media (pointer: coarse)"));
  assert.match(coarse, /\.gs-slot \.gs-chip:not\(\.gs-chip-static\) \{ min-width: 44px; min-height: 44px; \}/, "the chip is 44px each way, glyph-only too");
  assert.match(coarse, /:is\(\.gs-pop, \.gs-sheet\) :is\(button, a\.gs-link, \.gs-input, \.gs-ack\) \{ min-height: 44px; \}/, "the popover's and the dialogs' controls");
  assert.match(coarse, /:is\(\.gs-pop, \.gs-sheet\) button\.gs-icon \{ min-width: 44px; \}/, "and the close buttons");
  assert.ok(styles.lastIndexOf("@media (pointer: coarse)") > styles.indexOf(".gs-dialog-head button.gs-icon"), "after the rules it must outrank");
  assert.doesNotMatch(styles, /data-variant="bar"|#app-local-nav|\.app-task-context/, "the section bar, its chip and its task shortcuts are gone, and their rules with them");
  assert.match(styles, /:root\[data-studio-theme-tone="light"\] button\.gs-seg-item\[aria-checked="true"\] \{ color: var\(--ivory\); \}/, "gold-bright on the selected tint is 3.8:1 on a light palette");
  assert.match(styles, /button\.gs-held \{ opacity: \.4; cursor: not-allowed; \}/);
  assert.match(styles, /\.gs-sheet\.sheet \{[^}]*width: min\(var\(--gs-w, 480px\), calc\(100vw - var\(--shell-x0, 0px\) - var\(--shell-x1, 0px\) - 32px\)\)/, "the overlay is moved over by the rail (and, in layout v2, the regions: --shell-x0 and --shell-x1 are the free area's edges): at 600px a sheet 568 wide ran 32px off the right edge");
  assert.match(styles, /\.gs-pop:focus-visible \{ outline: none;/, "the popover root takes the focus by script: no ring around the whole popover");
  assert.match(styles, /\.gs-repos \{[^}]*margin: -4px; padding: 4px; overflow: auto;/, "the scrolling list leaves room for the focused repository's ring");
  assert.match(styles, /\.gs-chip-badge \{[^}]*background: var\(--gold\);[^}]*color: var\(--ink\);/, "--ink is picked against --gold");
});

// ---- the host's own vocabulary (scripts/git-link.cjs) ---------------------------------------------

const hostTable = require("../scripts/git-link.cjs");

test("every state and glyph name the host's table uses has a drawing, and every action id has a door or is named as having none", async () => {
  const h = await ready({ state: "in-sync", vibe: true });
  assert.deepEqual([...hostTable.STATE_IDS].sort(), [...kit.STATE_IDS].sort(), "the renderer's sample vocabulary is the host's");
  for (const id of hostTable.STATE_IDS) {
    const row = hostTable.STATES[id];
    h.fake.push({ ...kit.sampleModel(id), tone: row.tone, glyph: row.glyph });
    assert.equal(h.chip().querySelector("svg").dataset.glyph, row.glyph, `${id}: the host's glyph name "${row.glyph}" is drawn, not replaced`);
    assert.equal(h.chip().dataset.tone, row.tone);
  }
  // No door: an id here is left undrawn rather than drawn dead. A new host id fails this until it is decided.
  const NO_DOOR = new Set(["open-folder", "remove", "add-permission", "start-branch", "pick-owner", "rename"]);
  for (const id of hostTable.ACTION_IDS) {
    const details = ["a", "b", "c", "d"];
    for (const slot of ["primary", "secondary"]) {
      h.fake.push({ ...kit.sampleModel("in-sync"), details, primary: null, secondary: null, [slot]: { id, label: "Do it", confirm: false } });
      const drawn = Boolean(h.role(h.pop() ?? (h.chip().click(), h.pop()), slot));
      assert.equal(drawn, !NO_DOOR.has(id), `${slot} "${id}" ${NO_DOOR.has(id) ? "has no door yet" : "has a door"}`);
    }
  }
});

test("the host's own describe() output draws end to end: chip, popover, and the primary's arming follows its confirm flag", async () => {
  const facts = { glance: { isRepo: true, unborn: false, branch: "main", detached: false, dirty: 0, ahead: 2, behind: 0, upstream: "origin/main", remote: "nateecho32-stack/mefi-studio", main: "main", onDefault: true, available: true }, account: "nateecho32-stack", checkedAt: Date.now() - 4 * 60 * 1000 };
  const model = hostTable.describe(facts);
  assert.equal(model.id, "ahead");
  const h = await ready({ state: "ahead", over: model });
  assert.equal(h.chip().querySelector(".gs-chip-label").textContent, "2 to push");
  const pop = await h.open();
  assert.equal(h.role(pop, "primary").textContent, "Push 2 commits");
  assert.deepEqual(pop.querySelectorAll(".gs-facts dd").map((node) => node.textContent), ["2 commits on main", "nateecho32-stack/mefi-studio"]);
  assert.equal(pop.querySelectorAll(".gs-lines li").length, 0, "the host's own detail line repeats the numbers, so it is not listed");
  await h.role(pop, "primary").click();
  assert.equal(h.fake.names().includes("gitPush"), false, "the host marks push as one to confirm");
  await h.role(h.pop(), "primary").click();
  assert.deepEqual(plain(h.fake.last("gitPush")), [{ projectId: "p1" }], "describe() carries no project of its own, so the push names the project the window has open");

  const dirty = hostTable.describe({ ...facts, glance: { ...facts.glance, dirty: 3 } });
  assert.equal(dirty.primary.id, "save-and-push");
  assert.equal(dirty.secondary.id, "push");
  assert.equal(dirty.secondary.confirm, true, "pushing without saving is the one to confirm");
  const two = await ready({ state: "ahead", over: dirty });
  await two.open();
  assert.equal(two.role(two.pop(), "primary").textContent, "Save and push 3 files");
  await two.role(two.pop(), "primary").click();
  await flush();
  assert.equal(two.sheet().querySelector("h2").textContent, "Save and push", "the dialog, not a commit, is what the primary does");
});

// ---- every action is bound to the project it was drawn for ----------------------------------------------------------
// The host adds the open project's id to every model it sends (`projectId`); the popover's
// actions send that id, and each dialog captures one when it opens and sends that one, so a
// switch of project between the look and the press reaches the host as a refusal, never as
// an action on the new project (tests/git_host.test.mjs). With no id known nothing is sent.

const openProject = (id) => ({ projects: [{ id, name: `Project ${id}` }], activeId: id });

test("the popover's actions name the project the model was drawn for, even when the window has read another", async () => {
  // The fake bridge's projectsList says p1 is open; the model says m1. The model is what was drawn.
  const cases = [
    { state: "ahead", presses: 2, call: "gitPush", args: { projectId: "m1" } },
    { state: "behind", presses: 1, call: "gitPull", args: { projectId: "m1" } },
    { state: "agents-working", presses: 1, call: "gitPull", args: { anyway: true, projectId: "m1" } },
    { state: "diverged", presses: 2, call: "gitRebase", args: { projectId: "m1" } },
  ];
  for (const { state, presses, call, args } of cases) {
    const h = await ready({ state, over: { projectId: "m1" } });
    assert.ok(h.fake.names().includes("projectsList"), "the window has read its own project too");
    await h.open();
    for (let press = 0; press < presses; press += 1) await h.role(h.pop(), "primary").click();
    await flush();
    assert.deepEqual(plain(h.fake.last(call)), [args], `${state}: ${call} names m1, the project the chip was drawn for, and not the p1 the window read`);
  }
  const checking = await ready({ state: "ahead", over: { projectId: "m1" } });
  await checking.open();
  await checking.role(checking.pop(), "check-now").click();
  assert.deepEqual(plain(checking.fake.last("gitCheck")), [{ projectId: "m1" }], "Check now names it too");
});

test("a model with no id of its own falls back to the project the window read", async () => {
  const cases = [
    { state: "ahead", presses: 2, call: "gitPush", args: { projectId: "p1" } },
    { state: "behind", presses: 1, call: "gitPull", args: { projectId: "p1" } },
  ];
  for (const { state, presses, call, args } of cases) {
    const h = await ready({ state });
    assert.ok(!h.sync.model().projectId, "the host sent no id");
    await h.open();
    for (let press = 0; press < presses; press += 1) await h.role(h.pop(), "primary").click();
    await flush();
    assert.deepEqual(plain(h.fake.last(call)), [args], `${state}: ${call} names the project the window read`);
  }
});

test("a dialog keeps sending the project it was opened for after the project changes underneath it, and the next one is drawn for the new project", async () => {
  const save = await ready({ state: "uncommitted" });
  void save.sync.showSave({ push: true });
  await flush();
  save.pushProjects(openProject("p2"));
  await save.role(save.sheet(), "primary").click();
  await flush();
  assert.deepEqual(plain(save.fake.last("gitSavePreview")), [{ projectId: "p1" }]);
  const saved = plain(save.fake.last("gitSave"))[0];
  assert.equal(saved.projectId, "p1", "the save goes to the project whose files were listed, not the one open now");
  assert.deepEqual(saved.paths, ["scripts/sync.mjs", "renderer/pc-sync.js", "docs/github-linking.md", "old-notes.txt"], "and it is the files that were listed");

  const publish = await ready({ state: "no-remote" });
  void publish.sync.showPublish();
  await flush();
  const form = publishForm(publish);
  publish.pushProjects(openProject("p2"));
  const name = form.sheet.querySelector(".gs-name-box .gs-input:not([readonly])") ?? form.sheet.querySelectorAll("input").find((node) => node.value === "Mefi-s-Studio-AI");
  name.value = "Field Notes";
  await name.trigger("input");
  await publish.advance(320);
  assert.deepEqual(plain(publish.fake.last("gitPublishPreview")), [{ owner: "nateecho32-stack", name: "Field Notes", gitignore: true, license: "none", projectId: "p1" }], "the name is checked against the project the dialog was opened for");
  await form.primary().click();
  await flush();
  const published = plain(publish.fake.last("gitPublish"))[0];
  assert.equal(published.projectId, "p1", "the publish goes to the project the dialog was opened for");
  assert.equal(published.name, "Field-Notes");

  const link = await ready({ state: "no-remote" });
  void link.sync.showLink();
  await flush();
  const sheet = link.sheet();
  link.pushProjects(openProject("p2"));
  await sheet.querySelectorAll(".gs-repo")[1].click();
  await link.role(sheet, "primary").click();
  await flush();
  assert.deepEqual(plain(link.fake.last("gitLink")), ["nateecho32-stack/field-notes", { projectId: "p1" }], "the link goes to the project the dialog was opened for");

  // A dialog opened after the change is drawn for the project that is open now.
  const later = await ready({ state: "uncommitted" });
  later.pushProjects(openProject("p2"));
  void later.sync.showSave({ push: true });
  await flush();
  assert.deepEqual(plain(later.fake.last("gitSavePreview")), [{ projectId: "p2" }]);
  const laterPublish = await ready({ state: "no-remote" });
  laterPublish.pushProjects(openProject("p2"));
  void laterPublish.sync.showPublish();
  await flush();
  assert.equal(plain(laterPublish.fake.last("gitPublishPreview"))[0].projectId, "p2");
  const laterLink = await ready({ state: "no-remote" });
  laterLink.pushProjects(openProject("p2"));
  void laterLink.sync.showLink();
  await flush();
  await laterLink.sheet().querySelectorAll(".gs-repo")[0].click();
  await laterLink.role(laterLink.sheet(), "primary").click();
  await flush();
  assert.deepEqual(plain(laterLink.fake.last("gitLink")), ["nateecho32-stack/mefi-studio", { projectId: "p2" }]);
});

test("with no project id known, no call carries one", async () => {
  const unknown = { projectsList: { ok: true, projects: [], activeId: null } };
  const cases = [
    { state: "ahead", presses: 2, call: "gitPush", args: {} },
    { state: "behind", presses: 1, call: "gitPull", args: {} },
    { state: "agents-working", presses: 1, call: "gitPull", args: { anyway: true } },
    { state: "diverged", presses: 2, call: "gitRebase", args: {} },
  ];
  for (const { state, presses, call, args } of cases) {
    const h = await ready({ state, replies: unknown });
    await h.open();
    for (let press = 0; press < presses; press += 1) await h.role(h.pop(), "primary").click();
    await flush();
    assert.deepEqual(plain(h.fake.last(call)), [args], `${state}: ${call} carries no project id`);
  }
  const checking = await ready({ state: "ahead", replies: unknown });
  await checking.open();
  await checking.role(checking.pop(), "check-now").click();
  assert.deepEqual(plain(checking.fake.last("gitCheck")), [{}], "Check now carries none");

  const save = await ready({ state: "uncommitted", replies: unknown });
  void save.sync.showSave({ push: true });
  await flush();
  assert.deepEqual(plain(save.fake.last("gitSavePreview")), [{}]);
  await save.role(save.sheet(), "primary").click();
  await flush();
  assert.equal("projectId" in plain(save.fake.last("gitSave"))[0], false, "the save carries none");

  const publish = await ready({ state: "no-remote", replies: unknown });
  void publish.sync.showPublish({ name: "Pixel Garden" });
  await flush();
  assert.equal("projectId" in plain(publish.fake.last("gitPublishPreview"))[0], false, "the name check carries none");
  await publishForm(publish).primary().click();
  await flush();
  assert.equal("projectId" in plain(publish.fake.last("gitPublish"))[0], false, "the publish carries none");

  const link = await ready({ state: "no-remote", replies: unknown });
  void link.sync.showLink();
  await flush();
  await link.sheet().querySelectorAll(".gs-repo")[1].click();
  await link.role(link.sheet(), "primary").click();
  await flush();
  assert.deepEqual(plain(link.fake.last("gitLink")), ["nateecho32-stack/field-notes", {}], "the link carries none");
});
