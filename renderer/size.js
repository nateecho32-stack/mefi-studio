// Size and density (layout v2): how big the window is, how big its words are,
// how roomy its rows are and how much each row says, with a live picture of the
// window beside the controls so nobody has to flip back and forth to judge it.
// window.MefiSize is the model and the page (docs/architecture.md, "Size and
// density"; styles in renderer/size.css):
//
//   get()            what the window has now: { zoom, text, density, detail }
//   preview(draft)   change the unapplied draft (partial or whole); the miniature
//                    follows it, the window does not
//   apply(draft?)    put a draft (the current one when none is given) on the whole
//                    window; resolves { ok, applied, previous, changed }
//   reset()          apply the defaults
//   open()/close()   show or hide the page (open goes through MefiNav.go("size"), so it
//                    has a place in the history like every page)
//   onChange(cb)     cb({ applied, previous, changed, source }) when what the
//                    window has changes (an Apply, an Undo, Ctrl + and Ctrl -, a
//                    style preset); returns the way to stop listening
//
// The four settings. The interface scale (zoom, 70 to 150 percent in steps of 5) is
// the window's own zoom and stays the host's (main.cjs ui:zoom, settings.ui.zoom,
// put back on every load; Ctrl + Ctrl - Ctrl 0 move it and the page follows).
// Text size (0.8 to 1.4 in steps of 0.1) changes only the words: 0.5 components size
// them max(12px, calc(Npx * var(--text-scale, 1))), so never under 12 px. Density
// (compact, comfortable, spacious) moves row heights, gaps and padding (--d-*).
// Detail (titles, status, all) sets how much a row or card says (--dt-*). The last
// three live in the appearance store, localStorage mefiStudio.appearance
// (renderer/studio-ui.js, window.MefiAppearance), which gains `v: 2`, `text` and
// `detail` and keeps every older key and value readable; nothing is written until
// something is applied, and the first write keeps the old text under
// mefiStudio.appearance.backup.v1. Applying announces mefi:appearance, as every
// appearance change does. This file writes html[data-detail] and --text-scale;
// html[data-density] is written by MefiAppearance.apply, which knows "spacious"
// only in v2.
//
// The page (Settings > Appearance, Configuration > UI & Surfaces, Search, the
// status bar's Layout menu) keeps a draft. The controls change the draft, the
// miniature shows it under its own scope (.size-mini[data-mini-density],
// [data-mini-detail], --mini-text-scale and --mini-zoom, never the root's), and
// Apply puts it on the window with an Undo. Leaving the page keeps the draft until
// you come back or discard it. Nothing is stored for a draft.
//
// Dark by default: everything here is for html[data-layout="v2"], checked once,
// after nav.js has decided the layout. With it off this file defines the object
// and nothing else: no listener, no record, no DOM, no storage, no host call.
(function () {
  "use strict";

  // ---- the model ---------------------------------------------------------------
  const STORE_KEY = "mefiStudio.appearance";
  const BACKUP_KEY = "mefiStudio.appearance.backup.v1";
  const VERSION = 2;
  const ZOOM = Object.freeze({ min: 70, max: 150, step: 5, fallback: 100 });
  const TEXT = Object.freeze({ min: 0.8, max: 1.4, step: 0.1, fallback: 1 });
  // One word for each 10% of text size, smallest first.
  const TEXT_WORDS = Object.freeze(["Smallest", "Small", "Default", "Large", "Larger", "Very large", "Largest"]);
  const DENSITIES = Object.freeze([["compact", "Compact"], ["comfortable", "Comfortable"], ["spacious", "Spacious"]]);
  const DETAILS = Object.freeze([["titles", "Titles", "titles"], ["status", "Titles and status", "titles and status"], ["all", "Everything", "everything"]]);
  const DEFAULTS = Object.freeze({ zoom: 100, text: 1, density: "comfortable", detail: "status" });
  const FIELDS = Object.freeze(["zoom", "text", "density", "detail"]);
  const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  const isNumber = (value) => value !== null && value !== "" && typeof value !== "boolean" && Number.isFinite(Number(value));

  // The interface scale in percent, from a percent (a factor from the host goes
  // through zoomFromFactor): in steps of 5 inside 70..150, and 100 when it is not a number.
  function zoomOf(value) {
    if (!isNumber(value) || Number(value) <= 0) return ZOOM.fallback;
    return Math.min(ZOOM.max, Math.max(ZOOM.min, Math.round(Number(value) / ZOOM.step) * ZOOM.step));
  }
  // The host keeps the factor in steps of 0.05 (main.cjs zoomFactorOf); the same arithmetic, so a half step rounds the same way.
  const zoomFromFactor = (factor) => (Number.isFinite(Number(factor)) && Number(factor) > 0 ? zoomOf(Math.round(Number(factor) * 20) * 5) : ZOOM.fallback);
  // The text size as a factor, in steps of 0.1 inside 0.8..1.4, and 1 when it is not a number.
  function textOf(value) {
    if (!isNumber(value)) return TEXT.fallback;
    return Math.round(Math.min(TEXT.max, Math.max(TEXT.min, Number(value))) * 10) / 10;
  }
  const textPercent = (text) => Math.round(textOf(text) * 100);
  const textWord = (text) => TEXT_WORDS[Math.round((textOf(text) - TEXT.min) * 10)];
  const densityOf = (value) => (DENSITIES.some(([key]) => key === value) ? value : DEFAULTS.density);
  const detailOf = (value) => (DETAILS.some(([key]) => key === value) ? value : DEFAULTS.detail);

  // A whole, valid setting from anything: a field that is missing comes from `base`,
  // one that is there but not a value the layout knows becomes the default.
  function normalize(input, base = DEFAULTS) {
    const from = isObject(input) ? input : {};
    const pick = (key) => (from[key] === undefined ? base?.[key] : from[key]);
    return { zoom: zoomOf(pick("zoom")), text: textOf(pick("text")), density: densityOf(pick("density")), detail: detailOf(pick("detail")) };
  }
  // What the appearance store says about the three settings it keeps, whatever
  // version wrote it (an older store has no text or detail; an unknown density is comfortable).
  const fromStore = (stored) => ({ density: densityOf(isObject(stored) ? stored.density : null), text: textOf(isObject(stored) ? stored.text : null), detail: detailOf(isObject(stored) ? stored.detail : null) });
  const same = (a, b) => FIELDS.every((key) => a?.[key] === b?.[key]);
  const changedFields = (a, b) => FIELDS.filter((key) => a?.[key] !== b?.[key]);
  // "100% · default text · comfortable · titles and status", as the page and the Undo say it.
  function words(setting) {
    const d = normalize(setting);
    return `${d.zoom}% · ${textWord(d.text).toLowerCase()} text · ${d.density} · ${DETAILS.find(([key]) => key === d.detail)[2]}`;
  }
  const model = Object.freeze({ VERSION, STORE_KEY, BACKUP_KEY, ZOOM, TEXT, TEXT_WORDS, DENSITIES, DETAILS, DEFAULTS, FIELDS, zoomOf, zoomFromFactor, textOf, textPercent, textWord, densityOf, detailOf, normalize, fromStore, same, changedFields, words });

  // ---- what the model stands on --------------------------------------------------
  const appearanceApi = () => window.MefiAppearance;
  const hostApi = () => window.mefiStudio;
  const canZoom = () => typeof hostApi()?.uiZoom === "function";
  const v2 = () => document.documentElement?.dataset?.layout === "v2";
  const toast = (text, kind = "info", options) => { try { return window.MefiToast?.(text, kind, options) ?? null; } catch { return null; } };
  const say = (error, fallback) => { try { return window.MefiUi?.plainError ? window.MefiUi.plainError(error, fallback) : fallback; } catch { return fallback; } };
  const later = (run) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(run) : setTimeout(run, 16));
  const state = {
    started: false, zoom: ZOOM.fallback, zoomAsked: false, base: { ...DEFAULTS }, draft: { ...DEFAULTS },
    listeners: new Set(), watchers: new Set(), toast: null, source: "", busy: null, last: null, away: false,
  };

  function readStore() {
    let stored = null;
    try { stored = appearanceApi()?.get?.() ?? null; } catch { /* the store is unreadable: the defaults */ }
    return fromStore(stored);
  }
  const currentApplied = () => ({ zoom: state.zoom, ...readStore() });
  // The first write to an older store keeps what it said.
  function backupOnce() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (typeof raw !== "string" || localStorage.getItem(BACKUP_KEY) !== null) return;
      let stored = null;
      try { stored = JSON.parse(raw); } catch { /* unreadable text is worth keeping too */ }
      if (isObject(stored) && stored.v >= VERSION) return;
      localStorage.setItem(BACKUP_KEY, raw);
    } catch { /* a backup is a courtesy, never a reason to refuse */ }
  }
  function writeStore(next) {
    const api = appearanceApi();
    if (typeof api?.apply !== "function") return false;
    backupOnce();
    api.apply({ v: VERSION, density: next.density, text: next.text, detail: next.detail });
    return true;
  }

  // ---- painting the window ---------------------------------------------------------
  function setVar(node, name, value) {
    if (!node?.style) return;
    if (typeof node.style.setProperty === "function") node.style.setProperty(name, value);
    else node.style[name] = value;
  }
  // html[data-detail] and --text-scale. html[data-density] is MefiAppearance's; it is
  // checked here only so a window that has it wrong (an older studio-ui.js) is put right.
  function paint(setting) {
    const root = document.documentElement;
    if (!root) return;
    if (!v2() || !setting) {
      delete root.dataset.detail;
      if (typeof root.style?.removeProperty === "function") root.style.removeProperty("--text-scale");
      return;
    }
    root.dataset.detail = setting.detail;
    setVar(root, "--text-scale", String(setting.text));
    if (root.dataset.density !== setting.density) root.dataset.density = setting.density;
  }

  // ---- the draft and what the window has ---------------------------------------------
  function notify(detail) {
    for (const listener of [...state.listeners]) { try { listener(detail); } catch { /* one listener never stops the others */ } }
  }
  function draftChanged() {
    for (const watcher of [...state.watchers]) { try { watcher(); } catch { /* the page repaints, or it does not */ } }
  }
  // Something may have changed what the window has: the store (a style preset, an
  // Apply), the zoom (Ctrl +, the host). The draft follows every field the person had
  // not touched, so a press of Ctrl + never leaves a draft that looks edited.
  function refresh(source) {
    const next = currentApplied();
    const previous = state.base;
    const changed = changedFields(next, previous);
    if (!changed.length) return false;
    for (const key of changed) if (state.draft[key] === previous[key]) state.draft[key] = next[key];
    state.base = next;
    paint(next);
    notify({ applied: { ...next }, previous: { ...previous }, changed, source: state.source || source });
    draftChanged();
    return true;
  }
  function get() {
    if (v2()) askZoom();
    return currentApplied();
  }
  const draft = () => ({ ...state.draft });
  const dirty = () => !same(state.draft, currentApplied());
  function preview(input) {
    if (!v2() || !isObject(input)) return draft();
    const next = normalize(input, state.draft);
    if (!canZoom()) next.zoom = state.draft.zoom;
    if (!same(next, state.draft)) { state.draft = next; draftChanged(); }
    return draft();
  }
  function discard() {
    const now = currentApplied();
    if (!same(state.draft, now)) { state.draft = { ...now }; draftChanged(); }
    return draft();
  }

  // ---- the window's scale: the host's zoom ------------------------------------------
  function setZoom(percent, source) {
    const next = zoomOf(percent);
    if (next === state.zoom) return false;
    state.zoom = next;
    return refresh(source);
  }
  // The scale is read once, when something first asks; Ctrl + and Ctrl - push after that.
  function askZoom() {
    if (state.zoomAsked || !v2() || typeof hostApi()?.uiZoomGet !== "function") return;
    state.zoomAsked = true;
    Promise.resolve().then(() => hostApi().uiZoomGet()).then((result) => {
      if (result?.ok !== false && isNumber(result?.factor)) setZoom(zoomFromFactor(result.factor), "host");
    }).catch(() => { state.zoomAsked = false; });
  }
  async function putZoom(percent) {
    const result = await hostApi().uiZoom({ factor: percent / 100 });
    if (result?.ok === false) throw new Error(result.error || "The scale was not saved.");
    return isNumber(result?.factor) ? zoomFromFactor(result.factor) : percent;
  }

  // ---- Apply, Reset and Undo ------------------------------------------------------------
  // Applies `input` (whole or partial, read against what the window has now), or the
  // draft when there is none. The scale goes first: if the host refuses it nothing else
  // changes. When it is done the draft is what the window has; when it is refused the
  // draft keeps what was asked for, so the person can try again.
  async function apply(input, options = {}) {
    if (!v2()) return { ok: false, error: "Size and density are part of the 0.5 layout." };
    if (state.busy) return state.busy;
    const run = (async () => {
      const previous = currentApplied();
      const next = input === undefined || input === null ? normalize(state.draft, previous) : normalize(input, previous);
      if (!canZoom()) next.zoom = previous.zoom;
      const changed = changedFields(next, previous);
      state.draft = { ...next };
      if (!changed.length) { draftChanged(); return { ok: true, applied: previous, previous, changed }; }
      state.source = options.source || "apply";
      try {
        if (changed.includes("zoom")) state.zoom = await putZoom(next.zoom);
        if (changed.some((key) => key !== "zoom") && !writeStore(next)) throw new Error("The size could not be saved.");
      } catch (error) {
        refresh(state.source);
        state.source = "";
        draftChanged();
        const message = say(error, "The size was not saved.");
        toast(message, "bad");
        return { ok: false, error: message };
      }
      refresh(state.source);
      state.source = "";
      draftChanged();
      const applied = currentApplied();
      if (options.source !== "undo") state.last = { previous, applied };
      if (options.toast !== false) offerUndo(previous, applied, options.note);
      return { ok: true, applied, previous, changed };
    })();
    state.busy = run.finally(() => { state.busy = null; });
    return state.busy;
  }
  function offerUndo(previous, applied, note) {
    try { state.toast?.dismiss?.(); } catch { /* it has gone already */ }
    state.toast = toast(note || `Applied to the whole window: ${words(applied)}.`, "good", { duration: 6000, action: { label: "Undo", run: () => { void undo(previous); } } });
  }
  // Puts back what the last Apply changed (or the setting it is given).
  function undo(previous = state.last?.previous) {
    if (!previous) return Promise.resolve({ ok: false, error: "There is nothing to undo." });
    state.last = null;
    return apply(previous, { source: "undo", toast: false });
  }
  function reset() {
    return apply({ ...DEFAULTS }, { source: "reset", note: `Back to the defaults: ${words(DEFAULTS).replace(/ · /g, ", ")}.` });
  }
  function onChange(callback) {
    if (typeof callback !== "function") return () => {};
    state.listeners.add(callback);
    return () => { state.listeners.delete(callback); };
  }
  // A token's value in px as the window has it now (--d-tab is the tab strip's height),
  // for a region that must be told its size in numbers (MefiShell.resize, MefiNav.layout.set).
  function metric(name) {
    try { const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(`--d-${name}`)); return Number.isFinite(value) ? value : null; } catch { return null; }
  }

  // ---- the page ----------------------------------------------------------------------------
  const ui = { built: false, attached: false, frame: 0, k: 1, observer: null, onResize: null, onPanels: null };
  const $ = (id) => document.getElementById(`size-${id}`);
  const text = (value) => document.createTextNode(String(value));
  // A node with a class, attributes ("text" sets its words) and children (strings become text).
  const h = (tag, className, attrs, ...children) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === false || value === undefined || value === null) continue;
      if (key === "text") node.textContent = value;
      else node.setAttribute(key, value === true ? "" : String(value));
    }
    for (const child of children) if (child !== null && child !== undefined && child !== false) node.append(typeof child === "string" ? text(child) : child);
    return node;
  };
  const isOpen = () => Boolean($("overlay")) && !$("overlay").hidden;

  // What the miniature draws: a small project, not the person's own. Every name is invented.
  const SAMPLE = {
    groups: [
      { label: "Needs you", warn: true, rows: [
        { dot: "need", title: "Add an empty state to the list", meta: "Asking a question · 4 min", more: ["builder-1 · OpenCode", "task/empty-state", "+66 −1", "checks 1/5"], selected: true },
      ] },
      { label: "Running", rows: [
        { dot: "run", title: "Search notes by tag", meta: "builder-2 · 40 min · step 4/5", progress: 72, more: ["builder-2 · Claude Code", "mefi/run_8f2c", "+148 −12", "checks 2/3"] },
        { dot: "run", title: "Keyboard shortcut for a new note", meta: "builder-3 · 6 min · step 2/4", progress: 34, more: ["builder-3 · OpenCode", "task/new-note-key", "+23 −0", "checks 0/3"] },
      ] },
      { label: "Review", rows: [
        { dot: "rev", title: "Export notes as Markdown", meta: "Checks passed · 12 min ago", more: ["builder-2 · OpenCode", "task/export-md", "+212 −18", "checks 5/5"] },
      ] },
      { label: "Done", rows: [
        { dot: "done", title: "Rename the page header", meta: "Verified · yesterday", more: ["builder-1 · OpenCode", "+4 −4", "checks 3/3"] },
      ] },
    ],
    title: "Add an empty state to the list",
    brief: "Add an empty state to the notes list: a short line saying there are no notes yet, and a Create note button.",
    diffHead: "src/notes/EmptyState.tsx · new file",
    diff: ["export function EmptyState() {", "  return <p>No notes yet.</p>;", "}", "", "<EmptyState onCreate={create} />"],
    files: [["src/notes/", "EmptyState.tsx", "+42"], ["src/notes/", "NotesList.tsx", "+6"], ["src/styles/", "notes.css", "+18"]],
  };

  function miniRow(row) {
    const extra = h("div", "sm-rx");
    for (const item of row.more) extra.append(h("span", "", { text: item }));
    let progress = null;
    if (row.progress) { const bar = h("i"); bar.style.width = `${row.progress}%`; progress = h("div", "sm-rp", null, bar); }
    return h("div", `sm-row${row.selected ? " sm-sel" : ""}`, null,
      h("span", `sm-dot sm-${row.dot}`),
      h("div", "sm-rb", null, h("span", "sm-t", { text: row.title }), h("div", "sm-m", { text: row.meta }), progress, extra));
  }
  function buildMini() {
    const list = h("div", "sm-list");
    for (const group of SAMPLE.groups) {
      list.append(h("div", `sm-gh${group.warn ? " sm-warn" : ""}`, null, group.label, h("em", "", { text: String(group.rows.length) })));
      for (const row of group.rows) list.append(miniRow(row));
    }
    const thread = h("div", "sm-thread", null,
      h("div", "sm-title", { text: SAMPLE.title }),
      h("div", "sm-chips", null, h("span", "sm-chip sm-need", { text: "Needs you" }), h("span", "sm-chip", { text: "builder-1 · OpenCode" })),
      h("div", "", null, h("div", "sm-who", null, h("span", "sm-av", { text: "N" }), "You · 5:41 PM"), h("div", "sm-bubble", { text: SAMPLE.brief })),
      h("div", "sm-diff", null, h("div", "", { text: SAMPLE.diffHead }), ...SAMPLE.diff.map((line, at) => h("div", "sm-dl", null, h("i", "", { text: String(at + 1) }), h("span", "", { text: line })))));
    const files = h("div", "sm-files");
    SAMPLE.files.forEach(([where, name, plus], at) => files.append(h("div", `sm-file${at === 0 ? " sm-on" : ""}`, null, h("span", "", null, where, h("b", "", { text: name })), h("span", "sm-plus", { text: plus }))));
    const insp = h("div", "sm-insp", null,
      h("div", "sm-itabs", null, h("span", "", { text: "Plan" }), h("span", "sm-on", null, "Changes ", h("em", "", { text: "3" })), h("span", "", { text: "Checks" })),
      h("div", "sm-ipad", null, files, h("div", "sm-card", null, h("div", "sm-card-title", null, "Acceptance checks", h("small", "", { text: "1 of 5" })), h("p", "", { text: "Renders when there are no notes" }))));
    const main = h("div", "sm-main", null,
      h("div", "sm-top", null, h("span", "sm-seg", null, h("span", "", { text: "Vibe" }), h("span", "sm-on", { text: "Build" })), h("span", "", null, "Notes app / ", h("b", "", { text: SAMPLE.title }))),
      h("div", "sm-tabs", null,
        h("span", "sm-tab sm-pin", null, h("span", "", { text: "Today" })),
        h("span", "sm-tab sm-on", null, h("span", "sm-dot sm-need"), h("span", "", { text: SAMPLE.title })),
        h("span", "sm-tab sm-preview", null, h("span", "sm-dot sm-run"), h("span", "", { text: "Search notes by tag" }))),
      h("div", "sm-body", null, thread, insp));
    const frame = h("div", "sm-frame", null,
      h("div", "sm-rail", null, h("i", "sm-logo"), h("i", "sm-here"), h("i"), h("i"), h("i")),
      list, main,
      h("div", "sm-status", null, h("span", "", null, h("i"), "2 working"), h("span", "", { text: "1 waiting on you" }), h("span", "sm-end", { text: "Auto" })));
    const mini = h("div", "size-mini", { role: "img", "data-mini-density": DEFAULTS.density, "data-mini-detail": DEFAULTS.detail },
      h("div", "size-mini-fit", null, h("div", "size-mini-win", null, h("div", "size-mini-z", null, frame))));
    mini.inert = true;
    mini.setAttribute("inert", "");
    return mini;
  }

  // A row of controls: a label line, a hint, then the control itself.
  const row = (key, label, hint, ...rest) => h("div", "size-row", { "data-control": key }, label, h("p", "size-hint", { text: hint }), ...rest);
  // Where a tick sits along the slider, as a share of its range (100% is not the middle of 70..150).
  const tick = (label, at) => { const node = h("span", "", { text: label }); setVar(node, "--at", `${at}%`); return node; };
  function sliderRow(key, title, hint, { min, max, step, marks, change }) {
    const input = h("input", "", { type: "range", min, max, step });
    input.id = `size-${key}`;
    const out = h("output", "", { for: `size-${key}` });
    out.id = `size-${key}-out`;
    input.addEventListener("input", () => change(Number(input.value)));
    const ticks = h("div", "size-ticks", null, ...marks.map(([label, at]) => tick(label, at)));
    return row(key, h("div", "size-label", null, h("label", "", { for: `size-${key}`, text: title }), out), hint, input, ticks);
  }
  function choiceRow(key, title, hint, choices, change) {
    const group = h("div", "size-seg", { role: "radiogroup", "aria-label": title });
    group.id = `size-${key}`;
    for (const [value, label] of choices) {
      const button = h("button", "", { type: "button", role: "radio", "aria-checked": "false", tabindex: "-1", "data-value": value, text: label });
      button.addEventListener("click", () => change(value));
      group.append(button);
    }
    // Arrows move the choice and the focus together, like any radio group.
    group.addEventListener("keydown", (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const moves = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
      const buttons = [...group.querySelectorAll("button")];
      const at = Math.max(0, buttons.indexOf(event.target?.closest?.("button")));
      let next = -1;
      if (event.key in moves) next = (at + moves[event.key] + buttons.length) % buttons.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = buttons.length - 1;
      if (next < 0) return;
      event.preventDefault?.();
      change(buttons[next].dataset.value);
      buttons[next].focus?.({ preventScroll: true });
    });
    return row(key, h("div", "size-label", null, h("b", "", { text: title })), hint, group);
  }

  function build() {
    if (ui.built) return true;
    const body = $("body");
    if (!body) return false;
    ui.built = true;
    const zoom = sliderRow("zoom", "Interface scale", "Everything grows or shrinks together, like zoom. Ctrl + and Ctrl − do it too.", { min: ZOOM.min, max: ZOOM.max, step: ZOOM.step, marks: [["70%", 0], ["100%", 37.5], ["150%", 100]], change: (value) => preview({ zoom: value }) });
    const size = sliderRow("text", "Text size", "Only the words change. Text never goes below 12 px.", { min: Math.round(TEXT.min * 100), max: Math.round(TEXT.max * 100), step: Math.round(TEXT.step * 100), marks: [["80%", 0], ["100%", 100 / 3], ["140%", 100]], change: (value) => preview({ text: value / 100 }) });
    const density = choiceRow("density", "Density", "Row heights, gaps and padding.", DENSITIES, (value) => preview({ density: value }));
    const detail = choiceRow("detail", "Detail", "How much each session row and board card shows.", DETAILS.map(([key, label]) => [key, label]), (value) => preview({ detail: value }));
    const grid = h("dl", "size-grid");
    grid.id = "size-panels";
    const panels = h("section", "size-panel", { "aria-label": "Panels" },
      h("h3", "", null, h("span", "", { text: "Panels" }), h("small", "", { text: "" })),
      grid,
      h("p", "size-note", { text: "Each mode remembers its own. Drag the edge of a panel to resize it; a double-click on the edge puts it back." }));
    const applyButton = h("button", "primary", { type: "button", text: "Apply" });
    applyButton.id = "size-apply";
    const resetButton = h("button", "ghost", { type: "button", text: "Reset", title: "Back to 100%, default text, comfortable, titles and status" });
    resetButton.id = "size-reset";
    const discardButton = h("button", "size-link", { type: "button", text: "Discard changes" });
    discardButton.id = "size-discard";
    const stateText = h("span", "size-state", { role: "status", "aria-live": "polite" });
    stateText.id = "size-state";
    const appliedText = h("p", "size-applied");
    appliedText.id = "size-applied";
    const host = h("div", "size-mini-host");
    host.id = "size-mini-host";
    const mini = buildMini();
    mini.id = "size-mini";
    host.append(mini);
    const side = h("div", "size-preview", null,
      h("div", "size-cap", null, h("b", "", { text: "Preview" }), h("span", "size-sample", { text: "Sample data" }), stateText),
      host, appliedText,
      h("div", "size-actions", null, applyButton, resetButton, discardButton));
    side.id = "size-preview";
    body.replaceChildren(
      h("div", "size-wrap", null,
        h("p", "size-intro", { text: "Move a control and the preview beside it changes at once. The rest of the window changes when you press Apply, so you never have to flip back and forth." }),
        h("div", "size-controls", null,
          h("section", "size-panel", { "aria-label": "Size and density" }, zoom, size, density, detail),
          panels,
          h("p", "size-aside", { text: "Pages from before the 0.5 layout are drawn in fixed pixels, so the interface scale is what resizes them. Text size, density and detail change the new panels." })),
        side));
    applyButton.addEventListener("click", () => { void apply(); });
    resetButton.addEventListener("click", () => { void reset(); });
    discardButton.addEventListener("click", () => { discard(); });
    // Close leaves the way Back and Esc do: through the navigation's history.
    $("close")?.addEventListener("click", () => { if (typeof window.MefiNav?.close === "function") window.MefiNav.close("size"); else close(); });
    $("overlay").addEventListener("keydown", onKey);
    return true;
  }
  // Ctrl+Enter applies from anywhere on the page, for the keyboard.
  function onKey(event) {
    if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || !dirty()) return;
    event.preventDefault?.();
    void apply();
  }

  // ---- drawing what the state says ------------------------------------------------------------
  // How far along its track a slider's thumb is, as the percent its fill runs to.
  const fill = (share) => `${Math.round(share * 10000) / 100}%`;
  function paintControls() {
    const d = state.draft;
    const zoom = $("zoom"), size = $("text");
    if (zoom) {
      if (Number(zoom.value) !== d.zoom) zoom.value = String(d.zoom);
      zoom.disabled = !canZoom();
      setVar(zoom, "--fill", fill((d.zoom - ZOOM.min) / (ZOOM.max - ZOOM.min)));
      zoom.setAttribute("aria-valuetext", `${d.zoom} percent`);
      $("zoom-out").textContent = `${d.zoom}%`;
    }
    if (size) {
      const percent = textPercent(d.text);
      if (Number(size.value) !== percent) size.value = String(percent);
      setVar(size, "--fill", fill((d.text - TEXT.min) / (TEXT.max - TEXT.min)));
      size.setAttribute("aria-valuetext", `${textWord(d.text)}, ${percent} percent`);
      $("text-out").textContent = `${percent}% · ${textWord(d.text)}`;
    }
    for (const [key, group] of [["density", $("density")], ["detail", $("detail")]]) {
      for (const button of group?.querySelectorAll?.("button") ?? []) {
        const on = button.dataset.value === d[key];
        button.setAttribute("aria-checked", String(on));
        button.setAttribute("tabindex", on ? "0" : "-1");
      }
    }
  }
  // The miniature: the draft under its own scope. The root is not touched.
  function paintMini() {
    const mini = $("mini");
    if (!mini) return;
    const d = state.draft, now = currentApplied();
    mini.dataset.miniDensity = d.density;
    mini.dataset.miniDetail = d.detail;
    setVar(mini, "--mini-text-scale", String(d.text));
    setVar(mini, "--mini-zoom", String(Math.round((d.zoom / now.zoom) * 10000) / 10000));
    mini.setAttribute("aria-label", `Preview of the window on sample data: ${words(d)}`);
  }
  function paintState() {
    const now = currentApplied(), changed = !same(state.draft, now);
    const label = $("state");
    if (label) {
      label.textContent = changed ? "Not applied yet" : "This is what the window looks like now";
      if (changed) label.setAttribute("data-dirty", ""); else label.removeAttribute("data-dirty");
    }
    const applyButton = $("apply"), discardButton = $("discard"), note = $("applied");
    if (applyButton) {
      const held = document.activeElement === applyButton;
      applyButton.disabled = !changed;
      // A button that has just nothing left to do hands the keyboard back to the first control.
      if (held && !changed) $("zoom")?.focus?.({ preventScroll: true });
    }
    if (discardButton) discardButton.hidden = !changed;
    if (note) note.replaceChildren(text(changed ? "Not applied yet. The window is still " : "The window now: "), h("b", "", { text: words(now) }), text(changed ? ` and this preview shows ${words(state.draft)}.` : "."));
  }
  function modeName() {
    let mode = null;
    try { mode = window.MefiShell?.mode?.() ?? window.MefiVibe?.mode?.() ?? null; } catch { /* no mode to name */ }
    return mode === "vibe" ? "Vibe" : mode === "build" ? "Build" : "";
  }
  // The panels' sizes as the window has them, read-only: MefiShell knows them when it is there.
  function panelSizes() {
    const shell = window.MefiShell, nav = window.MefiNav;
    const read = (name) => {
      try { const value = shell?.size?.(name); if (Number.isFinite(value)) return value; } catch { /* ask the layout */ }
      try { const value = nav?.layout?.used?.(name); if (Number.isFinite(value)) return value; } catch { /* nothing to read */ }
      return 0;
    };
    let folded = [];
    try { folded = nav?.layout?.fold?.() ?? []; } catch { /* nothing is folded */ }
    const rows = [["List", "list", "closed"], ["Inspector", "inspector", "closed"], ["Tab strip", "tabs", "off"], ["Status bar", "status", "off"]].map(([label, key, none]) => {
      const px = read(key);
      return [label, folded.includes(key) ? "a drawer in this window" : px > 0 ? `${px} px` : none];
    });
    let rail = NaN;
    try { rail = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--shell-rail-w")); } catch { /* no rail to measure */ }
    rows.push(["Rail", Number.isFinite(rail) && rail > 0 ? `${rail} px` : "off"]);
    return rows;
  }
  function paintPanels() {
    const grid = $("panels");
    if (!grid) return;
    const mode = modeName();
    const heading = grid.parentNode?.querySelector?.("small");
    if (heading) heading.textContent = mode ? `in ${mode}` : "";
    const cells = [];
    for (const [label, value] of panelSizes()) cells.push(h("dt", "", { text: label }), h("dd", "", { text: value }));
    grid.replaceChildren(...cells);
  }
  // The whole picture is shrunk to fit its column, never taller than a share of the
  // pane (a smaller one when the page is one column and the picture is kept in view),
  // so the page never grows a second scrollbar for it.
  function fitMini() {
    const mini = $("mini"), pane = $("body"), side = $("preview");
    if (!mini || !side || !isOpen()) return;
    // The same width the stylesheet's container query asks about (the pane's content box), and
    // the same height its media query does (max-height: 520px includes 520).
    let narrow = false;
    try { const box = getComputedStyle(pane); narrow = pane.clientWidth - parseFloat(box.paddingLeft) - parseFloat(box.paddingRight) <= 720; } catch { /* a wide page */ }
    const short = (window.innerHeight ?? 800) <= 520;
    const share = narrow ? (short ? 0.6 : 0.36) : 0.62;
    const tall = Math.max(narrow ? 96 : 150, (pane?.clientHeight ?? 440) * share);
    const k = Math.max(0.2, Math.min(1.25, (side.clientWidth || 760) / 760, tall / 440));
    if (Math.abs(k - ui.k) > 0.002) { ui.k = k; setVar(mini, "--mini-fit", String(Math.round(k * 10000) / 10000)); }
  }
  function fitSoon() {
    if (ui.frame) return;
    ui.frame = later(() => { ui.frame = 0; fitMini(); });
  }
  function paintAll() {
    if (!ui.built) return;
    paintControls();
    paintMini();
    paintState();
    fitSoon();
  }

  // ---- opening and closing -----------------------------------------------------------------------
  // What only matters while the page is in view is listened to only then.
  function attach() {
    if (ui.attached) return;
    ui.attached = true;
    ui.onResize = () => fitSoon();
    ui.onPanels = () => paintPanels();
    window.addEventListener("resize", ui.onResize);
    window.addEventListener("mefi:shell-layout", ui.onPanels);
    window.addEventListener("mefi:layout", ui.onPanels);
    state.watchers.add(paintAll);
    if (typeof ResizeObserver === "function" && $("preview")) { ui.observer = new ResizeObserver(() => fitSoon()); ui.observer.observe($("preview")); }
  }
  function detach() {
    if (!ui.attached) return;
    ui.attached = false;
    window.removeEventListener("resize", ui.onResize);
    window.removeEventListener("mefi:shell-layout", ui.onPanels);
    window.removeEventListener("mefi:layout", ui.onPanels);
    state.watchers.delete(paintAll);
    ui.observer?.disconnect?.();
    ui.observer = null;
  }
  function open(params = {}) {
    if (!state.started || !v2() || !$("overlay") || !build()) return false;
    window.MefiNav?.claim?.("size");
    $("overlay").hidden = false;
    attach();
    askZoom();
    refresh("open");
    // A draft from an earlier visit is still here; the controls show it.
    paintAll();
    paintPanels();
    if (params?.focus !== false) later(() => $("zoom")?.focus?.({ preventScroll: true }));
    return true;
  }
  function close() {
    if (!isOpen()) return;
    detach();
    $("overlay").hidden = true;
    window.MefiNav?.release?.("size");
  }
  // The way in for another module (the status bar's Layout menu): through the navigation, so
  // the page has a place in its history like every page (Back, Alt+Left); the record's own
  // open() above is what draws it.
  function enter(params) {
    if (!state.started || !v2()) return false;
    const nav = window.MefiNav;
    if (!isOpen() && typeof nav?.go === "function" && nav.get?.("size")) { nav.go("size", params ?? {}); return isOpen(); }
    return open(params);
  }

  // ---- the way in --------------------------------------------------------------------------------
  function register() {
    const nav = window.MefiNav;
    if (typeof nav?.register !== "function") return;
    const terms = "size text font zoom scale density compact comfortable spacious detail titles status everything bigger smaller larger preview miniature layout";
    const desc = "How big the window and its text are, how roomy rows are and how much each row says, with a live preview";
    nav.register({
      id: "size", label: "Size and density", short: "Size", kind: "overlay", layer: "sheet", section: "settings", group: "tools",
      key: null, glyph: "g-textsize", badge: null, desc, searchTerms: terms,
      showIn: { tabs: false, tools: false, dock: false, palette: true, help: false, footer: false },
      element: "size-overlay", focus: "#size-zoom",
      open: (params) => open(params), close: () => close(), isOpen,
    });
    // The row Configuration files under UI & Surfaces, and Search reaches Settings by.
    nav.register({
      id: "settings:size", label: "Settings › Appearance › Size and density", short: "Size and density", kind: "action", layer: null, section: "settings", group: "system",
      key: null, glyph: "g-textsize", badge: null, desc, searchTerms: terms,
      showIn: { tabs: false, tools: false, dock: false, palette: false, help: false, footer: false },
      run: () => nav.go?.("size"),
    });
  }
  // Settings > Appearance had a Density list of its own: the choice now has one home, so
  // that row says where it is and what it is now, and opens it.
  function decorateAppearance() {
    const select = document.getElementById("studio-density");
    const field = select?.closest?.(".studio-field");
    if (!field || field.dataset.sizeLink) return;
    field.dataset.sizeLink = "1";
    field.hidden = true;
    const summary = h("span", "size-aside");
    const openButton = h("button", "ghost mini", { type: "button", text: "Open Size and density", title: "Text size, density and detail, with a live preview" });
    openButton.addEventListener("click", () => window.MefiNav?.go?.("size"));
    const link = h("div", "studio-field size-link-row", { "data-size-link": "row" }, h("span", "", { text: "Size and density" }), h("div", "", null, summary, openButton));
    field.after?.(link);
    const showWords = () => { summary.textContent = words(currentApplied()); };
    showWords();
    onChange(showWords);
  }

  // ---- starting ------------------------------------------------------------------------------------
  // MefiAppearance writes html[data-density]; asking it to write again, with nothing new
  // and nothing saved, puts the density on the root as this window's layout knows it.
  function putDensity() {
    try { appearanceApi()?.apply?.({}, false); } catch { /* the store will do it on its next change */ }
  }
  function onAppearance() { if (!refresh("appearance")) paint(currentApplied()); }
  function onZoomPush(payload) {
    if (isNumber(payload?.factor)) setZoom(zoomFromFactor(payload.factor), "keys");
  }
  // The layout can be switched off and on again while the window is open (MefiNav.setLayout):
  // off takes the text size and detail off the window, on puts them back.
  function onLayout(event) {
    const on = event?.detail?.on;
    if (on === false) { state.away = true; paint(null); putDensity(); }
    else if (on === true && state.away) { state.away = false; paint(currentApplied()); putDensity(); }
  }
  function start() {
    if (state.started || !v2()) return;
    state.started = true;
    state.base = currentApplied();
    state.draft = { ...state.base };
    window.addEventListener("mefi:appearance", onAppearance);
    window.addEventListener("mefi:layout", onLayout);
    hostApi()?.onUiZoom?.(onZoomPush);
    // The saved text size and detail go on before the window's first paint, and the
    // density with them ("spacious" is on the root only in a v2 window).
    paint(state.base);
    putDensity();
    register();
    decorateAppearance();
  }

  window.MefiSize = Object.freeze({ get, preview, apply, reset, onChange, draft, discard, dirty, undo, open: enter, close, isOpen, metric, model, words, start });
  // nav.js decides the layout when the page has loaded; this runs after it.
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
