// The companion's presentation: stable live panels, hover ownership and safe
// edge roaming. Learning and operational changes remain owned by the host.
(function () {
  "use strict";
  const node = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
  let host, tab = "status", latest, keyboard = false, pointer = { x: -999, y: -999 }, openTimer, closeTimer, roamTimer, travel, dragging, dragged = false, dock, settleUntil = 0, lastLayout = "", chatBusy = false;
  const panes = {}, fields = {};
  let panelAnchor = null;
  const reduced = () => ["off", "calm"].includes(document.documentElement.dataset.motion) || document.body.classList.contains("ws-still") || document.body.classList.contains("no-motion") || matchMedia("(prefers-reduced-motion: reduce)").matches;
  const button = (title, run) => { const el = node("button", "ghost mini", title); el.type = "button"; el.addEventListener("click", run); return el; };
  // Unit suites load this file without studio-ui.js (MefiUi).
  const plain = (error, fallback) => window.MefiUi?.plainError ? window.MefiUi.plainError(error, fallback) : fallback;
  // Who the owner is talking to and where they are: sent with each message so
  // the reply knows, and shown on the replies. Home keeps the name here.
  const companionName = () => { try { return (localStorage.getItem("mefiStudio.workspace.companion") || "").trim() || "Mefi"; } catch { return "Mefi"; } };
  const viewLabel = () => { const id = window.MefiNav?.current?.() || ""; return String((id && window.MefiNav?.get?.(id)?.label) || id || "Studio").replaceAll("-", " "); };
  // A tap on an offer says it for the owner, through the same send.
  const chip = (label, message) => {
    const el = button(label, () => { const input = panes.ask?.querySelector("textarea"); if (!input || chatBusy) return; input.value = message; sendConversation(); });
    el.classList.add("companion-chip"); el.title = message; return el;
  };
  // scripts/companion-pet.cjs's personalities, as the owner reads them
  // (tests/companion_ui.test.mjs keeps the two in step).
  const PERSONALITIES = [
    ["focused", "Straight work", "Short, plain answers. No small talk, faces or wandering."],
    ["balanced", "Balanced", "Warm and to the point. Reacts when things happen."],
    ["playful", "Friendly & expressive", "Chatty and playful: little faces, idle play and celebrations."],
  ];
  let conversationTimer = 0;
  // Where the orb and its panel may go. Layout v1 never kept them off the rail,
  // so there it is the window; in v2 the shell's free area (nav.js usable()), which
  // keeps them clear of the list, the tab strip, the inspector and the status bar.
  const room = () => (window.MefiNav?.layout?.on?.() ? window.MefiNav.usable() : { left: 0, top: 0, right: innerWidth, bottom: innerHeight });
  // The right edge of the menu, which the roaming orb stays beside.
  const railEdge = () => { const area = window.MefiNav?.usable?.(); return (area ? area.left : document.getElementById("app-rail")?.getBoundingClientRect().right) || 72; };
  const inside = (rect, x, y, margin = 14) => x >= rect.left - margin && x <= rect.right + margin && y >= rect.top - margin && y <= rect.bottom + margin;
  const editing = () => host?.panel.contains(document.activeElement) && document.activeElement?.matches("input:not([type=checkbox]):not([type=range]), textarea, [contenteditable=true]");
  function near() {
    if (!host) return false;
    const orb = host.orb.getBoundingClientRect(), panel = host.panel.getBoundingClientRect();
    const bridge = !host.panel.hidden && pointer.x >= Math.min(orb.left, panel.left) - 12 && pointer.x <= Math.max(orb.right, panel.right) + 12
      && pointer.y >= Math.min(orb.top, panel.top) - 12 && pointer.y <= Math.max(orb.bottom, panel.bottom) + 12;
    return inside(orb, pointer.x, pointer.y, 22) || !host.panel.hidden && inside(panel, pointer.x, pointer.y, 16) || bridge || window.MefiSelect?.near(host.panel, pointer.x, pointer.y);
  }
  function stopTravel() {
    if (!travel) return;
    const box = host.orb.getBoundingClientRect(); travel.cancel(); travel = null;
    Object.assign(host.orb.style, { left: `${box.left}px`, top: `${box.top}px`, transform: "none" });
  }
  function updateHover() {
    if (!host || dragging || window.MefiCompanionHub?.isOpen()) return;
    if (near()) {
      stopTravel(); clearTimeout(closeTimer); closeTimer = null;
      if (host.panel.hidden && !openTimer) openTimer = setTimeout(() => { openTimer = null; if (near()) { keyboard = false; host.toggle(true, { hover: true }); } }, 160);
    } else {
      clearTimeout(openTimer); openTimer = null;
      if (!host.panel.hidden && !closeTimer) closeTimer = setTimeout(() => {
        closeTimer = null;
        if (Date.now() < settleUntil) { updateHover(); return; }
        if (!near() && !editing() && !(keyboard && (host.panel.contains(document.activeElement) || window.MefiSelect?.contains(document.activeElement)))) host.toggle(false, { hover: true });
      }, 280);
    }
  }
  function position() {
    if (!host || host.panel.hidden) return;
    if (host.panel.classList.contains("companion-in-hub")) { window.MefiCompanionHub?.resize(); return; }
    const box = host.orb.getBoundingClientRect(), panel = host.panel, area = room();
    const width = Math.min(area.right - area.left - 24, tab === "status" ? 370 : tab === "now" ? 430 : 460);
    panel.style.width = `${width}px`;
    const cap = Math.max(180, area.bottom - area.top - 32), head = panel.querySelector(".companion-shell-head").offsetHeight + panel.querySelector(".companion-tabs").offsetHeight + 44;
    const height = Math.min(cap, head + Math.max(80, panes[tab].scrollHeight));
    panel.style.height = `${height}px`; panel.style.maxHeight = `${cap}px`;
    // Keep the opening edge fixed while content, tabs and live state change.
    // Following the pointer here makes settings move beneath focused controls.
    const middle = (area.top + area.bottom) / 2;
    if (!panelAnchor) panelAnchor = { side: area.right - box.right >= box.left - area.left ? "right" : "left", bottom: box.top > middle, y: box.top > middle ? box.bottom + 24 : box.top - 24 };
    const left = panelAnchor.side === "right" ? box.right + 10 : box.left - width - 10;
    const anchorY = panelAnchor.bottom ? Math.min(area.bottom - 12, panelAnchor.y) - height : panelAnchor.y;
    const top = Math.max(area.top + 12, Math.min(area.bottom - height - 12, anchorY));
    const layout = `${width}:${height}:${left}:${top}`;
    if (layout !== lastLayout) { settleUntil = Date.now() + (reduced() ? 120 : 360); lastLayout = layout; }
    Object.assign(panel.style, { left: `${Math.max(area.left + 12, Math.min(area.right - width - 12, left))}px`, top: `${top}px`, bottom: "auto" });
    window.MefiScroll?.refresh();
  }
  async function preference(patch) {
    try {
      const result = await host.preferences(patch);
      if (result?.ok === false) throw new Error(result.error);
    } catch (error) { window.MefiToast?.(plain(error, "Companion preference was not saved."), "bad"); }
  }
  function addField(key, label, choices, save) {
    const row = node("label", "studio-field"), words = node("span", "", label);
    let control;
    if (choices) {
      control = node("select");
      for (const [value, text] of choices) { const option = node("option", "", text); option.value = value; control.append(option); }
    } else { control = node("input"); control.type = "checkbox"; control.setAttribute("role", "switch"); }
    control.setAttribute("aria-label", label); control.dataset.companionSetting = key;
    control.addEventListener("change", async () => { control.disabled = true; try { await save(control.type === "checkbox" ? control.checked : control.value); } catch (error) { window.MefiToast?.(plain(error, `${label} was not saved.`), "bad"); } finally { control.disabled = false; render(latest); } });
    row.append(words, control); panes.settings.append(row); fields[key] = control;
  }
  // Tab names from before the menu was tidied still open their new home.
  const TAB_ALIASES = { team: "now", activity: "now", learned: "settings" };
  function selectTab(value) {
    value = TAB_ALIASES[value] || value;
    if (!panes[value]) value = "ask";
    tab = value;
    for (const [key, pane] of Object.entries(panes)) pane.hidden = key !== value;
    for (const control of host.panel.querySelectorAll("[data-companion-tab]")) { control.setAttribute("aria-selected", String(control.dataset.companionTab === value)); control.tabIndex = control.dataset.companionTab === value ? 0 : -1; }
    if (value === "ask") refreshConversation();
    if (value === "now") refreshNow();
    render(latest); requestAnimationFrame(position);
  }
  function heading(text) { panes.settings.append(node("h4", "companion-heading", text)); }
  async function refreshConversation() {
    const thread = panes.ask?.querySelector(".companion-thread");
    if (!thread || !window.mefiStudio?.assistantState) return;
    const location = panes.ask.querySelector("[data-companion-location]");
    if (location) location.textContent = `Viewing: ${viewLabel()}`;
    const result = await window.mefiStudio.assistantState().catch(() => null);
    if (!result?.ok) return;
    thread.replaceChildren();
    const messages = (result.state?.messages || []).filter((item) => ["user", "assistant"].includes(item.role)).slice(-10);
    const name = companionName();
    const hello = { focused: `${name}. Ask about this project, or describe a task.`, playful: `Hi hi, I'm ${name}! ^_^ What are we making today?` }[latest?.state?.personality] || `Hi, I'm ${name}. Ask me about this project, or tell me what task to create.`;
    if (!messages.length) thread.append(node("p", "muted", hello));
    for (const item of messages) {
      const row = node("p", `companion-message companion-message-${item.role}${item.kind === "notice" ? " companion-message-notice" : ""}`);
      // A long reply is cut, and says so.
      const text = String(item.text || "");
      row.append(node("strong", "", item.role === "user" ? (item.app ? `${item.app} (app)` : "You") : name), document.createTextNode(` ${text.length > 1200 ? `${text.slice(0, 1200).trimEnd()}…` : text}`));
      thread.append(row);
    }
    // What the last reply offered, one tap away; two or more can all be taken.
    let chips = panes.ask.querySelector(".companion-chips");
    if (!chips) { chips = node("div", "companion-chips"); thread.after(chips); }
    const last = messages.at(-1);
    const offers = last?.role === "assistant" && Array.isArray(last.offers) ? last.offers.map((offer) => String(offer?.title || "").trim()).filter(Boolean).slice(0, 4) : [];
    chips.replaceChildren(...offers.map((title) => chip(title.length > 44 ? `${title.slice(0, 42)}…` : title, `work on "${title}"`)), ...(offers.length > 1 ? [chip("All of them", "all of them")] : []));
    chips.hidden = !offers.length;
    thread.scrollTop = thread.scrollHeight;
    requestAnimationFrame(position);
  }
  async function sendConversation() {
    const input = panes.ask?.querySelector("textarea"), send = panes.ask?.querySelector("button[data-send]");
    const value = input?.value.trim();
    if (!value || chatBusy || !window.mefiStudio?.assistantMessage) return;
    const destination = /^(?:open|show|go to)\s+(tasks?|agents?|settings?|command|project map|plans?)\.?$/i.exec(value)?.[1]?.toLowerCase();
    const route = { task: "tasks", tasks: "tasks", agent: "agents", agents: "agents", setting: "studio", settings: "studio", command: "command", "project map": "agent-brain", plan: "planning", plans: "planning" }[destination];
    if (route) { input.value = ""; host.toggle(false); window.MefiNav?.go(route, route === "agent-brain" ? { tab: "map" } : undefined); return; }
    chatBusy = true; send.disabled = true; input.disabled = true;
    window.MefiCompanionHub?.thinking(true);
    let answered = false;
    const status = panes.ask.querySelector("[role=status]"); status.textContent = `${companionName()} is thinking…`;
    try {
      const result = await window.mefiStudio.assistantMessage(value, undefined, { view: viewLabel(), companion: companionName() });
      if (!result?.ok) throw new Error(result?.error || "The message could not be sent.");
      input.value = ""; status.textContent = "";
      await refreshConversation();
      answered = true;
    } catch (error) { status.textContent = plain(error, "The message could not be sent. Try again."); }
    finally { chatBusy = false; window.MefiCompanionHub?.thinking(false, { celebrate: answered }); send.disabled = false; input.disabled = false; if (!host.panel.hidden && !panes.ask.hidden) input.focus(); }
  }
  // What I'm doing: the work being built, the team and what they said to each
  // other (read when the tab opens), then recent activity (kept live by render).
  let nowRead = 0;
  async function refreshNow() {
    const live = panes.now?.querySelector(".companion-now-live");
    if (!live || !window.mefiStudio?.assistantState) return;
    const read = ++nowRead;
    const [full, status] = await Promise.all([window.mefiStudio.assistantState().catch(() => null), Promise.resolve(window.mefiStudio.assistantStatus?.()).catch(() => null)]);
    if (read !== nowRead) return;
    const state = full?.state || {}, agents = state.agents || [], jobs = status?.status?.running || [];
    const parts = [node("h3", "", jobs.length ? `Building now · ${jobs.length}` : "Building now")];
    parts.push(...(jobs.length ? jobs.slice(0, 8).map((job) => node("p", "companion-item", job.title || job.taskId || "Task in progress")) : [node("p", "muted", "Nothing is being built right now.")]));
    const roster = node("div", "companion-team-list");
    for (const agent of agents) roster.append(node("p", "companion-item", `${agent.role || "agent"} · ${agent.status || "idle"}${agent.step ? ` · ${agent.step}` : ""}`));
    if (agents.length) parts.push(node("h3", "", "The team"), roster);
    const mail = (state.mail || []).slice(-6).reverse();
    if (mail.length) parts.push(node("h3", "", "What they told each other"), ...mail.map((item) => node("p", "companion-item", `${item.from || "agent"} → ${item.to || "team"}: ${item.text || ""}`)));
    live.replaceChildren(...parts);
    requestAnimationFrame(position);
  }
  function attach(options) {
    if (host) return;
    host = options;
    const { orb, panel } = host;
    orb.toggleAttribute("data-suspended", document.hidden);
    dock = node("span", "companion-dock"); orb.after(dock); dock.hidden = true;
    panel.classList.add("companion-dynamic");
    const head = node("header", "companion-shell-head"), title = node("div");
    const name = node("strong"); name.id = "companion-dynamic-name"; const status = node("span", "ab-quiet"); status.id = "companion-dynamic-status";
    title.append(name, status); head.append(title, button("", () => { if (window.MefiCompanionHub?.isOpen()) window.MefiCompanionHub.back(); else { host.toggle(false); orb.focus({ preventScroll: true }); } })); head.lastChild.setAttribute("aria-label", "Close assistant menu");
    head.lastChild.innerHTML = '<svg class="glyph" aria-hidden="true" focusable="false"><use href="#g-close"/></svg>'; head.lastChild.title = "Close (Esc)";
    const tabs = node("div", "companion-tabs"); tabs.setAttribute("role", "tablist"); tabs.setAttribute("aria-label", "Assistant menu");
    const content = node("div", "companion-content"); content.id = "companion-content";
    for (const [key, label] of [["ask", "Talk"], ["status", "Needs you"], ["now", "Now"], ["settings", "Settings"]]) {
      const control = button(label, () => selectTab(key)); control.dataset.companionTab = key; control.id = `companion-tab-${key}`; control.setAttribute("role", "tab"); control.setAttribute("aria-controls", `companion-pane-${key}`);
      control.addEventListener("keydown", (event) => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); event.stopPropagation(); const all = Array.from(tabs.children), at = all.indexOf(control); const next = event.key === "Home" ? 0 : event.key === "End" ? all.length - 1 : (at + (event.key === "ArrowLeft" ? -1 : 1) + all.length) % all.length; all[next].click(); all[next].focus(); }); tabs.append(control);
      const pane = node("div", "companion-menu-pane"); pane.id = `companion-pane-${key}`; pane.setAttribute("role", "tabpanel"); pane.setAttribute("aria-labelledby", control.id); pane.hidden = key !== tab; content.append(pane); panes[key] = pane;
    }
    // Explicit DOM contract used by the companion's keyboard entry point.
    panes.ask.id = "companion-pane-ask";
    panel.replaceChildren(head, tabs, content);
    const thread = node("div", "companion-thread"); thread.setAttribute("aria-live", "polite");
    const input = node("textarea"); input.rows = 3; input.maxLength = 2000; input.placeholder = "Ask me, or describe a task to make…"; input.setAttribute("aria-label", "Message your companion");
    input.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendConversation(); } });
    const actions = node("div", "companion-ask-actions");
    actions.append(button("Create a task", () => { input.value = "Create a task: "; input.focus(); }), button("Send", sendConversation)); actions.lastChild.dataset.send = "true";
    const chatStatus = node("p", "ab-quiet"); chatStatus.setAttribute("role", "status");
    // Three questions worth one tap, whatever the thread holds.
    const starters = node("div", "companion-starters");
    starters.append(chip("What are you doing?", "What are you doing right now?"), chip("What's next?", "What should we work on next?"), chip("Recap today", "Recap what happened today."));
    panes.ask.append(thread, starters, input, actions, chatStatus);
    // Typing while you are in the panel (or resting the pointer on it) goes to
    // Talk's box, from whichever tab it opened on, not to Studio's shortcuts.
    const talkBox = () => { if (panel.hidden) return null; if (tab !== "ask") selectTab("ask"); return input; };
    window.MefiNav?.typeScope?.(panel, talkBox);
    window.MefiNav?.typeScope?.(orb, talkBox);
    const places = node("div", "companion-places");
    for (const [label, route, options] of [["Tasks", "tasks"], ["Map", "command"], ["Team", "agents"], ["Project map", "agent-brain", { tab: "map" }], ["Settings", "studio"]]) places.append(button(label, () => { host.toggle(false); window.MefiNav?.go(route, options); }));
    const location = node("p", "ab-quiet"); location.dataset.companionLocation = "true";
    panes.ask.append(location, places);
    const nowLive = node("div", "companion-now-live"); nowLive.setAttribute("aria-live", "polite");
    const nowActivity = node("div", "companion-now-activity");
    panes.now.append(nowLive, node("h3", "", "Recently"), nowActivity, button("Open the Map", () => { host.toggle(false); window.MefiNav?.go("command"); }));
    // Replies that land later, and the notices the team posts, appear while
    // the Ask tab is open instead of on its next visit.
    window.mefiStudio?.onAssistant?.(() => {
      if (chatBusy || host.panel.hidden || panes.ask.hidden) return;
      clearTimeout(conversationTimer);
      conversationTimer = setTimeout(refreshConversation, 250);
    });
    const growth = node("span", "companion-growth"); growth.setAttribute("aria-hidden", "true"); for (let i = 0; i < 3; i++) growth.append(node("i")); orb.append(growth);
    // Settings, top to bottom: who it is, how it works, what it has learned,
    // and the shortcuts Quick actions used to hold.
    heading("Personality");
    addField("personality", "Personality", PERSONALITIES.map(([value, text]) => [value, text]), (value) => preference({ personality: value }));
    const says = node("p", "ab-quiet"); says.id = "companion-personality-says"; panes.settings.append(says);
    addField("look", "Companion look", [["wisp", "Wisp"], ["fox", "Fox"], ["owl", "Owl"], ["cat", "Cat"], ["person", "Person"]], (value) => preference({ look: value }));
    addField("expressions", "Little faces and reactions", null, (value) => preference({ expressions: value }));
    addField("antics", "Idle play while you work", null, (value) => preference({ antics: value }));
    addField("bubbles", "Show speech bubbles", null, (value) => preference({ bubbles: value }));
    addField("roaming", "Roam around the studio", null, (value) => preference({ roaming: value }));
    addField("pinned", "Pin companion position", null, (value) => preference({ pinned: value, anchor: anchor() }));
    addField("growth", "Show project growth", null, (value) => preference({ growth: value }));
    addField("scope", "Project reach", [["project", "Current project"], ["all", "All projects"]], (value) => preference({ scope: value }));
    const bond = node("p", "ab-quiet"); bond.id = "companion-bond"; panes.settings.append(bond);
    heading("Work");
    for (const [key, label] of [["newWork", "Allow new work"], ["enabled", "Run the queue"], ["proactive", "Proactive suggestions"]]) addField(key, label, null, (value) => window.MefiAgentControls?.set(key, value));
    const permissions = document.createElement("div"); permissions.id = "companion-autonomy";
    panes.settings.append(permissions); window.MefiAutonomy?.mount(permissions, { full: true });
    heading("What I've learned");
    const learned = node("div", "companion-learned"); panes.settings.append(learned);
    heading("Shortcuts");
    const shortcuts = node("div", "companion-places");
    for (const [label, run] of [["Walk me through setup", () => window.MefiOnboarding?.open?.()], ["Team & connections", () => window.MefiNav?.go("agents", { section: "setup", pane: "team" })], ["Audio & music", () => window.MefiMusic?.openAudio?.()], ["Studio styling", () => window.MefiNav?.go("studio", { category: "appearance" })]]) {
      shortcuts.append(button(label, () => { window.MefiCompanionHub?.close?.({ immediate: true, restore: false }); host.toggle(false); run(); }));
    }
    panes.settings.append(shortcuts);
    orb.addEventListener("pointerdown", startDrag);
    orb.addEventListener("click", (event) => { if (dragged) { event.preventDefault(); event.stopImmediatePropagation(); dragged = false; } }, true);
    document.addEventListener("pointermove", (event) => {
      pointer = { x: event.clientX, y: event.clientY };
      if (dragging) {
        const dx = pointer.x - dragging.x, dy = pointer.y - dragging.y;
        if (Math.hypot(dx, dy) > 5) { dragged = true; host.toggle(false); floatAt(dragging.left + dx, dragging.top + dy, false); }
      } else updateHover();
    }, { passive: true });
    const endDrag = () => { if (!dragging) return; dragging = null; if (dragged) preference({ pinned: true, anchor: anchor() }); };
    orb.addEventListener("pointerup", endDrag); orb.addEventListener("pointercancel", endDrag); orb.addEventListener("lostpointercapture", endDrag);
    // Dragging the orb out of the rail's dock (the 0.5 frame) moves it to the page, which drops its pointer capture: the release
    // is heard on the document too, or the orb would stay on the pointer and its new place would never be saved.
    document.addEventListener("pointerup", endDrag, true); document.addEventListener("pointercancel", endDrag, true);
    panel.addEventListener("keydown", () => { keyboard = true; });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !panel.hidden && !window.MefiCompanionHub?.isOpen()) { event.preventDefault(); event.stopImmediatePropagation(); host.toggle(false); orb.focus({ preventScroll: true }); } }, true);
    panel.addEventListener("pointerdown", () => { keyboard = false; });
    panel.addEventListener("focusout", () => setTimeout(updateHover, 0));
    orb.addEventListener("focus", () => { if (orb.matches(":focus-visible")) { keyboard = true; stopTravel(); } });
    for (const el of [orb, panel]) { el.addEventListener("pointerenter", updateHover); el.addEventListener("pointerleave", updateHover); }
    window.addEventListener("resize", () => { stopTravel(); if (orb.dataset.roaming) { const box = orb.getBoundingClientRect(); floatAt(box.left, box.top, false); } position(); });
    window.addEventListener("blur", () => { clearTimeout(openTimer); openTimer = null; clearTimeout(closeTimer); closeTimer = null; stopTravel(); if (!editing() && !window.MefiCompanionHub?.isOpen()) host.toggle(false); });
    document.addEventListener("visibilitychange", () => { host.orb.toggleAttribute("data-suspended", document.hidden); clearTimeout(roamTimer); stopTravel(); if (!document.hidden) scheduleRoam(); });
    window.addEventListener("mefi:queue-settings", () => { if (latest) render(latest); });
    window.addEventListener("mefi:nav", () => { if (!panel.hidden) host.toggle(false); });
    selectTab("status"); scheduleRoam();
  }
  function startDrag(event) {
    if (event.button !== 0) return;
    stopTravel(); const box = host.orb.getBoundingClientRect(); dragging = { x: event.clientX, y: event.clientY, left: box.left, top: box.top }; dragged = false;
    host.orb.setPointerCapture?.(event.pointerId);
  }
  function anchor() { const box = host.orb.getBoundingClientRect(); return { x: box.left / Math.max(1, innerWidth - 44), y: box.top / Math.max(1, innerHeight - 44) }; }
  function floatAt(x, y, animate) {
    const { orb } = host, before = orb.getBoundingClientRect();
    if (orb.parentElement !== document.body) { dock.hidden = false; document.body.append(orb); }
    orb.dataset.roaming = "true"; orb.classList.add("floating");
    const area = room();
    x = Math.max(area.left + 8, Math.min(area.right - 48, x)); y = Math.max(area.top + 8, Math.min(area.bottom - 48, y));
    Object.assign(orb.style, { left: `${x}px`, top: `${y}px`, bottom: "auto", margin: "0" });
    if (animate && !reduced()) {
      // A move between clear edges must not sweep across a form or a dialog.
      // If the connecting path is occupied, appear at the clear edge instead.
      const steps = Math.max(1, Math.ceil(Math.hypot(before.left - x, before.top - y) / 24));
      const clearPath = Array.from({ length: steps }, (_, i) => (i + 1) / steps).every((t) => safeSpot(before.left + (x - before.left) * t, before.top + (y - before.top) * t));
      travel?.cancel(); travel = orb.animate(clearPath ? [{ transform: `translate(${before.left - x}px, ${before.top - y}px)` }, { transform: "translate(0, 0)" }] : [{ opacity: 0 }, { opacity: 1 }], { duration: clearPath ? 1800 : 220, easing: "cubic-bezier(.4,0,.2,1)" });
      travel.onfinish = () => { travel = null; };
    }
  }
  function safeSpot(x, y) {
    if (Array.from(document.querySelectorAll('[aria-modal="true"]')).some((el) => !el.closest("[hidden]") && el.getClientRects().length) || document.querySelector(".studio-choice-popup")) return false;
    for (const [dx, dy] of [[0, 0], [35, 0], [0, 35], [35, 35], [18, 18]]) {
      const target = document.elementsFromPoint(x + dx, y + dy).find((el) => !el.closest(".companion-orb, #studio-floats, .companion-bubble"));
      if (!target || target.closest("button, a, input, textarea, select, [role=button], [role=tab], nav, canvas, .toast, [role=alert], p, h1, h2, h3, li, label") || Array.from(target.childNodes).some((part) => part.nodeType === 3 && part.textContent.trim())) return false;
    }
    return true;
  }
  function scheduleRoam() {
    clearTimeout(roamTimer);
    if (document.hidden) return;
    roamTimer = setTimeout(() => {
      const prefs = latest?.state || {};
      if (host && prefs.roaming !== false && !prefs.pinned && !reduced() && host.panel.hidden && !window.MefiCompanionHub?.isOpen() && !near() && !dragging && document.activeElement !== host.orb) {
        const rail = railEdge(), area = room();
        const spots = [[area.right - 52, Math.max(110, area.top + 54)], [area.right - 52, area.bottom - 64], [rail + 14, area.bottom - 60], [area.right - 58, area.bottom * .46]];
        const offset = Math.floor(Math.random() * spots.length);
        const choice = spots.map((_, index) => spots[(offset + index) % spots.length]).find(([x, y]) => safeSpot(x, y));
        if (choice) floatAt(choice[0], choice[1], true); else returnToDock();
      }
      scheduleRoam();
    }, 9000);
  }
  function returnToDock() {
    if (!host || !dock?.isConnected) return;
    stopTravel(); dock.before(host.orb); dock.hidden = true; host.orb.removeAttribute("data-roaming"); host.orb.classList.remove("floating"); host.orb.style.cssText = "";
  }
  // Rows are kept by id and rebuilt when their data changes. Only a half-typed
  // answer holds a changed row back. A row that left the list always goes: the
  // option button just clicked keeps focus, and holding on to whatever held
  // focus left answered asks on screen (dead, the count already 0) until
  // another click, such as Clear list, moved focus away.
  function keyed(parent, items, make) {
    const held = document.activeElement;
    const typing = Boolean(held?.matches?.("input:not([type=button]):not([type=checkbox]):not([type=radio]), textarea, [contenteditable=true]"));
    const old = new Map(Array.from(parent.children).map((el) => [el.dataset.itemId, el]));
    const wanted = new Set();
    // Where keyboard focus goes when the row holding it is rebuilt or removed:
    // the new row, else the row that took the old one's place, else the list.
    let focusLost = false, landing = null;
    for (const item of items) {
      const id = String(item.id), signature = JSON.stringify(item); wanted.add(id);
      let el = old.get(id);
      if (!el || el.dataset.signature !== signature && !(typing && el.contains(held))) {
        const next = make(item); next.dataset.itemId = id; next.dataset.signature = signature;
        if (el) { if (el.contains(held)) { focusLost = true; landing = next; } el.replaceWith(next); } else parent.append(next);
        el = next;
      }
    }
    for (const [id, el] of old) {
      if (wanted.has(id)) continue;
      if (el.contains(held)) { focusLost = true; landing = el.nextElementSibling ?? el.previousElementSibling; }
      el.remove();
    }
    if (focusLost && parent.isConnected && !parent.closest("[hidden]")) {
      const controls = "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])";
      const next = (landing?.isConnected ? landing.querySelector(controls) : null) ?? parent.querySelector(controls);
      if (next) next.focus({ preventScroll: true });
      else { if (!parent.hasAttribute("tabindex")) parent.tabIndex = -1; parent.focus({ preventScroll: true }); }
    }
  }
  function render(data) {
    if (!host || !data) return;
    latest = data;
    window.MefiCompanionHub?.update(data);
    const state = data.state || {};
    if (state.pinned) stopTravel();
    const name = document.getElementById("companion-dynamic-name"), status = document.getElementById("companion-dynamic-status");
    if (name.textContent !== data.name) name.textContent = data.name;
    if (status.textContent !== data.status) status.textContent = data.status;
    const learning = state.learning || {}, earned = [learning.systems > 0, learning.verifiedRecipes > 0, (state.preferences || []).length > 0];
    host.orb.dataset.growth = state.growth === false ? "0" : String(earned.filter(Boolean).length);
    if (!state.pinned && state.roaming === false) returnToDock();
    if (state.pinned && state.anchor && !dragging && !host.orb.dataset.roaming) floatAt(state.anchor.x * (innerWidth - 44), state.anchor.y * (innerHeight - 44), false);
    if (state.bubbles === false) host.bubble.hidden = true;
    for (const [key, control] of Object.entries(fields)) {
      if (control.disabled || control === document.activeElement && control.type !== "checkbox") continue;
      const value = ["newWork", "enabled", "proactive"].includes(key) ? window.MefiAgentControls?.snapshot()?.[key] : state[key];
      if (control.type === "checkbox") control.checked = ["roaming", "bubbles", "growth", "expressions"].includes(key) ? value !== false : value === true;
      else control.value = value || ({ look: "wisp", personality: "balanced" }[key] ?? "project");
    }
    const personality = PERSONALITIES.find(([value]) => value === (state.personality || "balanced"));
    const says = document.getElementById("companion-personality-says");
    if (says && personality && says.textContent !== personality[2]) says.textContent = personality[2];
    const bond = document.getElementById("companion-bond");
    if (bond) bond.textContent = state.bond ? `${data.name || companionName()} · ${state.bond}` : "";
    const statusItems = [];
    if (data.digest) statusItems.push({ id: "digest", kind: "digest", ...data.digest });
    const waiting = state.queue?.items || [];
    for (const item of waiting) statusItems.push(item);
    // Below the list, so each item's own answer stays the first control.
    if (waiting.length && data.clearItem) statusItems.push({ id: "clear", kind: "clear", count: waiting.length });
    if (!statusItems.length) statusItems.push({ id: "empty", kind: "empty", text: state.state === "working" ? "Agents are working. I'll let you know when something needs you." : "All quiet. Ready when you are." });
    keyed(panes.status, statusItems, (item) => {
      if (item.kind === "empty") return node("p", "muted", item.text);
      if (item.kind === "clear") return data.clearItem(item);
      if (item.kind === "digest") { const box = node("div", "companion-digest"); box.append(node("strong", "", item.headline)); for (const line of item.lines || []) box.append(node("p", "ab-quiet", line)); box.append(button("Thanks", data.dismissDigest)); return box; }
      return data.queueItem(item);
    });
    const activity = (state.activity || []).map((event, index) => ({ ...event, id: event.id || `${event.at}:${index}` }));
    keyed(panes.now.querySelector(".companion-now-activity"), activity.length ? activity.slice(0, 12) : [{ id: "empty", text: "Project activity will appear here as work happens." }], (event) => { const box = node("div", "companion-item"); box.append(node("strong", "", event.text || event.title || String(event.kind || "Activity").replaceAll(".", " "))); if (event.at) box.append(node("span", "ab-quiet", new Date(event.at).toLocaleTimeString())); return box; });
    const learned = [{ id: "project", text: `${state.projectName || "This project"} · ${learning.systems || 0} mapped systems` }, { id: "workflows", text: `${learning.verifiedRecipes || 0} workflows with verified success` }, ...(state.preferences || []).map((text, index) => ({ id: `preference:${index}`, text })), ...(state.studioPreferences || []).map((text, index) => ({ id: `studio-preference:${index}`, text: `Studio observation: ${text}` })), { id: "explanation", text: "The three companion lights mark project knowledge, verified workflows, and learned preferences. Observations stay suggestions; they never change permissions or answer for you." }];
    keyed(panes.settings.querySelector(".companion-learned"), learned, (item) => node("p", item.id === "explanation" ? "ab-quiet" : "companion-item", item.text));
    if (!host.panel.hidden) requestAnimationFrame(position);
  }
  function opened(open, options = {}) {
    if (!host) return;
    panelAnchor = null;
    clearTimeout(openTimer); openTimer = null; clearTimeout(closeTimer); closeTimer = null;
    if (open) { stopTravel(); if (!options.hover) { keyboard = document.activeElement === host.orb && host.orb.matches(":focus-visible"); selectTab("ask"); } window.MefiAgentControls?.refresh(); requestAnimationFrame(position); }
    else window.MefiSelect?.close();
  }
  // context(): what every chat box sends with a message, so the reply knows
  // the owner's screen and the name they gave their companion.
  window.MefiCompanionUI = { attach, render, opened, position, showTab: selectTab, managed: () => Boolean(host), freeze: stopTravel, tab: () => tab, context: () => ({ view: viewLabel(), companion: companionName() }) };
})();
