// Fleet: Live > Fleet. Every seat on the open project's team (the lead, the
// foreman, the builders, the checkers and the keepers), what each is doing now,
// the runs each has had, and the wires between them, as OpenRig draws its rigs:
// an explorer tree on the left, a graph, table, recent feed, node tree and
// health list in the middle, and the selected seat on the right. The host
// (main.cjs fleet:* and scripts/fleet-host.cjs) keeps the seats; this sheet
// asks for a snapshot on entry, holds a watch lease while it is in view (the
// host pushes fleet:update only then) and paints at most once a frame.
(function () {
  "use strict";
  const $ = (id) => document.getElementById(`fleet-${id}`);
  const api = () => window.mefiStudio;
  const layoutApi = () => window.MefiFleetLayout;
  const SVG_NS = "http://www.w3.org/2000/svg";
  const LEASE_MS = 30000;
  const TABS = [["graph", "Graph"], ["table", "Table"], ["recent", "Recent"], ["nodes", "Tree"], ["health", "Health"]];
  const STATE_LABEL = { working: "Working", waiting: "Waiting", blocked: "Needs you", error: "Error", idle: "Idle", off: "Off" };
  const STATE_RANK = { blocked: 0, waiting: 1, working: 2, error: 3, idle: 4, off: 5 };
  const KIND_LABEL = { dispatch: "dispatch", handoff: "handoff", delegation: "delegated", verify: "check", rework: "rework", desk: "desk", escalate: "asks you", report: "report", mail: "mail" };
  const OUTCOME_LABEL = { verified: "verified", awaiting: "waiting for a check", failed: "failed", stopped: "stopped", rejected: "rejected", lost: "lost" };
  // The Recent tab's filter chips: which row kinds each one shows.
  const RECENT_GROUPS = [
    ["work", "Work", ["claimed", "handed_off", "delegated", "completed", "reported", "merged"]],
    ["checks", "Checks", ["verified", "rejected"]],
    ["asks", "Asks", ["asked", "answered", "escalated", "mail"]],
    ["problems", "Problems", ["failed", "stopped", "lost", "kept_branch"]],
  ];
  const state = {
    open: false, view: null, projectId: null, selected: null, tab: "graph", epoch: 0, detailTimer: 0, detailPending: 0,
    frame: 0, stale: false, leaseTimer: 0, subscribed: false, subscribedTo: null,
    sort: { key: "state", dir: 1 }, groups: new Set(), text: "", collapsed: new Set(),
    camera: null, manual: false, layout: null, layoutKey: "", drag: null, treeKey: "",
    detail: null, detailKey: "", detailFetch: 0, painted: {},
    readIssue: null, snapshotTicket: 0, scopeKnown: false, scopeId: null,
  };
  let initialized = false;
  const tabButtons = new Map();

  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = String(text); return node; };
  const svg = (tag, attrs = {}) => {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    return node;
  };
  const isOpen = () => Boolean($("overlay")) && !$("overlay").hidden;
  const seatsOf = (view) => (view?.pods ?? []).flatMap((pod) => pod.seats ?? []);
  const seatOf = (view, id) => seatsOf(view).find((seat) => seat.id === id) ?? null;
  const podOfSeat = (view, id) => (view?.pods ?? []).find((pod) => (pod.seats ?? []).some((seat) => seat.id === id)) ?? null;
  const plain = (error, fallback) => (window.MefiUi?.plainError ? window.MefiUi.plainError(error, fallback) : fallback);

  // ---- words ------------------------------------------------------------------------------
  function clock(at) {
    if (!Number.isFinite(Number(at)) || !at) return "";
    const date = new Date(Number(at));
    return [date.getHours(), date.getMinutes(), date.getSeconds()].map((part) => String(part).padStart(2, "0")).join(":");
  }
  function ago(at, now = Date.now()) {
    if (!Number.isFinite(Number(at)) || !at) return "";
    const seconds = Math.max(0, Math.round((now - Number(at)) / 1000));
    if (seconds < 10) return "just now";
    if (seconds < 60) return `${seconds} s ago`;
    if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
    return `${Math.round(seconds / 86400)} d ago`;
  }
  const percent = (progress) => (Number.isFinite(progress) ? `${Math.round(progress * 100)}%` : "");
  const short = (text, max = 60) => { const value = String(text ?? "").replace(/\s+/g, " ").trim(); return value.length > max ? `${value.slice(0, max - 1)}…` : value; };
  const modelName = (model) => String(model ?? "").replace(/^[a-z0-9-]+\//i, "");
  function runtimeText(runtime) {
    if (!runtime) return "";
    return [runtime.via, modelName(runtime.model)].filter(Boolean).join(" · ");
  }
  // The second line of a seat card and the table's Now column.
  function nowText(seat) {
    if (seat.now) return short(seat.now.step || seat.now.title || "starting…", 44);
    if (seat.text) return short(seat.text, 44);
    if (seat.last) return `${OUTCOME_LABEL[seat.last.outcome] ?? "last run"}${seat.last.endedAt ? ` · ${ago(seat.last.endedAt)}` : ""}`;
    return seat.status === "off" ? "off" : "idle";
  }
  // A Recent row as one sentence.
  function rowText(row) {
    const title = row.title ? `"${short(row.title, 48)}"` : "a task";
    const who = (id) => (id === "you" ? "You" : id ?? "someone");
    switch (row.kind) {
      case "claimed": return `${who(row.to)} took ${title}`;
      case "handed_off": return `${who(row.from)} handed ${title} to ${who(row.to)}`;
      case "delegated": return `${who(row.from)} delegated ${title} to ${who(row.to)}`;
      case "completed": return `${who(row.from)} finished ${title} and it waits for a check`;
      case "verified": return `${who(row.from)} verified ${title} from ${who(row.to)}`;
      case "rejected": return `${who(row.from)} sent ${title} back to ${who(row.to)}`;
      case "failed": return `${who(row.from)} failed ${title}`;
      case "stopped": return `${who(row.from)} stopped ${who(row.to)} on ${title}`;
      case "lost": return `${who(row.from)} ended ${title} without reporting back`;
      case "asked": return `${who(row.from)} asked the desk: ${short(row.text, 70)}`;
      case "answered": return `The desk answered ${who(row.to)}: ${short(row.text, 70)}`;
      case "escalated": return `The desk passed a question to you: ${short(row.text, 70)}`;
      case "reported": return `${who(row.from)} reported to ${who(row.to)} on ${title}`;
      case "mail": return `${who(row.from)} to ${who(row.to)}: ${short(row.text, 70)}`;
      case "merged": return `${who(row.from)} merged ${short(row.text, 40) || "its branch"}`;
      case "kept_branch": return `${who(row.from)} kept ${short(row.text, 40) || "a branch"} unmerged`;
      default: return short(row.text || row.kind, 90);
    }
  }
  const groupOf = (kind) => RECENT_GROUPS.find(([, , kinds]) => kinds.includes(kind))?.[0] ?? "work";

  // Keeps one element per key in a list, in order: new keys are made, old ones
  // dropped, existing ones updated in place, so focus and scroll survive a push.
  function reconcile(host, items, keyOf, make, update) {
    const existing = new Map([...host.children].map((child) => [child.dataset?.key, child]));
    const wanted = [];
    for (const item of items) {
      const key = String(keyOf(item));
      let node = existing.get(key);
      if (!node) { node = make(item); node.dataset.key = key; }
      update(node, item);
      wanted.push(node);
    }
    const same = wanted.length === host.children.length && wanted.every((node, index) => host.children[index] === node);
    if (same) return wanted;
    // Rows that stay are not detached unless their order changed: a browser drops the focus of a
    // node that is removed, so a focused row survives a row added or removed around it.
    const kept = new Set(wanted);
    const stayed = wanted.filter((node) => existing.get(node.dataset.key) === node);
    const before = [...host.children].filter((child) => kept.has(child));
    const active = document.activeElement;
    if (stayed.length === before.length && stayed.every((node, index) => node === before[index])) {
      for (const child of [...host.children]) if (!kept.has(child)) child.remove();
      wanted.forEach((node, index) => { if (host.children[index] !== node) host.insertBefore(node, host.children[index] ?? null); });
    } else host.replaceChildren(...wanted);
    if (active && active !== document.activeElement && host.contains?.(active)) active.focus?.({ preventScroll: true });
    return wanted;
  }

  // ---- data: a snapshot on entry, then pushes while a lease is held ------------------------
  function status(text, tone = "") {
    const node = $("status");
    if (!node) return;
    node.textContent = text;
    node.dataset.tone = tone;
    state.painted.status = null;
  }
  async function lease(on) {
    try { await api()?.fleetWatch?.({ id: "fleet-view", on }); } catch { /* the lease lapses by itself */ }
  }
  function currentScope() {
    if (typeof window.MefiWorkspace?.activeProjectId === "function") return { known: true, id: window.MefiWorkspace.activeProjectId() || null };
    return { known: state.scopeKnown, id: state.scopeId };
  }
  function clearContent() {
    const active = document.activeElement;
    const lostFocus = ["side", "panels", "inspector"].some((id) => $(id)?.contains?.(active));
    for (const id of ["tree", "graph", "table", "recent", "nodes", "health", "inspector"]) $(id)?.replaceChildren();
    if ($("inspector")) $("inspector").dataset.mode = "fleet";
    for (const button of tabButtons.values()) if (button.children[1]) { button.children[1].textContent = ""; button.children[1].hidden = true; }
    if (lostFocus && state.open) tabButtons.get(state.tab)?.focus?.({ preventScroll: true });
  }
  function paintReadIssue() {
    if (!state.readIssue) return false;
    const cached = Boolean(state.view);
    if ($("body")) $("body").dataset.readState = cached ? "cached" : "unavailable";
    status(cached ? `Last confirmed team. ${state.readIssue}` : state.readIssue, "bad");
    return true;
  }
  function failedRead(error) {
    state.readIssue = typeof error === "string" && error.trim() ? short(error, 240) : plain(error, "The fleet could not be read.");
    if (!state.view) clearContent();
    // Cached same-project facts remain usable; a project with no confirmed snapshot stays empty.
    loading(!state.view);
    if (state.open) paintReadIssue();
  }
  async function refresh() {
    if (!api()?.fleetSnapshot) { failedRead("Fleet shows your team in the desktop app."); return; }
    const epoch = state.epoch;
    const ticket = ++state.snapshotTicket;
    try {
      const view = await api().fleetSnapshot();
      // A read asked for before the project changed answers for the old project.
      if (epoch === state.epoch && ticket === state.snapshotTicket) apply(view);
    } catch (error) {
      if (epoch !== state.epoch || ticket !== state.snapshotTicket) return;
      failedRead(error);
    }
  }
  // While a project's team is being read the old one cannot be clicked, so a Stop that belongs to
  // another project is never within reach.
  function loading(on) {
    for (const part of ["side", "panels", "inspector"]) { const node = $(part); if (node) node.inert = on; }
    const body = $("body");
    if (body) body.dataset.loading = on ? "1" : "0";
  }
  function apply(view, pushed = false) {
    const scope = currentScope();
    // Workspace exposes no selection as null; the host's empty store has the
    // fixed project_none identity. It is the same scope, never another team.
    const scopedId = view?.projectId === "project_none" ? null : view?.projectId ?? null;
    // Pushes from a project already left cannot establish the new project's facts.
    if (view && Object.prototype.hasOwnProperty.call(view, "projectId") && scope.known && scopedId !== scope.id) {
      if (!pushed) failedRead("This project's team could not be confirmed.");
      return;
    }
    if (pushed && !scope.known && state.epoch > 0) return;
    if (!view || view.ok === false) {
      if (pushed) state.snapshotTicket++;
      failedRead(view?.error);
      return;
    }
    if (scope.known && scopedId !== scope.id) { failedRead("This project's team could not be confirmed."); return; }
    // Never go back in time: a read that a newer push of the same project overtook is dropped.
    if (state.view && view.projectId === state.view.projectId && (view.rev ?? 0) < (state.view.rev ?? 0)) return;
    if (pushed) state.snapshotTicket++;
    state.scopeKnown = true;
    state.scopeId = scopedId;
    state.readIssue = null;
    if ($("body")) $("body").dataset.readState = "ready";
    if (view.projectId !== state.projectId) {
      state.projectId = view.projectId ?? null;
      state.manual = false;
      state.layoutKey = "";
      state.treeKey = "";
      state.detail = null;
    }
    state.view = view;
    loading(false);
    if (state.selected && !seatOf(view, state.selected)) state.selected = null;
    schedulePaint();
  }
  function start() {
    if (!state.subscribed && typeof api()?.onFleetUpdate === "function") { state.subscribed = true; api().onFleetUpdate((view) => apply(view, true)); }
    if (!state.view) loading(true);
    void refresh();
    void lease(true);
    clearInterval(state.leaseTimer);
    // The host pushes when something changes, and a run that has gone quiet changes nothing, so the
    // facts that come from the clock (quiet for ten minutes, an ask left waiting, running for) are read again.
    state.leaseTimer = setInterval(() => { if (!document.hidden) { void lease(true); void refresh(); } }, LEASE_MS);
  }
  function stop() {
    clearInterval(state.leaseTimer);
    state.leaseTimer = 0;
    clearTimeout(state.detailTimer);
    state.detailTimer = 0;
    void lease(false);
    if (state.frame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(state.frame);
    state.frame = 0;
  }
  // Painting waits for the next frame and never happens for a sheet nobody sees.
  function schedulePaint() {
    if (!state.open) return;
    if (document.hidden) { state.stale = true; return; }
    if (state.frame) return;
    state.frame = requestAnimationFrame(() => { state.frame = 0; paint(); });
  }
  function paint() {
    const view = state.view;
    if (!state.open) return;
    if (!view) { if (!paintReadIssue()) status("Reading the team…"); return; }
    state.stale = false;
    paintStatus(view);
    paintTabs(view);
    paintExplorer(view);
    paintInspector(view);
    paintPanel(view);
  }
  function paintStatus(view) {
    if (paintReadIssue()) return;
    const loop = view.loop;
    const counts = view.counts ?? {};
    const parts = [`${counts.seats ?? 0} seats`, `${counts.working ?? 0} working`, `${counts.attention ?? 0} need attention`, `${counts.openRows ?? 0} ready to take`];
    if (loop?.headline) parts.push(loop.headline);
    const text = parts.join(" · ");
    if (state.painted.status !== text) { status(text, counts.attention ? "warn" : ""); state.painted.status = text; }
  }

  // ---- tabs -------------------------------------------------------------------------------
  function buildTabs() {
    const list = $("tabs");
    for (const [id, label] of TABS) {
      const button = el("button", "fleet-tab");
      button.type = "button";
      button.dataset.tab = id;
      button.id = `fleet-tab-${id}`;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-controls", `fleet-${id}`);
      button.append(el("span", "fleet-tab-label", label), el("span", "fleet-tab-badge", ""));
      button.addEventListener("click", () => setTab(id));
      tabButtons.set(id, button);
      list.append(button);
    }
    list.addEventListener("keydown", (event) => {
      const at = TABS.findIndex(([id]) => id === state.tab);
      const next = event.key === "ArrowRight" ? at + 1 : event.key === "ArrowLeft" ? at - 1 : event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : null;
      if (next === null) return;
      event.preventDefault?.();
      const target = TABS[(next + TABS.length) % TABS.length][0];
      setTab(target);
      tabButtons.get(target)?.focus?.({ preventScroll: true });
    });
  }
  function setTab(id) {
    if (!TABS.some(([tab]) => tab === id)) return;
    state.tab = id;
    state.painted.tab = null;
    if (state.view) { paintTabs(state.view); paintPanel(state.view); }
    window.MefiMotion?.enter?.($(id));
  }
  function paintTabs(view) {
    const attention = view.counts?.attention ?? 0;
    for (const [id] of TABS) {
      const button = tabButtons.get(id);
      if (!button) continue;
      const on = id === state.tab;
      button.setAttribute("aria-selected", String(on));
      button.tabIndex = on ? 0 : -1;
      if (id === "health") { button.children[1].textContent = attention ? String(attention) : ""; button.children[1].hidden = !attention; }
      else button.children[1].hidden = true;
      const panel = $(id);
      if (panel) panel.hidden = !on;
    }
  }
  function paintPanel(view) {
    if (state.tab === "graph") paintGraph(view);
    else if (state.tab === "table") paintTable(view);
    else if (state.tab === "recent") paintRecent(view);
    else if (state.tab === "nodes") paintTree(view);
    else paintHealth(view);
  }

  // ---- selection --------------------------------------------------------------------------
  function select(id) {
    const next = id && state.view && seatOf(state.view, id) ? id : null;
    if (state.selected === next) return;
    state.selected = next;
    state.painted.revealed = null;
    if (state.detail?.seatId !== next) state.detail = null;
    schedulePaint();
    if (next) void fetchDetail(next);
  }

  // ---- the explorer: this PC > team > pods > seats ------------------------------------------
  function treeItems(view) {
    const counts = view.counts ?? {};
    const items = [
      { key: "host", level: 1, kind: "host", name: "This PC", meta: "", status: "" },
      { key: "team", level: 2, kind: "team", name: view.project?.name || "This project", meta: `${counts.working ?? 0}/${counts.seats ?? 0}`, status: counts.attention ? "waiting" : counts.working ? "working" : "idle" },
    ];
    for (const pod of view.pods ?? []) {
      if (!pod.seats?.length) continue;
      const open = !state.collapsed.has(pod.id);
      items.push({ key: `pod:${pod.id}`, level: 3, kind: "pod", id: pod.id, name: pod.label, meta: `${pod.seats.filter((seat) => seat.status === "working").length}/${pod.seats.length}`, status: "", expanded: open });
      if (open) for (const seat of pod.seats) items.push({ key: `seat:${seat.id}`, level: 4, kind: "seat", id: seat.id, name: seat.id, meta: percent(seat.now?.progress), gen: seat.gen ? `g${seat.gen}` : "", status: seat.status, title: `${seat.address} · ${STATE_LABEL[seat.status] ?? seat.status}${seat.text ? ` · ${seat.text}` : ""}` });
    }
    return items;
  }
  function makeTreeItem(item) {
    const row = el("li", "fleet-item");
    row.setAttribute("role", "treeitem");
    const button = el("button", "fleet-row");
    button.type = "button";
    button.append(el("span", "fleet-caret"), el("span", "fleet-dot"), el("span", "fleet-row-name"), el("span", "fleet-row-meta"), el("span", "fleet-gen"));
    button.addEventListener("click", () => {
      const now = row.fleetItem;
      if (now?.kind === "seat") { select(now.id); button.focus?.({ preventScroll: true }); }
      else if (now?.kind === "pod") togglePod(now.id);
    });
    button.addEventListener("focus", () => { state.treeFocus = row.dataset.key; });
    row.append(button);
    return row;
  }
  function updateTreeItem(row, item) {
    row.fleetItem = item;
    const button = row.children[0];
    row.setAttribute("aria-level", String(item.level));
    if (item.kind === "pod") row.setAttribute("aria-expanded", String(item.expanded)); else row.removeAttribute("aria-expanded");
    const picked = item.kind === "seat" && item.id === state.selected;
    row.setAttribute("aria-selected", String(picked));
    button.dataset.kind = item.kind;
    button.dataset.level = String(item.level);
    button.title = item.title ?? "";
    button.children[0].dataset.open = item.kind === "pod" ? String(item.expanded) : "none";
    button.children[1].dataset.status = item.status || "none";
    button.children[2].textContent = item.name;
    button.children[3].textContent = item.meta ?? "";
    button.children[4].textContent = item.gen ?? "";
  }
  function paintExplorer(view) {
    const list = $("tree");
    if (!list) return;
    const items = treeItems(view);
    const rows = reconcile(list, items, (item) => item.key, makeTreeItem, updateTreeItem);
    // One row is a tab stop; the arrow keys move it.
    const keys = rows.map((row) => row.dataset.key);
    const wanted = state.selected && keys.includes(`seat:${state.selected}`) ? `seat:${state.selected}` : keys.includes(state.treeFocus) ? state.treeFocus : keys[0];
    for (const row of rows) row.children[0].tabIndex = row.dataset.key === wanted ? 0 : -1;
  }
  function togglePod(id, open) {
    const collapsed = state.collapsed.has(id);
    const next = open ?? collapsed;
    if (next) state.collapsed.delete(id); else state.collapsed.add(id);
    if (state.view) paintExplorer(state.view);
  }
  function treeKeys(event) {
    const buttons = [...$("tree").children].map((row) => row.children[0]);
    const at = buttons.indexOf(document.activeElement);
    const rowOf = (button) => button?.parentNode;
    const focus = (button) => { if (button) { button.focus?.({ preventScroll: true }); state.treeFocus = rowOf(button)?.dataset.key; for (const other of buttons) other.tabIndex = other === button ? 0 : -1; } };
    const item = at >= 0 ? rowOf(buttons[at]).fleetItem : null;
    let handled = true;
    if (event.key === "ArrowDown") focus(buttons[Math.min(buttons.length - 1, at + 1)]);
    else if (event.key === "ArrowUp") focus(buttons[Math.max(0, at - 1)]);
    else if (event.key === "Home") focus(buttons[0]);
    else if (event.key === "End") focus(buttons.at(-1));
    else if (event.key === "ArrowRight" && item?.kind === "pod") { if (!item.expanded) togglePod(item.id, true); else focus(buttons[at + 1]); }
    else if (event.key === "ArrowLeft" && item) {
      if (item.kind === "pod" && item.expanded) togglePod(item.id, false);
      else if (item.kind === "seat") focus(buttons.find((button) => rowOf(button).dataset.key === `pod:${podOfSeat(state.view, item.id)?.id}`));
    } else handled = false;
    if (handled) event.preventDefault?.();
  }

  // ---- the graph: pods as columns of seat cards, wired in lanes --------------------------------
  const setText = (node, text) => { const value = String(text ?? ""); if (node.fleetText !== value) { node.fleetText = value; node.textContent = value; } };
  const graphParts = () => {
    const host = $("graph");
    return { host, viewport: host?.querySelector(".fleet-viewport"), stage: host?.querySelector(".fleet-stage"), cards: host?.querySelector(".fleet-cards"), wires: host?.querySelector(".fleet-wires"), zoom: host?.querySelector(".fleet-zoom"), legend: host?.querySelector(".fleet-legend") };
  };
  function toolButton(label, text, run) {
    const button = el("button", "ghost mini fleet-tool", text);
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.addEventListener("click", run);
    return button;
  }
  function buildGraph() {
    const host = $("graph");
    const tools = el("div", "fleet-tools");
    tools.append(toolButton("Zoom out", "−", () => zoomBy(1 / 1.25)), toolButton("Zoom in", "+", () => zoomBy(1.25)), toolButton("Fit the whole team in view", "Fit", () => fitView(true)), el("span", "fleet-zoom", "100%"));
    const viewport = el("div", "fleet-viewport");
    viewport.tabIndex = -1;
    viewport.setAttribute("role", "group");
    viewport.setAttribute("aria-label", "Fleet graph: seats in pods, wired by handoffs, checks and questions. Arrow keys move between seats.");
    const stage = el("div", "fleet-stage");
    const wires = svg("svg", { class: "fleet-wires", "aria-hidden": "true" });
    const defs = svg("defs");
    for (const kind of layoutApi()?.KIND_RANK ?? []) {
      const marker = svg("marker", { id: `fleet-arrow-${kind}`, viewBox: "0 0 8 8", refX: 7, refY: 4, markerWidth: 7, markerHeight: 7, orient: "auto" });
      marker.append(svg("path", { d: "M0 0 8 4 0 8z", class: "fleet-arrowhead", "data-kind": kind }));
      defs.append(marker);
    }
    wires.append(defs, svg("g", { class: "fleet-wire-layer" }));
    stage.append(wires, el("div", "fleet-cards"));
    viewport.append(stage);
    host.append(tools, viewport, el("ul", "fleet-legend"));
    viewport.addEventListener("pointerdown", (event) => {
      if ((event.button ?? 0) !== 0 || event.target?.closest?.(".fleet-seat")) return;
      state.drag = { x: event.clientX ?? 0, y: event.clientY ?? 0, cx: state.camera?.x ?? 0, cy: state.camera?.y ?? 0, moved: false };
      viewport.setPointerCapture?.(event.pointerId);
    });
    viewport.addEventListener("pointermove", (event) => {
      const drag = state.drag;
      if (!drag || !state.camera) return;
      const dx = (event.clientX ?? 0) - drag.x;
      const dy = (event.clientY ?? 0) - drag.y;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      drag.moved = true;
      state.manual = true;
      moveCamera({ k: state.camera.k, x: drag.cx + dx, y: drag.cy + dy });
    });
    const release = () => {
      const drag = state.drag;
      state.drag = null;
      if (drag && !drag.moved) select(null);
    };
    viewport.addEventListener("pointerup", release);
    viewport.addEventListener("pointercancel", () => { state.drag = null; });
    viewport.addEventListener("wheel", (event) => {
      event.preventDefault?.();
      const rect = viewport.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) zoomAtPoint(Math.exp(-(event.deltaY || 0) / 300), (event.clientX ?? 0) - rect.left, (event.clientY ?? 0) - rect.top);
      else if (state.camera) { state.manual = true; moveCamera({ k: state.camera.k, x: state.camera.x - (event.deltaX || 0), y: state.camera.y - (event.deltaY || 0) }); }
    }, { passive: false });
    viewport.addEventListener("keydown", graphKeys);
    if (typeof ResizeObserver === "function") new ResizeObserver(() => { if (!state.manual && state.layout) fitView(false); }).observe(viewport);
  }
  function viewportSize() {
    const viewport = graphParts().viewport;
    return { w: viewport?.clientWidth || 800, h: viewport?.clientHeight || 480 };
  }
  function moveCamera(camera) {
    const L = layoutApi();
    state.camera = state.layout ? L.constrain(camera, state.layout.bounds, viewportSize()) : camera;
    applyCamera();
  }
  function applyCamera() {
    const { stage, zoom } = graphParts();
    const camera = state.camera;
    if (!stage || !camera) return;
    stage.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.k})`;
    stage.dataset.zoom = camera.k < 0.6 ? "far" : camera.k > 1.4 ? "near" : "mid";
    if (zoom) setText(zoom, `${Math.round(camera.k * 100)}%`);
  }
  function fitView(force) {
    if (!state.layout) return;
    if (force) state.manual = false;
    state.camera = layoutApi().fit(state.layout.bounds, viewportSize());
    applyCamera();
  }
  function zoomAtPoint(factor, px, py) {
    if (!state.camera || !state.layout) return;
    state.manual = true;
    moveCamera(layoutApi().zoomAt(state.camera, factor, px, py));
  }
  const zoomBy = (factor) => { const size = viewportSize(); zoomAtPoint(factor, size.w / 2, size.h / 2); };
  // How much of the graph's right edge the inspector covers while it is a drawer.
  function drawerCover() {
    const box = $("inspector");
    const viewport = graphParts().viewport;
    if (!box || !viewport || box.dataset.mode !== "seat" || typeof getComputedStyle !== "function" || getComputedStyle(box).position !== "absolute") return 0;
    return Math.max(0, viewport.getBoundingClientRect().right - box.getBoundingClientRect().left);
  }
  // Brings a seat into view when the picture is zoomed or dragged away from it.
  function reveal(id) {
    const seat = state.layout?.seats.find((item) => item.id === id);
    const camera = state.camera;
    if (!seat || !camera) return;
    const size = viewportSize();
    size.w -= drawerCover();
    const left = seat.x * camera.k + camera.x;
    const top = seat.y * camera.k + camera.y;
    const right = left + seat.w * camera.k;
    const bottom = top + seat.h * camera.k;
    if (left >= 0 && top >= 0 && right <= size.w && bottom <= size.h) return;
    state.manual = true;
    moveCamera({ k: camera.k, x: size.w / 2 - (seat.x + seat.w / 2) * camera.k, y: size.h / 2 - (seat.y + seat.h / 2) * camera.k });
  }
  function graphKeys(event) {
    const L = layoutApi();
    const arrows = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
    if (arrows[event.key] && state.layout) {
      const from = state.selected ?? document.activeElement?.dataset?.seat ?? state.layout.seats.find((item) => item.id !== "you")?.id;
      const target = state.selected || document.activeElement?.dataset?.seat ? L.neighbor(state.layout, from, arrows[event.key]) : from;
      if (target && target !== "you") { event.preventDefault?.(); select(target); reveal(target); focusCard(target); }
      else event.preventDefault?.();
    } else if (event.key === "+" || event.key === "=") { event.preventDefault?.(); zoomBy(1.25); }
    else if (event.key === "-" || event.key === "_") { event.preventDefault?.(); zoomBy(1 / 1.25); }
    else if (event.key === "0") { event.preventDefault?.(); fitView(true); }
  }
  function focusCard(id) {
    const card = [...(graphParts().cards?.children ?? [])].find((node) => node.dataset?.seat === id);
    card?.focus?.({ preventScroll: true });
  }

  // Where the keyboard lands when the inspector closes: the seat's own card or row.
  function focusSeat(id) {
    if (!id) return;
    if (state.tab === "graph") { focusCard(id); return; }
    const row = [...($("tree")?.children ?? [])].find((item) => item.dataset?.key === `seat:${id}`);
    row?.children[0]?.focus?.({ preventScroll: true });
  }

  function makeCard(id) {
    const card = el("button", "fleet-seat");
    card.type = "button";
    card.dataset.seat = id;
    const bar = el("span", "fleet-seat-bar");
    bar.append(el("i", "fleet-seat-fill"));
    card.append(el("span", "fleet-dot"), el("span", "fleet-seat-name", id), el("span", "fleet-seat-line"), el("span", "fleet-seat-meta"), bar);
    if (id === "you") { card.classList.add("is-you"); card.disabled = true; }
    card.addEventListener("click", () => select(id));
    return card;
  }
  function makeWire(wire) {
    const d = wire.points.map((point, index) => `${index ? "L" : "M"}${point[0]} ${point[1]}`).join(" ");
    const group = svg("g", { class: "fleet-wire", "data-kind": wire.kind, "data-from": wire.from, "data-to": wire.to });
    const hit = svg("path", { d, class: "fleet-wire-hit" });
    const title = svg("title");
    hit.append(title);
    const label = svg("text", { class: "fleet-wire-label", x: wire.label.x, y: wire.label.y - 4, "text-anchor": "middle" });
    group.append(svg("path", { d, class: "fleet-wire-line", "marker-end": `url(#fleet-arrow-${wire.kind})` }), hit, label);
    group.fleetTitle = title;
    group.fleetLabel = label;
    return group;
  }
  function rebuildGraph() {
    const { stage, cards, wires } = graphParts();
    const layout = state.layout;
    stage.style.width = `${layout.bounds.w}px`;
    stage.style.height = `${layout.bounds.h}px`;
    wires.setAttribute("width", layout.bounds.w);
    wires.setAttribute("height", layout.bounds.h);
    const nodes = [];
    for (const pod of layout.pods) {
      const box = el("div", "fleet-pod-box");
      box.dataset.pod = pod.id;
      Object.assign(box.style, { left: `${pod.x}px`, top: `${pod.y}px`, width: `${pod.w}px`, height: `${pod.h}px` });
      box.append(el("span", "fleet-pod-title", pod.label));
      nodes.push(box);
    }
    for (const seat of layout.seats) {
      const card = makeCard(seat.id);
      Object.assign(card.style, { left: `${seat.x}px`, top: `${seat.y}px`, width: `${seat.w}px`, height: `${seat.h}px` });
      nodes.push(card);
    }
    // Rebuilding the cards would drop the focus of the one being used; it goes back to its new card.
    const active = cards.contains?.(document.activeElement) ? document.activeElement.dataset?.seat : null;
    cards.replaceChildren(...nodes);
    if (active) focusCard(active);
    wires.querySelector(".fleet-wire-layer").replaceChildren(...layout.wires.map(makeWire));
    if (!state.manual || !state.camera) fitView(false);
  }
  function updateGraph(view) {
    const { stage, cards, wires, legend } = graphParts();
    const layout = state.layout;
    stage.dataset.focus = state.selected ? "1" : "0";
    const first = layout.seats.find((item) => item.id !== "you")?.id;
    const tabStop = state.selected && layout.seats.some((item) => item.id === state.selected) ? state.selected : first;
    for (const node of cards.children) {
      if (node.dataset.pod) {
        const pod = view.pods?.find((item) => item.id === node.dataset.pod);
        const busy = pod ? pod.seats.filter((seat) => seat.status === "working").length : 0;
        setText(node.children[0], pod ? `${pod.label} · ${busy}/${pod.seats.length}` : (layout.pods.find((item) => item.id === node.dataset.pod)?.label ?? ""));
        continue;
      }
      const id = node.dataset.seat;
      const seat = id === "you" ? null : seatOf(view, id);
      const picked = id === state.selected;
      node.dataset.status = seat?.status ?? "idle";
      node.dataset.selected = String(picked);
      node.setAttribute("aria-pressed", String(picked));
      node.tabIndex = id === tabStop ? 0 : -1;
      if (!seat) { setText(node.children[2], "waiting on you"); continue; }
      setText(node.children[2], nowText(seat));
      setText(node.children[3], [runtimeText(seat.runtime), seat.gen ? `g${seat.gen}` : ""].filter(Boolean).join(" · "));
      const bar = node.children[4];
      bar.hidden = !(seat.now && Number.isFinite(seat.now.progress));
      bar.children[0].style.width = percent(seat.now?.progress) || "0%";
      node.setAttribute("aria-label", `${seat.address}, ${STATE_LABEL[seat.status] ?? seat.status}, ${nowText(seat)}`);
      node.title = `${seat.address}${seat.runtime ? ` · ${runtimeText(seat.runtime)}` : ""}`;
    }
    const byId = new Map(layout.wires.map((wire) => [wire.id, wire]));
    const present = new Set();
    for (const group of wires.querySelector(".fleet-wire-layer").children) {
      const wire = byId.get(`${group.getAttribute("data-from")}>${group.getAttribute("data-to")}`);
      if (!wire) continue;
      present.add(wire.kind);
      const reasons = wire.kinds.map((kind) => KIND_LABEL[kind] ?? kind).join(", ");
      group.setAttribute("data-kind", wire.kind);
      group.setAttribute("data-touch", group.getAttribute("data-from") === state.selected || group.getAttribute("data-to") === state.selected ? "1" : "0");
      setText(group.fleetTitle, `${wire.id.replace(">", " → ")} · ${reasons}${wire.count > 1 ? ` · ${wire.count} times` : ""}`);
      setText(group.fleetLabel, wire.count > 1 ? `${KIND_LABEL[wire.kind] ?? wire.kind} ×${wire.count}` : (KIND_LABEL[wire.kind] ?? wire.kind));
    }
    const kinds = (layoutApi()?.KIND_RANK ?? []).filter((kind) => present.has(kind));
    reconcile(legend, kinds, (kind) => kind, () => { const item = el("li", "fleet-legend-item"); item.append(el("i", "fleet-legend-swatch"), el("span", "fleet-legend-name")); return item; }, (item, kind) => { item.dataset.kind = kind; item.children[0].dataset.kind = kind; setText(item.children[1], KIND_LABEL[kind] ?? kind); });
  }
  function paintGraph(view) {
    if (!$("graph").children.length) buildGraph();
    const L = layoutApi();
    if (!L) return;
    const fresh = L.layoutPods(view);
    const key = JSON.stringify([fresh.pods.map((pod) => [pod.id, pod.x, pod.y, pod.w, pod.h]), fresh.seats.map((seat) => [seat.id, seat.x, seat.y]), fresh.wires.map((wire) => [wire.id, wire.points])]);
    state.layout = fresh;
    if (key !== state.layoutKey) { state.layoutKey = key; rebuildGraph(); }
    updateGraph(view);
    if (state.selected && state.painted.revealed !== state.selected) { state.painted.revealed = state.selected; reveal(state.selected); }
  }

  // ---- actions a seat offers -------------------------------------------------------------------
  function openTask(taskId) {
    if (!taskId) return;
    if (window.MefiTasks?.open) window.MefiTasks.open({ taskId });
    else window.MefiNav?.go?.("tasks", { taskId });
  }
  function openInCommand(seat) {
    const key = seat?.now?.taskId || seat?.last?.taskId || seat?.now?.runId;
    window.MefiNav?.go?.("command", key ? { selected: `builder:${key}` } : {});
  }
  async function stopSeat(seat) {
    try {
      // The run that was on screen goes with the request, so a seat that has moved on is left alone.
      const result = await api().fleetAction({ seatId: seat.id, action: "stop", runId: seat.now?.runId });
      if (result?.ok === false) throw new Error(result.error || "That seat could not be stopped.");
      window.MefiToast?.(`${seat.id} was told to stop. Its task waits for you.`, "good");
    } catch (error) {
      window.MefiToast?.(plain(error, "That seat could not be stopped."), "bad");
    }
  }
  const canStop = (seat) => Boolean(seat?.now?.taskId) && !seat.now.stopping;

  // ---- the table: one row per seat ---------------------------------------------------------------
  const COLUMNS = [["pod", "Pod", true], ["seat", "Seat", true], ["runtime", "Runtime", false], ["model", "Model", false], ["ctx", "Ctx", false], ["state", "State", true], ["now", "Now", false], ["gen", "Gen", true], ["actions", "", false]];
  function buildTable() {
    const host = $("table");
    const table = el("table", "fleet-table");
    const head = el("tr");
    for (const [key, label, sortable] of COLUMNS) {
      const cell = el("th", "fleet-th");
      cell.dataset.col = key;
      if (sortable) {
        const button = el("button", "fleet-sort", label);
        button.type = "button";
        button.addEventListener("click", () => {
          state.sort = { key, dir: state.sort.key === key ? -state.sort.dir : 1 };
          if (state.view) paintTable(state.view);
        });
        cell.append(button);
      } else if (label) cell.textContent = label;
      else cell.append(el("span", "sr-only", "Actions"));
      head.append(cell);
    }
    const thead = el("thead");
    thead.append(head);
    table.append(thead, el("tbody"));
    host.append(el("div", "fleet-table-wrap"), el("p", "fleet-table-foot"));
    host.children[0].append(table);
  }
  function tableRows(view) {
    const order = new Map((view.pods ?? []).map((pod, index) => [pod.id, index]));
    const rows = (view.pods ?? []).flatMap((pod) => (pod.seats ?? []).map((seat, index) => ({ seat, pod, index })));
    const { key, dir } = state.sort;
    const byName = (a, b) => a.seat.id.localeCompare(b.seat.id, undefined, { numeric: true });
    const compare = {
      pod: (a, b) => order.get(a.pod.id) - order.get(b.pod.id) || a.index - b.index,
      seat: byName,
      state: (a, b) => (STATE_RANK[a.seat.status] ?? 9) - (STATE_RANK[b.seat.status] ?? 9) || byName(a, b),
      gen: (a, b) => (a.seat.gen ?? 0) - (b.seat.gen ?? 0) || byName(a, b),
    }[key] ?? byName;
    return rows.sort((a, b) => compare(a, b) * dir);
  }
  function makeTableRow() {
    const row = el("tr", "fleet-tr");
    for (const [key] of COLUMNS) { const cell = el("td", "fleet-td"); cell.dataset.col = key; row.append(cell); }
    const name = el("button", "fleet-seat-link");
    name.type = "button";
    row.children[1].append(name);
    row.children[5].append(el("span", "fleet-dot"), el("span", "fleet-state-name"));
    const open = el("button", "ghost mini fleet-act", "Open");
    open.type = "button";
    const halt = el("button", "ghost mini fleet-act", "Stop");
    halt.type = "button";
    window.MefiUi?.arm?.(halt, { armed: "Stop it?", run: () => { if (row.fleetSeat) void stopSeat(row.fleetSeat); } });
    open.addEventListener("click", () => openTask(row.fleetSeat?.now?.taskId || row.fleetSeat?.last?.taskId));
    row.children[8].append(open, halt);
    const pick = () => { if (row.fleetSeat) select(row.fleetSeat.id); };
    // The row selects its seat, but a click on its own Open or Stop is about that button, not the seat:
    // selecting would slide the inspector drawer over the very button being pressed.
    row.addEventListener("click", (event) => { if (!event.target?.closest?.(".fleet-act")) pick(); });
    name.addEventListener("click", pick);
    return row;
  }
  function updateTableRow(row, { seat, pod }) {
    row.fleetSeat = seat;
    row.setAttribute("aria-selected", String(seat.id === state.selected));
    row.dataset.status = seat.status;
    const cell = (index) => row.children[index];
    setText(cell(0), pod.label);
    setText(cell(1).children[0], seat.id);
    setText(cell(2), seat.runtime?.via ?? "");
    setText(cell(3), modelName(seat.runtime?.model));
    setText(cell(4), Number.isFinite(seat.ctx) ? percent(seat.ctx) : "—");
    cell(5).children[0].dataset.status = seat.status;
    setText(cell(5).children[1], STATE_LABEL[seat.status] ?? seat.status);
    setText(cell(6), nowText(seat));
    setText(cell(7), seat.gen ? `g${seat.gen}` : "");
    cell(8).children[0].hidden = !(seat.now?.taskId || seat.last?.taskId);
    cell(8).children[1].hidden = !canStop(seat);
    cell(1).children[0].title = seat.address;
  }
  function paintTable(view) {
    const host = $("table");
    if (!host.children.length) buildTable();
    const table = host.querySelector(".fleet-table");
    reconcile(table.children[1], tableRows(view), (item) => item.seat.id, makeTableRow, updateTableRow);
    for (const cell of table.children[0].children[0].children) {
      if (!COLUMNS.some(([key, , sortable]) => sortable && key === cell.dataset.col)) continue;
      const on = cell.dataset.col === state.sort.key;
      cell.setAttribute("aria-sort", on ? (state.sort.dir > 0 ? "ascending" : "descending") : "none");
    }
    const counts = view.counts ?? {};
    setText(host.querySelector(".fleet-table-foot"), `${counts.seats ?? 0} seats · ${counts.working ?? 0} working · ${counts.attention ?? 0} need attention · ${counts.openRows ?? 0} ready to take`);
  }

  // ---- recent: what moved between seats, newest first ------------------------------------------------
  function buildRecent() {
    const host = $("recent");
    const bar = el("div", "fleet-recent-bar");
    const chips = el("div", "chips");
    chips.setAttribute("role", "group");
    chips.setAttribute("aria-label", "Kinds of activity");
    for (const [id, label] of RECENT_GROUPS) {
      const chip = el("button", "chip", label);
      chip.type = "button";
      chip.dataset.group = id;
      chip.setAttribute("aria-pressed", "false");
      chip.addEventListener("click", () => {
        if (state.groups.has(id)) state.groups.delete(id); else state.groups.add(id);
        if (state.view) paintRecent(state.view);
      });
      chips.append(chip);
    }
    const search = el("input");
    search.type = "search";
    search.id = "fleet-recent-search";
    search.placeholder = "Search this feed";
    search.setAttribute("aria-label", "Search this feed");
    search.autocomplete = "off";
    search.addEventListener("input", () => { state.text = search.value.trim().toLowerCase(); if (state.view) paintRecent(state.view); });
    bar.append(chips, search);
    const list = el("ol", "fleet-recent-list");
    // One row is a tab stop; the arrow keys move it, as in the explorer.
    list.addEventListener("keydown", (event) => {
      const picks = [...list.children].map((row) => row.children[2]);
      const at = picks.indexOf(document.activeElement);
      const next = event.key === "ArrowDown" ? at + 1 : event.key === "ArrowUp" ? at - 1 : event.key === "Home" ? 0 : event.key === "End" ? picks.length - 1 : null;
      if (at < 0 || next === null) return;
      event.preventDefault?.();
      const target = picks[Math.max(0, Math.min(picks.length - 1, next))];
      for (const pick of picks) pick.tabIndex = pick === target ? 0 : -1;
      target.focus?.();
    });
    host.append(bar, list, el("p", "fleet-empty"));
  }
  function makeRecentRow() {
    const row = el("li", "fleet-recent-row");
    const pick = el("button", "fleet-recent-text");
    pick.type = "button";
    row.append(el("time", "fleet-recent-time"), el("span", "fleet-recent-kind"), pick);
    row.addEventListener("click", () => {
      const id = [row.fleetRow?.to, row.fleetRow?.from].find((seat) => state.view && seatOf(state.view, seat));
      if (id) select(id);
    });
    return row;
  }
  function updateRecentRow(node, row) {
    node.fleetRow = row;
    node.dataset.group = groupOf(row.kind);
    setText(node.children[0], clock(row.at));
    setText(node.children[1], row.kind.replace("_", " "));
    setText(node.children[2], rowText(row));
  }
  function paintRecent(view) {
    const host = $("recent");
    if (!host.children.length) buildRecent();
    for (const chip of host.querySelectorAll(".chip")) {
      const on = state.groups.has(chip.dataset.group);
      chip.classList.toggle("on", on);
      chip.setAttribute("aria-pressed", String(on));
    }
    const wanted = new Set(RECENT_GROUPS.filter(([id]) => state.groups.has(id)).flatMap(([, , kinds]) => kinds));
    const rows = (view.recent ?? []).filter((row) => (!wanted.size || wanted.has(row.kind)) && (!state.text || `${rowText(row)} ${row.kind} ${row.from ?? ""} ${row.to ?? ""}`.toLowerCase().includes(state.text)));
    const shown = reconcile(host.querySelector(".fleet-recent-list"), rows, (row) => row.seq, makeRecentRow, updateRecentRow);
    const picks = shown.map((row) => row.children[2]);
    const stop = picks.includes(document.activeElement) ? document.activeElement : picks[0];
    for (const pick of picks) pick.tabIndex = pick === stop ? 0 : -1;
    const none = view.recent?.length ? "No rows match these filters." : "Nothing has moved between seats yet. Rows appear here as work is taken, handed on, checked and asked about.";
    setText(host.querySelector(".fleet-empty"), rows.length ? "" : none);
  }

  // ---- the tree: the fleet drawn as a node tree, project > pods > seats > work ---------------------
  function treeModel(view) {
    const workOf = (seat) => {
      if (seat.now?.title) return [{ id: `task:${seat.id}`, label: short(seat.now.title, 34), kind: "task", status: seat.status, hint: seat.now.step || "working" }];
      if (seat.last?.title) return [{ id: `task:${seat.id}`, label: short(seat.last.title, 34), kind: "task", status: "done", hint: OUTCOME_LABEL[seat.last.outcome] ?? "last run" }];
      return [];
    };
    const pods = (view.pods ?? []).filter((pod) => pod.seats?.length).map((pod) => ({ id: `pod:${pod.id}`, label: pod.label, kind: "pod", status: null, children: pod.seats.map((seat) => ({ id: seat.id, label: seat.id, kind: "seat", status: seat.status, hint: nowText(seat), children: workOf(seat) })) }));
    return { id: "project", label: view.project?.name || "This project", kind: "project", status: view.counts?.working ? "working" : "idle", children: pods };
  }
  function buildTree() {
    const host = $("nodes");
    const tools = el("div", "fleet-tree-tools");
    const command = el("button", "ghost mini fleet-tree-command", "Open in Command");
    command.type = "button";
    command.title = "The live node tree, with the selected seat in focus";
    command.addEventListener("click", () => openInCommand(state.view && state.selected ? seatOf(state.view, state.selected) : null));
    tools.append(el("p", "fleet-tree-note", "The team as a tree. Command shows the same work as the live node tree."), command);
    const scroll = el("div", "fleet-tree-scroll");
    const stage = el("div", "fleet-tree-stage");
    stage.append(svg("svg", { class: "fleet-tree-links", "aria-hidden": "true" }), el("div", "fleet-tree-nodes"));
    scroll.append(stage);
    host.append(tools, scroll);
  }
  function paintTree(view) {
    const host = $("nodes");
    if (!host.children.length) buildTree();
    const L = layoutApi();
    if (!L) return;
    const layout = L.tidyTree(treeModel(view));
    const pad = { x: 24, y: 22 };
    const width = 176;
    const stage = host.querySelector(".fleet-tree-stage");
    const links = host.querySelector(".fleet-tree-links");
    const nodes = host.querySelector(".fleet-tree-nodes");
    const key = JSON.stringify(layout.nodes.map((node) => [node.id, node.label, node.kind, node.x, node.y]));
    if (key !== state.treeKey) {
      state.treeKey = key;
      stage.style.width = `${layout.bounds.w + 2 * pad.x}px`;
      stage.style.height = `${layout.bounds.h + 2 * pad.y}px`;
      links.setAttribute("width", layout.bounds.w + 2 * pad.x);
      links.setAttribute("height", layout.bounds.h + 2 * pad.y);
      const at = new Map(layout.nodes.map((node) => [node.id, node]));
      links.replaceChildren(...layout.links.map((link) => {
        const [a, b] = [at.get(link.from), at.get(link.to)];
        const x1 = a.x + pad.x + width, y1 = a.y + pad.y, x2 = b.x + pad.x, y2 = b.y + pad.y, mid = (x1 + x2) / 2;
        return svg("path", { class: "fleet-tree-link", d: `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}` });
      }));
      nodes.replaceChildren(...layout.nodes.map((node) => makeTreeNode(node, pad, width)));
    }
    const byId = new Map(layout.nodes.map((node) => [node.id, node]));
    for (const item of nodes.children) {
      const node = byId.get(item.dataset.node);
      item.children[0].dataset.status = node?.status ?? "none";
      item.setAttribute("aria-current", String(item.dataset.node === state.selected));
      item.title = node?.hint ?? "";
    }
  }
  function makeTreeNode(node, pad, width) {
    const interactive = node.kind === "seat" || node.kind === "task";
    const item = el(interactive ? "button" : "div", "fleet-tnode");
    if (interactive) item.type = "button";
    item.dataset.node = node.id;
    item.dataset.kind = node.kind;
    Object.assign(item.style, { left: `${node.x + pad.x}px`, top: `${node.y + pad.y - 12}px`, width: `${width}px` });
    item.append(el("span", "fleet-dot"), el("span", "fleet-tnode-label", node.label));
    item.addEventListener("click", () => {
      if (node.kind === "seat") select(node.id);
      else if (node.kind === "task") {
        const seat = seatOf(state.view, node.id.slice(5));
        openTask(seat?.now?.taskId || seat?.last?.taskId);
      }
    });
    return item;
  }

  // ---- health: what needs a look, and why -------------------------------------------------------------
  function startAgents() {
    return api()?.assistantControl?.("start-work")
      .then((result) => { if (result?.ok === false) throw new Error(result.error); window.MefiToast?.("Agents started. They pick up what is queued.", "good"); })
      .catch((error) => window.MefiToast?.(plain(error, "The agents could not start."), "bad"));
  }
  function loopButton(action) {
    if (!action?.id) return null;
    const button = el("button", "ghost mini fleet-loop-action", action.label || "Fix this");
    button.type = "button";
    if (action.id === "restart") {
      window.MefiUi?.arm?.(button, { armed: "Restart Studio?", run: () => api()?.appRestart?.({ stopAgents: true }) });
      return button;
    }
    const run = {
      start: startAgents,
      "connect-ai": () => (window.MefiSetupHelper?.open ? window.MefiSetupHelper.open("providers") : window.MefiNav?.go?.("agents", { section: "setup", pane: "connections" })),
      "open-project": () => window.MefiSidebar?.open?.({ focus: true }),
      review: () => window.MefiNav?.go?.("tasks", {}),
    }[action.id];
    if (!run) return null;
    button.addEventListener("click", run);
    return button;
  }
  function buildHealth() {
    $("health").append(el("div", "fleet-health-loop"), el("ul", "fleet-health-list"), el("p", "fleet-empty"));
  }
  function makeSignal() {
    const item = el("li", "fleet-signal");
    const head = el("div", "fleet-signal-head");
    head.append(el("span", "fleet-chip"), el("strong", "fleet-signal-summary"));
    const go = el("button", "ghost mini fleet-signal-go", "Look");
    go.type = "button";
    go.addEventListener("click", () => inspectSignal(item.fleetSignal));
    item.append(head, el("p", "fleet-signal-reason"), el("p", "fleet-signal-why"), go);
    return item;
  }
  function updateSignal(item, signal) {
    item.fleetSignal = signal;
    item.dataset.severity = signal.severity;
    const chip = item.children[0].children[0];
    chip.dataset.tone = signal.severity === "bad" ? "bad" : signal.severity === "warn" ? "warn" : "info";
    setText(chip, signal.severity === "bad" ? "Needs you" : signal.severity === "warn" ? "Look" : "Note");
    setText(item.children[0].children[1], signal.summary);
    setText(item.children[1], signal.reason ?? "");
    setText(item.children[2], [signal.why, signal.threshold ? `Rule: ${signal.threshold}.` : ""].filter(Boolean).join(" "));
    item.children[3].hidden = !(signal.inspect?.seatId || signal.inspect?.taskId);
  }
  function inspectSignal(signal) {
    const target = signal?.inspect;
    if (target?.seatId && state.view && seatOf(state.view, target.seatId)) { select(target.seatId); setTab("graph"); }
    else if (target?.taskId) openTask(target.taskId);
  }
  function paintHealth(view) {
    const host = $("health");
    if (!host.children.length) buildHealth();
    const loop = view.loop;
    const card = host.querySelector(".fleet-health-loop");
    const sig = JSON.stringify([loop?.state, loop?.headline, loop?.reason, loop?.action?.id, loop?.tone]);
    if (state.painted.loop !== sig) {
      state.painted.loop = sig;
      card.replaceChildren();
      if (loop?.headline) {
        card.dataset.tone = loop.tone || "quiet";
        const button = loopButton(loop.action);
        card.append(el("strong", "fleet-loop-title", loop.headline), el("p", "fleet-loop-reason", loop.reason || ""), ...(button ? [button] : []));
      }
      card.hidden = !loop?.headline;
    }
    reconcile(host.querySelector(".fleet-health-list"), view.health ?? [], (signal) => signal.id, makeSignal, updateSignal);
    const none = "Nothing needs attention. Runs are moving, no question is waiting on you and nothing is looping.";
    setText(host.querySelector(".fleet-empty"), (view.health ?? []).length ? "" : none);
  }

  // ---- the inspector: the selected seat, or the whole fleet ----------------------------------------------
  const OUTCOME_TONE = { verified: "ok", awaiting: "info", failed: "bad", rejected: "bad", lost: "bad", stopped: "warn" };
  const STATE_TONE = { working: "ok", waiting: "warn", blocked: "bad", error: "bad", idle: "quiet", off: "quiet" };
  function chipOf(text, tone) {
    const node = el("span", "fleet-chip", text);
    node.dataset.tone = tone;
    return node;
  }
  function fact(label, value) {
    const row = el("div", "fleet-fact");
    row.append(el("dt", "fleet-fact-name", label), el("dd", "fleet-fact-value", value));
    return row;
  }
  function section(title, ...children) {
    const box = el("section", "fleet-sec");
    box.append(el("h4", "fleet-sec-title", title), ...children);
    return box;
  }
  function duration(from, to = Date.now()) {
    const seconds = Math.max(0, Math.round((to - from) / 1000));
    if (seconds < 60) return `${seconds} s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
    return `${Math.floor(seconds / 3600)} h ${Math.round((seconds % 3600) / 60)} min`;
  }
  // What makes a seat's runs and wires out of date: a run starting or ending, a wire counting up, a new row.
  // A push that changes none of these (progress, output) leaves the runs it already has.
  function seatKey(view, seat) {
    return JSON.stringify([seat.gen, seat.status, seat.now?.runId ?? null, seat.last?.gen ?? null, seat.last?.outcome ?? null,
      (view.edges ?? []).filter((edge) => edge.from === seat.id || edge.to === seat.id).map((edge) => [edge.from, edge.to, edge.kind, edge.count]),
      (view.recent ?? []).find((row) => row.from === seat.id || row.to === seat.id)?.seq ?? 0]);
  }
  async function fetchDetail(id) {
    if (!api()?.fleetSeat || !id) return;
    const ticket = ++state.detailFetch;
    const epoch = state.epoch;
    const seat = state.view ? seatOf(state.view, id) : null;
    const key = seat ? seatKey(state.view, seat) : "";
    state.detailPending = ticket;
    let data = null;
    try {
      const reply = await api().fleetSeat(id);
      if (reply?.ok !== false) data = reply;
    } catch { /* the inspector keeps the facts the snapshot carries */ }
    if (ticket !== state.detailFetch) return;
    state.detailPending = 0;
    if (epoch !== state.epoch || state.selected !== id) return;
    state.detail = { seatId: id, key, data };
    schedulePaint();
  }
  function scheduleDetail() {
    if (state.detailTimer) return;
    state.detailTimer = setTimeout(() => { state.detailTimer = 0; if (state.selected) void fetchDetail(state.selected); }, 400);
  }
  function fleetInspector(view) {
    const box = el("div", "fleet-ins");
    const counts = view.counts ?? {};
    const head = el("header", "fleet-ins-head");
    head.append(el("h3", "fleet-ins-name", view.project?.name || "This project"), chipOf("This PC", "quiet"));
    const facts = el("dl", "fleet-facts");
    facts.append(fact("Seats", String(counts.seats ?? 0)), fact("Working", String(counts.working ?? 0)), fact("Need attention", String(counts.attention ?? 0)), fact("Ready to take", String(counts.openRows ?? 0)));
    box.append(head, facts);
    if (view.loop?.headline) box.append(section("Agents", el("p", "fleet-ins-text", view.loop.headline), el("p", "fleet-ins-note", view.loop.reason || "")));
    const list = el("ul", "fleet-ins-list");
    for (const signal of (view.health ?? []).slice(0, 3)) list.append(el("li", "fleet-ins-row", signal.summary));
    if (list.children.length) box.append(section("Needs a look", list));
    box.append(el("p", "fleet-ins-note", "Select a seat to see what it is doing, the runs it has had and who it works with."));
    return box;
  }
  function generationsList(detail, seat, phase) {
    const list = el("ol", "fleet-gens");
    const rows = detail?.lineage ?? [];
    for (const gen of rows.slice(0, 8)) {
      const row = el("li", "fleet-gen-row");
      const top = el("div", "fleet-gen-top");
      top.append(el("span", "fleet-gen-n", `g${gen.gen}`), el("span", "fleet-gen-title", gen.title ? short(gen.title, 46) : "untitled"));
      top.append(gen.running ? chipOf("Running", "ok") : gen.outcome ? chipOf(OUTCOME_LABEL[gen.outcome] ?? gen.outcome, OUTCOME_TONE[gen.outcome] ?? "quiet") : chipOf("no result", "quiet"));
      row.append(top);
      const bits = [gen.startedAt ? `${duration(gen.startedAt, gen.endedAt ?? undefined)}${gen.endedAt ? "" : " so far"}` : "", gen.via || "", gen.merge ? (gen.merge.merged ? "merged" : `kept ${gen.branch || "its branch"} (${gen.merge.reason || "not merged"})`) : gen.branch || ""].filter(Boolean);
      if (bits.length) row.append(el("p", "fleet-gen-note", bits.join(" · ")));
      if (gen.result?.done || gen.result?.next) row.append(el("p", "fleet-gen-note", [gen.result.done, gen.result.next ? `Next: ${gen.result.next}` : ""].filter(Boolean).join(" ")));
      list.append(row);
    }
    if (!rows.length) {
      const note = phase === "failed" ? "Its runs could not be read." : !seat.gen ? "It has not run yet." : phase === "loading" ? "Reading its runs…" : `${seat.gen} run${seat.gen === 1 ? "" : "s"}, not listed here.`;
      list.append(el("li", "fleet-ins-note", note));
    }
    if (rows.length > 8) list.append(el("li", "fleet-ins-note", `${rows.length - 8} older runs are not shown.`));
    return list;
  }
  function wiresList(view, seat, detail) {
    const list = el("ul", "fleet-ins-list");
    for (const edge of (detail?.edges ?? view.edges ?? []).filter((item) => item.from === seat.id || item.to === seat.id)) {
      const out = edge.from === seat.id;
      const other = out ? edge.to : edge.from;
      const row = el("li", "fleet-ins-row");
      row.textContent = `${out ? "to" : "from"} ${other === "you" ? "you" : other} · ${KIND_LABEL[edge.kind] ?? edge.kind}${edge.count > 1 ? ` ×${edge.count}` : ""}`;
      row.dataset.kind = edge.kind;
      list.append(row);
    }
    if (!list.children.length) list.append(el("li", "fleet-ins-note", "Nothing has passed between this seat and another yet."));
    return list;
  }
  function seatActions(seat) {
    const bar = el("div", "fleet-ins-actions");
    const taskId = seat.now?.taskId || seat.last?.taskId;
    if (taskId) {
      const open = el("button", "ghost mini", "Open task");
      open.type = "button";
      open.addEventListener("click", () => openTask(taskId));
      bar.append(open);
    }
    const command = el("button", "ghost mini", "Open in Command");
    command.type = "button";
    command.addEventListener("click", () => openInCommand(seat));
    bar.append(command);
    if (canStop(seat)) {
      const halt = el("button", "ghost mini", "Stop this run");
      halt.type = "button";
      window.MefiUi?.arm?.(halt, { armed: "Stop it?", run: () => void stopSeat(seat) });
      bar.append(halt);
    }
    return bar;
  }
  function seatInspector(view, seat, detail, phase) {
    const box = el("div", "fleet-ins");
    const head = el("header", "fleet-ins-head");
    const dot = el("span", "fleet-dot");
    dot.dataset.status = seat.status;
    const away = el("button", "ghost mini fleet-ins-close", "×");
    away.type = "button";
    away.title = "Close (Esc)";
    away.setAttribute("aria-label", "Close this seat");
    away.addEventListener("click", () => { select(null); focusSeat(seat.id); });
    head.append(dot, el("h3", "fleet-ins-name", seat.id), chipOf(STATE_LABEL[seat.status] ?? seat.status, STATE_TONE[seat.status] ?? "quiet"), away);
    box.append(head, el("p", "fleet-ins-address", seat.address));
    if (seat.text) box.append(el("p", "fleet-ins-text", seat.text));
    box.append(seatActions(seat));
    const live = { dd: {} };
    if (seat.now) {
      const now = el("div", "fleet-now");
      live.title = el("p", "fleet-now-title");
      live.step = el("p", "fleet-now-step");
      const bar = el("div", "fleet-ins-bar");
      bar.append(el("i", "fleet-ins-fill"));
      live.bar = bar;
      const facts = el("dl", "fleet-facts");
      for (const [key, label] of [["phase", "Phase"], ["for", "Running for"], ["quiet", "Last output"], ["edits", "Files edited"], ["branch", "Branch"]]) {
        const row = fact(label, "");
        live.dd[key] = row.children[1];
        facts.append(row);
      }
      now.append(live.title, live.step, bar, facts);
      box.append(section("Now", now));
    } else if (seat.last) {
      box.append(section("Last run", el("p", "fleet-now-title", short(seat.last.title || "untitled", 90)), chipOf(OUTCOME_LABEL[seat.last.outcome] ?? "ended", OUTCOME_TONE[seat.last.outcome] ?? "quiet")));
    }
    const runtime = el("dl", "fleet-facts");
    if (detail?.recap?.text) box.append(section("Seat recap", el("p", "fleet-recap", detail.recap.text)));
    runtime.append(fact("Runtime", seat.runtime?.via || "not set"), fact("Model", modelName(seat.runtime?.model) || "not set"), fact("Context", Number.isFinite(seat.ctx) ? percent(seat.ctx) : "not measured"));
    box.append(section("Runtime", runtime), section("Runs", generationsList(detail, seat, phase)), section("Works with", wiresList(view, seat, detail)));
    const recent = el("ul", "fleet-ins-list");
    for (const row of (detail?.recent ?? []).slice(0, 5)) recent.append(el("li", "fleet-ins-row", rowText(row)));
    if (recent.children.length) box.append(section("Recent", recent));
    const signals = el("ul", "fleet-ins-list");
    for (const signal of (view.health ?? []).filter((item) => item.seatId === seat.id)) signals.append(el("li", "fleet-ins-row", signal.summary));
    if (signals.children.length) box.append(section("Needs a look", signals));
    box.fleetLive = live;
    return box;
  }
  // Progress and quiet time change every push; they update in place so a focused button stays focused.
  function updateLive(box, seat) {
    const live = box?.fleetLive;
    if (!live?.title || !seat.now) return;
    const now = seat.now;
    setText(live.title, short(now.title || "starting…", 90));
    setText(live.step, now.step || "");
    live.bar.hidden = !Number.isFinite(now.progress);
    live.bar.children[0].style.width = percent(now.progress) || "0%";
    setText(live.dd.phase, now.stopping ? "stopping" : now.phase || "");
    setText(live.dd.for, now.since ? duration(now.since) : "");
    setText(live.dd.quiet, now.lastOutputAt ? ago(now.lastOutputAt) : "nothing yet");
    setText(live.dd.edits, String(now.edits ?? 0));
    setText(live.dd.branch, now.branch || "the shared checkout");
  }
  function structureKey(view, seat, detail, phase) {
    return JSON.stringify([phase, seat.id, seat.status, seat.text, seat.gen, seat.now?.taskId, seat.now?.runId, seat.now?.stopping, Boolean(seat.now), seat.last?.outcome, seat.last?.title, seat.last?.runId, seat.runtime, detail?.recap?.text,
      (detail?.lineage ?? []).map((gen) => [gen.gen, gen.outcome, gen.running, gen.merge?.merged]), (detail?.edges ?? view.edges ?? []).filter((edge) => edge.from === seat.id || edge.to === seat.id).map((edge) => [edge.from, edge.to, edge.kind, edge.count]),
      (detail?.recent ?? []).slice(0, 5).map((row) => row.seq), (view.health ?? []).filter((item) => item.seatId === seat.id).map((item) => item.id)]);
  }
  function paintInspector(view) {
    const host = $("inspector");
    if (!host) return;
    const seat = state.selected ? seatOf(view, state.selected) : null;
    const loaded = seat && state.detail?.seatId === seat.id ? state.detail : null;
    const detail = loaded?.data ?? null;
    const phase = loaded ? (detail ? "ready" : "failed") : "loading";
    // The runs and wires are read again only when the seat's own facts moved (or were never read).
    if (seat && !state.detailPending && !state.detailTimer && (!loaded || loaded.key !== seatKey(view, seat))) scheduleDetail();
    const key = seat ? structureKey(view, seat, detail, phase) : JSON.stringify(["fleet", view.project?.name, view.counts, view.loop?.headline, view.loop?.reason, (view.health ?? []).slice(0, 3).map((item) => item.id)]);
    if (key !== state.painted.inspector) {
      state.painted.inspector = key;
      host.replaceChildren(seat ? seatInspector(view, seat, detail, phase) : fleetInspector(view));
      host.dataset.mode = seat ? "seat" : "fleet";
    }
    if (seat) updateLive(host.children[0], seat);
  }

  // ---- the sheet ------------------------------------------------------------------------------------------
  // The tab bar wraps on a narrow window; the inspector drawer starts below it.
  function measureBar() {
    const height = $("overlay")?.querySelector?.(".fleet-bar")?.offsetHeight;
    if (Number.isFinite(height) && height > 0) $("overlay").style.setProperty?.("--fleet-bar-h", `${height + 8}px`);
  }
  function open(params = {}) {
    init();
    if (typeof params?.seatId === "string" && params.seatId) state.selected = params.seatId;
    if (TABS.some(([id]) => id === params?.tab)) state.tab = params.tab;
    window.MefiNav?.claim?.("fleet");
    $("overlay").hidden = false;
    state.open = true;
    state.painted = {};
    state.layoutKey = "";
    state.treeKey = "";
    start();
    if (state.view) schedulePaint();
    else if (!paintReadIssue()) status("Reading the team…");
    requestAnimationFrame(() => { measureBar(); tabButtons.get(state.tab)?.focus?.({ preventScroll: true }); });
  }
  function close() {
    if (!isOpen()) return;
    stop();
    $("overlay").hidden = true;
    state.open = false;
    window.MefiNav?.release?.("fleet");
  }
  function init() {
    if (initialized || !$("overlay")) return;
    initialized = true;
    $("close").addEventListener("click", () => window.MefiNav?.close?.("fleet") ?? close());
    // Escape steps back: a selected seat is cleared first, and the next press
    // reaches the nav, which closes the page. It answers only a key that came
    // from this page or from nothing in particular (a focused card that was
    // hidden leaves the focus on the body), never one aimed at a menu above it.
    window.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !state.open || !state.selected || event.defaultPrevented) return;
      const target = event.target;
      const mine = !target || target === document.body || target === document.documentElement || $("overlay").contains(target);
      // An armed Stop takes its own Esc, which only disarms it.
      if (!mine || target?.classList?.contains?.("danger-armed")) return;
      event.preventDefault?.();
      event.stopPropagation?.();
      const seat = state.selected;
      const active = document.activeElement;
      const lost = !active || active === document.body || Boolean($("inspector")?.contains?.(active));
      select(null);
      if (lost) focusSeat(seat);
    }, true);
    buildTabs();
    window.addEventListener("resize", () => { if (state.open) measureBar(); });
    $("tree").addEventListener("keydown", treeKeys);
    // Hidden windows are not painted; coming back reads the team again and renews the lease.
    document.addEventListener("visibilitychange", () => {
      if (!state.open || document.hidden) return;
      void refresh();
      void lease(true);
      schedulePaint();
    });
    // The host keeps one fleet per project: a switch starts from a new snapshot.
    window.addEventListener("mefi:project-changed", (event) => {
      state.epoch += 1;
      state.snapshotTicket += 1;
      state.detailFetch += 1;
      clearTimeout(state.detailTimer);
      const hasScope = Object.prototype.hasOwnProperty.call(event?.detail ?? {}, "projectId");
      const scope = hasScope ? { known: true, id: event.detail.projectId || null } : typeof window.MefiWorkspace?.activeProjectId === "function" ? { known: true, id: window.MefiWorkspace.activeProjectId() || null } : { known: false, id: null };
      Object.assign(state, { view: null, selected: null, projectId: null, detail: null, detailTimer: 0, detailPending: 0, layout: null, layoutKey: "", treeKey: "", painted: {}, readIssue: null, scopeKnown: scope.known, scopeId: scope.id });
      clearContent();
      if ($("body")) $("body").dataset.readState = "reading";
      loading(true);
      if (state.open) { status("Reading the team…"); void lease(true); void refresh(); }
    });
  }

  window.MefiFleet = { open, close, isOpen, select, tabs: () => TABS.map(([id, label]) => ({ id, label })), current: () => ({ tab: state.tab, selected: state.selected, projectId: state.projectId }) };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
