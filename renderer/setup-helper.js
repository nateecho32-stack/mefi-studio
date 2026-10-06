// The setup helper: one sheet that holds every setting deciding what Studio's
// agents do, in the order a new owner needs them — connect an AI, pick the
// team, routing, how work runs, what Mefi may decide alone, tools, the
// machine, then the look. It opens by itself on a fresh profile (before the
// Start here walkthrough, which it then hands on to) and once more for a
// returning profile when an update brings a new REVISION. Search, the Help
// menu and MefiSetupHelper.open(section) reach it any time after that.
//
// It owns no settings. Every control reads and writes through the host call
// that setting already has — agents:state/agents:save for the team, the key,
// routing and CLI setup calls for connections, MefiAgentControls for the
// queue, autonomy-ui's shared control for permissions, assistant:prefs,
// machine:set, jev:*, prefs:set — so a value saved here is the value every
// other surface shows, and the host's validation and couplings still apply.
// Team fields are edited for one scope (this project, or the Studio defaults
// every project without its own team inherits) and saved on each change, the
// same save the Agents workspace's Apply makes. Settings the host no longer
// reads (the old desk-handles-asks switch) are not offered: the permission
// mode decides that.
(function () {
  "use strict";
  const SEEN_KEY = "mefiStudio.setupHelper.seen";
  // Bump when the helper gains something every existing profile should see.
  const REVISION = "setup-helper-1";
  const headless = /[?&](?:smoke|capture)=1(?:&|$)/.test(String(window.location?.search || ""));
  const api = () => window.mefiStudio || null;
  const read = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
  const write = (key, value) => { try { localStorage.setItem(key, value); } catch { /* private store */ } };
  const clone = (value) => JSON.parse(JSON.stringify(value ?? null));
  const record = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  // Read before anything this launch writes: the profile markers Vibe's
  // what's-new card uses, plus the walkthrough's own record.
  const returning = (() => {
    try {
      if (["mefiStudio.commandHome", "mefiStudio.resume", "mefiStudio.walkthrough.v2", "mefiStudio.walkthrough.v1"].some((key) => read(key) !== null)) return true;
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index) || "";
        if (key.startsWith("mefiStudio.workspace.") || key.startsWith("mefiStudio.taskContext.")) return true;
      }
    } catch { /* no store: a first run */ }
    return false;
  })();

  // ---- vocabulary -----------------------------------------------------------
  const PROVIDERS = [
    ["auto", "Automatic", "Follows the routing order below"], ["claude", "Claude Code", "Your Claude subscription (CLI login)"],
    ["codex", "Codex", "Your ChatGPT subscription (CLI login)"], ["chatgpt", "ChatGPT plan", "Your ChatGPT plan (Sign in with ChatGPT)"], ["grok", "Grok", "Your Grok subscription (CLI login)"],
    ["antigravity", "Antigravity", "Your Google subscription (CLI login)"], ["opencode", "OpenCode Go", "API key"],
    ["zen", "OpenCode Zen", "API key"], ["zai", "z.ai", "API key (GLM coding plan)"], ["openrouter", "OpenRouter", "API key"],
    ["lmstudio", "LM Studio", "A model running on this computer"], ["custom", "Custom endpoint", "Any OpenAI-compatible server"],
  ];
  const providerName = (id) => PROVIDERS.find(([key]) => key === id)?.[1] || id || "Automatic";
  // The ChatGPT plan route (scripts/chatgpt-plan.cjs) exists only where the
  // host wires its bridge; anywhere else it is neither shown nor offered.
  const chatgptBridge = () => ["chatgptPlanStatus", "chatgptPlanSignIn", "chatgptPlanSignOut"].every((name) => typeof api()?.[name] === "function");
  const offered = () => PROVIDERS.filter(([id]) => id !== "chatgpt" || chatgptBridge());
  const CHATGPT_USAGE_URL = "https://chatgpt.com/settings/usage";
  const SUBSCRIPTIONS = ["claude", "codex", "grok", "antigravity"];
  const CLIS = [["opencode", "OpenCode"], ["claude", "Claude Code"], ["codex", "Codex"], ["grok", "Grok"], ["antigravity", "Antigravity"]];
  const cliName = (id) => CLIS.find(([key]) => key === id)?.[1] || id;
  // Seats make text-only calls, which these coding CLIs cannot (agent-profiles.cjs).
  const SEAT_BLOCKED = ["grok", "codex", "antigravity"];
  const SEATS = [
    ["companion", "Companion", "Talks with you and files tasks when asked"], ["scout", "Context scout", "Picks a starting file for each task"],
    ["overseer", "Overseer", "Reviews progress across the team"], ["lead", "Lead", "Sizes and delegates work, then gathers reports"],
    ["desk", "Desk", "Answers workers' questions and settles ordinary asks"],
  ];
  const SEAT_DEFAULTS = { provider: "zen", model: "gpt-6.1-sol", effort: "medium", fast: false };
  const seatDefaults = (seat) => ({ ...SEAT_DEFAULTS, provider: seat === "overseer" ? "auto" : "zen", model: ["companion", "scout"].includes(seat) ? "gpt-6-luna" : "gpt-6.1-sol", effort: seat === "scout" ? "low" : "medium", fast: ["companion", "scout"].includes(seat) });
  const EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"];
  const TOOL_ROLES = [
    ["routine", "Assistant · routine"], ["heavy", "Assistant · planning & review"], ["companion", "Companion"], ["scout", "Context scout"],
    ["overseer", "Overseer"], ["lead", "Lead"], ["desk", "Desk"], ["builder", "Coding worker"],
  ];
  const KEYS = [
    ["opencode", "OpenCode Go", "Paid OpenCode plan. Also powers OpenCode builds."],
    ["zen", "OpenCode Zen", "Pay-as-you-go GPT models; the default for the lead, desk, companion and scout seats."],
    ["zai", "z.ai", "GLM coding plan. OpenCode builds can use it too."],
    ["openrouter", "OpenRouter", "Hundreds of models behind one key, including free ones."],
  ];
  const JEV_ROUTES = [["vercel", "Vercel AI Gateway", "gateway"], ["typesafe", "TypeSafe Jev API", "jev"], ["zen", "OpenCode Zen", "zen"], ["openrouter", "OpenRouter", "openrouter"]];
  // agent-profiles.cjs capabilities(): which models take a reasoning effort.
  function efforts(provider, model = "") {
    const id = String(model).toLowerCase().replace(/^openai\//, "");
    const extended = /^gpt-6(?:\.\d+)?-/.test(id);
    const reasoning = (provider === "zen" || provider === "openrouter" && /^openai\//i.test(model)) && (extended || /^(gpt-5(?:[.-]|$)|o[134](?:-|$))/.test(id));
    // The ChatGPT plan's catalog slugs (gpt-6.1-sol, gpt-6-luna …) take an effort.
    if (provider === "chatgpt") return { list: /^gpt-6(?:[.-]|$)/.test(id) ? EFFORTS : /^(gpt-5(?:[.-]|$)|o[134](?:-|$))/.test(id) ? ["low", "medium", "high"] : [], fast: false };
    return { list: reasoning ? extended ? EFFORTS : ["low", "medium", "high"] : [], fast: provider === "zen" && extended };
  }

  // ---- small builders -------------------------------------------------------
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = text;
    return element;
  }
  const plain = (error, fallback) => window.MefiUi?.plainError ? window.MefiUi.plainError(error, fallback) : error?.message || fallback;
  // A button that throws something away asks twice (MefiUi.arm, studio-ui.js).
  const risky = (text, run, armed, className = "ghost mini") => {
    const el = button(text, () => {}, className);
    if (window.MefiUi?.arm) return window.MefiUi.arm(el, { run, armed });
    el.addEventListener("click", run);
    return el;
  };
  function button(text, action, className = "ghost") {
    const element = node("button", className, text);
    element.type = "button";
    element.addEventListener("click", action);
    return element;
  }
  function card(title, detail, className = "setup-helper-card") {
    const box = node("section", className);
    if (title) box.append(node("h3", "", title));
    if (detail) box.append(node("p", "setup-helper-hint", detail));
    return box;
  }
  // Advanced groups start folded so the first read stays short.
  function advanced(title, detail) {
    const box = node("details", "setup-helper-card setup-helper-advanced");
    const summary = node("summary", "", title);
    box.append(summary);
    if (detail) box.append(node("p", "setup-helper-hint", detail));
    return box;
  }
  function field(label, control, hint) {
    const row = node("label", "setup-helper-field");
    row.append(node("span", "setup-helper-label", label), control);
    if (hint) row.append(node("small", "setup-helper-hint", hint));
    return row;
  }
  function select(options, value, onChange, label) {
    const element = node("select");
    element.setAttribute("aria-label", label);
    for (const [id, text] of options) { const option = node("option", "", text); option.value = id; element.append(option); }
    element.value = options.some(([id]) => id === value) ? value : options[0]?.[0] ?? "";
    element.addEventListener("change", () => onChange(element.value, element));
    return element;
  }
  function toggle(label, checked, onChange, hint, { disabled = false } = {}) {
    const row = node("label", "setup-helper-toggle");
    const input = node("input"); input.type = "checkbox"; input.checked = Boolean(checked); input.disabled = disabled; input.setAttribute("role", "switch");
    input.addEventListener("change", () => onChange(input.checked, input));
    const words = node("span", "setup-helper-toggle-words");
    words.append(node("strong", "", label));
    if (hint) words.append(node("small", "setup-helper-hint", hint));
    row.append(input, node("span", "setup-helper-track"), words);
    return row;
  }
  function choices(options, value, onChange, label) {
    const group = node("div", "setup-helper-choices");
    group.setAttribute("role", "radiogroup"); group.setAttribute("aria-label", label);
    for (const [id, title, detail] of options) {
      const choice = button(null, () => {
        for (const other of group.children) other.setAttribute("aria-checked", String(other === choice));
        onChange(id, choice);
      }, "setup-helper-choice");
      choice.setAttribute("role", "radio"); choice.setAttribute("aria-checked", String(id === value));
      choice.dataset.value = id;
      choice.append(node("strong", "", title));
      if (detail) choice.append(node("small", "", detail));
      group.append(choice);
    }
    return group;
  }
  function number(value, { min, max, step = 1, label, onChange }) {
    const input = node("input"); input.type = "number"; input.min = String(min); input.max = String(max); input.step = String(step);
    input.value = String(value ?? ""); input.setAttribute("aria-label", label);
    input.addEventListener("change", () => {
      const next = Number(input.value);
      if (!Number.isFinite(next) || next < min || next > max) { say(`${label}: choose ${min}–${max}.`, "bad"); input.value = String(value ?? ""); return; }
      onChange(next, input);
    });
    return input;
  }
  function textInput(value, { placeholder = "", label, max = 240, type = "text" } = {}) {
    const input = node("input"); input.type = type; input.value = value || ""; input.placeholder = placeholder; input.maxLength = max;
    input.autocomplete = "off"; input.spellcheck = false; input.setAttribute("aria-label", label);
    return input;
  }
  // One status line per sheet; every save reports through it.
  function say(text, tone = "") {
    if (!els.status) return;
    els.status.textContent = String(text || "");
    if (tone) els.status.dataset.tone = tone; else delete els.status.dataset.tone;
  }
  // Runs a host call with its control disabled, and says how it went.
  async function run(controls, call, done = "Saved.") {
    const list = (Array.isArray(controls) ? controls : [controls]).filter(Boolean);
    for (const control of list) control.disabled = true;
    say("Saving…");
    try {
      const result = await call();
      if (result && result.ok === false) throw new Error(result.error || "The host refused this change.");
      say(typeof done === "function" ? done(result) : done, "good");
      return result ?? { ok: true };
    } catch (error) {
      say(plain(error, "This change was not saved."), "bad");
      return null;
    } finally {
      for (const control of list) control.disabled = false;
    }
  }
  const need = (name) => {
    const fn = api()?.[name];
    if (typeof fn !== "function") throw new Error("This setting is saved by the desktop app.");
    return fn;
  };

  // ---- the host's view, read per visit --------------------------------------
  const data = { team: null, scope: null, routing: null, keys: {}, cli: null, scan: null, logins: null, chatgpt: null };
  const projectId = () => window.MefiWorkspace?.activeProjectId?.() || window.MefiTasks?.state?.projectId || null;
  const projectName = () => window.MefiWorkspace?.activeProject?.()?.name || window.MefiWorkspace?.state?.projects?.find?.((item) => item.id === projectId())?.name || "this project";
  async function loadTeam() {
    const fn = api()?.agentsState;
    if (typeof fn !== "function") { data.team = null; return null; }
    if (!data.scope) {
      // Start where the project's work actually reads from: its own team when
      // it has one, otherwise the defaults every inheriting project uses.
      const probe = await fn({ projectId: projectId(), scope: "project" });
      data.scope = probe?.ok && probe.inherited === false ? "project" : "defaults";
      if (data.scope === "project") { data.team = probe; return probe; }
    }
    const result = await fn({ projectId: projectId(), scope: data.scope });
    if (!result?.ok) throw new Error(result?.error || "The team could not be read.");
    data.team = result;
    return result;
  }
  async function loadRouting() {
    const fn = api()?.getAiRouting;
    data.routing = typeof fn === "function" ? await fn() : null;
    return data.routing;
  }
  // The brain-map gate once wrote modelSelection "auto", which the team
  // validator refuses; a save from here must not fail on a value it never set.
  function cleanConfiguration(configuration) {
    const next = record(configuration) ? clone(configuration) : {};
    if (next.modelSelection !== undefined && !["fixed", "jev"].includes(next.modelSelection)) next.modelSelection = "jev";
    if (record(next.agentBrain)) delete next.agentBrain.deskResolves;
    return next;
  }
  // Saves run one at a time, each on the newest saved team, so two quick
  // changes cannot overwrite each other. A stale revision (another surface
  // saved) reloads once and reapplies the change.
  let teamQueue = Promise.resolve();
  let ownRevision = null;
  // The host announces a team save before the save's own reply arrives, so
  // pushes landing while one is in flight are this helper's own.
  let teamSaving = 0;
  function saveTeam(change, message = "Saved · new work uses this team. Running work keeps its configuration.") {
    const task = teamQueue.catch(() => {}).then(async () => {
      const fn = need("agentsSave");
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const team = data.team || await loadTeam();
        if (!team) throw new Error("Agent setup is available in the desktop app.");
        const configuration = cleanConfiguration(team.configuration);
        change(configuration);
        teamSaving += 1;
        let result;
        try { result = await fn({ action: "save", projectId: team.projectId, scope: data.scope, revision: team.revision, configuration, name: team.name || "My team" }); }
        finally { teamSaving -= 1; }
        if (result?.ok) { data.team = result; ownRevision = result.revision; return result; }
        if (result?.stale && attempt === 0) { await loadTeam(); continue; }
        throw new Error(result?.error || "The team was not saved.");
      }
      return null;
    });
    teamQueue = task;
    return task.then((result) => { say(message, "good"); return result; }, (error) => { say(plain(error, "The team was not saved."), "bad"); return null; });
  }
  const config = () => data.team?.configuration || {};

  // ---- sections -------------------------------------------------------------
  const visited = new Set();
  const seenAndLeft = (id) => visited.has(id) && state.section !== id;
  const SECTIONS = [];
  const section = (id) => SECTIONS.find((item) => item.id === id) || null;

  // A shared strip above every team section: which team these edits change.
  function scopeBar(body, rerender) {
    const bar = node("div", "setup-helper-scope");
    const team = data.team;
    const words = node("p", "", data.scope === "project"
      ? `Editing ${projectName()}'s own team. Other projects keep theirs.`
      : `Editing the Studio defaults: every project without its own team uses these.`);
    const pick = select([["defaults", "Studio defaults"], ["project", `This project only`]], data.scope, async (value) => {
      data.scope = value; data.team = null;
      try { await loadTeam(); } catch (error) { say(plain(error, "The team could not be read."), "bad"); }
      rerender();
    }, "Which team these settings change");
    bar.append(words, field("Applies to", pick));
    if (team && data.scope === "project" && team.inherited === false) {
      bar.append(button("Use the Studio defaults here instead", async (event) => {
        const fn = api()?.agentsSave;
        if (!fn) return;
        const result = await run(event.currentTarget, () => fn({ action: "inherit", projectId: team.projectId, scope: "project", revision: team.revision, configuration: {}, name: team.name }), "This project now follows the Studio defaults.");
        if (result?.ok) { data.scope = "defaults"; data.team = null; await loadTeam().catch(() => {}); rerender(); }
      }, "ghost mini"));
    }
    body.append(bar);
  }

  // Model ids a provider offers: the built-in ones, the catalog the host
  // lists for keyed providers, and whatever is saved. Free text still works.
  const modelLists = new Map();
  async function modelsFor(provider) {
    if (modelLists.has(provider)) return modelLists.get(provider);
    const rows = provider === "zen" ? ["gpt-6-luna", "gpt-6.1-sol", "gpt-6-sol"] : provider === "zai" ? ["glm-5.3-flash", "glm-5.3"] : provider === "openrouter" ? ["openrouter/free"] : [];
    modelLists.set(provider, rows);
    try {
      if (["zen", "opencode", "zai", "lmstudio", "custom"].includes(provider) && api()?.agentModels) {
        const result = await api().agentModels(provider);
        if (result?.ok) modelLists.set(provider, [...new Set([...rows, ...(result.models || []).map((row) => row.id).filter(Boolean)])]);
      } else if (provider === "openrouter" && api()?.openrouterModels) {
        const result = await api().openrouterModels();
        if (Array.isArray(result?.models)) modelLists.set(provider, [...new Set([...rows, ...result.models.map((row) => row.id).filter(Boolean)])]);
      }
    } catch { /* the typed id still saves */ }
    return modelLists.get(provider);
  }
  let listSerial = 0;
  function modelInput(provider, value, onSave, { label, placeholder = "Provider default" } = {}) {
    const wrap = node("div", "setup-helper-model");
    const input = textInput(value, { placeholder, label, max: 120 });
    const list = node("datalist"); list.id = `setup-helper-models-${(listSerial += 1)}`;
    input.setAttribute("list", list.id);
    const valid = provider === "antigravity" ? /^[A-Za-z0-9 ._()/:-]{0,120}$/ : /^[A-Za-z0-9._:/-]{0,120}$/;
    input.addEventListener("change", () => {
      const next = input.value.trim();
      if (!valid.test(next)) { say("Use a model id from this provider (letters, digits and . _ : / -).", "bad"); return; }
      onSave(next);
    });
    wrap.append(input, list);
    void modelsFor(provider).then((ids) => { list.replaceChildren(...ids.map((id) => { const option = node("option"); option.value = id; return option; })); });
    return wrap;
  }

  // ---- welcome ----
  SECTIONS.push({
    id: "welcome", short: "Welcome", title: returning ? "Everything your agents do, in one place" : "Welcome to Mefi's Studio",
    intro: () => returning
      ? "This update gathers every agent setting into this one helper: connections, the team and its models, routing, how work runs, permissions, tools and the machine. Your current choices are already filled in."
      : "Studio's agents turn your ideas into checked work in your projects. This helper sets them up in a few minutes. Every change saves as you make it, and you can come back any time from Search or Help.",
    status: () => "done",
    async render(body, context) {
      const paths = card("How much do you want to set?", "Quick setup covers what a first run needs. Everything walks every setting, down to the per-agent tools.");
      paths.append(choices([
        ["quick", "Quick setup", "Connect an AI, choose permissions, done. About two minutes."],
        ["full", "Everything", "Every section, in order. Change anything later."],
      ], state.path, (value) => { state.path = value; paintSteps(); }, "Setup path"));
      body.append(paths);
      // Help from an AI helper the owner already uses: a prompt that says
      // where Studio is on this PC and what to read (renderer/studio-api.js).
      if (typeof window.MefiStudioApi?.copyPrompt === "function") {
        const helper = card("Want a hand?", "Copy a prompt for Claude Code, Codex or another AI helper. It tells them where Studio is on this PC and what to read, so they can walk you through setup. It holds no keys.");
        const copy = button("Copy setup prompt", () => void window.MefiStudioApi.copyPrompt("setup-helper-status"));
        copy.id = "setup-helper-copy-prompt";
        helper.append(copy);
        body.append(helper);
      }
      if (returning) {
        const news = card("New in this version");
        const list = node("ul", "setup-helper-list");
        for (const line of [
          "One menu for every agent setting. The old places still work and now lead here.",
          "Every theme and node style is free, including the Void collection. No Discord link needed.",
          "Settings that were saved but never read (like the old “desk handles asks” switch) are gone; the permission mode decides that.",
        ]) list.append(node("li", "", line));
        news.append(list); body.append(news);
      }
      try { await loadTeam(); await loadRouting(); } catch { /* the sections load their own */ }
      if (!context.current()) return;
      const where = card("Which team are you setting up?", "A team is who does what and on which models. Projects use the Studio defaults until you give one its own team.");
      where.append(choices([
        ["defaults", "Studio defaults", "Every project that has no team of its own."],
        ["project", "This project only", `Only ${projectName()}.`],
      ], data.scope || "defaults", async (value) => { data.scope = value; data.team = null; await loadTeam().catch((error) => say(plain(error, "The team could not be read."), "bad")); }, "Team scope"));
      body.append(where);
    },
  });

  // ---- providers ----
  // A subscription route counts only while its CLI is signed in (or Studio
  // cannot tell) or it answered a check: an installed, signed-out CLI read as
  // "Connect an AI ✓" and every call then failed.
  function loggedIn(id) {
    return Boolean(state.checked?.[id]) || data.cli?.clis?.find?.((cli) => cli.id === id)?.signedIn !== false;
  }
  function routeReady() {
    const routing = data.routing || {};
    const subscription = (id) => SUBSCRIPTIONS.includes(id) && loggedIn(id);
    // A ChatGPT plan sign-in counts only while plan usage was granted.
    const chatgpt = routing.hasChatGptPlan === true || Boolean(data.chatgpt?.signedIn && data.chatgpt?.planUsage);
    return Boolean(routing.hasZai || routing.hasOpenCode || routing.hasZen || routing.hasOpenRouter || routing.hasCustom || chatgpt
      || subscription(routing.provider) || routing.provider === "lmstudio" || subscription(routing.executorCli));
  }
  function keyRow(which, title, detail, rerender) {
    const row = node("div", "setup-helper-key");
    const saved = data.keys[which] || {};
    const badge = node("span", "setup-helper-badge", saved.via === "env" ? "From an environment variable" : saved.saved ? "Saved · encrypted" : "Not saved");
    badge.dataset.tone = saved.saved || saved.via === "env" ? "good" : "";
    const heading = node("div", "setup-helper-key-head");
    heading.append(node("strong", "", title), badge);
    const input = textInput("", { placeholder: saved.saved ? "Paste a new key to replace it" : "Paste the key", label: `${title} key`, max: 400, type: "password" });
    const save = button("Save key", async () => {
      const key = input.value.trim();
      if (!key) { say("Paste a key first.", "bad"); return; }
      const result = await run([save, input], () => need("setApiKey")(key, which), `${title} key saved. It stays encrypted on this computer.`);
      if (result) { input.value = ""; await refreshKeys([which]); await loadRouting().catch(() => {}); window.dispatchEvent(new CustomEvent("mefi:connection-saved", { detail: { which } })); rerender(); }
    }, "primary mini");
    const remove = risky("Remove", async () => {
      const result = await run(remove, () => need("setApiKey")("", which), `${title} key removed.`);
      if (result) { await refreshKeys([which]); await loadRouting().catch(() => {}); rerender(); }
    }, "Remove this key?");
    remove.hidden = !saved.saved;
    const actions = node("div", "setup-helper-row");
    actions.append(input, save, remove);
    row.append(heading, node("p", "setup-helper-hint", detail), actions);
    input.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault?.(); save.click(); } });
    return row;
  }
  // More than one Claude Code or Codex login (main.cjs "Several logins per
  // coding CLI"). Studio fills the first login that is not topped out and
  // moves to the next when one reports its usage limit; this lists them in
  // that order, adds one (a folder, then its sign-in window), checks, signs
  // in and removes. Shown for a tool that is installed or already has more.
  function loginsCard(rerender) {
    const providers = (data.logins?.ok ? data.logins.providers || [] : []).filter((provider) => provider.installed || provider.accounts?.length > 1);
    if (!providers.length) return null;
    const box = card("More than one login", "Have two Claude or ChatGPT subscriptions? Add the other login here. Studio uses the first login until it hits its usage limit, moves to the next, and goes back when the limit resets. Other providers answer only once every login is topped out.");
    const after = () => rerender();
    for (const provider of providers) {
      const group = node("div", "setup-helper-logins");
      group.append(node("h4", "", provider.name));
      const list = node("ul", "setup-helper-login-list");
      for (const account of provider.accounts || []) {
        const row = node("li", "setup-helper-login");
        row.dataset.state = account.limited ? "limited" : account.answering ? "answering" : "ready";
        const words = node("span", "setup-helper-login-words");
        words.append(node("strong", "", account.label),
          node("small", "setup-helper-hint", account.limited ? `Topped out until ${account.untilText || "its reset"}` : account.answering ? "Answering now" : "Ready, next in line"));
        const actions = node("span", "setup-helper-row");
        actions.append(
          button("Sign in", async (event) => { await run(event.currentTarget, () => need("cliAccountLogin")(account.id), (reply) => reply?.message || "Sign-in window opened."); }, "ghost mini"),
          button("Check", async (event) => { await run(event.currentTarget, () => need("cliAccountCheck")(account.id), (reply) => reply?.message || `${account.label} answered.`); after(); }, "ghost mini"),
        );
        if (!account.main) {
          // Removing a login deletes its sign-in on this PC: a second press
          // confirms where the shared two-step control is loaded.
          const remove = async (event) => { await run(event.currentTarget, () => need("cliAccountRemove")(account.id), (reply) => reply?.message || `${account.label} removed.`); after(); };
          actions.append(window.MefiUi?.arm ? window.MefiUi.arm(button("Remove", () => {}, "ghost mini"), { run: remove, armed: "Remove this login?" }) : button("Remove", remove, "ghost mini"));
        }
        row.append(words, actions);
        list.append(row);
      }
      group.append(list);
      if ((provider.accounts || []).length < (provider.max || 6)) {
        const label = textInput("", { placeholder: `Login ${(provider.accounts || []).length + 1}`, label: `Name for the new ${provider.name} login`, max: 40 });
        const add = button(`Add a ${provider.name} login`, async (event) => {
          const result = await run([event.currentTarget, label], () => need("cliAccountAdd")({ provider: provider.id, label: label.value.trim() }), (reply) => `${reply?.account?.label || "The login"} added. Sign in with the other account in the window that opens.`);
          if (result?.account?.id) await run(null, () => need("cliAccountLogin")(result.account.id), (reply) => reply?.message || "Sign-in window opened.");
          after();
        }, "ghost");
        const addRow = node("div", "setup-helper-row");
        addRow.append(label, add);
        group.append(addRow);
      }
      box.append(group);
    }
    return box;
  }
  async function refreshChatgpt() {
    if (!chatgptBridge()) { data.chatgpt = null; return; }
    try { data.chatgpt = await api().chatgptPlanStatus(); } catch { data.chatgpt = null; }
  }
  // "Use your ChatGPT plan": Sign in with ChatGPT lets the owner's ChatGPT
  // plan pay for Studio's Responses calls (scripts/chatgpt-plan.cjs). The
  // words are OpenAI's Sign in with ChatGPT UI guidelines, verbatim: the
  // settings heading and body, the "Continue with ChatGPT" button (white on
  // dark), "Using ChatGPT plan" while it is in use, "Manage usage" to ChatGPT's
  // usage settings (the primary action once "Usage limit reached"), and the
  // one-time "You're using your ChatGPT plan" / "Got it" welcome, which the
  // host reports only after the first sign-in that granted plan usage.
  function chatgptCard(rerender) {
    if (!chatgptBridge()) return null;
    const plan = data.chatgpt || {};
    const box = card("Use your ChatGPT plan", "Complete eligible AI requests in this app with usage included in your ChatGPT plan or credits balance.", "setup-helper-card setup-helper-chatgpt-card");
    // OpenAI's words stay as written and in view: none of them goes behind an "i" (MefiUi.tuck).
    box.dataset.keepVisible = "";
    const manage = (className) => button("Manage usage", () => { void api()?.openExternal?.(plan.manageUsageUrl || CHATGPT_USAGE_URL); }, className);
    if (state.chatgptWelcome) {
      const welcome = node("div", "setup-helper-chatgpt-welcome");
      welcome.setAttribute("role", "dialog");
      welcome.setAttribute("aria-label", "You're using your ChatGPT plan");
      welcome.append(node("h4", "", "You're using your ChatGPT plan"),
        node("p", "setup-helper-hint", "Eligible usage in this app uses your ChatGPT plan. Manage usage in your ChatGPT settings."),
        button("Got it", () => { state.chatgptWelcome = false; rerender(); }, "primary mini"));
      box.append(welcome);
    }
    // Shown while the browser is out, where the host can call the wait off.
    const cancel = button("Cancel sign-in", async () => { try { await api()?.chatgptPlanCancel?.(); } catch { /* the sign-in answers for itself */ } }, "ghost mini");
    cancel.hidden = !(plan.signingIn && typeof api()?.chatgptPlanCancel === "function");
    const signIn = button("Continue with ChatGPT", async (event) => {
      const control = event?.currentTarget || signIn;
      control.disabled = true;
      cancel.hidden = typeof api()?.chatgptPlanCancel !== "function";
      say("Finish signing in with ChatGPT in your browser. This page updates when you are done.");
      let result;
      try { result = await need("chatgptPlanSignIn")(); } catch (error) { result = { ok: false, error: plain(error, "Signing in with ChatGPT did not finish.") }; }
      control.disabled = false;
      cancel.hidden = true;
      if (result?.status) data.chatgpt = result.status; else await refreshChatgpt();
      if (result?.ok) {
        if (result.welcome === true) state.chatgptWelcome = true;
        say(data.chatgpt?.planUsage ? "Signed in with ChatGPT. Choose ChatGPT plan in Team & models to put it to work." : "Signed in with ChatGPT, but ChatGPT plan usage was not allowed.", data.chatgpt?.planUsage ? "good" : "");
        await loadRouting().catch(() => {});
        window.dispatchEvent(new CustomEvent("mefi:connection-saved", { detail: { which: "chatgpt" } }));
      } else if (result?.errorKind === "canceled") say("Sign-in canceled.");
      else say(result?.error || "Signing in with ChatGPT did not finish.", "bad");
      rerender();
    }, "setup-helper-chatgpt");
    const actions = node("div", "setup-helper-row");
    if (plan.signedIn) {
      const heading = node("div", "setup-helper-key-head");
      const badge = node("span", "setup-helper-badge", plan.limited ? "Usage limit reached" : plan.planUsage ? "Using ChatGPT plan" : "ChatGPT plan usage off");
      if (plan.planUsage && !plan.limited) badge.dataset.tone = "good";
      heading.append(node("strong", "", plan.email ? `Signed in as ${plan.email}` : "Signed in with ChatGPT"), badge);
      box.append(heading);
      if (plan.limited) {
        box.append(node("p", "setup-helper-hint", "Review your plan or this app's limit in ChatGPT settings."));
        actions.append(manage("primary"));
      } else if (!plan.planUsage) {
        box.append(node("p", "setup-helper-hint", "ChatGPT plan usage was not allowed when you signed in, so Studio does not use it. Continue with ChatGPT again and allow it."));
        actions.append(signIn);
      } else actions.append(manage("ghost"));
      const out = risky("Sign out", async () => {
        const result = await run(out, () => need("chatgptPlanSignOut")(), "Signed out of ChatGPT.");
        if (result) { await refreshChatgpt(); await loadRouting().catch(() => {}); rerender(); }
      }, "Sign out of ChatGPT?");
      actions.append(out);
    } else {
      if (plan.needsSignIn) box.append(node("p", "setup-helper-hint", "Your ChatGPT sign-in has ended. Continue with ChatGPT to sign in again."));
      actions.append(signIn);
    }
    actions.append(cancel);
    box.append(actions);
    return box;
  }
  async function refreshKeys(which = ["opencode", "zen", "zai", "openrouter", "custom", "github", "gateway", "jev"]) {
    const fn = api()?.getApiKey;
    if (typeof fn !== "function") return;
    await Promise.all(which.map(async (id) => { try { data.keys[id] = await fn(id); } catch { data.keys[id] = null; } }));
  }
  SECTIONS.push({
    id: "providers", short: "Connect an AI", title: "Connect an AI",
    intro: "Studio needs at least one AI to talk to. The simplest is a subscription you already have, used through its own command-line login. API keys and local models work too, and you can mix them.",
    status: () => (data.routing ? routeReady() ? "done" : "attention" : ""),
    async render(body, context) {
      const rerender = () => { if (context.current()) void show("providers", { focus: false, keepScroll: true }); };
      await Promise.all([loadRouting().catch(() => {}), refreshKeys(), (async () => { try { data.cli = await api()?.cliSetupStatus?.(); } catch { data.cli = null; } })(),
        (async () => { try { data.logins = await api()?.cliAccounts?.(); } catch { data.logins = null; } })(), refreshChatgpt()]);
      if (!context.current()) return;
      const routing = data.routing || {};

      const subscription = card("Use a subscription you already have", "Codex, Claude Code, Grok and Antigravity sign in with your own account. One choice here runs chat, planning, every agent seat and the coding workers on it; each tool's own usage limits apply.");
      const clis = data.cli?.ok ? data.cli.clis || [] : CLIS.map(([id, name]) => ({ id, name, installed: false }));
      const firstInstalled = clis.find((cli) => cli.installed && SUBSCRIPTIONS.includes(cli.id))?.id;
      let chosen = state.cli || (SUBSCRIPTIONS.includes(routing.executorCli) ? routing.executorCli : firstInstalled || "codex");
      const pick = select(clis.map((cli) => [cli.id, `${cli.name}${cli.installed ? cli.signedIn === false ? " · installed, not signed in" : " · installed" : ""}`]), chosen, (value) => { state.cli = value; rerender(); }, "Coding tool");
      const cli = clis.find((item) => item.id === chosen) || { id: chosen, installed: false };
      const actions = node("div", "setup-helper-row");
      const cliStatus = node("p", "setup-helper-hint");
      cliStatus.textContent = !data.cli?.ok ? "Guided installation runs in the desktop app on Windows." : chosen === "opencode"
        ? `${cli.installed ? "Installed." : "Not installed yet."} After signing in, scan OpenCode for its linked and free models.`
        : state.checked?.[chosen] ? `${cli.name} answered the connection check. Choose “Use for the whole studio”.`
        : cli.installed && cli.signedIn === false ? "Installed, but not signed in yet. Choose Sign in, then check the connection."
        : cli.installed ? "Installed. Sign in if you haven't, then check the connection." : "Not installed. Install and sign in opens a setup window.";
      const cliAction = (action) => async (event) => {
        const result = await run(event.currentTarget, () => need("cliSetupAction")({ id: chosen, action }), (reply) => reply?.message || "Setup opened. Finish it in the window, then check the connection.");
        if (result) setTimeout(async () => { try { data.cli = await api()?.cliSetupStatus?.(); } catch {} if (context.current()) rerender(); }, 1500);
      };
      actions.append(button(cli.installed ? "Update and sign in" : "Install and sign in", cliAction("install"), "ghost"));
      if (cli.installed) actions.append(button("Sign in", cliAction("login"), "ghost"));
      if (chosen === "opencode") {
        const allow = node("input"); allow.type = "checkbox"; allow.checked = state.allowFree !== false;
        allow.addEventListener("change", () => { state.allowFree = allow.checked; });
        const allowRow = node("label", "setup-helper-inline"); allowRow.append(allow, node("span", "", "Allow free models (their free tier may use prompts to improve the model)"));
        const scan = button("Scan OpenCode", async (event) => {
          const result = await run(event.currentTarget, () => need("firstScan")({ prefs: { allowFreeTraining: state.allowFree !== false } }), (reply) => reply?.plan?.ok ? "Scan complete. Review what it found, then use the scanned setup." : reply?.autoSetup?.summary || "Scan complete, but OpenCode is not usable yet.");
          if (result) { data.scan = result; rerender(); }
        }, "ghost");
        scan.disabled = !cli.installed;
        const apply = button("Use scanned setup", async (event) => {
          const result = await run(event.currentTarget, () => need("firstScanApply")({ prefs: { allowFreeTraining: state.allowFree !== false } }), "Scanned setup saved. OpenCode explores and builds; paid plans are kept for building.");
          if (result) { data.team = null; await loadRouting().catch(() => {}); window.dispatchEvent(new CustomEvent("mefi:connection-saved", { detail: { which: "opencode" } })); rerender(); }
        }, "primary");
        apply.disabled = !(data.scan?.ok && (data.scan.plan?.ok || data.scan.autoSetup?.ok));
        actions.append(scan, apply);
        subscription.append(field("Tool", pick), allowRow, actions, cliStatus);
        if (data.scan?.ok) {
          const facts = node("ul", "setup-helper-list");
          const plan = data.scan.plan || {};
          if (plan.opencode) facts.append(node("li", "", plan.opencode.installed ? `OpenCode ${plan.opencode.version || ""} found.` : "OpenCode is not installed."));
          for (const text of [...(plan.warnings || []).map((line) => `Warning: ${line}`), ...(plan.nextSteps || []).map((line) => `Next: ${line}`)].slice(0, 6)) facts.append(node("li", "", text));
          subscription.append(facts);
        }
      } else {
        const check = button("Check connection", async (event) => {
          const result = await run(event.currentTarget, () => need("cliSetupCheck")(chosen), (reply) => reply?.message || `${cli.name} answered.`);
          state.checked = { ...state.checked, [chosen]: Boolean(result) };
          if (result) rerender();
        }, "ghost");
        check.disabled = !cli.installed;
        const use = button("Use for the whole studio", async (event) => {
          const result = await run(event.currentTarget, () => need("cliSetupUse")(chosen), (reply) => reply?.message || `${cli.name} now runs the studio.`);
          if (result) { data.team = null; await loadRouting().catch(() => {}); window.dispatchEvent(new CustomEvent("mefi:connection-saved", { detail: { which: chosen } })); rerender(); }
        }, "primary");
        use.disabled = !cli.installed || !state.checked?.[chosen];
        use.title = "Sets chat, planning, every seat and the coding workers to this tool";
        actions.append(check, use);
        subscription.append(field("Tool", pick), actions, cliStatus);
      }
      subscription.append(button("Setup instructions", cliAction("docs"), "ghost mini"));
      body.append(subscription);
      const chatgpt = chatgptCard(rerender);
      if (chatgpt) body.append(chatgpt);
      const logins = loginsCard(rerender);
      if (logins) body.append(logins);

      const keys = card("API keys", "Keys are encrypted with this computer's keystore and never leave it except to their own provider. Saving one does not switch any agent to it; choose providers in Team & models.");
      for (const [which, title, detail] of KEYS) keys.append(keyRow(which, title, detail, rerender));
      body.append(keys);

      const local = card("Local and custom servers", "LM Studio needs no key: keep its server running. A custom server is anything that speaks the OpenAI chat API.");
      const endpointRow = (key, label, placeholder) => {
        const input = textInput(routing[key] || "", { placeholder, label });
        const save = button("Save", async () => {
          const result = await run([save, input], () => need("setAiRouting")({ [key]: input.value.trim() }), `${label} saved.`);
          if (result) await loadRouting().catch(() => {});
        }, "ghost mini");
        const row = node("div", "setup-helper-row"); row.append(input, save);
        return field(label, row);
      };
      local.append(endpointRow("lmStudioEndpoint", "LM Studio server", "http://127.0.0.1:1234/v1"));
      local.append(endpointRow("customEndpoint", "Custom endpoint", "https://your-server/v1"));
      local.append(keyRow("custom", "Custom endpoint key", "Only if your server asks for one.", rerender));
      body.append(local);

      const auto = card("Let Studio find what you have", "Looks at saved keys, installed coding tools and a local LM Studio, then picks a working route. It never touches your keys or model choices.");
      const autoButton = button("Set up automatically", async (event) => {
        const result = await run(event.currentTarget, () => need("autoSetup")(), (reply) => reply?.summary || reply?.message || "Automatic setup finished.");
        if (result) { data.team = null; await loadRouting().catch(() => {}); rerender(); }
      }, "ghost");
      // No subscription and no key: OpenCode's free models are a way in.
      const free = button("Start free with OpenCode", () => { state.cli = "opencode"; rerender(); }, "ghost");
      free.title = "Picks OpenCode above: install it, then scan for its free models";
      const autoRow = node("div", "setup-helper-row");
      autoRow.append(autoButton, free);
      auto.append(autoRow);
      if (routing.autoSetup?.summary) auto.append(node("p", "setup-helper-hint", `Last run: ${routing.autoSetup.summary}`));
      body.prepend(auto);
      // A repaint after a save keeps that save's own words (show() clears the
      // line on a fresh open), so saving a key no longer reads as nothing done.
      if (!routeReady() && !els.status?.textContent) say("No AI is connected yet. Sign in with a tool, or save a key.", "");
    },
  });

  // ---- team ----
  function roleRow(role, title, detail) {
    const configuration = config();
    const provider = configuration.aiRoleProviders?.[role] || "";
    const effective = provider || configuration.aiProvider || "auto";
    const model = configuration.aiModelsByProvider?.[effective]?.[role] ?? (["auto", "zen", "zai", "opencode"].includes(effective) ? configuration.aiModels?.[role] || "" : "");
    const box = card(title, detail, "setup-helper-card setup-helper-agent");
    box.append(field("Provider", select([["", `Same as the main assistant (${providerName(configuration.aiProvider || "auto")})`], ...offered().map(([id, name]) => [id, name])], provider, (value) => {
      void saveTeam((next) => {
        next.aiRoleProviders = { ...next.aiRoleProviders, [role]: value };
        if (!value) delete next.aiRoleProviders[role];
        next.agentEfforts = { ...next.agentEfforts, [role]: "" };
      }).then(() => rerenderSoon());
    }, `${title} provider`)));
    box.append(field("Model", modelInput(effective, model, (value) => {
      void saveTeam((next) => {
        if (effective === "auto") next.aiModels = { ...next.aiModels, [role]: value };
        next.aiModelsByProvider = { ...next.aiModelsByProvider, [effective]: { ...next.aiModelsByProvider?.[effective], [role]: value } };
        next.agentEfforts = { ...next.agentEfforts, [role]: "" };
      }).then(() => rerenderSoon());
    }, { label: `${title} model`, placeholder: effective === "auto" ? "Follow the configured route" : "Provider default" }), "Leave empty for the provider's default."));
    const support = efforts(effective, model);
    if (support.list.length) box.append(field("Reasoning effort", select([["", "Default"], ...support.list.map((value) => [value, value])], configuration.agentEfforts?.[role] || "", (value) => { void saveTeam((next) => { next.agentEfforts = { ...next.agentEfforts, [role]: value }; }); }, `${title} effort`)));
    return box;
  }
  function seatRow(seat, title, detail) {
    const configuration = config();
    const saved = data.team?.seats?.[seat] || {};
    const value = { ...seatDefaults(seat), ...saved, ...configuration.agentSeats?.[seat] };
    const set = (patch) => saveTeam((next) => { next.agentSeats = { ...next.agentSeats, [seat]: { ...value, ...next.agentSeats?.[seat], ...patch } }; }).then(() => rerenderSoon());
    const box = card(title, detail, "setup-helper-card setup-helper-agent");
    box.append(field("Provider", select(offered().filter(([id]) => !SEAT_BLOCKED.includes(id)).map(([id, name]) => [id, id === "auto" ? "Follow the planning & review route" : name]), value.provider, (provider) => {
      const modelsByProvider = { ...value.modelsByProvider, [value.provider]: value.model };
      void set({ provider, model: modelsByProvider[provider] ?? "", modelsByProvider, effort: "", fast: false });
    }, `${title} provider`)));
    if (value.provider !== "auto") box.append(field("Model", modelInput(value.provider, value.model, (model) => void set({ model, effort: "", fast: false }), { label: `${title} model` })));
    const support = efforts(value.provider, value.model || (value.provider === "zen" ? "gpt-6.1-sol" : ""));
    if (support.list.length && value.provider !== "auto") box.append(field("Reasoning effort", select([["", "Default"], ...support.list.map((effort) => [effort, effort])], value.effort || "", (effort) => void set({ effort }), `${title} effort`)));
    if (support.fast) box.append(toggle("Fast mode", value.fast, (fast) => void set({ fast }), "Faster answers from GPT-6 on Zen."));
    const applied = data.team?.choices?.[seat];
    if (applied) box.append(node("p", "setup-helper-hint", `Now: ${providerName(applied.provider)} · ${applied.model}. ${applied.reason || ""}`));
    return box;
  }
  let rerenderTimer = 0;
  function rerenderSoon() {
    clearTimeout(rerenderTimer);
    const at = state.section;
    rerenderTimer = setTimeout(() => { if (state.open && state.section === at) void show(at, { focus: false, keepScroll: true }); }, 120);
  }
  SECTIONS.push({
    id: "team", short: "Team & models", title: "Your team and its models",
    intro: "Who does what, and on which model. Each role can use its own provider; leave one on “Same as the main assistant” to keep them together. Running work keeps the team it started with.",
    status: () => (seenAndLeft("team") ? "done" : ""),
    async render(body, context) {
      await loadTeam();
      if (!context.current()) return;
      if (!data.team) { body.append(card("Desktop app only", "The team is read from and saved by the desktop app.")); return; }
      scopeBar(body, () => rerenderSoon());
      const configuration = config();
      const main = card("Main assistant", "The default provider for every text role below.");
      main.append(field("Provider", select(offered().map(([id, name, note]) => [id, `${name} — ${note}`]), configuration.aiProvider || "auto", (value) => {
        void saveTeam((next) => { next.aiProvider = value; next.agentEfforts = {}; }).then(() => rerenderSoon());
      }, "Main assistant provider")));
      body.append(main);
      body.append(roleRow("routine", "Assistant · routine", "Chat, quick checks and advisory answers."));
      body.append(roleRow("heavy", "Assistant · planning & review", "Plans, task briefs and reviews."));

      const cli = configuration.executorCli || "opencode", tier = configuration.executorTier || "auto";
      const builder = card("Coding worker", "The tool that edits your project. OpenCode runs on your OpenCode plan, a z.ai key or free models; the others use your subscription login.", "setup-helper-card setup-helper-agent");
      builder.append(field("Tool", select(CLIS, cli, (value) => { void saveTeam((next) => { next.executorCli = value; next.executorModel = ""; }).then(() => rerenderSoon()); }, "Coding tool")));
      if (cli === "codex") builder.append(field("Connection", select([["app-server", "App server · live usage, private tool keys"], ["exec", "Classic · codex exec"]], configuration.codexHarness === "exec" ? "exec" : "app-server", (value) => { void saveTeam((next) => { next.codexHarness = value; }); }, "Codex connection"), "The app server falls back to codex exec when it cannot start."));
      builder.append(field("Tier", select([["auto", "Auto · Studio picks per task"], ["free", "Free · free models only, one worker"], ["fast", "Fast · quick, cheaper models"], ["heavy", "Heavy · the strongest models"]], tier, (value) => { void saveTeam((next) => { next.executorTier = value; }).then(() => rerenderSoon()); }, "Coding tier")));
      const model = tier === "auto" ? configuration.executorModels?.[cli] ?? configuration.executorModel ?? "" : configuration.executorTierModels?.[cli]?.[tier] || "";
      const fallback = tier === "auto" ? "Tool default" : data.team.routing?.executorTierDefaults?.[cli]?.[tier] || "Tool default";
      builder.append(field(tier === "auto" ? "Model" : `Model for ${tier}`, modelInput(cli === "opencode" ? "opencode" : cli, model, (value) => {
        if (cli === "opencode" && value && !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._:/-]+$/.test(value)) { say("OpenCode models are provider/model ids, for example opencode/gpt-6-sol.", "bad"); return; }
        void saveTeam((next) => {
          if (tier === "auto") { next.executorModels = { ...next.executorModels, [cli]: value }; next.executorModel = ""; }
          else next.executorTierModels = { ...next.executorTierModels, [cli]: { ...next.executorTierModels?.[cli], [tier]: value } };
        });
      }, { label: "Coding worker model", placeholder: fallback }), cli === "opencode" ? "OpenCode uses provider/model ids." : "Leave empty for the tool's default."));
      body.append(builder);

      const subtask = configuration.agentSubtasks || {};
      const split = card("Subtask builders", "When work is split, the pieces can follow the main coding worker or use another tool.", "setup-helper-card setup-helper-agent");
      split.append(field("Tool", select([["auto", "Follow the main coding worker"], ...CLIS], subtask.cli || "auto", (value) => { void saveTeam((next) => { next.agentSubtasks = { ...next.agentSubtasks, cli: value }; }); }, "Subtask tool")));
      const subtaskModel = textInput(subtask.model || "", { placeholder: "Inherit", label: "Subtask model", max: 120 });
      subtaskModel.addEventListener("change", () => { void saveTeam((next) => { next.agentSubtasks = { ...next.agentSubtasks, model: subtaskModel.value.trim() }; }); });
      split.append(field("Model", subtaskModel));
      body.append(split);

      const seats = advanced("Agent seats: companion, scout, overseer, lead and desk", "Each seat can run on its own model. Seats make text-only calls, so Grok, Codex and Antigravity are not offered here.");
      for (const [seat, title, detail] of SEATS) seats.append(seatRow(seat, title, detail));
      body.append(seats);

      const presets = advanced("Saved teams", "Save this team to reuse it, or apply a saved one to this project.");
      const list = data.team.presets || [];
      let picked = list[0]?.id || "";
      const pick = select(list.length ? list.map((preset) => [preset.id, preset.name]) : [["", "No saved teams yet"]], picked, (value) => { picked = value; }, "Saved team");
      const name = textInput(data.team.name && data.team.name !== "Studio defaults" ? data.team.name : "", { placeholder: "Team name", label: "Team name", max: 80 });
      const presetCall = (action, id, done) => async (event) => {
        const fn = api()?.agentsPreset;
        if (!fn) return;
        if (action !== "preset-save" && !id) { say("Choose a saved team first.", "bad"); return; }
        const team = data.team;
        const result = await run(event.currentTarget, () => fn({ action, id, projectId: team.projectId, scope: data.scope, revision: team.revision, configuration: cleanConfiguration(team.configuration), name: name.value.trim() || team.name || "My team" }), done);
        if (result) { data.team = null; await loadTeam().catch(() => {}); rerenderSoon(); }
      };
      const row = node("div", "setup-helper-row");
      row.append(button("Apply to this project", (event) => presetCall("apply", picked, "Saved team applied to this project.")(event), "ghost mini"),
        risky("Delete", (event) => presetCall("preset-delete", picked, "Saved team deleted.")(event), "Delete this team?"));
      const saveRow = node("div", "setup-helper-row");
      saveRow.append(name, button("Save current team", (event) => presetCall("preset-save", null, "Team saved. Project copies are unchanged.")(event), "ghost mini"));
      presets.append(field("Saved team", pick), row, saveRow);
      body.append(presets);
    },
  });

  // ---- routing ----
  SECTIONS.push({
    id: "routing", short: "Routing", title: "Routing and fallback",
    intro: "How Studio picks a model for each call when a role is on Automatic, and what happens when a provider fails.",
    status: () => (seenAndLeft("routing") ? "done" : ""),
    async render(body, context) {
      const [jev] = await Promise.all([api()?.jevStatus?.().catch?.(() => null) ?? null, loadTeam(), loadRouting().catch(() => {})]);
      if (!context.current()) return;
      if (!data.team) { body.append(card("Desktop app only", "Routing is saved by the desktop app.")); return; }
      scopeBar(body, () => rerenderSoon());
      const configuration = config();
      const pick = card("Choosing models");
      pick.append(choices([
        ["jev", "Automatic", "A small decision model (Jev) picks the model per task from what it has learned."],
        ["fixed", "Fixed", "Always use the models set in Team & models."],
      ], configuration.modelSelection === "fixed" ? "fixed" : "jev", (value) => { void saveTeam((next) => { next.modelSelection = value; }); }, "Model selection"));
      body.append(pick);

      const order = card("Automatic provider order", "Roles on Automatic try these in order.");
      order.append(toggle("Try signed-in coding tools first", configuration.aiSubscriptionFirst !== false, (value) => { void saveTeam((next) => { next.aiSubscriptionFirst = value; }).then(() => rerenderSoon()); },
        "Claude Code, Codex, Grok and Antigravity logins go ahead of the list below."));
      const auto = Array.isArray(configuration.aiAutoProviders) && configuration.aiAutoProviders.length ? configuration.aiAutoProviders : data.routing?.autoProviders || ["zai", "opencode"];
      const listBox = node("ol", "setup-helper-order");
      if (configuration.aiSubscriptionFirst !== false) listBox.append(node("li", "setup-helper-order-fixed", "Signed-in coding tools"));
      const saveOrder = (next) => { if (!next.length) { say("Keep at least one provider in the order.", "bad"); return; } void saveTeam((draft) => { draft.aiAutoProviders = next; }).then(() => rerenderSoon()); };
      auto.forEach((id, index) => {
        const item = node("li");
        item.append(node("span", "", providerName(id)));
        const up = button("↑", () => { const next = [...auto]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; saveOrder(next); }, "ghost mini"); up.disabled = index === 0; up.setAttribute("aria-label", `Move ${providerName(id)} up`);
        const down = button("↓", () => { const next = [...auto]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; saveOrder(next); }, "ghost mini"); down.disabled = index === auto.length - 1; down.setAttribute("aria-label", `Move ${providerName(id)} down`);
        const drop = button("Remove", () => saveOrder(auto.filter((entry) => entry !== id)), "ghost mini"); drop.disabled = auto.length === 1;
        item.append(up, down, drop); listBox.append(item);
      });
      order.append(listBox);
      const addable = offered().filter(([id]) => id !== "auto" && !auto.includes(id));
      if (addable.length) order.append(field("Add a provider", select([["", "Choose…"], ...addable.map(([id, name]) => [id, name])], "", (value) => { if (value) saveOrder([...auto, value]); }, "Add provider to the order")));
      order.append(toggle("Fall back when a provider fails", configuration.aiAutoFallback === true || configuration.aiFallbackOpenCode === true, (value) => { void saveTeam((next) => { next.aiAutoFallback = value; delete next.aiFallbackOpenCode; }); },
        "A failed or rate-limited call moves on to the next provider in the order instead of waiting."));
      body.append(order);

      const decision = card("Jev, the decision model", "Jev sorts new work by shape and helps Automatic pick models. It runs on a small, cheap model through one of these routes.");
      if (!jev || jev.ok === false) decision.append(node("p", "setup-helper-hint", "Jev's status is read by the desktop app."));
      else {
        decision.append(toggle("Classify new work", jev.enabled !== false, async (value, input) => { const result = await run(input, () => need("jevSetEnabled")(value), value ? "Jev classifies new work." : "Jev classification is off."); if (!result) input.checked = !value; }, "Off keeps every task on the standard route."));
        decision.append(field("Route", select(JEV_ROUTES.map(([id, name]) => [id, `${name}${jev.routes?.[id] ? " · key saved" : ""}`]), jev.route, async (value) => { await run(null, () => need("jevSetRoute")(value), "Jev route saved."); rerenderSoon(); }, "Jev route")));
        const routeKey = JEV_ROUTES.find(([id]) => id === jev.route)?.[2];
        if (routeKey === "gateway" || routeKey === "jev") {
          await refreshKeys([routeKey]);
          if (!context.current()) return;
          decision.append(keyRow(routeKey, routeKey === "gateway" ? "Vercel AI Gateway key" : "TypeSafe Jev key", "Only Jev uses this key.", () => rerenderSoon()));
        } else decision.append(node("p", "setup-helper-hint", `Uses your ${routeKey === "zen" ? "OpenCode Zen" : "OpenRouter"} key from Connect an AI.`));
      }
      body.append(decision);
    },
  });

  // ---- run ----
  const queueState = () => window.MefiAgentControls?.snapshot?.() || state.queue || {};
  // What the Run and Finish sections drew from. Refreshing the queue makes
  // MefiAgentControls announce mefi:queue-settings, so only a real change to
  // these values may repaint; repainting on every announcement looped.
  const queueKey = (queue = queueState()) => JSON.stringify(["newWork", "enabled", "parallel", "adaptiveParallel", "mode"].map((name) => queue?.[name] ?? null));
  async function refreshQueue() {
    if (window.MefiAgentControls?.refresh) return window.MefiAgentControls.refresh(true);
    const [status, full] = await Promise.all([api()?.assistantStatus?.(), api()?.assistantState?.()]);
    const auto = status?.status || status || {};
    state.queue = { known: true, enabled: auto.enabled, parallel: auto.parallel, adaptiveParallel: auto.adaptiveParallel !== false, mode: auto.mode, newWork: full?.state?.status !== "paused", proactive: full?.state?.prefs?.proactive !== false };
    return state.queue;
  }
  async function setQueue(name, value) {
    if (window.MefiAgentControls?.set) return window.MefiAgentControls.set(name, value);
    const result = name === "newWork" ? await need("assistantControl")(value ? "start-work" : "pause")
      : name === "enabled" ? await need("assistantAutopilot")({ enabled: Boolean(value), execute: Boolean(value) })
      : name === "parallel" ? await need("assistantAutopilot")(value === "machine" ? { adaptiveParallel: true } : { adaptiveParallel: false, parallel: Number(value) })
      : null;
    if (!result || result.ok === false) throw new Error(result?.error || "The host did not confirm the change.");
    await refreshQueue();
    return result;
  }
  async function assistantPrefs() {
    try { const result = await api()?.assistantState?.(); return result?.state?.prefs || {}; } catch { return {}; }
  }
  SECTIONS.push({
    id: "run", short: "How work runs", title: "How work runs",
    intro: "When agents start work, how many run at once, and how they report back. Pausing never stops a running worker; it only holds new work.",
    status: () => (seenAndLeft("run") ? "done" : ""),
    async render(body, context) {
      const [queue, prefs, auto, backlog] = await Promise.all([
        refreshQueue().catch(() => queueState()).then((queue) => { state.queueShown = queueKey(queue); return queue; }), assistantPrefs(),
        api()?.assistantStatus?.().then((reply) => reply?.status || reply).catch(() => null) ?? null,
        api()?.backlogStatus?.().catch(() => null) ?? null,
        loadTeam().catch(() => null),
      ]);
      if (!context.current()) return;
      const agents = card("Agents");
      agents.append(toggle("Allow new work", queue.newWork !== false, async (value, input) => { const done = await run(input, () => setQueue("newWork", value), value ? "New work may start." : "New work is paused. Running workers finish."); if (!done) input.checked = !value; },
        "Off holds everything new in this project; running workers finish."));
      agents.append(toggle("Run the queue on its own", queue.enabled === true, async (value, input) => { const done = await run(input, () => setQueue("enabled", value), value ? "Agents pick up queued work on their own." : "Agents wait for you to start work."); if (!done) input.checked = !value; },
        "Agents pick up ready work, plan ideas and brief you without being asked. Also called Proactive or Autopilot."));
      agents.append(field("Look for work every", number(auto?.minutes ?? 5, { min: 1, max: 240, label: "Minutes between queue passes", onChange: (value, input) => void run(input, () => need("assistantAutopilot")({ minutes: value }), `Agents look for work every ${value} minutes.`) }), "Minutes between passes when nothing wakes them sooner."));
      agents.append(field("Coding workers at once", select([["machine", "Machine managed (recommended)"], ["1", "1"], ["2", "2"], ["3", "3"]], queue.adaptiveParallel !== false ? "machine" : String(Math.min(3, queue.parallel || 1)), async (value, element) => {
        await run(element, () => setQueue("parallel", value), value === "machine" ? "Studio sizes the pool to this machine's memory and CPU." : `Up to ${value} coding worker${value === "1" ? "" : "s"} at once.`);
      }, "Coding workers at once"), "Three at most; free models always run one at a time."));
      body.append(agents);

      if (data.team) {
        const team = card("This team's way of working");
        scopeBar(team, () => rerenderSoon());
        const configuration = config();
        team.append(field("Coordination", select([["swarm", "Across the queue · each worker takes its own task"], ["cluster", "One shared task · the team works on it together"]], configuration.agentMode || queue.mode || "swarm", (value) => { void saveTeam((next) => { next.agentMode = value; }); }, "Team coordination")));
        team.append(field("Progress in the assistant", select([["compact", "Compact summaries"], ["detailed", "Detailed progress"]], configuration.agentReporting || "compact", (value) => { void saveTeam((next) => { next.agentReporting = value; }); }, "Reporting detail")));
        const brain = configuration.agentBrain || {};
        const flip = (key) => (value) => { void saveTeam((next) => { next.agentBrain = { ...next.agentBrain, [key]: value }; delete next.agentBrain.deskResolves; }); };
        team.append(toggle("Scout each task's context first", brain.contextScout !== false, flip("contextScout"), "A fast model picks a starting file; local references are gathered either way."));
        team.append(toggle("Let workers ask the desk", brain.deskTool === true, flip("deskTool"), "OpenCode and Claude Code workers get an ask_desk tool for help mid-run."));
        team.append(toggle("Draft pipelines for complex work", brain.headDrafts === true, flip("headDrafts"), "The lead drafts steps when no saved workflow fits."));
        team.append(toggle("Allow nested delegation", brain.nestedDelegation === true, flip("nestedDelegation"), "A delegated piece may split again, within the depth limit."));
        team.append(node("p", "setup-helper-hint", "Whether the desk settles ordinary asks for you follows your permission mode (Auto or Elevated only)."));
        body.append(team);
      }

      const drain = card("Working through the backlog", "Starts existing work and admits saved ideas a few at a time. Idea generation waits while it runs.");
      const draining = backlog?.draining === true || prefs.backlogMode === true;
      drain.append(node("p", "setup-helper-hint", draining ? "On: the backlog is being worked through." : "Off."));
      drain.append(button(draining ? "Stop working through the backlog" : "Work through the backlog", async (event) => {
        const result = await run(event.currentTarget, () => need("backlogControl")({ action: draining ? "stop" : "run", projectId: projectId() || undefined }), draining ? "Backlog mode is off. New ideas may be generated again." : "Working through the backlog.");
        if (result) rerenderSoon();
      }, "ghost"));
      body.append(drain);

      const maps = card("Workflows", "Brain maps lay out the pipeline itself: intake, planning, checks, dispatch and verification, with each part's own settings. Making one live also sets approval, Jev, model choice and workers at once to match it.");
      maps.append(button("Open workflows", () => { close(); window.MefiNav?.go?.("brains"); }, "ghost"));
      body.append(maps);

      const roster = advanced("Assistant roster", "How many of the assistant's own roles (briefer, overseer, ideas, reviewers) may run at once. This is separate from coding workers.");
      const pref = (key, message) => (value, input) => void run(input, () => need("assistantPrefs")({ [key]: value }), message);
      roster.append(field("Roles at once", number(prefs.parallel ?? 8, { min: 1, max: 12, label: "Assistant roles at once", onChange: pref("parallel", "Assistant roster width saved.") })));
      roster.append(field("AI calls at once", number(prefs.aiParallel ?? 4, { min: 1, max: 6, label: "Assistant AI calls at once", onChange: pref("aiParallel", "AI call limit saved.") })));
      body.append(roster);

      const keeper = advanced("Housekeeping", "The keeper tidies the board without a model. These switches and timers decide how much it does.");
      keeper.append(toggle("Keep memory aligned", prefs.memoryAlign !== false, pref("memoryAlign", "Saved."), "Keeps the assistant's notes in step with the board."));
      keeper.append(toggle("Loop guard", prefs.loopGuard !== false, pref("loopGuard", "Saved."), "Notices a card that keeps failing the same way."));
      keeper.append(toggle("Hold looping cards", prefs.loopGuardApply !== false, pref("loopGuardApply", "Saved."), "Parks such a card for you instead of retrying it."));
      keeper.append(toggle("Compact finished history", prefs.compactHistory !== false, pref("compactHistory", "Saved."), "Shortens long histories on finished cards."));
      keeper.append(field("Fold idle sessions after (minutes)", number(prefs.foldAfterMinutes ?? 60, { min: 1, max: 10080, label: "Fold after minutes", onChange: pref("foldAfterMinutes", "Saved.") })));
      keeper.append(field("Mark work stale after (hours)", number(prefs.staleAfterHours ?? 24, { min: 1, max: 2160, label: "Stale after hours", onChange: pref("staleAfterHours", "Saved.") })));
      keeper.append(field("Tidy finished work after (hours)", number(prefs.tidyDoneAfterHours ?? 24, { min: 1, max: 2160, label: "Tidy finished after hours", onChange: pref("tidyDoneAfterHours", "Saved.") })));
      body.append(keeper);
    },
  });

  // ---- permissions ----
  SECTIONS.push({
    id: "permissions", short: "Permissions", title: "What Mefi may decide for you",
    intro: "Choose how much the agents handle alone. Elevated requests — wider access, irreversible changes, closing your work — can stay yours under any mode. You can change this any time; Undo is kept for decisions Mefi makes.",
    status: () => (seenAndLeft("permissions") ? "done" : ""),
    async render(body) {
      const host = node("div", "setup-helper-autonomy"); host.id = "setup-helper-autonomy";
      body.append(host);
      if (window.MefiAutonomy?.mount) window.MefiAutonomy.mount(host, { full: true });
      else host.append(node("p", "setup-helper-hint", "Permissions are saved by the desktop app."));
      const notes = card("What the modes mean for builds");
      const list = node("ul", "setup-helper-list");
      for (const line of [
        "Always ask and Accept per task: work waits for your approval before it builds.",
        "Auto and Elevated only: your own tasks build straight away, and the desk settles ordinary questions for you.",
        "Work agents propose (including promoted ideas) still waits for you while “Work agents propose” is checked.",
      ]) list.append(node("li", "", line));
      notes.append(list); body.append(notes);
    },
  });

  // ---- tools ----
  SECTIONS.push({
    id: "tools", short: "Tools & skills", title: "Tools and skills for each agent",
    intro: "Give each agent the tools it may use, the skills it should follow and its habits. Studio enforces these on every call; skills guide answers and never grant tools.",
    status: () => (seenAndLeft("tools") ? "done" : ""),
    async render(body, context) {
      const [ui] = await Promise.all([api()?.prefsGet?.().catch?.(() => null) ?? null, loadTeam().catch(() => null)]);
      if (!context.current()) return;
      if (data.team) {
        scopeBar(body, () => rerenderSoon());
        const configuration = config();
        const role = state.toolRole || "routine";
        const tabs = card("Agent");
        tabs.append(field("Choose an agent", select(TOOL_ROLES, role, (value) => { state.toolRole = value; rerenderSoon(); }, "Agent to configure")));
        body.append(tabs);
        const cli = configuration.executorCli || "opencode";
        const supported = role !== "builder" || ["opencode", "claude"].includes(cli);
        const tools = configuration.agentTools?.[role] || {};
        const set = (key, value) => saveTeam((next) => { next.agentTools = { ...next.agentTools, [role]: { ...next.agentTools?.[role], [key]: value } }; });
        const box = card("Studio tools", supported ? "" : `Studio tools attach to OpenCode and Claude Code workers. ${cliName(cli)} uses its own tools and permissions.`);
        // An unset webRead follows webSearch (agentTools.policy).
        let readFollows = tools.webRead === undefined;
        const read = toggle("Read web pages you link", tools.webRead ?? tools.webSearch !== false, (value) => { readFollows = false; void set("webRead", value); }, "Pages you name, or that the agent finds by searching, are fetched from this computer. Local and private network addresses are refused.", { disabled: !supported });
        box.append(toggle("Search the web", tools.webSearch !== false, (value) => { if (readFollows) read.querySelector("input").checked = value; void set("webSearch", value); }, "Search queries leave this computer. Bing is built in; a BRAVE_SEARCH_API_KEY variable switches to Brave.", { disabled: !supported }));
        box.append(read);
        box.append(toggle("Read project files", tools.projectRead === true, (value) => void set("projectRead", value), role === "builder" ? "Small text files inside this project. The coding tool has its own file listing and search. Hidden files, credentials and app data are excluded." : "Read small text files, list folders and search the text files inside this project. Hidden files, credentials and app data are excluded.", { disabled: !supported }));
        body.append(box);
        const mcp = card("MCP tools", "Trusted stdio servers from ~/.mefi-studio/mcp.json. Allowing a tool lets its server run for this agent with its own credentials.");
        const allowed = tools.mcpTools || [];
        const catalog = data.team.mcpTools || [];
        if (!catalog.length) mcp.append(node("p", "setup-helper-hint", "No MCP servers are configured. Add them to ~/.mefi-studio/mcp.json, then reopen this section."));
        for (const tool of catalog) {
          mcp.append(toggle(`${tool.server} · ${tool.name}`, allowed.includes(tool.id), (value, input) => {
            const next = value ? [...allowed, tool.id] : allowed.filter((id) => id !== tool.id);
            if (next.length > 16) { input.checked = false; say("Choose up to sixteen MCP tools per agent.", "bad"); return; }
            void set("mcpTools", next).then(() => rerenderSoon());
          }, tool.description, { disabled: !supported }));
        }
        for (const missing of allowed.filter((id) => !catalog.some((tool) => tool.id === id))) mcp.append(button(`Remove unavailable tool ${missing}`, () => void set("mcpTools", allowed.filter((id) => id !== missing)).then(() => rerenderSoon()), "ghost mini"));
        body.append(mcp);
        const skills = card("Skills", "SKILL.md folders found in .agents/skills, .claude/skills, .codex/skills and .opencode/skills, in this project and your home folder. Up to eight per agent.");
        const chosen = configuration.agentSkills?.[role] || [];
        const found = data.team.skills || [];
        if (!found.length) skills.append(node("p", "setup-helper-hint", "No skills found yet."));
        for (const skill of found) {
          skills.append(toggle(skill.name, chosen.includes(skill.id), (value, input) => {
            const next = value ? [...chosen, skill.id] : chosen.filter((id) => id !== skill.id);
            if (next.length > 8) { input.checked = false; say("Choose up to eight skills per agent.", "bad"); return; }
            void saveTeam((draft) => { draft.agentSkills = { ...draft.agentSkills, [role]: next }; }).then(() => rerenderSoon());
          }, `${skill.scope} skill`));
        }
        for (const missing of chosen.filter((id) => !found.some((skill) => skill.id === id))) skills.append(button(`Remove unavailable skill ${missing}`, () => void saveTeam((draft) => { draft.agentSkills = { ...draft.agentSkills, [role]: chosen.filter((id) => id !== missing) }; }).then(() => rerenderSoon()), "ghost mini"));
        body.append(skills);
        // Habits (scripts/habits.cjs): short rules of behaviour, each with a
        // variant and off, brief (one line) or full, and its prompt cost.
        const library = Array.isArray(data.team.habits) ? data.team.habits : [];
        if (library.length) {
          const habits = card("Habits", "Short rules this agent follows on every call. Brief adds one line to its prompt; full adds the whole rule.");
          const picks = configuration.agentHabits?.[role] || {};
          const setHabit = (habit, patch) => saveTeam((draft) => {
            const current = draft.agentHabits?.[role]?.[habit.id] || { variant: habit.fallback, mode: "off" };
            draft.agentHabits = { ...draft.agentHabits, [role]: { ...draft.agentHabits?.[role], [habit.id]: { ...current, ...patch } } };
          });
          for (const habit of library) {
            const pick = picks[habit.id] || { variant: habit.fallback, mode: "off" };
            const box = node("div", "setup-helper-habit");
            box.append(node("strong", "", habit.title), node("small", "setup-helper-hint", `Fires ${habit.fires}.`));
            const row = node("div", "setup-helper-row");
            const costs = habit.costs?.[pick.variant] || {};
            row.append(select((habit.variants || []).map((variant) => [variant.id, variant.id]), pick.variant, (variant) => void setHabit(habit, { variant }).then(() => rerenderSoon()), `${habit.title}: variant`),
              select([["off", "Off"], ["brief", `Brief · about ${costs.brief || 0} tokens`], ["full", `Full · about ${costs.full || 0} tokens`]], pick.mode || "off", (mode) => void setHabit(habit, { mode }).then(() => rerenderSoon()), `${habit.title}: off, brief or full`));
            box.append(row, node("p", "setup-helper-hint", (habit.variants || []).find((variant) => variant.id === pick.variant)?.text || ""));
            habits.append(box);
          }
          body.append(habits);
        }
      } else body.append(card("Desktop app only", "Agent tools are saved by the desktop app."));

      const prefs = ui?.prefs || {};
      const gather = card("Task context", "Before a task runs, Studio can gather references for its brief.");
      const pref = (key) => (value, input) => void run(input, () => need("prefsSet")({ [key]: value }), "Saved.");
      gather.append(toggle("Gather references for tasks", prefs.useReference !== false, pref("useReference"), "Related notes, files and earlier work go into the brief."));
      gather.append(toggle("Gather automatically for new tasks", prefs.autoReference !== false, pref("autoReference")));
      gather.append(toggle("Include node history", prefs.useTree !== false, pref("useTree"), "What earlier sessions did in the same area."));
      gather.append(toggle("Include a web search when gathering by hand", prefs.useWeb === true, pref("useWeb"), "Queries leave this computer."));
      body.append(gather);
    },
  });

  // ---- system ----
  SECTIONS.push({
    id: "system", short: "Machine & app", title: "This computer and the app",
    intro: "How Studio behaves on this machine while agents work: staying awake, the tray, stopping runaway test runs, updates and GitHub access.",
    status: () => (seenAndLeft("system") ? "done" : ""),
    async render(body, context) {
      const [prefs, machine, update, companion, ui] = await Promise.all([
        assistantPrefs(), api()?.machineGet?.().catch?.(() => null) ?? null, api()?.updateStatus?.().catch?.(() => null) ?? null,
        api()?.companionState?.().catch?.(() => null) ?? null, api()?.prefsGet?.().catch?.(() => null) ?? null, refreshKeys(["github"]),
      ]);
      if (!context.current()) return;
      const pref = (key, message) => (value, input) => void run(input, () => need("assistantPrefs")({ [key]: value }), message);
      const app = card("While agents work");
      app.append(toggle("Keep this computer awake", prefs.keepAwake !== false, pref("keepAwake", "Saved."), "Only while work is running."));
      app.append(toggle("Keep running in the tray when the window closes", prefs.background !== false, pref("background", "Saved."), "Agents keep working in the background."));
      // main.cjs "Start with Windows": Windows holds the real switch.
      if (ui?.loginItem?.supported) {
        app.append(toggle("Start with Windows", ui.loginItem.on === true, (value, input) => void run(input, async () => {
          const result = await need("prefsSet")({ openAtLogin: value });
          if (result?.ok && result.loginItem?.on !== value) return { ok: false, error: "Windows did not take that change. Check Task Manager › Startup apps." };
          return result;
        }, value ? "Studio will start in the tray when you sign in." : "Studio will no longer start with Windows."), ui.loginItem.blocked ? "Task Manager › Startup apps has Studio switched off." : "Opens in the tray on your last project, so agents keep working after an update restart."));
      }
      body.append(app);

      const m = machine?.machine || {};
      const guard = card("Resource manager", "Stops test runs that are idle or too big, so a stuck game window cannot eat the machine.");
      const set = (patch, message = "Saved.") => (value, input) => void run(input, () => need("machineSet")(patch(value)), message);
      guard.append(toggle("Stop runaway test runs automatically", m.autoKill !== false, set((value) => ({ autoKill: value }))));
      guard.append(field("Idle for (seconds)", number(m.idleSeconds ?? 240, { min: 30, max: 86400, label: "Idle seconds before stopping", onChange: set((value) => ({ idleSeconds: value })) })));
      guard.append(field("Older than (minutes)", number(m.maxAgeMinutes ?? 20, { min: 1, max: 1440, label: "Maximum run age in minutes", onChange: set((value) => ({ maxAgeMinutes: value })) })));
      guard.append(field("Using more than (MB)", number(m.maxMemMB ?? 1500, { min: 128, max: 262144, label: "Maximum memory in MB", onChange: set((value) => ({ maxMemMB: value })) })));
      guard.append(toggle("Start workers even when memory is low", m.memoryWarnOverride === true, set((value) => ({ memoryWarnOverride: value })), "Normally a new worker waits until enough memory is free."));
      body.append(guard);

      const updates = card("Updates");
      const auto = update?.status?.auto !== false;
      updates.append(toggle("Install updates automatically", auto, (value, input) => void run(input, () => need("updateSet")({ auto: value }), value ? "Updates install automatically." : "You choose when to update.")));
      body.append(updates);

      const reach = card("Companion", "Which projects' questions the companion shows you.");
      reach.append(field("Project reach", select([["project", "Only the current project"], ["all", "All projects"]], companion?.scope === "all" ? "all" : "project", (value, element) => void run(element, () => need("companionPrefs")({ scope: value }), "Saved."), "Companion project reach")));
      body.append(reach);

      const github = card("GitHub", "A token lets agents read and open pull requests with the GitHub CLI. Optional.");
      github.append(keyRow("github", "GitHub token", "A fine-grained token with access to the repositories you work on.", () => rerenderSoon()));
      body.append(github);

      const outside = advanced("Set outside Studio", "These have no switch because they belong to your environment. Set them before starting Studio; they win over anything saved here.");
      const list = node("ul", "setup-helper-list");
      for (const line of [
        "~/.mefi-studio/mcp.json: the MCP servers and tools agents may be allowed in Tools & skills.",
        "MEFI_STUDIO_WORKTREE_RUNS=1: each coding run works in its own git worktree; MEFI_STUDIO_WORKTREE_NPM_CI=0 skips its install step.",
        "MEFI_JEV_ROUTE: overrides the Jev route chosen in Routing.",
        "BRAVE_SEARCH_API_KEY: agents' web search uses Brave instead of Bing.",
        "MEFI_STUDIO_MEMORY_WARN_OVERRIDE=1: the same as “Start workers even when memory is low”.",
        "MEFI_STUDIO_*_KEY variables: supply a provider key instead of saving it here; the key's badge then reads “From an environment variable”.",
      ]) list.append(node("li", "", line));
      outside.append(list);
      body.append(outside);
    },
  });

  // ---- look ----
  SECTIONS.push({
    id: "look", short: "Look", title: "Make it yours",
    intro: "Every theme and node style is free to use, including the Void collection. More colour and sound options live in Style & sound.",
    status: () => (seenAndLeft("look") ? "done" : ""),
    async render(body) {
      const music = window.MefiMusic;
      if (!music) { body.append(card("Not available", "Themes load with the studio.")); return; }
      const themes = card("Theme");
      const current = music.theme?.();
      const swatches = node("div", "setup-helper-swatches"); swatches.setAttribute("role", "radiogroup"); swatches.setAttribute("aria-label", "Theme");
      for (const theme of music.themes?.() || []) {
        const swatch = button(theme.name, () => {
          music.applyTheme?.(theme.key, true, { navigate: false });
          for (const other of swatches.children) other.setAttribute("aria-checked", String(other === swatch));
          say(`${theme.name} theme on.`, "good");
        }, "setup-helper-swatch");
        swatch.setAttribute("role", "radio"); swatch.setAttribute("aria-checked", String(theme.key === current));
        swatch.style.setProperty?.("--swatch", theme.accent);
        if (theme.accent2) swatch.style.setProperty?.("--swatch-2", theme.accent2);
        swatches.append(swatch);
      }
      themes.append(swatches); body.append(themes);
      const tree = music.graphPreferences?.() || {};
      const styles = card("Node style", "How agents and tasks look in the node tree.");
      const styleList = music.nodeStyles?.() || [];
      if (styleList.length) {
        styles.append(choices(styleList.map((style) => [style.key, style.name, style.detail]), tree.nodeStyle, (value) => { music.applyNodeStyle?.(value, true); say("Node style saved.", "good"); }, "Node style"));
        body.append(styles);
      }
      const layoutList = music.nodeLayouts?.() || [];
      if (layoutList.length) {
        const layouts = card("Layout");
        layouts.append(choices(layoutList.map((layout) => [layout.key, layout.name, layout.detail]), tree.nodeLayout, (value) => { music.applyNodeLayout?.(value, true); say("Layout saved.", "good"); }, "Node layout"));
        body.append(layouts);
      }
      let companion = null;
      try { companion = await api()?.companionState?.(); } catch { companion = null; }
      if (companion?.ok) {
        const pet = card("Companion", "The helper that floats over the studio, asks you things and shows the team's mood.");
        const save = (patch, message = "Saved.") => (value, control) => void run(control, () => need("companionPrefs")(patch(value)), message);
        pet.append(field("Look", select([["wisp", "Wisp"], ["fox", "Fox"], ["owl", "Owl"], ["cat", "Cat"], ["person", "Person"]], companion.look || "wisp", save((look) => ({ look })), "Companion look")));
        pet.append(toggle("Roam around the studio", companion.roaming !== false, save((roaming) => ({ roaming }))));
        pet.append(toggle("Show speech bubbles", companion.bubbles !== false, save((bubbles) => ({ bubbles }))));
        pet.append(toggle("Show project growth", companion.growth !== false, save((growth) => ({ growth }))));
        body.append(pet);
      }
      body.append(button("More in Style & sound", () => { close(); window.MefiNav?.go?.("studio", { category: "appearance" }); }, "ghost"));
    },
  });

  // ---- finish ----
  SECTIONS.push({
    id: "finish", short: "Finish", title: "You're set",
    intro: "Here is what your agents will do. Everything can be changed from this helper at any time.",
    status: () => "",
    async render(body, context) {
      const [queue] = await Promise.all([refreshQueue().catch(() => queueState()).then((value) => { state.queueShown = queueKey(value); return value; }), loadRouting().catch(() => {}), loadTeam().catch(() => {})]);
      if (!context.current()) return;
      const configuration = config();
      const level = window.MefiAutonomy?.label?.() || "Auto";
      const summary = card("Summary");
      const list = node("ul", "setup-helper-summary");
      const line = (label, value, tone = "") => { const item = node("li"); item.append(node("span", "", label), node("strong", "", value)); if (tone) item.dataset.tone = tone; list.append(item); };
      line("Connection", routeReady() ? "Ready" : "Not connected yet", routeReady() ? "good" : "warn");
      line("Main assistant", providerName(configuration.aiProvider || data.routing?.provider || "auto"));
      line("Coding worker", `${cliName(configuration.executorCli || data.routing?.executorCli || "opencode")} · ${configuration.executorTier || "auto"} tier`);
      line("Team", data.scope === "project" ? `${projectName()}'s own team` : "Studio defaults");
      line("Permission mode", level);
      line("New work", queue.newWork === false ? "Paused" : "Allowed");
      line("Runs the queue on its own", queue.enabled ? "Yes" : "No");
      summary.append(list); body.append(summary);
      if (!routeReady()) body.append(button("Connect an AI first", () => void show("providers"), "primary"));
      const next = card("What next");
      const row = node("div", "setup-helper-row");
      row.append(button(state.reason === "first-run" ? "Continue to the guided tour" : "Take the guided tour", () => {
        const tour = state.reason !== "first-run";
        close({ tour: true });
        if (tour) window.MefiOnboarding?.open?.();
      }, "primary"), button("Close", () => close(), "ghost"));
      next.append(row); body.append(next);
    },
  });

  // ---- the sheet ------------------------------------------------------------
  const els = {};
  const state = { open: false, built: false, section: null, reason: "manual", then: null, path: "quick", cli: null, checked: {}, allowFree: true, toolRole: "routine", queue: null };
  const QUICK = ["welcome", "providers", "permissions", "finish"];
  const route = () => (state.path === "quick" ? SECTIONS.filter((item) => QUICK.includes(item.id)) : SECTIONS);

  function build() {
    if (state.built) return;
    state.built = true;
    const overlay = node("div", "overlay setup-helper-overlay"); overlay.id = "setup-helper-overlay"; overlay.hidden = true;
    const sheet = node("section", "sheet setup-helper-sheet"); sheet.id = "setup-helper-sheet"; sheet.tabIndex = -1;
    sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-modal", "true"); sheet.setAttribute("aria-labelledby", "setup-helper-title");
    const head = node("header", "setup-helper-head");
    const titles = node("div", "setup-helper-titles");
    const title = node("h2", "", "Set up your studio"); title.id = "setup-helper-title"; title.tabIndex = -1;
    const progress = node("p", "setup-helper-progress"); progress.id = "setup-helper-progress";
    titles.append(node("p", "setup-helper-eyebrow", "SETUP HELPER"), title, progress);
    const closer = button("Save & close", () => close(), "ghost mini"); closer.id = "setup-helper-close";
    closer.title = "Every change here is already saved (Esc)";
    head.append(titles, closer);
    const bar = node("div", "setup-helper-bar"); bar.setAttribute("role", "progressbar"); bar.setAttribute("aria-label", "Setup progress"); bar.setAttribute("aria-valuemin", "0");
    const fill = node("span"); bar.append(fill);
    const body = node("div", "setup-helper-body");
    const steps = node("nav", "setup-helper-steps"); steps.setAttribute("aria-label", "Setup sections");
    const list = node("ol"); steps.append(list);
    const main = node("div", "setup-helper-main"); main.id = "setup-helper-main";
    const intro = node("p", "setup-helper-intro"); intro.id = "setup-helper-intro";
    const content = node("div", "setup-helper-content"); content.id = "setup-helper-content";
    main.append(intro, content);
    body.append(steps, main);
    const foot = node("footer", "setup-helper-foot");
    const status = node("p", "setup-helper-status"); status.id = "setup-helper-status"; status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    const back = button("Back", () => step(-1), "ghost"); back.id = "setup-helper-back";
    const next = button("Next", () => step(1), "primary"); next.id = "setup-helper-next";
    foot.append(status, back, next);
    sheet.append(head, bar, body, foot);
    overlay.append(sheet);
    document.body.append(overlay);
    Object.assign(els, { overlay, sheet, title, progress, bar, fill, list, main, intro, content, status, back, next });
    for (const item of SECTIONS) {
      const row = node("li");
      const pick = button(null, () => void show(item.id), "setup-helper-step");
      pick.dataset.section = item.id;
      pick.append(node("span", "setup-helper-step-name", item.short), node("span", "setup-helper-step-state"));
      row.append(pick); list.append(row);
      item.button = pick;
    }
    overlay.addEventListener("click", (event) => { if (event.target === overlay) close(); });
    overlay.addEventListener("keydown", trapFocus);
    // Another surface saved the team: repaint the open section unless the
    // change was this helper's own save.
    api()?.onSettingsChanged?.((payload) => {
      if (!state.open || (payload?.agents && (teamSaving > 0 || payload.revision === ownRevision))) return;
      data.team = null;
      if (["team", "routing", "run", "tools", "finish", "providers"].includes(state.section)) rerenderSoon();
    });
    // A login topped out, came back, or finished signing in: repaint its row.
    const loginsMoved = () => { if (state.open && state.section === "providers") rerenderSoon(); };
    api()?.onCliAccounts?.(loginsMoved);
    api()?.onCliSetupClosed?.((detail) => { if (detail?.account) loginsMoved(); });
    window.addEventListener("mefi:queue-settings", () => { if (state.open && ["run", "finish"].includes(state.section) && queueKey() !== state.queueShown) rerenderSoon(); });
    window.MefiScroll?.scan?.(overlay);
  }
  // The walkthrough sheet's trap, for the same reason: an aria-modal dialog
  // must not let Tab wander into the page behind it.
  function trapFocus(event) {
    if (event.key === "Escape" && !window.MefiNav?.claim) { event.preventDefault?.(); close(); return; }
    if (event.key !== "Tab") return;
    const controls = Array.from(els.sheet.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], summary, [tabindex="0"]'))
      .filter((item) => !item.hidden && !item.closest?.("[hidden]"));
    const first = controls[0], last = controls[controls.length - 1];
    if (!first) return;
    if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement))) { event.preventDefault?.(); last.focus?.(); }
    else if (!event.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement))) { event.preventDefault?.(); first.focus?.(); }
  }

  function paintSteps() {
    if (!els.list) return;
    const path = route();
    const at = path.findIndex((item) => item.id === state.section);
    for (const item of SECTIONS) {
      const current = item.id === state.section;
      item.button.setAttribute("aria-current", current ? "step" : "false");
      const status = typeof item.status === "function" ? item.status() : "";
      item.button.dataset.state = status || "";
      item.button.parentNode.dataset.path = path.includes(item) ? "on" : "off";
      const mark = item.button.querySelector(".setup-helper-step-state");
      if (mark) mark.textContent = status === "done" ? "✓" : status === "attention" ? "!" : "";
      item.button.setAttribute("aria-label", `${item.short}${status === "done" ? ", done" : status === "attention" ? ", needs attention" : ""}`);
    }
    const index = at < 0 ? SECTIONS.findIndex((item) => item.id === state.section) : at;
    const total = at < 0 ? SECTIONS.length : path.length;
    els.progress.textContent = `Step ${index + 1} of ${total}`;
    els.bar.setAttribute("aria-valuemax", String(total));
    els.bar.setAttribute("aria-valuenow", String(index + 1));
    els.fill.style.width = `${Math.round(((index + 1) / total) * 100)}%`;
    els.back.disabled = index <= 0;
    const following = (at < 0 ? SECTIONS : path)[index + 1];
    els.next.textContent = following ? `Next: ${following.short}` : "Finish";
  }

  let renderSerial = 0;
  async function show(id, { focus = true, keepScroll = false } = {}) {
    if (!els.content) return;
    const item = section(id) || SECTIONS[0];
    const serial = ++renderSerial;
    const scroll = keepScroll && state.section === item.id ? els.main.scrollTop : 0;
    state.section = item.id;
    visited.add(item.id);
    els.title.textContent = item.title;
    els.intro.textContent = typeof item.intro === "function" ? item.intro() : item.intro || "";
    // Rendered off-screen and swapped in whole, so a section that waits on
    // the host never shows half its cards, and a stale render is dropped.
    const content = node("div");
    els.content.setAttribute("aria-busy", "true");
    if (!keepScroll) say("");
    paintSteps();
    try {
      await item.render(content, { current: () => serial === renderSerial && state.section === item.id && state.open });
    } catch (error) {
      if (serial === renderSerial) say(plain(error, "This section could not load."), "bad");
    }
    if (serial !== renderSerial) return;
    // A card's long description and a field's long hint sit behind an "i" at the end of its title
    // (MefiUi.tuck, studio-ui.js), so a section reads as its controls. Done while the section is still
    // off the page, where tuck reads no style, and before the focus is put back, so a circle that had
    // the keyboard is found again by its name.
    window.MefiUi?.tuck?.(content);
    const active = document.activeElement;
    const held = els.content.contains?.(active) ? { label: active.getAttribute?.("aria-label"), text: active.tagName === "BUTTON" ? active.textContent : null, tag: active.tagName, row: active.closest?.(".setup-helper-toggle")?.querySelector?.("strong")?.textContent || null } : null;
    els.content.removeAttribute("aria-busy");
    els.content.dataset.section = item.id;
    els.content.replaceChildren(...Array.from(content.children));
    els.main.scrollTop = scroll;
    if (held) {
      const match = Array.from(els.content.querySelectorAll(held.tag.toLowerCase())).find((item) => held.row ? item.closest?.(".setup-helper-toggle")?.querySelector?.("strong")?.textContent === held.row
        : held.label ? item.getAttribute?.("aria-label") === held.label : held.text !== null && item.textContent === held.text);
      match?.focus?.({ preventScroll: true });
      focus = false;
    }
    paintSteps();
    window.MefiScroll?.refresh?.();
    if (focus) els.title.focus?.({ preventScroll: true });
    window.dispatchEvent(new CustomEvent("mefi-setup-helper", { detail: { open: true, section: item.id } }));
  }
  function step(delta) {
    const path = state.path === "quick" && route().some((item) => item.id === state.section) ? route() : SECTIONS;
    const at = path.findIndex((item) => item.id === state.section);
    const target = at + delta;
    if (target >= path.length) { close(); return; }
    if (target < 0) return;
    void show(path[target].id);
  }

  // ---- the first run in the 0.5 layout: a four-step welcome -----------------
  // With html[data-layout="v2"] a fresh profile meets the 0.5 prototype's first
  // run (docs/prototype/mefi-studio-0.5-v5.html, welcomeView) instead of this
  // whole sheet: make it yours (Light, Dark or Stylized, a colour, the text
  // size and motion, changed behind the card as you pick), connect the AI you
  // already use, choose a project, give it a first task. Closing it leaves a
  // small note on the Settings button saying where the look lives now (and
  // that the Shop has more). Every step reads and acts through what already exists: the
  // coding tools from setup:cli-status and their own Sign in or install
  // (setup:cli-action); the projects from projects:list, switched through the
  // workspace's own project buttons (which ask before stopping busy agents),
  // with Open a folder… and Start a new app… through their usual flows; the
  // task through tasks:create, then the workspace's own start. Skip, Escape and
  // Start the task mark this revision seen and hand on exactly as closing the
  // sheet does. The sheet stays one step away: Other ways to connect opens it
  // at Connect an AI (keys and local models live there), and Search, Help and
  // Configuration reach it as before. A returning profile after an update still
  // gets the sheet. The prototype's "Write a check first" has no counterpart in
  // the engine yet, so it is not offered.
  const WELCOME = Object.freeze(["look", "connect", "projects", "task"]);
  const WELCOME_STEPS = WELCOME.length;
  const stepIs = (name) => WELCOME[welcome.step] === name;
  const MARKS = { claude: "CC", codex: "CX", opencode: "OC", grok: "GK", antigravity: "AG" };
  const COUNT = ["no", "one", "two", "three", "four", "five", "six"];
  const welcome = { open: false, step: 0, els: null, clis: null, projects: null, text: "", busy: false, then: null, previous: null, serial: 0, connected: null };
  // What each tool uses, in a beginner's words: the account they may already pay for, or OpenCode's free models.
  const ACCOUNT = { claude: "Uses your Claude subscription", codex: "Uses your ChatGPT plan", grok: "Uses your Grok account", antigravity: "Uses your Google account", opencode: "Free models to start with" };
  // The first task's examples: small, plain, and each one a whole thought.
  const FIRST_TASKS = ["A page that says hello, with a big button that changes the color", "A to-do list where I can add and tick off things", "A countdown timer with start and stop buttons"];
  const layoutV2 = () => document.documentElement?.dataset?.layout === "v2";
  function buildWelcome() {
    if (welcome.els) return welcome.els;
    const overlay = node("div", "setup-welcome"); overlay.id = "setup-welcome"; overlay.hidden = true;
    const card = node("section", "setup-welcome-card"); card.id = "setup-welcome-card"; card.tabIndex = -1;
    card.setAttribute("role", "dialog"); card.setAttribute("aria-modal", "true"); card.setAttribute("aria-labelledby", "setup-welcome-title"); card.setAttribute("aria-describedby", "setup-welcome-lead");
    const steps = node("div", "setup-welcome-steps"); steps.setAttribute("role", "progressbar"); steps.setAttribute("aria-label", "First run"); steps.setAttribute("aria-valuemin", "1"); steps.setAttribute("aria-valuemax", String(WELCOME_STEPS));
    for (let index = 0; index < WELCOME_STEPS; index += 1) steps.append(node("i"));
    const title = node("h2", "setup-welcome-title"); title.id = "setup-welcome-title"; title.tabIndex = -1;
    const lead = node("p", "setup-welcome-lead"); lead.id = "setup-welcome-lead";
    const body = node("div", "setup-welcome-body"); body.id = "setup-welcome-body";
    const status = node("p", "setup-welcome-status"); status.id = "setup-welcome-status"; status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    const foot = node("footer", "setup-welcome-foot");
    const back = button("Back", () => void showWelcome(welcome.step - 1), "ghost"); back.id = "setup-welcome-back";
    const skip = button("Skip", () => closeWelcome(), "ghost"); skip.id = "setup-welcome-skip";
    skip.title = "Close this. The Setup guide waits under Help (Esc)";
    const next = button("Continue", () => void welcomeNext(), "primary"); next.id = "setup-welcome-next";
    foot.append(back, node("span", "setup-welcome-gap"), skip, next);
    card.append(steps, title, lead, body, status, foot);
    overlay.append(card);
    // A modal: Escape skips, and Tab stays inside the card.
    card.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault?.(); event.stopPropagation?.(); closeWelcome(); return; }
      if (event.key !== "Tab") return;
      const stops = [...card.querySelectorAll("button, input, select, textarea")].filter((item) => !item.disabled && !item.hidden && item.getClientRects?.().length !== 0);
      if (!stops.length) return;
      const first = stops[0], last = stops.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault?.(); last.focus?.(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault?.(); first.focus?.(); }
    });
    document.body.append(overlay);
    welcome.els = { overlay, card, steps, title, lead, body, status, back, skip, next };
    return welcome.els;
  }
  const welcomeSay = (text, bad = false) => { const line = welcome.els?.status; if (!line) return; line.textContent = text || ""; line.classList.toggle("bad-text", Boolean(bad)); };
  function welcomeRow({ mark, name, small, end, on = false, onClick = null, key = "" }) {
    const row = node(onClick ? "button" : "div", `setup-welcome-opt${on ? " is-on" : ""}`);
    if (onClick) { row.type = "button"; row.addEventListener("click", onClick); row.setAttribute("aria-pressed", String(on)); }
    if (key) row.dataset.option = key;
    const av = node("span", "setup-welcome-av", typeof mark === "string" ? mark : "");
    av.setAttribute("aria-hidden", "true");
    const words = node("span", "setup-welcome-words");
    words.append(node("b", "", name));
    if (small) words.append(node("small", "", small));
    row.append(av, words);
    if (end) row.append(end);
    return row;
  }
  const chip = (text, ready = false) => node("span", `setup-welcome-chip${ready ? " is-ready" : ""}`, ready ? `✓ ${text}` : text);
  // Step 1: the look, in three plain choices. Each is a family of themes from
  // music.js (MefiMusic.looks() when it has them; these keys otherwise), and a
  // pick goes through music.js's own applyLook / applyTheme, so it is saved and
  // comes back after a restart exactly as a pick in Settings › Appearance.
  // Text size goes through MefiSize, motion through the Interface card's own
  // Motion control (#motion-toggle). Nothing here is the Shop's.
  const LOOKS = Object.freeze([
    { id: "light", name: "Light", small: "Bright and clean, easy to read in daylight", themes: ["daylight", "paper"] },
    { id: "dark", name: "Dark", small: "Calm and dark, easy on the eyes", themes: ["chrome", "midnight", "forest", "violet", "ember", "rose", "gold"] },
    { id: "stylized", name: "Stylized", small: "Glowing colour and bold headings", themes: ["aurora", "dusk", "void", "eclipse", "abyss"] },
  ]);
  const TEXT_SIZES = Object.freeze([[1, "Default"], [1.1, "Large"], [1.2, "Larger"]]);
  const MOTIONS = Object.freeze([["full", "Full"], ["calm", "Calm"], ["off", "Off"]]);
  function lookFamilies() {
    const music = window.MefiMusic;
    const known = new Map((music?.themes?.() || []).map((theme) => [theme.key, theme]));
    const listed = typeof music?.looks === "function" ? music.looks() : null;
    return LOOKS.map((look) => {
      const own = Array.isArray(listed) ? listed.find((item) => item?.id === look.id) : null;
      const keys = (Array.isArray(own?.themes) ? own.themes : look.themes).filter((key) => known.has(key));
      return { ...look, name: own?.name || look.name, themes: keys.map((key) => known.get(key)) };
    }).filter((look) => look.themes.length);
  }
  function useLook(look, key) {
    const music = window.MefiMusic;
    if (typeof music?.applyLook === "function") music.applyLook(look.id, key, true);
    else music?.applyTheme?.(key, true);
  }
  // A little window in that look: its rail, a title bar, two lines, a button, two orbs.
  const luminance = (hex) => {
    const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
    if (!match) return 0;
    const n = parseInt(match[1], 16);
    return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  };
  function lookArt(theme) {
    const art = node("span", "setup-welcome-look-art");
    art.setAttribute("aria-hidden", "true");
    const set = (name, value) => { if (value) art.style.setProperty?.(name, value); };
    set("--look-bg", theme.bg); set("--look-panel", theme.panel); set("--look-accent", theme.accent);
    set("--look-accent2", theme.accent2 || theme.bright); set("--look-text", luminance(theme.bg) > 0.45 ? "#1f242c" : "#eef1f6");
    for (const part of ["rail", "bar", "line", "line short", "button", "orb", "orb two"]) art.append(node("i", part));
    return art;
  }
  const motionNow = () => (document.body?.classList?.contains?.("no-motion") ? "off" : document.body?.classList?.contains?.("ws-still") ? "calm" : "full");
  function segmented(label, options, current, pick) {
    const row = node("div", "setup-welcome-look-row");
    const name = node("span", "setup-welcome-look-label", label);
    const group = node("div", "segmented setup-welcome-seg"); group.setAttribute("role", "group"); group.setAttribute("aria-label", label);
    for (const [value, text] of options) {
      const choice = button(text, () => { pick(value); for (const other of group.children) other.setAttribute("aria-pressed", String(other === choice)); }, "");
      choice.dataset.value = String(value);
      choice.setAttribute("aria-pressed", String(value === current));
      group.append(choice);
    }
    row.append(name, group);
    return row;
  }
  function paintLook({ keep = null } = {}) {
    const { title, lead, body } = welcome.els;
    title.textContent = "Make it yours";
    lead.textContent = "Pick how Studio looks. It changes behind this card as you choose, and you can change it again any time in Settings › Appearance.";
    const families = lookFamilies();
    const current = window.MefiMusic?.theme?.();
    const chosen = families.find((look) => look.themes.some((theme) => theme.key === current)) || null;
    const looks = node("div", "setup-welcome-looks");
    looks.setAttribute("role", "radiogroup"); looks.setAttribute("aria-label", "Look");
    for (const look of families) {
      const on = chosen?.id === look.id;
      const pick = node("button", `setup-welcome-look${on ? " is-on" : ""}`);
      pick.type = "button"; pick.dataset.look = look.id;
      pick.setAttribute("role", "radio"); pick.setAttribute("aria-checked", String(on));
      const words = node("span", "setup-welcome-look-words");
      words.append(node("b", "", look.name), node("small", "", look.small));
      pick.append(lookArt(look.themes[0]), words);
      pick.addEventListener("click", () => { if (chosen?.id !== look.id) useLook(look, look.themes[0].key); paintLook({ keep: `[data-look="${look.id}"]` }); });
      looks.append(pick);
    }
    const parts = [looks];
    // The colours of the chosen family, as swatches.
    if (chosen && chosen.themes.length > 1) {
      const row = node("div", "setup-welcome-look-row");
      const swatches = node("div", "setup-welcome-swatches");
      swatches.setAttribute("role", "radiogroup"); swatches.setAttribute("aria-label", "Colour");
      for (const theme of chosen.themes) {
        const swatch = node("button", "setup-welcome-swatch");
        swatch.type = "button"; swatch.dataset.theme = theme.key;
        swatch.setAttribute("role", "radio"); swatch.setAttribute("aria-checked", String(theme.key === current));
        swatch.setAttribute("aria-label", theme.name); swatch.title = theme.name;
        swatch.style.setProperty?.("--swatch", theme.accent);
        swatch.style.setProperty?.("--swatch-2", theme.accent2 || theme.bright || theme.accent);
        swatch.style.setProperty?.("--swatch-bg", theme.bg);
        swatch.addEventListener("click", () => { useLook(chosen, theme.key); paintLook({ keep: `[data-theme="${theme.key}"]` }); });
        swatches.append(swatch);
      }
      row.append(node("span", "setup-welcome-look-label", "Colour"), swatches);
      parts.push(row);
    }
    const size = window.MefiSize;
    if (typeof size?.apply === "function") {
      const now = Number(size.get?.()?.text) || 1;
      parts.push(segmented("Text size", TEXT_SIZES, TEXT_SIZES.reduce((best, [value]) => (Math.abs(value - now) < Math.abs(best - now) ? value : best), 1), (text) => {
        void Promise.resolve(size.apply({ text }, { source: "first-run" })).catch(() => welcomeSay("The text size was not saved. Try it again in Settings › Size.", true));
      }));
    }
    const motion = document.getElementById("motion-toggle");
    if (motion) {
      parts.push(segmented("Motion", MOTIONS, motionNow(), (level) => {
        motion.value = level;
        motion.dispatchEvent?.(new Event("change"));
      }));
    }
    // Every Studio comes with Ember, a little dragon (renderer/pets.js): on for a new studio, off in one click.
    const pets = window.MefiPets;
    if (typeof pets?.set === "function") {
      const row = segmented("Your dragon", [[true, "On"], [false, "Off"]], pets.state?.()?.on === true, (on) => pets.set({ on }));
      row.append(node("small", "setup-welcome-look-note", "Ember flies around and naps on the bars. Free with every Studio."));
      parts.push(row);
    }
    body.replaceChildren(...parts);
    if (keep) body.querySelector?.(keep)?.focus?.({ preventScroll: true });
  }
  // Step 1: the AI that builds, in plain words: the coding tools on this PC with their own sign-in, and OpenCode's free
  // models for anyone starting with no subscription.
  async function paintConnect(serial) {
    const { title, lead, body } = welcome.els;
    title.textContent = "Pick the AI that builds for you";
    if (!welcome.clis) { try { welcome.clis = await api()?.cliSetupStatus?.() ?? null; } catch { welcome.clis = null; } }
    if (serial !== welcome.serial) return;
    const clis = welcome.clis?.ok ? (welcome.clis.clis || []) : [];
    const found = clis.filter((cli) => cli.installed);
    lead.textContent = found.length
      ? `Studio found ${COUNT[found.length] ?? found.length} AI tool${found.length === 1 ? "" : "s"} on this PC. Sign in to one and Studio uses it for everything: chatting, planning and building.`
      : welcome.clis?.ok ? "Studio doesn't come with its own AI: it works through one you sign in to, with your own account. Pick the one you already pay for, or start free with OpenCode."
        : "Studio looks for your AI tools in the desktop app.";
    const act = (cli, action) => async (event) => {
      const control = event?.currentTarget;
      if (control) control.disabled = true;
      welcomeSay(action === "login" ? `Opening ${cli.name}'s sign-in…` : `Opening ${cli.name}'s setup…`);
      try {
        const result = await need("cliSetupAction")({ id: cli.id, action });
        if (result?.ok === false) throw new Error(result.error || "That did not open.");
        welcomeSay(result?.message || "Finish it in the window that opened, then come back here.");
        setTimeout(() => { void recheckClis(); }, 1500);
      } catch (error) { welcomeSay(plain(error, "That did not open."), true); if (control) control.disabled = false; }
    };
    const shown = found.length ? found : clis.filter((item) => item.subscription);
    // OpenCode stays on offer when it is not installed: the way in without a subscription.
    const opencode = clis.find((cli) => cli.id === "opencode");
    if (opencode && !shown.includes(opencode)) shown.push(opencode);
    const rows = [];
    for (const cli of shown) {
      const account = ACCOUNT[cli.id] || "Uses your own account";
      let small, end;
      if (!cli.installed) { small = `${account} · not installed yet`; end = button(cli.subscription ? "Install and sign in" : "Install", act(cli, "install"), "ghost mini"); }
      else if (!cli.subscription) { small = "Installed · free models to start with"; end = chip("Free"); }
      else if (cli.signedIn === true) { small = `${account} · signed in`; end = chip("Ready", true); }
      else { small = cli.signedIn === false ? `${account} · sign in to use it` : `${account} · installed`; end = button("Sign in", act(cli, "login"), "ghost mini"); }
      rows.push(welcomeRow({ mark: MARKS[cli.id] || cli.name.slice(0, 2).toUpperCase(), name: cli.name, small, end, on: cli.installed && (cli.signedIn === true || !cli.subscription), key: cli.id }));
    }
    // A sign-in or an install finishes in its own window: Check again reads the tools now (coming back to Studio does too).
    const waiting = shown.some((cli) => !cli.installed || (cli.subscription && cli.signedIn !== true));
    const again = waiting ? button("Check again", () => { welcomeSay("Checking your AI tools…"); void recheckClis().then(() => welcomeSay("")); }, "ghost mini setup-welcome-recheck") : null;
    if (again) again.id = "setup-welcome-recheck";
    const more = button("Other ways: an API key, a ChatGPT plan or a local model", () => {
      // Keys, local models and the ChatGPT plan live in the sheet; it hands on when it closes, as the welcome would have.
      const then = welcome.then; welcome.then = null;
      hideWelcome();
      state.then = then;
      open("providers", { reason: "first-run" });
    }, "ghost mini setup-welcome-more");
    more.id = "setup-welcome-more";
    body.replaceChildren(...rows, ...(again ? [again] : []), more);
  }
  // The tools on this PC, read again, and the first step drawn from them while it shows. Focus stays on the row (or the
  // button) it was on, since the step is drawn anew.
  async function recheckClis({ repaint = true } = {}) {
    try { welcome.clis = await api()?.cliSetupStatus?.() ?? welcome.clis; } catch { /* keep the last read */ }
    if (!repaint || !welcome.open || !stepIs("connect")) return;
    const held = welcome.els?.card?.contains?.(document.activeElement) ? document.activeElement : null;
    const heldKey = held?.closest?.("[data-option]")?.dataset?.option ?? held?.id ?? null;
    await showWelcome(WELCOME.indexOf("connect"), { focus: false });
    if (!heldKey || !welcome.open || !stepIs("connect")) return;
    const body = welcome.els?.body;
    const back = body?.querySelector?.(`[data-option="${heldKey}"] button`) ?? body?.querySelector?.(`[data-option="${heldKey}"]`) ?? document.getElementById?.(heldKey) ?? welcome.els?.title;
    back?.focus?.({ preventScroll: true });
  }
  // Coming back to Studio from a sign-in or install window: the first step reads the tools again.
  const welcomeRefocus = () => { if (welcome.open && stepIs("connect") && !welcome.busy) void recheckClis(); };
  // Leaving the first step puts Studio on what is ready, so the first task runs on it: a signed-in subscription for the
  // whole studio (setup:cli-use, the sheet's Use for the whole studio), else OpenCode's free models (the first scan's
  // setup, setup:first-scan and -apply). With nothing ready nothing changes, and Today's line says what is missing.
  async function useConnected() {
    // What was signed in or installed since the step was drawn counts: the tools are read once more first.
    welcomeSay("Checking your AI tools…");
    await recheckClis({ repaint: false });
    welcomeSay("");
    const clis = welcome.clis?.ok ? (welcome.clis.clis || []) : [];
    const ready = ["claude", "codex", "grok", "antigravity"].map((id) => clis.find((cli) => cli.id === id && cli.installed && cli.signedIn === true)).find(Boolean);
    if (ready) {
      if (welcome.connected === ready.id || typeof api()?.cliSetupUse !== "function") return;
      welcomeSay(`Setting Studio up to use ${ready.name}…`);
      const result = await api().cliSetupUse(ready.id);
      if (result?.ok === false) { welcomeSay(`${result.error || `${ready.name} was not set up.`} You can do it later in Team › Providers.`, true); return; }
      welcome.connected = ready.id;
      welcomeSay(`Studio will use ${ready.name} for chatting, planning and building. Change it any time in Team › Providers.`);
      return;
    }
    const free = clis.find((cli) => cli.id === "opencode" && cli.installed);
    if (!free || welcome.connected === "opencode" || typeof api()?.firstScan !== "function" || typeof api()?.firstScanApply !== "function") return;
    welcomeSay("Setting up OpenCode's free models (about ten seconds)…");
    try {
      const scan = await api().firstScan({});
      if (scan?.ok === false) throw new Error(scan.error || "OpenCode did not answer.");
      const applied = await api().firstScanApply({});
      if (applied?.ok === false) throw new Error(applied.error || "The free setup was not saved.");
      welcome.connected = "opencode";
      welcomeSay("Studio will build with OpenCode's free models. Free work runs one task at a time.");
    } catch (error) { welcomeSay(`${plain(error, "OpenCode's free models were not set up.")} You can do it later in Help › Setup guide.`, true); }
  }
  // Step 2: the project, as the workspace has it.
  async function paintProjects(serial) {
    const { title, lead, body } = welcome.els;
    title.textContent = "Choose a project";
    lead.textContent = "Studio builds inside a folder on your PC. Your tasks, plans and chats stay with it.";
    try { welcome.projects = await api()?.projectsList?.() ?? null; } catch { welcome.projects = null; }
    if (serial !== welcome.serial) return;
    const list = Array.isArray(welcome.projects?.projects) ? welcome.projects.projects : [];
    const active = welcome.projects?.activeId ?? null;
    const rows = list.slice(0, 8).map((project) => {
      const name = String(project.name || "Project");
      const on = project.id === active;
      return welcomeRow({ mark: (name.trim()[0] || "P").toUpperCase(), name, small: String(project.path || ""), on, key: `project:${project.id}`, end: on ? chip("Open", true) : null, onClick: on ? () => {} : () => {
        // The workspace's own project button: it asks before stopping agents that are still working.
        const own = document.querySelector?.(`#workspace-projects [data-project-id="${String(project.id).replace(/["\\]/g, "")}"]`);
        if (own && !own.disabled) { own.click(); welcomeSay(`Opening ${name}…`); }
        else welcomeSay("Choose it from the project list once this closes.", true);
      } });
    });
    // A new app first: the beginner's way in, a folder Studio makes for you.
    if (typeof window.MefiVibe?.openPanel === "function") rows.push(welcomeRow({ mark: "✦", name: "Start a new app…", small: "Studio makes the folder for you", key: "new-app", onClick: () => { closeWelcome(); window.MefiVibe.openPanel("newapp"); } }));
    const add = document.getElementById?.("workspace-add-project");
    if (add || typeof api()?.projectsAdd === "function") rows.push(welcomeRow({ mark: "+", name: "Open a folder…", small: "A folder you already have", key: "open-folder", onClick: () => { if (add && !add.disabled) add.click(); else void api().projectsAdd?.(); } }));
    if (!list.length) lead.textContent = "Studio builds inside a folder on your PC. Start a new app and Studio makes one for you, or open a folder you already have.";
    body.replaceChildren(...rows);
  }
  // Step 3: the first task, in plain words, with examples a tap fills in. No project open: it says so instead.
  const welcomeProject = () => {
    const id = welcome.projects?.activeId ?? window.MefiWorkspace?.activeProjectId?.() ?? null;
    return id && id !== "project_none" ? id : null;
  };
  // What the launch screen's new app said it should be (renderer/startup.js): that project's first task, ready to build.
  const FIRST_TASK_KEY = "mefiStudio.firstTask";
  const savedFirstTask = () => {
    let saved = null;
    try { saved = JSON.parse(read(FIRST_TASK_KEY) || "null"); } catch { return ""; }
    return typeof saved?.text === "string" && (!saved.projectId || saved.projectId === welcomeProject()) ? saved.text.trim() : "";
  };
  function paintTask() {
    const { title, lead, body } = welcome.els;
    title.textContent = "What should Studio make first?";
    if (!welcomeProject()) {
      lead.textContent = `Open or start a project first (step ${WELCOME.indexOf("projects") + 1}), then come back here: Studio needs a folder to build in.`;
      body.replaceChildren();
      return;
    }
    lead.textContent = "Describe something small, in plain words, like you'd tell a friend. Studio plans it, builds it, and checks it works before it says done.";
    const input = node("input", "setup-welcome-input"); input.id = "setup-welcome-task"; input.type = "text"; input.maxLength = 4000;
    input.placeholder = "Describe something small"; input.value = welcome.text; input.setAttribute("aria-label", "First task"); input.autocomplete = "off";
    const sync = () => { welcome.text = input.value; welcome.els.next.disabled = welcome.busy || !input.value.trim(); };
    input.addEventListener("input", sync);
    input.addEventListener("keydown", (event) => { if (event.key === "Enter" && input.value.trim()) { event.preventDefault?.(); void welcomeNext(); } });
    const examples = node("div", "setup-welcome-examples"); examples.setAttribute("role", "group"); examples.setAttribute("aria-label", "Examples");
    examples.append(node("span", "setup-welcome-examples-label", "Or try one:"));
    for (const text of FIRST_TASKS) examples.append(button(text, () => { input.value = text; sync(); input.focus?.({ preventScroll: true }); }, "ghost mini setup-welcome-example"));
    body.replaceChildren(input, examples);
  }
  async function showWelcome(step, { focus = true } = {}) {
    const els = buildWelcome();
    welcome.step = Math.max(0, Math.min(WELCOME_STEPS - 1, step));
    const serial = ++welcome.serial;
    els.card.dataset.step = String(welcome.step);
    [...els.steps.children].forEach((bar, index) => bar.classList.toggle("on", index <= welcome.step));
    els.steps.setAttribute("aria-valuenow", String(welcome.step + 1));
    els.steps.setAttribute("aria-valuetext", `Step ${welcome.step + 1} of ${WELCOME_STEPS}`);
    els.back.hidden = welcome.step === 0;
    els.next.textContent = welcome.step === WELCOME_STEPS - 1 ? "Build it" : "Continue";
    if (welcome.step === WELCOME_STEPS - 1 && !welcome.text.trim()) welcome.text = savedFirstTask();
    els.next.disabled = welcome.busy || (welcome.step === WELCOME_STEPS - 1 && (!welcome.text.trim() || !welcomeProject()));
    welcomeSay("");
    if (stepIs("look")) paintLook();
    else if (stepIs("connect")) await paintConnect(serial);
    else if (stepIs("projects")) await paintProjects(serial);
    else paintTask();
    if (serial !== welcome.serial || !welcome.open) return;
    if (focus) (welcome.step === WELCOME_STEPS - 1 ? els.body.querySelector?.("input") : els.title)?.focus?.({ preventScroll: true });
  }
  async function welcomeNext() {
    if (welcome.busy) return;
    if (welcome.step < WELCOME_STEPS - 1) {
      let said = "", bad = false;
      if (stepIs("connect")) {
        welcome.busy = true; welcome.els.next.disabled = true;
        try { await useConnected(); } catch (error) { welcomeSay(plain(error, "The AI was not set up."), true); }
        finally { welcome.busy = false; }
        said = welcome.els.status?.textContent || "";
        bad = Boolean(welcome.els.status?.classList?.contains?.("bad-text"));
      }
      await showWelcome(welcome.step + 1);
      // What the setup did stays on the next step's line until something else is said there.
      if (said && !welcome.els.status?.textContent) welcomeSay(said, bad);
      return;
    }
    const text = welcome.text.trim();
    if (!text) return;
    const projectId = welcomeProject();
    if (!projectId) { welcomeSay("Open or start a project first: Studio needs a folder to build in.", true); return; }
    welcome.busy = true; welcome.els.next.disabled = true;
    welcomeSay("Adding your first task…");
    try {
      if (typeof api()?.tasksCreate !== "function") throw new Error("Tasks are added in the desktop app.");
      const result = await api().tasksCreate({ title: text.split("\n")[0].slice(0, 180), prompt: text, projectId });
      if (!result || result.ok === false) throw new Error(result?.error || "The task was not added.");
      welcome.text = "";
      try { localStorage.removeItem(FIRST_TASK_KEY); } catch { /* private store */ }
      closeWelcome();
      const task = result.task;
      if (task?.id) {
        window.MefiSessions?.select?.(task.id);
        // Start is the workspace's own: it asks for a worker the way the Start button does.
        if (typeof window.MefiWorkspace?.startTask === "function") void Promise.resolve(window.MefiWorkspace.startTask(task)).catch(() => {});
      }
    } catch (error) { welcomeSay(plain(error, "The task was not added."), true); }
    finally { welcome.busy = false; if (welcome.open && welcome.els) welcome.els.next.disabled = !welcome.text.trim() || !welcomeProject(); }
  }
  // A new studio gets its dragon: on, unless this profile already chose.
  const PET_KEY = "mefiStudio.pet.v1";
  function welcomeDragon() {
    if (headless || typeof window.MefiPets?.set !== "function" || read(PET_KEY) !== null) return;
    window.MefiPets.set({ on: true });
  }
  function openWelcome({ then = null } = {}) {
    welcomeDragon();
    const els = buildWelcome();
    if (!welcome.open) { welcome.open = true; welcome.previous = document.activeElement; welcome.then = then; els.overlay.hidden = false; window.addEventListener?.("focus", welcomeRefocus); }
    void showWelcome(0);
    window.dispatchEvent(new CustomEvent("mefi-setup-helper", { detail: { open: true, section: "first-run" } }));
    return true;
  }
  function hideWelcome() {
    if (!welcome.open) return false;
    welcome.open = false; welcome.serial += 1;
    window.removeEventListener?.("focus", welcomeRefocus);
    if (welcome.els) welcome.els.overlay.hidden = true;
    const back = welcome.previous; welcome.previous = null;
    if (back && document.contains?.(back)) back.focus?.({ preventScroll: true });
    return true;
  }
  // Skip, Escape and Start the task: this revision is seen, and the hand-off runs as the sheet's close runs it.
  function closeWelcome() {
    if (!hideWelcome()) return;
    write(SEEN_KEY, REVISION);
    window.dispatchEvent(new CustomEvent("mefi-setup-helper", { detail: { open: false, section: "first-run" } }));
    const then = welcome.then; welcome.then = null;
    if (typeof then === "function") { try { then({ tour: false }); } catch { /* the next prompt is a nicety */ } }
    if (typeof setTimeout === "function") setTimeout(() => showLookTip(), 1400);
  }

  // ---- after the welcome: where the look lives --------------------------------
  // Once, on the first run: a small note beside the Settings button saying the
  // look changes in Settings › Appearance and that the Shop has more (pets,
  // menu effects and style packs). Got it, Escape or a click elsewhere closes
  // it for good. It waits while a sheet or another pop-up is open, and gives up
  // after a minute.
  const LOOK_TIP_KEY = "mefiStudio.lookTip.v1";
  const lookNote = { el: null, tries: 0 };
  function lookTipAnchor() {
    for (const selector of ['#app-rail-foot [data-nav="studio"]', '#app-rail [data-nav="studio"]', '[data-nav="studio"]']) {
      for (const candidate of document.querySelectorAll?.(selector) ?? []) {
        const rect = candidate.getBoundingClientRect?.();
        if (rect && rect.width > 0 && rect.height > 0) return candidate;
      }
    }
    return null;
  }
  function showLookTip() {
    if (read(LOOK_TIP_KEY) || lookNote.el || headless) return false;
    const nav = window.MefiNav?.state;
    const waiting = nav?.sheet || nav?.transient || welcome.open || state.open || document.getElementById?.("walkthrough-overlay")?.hidden === false;
    if (waiting) { if (lookNote.tries++ < 30) setTimeout(() => showLookTip(), 2000); return false; }
    const tip = node("div", "setup-look-tip");
    tip.id = "setup-look-tip";
    tip.setAttribute("role", "dialog"); tip.setAttribute("aria-labelledby", "setup-look-tip-title");
    const heading = node("b", "setup-look-tip-title", "Change your look any time"); heading.id = "setup-look-tip-title";
    const where = node("p", "", "Theme, colour, text size and motion are in Settings › Appearance.");
    const more = node("p", "", "Pets, menu effects and style packs are in the Shop, on Friends.");
    const actions = node("div", "setup-look-tip-actions");
    const done = () => closeLookTip();
    actions.append(
      button("Open Appearance", () => { done(); window.MefiNav?.go?.("studio", { category: "appearance" }); }, "ghost mini"),
      button("See the Shop", () => { done(); if (window.MefiShop?.open) window.MefiShop.open("studio"); else window.MefiNav?.go?.("friends", { place: "shop" }); }, "ghost mini"),
      button("Got it", done, "primary mini"),
    );
    tip.append(heading, where, more, actions);
    tip.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.preventDefault?.(); done(); } });
    document.body.append(tip);
    lookNote.el = tip;
    placeLookTip();
    window.addEventListener?.("resize", placeLookTip);
    document.addEventListener?.("pointerdown", lookTipOutside, true);
    write(LOOK_TIP_KEY, "seen");
    return true;
  }
  function lookTipOutside(event) { if (lookNote.el && !lookNote.el.contains?.(event.target)) closeLookTip(); }
  function placeLookTip() {
    const tip = lookNote.el;
    if (!tip) return;
    const anchor = lookTipAnchor();
    const rect = anchor?.getBoundingClientRect?.();
    const width = window.innerWidth || 1280, height = window.innerHeight || 800;
    if (!rect) { tip.dataset.side = "none"; tip.style.left = `${Math.max(16, width / 2 - 170)}px`; tip.style.top = `${Math.max(16, height - 220)}px`; return; }
    // Beside the button, its arrow pointing at it; kept inside the window.
    const box = tip.getBoundingClientRect?.() || { width: 320, height: 150 };
    const top = Math.min(Math.max(12, rect.top + rect.height / 2 - box.height / 2), height - box.height - 12);
    tip.dataset.side = "right";
    tip.style.left = `${Math.round(rect.right + 12)}px`;
    tip.style.top = `${Math.round(top)}px`;
    tip.style.setProperty?.("--arrow", `${Math.round(rect.top + rect.height / 2 - top)}px`);
  }
  function closeLookTip() {
    if (!lookNote.el) return;
    lookNote.el.remove();
    lookNote.el = null;
    window.removeEventListener?.("resize", placeLookTip);
    document.removeEventListener?.("pointerdown", lookTipOutside, true);
  }

  // ---- open, close and the first launch -------------------------------------
  function open(id, options = {}) {
    build();
    if (!state.open) {
      state.open = true;
      state.reason = options.reason || "manual";
      data.team = null; data.scope = null; data.routing = null;
      window.MefiNav?.claim?.("setup-helper");
      els.overlay.hidden = false;
    }
    void show(section(id) ? id : state.section || SECTIONS[0].id);
    return true;
  }
  // `tour` is the owner's own "Continue to the guided tour"; every other close
  // (Close, Esc, Finish) tells `then` so, and the tour waits to be asked for.
  function close({ tour = false } = {}) {
    if (!state.open) return;
    state.open = false;
    renderSerial += 1;
    write(SEEN_KEY, REVISION);
    els.overlay.hidden = true;
    window.MefiNav?.release?.("setup-helper");
    window.dispatchEvent(new CustomEvent("mefi-setup-helper", { detail: { open: false, section: state.section } }));
    const then = state.then; state.then = null;
    if (typeof then === "function") { try { then({ tour: tour === true }); } catch { /* the next prompt is a nicety */ } }
  }
  const isOpen = () => state.open;
  const seen = () => read(SEEN_KEY) === REVISION;

  // Called once the studio is up (booklet.js), before the walkthrough. A
  // helper that opens takes `then` (booklet.js's hand-off to the walkthrough)
  // and runs it when it closes, with { tour }, so the two never stack.
  // Diagnostic launches never open it.
  function startup({ then = null } = {}) {
    if (headless || seen()) return false;
    // The 0.5 layout's first run is the three-step welcome; an update still brings this sheet.
    if (!returning && layoutV2()) return openWelcome({ then });
    state.then = then;
    open("welcome", { reason: returning ? "update" : "first-run" });
    return true;
  }

  window.MefiNav?.register?.({
    id: "setup-helper", label: "Setup helper", short: "Setup", kind: "overlay", layer: "sheet", section: "agents", group: "tools",
    key: null, glyph: "g-agents", badge: null,
    desc: "Every agent setting in one place: connect an AI, team and models, routing, how work runs, permissions, tools, machine and look",
    searchTerms: "setup helper wizard first run settings agents providers keys api subscription login team models seats routing fallback jev permissions autonomy autopilot proactive parallel workers backlog tools mcp skills machine updates theme",
    showIn: { palette: true, help: true, tools: true },
    element: "setup-helper-overlay", focus: "#setup-helper-title",
    open: (params = {}) => open(params.section), close, isOpen,
  });
  // One Search entry per section, so "routing" or "permissions" lands there.
  for (const item of SECTIONS) {
    window.MefiNav?.register?.({
      id: `setup-helper:${item.id}`, kind: "action", section: "agents", group: "tools", label: `Setup helper › ${item.short}`,
      desc: typeof item.intro === "function" ? item.intro().slice(0, 160) : String(item.intro || "").slice(0, 160),
      glyph: "g-agents", showIn: { palette: true }, run: () => open(item.id),
    });
  }

  window.MefiSetupHelper = {
    open: (id, options) => open(id, options), close, isOpen, startup, seen,
    // The 0.5 layout's first run: open it (as startup does on a fresh profile), whether it shows, and Skip.
    welcome: (options) => openWelcome(options), welcomeOpen: () => welcome.open, closeWelcome,
    // The note that says where the look lives (shown once, after the welcome).
    lookTip: () => showLookTip(), lookTipOpen: () => Boolean(lookNote.el),
    section: () => (state.open ? state.section : null),
    // Whether the last connections read found a working route (null before
    // any read), so the walkthrough can skip its own "link an AI" stop.
    connected: () => (data.routing ? routeReady() : null),
    sections: () => SECTIONS.map(({ id, title, short }) => ({ id, title, short })),
    REVISION,
  };
})();
