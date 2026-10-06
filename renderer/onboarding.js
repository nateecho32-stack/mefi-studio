// A local, resumable guide. Reading a lesson never changes a project or runs work.
// The first stop links an AI (the scan) and, from then on, that AI helps with
// the rest of the setup: after "Use this setup and continue" the guide maps
// the selected folder, asks the linked model to plan the remaining stops, and
// shows the plan beside each one, with a progress bar for the setup and an
// activity bar for anything that takes time. Only the scan, map and assistant
// buttons (and the chain they start) reach the host; the scan saves nothing
// until "Use this setup", the map saves ideas, never tasks, and the assistant
// only writes advice. "Walk with me" keeps a small coach in the corner while
// it navigates the real menus with the user and ticks each stop off.
(function () {
  "use strict";
  const KEY = "mefiStudio.walkthrough.v2";
  const LEGACY_KEY = "mefiStudio.walkthrough.v1";
  const VERSION = 2;
  const MODES = ["idle", "sheet", "coach"];
  const SCAN = 0, WORKSPACE = 1, MAP = 2, CONNECT = 3, CREATE = 4, MONITOR = 5, REVIEW = 6;
  const BUILD_MODE_STEPS = [WORKSPACE, CREATE];
  // v1 lesson index → v2 lesson index (the scan and the map are new stops).
  const LEGACY_STEPS = [WORKSPACE, CONNECT, CREATE, MONITOR, REVIEW];
  const SCAN_STEPS = ["locate", "version", "auth", "models", "verbose", "agents"];
  const SCAN_STEP_LABELS = { locate: "finding OpenCode", version: "reading its version", auth: "linked providers", models: "models", verbose: "free models", agents: "agents" };
  const ADVICE_STOPS = [["workspace", WORKSPACE], ["map", MAP], ["connections", CONNECT], ["create", CREATE], ["monitor", MONITOR], ["review", REVIEW]];
  // Subscription CLIs that sign in with their own account (cli-setup.cjs).
  const SUBSCRIPTIONS = ["codex", "claude", "grok", "antigravity"];
  const $ = (id) => document.getElementById(`walkthrough-${id}`);
  // The seven stops, in plain words for someone who has never built anything with an AI. The places they name are the
  // 0.5 layout's: Social and Studio, Today, the Map, Team › Providers, the Inbox, Help › Start here and Help › Setup guide.
  const lessons = [
    {
      title: "Pick the AI that builds for you", short: "Your AI", glyph: "g-ambience", panel: "scan",
      copy: "Studio needs an AI to do the work. Already pay for Claude, ChatGPT, Grok or Google's AI? Pick its tool below and sign in. No subscription? Use an API key, an AI that runs on this PC, or OpenCode's free models.",
      points: [
        "Install and sign in opens a setup window. It downloads the tool, then you sign in with your own account. Check connection sends one small test. Then Use for the whole studio puts that AI on every job.",
        "OpenCode is optional. Run the first scan asks it what it has: its version, the accounts linked to it and its models. The scan only reads. It sends no prompt and changes no settings.",
        "Free models cost nothing, but their makers may use what you send to improve them. Keep private work on a paid AI.",
        "No choice is saved until you press Use this setup or Use for the whole studio. Then the tour maps your project as soon as one is open, and asks your AI what to do next.",
        "Later on, Team › Providers holds every connection and Run auto setup, and Help › Setup guide goes through every setting, step by step.",
      ],
      action: null, note: "Run the first scan only reads. Use this setup saves the choices shown (never a key), maps your project and asks your AI what to do next.",
      done: "AI connected",
    },
    {
      title: "Open your project", short: "Your project", glyph: "g-explorer",
      copy: "Studio builds inside a project: a folder on your PC that holds your app. Open one, and this tour shows you the rest: say what you want, watch your AI build it, then check the result.",
      points: [
        "The project you are in is named at the top. Press its name to switch to another one.",
        "The + next to PROJECTS opens a folder you already have. Starting from nothing? Choose Start a new app, and Studio makes the folder for you. In Social it is the + beside the project name; in Studio it is in the project menu.",
        "Each project keeps its own tasks, plans and chat. Your files stay in their folder. Studio keeps its own history of them separately.",
        "Below, choose how building starts. Auto build is on at first: a new task starts building by itself. Turn it off for Verify first, and each new task waits for your OK.",
      ],
      action: "Walk me to my projects", route: "project",
      station: "I opened your project list and lit up the + next to PROJECTS. Press it to open a folder you already have, or pick a project from the list. I tick this off as soon as a project is open.",
      note: "This only opens your project list. It does not change your project.",
      target: "#workspace-add-project", menu: true, waitFor: "mefi:project-changed", done: "Project open",
    },
    {
      title: "Let your AI map your project", short: "First map", glyph: "g-explorer", panel: "map",
      copy: "Your AI reads your project and writes a short map of it: what the app is, where its parts are, how to check that it works, and a few small first jobs. It only reads. Nothing in your project changes.",
      points: [
        "The first jobs it suggests are saved in Ideas. Nothing is built until you turn an idea into a task.",
        "When OpenCode makes the map, you can watch its checklist on the Map while it works.",
        "Mapping counts toward your AI plan and can take a few minutes. Cancel stops it, and a cancelled map saves nothing.",
      ],
      action: null, note: "Map this project makes one read-only pass over your project. You can turn its ideas into tasks later, one at a time.",
      waitFor: "mefi:first-map", done: "Project mapped",
    },
    {
      title: "See your AI accounts", short: "AI accounts", glyph: "g-ambience",
      copy: "Team › Providers is where Studio gets its AI. Here you can see what is connected, sign in to another tool, paste an API key, or use an AI that runs on this PC.",
      points: [
        "At the top, Use one provider for everything puts one subscription in charge of chatting, planning and building.",
        "An API key is a secret code from an AI company such as z.ai, OpenRouter or OpenCode. Paste it into that company's tile under Providers and press Save. Keys are kept encrypted on this PC.",
        "LM Studio needs no key. Keep its local server running, then choose LM Studio.",
        "Studio decides which AI does each job. You can change that later, in Team.",
      ],
      action: "Walk me to Team › Providers", route: "agents", params: { place: "providers" },
      station: "This is Team › Providers. At the top, one subscription can do everything. Lower down, the highlighted Providers card takes API keys and LM Studio. Nothing is sent to an AI until you choose to test it.",
      note: "Tests and AI requests use your plan's allowance, and only when you run them.",
      target: "#settings-assistant-heading", done: "Accounts checked",
    },
    {
      title: "Tell Studio what to make", short: "First task", glyph: "g-tasks",
      copy: "Type what you want into the box on Today, in your own words. Build it turns your words into a task for your AI. Talk it over chats about it first. Not sure yet? Plans helps you think it through before anything is built.",
      points: [
        "Start small, and say how you will know it works. For example: ‘Add a button that makes a new note. When I press it, an empty note opens.’ Say what should stay the same, too.",
        "Build it (Ctrl+Enter) makes a task, and your AI starts on it. Talk it over (Enter) chats about it first.",
        "Plans collects your questions and choices. Once you approve a plan, you choose when to make its tasks.",
        "The ideas from your first map, and the task your AI suggested, are good places to start.",
        "With Verify first on, each new task waits for your OK before it is built.",
      ],
      action: "Walk me to the box", route: "task", secondary: "Plan it first", secondaryRoute: "plans",
      station: "This is the box on Today, in Studio. Type what you want and how you will check it. Build it makes a task; Talk it over chats about it first. I don't send anything from here.",
      // In Social, Home is Social's own Today with its own box (reachWorkspace).
      vibeStation: "This is the box on Today, in Social. Type what you want and how you will check it. Build it makes a task; Talk it over chats about it first. I don't send anything from here.",
      note: "These buttons only take you to the box or to Plans. They never send a task or start a plan.",
      target: "#workspace-input", vibeTarget: "#vibe-input", done: "Box found",
    },
    {
      title: "Watch your AI work", short: "Watch", glyph: "g-command",
      copy: "The Map is a live picture of your AI at work: your project, its helpers and their tasks. Live work, on its right, lists what is running now and what waits its turn.",
      points: [
        "Live work shows each running job and the step it is on. Press Ready, Waiting or Attention to see those tasks and why they are there.",
        "When something needs your answer or your OK, the top bar says how many need you. Press it to open the Inbox (Ctrl+J).",
        "The pause button at the top holds new work. Jobs that are already running still finish.",
        "Free models do one job at a time, and more slowly. A job that depends on another waits for it. If a job is stuck, read its reason before you add more work.",
      ],
      // rail: "work" puts Live work in front: the rail remembers its last tab, and a selected task would show its own panel.
      action: "Walk me to the Map", route: "command", params: { rail: "work" }, secondary: "Open the task board", secondaryRoute: "tasks",
      station: "This is the Map. Live work, on the right, lists what is running and the step it is on. Press Ready, Waiting or Attention to see those tasks and why. Click anything on the Map to see more.",
      note: "Looking around the Map changes nothing in your project.",
      target: "#idle-feed", done: "Map found",
    },
    {
      title: "Check what your AI made", short: "Check", glyph: "g-eyes",
      copy: "When your AI says it is done, take a look before you trust it. Open the finished task, see what changed, and try it yourself.",
      points: [
        "Finished work waits under Review: a column on Today in Social, a group in the session list in Studio, and a filter on the task board.",
        "Open a task to see what changed, which checks passed and what your AI said. In Studio, the Changes and Checks tabs show this.",
        "Something went wrong? Read the reason first. Fix what it names, such as a sign-in or an unclear description, then try again.",
        "Keep failed work for now: it shows what went wrong. Task history can bring back an earlier description, but it does not undo changes to your files.",
      ],
      // Studio's Today has no Review column, so Studio's walk opens the task board on Review (reachWorkspace).
      action: "Walk me to Review", route: "review",
      station: "This is the task board, on Review: finished work that waits for you to check, and tasks that need help. Open one to see what changed and run its checks.",
      vibeStation: "This is Today. The Review column holds finished work that waits for you. Press a card to open it and see what changed. Anything stuck waits under Needs you, with its reason.",
      note: "You can take this tour again any time from Help › Start here. Finishing the tour does not mark any task done.",
      target: "#task-filter-review", vibeTarget: '#today-board [data-group="review"]', done: "Review found",
    },
  ];
  const blankDone = () => lessons.map(() => false);
  const clampStep = (value) => Number.isInteger(value) ? Math.max(0, Math.min(lessons.length - 1, value)) : 0;
  function normalize(value) {
    return {
      version: VERSION,
      step: clampStep(value?.step),
      status: ["new", "reading", "dismissed", "complete"].includes(value?.status) ? value.status : "new",
      mode: MODES.includes(value?.mode) ? value.mode : "idle",
      done: blankDone().map((_, index) => Boolean(value?.done?.[index])),
    };
  }
  // A v1 guide keeps its ticks under the new numbering. A finished or dismissed
  // v1 guide comes back as an invitation (never as an automatic reopen) so the
  // new stops are offered once.
  function migrate(legacy) {
    const done = blankDone();
    (Array.isArray(legacy?.done) ? legacy.done : []).forEach((value, index) => { if (value && LEGACY_STEPS[index] !== undefined) done[LEGACY_STEPS[index]] = true; });
    const status = ["complete", "dismissed"].includes(legacy?.status) ? "reading" : legacy?.status;
    const step = ["complete", "dismissed"].includes(legacy?.status) ? SCAN : LEGACY_STEPS[Number.isInteger(legacy?.step) ? legacy.step : 0] ?? SCAN;
    return normalize({ step, status, mode: "idle", done });
  }
  function read() {
    try {
      const value = JSON.parse(localStorage.getItem(KEY));
      if (value?.version === VERSION) return normalize(value);
    } catch {}
    try {
      const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY));
      if (legacy?.version === 1) return migrate(legacy);
    } catch {}
    return normalize(null);
  }
  let state = read();
  let initialized = false;
  let claimed = false;
  let highlighted = null;
  let scanResult = null;
  let scanBusy = false;
  let scanSynced = false;
  let scanStarted = false;
  let mapResult = null;
  let mapBusy = false;
  let mapStartedAt = 0;
  const mapSteps = [];
  let assistResult = null;
  let assistBusy = false;
  let cliSetupState = null;
  let cliSetupFlight = null;
  let cliSetupBusy = false;
  // A setup window launched from here is still open: Studio regaining focus
  // is the cue to look for the newly installed tool again.
  let cliWindowOpen = false;
  // The person left Scan or First map to save a key or pick a local server:
  // a usable connection (or Back to the scan) brings them back to a fresh scan.
  let keyReturn = false;
  const checkedClis = new Set();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} }
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function later(fn) {
    try { if (typeof requestAnimationFrame === "function") { requestAnimationFrame(fn); return; } } catch {}
    try { setTimeout(fn, 0); } catch { fn(); }
  }
  // The only doors to the host. A missing bridge (browser preview, capture,
  // an older desktop build) leaves the panels explaining themselves instead of
  // throwing; reading and navigating never reach these.
  function hostApi(name) {
    try {
      const api = window.mefiStudio;
      const fn = api?.[name];
      return typeof fn === "function" ? (...args) => fn.apply(api, args) : null;
    } catch { return null; }
  }
  // The workspace's active project id is the truth about a selected project;
  // its header text is only a fallback where the workspace is absent (its
  // no-project wording has changed before). Reading either keeps the guide
  // away from every project-writing host API.
  function projectReady() {
    const workspace = window.MefiWorkspace;
    if (typeof workspace?.activeProjectId === "function") {
      try { return Boolean(workspace.activeProjectId()); } catch { return false; }
    }
    const label = document.getElementById("workspace-project-name")?.textContent?.trim() || "";
    if (!label || label === "Workspace") return false;
    return !/^(Your workspace|Opening your project|Loading|Desktop app)/.test(label);
  }
  // Social (stored as vibe, the default mode) hides Studio's workspace:
  // go("workspace") lands on Social's Today, so the box and review stops
  // point at Social's own controls there (vibeTarget, vibeStation).
  const vibeMode = () => { try { return window.MefiVibe?.mode?.() === "vibe"; } catch { return false; } };
  const targetOf = (lesson) => (vibeMode() && lesson.vibeTarget) || lesson.target;
  const stationOf = (lesson) => (vibeMode() && lesson.vibeStation) || lesson.station || lesson.copy;
  function isDone(index) {
    if (state.done[index]) return true;
    return index === WORKSPACE && projectReady();
  }
  const doneCount = () => lessons.filter((_, index) => isDone(index)).length;
  const setupSaved = () => state.done[SCAN] || Boolean(scanResult?.ok && scanResult.applied);
  // ---- progress -----------------------------------------------------------------------
  function fill(element, fraction) {
    if (!element) return;
    const style = element.style || (element.style = {});
    style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
  }
  function renderBars() {
    const done = doneCount();
    for (const [bar, fillId] of [["bar", "bar-fill"], ["invite-bar", "invite-bar-fill"]]) {
      $(bar)?.setAttribute?.("aria-valuenow", String(done));
      $(bar)?.setAttribute?.("aria-valuemax", String(lessons.length));
      fill($(fillId), done / lessons.length);
    }
  }
  function setActivity(active, { label = "", fraction = null } = {}) {
    window.MefiCompanionHub?.guide({ step: state.step, coach: state.mode === "coach", done: isDone(state.step), busy: active });
    const box = $("activity");
    if (!box) return;
    box.hidden = !active;
    fill($("activity-fill"), !active ? 0 : fraction == null ? 0.4 : fraction);
    try { box.classList?.[active && fraction == null ? "add" : "remove"]?.("busy"); } catch {}
    if ($("activity-label")) $("activity-label").textContent = label;
  }
  const clock = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
  function renderInvitation() {
    const card = $("invitation");
    if (!card) return;
    const active = state.status === "reading";
    card.hidden = state.status === "dismissed" || state.status === "complete";
    $("invite-title").textContent = active ? "Your place is saved. Pick up where you left off any time." : "Set up your first project together.";
    $("invite-open").textContent = active ? `Open the guide · ${doneCount()} of ${lessons.length} done` : "Start here";
    const walk = $("invite-walk");
    if (walk) walk.textContent = active ? `Walk with me · ${lessons[state.step].short}` : "Walk me through it";
    const trail = $("invite-steps");
    if (trail) trail.replaceChildren(...lessons.map((lesson, index) => {
      const done = isDone(index);
      const item = node("span", `walkthrough-setup-item${done ? " done" : ""}`, `${done ? "✓ " : ""}${lesson.short}`);
      if (index === state.step && state.status !== "complete") item.setAttribute("aria-current", "step");
      return item;
    }));
    renderBars();
  }
  function render() {
    window.MefiCompanionHub?.guide({ step: state.step, done: isDone(state.step), busy: scanBusy || mapBusy || assistBusy });
    const lesson = lessons[state.step];
    // The bar under this line counts finished lessons, so the line names both.
    const finished = doneCount();
    $("progress").textContent = `Step ${state.step + 1} of ${lessons.length}${finished ? ` · ${finished} done` : ""}`;
    $("title").textContent = lesson.title;
    $("copy").textContent = lesson.copy;
    $("points").replaceChildren(...lesson.points.map((text) => node("li", "", text)));
    if ($("build-mode")) $("build-mode").hidden = !BUILD_MODE_STEPS.includes(state.step);
    renderBuildMode();
    $("note").textContent = lesson.note;
    $("action").hidden = !lesson.action;
    $("action").textContent = lesson.action || "";
    $("secondary").hidden = !lesson.secondary;
    $("secondary").textContent = lesson.secondary || "";
    $("back").disabled = state.step === 0;
    $("next").textContent = state.step === lessons.length - 1 ? "Finish guide" : "Next step";
    const steps = lessons.map((item, index) => {
      const button = node("button", `walkthrough-step${isDone(index) ? " done" : ""}`, `${isDone(index) ? "✓ " : ""}${index + 1}. ${item.short}`);
      button.type = "button";
      button.setAttribute("aria-current", index === state.step ? "step" : "false");
      button.addEventListener("click", () => move(index));
      return button;
    });
    $("steps").replaceChildren(...steps);
    if (!scanBusy && !mapBusy && !assistBusy) setActivity(false);
    renderScan();
    renderMap();
    renderCliSetup();
    renderAssist();
    renderInvitation();
  }
  function renderBuildMode() {
    const mode = window.MefiWorkspace?.buildMode?.();
    if (!$("auto-build")) return;
    $("auto-build").checked = mode?.autoBuild !== false;
    $("auto-build").disabled = !mode?.loaded || mode.saving;
    $("build-mode-label").textContent = mode?.saving ? "Saving…" : !mode?.loaded ? "Available in the desktop app" : mode.autoBuild ? "Automatic" : "Verify first";
    // Team › Overview holds the same choice as Build approval (settings-automation, moved there by agents.js).
    $("build-mode-note").textContent = mode?.autoBuild === false
      ? "Each new task waits for your OK under Needs you, and in the Inbox. Open it, read it, then approve the build. This choice applies to every project."
      : "New tasks start building by themselves. Turn this off to approve each one first. You can change it any time in Team › Overview, under Build approval.";
  }
  // ---- the scan stop ----------------------------------------------------------------
  function setPanelStatus(id, text, error = false) {
    const target = $(id);
    if (!target) return;
    target.textContent = text;
    try { target.classList?.[error ? "add" : "remove"]?.("error"); } catch {}
  }
  const allowFree = () => $("scan-allow-free")?.checked !== false;
  function renderCliSetup() {
    const panel = $("cli-setup");
    if (!panel) return;
    panel.hidden = ![SCAN, MAP].includes(state.step);
    if (panel.hidden) return;
    if (!cliSetupState && !cliSetupFlight) void refreshCliSetup();
    const id = $("cli-choice")?.value || "codex";
    const cli = cliSetupState?.clis?.find((item) => item.id === id);
    const busy = cliSetupBusy || scanBusy || mapBusy;
    if ($("cli-choice")) $("cli-choice").disabled = busy;
    for (const action of ["install", "login", "check", "use", "refresh", "docs", "keys"]) if ($(`cli-${action}`)) $(`cli-${action}`).disabled = busy;
    if ($("cli-install")) $("cli-install").textContent = cli?.installed ? "Update and sign in" : "Install and sign in";
    if ($("cli-login")) $("cli-login").disabled = busy || !cli?.installed;
    if ($("cli-check")) { $("cli-check").disabled = busy || !cli?.installed; $("cli-check").textContent = id === "opencode" ? "Scan OpenCode" : "Check connection"; }
    if ($("cli-use")) { $("cli-use").textContent = id === "opencode" ? "Use scanned setup" : "Use for the whole studio"; $("cli-use").disabled = busy || !cli?.installed || (id === "opencode" ? !scanResult?.plan?.ok : !checkedClis.has(id)); }
    if ($("cli-detail")) $("cli-detail").textContent = !cli ? "Checking installed tools…" : id === "opencode" ? `${cli.installed ? "Installed." : "Not installed yet."} After you sign in, choose Scan OpenCode to find its models, then Use scanned setup.` : checkedClis.has(id) ? `${cli.name} answered the connection check. Ready to use.` : `${cli.installed ? "Installed" : "Not installed yet"}. ${cli.installed ? "Sign in if needed, then choose Check connection." : "Choose Install and sign in to get started."}`;
  }
  // Callers arriving while a detection runs share it instead of starting a
  // second host read.
  function refreshCliSetup() {
    if (cliSetupFlight) return cliSetupFlight;
    const fn = hostApi("cliSetupStatus");
    if (!fn) { cliSetupState = { clis: [] }; setPanelStatus("cli-status", "Guided installation is available in the desktop app."); return Promise.resolve(); }
    cliSetupFlight = (async () => {
      try {
        const result = await fn();
        if (!result?.ok) throw new Error(result?.error || "Could not check installed tools.");
        const first = !cliSetupState;
        cliSetupState = result;
        if (first && $("cli-choice")) $("cli-choice").value = result.clis?.find((cli) => cli.id === result.selected && cli.installed)?.id || result.clis?.find((cli) => cli.installed)?.id || "codex";
      } catch (error) { cliSetupState = { clis: [] }; setPanelStatus("cli-status", error.message, true); }
    })().finally(() => { cliSetupFlight = null; renderCliSetup(); });
    return cliSetupFlight;
  }
  // The host pushes a closed setup window after re-reading PATH (and the
  // window regaining focus stands in where it cannot): detect the tools again
  // so Sign in and Check connection come alive without a manual refresh.
  async function setupWindowClosed(detail = {}) {
    cliWindowOpen = false;
    // A detection that began before the window closed may predate the
    // install: let it land, then read again.
    if (cliSetupFlight) await cliSetupFlight;
    await refreshCliSetup();
    const cli = cliSetupState?.clis?.find((item) => item.id === (detail?.id || $("cli-choice")?.value));
    if (!cli) return;
    setPanelStatus("cli-status", cli.installed
      ? `${cli.name} is installed. Choose ${cli.id === "opencode" ? "Scan OpenCode" : "Check connection"} next.`
      : `Studio cannot find ${cli.name} yet. If its setup finished, choose Refresh installed tools. If not, choose Install and sign in again.`);
  }
  async function cliSetupAction(action) {
    if (cliSetupBusy || mapBusy || scanBusy) return;
    const id = $("cli-choice")?.value || "codex";
    if (id === "opencode" && action === "check") { await runScan(); return; }
    if (id === "opencode" && action === "use") { await applyScan(); return; }
    const fn = hostApi(action === "use" ? "cliSetupUse" : action === "check" ? "cliSetupCheck" : "cliSetupAction");
    if (!fn) { setPanelStatus("cli-status", "Open the desktop app to set up a coding tool."); return; }
    cliSetupBusy = true; renderCliSetup();
    setPanelStatus("cli-status", action === "check" ? "Checking your connection… this can take up to a minute." : action === "use" ? "Connecting the studio to your subscription…" : "Opening setup…");
    try {
      const result = await fn(["use", "check"].includes(action) ? id : { id, action });
      if (!result?.ok) { if (action === "check") checkedClis.delete(id); throw new Error(result?.error || "Setup did not finish. Try again."); }
      if (action === "check") checkedClis.add(id);
      if (action === "install" || action === "login") { checkedClis.delete(id); cliWindowOpen = result.launched === true; }
      setPanelStatus("cli-status", result.message || "Setup instructions opened.");
      if (action === "use") {
        state.done[SCAN] = true; save(); scanResult = null; scanSynced = true;
        if (projectReady()) { move(MAP); void runMap(); } else move(WORKSPACE);
      }
    } catch (error) { setPanelStatus("cli-status", error.message, true); }
    finally { cliSetupBusy = false; renderCliSetup(); }
  }
  function scanFacts(plan, auto = null) {
    if (!plan) return [];
    if (SUBSCRIPTIONS.includes(auto?.active?.provider)) return [auto.summary, "Choose this tool above to check its login and use it for the whole studio. OpenCode is optional."];
    const facts = [];
    const cli = plan.opencode || {};
    if (cli.installed) {
      facts.push(`OpenCode ${cli.version || "(version unknown)"} found${cli.path ? ` at ${cli.path}` : ""}${cli.supported === false ? " — older than the supported 1.x line" : ""}.`);
      const linked = plan.providers?.linked || [];
      facts.push(linked.length ? `Linked in OpenCode: ${linked.join(", ")}.` : "No provider is linked in OpenCode yet.");
      const free = plan.providers?.free || {};
      const best = Array.isArray(free.models) ? free.models.find((model) => model.usable) : null;
      facts.push(free.count ? `${free.count} free model${free.count === 1 ? "" : "s"} available${best ? `, newest ${best.name || best.id}` : ""}.` : "No free model is available right now.");
      facts.push(`Explorer: ${plan.explorer?.model || "OpenCode's default model"} — ${plan.explorer?.reason || ""}`.trim());
      facts.push(`Builder: ${plan.builder?.model || "OpenCode's default model"} — ${plan.builder?.reason || ""}`.trim());
    } else {
      // OpenCode's explorer and builder lines only describe OpenCode; without
      // it they would read as the studio's only road.
      facts.push("OpenCode is not installed on this computer. It is optional: a subscription tool above, an API key or a local model server can run your studio instead.");
    }
    facts.push(`Judge: ${plan.judge?.kind || "fixed"} — ${plan.judge?.reason || ""}`.trim());
    // Auto setup's plan rides along with the scan: the assistant route and
    // builder CLI this machine's keys, CLIs and local servers already allow.
    if (auto?.ok) facts.push(`Auto setup: ${auto.summary || "a working setup was found."}`);
    else if (auto?.error) facts.push(`Auto setup: ${auto.error}`);
    return facts;
  }
  function scanNotes(plan, auto = null) {
    if (!plan) return [];
    if (SUBSCRIPTIONS.includes(auto?.active?.provider)) return ["Every job can use the models this account has. You can pick a model for each job later, in Team › Seats and models."];
    return [
      ...(plan.warnings || []).map((text) => `Warning: ${text}`),
      ...(plan.nextSteps || []).map((text) => `Next: ${text}`),
      ...(plan.disclosures || []).map((text) => `Note: ${text}`),
      ...(auto?.ok ? (auto.notes || []).map((text) => `Setup: ${text}`) : []),
    ];
  }
  function renderScan() {
    const panel = $("scan");
    if (!panel) return;
    panel.hidden = state.step !== SCAN;
    if ($("scan-run")) $("scan-run").disabled = scanBusy;
    if ($("scan-apply")) { $("scan-apply").hidden = !(scanResult?.ok && scanResult.plan); $("scan-apply").disabled = scanBusy || cliSetupBusy || !(scanResult?.plan?.ok || scanResult?.autoSetup?.ok); }
    const plan = scanResult?.ok ? scanResult.plan : null;
    $("scan-facts")?.replaceChildren(...scanFacts(plan, scanResult?.autoSetup).map((text) => node("li", "", text)));
    $("scan-notes")?.replaceChildren(...scanNotes(plan, scanResult?.autoSetup).map((text) => node("li", "", text)));
    if (!panel.hidden && !scanSynced) syncScanStatus();
  }
  // A setup saved in an earlier session (or from Settings) counts; the guide
  // reads the host's record instead of trusting this device's storage.
  function syncScanStatus() {
    const fn = hostApi("firstRunStatus");
    scanSynced = true;
    if (!fn) return;
    Promise.resolve().then(() => fn()).then((status) => {
      if (!status?.firstRun) {
        // A fresh install's first launch ran auto setup by itself; the scan
        // adds OpenCode's free explorer and builder on top of that route.
        // A subscription tool still needs its login checked; a key or a local
        // server finishes through the scan's Use this setup.
        if (status?.autoSetup?.summary && !scanResult) setPanelStatus("scan-status", `Auto setup ran on first launch: ${status.autoSetup.summary} ${SUBSCRIPTIONS.includes(status.aiProvider) ? "Choose your tool above to check its connection and finish setup." : "Run the first scan, then choose Use this setup and continue to finish setup."}`);
        return;
      }
      if (!state.done[SCAN]) { state.done[SCAN] = true; save(); }
      if (!scanResult) setPanelStatus("scan-status", status.firstRun.explorer?.transport === "assistant" ? `Setup saved: ${status.firstRun.explorer.provider} does it all: the map, the chat and the building. You can use the First map step now.` : `Setup saved${status.firstRun.appliedAt ? ` on ${new Date(status.firstRun.appliedAt).toLocaleDateString()}` : ""}: explorer ${status.firstRun.explorer?.model || "selected provider"}, builder ${status.firstRun.builder?.model || "selected provider"}, judge ${status.firstRun.judge?.kind || "fixed"}.`);
      render();
    }).catch(() => {});
  }
  function scanProgress(step) {
    const index = SCAN_STEPS.indexOf(step?.id);
    const at = index >= 0 ? index + 1 : 0;
    setActivity(true, { label: `Scanning · ${SCAN_STEP_LABELS[step?.id] || step?.id || "…"} (${at} of ${SCAN_STEPS.length})`, fraction: at / SCAN_STEPS.length });
  }
  async function runScan({ automatic = false } = {}) {
    const fn = hostApi("firstScan");
    if (!fn) { if (!automatic) setPanelStatus("scan-status", "The first scan runs in the desktop app. In this preview nothing is read.", true); return; }
    if (scanBusy) return;
    scanBusy = true; scanStarted = true; scanResult = null; renderScan(); renderCliSetup();
    setActivity(true, { label: "Scanning · asking OpenCode what it has (about ten seconds)", fraction: 0 });
    setPanelStatus("scan-status", "Scanning… asking OpenCode for its version, its linked accounts and its models.");
    try {
      const result = await fn({ prefs: { allowFreeTraining: allowFree() } });
      scanResult = result;
      if (!result?.ok) setPanelStatus("scan-status", result?.error || "The scan did not finish.", true);
      else if (result.plan?.ok) setPanelStatus("scan-status", "Scan complete. Read what it found below, then choose Use this setup and continue: it saves these choices (never a key), maps your project and asks your AI what to do next.");
      else if (result.autoSetup?.ok && SUBSCRIPTIONS.includes(result.autoSetup.active?.provider)) setPanelStatus("scan-status", `Scan complete. ${result.autoSetup.summary} Choose your installed tool above to use that subscription for everything, including your first map.`);
      else if (result.autoSetup?.ok) setPanelStatus("scan-status", `Scan complete. ${result.autoSetup.summary} Choose Use this setup and continue: it saves this choice, maps your project and asks your AI what to do next.`);
      else setPanelStatus("scan-status", "Let's connect your first AI. Choose a tool above and Install and sign in, or choose I have an API key or a local model server. You can also continue the tour and connect it later.");
    } catch (error) {
      setPanelStatus("scan-status", error?.message || "The scan failed.", true);
    } finally {
      scanBusy = false; setActivity(false); renderScan(); renderCliSetup();
      if ($("cli-choice")?.value === "opencode") setPanelStatus("cli-status", $("scan-status")?.textContent || "Scan finished.", !scanResult?.ok);
    }
  }
  async function applyScan() {
    const fn = hostApi("firstScanApply");
    if (!fn || !scanResult?.ok) { setPanelStatus("scan-status", "Run the scan first.", true); return; }
    scanBusy = true; renderScan(); renderCliSetup();
    try {
      const result = await fn({ prefs: { allowFreeTraining: allowFree() } });
      if (!result?.ok) { setPanelStatus("scan-status", result?.error || "The setup could not be saved.", true); return; }
      state.done[SCAN] = true; save();
      scanResult = { ...scanResult, applied: true };
      setPanelStatus("scan-status", `Setup saved. ${result.summary || ""} ${(result.notes || []).join(" ")}`.trim());
      // The linked AI takes it from here: map the selected folder now, or wait
      // at the workspace stop for a folder and map it as soon as one is chosen.
      if (projectReady()) { move(MAP); void runMap({ automatic: true }); }
      else move(WORKSPACE);
    } catch (error) {
      setPanelStatus("scan-status", error?.message || "The setup could not be saved.", true);
    } finally {
      scanBusy = false; render();
    }
  }
  // ---- the map stop -----------------------------------------------------------------
  function renderMap() {
    const panel = $("map");
    if (!panel) return;
    panel.hidden = state.step !== MAP;
    if ($("map-run")) $("map-run").disabled = mapBusy;
    if ($("map-cancel")) $("map-cancel").hidden = !mapBusy;
    // Progress lines matter while the explorer runs and when it fails (they show how far it got); a finished map replaces them with facts.
    const showSteps = mapBusy || (mapResult && !mapResult.ok);
    $("map-steps")?.replaceChildren(...(showSteps ? mapSteps.slice(-12).map((text) => node("li", "", text)) : []));
    const tail = $("map-tail");
    if (tail) { const text = !mapBusy && mapResult && !mapResult.ok && mapResult.textTail ? String(mapResult.textTail).trim() : ""; tail.hidden = !text; tail.textContent = text ? `What your AI wrote instead: ${text}` : ""; }
    const facts = [];
    if (mapResult?.ok) {
      facts.push(mapResult.summary || "Map saved.");
      if (mapResult.ideas) facts.push(`${mapResult.ideas.added} new idea${mapResult.ideas.added === 1 ? "" : "s"} saved in Ideas${mapResult.ideas.updated ? `, ${mapResult.ideas.updated} updated` : ""}.`);
      if (mapResult.map?.summary) facts.push(mapResult.map.summary);
      for (const area of (mapResult.map?.areas || []).slice(0, 6)) facts.push(`${area.name}${area.path ? ` (${area.path})` : ""}: ${area.what || ""}`.trim());
    }
    $("map-facts")?.replaceChildren(...facts.map((text) => node("li", "", text)));
  }
  function mapAdvice(result) {
    const reason = result?.reason;
    if (reason === "free-tier-refused") return `${result.error} Connect a paid AI in Team › Providers, then map again.`;
    if (reason === "no-scan" || reason === "no-explorer" || reason === "no-opencode") return "Connect an AI right here first: pick your tool above and choose Install and sign in, or choose I have an API key or a local model server. You can keep going with the tour while you set it up.";
    if (reason === "timeout") return `${result.error}`;
    if (reason === "unparsable") return `${result.error} Map again: a second try usually works.`;
    if (reason === "busy") return result.error;
    return result?.error || "The map did not finish.";
  }
  async function runMap({ automatic = false } = {}) {
    if (!projectReady()) { setPanelStatus("map-status", "Open a project first (step 2, Your project), then map it.", true); return; }
    const fn = hostApi("firstMap");
    if (!fn) { if (!automatic) setPanelStatus("map-status", "The first map runs in the desktop app. In this preview nothing is read.", true); return; }
    if (mapBusy) return;
    mapBusy = true; mapResult = null; mapSteps.length = 0; mapStartedAt = Date.now(); renderMap();
    setActivity(true, { label: automatic ? "Mapping your project · your AI is reading it" : "Mapping · your AI is reading the project" });
    setPanelStatus("map-status", `${automatic ? "Your AI is mapping the project you opened. " : ""}It reads the project and writes down what it finds. Its suggestions will appear below.`);
    try {
      const result = await fn({});
      mapResult = result;
      if (result?.ok) {
        state.done[MAP] = true; save();
        setPanelStatus("map-status", `Project mapped: ${result.summary || "map saved"}. Its ideas wait in Ideas. Go on to the next step when you are ready.`);
        try { if (typeof CustomEvent === "function") window.dispatchEvent(new CustomEvent("mefi:first-map", { detail: result })); } catch {}
      } else setPanelStatus("map-status", mapAdvice(result), true);
    } catch (error) {
      mapResult = { ok: false, error: error?.message || "The map failed." };
      setPanelStatus("map-status", mapResult.error, true);
    } finally {
      mapBusy = false; setActivity(false); render();
    }
    if (mapResult?.ok) void runAssist({ automatic: true });
  }
  function cancelMap() {
    const fn = hostApi("firstMapCancel");
    if (!fn || !mapBusy) return;
    setPanelStatus("map-status", "Cancelling the map…");
    Promise.resolve().then(() => fn()).catch(() => {});
  }
  function hostProgress(data) {
    if (!data) return;
    if (data.kind === "scan") { if (scanBusy) scanProgress(data.step); return; }
    if (data.kind !== "map") return;
    if (data.step && mapSteps[mapSteps.length - 1] !== data.step) mapSteps.push(data.step);
    if (mapSteps.length > 40) mapSteps.splice(0, mapSteps.length - 40);
    if (mapBusy) setActivity(true, { label: `Mapping · ${data.step || "reading the project"}${data.tools ? ` · ${data.tools} read${data.tools === 1 ? "" : "s"}` : ""} · ${clock(Number(data.elapsedMs) || Date.now() - mapStartedAt)}` });
    if (state.step === MAP) renderMap();
  }
  // ---- the assistant --------------------------------------------------------------------
  function adviceLines() {
    const stops = assistResult?.advice?.stops || {};
    return ADVICE_STOPS.filter(([id]) => stops[id]).map(([id, index]) => ({ id, index, label: lessons[index].short, text: stops[id] }));
  }
  function renderAssist() {
    const panel = $("assist");
    if (!panel) return;
    panel.hidden = state.step === SCAN || !setupSaved();
    if ($("assist-run")) { $("assist-run").disabled = assistBusy; $("assist-run").textContent = assistResult ? "Ask again" : "Ask my assistant what to do next"; }
    if ($("assist-task")) $("assist-task").hidden = !assistResult?.advice?.firstTask;
    $("assist-list")?.replaceChildren(...adviceLines().map((line) => {
      const item = node("li", "", `${line.label}: ${line.text}`);
      if (line.index === state.step) item.setAttribute("aria-current", "step");
      return item;
    }));
  }
  function assistSource(result) {
    if (result?.via === "assistant") return `your assistant${result.model ? ` (${result.model})` : ""}`;
    if (result?.via === "opencode-free") return result.model || "the free model";
    return "the built-in guide";
  }
  async function runAssist({ automatic = false } = {}) {
    const fn = hostApi("firstAssist");
    if (!fn) { if (!automatic) setPanelStatus("assist-status", "The setup assistant runs in the desktop app.", true); return; }
    if (assistBusy) return;
    assistBusy = true; renderAssist();
    setActivity(true, { label: "Asking your AI to plan the rest of the tour" });
    setPanelStatus("assist-status", "Asking your AI what to do next…");
    try {
      const result = await fn({ progress: { done: state.done.slice(), step: state.step } });
      assistResult = result;
      if (!result?.ok) setPanelStatus("assist-status", result?.error || "The assistant did not answer.", true);
      else setPanelStatus("assist-status", `${result.advice?.summary || "Here is a plan for the steps that are left."} (From ${assistSource(result)}.)${result.warnings?.length ? ` ${result.warnings.join(" ")}` : ""}`);
    } catch (error) {
      assistResult = null;
      setPanelStatus("assist-status", error?.message || "The assistant did not answer.", true);
    } finally {
      assistBusy = false; setActivity(false); render();
    }
  }
  // Places the suggested brief in the box and takes the user there. It never
  // submits: Build it stays a deliberate click. The box is filled after the
  // visit: the classic Home's switch to Create task swaps in that purpose's
  // draft first, while Today's box (Studio's, or Social's own) is filled as
  // it stands. The input event lets the owning surface save the draft and
  // size the box.
  function placeSuggestedTask() {
    const task = assistResult?.advice?.firstTask;
    if (!task) return;
    const input = visit("task");
    if (!input) return;
    input.value = `${task.title}\n\n${task.brief || ""}`.trim();
    try { if (typeof Event === "function") input.dispatchEvent?.(new Event("input", { bubbles: true })); } catch {}
    input.focus?.();
  }
  // ---- coach --------------------------------------------------------------------------
  function renderCoach() {
    if (!$("coach")) return;
    window.MefiCompanionHub?.guide({ step: state.step, coach: true, done: isDone(state.step) });
    const lesson = lessons[state.step];
    const done = isDone(state.step);
    $("coach-progress").textContent = `Step ${state.step + 1} of ${lessons.length} · ${lesson.short}`;
    $("coach-title").textContent = lesson.title;
    $("coach-copy").textContent = stationOf(lesson);
    const returning = keyReturn && state.step === CONNECT;
    $("coach-hint").textContent = returning
      ? "Paste your key into its tile and press Save, or start LM Studio's server and choose LM Studio. A saved key takes you back to the scan. Nothing to save? Choose Back to the scan."
      : done
        ? `${lesson.done} ✓ — press the button when you are ready for the next stop.`
        : lesson.waitFor
          ? "I will tick this off the moment it is done. Take your time."
          : "I stay out of your way here; press the button when you are ready.";
    $("coach-next").textContent = returning ? "Back to the scan" : state.step === lessons.length - 1 ? "Finish the tour" : done ? "Next stop" : "Done — next stop";
    $("coach-back").disabled = state.step === 0;
    $("coach").hidden = false;
  }
  function clearHighlight() {
    if (!highlighted) return;
    try { highlighted.classList?.remove?.("walkthrough-focus"); } catch {}
    highlighted = null;
  }
  function highlight(selector) {
    clearHighlight();
    if (!selector) return null;
    const target = document.querySelector(selector);
    if (!target) return null;
    try { target.classList?.add?.("walkthrough-focus"); } catch {}
    highlighted = target;
    try { target.scrollIntoView?.({ block: "center", inline: "nearest" }); } catch {}
    return target;
  }
  function claimLayer() {
    if (claimed) return;
    claimed = true;
    window.MefiNav?.claim?.("onboarding");
  }
  function releaseLayer() {
    if (!claimed) return;
    claimed = false;
    window.MefiNav?.release?.("onboarding");
  }
  function move(index) {
    state = { ...state, step: clampStep(index), status: "reading" };
    save(); render(); $("title").focus();
  }
  function open() {
    init();
    const overlay = $("overlay");
    if (!overlay) return;
    state = { ...state, status: "reading", mode: "sheet" };
    save(); render();
    // The account step's fine print sits behind an "i" at its heading (MefiUi.tuck, studio-ui.js); the
    // step's own words and its live line under the tool choice stay in view.
    window.MefiUi?.tuck?.($("cli-setup"));
    const coachEl = $("coach");
    if (coachEl) coachEl.hidden = true;
    clearHighlight();
    overlay.hidden = false;
    claimLayer();
  }
  function close() {
    const overlay = $("overlay");
    if (!overlay) return;
    const coachEl = $("coach");
    if (overlay.hidden && (!coachEl || coachEl.hidden)) return;
    overlay.hidden = true;
    if (coachEl) coachEl.hidden = true;
    clearHighlight();
    // Closing the guide ends a detour to Team › Providers: a later save must
    // not pull the guide back open.
    keyReturn = false;
    state = { ...state, mode: "idle" };
    save(); releaseLayer(); renderInvitation();
  }
  // Reaches the box, or the place to review finished work, returning the
  // control it landed on. Home is the mode's own Today: in Social it is
  // Social's (Studio's workspace stays hidden), with Social's box; in Studio
  // it borrows Home's box and has its own Talk it over and Build it. Review is
  // Today's Review column in Social. Studio's Today has none (Home's old Review
  // filter is hidden there), so Studio's review is the task board on Review.
  function reachWorkspace(route) {
    const vibe = vibeMode();
    if (route === "review" && !vibe) {
      window.MefiNav?.go?.("tasks", { filter: "review" });
      const chip = document.getElementById("task-filter-review") ?? null;
      chip?.focus?.();
      return chip;
    }
    window.MefiNav?.go?.("workspace");
    if (route === "task") {
      // Only the classic Home's box is switched to Create task: Today's keeps
      // its words and its purpose, as workspace.js composeTask does.
      if (!vibe && !window.MefiToday?.hostsComposer?.()) document.getElementById("workspace-mode-work")?.click();
      const input = document.getElementById(vibe ? "vibe-input" : "workspace-input") ?? null;
      input?.focus?.();
      return input;
    }
    // Social's review is Today's own Review column, on the page just opened.
    return null;
  }
  // Safe destinations: navigation and highlighting only. Nothing is submitted,
  // approved or started from a lesson.
  // Returns the real control it focused, if any, so the coach knows whether it
  // still needs to hand focus to its own primary button.
  // The walk stays in the mode you are in. Both modes share the project list
  // (Social's project button and Studio's All projects open the same one);
  // the box stop is each mode's own box on Today, and the review stop is
  // Today's Review column in Social and the task board in Studio (targetOf /
  // reachWorkspace).
  function routeTo(lesson) {
    const route = lesson.route;
    let focused = null;
    if (["project", "task", "review"].includes(route)) focused = reachWorkspace(route);
    else window.MefiNav?.go?.(route, lesson.params);
    if (lesson.menu) window.MefiSidebar?.open?.();
    highlight(targetOf(lesson));
    if (route === "project") { focused = document.getElementById("workspace-add-project") ?? null; focused?.focus?.(); }
    const at = state.step;
    later(() => {
      if (state.mode !== "coach" || state.step !== at) return;
      if (lesson.menu) window.MefiSidebar?.open?.();
      highlight(targetOf(lesson));
    });
    return focused;
  }
  function visit(route) {
    close();
    if (route === "project") {
      window.MefiNav?.go?.("workspace");
      const add = document.getElementById("workspace-add-project");
      add?.focus?.();
      return add ?? null;
    }
    if (["task", "review"].includes(route)) return reachWorkspace(route);
    window.MefiNav?.go?.(route);
    return null;
  }
  // A stop with a panel has no menu to walk to: the coach hands it back to the
  // sheet at that stop, where its button lives.
  function coach(index, options = {}) {
    init();
    const step = clampStep(index);
    if (step !== CONNECT) keyReturn = false;
    if (lessons[step].panel) {
      state = { ...state, step, status: "reading" };
      open();
      return;
    }
    if (!$("coach") || !$("overlay")) return;
    state = { ...state, step, status: "reading", mode: "coach" };
    save();
    $("overlay").hidden = true;
    releaseLayer();
    renderCoach(); renderInvitation();
    // The walk is keyboard-continuable: when the stop has a real control, focus
    // lands there (routeTo returns it); otherwise focus the coach's own Next so
    // the tour never strands focus on the hidden sheet behind it.
    const focused = options.navigate !== false ? routeTo(lessons[state.step]) : null;
    if (!focused) $("coach-next")?.focus?.();
  }
  function advance() {
    if (keyReturn && state.step === CONNECT) { returnToScan(); return; }
    state.done[state.step] = true;
    if (state.step >= lessons.length - 1) { state.status = "complete"; close(); return; }
    coach(state.step + 1);
  }
  // Keys and local model servers live in Team › Providers, not in this panel:
  // the coach walks there, and a usable saved connection (or Back to the scan)
  // returns to the Scan stop and scans again, so auto setup can offer the
  // route that key or server allows before the first map.
  function keyPath() {
    coach(CONNECT);
    keyReturn = true;
    renderCoach();
  }
  function returnToScan() {
    keyReturn = false;
    open();
    move(SCAN);
    void runScan();
  }
  function connectionSaved(event) {
    // A cleared key, or one that leaves no working assistant route, is not a
    // connection (booklet.js reports routeOk; older builds leave it unset).
    if (event?.detail?.routeOk === false) return;
    tickStop(CONNECT);
    if (keyReturn) returnToScan();
  }
  function projectChanged(event) {
    if (!event?.detail?.projectId) return;
    if (!state.done[WORKSPACE]) {
      state.done[WORKSPACE] = true;
      save();
      if (state.mode === "coach") renderCoach();
      if (state.mode === "sheet" && $("overlay") && !$("overlay").hidden) render();
      renderInvitation();
    }
    // The guide was waiting at the workspace stop with a setup saved: the
    // linked AI maps the folder as soon as one is selected.
    if (state.mode === "sheet" && state.step === WORKSPACE && setupSaved() && !state.done[MAP] && $("overlay") && !$("overlay").hidden && projectReady()) {
      move(MAP);
      void runMap({ automatic: true });
    }
  }
  // Real user actions tick the matching stop off. The events are emitted only
  // after the underlying action succeeded, and ticking is idempotent: a repeat
  // never regresses a stop or duplicates progress.
  const REVIEW_STATES = ["done", "awaiting_verification", "archived"];
  function tickStop(index) {
    if (!lessons[index] || isDone(index)) return;
    state.done[index] = true;
    save();
    if (state.mode === "coach") renderCoach();
    if (state.mode === "sheet" && $("overlay") && !$("overlay").hidden) render();
    renderInvitation();
  }
  function taskOpened(event) {
    tickStop(MONITOR);
    const detail = event?.detail || {};
    if (detail.review === true || REVIEW_STATES.includes(detail.status)) tickStop(REVIEW);
  }
  function init() {
    if (initialized || !$("overlay")) return;
    initialized = true;
    $("auto-build")?.addEventListener("change", async () => {
      try {
        const result = await window.MefiWorkspace.setAutoBuild($("auto-build").checked);
        $("build-mode-feedback").textContent = result.message;
      } catch (error) { $("build-mode-feedback").textContent = error.message; }
      renderBuildMode();
    });
    window.addEventListener("mefi:build-mode", renderBuildMode);
    document.getElementById("settings-guided-cli")?.addEventListener("click", () => { open(); move(SCAN); });
    window.addEventListener("mefi:project-changed", projectChanged);
    window.addEventListener("mefi:connection-saved", connectionSaved);
    window.addEventListener("mefi:task-created", () => tickStop(CREATE));
    window.addEventListener("mefi:plan-created", () => tickStop(CREATE));
    window.addEventListener("mefi:task-opened", taskOpened);
    window.addEventListener("mefi:nav", () => {
      if (state.mode !== "coach") return;
      const at = state.step;
      later(() => { if (state.mode === "coach" && state.step === at) highlight(targetOf(lessons[at])); });
    });
    // Back from a setup window: the host's push is the cue; Studio regaining
    // focus stands in where that push never arrives (an older host).
    try { hostApi("onCliSetupClosed")?.((detail) => { void setupWindowClosed(detail); }); } catch {}
    window.addEventListener("focus", () => {
      if (!cliWindowOpen || $("overlay")?.hidden !== false || $("cli-setup")?.hidden !== false) return;
      void setupWindowClosed({});
    });
    window.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || state.mode !== "coach") return;
      if (event.target?.closest?.("input, textarea, select, [contenteditable]")) return;
      // Escape inside a menu, picker, dialog or the sidebar (often one the
      // coach itself opened) closes that first; taking it here closed the
      // coach and left the menu open.
      if (event.target?.closest?.('[role="menu"], [role="listbox"], [role="dialog"], [aria-modal="true"], dialog, .studio-choice-popup, .ws-sidebar') && !$("coach")?.contains(event.target)) return;
      event.preventDefault?.(); event.stopPropagation?.();
      close();
    }, true);
    $("coach-next")?.addEventListener("click", () => advance());
    $("coach-back")?.addEventListener("click", () => coach(state.step - 1));
    $("coach-guide")?.addEventListener("click", () => open());
    $("coach-end")?.addEventListener("click", () => close());
    $("invite-walk")?.addEventListener("click", () => coach(state.status === "new" ? 0 : state.step));
    $("scan-run")?.addEventListener("click", () => { void runScan(); });
    $("scan-apply")?.addEventListener("click", () => { void applyScan(); });
    $("cli-choice")?.addEventListener("change", () => { setPanelStatus("cli-status", ""); renderCliSetup(); });
    $("cli-refresh")?.addEventListener("click", () => { void refreshCliSetup(); });
    $("cli-keys")?.addEventListener("click", () => keyPath());
    for (const action of ["install", "login", "check", "use", "docs"]) $("cli-" + action)?.addEventListener("click", () => {
      void cliSetupAction(action);
    });
    $("map-run")?.addEventListener("click", () => { void runMap(); });
    $("map-cancel")?.addEventListener("click", () => cancelMap());
    $("assist-run")?.addEventListener("click", () => { void runAssist(); });
    $("assist-task")?.addEventListener("click", () => placeSuggestedTask());
    try { hostApi("onFirstMapProgress")?.(hostProgress); } catch {}
    $("back").addEventListener("click", () => move(state.step - 1));
    $("next").addEventListener("click", () => {
      if (state.step < lessons.length - 1) return move(state.step + 1);
      state.status = "complete"; save(); close();
    });
    $("action").addEventListener("click", () => { if (lessons[state.step].action) coach(state.step); });
    $("secondary").addEventListener("click", () => visit(lessons[state.step].secondaryRoute));
    $("dismiss").addEventListener("click", () => {
      state.status = "dismissed"; save();
      close();
      renderInvitation();
      // The header button is hidden under the rail and in Vibe: focus a Start
      // here that can actually be seen.
      const starts = Array.from(document.querySelectorAll?.('[data-nav="onboarding"]') ?? []);
      (starts.find((item) => !item.hidden && !item.closest?.("[hidden], [inert]") && (item.getClientRects?.().length ?? 1) > 0) ?? starts[0])?.focus?.();
    });
    $("overlay").addEventListener("click", (event) => { if (event.target === $("overlay")) close(); });
    $("overlay").addEventListener("keydown", (event) => {
      if (event.key !== "Tab") return;
      const controls = Array.from($("sheet").querySelectorAll('button:not([disabled]), input:not([disabled]), a[href], [tabindex="0"]')).filter((item) => !item.hidden && !item.closest("[hidden]"));
      const first = controls[0]; const last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement))) { event.preventDefault(); first?.focus(); }
    });
    renderInvitation();
  }
  function startup({ automatic = true } = {}) {
    init();
    // Only a fresh guide opens itself. Save 'reading' before displaying it so
    // closing, following a lesson link or reloading never restarts the tour.
    // Capture/smoke callers can initialize the controls without consuming it.
    if (!automatic || state.status !== "new" || !$("overlay")) return false;
    // The setup helper runs first on a new profile. When it already connected
    // an AI, the scan stop is done: the tour starts at the workspace instead.
    if (window.MefiSetupHelper?.connected?.() === true && !state.done[SCAN]) {
      state.done[SCAN] = true;
      state.step = WORKSPACE;
    }
    open();
    // The first launch starts linking an AI by itself: the scan is read-only,
    // shows its progress, and still saves nothing until "Use this setup".
    if (!state.done[SCAN] && !scanStarted && hostApi("firstScan")) void runScan({ automatic: true });
    return true;
  }
  // The setup helper closed without "Continue to the guided tour": a second
  // sheet opening over the studio read as another "Welcome". The guide waits
  // as the Start here card instead, at the workspace stop when an AI is
  // already connected. True when it was still new.
  function invite() {
    init();
    if (state.status !== "new") return false;
    if (window.MefiSetupHelper?.connected?.() === true && !state.done[SCAN]) {
      state.done[SCAN] = true;
      state.step = WORKSPACE;
    }
    state = { ...state, status: "reading" };
    save();
    renderInvitation();
    return true;
  }
  // status() lets other quiet prompts (the weekly community card) stay out of
  // the way while the guide is new or still being read.
  window.MefiOnboarding = { init, startup, invite, open, close, coach, status: () => state.status, lessons: () => lessons.map((lesson) => ({ title: lesson.title, short: lesson.short, panel: lesson.panel || null })) };
})();
