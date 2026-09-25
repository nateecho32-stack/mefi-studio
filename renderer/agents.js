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
  const publishQueue = () => window.dispatchEvent(new CustomEvent("mefi:queue-settings", { detail: queueSnapshot() }));
  function adoptQueue(status, full) {
    if (status) liveStatus = status;
    if (full) liveAssistant = full;
    if (status && typeof status.enabled === "boolean") Object.assign(queue, { known: true, enabled: status.enabled, autoBuild: status.autoBuild !== false, parallel: status.parallel || 1, adaptiveParallel: status.adaptiveParallel !== false, mode: status.mode === "cluster" ? "cluster" : "swarm" });
    if (full?.status) Object.assign(queue, { newWorkKnown: true, newWork: full.status !== "paused", proactive: full.prefs?.proactive !== false });
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
    setup: [["Team & models", "agents", { section: "setup", pane: "team" }], ["Providers", "agents", { section: "setup", pane: "connections" }], ["Routing & fallback", "agents", { section: "setup", pane: "routing" }], ["Run behavior", "agents", { section: "setup", pane: "behavior" }]],
    live: [["Command", "command"], ["Pipelines", "agent-brain", { tab: "live" }], ["Sessions", "explorer"], ["Activity", "eyes"], ["Overhead", "overhead"]],
    workflows: [["Brain maps", "brains"], ["Playbook", "agent-brain", { tab: "playbook" }], ["Project map", "agent-brain", { tab: "map" }], ["Context", "context"]],
    models: [["Catalog", "booklet"], ["Performance", "graph"]],
    usage: [["Recorded calls", "usage", { view: "usage" }], ["Provider accounts", "usage", { view: "tracker" }]],
  };
  let mounted = false, params = { section: "overview", pane: "team" }, scope = "project", readSerial = 0, saving = false;
  const drafts = new Map();
  const draftKey = () => `${projectId() || "none"}:${scope}`;
  const draft = () => drafts.get(draftKey());
  function button(text, run, cls = "ghost") { const el = node("button", cls, text); el.type = "button"; el.addEventListener("click", run); return el; }
  function card(title, detail) { const el = node("section", "agents-card"); el.append(node("h3", "", title)); if (detail) el.append(node("p", "muted", detail)); return el; }
  function say(text, bad = false) { const el = $("agents-save-status"); if (el) { el.textContent = text; el.dataset.tone = bad ? "bad" : "good"; } }
  function location(id, options = {}) {
    if (id === "agents") return { section: options.section || params.section, pane: options.pane || params.pane };
    if (id === "agent-brain") return { section: ["map", "playbook"].includes(options.tab || window.MefiAgentBrain?.tab?.()) ? "workflows" : "live" };
    if (["brains", "context"].includes(id)) return { section: "workflows" };
    if (["booklet", "graph"].includes(id)) return { section: "models" };
    if (id === "usage") return { section: "usage" };
    return { section: "live" };
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
    foot.append(status, button("Discard draft", discard, "ghost mini"), button("Apply changes", () => save("save"), "primary")); sheet.append(foot);
    overlay.append(sheet); document.body.append(overlay);
    move("settings-category-connections", "connections"); move("settings-log", "connections");
    move("settings-routing", "routing"); move("settings-workers", "routing");
    move("settings-automation", "behavior"); move("settings-automation-behavior", "behavior");
    for (const category of ["connections", "models", "automation"]) { document.querySelector(`[data-settings-category="${category}"]`)?.remove(); if (category !== "connections") $(`settings-category-${category}`)?.remove(); }
    $("settings-category-connections")?.querySelector(".settings-category-head")?.remove();
    $("agents-connections").prepend(node("p", "agents-scope-note", "Device-wide connections · Keys stay encrypted on this machine. Teams reference these connections."));
    // All routes into these controls resolve here, including older saved tours.
    for (const pane of body.querySelectorAll("[data-agents-pane]")) for (const el of pane.querySelectorAll("input[id], select[id], button[id], details[id]")) {
      const label = el.getAttribute("aria-label") || el.closest("label")?.querySelector(".field-label, b")?.textContent || (el.querySelector("summary b, summary strong") || el.querySelector("summary"))?.textContent || el.title;
      const help = (el.closest("label")?.querySelector("small") || el.querySelector("summary small, summary .settings-summary-text > span"))?.textContent?.trim() || "";
      if (label) window.MefiNav?.register({ id: `settings:${el.id}`, kind: "action", section: "agents", group: "tools", label: `Agents › ${label.trim().slice(0, 100)}`, desc: help.slice(0, 160), glyph: "g-agents", showIn: { palette: true }, run: () => go("agents", { section: "setup", pane: pane.dataset.agentsPane, target: el.id }) });
    }
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
    header.append(label, name, button("Use Studio defaults", () => save("inherit"), "ghost mini"));
    $("agents-body").prepend(header);
    const presets = card("Saved teams", "Apply a preset as an independent project copy. Changes here never alter another project."); presets.id = "agents-presets";
    const picker = node("select"); picker.id = "agents-preset-picker"; picker.setAttribute("aria-label", "Saved team preset");
    const actions = node("div", "agents-actions");
    actions.append(picker, button("Use in draft", () => {
      const chosen = draft()?.saved.presets.find((item) => item.id === picker.value); if (!chosen) return;
      draft().configuration = clone(chosen.configuration); draft().name = chosen.name; $("agents-team-name").value = chosen.name; dirty(); renderConfiguration();
      window.dispatchEvent(new CustomEvent("mefi:agent-draft"));
    }), button("Save as new preset", () => save("preset-save")), button("Update selected preset", () => save("preset-save", picker.value)), button("Delete preset", () => save("preset-delete", picker.value)));
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
    operations.append(button("Follow live work", () => go("command")));
    cards.append(team, ready, operations); root.append(cards);
    const flow = card("From your idea to verified work", "Work is reported back to the Studio assistant, with its evidence and anything that needs you.");
    const steps = node("div", "agents-flow");
    for (const [title, route, target] of [["Task intake", "tasks"], ["Model routing", "agents", { section: "setup", pane: "routing" }], ["Lead & workers", "agent-brain", { tab: "live" }], ["Verification", "eyes"], ["Assistant report", "workspace"]]) steps.append(button(title, () => go(route, target), "ghost"));
    flow.append(steps); root.append(flow);
    const live = card("What needs you", "Live status and decisions from the assistant."); live.id = "agents-overview-live"; root.append(live);
    const hub = card("Team work hub", "Agents share work state and messages here while they build."); hub.id = "agents-work-hub"; root.append(hub);
  }
  function paintOverview() {
    const root = $("agents-overview-live"); if (!root) return;
    while (root.children.length > 2) root.lastChild.remove();
    const questions = (liveAssistant?.questions || []).filter((item) => item.status === "open");
    const running = (liveStatus?.running || []).filter((item) => !item.finished);
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
    input.addEventListener("change", async () => { input.disabled = true; try { await setQueue(key, input.checked); } catch (error) { window.MefiToast?.(error.message, "bad"); } finally { syncQueue(); } }); row.append(text, input); return row;
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
  function dirty() { if (!draft()) return; draft().dirty = true; say("Draft · applies to new work after you choose Apply."); }
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
    const key = { zai: "hasZai", opencode: "hasOpenCode", zen: "hasZen", openrouter: "hasOpenRouter", custom: "hasCustom" }[provider];
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
    const ids = provider === "zen" ? ["gpt-6-luna", "gpt-6-sol"] : provider === "zai" ? ["glm-5.3-flash", "glm-5.3"] : [];
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
    panel.append(node("h4", "", `Skills & tools · ${title}`));
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
    panel.append(list, node("h4", "", "MCP tools"));
    if (id === "builder") {
      const supported = ["opencode", "claude"].includes(provider), input = node("input"); input.type = "checkbox"; input.checked = config.agentBrain?.deskTool === true; input.disabled = !supported;
      input.addEventListener("change", () => { config.agentBrain = { ...config.agentBrain, deskTool: input.checked }; dirty(); });
      panel.append(field("Studio desk · ask_desk", input, supported ? "Give this coding worker an MCP tool for help from the desk agent." : "Available with OpenCode and Claude Code workers."));
      panel.append(node("p", "muted", "Other MCP servers are managed in your coding tool's own configuration."));
    } else panel.append(node("p", "muted", "This agent makes text-only calls. Attach MCP tools to the coding worker below; selected skills guide this agent's answers."));
    return panel;
  }
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
      const value = custom.value.trim(); if (!/^[A-Za-z0-9._:/-]{0,120}$/.test(value)) { custom.setCustomValidity("Use a model ID with letters, numbers, dots, slashes, colons, underscores or hyphens."); custom.reportValidity(); return; }
      custom.setCustomValidity(""); setModel(value); refreshRows(`agent-${id}-provider`);
    };
    custom.addEventListener("change", applyModel); custom.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); applyModel(); } if (event.key === "Escape") { event.stopPropagation(); custom.hidden = true; select.value = model; window.MefiSelect?.refresh?.(); } });
    identity.append(select, custom);
    const settings = node("div", "agents-model-settings");
    const capabilityModel = model || (seat && provider === "zen" ? "gpt-6-sol" : "");
    const modelId = capabilityModel.toLowerCase().replace(/^openai\//, ""), extended = /^gpt-6-/.test(modelId);
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
      option.disabled = seat && ["codex", "grok", "antigravity"].includes(key);
      const words = node("span"); words.append(node("strong", "", builder && key === "opencode" ? "OpenCode" : providerNames[key]), node("small", "muted", option.disabled ? "Coding workers only" : providerNote(key, saved)));
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
  function renderConfiguration() {
    const item = draft(); if (!item) return;
    $("agents-team-summary").textContent = `${item.saved.name} · ${item.saved.inherited ? "Studio defaults" : "Project team"}`;
    const ready = item.saved.routing || {};
    $("agents-ready").textContent = ready.hasZai || ready.hasOpenCode || ready.hasZen || ready.hasOpenRouter || ["grok", "claude", "codex", "antigravity", "lmstudio"].includes(ready.provider) ? "A route is configured. Check its connection before starting work." : "Connect a provider, a local model, or a signed-in coding tool to begin.";
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
      const defaults = { provider: seat === "overseer" ? "auto" : "zen", model: ["companion", "scout"].includes(seat) ? "gpt-6-luna" : "gpt-6-sol", effort: seat === "scout" ? "low" : "medium", fast: ["companion", "scout"].includes(seat) };
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
    for (const [key, title, detail] of [["contextScout", "Use Luna to scout task context", "Fast tier by default; local references still gather when this is off."], ["deskTool", "Let workers ask the desk", "OpenCode and Claude workers can ask for help during a run."], ["headDrafts", "Draft complex pipelines", "Let the lead draft steps when no saved recipe fits."], ["nestedDelegation", "Allow nested delegation", "Delegated work may split again within the existing depth limit."]]) {
      const input = node("input"); input.type = "checkbox"; input.checked = key === "contextScout" ? config.agentBrain?.[key] !== false : config.agentBrain?.[key] === true; input.setAttribute("role", "switch"); input.addEventListener("change", () => { config.agentBrain = { ...config.agentBrain, [key]: input.checked }; dirty(); }); behavior.append(field(title, input, detail));
    }
    const name = $("agents-team-name"); if (document.activeElement !== name) name.value = item.name;
    const picker = $("agents-preset-picker"), selected = picker.value; picker.replaceChildren();
    const blank = node("option", "", "Choose a saved team"); blank.value = ""; picker.append(blank);
    for (const preset of item.saved.presets || []) { const option = node("option", "", preset.name); option.value = preset.id; picker.append(option); }
    picker.value = selected;
    say(item.dirty ? "Draft · applies to new work after you choose Apply." : `${scope === "defaults" ? "Studio defaults" : item.saved.inherited ? "Inheriting Studio defaults" : "Independent project team"} · Saved`);
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
    return { ...base, provider: config.aiProvider || base.provider, roleProviders: config.aiRoleProviders || {}, models: config.aiModels || {}, providerModels: config.aiModelsByProvider || {}, autoProviders: config.aiAutoProviders || base.autoProviders, autoFallback: config.aiAutoFallback ?? base.autoFallback, modelSelection: config.modelSelection || base.modelSelection, executorCli: cli, executorTier: config.executorTier || base.executorTier, executorModels: config.executorModels || {}, executorModel: config.executorModels?.[cli] || "", executorTierModels: config.executorTierModels || {} };
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
    } catch (error) { if (key === draftKey()) { say(error.message, true); $("agents-ready").textContent = error.message; $("agents-role-grid").replaceChildren(node("p", "muted", error.message)); } }
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
      else drafts.set(key, { saved: result, configuration: clone(result.configuration), name: result.name, dirty: false });
      if (key === draftKey()) { renderConfiguration(); window.dispatchEvent(new CustomEvent("mefi:agent-draft")); say(action.startsWith("preset-") ? "Preset saved. Project copies are unchanged." : "Saved · new work uses this team. Running work keeps its configuration."); }
    } catch (error) { if (key === draftKey()) say(error.message, true); }
    finally { saving = false; }
  }
  function discard() { drafts.delete(draftKey()); load(); }
  async function open(options = {}) {
    mount();
    params = { section: options.section === "setup" ? "setup" : "overview", pane: ["connections", "team", "routing", "behavior"].includes(options.pane) ? options.pane : "team" };
    window.MefiNav?.claim("agents"); $("agents-overlay").hidden = false;
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
    api()?.onSettingsChanged?.((payload) => { if (payload?.agents && draft()?.dirty) return; if (draft() && !draft().dirty) drafts.delete(draftKey()); });
    window.addEventListener("mefi:queue-settings", syncQueue);
    window.MefiNav?.register({ id: "agents", label: "Agents", short: "Agents", kind: "overlay", layer: "sheet", section: "agents", group: "tools", glyph: "g-agents", badge: "questions", desc: "Set up your team, follow live work, workflows, models and usage", searchTerms: "agent setup team presets seats connections provider effort routing automation", showIn: { palette: true, help: true, tools: true }, element: "agents-overlay", focus: "#agents-title", open, close, isOpen: () => $("agents-overlay")?.hidden === false });
    // Canonical settings ownership is established before the first visit.
    mount();
  }
  window.MefiAgents = { open, close, mount, redirect, paintNav, location, stageRouting, routingView, params: () => ({ ...params }), reload: discard, draft: () => draft() ? clone(draft().configuration) : null };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
