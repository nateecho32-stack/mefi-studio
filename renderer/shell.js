// The 0.5 shell's frame ("layout v2", docs/unified-studio.md, "The frame").
// html[data-layout="v2"] (renderer/nav.js) gives the window room for four
// regions; this module draws them and the bar above the page: a top bar (list
// toggle, the Vibe | Build switch, where you are, Search, what needs you and
// what is working, inspector toggle), the list column, the inspector column,
// the tab strip's row, the status bar, and `main`, the free area other modules
// mount a page into. Vibe and Build are the modes of one shell: each keeps its
// own list and inspector (open or closed, and how wide), and switching swaps
// them. Below 900 CSS px the contract folds the two columns; here they become
// drawers over the page, and a window too narrow to dock the inspector beside
// the list gets the same. A column's width is changed by its splitter (drag,
// arrow keys, double-click) and only through MefiNav.layout.set.
//
// The bar's middle is a breadcrumb, project / session or page, as the 0.5
// prototype has it: the classic local navigation (Back, Forward and the
// section's pages) is not drawn in the frame. Its pages are a page list in the
// list column instead, on every page of a section that has them (Work, Agents,
// Settings), with Back and Forward within the section and the Git chip; Home
// keeps its session list there. An inspector whose panels all say they have
// nothing to show (a page that is not a session) folds away and takes no room.
//
// With v2 off nothing here is drawn, listens, polls or stores. The one thing
// this file always does is the way in: a Search action and a Settings switch
// that turn the layout on or off and reload the way builder.js's layout switch
// does (they need nothing of the frame). The frame itself is built at launch
// when v2 is on (or by MefiShell.enable()) and removed when v2 goes off.
//
// window.MefiShell: active, enable, disable, region, mode, setMode, size,
// resize, info, open, close, toggle, isOpen, mount, onChange, openInbox,
// resetLayout, layout, status, sync, pages, onInbox (a hook), plan, and the
// constants LIMITS, DEFAULTS, REGIONS, MODES and PRESETS. It emits
// `mefi:shell-layout` on window when a region opens, closes, is resized or
// becomes a drawer, when the mode changes, when the page list comes or goes
// and when the frame comes or goes.
(function () {
  "use strict";
  const SVG_NS = "http://www.w3.org/2000/svg";
  const PREFS_KEY = "mefiStudio.shell.layout.v1";
  const REGIONS = Object.freeze(["top", "tabs", "list", "inspector", "status", "main"]);
  const MODES = Object.freeze(["vibe", "build"]);
  // A column's width while it is open: the splitter's limits. The main area
  // never gets less than MAIN_MIN CSS px (MefiNav.layout.MAIN_MIN says the same).
  const LIMITS = Object.freeze({ list: Object.freeze([220, 420]), inspector: Object.freeze([320, 640]) });
  const DEFAULTS = Object.freeze({ list: 280, inspector: 388, status: 28 });
  const MAIN_MIN = 320;
  const KEY_STEP = 8;
  const KEY_STEP_BIG = 32;
  // What each mode starts with, and what Reset layout returns to. Build is the
  // in-depth mode: list and inspector open. Vibe is the calm one: both closed.
  const PRESETS = Object.freeze({
    build: Object.freeze({ list: Object.freeze({ open: true, w: DEFAULTS.list }), inspector: Object.freeze({ open: true, w: DEFAULTS.inspector }), tabs: Object.freeze({ open: true }) }),
    vibe: Object.freeze({ list: Object.freeze({ open: false, w: DEFAULTS.list }), inspector: Object.freeze({ open: false, w: DEFAULTS.inspector }), tabs: Object.freeze({ open: true }) }),
  });

  // ---- small helpers ------------------------------------------------------------------
  const nav = () => window.MefiNav;
  const finite = (value) => typeof value === "number" && Number.isFinite(value);
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const rootEl = () => document.documentElement;
  // A real element sets a custom property through style.setProperty; a stand-in's style may be a plain object.
  const setVar = (node, name, value) => { if (typeof node?.style?.setProperty === "function") node.style.setProperty(name, value); else if (node?.style) node.style[name] = value; };
  const dropVar = (node, name) => { if (typeof node?.style?.removeProperty === "function") node.style.removeProperty(name); else if (node?.style) delete node.style[name]; };
  const isElement = (value) => Boolean(value) && typeof value === "object" && typeof value.tagName === "string";
  const typing = (target) => Boolean(target?.closest?.("input, textarea, select, [contenteditable]"));
  function el(tag, className, attributes) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    for (const [name, value] of Object.entries(attributes || {})) node.setAttribute(name, String(value));
    return node;
  }
  function text(tag, className, value) {
    const node = el(tag, className);
    node.textContent = String(value ?? "");
    return node;
  }
  function button(className, label, run, attributes) {
    const node = el("button", className, { type: "button", ...attributes });
    node.type = "button";
    if (label) node.setAttribute("aria-label", label);
    if (run) node.addEventListener("click", run);
    return node;
  }
  // The glyphs the sprite in the template already draws are used as they are; the rest are drawn here.
  const SPRITE = Object.freeze({ spark: "g-spark", build: "g-wrench", search: "g-search", bell: "g-bell", audio: "g-audio", worktree: "g-worktree" });
  const PANEL = "M3.25 3h9.5A1.25 1.25 0 0 1 14 4.25v7.5A1.25 1.25 0 0 1 12.75 13h-9.5A1.25 1.25 0 0 1 2 11.75v-7.5A1.25 1.25 0 0 1 3.25 3z";
  const PATHS = Object.freeze({
    panelL: [PANEL, "M6.25 3v10"],
    panelR: [PANEL, "M9.75 3v10"],
    layout: [PANEL, "M6.25 3v10", "M2 6.5h12"],
    pause: ["M5.75 3.75v8.5", "M10.25 3.75v8.5"],
    play: ["M5 3.5v9l7.5-4.5z"],
    back: ["M9.75 3.5 5.25 8l4.5 4.5"],
    forward: ["M6.25 3.5 10.75 8l-4.5 4.5"],
    shield:["M8 2.25 3.25 4v3.6c0 2.9 2 5 4.75 6.15 2.75-1.15 4.75-3.25 4.75-6.15V4z"],
  });
  function icon(name) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "glyph");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    if (SPRITE[name]) {
      const use = document.createElementNS(SVG_NS, "use");
      use.setAttribute("href", `#${SPRITE[name]}`);
      svg.append(use);
      return svg;
    }
    svg.setAttribute("viewBox", "0 0 16 16");
    for (const d of PATHS[name] || []) {
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", d);
      svg.append(path);
    }
    return svg;
  }
  const readStore = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
  const writeStore = (key, value) => { try { localStorage.setItem(key, value); return true; } catch { return false; } };

  // ---- preferences: each mode's list, inspector and tab strip ------------------------------
  // { v: 1, build: { list: { open, w }, inspector: { open, w }, tabs: { open } }, vibe: {...} } in
  // localStorage; anything missing or out of range falls back to the mode's preset.
  function normalizePrefs(raw) {
    const out = {};
    for (const mode of MODES) {
      const preset = PRESETS[mode];
      const saved = raw && typeof raw === "object" && raw[mode] && typeof raw[mode] === "object" ? raw[mode] : {};
      const column = (name) => {
        const found = saved[name] && typeof saved[name] === "object" ? saved[name] : {};
        return {
          open: typeof found.open === "boolean" ? found.open : preset[name].open,
          w: finite(found.w) ? clamp(Math.round(found.w), LIMITS[name][0], LIMITS[name][1]) : preset[name].w,
        };
      };
      out[mode] = { list: column("list"), inspector: column("inspector"), tabs: { open: typeof saved.tabs?.open === "boolean" ? saved.tabs.open : preset.tabs.open } };
    }
    return out;
  }
  function loadPrefs() {
    try {
      const raw = readStore(PREFS_KEY);
      return normalizePrefs(raw ? JSON.parse(raw) : null);
    } catch { return normalizePrefs(null); }
  }

  // ---- the plan: what docks, what is a drawer ---------------------------------------------
  // From the window, the rail and what a mode asked for. The list docks while it is open
  // and the window is not folded. The inspector docks while it is open, the window is not
  // folded and, after the rail and the list, the main area keeps MAIN_MIN and the inspector
  // gets at least its own minimum; otherwise it is a drawer, which only its toggle opens.
  function computePlan({ width, rail, prefs, fold = [], mainMin = MAIN_MIN }) {
    const folded = new Set(fold);
    const list = { drawer: folded.has("list"), docked: false, width: 0, max: LIMITS.list[1] };
    list.max = clamp(width - rail - mainMin, LIMITS.list[0], LIMITS.list[1]);
    list.docked = !list.drawer && prefs.list.open;
    list.width = list.docked ? clamp(prefs.list.w, LIMITS.list[0], list.max) : 0;
    const inspector = { drawer: false, docked: false, width: 0, max: LIMITS.inspector[1] };
    const room = width - rail - list.width - mainMin;
    inspector.drawer = folded.has("inspector") || room < LIMITS.inspector[0];
    inspector.max = clamp(room, LIMITS.inspector[0], LIMITS.inspector[1]);
    inspector.docked = !inspector.drawer && prefs.inspector.open;
    inspector.width = inspector.docked ? clamp(prefs.inspector.w, LIMITS.inspector[0], inspector.max) : 0;
    return { list, inspector };
  }
  const planKey = (plan) => JSON.stringify(["list", "inspector"].map((name) => [plan[name].docked, plan[name].drawer, plan[name].width]));

  // ---- state -----------------------------------------------------------------------------
  const state = {
    on: false,            // the regions are built
    wanted: false,        // the frame was asked for (launch, or enable()) and only a v2-off ends that
    armed: false,         // start() has run
    mode: "build",
    prefs: normalizePrefs(null),
    plan: null,
    planKey: "",
    drawer: null,         // "list" | "inspector" | null: the drawer that is open
    returnFocus: null,
    tabsWanted: 0,        // the strip's height, as the tabs module asked for it
    statusWanted: DEFAULTS.status,
    requested: {},        // what was last asked of MefiNav.layout.set, per region
    els: {},
    stacks: {},
    top: null,
    pages: null,          // the page list's nodes, and what it last drew
    vacant: false,        // the inspector's panels all say there is nothing to show on this page
    statusParts: null,
    splits: null,
    menu: null,
    panels: new Map(),
    serial: 0,
    listeners: new Set(),
    live: null,
    liveKey: "",
    wired: false,
    keyRows: false,
    actionRows: false,
    observers: [],
    timer: 0,
    stale: false,         // a change came while the window was hidden
    todayWatched: false,  // MefiToday.onChange has been subscribed to
    machine: null,        // the machine's load as the last machine:status push said it (machineOf)
  };
  let applying = 0;

  // ---- what the window gives -------------------------------------------------------------
  const cssNumber = (name) => {
    try {
      const value = parseFloat(getComputedStyle(rootEl()).getPropertyValue(name));
      return Number.isFinite(value) ? value : null;
    } catch { return null; }
  };
  const boxShown = (id) => {
    const box = document.getElementById?.(id)?.getBoundingClientRect?.();
    return Boolean(box && box.width > 0 && box.height > 0);
  };
  // The rail that is on screen at rest: Build's, Vibe's, or none (Vibe's own Home has no rail).
  function railWidth() {
    if (!["app-rail", "vibe-rail"].some(boxShown)) return 0;
    return cssNumber("--shell-rail-w") ?? (rootEl().dataset?.railPinned !== undefined ? 256 : 64);
  }
  const railShell = () => rootEl()?.dataset?.shell === "rail";
  const layoutOn = () => Boolean(nav()?.layout?.on?.());
  const foldNames = () => { try { return nav()?.layout?.fold?.() ?? []; } catch { return []; } };
  const mainMin = () => (finite(nav()?.layout?.MAIN_MIN) ? nav().layout.MAIN_MIN : MAIN_MIN);
  const viewWidth = () => Number(window.innerWidth) || Number(rootEl()?.clientWidth) || 0;
  const currentMode = () => {
    const vibe = window.MefiVibe?.mode?.();
    if (vibe === "vibe" || vibe === "build") return vibe;
    return rootEl()?.dataset?.uiMode === "vibe" ? "vibe" : "build";
  };
  const modeWords = (mode) => (mode === "vibe" ? "Vibe" : "Build");
  const isColumn = (name) => name === "list" || name === "inspector";

  // ---- the regions: the DOM ---------------------------------------------------------------
  // One wrapper (display: contents) right after the rail, so the chrome comes before the page
  // in the tab order; every region is position: fixed and takes its place from the contract's
  // variables (renderer/shell.css).
  function buildRegions() {
    if (state.els.frame) return;
    // A frame left by an earlier run of this script (a page that loads it twice) is replaced, not doubled.
    document.getElementById?.("shell-frame")?.remove?.();
    const frame = el("div", "shell-frame");
    frame.id = "shell-frame";
    const region = (tag, id, className, attributes) => {
      const node = el(tag, `shell-region ${className}`, attributes);
      node.id = id;
      return node;
    };
    const stack = (host) => { const node = el("div", "shell-stack"); host.append(node); return node; };
    const list = region("aside", "shell-list", "shell-column shell-list", { "aria-label": "List", "data-region": "list", tabindex: "-1" });
    const inspector = region("aside", "shell-inspector", "shell-column shell-inspector", { "aria-label": "Inspector", "data-region": "inspector", tabindex: "-1" });
    const top = region("div", "shell-top", "shell-top", { role: "group", "aria-label": "Studio bar", "data-region": "top" });
    const tabs = region("div", "shell-tabs", "shell-tabs", { "data-region": "tabs" });
    const status = region("div", "shell-status", "shell-status", { role: "group", "aria-label": "Status bar", "data-region": "status" });
    const main = region("div", "shell-main", "shell-main", { "data-region": "main" });
    const scrim = el("div", "shell-scrim", { "aria-hidden": "true" });
    scrim.id = "shell-scrim";
    scrim.hidden = true;
    scrim.addEventListener("pointerdown", (event) => { event.preventDefault?.(); closeDrawer(true); });
    state.stacks = {};
    for (const [name, column] of [["list", list], ["inspector", inspector]]) {
      column.dataset.empty = "true";
      const empty = el("div", "shell-empty");
      empty.append(text("b", "", name === "list" ? "Nothing listed yet" : "Nothing to inspect yet"), text("span", "", name === "list" ? "This fills in when the page you are on has things to list." : "Select something to see its details here."));
      column.append(empty);
      // The list column also holds the section's page list, before the panels it makes way for.
      if (name === "list") column.append(buildPages());
      state.stacks[name] = stack(column);
      column.hidden = true;
    }
    tabs.hidden = true;
    main.hidden = true;
    state.stacks.tabs = stack(tabs);
    state.stacks.main = stack(main);
    state.els = { frame, top, tabs, list, inspector, status, main, scrim };
    buildTop(top);
    buildStatus(status);
    // The scrim first, so a drawer (same layer) paints over it.
    frame.append(scrim, list, top, tabs, main, inspector, status);
    buildSplitters(frame);
    const rail = document.getElementById?.("app-rail");
    if (rail?.parentNode && typeof rail.parentNode.insertBefore === "function") rail.parentNode.insertBefore(frame, rail.nextSibling || null);
    else document.body.append(frame);
  }
  function removeRegions() {
    state.menu = null;
    state.pages = null;
    state.els.frame?.remove?.();
    state.els = {};
    state.stacks = {};
    // A mounted panel keeps its content for the next time the frame is built.
    for (const panel of state.panels.values()) panel.wrapper = null;
  }

  // ---- panels: mount() -------------------------------------------------------------------
  function noHandle() { return { show() {}, hide() {}, unmount() {}, get shown() { return false; }, get element() { return null; } }; }
  function mount(regionName, key, source, options = {}) {
    if (!REGIONS.includes(regionName) || typeof key !== "string" || !key || (typeof source !== "function" && !isElement(source))) return noHandle();
    const id = `${regionName}\u0000${key}`;
    const previous = state.panels.get(id);
    if (previous) dropPanel(previous);
    const order = finite(options?.order) ? options.order : 100;
    const panel = { id, region: regionName, key, title: String(options?.title ?? "").slice(0, 120), order, serial: ++state.serial, source, shown: true, wrapper: null, content: null, gone: false };
    state.panels.set(id, panel);
    place(regionName);
    emit({ what: "panel", region: regionName, key, shown: true });
    return {
      show: () => setPanelShown(panel, true),
      hide: () => setPanelShown(panel, false),
      unmount: () => { if (panel.gone) return; dropPanel(panel); place(regionName); emit({ what: "panel", region: regionName, key, shown: false, removed: true }); },
      get shown() { return !panel.gone && panel.shown; },
      get element() { return panel.content; },
    };
  }
  function dropPanel(panel) {
    panel.gone = true;
    state.panels.delete(panel.id);
    panel.wrapper?.remove?.();
    panel.wrapper = null;
  }
  function setPanelShown(panel, shown) {
    if (panel.gone || panel.shown === shown) return;
    panel.shown = shown;
    if (panel.wrapper) panel.wrapper.hidden = !shown;
    place(panel.region);
    emit({ what: "panel", region: panel.region, key: panel.key, shown });
  }
  // Draws a region's panels in order; a factory runs once, the first time the region is there to hold it.
  function place(regionName) {
    const host = state.stacks[regionName];
    if (!host) return;
    const panels = [...state.panels.values()].filter((panel) => panel.region === regionName).sort((a, b) => a.order - b.order || a.serial - b.serial);
    for (const panel of panels) {
      if (panel.wrapper) continue;
      const wrapper = el("section", "shell-panel", { "data-key": panel.key });
      if (panel.title) wrapper.setAttribute("aria-label", panel.title);
      wrapper.hidden = !panel.shown;
      panel.wrapper = wrapper;
      if (panel.content == null) {
        let made = panel.source;
        if (typeof made === "function") {
          try { made = made({ region: regionName, key: panel.key, host: wrapper }); } catch { made = null; }
        }
        panel.content = isElement(made) ? made : null;
      }
      if (isElement(panel.content)) wrapper.append(panel.content);
    }
    const wanted = panels.map((panel) => panel.wrapper);
    const current = Array.from(host.children).filter((child) => wanted.includes(child));
    if (current.length !== wanted.length || current.some((child, at) => child !== wanted[at])) for (const wrapper of wanted) host.append(wrapper);
    const anyShown = panels.some((panel) => panel.shown);
    const node = state.els[regionName];
    if (!node) return;
    if (isColumn(regionName)) node.dataset.empty = String(!anyShown);
    if (regionName === "main") node.hidden = !anyShown;
    // An inspector whose panels all say there is nothing to show here (a page that is not a session) folds away: no room, no
    // "Nothing to inspect yet". With nothing mounted at all the frame cannot know, and keeps the column and its note.
    if (regionName === "inspector") {
      const vacant = panels.length > 0 && !anyShown;
      if (vacant !== state.vacant) {
        state.vacant = vacant;
        if (state.on && state.plan && !applying) { apply(); state.planKey = planKey(state.plan); paintBars(); emit({ what: "resize", region: "inspector", reason: vacant ? "vacant" : "filled" }); }
      }
    }
  }

  // ---- the contract: asking MefiNav.layout for room -----------------------------------------
  // Only a change from what this module last asked for is sent, and a column the window has
  // folded is left to the contract (what was asked for is kept there and comes back with the window).
  function request(name, pixels) {
    if (state.requested[name] === pixels) return;
    state.requested[name] = pixels;
    try { nav()?.layout?.set?.(name, pixels); } catch { /* the contract is absent or refused */ }
  }
  function apply() {
    if (!state.on || !state.els.frame) return;
    applying += 1;
    try {
      const prefs = state.prefs[state.mode];
      const fold = foldNames();
      const plan = computePlan({ width: viewWidth(), rail: railWidth(), prefs, fold, mainMin: mainMin() });
      // A vacant inspector takes no room and is no drawer; what the mode asked for is kept and comes back with a panel that shows.
      if (state.vacant) plan.inspector = { ...plan.inspector, docked: false, drawer: false, width: 0, vacant: true };
      state.plan = plan;
      const folded = new Set(fold);
      const want = { list: plan.list.width, inspector: plan.inspector.width, tabs: prefs.tabs.open ? state.tabsWanted : 0, status: state.statusWanted };
      for (const name of ["list", "inspector", "tabs", "status"]) if (!folded.has(name)) request(name, want[name]);
      if (state.drawer && !plan[state.drawer].drawer) { state.drawer = null; state.returnFocus = null; }
      paint();
    } finally { applying -= 1; }
  }
  // Something changed in the window or the contract; repaint, and say so when a region moved.
  function sync(reason = "sync") {
    if (!state.on) return false;
    const mode = currentMode();
    if (mode !== state.mode) {
      state.mode = mode;
      state.drawer = null;
      state.returnFocus = null;
      closeMenu(false);
      apply();
      state.planKey = planKey(state.plan);
      paintBars();
      emit({ what: "mode", mode });
      return true;
    }
    apply();
    const key = planKey(state.plan);
    const moved = key !== state.planKey;
    state.planKey = key;
    paintBars();
    if (moved) emit({ what: "resize", reason });
    return moved;
  }

  // ---- painting -----------------------------------------------------------------------------
  function paint() {
    const { els, plan } = state;
    if (!els.frame || !plan) return;
    const prefs = state.prefs[state.mode];
    for (const name of ["list", "inspector"]) {
      const node = els[name], one = plan[name];
      const shown = one.docked ? "docked" : one.drawer && state.drawer === name ? "drawer" : "closed";
      node.dataset.state = shown;
      node.hidden = shown === "closed";
      if (shown === "drawer") {
        const room = viewWidth() - (name === "list" ? railWidth() + 36 : 24);
        setVar(node, "--frame-drawer-w", `${Math.round(Math.max(200, Math.min(prefs[name].w, room)))}px`);
      } else dropVar(node, "--frame-drawer-w");
    }
    els.tabs.hidden = !(state.tabsWanted > 0 && prefs.tabs.open);
    els.status.hidden = state.statusWanted <= 0;
    els.scrim.hidden = !state.drawer;
    els.frame.dataset.drawer = state.drawer || "";
    rootEl().dataset.frame = "on";
    paintSplitters();
    paintToggles();
    paintMenu();
  }
  function paintBars() {
    paintMode();
    paintLive();
  }

  // ---- open, close, resize --------------------------------------------------------------------
  function isOpen(name) {
    if (!state.on) return false;
    if (name === "tabs") return Boolean(state.prefs[state.mode].tabs.open);
    if (isColumn(name)) {
      const one = state.plan?.[name];
      return one ? (one.drawer ? state.drawer === name : one.docked) : false;
    }
    return name === "top" || name === "status" || name === "main" ? Boolean(state.els[name]) && !state.els[name].hidden : false;
  }
  function setOpen(name, wanted) {
    if (!state.on) return false;
    wanted = Boolean(wanted);
    if (name === "tabs") {
      if (state.prefs[state.mode].tabs.open === wanted) return wanted;
      state.prefs[state.mode].tabs.open = wanted;
      savePrefs(); apply(); emit({ what: wanted ? "open" : "close", region: name });
      return wanted;
    }
    if (!isColumn(name)) return false;
    if (!state.plan) apply();
    // Nothing to inspect on this page: the saved choice is left as it is for the pages that have something.
    if (name === "inspector" && state.vacant) return false;
    if (state.plan[name].drawer) {
      if (wanted) return openDrawer(name);
      closeDrawer(true);
      return false;
    }
    if (state.prefs[state.mode][name].open === wanted) return wanted;
    state.prefs[state.mode][name].open = wanted;
    savePrefs(); apply(); state.planKey = planKey(state.plan); paintBars();
    emit({ what: wanted ? "open" : "close", region: name, size: state.plan[name].width });
    return wanted;
  }
  const open = (name) => setOpen(name, true);
  const close = (name) => setOpen(name, false);
  const toggle = (name) => setOpen(name, !isOpen(name));
  // Sets a column's width (remembered per mode) or, for the strip and the status bar, their
  // height. Answers with the room the region takes from the window.
  function resize(name, pixels) {
    if (!finite(pixels)) return size(name);
    if (isColumn(name)) {
      if (!state.on) return 0;
      if (!state.plan) apply();
      const one = state.plan[name];
      const high = one.docked ? Math.max(LIMITS[name][0], Math.min(one.max, LIMITS[name][1])) : LIMITS[name][1];
      const next = Math.round(clamp(pixels, LIMITS[name][0], high));
      if (state.prefs[state.mode][name].w === next) return size(name);
      state.prefs[state.mode][name].w = next;
      savePrefs(); apply(); state.planKey = planKey(state.plan);
      emit({ what: "resize", region: name, size: size(name) });
      return size(name);
    }
    if (name === "tabs" || name === "status") {
      const next = Math.round(clamp(pixels, 0, name === "tabs" ? 48 : 40));
      const key = name === "tabs" ? "tabsWanted" : "statusWanted";
      if (state[key] === next) return size(name);
      state[key] = next;
      if (state.on) { apply(); paintBars(); emit({ what: "resize", region: name, size: size(name) }); }
      return size(name);
    }
    return size(name);
  }
  // The room a region takes from the window right now (0 for a column that is closed, folded or a drawer).
  function size(name) {
    if (!state.on) return 0;
    const used = (region) => { try { return Number(nav()?.layout?.used?.(region)) || 0; } catch { return 0; } };
    if (name === "list" || name === "inspector" || name === "tabs" || name === "status") return used(name);
    if (name === "top") return state.els.top ? Math.round(state.els.top.getBoundingClientRect?.().height || 0) : 0;
    if (name === "main") { try { return Math.round(nav()?.usable?.()?.width || 0); } catch { return 0; } }
    return 0;
  }
  function info(name) {
    if (!state.on || !REGIONS.includes(name)) return null;
    const one = isColumn(name) ? state.plan?.[name] : null;
    const prefs = state.prefs[state.mode];
    return {
      region: name,
      open: isOpen(name),
      docked: one ? one.docked : isOpen(name),
      drawer: one ? one.drawer : false,
      drawerOpen: state.drawer === name,
      vacant: name === "inspector" && state.vacant,
      size: size(name),
      width: isColumn(name) ? prefs[name].w : null,
      min: isColumn(name) ? LIMITS[name][0] : null,
      max: one ? one.max : null,
      panels: [...state.panels.values()].filter((panel) => panel.region === name).map((panel) => ({ key: panel.key, title: panel.title, order: panel.order, shown: panel.shown })),
    };
  }
  function savePrefs() { writeStore(PREFS_KEY, JSON.stringify({ v: 1, ...state.prefs })); }
  function resetLayout({ undo = true, quiet = false } = {}) {
    if (!state.on) return false;
    const mode = state.mode, before = clone(state.prefs[mode]);
    state.prefs[mode] = clone(PRESETS[mode]);
    state.drawer = null; state.returnFocus = null;
    savePrefs(); apply(); state.planKey = planKey(state.plan); paintBars();
    emit({ what: "resize", region: "list", reason: "reset" });
    if (!quiet) {
      const preset = PRESETS[mode];
      const words = `Layout reset for ${modeWords(mode)}: list ${preset.list.open ? `${preset.list.w} px` : "closed"}, inspector ${preset.inspector.open ? `${preset.inspector.w} px` : "closed"}.`;
      const undoIt = () => {
        if (!state.on || state.mode !== mode) return;
        state.prefs[mode] = before;
        savePrefs(); apply(); state.planKey = planKey(state.plan); paintBars();
        emit({ what: "resize", region: "list", reason: "undo" });
      };
      window.MefiToast?.(words, "info", undo ? { action: { label: "Undo", run: undoIt } } : {});
    }
    return true;
  }

  // ---- events -----------------------------------------------------------------------------------
  function emit(detail) {
    const full = { mode: state.mode, drawer: state.drawer, ...detail };
    for (const listener of [...state.listeners]) { try { listener(full); } catch { /* one listener must not stop the others */ } }
    if (detail.what === "panel") return;
    try { window.dispatchEvent(new CustomEvent("mefi:shell-layout", { detail: full })); } catch { /* no events here */ }
  }
  function onChange(callback) {
    if (typeof callback !== "function") return () => {};
    state.listeners.add(callback);
    return () => state.listeners.delete(callback);
  }

  // ---- drawers: a column over the page in a small window ------------------------------------------
  const FOCUSABLE = "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex=\"-1\"])";
  // The first control in a region that can really take focus: a mounted panel that is hidden (the session inspector while no session
  // is open) keeps its controls in the page, and focus() on one of those does nothing, so a drawer would open with focus left behind.
  function takesFocus(node, host) {
    for (let walk = node; walk && walk !== host; walk = walk.parentNode) if (walk.hidden === true) return false;
    return (node.getClientRects?.().length ?? 1) > 0;
  }
  function focusInto(host) {
    const found = host?.querySelectorAll?.(FOCUSABLE);
    const target = (found ? [...found].find((node) => takesFocus(node, host)) : null) || host;
    try { target?.focus?.({ preventScroll: true }); } catch { /* not focusable here */ }
  }
  function openDrawer(name) {
    if (!state.on || !state.plan?.[name]?.drawer) return false;
    if (state.drawer === name) return true;
    // Focus goes back to what had it before a drawer or the menu took it: going from one to the other keeps that.
    const active = document.activeElement;
    const leaving = state.drawer ? state.els[state.drawer] : null;
    const back = leaving?.contains?.(active) ? state.returnFocus : state.menu?.node?.contains?.(active) ? state.menu.returnTo : active && active !== document.body ? active : null;
    closeMenu(false);
    state.returnFocus = back;
    state.drawer = name;
    paint();
    focusInto(state.els[name]);
    emit({ what: "drawer", region: name, open: true });
    return true;
  }
  function closeDrawer(restore = true) {
    const name = state.drawer;
    if (!name) return false;
    state.drawer = null;
    if (state.on) paint();
    const back = state.returnFocus;
    state.returnFocus = null;
    if (restore && back && back.isConnected !== false) { try { back.focus?.({ preventScroll: true }); } catch { /* gone */ } }
    emit({ what: "drawer", region: name, open: false });
    return true;
  }

  // ---- the top bar -------------------------------------------------------------------------------
  function buildTop(bar) {
    const parts = { modes: {} };
    parts.left = el("div", "shell-top-left");
    parts.listToggle = button("shell-btn shell-icon-btn", "List", () => toggle("list"), { "aria-controls": "shell-list", "aria-pressed": "false" });
    parts.listToggle.id = "shell-list-toggle";
    parts.listToggle.append(icon("panelL"));
    // The app's own mode switch look (vibe.css); the click and the keys are this module's.
    parts.group = el("div", "mode-switch shell-mode", { role: "radiogroup", "aria-label": "Studio mode", "data-mode": "build" });
    parts.group.append(el("i", "mode-thumb", { "aria-hidden": "true" }));
    for (const mode of MODES) {
      const choice = button("shell-mode-choice", null, (event) => { event?.stopPropagation?.(); event?.preventDefault?.(); setMode(mode); }, { role: "radio", "aria-checked": "false", "data-ui-mode": mode });
      choice.setAttribute("aria-label", modeWords(mode));
      choice.setAttribute("title", mode === "vibe" ? "Vibe: a calm board that is easy to keep an eye on (Ctrl M)" : "Build: list, thread and inspector, in depth (Ctrl M)");
      choice.append(icon(mode === "vibe" ? "spark" : "build"), text("span", "", modeWords(mode)));
      choice.addEventListener("keydown", (event) => modeKeys(event, mode));
      parts.group.append(choice);
      parts.modes[mode] = choice;
    }
    parts.left.append(parts.listToggle, parts.group);
    parts.trail = el("nav", "shell-trail", { "aria-label": "Where you are" });
    parts.extra = el("div", "shell-top-extra");
    parts.right = el("div", "shell-top-right");
    parts.search = button("shell-btn shell-search", "Search or run a command (Ctrl K)", () => openSearch());
    parts.search.id = "shell-search";
    parts.search.append(icon("search"), text("span", "shell-search-long", "Search or run a command"), text("span", "shell-search-short", "Search"), text("kbd", "", "Ctrl K"));
    parts.need = button("shell-btn shell-pill shell-need", "All clear. Open the inbox", () => openInbox(parts.need), { "aria-haspopup": "true" });
    parts.need.id = "shell-need";
    parts.needN = text("b", "shell-pill-n", "");
    parts.needL = text("span", "shell-pill-l", "All clear");
    parts.need.append(el("i", "shell-dot", { "aria-hidden": "true" }), el("span", "shell-pill-text"));
    parts.need.children[1].append(parts.needN, parts.needL);
    parts.svc = el("div", "shell-pill shell-svc", { role: "group", "aria-label": "Agents" });
    parts.svc.id = "shell-svc";
    parts.svcDot = el("i", "shell-dot", { "aria-hidden": "true" });
    parts.svcN = text("b", "shell-pill-n", "");
    parts.svcText = text("span", "shell-pill-l", "Idle");
    parts.svcButton = button("shell-btn shell-pill-btn", "Pause new work", () => togglePause());
    parts.svcButton.id = "shell-pause";
    parts.svcButton.append(icon("pause"));
    parts.svc.append(parts.svcDot, el("span", "shell-pill-text"), parts.svcButton);
    parts.svc.children[1].append(parts.svcN, parts.svcText);
    parts.inspectorToggle = button("shell-btn shell-icon-btn", "Inspector", () => toggle("inspector"), { "aria-controls": "shell-inspector", "aria-pressed": "false" });
    parts.inspectorToggle.id = "shell-inspector-toggle";
    parts.inspectorToggle.append(icon("panelR"));
    parts.right.append(parts.search, parts.need, parts.svc, parts.inspectorToggle);
    bar.append(parts.left, parts.trail, parts.extra, parts.right);
    state.top = parts;
    state.stacks.top = parts.extra;
  }
  function modeKeys(event, mode) {
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const target = event.key === "Home" ? "vibe" : event.key === "End" ? "build" : mode === "vibe" ? "build" : "vibe";
    event.preventDefault?.(); event.stopPropagation?.();
    if (target !== mode) setMode(target);
    state.top?.modes?.[target]?.focus?.();
  }
  function openSearch() {
    const n = nav();
    if (!n) return;
    if (n.get?.("palette")?.isOpen?.()) { n.toggle?.("palette"); return; }
    n.go?.("palette");
  }
  // The mode is MefiVibe's (no new value): setMode there saves it, repaints every switch and,
  // from a mode's Home, goes to the other mode's Home; from any other page the page stays.
  function isHome() {
    const id = nav()?.current?.();
    return id == null || id === "workspace" || id === "vibe";
  }
  function setMode(next) {
    if (!MODES.includes(next)) return currentMode();
    if (currentMode() !== next) window.MefiVibe?.setMode?.(next, { go: isHome() });
    sync("mode");
    return currentMode();
  }
  function paintMode() {
    const parts = state.top;
    if (!parts) return;
    const current = currentMode();
    parts.group.dataset.mode = current;
    for (const choice of MODES) {
      parts.modes[choice].setAttribute("aria-checked", String(choice === current));
      parts.modes[choice].tabIndex = choice === current ? 0 : -1;
    }
  }
  function paintToggles() {
    const parts = state.top, plan = state.plan;
    if (!parts || !plan) return;
    for (const [name, node, key] of [["list", parts.listToggle, "Ctrl B"], ["inspector", parts.inspectorToggle, "["]]) {
      const on = isOpen(name);
      const vacant = name === "inspector" && state.vacant;
      node.setAttribute("aria-pressed", String(on));
      node.setAttribute("title", vacant ? "Nothing to inspect on this page: the inspector comes back on a session" : `${on ? "Hide" : "Show"} the ${name} (${key})${plan[name].drawer ? ". It opens over the page in a window this small" : ""}`);
      node.dataset.on = String(on);
      node.disabled = vacant;
    }
  }

  // ---- where you are: project / session or page ----------------------------------------------------
  // The prototype's breadcrumb. On Home: the project and the session on screen (Today when none is). Anywhere else: the
  // project, the section and the page, and on the Task board the task it has selected, which opens it (the classic bar's
  // "Current task"). Each part is what MefiNav, Home and the session panels already know.
  const isHomeRoute = (id) => id == null || id === "workspace" || id === "vibe";
  function sessionTitle(snapshot) {
    const sessions = window.MefiSessions;
    if (!sessions?.active?.()) return null;
    const taskId = sessions.selected?.();
    const task = taskId && Array.isArray(snapshot?.tasks) ? snapshot.tasks.find((row) => row?.id === taskId) : null;
    if (!task) return null;
    return String(task.title || window.MefiTasks?.shortTitle?.(task) || "Untitled task");
  }
  function trail() {
    const n = nav();
    const parts = [];
    const snapshot = window.MefiWorkspace?.snapshot?.() ?? null;
    const project = String(snapshot?.project?.name ?? "").trim();
    if (project) parts.push(project);
    const id = n?.current?.();
    const dest = id ? n?.get?.(id) : null;
    if (isHomeRoute(id)) {
      const session = sessionTitle(snapshot);
      const built = !session && window.MefiBuilder?.view?.()?.view === "task" ? n?.taskContext?.() : null;
      // Build's classic Home is Today's "chat" view (renderer/today.js): the tab strip and the trail both call it Chat.
      const chat = window.MefiToday?.homeView?.() === "chat" && rootEl().dataset.uiMode !== "vibe";
      if (session || built?.title) parts.push(String(session || built.title));
      // Vibe's Today is the board: the prototype's breadcrumb says so.
      else parts.push(window.MefiToday ? (chat ? "Chat" : rootEl().dataset.uiMode === "vibe" ? "Today, the board" : "Today") : String(dest?.label || dest?.short || "Home"));
      return parts;
    }
    let section = null;
    try { section = dest ? n?.sectionLabel?.(dest) ?? null : null; } catch { section = null; }
    const page = dest ? String(dest.label || dest.short || id) : null;
    if (section && section !== page) parts.push(String(section));
    if (page) parts.push(page);
    const task = id === "tasks" ? n?.taskContext?.() : null;
    if (task?.title) parts.push({ label: String(task.title), open: () => n?.go?.("tasks", { taskId: task.taskId, projectId: task.projectId }) });
    return parts;
  }
  function paintTrail(parts) {
    const host = state.top?.trail;
    if (!host) return;
    host.replaceChildren();
    parts.forEach((part, at) => {
      const label = typeof part === "string" ? part : String(part?.label ?? "");
      if (at) host.append(text("span", "shell-sep", "/"));
      const last = at === parts.length - 1;
      const className = last ? "shell-crumb is-current" : "shell-crumb";
      const crumb = typeof part?.open === "function" ? button(`shell-btn ${className} shell-crumb-link`, null, () => part.open()) : el("span", className);
      crumb.textContent = label;
      if (last) crumb.setAttribute("aria-current", "page");
      crumb.setAttribute("title", typeof part?.open === "function" ? `${label} · open it` : label);
      host.append(crumb);
    });
  }

  // ---- the page list: the section's pages, in the list column ----------------------------------------
  // What the classic bar listed between Back and Forward: the routes MefiNav keeps for the section (LOCAL_ROUTES), or for
  // Agents its sections and their views (MefiAgents.navModel, so a pane or a tab is reachable as before). Home has none:
  // its list is the session list. While the page list shows, the column's panels make way (html[data-pages] on the column)
  // and MefiShell.pages() says so, so the session list does not draw for nobody.
  function sectionOfRoute(n, id) {
    const routes = n?.LOCAL_ROUTES;
    if (!routes || typeof routes !== "object") return null;
    const listed = Object.keys(routes).find((key) => Array.isArray(routes[key]) && routes[key].includes(id));
    if (listed) return listed;
    const said = document.body?.dataset?.navSection;
    return said && Array.isArray(routes[said]) ? said : null;
  }
  function pageModel() {
    const n = nav();
    const id = n?.current?.() ?? null;
    if (isHomeRoute(id)) return null;
    const section = sectionOfRoute(n, id);
    if (!section || section === "home") return null;
    const dest = n?.get?.(id);
    let title = null;
    try { title = dest ? n?.sectionLabel?.(dest) ?? null : null; } catch { title = null; }
    title = String(title || section.charAt(0).toUpperCase() + section.slice(1));
    if (section === "agents" && typeof window.MefiAgents?.navModel === "function") {
      let groups = null;
      try { groups = window.MefiAgents.navModel(id); } catch { groups = null; }
      if (Array.isArray(groups) && groups.length) return { section, title, groups: groups.map((group) => ({ id: String(group.id), label: String(group.label), current: Boolean(group.current), run: group.run, views: (Array.isArray(group.views) ? group.views : []).map((view) => ({ label: String(view.label), current: Boolean(view.current), run: view.run })) })) };
    }
    const pages = (n.LOCAL_ROUTES[section] || []).map((route) => n.get?.(route)).filter(Boolean).map((page) => ({
      id: String(page.id), label: String(page.short || page.label || page.id), glyph: typeof page.glyph === "string" ? page.glyph : null,
      badge: typeof page.badge === "string" ? page.badge : null, alert: typeof page.alert === "string" ? page.alert : null, current: page.id === id,
    }));
    return pages.length ? { section, title, pages } : null;
  }
  function buildPages() {
    const root = el("nav", "shell-pages", { "aria-label": "Pages" });
    root.id = "shell-pages";
    root.hidden = true;
    const head = el("div", "shell-pages-head");
    const title = text("h2", "shell-pages-title", "");
    const history = el("div", "shell-pages-history", { role: "group", "aria-label": "Section history" });
    const back = button("shell-btn shell-icon-btn shell-history", "Back within this section", () => nav()?.back?.(), { "data-history": "back", title: "Back within this section (Alt ←)" });
    back.append(icon("back"));
    const forward = button("shell-btn shell-icon-btn shell-history", "Forward within this section", () => nav()?.forward?.(), { "data-history": "forward", title: "Forward within this section (Alt →)" });
    forward.append(icon("forward"));
    history.append(back, forward);
    head.append(title, history);
    const git = el("div", "shell-pages-git");
    const list = el("div", "shell-pages-list");
    list.id = "shell-pages-list";
    list.addEventListener("keydown", pageKeys);
    root.append(head, git, list);
    state.pages = { root, title, back, forward, git, list, key: "", shown: false, section: null };
    return root;
  }
  function pageButton(label, current, run, extra = {}) {
    const node = button(`shell-btn shell-page${extra.sub ? " is-sub" : ""}`, null, run, { "data-page": extra.key || label });
    if (extra.glyph) {
      const svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("class", "glyph"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
      const use = document.createElementNS(SVG_NS, "use"); use.setAttribute("href", `#${extra.glyph}`); svg.append(use);
      node.append(svg);
    }
    node.append(text("span", "shell-page-label", label));
    for (const [key, className] of [[extra.badge, "count"], [extra.alert, "count warn"]]) {
      if (!key) continue;
      const badge = el("span", className);
      badge.dataset.badge = key;
      badge.hidden = true;
      node.append(badge);
    }
    if (current) node.setAttribute("aria-current", "page");
    return node;
  }
  function paintPages() {
    const pages = state.pages;
    if (!pages || !state.on) return;
    const n = nav();
    const model = pageModel();
    let history = {};
    try { history = n?.historyState?.() || {}; } catch { history = {}; }
    const key = JSON.stringify([model, Boolean(history.canBack), Boolean(history.canForward)]);
    if (key !== pages.key) {
      pages.key = key;
      const active = document.activeElement;
      const held = active && pages.list.contains?.(active) ? active.dataset?.page ?? null : null;
      pages.root.hidden = !model;
      if (state.els.list) state.els.list.dataset.pages = model ? "on" : "off";
      pages.back.disabled = !history.canBack;
      pages.forward.disabled = !history.canForward;
      const rows = [];
      if (model) {
        pages.title.textContent = model.title;
        pages.root.setAttribute("aria-label", `${model.title} pages`);
        if (model.groups) {
          for (const group of model.groups) {
            if (!group.views.length) { rows.push(pageButton(group.label, group.current, () => group.run?.(), { key: `group:${group.id}` })); continue; }
            rows.push(text("h3", `shell-pages-group${group.current ? " is-current" : ""}`, group.label));
            group.views.forEach((view, at) => rows.push(pageButton(view.label, view.current, () => view.run?.(), { key: `${group.id}:${at}`, sub: true })));
          }
        } else for (const page of model.pages) rows.push(pageButton(page.label, page.current, () => n?.go?.(page.id), { key: page.id, glyph: page.glyph, badge: page.badge, alert: page.alert }));
      }
      pages.list.replaceChildren(...rows);
      try { n?.paintBadges?.(pages.list); } catch { /* the counts are a courtesy */ }
      if (held) [...(pages.list.querySelectorAll?.(".shell-page") ?? [])].find((node) => node.dataset?.page === held)?.focus?.({ preventScroll: true });
    }
    // The Git chip rides with the page list (renderer/git-sync.js keeps one popover for every chip); mounting again is harmless.
    if (model) { try { window.MefiGitSync?.mount?.(pages.git, { variant: "list" }); } catch { /* no chip in this build */ } }
    const shown = Boolean(model);
    if (pages.shown !== shown || pages.section !== (model?.section ?? null)) {
      pages.shown = shown;
      pages.section = model?.section ?? null;
      emit({ what: "pages", shown, section: pages.section });
    }
  }
  // The arrows move between the pages, Home and End go to the ends; Tab leaves the list.
  function pageKeys(event) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = [...(state.pages?.list?.querySelectorAll?.(".shell-page") ?? [])];
    const at = items.indexOf(document.activeElement);
    if (!items.length) return;
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : Math.max(0, Math.min(items.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)));
    event.preventDefault?.();
    items[next]?.focus?.({ preventScroll: true });
  }

  // ---- the feed: what the bars say -------------------------------------------------------------
  // Only what the app already holds: MefiWorkspace's board and status, the assistant's
  // digest, MefiToday's count when it is there, the usage tracker's last reading, the
  // player's status, the machine's load from the resource watcher's push and the
  // permission mode. An item nobody has data for is left out.
  const openQuestions = (assistant) => (Array.isArray(assistant?.questions) ? assistant.questions : []).filter((question) => question && question.status === "open");
  function runKind(status, assistant, running) {
    const loop = status?.loop;
    if (loop && typeof loop === "object" && typeof loop.state === "string") {
      if (loop.state === "held" || loop.launchHold === true) return "off";
      if (loop.on === false) return "paused";
    } else {
      if (status?.held === true && !running.length) return "off";
      if (assistant?.status === "paused" || assistant?.prefs?.paused === true || status?.execute === false) return "paused";
    }
    return running.length ? "working" : "idle";
  }
  function readLive() {
    const snapshot = window.MefiWorkspace?.snapshot?.() ?? null;
    // Before Home has read a project there is nothing to say about it.
    const loaded = Boolean(snapshot?.projectId);
    const status = loaded && snapshot.status && typeof snapshot.status === "object" ? snapshot.status : {};
    const assistant = loaded && snapshot.assistant && typeof snapshot.assistant === "object" ? snapshot.assistant : {};
    const running = Array.isArray(status.running) ? status.running : [];
    let needs = null;
    try {
      const counted = window.MefiToday?.count?.();
      if (finite(counted)) needs = Math.max(0, Math.floor(counted));
    } catch { /* the inbox module is not ready */ }
    if (needs === null && loaded) {
      const digest = assistant.needsYou?.counts?.total;
      needs = finite(digest) ? Math.max(0, Math.floor(digest)) : openQuestions(assistant).length;
    }
    let plan = null, cost = null;
    try {
      const reading = window.MefiUsageTracker?.brief?.();
      plan = reading?.plan?.windows?.length ? reading.plan : null;
      cost = finite(reading?.today?.costUsd) ? reading.today.costUsd : null;
    } catch { /* no reading yet */ }
    let player = null;
    try {
      const heard = window.MefiMusic?.status?.();
      if (heard && (heard.playing || heard.stationName || heard.link || (heard.source === "local" && heard.queueLength > 0))) player = { playing: Boolean(heard.playing), title: String(heard.title || "Music") };
    } catch { /* the player is not ready */ }
    let permission = null;
    try {
      const level = window.MefiAutonomy?.state?.()?.level;
      permission = level ? String(window.MefiAutonomy.label?.() || level) : null;
    } catch { /* no mode yet */ }
    return { needs, working: running.length, run: loaded ? runKind(status, assistant, running) : null, plan, cost, player, permission, machine: state.machine };
  }
  // The machine's load, from the resource watcher's own push (main's machine:status, the reading Home's Machine tile and the
  // rail's badge already get): CPU and the share of memory in use, rounded, and whether it holds new workers back. Only these
  // few numbers are kept, never the pushed status itself. A reading with neither number is no reading.
  function machineOf(status) {
    const resources = status?.capacity?.resources;
    if (!resources || typeof resources !== "object") return null;
    const cpu = finite(resources.cpuPercent) ? Math.round(clamp(resources.cpuPercent, 0, 100)) : null;
    const total = resources.totalMemoryMB, free = resources.availableMemoryMB;
    const mem = finite(total) && total > 0 && finite(free) && free >= 0 && free <= total ? Math.round((1 - free / total) * 100) : null;
    if (cpu === null && mem === null) return null;
    const held = status.wait === true;
    return { cpu, mem, held, reason: held ? String(status.capacity?.reason || "").slice(0, 160) : "" };
  }
  function onMachine(status) {
    const next = machineOf(status);
    if (JSON.stringify(next) === JSON.stringify(state.machine)) return;
    state.machine = next;
    scheduleLive();
  }
  function scheduleLive() {
    if (!state.on || state.timer) return;
    // A window nobody can see is not repainted; it is, once, when it is seen again.
    if (document.hidden) { state.stale = true; return; }
    state.timer = setTimeout(() => { state.timer = 0; paintLive(); }, 60);
  }
  // The inbox module says when its count changes; it loads after this file, so it is asked for once it is there.
  function watchToday() {
    const today = window.MefiToday;
    if (state.todayWatched || typeof today?.onChange !== "function") return;
    state.todayWatched = true;
    try { today.onChange(() => scheduleLive()); } catch { state.todayWatched = false; }
  }
  function paintLive() {
    if (!state.on || !state.top) return;
    watchToday();
    paintPages();
    const live = readLive();
    const parts = trail();
    const key = JSON.stringify([live, parts, currentMode()]);
    state.live = live;
    if (key === state.liveKey) return;
    state.liveKey = key;
    const top = state.top;
    const needs = live.needs;
    top.need.hidden = needs === null;
    top.need.dataset.tone = needs > 0 ? "need" : "clear";
    top.needN.textContent = needs > 0 ? String(needs) : "";
    top.needL.textContent = needs > 0 ? ` need${needs === 1 ? "s" : ""} you` : "All clear";
    top.need.setAttribute("aria-label", needs > 0 ? `${needs} need${needs === 1 ? "s" : ""} you. Open the inbox` : "All clear. Open the inbox");
    const run = live.run;
    top.svc.hidden = run === null;
    if (run !== null) {
      top.svc.dataset.tone = run;
      top.svcN.textContent = run === "working" ? String(live.working) : "";
      top.svcText.textContent = run === "working" ? " working" : run === "paused" ? "Paused" : run === "off" ? "Agents off" : "Idle";
      top.svcButton.setAttribute("aria-label", run === "paused" ? "Resume new work" : run === "off" ? "Start agents" : "Pause new work");
      top.svcButton.setAttribute("title", run === "paused" ? "Let new work start again." : run === "off" ? "Start automatic work for this project." : "Hold all new work. Running jobs finish normally.");
      top.svcButton.replaceChildren(icon(run === "paused" || run === "off" ? "play" : "pause"));
    }
    paintTrail(parts);
    paintStatusItems(live);
  }
  // One control for pausing: Home's own (workspace.js keeps the rules for a launch hold, a pause and a resume).
  function togglePause() {
    const control = document.getElementById?.("workspace-pause");
    if (control && !control.disabled) { control.click?.(); return true; }
    nav()?.go?.("workspace");
    return false;
  }

  // ---- the inbox -----------------------------------------------------------------------------------
  // The pill opens what the inbox module registers (MefiShell.onInbox, or MefiToday.openInbox); until
  // something does, Work's existing needs-you views: a decision in Vibe's drawer or Command's Ask
  // rail, finished work in the Task board's Review filter.
  function openInbox(anchor) {
    const hook = shell.onInbox;
    if (typeof hook === "function") {
      try { if (hook(anchor || null) !== false) return true; } catch { /* fall through to the next way */ }
    }
    const today = window.MefiToday;
    if (typeof today?.openInbox === "function") {
      try { if (today.openInbox(anchor || null) !== false) return true; } catch { /* fall through */ }
    }
    const live = state.live ?? readLive();
    if (!live.needs) { window.MefiToast?.("Nothing needs you right now.", "good"); return false; }
    const vibe = window.MefiVibe;
    if (currentMode() === "vibe" && typeof vibe?.snapshot === "function" && typeof vibe?.openNeed === "function") {
      const first = vibe.snapshot()?.needs?.[0];
      if (first) { vibe.openNeed({ kind: first.kind, id: first.id }); return true; }
    }
    if (openQuestions(window.MefiWorkspace?.snapshot?.()?.assistant).length) { nav()?.go?.("command", { rail: "ask" }); return true; }
    nav()?.go?.("tasks", { filter: "review" });
    return true;
  }

  // ---- the status bar -----------------------------------------------------------------------------
  function buildStatus(bar) {
    const items = {};
    const item = (key, className, run, label) => {
      const node = button(`shell-btn shell-status-item ${className}`, label, run, { "data-item": key });
      items[key] = node;
      return node;
    };
    item("layout", "shell-layout-button", () => toggleMenu(), "Layout");
    items.layout.id = "shell-layout-button";
    items.layout.setAttribute("aria-haspopup", "dialog");
    items.layout.setAttribute("aria-expanded", "false");
    items.layout.setAttribute("title", "Layout: list, inspector, tab strip and sizes");
    items.layout.append(icon("panelL"), text("span", "shell-status-word", "Layout"));
    const working = item("working", "shell-working", () => nav()?.go?.("command"), "Nothing running");
    working.append(el("i", "shell-dot", { "aria-hidden": "true" }), text("span", "", ""));
    const waiting = item("waiting", "shell-waiting", () => openInbox(waiting), "Waiting on you");
    waiting.append(icon("bell"), text("span", "", ""));
    items.usage = el("span", "shell-usage");
    // The prototype's second rule: between what waits on you and the usage meters, there only while the meters are.
    items.usageSep = el("span", "shell-sep-v shell-usage-sep", { "aria-hidden": "true" });
    item("player", "shell-player", () => { const music = window.MefiMusic; if (typeof music?.toggleAudio === "function") music.toggleAudio(); else nav()?.go?.("audio"); }, "Music and video");
    items.player.setAttribute("aria-haspopup", "true");
    items.player.append(icon("audio"), text("span", "shell-player-title", ""));
    // The machine's load opens the machine status (the Explorer's diagnostics), where Home's Machine tile goes too.
    item("machine", "shell-machine", () => { const n = nav(); if (n?.get?.("machine")) n.go?.("machine"); else n?.go?.("explorer", { panel: "diagnostics" }); }, "Machine load");
    items.machine.append(text("span", "", ""));
    item("permission", "shell-permission", () => { const autonomy = window.MefiAutonomy; if (typeof autonomy?.openSettings === "function") autonomy.openSettings(); else nav()?.go?.("agents", { section: "setup" }); }, "Permission mode");
    items.permission.append(icon("shield"), text("span", "shell-status-word", ""));
    item("cost", "shell-cost", () => nav()?.go?.("usage"), "Today's cost");
    items.cost.append(text("span", "", ""));
    const extra = el("span", "shell-status-extra");
    state.stacks.status = extra;
    state.statusParts = { items, working, waiting };
    // The prototype's order: Layout | working, waiting | meters ... the player, the machine, today's cost, the permission mode.
    bar.append(items.layout, el("span", "shell-sep-v", { "aria-hidden": "true" }), working, waiting, items.usageSep, items.usage, el("span", "shell-spacer"), extra, items.player, items.machine, items.cost, items.permission);
    for (const node of [working, waiting, items.player, items.machine, items.permission, items.cost]) node.hidden = true;
    items.usage.hidden = true;
    items.usageSep.hidden = true;
  }
  // The tracker's short names for the plan windows, in the prototype's words ("5 h", "Week"); any other window keeps its own.
  const METER_WORDS = Object.freeze({ "5h": "5 h", Wk: "Week", Mo: "Month" });
  function usageMeter(one) {
    const percent = Math.round(one.percent);
    const node = button("shell-btn shell-status-item shell-meter-button", `${one.label || one.short} ${percent} percent used`, () => nav()?.go?.("usage"));
    node.setAttribute("title", `${one.label || one.short}: ${percent}% used. Open Usage.`);
    const bar = el("span", "shell-meter");
    const fill = el("i");
    setVar(fill, "width", `${clamp(one.percent, 0, 100)}%`);
    bar.append(fill);
    node.append(text("span", "shell-meter-label", METER_WORDS[one.short] || one.short), bar, text("span", "shell-meter-value", `${percent}%`));
    if (one.percent >= 90) node.dataset.tone = "warn";
    return node;
  }
  function paintStatusItems(live) {
    const parts = state.statusParts;
    if (!parts) return;
    const { items, working, waiting } = parts;
    const run = live.run;
    working.hidden = run === null;
    if (run !== null) {
      const word = run === "working" ? `${live.working} working` : run === "paused" ? "Paused" : run === "off" ? "Agents off" : "Nothing running";
      working.dataset.tone = run;
      working.children[1].textContent = word;
      working.setAttribute("aria-label", word);
      working.setAttribute("title", "What is running. Open Command.");
    }
    const needs = live.needs || 0;
    waiting.hidden = needs <= 0;
    if (needs > 0) {
      waiting.children[1].textContent = `${needs} waiting on you`;
      waiting.setAttribute("aria-label", `${needs} waiting on you. Open the inbox`);
    }
    items.usage.replaceChildren();
    const windows = (live.plan?.windows ?? []).filter((one) => finite(one.percent));
    const shown = windows.length > 1 ? [windows[0], windows.slice(1).reduce((best, one) => (one.percent > best.percent ? one : best))] : windows;
    for (const one of shown) items.usage.append(usageMeter(one));
    items.usage.hidden = !shown.length;
    items.usageSep.hidden = !shown.length;
    items.player.hidden = !live.player;
    if (live.player) {
      items.player.children[1].textContent = live.player.title;
      items.player.setAttribute("aria-label", `${live.player.playing ? "Playing" : "Paused"}: ${live.player.title}. Music and video`);
      items.player.setAttribute("title", `${live.player.playing ? "Playing" : "Paused"}: ${live.player.title}. Open the music and video menu.`);
      items.player.dataset.playing = String(live.player.playing);
    }
    items.permission.hidden = !live.permission;
    if (live.permission) {
      items.permission.children[1].textContent = live.permission;
      items.permission.setAttribute("aria-label", `Permission mode: ${live.permission}`);
      items.permission.setAttribute("title", `Permission mode: ${live.permission}. Change it.`);
    }
    const machine = live.machine;
    items.machine.hidden = !machine;
    if (machine) {
      const words = [machine.cpu === null ? "" : `CPU ${machine.cpu}%`, machine.mem === null ? "" : `Mem ${machine.mem}%`].filter(Boolean).join(" · ");
      const spoken = [machine.cpu === null ? "" : `CPU ${machine.cpu} percent`, machine.mem === null ? "" : `memory ${machine.mem} percent in use`].filter(Boolean).join(", ");
      items.machine.children[0].textContent = words;
      items.machine.setAttribute("aria-label", `Machine load: ${spoken}. Open the machine status`);
      items.machine.setAttribute("title", `Machine load: ${spoken}.${machine.held ? ` New workers wait${machine.reason ? `: ${machine.reason}` : "."}` : ""} Open the machine status.`);
    }
    items.cost.hidden = live.cost === null;
    if (live.cost !== null) {
      const money = `$${live.cost.toFixed(live.cost >= 100 ? 0 : 2)} today`;
      items.cost.children[0].textContent = money;
      items.cost.setAttribute("aria-label", `Recorded cost today: ${money}`);
      items.cost.setAttribute("title", "What the calls recorded today cost. Open Usage.");
    }
  }

  // ---- the layout menu ------------------------------------------------------------------------------
  function toggleMenu() { if (state.menu) closeMenu(true); else openMenu(); }
  function openMenu() {
    if (!state.on || state.menu) return;
    closeDrawer(false);
    const menu = el("div", "shell-region shell-menu", { role: "dialog", "aria-label": "Layout" });
    menu.id = "shell-menu";
    const head = el("div", "shell-menu-head");
    head.append(icon("layout"), text("b", "", "Layout"), text("span", "shell-menu-mode", ""));
    const rows = el("div", "shell-menu-rows");
    const row = (key, label, hint) => {
      const node = el("div", "shell-menu-row");
      const words = el("span", "shell-menu-words");
      words.append(text("b", "", label), text("small", "", hint));
      const toggleButton = button("shell-switch", label, () => { toggle(key); }, { role: "switch", "aria-checked": "false", "data-key": key });
      toggleButton.append(el("i", "", { "aria-hidden": "true" }));
      node.append(words, toggleButton);
      return { node, words, toggleButton };
    };
    const parts = { list: row("list", "List", ""), inspector: row("inspector", "Inspector", ""), tabs: row("tabs", "Tab strip", "Your open pages as tabs.") };
    rows.append(parts.list.node, parts.inspector.node, parts.tabs.node);
    const table = el("div", "shell-menu-grid", { role: "group", "aria-label": "Each mode's own layout" });
    const actions = el("div", "shell-menu-actions");
    const reset = button("shell-btn shell-action", null, () => { closeMenu(true); resetLayout(); });
    reset.append(text("span", "", "Reset layout"));
    const sizes = button("shell-btn shell-action", null, () => { closeMenu(false); openSizeAndDensity(); });
    sizes.append(text("span", "", "Size and density"));
    actions.append(reset, sizes);
    if (nav()?.get?.("worktrees")) {
      const trees = button("shell-btn shell-action", null, () => { closeMenu(false); nav()?.go?.("worktrees"); });
      trees.append(icon("worktree"), text("span", "", "Worktrees"));
      actions.append(trees);
    }
    const fine = text("p", "shell-menu-fine", "Drag the edge of a panel, or focus the edge and use the arrow keys. A double-click puts it back. Each mode remembers its own layout.");
    menu.append(head, rows, table, fine, actions);
    menu.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault?.(); event.stopPropagation?.(); closeMenu(true); }
    });
    state.els.frame.append(menu);
    const active = document.activeElement;
    state.menu = { node: menu, parts, table, head, returnTo: active && active !== document.body ? active : state.statusParts.items.layout };
    state.statusParts.items.layout.setAttribute("aria-expanded", "true");
    paintMenu();
    try { menu.querySelector("button")?.focus?.({ preventScroll: true }); } catch { /* not focusable here */ }
  }
  function closeMenu(restore = true) {
    const menu = state.menu;
    if (!menu) return false;
    state.menu = null;
    menu.node.remove?.();
    state.statusParts?.items?.layout?.setAttribute?.("aria-expanded", "false");
    if (restore) {
      const back = menu.returnTo?.isConnected === false ? state.statusParts?.items?.layout : menu.returnTo;
      try { back?.focus?.({ preventScroll: true }); } catch { /* gone */ }
    }
    return true;
  }
  function paintMenu() {
    const menu = state.menu;
    if (!menu || !state.plan) return;
    const mode = state.mode, prefs = state.prefs[mode];
    menu.head.children[2].textContent = `${modeWords(mode)} mode`;
    const folded = foldNames();
    const notes = {
      list: state.plan.list.drawer ? "Opens as a drawer in a small window." : "Ctrl B shows or hides it.",
      inspector: state.vacant ? "Nothing to inspect on this page: it comes back on a session." : state.plan.inspector.drawer ? (folded.includes("inspector") ? "Opens as a drawer in a small window." : "Opens as a drawer: this window is too narrow to dock it.") : "The [ key shows or hides it.",
    };
    for (const name of ["list", "inspector"]) {
      menu.parts[name].words.children[1].textContent = notes[name];
      menu.parts[name].toggleButton.setAttribute("aria-checked", String(isOpen(name)));
    }
    menu.parts.tabs.toggleButton.setAttribute("aria-checked", String(prefs.tabs.open));
    const cell = (other, name) => (state.prefs[other][name].open ? `${state.prefs[other][name].w} px` : "closed");
    const grid = ["", "Build", "Vibe", "List", cell("build", "list"), cell("vibe", "list"), "Inspector", cell("build", "inspector"), cell("vibe", "inspector")];
    menu.table.replaceChildren(...grid.map((value, at) => text(at < 3 || at % 3 === 0 ? "span" : "b", at < 3 ? "shell-grid-head" : "", value)));
  }
  // Size and density is the SIZE page's; until it says how to open it, Configuration's UI & Surfaces is where the scale lives.
  function openSizeAndDensity() {
    const n = nav();
    const size = window.MefiSize;
    if (typeof size?.open === "function") { size.open(); return; }
    if (n?.get?.("size")) { n.go("size"); return; }
    n?.go?.("config", { category: "ui" });
  }
  // A press outside the menu closes it.
  function outsideMenu(event) {
    const menu = state.menu;
    if (!menu) return;
    const target = event.target;
    if (menu.node.contains?.(target) || state.statusParts?.items?.layout?.contains?.(target)) return;
    closeMenu(false);
  }
  // A press anywhere but in the open drawer closes it: on the page the scrim takes it (and keeps it from reaching the
  // page), on the rail or a bar the press goes on to do what it was for. The two toggles close their own drawer.
  function outsideDrawer(event) {
    const name = state.drawer;
    if (!name) return;
    const target = event.target;
    if (state.els[name]?.contains?.(target) || state.els.scrim === target || state.menu?.node?.contains?.(target)) return;
    if ([state.top?.listToggle, state.top?.inspectorToggle].some((node) => node?.contains?.(target))) return;
    closeDrawer(false);
  }

  // ---- splitters: drag, arrow keys, double-click ------------------------------------------------------
  // Three edges: the rail's (the menu kept open at 256 px or closed at 64, the pin it already has), the
  // list's and the inspector's. Each is a separator with aria-valuenow, -min and -max.
  function buildSplitters(frame) {
    state.splits = {};
    for (const [name, label] of [["rail", "Menu: kept open or closed"], ["list", "Width of the list"], ["inspector", "Width of the inspector"]]) {
      const node = el("div", `shell-split shell-split-${name}`, { role: "separator", "aria-orientation": "vertical", tabindex: "0", "aria-label": label, "data-split": name });
      node.id = `shell-split-${name}`;
      node.hidden = true;
      node.addEventListener("pointerdown", (event) => splitDown(event, name, node));
      node.addEventListener("keydown", (event) => splitKey(event, name));
      node.addEventListener("dblclick", () => splitReset(name));
      frame.append(node);
      state.splits[name] = node;
    }
  }
  const pinned = () => rootEl().dataset?.railPinned !== undefined;
  function paintSplitters() {
    const { splits, plan } = state;
    if (!splits || !plan) return;
    const railOn = currentMode() !== "vibe" && boxShown("app-rail") && (Boolean(document.getElementById?.("app-rail-pin")) || typeof nav()?.setRailPinned === "function");
    splits.rail.hidden = !railOn;
    if (railOn) {
      const on = pinned();
      splits.rail.setAttribute("aria-valuemin", "64");
      splits.rail.setAttribute("aria-valuemax", "256");
      splits.rail.setAttribute("aria-valuenow", String(on ? 256 : 64));
      splits.rail.setAttribute("aria-valuetext", on ? "Kept open" : "Closed");
      splits.rail.setAttribute("title", `Drag or double-click to ${on ? "close" : "keep open"} the menu`);
    }
    for (const name of ["list", "inspector"]) {
      const one = plan[name], node = splits[name];
      node.hidden = !one.docked;
      if (!one.docked) continue;
      node.setAttribute("aria-valuemin", String(LIMITS[name][0]));
      node.setAttribute("aria-valuemax", String(one.max));
      node.setAttribute("aria-valuenow", String(one.width));
      node.setAttribute("aria-valuetext", `${one.width} pixels`);
      node.setAttribute("title", `Drag to resize the ${name}. Arrow keys work too, and a double-click resets it.`);
    }
  }
  let drag = null;
  function splitDown(event, name, node) {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault?.();
    const start = name === "rail" ? (pinned() ? 256 : 64) : state.plan[name].width;
    drag = { name, node, x: event.clientX, start, id: event.pointerId, moved: false, frame: 0, last: null };
    try { node.setPointerCapture?.(event.pointerId); } catch { /* no capture here */ }
    node.classList.add("is-drag");
    state.els.frame.classList.add("is-dragging");
    for (const [type, handler] of [["pointermove", splitMove], ["pointerup", splitUp], ["pointercancel", splitUp], ["lostpointercapture", splitUp]]) node.addEventListener(type, handler);
  }
  function splitMove(event) {
    if (!drag) return;
    const delta = (event.clientX - drag.x) * (drag.name === "inspector" ? -1 : 1);
    if (Math.abs(delta) > 2) drag.moved = true;
    drag.last = drag.name === "rail" ? delta : drag.start + delta;
    // A click that wobbles a pixel or two is a click: nothing follows the pointer until it has really moved.
    if (!drag.moved || drag.name === "rail" || drag.frame) return;
    const flight = drag;
    const step = () => { flight.frame = 0; if (drag === flight && flight.last !== null) resize(flight.name, flight.last); };
    flight.frame = typeof requestAnimationFrame === "function" ? requestAnimationFrame(step) : (step(), 0);
  }
  function splitUp() {
    if (!drag) return;
    const done = drag;
    drag = null;
    if (done.frame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(done.frame);
    done.node.classList.remove("is-drag");
    state.els.frame?.classList?.remove?.("is-dragging");
    for (const [type, handler] of [["pointermove", splitMove], ["pointerup", splitUp], ["pointercancel", splitUp], ["lostpointercapture", splitUp]]) done.node.removeEventListener(type, handler);
    try { done.node.releasePointerCapture?.(done.id); } catch { /* already released */ }
    if (done.name === "rail") {
      if (done.moved && done.last !== null && ((done.last > 6 && !pinned()) || (done.last < -6 && pinned()))) splitReset("rail");
    } else if (done.moved && done.last !== null) resize(done.name, done.last);
    paintSplitters();
    try { done.node.focus?.({ preventScroll: true }); } catch { /* gone */ }
  }
  function splitKey(event, name) {
    const step = event.shiftKey ? KEY_STEP_BIG : KEY_STEP;
    if (name === "rail") {
      const wantsOpen = { ArrowLeft: false, Home: false, ArrowRight: true, End: true };
      if (event.key in wantsOpen) { event.preventDefault?.(); if (wantsOpen[event.key] !== pinned()) splitReset("rail"); }
      else if (event.key === "Enter" || event.key === " ") { event.preventDefault?.(); splitReset("rail"); }
      return;
    }
    const one = state.plan?.[name];
    if (!one?.docked) return;
    const direction = name === "inspector" ? -1 : 1;
    let next = null;
    if (event.key === "ArrowRight") next = one.width + step * direction;
    else if (event.key === "ArrowLeft") next = one.width - step * direction;
    else if (event.key === "Home") next = LIMITS[name][0];
    else if (event.key === "End") next = one.max;
    else if (event.key === "Enter") next = DEFAULTS[name];
    if (next === null) return;
    event.preventDefault?.();
    resize(name, next);
    state.splits?.[name]?.focus?.();
  }
  function splitReset(name) {
    if (name === "rail") {
      // The rail's own pin button keeps the rules (a window too narrow to pin says so).
      const pin = document.getElementById?.("app-rail-pin");
      if (typeof pin?.click === "function") pin.click();
      else nav()?.setRailPinned?.(!pinned());
      paintSplitters();
      return;
    }
    resize(name, DEFAULTS[name]);
  }

  // ---- keys ---------------------------------------------------------------------------------------------
  // Ctrl M switches the mode, Ctrl B the list, [ the inspector; Esc closes the menu, then a drawer.
  function onKey(event) {
    if (!state.on || event.isComposing) return;
    const modifier = event.ctrlKey || event.metaKey;
    const code = event.code || "";
    const key = String(event.key || "").toLowerCase();
    if (event.key === "Escape") {
      if (event.defaultPrevented) return;
      if (state.menu) { event.preventDefault?.(); event.stopPropagation?.(); closeMenu(true); return; }
      if (state.drawer && !nav()?.state?.transient) { event.preventDefault?.(); event.stopPropagation?.(); closeDrawer(true); }
      return;
    }
    if (event.defaultPrevented) return;
    if (modifier && !event.altKey && !event.shiftKey && (code === "KeyM" || key === "m")) { event.preventDefault?.(); setMode(currentMode() === "vibe" ? "build" : "vibe"); return; }
    if (modifier && !event.altKey && !event.shiftKey && (code === "KeyB" || key === "b")) { event.preventDefault?.(); toggle("list"); return; }
    if (!modifier && !event.altKey && event.key === "[" && !typing(event.target) && !nav()?.state?.transient) { event.preventDefault?.(); toggle("inspector"); }
  }
  // Display-only rows for the shortcut sheet (nav.js skips the "command" group; onKey acts).
  function registerKeyRows() {
    const n = nav();
    if (state.keyRows || !n?.register) return;
    state.keyRows = true;
    for (const [key, id, label] of [["Ctrl M", "shell-key-mode", "Switch between Vibe and Build"], ["Ctrl B", "shell-key-list", "Show or hide the list"], ["[", "shell-key-inspector", "Show or hide the inspector"]]) {
      try { n.register({ id, label, short: label, desc: label, kind: "action", layer: null, section: "home", group: "command", key, glyph: null, badge: null, showIn: { tabs: false, tools: false, dock: false, palette: false, help: true, footer: false }, hidden: () => !state.on }); } catch { /* the sheet is optional */ }
    }
  }
  // What Search (Ctrl K) can do with the frame, as the prototype lists it: switch the mode, pause new work (Actions), show or
  // hide the list and the inspector and reset the layout (Layout). Each runs what the bar's own control runs; the words say
  // what a press does now. The keys are shown, not bound here (onKey binds them), and the rows are gone with the frame.
  function registerActions() {
    const n = nav();
    if (state.actionRows || !n?.register) return;
    state.actionRows = true;
    const base = { kind: "action", layer: null, section: "home", group: "layout", key: null, keyMatch: () => false, badge: null, showIn: { tabs: false, tools: false, dock: false, palette: true, help: false, footer: false }, hidden: () => !state.on };
    const run = () => (state.live ?? readLive()).run;
    const rows = [
      { ...base, id: "shell-do-mode", chord: "Ctrl M", paletteGroup: "Actions", paletteBrowse: 4, searchTerms: "mode vibe build switch calm in depth",
        get label() { return currentMode() === "vibe" ? "Switch to Build" : "Switch to Vibe"; }, get glyph() { return currentMode() === "vibe" ? "g-wrench" : "g-spark"; },
        desc: "Vibe is the calm board; Build is the list, the thread and the inspector", run: () => setMode(currentMode() === "vibe" ? "build" : "vibe") },
      { ...base, id: "shell-do-pause", paletteGroup: "Actions", paletteBrowse: 2, glyph: null, searchTerms: "pause resume hold stop new work agents start",
        get label() { const now = run(); return now === "paused" ? "Resume new work" : now === "off" ? "Start agents" : "Pause new work"; },
        desc: "Hold all new work; running jobs finish normally", hidden: () => !state.on || run() === null, run: () => togglePause() },
      { ...base, id: "shell-do-list", chord: "Ctrl B", paletteGroup: "Layout", glyph: "g-frame", searchTerms: "list sessions column panel sidebar",
        get label() { return isOpen("list") ? "Hide the list" : "Show the list"; }, desc: "The list column", run: () => toggle("list") },
      { ...base, id: "shell-do-inspector", chord: "[", paletteGroup: "Layout", glyph: "g-frame", searchTerms: "inspector panel column details",
        get label() { return isOpen("inspector") ? "Hide the inspector" : "Show the inspector"; }, desc: "The inspector column", hidden: () => !state.on || state.vacant, run: () => toggle("inspector") },
      { ...base, id: "shell-do-reset", label: "Reset layout", paletteGroup: "Layout", glyph: "g-frame", searchTerms: "layout reset widths panels default", desc: "This mode's list and inspector back to how they start", run: () => resetLayout() },
    ];
    for (const row of rows) { try { n.register(row); } catch { /* Search is optional */ } }
  }

  // ---- turning the frame on and off -----------------------------------------------------------------------
  function enable() {
    if (state.on) return true;
    if (!layoutOn() || !railShell() || !document.body) return false;
    state.wanted = true;
    state.prefs = loadPrefs();
    state.mode = currentMode();
    state.requested = {};
    state.on = true;
    buildRegions();
    for (const regionName of REGIONS) place(regionName);
    wire();
    registerKeyRows();
    registerActions();
    apply();
    state.planKey = planKey(state.plan);
    paintBars();
    void seed();
    emit({ what: "enable" });
    return true;
  }
  function disable({ keepWanted = false } = {}) {
    if (!state.on) { if (!keepWanted) state.wanted = false; return false; }
    if (!keepWanted) state.wanted = false;
    state.on = false;
    clearTimeout(state.timer);
    state.timer = 0;
    state.drawer = null;
    state.returnFocus = null;
    const layout = nav()?.layout;
    for (const name of Object.keys(state.requested)) { try { layout?.set?.(name, 0); } catch { /* the contract went with v2 */ } }
    state.requested = {};
    removeRegions();
    delete rootEl().dataset.frame;
    state.top = null; state.statusParts = null; state.splits = null; state.plan = null; state.live = null; state.liveKey = "";
    emit({ what: "disable" });
    return true;
  }
  // One read for what a push has not brought yet (the permission mode); after that only pushes.
  async function seed() {
    try {
      const autonomy = window.MefiAutonomy;
      if (autonomy && !autonomy.state?.() && typeof autonomy.refresh === "function") await autonomy.refresh();
    } catch { /* the mode is left out */ }
    if (state.on) paintLive();
  }
  // Listeners are added once per page; while the frame is off they do nothing.
  function wire() {
    if (state.wired) return;
    state.wired = true;
    window.addEventListener("resize", () => { if (applying || !state.on) return; sync("resize"); });
    window.addEventListener("mefi:layout", (event) => {
      if (event?.detail && event.detail.on === false) { disable(); return; }
      if (applying || !state.on) return;
      sync("layout");
    });
    window.addEventListener("mefi:shell", () => {
      if (applying) return;
      if (state.on && !railShell()) { disable({ keepWanted: true }); return; }
      if (!state.on && state.wanted && layoutOn() && railShell()) { enable(); return; }
      sync("shell");
    });
    window.addEventListener("mefi:nav", () => {
      if (!state.on) return;
      if (state.drawer) closeDrawer(false);
      closeMenu(false);
      sync("nav");
    });
    for (const name of ["mefi:workspace-state", "mefi:usage-report", "mefi:nav-badges", "mefi:autonomy-changed", "mefi:project-changed", "mefi:task-context", "mefi-music-change", "mefi:companion-state"]) window.addEventListener(name, () => scheduleLive());
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("visibilitychange", () => { if (state.on && state.stale && !document.hidden) { state.stale = false; scheduleLive(); } });
    document.addEventListener("pointerdown", (event) => { if (!state.on) return; outsideMenu(event); outsideDrawer(event); }, true);
    // The pushes the page already gets; nothing here polls.
    for (const subscribe of ["onTasks", "onAssistant", "onAssistantStatus", "onProjects"]) { try { window.mefiStudio?.[subscribe]?.(() => scheduleLive()); } catch { /* a bridge without the push */ } }
    // The resource watcher's pass, every few seconds: kept only when the rounded load moved, so most passes repaint nothing.
    try { window.mefiStudio?.["onMachineStatus"]?.((status) => onMachine(status)); } catch { /* a bridge without the push */ }
    if (typeof MutationObserver === "function") {
      try {
        const attributes = new MutationObserver(() => { if (state.on) sync("attribute"); });
        attributes.observe(rootEl(), { attributes: true, attributeFilter: ["data-ui-mode", "data-shell", "data-rail-pinned", "data-layout-fold"] });
        state.observers.push(attributes);
        if (document.body) {
          const classes = new MutationObserver(() => scheduleLive());
          classes.observe(document.body, { attributes: true, attributeFilter: ["class", "data-nav-section"] });
          state.observers.push(classes);
        }
      } catch { /* the events above carry it */ }
    }
  }

  // ---- the way in (this runs with v2 off too) -------------------------------------------------------------
  // A Settings switch and a Search action: each saves the choice through MefiNav.setLayout and reloads,
  // as builder.js's layout switch does, so every module starts in the layout it was asked for.
  function switchLayout(next) {
    const n = nav();
    if (!n?.setLayout) return false;
    const to = next === "v2" ? "v2" : "v1";
    n.setLayout(to);
    window.MefiToast?.(to === "v2" ? "Switching to the 0.5 layout. Studio reloads to do it." : "Going back to the classic layout. Studio reloads to do it.", "info");
    setTimeout(() => { try { n.saveResume?.(); } catch { /* resume is optional */ } try { window.location.reload(); } catch { /* no reload here */ } }, 350);
    return true;
  }
  function wayIn() {
    nav()?.register?.({
      id: "layout-switch", label: "Switch layout: 0.5 or classic", short: "Layout", kind: "action", layer: null, section: "settings", group: "system",
      glyph: "g-frame", badge: null, desc: "The 0.5 layout adds a list, an inspector, tabs and a status bar around every page. Studio reloads to switch.",
      searchTerms: "layout 0.5 classic v1 v2 new shell list inspector tabs status bar panels frame switch try",
      showIn: { tabs: false, tools: false, dock: false, palette: true, help: false, footer: false },
      run: () => switchLayout(layoutOn() ? "v1" : "v2"),
    });
    const box = document.getElementById?.("settings-layout-v2");
    if (box) {
      box.checked = layoutOn();
      box.addEventListener("change", () => { const wanted = box.checked; if (!switchLayout(wanted ? "v2" : "v1")) box.checked = !wanted; });
    }
  }
  function start() {
    if (state.armed) return;
    state.armed = true;
    wayIn();
    if (layoutOn()) enable();
  }

  // ---- the API -------------------------------------------------------------------------------------------------
  const shell = {
    active: () => state.on,
    enable, disable,
    region: (name) => (state.on && REGIONS.includes(name) ? state.els[name] ?? null : null),
    mode: currentMode, setMode, size, resize, info, open, close, toggle, isOpen,
    mount, onChange, openInbox, resetLayout, sync,
    status: () => (state.on ? { ...(state.live ?? readLive()) } : null),
    // Whether the list column shows the section's page list now (the column's panels make way while it does), and for which section.
    pages: () => (state.on && state.pages ? { shown: state.pages.shown, section: state.pages.section } : { shown: false, section: null }),
    layout: () => clone(state.prefs),
    onInbox: null,
    LIMITS, DEFAULTS, REGIONS, MODES, PRESETS,
    // What the plan would be for a window and the rail in it, without touching one.
    plan: computePlan,
  };
  window.MefiShell = shell;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
