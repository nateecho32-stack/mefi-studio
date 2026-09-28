// Seeded fake-bridge copy of a built booklet for performance probes.
//   node tools/perf-probe/make_probe.cjs <booklet.html> data/models.json tools/perf-probe/look.json <pages dir>/<name>.html
// Query: ?state=busy|quiet|family  &mode=vibe|build
// Based on a peer session's Vibe preview seed (make_preview.cjs), plus the
// owner's look preferences in localStorage and a frame/LoAF recorder (__perf).
const fs = require("node:fs");
const path = require("node:path");
const [BOOKLET, MODELS, PREFS, OUT] = process.argv.slice(2);
const catalog = JSON.parse(fs.readFileSync(MODELS, "utf8"));
const prefs = JSON.parse(fs.readFileSync(PREFS, "utf8"));
delete prefs["mefiStudio.uiMode"];

const script = `
<script>
(() => {
  const now = Date.now(), M = 60000, H = 60 * M, P = "p1";
  const q = new URLSearchParams(location.search);
  const state = q.get("state") || "family";
  const quiet = state === "quiet", fam = state === "family";
  const tasks = quiet ? [] : [
    { id: "t_a", projectId: P, title: "Wall-jump for the player", status: "active", prompt: "Let the player jump off walls. Keep the coyote time.", createdAt: now - 40 * M, updatedAt: now - M, contextVersion: 1 },
    { id: "t_b", projectId: P, title: "Parallax sky layers", status: "active", prompt: "Three parallax layers behind the level.", createdAt: now - 30 * M, updatedAt: now - 2 * M, contextVersion: 1 },
    { id: "t_c", projectId: P, title: "Fix the save slot overwrite", status: "awaiting_verification", createdAt: now - 60 * M, updatedAt: now - 4 * M, contextVersion: 1 },
    { id: "t_e", projectId: P, title: "Coin pickup sound", status: "open", createdAt: now - 95 * M, updatedAt: now - 25 * M, contextVersion: 1 },
    { id: "t_h", projectId: P, title: "Dash ability", status: "done", verification: { state: "verified" }, createdAt: now - 300 * M, updatedAt: now - 50 * M },
    { id: "t_i", projectId: P, title: "Checkpoint flags", status: "done", verification: { state: "verified" }, createdAt: now - 400 * M, updatedAt: now - 3 * H },
    ...(fam ? [
      { id: "f0", projectId: P, title: "Save system with three slots", status: "open", prompt: "Add a save system with three slots, autosave at checkpoints and a load menu.", updatedAt: now - 20000, contextVersion: 1, delegation: { version: 1, intake: true, summary: "The save data first, then the slots menu, autosave and the load menu on top of it.", childTaskIds: ["f1", "f2", "f3", "f4"] } },
      { id: "f1", projectId: P, title: "Save data model", status: "done", verification: { state: "verified" }, parentTaskId: "f0", delegatedFrom: { intake: true, parentTaskId: "f0" }, updatedAt: now - 9 * M },
      { id: "f2", projectId: P, title: "Three save slots menu", status: "active", parentTaskId: "f0", delegatedFrom: { intake: true, parentTaskId: "f0" }, updatedAt: now - 2 * M, prompt: "A menu with three slots showing the date and level." },
      { id: "f3", projectId: P, title: "Autosave at checkpoints", status: "open", parentTaskId: "f0", delegatedFrom: { intake: true, parentTaskId: "f0" }, dependsOn: ["f1"], updatedAt: now - 20000, prompt: "Save to the active slot at each checkpoint flag." },
      { id: "f4", projectId: P, title: "Load menu on the title screen", status: "open", parentTaskId: "f0", delegatedFrom: { intake: true, parentTaskId: "f0" }, dependsOn: ["f2"], updatedAt: now - 20000, prompt: "Continue from any slot on the title screen." },
    ] : []),
    // A fuller board, so the tree under Vibe and Command has a realistic count.
    ...Array.from({ length: quiet ? 0 : 24 }, (_, i) => ({ id: "t_x" + i, projectId: P, title: "Board task " + (i + 1) + ": tidy a representative module", status: i % 5 === 0 ? "done" : "open", dependsOn: i > 3 ? ["t_x" + Math.floor(i / 2)] : [], createdAt: now - (i + 5) * M, updatedAt: now - i * M, contextVersion: 1 })),
  ];
  const sessions = quiet ? [] : Array.from({ length: 4 }, (_, i) => ({ id: "s" + i, title: "Project session " + (i + 1), timeCreated: now - 3 * H, timeUpdated: now - i * M }));
  const todos = sessions.flatMap((session, si) => Array.from({ length: 6 }, (_, i) => ({ id: session.id + "_todo_" + i, sessionId: session.id, position: i, content: "Representative work item " + (i + 1), status: i < si ? "completed" : i === si ? "in_progress" : "pending" })));
  const subs = {};
  const emit = (key, payload) => { for (const cb of subs[key] || []) { try { cb(payload); } catch (error) { console.error(error); } } };
  const seed = {
    startupState: { ok: true, chosen: true, mode: "workspace", ready: true },
    prefsGet: { ok: true, prefs: { commandHome: true } },
    projectsList: { ok: true, activeId: P, projects: [{ id: P, name: "Pixel Garden", path: "C:\\\\Projects\\\\pixel-garden" }, { id: "p2", name: "Recipe site", path: "C:\\\\Projects\\\\recipe-site" }] },
    tasksList: { ok: true, projectId: P, tasks },
    ideasList: { ok: true, projectId: P, ideas: quiet ? [] : [
      { id: "i1", title: "Ghost replay of your best run", source: "thinker", at: now - 12 * M, read: false, detail: "Record inputs on a best time and replay them as a translucent ghost." },
      { id: "i2", title: "Screen shake on heavy landings", source: "auditor", at: now - 40 * M, read: false },
    ] },
    planningList: { ok: true, projectId: P, plans: [] },
    assistantState: { ok: true, state: { projectId: P, status: "running", ai: { keyPresent: true, online: true }, prefs: {}, log: [], work: [], agents: quiet ? [] : [{ role: "reference", status: "running", target: { kind: "task", id: "t_a" } }, { role: "auditor", status: "running", target: { kind: "task", id: "t_c" } }], messages: [], questions: [] } },
    assistantStatus: { ok: true, status: {
      projectId: P, enabled: true, execute: true, held: false, autoBuild: true, mode: "swarm", parallel: 3,
      running: quiet ? [] : [
        { taskId: "t_a", projectId: P, title: "Wall-jump for the player", startedAt: now - 4 * M, phase: "building", progress: 0.62, route: "opencode", currentStep: "Edit running · 3s · src/player.lua" },
        { taskId: "t_b", projectId: P, title: "Parallax sky layers", startedAt: now - 70000, phase: "building", progress: 0.25, route: "claude", currentStep: "Add three background layers with their own scroll speed" },
        ...(fam ? [{ taskId: "f2", projectId: P, title: "Three save slots menu", startedAt: now - 2 * M, phase: "building", progress: 0.4, route: "opencode", currentStep: "Bash running · 12s · love . --test menus" }] : []),
      ],
    } },
    backlogStatus: { ok: true, projectId: P, counts: { ready: 1, review: 1 },
      next: quiet ? [] : [{ id: "t_e", kind: "task", stage: "ready", title: "Coin pickup sound" }],
      approval: [], blocked: [],
      taskStates: quiet ? [] : [
        { id: "t_a", stage: "running" }, { id: "t_b", stage: "running" }, { id: "t_c", stage: "review" }, { id: "t_e", stage: "ready" },
        ...(fam ? [{ id: "f0", stage: "waiting" }, { id: "f2", stage: "running" }, { id: "f3", stage: "ready" }, { id: "f4", stage: "waiting" }] : []),
      ], waiting: null },
    agentsState: { ok: true, name: "Pixel Garden", habits: [], skills: [], mcpTools: [], configuration: { executorCli: "opencode", executorModels: { opencode: "deepseek-v4.1-flash" } }, choices: {
      companion: { ok: true, provider: "zen", model: "gpt-6-luna" }, lead: { ok: true, provider: "zen", model: "gpt-6-sol" }, desk: { ok: true, provider: "zen", model: "gpt-6-sol" },
      heavy: { ok: true, provider: "claude", model: "opus-5.5" }, routine: { ok: true, provider: "zen", model: "gpt-6-luna" } } },
    assistantDoneLog: { ok: true, entries: [] },
    machineStatus: { capacity: { resources: { availableMemoryMB: 7412, lagMs: 14 } }, leases: { busy: false, exclusive: false }, wait: false },
    eyesState: { ok: true, sessions, todos, changes: [], pngs: [] },
    eyesCheckpointsRead: { ok: true, checkpoints: {} }, eyesRequestsRead: { ok: true, requests: [] }, eyesBriefingRead: { ok: true, briefing: null }, eyesCollisions: { ok: true, collisions: [], presence: [] },
    speedMeasurements: { ok: true, measurements: {} },
    communityStatus: { ok: true, status: { available: true, configured: true, linked: true, member: true, state: "ok", prompt: { due: false, never: false, snoozeUntil: null } } },
  };
  const catalog = ${JSON.stringify(catalog)};
  window.__seed = seed; window.__subs = subs; window.__calls = []; window.__emit = emit;
  window.mefiStudio = new Proxy({}, {
    get(_, key) {
      if (typeof key !== "string" || key === "then") return undefined;
      if (key.startsWith("on")) return (cb) => { (subs[key] ??= []).push(cb); return () => {}; };
      if (key === "readCatalog" || key === "refreshCatalog") return async () => catalog;
      if (key in seed) return async () => JSON.parse(JSON.stringify(seed[key]));
      return async (...args) => { window.__calls.push([key, ...args]); return { ok: false, error: "Preview only" }; };
    },
    has() { return true; },
  });
  try {
    const prefs = ${JSON.stringify(prefs)};
    for (const [key, value] of Object.entries(prefs)) localStorage.setItem(key, value);
    localStorage.setItem("mefiStudio.uiMode", q.get("mode") || "vibe");
    localStorage.setItem("mefiStudio.whatsNew.seen", "vibe-build-1");
    localStorage.setItem("mefiStudio.keyHint.v1", "1"); localStorage.setItem("mefiStudio.keyTips", "off"); localStorage.setItem("mefiStudio.setupHelper.seen", "setup-helper-1");
    localStorage.setItem("mefiStudio.walkthrough.v2", JSON.stringify({ version: 2, step: 6, status: "dismissed", mode: "idle", done: [true, true, true, true, true, true, true] }));
    localStorage.setItem("mefiStudio.workspace.person", "Mefi");
    localStorage.setItem("mefiStudio.workspace.companion", "Star");
    // No desktop audio in a probe: the tree does not wait on a capture prompt.
    localStorage.setItem("mefiStudio.zenReactive", "0");
    localStorage.setItem("mefiStudio.ambientZen", "0");
    // Experiment overrides: ?ls={"key":value} sets keys, ?music={...} and
    // ?dyn={...} merge into the look records.
    const merge = (key, param) => { const extra = q.get(param); if (extra) localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key) || "{}"), ...JSON.parse(extra) })); };
    merge("mefiStudio.music.v1", "music");
    merge("mefiStudio.treeDynamics.v1", "dyn");
    merge("mefiStudio.appearance", "look");
    const ls = q.get("ls");
    if (ls) for (const [key, value] of Object.entries(JSON.parse(ls))) localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
  } catch (error) { console.error("probe prefs", error); }

  // ---- frame and long-frame recorder ----------------------------------------
  const perf = window.__perf = { sampling: false };
  perf.start = () => {
    perf.frames = []; perf.loaf = []; perf.sampling = true; perf.t0 = performance.now();
    const tick = (t) => { if (!perf.sampling) return; perf.frames.push(t); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  };
  perf.stop = () => {
    perf.sampling = false;
    const f = perf.frames, gaps = [];
    for (let i = 1; i < f.length; i++) gaps.push(f[i] - f[i - 1]);
    const sorted = [...gaps].sort((a, b) => a - b);
    const pct = (p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0;
    const span = (performance.now() - perf.t0) / 1000;
    const loaf = perf.loaf;
    const scripts = new Map();
    for (const entry of loaf) for (const s of entry.scripts) { const k = (s.sourceFunctionName || "?") + " @" + (s.invoker || "") ; const v = scripts.get(k) || { ms: 0, n: 0 }; v.ms += s.duration; v.n++; scripts.set(k, v); }
    return {
      seconds: +span.toFixed(2), rafFps: +(f.length / span).toFixed(1),
      gapP50: +pct(0.5).toFixed(1), gapP95: +pct(0.95).toFixed(1), gapP99: +pct(0.99).toFixed(1), gapMax: +(sorted.at(-1) || 0).toFixed(1),
      over25: gaps.filter((g) => g > 25).length, over50: gaps.filter((g) => g > 50).length,
      loafCount: loaf.length, loafMs: +loaf.reduce((a, e) => a + e.duration, 0).toFixed(0), loafBlocking: +loaf.reduce((a, e) => a + e.blockingDuration, 0).toFixed(0),
      loafStyleLayout: +loaf.reduce((a, e) => a + (e.styleLayout || 0), 0).toFixed(0),
      topScripts: [...scripts].sort((a, b) => b[1].ms - a[1].ms).slice(0, 12).map(([k, v]) => k + " " + v.ms.toFixed(0) + "ms/" + v.n),
      worst: [...loaf].sort((a, b) => b.duration - a.duration).slice(0, 5).map((e) => ({ d: +e.duration.toFixed(0), sl: +(e.styleLayout || 0).toFixed(0), scripts: e.scripts.slice(0, 4).map((s) => (s.sourceFunctionName || "?") + ":" + s.duration.toFixed(0) + " " + (s.invoker || "")) })),
    };
  };
  try {
    new PerformanceObserver((list) => {
      if (!perf.sampling) return;
      for (const e of list.getEntries()) perf.loaf.push({ duration: e.duration, blockingDuration: e.blockingDuration, styleLayout: e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0, scripts: (e.scripts || []).map((s) => ({ sourceFunctionName: s.sourceFunctionName, invoker: s.invoker, duration: s.duration, url: s.sourceURL })) });
    }).observe({ type: "long-animation-frame", buffered: false });
  } catch (error) { console.warn("no LoAF", error); }
})();
</script>
`;
const html = fs.readFileSync(BOOKLET, "utf8");
const at = html.indexOf("</title>") + "</title>".length;
fs.writeFileSync(OUT, html.slice(0, at) + script + html.slice(at), "utf8");
console.log("wrote", OUT, (fs.statSync(OUT).size / 1e6).toFixed(2), "MB");
