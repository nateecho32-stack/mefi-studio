// Mefi's Studio AI+ — the first-run service: the scan, its apply step and the
// first map behind the walkthrough's new stops.
//
// Everything the host owns arrives as an injected dependency (settings,
// keys, the project registry, the analyzer, the ideas store, the IPC sender),
// so main.cjs registers four IPC handlers and nothing else, and the whole
// flow is testable without Electron. The service never spawns more than one
// map at a time, never writes a setting before "Use this setup", and turns a
// map into ideas only from a parsed final object.

export const FIRST_RUN_VERSION = 1;
export const MAP_TIMEOUT_MS = 10 * 60 * 1000;
export const MAP_TITLE = "Mefi first map";
export const MAP_FILE = "first-map.json";
export const PROGRESS_INTERVAL_MS = 400;
const KEY_FIELDS = Object.freeze({
  zai: "zaiApiKeyEncrypted", opencode: "apiKeyEncrypted", custom: "customApiKeyEncrypted", gateway: "gatewayApiKeyEncrypted",
  jev: "jevApiKeyEncrypted", zen: "zenApiKeyEncrypted", openrouter: "openrouterApiKeyEncrypted",
});

const clip = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const errorText = (error) => clip(error?.message ?? error, 300);

export function createFirstRunService(deps = {}) {
  const {
    scanner, mapper, judge, readSettings, writeSettings, decryptKey = () => null, assistantRoute = async () => ({ ok: false }),
    projects, analyzeProject = async () => null, runEnv = () => ({}), readIdeas = async () => [], writeIdeas = async () => {}, admitIdeas = null,
    writeMapFile = async () => {}, readMapFile = async () => null, assistModule = null, assistantChat = null, autoSetup = null, send = () => {}, progress = () => {}, log = () => {},
    exec = scanner?.spawnExec, env = process.env, platform = process.platform, now = Date.now, smoke = false, mapTimeoutMs = MAP_TIMEOUT_MS,
  } = deps;
  for (const [name, value] of Object.entries({ scanner, mapper, judge, readSettings, writeSettings, projects })) {
    if (!value) throw new Error(`first-run service: ${name} is required`);
  }
  // The host passes its settings queue (main.cjs updateSettings) so this
  // read-modify-write cannot undo a save landing beside it; alone, the same
  // contract runs unqueued on the two callbacks.
  const updateSettings = deps.updateSettings ?? (async (mutate) => {
    const next = await readSettings();
    if ((await mutate(next)) !== false) await writeSettings(next);
    return next;
  });
  if (typeof exec !== "function") throw new Error("first-run service: an exec function is required");

  let lastScan = null;
  let scanning = null;
  const mapping = { running: false, projectId: null, startedAt: null, step: null, tools: 0, child: null, cancelled: false };
  const lastMaps = new Map();
  const lastMapDetail = new Map();
  let assisting = null;

  const keysOf = (settings) => Object.fromEntries(Object.entries(KEY_FIELDS).map(([id, field]) => [id, Boolean(decryptKey(settings, field))]));
  const slimScan = (scan) => ({ ...scan, modelIds: undefined, modelCount: Array.isArray(scan?.modelIds) ? scan.modelIds.length : 0 });
  const prefsFrom = (settings, prefs = {}) => ({
    allowFreeTraining: typeof prefs.allowFreeTraining === "boolean" ? prefs.allowFreeTraining : settings?.firstRun?.allowFreeTraining !== false,
    preferFree: typeof prefs.preferFree === "boolean" ? prefs.preferFree : settings?.firstRun?.preferFree === true,
  });

  // The host's auto setup (main.cjs autoSetup): apply: false only plans. It
  // is optional so the service still runs where the host has none.
  async function autoPlan(options) {
    if (typeof autoSetup !== "function") return null;
    try { return await autoSetup(options); } catch (error) { return { ok: false, error: errorText(error) }; }
  }

  async function routeOk() {
    try { return (await assistantRoute())?.ok === true; } catch { return false; }
  }

  async function status() {
    const settings = await readSettings();
    return {
      ok: true,
      firstRun: settings?.firstRun ?? null,
      autoSetup: settings?.autoSetup ?? null,
      scanned: Boolean(lastScan),
      scanAt: lastScan?.at ?? null,
      mapping: { running: mapping.running, projectId: mapping.projectId, startedAt: mapping.startedAt, step: mapping.step, tools: mapping.tools },
      lastMaps: Object.fromEntries(lastMaps),
      smoke: Boolean(smoke),
    };
  }

  // Not `async`: callers arriving while a scan runs must receive the very
  // same promise, not a fresh wrapper around it.
  function scan({ prefs = {} } = {}) {
    if (smoke) return Promise.resolve({ ok: false, error: "The first scan is unavailable in smoke, capture and CLI launches." });
    if (scanning) return scanning;
    scanning = (async () => {
      const settings = await readSettings();
      const result = await scanner.runFirstScan({ exec, env, platform, onStep: (step) => { try { progress({ kind: "scan", step }); } catch {} } });
      const keys = keysOf(settings);
      const chosen = { ...prefsFrom(settings, prefs), assistantRoute: await routeOk() };
      const plan = scanner.planFirstRun({ scan: result, keys, prefs: chosen });
      // Auto setup's plan rides along (nothing written): the route and builder
      // CLI this machine allows even when OpenCode is missing.
      const auto = await autoPlan({ apply: false });
      lastScan = { at: now(), scan: result, keys, prefs: chosen, plan, autoSetup: auto };
      log(`[first-run] scan: opencode ${plan.opencode.installed ? plan.opencode.version ?? "installed" : "missing"}, ${plan.providers.linked.length} linked provider(s), ${plan.providers.free.count} free model(s), judge ${plan.judge.kind}${auto ? `, auto setup ${auto.ok ? auto.summary : `unavailable (${auto.error})`}` : ""}`);
      return { ok: true, at: lastScan.at, scan: slimScan(result), plan, prefs: chosen, autoSetup: auto };
    })().finally(() => { scanning = null; });
    return scanning;
  }

  // Writes the owner's choice: the first-run record, OpenCode as the builder
  // CLI when it is the only usable one, the free builder model when chosen
  // (the Free coding tier runs it; Auto keeps it as OpenCode's pinned model
  // when the z.ai plan is not in use), and Jev selection when a Jev key
  // exists. Keys and model overrides for other providers are never touched.
  async function apply({ prefs = {} } = {}) {
    if (!lastScan) return { ok: false, error: "Run the first scan before using its setup." };
    const settings = await readSettings();
    const chosen = { ...prefsFrom(settings, prefs), assistantRoute: lastScan.prefs.assistantRoute };
    const plan = scanner.planFirstRun({ scan: lastScan.scan, keys: keysOf(settings), prefs: chosen });
    const modelId = (value) => (typeof value === "string" && scanner.MODEL_ID.test(value) ? value : null);
    const applied = [];
    const firstRun = {
      version: FIRST_RUN_VERSION,
      scanAt: lastScan.at,
      appliedAt: now(),
      opencode: { installed: plan.opencode.installed, version: plan.opencode.version, path: plan.opencode.path, supported: plan.opencode.supported },
      providers: { linked: plan.providers.linked, paid: plan.providers.paid, freeCount: plan.providers.free.count },
      explorer: { model: modelId(plan.explorer.model), agent: "plan", free: plan.explorer.free === true, reason: plan.explorer.reason },
      builder: { model: modelId(plan.builder.model), agent: "build", free: plan.builder.free === true, parallel: plan.builder.parallel ?? null, reason: plan.builder.reason },
      judge: { kind: plan.judge.kind, model: modelId(plan.judge.model), reason: plan.judge.reason },
      allowFreeTraining: chosen.allowFreeTraining,
      preferFree: chosen.preferFree,
      warnings: plan.warnings,
    };
    await updateSettings((next) => {
      next.firstRun = firstRun;
      applied.push("firstRun");
      if (plan.ok && (!next.executorCli || next.executorCli === "opencode")) {
        if (next.executorCli !== "opencode") applied.push("executorCli");
        next.executorCli = "opencode";
      }
      const models = next.executorModels && typeof next.executorModels === "object" ? { ...next.executorModels } : {};
      if (firstRun.builder.model) {
        if (models.opencode !== firstRun.builder.model) applied.push("executorModels.opencode");
        models.opencode = firstRun.builder.model;
      } else if (models.opencode) {
        delete models.opencode;
        applied.push("executorModels.opencode");
      }
      next.executorModels = models;
      if (plan.judge.kind === "jev" && next.modelSelection !== "jev") {
        next.modelSelection = "jev";
        applied.push("modelSelection");
      }
    });
    // Auto setup reconciles the assistant route and the builder CLI with what
    // the machine has (saved keys, installed CLIs, a local server), so a
    // machine without OpenCode still leaves this step configured.
    const auto = await autoPlan({ apply: true });
    if (auto?.applied === true) applied.push("autoSetup");
    const notes = [];
    if (auto?.ok) notes.push(`Auto setup: ${auto.summary}`);
    else if (auto?.error && !plan.ok) notes.push(`Auto setup: ${auto.error}`);
    if (firstRun.builder.model) notes.push("The free builder model is saved: choose the Free coding tier in Settings to run it one worker at a time (Auto keeps it as OpenCode's pinned model when the z.ai plan is not in use).");
    if (plan.judge.kind === "assistant" || plan.judge.kind === "opencode-free") notes.push("The stand-in judge is saved; routing and intake use it once the judge route is wired (until then fixed defaults apply).");
    log(`[first-run] applied: ${applied.join(", ")}`);
    const summary = plan.ok || !auto?.ok
      ? `Explorer ${firstRun.explorer.model ?? "OpenCode default"}, builder ${firstRun.builder.model ?? "OpenCode default"}, judge ${firstRun.judge.kind}.`
      : `OpenCode is not usable yet; ${auto.summary}`;
    return { ok: true, firstRun, plan, applied, notes, summary, autoSetup: auto };
  }

  function consumeEvents(buffer, onEvent) {
    let rest = buffer;
    let at;
    while ((at = rest.indexOf("\n")) >= 0) {
      const line = rest.slice(0, at).trim();
      rest = rest.slice(at + 1);
      if (!line) continue;
      try { onEvent(JSON.parse(line)); } catch {}
    }
    return rest;
  }

  async function map({ projectId = null } = {}) {
    if (smoke) return { ok: false, reason: "unavailable", error: "The first map is unavailable in smoke, capture and CLI launches." };
    if (mapping.running) return { ok: false, reason: "busy", error: "A first map is already running for this project." };
    if (!projects.open?.()) return { ok: false, reason: "no-project", error: "Open a project folder before mapping it." };
    const project = projects.current();
    if (projectId && projectId !== project.id) return { ok: false, reason: "project-changed", error: "The selected project changed. Reload and map again." };
    const settings = await readSettings();
    const plan = settings?.firstRun ?? lastScan?.plan ?? null;
    const explorer = plan?.explorer ?? null;
    if (!explorer) return { ok: false, reason: "no-scan", error: "Run the first scan first so the map knows which model to use." };
    const paid = Array.isArray(plan?.providers?.paid) ? plan.providers.paid : [];
    if (!explorer.model && !paid.length) return { ok: false, reason: "no-explorer", error: explorer.reason || "No explorer model is available: link a provider or allow a free model." };
    if (plan?.opencode && plan.opencode.installed === false) return { ok: false, reason: "no-opencode", error: "OpenCode is not installed on this machine." };
    const model = typeof explorer.model === "string" && scanner.MODEL_ID.test(explorer.model) ? explorer.model : null;
    let report = null;
    try { report = await analyzeProject(); } catch (error) { log(`[first-run] analyzer unavailable for the map: ${errorText(error)}`); }
    const prompt = mapper.buildFirstMapPrompt({ project: { name: project.name, path: project.path }, report, model });
    const args = ["run", "--format", "json", "--agent", "plan", ...(model ? ["--model", model] : []), "--title", MAP_TITLE, "--dir", project.path];
    Object.assign(mapping, { running: true, projectId: project.id, startedAt: now(), step: "starting OpenCode", tools: 0, child: null, cancelled: false });
    const texts = [];
    let buffer = "";
    let lastProgress = 0;
    const emit = (phase, extra = {}) => {
      try { progress({ kind: "map", phase, projectId: project.id, step: mapping.step, tools: mapping.tools, elapsedMs: now() - mapping.startedAt, ...extra }); } catch {}
    };
    const onEvent = (event) => {
      const part = event?.part ?? {};
      if (event?.type === "tool_use" && part.tool) {
        mapping.tools += 1;
        mapping.step = clip(`${part.tool} ${part.state?.title ?? ""}`, 140);
      } else if (event?.type === "text" && typeof part.text === "string") {
        texts.push(part.text);
        mapping.step = "writing the map";
      } else if (event?.type === "step_start") mapping.step = mapping.step === "starting OpenCode" ? "reading the folder" : mapping.step;
      else if (event?.type === "error") mapping.step = "provider error";
      if (now() - lastProgress >= PROGRESS_INTERVAL_MS) { lastProgress = now(); emit("running"); }
    };
    emit("start", { model, agent: "plan" });
    log(`[first-run] map: ${project.name} on ${model ?? "OpenCode default"} (plan agent)`);
    let result;
    try {
      result = await exec("opencode", args, {
        input: prompt, timeoutMs: mapTimeoutMs, env: { ...env, ...runEnv() }, cwd: project.path, platform,
        onSpawn: (child) => { mapping.child = child; },
        onData: (chunk) => { buffer = consumeEvents(buffer + chunk, onEvent); },
      });
    } catch (error) {
      result = { code: null, stdout: "", stderr: "", timedOut: false, error: errorText(error) };
    }
    consumeEvents(buffer + "\n", onEvent);
    const elapsedMs = now() - mapping.startedAt;
    const events = judge.parseRunEvents(result?.stdout ?? "");
    const finish = (payload) => {
      Object.assign(mapping, { running: false, child: null, step: null });
      lastMaps.set(project.id, { at: now(), ok: payload.ok === true, reason: payload.reason ?? null, summary: payload.summary ?? payload.error ?? null, model });
      emit("done", { ok: payload.ok === true, reason: payload.reason ?? null });
      return { ...payload, projectId: project.id, model, sessionId: events.sessionId, elapsedMs, tokens: events.tokens, cost: events.cost };
    };
    if (mapping.cancelled) return finish({ ok: false, reason: "cancelled", error: "The map was cancelled." });
    if (result?.timedOut) return finish({ ok: false, reason: "timeout", error: `The explorer did not finish within ${Math.round(mapTimeoutMs / 60000)} minutes; try a smaller folder or a paid model.` });
    if (result?.error && !result?.stdout) return finish({ ok: false, reason: "spawn-failed", error: `OpenCode could not start: ${clip(result.error, 200)}` });
    const joined = events.texts.join("\n");
    if (events.errors.length && !joined.trim()) {
      const first = events.errors[0];
      if (first.freeTierRefused) return finish({ ok: false, reason: "free-tier-refused", error: "The free tier refused this run. This project's own OpenCode configuration customizes the plan agent (a permission or prompt override), which free models do not allow. Map it with a paid model, or remove that override from .opencode/." });
      return finish({ ok: false, reason: "provider-error", error: `The explorer's provider reported an error: ${first.message}` });
    }
    const parsed = mapper.parseFirstMap(joined);
    if (!parsed.ok) return finish({ ok: false, reason: "unparsable", error: parsed.error, textTail: clip(joined.slice(-600), 600), warnings: parsed.warnings });
    lastMapDetail.set(project.id, parsed.map);
    const ideas = mapper.ideasFrom(parsed.map, { projectId: project.id, projectPath: project.path, sessionId: events.sessionId, model, now: now() });
    let merged = { ideas: [], added: 0, updated: 0 };
    try {
      if (typeof admitIdeas === "function") {
        // The host merges by id inside its board gateway, against the ideas
        // as they are at that moment: a read here and a write after the map
        // could revert a promotion's planned/taskId stamps landed between them.
        // The gateway broadcasts the result itself.
        const admitted = await admitIdeas(ideas);
        merged = { ideas: Array.isArray(admitted?.ideas) ? admitted.ideas : [], added: Number(admitted?.added) || 0, updated: Number(admitted?.updated) || 0 };
      } else {
        merged = mapper.mergeIdeas(await readIdeas(), ideas);
        await writeIdeas(merged.ideas);
        send("eyes:ideas", merged.ideas);
      }
    } catch (error) {
      return finish({ ok: false, reason: "ideas-write-failed", error: `The map was read but its ideas could not be saved: ${errorText(error)}`, map: parsed.map });
    }
    try {
      await writeMapFile(MAP_FILE, { version: FIRST_MAP_VERSION_OF(mapper), at: now(), projectId: project.id, projectPath: project.path, model, sessionId: events.sessionId, map: parsed.map, warnings: parsed.warnings, tokens: events.tokens, cost: events.cost, elapsedMs });
    } catch (error) {
      log(`[first-run] map file not saved: ${errorText(error)}`);
    }
    const summary = mapper.firstMapSummary(parsed.map);
    log(`[first-run] map done: ${summary} (${merged.added} new idea(s), ${merged.updated} updated)`);
    return finish({ ok: true, map: parsed.map, summary, ideas: { added: merged.added, updated: merged.updated, total: merged.ideas.length }, warnings: parsed.warnings });
  }

  // The AI linked at the Scan stop plans the rest of the setup: the assistant's
  // chat model when the scan made it the judge, otherwise the explorer model
  // through `opencode run`; with neither, the same advice is written from the
  // facts alone (setup-assist.mjs). Advice is text for the person: nothing is
  // saved and no work starts.
  function assist({ progress: marks = {} } = {}) {
    if (smoke) return Promise.resolve({ ok: false, error: "The setup assistant is unavailable in smoke, capture and CLI launches." });
    if (assisting) return assisting;
    assisting = (async () => {
      const started = now();
      const settings = await readSettings();
      const firstRun = settings?.firstRun ?? lastScan?.plan ?? null;
      if (!firstRun) return { ok: false, error: "Run the first scan and use its setup before asking for guidance." };
      if (!assistModule) return { ok: false, error: "The setup assistant module is unavailable." };
      const project = projects.open?.() ? projects.current() : null;
      let report = null;
      if (project) { try { report = await analyzeProject(); } catch (error) { log(`[first-run] analyzer unavailable for the assistant: ${errorText(error)}`); } }
      let map = project ? lastMapDetail.get(project.id) ?? null : null;
      if (project && !map) { try { map = (await readMapFile(MAP_FILE))?.map ?? null; } catch {} }
      const facts = { firstRun, project: project ? { name: project.name, path: project.path } : null, report, map, progress: marks };
      const judgeKind = firstRun.judge?.kind ?? null;
      const explorerModel = typeof firstRun.explorer?.model === "string" && scanner.MODEL_ID.test(firstRun.explorer.model) ? firstRun.explorer.model : null;
      let via = "static";
      let model = null;
      let reply = null;
      if (judgeKind === "assistant" && typeof assistantChat === "function") {
        via = "assistant";
        const prompt = assistModule.buildSetupAdvicePrompt(facts);
        try { reply = await assistantChat(prompt.system, prompt.user); } catch (error) { reply = { ok: false, error: errorText(error) }; }
        model = reply?.model ?? null;
      } else if (explorerModel) {
        via = "opencode-free";
        model = explorerModel;
        const prompt = assistModule.buildSetupAdvicePrompt({ ...facts, model: explorerModel });
        const transport = judge.opencodeRunTransport({ exec, model: explorerModel, cwd: project?.path ?? null, env: { ...env, ...runEnv() }, timeoutMs: 120000, title: "Mefi setup assistant" });
        try { reply = await transport({ system: prompt.system, user: prompt.user, timeoutMs: 120000 }); } catch (error) { reply = { ok: false, error: errorText(error) }; }
      }
      const warnings = [];
      let advice = null;
      if (reply?.ok) {
        const parsed = assistModule.parseSetupAdvice(reply.text);
        if (parsed.ok) advice = parsed.advice;
        else warnings.push(parsed.error);
      } else if (reply) warnings.push(clip(reply.error, 200));
      if (!advice) {
        advice = assistModule.staticSetupAdvice(facts);
        if (via !== "static") { warnings.push(`The ${via === "assistant" ? "assistant's" : `${model}`} reply could not be used; showing the built-in guidance instead.`); via = "static"; model = null; }
      }
      log(`[first-run] assist via ${via}${model ? ` (${model})` : ""}: ${advice.summary ? clip(advice.summary, 80) : "no summary"}`);
      return { ok: true, via, model, advice, warnings, elapsedMs: now() - started };
    })().finally(() => { assisting = null; });
    return assisting;
  }

  function cancel() {
    if (!mapping.running) return { ok: true, cancelled: false };
    mapping.cancelled = true;
    if (mapping.child) {
      try { scanner.killTree(mapping.child, platform); } catch {}
      return { ok: true, cancelled: true };
    }
    return { ok: true, cancelled: false, pending: true };
  }

  return { status, scan, apply, map, assist, cancel, lastScan: () => lastScan };
}

const FIRST_MAP_VERSION_OF = (mapper) => (typeof mapper?.FIRST_MAP_VERSION === "number" ? mapper.FIRST_MAP_VERSION : 1);
