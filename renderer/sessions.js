// Build's desktop inside the 0.5 frame (layout v2): the session list, the thread and the inspector.
//
// Three panels, drawn into the places the shell keeps for them (renderer/shell.js, MefiShell.mount):
//   the list       this project's tasks as sessions, grouped Needs you / Running / Review / Queued / Done, newest
//                  first, with a filter, a Sessions | Backlog switch, a row menu and the keyboard;
//   the thread     the selected task in the main area: its brief, every run and what it said, a decision card for an
//                  open question, what Mefi decided, banners for review and failure, the pictures and before and
//                  after shots it carries (with a lightbox), and a box that takes a Note, an Ask or a Change;
//   the inspector  the same task as five tabs, Plan | Changes | Checks | Preview | Agent, with live counts. Changes and
//                  Checks are review.js's own panels (real diffs, Accept, Revert with its second press and Undo,
//                  advisory checks); nothing of them is rebuilt here.
//
// Everything a task means comes from builder.js's kit (readings, groups, what a task offers, how a note, an Ask, a
// Change and a question go through, what "Done when" says) and from review.js, tasks.js, worktrees.js and the two
// composer modules, so the sessions layout of Build's Home and this one can never disagree. This file draws and
// keeps the selection; it adds three host calls of its own (a picture read back, a rename, and the Plans page's own
// planning:list for the backlog's plan drafts) and nothing else. The list's head is the prototype's: the project with
// its menu (each project, Open a folder, Start a new app, All projects: Home's, Vibe's and the project panel's own
// controls), the Git chip (git-sync.js's, one popover for every chip) and the worktrees, which opens Work › Worktrees.
//
// Dark by default: nothing here exists unless html[data-layout="v2"] is on and the shell is there. With v2 off the
// module registers nothing, listens to nothing, stores nothing and calls the host for nothing; MefiSessions.attach()
// is the one way in when something turns v2 on later. ?sessions=off (or the saved mefiStudio.sessions = "off") puts
// the panels away for a launch or for good and leaves Home as it is. Every read is event-driven: the workspace's own
// pushes, the host's review pushes and one slow tick that only repaints relative times while the panels show.
(function () {
  "use strict";
  const STORE = "mefiStudio.sessions.v1";
  const SWITCH = "mefiStudio.sessions";
  const DONE_SHOWN = 12;
  const DONE_STEP = 25;
  const PICTURES_SHOWN = 4;
  const TICK_MS = 60000;
  const SHORT_BELOW = 520;
  const TABS = [["plan", "Plan"], ["changes", "Changes"], ["checks", "Checks"], ["preview", "Preview"], ["agent", "Agent"], ["wt", "Worktree"]];
  const PHASES = { unavailable: "No preview available", stopped: "Stopped", starting: "Starting preview", ready: "Preview ready", stopping: "Stopping preview", failed: "Preview failed" };

  const api = () => window.mefiStudio;
  const byId = (id) => document.getElementById(id);
  const read = (key, fallback = null) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
  const write = (key, value) => { try { localStorage.setItem(key, value); } catch { /* a private store: nothing is remembered */ } };
  const readJson = (key, fallback) => { try { const value = JSON.parse(localStorage.getItem(key) ?? "null"); return value ?? fallback; } catch { return fallback; } };
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined && text !== null) node.textContent = String(text); return node; };
  function glyph(name, className = "") {
    const svg = document.createElementNS?.("http://www.w3.org/2000/svg", "svg");
    if (!svg) return el("span", `glyph ${className}`.trim());
    svg.setAttribute("class", `glyph ${className}`.trim()); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use"); use.setAttribute("href", `#${name}`); svg.append(use);
    return svg;
  }
  function button(label, className, run, { title = "", icon = null, aria = "", type = "button" } = {}) {
    const node = el("button", className);
    node.type = type;
    // A label alone is the button's own text, so MefiUi.arm can turn it into its question ("Stop it?").
    if (icon) { node.append(glyph(icon)); if (label) node.append(el("span", "", label)); } else if (label) node.textContent = String(label);
    if (title) node.title = title;
    if (aria) node.setAttribute("aria-label", aria);
    if (run) node.addEventListener("click", run);
    return node;
  }
  const toast = (message, kind = "info", options) => { try { window.MefiToast?.(message, kind, options); } catch { /* no toasts */ } };
  // A menu that closes: a menu effect from the Shop plays it away (renderer/effects.js), else it simply goes.
  const letGo = (node) => { const effects = window.MefiEffects; if (typeof effects?.leave === "function") effects.leave(node); else node.remove?.(); };
  const plain = (error, fallback) => window.MefiUi?.plainError ? window.MefiUi.plainError(error, fallback) : String(error?.message || error || fallback);
  const escapeRe = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const stampOf = (value) => { const number = Number(value); if (Number.isFinite(number) && number > 0) return number; const parsed = Date.parse(value || ""); return Number.isFinite(parsed) ? parsed : 0; };
  const clip = (text, max) => { const flat = String(text ?? "").replace(/\s+/g, " ").trim(); return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`; };
  const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
  // How long, in the words a row has room for: 45s, 12m, 3h, 2d.
  function howLong(ms) {
    if (!Number.isFinite(ms) || ms < 0) return "";
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `${Math.max(1, seconds)}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
    return `${Math.round(seconds / 86400)}d`;
  }
  // One animation frame from now (a timer where there is no frame to wait for).
  const frame = (run) => (typeof requestAnimationFrame === "function" && !document.hidden ? requestAnimationFrame(run) : setTimeout(run, 16));
  const clockOf = (at) => { const date = new Date(at); return Number.isFinite(date.getTime()) ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""; };

  // ---- what the panels know --------------------------------------------------------------------------------------------
  const S = {
    wired: false, shell: null, handles: {}, panels: {}, offs: [], listening: false, waiting: false,
    projectId: null, open: null, tab: "sessions", closed: {}, doneMore: 0, query: "", short: false, home: false,
    itab: new Map(), itabChosen: new Set(), openedAt: 0, itabHidden: [], itabWidth: -1,
    menu: null, renaming: null, focus: null, painted: new Map(), revision: 0, queued: false, tickTimer: 0,
    pictures: new Map(), picturesLoading: 0, evidence: new Map(), metrics: new Map(), later: new Set(), dockOpen: new Set(), dockFold: new Set(),
    wt: { rows: new Map(), at: 0, key: "" }, plans: { projectId: null, rows: [], at: 0, loading: false }, projMenu: false, projMenuFocus: false, lightbox: null, intent: new Map(), drafts: new Map(), sending: false, insp: null,
    versions: new Map(), itabAuto: new Map(), compare: new Map(), restoring: null, previewBusy: null, pictureQueue: [], shownState: null, visible: false,
    restoredAt: 0, stuckFor: null, menuFocus: false, stopWaiting: null, helpers: false, attaching: false, compose: null, covered: new Set(),
  };
  const builder = () => window.MefiBuilder ?? null;
  const snap = () => {
    const data = window.MefiWorkspace?.snapshot?.();
    return data && typeof data === "object" ? data : { projectId: null, project: null, projects: [], tasks: [], ideas: [], assistant: {}, status: {}, backlog: null, preview: null };
  };
  const layoutOn = () => document.documentElement?.dataset?.layout === "v2";
  const shellOf = () => { const shell = window.MefiShell; return shell && typeof shell.mount === "function" && shell.active?.() !== false ? shell : null; };
  const building = () => window.MefiVibe?.mode?.() !== "vibe" && document.documentElement?.dataset?.uiMode !== "vibe";
  const param = (name) => { try { return new URLSearchParams(window.location?.search || "").get(name); } catch { return null; } };
  // ?sessions=off or the saved "off" puts the panels away; ?sessions=on wins for one launch.
  const switchedOff = () => { const asked = param("sessions"); if (asked === "on") return false; return asked === "off" || read(SWITCH) === "off"; };

  // What a project remembers: the open session, which list it was on, which groups were folded and each task's inspector tab.
  const saved = () => { const all = readJson(STORE, {}); return all && typeof all === "object" && all.p && typeof all.p === "object" ? all : { p: {} }; };
  const memory = (id = S.projectId) => { const row = saved().p[id || "none"]; return row && typeof row === "object" ? row : {}; };
  function remember(patch) {
    const all = saved();
    const key = S.projectId || "none";
    const row = { ...(all.p[key] && typeof all.p[key] === "object" ? all.p[key] : {}), ...patch };
    delete all.p[key];
    all.p[key] = row;
    for (const old of Object.keys(all.p).slice(0, Math.max(0, Object.keys(all.p).length - 12))) delete all.p[old];
    write(STORE, JSON.stringify(all));
  }
  const tasksOf = (data = snap()) => (Array.isArray(data.tasks) ? data.tasks : []);
  const taskById = (id, data = snap()) => (id ? tasksOf(data).find((task) => task?.id === id) ?? null : null);
  const running = (data, task) => (data.status?.running || []).find((job) => job?.taskId === task?.id) ?? null;
  const questionsFor = (task, data) => (data.assistant?.questions || []).filter((item) => item?.status === "open" && (item.context?.taskId || item.taskId) === task?.id);

  // ---- scheduling -------------------------------------------------------------------------------------------------------
  function schedule() {
    S.revision += 1;
    if (S.queued || !S.wired) return;
    S.queued = true;
    // A hidden window draws nothing: the next time it is shown (visibilitychange) everything that moved is drawn once.
    const run = () => { S.queued = false; if (S.wired && !document.hidden) paint(); };
    if (typeof requestAnimationFrame === "function" && !document.hidden) requestAnimationFrame(run); else setTimeout(run, 16);
  }
  function paint() {
    // A project the workspace opened without telling us (the first one, at launch): take it up, with what it remembers.
    const id = snap().projectId;
    if (id && id !== S.projectId) onProject({ detail: { projectId: id } });
    syncVisibility();
    // The frame's page list (a section's pages, renderer/shell.js) covers the column on other sections' pages: nothing is drawn for nobody.
    if (!listCovered()) paintList();
    if (S.visible) { paintThread(); paintInspector(); }
    else { unmountInspector(); if (S.home) paintProjectInspector(); }
  }
  const listCovered = () => { try { return Boolean(S.shell?.pages?.()?.shown); } catch { return false; } };
  // Nothing is drawn for a panel nobody can see: a hidden window, a thread that is not on screen.
  function syncVisibility() {
    const home = onHome();
    const shown = Boolean(S.open) && home;
    S.home = home;
    S.visible = shown;
    cover(shown);
    setShown("main", shown);
    setShown("list", true);
    // On Home the inspector is the session's, or the project's (Repository, Team, Live activity) when none is open; any other page
    // is not a session, so it is hidden there and the frame folds the column away instead of saying there is nothing to inspect.
    setShown("inspector", home);
  }
  // Home is covered while a session shows, not gone: it leaves the tab order and the accessibility tree, and MefiScroll stops drawing the
  // scroll fades of panes nobody can see over the thread. Only what this put there is taken back.
  function cover(on) {
    for (const id of ["workspace-layer", "vibe-layer"]) {
      const node = byId(id);
      if (!node) continue;
      if (on) { if (!node.hasAttribute("inert")) { node.setAttribute("inert", ""); S.covered.add(node); } }
      else if (S.covered.has(node)) { node.removeAttribute("inert"); S.covered.delete(node); }
    }
  }
  function setShown(name, on) {
    const handle = S.handles[name], panel = S.panels[name]?.root;
    if (!panel) return;
    if (S.shownState?.[name] === on) return;
    (S.shownState ??= {})[name] = on;
    if (handle) { try { on ? handle.show?.() : handle.hide?.(); } catch { /* a shell that cannot hide leaves it */ } }
    panel.hidden = !on;
  }
  // Home is the page these panels speak for: Build's Home, or Vibe's when a session is opened from it.
  function onHome() {
    const here = window.MefiNav?.current?.();
    if (here === undefined || here === null) return Boolean(window.MefiWorkspace?.isActive?.() || window.MefiVibe?.isActive?.());
    return here === "workspace" || here === "vibe";
  }

  // ---- opening a session --------------------------------------------------------------------------------------------------
  // The route a session is: Home with view: "task". A tab remembers exactly this, and the page follows it.
  const routeOf = (taskId, extra = {}) => ({ view: "task", taskId, projectId: S.projectId || snap().projectId, ...extra });
  // The inspector tab a route or a person named for a task: theirs from now on (whoever calls this remembers it).
  function pickTab(taskId, tab) {
    if (!TABS.some(([id]) => id === tab)) return false;
    S.itab.set(taskId, tab); S.itabChosen.add(taskId);
    return true;
  }
  function select(taskId, { tab = null, route = true, preview = true } = {}) {
    const task = S.wired ? taskById(taskId) : null;
    if (!task) return false;
    const changed = S.open !== taskId;
    S.open = taskId;
    if (changed) { S.openedAt = Date.now(); S.itabChosen.delete(taskId); S.menu = null; S.renaming = null; S.focus = null; S.painted.delete("thread"); dropPainted("inspector"); closeRunMenu(false); }
    if (tab) pickTab(taskId, tab);
    remember({ open: taskId, itab: Object.fromEntries([...S.itab].slice(-40)) });
    try { window.MefiNav?.selectTask?.({ taskId, projectId: S.projectId, title: window.MefiTasks?.shortTitle?.(task) || task.title }); } catch { /* the selection is shared, not required */ }
    if (route) {
      const tabs = window.MefiTabs;
      if (typeof tabs?.open === "function") tabs.open("workspace", routeOf(taskId), { preview });
      else window.MefiNav?.go?.("workspace", routeOf(taskId));
    }
    schedule();
    return true;
  }
  function deselect({ remembered = true } = {}) {
    if (!S.open) return;
    S.open = null; S.painted.delete("thread"); dropPainted("inspector");
    if (remembered) remember({ open: null });
    schedule();
  }
  // New task is Home's own message box, in its task purpose: pictures, the @ # / picker and the chips are all there.
  function newTask() {
    deselect();
    if (typeof window.MefiWorkspace?.composeTask === "function") window.MefiWorkspace.composeTask();
    else window.MefiNav?.go?.("workspace");
  }
  // The page follows the navigation: a session from anywhere (a tab, the palette, a notification) shows here, and Home
  // asked for by itself puts the thread away.
  function onNav(event) {
    const detail = event?.detail || {};
    if (!S.wired) return;
    if (S.lightbox) closeLightbox({ restore: false });
    if ((detail.id === "workspace" || detail.id === "vibe") && detail.action === "open") {
      const params = detail.params || {};
      if (params.view === "task" && typeof params.taskId === "string" && params.taskId) {
        if (params.projectId && S.projectId && params.projectId !== S.projectId) { schedule(); return; }
        if (S.open !== params.taskId) select(params.taskId, { tab: params.tab || null, route: false });
        else if (pickTab(params.taskId, params.tab)) { remember({ itab: Object.fromEntries([...S.itab].slice(-40)) }); dropPainted("inspector"); }
      } else if (S.open) deselect();
    }
    schedule();
  }
  // nav.go("tasks", { taskId }) is how the palette, a notification and Home's "View task" open a task. In v2 a task is a
  // session, so that lands in the thread; the board itself is still one press away (board: true) and a plain go("tasks")
  // with no task is untouched.
  function redirect(id, params) {
    if (!S.wired || id !== "tasks" || !params || typeof params.taskId !== "string" || !params.taskId || params.board) return null;
    if (params.projectId && S.projectId && params.projectId !== S.projectId) return null;
    if (!taskById(params.taskId)) return null;
    return { id: "workspace", params: routeOf(params.taskId, params.panel === "evidence" ? { tab: "checks" } : {}) };
  }


  // ---- coming and going ---------------------------------------------------------------------------------------------------
  function listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    S.offs.push(() => target.removeEventListener?.(type, handler, options));
  }
  // The shell may draw its regions a moment after this file runs, or be turned on later: ask again when it says it moved, and for a
  // few seconds at a short interval (a shell that only announces a change of size would never say).
  function waitForShell() {
    if (S.waiting) return;
    S.waiting = true;
    let tries = 0;
    const retry = () => { if (attach()) stop(); };
    const timer = setInterval(() => { tries += 1; if (attach() || tries >= 40 || !layoutOn()) stop(); }, 250);
    function stop() {
      clearInterval(timer);
      S.waiting = false; S.stopWaiting = null;
      window.removeEventListener?.("mefi:shell-layout", retry); window.removeEventListener?.("mefi:layout", retry);
    }
    window.addEventListener?.("mefi:shell-layout", retry);
    window.addEventListener?.("mefi:layout", retry);
    S.stopWaiting = stop;
  }
  function attach() {
    if (S.wired) return true;
    // Mounting makes the shell say its regions moved, which is the very event a waiting attach listens for.
    if (S.attaching || switchedOff() || !layoutOn()) return false;
    const shell = shellOf();
    if (!shell || typeof window.MefiWorkspace?.snapshot !== "function" || !builder()) { waitForShell(); return false; }
    S.attaching = true;
    try {
      S.shell = shell;
      S.projectId = snap().projectId;
      buildPanels();
      if (!mountPanels(shell)) { discardPanels(); waitForShell(); return false; }
      S.wired = true;
    } finally { S.attaching = false; }
    S.stopWaiting?.();
    wire();
    registerSearch();
    restore();
    updateShort();
    schedule();
    return true;
  }
  // Search (Ctrl K) lists New task with its key, as the prototype does; it runs what the list's own button runs, and goes with the panels.
  function registerSearch() {
    try {
      window.MefiNav?.register?.({
        id: "sessions-new-task", label: "New task", short: "New task", kind: "action", layer: null, section: "home", group: "layout", key: null, chord: "Ctrl N", keyMatch: () => false,
        glyph: "g-add", badge: null, paletteGroup: "Actions", paletteBrowse: 1, desc: "Start a new task from the box on Home", searchTerms: "new task start create build add",
        showIn: { tabs: false, tools: false, dock: false, palette: true, help: false, footer: false }, hidden: () => !S.wired, run: () => newTask(),
      });
    } catch { /* Search is optional */ }
  }
  function detach() {
    S.stopWaiting?.();
    if (!S.wired) return false;
    S.wired = false;
    for (const off of S.offs.splice(0)) { try { off(); } catch { /* a listener that is already gone */ } }
    if (S.tickTimer) { clearInterval(S.tickTimer); S.tickTimer = 0; }
    closeLightbox();
    cover(false);
    S.insp?.unmount?.();
    discardPanels();
    Object.assign(S, { shell: null, handles: {}, panels: {}, open: null, menu: null, projMenu: false, plans: { projectId: null, rows: [], at: 0, loading: false }, renaming: null, painted: new Map(), shownState: null, visible: false, insp: null, queued: false, compose: null, helpers: false, sending: false });
    S.pictures.clear(); S.evidence.clear(); S.metrics.clear(); S.versions.clear();
    return true;
  }
  function discardPanels() {
    for (const handle of Object.values(S.handles)) { try { handle?.unmount?.(); } catch { /* the shell already let go of it */ } }
    for (const panel of Object.values(S.panels)) panel?.root?.remove?.();
    S.handles = {}; S.panels = {};
  }
  function mountPanels(shell) {
    const parts = [["list", "sessions-list", { title: "Sessions", order: 10 }], ["main", "sessions-thread", { title: "Session", order: 10 }], ["inspector", "sessions-inspector", { title: "Inspector", order: 10 }]];
    let any = false;
    for (const [region, key, options] of parts) {
      const root = S.panels[region === "main" ? "main" : region]?.root;
      if (!root) continue;
      let handle = null;
      try { handle = shell.mount(region, key, root, options) ?? null; } catch { handle = null; }
      if (handle || root.parentNode) { S.handles[region] = handle; any = true; }
    }
    return any;
  }
  // What this launch wires once the panels are up: the page's own pushes, the workspace's, the navigation, the kit's.
  let pushes = false;
  function wire() {
    const again = () => schedule();
    listen(window, "mefi:workspace-state", again);
    listen(window, "mefi:project-changed", onProject);
    listen(window, "mefi:nav", onNav);
    listen(window, "mefi:worktrees", () => { if (readWorktrees()) schedule(); });
    listen(window, "mefi:appearance", () => { S.painted.clear(); schedule(); });
    listen(window, "mefi:autonomy-changed", () => { S.painted.delete("thread"); schedule(); });
    // Needs you is the Inbox's list: when that moves (a decision taken in it, a digest that arrived), the groups follow.
    listen(window, "mefi:inbox", again);
    listen(window, "mefi:shell-layout", () => { updateShort(); schedule(); });
    listen(window, "mefi:layout", () => { updateShort(); schedule(); });
    listen(window, "resize", () => { if (updateShort()) schedule(); });
    listen(window, "keydown", onGlobalKey);
    listen(document, "pointerdown", onPointerDown, true);
    listen(document, "visibilitychange", () => { if (!document.hidden) schedule(); });
    S.offs.push(builder().subscribe(again));
    if (typeof window.MefiReview?.onChange === "function") S.offs.push(window.MefiReview.onChange(again));
    if (typeof MutationObserver === "function" && document.body) {
      const watcher = new MutationObserver(() => schedule());
      watcher.observe(document.body, { attributes: true, attributeFilter: ["class", "data-sheet"] });
      S.offs.push(() => watcher.disconnect());
    }
    // The host's pushes arrive through the bridge, which has no way to stop listening: they are registered once and
    // do nothing while the panels are away.
    if (!pushes) {
      pushes = true;
      const live = () => { if (S.wired) schedule(); };
      api()?.onTasks?.(live); api()?.onAssistant?.(live); api()?.onAssistantStatus?.(live); api()?.onProjects?.(live);
      api()?.onReviewChanged?.((event) => { if (S.wired && event?.taskId) { S.evidence.delete(event.taskId); S.metrics.delete(event.taskId); if (event.taskId === S.open) { S.painted.delete("thread"); schedule(); } } });
    }
    S.tickTimer = setInterval(() => { if (!document.hidden && S.wired) schedule(); }, TICK_MS);
  }
  // A short window keeps the question docked above the box to one line until it is opened, and the box to its words.
  function updateShort() {
    const height = Number(window.innerHeight) || 0;
    const short = height > 0 && height < SHORT_BELOW;
    if (short === S.short) return false;
    S.short = short;
    for (const panel of Object.values(S.panels)) if (panel?.root) panel.root.dataset.short = short ? "true" : "false";
    S.painted.delete("thread");
    return true;
  }
  function restore() {
    const row = memory();
    S.tab = row.tab === "backlog" ? "backlog" : "sessions";
    S.closed = row.closed && typeof row.closed === "object" ? { ...row.closed } : {};
    S.itab = new Map(Object.entries(row.itab && typeof row.itab === "object" ? row.itab : {}).filter(([, tab]) => TABS.some(([id]) => id === tab)));
    S.restoredAt = Date.now();
    S.open = typeof row.open === "string" && row.open ? row.open : null;
  }
  function onProject(event) {
    S.projectId = event?.detail?.projectId ?? snap().projectId;
    builder()?.resetProject?.();
    S.pictures.clear(); S.evidence.clear(); S.metrics.clear(); S.versions.clear(); S.later.clear(); S.dockOpen.clear(); S.dockFold.clear(); S.itabChosen.clear(); S.itabAuto.clear();
    S.query = ""; S.doneMore = 0; S.menu = null; S.renaming = null; S.focus = null; S.projMenu = false;
    S.wt = { rows: new Map(), at: 0, key: "" };
    S.plans = { projectId: null, rows: [], at: 0, loading: false };
    S.painted.clear();
    restore();
    schedule();
  }

  // ---- the list -------------------------------------------------------------------------------------------------------------
  const STAGE_TONES = { needs: "ask", running: "run", review: "check", queued: "wait", done: "done" };
  // The one line under a row's title: what the task is doing, in the words a person scans.
  function statusLine(task, reading, run, data, now) {
    const summary = reading.summary || {};
    if (reading.tone === "ask") {
      const question = reading.question;
      const waited = question?.at ? howLong(now - stampOf(question.at)) : "";
      return question ? `Asking a question${waited ? ` · waiting ${waited}` : ""}` : reading.label;
    }
    if (reading.tone === "run") {
      const worker = run?.route || (summary.worker && summary.worker !== "No worker running" ? summary.worker : "");
      return [worker, clip(run?.currentStep || run?.activity || "", 60) || reading.label].filter(Boolean).join(" · ");
    }
    if (reading.tone === "done" || reading.tone === "dropped") {
      const verdict = task.dropped ? "Dropped" : task.verification?.state === "verified" ? "Verified" : task.verification?.state === "manual" ? "Confirmed by you" : "Done";
      const when = builder().ago(builder().lastMoved(task), now);
      return when ? `${verdict} · ${when}` : verdict;
    }
    return reading.label;
  }
  // What "show everything" adds: who is on it, where it runs and how far its checks got.
  function detailLine(task, run, worktree, counts) {
    const results = Array.isArray(task.verificationRun?.results) ? task.verificationRun.results : [];
    const parts = [];
    const worker = run?.route || task.lastAttempt?.route || task.lastAttempt?.via;
    if (worker) parts.push(String(worker));
    if (worktree) parts.push(typeof worktree === "string" ? worktree : "own worktree");
    if (counts?.files) parts.push(`+${counts.additions} −${counts.deletions}`);
    if (results.length) parts.push(`checks ${results.filter((result) => result.ok === true).length}/${results.length}`);
    return parts.join(" · ");
  }
  function rowModel(task, data, ctx) {
    const reading = builder().reading(task, data);
    const run = running(data, task);
    const worktree = ctx.worktrees.get(task.id);
    const progress = run && Number.isFinite(Number(run.progress)) ? Math.max(0, Math.min(1, Number(run.progress))) : null;
    return {
      id: task.id, title: window.MefiTasks?.shortTitle?.(task) || task.title || task.prompt || "Untitled task", full: task.title || task.prompt || "",
      tone: reading.tone, label: reading.label, status: statusLine(task, reading, run, data, ctx.now), extra: detailLine(task, run, worktree ? worktree.branch || true : false, ctx.counts(task.id)),
      progress, pinned: ctx.pinned.has(task.id), worktree: worktree ? String(worktree.branch || "") || true : false, selected: task.id === ctx.open,
    };
  }
  // The list as data: groups with their rows, nothing drawn (what a row says of itself follows html[data-detail], in the stylesheet).
  function listModel(data, { query = "", closed = {}, doneMore = 0, now = Date.now(), pinned = new Set(), open = null, worktrees = new Map(), counts = () => null } = {}) {
    const needle = String(query).trim().toLowerCase();
    const all = tasksOf(data).filter((task) => task?.id && !task.archived && task.status !== "archived");
    const tasks = needle ? all.filter((task) => `${task?.title || ""} ${task?.prompt || ""}`.toLowerCase().includes(needle)) : all;
    const ctx = { now, pinned, open, worktrees, counts };
    const groups = [];
    for (const group of builder().stageGroups(tasks, { pinned, data })) {
      if (!group.rows.length) continue;
      const isClosed = Boolean(closed[group.key]);
      const shown = group.key === "done" ? group.rows.slice(0, DONE_SHOWN + doneMore) : group.rows;
      groups.push({ key: group.key, title: group.title, tone: STAGE_TONES[group.key], count: group.rows.length, closed: isClosed, older: group.rows.length - shown.length, rows: isClosed ? [] : shown.map((task) => rowModel(task, data, ctx)) });
    }
    return { groups, total: tasks.length, all: all.length, query: needle };
  }
  // The backlog, as the prototype has it: plan drafts first (Plans that have not made their tasks yet), then the ideas nobody has
  // made a task of, each newest first. A plan says how far it got in the Plans page's own words.
  const PLAN_WORDS = { planning: "Plan draft", ready: "Plan approved, tasks not made yet", converting: "Making its tasks" };
  function backlogModel(data, { query = "", now = Date.now(), plans = [] } = {}) {
    const needle = String(query).trim().toLowerCase();
    const drafts = (Array.isArray(plans) ? plans : []).filter((plan) => plan?.id && plan.archivedAt == null && plan.status !== "converted" && (!plan.projectId || !data.projectId || plan.projectId === data.projectId))
      .filter((plan) => !needle || `${plan.title || ""} ${plan.destination || ""}`.toLowerCase().includes(needle))
      .sort((a, b) => stampOf(b.updatedAt || b.createdAt) - stampOf(a.updatedAt || a.createdAt))
      .map((plan) => {
        const open = Array.isArray(plan.questions) ? plan.questions.filter((question) => question?.status === "open").length : 0;
        const when = stampOf(plan.updatedAt || plan.createdAt);
        return { id: plan.id, kind: "plan", title: clip(plan.title || plan.destination || "Untitled plan", 90), meta: [PLAN_WORDS[plan.status] || "Plan draft", open ? plural(open, "open question") : "", when ? builder().ago(when, now) : ""].filter(Boolean).join(" · ") };
      });
    const ideas = (Array.isArray(data.ideas) ? data.ideas : []).filter((idea) => idea?.id && idea.status !== "done" && !idea.taskId)
      .filter((idea) => !needle || `${idea.title || ""} ${idea.detail || ""}`.toLowerCase().includes(needle))
      .sort((a, b) => stampOf(b.at) - stampOf(a.at))
      .map((idea) => ({ id: idea.id, title: clip(idea.title || idea.detail || "Untitled idea", 90), meta: [idea.source ? `From ${idea.source}` : "", stampOf(idea.at) ? builder().ago(stampOf(idea.at), now) : ""].filter(Boolean).join(" · ") || "An idea" }));
    return [...drafts, ...ideas];
  }
  // The plans the backlog lists: read from the host (planning:list, what the Plans page reads) when the project is taken up, when the
  // Backlog tab is opened, and again at most every 30 s while the list is drawn. Plans have no push of their own.
  function readPlans({ force = false } = {}) {
    const projectId = S.projectId;
    if (!projectId || typeof api()?.planningList !== "function") return;
    const held = S.plans;
    if (held.loading || (!force && held.projectId === projectId && Date.now() - held.at < 30000)) return;
    S.plans = { ...held, projectId, at: Date.now(), loading: true, rows: held.projectId === projectId ? held.rows : [] };
    const mine = S.plans;
    Promise.resolve(api().planningList({ projectId })).then((result) => {
      if (S.plans !== mine || !result?.ok || !Array.isArray(result.plans) || (result.projectId && result.projectId !== projectId)) return;
      mine.rows = result.plans;
    }).catch(() => { /* no plans is the quiet answer */ })
      .finally(() => { mine.loading = false; if (S.wired && S.plans === mine) { S.painted.delete("list"); schedule(); } });
  }
  // How many worktrees the project has besides its own folder (renderer/worktrees.js's list), and its own words for them.
  function worktreeCount() {
    const list = window.MefiWorktrees?.state?.()?.list;
    if (!list?.repo || !Array.isArray(list.rows)) return { count: 0, headline: "" };
    return { count: list.rows.filter((row) => row && row.kind !== "primary").length, headline: String(list.headline || "") };
  }
  const changed = (key, value) => { const now = JSON.stringify(value); if (S.painted.get(key) === now) return false; S.painted.set(key, now); return true; };
  // Forget what was drawn under a key and every key beneath it ("inspector" also forgets "inspector:plan").
  const dropPainted = (prefix) => { for (const key of [...S.painted.keys()]) if (key === prefix || key.startsWith(`${prefix}:`)) S.painted.delete(key); };
  const reviewCounts = (taskId) => window.MefiReview?.counts?.(taskId, S.projectId) ?? null;

  function buildList() {
    const root = el("aside", "sx-panel sx-list"); root.id = "sessions-list"; root.setAttribute("aria-label", "Sessions"); root.dataset.short = "false";
    // Keep the scroll container out of the tab order: drawer focus belongs to
    // its controls, not an automatic scroll tab stop that vanishes on resize.
    root.setAttribute("tabindex", "-1");
    const project = button("", "sx-proj", () => openProjectMenu(false), { title: "Switch project" });
    project.id = "sessions-project"; project.setAttribute("aria-haspopup", "menu"); project.setAttribute("aria-expanded", "false");
    project.addEventListener("keydown", (event) => { if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") { event.preventDefault(); openProjectMenu(true); } });
    // The Git chip (renderer/git-sync.js's own, with its one popover) and how many worktrees the project has, under the project.
    const gitRow = el("div", "sx-gitrow"); gitRow.id = "sessions-gitrow";
    const git = el("span", "sx-git");
    const trees = button("", "sx-chip-btn sx-trees", () => window.MefiNav?.go?.("worktrees"), { icon: "g-worktree" }); trees.id = "sessions-worktrees"; trees.hidden = true;
    gitRow.append(git, trees);
    const fresh = button("", "sx-new", () => newTask(), { title: "New task (Ctrl N)", icon: "g-add" });
    fresh.id = "sessions-new"; fresh.setAttribute("aria-label", "New task");
    const head = el("div", "sx-list-head"); head.append(project, fresh);
    const tabs = el("div", "sx-switch"); tabs.setAttribute("role", "tablist"); tabs.setAttribute("aria-label", "What to list");
    for (const [id, label] of [["sessions", "Sessions"], ["backlog", "Backlog"]]) {
      const tab = button(label, "", () => { S.tab = id; remember({ tab: id }); if (id === "backlog") readPlans({ force: true }); S.painted.delete("list"); paintList(); byId(`sessions-tab-${id}`)?.focus?.(); }); tab.id = `sessions-tab-${id}`; tab.setAttribute("role", "tab"); tab.setAttribute("aria-controls", "sessions-list-scroll"); tab.dataset.tab = id;
      tabs.append(tab);
    }
    const find = el("div", "sx-find");
    const input = el("input"); input.type = "search"; input.id = "sessions-find"; input.placeholder = "Filter sessions…"; input.setAttribute("aria-label", "Filter this project's sessions"); input.dataset.typeHere = "";
    input.addEventListener("input", () => { S.query = input.value; S.doneMore = 0; S.painted.delete("list"); paintList(); });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && input.value) { event.preventDefault(); event.stopPropagation(); input.value = ""; S.query = ""; S.painted.delete("list"); paintList(); }
      else if (event.key === "ArrowDown") { event.preventDefault(); focusRow(0); }
    });
    find.append(input);
    const groups = el("div", "sx-groups"); groups.id = "sessions-list-scroll"; groups.setAttribute("role", "tabpanel"); groups.setAttribute("aria-labelledby", "sessions-tab-sessions");
    groups.addEventListener("keydown", onListKey);
    const foot = el("div", "sx-foot"); foot.id = "sessions-foot";
    root.append(head, gitRow, tabs, find, groups, foot);
    S.panels.list = { root, project, gitRow, git, trees, fresh, tabs, input, groups, foot };
  }
  function paintList() {
    const panel = S.panels.list;
    if (!panel) return;
    const data = snap();
    const builderKit = builder();
    lookForWorktrees();
    builderKit.chips.loadWhere(data);
    const pinned = builderKit.pins();
    const minute = Math.floor(Date.now() / 60000);
    const where = builderKit.chips.state.where;
    readPlans();
    const plans = S.plans.projectId === S.projectId ? S.plans.rows : [];
    const model = S.tab === "backlog" ? null : listModel(data, { query: S.query, closed: S.closed, doneMore: S.doneMore, now: Date.now(), pinned, open: S.open, worktrees: S.wt.rows, counts: reviewCounts });
    const backlog = S.tab === "backlog" ? backlogModel(data, { query: S.query, now: Date.now(), plans }) : null;
    const ideasCount = backlogModel(data, { plans }).length;
    const name = data.project?.name || "Open a project";
    const trees = worktreeCount();
    const projects = (Array.isArray(data.projects) ? data.projects : []).map((row) => [row?.id, row?.name, row?.path]);
    const signature = [S.tab, model, backlog, ideasCount, name, where?.branch ?? null, S.open, S.query, minute, S.menu, S.renaming?.id ?? null, Boolean(data.projectId), (data.status?.running || []).length, data.status?.parallel ?? null, window.MefiAutonomy?.label?.() ?? null, trees, S.projMenu, projects];
    // The Git chip is git-sync.js's: it paints itself, and a mount again only puts it back where it goes.
    if (data.projectId) { try { window.MefiGitSync?.mount?.(panel.git, { variant: "list" }); } catch { /* no chip in this build */ } }
    if (!changed("list", signature)) return;
    // Head: the project and its branch (its menu switches and opens projects), the Git chip and the worktrees, and the two tabs.
    panel.project.replaceChildren(el("span", "sx-proj-av", (name.trim()[0] || "P").toUpperCase()), (() => { const words = el("span", "sx-proj-words"); words.append(el("b", "", name), el("small", "", where?.branch || where?.head && `detached ${where.head}` || "main")); return words; })(), glyph("g-chev"));
    panel.project.title = data.project?.path ? `${data.project.path} · switch project` : "Switch project";
    panel.project.setAttribute("aria-expanded", String(S.projMenu));
    panel.trees.hidden = !trees.count;
    // The count beside the mark, so the chip shares the Git chip's row; the word stays for a screen reader (sessions.css) and the tooltip.
    panel.trees.replaceChildren(glyph("g-worktree"), el("span", "", String(trees.count)), el("span", "sx-trees-word", ` ${trees.count === 1 ? "worktree" : "worktrees"}`));
    panel.trees.title = `${trees.headline || plural(trees.count, "worktree")} Open Work › Worktrees.`;
    panel.gitRow.hidden = !data.projectId;
    for (const tab of panel.tabs.querySelectorAll("[data-tab]")) {
      const on = tab.dataset.tab === S.tab;
      tab.setAttribute("aria-selected", String(on)); tab.classList.toggle("on", on);
      if (on) panel.groups.setAttribute("aria-labelledby", tab.id);
      tab.replaceChildren(el("span", "", tab.dataset.tab === "backlog" ? (ideasCount ? `Backlog · ${ideasCount}` : "Backlog") : "Sessions"));
    }
    panel.input.placeholder = S.tab === "backlog" ? "Filter the backlog…" : "Filter sessions…";
    if (panel.input.value !== S.query) panel.input.value = S.query; // a project switch clears the filter, and the box says so
    // Body: the groups, or the backlog.
    const held = document.activeElement && panel.groups.contains?.(document.activeElement) ? document.activeElement : null;
    const heldKey = S.focus ?? (held ? `${held.closest?.("[data-key]")?.dataset?.key ?? ""}|${held.dataset?.part ?? "main"}` : null);
    const body = [];
    if (!data.projectId) body.push(emptyNote("Open a project folder to see its sessions.", "Open a folder", () => window.MefiSidebar?.open?.({ focus: true, projectFocus: true })));
    else if (S.tab === "backlog") {
      body.push(scanRow());
      if (!backlog.length) body.push(emptyNote(S.query ? "Nothing in the backlog matches that filter." : "The backlog is clear", null, null, S.query ? "" : "Plan drafts, ideas from chats and Mefi's suggestions land here."));
      for (const idea of backlog) body.push(ideaRow(idea));
    } else if (!model.all) body.push(emptyNote("No sessions yet", null, null, "Use + beside the project to start a task, or press Ctrl N."));
    else if (!model.total) body.push(emptyNote("No session matches that filter."));
    else for (const group of model.groups) body.push(...groupNodes(group));
    panel.groups.replaceChildren(...body);
    const current = panel.groups.querySelector?.('[data-nav][tabindex="0"]');
    if (!current) { const first = panel.groups.querySelector?.("[data-nav]"); if (first) first.tabIndex = 0; }
    if (heldKey) { S.focus = null; focusByKey(heldKey); }
    // Foot: how the team is doing.
    const busy = (data.status?.running || []).length;
    const workers = Number(data.status?.parallel) || 0;
    const mode = window.MefiAutonomy?.label?.();
    panel.foot.replaceChildren(el("span", "", [mode ? `${mode} mode` : "", workers ? `${busy} of ${workers} workers busy` : busy ? `${busy} working` : "Nothing running"].filter(Boolean).join(" · ")));
    paintMenu(panel, data);
    paintProjectMenu(panel, data);
  }
  // The backlog's two ways to find more: the Analyzer reads the project, and Scan chats for ideas is the palette's own action.
  function scanRow() {
    const row = el("div", "sx-scan");
    row.append(button("Scan the project", "sx-chip-btn quiet", () => window.MefiNav?.go?.("analyzer"), { icon: "g-analyzer", title: "Open the Analyzer: it reads the project's plans and evidence and finds starting points" }));
    const scan = window.MefiNav?.get?.("scanIdeas");
    if (typeof scan?.run === "function") row.append(button("Scan chats for ideas", "sx-chip-btn quiet", () => scan.run(), { icon: "g-spark", title: scan.desc || "Read recent chats and capture new feature ideas" }));
    return row;
  }

  // ---- the project menu ------------------------------------------------------------------------------------------------------------
  // The prototype's project menu on the head: each project (a press switches, through Home's own project buttons, so the
  // save-and-switch question for running agents is the one it always was), Open a folder (Home's Add project), Start a new app
  // (Vibe's New app panel) and All projects (the project panel the rest of the app opens).
  function openProjectMenu(fromKeyboard) {
    S.projMenu = !S.projMenu;
    S.projMenuFocus = S.projMenu;
    if (S.projMenu) S.menu = null;
    void fromKeyboard;
    S.painted.delete("list");
    paintList();
  }
  function closeProjectMenu(restore) {
    if (!S.projMenu) return;
    S.projMenu = false; S.painted.delete("list");
    paintList();
    if (restore) S.panels.list?.project?.focus?.({ preventScroll: true });
  }
  function projectAction(run) { closeProjectMenu(false); try { run(); } catch { /* the control went away */ } }
  function paintProjectMenu(panel, data) {
    // A redraw while the menu is open keeps the keyboard on the same item. One already leaving (inert) is left to go.
    const old = [...(panel.root.querySelectorAll?.(".sx-projmenu") ?? [])].find((node) => !node.hasAttribute?.("inert"));
    const ITEMS = "[role=menuitem], [role=menuitemradio]";
    const held = old && old.contains?.(document.activeElement) ? [...old.querySelectorAll(ITEMS)].indexOf(document.activeElement) : -1;
    if (old) { if (S.projMenu) old.remove?.(); else letGo(old); }
    if (!S.projMenu) return;
    const menu = el("div", "sx-menu sx-projmenu"); menu.id = "sessions-project-menu"; menu.setAttribute("role", "menu"); menu.setAttribute("aria-label", "Projects");
    const item = (label, run, { icon = null, small = "", radio = false, on = false, avatar = "" } = {}) => {
      const node = button("", "sx-menu-item", () => projectAction(run)); node.setAttribute("role", radio ? "menuitemradio" : "menuitem"); node.tabIndex = -1;
      if (radio) node.setAttribute("aria-checked", String(on));
      if (avatar) node.append(el("span", "sx-proj-av small", avatar)); else if (icon) node.append(glyph(icon));
      const words = el("span", "sx-menu-words"); words.append(el("span", "", label)); if (small) words.append(el("small", "", small));
      node.append(words);
      if (on) { const mark = el("span", "sx-menu-on", "✓"); mark.setAttribute("aria-hidden", "true"); node.append(mark); }
      menu.append(node);
      return node;
    };
    const switchTo = (id) => {
      const own = document.querySelector?.(`#workspace-projects [data-project-id="${String(id).replace(/["\\]/g, "")}"]`);
      if (own && !own.disabled) own.click(); else window.MefiSidebar?.open?.({ focus: true, projectFocus: true });
    };
    for (const project of (Array.isArray(data.projects) ? data.projects : []).slice(0, 12)) {
      if (!project?.id) continue;
      const name = String(project.name || "Project");
      item(name, () => { if (project.id !== data.projectId) switchTo(project.id); }, { avatar: (name.trim()[0] || "P").toUpperCase(), small: String(project.path || ""), radio: true, on: project.id === data.projectId });
    }
    if (menu.childElementCount || menu.children?.length) menu.append(el("hr", "sx-menu-hr"));
    const add = document.getElementById?.("workspace-add-project");
    if (add) item("Open a folder…", () => add.click(), { icon: "g-add" });
    if (typeof window.MefiVibe?.openPanel === "function") item("Start a new app…", () => window.MefiVibe.openPanel("newapp"), { icon: "g-spark" });
    item("All projects…", () => window.MefiSidebar?.open?.({ focus: true, projectFocus: true }), { icon: "g-tasks" });
    menu.addEventListener("keydown", (event) => {
      const items = [...menu.querySelectorAll("[role=menuitem], [role=menuitemradio]")];
      const at = items.indexOf(document.activeElement);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); items[(at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus?.(); }
      else if (event.key === "Home" || event.key === "End") { event.preventDefault(); items[event.key === "Home" ? 0 : items.length - 1]?.focus?.(); }
      else if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); event.stopPropagation(); closeProjectMenu(true); }
    });
    // Under the head, inside the panel, so the list's own clipping never cuts it.
    const place = panel.project.getBoundingClientRect?.(), frame = panel.root.getBoundingClientRect?.();
    if (place && frame && menu.style) {
      menu.style.top = `${Math.max(8, Math.round(place.bottom - frame.top + (panel.root.scrollTop || 0) + 4))}px`;
      menu.style.left = "10px";
      menu.style.maxHeight = `${Math.max(40, Math.floor(frame.bottom - place.bottom - 12))}px`;
    }
    panel.root.append(menu);
    if (S.projMenuFocus) { S.projMenuFocus = false; (menu.querySelector("[aria-checked=true]") || menu.querySelector(ITEMS))?.focus?.({ preventScroll: true }); }
    else if (held >= 0) [...menu.querySelectorAll(ITEMS)][held]?.focus?.({ preventScroll: true });
  }
  function emptyNote(title, action, run, more = "") {
    const box = el("div", "sx-empty");
    box.append(el("b", "", title));
    if (more) box.append(el("span", "", more));
    if (action && run) box.append(button(action, "ghost mini", run));
    return box;
  }
  function groupNodes(group) {
    const head = button("", `sx-gh${group.tone === "ask" ? " warn" : ""}${group.closed ? " closed" : ""}`, () => { S.closed = { ...S.closed, [group.key]: !group.closed }; remember({ closed: S.closed }); S.painted.delete("list"); S.focus = `group:${group.key}|main`; paintList(); });
    head.dataset.nav = "group"; head.dataset.key = `group:${group.key}`; head.tabIndex = -1;
    head.setAttribute("aria-expanded", String(!group.closed));
    head.append(el("span", "", group.title), el("span", "sx-count", group.count), glyph("g-chev", "sx-car"));
    const nodes = [head];
    for (const row of group.rows) nodes.push(rowNode(row));
    if (group.older > 0) {
      const more = button(`Show ${Math.min(DONE_STEP, group.older)} older · ${group.older} more`, "sx-older", () => { S.doneMore += DONE_STEP; S.painted.delete("list"); paintList(); });
      more.dataset.nav = "more"; more.dataset.key = `more:${group.key}`; more.tabIndex = -1;
      nodes.push(more);
    }
    return nodes;
  }
  function rowNode(row) {
    const box = el("div", "sx-row"); box.dataset.key = row.id; box.dataset.tone = row.tone;
    if (row.selected) { box.dataset.selected = ""; }
    if (S.renaming?.id === row.id) return renameNode(row, box);
    const main = el("button", "sx-row-main"); main.type = "button"; main.dataset.nav = "row"; main.dataset.part = "main"; main.tabIndex = -1;
    if (row.selected) main.setAttribute("aria-current", "true");
    main.title = `${row.full || row.title} · ${row.label}${row.worktree ? " · in its own worktree" : ""}`;
    main.setAttribute("aria-label", `${row.title}. ${row.label}${row.status && row.status !== row.label ? `. ${row.status}` : ""}${row.worktree ? ". In its own worktree" : ""}${row.pinned ? ". Pinned" : ""}`);
    const text = el("span", "sx-row-text");
    const top = el("span", "sx-row-top");
    if (row.pinned) top.append(glyph("g-pin", "sx-pin"));
    top.append(el("span", "sx-row-title", row.title));
    if (row.worktree) { const mark = glyph("g-worktree", "sx-branch"); top.append(mark); }
    text.append(top);
    // Every line is drawn; what a row says follows html[data-detail] in the stylesheet (titles, + status, everything), so a change of
    // setting shows at once and costs no redraw.
    text.append(el("span", "sx-row-meta", row.status));
    if (row.extra) text.append(el("span", "sx-row-more", row.extra));
    if (row.progress !== null && row.tone === "run") { const bar = el("i", "sx-row-bar"); const fill = el("b"); fill.style?.setProperty?.("--pct", `${Math.round(row.progress * 100)}%`); bar.append(fill); text.append(bar); }
    main.append(el("i", "sx-dot"), text);
    main.addEventListener("click", () => select(row.id));
    const more = el("button", "sx-row-menu"); more.type = "button"; more.dataset.part = "menu"; more.dataset.nav = "menu"; more.tabIndex = -1;
    more.setAttribute("aria-label", `More actions for ${row.title}`); more.setAttribute("aria-haspopup", "menu"); more.setAttribute("aria-expanded", String(S.menu === row.id));
    more.append(glyph("g-more"));
    more.addEventListener("click", (event) => { event.stopPropagation?.(); openMenu(row.id, false); });
    box.append(main, more);
    return box;
  }
  // A backlog row: a plan draft opens as its own page in Plans (renderer/planning.js, the draft page), an idea in Ideas.
  function ideaRow(idea) {
    const plan = idea.kind === "plan";
    const box = el("div", "sx-row"); box.dataset.key = `${plan ? "plan" : "idea"}:${idea.id}`; box.dataset.tone = plan ? "plan" : "idea";
    const main = el("button", "sx-row-main"); main.type = "button"; main.dataset.nav = "row"; main.dataset.part = "main"; main.tabIndex = -1;
    main.title = `${idea.title} · ${idea.meta}`;
    main.setAttribute("aria-label", `${plan ? "Plan" : "Idea"}: ${idea.title}. ${idea.meta}`);
    const text = el("span", "sx-row-text");
    text.append(el("span", "sx-row-top", idea.title));
    text.append(el("span", "sx-row-meta", idea.meta));
    main.append(el("i", "sx-dot"), text);
    main.addEventListener("click", () => (plan ? window.MefiNav?.go?.("plans", { planId: idea.id, view: "draft" }) : window.MefiNav?.go?.("ideas", { ideaId: idea.id })));
    box.append(main);
    return box;
  }
  function renameNode(row, box) {
    const input = el("input", "sx-rename"); input.type = "text"; input.value = S.renaming.value ?? row.full ?? row.title; input.maxLength = 90;
    input.setAttribute("aria-label", `Rename ${row.title}`); input.dataset.typeHere = "";
    input.addEventListener("input", () => { S.renaming.value = input.value; });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); void commitRename(row.id, input.value); }
      else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); S.renaming = null; S.focus = `${row.id}|main`; S.painted.delete("list"); paintList(); }
    });
    box.append(el("i", "sx-dot"), input);
    // The name is selected when the box first opens; a redraw while someone types puts the caret back at the end instead.
    const first = !S.renaming.drawn; S.renaming.drawn = true;
    frame(() => { input.focus?.({ preventScroll: true }); if (first) input.select?.(); else input.setSelectionRange?.(input.value.length, input.value.length); });
    return box;
  }
  async function commitRename(taskId, title) {
    const clean = String(title ?? "").trim().slice(0, 90);
    const task = taskById(taskId);
    S.renaming = null; S.focus = `${taskId}|main`; S.painted.delete("list");
    if (!clean || !task || clean === String(task.title || "").trim()) { paintList(); return; }
    try {
      const result = await api()?.tasksAction?.({ taskId, projectId: S.projectId, action: "rename", title: clean });
      if (!result || result.ok === false) throw new Error(result?.error || "That did not work. Try again.");
      toast("Renamed.", "good");
      window.MefiWorkspace?.refresh?.(true);
    } catch (error) { toast(plain(error, "The task could not be renamed."), "bad"); }
    schedule();
  }

  // ---- the row's menu ---------------------------------------------------------------------------------------------------------
  function openMenu(taskId, fromKeyboard) {
    S.menu = S.menu === taskId ? null : taskId;
    S.menuFocus = Boolean(fromKeyboard) && S.menu !== null;
    S.focus = S.menu ? null : `${taskId}|menu`;
    S.painted.delete("list");
    paintList();
  }
  function paintMenu(panel, data) {
    // A redraw of an open menu swaps it at once; a menu that closed leaves (letGo). Only the row's menu: the project
    // menu is an .sx-menu too, and one already leaving (inert) is left to go.
    const rows = [...(panel.root.querySelectorAll?.(".sx-menu") ?? [])].filter((node) => !node.classList?.contains?.("sx-projmenu") && !node.hasAttribute?.("inert"));
    for (const old of rows) { if (S.menu) old.remove?.(); else letGo(old); }
    if (!S.menu) return;
    const task = taskById(S.menu, data);
    if (!task) { S.menu = null; return; }
    const pinned = builder().pins().has(task.id);
    const run = running(data, task);
    const menu = el("div", "sx-menu"); menu.setAttribute("role", "menu"); menu.setAttribute("aria-label", `Actions for ${clip(task.title || "this task", 40)}`);
    const item = (label, run2, { danger = false, icon = null } = {}) => { const node = button(label, `sx-menu-item${danger ? " danger" : ""}`, () => { closeMenu(false); run2(); }, { icon }); node.setAttribute("role", "menuitem"); node.tabIndex = -1; menu.append(node); return node; };
    if (typeof window.MefiTabs?.open === "function") item("Open in a new tab", () => window.MefiTabs.open("workspace", routeOf(task.id), { preview: false }), { icon: "g-add" });
    else item("Open", () => select(task.id), { icon: "g-tasks" });
    item(pinned ? "Unpin" : "Pin to the top", () => builder().setPinned(task.id, !pinned), { icon: "g-pin" });
    item("Rename", () => { S.renaming = { id: task.id, value: task.title || "" }; S.painted.delete("list"); paintList(); });
    if (run) item("Stop this task", () => { const spec = builder().taskActionSpecs(task, builder().reading(task, data), run, data).find((row) => row.id === "stop"); if (spec) void builder().perform(spec.id, spec.call, spec.doneUnarmed ?? spec.done); }, { icon: "g-close" });
    item("Delete", () => void deleteTask(task), { danger: true, icon: "g-close" });
    menu.addEventListener("keydown", (event) => {
      const items = [...menu.querySelectorAll("[role=menuitem]")];
      const at = items.indexOf(document.activeElement);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); items[(at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus?.({ preventScroll: true }); }
      else if (event.key === "Home" || event.key === "End") { event.preventDefault(); items[event.key === "Home" ? 0 : items.length - 1]?.focus?.({ preventScroll: true }); }
      else if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); event.stopPropagation(); closeMenu(true); }
    });
    // Beside its row, inside the panel, so the list's own clipping never cuts it.
    const anchor = [...(panel.groups.querySelectorAll?.("[data-key]") ?? [])].find((node) => node.dataset?.key === task.id);
    const place = anchor?.getBoundingClientRect?.(), frame = panel.root.getBoundingClientRect?.();
    if (place && frame && menu.style) {
      menu.style.top = `${Math.max(8, Math.round(place.bottom - frame.top + 2))}px`;
      menu.style.right = "10px";
    }
    panel.root.append(menu);
    if (S.menuFocus) { S.menuFocus = false; menu.querySelector("[role=menuitem]")?.focus?.({ preventScroll: true }); }
  }
  function closeMenu(restore) {
    if (!S.menu) return;
    const id = S.menu;
    S.menu = null; S.painted.delete("list");
    if (restore) S.focus = `${id}|menu`;
    paintList();
  }
  function onPointerDown(event) {
    if (S.projMenu && !event.target?.closest?.(".sx-projmenu, #sessions-project")) closeProjectMenu(false);
    if (S.compose?.runMenu && !S.compose.runMenu.hidden && !event.target?.closest?.(".sx-runwrap")) closeRunMenu(false);
    if (S.panels.inspector?.moreMenu && !S.panels.inspector.moreMenu.hidden && !event.target?.closest?.(".sx-itab-menu, #sessions-itab-more")) closeTabMenu(false);
    if (!S.menu) return;
    if (event.target?.closest?.(".sx-menu, .sx-row-menu")) return;
    closeMenu(false);
  }

  // ---- deleting --------------------------------------------------------------------------------------------------------------
  // The board's own delete (tasks:delete) behind the styled confirm, and the same Undo from Recently deleted the Task
  // board gives: the toast's Undo puts the record back, and Task board > More > Recently deleted keeps it for 30 days.
  async function deleteTask(task) {
    if (!task?.id || !api()?.tasksDelete) return;
    const name = clip(task.title || "this task", 40);
    const agreed = typeof window.MefiConfirm === "function" ? await window.MefiConfirm(`Delete “${name}”? It stays in Recently deleted for 30 days.`, { label: "Delete" }) : false;
    if (!agreed) return;
    let result;
    try { result = await api().tasksDelete({ taskId: task.id, projectId: task.projectId || S.projectId }); } catch (error) { result = { ok: false, error: error?.message }; }
    if (!result?.ok) { toast(`Task not deleted · ${plain(result?.error ? new Error(result.error) : null, "the task store could not be written")}`, "bad"); return; }
    if (S.open === task.id) deselect();
    const kept = Array.isArray(result.trashed) && result.trashed.some((row) => row?.kind === "task" && row.id === task.id);
    if (kept && api()?.tasksUndelete) toast(`Deleted “${name}”`, "good", { duration: 8000, action: { label: "Undo", run: () => void undoDelete(task) } });
    else toast(`Task deleted · ${name}`, "good");
    window.MefiWorkspace?.refresh?.(true);
    schedule();
  }
  async function undoDelete(task) {
    let result;
    try { result = await api().tasksUndelete({ taskId: task.id, projectId: task.projectId || S.projectId }); } catch (error) { result = { ok: false, error: error?.message }; }
    if (!result?.ok) { toast(`Not put back · ${result?.error || "Recently deleted could not be read"}`, "bad"); return; }
    toast(`Put back “${clip(task.title, 40)}”${result.warning ? ` · ${result.warning}` : ""}`, result.warning ? "warn" : "good");
    window.MefiWorkspace?.refresh?.(true);
    schedule();
  }

  // ---- the list's keys -----------------------------------------------------------------------------------------------------------
  const navItems = () => [...(S.panels.list?.groups?.querySelectorAll?.("[data-nav]") ?? [])].filter((node) => !node.hidden);
  function focusRow(index) {
    const items = navItems();
    const target = items[Math.max(0, Math.min(items.length - 1, index))];
    if (!target) return;
    for (const node of items) node.tabIndex = node === target ? 0 : -1;
    target.focus?.({ preventScroll: true });
    target.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }
  function focusByKey(key) {
    const [id, part] = String(key).split("|");
    const nodes = navItems();
    const target = nodes.find((node) => (node.dataset.key === id || node.closest?.("[data-key]")?.dataset?.key === id) && (node.dataset.part ?? "main") === part) ?? nodes.find((node) => node.dataset.key === id || node.closest?.("[data-key]")?.dataset?.key === id);
    if (!target) return;
    for (const node of nodes) node.tabIndex = node === target ? 0 : -1;
    target.focus?.({ preventScroll: true });
    target.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }
  function onListKey(event) {
    const target = event.target;
    const row = target?.closest?.(".sx-row");
    const id = row?.dataset?.key;
    if (S.renaming) return;
    const items = navItems();
    const mains = items.filter((node) => node.dataset.nav !== "menu");
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const here = mains.indexOf(target.dataset.nav === "menu" ? row?.querySelector?.('[data-part="main"]') : target);
      const next = mains[Math.max(0, Math.min(mains.length - 1, here + (event.key === "ArrowDown" ? 1 : -1)))];
      if (next) focusRow(items.indexOf(next));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault(); focusRow(items.indexOf(event.key === "Home" ? mains[0] : mains[mains.length - 1]));
    } else if (event.key === "ArrowRight" && target?.dataset?.nav === "row") {
      event.preventDefault(); row?.querySelector?.('[data-part="menu"]')?.focus?.({ preventScroll: true });
    } else if (event.key === "ArrowLeft" && target?.dataset?.nav === "menu") {
      event.preventDefault(); row?.querySelector?.('[data-part="main"]')?.focus?.({ preventScroll: true });
    } else if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && target?.dataset?.nav === "group") {
      const closed = target.getAttribute("aria-expanded") === "false";
      if ((event.key === "ArrowLeft") !== closed) { event.preventDefault(); target.click(); }
    } else if (event.key === "Delete" && id && taskById(id)) {
      event.preventDefault(); void deleteTask(taskById(id));
    } else if (event.key === "F2" && id && taskById(id)) {
      event.preventDefault(); S.renaming = { id, value: taskById(id).title || "" }; S.painted.delete("list"); paintList();
    } else if ((event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) && id && taskById(id)) {
      event.preventDefault(); openMenu(id, true);
    } else if (event.key === "Escape" && S.menu) {
      event.preventDefault(); closeMenu(true);
    }
  }
  // Ctrl N starts a task from wherever the person is, as long as these panels are the Build desktop and nothing has a hold on the keys.
  function onGlobalKey(event) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || String(event.key).toLowerCase() !== "n") return;
    if (event.defaultPrevented || !building() || S.lightbox) return;
    if (window.MefiNav?.top?.() && window.MefiNav.top() !== null) return;
    event.preventDefault();
    newTask();
  }


  // ---- pictures and shots: what a session carries ----------------------------------------------------------------------------
  // A brief names its pictures in plain lines ("The owner attached a.png at <path>"): the thread shows the pictures and not the
  // paths. An Ask that carried pictures keeps their ids on the message. Both are read back by id (assistant:image-read) and kept
  // for a while, within a budget, so a long thread never holds them all.
  const PICTURE_LINE = /The owner attached (.+) at [^\n]*?(img_[a-f0-9]{24})\.(?:png|jpe?g|webp|gif)/g;
  const PICTURE_BUDGET = 40e6;
  function briefPictures(task) {
    const text = String(task?.prompt ?? "");
    const found = [], seen = new Set();
    for (const match of text.matchAll(PICTURE_LINE)) { if (!seen.has(match[2])) { seen.add(match[2]); found.push({ id: match[2], name: match[1].trim() || "picture" }); } }
    for (const id of text.match(/img_[a-f0-9]{24}/g) ?? []) if (!seen.has(id)) { seen.add(id); found.push({ id, name: "picture" }); }
    return found.slice(0, PICTURES_SHOWN);
  }
  const briefText = (task) => String(task?.prompt ?? "").replace(/^.*The owner attached .+ at .*img_[a-f0-9]{24}\.(?:png|jpe?g|webp|gif).*\n?/gm, "").trim();
  function pictureState(id) {
    let entry = S.pictures.get(id);
    if (entry) return entry;
    entry = { state: "queued", error: "" };
    S.pictures.set(id, entry);
    loadPicture(id, entry);
    return entry;
  }
  function loadPicture(id, entry) {
    if (typeof api()?.assistantImageRead !== "function") { Object.assign(entry, { state: "failed", error: "Pictures are part of the desktop app." }); return; }
    if (S.picturesLoading >= 3) { (S.pictureQueue ??= []).push(id); return; }
    entry.state = "loading"; S.picturesLoading += 1;
    Promise.resolve(api().assistantImageRead({ id })).then((result) => {
      if (!result?.ok) { Object.assign(entry, { state: "failed", error: result?.off ? "Pictures are switched off on this PC." : result?.error || "The picture is no longer saved." }); return; }
      Object.assign(entry, { state: "ready", dataUrl: String(result.dataUrl || ""), name: result.name || "", mime: result.mime || "", width: result.width ?? null, height: result.height ?? null, bytes: result.bytes ?? 0 });
    }).catch(() => { Object.assign(entry, { state: "failed", error: "The picture could not be read." }); })
      .finally(() => {
        S.picturesLoading -= 1;
        let used = 0;
        for (const [key, row] of [...S.pictures].reverse()) { if (row.state !== "ready") continue; used += row.dataUrl.length; if (used > PICTURE_BUDGET && key !== id) S.pictures.delete(key); }
        while (S.pictureQueue?.length) { const next = S.pictureQueue.shift(); const row = S.pictures.get(next); if (row?.state === "queued") { loadPicture(next, row); break; } }
        S.painted.delete("thread"); dropPainted("inspector"); schedule();
      });
  }
  // One thumbnail: a button that opens the picture larger, a line that says it is loading, or one that says why it is not there.
  function thumbNode(info, used) {
    const entry = pictureState(info.id);
    if (entry.state === "ready") {
      const node = button("", "sx-thumb", () => openLightbox({ kind: "picture", id: info.id, name: info.name }), { aria: `Open ${info.name} larger` });
      let img = entry.img && !used.has(info.id) ? entry.img : null;
      if (!img) { img = el("img"); img.setAttribute("src", entry.dataUrl); img.setAttribute("alt", info.name); if (!entry.img) entry.img = img; }
      used.add(info.id);
      node.append(img, el("span", "sx-thumb-cap", `${info.name}${entry.width ? ` · ${entry.width} × ${entry.height}` : ""}`));
      return node;
    }
    const note = el("span", `sx-thumb ${entry.state === "failed" ? "missing" : "loading"}`, entry.state === "failed" ? `${info.name} · ${entry.error}` : `Loading ${info.name}…`);
    return note;
  }
  const thumbRow = (infos, used) => { const row = el("div", "sx-thumbs"); for (const info of infos) row.append(thumbNode(info, used)); return row; };

  // Before and after shots of the project's preview, read once for an attempt (tasks:evidence) and again when the host says a shot was taken.
  const PNG_URL = "data:image/png;base64,";
  function evidenceFor(task) {
    if (!(task.lastAttempt || task.runId || builder().isDone(task) || task.status === "awaiting_verification") || typeof api()?.tasksEvidence !== "function") return null;
    const key = JSON.stringify([task.runId ?? null, task.lastAttempt?.runId ?? null, task.lastAttempt?.at ?? null, task.status]);
    const held = S.evidence.get(task.id);
    if (held && held.key === key) return held;
    const next = { key, loading: true, shots: held?.shots ?? [] };
    S.evidence.set(task.id, next);
    Promise.resolve(api().tasksEvidence({ taskId: task.id, projectId: task.projectId || S.projectId }))
      .then((result) => { if (result?.ok) next.shots = (Array.isArray(result.shots) ? result.shots : []).filter((shot) => typeof shot?.dataUrl === "string" && shot.dataUrl.startsWith(PNG_URL)).map(({ phase, dataUrl, width, height }) => ({ phase, dataUrl, width: width || 1280, height: height || 800 })); })
      .catch(() => { /* no shots is the quiet answer */ })
      .finally(() => { next.loading = false; if (S.evidence.get(task.id) === next) { S.painted.delete("thread"); schedule(); } });
    return next;
  }
  // Before and after on one frame: the line moves with the pointer or the arrow keys, and the position is kept per task.
  function compareNode(task, before, after) {
    const box = el("div", "sx-compare");
    const at = S.compare?.get(task.id) ?? 50;
    box.style?.setProperty?.("--pos", `${at}%`);
    box.style?.setProperty?.("--ratio", `${before.width} / ${before.height}`);
    const one = el("img", "sx-cmp-before"); one.setAttribute("src", before.dataUrl); one.setAttribute("alt", "The project preview when the task started");
    const two = el("img", "sx-cmp-after"); two.setAttribute("src", after.dataUrl); two.setAttribute("alt", "The project preview when the task finished");
    const range = el("input", "sx-cmp-range"); range.type = "range"; range.min = "0"; range.max = "100"; range.value = String(at);
    range.setAttribute("aria-label", "Compare before and after");
    const say = () => range.setAttribute("aria-valuetext", `${range.value}% of the width shows before`);
    say();
    range.addEventListener("input", () => { (S.compare ??= new Map()).set(task.id, Number(range.value)); box.style?.setProperty?.("--pos", `${range.value}%`); say(); });
    box.append(one, two, el("span", "sx-cmp-tag b", "Before"), el("span", "sx-cmp-tag a", "After"), el("i", "sx-cmp-line"), range);
    return box;
  }
  function mediaCard(task, evidence) {
    const shots = evidence?.shots ?? [];
    const before = shots.find((shot) => shot.phase === "before"), after = shots.find((shot) => shot.phase === "after");
    if (!before && !after) return null;
    const card = el("section", "sx-card sx-media"); card.setAttribute("aria-label", "Before and after");
    const head = el("div", "sx-card-head"); head.append(el("b", "", before && after ? "Before and after" : before ? "Before" : "After"), el("span", "sx-card-r", "the project's preview"));
    card.append(head);
    if (before && after) card.append(compareNode(task, before, after));
    else { const one = before || after; const img = el("img", "sx-shot"); img.setAttribute("src", one.dataUrl); img.setAttribute("alt", one.phase === "before" ? "The project preview when the task started" : "The project preview when the task finished"); card.append(img); }
    const foot = el("div", "sx-card-foot"); foot.append(el("span", "", before && after ? "Drag the line, or focus it and use the arrow keys." : "Captured for this attempt."));
    foot.append(button("Open larger", "sx-link", () => openLightbox({ kind: "evidence", taskId: task.id }), { title: "Open the shots larger" }));
    card.append(foot);
    return card;
  }

  // After the last run: what it changed, and the way to the Changes tab (the files and their diffs are review.js's, in the inspector).
  function evidenceLink(task, counts) {
    if (!counts?.files) return null;
    const li = el("li", "sx-item is-evidence");
    const line = el("div", "sx-evidence");
    line.append(glyph("g-route"), el("span", "sx-evidence-words", `${plural(counts.files, "file")} changed`), el("span", "sx-evidence-n", `+${counts.additions} −${counts.deletions}`));
    if (counts.accepted) line.append(chip("Accepted", { tone: "good" }));
    line.append(button("See the changes", "sx-link", () => setTab(task, "changes"), { title: "Open the Changes tab: every file and its diff" }));
    li.append(line);
    return li;
  }

  // ---- the thread -------------------------------------------------------------------------------------------------------------
  function buildThread() {
    const root = el("section", "sx-panel sx-thread"); root.id = "sessions-thread"; root.setAttribute("aria-label", "Session"); root.dataset.short = "false";
    const head = el("div", "sx-head"); head.id = "sessions-head";
    const scroll = el("div", "sx-scroll"); scroll.id = "sessions-thread-scroll";
    const col = el("div", "sx-col"); scroll.append(col);
    const dock = el("div", "sx-dock"); dock.id = "sessions-dock";
    const form = buildComposer();
    root.append(head, scroll, dock, form);
    S.panels.main = { root, head, scroll, col, dock, form };
  }
  function paintThread() {
    const panel = S.panels.main;
    if (!panel) return;
    const data = snap();
    const task = taskById(S.open, data);
    if (!task) { paintMissing(panel, data); return; }
    const B = builder();
    B.loadAttempts(task);
    lookForWorktrees();
    const reading = B.reading(task, data);
    const run = running(data, task);
    const record = B.attempts(task.id);
    const questions = questionsFor(task, data).filter((question) => !S.later.has(question.id));
    const folded = questionsFor(task, data).filter((question) => S.later.has(question.id));
    const decided = decisionFor(task);
    const evidence = evidenceFor(task);
    const items = feedItems(task, data, decided);
    const pictures = [...briefPictures(task), ...items.flatMap((item) => (item.ask?.images || []).map((image) => ({ id: image.id, name: image.name })))].map(({ id }) => [id, S.pictures.get(id)?.state ?? null]);
    const branch = S.wt.rows.get(task.id) ?? null;
    const counts = reviewCounts(task.id);
    const minute = Math.floor(Date.now() / 60000);
    const signature = [counts, task, reading.tone, reading.label, reading.summary, run, record?.attempts, record?.loading, record?.error, questions, folded.map((q) => q.id), decided, items.map((item) => [item.kind, item.at, item.text, item.ask?.reply, item.ask?.pending, item.ask?.error]), pictures, evidence?.shots?.map((shot) => [shot.phase, shot.dataUrl.length]), evidence?.loading ?? null, B.busy(), S.sending, B.pins().has(task.id), branch?.branch ?? null, B.chips.state.where?.branch ?? null, costWords(task)?.text ?? null, [...S.dockOpen], [...S.dockFold], S.short, minute, data.preview?.phase ?? null, window.MefiAutonomy?.state?.()?.level ?? null];
    if (changed("thread", signature)) {
      const stick = panel.scroll.scrollTop + panel.scroll.clientHeight >= panel.scroll.scrollHeight - 40 || S.stuckFor !== task.id;
      S.stuckFor = task.id;
      panel.head.replaceChildren(...headNodes(task, reading, run, data, branch));
      const used = new Set();
      const out = [...bannerNodes(task, reading, run, data, record)];
      const media = mediaCard(task, evidence);
      const feed = el("ol", "sx-feed"); feed.setAttribute("aria-label", "What happened on this session");
      let placed = false;
      const lastRun = items.map((item) => item.kind).lastIndexOf("run");
      items.forEach((item, index) => {
        feed.append(feedNode(item, task, used));
        if (index === lastRun) {
          const link = evidenceLink(task, counts);
          if (link) feed.append(link);
          if (media && !placed) { const li = el("li", "sx-item is-media"); li.append(media); feed.append(li); placed = true; }
        }
      });
      if (media && !placed) { const li = el("li", "sx-item is-media"); li.append(media); feed.append(li); }
      if (record?.loading && !record.attempts.length) feed.append(el("li", "sx-note", "Loading its runs…"));
      else if (record?.error) feed.append(el("li", "sx-note", record.error));
      out.push(feed);
      if (run) out.push(nowNode(run), liveNode(task));
      panel.col.replaceChildren(...out);
      panel.dock.replaceChildren(...dockNodes(questions, folded));
      panel.dock.hidden = !panel.dock.childElementCount && !panel.dock.children?.length;
      if (stick) panel.scroll.scrollTop = panel.scroll.scrollHeight;
    }
    paintComposer(task, reading, run, data);
  }
  // A session that is not on the board: a slow launch has not read the board yet (said in words for a few seconds); after that
  // it is gone (deleted elsewhere, or another project's) and the thread lets go of it.
  function paintMissing(panel, data) {
    const loading = !tasksOf(data).length && Date.now() - (S.restoredAt || 0) < 6000;
    if (loading) {
      if (!changed("thread", ["missing", S.open])) return;
      panel.head.replaceChildren();
      const box = el("div", "sx-missing"); box.append(el("b", "", "Opening the session…"));
      panel.col.replaceChildren(box);
      panel.dock.replaceChildren(); panel.dock.hidden = true;
      panel.form.hidden = true;
      return;
    }
    if (S.visible) toast("That session is no longer on the board.", "info");
    deselect();
  }
  const chip = (text, { tone = "", dot = false, title = "", icon = null } = {}) => {
    const node = el("span", "sx-chip"); if (tone) node.dataset.tone = tone; if (title) node.title = title;
    if (dot) node.append(el("i")); if (icon) node.append(glyph(icon));
    node.append(document.createTextNode(text));
    return node;
  };
  function specButton(spec, task) {
    const busy = Boolean(builder().busy()) || S.sending;
    const node = button(spec.label, `sx-btn ${spec.kind === "primary" ? "primary" : "ghost"} mini`, null, { title: spec.title });
    node.dataset.spec = spec.id;
    node.disabled = busy;
    if (spec.intent) node.addEventListener("click", () => setIntent(task, spec.intent, true));
    else if (spec.open) node.addEventListener("click", () => spec.open());
    else {
      const go = () => void builder().perform(spec.id, spec.call, spec.done);
      const goPlain = () => void builder().perform(spec.id, spec.call, spec.doneUnarmed ?? spec.done);
      if (spec.armed && window.MefiUi?.arm) window.MefiUi.arm(node, { armed: spec.armed, run: go });
      else if (spec.armed && typeof window.MefiConfirm === "function") node.addEventListener("click", async () => { if (await window.MefiConfirm(`${spec.label}?`, { label: spec.label })) go(); });
      else node.addEventListener("click", goPlain);
    }
    return node;
  }
  function iconButton(label, icon, run, { pressed = null, title = "" } = {}) {
    const node = button("", "sx-icon", run, { icon, title: title || label, aria: label });
    if (pressed !== null) node.setAttribute("aria-pressed", String(pressed));
    return node;
  }
  // How many of its checks a task has passed: the last check run's results when there was one, else its "done when" lines (all of them
  // once it is verified or you confirmed it, none before).
  function checksCount(task) {
    const results = Array.isArray(task.verificationRun?.results) ? task.verificationRun.results : [];
    if (results.length) return { passed: results.filter((result) => result.ok === true).length, total: results.length, results: true };
    const lines = builder().acceptanceOf(task).map((line) => String(line).trim()).filter(Boolean);
    if (!lines.length) return null;
    const met = ["verified", "manual"].includes(task.verification?.state);
    return { passed: met ? lines.length : 0, total: lines.length, results: false };
  }
  // What the task cost, when that is known: the usage the Agent tab already read (tasks.js's words), never a read of its own. A
  // builder that reports no cost (Claude Code, Codex) is said to be timed only.
  function costWords(task) {
    const report = S.metrics.get(task.id)?.report;
    const usage = window.MefiTasks?.usage;
    const cost = report?.task?.cost?.state ? report.task.cost : report?.attempt?.cost;
    if (!cost || !usage) return null;
    if (cost.state === "reported") return { text: usage.usageCost(cost), title: "What its runs cost, from the usage ledger" };
    if (cost.state === "not-reported") return { text: "Time only", title: `${report?.attempt?.route?.label || "This builder"} does not report tokens or cost to Studio. Time is measured here.` };
    return null;
  }
  function headNodes(task, reading, run, data, branch) {
    const B = builder();
    const top = el("div", "sx-head-top");
    const title = el("h1", "sx-title", task.title || window.MefiTasks?.shortTitle?.(task) || "Untitled task"); title.title = task.title || "";
    const actions = el("div", "sx-actions");
    for (const spec of B.taskActionSpecs(task, reading, run, data)) actions.append(specButton(spec, task));
    const pinned = B.pins().has(task.id);
    actions.append(iconButton(pinned ? "Unpin this session" : "Pin this session", "g-pin", () => B.setPinned(task.id, !pinned), { pressed: pinned, title: pinned ? "Unpin from the top of its group" : "Pin to the top of its group" }));
    actions.append(iconButton("Open on the task board", "g-tasks", () => window.MefiNav?.go?.("tasks", { taskId: task.id, projectId: S.projectId, filter: "all", board: true }), { title: "Open on the task board: details, evidence, history" }));
    const drop = B.dropSpec(task, run, data);
    if (drop) actions.append(specButton({ ...drop, label: "Drop" }, task));
    top.append(title, actions);
    // The prototype's chips: where it stands, who is on it, the branch it works on, its checks and what it cost (when that is known),
    // then when it began and how urgent it is.
    const chips = el("div", "sx-chips");
    chips.append(chip(reading.label, { tone: reading.tone, dot: true }));
    const worker = run?.route || task.lastAttempt?.route || task.lastAttempt?.via;
    if (worker) chips.append(chip(String(worker), { title: "Who is on it" }));
    const where = B.chips.state.where;
    if (branch) chips.append(chip(String(branch.branch || "own worktree"), { icon: "g-worktree", title: "Runs in its own worktree" }));
    else if (where?.repo && where.branch && (where.projectId == null || where.projectId === S.projectId)) chips.append(chip(String(where.branch), { icon: "g-route", title: `Works on ${where.branch}, in the project's own folder` }));
    const checks = checksCount(task);
    if (checks) chips.append(chip(`Checks ${checks.passed} of ${checks.total}`, { title: checks.results ? "Its completion checks: the last run's results" : "What it is done when; nothing has checked it yet" }));
    const cost = costWords(task);
    if (cost) chips.append(chip(cost.text, { title: cost.title }));
    const since = B.stampOf(task.createdAt);
    if (since) chips.append(chip(`Started ${B.ago(since)}`));
    if (task.priority && task.priority !== "normal") chips.append(chip(`${task.priority} priority`));
    return [top, chips];
  }

  // ---- banners: where the task stands --------------------------------------------------------------------------------------------
  const statusSpec = (task, status, label, done, armed = "") => ({ id: `status-${status}`, label, kind: status === "done" ? "primary" : "ghost", title: "", armed, call: () => api().tasksAction({ taskId: task.id, projectId: S.projectId, action: "status", status }), done });
  function bannerNodes(task, reading, run, data, record) {
    const B = builder();
    const summary = reading.summary || {};
    const last = record?.attempts?.[0];
    const banner = (tone, title, text, actions = []) => {
      const node = el("section", "sx-banner"); node.dataset.tone = tone; node.setAttribute("role", tone === "bad" ? "alert" : "status");
      const words = el("div", "sx-banner-words"); words.append(el("h3", "", title)); if (text) words.append(el("p", "", text));
      const acts = el("div", "sx-banner-acts");
      for (const action of actions) acts.append(action);
      node.append(el("i", "sx-banner-dot"), words, acts);
      return node;
    };
    const ghost = (label, run2, title = "") => button(label, "sx-btn ghost mini", run2, { title });
    const spec = (row) => specButton(row, task);
    if (B.isDone(task)) {
      if (task.dropped) return [banner("dim", "Dropped", "Closed without finishing. Reopen puts it back on the board.", [spec(statusSpec(task, "open", "Reopen", "Reopened. It is back in the queue."))])];
      const verified = task.verification?.state === "verified";
      // Open app and Request a change are the head's own buttons (builder.js's specs for a finished task).
      return [banner("good", verified ? "Verified" : task.verification?.state === "manual" ? "Done, confirmed by you" : "Done", task.verification?.reason || summary.nextAction || "", [spec(statusSpec(task, "open", "Reopen", "Reopened. It is back in the queue."))])];
    }
    if (reading.tone === "check") {
      return [banner("info", "Checking the result", "The worker finished. Completion checks are pending; this is not marked done yet.", [ghost("See the changes", () => setTab(task, "changes")), ghost("Request changes", () => setIntent(task, "change", true)), spec(statusSpec(task, "done", "Approve and finish", "Marked done. You confirmed the result.", "Really finish?"))])];
    }
    // A task that will fix itself (builder.js reading().fixing: its checks failed and it tries again by itself) is not a
    // problem to look at: it says so, calmly, and the checks stay one press away.
    if (!run && reading.fixing) {
      const retry = Number(task.nextRunAt) - Date.now();
      const when = retry > 60000 ? ` in about ${Math.round(retry / 60000)} min` : retry > 0 ? " in a moment" : "";
      return [banner("info", "Fixing itself", `The last try did not pass its checks, so it tries again by itself${when}. It only asks you if it gives up.`, [ghost("See the checks", () => setTab(task, "checks"))])];
    }
    if (!run && (task.verification?.state === "failed" || reading.stage === "blocked")) {
      const why = task.verification?.reason || summary.blocker || task.lastRunError || (last?.outcome === "failed" ? last.error : "") || "The last attempt could not be confirmed.";
      return [banner("bad", task.verification?.state === "failed" ? "Its checks did not pass" : "It is blocked", why, [ghost("See the checks", () => setTab(task, "checks")), ghost("Request a change", () => setIntent(task, "change", true))])];
    }
    if (reading.stage === "approval") return [banner("warn", "Waiting for your approval", summary.blocker || "Review the brief, then approve the build.")];
    return [];
  }

  // ---- the feed ----------------------------------------------------------------------------------------------------------------------
  // What happened, in the order it happened: the builder kit's timeline, with the Asks rebuilt from the thread so a question
  // and its answer (and any picture on it) survive a reload, and what Mefi decided for you.
  function askItems(task, data) {
    const out = [];
    const mine = new RegExp(`^About the task "[\\s\\S]*" \\(${escapeRe(task.id)}\\): ([\\s\\S]*)$`);
    const messages = (data.assistant?.messages || []).filter((message) => message && (!message.projectId || message.projectId === data.projectId));
    messages.forEach((message, index) => {
      if (message.role !== "user") return;
      const match = mine.exec(String(message.text || ""));
      if (!match) return;
      let reply = null;
      for (let next = index + 1; next < messages.length && !reply; next += 1) {
        if (messages[next].role === "user") break;
        if (messages[next].role === "assistant" && messages[next].kind !== "notice") reply = messages[next];
      }
      out.push({ kind: "ask", at: stampOf(message.at), text: match[1], ask: { text: match[1], at: stampOf(message.at), images: (Array.isArray(message.images) ? message.images : []).filter((image) => image?.id).map((image) => ({ id: image.id, name: String(image.name || "picture") })), reply: reply?.text || "", pending: false, error: "" } });
    });
    for (const local of builder().asks(task.id)) {
      const twin = out.find((item) => item.ask.text === local.text && Math.abs(item.at - local.at) < 180000);
      if (twin) { twin.ask.pending = Boolean(local.pending) && !twin.ask.reply; twin.ask.error = local.error || ""; if (!twin.ask.reply && local.reply) twin.ask.reply = local.reply; continue; }
      out.push({ kind: "ask", at: local.at, text: local.text, ask: { ...local, images: [] } });
    }
    return out;
  }
  function decisionFor(task) {
    const state = window.MefiAutonomy?.state?.();
    if (!state || !Array.isArray(state.decisions)) return null;
    if (state.projectId && S.projectId && state.projectId !== S.projectId) return null;
    return state.decisions.filter((row) => row?.taskId === task.id && !row.pending && !row.failed).slice(-1)[0] ?? null;
  }
  function feedItems(task, data, decided) {
    const items = builder().timeline(task, data).filter((item) => item.kind !== "ask");
    items.push(...askItems(task, data));
    if (decided) items.push({ kind: "decided", at: stampOf(decided.at), decided });
    return items.filter((item) => item.at || item.kind === "brief").sort((a, b) => a.at - b.at);
  }
  const OUTCOME_TONE = { "finished-ok": "good", failed: "bad", stopped: "warn", released: "dim", unrecorded: "dim" };
  function who(name, at, kind = "") {
    const row = el("div", "sx-who");
    row.append(el("span", `sx-av${kind ? ` ${kind}` : ""}`, name === "You" ? "Y" : name.trim()[0]?.toUpperCase() || "M"), el("b", "", name));
    if (at) { const time = el("time", "", `${builder().ago(at)} · ${clockOf(at)}`); time.title = new Date(at).toLocaleString(); row.append(time); }
    return row;
  }
  function bubble(text, extra) {
    const node = el("div", "sx-bubble"); node.append(el("p", "sx-text", text));
    if (extra) node.append(extra);
    return node;
  }
  function feedNode(item, task, used) {
    const li = el("li", `sx-item is-${item.kind}`);
    const companion = String(read("mefiStudio.workspace.companion", "Mefi") || "Mefi").trim() || "Mefi";
    if (item.kind === "brief") {
      li.append(who(item.who === "An agent" ? "An agent" : "You", item.at));
      const pics = briefPictures(task);
      const extra = el("div", "sx-extra");
      if (pics.length) extra.append(thumbRow(pics, used));
      const acceptance = Array.isArray(task.acceptance) ? task.acceptance.filter(Boolean) : [];
      if (acceptance.length && !/\bdone when\b/i.test(item.text)) { extra.append(el("small", "", "Done when")); const list = el("ul", "sx-list-plain"); for (const line of acceptance) list.append(el("li", "", String(line))); extra.append(list); }
      li.append(bubble(briefText(task) || item.text, extra.childElementCount || extra.children?.length ? extra : null));
    } else if (item.kind === "note") {
      li.append(who("You", item.at), bubble(item.text), el("span", "sx-tag", "Note"));
    } else if (item.kind === "ask") {
      li.append(who("You", item.at));
      const pics = item.ask.images || [];
      li.append(bubble(item.ask.text, pics.length ? thumbRow(pics, used) : null));
      if (item.ask.reply) { li.append(who(companion, 0, "m"), bubble(item.ask.reply)); }
      else if (item.ask.pending) li.append(el("p", "sx-note", `${companion} is thinking…`));
      else if (item.ask.error) li.append(el("p", "sx-note bad", item.ask.error));
    } else if (item.kind === "notice") {
      li.append(who(companion, item.at, "m"), bubble(item.text));
    } else if (item.kind === "run") {
      li.append(runCard(item));
    } else if (item.kind === "verdict") {
      li.dataset.outcome = item.state === "verified" ? "good" : item.state === "failed" ? "bad" : "";
      const line = el("div", "sx-line"); line.append(el("b", "", item.state === "verified" ? "Verified" : item.state === "failed" ? "Not accepted" : "Checked"), el("span", "", item.text)); li.append(line);
    } else if (item.kind === "decided") {
      li.append(decidedCard(item.decided));
    } else {
      const line = el("div", "sx-line"); line.append(el("b", "", item.kind === "result" ? "Result" : "Update"), el("span", "", item.text)); li.append(line);
    }
    return li;
  }
  // One run: how it began, what it fell back to, how it ended and what it said.
  function runSteps(attempt, live) {
    const steps = [];
    const at = (value) => (value ? clockOf(value) : "");
    steps.push({ state: attempt.startedAt ? "ok" : "no", label: `Started${attempt.via ? ` on ${attempt.via}` : ""}`, at: at(attempt.startedAt) });
    for (const fallback of attempt.fallbacks || []) steps.push({ state: "warn", label: `Fell back to the next worker${fallback.reason ? ` · ${fallback.reason}` : ""}`, at: at(fallback.at) });
    if (live) steps.push({ state: "go", label: "Working now", at: "" });
    else if (attempt.release) steps.push({ state: "no", label: `Released: ${attempt.release.reason || "the claim was dropped"}`, at: at(attempt.release.at) });
    else if (attempt.finishedAt) {
      const took = attempt.seconds ? ` · took ${builder().span(attempt.seconds)}` : "";
      if (attempt.stopped) steps.push({ state: "warn", label: attempt.stoppedAtLimit ? `Stopped at the ${attempt.limitMinutes} minute limit${took}` : `Stopped${took}`, at: at(attempt.finishedAt) });
      else steps.push({ state: attempt.ok ? "ok" : "bad", label: `${attempt.ok ? "Finished" : "Failed"}${took}`, at: at(attempt.finishedAt) });
    }
    return steps;
  }
  function runCard(item) {
    const attempt = item.attempt;
    const card = el("section", "sx-card sx-run"); card.dataset.outcome = item.live ? "running" : attempt.outcome;
    const head = el("div", "sx-card-head");
    const outcome = item.live ? "Working now" : { "finished-ok": "Reported done", failed: "Failed", stopped: "Stopped", released: "Released", unrecorded: "No end recorded" }[attempt.outcome] || "Run";
    head.append(chip(outcome, { tone: item.live ? "run" : OUTCOME_TONE[attempt.outcome] || "", dot: true }), el("span", "sx-card-r", item.at ? `${builder().ago(item.at)} · ${clockOf(item.at)}` : ""));
    card.append(head);
    const list = el("ol", "sx-steps");
    for (const step of runSteps(attempt, item.live)) {
      const row = el("li", `sx-step ${step.state}`);
      row.append(el("span", "sx-step-mark", step.state === "ok" ? "✓" : step.state === "bad" ? "✕" : step.state === "go" ? "●" : step.state === "warn" ? "!" : "○"), el("span", "sx-step-label", step.label), el("span", "sx-step-at", step.at));
      list.append(row);
    }
    card.append(list);
    const why = attempt.error || "";
    if (why) card.append(el("p", "sx-why", why));
    if (attempt.result) card.append(el("p", "sx-result", String(attempt.result).slice(0, 700)));
    if (!item.live && attempt.tail?.length) {
      const said = el("details", "sx-said"); said.append(el("summary", "", "What it said"), el("pre", "", attempt.tail.slice(-24).join("\n")));
      card.append(said);
    }
    return card;
  }
  function decidedCard(decision) {
    const node = el("div", "sx-decided");
    const words = el("span", "sx-decided-words");
    words.append(el("b", "", "Mefi decided"), document.createTextNode(` · ${decision.label || decision.choice || "an answer"}`));
    if (decision.reason) words.append(el("small", "", decision.reason));
    node.append(glyph("g-spark"), words);
    if (decision.undone) node.append(el("span", "sx-decided-note", "Undone"));
    else if (decision.undoPending) node.append(el("span", "sx-decided-note", "Undo waits for the worker to finish"));
    else if (typeof api()?.autonomyUndo === "function") node.append(button("Undo", "sx-btn ghost mini", () => void undoDecision(decision), { title: "Take back what Mefi decided: its ask is open again" }));
    return node;
  }
  async function undoDecision(decision) {
    try {
      const result = await api().autonomyUndo({ id: decision.id, projectId: S.projectId });
      if (!result || result.ok === false) throw new Error(result?.error || "That could not be undone.");
      toast("Undone. The question is open again.", "good");
      window.MefiAutonomy?.refresh?.();
      window.MefiWorkspace?.refresh?.(true);
    } catch (error) { toast(plain(error, "That could not be undone."), "bad"); }
  }
  // The worker's live line: what it is doing, since when, how far, and its last output.
  function nowNode(run) {
    const node = el("div", "sx-now"); node.setAttribute("role", "status");
    const label = run.stopping ? "Stopping safely" : run.phase === "preparing" ? "Preparing" : run.phase === "finishing" ? "Finishing" : "Working now";
    node.append(el("i", "sx-now-dot"), el("span", "sx-now-words", `${label} · ${clip(run.currentStep || run.activity || "Waiting for the worker's first line", 120)}`));
    const since = Number(run.startedAt) || 0;
    if (since) node.append(el("span", "sx-now-r", `since ${clockOf(since)} · ${howLong(Date.now() - since)}`));
    if (Number.isFinite(Number(run.progress))) { const bar = document.createElement("progress"); bar.max = 1; bar.value = Math.max(0, Math.min(1, Number(run.progress))); bar.className = "sx-progress"; bar.setAttribute("aria-label", `Reported progress: ${Math.round(bar.value * 100)} percent`); node.append(bar); }
    return node;
  }
  function liveNode(task) {
    const tail = Array.isArray(task.runProgress?.outputTail) ? task.runProgress.outputTail.slice(-10) : [];
    const fold = el("details", "sx-said sx-live"); fold.open = true;
    fold.append(el("summary", "", "Live output"), el("pre", "", tail.length ? tail.join("\n") : "Nothing yet. A run's output shows here while it works."));
    return fold;
  }

  // ---- a question that waits on you ---------------------------------------------------------------------------------------------
  // Docked above the box so it is never hunted for. Its options are the question's own, the one it recommends first; a
  // suggestion Mefi made is named, never acted on; "Decide later" only puts the card away for now (it stays in Needs you).
  // The host decides for you at once where your permission mode allows it and keeps the record under "Mefi decided", so there
  // is no countdown here: there is nothing that counts down.
  function dockNodes(questions, folded) {
    const out = [];
    for (const question of questions) out.push(questionNode(question));
    for (const question of folded) {
      const node = el("div", "sx-ask mini later");
      node.append(el("span", "sx-ask-k", "Decide later"), el("span", "sx-q1", clip(question.title || question.question || "A decision", 90)), button("Answer now", "sx-btn primary mini", () => { S.later.delete(question.id); S.painted.delete("thread"); schedule(); }));
      out.push(node);
    }
    return out;
  }
  function questionNode(question) {
    const B = builder();
    const card = el("section", "sx-ask"); card.dataset.qid = question.id; card.setAttribute("aria-label", "A decision this session is waiting on");
    const waited = question.at ? howLong(Date.now() - stampOf(question.at)) : "";
    const mini = S.short && !S.dockOpen.has(question.id) || S.dockFold.has(question.id);
    if (mini) {
      const node = el("div", "sx-ask mini"); node.dataset.qid = question.id;
      node.append(el("span", "sx-ask-k", "Needs your answer"), el("span", "sx-q1", clip(question.title || question.question || "A decision", 90)), button("Answer", "sx-btn primary mini", () => { S.dockOpen.add(question.id); S.dockFold.delete(question.id); S.painted.delete("thread"); schedule(); }));
      return node;
    }
    const top = el("div", "sx-ask-top");
    top.append(el("span", "sx-ask-k", `Needs your answer${waited ? ` · waiting ${waited}` : ""}`));
    const fold = button("", "sx-icon small", () => { S.dockFold.add(question.id); S.dockOpen.delete(question.id); S.painted.delete("thread"); schedule(); }, { icon: "g-chev", aria: "Fold the question to one line", title: "Fold to one line, so the thread has more room" });
    top.append(fold);
    card.append(top, el("h2", "sx-ask-q", question.title || question.question || "A decision"));
    if (question.detail) card.append(el("p", "sx-ask-detail", question.detail));
    const suggestion = question.context?.suggestion;
    const suggested = suggestion?.optionId ? (question.options || []).find((option) => option.id === suggestion.optionId) : null;
    if (suggested) card.append(el("p", "sx-ask-suggest", `Mefi suggests “${suggested.label}”${suggestion.reason ? `: ${suggestion.reason}` : "."}`));
    const evidence = Array.isArray(question.context?.evidence) ? question.context.evidence.filter(Boolean) : [];
    if (evidence.length) { const list = el("ul", "sx-list-plain sx-ask-evidence"); for (const line of evidence) list.append(el("li", "", String(line))); card.append(list); }
    const busy = Boolean(B.busy()) || S.sending || !api()?.assistantAnswer;
    const options = el("div", "sx-ask-opts");
    const ordered = [...(question.options || [])].sort((a, b) => Number(Boolean(b.recommended)) - Number(Boolean(a.recommended)));
    for (const option of ordered) {
      const choice = button(option.label || option.id, `sx-btn ${option.recommended ? "primary" : "ghost"} mini`, () => void B.answerQuestion(question, { optionId: option.id }, option.label || option.id), { title: option.description || (option.id === suggestion?.optionId ? "What Mefi suggests" : "") });
      choice.disabled = busy;
      if (option.id === suggestion?.optionId) choice.classList.add("suggested");
      options.append(choice);
    }
    options.append(button("Decide later", "sx-btn ghost mini quiet", () => { S.later.add(question.id); S.painted.delete("thread"); schedule(); }, { title: "Put this away for now. It stays in Needs you." }));
    card.append(options);
    const own = el("form", "sx-ask-own");
    const input = el("input"); input.type = "text"; input.placeholder = "Or answer in your own words…"; input.setAttribute("aria-label", "Your own answer"); input.dataset.typeHere = "";
    const send = button("Answer", "sx-btn ghost mini", null, { type: "submit" });
    own.append(input, send);
    own.addEventListener("submit", (event) => { event.preventDefault(); const text = input.value.trim(); if (!text) { input.focus?.(); return; } void B.answerQuestion(question, { text }, text); });
    card.append(own);
    return card;
  }

  // ---- the three panels --------------------------------------------------------------------------------------------------------------
  function buildPanels() {
    buildList();
    buildThread();
    buildInspector();
    for (const panel of Object.values(S.panels)) if (panel?.root) panel.root.dataset.short = S.short ? "true" : "false";
  }

  // ---- worktrees: which sessions run in a checkout of their own ------------------------------------------------------------------------
  // worktrees.js lists the project's checkouts (a read-only look at git) and names the task each one holds. This only reads what
  // it already has, and asks it for a quiet fresh look at most every few seconds while the panels are drawn.
  function readWorktrees() {
    const worktrees = window.MefiWorktrees;
    const list = worktrees?.state?.()?.list;
    const rows = new Map();
    if (list?.repo && Array.isArray(list.rows)) {
      for (const row of list.rows) {
        const id = row?.task?.taskId;
        if (id && row.kind !== "primary" && row.state !== "missing") rows.set(id, { branch: String(row.branch || row.name || ""), path: String(row.path || ""), state: String(row.state || "") });
      }
    }
    // A worktrees.js that only has its summary still says which tasks have a checkout, without the branch's name.
    const named = worktrees?.summary?.();
    if (named?.repo !== false && Array.isArray(named?.tasks)) for (const id of named.tasks) if (typeof id === "string" && id && !rows.has(id)) rows.set(id, { branch: "", path: "", state: "" });
    const key = JSON.stringify([...rows]);
    if (key === S.wt.key) return false;
    S.wt.rows = rows; S.wt.key = key;
    return true;
  }
  function lookForWorktrees() {
    readWorktrees();
    const now = Date.now();
    if (typeof window.MefiWorktrees?.peek !== "function" || now - S.wt.at < 8000) return;
    S.wt.at = now;
    Promise.resolve(window.MefiWorktrees.peek()).then(() => { if (S.wired && readWorktrees()) schedule(); }).catch(() => { /* no worktrees to show is the quiet answer */ });
  }

  // ---- the box at the foot of the thread ---------------------------------------------------------------------------------------------------
  // A Note, an Ask or a Change, as builder.js does them (its INTENTS, its sendWords), with Attach picture (composer-pictures.js), the
  // @ # / picker (composer-picker.js) and the chips that say where the work runs.
  const companionName = () => String(read("mefiStudio.workspace.companion", "Mefi") || "Mefi").trim() || "Mefi";
  const INTENT_IDS = ["note", "ask", "change"];
  function intentFor(task, reading, run) {
    let intent = S.intent.get(task.id);
    if (!INTENT_IDS.includes(intent)) { intent = builder().defaultIntent(task, reading, run); S.intent.set(task.id, intent); }
    return intent;
  }
  const openIntent = () => (S.open ? S.intent.get(S.open) ?? "note" : "note");
  function buildComposer() {
    const B = builder();
    const form = el("form", "sx-compose"); form.id = "sessions-compose"; form.hidden = true; form.dataset.intent = "note"; form.noValidate = true;
    form.setAttribute("aria-label", "Write to this session");
    // As the prototype has it: the words first, then one row of controls (the purpose, Attach, the run menu, the Worktree
    // switch and Send), and a line under the box that says what the words will do.
    const modes = el("div", "sx-modes"); modes.setAttribute("role", "group"); modes.setAttribute("aria-label", "What to do with your words");
    for (const id of INTENT_IDS) {
      const choice = button(B.INTENTS[id].label, "", () => { const task = taskById(S.open); if (task) setIntent(task, id, true); }, { title: B.INTENTS[id].hint });
      choice.id = `sessions-intent-${id}`; choice.dataset.intent = id; choice.setAttribute("aria-pressed", "false");
      modes.append(choice);
    }
    const hint = el("p", "sx-hint"); hint.id = "sessions-hint";
    const input = el("textarea"); input.id = "sessions-input"; input.rows = 2; input.setAttribute("aria-label", "Your words about this session"); input.dataset.typeHere = "";
    input.addEventListener("input", () => { if (input.dataset.key) S.drafts.set(input.dataset.key, input.value); });
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      if (typeof form.requestSubmit === "function") form.requestSubmit(); else void submit();
    });
    const tools = el("div", "sx-tools"); tools.id = "sessions-tools";
    // The run menu: one button that says how the next run goes ("Auto · OpenCode"), and opens what decides it: the permission mode
    // (autonomy.js's own control), the coding worker and its tier (builder.js's saves) and the folder it works in.
    const runWrap = el("span", "sx-runwrap");
    const runButton = button("", "sx-chip-btn sx-run", () => toggleRunMenu(), { title: "Permissions, the coding worker and the folder the next run works in" });
    runButton.id = "sessions-run"; runButton.setAttribute("aria-haspopup", "dialog"); runButton.setAttribute("aria-expanded", "false"); runButton.setAttribute("aria-controls", "sessions-run-menu");
    const runMenu = el("div", "sx-runmenu"); runMenu.id = "sessions-run-menu"; runMenu.setAttribute("role", "dialog"); runMenu.setAttribute("aria-label", "How the next run goes"); runMenu.hidden = true;
    const section = (title, note) => { const box = el("section", "sx-runrow"); const head = el("div", "sx-runrow-head"); head.append(el("b", "", title)); if (note) head.append(note); box.append(head); runMenu.append(box); return box; };
    const autonomy = el("span", "sx-autonomy"); autonomy.id = "sessions-autonomy";
    section("Permissions", el("small", "sx-runnote", "How much Mefi decides for you.")).append(autonomy);
    const worker = el("span", "sx-worker");
    const cli = el("select", "sx-select"); cli.id = "sessions-worker-cli"; cli.setAttribute("aria-label", "Coding worker"); cli.title = "The coding worker that builds your tasks"; cli.hidden = true;
    const tier = el("select", "sx-select"); tier.id = "sessions-worker-tier"; tier.setAttribute("aria-label", "Worker tier"); tier.title = "Which of the worker's models runs a task"; tier.hidden = true;
    cli.addEventListener("change", () => void B.chips.saveRouting({ executorCli: cli.value }, `${B.chips.CLI_NAMES[cli.value] || cli.value} builds your tasks now.`));
    tier.addEventListener("change", () => void B.chips.saveRouting({ executorTier: tier.value }, `${(B.chips.TIERS.find(([id]) => id === tier.value) || ["", tier.value])[1]} saved.`));
    worker.append(cli, tier);
    section("Coding worker", el("small", "sx-runnote", "Builds this project's tasks. Team › Seats and models has the rest.")).append(worker);
    const folder = el("span", "sx-folder"); folder.id = "sessions-folder";
    const folderRow = section("Folder", el("small", "sx-runnote", "Where the next run works."));
    folderRow.append(folder); folderRow.id = "sessions-run-folder";
    // Escape closes it from its button or from anything inside it (autonomy.js's own Escape only folds its chip, not shown here).
    runWrap.addEventListener("keydown", (event) => { if (event.key === "Escape" && !runMenu.hidden) { event.preventDefault(); event.stopPropagation(); closeRunMenu(true); } });
    runWrap.append(runButton, runMenu);
    // The Worktree switch keeps its own chip on the row, as the prototype's "Worktree off" does.
    const chips = el("span", "sx-chipset"); chips.id = "sessions-chips"; chips.setAttribute("role", "group"); chips.setAttribute("aria-label", "Where this runs");
    // In a short or narrow window the run menu and the Worktree switch (and in a short one the purpose) sit behind this button.
    const more = button("", "sx-chip-btn quiet sx-more", () => { const open = form.dataset.open !== "true"; form.dataset.open = String(open); more.setAttribute("aria-expanded", String(open)); }, { icon: "g-more", title: "More: what to do with your words, and how the next run goes", aria: "More" });
    more.setAttribute("aria-expanded", "false"); form.dataset.open = "false";
    const send = button("Save note", "primary sx-send", null, { type: "submit" }); send.id = "sessions-send";
    tools.append(modes, runWrap, chips, more, send);
    form.append(input, tools, hint);
    form.addEventListener("submit", (event) => { event.preventDefault(); void submit(); });
    window.MefiAutonomy?.mount?.(autonomy, { id: "sessions-autonomy-control" });
    S.compose = { form, modes, hint, input, tools, autonomy, chips, cli, tier, send, runWrap, runButton, runMenu, folder, folderRow, more };
    return form;
  }
  // ---- the run menu ------------------------------------------------------------------------------------------------------------
  function toggleRunMenu() { if (S.compose?.runMenu?.hidden === false) closeRunMenu(true); else openRunMenu(); }
  function openRunMenu() {
    const box = S.compose;
    if (!box) return;
    box.runMenu.hidden = false;
    box.runButton.setAttribute("aria-expanded", "true");
    paintRunButton();
    // It opens upward inside the thread, never past the thread's own top (a short window has little room above the box).
    const above = box.runButton.getBoundingClientRect?.(), panel = S.panels.main?.root?.getBoundingClientRect?.();
    if (above && panel && box.runMenu.style) box.runMenu.style.maxHeight = `${Math.max(80, Math.round(above.top - panel.top - 16))}px`;
    // Focus goes to the first control inside (the permission mode), so the keys carry on from the button.
    (box.runMenu.querySelector(".autonomy-mode[aria-checked=true]") || box.runMenu.querySelector(".autonomy-mode, .sx-runrow select, .sx-runrow .sx-chip-btn"))?.focus?.({ preventScroll: true });
  }
  function closeRunMenu(restore) {
    const box = S.compose;
    if (!box || box.runMenu.hidden) return;
    box.runMenu.hidden = true;
    box.runButton.setAttribute("aria-expanded", "false");
    if (restore) box.runButton.focus?.({ preventScroll: true });
  }
  // The button's words: the permission mode and the coding worker, and its tier when it is not Auto ("Auto · OpenCode · Fast").
  function paintRunButton() {
    const box = S.compose;
    if (!box) return;
    const B = builder();
    const routing = B.chips.state.routing;
    const mode = window.MefiAutonomy?.label?.() || "Permissions";
    const current = String(routing?.executorCli || "");
    const worker = current ? B.chips.CLI_NAMES[current] || current : "";
    const tier = routing?.executorTier && routing.executorTier !== "auto" ? (B.chips.TIERS.find(([id]) => id === routing.executorTier)?.[1] || "").replace(/ tier$/, "") : "";
    const words = [mode, worker, tier].filter(Boolean).join(" · ");
    if (box.runButton.dataset.words !== words) {
      box.runButton.dataset.words = words;
      box.runButton.replaceChildren(glyph("g-sliders"), el("span", "sx-run-words", words), glyph("g-chev", "sx-run-car"));
      box.runButton.setAttribute("aria-label", `How the next run goes: ${words}`);
    }
  }
  // The two helpers every message box gets, bound the first time the box is shown (the picture button asks the host once whether
  // pictures are on at all, and the picker reads the skills). Attach is on the row for every purpose, as in the prototype; a Note is
  // words only, so pictures added while the box is a Note wait for an Ask or a Change, and the line under the box says so.
  function bindHelpers(input) {
    if (S.helpers) return;
    S.helpers = true;
    const scope = () => S.projectId ?? "";
    const blocked = () => S.sending || Boolean(builder().busy());
    window.MefiComposerPictures?.bind?.(input, { scope, blocked, mode: () => (openIntent() === "change" ? "task" : openIntent() === "note" ? "words" : "chat") });
    // Its row (the button, the thumbnails, the note) sits with the other controls, after the purpose, instead of on a line of its own.
    const row = input.parentNode?.querySelector?.(".composer-attach");
    if (row && S.compose?.modes?.parentNode === S.compose?.tools && typeof S.compose.modes.after === "function") S.compose.modes.after(row);
    else if (row && S.compose?.tools) S.compose.tools.prepend(row);
    const picker = window.MefiComposerPicker?.bind?.(input, {
      scope, blocked, mode: () => (openIntent() === "ask" ? "chat" : "task"),
      tasks: () => tasksOf(snap()).map((task) => ({ id: task.id, title: task.title || "", status: task.status || "" })),
    });
    // "Suggest files, tasks and skills while I type" is a setting (settings.ui.composerPicker); the popup follows it.
    if (picker && typeof api()?.prefsGet === "function") Promise.resolve(api().prefsGet()).then((result) => { picker.setPicker(window.MefiComposerPicker?.pickerPreference?.(result?.prefs) !== false); }).catch(() => { /* the popup stays on */ });
  }
  function setIntent(task, intent, focus) {
    if (!INTENT_IDS.includes(intent) || !task) return;
    S.intent.set(task.id, intent);
    S.painted.delete("composer");
    const data = snap();
    paintComposer(task, builder().reading(task, data), running(data, task), data);
    if (focus) frame(() => byId("sessions-input")?.focus?.({ preventScroll: true }));
  }
  function paintComposer(task, reading, run, data) {
    const box = S.compose;
    if (!box) return;
    const B = builder();
    const intent = intentFor(task, reading, run);
    const spec = B.INTENTS[intent];
    const name = companionName();
    const busy = Boolean(B.busy()) || S.sending;
    box.form.hidden = false;
    box.form.dataset.intent = intent;
    bindHelpers(box.input);
    if (changed("composer", [task.id, intent, name, busy, run ? 1 : 0, S.short, S.sending])) {
      for (const choice of box.modes.querySelectorAll("[data-intent]")) { const on = choice.dataset.intent === intent; choice.setAttribute("aria-pressed", String(on)); choice.classList.toggle("on", on); }
      const key = `${task.id}:${intent}`;
      if (box.input.dataset.key !== key) {
        // What a reload put back into the box (renderer/nav.js keeps the words in a field) is this session's draft, not something to wipe.
        const kept = box.input.dataset.key === undefined ? box.input.value : "";
        box.input.dataset.key = key;
        if (kept && !S.drafts.has(key)) S.drafts.set(key, kept);
        box.input.value = S.drafts.get(key) ?? "";
      }
      box.input.placeholder = intent === "ask" ? `Ask ${name} about this task…` : spec.placeholder;
      box.hint.textContent = intent === "note" ? (run ? "Saved now, read by its next run" : "Its next run reads this") : intent === "ask" ? `${name} answers here and in the chat` : "Makes a new task linked to this one";
      const label = S.sending ? "Sending…" : spec.send;
      box.send.textContent = label;
      box.send.disabled = busy;
      window.MefiComposerPictures?.get?.(box.input)?.refresh?.();
      window.MefiComposerPicker?.get?.(box.input)?.refresh?.();
    }
    paintTools(data);
  }
  async function submit() {
    const task = taskById(S.open);
    const box = S.compose;
    if (!task || !box || S.sending) return false;
    const B = builder();
    const data = snap();
    const reading = B.reading(task, data), run = running(data, task);
    const intent = intentFor(task, reading, run);
    const words = box.input.value.trim();
    if (!words) { box.input.focus?.({ preventScroll: true }); return false; }
    const pictures = window.MefiComposerPictures?.get?.(box.input) ?? null;
    if (intent !== "note" && pictures?.isBusy?.()) { toast("A picture is still being added. Send again in a moment.", "info"); return false; }
    const images = intent === "note" || !pictures ? [] : pictures.take();
    const key = `${task.id}:${intent}`;
    const sent = await B.sendWords(task, intent, words, {
      data, images,
      started: () => { S.sending = true; S.painted.delete("composer"); paintComposer(task, reading, run, data); },
      sent: () => { if (box.input.dataset.key === key) box.input.value = ""; S.drafts.delete(key); if (images.length) pictures?.clear?.(); },
    });
    S.sending = false;
    S.painted.delete("composer");
    if (sent) box.input.focus?.({ preventScroll: true });
    schedule();
    return sent;
  }
  // The run's controls: the folder's branch and how much is uncommitted (in the run menu: it opens the folder), the Worktree switch (on
  // the row), the permission mode (autonomy.js's own control) and the coding worker with its tier (both in the run menu). Every read
  // and save is builder.js's (work:where, getAiRouting, setAiRouting, work:worktrees).
  function paintTools(data) {
    const box = S.compose;
    if (!box) return;
    const B = builder();
    B.chips.loadWhere(data);
    B.chips.loadRouting();
    paintRunButton();
    const cs = B.chips.state;
    const where = cs.where, routing = cs.routing;
    const signature = [data.project?.path ?? null, where, cs.saving, routing ? [routing.executorCli, routing.executorModel, routing.executorModels, routing.executorTier, routing.executorTierModels, routing.executorTierDefaults] : null, Array.isArray(cs.clis) ? cs.clis.map((row) => [row?.id, row?.installed]) : null];
    if (!changed("tools", signature)) return;
    const nodes = [];
    box.folder.replaceChildren();
    if (where?.repo) {
      const named = where.branch || (where.head ? `detached ${where.head}` : "no commits yet");
      const tip = `${where.branch ? `On branch ${where.branch}` : "No branch checked out"}${where.dirty ? ` · ${where.dirty} uncommitted path${where.dirty === 1 ? "" : "s"}` : " · nothing uncommitted"}. Opens the folder.`;
      const branch = button(named, "sx-chip-btn quiet", () => api()?.shellReveal?.(data.project?.path), { icon: "g-route", title: tip });
      branch.id = "sessions-branch";
      if (where.dirty) branch.append(el("small", "sx-chip-count", `+${where.dirty}`));
      box.folder.append(branch);
      const worktrees = where.worktrees || {};
      const on = "On: each run works in its own git worktree from HEAD and merges back when it settles. Uncommitted work in your folder stays out of a run until it lands.";
      const off = "Off: runs work in your folder. On gives each run its own git worktree from HEAD, merged back when it settles.";
      const toggle = button("Worktree", "sx-chip-btn quiet sx-check-chip", () => void B.chips.setWorktrees(!worktrees.on), { title: worktrees.forced ? "Every run gets its own checkout: MEFI_STUDIO_WORKTREE_RUNS=1 is set for this Studio." : worktrees.on ? on : off });
      toggle.setAttribute("role", "switch"); toggle.setAttribute("aria-checked", String(Boolean(worktrees.on)));
      toggle.disabled = Boolean(worktrees.forced) || Boolean(cs.saving) || !api()?.workWorktrees;
      toggle.prepend(el("i", "sx-check"));
      nodes.push(toggle);
    }
    box.chips.replaceChildren(...nodes);
    box.chips.hidden = !nodes.length;
    box.folderRow.hidden = !box.folder.childElementCount && !box.folder.children?.length;
    if (routing) {
      const current = String(routing.executorCli || "opencode");
      const installed = Array.isArray(cs.clis) ? cs.clis.filter((row) => row?.installed).map((row) => String(row.id)) : [];
      const ids = [...new Set([current, ...installed, ...(installed.length ? [] : Object.keys(B.chips.CLI_NAMES).filter((id) => id !== "agy"))])];
      const model = routing.executorModels?.[current] || routing.executorModel || "";
      box.cli.replaceChildren(...ids.map((id) => { const option = el("option", "", id === current && model ? `${B.chips.CLI_NAMES[id] || id} · ${B.chips.shortModel(model)}` : B.chips.CLI_NAMES[id] || id); option.value = id; return option; }));
      box.cli.value = current;
      const tierModel = (id) => routing.executorTierModels?.[current]?.[id] || routing.executorTierDefaults?.[current]?.[id]?.model || "";
      box.tier.replaceChildren(...B.chips.TIERS.map(([id, label]) => { const option = el("option", "", id !== "auto" && tierModel(id) ? `${label} · ${B.chips.shortModel(tierModel(id))}` : label); option.value = id; return option; }));
      box.tier.value = B.chips.TIERS.some(([id]) => id === routing.executorTier) ? routing.executorTier : "auto";
      box.cli.hidden = box.tier.hidden = false;
      box.cli.disabled = box.tier.disabled = Boolean(cs.saving) || !api()?.setAiRouting;
      window.MefiSelect?.refresh?.();
    }
  }

  // ---- the inspector -------------------------------------------------------------------------------------------------------------------------
  // Six tabs for the selected session, as the prototype has them. Plan, Agent and Worktree are drawn here; Changes is review.js's panel
  // (real diffs, Accept, Revert and its Undo) and is mounted whenever a session is open, so its count is live; Checks and Preview hold
  // what this page knows (what the task must pass, the project preview's controls) with review.js's advisory checks and Before / After
  // under them. Tabs that do not fit the column's width wait behind More. With no session open, Home's inspector is the project's.
  const card = (title, aside) => { const box = el("section", "sx-icard"); const head = el("h4", "", title); if (aside) head.append(el("span", "r", aside)); box.append(head); return box; };
  const kv = (label, value, tone) => { const row = el("div", "sx-kv"); const strong = el("b", "", value); if (tone) strong.dataset.tone = tone; row.append(el("span", "", label), strong); return row; };
  const fine = (text) => el("p", "sx-fine", text);
  function buildInspector() {
    const root = el("aside", "sx-panel sx-insp"); root.id = "sessions-inspector"; root.setAttribute("aria-label", "Inspector"); root.dataset.short = "false"; root.dataset.empty = "true";
    const tabs = el("div", "sx-itabs"); tabs.id = "sessions-itabs"; tabs.setAttribute("role", "tablist"); tabs.setAttribute("aria-label", "Inspector"); tabs.hidden = true;
    const buttons = {};
    for (const [id, label] of TABS) {
      const tab = el("button", "sx-itab"); tab.type = "button"; tab.id = `sessions-itab-${id}`; tab.dataset.tab = id; tab.tabIndex = -1;
      tab.setAttribute("role", "tab"); tab.setAttribute("aria-controls", `sessions-pane-${id}`); tab.setAttribute("aria-selected", "false");
      tab.append(el("span", "sx-itab-l", label), el("em", "sx-itab-n"));
      tab.addEventListener("click", () => { const task = taskById(S.open); if (task) setTab(task, id); });
      tab.addEventListener("keydown", onTabKey);
      tabs.append(tab); buttons[id] = tab;
    }
    // More: the tabs the column has no room for, as a menu (the prototype's "More ⌄").
    const more = button("More", "sx-itab-more", () => toggleTabMenu(), { title: "The inspector's other tabs" });
    more.id = "sessions-itab-more"; more.hidden = true; more.setAttribute("aria-haspopup", "menu"); more.setAttribute("aria-expanded", "false");
    more.append(glyph("g-chev"));
    const moreMenu = el("div", "sx-menu sx-itab-menu"); moreMenu.id = "sessions-itab-menu"; moreMenu.setAttribute("role", "menu"); moreMenu.setAttribute("aria-label", "More inspector tabs"); moreMenu.hidden = true;
    moreMenu.addEventListener("keydown", (event) => {
      const items = [...moreMenu.querySelectorAll("[role=menuitem]")];
      const at = items.indexOf(document.activeElement);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); items[(at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus?.({ preventScroll: true }); }
      else if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); event.stopPropagation(); closeTabMenu(true); }
    });
    // The tabs and More share a row; More is not a tab of the list.
    const tabRow = el("div", "sx-itabrow");
    tabRow.append(tabs, more);
    const body = el("div", "sx-ibody"); body.id = "sessions-inspector-scroll"; body.hidden = true;
    const panes = {}, own = {}, hosts = {};
    for (const [id] of TABS) {
      const pane = el("section", "sx-pane"); pane.id = `sessions-pane-${id}`; pane.dataset.pane = id; pane.hidden = true;
      pane.setAttribute("role", "tabpanel"); pane.setAttribute("aria-labelledby", `sessions-itab-${id}`);
      body.append(pane); panes[id] = pane;
    }
    own.plan = el("div", "sx-own"); panes.plan.append(own.plan);
    own.agent = el("div", "sx-own"); panes.agent.append(own.agent);
    own.wt = el("div", "sx-own"); panes.wt.append(own.wt);
    own.checks = el("div", "sx-own"); hosts.checks = el("div", "sx-review-host"); panes.checks.append(own.checks, hosts.checks);
    own.preview = el("div", "sx-own"); hosts.preview = el("div", "sx-review-host"); panes.preview.append(own.preview, hosts.preview);
    hosts.changes = panes.changes;
    const empty = el("div", "sx-empty sx-insp-empty");
    empty.append(el("b", "", "No project open"), el("span", "", "Open a project folder to see its repository, its team and what it is doing."));
    // The project's inspector (the prototype's Project | Team | Usage): Team and Usage are the pages of their own, a press away.
    const project = el("section", "sx-project"); project.id = "sessions-project-insp"; project.hidden = true; project.setAttribute("aria-label", "Project");
    const projectTabs = el("div", "sx-ptabs");
    const here = el("span", "sx-ptab on", "Project"); here.setAttribute("aria-current", "true");
    projectTabs.append(here,
      button("Team", "sx-ptab", () => window.MefiNav?.go?.("agents", { section: "overview" }), { title: "Open Team: who does the work, its seats and models" }),
      button("Usage", "sx-ptab", () => window.MefiNav?.go?.("usage"), { title: "Open Usage: recorded calls and provider accounts" }));
    const projectBody = el("div", "sx-ibody"); projectBody.id = "sessions-project-scroll";
    const projectOwn = el("div", "sx-own");
    projectBody.append(projectOwn);
    project.append(projectTabs, projectBody);
    root.append(tabRow, moreMenu, empty, body, project);
    S.panels.inspector = { root, tabRow, tabs, buttons, more, moreMenu, body, panes, own, hosts, empty, project, projectOwn };
  }
  // ---- More: the tabs the column has no room for -------------------------------------------------------------------------------------
  // Every tab is shown, then the last ones that are not the one on screen are put away until the row fits; More lists them.
  function fitTabs() {
    const panel = S.panels.inspector;
    const box = panel?.tabs;
    if (!box || box.hidden) return;
    for (const [id] of TABS) panel.buttons[id].hidden = false;
    panel.more.hidden = true;
    const over = () => Number(box.scrollWidth) > Number(box.clientWidth) + 1;
    const hidden = [];
    if (over()) {
      panel.more.hidden = false;
      for (let at = TABS.length - 1; at >= 0 && over(); at -= 1) {
        const [id] = TABS[at];
        if (panel.buttons[id].getAttribute("aria-selected") === "true") continue;
        panel.buttons[id].hidden = true; hidden.unshift(id);
      }
    }
    S.itabHidden = hidden;
    panel.more.hidden = !hidden.length;
    panel.more.setAttribute("aria-label", hidden.length ? `More tabs: ${hidden.map((id) => TABS.find(([key]) => key === id)[1]).join(", ")}` : "More tabs");
    if (!hidden.length) closeTabMenu(false);
  }
  function toggleTabMenu() { if (S.panels.inspector?.moreMenu?.hidden === false) closeTabMenu(true); else openTabMenu(); }
  function openTabMenu() {
    const panel = S.panels.inspector;
    if (!panel || !(S.itabHidden || []).length) return;
    const task = taskById(S.open);
    panel.moreMenu.replaceChildren(...S.itabHidden.map((id) => {
      const label = TABS.find(([key]) => key === id)?.[1] || id;
      const item = button(label, "sx-menu-item", () => { closeTabMenu(false); if (task) setTab(task, id); });
      item.setAttribute("role", "menuitem"); item.tabIndex = -1; item.dataset.tab = id;
      const count = panel.buttons[id].querySelector("em");
      if (count && !count.hidden && count.textContent) item.append(el("small", "sx-chip-count", count.textContent));
      return item;
    }));
    const place = panel.more.getBoundingClientRect?.(), frame = panel.root.getBoundingClientRect?.();
    if (place && frame && panel.moreMenu.style) { panel.moreMenu.style.top = `${Math.round(place.bottom - frame.top + 4)}px`; panel.moreMenu.style.right = "8px"; }
    panel.moreMenu.hidden = false;
    panel.more.setAttribute("aria-expanded", "true");
    panel.moreMenu.querySelector("[role=menuitem]")?.focus?.({ preventScroll: true });
  }
  function closeTabMenu(restore) {
    const panel = S.panels.inspector;
    if (!panel || panel.moreMenu.hidden) return;
    panel.moreMenu.hidden = true;
    panel.more.setAttribute("aria-expanded", "false");
    if (restore) panel.more.focus?.({ preventScroll: true });
  }
  function onTabKey(event) {
    const ids = TABS.map(([id]) => id);
    const at = ids.indexOf(event.currentTarget?.dataset?.tab ?? event.target?.dataset?.tab);
    let next = -1;
    if (event.key === "ArrowRight") next = (at + 1) % ids.length;
    else if (event.key === "ArrowLeft") next = (at - 1 + ids.length) % ids.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = ids.length - 1;
    if (next < 0 || at < 0) return;
    event.preventDefault();
    const task = taskById(S.open);
    if (!task) return;
    setTab(task, ids[next], { reveal: false });
    // A tab that waited behind More comes onto the row once it is the one on screen.
    fitTabs();
    byId(`sessions-itab-${ids[next]}`)?.focus?.({ preventScroll: true });
  }
  // The tab the person picked, else the one the task suggests: its changes once it has any, its plan before that. The suggestion is
  // settled when the changes have been read (or a moment after opening) and then stays, so a file appearing while someone reads the
  // plan never moves the page under them.
  function inspectorTab(task) {
    const picked = S.itab.get(task.id);
    if (picked) return picked;
    let auto = S.itabAuto.get(task.id);
    if (!auto) {
      const counts = reviewCounts(task.id);
      auto = counts?.files ? "changes" : "plan";
      if (counts !== null || Date.now() - S.openedAt > 2500) S.itabAuto.set(task.id, auto);
    }
    return auto;
  }
  function setTab(task, tab, { reveal = true } = {}) {
    if (!task || !pickTab(task.id, tab)) return;
    remember({ itab: Object.fromEntries([...S.itab].slice(-40)) });
    dropPainted("inspector");
    if (reveal) revealInspector();
    schedule();
    if (S.wired) paintInspector();
  }
  // "See the changes" from the thread: the inspector column may have been closed (or dragged to nothing, or folded into a drawer);
  // ask the shell for it back the way it offers, open() being the frame's own (it opens a drawer too), then a bare resize.
  function revealInspector() {
    const shell = S.shell;
    if (!shell) return;
    try {
      if (typeof shell.reveal === "function") { shell.reveal("inspector"); return; }
      if (typeof shell.open === "function" && typeof shell.isOpen === "function") { if (!shell.isOpen("inspector")) shell.open("inspector"); return; }
      const folded = String(document.documentElement?.dataset?.layoutFold || "").split(/\s+/).includes("inspector");
      if (!folded && typeof shell.size === "function" && typeof shell.resize === "function" && Number(shell.size("inspector")) === 0) shell.resize("inspector", 380);
    } catch { /* a shell that cannot is left as it is */ }
  }
  function unmountInspector() {
    if (!S.insp) return;
    S.insp.unmount();
    S.insp = null;
    dropPainted("inspector");
  }
  // review.js's panels of this session: Changes always, Checks and Preview from the first time they are shown. One record is shared by
  // all of them (and by the task board's fold), so what one does, the others show.
  function mountInspector(task, tab) {
    const panel = S.panels.inspector;
    const key = `${S.projectId ?? ""}/${task.id}`;
    if (S.insp && S.insp.key !== key) unmountInspector();
    if (!S.insp) S.insp = { key, shown: new Set(["changes"]), mounts: new Map(), unmount() { for (const handle of this.mounts.values()) { try { handle?.unmount?.(); } catch { /* the page already let go of it */ } } this.mounts.clear(); } };
    if (tab === "checks" || tab === "preview") S.insp.shown.add(tab);
    if (typeof window.MefiReview?.mount !== "function") return;
    for (const name of S.insp.shown) {
      if (S.insp.mounts.has(name)) continue;
      S.insp.mounts.set(name, window.MefiReview.mount(panel.hosts[name], { taskId: task.id, projectId: S.projectId, panel: name, labelledBy: `sessions-itab-${name}` }) ?? null);
    }
  }
  function paintInspector() {
    const panel = S.panels.inspector;
    if (!panel) return;
    const data = snap();
    const task = taskById(S.open, data);
    if (!task) {
      unmountInspector();
      paintProjectInspector(data);
      return;
    }
    const B = builder();
    const reading = B.reading(task, data);
    const run = running(data, task);
    const tab = inspectorTab(task);
    mountInspector(task, tab);
    const counts = reviewCounts(task.id);
    const results = Array.isArray(task.verificationRun?.results) ? task.verificationRun.results : [];
    const passed = results.filter((result) => result.ok === true).length;
    let refit = false;
    if (changed("inspector:tabs", [task.id, tab, counts?.files ?? null, counts?.running ?? null, passed, results.length, typeof window.MefiReview?.mount])) {
      dropPainted("inspector:project"); refit = true;
      panel.tabs.hidden = false; panel.body.hidden = false; panel.empty.hidden = true; panel.project.hidden = true; panel.root.dataset.empty = "false";
      for (const [id, label] of TABS) {
        const node = panel.buttons[id], on = id === tab;
        node.setAttribute("aria-selected", String(on)); node.tabIndex = on ? 0 : -1; node.classList.toggle("on", on);
        const number = id === "changes" && counts?.files ? String(counts.files) : id === "checks" && results.length ? `${passed}/${results.length}` : "";
        const badge = node.querySelector("em");
        badge.textContent = number; badge.hidden = !number;
        node.setAttribute("aria-label", id === "changes" && number ? `${label}, ${plural(counts.files, "file")} changed` : id === "checks" && number ? `${label}, ${passed} of ${results.length} passed` : label);
        panel.panes[id].hidden = !on;
      }
    }
    // The row is fitted again when its tabs changed or the column's width did (a drag, a window resize, a drawer).
    const width = Number(panel.tabs.clientWidth) || 0;
    if (refit || width !== S.itabWidth) { S.itabWidth = width; fitTabs(); }
    if (tab === "plan") paintPlan(task, data, reading, run);
    else if (tab === "checks") paintChecksPane(task, data);
    else if (tab === "preview") paintPreviewPane(task, data);
    else if (tab === "agent") paintAgent(task, data, reading, run);
    else if (tab === "wt") paintWorktree(task, data, run);
    else if (typeof window.MefiReview?.mount !== "function" && changed("inspector:changes", [task.id])) panel.panes.changes.replaceChildren(fine("The changed files are part of the desktop app."));
  }

  // ---- Worktree: where the session's run works, as Work › Worktrees says it ------------------------------------------------------------
  function paintWorktree(task, data, run) {
    const own = S.panels.inspector.own.wt;
    const B = builder();
    lookForWorktrees();
    const list = window.MefiWorktrees?.state?.()?.list;
    const row = list?.repo && Array.isArray(list.rows) ? list.rows.find((item) => item?.task?.taskId === task.id && item.kind !== "primary") ?? null : null;
    const marked = S.wt.rows.get(task.id) ?? null;
    const words = row ? window.MefiWorktrees?.describe?.(row) ?? null : null;
    const where = B.chips.state.where;
    const worker = run?.route || task.lastAttempt?.route || task.lastAttempt?.via || "";
    if (!changed("inspector:wt", [task.id, row, marked, words, where?.branch ?? null, where?.worktrees?.on ?? null, worker])) return;
    const out = [];
    const all = button("All worktrees", "sx-btn ghost mini", () => window.MefiNav?.go?.("worktrees"), { title: "Open Work › Worktrees: every checkout of this project and what to do about each" });
    if (!row && !marked) {
      const box = card("Worktree", "the project's folder");
      box.append(fine(`${worker || "Its worker"} works in the project's own folder${where?.branch ? `, on ${where.branch}` : ""}.`));
      box.append(kv("New runs", where?.worktrees?.on ? "Each in its own worktree" : "In the project's folder"));
      box.append(fine("The Worktree switch beside the box decides for the next run: its own checkout keeps builders working side by side from colliding."));
      const acts = el("div", "sx-acts"); acts.append(all); box.append(acts);
      out.push(box);
    } else {
      const box = card("Worktree", words?.label || "its own checkout");
      if (words?.tone) box.dataset.tone = words.tone;
      const name = row?.name || String(row?.path || marked?.path || "").split(/[\\/]/).filter(Boolean).pop() || "";
      if (name) box.append(kv("Folder", name));
      const branch = row?.branch || marked?.branch;
      if (branch) box.append(kv("Branch", branch));
      if (row && row.state !== "missing") {
        box.append(kv(`Ahead of ${words?.upstream || words?.main || "main"}`, plural(Number(row.ahead) || 0, "commit")));
        box.append(kv("Not committed", plural(Number(row.dirty) || 0, "file")));
        box.append(kv("On GitHub", row.state === "merged" ? "In main" : row.pushed === true ? "Yes" : row.pushed === false ? "No" : "Unknown"));
      }
      if (words?.advice) box.append(fine(words.advice));
      else if (!row) box.append(fine("Work › Worktrees has its full state once it has looked."));
      const acts = el("div", "sx-acts");
      acts.append(button("Review changes", "sx-btn ghost mini", () => setTab(task, "changes"), { title: "Open the Changes tab" }), all);
      box.append(acts);
      out.push(box);
    }
    own.replaceChildren(...out);
  }

  // ---- the project's inspector: Home with no session open ---------------------------------------------------------------------------
  // The prototype's Project | Team | Usage: the repository (the branch and what is uncommitted, from work:where; GitHub, from the Git
  // chip's model; the worktrees), the team (what each running worker is on, and what is free) and the latest moves on the board. It
  // reads only what the page already holds; Team and Usage open their own pages.
  function paintProjectInspector(data = snap()) {
    const panel = S.panels.inspector;
    if (!panel) return;
    const B = builder();
    closeTabMenu(false);
    if (!data.projectId) {
      if (changed("inspector:project", ["none"])) { S.painted.delete("inspector:tabs"); panel.tabs.hidden = true; panel.body.hidden = true; panel.project.hidden = true; panel.empty.hidden = false; panel.root.dataset.empty = "true"; }
      return;
    }
    B.chips.loadWhere(data);
    const where = B.chips.state.where;
    let git = null;
    try { git = window.MefiGitSync?.model?.() ?? null; } catch { git = null; }
    const trees = worktreeCount();
    const jobs = (data.status?.running || []).filter((job) => job && job.taskId);
    const workers = Number(data.status?.parallel) || 0;
    const now = Date.now();
    const recent = tasksOf(data).filter((task) => task?.id && !task.archived && task.status !== "archived")
      .map((task) => ({ task, at: B.lastMoved(task) })).filter((row) => row.at).sort((a, b) => b.at - a.at).slice(0, 5)
      .map(({ task, at }) => ({ id: task.id, title: window.MefiTasks?.shortTitle?.(task) || task.title || "Untitled task", reading: B.reading(task, data), at }));
    const team = jobs.map((job) => { const task = taskById(job.taskId, data); return { id: job.taskId, worker: String(job.route || "A worker"), title: task ? (window.MefiTasks?.shortTitle?.(task) || task.title || "") : String(job.title || ""), waiting: questionsFor(task, data).length > 0 }; });
    const signature = [data.projectId, where?.branch ?? null, where?.dirty ?? null, where?.repo ?? null, git?.label ?? null, git?.repo ?? null, trees.count, team, workers, recent.map((row) => [row.id, row.title, row.reading.label, row.reading.tone, Math.floor((now - row.at) / 60000)])];
    if (!changed("inspector:project", signature)) return;
    S.painted.delete("inspector:tabs");
    panel.tabs.hidden = true; panel.body.hidden = true; panel.empty.hidden = true; panel.project.hidden = false; panel.root.dataset.empty = "false";
    const out = [];
    const repo = card("Repository");
    if (where?.repo) {
      repo.append(kv("Branch", where.branch || (where.head ? `detached ${where.head}` : "no commits yet")));
      repo.append(kv("Uncommitted", where.dirty ? plural(where.dirty, "file") : "None"));
    } else if (where) repo.append(fine("This folder is not a Git repository."));
    if (git?.label) repo.append(kv("GitHub", git.label));
    if (trees.count) {
      const row = el("div", "sx-kv"); row.append(el("span", "", "Worktrees"));
      row.append(button(String(trees.count), "sx-link", () => window.MefiNav?.go?.("worktrees"), { title: `${trees.headline || plural(trees.count, "worktree")} Open Work › Worktrees.` }));
      repo.append(row);
    }
    if (!repo.children?.length || repo.children.length === 1) repo.append(fine("Reading the folder…"));
    out.push(repo);
    const busy = team.length;
    const crew = card("Team", workers ? `${busy} of ${workers} busy` : busy ? `${busy} working` : "");
    if (!team.length) crew.append(fine("Nothing is running."));
    for (const member of team) {
      const row = el("div", "sx-kv sx-member");
      row.append(button(`${member.worker} · ${clip(member.title, 34)}`, "sx-link sx-member-open", () => select(member.id), { title: `Open ${member.title}` }));
      const state = el("b", "", member.waiting ? "waiting on you" : "working");
      state.dataset.tone = member.waiting ? "warn" : "live";
      row.append(state);
      crew.append(row);
    }
    if (workers > busy) crew.append(fine(`${plural(workers - busy, "worker")} free for the next task.`));
    out.push(crew);
    const feed = card("Live activity");
    if (!recent.length) feed.append(fine("Tasks you start show what they do here."));
    for (const row of recent) {
      const line = button("", "sx-feedrow", () => select(row.id), { title: `Open ${row.title}` });
      line.dataset.tone = row.reading.tone;
      const words = el("span", "sx-feedrow-words"); words.append(el("b", "", clip(row.title, 48)), el("span", "", row.reading.label));
      line.append(el("i", "sx-dot"), words, el("time", "", builder().ago(row.at, now)));
      feed.append(line);
    }
    out.push(feed);
    panel.projectOwn.replaceChildren(...out);
  }

  // ---- Plan: the brief, what it is done when, where it stands, and the earlier versions of the brief --------------------------------------
  // The outline Home's "Use a task outline" writes (Goal, Done when, Keep unchanged) read back as its parts.
  const OUTLINE = { goal: "Goal", "done when": "Done when", "keep unchanged": "Keep unchanged" };
  function outlineOf(text) {
    const intro = [], parts = [];
    let current = null;
    for (const line of String(text ?? "").split(/\r?\n/)) {
      const head = /^\s*(goal|done when|keep unchanged)\s*:\s*(.*)$/i.exec(line);
      if (head) { const key = head[1].toLowerCase(); current = { key, label: OUTLINE[key], lines: [] }; if (head[2].trim()) current.lines.push(head[2].trim()); parts.push(current); continue; }
      const clean = line.trim();
      if (!clean) continue;
      if (current) current.lines.push(clean.replace(/^[-*•]\s*/, "")); else intro.push(clean);
    }
    const kept = parts.filter((part) => part.lines.length);
    return kept.length ? { intro: intro.join("\n"), parts: kept } : null;
  }
  // The earlier briefs of a task (tasks:history, what Task board › Brief history lists), read while the Plan tab shows.
  function versionsFor(task) {
    const signature = JSON.stringify([task.updatedAt ?? null, task.contextVersion ?? null, task.contextHistory?.length ?? 0, task.lastAttempt?.at ?? null]);
    const held = S.versions.get(task.id);
    if (held && (held.loading || held.signature === signature || Date.now() - held.at < 5000)) return held;
    const record = { signature, at: Date.now(), loading: true, entries: held?.entries ?? [], hasMore: false, error: "", unavailable: false };
    S.versions.set(task.id, record);
    if (typeof api()?.tasksHistory !== "function") { record.loading = false; record.unavailable = true; return record; }
    Promise.resolve(api().tasksHistory({ taskId: task.id, projectId: task.projectId || S.projectId })).then((result) => {
      if (!result?.ok) throw new Error(result?.error || "Earlier briefs could not be read.");
      record.entries = Array.isArray(result.entries) ? result.entries : []; record.hasMore = result.hasMore === true; record.error = "";
    }).catch((error) => { record.error = plain(error, "Earlier briefs could not be read."); })
      .finally(() => { record.loading = false; if (S.wired && S.versions.get(task.id) === record) { dropPainted("inspector:plan"); schedule(); } });
    return record;
  }
  async function restoreVersion(task, entry) {
    if (S.restoring || typeof api()?.tasksRestore !== "function") return;
    S.restoring = entry.id; dropPainted("inspector:plan"); schedule();
    try {
      const result = await api().tasksRestore({ taskId: task.id, projectId: task.projectId || S.projectId, revisionId: entry.id });
      if (!result?.ok) throw new Error(result?.error || "The earlier brief could not be restored.");
      S.versions.delete(task.id);
      toast("Earlier brief restored. Files, status and checks are unchanged.", "good");
      window.MefiWorkspace?.refresh?.(true);
    } catch (error) { toast(plain(error, "The earlier brief could not be restored."), "bad"); }
    finally { S.restoring = null; dropPainted("inspector:plan"); schedule(); }
  }
  // The steps a run is taking: its worker's own todo list, as the run checkpoint keeps it on the task (runProgress.todos), in the marks
  // the thread's run cards use. Nothing is made up when there is none.
  const STEP_STATE = { completed: "ok", in_progress: "go", pending: "no", cancelled: "skip" };
  const STEP_MARK = { ok: "✓", go: "●", no: "○", skip: "–", bad: "✕", warn: "!" };
  function planSteps(task) {
    const todos = Array.isArray(task.runProgress?.todos) ? task.runProgress.todos : [];
    return todos.filter((todo) => todo && String(todo.content ?? "").trim()).slice(0, 40).map((todo) => ({ label: clip(todo.content, 160), state: STEP_STATE[todo.status] || "no", word: todo.status === "completed" ? "done" : todo.status === "in_progress" ? "now" : todo.status === "cancelled" ? "dropped" : "" }));
  }
  // What the task is done when (its acceptance lines, else its outline's), each with how the last check of the whole task went: the
  // checks pass or fail the task, not a line, so every line says the same verdict.
  function acceptanceRows(task, reading, doneWhen) {
    const state = task.verification?.state;
    const verdict = ["verified", "manual"].includes(state) ? ["ok", state === "manual" ? "confirmed" : "met"] : state === "failed" ? ["bad", "not accepted"] : reading.tone === "check" ? ["go", "checking"] : ["no", "not checked yet"];
    return doneWhen.map((line) => ({ label: line, state: verdict[0], word: verdict[1] }));
  }
  function stepList(rows) {
    const list = el("ol", "sx-steps sx-plan-steps");
    for (const row of rows) {
      const item = el("li", `sx-step ${row.state}`);
      item.append(el("span", "sx-step-mark", STEP_MARK[row.state] || "○"), el("span", "sx-step-label", row.label), el("span", "sx-step-at", row.word));
      list.append(item);
    }
    return list;
  }
  function paintPlan(task, data, reading, run = null) {
    const own = S.panels.inspector.own.plan;
    const B = builder();
    const summary = reading.summary || {};
    const brief = briefText(task) || String(task.prompt || "").trim();
    const outline = outlineOf(brief);
    const acceptance = B.acceptanceOf(task).map((line) => String(line).trim()).filter(Boolean);
    const doneWhen = acceptance.length ? acceptance : outline?.parts.find((part) => part.key === "done when")?.lines ?? [];
    const steps = planSteps(task);
    const versions = versionsFor(task);
    const locked = Boolean(task.runId || task.absorbedInto) || ["active", "running", "verifying", "awaiting_verification"].includes(task.status);
    if (!changed("inspector:plan", [task.id, task.title, brief, acceptance, steps, task.verification?.state ?? null, reading.label, reading.tone, summary.action, summary.nextAction, summary.blocker, summary.checks, Boolean(run), versions.entries.map((entry) => entry.id), versions.loading, versions.error, versions.unavailable, locked, S.restoring, Math.floor(Date.now() / 60000)])) return;
    const out = [];
    // Steps: the run's own list, with where the task stands under it (what it is doing, what is in the way, what is next).
    const done = steps.filter((step) => step.state === "ok").length;
    const stepsCard = card("Steps", steps.length ? `${done} of ${steps.length} · ${reading.label}` : reading.label);
    if (steps.length) stepsCard.append(stepList(steps));
    else stepsCard.append(fine(run ? "Its worker has not listed its steps yet. They show here as it works." : "No steps yet. A run's own steps show here while it works."));
    if (summary.action) stepsCard.append(fine(summary.action));
    if (summary.blocker) stepsCard.append(el("p", "sx-fine warn", summary.blocker));
    if (summary.nextAction) stepsCard.append(fine(`Next: ${summary.nextAction}`));
    out.push(stepsCard);
    const box = card("Brief");
    if (outline) {
      if (outline.intro) box.append(el("p", "sx-text", outline.intro));
      for (const part of outline.parts.filter((row) => row.key !== "done when")) {
        box.append(el("h5", "sx-mini-h", part.label));
        if (part.lines.length === 1) box.append(el("p", "sx-text", part.lines[0]));
        else { const list = el("ul", "sx-list-plain"); for (const line of part.lines) list.append(el("li", "", line)); box.append(list); }
      }
    } else box.append(el("p", "sx-text", brief || "This task has no brief text."));
    out.push(box);
    // Acceptance checks: what it is done when, and how far the checks got (the Checks tab has each check run's own results).
    const rows = acceptanceRows(task, reading, doneWhen);
    if (rows.length || summary.checks) {
      const met = rows.filter((row) => row.state === "ok").length;
      const checks = card("Acceptance checks", rows.length ? `${met} of ${rows.length}` : "");
      if (rows.length) checks.append(stepList(rows));
      if (summary.checks) checks.append(kv("Checks", summary.checks));
      out.push(checks);
    }
    const history = card("Versions", versions.entries.length ? `${versions.entries.length}${versions.hasMore ? "+" : ""}` : "");
    history.append(fine("Every saved change to the brief is kept. Restoring one does not touch files, status or checks."));
    if (versions.unavailable) history.append(fine("Brief versions are part of the desktop app."));
    else if (!versions.entries.length) history.append(fine(versions.loading ? "Loading earlier briefs…" : versions.error || "Saved changes to this task will appear here."));
    for (const entry of versions.entries.slice(0, 5)) {
      const row = el("div", "sx-version"); row.dataset.revisionId = entry.id;
      const stamp = Number.isFinite(new Date(entry.at).getTime()) ? new Date(entry.at).toLocaleString() : "Saved earlier";
      const words = el("div", "sx-version-words");
      words.append(el("b", "", `${entry.kind || "Saved brief"} · ${stamp}`));
      if (entry.note) words.append(el("small", "", String(entry.note)));
      words.append(el("small", "sx-version-text", clip(entry.snapshot?.prompt || entry.snapshot?.title || "No brief text in this version.", 160)));
      const restore = button(S.restoring === entry.id ? "Restoring…" : "Restore", "sx-btn ghost mini", () => void restoreVersion(task, entry), { title: locked ? "Wait for the current worker to finish before restoring a brief." : "Put this brief back" });
      restore.disabled = locked || Boolean(S.restoring) || typeof api()?.tasksRestore !== "function";
      row.append(words, restore);
      history.append(row);
    }
    if (versions.entries.length > 5 || versions.hasMore) history.append(button("All versions on the task board", "sx-link", () => window.MefiNav?.go?.("tasks", { taskId: task.id, projectId: S.projectId, board: true }), { title: "Open the task board: Brief history lists every version" }));
    out.push(history);
    own.replaceChildren(...out);
  }

  // ---- Checks and Preview ----------------------------------------------------------------------------------------------------------------------
  function paintChecksPane(task, data) {
    const own = S.panels.inspector.own.checks;
    const B = builder();
    const summary = B.reading(task, data).summary;
    if (!changed("inspector:checks", [task.id, summary?.checks, task.verificationRun, task.verification, B.acceptanceOf(task)])) return;
    own.replaceChildren(...B.checksNodes(task, data));
  }
  async function previewDo(action) {
    if (S.previewBusy || typeof window.MefiWorkspace?.previewAction !== "function") return;
    S.previewBusy = action; dropPainted("inspector:preview"); schedule();
    try { await window.MefiWorkspace.previewAction(action); } catch { /* the workspace says why in its own words */ }
    S.previewBusy = null; dropPainted("inspector:preview"); schedule();
  }
  // The project's preview and its controls. An embedded live preview is not drawn here: "Open app" opens the running one, the way Home does.
  function paintPreviewPane(task, data) {
    const own = S.panels.inspector.own.preview;
    const preview = data.preview;
    const phase = preview?.phase || "unavailable";
    const can = typeof window.MefiWorkspace?.previewAction === "function";
    if (!changed("inspector:preview", [task.id, phase, preview?.url ?? null, preview?.error ?? null, preview?.message ?? null, preview?.available ?? null, preview?.canStop ?? null, S.previewBusy, can])) return;
    const box = card("Project preview", preview ? PHASES[phase] || phase : can ? "Checking…" : "Desktop app only");
    box.append(fine(preview?.error || preview?.message || "Studio can preview projects with an index.html or a preview, dev or start script."));
    if (preview?.url) box.append(kv("Address", preview.url));
    const acts = el("div", "sx-acts");
    const busy = Boolean(S.previewBusy);
    if (phase !== "ready" && phase !== "stopping") { const start = button(phase === "starting" ? "Starting…" : phase === "failed" ? "Retry preview" : "Start preview", "sx-btn primary mini", () => void previewDo("start")); start.disabled = busy || !can || !preview?.available || phase === "starting"; acts.append(start); }
    if (phase === "ready") acts.append(button("Open app", "sx-btn primary mini", () => void previewDo("open"), { title: "Open the running preview" }));
    const stop = button("Stop preview", "sx-btn ghost mini", () => void previewDo("stop"), { title: "Stop the preview server Studio started. Your files are kept." }); stop.disabled = busy || !can || !preview?.canStop; acts.append(stop);
    const again = button("Check again", "sx-btn ghost mini", () => void previewDo("status")); again.disabled = busy || !can; acts.append(again);
    box.append(acts);
    own.replaceChildren(box);
  }

  // ---- Agent: who is on it, what it is doing, what it took, and the time limit ---------------------------------------------------------------------
  // Read while the tab shows (taskMetrics), the way the task board's "Usage & limit" fold does, with its wording (MefiTasks.usage).
  function metricsFor(task) {
    if (typeof api()?.taskMetrics !== "function") return null;
    const signature = JSON.stringify([task.runId ?? null, task.status, task.lastAttempt?.at ?? null, task.lastAttempt?.runId ?? null, task.updatedAt ?? null, task.capMinutes ?? null]);
    const held = S.metrics.get(task.id);
    if (held && (held.loading || held.signature === signature || Date.now() - held.at < 4000)) return held;
    const record = { signature, at: Date.now(), loading: !held?.report, report: held?.report ?? null, error: "" };
    S.metrics.set(task.id, record);
    Promise.resolve(api().taskMetrics({ taskId: task.id, projectId: task.projectId || S.projectId }))
      .then((result) => { if (!result?.ok) throw new Error(result?.error || "The usage could not be read."); record.report = result; record.error = ""; })
      .catch((error) => { record.error = plain(error, "The usage could not be read."); })
      .finally(() => { record.loading = false; if (S.wired && S.metrics.get(task.id) === record) { dropPainted("inspector:agent"); schedule(); } });
    return record;
  }
  async function changeCap(task, minutes) {
    if (typeof api()?.tasksCap !== "function") return;
    try {
      const result = await api().tasksCap({ taskId: task.id, minutes, projectId: task.projectId || S.projectId });
      if (!result?.ok) throw new Error(result?.error || "The limit could not be saved.");
      S.metrics.delete(task.id);
    } catch (error) { toast(plain(error, "The limit could not be saved."), "bad"); }
    dropPainted("inspector:agent"); schedule();
  }
  function paintAgent(task, data, reading, run) {
    const own = S.panels.inspector.own.agent;
    const B = builder();
    const usage = window.MefiTasks?.usage ?? null;
    const metrics = metricsFor(task);
    const report = metrics?.report ?? null;
    if (!changed("inspector:agent", [task.id, reading.label, run, task.lastAttempt?.route ?? null, task.lastAttempt?.via ?? null, report, metrics?.loading ?? null, metrics?.error ?? null, B.busy(), Math.floor(Date.now() / 60000)])) return;
    const summary = reading.summary || {};
    const out = [];
    const who = card("Worker", reading.label);
    const route = run?.route || run?.cli || report?.attempt?.route?.label || task.lastAttempt?.route || task.lastAttempt?.via || (summary.worker && summary.worker !== "No worker running" ? summary.worker : "");
    who.append(kv("Worker", route || "No worker yet"));
    who.append(kv("Doing", run ? clip(run.currentStep || run.activity || "Waiting for the worker's first line", 120) : reading.tone === "done" ? "Finished" : reading.tone === "ask" ? "Waiting for your answer" : reading.tone === "check" ? "Checking the result" : "Idle"));
    if (run && Number(run.startedAt)) who.append(kv("Running for", howLong(Date.now() - Number(run.startedAt))));
    const stop = B.taskActionSpecs(task, reading, run, data).find((row) => row.id === "stop");
    if (stop) { const acts = el("div", "sx-acts"); acts.append(specButton(stop, task)); who.append(acts); }
    out.push(who);
    if (metrics && !report) out.push(fine(metrics.loading ? "Reading the usage…" : metrics.error || "The usage is not available."));
    const attempt = report?.attempt;
    if (attempt && usage) {
      const now = card("This attempt", attempt.live ? "Running now" : attempt.stoppedAtLimit ? "Stopped at the time limit" : "");
      const seconds = attempt.live && Number.isFinite(attempt.startedAt) ? (Date.now() - attempt.startedAt) / 1000 : attempt.seconds;
      now.append(kv("Time", usage.durationText(seconds)), kv("Tokens", usage.usageTokens(attempt.tokens), attempt.tokens?.state === "not-reported" ? "dim" : ""), kv("Cost", usage.usageCost(attempt.cost), attempt.cost?.state === "not-reported" ? "dim" : ""));
      if (attempt.tokens?.state === "not-reported") now.append(fine(`${attempt.route?.label || "This builder"} does not report tokens or cost to Studio. Time is measured here.`));
      out.push(now);
    }
    const whole = report?.task;
    if (whole?.attempts && usage) {
      const all = card("Whole task", whole.subtasks ? `with ${plural(whole.subtasks, "sub-task")}` : "");
      all.append(kv("Attempts", String(whole.attempts)), kv("Time", usage.durationText(whole.seconds) + (whole.secondsUnknown ? " + some not recorded" : "")));
      if (whole.tokens?.state === "not-reported" && whole.cost?.state === "not-reported") all.append(kv("Tokens and cost", "Time only", "dim"));
      else all.append(kv("Tokens", usage.usageTokens(whole.tokens)), kv("Cost", usage.usageCost(whole.cost)));
      out.push(all);
    }
    const cap = report?.cap;
    if (cap) {
      const limit = card("Limit");
      if (!cap.enabled) limit.append(fine("Time limits are switched off on this PC, so an attempt runs until Studio's own 25 minute limit."));
      else {
        const line = el("div", "sx-limit");
        const words = el("div", "sx-limit-words"); words.append(el("b", "", "Stop an attempt after"), el("span", "", "Saves progress and does not count as a failure."));
        const stepper = el("div", "sx-stepper");
        const step = (label, aria, delta) => {
          const node = button(label, "sx-btn ghost mini", null, { aria });
          const next = Math.min(cap.ceilingMinutes, Math.max(cap.min, cap.effectiveMinutes + delta * cap.step));
          node.disabled = next === cap.effectiveMinutes || typeof api()?.tasksCap !== "function";
          node.addEventListener("click", () => void changeCap(task, next));
          return node;
        };
        stepper.append(step("−", "Shorter", -1), el("b", "", `${cap.effectiveMinutes} min`), step("+", "Longer", 1));
        line.append(words, stepper);
        limit.append(line);
        if (cap.raised) limit.append(fine(`This task asks for ${cap.minutes} min, but Studio ends every attempt at ${cap.ceilingMinutes} min at the latest.`));
        else if (cap.effectiveMinutes >= cap.ceilingMinutes) limit.append(fine(`${cap.ceilingMinutes} min is the longest Studio lets one attempt run.`));
      }
      out.push(limit);
    }
    for (const reason of (Array.isArray(report?.coverage?.reasons) ? report.coverage.reasons : []).slice(0, 4)) out.push(fine(reason));
    const links = el("div", "sx-acts");
    links.append(button("Open on the task board", "sx-btn ghost mini", () => window.MefiNav?.go?.("tasks", { taskId: task.id, projectId: S.projectId, filter: "all", board: true }), { title: "Details, evidence and history" }));
    out.push(links);
    own.replaceChildren(...out);
  }

  // ---- the lightbox -----------------------------------------------------------------------------------------------------------------------------------
  // A picture or the before and after shots, larger: the whole image always fits the window (never cropped), Esc closes it, the arrow
  // keys move between Before and After, and focus goes back to what opened it.
  function lightboxItems(spec) {
    if (spec.kind === "evidence") {
      return (S.evidence.get(spec.taskId)?.shots ?? []).filter((shot) => shot.dataUrl).sort((a, b) => (a.phase === "before" ? 0 : 1) - (b.phase === "before" ? 0 : 1))
        .map((shot) => ({ src: shot.dataUrl, label: shot.phase === "before" ? "Before" : "After", alt: shot.phase === "before" ? "The project preview when the task started" : "The project preview when the task finished" }));
    }
    const entry = S.pictures.get(spec.id);
    return entry?.state === "ready" ? [{ src: entry.dataUrl, label: spec.name || "Picture", alt: spec.name || "Picture", note: entry.width ? `${entry.width} × ${entry.height}` : "" }] : [];
  }
  function openLightbox(spec) {
    closeLightbox({ restore: false });
    const items = lightboxItems(spec || {});
    if (!items.length) return false;
    const opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    const layer = el("div", "sx-lightbox"); layer.id = "sessions-lightbox"; layer.setAttribute("role", "dialog"); layer.setAttribute("aria-modal", "true");
    layer.setAttribute("aria-label", spec.kind === "evidence" ? "Before and after" : clip(spec.name || "Picture", 60));
    const scrim = el("div", "sx-lb-scrim"); scrim.addEventListener("click", () => closeLightbox());
    const stage = el("figure", "sx-lb-stage");
    const img = el("img", "sx-lb-img");
    const caption = el("figcaption", "sx-lb-cap");
    const bar = el("div", "sx-lb-bar");
    const close = button("Close", "sx-btn ghost mini sx-lb-close", () => closeLightbox(), { icon: "g-close", title: "Close (Esc)" });
    const tabs = [];
    if (items.length > 1) {
      const group = el("div", "sx-lb-tabs"); group.setAttribute("role", "group"); group.setAttribute("aria-label", "Which shot");
      items.forEach((item, index) => { const tab = button(item.label, "", () => show(index)); tab.setAttribute("aria-pressed", "false"); tab.dataset.index = String(index); tabs.push(tab); group.append(tab); });
      bar.append(group);
    }
    bar.append(close);
    stage.append(img, caption);
    layer.append(scrim, stage, bar);
    const state = { layer, opener, items, index: 0, keys: null };
    function show(index) {
      state.index = Math.max(0, Math.min(items.length - 1, index));
      const item = items[state.index];
      img.setAttribute("src", item.src); img.setAttribute("alt", item.alt);
      caption.textContent = [item.label, item.note].filter(Boolean).join(" · ");
      tabs.forEach((tab, at) => { const on = at === state.index; tab.setAttribute("aria-pressed", String(on)); tab.classList.toggle("on", on); });
    }
    state.keys = (event) => {
      // A dialog keeps the page's single-key shortcuts from firing behind it; chords (Ctrl R, F12) are left to the app.
      if (!event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault?.(); event.stopPropagation?.(); }
      if (event.key === "Escape") { closeLightbox(); return; }
      if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && items.length > 1) { show(state.index + (event.key === "ArrowRight" ? 1 : -1)); return; }
      if (event.key === "Tab") {
        const focusable = [...layer.querySelectorAll("button")].filter((node) => !node.disabled && !node.hidden);
        if (!focusable.length) { event.preventDefault(); return; }
        const at = focusable.indexOf(document.activeElement);
        const next = focusable[(at + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length];
        event.preventDefault(); next.focus?.({ preventScroll: true });
      }
    };
    document.addEventListener("keydown", state.keys, true);
    S.lightbox = state;
    show(0);
    document.body.append(layer);
    close.focus?.({ preventScroll: true });
    return true;
  }
  function closeLightbox({ restore = true } = {}) {
    const state = S.lightbox;
    if (!state) return;
    S.lightbox = null;
    document.removeEventListener("keydown", state.keys, true);
    state.layer.remove?.();
    if (restore && state.opener?.isConnected !== false) state.opener?.focus?.({ preventScroll: true });
  }

  // ==== the way in ====
  window.MefiSessions = {
    attach, detach, active: () => S.wired,
    // The session on screen, and opening one (from a tab, the palette, a notification): the list and the thread follow.
    selected: () => S.open,
    select: (taskId, options) => select(taskId, options),
    open: (taskId, options = {}) => select(taskId, { route: true, preview: false, ...options }),
    tab: (taskId = S.open) => { const task = taskById(taskId); return task ? inspectorTab(task) : null; },
    setTab: (tab, taskId = S.open) => { const task = taskById(taskId); if (task) setTab(task, tab); return Boolean(task); },
    newTask, redirect, refresh: () => { S.painted.clear(); schedule(); },
    // The kill switch: off puts the panels away and keeps them away (saved), on brings them back.
    enabled: () => !switchedOff(),
    setEnabled: (on) => { write(SWITCH, on ? "on" : "off"); if (on) attach(); else detach(); return !switchedOff(); },
    openPicture: (id, name) => openLightbox({ kind: "picture", id, name }),
    closePicture: () => closeLightbox(),
    // What the panels are made of, as data: the list's groups and rows, the backlog, the lines under a title.
    model: { list: listModel, backlog: backlogModel, statusLine, detailLine, outline: outlineOf, brief: briefText, pictures: briefPictures },
  };
  // A page that loaded this late, with v2 already on, draws now; otherwise nav.js (applyLayout) calls attach() when the layout turns on.
  if (typeof document !== "undefined" && document.readyState !== "loading" && layoutOn()) attach();
})();
