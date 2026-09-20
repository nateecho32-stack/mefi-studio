// Mefi's Studio AI+ — navigation registry: one list of destinations behind the
// tabs-row tools cluster, the Command dock, the sheet-header links, the palette,
// the help sheet, the footer line and every global key. Nothing else in the
// renderer may hard-code a destination, so the six surfaces cannot drift apart.
(function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const ESC_HELP = "Close the top-most layer: palette → help → sheet → Command (clear selection, then leave)";
  const BADGE_THROTTLE_MS = 2000;
  const BADGE_POLL_MS = 20000;
  const RESUME_KEY = "mefiStudio.resume";
  // Fields a live-update reload carries across: text-like inputs and textareas
  // that have an id. Checkboxes and selects are settings and persist elsewhere.
  const FIELD_SELECTOR = "input[type=text][id], input[type=search][id], input[type=url][id], input:not([type])[id], textarea[id]";
  const TYPING_SELECTOR = "input:not([type]), input[type=text], input[type=search], input[type=url], input[type=password], input[type=email], input[type=number], textarea, [contenteditable]";

  // Layer bookkeeping. Other modules read it; only claim/release write it.
  const state = { sheet: null, transient: null, returnTo: null, focusReturn: { sheet: null, transient: null } };
  // assistant holds the service tone (ok | busy | warn | offline | paused), painted
  // as a dot on the Explorer's dock item and tool button.
  const badges = { sessions: 0, progress: 0, tasks: 0, ideas: 0, machine: null, assistant: null };
  let lastBadgeRefresh = 0;

  // A record with no key, or a multi-character display key such as "Ctrl K",
  // needs its own keyMatch or it never matches (spec 2.2).
  const defaultKeyMatch = (key) => (event) =>
    typeof key === "string" &&
    key.length === 1 &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    event.key.length === 1 &&
    event.key.toLowerCase() === key.toLowerCase();

  const showIn = (parts) => ({ tabs: false, tools: false, dock: false, palette: false, help: false, footer: false, ...parts });
  const idleActive = () => Boolean(window.MefiIdle?.isActive?.());
  const overlayOpen = (elementId) => {
    const element = document.getElementById(elementId);
    return Boolean(element && !element.hidden);
  };
  const tabOpen = (name) => {
    const section = document.querySelector(`#tab-${name}`);
    return Boolean(section && !section.hidden) && !idleActive();
  };
  const idleLayer = () => document.getElementById("idle-layer");
  const focusIdle = () => idleLayer()?.focus?.({ preventScroll: true });
  const machineLevel = (status) => (!status ? null : status.leases?.exclusive ? "exclusive" : status.wait ? "busy" : "free");
  const openTasks = (tasks) => (Array.isArray(tasks) ? tasks : []).filter((task) => task.status === "open" || task.status === "active").length;
  const unreadIdeas = (ideas) => (Array.isArray(ideas) ? ideas : []).filter((idea) => !idea.read).length;
  const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

  // ---- registry ----------------------------------------------------------

  const registry = [
    {
      id: "workspace", label: "Your workspace", short: "Workspace", kind: "view", layer: null,
      commandPrimary: true,
      group: "surfaces", key: "H", glyph: "g-command", badge: null,
      desc: "Projects, your companion, and work from idea to done",
      searchTerms: "home project folder conversation chat give task review done",
      showIn: showIn({ dock: true, palette: true, help: true, footer: true }),
      open: () => window.MefiWorkspace?.enter?.(), close: () => window.MefiWorkspace?.exit?.(),
      isOpen: () => Boolean(window.MefiWorkspace?.isActive?.()),
    },
    {
      id: "command",
      label: "Command view",
      short: "Command",
      kind: "view",
      layer: null,
      group: "surfaces",
      key: "D",
      glyph: "g-command",
      badge: "progress",
      desc: "The node tree / constellation — sessions, agents, todos and tasks",
      searchTerms: "node tree live work monitor progress workers",
      showIn: showIn({ palette: true, help: true, footer: true }),
      open: (params) => window.MefiIdle?.enter?.(true, params),
      close: () => window.MefiIdle?.exit?.(),
      isOpen: () => idleActive(),
    },
    {
      id: "booklet",
      label: "Model catalog",
      short: "Model catalog",
      kind: "tab",
      layer: null,
      group: "surfaces",
      key: "1",
      glyph: "g-booklet",
      badge: null,
      desc: "The model booklet, filters and search",
      showIn: showIn({ dock: true, palette: true, help: true }),
      open: () => window.MefiBooklet?.showTab?.("booklet"),
      isOpen: () => tabOpen("booklet"),
    },
    {
      id: "graph",
      label: "Model Lab",
      short: "Model Lab",
      kind: "tab",
      layer: null,
      group: "surfaces",
      key: "2",
      glyph: "g-graph",
      badge: null,
      desc: "Measured model performance, usage and context; published catalog tools",
      showIn: showIn({ dock: true, palette: true, help: true }),
      open: () => window.MefiBooklet?.showTab?.("graph"),
      isOpen: () => tabOpen("graph"),
    },
    {
      id: "eyes",
      label: "Activity & evidence",
      short: "Activity",
      kind: "tab",
      layer: null,
      group: "surfaces",
      key: "3",
      glyph: "g-eyes",
      badge: "progress",
      desc: "A-Eyes: live agent activity, diffs, evidence PNGs and pins",
      showIn: showIn({ dock: true, palette: true, help: true }),
      open: () => window.MefiBooklet?.showTab?.("eyes"),
      isOpen: () => tabOpen("eyes"),
    },
    {
      id: "studio",
      label: "Settings & connections",
      short: "Settings",
      kind: "tab",
      layer: null,
      group: "surfaces",
      key: "4",
      glyph: "g-studio",
      badge: null,
      desc: "Assistant and coding providers, API keys, optional integrations and app updates",
      searchTerms: "settings connections api key login setup provider workers",
      showIn: showIn({ dock: true, palette: true, help: true }),
      open: () => window.MefiBooklet?.showTab?.("studio"),
      isOpen: () => tabOpen("studio"),
    },
    {
      id: "explorer",
      commandPrimary: true,
      label: "Session explorer",
      short: "Explorer",
      kind: "overlay",
      layer: "sheet",
      group: "tools",
      key: "E",
      glyph: "g-explorer",
      badge: "machine",
      dot: "assistant",
      desc: "Sessions, checkpoints, the assistant, the machine and the request inbox",
      showIn: showIn({ tools: true, dock: true, palette: true, help: true }),
      element: "explorer-overlay",
      focus: "#explorer-tree li.selected, #explorer-tree li",
      open: (params) => window.MefiExplorer?.open?.(params),
      close: () => window.MefiExplorer?.close?.(),
      isOpen: () => overlayOpen("explorer-overlay"),
    },
    {
      id: "tasks",
      commandPrimary: true,
      label: "Task board",
      short: "Task board",
      kind: "overlay",
      layer: "sheet",
      group: "tools",
      key: "T",
      glyph: "g-tasks",
      badge: "tasks",
      desc: "Board, per-task logs and references",
      showIn: showIn({ tools: true, dock: true, palette: true, help: true }),
      element: "tasks-overlay",
      focus: "#task-new",
      open: (params) => window.MefiTasks?.open?.(params),
      close: () => window.MefiTasks?.close?.(),
      isOpen: () => overlayOpen("tasks-overlay"),
    },
    {
      id: "plans",
      commandPrimary: true,
      label: "Plans",
      short: "Plans",
      kind: "overlay",
      layer: "sheet",
      group: "tools",
      key: null,
      glyph: "g-ideas",
      badge: null,
      desc: "Explore an idea, settle decisions, and create reviewed tasks",
      searchTerms: "plan an idea planning questions specification approval",
      showIn: showIn({ tools: true, dock: true, palette: true, help: true }),
      element: "plans-overlay",
      focus: "#plans-new",
      open: (params) => window.MefiPlanning?.open?.(params),
      close: () => window.MefiPlanning?.close?.(),
      isOpen: () => overlayOpen("plans-overlay"),
    },
    {
      id: "ideas",
      commandPrimary: true,
      label: "Feature ideas",
      short: "Ideas",
      kind: "overlay",
      layer: "sheet",
      group: "tools",
      key: "I",
      glyph: "g-ideas",
      badge: "ideas",
      desc: "Unread idea inbox and the feature graph",
      showIn: showIn({ tools: true, dock: true, palette: true, help: true }),
      element: "ideas-overlay",
      focus: "#ideas-list li",
      open: (params) => window.MefiIdeas?.open?.(params),
      close: () => window.MefiIdeas?.close?.(),
      isOpen: () => overlayOpen("ideas-overlay"),
    },
    {
      id: "overhead",
      label: "Overhead",
      short: "Overhead",
      kind: "overlay",
      layer: "sheet",
      group: "tools",
      key: "O",
      glyph: "g-overhead",
      badge: null,
      desc: "The node tree from above with task boxes",
      showIn: showIn({ tools: true, dock: true, palette: true, help: true }),
      element: "overhead-overlay",
      focus: "#overhead-close",
      open: () => window.MefiOverhead?.open?.(),
      close: () => window.MefiOverhead?.close?.(),
      isOpen: () => overlayOpen("overhead-overlay"),
    },
    {
      id: "profiler", label: "Performance profiler", short: "Profiler", kind: "overlay", layer: "sheet", group: "tools",
      key: null, glyph: "g-graph", badge: null,
      desc: "Record frame timings, rendering hotspots, host requests, CPU and memory",
      searchTerms: "debug diagnostics lag slow fps hitch performance profiler cpu memory",
      showIn: showIn({ tools: true, palette: true, help: true }),
      element: "profiler-overlay", focus: "#profiler-start",
      open: () => window.MefiProfiler?.open?.(), close: () => window.MefiProfiler?.close?.(),
      isOpen: () => overlayOpen("profiler-overlay"),
    },
    {
      id: "analyzer",
      label: "Analyzer",
      short: "Analyzer",
      kind: "overlay",
      layer: "sheet",
      group: "tools",
      key: "A",
      glyph: "g-analyzer",
      badge: null,
      desc: "Read a file or verify an idea against the work tree",
      showIn: showIn({ tools: true, dock: true, palette: true, help: true }),
      element: "analyzer-overlay",
      focus: "#analyzer-idea",
      open: (params) => window.MefiAnalyzer?.open?.(params),
      close: () => window.MefiAnalyzer?.close?.(),
      isOpen: () => overlayOpen("analyzer-overlay"),
    },
    {
      id: "palette",
      commandPrimary: true,
      label: "Command palette",
      short: "Palette",
      kind: "overlay",
      layer: "transient",
      group: "system",
      key: "Ctrl K",
      keyMatch: (event) => (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k",
      glyph: "g-palette",
      badge: null,
      desc: "Jump to a surface, tool, action, task, node or model",
      showIn: showIn({ tools: true, dock: true, help: true, footer: true }),
      element: "palette-overlay",
      focus: "#palette-input",
      open: () => window.MefiPalette?.open?.(),
      close: () => window.MefiPalette?.close?.(),
      isOpen: () => overlayOpen("palette-overlay"),
    },
    {
      id: "music", label: "Music & themes", short: "Music", kind: "overlay", layer: "sheet",
      group: "tools", glyph: "g-music", badge: null, commandPrimary: true,
      desc: "Local music, Spotify links, AI suggestions, and Studio themes",
      searchTerms: "color colour appearance accent theme sound audio background",
      showIn: showIn({ dock: true, palette: true, help: true }),
      element: "music-overlay", focus: "#music-close",
      open: (params) => window.MefiMusic?.open?.(params), close: () => window.MefiMusic?.close?.(),
      isOpen: () => overlayOpen("music-overlay"),
    },
    {
      id: "onboarding", label: "Start here · walkthrough", short: "Start here", kind: "overlay", layer: "transient",
      group: "system", key: null, glyph: "g-help", badge: null,
      desc: "Get started: project, connections, task or plan, monitoring and review",
      searchTerms: "getting started guide tutorial help welcome onboarding",
      showIn: showIn({ dock: true, tools: true, palette: true }),
      element: "walkthrough-overlay", focus: "#walkthrough-title",
      open: () => window.MefiOnboarding?.open?.(), close: () => window.MefiOnboarding?.close?.(),
      isOpen: () => overlayOpen("walkthrough-overlay"),
    },
    {
      id: "help",
      label: "Shortcuts",
      short: "Shortcuts",
      kind: "overlay",
      layer: "transient",
      group: "system",
      key: "?",
      keyMatch: (event) => event.key === "?",
      glyph: "g-help",
      badge: null,
      desc: "Every key, generated from this registry",
      showIn: showIn({ dock: true, palette: true, help: true, footer: true }),
      element: "help-overlay",
      focus: "#help-overlay .sheet",
      open: () => window.MefiBooklet?.toggleHelp?.(true),
      close: () => window.MefiBooklet?.toggleHelp?.(false),
      isOpen: () => overlayOpen("help-overlay"),
    },
    {
      id: "search",
      label: "Model search",
      short: "Search",
      kind: "action",
      layer: null,
      group: "system",
      key: "/",
      glyph: "g-search",
      badge: null,
      desc: "Show the Booklet and focus its search field",
      showIn: showIn({ palette: true, help: true }),
      run: () => {
        go("booklet");
        document.getElementById("search")?.focus();
      },
    },
    {
      id: "refresh",
      label: "Refresh catalog",
      short: "Refresh",
      kind: "action",
      layer: null,
      group: "system",
      key: "R",
      glyph: "g-refresh",
      badge: null,
      desc: "Re-read data/models.json",
      showIn: showIn({ palette: true, help: true }),
      run: () => window.MefiBooklet?.refresh?.("keyboard"),
    },
    {
      id: "pinRail",
      label: "Pin the node tree",
      short: "Pin rail",
      kind: "action",
      layer: null,
      group: "system",
      key: "G",
      glyph: "g-pin",
      badge: null,
      desc: "Keep the node-tree rail open",
      showIn: showIn({ palette: true, help: true }),
      run: () => window.MefiTree?.togglePin?.(),
    },
    {
      id: "print",
      label: "Print / PDF booklet",
      short: "Print",
      kind: "action",
      layer: null,
      group: "system",
      key: null,
      glyph: "g-print",
      badge: null,
      desc: "Print the booklet on a light background",
      showIn: showIn({ palette: true }),
      run: () => window.print(),
    },
    {
      id: "audit",
      label: "Run auditor",
      short: "Auditor",
      kind: "action",
      layer: null,
      group: "system",
      key: null,
      glyph: null,
      badge: null,
      desc: "Wiring and gap checks for this app",
      showIn: showIn({ palette: true }),
      run: () => {
        go("explorer");
        setTimeout(() => document.getElementById("audit-run")?.click(), 400);
      },
    },
    {
      id: "machine",
      label: "Machine status",
      short: "Machine",
      kind: "action",
      layer: null,
      group: "system",
      key: null,
      glyph: null,
      badge: null,
      desc: "Test leases, LOVE runs and auto-kill",
      showIn: showIn({ palette: true }),
      run: () => go("explorer"),
    },
    {
      id: "scanIdeas",
      label: "Scan chats for ideas",
      short: "Scan ideas",
      kind: "action",
      layer: null,
      group: "system",
      key: null,
      glyph: null,
      badge: null,
      desc: "Read recent chats and capture new feature ideas",
      showIn: showIn({ palette: true }),
      run: () => window.MefiIdeas?.scan?.(false),
    },
    {
      id: "motion",
      label: "Toggle motion",
      short: "Motion",
      kind: "action",
      layer: null,
      group: "system",
      key: null,
      glyph: null,
      badge: null,
      desc: "Pause or resume every animation",
      showIn: showIn({ palette: true }),
      run: () => document.getElementById("motion-toggle")?.click(),
    },
  ];

  function get(id) {
    return registry.find((dest) => dest.id === id) ?? null;
  }

  function register(dest) {
    if (!dest?.id) return null;
    const index = registry.findIndex((item) => item.id === dest.id);
    if (index >= 0) registry[index] = dest;
    else registry.push(dest);
    return dest;
  }

  function list(filter) {
    if (filter?.showIn) return registry.filter((dest) => Boolean(dest.showIn?.[filter.showIn]));
    if (filter?.group) return registry.filter((dest) => dest.group === filter.group);
    return registry.slice();
  }

  function dispatchNav(id, action, params) {
    window.dispatchEvent(new CustomEvent("mefi:nav", { detail: { id, action, params: params ?? {} } }));
  }

  // ---- layers ------------------------------------------------------------

  // The focusable dialog root inside a destination's overlay, if it has one.
  function dialogRoot(dest) {
    const root = dest?.element ? document.getElementById(dest.element) : null;
    return root?.querySelector(".explorer-sheet, .sheet, .palette-sheet") ?? null;
  }

  function claim(id) {
    const dest = get(id);
    if (!dest?.layer) return;
    if (dest.layer === "sheet") {
      // Sheets are mutually exclusive; the transient layer above them is untouched.
      if (state.sheet && state.sheet !== id) get(state.sheet)?.close?.();
      state.sheet = id;
      document.body.dataset.sheet = id;
    } else {
      if (state.transient && state.transient !== id) get(state.transient)?.close?.();
      state.transient = id;
    }
    if (!state.focusReturn[dest.layer]) state.focusReturn[dest.layer] = document.activeElement;
    state.returnTo = idleActive() ? "command" : window.MefiWorkspace?.isActive?.() ? "workspace" : null;
    const root = dest.element ? document.getElementById(dest.element) : null;
    root?.classList.toggle("from-command", Boolean(state.returnTo));
    const back = root?.querySelector(".sheet-back");
    if (back) {
      const label = state.returnTo === "workspace" ? "Workspace" : "Command";
      back.title = `Back to ${label} (Esc)`;
      const copy = back.querySelector(".label");
      if (copy) copy.textContent = label;
    }
    const sheet = dialogRoot(dest);
    if (sheet) {
      sheet.setAttribute("role", "dialog");
      sheet.setAttribute("aria-modal", "true");
    }
    requestAnimationFrame(() => {
      const target = (dest.focus ? document.querySelector(dest.focus) : null) ?? sheet;
      target?.focus?.();
      // focus() reports nothing when the match is not focusable (a still-loading
      // list's muted <li>), and an aria-modal dialog may not open without focus.
      if (sheet && !sheet.contains(document.activeElement)) sheet.focus();
    });
    dispatchNav(id, "open", {});
  }

  function release(id) {
    const dest = get(id);
    const layer = dest?.layer ?? (state.sheet === id ? "sheet" : state.transient === id ? "transient" : null);
    if (state.sheet === id) {
      state.sheet = null;
      delete document.body.dataset.sheet;
      if (dest?.element) document.getElementById(dest.element)?.classList.remove("from-command");
    }
    if (state.transient === id) state.transient = null;
    let saved = layer ? state.focusReturn[layer] : null;
    const sidebarReturn = Boolean(saved?.closest?.("#workspace-sidebar-panel[inert]"));
    const closedMenu = saved?.closest?.("details:not([open])");
    if (closedMenu) saved = closedMenu.querySelector("summary");
    // <body> passes every visibility test but cannot take focus, so an overlay
    // opened with nothing focused would otherwise close to nowhere.
    const usable = Boolean(saved && saved !== document.body && saved.isConnected && !saved.hidden && !saved.closest?.("[hidden], [inert]"));
    if (sidebarReturn && !state.transient) {
      window.MefiSidebar?.focusToggle?.();
    } else if (idleActive() && state.sheet === null && state.transient === null) {
      focusIdle();
      window.MefiIdle?.bumpHud?.();
    } else if (usable) {
      saved.focus?.();
    } else if (state.sheet) {
      // A transient closed over a sheet that stays open: stay inside that dialog.
      dialogRoot(get(state.sheet))?.focus?.();
    } else if (window.MefiWorkspace?.isActive?.()) {
      document.getElementById("workspace-layer")?.focus?.({ preventScroll: true });
    } else {
      (document.querySelector(".tab.active") ?? document.getElementById("nav-command"))?.focus?.();
    }
    if (layer) state.focusReturn[layer] = null;
    dispatchNav(id, "close", {});
  }

  function top() {
    return state.transient ?? state.sheet ?? (idleActive() ? "command" : null);
  }

  function close(id) {
    get(id)?.close?.();
  }

  function closeAll() {
    if (state.transient) close(state.transient);
    if (state.sheet) close(state.sheet);
  }

  function closeTop() {
    if (state.transient) {
      close(state.transient);
      return true;
    }
    if (state.sheet) {
      close(state.sheet);
      return true;
    }
    if (idleActive()) return Boolean(window.MefiIdle?.escape?.());
    return false;
  }

  function go(id, params = {}, options = {}) {
    const dest = get(id);
    if (!dest) return;
    const navCommand = document.getElementById("nav-command");
    if (dest.kind === "action") {
      dest.run?.(params, options);
      dispatchNav(id, "open", params);
      return;
    }
    if (dest.kind === "view") {
      closeAll();
      if (id !== "workspace") window.MefiWorkspace?.exit?.();
      if (id !== "command" && idleActive()) window.MefiIdle?.exit?.();
      state.returnTo = null;
      navCommand?.classList.remove("return");
      dest.open?.(params);
      dispatchNav(id, "open", params);
      return;
    }
    if (dest.kind === "tab") {
      closeAll();
      window.MefiWorkspace?.exit?.();
      if (idleActive()) {
        window.MefiIdle?.exit?.();
        state.returnTo = "command";
        navCommand?.classList.add("return");
        // Only a deep link needs explaining; a plain tab click speaks for itself.
        if (params && Object.keys(params).length) window.MefiToast?.("D returns to Command", "info");
      }
      dest.open?.(params);
      if (id === "eyes") {
        // eyes.js registers both listeners synchronously in wire(), so this
        // lands even on the first visit to the tab.
        if (params?.sessionId !== undefined) {
          window.dispatchEvent(new CustomEvent("mefi:tree-select", { detail: { sessionId: params.sessionId } }));
        }
        if (params?.png) window.dispatchEvent(new CustomEvent("mefi:restore-png", { detail: { path: params.png } }));
      }
      dispatchNav(id, "open", params);
      return;
    }
    // Overlays claim their layer from inside open(), so exclusivity holds no
    // matter who opened them — dock, key, palette, card, tour or module.
    dest.open?.(params);
  }

  function toggle(id) {
    const dest = get(id);
    if (!dest) return;
    if (dest.isOpen?.()) close(id);
    else go(id);
  }

  // ---- badges ------------------------------------------------------------

  function paintBadges(root) {
    const scope = root ?? document;
    for (const element of scope.querySelectorAll("[data-badge]")) {
      const key = element.dataset.badge;
      const value = badges[key];
      if (element.dataset.badgeMode === "dot") {
        element.hidden = !value || value === "free";
        continue;
      }
      if (element.dataset.badgeMode === "tone") {
        // green while the service runs, amber when it wants attention, grey paused
        element.hidden = !value;
        element.classList.toggle("live", value === "ok" || value === "busy");
        element.classList.toggle("warn", value === "warn" || value === "offline");
        element.title = value ? `assistant · ${value}` : "";
        continue;
      }
      if (key === "machine") {
        element.textContent = value === "exclusive" ? "excl" : value === "busy" ? "busy" : "";
        element.classList.toggle("warn", value === "busy");
        element.classList.toggle("bad", value === "exclusive");
        element.hidden = !(value === "busy" || value === "exclusive");
        continue;
      }
      element.textContent = String(value ?? 0);
      element.hidden = !(Number(value) > 0);
    }
  }

  // Takes (key, value) or a single partial — tree3d.js pushes two counts at once.
  function setBadge(key, value) {
    const patch = key && typeof key === "object" ? key : { [key]: value };
    for (const [name, next] of Object.entries(patch)) {
      if (name in badges) badges[name] = next;
    }
    paintBadges();
    window.dispatchEvent(new CustomEvent("mefi:nav-badges", { detail: { badges } }));
    return badges;
  }

  // The push subscriptions below are the primary source; this is the backstop,
  // throttled so a busy agent cannot turn tree reloads into IPC storms.
  async function refreshBadges() {
    const now = Date.now();
    if (now - lastBadgeRefresh < BADGE_THROTTLE_MS) return badges;
    lastBadgeRefresh = now;
    const patch = {};
    const read = (method) => window.MefiBoot?.read ? window.MefiBoot.read(method) : Promise.resolve().then(() => window.mefiStudio?.[method]?.());
    const [tasks, ideas] = await Promise.all([
      read("tasksList").catch(() => null),
      read("ideasList").catch(() => null),
    ]);
    // Failed reads retain the last count; one slow store cannot delay the
    // other request from starting.
    if (tasks?.tasks) patch.tasks = openTasks(tasks.tasks);
    if (ideas?.ideas) patch.ideas = unreadIdeas(ideas.ideas);
    // No machineStatus() here: that IPC runs a full PowerShell process scan, and
    // onMachineStatus (init) already receives every watcher pass for free.
    Object.assign(patch, treeCounts());
    setBadge(patch);
    return badges;
  }

  function treeCounts() {
    const snapshot = window.MefiTree?.snapshot?.();
    if (!Array.isArray(snapshot?.nodes)) return {};
    const counts = {
      progress: snapshot.nodes.filter((node) => node.kind === "todo" && node.status === "in_progress").length,
      sessions: snapshot.nodes.filter((node) => node.kind === "session").length,
    };
    // The browser-only booklet has an assistant node but no service to report.
    if (window.mefiStudio?.assistantState && snapshot.assistant) counts.assistant = snapshot.assistant.tone ?? null;
    return counts;
  }

  // ---- generated markup --------------------------------------------------

  function glyphNode(name) {
    // <use> only resolves inside the SVG namespace, so build it element by element.
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "glyph");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const use = document.createElementNS(SVG_NS, "use");
    use.setAttribute("href", `#${name}`);
    svg.append(use);
    return svg;
  }

  // A destination carries at most one count badge and one tone dot.
  function badgeNodes(dest) {
    const list = [];
    if (dest.badge) {
      const element = document.createElement("span");
      element.dataset.badge = dest.badge;
      if (dest.badge === "progress") {
        element.className = "dot live";
        element.dataset.badgeMode = "dot";
      } else {
        element.className = "count";
      }
      element.hidden = true;
      list.push(element);
    }
    if (dest.dot) {
      const element = document.createElement("span");
      element.className = "dot tone-dot";
      element.dataset.badge = dest.dot;
      element.dataset.badgeMode = "tone";
      element.hidden = true;
      list.push(element);
    }
    return list;
  }

  function keyCap(text) {
    const cap = document.createElement("kbd");
    cap.className = "key";
    cap.textContent = text;
    return cap;
  }

  function navButton(dest, className, options = {}) {
    const button = document.createElement("button");
    button.className = className;
    button.dataset.nav = dest.id;
    button.title = dest.key ? `${dest.label} (${dest.key})` : dest.label;
    if (dest.glyph) button.append(glyphNode(dest.glyph));
    if (options.label !== false) {
      const label = document.createElement("span");
      label.className = "label";
      label.textContent = dest.short ?? dest.label;
      button.append(label);
    } else {
      button.setAttribute("aria-label", dest.label);
    }
    if (options.key !== false && dest.key) button.append(keyCap(options.keyText ?? dest.key));
    for (const badge of badgeNodes(dest)) button.append(badge);
    return button;
  }

  function separator(className) {
    const element = document.createElement("span");
    element.className = className;
    element.setAttribute("aria-hidden", "true");
    return element;
  }

  function menuGroup(dest) {
    if (["workspace", "tasks", "plans", "ideas"].includes(dest.id)) return "Work";
    if (["command", "eyes", "explorer", "overhead", "analyzer", "profiler"].includes(dest.id)) return "Monitor & inspect";
    if (["booklet", "graph"].includes(dest.id)) return "Models";
    return "Settings & help";
  }

  function appendGrouped(target, destinations, buttonClass) {
    for (const label of ["Work", "Monitor & inspect", "Models", "Settings & help"]) {
      const items = destinations.filter((dest) => menuGroup(dest) === label);
      if (!items.length) continue;
      const group = document.createElement("div");
      group.className = "nav-menu-group";
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", label);
      const title = document.createElement("span");
      title.className = "nav-menu-heading";
      title.textContent = label;
      group.append(title);
      for (const dest of items) group.append(navButton(dest, buttonClass));
      target.append(group);
    }
  }

  function renderWorkspaceTools(target) {
    const element = target ?? document.getElementById("workspace-tool-links");
    if (!element) return;
    element.textContent = "";
    appendGrouped(element, list().filter((dest) =>
      !["workspace", "command", "studio", "music"].includes(dest.id) &&
      dest.kind !== "action" && dest.layer !== "transient"), "ghost");
    paintBadges(element);
  }

  function renderDock(target) {
    const element = target ?? document.getElementById("cmd-dock");
    if (!element) return;
    element.textContent = "";
    const destinations = list({ showIn: "dock" });
    for (const dest of destinations.filter((item) => item.commandPrimary)) element.append(navButton(dest, "dock-item"));
    element.append(separator("dock-sep"));
    const more = document.createElement("details");
    more.id = "cmd-more-tools";
    more.className = "cmd-more-tools";
    const summary = document.createElement("summary");
    summary.className = "dock-item";
    summary.textContent = "More tools";
    const links = document.createElement("div");
    links.className = "cmd-more-links";
    appendGrouped(links, destinations.filter((item) => !item.commandPrimary), "dock-item");
    more.append(summary, links);
    element.append(more);
    paintBadges(element);
  }

  function renderTools(target) {
    const element = target ?? document.getElementById("nav-tools");
    if (!element) return;
    element.textContent = "";
    appendGrouped(element, list({ showIn: "tools" }), "tool");
    paintBadges(element);
    watchToolsWidth(element);
  }

  let toolsObserver = null;
  function watchToolsWidth(element) {
    const tabs = document.getElementById("tabs");
    if (!tabs || typeof ResizeObserver !== "function" || toolsObserver) return;
    const fit = () => {
      // Measure uncompacted, or the cluster could never expand again.
      element.classList.remove("compact");
      if (tabs.scrollWidth > tabs.clientWidth) element.classList.add("compact");
    };
    let queued = false;
    toolsObserver = new ResizeObserver(() => {
      if (queued) return;
      queued = true;
      // Deferred so the measure/write pair cannot re-enter the observer.
      requestAnimationFrame(() => {
        queued = false;
        fit();
      });
    });
    toolsObserver.observe(tabs);
    // "Back to Command" and the progress dot widen #nav-command without resizing
    // the row itself, and a stale fit would push the cluster under #tree-rail.
    const home = document.getElementById("nav-command");
    if (home) toolsObserver.observe(home);
    fit();
  }

  // Both arguments are optional: with none, every [data-sheet-links] container
  // is filled from its own data-sheet-links id. The Explorer's static cluster
  // carries no attribute and is therefore left alone.
  function renderSheetLinks(target, selfId) {
    const containers = target ? [target] : Array.from(document.querySelectorAll("[data-sheet-links]"));
    for (const container of containers) {
      const self = selfId ?? container.dataset?.sheetLinks;
      if (!self) continue;
      container.textContent = "";
      const menu = document.createElement("details");
      menu.className = "studio-more";
      const summary = document.createElement("summary");
      summary.textContent = "More tools";
      menu.append(summary);
      const links = document.createElement("div");
      links.className = "studio-more-links";
      appendGrouped(links, list({ showIn: "tools" }).filter((dest) => dest.layer === "sheet" && dest.id !== self), "dock-item small");
      menu.append(links);
      container.append(menu);
      paintBadges(container);
    }
  }

  function helpRow(key, text) {
    const fragment = document.createDocumentFragment();
    fragment.append(keyCap(key));
    const label = document.createElement("span");
    label.textContent = text;
    fragment.append(label);
    return fragment;
  }

  function renderHelp(target) {
    const element = target ?? document.getElementById("help-grid");
    if (!element) return;
    element.textContent = "";
    const rows = list({ showIn: "help" });
    const groups = [
      ["Surfaces", rows.filter((dest) => dest.group === "surfaces")],
      ["Tools", rows.filter((dest) => dest.group === "tools")],
      ["Command view", rows.filter((dest) => dest.group === "command")],
      ["System", rows.filter((dest) => dest.group === "system" && dest.key)],
    ];
    for (const [title, items] of groups) {
      if (!items.length && title !== "System") continue;
      const heading = document.createElement("h4");
      heading.className = "help-group";
      heading.textContent = title;
      element.append(heading);
      for (const dest of items) if (dest.key) element.append(helpRow(dest.key, dest.label));
      // Escape has no destination, so it is the one hard-coded row.
      if (title === "System") element.append(helpRow("Esc", ESC_HELP));
    }
  }

  function hintLine() {
    const parts = [];
    const command = get("command");
    if (command?.key) parts.push(`${command.key} ${command.short}`);
    const tabs = list({ group: "surfaces" }).filter((dest) => dest.kind === "tab" && dest.key);
    if (tabs.length) parts.push(`${tabs[0].key}–${tabs[tabs.length - 1].key} tabs`);
    const tools = list({ group: "tools" })
      .filter((dest) => dest.key)
      .map((dest) => dest.key);
    if (tools.length) parts.push(`${tools.join(" ")} tools`);
    if (get("palette")) parts.push("⌃K jump");
    if (get("help")) parts.push("? shortcuts");
    return parts.join(" · ");
  }

  function renderFooter(target) {
    const element = target ?? document.getElementById("footer-keys");
    if (!element) return;
    element.textContent = hintLine();
  }

  function noMotion() {
    return document.body.classList.contains("no-motion") || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  // ---- tab rail roving focus ---------------------------------------------

  // The four surface tabs are one tab stop: the roving tabindex sits on the
  // active tab while focus is elsewhere and on whatever arrowing last focused
  // once inside. Left/Right walk the rail, Home/End jump to the ends, and
  // Enter/Space activate through the native button click booklet.js routes to
  // go(). Only tabindex and the section-4 outline move, so nothing reflows.
  function tabRail() {
    return Array.from(document.querySelectorAll("#tabs .tab"));
  }

  function setRovingTab(tabs, current) {
    for (const tab of tabs) tab.tabIndex = tab === current ? 0 : -1;
  }

  function rove(tabs, index) {
    const next = tabs[((index % tabs.length) + tabs.length) % tabs.length];
    if (!next) return;
    setRovingTab(tabs, next);
    next.focus({ preventScroll: true });
  }

  function wireTabRail() {
    const rail = document.getElementById("tabs");
    if (!rail) return;
    const tabs = tabRail();
    if (!tabs.length) return;
    setRovingTab(tabs, tabs.find((tab) => tab.classList.contains("active")) ?? tabs[0]);
    rail.addEventListener("keydown", (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const current = document.activeElement?.closest?.(".tab");
      if (!current || !rail.contains(current)) return;
      const at = tabs.indexOf(current);
      if (at < 0) return;
      if (event.key === "ArrowLeft") rove(tabs, at - 1);
      else if (event.key === "ArrowRight") rove(tabs, at + 1);
      else if (event.key === "Home") rove(tabs, 0);
      else if (event.key === "End") rove(tabs, tabs.length - 1);
      else return; // Enter/Space fall through to the button's own click
      event.preventDefault();
    });
    // Keys 1–4 and palette jumps change tabs without moving focus; keep the
    // single tab stop on the surface actually showing so Tab always lands there.
    window.addEventListener("mefi:nav", (event) => {
      if (event.detail?.action !== "open") return;
      if (get(event.detail?.id)?.kind !== "tab") return;
      const focused = document.activeElement?.closest?.(".tab");
      if (focused && rail.contains(focused)) return;
      const target = tabs.find((tab) => tab.dataset.tab === event.detail.id);
      if (target) setRovingTab(tabs, target);
    });
  }

  // ---- input -------------------------------------------------------------

  document.addEventListener("click", (event) => {
    for (const menu of document.querySelectorAll(".studio-more[open], .cmd-more-tools[open], #workspace-tools[open]")) {
      if (!menu.contains(event.target)) menu.open = false;
    }
    const button = event.target?.closest?.("[data-nav], [data-nav-close]");
    if (!button) return;
    const closeId = button.dataset.navClose;
    if (closeId) {
      close(closeId);
      return;
    }
    event.preventDefault();
    let params = {};
    if (button.dataset.navParams) {
      try {
        params = JSON.parse(button.dataset.navParams);
      } catch {
        params = {};
      }
    }
    go(button.dataset.nav, params);
    button.closest("details")?.removeAttribute("open");
  });

  function keyContext(dest, event) {
    if (dest.id === "help") {
      toggle("help");
      return;
    }
    if (dest.kind === "action") {
      if (dest.id === "search") event.preventDefault();
      dest.run?.();
      return;
    }
    if (dest.kind === "tab") {
      go(dest.id);
      return;
    }
    if (dest.kind === "view") {
      if (dest.id === "workspace") go(dest.id);
      else toggle(dest.id);
      return;
    }
    if (dest.isOpen?.()) {
      close(dest.id);
      return;
    }
    // A live selection in the Command view turns a tool key into a deep link.
    const selection = idleActive() ? window.MefiIdle?.selection?.() : null;
    if (dest.id === "explorer" && selection?.sessionId) go("explorer", { sessionId: selection.sessionId });
    else if (dest.id === "tasks" && selection?.taskId) go("tasks", { taskId: selection.taskId });
    else go(dest.id);
  }

  function handleKey(event) {
    if (event.key === "Escape" && !state.transient && window.MefiSidebar?.isOpen?.()) {
      event.preventDefault();
      window.MefiSidebar.close({ restoreFocus: true });
      return;
    }
    const more = document.activeElement?.closest?.(".studio-more[open], .cmd-more-tools[open], #workspace-tools[open]") ?? document.getElementById("cmd-more-tools");
    if (event.key === "Escape" && more?.open) {
      event.preventDefault();
      more.open = false;
      more.querySelector("summary")?.focus();
      return;
    }
    // 1. the palette works from inside any field, and the capture tour
    //    dispatches this on window, so event.target may not be an element.
    if ((event.ctrlKey || event.metaKey) && event.key?.toLowerCase?.() === "k") {
      event.preventDefault();
      toggle("palette");
      return;
    }
    const field = event.target?.closest?.("input, textarea, select, [contenteditable]") ?? null;
    if (field) {
      if (event.key !== "Escape") return;
      if (event.target?.id === "palette-input") {
        close("palette");
        return;
      }
      if (event.target?.matches?.("#idle-search")) window.MefiIdle?.clearSearch?.();
      else field.blur?.();
      // An open layer covers the constellation, so keep focus inside that dialog
      // instead of parking it on the canvas underneath (the guard from E15).
      const covering = state.transient ?? state.sheet;
      if (covering) dialogRoot(get(covering))?.focus?.();
      else if (idleActive()) focusIdle();
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Escape") {
      closeTop();
      return;
    }
    if (state.transient === "palette") return;
    if (state.transient === "help" && event.key !== "?") return;
    if (state.transient === "onboarding") return;
    // Native controls own their activation keys even while the canvas is open.
    if ((event.key === "Enter" || event.key === " ") && event.target?.closest?.("button, summary, a, [role=button]")) return;
    if (idleActive() && state.sheet === null && window.MefiIdle?.handleKey?.(event)) {
      event.preventDefault();
      return;
    }
    for (const dest of registry) {
      if (dest.group === "command") continue; // display-only rows from idle.js
      const matches = typeof dest.keyMatch === "function" ? dest.keyMatch(event) : defaultKeyMatch(dest.key)(event);
      if (!matches) continue;
      keyContext(dest, event);
      return;
    }
  }

  window.addEventListener("keydown", handleKey);

  // ---- live update -------------------------------------------------------

  // The host's pause gate asks this before a reload or a restart: how long since
  // the last pointer, key or wheel, and whether a text field holds unsaved text.
  const activityState = { at: Date.now() };
  for (const type of ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"]) {
    window.addEventListener(
      type,
      () => {
        activityState.at = Date.now();
      },
      { capture: true, passive: true }
    );
  }

  function typing() {
    const active = document.activeElement;
    if (!active || active === document.body || !active.matches?.(TYPING_SELECTOR)) return false;
    const value = active.isContentEditable ? active.textContent : active.value;
    return Boolean(String(value ?? "").trim());
  }

  function activity() {
    return { idleMs: Math.max(0, Date.now() - activityState.at), typing: typing() };
  }

  // A styles.css edit lands here without a reload: the built page carries its
  // stylesheet in one slot, and swapping its text restyles everything live.
  // false tells the host the page cannot take it (an old page without the slot),
  // and the updater falls back to a reload.
  function applyStyles(css) {
    const slot = document.getElementById("booklet-styles");
    if (!slot) return false;
    slot.textContent = String(css ?? "");
    return true;
  }

  function updateView(status) {
    const phase = status?.phase ?? "idle";
    const files = Array.isArray(status?.files) ? status.files : [];
    const count = files.length;
    const reason = status?.reason ?? "";
    const error = status?.error ?? "";
    const auto = status?.auto !== false;
    if (phase === "idle" || status?.watching === false) {
      return { hidden: true, state: "watching", label: "Live update", title: "Live update: not watching", line: "not watching" };
    }
    if (phase === "watching") {
      return {
        hidden: false,
        state: "watching",
        label: "Live update",
        title: `Live update: watching the source tree${auto ? "" : " · auto restart off"}`,
        line: `watching · auto restart ${auto ? "on" : "off"}`,
      };
    }
    if (phase === "pending") {
      return {
        hidden: false,
        state: "pending",
        label: "Update pending",
        title: `${plural(count, "file")} waiting · ${reason}`,
        line: `pending · ${plural(count, "file")}${reason ? ` · ${reason}` : ""}`,
      };
    }
    if (phase === "waiting") {
      // Built and ready; the reload or restart waits for a pause in the work.
      const what = status?.kind === "restart" ? "restart" : "reload";
      return {
        hidden: false,
        state: "pending",
        label: "Update ready",
        title: `${plural(count, "file")} ready · the ${what} waits for a pause · click to apply now`,
        line: `update ready · waiting for a pause${count ? ` · ${plural(count, "file")}` : ""}`,
      };
    }
    if (phase === "swapping" || phase === "styling") {
      const modules = Array.isArray(status?.modules) ? status.modules.length : 0;
      const what = phase === "styling" ? "styles" : plural(modules || count, "module");
      return {
        hidden: false,
        state: "working",
        label: "Updating in place",
        title: `Updating in place · ${what}: ${files.slice(0, 3).join(", ")}`,
        line: `updating in place · ${what}`,
      };
    }
    if (phase === "styled" || phase === "swapped") {
      const modules = Array.isArray(status?.modules) ? status.modules.length : count;
      const what = phase === "styled" ? "styles" : plural(modules, "module");
      return {
        hidden: false,
        state: "watching",
        label: "Live update",
        title: `Updated in place · ${what}`,
        line: `updated in place · ${what}`,
      };
    }
    if (phase === "held" && reason === "incomplete source files") {
      return { hidden: false, state: "pending", label: "Waiting for files",
        title: `${error} · Studio keeps the current version until the source is complete`,
        line: `update waiting · ${error}` };
    }
    if (phase === "held" || phase === "error") {
      return {
        hidden: false,
        state: "held",
        label: "Update held",
        title: `${reason} — ${error}`,
        line: phase === "held" ? `held · ${reason}` : `error · ${error}`,
      };
    }
    if (phase === "reloaded" || phase === "restarted") {
      return {
        hidden: false,
        state: "watching",
        label: "Live update",
        title: `Updated ${plural(count, "file")}`,
        line: `updated · ${plural(count, "file")}`,
      };
    }
    return {
      hidden: false,
      state: "working",
      label: "Updating…",
      title: `Updating ${plural(count, "file")}: ${files.slice(0, 3).join(", ")}…`,
      line: `updating · ${plural(count, "file")}`,
    };
  }

  function paintUpdate(status) {
    const view = updateView(status);
    const pill = document.querySelector("#update-pill");
    if (pill) {
      pill.hidden = view.hidden;
      pill.dataset.state = view.state;
      pill.title = view.title;
      const label = pill.querySelector(".label");
      if (label) label.textContent = view.label;
    }
    const auto = document.querySelector("#update-auto");
    if (auto) auto.checked = status?.auto !== false;
    const apply = document.querySelector("#update-apply");
    if (apply) {
      // "Restart now" only for the one kind that restarts; an update waiting
      // for a pause can be applied at once from here.
      apply.textContent = status?.kind === "restart" ? "Restart now" : "Apply update";
      const held = status?.phase === "held" && (status?.files?.length ?? 0) > 0;
      apply.disabled = status?.reason === "incomplete source files" || !(status?.phase === "pending" || status?.phase === "waiting" || held);
    }
    const line = document.querySelector("#update-status");
    if (line) {
      line.textContent = view.line;
      line.classList.toggle("bad-text", (status?.phase === "held" && status?.reason !== "incomplete source files") || status?.phase === "error");
    }
  }

  function updateToast(payload) {
    const phase = payload?.phase;
    const count = Array.isArray(payload?.files) ? payload.files.length : 0;
    if (phase === "detected") {
      const kind = payload.kind;
      window.MefiToast?.(
        kind === "restart" ? "Update detected · restarts after a pause…" : kind === "reload" ? "Update detected · reloads after a pause…" : "Update detected · applying in place…",
        "info"
      );
    } else if (phase === "pending") {
      window.MefiToast?.("Update pending · apply it from Studio", "info");
    } else if (phase === "waiting") {
      window.MefiToast?.(payload.kind === "restart" ? "Update ready · restarts at the next pause" : "Update ready · reloads at the next pause", "info");
    } else if (phase === "styled") {
      window.MefiToast?.("Updated in place · styles", "good");
    } else if (phase === "swapped") {
      const modules = Array.isArray(payload.modules) ? payload.modules.length : count;
      window.MefiToast?.(`Updated in place · ${plural(modules, "module")}`, "good");
    } else if (phase === "held") {
      if (payload.reason === "incomplete source files") return;
      window.MefiToast?.(`Update held · ${payload.reason ?? "unknown"}`, "bad");
    } else if (phase === "error") {
      window.MefiToast?.(`Update failed · ${payload.error ?? payload.reason ?? "unknown"}`, "bad");
    } else if (phase === "reloaded" || phase === "restarted") {
      window.MefiToast?.(count ? `Updated · ${plural(count, "file")}` : "Updated", "good");
    }
  }

  function onUpdateEvent(payload) {
    paintUpdate(payload);
    updateToast(payload);
    if (!["reloaded", "restarted", "styled", "swapped"].includes(payload?.phase)) return;
    // Those are one-shot notices from main.cjs, not updater state.
    window.mefiStudio
      ?.updateStatus?.()
      .then((result) => paintUpdate(result?.status))
      .catch(() => {});
  }

  // A rejected invoke sends no update:event, so nothing else would repaint the
  // controls: ask the host for its real state instead.
  function resyncUpdate() {
    window.mefiStudio
      ?.updateStatus?.()
      .then((result) => {
        if (result?.status) paintUpdate(result.status);
      })
      .catch(() => {});
  }

  async function applyUpdate() {
    if (!window.mefiStudio?.updateApply) return;
    const button = document.querySelector("#update-apply");
    if (button) button.disabled = true;
    try {
      const result = await window.mefiStudio.updateApply();
      paintUpdate(result?.status);
      if (result?.error) window.MefiToast?.(`Update failed · ${result.error}`, "bad");
    } catch (error) {
      window.MefiToast?.(`Update failed · ${String(error?.message ?? error)}`, "bad");
      // Retry stays possible even if the host never answers; the resync
      // disables the button again when nothing is left to apply.
      if (button) button.disabled = false;
      resyncUpdate();
    }
  }

  // Resolves to null when the host refused, so callers never report a change
  // that did not happen.
  async function setUpdateAuto(auto) {
    if (!window.mefiStudio?.updateSet) return null;
    try {
      const result = await window.mefiStudio.updateSet(auto);
      paintUpdate(result?.status);
      return result;
    } catch (error) {
      window.MefiToast?.(`Automatic updates unchanged · ${String(error?.message ?? error)}`, "bad");
      resyncUpdate();
      return null;
    }
  }

  async function toggleUpdateAuto() {
    let current = null;
    try {
      current = await window.mefiStudio?.updateStatus?.();
    } catch {
      /* the host answers again on the next event */
    }
    const next = current?.status?.auto === false;
    if (await setUpdateAuto(next)) window.MefiToast?.(next ? "Automatic updates on" : "Automatic updates off", "info");
  }

  function initUpdates() {
    if (!window.mefiStudio?.updateStatus) {
      // Plain browser, or a desktop build whose preload predates the updater.
      const block = document.querySelector("[data-update-block]");
      if (block) block.hidden = true;
      return;
    }
    register({
      id: "updateAuto",
      label: "Toggle automatic updates",
      short: "Auto-update",
      kind: "action",
      layer: null,
      group: "system",
      key: null,
      glyph: "g-update",
      badge: null,
      desc: "Apply app updates automatically (in place, or after a pause)",
      showIn: showIn({ palette: true }),
      run: () => toggleUpdateAuto(),
    });
    register({
      id: "updateApply",
      label: "Apply update now",
      short: "Apply update",
      kind: "action",
      layer: null,
      group: "system",
      key: null,
      glyph: "g-update",
      badge: null,
      desc: "Apply the pending update without waiting for a pause",
      showIn: showIn({ palette: true }),
      run: () => applyUpdate(),
    });
    const auto = document.querySelector("#update-auto");
    auto?.addEventListener("change", () => setUpdateAuto(auto.checked));
    document.querySelector("#update-apply")?.addEventListener("click", () => applyUpdate());
    // The pill opens Studio; while an update waits for a pause, clicking it
    // also applies now (the host skips its gate for a manual apply).
    document.querySelector("#update-pill")?.addEventListener("click", () => {
      const phase = document.querySelector("#update-pill")?.dataset.state;
      if (phase === "pending") applyUpdate();
    });
    window.mefiStudio.onUpdateEvent?.(onUpdateEvent);
    window.mefiStudio
      .updateStatus()
      .then((result) => paintUpdate(result?.status))
      .catch(() => {});
  }

  // Every store access is guarded: a blocked or private store must not take the
  // reload path (or the boot) down with it.
  const readStore = (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  };

  // Called by main.cjs through executeJavaScript immediately before a reload or
  // a relaunch. Returns the stored object so the host's await is meaningful.
  // It carries the whole UI state: the tab, the sheet, the Command view with its
  // selection and zoom, the sheets' own selections, every text field with
  // something typed in it, every scrolled element and the focus.
  function saveResume() {
    const fields = {};
    for (const element of document.querySelectorAll(FIELD_SELECTOR)) {
      const value = String(element.value ?? "");
      if (value) fields[element.id] = value;
    }
    const scroll = {};
    for (const element of document.querySelectorAll("[id]")) {
      if (element.scrollTop > 0) scroll[element.id] = element.scrollTop;
    }
    const active = document.activeElement;
    const commandActive = Boolean(window.MefiIdle?.isActive?.());
    const payload = {
      // truthy when the Command view was up; then also its selection and zoom
      command: commandActive ? { active: true, ...(window.MefiIdle?.saveState?.() ?? {}) } : false,
      workspace: Boolean(window.MefiWorkspace?.isActive?.()),
      sheet: state.sheet ?? null,
      tab: readStore("mefiStudio.tab") ?? "booklet",
      at: Date.now(),
      fields,
      scroll,
      focus: active && active !== document.body && active.id ? active.id : null,
      explorer: window.MefiExplorer?.saveState?.() ?? null,
      tasks: window.MefiTasks?.saveState?.() ?? null,
    };
    try {
      localStorage.setItem(RESUME_KEY, JSON.stringify(payload));
    } catch {
      /* private mode or a blocked store: the resume is a nicety, not a contract */
    }
    return payload;
  }

  // Fields, scroll positions and the focus, once the surfaces that hold them
  // are up. A field the user has typed into since is left alone.
  function restoreDetails(saved) {
    for (const [id, value] of Object.entries(saved.fields ?? {})) {
      const element = document.getElementById(id);
      if (!element || !element.matches?.(FIELD_SELECTOR) || element.value) continue;
      element.value = value;
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }
    for (const [id, top] of Object.entries(saved.scroll ?? {})) {
      const element = document.getElementById(id);
      if (element && element.scrollTop !== top && element.scrollHeight > element.clientHeight) element.scrollTop = top;
    }
    if (saved.focus) {
      const target = document.getElementById(saved.focus);
      const current = document.activeElement;
      if (target && (current === document.body || current === null || current === target || current?.id === "idle-layer")) {
        target.focus?.({ preventScroll: true });
      }
    }
  }

  // Called once by booklet.js at the end of boot. Returns true when it restored
  // something, so the caller knows to skip the commandHome home behaviour.
  function resume() {
    let saved = null;
    try {
      saved = JSON.parse(readStore(RESUME_KEY) || "null");
    } catch {
      saved = null;
    }
    try {
      // Removed before it is used, so a boot that crashes mid-restore cannot loop.
      localStorage.removeItem(RESUME_KEY);
    } catch {
      /* as above */
    }
    if (!saved || typeof saved.at !== "number" || Date.now() - saved.at > 60000) return false;
    if (saved.tab && saved.tab !== readStore("mefiStudio.tab")) window.MefiBooklet?.showTab?.(saved.tab);
    const commandState = saved.command && typeof saved.command === "object" ? saved.command : {};
    if (saved.workspace) window.MefiWorkspace?.enter?.();
    if (saved.command) setTimeout(() => window.MefiIdle?.enter?.(true, commandState), 1200);
    if (saved.sheet && get(saved.sheet)) {
      const sheetState = saved.sheet === "explorer" ? saved.explorer : saved.sheet === "tasks" ? saved.tasks : null;
      setTimeout(() => go(saved.sheet, sheetState && typeof sheetState === "object" ? sheetState : {}), saved.command ? 1500 : 300);
    }
    // Two passes: one when the page has painted, one for the sheets and the
    // Command view, which open on the timers above.
    requestAnimationFrame(() => setTimeout(() => restoreDetails(saved), 300));
    setTimeout(() => restoreDetails(saved), 1600);
    return Boolean(saved.workspace || saved.command || saved.sheet);
  }

  // ---- boot --------------------------------------------------------------

  function init() {
    renderTools();
    renderDock();
    renderSheetLinks();
    renderFooter();
    wireTabRail();
    paintBadges();
    refreshBadges();
    window.mefiStudio?.onTasks?.((tasks) => setBadge("tasks", openTasks(tasks)));
    window.mefiStudio?.onIdeas?.((ideas) => setBadge("ideas", unreadIdeas(ideas)));
    window.mefiStudio?.onMachineStatus?.((status) => setBadge("machine", machineLevel(status)));
    window.mefiStudio?.onAssistant?.((payload) => {
      window.MefiTree?.applyAssistant?.(payload);
      setBadge("assistant", window.MefiTree?.assistantSummary?.()?.tone ?? null);
    });
    window.addEventListener("mefi:eyes-activity", (event) => {
      if (!event.detail?.todos) return;
      const counts = treeCounts();
      if (Object.keys(counts).length) setBadge(counts);
    });
    window.addEventListener("mefi:command", (event) => {
      if (!event.detail?.active) return;
      state.returnTo = null;
      document.getElementById("nav-command")?.classList.remove("return");
      paintBadges(document.querySelector("#idle-hud"));
    });
    // A backstop only: the push subscriptions above carry the live numbers, and
    // a hidden window has nothing to paint. The poll timer itself stops while
    // the window hides and restarts when it shows — the shared guard in
    // boot.js clears before it sets, so a hidden tab issues no fetch and
    // hide/show toggles always leave exactly one interval; the
    // visibilitychange listener still snaps the badges back the moment the
    // window is shown instead of waiting out the interval.
    const badgeTick = () => {
      if (!document.hidden) refreshBadges();
    };
    if (window.MefiBoot?.pollStart) window.MefiBoot.pollStart("nav.badges", badgeTick, BADGE_POLL_MS);
    else setInterval(badgeTick, BADGE_POLL_MS);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refreshBadges();
    });
    initUpdates();
  }

  window.MefiNav = {
    register,
    get,
    list,
    go,
    toggle,
    close,
    claim,
    release,
    top,
    closeTop,
    closeAll,
    badges,
    setBadge,
    refreshBadges,
    paintBadges,
    renderDock,
    renderTools,
    renderWorkspaceTools,
    renderSheetLinks,
    renderHelp,
    renderFooter,
    hintLine,
    handleKey,
    noMotion,
    state,
    init,
    saveResume,
    resume,
    activity,
    applyStyles,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
