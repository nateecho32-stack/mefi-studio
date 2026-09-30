// Vibe's live view of its long waits (window.MefiVibeFlow): the planner
// looking for next steps (MEFI's Suggest a next step, planning:explore) and
// the lead sizing a request (Build it, vibe:build). Both can take a minute,
// and before this they showed one still sentence.
//
// A run is one such wait. vibe.js starts it, passes its id with the host call,
// and the host pushes each step it takes on vibe:progress (main.cjs
// vibeProgress, scripts/planning-service.cjs): reading, read and asking for
// the planner; quick, sizing, tool, sized and adding for sizing. The call's
// own reply ends the run. Every stage shown is one the host reported; the
// only local reckoning is the clock and "usually about 20 s", which come from
// this machine's own finished runs (localStorage, last seven of each kind).
//
// Each run has one view element, built once and updated in place, so a push
// never replays an entrance: a caller places view(run) where it belongs and
// leaves it there. Clocks tick once a second while one is on the page. The
// Team panel lists the runs still going (active()), and on() hears every
// change. Without the host's steps (an older host) a run still shows its
// clock and first stage; without layout (the tests' fake DOM) nothing ticks.
(function () {
  "use strict";
  const TIMES_KEY = "mefiStudio.vibe.flowTimes";
  const KINDS = { explore: ["reading", "read", "asking"], size: ["quick", "sizing", "tool", "sized", "adding"] };
  const now = () => Date.now();
  const clip = (value, max) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = String(text); return node; };
  // The tests' stand-in elements have a plain style object.
  const setVar = (node, name, value) => { try { node.style.setProperty(name, value); } catch { /* no CSSOM */ } };
  const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

  // ---- names --------------------------------------------------------------------
  const PROVIDERS = { zen: "OpenCode Zen", opencode: "OpenCode", claude: "Claude Code", codex: "Codex", grok: "Grok", antigravity: "Antigravity", zai: "Z.ai", openrouter: "OpenRouter", lmstudio: "LM Studio", ollama: "Ollama", anthropic: "Anthropic", openai: "OpenAI", gemini: "Gemini", deepseek: "DeepSeek", custom: "your own endpoint" };
  // The coding tools a worker runs in (executor routes).
  const TOOLS = { opencode: "OpenCode", claude: "Claude Code", codex: "Codex", grok: "Grok", antigravity: "Antigravity" };
  let catalog = null;
  function modelName(id) {
    const raw = clip(typeof id === "string" ? id : "", 120);
    if (!raw) return "";
    if (!catalog) {
      catalog = new Map();
      try {
        const data = JSON.parse(document.getElementById("booklet-data")?.textContent || "{}");
        for (const model of Array.isArray(data.models) ? data.models : []) if (model?.id && model.name) catalog.set(String(model.id), String(model.name));
      } catch { /* the words below */ }
    }
    const bare = raw.replace(/^.*\//, "");
    if (catalog.get(raw) || catalog.get(bare)) return catalog.get(raw) || catalog.get(bare);
    // gpt-6-luna → GPT 6 Luna, deepseek-v4.1-flash → Deepseek V4.1 Flash
    return bare.split(/[-_\s]+/).filter(Boolean).map((part) => (/^(gpt|glm|ai|api|ui)$/i.test(part) ? part.toUpperCase() : /^v?\d/i.test(part) ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1))).join(" ");
  }
  const providerName = (id) => PROVIDERS[id] || (typeof id === "string" && id && id !== "auto" ? id[0].toUpperCase() + id.slice(1) : "");
  // Who is thinking, in a word or two: the model, or its tool when it runs the tool's default.
  const who = (seen) => (seen ? modelName(seen.model) || providerName(seen.provider) : "");
  const toolName = (route) => TOOLS[route] || providerName(route);

  // ---- how long a run usually takes ---------------------------------------------------
  function readTimes() {
    try { const parsed = JSON.parse(localStorage.getItem(TIMES_KEY) || "{}"); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; }
  }
  function remember(kind, ms) {
    if (!(ms > 500) || ms > 30 * 60000) return;
    const times = readTimes();
    times[kind] = [...(Array.isArray(times[kind]) ? times[kind] : []), Math.round(ms)].slice(-7);
    try { localStorage.setItem(TIMES_KEY, JSON.stringify(times)); } catch { /* private store */ }
  }
  // The median of this machine's recent runs, once there are two of them.
  function typical(kind) {
    const list = (readTimes()[kind] || []).filter((ms) => Number.isFinite(ms) && ms > 0).sort((a, b) => a - b);
    return list.length >= 2 ? list[Math.floor(list.length / 2)] : null;
  }
  const seconds = (ms) => Math.max(0, Math.round(ms / 1000));
  const clock = (ms) => { const total = seconds(ms); return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`; };
  const roughly = (ms) => (ms >= 90000 ? `${Math.round(ms / 60000)} min` : `${Math.max(5, Math.round(ms / 5000) * 5)} s`);
  const took = (ms) => (ms < 60000 ? `${seconds(ms)} s` : `${Math.floor(ms / 60000)} min ${seconds(ms % 60000)} s`);

  // ---- runs -------------------------------------------------------------------------
  const runs = new Map();
  const views = new Map();
  const listeners = new Set();
  function emit(run) {
    for (const listener of [...listeners]) {
      try { listener(run); } catch (error) { console.error(error); }
    }
  }
  // Finished runs linger ten minutes (a view may still be settling), and only
  // the newest two dozen are kept.
  function prune() {
    const cutoff = now() - 10 * 60000;
    for (const [id, run] of runs) if (run.endedAt && run.endedAt < cutoff) { runs.delete(id); views.delete(id); }
    while (runs.size > 24) { const [id] = runs.keys(); runs.delete(id); views.delete(id); }
  }
  function begin(kind, { projectId = null, title = "" } = {}) {
    if (!KINDS[kind]) return null;
    prune();
    const startedAt = now();
    const run = { id: `vibe-${kind}-${startedAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, kind, projectId, title: clip(title, 120), startedAt, stage: "start", seen: {}, tools: [], endedAt: null, outcome: null };
    runs.set(run.id, run);
    emit(run);
    return run;
  }
  // Only what the page can show is kept from a push, trimmed to size.
  function facts(payload) {
    const out = {};
    if (Number.isFinite(payload.scanned)) out.scanned = Math.max(0, Math.round(payload.scanned));
    if (Array.isArray(payload.files)) out.files = payload.files.filter((file) => typeof file === "string").map((file) => clip(file, 200)).filter(Boolean).slice(0, 8);
    for (const key of ["seat", "provider", "model", "verdict", "reason", "size", "why"]) if (typeof payload[key] === "string") out[key] = clip(payload[key], 120);
    if (typeof payload.cli === "boolean") out.cli = payload.cli;
    if (typeof payload.summary === "string") out.summary = clip(payload.summary, 400);
    if (Array.isArray(payload.steps)) out.steps = payload.steps.slice(0, 6).map((step) => ({ title: clip(step?.title, 90) || "A step", after: (Array.isArray(step?.after) ? step.after : []).filter(Number.isInteger).slice(0, 6) }));
    return out;
  }
  function event(payload) {
    const run = payload && typeof payload === "object" ? runs.get(payload.requestId) : null;
    if (!run || run.endedAt || !KINDS[run.kind].includes(payload.stage)) return false;
    if (payload.projectId && run.projectId && payload.projectId !== run.projectId) return false;
    const at = Number(payload.at) || now();
    if (payload.stage === "tool") run.tools = [...run.tools, { name: clip(String(payload.name ?? ""), 80), ok: payload.ok === true, at }].slice(-6);
    else run.seen[payload.stage] = { ...facts(payload), at };
    run.stage = payload.stage;
    refresh(run);
    emit(run);
    return true;
  }
  function end(id, { ok = true, error = "", count = null, steps = null } = {}) {
    const run = runs.get(id);
    if (!run || run.endedAt) return run || null;
    run.endedAt = now();
    run.outcome = { ok: ok !== false, error: clip(error, 300), count: Number.isFinite(count) ? count : null, steps: Number.isFinite(steps) ? steps : null };
    // A request sized without a model call says nothing about how long one
    // takes, and nor does a sizing that failed or timed out.
    if (run.outcome.ok && (run.kind === "explore" || (run.seen.sizing && run.seen.sized?.size !== "kept"))) remember(run.kind, run.endedAt - run.startedAt);
    refresh(run);
    emit(run);
    return run;
  }
  const get = (id) => runs.get(id) || null;
  const active = (projectId) => [...runs.values()].filter((run) => !run.endedAt && (!projectId || !run.projectId || run.projectId === projectId));
  function on(listener) { if (typeof listener === "function") listeners.add(listener); return () => listeners.delete(listener); }

  // ---- what a run has done, stage by stage ------------------------------------------------
  const TOOL_WORDS = { web_search: "searched the web", web_read: "read a web page", project_read: "read a file" };
  // Why sizing kept a request one card when the lead did not choose that
  // (main.cjs vibeBuild's sized step, size "kept"): never "Best as one task".
  const KEPT = { timeout: "The lead took too long, so it's one task", "no-answer": "No lead model answered, so it's one task", "too-many": "The plan had too many steps, so it's one task" };
  const KEPT_LINE = "Couldn't plan steps, so it's one task";
  const keptText = (sized) => KEPT[sized?.why] || KEPT_LINE;
  const toolWords = (run) => [...new Set(run.tools.map((tool) => TOOL_WORDS[tool.name] || (tool.name.startsWith("mcp__") ? `used ${tool.name.split("__").pop().replace(/_/g, " ")}` : "used a tool")))].join(" · ");
  function readText(read) {
    const files = read.files?.length ?? 0;
    const found = files ? `${plural(files, "file")} look${files === 1 ? "s" : ""} relevant` : "no file stood out";
    return read.scanned ? `${read.scanned} files scanned · ${found}` : found;
  }
  function stages(run) {
    const seen = run.seen, out = run.outcome;
    const done = Boolean(out?.ok), failed = Boolean(out && !out.ok);
    let list;
    if (run.kind === "explore") {
      const { read, asking } = seen;
      list = [
        { key: "read", label: "Read the project", state: read || asking || done ? "done" : "now", detail: read ? readText(read) : "Finding the files that matter" },
        { key: "think", label: "Think it over", state: done ? "done" : read || asking ? "now" : "next", detail: asking ? `${who(asking) || "The model"} ${done ? "answered" : "is thinking"}` : read ? "Choosing a model" : "" },
        { key: "suggest", label: "Suggest next steps", state: done ? "done" : "next", detail: done ? (out.count ? plural(out.count, "idea") : "Nothing new this time") : "Up to three, with reasons" },
      ];
    } else {
      const { quick, sizing, sized, adding } = seen;
      const single = quick?.verdict === "one";
      const split = sized?.size === "steps" ? sized.steps.length : 0;
      const tools = run.tools.length ? toolWords(run) : "";
      list = [
        { key: "look", label: "Take a look", state: quick || done ? "done" : "now", detail: quick ? (single ? "One change, no split needed" : "Big enough to plan in steps") : "Reading your request" },
        { key: "split", label: "Plan the steps", state: single ? "skipped" : sized || adding || done ? "done" : sizing ? "now" : "next",
          detail: single ? "Not needed" : sized ? (split ? `${plural(split, "step")}, then a final check` : sized.size === "kept" ? keptText(sized) : "Best as one task") : sizing ? [`${who(sizing) || "The lead"} is splitting it`, tools].filter(Boolean).join(" · ") : "" },
        { key: "board", label: "Put it on the board", state: done ? "done" : adding ? "now" : "next", detail: done ? (out.steps ? `${plural(out.steps, "step")} and a final check` : "One task") : adding ? "Adding it" : "" },
      ];
    }
    if (failed) {
      const at = list.find((stage) => stage.state === "now") || [...list].reverse().find((stage) => stage.state !== "skipped");
      if (at) { at.state = "failed"; at.detail = out.error || "It stopped here"; }
    }
    return list;
  }
  function headline(run) {
    const out = run.outcome;
    if (run.kind === "explore") return !out ? "Mefi is looking for next steps" : !out.ok ? "Mefi couldn't finish looking" : out.count ? `Found ${plural(out.count, "next step")}` : "Nothing new to suggest";
    const sized = run.seen.sized;
    if (out) return !out.ok ? "Sizing stopped" : out.steps ? `Split into ${plural(out.steps, "step")}` : sized?.size === "kept" ? KEPT_LINE : "Added as one task";
    return sized?.size === "steps" ? `Splitting it into ${plural(sized.steps.length, "step")}` : "Mefi is sizing your request";
  }
  // One line for the Team panel and the page's status: the stage now running.
  function line(run) {
    const current = stages(run).find((stage) => stage.state === "now" || stage.state === "failed");
    return current ? [current.label, current.detail].filter(Boolean).join(": ") : headline(run);
  }

  // ---- the view ---------------------------------------------------------------------
  function view(run) {
    if (!run) return null;
    let root = views.get(run.id);
    if (!root) { root = build(run); views.set(run.id, root); }
    update(root, run);
    return root;
  }
  function refresh(run) { const root = views.get(run.id); if (root) update(root, run); }
  function build(run) {
    const root = el("section", `vibe-flow-run is-${run.kind}`);
    root.dataset.run = run.id;
    // Keyed, so a menu repainting around it (MefiMotion.keep) keeps it still.
    root.dataset.key = `run:${run.id}`;
    root.setAttribute("aria-label", run.kind === "explore" ? "Mefi looking for next steps" : "Mefi sizing your request");
    // Continuous motion runs off the page clock, so every view spins in step.
    setVar(root, "--flow-phase", `-${now() % 2400}ms`);
    const head = el("div", "vibe-flow-head");
    const spark = el("span", "vibe-flow-spark");
    spark.setAttribute("aria-hidden", "true");
    spark.append(el("i"), el("i"), el("i"));
    const title = el("b", "vibe-flow-title");
    title.setAttribute("role", "status");
    const time = el("span", "vibe-flow-time");
    time.setAttribute("aria-hidden", "true");
    time.append(el("span", "vibe-flow-clock"), el("span", "vibe-flow-usual"));
    head.append(spark, title, time);
    const track = el("ol", "vibe-flow-stages");
    for (const stage of stages(run)) {
      const item = el("li", "vibe-flow-stage");
      item.dataset.stage = stage.key;
      const words = el("span", "vibe-flow-words");
      words.append(el("b", "", stage.label), el("small"));
      item.append(el("i", "vibe-flow-node"), words);
      track.append(item);
    }
    const extra = el("div", "vibe-flow-extra");
    const slow = el("p", "vibe-flow-slow", run.kind === "explore" ? "Taking longer than usual. It keeps going on its own, and the rest of Studio stays yours." : "Taking longer than usual. If the lead doesn't answer, your request goes on as one task.");
    slow.hidden = true;
    const actions = el("div", "vibe-flow-actions");
    root.append(head, track, extra, slow, actions);
    return root;
  }
  function update(root, run) {
    const out = run.outcome;
    root.dataset.state = !out ? "running" : out.ok ? "done" : "failed";
    root.querySelector(".vibe-flow-title").textContent = headline(run);
    const face = root.querySelector(".vibe-flow-clock");
    const usual = root.querySelector(".vibe-flow-usual");
    const expect = typical(run.kind);
    if (!out) {
      face.dataset.flowSince = String(run.startedAt);
      // Late is well past this machine's usual time, or a minute without one.
      face.dataset.flowSlowAfter = String(run.startedAt + (expect ? Math.max(expect * 1.8, expect + 20000) : run.kind === "explore" ? 75000 : 50000));
      face.textContent = clock(now() - run.startedAt);
      usual.textContent = expect ? `usually about ${roughly(expect)}` : "";
      tick();
    } else {
      delete face.dataset.flowSince;
      delete face.dataset.flowSlowAfter;
      face.textContent = took(run.endedAt - run.startedAt);
      usual.textContent = "";
      root.dataset.slow = "no";
      root.querySelector(".vibe-flow-slow").hidden = true;
    }
    const list = stages(run);
    const items = root.querySelectorAll(".vibe-flow-stage");
    for (const [index, stage] of list.entries()) {
      const item = items[index];
      if (!item) continue;
      item.className = `vibe-flow-stage is-${stage.state}`;
      item.querySelector("small").textContent = stage.detail;
      item.setAttribute("aria-label", `${stage.label}: ${stage.state === "now" ? "in progress" : stage.state === "next" ? "next" : stage.state}${stage.detail ? `. ${stage.detail}` : ""}`);
    }
    const extra = root.querySelector(".vibe-flow-extra");
    if (run.kind === "explore") files(extra, run.seen.read?.files ?? []);
    else steps(extra, run.seen.sized?.steps ?? []);
  }
  // The files the planner read, each arriving once, in order.
  function files(extra, list) {
    let row = extra.querySelector(".vibe-flow-files");
    if (!list.length) { if (row) row.remove(); return; }
    if (!row) { row = el("div", "vibe-flow-files"); row.setAttribute("aria-label", "Files Mefi is reading"); extra.append(row); }
    const have = new Set([...row.querySelectorAll(".vibe-flow-file")].map((chip) => chip.dataset.file));
    for (const [index, file] of list.entries()) {
      if (have.has(file)) continue;
      const chip = el("code", "vibe-flow-file", file.split("/").pop());
      chip.dataset.file = file;
      chip.title = file;
      setVar(chip, "--i", String(index));
      row.append(chip);
    }
  }
  // The steps the lead planned, as they will go on the board.
  function steps(extra, list) {
    let box = extra.querySelector(".vibe-flow-steps");
    if (!list.length) { if (box) box.remove(); return; }
    if (!box) { box = el("ol", "vibe-flow-steps"); box.setAttribute("aria-label", "The planned steps"); extra.append(box); }
    const count = [...box.querySelectorAll(".vibe-flow-step")].filter((item) => !item.classList.contains("is-final")).length;
    for (const [index, step] of list.entries()) {
      if (index < count) continue;
      const item = el("li", "vibe-flow-step");
      setVar(item, "--i", String(index));
      item.append(el("span", "vibe-flow-step-n", String(index + 1)), el("span", "vibe-flow-step-title", step.title));
      if (step.after.length) item.append(el("small", "", `after ${step.after.map((at) => at + 1).join(" and ")}`));
      box.append(item);
    }
    if (!box.querySelector(".vibe-flow-step.is-final")) {
      const final = el("li", "vibe-flow-step is-final");
      setVar(final, "--i", String(list.length));
      final.append(el("span", "vibe-flow-step-n", "✓"), el("span", "vibe-flow-step-title", "Then: put it together and check the whole thing"));
      box.append(final);
    } else box.append(box.querySelector(".vibe-flow-step.is-final"));
  }
  // A button under a finished run (Show the plan), replacing any before it.
  function action(run, { label, run: act } = {}) {
    const root = run ? views.get(run.id) : null;
    const holder = root?.querySelector(".vibe-flow-actions");
    if (!holder) return null;
    holder.replaceChildren();
    if (!label || typeof act !== "function") return null;
    const button = el("button", "vibe-ask-link vibe-flow-action", label);
    button.type = "button";
    button.addEventListener("click", () => act());
    holder.append(button);
    return button;
  }

  // Placeholder cards where the suggestions will land.
  function skeleton(count = 3) {
    const grid = el("div", "vibe-evolution-suggestions vibe-flow-skeleton");
    grid.setAttribute("aria-hidden", "true");
    for (let index = 0; index < count; index += 1) {
      const card = el("div", "vibe-flow-ghost");
      setVar(card, "--i", String(index));
      card.append(el("i"), el("i"), el("i"), el("i"));
      grid.append(card);
    }
    return grid;
  }

  // What a worker is doing now: its tool and its current step or last output.
  function doing(job) {
    if (!job || typeof job !== "object") return { tool: "", step: "" };
    return { tool: toolName(job.route), step: clip(job.currentStep || job.activity || "", 140) };
  }

  // ---- clocks -------------------------------------------------------------------------
  // One timer for every clock on the page, alive only while one is.
  let timer = 0;
  function paintClocks() {
    const at = now();
    for (const face of document.querySelectorAll?.("[data-flow-since]") ?? []) {
      const since = Number(face.dataset.flowSince);
      if (!since) continue;
      face.textContent = clock(at - since);
      const root = face.closest?.(".vibe-flow-run");
      const late = Number(face.dataset.flowSlowAfter);
      if (!root || !late) continue;
      const slow = at > late;
      if ((root.dataset.slow === "yes") === slow) continue;
      root.dataset.slow = slow ? "yes" : "no";
      const note = root.querySelector(".vibe-flow-slow");
      if (note) note.hidden = !slow;
    }
  }
  function tick() {
    if (timer || typeof setTimeout !== "function") return;
    timer = setTimeout(function step() {
      timer = 0;
      if (!document.hidden) paintClocks();
      if (document.querySelector?.("[data-flow-since]")) timer = setTimeout(step, 1000) || 0;
    }, 1000) || 0;
  }

  // The host's steps arrive here once, for every view and listener.
  window.mefiStudio?.onVibeProgress?.((payload) => { event(payload); });

  window.MefiVibeFlow = { begin, event, end, get, active, on, stages, headline, line, typical, view, action, skeleton, doing, modelName, providerName, toolName, who, took };
})();
