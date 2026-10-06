// Team › Seats and models and Team › Providers, made simple (the 0.5 layout).
//
// The owner wants every menu readable "like I'm 5": few words on the page and
// the how-to behind small "i" circles. Seats and models opens on five plain
// parts, as the approved mockup ("Team and Friends, made simple") has them:
//   Right now           who does what, in a sentence or two, and three chips
//   How Studio decides  six choices, each written to the team draft
//   Who does what       one line per job: its model, what that model is good
//                       for, how hard it thinks, its results on this PC and
//                       Change (the job's detailed card under More settings)
//   Report card         what each coding model is good and bad at on this PC,
//                       the suggestions (Try it, Not now) and the kinds of
//                       jobs sent to another model (Stop)
//   How thinking works  the steps a stuck job climbs
// renderer/agents.js owns the rest: in the 0.5 layout it mounts this page on
// top of Seats and models, folds the detailed cards (the role grid, routing,
// coding workers, team coordination) under More settings, repaints this from
// renderConfiguration() and hands over the context (`ctx`, see mount()).
//
// Nothing here saves on its own. The six choices and each job's thinking edit
// the team draft (ctx.draft()) and mark it dirty, so they apply with the rest
// of the team on Apply changes (agents:save, checked by
// scripts/agent-profiles.cjs). The report card's Try it and Stop are the one
// exception: mefiStudio.teamKindRoute applies at once (main.cjs "Which model
// does which kind of job") and answers with a fresh report.
//
// Providers gains two cards on top, the setup helper's flows in its words
// (renderer/setup-helper.js): one subscription for the whole studio
// (cliSetupStatus, cliSetupCheck, cliSetupUse) and more than one login
// (cliAccounts, cliAccountAdd, cliAccountLogin, cliAccountCheck,
// cliAccountRemove). Every host call is optional: one the bridge lacks reads
// as "not yet" instead of failing the page.
(function () {
  "use strict";
  const api = () => window.mefiStudio || null;
  // A host call that may be missing: null when the bridge has no such call.
  async function host(name, ...args) {
    const fn = api()?.[name];
    return typeof fn === "function" ? fn(...args) : null;
  }
  const record = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = String(text);
    return el;
  }
  function button(text, run, className = "ghost mini") {
    const el = node("button", className, text);
    el.type = "button";
    el.addEventListener("click", run);
    return el;
  }
  const plain = (error, fallback) => window.MefiUi?.plainError ? window.MefiUi.plainError(error, fallback) : (typeof error === "string" ? error : error?.message || error?.error) || fallback;
  const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  // "a, b and c"
  const list = (items) => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
  const percent = (rate) => `${Math.round(Math.max(0, Math.min(1, Number(rate) || 0)) * 100)}%`;
  function dispatch(name, detail) {
    try { if (typeof CustomEvent === "function") window.dispatchEvent?.(new CustomEvent(name, { detail })); } catch { /* no events here */ }
  }

  // A small "i": the how-to behind a row, out of the way until asked for.
  // MefiUi.info (studio-ui.js) draws the shared one, a round button that opens
  // a small popover. Until it is there, a focusable "i" carries the words as
  // its tooltip and its accessible name.
  function tip(text, label = "More about this") {
    const info = window.MefiUi?.info;
    if (typeof info === "function") {
      try { const made = info(text, { label }); if (made) return made; } catch { /* the plain one below */ }
    }
    const el = node("span", "tm-tip", "i");
    el.tabIndex = 0;
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", `${label}: ${text}`);
    el.title = text;
    return el;
  }

  // ---- words ------------------------------------------------------------------
  // Model ids as people say them. The report card's models come named by the
  // host (scripts/model-kinds.cjs modelName); the routes the team view lists
  // carry only ids. Claude Code's short names stand for the current models.
  // Anything else takes the model catalog's own name, else the id tidied.
  const NAMES = Object.freeze({
    opus: "Opus 5.5", sonnet: "Sonnet 5.5", haiku: "Haiku", fable: "Fable 5.1",
    "claude-opus-5-5": "Opus 5.5", "claude-opus-5.5": "Opus 5.5", "claude-sonnet-5-5": "Sonnet 5.5", "claude-sonnet-5.5": "Sonnet 5.5",
    "claude-haiku-4-5": "Haiku 4.5", "claude-fable-5-1": "Fable 5.1",
    "gpt-6-luna": "GPT-6 Luna", "gpt-6-sol": "GPT-6 Sol", "gpt-6.1-sol": "GPT-6.1 Sol", "gpt-6-codex": "GPT-6 Codex", "gpt-5.6-luna": "GPT-5.6 Luna",
    "deepseek-v4.1-flash": "DeepSeek V4.1 Flash", "deepseek-v4-flash": "DeepSeek V4 Flash", "deepseek-v4-pro": "DeepSeek V4 Pro",
    "glm-5.3": "GLM-5.3", "glm-5.3-flash": "GLM-5.3 Flash", "glm-5.2": "GLM-5.2",
    "openrouter/free": "Free models",
  });
  const TOOLS = Object.freeze({ claude: "Claude Code", codex: "Codex", grok: "Grok", antigravity: "Antigravity", opencode: "OpenCode" });
  // Where a model runs: [short name, the words after a model's name].
  const VIA = Object.freeze({
    auto: ["Automatic", "picked automatically"],
    claude: ["Claude login", "on your Claude login"],
    codex: ["ChatGPT login", "on Codex with your ChatGPT login"],
    chatgpt: ["ChatGPT plan", "on your ChatGPT plan"],
    grok: ["Grok login", "on your Grok login"],
    antigravity: ["Google login", "on Antigravity"],
    opencode: ["OpenCode Go", "on OpenCode Go"],
    zen: ["OpenCode Zen", "on OpenCode Zen"],
    zai: ["z.ai", "on z.ai"],
    openrouter: ["OpenRouter", "on OpenRouter"],
    lmstudio: ["LM Studio on this PC", "on LM Studio"],
    custom: ["Your own server", "on your own server"],
  });
  const PLACEHOLDER = /^(?:provider default|tool default|default)$/i;
  const modelId = (model) => String(model ?? "").trim().replace(/^(?:opencode-go|opencode|mefi-zai|zai-coding-plan|openai|anthropic)\//i, "").toLowerCase();
  const isDefault = (model) => { const raw = String(model ?? "").trim(); return !raw || PLACEHOLDER.test(raw) || /-default$/i.test(raw); };
  let catalog = null;
  function catalogName(id) {
    if (catalog === null) {
      catalog = new Map();
      try { for (const entry of JSON.parse(document.getElementById("booklet-data")?.textContent || "{}").models || []) if (entry?.id && entry.name) catalog.set(String(entry.id).toLowerCase(), String(entry.name)); } catch { /* no catalog: tidy ids */ }
    }
    return catalog.get(id) || "";
  }
  function tidy(id) {
    const words = id.split(/[-_\s]+/).filter(Boolean).map((part) => /^v?\d/.test(part) ? part.replace(/^v/, "V") : ["gpt", "glm", "lm", "ai"].includes(part) ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1));
    return words.join(" ").replace(/^(GPT|GLM) (\d)/, "$1-$2");
  }
  // Where a route's model comes from. A coding worker on OpenCode says by its
  // model's prefix which OpenCode provider runs it, as the model record does
  // (main.cjs workerLedgerIdentity: a bare id is an OpenCode Go model).
  function viaOf(provider, model = "", { builder = false } = {}) {
    const raw = String(provider ?? "");
    if (!Object.hasOwn(VIA, raw)) return { key: "custom", name: raw || "Unknown", on: raw ? `on ${raw}` : "" };
    let key = raw;
    if (builder && raw === "opencode") {
      const id = String(model ?? "").trim().toLowerCase();
      key = id.startsWith("opencode/") ? "zen" : id.startsWith("mefi-zai/") ? "zai" : id.startsWith("openrouter/") ? "openrouter" : "opencode";
    }
    const [name, on] = VIA[key];
    return { key, name, on };
  }
  function modelName(model, provider = "") {
    const raw = String(model ?? "").trim();
    if (isDefault(raw)) return provider === "auto" ? "Picked automatically" : TOOLS[provider] ? `${TOOLS[provider]}'s default` : `${viaOf(provider).name} default`;
    if (NAMES[raw.toLowerCase()]) return NAMES[raw.toLowerCase()];
    const id = modelId(raw);
    return NAMES[id] || catalogName(id) || tidy(id.split("/").pop() || id);
  }
  // What a model family is good for, kept short (the prototype's MODEL_GOOD).
  const GOOD_FOR = Object.freeze([
    [/fable/, "The hardest problems"],
    [/opus/, "Planning, review and hard bugs"],
    [/sonnet/, "Balanced building and writing"],
    [/haiku/, "Quick, simple answers"],
    [/luna/, "Reading, checking and quick answers"],
    [/(?:^|[-.])sol(?:$|-)/, "Plans and careful reviews"],
    [/codex/, "Large refactors and long tasks"],
    [/deepseek.*flash/, "Everyday building at low cost"],
    [/deepseek.*pro/, "Harder building at low cost"],
    [/glm/, "Tidying, summaries and small fixes"],
    [/kimi/, "Long coding sessions"],
    [/qwen/, "Everyday building"],
    [/grok/, "Quick answers and code"],
  ]);
  function goodFor(model, provider = "", { builder = false } = {}) {
    const id = isDefault(model) ? "" : modelId(model);
    // Claude Code builds with its own tools whatever model it runs, Opus aside.
    if (builder && provider === "claude" && !/opus|fable/.test(id)) return "Everyday building with its own tools";
    for (const [pattern, words] of GOOD_FOR) if (id && pattern.test(id)) return words;
    return provider === "codex" ? "Large refactors and long tasks" : provider === "claude" ? "Everyday building with its own tools" : "";
  }

  // ---- thinking ---------------------------------------------------------------
  // Four levels, each the effort word the routes take (scripts/model-ladder.cjs).
  const LEVELS = Object.freeze([["light", "low", "Light"], ["balanced", "medium", "Balanced"], ["deep", "high", "Deep"], ["max", "max", "Max"]]);
  const LEVEL_OF = Object.freeze({ minimal: "light", low: "light", medium: "balanced", high: "deep", xhigh: "deep", max: "max", ultra: "max" });
  const EFFORT_OF = Object.freeze({ light: "low", balanced: "medium", deep: "high", max: "max" });
  const LEVEL_WORD = Object.freeze({ auto: "Auto", light: "Light", balanced: "Balanced", deep: "Deep", max: "Max" });
  const MODES = Object.freeze(["auto", "light", "balanced", "deep"]);
  // The team's thinking choices (agentThinking) with the defaults filled in.
  function thinkingOf(item) {
    const raw = { ...(record(item?.saved?.thinking) ? item.saved.thinking : {}), ...(record(item?.configuration?.agentThinking) ? item.configuration.agentThinking : {}) };
    const flag = (key) => typeof raw[key] === "boolean" ? raw[key] : true;
    return { mode: MODES.includes(raw.mode) ? raw.mode : "auto", climb: flag("climb"), askMax: flag("askMax"), explore: flag("explore") };
  }
  // The effort words a provider and model take, as agent-profiles.capabilities
  // reads them when Apply checks a role's or a seat's effort: the Responses API
  // routes for GPT-5 and GPT-6 models, Claude Code but for Haiku, and Codex.
  function capable(provider, model = "") {
    const id = String(model ?? "").toLowerCase().replace(/^openai\//, "");
    const extended = /^gpt-6(?:\.\d+)?-/.test(id);
    const reasoning = (provider === "zen" || provider === "chatgpt" || provider === "openrouter" && /^openai\//i.test(String(model))) && (extended || /^(gpt-5(?:[.-]|$)|o[134](?:-|$))/.test(id));
    if (reasoning) return extended ? ["minimal", "low", "medium", "high", "xhigh", "max"] : ["low", "medium", "high"];
    if (provider === "claude") return /haiku/i.test(id) ? [] : ["low", "medium", "high", "xhigh", "max"];
    if (provider === "codex") return ["low", "medium", "high", "xhigh"];
    return [];
  }

  // ---- the jobs -----------------------------------------------------------------
  const JOBS = Object.freeze([
    { id: "companion", job: "Talks with you", who: "Companion", kind: "seat", does: "talks with you" },
    { id: "routine", job: "Quick answers and checks", who: "Routine assistant", kind: "role", does: "answers quick questions" },
    { id: "heavy", job: "Plans and reviews", who: "Planning and review", kind: "role", does: "plans and reviews" },
    { id: "builder", job: "Writes the code", who: "Coding worker", kind: "builder", does: "writes the code" },
    { id: "lead", job: "Leads big jobs", who: "Lead", kind: "seat", does: "leads big jobs" },
    { id: "desk", job: "Unsticks workers", who: "Desk", kind: "seat", does: "unsticks workers" },
    { id: "scout", job: "Finds the starting files", who: "Scout", kind: "seat", does: "finds the starting files" },
    { id: "overseer", job: "Watches the whole team", who: "Overseer", kind: "seat", does: "watches the team" },
  ]);
  // A seat's defaults, as renderer/agents.js and main.cjs SEAT_DEFAULTS have them.
  const seatDefaults = (seat) => ({ provider: seat === "overseer" ? "auto" : "zen", model: ["companion", "scout"].includes(seat) ? "gpt-6-luna" : "gpt-6.1-sol", effort: seat === "scout" ? "low" : "medium", fast: ["companion", "scout"].includes(seat) });
  // One job's route in a team configuration, read the way renderConfiguration()
  // reads it: provider, model, the model Apply checks an effort against, and
  // the effort the owner set (empty when Studio decides).
  function routeIn(configuration, saved, job) {
    const config = record(configuration) ? configuration : {};
    if (job.kind === "role") {
      const provider = config.aiRoleProviders?.[job.id] || config.aiProvider || "auto";
      const model = config.aiModelsByProvider?.[provider]?.[job.id] ?? (["auto", "zen", "zai", "opencode"].includes(provider) ? config.aiModels?.[job.id] || "" : "");
      return { provider, model: String(model || ""), checked: String(config.aiModelsByProvider?.[provider]?.[job.id] || config.aiModels?.[job.id] || ""), tier: "", effort: String(config.agentEfforts?.[job.id] || "") };
    }
    if (job.kind === "seat") {
      const value = { ...seatDefaults(job.id), ...(record(saved?.seats?.[job.id]) ? saved.seats[job.id] : {}), ...(record(config.agentSeats?.[job.id]) ? config.agentSeats[job.id] : {}) };
      const provider = String(value.provider || "zen"), model = String(value.model || "");
      return { provider, model, checked: model || (provider === "zen" ? "gpt-6.1-sol" : ""), tier: "", effort: String(config.agentSeats?.[job.id]?.effort || "") };
    }
    const cli = config.executorCli || "opencode", tier = config.executorTier || "auto";
    const model = tier === "auto" ? config.executorModels?.[cli] ?? config.executorModel ?? "" : config.executorTierModels?.[cli]?.[tier] || "";
    return { provider: cli, model: String(model || ""), checked: String(model || ""), tier, effort: String(config.agentEfforts?.builder || "") };
  }
  // How the model record files a coding worker's runs (main.cjs workerLedgerIdentity).
  function ledgerKey(cli, model) {
    const named = String(model || "");
    if (["grok", "claude", "codex", "antigravity"].includes(cli)) return `${cli}::${named || `${cli}-default`}`;
    if (/^mefi-zai\//.test(named)) return `zai::${named.replace(/^mefi-zai\//, "")}`;
    return `opencode::${(named || "opencode-default").replace(/^opencode-go\//, "")}`;
  }
  const verdictOf = (wins, settled) => settled < 5 ? "few" : wins / settled >= 0.6 ? "good" : wins / settled >= 0.4 ? "ok" : "weak";
  // The coding worker's record on this PC, from the report card.
  // `known` is the host's own ledger key for the worker as it is set up
  // (teamReport's builder.key), used while the draft has not moved it.
  function resultOf(report, cli, model, name, known = null) {
    const models = Array.isArray(report?.models) ? report.models : [];
    const key = known || ledgerKey(cli, isDefault(model) ? "" : model);
    const entry = models.find((item) => item?.key === key) || models.find((item) => name && item?.name === name);
    const settled = Number(entry?.settled) || 0;
    if (!entry || !settled) return null;
    const wins = Math.max(0, Number(entry.wins) || 0);
    return { wins, settled, rate: wins / settled, verdict: verdictOf(wins, settled) };
  }
  // Each job as Who does what shows it. The applied route (agents:state's
  // choices) names the real model, Automatic resolved; a job the draft moved
  // shows the draft's choice until Apply. Thinking offers the levels the route
  // takes: a role or a seat one its own provider and model take (Apply refuses
  // anything else) and the applied route lists, none of its own on Automatic;
  // the coding worker all four, which each attempt fits to its model.
  function jobRows(item, report = null) {
    const thinking = thinkingOf(item), saved = record(item?.saved) ? item.saved : {};
    return JOBS.map((job) => {
      const now = routeIn(item?.configuration, saved, job), before = routeIn(saved.configuration, saved, job);
      const pending = now.provider !== before.provider || now.model !== before.model || now.tier !== before.tier;
      const choice = !pending && record(saved.choices?.[job.id]) ? saved.choices[job.id] : null;
      const builder = job.kind === "builder";
      const provider = String(choice?.provider || now.provider);
      const model = choice ? (isDefault(choice.model) ? "" : String(choice.model)) : now.model;
      let words = builder ? ["low", "medium", "high", "max"] : now.provider === "auto" ? [] : capable(now.provider, now.checked);
      if (!builder && choice && Array.isArray(choice.efforts)) words = words.filter((word) => choice.efforts.includes(word));
      const explicit = LEVEL_OF[now.effort] || "";
      const levels = LEVELS.map(([level]) => level).filter((level) => words.includes(EFFORT_OF[level]) || level === explicit);
      // A job with no level of its own shows the team's fixed level when it takes it.
      const level = explicit || (thinking.mode !== "auto" && levels.includes(thinking.mode) ? thinking.mode : "");
      const name = modelName(model, provider);
      return {
        ...job, provider, model, name, pending, via: viaOf(provider, model, { builder }), good: goodFor(model, provider, { builder }),
        ok: choice ? choice.ok !== false : true, reason: String(choice?.reason || ""),
        levels, level, explicit: Boolean(explicit), result: builder ? resultOf(report, provider, model, name, !pending && typeof report?.builder?.key === "string" ? report.builder.key : null) : null,
      };
    });
  }
  // Who does what, in a sentence per model: "Opus 5.5 on your Claude login plans and reviews."
  function subjectOf(row) {
    if (row.provider === "auto") return "A model Studio picks";
    if (isDefault(row.model)) return TOOLS[row.provider] && row.provider !== "opencode" ? TOOLS[row.provider] : `${row.via.name}'s default model`;
    return `${row.name} ${row.via.on}`;
  }
  function nowSentences(rows) {
    const groups = [];
    for (const row of rows) {
      const key = `${row.via.key}|${row.provider === "auto" ? "auto" : row.name}`;
      let group = groups.find((entry) => entry.key === key);
      if (!group) groups.push(group = { key, row, does: [] });
      group.does.push(row.does);
    }
    return groups.sort((a, b) => b.does.length - a.does.length).map(({ row, does }) => `${subjectOf(row)} ${list(does)}.`);
  }

  // ---- what each choice says ------------------------------------------------------
  const THINK_LEAD = Object.freeze({
    auto: "Every job starts with light thinking and thinks harder only when it gets stuck.",
    light: "Every job thinks lightly. Fastest, and easiest on your plan.",
    balanced: "Every job thinks at a balanced level.",
    deep: "Every job thinks deeply. Slower, and it uses more of your plan.",
  });
  const HINTS = Object.freeze({
    pick: { jev: "Each kind of job goes to the model with the best results on this PC. Your picks below are where it starts.", fixed: "Studio uses exactly the models below for every kind of job." },
    mode: { auto: "Starts light. When a check fails, the retry thinks one step harder.", light: "Always light. Fastest, and easiest on your plan.", balanced: "Always balanced. Slower than light, steadier on bigger jobs.", deep: "Always deep. Best for hard work, heavy on your plan." },
    climb: { step: "Think harder first. After two misses on the same model, a stronger model takes the job.", same: "Retries use the same model and thinking. A job that keeps failing waits for you." },
    askMax: { on: "Max thinking waits for your OK.", off: "Studio may use Max thinking without asking." },
    explore: { on: "When a kind of job keeps failing, Studio tries another model on the next 5 and keeps it only if it does better.", off: "Studio only suggests other models, in the report card.", fixed: "Only while Pick models for me is on Auto." },
    subs: { on: "Claude and ChatGPT logins before pay-per-use keys.", off: "Studio follows your provider order, keys included." },
  });
  const TIPS = Object.freeze({
    pick: "Auto sends each kind of job (building features, exploring a codebase, fixing bugs) to the model with the best record on this PC, and may try another model on a few jobs to learn. I choose keeps every job on the models you set below.",
    mode: "Light is quick and easy on your plan. Balanced and Deep think longer and use more of it. Auto starts light and steps up only when a job gets stuck. A model with no thinking setting keeps its own.",
    climb: "Step up: after a failed check the retry thinks one step harder, and after two misses on one model a stronger one takes over (Flash to Pro on OpenCode Go, Sonnet to Opus on Claude Code). With a fixed thinking level only the model moves. Retry the same way: every retry runs like the first.",
    askMax: "Max thinking uses the most of your plan. With this on, a job that would need it waits for your OK.",
    explore: "Studio runs at most one trial of its own at a time, on a kind of job the usual model keeps failing, and says so in the feed. A trial uses a subscription first.",
    subs: "Signed-in Claude Code and ChatGPT logins answer before API keys that bill per use. Off: Studio walks your provider order, under More settings.",
    who: "Change a job's thinking here. Change opens that job's card under More settings, where its provider, exact model, tools, skills and habits live.",
    report: "From coding tasks Studio checked on this PC. Good means at least 6 in 10 passed, OK at least 4 in 10, Weak fewer. Five checked tasks come before a verdict. Try it sends the next 5 jobs of that kind to the suggested model, and Studio keeps it only if it does clearly better.",
    ladder: "Every job starts light. A failed check makes the retry think one step harder. After two misses on the same model, a stronger model takes the job and can think deeper. Max waits for you unless you turned that off. When a harder step works for a kind of job, that kind starts there next time.",
  });

  // ---- state ------------------------------------------------------------------
  const NOT_NOW_KEY = "mefiStudio.teamModels.notNow";
  const state = {
    root: null, ctx: null, ui: null, rows: new Map(),
    report: null, reportFor: undefined, reportError: "", reportSerial: 0, reportBusy: false, reportPainted: null, flash: null, hidden: new Set(),
    accounts: null, accountsSerial: 0, accountsBusy: false,
  };
  const ctx = () => state.ctx || prov.ctx || {};
  const projectIdOf = () => { try { return ctx().projectId?.() ?? null; } catch { return null; } };
  const draftOf = () => { try { return ctx().draft?.() || null; } catch { return null; } };
  function notNow() {
    try { const saved = JSON.parse(window.localStorage?.getItem(NOT_NOW_KEY) || "[]"); return Array.isArray(saved) ? saved.filter((id) => typeof id === "string") : []; } catch { return []; }
  }
  function rememberNotNow(id) {
    const ids = [...notNow().filter((item) => item !== id), id].slice(-40);
    try { window.localStorage?.setItem(NOT_NOW_KEY, JSON.stringify(ids)); } catch { /* this visit only */ }
    state.hidden.add(id);
  }

  // ---- Seats and models: the page ------------------------------------------------
  // Search finds the new parts by the Team place that holds them, as it finds
  // the cards agents.js moved ("Team › <place> › <words>", settings:<id>), and
  // opens the place at them (openTeam scrolls to and focuses the target).
  function searchable(id, words, desc, place) {
    const where = place === "providers" ? "Providers" : "Seats and models";
    window.MefiNav?.register?.({ id: `settings:${id}`, kind: "action", section: "agents", group: "tools", label: `Team › ${where} › ${words}`, desc: String(desc || "").slice(0, 160), glyph: "g-agents", showIn: { palette: true }, run: () => ctx().go?.("agents", { place, target: id }) });
  }
  function panel(id, title, help) {
    const box = node("section", "agents-card tm-panel"); box.id = id;
    const head = node("div", "tm-head"), heading = node("h2", "tm-title", title); heading.id = `${id}-title`;
    heading.tabIndex = -1;
    head.append(heading);
    if (help) head.append(tip(help, `About ${title.toLowerCase()}`));
    box.setAttribute("aria-labelledby", heading.id);
    box.append(head);
    return { box, head, heading };
  }
  // A segmented choice (the app's .segmented, which every theme styles): one
  // button per value, the chosen one pressed.
  function segmented(label, options, pick) {
    const group = node("div", "segmented tm-seg"); group.setAttribute("role", "group"); group.setAttribute("aria-label", label);
    const items = options.map(([value, text]) => {
      const item = button(text, () => { if (item.getAttribute("aria-pressed") !== "true") pick(value); }, "tm-seg-item");
      item.dataset.value = value; item.setAttribute("aria-pressed", "false");
      group.append(item);
      return item;
    });
    return { el: group, set(value, disabled = false) { for (const item of items) { item.setAttribute("aria-pressed", String(item.dataset.value === value)); item.disabled = disabled; } } };
  }
  function toggle(label, change) {
    const input = node("input", "tm-switch"); input.type = "checkbox"; input.setAttribute("role", "switch"); input.setAttribute("aria-label", label);
    input.addEventListener("change", () => change(input.checked));
    return { el: input, set(on, disabled = false) { input.checked = Boolean(on); input.disabled = disabled; } };
  }
  // The six choices, in the mockup's order. Each writes one team field.
  const DECIDE = Object.freeze([
    { key: "pick", title: "Pick models for me", control: "segmented", options: [["jev", "Auto"], ["fixed", "I choose"]] },
    { key: "mode", title: "How hard to think", control: "segmented", options: [["auto", "Auto"], ["light", "Light"], ["balanced", "Balanced"], ["deep", "Deep"]] },
    { key: "climb", title: "When a job gets stuck", control: "segmented", options: [["step", "Step up"], ["same", "Retry the same way"]] },
    { key: "askMax", title: "Ask me before Max thinking", control: "switch" },
    { key: "explore", title: "Try other models now and then", control: "switch" },
    { key: "subs", title: "Use my subscriptions first", control: "switch" },
  ]);
  function choose(key, value) {
    const item = draftOf(); if (!item?.configuration) return;
    const config = item.configuration;
    if (key === "pick") config.modelSelection = value === "fixed" ? "fixed" : "jev";
    else if (key === "subs") config.aiSubscriptionFirst = Boolean(value);
    else {
      const next = thinkingOf(item);
      if (key === "mode") next.mode = MODES.includes(value) ? value : "auto";
      else if (key === "climb") next.climb = value === "step";
      else next[key] = Boolean(value);
      config.agentThinking = next;
    }
    changed();
  }
  // One job's thinking: the effort word the level means, or empty for Auto.
  function setLevel(job, level) {
    const item = draftOf(); if (!item?.configuration) return;
    const config = item.configuration, effort = EFFORT_OF[level] || "";
    if (job.kind === "seat") {
      const value = { ...seatDefaults(job.id), ...(record(item.saved?.seats?.[job.id]) ? item.saved.seats[job.id] : {}), ...(record(config.agentSeats?.[job.id]) ? config.agentSeats[job.id] : {}) };
      config.agentSeats = { ...config.agentSeats, [job.id]: { ...value, effort } };
    } else config.agentEfforts = { ...config.agentEfforts, [job.id]: effort };
    changed();
  }
  // The draft changed: agents.js marks it dirty (Apply lights up) and repaints
  // the page, this part included. Without agents.js this repaints itself.
  function changed() {
    if (typeof ctx().changed === "function") ctx().changed();
    else render();
  }

  function mount(root, context = {}) {
    if (!root) return;
    state.ctx = context;
    if (state.root === root) { render(); return; }
    state.root = root; state.rows.clear();
    root.classList.add("team-models");
    const ui = state.ui = {};
    // Right now
    const now = panel("tm-now", "Right now");
    ui.lead = node("p", "tm-lead"); ui.think = node("p", "tm-lead tm-lead-2"); ui.chips = node("div", "tm-chips");
    now.box.append(ui.lead, ui.think, ui.chips);
    // How Studio decides
    const decide = panel("tm-decide", "How Studio decides");
    const rows = node("div", "tm-rows");
    ui.decide = {};
    for (const choice of DECIDE) {
      const row = node("div", "settings-control tm-row"); row.dataset.choice = choice.key;
      row.id = `tm-choice-${choice.key}`; row.tabIndex = -1;
      searchable(row.id, choice.title, TIPS[choice.key], "seats");
      const words = node("span", "tm-row-words"), title = node("span", "tm-row-title"), hint = node("small", "tm-hint");
      hint.id = `tm-hint-${choice.key}`;
      title.append(node("b", "", choice.title), tip(TIPS[choice.key], `About ${choice.title.toLowerCase()}`));
      words.append(title, hint);
      const control = choice.control === "switch" ? toggle(choice.title, (on) => choose(choice.key, on)) : segmented(choice.title, choice.options, (value) => choose(choice.key, value));
      control.el.setAttribute("aria-describedby", hint.id);
      row.append(words, control.el);
      rows.append(row);
      ui.decide[choice.key] = { control, hint };
    }
    decide.box.append(rows);
    // Who does what
    const who = panel("tm-who", "Who does what", TIPS.who);
    const table = node("div", "tm-table"); table.setAttribute("role", "table"); table.setAttribute("aria-labelledby", who.heading.id);
    const header = node("div", "tm-tr"); header.setAttribute("role", "row");
    // The last column holds the Change buttons: named for a screen reader, blank on the page.
    for (const text of ["Job", "Model", "Thinking", "Results on this PC", ""]) { const cell = node("div", "tm-th", text); cell.setAttribute("role", "columnheader"); if (!text) cell.setAttribute("aria-label", "Change"); header.append(cell); }
    ui.tbody = node("div", "tm-tbody"); ui.tbody.setAttribute("role", "rowgroup");
    const head = node("div", "tm-thead-group"); head.setAttribute("role", "rowgroup"); head.append(header);
    table.append(head, ui.tbody);
    who.box.append(table);
    // Report card
    const report = panel("tm-report", "Report card", TIPS.report);
    ui.reportHeading = report.heading;
    ui.reportSub = node("p", "tm-sub");
    ui.reportBody = node("div", "tm-report-body");
    ui.reportSay = node("p", "tm-say"); ui.reportSay.setAttribute("role", "status");
    report.box.append(ui.reportSub, ui.reportBody, ui.reportSay);
    // How thinking works
    const ladder = panel("tm-ladder", "How thinking works", TIPS.ladder);
    ui.ladder = node("ol", "tm-rungs");
    ladder.box.append(node("p", "tm-sub", "Light thinking is fast and saves your plan. Studio spends more only when a job needs it."), ui.ladder);
    root.replaceChildren(now.box, decide.box, who.box, report.box, ladder.box);
    searchable(who.heading.id, "Who does what", TIPS.who, "seats");
    searchable(report.heading.id, "Report card", "What each model is good and bad at, from coding tasks Studio checked on this PC.", "seats");
    searchable(ladder.heading.id, "How thinking works", TIPS.ladder, "seats");
    render();
  }

  function render() {
    const ui = state.ui; if (!ui) return;
    const item = draftOf();
    if (!item?.configuration) {
      ui.lead.textContent = "Reading your team…"; ui.think.textContent = ""; ui.chips.replaceChildren();
      for (const { control } of Object.values(ui.decide)) control.set(null, true);
      return;
    }
    const projectId = projectIdOf();
    if (state.reportFor !== projectId && !state.reportBusy) void loadReport();
    if (state.accounts === null && !state.accountsBusy) void loadAccounts();
    const rows = jobRows(item, state.report);
    paintNow(item, rows);
    paintDecide(item);
    paintTable(rows, thinkingOf(item));
    paintReport();
    paintLadder(thinkingOf(item));
  }

  function paintNow(item, rows) {
    const ui = state.ui, config = item.configuration, thinking = thinkingOf(item);
    ui.lead.textContent = nowSentences(rows).join(" ");
    ui.think.textContent = thinking.mode === "auto" && !thinking.climb ? "Every job starts with light thinking, and a retry thinks the same way." : THINK_LEAD[thinking.mode];
    const chip = (text, warn = false) => { const el = node("span", "tm-chip"); if (warn) el.dataset.tone = "warn"; const dot = node("i"); dot.setAttribute("aria-hidden", "true"); el.append(dot, node("span", "", text)); return el; };
    const chips = [chip(config.modelSelection === "fixed" ? "You pick each model" : "Studio picks the best model per job"), chip(config.aiSubscriptionFirst === false ? "Your provider order first" : "Subscriptions first")];
    const claude = (state.accounts?.ok ? state.accounts.providers || [] : []).find((entry) => entry?.id === "claude");
    if (claude && (claude.installed || (claude.accounts || []).length > 1)) {
      const logins = Math.max(1, (claude.accounts || []).length);
      const one = chip(count(logins, "Claude login"), logins === 1);
      chips.push(one);
      // One login stops at its limit; a second one carries on (Providers › Your subscriptions).
      if (logins === 1) chips.push(button("Add a second one in Providers", () => ctx().go?.("agents", { place: "providers", target: "team-subscriptions" }), "tm-link"));
    }
    ui.chips.replaceChildren(...chips);
  }

  function paintDecide(item) {
    const ui = state.ui, config = item.configuration, thinking = thinkingOf(item);
    const pick = config.modelSelection === "fixed" ? "fixed" : "jev";
    const set = (key, value, hint) => { ui.decide[key].control.set(value); ui.decide[key].hint.textContent = hint; };
    set("pick", pick, HINTS.pick[pick]);
    set("mode", thinking.mode, HINTS.mode[thinking.mode]);
    // With a fixed level, Step up only moves the job to a stronger model (model-ladder builderStep).
    set("climb", thinking.climb ? "step" : "same", !thinking.climb ? HINTS.climb.same : thinking.mode === "auto" ? HINTS.climb.step : `After two misses, a stronger model takes the job. Thinking stays ${LEVEL_WORD[thinking.mode].toLowerCase()}.`);
    set("askMax", thinking.askMax, thinking.askMax ? HINTS.askMax.on : HINTS.askMax.off);
    set("explore", thinking.explore, pick === "fixed" ? HINTS.explore.fixed : thinking.explore ? HINTS.explore.on : HINTS.explore.off);
    set("subs", config.aiSubscriptionFirst !== false, config.aiSubscriptionFirst !== false ? HINTS.subs.on : HINTS.subs.off);
  }

  // Who does what: one row per job, kept between paints so a select keeps its
  // focus while its own change repaints the page.
  function paintTable(rows, thinking) {
    const ui = state.ui;
    for (const row of rows) {
      let entry = state.rows.get(row.id);
      if (!entry || entry.tr.parentNode !== ui.tbody) { entry = makeRow(row); state.rows.set(row.id, entry); ui.tbody.append(entry.tr); }
      fillRow(entry, row, thinking);
    }
  }
  function makeRow(job) {
    const tr = node("div", "tm-tr"); tr.setAttribute("role", "row"); tr.dataset.job = job.id;
    const cell = (className, role = "cell") => { const el = node("div", `tm-td ${className}`); el.setAttribute("role", role); tr.append(el); return el; };
    const jobCell = cell("tm-td-job", "rowheader");
    jobCell.append(node("b", "", job.job), node("small", "", job.who));
    const model = cell("tm-td-model"), think = cell("tm-td-think"), result = cell("tm-td-result"), change = cell("tm-td-change");
    const select = node("select", "tm-think"); select.id = `tm-think-${job.id}`; select.setAttribute("aria-label", `Thinking for ${job.job.toLowerCase()}`);
    select.addEventListener("change", () => setLevel(job, select.value));
    const auto = node("span", "tm-none", "Auto"); auto.title = "Follows How hard to think";
    const mine = node("small", "tm-set", "You set this");
    think.append(select, auto, mine);
    const go = button("Change", () => ctx().reveal?.(job.id), "ghost mini tm-change");
    go.setAttribute("aria-label", `Change ${job.job.toLowerCase()}`);
    change.append(go);
    return { tr, model, think, result, select, auto, mine, sig: "" };
  }
  function fillRow(entry, row, thinking) {
    const maxLabel = thinking.askMax ? "Max (asks you)" : "Max";
    const sig = JSON.stringify([row.provider, row.model, row.name, row.via.key, row.good, row.pending, row.ok, row.reason, row.levels, maxLabel, row.result]);
    if (entry.sig !== sig) {
      entry.sig = sig;
      const line = node("div", "tm-model"), dot = node("span", "tm-dot");
      dot.dataset.provider = row.via.key; dot.setAttribute("aria-hidden", "true");
      line.append(dot, node("b", "", row.name));
      const where = node("small", "", row.good ? `${row.via.name} · Good for: ${row.good}` : row.via.name);
      const parts = [line, where];
      if (row.pending) parts.push(node("small", "tm-pending", "After you apply"));
      if (!row.ok) { const warn = node("small", "tm-warn", "Not ready "); warn.append(tip(row.reason || "This route cannot answer right now.", "Why")); parts.push(warn); }
      entry.model.replaceChildren(...parts);
      // The select is kept (and with it any focus): only its options change.
      const options = [["", "Auto"], ...row.levels.map((level) => [level, level === "max" ? maxLabel : LEVEL_WORD[level]])].map(([value, text]) => { const option = node("option", "", text); option.value = value; return option; });
      entry.select.replaceChildren(...options);
      entry.result.replaceChildren(...resultCell(row));
    }
    const offered = row.levels.length > 0;
    entry.select.hidden = !offered; entry.auto.hidden = offered;
    if (entry.select.value !== row.level) entry.select.value = row.level;
    entry.mine.hidden = !row.explicit;
  }
  function resultCell(row) {
    if (row.kind !== "builder") return [node("span", "tm-none", "Not checked by tests")];
    if (!row.result) return [node("span", "tm-none", "No checked results yet")];
    const box = node("div", "tm-res");
    box.append(node("span", "", `${row.result.wins} of ${row.result.settled} passed checks`), bar(row.result.rate, row.result.verdict));
    return [box];
  }
  function bar(rate, verdict) {
    const track = node("span", "tm-bar"), fill = node("i");
    track.setAttribute("aria-hidden", "true");
    fill.dataset.verdict = verdict; fill.style.width = percent(rate);
    track.append(fill);
    return track;
  }

  // ---- the report card ----------------------------------------------------------
  async function loadReport() {
    const serial = ++state.reportSerial, projectId = projectIdOf();
    state.reportBusy = true; state.reportFor = projectId;
    let result = null, error = "";
    try { result = await host("teamReport", { projectId }); } catch (caught) { error = plain(caught, "The report card could not be read."); }
    if (serial !== state.reportSerial) return;
    state.reportBusy = false;
    // A refusal is said once; the next open (or another project) reads again.
    if (result && result.ok === false) { error = plain(result.error, "The report card could not be read."); result = null; }
    state.report = result; state.reportError = error;
    if (state.ui) render();
  }
  const VERDICT_WORDS = Object.freeze({ good: "Good", ok: "OK", weak: "Weak", few: "Too few to tell" });
  const VERDICT_RANK = Object.freeze({ good: 0, ok: 1, weak: 2, few: 3 });
  function dateWords(from, to) {
    const day = (value) => { const date = new Date(Number(value)); return Number.isFinite(date.getTime()) && Number(value) > 0 ? date.toLocaleDateString(undefined, { day: "numeric", month: "short" }) : ""; };
    const first = day(from), last = day(to);
    return first && last ? first === last ? first : `${first} to ${last}` : "";
  }
  // The card is repainted only when something it shows changed, so a draft edit
  // elsewhere on the page leaves its buttons (and the focus on one) alone. The
  // line under it always says how the last Try it, Not now or Stop went.
  function paintReport() {
    const ui = state.ui, body = ui.reportBody;
    say(ui.reportSay, state.flash?.text || "", state.flash?.tone || "");
    const report = state.report;
    const painted = JSON.stringify([report, state.reportError, state.reportBusy, [...state.hidden]]);
    if (state.reportPainted === painted) return;
    state.reportPainted = painted;
    const models = Array.isArray(report?.models) ? report.models.filter(record) : [];
    const checked = Number(report?.checked) || 0;
    const range = dateWords(report?.from, report?.to);
    ui.reportSub.textContent = checked && models.length ? `${count(checked, "checked task")} on this PC${range ? `, ${range}` : ""}.` : "";
    ui.reportSub.hidden = !ui.reportSub.textContent;
    const parts = [];
    if (state.reportError) {
      const again = button("Try again", () => { state.reportError = ""; void loadReport(); });
      const line = node("p", "tm-empty", "The results could not be read. "); line.append(again);
      parts.push(line);
    } else if (!report) parts.push(node("p", "tm-empty", state.reportBusy ? "Reading the results…" : "Results show up here after Studio checks a few coding tasks."));
    else if (!checked || !models.length) parts.push(node("p", "tm-empty", "Results show up here after Studio checks a few coding tasks."));
    else {
      const grid = node("div", "tm-rc"), left = node("div", "tm-rc-models"), right = node("div", "tm-rc-side");
      for (const entry of models) left.append(modelCard(entry));
      const untried = (Array.isArray(report.untried) ? report.untried : []).filter(record);
      if (untried.length) {
        const names = untried.slice(0, 6).map((item) => `${item.name || modelName(item.model, item.cli)} (${viaOf(item.cli, item.model, { builder: true }).name})`);
        const more = untried.length > 6 ? ` and ${untried.length - 6} more` : "";
        left.append(node("p", "tm-untried", `Not tried for coding yet: ${list(names)}${more}.${models.length === 1 ? " Studio has built with one model so far, so it has had nothing to compare." : ""}`));
      }
      const ideas = suggestionsOf(report);
      for (const idea of ideas) right.append(ideaCard(idea));
      if (right.children.length) grid.append(left, right); else { grid.classList.add("tm-rc-one"); grid.append(left); }
      parts.push(grid);
    }
    const routes = routesOf(report);
    if (routes.length) parts.push(routesList(routes));
    body.replaceChildren(...parts);
  }
  function modelCard(entry) {
    const box = node("div", "tm-rc-model");
    const title = node("div", "tm-model"), dot = node("span", "tm-dot"), via = viaOf(entry.provider, entry.model, { builder: true });
    dot.dataset.provider = via.key; dot.setAttribute("aria-hidden", "true");
    title.append(dot, node("b", "", entry.name || modelName(entry.model, entry.provider)), node("span", "tm-pill", `${via.name} · ${Number(entry.settled) || 0} checked`));
    box.append(title);
    const kinds = (Array.isArray(entry.kinds) ? entry.kinds.filter(record) : []).slice().sort((a, b) => (VERDICT_RANK[a.verdict] ?? 3) - (VERDICT_RANK[b.verdict] ?? 3) || (Number(b.rate) || 0) - (Number(a.rate) || 0));
    const skills = node("ul", "tm-skills");
    for (const kind of kinds) {
      const verdict = Object.hasOwn(VERDICT_WORDS, kind.verdict) ? kind.verdict : "few";
      const settled = Number(kind.settled) || 0, wins = Number(kind.wins) || 0, rate = settled ? wins / settled : 0;
      const row = node("li", "tm-skill"); row.dataset.kind = String(kind.taskType || "");
      const words = node("span", "tm-skill-k");
      words.append(node("span", "", kind.label || kind.taskType || "Coding"), node("small", "", `${wins} of ${settled} passed`));
      const said = node("span", "tm-verdict", verdict === "few" ? VERDICT_WORDS.few : `${VERDICT_WORDS[verdict]} · ${percent(rate)}`);
      said.dataset.verdict = verdict;
      row.append(words, bar(rate, verdict), said);
      skills.append(row);
    }
    box.append(skills);
    return box;
  }
  function suggestionsOf(report) {
    const hidden = new Set([...notNow(), ...(state.hidden || [])]);
    return (Array.isArray(report?.suggestions) ? report.suggestions : []).filter((idea) => record(idea) && idea.id && !hidden.has(idea.id) && record(idea.to));
  }
  function ideaCard(idea) {
    const box = node("div", "tm-idea"); box.dataset.suggestion = idea.id;
    box.append(node("b", "tm-idea-title", "Suggestion"), node("p", "", idea.text || `Send ${String(idea.label || "these").toLowerCase()} jobs to ${idea.to.name || modelName(idea.to.model, idea.to.cli)}.`));
    if (idea.detail) box.append(node("small", "", idea.detail));
    const actions = node("div", "tm-actions");
    const tryIt = button("Try it", () => void startTrial(idea, tryIt), "primary mini");
    const later = button("Not now", () => {
      rememberNotNow(idea.id);
      state.flash = { text: "Kept as it is." };
      paintReport();
      state.ui?.reportHeading?.focus?.({ preventScroll: true });
    }, "ghost mini");
    actions.append(tryIt, later);
    box.append(actions);
    return box;
  }
  function routesOf(report) {
    const kinds = record(report?.kinds) ? report.kinds : {};
    return Object.entries(kinds).filter(([, route]) => record(route)).map(([taskType, route]) => ({ taskType, ...route }));
  }
  function routeWords(route) {
    if (record(route.trial)) {
      const size = Math.max(1, Number(route.trial.size) || 5), left = Math.max(0, Math.min(size, Number(route.trial.left) || 0));
      return `trying, ${size - left} of ${size} done`;
    }
    if (record(route.kept)) { const wins = Number(route.kept.wins) || 0, all = wins + (Number(route.kept.losses) || 0); return all ? `kept, it passed ${wins} of ${all}` : "kept"; }
    return route.by === "studio" ? "Studio's pick" : "your pick";
  }
  function routesList(routes) {
    const box = node("div", "tm-routes");
    box.append(node("h3", "tm-routes-title", "Kinds of jobs on another model"));
    const rows = node("ul", "tm-route-list");
    for (const route of routes) {
      const row = node("li", "tm-route"); row.dataset.kind = route.taskType;
      const label = route.label || route.taskType;
      const words = node("span", "tm-route-words", `${label} → ${route.name || modelName(route.model, route.cli)} (${routeWords(route)})`);
      const stop = button("Stop", () => void stopRoute(route, stop), "ghost mini");
      stop.setAttribute("aria-label", `Stop sending ${String(label).toLowerCase()} jobs to ${route.name || modelName(route.model, route.cli)}`);
      row.append(words, stop);
      rows.append(row);
    }
    box.append(rows);
    return box;
  }
  // Try it and Stop apply at once and answer with a fresh report card.
  async function kindRoute(payload, control, done) {
    if (control) control.disabled = true;
    state.flash = { text: "Saving…" };
    if (state.ui) paintReport();
    let result = null;
    try {
      result = await host("teamKindRoute", payload);
      if (!result) throw new Error("This runs in the desktop app.");
      if (result.ok === false) throw new Error(result.error || "That did not work.");
    } catch (error) {
      if (control) control.disabled = false;
      state.flash = { text: plain(error, "That did not work. Try again."), tone: "bad" };
      if (state.ui) paintReport();
      return null;
    }
    if (Array.isArray(result.models)) { state.report = result; state.reportError = ""; state.reportFor = projectIdOf(); } else void loadReport();
    state.flash = { text: done, tone: "good" };
    // The routes are a team field: the draft takes them so Apply keeps them.
    try { await ctx().kindsChanged?.(); } catch { /* the draft stays as it is */ }
    if (state.ui) { render(); state.ui.reportHeading.focus?.({ preventScroll: true }); }
    return result;
  }
  function startTrial(idea, control) {
    const name = idea.to.name || modelName(idea.to.model, idea.to.cli);
    const kind = idea.label ? ` (${String(idea.label).toLowerCase()})` : "";
    return kindRoute({ projectId: projectIdOf(), taskType: idea.taskType, cli: idea.to.cli, model: idea.to.model || "", trial: true }, control,
      `Trying ${name} on the next 5 jobs of this kind${kind}. Studio keeps it only if it does better.`);
  }
  function stopRoute(route, control) {
    return kindRoute({ projectId: projectIdOf(), taskType: route.taskType, clear: true }, control, `${route.label || "That kind of job"} goes back to the usual model.`);
  }

  // ---- how thinking works --------------------------------------------------------
  function paintLadder(thinking) {
    const rungs = [
      ["Light", "Every job starts here."],
      ["Balanced", "After one failed check."],
      ["Stronger model", "After two misses: Flash to Pro, Sonnet to Opus."],
      ["Deep", "The stronger model thinks harder."],
      thinking.askMax ? ["Asks you", "Before Max, the job waits for your OK."] : ["Max", "Only when it is still stuck."],
    ];
    const start = { auto: 0, light: 0, balanced: 1, deep: 3 }[thinking.mode] ?? 0;
    const items = rungs.map(([title, words], index) => {
      const rung = node("li", "tm-rung");
      if (index === start) rung.setAttribute("aria-current", "step");
      if (index === 4 && thinking.askMax) rung.dataset.ask = "true";
      rung.append(node("b", "", title), node("small", "", words));
      return rung;
    });
    state.ui.ladder.dataset.climb = thinking.climb ? "on" : "off";
    state.ui.ladder.replaceChildren(...items);
  }

  // ---- logins (the Seats chip and Providers share them) ---------------------------
  async function loadAccounts() {
    const serial = ++state.accountsSerial;
    state.accountsBusy = true;
    let result = null;
    try { result = await host("cliAccounts"); } catch { result = null; }
    if (serial !== state.accountsSerial) return;
    state.accountsBusy = false;
    state.accounts = record(result) ? result : { ok: false, providers: [] };
    if (state.ui) render();
    if (prov.ui) paintLogins();
  }

  // The place opened: the report card and the logins are read again (unless a
  // read for this project is already on its way, as on the first visit).
  function open() {
    state.flash = null;
    if (!(state.reportBusy && state.reportFor === projectIdOf())) void loadReport();
    if (!state.accountsBusy) void loadAccounts();
  }

  // ---- Providers ------------------------------------------------------------------
  const SUBSCRIPTIONS = Object.freeze(["claude", "codex", "grok", "antigravity"]);
  const prov = { root: null, ctx: null, ui: null, cli: null, cliBusy: false, cliSerial: 0, pick: "", checked: {} };
  function say(line, text, tone = "") {
    line.textContent = String(text || "");
    if (tone) line.dataset.tone = tone; else delete line.dataset.tone;
  }
  // Runs a host call with its controls held, and says how it went in `line`.
  async function act(controls, line, call, done) {
    const held = (Array.isArray(controls) ? controls : [controls]).filter(Boolean);
    for (const control of held) control.disabled = true;
    say(line, "Working…");
    try {
      const result = await call();
      if (!result) throw new Error("This runs in the desktop app.");
      if (result.ok === false) throw new Error(result.error || "That did not work.");
      say(line, typeof done === "function" ? done(result) : done, "good");
      return result;
    } catch (error) {
      say(line, plain(error, "That did not work. Try again."), "bad");
      return null;
    } finally {
      for (const control of held) control.disabled = false;
    }
  }
  function providers(root, context = {}) {
    if (!root) return;
    prov.ctx = context;
    if (prov.root === root) { paintProviders(); return; }
    prov.root = root;
    root.classList.add("tm-providers");
    const ui = prov.ui = {};
    // Use one provider for everything (setup-helper.js "Use for the whole studio").
    const one = panel("team-one-provider", "Use one provider for everything", "Chat, planning and reviews, every seat (lead, desk, scout, companion and overseer), the coding workers and subtask builders all run on it, and Studio calls nothing else. It sets the Studio defaults and this project's own team, and you choose each model yourself from then on. The tool's own usage limits still apply.");
    one.box.append(node("p", "tm-sub", "Chat, planning, every seat and the coding workers."));
    const row = node("div", "tm-inline");
    ui.pick = node("select", "tm-select"); ui.pick.id = "team-one-provider-pick"; ui.pick.setAttribute("aria-label", "Provider for everything");
    ui.pick.addEventListener("change", () => { prov.pick = ui.pick.value; say(ui.oneSay, ""); paintOne(); });
    ui.state = node("span", "tm-pill");
    ui.check = button("Check", () => void checkOne(), "ghost");
    ui.use = button("Use for everything", () => void useOne(), "primary");
    ui.use.title = "Sets chat, planning, every seat and the coding workers to this tool";
    ui.fix = button("", () => void fixOne(), "ghost");
    row.append(ui.pick, ui.state, ui.check, ui.use, ui.fix);
    ui.oneSay = node("p", "tm-say"); ui.oneSay.setAttribute("role", "status");
    one.box.append(row, ui.oneSay);
    // Your subscriptions (setup-helper.js "More than one login").
    const subs = panel("team-subscriptions", "Your subscriptions", "Have two Claude or ChatGPT subscriptions? Add the other login here. Studio uses one login until it hits its usage limit, moves to the next, and goes back when the limit resets. Other providers answer only once every login is topped out.");
    subs.box.tabIndex = -1;
    ui.subs = subs.box;
    ui.logins = node("div", "tm-login-groups");
    ui.loginSay = node("p", "tm-say"); ui.loginSay.setAttribute("role", "status");
    subs.box.append(ui.logins, ui.loginSay);
    const grid = node("div", "tm-provider-grid");
    grid.append(one.box, subs.box);
    root.replaceChildren(grid);
    searchable(ui.pick.id, "Use one provider for everything", "Chat, planning, every seat and the coding workers on one subscription.", "providers");
    searchable(subs.box.id, "Your subscriptions", "More than one Claude or ChatGPT login: Studio moves to the next when one hits its limit.", "providers");
    paintProviders();
  }
  function cliChoices() {
    const clis = prov.cli?.ok && Array.isArray(prov.cli.clis) ? prov.cli.clis.filter(record) : null;
    if (!clis) return SUBSCRIPTIONS.map((id) => ({ id, name: TOOLS[id], installed: false, signedIn: null, unknown: true }));
    return clis.filter((cli) => cli.subscription === true || cli.subscription === undefined && SUBSCRIPTIONS.includes(cli.id)).map((cli) => ({ ...cli, name: cli.name || TOOLS[cli.id] || cli.id }));
  }
  function paintProviders() {
    if (!prov.ui) return;
    paintOne();
    paintLogins();
  }
  function paintOne() {
    const ui = prov.ui, clis = cliChoices();
    if (!clis.some((cli) => cli.id === prov.pick)) {
      const executor = draftOf()?.configuration?.executorCli;
      prov.pick = (clis.find((cli) => cli.id === executor && cli.installed) || clis.find((cli) => cli.installed && cli.signedIn !== false) || clis.find((cli) => cli.installed) || clis[0])?.id || "";
    }
    const signature = JSON.stringify(clis.map((cli) => [cli.id, cli.name, cli.installed, cli.signedIn]));
    if (ui.pick.dataset.signature !== signature) {
      ui.pick.dataset.signature = signature;
      ui.pick.replaceChildren(...clis.map((cli) => { const option = node("option", "", `${cli.name}${cli.unknown ? "" : cli.installed ? cli.signedIn === false ? " · not signed in" : "" : " · not installed"}`); option.value = cli.id; return option; }));
    }
    if (ui.pick.value !== prov.pick) ui.pick.value = prov.pick;
    const cli = clis.find((item) => item.id === prov.pick) || { id: prov.pick, installed: false, unknown: true };
    const checked = Boolean(prov.checked[cli.id]);
    ui.state.textContent = cli.unknown ? (prov.cliBusy ? "Checking…" : "Desktop app only") : !cli.installed ? "Not installed" : cli.signedIn === false ? "Not signed in" : checked ? "Answered" : "Installed";
    ui.state.dataset.tone = checked ? "good" : !cli.installed || cli.signedIn === false ? "warn" : "";
    ui.pick.disabled = cli.unknown && !prov.cliBusy && !prov.cli;
    ui.check.disabled = !cli.installed;
    ui.use.disabled = !cli.installed || !checked;
    ui.fix.hidden = cli.unknown || (cli.installed && cli.signedIn !== false);
    ui.fix.textContent = cli.installed ? "Sign in" : "Set it up";
  }
  async function readCli() {
    const serial = ++prov.cliSerial;
    prov.cliBusy = true; if (prov.ui) paintOne();
    let result = null;
    try { result = await host("cliSetupStatus"); } catch { result = null; }
    if (serial !== prov.cliSerial) return;
    prov.cliBusy = false; prov.cli = record(result) ? result : null;
    if (prov.ui) paintOne();
  }
  async function checkOne() {
    const id = prov.pick, ui = prov.ui, name = TOOLS[id] || id;
    const result = await act([ui.check, ui.pick], ui.oneSay, () => host("cliSetupCheck", id), (reply) => reply?.message || `${name} answered.`);
    prov.checked = { ...prov.checked, [id]: Boolean(result) };
    paintOne();
  }
  async function useOne() {
    const id = prov.pick, ui = prov.ui, name = TOOLS[id] || id;
    if (!prov.checked[id]) return;
    const result = await act([ui.use, ui.check, ui.pick], ui.oneSay, () => host("cliSetupUse", id), (reply) => reply?.message || `${name} now runs the studio.`);
    paintOne();
    if (!result) return;
    dispatch("mefi:connection-saved", { which: id });
    // The team changed on the host: a draft without edits is read again.
    try { ctx().reload?.(); } catch { /* the team page reads it when it opens */ }
  }
  async function fixOne() {
    const id = prov.pick, cli = cliChoices().find((item) => item.id === id);
    if (cli?.installed) {
      await act(prov.ui.fix, prov.ui.oneSay, () => host("cliSetupAction", { id, action: "login" }), (reply) => reply?.message || "Sign-in opened. Finish it in the window, then press Check.");
      setTimeout(() => void readCli(), 1500);
      return;
    }
    // Installing is the setup helper's guided flow.
    if (window.MefiSetupHelper?.open) window.MefiSetupHelper.open("providers");
    else say(prov.ui.oneSay, "Install it from the setup guide, then press Check.");
  }
  function loginState(account) {
    return account.limited ? `Topped out until ${account.untilText || "its reset"}` : account.answering ? "Answering now" : "Ready, next in line";
  }
  function paintLogins() {
    const ui = prov.ui; if (!ui) return;
    const focusInside = Boolean(document.activeElement && ui.logins.contains?.(document.activeElement));
    const result = state.accounts;
    if (result === null) { ui.logins.replaceChildren(node("p", "tm-empty", "Reading your logins…")); return; }
    const groups = (result.ok ? result.providers || [] : []).filter((provider) => record(provider) && (provider.installed || (provider.accounts || []).length > 1));
    if (!groups.length) {
      const line = node("p", "tm-empty", "No Claude Code or Codex sign-in on this PC yet. ");
      if (window.MefiSetupHelper?.open) line.append(button("Set one up", () => window.MefiSetupHelper.open("providers")));
      ui.logins.replaceChildren(line);
      return;
    }
    const after = async () => { await loadAccounts(); };
    const made = groups.map((provider) => {
      const group = node("div", "tm-login-group");
      group.append(node("h3", "tm-login-title", provider.name || TOOLS[provider.id] || provider.id));
      const rows = node("ul", "tm-logins");
      for (const account of (provider.accounts || []).filter(record)) {
        const row = node("li", "tm-login"); row.dataset.state = account.limited ? "limited" : account.answering ? "answering" : "ready"; row.dataset.account = account.id;
        const words = node("span", "tm-login-words");
        words.append(node("b", "", account.label || "Login"), node("small", "", loginState(account)));
        const actions = node("span", "tm-actions");
        const signIn = button("Sign in", async () => { await act(signIn, ui.loginSay, () => host("cliAccountLogin", account.id), (reply) => reply?.message || "Sign-in window opened."); }, "ghost mini");
        const check = button("Check", async () => { const done = await act(check, ui.loginSay, () => host("cliAccountCheck", account.id), (reply) => reply?.message || `${account.label} answered.`); if (done) await after(); }, "ghost mini");
        signIn.setAttribute("aria-label", `Sign in to ${provider.name} ${account.label}`); check.setAttribute("aria-label", `Check ${provider.name} ${account.label}`);
        actions.append(signIn, check);
        if (!account.main) {
          // Removing a login deletes its sign-in on this PC: a second press confirms.
          const remove = async () => { const done = await act(null, ui.loginSay, () => host("cliAccountRemove", account.id), (reply) => reply?.message || `${account.label} removed.`); if (done) await after(); };
          const control = button("Remove", window.MefiUi?.arm ? () => {} : remove, "ghost mini");
          control.setAttribute("aria-label", `Remove ${provider.name} ${account.label}`);
          actions.append(window.MefiUi?.arm ? window.MefiUi.arm(control, { run: remove, armed: "Remove this login?" }) : control);
        }
        row.append(words, actions);
        rows.append(row);
      }
      group.append(rows);
      if ((provider.accounts || []).length < (Number(provider.max) || 6)) {
        const add = button(`Add another ${provider.name || TOOLS[provider.id]} login`, async () => {
          const added = await act(add, ui.loginSay, () => host("cliAccountAdd", { provider: provider.id, label: "" }), (reply) => `${reply?.account?.label || "The login"} added. Sign in with the other account in the window that opens.`);
          if (added?.account?.id) await act(null, ui.loginSay, () => host("cliAccountLogin", added.account.id), (reply) => reply?.message || "Sign-in window opened.");
          await after();
        }, "ghost");
        group.append(add);
      }
      return group;
    });
    ui.logins.replaceChildren(...made);
    if (focusInside) ui.subs.focus?.({ preventScroll: true });
  }
  // Providers opened: the coding tools and the logins are read again.
  function openProviders() {
    if (!prov.cliBusy) void readCli();
    if (!state.accountsBusy) void loadAccounts();
  }

  window.MefiTeamModels = {
    mount, render, open, providers, openProviders, tip,
    // The words and rows, for tests and for whoever lists models elsewhere.
    modelName, viaOf, goodFor, jobRows, thinkingOf, nowSentences, ledgerKey, JOBS,
  };
})();
