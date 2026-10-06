// The Studio Daily on the launch screen (renderer/daily-paper.js) with the
// real chooser (renderer/startup.js) in one stub document and a fake bridge.
// Pinned here: the paper lays out before the chooser takes its first focus,
// news that arrives late (or is pushed, or refreshed) never re-renders the
// chooser or takes the focus, a host without news or with the paper switched
// off leaves today's plain card, stories open through openExternal and come
// after the chooser in the Tab cycle, and the Settings switch saves
// settings.ui.dailyNews.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const startupSource = await readFile(new URL("../renderer/startup.js", import.meta.url), "utf8");
const paperSource = await readFile(new URL("../renderer/daily-paper.js", import.meta.url), "utf8");
const bootSource = await readFile(new URL("../renderer/boot.js", import.meta.url), "utf8");
const flush = async () => { for (let count = 0; count < 120; count += 1) await Promise.resolve(); };
// Values built inside the vm realm compare by their plain shape.
const plain = (value) => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; };

class Element {
  constructor(tag, doc) {
    this.tagName = String(tag).toUpperCase(); this.doc = doc; this.parent = null;
    this.children = []; this.dataset = {}; this.attrs = {}; this.listeners = {};
    this.hidden = false; this.disabled = false; this.className = ""; this.id = ""; this.ownText = ""; this.value = ""; this.title = "";
    const classes = () => new Set(this.className.split(/\s+/).filter(Boolean));
    this.classList = {
      add: (...names) => { const set = classes(); for (const name of names) set.add(name); this.className = [...set].join(" "); },
      remove: (...names) => { const set = classes(); for (const name of names) set.delete(name); this.className = [...set].join(" "); },
      toggle: (name, on) => { const set = classes(); if (on ?? !set.has(name)) set.add(name); else set.delete(name); this.className = [...set].join(" "); },
      contains: (name) => classes().has(name),
    };
  }
  set textContent(value) { this.ownText = String(value); this.children = []; }
  get textContent() { return this.ownText + this.children.map((child) => child.textContent).join(""); }
  append(...nodes) { for (const child of nodes) { if (child && typeof child === "object") child.parent = this; this.children.push(child); } }
  replaceChildren(...nodes) { this.ownText = ""; this.children = []; this.append(...nodes); }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key] ?? null; }
  removeAttribute(key) { delete this.attrs[key]; }
  addEventListener(name, fn) { (this.listeners[name] ??= []).push(fn); }
  async click() {
    if (this.disabled) return null;
    const event = { target: this, prevented: false, preventDefault() { this.prevented = true; } };
    if (typeof this.onclick === "function") await this.onclick(event);
    for (const fn of this.listeners.click ?? []) await fn(event);
    return event;
  }
  async fire(name, event = {}) { for (const fn of this.listeners[name] ?? []) await fn({ target: this, preventDefault() {}, ...event }); }
  focus() { this.doc.activeElement = this; this.doc.focusLog.push({ element: this, paper: this.doc.getElementById("boot-layer").dataset.paper ?? null }); }
  scrollIntoView() {}
  contains(node) { for (let at = node; at; at = at.parent) if (at === this) return true; return false; }
  matches(selector) {
    return selector.split(",").some((part) => (part.trim().match(/[a-z][\w-]*|\.[\w-]+|#[\w-]+|\[[^\]]+\]/gi) ?? []).every((token) => {
      if (token[0] === ".") return this.className.split(/\s+/).includes(token.slice(1));
      if (token[0] === "#") return this.id === token.slice(1);
      if (token[0] === "[") { const [, key, value] = /\[([\w-]+)(?:="([^"]*)")?\]/.exec(token); return value === undefined ? key in this.attrs : this.attrs[key] === value; }
      return this.tagName === token.toUpperCase();
    }));
  }
  querySelectorAll(selector) { return this.children.filter((child) => child instanceof Element).flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}

function environment(bridge, { scripts = [paperSource, startupSource] } = {}) {
  const elements = new Map();
  const document = {
    activeElement: null, focusLog: [], readyState: "complete",
    getElementById: (id) => { if (!elements.has(id)) { const made = new Element(id.includes("open") || id.includes("add") ? "button" : "div", document); made.id = id; elements.set(id, made); } return elements.get(id); },
    createElement: (tag) => new Element(tag, document),
    createElementNS: (_ns, tag) => new Element(tag, document),
    addEventListener() {},
  };
  const layer = document.getElementById("boot-layer");
  layer.dataset.phase = "choose";
  for (const id of ["paper-mast", "paper-note", "paper-news"]) document.getElementById(id).hidden = true;
  const warnings = [], toasts = [];
  const window = { mefiStudio: bridge, MefiToast: (message, kind) => toasts.push([message, kind]) };
  const context = vm.createContext({ window, document, console: { ...console, warn: (...args) => warnings.push(args) } });
  for (const source of scripts) vm.runInContext(source, context);
  const get = (id) => document.getElementById(id);
  const rows = () => get("boot-projects").querySelectorAll('[role="radio"]');
  return {
    window, document, get, rows, warnings, toasts, layer,
    startup: window.MefiStartup, paper: window.MefiDailyPaper,
    news: () => get("paper-news"),
    links: () => get("paper-news").querySelectorAll("a"),
    headline: () => get("paper-news").querySelector(".paper-lead-title")?.textContent ?? null,
    status: () => get("paper-mast").querySelector(".paper-status")?.textContent ?? null,
    refresh: () => get("paper-mast").querySelector("#paper-refresh"),
  };
}

const projectA = { id: "project_a", name: "Alpha", path: "C:/projects/alpha" };
const projectB = { id: "project_b", name: "Beta", path: "C:/projects/beta" };
const story = (id, title, extra = {}) => ({ id, title, dek: `${title}, in one sentence.`, url: `https://news.example/${id}`, source: "OpenAI", sourceId: "openai", publishedAt: Date.now() - 3 * 3600000, section: "MODELS", kind: "news", size: 1, also: [], ...extra });
const EDITION = {
  version: 1, date: "2026-09-29", number: 1, generatedAt: Date.now() - 60000, editor: "heuristic",
  lead: story("lead", "Introducing GPT-6.1 Sol", { points: 824, also: [{ source: "Simon Willison", url: "https://simonwillison.net/sol" }, { source: "Hacker News", url: "https://news.ycombinator.com/item?id=1", points: 824 }] }),
  top: [story("top1", "Introducing dots", { section: "TOOLS" }), story("top2", "DevDay 2026 recap"), story("top3", "The app store model", { section: "INDUSTRY", url: null })],
  briefs: [story("b1", "Git 2.56 highlights", { source: "The GitHub Blog" }), story("b2", "Sonnet 5.5")],
  wire: [{ id: "codex-0.159.2", title: "Codex CLI 0.159.2", dek: "Suppressed console windows.", url: "https://github.com/openai/codex/releases/tag/rust-v0.159.2", source: "Codex CLI", sourceId: "codex", publishedAt: Date.now() - 7200000, section: "TOOLS", kind: "release" }],
  sources: [{ id: "openai", name: "OpenAI", ok: true, count: 8 }, { id: "hn", name: "Hacker News", ok: true, count: 30 }, { id: "verge", name: "The Verge", ok: false, count: 0, error: "timed out" }],
};
function bridge(overrides = {}) {
  const calls = [];
  let push = null;
  const answer = deferred();
  const api = {
    startupState: async () => ({ ok: true, interactive: true, chosen: false, projects: [projectA, projectB], activeId: projectB.id }),
    startupChoose: async (id) => { calls.push(["choose", id]); return { ok: true, chosen: true, projects: [projectA, projectB], activeId: id }; },
    startupBegin: async () => ({ ok: true }),
    newsEdition: (options) => { calls.push(["newsEdition", options]); return answer.promise; },
    onNewsEdition: (listener) => { push = listener; },
    openExternal: async (url) => { calls.push(["openExternal", url]); return { ok: true }; },
    ...overrides,
  };
  return { api, calls, answer, push: (payload) => push?.(payload) };
}

test("the paper lays out before the chooser's first focus, and late news never re-renders the chooser or moves the focus", async () => {
  const host = bridge();
  const env = environment(host.api);
  const choice = env.startup.choose({ isCurrent: () => true });
  await flush();
  assert.equal(env.layer.dataset.paper, "on", "the front page is up with the card");
  assert.equal(env.get("paper-mast").hidden, false);
  assert.equal(env.news().dataset.state, "loading", "typographic placeholders while the wires answer");
  assert.ok(env.news().querySelector(".paper-skeleton"));
  assert.equal(env.status(), "Printing today's edition…");
  assert.deepEqual(plain(host.calls), [["newsEdition", {}]], "one ask for today's paper, and nothing else");
  const rows = env.rows();
  assert.equal(env.document.activeElement, rows[1], "first focus is the preselected project, exactly as without the paper");
  assert.deepEqual(env.document.focusLog.map((entry) => [entry.element, entry.paper]), [[rows[1], "on"]], "the layout was final before that focus");
  const nodes = [...env.get("boot-projects").children];

  host.answer.resolve({ ok: true, edition: EDITION });
  await flush();
  assert.equal(env.news().dataset.state, "ready");
  assert.equal(env.headline(), "Introducing GPT-6.1 Sol");
  assert.match(env.status(), /^Updated /);
  assert.equal(env.get("paper-mast").querySelector(".paper-issue").textContent, "No. 1 · 2 wires");
  assert.equal(env.document.activeElement, rows[1], "news arriving takes no focus");
  assert.equal(env.document.focusLog.length, 1);
  assert.deepEqual(env.get("boot-projects").children, nodes, "the chooser's rows are the same nodes");
  assert.ok(env.rows().every((row, index) => row === rows[index]));

  host.push({ ...EDITION, editor: "ai", generatedAt: EDITION.generatedAt + 1, lead: { ...EDITION.lead, title: "GPT-6.1 Sol brings near-Astra intelligence" } });
  await flush();
  assert.equal(env.headline(), "GPT-6.1 Sol brings near-Astra intelligence", "a pushed edition redraws the paper");
  assert.equal(env.get("paper-mast").querySelector(".paper-issue").textContent, "No. 1 · 2 wires · AI-edited");
  assert.match(env.get("paper-note").textContent, /An AI editor chose the lead/);
  assert.equal(env.document.activeElement, rows[1]);
  assert.deepEqual(env.get("boot-projects").children, nodes);

  // The chooser is untouched by all of it.
  await env.get("boot-open").click();
  await flush();
  assert.deepEqual(plain(await choice), { projectId: projectB.id, startAgents: false, changed: false });
  assert.deepEqual(plain(host.calls.filter(([name]) => name !== "newsEdition")), [["choose", projectB.id]]);
});

test("without the host's news, or with the paper switched off, the launch screen is today's plain card", async () => {
  const { newsEdition, onNewsEdition, ...plain } = bridge().api;
  const older = environment(plain);
  older.startup.choose();
  await flush();
  assert.equal(older.layer.dataset.paper, undefined);
  assert.equal(older.get("paper-mast").hidden, true);
  assert.equal(older.get("paper-news").hidden, true);
  assert.equal(older.document.activeElement, older.rows()[1]);
  assert.equal(older.paper.controls().length, 0);

  const off = bridge({ startupState: async () => ({ ok: true, interactive: true, chosen: false, projects: [projectA, projectB], activeId: projectB.id, news: false }) });
  const env = environment(off.api);
  env.startup.choose();
  await flush();
  assert.equal(env.layer.dataset.paper, undefined, "startup:state's news:false is the owner's off");
  assert.deepEqual(off.calls, [], "and nothing asks for news");

  // A host that says so only when asked: the paper steps back and the card keeps its focus.
  const late = bridge();
  const withdrawn = environment(late.api);
  withdrawn.startup.choose();
  await flush();
  assert.equal(withdrawn.layer.dataset.paper, "on");
  late.answer.resolve({ ok: false, disabled: true });
  await flush();
  assert.equal(withdrawn.layer.dataset.paper, undefined);
  assert.equal(withdrawn.get("paper-news").hidden, true);
  assert.equal(withdrawn.document.activeElement, withdrawn.rows()[1]);
  assert.equal(withdrawn.paper.controls().length, 0);

  // Diagnostic launches and a resumed session never ask the chooser, so never the paper.
  for (const state of [{ ok: true, interactive: false, projects: [projectA] }, { ok: true, interactive: true, resumed: { projectId: projectA.id, name: "Alpha" }, projects: [projectA], activeId: projectA.id }]) {
    const skipped = bridge({ startupState: async () => state });
    const screen = environment(skipped.api);
    await screen.startup.choose();
    assert.equal(screen.layer.dataset.paper, undefined, JSON.stringify(state));
    assert.deepEqual(skipped.calls, []);
  }
});

test("stories are links that open in the browser, after the chooser in the Tab order", async () => {
  const host = bridge();
  const env = environment(host.api);
  env.startup.choose();
  host.answer.resolve({ ok: true, edition: EDITION });
  await flush();
  const controls = env.paper.controls();
  const ids = plain(controls.map((control) => control.dataset.storyId ?? control.id));
  assert.deepEqual(ids, ["lead", "lead:also:0", "lead:also:1", "top1", "top2", "b1", "b2", "codex-0.159.2", "paper-refresh"], "reading order, the Hacker News thread first among the others, then Refresh");
  assert.equal(env.links().some((link) => link.textContent === "The app store model"), false, "a story without a link stays text");
  const lead = controls[0];
  assert.equal(lead.href, "https://news.example/lead");
  const event = await lead.click();
  await flush();
  assert.equal(event.prevented, true, "the page never navigates itself");
  assert.deepEqual(plain(host.calls.at(-1)), ["openExternal", "https://news.example/lead"]);
  assert.equal(controls[1].textContent, "Hacker News");
});

test("the boot gate's Tab cycle runs through the chooser, then the paper, and wraps", async () => {
  const doc = { readyState: "complete", activeElement: null, body: { children: [] }, documentElement: { setAttribute() {}, removeAttribute() {} } };
  const listeners = new Map();
  const node = (name, extra = {}) => ({ name, tabIndex: 0, hidden: false, focus() { doc.activeElement = this; }, getAttribute: () => null, ...extra });
  const radio = node("radio", { getAttribute: (key) => (key === "role" ? "radio" : null) }), open = node("open");
  const story = node("story"), refresh = node("refresh");
  const els = {};
  const get = (id) => (els[id] ??= { id, hidden: false, dataset: {}, children: [], setAttribute() {}, classList: { add() {}, remove() {} }, contains: () => true, focus() {}, replaceChildren() {}, append() {}, querySelectorAll: () => (id === "boot-choose" ? [radio, open] : []) });
  Object.assign(doc, { getElementById: get, createElement: () => ({ setAttribute() {}, classList: { add() {} } }), addEventListener() {} });
  const window = { MefiDailyPaper: { controls: () => [story, refresh] }, MefiNav: { noMotion: () => true }, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener() {} };
  const context = vm.createContext({ window, document: doc, performance: { now: () => 0 }, setTimeout: () => 0, clearTimeout() {}, requestAnimationFrame: () => 0, console });
  vm.runInContext(bootSource, context);
  window.MefiBoot.run([], () => {}, { choose: () => new Promise(() => {}) });
  await flush();
  const tab = (target, shiftKey = false) => listeners.get("keydown")({ key: "Tab", shiftKey, target, preventDefault() {}, stopImmediatePropagation() {} });
  doc.activeElement = open;
  tab(open);
  assert.equal(doc.activeElement, story, "after the chooser's last control, the paper's first story");
  tab(story);
  assert.equal(doc.activeElement, refresh);
  tab(refresh);
  assert.equal(doc.activeElement, radio, "and round to the chooser");
  tab(radio, true);
  assert.equal(doc.activeElement, refresh, "Shift+Tab goes back through the paper");
});

test("Refresh asks again without losing the keyboard; a story link that had it keeps it on the same story", async () => {
  const answers = [deferred(), deferred()];
  const calls = [];
  const host = bridge({ newsEdition: (options) => { calls.push(options); return answers[calls.length - 1].promise; } });
  const env = environment(host.api);
  env.startup.choose();
  answers[0].resolve({ ok: true, edition: EDITION });
  await flush();
  const refresh = env.refresh();
  refresh.focus();
  await refresh.click();
  await flush();
  assert.deepEqual(plain(calls), [{}, { refresh: true }]);
  assert.equal(refresh.getAttribute("aria-disabled"), "true", "busy, but still focusable");
  assert.equal(refresh.getAttribute("aria-busy"), "true");
  assert.equal(env.status(), "Refreshing…");
  await refresh.click();
  assert.equal(calls.length, 2, "a second press while it works asks nothing");
  answers[1].resolve({ ok: true, edition: { ...EDITION, generatedAt: EDITION.generatedAt + 5 } });
  await flush();
  assert.equal(env.refresh(), refresh, "the masthead's nodes are kept");
  assert.equal(env.document.activeElement, refresh);
  assert.equal(refresh.getAttribute("aria-disabled"), "false");

  const top = env.links().find((link) => link.dataset.storyId === "top2");
  top.focus();
  host.push({ ...EDITION, generatedAt: EDITION.generatedAt + 10 });
  await flush();
  const again = env.links().find((link) => link.dataset.storyId === "top2");
  assert.notEqual(again, top, "the story was redrawn");
  assert.equal(env.document.activeElement, again, "and the keyboard is on it again");
});

test("offline and stale papers say so; an answer that is not a paper shows the waiting page", async () => {
  const stale = bridge();
  const env = environment(stale.api);
  env.startup.choose();
  const yesterday = new Date(Date.now() - 86400000);
  const date = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
  stale.answer.resolve({ ok: true, offline: true, edition: { ...EDITION, date, stale: true } });
  await flush();
  assert.equal(env.status(), "Yesterday's edition · offline");
  assert.equal(env.get("paper-mast").querySelector(".paper-status").dataset.tone, "stale");
  assert.equal(env.headline(), "Introducing GPT-6.1 Sol", "yesterday's stories still read");

  const empty = bridge();
  const first = environment(empty.api);
  first.startup.choose();
  empty.answer.resolve({ ok: true, offline: true, edition: { ...EDITION, lead: null, top: [], briefs: [], wire: [{ id: "m", title: "A new model on your provider", url: null, source: "Your providers", kind: "model", publishedAt: Date.now() }], offline: true } });
  await flush();
  assert.equal(first.headline(), "Today's paper is on its way");
  assert.equal(first.news().dataset.state, "empty");
  assert.equal(first.status(), "Waiting for the news wires");
  assert.match(first.news().querySelector(".paper-wire").textContent, /A new model on your provider/);

  const broken = bridge({ newsEdition: async () => { throw new Error("bridge gone"); } });
  const third = environment(broken.api);
  third.startup.choose();
  await flush();
  assert.equal(third.headline(), "Today's paper is on its way");
  assert.equal(third.warnings.length, 1, "logged, never fatal");
  assert.equal(third.document.activeElement, third.rows()[1]);
});

test("Settings › General: Daily news on the launch screen saves settings.ui.dailyNews", async () => {
  const saved = [];
  const host = bridge({ prefsGet: async () => ({ ok: true, prefs: { dailyNews: false } }), prefsSet: async (prefs) => { saved.push(prefs); return { ok: true, prefs }; } });
  const env = environment(host.api, { scripts: [paperSource] });
  await flush();
  const box = env.get("launch-daily-news");
  assert.equal(box.checked, false, "the saved choice shows");
  assert.equal(env.get("launch-daily-news-row").hidden, false);
  box.checked = true;
  await box.fire("change");
  assert.deepEqual(plain(saved), [{ dailyNews: true }]);
  assert.match(env.toasts.at(-1)[0], /day's news/);
  const failing = bridge({ prefsSet: async () => ({ ok: false, error: "Settings are read-only." }) });
  const other = environment(failing.api, { scripts: [paperSource] });
  const toggle = other.get("launch-daily-news");
  toggle.checked = false;
  await toggle.fire("change");
  assert.equal(toggle.checked, true, "a switch that could not be saved goes back");
  assert.deepEqual(plain(other.toasts.at(-1)), ["Settings are read-only.", "warn"]);
  const { newsEdition, ...older } = bridge().api;
  const hiddenRow = environment(older, { scripts: [paperSource] });
  assert.equal(hiddenRow.get("launch-daily-news-row").hidden, true, "a host without the paper hides the switch");
});

// ---- Since you were away (main.cjs newsAway + What's new) ----

const AWAY = {
  ok: true, day: "2026-10-04",
  models: { firstVisit: false, drops: [
    { source: "zen", sourceName: "Zen", id: "gpt-6.1-sol", name: "GPT-6.1 Sol", releaseDate: "2026-09-29" },
    { source: "go", sourceName: "OpenCode Go", id: "deepseek-v5", name: "DeepSeek V5", releaseDate: "2026-10-03" },
  ] },
  projects: [
    { id: projectA.id, name: "Alpha", since: Date.now() - 5 * 3600000, finished: { count: 2, latest: [{ id: "t1", title: "Pin favourite notes" }, { id: "t2", title: "Rename notes" }] }, waiting: { count: 1, latest: [{ id: "q1", title: "Show the empty state on search?" }] }, running: 1, commits: { count: 3, unpulled: 2, latest: [{ subject: "Add export" }] }, quiet: false },
    { id: projectB.id, name: "Beta", since: null, finished: { count: 0, latest: [] }, waiting: { count: 0, latest: [] }, running: 0, commits: { count: 0, unpulled: 0, latest: [] }, quiet: true },
  ],
};
const NOTES = { ok: true, enabled: true, current: "0.4.6", history: [
  { version: "0.4.6", notes: ["The launch screen is a daily paper.", "Codex workers run over codex app-server."], unread: true },
  { version: "0.4.5", notes: ["Older."], unread: false },
] };

test("the front page opens with what changed while you were away: your projects, new models and Studio's own news", async () => {
  const away = deferred();
  const host = bridge({ newsAway: () => { host.calls.push(["newsAway"]); return away.promise; }, releaseWhatsNew: async () => NOTES });
  const env = environment(host.api, { scripts: [paperSource, startupSource] });
  env.startup.choose({ isCurrent: () => true });
  await flush();
  const rows = env.rows();
  assert.equal(env.document.activeElement, rows[1]);
  host.answer.resolve({ ok: true, edition: EDITION });
  await flush();
  assert.equal(env.news().querySelector(".paper-away"), null, "nothing drawn before the host answers");

  away.resolve(AWAY);
  await flush();
  const band = env.news().querySelector(".paper-away");
  assert.ok(band, "the band is up");
  assert.equal(env.news().children[0], band, "above the lead");
  assert.equal(band.querySelector(".paper-away-title").textContent, "Since you were away");
  const alpha = band.querySelector(".paper-away-projects").querySelectorAll(".paper-away-project")[0];
  const facts = alpha.querySelectorAll(".paper-away-fact").map((fact) => [fact.dataset.tone, fact.textContent]);
  assert.deepEqual(facts, [
    ["ask", "1 question waiting on you: Show the empty state on search?"],
    ["done", "2 tasks finished: Pin favourite notes, Rename notes"],
    ["run", "1 task running"],
    ["git", "3 new commits · 2 not pulled yet: Add export"],
  ]);
  assert.match(alpha.querySelector(".paper-away-meta").textContent, /^opened 5 h ago$/);
  const beta = band.querySelectorAll(".paper-away-project")[1];
  assert.equal(beta.querySelector(".paper-away-fact").textContent, "Nothing new since you were here.");
  assert.equal(beta.querySelector(".paper-away-meta").textContent, "not opened yet");
  const models = band.querySelector(".paper-away-models");
  assert.equal(models.querySelector(".paper-section-title").textContent, "New models");
  assert.deepEqual(models.querySelectorAll(".paper-away-model-name").map((name) => name.textContent), ["GPT-6.1 Sol", "DeepSeek V5"]);
  assert.equal(models.querySelectorAll(".paper-away-meta")[0].textContent, "Zen · Sep 29");
  const studio = band.querySelector(".paper-away-studio");
  assert.equal(studio.querySelector(".paper-away-version").textContent, "New in 0.4.6");
  assert.deepEqual(studio.querySelectorAll(".paper-away-change").map((line) => line.textContent), NOTES.history[0].notes);

  // Late, and no focus taken; the chooser's rows are untouched.
  assert.equal(env.document.activeElement, rows[1]);
  assert.ok(env.rows().every((row, index) => row === rows[index]));
  // A project's name selects it in the chooser and hands the keyboard to Open, without opening it.
  await alpha.querySelector(".paper-away-name").click();
  assert.equal(env.startup.state().selectedId, projectA.id);
  assert.equal(env.document.activeElement, env.get("boot-open"));
  assert.deepEqual(plain(host.calls.filter(([name]) => name === "choose")), [], "nothing was opened");
  // The project names join the Tab cycle before the stories.
  assert.equal(env.paper.controls()[0], alpha.querySelector(".paper-away-name"));
  assert.deepEqual(plain(host.calls.filter(([name]) => name === "newsAway")), [["newsAway"]], "asked once");
});

test("the band says so when nothing is new, and a first visit shows the last two weeks' models", async () => {
  const host = bridge({
    newsAway: async () => ({ ok: true, models: { firstVisit: true, drops: [{ source: "claude", sourceName: "Claude", id: "claude-opus-5-5", name: "Claude Opus 5.5", releaseDate: "2026-09-22" }] }, projects: [] }),
    releaseWhatsNew: async () => ({ ok: true, enabled: true, current: "0.4.6", history: [{ version: "0.4.6", notes: ["x"], unread: false }] }),
  });
  const env = environment(host.api);
  env.startup.choose();
  await flush();
  const band = env.news().querySelector(".paper-away");
  assert.ok(band, "drawn even while the news is still loading");
  assert.ok(env.news().querySelector(".paper-skeleton"), "above the placeholders");
  assert.equal(band.querySelector(".paper-away-title").textContent, "Welcome to Studio", "the very first launch has nothing to come back to");
  assert.match(band.querySelector(".paper-away-projects").querySelector(".paper-away-empty").textContent, /^Open a folder/);
  assert.equal(band.querySelector(".paper-away-models").querySelector(".paper-section-title").textContent, "Recent models");
  assert.match(band.querySelector(".paper-away-models").textContent, /Released in the last two weeks/);
  assert.equal(band.querySelector(".paper-away-studio").querySelector(".paper-away-empty").textContent, "You are on Studio 0.4.6. Nothing new to read.");
});

test("the paper switched off on the host, or a host without newsAway, draws no band", async () => {
  const off = bridge({ newsAway: async () => ({ ok: true, disabled: true }), releaseWhatsNew: async () => NOTES });
  const env = environment(off.api);
  env.startup.choose();
  off.answer.resolve({ ok: true, edition: EDITION });
  await flush();
  assert.equal(env.news().querySelector(".paper-away"), null);
  const older = environment(bridge().api);
  older.startup.choose();
  await flush();
  assert.equal(older.news().querySelector(".paper-away"), null, "no newsAway, no What's new: today's paper as it was");
});
