"use strict";
// The Agent Brain's host side (docs/roadmap-0.4.0.md, M1-M9): one object the
// main process calls at the moments it already knows about (a run is being
// prepared, it started, it spoke, it finished, the board was written, files
// were read), which turns those moments into work events, per-task pipelines,
// Playbook records, the project map, desk answers and the companion's state.
// main.cjs keeps one-line hooks; everything with a rule in it lives here or in
// the pure modules it composes, so the rules are testable without Electron.
//
// Every entry point is per project: the caller's project context decides which
// data files are read (dataFile resolves through projects.dataPath), and the
// state for each project is kept apart. Nothing here may fail the caller: each
// hook swallows its own errors and logs one line.

const path = require("node:path");
const fsp = require("node:fs/promises");

const LIMITS = Object.freeze({
  recentEvents: 400,
  pipelinesKept: 300,
  deskPerHour: 30,
  deskFoldMs: 24 * 3600 * 1000,
  helpsPerRun: 3,
  draftsPerHour: 10,
  indexMaxBytes: 2 * 1024 * 1024,
  indexKeepLines: 4000,
  decisionsKept: 200,
  mapDelayMs: 5000,
  saveDelayMs: 800,
  seenSaveMs: 30 * 1000,
  greetingMs: 20 * 1000,
  historyMs: 10 * 60 * 1000,
});

const REPORT_MARK = "MEFI_REPORT:";
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;

// A sub-agent's note for its parent. Anchored like the other marks, so prose
// that quotes the protocol never counts.
function parseReportLine(line) {
  const flat = String(line ?? "").replace(ANSI, "").trim();
  if (!flat.startsWith(REPORT_MARK)) return null;
  const text = flat.slice(REPORT_MARK.length).replace(/\s+/g, " ").trim().slice(0, 300);
  return text ? { text } : null;
}

// What a result line says, as one short sentence for the parent's report.
function resultText(note) {
  if (!note) return "";
  const parts = note.parts ?? {};
  const done = parts.done || parts.result || "";
  return String(done || note.raw || "").replace(/\s+/g, " ").trim().slice(0, 300);
}

