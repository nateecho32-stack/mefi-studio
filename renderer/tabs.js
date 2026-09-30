// Mefi's Studio AI+ — tabs you add and pin, which Studio keeps tidy. Layout v2 only.
//
// A tab is a remembered route (a registry id and the few params that say which
// place), never a live page: pages are singletons, so opening a tab asks
// MefiNav.go for the page and the page comes back the way history already
// restores it. The strip does not trust that every page was opened through
// go(). mefi:nav says what opened; a watcher on the body's class and data-sheet
// (the one nav.js already uses for the rail) and MefiNav.current() say what is
// showing, so the strip follows showTab, Workspace.enter and overlays that open
// themselves, and a page you reach any other way becomes, or replaces, the
// preview tab.
//
// What Studio does on its own, each with a switch (Configuration › UI &
// Surfaces › Tab behaviour, kept in mefiStudio.tabs.prefs.v1; one master switch
// and MEFI_STUDIO_NO_TAB_MANAGER=1 turn all of it off):
//   - one italic preview tab that the next single click replaces, unless you
//     type, pin or double-click it;
//   - an agent that needs you badges its tab and, by default, opens one in the
//     background (badge only, background tab, or open and focus);
//   - tabs of finished sessions close after an idle time (30 minutes);
//   - at most 8 unpinned tabs: the one used longest ago closes, with Undo;
//   - a quiet "Pin Fleet?" after three visits, never twice for the same page.
// Pinned tabs are never closed by Studio. Everything Studio closes is listed
// under Recently closed and comes back with Ctrl+Shift+T.
//
// Storage, every access guarded:
//   mefiStudio.tabs.v1.<projectId>  this project's tabs, its closed list and the active tab
//   mefiStudio.tabs.global.v1       pins that follow you into every project, the id counter,
//                                   and what the pin suggestion has counted and offered
//   mefiStudio.tabs.prefs.v1        the switches above
// With layout v2 off, or without MefiShell, nothing here renders, listens,
// polls, stores or calls the host: start() declines and every method is inert
// (open() is then plain MefiNav.go). docs/architecture.md has the walkthrough;
// tests/tabs_*.test.mjs and tests/tabs_render.test.mjs pin it.
(function () {
  "use strict";

  // ---- constants -----------------------------------------------------------------
  const VERSION = 1;
  const KEYS = Object.freeze({ prefs: "mefiStudio.tabs.prefs.v1", global: "mefiStudio.tabs.global.v1", project: "mefiStudio.tabs.v1." });
  const HOME = "home";
  const SVG_NS = "http://www.w3.org/2000/svg";
  const PERSIST_MS = 300; // a burst of changes is written once
  const GO_GRACE_MS = 800; // how long the page we asked for may take before we trust what is showing
  const CLOSED_MAX = 10;
  const VISITS_MAX = 80;
  const SUGGEST_AFTER = 3;
  const FOLD_BELOW = 900; // the contract's fold: below this the strip is one menu
  const HEIGHT = Object.freeze({ min: 28, max: 48, fallback: 38 });
  const DEFAULTS = Object.freeze({ manage: true, preview: true, agent: "bg", idle: 30, cap: 8, suggest: true });
  const AGENT_MODES = Object.freeze(["badge", "bg", "focus"]);
  const IDLE_CHOICES = Object.freeze([0, 10, 30, 60]);
  const CAP_RANGE = Object.freeze([3, 12]); // and 0, "no limit", one step past the top
  // Which params say which place. Everything else (a filter, a task selected on the
  // Task board, a card to scroll to) is where you are inside the page, not another tab.
  // Agents is one sheet with two faces: its overview, and Setup with four panes.
  const IDENTITY = Object.freeze({ workspace: Object.freeze(["view", "taskId", "projectId"]), agents: Object.freeze(["section", "pane"]) });
  const AGENT_PANES = Object.freeze({ connections: "Connections", team: "Team", routing: "Routing", behavior: "Behavior" });
  const TONES = Object.freeze({ ask: "warn", run: "live", check: "info", done: "good", dropped: "dim", wait: "dim", ready: "dim" });

  // ---- small helpers -------------------------------------------------------------
  const safe = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };
  const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const words = (value, max = 80) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");
  const now = () => Date.now();
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const read = (key) => { try { const raw = localStorage.getItem(key); return raw == null ? null : JSON.parse(raw); } catch { return null; } };
  const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } };
  function el(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  }
  function glyph(name) {
    if (typeof document.createElementNS !== "function") return null;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "glyph"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
    const use = document.createElementNS(SVG_NS, "use");
    use.setAttribute("href", `#${name}`);
    svg.append(use);
    return svg;
  }
  // A session's state as a dot in the state's colour (the tone names are the app's; TONES says which colour each gets).
  const dotFor = (tone) => { const dot = el("span", "ts-dot"); dot.dataset.tone = TONES[tone] || "dim"; return dot; };
  const v2 = () => document.documentElement?.dataset?.layout === "v2";
  // Somewhere text is being written: a text box, a text area, or an editable region. A switch, a slider or a button is not.
  const NOT_TEXT = new Set(["checkbox", "radio", "range", "button", "submit", "reset", "file", "color", "image"]);
  function isTyping(node) {
    const tag = String(node?.tagName || "").toLowerCase();
    if (tag === "textarea") return true;
    if (tag === "input") return !NOT_TEXT.has(String(node.type || node.getAttribute?.("type") || "text").toLowerCase());
    return node?.isContentEditable === true || node?.getAttribute?.("contenteditable") === "true" || node?.getAttribute?.("contenteditable") === "";
  }

  // ---- routes: which place, and what it is called ------------------------------------
  // A place is worth a tab when it is a page: a view, a tab page or a sheet. An action
  // (Friends opens a window over whatever is showing) and a transient layer (Search,
  // Configuration) are not places, so they never get one.
  function placeable(id) {
    if (id === "workspace") return true;
    const nav = window.MefiNav;
    if (!nav || typeof nav.get !== "function") return true;
    const dest = safe(() => nav.get(id), null);
    return Boolean(dest) && dest.kind !== "action" && dest.layer !== "transient";
  }
  // The canonical route for a registry id and whatever params it was opened with, or
  // null when it is not a place. Vibe is Home in another mode, so it is the same tab.
  function place(rawId, rawParams) {
    let id = typeof rawId === "string" ? rawId : "";
    if (id === "vibe") id = "workspace";
    if (!id || !placeable(id)) return null;
    const given = isObject(rawParams) ? rawParams : {};
    const params = {};
    for (const name of IDENTITY[id] || []) {
      const value = given[name];
      if ((typeof value === "string" && value) || (typeof value === "number" && Number.isFinite(value))) params[name] = String(value);
    }
    if (id === "workspace") {
      if (params.view === "task" && params.taskId) return { id, params: { view: "task", taskId: params.taskId, ...(params.projectId ? { projectId: params.projectId } : {}) } };
      return { id, params: params.view === "chat" ? { view: "chat" } : {} };
    }
    if (id === "agents") return { id, params: params.section === "setup" ? { section: "setup", pane: AGENT_PANES[params.pane] ? params.pane : "team" } : {} };
    return { id, params };
  }
  // The key two routes share when they are the same place (the project is fixed by the set, so it is not in it).
  const keyOf = (route) => route.id + Object.keys(route.params).filter((name) => name !== "projectId").sort().map((name) => `|${name}=${route.params[name]}`).join("");
  const isHomeRoute = (route) => route.id === "workspace" && !route.params.view;
  const isSession = (route) => route.id === "workspace" && route.params.view === "task";
  // A session belongs to one project; a page belongs to none, so a pin of a page follows you everywhere.
  const scopeOf = (route) => (route.params.taskId || route.params.projectId ? "project" : "global");
  const sessionRoute = (taskId, projectId) => ({ id: "workspace", params: { view: "task", taskId: String(taskId), ...(projectId ? { projectId: String(projectId) } : {}) } });

  // ---- what the app knows about a session ---------------------------------------------
  const DONE = new Set(["done", "archived", "completed"]);
  const snapshot = () => { const data = safe(() => window.MefiWorkspace?.snapshot?.(), null); return isObject(data) ? data : null; };
  function taskTitle(task) {
    const short = safe(() => window.MefiTasks?.shortTitle?.(task), "");
    return words(short || task?.title || task?.prompt || "", 60);
  }
  // The same reading Build's list uses when it has one (MefiBuilder.reading), else the plain status.
  function readingOf(task, data) {
    const built = safe(() => window.MefiBuilder?.reading?.(task, data), null);
    if (built && typeof built.tone === "string") return built.tone;
    const open = (Array.isArray(data?.assistant?.questions) ? data.assistant.questions : []).some((q) => q?.status === "open" && (q.context?.taskId || q.taskId) === task.id);
    if (open) return "ask";
    if (DONE.has(task.status)) return task.dropped ? "dropped" : "done";
    return task.status === "active" ? "run" : task.status === "awaiting_verification" ? "check" : "ready";
  }
  // Task ids the owner is being waited on for: the host's digest when it sends one (the list Vibe shows), else
  // open questions and the tasks waiting for a go-ahead or stuck.
  function needTaskIds(data) {
    const ids = new Set();
    const questions = Array.isArray(data?.assistant?.questions) ? data.assistant.questions : [];
    const taskOfQuestion = (id) => { const q = questions.find((item) => item?.id === id); return q?.context?.taskId || q?.taskId || null; };
    const digest = data?.assistant?.needsYou?.items;
    if (Array.isArray(digest)) {
      for (const item of digest) { const id = item?.taskId || (item?.kind === "question" ? taskOfQuestion(item.id) : null); if (id) ids.add(String(id)); }
      return ids;
    }
    for (const q of questions) if (q?.status === "open") { const id = q.context?.taskId || q.taskId; if (id) ids.add(String(id)); }
    for (const key of ["approval", "blocked"]) for (const row of Array.isArray(data?.backlog?.[key]) ? data.backlog[key] : []) if (row?.id && (row.kind ?? "task") === "task") ids.add(String(row.id));
    return ids;
  }
  // One look per paint: the project's tasks by id and what needs the owner.
  function context() {
    const data = snapshot();
    const tasks = new Map();
    for (const task of Array.isArray(data?.tasks) ? data.tasks : []) if (task?.id) tasks.set(String(task.id), task);
    return { data, tasks, loaded: Boolean(data && tasks.size > 0) };
  }
  const homeTitle = () => (window.MefiToday ? "Today" : words(safe(() => window.MefiNav?.get?.("workspace")?.short, ""), 20) || "Home");

  // What a tab shows: its words, its glyph (or, for a session, a dot in its state's colour) and whether it is finished.
  function describe(rec, ctx) {
    const route = rec.route;
    if (rec.home) return { title: homeTitle(), glyph: "g-home" };
    if (isSession(route)) {
      const task = ctx.tasks.get(route.params.taskId);
      const tone = task ? readingOf(task, ctx.data) : null;
      return { title: (task && taskTitle(task)) || rec.title || "Session", tone, finished: Boolean(task && (DONE.has(task.status) || tone === "done" || tone === "dropped")), missing: Boolean(ctx.loaded && !task) };
    }
    if (route.id === "workspace") return { title: route.params.view === "chat" ? "Chat" : homeTitle(), glyph: route.params.view === "chat" ? "g-spark" : "g-home" };
    const dest = safe(() => window.MefiNav?.get?.(route.id), null);
    let title = words(dest?.short || dest?.label || rec.title || route.id, 40);
    if (route.id === "agents" && route.params.pane) title = `Agents · ${AGENT_PANES[route.params.pane]}`;
    return { title, glyph: dest?.glyph || "g-frame" };
  }

  // ---- the model ---------------------------------------------------------------------
  // Home is always first and is not stored. Pins follow you into every project (global, for a page) or stay with
  // the project (a session); the rest of a project's tabs come after, pinned ones first.
  const HOME_REC = { id: HOME, route: { id: "workspace", params: {} }, pin: true, home: true, title: "" };
  const S = {
    running: false, project: "none", seq: 0, clock: 0, active: HOME, tabs: [], closed: [],
    global: { pins: [], visits: {}, offered: {} }, prefs: { ...DEFAULTS }, forcedOff: false,
    needs: new Set(), needsKnown: null, lastSeen: {}, going: null, suggest: null,
    listeners: new Set(), cards: new Set(), dirty: false, persistTimer: 0, sweepTimer: 0, readers: new Map(),
    shown: true, compact: false, suppressClick: 0,
  };
  const order = () => [HOME_REC, ...S.global.pins, ...S.tabs];
  const byId = (id) => order().find((rec) => rec.id === id) || null;
  const byKey = (key) => order().find((rec) => keyOf(rec.route) === key) || null;
  const cur = () => byId(S.active) || HOME_REC;
  const pinFirst = () => { S.tabs = [...S.tabs.filter((rec) => rec.pin), ...S.tabs.filter((rec) => !rec.pin)]; };

  // What Studio may do on its own, after the master switch and the run's own environment.
  function eff() {
    const on = S.prefs.manage && !S.forcedOff;
    return { manage: on, preview: on && S.prefs.preview, agent: on ? S.prefs.agent : "badge", idle: on ? S.prefs.idle : 0, cap: on ? S.prefs.cap : 0, suggest: on && S.prefs.suggest };
  }
  function sanitizePrefs(raw) {
    const p = isObject(raw) ? raw : {};
    // A number, or text that is one: null, "" and false are not a cap of 0 (no limit), they are nothing said.
    const cap = typeof p.cap === "number" ? p.cap : typeof p.cap === "string" && p.cap.trim() ? Number(p.cap) : NaN;
    return {
      manage: p.manage !== false, preview: p.preview !== false, suggest: p.suggest !== false,
      agent: AGENT_MODES.includes(p.agent) ? p.agent : DEFAULTS.agent,
      idle: IDLE_CHOICES.includes(Number(p.idle)) ? Number(p.idle) : DEFAULTS.idle,
      cap: Number.isFinite(cap) ? (Math.round(cap) === 0 ? 0 : clamp(Math.round(cap), CAP_RANGE[0], CAP_RANGE[1])) : DEFAULTS.cap,
    };
  }

  // A stored tab, made safe to use, or null when it is unusable (a page that no longer exists is skipped quietly).
  function sanitizeRecord(raw, { pinned = false } = {}) {
    if (!isObject(raw) || typeof raw.id !== "string" || !raw.id || raw.id === HOME || !isObject(raw.route)) return null;
    const route = place(raw.route.id, raw.route.params);
    if (!route || isHomeRoute(route)) return null;
    if (pinned && scopeOf(route) !== "global") return null;
    return {
      id: raw.id.slice(0, 40), route, title: words(raw.title), pin: pinned || raw.pin === true, prev: !pinned && raw.prev === true && raw.pin !== true,
      used: Number.isFinite(raw.used) ? raw.used : 0, at: Number.isFinite(raw.at) ? raw.at : now(),
    };
  }
  const idNumber = (id) => { const match = /^t(\d+)$/.exec(String(id)); return match ? Number(match[1]) : 0; };
  function loadGlobal() {
    const raw = read(KEYS.global);
    const out = { seq: 0, pins: [], visits: {}, offered: {} };
    if (!isObject(raw) || raw.v !== VERSION) return out;
    out.seq = Number.isFinite(raw.seq) ? raw.seq : 0;
    const seen = new Set();
    for (const item of Array.isArray(raw.pins) ? raw.pins : []) {
      const rec = sanitizeRecord(item, { pinned: true });
      if (rec && !seen.has(keyOf(rec.route)) && !out.pins.some((p) => p.id === rec.id)) { seen.add(keyOf(rec.route)); out.pins.push(rec); }
    }
    for (const [key, count] of Object.entries(isObject(raw.visits) ? raw.visits : {})) if (Number.isFinite(count) && count > 0) out.visits[key] = Math.min(count, 99);
    for (const [key, on] of Object.entries(isObject(raw.offered) ? raw.offered : {})) if (on) out.offered[key] = 1;
    return out;
  }
  function loadSet(projectId) {
    const raw = projectId === "none" ? null : read(KEYS.project + projectId);
    const out = { tabs: [], closed: [], active: HOME, clock: 0 };
    if (!isObject(raw) || raw.v !== VERSION) return out;
    const taken = new Set(S.global.pins.map((rec) => keyOf(rec.route)));
    const ids = new Set(S.global.pins.map((rec) => rec.id));
    for (const item of Array.isArray(raw.tabs) ? raw.tabs : []) {
      const rec = sanitizeRecord(item);
      if (!rec || taken.has(keyOf(rec.route)) || ids.has(rec.id)) continue;
      taken.add(keyOf(rec.route)); ids.add(rec.id); out.tabs.push(rec);
    }
    for (const item of Array.isArray(raw.closed) ? raw.closed : []) {
      const route = isObject(item) && isObject(item.route) ? place(item.route.id, item.route.params) : null;
      if (route && !isHomeRoute(route)) out.closed.push({ rid: words(item.rid, 40), route, title: words(item.title), at: Number.isFinite(item.at) ? item.at : 0 });
    }
    out.closed = out.closed.slice(0, CLOSED_MAX);
    out.clock = Number.isFinite(raw.clock) ? raw.clock : 0;
    out.active = typeof raw.active === "string" ? raw.active : HOME;
    return out;
  }
  // The counter is shared by every project's ids, so a pin that moves between sets keeps its id; make it safe against a lost store.
  const raiseSeq = () => { for (const rec of [...S.global.pins, ...S.tabs]) S.seq = Math.max(S.seq, idNumber(rec.id)); };
  function adoptSet(set) {
    S.tabs = set.tabs; S.closed = set.closed; S.clock = set.clock;
    S.active = byId(set.active) ? set.active : HOME;
    pinFirst(); raiseSeq();
  }

  // Everything is written through here, a little after the last change (and at once before a reload or when the window hides).
  function persistSoon() {
    S.dirty = true;
    if (S.persistTimer || typeof setTimeout !== "function") return;
    S.persistTimer = setTimeout(() => { S.persistTimer = 0; flushPersist(); }, PERSIST_MS);
  }
  function flushPersist() {
    if (S.persistTimer) { safe(() => clearTimeout(S.persistTimer)); S.persistTimer = 0; }
    if (!S.dirty) return;
    S.dirty = false;
    const visits = Object.entries(S.global.visits).sort((a, b) => b[1] - a[1]).slice(0, VISITS_MAX);
    write(KEYS.global, { v: VERSION, seq: S.seq, pins: S.global.pins.map(storable), visits: Object.fromEntries(visits), offered: S.global.offered });
    if (S.project !== "none") {
      write(KEYS.project + S.project, { v: VERSION, clock: S.clock, active: S.active, tabs: S.tabs.map(storable), closed: S.closed.slice(0, CLOSED_MAX) });
    }
  }
  const storable = (rec) => ({ id: rec.id, route: rec.route, title: rec.title, pin: rec.pin === true, prev: rec.prev === true, used: rec.used, at: rec.at });

  // ---- changes --------------------------------------------------------------------------
  // Every change to the set goes through here: one repaint, one write, the sweep re-planned, listeners told.
  function changed(reason, { write = true } = {}) {
    if (S.suggest && S.suggest.key !== keyOf(cur().route)) S.suggest = null;
    if (write) persistSoon();
    scheduleRender(); planSweep();
    for (const listener of [...S.listeners]) safe(() => listener({ reason, active: S.active, count: order().length }));
    repaintCards();
    return true;
  }
  function pushClosed(rec) {
    const key = keyOf(rec.route);
    S.closed = [{ rid: rec.id, route: copy(rec.route), title: rec.title, at: now() }, ...S.closed.filter((item) => keyOf(item.route) !== key)].slice(0, CLOSED_MAX);
  }
  function makeRecord(route, extra = {}) {
    return { id: `t${++S.seq}`, route: copy(route), title: "", pin: false, prev: false, used: ++S.clock, at: now(), ...extra };
  }
  function insertAfterActive(rec) {
    const i = S.tabs.findIndex((item) => item.id === S.active);
    if (i >= 0 && !S.tabs[i].pin) S.tabs.splice(i + 1, 0, rec); else S.tabs.push(rec);
    pinFirst();
  }
  const leave = (rec) => { if (rec && !rec.home) rec.at = now(); };
  function enter(rec) {
    if (rec.home) return;
    rec.used = ++S.clock; rec.badge = false; rec.fresh = false;
    visit(rec);
  }
  // A page visited three times is offered a pin once; what was counted and what was offered outlive a restart.
  function visit(rec) {
    if (rec.pin || rec.route.id === "workspace" || scopeOf(rec.route) !== "global") return;
    const key = keyOf(rec.route);
    S.global.visits[key] = (S.global.visits[key] || 0) + 1;
    if (eff().suggest && S.global.visits[key] >= SUGGEST_AFTER && !S.global.offered[key]) S.suggest = { key, route: copy(rec.route) };
  }

  // ---- asking the app for a page ---------------------------------------------------------------
  function goRoute(route, from) {
    const nav = window.MefiNav;
    if (!nav || typeof nav.go !== "function") return false;
    S.going = { key: keyOf(route), from: from ? keyOf(from.route) : null, at: now() };
    try {
      // Home asks for its own view: Build's Home would otherwise bring back the session you last had open, and the Home tab
      // could never be the one you are on. Vibe and the classic layout ignore the parameter.
      const result = isHomeRoute(route) ? nav.go("workspace", { view: "home" }) : nav.go(route.id, { ...route.params });
      if (result && typeof result.catch === "function") result.catch(() => {});
      return true;
    } catch { return false; }
  }
  function readPlace() {
    const nav = window.MefiNav;
    let id = safe(() => nav?.current?.(), null);
    if (typeof id !== "string" || !id) return null;
    if (id === "vibe") id = "workspace";
    const reader = S.readers.get(id);
    const params = (reader ? safe(reader, null) : null) ?? S.lastSeen[id] ?? {};
    const route = place(id, params);
    return route ? { route, key: keyOf(route) } : null;
  }
  const atPlace = (rec) => { const here = readPlace(); return Boolean(here && here.key === keyOf(rec.route)); };

  // ---- opening, activating, closing ------------------------------------------------------------
  function activate(id, { go = true } = {}) {
    const rec = byId(id);
    if (!rec) return false;
    const previous = cur();
    if (previous !== rec) { leave(previous); S.active = rec.id; enter(rec); }
    if (go && !atPlace(rec)) goRoute(rec.route, previous);
    return changed("activate");
  }
  // A place that has no tab: the preview tab is reused, or a tab opens beside the current one.
  function createFor(route, { preview = false, title = "" } = {}) {
    if (preview) {
      const reuse = S.tabs.find((rec) => rec.prev);
      if (reuse) { Object.assign(reuse, { route: copy(route), title, used: ++S.clock, at: now(), badge: false, fresh: false }); return reuse; }
    }
    const rec = makeRecord(route, { prev: preview, title });
    insertAfterActive(rec);
    return rec;
  }
  // The app is showing a place: find its tab, or make it the preview tab.
  function onPlace(here) {
    const active = cur();
    if (keyOf(active.route) === here.key) return false;
    let rec = byKey(here.key);
    leave(active);
    if (!rec) rec = createFor(here.route, { preview: eff().preview });
    S.active = rec.id; enter(rec);
    enforceCap(rec.id);
    return changed("place");
  }
  function open(routeId, params = {}, options = {}) {
    const route = place(routeId, params);
    // Not running, or not a place (Friends opens a window over whatever is showing; Search and Configuration are layers):
    // whoever asked wanted it shown, so it is opened the way it always was, and no tab is made.
    if (!S.running || !route) { if (typeof routeId === "string") safe(() => window.MefiNav?.go?.(routeId, params)); return null; }
    let rec = byKey(keyOf(route));
    const preview = options.preview !== false && eff().preview && !options.pin && !options.background;
    if (!rec) {
      rec = options.background ? makeRecord(route, { title: words(options.title) }) : createFor(route, { preview, title: words(options.title) });
      if (options.background) { S.tabs.push(rec); pinFirst(); }
    } else if (options.preview === false && rec.prev) rec.prev = false;
    if (options.pin && !rec.pin) setPin(rec.id, true);
    if (options.background) { enforceCap(S.active, rec.id); changed("open"); return snapshotOf(rec); }
    activate(rec.id);
    enforceCap(rec.id);
    return snapshotOf(byId(rec.id) || rec);
  }
  function closeTab(id, { quiet = false } = {}) {
    const rec = byId(id);
    if (!rec || rec.home) return false;
    const all = order(), at = all.indexOf(rec);
    const next = S.active === id ? (all[at + 1] || all[at - 1] || HOME_REC) : null;
    removeRecord(rec);
    pushClosed(rec);
    if (next) { const previous = rec; S.active = next.id; enter(next); if (!atPlace(next)) goRoute(next.route, previous); }
    if (!quiet) announce(`Closed ${describe(rec, context()).title}`);
    return changed("close");
  }
  function removeRecord(rec) {
    S.tabs = S.tabs.filter((item) => item !== rec);
    S.global.pins = S.global.pins.filter((item) => item !== rec);
  }
  // Several at once: Close others, Close to the right, Close all but pinned. The one to stay on is activated when the current tab went.
  function closeMany(ids, stay) {
    const gone = ids.map(byId).filter((rec) => rec && !rec.home && !rec.pin);
    if (!gone.length) return 0;
    const wasActive = gone.some((rec) => rec.id === S.active);
    for (const rec of gone) { removeRecord(rec); pushClosed(rec); }
    if (wasActive) {
      const next = (stay && byId(stay)) || HOME_REC;
      const previous = gone.find((rec) => rec.id === S.active);
      S.active = next.id; enter(next); if (!atPlace(next)) goRoute(next.route, previous);
    }
    changed("close");
    return gone.length;
  }
  function setPin(id, on) {
    const rec = byId(id);
    if (!rec || rec.home) return false;
    on = on !== false;
    if (Boolean(rec.pin) === on) return true;
    if (on) {
      rec.pin = true; rec.prev = false;
      if (scopeOf(rec.route) === "global") { S.tabs = S.tabs.filter((item) => item !== rec); S.global.pins.push(rec); }
      else { const rest = S.tabs.filter((item) => item !== rec); rest.splice(rest.filter((item) => item.pin).length, 0, rec); S.tabs = rest; }
    } else {
      rec.pin = false;
      const rest = S.tabs.filter((item) => item !== rec);
      S.global.pins = S.global.pins.filter((item) => item !== rec);
      rest.splice(rest.filter((item) => item.pin).length, 0, rec);
      S.tabs = rest;
    }
    if (S.suggest && S.suggest.key === keyOf(rec.route)) S.suggest = null;
    toast(on ? `Pinned “${clip(describe(rec, context()).title, 26)}”. It stays at the left and never closes by itself.` : `Unpinned “${clip(describe(rec, context()).title, 26)}”.`, { duration: 3600 });
    return changed("pin");
  }
  // Where a tab may be dragged: among the global pins, among this project's pins, or among the rest.
  function groupOf(rec) {
    if (S.global.pins.includes(rec)) return { list: S.global.pins, from: 0, to: S.global.pins.length };
    const pinned = S.tabs.filter((item) => item.pin).length;
    return rec.pin ? { list: S.tabs, from: 0, to: pinned } : { list: S.tabs, from: pinned, to: S.tabs.length };
  }
  function moveTo(id, index) {
    const rec = byId(id);
    if (!rec || rec.home) return false;
    const group = groupOf(rec);
    const target = clamp(Math.round(Number(index)), 0, Math.max(0, group.to - group.from - 1));
    if (!Number.isFinite(target) || group.list.indexOf(rec) - group.from === target) return false;
    group.list.splice(group.list.indexOf(rec), 1);
    group.list.splice(group.from + target, 0, rec);
    rec.prev = false; // arranging a tab keeps it
    return changed("move");
  }
  function moveBy(id, delta) {
    const rec = byId(id);
    if (!rec || rec.home) return false;
    const group = groupOf(rec);
    return moveTo(id, group.list.indexOf(rec) - group.from + delta);
  }
  function keep(id = S.active) {
    const rec = byId(id);
    if (!rec || !rec.prev) return false;
    rec.prev = false;
    return changed("keep");
  }
  function cycle(direction) {
    const all = order();
    if (all.length < 2) return false;
    const at = Math.max(0, all.indexOf(cur()));
    return activate(all[(at + direction + all.length) % all.length].id);
  }
  function jump(n) {
    const all = order();
    const rec = n === 9 ? all[all.length - 1] : all[n - 1];
    return rec ? activate(rec.id) : false;
  }
  function closeActive() {
    const rec = cur();
    if (rec.home) { announce(`${describe(rec, context()).title} stays open`); return false; }
    return closeTab(rec.id);
  }

  // ---- recently closed, and Undo ---------------------------------------------------------------
  function validClosed() {
    const ctx = context();
    return S.closed.filter((item) => place(item.route.id, item.route.params) && !(isSession(item.route) && ctx.loaded && !ctx.tasks.has(item.route.params.taskId)));
  }
  function recentlyClosed() {
    return validClosed().map((item) => ({ route: copy(item.route), title: item.title, at: item.at }));
  }
  // Brings back the newest tab that can come back (Ctrl+Shift+T), or the one asked for. Entries that cannot, a session whose task
  // is gone or a page that no longer exists, are skipped without a word.
  function restore(index = 0) {
    if (!S.running) return null;
    const valid = validClosed();
    const item = typeof index === "object" && index ? valid.find((entry) => entry === index || (entry.rid === index.rid && keyOf(entry.route) === keyOf(index.route))) : valid[index];
    if (!item) { toast("No closed tabs to reopen.", { duration: 2600 }); return null; }
    S.closed = S.closed.filter((entry) => entry !== item && valid.includes(entry));
    return open(item.route.id, item.route.params, { preview: false, title: item.title });
  }
  const idleWords = (minutes) => (minutes >= 60 ? "an hour" : `${minutes} minutes`);
  // Studio closed these: they go to Recently closed and the toast can put them back where they were.
  function closedByStudio(recs, message) {
    const token = S.project;
    const snaps = recs.map((rec) => ({ rec, index: S.tabs.indexOf(rec) }));
    S.tabs = S.tabs.filter((rec) => !recs.includes(rec));
    recs.forEach(pushClosed);
    toast(message, { duration: 9000, action: { label: "Undo", run: () => undo(snaps, token) } });
    changed("tidy");
  }
  function undo(snaps, token) {
    if (S.project !== token) return;
    for (const { rec, index } of [...snaps].sort((a, b) => a.index - b.index)) {
      if (byKey(keyOf(rec.route))) continue;
      S.tabs.splice(clamp(index, 0, S.tabs.length), 0, rec);
    }
    S.closed = S.closed.filter((item) => !snaps.some((snap) => snap.rec.id === item.rid));
    pinFirst();
    changed("undo");
  }
  const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
  // At most `cap` unpinned tabs: the one used longest ago goes, never the one showing or the one just opened.
  function enforceCap(...keepIds) {
    const cap = eff().cap;
    if (!cap) return [];
    const unpinned = S.tabs.filter((rec) => !rec.pin);
    const over = unpinned.length - cap;
    if (over <= 0) return [];
    const victims = unpinned.filter((rec) => rec.id !== S.active && !keepIds.includes(rec.id)).sort((a, b) => a.used - b.used).slice(0, over);
    if (!victims.length) return [];
    const ctx = context();
    closedByStudio(victims, victims.length === 1 ? `Closed “${clip(describe(victims[0], ctx).title, 24)}” to keep ${cap} tabs open.` : `Closed ${victims.length} old tabs to keep ${cap} open.`);
    return victims;
  }
  // Tabs of finished sessions you have not had open for the idle time. A timer is set only when there is
  // something that could be due, for the moment it is; otherwise nothing runs.
  function sweepCandidates(ctx) {
    return S.tabs.filter((rec) => !rec.pin && rec.id !== S.active && isSession(rec.route) && describe(rec, ctx).finished);
  }
  function sweep() {
    if (S.sweepTimer) { safe(() => clearTimeout(S.sweepTimer)); S.sweepTimer = 0; }
    const minutes = eff().idle;
    if (!S.running || !minutes) return 0;
    const limit = minutes * 60000, at = now();
    const ctx = context();
    const gone = sweepCandidates(ctx).filter((rec) => at - rec.at >= limit);
    if (gone.length) closedByStudio(gone, gone.length === 1 ? `Closed “${clip(describe(gone[0], ctx).title, 24)}”: done, and idle for ${idleWords(minutes)}.` : `Closed ${gone.length} tabs of done work, idle for ${idleWords(minutes)}.`);
    else planSweep();
    return gone.length;
  }
  function planSweep() {
    if (S.sweepTimer) { safe(() => clearTimeout(S.sweepTimer)); S.sweepTimer = 0; }
    const minutes = eff().idle;
    if (!S.running || !minutes || typeof setTimeout !== "function" || !S.tabs.some((rec) => !rec.pin && isSession(rec.route))) return;
    const due = sweepCandidates(context()).map((rec) => rec.at + minutes * 60000);
    if (!due.length) return;
    S.sweepTimer = setTimeout(sweep, Math.max(1000, Math.min(...due) - now() + 50));
  }

  // ---- an agent that needs you -----------------------------------------------------------------
  // New need: badge its tab and, by default, open one in the background; "open and focus" goes there too.
  function onNeeds(route) {
    const mode = eff().agent;
    let rec = byKey(keyOf(route));
    if (rec && rec.id === S.active) return false;
    if (mode === "badge") { if (rec) { rec.badge = true; scheduleRender(); } return Boolean(rec); }
    if (!rec) {
      rec = makeRecord(route);
      S.tabs.push(rec); pinFirst();
      enforceCap(S.active, rec.id);
    }
    rec.badge = true; rec.fresh = true;
    if (mode === "focus") activate(rec.id); else changed("needs");
    return true;
  }
  // Look at what needs the owner and act on what is new; what was there at the first look is not announced.
  function refreshNeeds() {
    const data = snapshot();
    if (!data) return;
    const ids = needTaskIds(data);
    // The first look is only a baseline, and it is not taken until the board or the assistant's state has arrived,
    // or every old question would look new.
    const arrived = Boolean(data.tasks?.length) || Array.isArray(data.assistant?.questions) || Array.isArray(data.assistant?.needsYou?.items);
    const fresh = S.needsKnown ? [...ids].filter((id) => !S.needsKnown.has(id)) : [];
    S.needs = ids;
    if (arrived) S.needsKnown = new Set(ids);
    for (const id of fresh) safe(() => onNeeds(sessionRoute(id, data.projectId)));
    pruneMissing();
    scheduleRender();
  }
  // A session that was deleted cannot be opened: its tab goes quietly. (Only once the board has loaded.)
  function pruneMissing() {
    const ctx = context();
    if (!ctx.loaded) return;
    const gone = S.tabs.filter((rec) => isSession(rec.route) && !ctx.tasks.has(rec.route.params.taskId) && rec.id !== S.active);
    if (!gone.length) return;
    S.tabs = S.tabs.filter((rec) => !gone.includes(rec));
    changed("prune");
  }
  function needCount() {
    const count = safe(() => window.MefiToday?.count?.(), null);
    return Number.isFinite(count) ? count : S.needs.size;
  }

  // ---- preferences ------------------------------------------------------------------------------
  function setPrefs(patch) {
    const before = eff();
    S.prefs = sanitizePrefs({ ...S.prefs, ...(isObject(patch) ? patch : {}) });
    write(KEYS.prefs, { v: VERSION, ...S.prefs });
    if (!eff().preview) for (const rec of S.tabs) rec.prev = false;
    if (!eff().suggest) S.suggest = null;
    if (before.cap !== eff().cap) enforceCap(S.active);
    changed("prefs");
    return { ...S.prefs };
  }
  function announce(text) {
    if (ui.live) ui.live.textContent = text;
  }
  function toast(message, { duration = 2600, action = null } = {}) {
    safe(() => window.MefiToast?.(message, "info", { duration, ...(action ? { action } : {}) }));
  }

  // ---- looking at where you are -----------------------------------------------------------------
  let watching = false;
  let syncQueued = false;
  const listening = [];
  function listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    listening.push([target, type, handler, options]);
  }
  // Everything that might have changed the place asks for one look after the current task has finished, so what
  // a click handler does after calling go() (Build picking its view) is done by the time we read it.
  function queueSync() {
    if (syncQueued || !S.running) return;
    syncQueued = true;
    Promise.resolve().then(() => { syncQueued = false; sync(); });
  }
  function sync() {
    if (!S.running) return false;
    if (safe(() => window.MefiBoot?.isActive?.(), false)) return false; // the launch screen is up: nothing is settled yet
    const here = readPlace();
    if (!here) return false;
    const going = S.going;
    if (going) {
      if (here.key === going.key) { S.going = null; return false; }
      if (here.key === going.from && now() - going.at < GO_GRACE_MS) return false; // the page we asked for has not arrived yet
      S.going = null;
    }
    return onPlace(here);
  }
  // What a page was last opened with: a view says it in its mefi:nav (Home with a task), a sheet does not, so this
  // remembers it for when the page comes back from under another (Escape out of the Task board onto Build's session).
  function onNav(event) {
    const detail = event?.detail || {};
    if (detail.action === "open" && typeof detail.id === "string") {
      const route = place(detail.id, detail.params);
      if (route) S.lastSeen[route.id] = route.params;
    }
    // A page opening closes a menu (Search, a page, a sheet); the nav announces an action after it has run it, and the one
    // action that opens a menu here is Search's "Tab behaviour", which must not close what it just opened.
    if (ui.pop && detail.action === "open" && detail.id !== "tabBehaviour") closePop();
    queueSync();
  }
  function onProject(event) {
    const next = event?.detail?.projectId || projectId() || "none";
    if (next === S.project) return;
    adoptProject(next);
  }
  function projectId() {
    const workspace = window.MefiWorkspace;
    const id = safe(() => workspace?.activeProjectId?.(), null) || safe(() => workspace?.state?.activeId, null) || safe(() => window.MefiTasks?.state?.projectId, null);
    return typeof id === "string" && id ? id : null;
  }
  // Another project has its own tabs. A set made before the project was known (the launch) is carried over when the project has none yet.
  function adoptProject(next) {
    flushPersist();
    const carry = S.project === "none" && next !== "none" && read(KEYS.project + next) === null ? { tabs: S.tabs, closed: S.closed, clock: S.clock, active: S.active } : null;
    S.project = next;
    S.lastSeen = {}; S.needs = new Set(); S.needsKnown = null; S.suggest = null; S.going = null;
    adoptSet(carry || loadSet(next));
    // What was read is not written back; a set carried over from before the project was known is, once it has anything in it.
    const carried = Boolean(carry && (carry.tabs.length || carry.closed.length));
    if (carried) S.dirty = true;
    refreshNeeds();
    changed("project", { write: carried });
    queueSync();
  }

  // ---- the strip -----------------------------------------------------------------------------------
  const ui = { root: null, list: null, more: null, menu: null, add: null, gap: null, suggest: null, suggestText: null, cfg: null, live: null, handle: null, items: new Map(), frame: 0, stale: false, pop: null, hidden: [], observer: null, resizeObserver: null, drag: null, panel: null, region: null };
  function build() {
    const root = el("div", "ts-strip");
    root.id = "mefi-tabs";
    const list = el("div", "ts-list");
    list.id = "mefi-tabs-list";
    list.setAttribute("role", "tablist"); list.setAttribute("aria-label", "Open tabs"); list.setAttribute("aria-orientation", "horizontal");
    const more = el("button", "ts-more", "");
    more.type = "button"; more.id = "mefi-tabs-more"; more.hidden = true;
    more.setAttribute("aria-haspopup", "menu"); more.setAttribute("aria-expanded", "false");
    const menu = el("button", "ts-menu");
    menu.type = "button"; menu.id = "mefi-tabs-menu";
    menu.setAttribute("aria-haspopup", "menu"); menu.setAttribute("aria-expanded", "false");
    const add = el("button", "ts-add");
    add.type = "button"; add.id = "mefi-tabs-add";
    add.setAttribute("aria-haspopup", "dialog"); add.setAttribute("aria-expanded", "false"); add.setAttribute("aria-label", "Open a tab"); add.title = "Open a tab (Ctrl+T)";
    add.append(glyph("g-add") || el("span", "", "+"));
    const gap = el("span", "ts-gap");
    const suggest = el("span", "ts-suggest");
    suggest.setAttribute("role", "group"); suggest.setAttribute("aria-label", "Suggestion"); suggest.hidden = true;
    const suggestText = el("span", "ts-suggest-text");
    const suggestPin = el("button", "ts-suggest-pin", "Pin");
    suggestPin.type = "button";
    const suggestNo = el("button", "ts-suggest-no");
    suggestNo.type = "button"; suggestNo.setAttribute("aria-label", "Not now"); suggestNo.title = "Not now";
    suggestNo.append(glyph("g-close") || el("span", "", "×"));
    suggest.append(glyph("g-pin") || el("span", ""), suggestText, suggestPin, suggestNo);
    const cfg = el("button", "ts-cfg");
    cfg.type = "button"; cfg.id = "mefi-tabs-cfg";
    cfg.setAttribute("aria-haspopup", "dialog"); cfg.setAttribute("aria-expanded", "false"); cfg.setAttribute("aria-label", "Tab behaviour"); cfg.title = "Tab behaviour";
    cfg.append(glyph("g-sliders") || el("span", "", "…"));
    const live = el("span", "ts-live");
    live.setAttribute("role", "status"); live.setAttribute("aria-live", "polite");
    root.append(list, more, menu, add, gap, suggest, cfg, live);
    Object.assign(ui, { root, list, more, menu, add, gap, suggest, suggestText, cfg, live });
    list.addEventListener("click", onListClick);
    list.addEventListener("dblclick", onListDouble);
    list.addEventListener("auxclick", onListAux);
    list.addEventListener("mousedown", (event) => { if (event.button === 1) event.preventDefault?.(); });
    list.addEventListener("contextmenu", onListContext);
    list.addEventListener("keydown", onListKey);
    list.addEventListener("focusin", (event) => rove(event.target?.closest?.(".ts-tab")));
    list.addEventListener("focusout", (event) => { if (!list.contains(event.relatedTarget)) restTabStop(); });
    list.addEventListener("pointerdown", onDragStart);
    more.addEventListener("click", () => togglePop("more", more, openMore));
    menu.addEventListener("click", () => togglePop("menu", menu, openMenu));
    add.addEventListener("click", () => togglePop("add", add, openAdd));
    cfg.addEventListener("click", () => togglePop("behaviour", cfg, openBehaviour));
    suggestPin.addEventListener("click", suggestAccept);
    suggestNo.addEventListener("click", suggestDismiss);
  }
  function makeItem(rec) {
    const item = el("div", "ts-item");
    item.setAttribute("role", "presentation");
    const tab = el("button", "ts-tab");
    tab.type = "button"; tab.setAttribute("role", "tab"); tab.id = `mefi-tab-${rec.id}`;
    const icon = el("span", "ts-ico"), title = el("span", "ts-title"), count = el("span", "ts-count"), flag = el("span", "ts-flag");
    flag.setAttribute("aria-hidden", "true");
    tab.append(icon, title, count, flag);
    const close = el("button", "ts-close");
    close.type = "button"; close.tabIndex = -1;
    close.append(glyph("g-close") || el("span", "", "×"));
    item.append(tab, close);
    item.dataset.id = rec.id; tab.dataset.id = rec.id; close.dataset.id = rec.id;
    return { item, tab, icon, title, count, flag, close, sig: "", iconKey: "" };
  }
  function setIcon(entry, info) {
    const key = info.tone ? `dot:${info.tone}` : info.glyph || "";
    if (entry.iconKey === key) return;
    entry.iconKey = key;
    if (info.tone) entry.icon.replaceChildren(dotFor(info.tone));
    else { const svg = info.glyph ? glyph(info.glyph) : null; if (svg) entry.icon.replaceChildren(svg); else entry.icon.replaceChildren(); }
  }
  function paintItem(entry, rec, info, n, total, ctx) {
    const active = rec.id === S.active;
    const count = rec.home ? needCount() : 0;
    const attn = !active && (rec.badge === true || (isSession(rec.route) && S.needs.has(rec.route.params.taskId)));
    const hint = n < 8 ? ` · Ctrl ${n + 1}` : n === total - 1 ? " · Ctrl 9" : "";
    const label = `${info.title}${rec.pin && !rec.home ? ", pinned" : ""}${rec.prev ? ", preview" : ""}${attn ? ", needs you" : ""}`;
    const sig = [info.title, info.tone || info.glyph, active, rec.pin, rec.prev, attn, count, rec.fresh === true, hint, rec.home].join("\u0001");
    if (entry.sig !== sig) {
      entry.sig = sig;
      const { item, tab, title, count: chip, flag, close } = entry;
      title.textContent = rec.pin && !rec.home ? clip(info.title, 10) : info.title;
      chip.textContent = count > 0 ? String(count) : ""; chip.hidden = !(count > 0);
      if (count > 0) chip.title = `${count} need you`;
      flag.hidden = !attn;
      tab.setAttribute("aria-selected", String(active));
      tab.setAttribute("aria-label", label);
      tab.title = `${info.title}${rec.pin && !rec.home ? ", pinned" : ""}${rec.prev ? ", preview: double-click to keep it" : ""}${hint}. Right-click for more.`;
      tab.tabIndex = active ? 0 : -1;
      close.hidden = rec.pin === true;
      close.setAttribute("aria-label", `Close ${info.title}`); close.title = "Close (Ctrl+W, or middle-click)";
      for (const [name, on] of [["pinned", rec.pin], ["preview", rec.prev], ["attn", attn], ["home", rec.home], ["active", active], ["fresh", rec.fresh]]) { if (on) item.dataset[name] = "true"; else delete item.dataset[name]; }
    }
    setIcon(entry, info);
  }
  // The DOM follows the model: each tab's element is kept and updated in place, so focus, hover and a drag in progress survive.
  function renderNow() {
    ui.frame = 0; ui.stale = false;
    if (!S.running || !ui.root) return;
    const ctx = context();
    const all = order();
    const seen = new Set();
    all.forEach((rec, n) => {
      let entry = ui.items.get(rec.id);
      if (!entry) { entry = makeItem(rec); ui.items.set(rec.id, entry); }
      const info = describe(rec, ctx);
      if (!rec.home && info.title && info.title !== rec.title && !info.missing) { rec.title = info.title; S.dirty = true; }
      paintItem(entry, rec, info, n, all.length, ctx);
      seen.add(rec.id);
      const kids = ui.list.children;
      if (kids[n] !== entry.item) ui.list.insertBefore(entry.item, kids[n] || null);
    });
    for (const [id, entry] of [...ui.items]) if (!seen.has(id)) { entry.item.remove(); ui.items.delete(id); }
    paintRest(ctx);
    fit();
    paintPanel();
  }
  function paintRest(ctx) {
    const active = cur();
    const info = describe(active, ctx);
    S.compact = compactNow();
    const menu = ui.menu;
    menu.replaceChildren();
    const icon = el("span", "ts-ico");
    if (info.tone) icon.append(dotFor(info.tone)); else { const svg = info.glyph ? glyph(info.glyph) : null; if (svg) icon.append(svg); }
    menu.append(icon, el("span", "ts-title", info.title), el("span", "ts-count", String(order().length)), glyph("g-chev") || el("span", "", "▾"));
    menu.setAttribute("aria-label", `Tabs, ${order().length} open. Current: ${info.title}`);
    const suggestion = S.suggest && eff().suggest && !S.compact && S.shown && !byKey(S.suggest.key)?.pin ? S.suggest : null;
    ui.suggest.hidden = !suggestion;
    if (suggestion) {
      ui.suggestText.textContent = `Pin ${describe({ route: suggestion.route }, ctx).title}?`;
      if (!S.global.offered[suggestion.key]) { S.global.offered[suggestion.key] = 1; persistSoon(); announce(ui.suggestText.textContent); }
    }
  }
  // Below the contract's fold the strip is one menu button; above it, tabs that do not fit fold into "N more".
  const compactNow = () => { const width = Number(window.innerWidth); return Number.isFinite(width) && width > 0 && width < FOLD_BELOW; };
  function fit() {
    const box = ui.list;
    if (!box) return;
    const entries = [...box.children];
    for (const item of entries) item.hidden = false;
    ui.more.hidden = true; ui.hidden = [];
    if (S.compact || box.scrollWidth <= box.clientWidth + 1) return;
    ui.more.hidden = false;
    const hidden = [];
    for (let i = entries.length - 1; i >= 0 && box.scrollWidth > box.clientWidth + 1; i -= 1) {
      const item = entries[i], rec = byId(item.dataset.id);
      if (!rec || rec.pin || rec.id === S.active) continue;
      item.hidden = true; hidden.unshift(rec.id);
    }
    ui.hidden = hidden;
    ui.more.textContent = `${hidden.length} more`;
    if (!hidden.length) ui.more.hidden = true;
  }
  // One repaint per frame; a hidden window paints nothing and catches up when it is shown again.
  function scheduleRender() {
    if (!S.running || ui.frame) return;
    if (document.hidden || typeof requestAnimationFrame !== "function") { ui.stale = true; return; }
    ui.frame = requestAnimationFrame(renderNow);
  }
  // The tablist is one tab stop: it follows focus while focus is inside, and rests on the selected tab otherwise.
  function rove(tab) {
    if (!tab) return;
    for (const entry of ui.items.values()) entry.tab.tabIndex = entry.tab === tab ? 0 : -1;
  }
  function restTabStop() {
    for (const entry of ui.items.values()) entry.tab.tabIndex = entry.tab.getAttribute("aria-selected") === "true" ? 0 : -1;
  }
  function stripHeight() {
    const value = safe(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--d-tab")), NaN);
    return clamp(Math.round(Number.isFinite(value) && value > 0 ? value : HEIGHT.fallback), HEIGHT.min, HEIGHT.max);
  }
  function sizeRegion() {
    const shell = window.MefiShell;
    if (!shell || typeof shell.resize !== "function") return;
    safe(() => shell.resize("tabs", S.shown ? stripHeight() : 0));
  }
  // The main area is the tab panel for the selected tab, where FRAME has not already given it a role of its own.
  function paintPanel() {
    const shell = window.MefiShell;
    const main = safe(() => shell?.region?.("main"), null);
    if (!main || typeof main.setAttribute !== "function") return;
    const tab = ui.items.get(S.active)?.tab;
    const role = main.getAttribute("role");
    if ((role && role !== "tabpanel") || String(main.tagName).toUpperCase() === "MAIN") return; // it already has a meaning of its own
    if (!main.id) main.id = "mefi-tabpanel";
    main.setAttribute("role", "tabpanel");
    if (tab) main.setAttribute("aria-labelledby", tab.id);
    ui.panel = main;
    for (const entry of ui.items.values()) entry.tab.setAttribute("aria-controls", main.id);
  }

  // ---- gestures on the tabs ---------------------------------------------------------------------------
  const tabOf = (event) => event?.target?.closest?.(".ts-tab") || null;
  const itemOf = (event) => event?.target?.closest?.(".ts-item") || null;
  function onListClick(event) {
    if (S.suppressClick) { S.suppressClick = 0; return; }
    const close = event.target?.closest?.(".ts-close");
    const id = (close || tabOf(event))?.dataset?.id;
    if (!id) return;
    closePop();
    if (close) { closeTab(id); return; }
    activate(id);
  }
  function onListDouble(event) {
    const item = itemOf(event);
    if (item) keep(item.dataset.id);
  }
  function onListAux(event) {
    if (event.button !== 1) return;
    const item = itemOf(event);
    if (!item) return;
    event.preventDefault?.();
    closeTab(item.dataset.id);
  }
  function onListContext(event) {
    const item = itemOf(event);
    if (!item) return;
    event.preventDefault?.();
    openTabMenu(item.dataset.id, item, event);
  }
  function visibleTabs() { return [...ui.list.children].filter((item) => !item.hidden).map((item) => item.querySelector(".ts-tab")).filter(Boolean); }
  function onListKey(event) {
    const tab = tabOf(event);
    if (!tab || event.altKey) return;
    const mod = event.ctrlKey || event.metaKey;
    const tabs = visibleTabs(), at = tabs.indexOf(tab);
    const key = event.key;
    if (mod && event.shiftKey && (key === "ArrowLeft" || key === "ArrowRight")) {
      event.preventDefault(); event.stopPropagation?.();
      const id = tab.dataset.id;
      if (moveBy(id, key === "ArrowRight" ? 1 : -1)) { announce(`Moved ${describe(byId(id), context()).title} to position ${order().indexOf(byId(id)) + 1} of ${order().length}`); queueFocus(id); }
      return;
    }
    if (mod) return;
    if (key === "ArrowRight" || key === "ArrowLeft") { event.preventDefault(); tabs[(at + (key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length]?.focus?.(); }
    else if (key === "Home" || key === "End") { event.preventDefault(); (key === "Home" ? tabs[0] : tabs[tabs.length - 1])?.focus?.(); }
    else if (key === "Enter" || key === " ") { event.preventDefault(); activate(tab.dataset.id); queueFocus(tab.dataset.id); }
    else if (key === "Delete") {
      event.preventDefault();
      const next = tabs[at + 1] || tabs[at - 1];
      const id = tab.dataset.id;
      if (!byId(id)?.home && closeTab(id)) queueFocus(next && byId(next.dataset.id) ? next.dataset.id : null);
    } else if (key === "ContextMenu" || (event.shiftKey && key === "F10")) { event.preventDefault(); openTabMenu(tab.dataset.id, tab.closest(".ts-item") || tab, null); }
  }
  function queueFocus(id) {
    if (!id) return;
    Promise.resolve().then(() => { renderNow(); ui.items.get(id)?.tab.focus?.(); });
  }

  // ---- dragging a tab to a new place ---------------------------------------------------------------------
  // Pointer events on the window while the button is down: a tab moves within its own group (pins, or the rest),
  // a line shows where it will land, Escape puts it back, and the click that ends the drag activates nothing.
  function onDragStart(event) {
    if (event.button !== 0 || event.target?.closest?.(".ts-close")) return;
    const item = itemOf(event);
    if (!item) return;
    const rec = byId(item.dataset.id);
    if (!rec || rec.home) return;
    endDrag();
    S.suppressClick = 0;
    ui.drag = { id: rec.id, item, x: event.clientX, moved: false, slot: null };
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", onDragEnd);
    window.addEventListener("pointercancel", onDragCancel);
    window.addEventListener("keydown", onDragKey, true);
  }
  function dragSlot(x) {
    const rec = byId(ui.drag.id);
    const group = groupOf(rec);
    const mates = group.list.slice(group.from, group.to).filter((other) => other !== rec);
    let slot = 0;
    for (const other of mates) {
      const box = ui.items.get(other.id)?.item.getBoundingClientRect?.();
      if (box && x > box.left + box.width / 2) slot += 1;
    }
    return slot;
  }
  function onDragMove(event) {
    const drag = ui.drag;
    if (!drag) return;
    const dx = event.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 5) return;
    drag.moved = true;
    drag.item.dataset.dragging = "true";
    drag.item.style.translate = `${dx}px 0`;
    drag.slot = dragSlot(event.clientX);
    paintDrop(drag);
  }
  function paintDrop(drag) {
    const rec = byId(drag.id);
    const group = groupOf(rec);
    const mates = group.list.slice(group.from, group.to).filter((other) => other !== rec);
    let marker = ui.list.querySelector?.(".ts-drop");
    if (!marker) { marker = el("span", "ts-drop"); marker.setAttribute("aria-hidden", "true"); ui.list.append(marker); }
    const before = mates[drag.slot], after = mates[drag.slot - 1];
    const listBox = ui.list.getBoundingClientRect?.() || { left: 0 };
    const x = before ? ui.items.get(before.id)?.item.getBoundingClientRect?.().left : after ? ui.items.get(after.id)?.item.getBoundingClientRect?.().right : listBox.left;
    marker.style.left = `${Math.round((x ?? 0) - listBox.left)}px`;
  }
  function endDrag() {
    const drag = ui.drag;
    ui.drag = null;
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", onDragEnd);
    window.removeEventListener("pointercancel", onDragCancel);
    window.removeEventListener("keydown", onDragKey, true);
    if (drag) { delete drag.item.dataset.dragging; drag.item.style.translate = ""; }
    ui.list?.querySelector?.(".ts-drop")?.remove();
    return drag;
  }
  function onDragEnd() {
    const drag = endDrag();
    if (!drag?.moved) return;
    S.suppressClick = 1;
    if (drag.slot !== null && moveTo(drag.id, drag.slot)) announce(`Moved ${describe(byId(drag.id), context()).title} to position ${order().indexOf(byId(drag.id)) + 1} of ${order().length}`);
  }
  function onDragCancel() { endDrag(); }
  function onDragKey(event) { if (event.key === "Escape") { event.preventDefault?.(); event.stopPropagation?.(); endDrag(); } }

  // ---- menus ----------------------------------------------------------------------------------------------
  // One popover at a time, placed beside what opened it (or at the pointer, for a right-click), closed by Escape,
  // a click elsewhere or a change of page, with focus handed back to where it came from.
  function togglePop(kind, anchor, opener) {
    if (ui.pop?.kind === kind) { closePop(true); return; }
    opener(anchor);
  }
  function openPop(kind, anchor, fill, { label, role = "menu", at = null } = {}) {
    closePop();
    const pop = el("div", `ts-pop ts-pop-${kind}`);
    pop.id = `mefi-tabs-pop-${kind}`;
    pop.setAttribute("role", role); pop.setAttribute("aria-label", label);
    document.body.append(pop);
    const opener = anchor?.querySelector?.(".ts-tab") || (String(anchor?.tagName || "").toUpperCase() === "BUTTON" ? anchor : document.activeElement);
    const state = { kind, el: pop, anchor, opener };
    ui.pop = state;
    fill(pop, state);
    placePop(pop, anchor, at);
    if (anchor?.getAttribute?.("aria-haspopup")) anchor.setAttribute("aria-expanded", "true");
    pop.addEventListener("keydown", onPopKey);
    window.addEventListener("pointerdown", onOutside, true);
    window.addEventListener("focusin", onOutside, true);
    safe(() => window.MefiScroll?.scan?.(pop));
    return state;
  }
  function placePop(pop, anchor, at) {
    const area = safe(() => window.MefiNav?.usable?.(), null);
    const box = anchor?.getBoundingClientRect?.();
    const width = Number(window.innerWidth) || 1000, height = Number(window.innerHeight) || 700;
    const popWidth = pop.offsetWidth || 340;
    const x = at ? at.x : box ? box.left : (area?.left ?? 0) + 12;
    const y = at ? at.y : box ? box.bottom + 4 : (area?.top ?? 0) + 4;
    const top = clamp(y, 4, Math.max(4, height - 160));
    pop.style.left = `${Math.round(clamp(x, 8, Math.max(8, width - popWidth - 8)))}px`;
    pop.style.top = `${Math.round(top)}px`;
    pop.style.maxHeight = `${Math.max(160, height - top - 12)}px`;
  }
  function closePop(restore = false) {
    const pop = ui.pop;
    if (!pop) return false;
    ui.pop = null;
    window.removeEventListener("pointerdown", onOutside, true);
    window.removeEventListener("focusin", onOutside, true);
    if (pop.anchor?.getAttribute?.("aria-haspopup")) pop.anchor.setAttribute("aria-expanded", "false");
    const held = pop.el.contains(document.activeElement);
    pop.el.remove();
    if ((restore || held) && pop.opener?.focus && pop.opener.isConnected !== false) pop.opener.focus({ preventScroll: true });
    return true;
  }
  function onOutside(event) {
    const pop = ui.pop;
    if (!pop) return;
    const target = event.target;
    if (pop.el.contains(target) || pop.anchor?.contains?.(target)) return;
    closePop();
  }
  function onPopKey(event) {
    const pop = ui.pop;
    if (!pop) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation?.(); closePop(true); return; }
    if (pop.kind === "add" || event.ctrlKey || event.metaKey || event.altKey) return;
    const items = [...pop.el.querySelectorAll('[role="menuitem"]')].filter((node) => !node.hidden && !node.disabled);
    if (!items.length || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const at = items.indexOf(event.target?.closest?.('[role="menuitem"]') || document.activeElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus?.();
  }
  function menuItem(label, run, { key = "", icon = "", id = "", tone = "" } = {}) {
    const item = el("button", "ts-menuitem");
    item.type = "button"; item.setAttribute("role", "menuitem");
    if (id) item.dataset.act = id;
    const face = tone ? dotFor(tone) : icon ? glyph(icon) : null;
    if (face) item.append(face);
    item.append(el("span", "ts-menulabel", label));
    if (key) item.append(el("kbd", "ts-key", key));
    item.addEventListener("click", () => { closePop(); run(); });
    return item;
  }
  const separator = () => { const line = el("hr", "ts-sep"); line.setAttribute("aria-hidden", "true"); return line; };
  const firstItem = () => ui.pop?.el.querySelector('[role="menuitem"]:not(:disabled)')?.focus?.();
  function openTabMenu(id, anchor, event) {
    const rec = byId(id);
    if (!rec) return;
    const info = describe(rec, context());
    const at = event && Number.isFinite(event.clientX) ? { x: event.clientX, y: event.clientY } : null;
    openPop("tab", anchor, (host) => {
      const all = order(), group = groupOf(rec);
      const inGroup = group.list.indexOf(rec) - group.from, last = group.to - group.from - 1;
      const unpinned = S.tabs.filter((tab) => !tab.pin);
      const others = unpinned.filter((tab) => tab.id !== rec.id);
      const toTheRight = all.slice(all.indexOf(rec) + 1).filter((tab) => !tab.pin);
      const disabled = (item, off) => { item.disabled = off; return item; };
      const items = [];
      if (!rec.home) items.push(menuItem(rec.pin ? "Unpin" : "Pin", () => setPin(rec.id, !rec.pin), { key: "Ctrl Alt P", id: "pin" }));
      if (rec.prev) items.push(menuItem("Keep open", () => keep(rec.id), { key: "Double-click", id: "keep" }));
      if (!rec.home) items.push(disabled(menuItem("Move left", () => moveBy(rec.id, -1), { id: "left" }), inGroup <= 0), disabled(menuItem("Move right", () => moveBy(rec.id, 1), { id: "right" }), inGroup >= last), separator(), menuItem("Close", () => closeTab(rec.id), { key: "Ctrl W", id: "close" }));
      items.push(
        disabled(menuItem("Close other tabs", () => { const n = closeMany(others.map((tab) => tab.id), rec.id); if (n) { activate(rec.id); toast(`Closed ${plural(n, "other tab")}. Pinned tabs stay. Ctrl Shift T brings one back.`, { duration: 3600 }); } }, { id: "others" }), !others.length),
        disabled(menuItem("Close tabs to the right", () => closeMany(toTheRight.map((tab) => tab.id), rec.id), { id: "to-the-right" }), !toTheRight.length),
        disabled(menuItem("Close all but pinned", () => { const n = closeMany(unpinned.map((tab) => tab.id)); toast(`Closed ${plural(n, "tab")}. Pinned tabs stay. Ctrl Shift T brings one back.`, { duration: 3600 }); }, { id: "all" }), !unpinned.length),
        separator(), menuItem("Reopen a closed tab", () => restore(0), { key: "Ctrl Shift T", id: "reopen" }), menuItem("Tab behaviour", () => openBehaviour(ui.cfg), { id: "behaviour" }),
      );
      host.append(...items);
    }, { label: `Tab: ${info.title}`, at });
    firstItem();
  }
  function openMore(anchor) {
    const ctx = context();
    openPop("more", anchor, (host) => {
      for (const id of ui.hidden) {
        const rec = byId(id);
        if (!rec) continue;
        const info = describe(rec, ctx);
        const item = menuItem(info.title, () => activate(rec.id), { icon: info.glyph || "", tone: info.tone || "" });
        item.dataset.id = rec.id;
        host.append(item);
      }
    }, { label: "More tabs" });
    firstItem();
  }
  // The small-window strip: one menu with every tab in it.
  function openMenu(anchor) {
    const ctx = context();
    openPop("menu", anchor, (host) => {
      host.append(el("div", "ts-group", `${plural(order().length, "tab")}${S.tabs.some((rec) => rec.prev) ? " · the italic one is a preview" : ""}`));
      for (const rec of order()) {
        const info = describe(rec, ctx);
        const row = el("div", "ts-menurow");
        const go = menuItem(info.title, () => activate(rec.id), { icon: info.glyph || "", tone: info.tone || "" });
        go.dataset.id = rec.id;
        if (rec.id === S.active) go.setAttribute("aria-current", "true");
        if (rec.prev) go.dataset.preview = "true";
        row.append(go);
        if (!rec.pin) {
          const close = el("button", "ts-close");
          close.type = "button"; close.setAttribute("aria-label", `Close ${info.title}`); close.dataset.id = rec.id;
          close.append(glyph("g-close") || el("span", "", "×"));
          close.addEventListener("click", () => { closeTab(rec.id); closePop(true); });
          row.append(close);
        }
        host.append(row);
      }
      host.append(separator(), menuItem("Open a tab", () => openAdd(ui.add), { key: "Ctrl T", icon: "g-add", id: "add" }), menuItem("Reopen a closed tab", () => restore(0), { key: "Ctrl Shift T", id: "reopen" }), menuItem("Tab behaviour", () => openBehaviour(ui.cfg), { icon: "g-sliders", id: "behaviour" }));
    }, { label: "Tabs" });
    firstItem();
  }

  // The Add menu: every place in the registry, this project's sessions and what was closed, one search box.
  function destinations() {
    const nav = window.MefiNav;
    const all = safe(() => nav?.list?.(), []) || [];
    const rows = [];
    for (const dest of all) {
      if (!dest || typeof dest.id !== "string" || dest.id === "workspace" || dest.id === "vibe") continue;
      if (dest.kind === "action" || dest.layer === "transient" || safe(() => dest.hidden?.(), false)) continue;
      if (!dest.showIn || !(dest.showIn.tabs || dest.showIn.palette || dest.showIn.tools || dest.showIn.dock)) continue;
      const route = place(dest.id, {});
      if (!route) continue;
      const group = safe(() => nav.sectionLabel?.(dest), null) || "Pages";
      rows.push({ group, rank: safe(() => nav.sectionRank?.(dest), 99) ?? 99, route, title: words(dest.short || dest.label, 40), terms: `${dest.label || ""} ${dest.searchTerms || ""} ${dest.desc || ""}`, glyph: dest.glyph });
    }
    return rows.sort((a, b) => a.rank - b.rank);
  }
  function sessionRows(query) {
    const data = snapshot();
    const tasks = Array.isArray(data?.tasks) ? data.tasks.filter((task) => task?.id && !task.archived && task.status !== "archived") : [];
    const stamp = (task) => Number(task.updatedAt || task.createdAt) || Date.parse(task.updatedAt || task.createdAt || "") || 0;
    return tasks.sort((a, b) => stamp(b) - stamp(a)).slice(0, query ? 40 : 8).map((task) => ({ group: "Sessions", route: sessionRoute(task.id, data.projectId), title: taskTitle(task) || "Untitled task", terms: `${task.title || ""} ${task.prompt || ""}`, tone: readingOf(task, data) }));
  }
  function addRows(query) {
    const q = words(query, 60).toLowerCase().split(" ").filter(Boolean);
    const match = (row) => q.every((word) => `${row.title} ${row.group} ${row.terms || ""}`.toLowerCase().includes(word));
    const ctx = context();
    const closed = q.length ? [] : validClosed().slice(0, 4).map((item) => { const info = describe({ route: item.route, title: item.title }, ctx); return { group: "Recently closed", route: item.route, title: item.title || info.title, glyph: info.glyph, tone: info.tone, closed: item, hint: "Reopen" }; });
    const home = { group: "Home", route: { id: "workspace", params: {} }, title: homeTitle(), glyph: "g-home", terms: "home today vibe front door" };
    const rows = [...closed, ...[home, ...sessionRows(query), ...destinations()].filter(match)];
    const have = new Map(order().map((rec) => [keyOf(rec.route), rec]));
    for (const row of rows) { const rec = have.get(keyOf(row.route)); if (!row.hint) row.hint = rec ? (rec.pin ? "Pinned" : "Open") : ""; }
    return rows;
  }
  function openAdd(anchor) {
    const view = { query: "", index: 0, items: [], box: null, rows: null };
    const state = openPop("add", anchor, (host) => {
      const head = el("div", "ts-searchrow");
      const box = el("input", "ts-search");
      box.type = "text"; box.id = "mefi-tabs-search"; box.placeholder = "Open a page or a session"; box.autocomplete = "off"; box.spellcheck = false;
      box.setAttribute("role", "combobox"); box.setAttribute("aria-label", "Find a page or a session"); box.setAttribute("aria-expanded", "true"); box.setAttribute("aria-controls", "mefi-tabs-rows"); box.setAttribute("aria-autocomplete", "list");
      head.append(glyph("g-search") || el("span", ""), box);
      const rows = el("div", "ts-rows");
      rows.id = "mefi-tabs-rows"; rows.setAttribute("role", "listbox"); rows.setAttribute("aria-label", "Places");
      const foot = el("div", "ts-foot");
      for (const [keys, what] of [["Enter", "open"], ["Shift+Enter", "open and pin"], ["Esc", "close"]]) { const hint = el("span", "ts-hint"); hint.append(el("kbd", "ts-key", keys), el("span", "", ` ${what}`)); foot.append(hint); }
      host.append(head, rows, foot);
      Object.assign(view, { box, rows });
    }, { label: "Open a tab", role: "dialog" });
    const choose = (index, pin) => {
      const row = view.items[index];
      if (!row) return;
      closePop();
      if (row.closed) restore(row.closed);
      else open(row.route.id, row.route.params, { preview: false, pin: Boolean(pin) });
    };
    const paint = () => {
      view.items = addRows(view.query);
      view.index = Math.min(view.index, Math.max(0, view.items.length - 1));
      view.rows.replaceChildren();
      let last = "";
      view.items.forEach((row, i) => {
        if (row.group !== last) { view.rows.append(el("div", "ts-group", row.group)); last = row.group; }
        const option = el("button", "ts-row");
        option.type = "button"; option.id = `mefi-tabs-row-${i}`; option.tabIndex = -1;
        option.setAttribute("role", "option"); option.setAttribute("aria-selected", String(i === view.index));
        if (row.tone) option.append(dotFor(row.tone)); else { const face = row.glyph ? glyph(row.glyph) : null; if (face) option.append(face); }
        option.append(el("span", "ts-rowlabel", row.title), el("span", "ts-rowhint", row.hint || ""));
        option.addEventListener("click", (event) => choose(i, event.shiftKey));
        view.rows.append(option);
      });
      if (!view.items.length) { const empty = el("div", "ts-empty"); empty.append(el("b", "", "Nothing matches"), el("span", "", "Try a page or a session name.")); view.rows.append(empty); }
      view.box.setAttribute("aria-activedescendant", view.items.length ? `mefi-tabs-row-${view.index}` : "");
      view.rows.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
    };
    view.box.addEventListener("input", () => { view.query = view.box.value; view.index = 0; paint(); });
    view.box.addEventListener("keydown", (event) => {
      const n = view.items.length;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); view.index = (view.index + (event.key === "ArrowDown" ? 1 : -1) + Math.max(1, n)) % Math.max(1, n); paint(); }
      else if (event.key === "Enter") { event.preventDefault(); choose(view.index, event.shiftKey); }
    });
    paint();
    view.box.focus?.({ preventScroll: true });
    state.view = view;
  }
  const toggleAdd = () => togglePop("add", ui.add || null, openAdd);

  // ---- the pin suggestion ---------------------------------------------------------------------------------
  function suggestAccept() {
    const route = S.suggest?.route;
    S.suggest = null;
    if (route) {
      let rec = byKey(keyOf(route));
      if (!rec) { rec = makeRecord(route); S.tabs.push(rec); pinFirst(); }
      setPin(rec.id, true);
    } else changed("suggest");
  }
  function suggestDismiss() { S.suggest = null; changed("suggest"); }

  // ---- keys -------------------------------------------------------------------------------------------------
  // Ctrl+T add, Ctrl+W close, Ctrl+Tab and Ctrl+Shift+Tab (or Ctrl+PageDown and PageUp) cycle, Ctrl+1 to 9 jump, Ctrl+Shift+T reopen,
  // Ctrl+Alt+P pin, and Alt+W and Alt+Shift+T for Close and Reopen where no text is being typed. Alt+Left and Right stay Back and
  // Forward within a section (nav.js has them). The window's own Ctrl+W (Close) is given up here: a keydown the page handles is not
  // offered to the menu. Nothing is taken while Search, Configuration or another dialog is up, or from a field that needs the key.
  function onKey(event) {
    if (!S.running || event.isComposing) return;
    const nav = window.MefiNav;
    if (nav?.state?.transient) return;
    if (safe(() => window.MefiCompanionHub?.isOpen?.(), false)) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = String(event.key || ""), code = String(event.code || "");
    const letter = key.length === 1 ? key.toLowerCase() : code.startsWith("Key") ? code.slice(3).toLowerCase() : "";
    const digit = /^[1-9]$/.test(key) ? Number(key) : /^Digit[1-9]$/.test(code) ? Number(code.slice(5)) : 0;
    const typing = isTyping(event.target);
    let handled = false;
    const once = (fn) => { handled = true; if (!event.repeat) fn(); };
    if (mod && !event.altKey && !event.shiftKey && letter === "t") once(toggleAdd);
    else if (event.shiftKey && letter === "t" && ((mod && !event.altKey) || (event.altKey && !mod && !typing))) once(() => { closePop(); restore(0); });
    else if (!event.shiftKey && letter === "w" && ((mod && !event.altKey) || (event.altKey && !mod && !typing))) once(() => { closePop(); closeActive(); });
    else if (mod && !event.altKey && key === "Tab") { handled = true; closePop(); cycle(event.shiftKey ? -1 : 1); }
    else if (mod && !event.altKey && !event.shiftKey && (key === "PageDown" || key === "PageUp")) { handled = true; closePop(); cycle(key === "PageDown" ? 1 : -1); }
    else if (mod && !event.altKey && !event.shiftKey && digit) once(() => { closePop(); jump(digit); });
    else if (mod && event.altKey && !event.shiftKey && letter === "p" && !typing) once(() => setPin(S.active, !cur().pin));
    if (handled) { event.preventDefault?.(); event.stopPropagation?.(); }
  }
  // Typing on a page keeps its preview tab, and so does a double-click in the session list.
  function onInput(event) {
    const target = event.target;
    if (event.isTrusted === false) return; // the app replaying a draft into a field is not you typing
    if (!target || !isTyping(target) || target.closest?.(".ts-pop, .ts-strip, #palette-overlay, #config-overlay, #help-overlay, #walkthrough-overlay, #app-rail, #app-local-nav")) return;
    if (cur().prev) keep(S.active);
  }
  function onDouble(event) {
    const list = safe(() => window.MefiShell?.region?.("list"), null);
    if (list?.contains?.(event.target) && cur().prev) keep(S.active);
  }

  // ---- Tab behaviour: one card, used in Configuration and in the strip's own menu ------------------------------
  // A row of mutually exclusive choices, as a radio group.
  function choices(label, key, options, value, onPick, disabled) {
    const group = el("div", "ts-choices");
    group.setAttribute("role", "radiogroup"); group.setAttribute("aria-label", label);
    for (const [id, text] of options) {
      const choice = el("button", "ts-choice", text);
      choice.type = "button"; choice.setAttribute("role", "radio"); choice.setAttribute("aria-checked", String(String(value) === String(id))); choice.dataset.value = String(id); choice.dataset.key = `${key}:${id}`;
      choice.disabled = Boolean(disabled);
      choice.addEventListener("click", () => onPick(id));
      group.append(choice);
    }
    return group;
  }
  // The app's own switch (styles.css .switch) with a line of what it does.
  function switchRow(label, detail, key, checked, onChange, disabled) {
    const row = el("label", "switch ts-switch");
    const input = el("input");
    input.type = "checkbox"; input.checked = Boolean(checked); input.disabled = Boolean(disabled); input.setAttribute("role", "switch"); input.dataset.key = key;
    input.addEventListener("change", () => onChange(input.checked));
    const text = el("span", "ts-setting-words");
    text.append(el("b", "", label), el("small", "", detail));
    row.append(input, el("span", "track"), text);
    return row;
  }
  const AGENT_NOTES = Object.freeze({ badge: "Its tab, if one is open, gets a badge. Nothing opens.", bg: "A tab opens in the background with a badge. You stay where you are.", focus: "Studio opens the session and takes you to it." });
  // The card for Configuration › UI & Surfaces and for the strip's own menu. It redraws when a switch changes or
  // something closes, and puts keyboard focus back on the control that had it.
  function card() {
    const box = el("section", "ts-card");
    box.setAttribute("aria-label", "Tab behaviour");
    let shown = "";
    const paint = () => {
      const p = S.prefs, off = !p.manage || S.forcedOff;
      const closed = validClosed().slice(0, 4);
      const signature = JSON.stringify([p, S.forcedOff, closed.map((item) => item.title || keyOf(item.route))]);
      if (signature === shown) return;
      shown = signature;
      const held = box.contains(document.activeElement) ? document.activeElement.dataset?.key : null;
      box.replaceChildren();
      const head = el("header", "ts-card-head");
      head.append(el("h4", "", "Tab behaviour"), el("p", "", "Studio keeps your tabs tidy. Pinned tabs never close by themselves, and everything Studio closes can be reopened."));
      const body = el("div", "ts-card-body");
      body.dataset.off = String(off);
      const agent = el("div", "ts-setting");
      agent.append(el("b", "", "When an agent needs me"), el("small", "", AGENT_NOTES[p.agent]), choices("When an agent needs me", "agent", [["badge", "Badge only"], ["bg", "Background tab"], ["focus", "Open and focus"]], p.agent, (id) => setPrefs({ agent: id }), off));
      const idle = el("div", "ts-setting");
      idle.append(el("b", "", "Close tabs of finished work after"), el("small", "", "Only sessions that are done and that you have not opened for that long."), choices("Close finished sessions after", "idle", [[0, "Never"], [10, "10 min"], [30, "30 min"], [60, "1 hour"]], p.idle, (id) => setPrefs({ idle: Number(id) }), off));
      const cap = el("div", "ts-setting ts-setting-row");
      const capWords = el("span", "ts-setting-words");
      capWords.append(
        el("b", "", p.cap ? `Keep at most ${p.cap} tabs open` : "Keep as many tabs open as you like"),
        el("small", "", p.cap ? "Pinned tabs do not count. When there are more, the one you used longest ago closes, with Undo." : "No tab is closed to make room. Past the top of the range, here, is no limit; step back down to set one."),
      );
      const stepper = el("span", "ts-stepper");
      const less = el("button", "ts-step", "−"), more = el("button", "ts-step", "+");
      // 3 to 12, and one step past 12 is no limit (0): the plus goes there, the minus comes back to 12
      less.type = "button"; less.setAttribute("aria-label", "Fewer tabs"); less.dataset.key = "cap:-"; less.disabled = off || (p.cap !== 0 && p.cap <= CAP_RANGE[0]);
      more.type = "button"; more.setAttribute("aria-label", p.cap === CAP_RANGE[1] ? "No limit" : "More tabs"); more.dataset.key = "cap:+"; more.disabled = off || p.cap === 0;
      less.addEventListener("click", () => setPrefs({ cap: S.prefs.cap === 0 ? CAP_RANGE[1] : S.prefs.cap - 1 }));
      more.addEventListener("click", () => setPrefs({ cap: S.prefs.cap >= CAP_RANGE[1] ? 0 : S.prefs.cap + 1 }));
      stepper.append(less, el("output", "ts-stepvalue", p.cap ? String(p.cap) : "No limit"), more);
      cap.append(capWords, stepper);
      body.append(
        switchRow("Preview tab", "A single click opens a page in one italic tab that the next click reuses. Typing, pinning or a double-click keeps it.", "preview", p.preview, (on) => setPrefs({ preview: on }), off),
        agent, idle, cap,
        switchRow("Suggest pins", "After you open the same page three times, a quiet chip offers to pin it. Each page is asked about once.", "suggest", p.suggest, (on) => setPrefs({ suggest: on }), off),
      );
      const recent = el("div", "ts-closed");
      recent.append(el("b", "", "Recently closed"));
      if (!closed.length) recent.append(el("p", "ts-note", "Nothing closed yet."));
      closed.forEach((item, i) => {
        const row = el("div", "ts-closedrow");
        const again = el("button", "ts-reopen", "Reopen");
        again.type = "button"; again.dataset.key = `reopen:${i}`; again.addEventListener("click", () => { const now2 = validClosed()[i]; if (now2) restore(now2); });
        row.append(el("span", "ts-closedlabel", item.title || describe({ route: item.route }, context()).title), again);
        recent.append(row);
      });
      const keys = el("p", "ts-keys");
      for (const [combo, what] of [["Ctrl T", "open a tab"], ["Ctrl W", "close"], ["Ctrl Tab", "next"], ["Ctrl 1–9", "jump"], ["Ctrl Alt P", "pin"], ["Ctrl Shift T", "reopen"]]) { const item = el("span", "ts-keyline"); item.append(el("kbd", "ts-key", combo), el("span", "", ` ${what}`)); keys.append(item); }
      box.append(head, switchRow("Let Studio manage my tabs", S.forcedOff ? "Turned off for this run (MEFI_STUDIO_NO_TAB_MANAGER). Every tab stays until you close it." : "Off keeps a plain strip: no preview tab, no closing, no suggestions.", "manage", p.manage && !S.forcedOff, (on) => setPrefs({ manage: on }), S.forcedOff), body, recent, keys, el("p", "ts-note", "Middle-click also closes a tab. Drag a tab to move it, or focus it and press Ctrl Shift ← or →."));
      if (held) box.querySelector(`[data-key="${held}"]`)?.focus?.({ preventScroll: true });
    };
    paint();
    // Every change repaints the cards that are on a page. One that was made and never attached (a pane that was thrown
    // away) or that has left the page is let go, so a long session does not collect them.
    const item = { box, paint, ready: false };
    for (const other of [...S.cards]) if (other.ready && other.box.isConnected === false) S.cards.delete(other);
    S.cards.add(item);
    Promise.resolve().then(() => { item.ready = true; if (box.isConnected === false) S.cards.delete(item); });
    return box;
  }
  function repaintCards() {
    for (const item of [...S.cards]) {
      if (item.ready && item.box.isConnected === false) S.cards.delete(item);
      else safe(item.paint);
    }
  }
  function openBehaviour(anchor) {
    openPop("behaviour", anchor || ui.cfg, (host) => host.append(card()), { label: "Tab behaviour", role: "dialog" });
    ui.pop?.el.querySelector("input, button")?.focus?.();
  }
  // What Configuration › UI & Surfaces shows: null unless the strip is running.
  function configCard() { return S.running ? card() : null; }

  // ---- start and stop ---------------------------------------------------------------------------------------------
  function mount() {
    const shell = window.MefiShell;
    const handle = typeof shell.mount === "function" ? safe(() => shell.mount("tabs", "tabs", ui.root, { title: "Tabs", order: 0 }), null) : null;
    if (!ui.root.parentNode) {
      const region = safe(() => shell.region?.("tabs"), null);
      if (!region) return false;
      region.append(ui.root);
    }
    ui.handle = isObject(handle) ? handle : null;
    return true;
  }
  function start() {
    if (S.running) return true;
    if (!v2()) return false;
    const shell = window.MefiShell;
    if (!shell || typeof shell !== "object") return false;
    if (typeof shell.active === "function" && !safe(() => shell.active(), false)) return false;
    if (typeof shell.mount !== "function" && !safe(() => shell.region?.("tabs"), null)) return false;
    S.prefs = sanitizePrefs(read(KEYS.prefs));
    S.global = loadGlobal();
    S.seq = S.global.seq; delete S.global.seq;
    S.project = projectId() || "none";
    S.lastSeen = {}; S.needs = new Set(); S.needsKnown = null; S.suggest = null; S.going = null; S.shown = true; S.compact = compactNow();
    adoptSet(loadSet(S.project));
    if (!ui.root) build();
    if (!mount()) return false;
    S.running = true;
    sizeRegion();
    watch();
    askHost();
    registerSettingsRecord();
    refreshNeeds();
    scheduleRender();
    queueSync();
    planSweep();
    // The launch screen holds the first look back; look again when it lets go.
    safe(() => Promise.resolve(window.MefiBoot?.ready?.()).then(queueSync, queueSync));
    return true;
  }
  function stop() {
    if (!S.running) return false;
    flushPersist();
    S.running = false;
    closePop();
    endDrag();
    unwatch();
    for (const timer of [S.persistTimer, S.sweepTimer]) if (timer) safe(() => clearTimeout(timer));
    S.persistTimer = 0; S.sweepTimer = 0;
    if (ui.frame && typeof cancelAnimationFrame === "function") safe(() => cancelAnimationFrame(ui.frame));
    ui.frame = 0;
    safe(() => ui.handle?.unmount?.());
    ui.root?.remove?.();
    if (ui.panel) { ui.panel.removeAttribute?.("role"); ui.panel.removeAttribute?.("aria-labelledby"); ui.panel = null; }
    for (const entry of ui.items.values()) entry.tab.removeAttribute?.("aria-controls");
    ui.items.clear(); ui.list?.replaceChildren?.();
    S.cards.clear();
    safe(() => window.MefiShell?.resize?.("tabs", 0));
    return true;
  }
  function watch() {
    if (watching) return;
    watching = true;
    listen(window, "mefi:nav", onNav);
    listen(window, "mefi:model-view", queueSync);
    listen(window, "mefi:shell", queueSync);
    listen(window, "mefi:project-changed", onProject);
    listen(window, "mefi:workspace-state", () => { refreshNeeds(); queueSync(); planSweep(); });
    listen(window, "mefi:appearance", () => { sizeRegion(); scheduleRender(); });
    listen(window, "mefi:shell-layout", onShellLayout);
    listen(window, "mefi:layout", onShellLayout);
    listen(window, "resize", () => { S.compact = compactNow(); scheduleRender(); });
    listen(window, "keydown", onKey, true);
    listen(window, "pagehide", flushPersist);
    listen(document, "input", onInput, true);
    listen(document, "dblclick", onDouble, true);
    listen(document, "visibilitychange", () => { if (document.hidden) flushPersist(); else { if (ui.stale) scheduleRender(); queueSync(); sweep(); } });
    if (typeof MutationObserver === "function" && document.body) {
      ui.observer = new MutationObserver(queueSync);
      ui.observer.observe(document.body, { attributes: true, attributeFilter: ["class", "data-sheet"] });
    }
    if (typeof ResizeObserver === "function" && ui.root) {
      // Fitting waits for the next frame, so the observer never resizes what it is watching in the same pass.
      ui.resizeObserver = new ResizeObserver(() => { if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => fit()); });
      ui.resizeObserver.observe(ui.root);
    }
    const today = window.MefiToday;
    if (today && typeof today.onChange === "function") ui.todayOff = safe(() => today.onChange(() => scheduleRender()), null);
  }
  function unwatch() {
    if (!watching) return;
    watching = false;
    for (const [target, type, handler, options] of listening.splice(0)) target.removeEventListener(type, handler, options);
    safe(() => ui.observer?.disconnect()); ui.observer = null;
    safe(() => ui.resizeObserver?.disconnect()); ui.resizeObserver = null;
    if (typeof ui.todayOff === "function") safe(ui.todayOff);
    ui.todayOff = null;
  }
  // FRAME's Layout menu may switch the strip off; it stays in the model and the keys keep working.
  function onShellLayout() {
    const size = safe(() => window.MefiShell?.size?.("tabs"), null);
    if (Number.isFinite(size)) S.shown = size > 0;
    scheduleRender();
  }
  // The one thing the host decides: MEFI_STUDIO_NO_TAB_MANAGER=1 turns all management off for this run.
  function askHost() {
    const ask = window.mefiStudio?.prefsGet;
    if (typeof ask !== "function") return;
    safe(() => Promise.resolve(ask()).then((result) => {
      if (!S.running) return;
      const off = result?.prefs?.tabsManage === false;
      if (off === S.forcedOff) return;
      S.forcedOff = off;
      if (off) { S.suggest = null; for (const rec of S.tabs) rec.prev = false; }
      changed("host");
    }).catch(() => {}));
  }
  // Search and Configuration find the card by its words.
  function registerSettingsRecord() {
    safe(() => window.MefiNav?.register?.({
      id: "tabBehaviour", label: "Tab behaviour", short: "Tab behaviour", kind: "action", layer: null, section: "settings", group: "tools", key: null, glyph: "g-sliders", badge: null,
      desc: "Preview tab, what an agent that needs you does, closing finished work, how many tabs stay open, pin suggestions",
      searchTerms: "tabs tab strip pin pinned preview close idle agent needs you recently closed", showIn: { palette: true },
      run: () => { if (S.running && ui.cfg && S.shown && !S.compact) openBehaviour(ui.cfg); else window.MefiConfig?.open?.({ category: "ui" }); },
    }));
  }

  // ---- what the rest of the app sees --------------------------------------------------------------------------------
  function snapshotOf(rec, ctx = context()) {
    const info = describe(rec, ctx);
    return { id: rec.id, route: copy(rec.route), title: info.title, pin: rec.pin === true, prev: rec.prev === true, active: rec.id === S.active, home: rec.home === true, badge: rec.badge === true || (isSession(rec.route) && S.needs.has(rec.route.params.taskId)), scope: scopeOf(rec.route) };
  }
  function list() {
    if (!S.running) return [];
    const ctx = context();
    return order().map((rec) => snapshotOf(rec, ctx));
  }
  function needs(routeId, params = {}, on = true) {
    if (!S.running) return false;
    const route = place(routeId, params);
    if (!route) return false;
    if (on === false) { const rec = byKey(keyOf(route)); if (rec) { rec.badge = false; scheduleRender(); } return true; }
    return onNeeds(route);
  }
  // nav.js calls this from saveResume() just before a reload: what is pending is written now, and a small record says where the strip was.
  function saveState() {
    if (!S.running) return null;
    flushPersist();
    return { v: VERSION, project: S.project, active: S.active, count: order().length };
  }
  function flush() {
    if (!S.running) return false;
    if (ui.frame) { if (typeof cancelAnimationFrame === "function") safe(() => cancelAnimationFrame(ui.frame)); ui.frame = 0; }
    renderNow();
    flushPersist();
    return true;
  }
  function onChange(callback) {
    if (typeof callback !== "function") return () => {};
    S.listeners.add(callback);
    return () => S.listeners.delete(callback);
  }
  function reader(id, read2) {
    if (typeof id !== "string" || !id) return () => {};
    if (typeof read2 === "function") S.readers.set(id === "vibe" ? "workspace" : id, read2); else S.readers.delete(id);
    return () => S.readers.delete(id);
  }
  // Build's own view of Home (a task, the chat, or the new-task page) when its sessions layout is the one showing.
  S.readers.set("workspace", () => {
    const builder = window.MefiBuilder;
    if (!builder || !safe(() => builder.active?.(), false)) return null;
    const view = safe(() => builder.view?.(), null);
    return view && view.view ? { view: view.view, taskId: view.taskId, projectId: projectId() } : null;
  });
  // The agents page is one sheet with sections: which one is open is the page's own to say.
  S.readers.set("agents", () => safe(() => window.MefiAgents?.params?.(), null));
  function show(on = true) {
    S.shown = on !== false;
    if (ui.root) ui.root.hidden = !S.shown;
    safe(() => (S.shown ? ui.handle?.show?.() : ui.handle?.hide?.()));
    sizeRegion();
    scheduleRender();
    return S.shown;
  }

  window.MefiTabs = {
    version: VERSION, KEYS,
    open, close: closeTab, pin: setPin, list, recentlyClosed, restore, onChange,
    active: () => (S.running ? S.active : null), activate, move: moveTo, keep, needs, cycle, jump,
    prefs: () => ({ ...S.prefs, forcedOff: S.forcedOff }), setPrefs, configCard,
    saveState, flush, sweep, reader, start, stop, show, hide: () => show(false), visible: () => S.running && S.shown,
    running: () => S.running, openAddMenu: () => { if (S.running) toggleAdd(); }, openBehaviour: () => { if (S.running) openBehaviour(ui.cfg); },
  };

  function boot() {
    const shell = window.MefiShell;
    if (!v2() || !shell) return;
    if (typeof shell.active === "function" && !safe(() => shell.active(), false)) return; // the shell says layout v2 is not on
    // FRAME may still be drawing its regions when this script starts: look once more after the page's other starters have run.
    if (!start() && typeof setTimeout === "function") setTimeout(() => { start(); }, 0);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
