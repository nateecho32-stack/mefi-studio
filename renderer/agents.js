// Agents owns setup and team drafts. Existing model/provider controls are
// mounted here once, keeping their bindings while removing the former menus.
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const node = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const api = () => window.mefiStudio;
  const go = (id, params) => window.MefiNav?.go(id, params);
  const projectId = () => window.MefiWorkspace?.activeProjectId?.() || window.MefiTasks?.state?.projectId || null;
  const queue = { known: false, newWorkKnown: false, enabled: false, newWork: false, autoBuild: true, parallel: 1, adaptiveParallel: true, mode: "swarm", proactive: false };
  let queueRead, queueVersion = 0;
  let liveStatus = null, liveAssistant = null;
  const queueSnapshot = () => ({ ...queue });
  // adoptQueue runs on every assistant push (up to four a second); the event
  // re-renders the companion and re-walks the document's queue controls, so it
  // goes out only when the settings it carries changed.
  let queueSignature = "";
  const publishQueue = () => {
    const snapshot = queueSnapshot(), signature = JSON.stringify(snapshot);
    if (signature === queueSignature) return;
    queueSignature = signature; window.dispatchEvent(new CustomEvent("mefi:queue-settings", { detail: snapshot }));
  };
  function adoptQueue(status, full) {
    if (status) liveStatus = status;
    if (full) liveAssistant = full;
    if (status && typeof status.enabled === "boolean") Object.assign(queue, { known: true, enabled: status.enabled, autoBuild: status.autoBuild !== false, parallel: status.parallel || 1, adaptiveParallel: status.adaptiveParallel !== false, mode: status.mode === "cluster" ? "cluster" : "swarm" });
    if (full?.status) Object.assign(queue, { newWorkKnown: true, newWork: full.status !== "paused", proactive: full.prefs?.proactive !== false });
    // The host's Agents switch (status.loop.on) also counts the launch hold and
    // a stopped executor, which the assistant's own status never showed: this
    // switch used to read On while nothing could start.
    const loop = (status ?? liveStatus)?.loop;
    if (loop && typeof loop.on === "boolean") Object.assign(queue, { newWorkKnown: true, newWork: loop.on });
    queueVersion++; publishQueue(); paintOverview();
  }
  async function refreshQueue(force = false) {
    if (queueRead) return queueRead;
    if (!force && queue.known && queue.newWorkKnown) return queueSnapshot();
    const version = queueVersion;
    queueRead = Promise.allSettled([api()?.assistantStatus?.(), api()?.assistantState?.()]).then(([status, full]) => {
      if (version === queueVersion) adoptQueue(status.status === "fulfilled" ? status.value?.status && typeof status.value.status === "object" ? status.value.status : status.value : null, full.status === "fulfilled" ? full.value?.state : null);
      return queueSnapshot();
    }).finally(() => { queueRead = null; });
    return queueRead;
  }
  async function setQueue(name, value) {
    let result;
    if (name === "newWork") result = await api()?.assistantControl?.(value ? "start-work" : "pause");
    else if (name === "proactive") result = await api()?.assistantPrefs?.({ proactive: Boolean(value) });
    else {
      const patch = name === "enabled" ? { enabled: Boolean(value), execute: Boolean(value) }
        : name === "parallel" ? value === "machine" ? { adaptiveParallel: true } : { adaptiveParallel: false, parallel: Number(value) }
        : name === "autoBuild" ? { autoBuild: Boolean(value) } : name === "mode" ? { mode: value } : null;
      if (!patch) return false;
      result = await api()?.assistantAutopilot?.(patch);
    }
    if (!result || result.ok === false) throw new Error(result?.error || "The host did not confirm the change.");
    adoptQueue(result.autopilot || (typeof result.enabled === "boolean" ? result : null), result.state);
    await refreshQueue(true); return result;
  }
  window.MefiAgentControls = { snapshot: queueSnapshot, refresh: refreshQueue, set: setQueue };

  const sections = [
    ["overview", "Overview", "agents", { section: "overview" }],
    ["setup", "Setup", "agents", { section: "setup", pane: "team" }], ["live", "Live", "command", {}], ["workflows", "Workflows", "brains", {}],
    ["models", "Models", "booklet", {}], ["usage", "Usage", "usage", {}],
  ];
  const children = {
    setup: [["Team & models", "agents", { section: "setup", pane: "team" }], ["Providers", "agents", { section: "setup", pane: "connections" }], ["Routing & fallback", "agents", { section: "setup", pane: "routing" }], ["Run behavior", "agents", { section: "setup", pane: "behavior" }], ["Skills", "skills"]],
    live: [["Command", "command"], ["Fleet", "fleet"], ["Pipelines", "agent-brain", { tab: "live" }], ["Sessions", "explorer"], ["Activity", "eyes"], ["Trace", "trace"], ["Overhead", "overhead"]],
    workflows: [["Brain maps", "brains"], ["Playbook", "agent-brain", { tab: "playbook" }], ["Project map", "agent-brain", { tab: "map" }], ["Context", "context"]],
    models: [["Catalog", "booklet"], ["Performance", "graph"]],
    usage: [["Recorded calls", "usage", { view: "usage" }], ["Provider accounts", "usage", { view: "tracker" }]],
  };
  let mounted = false, params = { section: "overview", pane: "team" }, scope = "project", readSerial = 0, saving = false;
  const drafts = new Map();
  const draftKey = () => `${projectId() || "none"}:${scope}`;
  const draft = () => drafts.get(draftKey());
  function button(text, run, cls = "ghost") { const el = node("button", cls, text); el.type = "button"; el.addEventListener("click", run); return el; }
  // A button that throws work away asks twice (MefiUi.arm in studio-ui.js).
  function risky(text, run, armed, cls = "ghost") { const el = node("button", cls, text); el.type = "button"; if (window.MefiUi?.arm) window.MefiUi.arm(el, { run, armed }); else el.addEventListener("click", run); return el; }
  // Like risky(), but it asks only while there is something to lose: `when()` is asked at each press.
  function riskyIf(text, when, run, armed, cls = "ghost") {
    const el = node("button", cls, text); el.type = "button"; let timer = 0;
    const rest = () => { clearTimeout(timer); timer = 0; el.textContent = text; el.classList.remove("danger-armed"); };
    el.addEventListener("click", () => {
      if (!when() || timer) { rest(); run(); return; }
      el.classList.add("danger", "danger-armed"); el.textContent = armed; timer = setTimeout(rest, 3000);
    });
    el.addEventListener("blur", rest);
    el.addEventListener("keydown", (event) => { if (event.key === "Escape" && timer) { event.stopPropagation(); rest(); } });
    return el;
  }
  const plain = (error, fallback) => window.MefiUi?.plainError ? window.MefiUi.plainError(error, fallback) : error?.message || fallback;
  function card(title, detail) { const el = node("section", "agents-card"); el.append(node("h3", "", title)); if (detail) el.append(node("p", "muted", detail)); return el; }
  function say(text, bad = false) { const el = $("agents-save-status"); if (el) { el.textContent = text; el.dataset.tone = bad ? "bad" : "good"; } }
  function location(id, options = {}) {
    if (id === "agents") return { section: options.section || params.section, pane: options.pane || params.pane };
    if (id === "agent-brain") return { section: ["map", "playbook"].includes(options.tab || window.MefiAgentBrain?.tab?.()) ? "workflows" : "live" };
    if (["brains", "context"].includes(id)) return { section: "workflows" };
    if (["booklet", "graph"].includes(id)) return { section: "models" };
    if (id === "usage") return { section: "usage" };
    if (id === "skills") return { section: "setup" };
    return { section: "live" };
  }
  // The same sections and views as data, for the 0.5 frame's page list (renderer/shell.js draws them as a list in its list
  // column): each with whether it is where the person is, and a way there.
  function navModel(id, options = {}) {
    const here = location(id, options);
    const selected = (route, target) => route === id && (route !== "agents" || target.pane === here.pane) && (route !== "agent-brain" || target.tab === window.MefiAgentBrain?.tab?.()) && (route !== "usage" || target.view === (options.view || window.MefiModelLab?.view?.() || "usage"));
    return sections.map(([section, label, route, target]) => ({
      id: section, label, current: section === here.section, run: () => go(route, target),
      views: (children[section] || []).map(([childLabel, childRoute, childTarget = {}]) => ({ label: childLabel, current: selected(childRoute, childTarget), run: () => go(childRoute, childTarget) })),
    }));
  }
  // ---- Team: the 0.5 layout's place (html[data-layout="v2"]) ----
  // The prototype's Team (docs/prototype/mefi-studio-0.5-v5.html: TEAM_SUBS, teamView, WHERE_WENT) is this page and the
  // pages it already led to, filed into twelve places. A place is either panes of this page (Overview is the overview and
  // the run behavior; Seats and models the team and its routing; Providers the connections; Permissions, Rules,
  // Connectors and Related folders panes the 0.5 layout adds), or pages that exist (Skills; Workflows: Brain maps,
  // Playbook, Project map, Context; Health and usage; Models: Catalog and Performance; Inspect: Sessions, Activity and
  // evidence, Trace, Overhead, the profiler, machine status and the connection log). Cards keep their ids, controls and
  // host calls; nothing is copied. Old parameters ({ section, pane }) and deep links land in the place that holds them,
  // and go("agents", { place }) is the new way in. Where the engine has nothing for a place (Related folders) the page
  // says what exists and what does not. renderer/shell.js draws the list (teamPlaces) and the breadcrumb (teamPlace).
  const teamLayout = () => document.documentElement?.dataset?.layout === "v2";
  const TEAM_PLACES = Object.freeze([
    { id: "overview", label: "Overview", glyph: "g-home", panes: ["overview", "behavior"], draft: true, about: "Who does the work, how many can work at once, and how much they can do without asking." },
    { id: "providers", label: "Providers", glyph: "g-key", panes: ["connections"], about: "Where the models come from. Connect what you already pay for, then choose who uses it." },
    { id: "seats", label: "Seats and models", glyph: "g-agents", panes: ["team", "routing"], draft: true, about: "Who does each job, which model it uses, and how hard it thinks." },
    { id: "perms", label: "Permissions", glyph: "g-flag", panes: ["perms"], about: "How much Mefi can decide without asking you. Every mode leaves the same things to you." },
    { id: "rules", label: "Rules", glyph: "g-booklet", group: "Context for agents", panes: ["rules"], scoped: true, about: "Standing rules every model on this project reads. Write what you would tell a new teammate on their first day." },
    { id: "skills", label: "Skills", glyph: "g-skills", group: "Context for agents", views: [["Skills", "skills"]] },
    { id: "connectors", label: "Connectors", glyph: "g-plug", group: "Context for agents", panes: ["connectors"], about: "Connectors give agents extra tools, like GitHub or a browser. Each one is a program that runs on this PC." },
    { id: "folders", label: "Related folders", glyph: "g-explorer", group: "Context for agents", panes: ["folders"], about: "Extra folders agents may read but never change." },
    { id: "flows", label: "Workflows", glyph: "g-route", group: "Context for agents", views: [["Brain maps", "brains"], ["Playbook", "agent-brain", { tab: "playbook" }], ["Project map", "agent-brain", { tab: "map" }], ["Context", "context"]] },
    { id: "health", label: "Health and usage", glyph: "g-gauge", group: "Monitor", views: [["Recorded calls", "usage", { view: "usage" }], ["Provider accounts", "usage", { view: "tracker" }]] },
    { id: "models", label: "Models", glyph: "g-graph", group: "Monitor", views: [["Catalog", "booklet"], ["Performance", "graph"]] },
    { id: "inspect", label: "Inspect", glyph: "g-eyes", group: "Monitor", views: [["Sessions", "explorer"], ["Activity and evidence", "eyes"], ["Trace", "trace"], ["Overhead", "overhead"], ["Performance profiler", "profiler"], ["Machine status", "explorer", { panel: "diagnostics" }], ["Connection log", "agents", { place: "providers", target: "settings-log" }]] },
  ]);
  // The panes of the classic Agents page, by the place that holds them now.
  const PANE_PLACES = Object.freeze({ overview: "overview", behavior: "overview", connections: "providers", team: "seats", routing: "seats", perms: "perms", rules: "rules", connectors: "connectors", folders: "folders" });
  const teamPlaceById = (id) => TEAM_PLACES.find((place) => place.id === id) ?? null;
  // The place this page shows for a set of parameters: { place } itself, else the pane a target sits in, else the classic
  // { section, pane } (Setup with no pane was Team & models).
  function teamPlaceFromParams(options = {}) {
    if (teamPlaceById(options.place)?.panes) return options.place;
    const holder = options.target ? $(options.target)?.closest?.("[data-agents-pane]")?.dataset?.agentsPane : null;
    if (holder && PANE_PLACES[holder]) return PANE_PLACES[holder];
    if (options.section === "setup") return PANE_PLACES[options.pane] || "seats";
    return PANE_PLACES[options.pane] && options.section !== "overview" ? PANE_PLACES[options.pane] : "overview";
  }
  const brainTabOf = (options) => options?.tab ?? window.MefiAgentBrain?.tab?.() ?? null;
  // The Team place a route is in, or null (the Map's pages, and everything that is not Team's).
  function teamPlaceOf(id, options) {
    if (id === "agents") return options ? teamPlaceFromParams(options) : params.place || teamPlaceFromParams(params);
    for (const place of TEAM_PLACES) for (const [, route, target = {}] of place.views || []) {
      if (route !== id || route === "agents") continue;
      if (route === "agent-brain" && target.tab !== brainTabOf(options)) continue;
      return place.id;
    }
    return null;
  }
  function teamViewCurrent(id, route, target) {
    if (route !== id || route === "agents") return false;
    if (route === "agent-brain") return target.tab === brainTabOf();
    if (route === "usage") return target.view === (window.MefiModelLab?.view?.() === "tracker" ? "tracker" : "usage");
    // Sessions and Machine status are one page (the Explorer); its rows go to its panels, and the page is Sessions.
    if (route === "explorer") return !target.panel;
    return true;
  }
  function openTeamPlace(id) {
    const place = teamPlaceById(id);
    if (!place) return;
    if (place.views) { const [, route, target = {}] = place.views[0]; go(route, target); }
    else go("agents", { place: place.id });
  }
  // The places in order, for a list drawn elsewhere (renderer/shell.js): each with whether you are in it, the way there, and
  // the pages it holds with the one you are on. Null with the layout off.
  function teamPlaces(id = window.MefiNav?.current?.()) {
    if (!teamLayout()) return null;
    const here = teamPlaceOf(id);
    return TEAM_PLACES.map((place) => ({
      id: place.id, label: place.label, glyph: place.glyph, group: place.group ?? null, current: place.id === here, run: () => openTeamPlace(place.id),
      views: (place.views || []).map(([label, route, target = {}]) => ({ label, current: place.id === here && teamViewCurrent(id, route, target), run: () => go(route, target) })),
    }));
  }
  // Where you are in Team ({ id, label }), for the breadcrumb; null outside Team or with the layout off.
  function teamPlace(id = window.MefiNav?.current?.(), options) {
    if (!teamLayout()) return null;
    const place = teamPlaceById(teamPlaceOf(id, options));
    return place ? { id: place.id, label: place.label } : null;
  }
  // The place a control on this page sits in now (Search's words for it), or null.
  function teamPlaceOfElement(element) {
    const pane = element?.closest?.("[data-agents-pane]")?.dataset?.agentsPane;
    const place = teamLayout() && pane ? teamPlaceById(PANE_PLACES[pane]) : null;
    return place ? { id: place.id, label: place.label } : null;
  }

  let closeNavMenu = () => {};
  function paintNav(nav, id, options = {}) {
    const here = location(id, options), signature = JSON.stringify([id, here, window.MefiAgentBrain?.tab?.(), options.view || window.MefiModelLab?.view?.()]);
    if (nav.dataset.agentsSignature === signature && nav.querySelector(".agents-navigation")) return;
    closeNavMenu();
    nav.dataset.agentsSignature = signature;
    nav.querySelector(".agents-navigation")?.remove();
    const root = node("div", "agents-navigation"), main = node("div", "agents-nav-sections");
    main.setAttribute("aria-label", "Agents sections");
    let opened = null, openTimer, closeTimer;
    const cancelTimers = () => { clearTimeout(openTimer); clearTimeout(closeTimer); };
    closeNavMenu = (restoreFocus = false) => {
      cancelTimers();
      if (!opened) return;
      const { item, menu } = opened; opened = null;
      const focusHeld = menu.contains(document.activeElement);
      menu.hidden = true; item.setAttribute("aria-expanded", "false");
      if (restoreFocus || focusHeld) item.focus({ preventScroll: true });
    };
    const reveal = (entry, focus = false) => {
      cancelTimers();
      if (opened !== entry) closeNavMenu();
      opened = entry; entry.menu.hidden = false; entry.item.setAttribute("aria-expanded", "true");
      if (focus) entry.menu.querySelector("button")?.focus({ preventScroll: true });
    };
    const selectedChild = (route, target) => route === id && (route !== "agents" || target.pane === here.pane) && (route !== "agent-brain" || target.tab === window.MefiAgentBrain?.tab?.()) && (route !== "usage" || target.view === (options.view || window.MefiModelLab?.view?.() || "usage"));
    for (const [section, label, route, target] of sections) {
      const group = node("div", "agents-nav-group"), views = children[section];
      let entry;
      const item = button(label, (event) => {
        if (!views) { closeNavMenu(); go(route, target); return; }
        if (opened === entry && event.detail !== 0) closeNavMenu();
        else reveal(entry, event.detail === 0);
      }, "app-local-link");
      item.dataset.agentSection = section; item.setAttribute("aria-current", section === here.section ? "page" : "false"); group.append(item); main.append(group);
      group.addEventListener("pointerenter", (event) => {
        if (event.pointerType === "touch") return;
        cancelTimers();
        openTimer = setTimeout(() => { if (entry) reveal(entry); else closeNavMenu(); }, 100);
      });
      group.addEventListener("pointerleave", (event) => {
        if (event.pointerType === "touch") return;
        cancelTimers(); closeTimer = setTimeout(() => closeNavMenu(), 220);
      });
      if (!views) continue;
      const menu = node("div", "agents-nav-subsections");
      menu.id = `agents-menu-${section}`; menu.hidden = true; menu.setAttribute("role", "group"); menu.setAttribute("aria-label", `${label} views`);
      item.setAttribute("aria-expanded", "false"); item.setAttribute("aria-controls", menu.id);
      item.append(node("span", "agents-nav-chevron", "⌄"));
      entry = { item, menu };
      for (const [childLabel, childRoute, childTarget = {}] of views) {
        const child = button(childLabel, () => { closeNavMenu(true); go(childRoute, childTarget); }, "app-local-link");
        child.setAttribute("aria-current", selectedChild(childRoute, childTarget) ? "page" : "false"); menu.append(child);
      }
      item.addEventListener("keydown", (event) => {
        if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation(); reveal(entry);
        (event.key === "ArrowUp" ? menu.lastElementChild : menu.firstElementChild)?.focus();
      });
      menu.addEventListener("keydown", (event) => {
        const keys = ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"];
        if (!keys.includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
          const parents = Array.from(main.querySelectorAll("[data-agent-section]")), at = parents.indexOf(item);
          closeNavMenu(); parents[(at + (event.key === "ArrowRight" ? 1 : -1) + parents.length) % parents.length]?.focus(); return;
        }
        const buttons = Array.from(menu.children), at = buttons.indexOf(document.activeElement);
        buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (at + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      });
      group.addEventListener("focusin", () => clearTimeout(closeTimer));
      group.addEventListener("focusout", (event) => { if (!group.contains(event.relatedTarget)) closeNavMenu(); });
      group.append(menu);
    }
    const compact = node("select"); compact.setAttribute("aria-label", "Agents section"); compact.className = "agents-section-picker";
    for (const [section, label] of sections) { const option = node("option", "", label); option.value = section; compact.append(option); }
    compact.value = here.section; compact.addEventListener("change", () => { const choice = sections.find((item) => item[0] === compact.value); if (choice) go(choice[2], choice[3]); });
    root.append(main, compact);
    const currentViews = children[here.section] || [];
    if (currentViews.length) {
      const pick = node("select"); pick.className = "agents-subsection-picker"; pick.setAttribute("aria-label", "Agents view");
      for (const [index, [label, route, target = {}]] of currentViews.entries()) { const option = node("option", "", label); option.value = String(index); option.selected = selectedChild(route, target); pick.append(option); }
      pick.addEventListener("change", () => { const choice = currentViews[Number(pick.value)]; if (choice) go(choice[1], choice[2]); });
      root.append(pick);
    }
    nav.append(root); window.MefiScroll?.scan(root);
  }
  const aliases = { connections: "connections", providers: "connections", "auto-setup": "connections", "settings-setup": "connections", "settings-assistant": "connections", "decision-model": "connections", "settings-jev": "connections", models: "routing", "model-routing": "routing", "settings-routing": "routing", "coding-workers": "routing", "settings-workers": "routing", automation: "behavior", "agents-queue": "behavior", "settings-automation": "behavior", "settings-automation-behavior": "behavior", "connection-log": "connections", "settings-log": "connections" };
  function redirect(id, options = {}) {
    if (id === "agent-brain" && options.tab === "seats") return { id: "agents", params: { section: "setup", pane: "team" } };
    // go("agents", { place }) for a place that is pages of its own (Skills, Models, ...) opens its first page.
    if (id === "agents" && teamPlaceById(options.place)?.views) { const [, route, target = {}] = teamPlaceById(options.place).views[0]; return { id: route, params: { ...target } }; }
    if (id !== "studio") return null;
    const target = options.section || options.category || "";
    const pane = aliases[target] || $(target)?.closest?.("[data-agents-pane]")?.dataset.agentsPane;
    return pane ? { id: "agents", params: { section: "setup", pane, target } } : null;
  }
  function move(id, pane) {
    const el = $(id), target = $(`agents-${pane}`);
    if (!el || !target) return;
    el.removeAttribute("data-settings-category-pane"); el.hidden = false; el.dataset.agentsPane = pane;
    target.append(el);
  }
  function mount() {
    if (mounted) return;
    mounted = true;
    window.MefiBooklet?.initStudio?.();
    const overlay = node("div", "overlay agents-overlay"); overlay.id = "agents-overlay"; overlay.hidden = true;
    const sheet = node("section", "sheet agents-sheet"); sheet.tabIndex = -1; sheet.setAttribute("role", "region"); sheet.setAttribute("aria-label", "Agents workspace");
    const head = node("header", "agents-head");
    const title = node("div"); title.append(node("p", "agents-eyebrow", "YOUR STUDIO / AGENTS")); const h = node("h1", "", "Agents"); h.id = "agents-title"; title.append(h, node("p", "muted", "One team, one place to set it up and follow its work."));
    const settings = button("Studio appearance", () => go("studio", { category: "appearance" }), "ghost mini");
    const headActions = node("div", "agents-head-actions"); headActions.append(button("Reload saved settings", discard, "ghost mini"), settings);
    head.append(title, headActions); sheet.append(head);
    const body = node("div", "agents-body"); body.id = "agents-body";
    for (const name of ["overview", "connections", "team", "routing", "behavior"]) { const pane = node("div", "agents-pane"); pane.id = `agents-${name}`; pane.dataset.agentsPane = name; pane.hidden = true; body.append(pane); }
    sheet.append(body);
    const foot = node("footer", "agents-save-bar"); foot.id = "agents-save-bar";
    const status = node("p", "", "Saved settings"); status.id = "agents-save-status"; status.setAttribute("role", "status");
    foot.append(status, risky("Discard draft", discard, "Discard your edits?", "ghost mini"), button("Apply changes", () => save("save"), "primary")); sheet.append(foot);
    overlay.append(sheet); document.body.append(overlay);
    move("settings-category-connections", "connections"); move("settings-log", "connections");
    move("settings-routing", "routing"); move("settings-workers", "routing");
    const skills = node("div"); skills.id = "agents-model-skills"; $("agents-routing").append(skills); window.MefiAutonomy?.skills(skills);
    move("settings-automation", "behavior"); move("settings-automation-behavior", "behavior");
    for (const category of ["connections", "models", "automation"]) { document.querySelector(`[data-settings-category="${category}"]`)?.remove(); if (category !== "connections") $(`settings-category-${category}`)?.remove(); }
    $("settings-category-connections")?.querySelector(".settings-category-head")?.remove();
    $("agents-connections").prepend(node("p", "agents-scope-note", "Device-wide connections · Keys stay encrypted on this machine. Teams reference these connections."));
    // All routes into these controls resolve here, including older saved tours.
    for (const pane of body.querySelectorAll("[data-agents-pane]")) for (const el of pane.querySelectorAll("input[id], select[id], button[id], details[id]")) {
      // A plain button (Run auto setup, Save) is named by its own words, so Search does not keep the name Settings gave
      // it before the card moved here.
      const label = el.getAttribute("aria-label") || el.closest("label")?.querySelector(".field-label, b")?.textContent || (el.querySelector("summary b, summary strong") || el.querySelector("summary"))?.textContent || el.title || (el.tagName === "BUTTON" ? el.textContent.replace(/\s+/g, " ").trim() : "");
      const help = (el.closest("label")?.querySelector("small") || el.querySelector("summary small, summary .settings-summary-text > span"))?.textContent?.trim() || "";
      // In the 0.5 layout Search names the control by the Team place that holds it now (read when Search reads it).
      const words = label?.trim().slice(0, 100);
      if (label) window.MefiNav?.register({ id: `settings:${el.id}`, kind: "action", section: "agents", group: "tools", get label() { const place = teamPlaceOfElement(el); return place ? `Team › ${place.label} › ${words}` : `Agents › ${words}`; }, desc: help.slice(0, 160), glyph: "g-agents", showIn: { palette: true }, run: () => go("agents", { section: "setup", pane: pane.dataset.agentsPane, target: el.id }) });
    }
    $("agents-team").append(buildRules());
    buildSetupHeader(); buildOverview(); buildRoles(); buildBehavior();
    $("agents-connections").append(button("Continue to Team →", () => go("agents", { section: "setup", pane: "team" }), "primary"));
    $("agents-team").append(button("Continue to Workflow →", () => go("agents", { section: "setup", pane: "behavior" }), "ghost"));
    $("agents-behavior").append(button("Review readiness →", () => go("agents", { section: "overview" }), "ghost"));
    $("settings-agent-mode")?.closest("label")?.setAttribute("hidden", "");
    document.querySelector("[data-brain-tab=seats]")?.setAttribute("hidden", "");
    for (const selector of [".ws-queue-controls", ".ws-queue-settings", "#workspace-queue-details"]) for (const el of document.querySelectorAll(selector)) el.hidden = true;
    // Command's toolbar keeps the immediate queue controls. Team drafts,
    // provider connections and advanced routing stay in this workspace.
    window.MefiScroll?.scan(overlay);
  }
  function buildSetupHeader() {
    const header = node("div", "agents-team-toolbar"); header.id = "agents-team-toolbar";
    const label = node("label", "agents-scope"); label.append(node("span", "", "Editing"));
    const select = node("select"); select.id = "agents-scope";
    for (const [value, text] of [["project", "This project"], ["defaults", "Studio defaults"]]) { const option = node("option", "", text); option.value = value; select.append(option); }
    select.addEventListener("change", () => { scope = select.value; load(); }); label.append(select);
    const name = node("input"); name.id = "agents-team-name"; name.type = "text"; name.maxLength = 80; name.placeholder = "Team name"; name.setAttribute("aria-label", "Team name"); name.addEventListener("input", () => { if (draft()) { draft().name = name.value; dirty(); } });
    // Dropping the project's own team drops its rules with it: with rules to lose, it asks twice.
    header.append(label, name, riskyIf("Use Studio defaults", rulesAtRisk, () => save("inherit"), "Drop this team and its rules?", "ghost mini"));
    $("agents-body").prepend(header);
    const presets = card("Saved teams", "Apply a preset as an independent project copy. Changes here never alter another project."); presets.id = "agents-presets";
    const picker = node("select"); picker.id = "agents-preset-picker"; picker.setAttribute("aria-label", "Saved team preset");
    const actions = node("div", "agents-actions");
    actions.append(picker, button("Use in draft", () => {
      const chosen = draft()?.saved.presets.find((item) => item.id === picker.value); if (!chosen) return;
      // A saved team is a team, not a project's words: the draft keeps the rules it has.
      const kept = draft().configuration.agentRules;
      draft().configuration = clone(chosen.configuration); if (kept) draft().configuration.agentRules = kept;
      draft().name = chosen.name; $("agents-team-name").value = chosen.name; dirty(); renderConfiguration();
      window.dispatchEvent(new CustomEvent("mefi:agent-draft"));
    }), button("Save as new preset", () => save("preset-save")), button("Update selected preset", () => save("preset-save", picker.value)), risky("Delete preset", () => save("preset-delete", picker.value), "Delete this preset?"));
    presets.append(actions); const saved = node("details", "agents-saved-teams"); saved.append(node("summary", "", "Saved teams & presets"), presets); $("agents-team").append(saved);
  }
  function buildOverview() {
    const root = $("agents-overview"), cards = node("div", "agents-overview-grid");
    const team = card("Your team", "Choose who answers, who builds, and how they work together.");
    const summary = node("p", "agents-team-summary"); summary.id = "agents-team-summary";
    team.append(summary, button("Set up team", () => go("agents", { section: "setup", pane: "team" }), "primary"));
    const ready = card("Ready to work", "Connect → Team → Workflow → Ready");
    const status = node("p"); status.id = "agents-ready"; ready.append(status, button("Check connections", () => go("agents", { section: "setup", pane: "connections" })));
    const operations = card("Studio controls", "Queue controls apply across projects. Pausing leaves current jobs to finish.");
    for (const [key, title] of [["newWork", "Allow new work"], ["enabled", "Run the queue"]]) operations.append(queueToggle(key, title));
    const permissions = node("div"); permissions.id = "agents-autonomy"; operations.append(permissions); window.MefiAutonomy?.mount(permissions);
    operations.append(button("Follow live work", () => go("command")));
    cards.append(team, ready, operations); root.append(cards);
    const flow = card("From your idea to verified work", "Work is reported back to the Studio assistant, with its evidence and anything that needs you.");
    const steps = node("div", "agents-flow");
    for (const [title, route, target] of [["Task intake", "tasks"], ["Model routing", "agents", { section: "setup", pane: "routing" }], ["Lead & workers", "agent-brain", { tab: "live" }], ["Verification", "eyes"], ["Assistant report", "workspace"]]) steps.append(button(title, () => go(route, target), "ghost"));
    flow.append(steps); root.append(flow);
    const live = card("What needs you", "Live status and decisions from the assistant."); live.id = "agents-overview-live"; root.append(live);
    const hub = card("Team work hub", "Agents share work state and messages here while they build."); hub.id = "agents-work-hub"; root.append(hub);
  }
  // Status pushes arrive about twice a second; the live cards repaint only
  // while the sheet is open, and only when what they show has changed.
  let overviewPainted = null, overviewSignature = "";
  function paintOverview() {
    const root = $("agents-overview-live"); if (!root || $("agents-overlay")?.hidden !== false) return;
    const questions = (liveAssistant?.questions || []).filter((item) => item.status === "open");
    const running = (liveStatus?.running || []).filter((item) => !item.finished);
    const signature = JSON.stringify([questions.map((item) => item.title), running.map((run) => [run.title, run.phase, run.taskId]), (liveAssistant?.agents || []).map((agent) => [agent.role, agent.status, agent.step]), (liveAssistant?.mail || []).slice(-8).map((item) => [item.from, item.to, item.text]), queue.known, Boolean($("agents-work-hub"))]);
    if (overviewPainted === root && overviewSignature === signature) return;
    overviewPainted = root; overviewSignature = signature;
    while (root.children.length > 2) root.lastChild.remove();
    const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
    root.append(node("p", "agents-effective", `${running.length} running · ${count(questions.length, "decision")} needed`));
    for (const question of questions) root.append(button(question.title || "Decision needed", () => window.MefiCompanion?.open(), "ghost"));
    const hub = $("agents-work-hub"); if (!hub) return;
    while (hub.children.length > 2) hub.lastChild.remove();
    const agents = liveAssistant?.agents || [], mail = liveAssistant?.mail || [];
    hub.append(node("p", "agents-effective", `${count(agents.filter((agent) => agent.status === "running").length, "active agent")} · ${count(running.length, "build")}`));
    for (const agent of agents) hub.append(node("p", "agents-hub-line", `${agent.role || "Agent"} · ${agent.status || "idle"}${agent.step ? ` · ${agent.step}` : ""}`));
    for (const item of mail.slice(-8).reverse()) hub.append(node("p", "agents-hub-line", `${item.from || "agent"} → ${item.to || "team"}: ${item.text || ""}`));
    hub.append(button("Open live pipelines", () => go("agent-brain", { tab: "live" }), "ghost"));
    for (const run of running.slice(0, 6)) root.append(button(`${run.title || "Current task"} · ${run.phase || "working"}`, () => go("command", { taskId: run.taskId }), "ghost"));
    if (!running.length && !questions.length) root.append(node("p", "muted", queue.known ? "All quiet. Set up your team, then choose when to begin." : "Waiting for the studio status…"));
  }
  function queueToggle(key, title) {
    const row = node("label", "settings-control"), text = node("span", "", title), input = node("input"); input.type = "checkbox"; input.setAttribute("role", "switch"); input.dataset.agentQueue = key;
    input.addEventListener("change", async () => { input.disabled = true; try { await setQueue(key, input.checked); } catch (error) { window.MefiToast?.(plain(error, "The queue setting was not saved."), "bad"); } finally { syncQueue(); } }); row.append(text, input); return row;
  }
  function syncQueue() {
    for (const input of document.querySelectorAll("[data-agent-queue]")) { const key = input.dataset.agentQueue; input.checked = Boolean(queue[key]); input.disabled = !(key === "newWork" || key === "proactive" ? queue.newWorkKnown : queue.known); }
  }
  function field(title, control, note) { const row = node("label", "studio-field"); const words = node("span"); words.append(node("strong", "", title)); if (note) words.append(node("small", "muted", note)); row.append(words, control); return row; }
  function selectOptions(items, value, label, change) {
    const el = node("select"); el.setAttribute("aria-label", label);
    for (const [id, title] of items) { const option = node("option", "", title); option.value = id; el.append(option); }
    el.value = value; el.addEventListener("change", () => change(el.value)); return el;
  }
  function dirty() { if (!draft()) return; draft().dirty = true; say("Draft · applies to new work after you choose Apply."); $("agents-save-bar")?.setAttribute("data-dirty", "true"); }
  function buildRoles() {
    const intro = node("div", "agents-team-intro"); intro.append(node("h2", "", "A model for every role"), node("p", "muted", "Choose a provider in the corner of each agent. Use + to add skills or tools."));
    const roles = node("div", "agents-role-grid"); roles.id = "agents-role-grid"; $("agents-team").prepend(intro, roles);
  }
  const providerNames = { auto: "Automatic", zai: "z.ai", opencode: "OpenCode Go", zen: "OpenCode Zen", openrouter: "OpenRouter", claude: "Claude Code", codex: "Codex", grok: "Grok", antigravity: "Antigravity", lmstudio: "LM Studio", custom: "Custom endpoint" };
  const cliIds = ["opencode", "claude", "codex", "grok", "antigravity"];
  let openrouterCatalog = null, catalogRead = null;
  const providerCatalogs = new Map(), providerReads = new Map();
  async function loadProviderModels(provider, refresh = false) {
    if (provider === "openrouter") { if (refresh) openrouterCatalog = null; return loadOpenRouter(); }
    if (!["zen", "opencode", "zai", "lmstudio", "custom"].includes(provider) || !api()?.agentModels) return;
    if (providerReads.has(provider) || !refresh && providerCatalogs.has(provider)) return;
    const key = draftKey();
    const pending = api().agentModels(provider).then((result) => {
      if (result?.ok) providerCatalogs.set(provider, result.models || []);
      if (key !== draftKey() || $("agents-overlay")?.hidden) return;
      if (result?.ok) for (const select of document.querySelectorAll(`.agents-model-select[data-provider="${provider}"]`)) populateModels(select, provider, select.value, select.dataset.builder === "true");
      else say(result?.error || "Could not load models. You can still enter a model ID.", true);
    }).catch(() => { if (key === draftKey()) say("Could not load models. You can still enter a model ID.", true); }).finally(() => providerReads.delete(provider));
    providerReads.set(provider, pending); return pending;
  }
  function providerIcon(provider) {
    const icon = node("span", "agents-provider-icon"); icon.dataset.provider = provider; icon.setAttribute("aria-hidden", "true");
    const paths = {
      auto: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',
      openrouter: '<path d="M3 12h7m-2 0 7-7h6m-6 0 3-3m-3 3 3 3M8 12l7 7h6m-6 0 3-3m-3 3 3 3"/>',
      zen: '<circle cx="12" cy="12" r="8"/><path d="M6 12h12M8 8h8m-8 8h8"/>',
      opencode: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"/>',
      claude: '<path d="M12 2v20M2 12h20M5 5l14 14M5 19 19 5M8 3l8 18M3 8l18 8M3 16l18-8M8 21l8-18"/>',
      codex: '<path d="m7 4-5 8 5 8h10l5-8-5-8Zm0 0 10 16M2 12h20M17 4 7 20"/>',
      grok: '<path d="m5 20 14-16M8 5a8 8 0 1 0 11 11M12 12h8"/>',
      antigravity: '<path d="m3 20 9-16 9 16-9-5Z"/>',
      lmstudio: '<rect x="3" y="4" width="18" height="13" rx="3"/><path d="M8 21h8m-4-4v4M7 10h2m2 0h2m2 0h2"/>',
      custom: '<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16"/>',
      zai: '<path d="M4 5h16L4 19h16M8 12h8"/>',
    };
    icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths[provider] || paths.custom}</svg>`;
    return icon;
  }
  function providerNote(provider, saved) {
    // The custom endpoint is connected by its URL; its key is optional.
    if (provider === "custom") return saved.routing?.customEndpoint ? (saved.routing?.hasCustom ? "Key saved" : "Endpoint saved") : "Needs connection";
    const key = { zai: "hasZai", opencode: "hasOpenCode", zen: "hasZen", openrouter: "hasOpenRouter" }[provider];
    if (key) return saved.routing?.[key] ? "Key saved" : "Needs connection";
    return provider === "auto" ? "Follow routing" : provider === "lmstudio" ? "Local server" : "CLI login";
  }
  function refreshRows(focusId) {
    renderConfiguration(); window.dispatchEvent(new CustomEvent("mefi:agent-draft"));
    if (focusId) $(focusId)?.focus({ preventScroll: true });
  }
  async function loadOpenRouter() {
    if (openrouterCatalog || catalogRead || !api()?.openrouterModels) return;
    const key = draftKey();
    catalogRead = api().openrouterModels().then((result) => {
      if (Array.isArray(result?.models)) openrouterCatalog = result.models;
      if (result?.ok === false && key === draftKey()) say(result.error || "Could not load OpenRouter models. You can still enter a model ID.", true);
    }).catch(() => { if (key === draftKey()) say("Could not load OpenRouter models. You can still enter a model ID.", true); }).finally(() => {
      catalogRead = null;
      if (key === draftKey() && $("agents-overlay")?.hidden === false) {
        // Update only the options, preserving focus and any typed custom ID.
        for (const select of document.querySelectorAll('.agents-model-select[data-provider="openrouter"]')) populateModels(select, "openrouter", select.value, false);
      }
    });
    return catalogRead;
  }
  function modelChoices(provider, builder) {
    let baked = []; try { baked = JSON.parse($("booklet-data").textContent).models || []; } catch {}
    const ids = provider === "zen" ? ["gpt-6-luna", "gpt-6.1-sol", "gpt-6-sol"] : provider === "zai" ? ["glm-5.3-flash", "glm-5.3"] : [];
    const rows = ids.map((id) => ({ id, name: id }));
    if (provider === "opencode") rows.push(...baked.filter((entry) => entry.onRoster).map((entry) => ({ id: builder ? `opencode/${entry.id}` : entry.id, name: entry.name })));
    if (provider === "openrouter") rows.push({ id: "openrouter/free", name: "Free models · automatic" }, ...(openrouterCatalog || []));
    rows.push(...(providerCatalogs.get(provider) || []).map((row) => ({ ...row, id: builder && provider === "opencode" ? `opencode/${row.id}` : row.id })));
    return [...new Map(rows.map((row) => [row.id, row])).values()];
  }
  function populateModels(select, provider, value, builder) {
    const choices = modelChoices(provider, builder);
    if (value && value !== "__custom" && !choices.some((entry) => entry.id === value)) choices.unshift({ id: value, name: value });
    select.replaceChildren();
    for (const [id, text] of [["", provider === "auto" ? "Follow configured route" : "Provider default"], ...choices.map((row) => [row.id, row.name || row.id]), ["__custom", "Enter a model ID…"]]) {
      const option = node("option", "", text); option.value = id; select.append(option);
    }
    select.value = value; window.MefiSelect?.refresh?.();
  }
  function addonPanel(id, title, provider, config, saved) {
    const panel = node("div", "agents-addons"); panel.id = `agent-${id}-addons`; panel.hidden = true;
    panel.append(node("h4", "", `Skills, tools & habits · ${title}`));
    const list = node("div", "agents-skill-list"), selected = config.agentSkills?.[id] || [];
    for (const skill of saved.skills || []) {
      const input = node("input"); input.type = "checkbox"; input.checked = selected.includes(skill.id);
      input.addEventListener("change", () => {
        const previous = config.agentSkills?.[id] || [], next = input.checked ? [...previous, skill.id] : previous.filter((key) => key !== skill.id);
        if (next.length > 8) { input.checked = false; say("Choose up to eight skills per agent.", true); return; }
        config.agentSkills = { ...config.agentSkills, [id]: next }; dirty();
        $( `agent-${id}-add`).dataset.count = String(next.length);
      });
      list.append(field(skill.name, input, `${skill.scope} skill`));
    }
    for (const missing of selected.filter((key) => !(saved.skills || []).some((skill) => skill.id === key))) list.append(button("Remove unavailable skill", () => { config.agentSkills[id] = config.agentSkills[id].filter((key) => key !== missing); dirty(); refreshRows(`agent-${id}-add`); }, "ghost mini"));
    if (!(saved.skills || []).length) list.append(node("p", "muted", "No installed skills found. Add a SKILL.md folder under .agents/skills, .claude/skills, .codex/skills or .opencode/skills, then reload saved settings."));
    panel.append(list, node("h4", "", "Allowed Studio tools"));
    // Codex takes Studio's tool server as config overrides; Grok and
    // Antigravity have no per-run MCP config (executorCore.cliInvocation).
    const supportedTools = id !== "builder" || ["opencode", "claude", "codex"].includes(provider);
    const permissions = config.agentTools?.[id] || {};
    const setPermission = (key, value) => { config.agentTools = { ...config.agentTools, [id]: { ...config.agentTools?.[id], [key]: value } }; dirty(); };
    const boxes = {};
    for (const [key, label, detail, enabled] of [
      ["webSearch", "Search the web", "Search queries leave this device. Answers can cite returned source links. Bing search is built in; BRAVE_SEARCH_API_KEY enables Brave.", permissions.webSearch !== false],
      ["webRead", "Read web pages you link", "Pages you name, or that the agent finds by searching, are fetched from this computer. Local and private network addresses are refused, and page text is read as data, never as instructions.", permissions.webRead ?? permissions.webSearch !== false],
      ["projectRead", "Read project files", id === "builder" ? "Read small text files within this project. The coding tool has its own file listing and search. Hidden files, credentials and local app data are excluded." : "Read small text files, list folders and search the text files inside this project. Hidden files, credentials and local app data are excluded.", permissions.projectRead === true],
    ]) {
      const input = boxes[key] = node("input"); input.id = `agent-${id}-tool-${key}`; input.type = "checkbox"; input.checked = enabled; input.disabled = !supportedTools;
      // An unset webRead follows webSearch (agentTools.policy).
      input.addEventListener("change", () => { setPermission(key, input.checked); if (key === "webSearch" && config.agentTools[id].webRead === undefined) boxes.webRead.checked = input.checked; });
      panel.append(field(label, input, detail));
    }
    panel.append(node("h4", "", "MCP tool allowlist"));
    for (const tool of saved.mcpTools || []) {
      const input = node("input"); input.dataset.mcpTool = tool.id; input.type = "checkbox"; input.checked = (permissions.mcpTools || []).includes(tool.id); input.disabled = !supportedTools;
      input.addEventListener("change", () => {
        const previous = config.agentTools?.[id]?.mcpTools || [];
        const next = input.checked ? [...previous, tool.id] : previous.filter((key) => key !== tool.id);
        if (next.length > 16) { input.checked = false; say("Choose up to sixteen MCP tools per agent.", true); return; }
        setPermission("mcpTools", next);
      });
      panel.append(field(`${tool.server} · ${tool.name}`, input, tool.description));
    }
    for (const missing of (permissions.mcpTools || []).filter((key) => !(saved.mcpTools || []).some((tool) => tool.id === key))) panel.append(button(`Remove unavailable tool: ${missing}`, () => { setPermission("mcpTools", (config.agentTools[id].mcpTools || []).filter((key) => key !== missing)); refreshRows(`agent-${id}-add`); }, "ghost mini"));
    panel.append(node("p", "muted", "Configure trusted stdio servers and their tools in ~/.mefi-studio/mcp.json, then reload saved settings. Selecting an MCP tool allows that server to run for this agent; it may read or change data using its own credentials."));
    if (id === "builder") {
      const supported = ["opencode", "claude"].includes(provider), input = node("input"); input.id = "agent-builder-desk-tool"; input.type = "checkbox"; input.checked = config.agentBrain?.deskTool === true; input.disabled = !supported;
      input.addEventListener("change", () => { config.agentBrain = { ...config.agentBrain, deskTool: input.checked }; dirty(); });
      panel.append(field("Studio desk · ask_desk", input, supported ? "Give this coding worker an MCP tool for help from the desk agent." : "Available with OpenCode and Claude Code workers."));
      panel.append(node("p", "muted", supportedTools ? "Studio search and selected MCP tools attach to this worker. The coding CLI also has its own tools and runs with automatic approval and broad file/command access. These checkboxes limit Studio tools only; manage native tools and MCP servers in the CLI configuration." : "Studio tool attachment supports OpenCode, Claude Code and Codex. This worker uses its CLI's native search, tools and permissions; it runs with broad file/command access."));
    } else panel.append(node("p", "muted", "Studio enforces these tool choices for every turn. File writes and shell commands are unavailable unless you explicitly select an MCP tool that provides them. Skills guide answers and never grant tool permissions."));
    panel.append(habitsPanel(id, config, saved));
    return panel;
  }
  // Habits (scripts/habits.cjs): short rules of behaviour for this agent, each
  // with its variants and off / brief / full, and what it adds to every prompt.
  function habitsPanel(id, config, saved) {
    const box = node("section", "agents-habits"); box.id = `agent-${id}-habits`;
    const library = Array.isArray(saved.habits) ? saved.habits : [];
    const heading = node("h4", "", "Habits");
    const totalNote = node("p", "muted agents-habits-total");
    box.append(heading, totalNote);
    const chosen = () => config.agentHabits?.[id] || {};
    const paintTotal = () => {
      let sum = 0;
      for (const habit of library) { const pick = chosen()[habit.id]; if (pick && pick.mode !== "off") sum += habit.costs?.[pick.variant]?.[pick.mode] || 0; }
      if (!sum) { totalNote.removeAttribute?.("aria-label"); totalNote.textContent = "No habit is on for this agent."; return; }
      // The number counts to its new value (renderer/motion.js); a screen
      // reader gets the settled sentence at once.
      totalNote.setAttribute("aria-label", `These habits add about ${sum} tokens to each of this agent's prompts.`);
      let count = totalNote.querySelector?.(".agents-habits-sum");
      if (!count) { count = node("b", "agents-habits-sum"); totalNote.replaceChildren("These habits add about ", count, " tokens to each of this agent's prompts."); }
      if (window.MefiMotion?.tally) window.MefiMotion.tally(count, sum);
      else count.textContent = String(sum);
    };
    const set = (habitId, patch) => {
      const current = chosen()[habitId] || { variant: library.find((habit) => habit.id === habitId)?.fallback, mode: "off" };
      config.agentHabits = { ...config.agentHabits, [id]: { ...chosen(), [habitId]: { ...current, ...patch } } };
      dirty(); paintTotal();
    };
    for (const habit of library) {
      const row = node("div", "agents-habit"); row.dataset.habit = habit.id;
      const pick = chosen()[habit.id] || { variant: habit.fallback, mode: "off" };
      const words = node("span", "agents-habit-words");
      words.append(node("strong", "", habit.title), node("small", "muted", `Fires ${habit.fires}.`));
      const variants = selectOptions(habit.variants.map((variant) => [variant.id, variant.id]), pick.variant, `${habit.title}: variant`, (value) => { set(habit.id, { variant: value }); paintCosts(); rule.textContent = habit.variants.find((variant) => variant.id === value)?.text || ""; });
      const modes = node("div", "agents-habit-modes"); modes.setAttribute("role", "radiogroup"); modes.setAttribute("aria-label", `${habit.title}: off, brief or full`);
      // One thumb slides under the chosen mode (agents.css reads --seg).
      const mark = (mode) => { modes.dataset.mode = mode; modes.style?.setProperty?.("--seg", String(["off", "brief", "full"].indexOf(mode))); row.dataset.on = String(mode !== "off"); };
      const buttons = ["off", "brief", "full"].map((mode) => {
        const choice = node("button", "agents-habit-mode", mode); choice.type = "button"; choice.dataset.mode = mode; choice.setAttribute("role", "radio");
        choice.setAttribute("aria-checked", String(pick.mode === mode));
        choice.addEventListener("click", () => { set(habit.id, { mode }); mark(mode); for (const other of buttons) other.setAttribute("aria-checked", String(other === choice)); });
        modes.append(choice); return choice;
      });
      mark(pick.mode || "off");
      const paintCosts = () => { const costs = habit.costs?.[variants.value] || {}; for (const choice of buttons) choice.title = choice.dataset.mode === "off" ? "Not in the prompt" : `About ${costs[choice.dataset.mode] || 0} tokens`; };
      paintCosts();
      const rule = node("p", "muted agents-habit-rule", habit.variants.find((variant) => variant.id === pick.variant)?.text || "");
      row.append(words, variants, modes, rule);
      box.append(row);
    }
    if (!library.length) box.append(node("p", "muted", "Habits load with the saved settings."));
    paintTotal();
    return box;
  }
  // ---- rules card ----
  // Project rules (scripts/agent-rules.cjs): standing rules the owner writes for
  // this project's agents, and two switches that also send its AGENTS.md and
  // CLAUDE.md. The card is part of the team but saves on its own (agents:save,
  // action "rules"), with its own Save and Discard, so writing a paragraph does not
  // apply the rest of a half-edited team. Its working copy is `item.rules`; the
  // saved one is what the host last returned. The rules are counted as the prompt
  // counts them: the section headings plus the text, four characters a token.
  const RULES_LIMIT = 4000;
  const rulesSavedOf = (item) => { const saved = item?.saved?.configuration?.agentRules; return { text: typeof saved?.text === "string" ? saved.text : "", agents: saved?.agents === true, claude: saved?.claude === true }; };
  const rulesOf = (item) => (item.rules ||= rulesSavedOf(item));
  const rulesChanged = (item) => { if (!item?.rules) return false; const saved = rulesSavedOf(item); return item.rules.text !== saved.text || item.rules.agents !== saved.agents || item.rules.claude !== saved.claude; };
  const rulesInfoOf = (item) => item?.saved?.rulesInfo || {};
  const rulesTokens = (chars) => Math.ceil(chars / 4);
  // What the working rules add to each request from Studio's own models. A CLAUDE.md
  // that repeats AGENTS.md counts once (the host sends it once).
  function rulesCost(item) {
    const info = rulesInfoOf(item), over = info.overhead || {}, files = info.files || {}, rules = rulesOf(item);
    const own = rules.text.replace(/\s+$/, "");
    let chars = own ? (over.text || 0) + own.length : 0;
    if (rules.agents && files.agents?.used) chars += (over.agents || 0) + files.agents.used;
    if (rules.claude && files.claude?.used && !(files.claude.same && rules.agents)) chars += (over.claude || 0) + files.claude.used;
    return { chars, tokens: rulesTokens(chars) };
  }
  const rulesKb = (bytes) => bytes < 1024 ? `${bytes} bytes` : `${(bytes / 1024).toFixed(1)} KB`;
  function rulesFileNote(item, key) {
    const info = rulesInfoOf(item), file = info.files?.[key];
    if (!info.files) return "Read from each project's own folder";
    if (!file) return " ";
    if (!file.found) return `Not in this project's folder · ${file.note}`;
    if (file.problem === "outside") return "A link that leaves the project: not read";
    if (file.problem === "binary") return "Not a text file: not read";
    if (file.problem) return "Could not be read";
    if (file.same) return `Same text as AGENTS.md · sent once · about ${rulesTokens(file.used)} tokens`;
    return `${rulesKb(file.bytes)} · about ${rulesTokens(file.used)} tokens${file.capped ? ` · only the first ${(info.fileCap || 8000).toLocaleString("en-US")} characters are sent` : ""} · ${file.note}`;
  }
  // "Use Studio defaults" replaces the project's own team, its rules included: true while there are rules (saved or typed) to lose.
  function rulesAtRisk() {
    const item = draft(); if (!item || scope !== "project" || item.saved.inherited) return false;
    const saved = rulesSavedOf(item), working = item.rules || saved;
    return Boolean(saved.text || saved.agents || saved.claude || working.text);
  }
  const rulesUi = {};
  function buildRules() {
    const box = card("Rules", "Standing rules every model on this project reads. Write what you would tell a new teammate on their first day."); box.id = "agents-rules"; box.classList.add("agents-rules");
    const state = node("p", "agents-rules-state muted"); state.id = "agents-rules-state"; state.setAttribute("role", "status");
    const scopeNote = node("p", "agents-rules-scope muted"); scopeNote.id = "agents-rules-scope"; scopeNote.hidden = true;
    const area = node("textarea", "agents-rules-text"); area.id = "agents-rules-text"; area.rows = 8; area.spellcheck = true; area.setAttribute("aria-label", "Project rules"); area.placeholder = "One rule per line…";
    // No maxlength: a paste would be cut silently. Over the limit is said in words, and Save waits.
    area.addEventListener("input", () => { const item = draft(); if (!item) return; rulesUi.flash = null; rulesOf(item).text = area.value; paintRulesLive(item); });
    const count = node("div", "agents-rules-count"), chars = node("span"), tokens = node("span"); count.append(chars, tokens);
    const warn = node("div", "agents-rules-warn"); warn.id = "agents-rules-warn"; warn.setAttribute("role", "alert"); warn.hidden = true;
    warn.append(node("strong", "", "Too long to save"), node("span", "", "Nothing was cut. Trim it, or move the detail into AGENTS.md and switch that file on below."));
    const files = node("div", "agents-rules-files"); files.append(node("h4", "", "Also read these files"));
    const switches = {};
    for (const [key, name] of [["agents", "AGENTS.md"], ["claude", "CLAUDE.md"]]) {
      const input = node("input"); input.type = "checkbox"; input.id = `agents-rules-${key}`; input.setAttribute("role", "switch"); input.setAttribute("aria-label", `Also read ${name}`);
      input.addEventListener("change", () => { const item = draft(); if (!item) return; rulesUi.flash = null; rulesOf(item)[key] = input.checked; paintRulesLive(item); });
      const row = field(name, input, " "); row.classList.add("agents-rules-file"); row.dataset.file = key;
      switches[key] = { input, note: row.querySelector("small"), row }; files.append(row);
    }
    const total = node("p", "agents-rules-total"); total.id = "agents-rules-total"; const sum = node("b", ""); total.append(node("span", "", "Added to each request from Studio's models"), sum);
    const save = button("Save rules", () => void saveRules(), "primary"); save.id = "agents-rules-save";
    // Throwing typed text away asks twice, like the rest of this page.
    const discard = risky("Discard", () => discardRules(), "Discard your rules edits?"); discard.id = "agents-rules-discard";
    const actions = node("div", "agents-actions agents-rules-actions"); actions.append(save, discard);
    const readers = node("div", "agents-rules-readers"); readers.id = "agents-rules-readers"; const list = node("div", "agents-rules-reader-list"); readers.append(node("h4", "", "Who reads what"), list);
    const fine = node("p", "muted agents-rules-fine", "Claude Code, Codex and OpenCode already read AGENTS.md and CLAUDE.md on their own, so Studio only adds your text for them. A running task keeps the rules it started with; a file is read again for each new request. Switch the files on only for a project you trust: their text goes to the models as instructions.");
    box.append(state, scopeNote, area, count, warn, files, total, actions, readers, fine);
    Object.assign(rulesUi, { box, state, scopeNote, area, chars, tokens, warn, switches, sum, save, discard, readers, list, flash: null });
    return box;
  }
  const rulesTone = (text, tone = "") => { rulesUi.state.textContent = text; if (tone) rulesUi.state.dataset.tone = tone; else delete rulesUi.state.dataset.tone; };
  // The parts that follow every keystroke and every switch: the counter, the warning, the total, the state and the buttons.
  function paintRulesLive(item) {
    const rules = rulesOf(item), info = rulesInfoOf(item), limit = info.limit || RULES_LIMIT, over = rules.text.length > limit, changed = rulesChanged(item);
    rulesUi.chars.textContent = `${rules.text.length.toLocaleString("en-US")} of ${limit.toLocaleString("en-US")} characters`;
    rulesUi.tokens.textContent = `about ${rulesTokens(rules.text.length)} tokens`;
    rulesUi.box.dataset.over = String(over); rulesUi.warn.hidden = !over;
    rulesUi.sum.textContent = `about ${rulesCost(item).tokens} tokens`;
    rulesUi.save.disabled = !changed || over || saving; rulesUi.discard.disabled = !changed || saving;
    if (rulesUi.flash) rulesTone(rulesUi.flash.text, rulesUi.flash.tone);
    else if (info.disabled) rulesTone("Rules are switched off for this session (MEFI_STUDIO_NO_AGENT_RULES). Nothing here is sent, and your rules are kept.", "warn");
    else rulesTone(changed ? "Unsaved changes" : "Saved", over ? "bad" : changed ? "" : "good");
  }
  // The whole card from the draft (a new project, a reload, a save). The textarea keeps what is typed while it has focus.
  function paintRules() {
    const item = draft(); if (!item || !rulesUi.box) return;
    const rules = rulesOf(item), info = rulesInfoOf(item);
    if (document.activeElement !== rulesUi.area && rulesUi.area.value !== rules.text) rulesUi.area.value = rules.text;
    for (const [key, ui] of Object.entries(rulesUi.switches)) {
      ui.input.checked = rules[key] === true; ui.note.textContent = rulesFileNote(item, key);
      ui.row.dataset.found = String(info.files?.[key]?.found === true);
    }
    const inherited = scope === "project" && item.saved.inherited === true;
    rulesUi.scopeNote.textContent = scope === "defaults" ? "These are the Studio defaults' rules: every project without a team of its own reads them."
      : inherited ? "This project follows the Studio defaults, so these are their rules. Saving here gives it a team of its own: a copy of the defaults plus these rules." : "";
    rulesUi.scopeNote.hidden = !rulesUi.scopeNote.textContent;
    rulesUi.box.dataset.scope = scope;
    const readers = Array.isArray(info.readers) ? info.readers : [];
    rulesUi.list.replaceChildren();
    for (const row of readers) {
      const line = node("div", "agents-rules-reader"), words = node("span", "agents-rules-reader-words");
      words.append(node("strong", "", row.title), node("small", "muted", row.detail));
      line.append(words, node("span", `agents-rules-chip${row.files ? " agents-rules-chip-files" : ""}`, row.files ? "Text and files" : "Your text"));
      rulesUi.list.append(line);
    }
    rulesUi.readers.hidden = !readers.length;
    paintRulesLive(item);
  }
  function discardRules() {
    const item = draft(); if (!item || saving) return;
    rulesUi.flash = null; item.rules = rulesSavedOf(item); rulesUi.area.value = item.rules.text; paintRules();
  }
  async function saveRules() {
    const item = draft(); if (!item || saving || !rulesChanged(item)) return;
    const rules = rulesOf(item);
    if (rules.text.length > (rulesInfoOf(item).limit || RULES_LIMIT)) { paintRulesLive(item); return; }
    const key = draftKey(), before = item.saved.name;
    saving = true; rulesUi.flash = { text: "Saving…" }; paintRulesLive(item);
    try {
      const result = await api()?.agentsSave?.({ action: "rules", projectId: item.saved.projectId, scope, revision: item.saved.revision, rules: { text: rules.text, agents: rules.agents, claude: rules.claude } });
      if (!result?.ok) throw new Error(result?.error || "The rules were not saved.");
      // The host's copy is the truth (line endings and trailing space normalised): the card and the draft follow it, and the rest of the team draft is left as edited.
      item.saved = result;
      if (result.configuration?.agentRules) item.configuration.agentRules = clone(result.configuration.agentRules); else delete item.configuration.agentRules;
      if (item.name === before) { item.name = result.name; const name = $("agents-team-name"); if (name && document.activeElement !== name) name.value = result.name; }
      item.rules = rulesSavedOf(item);
      // A project that followed the Studio defaults has a team of its own now; the rest of the page is left as it is.
      const summary = $("agents-team-summary"); if (summary) summary.textContent = `${item.saved.name} · ${item.saved.inherited ? "Studio defaults" : "Project team"}`;
      if (!item.dirty) say(`${scope === "defaults" ? "Studio defaults" : "Independent project team"} · Saved`);
      rulesUi.flash = { text: "Rules saved. New requests use them. Running tasks keep the rules they started with.", tone: "good" };
    } catch (error) {
      rulesUi.flash = { text: plain(error, "The rules were not saved. Your text is still here."), tone: "bad" };
    } finally {
      saving = false;
      if (key === draftKey() && draft() === item) { if (!rulesChanged(item)) rulesUi.area.value = item.rules.text; paintRules(); }
    }
  }
  // ---- end of rules card ----
  function agentRow({ id, title, detail, provider, model, effort = "", fast = false, builder = false, seat = false, setProvider, setModel, setEffort, setFast }, config, saved) {
    const box = node("section", "agents-model-row"); box.dataset.agent = id;
    const addon = addonPanel(id, title, provider, config, saved);
    const add = button("+", () => { addon.hidden = !addon.hidden; add.setAttribute("aria-expanded", String(!addon.hidden)); window.MefiScroll?.refresh(); }, "agents-add-button");
    add.id = `agent-${id}-add`; add.dataset.count = String(config.agentSkills?.[id]?.length || 0); add.setAttribute("aria-label", `Add skills or MCP tools to ${title}`); add.setAttribute("aria-expanded", "false"); add.setAttribute("aria-controls", addon.id);
    const heading = node("div", "agents-model-heading"), roleTitle = node("h3", "", title); roleTitle.id = `agent-${id}-title`;
    heading.append(roleTitle, node("p", "muted", detail)); box.setAttribute("aria-labelledby", roleTitle.id);
    const identity = node("div", "agents-model-identity");
    const select = node("select", "agents-model-select"); select.id = `agent-${id}-model`; select.dataset.provider = provider; select.dataset.builder = String(builder); select.setAttribute("aria-label", `${id} model`); populateModels(select, provider, model, builder); select.disabled = seat && provider === "auto";
    const custom = node("input", "agents-custom-model"); custom.type = "text"; custom.maxLength = 120; custom.placeholder = "provider/model-id"; custom.setAttribute("aria-label", `${id} custom model ID`); custom.hidden = true;
    select.addEventListener("change", () => { if (select.value === "__custom") { custom.hidden = false; custom.value = model; custom.focus(); } else { setModel(select.value); refreshRows(`agent-${id}-provider`); } });
    const applyModel = () => {
      const value = custom.value.trim(); const valid = provider === "antigravity" ? /^[A-Za-z0-9 ._()/:-]{0,120}$/ : /^[A-Za-z0-9._:/-]{0,120}$/;
      if (!valid.test(value)) { custom.setCustomValidity("Use a model ID from this provider. Antigravity names can also contain spaces and parentheses."); custom.reportValidity(); return; }
      custom.setCustomValidity(""); setModel(value); refreshRows(`agent-${id}-provider`);
    };
    custom.addEventListener("change", applyModel); custom.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); applyModel(); } if (event.key === "Escape") { event.stopPropagation(); custom.hidden = true; select.value = model; window.MefiSelect?.refresh?.(); } });
    identity.append(select, custom);
    const settings = node("div", "agents-model-settings");
    const capabilityModel = model || (seat && provider === "zen" ? "gpt-6.1-sol" : "");
    const modelId = capabilityModel.toLowerCase().replace(/^openai\//, ""), extended = /^gpt-6(?:\.\d+)?-/.test(modelId);
    const support = !builder && (provider === "zen" || provider === "openrouter" && /^openai\//i.test(capabilityModel)) && (extended || /^(gpt-5(?:[.-]|$)|o[134](?:-|$))/.test(modelId));
    const supportedEfforts = support ? extended ? (saved.efforts || ["minimal", "low", "medium", "high", "xhigh", "max"]) : ["low", "medium", "high"] : [];
    if (setEffort) {
      const input = selectOptions([["", "Default"], ...supportedEfforts.map((value) => [value, value])], supportedEfforts.includes(effort) ? effort : "", `${id} reasoning effort`, setEffort); input.disabled = !support; settings.append(field("Effort", input));
    }
    if (setFast) {
      const input = node("input"); input.type = "checkbox"; input.checked = fast && extended && provider === "zen"; input.disabled = !(extended && provider === "zen"); input.setAttribute("role", "switch"); input.setAttribute("aria-label", `${id} fast mode`); input.addEventListener("change", () => setFast(input.checked)); settings.append(field("Fast mode", input));
    }
    if (builder) settings.append(field("Build tier", selectOptions([["auto", "Auto"], ["free", "Free"], ["fast", "Fast"], ["heavy", "Heavy"]], config.executorTier || "auto", "Builder tier", (value) => { config.executorTier = value; dirty(); refreshRows(); })));
    const picker = node("div", "agents-provider-picker"); picker.id = `agent-${id}-providers`; picker.hidden = true; picker.setAttribute("aria-label", `${title} providers`);
    const trigger = button("", () => { picker.hidden = !picker.hidden; trigger.setAttribute("aria-expanded", String(!picker.hidden)); if (!picker.hidden) picker.querySelector('[aria-pressed="true"]')?.focus(); }, "agents-provider-trigger");
    trigger.id = `agent-${id}-provider`; trigger.title = `Choose provider · ${providerNames[provider]}`; trigger.setAttribute("aria-label", `${title} provider: ${providerNames[provider]}`); trigger.setAttribute("aria-expanded", "false"); trigger.setAttribute("aria-controls", picker.id);
    trigger.append(providerIcon(provider), node("span", "", builder && provider === "opencode" ? "OpenCode" : providerNames[provider]), node("span", "", "⌄"));
    for (const key of builder ? cliIds : Object.keys(providerNames)) {
      const option = button("", () => {
        if (key === provider) { picker.hidden = true; trigger.setAttribute("aria-expanded", "false"); trigger.focus(); return; }
        setProvider(key); refreshRows(trigger.id); loadProviderModels(key);
      }, "agents-provider-option"); option.dataset.provider = key; option.setAttribute("aria-pressed", String(provider === key));
      option.disabled = false;
      const words = node("span"); words.append(node("strong", "", builder && key === "opencode" ? "OpenCode" : providerNames[key]), node("small", "muted", providerNote(key, saved)));
      option.append(providerIcon(key), words); picker.append(option);
    }
    picker.append(button("Manage connections →", () => go("agents", { section: "setup", pane: "connections" }), "ghost mini"));
    if (["zen", "opencode", "zai", "lmstudio", "custom", "openrouter"].includes(provider)) picker.append(button("Refresh model list", () => loadProviderModels(provider, true), "ghost mini"));
    const applied = saved.choices?.[id];
    const note = node("p", "agents-route-note", applied
      ? `Applied: ${providerNames[applied.provider] || applied.provider} · ${applied.model}. ${applied.inherited ? "Inherits routing. " : ""}${applied.reason}${draft()?.dirty ? " · Draft changes apply to new work after Apply." : ""}`
      : seat && provider === "zen" && !saved.routing?.hasZen ? "Zen is not connected; uses the planning and review route until a key is saved."
      : provider === "auto" ? "Inherits routing and fallback rules" : providerNote(provider, saved));
    box.append(heading, trigger, add, identity, settings, note, picker, addon);
    box.addEventListener("keydown", (event) => { if (event.key !== "Escape") return; if (!picker.hidden) { event.stopPropagation(); picker.hidden = true; trigger.setAttribute("aria-expanded", "false"); trigger.focus(); } else if (!addon.hidden) { event.stopPropagation(); addon.hidden = true; add.setAttribute("aria-expanded", "false"); add.focus(); } });
    return box;
  }
  function buildBehavior() {
    const root = $("agents-behavior"), custom = card("Team coordination & reports", "These choices travel with this team. Studio pause, approval and capacity controls remain global."); custom.id = "agents-team-behavior"; root.prepend(custom);
    const local = card("Local studio roles", "Watcher, Machine, Auditor, Keeper, Compactor, Foreman and Reference organise and inspect local work. Their maintenance does not require a model.");
    local.append(node("p", "muted", "The Briefer, Overseer, Ideas, Improver, Grower, Responder and cluster planning/review roles inherit the configured routine or heavy route.")); root.append(local);
  }
  // The 0.5 layout's panes, made once, the first time Team opens with the layout on: Permissions (the full permission
  // control, which Build opened as a dialog), Rules (the rules card, moved), Connectors and Related folders.
  let teamFiled = false;
  function fileTeamV2() {
    const body = $("agents-body");
    if (teamFiled || !teamLayout() || !body) return false;
    teamFiled = true;
    const pane = (name, id) => { const el = node("div", "agents-pane"); el.id = id; el.dataset.agentsPane = name; el.hidden = true; body.append(el); return el; };
    const perms = pane("perms", "agents-perms");
    const control = node("div"); control.id = "agents-permissions"; perms.append(control);
    window.MefiAutonomy?.mount?.(control, { full: true });
    const rules = pane("rules", "agents-rules-place");
    const card = $("agents-rules"); if (card) rules.append(card);
    buildConnectors(pane("connectors", "agents-connectors"));
    buildFolders(pane("folders", "agents-folders"));
    $("agents-overlay")?.setAttribute("data-places", "v2");
    return true;
  }
  // ---- Seats and models, made simple (renderer/team-models.js) ----
  // In the 0.5 layout Seats and models opens on a plain page (right now, how Studio decides, who does what, the report
  // card, how thinking works) and the detailed cards it grew from fold under More settings: the role grid, the routing
  // and coding-worker cards and team coordination move there with their ids, bindings and Search entries, and go back
  // where they were when the classic layout opens the page. Providers gains the setup helper's one-provider and
  // several-logins flows on top. The plain page edits this page's draft (teamContext.changed marks it dirty and
  // repaints both), so Apply changes applies everything; openTeam opens More settings for a target inside it.
  let seatsMade = false;
  const seatHomes = new Map();
  const teamContext = {
    draft: () => draft() || null,
    projectId,
    go,
    changed: () => { dirty(); refreshRows(); },
    reveal: (id) => revealSeat(id),
    // The team changed on the host (Use for everything): a draft without edits is read again.
    reload: () => { const item = draft(); if (!item || item.dirty || rulesChanged(item)) return false; drafts.delete(draftKey()); void load(); return true; },
    kindsChanged: () => adoptKinds(),
  };
  function fileSeats(on) {
    if (!seatsMade) {
      if (!on || !$("agents-team") || !$("agents-connections")) return;
      seatsMade = true;
      const page = node("div", "team-models"); page.id = "team-models";
      const more = node("details", "agents-more"); more.id = "agents-more";
      const summary = node("summary"); summary.append(node("span", "agents-more-title", "More settings"), node("span", "agents-more-hint", "Provider order · Jev · coding tiers · subtask builders · each seat in detail"));
      const inside = node("div", "agents-more-body"); inside.id = "agents-more-body";
      more.append(summary, inside); $("agents-team").prepend(page, more);
      const providers = node("div", "team-providers"); providers.id = "team-providers"; $("agents-connections").prepend(providers);
      window.MefiTeamModels?.mount?.(page, teamContext); window.MefiTeamModels?.providers?.(providers, teamContext);
    }
    const inside = $("agents-more-body");
    for (const el of [document.querySelector("#agents-team .agents-team-intro"), $("agents-role-grid"), $("settings-routing"), $("settings-workers"), $("agents-model-skills"), $("agents-team-behavior")]) {
      if (!el) continue;
      if (on) {
        if (el.parentNode === inside) continue;
        // A marker where the card was, so the classic layout puts it back in its place.
        if (!seatHomes.has(el)) { const home = document.createComment(` ${el.id || "agents-team-intro"} `); el.before(home); seatHomes.set(el, home); }
        inside.append(el);
      } else if (el.parentNode === inside && seatHomes.get(el)?.parentNode) seatHomes.get(el).after(el);
    }
    for (const id of ["team-models", "agents-more", "team-providers"]) { const el = $(id); if (el) el.hidden = !on; }
  }
  // Change on a job's line: More settings opens at that job's card, its model picker focused.
  function revealSeat(id) {
    const more = $("agents-more"); if (more) more.open = true;
    const row = $("agents-role-grid")?.querySelector(`.agents-model-row[data-agent="${id}"]`);
    if (!row) return false;
    row.scrollIntoView?.({ block: "center" });
    const select = $(`agent-${id}-model`), shown = select?.nextElementSibling?.classList.contains("studio-select") ? select.nextElementSibling : select;
    (shown && !shown.disabled && !shown.hidden ? shown : $(`agent-${id}-provider`))?.focus?.({ preventScroll: true });
    row.dataset.found = "true"; setTimeout(() => { delete row.dataset.found; }, 2400);
    return true;
  }
  // Try it and Stop in the report card write the team's kind-of-job routes on the host at once (team:kind-route), and
  // that moves the team's revision. A draft without edits is read again. A draft with edits takes the new routes and
  // revision only when nothing else changed under it, so Apply neither drops the route nor overwrites another writer
  // (that case still meets the stale-draft refusal, as before).
  async function adoptKinds() {
    const item = draft(); if (!item) return;
    const key = draftKey();
    let fresh = null;
    try { fresh = await api()?.agentsState?.({ projectId: projectId(), scope }); } catch { return; }
    if (!fresh?.ok || key !== draftKey() || draft() !== item) return;
    const others = (configuration) => { const { agentKinds, ...rest } = configuration || {}; return JSON.stringify(rest); };
    if (!item.dirty && !rulesChanged(item)) drafts.set(key, { saved: fresh, configuration: clone(fresh.configuration), name: fresh.name, dirty: false });
    else if (others(fresh.configuration) === others(item.saved.configuration)) {
      item.saved = fresh;
      if (fresh.configuration?.agentKinds) item.configuration.agentKinds = clone(fresh.configuration.agentKinds); else delete item.configuration.agentKinds;
    } else return;
    renderConfiguration(); window.dispatchEvent(new CustomEvent("mefi:agent-draft"));
  }
  // Connectors: the stdio servers Studio already runs for an agent (~/.mefi-studio/mcp.json, read with the team), each
  // with its tools, and where each agent is allowed to use them. What the prototype adds (adding, approving, testing and
  // importing a connector from here) does not exist yet, and the page says so.
  function buildConnectors(root) {
    const yours = card("Your connectors", "Stdio servers from ~/.mefi-studio/mcp.json. Studio starts one only for an agent you allowed to use its tools.");
    yours.id = "agents-connectors-yours";
    const rows = node("div", "agents-connector-rows"); rows.id = "agents-connector-rows";
    const actions = node("div", "agents-actions");
    actions.append(button("Choose who may use them", () => go("agents", { place: "seats" }), "ghost"), button("Reload saved settings", discard, "ghost"));
    yours.append(rows, actions);
    const own = card("Studio's own tools", "Search the web, read web pages you link and read project files. Each agent has its own switches, with the + beside it in Seats and models; a builder can use at most sixteen connector tools.");
    const missing = card("Not in Studio yet", "Adding a connector from this page, approving its command, testing it, and importing the ones Claude Code already has. Until then, add a server to ~/.mefi-studio/mcp.json and reload.");
    missing.classList.add("agents-gap");
    root.append(yours, own, missing);
  }
  function paintConnectors() {
    const rows = $("agents-connector-rows");
    if (!rows) return;
    const tools = Array.isArray(draft()?.saved?.mcpTools) ? draft().saved.mcpTools : [];
    const servers = new Map();
    for (const tool of tools) { if (!tool?.server) continue; if (!servers.has(tool.server)) servers.set(tool.server, []); servers.get(tool.server).push(tool); }
    rows.replaceChildren();
    if (!servers.size) { rows.append(node("p", "muted", "No connectors yet. Add a stdio server to ~/.mefi-studio/mcp.json, then reload saved settings.")); return; }
    for (const [server, list] of servers) {
      const row = node("div", "agents-connector"); row.dataset.server = server;
      const words = node("div", "agents-connector-words");
      words.append(node("strong", "", server), node("small", "muted", `${list.length} tool${list.length === 1 ? "" : "s"}: ${list.map((tool) => tool.name).join(", ")}`));
      row.append(words);
      rows.append(row);
    }
  }
  // Related folders: Studio has none yet. What it has is said, with the way to it.
  function buildFolders(root) {
    const gap = card("Not in Studio yet", "Agents read this project's folder and nothing outside it. Folders an agent may read but never change, like a shared design system, are not something Studio can add yet.");
    gap.classList.add("agents-gap"); gap.id = "agents-folders-gap";
    const now = card("What agents read today", "The project's own files, and with Rules the project's AGENTS.md and CLAUDE.md.");
    now.append(button("Open Rules", () => go("agents", { place: "rules" }), "ghost"));
    root.append(gap, now);
  }
  function renderConfiguration() {
    const item = draft(); if (!item) return;
    $("agents-team-summary").textContent = `${item.saved.name} · ${item.saved.inherited ? "Studio defaults" : "Project team"}`;
    const ready = item.saved.routing || {};
    // The host's own gate (routeReady) knows Auto's whole walk - signed-in
    // CLIs first, saved keys outside the order - so a CLI-only or custom
    // endpoint setup is not told to connect something it already has.
    const configured = typeof ready.routeReady === "boolean" ? ready.routeReady
      : ready.hasZai || ready.hasOpenCode || ready.hasZen || ready.hasOpenRouter || ready.hasCustom || Boolean(ready.customEndpoint) || ["grok", "claude", "codex", "antigravity", "lmstudio"].includes(ready.provider);
    $("agents-ready").textContent = configured ? "A route is configured. Check its connection before starting work." : "Connect a provider, a local model, or a signed-in coding tool to begin.";
    for (const pane of ["team", "routing"]) $("agents-" + pane).inert = false;
    const config = item.configuration, roles = $("agents-role-grid"); roles.replaceChildren();
    for (const [role, title, detail] of [["routine", "Assistant · routine", "Chat, checks and advisory answers"], ["heavy", "Assistant · planning & review", "Plans, briefs and reviews"]]) {
      const provider = config.aiRoleProviders?.[role] || config.aiProvider || "auto";
      const model = config.aiModelsByProvider?.[provider]?.[role] ?? (["auto", "zen", "zai", "opencode"].includes(provider) ? config.aiModels?.[role] || "" : "");
      const reset = () => { config.agentEfforts = { ...config.agentEfforts, [role]: "" }; dirty(); };
      roles.append(agentRow({ id: role, title, detail, provider, model, effort: config.agentEfforts?.[role],
        setProvider: (value) => {
          config.aiRoleProviders = { ...config.aiRoleProviders, [role]: value };
          // An explicit empty model prevents a legacy model crossing providers.
          config.aiModelsByProvider = { ...config.aiModelsByProvider, [provider]: { ...config.aiModelsByProvider?.[provider], [role]: model }, [value]: { ...config.aiModelsByProvider?.[value], [role]: config.aiModelsByProvider?.[value]?.[role] ?? "" } };
          config.aiModels = { ...config.aiModels, [role]: value === "auto" ? config.aiModelsByProvider?.auto?.[role] || "" : "" }; reset();
        },
        setModel: (value) => { if (provider === "auto") config.aiModels = { ...config.aiModels, [role]: value }; config.aiModelsByProvider = { ...config.aiModelsByProvider, [provider]: { ...config.aiModelsByProvider?.[provider], [role]: value } }; reset(); },
        setEffort: (value) => { config.agentEfforts = { ...config.agentEfforts, [role]: value }; dirty(); },
      }, config, item.saved));
    }
    for (const [seat, title, detail] of [["companion", "Companion", "Talks with you and creates tasks when asked"], ["scout", "Task context scout", "Picks a starting file from local matches"], ["overseer", "Overseer", "Reviews progress across the team"], ["lead", "Lead", "Delegates work and brings reports together"], ["desk", "Desk", "Helps workers when they are stuck"]]) {
      const defaults = { provider: seat === "overseer" ? "auto" : "zen", model: ["companion", "scout"].includes(seat) ? "gpt-6-luna" : "gpt-6.1-sol", effort: seat === "scout" ? "low" : "medium", fast: ["companion", "scout"].includes(seat) };
      const value = { ...defaults, ...item.saved.seats?.[seat], ...config.agentSeats?.[seat] };
      const set = (patch) => { config.agentSeats = { ...config.agentSeats, [seat]: { ...value, ...config.agentSeats?.[seat], ...patch } }; dirty(); };
      roles.append(agentRow({ id: seat, title, detail, ...value, seat: true,
        setProvider: (provider) => {
          const modelsByProvider = { ...value.modelsByProvider, [value.provider]: value.model };
          set({ provider, model: modelsByProvider[provider] ?? "", modelsByProvider, effort: "", fast: false });
        },
        setModel: (model) => set({ model, effort: "", fast: false }),
        setEffort: (effort) => set({ effort }), setFast: (fast) => set({ fast }),
      }, config, item.saved));
    }
    const cli = config.executorCli || "opencode", tier = config.executorTier || "auto";
    const model = tier === "auto" ? config.executorModels?.[cli] ?? config.executorModel ?? "" : config.executorTierModels?.[cli]?.[tier] || "";
    roles.append(agentRow({ id: "builder", title: "Coding worker", detail: "Implements tasks in your project", provider: cli, model, builder: true,
      setProvider: (value) => { config.executorCli = value; config.executorModel = ""; dirty(); },
      setModel: (value) => {
        if (tier === "auto") { config.executorModels = { ...config.executorModels, [cli]: value }; config.executorModel = ""; }
        else config.executorTierModels = { ...config.executorTierModels, [cli]: { ...config.executorTierModels?.[cli], [tier]: value } };
        dirty();
      },
    }, config, item.saved));
    const subtask = config.agentSubtasks || {};
    const subtaskCard = card("Subtask builders", "Delegated implementation work can follow the main builder or use a selected coding tool and model.");
    const subtaskCli = selectOptions([["auto", "Follow main builder"], ["opencode", "OpenCode"], ["claude", "Claude Code"], ["codex", "Codex"], ["grok", "Grok"], ["antigravity", "Antigravity"]], subtask.cli || "auto", "Subtask coding tool", (cli) => { config.agentSubtasks = { ...config.agentSubtasks, cli }; dirty(); });
    const subtaskModel = node("input"); subtaskModel.type = "text"; subtaskModel.maxLength = 120; subtaskModel.value = subtask.model || ""; subtaskModel.placeholder = "Inherit model"; subtaskModel.setAttribute("aria-label", "Subtask model ID");
    subtaskModel.addEventListener("change", () => { config.agentSubtasks = { ...config.agentSubtasks, model: subtaskModel.value.trim() }; dirty(); });
    subtaskCard.append(field("Coding tool", subtaskCli), field("Model ID", subtaskModel, "OpenCode uses provider/model; leave blank to keep the selected tool's normal routing.")); roles.append(subtaskCard);
    const behavior = $("agents-team-behavior"); while (behavior.children.length > 2) behavior.lastChild.remove();
    behavior.append(field("Coordination", selectOptions([["swarm", "Across the queue"], ["cluster", "One shared task"]], config.agentMode || queue.mode, "Team coordination", (value) => { config.agentMode = value; dirty(); })));
    behavior.append(field("Progress in the assistant", selectOptions([["compact", "Compact summaries"], ["detailed", "Detailed progress"]], config.agentReporting || "compact", "Reporting detail", (value) => { config.agentReporting = value; dirty(); })));
    const subscriptionFirst = node("input"); subscriptionFirst.type = "checkbox"; subscriptionFirst.checked = config.aiSubscriptionFirst !== false; subscriptionFirst.setAttribute("role", "switch");
    subscriptionFirst.addEventListener("change", () => { config.aiSubscriptionFirst = subscriptionFirst.checked; dirty(); });
    behavior.append(field("Use subscription logins first", subscriptionFirst, "Automatic assistant routing checks signed-in coding tools before API keys. Turn this off to use the saved provider order."));
    for (const [key, title, detail] of [["contextScout", "Use Luna to scout task context", "Fast tier by default; local references still gather when this is off."], ["deskTool", "Let workers ask the desk", "OpenCode and Claude workers can ask for help during a run."], ["deskResolves", "Let the desk handle asks", "The companion settles open asks and parked cards for you on the desk's model; permission, risk and owner-only asks still wait for you."], ["headDrafts", "Draft complex pipelines", "Let the lead draft steps when no saved recipe fits."], ["nestedDelegation", "Allow nested delegation", "Delegated work may split again within the existing depth limit."]]) {
      const input = node("input"); input.type = "checkbox"; input.checked = key === "contextScout" ? config.agentBrain?.[key] !== false : config.agentBrain?.[key] === true; input.setAttribute("role", "switch"); input.addEventListener("change", () => { config.agentBrain = { ...config.agentBrain, [key]: input.checked }; dirty(); }); behavior.append(field(title, input, detail));
    }
    const name = $("agents-team-name"); if (document.activeElement !== name) name.value = item.name;
    const picker = $("agents-preset-picker"), selected = picker.value; picker.replaceChildren();
    const blank = node("option", "", "Choose a saved team"); blank.value = ""; picker.append(blank);
    for (const preset of item.saved.presets || []) { const option = node("option", "", preset.name); option.value = preset.id; picker.append(option); }
    picker.value = selected;
    // Apply changes lights up while the draft holds edits (agents.css).
    $("agents-save-bar")?.setAttribute("data-dirty", String(Boolean(item.dirty)));
    say(item.dirty ? "Draft · applies to new work after you choose Apply." : `${scope === "defaults" ? "Studio defaults" : item.saved.inherited ? "Inheriting Studio defaults" : "Independent project team"} · Saved`);
    paintRules();
    paintConnectors();
    if (teamLayout()) window.MefiTeamModels?.render?.();
    window.MefiScroll?.scan($("agents-overlay"));
  }
  function stageRouting(patch) {
    const item = draft();
    if ($("agents-overlay")?.hidden || params.section !== "setup" || params.pane === "connections") return false;
    if (!item) throw new Error("Wait for this project's configuration to load before editing.");
    const map = { provider: "aiProvider", roleProviders: "aiRoleProviders", models: "aiModels", providerModels: "aiModelsByProvider", autoProviders: "aiAutoProviders", autoFallback: "aiAutoFallback", subscriptionFirst: "aiSubscriptionFirst", modelSelection: "modelSelection", executorCli: "executorCli", executorModels: "executorModels", executorTier: "executorTier", executorTierModels: "executorTierModels" };
    for (const [key, value] of Object.entries(patch)) {
      if (!map[key]) return false;
      const field = map[key];
      if (["providerModels", "executorTierModels"].includes(key)) {
        item.configuration[field] = { ...item.configuration[field] };
        for (const [inner, entry] of Object.entries(value)) item.configuration[field][inner] = { ...item.configuration[field][inner], ...entry };
      } else item.configuration[field] = value && typeof value === "object" && !Array.isArray(value) ? { ...item.configuration[field], ...value } : clone(value);
    }
    if (["provider", "roleProviders", "models", "providerModels"].some((key) => key in patch)) item.configuration.agentEfforts = {};
    dirty(); renderConfiguration(); return true;
  }
  function routingView(base) {
    const item = draft(); if (!item || $("agents-overlay")?.hidden || params.pane === "connections") return base;
    const config = item.configuration, cli = config.executorCli || base.executorCli;
    // A drafted order or subscriptions-first switch the host has not applied
    // drops the host's walk, so the page rebuilds it from the draft instead
    // of showing the saved one.
    const autoProviders = config.aiAutoProviders || base.autoProviders, subscriptionFirst = config.aiSubscriptionFirst ?? base.subscriptionFirst;
    const walkChanged = JSON.stringify(autoProviders) !== JSON.stringify(base.autoProviders) || subscriptionFirst !== base.subscriptionFirst;
    return { ...base, provider: config.aiProvider || base.provider, roleProviders: config.aiRoleProviders || {}, models: config.aiModels || {}, providerModels: config.aiModelsByProvider || {}, autoProviders, subscriptionFirst, ...(walkChanged ? { autoOrder: null } : {}), autoFallback: config.aiAutoFallback ?? base.autoFallback, modelSelection: config.modelSelection || base.modelSelection, executorCli: cli, executorTier: config.executorTier || base.executorTier, executorModels: config.executorModels || {}, executorModel: config.executorModels?.[cli] || "", executorTierModels: config.executorTierModels || {} };
  }
  async function load() {
    const key = draftKey(), serial = ++readSerial;
    if (draft()) { renderConfiguration(); window.dispatchEvent(new CustomEvent("mefi:agent-draft")); return; }
    for (const pane of ["team", "routing"]) $("agents-" + pane).inert = true;
    $("agents-role-grid").replaceChildren(node("p", "muted", "Loading this team's configuration…"));
    say("Loading agent setup…");
    try {
      const result = await api()?.agentsState?.({ projectId: projectId(), scope });
      if (serial !== readSerial || key !== draftKey()) return;
      if (!result?.ok) throw new Error(result?.error || "Agent setup is available in the desktop app.");
      drafts.set(key, { saved: result, configuration: clone(result.configuration), name: result.name, dirty: false });
      for (const pane of ["team", "routing"]) $("agents-" + pane).inert = false;
      renderConfiguration(); window.dispatchEvent(new CustomEvent("mefi:agent-draft"));
      const visibleProviders = new Set(Array.from(document.querySelectorAll(".agents-model-select"), (select) => select.dataset.provider));
      for (const provider of visibleProviders) loadProviderModels(provider);
    } catch (error) {
      if (key !== draftKey()) return;
      const text = plain(error, "Agent setup could not be read. Try Reload saved settings.");
      say(text, true); $("agents-ready").textContent = text; $("agents-role-grid").replaceChildren(node("p", "muted", text));
    }
  }
  async function save(action, id) {
    const item = draft(); if (!item || saving) return;
    if (["preset-delete"].includes(action) && !id) { say("Choose a preset first.", true); return; }
    saving = true; say("Saving…");
    const key = draftKey();
    try {
      const payload = { action, id, projectId: item.saved.projectId, scope, revision: item.saved.revision, configuration: clone(item.configuration), name: item.name };
      const result = await (action.startsWith("preset-") ? api()?.agentsPreset?.(payload) : api()?.agentsSave?.(payload));
      if (!result?.ok) throw new Error(result?.error || "The team was not saved.");
      if (action.startsWith("preset-")) item.saved = result;
      else drafts.set(key, { saved: result, configuration: clone(result.configuration), name: result.name, dirty: false, rules: item.rules && rulesChanged(item) ? item.rules : undefined });
      if (key === draftKey()) { renderConfiguration(); window.dispatchEvent(new CustomEvent("mefi:agent-draft")); say(action === "preset-delete" ? "Preset deleted. Project copies are unchanged." : action.startsWith("preset-") ? "Preset saved. Project copies are unchanged." : "Saved · new work uses this team. Running work keeps its configuration."); }
    } catch (error) { if (key === draftKey()) say(plain(error, "The team was not saved."), true); }
    // The rules buttons wait while a save is out; they are ready again now.
    finally { saving = false; if (draft() && rulesUi.box) paintRulesLive(draft()); }
  }
  function discard() { drafts.delete(draftKey()); load(); }
  // Team in the 0.5 layout: one place at a time, its panes, its title and the line under it. params keeps the classic
  // section and pane beside the place, so routing's staging (stageRouting, routingView) reads the page as it did.
  let teamPlaceSaid = null;
  async function openTeam(options = {}) {
    fileTeamV2(); fileSeats(true);
    const place = teamPlaceById(teamPlaceFromParams(options)) ?? TEAM_PLACES[0];
    const pane = place.id === "seats" ? (options.pane === "routing" || $(options.target)?.closest?.("#agents-routing") ? "routing" : "team") : place.id === "providers" ? "connections" : place.panes[0];
    const moved = params.place !== place.id;
    params = { section: place.id === "overview" ? "overview" : "setup", pane, place: place.id };
    window.MefiNav?.claim("agents"); $("agents-overlay").hidden = false; paintOverview();
    $("agents-overlay").dataset.teamPlace = place.id;
    // The prototype titles the Overview page Team; the breadcrumb still says Team / Overview.
    $("agents-title").textContent = place.id === "overview" ? "Team" : place.label;
    const about = $("agents-title")?.nextElementSibling;
    if (about) about.textContent = place.about || "";
    for (const node of $("agents-body").children) if (node.classList.contains("agents-pane")) node.hidden = !place.panes.includes(node.dataset.agentsPane);
    // The team draft's Apply and Discard go with the places that edit it; the project or defaults choice also with Rules.
    $("agents-save-bar").hidden = !place.draft;
    $("agents-team-toolbar").hidden = !(place.draft || place.scoped);
    if (moved && !options.target) $("agents-body").scrollTop = 0;
    if (teamPlaceSaid !== place.id) { teamPlaceSaid = place.id; window.dispatchEvent(new CustomEvent("mefi:team-place", { detail: { place: place.id } })); }
    await Promise.all([load(), refreshQueue()]); syncQueue();
    // The report card and the logins are read each time their place opens (renderer/team-models.js).
    if (place.id === "seats") window.MefiTeamModels?.open?.(); else if (place.id === "providers") window.MefiTeamModels?.openProviders?.();
    window.MefiNav?.paintCurrent(); window.MefiScroll?.refresh();
    if (options.target) {
      const target = $(options.target); if (target && $("agents-overlay").contains(target)) { for (let el = target; el && el !== $("agents-body"); el = el.parentElement) if (el.tagName === "DETAILS") el.open = true; target.scrollIntoView?.({ block: "nearest" }); (target.nextElementSibling?.classList.contains("studio-select") ? target.nextElementSibling : target).focus?.({ preventScroll: true }); }
    }
  }
  async function open(options = {}) {
    mount();
    if (teamLayout()) return openTeam(options);
    // The classic layout: the cards More settings held go back to their panes.
    fileSeats(false);
    params = { section: options.section === "setup" ? "setup" : "overview", pane: ["connections", "team", "routing", "behavior"].includes(options.pane) ? options.pane : "team" };
    window.MefiNav?.claim("agents"); $("agents-overlay").hidden = false; paintOverview();
    $("agents-title").textContent = params.section === "overview" ? "Agents" : `Agent setup · ${children.setup.find(([, , value]) => value.pane === params.pane)?.[0] || "Team"}`;
    for (const pane of $("agents-body").children) if (pane.classList.contains("agents-pane")) pane.hidden = pane.id !== `agents-${params.section === "overview" ? "overview" : params.pane}`;
    $("agents-save-bar").hidden = params.section !== "setup" || params.pane === "connections";
    $("agents-team-toolbar").hidden = params.section !== "setup" || params.pane === "connections";
    await Promise.all([load(), refreshQueue()]); syncQueue();
    window.MefiNav?.paintCurrent(); window.MefiScroll?.refresh();
    if (options.target) {
      const target = $(options.target); if (target && $("agents-overlay").contains(target)) { for (let el = target; el && el !== $("agents-body"); el = el.parentElement) if (el.tagName === "DETAILS") el.open = true; target.scrollIntoView?.({ block: "nearest" }); (target.nextElementSibling?.classList.contains("studio-select") ? target.nextElementSibling : target).focus?.({ preventScroll: true }); }
    }
  }
  function close() { if ($("agents-overlay")) $("agents-overlay").hidden = true; window.MefiNav?.release("agents"); }
  function init() {
    document.addEventListener("pointerdown", (event) => { if (!event.target.closest?.(".agents-nav-group")) closeNavMenu(); }, true);
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !document.querySelector('.agents-nav-group > [aria-expanded="true"]')) return;
      event.preventDefault(); event.stopImmediatePropagation(); closeNavMenu(true);
    }, true);
    window.addEventListener("mefi:nav", () => closeNavMenu());
    window.addEventListener("resize", () => closeNavMenu());
    window.addEventListener("blur", () => closeNavMenu());
    api()?.onAssistantStatus?.((status) => adoptQueue(status)); api()?.onAssistant?.((payload) => adoptQueue(null, payload?.state));
    api()?.onProjects?.(() => { readSerial++; if ($("agents-overlay")?.hidden === false) load(); });
    // Another writer changed settings: a clean draft is re-read. A push during
    // this sheet's own save is that save's echo, and unsaved edits are kept.
    // An open sheet reloads at once; its form stayed bound to the dropped
    // draft, so edits and Apply silently did nothing.
    api()?.onSettingsChanged?.(() => {
      if (saving || !draft() || draft().dirty || rulesChanged(draft())) return;
      drafts.delete(draftKey());
      if ($("agents-overlay")?.hidden === false) void load();
    });
    window.addEventListener("mefi:queue-settings", syncQueue);
    // The 0.5 layout calls the page Team (WHERE_WENT: "Agents" → Team, renamed), with the prototype's two people for its glyph.
    window.MefiNav?.register({ id: "agents", get label() { return teamLayout() ? "Team" : "Agents"; }, get short() { return teamLayout() ? "Team" : "Agents"; }, kind: "overlay", layer: "sheet", section: "agents", group: "tools", get glyph() { return teamLayout() ? "g-community" : "g-agents"; }, badge: "questions", get desc() { return teamLayout() ? "Who does the work, how many can work at once, and how much they can do without asking" : "Set up your team, follow live work, workflows, models and usage"; }, searchTerms: "team agents agent setup presets seats connections providers provider effort routing automation permissions rules connectors", showIn: { palette: true, help: true, tools: true }, element: "agents-overlay", focus: "#agents-title", open, close, isOpen: () => $("agents-overlay")?.hidden === false });
    // Canonical settings ownership is established before the first visit.
    mount();
  }
  window.MefiAgents = { open, close, mount, redirect, paintNav, navModel, location, stageRouting, routingView, params: () => ({ ...params }), reload: discard, draft: () => draft() ? clone(draft().configuration) : null, teamPlaces, teamPlace, teamPlaceOfElement, TEAM_PLACES };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
