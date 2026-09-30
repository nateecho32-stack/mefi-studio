// The launch screen inside the startup gate: which project to open, and
// whether the agents may start. It runs before any readiness step reads the
// workspace, so the steps load the project the user named. Choosing only
// selects the project on the host; the agents stay held (autopilot.held in
// main.cjs) until the studio is up and the Start agents switch chosen here (or
// the workspace's Start agents control) releases them. Diagnostic launches, a
// renderer reload after the choice, a launch that resumed a session still in
// progress, and any bridge without the startup contract skip the screen.
//
// The card is a quiet list: one primary Open that never moves, a Start agents
// switch that only decides this launch (Settings › General "When Studio opens"
// stays the lasting choice), a row per project (tile, name, path, a Git chip
// that arrives after the rows do, when it was last opened) and three ways to
// add one: Open a folder, Start a new app and Get from GitHub. It draws what
// the host says and never guesses, so a chip nobody could read shows nothing.
// Pinned by tests/startup_screen.test.mjs and tests/startup_resume.test.mjs;
// the card's look is the launch block of styles.css. When the host carries
// the day's news, renderer/daily-paper.js sets a front page around the card
// (tests/daily_paper.test.mjs); nothing in the card changes for it.
(function () {
  "use strict";
  const $ = (id) => document.getElementById("boot-" + id);
  const api = () => window.mefiStudio;
  const available = () => Boolean(api()?.startupState && api()?.startupChoose && api()?.startupBegin);
  const MISSING = "That project folder is unavailable. Reconnect it before switching.";
  const FILTER_FROM = 6;
  const GLANCE_BATCH = 6;
  const state = {
    projects: [], selectedId: null, busy: false, launch: null,
    agents: null, // null follows the launch setting; true or false is the owner's own switch
    panel: null, opener: null, github: null, filter: "", none: null, shape: null,
    run: 0, isCurrent: () => true, finish: null,
    rows: new Map(), panelControls: [],
    glance: new Map(), asked: new Set(), pending: new Set(),
  };
  let ui = {};

  function node(tag, className, textContent) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (textContent !== undefined) element.textContent = textContent;
    return element;
  }

  // ---- glyphs: kit section 3, one drawing per Git state and a few for the card ----
  const path = (d, extra = {}) => ["path", { d, ...extra }];
  const circle = (cx, cy, r, extra = {}) => ["circle", { cx, cy, r, ...extra }];
  const DASHED = { pathLength: 40, "stroke-dasharray": "3 2" };
  const FOLDER = "M2 12.5v-8a1 1 0 0 1 1-1h3.2l1.5 1.7H13a1 1 0 0 1 1 1v6.3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z";
  const CLOUD = "M4.5 13a2.9 2.9 0 0 1-.5-5.75 4.1 4.1 0 0 1 7.9-.55A3.15 3.15 0 0 1 11.5 13z";
  const CHECKED = [circle(8, 8, 6), path("M5.3 8.2 7.2 10l3.5-3.7")];
  const ARC = path("M8 1.4A6.6 6.6 0 1 1 1.4 8");
  const GLYPHS = {
    "not-repo": [path(FOLDER, DASHED)],
    "no-commits": [path("M1.5 8h3.5"), circle(8, 8, 3), path("M11.6 8h.01M14.2 8h.01")],
    "no-remote": [path(CLOUD, DASHED)],
    "other-remote": [path("M6.7 8.7a3.3 3.3 0 0 0 5 .35l2-2a3.3 3.3 0 0 0-4.7-4.7l-1.15 1.15"), path("M9.3 7.3a3.3 3.3 0 0 0-5-.35l-2 2a3.3 3.3 0 0 0 4.7 4.7l1.15-1.15")],
    "signed-out": [path("M8 7.2a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2zM2.8 14c.4-2.6 2.4-3.8 5.2-3.8s4.8 1.2 5.2 3.8")],
    checking: [path("M13 8a5 5 0 0 1-8.7 3.4M3 8a5 5 0 0 1 8.7-3.4M12.2 2.2v2.6H9.6M3.8 13.8v-2.6h2.6")],
    "in-sync": CHECKED,
    success: CHECKED,
    ahead: [path("M8 12.5V4M4.8 7.2 8 4l3.2 3.2")],
    behind: [path("M8 3.5V12M4.8 8.8 8 12l3.2-3.2")],
    diverged: [path("M5 13V3M2.6 5.4 5 3l2.4 2.4M11 3v10M8.6 10.6 11 13l2.4-2.4")],
    uncommitted: [path("M4 2.5h5l3 3v8H4zM9 2.5v3h3"), circle(8, 10, 0.75)],
    "other-branch": [circle(4, 3.2, 1.4), circle(4, 12.8, 1.4), circle(12, 5.4, 1.4), path("M4 4.6v6.8M12 6.8c0 2.4-1.6 3.7-8 3.7")],
    "no-upstream": [path(CLOUD), path("M8 11V7.4M6.2 9 8 7.2 9.8 9")],
    offline: [path(CLOUD), path("M2.5 2.5l11 11")],
    "fetch-failed": [path(CLOUD), path("M8 6.6v2.4M8 10.9h.01")],
    "agents-working": [["rect", { x: 1.75, y: 4.5, width: 12.5, height: 7, rx: 3.5 }], circle(5, 8, 0.6), circle(8, 8, 0.6), circle(11, 8, 0.6)],
    saving: [ARC, path("M5.2 4.4h3.4l2.2 2.2v5H5.2zM8.6 4.4v2.2h2.2"), circle(8, 9.3, 0.55)],
    pushing: [ARC, path("M8 10.8V5.4M5.9 7.5 8 5.4l2.1 2.1")],
    pulling: [ARC, path("M8 5.2v5.4M5.9 8.5 8 10.6l2.1-2.1")],
    publishing: [path(CLOUD), path("M8 11V7.4M6.2 9 8 7.2 9.8 9")],
    "check-failed": [path("M3 3h10v10H3zM6 6l4 4M10 6l-4 4")],
    "lost-work": [path("M8 1.8 13 3.6v4c0 3-2 5.2-5 6.6-3-1.4-5-3.6-5-6.6v-4z"), path("M5.8 8h4.4")],
    conflict: [path("M3 4h3c3 0 4 8 7 8M3 12h3c3 0 4-8 7-8")],
    "push-refused": [circle(8, 8, 6), path("M5 8h6")],
    "blocked-secret": [circle(11.5, 5.5, 2.3), path("M9.2 5.5H2.5M3.6 5.5v2.2"), path("M2.5 2.5 13.5 13.5")],
    "too-large": [circle(8, 3.7, 1.5), path("M5.2 7.2h5.6l1.7 6.3h-9z")],
    "folder-missing": [path(FOLDER), path("M2.5 2.5l11 11")],
    unknown: [circle(8, 8, 6, { "stroke-dasharray": "0.01 3.14" })],
    "pull-refused": [path("M8 3.5V10M4.8 6.8 8 10l3.2-3.2M4.5 13h7")],
    error: [path("M8 2.4 14.4 13.4H1.6z"), path("M8 6.4v3.2M8 11.4h.01")],
    // the card's own
    folder: [path(FOLDER)],
    plus: [path("M8 3v10M3 8h10")],
    "cloud-download": [path("M5 11a2.6 2.6 0 0 1-.3-5.1 3.6 3.6 0 0 1 6.9-.6A2.8 2.8 0 0 1 11.5 11"), path("M8 7.5v6M5.9 11.4 8 13.5l2.1-2.1")],
    search: [circle(7, 7, 4.5), path("M10.4 10.4 13.5 13.5")],
    lock: [["rect", { x: 3.5, y: 7, width: 9, height: 6.5, rx: 1.5 }], path("M5.5 7V5a2.5 2.5 0 0 1 5 0v2")],
    globe: [circle(8, 8, 6), path("M2 8h12M8 2c1.7 1.7 2.6 3.7 2.6 6S9.7 12.3 8 14c-1.7-1.7-2.6-3.7-2.6-6S6.3 3.7 8 2z")],
  };
  const SVG_NS = "http://www.w3.org/2000/svg";
  // A glyph nobody drew shows the dotted ring, never nothing; a page without
  // SVG support (a test's stub document) draws no glyph at all.
  function svg(name) {
    if (typeof document.createElementNS !== "function") return null;
    const parts = GLYPHS[Object.hasOwn(GLYPHS, name) ? name : "unknown"];
    const root = document.createElementNS(SVG_NS, "svg");
    const attrs = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", "stroke-width": 1.5, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false", class: "boot-glyph" };
    for (const [key, value] of Object.entries(attrs)) root.setAttribute(key, String(value));
    for (const [tag, values] of parts) {
      const part = document.createElementNS(SVG_NS, tag);
      for (const [key, value] of Object.entries(values)) part.setAttribute(key, String(value));
      root.append(part);
    }
    return root;
  }
  // A button's face: an optional glyph and its words, in one span the layout can gap.
  function face(element, label, glyph) {
    element.replaceChildren(...[glyph ? svg(glyph) : null, node("span", "boot-label", label)].filter(Boolean));
  }

  // ---- what a row says ----
  const TONES = new Set(["neutral", "good", "info", "warn", "bad"]);
  const MISSING_CHIP = { id: "folder-missing", label: "Folder missing", tone: "warn", glyph: "folder-missing", sentence: MISSING };
  // A chip is drawn from the host's model, {id, label, tone, glyph, sentence}. Anything
  // that is not a readable label shows nothing rather than a guess.
  function chip(model) {
    if (!model || typeof model !== "object" || typeof model.label !== "string" || !model.label.trim()) return null;
    const element = node("span", "boot-chip");
    element.dataset.tone = TONES.has(model.tone) ? model.tone : "neutral";
    element.dataset.state = String(model.id ?? "").slice(0, 40);
    if (typeof model.sentence === "string" && model.sentence) element.title = model.sentence.slice(0, 300);
    const glyph = svg(Object.hasOwn(GLYPHS, model.glyph) ? model.glyph : model.id);
    element.append(...[glyph, node("span", "", model.label.slice(0, 40))].filter(Boolean));
    return element;
  }
  // The words are read out; the pulse is only for eyes.
  function skeleton() {
    const wrap = node("span", "boot-chip-wait");
    const pulse = node("span", "boot-chip-skeleton");
    pulse.setAttribute("aria-hidden", "true");
    wrap.append(pulse, node("span", "sr-only", "Checking GitHub"));
    return wrap;
  }
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // "12 minutes ago", "yesterday", "3 days ago", "Sep 3"; empty when the time is not known.
  function relative(at, now = Date.now()) {
    if (!Number.isFinite(at) || at <= 0) return "";
    const gap = Math.max(0, now - at), minute = 60000, hour = 60 * minute, day = 24 * hour;
    const count = (value, unit) => `${value} ${unit}${value === 1 ? "" : "s"} ago`;
    if (gap < minute) return "just now";
    if (gap < hour) return count(Math.floor(gap / minute), "minute");
    if (gap < day) return count(Math.floor(gap / hour), "hour");
    if (gap < 2 * day) return "yesterday";
    if (gap < 14 * day) return count(Math.floor(gap / day), "day");
    if (gap < 60 * day) return count(Math.floor(gap / (7 * day)), "week");
    const then = new Date(at);
    return `${MONTHS[then.getMonth()]} ${then.getDate()}${then.getFullYear() === new Date(now).getFullYear() ? "" : ", " + then.getFullYear()}`;
  }
  const openedText = (project) => {
    const when = relative(project.openedAt);
    return when ? (/^[A-Z]/.test(when) ? "Opened on " : "Opened ") + when : "";
  };
  // The drive and the folder name stay; CSS lets the middle give way.
  function splitPath(value) {
    const text = String(value ?? "").replace(/[\\/]+$/, "");
    const cut = Math.max(text.lastIndexOf("\\"), text.lastIndexOf("/"));
    return cut > 0 ? [text.slice(0, cut), text.slice(cut)] : ["", String(value ?? "")];
  }
  // The folder Studio would make for a name (scripts/new-app.cjs slugOf).
  const slugOf = (name) => String(name ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/g, "");
  const sameFolder = (a, b) => String(a ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase() === String(b ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

  // ---- state ----
  const selected = () => state.projects.find((project) => project.id === state.selectedId) ?? null;
  const missing = (project) => project?.available === false;
  // "When Studio opens" (main.cjs launchAgentsInfo): whether the selected
  // project opens with its agents running. It only sets the switch's starting
  // place; the switch is the owner's word for this launch.
  function startsAgents() {
    const launch = state.launch;
    if (!launch || !state.selectedId) return false;
    return launch.choice === "start" || (launch.choice === "resume" && launch.last?.agents === true && launch.last.projectId === state.selectedId);
  }
  const agentsOn = () => Boolean(state.selectedId) && (state.agents ?? startsAgents());
  function why() {
    if (!state.selectedId) return "You can add a folder later from the M+ menu.";
    if (!agentsOn()) return "Agents stay off until you start them.";
    if (state.agents === null && state.launch?.choice !== "start") return "Agents were running here when you left, so they start again.";
    return "Agents start when the studio opens. Change this in Settings › General.";
  }
  // Red is for a refusal; a missing folder is said plainly with its own glyph.
  function note(text, error = false) {
    const target = $("choose-note");
    if (!target) return;
    const gone = !state.panel && missing(selected());
    target.textContent = text || (state.panel ? "" : gone ? MISSING : why());
    target.classList.toggle("error", Boolean(error));
    target.dataset.kind = error ? "error" : !text && gone ? "missing" : "";
  }
  // The host's answer names the selection: a folder it just opened, a folder
  // it just added, the current pick if it still exists, else the active one.
  function adopt(result) {
    if (typeof result?.addedId === "string") clearFilter();
    if (Array.isArray(result?.projects)) state.projects = order(keepKnown(result.projects));
    const known = (id) => state.projects.some((project) => project.id === id);
    const preferred = [result?.selectedId, result?.addedId, state.selectedId, result?.activeId, state.projects[0]?.id].find((id) => typeof id === "string" && known(id));
    state.selectedId = preferred ?? null;
  }
  // Most recent first, but only when every project can say when it was opened.
  function order(list) {
    if (!list.length || !list.every((project) => Number.isFinite(project.openedAt))) return list;
    return list.map((project, index) => ({ project, index })).sort((a, b) => b.project.openedAt - a.project.openedAt || a.index - b.index).map((entry) => entry.project);
  }
  // A later answer that says nothing about a folder or a time keeps what was known.
  function keepKnown(list) {
    const before = new Map(state.projects.map((project) => [project.id, project]));
    return list.map((project) => {
      const old = before.get(project.id);
      return old ? { ...(old.available === undefined ? {} : { available: old.available }), ...(old.openedAt === undefined ? {} : { openedAt: old.openedAt }), ...project } : project;
    });
  }
  const matches = (project) => !state.filter || `${project.name ?? ""} ${project.path ?? ""}`.toLowerCase().includes(state.filter);
  const visible = () => state.projects.filter(matches);
  // A project just made, added or downloaded is the pick, and the filter typed
  // before it must not hide it or hand the pick to another row.
  function clearFilter() {
    state.filter = "";
    if (ui.filter) ui.filter.value = "";
  }

  // ---- drawing ----
  function row(project) {
    const on = project.id === state.selectedId, gone = missing(project);
    const wrap = node("div", "boot-row");
    const button = node("button", on ? "boot-project selected" : "boot-project");
    button.type = "button";
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", String(on));
    button.tabIndex = on ? 0 : -1;
    button.dataset.projectId = project.id;
    button.title = project.path || "";
    const [dir, leaf] = splitPath(project.path);
    const where = node("span", "boot-project-path");
    where.append(node("span", "boot-path-dir", dir), node("span", "boot-path-leaf", leaf));
    const text = node("span", "boot-project-text");
    text.append(node("span", "boot-project-name", project.name || project.path || "Project"), where);
    const side = node("span", "boot-project-side");
    const entry = { wrap, button, slot: null, remove: null };
    if (api()?.projectsGlance || gone) { entry.slot = node("span", "boot-chip-slot"); side.append(entry.slot); }
    const opened = openedText(project);
    if (opened) side.append(node("span", "boot-project-opened", opened));
    const tile = node("span", "boot-project-icon", String(project.name || "P").slice(0, 1).toUpperCase());
    tile.setAttribute("aria-hidden", "true");
    button.append(tile, text);
    if (side.children.length) button.append(side);
    button.addEventListener("click", () => { if (!state.busy) select(project.id); });
    button.addEventListener("dblclick", () => { if (state.busy) return; select(project.id); void state.finish?.(); });
    wrap.append(button);
    if (gone) {
      const actions = node("div", "boot-row-actions");
      const remove = node("button", "mini danger", "Remove from list");
      remove.type = "button";
      remove.dataset.removeId = project.id;
      remove.addEventListener("click", () => void removeProject(project));
      actions.append(remove);
      wrap.append(actions);
      entry.remove = remove;
    }
    state.rows.set(project.id, entry);
    paintChip(project.id);
    return wrap;
  }
  function paintChip(id) {
    const entry = state.rows.get(id);
    if (!entry?.slot) return;
    const project = state.projects.find((item) => item.id === id);
    const child = missing(project) ? chip(MISSING_CHIP) : state.pending.has(id) ? skeleton() : chip(state.glance.get(id)?.chip);
    entry.slot.replaceChildren(...(child ? [child] : []));
  }
  function render() {
    const list = $("projects");
    if (!list) return;
    const empty = !state.projects.length;
    state.rows = new Map();
    list.replaceChildren();
    if (empty) list.append(node("p", "boot-projects-empty", "No project is open yet. Open a folder and Studio will start there, or continue without one."));
    for (const project of state.projects) list.append(row(project));
    const none = node("p", "boot-projects-empty", "No project matches that.");
    none.hidden = true;
    state.none = none;
    list.append(none);
    if ($("choose")) $("choose").dataset.empty = String(empty);
    // Under the title: a line for a list, nothing for the first launch.
    if ($("detail")) $("detail").textContent = empty ? "" : "Pick a project to work on, or add one below.";
    // First launch: the way in leads and sits beside the quiet continue; a list
    // has the switch and Open in that place, and the folder verb joins the others.
    // Moving nodes drops focus, so they move only when the card changes shape.
    if (state.shape !== empty) {
      state.shape = empty;
      if (ui.go) ui.go.replaceChildren(...(empty ? [ui.add, ui.open] : [ui.sw, ui.open]).filter(Boolean));
      if (ui.verbs) ui.verbs.replaceChildren(...(empty ? [ui.newApp, ui.github] : [ui.add, ui.newApp, ui.github]).filter(Boolean));
    }
    applyFilter();
    paintControls();
    layout();
  }
  // Selection changes touch the rows in place: a row the pointer is on must not be replaced under a double click.
  function select(id, { focus = true } = {}) {
    state.selectedId = id;
    for (const [key, entry] of state.rows) {
      const on = key === id;
      entry.button.className = on ? "boot-project selected" : "boot-project";
      entry.button.setAttribute("aria-checked", String(on));
      entry.button.tabIndex = on ? 0 : -1;
    }
    paintControls();
    note("");
    if (focus) focusSelected();
  }
  function paintControls() {
    const empty = !state.projects.length, chosen = selected();
    if (ui.sw) { ui.sw.setAttribute("aria-checked", String(agentsOn())); ui.sw.hidden = !state.selectedId; }
    if (ui.add) { ui.add.className = empty ? "primary boot-add" : "boot-verb"; face(ui.add, "Open a folder…", "folder"); }
    if (!ui.open) return;
    ui.open.className = state.selectedId ? "primary" : "ghost";
    // A pick the filter hides (nothing matches) is not opened blind.
    ui.open.disabled = state.busy || missing(chosen) || Boolean(chosen && !matches(chosen));
    if (!state.busy) { ui.open.textContent = state.selectedId ? "Open" : "Continue without a project"; delete ui.open.dataset.busy; }
  }
  // A panel takes the list's place; the note stays where it is.
  function layout() {
    const open = Boolean(state.panel);
    if (ui.panel) ui.panel.hidden = !open;
    for (const part of [ui.list, ui.go, ui.verbs]) if (part) part.hidden = open;
    if (ui.filterRow) ui.filterRow.hidden = open || state.projects.length < FILTER_FROM;
  }
  function applyFilter() {
    let shown = 0;
    for (const project of state.projects) {
      const entry = state.rows.get(project.id);
      const on = matches(project);
      if (entry) entry.wrap.hidden = !on;
      if (on) shown += 1;
    }
    if (state.none) state.none.hidden = shown > 0 || !state.projects.length;
    const first = visible()[0];
    if (first && !matches(selected() ?? {})) select(first.id, { focus: false });
    else paintControls();
  }
  function setBusy(busy, label) {
    state.busy = busy;
    for (const element of [ui.open, ui.sw, ui.add, ui.newApp, ui.github, ui.filter, ...state.panelControls]) if (element) element.disabled = busy;
    for (const entry of state.rows.values()) { entry.button.disabled = busy; if (entry.remove) entry.remove.disabled = busy; }
    for (const button of state.github?.rows.values() ?? []) button.disabled = busy;
    if (busy && label && ui.open) { ui.open.textContent = label; ui.open.dataset.busy = "true"; }
    if (!busy) paintControls();
  }
  // Said to screen readers only: the visible words are the button's own.
  const announce = (text) => { if ($("live")) $("live").textContent = text; };
  function focusSelected() {
    const entry = state.rows.get(state.selectedId);
    if (entry) { entry.wrap.scrollIntoView?.({ block: "nearest" }); entry.button.focus?.({ preventScroll: true }); return; }
    (!state.projects.length ? ui.add : ui.open)?.focus?.({ preventScroll: true });
  }
  // A control that locks while the host works drops the keyboard to the page;
  // when the action ends and the screen stays up, focus goes back to where the
  // person was: the list, or the panel's own field or pick.
  function refocus() {
    const g = state.github;
    if (state.panel === "github") {
      const target = g?.rows.get(g.pick) ?? (g && !g.el.go.disabled ? g.el.go : null);
      if (target) target.focus?.({ preventScroll: true }); else state.focusFirst?.();
    } else if (state.panel) state.focusFirst?.();
    else focusSelected();
  }
  // The gate captures keyboard events before they reach the rows, so it
  // delegates radio navigation here while keeping workspace shortcuts locked.
  // Enter opens the row; a panel's own radio rows are routed to it.
  function navigateProjects(key) {
    if (state.busy) return false;
    if (state.panel) return state.panel === "github" ? navigateRepos(key) : false;
    if (!state.projects.length) return false;
    if (key === "Enter") { if (!state.finish) return false; void state.finish(); return true; }
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(key)) return false;
    const shown = visible();
    if (!shown.length) return false;
    const index = shown.findIndex((project) => project.id === state.selectedId);
    const next = key === "Home" ? 0 : key === "End" ? shown.length - 1 :
      (index + (["ArrowUp", "ArrowLeft"].includes(key) ? -1 : 1) + shown.length) % shown.length;
    select(shown[next].id);
    return true;
  }

  // ---- what the host can tell each row (projectsGlance), after the rows are up ----
  async function requestGlance() {
    if (typeof api()?.projectsGlance !== "function") return;
    const run = state.run;
    const ids = state.projects.filter((project) => !missing(project) && !state.asked.has(project.id)).map((project) => project.id);
    ids.sort((a, b) => (b === state.selectedId) - (a === state.selectedId));
    for (const id of ids) { state.asked.add(id); state.pending.add(id); paintChip(id); }
    for (let start = 0; start < ids.length; start += GLANCE_BATCH) {
      const batch = ids.slice(start, start + GLANCE_BATCH);
      let items = [];
      try {
        const answer = await api().projectsGlance(batch);
        if (answer?.ok !== false && Array.isArray(answer?.items)) items = answer.items;
      } catch (error) { console.warn("Project glance unavailable", error); }
      if (run !== state.run || !state.isCurrent()) return;
      for (const id of batch) {
        state.pending.delete(id);
        state.glance.set(id, items.find((item) => item?.id === id) ?? null);
        paintChip(id);
      }
    }
  }
  async function removeProject(project) {
    if (state.busy || !api()?.projectsRemove) return;
    setBusy(true);
    try {
      const result = await api().projectsRemove(project.id);
      if (!state.isCurrent()) return;
      if (result?.ok === false) note(result.error || "That project could not be removed.", true);
      else { adopt(result); note(""); }
    } catch (error) { note(error?.message || "That project could not be removed.", true); }
    finally { if (state.isCurrent()) { setBusy(false); render(); focusSelected(); } }
  }

  // ---- panels: Start a new app, Get from GitHub ----
  function field(label, control, hint) {
    const wrap = node("label", "boot-field");
    wrap.append(node("span", "", label), control);
    if (hint) wrap.append(node("span", "boot-field-hint", hint));
    return wrap;
  }
  function panelActions(primaryLabel, type = "submit") {
    const actions = node("div", "boot-panel-actions");
    const cancel = node("button", "ghost", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", () => { if (!state.busy) closePanel(); });
    const go = node("button", "primary", primaryLabel);
    go.type = type;
    state.panelControls.push(cancel, go);
    actions.append(cancel, go);
    return { actions, go, cancel };
  }
  // While a panel is up the card's own heading names it, so the dialog's label follows what it shows.
  const HEADINGS = {
    new: ["Start a new app", "Studio makes the folder, starts version history in it and opens it as your project."],
    github: ["Get from GitHub", "Studio asks where to put it, then downloads it and opens it."],
  };
  function openPanel(kind, opener) {
    if (state.busy || !$("panel")) return;
    if ($("title")) $("title").textContent = HEADINGS[kind][0];
    if ($("detail")) $("detail").textContent = HEADINGS[kind][1];
    state.panel = kind;
    state.opener = opener;
    state.panelControls = [];
    state.focusFirst = null;
    $("panel").replaceChildren(kind === "new" ? newPanel() : githubPanel());
    layout();
    note("");
    state.focusFirst?.();
  }
  function closePanel() {
    const opener = state.opener;
    state.panel = null; state.github = null; state.opener = null; state.panelControls = [];
    $("panel")?.replaceChildren();
    if ($("title")) $("title").textContent = "Choose a project";
    render();
    note("");
    opener?.focus?.({ preventScroll: true });
  }
  function newPanel() {
    const form = node("form", "boot-form");
    form.id = "boot-new-form";
    form.setAttribute("novalidate", "");
    const name = node("input");
    name.type = "text"; name.id = "boot-new-name"; name.placeholder = "Name your app"; name.maxLength = 60; name.setAttribute("autocomplete", "off");
    const about = node("textarea");
    about.id = "boot-new-about"; about.rows = 2; about.maxLength = 600;
    about.placeholder = "A small notes app where each note is a card I can pin to the top.";
    const folder = node("code", "boot-folder-path", "Mefi Apps › your-app");
    name.addEventListener("input", () => { folder.textContent = "Mefi Apps › " + (slugOf(name.value) || "your-app"); });
    const where = node("div", "boot-folder");
    where.append(node("span", "boot-folder-label", "Folder"), folder);
    const { actions, go } = panelActions("Start project");
    state.panelControls.push(name, about);
    form.append(
      field("Name", name), where,
      field("What do you want to build?", about, "Optional. It goes into the project's README."),
      node("p", "boot-panel-sub", "You can put it on GitHub from the Git chip once it opens."),
      actions);
    form.addEventListener("submit", (event) => { event.preventDefault?.(); void createApp(name, about, go); });
    state.focusFirst = () => name.focus?.({ preventScroll: true });
    return form;
  }
  // The folder exists first and opens like any chosen project; nothing here
  // reaches GitHub. Publishing is a step of its own once the project is open.
  async function createApp(nameInput, aboutInput, go) {
    const name = String(nameInput.value ?? "").trim();
    if (!name) { note("Give the new app a name.", true); nameInput.focus?.(); return; }
    if (!api()?.projectsCreate) { note("New apps can be made in the desktop app.", true); return; }
    const about = String(aboutInput.value ?? "").trim();
    setBusy(true);
    go.textContent = "Making it…";
    announce(`Making ${name}…`);
    let made = false;
    try {
      const result = await api().projectsCreate(about ? { name, about } : { name });
      if (!state.isCurrent()) return;
      adopt(result);
      if (result?.ok === false) note(result.error || "The app folder could not be made.", true);
      else made = true;
    } catch (error) { note(error?.message || "The app folder could not be made.", true); }
    finally { if (state.isCurrent()) { announce(""); setBusy(false); if (!made) go.textContent = "Start project"; } }
    if (!state.isCurrent()) return;
    if (!made) { refocus(); return; }
    clearFilter();
    closePanel();
    await state.finish?.();
  }
  function githubPanel() {
    const g = state.github = { loading: true, repos: null, error: "", signedOut: false, pick: null, query: "", rows: new Map(), el: {}, temp: [], focused: false };
    const box = node("div", "boot-form");
    box.id = "boot-github-panel";
    g.el.status = node("p", "boot-panel-sub");
    g.el.status.id = "boot-github-status";
    g.el.status.setAttribute("role", "status");
    g.el.status.setAttribute("aria-live", "polite");
    g.el.sign = node("div", "boot-signin");
    const search = node("input");
    search.type = "search"; search.id = "boot-repo-filter"; search.placeholder = "Search your GitHub projects"; search.setAttribute("aria-label", "Search your GitHub projects"); search.setAttribute("autocomplete", "off");
    search.addEventListener("input", () => { g.query = String(search.value ?? "").trim().toLowerCase(); paintRepoSearch(); });
    g.el.search = node("div", "boot-filter");
    g.el.search.append(...[svg("search"), search].filter(Boolean));
    state.panelControls.push(search);
    g.el.none = node("p", "boot-panel-sub", "No GitHub projects match your search.");
    g.el.none.hidden = true;
    g.el.list = node("div", "boot-repos");
    g.el.list.id = "boot-repos";
    g.el.list.setAttribute("role", "radiogroup");
    g.el.list.setAttribute("aria-label", "Your GitHub projects");
    const { actions, go, cancel } = panelActions("Download and open", "button");
    go.disabled = true;
    go.addEventListener("click", () => void getRepo());
    g.el.go = go;
    box.append(g.el.status, g.el.sign, g.el.search, g.el.list, g.el.none, actions);
    // Until the list shows, the way out has the focus, so the keyboard is never left on a hidden verb.
    state.focusFirst = () => cancel.focus?.({ preventScroll: true });
    void loadRepos();
    return box;
  }
  async function loadRepos() {
    const g = state.github;
    if (!g) return;
    Object.assign(g, { loading: true, error: "", signedOut: false });
    paintGithub();
    if (!api()?.pcSetupRepos) { Object.assign(g, { loading: false, error: "Getting a project from GitHub is in the desktop app." }); paintGithub(); return; }
    try {
      const answer = await api().pcSetupRepos();
      if (state.github !== g || !state.isCurrent()) return;
      if (answer?.ok === false || !Array.isArray(answer?.repos)) {
        const said = answer?.error || "Could not list your GitHub repositories. Sign in to GitHub first.";
        Object.assign(g, { repos: null, error: said, signedOut: /sign in/i.test(said) });
      } else g.repos = answer.repos.filter((item) => item && typeof item.repo === "string").slice(0, 100);
    } catch (error) { if (state.github !== g) return; Object.assign(g, { repos: null, error: error?.message || "Could not list your GitHub repositories." }); }
    g.loading = false;
    paintGithub();
  }
  function paintGithub() {
    const g = state.github;
    if (!g || state.panel !== "github") return;
    g.el.status.textContent = g.loading ? "Looking at your GitHub projects…" : g.signedOut ? "Sign in to GitHub first. Your projects there will be listed here." : g.error ? g.error : g.repos && !g.repos.length ? "Your GitHub account has no projects yet." : "";
    g.el.status.hidden = !g.el.status.textContent;
    g.el.sign.hidden = !(g.error && !g.loading);
    g.el.sign.replaceChildren();
    state.panelControls = state.panelControls.filter((element) => !g.temp.includes(element));
    g.temp = [];
    if (g.error && !g.loading) {
      if (g.signedOut) g.el.sign.append(node("p", "boot-field-hint", "Studio never sees your password or token."));
      const actions = node("div", "boot-panel-actions");
      if (g.signedOut) {
        const sign = node("button", "primary", "Sign in to GitHub");
        sign.type = "button";
        sign.addEventListener("click", () => void signIn());
        actions.append(sign);
        g.temp.push(sign);
        state.panelControls.push(sign);
      }
      const again = node("button", "ghost", g.signedOut ? "Check again" : "Try again");
      again.type = "button";
      again.addEventListener("click", () => void loadRepos());
      actions.append(again);
      g.temp.push(again);
      state.panelControls.push(again);
      g.el.sign.append(actions);
    }
    g.rows = new Map();
    g.el.list.hidden = !(g.repos && g.repos.length);
    g.el.list.replaceChildren(...(g.repos ?? []).map((item, index) => {
      const on = item.repo === g.pick;
      const button = node("button", on ? "boot-repo selected" : "boot-repo");
      button.type = "button";
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", String(on));
      button.tabIndex = on || (!g.pick && index === 0) ? 0 : -1;
      button.dataset.repo = item.repo;
      const top = node("span", "boot-repo-top");
      top.append(node("span", "boot-project-name", item.repo), node("span", "boot-tag", item.private ? "Private" : "Public"));
      const text = node("span", "boot-project-text");
      text.append(top);
      if (item.description) text.append(node("span", "boot-repo-about", String(item.description)));
      const when = relative(Date.parse(item.updatedAt));
      button.append(text);
      if (when) button.append(node("span", "boot-project-opened", (/^[A-Z]/.test(when) ? "Updated on " : "Updated ") + when));
      button.addEventListener("click", () => { if (!state.busy) pickRepo(item.repo); });
      button.addEventListener("dblclick", () => { if (state.busy) return; pickRepo(item.repo); void getRepo(); });
      g.rows.set(item.repo, button);
      return button;
    }));
    g.el.go.disabled = state.busy || !g.pick;
    g.el.search.hidden = !(g.repos && g.repos.length >= FILTER_FROM);
    paintRepoSearch();
    // The first time the list shows, the way in to it has the focus.
    if (!g.focused && g.rows.size) { g.focused = true; g.rows.values().next().value.focus?.({ preventScroll: true }); }
  }
  // Only rows that match the search show; a pick that is hidden stays the pick.
  function paintRepoSearch() {
    const g = state.github;
    if (!g) return;
    let shown = 0;
    for (const item of g.repos ?? []) {
      const button = g.rows.get(item.repo);
      const on = !g.query || `${item.repo} ${item.description ?? ""}`.toLowerCase().includes(g.query);
      if (button) button.hidden = !on;
      if (on) shown += 1;
    }
    g.el.none.hidden = shown > 0 || !(g.repos && g.repos.length);
  }
  function pickRepo(repo, { focus = true } = {}) {
    const g = state.github;
    if (!g) return;
    g.pick = repo;
    for (const [key, button] of g.rows) {
      const on = key === repo;
      button.className = on ? "boot-repo selected" : "boot-repo";
      button.setAttribute("aria-checked", String(on));
      button.tabIndex = on ? 0 : -1;
    }
    g.el.go.disabled = state.busy || !g.pick;
    if (focus) g.rows.get(repo)?.focus?.({ preventScroll: true });
  }
  function navigateRepos(key) {
    const g = state.github;
    const names = [...(g?.rows ?? [])].filter(([, button]) => !button.hidden).map(([name]) => name);
    if (!names.length) return false;
    if (key === "Enter") { if (!g.pick) return false; void getRepo(); return true; }
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(key)) return false;
    const back = ["ArrowUp", "ArrowLeft"].includes(key), index = names.indexOf(g.pick);
    // With nothing chosen yet, forward lands on the first and back on the last.
    const next = key === "Home" ? 0 : key === "End" ? names.length - 1 : index < 0 ? (back ? names.length - 1 : 0) : (index + (back ? -1 : 1) + names.length) % names.length;
    pickRepo(names[next]);
    return true;
  }
  // The sign-in window is the setup checklist's own; the owner comes back and checks again.
  async function signIn() {
    if (!api()?.pcSetupAction) return;
    try {
      const answer = await api().pcSetupAction("github-login");
      if (!state.isCurrent()) return;
      if (answer?.ok === false) note(answer.error || "Could not open the sign-in window.", true);
      else note(answer?.message || "Finish in the setup window, then choose Check again.");
    } catch (error) { note(error?.message || "Could not open the sign-in window.", true); }
  }
  // main.cjs asks where to put it, clones it and registers the folder; the list is read again to find it.
  async function getRepo() {
    const g = state.github;
    const repo = g?.pick;
    if (!repo || state.busy || !api()?.pcSetupClone) return;
    setBusy(true);
    g.el.go.textContent = "Getting it…";
    announce(`Getting ${repo}…`);
    note(`Getting ${repo}… this can take a few minutes.`);
    let folder = null;
    try {
      const answer = await api().pcSetupClone(repo);
      if (!state.isCurrent()) return;
      if (answer?.canceled) note("");
      else if (answer?.ok === false) note(answer.error || "That project could not be downloaded.", true);
      else folder = answer?.folder ?? "";
    } catch (error) { note(error?.message || "That project could not be downloaded.", true); }
    finally { if (state.isCurrent()) { announce(""); setBusy(false); g.el.go.textContent = "Download and open"; g.el.go.disabled = !g.pick; } }
    if (!state.isCurrent()) return;
    if (folder === null) { refocus(); return; }
    let found = null;
    try {
      const fresh = await api().startupState();
      if (!state.isCurrent()) return;
      if (fresh?.ok && Array.isArray(fresh.projects)) { adopt({ projects: fresh.projects, activeId: fresh.activeId }); found = state.projects.find((project) => sameFolder(project.path, folder)) ?? null; }
    } catch (error) { console.warn("Project list unavailable", error); }
    if (!found) { closePanel(); note(`Got ${repo}. Choose it in the list, then Open.`); return; }
    state.selectedId = found.id;
    clearFilter();
    closePanel();
    void requestGlance();
    await state.finish?.();
  }

  // Resolves with the choice once the host has the project open, or with null
  // when the screen does not apply (the gate then proceeds as before).
  async function choose({ isCurrent = () => true } = {}) {
    if (!available() || !$("choose")) return null;
    let info = null;
    try { info = await api().startupState(); } catch (error) { console.warn("Startup state unavailable", error); return null; }
    if (!isCurrent() || !info?.ok || info.interactive === false) return null;
    // Session continuity (main.cjs): the host already reopened the folder that
    // was still being worked on, so there is no question left to ask. Name it
    // for the gate instead. Nothing is started from here — the host restored
    // the agents itself if they were running, and left them held if not.
    if (info.resumed) {
      state.projects = Array.isArray(info.projects) ? info.projects : [];
      state.selectedId = info.resumed.projectId ?? info.activeId ?? null;
      return { projectId: state.selectedId, startAgents: false, changed: false, resumed: info.resumed };
    }
    if (info.chosen === true) return null;
    state.run += 1;
    state.isCurrent = isCurrent;
    state.launch = info.launch && typeof info.launch === "object" ? info.launch : null;
    state.agents = null; state.panel = null; state.filter = "";
    state.glance = new Map(); state.asked = new Set(); state.pending = new Set();
    ui = { open: $("open"), sw: $("start-agents"), add: $("add-project"), newApp: $("new-app"), github: $("from-github"), go: $("go"), verbs: $("verbs"), list: $("projects"), panel: $("panel"), filter: $("filter"), filterRow: $("filter-row") };
    if (ui.newApp) face(ui.newApp, "Start a new app", "plus");
    if (ui.github) face(ui.github, "Get from GitHub", "cloud-download");
    adopt({ projects: info.projects, activeId: info.activeId });
    // The day's paper (renderer/daily-paper.js) lays out around this card
    // before it draws, so the first focus lands where the card will stay.
    // `news` false is the owner's "off"; a host without news skips it.
    window.MefiDailyPaper?.show?.({ enabled: info.news });
    render();
    note("");
    void requestGlance();
    return new Promise((resolve) => {
      const finish = async () => {
        if (state.busy || !isCurrent()) return;
        const chosen = selected();
        if (missing(chosen)) { note(""); return; }
        if (chosen && !matches(chosen)) return;
        // The switch as it stands now is the word for this launch.
        const startAgents = agentsOn();
        let opened = false;
        setBusy(true, state.selectedId ? "Opening…" : "Continuing…");
        announce(chosen ? `Opening ${chosen.name || "the project"}…` : "Continuing without a project…");
        note("");
        try {
          const result = await api().startupChoose(state.selectedId);
          if (!isCurrent()) return;
          if (result?.ok === false) { note(result.error || "The project could not be opened.", true); return; }
          adopt(result);
          const changed = (result?.activeId ?? null) !== (info.activeId ?? null);
          opened = true;
          resolve({ projectId: result?.activeId ?? state.selectedId ?? null, startAgents, changed });
        } catch (error) { note(error?.message || "The project could not be opened.", true); }
        finally { if (isCurrent()) { announce(""); setBusy(false); paintControls(); if (!opened) refocus(); } }
      };
      state.finish = finish;
      ui.open.onclick = () => void finish();
      ui.sw.onclick = () => { if (state.busy) return; state.agents = !agentsOn(); paintControls(); note(""); };
      ui.add.onclick = async () => {
        if (state.busy || !api()?.projectsAdd) return;
        setBusy(true);
        try {
          const result = await api().projectsAdd();
          if (!isCurrent()) return;
          if (result?.ok === false) note(result.error || "That folder could not be opened.", true);
          else if (!result?.canceled) { adopt(result); note(""); }
        } catch (error) { note(error?.message || "That folder could not be opened.", true); }
        finally { if (isCurrent()) { setBusy(false); render(); focusSelected(); void requestGlance(); } }
      };
      ui.newApp.onclick = () => openPanel("new", ui.newApp);
      ui.github.onclick = () => openPanel("github", ui.github);
      if (ui.filter) ui.filter.addEventListener("input", () => { state.filter = String(ui.filter.value ?? "").trim().toLowerCase(); applyFilter(); });
      focusSelected();
    });
  }

  // "Open and start agents": called once the studio is up, never before.
  async function begin() {
    if (!api()?.startupBegin) return { ok: false, error: "Desktop app only." };
    try { return await api().startupBegin(); }
    catch (error) { console.warn("Starting the agents failed", error); return { ok: false, error: error?.message || "Starting the agents failed." }; }
  }

  window.MefiStartup = { choose, begin, available, navigateProjects, relative, splitPath, state: () => ({ projects: state.projects.map((project) => project.id), selectedId: state.selectedId, busy: state.busy }) };
})();