// The board never writes "failed" or "parked": a child that ran out of tries
// is an open card out of verification budget, past five failures, or parked.
function childStatus(task) {
  const status = task?.status;
  if (status === "done") return "done";
  if (status === "active" || status === "running" || status === "awaiting_verification") return "active";
  if (status === "parked" || status === "failed" || task?.verification?.state === "failed" || Number(task?.runFailures) >= 5 || task?.parkedAt) return "failed";
  return "open";
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

// Temps an earlier process left behind (killed mid-write, or a refused
// rename) are cleared once per file, on its first write in this process.
const sweptTemps = new Set();
async function sweepTemps(file) {
  if (sweptTemps.has(file)) return;
  sweptTemps.add(file);
  const dir = path.dirname(file), base = `${path.basename(file)}.`;
  const names = await fsp.readdir(dir).catch(() => []);
  for (const name of names.filter((entry) => entry.startsWith(base) && /^\d+\.tmp$/.test(entry.slice(base.length)))) {
    const temp = path.join(dir, name);
    // A minute's grace: another Studio sharing this folder may be mid-write.
    const info = await fsp.stat(temp).catch(() => null);
    if (info && Date.now() - info.mtimeMs > 60000) await fsp.rm(temp, { force: true }).catch(() => {});
  }
}

async function writeJsonAtomic(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await sweepTemps(file);
  const text = `${JSON.stringify(value, null, 2)}\n`;
  const temp = `${file}.${process.pid}.tmp`;
  try {
    await fsp.writeFile(temp, text, "utf8");
    try {
      await fsp.rename(temp, file);
    } catch (error) {
      // Windows refuses a rename over a file another process holds open
      // (OneDrive, a scanner). Write in place rather than lose the save.
      if (!["EPERM", "EBUSY", "EACCES"].includes(error?.code)) throw error;
      await fsp.writeFile(file, text, "utf8");
    }
  } finally {
    await fsp.rm(temp, { force: true }).catch(() => {});
  }
}

function createAgentBrain(options = {}) {
  const {
    dataFile,
    projectId = () => "default",
    send = () => {},
    logLine = () => {},
    now = Date.now,
    seatFetch = null,
    // The head agent's own call (the heavy role), for drafting a pipeline
    // when no recipe fits a complex task; null keeps drafting off.
    headFetch = null,
    raiseIssue = null,
    askForWork = null,
    projectRoot = () => null,
    isActive = () => true,
    readAreas = async () => [],
    // The project's recent git history (`git log --name-only`), so the map
    // shows the project's systems before any agent has worked in it.
    readHistory = null,
    readInventory = null,
    random = Math.random,
    // The companion is one character across projects: its look, reach, the
    // owner's last-seen time and the decisions it learns from live in one
    // app-wide file when the host gives one (appDataFile), else per project.
    appDataFile = null,
    modules = {},
  } = options;
  if (typeof dataFile !== "function") throw new Error("createAgentBrain needs dataFile(name)");
  const mods = {
    workEvents: modules.workEvents ?? require("./work-events.cjs"),
    pipelines: modules.pipelines ?? require("./pipelines.cjs"),
    playbook: modules.playbook ?? require("./playbook.cjs"),
    projectMap: modules.projectMap ?? require("./project-map.cjs"),
    desk: modules.desk ?? require("./desk.cjs"),
    companion: modules.companion ?? require("./companion.cjs"),
  };
  const scopes = new Map();
  const warned = new Set();
  const sharedCompanion = typeof appDataFile === "function"
    ? { file: appDataFile("companion.json"), state: { lastSeenAt: 0, greetingUntil: 0, look: "wisp", scope: "project", decisions: [] }, loaded: null, writes: Promise.resolve() }
    : null;

  function warn(where, error) {
    const key = `${where}:${String(error?.message ?? error).slice(0, 60)}`;
    if (warned.has(key)) return;
    warned.add(key);
    logLine(`[brain] ${where} failed: ${String(error?.message ?? error).slice(0, 160)}`);
  }

  // File paths are fixed when a project's scope is first made, inside that
  // project's context, so a timer that fires later still writes to the right
  // folder whatever project is open by then.
  function scope() {
    const id = String(projectId() ?? "default");
    let s = scopes.get(id);
    if (s) return s;
    s = {
      id,
      files: {
        events: dataFile("work-events.jsonl"),
        pipelines: dataFile("pipelines.json"),
        playbook: dataFile("playbook.json"),
        map: dataFile("project-map.json"),
        places: dataFile("map-places.json"),
        index: dataFile("file-index.jsonl"),
        companion: sharedCompanion ? sharedCompanion.file : dataFile("companion.json"),
      },
      store: null,
      loaded: null,
      pipelines: new Map(),
      answers: new Map(),
      playbook: mods.playbook.emptyPlaybook(),
      map: null,
      places: { ideas: {}, plans: {} },
      history: { at: 0, entries: [] },
      companion: sharedCompanion ? sharedCompanion.state : { lastSeenAt: 0, greetingUntil: 0, look: "wisp", scope: "project", decisions: [] },
      statuses: new Map(),
      tasks: new Map(),
      runs: new Map(),
      reports: new Map(),
      recent: [],
      desk: { queue: [], asked: new Map(), busy: false, hourStart: 0, hourCount: 0, deferred: [] },
      drafts: { busy: new Set(), pending: new Set(), hourStart: 0, hourCount: 0 },
      saveTimer: null,
      mapTimer: null,
      seenSavedAt: 0,
      indexChain: Promise.resolve(),
      writes: Promise.resolve(),
      indexAppends: 0,
      wakeAt: 0,
    };
    s.store = mods.workEvents.createStore({ file: s.files.events });
    scopes.set(id, s);
    return s;
  }

  function ready(s) {
    if (!s.loaded) {
      s.loaded = (async () => {
        const saved = await readJson(s.files.pipelines, null);
        for (const [taskId, pipeline] of Object.entries(saved?.pipelines ?? {})) {
          if (pipeline && Array.isArray(pipeline.steps)) s.pipelines.set(taskId, pipeline);
        }
        for (const [taskId, list] of Object.entries(saved?.answers ?? {})) {
          if (Array.isArray(list)) s.answers.set(taskId, list.slice(-3));
        }
        s.playbook = mods.playbook.normalizePlaybook(await readJson(s.files.playbook, null));
        s.map = await readJson(s.files.map, null);
        const places = await readJson(s.files.places, null);
        for (const kind of ["ideas", "plans"]) {
          for (const [id, systemId] of Object.entries(places?.[kind] ?? {})) if (typeof systemId === "string") s.places[kind][id] = systemId;
        }
        // Loaded once for a shared companion; mutated in place, so every
        // project's scope keeps pointing at the same state.
        if (sharedCompanion) sharedCompanion.loaded ??= readJson(s.files.companion, null).then((saw) => loadCompanion(s.companion, saw));
        else loadCompanion(s.companion, await readJson(s.files.companion, null));
        if (sharedCompanion) await sharedCompanion.loaded;
      })().catch((error) => warn("load", error));
    }
    return s.loaded;
  }

  // Every JSON file of a scope is written through one chain: two saves of the
  // same file never race on its temp name, and flush() can wait for them.
  function persist(s, file, value) {
    s.writes = s.writes.then(() => writeJsonAtomic(file, value)).catch((error) => warn(`save ${path.basename(file)}`, error));
    return s.writes;
  }

  function loadCompanion(target, saw) {
    if (!saw || typeof saw !== "object") return;
    Object.assign(target, {
      lastSeenAt: Number(saw.lastSeenAt) || 0,
      look: mods.companion.LOOKS.includes(saw.look) ? saw.look : target.look,
      scope: saw.scope === "all" ? "all" : "project",
      roaming: saw.roaming !== false, pinned: saw.pinned === true, bubbles: saw.bubbles !== false, growth: saw.growth !== false,
      anchor: validAnchor(saw.anchor) ? saw.anchor : null,
      decisions: Array.isArray(saw.decisions) ? saw.decisions.slice(-LIMITS.decisionsKept) : [],
    });
  }

  function notify(s, what, extra = {}) {
    if (isActive(s.id)) send("brain:update", { what, ...extra });
  }

  function emit(s, raw) {
    const event = mods.workEvents.normalizeEvent({ project: s.id, ...raw }, { now: now() });
    if (!event) return null;
    s.recent.push(event);
    if (s.recent.length > LIMITS.recentEvents) s.recent.splice(0, s.recent.length - LIMITS.recentEvents);
    s.store.append(event).catch(() => {});
    if (isActive(s.id)) send("brain:event", event);
    return event;
  }

  function scheduleSave(s) {
    if (s.saveTimer) return;
    s.saveTimer = setTimeout(() => {
      s.saveTimer = null;
      savePipelines(s).catch((error) => warn("save pipelines", error));
    }, LIMITS.saveDelayMs);
    s.saveTimer.unref?.();
  }

  async function savePipelines(s) {
    // Oldest pipelines go first once the file holds more than it should; a
    // pipeline is only a view of its task, so dropping an old one loses nothing
    // the board does not still have.
    const rows = [...s.pipelines.entries()].sort((a, b) => (Number(b[1].updatedAt) || 0) - (Number(a[1].updatedAt) || 0));
    const kept = rows.slice(0, LIMITS.pipelinesKept);
    s.pipelines = new Map(kept);
    const answers = {};
    for (const [taskId, list] of s.answers) if (s.pipelines.has(taskId) || s.tasks.has(taskId)) answers[taskId] = list;
    await persist(s, s.files.pipelines, { v: 1, savedAt: now(), pipelines: Object.fromEntries(kept), answers });
  }

  function lineage(s, taskId) {
    const parents = [];
    let cursor = s.tasks.get(taskId)?.parentTaskId ?? null;
    while (cursor && parents.length < 4 && !parents.includes(cursor)) {
      parents.push(cursor);
      cursor = s.tasks.get(cursor)?.parentTaskId ?? null;
    }
    return parents;
  }

  function advance(s, taskId, event) {
    const current = s.pipelines.get(taskId);
    if (!current) return null;
    let result;
    try {
      result = mods.pipelines.advance(current, event, { now: now() });
    } catch (error) {
      warn("pipeline advance", error);
      return current;
    }
    if (!result?.changed) return current;
    const pipeline = { ...result.pipeline, updatedAt: now() };
    s.pipelines.set(taskId, pipeline);
    for (const row of result.events ?? []) emit(s, { ...row, taskId: row.taskId ?? taskId, parents: lineage(s, taskId) });
    scheduleSave(s);
    notify(s, "pipeline", { taskId });
    return pipeline;
  }

  function remember(s, task) {
    if (!task?.id) return;
    s.tasks.set(task.id, {
      id: task.id,
      title: String(task.title ?? "").slice(0, 160),
      prompt: String(task.prompt ?? "").slice(0, 1500),
      status: task.status ?? "open",
      parentTaskId: task.parentTaskId ?? task.delegatedFrom?.parentTaskId ?? null,
      doneAt: Number(task.doneAt) || null,
      files: Array.isArray(task.files) ? task.files.slice(0, 20) : [],
      verifyAttempts: Number(task.verifyAttempts) || 0,
      nextRunAt: task.nextRunAt ?? null,
      parkedAt: task.parkedAt ?? null,
      ownerHold: Boolean(task.ownerHold),
      loopGuard: task.loopGuard ?? null,
      archived: Boolean(task.archived || task.archivedAt),
      lastAttemptAt: Number(task.lastAttempt?.at) || null,
      verification: task.verification ? { state: task.verification.state, at: task.verification.at } : null,
    });
  }

  // ---- runs ----------------------------------------------------------------

  // Before the prompt is built: the pipeline this run works through (drafted
  // from the Playbook's best recipe for this kind of work, else the template),
  // and the lines the worker is given — the step, help and report protocol,
  // the pipeline, any desk answers and the systems the map says are related.
  async function prepareRun({ task, shape = null, deskTool: live = false, draft = false } = {}) {
    const empty = { protocol: "", brief: "" };
    if (!task?.id) return empty;
    try {
      const s = scope();
      await ready(s);
      remember(s, task);
      let pipeline = s.pipelines.get(task.id);
      if (pipeline?.proposal && !pipeline.done && ![...s.runs.values()].some((run) => run.taskId === task.id)) {
        const steps = pipeline.proposal;
        pipeline = { ...pipeline, steps: steps.map((step) => ({ ...step, status: "queued", owner: null, startedAt: null, doneAt: null })), proposal: undefined, drafted: true, updatedAt: now() };
        s.pipelines.set(task.id, pipeline);
      }
      if (!pipeline || pipeline.done) {
        const pick = shape ? mods.playbook.pick(s.playbook, shape, { random }) : null;
        pipeline = mods.pipelines.createPipeline({ task, shape, recipe: pick?.recipe ?? null, now: now() });
        pipeline = { ...pipeline, shape: shape ?? null, recipeName: pick?.recipe?.name ?? null, recipeP: pick?.p ?? null };
        s.pipelines.set(task.id, pipeline);
        emit(s, { kind: "pipeline", taskId: task.id, title: task.title, text: pick ? `laid out from the Playbook's "${pick.recipe.name}"` : "laid out", count: pipeline.steps.length, parents: lineage(s, task.id) });
        scheduleSave(s);
        notify(s, "pipeline", { taskId: task.id });
        // No recipe fits a complex task: the head drafts one in the
        // background while this run works from the template.
        if (draft && !pick && ["compound", "systemic"].includes(shape?.complexity)) {
          const pending = headDraft(s, task, shape).catch((error) => warn("head draft", error));
          s.drafts.pending.add(pending);
          pending.finally(() => s.drafts.pending.delete(pending));
        }
      }
      return promptHints(s, task, pipeline, live);
    } catch (error) {
      warn("prepare run", error);
      return empty;
    }
  }

  function promptHints(s, task, pipeline, live = false) {
    const sub = Boolean(task.parentTaskId || task.delegatedFrom?.parentTaskId);
    const protocol = [
      `If you split the work into steps, print ${mods.pipelines.STEP_MARK} add :: <step> when you start one and ${mods.pipelines.STEP_MARK} done :: <step> when it is finished.`,
      mods.desk.helpPromptLine({ mcp: live }),
      sub ? `You are a sub-agent of task ${task.parentTaskId ?? task.delegatedFrom?.parentTaskId}: before the last line print ${REPORT_MARK} found: <what the parent task should know>; changed: <the main files>.` : "",
    ].filter(Boolean).join(" ");
    // The worker prompt keeps 700 characters of this: each part is capped so
    // the newest desk answer and the related systems always fit.
    const cap = (text, max) => { const flat = String(text ?? "").replace(/\s+/g, " ").trim(); return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat; };
    const brief = [];
    const answers = (s.answers.get(task.id) ?? []).slice(-2).reverse();
    if (answers[0]) brief.push(cap(answers[0].note, 260));
    if (pipeline?.steps?.length) {
      const shown = pipeline.steps.filter((step) => !step.folded).map((step) => `${cap(step.title, 28)}${step.status === "done" ? " ✓" : step.status === "active" ? " (now)" : ""}`);
      brief.push(cap(`Pipeline${pipeline.recipeName ? ` (recipe "${cap(pipeline.recipeName, 30)}")` : ""}: ${shown.join(" > ")}.`, 200));
    }
    if (s.map) {
      try {
        const related = mods.projectMap.relatedFor(s.map, { text: `${task.title ?? ""} ${task.prompt ?? ""}`, files: Array.isArray(task.files) ? task.files : [] });
        const line = mods.projectMap.briefLine(related);
        if (line) brief.push(cap(line, 180));
      } catch (error) {
        warn("related systems", error);
      }
    }
    if (answers[1]) brief.push(cap(answers[1].note, 160));
    return { protocol, brief: brief.length ? ` ${brief.join(" ")}` : "" };
  }

  // The head agent's draft (the heavy role, data only): taken while the
  // pipeline has not moved past its first steps, so a run in progress is
  // never re-shaped under it; otherwise kept as the next run's layout.
  async function headDraft(s, task, shape) {
    if (typeof headFetch !== "function" || s.drafts.busy.has(task.id)) return;
    if (now() - s.drafts.hourStart > 3600 * 1000) { s.drafts.hourStart = now(); s.drafts.hourCount = 0; }
    if (s.drafts.hourCount >= LIMITS.draftsPerHour) return;
    s.drafts.hourCount += 1;
    s.drafts.busy.add(task.id);
    try {
      const prompt = mods.pipelines.draftPrompt({ task, shape, recipe: null });
      const result = await headFetch(prompt.system, prompt.user, 1600);
      const drafted = result?.ok ? mods.pipelines.parseDraft(result.text, { task, now: now() }) : null;
      if (!drafted) { emit(s, { kind: "pipeline", taskId: task.id, role: "head", text: "draft not usable; the template stays", ok: false }); return; }
      const current = s.pipelines.get(task.id);
      const running = [...s.runs.values()].some((run) => run.taskId === task.id);
      const moved = running || (current?.steps ?? []).some((step) => step.status === "done" && step.kind !== "read");
      const next = { ...drafted, shape, recipeName: null, recipeP: null, drafted: true };
      if (current && moved) {
        s.pipelines.set(task.id, { ...current, proposal: next.steps, updatedAt: now() });
        emit(s, { kind: "pipeline", taskId: task.id, role: "head", text: "drafted a pipeline for the next run", count: next.steps.length });
      } else {
        s.pipelines.set(task.id, { ...next, updatedAt: now() });
        emit(s, { kind: "pipeline", taskId: task.id, role: "head", text: "drafted this task's pipeline", count: next.steps.length });
      }
      scheduleSave(s);
      notify(s, "pipeline", { taskId: task.id });
    } finally {
      s.drafts.busy.delete(task.id);
    }
  }

  function runStarted({ task, runId, model = null, via = null } = {}) {
    if (!task?.id || !runId) return;
    try {
      const s = scope();
      remember(s, task);
      s.runs.set(runId, { taskId: task.id, helps: 0, report: null, todos: "", startedAt: now() });
      emit(s, { kind: "agent.out", taskId: task.id, runId, model, role: "builder", text: via ? String(via) : undefined, title: task.title, parents: lineage(s, task.id) });
      advance(s, task.id, { type: "run-start", runId, model });
    } catch (error) {
      warn("run start", error);
    }
  }

  function workerLine({ taskId, runId, line, first = false } = {}) {
    if (!taskId || !runId) return;
    try {
      const s = scope();
      const run = s.runs.get(runId) ?? { taskId, helps: 0, report: null, todos: "" };
      s.runs.set(runId, run);
      if (first) advance(s, taskId, { type: "spoke", runId });
      const step = mods.pipelines.parseStepLine(line);
      if (step) advance(s, taskId, { type: "step-line", runId, action: step.action, title: step.title });
      const help = mods.desk.parseHelpLine(line);
      if (help && run.helps < LIMITS.helpsPerRun) {
        run.helps += 1;
        queueHelp(s, { taskId, runId, question: help.question, detail: help.detail });
      }
      const report = parseReportLine(line);
      if (report) run.report = report.text;
    } catch (error) {
      warn("worker line", error);
    }
  }

  function todos({ taskId, runId, todos: list } = {}) {
    if (!taskId || !runId || !Array.isArray(list)) return;
    try {
      const s = scope();
      const run = s.runs.get(runId) ?? { taskId, helps: 0, report: null, todos: "" };
      s.runs.set(runId, run);
      const clean = list.map((todo) => ({ content: String(todo?.content ?? todo?.title ?? "").slice(0, 120), status: String(todo?.status ?? "pending") })).filter((todo) => todo.content);
      const signature = JSON.stringify(clean);
      if (signature === run.todos) return;
      run.todos = signature;
      advance(s, taskId, { type: "todos", runId, todos: clean });
    } catch (error) {
      warn("todos", error);
    }
  }

  function runFinished({ task, runId, ok = false, userStop = false, resultNote = null } = {}) {
    if (!task?.id || !runId) return;
    try {
      const s = scope();
      remember(s, task);
      const run = s.runs.get(runId);
      s.runs.delete(runId);
      releaseDeskTool(runId);
      advance(s, task.id, { type: "run-end", runId, ok: ok && !userStop });
      emit(s, { kind: "agent.home", taskId: task.id, runId, ok: ok && !userStop, title: task.title, parents: lineage(s, task.id) });
      const parentId = s.tasks.get(task.id)?.parentTaskId;
      if (parentId && ok && !userStop) {
        const text = run?.report || resultText(resultNote) || "finished its part";
        s.reports.set(task.id, text);
        emit(s, { kind: "report", taskId: parentId, from: task.id, runId, text, title: task.title, parents: lineage(s, parentId) });
      }
    } catch (error) {
      warn("run finish", error);
    }
  }

  // ---- the board ---------------------------------------------------------------

  // Every board write passes here (boardWritten). A status that moved is a
  // stage event; a verdict moves the pipeline and files it into the Playbook;
  // a delegated child that changed moves its parent's step, and a child that
  // finished wakes the foreman so the parent's integration pass need not wait
  // for the next cadence.
  async function observeTasks(tasks) {
    if (!Array.isArray(tasks)) return;
    try {
      const s = scope();
      await ready(s);
      const seen = new Set();
      let wake = false;
      let mapChanged = false;
      for (const task of tasks) {
        if (!task?.id) continue;
        seen.add(task.id);
        const before = s.tasks.get(task.id);
        remember(s, task);
        const signature = `${task.status}|${task.verification?.state ?? ""}|${task.verification?.at ?? ""}`;
        const previous = s.statuses.get(task.id);
        s.statuses.set(task.id, signature);
        if (previous !== signature) mapChanged = true;
        if (previous === undefined || previous === signature) continue;
        const [prevStatus, , prevVerifyAt] = previous.split("|");
        if (task.status !== prevStatus) {
          emit(s, { kind: "stage", taskId: task.id, stage: task.status, prev: prevStatus, title: task.title, parents: lineage(s, task.id) });
          if (task.status === "awaiting_verification") advance(s, task.id, { type: "awaiting" });
        }
        const verifyAt = String(task.verification?.at ?? "");
        if (verifyAt && verifyAt !== prevVerifyAt) {
          const state = task.verification?.state;
          const verdict = state === "verified" && task.status === "done" ? "verified" : state === "failed" ? "failed" : state === "unverified" ? "unverified" : null;
          if (verdict) settleVerdict(s, task, verdict);
        }
        const parentId = s.tasks.get(task.id)?.parentTaskId;
        if (parentId && ((before?.status ?? prevStatus) !== task.status || verifyAt !== prevVerifyAt)) {
          advance(s, parentId, { type: "child", childTaskId: task.id, status: childStatus(task), title: task.title, report: s.reports.get(task.id) ?? null });
          if (task.status === "done") wake = true;
        }
      }
      for (const id of [...s.statuses.keys()]) if (!seen.has(id)) { s.statuses.delete(id); mapChanged = true; }
      for (const id of [...s.tasks.keys()]) if (!seen.has(id)) s.tasks.delete(id);
      // What a card left behind goes with it; the desk's folds expire.
      for (const id of [...s.reports.keys()]) if (!seen.has(id)) s.reports.delete(id);
      for (const id of [...s.answers.keys()]) if (!seen.has(id) && !s.pipelines.has(id)) s.answers.delete(id);
      for (const [key, at] of [...s.desk.asked]) if (now() - at >= LIMITS.deskFoldMs) s.desk.asked.delete(key);
      if (mapChanged) scheduleMap(s);
      if (isActive(s.id)) flushEscalations(s);
      if (wake && typeof askForWork === "function" && now() - s.wakeAt > 5000) {
        s.wakeAt = now();
        try { askForWork("a delegated child reported"); } catch {}
      }
    } catch (error) {
      warn("observe tasks", error);
    }
  }

  function settleVerdict(s, task, verdict) {
    const pipeline = advance(s, task.id, { type: "verdict", verdict });
    // Out of verification tries: the card waits for the owner, which the
    // companion's digest reports as stopped work.
    if (verdict === "failed") emit(s, { kind: "stage", taskId: task.id, stage: "parked", prev: task.status, title: task.title, parents: lineage(s, task.id) });
    if (!pipeline || verdict === "unverified") return;
    // The archivist: a verified or failed pipeline's shape goes into the
    // Playbook, so the next task of this kind starts from what worked.
    try {
      s.playbook = mods.playbook.record(s.playbook, {
        steps: mods.pipelines.recipeSteps(pipeline),
        signature: mods.pipelines.signature(pipeline),
        shape: pipeline.shape ?? { intent: null, complexity: null },
        verdict: verdict === "verified" ? "verified" : "failed",
        durationMs: Math.max(0, now() - (Number(pipeline.createdAt) || now())),
        taskId: task.id,
        now: now(),
      });
      emit(s, { kind: "pipeline", taskId: task.id, role: "archivist", title: task.title, text: `filed into the Playbook (${verdict})`, ok: verdict === "verified" });
      persist(s, s.files.playbook, s.playbook);
      notify(s, "playbook");
    } catch (error) {
      warn("playbook record", error);
    }
    if (verdict === "verified") advance(s, task.id, { type: "fold" });
  }

  function mail({ from, to, text } = {}) {
    try {
      const s = scope();
      emit(s, { kind: "mail", from, to, text, role: from });
    } catch (error) {
      warn("mail", error);
    }
  }

  // ---- files and the project map ------------------------------------------------------

  function filesTouched({ taskId, runId = null, reads = [], edits = [], commands = 0, root = null } = {}) {
    if (!taskId) return;
    try {
      const s = scope();
      const entry = mods.projectMap.indexEntry({ taskId, runId, at: now(), reads, edits, commands, root: root ?? projectRoot() });
      if (!entry) return;
      appendIndex(s, entry);
      if (entry.reads.length) emit(s, { kind: "file.read", taskId, runId, files: entry.reads.slice(0, 40), count: entry.reads.length, parents: lineage(s, taskId) });
      if (entry.edits.length) emit(s, { kind: "file.edit", taskId, runId, files: entry.edits.slice(0, 40), count: entry.edits.length, parents: lineage(s, taskId) });
      scheduleMap(s);
    } catch (error) {
      warn("files touched", error);
    }
  }

  function appendIndex(s, entry) {
    const target = s.files.index;
    s.indexChain = s.indexChain.then(async () => {
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.appendFile(target, `${JSON.stringify(entry)}\n`, "utf8");
      s.indexAppends += 1;
      if (s.indexAppends % 200 !== 1) return;
      if ((await fsp.stat(target)).size <= LIMITS.indexMaxBytes) return;
      const kept = (await fsp.readFile(target, "utf8")).split("\n").filter((row) => row.trim()).slice(-LIMITS.indexKeepLines);
      const temp = `${target}.trim`;
      await fsp.writeFile(temp, `${kept.join("\n")}\n`, "utf8");
      await fsp.rename(temp, target);
    }).catch((error) => warn("file index", error));
    return s.indexChain;
  }

  function scheduleMap(s) {
    if (s.mapTimer) return;
    s.mapTimer = setTimeout(() => {
      s.mapTimer = null;
      rebuildMap(s).catch((error) => warn("map rebuild", error));
    }, LIMITS.mapDelayMs);
    s.mapTimer.unref?.();
  }

  async function rebuildMap(s = scope()) {
    await ready(s);
    await s.indexChain;
    let text = "";
    try { text = await fsp.readFile(s.files.index, "utf8"); } catch {}
    const index = mods.projectMap.parseIndex(text);
    let areas = [];
    try { areas = (await readAreas()) ?? []; } catch {}
    const tasks = [...s.tasks.values()];
    // Git history is read at most every ten minutes; a project without git,
    // or a git that fails, simply has none.
    if (typeof readHistory === "function" && now() - s.history.at >= LIMITS.historyMs) {
      s.history.at = now();
      try { s.history.entries = mods.projectMap.parseGitLog(await readHistory()); } catch (error) { warn("git history", error); }
    }
    // Names a model gave earlier survive a rebuild (`previous`); only new
    // systems need one. Large flat folders split into the groups of files
    // that change together.
    let inventory = null;
    if (typeof readInventory === "function") {
      try { inventory = await readInventory(); } catch (error) { warn("project inventory", error); }
    }
    const map = mods.projectMap.buildMap({ index, history: s.history.entries, inventory, areas: Array.isArray(areas) ? areas : [], tasks, now: now(), previous: s.map, cluster: {} });
    s.map = map;
    s.mapInventoryAt = now();
    await persist(s, s.files.map, map);
    notify(s, "map");
    return map;
  }

  // ---- the desk ----------------------------------------------------------------

  function queueHelp(s, item) {
    const key = `${item.taskId}|${mods.desk.foldKey(item.question)}`;
    const at = s.desk.asked.get(key);
    if (at && now() - at < LIMITS.deskFoldMs) {
      // A repeat waits on nothing: the earlier answer if there is one.
      const earlier = (s.answers.get(item.taskId) ?? []).find((row) => mods.desk.foldKey(row.question) === mods.desk.foldKey(item.question));
      item.settle?.(earlier ? { ok: true, answer: earlier.note } : { ok: true, answer: "The desk is already on this question. Carry on with what you can; its answer will be in your brief." });
      return false;
    }
    s.desk.asked.set(key, now());
    emit(s, { kind: "help.ask", taskId: item.taskId, runId: item.runId, text: item.question, role: "desk", parents: lineage(s, item.taskId) });
    s.desk.queue.push(item);
    pumpDesk(s).catch((error) => warn("desk", error));
    return true;
  }

  async function escalate(escalation) {
    if (typeof raiseIssue !== "function") return;
    try {
      await raiseIssue(escalation);
    } catch (error) {
      warn("desk escalation", error);
    }
  }
  function flushEscalations(s) {
    if (!s.desk.deferred.length) return;
    const waiting = s.desk.deferred;
    s.desk.deferred = [];
    for (const escalation of waiting) escalate(escalation);
  }

  async function pumpDesk(s) {
    if (s.desk.busy) return;
    s.desk.busy = true;
    try {
      while (s.desk.queue.length) {
        const item = s.desk.queue.shift();
        if (now() - s.desk.hourStart > 3600 * 1000) { s.desk.hourStart = now(); s.desk.hourCount = 0; }
        const task = s.tasks.get(item.taskId) ?? { id: item.taskId, title: item.taskId, prompt: "" };
        const pipeline = s.pipelines.get(item.taskId) ?? null;
        let parsed = null;
        let reason = "";
        if (typeof seatFetch !== "function") reason = "no model is set up for the desk";
        else if (s.desk.hourCount >= LIMITS.deskPerHour) reason = "the desk reached its hourly limit";
        else {
          s.desk.hourCount += 1;
          const prompt = mods.desk.deskPrompt({ task, question: item.question, detail: item.detail, shape: pipeline?.shape ?? null, pipeline });
          try {
            const result = await seatFetch("desk", prompt.system, prompt.user, 1600);
            parsed = result?.ok ? mods.desk.parseDeskAnswer(result.text) : null;
            if (!result?.ok) reason = String(result?.error ?? "the desk's model did not answer").slice(0, 160);
          } catch (error) {
            reason = String(error?.message ?? error).slice(0, 160);
          }
        }
        if (parsed && !parsed.escalate && parsed.answer) {
          const note = mods.desk.answerNote({ question: item.question, answer: parsed.answer, parts: parsed.parts });
          const list = [...(s.answers.get(item.taskId) ?? []), { at: now(), question: item.question, answer: parsed.answer, parts: parsed.parts, note }].slice(-3);
          s.answers.set(item.taskId, list);
          scheduleSave(s);
          emit(s, { kind: "help.answer", taskId: item.taskId, runId: item.runId, text: parsed.answer, count: parsed.parts.length, ok: true, role: "desk", parents: lineage(s, item.taskId) });
          notify(s, "desk", { taskId: item.taskId });
          item.settle?.({ ok: true, answer: note });
          continue;
        }
        // Only the owner could answer, or the desk could not: one ask, through
        // the ordinary lane, where repeat asks fold like any other.
        const why = parsed?.reason || reason || "the desk could not answer";
        emit(s, { kind: "help.answer", taskId: item.taskId, runId: item.runId, text: `escalated: ${why}`, ok: false, role: "desk", parents: lineage(s, item.taskId) });
        item.settle?.({ ok: false, escalated: true, answer: `This needs the owner (${why}); it has been sent to them. Carry on with what you can and note it under owner: in your result line.` });
        const escalation = { kind: "blocked", title: `The desk could not answer: ${item.question}`.slice(0, 200), detail: [item.detail, why].filter(Boolean).join(" · ").slice(0, 600), taskId: item.taskId, taskTitle: task.title, runId: item.runId, source: "desk" };
        // The ask lands in the assistant state of the open project, so one
        // for a project that is not open waits until it is again.
        if (isActive(s.id)) await escalate(escalation);
        else s.desk.deferred = [...s.desk.deferred, escalation].slice(-10);
      }
    } finally {
      s.desk.busy = false;
    }
  }

  // A running worker's live question (desk-mcp.mjs through desk-server.cjs):
  // the same queue as a MEFI_HELP line, but the caller waits for the answer.
  function askDesk({ taskId, runId = null, question, detail = "" } = {}) {
    if (!taskId || !question) return Promise.resolve({ ok: false, answer: "Ask one question for a task." });
    const s = scope();
    const run = runId ? s.runs.get(runId) : null;
    if (run && run.helps >= LIMITS.helpsPerRun) return Promise.resolve({ ok: false, answer: "This run has asked the desk enough; carry on and report what is left." });
    if (run) run.helps += 1;
    return new Promise((resolve) => queueHelp(s, { taskId, runId, question, detail, settle: resolve }));
  }

  // The per-run MCP config files that put ask_desk beside a builder, written
  // when the owner's deskTool switch is on and removed when the run ends.
  const deskTool = { server: null, address: null, files: new Map() };
  async function prepareDeskTool({ taskId, runId, script, runInProject = null } = {}) {
    if (!taskId || !runId || !script) return null;
    try {
      const deskServer = modules.deskServer ?? require("./desk-server.cjs");
      if (!deskTool.server) {
        // A call arrives outside any project context; the run's own project
        // answers it, so the desk reads the right task and pipeline.
        const owners = deskTool.owners = new Map();
        deskTool.server = deskServer.createDeskServer({
          handle: (request) => {
            const owner = owners.get(request.runId);
            const call = () => askDesk(request);
            return owner && typeof runInProject === "function" ? runInProject(owner, call) : call();
          },
        });
      }
      deskTool.address ??= await deskTool.server.start();
      deskTool.owners.set(runId, scope().id);
      const files = await deskServer.writeRunConfigs({ ...deskTool.address, taskId, runId, script });
      if (files) deskTool.files.set(runId, files);
      return files;
    } catch (error) {
      warn("desk tool", error);
      return null;
    }
  }
  function releaseDeskTool(runId) {
    const files = deskTool.files.get(runId);
    deskTool.files.delete(runId);
    deskTool.owners?.delete(runId);
    if (files) (modules.deskServer ?? require("./desk-server.cjs")).removeRunConfigs(files).catch(() => {});
  }

  // ---- the companion --------------------------------------------------------

  function saveCompanion(s) {
    const { lastSeenAt, look, scope: reach, decisions, roaming, pinned, bubbles, growth, anchor } = s.companion;
    const value = { v: 2, lastSeenAt, look, scope: reach, decisions, roaming, pinned, bubbles, growth, anchor };
    if (!sharedCompanion) return persist(s, s.files.companion, value);
    sharedCompanion.writes = sharedCompanion.writes.then(() => writeJsonAtomic(sharedCompanion.file, value)).catch((error) => warn("save companion", error));
    return sharedCompanion.writes;
  }

  async function companionScope() {
    const s = scope();
    await ready(s);
    return s.companion.scope;
  }

  async function seen({ reason = "active" } = {}) {
    const s = scope();
    await ready(s);
    s.companion.lastSeenAt = now();
    s.companion.lastSeenReason = String(reason).slice(0, 40);
    if (now() - s.seenSavedAt >= LIMITS.seenSaveMs || reason === "quit" || reason === "hide") {
      s.seenSavedAt = now();
      await saveCompanion(s);
    }
    return { ok: true, lastSeenAt: s.companion.lastSeenAt };
  }

  // What happened while the owner was away, from the recorded events and the
  // board: built locally, so a greeting never spends a model call.
  async function welcome({ tasks = [], needsYouIds = [], minAwayMs = 10 * 60 * 1000 } = {}) {
    const s = scope();
    await ready(s);
    const since = Number(s.companion.lastSeenAt) || 0;
    if (!since || now() - since < minAwayMs) return { ok: true, digest: null };
    const events = await s.store.read({ since, limit: 5000 });
    const digest = mods.companion.digest({ events, tasks, since, now: now(), needsYouIds });
    s.companion.greetingUntil = now() + LIMITS.greetingMs;
    return { ok: true, digest };
  }

  // `others` carries the open questions of the owner's other projects, read
  // by the host only when the companion covers all projects; each keeps its
  // project's name so the owner can see where it waits.
  async function companionState({ questions = [], tasks = [], running = 0, project = null, others = [] } = {}) {
    const s = scope();
    await ready(s);
    const queue = mods.companion.queue({ questions, tasks, now: now(), project });
    if (s.companion.scope === "all") {
      for (const other of Array.isArray(others) ? others : []) {
        const extra = mods.companion.queue({ questions: other.questions ?? [], tasks: [], now: now(), project: other.project ?? null });
        queue.items.push(...extra.items.map((item) => ({ ...item, projectId: other.projectId ?? null })));
        for (const [key, value] of Object.entries(extra.counts)) queue.counts[key] = (queue.counts[key] ?? 0) + value;
      }
    }
    const state = mods.companion.stateFor({ running, needsYou: queue.counts.total, greetingUntil: s.companion.greetingUntil, now: now() });
    return {
      ok: true,
      state,
      queue,
      preferences: mods.companion.preferences(s.companion.decisions.filter((row) => row.projectId === s.id)),
      studioPreferences: mods.companion.preferences(s.companion.decisions.filter((row) => !row.projectId)),
      projectId: s.id, projectName: project || "This project",
      learning: { systems: s.map?.systems?.length || 0, verifiedRecipes: (s.playbook?.recipes || []).filter((recipe) => recipe.verified > 0).length },
      activity: (s.recent || []).slice(-20).reverse().map((event) => ({ id: event.id, kind: event.kind, at: event.at, text: event.title || event.message || event.kind })),
      roaming: s.companion.roaming !== false, pinned: s.companion.pinned === true, bubbles: s.companion.bubbles !== false, growth: s.companion.growth !== false, anchor: s.companion.anchor || null,
      look: s.companion.look,
      scope: s.companion.scope,
      lastSeenAt: s.companion.lastSeenAt,
    };
  }

  function validAnchor(value) { return value && Number.isFinite(value.x) && Number.isFinite(value.y) && value.x >= 0 && value.x <= 1 && value.y >= 0 && value.y <= 1; }

  async function companionPrefs({ look, scope: reach, roaming, pinned, bubbles, growth, anchor } = {}) {
    const s = scope();
    await ready(s);
    if (anchor !== undefined && !validAnchor(anchor)) return { ok: false, error: "Invalid companion position" };
    for (const value of [roaming, pinned, bubbles, growth]) if (value !== undefined && typeof value !== "boolean") return { ok: false, error: "Companion switches must be on or off" };
    if (reach !== undefined && reach !== "project" && reach !== "all") return { ok: false, error: "Scope is either this project or all projects" };
    if (look !== undefined) {
      if (!mods.companion.LOOKS.includes(look)) return { ok: false, error: `Unknown look "${String(look).slice(0, 20)}"` };
      s.companion.look = look;
    }
    if (reach !== undefined) {
      if (reach !== "project" && reach !== "all") return { ok: false, error: "Scope is either this project or all projects" };
      s.companion.scope = reach;
    }
    for (const [key, value] of Object.entries({ roaming, pinned, bubbles, growth, anchor })) if (value !== undefined) s.companion[key] = value;
    await saveCompanion(s);
    return { ok: true, look: s.companion.look, scope: s.companion.scope };
  }

  function recordDecision({ kind, verb } = {}) {
    if (!kind || !verb) return Promise.resolve();
    try {
      const s = scope();
      const row = { projectId: s.id, kind: String(kind).slice(0, 40), verb: String(verb).slice(0, 40), at: now() };
      // Loaded first: saving before the file is read would overwrite the
      // owner's look, reach and earlier decisions with defaults.
      return ready(s).then(() => {
        s.companion.decisions = [...s.companion.decisions, row].slice(-LIMITS.decisionsKept);
        return saveCompanion(s);
      }).catch((error) => warn("record decision", error));
    } catch (error) {
      warn("record decision", error);
      return Promise.resolve();
    }
  }

  // ---- reads for the renderer ------------------------------------------------------

  async function state({ taskIds = null } = {}) {
    const s = scope();
    await ready(s);
    const wanted = Array.isArray(taskIds) && taskIds.length ? new Set(taskIds) : null;
    const pipelines = {};
    for (const [taskId, pipeline] of s.pipelines) {
      if (!wanted || wanted.has(taskId)) pipelines[taskId] = { ...pipeline, summary: mods.pipelines.summary(pipeline) };
    }
    return {
      ok: true,
      project: s.id,
      pipelines,
      recent: s.recent.slice(-200),
      running: [...s.runs.entries()].map(([runId, run]) => ({ runId, taskId: run.taskId, startedAt: run.startedAt ?? null })),
      desk: { queued: s.desk.queue.length, busy: s.desk.busy },
      answers: Object.fromEntries([...s.answers.entries()].map(([taskId, list]) => [taskId, list.map(({ note, ...row }) => row)])),
    };
  }

  async function events(query = {}) {
    const s = scope();
    const rows = await s.store.read({ ...query, limit: Math.min(20000, Number(query.limit) || 5000) });
    return { ok: true, events: rows, summary: mods.workEvents.summarize(rows) };
  }

  async function playbookState() {
    const s = scope();
    await ready(s);
    return { ok: true, shelf: mods.playbook.shelf(s.playbook), recipes: s.playbook.recipes };
  }

  async function playbookAction(payload = {}) {
    const s = scope();
    await ready(s);
    const result = mods.playbook.act(s.playbook, payload);
    if (!result.ok) return result;
    s.playbook = result.playbook;
    await persist(s, s.files.playbook, s.playbook);
    notify(s, "playbook");
    return { ok: true, shelf: mods.playbook.shelf(s.playbook), recipes: s.playbook.recipes };
  }

  async function mapState({ rebuild = false } = {}) {
    const s = scope();
    await ready(s);
    // Opening the map asks for a current inventory; the history remains
    // cached, so this is cheap compared with rereading the commit log.
    const map = rebuild || !s.map || (typeof readInventory === "function" && now() - (s.mapInventoryAt ?? 0) > 30000) ? await rebuildMap(s) : s.map;
    return { ok: true, map, places: s.places };
  }

  // The owner places an idea or a plan on a system of the map (or lifts it
  // off with systemId null). Kept apart from the map, so a rebuild never
  // loses a placement; a placement on a system the map no longer has is
  // simply not shown until the system returns.
  async function placeOnMap({ kind, id, systemId = null } = {}) {
    const s = scope();
    await ready(s);
    const bucket = kind === "idea" ? "ideas" : kind === "plan" ? "plans" : null;
    if (!bucket || typeof id !== "string" || !id || id.length > 120) return { ok: false, error: "Place an idea or a plan by its id" };
    if (systemId !== null && (typeof systemId !== "string" || !systemId || systemId.length > 120)) return { ok: false, error: "Choose a system on the map" };
    if (systemId === null) delete s.places[bucket][id];
    else s.places[bucket][id] = systemId;
    await persist(s, s.files.places, { v: 1, ...s.places });
    notify(s, "map");
    return { ok: true, places: s.places };
  }

  // A model names the systems the first map did not; answers are kept across
  // rebuilds (rebuildMap keeps a named system's name).
  // Returns at once; the names land through a map update. They are applied
  // to the map as it is when the answer arrives, so a rebuild that finished
  // meanwhile is kept.
  async function nameSystems() {
    const s = scope();
    await ready(s);
    if (!s.map) await rebuildMap(s);
    if (typeof seatFetch !== "function") return { ok: false, error: "No model is set up to name systems" };
    const prompt = mods.projectMap.namePrompt(s.map);
    if (!prompt) return { ok: true, map: s.map, note: "Every system already has a name" };
    if (s.naming) return { ok: true, pending: true, note: "Already naming" };
    s.naming = (async () => {
      try {
        const result = await seatFetch("lead", prompt.system, prompt.user, 1200);
        if (!result?.ok || !s.map) { warn("name systems", result?.error ?? "no answer"); return; }
        const before = new Map(s.map.systems.map((row) => [row.id, row.name]));
        const named = mods.projectMap.applyNames(s.map, result.text);
        named.systems = named.systems.map((row) => (row.name !== before.get(row.id) ? { ...row, named: true } : row));
        s.map = named;
        await persist(s, s.files.map, named);
        notify(s, "map");
      } finally {
        s.naming = null;
      }
    })();
    return { ok: true, pending: true, note: "Naming the systems; the map updates when the lead answers" };
  }

  return {
    LIMITS,
    prepareRun,
    runStarted,
    workerLine,
    todos,
    runFinished,
    observeTasks,
    mail,
    filesTouched,
    rebuildMap: () => rebuildMap(scope()),
    askDesk,
    prepareDeskTool,
    releaseDeskTool,
    seen,
    welcome,
    companionState,
    companionPrefs,
    companionScope,
    recordDecision,
    state,
    events,
    playbookState,
    playbookAction,
    mapState,
    placeOnMap,
    nameSystems,
    // For tests: settle every pending write.
    flush: async () => {
      for (const s of scopes.values()) {
        if (s.saveTimer) { clearTimeout(s.saveTimer); s.saveTimer = null; await savePipelines(s); }
        if (s.mapTimer) { clearTimeout(s.mapTimer); s.mapTimer = null; await rebuildMap(s); }
        await s.indexChain;
        await Promise.all([...s.drafts.pending]);
        while (s.desk.busy || s.desk.queue.length) await new Promise((resolve) => setTimeout(resolve, 5));
        if (s.saveTimer) { clearTimeout(s.saveTimer); s.saveTimer = null; await savePipelines(s); }
        await s.writes;
        if (sharedCompanion) await sharedCompanion.writes;
        // The event store's read waits for the appends already queued.
        await s.store.read({ limit: 1 }).catch(() => {});
      }
    },
  };
}

module.exports = { createAgentBrain, parseReportLine, writeJsonAtomic, REPORT_MARK, LIMITS };
