// Mefi's Studio AI+ — navigation registry for Home, Work, Live and Models,
// project-scoped recent tasks, the local view row, Search, Help and shortcuts.
// Classic tabs, dock and sheet links resolve through this same registry.
// New task opens Home's composer; task identity persists across destinations.
(function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const ESC_HELP = "Close the top-most layer: palette → help → sheet → Command (clear selection, then leave)";
  const BADGE_THROTTLE_MS = 2000;
  // Pushes keep the counts live; this backstop only catches a missed push.
  const BADGE_POLL_MS = 120000;
  const RESUME_KEY = "mefiStudio.resume";
  // Fields a live-update reload carries across: text-like inputs and textareas
  // that have an id. Checkboxes and selects are settings and persist elsewhere.
  const FIELD_SELECTOR = "input[type=text][id], input[type=search][id], input[type=url][id], input:not([type])[id], textarea[id]";
  const TYPING_SELECTOR = "input:not([type]), input[type=text], input[type=search], input[type=url], input[type=password], input[type=email], input[type=number], textarea, [contenteditable]";

  // Layer bookkeeping. Other modules read it; only claim/release write it.
  const state = { sheet: null, transient: null, returnTo: null, commandFrom: null, focusReturn: { sheet: null, transient: null } };
  // assistant holds the service tone (ok | busy | warn | offline | paused), painted
  // as a dot on the Explorer's dock item and tool button.
  const badges = { sessions: 0, progress: 0, tasks: 0, ideas: 0, machine: null, assistant: null, questions: 0 };
  let lastBadgeRefresh = 0;
  // One selected task per project follows the user through Home, Work and
  // Live. Only selection is stored here; the board remains authoritative.
  const taskContexts = new Map();
  let taskProjectId = null;
  function taskContext(projectId = taskProjectId || window.MefiTasks?.state?.projectId || (window.MefiWorkspace?.activeProjectId?.() || window.MefiWorkspace?.state?.activeId)) {
    if (!projectId) return null;
    if (!taskContexts.has(projectId)) {
      try {
        const saved = JSON.parse(localStorage.getItem(`mefiStudio.taskContext.${projectId}`) || "null");
        if (saved?.projectId === projectId && typeof saved.taskId === "string") taskContexts.set(projectId, saved);
      } catch { /* Selection can work without a browser store. */ }
    }
    const selected = taskContexts.get(projectId);
    return selected ? { ...selected } : null;
  }
  function selectTask({ taskId, projectId, title } = {}) {
    projectId ||= taskProjectId || window.MefiTasks?.state?.projectId || (window.MefiWorkspace?.activeProjectId?.() || window.MefiWorkspace?.state?.activeId);
    if (!projectId || typeof taskId !== "string" || !taskId) return null;
    const previous = taskContext(projectId);
    const selected = { taskId, projectId, title: String(title || previous?.taskId === taskId && previous?.title || "Selected task").slice(0, 90) };
    taskProjectId = projectId;
    taskContexts.set(projectId, selected);
    try { localStorage.setItem(`mefiStudio.taskContext.${projectId}`, JSON.stringify(selected)); } catch { /* Optional persistence. */ }
    if (previous?.taskId !== taskId || previous?.title !== selected.title) {
      window.dispatchEvent(new CustomEvent("mefi:task-context", { detail: { ...selected } }));
      paintTaskContext();
    }
    return { ...selected };
  }
  function paintTaskContext() {
    const nav = document.getElementById("app-local-nav");
    if (!nav || nav.hidden) return;
    let row = document.getElementById("app-task-context");
    if (!row) { row = document.createElement("div"); row.id = "app-task-context"; row.className = "app-task-context"; nav.insertBefore(row, nav.firstChild); }
    const context = taskContext();
    row.hidden = !["work", "agents"].includes(nav.dataset.section);
    const signature = JSON.stringify([context, current()]);
    if (row.dataset.signature === signature) return;
    row.dataset.signature = signature; row.textContent = "";
    const home = document.createElement("button"); home.type = "button"; home.className = "ghost mini"; home.textContent = "Home";
    home.addEventListener("click", () => go("workspace")); row.append(home);
    if (context) {
      const task = document.createElement("button"); task.type = "button"; task.className = "ghost mini";
      task.textContent = current() === "tasks" ? "Current task" : "Open current task";
      task.title = context.title; task.addEventListener("click", () => go("tasks", { taskId: context.taskId, projectId: context.projectId })); row.append(task);
    }
  }

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

  // Settings' chord: Ctrl+, or Cmd+, (AltGr reports Ctrl+Alt, so Alt is out).
  const settingsChord = (event) => Boolean(event?.ctrlKey || event?.metaKey) && !event.altKey && event.key === ",";

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
  const openQuestions = (state) => (Array.isArray(state?.questions) ? state.questions : []).filter((question) => question && question.status === "open");
  // Decisions the agents are waiting on: a count on every Command entry point
  // and one toast per new question, whichever view is up. The first payload
  // seeds what is already known so a restart never re-announces old asks.
  let knownQuestions = null;
  // A question closed while its toast is still up (answered elsewhere, or
  // cleared because its card left the board) takes the toast with it, so an
  // Answer button never leads to a decision that is already gone.
  const questionToasts = new Map();
  function noticeQuestions(state) {
    if (!state || !Array.isArray(state.questions)) return;
    const open = openQuestions(state);
    setBadge("questions", open.length);
    const openIds = new Set(open.map((question) => question.id));
    for (const [id, toast] of questionToasts) {
      if (openIds.has(id)) continue;
      questionToasts.delete(id);
      toast?.dismiss?.();
    }
    if (knownQuestions === null) { knownQuestions = new Set(state.questions.map((question) => question.id)); return; }
    for (const question of open) {
      if (knownQuestions.has(question.id)) continue;
      knownQuestions.add(question.id);
      const toast = window.MefiToast?.(`Decision needed: ${question.title}`, "warn", {
        action: { label: "Answer", run: () => go("command", { rail: "ask" }) },
        onDismiss: () => questionToasts.delete(question.id),
      });
      if (toast) questionToasts.set(question.id, toast);
    }
  }

  // ---- sections ----------------------------------------------------------
  // One taxonomy behind every menu. Each record names its section, and the
  // rail, the More tools menus, the shortcut sheet and the palette's result
  // kinds all read that one field instead of keeping lists of their own.
  const SECTIONS = new Map([
    ["home", "Home"],
    ["work", "Work"],
    ["agents", "Agents"],
    ["settings", "Settings"],
    ["help", "Help"],
    ["community", "Community"],
    ["assistant", "Assistant"],
    ["command", "Command view"],
  ]);
  // A rail place for a record whose kind alone would keep it out of the rail:
  // community.js registers "community" as a palette action at DOMContentLoaded,
  // and the foot (Help & community) is its home.
  const RAIL_SLOTS = Object.freeze({ community: "foot" });
  // Sections for records other modules register without one. The assistant's
  // commands and Command view's key rows name theirs in `group`.
  const ACTION_SECTIONS = Object.freeze({ community: "community" });
  const ownKey = (map, key) => typeof key === "string" && Object.hasOwn(map, key);

  function sectionOf(dest) {
    if (!dest) return null;
    if (SECTIONS.has(dest.section)) return dest.section;
    if (ownKey(ACTION_SECTIONS, dest.id)) return ACTION_SECTIONS[dest.id];
    if (SECTIONS.has(dest.group)) return dest.group;
    return dest.layer === "transient" ? "help" : "settings";
  }

  // What every menu calls a destination's home: "Live" for the Command view,
  // "Community" for community, "Assistant" for the assistant's commands.
  function sectionLabel(dest) {
    return dest ? SECTIONS.get(sectionOf(dest)) ?? null : null;
  }

  // The rail's top-to-bottom order, for lists that sort by section.
  function sectionRank(dest) {
    const at = [...SECTIONS.keys()].indexOf(sectionOf(dest));
    return at < 0 ? SECTIONS.size : at;
  }

  // ---- registry ----------------------------------------------------------

  const registry = [
    {
      id: "agents", label: "Agents", short: "Agents", kind: "overlay", layer: "sheet", section: "agents", group: "tools",
      glyph: "g-agents", badge: "questions", desc: "Your team, setup, live work, workflows, models and usage",
      showIn: showIn({ palette: true, help: true, tools: true }), element: "agents-overlay", focus: "#agents-title",
      open: (params) => window.MefiAgents?.open?.(params), close: () => window.MefiAgents?.close?.(), isOpen: () => overlayOpen("agents-overlay"),
    },
    {
      id: "workspace", label: "Home", short: "Home", kind: "view", layer: null,
      commandPrimary: true, section: "home",
      group: "surfaces", key: "H", glyph: "g-home", badge: null,
      desc: "Project overview, conversation and work queue",
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
      section: "agents",
      group: "surfaces",
      key: "D",
      glyph: "g-orbit",
      badge: "progress",
      alert: "questions",
      desc: "Live work as a node tree: sessions, agents, todos and tasks",
      searchTerms: "node tree constellation live work monitor progress workers agents",
      showIn: showIn({ palette: true, help: true, footer: true }),
      open: (params) => window.MefiIdle?.enter?.(true, params),
      close: () => leaveCommand(),
      isOpen: () => idleActive(),
    },
    {
      id: "booklet",
      label: "Model catalog",
      short: "Catalog",
      kind: "tab",
      layer: null,
      section: "agents",
      group: "surfaces",
      key: "1",
      glyph: "g-booklet",
      badge: null,
      desc: "Compare models, prices and context limits",
      searchTerms: "models catalog booklet prices limits compare",
      showIn: showIn({ dock: true, palette: true, help: true }),
      open: () => window.MefiBooklet?.showTab?.("booklet"),
      isOpen: () => tabOpen("booklet"),
    },
    {
      id: "graph",
      label: "Performance",
      short: "Performance",
      kind: "tab",
      layer: null,
      section: "agents",
      group: "surfaces",
      key: "2",
      glyph: "g-graph",
      badge: null,
      desc: "Measured model performance and task comparisons",
      searchTerms: "model lab rankings performance benchmarks",
      showIn: showIn({ dock: true, palette: true, help: true }),
      open: () => openModelView("rankings"),
      isOpen: () => tabOpen("graph") && !["usage", "context"].includes(modelRoute),
    },
    {
      id: "usage", label: "Usage", short: "Usage", kind: "tab", layer: null, section: "agents", group: "surfaces",
      key: null, glyph: "g-gauge", badge: null, desc: "Recorded calls, costs and account readings",
      searchTerms: "usage costs budget spend account limits tracker", showIn: showIn({ palette: true, help: true }),
      open: (params) => openModelView(params?.view === "tracker" ? "tracker" : "usage"), isOpen: () => tabOpen("graph") && modelRoute === "usage",
    },
    {
      id: "context", label: "Context", short: "Context", kind: "tab", layer: null, section: "agents", group: "surfaces",
      key: null, glyph: "g-booklet", badge: null, desc: "Inspect a task's saved context and token budget",
      searchTerms: "context tokens sources budget task handoff", showIn: showIn({ palette: true, help: true }),
      open: () => openModelView("context"), isOpen: () => tabOpen("graph") && modelRoute === "context",
    },
    {
      id: "eyes",
      label: "Activity & evidence",
      short: "Activity",
      kind: "tab",
      layer: null,
      section: "agents",
      group: "surfaces",
      key: "3",
      glyph: "g-eyes",
      badge: "progress",
      desc: "Live agent activity, diffs, evidence PNGs and pins",
      showIn: showIn({ dock: true, palette: true, help: true }),
      open: () => window.MefiBooklet?.showTab?.("eyes"),
      isOpen: () => tabOpen("eyes"),
    },
    {
      id: "studio",
      label: "Settings",
      short: "Settings",
      kind: "tab",
      layer: null,
      section: "settings",
      group: "surfaces",
      key: "4",
      // Ctrl+, (Cmd+, on a Mac) opens Settings too, as in most desktop apps;
      // handleKey takes the chord before its field check, so it works anywhere.
      chord: "Ctrl ,",
      keyMatch: (event) => settingsChord(event) || defaultKeyMatch("4")(event),
      glyph: "g-sliders",
      badge: null,
      desc: "Providers, routing and coding workers; your Studio, updates and diagnostics",
      searchTerms: "settings connections api key login setup provider workers preferences you theme motion animations launch updates diagnostics",
      showIn: showIn({ dock: true, palette: true, help: true }),
      // A section param opens one card: go("studio", { section: "settings-updates" }).
      open: (params) => window.MefiBooklet?.showTab?.("studio", params),
      isOpen: () => tabOpen("studio"),
    },
    {
      id: "explorer",
      commandPrimary: true,
      label: "Session explorer",
      short: "Sessions",
      kind: "overlay",
      layer: "sheet",
      section: "agents",
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
      short: "Tasks",
      kind: "overlay",
      layer: "sheet",
      section: "work",
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
      section: "work",
      group: "tools",
      key: "P",
      glyph: "g-plans",
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
      section: "work",
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
      id: "brains",
      commandPrimary: true,
      label: "Brain maps",
      short: "Brain maps",
      kind: "overlay",
      layer: "sheet",
      section: "agents",
      group: "tools",
      key: "B",
      glyph: "g-route",
      badge: null,
      desc: "Edit the stages, models and permissions in a workflow",
      searchTerms: "pipeline brain map graph nodes wiring editor engine stages triage decisions permissions model choice jev",
      showIn: showIn({ tools: true, dock: true, palette: true, help: true }),
      element: "brains-overlay",
      focus: "#brains-canvas-wrap",
      open: (params) => window.MefiBrains?.open?.(params),
      close: () => window.MefiBrains?.close?.(),
      isOpen: () => overlayOpen("brains-overlay"),
    },
    {
      id: "agent-brain",
      label: "Agent brain",
      short: "Agent brain",
      kind: "overlay",
      layer: "sheet",
      section: "agents",
      group: "tools",
      key: "J",
      glyph: "g-agents",
      badge: null,
      desc: "Explore project systems, their parts and files, then inspect live work, Playbook recipes and agent seats",
      searchTerms: "agent brain explore project map systems parts files pipeline pipelines sub-agents subagents lead desk playbook recipes seats",
      showIn: showIn({ tools: true, dock: true, palette: true, help: true }),
      element: "agent-brain-overlay",
      focus: "#agent-brain-heading",
      open: (params) => window.MefiAgentBrain?.open?.(params),
      close: () => window.MefiAgentBrain?.close?.(),
      isOpen: () => overlayOpen("agent-brain-overlay"),
    },
    {
      id: "overhead",
      label: "Overhead",
      short: "Overhead",
      kind: "overlay",
      layer: "sheet",
      section: "agents",
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
      id: "analyzer",
      label: "Analyzer",
      short: "Analyzer",
      kind: "overlay",
      layer: "sheet",
      section: "work",
      group: "tools",
      key: "A",
      glyph: "g-analyzer",
      badge: null,
      desc: "Read project plans, inspect current evidence and find starting points",
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
      label: "Search Studio",
      short: "Search",
      kind: "overlay",
      layer: "transient",
      section: "help",
      group: "system",
      key: "Ctrl K",
      keyMatch: (event) => (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k",
      glyph: "g-search",
      badge: null,
      desc: "Find any page, tool, setting, action, task, node or model",
      searchTerms: "search find jump go to key commands palette",
      showIn: showIn({ tools: true, dock: true, help: true, footer: true }),
      element: "palette-overlay",
      focus: "#palette-input",
      open: () => window.MefiPalette?.open?.(),
      close: () => window.MefiPalette?.close?.(),
      isOpen: () => overlayOpen("palette-overlay"),
    },
    {
      id: "music", label: "Appearance", short: "Appearance", kind: "action", layer: null, section: "settings",
      group: "tools", key: "U", glyph: "g-style", badge: null, commandPrimary: true,
      desc: "Themes, colours, node styles and canvas effects",
      searchTerms: "style theme themes colour color appearance accent skin look node styles",
      showIn: showIn({ dock: true, palette: true, help: true }),
      run: (params) => params === "sound" || params?.group === "sound" ? go("audio") : go("studio", { section: "appearance" }),
    },
    {
      id: "audio", label: "Music & video", short: "Audio", kind: "action", layer: null, section: "settings",
      group: "tools", key: null, glyph: "g-audio", badge: null,
      desc: "Open the audio dropdown for music, videos, radio and audio reactions",
      searchTerms: "music sound audio radio spotify links youtube video soundcloud vimeo jam media player connect",
      showIn: showIn({ palette: true, help: true }),
      run: () => window.MefiMusic?.openAudio?.(),
    },
    {
      id: "appearancePreview", label: "Appearance preview", short: "Preview", kind: "overlay", layer: "transient", section: "settings",
      group: "tools", key: null, glyph: "g-style", badge: null, showIn: showIn({}),
      element: "music-overlay", focus: "#music-close",
      open: () => window.MefiMusic?.openPreview?.(), close: () => window.MefiMusic?.close?.(),
      isOpen: () => overlayOpen("music-overlay"),
    },
    {
      // Settings' diagnostics: listed after Style & sound in the Settings section.
      id: "profiler", label: "Performance profiler", short: "Profiler", kind: "overlay", layer: "transient", section: "settings", group: "tools",
      key: null, glyph: "g-gauge", badge: null,
      desc: "Diagnostics: record frame timings, rendering hotspots, host requests, CPU and memory",
      searchTerms: "debug diagnostics lag slow fps hitch performance profiler cpu memory",
      showIn: showIn({ tools: true, palette: true, help: true }),
      element: "profiler-overlay", focus: "#profiler-start",
      open: () => window.MefiProfiler?.open?.(), close: () => window.MefiProfiler?.close?.(),
      isOpen: () => overlayOpen("profiler-overlay"),
    },
    {
      id: "onboarding", label: "Start here", short: "Start here", kind: "overlay", layer: "transient", section: "help",
      group: "system", key: null, glyph: "g-flag", badge: null,
      desc: "The guided walkthrough: link an AI, add a project, connect providers, then create, follow and review work",
      searchTerms: "start here walkthrough tour getting started guide tutorial help welcome onboarding",
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
      section: "help",
      group: "system",
      key: "?",
      keyMatch: (event) => event.key === "?",
      glyph: "g-help",
      badge: null,
      desc: "Keyboard shortcuts for pages, tools and Command view",
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
      short: "Find model",
      kind: "action",
      layer: null,
      section: "agents",
      group: "system",
      key: "/",
      glyph: "g-search",
      badge: null,
      desc: "Show the Model catalog and focus its search field",
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
      section: "agents",
      group: "system",
      key: "R",
      glyph: "g-refresh",
      badge: null,
      desc: "Reload the model catalog",
      showIn: showIn({ palette: true, help: true }),
      run: () => window.MefiBooklet?.refresh?.("keyboard"),
    },
    {
      id: "pinRail",
      label: "Pin the node-tree preview",
      short: "Pin preview",
      kind: "action",
      layer: null,
      section: "agents",
      group: "system",
      key: "G",
      glyph: "g-pin",
      badge: null,
      desc: "Keep the node-tree preview open beside the tab pages",
      showIn: showIn({ palette: true, help: true }),
      run: () => window.MefiTree?.togglePin?.(),
    },
    {
      id: "print",
      label: "Print / PDF model catalog",
      short: "Print",
      kind: "action",
      layer: null,
      section: "agents",
      group: "system",
      key: null,
      glyph: "g-print",
      badge: null,
      desc: "Print the model catalog on a light background",
      showIn: showIn({ palette: true }),
      run: () => window.print(),
    },
    {
      id: "audit",
      label: "Run auditor",
      short: "Auditor",
      kind: "action",
      layer: null,
      section: "agents",
      group: "system",
      key: null,
      glyph: null,
      badge: null,
      desc: "Check the app for configuration and integration problems",
      showIn: showIn({ palette: true }),
      run: () => {
        go("explorer", { panel: "diagnostics" });
        setTimeout(() => document.getElementById("audit-run")?.click(), 400);
      },
    },
    {
      id: "machine",
      label: "Machine status (in the Explorer)",
      short: "Machine",
      kind: "action",
      layer: null,
      section: "agents",
      group: "system",
      key: null,
      glyph: null,
      badge: null,
      desc: "Test leases, LOVE runs and auto-kill",
      showIn: showIn({ palette: true }),
      run: () => go("explorer", { panel: "diagnostics" }),
    },
    {
      id: "scanIdeas",
      label: "Scan chats for ideas",
      short: "Scan ideas",
      kind: "action",
      layer: null,
      section: "work",
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
      label: "Toggle animations",
      short: "Animations",
      kind: "action",
      layer: null,
      section: "settings",
      group: "system",
      key: null,
      glyph: null,
      badge: null,
      desc: "Pause or resume every animation",
      searchTerms: "motion animation animations reduce reduced movement",
      showIn: showIn({ palette: true }),
      run: () => document.getElementById("motion-toggle")?.click(),
    },
  ];

  function get(id) {
    return registry.find((dest) => dest.id === id) ?? null;
  }

  let modelRoute = "graph";
  let usageView = "usage";
  function openModelView(view) {
    if (view === "usage") view = usageView;
    modelRoute = view === "rankings" || view === "compare" ? "graph" : view === "tracker" ? "usage" : view;
    window.MefiBooklet?.showTab?.("graph");
    window.MefiModelLab?.show?.(view);
  }

  const WORKSPACE_PAGES = new Set(["tasks", "plans", "ideas", "brains", "analyzer", "explorer", "overhead", "agent-brain", "agents"]);
  const isWorkspacePage = (dest) => document.documentElement?.dataset?.shell === "rail" && WORKSPACE_PAGES.has(dest?.id);
  function syncPageInert() {
    const page = isWorkspacePage(get(state.sheet));
    for (const node of document.querySelectorAll?.("body > header, #tab-booklet, #tab-graph, #tab-eyes, #tab-studio, #workspace-layer, #vibe-layer, #idle-layer, #idle-hud, #tree-rail") ?? []) {
      if (page && !node.inert) { node.inert = true; node.dataset.pageInert = ""; }
      else if (!page && "pageInert" in node.dataset) { node.inert = false; delete node.dataset.pageInert; }
    }
  }

  function register(dest) {
    if (!dest?.id) return null;
    const index = registry.findIndex((item) => item.id === dest.id);
    if (index >= 0) registry[index] = dest;
    else registry.push(dest);
    // community.js registers at DOMContentLoaded, after init() drew the rail:
    // a late arrival with a place in the rail redraws it.
    if (document.documentElement?.dataset?.shell === "rail" && railSection(dest)) queueRailRender();
    return dest;
  }

  // Coalesced on a microtask, so a burst of registrations redraws the rail
  // once; keyboard focus inside it comes back to the same destination.
  let railRenderQueued = false;
  function queueRailRender() {
    if (railRenderQueued) return;
    railRenderQueued = true;
    Promise.resolve().then(() => {
      railRenderQueued = false;
      const rail = document.getElementById("app-rail");
      const active = document.activeElement;
      const held = rail?.contains?.(active) && (active?.dataset?.nav || active?.id || active?.dataset?.taskId)
        ? { id: active.id, nav: active.dataset.nav, taskId: active.dataset.taskId, head: Boolean(active.classList?.contains?.("app-rail-head")) }
        : null;
      renderRail();
      if (!held || (active.isConnected && document.activeElement === active)) return;
      const again = active.isConnected
        ? active
        : held.id ? document.getElementById(held.id)
        : Array.from(rail.querySelectorAll(held.head ? ".app-rail-head" : ".app-rail-item")).find((button) => held.taskId ? button.dataset?.taskId === held.taskId : button.dataset?.nav === held.nav);
      if (again) focusRailButton(again);
    });
  }

  function list(filter) {
    if (filter?.showIn) return registry.filter((dest) => Boolean(dest.showIn?.[filter.showIn]));
    if (filter?.group) return registry.filter((dest) => dest.group === filter.group);
    return registry.slice();
  }

  function dispatchNav(id, action, params) {
    window.dispatchEvent(new CustomEvent("mefi:nav", { detail: { id, action, params: params ?? {} } }));
  }

  // Each project and major section has its own history. Temporary dialogs
  // remain layers, not pages, and never enter the history.
  const histories = new Map();
  let historyActive = null, historyRestoring = false;
  const historyKey = (section) => `${taskProjectId || (window.MefiWorkspace?.activeProjectId?.() || window.MefiWorkspace?.state?.activeId) || "none"}:${section}`;
  function capturePage(entry) {
    if (!entry) return;
    entry.scroll = Array.from(document.querySelectorAll?.("[id]") || []).filter((el) => !el.hidden && (el.scrollTop || el.scrollLeft)).map((el) => [el.id, el.scrollTop, el.scrollLeft]);
    entry.focus = document.activeElement?.id || null;
  }
  function rememberRoute(id, params = {}) {
    if (historyRestoring) return;
    const dest = get(id), section = sectionOf(dest);
    if (!dest || dest.kind === "action" || dest.layer === "transient") return;
    if (historyActive) { const previous = histories.get(historyActive); capturePage(previous?.entries[previous.index]); }
    const key = historyKey(section);
    let history = histories.get(key);
    if (!history) {
      history = { entries: [], index: -1 }; histories.set(key, history);
      const root = section === "agents" ? "agents" : section === "work" ? "tasks" : null;
      if (root && (root !== id || Object.keys(params).length)) { history.entries.push({ id: root, params: root === "agents" ? { section: "overview" } : { filter: "all" } }); history.index = 0; }
    }
    const normalized = JSON.parse(JSON.stringify(params || {}));
    const prior = history.entries[history.index];
    if (!prior || prior.id !== id || JSON.stringify(prior.params) !== JSON.stringify(normalized)) {
      history.entries.splice(history.index + 1); history.entries.push({ id, params: normalized });
      if (history.entries.length > 60) history.entries.shift();
      history.index = history.entries.length - 1;
    }
    historyActive = key;
  }
  function historyState() {
    const history = histories.get(historyKey(sectionOf(get(current()))));
    return { canBack: Boolean(history && history.index > 0), canForward: Boolean(history && history.index < history.entries.length - 1) };
  }
  function lastSectionRoute(section, fallback) {
    const history = histories.get(historyKey(section));
    const entry = history?.entries[history.index];
    return entry && get(entry.id) ? entry : { id: fallback, params: {} };
  }
  async function travelHistory(delta) {
    const key = historyKey(sectionOf(get(current()))), history = histories.get(key);
    const next = history?.index + delta;
    if (historyRestoring || !history || next < 0 || next >= history.entries.length) return false;
    capturePage(history.entries[history.index]); history.index = next; historyActive = key;
    const target = history.entries[next]; historyRestoring = true;
    try {
      await go(target.id, target.params, { history: false });
      requestAnimationFrame(() => requestAnimationFrame(() => {
        for (const [id, top, left] of target.scroll || []) { const el = document.getElementById(id); if (el && !el.closest?.("[hidden]")) { el.scrollTop = top; el.scrollLeft = left; } }
        const focus = target.focus && document.getElementById(target.focus);
        if (focus && !focus.closest?.("[hidden], [inert]")) focus.focus?.({ preventScroll: true });
        window.MefiScroll?.refresh?.();
      }));
    } finally { historyRestoring = false; paintCurrent(); }
    return true;
  }
  const back = () => travelHistory(-1);
  const forward = () => travelHistory(1);
  function paintHistory(nav) {
    let controls = nav.querySelector?.(".studio-history");
    if (!controls) {
      controls = document.createElement("div"); controls.className = "studio-history"; controls.setAttribute("role", "group"); controls.setAttribute("aria-label", "Section history");
      for (const [name, glyph, run] of [["Back", "←", back], ["Forward", "→", forward]]) {
        const button = document.createElement("button"); button.type = "button"; button.className = "ghost mini";
        button.textContent = glyph; button.dataset.history = name.toLowerCase(); button.setAttribute("aria-label", `${name} within this section`); button.title = `${name} within this section (Alt ${name === "Back" ? "←" : "→"})`; button.addEventListener("click", run); controls.append(button);
      }
      nav.insertBefore(controls, nav.firstChild);
    }
    const status = historyState();
    controls.querySelector('[data-history="back"]').disabled = !status.canBack;
    controls.querySelector('[data-history="forward"]').disabled = !status.canForward;
  }
  document.addEventListener("keydown", (event) => {
    if (!event.altKey || event.ctrlKey || event.metaKey || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation(); if (event.key === "ArrowLeft") back(); else forward();
  });

  // ---- layers ------------------------------------------------------------

  // The focusable dialog root inside a destination's overlay, if it has one.
  function dialogRoot(dest) {
    const root = dest?.element ? document.getElementById(dest.element) : null;
    return root?.querySelector(".explorer-sheet, .sheet, .palette-sheet, .brains-sheet, .agent-brain-sheet") ?? null;
  }

  function layerRoot(dest) {
    return dest?.element ? document.getElementById(dest.element) : null;
  }
  const visibleNavTarget = (element) => Boolean(element && !element.hidden && !element.closest?.("[hidden], [inert]") && (element.getClientRects?.().length ?? 1) > 0);

  // A sheet replacing a sheet keeps one continuous scrim (styles.css,
  // "presence"): both roots skip their fade for this one swap, so two
  // half-faded scrims never stack and pump; only the new panel rises.
  function markSwap(...roots) {
    const marked = roots.filter((root) => typeof root?.setAttribute === "function");
    if (!marked.length) return;
    for (const root of marked) root.setAttribute("data-swap", "");
    const clear = () => marked.forEach((root) => root.removeAttribute?.("data-swap"));
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => requestAnimationFrame(clear));
    else if (typeof setTimeout === "function") setTimeout(clear, 50);
  }

  function claim(id) {
    const dest = get(id);
    if (!dest?.layer) return;
    if (dest.layer === "sheet") {
      // Sheets are mutually exclusive; the transient layer above them is untouched.
      if (state.sheet && state.sheet !== id) {
        markSwap(layerRoot(get(state.sheet)), layerRoot(dest));
        get(state.sheet)?.close?.();
      }
      state.sheet = id;
      document.body.dataset.sheet = id;
    } else {
      if (state.transient && state.transient !== id) {
        markSwap(layerRoot(get(state.transient)), layerRoot(dest));
        get(state.transient)?.close?.();
      }
      state.transient = id;
    }
    if (!state.focusReturn[dest.layer]) state.focusReturn[dest.layer] = document.activeElement;
    state.returnTo = idleActive() ? "command" : window.MefiWorkspace?.isActive?.() ? "workspace" : window.MefiVibe?.isActive?.() ? "vibe" : null;
    const root = dest.element ? document.getElementById(dest.element) : null;
    root?.classList.toggle("from-command", Boolean(state.returnTo));
    const back = root?.querySelector(".sheet-back");
    if (back) {
      const label = state.returnTo === "workspace" ? "Workspace" : state.returnTo === "vibe" ? "Vibe" : "Command";
      back.title = `Back to ${label} (Esc)`;
      const copy = back.querySelector(".label");
      if (copy) copy.textContent = label;
    }
    const sheet = dialogRoot(dest);
    const page = isWorkspacePage(dest);
    root?.classList.toggle("workspace-page", page);
    if (WORKSPACE_PAGES.has(id)) {
      const exit = document.getElementById(`${id}-close`);
      const label = exit?.querySelector(".label");
      const origin = get(state.returnTo ?? underlyingView());
      const name = page ? `Back within ${SECTIONS.get(sectionOf(dest)) || "this section"}` : "Close";
      if (label) label.textContent = page ? "Back" : "Close";
      if (exit) { exit.title = `${name} (Esc)`; exit.setAttribute("aria-label", name); }
      exit?.querySelector("use")?.setAttribute("href", page ? "#g-back" : "#g-close");
    }
    syncPageInert();
    if (sheet) {
      sheet.setAttribute("role", page ? "region" : "dialog");
      if (page) sheet.removeAttribute("aria-modal");
      else sheet.setAttribute("aria-modal", "true");
    }
    requestAnimationFrame(() => {
      const requested = dest.focus ? Array.from(document.querySelectorAll?.(dest.focus) ?? []).find(visibleNavTarget) : null;
      const selected = Array.from(root?.querySelectorAll?.('[aria-selected="true"]') ?? []).find(visibleNavTarget);
      const target = requested ?? selected ?? sheet;
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
    syncPageInert();
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
      if (saved.closest?.("#app-rail")) focusRailButton(saved);
      else saved.focus?.();
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
    if (WORKSPACE_PAGES.has(id) && current() === id) {
      if (historyState().canBack) return back();
      const home = sectionOf(get(id)) === "agents" ? "agents" : "tasks";
      if (id !== home) return go(home);
      return;
    }
    get(id)?.close?.();
  }

  function closeAll() {
    if (state.transient) get(state.transient)?.close?.();
    if (state.sheet) get(state.sheet)?.close?.();
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
    const redirected = window.MefiAgents?.redirect?.(id, params);
    if (redirected) return go(redirected.id, redirected.params, options);
    // In Vibe mode, Home is Vibe: every Home button, H and Esc out of Command land there.
    if (id === "workspace" && window.MefiVibe?.mode?.() === "vibe") id = "vibe";
    closeHelpMenu();
    delete document.documentElement.dataset.railDrawer;
    const dest = get(id);
    if (!dest) return;
    if (dest.kind !== "action" && dest.layer !== "transient") window.MefiMusic?.leaveSettingsAppearance?.({ keepTree: id === "command" });
    const projectId = params.projectId || taskProjectId || window.MefiTasks?.state?.projectId || (window.MefiWorkspace?.activeProjectId?.() || window.MefiWorkspace?.state?.activeId);
    const context = taskContext(projectId);
    const activeProject = (window.MefiWorkspace?.activeProjectId?.() || window.MefiWorkspace?.state?.activeId) || window.MefiTasks?.state?.projectId || taskProjectId;
    if (params.taskId && projectId && (!activeProject || activeProject === projectId)) selectTask({ ...params, projectId });
    if (id === "tasks" && !params.taskId && !params.filter && !params.readiness && context) params = { ...params, taskId: context.taskId, projectId: context.projectId };
    if (id === "command" && !params.preserveSelection && !params.selected && !params.sessionId && !params.rail && (params.taskId || context?.taskId)) params = { ...params, selected: `task:${params.taskId || context.taskId}` };
    if (dest.kind !== "action" && dest.layer !== "transient" && options.history !== false) rememberRoute(id, params);
    const navCommand = document.getElementById("nav-command");
    if (dest.kind === "action") {
      dest.run?.(params, options);
      dispatchNav(id, "open", params);
      return;
    }
    if (dest.kind === "view") {
      // Remember what Command was entered from, so leaving it goes back there.
      if (id === "command" && !idleActive()) state.commandFrom = underlyingView();
      closeAll();
      if (id !== "workspace") window.MefiWorkspace?.exit?.();
      if (id !== "vibe") window.MefiVibe?.exit?.();
      if (id !== "command" && idleActive()) window.MefiIdle?.exit?.();
      state.returnTo = null;
      navCommand?.classList.remove("return");
      const opened = dest.open?.(params);
      dispatchNav(id, "open", params);
      return opened;
    }
    if (dest.kind === "tab") {
      closeAll();
      window.MefiWorkspace?.exit?.();
      window.MefiVibe?.exit?.();
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
    return dest.open?.(params);
  }

  // The surface under any sheet: the workspace, or the active tab.
  function underlyingView() {
    if (window.MefiWorkspace?.isActive?.()) return "workspace";
    if (window.MefiVibe?.isActive?.()) return "vibe";
    const tab = document.querySelector?.(".tab.active")?.dataset?.tab ?? null;
    return tab === "graph" ? modelRoute : tab;
  }

  // Leaving Command (Esc, the exit button, D) returns to where it was entered
  // from, the workspace by default. MefiIdle.exit() alone only hides the
  // canvas, and go("command") had already left the workspace, so whatever tab
  // sat underneath (the Model catalog) used to show through.
  function leaveCommand() {
    if (sectionOf(get(current())) === "agents") { if (historyState().canBack) return back(); return go("agents"); }
    const destination = state.commandFrom && state.commandFrom !== "command" ? state.commandFrom : "workspace";
    state.commandFrom = null;
    window.MefiIdle?.exit?.();
    if (get(destination)) go(destination);
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
    if (dest.alert) {
      // A warning count: decisions the agents are waiting on.
      const element = document.createElement("span");
      element.className = "count warn";
      element.dataset.badge = dest.alert;
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

  // The "More tools" summary every menu shares: a glyph, the label and a chevron
  // that the stylesheet turns while the menu is open.
  function moreSummary(className) {
    const summary = document.createElement("summary");
    if (className) summary.className = className;
    summary.append(glyphNode("g-more"));
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = "More tools";
    summary.append(label);
    const chevron = glyphNode("g-chev");
    chevron.setAttribute("class", "glyph chev");
    summary.append(chevron);
    return summary;
  }

  function separator(className) {
    const element = document.createElement("span");
    element.className = className;
    element.setAttribute("aria-hidden", "true");
    return element;
  }

  // The More tools menus group by the same sections as the rail. Home rides
  // with Work, the foot's Community with Help, and anything else unfiled
  // lands in Settings.
  const MENU_GROUPS = ["Work", "Agents", "Settings", "Help"];
  function menuGroup(dest) {
    const section = sectionOf(dest);
    if (section === "home") return "Work";
    if (section === "community") return "Help";
    const label = SECTIONS.get(section);
    return MENU_GROUPS.includes(label) ? label : "Settings";
  }

  function appendGrouped(target, destinations, buttonClass) {
    for (const label of MENU_GROUPS) {
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
    // Workspace, Command, Task board, Plans and Brain maps are pinned at the
    // top of the sidebar and Settings / Music sit in its bottom row, so none
    // repeat here.
    appendGrouped(element, list().filter((dest) =>
      !["workspace", "command", "tasks", "plans", "brains", "studio", "music"].includes(dest.id) &&
      dest.kind !== "action" && (dest.layer !== "transient" || dest.id === "profiler")), "ghost");
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
    const summary = moreSummary("dock-item");
    const links = document.createElement("div");
    links.className = "cmd-more-links";
    appendGrouped(links, destinations.filter((item) => !item.commandPrimary), "dock-item");
    more.append(summary, links);
    element.append(more);
    paintBadges(element);
  }

  // ---- the one rail --------------------------------------------------------
  // docs/ux-audit.md, Phase 3: one navigation surface for the whole app instead
  // of a tabs row, a dock and a hover sidebar that each render the registry
  // their own way. It is built from the same registry as the palette, the dock
  // and the help sheet, so a destination added there turns up here with its
  // glyph, key and badge. The rail keeps no list of its own: each record's
  // section says where it goes (the same sections the "More tools" menus,
  // the shortcut sheet and the palette use), and RAIL_SLOTS places the late
  // arrivals whose kind would otherwise keep them out (Community).
  //
  // It is the default. html[data-shell="rail"] (applyShell) is what turns it
  // on, and "classic" — ?shell=classic, or the palette's switch, remembered —
  // brings back the tabs row, the Command dock and the hover sidebar for anyone
  // who needs them while the rail beds in.
  const SHELL_KEY = "mefiStudio.shell";
  const RAIL_PIN_KEY = "mefiStudio.railPinned";
  // Each head is its target's own button and draws the target's glyph, so a
  // section and its main destination never show two different icons.
  const RAIL_SECTIONS = [
    { id: "home", label: "Home", target: "workspace" },
    { id: "work", label: "Work", target: "tasks" },
    { id: "agents", label: "Agents", target: "agents" },
  ];
  const LOCAL_ROUTES = Object.freeze({
    home: ["workspace"],
    work: ["tasks", "plans", "ideas", "analyzer"],
    agents: ["agents", "command", "eyes", "explorer", "overhead", "agent-brain", "brains", "context", "booklet", "graph", "usage"],
    settings: ["studio"],
  });

  // Home supplies its existing board snapshot. The sidebar never fetches a
  // second copy or mixes the task history of two projects.
  const recentTasks = new Map();
  let recentProjectId = null;
  function setRecentTasks({ projectId, tasks } = {}) {
    if (!projectId || !Array.isArray(tasks)) return;
    const stamp = (task) => Number(task.updatedAt || task.createdAt) || Date.parse(task.updatedAt || task.createdAt || "") || 0;
    const seen = new Set();
    const rows = tasks.filter((task) => {
      if (!task?.id || task.archived || task.status === "archived" || task.projectId && task.projectId !== projectId || seen.has(task.id)) return false;
      seen.add(task.id); return true;
    }).sort((left, right) => stamp(right) - stamp(left)).slice(0, 6).map((task) => ({
      id: String(task.id), projectId, title: String(task.title || task.prompt || "Untitled task"),
      label: window.MefiTasks?.shortTitle?.(task) || String(task.title || task.prompt || "Untitled task").replace(/\s+/g, " ").slice(0, 72),
    }));
    recentTasks.set(projectId, rows);
    recentProjectId = projectId;
    // Workspace supplies the current project's snapshot, including an empty
    // board. Initial project reads need not emit onProjects, and an empty
    // board has no selected task that could otherwise update this context.
    if (!(window.MefiWorkspace?.activeProjectId?.() || window.MefiWorkspace?.state?.activeId) && taskProjectId !== projectId) {
      taskProjectId = projectId;
      paintTaskContext();
    }
    paintRecentTasks();
  }

  function paintRecentTasks() {
    const list = document.getElementById("app-rail-recent-list");
    if (!list) return;
    const projectId = (window.MefiWorkspace?.activeProjectId?.() || window.MefiWorkspace?.state?.activeId) || taskProjectId || recentProjectId;
    const rows = recentTasks.get(projectId) || [];
    const selected = taskContext(projectId);
    const held = list.contains(document.activeElement) ? document.activeElement : null;
    const existing = new Map(Array.from(list.querySelectorAll("button")).map((button) => [`${button.dataset.projectId}:${button.dataset.taskId}`, button]));
    const wanted = new Set(rows.map((task) => `${projectId}:${task.id}`));
    for (const [key, button] of existing) if (!wanted.has(key)) button.remove();
    rows.forEach((task, index) => {
      let button = existing.get(`${projectId}:${task.id}`);
      if (!button) {
        button = document.createElement("button"); button.type = "button";
        button.className = "app-rail-item app-rail-recent-task"; button.tabIndex = -1;
        button.dataset.taskId = task.id; button.dataset.projectId = projectId;
        const label = document.createElement("span"); label.className = "label"; button.append(label);
        button.addEventListener("click", () => go("tasks", { taskId: task.id, projectId, title: button.title }));
      }
      button.querySelector(".label").textContent = task.label;
      button.title = task.title;
      button.setAttribute("aria-pressed", String(selected?.taskId === task.id));
      if (list.children[index] !== button) { button.remove(); list.insertBefore(button, list.children[index] || null); }
    });
    const empty = document.getElementById("app-rail-recent-empty");
    if (empty) empty.hidden = rows.length > 0;
    if (held && document.activeElement !== held) {
      if (list.contains(held)) focusRailButton(held);
      else document.querySelector('#app-rail .app-rail-head[data-section="work"]')?.focus?.();
    }
  }

  function railSection(dest) {
    if (!dest) return null;
    if (ownKey(RAIL_SLOTS, dest.id)) return RAIL_SLOTS[dest.id];
    if (["studio", "palette", "help", "onboarding"].includes(dest.id)) return "foot";
    if (dest.kind === "action") return null;
    return RAIL_SECTIONS.some((item) => item.id === sectionOf(dest)) ? sectionOf(dest) : null;
  }

  function renderRail() {
    const sections = document.getElementById("app-rail-sections");
    const foot = document.getElementById("app-rail-foot");
    if (!sections || !foot) return;
    const helpWasOpen = document.getElementById("app-help-menu")?.hidden === false;
    const kept = Array.from(foot.children ?? []).filter((child) => !child.classList?.contains?.("app-rail-foot-item") && child.id !== "app-help-menu");
    sections.textContent = "";
    foot.textContent = "";
    const compose = document.createElement("button"); compose.type = "button";
    compose.id = "app-rail-compose"; compose.className = "app-rail-item app-rail-compose";
    compose.title = "New task"; compose.setAttribute("aria-label", "New task");
    compose.append(glyphNode("g-add"));
    const composeLabel = document.createElement("span"); composeLabel.className = "label"; composeLabel.textContent = "New task"; compose.append(composeLabel);
    compose.addEventListener("click", () => window.MefiWorkspace?.composeTask?.());
    const search = navButton(get("palette"), "app-rail-item app-rail-search");
    const vibe = get("vibe") ? navButton(get("vibe"), "app-rail-item app-rail-vibe", { key: false }) : null;
    if (vibe) { vibe.id = "app-rail-vibe"; vibe.title = "Vibe: the calm front door"; vibe.querySelector(".label").textContent = "Vibe mode"; }
    sections.append(...[vibe, compose, search].filter(Boolean));
    for (const section of RAIL_SECTIONS) {
      const target = get(section.target);
      const group = document.createElement("div");
      group.className = "app-rail-section";
      group.dataset.section = section.id;
      const head = navButton(target, "app-rail-head", { key: false });
      head.dataset.section = section.id;
      head.setAttribute("aria-label", section.label);
      head.title = section.label;
      const label = head.querySelector(".label");
      label.className = "app-rail-text";
      label.textContent = section.label;
      group.append(head);
      sections.append(group);
    }
    const recent = document.createElement("div"); recent.className = "app-rail-recent app-rail-children";
    recent.setAttribute("role", "group"); recent.setAttribute("aria-label", "Recent tasks");
    const recentHeading = document.createElement("span"); recentHeading.className = "app-rail-heading"; recentHeading.textContent = "Recent tasks";
    const recentList = document.createElement("div"); recentList.id = "app-rail-recent-list";
    const recentEmpty = document.createElement("span"); recentEmpty.id = "app-rail-recent-empty"; recentEmpty.textContent = "Your tasks will appear here";
    recent.append(recentHeading, recentList, recentEmpty); sections.append(recent);
    foot.append(navButton(get("studio"), "app-rail-item app-rail-foot-item"));
    const help = document.createElement("button");
    help.id = "app-help-toggle";
    help.className = "app-rail-item app-rail-foot-item";
    help.type = "button";
    help.title = "Help";
    help.setAttribute("aria-label", "Help");
    help.setAttribute("aria-expanded", String(helpWasOpen));
    help.setAttribute("aria-controls", "app-help-menu");
    help.append(glyphNode("g-help"));
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = "Help";
    help.append(label);
    const menu = document.createElement("div");
    menu.id = "app-help-menu";
    menu.hidden = !helpWasOpen;
    menu.setAttribute("role", "group");
    menu.setAttribute("aria-label", "Help");
    for (const id of ["onboarding", "help", "community"]) {
      const dest = get(id);
      if (dest) menu.append(navButton(dest, "app-rail-item", { key: false }));
    }
    help.addEventListener("click", () => {
      menu.hidden = !menu.hidden;
      help.setAttribute("aria-expanded", String(!menu.hidden));
      if (!menu.hidden) menu.querySelector("button")?.focus?.();
    });
    foot.append(help, menu, ...kept);
    paintBadges(document.getElementById("app-rail"));
    paintRail();
  }

  function closeHelpMenu(restoreFocus = false) {
    const menu = document.getElementById("app-help-menu");
    if (!menu || menu.hidden) return false;
    const focusHeld = menu.contains?.(document.activeElement);
    menu.hidden = true;
    const toggle = document.getElementById("app-help-toggle");
    toggle?.setAttribute("aria-expanded", "false");
    if (restoreFocus || focusHeld) toggle?.focus?.();
    return true;
  }

  function paintLocalNav(section, id) {
    let nav = document.getElementById("app-local-nav");
    if (!nav) {
      nav = document.createElement("nav");
      nav.id = "app-local-nav";
      document.body.append(nav);
      nav.addEventListener("keydown", (event) => {
        if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
        const parentRow = event.target?.closest?.(".agents-nav-sections");
        const buttons = Array.from(parentRow ? parentRow.querySelectorAll("[data-agent-section]") : nav.querySelectorAll("button")).filter((button) => !button.closest?.("[hidden]"));
        const at = buttons.indexOf(event.target?.closest?.("button"));
        const index = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (at + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
        event.preventDefault(); event.stopPropagation();
        buttons[index]?.focus?.();
      });
    }
    const routes = LOCAL_ROUTES[section];
    nav.hidden = !routes || document.documentElement.dataset.shell !== "rail";
    document.body.dataset.navSection = section || "home";
    if (!routes) return;
    nav.setAttribute("aria-label", `${SECTIONS.get(section)} views`);
    if (nav.dataset.section !== section) {
      nav.dataset.section = section;
      nav.textContent = "";
      if (section !== "agents" || !window.MefiAgents?.paintNav) for (const route of routes) nav.append(navButton(get(route), "app-local-link", { key: false }));
    }
    if (section === "agents") window.MefiAgents?.paintNav?.(nav, id);
    paintHistory(nav);
    for (const button of nav.querySelectorAll("button[data-nav]")) {
      if (button.dataset.nav === id) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
    paintBadges(nav);
    paintTaskContext();
  }

  function paintRail() {
    const rail = document.getElementById("app-rail");
    if (!rail || rail.hidden) return;
    const id = current();
    const section = sectionOf(get(id));
    for (const group of rail.querySelectorAll(".app-rail-section")) group.classList.toggle("current", group.dataset.section === section);
    for (const button of rail.querySelectorAll(".app-rail-head, .app-rail-foot-item[data-nav]")) {
      const selected = button.classList.contains("app-rail-head") ? button.dataset.section === section : button.dataset.nav === id;
      if (selected) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
    paintLocalNav(section, id);
    paintRecentTasks();
    if (!rail.contains?.(document.activeElement)) setRailStop(rail, restingStop(rail));
  }

  // The rail is one tab stop, like the old tabs row: the roving tabindex rests
  // where you are while focus is elsewhere, and follows the arrows once inside.
  // A pinned rail rests on the current destination. When it collapses, an
  // item folded under its section hands the stop to that section's head.
  function restingStop(rail) {
    const here = rail.querySelector('[aria-current="page"]');
    if (here && ("railPinned" in document.documentElement.dataset || !here.closest?.(".app-rail-children"))) return here;
    return rail.querySelector(".app-rail-section.current .app-rail-head") ?? rail.querySelector(".app-rail-head") ?? rail.querySelector("button");
  }

  // paintRail runs on every body class change, so only changed stops are written.
  function setRailStop(rail, stop) {
    if (!stop) return;
    for (const button of rail.querySelectorAll("button")) {
      const index = button === stop ? 0 : -1;
      if (button.tabIndex !== index) button.tabIndex = index;
    }
  }

  // What the arrows walk: every button the rail is showing, top to bottom.
  function railButtons(rail) {
    return Array.from(rail.querySelectorAll("button")).filter((button) =>
      !button.hidden && !button.disabled && !button.closest?.("[hidden]") && (button.getClientRects?.().length ?? 1) > 0);
  }

  // The collapsed rail hides its lists (display: none) and opens while one of
  // its buttons has keyboard focus (:has(:focus-visible)). Moving focus passes
  // through a moment with nothing focused, when Chromium checks the target
  // again with the rail shut and a listed button can no longer take focus, so
  // the target's list is held open for the move.
  function focusRailButton(button) {
    const list = button?.closest?.(".app-rail-children");
    if (list?.style) list.style.display = "flex";
    button?.focus?.({ preventScroll: false });
    if (list?.style) list.style.display = "";
  }

  function shellOn() {
    try {
      const param = new URLSearchParams(location.search).get("shell");
      if (param) return param !== "classic";
      return localStorage.getItem(SHELL_KEY) !== "classic";
    } catch {
      return true;
    }
  }

  // A pinned rail takes its open width from the page. Below this window width
  // it yields and behaves unpinned, opening over the page on hover or focus;
  // the saved choice stays, and the pin comes back when the window widens.
  const RAIL_PIN_MIN_WIDTH = 1100;
  let railPinWanted = false;
  const railPinFits = () => !(Number.isFinite(window.innerWidth) && window.innerWidth < RAIL_PIN_MIN_WIDTH);

  function setRailPinned(pinned, { save = true } = {}) {
    railPinWanted = Boolean(pinned);
    document.getElementById("app-rail-pin")?.setAttribute("aria-pressed", String(railPinWanted));
    if (save) {
      try { localStorage.setItem(RAIL_PIN_KEY, pinned ? "1" : "0"); } catch { /* the pin is a convenience */ }
    }
    applyRailPin({ force: true });
  }

  // Pins the rail while it is wanted and fits the window. Every layer is offset
  // by the rail's width, and a pinned rail is wider, so a change (or an explicit
  // toggle) lets anything that measures the window (Command's graph) measure again.
  function applyRailPin({ force = false } = {}) {
    const root = document.documentElement;
    const pinned = railPinWanted && railPinFits();
    const changed = pinned !== ("railPinned" in root.dataset);
    if (pinned) root.dataset.railPinned = "";
    else delete root.dataset.railPinned;
    if (changed) paintRail();
    if (changed || force) window.dispatchEvent(new Event("resize"));
  }

  function applyShell(on = shellOn()) {
    const rail = document.getElementById("app-rail");
    if (!rail) return false;
    const root = document.documentElement;
    if (on) root.dataset.shell = "rail";
    else delete root.dataset.shell;
    rail.hidden = !on;
    const local = document.getElementById("app-local-nav");
    if (local) local.hidden = !on;
    let pinned = true;
    try { pinned = localStorage.getItem(RAIL_PIN_KEY) !== "0"; } catch { /* use the wide-window default */ }
    setRailPinned(on && pinned, { save: false });
    if (on) renderRail();
    window.dispatchEvent(new CustomEvent("mefi:shell", { detail: { rail: on } }));
    return on;
  }

  function setShell(on) {
    try { localStorage.setItem(SHELL_KEY, on ? "rail" : "classic"); } catch { /* this launch only */ }
    return applyShell(Boolean(on));
  }

  function wireRail() {
    const rail = document.getElementById("app-rail");
    if (!rail || rail.dataset.wired) return;
    rail.dataset.wired = "1";
    const brand = document.getElementById("app-rail-brand");
    // The project list used to open only from a transparent 6px strip; the
    // brand is now its visible door.
    brand?.addEventListener("click", () => {
      const sidebar = window.MefiSidebar;
      if (!sidebar) return;
      if (sidebar.isOpen?.()) sidebar.close({ restoreFocus: true });
      else sidebar.open({ focus: true });
    });
    document.getElementById("app-rail-pin")?.addEventListener("click", () => {
      setRailPinned(!railPinWanted);
      if (!railPinFits()) {
        if (railPinWanted) document.documentElement.dataset.railDrawer = "";
        else delete document.documentElement.dataset.railDrawer;
      }
      if (railPinWanted && !railPinFits()) {
        window.MefiToast?.(`The menu stays open in windows ${RAIL_PIN_MIN_WIDTH}px wide or more; narrower, it opens over the page.`, "info");
      }
    });
    window.addEventListener("resize", () => applyRailPin());
    // Repaint when you come to look at it, and whenever the view underneath
    // changes by a route that does not announce itself on mefi:nav.
    rail.addEventListener("pointerenter", paintRail);
    rail.addEventListener("focusin", (event) => {
      paintRail();
      const button = event.target?.closest?.("button");
      if (button && rail.contains(button)) setRailStop(rail, button);
    });
    // Leaving hands the stop back to where you are: the button last focused
    // may be folded away once the rail collapses.
    rail.addEventListener("focusout", (event) => {
      if (!rail.contains(event.relatedTarget)) setRailStop(rail, restingStop(rail));
    });
    // Up/Down walk the buttons top to bottom and wrap; Home/End jump to the
    // ends. The keys stop here, because Command's canvas pans and selects
    // with the same arrows from its own document and window listeners.
    rail.addEventListener("keydown", (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const buttons = railButtons(rail);
      if (!buttons.length) return;
      const at = buttons.indexOf(event.target?.closest?.("button"));
      const last = buttons.length - 1;
      let next = event.key === "Home" ? 0 : last;
      if (event.key === "ArrowDown") next = at < 0 || at === last ? 0 : at + 1;
      else if (event.key === "ArrowUp") next = at <= 0 ? last : at - 1;
      event.preventDefault();
      event.stopPropagation();
      setRailStop(rail, buttons[next]);
      focusRailButton(buttons[next]);
    });
    const sidebar = document.getElementById("workspace-sidebar");
    if (typeof MutationObserver === "function") {
      new MutationObserver(() => {
        paintRail();
        brand?.setAttribute("aria-expanded", String(sidebar?.dataset.open === "true"));
      }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
      if (sidebar) new MutationObserver(() => brand?.setAttribute("aria-expanded", String(sidebar.dataset.open === "true"))).observe(sidebar, { attributes: true, attributeFilter: ["data-open"] });
    }
  }

  register({
    id: "shellRail",
    label: "Switch navigation: rail or classic",
    short: "Navigation",
    kind: "action",
    layer: null,
    section: "settings",
    group: "system",
    key: null,
    glyph: "g-pin",
    badge: null,
    desc: "Swap the navigation rail for the classic tabs row, Command dock and hover sidebar, or back",
    searchTerms: ["shell", "sidebar", "navigation", "menu", "layout"],
    showIn: showIn({ palette: true }),
    run: () => setShell(document.documentElement.dataset.shell !== "rail"),
  });

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
      menu.append(moreSummary());
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

  // The shortcut sheet speaks the rail's sections, then Command view's own
  // keys: one small key grid per section, which the stylesheet sets in two
  // columns. Escape has no destination, so it is the one hard-coded row,
  // under Help.
  const HELP_SECTIONS = [
    ["Home & Work", ["home", "work"]],
    ["Agents", ["agents"]],
    ["Settings", ["settings"]],
    ["Help", ["help", "community"]],
    ["Command view", ["command"]],
  ];

  function renderHelp(target) {
    const element = target ?? document.getElementById("help-grid");
    if (!element) return;
    element.textContent = "";
    const rows = list({ showIn: "help" }).filter((dest) => dest.key);
    HELP_SECTIONS.forEach(([title, sections], index) => {
      const items = rows.filter((dest) => sections.includes(sectionOf(dest)));
      if (!items.length && title !== "Help") return;
      const group = document.createElement("div");
      group.className = "help-section";
      group.setAttribute("role", "group");
      const heading = document.createElement("h4");
      heading.className = "help-group";
      heading.id = `help-section-${index}`;
      heading.textContent = title;
      group.setAttribute("aria-labelledby", heading.id);
      group.append(heading);
      for (const dest of items) {
        group.append(helpRow(dest.key, dest.label));
        if (dest.chord) group.append(helpRow(dest.chord, dest.label));
      }
      if (title === "Help") group.append(helpRow("Esc", ESC_HELP));
      element.append(group);
    });
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

  // ---- motion switch -----------------------------------------------------
  // One answer for CSS and JS: body.no-motion (the Motion setting) or the OS
  // reduced-motion preference. It is cached, because the Command canvas asks
  // many times a frame, and mirrored to html[data-motion] so the stylesheet,
  // the view-transition pseudo-elements and WAAPI all read the same switch.
  let motionOff = null;
  let motionCalm = false;
  let reduceQuery;
  function syncMotion() {
    if (reduceQuery === undefined) {
      try {
        reduceQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
      } catch {
        reduceQuery = null;
      }
    }
    motionOff = Boolean(document.body?.classList?.contains?.("no-motion") || reduceQuery?.matches);
    // Calm (body.ws-still): the interface still eases, decorative loops stop.
    motionCalm = !motionOff && Boolean(document.body?.classList?.contains?.("ws-still"));
    if (document.documentElement?.dataset) document.documentElement.dataset.motion = motionOff ? "off" : motionCalm ? "calm" : "on";
    return motionOff;
  }
  function noMotion() {
    return motionOff ?? syncMotion();
  }
  function watchMotion() {
    syncMotion();
    reduceQuery?.addEventListener?.("change", syncMotion);
    if (typeof MutationObserver === "function" && document.body) {
      new MutationObserver(syncMotion).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    }
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
    if (!event.target?.closest?.("#app-help-menu, #app-help-toggle")) closeHelpMenu();
    for (const menu of document.querySelectorAll(".studio-more[open], .cmd-more-tools[open]")) {
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
    if (button.classList.contains("app-rail-head")) {
      const section = button.dataset.section;
      const fallback = section === "agents" ? "command" : button.dataset.nav;
      const target = sectionOf(get(current())) === section
        ? { id: fallback, params: {} }
        : lastSectionRoute(section, fallback);
      go(target.id, target.params);
    } else go(button.dataset.nav, params);
    const menu = button.closest("details");
    if (menu && menu.id !== "workspace-tools") menu.removeAttribute("open");
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
    if (event.defaultPrevented || window.MefiCompanionHub?.isOpen()) return;
    if (event.key === "Escape" && closeHelpMenu(true)) { event.preventDefault(); return; }
    if (event.key === "Escape" && "railDrawer" in (document.documentElement?.dataset ?? {}) && !state.transient) {
      delete document.documentElement.dataset.railDrawer;
      document.getElementById("app-rail-pin")?.focus?.();
      event.preventDefault(); return;
    }
    if (event.key === "Escape" && !state.transient && window.MefiSidebar?.isOpen?.()) {
      event.preventDefault();
      window.MefiSidebar.close({ restoreFocus: true });
      return;
    }
    // Command's own More tools menu is the fallback only while Command is on
    // top; a sheet above it must not have Esc (and focus) pulled out from under it.
    const more = document.activeElement?.closest?.(".studio-more[open], .cmd-more-tools[open], .surface-tools[open]") ?? Array.from(document.querySelectorAll?.(".surface-tools[open]") ?? []).find(visibleNavTarget) ?? (top() === "command" ? document.getElementById("cmd-more-tools") : null);
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
    // 2. Ctrl+, opens Settings from anywhere too. The chord lives in the
    //    studio record's keyMatch; a plain 4 still goes through the loop below.
    if ((event.ctrlKey || event.metaKey) && get("studio")?.keyMatch?.(event)) {
      event.preventDefault();
      go("studio");
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
      if (!state.transient && window.MefiCompanionHub?.open()) { event.preventDefault(); return; }
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

  // ---- current destination -----------------------------------------------

  // The surface the user is looking at: an open sheet, Command, the workspace
  // or the active tab. The sidebar paints it as aria-current on its own entry.
  function current() {
    if (state.sheet) return state.sheet;
    if (window.MefiMusic?.settingsAppearanceActive?.()) return "studio";
    if (idleActive()) return "command";
    if (window.MefiWorkspace?.isActive?.()) return "workspace";
    if (window.MefiVibe?.isActive?.()) return "vibe";
    const tab = document.querySelector?.(".tab.active")?.dataset?.tab ?? null;
    return tab === "graph" ? modelRoute : tab;
  }

  function paintCurrent() {
    const id = current();
    for (const button of document.querySelectorAll?.("#workspace-sidebar-panel [data-nav]") ?? []) {
      if (button.dataset.nav === id) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
    paintRail();
  }

  window.addEventListener("mefi:nav", paintCurrent);
  window.addEventListener("mefi:model-view", (event) => {
    const view = event.detail?.view;
    if (["usage", "tracker"].includes(view)) usageView = view;
    modelRoute = view === "context" ? "context" : ["usage", "tracker"].includes(view) ? "usage" : "graph";
    if (tabOpen("graph")) { paintRail(); paintPage({ id: modelRoute, action: "open" }); }
  });

  // ---- page header -------------------------------------------------------
  // The tab pages share one header. It names the page you are on and, when
  // Command sent you there, offers the way back: the classic tabs row keeps
  // that marker on #nav-command, which the rail shell hides. Painted from
  // go()'s own announcement, so every route that opens a page is covered.
  let pageFromCommand = false;
  function paintPage(detail) {
    const dest = detail?.action === "open" ? get(detail.id) : null;
    if (dest?.kind === "tab") {
      pageFromCommand = state.returnTo === "command";
      const title = document.getElementById("page-title");
      if (title) title.textContent = dest.label;
    } else if (dest?.kind === "view") {
      pageFromCommand = false;
    }
    const back = document.getElementById("page-return");
    if (back) back.hidden = !pageFromCommand;
  }

  window.addEventListener("mefi:nav", (event) => paintPage(event?.detail));

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

  let liveUpdateStatus = null;
  let releaseUpdateState = null;

  // Where the updater's controls live. The pill and every update toast that
  // sends you there name it and open it at that card.
  const UPDATES_PLACE = "Settings › Updates";
  const UPDATES_SECTION = "settings-updates";
  const openUpdates = () => ({ label: "Open", run: () => go("studio", { section: UPDATES_SECTION }) });

  function paintPill() {
    const pill = document.querySelector("#update-pill");
    if (!pill) return;
    const view = updateView(liveUpdateStatus);
    const release = releaseUpdateState;
    // The steady "watching" state never masks a published build; an actual
    // pending/working/held live update still owns the pill.
    const liveBusy = ["pending", "working", "held"].includes(view.state);
    const releasePill = !liveBusy && release && ["available", "downloading", "applying"].includes(release.state);
    if (releasePill) {
      const version = release.latest?.version ? `v${release.latest.version}` : "a new build";
      pill.hidden = false;
      pill.dataset.release = "1";
      pill.dataset.state = release.state === "available" ? "pending" : "working";
      pill.title =
        release.state === "available"
          ? `New build on GitHub: ${version} · open ${UPDATES_PLACE}`
          : release.state === "downloading"
            ? `Downloading ${version}…`
            : `Installing ${version} · the app restarts`;
      const label = pill.querySelector(".label");
      if (label) label.textContent = release.state === "available" ? `Update ${version}` : release.state === "downloading" ? "Downloading update" : "Installing update";
      return;
    }
    delete pill.dataset.release;
    pill.hidden = view.hidden;
    pill.dataset.state = view.state;
    pill.title = `${view.title} · open ${UPDATES_PLACE}`;
    const label = pill.querySelector(".label");
    if (label) label.textContent = view.label;
  }

  function paintUpdate(status) {
    liveUpdateStatus = status;
    const view = updateView(status);
    paintPill();
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

  const updateToastSignatures = new Map();

  function updateToast(payload) {
    const phase = payload?.phase;
    // A deferred restart retries every few seconds and replays the same
    // detected/waiting/pending events. Keep the status live, but announce
    // each unchanged phase only once until the update is applied or cleared.
    if (["watching", "reloaded", "restarted", "styled", "swapped", "stopped"].includes(phase)) updateToastSignatures.clear();
    if (["detected", "pending", "waiting", "held", "error"].includes(phase)) {
      const signature = JSON.stringify([payload.kind, [...(payload.files ?? [])].sort(), payload.reason, payload.error]);
      if (updateToastSignatures.get(phase) === signature) return;
      updateToastSignatures.set(phase, signature);
    }
    const count = Array.isArray(payload?.files) ? payload.files.length : 0;
    if (phase === "detected") {
      const kind = payload.kind;
      window.MefiToast?.(
        kind === "restart" ? "Update detected · restarts after a pause…" : kind === "reload" ? "Update detected · reloads after a pause…" : "Update detected · applying in place…",
        "info"
      );
    } else if (phase === "pending") {
      window.MefiToast?.(`Update pending · apply it from ${UPDATES_PLACE}`, "info", { action: openUpdates() });
    } else if (phase === "waiting") {
      window.MefiToast?.(payload.kind === "restart" ? "Update ready · restarts at the next pause" : "Update ready · reloads at the next pause", "info");
    } else if (phase === "styled") {
      window.MefiToast?.("Updated in place · styles", "good");
    } else if (phase === "swapped") {
      const modules = Array.isArray(payload.modules) ? payload.modules.length : count;
      window.MefiToast?.(`Updated in place · ${plural(modules, "module")}`, "good");
    } else if (phase === "held") {
      if (payload.reason === "incomplete source files") return;
      window.MefiToast?.(`Update held · ${payload.reason ?? "unknown"}`, "bad", { action: openUpdates() });
    } else if (phase === "error") {
      window.MefiToast?.(`Update failed · ${payload.error ?? payload.reason ?? "unknown"}`, "bad", { action: openUpdates() });
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
      section: "settings",
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
      section: "settings",
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
    // The pill opens Settings › Updates; while an update waits for a pause,
    // clicking it also applies now (the host skips its gate for a manual
    // apply). A release pill only navigates: installing a published build is
    // the button's job. The pill's markup may move (the rail foot shows it as
    // a badge), so its deep link is set here, by id.
    const pill = document.querySelector("#update-pill");
    if (pill) {
      pill.dataset.nav ||= "studio";
      pill.dataset.navParams ||= JSON.stringify({ section: UPDATES_SECTION });
    }
    pill?.addEventListener("click", () => {
      if (pill.dataset.release === "1") return;
      if (pill.dataset.state === "pending") applyUpdate();
    });
    window.mefiStudio.onUpdateEvent?.(onUpdateEvent);
    window.mefiStudio
      .updateStatus()
      .then((result) => paintUpdate(result?.status))
      .catch(() => {});
  }

  // ---- GitHub release updates ---------------------------------------------

  function releaseView(status) {
    const state = status?.state ?? "idle";
    const version = status?.latest?.version ? `v${status.latest.version}` : "a new build";
    if (state === "checking") return { line: "checking GitHub…", busy: true };
    if (state === "available") return { line: `update available · ${version}`, button: `Update to ${version}` };
    if (state === "downloading") {
      const percent = status?.progress?.percent;
      return { line: `downloading ${version}${Number.isFinite(percent) ? ` · ${percent}%` : ""}…`, button: "Downloading…", busy: true };
    }
    if (state === "applying") return { line: `installing ${version} · the app restarts`, button: "Installing…", busy: true };
    if (state === "installed") return { line: `updated to v${status?.installed?.version ?? ""} · running this build`, installed: true };
    if (state === "none") return { line: "no published release yet" };
    if (state === "current") return { line: `up to date${status?.current ? ` · v${status.current}` : ""}` };
    if (state === "error") return { line: `check failed · ${status?.error ?? "unknown"}`, bad: true, token: Boolean(status?.needsToken) };
    return { line: "not checked" };
  }

  function paintRelease(status) {
    if (status) releaseUpdateState = status;
    const state = releaseUpdateState;
    const view = releaseView(state);
    const line = document.querySelector("#release-status");
    if (line) {
      line.textContent = `release · ${view.line}`;
      line.classList.toggle("bad-text", Boolean(view.bad));
    }
    const apply = document.querySelector("#release-apply");
    if (apply) {
      apply.hidden = !["available", "downloading", "applying"].includes(state?.state);
      apply.disabled = Boolean(view.busy);
      if (view.button) apply.textContent = view.button;
    }
    const check = document.querySelector("#release-check");
    if (check) check.disabled = Boolean(view.busy);
    const tokenRow = document.querySelector("#release-token-row");
    if (tokenRow) tokenRow.hidden = !view.token;
    paintPill();
  }

  function releaseToast(payload) {
    if (payload?.state === "available") {
      window.MefiToast?.(`Update available · v${payload.latest?.version} · ${UPDATES_PLACE}`, "info", { action: openUpdates() });
    } else if (payload?.state === "installed") {
      window.MefiToast?.(`Updated to v${payload.installed?.version}`, "good");
    } else if (payload?.state === "error" && payload?.error) {
      window.MefiToast?.(`Release check failed · ${payload.error}`, "bad");
    }
  }

  function onReleaseEvent(payload) {
    paintRelease(payload);
    releaseToast(payload);
  }

  async function checkReleaseNow() {
    if (!window.mefiStudio?.releaseCheck) return;
    try {
      const result = await window.mefiStudio.releaseCheck();
      paintRelease(result?.status);
      if (result?.status?.state === "current") window.MefiToast?.("GitHub release check · up to date", "info");
      else if (result?.status?.state === "none") window.MefiToast?.("GitHub release check · no published release yet", "info");
    } catch (error) {
      window.MefiToast?.(`Release check failed · ${String(error?.message ?? error)}`, "bad");
    }
  }

  async function applyReleaseNow() {
    if (!window.mefiStudio?.releaseApply) return;
    const button = document.querySelector("#release-apply");
    if (button) button.disabled = true;
    try {
      const result = await window.mefiStudio.releaseApply();
      paintRelease(result?.status);
      if (result?.ok === false) window.MefiToast?.(`Update failed · ${result.error}`, "bad");
    } catch (error) {
      window.MefiToast?.(`Update failed · ${String(error?.message ?? error)}`, "bad");
      if (button) button.disabled = false;
      window.mefiStudio
        .releaseStatus?.()
        .then((result) => paintRelease(result?.status))
        .catch(() => {});
    }
  }

  async function saveReleaseToken() {
    const input = document.querySelector("#release-token");
    const token = String(input?.value ?? "").trim();
    if (!token) {
      window.MefiToast?.("Paste a GitHub token first", "bad");
      return;
    }
    try {
      const result = await window.mefiStudio.setApiKey?.(token, "github");
      if (result?.ok === false) {
        window.MefiToast?.(`Token not saved · ${result.error}`, "bad");
        return;
      }
      if (input) input.value = "";
      window.MefiToast?.("GitHub token saved", "good");
      await checkReleaseNow();
    } catch (error) {
      window.MefiToast?.(`Token not saved · ${String(error?.message ?? error)}`, "bad");
    }
  }

  function initRelease() {
    const row = document.querySelector("[data-release-row]");
    if (!window.mefiStudio?.releaseStatus) {
      if (row) row.hidden = true;
      return;
    }
    document.querySelector("#release-check")?.addEventListener("click", () => checkReleaseNow());
    document.querySelector("#release-apply")?.addEventListener("click", () => applyReleaseNow());
    document.querySelector("#release-token-save")?.addEventListener("click", () => saveReleaseToken());
    window.mefiStudio.onReleaseEvent?.(onReleaseEvent);
    window.mefiStudio
      .releaseStatus()
      .then((result) => paintRelease(result?.status))
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
      vibe: Boolean(window.MefiVibe?.isActive?.()),
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
  function restoreDetails(saved, { forceFocus = false } = {}) {
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
      if (target && (forceFocus || current === document.body || current === null || current === target || current?.id === "idle-layer")) {
        target.focus?.({ preventScroll: true });
      }
    }
  }

  function consumeResume() {
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
    if (!saved || typeof saved.at !== "number" || Date.now() - saved.at > 60000) return null;
    return saved;
  }

  // The startup gate can await actual surface readiness instead of estimating
  // it with timers. Focus is repeated once after the gate releases its inert
  // content; a focus() during preload cannot reach an inert saved field.
  async function resumeReady({ isCurrent = () => true } = {}) {
    const canceled = () => ({ restored: false, finish() {} });
    if (!isCurrent()) return canceled();
    const saved = consumeResume();
    if (!saved) return canceled();
    if (document.readyState === "loading") {
      await new Promise((resolve) => document.addEventListener("DOMContentLoaded", resolve, { once: true }));
      if (!isCurrent()) return canceled();
    }
    const ready = async (surface) => {
      if (typeof surface?.ready === "function") await surface.ready();
      else await surface?.ready;
    };
    if (saved.tab && saved.tab !== readStore("mefiStudio.tab")) {
      await window.MefiBooklet?.showTab?.(saved.tab);
      if (!isCurrent()) return canceled();
    }
    if (saved.workspace) {
      await window.MefiWorkspace?.enter?.();
      if (!isCurrent()) return canceled();
      await ready(window.MefiWorkspace);
      if (!isCurrent()) return canceled();
    }
    if (saved.vibe && window.MefiVibe) {
      await window.MefiVibe.enter();
      if (!isCurrent()) return canceled();
    }
    if (saved.command) {
      const commandState = typeof saved.command === "object" ? saved.command : {};
      await window.MefiIdle?.enter?.(true, commandState);
      if (!isCurrent()) return canceled();
      await ready(window.MefiIdle);
      if (!isCurrent()) return canceled();
    }
    const sheet = saved.sheet && get(saved.sheet);
    if (sheet) {
      const sheetState = saved.sheet === "explorer" ? saved.explorer : saved.sheet === "tasks" ? saved.tasks : null;
      await go(saved.sheet, sheetState && typeof sheetState === "object" ? sheetState : {});
      if (!isCurrent()) return canceled();
      await ready(sheet);
      if (!isCurrent()) return canceled();
    }
    // The first frame lays out the restored surface; the second observes it
    // after a paint, when its scroll ranges and dynamically created fields exist.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (!isCurrent()) return canceled();
    restoreDetails(saved);
    if (!isCurrent()) return canceled();
    let finished = false;
    return {
      restored: Boolean(saved.workspace || saved.vibe || saved.command || sheet),
      finish() {
        if (finished) return;
        finished = true;
        restoreDetails(saved, { forceFocus: true });
      },
    };
  }

  // Legacy callers retain the deferred, synchronous contract. Startup uses
  // resumeReady() while its loading gate keeps the application inaccessible.
  function resume() {
    const saved = consumeResume();
    if (!saved) return false;
    if (saved.tab && saved.tab !== readStore("mefiStudio.tab")) window.MefiBooklet?.showTab?.(saved.tab);
    const commandState = saved.command && typeof saved.command === "object" ? saved.command : {};
    if (saved.workspace) window.MefiWorkspace?.enter?.();
    if (saved.vibe) window.MefiVibe?.enter?.();
    if (saved.command) setTimeout(() => window.MefiIdle?.enter?.(true, commandState), 1200);
    if (saved.sheet && get(saved.sheet)) {
      const sheetState = saved.sheet === "explorer" ? saved.explorer : saved.sheet === "tasks" ? saved.tasks : null;
      setTimeout(() => go(saved.sheet, sheetState && typeof sheetState === "object" ? sheetState : {}), saved.command ? 1500 : 300);
    }
    // Two passes: one when the page has painted, one for the sheets and the
    // Command view, which open on the timers above.
    requestAnimationFrame(() => setTimeout(() => restoreDetails(saved), 300));
    setTimeout(() => restoreDetails(saved), 1600);
    return Boolean(saved.workspace || saved.vibe || saved.command || saved.sheet);
  }

  // ---- boot --------------------------------------------------------------

  function init() {
    watchMotion();
    renderTools();
    renderDock();
    applyShell();
    wireRail();
    renderSheetLinks();
    paintCurrent();
    renderFooter();
    wireTabRail();
    paintBadges();
    refreshBadges();
    window.mefiStudio?.onTasks?.((tasks) => setBadge("tasks", openTasks(tasks)));
    window.mefiStudio?.onProjects?.((payload) => {
      if (!payload?.activeId || payload.activeId === taskProjectId) return;
      taskProjectId = payload.activeId;
      window.dispatchEvent(new CustomEvent("mefi:task-context", { detail: taskContext() || { projectId: taskProjectId, taskId: null } }));
      paintTaskContext();
      paintRecentTasks();
    });
    window.addEventListener("mefi:task-context", paintRecentTasks);
    window.mefiStudio?.onIdeas?.((ideas) => setBadge("ideas", unreadIdeas(ideas)));
    window.mefiStudio?.onMachineStatus?.((status) => setBadge("machine", machineLevel(status)));
    window.mefiStudio?.onAssistant?.((payload) => {
      window.MefiTree?.applyAssistant?.(payload);
      setBadge("assistant", window.MefiTree?.assistantSummary?.()?.tone ?? null);
      noticeQuestions(payload?.state);
    });
    window.addEventListener("mefi:eyes-activity", (event) => {
      if (!event.detail?.todos) return;
      const counts = treeCounts();
      if (Object.keys(counts).length) setBadge(counts);
    });
    // The activity push feeds these badges and the Activity tab alike, so it
    // starts with the app rather than on the tab's first visit.
    window.mefiStudio?.eyesWatch?.(true);
    window.mefiStudio?.onEyesActivity?.((data) => window.dispatchEvent(new CustomEvent("mefi:eyes-activity", { detail: data })));
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
    initRelease();
    keyHint();
  }

  // One-time tip, once per device: outside a text field, single letters move
  // around Studio, and nothing on screen says so. It waits for the first
  // launch's walkthrough (or any other transient) to close, then points at
  // the shortcut sheet.
  const KEY_HINT_STORE = "mefiStudio.keyHint.v1";
  function keyHint() {
    if (readStore(KEY_HINT_STORE) === "1" || typeof window.MefiToast !== "function") return;
    let tries = 0;
    const booting = () => {
      const gate = document.getElementById("boot-layer");
      return Boolean(gate) && !gate.hidden && getComputedStyle(gate).display !== "none";
    };
    const attempt = () => {
      if ((state.transient !== null || booting()) && tries++ < 120) { setTimeout(attempt, booting() ? 1500 : 5000); return; }
      try { localStorage.setItem(KEY_HINT_STORE, "1"); } catch { /* the tip may show again next launch */ }
      window.MefiToast("Tip: outside a text field, single keys move around Studio. H workspace, D Command view, T task board. Press ? for the full list.", "info", {
        duration: 12000,
        action: { label: "Show keys", run: () => go("help") },
      });
    };
    setTimeout(attempt, 4000);
  }

  window.MefiNav = {
    register,
    get,
    list,
    go,
    back, forward, historyState, note: rememberRoute,
    taskContext,
    selectTask,
    setRecentTasks,
    toggle,
    close,
    leaveCommand,
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
    renderRail,
    paintLocalNav,
    LOCAL_ROUTES,
    paintRail,
    railSection,
    sectionLabel,
    sectionRank,
    RAIL_SLOTS,
    applyShell,
    setShell,
    setRailPinned,
    paintCurrent,
    current,
    renderSheetLinks,
    renderHelp,
    renderFooter,
    hintLine,
    handleKey,
    noMotion,
    syncMotion,
    state,
    init,
    saveResume,
    resume,
    resumeReady,
    activity,
    applyStyles,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
